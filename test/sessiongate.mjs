#!/usr/bin/env node
/**
 * No session opens on a bead as an agent kind with no current impact assessment —
 * lib/sessiongate.js, bc-eqn1.8.1.
 *
 *     npm test
 *     node test/sessiongate.mjs
 *
 * The amendment gate (test/impact.mjs) stops an agent being *widened* without an
 * assessment; this one stops it being *put to work* without one, at `launch` in
 * lib/session.js, which every window on a bead passes. Four claims:
 *
 *   - the decision is lib/impact.js's, pure, and names the control and the state;
 *   - with the management system on, the door refuses, and the refusal lands on the bead
 *     in lib/capa.js's shape — a `GATE REFUSED` comment naming ISO42001.Clause6.1.4 and the
 *     `gate-refused` label, readable back by `refusalsFrom`, never a nonconformity;
 *   - **a second refusal writes nothing** — the same bead in the same assessment state is
 *     one comment, however many times it is asked;
 *   - and the advocate does not ask a second time at all: the tick after a refusal opens
 *     nothing on that bead, and the management system going off lets it through again.
 *
 * And with the management system off the launch proceeds exactly as before — which in a
 * suite means it reaches lib/launchguard.js's refusal, the proof it got past this one.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp, quiesce } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-sessiongate-'));
// Before anything under lib/ is imported: the management switch lives in CONFIG_DIR, and
// this suite turns it on. Never the real one — scripts/selftest.mjs runs against that.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });
// Where `launch` would write its temp files; empty at the end is the proof nothing was.
const SPOOL = path.join(tmp, 'spool');
fs.mkdirSync(SPOOL);
process.env.TMPDIR = SPOOL;

const impact = await import(LIB('impact.js'));
const { REFUSAL_LABEL, kindFromLabels, refusalsFrom } = await import(LIB('capa.js'));
const { ROLES } = await import(LIB('aims.js'));
const management = await import(LIB('management.js'));
const { openWorkSession, openPlanSession } = await import(LIB('session.js'));
const { createAdvocates } = await import(LIB('advocate.js'));

const { CONTROL, LAUNCH_GATE, launchGate, refusedAlready, assessmentFor, digest } = impact;

/* --------------------------------------------------------------------- harness */

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
}
const refusedBy = (fn) => fn().then(() => null, (err) => err);

const NOW = new Date('2026-10-24T12:00:00Z');
const holder = ROLES.find((r) => r.id === 'impact-approver').holder;

/** The real draft for an agent, approved the way a person would — digest and all. */
function approved(system, { on = '2026-10-01', expiresOn = '2027-10-01' } = {}) {
  const e = { ...assessmentFor(system), awaitingApproval: null, approval: { role: 'impact-approver', by: holder, on, expiresOn, digest: '' } };
  e.approval.digest = digest(e);
  return e;
}
const registerWith = (entry) => impact.REGISTER.map((e) => (e.system === entry.system ? entry : e));

/* ---------------------------------------------------------------- the fixture */

const CHECKOUT = path.join(tmp, 'checkout');
fs.mkdirSync(CHECKOUT);
execFileSync('git', ['init', '-q'], { cwd: CHECKOUT, stdio: 'pipe' });
const cfg = {
  sessionDirs: { demo: CHECKOUT },
  openSessions: true,
  pr: { enabled: false },
  sessionWindows: { layout: false, stealFocus: true },
};
const ws = { name: 'demo', dir: CHECKOUT };
const row = {
  id: 'zz-work',
  title: 'the drawer forgets its scroll position',
  status: 'open',
  issue_type: 'task',
  priority: 2,
  labels: [],
  description: 'a bead like any other',
};
const epic = { ...row, id: 'zz-epic', title: 'an epic worth planning', issue_type: 'epic' };

/** A tracker that answers `show` and keeps the comments and labels it is handed. */
function tracker(rows) {
  const comments = new Map();
  const labels = new Map();
  return {
    comments: async (_ws, id) => (comments.get(id) || []).map((text) => ({ text })),
    comment: async (_ws, id, text) => comments.set(id, [...(comments.get(id) || []), text]),
    addLabel: async (_ws, id, label) => labels.set(id, [...new Set([...(labels.get(id) || []), label])]),
    show: async (_ws, id) => rows.find((r) => r.id === id) || null,
    written: (id) => comments.get(id) || [],
    labelsOf: (id) => labels.get(id) || [],
  };
}

