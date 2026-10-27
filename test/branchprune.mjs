/**
 * The branch prune, and the stale-lock rule the worktree sweep grew alongside it.
 *
 * Both halves of bc-iaju1.8, in one suite, because they are one job seen from two
 * ends: a checkout that has run for months accumulates refs nothing will ever delete
 * (604 of 687 branches on the one that filed the bead) and worktrees nothing will ever
 * release (five pinned by locks whose windows died, the oldest 41 days old).
 *
 * **The gate these tests exist for is gate 3 — `origin` must still have the branch.**
 * It is the one that is not obvious, and it is not about the commits: those are in
 * `origin/main` by gate 2 and cannot be lost. It is about the *name*. `tipOf` in
 * lib/notinmain.js resolves a bead's branch as `refs/heads/<b>` **then**
 * `refs/remotes/origin/<b>`, and `worktreeBranches` unions the two, so a local branch
 * deleted while origin has also forgotten it takes a name two sweeps can still ask
 * about out of the repo entirely. Hence `only a branch origin still has`, below.
 *
 * It also buys a property worth stating out loud, since a few dozen advocate suites
 * build fixture repos with no remote at all: **in a repo with no origin, this sweep
 * deletes nothing**, because every branch fails gate 3 vacuously. That is asserted
 * directly (`a repo with no origin`) rather than left to be rediscovered the next time
 * somebody wonders why the fixtures survived a prune running by default.
 *
 * `lockHolderGone` is driven both ways: through an injected `alive` so the outcome does
 * not depend on which pids this machine happens to be running, and once against the
 * real process table with this process's own pid, so the injection cannot be hiding a
 * broken default.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { pruneBranches, describeBranchPrune } from '../lib/branchprune.js';
import { sweepWorktrees, parseWorktrees, lockHolderGone } from '../lib/tidy.js';
import { removeTree } from './helpers/tmp.mjs';

/** Resolved, for the same reason test/retire.mjs resolves it: git reports resolved paths. */
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-branchprune-')));

let failures = 0;
let ran = 0;
const ok = (name) => {
  ran += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
};
const bad = (name, detail) => {
  ran += 1;
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = async (fn, name) => {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 't@e',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 't@e',
    },
  }).trim();

