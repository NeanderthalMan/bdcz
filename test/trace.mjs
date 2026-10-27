#!/usr/bin/env node
//
// b7e-trace — where a bead's work actually is (bc-dgx7.96).
//
//   node test/trace.mjs
//
// Every check runs against a REAL throwaway git repo (a bare origin plus a clone), because
// the point of the tool is what `git log --grep`, `git grep` and `git log -G` really return
// across refs — the dotted-child boundary and `--source` attribution are exactly the things
// worth proving against git rather than assuming. GitHub is never asked (`pulls: false` /
// `--no-pr`).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-trace');

const { traceBeads } = await import(path.join(ROOT, 'lib', 'trace.js'));
const refs = await import(path.join(ROOT, 'lib', 'refs.js'));

let failures = 0;
const ok = (n) => console.log(`  \x1b[32m✓\x1b[0m ${n}`);
const bad = (n, d) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${d}`);
};
const check = async (name, fn) => {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b7e-trace-'));
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const commit = (dir, file, text, msg) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', msg);
};

const origin = path.join(tmp, 'origin.git');
const work = path.join(tmp, 'work');
sh(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
sh(tmp, 'clone', '-q', origin, work);
commit(work, 'README.md', 'hello\n', 'seed');
commit(work, 'a.js', 'x\n', 'bc-t.1: landed by commit message');
commit(work, 'notes.md', 'this came out of bc-t.2 originally\n', 'unrelated subject');
commit(work, 'c.js', 'x\n', 'bc-t.10: a dotted sibling that must not read as its parent');
commit(work, '.beads/issues.jsonl', '{"id":"bc-t.7"}\n', 'mirror');
sh(work, 'push', '-q', 'origin', 'main');

sh(work, 'checkout', '-q', '-b', 'worktree-msg');
commit(work, 'b.js', 'x\n', 'bc-t.3: only on a branch');
sh(work, 'checkout', '-q', 'main');
sh(work, 'checkout', '-q', '-b', 'worktree-file');
commit(work, 'doc.md', 'see bc-t.4 for the premise\n', 'a commit that never names the bead');
sh(work, 'checkout', '-q', 'main');
sh(work, 'push', '-q', 'origin', 'worktree-msg');

const ids = ['bc-t.1', 'bc-t.2', 'bc-t.3', 'bc-t.4', 'bc-t.5', 'bc-t.7'];
const r = await traceBeads(work, ids, { pulls: false });

console.log('\nlib/refs\n');
await check('idsNamedIn: a dotted child is not its parent, a longer id is not a prefix', () => {
  assert.deepEqual(refs.idsNamedIn('bc-t.10: x', ['bc-t.1']), []);
  assert.deepEqual(refs.idsNamedIn('bc-t.1.2: x', ['bc-t.1']), []);
  assert.deepEqual(refs.idsNamedIn('bc-t.1: x and bc-t.1.', ['bc-t.1']), ['bc-t.1']);
});
await check('allBranches lists local and origin branches once each, not HEAD', () => {
  const b = refs.allBranches(work);
  assert.ok(b.includes('worktree-msg') && b.includes('origin/worktree-msg') && !b.some((x) => /HEAD/.test(x)));
});

console.log('\ntraceBeads verdicts\n');
await check('resolves the trunk', () => assert.equal(r.trunk, 'origin/main'));
await check('commit message on trunk → landed via commit, and the dotted sibling does not leak in', () => {
  assert.equal(r.beads['bc-t.1'].verdict, 'landed');
  assert.equal(r.beads['bc-t.1'].via, 'commit');
  assert.equal(r.beads['bc-t.1'].trunkCommits.length, 1);
});
await check('named only in a tracked file on trunk → landed via file, not uncited', () => {
  assert.equal(r.beads['bc-t.2'].verdict, 'landed');
  assert.equal(r.beads['bc-t.2'].via, 'file');
  assert.deepEqual(r.beads['bc-t.2'].trunkFiles, ['notes.md']);
});
await check('only commit is on an unmerged branch → on-branch, and the branch is named', () => {
  assert.equal(r.beads['bc-t.3'].verdict, 'on-branch');
  assert.deepEqual(r.beads['bc-t.3'].branches, ['worktree-msg']);
});
await check('named only in a file an unmerged branch added → on-branch, never uncited', () => {
  assert.equal(r.beads['bc-t.4'].verdict, 'on-branch');
  assert.deepEqual(r.beads['bc-t.4'].branches, ['worktree-file']);
  assert.equal(r.beads['bc-t.4'].branchFiles[0].path, 'doc.md');
});
await check('named nowhere → uncited', () => assert.equal(r.beads['bc-t.5'].verdict, 'uncited'));
await check('.beads/ is not searched — the tracker mirror names every bead', () => assert.equal(r.beads['bc-t.7'].verdict, 'uncited'));
await check('an unresolvable trunk is refused, not an empty answer', async () => {
  const bad = await traceBeads(work, ids, { trunk: 'nope', pulls: false });
  assert.equal(bad.ok, false);
});

console.log('\nbin/b7e-trace\n');
const run = (...a) => spawnSync('node', [BIN, '--dir', work, '--no-pr', ...a], { encoding: 'utf8' });
await check('--json: one object, exit 1 when anything is not landed', () => {
  const p = run('bc-t.1', 'bc-t.3', '--json');
  assert.equal(p.status, 1);
  const o = JSON.parse(p.stdout);
  assert.equal(o.beads['bc-t.3'].verdict, 'on-branch');
});
await check('exit 0 when every bead is landed', () => assert.equal(run('bc-t.1', 'bc-t.2').status, 0));
await check('--stdin takes ids', () => {
  const p = spawnSync('node', [BIN, '--dir', work, '--no-pr', '--stdin', '--json'], { encoding: 'utf8', input: 'bc-t.1\nbc-t.5\n' });
  assert.deepEqual(Object.keys(JSON.parse(p.stdout).beads), ['bc-t.1', 'bc-t.5']);
});
await check('no ids is a usage error (exit 2)', () => assert.equal(run().status, 2));
await check('single-bead report names the branch', () => assert.match(run('bc-t.3').stdout, /worktree-msg/));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
