#!/usr/bin/env node
//
// b7e-linux (bc-dgx7.203) — the container recipe's verdict reading and the CLI's exit codes,
// driven without a Docker daemon: lib/linux.js with an injected runner, and bin/b7e-linux
// against a fake `docker` named by B7E_LINUX_DOCKER.
//
//   npm test
//   node test/b7elinux.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, dockerState, verdict, allSuites, hostedState, stripAnsi, runArgs, execArgs,
  setupScript, PACKAGES, DEFAULT_IMAGE,
} from '../lib/linux.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'b7e-linux');
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  \x1b[32m✓\x1b[0m ${name}`); } catch (e) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message.split('\n')[0]}`);
  }
};

console.log('\nargv');
check('suites and flags parse', () => {
  const o = parseArgs(['test/a.mjs', '--keep', '--image=x:1', '--tail', '5']);
  assert.deepEqual(o.suites, ['test/a.mjs']);
  assert.equal(o.keep, true);
  assert.equal(o.image, 'x:1');
  assert.equal(o.tail, 5);
  assert.equal(parseArgs(['--all']).image, DEFAULT_IMAGE);
});
check('nothing to run, --all with names, and unknown flags are refused', () => {
  assert.ok(parseArgs([]).error);
  assert.ok(parseArgs(['--all', 'test/a.mjs']).error);
  assert.ok(parseArgs(['--nope']).error);
});

console.log('\nverdicts');
check('exit 0 is pass; ANSI never reaches a verdict', () => {
  assert.equal(verdict('s', { status: 0, stdout: '\x1b[32m✓\x1b[0m ok' }).status, 'pass');
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
});
check('a suite that only skips is skipped, with its own reason', () => {
  const v = verdict('s', { status: 0, stdout: 'skipped: needs a tty\n' });
  assert.equal(v.status, 'skipped');
  assert.equal(v.detail, 'needs a tty');
});
check('some checks plus a skip is still a pass, and says so', () => {
  const v = verdict('s', { status: 0, stdout: '✓ a\nskipped: no launchd\n' });
  assert.equal(v.status, 'pass');
  assert.match(v.detail, /no launchd/);
});
check('a failure carries the tail, ANSI stripped, and nothing earlier', () => {
  const out = Array.from({ length: 100 }, (_, i) => `\x1b[31mline ${i}\x1b[0m`).join('\n');
  const v = verdict('s', { status: 1, stdout: out }, 3);
  assert.equal(v.status, 'fail');
  assert.equal(v.tail, 'line 97\nline 98\nline 99');
});
check('a timeout is a failure, named', () => {
  const v = verdict('s', { status: null, error: { code: 'ETIMEDOUT' }, stdout: '' });
  assert.equal(v.status, 'fail');
  assert.equal(v.detail, 'timed out');
});

console.log('\nrecipe');
check('the package set covers what the suites shell out to', () => {
  for (const p of ['tmux', 'zsh', 'expect', 'lsof', 'jq']) assert.ok(PACKAGES.includes(p), p);
  assert.match(setupScript(), /chmod 1777 \/tmp/);
});
check('the checkout is mounted read-only and suites run as the non-root user', () => {
  assert.ok(runArgs('c', 'img', '/d').includes('/d:/src:ro'));
  const a = execArgs('c', 'test/x.mjs');
  assert.equal(a[a.indexOf('-u') + 1], 'node');
});
check('--all drops browse and non-suite files', () => {
  assert.deepEqual(allSuites(['test/b.mjs', 'test/a.mjs', 'test/browse.mjs', 'test/helpers/x.mjs', 'test/x.json']), ['test/a.mjs', 'test/b.mjs']);
});