const commit = (dir, name) => {
  fs.writeFileSync(path.join(dir, name), `${name}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', name);
};

const branches = (dir) =>
  git(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').split('\n').filter(Boolean).sort();

/* ------------------------------------------------------------------- the fixture */

/**
 * A clone with a real origin, and one branch in each of the states the gates sort on.
 *
 * `landed` and `orphan` are both contained in `origin/main`; they differ only in
 * whether origin still knows the name, which is the whole of gate 3. `ahead` is not
 * contained. `busy` is contained *and* checked out in a worktree, which is the state
 * git itself refuses and which the sweep reports rather than throws over.
 */
function fixture(label) {
  const root = path.join(tmp, label);
  const originDir = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  fs.mkdirSync(root, { recursive: true });

  const seed = path.join(root, 'seed');
  fs.mkdirSync(seed);
  git(seed, 'init', '--quiet', '--initial-branch=main', '.');
  commit(seed, 'one');
  // Both branches are made and merged *before* the clone, so origin carries the merge
  // and both names — the ordinary shape after a pull request lands.
  for (const b of ['landed', 'orphan']) {
    git(seed, 'checkout', '--quiet', '-b', b);
    commit(seed, `${b}-work`);
    git(seed, 'checkout', '--quiet', 'main');
    git(seed, 'merge', '--quiet', '--no-ff', '-m', `merge ${b}`, b);
  }
  git(seed, 'checkout', '--quiet', '-b', 'busy');
  commit(seed, 'busy-work');
  git(seed, 'checkout', '--quiet', 'main');
  git(seed, 'merge', '--quiet', '--no-ff', '-m', 'merge busy', 'busy');
  git(seed, 'checkout', '--quiet', '-b', 'ahead');
  commit(seed, 'ahead-work');
  git(seed, 'checkout', '--quiet', 'main');

  git(root, 'clone', '--quiet', '--bare', seed, originDir);
  git(root, 'clone', '--quiet', originDir, work);
  // A clone gives you one local branch; the rest are wanted as local refs too, which is
  // the state a checkout that actually did the work is in.
  for (const b of ['landed', 'orphan', 'busy', 'ahead']) git(work, 'branch', b, `origin/${b}`);
  // …and then origin forgets one of them, exactly as GitHub does when a merged pull
  // request's branch is deleted.
  git(work, 'push', '--quiet', 'origin', '--delete', 'orphan');
  git(work, 'fetch', '--quiet', '--prune', 'origin');

  git(work, 'worktree', 'add', '--quiet', path.join(root, 'wt-busy'), 'busy');
  return { root, work };
}

/* --------------------------------------------------------------------- dry run */

const dryFx = fixture('dry');

await check(async () => {
  const before = branches(dryFx.work);
  const r = await pruneBranches(dryFx.work, { dryRun: true });
  assert.equal(r.base, 'origin/main', 'containment is measured against the remote ref');
  assert.deepEqual(
    r.deleted.map((d) => d.name),
    ['landed'],
    'only the branch that is both contained in origin/main and still on origin'
  );
  assert.ok(r.deleted[0].sha, 'the tip is recorded before the deletion, not after');
  assert.deepEqual(branches(dryFx.work), before, 'a dry run deletes nothing');
}, 'a dry run names only a branch origin still has, and removes nothing');

await check(async () => {
  const r = await pruneBranches(dryFx.work, { dryRun: true });
  const why = (name) => r.kept.find((k) => k.name === name)?.why || '';
  assert.match(why('ahead'), /not contained in origin\/main/);
  assert.match(why('orphan'), /origin no longer has this branch/);
  assert.match(why('busy'), /checked out/);
  assert.ok(
    !r.kept.some((k) => k.name === 'main'),
    'the base is not a candidate at all, so it is not reported as kept either'
  );
}, 'every branch left behind is named with the gate that kept it');

/* ------------------------------------------------------------------ the deletion */

const fx = fixture('real');

await check(async () => {
  const r = await pruneBranches(fx.work);
  assert.deepEqual(
    r.deleted.map((d) => d.name),
    ['landed']
  );
  assert.deepEqual(branches(fx.work), ['ahead', 'busy', 'main', 'orphan'], 'and nothing else went with it');
  // The commits are the point of gate 2, so prove they are still reachable.
  assert.ok(git(fx.work, 'rev-parse', '--verify', 'origin/landed'), 'origin still has the branch by name');
}, 'the deletion takes the merged branch and leaves the other three');

await check(async () => {
  const again = await pruneBranches(fx.work);
  assert.deepEqual(again.deleted, [], 'a second run has nothing to do');
}, 'the sweep is idempotent');

await check(async () => {
  // `busy` is contained in origin/main and origin has it: only the worktree holds it.
  // Release the worktree and the same branch becomes a candidate — which is why the
  // advocate runs this step *after* the attic expiry rather than before it.
  git(fx.work, 'worktree', 'remove', '--force', path.join(fx.root, 'wt-busy'));
  const r = await pruneBranches(fx.work);
  assert.deepEqual(
    r.deleted.map((d) => d.name),
    ['busy']
  );
}, 'a branch stops being held the moment its worktree goes');

/* ------------------------------------------------------------------------- caps */

await check(async () => {
  const capped = fixture('cap');
  const r = await pruneBranches(capped.work, { limit: 0, dryRun: true });
  assert.deepEqual(r.deleted.map((d) => d.name), ['landed'], '0 means no cap, not "delete nothing"');
  const one = await pruneBranches(capped.work, { limit: 1, dryRun: true });
  assert.equal(one.deleted.length, 1);
}, 'the per-run cap bounds a run and 0 disables it');

/* ------------------------------------------------------------------ degenerate */

await check(async () => {
  const bare = path.join(tmp, 'noremote');
  fs.mkdirSync(bare);
  git(bare, 'init', '--quiet', '--initial-branch=main', '.');
  commit(bare, 'one');
  git(bare, 'checkout', '--quiet', '-b', 'side');
  commit(bare, 'side-work');
  git(bare, 'checkout', '--quiet', 'main');
  git(bare, 'merge', '--quiet', '--no-ff', '-m', 'merge side', 'side');

  const r = await pruneBranches(bare);
  assert.equal(r.base, 'main', 'with no origin it falls back to the local ref');
  assert.deepEqual(r.deleted, [], 'and deletes nothing, because gate 3 cannot be satisfied');
  assert.deepEqual(branches(bare), ['main', 'side']);
}, 'a repo with no origin is swept and loses nothing — which is what keeps the fixtures safe');

await check(async () => {
  const empty = path.join(tmp, 'headless');
  fs.mkdirSync(empty);
  git(empty, 'init', '--quiet', '--initial-branch=main', '.');
  const r = await pruneBranches(empty);
  assert.equal(r.base, null, 'a repo with no commits has no base to measure against');
  assert.match(r.reason, /neither origin\/main nor main/);
  assert.deepEqual(r.deleted, []);
}, 'a repo with no base ref says so rather than throwing');

/* ---------------------------------------------------------------------- the line */

await check(async () => {
  assert.equal(
    describeBranchPrune({ deleted: [{ name: 'a' }, { name: 'b' }], kept: [], base: 'origin/main' }),
    'deleted 2 branches merged into origin/main'
  );
  assert.equal(describeBranchPrune({ deleted: [], kept: [], base: 'origin/main' }), '', 'nothing to say');
  assert.equal(
    describeBranchPrune({ deleted: [], kept: [{ name: 'x', why: 'checked out', quiet: true }], base: 'main' }),
    '',
    'a permanent state is not news every single day'
  );
  assert.match(
    describeBranchPrune({ deleted: [], kept: [{ name: 'x', why: 'could not delete it — boom' }], base: 'main' }),
    /kept x \(could not delete it — boom\)/,
    'something that went wrong is'
  );
  assert.match(describeBranchPrune({ reason: 'no base' }), /branches: no base/);
}, 'the summary counts deletions and names only what refused');

/* ------------------------------------------------------------------ stale locks */

await check(() => {
  const dead = () => false;
  const live = () => true;
  assert.equal(lockHolderGone('claude session x (pid 4242 start Fri)', { alive: dead }), true);
  assert.equal(lockHolderGone('claude session x (pid 4242 start Fri)', { alive: live }), false);
  assert.equal(lockHolderGone('resolver pid 4242 #767', { alive: dead }), true, 'a resolver lock has the other shape');
  // The three real reasons on the checkout that filed the bead which name no pid at
  // all. "I cannot tell who holds this" must read as held — it is the one direction
  // that loses work.
  assert.equal(lockHolderGone('live session: b7e-keep (bc-2pysw)', { alive: dead }), false);
  assert.equal(lockHolderGone('sorrel session editing bc-ldd3c by path', { alive: dead }), false);
  assert.equal(lockHolderGone('claude session 91283', { alive: dead }), false, 'a bare number is not a pid');
  assert.equal(lockHolderGone('', { alive: dead }), false);
  assert.equal(lockHolderGone(null, { alive: dead }), false);
  // Without the injection, against the real process table.
  assert.equal(lockHolderGone(`claude session me (pid ${process.pid} start now)`), false, 'this process is alive');
}, 'a lock is stale only when it names a pid and that pid is gone');

await check(() => {
  const list = parseWorktrees(
    ['worktree /a', 'branch refs/heads/one', 'locked claude session one (pid 5 start x)', '', 'worktree /b', 'branch refs/heads/two', 'locked', '', 'worktree /c', 'branch refs/heads/three', ''].join('\n')
  );
  assert.equal(list[0].lockReason, 'claude session one (pid 5 start x)', 'the tail is kept verbatim');
  assert.equal(list[1].locked, true);
  assert.equal(list[1].lockReason, '', 'a bare `locked` line has no reason and is still a lock');
  assert.equal(list[2].locked, false);
  assert.equal(list[2].lockReason, '');
}, 'the porcelain parser keeps the lock reason without changing what .locked means');

await check(async () => {
  const lx = fixture('locks');
  const wtRoot = path.join(lx.work, '.claude', 'worktrees');
  fs.mkdirSync(wtRoot, { recursive: true });
  // Two worktrees identical in every way the other gates can see: clean, merged into
  // origin/main, nobody in them, old enough. Only the lock differs.
  for (const [name, branch] of [['dead', 'landed'], ['held', 'orphan']]) {
    git(lx.work, 'worktree', 'add', '--quiet', path.join(wtRoot, name), branch);
  }
  git(lx.work, 'worktree', 'lock', path.join(wtRoot, 'dead'), '--reason', 'claude session dead (pid 4242 start Fri)');
  git(lx.work, 'worktree', 'lock', path.join(wtRoot, 'held'), '--reason', 'claude session held (pid 4243 start Fri)');
  // Past QUIET_MINUTES, so recent-modification occupancy is not what decides this.
  const old = new Date(Date.now() - 60 * 60000);
  for (const name of ['dead', 'held']) {
    for (const e of fs.readdirSync(path.join(wtRoot, name))) {
      try {
        fs.utimesSync(path.join(wtRoot, name, e), old, old);
      } catch {
        /* .git file, or whatever else will not take a stamp */
      }
    }
    fs.utimesSync(path.join(wtRoot, name), old, old);
  }

  const alive = (pid) => pid === 4243;
  const r = await sweepWorktrees(lx.work, { alive });
  assert.deepEqual(
    r.retired.map((x) => x.name),
    ['dead'],
    'the one whose window is gone'
  );
  assert.equal(r.retired[0].staleLock, 'claude session dead (pid 4242 start Fri)', 'and it says so');
  assert.equal(r.left.find((l) => l.name === 'held')?.why, 'locked', 'a live claim is honoured and stays quiet');

  const note = fs.readFileSync(path.join(lx.work, '.claude', 'worktrees-retired', 'dead.note'), 'utf8');
  assert.match(note, /stale lock: claude session dead \(pid 4242/, 'the note records the one disputable thing');
  const after = parseWorktrees(git(lx.work, 'worktree', 'list', '--porcelain'));
  const moved = after.find((w) => path.basename(w.path) === 'dead');
  assert.equal(moved.locked, false, 'the lock comes off with the move, so the attic can expire it later');
}, 'a worktree pinned by a dead window is retired; one pinned by a live one is not');

/* --------------------------------------------------------------------- report */

console.log(`\n${failures ? '\x1b[31m✗' : '\x1b[32m✓'} branchprune: ${ran - failures}/${ran} passed\x1b[0m\n`);
await removeTree(tmp);
process.exit(failures ? 1 : 0);
