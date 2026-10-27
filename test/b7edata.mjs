#!/usr/bin/env node
//
// b7e-data — run a repo script with the data environment it needs in this worktree
// (bc-dgx7.175).
//
//   node test/b7edata.mjs
//
// Real throwaway git trees via lib/fixture.js: a "main checkout" whose LFS file is
// materialised on disk, and a linked worktree of it where that file is still a pointer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-data');
const { buildFixture, fixtureRoot } = await import(path.join(ROOT, 'lib', 'fixture.js'));
const data = await import(path.join(ROOT, 'lib', 'data.js'));

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${err.message}`);
  }
};
const run = (args, opts) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', ...opts });

console.log('\nb7e-data\n');

const POINTER = ['version https://git-lfs.github.com/spec/v1', 'oid sha256:' + 'a'.repeat(64), 'size 9', ''].join('\n');
const MANIFEST = {
  vars: [
    { var: 'ATLAS_ELEVATION_DIR', reads: ['maps/common.py'], holds: 'maps/web/elevation.bin' },
    { var: 'SITE_GRID_DIR', reads: ['maps/forge.py'], holds: 'maps/web/elevation.bin', dir: 'maps/web' },
  ],
};

const fx = buildFixture({
  name: 'b7edata-suite',
  steps: [
    { type: 'file', path: '.gitattributes', content: 'maps/web/*.bin filter=lfs -text\n' },
    { type: 'file', path: 'maps/web/elevation.bin', content: POINTER },
    { type: 'file', path: 'maps/common.py', content: 'import os\nx = os.environ.get("ATLAS_ELEVATION_DIR")\n' },
    { type: 'file', path: '.beadcause/data.json', content: JSON.stringify(MANIFEST) },
    { type: 'commit', message: 'seed' },
  ],
});
const MAIN = fs.realpathSync(fx.dir); // macOS tmp is a symlink; git reports the real path
const WT = path.join(path.dirname(MAIN), 'wt');
execFileSync('git', ['worktree', 'add', '-q', '-b', 'wt-branch', WT], { cwd: MAIN, env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' } });
// the main checkout materialises the real bytes; the worktree keeps the pointer
fs.writeFileSync(path.join(MAIN, 'maps/web/elevation.bin'), 'REAL BYTES');

check('resolves a pointer in the worktree to the main checkout', () => {
  const { results } = data.resolveAll(WT);
  assert.equal(results[0].source, 'main');
  assert.equal(data.envFor(results).ATLAS_ELEVATION_DIR, path.join(MAIN, 'maps/web'));
});

check('the main checkout itself needs no override', () => {
  const { results } = data.resolveAll(MAIN);
  assert.equal(results[0].source, 'here');
  assert.deepEqual(data.envFor(results), {});
});

check('--print names both variables, the modules that read them, and where the manifest came from', () => {
  const r = run(['--print', '--dir', WT]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /export ATLAS_ELEVATION_DIR=/);
  assert.match(r.stdout, /export SITE_GRID_DIR=/);
  assert.match(r.stderr, /from \.beadcause\/data\.json/);
  assert.match(r.stderr, /maps\/forge\.py/);
});

check('runs the command with the variables set and passes its exit code through', () => {
  const r = run(['--dir', WT, process.execPath, '-e', 'console.log(process.env.SITE_GRID_DIR); process.exit(3)'], { cwd: WT });
  assert.equal(r.status, 3);
  assert.equal(r.stdout.trim(), path.join(MAIN, 'maps/web'));
});

check('bytes nowhere on the machine: says so, exits non-zero, runs nothing', () => {
  fs.writeFileSync(path.join(MAIN, 'maps/web/elevation.bin'), POINTER);
  const marker = path.join(path.dirname(MAIN), 'ran');
  const r = run(['--dir', WT, process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nowhere on this machine/);
  assert.equal(fs.existsSync(marker), false);
  fs.writeFileSync(path.join(MAIN, 'maps/web/elevation.bin'), 'REAL BYTES');
});

check('--path for an undeclared file refuses', () => {
  const r = run(['--dir', WT, '--path', 'maps/other.bin', '--print']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not declared/);
});

check('--discover drafts entries from env reads', () => {
  const r = run(['--dir', WT, '--discover']);
  assert.equal(r.status, 0);
  const draft = JSON.parse(r.stdout);
  assert.equal(draft.vars[0].var, 'ATLAS_ELEVATION_DIR');
  assert.deepEqual(draft.vars[0].reads, ['maps/common.py']);
});

check('a malformed manifest is reported, exit 2', () => {
  const dir = path.join(path.dirname(MAIN), 'bad');
  fs.mkdirSync(path.join(dir, '.beadcause'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.beadcause/data.json'), '{nope');
  assert.match(data.loadManifest(dir).problems[0], /does not parse/);
});

check('no command and no --print is usage, exit 2', () => {
  assert.equal(run(['--dir', WT]).status, 2);
});

check('docs/b7e/b7e-data.md documents it', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'docs', 'b7e', 'b7e-data.md'), 'utf8'), /### .*b7e-data/);
});

check('registered in package.json', () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).bin['b7e-data'], 'bin/b7e-data');
});

fs.rmSync(path.join(fixtureRoot(), 'b7edata-suite'), { recursive: true, force: true });
console.log(`\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
