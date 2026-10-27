/**
 * Loopback port claims — one note per port, shared by every process that picks one.
 *
 * This lived in `test/helpers/net.mjs` until bc-jvt0.9, and it moved because the daemon
 * needed it. A claim says "this number is spoken for" so that two processes probing the
 * kernel for a free port in the same few milliseconds are not both handed it — but a note
 * only works if *everybody who picks a port writes one*, and `bin/router.js` picks one for
 * every backend it starts and wrote nothing. So a gate run's `freePort` could be handed the
 * number the live daemon had probed and not yet bound (the suite's child then exits on a
 * lost port, which reads as a regression in whatever was under test — PR #82,
 * test/routerdrain.mjs), and the daemon's probe could take a number a suite had claimed
 * and not yet bound. `CLAIM_DIR` coordinated the suites with each other and nothing at all
 * with the one process on this Mac that starts a backend all day.
 *
 * A `bin` importing from `test/` is the wrong direction, so the code is here and
 * `test/helpers/net.mjs` re-exports it under the names every suite already imports. The
 * protocol has no idea who its callers are and must not learn, which is why moving it
 * changed no behaviour.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * Where a port handed out by `freePort` is claimed, so that no other run picks it too.
 *
 * One directory per *machine*, one empty-ish file per port named after the number and
 * containing the pid that took it. It is not a lock in any strong sense — nothing waits
 * on it and nothing is guaranteed by it — it is a note to the other ~20 `npm test` runs
 * saying "this number is spoken for", which is all that was missing.
 *
 * ## Why this is not `os.tmpdir()` any more — bc-jvt0.8
 *
 * It was, and on macOS that is **per-user**, not per-machine: `os.tmpdir()` reads
 * `TMPDIR`, which launchd sets to a private `/var/folders/<hash>/T` for each account. One
 * directory per machine and one per user are the same sentence right up until two
 * accounts run suites on the same laptop — which is what CI moving onto this machine
 * under a dedicated `ghrunner` account did (bc-hkval, #105). A local `b7e-gate` as
 * `you` and a CI shard as `ghrunner` claimed into two trees that cannot see each
 * other, so between them the exclusive create was not exclusive at all, and the window
 * bc-dw47 added claiming to close was open again — silently, because the claim still
 * *worked*, just only against half the runs on the machine.
 *
 * So the default is a fixed path outside anybody's tmpdir, and `BEADCAUSE_PORT_CLAIMS`
 * overrides it. The override is what a suite uses to get a claim root of its own to
 * assert about, and it is the only way this file can be tested for the failure above
 * without two Unix accounts to hand.
 *
 * ## The three things sharing a directory between accounts costs
 *
 * None of them arise while every run is the same account, which is why none of them were
 * here before:
 *
 * - **The directory has to be writable by everybody.** `mkdir` applies the creator's
 *   umask, so the mode is set explicitly on the way in; a directory somebody else made is
 *   left exactly as it is, because the chmod would fail anyway and it is either already
 *   usable or not ours to fix.
 * - **`/tmp` is sticky (1777) and this directory must not be.** Sticky means only a
 *   file's owner may unlink it, and the staleness backstop below exists precisely to
 *   unlink *other* runs' claims. The bit is not inherited by a subdirectory, so
 *   `/tmp/beadcause-ports` at 0777 is unlink-by-anybody, which is what the backstop needs.
 * - **A claim has to be readable by the run that finds it.** If it is not, the pid cannot
 *   be read — and an unreadable claim used to read as an abandoned one, so a live run's
 *   port would be taken from under it, which is the exact failure claiming exists to
 *   prevent. Claims are made world-readable, and a read refused for permission is treated
 *   as "somebody has this" rather than as "nobody does".
 *
 * And a fourth thing, which is a rule rather than a cost: a claim root that cannot be
 * used is **not** an error. `claimPort` answers false, `freePort` asks for another number
 * and eventually hands back an unclaimed one, exactly as it did before bc-dw47. The claim
 * is an improvement on this helper and not a precondition of it — a shared directory is a
 * thing another account can get wrong, and getting it wrong must not fail somebody's gate.
 */
