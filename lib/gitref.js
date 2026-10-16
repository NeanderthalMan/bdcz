/**
 * Git plumbing for payloads that ride inside a repo without ever touching its files.
 *
 * `lib/sessionlog.js` established the trick and explains why it works: a ref outside
 * `refs/heads/*` and `refs/tags/*` is invisible to `git log`, `git branch`, `git
 * status` and `git checkout`; it is never fetched or pushed unless it is named; and
 * it keeps its objects alive against `gc`. Write to one with `hash-object` /
 * `mktree` / `commit-tree` / `update-ref` and there is no index, no checkout and no
 * working tree involved — so a daemon can commit while a human is mid-edit in the
 * same repo and neither notices the other.
 *
 * That was one file's private plumbing until `lib/foundation.js` needed the same
 * four calls and the same compare-and-swap. It lives here rather than exported from
 * sessionlog because the CAS is the part that must not be reimplemented: two writers
 * racing on a ref is the failure this whole storage shape exists to survive, and it
 * should have exactly one implementation to be wrong in.
 *
 * Nothing here pushes. Naming a refspec is an explicit act, and on a shared repo it
 * should stay one — see the note at the top of sessionlog.js about what an agent
 * transcript carries.
 *
 * `commitToRef` carries its own recovery from a stale lock (bc-xl7n.93) for the same
 * reason the CAS is here and not copied into every caller: `lib/commonrepo.js` fixed
 * this once already for the config repo's own `HEAD` (bc-xl7n.79), and a `git` that
 * dies mid `update-ref` leaves the identical kind of orphaned `*.lock` under
 * `refs/beadcause/<topic>` — one ref rather than the whole snapshot, but just as
 * permanent, because every `cas()` retry in lib/memory.js reads the failure as
 * "somebody else's write landed first" and spins against a race that was never
 * going to end. `clearAbandonedLocks` below is exported so `lib/commonrepo.js` can
 * use the same one rather than keep a second copy of it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
// A leaf that imports nothing — see the note at the top of lib/timing.js.
import { measure } from './timing.js';

const run = promisify(execFile);

/** git args that stamp beadcause as the author, never whoever owns the checkout. */
const IDENTITY = ['-c', 'user.name=beadcause', '-c', 'user.email=beadcause@localhost'];

/**
 * git, with an identity of our own.
 *
 * Without this every object written here is authored by whoever's git identity the
 * repo carries, which would put Adam's name on commits he did not write — the same
 * attribution problem `--actor` fixes for bd comments in lib/bd.js.
 */
export async function git(cwd, args, opts = {}) {
  try {
    // Timed like `bd` and `gh` are, because the session-archive and pull-request routes
    // reach GitHub's refs through here and a `git fetch` is not a cheap local read. See
    // lib/timing.js.
    const { stdout } = await measure('git', () =>
      run('git', [...IDENTITY, ...args], {
        cwd,
        timeout: 30000,
        maxBuffer: 96 * 1024 * 1024,
        ...opts,
      })
    );
    return stdout;
  } catch (err) {
    // execFile's own message is `Command failed: git <args>` and nothing else, which
    // names the command and not the reason. Half of git's useful output is stderr.
    throw new Error(`git ${args[0]}: ${(err.stderr || '').trim().split('\n')[0] || err.message}`);
  }
}

/**
 * git with something on stdin.
 *
 * Separate from `git()` above because `execFile` has no `input` option — that
 * belongs to the *Sync* family, and passing it is silently ignored, so the command
 * hangs on an empty stdin and fails with a message that names no cause. Every object
 * written here (`hash-object`, `mktree`) arrives that way, so this is the path that
 * matters.
 */
export function gitInput(cwd, args, input) {
  return gitPipe(cwd, args, input).then((buf) => buf.toString('utf8'));
}

/**
 * `gitInput`, answering in bytes. `cat-file --batch` reports each object's size in
 * bytes, so its output has to be cut up as a Buffer — decoding it first would put every
 * offset after the first multi-byte character in the wrong place.
 */
