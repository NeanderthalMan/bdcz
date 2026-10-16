/**
 * A dead attempt's worktree, read from the inside — what it holds uncommitted, and
 * whether anybody is still in it.
 *
 * bc-dgx7.134. `b7e-prior` (lib/prior.js) already answers "where is the work sitting":
 * every worktree and branch owning a bead's tag, live or retired, pushed or not, ahead
 * of main or not. What it cannot say is what is *in* the tree right now — and in every
 * session that hand-rolled this question (bc-xl7n.137, bc-dgx7.129, bc-dgx7.67,
 * bc-xl7n.150; see this bead's own filed description for all four), the work an earlier
 * attempt left behind was uncommitted, so nothing in commit-land showed it at all.
 *
 * This module answers three questions about one bead's worktrees, each already asked by
 * hand at least once: is anybody still in it (a lock's pid, resolved against `ps`, and a
 * live Claude session whose `cwd` is inside it — either one answers "occupied"); is it
 * frozen (unoccupied, and nothing under it has moved in `QUIET_MINUTES`, the same
 * threshold `lib/tidy.js`'s own sweep uses for the identical question); and what is
 * sitting there uncommitted (`git status --short`, plus an applicable patch for it).
 *
 * ## What it reuses
 *
 * - **`branchesFor`** (lib/prior.js) for the worktree/branch discovery itself — same
 *   bead-tag ownership rule, same live/retired classification, so a worktree salvage
 *   finds is the same worktree prior finds.
 * - **`parseWorktrees`, `lastTouched`, `QUIET_MINUTES`** (lib/tidy.js) — the lock
 *   reason text and the "has anything moved" walk the retirement sweep already does.
 * - **`liveSessions`** (lib/claude.js) — the same `~/.claude/sessions/*.json` match by
 *   `cwd` lib/siblings.js uses, for the case a session is inside a worktree it never
 *   locked (entered by absolute path rather than `EnterWorktree`).
 *
 * ## Reading the lock, not just its boolean
 *
 * `EnterWorktree` and the resolver both write a lock reason of the shape `claude
 * session <name> (pid <n> start <date>)` or `resolver pid <n> #<pr>` — `lockPidOf`
 * below pulls the first `pid <n>` out of either, the same rule
 * `~/.claude/hooks/worktree-guard.sh`'s `lock_pid` uses so a session reading this repo
 * from its own tools and one reading it from this module agree. A pid that `ps` no
 * longer knows is exactly the STALE case that hook already prints on every
 * `SessionStart` — prunable, and the tree under it may still hold real work (see the
 * repo notes `a-dead-attempts-work-is-uncommitted-in-its-worktree` and
 * `a-stale-worktree-lock-can-hold-finished-unmerged-work`).
 *
 * ## The uncommitted patch
 *
 * `git diff HEAD` covers staged and unstaged changes to tracked files in one call.
 * Untracked files never appear in it, so each one gets its own `git diff --no-index`
 * against `/dev/null` — a real patch, without touching the worktree's index (no `git
 * add -N`, which this module must never do: it writes nothing, per this bead's own
 * acceptance criteria).
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { git, ok, mainCheckout } from './gitref.js';
import { branchesFor } from './prior.js';
import { parseWorktrees, lastTouched, QUIET_MINUTES } from './tidy.js';
import { liveSessions } from './claude.js';
import { pickBase } from './notinmain.js';
import * as pr from './pr.js';

const run = promisify(execFile);

/** The `pid <n>` a lock reason names, from either writer this repo has. Null if none. */
export function lockPidOf(reason) {
  const text = String(reason || '');
  const at = text.indexOf('pid ');
  if (at === -1) return null;
  const tok = text.slice(at + 4).split(/[\s)]/)[0];
  return /^[0-9]+$/.test(tok) ? Number(tok) : null;
}

