/**
 * The check that lets a beadcause promotion say more than cannot-say — bc-rfnr.9.13.
 *
 * lib/singledriver.js runs `deploys.<key>.checks` after the deploy, and beadcause's own
 * entry declared none, so every beadcause promotion ended cannot-say however well the
 * restart went. What has to hold for the fix to mean anything, in the order it goes wrong:
 *
 * 1. **The daemon says which commit it is running.** `/api/health` carries `commit`, and it is
 *    the checkout's HEAD — a real read of this tree, not a constant, and not the router's
 *    bundle-hash build id.
 * 2. **The comparison is on the commit and nothing softer.** Same commit passes, a different
 *    one fails, an abbreviation of the right one passes, and an id too short to mean anything
 *    matches nothing.
 * 3. **The check waits for the restart it is checking, and gives up saying why.** A daemon
 *    that is not answering yet, or is answering as the old commit, is retried; one still wrong
 *    at the deadline is a failure whose sentence names what it saw.
 * 4. **The script is what `deployFor` declares.** Run for real against a real `createApp`, with
 *    the argv the driver would run, it exits 0 for the commit being served and 2 when it was
 *    handed nothing to look for.
 *
 * The declaration itself (own entry gets the check, `"checks": []` turns it off, another repo
 * never gets one) is in test/owndeploy.mjs, where the rest of the own-deploy rules are.
 *
 *     npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-serving-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { sameCommit, waitForCommit } = await import(path.join(ROOT, 'scripts', 'serving.mjs'));
const { headCommit, servingCheck } = await import(path.join(ROOT, 'lib', 'deploy.js'));
const { createApp } = await import(path.join(ROOT, 'lib', 'server.js'));

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

/* ------------------------------------------------------------- 2. the comparison */

assert.equal(sameCommit(A, A), true, 'the same commit is the same');
assert.equal(sameCommit(A, B), false, 'a different commit is not');
assert.equal(sameCommit(A.slice(0, 8), A), true, 'an abbreviation of the right one passes');
assert.equal(sameCommit(A, A.slice(0, 8)), true, 'in either direction');
assert.equal(sameCommit(A.slice(0, 8), B), false, 'an abbreviation of another is not it');
assert.equal(sameCommit(A.slice(0, 6), A), false, 'six characters name nothing');
assert.equal(sameCommit('', ''), false, 'nothing matches nothing');
assert.equal(sameCommit('{image}', '{image}'), false, 'an unexpanded placeholder is not a commit');
assert.equal(sameCommit(A.toUpperCase(), A), true, 'case is not a difference');

/* ------------------------------------------------------- 3. waiting, then giving up */

/** A clock and a `sleep` that moves it, and a `get` that plays `answers` and then repeats the last. */
function scripted(answers) {
  let t = 0;
  let i = 0;
  const seen = [];
  return {
    seen,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    get: async (url) => {
      seen.push(url);
      return answers[Math.min(i++, answers.length - 1)];
    },
  };
}

{
  const s = scripted([{ error: 'ECONNREFUSED' }, { error: 'HTTP 503' }, { commit: B }, { commit: A }]);
  const got = await waitForCommit('http://x', A, s);
  assert.equal(got.ok, true, 'a restart in progress, then the old commit, then the new one, is a pass');
  assert.equal(s.seen.length, 4, 'and it asked until it heard the right answer');
  assert.ok(s.seen.every((u) => u === 'http://x/api/health'), 'always the health route');
}
{
  const s = scripted([{ commit: B }]);
  const got = await waitForCommit('http://x', A, { ...s, deadlineMs: 5000 });
  assert.equal(got.ok, false, 'still the old commit at the deadline fails');
  assert.match(got.detail, new RegExp(`serving ${B}, not ${A}`), 'and says which two commits disagreed');
}
{
  const s = scripted([{ error: 'ECONNREFUSED' }]);
  const got = await waitForCommit('http://x', A, { ...s, deadlineMs: 5000 });
  assert.equal(got.ok, false, 'never answering fails');
  assert.match(got.detail, /did not answer \(ECONNREFUSED\)/);
}
{
  const s = scripted([{ commit: null }]);
  const got = await waitForCommit('http://x', A, { ...s, deadlineMs: 5000 });
  assert.equal(got.ok, false, 'answering with no commit is not a pass — a daemon from before this field is not proof');
  assert.match(got.detail, /without reporting a commit/);
}

/* ------------------------------------- 1 and 4. the real daemon, the real script */

const head = headCommit(ROOT);
assert.match(head || '', /^[0-9a-f]{40,64}$/, 'this test runs in a checkout, so HEAD has an answer');
assert.equal(headCommit(tmp), null, 'a directory that is no checkout has none, and says so with null rather than throwing');

const cfg = {
  token: 'test-token',
  bdBin: '/bin/false',
  actor: 'checker',
  workspaces: [{ name: 'acme', dir: path.join(tmp, 'acme') }],
  assetRoots: [],
  autoDispatch: false,
};
const app = createApp(cfg);
const server = http.createServer(app.handler);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
assert.equal(health.ok, true);
assert.deepEqual(health.workspaces, ['acme'], 'what health already said, still said');
assert.equal(health.commit, head, '/api/health reports the checkout HEAD the process booted from');

// The port comes from the config file, as it does for the real script.
fs.writeFileSync(path.join(process.env.BEADCAUSE_CONFIG_DIR, 'config.json'), JSON.stringify({ port }));

/** The declared check, run the way lib/singledriver.js runs one: argv, in the checkout. */
const run = (image) =>
  new Promise((resolve) => {
    const c = servingCheck().command.map((a) => a.replaceAll('{dir}', ROOT).replaceAll('{image}', image));
    execFile(c[0], c.slice(1), { cwd: ROOT, env: process.env, timeout: 30000 }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, out: `${stdout}${stderr}` }));
  });

const served = await run(head);
assert.equal(served.code, 0, `the declared check passes for the commit the daemon serves — ${served.out}`);
assert.match(served.out, new RegExp(head));

const nothing = await run('');
assert.equal(nothing.code, 2, 'handed nothing to look for it says so and does not wait');

const unexpanded = await run('{image}');
assert.equal(unexpanded.code, 2, 'a placeholder that never got expanded is nothing to look for either');

server.close();
app.close?.();
cleanupTmp(tmp);
console.log('serving: ok');
process.exit(0);