function gitPipe(cwd, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...IDENTITY, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`git ${args[0]}: ${err.trim() || `exited ${code}`}`))
    );
    child.stdin.end(input);
  });
}

/** A promise's value, or null if it rejected. For reads where "absent" is an answer. */
export const ok = (p) => p.then((v) => v, () => null);

/**
 * git's **exit code**, for the handful of questions git answers with one.
 *
 * `git()` above throws on any non-zero exit, which is right for a command that was
 * meant to do something and didn't. It is wrong for `merge-base --is-ancestor` and
 * `cat-file -e`, where 1 is not a failure but the word "no": caught as an exception
 * it becomes indistinguishable from a bad ref, an unfetched commit, or a repo that
 * isn't there — and lib/prboard.js has to tell "this commit is not deployed" apart
 * from "this Mac has never heard of this commit". Three states in, three states out.
 *
 * Nothing is thrown here. `code` is git's own, `-1` when it could not be run at all,
 * and stderr rides along for the caller that wants to say why.
 */
export async function gitCode(cwd, args, opts = {}) {
  try {
    await run('git', [...IDENTITY, ...args], { cwd, timeout: 30000, ...opts });
    return { code: 0, stderr: '' };
  } catch (err) {
    return { code: typeof err.code === 'number' ? err.code : -1, stderr: String(err.stderr || err.message || '').trim() };
  }
}

/** Write a buffer to a blob and return its sha. */
export async function hashObject(cwd, buf) {
  return (await gitInput(cwd, ['hash-object', '-w', '--stdin'], buf)).trim();
}

