/**
 * Is a worktree still being written to, or is it safe to take over — one call, not four
 * independently-assembled recipes.
 *
 * bc-xl7n.158: four separate delmar worker windows (dv-b5d.60.1 x2, dv-b5d.60.2,
 * dv-b5d.60.6) each hand-built the same answer from `ps`, `git log`/`status` and file
 * mtimes, and the fourth read the session record and transcript tail and reached the
 * *opposite* verdict from the first three — idle vs. still-writing — because it used
 * different evidence. This is the shared, tested version.
 *
 * ## What decides the verdict, and why
 *
 * A worktree with **no live session** whose `cwd` is inside it is `abandoned` — whatever
 * its git tree looks like, there is nobody left to ask and nothing here is going to
 * change on its own. This is checked by `cwd`, not by matching a bead id in a session's
 * argv (`lib/claude.js`'s `linesNameBead`/`isWorkerLine` would both miss an
 * interactively-started `claude` with no worker brief on its command line at all — see
 * the acceptance criteria on bc-xl7n.158).
 *
 * With a live session present: any of them `busy` is `still-writing` outright — a model
 * mid-turn has not necessarily flushed a file write yet, so file mtimes would under-report
 * it. Otherwise it comes down to the most recently written file in the tree: inside
 * `--since` minutes of now is `still-writing`, older is `idle` (safe to take over).
 *
 * ahead/behind against `main` and the modified/untracked counts are reported alongside
 * the verdict but do not drive it — they are the numbers a session taking over would want
 * to see next, not evidence this module weighs itself.
 *
 * Entirely read-only: nothing here runs `git worktree lock`, writes a file, or touches
 * the tree it is asked about.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { liveSessions } from './claude.js';
import { transcriptFile } from './transcript.js';

const run = promisify(execFile);

/** `path.resolve`, but through symlinks — same reasoning as `lib/tidy.js`'s `realPath`:
 *  git reports worktree paths fully resolved, and a session's `cwd` routinely keeps a
 *  symlinked prefix (`/var/folders/…` vs `/private/var/folders/…`) that would otherwise
 *  make "is this session's cwd under that worktree" answer no for every one of them. Not
 *  imported from `lib/tidy.js` because that file pulls in the whole retirement-sweep
 *  machinery for one three-line helper. */
export const realPath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

const under = (p, root) => p === root || p.startsWith(root + path.sep);

/**
 * `git worktree list --porcelain`, one row per worktree, with the lock reason kept
 * verbatim.
 *
 * `lib/tidy.js`'s own `parseWorktrees` collapses `locked <reason>` to a bare boolean,
 * which is enough for a retirement sweep that only asks "is it locked" but not for this,
 * where the reason is where the holder's pid actually lives (`git worktree lock . --reason
 * "claude session <name> (pid <N> start <date>)"`, per `lib/session.js`'s own resolver
 * brief — the harness locks every worktree it creates the same way).
 */
export function parseWorktreeRows(porcelain) {
  const out = [];
  let cur = null;
  for (const line of String(porcelain || '').split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice(9).trim(), branch: null, detached: false, locked: false, lockReason: '' };
      out.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      cur.detached = true;
    } else if (line === 'locked') {
      cur.locked = true;
    } else if (line.startsWith('locked ')) {
      cur.locked = true;
      cur.lockReason = line.slice(7).trim();
    }
  }
  return out;
}

/** Every live worktree this repo's git knows about, from wherever the caller's `cwd` is
 *  — `git worktree list` reports the whole set regardless of which worktree of the repo
 *  you run it from, because they share one git dir (see
 *  `[[a-worktree-aware-bin-resolves-root-from-cwd-not-here]]`). Best-effort: not a git
 *  repo, or no `git` on `PATH`, is an empty list rather than a thrown error. */
export async function listWorktrees(cwd = process.cwd()) {
  try {
    const { stdout } = await run('git', ['worktree', 'list', '--porcelain'], { cwd, maxBuffer: 8 * 1024 * 1024 });
    return parseWorktreeRows(stdout);
  } catch {
    return [];
  }
}

