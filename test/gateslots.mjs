#!/usr/bin/env node
//
// How much of this Mac a gate is allowed to take — bc-xlz32.1 and bc-xlz32.5.
//
//   node test/gateslots.mjs
//
// Two halves of one budget. `acquireSlot` caps how many gates run at once; `chooseJobs`
// picks how many suites one gate runs. lib/gate.js carries both so they can be driven
// directly here, against a slot directory this suite owns, rather than by starting real
// gates and watching the load average — which is the measurement that made the bead, and
// is not a test.
//
// The three properties worth proving are the three that were wrong before: that a third
// gate WAITS rather than being refused (a refused session runs `node scripts/test.mjs`
// instead, which is worse than the problem), that a holder killed with SIGKILL frees its
// slot rather than wedging the machine forever, and that a runner started INSIDE a gate
// never queues behind the slot its own parent is holding.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const gate = await import(path.join(ROOT, 'lib', 'gate.js'));

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, fn) => {
  try {
    fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};
const checkAsync = async (name, fn) => {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-gateslots-'));
/**
 * Every acquire in this file is pointed under `tmp`, so nothing touches the real Mac-wide
 * one — and each check gets a semaphore of its own, because a check that fails leaves its
 * slots held and its pending acquire pending. Sharing one directory meant the next check
 * waited on a slot nothing would ever free, so a one-line assertion failure came back as
 * the whole suite timing out at 300s, which is what this red actually looked like in CI.
 */
const room = (name) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

console.log('\nhow many gates at once\n');

await checkAsync('the first two hold slots and the third does not', async () => {
  const base = room('two-at-once');
  const first = await gate.acquireSlot({ base, limit: 2, pid: process.pid, pollMs: 5 });
  const second = await gate.acquireSlot({ base, limit: 2, pid: process.pid, pollMs: 5 });
  assert.equal(first.held, true, 'first should hold');
  assert.equal(second.held, true, 'second should hold');
  assert.equal(gate.liveSlots(base).length, 2);

  let waited = 0;
  const third = gate.acquireSlot({
    base,
    limit: 2,
    pid: process.pid,
    pollMs: 5,
    onWait: () => (waited += 1),
  });
  // It must still be waiting, not refused and not resolved — give it real polls to prove it.
  const race = await Promise.race([third, new Promise((r) => setTimeout(() => r('still waiting'), 120))]);
  assert.equal(race, 'still waiting', 'the third gate should queue, not run');
  assert.ok(waited > 0, 'a waiting gate should be told what it is waiting for');

  // …and take the slot the moment one is free, rather than needing to be started again.
  first.release();
  const got = await third;
  assert.equal(got.held, true);
  assert.ok(got.waitedMs >= 0);
  second.release();
  got.release();
  assert.equal(gate.liveSlots(base).length, 0, 'released slots leave nothing behind');
});

await checkAsync('a gate arriving later never sorts ahead of one already holding', async () => {
  // The bug that made this suite red on main, and it is not only a suite: the queue orders
  // by `startedAt`, and `Date.now()` is a whole millisecond, so tickets taken back-to-back
  // all landed inside one. Equal stamps fell through to the random suffix in each ticket's
  // filename, and the newcomer sorted first about two times in three — taking a slot two
  // gates ahead of it were already holding, which is `limit + 1` gates on the Mac at once.
  // Sub-millisecond stamps are what make the order creation order, so assert exactly that.
  const base = room('never-overtake');
  const taken = [];
  for (let i = 0; i < 6; i += 1) {
    taken.push(await gate.acquireSlot({ base, limit: 6, pid: process.pid, pollMs: 5 }));
  }
  const stamps = gate.liveSlots(base).map((t) => t.startedAt);
  assert.equal(stamps.length, 6);
  for (let i = 1; i < stamps.length; i += 1) {
    assert.ok(stamps[i] > stamps[i - 1], `ticket ${i} must sort after ${i - 1} — ${stamps.join(', ')}`);
  }
  taken.forEach((t) => t.release());
});

await checkAsync('a queue is FIFO — the gate that waited longest goes first', async () => {
  const base = room('fifo');
  const holder = await gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5 });
  const early = gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5 });
  await new Promise((r) => setTimeout(r, 20));
  const late = gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5 });
  await new Promise((r) => setTimeout(r, 20));

  holder.release();
  const first = await early;
  const stillWaiting = await Promise.race([late, new Promise((r) => setTimeout(() => r('waiting'), 60))]);
  assert.equal(stillWaiting, 'waiting', 'the later gate must not overtake the earlier one');
  first.release();
  (await late).release();
});

