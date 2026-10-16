/**
 * The merge-queue workflow, driven with scripted facts on Temporal's time-skipping test
 * server — bc-x0mhc. Nothing here reads the live tracker or GitHub.
 *
 *   node spikes/temporal-mq/test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { makeActivities } from './activities.mjs';
import { signalsFor } from './shadow.mjs';

const workflowsPath = fileURLToPath(new URL('./workflows.mjs', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mq-shadow-'));

const LIVE = { status: 'open', queued: true, carded: false, attempts: 0 };
const base = (over = {}) => ({
  spec: { number: 7, base: 'main', bead: 'bc-w' },
  head: 'aaa',
  held: false,
  review: null,
  conflicted: false,
  behind: false,
  verdict: { merge: false, pending: false, stale: false, awaitingApproval: false, refused: '' },
  live: LIVE,
  ...over,
});
const pending = () => base({ verdict: { ...base().verdict, pending: true, refused: 'still running' } });
const green = () => base({ verdict: { ...base().verdict, merge: true } });
const red = () => base({ verdict: { ...base().verdict, refused: 'test broke' } });
const needsReview = () => base({ review: { act: 'review', why: 'nothing has reviewed it', round: 0 } });

let n = 0;
/** One scenario: a fresh ledger, a worker, and a mutable `facts` the fake observe returns. */
async function scenario(env, name, body, { failFirst = [] } = {}) {
  const ledger = path.join(tmp, `${name}.jsonl`);
  const box = { facts: pending(), observed: 0 };
  const activities = makeActivities({
    ledger,
    failFirst: new Set(failFirst),
    observe: async () => {
      box.observed++;
      return typeof box.facts === 'function' ? box.facts() : box.facts;
    },
  });
  const taskQueue = `tq-${name}-${++n}`;
  const mk = (opts = {}) => Worker.create({ connection: env.nativeConnection, workflowsPath, activities, taskQueue, ...opts });
  const lines = () =>
    fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const would = (kind) => lines().filter((l) => l.would === kind);
  await body({ env, box, mk, taskQueue, would, lines });
  console.log(`ok  ${name}`);
}

const start = (env, taskQueue, id, extra = {}) =>
  env.client.workflow.start('prJourney', { workflowId: id, taskQueue, args: [{ beadId: 'bc-m', ...extra }] });

/** Advance test time until the workflow's phase matches, or fail. */
async function until(env, handle, pred, what) {
  for (let i = 0; i < 60; i++) {
    const s = await handle.query('status');
    if (pred(s)) return s;
    await env.sleep('1 minute');
  }
  assert.fail(`never reached: ${what}`);
}

// The driver's diff is pure, so pin it without a server.
{
  const was = { status: 'open', queued: false, carded: true, approved: false, verdict: 'refused', round: 2 };
  assert.deepEqual(signalsFor(null, was), [{ name: 'start' }]);
  assert.deepEqual(signalsFor(was, was), []);
  assert.deepEqual(
    signalsFor(was, { ...was, carded: false, queued: true }).map((s) => s.name),
    ['humanAnswer', 'poke']
  );
  assert.equal(signalsFor(was, { ...was, status: 'closed', closeReason: 'merged #7' })[0].name, 'liveOutcome');
  assert.deepEqual(
    signalsFor({ ...was, carded: false }, { ...was, carded: false, verdict: 'approved', round: 3 }).map((s) => s.name),
    ['reviewVerdict', 'poke']
  );
  console.log('ok  driver diff');
}