console.log('\ndocker state and the hosted fallback');
check('missing runtime and dead daemon are told apart, in words', () => {
  assert.match(dockerState(() => ({ error: { code: 'ENOENT' } }), 'docker').reason, /no docker runtime/);
  assert.match(dockerState(() => ({ status: 1, stderr: 'Cannot connect' }), 'docker').reason, /daemon is not running/);
  assert.equal(dockerState(() => ({ status: 0, stdout: '27.0\n' }), 'docker').ok, true);
});
check('a hosted job with zero steps reads "refused, 0 steps"', () => {
  const run = (cmd, args) => (args[1] === 'list'
    ? { status: 0, stdout: JSON.stringify([{ databaseId: 7, headBranch: 'main', createdAt: 't' }]) }
    : { status: 0, stdout: JSON.stringify({ jobs: [{ name: 'test-linux', status: 'completed', conclusion: 'failure', steps: [] }] }) });
  assert.match(hostedState(run), /run 7 .*refused, 0 steps/);
});

console.log('\nthe command');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b7e-linux-'));
try {
  fs.mkdirSync(path.join(tmp, 'test'));
  fs.writeFileSync(path.join(tmp, 'test', 'good.mjs'), '');
  fs.writeFileSync(path.join(tmp, 'test', 'bad.mjs'), '');
  fs.writeFileSync(path.join(tmp, 'test', 'skip.mjs'), '');
  const fake = path.join(tmp, 'fakedocker');
  fs.writeFileSync(fake, `#!${process.execPath}
const a = process.argv.slice(2);
if (a[0] === 'info') { if (process.env.FAKE_DOWN) { console.error('Cannot connect to the Docker daemon'); process.exit(1); } console.log('27.0'); process.exit(0); }
if (a[0] === 'exec' && a.includes('jq')) { console.log('jq-1.6'); process.exit(0); }
if (a[0] === 'exec' && a.includes('node') && a.includes('test/bad.mjs')) { console.log('\\x1b[31m✗ boom\\x1b[0m'); process.exit(1); }
if (a[0] === 'exec' && a.includes('node') && a.includes('test/skip.mjs')) { console.log('skipped: no tty'); process.exit(0); }
if (a[0] === 'exec' && a.includes('node')) { console.log('✓ fine'); process.exit(0); }
process.exit(0);
`);
  fs.chmodSync(fake, 0o755);
  const empty = path.join(tmp, 'emptybin');
  fs.mkdirSync(empty);
  const go = (args, env = {}) => spawnSync(process.execPath, [BIN, '--dir', tmp, ...args], {
    encoding: 'utf8', env: { PATH: empty, B7E_LINUX_DOCKER: fake, ...env },
  });

  check('all green exits 0 with one line per suite and the image line', () => {
    const r = go(['test/good.mjs', 'test/skip.mjs']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^pass\s+test\/good.mjs/m);
    assert.match(r.stdout, /^skipped\s+test\/skip.mjs\s+\(no tty\)/m);
    assert.match(r.stdout, /image node:22-bookworm · jq-1.6 · packages tmux/);
  });
  check('a red suite exits 1 and prints its tail without ANSI', () => {
    const r = go(['test/good.mjs', 'test/bad.mjs']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^fail\s+test\/bad.mjs/m);
    assert.match(r.stdout, /── test\/bad.mjs ──\n✗ boom/);
    assert.ok(!r.stdout.includes('\x1b'));
  });
  check('--all runs the directory listing', () => {
    const r = go(['--all']);
    assert.equal(r.status, 1);
    for (const s of ['good', 'bad', 'skip']) assert.match(r.stdout, new RegExp(`test/${s}.mjs`));
  });
  check('a dead daemon exits 2 and says so, then reports the hosted state', () => {
    const r = go(['test/good.mjs'], { FAKE_DOWN: '1' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refused — the Docker daemon is not running/);
    assert.match(r.stderr, /hosted test-linux:/);
  });
  check('a missing runtime exits 2 naming that', () => {
    const r = go(['test/good.mjs'], { B7E_LINUX_DOCKER: path.join(tmp, 'nope') });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no docker runtime/);
  });
  check('a suite that is not there and a bad flag exit 64', () => {
    assert.equal(go(['test/ghost.mjs']).status, 64);
    assert.equal(go(['--nope']).status, 64);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nb7e-linux: all checks passed');
