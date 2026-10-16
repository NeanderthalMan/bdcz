/**
 * `lib/basegate.js` — when a local gate run may stand in for GitHub's answer about the
 * base (bc-3m8en).
 *
 * The bar is four conditions, and every one of them is here as a case that must be
 * REFUSED, because the failure mode this module can have is not "it says no too often"
 * — it is a run that should not have counted being taken as proof the base is sound,
 * which unholds the merge queue over a base nobody actually gated. The narrowed-run case
 * is the one most likely to happen by accident: `b7e-gate --only` is how the whole
 * backlog was cleared on 2026-09-19, so the runs directory on any real machine is full of
 * green partial runs against recent commits.
 *
 * Fabricated run records throughout, rather than real gate runs: what is under test is
 * the decision, and a test that had to run a 560-suite gate to make a record would be
 * untestable in practice. The shapes are `readRun`'s own.
 */
import assert from 'node:assert/strict';

import {
  refuseBaseRun,
  baseRunRefusal,
  RETRYABLE_KINDS,
  findBaseRun,
  baseRollupFrom,
  baseFailureFrom,
} from '../lib/basegate.js';

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message.split('\n').slice(0, 4).join('\n       ')}`);
  }
};

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const SUITES = ['test/one.mjs', 'test/two.mjs', 'test/three.mjs'];

/** A run that passes every condition, which each case below then spoils one way. */
const green = (over = {}) => ({
  runId: 'gate-main-20260920T000000000Z-aaaa',
  running: false,
  status: 'ok',
  sha: SHA,
  tree: SHA,
  untracked: {},
  failed: [],
  suites: [...SUITES],
  results: SUITES.map((s) => ({ suite: s, status: 'ok' })),
  startedAt: '2026-09-20T00:00:00.000Z',
  endedAt: '2026-09-20T00:10:00.000Z',
  ...over,
});

/* ------------------------------------------------------------------ the accept case */

check('a finished, clean, complete, green run at the base sha is accepted', () => {
  assert.equal(refuseBaseRun(green(), { sha: SHA, allSuites: SUITES }), '');
});

check('it is accepted with no allSuites given — that check is skipped, not failed open silently', () => {
  // `allSuites` is the caller's answer to "what is the full suite list"; a caller that
  // cannot compute it still gets the other three conditions rather than nothing.
  assert.equal(refuseBaseRun(green(), { sha: SHA }), '');
});

/* ------------------------------------------------- one case per condition, all refused */

check('a run against a different commit is refused, naming both shas', () => {
  const why = refuseBaseRun(green({ sha: OTHER, tree: OTHER }), { sha: SHA, allSuites: SUITES });
  assert.match(why, /ran against bbbbbbbbb, not aaaaaaaaa/);
});

check('a run from a modified tree is refused even though its sha matches', () => {
  // `snapshotTree` records `git stash create`, which is a NEW commit when the tree is
  // dirty — so tree !== sha is exactly "there were uncommitted changes".
  const why = refuseBaseRun(green({ tree: 'c'.repeat(40) }), { sha: SHA, allSuites: SUITES });
  assert.match(why, /modified tree/);
});

check('a run with untracked files present is refused, and says how many', () => {
  const why = refuseBaseRun(green({ untracked: { 'scratch.mjs': 'deadbeef', 'notes.md': 'cafe' } }), {
    sha: SHA,
    allSuites: SUITES,
  });
  assert.match(why, /2 untracked file/);
});

check('a NARROWED run is refused — the one that would otherwise slip through', () => {
  // b7e-gate --only leaves exactly this: finished, green, clean, right commit, fewer
  // suites. Every one of the 27 backlog merges produced one.
  const why = refuseBaseRun(green({ suites: ['test/one.mjs'], results: [{ suite: 'test/one.mjs', status: 'ok' }] }), {
    sha: SHA,
    allSuites: SUITES,
  });
  assert.match(why, /narrowed — it did not run 2 of 3 suites/);
});

check('a run that is still going is refused', () => {
  assert.match(refuseBaseRun(green({ running: true }), { sha: SHA, allSuites: SUITES }), /has not finished/);
});

check('a run with a failing suite is refused, and says how many', () => {
  const why = refuseBaseRun(green({ failed: ['test/two.mjs'] }), { sha: SHA, allSuites: SUITES });
  assert.match(why, /failed 1 suite/);
});

check('a run that ENDED not-ok is refused even with an empty failed list', () => {
  // The killed-for-memory shape: it stopped before anything went red, so `failed` is
  // empty and only `status` tells the truth.
  const why = refuseBaseRun(green({ status: 'killed', failed: [] }), { sha: SHA, allSuites: SUITES });
  assert.match(why, /ended killed, not ok/);
});

check('a run missing a result line for a selected suite is refused', () => {
  const why = refuseBaseRun(green({ results: [{ suite: 'test/one.mjs', status: 'ok' }] }), {
    sha: SHA,
    allSuites: SUITES,
  });
  assert.match(why, /never produced a result for 2 selected suite/);
});

check('a run with no recorded sha is refused rather than assumed to match', () => {
  assert.match(refuseBaseRun(green({ sha: null }), { sha: SHA, allSuites: SUITES }), /recorded no sha/);
});

check('no run at all, and no base sha, are both refusals with their own sentence', () => {
  assert.match(refuseBaseRun(null, { sha: SHA }), /no run/);
  assert.match(refuseBaseRun(green(), {}), /no base sha/);
});

/* ------------------------------------------------------------------------ findBaseRun */

const fakeDir = (runs) => ({
  list: () => runs.map((_, i) => `run-${i}.jsonl`),
  read: (file) => runs[Number(file.match(/run-(\d+)/)[1])],
});

check('findBaseRun takes the first acceptable run and does not read past it', () => {
  const runs = [green({ runId: 'newest' }), green({ runId: 'older' })];
  const readFiles = [];
  const { list } = fakeDir(runs);
  const { run, why } = findBaseRun('/d', SHA, {
    allSuites: SUITES,
    list,
    read: (f) => {
      readFiles.push(f);
      return runs[Number(f.match(/run-(\d+)/)[1])];
    },
  });
  assert.equal(run.runId, 'newest');
  assert.equal(why, '');
  assert.deepEqual(readFiles, ['run-0.jsonl'], 'stopped at the first acceptable run');
});

check('findBaseRun skips unacceptable runs and returns the closest miss for this commit', () => {
  // A narrowed run for THIS commit is more useful to report than a green run for another.
  const runs = [
    green({ runId: 'other-branch', sha: OTHER, tree: OTHER }),
    green({ runId: 'narrowed', suites: ['test/one.mjs'], results: [{ suite: 'test/one.mjs', status: 'ok' }] }),
  ];
  const { run, why } = findBaseRun('/d', SHA, { allSuites: SUITES, ...fakeDir(runs) });
  assert.equal(run, null);
  assert.match(why, /narrowed/);
});

check('findBaseRun says so plainly when nothing covers the commit', () => {
  const runs = [green({ sha: OTHER, tree: OTHER })];
  const { run, why } = findBaseRun('/d', SHA, { allSuites: SUITES, ...fakeDir(runs) });
  assert.equal(run, null);
  assert.match(why, /no local gate run covers this commit/);
});

check('findBaseRun survives an unreadable run file rather than throwing', () => {
  const runs = [green()];
  let first = true;
  const { run } = findBaseRun('/d', SHA, {
    allSuites: SUITES,
    list: () => ['torn.jsonl', 'run-0.jsonl'],
    read: (f) => {
      if (first && f === 'torn.jsonl') {
        first = false;
        throw new Error('unreadable');
      }
      return runs[0];
    },
  });
  assert.equal(run.runId, green().runId);
});

/* --------------------------------------------------------------------- baseRollupFrom */

check('baseRollupFrom is baseChecks-shaped, so baseVerdict needs no change', () => {
  const roll = baseRollupFrom(green());
  // The two fields lib/redbase.js `baseVerdict` actually reads.
  assert.equal(roll.state, 'passing');
  assert.deepEqual(roll.failed, []);
  // And the rest of the rollup contract, so no other reader is surprised.
  assert.equal(roll.failing, 0);
  assert.equal(roll.pending, 0);
  assert.equal(roll.total, SUITES.length);
  assert.equal(roll.passing, SUITES.length);
  assert.deepEqual(roll.failedUrls, []);
});

check('baseRollupFrom names the gate that answered, and the run to look it up by', () => {
  // A gate whose source is silent is indistinguishable from no gate — lib/mergeadvocate's
  // own argument for naming the baseline out loud, and this gate is invisible on GitHub.
  const roll = baseRollupFrom(green());
  assert.equal(roll.source, 'local-gate');
  assert.equal(roll.runId, green().runId);
  assert.equal(roll.at, '2026-09-20T00:10:00.000Z', 'the end of the run, not its start');
});

check('baseRollupFrom is null for no run, so a caller can fall through to GitHub', () => {
  assert.equal(baseRollupFrom(null), null);
});

/* ------------------------------------------------------------- the refusal kinds */

/**
 * bc-xl7n.163. `lib/autogate.js` decides whether to spend ten minutes of this Mac
 * producing a run, and the answer turns entirely on *which* refusal came back. The two
 * populations read almost identically as English, so a wording change nobody thought was
 * load-bearing would silently move a base from "go and measure it" to "leave it alone" —
 * which is why the kind is a token and why every one of them is pinned here.
 */
check('every refusal carries a kind, and the kind is not the sentence', () => {
  const cases = [
    ['absent', null, {}],
    ['running', green({ running: true }), {}],
    ['no-sha', green({ sha: null }), {}],
    ['other-commit', green({ sha: OTHER, tree: OTHER }), {}],
    ['dirty', green({ tree: 'c'.repeat(40) }), {}],
    ['untracked', green({ untracked: { 'scratch.mjs': 'deadbeef' } }), {}],
    ['failed', green({ failed: ['test/two.mjs'] }), {}],
    ['killed', green({ status: 'killed', failed: [] }), {}],
    ['incomplete', green({ results: [{ suite: 'test/one.mjs', status: 'ok' }] }), {}],
    ['narrowed', green({ suites: ['test/one.mjs'], results: [{ suite: 'test/one.mjs', status: 'ok' }] }), {}],
  ];
  for (const [kind, run] of cases) {
    const out = baseRunRefusal(run, { sha: SHA, allSuites: SUITES });
    assert.equal(out.kind, kind, `expected kind ${kind}, got ${out.kind} (${out.why})`);
    assert.ok(out.why, `${kind} must still say why in words`);
  }
  assert.deepEqual(baseRunRefusal(green(), { sha: SHA, allSuites: SUITES }), { kind: '', why: '' });
  assert.equal(baseRunRefusal(green(), {}).kind, 'no-base');
});

check('a run that FAILED is not retryable, and a run that was narrowed is', () => {
  // The whole line lib/autogate.js draws. A failed run is a statement about the BASE and
  // a second gate would spend ten minutes repeating it; a narrowed one is a statement
  // about the RUN, and a full one answers it.
  assert.equal(RETRYABLE_KINDS.has('failed'), false);
  assert.equal(RETRYABLE_KINDS.has('running'), false, 'somebody is already measuring it');
  for (const kind of ['absent', 'narrowed', 'dirty', 'untracked', 'killed', 'incomplete', 'no-suites', 'no-sha']) {
    assert.equal(RETRYABLE_KINDS.has(kind), true, `${kind} is a fact about the run, not the base`);
  }
});

check('refuseBaseRun is still exactly the sentence, so every older caller is unchanged', () => {
  assert.equal(refuseBaseRun(green(), { sha: SHA, allSuites: SUITES }), '');
  assert.equal(refuseBaseRun(null, { sha: SHA }), baseRunRefusal(null, { sha: SHA }).why);
});

check('findBaseRun carries the closest miss as a kind too, and absent when nothing is about it', () => {
  const narrowed = green({ suites: ['test/one.mjs'], results: [{ suite: 'test/one.mjs', status: 'ok' }] });
  const elsewhere = green({ runId: 'other', sha: OTHER, tree: OTHER });
  const one = findBaseRun('/d', SHA, {
    allSuites: SUITES,
    list: () => ['/d/a.jsonl', '/d/b.jsonl'],
    read: (f) => (f.endsWith('a.jsonl') ? elsewhere : narrowed),
  });
  assert.equal(one.run, null);
  assert.equal(one.kind, 'narrowed', 'the miss about THIS commit wins over the one about another branch');

  const none = findBaseRun('/d', SHA, { allSuites: SUITES, list: () => ['/d/a.jsonl'], read: () => elsewhere });
  assert.equal(none.kind, 'absent');
  assert.match(none.why, /no local gate run covers this commit/);

  const hit = findBaseRun('/d', SHA, { allSuites: SUITES, list: () => ['/d/a.jsonl'], read: () => green() });
  assert.equal(hit.kind, '', 'a run that qualifies has no refusal to name');
});

/* --------------------------------------------------------- the red reading, bc-xl7n.163 */

check('a local run that found this commit red is a reading in its own right', () => {
  // With Actions minutes exhausted GitHub's rollup names no checks at all, so the P0 that
  // gets filed says "checks GitHub did not name" and the session opened on it runs the
  // gate that already ran. The suite paths are what stop that.
  const red = baseFailureFrom(green({ failed: ['test/two.mjs', 'test/three.mjs'] }));
  assert.equal(red.state, 'failing');
  assert.deepEqual(red.failed, ['test/two.mjs', 'test/three.mjs']);
  assert.equal(red.failing, 2);
  assert.equal(red.passing, 1, 'of three suites, two failed');
  assert.equal(red.total, 3);
  assert.equal(red.source, 'local-gate');
  assert.equal(red.runId, green().runId);
});

check('a failure whose tail says ENOSPC is marked disk-full, anything else is not (bc-xl7n.196)', () => {
  const full = green({
    failed: ['test/two.mjs', 'test/three.mjs'],
    results: [
      { suite: 'test/two.mjs', status: 'fail', tail: 'Error: ENOSPC: no space left on device, mkdtemp' },
      { suite: 'test/three.mjs', status: 'fail', tail: 'check lost to the tail' },
    ],
  });
  assert.equal(baseFailureFrom(full).environment, 'disk-full');
  const code = green({
    failed: ['test/two.mjs'],
    results: [{ suite: 'test/two.mjs', status: 'fail', tail: 'AssertionError: nope' }],
  });
  assert.equal(baseFailureFrom(code).environment, null);
});

check('and it is null for anything that is not a finished, failing run', () => {
  // Never a way to report red from a run that has not finished or did not fail: that
  // would hold the queue and file a P0 off a run still in its first suite.
  assert.equal(baseFailureFrom(null), null);
  assert.equal(baseFailureFrom(green()), null, 'a green run is baseRollupFrom\'s business');
  assert.equal(baseFailureFrom(green({ running: true, failed: ['test/two.mjs'] })), null);
});

check('findBaseRun hands back the miss itself, so the failure can be read off it', () => {
  const failed = green({ failed: ['test/two.mjs'] });
  const out = findBaseRun('/d', SHA, { allSuites: SUITES, list: () => ['/d/a.jsonl'], read: () => failed });
  assert.equal(out.run, null, 'it still did not qualify');
  assert.equal(out.kind, 'failed');
  assert.equal(out.miss?.runId, failed.runId);
  // And nothing to hand back when the miss is about some other branch, or when one qualified.
  const elsewhere = findBaseRun('/d', SHA, {
    allSuites: SUITES,
    list: () => ['/d/a.jsonl'],
    read: () => green({ sha: OTHER, tree: OTHER }),
  });
  assert.equal(elsewhere.miss, null);
  assert.equal(findBaseRun('/d', SHA, { allSuites: SUITES, list: () => ['/d/a.jsonl'], read: () => green() }).miss, null);
});

/* ------------------------------------------------- a run the Mac slept through (bc-xl7n.179) */

const timeoutAt = (suite, at, elapsed = 931, limit = 900) => ({
  suite,
  status: 'fail',
  elapsed,
  at,
  tail: `timed out after ${limit}s — killed`,
});
// Shaped like main-20261001T015030951Z-czd8: timeouts stamped in the same second, elapsed
// far over the limit, plus two ordinary-looking failures from after the wake.
const czd8 = (over = {}) => {
  const results = [
    timeoutAt('test/one.mjs', '2026-10-01T02:06:18.577Z'),
    timeoutAt('test/two.mjs', '2026-10-01T02:06:18.583Z', 945),
    timeoutAt('test/three.mjs', '2026-10-01T02:06:18.590Z', 12000),
    { suite: 'test/four.mjs', status: 'fail', elapsed: 0.04, at: '2026-10-01T07:40:05.386Z', tail: 'vendor gone' },
  ];
  return green({ results, failed: results.map((r) => r.suite), suites: [...SUITES, 'test/four.mjs'], ...over });
};
const CZ = { sha: SHA, allSuites: [...SUITES, 'test/four.mjs'] };

check('a czd8-shaped run is classed slept, which is retryable', () => {
  const r = baseRunRefusal(czd8(), CZ);
  assert.equal(r.kind, 'slept');
  assert.ok(RETRYABLE_KINDS.has('slept'));
});

check('timeouts spread out in time are an honest failure, not a sleep', () => {
  const spread = czd8();
  spread.results[0].at = '2026-10-01T02:00:00.000Z';
  spread.results[1].at = '2026-10-01T02:10:00.000Z';
  spread.results[2].at = '2026-10-01T02:20:00.000Z';
  // Three kills and one ordinary failure, spread out: not a sleep, but a load starve (bc-xl7n.201).
  assert.equal(baseRunRefusal(spread, CZ).kind, 'starved');
  assert.ok(RETRYABLE_KINDS.has('starved'));
});

check('a red with real failures outnumbering the timeout kills stays failed', () => {
  const real = czd8();
  real.results[0].at = '2026-10-01T02:00:00.000Z';
  real.results[1].at = '2026-10-01T02:10:00.000Z';
  real.results[2].tail = 'assertion failed';
  assert.equal(baseRunRefusal(real, CZ).kind, 'failed');
});

check('ordinary failures at the same second are not a sleep — only timeouts over their limit count', () => {
  const same = czd8();
  for (const r of same.results) r.tail = 'assertion failed';
  assert.equal(baseRunRefusal(same, CZ).kind, 'failed');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
