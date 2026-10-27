#!/usr/bin/env node
/**
 * The stall clock, driven through a real advocate tick — bc-dhayi.
 *
 *     node test/stallsweep.mjs
 *
 * test/stalled.mjs pins the decision; this pins the **wiring**, which is where every one
 * of the interesting failures lives. A pure verdict that is never reached, a clock stamped
 * on a tick that should have left it alone, a P0 filed twice because the second tick could
 * not see the first — none of those is visible in lib/stalled.js, and all three would ship
 * a detector that looks correct and reports nothing.
 *
 * The fixture is the exact shape the bead was filed about: a queue of one bead, retired by
 * `maxAttemptsPerBead`, so the advocate is free to launch, has work waiting, and opens
 * nothing — for ever, on its own. The clock is seeded old in `advocates.json` rather than
 * waited out, which is also the assertion that the field survives a restart: nothing but
 * `record` reading what `persist` wrote puts it there.
 *
 * What it claims:
 *
 *   - **a retired queue past the window files exactly one P0**, and it is `human` so it
 *     can never be dispatched back into the queue it is reporting on;
 *   - **the next tick, seeing it, files nothing** — the dedupe is the title, and a second
 *     bead every thirty seconds is the failure mode this whole design is shaped around;
 *   - **a session opening closes it**, which is the acceptance criterion and the only
 *     claim here that needs two ticks and a real launch between them;
 *   - **a workspace that is merely empty gets no bead**, which is the other half of it;
 *   - **a paused advocate gets none either**, and its clock does not run — the morning
 *     false alarm;
 *   - **the clock is on both halves of the persist whitelist**, without which it is reset
 *     by every one of this daemon's several restarts a day and never reaches six hours.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quiesce, removeTree } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-stallsweep-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const SESSIONS = path.join(tmp, 'claude-sessions');
const REPO = path.join(tmp, 'projects', 'alpha');
fs.mkdirSync(SESSIONS, { recursive: true });
fs.mkdirSync(REPO, { recursive: true });

const { createAdvocates } = await import(LIB('advocate.js'));
const { STALL_LABEL, stallTitle } = await import(LIB('stalled.js'));
const { QUEUE_EXCLUDED } = await import(LIB('endorse.js'));

const STATE = path.join(process.env.BEADCAUSE_CONFIG_DIR, 'advocates.json');
const DAY = 24 * 3600 * 1000;
const long = () => new Date(Date.now() - 2 * DAY).toISOString();

const bead = (id, title) => ({ id, title, priority: 2, issue_type: 'task', created_at: '2020-01-01T00:00:00Z' });

/**
 * One machine whose only ready bead is one the attempt cap has retired.
 *
 * `rows` is the `bd export` index the tick builds once and everything in it shares —
 * including the stall search, which is why a bead this fixture *files* has to land in it
 * for the second tick to find. Nothing else here needs it.
 */
function machine({ ready = [bead('al-1', 'a bead two windows died on')], stallHours = 6 } = {}) {
  const rows = new Map([['al-1', { id: 'al-1', title: 'a bead two windows died on', status: 'open', labels: [] }]]);
  const filed = [];
  const closed = [];
  const bd = {
    ready: async () => ready,
    listLabel: async () => [],
    show: async (_ws, id) => ({ id, status: 'open' }),
    children: async () => [],
    listStatus: async () => [],
    graph: async () => ({ beads: rows, parents: new Map(), adopts: new Map(), edges: new Map() }),
    create: async (_ws, issue) => {
      filed.push(issue);
      const id = `al-stall-${filed.length}`;
      rows.set(id, { id, title: issue.title, status: 'open', labels: issue.labels });
      return id;
    },
    close: async (_ws, id, reason) => {
      closed.push({ id, reason });
      const row = rows.get(id);
      if (row) row.status = 'closed';
    },
    comment: async () => {},
  };

  const cfg = {
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
      maxAttemptsPerBead: 2,
      settleSeconds: 0,
      launchCooldownSeconds: 0,
      stallHours,
      propose: false,
      tidyWorktrees: false,
      respectQuietHours: false,
      reconcileLanded: false,
      askSuperseded: false,
      flagInMain: false,
      flagFinishedEpics: false,
      flagNotInMain: false,
      sessionLog: false,
    },
  };

  const opened = [];
  const advocates = createAdvocates(cfg, {
    bd,
    bus: { emit() {} },
    open: async (_cfg, _ws, b) => {
      opened.push(b.id);
      return { dir: REPO, mode: 'test', term: null };
    },
    prs: async () => ({ ok: true, reason: '', checked: 0, beads: new Map() }),
    psLines: async () => [],
  });

  return { filed, closed, opened, advocates, tick: () => advocates.tick() };
}

