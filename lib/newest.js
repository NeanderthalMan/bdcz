/**
 * Which ref actually holds the newest version of a path, and what building on it costs.
 *
 * bc-dgx7.83, re-filed from loremia/lm-gr6.63 after a session audit found the same
 * survey done by hand in three loremia sessions (lm-b5d.20, lm-b5d.28, lm-b5d.31), each
 * against the same eight `pipeline/lib/` files with ~23 live worktrees in flight. One
 * guessed which worktree was ahead by `wc -l`; one downmerged a branch cut from a stale
 * main and silently reverted 160 lines of `CHANGE_LOG.md` plus two novel chapters —
 * caught only by an unrelated `git diff --stat`, and after the branch it merged had
 * already been superseded upstream.
 *
 * ## What counts as a candidate
 *
 * The delivery base is what everything is measured against and is never itself a row.
 * Candidates are every local worktree branch (`git worktree list --porcelain`, parsed by
 * lib/tidy.js's `parseWorktrees`, the same listing lib/siblings.js reads), every open
 * pull request's head branch (passed in as `prs` — this module makes no network call),
 * and any `extraRefs` the caller names. A branch that is both a live worktree and a PR
 * head is one candidate, matched by branch name, and **the local branch wins for which
 * ref to read**: a worktree can hold commits nobody has pushed, and lm-b5d.31's failure
 * was reading `origin/<branch>` for a worktree that had moved on. Only a PR head with no
 * worktree here falls back to `origin/<branch>`.
 *
 * Local `main` is a candidate like any other: when it carries commits `origin/main` has
 * never seen it is exactly a ref that "holds newer content" that nobody has pushed.
 *
 * ## "Differs from the base" is not "holds the newest version"
 *
 * lm-b5d.28 merged a branch that differed from the base on the asked-about paths only
 * because the *base* had moved past it. So each candidate is classified by what each
 * side did **since their merge-base, on these paths**:
 *
 * - `ahead`     — the candidate has commits there, the base has none. Strictly newer.
 * - `diverged`  — both have commits there. Neither is a superset of the other.
 * - `behind`    — only the base has commits there. The candidate is stale on these paths.
 * - `landed`    — the candidate is an ancestor of the base: already in.
 * - `uncommitted` — nothing committed on these paths, but the worktree has edits on them.
 *
 * Only `ahead` and `diverged` candidates can be the verdict. Among them, a candidate that
 * is an ancestor of another is superseded by it; the survivors are the **tips**, and when
 * there is more than one tip the verdict says outright that they are unrelated instead of
 * crowning the newest by clock.
 *
 * ## What building on a candidate costs
 *
 * Three numbers, because they are three different mistakes:
 *
 * - `outside` — files the candidate itself changed since the fork that are *not* on the
 *   asked-about paths. A merge brings all of them in; this is what the caller did not ask
 *   about and gets anyway.
 * - `baseSide` — files the *base* changed since the fork. Taking the candidate's tree
 *   wholesale (`reset --hard`, `checkout <ref> -- .`) silently drops these; this is the
 *   lm-b5d.28 revert, computable before rather than after.
 * - `overlap` — files both sides changed since the fork. That is what a real merge has
 *   to resolve, and `b7e-base` computes the same set for HEAD.
 *
 * Uncommitted work is reported per worktree (`uncommitted`, the count of changed or new
 * files on the paths) but never enters the verdict: it is not a ref anybody can build on,
 * only a reason to go and ask its owner.
 *
 * ## What this deliberately does not do
 *
 * No `git fetch` and no `gh` call happens here — `bin/b7e-newest` fetches once and asks
 * GitHub once, because a survey over a hundred worktrees should pay for one of each, not
 * one per candidate. `openPrs` below is the one function that reaches GitHub and it fails
 * open: `gh` that cannot answer empties the PR half and says why on `reason`, the
 * lib/inflight.js contract.
 */
import fs from 'node:fs';
import { git, gitCode, ok } from './gitref.js';
import { parseWorktrees } from './tidy.js';
import * as pr from './pr.js';

/** More than this and a candidate's own-commit list is the story, not any one entry. */
export const MAX_COMMITS = 5;

/** Files listed by name on a row before the rest are only counted. */
export const MAX_FILES = 12;

