/**
 * The single-environment promotion driver — one deploy, one set of checks, and a record that
 * says so.
 *
 * bc-y8k4.6. lib/singledriver.js wraps the deploy a repo already declares in `cfg.deploys` and
 * lib/promoterun.js carries it as two steps in production rather than four across two
 * environments. What is worth a suite, in the order it goes wrong:
 *
 * 1. **The declaration is the only source.** The deploy is `startDeploy` over `deployFor`,
 *    the checks are `deploys[<key>].checks`, and `{image}` survives `deployFor` to be filled
 *    in with the commit that actually landed. No kickstart and no fly appear here.
 * 2. **The record on disk is what is waited on.** The fake `start` returns at once, the way
 *    the real one does, and the outcome is read off successive `show` reads — `ok` passes and
 *    names the commit, `failed` fails, and `unconfirmed` or a wait that runs out is
 *    cannot-say, never a pass.
 * 3. **No declared check is cannot-say.** A green deploy says nothing about whether this
 *    release is the one running, so a repo with no checks never closes a promotion.
 * 4. **The record is honest about one environment.** Carried end to end through `carry()`,
 *    the bead's comment names the commit and the checks that ran, says there is one
 *    environment, and mentions no UAT, no promote and no second production test — because
 *    none of those happened.
 *
 * No network, no runner, no restart: every side effect is injected.
 *
 *     npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LIB = (name) => path.join(ROOT, 'lib', name);

// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-singledriver-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { singleDriver, deployKey, runCheck, default: shipped } = await import(LIB('singledriver.js'));
const { assertDriver, carry, parseRun, SINGLE_STEPS, PASSED, FAILED, UNKNOWN } = await import(LIB('promoterun.js'));
const { deployFor } = await import(LIB('deploy.js'));

const SHA = 'a'.repeat(40);
const FROM = 'b'.repeat(40);
const WS = { name: 'alpha', dir: path.join(tmp, 'beads', 'alpha', '.beads') };

const config = (deploys) => ({
  workspaces: [{ name: 'alpha', dir: WS.dir }],
  sessionDirs: { alpha: tmp },
  pr: { base: 'main' },
  deploys,
});

const DECLARED = {
  alpha: {
    command: ['deploy-the-thing', '--now'],
    checks: [
      { label: 'health', command: ['probe', 'http://127.0.0.1:1/api/health'] },
      { label: 'running build is this one', command: ['probe-build', '{image}'] },
    ],
  },
};

/**
 * A `startDeploy`/`showDeploy` pair over a scripted journal.
 *
 * `start` returns at once with a queued record, as the real one does; each `show` hands back
 * the next state in `states`, then the last one for ever. `asked` is what `start` was called
 * with, so the assertion can be that the declaration's key was what ran.
 */
function journal(states) {
  const asked = [];
  let reads = 0;
  return {
    asked,
    reads: () => reads,
    start: (cfg, key, opts) => {
      asked.push({ key, ...opts, command: deployFor(cfg, key).command });
      return { id: 'd-test-1', status: 'queued' };
    },
    show: (id) => {
      const s = states[Math.min(reads++, states.length - 1)];
      return s ? { id, ...s } : null;
    },
  };
}

const noSleep = async () => {};

/** An `exec` that answers per check label, and remembers the argv it was handed. */
function execs(byCommand = {}) {
  const ran = [];
  const exec = async (command) => {
    ran.push(command);
    return byCommand[command[0]] || { code: 0, output: 'ok', error: null };
  };
  return { ran, exec };
}

/* ---------------------------------------------------------------- fake tracker */

const BODY = ['Every bead under **x-1** is closed.', '', '**Repos** (one image each): `alpha`'].join('\n');

const promotionBead = (over = {}) => ({
  id: 'p-1',
  title: 'Promote x-1 — the epic that landed',
  description: BODY,
  status: 'open',
  assignee: '',
  labels: ['promote'],
  ...over,
});

const graph = {
  parents: new Map([['x-1.2', 'x-1']]),
  beads: new Map([
    ['x-1', { id: 'x-1', title: 'the epic', status: 'open', issue_type: 'epic', labels: [] }],
    ['x-1.2', { id: 'x-1.2', title: 'the work', status: 'closed', labels: [] }],
  ]),
  adopts: new Map(),
  edges: new Map(),
};

function fakeBd(row = promotionBead()) {
  const bd = {
    written: [],
    closed: [],
    reopened: [],
    show: async () => row,
    graph: async () => graph,
    assign: async () => {},
    setStatus: async () => {},
    comment: async (_ws, id, text) => bd.written.push({ id, text }),
    close: async (_ws, id, reason) => bd.closed.push({ id, reason }),
    reopenAbandoned: async (_ws, id) => bd.reopened.push(id),
    comments: async () => bd.written.map((c) => ({ text: c.text })),
  };
  return bd;
}

/* --------------------------------------------------------------------- harness */