await checkAsync('a holder killed with SIGKILL frees its slot', async () => {
  const base = room('sigkill');
  const script = path.join(tmp, 'holder.mjs');
  fs.writeFileSync(
    script,
    `import { acquireSlot } from ${JSON.stringify(path.join(ROOT, 'lib', 'gate.js'))};\n` +
      `await acquireSlot({ base: ${JSON.stringify(base)}, limit: 1, pollMs: 5 });\n` +
      `console.log('held');\n` +
      // Not \`await new Promise(() => {})\` — an unsettled top-level await holds nothing
      // open on its own, and Node exits anyway (with a warning) once there is truly
      // nothing else pending on the event loop. That went unnoticed as long as nothing
      // was listening for this process's own \`exit\` — bc-arj0.25 armed \`acquireSlot\`'s
      // own \`onExit(release)\` right after taking the ticket, so that natural, unintended
      // exit now runs \`release()\` and removes the very ticket this check means to catch
      // still standing. A real interval is a real keep-alive, the way an actual holder is.
      `setInterval(() => {}, 3_600_000);\n`,
  );
  const holder = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((resolve, reject) => {
    holder.stdout.on('data', (d) => String(d).includes('held') && resolve());
    holder.on('error', reject);
    setTimeout(() => reject(new Error('the holder never took its slot')), 10_000);
  });
  assert.equal(gate.liveSlots(base).length, 1, 'the child should be holding one');

  holder.kill('SIGKILL');
  await new Promise((resolve) => holder.on('close', resolve));

  // Nothing ran a cleanup — the ticket file is still on disk, and its pid is not.
  assert.equal(fs.readdirSync(gate.slotDir(base)).filter((f) => f.endsWith('.json')).length, 1);
  const mine = await gate.acquireSlot({ base, limit: 1, pollMs: 5 });
  assert.equal(mine.held, true, 'a dead holder must not wedge the machine');
  mine.release();
});

console.log('\nthe three runs that must never queue\n');