/** Is this pid still running? Signal 0, same rule lib/claude.js's own liveness check uses. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

const realPath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/** Does `dir` exist on disk right now? A worktree registration can outlive its tree. */
function onDisk(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** `git status --short`, parsed into `{code, path}` rows. `[]` for a clean tree or none readable. */
async function statusShort(dir) {
  const out = await ok(git(dir, ['status', '--short', '--untracked-files=all']));
  if (!out) return [];
  const rows = [];
  for (const line of String(out).split('\n')) {
    if (!line) continue;
    rows.push({ code: line.slice(0, 2), path: line.slice(3).replace(/^"|"$/g, '') });
  }
  return rows;
}

/**
 * The applicable patch for everything uncommitted in `dir` — tracked changes plus
 * untracked file content, neither of which touches the worktree's own index.
 *
 * `scope`, when given, is a single repo-relative path: only that file's changes are
 * included, tracked or untracked.
 */
export async function uncommittedDiff(dir, { scope } = {}) {
  const parts = [];
  const tracked = await ok(git(dir, scope ? ['diff', 'HEAD', '--', scope] : ['diff', 'HEAD']));
  if (tracked) parts.push(String(tracked));

  const rows = await statusShort(dir);
  for (const row of rows) {
    if (row.code !== '??') continue;
    if (scope && row.path !== scope) continue;
    // --no-index bypasses the index entirely (that is the point of the flag), so this
    // reads the untracked file's content into a diff without staging it. Exit code 1
    // means "they differ", which for /dev/null vs a real file is every time — not an
    // error.
    // eslint-disable-next-line no-await-in-loop -- one untracked file's patch at a time
    const patch = await run('git', ['diff', '--no-index', '--', '/dev/null', row.path], {
      cwd: dir,
      maxBuffer: 16 * 1024 * 1024,
    }).then(
      (r) => r.stdout,
      (err) => (typeof err.stdout === 'string' ? err.stdout : '')
    );
    if (patch) parts.push(patch);
  }
  return parts.join('');
}

const NUM_RE = /^(-|\d+)\t(-|\d+)\t(.*)$/;

/** `git diff <args> --numstat` as `Map<path, {added, deleted}>`; `null` counts for a binary file. */
async function numstat(dir, args) {
  const out = await ok(git(dir, ['diff', ...args, '--numstat']));
  const map = new Map();
  for (const line of String(out || '').split('\n')) {
    const m = NUM_RE.exec(line);
    if (!m) continue;
    map.set(m[3], { added: m[1] === '-' ? null : Number(m[1]), deleted: m[2] === '-' ? null : Number(m[2]) });
  }
  return map;
}

/** Line count of an untracked file (capped read); null if it is unreadable or binary. */
function linesOf(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length > 8 * 1024 * 1024 || buf.includes(0)) return null;
    const text = buf.toString('utf8');
    return text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  } catch {
    return null;
  }
}

/**
 * `git status --short` rows, each carrying its +/- counts: tracked paths from `git diff
 * HEAD --numstat`, untracked ones from the file itself. `stagedOnly` marks a path added
 * to the index that no commit holds — the riskiest state, since nothing but the index
 * has its text — with the counts read from `git diff --cached --numstat`.
 */
async function statusCounted(dir) {
  const rows = await statusShort(dir);
  if (!rows.length) return rows;
  const head = await numstat(dir, ['HEAD']);
  const cached = await numstat(dir, ['--cached']);
  return rows.map((r) => {
    const stagedOnly = r.code[0] === 'A';
    let c = head.get(r.path);
    if (!c && r.code === '??') {
      const n = linesOf(path.join(dir, r.path));
      c = { added: n, deleted: n === null ? null : 0 };
    }
    const out = { ...r, added: c ? c.added : null, deleted: c ? c.deleted : null, stagedOnly };
    if (stagedOnly) {
      const s = cached.get(r.path);
      out.stagedAdded = s ? s.added : null;
      out.stagedDeleted = s ? s.deleted : null;
    }
    return out;
  });
}

const sum = (rows, k) => rows.reduce((n, r) => n + (Number.isInteger(r[k]) ? r[k] : 0), 0);

/** Does a commit off `baseRef` on `branch` name the bead id? The commit trail, not the branch name. */
async function trailNames(main, baseRef, branch, id) {
  if (!baseRef) return false;
  const out = await ok(git(main, ['log', '--fixed-strings', `--grep=${id}`, '--format=%H', '-n', '1', `${baseRef}..${branch}`]));
  return Boolean(out && String(out).trim());
}

const slugOf = (branch) => String(branch || '').replace(/^worktree-/, '');

/**
 * Everything this module knows about one bead's worktrees: for each one, where it is,
 * why it was included, whether anybody is still in it, whether it is frozen, what sits
 * there uncommitted (with +/- counts and the staged-only paths called out), and whether
 * its commits and the tree reach trunk, a branch, a pull request, or nowhere.
 *
 * Discovery (bc-dgx7.173) is wider than the bead's tag in a branch name: a worktree is
 * also included when
 * - `all` is set (every worktree but the main checkout),
 * - `names` holds its directory name or its branch name (either resolves it),
 * - a commit it has off main names the bead id (the commit trail), or
 * - `hints` (the bead's own text and comments) names its directory or branch.
 * `found` on each row says which.
 *
 * `withDiff` also computes `diff` per worktree (optionally scoped to `diffPath`).
 * `patchDir` writes one whole-tree patch per worktree that holds uncommitted work and
 * records it as `patchFile`. `withPrs` looks up pull requests for branches with
 * something at stake.
 */
