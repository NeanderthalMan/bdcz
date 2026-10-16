/**
 * The daemon carries an endorsed promotion bead itself — and only when it may.
 *
 * bc-y8k4.8. lib/promotesweep.js is the sweep `bin/promoterun.js`'s header deferred until a real
 * driver existed. It is written with `bd`, the config, the driver loader, the deploy journal and
 * the clock all injected, so this suite runs the real `carry()` against a fake tracker and a
 * fake driver with no network, no daemon and no restart.
 *
 * What is worth a suite, in the order it goes wrong:
 *
 * 1. **Every gate leaves a reason, and leaves the bead alone.** autoShip off, no declared
 *    driver, two drivers on one bead, not ready, held by somebody else, a live `held:` lease,
 *    a live deploy, a spent run budget: each must write *nothing* to the bead and say why —
 *    the acceptance is "left alone and the reason is visible", and a sweep that stays quiet
 *    reads exactly like one that is broken.
 * 2. **One carry at a time, and never twice on one bead.** A carry is minutes long, so the
 *    second sweep lands while the first is running; the driver is asked what it was asked
 *    once, not twice.
 * 3. **A dead carry is recovered from the record.** A beadcause deploy kills the daemon
 *    mid-carry and leaves the bead `in_progress` on the daemon's own actor — the one holder
 *    `carry()` lets straight through. The next process must resume it, must not deploy a second
 *    time (which would loop a self-deploying promotion for ever), and must still close only on
 *    the checks.
 * 4. **The record is the same one `beadcause-promoterun` writes**, because it is `carry()`.
 *
 *     npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LIB = (name) => path.join(ROOT, 'lib', name);

// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-promotesweep-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { createPromotionSweep, driverSpecFor, loadDriver, resuming, runsOf, COOLDOWN_MS, LEASE_MS, MAX_RUNS } = await import(LIB('promotesweep.js'));
const { RUN_CLOSE, RUN_OPEN, PASSED, FAILED, UNKNOWN } = await import(LIB('promoterun.js'));

const WS = { name: 'alpha', dir: path.join(tmp, 'beads', 'alpha', '.beads') };
const ACTOR = 'beadcause';
const T0 = Date.parse('2026-09-19T12:00:00Z');
const SHA = 'a'.repeat(40);

/* ------------------------------------------------------------------ fixtures */

const BODY = ['Every bead under **x-1** is closed.', '', '**Repos** (one image each): `alpha`', '', '- `x-1.2`'].join('\n');

const promotionBead = (over = {}) => ({
  id: 'p-1',
  title: 'Promote x-1 — the epic that landed',
  description: BODY,
  status: 'open',
  assignee: '',
  labels: ['promote'],
  updated_at: new Date(T0 - 3600_000).toISOString(),
  ...over,
});

const graph = () => ({
  parents: new Map([['x-1.2', 'x-1']]),
  beads: new Map([
    ['x-1', { id: 'x-1', title: 'the epic', status: 'open', issue_type: 'epic', labels: [] }],
    ['x-1.2', { id: 'x-1.2', title: 'the work that landed', status: 'closed', labels: [] }],
  ]),
  adopts: new Map(),
  edges: new Map(),
});

/** A tracker that remembers what was written to it, and reads its comments back. */
function fakeBd({ rows = [promotionBead()], ready = null, comments = [], fail = {} } = {}) {
  const bd = {
    rows,
    written: [...comments],
    closed: [],
    assigned: [],
    statuses: [],
    reopened: [],
    listed: 0,
    show: async (_ws, id) => bd.rows.find((r) => r.id === id) || null,
    graph: async () => graph(),
    listLabel: async () => {
      bd.listed += 1;
      if (fail.list) throw new Error(fail.list);
      return bd.rows;
    },
    ready: async () => {
      if (fail.ready) throw new Error(fail.ready);
      return (ready || bd.rows.filter((r) => r.status === 'open')).map((r) => ({ id: r.id }));
    },
    assign: async (_ws, id, who) => bd.assigned.push(`${id}:${who}`),
    setStatus: async (_ws, id, status) => bd.statuses.push(`${id}:${status}`),
    comment: async (_ws, id, body) => bd.written.push({ text: body }),
    close: async (_ws, id, reason) => bd.closed.push({ id, reason }),
    reopenAbandoned: async (_ws, id) => bd.reopened.push(id),
    comments: async () => bd.written,
  };
  return bd;
}

