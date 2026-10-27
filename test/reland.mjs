#!/usr/bin/env node
//
// b7e-reland — land a branch that never reached main, one method, downmerges set aside
// (bc-dgx7.199).
//
//   npm test
//   node test/reland.mjs
//
// Everything that reads history is proved against REAL git repos built in a temp dir:
// a branch with two real commits and a downmerge of main, a conflicting branch, and a
// cherry-picked one. `gh` is never reached by the library calls under test; the one CLI
// run asks for a branch no GitHub knows and only the git half of its answer is asserted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'b7e-reland');
const rl = await import(path.join(ROOT, 'lib', 'reland.js'));

let failures = 0;
let ran = 0;
const check = async (name, fn) => {
  ran += 1;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${err.message}`);
  }
};

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-reland-test-'));
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const write = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const commit = (dir, file, text, msg) => {
  write(dir, file, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
};

/** A repo with main, and branches cut from its first commit. */
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
git(repo, 'init', '-q', '-b', 'main');
commit(repo, 'a.txt', 'one\ntwo\nthree\n', 'base');
commit(repo, 'shared.txt', 'x\n', 'shared');
const base = git(repo, 'rev-parse', 'HEAD');

// feat: two real commits on a file of its own, then a downmerge of a main that has moved on.
git(repo, 'checkout', '-q', '-b', 'feat', base);
commit(repo, 'feat1.txt', 'f1\n', 'bc-1: first');
commit(repo, 'feat2.txt', 'f2\n', 'bc-1: second');
git(repo, 'checkout', '-q', 'main');
commit(repo, 'main1.txt', 'm1\n', 'main moves');
git(repo, 'checkout', '-q', 'feat');
git(repo, 'merge', '-q', '--no-ff', '-m', "Merge branch 'main' into feat", 'main');
commit(repo, 'feat3.txt', 'f3\n', 'bc-1: third');

// clash: edits the same line of a.txt that main will also edit.
git(repo, 'checkout', '-q', '-b', 'clash', base);
commit(repo, 'a.txt', 'one\nBRANCH\nthree\n', 'bc-2: branch side');
git(repo, 'checkout', '-q', 'main');
commit(repo, 'a.txt', 'one\nMAIN\nthree\n', 'main edits a.txt');

// picked: a commit whose patch main already has under another sha.
git(repo, 'checkout', '-q', '-b', 'picked', base);
commit(repo, 'pick.txt', 'p\n', 'bc-3: pick me');
const pickedSha = git(repo, 'rev-parse', 'HEAD');
git(repo, 'checkout', '-q', 'main');
git(repo, 'cherry-pick', pickedSha);
const mainSha = git(repo, 'rev-parse', 'HEAD');

/** A fresh worktree on main for a landing to happen in. */
let n = 0;
const fresh = () => {
  n += 1;
  const dir = path.join(tmp, `wt${n}`);
  git(repo, 'worktree', 'add', '-q', '--detach', dir, 'main');
  return dir;
};
const planFor = async (branch) => {
  const b = await rl.resolveBranch(repo, branch);
  const bs = await rl.resolveBase(repo, 'main');
  const commits = await rl.classifyCommits(repo, b.sha, bs.sha);
  return { branch, tip: b.sha, base: bs.name, baseSha: bs.sha, ...commits };
};

console.log('arguments');
await check('a branch alone parses, with main as the base', () => {
  const a = rl.parseArgs(['feat']);
  assert.equal(a.branch, 'feat');
  assert.equal(a.base, 'main');
  assert.equal(a.how, null);
});
await check('flags that take a value, and --dry-run, parse', () => {
  const a = rl.parseArgs(['feat', '--bead', 'bc-9', '--how', 'pick', '--dry-run']);
  assert.deepEqual([a.bead, a.how, a.dryRun], ['bc-9', 'pick', true]);
});
await check('a bad --how, a missing branch and an unknown flag are errors', () => {
  assert.match(rl.parseArgs(['feat', '--how', 'rebase']).error, /--how is one of/);
  assert.match(rl.parseArgs([]).error, /give the branch/);
  assert.match(rl.parseArgs(['feat', '--wat']).error, /unknown flag/);
  assert.match(rl.parseArgs(['feat', '--bead']).error, /needs a value/);
});

console.log('reading');
await check('a downmerge of main is set aside, the real commits stay in order', async () => {
  const p = await planFor('feat');
  assert.deepEqual(p.real.map((c) => c.subject), ['bc-1: first', 'bc-1: second', 'bc-1: third']);
  assert.equal(p.downmerges.length, 1);
  assert.match(p.downmerges[0].subject, /^Merge branch 'main'/);
  assert.equal(p.alreadyOnMain.length, 0);
});
await check('a commit whose patch main already has is reported, not re-picked', async () => {
  const p = await planFor('picked');
  assert.equal(p.alreadyOnMain.length, 1);
  assert.equal(p.real.length, 0);
});
await check('an unknown branch resolves to null', async () => {
  assert.equal(await rl.resolveBranch(repo, 'nope'), null);
});
await check('the preview of a clean branch is clean and writes nothing', async () => {
  const p = await planFor('feat');
  const before = git(repo, 'status', '--porcelain');
  const v = await rl.previewMerge(repo, p.baseSha, p.tip);
  assert.equal(v.ok, true);
  assert.equal(v.clean, true);
  assert.deepEqual(v.conflicted, []);
  assert.equal(git(repo, 'status', '--porcelain'), before);
});
await check('the preview names the conflicted file before anything is merged', async () => {
  const p = await planFor('clash');
  const v = await rl.previewMerge(repo, p.baseSha, p.tip);
  assert.equal(v.clean, false);
  assert.deepEqual(v.conflicted, ['a.txt']);
});

console.log('landing');
await check('--how merge commits, and the old tip becomes an ancestor of HEAD', async () => {
  const dir = fresh();
  const r = await rl.land(dir, await planFor('feat'), 'merge', { bead: 'bc-1' });
  assert.equal(r.ok, true, r.reason);
  git(dir, 'merge-base', '--is-ancestor', git(repo, 'rev-parse', 'feat'), 'HEAD');
  assert.match(git(dir, 'log', '-1', '--format=%s'), /^bc-1: land feat onto /);
});
await check('--how squash commits one commit and leaves the old tip unmerged', async () => {
  const dir = fresh();
  const r = await rl.land(dir, await planFor('feat'), 'squash', {});
  assert.equal(r.ok, true, r.reason);
  assert.equal(git(dir, 'rev-list', '--count', `${mainSha}..HEAD`), '1');
  assert.throws(() => git(dir, 'merge-base', '--is-ancestor', git(repo, 'rev-parse', 'feat'), 'HEAD'));
  assert.ok(fs.existsSync(path.join(dir, 'feat3.txt')));
});
await check('--how pick lands only the real commits, never the downmerge', async () => {
  const dir = fresh();
  const r = await rl.land(dir, await planFor('feat'), 'pick', {});
  assert.equal(r.ok, true, r.reason);
  assert.equal(git(dir, 'rev-list', '--count', `${mainSha}..HEAD`), '3');
  for (const f of ['feat1.txt', 'feat2.txt', 'feat3.txt']) assert.ok(fs.existsSync(path.join(dir, f)), f);
});
await check('a conflicting landing is left in progress with the files named', async () => {
  const dir = fresh();
  const r = await rl.land(dir, await planFor('clash'), 'merge', {});
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicted, ['a.txt']);
  assert.match(r.reason, /resolve them/);
});
await check('a dirty tree is refused before anything is touched', async () => {
  const dir = fresh();
  write(dir, 'stray.txt', 'x');
  const r = await rl.land(dir, await planFor('feat'), 'merge', {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /not clean/);
});
await check('a tree that is not on main is refused', async () => {
  const dir = path.join(tmp, 'off');
  git(repo, 'worktree', 'add', '-q', '--detach', dir, 'feat');
  const r = await rl.land(dir, await planFor('clash'), 'merge', {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /not on main/);
});

console.log('command');
await check('--dry-run prints the split and the conflicts and writes nothing', () => {
  const r = spawnSync('node', [BIN, 'clash', '--dry-run', '--dir', repo], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /real commits \(1\)/);
  assert.match(r.stdout, /conflict {2}a\.txt/);
  assert.match(r.stdout, /--how squash: .*close its card by hand/);
});
await check('an unknown branch exits 2', () => {
  const r = spawnSync('node', [BIN, 'nope', '--dry-run', '--dir', repo], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no local or origin branch named nope/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} of ${ran} failed` : `\n${ran} checks passed`);
process.exit(failures ? 1 : 0);