/** `main` for a directory, whether that directory is the checkout or a worktree of it. */
export async function mainCheckout(dir) {
  const common = (await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  return path.dirname(common);
}

/**
 * A flat tree from `[name, Buffer]` pairs.
 *
 * Flat on purpose: `mktree` reads one line per entry and does not recurse, and every
 * payload stored this way so far is a handful of files in one directory. A nested
 * tree would mean building subtrees bottom-up, which is worth doing the day
 * something needs it and not before.
 */
export async function writeTree(cwd, entries) {
  const lines = [];
  for (const [name, buf] of entries) {
    const sha = await hashObject(cwd, buf);
    lines.push(`100644 blob ${sha}\t${name}`);
  }
  return (await gitInput(cwd, ['mktree'], lines.join('\n') + '\n')).trim();
}

/**
 * Many blobs in one process, shas back in the order the buffers went in.
 *
 * `hashObject` is a process per blob, which is nothing for the handful of files the
 * other payloads here carry and is most of a minute for a store of a thousand notes being
 * rewritten into one blob each (bc-u1ltu.1). `--stdin-paths` takes one path per line and
 * answers one sha per line, so the buffers go through a scratch directory that is gone
 * before this returns. `--no-filters` because these bytes are the payload exactly: no
 * attribute or line-ending rule of the repo they happen to sit in gets a say in them.
 */
export async function hashObjects(cwd, bufs) {
  if (!bufs.length) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-blobs-'));
  try {
    const files = bufs.map((buf, i) => {
      const file = path.join(dir, String(i));
      fs.writeFileSync(file, buf);
      return file;
    });
    const out = await gitInput(cwd, ['hash-object', '-w', '--no-filters', '--stdin-paths'], files.join('\n') + '\n');
    const shas = out.split('\n').filter(Boolean);
    if (shas.length !== bufs.length) throw new Error(`git hash-object: ${shas.length} shas for ${bufs.length} blobs`);
    return shas;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A tree from rows that already name their objects — `{ mode, type, sha, name }`.
 *
 * `writeTree` hashes its payloads and can only say "blob"; this is the half that can
 * point at an existing blob without rewriting it, and at a subtree. That is what lets a
 * store of one blob per entry change one entry and carry the other thousand across by
 * sha (bc-u1ltu.1). `mktree` sorts the rows itself, so the order here does not matter.
 */
export async function mkTree(cwd, rows) {
  const lines = rows.map((r) => `${r.mode} ${r.type} ${r.sha}\t${r.name}`);
  return (await gitInput(cwd, ['mktree'], lines.length ? lines.join('\n') + '\n' : '')).trim();
}

/** The rows of a tree (a ref, a commit, `ref:dir` or a tree sha), or `[]` if it is not there. */
export async function lsTree(cwd, treeish) {
  const out = await ok(git(cwd, ['ls-tree', '-z', treeish]));
  if (!out) return [];
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [mode, type, sha] = line.slice(0, tab).split(' ');
      return { mode, type, sha, name: line.slice(tab + 1) };
    });
}

/**
 * Many blobs' contents from one `cat-file --batch`, as a Map of sha to Buffer.
 *
 * The read half of `hashObjects`, and for the same reason: loading a thousand notes as a
 * thousand `cat-file -p` processes is the cost a per-note store must not charge the one
 * caller that genuinely wants every body. A sha git does not have is simply absent from
 * the answer ("<sha> missing"), which a caller reads as it reads any other miss.
 */
export async function readBlobs(cwd, shas) {
  const found = new Map();
  const want = [...new Set(shas)];
  if (!want.length) return found;
  const buf = await gitPipe(cwd, ['cat-file', '--batch'], want.join('\n') + '\n');
  let at = 0;
  while (at < buf.length) {
    const nl = buf.indexOf(0x0a, at);
    if (nl < 0) break;
    const header = buf.subarray(at, nl).toString('utf8').split(' ');
    at = nl + 1;
    if (header[1] === 'missing' || header.length < 3) continue;
    const size = Number(header[2]);
    found.set(header[0], buf.subarray(at, at + size));
    at += size + 1;
  }
  return found;
}

/** The commit a ref points at, or null if the ref does not exist yet. */
export async function refTip(cwd, ref) {
  return (await ok(git(cwd, ['rev-parse', '--verify', '--quiet', ref])))?.trim() || null;
}

/* ------------------------------------------------- the lock nobody is holding */

/**
 * How long a git lock must have sat untouched before it is treated as abandoned.
 *
 * Every write through this module is a handful of milliseconds, capped at the 30s
 * timeout above, so nothing here can legitimately hold a lock for ten minutes. What
 * can is a person running `git commit` by hand in the same directory, or a process
 * that died mid-write and never got to clean up after itself.
 */
export const STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * Does this failure look like a lock, whoever holds it?
 *
 * Matched on git's own words rather than on an exit code, because every one of these
 * arrives here as the first line of stderr through `git()`. Covers both a real
 * lockfile still sitting on disk ("Unable to create ... File exists") and the wording
 * `update-ref` uses to say a compare-and-swap did not match ("cannot lock ref ... but
 * expected") — the two read identically to a caller, and only `clearAbandonedLocks`
 * below tells them apart, by whether an actual `*.lock` file is there to clear.
 */
const LOCK_FAILURE = /cannot lock ref|Unable to create '[^']*\.lock'|\.lock': File exists|index\.lock/i;

/**
 * Every `*.lock` git could be holding in this git directory, as paths relative to it.
 *
 * The top of the git directory (`index.lock`, `HEAD.lock`, `config.lock`,
 * `packed-refs.lock`) and everything under `refs/`, which is where every ref update —
 * `refs/heads/main` as much as `refs/beadcause/<topic>` — takes its lock. Deliberately
 * *not* `objects/`: the locks in there belong to `gc` and to packing, which have their
 * own recovery and are nothing to do with a commit that cannot land.
 */
function lockFiles(gitDir) {
  const out = [];
  const scan = (rel) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(gitDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const at = rel ? `${rel}/${entry.name}` : entry.name;
      // Only the `refs/` walk recurses; at the top level a directory is skipped.
      if (entry.isDirectory()) {
        if (rel) scan(at);
      } else if (entry.name.endsWith('.lock')) out.push(at);
    }
  };
  scan('');
  scan('refs');
  return out;
}