/**
 * The pid a lock reason names, or `null` when it names none.
 *
 * Matches the shape `lib/session.js`'s resolver brief actually writes (`pid <N>`) rather
 * than parsing the whole sentence — a hand-written `git worktree lock` reason from before
 * this convention existed, or one written by a person, is answered honestly as "no pid in
 * this reason" rather than guessed at.
 */
export function lockPid(reason) {
  const m = /\bpid\s+(\d+)\b/.exec(String(reason || ''));
  return m ? Number(m[1]) : null;
}

/** Is this pid still running? Best-effort, like every other liveness check in this repo —
 *  see `lib/claude.js`'s own private `alive()`, not exported, so it is re-declared here
 *  rather than reached into. EPERM counts as alive: the process exists, it just belongs
 *  to someone else. */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

/**
 * The worktree row a name or path argument refers to.
 *
 * A path that exists on disk wins outright, matched against every row by its resolved
 * real path — this is what lets an absolute path be handed straight to the tool even for
 * a worktree git itself does not know about (a bare directory copy, say), returned with
 * `unregistered: true` so a caller can tell the two cases apart. Otherwise the argument is
 * matched against every worktree's own directory name first (`.claude/worktrees/<name>`
 * is what a session actually calls a worktree by), then its branch name. `null` when
 * nothing matches — guessing which worktree was meant is worse than saying so.
 */
export function resolveWorktree(rows, arg, { exists = fs.existsSync } = {}) {
  if (!arg) return null;
  if (exists(arg)) {
    const target = realPath(arg);
    const known = rows.find((r) => realPath(r.path) === target);
    return known || { path: target, branch: null, detached: false, locked: false, lockReason: '', unregistered: true };
  }
  const byName = rows.find((r) => path.basename(r.path) === arg);
  if (byName) return byName;
  return rows.find((r) => r.branch === arg) || null;
}

/**
 * Every live Claude Code session whose `cwd` is this worktree or somewhere under it.
 *
 * By `cwd`, not by matching the worktree's bead id (or anything else) in a session's
 * argv — the acceptance criteria this module was filed against names exactly the gap that
 * argv matching leaves: an interactively-started `claude`, with no worker brief and so no
 * bead id anywhere on its command line, is still a live writer in the tree and must not
 * read as `abandoned`.
 */
export function sessionsIn(sessions, worktreePath) {
  const root = realPath(worktreePath);
  return sessions.filter((s) => s.cwd && under(realPath(s.cwd), root));
}

/**
 * A session's transcript, and how long ago it last grew.
 *
 * The transcript file is appended to on every turn, so its own mtime is a cheap, honest
 * proxy for "when did this session last do anything" without parsing JSONL to find the
 * newest entry's own timestamp — the file's mtime *is* that timestamp, to the precision
 * anything here needs.
 */
export function transcriptAge(cfg, session, now = Date.now()) {
  const file = transcriptFile(cfg, session);
  if (!file) return { file: null, ageMs: null };
  try {
    return { file, ageMs: now - fs.statSync(file).mtimeMs };
  } catch {
    return { file, ageMs: null };
  }
}

/**
 * ahead/behind of `ref` (default `HEAD`) against `base` — `git rev-list --left-right
 * --count`, the same call `lib/quoted.js`'s `checkBranch` makes, returned as the two raw
 * numbers rather than a state label because this module reports them rather than judging
 * by them. `null`/`null` when either ref cannot be resolved (a fresh worktree whose base
 * branch was deleted upstream, say) — never thrown.
 */
export async function aheadBehind(cwd, base, ref = 'HEAD') {
  try {
    const { stdout } = await run('git', ['rev-list', '--left-right', '--count', `${base}...${ref}`], { cwd });
    const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
    return { ahead, behind };
  } catch {
    return { ahead: null, behind: null };
  }
}

/**
 * Modified and untracked file counts from `git status --porcelain`.
 *
 * `??` is untracked; every other line is a change git already knows about (staged or
 * not — this module reports "is the tree dirty", not the finer-grained staged/unstaged
 * split, because nothing downstream of it needs that distinction). `null`/`null` when the
 * status could not be read at all, kept distinct from the real answer `0`/`0`.
 */
