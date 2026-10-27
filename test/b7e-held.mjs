#!/usr/bin/env node
//
// b7e-held — who holds a bead's lease (bc-dgx7.198).
//
//   node test/b7e-held.mjs
//
// lib/leaseheld.js over fixed labels and a fixed clock: live, expired, own and foreign leases
// and several held: labels on one bead; plus the CLI's usage paths.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'b7e-held');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-held-'));
const configDir = path.join(tmp, 'config');
fs.mkdirSync(configDir, { recursive: true });

const { heldReport } = await import(path.join(ROOT, 'lib', 'leaseheld.js'));

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${String(err?.message || err).split('\n').join('\n       ')}`);
  }
}

const NOW = new Date('2026-10-23T15:40:00Z');
const ME = 'me@example.com';
const THEM = 'them@example.com';

console.log('\nreport\n');
await check('no held: label → nobody holds it', () => {
  const r = heldReport(['agent-filed', 'self-started-skills'], ME, { now: NOW });
  assert.deepEqual(r.leases, []);
  assert.equal(r.summary, 'nobody holds it');
  assert.equal(r.holder, null);
  assert.equal(r.lost, false);
});
await check('own live lease: live, yours, holder, 4m old', () => {
  const r = heldReport([`held:20261023T153600Z:${ME}`], ME, { now: NOW });
  assert.equal(r.leases.length, 1);
  assert.deepEqual([r.leases[0].live, r.leases[0].mine, r.leases[0].holder, r.leases[0].ageMinutes], [true, true, true, 4]);
  assert.equal(r.mine, true);
  assert.equal(r.summary, `${ME}'s Mac claimed it 4m ago`);
});
await check('expired lease holds nothing', () => {
  const r = heldReport([`held:20261023T120000Z:${THEM}`], ME, { now: NOW });
  assert.equal(r.leases[0].live, false);
  assert.equal(r.holder, null);
  assert.equal(r.summary, 'nobody holds it');
  assert.equal(r.stale, 1);
});
await check('foreign live lease: not mine, and this Mac has lost', () => {
  const r = heldReport([`held:20261023T153600Z:${THEM}`], ME, { now: NOW });
  assert.deepEqual([r.leases[0].mine, r.leases[0].holder, r.lost], [false, true, true]);
});
await check('several labels: earliest live stamp holds, the expired one is listed expired', () => {
  const r = heldReport([`held:20261023T153000Z:${THEM}`, `held:20261023T153500Z:${ME}`, `held:20261023T100000Z:${ME}`], ME, { now: NOW });
  assert.equal(r.leases.length, 3);
  assert.equal(r.holder, THEM);
  assert.equal(r.leases.filter((l) => l.holder).length, 1);
  assert.equal(r.leases.filter((l) => !l.live).length, 1);
  assert.equal(r.lost, true);
});
await check('a malformed held: label is dropped, not sorted to the front', () => {
  const r = heldReport(['held:garbage', `held:20261023T153600Z:${ME}`], ME, { now: NOW });
  assert.equal(r.leases.length, 1);
});
await check('no handle: nothing is mine and nobody has lost', () => {
  const r = heldReport([`held:20261023T153600Z:${THEM}`], null, { now: NOW });
  assert.deepEqual([r.leases[0].mine, r.lost, r.handle], [false, false, null]);
});
await check('leaseMinutes is honoured', () => {
  const r = heldReport([`held:20261023T153600Z:${ME}`], ME, { now: NOW, minutes: 3 });
  assert.equal(r.leases[0].live, false);
});

console.log('\ncli\n');
const run = (...args) =>
  spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, BEADCAUSE_CONFIG_DIR: configDir } });
await check('--help exits 0 with usage', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage: b7e-held/);
});
await check('missing -w is exit 2', () => assert.equal(run('-b', 'x-1').status, 2));
await check('missing -b is exit 2', () => assert.equal(run('-w', 'nope').status, 2));
await check('unknown workspace is exit 4', () => assert.equal(run('-w', 'nope', '-b', 'x-1').status, 4));

cleanupTmp(tmp);
if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall passed');
