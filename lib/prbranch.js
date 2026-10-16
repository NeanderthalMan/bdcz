/**
 * Which copy of a pull request's branch is newest, and would main merge into it.
 *
 * bc-dgx7.188: five revives of existing pull requests on 2026-10-04 each worked out by
 * hand where the newest copy of the branch was before merging `origin/main` into it,
 * and two got it wrong first — one merged main into a worktree that was 251 commits
 * behind `origin/<branch>`, one resolved a README conflict and only learned at push time
 * that origin held a commit its tree never had. The opposite trap is in the August
 * debriefs: a crashed resolver left 87 and 300 commits of merges on disk that were never
 * pushed, so GitHub's CONFLICTING described a conflict already solved locally.
 *
 * A branch has up to four kinds of copy: what GitHub says the PR head is,
 * `origin/<branch>` after a fetch, the local branch ref, and every worktree with it
 * checked out. They are all just shas; the question is whether one of them contains all
 * the rest. If it does, that is the newest and everything else is behind it. If none
 * does, the branch has DIVERGED and picking one would throw work away, so the answer is
 * "no newest".
 *
 * Reused rather than rewritten: `parseWorktrees` (lib/tidy.js) for the porcelain,
 * `lockPidOf`/`pidAlive` (lib/salvage.js) for lock liveness — the rule
 * `~/.claude/hooks/worktree-guard.sh` uses. Reads only: the one write is `git fetch`,
 * which moves remote-tracking refs and nothing else.
 *
 * Every command it prints uses `git -C <absolute path>`, because the worktree guard
 * refuses a bare reset/merge/push whose cwd could be the wrong checkout.
 */
import { execFile } from 'node:child_process';
import { git, gitCode, ok, mainCheckout } from './gitref.js';
import { gitEnvIn } from './pr.js';
import { parseWorktrees } from './tidy.js';
import { lockPidOf, pidAlive } from './salvage.js';

const SHA_RE = /^[0-9a-f]{40}$/;

/** `git fetch` of the branch and the base into their remote-tracking refs. Never throws. */
export async function fetchBranch(main, branch, base) {
  const spec = (b) => `+refs/heads/${b}:refs/remotes/origin/${b}`;
  const r = await gitCode(main, ['fetch', '--quiet', 'origin', spec(branch), spec(base)], {
    env: await gitEnvIn(main).catch(() => undefined),
  });
  return r.code === 0 ? { ok: true } : { ok: false, reason: r.stderr.split('\n')[0] || `exited ${r.code}` };
}

const shaOf = async (dir, ref) => {
  const out = await ok(git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]));
  const s = String(out || '').trim();
  return SHA_RE.test(s) ? s : null;
};

/** Every worktree with `branch` checked out, with the state that decides whether to trust it. */
async function worktreeCopies(main, branch) {
  const porcelain = (await ok(git(main, ['worktree', 'list', '--porcelain']))) || '';
  const out = [];
  for (const w of parseWorktrees(porcelain)) {
    if (w.branch !== branch) continue;
    const status = (await ok(git(w.path, ['status', '--short', '--untracked-files=no']))) || '';
    const pid = lockPidOf(w.lockReason);
    out.push({
      kind: 'worktree',
      label: `worktree ${w.path}`,
      path: w.path,
      sha: await shaOf(w.path, 'HEAD'),
      dirty: status.split('\n').filter(Boolean).length,
      mergeHead: Boolean(await shaOf(w.path, 'MERGE_HEAD')),
      lock: w.locked ? { pid, alive: pid === null ? null : pidAlive(pid), reason: w.lockReason } : null,
    });
  }
  return out;
}

/**
 * The files `git merge-tree` says a merge of `a` and `b` conflicts on: `[]` when it is
 * clean, `null` when git could not say. Exit 1 is "conflicts" — which `git()` would throw
 * on — and with `--name-only` the lines after the tree oid, up to the first blank, are
 * the conflicted paths.
 */
function mergeConflicts(main, a, b) {
  return new Promise((resolve) => {
    execFile('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', a, b], { cwd: main, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (!err) return resolve([]);
      if (err.code !== 1) return resolve(null);
      const files = [];
      for (const l of String(stdout).split('\n').slice(1)) {
        if (!l) break;
        files.push(l);
      }
      resolve(files);
    });
  });
}

/**
 * Every copy of `branch`, which is newest, and what merging `origin/<base>` into it does.
 *
 * `prSha` is what GitHub says the PR's head is (null when asked about a bare branch).
 * `fetch: false` skips the network, for a test or an offline read; the result says so.
 */
