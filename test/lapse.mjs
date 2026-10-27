#!/usr/bin/env node
/**
 * The holds that ran out — lib/lapse.js.
 *
 *     npm test
 *     node test/lapse.mjs
 *
 * bc-iaju1.4. Two holds in this repo park a bead in front of Adam and wait, and neither
 * had an ending: 83 beads held for endorsement, 78 of them untouched for over a month,
 * against a queue screen that draws sixty rows — and seven superseded cards that had
 * been in the inbox between three and five weeks. The sweep writes that silence down as
 * the answer it already is.
 *
 * What is worth a suite here is not that a close happens. It is every way an automatic
 * close could take something it should not have, and each of those is a separate check
 * below:
 *
 *  1. **The exclusions.** A `ship`, `promote` or `container` bead carries `unendorsed`
 *     for a reason that is not a question, and a `human` bead has a *different* question
 *     already in front of Adam. Lapsing any of them reads a silence that was never
 *     offered. Nothing else in the codebase would notice: they are all ordinary rows.
 *  2. **The clock is `updated_at`.** A bead argued about last week has been looked at,
 *     and the whole premise is that nothing has. Filing date and last-touch date differ
 *     by exactly the beads where getting it wrong is worst.
 *  3. **A row that cannot be dated is never old enough.** `touchedAt` returning `null`
 *     has to mean *leave it*, not *epoch zero* — the difference between a skipped row
 *     and every undated row in the tracker closing at once.
 *  4. **The cap holds, and it takes the oldest first.** A cap that took an arbitrary
 *     slice would leave the forty-day beads for last on every sweep of a backlog that
 *     grows at the front.
 *  5. **The superseded half only fires on a card that was actually raised.** This is the
 *     one place lib/lapse.js and lib/superseded.js could disagree, and the evidence that
 *     they do not is the ask comment: no ask on the thread, no lapse, whatever the
 *     marker says.
 *  6. **The bead says it was not refused.** A close carrying only a reason line reads as
 *     a decision against the work, which is the one thing that did not happen — so the
 *     comment and the close reason are both asserted, on the bead, in the tracker.
 *
 * No iTerm and no real tracker. `bd` is a stub binary that logs its argv and implements
 * enough of `list`, `show`, `comments`, `comment` and `close` for the sweep, mirroring
 * test/farblock.mjs's fixture.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-lapse-'));
// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { Bd } = await import(LIB('bd.js'));
const {
  LAPSE_DAYS,
  SUPERSEDE_DAYS,
  MAX_PER_SWEEP,
  LAPSED_PREFIX,
  SUPERSEDE_LAPSED_PREFIX,
  LAPSE_EXCLUDED,
  daysBetween,
  touchedAt,
  lapsable,
  onlyHeld,
  supersedeLapsable,
  askedAt,
  lapseReason,
  supersedeLapseReason,
  lapseNote,
  sweepLapsed,
  describeLapsed,
} = await import(LIB('lapse.js'));
const { UNENDORSED } = await import(LIB('endorse.js'));
const { supersedeLabel } = await import(LIB('superseded.js'));

/* ------------------------------------------------------------------- the stub bd */

const WORLD = path.join(tmp, 'world.json');
const BD_LOG = path.join(tmp, 'bd-calls.log');
const FAKE_BD = path.join(tmp, 'bd');

fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(BD_LOG)}, JSON.stringify(args) + '\\n');
const w = JSON.parse(fs.readFileSync(${JSON.stringify(WORLD)}, 'utf8'));
const save = () => fs.writeFileSync(${JSON.stringify(WORLD)}, JSON.stringify(w, null, 2));
const die = (m) => { process.stderr.write(m + '\\n'); process.exit(1); };
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const row = (i) => ({
  ...i,
  dependencies: (i.blockedBy || []).map((id) => ({ id, dependency_type: 'blocks', status: (w.issues[id] || {}).status || 'closed', title: '' })),
});
const live = () => Object.values(w.issues).filter((i) => i.status !== 'closed').map(row);

