#!/usr/bin/env node
//
// b7e-queue — where a gate stands in the machine-wide slot queue, and whether anything
// ahead of it is actually alive (bc-dgx7.116).
//
//   node test/b7equeue.mjs
//
// The queue mechanics (`lib/queue.js`) are driven directly against real tickets in a
// scratch `slotDir`, the same way test/gateslots.mjs drives `lib/gate.js` itself — real
// `acquireSlot` calls, a `base` this suite owns, nothing shared with the real Mac-wide
// semaphore. `myRow`/`withMismatches` are also driven with fabricated `discover`/
// `listWorktrees` deps where a real worktree is not needed, the same shape test/gates.mjs
// already uses for `discover` itself. A handful of real-worktree and CLI-level checks at
// the end cover what only a real `git worktree list` and a real subprocess can prove:
// that "mine" resolves against this actual checkout, and that `--wait --timeout` against
// a genuinely full queue gives up with the exact sentence the bead names, rather than
// hanging the way six sessions' by-hand attempts each eventually did.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-queue');
const gate = await import(path.join(ROOT, 'lib', 'gate.js'));
const gates = await import(path.join(ROOT, 'lib', 'gates.js'));
const queue = await import(path.join(ROOT, 'lib', 'queue.js'));

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

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-b7equeue-'));
// Same reasoning as test/gateslots.mjs's own `room()`: every acquire below is pointed at
// its own scratch directory, so one check's held tickets can never make a later check
// queue behind them.
const room = (name) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

console.log('\nthe queue as it stands\n');

await checkAsync('with three tickets and a limit of two, two are held and one waits, FIFO by startedAt', async () => {
  const base = room('fifo3');
  const first = await gate.acquireSlot({ base, limit: 2, pid: process.pid, pollMs: 5, root: '/wt-a' });
  const second = await gate.acquireSlot({ base, limit: 2, pid: process.pid, pollMs: 5, root: '/wt-b' });
  const thirdPending = gate.acquireSlot({ base, limit: 2, pid: process.pid, pollMs: 5, root: '/wt-c' });
  await new Promise((r) => setTimeout(r, 30)); // let the third ticket actually land

  const rows = queue.queueRows(base, { limit: 2 });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.root), ['/wt-a', '/wt-b', '/wt-c'], 'oldest first');
  assert.equal(rows[0].held, true);
  assert.equal(rows[1].held, true);
  assert.equal(rows[2].held, false);
  assert.equal(rows[2].position, 2);

  const summary = queue.queueSummary(rows, { limit: 2 });
  assert.equal(summary.held, 2);
  assert.equal(summary.waiting, 1);
  assert.equal(summary.total, 3);
  assert.equal(summary.limit, 2);

  first.release();
  second.release();
  (await thirdPending).release();
});

await checkAsync('a ticket whose pid is gone is reaped by liveSlots and is not counted in the position', async () => {
  const base = room('reap-dead');
  const dir = gate.slotDir(base);
  fs.mkdirSync(dir, { recursive: true });
  // A pid this high is not a real process — the shape liveSlots already reaps.
  fs.writeFileSync(path.join(dir, '1-99999999-dead.json'), JSON.stringify({ pid: 999999, startedAt: 1, root: '/dead' }));
  const alive = await gate.acquireSlot({ base, limit: 2, pid: process.pid, pollMs: 5, root: '/alive' });

  const rows = queue.queueRows(base, { limit: 2 });
  assert.equal(rows.length, 1, 'the dead ticket must not be listed');
  assert.equal(rows[0].root, '/alive');
  assert.equal(rows[0].position, 0, 'the dead ticket must not occupy a position ahead of the live one');
  assert.equal(rows[0].held, true);

  alive.release();
});

console.log('\nwhich ticket is mine\n');

