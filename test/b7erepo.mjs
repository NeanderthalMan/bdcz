#!/usr/bin/env node
//
// b7e-repo — what another workspace's checkout actually looks like, before writing a
// command aimed at it (bc-dgx7.113).
//
//   npm test
//   node test/b7erepo.mjs
//
// Driven as a real subprocess, the same split test/b7ewhere.mjs and test/b7ews.mjs use:
// `--dir` against a fixture tree proves the grouping and the interpreter fact without
// touching any real checkout on this Mac; `-w` against a fake `BEADCAUSE_CONFIG_DIR`
// (the same shape test/b7ews.mjs builds) proves the workspace-name path resolves through
// `resolveSessionDir` rather than a hand-rolled `path.dirname(ws.dir)` — the exact trap
// `ws-dir-is-the-beads-dir-not-the-checkout` warns a new b7e-* command not to fall into.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-repo');

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

console.log('\nb7e-repo\n');

function run(args, opts = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: ROOT, ...opts });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/* ------------------------------------------------------------------------- --help */

check('--help prints usage and exits 0', () => {
  const { status, stdout } = run(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /usage: b7e-repo/);
});

check('neither -w nor --dir is refused with exit 2', () => {
  const { status, stderr } = run([]);
  assert.equal(status, 2);
  assert.match(stderr, /one of -w\/--workspace or --dir is required/);
});

check('both -w and --dir together is refused with exit 2', () => {
  const { status, stderr } = run(['-w', 'x', '--dir', '.']);
  assert.equal(status, 2);
  assert.match(stderr, /mutually exclusive/);
});

/* --------------------------------------------------------------------- --dir fixture */

const write = (root, rel, content) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

const gitTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7erepo-git-'));
const git = (...args) => execFileSync('git', args, { cwd: gitTmp, stdio: ['ignore', 'pipe', 'pipe'] });
git('init', '-q');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'test');
write(gitTmp, 'lib/engine.py', 'def build(): pass\n');
write(gitTmp, 'docs/readme.md', '# hi\n');
write(gitTmp, 'ai-context/agents/sinew/prompt.md', 'you are sinew\n');
write(gitTmp, 'ai-context/agents/vox/prompt.md', 'you are vox\n');
write(gitTmp, 'tests/test_engine.py', 'assert True\n');
write(gitTmp, 'webapp/pages/arch.html', '<html></html>\n');
fs.mkdirSync(path.join(gitTmp, '.venv', 'bin'), { recursive: true });
fs.writeFileSync(path.join(gitTmp, '.venv', 'bin', 'python3'), '#!/bin/sh\n', { mode: 0o755 });
git('add', '-A');
git('commit', '-q', '-m', 'fixture');

check('--dir reports the resolved path, its HEAD, every surface and the interpreter', () => {
  const { status, stdout } = run(['--dir', gitTmp]);
  assert.equal(status, 0);
  assert.match(stdout, new RegExp(gitTmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(stdout, /source \(2 files\)/); // lib/engine.py + the tracked .venv/bin/python3 fixture
  assert.match(stdout, /docs \(3 files\)/); // readme.md + 2 ai-context prompts
  assert.match(stdout, /tests \(1 file\)/);
  assert.match(stdout, /served markup \(1 file\)/);
  assert.match(stdout, /ai-context\/agents \(2\)/);
  assert.match(stdout, /interpreter: .*\.venv\/bin\/python3/);
});

check('--dir --json prints one parseable object with the resolved root, head and layout', () => {
  const { status, stdout } = run(['--dir', gitTmp, '--json']);
  assert.equal(status, 0);
  const obj = JSON.parse(stdout);
  assert.equal(path.resolve(obj.root), path.resolve(gitTmp));
  assert.match(obj.head, /^[0-9a-f]{40}$/);
  assert.equal(obj.layout.bySurface.docs.count, 3);
  assert.match(obj.interpreter, /\.venv\/bin\/python3$/);
});

check('--run prints only the runnable facts, no surface grouping at all', () => {
  const { status, stdout } = run(['--dir', gitTmp, '--run']);
  assert.equal(status, 0);
  assert.match(stdout, /interpreter: .*\.venv\/bin\/python3/);
  assert.ok(!/source \(/.test(stdout), '--run must not print the tree grouping');
});

check('a --dir that does not exist exits non-zero naming the path, not an empty tree', () => {
  const { status, stdout, stderr } = run(['--dir', path.join(gitTmp, 'does-not-exist')]);
  assert.notEqual(status, 0);
  assert.match(stderr, /no such directory/);
  assert.equal(stdout, '');
});

/* ------------------------------------------------------------------ -w <workspace> */

const wsTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7erepo-ws-'));
const configDir = path.join(wsTmp, 'config');
fs.mkdirSync(configDir, { recursive: true });

// A workspace whose checkout is a real directory this test controls — same shape
// resolveSessionDir's "plain" branch expects: `dir` is the .beads tracker, and the
// checkout is that directory's parent (never assumed by this test — resolveSessionDir
// is what does the deriving; this only proves the CLI reaches the right answer).
const checkout = path.join(wsTmp, 'somerepo');
fs.mkdirSync(path.join(checkout, '.beads'), { recursive: true });
write(checkout, 'lib/a.py', 'x = 1\n');
write(checkout, 'docs/notes.md', 'hi\n');

fs.writeFileSync(
  path.join(configDir, 'config.json'),
  JSON.stringify({ workspaces: [{ name: 'somerepo', dir: path.join(checkout, '.beads') }] }, null, 2)
);

function runWs(args) {
  return run(args, { env: { ...process.env, HOME: wsTmp, BEADCAUSE_CONFIG_DIR: configDir } });
}

check('-w resolves the checkout through the workspace, not a hand-rolled path guess', () => {
  const { status, stdout } = runWs(['-w', 'somerepo']);
  assert.equal(status, 0);
  assert.match(stdout, new RegExp(checkout.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(stdout, /source \(1 file\)/);
  assert.match(stdout, /docs \(1 file\)/);
});

check('an unconfigured workspace name exits non-zero naming the workspace and where it looked', () => {
  const { status, stderr } = runWs(['-w', 'nonexistent-workspace']);
  assert.notEqual(status, 0);
  assert.match(stderr, /no workspace named "nonexistent-workspace"/);
  assert.match(stderr, /looked under:/);
});

await cleanupTmp(gitTmp);
await cleanupTmp(wsTmp);

console.log(`\n${ran - failures}/${ran} passed`);
process.exit(failures ? 1 : 0);