/** Candidates worked at once — a hundred worktrees at one git spawn at a time is minutes. */
const CONCURRENCY = 6;

/** A ref's commit sha, or null if it does not resolve to one here. */
async function resolve(dir, ref) {
  return (await ok(git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])))?.trim() || null;
}

/** `git`'s output split into non-empty lines; a failed call is no lines, not a throw. */
async function lines(dir, args) {
  const out = await ok(git(dir, args));
  return out ? out.split('\n').filter(Boolean) : [];
}

/** `items.map(fn)` with at most `n` in flight, results in input order. */
async function pool(items, fn, n = CONCURRENCY) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      out[at] = await fn(items[at], at);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** Aggregate `git diff --numstat` for one pathspec — files, insertions, deletions. */
async function numstat(dir, range, pathspec) {
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of await lines(dir, ['diff', '--numstat', range, '--', pathspec])) {
    const [ins, del] = line.split('\t');
    files += 1;
    insertions += ins === '-' ? 0 : Number(ins);
    deletions += del === '-' ? 0 : Number(del);
  }
  return { files, insertions, deletions };
}

/**
 * Commits in `range` touching `paths`, newest first — capped, with the true total.
 *
 * Merge commits are left out unless nothing else is there: the history filter keeps a
 * merge whose result differs from *each* parent on the paths, and a downmerge of main into
 * a branch does exactly that without the branch having changed them — measured on
 * b7e-inflight, whose only "commit on lib/prbase.js" was `Merge remote-tracking branch
 * 'origin/main'` over an empty net diff. Whether a side changed the paths at all is
 * decided by the net diff (`changedOn`), never by this list, which is only what is shown.
 */
async function commitsOn(dir, range, paths) {
  const read = async (extra) =>
    (await lines(dir, ['log', ...extra, '--format=%h\t%cI\t%ct\t%s', range, '--', ...paths])).map((line) => {
      const [sha, date, ts, ...rest] = line.split('\t');
      return { sha, date, ts: Number(ts), subject: rest.join('\t') };
    });
  let all = await read(['--no-merges']);
  // A net change that only ever arrived through a merge (a conflict resolved on the paths)
  // still has to name something.
  if (!all.length) all = await read([]);
  return { commits: all.slice(0, MAX_COMMITS), total: all.length, latestTs: all[0]?.ts ?? null };
}

/** Files that differ between two commits on `paths` — the net diff, not the history. */
const changedOn = async (dir, from, to, paths) => new Set(await lines(dir, ['diff', '--name-only', from, to, '--', ...paths]));

/** Every open pull request, or the reason there are none — never a throw. */
export async function openPrs(dir, { limit = 100 } = {}) {
  try {
    const avail = await pr.available();
    if (!avail.ok) return { prs: [], reason: avail.reason || 'gh is not available' };
    return { prs: await pr.list(dir, { state: 'open', limit }), reason: '' };
  } catch (err) {
    return { prs: [], reason: String(err?.message || err).split('\n')[0] };
  }
}

/**
 * Every candidate, deduped by branch name — worktree and pull-request facts folded onto
 * one entry when both name the same branch. Never includes `baseRef` itself.
 */
export async function gatherCandidates(dir, { extraRefs = [], prs = [] } = {}) {
  const byName = new Map();

  const porcelain = await ok(git(dir, ['worktree', 'list', '--porcelain']));
  for (const wt of porcelain ? parseWorktrees(porcelain) : []) {
    if (!wt.branch || wt.detached) continue;
    byName.set(wt.branch, { name: wt.branch, ref: wt.branch, worktree: wt, pr: null });
  }

  for (const row of prs) {
    if (!row.branch) continue;
    const existing = byName.get(row.branch);
    if (existing) existing.pr = row;
    else byName.set(row.branch, { name: row.branch, ref: `origin/${row.branch}`, worktree: null, pr: row });
  }

  for (const name of extraRefs) {
    if (!byName.has(name)) byName.set(name, { name, ref: name, worktree: null, pr: null, explicit: true });
  }

  return [...byName.values()];
}