await checkAsync('a ticket whose root matches my own worktree is found as mine, a different one is not', async () => {
  const base = room('myrow');
  const other = await gate.acquireSlot({ base, limit: 2, pid: process.pid, pollMs: 5, root: '/somewhere-else' });
  const mine = await gate.acquireSlot({ base, limit: 2, pid: process.pid, pollMs: 5, root: '/repo/.claude/worktrees/mine-a1' });
  const rows = queue.queueRows(base, { limit: 2 });

  const WT_MINE = { path: '/repo/.claude/worktrees/mine-a1', real: '/repo/.claude/worktrees/mine-a1' };
  const found = await queue.myRow(rows, { dir: WT_MINE.path, listWorktreesFn: async () => [WT_MINE] });
  assert.ok(found, 'should find the ticket rooted at my own worktree');
  assert.equal(found.root, WT_MINE.path);

  other.release();
  mine.release();
});

await checkAsync('holding no ticket at all: myRow says so rather than guessing', async () => {
  const base = room('myrow-empty');
  const rows = queue.queueRows(base, { limit: 2 });
  assert.equal(rows.length, 0);
  const WT_MINE = { path: '/repo/.claude/worktrees/mine-a1', real: '/repo/.claude/worktrees/mine-a1' };
  const found = await queue.myRow(rows, { dir: WT_MINE.path, listWorktreesFn: async () => [WT_MINE] });
  assert.equal(found, null);
});

console.log('\ncross-checking against lib/gates.js — the 447m/21m disagreement\n');

await checkAsync('a live ticket with no matching runner in discover() is flagged a mismatch', async () => {
  const rows = [
    { pid: 111, root: '/wt-real', held: true, position: 0 },
    { pid: 222, root: '/wt-stale', held: false, position: 1 },
  ];
  // bc-dgx7.12's exact shape: the ticket's pid is alive (liveSlots already dropped the
  // dead ones), but the process table + lock discover() reads finds no runner for it.
  const fakeDiscover = async () => ({ runners: [{ pid: 111 }] });
  const tagged = await queue.withMismatches(rows, { discoverFn: fakeDiscover });
  assert.equal(tagged[0].mismatch, false);
  assert.equal(tagged[1].mismatch, true);
});

await checkAsync('an empty queue is never sent to discover() at all', async () => {
  let called = false;
  const fakeDiscover = async () => {
    called = true;
    return { runners: [] };
  };
  const tagged = await queue.withMismatches([], { discoverFn: fakeDiscover });
  assert.deepEqual(tagged, []);
  assert.equal(called, false);
});

console.log('\nformatting\n');

check('formatRow names the state, pid, worktree and age; MINE and a mismatch are called out', () => {
  const held = { pid: 1, root: '/wt', ageMs: 65_000, position: 0, held: true };
  assert.match(queue.formatRow(held), /^holding\s+pid 1\s+\/wt\s+started 1m ago$/);
  assert.match(queue.formatRow(held, { mine: true }), /MINE/);

  const waiting = { pid: 2, root: '/wt2', ageMs: 10_000, position: 1, held: false };
  assert.match(queue.formatRow(waiting), /waiting \(2 in line\)/);
  assert.match(queue.formatRow(waiting), /less than a minute ago/);

  const stale = { pid: 3, root: '/wt3', ageMs: 0, position: 0, held: true, mismatch: true };
  assert.match(queue.formatRow(stale), /no matching runner in b7e-gates/);
});

check('headerLine gives the limit and the held/waiting split, or says the queue is empty', () => {
  assert.match(queue.headerLine({ limit: 2, held: 2, waiting: 1, total: 3 }), /2 held \/ 1 waiting, limit 2/);
  assert.match(queue.headerLine({ limit: 2, held: 0, waiting: 0, total: 0 }), /no gates queued/);
});

check('waitEstimateLine only speaks when somebody is actually waiting on a holder', () => {
  const holding = [{ held: true, startedAt: Date.now() - 5 * 60_000 }];
  assert.equal(queue.waitEstimateLine(holding, { waiting: 0 }), null, 'nobody waiting — no estimate');
  assert.equal(queue.waitEstimateLine([], { waiting: 1 }), null, 'nobody holding — nothing to estimate from');
  assert.match(queue.waitEstimateLine(holding, { waiting: 1 }), /oldest holder started/);
});

check('the timeout sentence is the one bc-dgx7.12 and bc-dgx7.17 each wrote by hand', () => {
  assert.equal(queue.TIMEOUT_LINE, 'you will not get a turn today, deliver on the affected suites');
});