/**
 * The clock, seeded old, exactly as a restart would hand it back.
 *
 * Written before `createAdvocates` runs, because `record` reads `advocates.json` once at
 * construction — which is also what makes this the assertion that `silentSince` is on both
 * halves of the persist whitelist rather than quietly dropped at the next restart.
 */
function seedStalled({ attempts = 2, paused = false } = {}) {
  fs.writeFileSync(
    STATE,
    JSON.stringify({
      alpha: {
        paused,
        workers: [],
        closing: [],
        closingWindows: [],
        attempts: { 'al-1': attempts },
        // Already recounted, so `auditAttempts` does not go looking for a daemon log.
        attemptAudited: { 'al-1': attempts },
        lastLaunchAt: long(),
        silentSince: long(),
      },
    })
  );
}

async function reset() {
  await quiesce();
  for (const f of fs.readdirSync(process.env.BEADCAUSE_CONFIG_DIR)) {
    await removeTree(path.join(process.env.BEADCAUSE_CONFIG_DIR, f));
  }
  for (const f of fs.readdirSync(SESSIONS)) fs.rmSync(path.join(SESSIONS, f), { force: true });
}

let failures = 0;
let ran = 0;
const acheck = async (name, fn) => {
  ran += 1;
  try {
    await reset();
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`);
  }
};

console.log('\nthe stall clock, through a real tick\n');

await acheck('a queue every bead of which is retired files exactly one P0', async () => {
  seedStalled();
  const m = machine();
  await m.tick();
  assert.deepEqual(m.opened, [], 'the whole point: nothing launches, for ever, on its own');
  assert.equal(m.filed.length, 1);
  const issue = m.filed[0];
  assert.equal(issue.title, stallTitle('alpha'));
  assert.equal(issue.priority, 0);
  assert.ok(issue.labels.includes(STALL_LABEL));
  // A queueable bead here would make "there is work waiting" true for ever, and the
  // stall could then never end on its own.
  assert.ok(issue.labels.some((l) => QUEUE_EXCLUDED.includes(l)));
  // The retired id, which is the sentence the tick note buried.
  assert.match(issue.body, /al-1/);
  assert.match(issue.body, /maxAttemptsPerBead/);
});

await acheck('and the tick after it writes nothing — the dedupe is the title', async () => {
  seedStalled();
  const m = machine();
  await m.tick();
  await m.tick();
  await m.tick();
  assert.equal(m.filed.length, 1, 'a second bead every thirty seconds is the failure this is shaped around');
  assert.deepEqual(m.closed, []);
});

await acheck('a session opening closes it — the acceptance criterion, through a real tick', async () => {
  seedStalled();
  const m = machine();
  await m.tick();
  assert.equal(m.filed.length, 1);
  // Exactly what pressing "Forget attempts" does, through the door lib/server.js uses.
  m.advocates.rearm('alpha', 'al-1');
  await m.tick();
  assert.deepEqual(m.opened, ['al-1'], 'the launch is the event the bead is waiting for');
  assert.equal(m.closed.length, 1);
  assert.match(m.closed[0].reason, /opened a session again/);
});

await acheck('a workspace that is merely empty gets no bead at all', async () => {
  seedStalled();
  const m = machine({ ready: [] });
  await m.tick();
  assert.deepEqual(m.filed, [], 'an advocate with nothing to do that does nothing is an advocate that is right');
});

await acheck('a paused advocate gets none either, and its clock does not run', async () => {
  seedStalled({ paused: true });
  const m = machine();
  await m.tick();
  assert.deepEqual(m.filed, []);
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  // Stamped fresh this tick, so the two days of silence somebody asked for are not
  // carried into the moment the pause comes off.
  assert.ok(Date.now() - new Date(state.alpha.silentSince).getTime() < 60_000);
});

await acheck('the clock survives the write, or it never reaches six hours on this daemon', async () => {
  seedStalled();
  const m = machine();
  await m.tick();
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  assert.ok(state.alpha.silentSince, 'absent from persist() is absent from record(), and the loss is invisible');
  // Still the seeded value: a stalled tick must not restamp its own clock, or the bead
  // would be filed once and the condition would read as new on every tick after it.
  assert.ok(Date.now() - new Date(state.alpha.silentSince).getTime() > DAY);
});

await acheck('switched off with stallHours 0, nothing is measured', async () => {
  seedStalled();
  const m = machine({ stallHours: 0 });
  await m.tick();
  assert.deepEqual(m.filed, []);
});

await quiesce();
await removeTree(tmp);

console.log(`\n${failures ? `${failures} of ${ran} failed` : `${ran} passed`}\n`);
process.exit(failures ? 1 : 0);