export async function statusCounts(cwd) {
  try {
    const { stdout } = await run('git', ['status', '--porcelain'], { cwd, maxBuffer: 8 * 1024 * 1024 });
    let modified = 0;
    let untracked = 0;
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      if (line.startsWith('??')) untracked += 1;
      else modified += 1;
    }
    return { modified, untracked };
  } catch {
    return { modified: null, untracked: null };
  }
}

/**
 * The most recently written file under `root`, skipping `.git` and `node_modules`.
 *
 * `node_modules` is excluded on purpose: in every worktree here it is a symlink into the
 * main checkout (`[[fresh-worktree-has-no-node-modules]]`), so its files' mtimes belong
 * to whoever last ran `npm install` there, not to anyone writing in *this* worktree —
 * counting them would make an untouched worktree look freshly written the moment anybody,
 * anywhere, reinstalled dependencies. `null` for an empty tree (nothing to report) rather
 * than a made-up "since forever".
 */
export function newestWrite(root, { skip = new Set(['.git', 'node_modules', '.claude']) } = {}) {
  let best = null;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!best || st.mtimeMs > best.mtimeMs) best = { path: path.relative(root, full) || e.name, mtimeMs: st.mtimeMs };
    }
  };
  walk(root);
  return best;
}

/**
 * `still-writing`, `idle` or `abandoned` — see the module doc for the full reasoning.
 *
 * `sinceMs` is the `--since` window (default 15 minutes, in milliseconds by the time it
 * reaches here). `sessions` must already be narrowed to this one worktree (`sessionsIn`).
 */
export function verdictFor({ sessions, newest, sinceMs, now = Date.now() }) {
  if (!sessions.length) {
    return { verdict: 'abandoned', reason: 'no live claude session has this worktree as its cwd' };
  }
  const busy = sessions.find((s) => s.status === 'busy');
  if (busy) {
    return { verdict: 'still-writing', reason: `pid ${busy.pid} is busy` };
  }
  if (newest) {
    const ageMs = now - newest.mtimeMs;
    if (ageMs <= sinceMs) {
      return {
        verdict: 'still-writing',
        reason: `${newest.path} was written ${Math.round(ageMs / 1000)}s ago, inside the ${Math.round(sinceMs / 60000)}-minute window`,
      };
    }
    return {
      verdict: 'idle',
      reason: `a live session is present, idle, and nothing has been written in ${Math.round(ageMs / 60000)} minute(s)`,
    };
  }
  return { verdict: 'idle', reason: 'a live session is present, idle, and the tree has no files to have written' };
}

/**
 * The whole report for one worktree — everything `bin/b7e-builder` prints, assembled so a
 * test (or another caller) can get the same object without spawning the CLI.
 *
 * `now`/`ps` are injection points for tests; every other input is read fresh so two calls
 * in a row never disagree about what changed in between.
 */
export async function buildReport(cfg, arg, { sinceMinutes = 15, base = 'main', cwd = process.cwd(), now = Date.now() } = {}) {
  const rows = await listWorktrees(cwd);
  const row = resolveWorktree(rows, arg);
  if (!row) return { found: false, arg };

  const sessions = liveSessions(cfg);
  const inTree = sessionsIn(sessions, row.path);
  const sessionRows = inTree.map((s) => ({
    pid: s.pid,
    status: s.status,
    startedAt: s.startedAt,
    ...transcriptAge(cfg, s, now),
  }));

  const pid = lockPid(row.lockReason);
  const lock = {
    locked: row.locked,
    reason: row.lockReason || null,
    pid,
    pidAlive: pid === null ? null : alive(pid),
  };

  const [ab, counts] = await Promise.all([aheadBehind(row.path, base), statusCounts(row.path)]);
  const newest = newestWrite(row.path);
  const sinceMs = Math.max(0, Number(sinceMinutes) || 0) * 60 * 1000;
  const { verdict, reason } = verdictFor({ sessions: sessionRows, newest, sinceMs, now });

  return {
    found: true,
    path: row.path,
    branch: row.branch,
    unregistered: Boolean(row.unregistered),
    lock,
    sessions: sessionRows,
    ahead: ab.ahead,
    behind: ab.behind,
    modified: counts.modified,
    untracked: counts.untracked,
    newest,
    sinceMinutes,
    verdict,
    reason,
  };
}