/** Nothing was written to the bead — no claim, no comment, no close, no handback. */
const untouched = (bd, base = 0) =>
  bd.assigned.length === 0 && bd.statuses.length === 0 && bd.closed.length === 0 && bd.reopened.length === 0 && bd.written.length === base;

/** A single-environment driver that answers what it is told, and logs what it was asked. */
function fakeDriver({ deploy, test } = {}) {
  const d = {
    environments: 1,
    asked: [],
    deploy: async (ctx) => {
      d.asked.push('deploy');
      return deploy ? deploy(ctx) : { state: PASSED, image: SHA };
    },
    test: async (ctx) => {
      d.asked.push('test');
      return test ? test(ctx) : { state: PASSED, checks: [{ name: 'health', state: PASSED }], detail: `image ${ctx.image}` };
    },
  };
  return d;
}

const record = (over = {}) => ({
  id: 'd-1',
  key: 'alpha',
  workspace: 'alpha',
  repo: 'alpha',
  bead: 'p-1',
  status: 'ok',
  restarts: false,
  requestedAt: new Date(T0 - 600_000).toISOString(),
  to: SHA,
  ...over,
});

/** Everything a sweep is built from, with the answer that lets a bead through. */
function rig({ bd = fakeBd(), cfgOver = {}, allowed = true, driver = fakeDriver(), deploys = [], observing = false, bootedAt = T0 - 60_000, now = { t: T0 } } = {}) {
  const cfg = { actor: ACTOR, workspaces: [WS], promoteDrivers: { alpha: 'single' }, ...cfgOver };
  const logs = [];
  const events = [];
  const loaded = [];
  const sweeper = createPromotionSweep({
    tracker: bd,
    cfg,
    allowed: () => allowed,
    load: async (spec) => {
      loaded.push(spec);
      return driver;
    },
    deploys: () => deploys,
    observing: () => observing,
    log: (l) => logs.push(l),
    emit: (e) => events.push(e),
    now: () => now.t,
    bootedAt,
  });
  return { bd, cfg, sweeper, logs, events, loaded, driver, now, deploys };
}

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
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err && err.message ? err.message : String(err)).split('\n').join('\n       ')}`);
  }
}

const runOnce = async (r) => {
  const out = await r.sweeper.sweep();
  await r.sweeper.idle();
  return out;
};

/* ------------------------------------------------------- the acceptance, straight */

await check('with a driver declared and autoShip allowed, an endorsed promotion bead is carried and closed with no human command', async () => {
  const r = rig();
  const out = await runOnce(r);
  assert.deepEqual(out.started, { workspace: 'alpha', bead: 'p-1', resume: false });
  assert.deepEqual(r.loaded, ['single'], 'the driver the config named was the one loaded');
  assert.deepEqual(r.driver.asked, ['deploy', 'test'], 'the single-environment pair, in order');
  assert.deepEqual(r.bd.assigned, [`p-1:${ACTOR}`], 'claimed the way carry() claims');
  assert.deepEqual(r.bd.closed.map((c) => c.id), ['p-1']);
  assert.match(r.bd.closed[0].reason, new RegExp(SHA), 'the close reason names the image');
});

await check('the record on the bead is the same carry() record beadcause-promoterun writes', async () => {
  const r = rig();
  await runOnce(r);
  assert.equal(r.bd.written.length, 1, 'one comment for the run');
  const body = r.bd.written[0].text;
  assert.ok(body.includes(RUN_OPEN) && body.includes(RUN_CLOSE), 'the machine-readable ledger is in it');
  assert.equal(runsOf(r.bd.written).length, 1, 'and it reads back as one recorded run');
  assert.match(body, /one environment/i, 'and it says so, exactly as the by-hand run does');
});

await check('a carry says so on the bus when it starts and when it ends, and only then', async () => {
  const r = rig();
  await runOnce(r);
  assert.deepEqual(r.events.map((e) => e.state), ['carrying', 'closed']);
  assert.ok(r.events.every((e) => e.type === 'promotion' && e.key === 'alpha/p-1' && e.workspace === 'alpha' && e.id === 'p-1'));
  await runOnce(r);
  assert.equal(r.events.length, 2, 'a sweep that starts nothing emits nothing — an event per tick would re-sweep bd on every phone wake');
});

/* ------------------------------------------------------------------ the gates */

await check('autoShip off: nothing is carried, the bead is untouched, and the reason says which switch and what to do instead', async () => {
  const r = rig({ allowed: false });
  const out = await runOnce(r);
  assert.equal(out.started, null);
  assert.ok(untouched(r.bd));
  assert.deepEqual(r.driver.asked, [], 'and the driver was never asked');
  assert.match(out.skipped[0].why, /autoShip is off for `alpha`/);
  assert.match(out.skipped[0].why, /beadcause-promoterun -w alpha -b p-1/, 'and it names the by-hand door that is still open');
  assert.ok(r.logs.some((l) => /alpha\/p-1: left alone — autoShip is off/.test(l)), 'in the log, where somebody will see it');
});

await check('no driver declared for the repo: skipped and named, never guessed', async () => {
  const r = rig({ cfgOver: { promoteDrivers: {} } });
  const out = await runOnce(r);
  assert.equal(out.started, null);
  assert.ok(untouched(r.bd));
  assert.match(out.skipped[0].why, /no driver is declared for `alpha`/);
  assert.deepEqual(r.loaded, [], 'nothing was loaded on a guess');
});

await check('driverSpecFor: the bare repo, then <workspace>/<repo>; two repos on two drivers is refused, on one is fine', async () => {
  const row = (repos) => ({ description: `**Repos** (one image each): ${repos.map((x) => `\`${x}\``).join(', ')}` });
  assert.deepEqual(driverSpecFor({ promoteDrivers: { 'alpha/api': 'single' } }, 'alpha', row(['api'])), { spec: 'single' });
  assert.deepEqual(driverSpecFor({ promoteDrivers: { api: '/x/d.js', 'alpha/api': 'single' } }, 'alpha', row(['api'])), { spec: '/x/d.js' }, 'the bare name wins');
  assert.deepEqual(driverSpecFor({ promoteDrivers: { a: 'single', b: 'single' } }, 'alpha', row(['a', 'b'])), { spec: 'single' });
  assert.match(driverSpecFor({ promoteDrivers: { a: 'single', b: '/x/d.js' } }, 'alpha', row(['a', 'b'])).why, /different drivers/);
  assert.match(driverSpecFor({ promoteDrivers: { a: 'single' } }, 'alpha', row(['a', 'b'])).why, /no driver is declared for `b`/);
  assert.match(driverSpecFor({}, 'alpha', { description: 'no repos here' }).why, /names no repo/);
  assert.match(driverSpecFor({ promoteDrivers: { a: 7 } }, 'alpha', row(['a'])).why, /no driver is declared/, 'a value that is not a name is no declaration');
});

await check('an unendorsed promotion is not picked up, and a human one is a question and left to the person', async () => {
  const r = rig({ bd: fakeBd({ rows: [promotionBead({ id: 'p-2', labels: ['promote', 'unendorsed'] }), promotionBead({ id: 'p-3', labels: ['promote', 'human'] })] }) });
  const out = await runOnce(r);
  assert.equal(out.started, null);
  assert.ok(untouched(r.bd));
  assert.equal(out.skipped.length, 1, 'the unendorsed one never reaches the sweep at all');
  assert.match(out.skipped[0].why, /question waiting on a person/);
});

await check('an open bead bd ready does not list is blocked, and stepping over that edge is not the sweep\'s to do', async () => {
  const r = rig({ bd: fakeBd({ ready: [] }) });
  const out = await runOnce(r);
  assert.equal(out.started, null);
  assert.ok(untouched(r.bd));
  assert.match(out.skipped[0].why, /not ready/);
});

await check('a tracker that will not say what is ready starts nothing there, and says so', async () => {
  const r = rig({ bd: fakeBd({ fail: { ready: 'dolt is busy' } }) });
  const out = await runOnce(r);
  assert.equal(out.started, null);
  assert.ok(untouched(r.bd));
  assert.ok(r.logs.some((l) => /could not read what is ready/.test(l) && /dolt is busy/.test(l)));
});

await check('a tracker that will not list promotion beads is a line in the log and not a crash', async () => {
  const r = rig({ bd: fakeBd({ fail: { list: 'no route to dolt' } }) });
  const out = await runOnce(r);
  assert.equal(out.started, null);
  assert.ok(r.logs.some((l) => /could not list promotion beads/.test(l)));
});

await check('held by somebody else, or under a live `held:` lease: left alone', async () => {
  const other = rig({ bd: fakeBd({ rows: [promotionBead({ status: 'in_progress', assignee: 'somebody-else' })] }) });
  assert.match((await runOnce(other)).skipped[0].why, /held by somebody-else/);
  assert.ok(untouched(other.bd));

  const stamp = new Date(T0 - 5 * 60_000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const leased = rig({ bd: fakeBd({ rows: [promotionBead({ labels: ['promote', `held:${stamp}:adam@example.com`] })] }) });
  const out = await runOnce(leased);
  assert.equal(out.started, null);
  assert.ok(untouched(leased.bd));
  assert.match(out.skipped[0].why, /adam@example\.com/, 'and the reason names whose Mac has it');
});

await check('a live deploy for the bead, or for one of its repos, is a carry in progress and is waited for', async () => {
  const mine = rig({ deploys: [record({ status: 'deploying' })] });
  const a = await runOnce(mine);
  assert.equal(a.started, null);
  assert.match(a.skipped[0].why, /deploy d-1 for it is still running/);
  assert.ok(untouched(mine.bd));

  const theirs = rig({ deploys: [record({ bead: 'ship-3', status: 'building' })] });
  const b = await runOnce(theirs);
  assert.equal(b.started, null);
  assert.match(b.skipped[0].why, /deploy d-1 of `alpha` is already running/);
  assert.ok(untouched(theirs.bd));

  const settled = rig({ deploys: [record({ bead: 'ship-3', status: 'ok' })] });
  assert.ok((await runOnce(settled)).started, 'a settled deploy of the same repo is no obstacle');
});

await check('the daemon with no observing stance never carries: an observer watches another Mac\'s work', async () => {
  const r = rig({ observing: true });
  const out = await runOnce(r);
  assert.equal(out.started, null);
  assert.equal(r.bd.listed, 0, 'and does not even list');
});

/* ------------------------------------------------ never concurrent with itself */

await check('a second sweep while a carry is running does not start a second carry', async () => {
  let release;
  let reachedIt;
  const gate = new Promise((res) => (release = res));
  const reached = new Promise((res) => (reachedIt = res));
  const driver = fakeDriver({
    deploy: async () => {
      reachedIt();
      await gate;
      return { state: PASSED, image: SHA };
    },
  });
  const r = rig({ driver, bd: fakeBd({ rows: [promotionBead(), promotionBead({ id: 'p-2', title: 'Promote x-2 — another' })] }) });

  const first = await r.sweeper.sweep();
  await reached; // the carry is now inside the driver, held at the gate — no sleep to tune
  assert.equal(first.started.bead, 'p-1');
  assert.equal(r.sweeper.busy, 'p-1');
  const second = await r.sweeper.sweep();
  assert.equal(second.started, null, 'nothing else is started while one is in the air');
  assert.deepEqual(second.skipped.map((s) => s.bead), ['p-2'], 'the other bead waits, and says what for');
  assert.match(second.skipped[0].why, /another promotion \(p-1\) is being carried/);
  assert.deepEqual(r.driver.asked, ['deploy'], 'the driver was asked once');
  assert.equal(r.bd.assigned.length, 1, 'and the bead was claimed once');

  release();
  await r.sweeper.idle();
  assert.equal(r.sweeper.busy, null);
  assert.deepEqual(r.bd.closed.map((c) => c.id), ['p-1']);
});

await check('one bead per sweep even when several are ready — carry() one bead at a time', async () => {
  const r = rig({ bd: fakeBd({ rows: [promotionBead(), promotionBead({ id: 'p-2', title: 'Promote x-2 — another' })] }) });
  const out = await runOnce(r);
  assert.equal(out.started.bead, 'p-1');
  assert.deepEqual(r.driver.asked, ['deploy', 'test'], 'one bead\'s worth of calls and no more');
});

/* ----------------------------------------------------------- the run budget */

const runComment = (at, verified = false) => ({
  text: `Promotion run.\n${RUN_OPEN}\n${JSON.stringify({ bead: 'p-1', epic: 'x-1', at: new Date(at).toISOString(), repos: [{ repo: 'alpha', verified, state: 'failed', image: SHA, at: new Date(at).toISOString(), detail: '' }] })}\n${RUN_CLOSE}`,
});

await check('a run inside the cooldown is not repeated, and one after it is', async () => {
  const soon = rig({ bd: fakeBd({ comments: [runComment(T0 - 5 * 60_000)] }) });
  const out = await runOnce(soon);
  assert.equal(out.started, null);
  assert.match(out.skipped[0].why, /last run 5 minutes ago/);
  assert.ok(untouched(soon.bd, 1));

  const later = rig({ bd: fakeBd({ comments: [runComment(T0 - COOLDOWN_MS - 60_000)] }) });
  assert.ok((await runOnce(later)).started, 'past the cooldown it goes again');
});

await check(`${MAX_RUNS} recorded runs and none closed it: it is a person's now, and the sweep says the by-hand door is open`, async () => {
  const comments = Array.from({ length: MAX_RUNS }, (_, i) => runComment(T0 - (10 + i) * 3600_000));
  const r = rig({ bd: fakeBd({ comments }) });
  const out = await runOnce(r);
  assert.equal(out.started, null);
  assert.match(out.skipped[0].why, new RegExp(`${MAX_RUNS} runs are recorded`));
  assert.ok(untouched(r.bd, MAX_RUNS));
});