if (args[0] === 'list') {
  // \`--parent\` matters: the close gate asks it for every bead, and a stub that ignored
  // it would answer "every open bead is your child" and refuse every close.
  const parent = flag('--parent');
  const rows = parent ? live().filter((i) => i.parent === parent) : live();
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}
if (args[0] === 'show') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error fetching ' + args[1] + ': no issue found');
  process.stdout.write(JSON.stringify([row(issue)]));
  process.exit(0);
}
if (args[0] === 'comments') { process.stdout.write(JSON.stringify(w.comments[args[1]] || [])); process.exit(0); }
if (args[0] === 'comment') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error: no issue found matching "' + args[1] + '"');
  (w.comments[args[1]] = w.comments[args[1]] || []).push({ text: args[2], created_at: new Date().toISOString() });
  save();
  process.exit(0);
}
if (args[0] === 'close') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error: no issue found matching "' + args[1] + '"');
  if (w.refuse && w.refuse[args[1]]) die('Error: cannot close ' + args[1] + ': ' + w.refuse[args[1]]);
  issue.status = 'closed';
  issue.close_reason = flag('--reason') || '';
  save();
  process.exit(0);
}
process.stdout.write('[]');
`,
  { mode: 0o755 }
);

const bdCalls = () =>
  fs.existsSync(BD_LOG) ? fs.readFileSync(BD_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const clearCalls = () => fs.rmSync(BD_LOG, { force: true });

/* ---------------------------------------------------------------- the fixture */

// A fixed "now" and dates relative to it, so the suite never drifts with the calendar.
const NOW = Date.parse('2026-09-19T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

const issue = (id, extra = {}) => ({
  id,
  title: `bead ${id}`,
  description: `what ${id} is for`,
  notes: '',
  status: 'open',
  issue_type: 'task',
  priority: 2,
  labels: [],
  created_at: daysAgo(90),
  updated_at: daysAgo(90),
  ...extra,
});

const held = (id, days, extra = {}) =>
  issue(id, { labels: [UNENDORSED], created_at: daysAgo(days), updated_at: daysAgo(days), ...extra });

/**
 * Five kinds of row, and only two of them lapse.
 *
 * `zz-old*` are plain endorsement holds well past the threshold. `zz-fresh` is inside
 * it. `zz-ship`, `zz-promote`, `zz-container` and `zz-asked` each carry the marker for a
 * reason that is not a question. `zz-dupe` is a superseded duplicate whose card went up
 * long ago; `zz-unasked` carries the same marker and the `human` label with nothing on
 * its thread to say the card was ever raised.
 */
const reset = () => {
  fs.writeFileSync(
    WORLD,
    JSON.stringify(
      {
        refuse: {},
        comments: {
          'zz-dupe': [
            { text: 'Superseded by zz-orig — same job.', created_at: daysAgo(60) },
            { text: 'zz-orig has closed. Asking whether this goes with it — see the card in the inbox.', created_at: daysAgo(40) },
          ],
          'zz-recent': [
            { text: 'zz-orig has closed. Asking whether this goes with it — see the card in the inbox.', created_at: daysAgo(3) },
          ],
          'zz-unasked': [{ text: 'a note about something else entirely', created_at: daysAgo(40) }],
        },
        issues: {
          'zz-old1': held('zz-old1', 40),
          'zz-old2': held('zz-old2', 35),
          'zz-old3': held('zz-old3', 31),
          'zz-fresh': held('zz-fresh', 3),
          'zz-touched': held('zz-touched', 90, { updated_at: daysAgo(2) }),
          'zz-undated': held('zz-undated', 40, { created_at: null, updated_at: null }),
          'zz-ship': held('zz-ship', 40, { labels: [UNENDORSED, 'ship'] }),
          'zz-promote': held('zz-promote', 40, { labels: [UNENDORSED, 'promote'] }),
          'zz-container': held('zz-container', 40, { labels: [UNENDORSED, 'container'] }),
          'zz-asked': held('zz-asked', 40, { labels: [UNENDORSED, 'human'] }),
          'zz-working': held('zz-working', 40, { status: 'in_progress' }),
          // Open in bd's eyes and unclosable in bd's eyes: the gate has to be asked
          // before a word is written, or this bead collects one identical comment per
          // sweep for ever, since the candidate set is rebuilt from scratch every time.
          'zz-gated': held('zz-gated', 40, { blockedBy: ['zz-open'] }),
          'zz-open': issue('zz-open'),
          'zz-work': issue('zz-work'),
          'zz-dupe': issue('zz-dupe', { labels: ['human', supersedeLabel('zz-orig')] }),
          'zz-recent': issue('zz-recent', { labels: ['human', supersedeLabel('zz-orig')] }),
          'zz-unasked': issue('zz-unasked', { labels: ['human', supersedeLabel('zz-orig')] }),
          'zz-orig': issue('zz-orig', { status: 'closed' }),
        },
      },
      null,
      2
    )
  );
};
reset();

const wsDir = path.join(tmp, 'ws', '.beads');
fs.mkdirSync(wsDir, { recursive: true });
const ws = { name: 'demo', dir: wsDir };
const bd = new Bd({ bin: FAKE_BD, actor: 'beadcause-test' });

const world = () => JSON.parse(fs.readFileSync(WORLD, 'utf8'));
const beadOf = (id) => world().issues[id];
const statusOf = (id) => beadOf(id).status;
const reasonOf = (id) => beadOf(id).close_reason || '';
const threadOf = (id) => (world().comments[id] || []).map((c) => c.text);
const sweep = (opts = {}) => sweepLapsed(bd, ws, { now: NOW, workspaces: [ws], ...opts });

/* --------------------------------------------------------------------- harness */

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
}

console.log('\na hold nobody answered, and the silence written down as the answer\n');

/* ------------------------------------------------------- the pure predicates */

await check('the thresholds are the numbers the bead asked for', () => {
  assert.equal(LAPSE_DAYS, 30);
  assert.equal(SUPERSEDE_DAYS, 14);
  assert.ok(MAX_PER_SWEEP > 0 && MAX_PER_SWEEP < 100, 'a cap that is a cap');
});

await check('the two close-reason prefixes are distinct, and neither is a revoke', async () => {
  const { REVOKED_PREFIX } = await import(LIB('verdict.js'));
  assert.notEqual(LAPSED_PREFIX, SUPERSEDE_LAPSED_PREFIX);
  assert.notEqual(LAPSED_PREFIX, REVOKED_PREFIX);
  assert.ok(!LAPSED_PREFIX.startsWith(REVOKED_PREFIX), 'a lapse must not read as Adam having said no');
});

await check('daysBetween is exact rather than rounded, so a threshold is a threshold', () => {
  assert.equal(daysBetween(NOW - 86400000, NOW), 1);
  assert.equal(daysBetween(NOW - 86400000 * 1.5, NOW), 1.5);
  assert.equal(daysBetween(NOW, NOW), 0);
});

await check('the clock is the last write, not the filing date', () => {
  // Filed 90 days ago, written to 2 days ago: looked at, so not lapsable.
  assert.equal(touchedAt(beadOf('zz-touched')), Date.parse(daysAgo(2)));
  assert.equal(lapsable(beadOf('zz-touched'), { now: NOW }), false);
  assert.equal(lapsable(beadOf('zz-old1'), { now: NOW }), true);
});

await check('a row with no usable timestamp is never old enough', () => {
  assert.equal(touchedAt(beadOf('zz-undated')), null);
  assert.equal(lapsable(beadOf('zz-undated'), { now: NOW }), false);
  assert.equal(touchedAt({ id: 'x', updated_at: 'not a date', created_at: daysAgo(40) }), Date.parse(daysAgo(40)));
});

await check('the threshold is inclusive at the boundary and nowhere before it', () => {
  const at = (days) => ({ id: 'x', status: 'open', labels: [UNENDORSED], updated_at: daysAgo(days) });
  assert.equal(lapsable(at(30), { now: NOW, days: 30 }), true);
  assert.equal(lapsable(at(29.9), { now: NOW, days: 30 }), false);
});

await check('every marker that is not a question is excluded', () => {
  assert.deepEqual(LAPSE_EXCLUDED, ['ship', 'promote', 'container', 'human']);
  for (const id of ['zz-ship', 'zz-promote', 'zz-container', 'zz-asked']) {
    assert.equal(lapsable(beadOf(id), { now: NOW }), false, `${id} must not lapse`);
    // And it is the exclusion doing it rather than the clock — all four are 40 days old.
    assert.equal(onlyHeld(beadOf(id)), false, `${id} is not an endorsement hold at all`);
  }
  // The clock is the only difference between these two, which is what makes `checked`
  // and `lapsed` two different numbers rather than the same one twice.
  assert.equal(onlyHeld(beadOf('zz-fresh')), true);
  assert.equal(lapsable(beadOf('zz-fresh'), { now: NOW }), false);
});

await check('only an open bead lapses — in_progress has a window on it and blocked cannot close', () => {
  assert.equal(lapsable(beadOf('zz-working'), { now: NOW }), false);
  assert.equal(lapsable({ ...beadOf('zz-old1'), status: 'blocked' }, { now: NOW }), false);
});

await check('a bead with no unendorsed marker is not this sweep for any age', () => {
  assert.equal(lapsable(beadOf('zz-work'), { now: NOW, days: 0 }), false);
});

await check('the ask comment is what dates a superseded card, not the bead', () => {
  assert.equal(askedAt(world().comments['zz-dupe']), Date.parse(daysAgo(40)));
  assert.equal(askedAt(world().comments['zz-unasked']), null);
  assert.equal(askedAt([]), null);
  assert.equal(askedAt(null), null);
});

await check('a superseded candidate needs the card as well as the marker', () => {
  assert.equal(supersedeLapsable(beadOf('zz-dupe')), true);
  // Marker, no card: lib/superseded.js has not asked, so there is no silence to read.
  assert.equal(supersedeLapsable({ ...beadOf('zz-dupe'), labels: [supersedeLabel('zz-orig')] }), false);
  assert.equal(supersedeLapsable(beadOf('zz-work')), false);
});

await check('the close reasons name the age and, for a duplicate, the original', () => {
  assert.match(lapseReason(31.7), new RegExp(`^${LAPSED_PREFIX} — 31 days`));
  assert.match(supersedeLapseReason('zz-orig', 40.2), /zz-orig/);
  assert.match(supersedeLapseReason('zz-orig', 40.2), /40 days/);
});

await check('the note says it was not a refusal and how to bring the bead back', () => {
  const note = lapseNote('zz-old1', 40, 30);
  assert.match(note, /Nothing here decided against it/);
  assert.match(note, /bd update zz-old1 --status open/);
});

/* ------------------------------------------------------------------ the sweep */

await check('the sweep closes the stale holds and leaves everything else alone', async () => {
  reset();
  const result = await sweep();
  assert.equal(result.ok, true);
  const ids = result.lapsed.map((l) => l.id).sort();
  assert.deepEqual(ids, ['zz-dupe', 'zz-old1', 'zz-old2', 'zz-old3']);
  for (const id of ['zz-old1', 'zz-old2', 'zz-old3', 'zz-dupe']) assert.equal(statusOf(id), 'closed', id);
  for (const id of ['zz-fresh', 'zz-touched', 'zz-undated', 'zz-ship', 'zz-promote', 'zz-container', 'zz-asked', 'zz-work', 'zz-recent', 'zz-unasked'])
    assert.equal(statusOf(id), 'open', `${id} must be left alone`);
  assert.equal(statusOf('zz-working'), 'in_progress', 'a bead with a window on it is untouched');
});

await check('each closed bead carries the reason and the re-file note, on the bead', async () => {
  reset();
  await sweep();
  assert.match(reasonOf('zz-old1'), new RegExp(`^${LAPSED_PREFIX} — 40 days`));
  const thread = threadOf('zz-old1').join('\n');
  assert.match(thread, /Nothing here decided against it/);
  assert.match(thread, /bd update zz-old1 --status open/, 'the note names the bead, not a placeholder');
});

await check('a lapsed duplicate says which bead it was a duplicate of, and how to undo it', async () => {
  reset();
  await sweep();
  assert.match(reasonOf('zz-dupe'), new RegExp(`^${SUPERSEDE_LAPSED_PREFIX} of zz-orig`));
  const thread = threadOf('zz-dupe').join('\n');
  assert.match(thread, /If they are not the same job/);
  assert.match(thread, /bd update zz-dupe --status open/);
});

await check('a card raised days rather than weeks ago is left in the inbox', async () => {
  reset();
  await sweep();
  assert.equal(statusOf('zz-recent'), 'open');
});

await check('a marker with no ask on the thread is skipped and named, never closed', async () => {
  reset();
  const result = await sweep();
  assert.equal(statusOf('zz-unasked'), 'open');
  assert.ok(
    result.skipped.some((s) => s.id === 'zz-unasked' && /card was ever raised/.test(s.why)),
    'the reason travels back rather than vanishing'
  );
});

await check('lapseSuperseded off drains the endorsement queue and touches no duplicate', async () => {
  reset();
  const result = await sweep({ superseded: false });
  assert.equal(statusOf('zz-dupe'), 'open');
  assert.equal(result.lapsed.every((l) => l.kind === 'endorsement'), true);
  assert.equal(statusOf('zz-old1'), 'closed');
});

await check('the cap holds, takes the oldest first, and says how many are left', async () => {
  reset();
  const result = await sweep({ max: 2 });
  assert.equal(result.lapsed.length, 2);
  assert.deepEqual(result.lapsed.map((l) => l.id), ['zz-old1', 'zz-old2'], 'oldest first');
  // Exactly the two that *would* have lapsed: zz-old3 and zz-dupe. The fresh holds and
  // the card raised three days ago are not "left for the next sweep" — the next sweep
  // will not take them either, and counting them would make the log line a promise.
  assert.equal(result.remaining, 2);
  assert.equal(statusOf('zz-old3'), 'open');
  assert.equal(statusOf('zz-dupe'), 'open');
});

await check('checked counts every hold examined, not just the ones past the threshold', async () => {
  reset();
  const result = await sweep({ days: 3650, supersedeDays: 3650 });
  assert.equal(result.lapsed.length, 0);
  // Seven plain endorsement holds survive the exclusions (old1-3, fresh, touched,
  // undated, gated) plus the three superseded candidates carrying a card.
  assert.equal(result.checked, 10, `expected every hold counted, got ${result.checked}`);
  assert.equal(result.remaining, 0, 'nothing is waiting when nothing was due');
});

await check('a second sweep after a capped one takes the next slice', async () => {
  reset();
  await sweep({ max: 2 });
  const second = await sweep({ max: 2 });
  assert.deepEqual(second.lapsed.map((l) => l.id).sort(), ['zz-dupe', 'zz-old3']);
});

await check('a threshold nothing has reached closes nothing and says nothing', async () => {
  reset();
  const result = await sweep({ days: 3650, supersedeDays: 3650 });
  assert.equal(result.ok, true);
  assert.equal(result.lapsed.length, 0);
  assert.equal(describeLapsed(result), '');
  assert.equal(statusOf('zz-old1'), 'open');
});

await check('a bead bd would refuse to close is skipped before a word is written', async () => {
  reset();
  const result = await sweep();
  assert.equal(statusOf('zz-gated'), 'open');
  assert.deepEqual(threadOf('zz-gated'), [], 'no comment on a bead the close gate will refuse');
  assert.ok(result.skipped.some((s) => s.id === 'zz-gated' && /zz-open/.test(s.why)), 'bd’s own sentence travels back');
});

await check('and it is still skipped, still silently, on a second sweep', async () => {
  reset();
  await sweep();
  await sweep();
  assert.deepEqual(threadOf('zz-gated'), [], 'an hourly sweep must not accumulate identical comments');
});

await check('a bead bd refuses to close is skipped with the refusal, and the sweep goes on', async () => {
  reset();
  const w = world();
  w.refuse = { 'zz-old1': 'blocked by open issues' };
  fs.writeFileSync(WORLD, JSON.stringify(w, null, 2));
  const result = await sweep();
  assert.equal(statusOf('zz-old1'), 'open');
  assert.ok(result.skipped.some((s) => s.id === 'zz-old1' && /could not close it/.test(s.why)));
  assert.equal(statusOf('zz-old2'), 'closed', 'one refusal does not abandon the rest');
});

await check('an unreadable tracker is a reason, never a throw and never a close', async () => {
  reset();
  const broken = new Bd({ bin: path.join(tmp, 'no-such-bd'), actor: 'beadcause-test' });
  const result = await sweepLapsed(broken, ws, { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.reason, /could not read the tracker/);
  assert.equal(result.lapsed.length, 0);
  assert.equal(statusOf('zz-old1'), 'open');
});

await check('the candidate scan is one tracker read, however big the backlog', async () => {
  reset();
  clearCalls();
  await sweep({ superseded: false });
  const lists = bdCalls().filter((a) => a[0] === 'list');
  const scans = lists.filter((a) => !a.includes('--parent'));
  assert.equal(scans.length, 1, `one unfiltered bd list, got ${scans.length}`);
  // Every other read is the close gate asking about one bead it is about to close, so
  // the per-bead cost is bounded by the cap rather than by the size of the backlog.
  assert.ok(lists.length - scans.length <= 4, 'the rest are per-close gates, one each');
});

await check('the cap bounds the per-bead reads, not just the writes', async () => {
  reset();
  clearCalls();
  await sweep({ max: 1, superseded: false });
  const gated = bdCalls().filter((a) => a[0] === 'list' && a.includes('--parent'));
  assert.equal(gated.length, 1, `a cap of one buys one close gate, got ${gated.length}`);
});

await check('the log line names what was closed and what is still waiting', async () => {
  reset();
  const result = await sweep({ max: 2 });
  const line = describeLapsed(result);
  assert.match(line, /lapsed 2 unanswered holds/);
  assert.match(line, /zz-old1 \(40d\)/);
  assert.match(line, /left for the next sweep/);
  assert.equal(describeLapsed({ ok: false, reason: 'the tracker is down', lapsed: [] }), 'lapse sweep skipped — the tracker is down');
});

/* ------------------------------------------------- the advocate's own wiring */

// `DEFAULTS` in lib/advocate.js is module-private on purpose and importing the advocate
// for real would boot a daemon, so the wiring is asserted against the source the way the
// persist whitelist below is. It is a weaker check than a call and it catches the thing
// that actually goes wrong: a sweep written, tested and never switched on.
const ADVOCATE_SRC = fs.readFileSync(LIB('advocate.js'), 'utf8');

await check('the advocate defaults carry the sweep, its two switches and its cap', () => {
  for (const key of ['lapseBacklog: true', 'lapseSuperseded: true', 'lapseDays: LAPSE_DAYS', 'supersedeLapseDays: SUPERSEDE_DAYS', 'lapseMaxPerSweep: MAX_PER_SWEEP'])
    assert.ok(ADVOCATE_SRC.includes(key), `DEFAULTS is missing ${key}`);
  const interval = /lapseIntervalMinutes: (\d+)/.exec(ADVOCATE_SRC);
  assert.ok(interval && Number(interval[1]) >= 60, 'nothing it watches for moves in under a day');
});

await check('the sweep is actually called from the tick, not merely defined', () => {
  assert.match(ADVOCATE_SRC, /await lapseBacklog\(a\);/, 'the tick runs it');
  assert.match(ADVOCATE_SRC, /if \(o\.lapseBacklog === false \|\| OBSERVING\) return;/, 'an observer never closes another tracker’s beads');
});

await check('lastLapseAt survives a restart — the cap is meaningless if the clock resets', () => {
  // Both halves of the whitelist, asserted on the source: persist() and record() are
  // hand-listed, and a field in one and not the other dies silently at the next boot.
  assert.match(ADVOCATE_SRC, /lastLapseAt: prev\.lastLapseAt \|\| null/, 'record() restores it');
  assert.match(ADVOCATE_SRC, /lastLapseAt: a\.lastLapseAt,/, 'persist() writes it');
});

reset();

console.log(`\n${ran - failures}/${ran} passed`);
cleanupTmp(tmp);
process.exit(failures ? 1 : 0);
