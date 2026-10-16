#!/usr/bin/env node
/**
 * `b7e-xbead` — lib/xbead.js and bin/b7e-xbead (bc-dgx7.192).
 *
 *     npm test
 *     node test/xbead.mjs
 *
 * The deciding is pure and proved against fixtures: prefix → tracker, the fixed record
 * shape, the exit codes. The binary is then spawned for the paths that need no tracker
 * — usage, an unknown prefix — which must exit 3 naming the prefix rather than answer a
 * silent "not found".
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveTarget, lastComment, shape, render, EXIT } from '../lib/xbead.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'b7e-xbead');

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 10).join('\n       ')}`);
  }
};

const prefixes = new Map([['bc', 'beadcause'], ['lm', 'loremia']]);
const known = ['beadcause', 'loremia'];

check('a bare id is routed by its prefix, from anywhere', () => {
  assert.deepEqual(resolveTarget('bc-irzp7', prefixes, known), { workspace: 'beadcause', id: 'bc-irzp7' });
  assert.deepEqual(resolveTarget('lm-vary', prefixes, known), { workspace: 'loremia', id: 'lm-vary' });
  assert.deepEqual(resolveTarget('bc-dgx7.192', prefixes, known), { workspace: 'beadcause', id: 'bc-dgx7.192' });
});

check('workspace/id names the tracker outright', () => {
  assert.deepEqual(resolveTarget('beadcause/bc-irzp7', prefixes, known), { workspace: 'beadcause', id: 'bc-irzp7' });
});

check('an unknown prefix is refused by name, never a silent not-found', () => {
  const r = resolveTarget('zz-1', prefixes, known);
  assert.equal(r.error, 'unknown');
  assert.match(r.reason, /prefix zz-/);
  assert.match(r.reason, /bc, lm/);
});

check('an unknown workspace and a non-id are refused', () => {
  assert.equal(resolveTarget('nope/bc-1', prefixes, known).error, 'unknown');
  assert.equal(resolveTarget('hello', prefixes, known).error, 'usage');
  assert.equal(resolveTarget('', prefixes, known).error, 'usage');
});

check('last comment is the newest by date, with its author', () => {
  const c = lastComment([
    { created_at: '2026-09-01T00:00:00Z', author: 'a', text: 'old' },
    { created_at: '2026-09-17T00:00:00Z', author: 'b', text: 'new' },
  ]);
  assert.equal(c.author, 'b');
  assert.equal(lastComment([]), null);
});

check('shape counts open children and open blockers, including a far marker', () => {
  const rec = shape(
    'loremia',
    {
      id: 'lm-vary',
      title: 'T',
      status: 'open',
      assignee: 'x',
      labels: ['blocked-by:beadcause/bc-irzp7'],
      dependencies: [
        { id: 'lm-1', dependency_type: 'blocks', status: 'open' },
        { id: 'lm-2', dependency_type: 'blocks', status: 'closed' },
        { id: 'lm-3', dependency_type: 'parent-child', status: 'open' },
      ],
    },
    [{ id: 'lm-vary.1', status: 'open' }, { id: 'lm-vary.2', status: 'closed' }]
  );
  assert.deepEqual(rec.openBlockers, ['lm-1', 'beadcause/bc-irzp7']);
  assert.deepEqual(rec.openChildren, ['lm-vary.1']);
  assert.equal(rec.tracker, 'loremia');
  assert.match(render(rec), /tracker:\s+loremia[\s\S]*status:[\s\S]*assignee:[\s\S]*open children:[\s\S]*open blockers:[\s\S]*last comment:/);
});

check('exit codes are the documented ones', () => {
  assert.equal(EXIT.unknown, 3);
  assert.equal(EXIT.ok, 0);
});

const run = (...args) => spawnSync('node', [BIN, ...args], { encoding: 'utf8' });

check('the binary exits 3 and names the prefix for an unknown one', () => {
  const r = run('zz-1');
  assert.equal(r.status, 3);
  assert.match(r.stdout + r.stderr, /prefix zz-/);
});

check('the binary exits 2 with no ids and 0 on --help', () => {
  assert.equal(run().status, 2);
  assert.equal(run('--help').status, 0);
  assert.equal(run('--bogus', 'bc-1').status, 2);
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall ok');