check('a runner inside a gate does not take a second slot', () => {
  assert.equal(gate.slotLimit({ [gate.HELD_ENV]: '1' }), 0);
  // …and that is the variable both runners actually set on every suite child.
  const runners = ['lib/gate.js', 'scripts/test.mjs'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  for (const [i, src] of runners.entries()) {
    assert.match(src, /\[HELD_ENV\]: '1'/, `${['lib/gate.js', 'scripts/test.mjs'][i]} must mark its suite children`);
  }
});

check('CI never queues behind this Mac', () => {
  assert.equal(gate.slotLimit({ CI: 'true' }), 0);
});

check('the opt-out is a number, and a nonsense one falls back rather than disabling', () => {
  assert.equal(gate.slotLimit({ BEADCAUSE_GATE_SLOTS: '0' }), 0);
  assert.equal(gate.slotLimit({ BEADCAUSE_GATE_SLOTS: '4' }), 4);
  assert.equal(gate.slotLimit({ BEADCAUSE_GATE_SLOTS: 'yes' }), gate.DEFAULT_SLOTS);
  assert.equal(gate.slotLimit({}), gate.DEFAULT_SLOTS);
});

await checkAsync('a disabled semaphore is a no-op that still answers, and writes nothing', async () => {
  const off = path.join(tmp, 'off');
  const slot = await gate.acquireSlot({ base: off, limit: 0 });
  assert.equal(slot.held, false);
  slot.release();
  assert.equal(fs.existsSync(gate.slotDir(off)), false, 'nothing to take means nothing to create');
});

console.log('\nsmall gates have a lane of their own (bc-xlz32.12)\n');

await checkAsync('a small gate does not wait behind two full gates that arrived first', async () => {
  // The 35-minute wait on 2026-08-27: 11 suites, twelve seconds of work, parked behind two
  // full runs because the queue could not tell them apart.
  const base = room('small-overtakes');
  const a = await gate.acquireSlot({ base, limit: 2, pollMs: 5 });
  const b = await gate.acquireSlot({ base, limit: 2, pollMs: 5 });
  const fullWaiter = gate.acquireSlot({ base, limit: 2, pollMs: 5 });
  const small = await Promise.race([
    gate.acquireSlot({ base, limit: 2, pollMs: 5, lane: gate.SMALL_LANE }),
    new Promise((r) => setTimeout(() => r('still waiting'), 500)),
  ]);
  assert.notEqual(small, 'still waiting', 'a small gate must get straight in');
  assert.equal(small.held, true);
  assert.equal(small.ahead, 0);
  // …and the full lane is exactly as tight as it was: the third full gate is still queued.
  const race = await Promise.race([fullWaiter, new Promise((r) => setTimeout(() => r('still waiting'), 120))]);
  assert.equal(race, 'still waiting', 'a small ticket must not free or consume a full slot');
  assert.equal(gate.liveSlots(base).length, 3, 'the full lane sees only full tickets');
  assert.equal(gate.liveSlots(base, gate.SMALL_LANE).length, 1);
  a.release();
  const got = await fullWaiter;
  assert.equal(got.held, true);
  for (const s of [b, got, small]) s.release();
  assert.equal(gate.liveSlots(base).length + gate.liveSlots(base, gate.SMALL_LANE).length, 0);
});

await checkAsync('the small lane is bounded too, so a burst of narrow gates still queues', async () => {
  const base = room('small-bounded');
  const one = await gate.acquireSlot({ base, limit: 1, pollMs: 5, lane: gate.SMALL_LANE });
  const two = gate.acquireSlot({ base, limit: 1, pollMs: 5, lane: gate.SMALL_LANE });
  const race = await Promise.race([two, new Promise((r) => setTimeout(() => r('still waiting'), 120))]);
  assert.equal(race, 'still waiting');
  one.release();
  (await two).release();
});

check('a gate is charged by its size, and an unknown size is charged as full', () => {
  const env = {};
  assert.deepEqual(gate.gateAdmission(11, env), { lane: 'small', limit: gate.SMALL_SLOTS, admission: 'small' });
  assert.equal(gate.gateAdmission(gate.SMALL_GATE_SUITES, env).lane, 'small');
  assert.equal(gate.gateAdmission(gate.SMALL_GATE_SUITES + 1, env).lane, 'full');
  assert.deepEqual(gate.gateAdmission(503, env), { lane: 'full', limit: gate.DEFAULT_SLOTS, admission: 'full' });
  assert.equal(gate.gateAdmission(NaN, env).lane, 'full', 'the Python arm has no suite count');
});

check('the small lane is off wherever the full one is — held, CI, opted out', () => {
  for (const env of [{ [gate.HELD_ENV]: '1' }, { CI: 'true' }, { BEADCAUSE_GATE_SLOTS: '0' }]) {
    assert.equal(gate.smallSlotLimit(env), 0, JSON.stringify(env));
    assert.deepEqual(gate.gateAdmission(5, env).admission, 'off', JSON.stringify(env));
    assert.deepEqual(gate.gateAdmission(500, env).admission, 'off', JSON.stringify(env));
  }
  assert.equal(gate.smallSlotLimit({ BEADCAUSE_GATE_SMALL_SLOTS: '3' }), 3);
  assert.equal(gate.smallSlotLimit({ BEADCAUSE_GATE_SMALL_SLOTS: 'x' }), gate.SMALL_SLOTS);
  // A small lane switched off on its own sends small gates to the full lane, never around it.
  assert.deepEqual(gate.gateAdmission(5, { BEADCAUSE_GATE_SMALL_SLOTS: '0' }), {
    lane: 'full',
    limit: gate.DEFAULT_SLOTS,
    admission: 'full',
  });
});

check('b7e-gate counts its suites before it asks for a slot', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'bin', 'b7e-gate'), 'utf8');
  const selected = cli.indexOf('const SELECTED =');
  const acquired = cli.indexOf('await acquireSlot(');
  const started = cli.indexOf('await startRun(');
  assert.ok(selected > 0 && acquired > 0 && started > 0);
  assert.ok(selected < acquired, 'the suite list must be known before the slot is taken');
  assert.ok(acquired < started, 'startRun stays after the wait: a run killed in the queue leaves no record');
});

