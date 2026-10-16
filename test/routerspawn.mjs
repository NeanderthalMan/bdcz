/**
 * A backend that cannot even be spawned fails one start — it does not take the router down.
 *
 * bc-ek0fx: at 00:10 on 2026-09-18 the checkout was unreadable for a few seconds. The
 * router's disk watcher stamped it as build `e3b0c44298fc` — the SHA-256 of no files at
 * all — swapped onto it, and spawned a backend whose `cwd` did not exist. Node reports a
 * missing `cwd` as `spawn <node> ENOENT`, as an `error` event on the child, and
 * `spawnBackend` had no listener for it — so it was thrown out of the router, the one
 * process holding the port, as an uncaughtException.
 *
 * Two claims:
 *
 *   1. `spawnBackend`, lifted out of bin/router.js and run against a real `spawn` into a
 *      directory that does not exist, rejects with a `STOPPED` startup error (deferred,
 *      never poison) and nothing escapes as an uncaught exception;
 *   2. an unreadable checkout stamps as `EMPTY_STAMP`, and the disk watcher does not
 *      treat that as a build to swap onto.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-routerspawn-'));

const { STOPPED, poisonable, startupError, exitKind, PORTLOST } = await import(
  path.join(ROOT, 'lib', 'startup.js')
);
const { EMPTY_STAMP } = await import(path.join(ROOT, 'lib', 'build.js'));

const ROUTER_SRC = fs.readFileSync(path.join(ROOT, 'bin', 'router.js'), 'utf8');

/* ------------------------------------------------------------------- harness */

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`);
  }
}
const done = () => {
  removeTreeSync(tmp);
  console.log(failures ? `\n${failures} of ${ran} failed` : `\n${ran} passed`);
  process.exit(failures ? 1 : 0);
};

/** The source of one top-level `async function` / `function`, up to its closing brace. */
function lift(name) {
  const start = ROUTER_SRC.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} is not in bin/router.js`);
  const end = ROUTER_SRC.indexOf('\n}\n', start);
  return ROUTER_SRC.slice(start, end + 2);
}

/* ------------------------------------------------------------------- 1 */

await check('a spawn into a missing directory rejects STOPPED, and nothing is thrown out of the process', async () => {
  const uncaught = [];
  const onUncaught = (err) => uncaught.push(err);
  process.on('uncaughtException', onUncaught);
  const exits = [];
  try {
    const ctx = vm.createContext({
      spawn,
      process,
      String,
      Date,
      Set,
      Math,
      Promise,
      setTimeout,
      BACKEND: path.join(ROOT, 'bin', 'beadcause.js'),
      ROOT: path.join(tmp, 'gone'),
      LOADED_ENV: 'BEADCAUSE_TEST_LOADED',
      freePort: async () => 1,
      localJson: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      onBackendExit: (be, code, signal) => exits.push({ code, signal }),
      startupError,
      exitKind,
      STOPPED,
      PORTLOST,
      TIMEOUT: 'timeout',
    });
    vm.runInContext(`${lift('spawnBackend')}\nthis.spawnBackend = spawnBackend;`, ctx);
    const err = await ctx.spawnBackend(5000).then(
      () => null,
      (e) => e
    );
    assert.ok(err, 'spawnBackend resolved for a child that was never spawned');
    assert.equal(err.kind, STOPPED);
    assert.match(err.message, /could not be started — spawn .* ENOENT/);
    assert.equal(poisonable(err.kind), false, 'a spawn failure must never poison a build');
    // Give any late `error` emission a turn to escape, were it going to.
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(uncaught, []);
  } finally {
    process.off('uncaughtException', onUncaught);
  }
});

/* ------------------------------------------------------------------- 2 */

await check('an unreadable checkout stamps as EMPTY_STAMP', async () => {
  // A copy of lib/build.js whose ROOT has neither lib/ nor bin/ — what the router saw.
  const dir = path.join(tmp, 'unreadable', 'src');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'lib', 'build.js'), path.join(dir, 'build.js'));
  const { buildStamp } = await import(path.join(dir, 'build.js'));
  assert.equal(buildStamp(), EMPTY_STAMP);
  assert.equal(EMPTY_STAMP, 'e3b0c44298fc');
});

await check('the disk watcher refuses to swap onto EMPTY_STAMP', () => {
  const watch = lift('watchDisk');
  const guard = watch.indexOf('disk === EMPTY_STAMP');
  assert.ok(guard > 0, 'watchDisk never compares against EMPTY_STAMP');
  assert.ok(guard < watch.indexOf('bringUp('), 'the guard has to come before the swap');
});

done();