export const CLAIM_DIR =
  process.env.BEADCAUSE_PORT_CLAIMS ||
  // `/tmp` is the one path every account on a Unix box resolves the same way. Windows has
  // neither that path nor the per-user tmpdir problem, so it keeps what it had.
  (process.platform === 'win32' ? path.join(os.tmpdir(), 'beadcause-ports') : '/tmp/beadcause-ports');

/** Mode the shared directory is created with: writable by every account, and never sticky. */
const CLAIM_DIR_MODE = 0o777;

/** Mode a claim is left at, so another account can read the pid in it rather than guess. */
const CLAIM_MODE = 0o666;

/** Errors that mean the claim root is not ours to use — never a reason to fail a run. */
const UNUSABLE = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOTDIR']);

/**
 * The claim directory, made if it is not there and left alone if somebody else made it.
 *
 * Answers false when it cannot be had at all, which is the caller's cue to give up on
 * claiming rather than to throw.
 */
function ensureClaimDir() {
  let created;
  try {
    created = fs.mkdirSync(CLAIM_DIR, { recursive: true });
  } catch (err) {
    if (UNUSABLE.has(err.code)) return false;
    throw err;
  }
  // `recursive` answers with the first path it made, and undefined when there was nothing
  // to make — so this is "we created it", which is the only case a chmod is ours to do.
  if (created !== undefined) {
    try {
      fs.chmodSync(CLAIM_DIR, CLAIM_DIR_MODE);
    } catch {
      /* raced by another account's mkdir; theirs set the mode */
    }
  }
  return true;
}

/** Ports this process claimed, so exiting can put them back. */
const mine = new Set();

/**
 * A claim older than this is ignored however alive its pid looks.
 *
 * The pid check below is the real test, and this is the backstop for the one case it
 * gets wrong: pids are reused, so a claim left behind by a killed suite can be inherited
 * by an unrelated long-lived process and hold a port for as long as that process lives.
 * No suite here runs for two hours, so nothing legitimate is thrown away by this.
 */
const CLAIM_TTL_MS = 2 * 60 * 60 * 1000;

/** Whether the pid in a claim is still around to be using it. */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM is a process this user may not signal — which is to say, a process. Only
    // ESRCH is evidence that nothing is there.
    return err.code === 'EPERM';
  }
}

/**
 * Take `port` for this process, or report that somebody else has it.
 *
 * Exported for `test/ports.mjs`, which is the only caller that wants a particular
 * number: everything else goes through `freePort` and takes what it is given.
 */
export function claimPort(port) {
  const file = path.join(CLAIM_DIR, String(port));
  if (!ensureClaimDir()) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // `wx` is the whole mechanism: an exclusive create is one syscall, and two runs
      // asking at the same instant means one EEXIST and never two winners. It also
      // refuses to follow a symlink, which is what makes it safe in a directory every
      // account on the machine may write to.
      fs.writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      // Explicitly, because the creator's umask would otherwise decide whether another
      // account can read the pid — and an unreadable claim is a claim that gets taken.
      try {
        fs.chmodSync(file, CLAIM_MODE);
      } catch {
        /* ours to write and not to chmod is not a shape that exists; nothing to do if it does */
      }
      mine.add(port);
      return true;
    } catch (err) {
      if (UNUSABLE.has(err.code)) return false;
      if (err.code !== 'EEXIST') throw err;
      let stale = true;
      try {
        const pid = Number(fs.readFileSync(file, 'utf8').trim());
        const age = Date.now() - fs.statSync(file).mtimeMs;
        stale = !alive(pid) || age > CLAIM_TTL_MS;
      } catch (readErr) {
        // A claim we may not read is somebody else's, and saying otherwise is how a live
        // run loses its port — the one thing this file exists to stop. Anything else
        // (gone between the create and the read, truncated by a crashed write) is not a
        // claim anybody is relying on.
        if (UNUSABLE.has(readErr.code)) return false;
      }
      if (!stale) return false;
      // One reclaim, then round again — and if the second `wx` also loses, another run
      // reclaimed it first and it is theirs, not ours.
      try {
        fs.unlinkSync(file);
      } catch {
        /* somebody else got there first; the retry will find out */
      }
    }
  }
  return false;
}