/**
 * Where to look for `lsof`, in order — and why not simply `lsof`.
 *
 * bc-xl7n.109. Asked for by name, `execFile` resolves it from `PATH`, and on macOS the
 * binary is at **`/usr/sbin/lsof`** — there is no `/usr/bin/lsof`. The daemon's `PATH`
 * comes from its launchd plist and has no `/usr/sbin` in it, so in the daemon every
 * call threw `ENOENT`, the search below returned "I could not tell", and every lock —
 * on `HEAD` and on `refs/beadcause/*` alike — was left alone for ever. It was invisible
 * because an *interactive* shell does have `/usr/sbin`, so anyone testing the fix by
 * hand watched it work; the daemon was the only place it ran and the only place it
 * failed. So the search is by absolute path first and `PATH` only as a fallback, which
 * is the one form that does not depend on who started the process.
 *
 * `BEADCAUSE_LSOF` names one binary and skips the search, for a machine that keeps it
 * somewhere else — and it is what a suite points at nothing to reach the
 * genuinely-missing branch below.
 */
function lsofCandidates() {
  const named = process.env.BEADCAUSE_LSOF;
  return named ? [named] : ['/usr/sbin/lsof', '/usr/bin/lsof', 'lsof'];
}

/** Said once per process, not once per lock — see the `console.error` below. */
let saidNoLsof = false;

/**
 * Is any process holding this file open? — the question a lock file cannot answer itself.
 *
 * git's lockfile API keeps the fd open for the whole life of the lock, so a live holder
 * is visible to `lsof` and a dead one is not. Nothing else can tell them apart: the file
 * records no pid, and a ref lock is zero bytes for most of its life anyway.
 *
 * Fails *closed*. What comes back is "I could not tell" whether that is because `lsof`
 * said nobody holds it (real answer: `[]`) or because `lsof` could not be run at all
 * (`null`) — and `null` has to mean "leave it alone", because the alternative is
 * deleting a lock out from under a live writer on the strength of a missing binary.
 * The missing-binary case says so out loud, once, rather than going on looking exactly
 * like the lock itself is the problem.
 */
async function heldBy(file) {
  const candidates = lsofCandidates();
  for (const lsof of candidates) {
    try {
      const { stdout } = await run(lsof, ['-t', '--', file], { encoding: 'utf8', timeout: 10000 });
      return stdout.trim() ? stdout.trim().split('\n') : [];
    } catch (err) {
      // Exit 1 with nothing on stdout is lsof's "no process has this open", which is the
      // whole point of asking.
      if (err?.code === 1 && !String(err.stdout || '').trim()) return [];
      // Not there — try the next place it might be. Everything else — a timeout, a
      // signal, a permissions refusal — is genuinely unknown and stops the search.
      if (err?.code === 'ENOENT') continue;
      return null;
    }
  }
  if (!saidNoLsof) {
    saidNoLsof = true;
    console.error(
      `[beadcause] git lock: cannot tell whether a lock still has an owner — no lsof at ` +
        `${candidates.join(', ')}. Abandoned locks will be left in place and every write ` +
        `through them will keep failing until one is removed by hand.`
    );
  }
  return null;
}

/**
 * Remove the locks behind a failed write that no longer have an owner, and name them.
 *
 * Shared by every ref writer in this module and by `lib/commonrepo.js`'s own snapshot
 * `commit()`, which is the point: bc-xl7n.79 fixed this for the config repo's `HEAD`
 * and bc-xl7n.93 is the same failure one door along, on `refs/beadcause/<topic>` — a
 * `git` that dies mid `update-ref` leaves a lock file with no owner, and every
 * subsequent write to that one ref fails identically and forever. One implementation
 * here means both doors get the same recovery rather than two copies drifting apart.
 *
 * Both tests have to pass: older than `STALE_LOCK_MS`, and open in no process. A young
 * lock is an ordinary race between two writers and is left alone; a lock `lsof` cannot
 * speak for is left too, on the fail-closed rule `heldBy` documents. Only a failure
 * that looks like a lock (`LOCK_FAILURE`) asks at all — a healthy write never runs any
 * of this — and in particular a genuine compare-and-swap loss (someone else's write
 * landed first) leaves no `*.lock` file on disk for this to find, so it clears nothing
 * and the caller's ordinary retry-against-a-fresh-tip is what runs instead.
 */