/** The state word for one row — see the module doc for what each one claims. */
export function stateOf({ isAncestor, own, baseOwn, uncommitted }) {
  if (own > 0) return baseOwn > 0 ? 'diverged' : 'ahead';
  // Edits on disk outrank "landed": a branch that merged long ago and has since been
  // written to again is the worktree somebody is in the middle of.
  if (uncommitted > 0) return 'uncommitted';
  // Only the base changed these paths since the fork. An ancestor is one whose work is in.
  if (baseOwn > 0) return isAncestor ? 'landed' : 'behind';
  return 'same';
}

/** One candidate measured against the base, or null when it cannot be (unresolved, unrelated). */
async function measureCandidate(dir, baseSha, paths, c, baseInfo) {
  const sha = await resolve(dir, c.ref);
  if (!sha) return { skipped: { ref: c.ref, reason: 'does not resolve to a commit here' } };

  const onDisk = c.worktree ? fs.existsSync(c.worktree.path) : false;
  const uncommittedFiles = onDisk
    ? (await lines(c.worktree.path, ['status', '--porcelain', '--untracked-files=all', '--', ...paths])).length
    : 0;

  if (sha === baseSha && !uncommittedFiles) return null;

  const mergeBase = (await ok(git(dir, ['merge-base', baseSha, sha])))?.trim() || null;
  if (!mergeBase) return { skipped: { ref: c.ref, reason: `shares no history with the base` } };

  const isAncestor = mergeBase === sha;
  const onPaths = await changedOn(dir, mergeBase, sha, paths);
  const theirs = await baseInfo(mergeBase);
  const own = onPaths.size ? await commitsOn(dir, `${mergeBase}..${sha}`, paths) : { commits: [], total: 0, latestTs: null };

  const state = stateOf({ isAncestor, own: onPaths.size, baseOwn: theirs.onPaths.size, uncommitted: uncommittedFiles });
  if (state === 'same') return null;

  const [aheadBehind] = await lines(dir, ['rev-list', '--left-right', '--count', `${baseSha}...${sha}`]);
  const [behind, ahead] = String(aheadBehind || '0\t0').split('\t').map(Number);

  const mine = new Set(await lines(dir, ['diff', '--name-only', mergeBase, sha]));
  const outside = [...mine].filter((f) => !onPaths.has(f)).sort();
  const overlap = [...mine].filter((f) => theirs.files.has(f)).sort();

  const diffstat = {};
  if (onPaths.size) for (const p of paths) diffstat[p] = await numstat(dir, `${mergeBase}..${sha}`, p);

  return {
    row: {
      name: c.name,
      ref: c.ref,
      sha,
      state,
      isAncestor,
      ahead,
      behind,
      mergeBase,
      commits: own.commits,
      commitsTotal: own.total,
      latestTs: own.latestTs,
      baseCommitsOnPaths: theirs.commitsOnPaths,
      diffstat,
      outside,
      baseSide: [...theirs.files].sort(),
      overlap,
      uncommitted: onDisk ? uncommittedFiles : null,
      worktree: c.worktree ? { path: c.worktree.path, locked: Boolean(c.worktree.locked), onDisk } : null,
      pr: c.pr ? { number: c.pr.number, url: c.pr.url, draft: c.pr.draft, mergeable: c.pr.mergeable } : null,
    },
  };
}

/**
 * Of the rows that hold their own commits on the paths, the ones no other row contains —
 * a row that is an ancestor of another is superseded by it and is not a tip.
 */
