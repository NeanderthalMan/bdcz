#!/usr/bin/env node
/**
 * `b7e-prbranch` — which copy of a pull request's branch is newest, and would main merge
 * into it. lib/prbranch.js and bin/b7e-prbranch.
 *
 *     npm test
 *     node test/b7eprbranch.mjs
 *
 * bc-dgx7.188's acceptance criteria, replayed against a real throwaway repo with a real
 * bare origin: a worktree behind origin/<branch>, a worktree ahead with unpushed merges
 * and a dead-pid lock, a clean branch, and a diverged one. Real `git worktree add`/`lock`
 * and `git merge-tree` throughout — what matters is what git reports, not strings this
 * file wrote by hand. The pull request half (`gh`) is not exercised: `prBranch` takes the
 * PR's head sha as an argument, which is where `bin/b7e-prbranch` hands it over.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-prbranch');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-prbranch-')));
process.on('exit', () => removeTreeSync(tmp));

const { prBranch, describePrBranch } = await import(path.join(ROOT, 'lib', 'prbranch.js'));

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@e' },
  }).trim();

const origin = path.join(tmp, 'origin.git');
const REPO = path.join(tmp, 'repo');
const OTHER = path.join(tmp, 'other'); // a second clone: where "somebody else pushed" happens
git(tmp, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
git(tmp, 'clone', '--quiet', origin, REPO);
git(REPO, 'config', 'user.email', 't@e');
git(REPO, 'config', 'user.name', 'test');
fs.writeFileSync(path.join(REPO, 'f.txt'), 'one\n');
fs.writeFileSync(path.join(REPO, 'g.txt'), 'g\n');
git(REPO, 'add', '-A');
git(REPO, 'commit', '--quiet', '-m', 'root');
git(REPO, 'push', '--quiet', '-u', 'origin', 'main');
git(tmp, 'clone', '--quiet', origin, OTHER);
git(OTHER, 'config', 'user.email', 't@e');
git(OTHER, 'config', 'user.name', 'test');

const commit = (cwd, file, text, msg) => {
  fs.writeFileSync(path.join(cwd, file), text);
  git(cwd, 'add', file); // not -A: REPO holds the other worktrees under .claude/
  git(cwd, 'commit', '--quiet', '-m', msg);
};
const wtDir = (name) => path.join(REPO, '.claude', 'worktrees', name);
/** A branch with one commit, pushed, with a worktree on it. */
function branchWithWorktree(name, file = 'work.txt') {
  const branch = `worktree-${name}`;
  git(REPO, 'worktree', 'add', '--quiet', '-b', branch, wtDir(name), 'main');
  commit(wtDir(name), file, `${name}\n`, `${name} 1`);
  git(wtDir(name), 'push', '--quiet', '-u', 'origin', branch);
  return branch;
}

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${String(err?.message || err).split('\n').join('\n      ')}`);
  }
};
const copyOf = (r, kind) => r.copies.find((c) => c.kind === kind);

/* ------------------------------------------------- 1: a worktree behind origin */
const behind = branchWithWorktree('behind');
git(OTHER, 'fetch', '--quiet', 'origin');
git(OTHER, 'checkout', '--quiet', '-b', behind, `origin/${behind}`);
commit(OTHER, 'work.txt', 'behind\nplus\n', 'behind 2 (pushed from elsewhere)');
git(OTHER, 'push', '--quiet', 'origin', behind);
const originTip = git(OTHER, 'rev-parse', 'HEAD');

await check('a worktree behind origin: origin is newest, the worktree is 1 behind, and the ff command is printed', async () => {
  const r = await prBranch(REPO, { branch: behind });
  assert.equal(r.fetched.ok, true);
  assert.equal(r.newest, originTip);
  assert.equal(r.diverged, false);
  const wt = copyOf(r, 'worktree');
  assert.equal(wt.behind, 1);
  assert.equal(wt.dirty, 0);
  assert.equal(wt.mergeHead, false);
  assert.ok(r.commands.includes(`git -C ${wtDir('behind')} merge --ff-only origin/${behind}`), r.commands.join('\n'));
});

await check("with the PR head given, it is a copy too — and one GitHub moved past origin's is reported absent, not newest", async () => {
  const r = await prBranch(REPO, { branch: behind, prSha: originTip, fetch: false });
  assert.equal(copyOf(r, 'pr').sha, originTip);
  const ghost = await prBranch(REPO, { branch: behind, prSha: 'f'.repeat(40), fetch: false });
  assert.equal(copyOf(ghost, 'pr').present, false);
  assert.equal(ghost.newest, originTip);
});

/* ---------------------- 2: a worktree ahead, unpushed merges, a dead-pid lock */
const ahead = branchWithWorktree('ahead');
commit(wtDir('ahead'), 'work.txt', 'ahead\nlocal\n', 'unpushed 1');
commit(wtDir('ahead'), 'extra.txt', 'x\n', 'unpushed 2');
git(REPO, 'worktree', 'lock', '--reason', 'claude session ahead (pid 2999999 start 2026-10-04)', wtDir('ahead'));

await check('a worktree ahead with a dead-pid lock: the worktree is newest, origin 2 behind, push command printed', async () => {
  const r = await prBranch(REPO, { branch: ahead });
  const wt = copyOf(r, 'worktree');
  assert.equal(r.newest, wt.sha);
  assert.equal(copyOf(r, 'origin').behind, 2);
  assert.deepEqual({ pid: wt.lock.pid, alive: wt.lock.alive }, { pid: 2999999, alive: false });
  assert.ok(r.commands.includes(`git -C ${wtDir('ahead')} push origin HEAD:${ahead}`), r.commands.join('\n'));
  assert.ok(describePrBranch(r).join('\n').includes('locked pid 2999999 dead'));
});

await check('a live pid in the lock reads LIVE', async () => {
  git(REPO, 'worktree', 'unlock', wtDir('ahead'));
  git(REPO, 'worktree', 'lock', '--reason', `claude session ahead (pid ${process.pid} start x)`, wtDir('ahead'));
  const r = await prBranch(REPO, { branch: ahead, fetch: false });
  assert.equal(copyOf(r, 'worktree').lock.alive, true);
  assert.ok(describePrBranch(r).join('\n').includes(`locked pid ${process.pid} LIVE`));
});

/* ------------------------------------------------------------ 3: a clean branch */
const clean = branchWithWorktree('clean');

await check('a clean branch: every copy is the newest, nothing to move, merge is clean', async () => {
  const r = await prBranch(REPO, { branch: clean, prSha: git(wtDir('clean'), 'rev-parse', 'HEAD') });
  assert.equal(r.diverged, false);
  assert.ok(r.copies.every((c) => c.sha === r.newest && c.behind === 0));
  assert.equal(r.merge.clean, true);
  assert.ok(!r.commands.some((c) => c.includes('--ff-only') || c.includes(' push ')), r.commands.join('\n'));
});

/* -------------------------------------------------- 4: diverged, and merge-tree */
const diverged = branchWithWorktree('diverged');
git(OTHER, 'fetch', '--quiet', 'origin');
git(OTHER, 'checkout', '--quiet', '-b', diverged, `origin/${diverged}`);
commit(OTHER, 'theirs.txt', 't\n', 'pushed from elsewhere');
git(OTHER, 'push', '--quiet', 'origin', diverged);
commit(wtDir('diverged'), 'mine.txt', 'm\n', 'unpushed here');

await check('a diverged branch: no newest, diverged is true, nothing is suggested, the report says so', async () => {
  const r = await prBranch(REPO, { branch: diverged });
  assert.equal(r.diverged, true);
  assert.equal(r.newest, null);
  assert.deepEqual(r.commands, []);
  assert.equal(r.merge.ran, false);
  assert.equal(copyOf(r, 'worktree').ahead, 1);
  assert.ok(describePrBranch(r).join('\n').includes('DIVERGED'));
});

// main moves f.txt; one branch edits f.txt (conflict), one edits g.txt differently (clean)
const conflicting = branchWithWorktree('conflicting', 'f.txt');
const tidy = branchWithWorktree('tidy', 'other.txt');
commit(REPO, 'f.txt', 'main changed it\n', 'main moves f.txt');
git(REPO, 'push', '--quiet', 'origin', 'main');
// the branch edited f.txt from "one": rewrite its commit's content to differ from main's
commit(wtDir('conflicting'), 'f.txt', 'branch changed it\n', 'branch moves f.txt');
git(wtDir('conflicting'), 'push', '--quiet', 'origin', conflicting);

await check('merge-tree names exactly the files a real merge would conflict on', async () => {
  const r = await prBranch(REPO, { branch: conflicting });
  assert.equal(r.merge.ran, true);
  assert.equal(r.merge.clean, false);
  assert.deepEqual(r.merge.conflicts, ['f.txt']);
  // and a real merge agrees
  let real = [];
  try {
    git(wtDir('conflicting'), 'merge', '--no-edit', 'origin/main');
  } catch {
    real = git(wtDir('conflicting'), 'diff', '--name-only', '--diff-filter=U').split('\n');
  }
  git(wtDir('conflicting'), 'merge', '--abort');
  assert.deepEqual(real, r.merge.conflicts);
  const t = await prBranch(REPO, { branch: tidy });
  assert.equal(t.merge.clean, true);
});

await check('a worktree mid-merge is flagged, and is not offered as the place to merge', async () => {
  try {
    git(wtDir('conflicting'), 'merge', '--no-edit', 'origin/main');
  } catch {
    /* the conflict is the point */
  }
  const r = await prBranch(REPO, { branch: conflicting, fetch: false });
  assert.equal(copyOf(r, 'worktree').mergeHead, true);
  assert.ok(describePrBranch(r).join('\n').includes('MERGE_HEAD present'));
  assert.ok(!r.commands.some((c) => c.includes('merge origin/main') && !c.startsWith('#')), r.commands.join('\n'));
  git(wtDir('conflicting'), 'merge', '--abort');
});

await check('every printed command is `git -C <absolute path>` or a comment, so the worktree guard lets it through', async () => {
  for (const b of [behind, ahead, clean, diverged, conflicting, tidy]) {
    const r = await prBranch(REPO, { branch: b, fetch: false });
    for (const c of r.commands) assert.ok(c.startsWith('# ') || /^git -C \/\S+ /.test(c), c);
  }
});

await check('the command itself: --help exits 0, no arguments is a usage error, an unknown workspace exits 4', async () => {
  assert.equal(spawnSync(process.execPath, [BIN, '--help']).status, 0);
  assert.equal(spawnSync(process.execPath, [BIN]).status, 2);
  assert.equal(spawnSync(process.execPath, [BIN, '-w', 'no-such-workspace-xyz', '1']).status, 4);
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