await check('a run that could not be recorded still costs a cooldown — the sweep\'s own memory covers what the tracker lost', async () => {
  const failing = fakeDriver({ test: async () => ({ state: FAILED, checks: [{ name: 'health', state: FAILED }] }) });
  const bd = fakeBd();
  bd.comment = async () => {
    throw new Error('dolt is busy');
  };
  const r = rig({ bd, driver: failing });
  await runOnce(r);
  assert.deepEqual(bd.reopened, ['p-1'], 'handed back, not left claimed');
  const again = await runOnce(r);
  assert.equal(again.started, null, 'and not carried again five minutes later');
  assert.match(again.skipped[0].why, /last run/);
});

await check('a bead the driver could not verify is handed back and not closed; the next sweep leaves it for the cooldown', async () => {
  const r = rig({ driver: fakeDriver({ test: async () => ({ state: UNKNOWN, detail: 'nothing was run' }) }) });
  await runOnce(r);
  assert.deepEqual(r.bd.closed, []);
  assert.deepEqual(r.bd.reopened, ['p-1']);
  assert.ok(r.logs.some((l) => /handed back — not verified/.test(l)));
});

await check('a refusal writes nothing, costs no budget, and repeats in the log only when the reason changes', async () => {
  const r = rig({ bd: fakeBd({ rows: [promotionBead({ title: 'Promote it, whatever it was' })] }) });
  await runOnce(r);
  await runOnce(r);
  await runOnce(r);
  assert.ok(untouched(r.bd));
  assert.equal(r.logs.filter((l) => /not carried/.test(l)).length, 1, 'three sweeps, one line');
  assert.deepEqual(r.events.map((e) => e.state), ['carrying', 'refused', 'carrying', 'refused', 'carrying', 'refused']);
});