/**
 * Give back one port this process claimed, and only if it is still ours.
 *
 * For a long-lived process — the daemon's router claims a backend's port for the interval
 * between the probe and the bind, and there are thousands of those in a month, so waiting
 * for `exit` would leave the directory to the two-hour backstop. Once something is
 * *listening* on the number the kernel is the claim, and a note beside it says nothing the
 * kernel does not.
 *
 * "Still ours" is not decoration: a claim this process held past `CLAIM_TTL_MS` may have been
 * judged stale and taken by another run, and unlinking that one would put a live run's
 * port back in the pool. A port this process never claimed is a no-op for the same reason.
 */
export function releasePort(port) {
  if (!mine.delete(port)) return;
  const file = path.join(CLAIM_DIR, String(port));
  try {
    if (Number(fs.readFileSync(file, 'utf8').trim()) !== process.pid) return;
    fs.unlinkSync(file);
  } catch {
    /* already reclaimed, or the directory has been swept */
  }
}

/** Give back every port this process claimed. Registered on `exit` below. */
export function releasePorts() {
  for (const port of mine) {
    try {
      fs.unlinkSync(path.join(CLAIM_DIR, String(port)));
    } catch {
      /* already reclaimed by a run that judged it stale, or the directory has been swept */
    }
  }
  mine.clear();
}

// Best effort, and the stale check above is what covers the rest: a suite killed with
// SIGKILL — which is how a hung one dies — runs no handler at all.
process.on('exit', releasePorts);

/**
 * Candidates asked of the kernel before giving up on finding an unclaimed one.
 *
 * Generous, because each is one bind of one socket, and the thing it is protecting
 * against is a whole suite dying. Reaching the end means every one of twenty ephemeral
 * ports was claimed by a live run, which has not happened and would say something is
 * wrong with the claims rather than with the ports.
 */
const CANDIDATES = 20;

/**
 * A port nothing is listening on, for configuration that must name one up front.
 *
 * Prefer `boundPort`. This closes the probe before returning it, so the port is free
 * rather than held — which is the point, and also the window. Use it only where the
 * number has to exist before the server does.
 *
 * **The window is not small when the binder is a child process** (bc-dw47). Between this
 * returning and `bin/router.js` or `bin/beadcause.js` binding what it was told, node has
 * to start, read a config and reach `listen` — tens of milliseconds, not one — and any of
 * the ~20 other runs on this laptop asking the kernel for a port in that time can be
 * given the same number. So the port is *claimed* before it is handed back: a file in
 * `CLAIM_DIR` that the other runs' `freePort` calls will not pick past. The kernel still
 * chooses the number, because it is the only thing that knows what is really free; the
 * claim only stops beadcause colliding with beadcause, which is the collision there is.
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const probe = () =>
      new Promise((done, fail) => {
        const server = net.createServer();
        server.on('error', fail);
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address();
          server.close(() => done(port));
        });
      });
    const round = () => {
      probe().then((port) => {
        // Claimed, or out of patience — and out of patience still hands back a real
        // free port, because the claim is an improvement on this helper and not a
        // precondition of it. Never fail where the old one would have succeeded.
        // A claim that *throws* — a full disk, a directory that is a file — is no better a
        // reason to fail than one that cannot be made, and here it is worse: the daemon's
        // router calls this to start every backend, and a throw would be a start that
        // fails over a note.
        let won = false;
        try {
          won = claimPort(port);
        } catch {
          /* handed back unclaimed below, once the candidates run out */
        }
        if (won || ++tries >= CANDIDATES) return resolve(port);
        round();
      }, reject);
    };
    round();
  });
}