const env = await TestWorkflowEnvironment.createTimeSkipping();
try {
  await scenario(env, 'pending-then-green', async ({ env, box, mk, taskQueue, would }) => {
    const worker = await mk();
    await worker.runUntil(async () => {
      const h = await start(env, taskQueue, 'wf-green');
      await until(env, h, (s) => s.phase === 'checks-running', 'checks-running');
      box.facts = green();
      await until(env, h, (s) => s.merged, 'merged');
      await h.signal('liveOutcome', { how: 'bead-closed', reason: 'merged #7' });
      const out = await h.result();
      assert.equal(out.phase, 'ended');
    });
    assert.equal(would('merge').length, 1);
    assert.equal(would('close-beads').length, 1);
    assert.match(would('agreement')[0].why, /having merged/);
  });

  await scenario(env, 'review-waits-on-a-signal', async ({ env, box, mk, taskQueue, would }) => {
    box.facts = needsReview();
    const worker = await mk();
    await worker.runUntil(async () => {
      const h = await start(env, taskQueue, 'wf-review');
      await until(env, h, (s) => s.phase === 'awaiting-review', 'awaiting-review');
      const before = box.observed;
      // Two hours of nothing: the backstop fires four times and re-reads, but the
      // reviewer's window is asked for once, not once per look.
      await env.sleep('2 hours');
      assert.ok(box.observed - before <= 5, `polled ${box.observed - before} times in 2h`);
      assert.equal(would('open-reviewer').length, 1);
      box.facts = green();
      await h.signal('reviewVerdict', { verdict: 'approved', round: 1 });
      await until(env, h, (s) => s.merged, 'merged after the verdict');
      await h.signal('liveOutcome', { how: 'bead-closed' });
      await h.result();
    });
  });

  await scenario(env, 'three-refusals-card-then-adam-merges', async ({ env, box, mk, taskQueue, would }) => {
    box.facts = red();
    const worker = await mk();
    await worker.runUntil(async () => {
      const h = await start(env, taskQueue, 'wf-card');
      const s = await until(env, h, (s) => s.phase === 'carded', 'carded');
      assert.equal(s.attempts, 3);
      // A card sleeps without a timer: days pass and nothing is re-read.
      const before = box.observed;
      await env.sleep('3 days');
      assert.equal(box.observed, before);
      assert.equal(would('raise-card').length, 1);
      await h.signal('humanAnswer', { answer: 'merge' });
      await until(env, h, (s) => s.merged, 'merged from the card');
      await h.signal('liveOutcome', { how: 'bead-closed' });
      await h.result();
    });
    assert.equal(would('merge').length, 1);
    assert.match(would('merge')[0].why, /Adam answered Merge/);
  });

  await scenario(
    env,
    'a-retried-effect-happens-once',
    async ({ env, box, mk, taskQueue, would, lines }) => {
      box.facts = green();
      const worker = await mk();
      await worker.runUntil(async () => {
        const h = await start(env, taskQueue, 'wf-retry');
        await until(env, h, (s) => s.merged, 'merged');
        await h.signal('liveOutcome', { how: 'bead-closed' });
        await h.result();
      });
      // The first attempt recorded the merge and then "lost" its result; the retry saw the
      // key and did not merge a second time.
      assert.equal(would('merge').length, 1);
      assert.equal(would('merge')[0].attempt, 1);
      assert.ok(lines().length >= 3);
    },
    { failFirst: ['merge'] }
  );

  await scenario(env, 'survives-its-worker-dying-mid-wait', async ({ env, box, mk, taskQueue, would }) => {
    box.facts = needsReview();
    let h;
    const first = await mk({ maxCachedWorkflows: 0 });
    await first.runUntil(async () => {
      h = await start(env, taskQueue, 'wf-restart');
      await until(env, h, (s) => s.phase === 'awaiting-review', 'awaiting-review');
    });
    // No worker at all now. The workflow is a row in the server, not a process.
    await env.sleep('20 minutes');
    const second = await mk({ maxCachedWorkflows: 0 });
    await second.runUntil(async () => {
      box.facts = green();
      await h.signal('reviewVerdict', { verdict: 'approved' });
      await until(env, h, (s) => s.merged, 'merged on the second worker');
      await h.signal('liveOutcome', { how: 'bead-closed' });
      await h.result();
    });
    assert.equal(would('open-reviewer').length, 1, 'the replay did not re-open the reviewer');
  });

  await scenario(env, 'adopts-a-card-the-live-queue-already-raised', async ({ env, box, mk, taskQueue, would }) => {
    box.facts = base({ live: { ...LIVE, queued: false, carded: true, attempts: 3, refused: 'test broke' }, verdict: red().verdict });
    const worker = await mk();
    await worker.runUntil(async () => {
      const h = await start(env, taskQueue, 'wf-adopt');
      const s = await until(env, h, (s) => s.phase === 'carded', 'carded on adoption');
      assert.equal(s.attempts, 3);
      assert.match(s.why, /before the shadow started: test broke/);
      await h.signal('liveOutcome', { how: 'bead-closed' });
      await h.result();
    });
    assert.equal(would('raise-card').length, 1);
  });

  await scenario(env, 'continue-as-new-keeps-the-count', async ({ env, box, mk, taskQueue }) => {
    box.facts = red();
    const worker = await mk();
    await worker.runUntil(async () => {
      const h = await start(env, taskQueue, 'wf-can', { historyLimit: 30 });
      const s = await until(env, h, (s) => s.phase === 'carded', 'carded across runs');
      assert.equal(s.attempts, 3);
      assert.ok(s.runs > 1, `expected a continue-as-new, runs=${s.runs}`);
      await h.signal('liveOutcome', { how: 'bead-closed' });
      await h.result();
    });
  });
} finally {
  await env.teardown();
}
console.log('all green');