export async function clearAbandonedLocks(cwd, err) {
  if (!LOCK_FAILURE.test(String(err?.message || ''))) return [];
  const gitDir = (await ok(git(cwd, ['rev-parse', '--absolute-git-dir'])))?.trim() || path.join(cwd, '.git');
  const cutoff = Date.now() - STALE_LOCK_MS;
  const cleared = [];
  for (const rel of lockFiles(gitDir)) {
    const file = path.join(gitDir, rel);
    try {
      if (fs.statSync(file).mtimeMs > cutoff) continue;
    } catch {
      continue;
    }
    const holders = await heldBy(file);
    if (holders === null || holders.length) continue;
    try {
      fs.rmSync(file);
      cleared.push(rel);
    } catch {
      // Somebody else got there first, or it is not ours to remove. Either way the
      // retry below is no worse off than the attempt that failed.
    }
  }
  return cleared;
}

/**
 * Append a commit to a ref, or fail if someone else appended first.
 *
 * The compare-and-swap is the whole point: `update-ref <ref> <new> <old>` refuses
 * unless the ref still points where we read it, so two writers cannot lose one
 * another's entry — they get an error and can retry against the new tip. Pass
 * `expect` when the caller already read the tip and built its tree from it, so the
 * check covers the read as well as the write.
 *
 * **The empty `<old>` is not a formality.** It is git's way of saying "and the ref
 * must not exist", and leaving the argument off instead means "overwrite whatever is
 * there". Those differ in exactly one case — the very first write to a ref — and
 * that is the case where every writer reads `null` at once and all of them think
 * they are creating it. Omitting it made six concurrent posts to a new topic land as
 * one surviving commit, five silently lost, with no error anywhere. So the old value
 * is always passed, and "nothing" is spelled `''`.
 *
 * **One retry, and only ever after clearing a lock nothing was holding.** bc-xl7n.93:
 * a `git` that died mid `update-ref` on this exact ref leaves a `*.lock` file with no
 * owner, and without this every write to that one topic would fail the same way for
 * ever — and every `cas()` loop above this call (lib/memory.js) reads that as "somebody
 * else's write landed first" and spins uselessly against a race that was never real.
 * `clearAbandonedLocks` tells the two apart; a genuine CAS loss leaves no lock file
 * here to find, so this rethrows unchanged and the caller's own retry is what runs.
 */
export async function commitToRef(cwd, ref, tree, message, { expect = undefined } = {}) {
  const parent = expect === undefined ? await refTip(cwd, ref) : expect;
  const commit = (await git(cwd, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message])).trim();
  try {
    await git(cwd, ['update-ref', ref, commit, parent || '']);
  } catch (err) {
    const cleared = await clearAbandonedLocks(cwd, err);
    if (!cleared.length) throw err;
    console.error(
      `[beadcause] git lock: removed ${cleared.join(', ')} — abandoned, no process holding it, ` +
        `untouched for over ${Math.round(STALE_LOCK_MS / 60000)} minutes; retrying the write to ${ref}`
    );
    await git(cwd, ['update-ref', ref, commit, parent || '']);
  }
  return { commit, parent };
}

/**
 * Append a commit to each of several refs at once — all of them or none.
 *
 * `commitToRef`'s compare-and-swap, for a write that has to move two refs together: a note
 * archived (bc-u1ltu.4) leaves the live ref and lands on the archive ref, and doing that as
 * two `update-ref`s would leave a window — or, after a crash, a store — where the note is
 * on both or on neither. `update-ref --stdin` applies every line in one transaction and
 * refuses the lot if any ref has moved from the value it was read at.
 *
 * `moves` is `[{ ref, tree, message, expect }]`, `expect` the tip each tree was built from
 * (null for a ref that must not exist yet). Returns the commits in the same order.
 */
export async function commitToRefs(cwd, moves) {
  const commits = [];
  for (const m of moves) {
    const parent = m.expect || null;
    commits.push((await git(cwd, ['commit-tree', m.tree, ...(parent ? ['-p', parent] : []), '-m', m.message])).trim());
  }
  const zero = '0'.repeat(40);
  const lines = moves.map((m, i) => `update ${m.ref} ${commits[i]} ${m.expect || zero}`);
  await gitInput(cwd, ['update-ref', '--stdin'], `${lines.join('\n')}\n`);
  return commits;
}