await check('a reason is logged once per change, not once per sweep', async () => {
  const r = rig({ allowed: false });
  await runOnce(r);
  await runOnce(r);
  assert.equal(r.logs.filter((l) => /autoShip is off/.test(l)).length, 1);
});

/* ------------------------------------------- recovery: the record, not the memory */

const orphan = (over = {}) => promotionBead({ status: 'in_progress', assignee: ACTOR, updated_at: new Date(T0 - 40 * 60_000).toISOString(), ...over });

await check('a claim by the daemon\'s own actor that is fresh is a carry that may be running, and is left alone', async () => {
  const r = rig({ bd: fakeBd({ rows: [orphan({ updated_at: new Date(T0 - 2 * 60_000).toISOString() })] }), bootedAt: T0 - 10 * 60_000 });
  const out = await runOnce(r);
  assert.equal(out.started, null);
  assert.match(out.skipped[0].why, /claimed 2 minutes ago by a carry that may still be running/);
  assert.ok(untouched(r.bd));
});

await check('a claim older than this process is a dead carry: resumed, and the deploy it started is adopted rather than run again', async () => {
  // Claimed 3 minutes ago, daemon booted 1 minute ago: the previous daemon claimed it, then died.
  const claimed = T0 - 3 * 60_000;
  const r = rig({
    bd: fakeBd({ rows: [orphan({ updated_at: new Date(claimed).toISOString() })] }),
    bootedAt: T0 - 60_000,
    deploys: [record({ status: 'ok', requestedAt: new Date(claimed + 10_000).toISOString() })],
  });
  const out = await runOnce(r);
  assert.deepEqual(out.started, { workspace: 'alpha', bead: 'p-1', resume: true });
  assert.deepEqual(r.driver.asked, ['test'], 'the deploy was NOT run a second time — only the checks were');
  assert.deepEqual(r.bd.closed.map((c) => c.id), ['p-1'], 'and it closed, on the checks');
  assert.match(r.bd.written[0].text, /adopted rather than run again/, 'the record says the deploy was adopted');
  assert.match(r.bd.written[0].text, new RegExp(SHA.slice(0, 12)), 'with the commit it named');
});