export async function salvageFor(
  dir,
  id,
  { cfg = {}, withDiff = false, diffPath, all = false, names = [], hints = '', patchDir = null, withPrs = false } = {}
) {
  const main = await mainCheckout(dir);
  const owned = await branchesFor(main, id);
  const sessions = liveSessions(cfg);

  const porcelain = (await ok(git(main, ['worktree', 'list', '--porcelain']))) || '';
  const entries = parseWorktrees(porcelain);
  const baseRef = (await pickBase(main, 'main'))?.ref || null;
  const worktreesRoot = path.resolve(main, '.claude', 'worktrees');
  const retiredRoot = path.resolve(main, '.claude', 'worktrees-retired');
  const under = (p, root) => p === root || p.startsWith(root + path.sep);
  const wanted = new Set((names || []).map(String));
  const hintText = String(hints || '');
  const mainReal = realPath(main);

  const picked = [];
  for (const entry of entries) {
    const abs = path.resolve(entry.path);
    if (realPath(abs) === mainReal) continue;
    const base = path.basename(abs);
    const branch = entry.branch || null;
    const own = owned.find((o) => o.branch === branch && o.worktree);
    let found = null;
    if (own) found = 'bead tag in the branch name';
    else if (wanted.has(base) || (branch && (wanted.has(branch) || wanted.has(slugOf(branch))))) found = 'named on the command line';
    // eslint-disable-next-line no-await-in-loop -- one worktree's commit trail at a time
    else if (branch && (await trailNames(main, baseRef, branch, id))) found = 'a commit off main names the bead';
    else if ((base.length >= 8 && hintText.includes(base)) || (branch && branch.length >= 8 && hintText.includes(branch)))
      found = "the bead's own text names it";
    else if (all) found = '--all';
    if (!found) continue;
    const state = under(abs, worktreesRoot) ? 'live' : under(abs, retiredRoot) ? 'retired' : 'other';
    picked.push({ entry, abs, branch, found, state });
  }

  const rows = [];
  for (const p of picked) {
    const { entry, abs: wtPath, branch, found, state } = p;
    const exists = onDisk(wtPath);

    const lockReason = entry.lockReason || '';
    const lockPid = lockPidOf(lockReason);
    const lockPidAlive = lockPid === null ? null : pidAlive(lockPid);

    const wtReal = exists ? realPath(wtPath) : null;
    const session = wtReal ? sessions.find((s) => s.cwd && realPath(s.cwd) === wtReal) || null : null;

    const occupied = Boolean(session) || lockPidAlive === true;

    let minutesSinceTouch = null;
    if (exists) {
      const touched = lastTouched(wtPath);
      if (touched) minutesSinceTouch = (Date.now() - touched) / 60000;
    }
    const frozen = exists && !occupied && (minutesSinceTouch === null || minutesSinceTouch >= QUIET_MINUTES);

    // eslint-disable-next-line no-await-in-loop -- a worktree at a time
    const status = exists ? await statusCounted(wtPath) : [];
    const stagedOnly = status.filter((s) => s.stagedOnly);
    const added = sum(status, 'added');
    const deleted = sum(status, 'deleted');

    let ahead = null;
    let pushed = null;
    if (branch) {
      if (baseRef) {
        // eslint-disable-next-line no-await-in-loop -- a worktree at a time
        const n = await ok(git(main, ['rev-list', '--count', `${baseRef}..${branch}`]));
        ahead = n === null || n === undefined || String(n).trim() === '' ? null : Number(String(n).trim());
      }
      // eslint-disable-next-line no-await-in-loop -- a worktree at a time
      pushed = Boolean(await ok(git(main, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])));
    }

    let prs = null;
    if (withPrs && branch && ((ahead || 0) > 0 || status.length)) {
      try {
        // eslint-disable-next-line no-await-in-loop -- a worktree at a time
        const avail = await pr.available();
        if (avail.ok) {
          // eslint-disable-next-line no-await-in-loop -- a worktree at a time
          const list = await pr.list(main, { state: 'all', head: branch, limit: 5 });
          prs = list.filter((r) => r.branch === branch).map((r) => ({ number: r.number, state: r.state, url: r.url }));
        }
      } catch {
        prs = null; // unknown, not "none"
      }
    }

    let patch = null;
    // eslint-disable-next-line no-await-in-loop -- a worktree at a time
    if ((withDiff || patchDir) && exists) patch = await uncommittedDiff(wtPath, { scope: withDiff ? diffPath : undefined });
    let patchFile = null;
    if (patchDir && exists && status.length) {
      fs.mkdirSync(patchDir, { recursive: true });
      patchFile = path.join(patchDir, `${id}-${path.basename(wtPath)}.patch`);
      fs.writeFileSync(patchFile, patch || '');
    }

    rows.push({
      branch,
      path: wtPath,
      state,
      found,
      exists,
      locked: Boolean(entry.locked),
      lockReason: lockReason || null,
      lockPid,
      lockPidAlive,
      session: session ? { pid: session.pid, name: session.name, status: session.status } : null,
      occupied,
      minutesSinceTouch,
      frozen,
      status,
      stagedOnly: stagedOnly.map((s) => s.path),
      added,
      deleted,
      ahead,
      pushed,
      prs,
      where: whereIsIt({ status, ahead, pushed, prs, branch }),
      patchFile,
      diff: withDiff ? patch : null,
    });
  }
  const anyWork = rows.some((w) => w.status.length || (w.ahead || 0) > 0);
  return {
    id,
    main,
    worktrees: rows,
    verdict: !rows.length
      ? 'no worktree found'
      : anyWork
        ? 'work found'
        : `nothing to salvage — ${rows.length} worktree${rows.length === 1 ? '' : 's'} read, every one clean with no commit off main`,
  };
}