async function tipsOf(dir, contenders) {
  const tips = [];
  for (const a of contenders) {
    let superseded = false;
    for (const b of contenders) {
      if (a === b || a.sha === b.sha) continue;
      // eslint-disable-next-line no-await-in-loop -- a handful of rows, and order is the answer
      if ((await gitCode(dir, ['merge-base', '--is-ancestor', a.sha, b.sha])).code === 0) superseded = true;
    }
    if (!superseded) tips.push(a);
  }
  return tips.sort((a, b) => (b.latestTs ?? -Infinity) - (a.latestTs ?? -Infinity));
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The sentence that says what taking `row` costs — the lm-b5d.28 failure, before the merge. */
export function costOf(row, baseRef) {
  const parts = [];
  parts.push(
    row.outside.length
      ? `merging it also brings in ${plural(row.outside.length, 'file')} outside these paths`
      : 'merging it touches nothing outside these paths'
  );
  if (row.baseSide.length) {
    parts.push(
      `it is ${row.behind} behind ${baseRef}, so taking its tree wholesale would drop ${plural(row.baseSide.length, 'file')} changed on ${baseRef} since it forked — merge or cherry-pick, never reset to it`
    );
  }
  if (row.overlap.length) parts.push(`${plural(row.overlap.length, 'file')} changed on both sides will need resolving`);
  return parts.join('; ');
}

/**
 * The survey: one row per candidate that differs from `baseRef` on `paths`, plus a verdict.
 *
 * `dir` must already have `baseRef` fetched. `paths` are git pathspecs relative to the
 * repo root, passed after `--` and never interpreted here, so a directory prefix
 * (`pipeline/lib/`) or a glob works exactly as git makes it work.
 */
export async function newestFor(dir, baseRef, paths, { extraRefs = [], prs = [] } = {}) {
  const baseSha = (await git(dir, ['rev-parse', `${baseRef}^{commit}`])).trim();
  const candidates = await gatherCandidates(dir, { extraRefs, prs });

  // Every candidate cut from the same commit asks the same question of the base, so ask it once.
  const baseInfoCache = new Map();
  const baseInfo = (mergeBase) => {
    if (!baseInfoCache.has(mergeBase)) {
      baseInfoCache.set(
        mergeBase,
        (async () => {
          const files = new Set(await lines(dir, ['diff', '--name-only', mergeBase, baseSha]));
          const onPaths = await changedOn(dir, mergeBase, baseSha, paths);
          const commitsOnPaths = onPaths.size ? (await commitsOn(dir, `${mergeBase}..${baseSha}`, paths)).total : 0;
          return { files, onPaths, commitsOnPaths };
        })()
      );
    }
    return baseInfoCache.get(mergeBase);
  };

  const measured = await pool(candidates, (c) => measureCandidate(dir, baseSha, paths, c, baseInfo));

  const skipped = measured.filter((m) => m?.skipped).map((m) => m.skipped);
  const all = measured.filter((m) => m?.row).map((m) => m.row);
  all.sort((a, b) => (b.latestTs ?? -Infinity) - (a.latestTs ?? -Infinity) || a.name.localeCompare(b.name));

  // Rows worth reading by default. `behind` and `landed` differ from the base only
  // because the base moved past them, which is true of most of a hundred worktrees.
  const rows = all.filter((r) => r.state === 'ahead' || r.state === 'diverged' || r.state === 'uncommitted');
  const hidden = { behind: all.filter((r) => r.state === 'behind').length, landed: all.filter((r) => r.state === 'landed').length };

  const contenders = all.filter((r) => r.state === 'ahead' || r.state === 'diverged');
  const tips = await tipsOf(dir, contenders);
  const top = tips[0] || null;

  let verdict;
  if (!top) {
    verdict = {
      kind: 'base',
      ref: baseRef,
      sha: baseSha,
      competing: [],
      message: `${baseRef} holds the newest committed version of ${paths.join(' ')} — no other ref is ahead of it there`,
    };
  } else {
    const competing = tips.slice(1).map((r) => r.name);
    const latest = top.commits[0] ? `, latest ${top.commits[0].date.slice(0, 10)} "${top.commits[0].subject}"` : '';
    const head = `${top.name} (${top.sha.slice(0, 8)}) holds the newest of ${paths.join(' ')}: ${plural(top.commitsTotal, 'commit')} on them${latest}`;
    const diverged = top.state === 'diverged' ? `; ${baseRef} has also changed them since (${plural(top.baseCommitsOnPaths, 'commit')}), so neither is a superset of the other` : '';
    const unrelated = competing.length ? `. ${plural(competing.length, 'other tip')} on these paths, unrelated to it and not superseded: ${competing.join(', ')}` : '';
    verdict = {
      kind: competing.length || top.state === 'diverged' ? 'contested' : 'ref',
      ref: top.ref,
      name: top.name,
      sha: top.sha,
      competing,
      cost: { outside: top.outside, baseSide: top.baseSide, overlap: top.overlap, behind: top.behind },
      message: `${head}${diverged}${unrelated}. Building on it: ${costOf(top, baseRef)}`,
    };
  }

  const uncommitted = all.filter((r) => r.uncommitted > 0).map((r) => ({ name: r.name, files: r.uncommitted, path: r.worktree.path }));

  return { baseRef, baseSha, paths, rows, all, hidden, verdict, uncommitted, skipped };
}