await check('a claim past the lease with nobody in this process is resumed too', async () => {
  const r = rig({ bd: fakeBd({ rows: [orphan({ updated_at: new Date(T0 - LEASE_MS - 60_000).toISOString() })] }), bootedAt: T0 - 3 * LEASE_MS });
  const out = await runOnce(r);
  assert.equal(out.started.resume, true);
  assert.deepEqual(r.driver.asked, ['deploy', 'test'], 'no journal record for the bead, so there is nothing to adopt and it deploys');
});

await check('a self-deploy that ended `unconfirmed` is adopted only if this process started after it asked', async () => {
  const claimed = T0 - 3 * 60_000;
  const asked = new Date(claimed + 10_000).toISOString();
  const rec = record({ status: 'unconfirmed', restarts: true, requestedAt: asked });

  const after = rig({ bd: fakeBd({ rows: [orphan({ updated_at: new Date(claimed).toISOString() })] }), bootedAt: T0 - 60_000, deploys: [rec] });
  await runOnce(after);
  assert.deepEqual(after.driver.asked, ['test'], 'the daemon that came up after the restart is the evidence');
  assert.deepEqual(after.bd.closed.map((c) => c.id), ['p-1']);

  // Booted *before* the deploy asked: this process is not the one it restarted into.
  const before = rig({ bd: fakeBd({ rows: [orphan({ updated_at: new Date(T0 - LEASE_MS - 60_000).toISOString() })] }), bootedAt: Date.parse(asked) - 1000, deploys: [rec] });
  await runOnce(before);
  assert.deepEqual(before.driver.asked, ['test'].filter(() => false), 'and here it is cannot-say, so the checks never run');
  assert.deepEqual(before.bd.closed, [], 'and the bead does not close');
  assert.deepEqual(before.bd.reopened, ['p-1']);

  // unconfirmed on a deploy that does not restart this daemon settles nothing, ever.
  const plain = rig({ bd: fakeBd({ rows: [orphan({ updated_at: new Date(claimed).toISOString() })] }), bootedAt: T0 - 60_000, deploys: [{ ...rec, restarts: false }] });
  await runOnce(plain);
  assert.deepEqual(plain.bd.closed, [], 'lib/deploy.js\'s rule — silence is never success — holds outside the one case it is explained');
});

