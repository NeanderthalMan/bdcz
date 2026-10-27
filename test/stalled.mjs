#!/usr/bin/env node
/**
 * A workspace that opens no session while carrying open work — bc-dhayi.
 *
 *     npm test
 *     node test/stalled.mjs
 *
 * lib/stalled.js is a clock and four answers, and three of the four are *doing nothing*.
 * Doing nothing is what a refactor deletes without noticing, and every one of those three
 * is load-bearing here:
 *
 * 1. **An empty queue is never a stall.** The acceptance criterion written as a predicate,
 *    and the overwhelmingly common shape of a quiet tracker — a detector that got this
 *    wrong would file a P0 against every idle workspace on the machine at once.
 * 2. **Silence somebody asked for is not a stall.** Quiet hours on this install are longer
 *    than the window, so a clock that counted them would file a bead every morning; that
 *    is the false alarm that gets a detector switched off rather than fixed.
 * 3. **Unknown decides nothing.** Read as "there is no bead about this" it files a second
 *    P0 on top of the first over a tracker that would not answer for one tick.
 *
 * And the one that does write: **one bead per workspace, found by its own title.** There
 * is no record on disk on purpose (lib/stalled.js's header), so the title *is* the key.
 * A title carrying the queue length or the hours would be a different string every tick
 * and therefore a fresh P0 every tick — which is why `stallTitle` is asserted to hold
 * still while everything around it moves.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (f) => path.join(HERE, '..', 'lib', f);

const {
  DEFAULT_STALL_HOURS,
  STALL_LABEL,
  STALL_PRIORITY,
  clearReason,
  describeSilence,
  findStall,
  isStallBead,
  stallAcceptance,
  stallBody,
  stallIssue,
  stallTitle,
  stallVerdict,
  stuckReason,
  sweepStall,
} = await import(LIB('stalled.js'));

const { QUEUE_EXCLUDED } = await import(LIB('endorse.js'));

let failures = 0;
let ran = 0;
const check = (name, fn) => {
  ran += 1;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`);
  }
};

/** The async twin, for `sweepStall` — the same reporting, one await deep. */
const acheck = async (name, fn) => {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`);
  }
};

console.log('\na workspace that opens no session\n');

const HOURS = 3600;
const WINDOW = DEFAULT_STALL_HOURS * HOURS;
const WS = 'beadcause';

const stallRow = (over = {}) => ({
  id: 'zz-stall',
  title: stallTitle(WS),
  status: 'open',
  labels: [STALL_LABEL, 'human', 'card'],
  ...over,
});

/** A workspace that has been free to launch, with work waiting, for a day. */
const STALLED = {
  workspace: WS,
  queue: 4,
  silentSeconds: 24 * HOURS,
  windowSeconds: WINDOW,
  dispatching: true,
};

/* ----------------------------------------------------------------- the verdict */

check('silent past the window with work waiting, and nothing open, files the bead', () => {
  const v = stallVerdict({ ...STALLED, open: null });
  assert.equal(v.act, 'file');
  assert.equal(v.stalled, true);
});

check('and with the bead already open it writes nothing at all', () => {
  // The steady state, and it has to be silent: a tick every thirty seconds that
  // commented or amended would turn a bad fortnight into an unreadable bead.
  const v = stallVerdict({ ...STALLED, open: stallRow() });
  assert.equal(v.act, 'hold');
  assert.equal(v.stalled, true);
});

check('an empty queue is never a stall, however long the silence', () => {
  // The acceptance criterion: no bead is filed for a workspace that is merely empty.
  const v = stallVerdict({ ...STALLED, queue: 0, silentSeconds: 400 * HOURS, open: null });
  assert.equal(v.act, 'none');
  assert.equal(v.stalled, false);
});

check('and an empty queue closes a bead that was already open', () => {
  const v = stallVerdict({ ...STALLED, queue: 0, open: stallRow() });
  assert.equal(v.act, 'clear');
  assert.equal(v.why, 'empty');
});

check('silence somebody asked for does not count — this is the morning false alarm', () => {
  // Quiet hours on this install are longer than the window. A detector that counted
  // them files a P0 against a healthy workspace every single morning.
  const v = stallVerdict({ ...STALLED, dispatching: false, open: null });
  assert.equal(v.act, 'none');
  assert.equal(v.stalled, false);
});

check('and a paused advocate closes the bead, saying which ending it was', () => {
  const v = stallVerdict({ ...STALLED, dispatching: false, open: stallRow() });
  assert.equal(v.act, 'clear');
  assert.equal(v.why, 'held');
  assert.match(clearReason(WS, v.why), /paused, in quiet hours/);
});

check('a session opening is what closes it — the criterion, in one line', () => {
  const v = stallVerdict({ ...STALLED, silentSeconds: 30, open: stallRow() });
  assert.equal(v.act, 'clear');
  assert.equal(v.why, 'launched');
  assert.match(clearReason(WS, v.why), /opened a session again/);
});

check('silence just short of the window is not yet a stall', () => {
  assert.equal(stallVerdict({ ...STALLED, silentSeconds: WINDOW - 1, open: null }).act, 'none');
  assert.equal(stallVerdict({ ...STALLED, silentSeconds: WINDOW, open: null }).act, 'file');
});

check('a window of zero is off, not "everything is stalled"', () => {
  // The reading a person expects from setting `stallHours` to nought is silence — and an
  // open bead about a measurement nobody is taking any more is a bead that goes stale.
  assert.equal(stallVerdict({ ...STALLED, windowSeconds: 0, open: null }).act, 'none');
  const v = stallVerdict({ ...STALLED, windowSeconds: 0, open: stallRow() });
  assert.equal(v.act, 'clear');
  assert.match(clearReason(WS, v.why), /switched off/);
});

check('a tracker that could not be read decides nothing in either direction', () => {
  assert.equal(stallVerdict({ ...STALLED, known: false, open: null }).act, 'unknown');
  assert.equal(stallVerdict({ ...STALLED, known: false, open: stallRow() }).act, 'unknown');
});

/* ------------------------------------------------------------------- the bead */

check('the title carries no number, so it is the same string on every tick', () => {
  // The whole dedupe. A title naming the queue length or the hours would be a different
  // string every tick and therefore a fresh P0 every tick.
  const a = stallIssue({ ...STALLED }).title;
  const b = stallIssue({ ...STALLED, queue: 91, silentSeconds: 900 * HOURS }).title;
  assert.equal(a, b);
  assert.equal(a, stallTitle(WS));
  assert.doesNotMatch(a, /\d/);
});

check('it is a P0, and it is held out of every queue', () => {
  const issue = stallIssue(STALLED);
  assert.equal(issue.priority, STALL_PRIORITY);
  assert.equal(issue.priority, 0);
  // Three separate reasons in lib/stalled.js's header, and the quietest is the one this
  // pins: a queueable bead is a bead *in the queue*, so `queue > 0` would be true for
  // ever and the stall could never clear on its own.
  assert.ok(
    issue.labels.some((l) => QUEUE_EXCLUDED.includes(l)),
    'a stall bead that could be dispatched is a stall that can never end'
  );
  assert.ok(issue.labels.includes(STALL_LABEL));
  assert.ok(issue.labels.includes('card'));
});

check('the body names the advocate, the queue length and the retired ids', () => {
  // The three things the bead is specified to carry, and the third is the one the tick
  // note buried: a bead at `maxAttemptsPerBead` is out of the queue for good.
  const body = stallBody({
    ...STALLED,
    working: 0,
    at: '2026-09-20T12:00:00.000Z',
    retired: [{ id: 'bc-aaa' }, { id: 'bc-bbb' }, { id: 'bc-ccc' }],
  });
  assert.match(body, /beadcause/);
  assert.match(body, /\*\*4\*\* beads/);
  assert.match(body, /bc-aaa, bc-bbb, bc-ccc/);
  assert.match(body, /maxAttemptsPerBead/);
  assert.match(body, /2026-09-20T12:00:00\.000Z/);
});

check('and it says so when nothing is retired, rather than leaving a blank', () => {
  // A body with an empty list where the cause should be reads as a template that failed.
  const body = stallBody({ ...STALLED, retired: [], working: 2 });
  assert.match(body, /Nothing in the queue has been given up on/);
  assert.match(body, /2 of them/);
});

check('a long retired list is capped with a remainder, so it reads on a phone', () => {
  const retired = Array.from({ length: 9 }, (_, i) => ({ id: `bc-${i}` }));
  const body = stallBody({ ...STALLED, retired });
  assert.match(body, /and 3 more/);
  assert.doesNotMatch(body, /bc-7/);
});

check('the acceptance is about the dispatcher, never about a diff', () => {
  const text = stallAcceptance(WS);
  assert.match(text, /opens a session again/);
  assert.match(text, /nothing here is finished by a commit/);
});

check('a refused close is said on the bead, not only in a log nobody tails', () => {
  const text = stuckReason(WS, 'launched', '', new Error('blocked by open issues\nsecond line'));
  assert.match(text, /blocked by open issues/);
  assert.doesNotMatch(text, /second line/);
  assert.match(text, /still open/);
});

check('a duration reads as a person would say it', () => {
  assert.equal(describeSilence(6 * HOURS), '6 hours');
  assert.equal(describeSilence(27 * 24 * HOURS), '27 days');
  // Never below an hour: a bead saying "5 hours" over a 6-hour window reads as a
  // detector that fired early, and one saying "0 hours" reads as broken.
  assert.equal(describeSilence(90), '1 hour');
  assert.equal(describeSilence(0), '1 hour');
});

/* ------------------------------------------------------------------- the search */

check('the bead is found by label and exact title together', () => {
  assert.equal(findStall([stallRow()], { workspace: WS })?.id, 'zz-stall');
  assert.equal(isStallBead(stallRow()), true);
});

check('a closed one is not found, so a stall that comes back files a fresh bead', () => {
  assert.equal(findStall([stallRow({ status: 'closed' })], { workspace: WS }), null);
});

check('and another workspace\'s bead is not this workspace\'s', () => {
  assert.equal(findStall([stallRow({ title: stallTitle('sorrel') })], { workspace: WS }), null);
});

check('a retitled bead is no longer matched — which is why the body says not to', () => {
  const row = stallRow({ title: 'the beadcause advocate is stuck' });
  assert.equal(findStall([row], { workspace: WS }), null);
  // Still visible as one of these, though, which is the half a retitle cannot take off.
  assert.equal(isStallBead(row), true);
  assert.match(stallBody(STALLED), /Do not retitle it/);
});

check('a Map of rows works, because that is what the tick index actually is', () => {
  const rows = new Map([['zz-stall', stallRow()]]);
  assert.equal(findStall(rows, { workspace: WS })?.id, 'zz-stall');
});

/* -------------------------------------------------------------------- the sweep */

function world({ rows = [], createThrows = null, closeThrows = null } = {}) {
  const did = { filed: [], closed: [], commented: [], announced: [], log: [], settled: 0 };
  return {
    did,
    deps: {
      rows: async () => rows,
      file: async (issue) => {
        if (createThrows) throw createThrows;
        did.filed.push(issue);
        return 'zz-new';
      },
      close: async (id, reason) => {
        if (closeThrows) throw closeThrows;
        did.closed.push({ id, reason });
      },
      comment: async (id, text) => did.commented.push({ id, text }),
      settle: async () => {
        did.settled += 1;
      },
      announce: (id, act) => did.announced.push({ id, act }),
      log: (text) => did.log.push(text),
    },
  };
}

await acheck('a stalled workspace with nothing open files exactly one P0', async () => {
  const w = world();
  const out = await sweepStall({ ...STALLED, retired: [{ id: 'bc-aaa' }] }, w.deps);
  assert.equal(out.act, 'file');
  assert.equal(out.id, 'zz-new');
  assert.equal(w.did.filed.length, 1);
  assert.equal(w.did.filed[0].title, stallTitle(WS));
  // Without the settle the P0 filed thirty seconds ago is invisible to the next tick —
  // the index is cached for a minute — and a second one lands on top of it.
  assert.equal(w.did.settled, 1);
  assert.deepEqual(w.did.announced, [{ id: 'zz-new', act: 'file' }]);
});

await acheck('and the next tick, with it open, writes nothing and wakes nobody', async () => {
  const w = world({ rows: [stallRow()] });
  const out = await sweepStall(STALLED, w.deps);
  assert.equal(out.act, 'hold');
  assert.deepEqual(w.did.filed, []);
  assert.deepEqual(w.did.closed, []);
  assert.deepEqual(w.did.announced, [], 'a stall that has lasted a week must not wake a phone every tick');
  assert.deepEqual(w.did.log, []);
});

await acheck('the tick a session opens closes it, and says so', async () => {
  const w = world({ rows: [stallRow()] });
  const out = await sweepStall({ ...STALLED, silentSeconds: 12 }, w.deps);
  assert.equal(out.act, 'clear');
  assert.equal(w.did.closed.length, 1);
  assert.equal(w.did.closed[0].id, 'zz-stall');
  assert.match(w.did.closed[0].reason, /opened a session again/);
  assert.deepEqual(w.did.announced, [{ id: 'zz-stall', act: 'clear' }]);
});

await acheck('a tracker that would not answer files nothing and closes nothing', async () => {
  const w = world({ rows: null });
  const out = await sweepStall(STALLED, w.deps);
  assert.equal(out.act, 'unknown');
  assert.deepEqual(w.did.filed, []);
  assert.deepEqual(w.did.closed, []);
});

await acheck('a bd that would not take the bead says so and files nothing', async () => {
  const w = world({ createThrows: new Error('dolt: database locked') });
  const out = await sweepStall(STALLED, w.deps);
  assert.equal(out.act, 'unknown');
  assert.equal(out.id, '');
  assert.ok(w.did.log.some((l) => /could not file/.test(l)));
});

await acheck('a close bd refused leaves the bead open and says why on the bead', async () => {
  const w = world({ rows: [stallRow()], closeThrows: new Error('blocked by open issues') });
  const out = await sweepStall({ ...STALLED, silentSeconds: 12 }, w.deps);
  assert.equal(out.act, 'stuck');
  assert.equal(w.did.commented.length, 1);
  assert.match(w.did.commented[0].text, /blocked by open issues/);
  assert.deepEqual(w.did.announced, [], 'nothing changed, so nothing is announced');
});

await acheck('the ordinary tick is silent, on a Mac where this runs every minute forever', async () => {
  const w = world();
  const out = await sweepStall({ ...STALLED, queue: 0 }, w.deps);
  assert.equal(out.act, 'none');
  assert.deepEqual(w.did.log, []);
  assert.deepEqual(w.did.filed, []);
});

console.log(`\n${failures ? `${failures} of ${ran} failed` : `${ran} passed`}\n`);
process.exit(failures ? 1 : 0);