let ran = 0;
let failures = 0;
async function check(name, fn) {
  ran++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${String(err?.stack || err).split('\n').slice(0, 6).join('\n       ')}`);
  }
}

console.log('\nthe declaration');

await check('deployFor reads checks as argv, and leaves {image} for the driver that knows it', () => {
  const plan = deployFor(config(DECLARED), 'alpha');
  assert.deepEqual(plan.checks.map((c) => c.label), ['health', 'running build is this one']);
  assert.deepEqual(plan.checks[1].command, ['probe-build', '{image}'], 'the commit is not known until the deploy lands');
  assert.equal(plan.checks[0].timeoutMs, 60000);
  assert.deepEqual(deployFor(config({ alpha: { command: ['x'] } }), 'alpha').checks, [], 'none declared is an empty list');
});

await check('a check written as a shell line is refused, like a command is', () => {
  assert.throws(() => deployFor(config({ alpha: { command: ['x'], checks: [{ command: 'curl -f x' }] } }), 'alpha'), /argv, not a shell line/);
});

await check('the key is the repo as the Repos line names it, and nothing is guessed when none is declared', () => {
  assert.equal(deployKey(config(DECLARED), { repo: 'alpha', workspace: 'alpha' }), 'alpha');
  assert.equal(deployKey(config({}), { repo: 'alpha', workspace: 'alpha' }), null);
});

console.log('\nthe deploy — waited on through the record');

await check('an ok record passes and names the commit it landed on as the image', async () => {
  const j = journal([{ status: 'queued' }, { status: 'pulling' }, { status: 'deploying' }, { status: 'ok', from: FROM, to: SHA }]);
  const d = singleDriver({ cfg: config(DECLARED), start: j.start, show: j.show, sleep: noSleep });
  const got = await d.deploy({ repo: 'alpha', workspace: 'alpha', bead: 'p-1', epic: 'x-1' });
  assert.equal(got.state, PASSED);
  assert.equal(got.image, SHA);
  assert.match(got.detail, /deploy d-test-1 of `alpha` ran `deploy-the-thing`/);
  assert.deepEqual(j.asked, [{ key: 'alpha', bead: 'p-1', reason: 'promotion p-1 of x-1', command: ['deploy-the-thing', '--now'] }], 'the declared command, through startDeploy');
  assert.equal(j.reads(), 4, 'the record was read until it settled — the child was never awaited');
});

await check('a failed record fails, with the runner’s reason', async () => {
  const j = journal([{ status: 'failed', error: 'fly: no such app\nmore' }]);
  const got = await singleDriver({ cfg: config(DECLARED), start: j.start, show: j.show, sleep: noSleep }).deploy({ repo: 'alpha' });
  assert.equal(got.state, FAILED);
  assert.match(got.detail, /failed — fly: no such app$/);
});

await check('unconfirmed and lost are cannot-say — a restart nobody outlived is not a pass', async () => {
  for (const status of ['unconfirmed', 'lost']) {
    const j = journal([{ status, to: SHA, error: 'nothing outlived it' }]);
    const got = await singleDriver({ cfg: config(DECLARED), start: j.start, show: j.show, sleep: noSleep }).deploy({ repo: 'alpha' });
    assert.equal(got.state, UNKNOWN, status);
    assert.equal(got.image, undefined, `${status} names no image`);
  }
});

await check('a record still live when the wait runs out is cannot-say, not a hang and not a pass', async () => {
  let t = 0;
  const j = journal([{ status: 'deploying' }]);
  const d = singleDriver({ cfg: config(DECLARED), start: j.start, show: j.show, sleep: async (ms) => { t += ms; }, now: () => t, pollMs: 600000 });
  const got = await d.deploy({ repo: 'alpha' });
  assert.equal(got.state, UNKNOWN);
  assert.match(got.detail, /still `deploying` when the wait ran out/);
});

await check('a repo with no declared deploy throws, which carry reads as cannot-say', async () => {
  const d = singleDriver({ cfg: config({}), start: () => assert.fail('nothing may run'), show: () => null, sleep: noSleep });
  await assert.rejects(d.deploy({ repo: 'alpha', workspace: 'alpha' }), /no deploy is declared for `alpha`/);
});

console.log('\nthe checks');

await check('each declared check runs with {image} filled in, and is named with its own state', async () => {
  const x = execs({ probe: { code: 0, output: '', error: null }, 'probe-build': { code: 1, output: 'running b0rk\n', error: null } });
  const got = await singleDriver({ cfg: config(DECLARED), exec: x.exec }).test({ repo: 'alpha', image: SHA });
  assert.deepEqual(x.ran[1], ['probe-build', SHA]);
  assert.equal(got.state, FAILED);
  assert.deepEqual(got.checks.map((c) => [c.name, c.state]), [['health', PASSED], ['running build is this one', FAILED]]);
  assert.match(got.checks[1].detail, /exit 1 — running b0rk/);
});

await check('a check that could not run is cannot-say, not failed', async () => {
  const x = execs({ probe: { code: null, output: '', error: 'spawn probe ENOENT' } });
  const got = await singleDriver({ cfg: config(DECLARED), exec: x.exec }).test({ repo: 'alpha', image: SHA });
  assert.equal(got.state, UNKNOWN);
  assert.equal(got.checks[0].state, UNKNOWN);
});

await check('no declared check is cannot-say — a green deploy alone proves nothing about this release', async () => {
  const got = await singleDriver({ cfg: config({ alpha: { command: ['x'] } }), exec: () => assert.fail('nothing to run') }).test({ repo: 'alpha', image: SHA });
  assert.equal(got.state, UNKNOWN);
  assert.match(got.detail, /declares nothing/);
});

await check('runCheck reports the exit code, and a missing binary as no code at all', async () => {
  assert.equal((await runCheck([process.execPath, '-e', 'process.exit(3)'], { cwd: tmp, timeoutMs: 10000 })).code, 3);
  assert.equal((await runCheck([process.execPath, '-e', ''], { cwd: tmp, timeoutMs: 10000 })).code, 0);
  const missing = await runCheck(['beadcause-no-such-binary-y8k46'], { cwd: tmp, timeoutMs: 10000 });
  assert.equal(missing.code, null);
  assert.ok(missing.error);
});

console.log('\ncarried end to end');

await check('the shipped driver is a two-call, one-environment driver, and importing it reads no config', () => {
  assert.equal(shipped.environments, 1);
  assert.doesNotThrow(() => assertDriver(shipped));
  assert.throws(() => assertDriver({ environments: 1, deploy() {} }), /no test/, 'one environment still needs both of its calls');
  assert.deepEqual(SINGLE_STEPS.map((s) => s.env), ['production', 'production']);
});

await check('a real carry deploys once, checks once, closes, and the record claims nothing more', async () => {
  const j = journal([{ status: 'deploying' }, { status: 'ok', from: FROM, to: SHA }]);
  const x = execs();
  const driver = singleDriver({ cfg: config(DECLARED), start: j.start, show: j.show, exec: x.exec, sleep: noSleep });
  const bd = fakeBd();
  const run = await carry(bd, WS, 'p-1', driver, { actor: 'release-agent' });

  assert.equal(run.refused, undefined);
  assert.equal(run.closed, true);
  assert.equal(run.image, SHA);
  assert.deepEqual(run.steps.map((s) => s.id), ['deploy', 'test']);
  assert.equal(j.asked.length, 1, 'one deploy');
  assert.equal(x.ran.length, 2, 'the two declared checks, once each');

  const text = bd.written[0].text;
  assert.match(text, /\*\*One environment\*\* — there is no UAT here/);
  assert.match(text, new RegExp(`\`${SHA}\``), 'the record names the commit it deployed');
  assert.match(text, /`health` passed, `running build is this one` passed/, 'and the checks it actually ran');
  assert.doesNotMatch(text, /UAT deploy|UAT tests|production promote/, 'no step that did not happen');
  assert.equal((text.match(/\*\*production tests\*\*/g) || []).length, 1, 'production was tested once, and says so once');
  assert.equal(parseRun(text).environments, 1, 'the ledger says one environment too');
  assert.match(bd.closed[0].reason, /only environment \(no UAT\) — `a{40}` in `alpha`, 2 checks green/);
});

