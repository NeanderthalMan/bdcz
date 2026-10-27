#!/usr/bin/env node
/**
 * A bead whose whole fix was already true: the worker's marker, and the advocate's close.
 *
 *     npm test
 *     node test/verifieddone.mjs
 *
 * bc-xl7n.193. `bd close` from a worker window is refused by the permission classifier, so
 * the worker records evidence and the advocate closes. Pinned here: `mark` writes nothing
 * without evidence, comment goes before label, an epic is refused; and `sweepVerifiedDone`
 * closes only a marked bead whose thread carries the evidence comment, never an epic, and
 * leaves a bead bd would not close (open blocker) open with the reason.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { VERIFIED_LABEL, VERIFIED_PREFIX, isVerifiedDone, mark, sweepVerifiedDone, describeVerifiedDone } = await import(
  path.join(HERE, '..', 'lib', 'verifieddone.js')
);

let n = 0;
const check = async (name, fn) => {
  await fn();
  n += 1;
  console.log(`ok ${n} - ${name}`);
};

const recorder = (failOn = null) => {
  const calls = [];
  const bd = (argv) => {
    calls.push(argv);
    if (failOn && argv.slice(0, 2).join(' ') === failOn) throw new Error('boom');
    return '';
  };
  return { bd, calls };
};

await check('mark refuses with no evidence and writes nothing', () => {
  const { bd, calls } = recorder();
  const r = mark(bd, 'x-1', '   ', { row: { status: 'open' } });
  assert.match(r.refused, /evidence/);
  assert.equal(calls.length, 0);
});

await check('mark refuses an epic and a closed bead', () => {
  const { bd, calls } = recorder();
  assert.match(mark(bd, 'x-1', 'ran it', { row: { status: 'open', issue_type: 'epic' } }).refused, /epic/);
  assert.match(mark(bd, 'x-1', 'ran it', { row: { status: 'closed' } }).refused, /already closed/);
  assert.equal(calls.length, 0);
});

await check('mark writes the comment before the label, and reopens an in_progress bead', () => {
  const { bd, calls } = recorder();
  const r = mark(bd, 'x-1', 'gh pr list prints main', { row: { status: 'in_progress' } });
  assert.equal(r.marked, true);
  assert.equal(r.reopened, true);
  assert.deepEqual(calls[0], ['comment', 'x-1', `${VERIFIED_PREFIX} gh pr list prints main`]);
  assert.deepEqual(calls[1], ['label', 'add', 'x-1', VERIFIED_LABEL]);
});

await check('a failed comment leaves no label behind', () => {
  const { bd, calls } = recorder('comment x-1');
  const r = mark(bd, 'x-1', 'ran it', { row: { status: 'open' } });
  assert.match(r.refused, /Nothing else was written/);
  assert.equal(calls.some((c) => c[0] === 'label'), false);
});

await check('re-running on a marked bead writes nothing', () => {
  const { bd, calls } = recorder();
  const r = mark(bd, 'x-1', 'ran it', { row: { status: 'open', labels: [VERIFIED_LABEL] } });
  assert.equal(r.alreadyMarked, true);
  assert.equal(calls.length, 0);
});

const sweepWorld = () => {
  const closed = [];
  const rows = [
    { id: 'x-ok', title: 'fixed already', labels: [VERIFIED_LABEL], status: 'open' },
    { id: 'x-bare', title: 'label only', labels: [VERIFIED_LABEL], status: 'open' },
    { id: 'x-epic', title: 'an epic', labels: [VERIFIED_LABEL], status: 'open', issue_type: 'epic' },
    { id: 'x-blocked', title: 'has a blocker', labels: [VERIFIED_LABEL], status: 'open' },
  ];
  const threads = {
    'x-ok': [{ text: 'unrelated' }, { text: `${VERIFIED_PREFIX} pr.basePerWorkspace is set\nsecond line` }],
    'x-bare': [{ text: 'someone added the label by hand' }],
    'x-epic': [{ text: `${VERIFIED_PREFIX} done` }],
    'x-blocked': [{ text: `${VERIFIED_PREFIX} done` }],
  };
  const bd = {
    listVerifiedDone: async () => rows,
    comments: async (_ws, id) => threads[id],
    close: async (_ws, id, reason, opts) => {
      if (id === 'x-blocked') throw new Error('cannot close x-blocked: blocked by open issues');
      closed.push({ id, reason, opts });
    },
  };
  return { bd, closed };
};

await check('the sweep closes only the marked bead that carries evidence', async () => {
  const { bd, closed } = sweepWorld();
  const r = await sweepVerifiedDone(bd, { name: 'demo' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.closed.map((c) => c.id), ['x-ok']);
  assert.deepEqual(closed.map((c) => c.id), ['x-ok']);
  assert.match(closed[0].reason, /pr\.basePerWorkspace is set/);
  assert.doesNotMatch(closed[0].reason, /second line/);
  assert.equal(closed[0].opts.overClaim, true);
});

await check('the sweep leaves a bare label, an epic and a refused close open, saying why', async () => {
  const { bd } = sweepWorld();
  const r = await sweepVerifiedDone(bd, { name: 'demo' });
  const why = Object.fromEntries(r.skipped.map((s) => [s.id, s.why]));
  assert.match(why['x-bare'], /label alone closes nothing/);
  assert.match(why['x-epic'], /epic/);
  assert.match(why['x-blocked'], /would not close/);
});

await check('an unreadable queue is reported, not thrown', async () => {
  const r = await sweepVerifiedDone({ listVerifiedDone: async () => { throw new Error('dolt down'); } }, {});
  assert.equal(r.ok, false);
  assert.match(describeVerifiedDone(r), /dolt down/);
});

await check('isVerifiedDone reads the label off a row', () => {
  assert.equal(isVerifiedDone({ labels: ['a', VERIFIED_LABEL] }), true);
  assert.equal(isVerifiedDone({ labels: ['a'] }), false);
  assert.equal(isVerifiedDone(null), false);
});

console.log(`verifieddone: ${n} checks passed`);
