// lib/pipelinehook.js — the promotion driver that is an external program (bc-y8k4.3).
//
// Everything but the last few checks drives `hookDriver` with a fake `exec`, so the reading of
// a hook's answer is pinned with no process at all. The last ones spawn a real `node` to prove
// runHook's three ways of never answering — not found, timed out, exited without reading stdin.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = (f) => path.join(ROOT, 'lib', f);
const { readHook, answerOf, hookDriver, runHook, pipelineDriver, beadRepoOf, HOOK_FILE, PIPELINE } = await import(LIB('pipelinehook.js'));
const { readStep, STEPS, SINGLE_STEPS } = await import(LIB('promoterun.js'));
const { driverSpecFor, loadDriver } = await import(LIB('promotesweep.js'));

let ran = 0;
let failures = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err && err.message ? err.message : String(err)).split('\n').join('\n       ')}`);
  }
}

console.log('\nlib/pipelinehook.js — the pipeline hook\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-pipelinehook-'));
const declare = (dir, body) => {
  fs.mkdirSync(path.join(dir, '.beadcause'), { recursive: true });
  fs.writeFileSync(path.join(dir, HOOK_FILE), typeof body === 'string' ? body : JSON.stringify(body));
};
const hook = (over = {}) => ({ run: ['pipe'], environments: 2, timeoutMs: 1000, dir: '/repo', file: '/repo/.beadcause/pipeline.json', ...over });
const answering = (out) => async () => out;

/* ------------------------------------------------------------------ the declaration */

await check('readHook: a missing file is `missing`, so a caller can tell undeclared from declared wrong', async () => {
  const got = readHook(path.join(tmp, 'nothing-here'));
  assert.equal(got.missing, true);
  assert.match(got.why, /does not exist/);
  assert.equal(readHook('').missing, true);
});

await check('readHook: defaults to two environments and an hour; argv is kept as given', async () => {
  const dir = path.join(tmp, 'ok');
  declare(dir, { run: ['node', 'tools/p.mjs'] });
  const { hook: h, why } = readHook(dir);
  assert.equal(why, undefined);
  assert.deepEqual(h.run, ['node', 'tools/p.mjs']);
  assert.equal(h.environments, 2);
  assert.equal(h.timeoutMs, 60 * 60000);
  assert.equal(h.dir, dir);
});

await check('readHook: bad JSON, no run, a shell string, a bad environment count or timeout — each refused by name, none missing', async () => {
  const cases = [
    ['{nope', /is not JSON/],
    [{}, /has no `run`/],
    [{ run: 'deploy.sh uat' }, /has no `run`/],
    [{ run: ['ok', ''] }, /has no `run`/],
    [{ run: ['x'], environments: 3 }, /must be 1 or 2/],
    [{ run: ['x'], timeoutMinutes: 0 }, /positive number/],
  ];
  for (const [i, [body, re]] of cases.entries()) {
    const dir = path.join(tmp, `bad-${i}`);
    declare(dir, body);
    const got = readHook(dir);
    assert.match(got.why || '', re, JSON.stringify(body));
    assert.ok(!got.missing, 'declared wrong is not undeclared');
  }
});

await check('beadRepoOf: the directory the workspace\'s .beads lives in', async () => {
  assert.equal(beadRepoOf({ dir: '/Users/x/northwind.dev/architecture/.beads' }), '/Users/x/northwind.dev/architecture');
  assert.equal(beadRepoOf({}), '');
});

/* ------------------------------------------------------------------ the answer */

await check('answerOf: the last stdout line that parses as an object — log lines above it are fine', async () => {
  assert.deepEqual(answerOf('starting\n{"state":"passed","image":"a"}\n'), { state: 'passed', image: 'a' });
  assert.deepEqual(answerOf('{"state":"failed"}\n{not json\n'), { state: 'failed' }, 'a broken last brace line does not hide the answer above it');
  assert.equal(answerOf('[1,2]\n'), null, 'an array is not an answer');
  assert.equal(answerOf(''), null);
});

/* ------------------------------------------------------------------ the driver */

await check('hookDriver: two environments export the four calls; one exports deploy and test beside environments: 1', async () => {
  const two = hookDriver(hook());
  assert.deepEqual(STEPS.map((s) => typeof two[s.call]), ['function', 'function', 'function', 'function']);
  assert.equal(two.environments, 2);
  const one = hookDriver(hook({ environments: 1 }));
  assert.deepEqual(SINGLE_STEPS.map((s) => typeof one[s.call]), ['function', 'function']);
  assert.equal(one.environments, 1);
  assert.equal(one.deployToUat, undefined);
});

await check('hookDriver: argv gets the call appended, runs in the bead repo, and stdin carries the step\'s context', async () => {
  let seen;
  const d = hookDriver(hook({ run: ['node', 'p.mjs'] }), { exec: async (argv, opts) => ((seen = { argv, opts }), { code: 0, stdout: '{"state":"passed","image":"i"}' }) });
  await d.promoteToProd({ bead: 'b-1', epic: 'e-1', workspace: 'w', repo: 'api', image: 'img:7', work: [{ id: 'w-1' }, 'w-2'] });
  assert.deepEqual(seen.argv, ['node', 'p.mjs', 'promoteToProd']);
  assert.equal(seen.opts.cwd, '/repo');
  assert.equal(seen.opts.timeoutMs, 1000);
  assert.deepEqual(seen.opts.input, { call: 'promoteToProd', bead: 'b-1', epic: 'e-1', workspace: 'w', repo: 'api', image: 'img:7', work: ['w-1', 'w-2'] });
});

await check('hookDriver: a hook that never answered is unknown — never failed', async () => {
  const d = hookDriver(hook(), { exec: answering({ code: null, stdout: '', error: 'timed out after 1s' }) });
  const got = await d.deployToUat({});
  assert.equal(got.state, 'unknown');
  assert.match(got.detail, /never answered — timed out/);
});

await check('hookDriver: an exit with no JSON answer is unknown, whatever the exit code, and says the last line it printed', async () => {
  for (const code of [0, 1]) {
    const d = hookDriver(hook(), { exec: answering({ code, stdout: 'deploying...\n', stderr: code ? 'az: not logged in\n' : '' }) });
    const got = await d.deployToUat({});
    assert.equal(got.state, 'unknown', `exit ${code}`);
    assert.match(got.detail, new RegExp(`exited ${code} with no JSON answer`));
  }
  const d = hookDriver(hook(), { exec: answering({ code: 1, stdout: '', stderr: 'az: not logged in\n' }) });
  assert.match((await d.deployToUat({})).detail, /az: not logged in/);
});

await check('hookDriver: the answer is the verdict — failed on exit 0 is failed, failed on exit 1 is failed', async () => {
  for (const code of [0, 1]) {
    const d = hookDriver(hook(), { exec: answering({ code, stdout: '{"state":"failed","detail":"i9n red"}' }) });
    assert.equal((await d.testInUat({})).state, 'failed');
  }
});

await check('hookDriver: a non-zero exit whose answer names no state is unknown, not passed', async () => {
  const d = hookDriver(hook(), { exec: answering({ code: 2, stdout: '{"image":"x"}' }) });
  const got = await d.deployToUat({});
  assert.equal(got.state, 'unknown');
  assert.match(got.detail, /exited 2/);
});

await check('the answer goes through readStep unchanged: a test pass with no checks and a promote with a new image are both refused', async () => {
  const d = hookDriver(hook(), {
    exec: async (argv) => ({ code: 0, stdout: argv.at(-1) === 'testInUat' ? '{"state":"passed"}' : '{"state":"passed","image":"rebuilt"}' }),
  });
  const test = readStep(STEPS[1], await d.testInUat({}));
  assert.equal(test.state, 'unknown');
  const promote = readStep(STEPS[2], await d.promoteToProd({ image: 'tested' }), { image: 'tested' });
  assert.equal(promote.state, 'failed');
});

/* ------------------------------------------------------------------ loading it */

await check('pipelineDriver: loads the hook from the workspace\'s bead repo, and throws why when there is none', async () => {
  const repo = path.join(tmp, 'beadrepo');
  declare(repo, { run: ['x'], environments: 1 });
  const d = pipelineDriver({ dir: path.join(repo, '.beads') });
  assert.equal(d.environments, 1);
  assert.throws(() => pipelineDriver({ dir: path.join(tmp, 'none', '.beads') }), (err) => err.missing === true && /does not exist/.test(err.message));
});

await check('driverSpecFor: a repo promoteDrivers does not name falls to the hook only when the bead repo declares one', async () => {
  const row = { description: '**Repos** (one image each): `api`' };
  assert.match(driverSpecFor({}, 'w', row).why, /no driver is declared/);
  assert.deepEqual(driverSpecFor({}, 'w', row, { hooked: true }), { spec: PIPELINE });
  assert.deepEqual(driverSpecFor({ promoteDrivers: { api: 'single' } }, 'w', row, { hooked: true }), { spec: 'single' }, 'a named driver still wins');
});

await check('loadDriver: `pipeline` hands the workspace to the hook loader', async () => {
  let got;
  const d = await loadDriver(PIPELINE, { cfg: {}, ws: { name: 'w' }, pipeline: (ws) => ((got = ws), { tag: 'hook' }) });
  assert.equal(d.tag, 'hook');
  assert.deepEqual(got, { name: 'w' });
});

/* ------------------------------------------------------------------ a real process */

await check('runHook: a program that is not there never answered', async () => {
  const got = await runHook([path.join(tmp, 'no-such-program')], { cwd: tmp, input: {}, timeoutMs: 5000 });
  assert.equal(got.code, null);
  assert.ok(got.error);
});

await check('runHook: a hook past its timeout is killed and never answered', async () => {
  const got = await runHook([process.execPath, '-e', 'setTimeout(() => {}, 60000)'], { cwd: tmp, input: {}, timeoutMs: 300 });
  assert.equal(got.code, null);
  assert.match(got.error, /timed out/);
});

await check('runHook: a hook that never reads stdin still answers, and stdin reaches one that does', async () => {
  const quick = await runHook([process.execPath, '-e', 'console.log(JSON.stringify({state:"passed"}))'], { cwd: tmp, input: { big: 'x'.repeat(1 << 18) }, timeoutMs: 5000 });
  assert.equal(quick.code, 0);
  assert.deepEqual(answerOf(quick.stdout), { state: 'passed' });
  const echo = await runHook(
    [process.execPath, '-e', "const i=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify({state:'passed',image:i.image}));process.exit(3)"],
    { cwd: tmp, input: { image: 'img:9' }, timeoutMs: 5000 }
  );
  assert.equal(echo.code, 3);
  assert.equal(answerOf(echo.stdout).image, 'img:9');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${ran - failures}/${ran} passed\n` : `\n${ran}/${ran} passed\n`);
process.exit(failures ? 1 : 0);