console.log('\nno session opens on an agent kind with no current impact assessment\n');

/* ============================================ 1. the decision, as a pure function */

await check('a draft assessment refuses, naming the control, the gate and the state', () => {
  const r = launchGate({ agent: 'worker', bead: 'zz-work', now: NOW });
  assert.ok(r, 'every shipped assessment is a draft, so the worker is refused');
  assert.equal(r.record.kind, 'refusal');
  assert.equal(r.record.control, CONTROL);
  assert.equal(CONTROL, 'ISO42001.Clause6.1.4');
  assert.equal(r.record.gate, LAUNCH_GATE);
  assert.notEqual(LAUNCH_GATE, impact.GATE, 'a second door gets its own name');
  assert.match(r.record.subject, /a worker session on zz-work \(assessment draft\)/);
  assert.match(r.record.why, /draft/);
});

await check('a current assessment lets the session through', () => {
  const register = registerWith(approved('worker'));
  assert.equal(launchGate({ agent: 'worker', bead: 'zz-work', register, now: NOW }), null);
});

await check('a lapsed one refuses again, under a different subject than the draft did', () => {
  const register = registerWith(approved('worker', { on: '2025-01-01', expiresOn: '2026-01-01' }));
  const lapsed = launchGate({ agent: 'worker', bead: 'zz-work', register, now: NOW });
  const draft = launchGate({ agent: 'worker', bead: 'zz-work', now: NOW });
  assert.ok(lapsed);
  assert.match(lapsed.record.subject, /expired/);
  assert.notEqual(lapsed.record.subject, draft.record.subject, 'a new state is a new refusal to record');
});

await check('an agent kind the register has never heard of is refused as missing', () => {
  const r = launchGate({ agent: 'no-such-kind', bead: 'zz-work', now: NOW });
  assert.match(r.record.subject, /assessment missing/);
});

/* ========================================== 2. management off — the door is inert */

await check('with the management system off the launch proceeds, unchanged', async () => {
  assert.equal(await management.isOn(), false, 'a fresh config dir starts off');
  const bd = tracker([row]);
  const err = await refusedBy(() => openWorkSession(cfg, ws, row, { bd }));
  assert.ok(err, 'a window was opened by a test run');
  assert.equal(err.noLaunch, true, `refused by something other than the suite guard: ${err.message}`);
  assert.equal(err.impactRefused, undefined);
  assert.deepEqual(bd.written('zz-work'), [], 'and nothing was written on the bead');
});

/* ============================================ 3. management on — refused, once */

await management.enable({ reason: 'test/sessiongate.mjs exercises the launch gate', by: 'test' });
const bd = tracker([row, epic]);

await check('with it on, the door refuses a worker on a draft — on the bead, in capa shape', async () => {
  const err = await refusedBy(() => openWorkSession(cfg, ws, row, { bd }));
  assert.ok(err, 'a window was opened by a test run');
  assert.equal(err.impactRefused, true, `refused by something else: ${err.message}`);
  assert.equal(err.status, 409);
  assert.equal(err.written, true);
  const refusals = refusalsFrom(bd.written('zz-work').map((text) => ({ text })), { bead: 'zz-work' });
  assert.equal(refusals.length, 1, 'one refusal comment on the bead');
  assert.equal(refusals[0].control, 'ISO42001.Clause6.1.4');
  assert.equal(refusals[0].gate, LAUNCH_GATE);
  assert.deepEqual(bd.labelsOf('zz-work'), [REFUSAL_LABEL]);
  assert.equal(kindFromLabels(bd.labelsOf('zz-work')).id, 'refusal', 'the control working, not a nonconformity');
});

await check('a second launch on the same bead in the same state writes no second comment', async () => {
  const err = await refusedBy(() => openWorkSession(cfg, ws, row, { bd }));
  assert.equal(err?.impactRefused, true, 'still refused — the assessment is still a draft');
  assert.equal(err.written, false);
  assert.equal(bd.written('zz-work').length, 1, `the bead has ${bd.written('zz-work').length} refusal comments`);
  assert.equal(refusedAlready(await bd.comments(ws, 'zz-work'), err.refusal), true);
});