await check('an adopted failed deploy is reported as failed and is not deployed again', async () => {
  const claimed = T0 - 3 * 60_000;
  const r = rig({
    bd: fakeBd({ rows: [orphan({ updated_at: new Date(claimed).toISOString() })] }),
    bootedAt: T0 - 60_000,
    deploys: [record({ status: 'failed', error: 'launchctl: no such service\nmore', requestedAt: new Date(claimed + 10_000).toISOString() })],
  });
  await runOnce(r);
  assert.deepEqual(r.driver.asked, [], 'neither the deploy nor the checks were run');
  assert.deepEqual(r.bd.closed, []);
  assert.match(r.bd.written[0].text, /launchctl: no such service/);
});

await check('a journal record older than the last run comment belongs to a carry that already reported, and is not adopted', async () => {
  const claimed = T0 - 3 * 60_000;
  const r = rig({
    bd: fakeBd({ rows: [orphan({ updated_at: new Date(claimed).toISOString() })], comments: [runComment(T0 - 30 * 60_000)] }),
    bootedAt: T0 - 60_000,
    deploys: [record({ status: 'ok', requestedAt: new Date(T0 - 60 * 60_000).toISOString() })],
  });
  await runOnce(r);
  assert.deepEqual(r.driver.asked, ['deploy', 'test'], 'an hour-old deploy for an earlier attempt is not this attempt\'s');
});