await check('with no checks declared the carry is cannot-say, hands the bead back, and never closes', async () => {
  const j = journal([{ status: 'ok', to: SHA }]);
  const driver = singleDriver({ cfg: config({ alpha: { command: ['x'] } }), start: j.start, show: j.show, sleep: noSleep });
  const bd = fakeBd();
  const run = await carry(bd, WS, 'p-1', driver, { actor: 'release-agent' });
  assert.equal(run.closed, false);
  assert.equal(run.state, UNKNOWN);
  assert.deepEqual(bd.closed, []);
  assert.deepEqual(bd.reopened, ['p-1']);
  assert.match(bd.written[0].text, /\*\*production tests\*\* — cannot say/);
  assert.equal(run.promoted, true, 'the deploy did put the commit in production, and the record does not hide that');
});

await check('a second run over a verified repo drives nothing again', async () => {
  const j = journal([{ status: 'ok', to: SHA }]);
  const driver = singleDriver({ cfg: config(DECLARED), start: j.start, show: j.show, exec: execs().exec, sleep: noSleep });
  const bd = fakeBd();
  await carry(bd, WS, 'p-1', driver, { actor: 'a' });
  const again = await carry(bd, WS, 'p-1', driver, { actor: 'a' });
  assert.equal(j.asked.length, 1, 'the second run did not deploy');
  assert.match(bd.written[1].text, /\*\*Both steps\*\* — done by an earlier run/);
  assert.equal(again.closed, true);
});

/* --------------------------------------------------------------------- report */

await cleanupTmp(tmp);
console.log(`\n${ran - failures}/${ran} checks passed`);
if (failures) process.exit(1);
console.log('all good');