check('a waiting gate says what it is waiting for, and how long it has been', () => {
  const now = 10 * 60_000;
  const line = gate.waitingLine({ ahead: 2, oldest: { startedAt: now - 4 * 60_000 } }, now);
  assert.match(line, /2 gates ahead of you/);
  assert.match(line, /4m ago/);
  assert.match(gate.waitingLine({ ahead: 1, oldest: { startedAt: now } }, now), /1 gate ahead of you/);
  assert.match(gate.waitingLine({ ahead: 1 }, now), /waiting/);
});

console.log('\nhow many suites at once\n');

check('an idle Mac gets most of itself, not six', () => {
  assert.equal(gate.chooseJobs({ cores: 12, load: 0.2 }), 10);
  assert.equal(gate.chooseJobs({ cores: 12, load: 1.5 }), 10);
});

check('a busy Mac gets what is actually free', () => {
  assert.equal(gate.chooseJobs({ cores: 12, load: 6 }), 6);
  assert.equal(gate.chooseJobs({ cores: 12, load: 9 }), 3);
});

check('a hopeless Mac still moves, and never asks for less than two', () => {
  assert.equal(gate.chooseJobs({ cores: 12, load: 99 }), 2);
  assert.equal(gate.chooseJobs({ cores: 2, load: 0 }), 2);
  assert.equal(gate.chooseJobs({ cores: 1, load: 0 }), 2);
});

check('the machine is left something to be usable with', () => {
  for (const cores of [4, 8, 12, 16]) {
    assert.ok(gate.chooseJobs({ cores, load: 0 }) <= Math.max(2, cores - 2), `${cores} cores`);
  }
});

check('the chosen number is said out loud, and an explicit ask says so instead', () => {
  assert.match(gate.jobsLine({ jobs: 10, cores: 12, load: 1.44, explicit: false }), /10 suites at once/);
  assert.match(gate.jobsLine({ jobs: 10, cores: 12, load: 1.44, explicit: false }), /12 cores, load 1\.4/);
  assert.equal(gate.jobsLine({ jobs: 4, cores: 12, load: 1.4, explicit: true }), '4 suites at once, as asked');
});

check('--jobs given still wins outright, the rule --timeout already follows', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'bin', 'b7e-gate'), 'utf8');
  assert.match(cli, /JOBS_EXPLICIT \?/, 'an explicit --jobs must bypass chooseJobs entirely');
});

console.log('\na gate whose session is gone — bc-xl7n.165\n');