await check('the planner door is the same door', async () => {
  const err = await refusedBy(() => openPlanSession(cfg, ws, epic, { bd }));
  assert.equal(err?.impactRefused, true, `refused by something else: ${err?.message}`);
  assert.equal(bd.written('zz-epic').length, 1);
});

await check('a tracker that cannot write still does not let the window through', async () => {
  const deaf = { show: async () => row };
  const err = await refusedBy(() => openWorkSession(cfg, ws, row, { bd: deaf }));
  assert.equal(err?.impactRefused, true);
  assert.equal(err.written, false);
});

await check('and nothing was spooled for a window — the refusal comes before the launch', () => {
  assert.deepEqual(fs.readdirSync(SPOOL).filter((f) => f.startsWith('beadcause-')), []);
});

/* ======================================= 4. the advocate asks once, not every tick */

const REPO = path.join(tmp, 'projects', 'alpha');
fs.mkdirSync(REPO, { recursive: true });
const SESSIONS = path.join(tmp, 'claude-sessions');
fs.mkdirSync(SESSIONS, { recursive: true });
const OLD = '2020-01-01T00:00:00Z';
const queued = { id: 'zz-q', title: 'queued work', priority: 2, issue_type: 'task', created_at: OLD };

const acfg = {
  projectRoot: path.join(tmp, 'projects'),
  fallbackWorkspace: 'other',
  claudeSessionsDir: SESSIONS,
  spaces: [],
  workspaces: [{ name: 'alpha', dir: path.join(os.homedir(), 'beads', 'alpha', '.beads') }],
  sessionDirs: { alpha: REPO },
  advocates: {
    enabled: true,
    workspaces: '*',
    maxWorkers: 3,
    settleSeconds: 0,
    launchCooldownSeconds: 0,
    propose: false,
    tidyWorktrees: false,
    respectQuietHours: false,
    reconcileLanded: false,
    askSuperseded: false,
    flagInMain: false,
    sessionLog: false,
  },
};
fs.writeFileSync(path.join(process.env.BEADCAUSE_CONFIG_DIR, 'config.json'), JSON.stringify(acfg, null, 2));

const asked = [];
const advocates = createAdvocates(acfg, {
  bd: {
    ready: async () => [queued],
    listLabel: async () => [],
    show: async (_ws, id) => ({ id, status: 'open' }),
    children: async () => [],
    listStatus: async () => [],
    graph: async () => ({ parents: new Map(), adopts: new Map(), edges: new Map(), beads: new Map() }),
  },
  bus: { emit() {} },
  // The door, standing in for lib/session.js: it refuses the way `assertAssessed` does
  // while the management system is on, and records that it was asked.
  open: async (_cfg, _ws, b) => {
    asked.push(b.id);
    if (await management.isOn()) {
      const { record, message } = launchGate({ agent: 'worker', bead: b.id });
      throw Object.assign(new Error(message), { status: 409, impactRefused: true, refusal: record });
    }
    return { dir: REPO, mode: 'test', term: null };
  },
  prs: async () => ({ ok: true, reason: '', checked: 0, beads: new Map() }),
  psLines: async () => [],
});

await check('the first tick asks the door and is refused, and costs the bead no attempt', async () => {
  await advocates.tick();
  assert.deepEqual(asked, ['zz-q']);
  const card = advocates.snapshot().find((a) => a.workspace === 'alpha');
  assert.match(card.note || '', /zz-q — no session opened/);
  assert.deepEqual(card.givenUp || [], [], 'a refusal is not a failed launch');
});

await check('the second tick does not ask again — no slot spent, nothing re-refused', async () => {
  await advocates.tick();
  assert.deepEqual(asked, ['zz-q'], `the door was asked ${asked.length} times`);
  const card = advocates.snapshot().find((a) => a.workspace === 'alpha');
  assert.match(card.note || '', /1 refused by the impact assessment gate/);
  assert.doesNotMatch(card.note || '', /settling/, 'a bead waiting on an approval is not settling');
});

await check('the management system going off lets the bead through on the next tick', async () => {
  await management.disable({ reason: 'test/sessiongate.mjs', by: 'test' });
  await advocates.tick();
  assert.deepEqual(asked, ['zz-q', 'zz-q']);
});

await quiesce();
cleanupTmp(tmp);
console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
