/**
 * Ports for suites that start a real server — and why no suite may pick its own.
 *
 * ~20 agent sessions run against this repo at once and every one of them runs
 * `npm test` before it delivers. A suite that binds a number somebody typed loses
 * that race the moment two runs overlap, and it does not lose it quietly:
 * `listen()` in lib/server.js calls `process.exit(1)` when nothing binds, because a
 * listener-less daemon whose poller still fires pushes is worse than a dead one.
 * That is right for the daemon and fatal for a suite — the run dies with exit 1 and
 * an EADDRINUSE that reads exactly like a real regression in whatever was under
 * test. bc-szkq is the bead for one of those: five full-suite runs on a merged
 * branch, four green and one exit 1, reproducing in none of the four runs after it.
 *
 * Two helpers, and the first one is the one to reach for.
 *
 * `boundPort(servers)` has no window at all. The server binds port 0, the kernel
 * picks a free port, and the port is read back off the listener that is already
 * holding it — so there is no interval in which another process could take it.
 *
 * `freePort()` opens a probe on port 0, reads the assigned port and closes it, which
 * leaves a real window between the close and the bind — tens of milliseconds when what
 * binds it is a child process that has to start first. It is only for configuration that
 * has to name the port *before* the server exists — an OAuth `redirectUri`, a `baseUrl` —
 * where the port has to be known first and there is nothing else to read it off. Since
 * bc-dw47 the number it hands back is *claimed* on the way out, so no other run of these
 * suites picks it during that window; `CLAIM_DIR` says how, and what it does not promise.
 *
 * In practice that is two shapes, and both of them are shapes where there is genuinely
 * no listener in this process to read anything off:
 *
 * - a `config.json` written for a *child* to read — `test/slowstart.mjs`,
 *   `test/outagepush.mjs`, `test/routercrash.mjs`, `scripts/test-swap.js` and
 *   `scripts/space-check.mjs` each spawn `bin/router.js` or `bin/beadcause.js`, so the
 *   number has to be on disk before the process that binds it exists;
 * - an OAuth `redirectUri`, which `lib/auth.js` reads back and compares — so it has to be
 *   the port the server ends up on, and it is written into the config that *makes* the
 *   server. `test/auth.mjs` and `test/attribution.mjs` are that case, and both of them
 *   use `boundPort` for their sign-in-*off* daemon in the same file, which is the
 *   distinction drawn as sharply as it can be drawn.
 *
 * A `baseUrl` on its own is not one of these: `createApp` and `listen` hold the config
 * object by reference, so a suite can bind on port 0 and fill `cfg.baseUrl` in on the
 * line after `await boundPort(servers)`, before it makes its first request. Most of the
 * suites here do exactly that.
 *
 * This file is under `test/helpers/` rather than `test/` on purpose:
 * `scripts/test.mjs` discovers suites with a non-recursive readdir of `test/`
 * filtered on `.mjs`, so a subdirectory is invisible to it. That is what keeps a
 * helper from being run as a suite — and it also means a *suite* put in here would
 * silently never run. Suites go in `test/`, flat, which is the whole point of
 * discovery; only things that are imported belong here.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

/**
 * The port a server is actually listening on, read off the listener itself.
 *
 * Call `listen({ ...cfg, port: 0 }, handler)` and hand the result straight here:
 *
 *     const servers = listen({ ...cfg, port: 0 }, app.handler);
 *     const port = await boundPort(servers);
 *
 * Awaiting it is also the answer to the other thing suites used to work around —
 * `listen()` returns before the socket is up, so the old fixed-port suites raced
 * their first request against their own bind and retried in a loop. Once this
 * resolves, the socket is listening.
 *
 * Loopback-only, deliberately. `listen()` binds one listener per host, and with
 * port 0 each host would be given a *different* ephemeral port — so "the" port is
 * only a meaningful thing to ask for when there is one listener. Every suite is
 * `host: '127.0.0.1'`, and anything else is a mistake worth hearing about.
 */
export function boundPort(servers) {
  if (!Array.isArray(servers) || servers.length !== 1) {
    throw new Error(
      `boundPort expects one listener (host: '127.0.0.1'), got ${Array.isArray(servers) ? servers.length : typeof servers} — ` +
        'with port 0 each host binds a different port, so there is no single port to report'
    );
  }
  // A TLS listener hangs the net.Server that owns the port on the http server as
  // `.front`; a plain one is the listener itself. This is the same pair closeServer
  // knows about.
  const listener = servers[0].front || servers[0];
  return new Promise((resolve, reject) => {
    const done = () => {
      const address = listener.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error(`listener has no address to report (${JSON.stringify(address)})`));
    };
    if (listener.listening) done();
    else {
      listener.once('listening', done);
      listener.once('error', reject);
    }
  });
}

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
        if (claimPort(port) || ++tries >= CANDIDATES) return resolve(port);
        round();
      }, reject);
    };
    round();
  });
}