// A process table shaped like the real one: a claude session, a shell under it, a gate
// wrapper detached from it by hand (reparented to 1), and a gate under that.
const TABLE = [
  { pid: 1, ppid: 0, comm: '/sbin/launchd' },
  { pid: 641, ppid: 1, comm: '/Applications/iTerm.app/Contents/MacOS/iTerm2' },
  { pid: 853, ppid: 641, comm: '/Users/x/Library/Application Support/iTerm2/iTermServer-3.7.1' },
  { pid: 900, ppid: 853, comm: '-zsh' },
  { pid: 901, ppid: 900, comm: 'claude' },
  { pid: 902, ppid: 901, comm: '/bin/zsh' },
  { pid: 903, ppid: 902, comm: 'node' },
  { pid: 950, ppid: 1, comm: 'node' },
  { pid: 951, ppid: 950, comm: 'node' },
];

check('the owner is the nearest claude session above the gate, through a shell', () => {
  assert.equal(gate.claudeAncestor(903, TABLE), 901);
  assert.equal(gate.claudeAncestor(902, TABLE), 901);
  assert.equal(gate.claudeAncestor(901, TABLE), 901, 'a claude process is its own nearest');
});

check('a chain that never meets a claude has no owner, and reparenting to 1 is not one', () => {
  assert.equal(gate.claudeAncestor(951, TABLE), null, 'ppid 1 is where a detached gate lives — it names nobody');
  assert.equal(gate.claudeAncestor(950, TABLE), null);
  assert.equal(gate.claudeAncestor(853, TABLE), null);
  assert.equal(gate.claudeAncestor(999999, TABLE), null, 'a pid nobody has');
});

check('a table with a cycle in it cannot spin the walk', () => {
  const loop = [
    { pid: 5, ppid: 6, comm: 'node' },
    { pid: 6, ppid: 5, comm: 'node' },
  ];
  assert.equal(gate.claudeAncestor(5, loop), null);
});

check('only the program named claude counts — not a path, a substring or a name that merely ends in it', () => {
  const t = [
    { pid: 10, ppid: 1, comm: '/Users/x/.local/bin/claude' },
    { pid: 11, ppid: 10, comm: 'node' },
    { pid: 20, ppid: 1, comm: '/Users/x/claude-notes/editor' },
    { pid: 21, ppid: 20, comm: 'node' },
    { pid: 30, ppid: 1, comm: 'claudette' },
    { pid: 31, ppid: 30, comm: 'node' },
  ];
  assert.equal(gate.claudeAncestor(11, t), 10, 'a full path to claude is claude');
  assert.equal(gate.claudeAncestor(21, t), null, 'a directory called claude-notes is not');
  assert.equal(gate.claudeAncestor(31, t), null, 'nor is claudette');
});

check('findOwner records the pid and its start time, and the environment wins over the table', () => {
  const start = (pid) => `started-${pid}`;
  assert.deepEqual(gate.findOwner({ env: {}, from: 903, table: TABLE, start }), { pid: 901, start: 'started-901' });
  assert.deepEqual(
    gate.findOwner({ env: { [gate.OWNER_ENV]: '4242' }, from: 903, table: TABLE, start }),
    { pid: 4242, start: 'started-4242' },
    'b7e-detach hands the owner across a setsid this way',
  );
  assert.equal(gate.findOwner({ env: { [gate.OWNER_ENV]: '0' }, from: 903, table: TABLE, start }), null, '0 is an explicit "nobody"');
  assert.equal(gate.findOwner({ env: { [gate.OWNER_ENV]: 'banana' }, from: 903, table: TABLE, start }), null, 'nonsense is no opinion, not a guess');
  assert.equal(gate.findOwner({ env: {}, from: 951, table: TABLE, start }), null);
});

check('a process table that cannot be read is no owner rather than a crash', () => {
  const table = () => {
    throw new Error('ps went away');
  };
  assert.equal(gate.findOwner({ env: {}, from: 903, table, start: () => null }), null);
});

