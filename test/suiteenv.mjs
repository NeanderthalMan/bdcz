#!/usr/bin/env node
//
// A suite never inherits the observing switches from the runner that started it — bc-uy247.
//
//   node test/suiteenv.mjs
//
// On 2026-11-05 a full gate on main (main-20261105T134010545Z-m55l) was started with
// BEADCAUSE_OBSERVE in its environment, handed it to all 668 suites, and every suite that
// boots a daemon booted an *observing* one: writes answered 403, advocates "never act on
// their own", and 67 suites went red over code that passes every one of them alone. main
// read red and the merge queue held. This pins the fix at each runner: lib/gate.js's
// runSuite (bin/b7e-gate), scripts/test.mjs (npm test) and scripts/checks.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OBSERVE_VARS, suiteEnv } from '../lib/launchguard.js';
import { runSuite } from '../lib/gate.js';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let failed = 0;
let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${String(err.message).split('\n').join('\n      ')}`);
  }
}

await check('config.js reads exactly the switches suiteEnv removes', () => {
  assert.deepEqual(OBSERVE_VARS, ['BEADCAUSE_OBSERVE', 'BEADCAUSE_READONLY']);
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'config.js'), 'utf8');
  assert.match(src, /export const OBSERVING = OBSERVE_VARS\.some/);
});

await check('suiteEnv drops both observing switches and keeps everything else', () => {
  const out = suiteEnv({ BEADCAUSE_OBSERVE: '1', BEADCAUSE_READONLY: 'true', PATH: '/bin', BEADCAUSE_X: 'y' });
  assert.deepEqual(out, { PATH: '/bin', BEADCAUSE_X: 'y' });
});

await check('and does not touch the env it was given', () => {
  const given = { BEADCAUSE_OBSERVE: '1' };
  suiteEnv(given);
  assert.equal(given.BEADCAUSE_OBSERVE, '1');
});

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'suiteenv-'));
try {
  fs.mkdirSync(path.join(tmp, 'test'));
  fs.writeFileSync(
    path.join(tmp, 'test', 'probe.mjs'),
    `console.log('OBS=' + (process.env.BEADCAUSE_OBSERVE ?? '-') + ' RO=' + (process.env.BEADCAUSE_READONLY ?? '-'));\n`,
  );
  const saved = { o: process.env.BEADCAUSE_OBSERVE, r: process.env.BEADCAUSE_READONLY };
  process.env.BEADCAUSE_OBSERVE = '1';
  process.env.BEADCAUSE_READONLY = '1';
  try {
    await check('a gate started observing runs its suites not observing', async () => {
      const r = await runSuite(tmp, 'test/probe.mjs', { sandboxRoot: tmp });
      assert.equal(r.status, 'ok', r.out);
      assert.match(r.out, /OBS=- RO=-/);
    });
    await check('but a caller that asks for it by name still gets it', async () => {
      const r = await runSuite(tmp, 'test/probe.mjs', { sandboxRoot: tmp, env: { BEADCAUSE_OBSERVE: '1' } });
      assert.match(r.out, /OBS=1 RO=-/);
    });
  } finally {
    for (const [k, v] of [['BEADCAUSE_OBSERVE', saved.o], ['BEADCAUSE_READONLY', saved.r]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
} finally {
  removeTreeSync(tmp);
}

for (const rel of ['scripts/test.mjs', 'scripts/checks.mjs']) {
  await check(`${rel} spawns its suites through suiteEnv, not the raw process.env`, () => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /env: \{ \.\.\.suiteEnv\(\),/);
    assert.doesNotMatch(src, /env: \{ \.\.\.process\.env,/);
  });
}

console.log(failed ? `\n${failed}/${passed + failed} failed` : `\n${passed} checks passed`);
process.exit(failed ? 1 : 0);
