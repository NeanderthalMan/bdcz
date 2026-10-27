/**
 * Deleting the local branches whose work is already in main.
 *
 * lib/tidy.js sweeps the *worktrees* — it moves a finished one into the attic and
 * eventually removes it — and it keeps the branch every time, on purpose: a retired
 * worktree is resumable only while its ref is still there, and `git branch -d` refuses
 * a branch checked out somewhere anyway. So nothing in beadcause has ever deleted a
 * branch, and on the checkout this was written against that came to **687 local
 * branches, 604 of them already contained in `origin/main`**. Every `git branch`, every
 * ref walk, every fanout that enumerates `worktree-*` pays for all of them, and a human
 * looking for the one branch that has not landed reads six hundred that have.
 *
 * ## The gates, and why each one is here
 *
 * A branch is deleted only when **all four** hold. Anything failing one is left alone
 * and named with the reason, the same contract lib/tidy.js keeps.
 *
 * 1. **It is not the base itself.** `main` is never a candidate, whatever it is
 *    contained in.
 * 2. **It is contained in `origin/main`** — `merge-base --is-ancestor`, against the
 *    remote ref and not the local one. Nothing merges locally here: a worker opens a
 *    pull request and GitHub merges it, so `origin/main` moves and the local `main`
 *    sits wherever it was last pulled to. Asking the local ref was fifty commits wrong
 *    on this checkout — the same trap `containedInMain` in lib/tidy.js documents.
 * 3. **`origin/<same name>` still exists.** This is the gate that makes the whole sweep
 *    cheap to be sure about, and it is not about the commits — those are in `main` by
 *    gate 2 and cannot be lost. It is about the *name*. Two sweeps resolve a bead's
 *    branch by name and take whichever ref answers first: `tipOf` in lib/notinmain.js
 *    (`refs/heads/<b>` then `refs/remotes/origin/<b>`), and `worktreeBranches`, which
 *    unions local heads with origin's copies for exactly this reason. Delete a local
 *    branch whose origin copy is also gone and those two stop being able to answer
 *    "did this bead's branch land" at all. Keeping the ones origin has forgotten costs
 *    six branches out of 604 here, and it means no reader loses a name it could
 *    previously resolve.
 * 4. **It is not checked out in any worktree** — including the attic, whose entries are
 *    still registered worktrees. git refuses these on its own; asking first is what
 *    turns a thrown error into a row that says which worktree holds it.
 *
 * ## Why `-D` and not `-d`
 *
 * `git branch -d` is the safe one and it is the wrong tool here: it checks containment
 * against the *current* HEAD or the branch's upstream, and this checkout's HEAD is a
 * local `main` that lags origin by dozens of commits, so it refuses almost every branch
 * gate 2 has already proved is safe. `-D` skips that check — and gate 2 is that check,
 * evaluated against the ref that is actually authoritative. The deletion is recoverable
 * from `origin/<branch>` (gate 3 just proved it is there) and from the reflog, which is
 * more than `-d` guarantees about anything.
 *
 * ## Cadence
 *
 * Daily, not every tick. The worktree sweep runs every fifteen minutes because a
 * finished worktree is in the way immediately; a merged branch is in the way slowly,
 * and the sweep is one `for-each-ref` plus one `merge-base` per branch — cheap, but not
 * cheap enough to repeat ninety-six times a day for an answer that changes by a handful.
 * See `pruneBranchesIntervalMinutes` in lib/advocate.js.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** git, never through a shell, and never fatal: a sweep must not take the daemon down. */