check('the owner is alive only while the same process, started at the same time, is there', () => {
  const owner = { pid: 901, start: 'Sun 20 Sep 14:57:21 2026' };
  assert.equal(gate.ownerAlive(null), true, 'no owner means no opinion');
  assert.equal(gate.ownerAlive(owner, { start: () => 'Sun 20 Sep 14:57:21 2026' }), true);
  assert.equal(gate.ownerAlive(owner, { start: () => null }), false, 'gone');
  assert.equal(gate.ownerAlive(owner, { start: () => 'Sun 20 Sep 16:02:00 2026' }), false, 'the pid was reused by something else');
  assert.equal(gate.ownerAlive({ pid: 901, start: null }, { start: () => null }), false, 'an owner already dead when named is dead');
});

check('ownerGone asks at most every interval, and never un-asks a yes', () => {
  let asked = 0;
  let alive = true;
  let t = 0;
  const gone = gate.ownerGone({ pid: 1, start: 'x' }, { everyMs: 1000, clock: () => t, alive: () => (asked++, alive) });
  assert.equal(gone(), false);
  assert.equal(asked, 1, 'the first ask is immediate');
  alive = false;
  t = 500;
  assert.equal(gone(), false, 'inside the interval nothing is asked, so nothing is learned');
  assert.equal(asked, 1);
  t = 1000;
  assert.equal(gone(), true);
  alive = true;
  t = 5000;
  assert.equal(gone(), true, 'a session does not come back');
  assert.equal(asked, 2);
  assert.equal(gate.ownerGone(null)(), false, 'no owner is never gone');
});

await checkAsync('a queued gate whose owner has gone withdraws its ticket and is not held', async () => {
  const base = room('owner-gone-queued');
  const holder = await gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5 });
  let gone = false;
  const waiter = gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5, abandoned: () => gone });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(gate.liveSlots(base).length, 2, 'it is queued behind the holder');
  gone = true;
  const result = await waiter;
  assert.equal(result.abandoned, true);
  assert.equal(result.held, false);
  assert.equal(gate.liveSlots(base).length, 1, 'only the holder is left in line');
  holder.release();
});

await checkAsync('an owner already gone at the front of an empty queue takes no slot at all', async () => {
  const base = room('owner-gone-first');
  const result = await gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5, abandoned: () => true });
  assert.equal(result.abandoned, true);
  assert.equal(gate.liveSlots(base).length, 0, 'a run that was never wanted must not hold the slot for even a moment');
});

await checkAsync('abandoned is never asked once a slot is held — a run in progress is left to finish', async () => {
  const base = room('owner-not-asked-when-held');
  let asked = 0;
  const slot = await gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5, abandoned: () => (asked++, false) });
  assert.equal(slot.held, true);
  const askedAtAdmission = asked;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(asked, askedAtAdmission, 'nothing polls a holder');
  slot.release();
});

await checkAsync('a waiter that is not abandoned still waits and is FIFO — the option changes nothing else', async () => {
  const base = room('owner-alive-still-waits');
  const holder = await gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5, abandoned: () => false });
  let took = false;
  const waiter = gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5, abandoned: () => false }).then((s) => {
    took = true;
    return s;
  });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(took, false);
  holder.release();
  const s = await waiter;
  assert.equal(s.held, true);
  assert.equal(s.abandoned, undefined);
  s.release();
});

/**
 * The real CLI, against a fabricated tree and a semaphore of its own (`TMPDIR`), with the
 * three exemptions removed from its environment — a suite run inside a gate inherits
 * `HELD_ENV`, and inside CI `CI`, and either would switch the semaphore off and with it
 * the very code under test.
 */
const cliRun = (name, owner, bin = path.join('bin', 'b7e-gate')) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'test', 'a-pass.mjs'), 
    "import fs from 'node:fs';\nfs.writeFileSync(new URL('./a-pass.ran', import.meta.url), '1');\nprocess.exit(0);\n");
  const scratch = room(`${name}-tmp`);
  const env = { ...process.env, TMPDIR: scratch, BEADCAUSE_GATE_SLOTS: '1', [gate.OWNER_ENV]: String(owner) };
  delete env[gate.HELD_ENV];
  delete env.CI;
  const run = spawnSync(process.execPath, [path.join(ROOT, bin), '--dir', dir], { encoding: 'utf8', env, timeout: 120_000 });
  return { run, dir, scratch };
};

