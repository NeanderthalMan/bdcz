#!/usr/bin/env node
/**
 * **One workspace's merge queue never waits on another's** — bc-7vvgj.
 *
 *     npm test
 *     node test/mqclock.mjs
 *
 * lib/mqclock.js is the scheduler that replaced the serial loop over every workspace. On
 * 2026-11-07 that loop, sitting behind a sixteen-minute advocate tick and a tracker that
 * hung for two minutes, kept delmar's P0 #1308 unlooked-at for 48 minutes after it was
 * approved. These checks drive the clock with a fake pass and a fake time, and the first
 * one is the bead's acceptance case: a hung workspace, and a queued pull request in
 * another one that is merged on the very next beat anyway.
 */
import assert from 'node:assert/strict';
import { createMergeQueueClock } from '../lib/mqclock.js';

let failures = 0;
let ran = 0;
const check = async (name, fn) => {
  ran += 1;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    for (const line of String(err.message).split('\n')) console.log(`      ${line}`);
  }
};

const ws = (...names) => names.map((name) => ({ name }));
const never = () => new Promise(() => {});
const settle = (started) => Promise.all(started);
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A fake clock plus a log the clock writes into. */
const rig = (opts) => {
  let t = 1_000_000;
  const lines = [];
  const clock = createMergeQueueClock({ now: () => t, log: (l) => lines.push(l), ...opts });
  return { clock, lines, advance: (ms) => (t += ms), at: () => t };
};

await check('a hung workspace delays nobody else: the queued PR elsewhere merges on the first beat', async () => {
  const merged = [];
  const { clock } = rig({
    workspaces: () => ws('architecture', 'delmar'),
    run: (w) => (w.name === 'architecture' ? never() : Promise.resolve({ merged: ['dv-mlvyu'], updated: [] })),
    onMerged: (w, out) => merged.push(`${w.name}/${out.merged[0]}`),
  });
  const started = clock.beat();
  assert.equal(started.length, 2, 'both workspaces start on the same beat');
  // Not `settle(started)`: one of the two never ends, and that is the point.
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(merged, ['delmar/dv-mlvyu']);
  assert.deepEqual(clock.running(), ['architecture'], 'architecture is still in flight, alone');
});

await check('a workspace still in flight is not started twice', async () => {
  let calls = 0;
  const { clock, advance } = rig({ workspaces: () => ws('a'), everyMs: 1000, run: () => ((calls += 1), never()) });
  clock.beat();
  await flush();
  advance(5000);
  clock.beat();
  await flush();
  advance(5000);
  clock.beat();
  await flush();
  assert.equal(calls, 1);
});

await check('a quiet pass waits the full interval; a pass that merged goes again on the next beat', async () => {
  const runs = { quiet: 0, busy: 0 };
  const { clock, advance } = rig({
    workspaces: () => ws('quiet', 'busy'),
    everyMs: 30_000,
    run: (w) => {
      runs[w.name] += 1;
      return Promise.resolve(w.name === 'busy' && runs.busy === 1 ? { merged: ['x'], updated: [] } : { merged: [], updated: [] });
    },
  });
  await settle(clock.beat());
  advance(5000);
  await settle(clock.beat());
  assert.deepEqual(runs, { quiet: 1, busy: 2 }, 'busy went again 5s later; quiet did not');
  advance(5000);
  await settle(clock.beat());
  assert.deepEqual(runs, { quiet: 1, busy: 2 }, 'and busy, quiet now, waits like everybody else');
  advance(30_000);
  await settle(clock.beat());
  assert.deepEqual(runs, { quiet: 2, busy: 3 });
});

await check('a downmerge counts as moving, so the branch it freshened is looked at again at once', async () => {
  let n = 0;
  const { clock, advance } = rig({
    workspaces: () => ws('a'),
    run: () => Promise.resolve((n += 1) === 1 ? { merged: [], updated: ['a-1'] } : { merged: [], updated: [] }),
  });
  await settle(clock.beat());
  advance(1);
  await settle(clock.beat());
  assert.equal(n, 2);
});

await check('never more than `cap` passes at once, and the rest are taken on later beats', async () => {
  const resolvers = [];
  const { clock } = rig({
    workspaces: () => ws('a', 'b', 'c', 'd', 'e', 'f'),
    cap: 2,
    run: () => new Promise((r) => resolvers.push(r)),
  });
  clock.beat();
  await flush();
  assert.equal(clock.running().length, 2);
  clock.beat();
  await flush();
  assert.equal(clock.running().length, 2, 'a full cap starts nothing');
  resolvers.shift()({ merged: [], updated: [] });
  await flush();
  clock.beat();
  await flush();
  assert.equal(clock.running().length, 2, 'a freed slot is taken by a workspace still due');
  assert.equal(resolvers.length, 2);
});

await check('the log names a slow pass with its timing, and a hung one once a minute', async () => {
  let release;
  const { clock, lines, advance } = rig({
    workspaces: () => ws('architecture'),
    run: () => new Promise((r) => (release = r)),
  });
  const started = clock.beat();
  await flush();
  advance(61_000);
  clock.beat();
  assert.ok(lines.some((l) => /architecture: pass still running after 61s/.test(l)), lines.join('\n'));
  advance(10_000);
  clock.beat();
  assert.equal(lines.filter((l) => /still running/.test(l)).length, 1, 'not every beat');
  release({ merged: [], updated: [] });
  await settle(started);
  assert.ok(lines.some((l) => /architecture: pass took 71\.0s/.test(l)), lines.join('\n'));
});

await check('a quick quiet pass says nothing', async () => {
  const { clock, lines } = rig({ workspaces: () => ws('a'), run: () => Promise.resolve({ merged: [], updated: [] }) });
  await settle(clock.beat());
  assert.deepEqual(lines, []);
});

await check('a pass that throws is reported, frees its slot, and is due again on the interval', async () => {
  const errors = [];
  let n = 0;
  const { clock, lines, advance } = rig({
    workspaces: () => ws('a'),
    everyMs: 30_000,
    run: () => ((n += 1), Promise.reject(new Error('bd list hung\nmore'))),
    onError: (w, err) => errors.push(`${w.name}: ${err.message.split('\n')[0]}`),
  });
  await settle(clock.beat());
  assert.deepEqual(errors, ['a: bd list hung']);
  assert.ok(lines.some((l) => l === '[merge-queue] a: pass failed — bd list hung'));
  assert.deepEqual(clock.running(), []);
  advance(5000);
  await settle(clock.beat());
  assert.equal(n, 1, 'a failure is not a reason to hammer');
  advance(30_000);
  await settle(clock.beat());
  assert.equal(n, 2);
});

await check('workspaces are read on every beat, so one added to config is picked up', async () => {
  const list = ws('a');
  const seen = [];
  const { clock } = rig({ workspaces: () => list, run: (w) => (seen.push(w.name), Promise.resolve({})) });
  await settle(clock.beat());
  list.push({ name: 'b' });
  await settle(clock.beat());
  assert.deepEqual(seen, ['a', 'b']);
});

console.log(`\n${ran - failures}/${ran} checks passed`);
if (failures) process.exit(1);
