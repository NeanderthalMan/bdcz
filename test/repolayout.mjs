#!/usr/bin/env node
//
// lib/repolayout.js — what a checkout looks like, grouped, plus the runnable facts
// (bc-dgx7.113). The pure halves are checked directly here; bin/b7e-repo's argv/printing
// is test/b7erepo.mjs, the same split test/b7ewhere.mjs uses for lib/where.js.
//
//   npm test
//   node test/repolayout.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const { gitHead, layoutFor, runnableFacts, topDirs, SURFACE_LABELS, SURFACE_ORDER } = await import(
  path.join(ROOT, 'lib', 'repolayout.js')
);

let failures = 0;
let ran = 0;
function check(name, fn) {
  ran += 1;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err && err.message ? err.message : String(err)).split('\n').join('\n       ')}`);
  }
}

console.log('\nrepolayout\n');

/* ---------------------------------------------------------------------------- topDirs */

check('topDirs: credits the first `depth` segments, not the leaf directory', () => {
  const files = [
    'ai-context/agents/sinew/prompt.md',
    'ai-context/agents/vox/prompt.md',
    'ai-context/agents/tally/prompt.md',
    'docs/readme.md',
  ];
  const dirs = topDirs(files, { depth: 2 });
  assert.deepEqual(dirs[0], { dir: 'ai-context/agents', count: 3 });
});

check('topDirs: a file with no directory at all (top-level) credits nothing', () => {
  const dirs = topDirs(['README.md', 'a/b.md'], { depth: 2 });
  assert.equal(dirs.length, 1);
  assert.equal(dirs[0].dir, 'a');
});

check('topDirs: sorted by count desc, ties broken alphabetically', () => {
  const files = ['b/1.js', 'a/1.js', 'a/2.js'];
  const dirs = topDirs(files, { depth: 2 });
  assert.deepEqual(dirs, [
    { dir: 'a', count: 2 },
    { dir: 'b', count: 1 },
  ]);
});

check('topDirs: respects limit', () => {
  const files = ['a/1', 'b/1', 'c/1', 'd/1'];
  assert.equal(topDirs(files, { depth: 2, limit: 2 }).length, 2);
});

check('topDirs: empty input is an empty list, not a crash', () => {
  assert.deepEqual(topDirs([]), []);
});

/* ---------------------------------------------------------------------- fixture tree */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-repolayout-'));
const write = (root, rel, content) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

const gitTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-repolayout-git-'));
const git = (...args) => execFileSync('git', args, { cwd: gitTmp, stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '-q');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'test');
write(gitTmp, '.gitignore', 'ignored_dir/\n');
write(gitTmp, 'lib/costing.py', 'PRICES = {}\n');
write(gitTmp, 'lib/engine.py', 'def build(): pass\n');
write(gitTmp, 'docs/readme.md', '# hi\n');
write(gitTmp, 'ai-context/agents/sinew/prompt.md', 'you are sinew\n');
write(gitTmp, 'ai-context/agents/vox/prompt.md', 'you are vox\n');
write(gitTmp, 'ai-context/agents/tally/prompt.md', 'you are tally\n');
write(gitTmp, 'tests/test_costing.py', 'assert True\n');
write(gitTmp, 'webapp/pages/arch.html', '<html></html>\n');
write(gitTmp, 'ignored_dir/should_not_appear.py', 'nope\n');
git('add', '-A');
git('commit', '-q', '-m', 'fixture');

check('layoutFor: groups into the same four surfaces lib/where.js uses', () => {
  const r = layoutFor(gitTmp);
  assert.deepEqual(SURFACE_ORDER, ['source', 'docs', 'tests', 'servedMarkup']);
  assert.equal(r.bySurface.source.count, 3); // .gitignore, lib/costing.py, lib/engine.py
  assert.equal(r.bySurface.docs.count, 4); // docs/readme.md + 3 ai-context prompts
  assert.equal(r.bySurface.tests.count, 1);
  assert.equal(r.bySurface.servedMarkup.count, 1);
});

check('layoutFor: a gitignored directory never leaks into the count', () => {
  const r = layoutFor(gitTmp);
  const allTopDirs = SURFACE_ORDER.flatMap((k) => r.bySurface[k].topDirs.map((d) => d.dir));
  assert.ok(!allTopDirs.includes('ignored_dir'));
});

check('layoutFor: three files spread across role subdirectories roll up to their shared parent', () => {
  const r = layoutFor(gitTmp);
  assert.deepEqual(r.bySurface.docs.topDirs[0], { dir: 'ai-context/agents', count: 3 });
});

check('layoutFor: filesTotal counts every surface together', () => {
  const r = layoutFor(gitTmp);
  assert.equal(r.filesTotal, 3 + 4 + 1 + 1);
});

check('gitHead: the current commit, present and 40 hex characters', () => {
  const head = gitHead(gitTmp);
  assert.match(head, /^[0-9a-f]{40}$/);
});

check('gitHead: null for a directory that is not a git repository at all', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-repolayout-nogit-'));
  assert.equal(gitHead(plain), null);
  fs.rmSync(plain, { recursive: true, force: true });
});

check('runnableFacts: no interpreter when there is no .venv at all', () => {
  assert.equal(runnableFacts(gitTmp).interpreter, null);
});

check('runnableFacts: python3 preferred over python when both exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-repolayout-venv-'));
  fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.venv', 'bin', 'python'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, '.venv', 'bin', 'python3'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(runnableFacts(dir).interpreter, path.join(dir, '.venv', 'bin', 'python3'));
  fs.rmSync(dir, { recursive: true, force: true });
});

check('runnableFacts: falls back to plain python when python3 is absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-repolayout-venv2-'));
  fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.venv', 'bin', 'python'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(runnableFacts(dir).interpreter, path.join(dir, '.venv', 'bin', 'python'));
  fs.rmSync(dir, { recursive: true, force: true });
});

await cleanupTmp(gitTmp);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${ran - failures}/${ran} passed`);
process.exit(failures ? 1 : 0);