async function git(cwd, args, { timeout = 30000 } = {}) {
  const { stdout } = await run('git', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

const lines = (out) =>
  String(out || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The ref containment is measured against: `origin/main` if this checkout has it, else
 * `main`. Same order, and the same reason, as `containedInMain` in lib/tidy.js — and
 * the fallback is what makes this work at all in a repo with no remote, where every
 * merge really did happen locally.
 */
async function pickBase(dir, base) {
  for (const ref of [`origin/${base}`, base]) {
    const exists = await git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).then(
      () => true,
      () => false
    );
    if (exists) return ref;
  }
  return null;
}

/**
 * How many branches one `git branch -D` is asked to delete at once.
 *
 * Five hundred branches is five hundred subprocesses one at a time, and a chunk that
 * fails is retried branch by branch (see `deleteChunk`), so the batching costs nothing
 * in fidelity — only the ordinary case gets faster.
 */
const CHUNK = 50;

/**
 * Delete one chunk, and fall back to one-at-a-time if git refuses any of it.
 *
 * `git branch -D a b c` is all-or-nothing about its exit code but not about its work:
 * it deletes what it can and exits non-zero. Rather than guess which half landed, the
 * fallback re-asks per branch, which is the only way to attribute the failure to the
 * branch that caused it. Returns `{ done, failed }`.
 */
async function deleteChunk(dir, names) {
  const done = [];
  const failed = [];
  try {
    await git(dir, ['branch', '-D', ...names]);
    return { done: names.slice(), failed };
  } catch {
    for (const name of names) {
      try {
        await git(dir, ['branch', '-D', name]);
        done.push(name);
      } catch (err) {
        failed.push({ name, why: String(err.message || err).split('\n')[0] });
      }
    }
    return { done, failed };
  }
}

/**
 * Sweep one checkout's local branches. Returns what went and what stayed, with reasons
 * for both — a sweep that silently skipped things would be indistinguishable from one
 * that silently deleted the wrong ones, and only one of those is recoverable.
 *
 * `limit` caps a single run. The first run on a checkout that has never been pruned has
 * hundreds of candidates and there is no hurry about any of them; a cap keeps one tick
 * of the daemon bounded and the rest go tomorrow. 0 means no cap.
 */
export async function pruneBranches(dir, { base = 'main', dryRun = false, limit = 0 } = {}) {
  const deleted = [];
  const kept = [];

  const baseRef = await pickBase(dir, base);
  if (!baseRef) return { deleted, kept, base: null, reason: `neither origin/${base} nor ${base} is a ref here` };

  /**
   * Every local branch, and — in the same listing — its tip and whether it is contained
   * in the base.
   *
   * This started as a `merge-base --is-ancestor` per branch plus a `rev-parse --short`
   * per candidate, which on this checkout was twelve hundred subprocesses and sixteen
   * seconds. `--merged <ref>` is the same containment question asked of the whole set at
   * once, and `%(objectname:short)` is the tip git was already holding. A branch name
   * cannot contain a space, so one is a safe separator.
   */
  const fmt = '--format=%(refname:short) %(objectname:short)';
  const parse = (out) =>
    lines(out).map((l) => {
      const at = l.lastIndexOf(' ');
      return { name: l.slice(0, at), sha: l.slice(at + 1) };
    });
  const locals = parse(await git(dir, ['for-each-ref', fmt, 'refs/heads/']));
  const contained = new Set(parse(await git(dir, ['for-each-ref', fmt, '--merged', baseRef, 'refs/heads/'])).map((b) => b.name));
  const onOrigin = new Set(
    lines(await git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/'])).map((n) =>
      n.replace(/^origin\//, '')
    )
  );
  // Every branch any worktree has checked out, the attic's included — those are still
  // registered worktrees and git will not let their branches go.
  const checkedOut = new Map();
  let wtPath = null;
  for (const line of String(await git(dir, ['worktree', 'list', '--porcelain'])).split('\n')) {
    if (line.startsWith('worktree ')) wtPath = line.slice(9).trim();
    else if (line.startsWith('branch '))
      checkedOut.set(line.slice(7).trim().replace(/^refs\/heads\//, ''), wtPath);
  }

  const candidates = [];
  const tips = new Map();
  for (const { name, sha } of locals) {
    tips.set(name, sha);
    if (name === base || name === baseRef.replace(/^origin\//, '')) continue; // gate 1
    const holder = checkedOut.get(name);
    if (holder) {
      // Not worth a row each: this is the normal state of every branch in use, and on a
      // checkout with a hundred worktrees it would be the whole report. Counted instead.
      kept.push({ name, why: 'checked out', quiet: true, worktree: holder }); // gate 4
      continue;
    }
    if (!onOrigin.has(name)) {
      // Quiet for the same reason `checked out` is: it is a permanent state of that
      // branch, not a thing that went wrong, and repeating it every day forever is how
      // a daily line stops being read.
      kept.push({ name, why: 'origin no longer has this branch — its name would stop resolving', quiet: true }); // gate 3
      continue;
    }
    if (!contained.has(name)) {
      kept.push({ name, why: `not contained in ${baseRef}`, quiet: true }); // gate 2
      continue;
    }
    candidates.push(name);
  }

  const take = limit > 0 ? candidates.slice(0, limit) : candidates;
  for (const name of candidates.slice(take.length)) kept.push({ name, why: "over this run's cap", quiet: true });

  if (dryRun) {
    for (const name of take) deleted.push({ name, sha: tips.get(name), dryRun: true });
    return { deleted, kept, base: baseRef };
  }

  for (let i = 0; i < take.length; i += CHUNK) {
    const { done, failed } = await deleteChunk(dir, take.slice(i, i + CHUNK));
    for (const name of done) deleted.push({ name, sha: tips.get(name) });
    for (const f of failed) kept.push({ name: f.name, why: `could not delete it — ${f.why}` });
  }

  return { deleted, kept, base: baseRef };
}

/**
 * One line for the tick log and the advocate's card.
 *
 * Names are not listed: five hundred of them is not a summary. The loud half of `kept`
 * is — those are the branches something refused, and there are never many.
 */
export function describeBranchPrune({ deleted = [], kept = [], base = null, reason = '' } = {}) {
  if (reason) return `branches: ${reason}`;
  const parts = [];
  if (deleted.length) parts.push(`deleted ${deleted.length} branch${deleted.length === 1 ? '' : 'es'} merged into ${base}`);
  const loud = kept.filter((k) => !k.quiet);
  if (loud.length) parts.push(`kept ${loud.map((k) => `${k.name} (${k.why})`).join(', ')}`);
  return parts.join(' · ');
}