console.log('\nwaiting for my own ticket\n');

const worktreesHere = await gates.listWorktrees(ROOT);
const mineWt = gates.worktreeFor(ROOT, worktreesHere);

await checkAsync('--wait resolves the moment my ticket holds a slot, not before', async () => {
  const base = room('wait-success');
  const holder = await gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5, root: '/someone-elses-tree' });
  const minePending = gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5, root: mineWt.real });
  await new Promise((r) => setTimeout(r, 30));

  const waited = queue.waitForMine({ base, limit: 1, dir: ROOT, pollMs: 10, timeoutMs: 10_000 });
  const early = await Promise.race([waited, new Promise((r) => setTimeout(() => r('still waiting'), 100))]);
  assert.equal(early, 'still waiting', 'must not resolve while the other worktree still holds the slot');

  holder.release();
  const got = await waited;
  assert.ok(got, 'should resolve once the slot freed');
  assert.equal(got.root, mineWt.real);

  (await minePending).release();
});

await checkAsync('--wait --timeout gives up on the deadline rather than hanging, and says so honestly', async () => {
  const base = room('wait-timeout');
  const holder = await gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5, root: '/someone-elses-tree' });
  const minePending = gate.acquireSlot({ base, limit: 1, pid: process.pid, pollMs: 5, root: mineWt.real });
  await new Promise((r) => setTimeout(r, 30));

  const started = Date.now();
  const got = await queue.waitForMine({ base, limit: 1, dir: ROOT, pollMs: 20, timeoutMs: 150 });
  assert.equal(got, null, 'a full queue must give up, not resolve to something');
  assert.ok(Date.now() - started < 3000, 'must actually give up rather than hang past its own deadline');

  holder.release();
  (await minePending).release();
});

console.log('\nCLI\n');

check('--help exits 0 and names --wait without starting anything', () => {
  const run = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--wait/);
});

check('a nonsense --timeout is refused rather than silently ignored', () => {
  const run = spawnSync(process.execPath, [BIN, '--wait', '--timeout', 'soon'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
});

check('--mine against this worktree, which holds no real ticket, says so and exits 0', () => {
  const run = spawnSync(process.execPath, [BIN, '--mine', '--dir', ROOT], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /not queued/);
});

check('a real run against this Mac prints valid JSON and exits 0, never throws', () => {
  const run = spawnSync(process.execPath, [BIN, '--dir', ROOT, '--json'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split('\n').filter(Boolean);
  for (const line of lines) JSON.parse(line); // throws on malformed output
  const summary = JSON.parse(lines[lines.length - 1]);
  assert.equal(summary.summary, true);
});

check('--wait --timeout against a genuinely full queue exits 3 with the exact sentence, not a hang', () => {
  const scratchTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-b7equeue-cli-'));
  const holderA = { root: '/cli-holder-a' };
  const holderB = { root: '/cli-holder-b' };
  const base = scratchTmp;
  const dir = gate.slotDir(base);
  fs.mkdirSync(dir, { recursive: true });
  // Written directly rather than through acquireSlot, so this check needs no `await` of
  // its own concurrent holders and cannot race the CLI subprocess it is about to spawn.
  const ticket = (i, root) => {
    const startedAt = i * 1000;
    fs.writeFileSync(path.join(dir, `${startedAt}-${process.pid}-${i}.json`), JSON.stringify({ pid: process.pid, startedAt, root }));
  };
  ticket(1, holderA.root);
  ticket(2, holderB.root);
  ticket(3, mineWt.real);

  const run = spawnSync(process.execPath, [BIN, '--wait', '--timeout', '1', '--dir', ROOT], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, TMPDIR: scratchTmp, CI: '', BEADCAUSE_GATE_SLOTS: '2' },
  });
  assert.equal(run.status, 3, `expected exit 3, got ${run.status}: ${run.stderr}`);
  assert.match(run.stderr, /you will not get a turn today, deliver on the affected suites/);

  removeTreeSync(scratchTmp);
});

removeTreeSync(tmp);

console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m\n` : '\n\x1b[32mb7e-queue holds\x1b[0m\n');
process.exit(failures ? 1 : 0);