await check('resuming() only adopts a record for its own bead and its own repo', async () => {
  const d = fakeDriver();
  const wrapped = resuming(d, { records: () => [record({ bead: 'other' }), record({ repo: 'beta', key: 'beta' })], since: 0, bootedAt: T0 });
  const got = await wrapped.deploy({ bead: 'p-1', repo: 'alpha', workspace: 'alpha' });
  assert.equal(got.state, PASSED);
  assert.deepEqual(d.asked, ['deploy'], 'nothing in the journal was this bead\'s, so it deployed');
  assert.equal(wrapped.environments, 1);
});

/* --------------------------------------------------------------- the loader */

await check('loadDriver: `single` is the single-environment driver on the daemon\'s own config; a path is imported relative to the checkout', async () => {
  const single = await loadDriver('single', { cfg: { deploys: {} } });
  assert.equal(single.environments, 1);
  assert.equal(typeof single.deploy, 'function');

  const seen = [];
  const importer = async (url) => {
    seen.push(url);
    return { default: { environments: 1, deploy() {}, test() {} } };
  };
  const rel = await loadDriver('drivers/x.mjs', { cfg: {}, root: '/checkout', importer });
  assert.equal(rel.environments, 1);
  await loadDriver('/abs/y.mjs', { cfg: {}, root: '/checkout', importer });
  await loadDriver('~/z.mjs', { cfg: {}, root: '/checkout', importer });
  assert.equal(seen[0], pathToFileURL('/checkout/drivers/x.mjs').href, 'never relative to wherever the daemon happened to start');
  assert.equal(seen[1], pathToFileURL('/abs/y.mjs').href);
  assert.equal(seen[2], pathToFileURL(path.join(os.homedir(), 'z.mjs')).href);
  const named = await loadDriver('a.mjs', { cfg: {}, importer: async () => ({ driver: { environments: 1, tag: 'named' } }) });
  assert.equal(named.tag, 'named', '`driver`, then the default, then the module — the same three readings bin/promoterun.js allows');
});

await check('a driver that will not load is a line and a refused run, never a crash and never a claim', async () => {
  const r = rig();
  r.sweeper = createPromotionSweep({
    tracker: r.bd,
    cfg: r.cfg,
    allowed: () => true,
    load: async () => {
      throw new Error('Cannot find module');
    },
    deploys: () => [],
    log: (l) => r.logs.push(l),
    emit: (e) => r.events.push(e),
    now: () => T0,
    bootedAt: T0 - 60_000,
  });
  await runOnce(r);
  assert.ok(untouched(r.bd));
  assert.ok(r.logs.some((l) => /the driver would not load — Cannot find module/.test(l)));
});

/* --------------------------------------------------------------------- report */

await cleanupTmp(tmp);
console.log(`\n${ran - failures}/${ran} checks passed`);
if (failures) process.exit(1);
console.log('all good');