check('b7e-gate exits 3 and runs nothing when the session that started it is already gone', () => {
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.ok(dead.pid, 'a pid that has certainly exited');
  const { run, dir, scratch } = cliRun('cli-owner-gone', dead.pid);
  assert.equal(run.status, 3, `exit code — ${run.stderr}`);
  assert.match(run.stderr, /has gone — leaving the queue/);
  assert.ok(!fs.existsSync(path.join(dir, 'test', 'a-pass.ran')));
  const tickets = fs.existsSync(path.join(scratch, 'beadcause-gate-slots'))
    ? fs.readdirSync(path.join(scratch, 'beadcause-gate-slots')).filter((f) => f.endsWith('.json'))
    : [];
  assert.deepEqual(tickets, [], 'it left no ticket behind');
  const locks = fs.readdirSync(scratch).filter((f) => /^beadcause-gate-.*\.lock$/.test(f));
  assert.deepEqual(locks, [], 'and no per-tree lock — the next run on that tree is not refused by a ghost');
});

check('b7e-gate with a live owner, or none at all, runs exactly as before', () => {
  for (const [name, owner] of [['cli-owner-live', process.pid], ['cli-owner-none', 0]]) {
    const { run } = cliRun(name, owner);
    assert.equal(run.status, 0, `${name}: ${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /all 1 suites passed|1\/1|passed/i);
  }
});

console.log('\nnpm test answers to its session too (bc-xl7n.166)\n');

const NPM_TEST = path.join('scripts', 'test.mjs');

check('scripts/test.mjs exits 3 and runs nothing when the session that started it is already gone', () => {
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.ok(dead.pid, 'a pid that has certainly exited');
  const { run, dir, scratch } = cliRun('npmtest-owner-gone', dead.pid, NPM_TEST);
  assert.equal(run.status, 3, `${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /has gone — leaving the queue/);
  assert.ok(!fs.existsSync(path.join(dir, 'test', 'a-pass.ran')), 'it must not have run a suite');
  const semaphore = path.join(scratch, 'beadcause-gate-slots');
  const tickets = fs.existsSync(semaphore) ? fs.readdirSync(semaphore).filter((f) => f.endsWith('.json')) : [];
  assert.deepEqual(tickets, [], 'it left no ticket behind');
});

check('scripts/test.mjs with a live owner, or none at all, runs exactly as before', () => {
  for (const [name, owner] of [['npmtest-owner-live', process.pid], ['npmtest-owner-none', 0]]) {
    const { run, dir } = cliRun(name, owner, NPM_TEST);
    assert.equal(run.status, 0, `${name}: ${run.stdout}${run.stderr}`);
    assert.doesNotMatch(run.stdout, /has gone/);
    assert.ok(fs.existsSync(path.join(dir, 'test', 'a-pass.ran')), `${name}: the suite really ran`);
  }
});

check('scripts/test.mjs takes the same three lines b7e-gate has, and never tests ppid', () => {
  const src = fs.readFileSync(path.join(ROOT, NPM_TEST), 'utf8');
  assert.match(src, /const OWNER = findOwner\(\)/);
  assert.match(src, /abandoned: ownerGone\(OWNER\)/);
  assert.match(src, /process\.exit\(3\)/);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /ppid/, 'ppid 1 is what a healthy detached run looks like');
});

removeTreeSync(tmp);

console.log(
  failures ? `\n\x1b[31m${failures} failed\x1b[0m\n` : '\n\x1b[32mgate slots and job sizing hold\x1b[0m\n',
);
process.exit(failures ? 1 : 0);