/** The "trunk, branch, PR, or nowhere" verdict for one worktree. */
function whereIsIt({ status, ahead, pushed, prs, branch }) {
  const parts = [];
  if (status.length) parts.push('uncommitted in the tree only');
  if ((ahead || 0) > 0) {
    const open = (prs || []).find((r) => r.state === 'OPEN');
    const merged = (prs || []).find((r) => r.state === 'MERGED');
    if (merged) parts.push(`${ahead} commit(s) off main, PR #${merged.number} merged`);
    else if (open) parts.push(`${ahead} commit(s) off main, PR #${open.number} open`);
    else if (pushed) parts.push(`${ahead} commit(s) off main on origin/${branch}${prs ? ', no PR' : ', PR unknown'}`);
    else parts.push(`${ahead} commit(s) off main on a local branch only — nowhere else`);
  }
  if (!parts.length) return 'nothing — clean, no commit off main';
  if (status.length && !(ahead > 0)) parts.push('nowhere else');
  return parts.join('; ');
}

/** Where `--patch-dir` writes when given no directory. */
export const defaultPatchDir = (id) => path.join(os.tmpdir(), `b7e-salvage-${id}`);

/** One printed report for one bead's `salvageFor` result. */
export function describeSalvage(found) {
  const lines = [`## ${found.id}`];
  if (!found.worktrees.length) {
    lines.push(`${found.verdict}: no worktree owns this bead. (--all reads every worktree; a name on the command line reads one.)`);
    return lines;
  }
  for (const w of found.worktrees) {
    lines.push(`\n${w.path} (${w.state}, branch ${w.branch || 'detached'}) — found by: ${w.found}`);
    if (!w.exists) {
      lines.push('  directory is gone — registration only');
      continue;
    }
    if (w.session) {
      lines.push(`  occupied — live session pid ${w.session.pid}${w.session.name ? ` "${w.session.name}"` : ''}, ${w.session.status}`);
    } else if (w.lockPid !== null) {
      lines.push(
        w.lockPidAlive
          ? `  occupied — locked by a live pid ${w.lockPid} (${w.lockReason})`
          : `  not occupied — locked, but pid ${w.lockPid} is no longer running (${w.lockReason})`
      );
    } else if (w.locked) {
      lines.push(`  locked (reason unreadable: "${w.lockReason || ''}") — cannot tell if it is live`);
    } else {
      lines.push('  not locked, no live session in it');
    }
    const mins = w.minutesSinceTouch === null ? 'unknown' : `${Math.round(w.minutesSinceTouch)}m`;
    lines.push(`  ${w.frozen ? 'frozen' : 'not frozen'} — last touched ${mins} ago`);
    if (w.status.length) {
      lines.push(`  ${w.status.length} uncommitted file${w.status.length === 1 ? '' : 's'}, +${w.added}/-${w.deleted}:`);
      const cnt = (s) => (s.added === null ? ' (binary)' : ` +${s.added}/-${s.deleted}`);
      if (w.stagedOnly.length) {
        lines.push('    STAGED ONLY — in the index, in no commit:');
        for (const s of w.status.filter((r) => r.stagedOnly)) lines.push(`      ${s.code} ${s.path}${cnt({ added: s.stagedAdded, deleted: s.stagedDeleted })}`);
      }
      for (const s of w.status.filter((r) => !r.stagedOnly)) lines.push(`    ${s.code} ${s.path}${cnt(s)}`);
    } else {
      lines.push('  clean — nothing uncommitted');
    }
    lines.push(`  where it is: ${w.where}`);
    if (w.patchFile) lines.push(`  patch: ${w.patchFile}`);
    if (w.diff) lines.push(`\n${w.diff}`);
  }
  lines.push(`\n${found.verdict}`);
  return lines;
}