/** One file out of a ref's tree, or null if either is missing. */
export async function readRefFile(cwd, ref, file) {
  return await ok(git(cwd, ['cat-file', '-p', `${ref}:${file}`]));
}

/** The names in a ref's tree, or `[]` if the ref does not exist yet. */
export async function listRefTree(cwd, ref) {
  const out = await ok(git(cwd, ['ls-tree', '--name-only', ref]));
  return out ? out.split('\n').filter(Boolean) : [];
}

/** A ref's commits, newest first, as `{commit, at, subject}`. */
export async function refHistory(cwd, ref, { limit = 50 } = {}) {
  const log = await ok(git(cwd, ['log', '--format=%H%x00%aI%x00%s', `--max-count=${limit}`, ref]));
  if (!log) return [];
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [commit, at, subject] = line.split('\0');
      return { commit, at, subject };
    });
}

/**
 * How many commits a ref has, without reading any of them.
 *
 * `refHistory` would answer this too, and answering it that way is how a count
 * silently becomes a cap: the caller passes `limit`, the store passes it, and a store
 * with 244 entries reports 50. `rev-list --count` has no limit to get wrong, and a ref
 * that does not exist is 0 rather than an error — an agent that has never written
 * anything is exactly the case the count is being taken for.
 */
export async function refCount(cwd, ref) {
  const out = await ok(git(cwd, ['rev-list', '--count', ref]));
  const n = Number(String(out || '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** A commit's full message body — where an amendment keeps its justification. */
export async function readMessage(cwd, commit) {
  return (await ok(git(cwd, ['log', '-1', '--format=%B', commit])))?.replace(/\n+$/, '') ?? null;
}

/**
 * Remove a ref, and only if it still points where the caller last looked.
 *
 * The mirror of `commitToRef`'s compare-and-swap, and it exists for the same race in the
 * one place a payload ref is *consumed* rather than appended to: `archiveSession` folds a
 * staged debrief into a session's archive and then drops the staging ref, and an agent
 * that wrote one more line in between must not have it deleted out from under it.
 * `expect` is what makes that a lost race rather than a lost memory — git refuses, and
 * the caller reads the ref again instead of silently taking half of it.
 *
 * Omitting `expect` is an unconditional delete, which is the honest spelling of "remove
 * this whatever it says" and is what a human clearing a stuck ref wants. The return is a
 * boolean rather than a throw because both answers are ordinary here: `false` is a ref
 * that was already gone *or* a swap that lost, and the caller's next move — go and look
 * again — is the same for both.
 */
export async function deleteRef(cwd, ref, { expect = undefined } = {}) {
  const args = ['update-ref', '-d', ref, ...(expect === undefined ? [] : [expect || ''])];
  return (await ok(git(cwd, args))) !== null;
}

/**
 * The files one merge commit changed — what an evidence edge is built from.
 *
 * `--first-parent`, so a merge reports the branch it brought in rather than everything
 * both sides touched since they diverged; `--name-only` with an empty `--format` so the
 * output is paths and nothing else.
 *
 * It lives here rather than beside either index because it is a git primitive with no
 * opinion about what it is being asked for: lib/reqindex.js re-exports it for its own
 * callers, lib/controllanding.js asks for it directly, and neither of those two layers
 * needs to import the other to find out what a commit touched. `max` is a bound rather
 * than a truncation with meaning — a merge that touched four hundred files has said what
 * it can, and forty is what both indexes keep per edge.
 */
export async function filesInMerge(dir, sha, { max = 40 } = {}) {
  const out = await ok(git(dir, ['show', '--first-parent', '--name-only', '--format=', sha]));
  if (!out) return [];
  const files = [];
  for (const line of out.split('\n')) {
    const file = line.trim();
    if (!file || files.includes(file)) continue;
    files.push(file);
    if (files.length >= max) break;
  }
  return files;
}