export async function prBranch(dir, { branch, prSha = null, base = 'main', fetch = true } = {}) {
  const main = await mainCheckout(dir);
  const fetched = fetch ? await fetchBranch(main, branch, base) : { ok: false, reason: 'skipped (--no-fetch)' };

  const copies = [];
  if (prSha) copies.push({ kind: 'pr', label: 'GitHub PR head', sha: String(prSha).toLowerCase() });
  copies.push({ kind: 'origin', label: `origin/${branch}`, sha: await shaOf(main, `refs/remotes/origin/${branch}`) });

  const wts = await worktreeCopies(main, branch);
  const local = await shaOf(main, `refs/heads/${branch}`);
  if (local && !wts.some((w) => w.sha === local)) copies.push({ kind: 'local', label: `local branch ${branch}`, sha: local });
  copies.push(...wts);

  // A PR head GitHub moved a second ago may not be in these objects, and
  // `--is-ancestor` on a missing commit answers "no" like any other.
  for (const c of copies) c.present = Boolean(c.sha) && (await gitCode(main, ['cat-file', '-e', `${c.sha}^{commit}`])).code === 0;
  const shas = [...new Set(copies.filter((c) => c.present).map((c) => c.sha))];

  let newest = null;
  for (const s of shas) {
    let all = true;
    for (const t of shas) if (s !== t && (await gitCode(main, ['merge-base', '--is-ancestor', t, s])).code !== 0) all = false;
    if (all) newest = s;
  }
  const diverged = shas.length > 1 && newest === null;

  const ref = newest || shas[0];
  for (const c of copies) {
    if (!c.present) continue;
    const counts = String((await ok(git(main, ['rev-list', '--left-right', '--count', `${ref}...${c.sha}`]))) || '')
      .trim()
      .split(/\s+/)
      .map(Number);
    c.behind = counts[0] ?? null; // commits in the reference copy this one lacks
    c.ahead = counts[1] ?? null; // commits in this one the reference lacks (nonzero only when diverged)
  }

  const baseSha = await shaOf(main, `refs/remotes/origin/${base}`);
  const baseName = `origin/${base}`;
  let merge = { ran: false, base: baseName, reason: diverged ? 'diverged: no single tip to merge into' : 'no copy of the branch to merge into' };
  if (newest && !baseSha) merge = { ran: false, base: baseName, reason: `no ${baseName} in this repo` };
  else if (newest) {
    const conflicts = await mergeConflicts(main, newest, baseSha);
    merge = conflicts === null ? { ran: false, base: baseName, reason: 'git merge-tree failed' } : { ran: true, base: baseName, clean: conflicts.length === 0, conflicts };
  }

  return { branch, base, fetched, copies, newest, diverged, reference: ref || null, merge, commands: commandsFor({ branch, base, copies, newest, diverged, merge }) };
}

/**
 * The commands that follow from the answer, each with an absolute `-C`. None is run here.
 * Comment lines (`#`) say why a copy was left alone.
 */
export function commandsFor({ branch, base, copies, newest, diverged, merge }) {
  const cmds = [];
  if (!newest || diverged) return cmds;
  const holder = copies.find((c) => c.kind === 'worktree' && c.sha === newest && !c.mergeHead);
  const origin = copies.find((c) => c.kind === 'origin');
  for (const c of copies) {
    if (c.kind !== 'worktree' || c.sha === newest) continue;
    if (c.mergeHead || c.dirty) cmds.push(`# ${c.path} is behind but ${c.mergeHead ? 'mid-merge' : `has ${c.dirty} uncommitted file(s)`} — look before moving it`);
    else cmds.push(`git -C ${c.path} merge --ff-only origin/${branch}`);
  }
  if (holder && origin?.sha !== newest) cmds.push(`git -C ${holder.path} push origin HEAD:${branch}`);
  const where = holder?.path || copies.find((c) => c.kind === 'worktree' && c.sha !== newest && !c.mergeHead && !c.dirty)?.path;
  if (where && merge.ran) {
    cmds.push(`git -C ${where} merge origin/${base}${merge.clean ? '' : `   # conflicts in: ${merge.conflicts.join(', ')}`}`);
  } else if (!where) cmds.push(`# no worktree holds ${newest.slice(0, 9)}: enter a NEW worktree, then git -C <it> reset --hard ${newest}`);
  return cmds;
}

const short = (s) => (s ? s.slice(0, 9) : '(none)');

/** The printed report, one line per copy. */
export function describePrBranch(r) {
  const lines = [];
  for (const c of r.copies) {
    const bits = [];
    if (!c.present) bits.push(c.sha ? 'not in this repo (fetch failed or head moved)' : 'does not exist');
    else if (r.diverged) bits.push(`${c.behind} behind / ${c.ahead} ahead of ${short(r.reference)}`);
    else bits.push(c.sha === r.newest ? 'NEWEST' : `${c.behind} behind`);
    if (c.kind === 'worktree') {
      bits.push(c.dirty ? `dirty (${c.dirty})` : 'clean');
      if (c.mergeHead) bits.push('MERGE_HEAD present');
      if (c.lock) bits.push(c.lock.pid === null ? 'locked' : `locked pid ${c.lock.pid} ${c.lock.alive ? 'LIVE' : 'dead'}`);
    }
    lines.push(`  ${short(c.sha)}  ${c.label}  ·  ${bits.join(' · ')}`);
  }
  lines.push('');
  if (r.diverged) lines.push('DIVERGED — no copy contains the others; merge them before anything else, do not pick one.');
  else if (r.newest) lines.push(`newest: ${short(r.newest)}`);
  if (!r.fetched.ok) lines.push(`fetch: not refreshed (${r.fetched.reason}) — origin may be stale`);
  if (r.merge.ran) {
    lines.push(
      r.merge.clean
        ? `merging ${r.merge.base} into it: clean`
        : `merging ${r.merge.base} into it: CONFLICTS in ${r.merge.conflicts.length} file(s): ${r.merge.conflicts.join(', ')}`
    );
  } else lines.push(`merging ${r.merge.base}: not tried (${r.merge.reason})`);
  if (r.commands.length) lines.push('', 'next:', ...r.commands.map((c) => `  ${c}`));
  return lines;
}
