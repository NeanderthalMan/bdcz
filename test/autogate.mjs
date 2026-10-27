/**
 * `lib/autogate.js` — the daemon gating its own base (bc-xl7n.163).
 *
 *     npm test
 *     node test/autogate.mjs
 *
 * What this module can get wrong is expensive in one direction and only that direction:
 * every mistake it makes costs eight to ten minutes of a loaded Mac, taken out of the
 * very worker sessions the gate exists to unblock. So the cases below are weighted toward
 * the refusals — a base already measured, a base a run already called red, a sha that has
 * had its one attempt, a workspace that never asked — and the one act that spends the ten
 * minutes is pinned from both sides: it fires when it should, and it does not fire again.
 *
 * Nothing here starts a real gate or makes a checkout. `gateBase` takes both effects as
 * arguments for exactly that reason, so a whole sequence of ticks is a loop over a fake
 * `start`/`stop` pair. The one exception is the kill guard at the bottom, which is real:
 * `stopBaseGate` sends a signal, and the thing worth pinning about a signal is the case
 * where it must not be sent. `startBaseGate` is left alone — what it wraps (`lib/at.js`,
 * `bin/b7e-detach`) has its own coverage, and a suite that ran a 560-suite sweep to test
 * the launcher would be untestable in practice.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BASE_GATE_SIDECAR,
  BASE_GATE_STALE_MS,
  GITHUB_NONE_GRACE_MS,
  GITHUB_PENDING_GRACE_MS,
  TRIED_MAX,
  adoptBaseGates,
  baseGateAct,
  gateBase,
  gatesBaseLocally,
  githubStillAnswering,
  stopBaseGate,
  wantsBaseRun,
} from '../lib/autogate.js';

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message.split('\n').slice(0, 4).join('\n       ')}`);
  }
};

const SHA = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);

/** A record shaped as `startBaseGate` answers, at a given age. */
const flight = (over = {}) => ({
  runId: 'gate-main-20260920T000000000Z-aaaa',
  pid: 4242,
  dir: '/tmp/beadcause-at/tree-xxx/work',
  scratchRoot: '/tmp/beadcause-at/tree-xxx',
  root: '/repo',
  sha: SHA,
  base: 'main',
  key: 'beadcause',
  at: 1_000_000,
  ...over,
});

/** A `start`/`stop` pair that records rather than does. */
function effects({ fail = false } = {}) {
  const started = [];
  const stopped = [];
  return {
    started,
    stopped,
    deps: {
      start: async ({ sha }) => {
        started.push(sha);
        if (fail) throw new Error('git worktree add: fatal: invalid reference');
        return { runId: `run-for-${sha.slice(0, 4)}`, pid: 99, dir: '/t/work', scratchRoot: '/t', root: '/repo' };
      },
      stop: async (rec, why) => {
        stopped.push({ runId: rec.runId, why });
      },
      now: () => 1_000_000,
      log: () => {},
    },
  };
}

/* ------------------------------------------------------------------- the config gate */

await check('a workspace gates its own base only where it was asked to', () => {
  assert.equal(gatesBaseLocally({}, 'beadcause'), false, 'nothing configured is off');
  assert.equal(gatesBaseLocally({ pr: { gateBaseLocally: true } }, 'anything'), true);
  const cfg = { pr: { gateBaseLocally: false, gateBaseLocallyPerWorkspace: { beadcause: true } } };
  assert.equal(gatesBaseLocally(cfg, 'beadcause'), true);
  assert.equal(gatesBaseLocally(cfg, 'loremia'), false, 'a name that is absent falls through');
});

await check('a per-workspace value that is not a boolean is not an answer', () => {
  // A map keyed by workspace name is hand-edited, and `"yes"` must read as "nothing
  // legible was asked for" rather than as true — the rule configuredBase keeps too.
  const cfg = { pr: { gateBaseLocally: true, gateBaseLocallyPerWorkspace: { beadcause: 'yes' } } };
  assert.equal(gatesBaseLocally(cfg, 'beadcause'), true, 'falls through to the install-wide answer');
  const off = { pr: { gateBaseLocally: false, gateBaseLocallyPerWorkspace: { beadcause: 'yes' } } };
  assert.equal(gatesBaseLocally(off, 'beadcause'), false);
  // And `false` really does override a `true` above it, which a truthiness test would lose.
  const veto = { pr: { gateBaseLocally: true, gateBaseLocallyPerWorkspace: { loremia: false } } };
  assert.equal(gatesBaseLocally(veto, 'loremia'), false);
});

/* ------------------------------------------------------------------- the decision */

await check('nothing on disk about this commit is the case a gate answers', () => {
  assert.equal(wantsBaseRun('absent'), true);
  const act = baseGateAct({ enabled: true, sha: SHA, kind: 'absent' });
  assert.equal(act.act, 'start');
});

await check('a base a run already called RED is never re-measured', () => {
  // The expensive mistake. Ten more minutes of a 560-suite sweep would report the same
  // red, and the thing that is actually owed is a P0 and somebody to fix it.
  assert.equal(wantsBaseRun('failed'), false);
  assert.equal(baseGateAct({ enabled: true, sha: SHA, kind: 'failed' }).act, 'none');
});

await check('a base somebody else is already gating is left to them', () => {
  // `running` with nothing of ours in flight is a session's own hand-run gate against
  // this exact commit. A second one would fight it for the machine-wide slot.
  const act = baseGateAct({ enabled: true, sha: SHA, kind: 'running' });
  assert.equal(act.act, 'none');
  assert.match(act.reason, /already running/);
});

await check('a run that was narrowed, dirty or killed is worth answering with a full one', () => {
  for (const kind of ['narrowed', 'dirty', 'untracked', 'killed', 'incomplete', 'no-suites', 'no-sha', 'slept', 'starved']) {
    assert.equal(baseGateAct({ enabled: true, sha: SHA, kind }).act, 'start', kind);
  }
});

await check('a workspace that did not ask for this does nothing at all', () => {
  assert.equal(baseGateAct({ enabled: false, sha: SHA, kind: 'absent' }).act, 'off');
});

await check('a base sha nothing could name leaves an in-flight run alone', () => {
  // A `gh` call that would not answer is transient. Abandoning a nine-minute gate over a
  // rate limit would spend this base's one attempt on a hiccup.
  const act = baseGateAct({ enabled: true, sha: '', kind: 'absent', inFlight: flight() });
  assert.equal(act.act, 'none');
  assert.equal(act.cancel, null);
});

await check('our own run, still running, is the silent steady state', () => {
  const act = baseGateAct({ enabled: true, sha: SHA, kind: 'running', inFlight: flight() });
  assert.equal(act.act, 'wait');
  assert.equal(act.cancel, null);
});

await check('our own run with no record yet is queued, not broken', () => {
  // `b7e-detach --start-timeout 0` answers before the child has taken the machine-wide
  // slot, so "no record" is the ordinary state of a gate behind another session's.
  const act = baseGateAct({ enabled: true, sha: SHA, kind: 'absent', inFlight: flight(), now: 1_000_000 + 60_000 });
  assert.equal(act.act, 'queued');
  assert.equal(act.cancel, null);
});

await check('and it is abandoned once no record could plausibly still be coming', () => {
  const act = baseGateAct({
    enabled: true,
    sha: SHA,
    kind: 'absent',
    inFlight: flight(),
    now: 1_000_000 + BASE_GATE_STALE_MS + 1,
  });
  assert.equal(act.act, 'abandoned');
  assert.equal(act.cancel?.runId, flight().runId);
  assert.equal(act.tried, SHA, 'the sha is spent either way — it does not get a second');
});

await check('our own run that has ENDED is torn down, whatever it said', () => {
  // The answer is findBaseRun's to give; this module's only remaining job is the worktree.
  for (const kind of ['', 'failed', 'narrowed']) {
    const act = baseGateAct({ enabled: true, sha: SHA, kind, inFlight: flight() });
    assert.equal(act.act, 'done', kind || 'green');
    assert.equal(act.cancel?.runId, flight().runId);
  }
});

/* ------------------------------------------------------------------- the tick */

await check('the base moving cancels the run for the old sha and starts one for the new', async () => {
  // The debounce, and the thing the bead is about: a gate whose sha nothing will ever ask
  // about again is ten minutes of a slot the CURRENT base needs.
  const e = effects();
  const out = await gateBase(
    { key: 'beadcause', base: 'main', sha: MOVED, kind: 'absent', enabled: true, inFlight: flight(), tried: [SHA] },
    e.deps
  );
  assert.deepEqual(e.stopped.map((s) => s.runId), [flight().runId]);
  assert.match(e.stopped[0].why, /the base moved/);
  assert.deepEqual(e.started, [MOVED], 'and it does not join the old one, it replaces it');
  assert.equal(out.act, 'start');
  assert.equal(out.inFlight.sha, MOVED);
  assert.equal(out.measuring, true);
});

await check('one sha gets one gate, and never a second', async () => {
  const e = effects();
  const first = await gateBase({ sha: SHA, kind: 'absent', enabled: true, tried: [] }, e.deps);
  assert.equal(first.act, 'start');
  assert.deepEqual(first.tried, [SHA], 'starting is what spends it, not finishing');

  // The run then ends without producing anything readable — the worst case, because every
  // later tick sees exactly the state that made the first one start.
  const second = await gateBase(
    { sha: SHA, kind: 'absent', enabled: true, inFlight: null, tried: first.tried },
    e.deps
  );
  assert.equal(second.act, 'tried');
  assert.deepEqual(e.started, [SHA], 'one launch, not two');
});

await check('a launch that failed still spends the sha', async () => {
  // A launch this Mac refused refuses the same way thirty seconds later, for as long as
  // the base is red — so retrying it every tick is a loop, not a recovery.
  const e = effects({ fail: true });
  const out = await gateBase({ sha: SHA, kind: 'absent', enabled: true, tried: [] }, e.deps);
  assert.equal(out.act, 'failed');
  assert.equal(out.inFlight, null);
  assert.deepEqual(out.tried, [SHA]);
  assert.equal(out.measuring, false);
});

await check('a teardown that throws still forgets the run', async () => {
  // Otherwise one failed `git worktree remove` holds the base for BASE_GATE_STALE_MS and
  // then holds it again. lib/at.js's own --reap is the backstop for the tree itself.
  const out = await gateBase(
    { sha: MOVED, kind: 'failed', enabled: true, inFlight: flight(), tried: [SHA] },
    {
      start: async () => assert.fail('a failed base is not re-measured'),
      stop: async () => {
        throw new Error('git worktree remove: fatal');
      },
      now: () => 1_000_000,
    }
  );
  assert.equal(out.inFlight, null);
  assert.equal(out.act, 'none');
});

await check('switching the setting off mid-run takes the run with it', async () => {
  const e = effects();
  const out = await gateBase({ sha: SHA, kind: 'running', enabled: false, inFlight: flight(), tried: [] }, e.deps);
  assert.equal(out.act, 'off');
  assert.deepEqual(e.stopped.map((s) => s.runId), [flight().runId]);
  assert.equal(out.inFlight, null);
  assert.equal(out.measuring, false);
});

await check('measuring is true for anybody\'s gate against this commit, not only ours', async () => {
  // It is what suppresses the second window (lib/redbase.js), and a session gating the
  // base by hand deserves that suppression exactly as much as the daemon's own gate does.
  const mine = await gateBase({ sha: SHA, kind: 'running', enabled: true, inFlight: flight() }, effects().deps);
  assert.equal(mine.measuring, true);
  const theirs = await gateBase({ sha: SHA, kind: 'running', enabled: true, inFlight: null }, effects().deps);
  assert.equal(theirs.measuring, true, 'somebody else is measuring it, and that is still measuring');
  const settled = await gateBase({ sha: SHA, kind: '', enabled: true, inFlight: null }, effects().deps);
  assert.equal(settled.measuring, false);
});

await check('a base that moves and moves does not grow an unbounded memory', async () => {
  let tried = [];
  const e = effects();
  for (let i = 0; i < TRIED_MAX + 5; i++) {
    const sha = String(i).padStart(40, 'c');
    // eslint-disable-next-line no-await-in-loop
    const out = await gateBase({ sha, kind: 'absent', enabled: true, inFlight: null, tried }, e.deps);
    tried = out.tried;
  }
  assert.equal(tried.length, TRIED_MAX);
  assert.equal(e.started.length, TRIED_MAX + 5, 'every distinct sha still got its one gate');
});

/* ---------------------------------------------------- the sequence, end to end */

await check('the merge treadmill, four ticks: measure, merge, measure again, and no second window', async () => {
  /**
   * The whole bead in one case. A red base nothing has measured; a gate; a green answer
   * that lets one pull request merge; the base moving out from under that answer; and a
   * second gate — with no P0 and no session window anywhere in it, which is what
   * `measuring` buys one module over in lib/redbase.js.
   */
  const e = effects();
  let state = { inFlight: null, tried: [] };

  state = await gateBase({ sha: SHA, kind: 'absent', enabled: true, ...state }, e.deps);
  assert.equal(state.act, 'start');
  assert.equal(state.measuring, true, 'while it runs, nothing files a P0 and nothing opens a window');

  state = await gateBase({ sha: SHA, kind: 'running', enabled: true, ...state }, e.deps);
  assert.equal(state.act, 'wait');
  assert.equal(state.measuring, true);

  // It goes green — findBaseRun now returns a run, so the kind is ''. The queue merges,
  // and the base moves out from under the answer on the very next tick.
  state = await gateBase({ sha: SHA, kind: '', enabled: true, ...state }, e.deps);
  assert.equal(state.act, 'done');
  assert.equal(state.measuring, false, 'the base is answered — the hold lifts on its own');

  state = await gateBase({ sha: MOVED, kind: 'absent', enabled: true, ...state }, e.deps);
  assert.equal(state.act, 'start');
  assert.deepEqual(e.started, [SHA, MOVED], 'one gate per merge, and not one session');
  assert.equal(e.stopped.length, 1, 'the first tree went with its run, and only once');
});

/* ------------------------------------------------------------- the kill guard */

await check('nothing is signalled for a tree holding no gate lock', async () => {
  /**
   * The one assertion in this file about the real `stopBaseGate`, and it is the one worth
   * having: a record outlives its child — a run that ended, a daemon up for weeks — and a
   * pid on macOS is a small recycled integer, so an unguarded `process.kill` is a signal
   * sent to whatever holds that number now. The lock is written by `b7e-gate` before it
   * even asks for a slot, and the tree it is keyed by is one this module made, so a match
   * is proof rather than a heuristic. With no lock there must be no signal at all.
   *
   * `process.pid` is deliberately the pid under test: if the guard ever stops holding,
   * this suite kills itself and says so, rather than passing quietly.
   */
  await stopBaseGate({
    runId: 'gate-main-never-started',
    pid: process.pid,
    dir: '/tmp/beadcause-at/a-tree-that-does-not-exist/work',
    scratchRoot: '',
    root: '',
    sha: SHA,
  });
  assert.ok(true, 'it returned, which means it did not signal this process');
});

await check('stopping a record with nothing in it is a no-op, not a throw', async () => {
  // `gateBase` calls `stop` inside a try, but a teardown that throws on an empty record
  // would make every log line about it a lie.
  await stopBaseGate(null);
  await stopBaseGate({ runId: 'x' });
  assert.ok(true);
});

await check('a run the Mac slept through gets exactly one more gate', async () => {
  const e = effects();
  // The first run ends, and says it slept: the sha is handed back rather than spent.
  const done = await gateBase({ sha: SHA, kind: 'slept', enabled: true, inFlight: flight(), tried: [SHA] }, e.deps);
  assert.equal(done.act, 'done');
  assert.ok(!done.tried.includes(SHA), 'the sha is not spent');
  assert.equal(done.measuring, true, 'no P0 in the one-tick gap before the retry starts');
  const retry = await gateBase({ sha: SHA, kind: 'slept', enabled: true, tried: done.tried }, e.deps);
  assert.equal(retry.act, 'start');
  assert.deepEqual(e.started, [SHA]);
  // It sleeps again: the second ending keeps the sha spent, so a nightly sleep cannot loop.
  const done2 = await gateBase({ sha: SHA, kind: 'slept', enabled: true, inFlight: retry.inFlight, tried: retry.tried }, e.deps);
  const third = await gateBase({ sha: SHA, kind: 'slept', enabled: true, tried: done2.tried }, e.deps);
  assert.equal(third.act, 'tried');
  assert.deepEqual(e.started, [SHA], 'two launches in all');
});

await check('a run starved by load timeouts gets exactly one more gate', async () => {
  const e = effects();
  const done = await gateBase({ sha: SHA, kind: 'starved', enabled: true, inFlight: flight(), tried: [SHA] }, e.deps);
  assert.ok(done.tried.includes(`starved:${SHA}`) && !done.tried.includes(SHA));
  const retry = await gateBase({ sha: SHA, kind: 'starved', enabled: true, tried: done.tried }, e.deps);
  assert.equal(retry.act, 'start');
  const done2 = await gateBase({ sha: SHA, kind: 'starved', enabled: true, inFlight: retry.inFlight, tried: retry.tried }, e.deps);
  const third = await gateBase({ sha: SHA, kind: 'starved', enabled: true, tried: done2.tried }, e.deps);
  assert.equal(third.act, 'tried', 'a second starved run files the P0');
  assert.equal(e.started.length, 1 + 0, 'one launch so far');
});

/* --------------------------------------------- a restart in the middle (bc-0lwet) */

/** Scratch trees with sidecars written as `startBaseGate` writes them. */
function treesWith(notes) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'autogate-adopt-'));
  const trees = notes.map((note, i) => {
    const scratchRoot = path.join(base, `tree-${i}`);
    fs.mkdirSync(scratchRoot);
    if (note) fs.writeFileSync(path.join(scratchRoot, BASE_GATE_SIDECAR), JSON.stringify(note));
    return { root: '/repo', dir: path.join(scratchRoot, 'work'), scratchRoot };
  });
  return { trees, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

await check('a restarted daemon takes over the base gate the last one left running', async () => {
  /**
   * The bead. Every merge redeploys the daemon, and the merge also moved the base, so
   * the run in flight is for the OLD sha: findBaseRun never finds it again, nothing
   * cancels it, and a second full gate starts beside it. Adopted, it is an ordinary
   * inFlight run the base moved out from under, and the first tick cancels it.
   */
  const { trees, done } = treesWith([
    { runId: 'main-old', pid: 7001, sha: SHA, base: 'main', key: 'beadcause', at: 1_000_000 },
  ]);
  try {
    const found = adoptBaseGates(
      { root: '/repo', key: 'beadcause', base: 'main' },
      { trees, lockOf: () => ({ pid: 7001 }) }
    );
    assert.deepEqual(found.map((r) => r.runId), ['main-old']);
    assert.equal(found[0].dir, trees[0].dir, 'with the tree it needs to be torn down');

    const e = effects();
    const out = await gateBase(
      { key: 'beadcause', base: 'main', sha: MOVED, kind: 'absent', enabled: true, inFlight: found[0], tried: [SHA] },
      e.deps
    );
    assert.deepEqual(e.stopped.map((s) => s.runId), ['main-old']);
    assert.deepEqual(e.started, [MOVED], 'one full gate afterwards, not two');
    assert.equal(out.inFlight.sha, MOVED);

    // And where the base did NOT move, the adopted run is waited on, not replaced.
    const stay = await gateBase(
      { sha: SHA, kind: 'running', enabled: true, inFlight: found[0], tried: [SHA] },
      effects().deps
    );
    assert.equal(stay.act, 'wait');
  } finally {
    done();
  }
});

await check('only a live gate that this daemon started is adopted', () => {
  // The lock is the same proof stopBaseGate asks for before it signals: a sidecar whose
  // pid no longer holds the tree's lock is a gate that ended (or a recycled pid), and a
  // tree with no sidecar is a session's own `b7e-at`, which is not the daemon's to stop.
  const { trees, done } = treesWith([
    { runId: 'ended', pid: 7001, sha: SHA, base: 'main', key: 'beadcause', at: 1 },
    null,
    { runId: 'other-ws', pid: 7003, sha: SHA, base: 'main', key: 'loremia', at: 3 },
    { runId: 'live', pid: 7004, sha: SHA, base: 'main', key: 'beadcause', at: 4 },
  ]);
  try {
    const locks = { 0: { pid: 9999 }, 1: { pid: 7002 }, 2: { pid: 7003 }, 3: { pid: 7004 } };
    const found = adoptBaseGates(
      { root: '/repo', key: 'beadcause', base: 'main' },
      { trees, lockOf: (dir) => locks[dir.match(/tree-(\d)/)[1]] }
    );
    assert.deepEqual(found.map((r) => r.runId), ['live']);
    const elsewhere = adoptBaseGates({ root: '/another', key: 'beadcause', base: 'main' }, { trees, lockOf: () => ({ pid: 7004 }) });
    assert.deepEqual(elsewhere, [], 'another checkout\'s trees are its own');
  } finally {
    done();
  }
});

await check('two left behind come back newest first', () => {
  const { trees, done } = treesWith([
    { runId: 'older', pid: 1, sha: SHA, base: 'main', key: 'beadcause', at: 10 },
    { runId: 'newer', pid: 2, sha: MOVED, base: 'main', key: 'beadcause', at: 20 },
  ]);
  try {
    const found = adoptBaseGates(
      { root: '/repo', key: 'beadcause', base: 'main' },
      { trees, lockOf: (dir) => ({ pid: dir.includes('tree-0') ? 1 : 2 }) }
    );
    assert.deepEqual(found.map((r) => r.runId), ['newer', 'older']);
  } finally {
    done();
  }
});

/* ------------------------------------- GitHub answers first, locally is the fallback */

await check('a base GitHub is still checking gets no second full sweep beside it', async () => {
  // Both rosters on one Mac made each other take one to two hours (bc-0lwet). Waiting
  // must not spend the sha, or the fallback could never fire once GitHub gives up.
  const remote = { state: 'pending', pending: 1, cancelled: 0 };
  const waitFor = githubStillAnswering(remote, { firstSeen: 1_000, now: 2_000 });
  assert.match(waitFor, /still running/);
  const e = effects();
  const out = await gateBase({ sha: SHA, kind: 'absent', enabled: true, tried: [], waitFor }, e.deps);
  assert.equal(out.act, 'deferred');
  assert.deepEqual(e.started, []);
  assert.deepEqual(out.tried, [], 'the sha is not spent');
  assert.equal(out.measuring, true, 'and no P0 is filed while GitHub is measuring it');

  const later = await gateBase({ sha: SHA, kind: 'absent', enabled: true, tried: out.tried, waitFor: '' }, e.deps);
  assert.equal(later.act, 'start', 'once GitHub stops answering, the local gate starts');
});

await check('waiting on GitHub still cancels a gate the base moved out from under', async () => {
  const e = effects();
  const out = await gateBase(
    { sha: MOVED, kind: 'absent', enabled: true, inFlight: flight(), tried: [SHA], waitFor: 'GitHub is checking' },
    e.deps
  );
  assert.deepEqual(e.stopped.map((s) => s.runId), [flight().runId]);
  assert.equal(out.act, 'deferred');
  assert.equal(out.inFlight, null);
});

await check('GitHub stops counting as an answer when it cannot give one', () => {
  const hour = GITHUB_PENDING_GRACE_MS;
  // Cancelled: nothing will finish it (bc-axipn).
  assert.equal(githubStillAnswering({ state: 'pending', pending: 1, cancelled: 1 }, { firstSeen: 0, now: 1 }), '');
  // Red, or a billing refusal: the local gate is exactly what those are for.
  assert.equal(githubStillAnswering({ state: 'failing' }, { firstSeen: 0, now: 1 }), '');
  // Pending past the job's own limit plus queueing: a runner asleep or gone.
  assert.equal(githubStillAnswering({ state: 'pending', pending: 1, cancelled: 0 }, { firstSeen: 0, now: hour }), '');
  // No checks at all: a moment's grace for the workflow to register, not an hour.
  assert.match(githubStillAnswering({ state: 'none' }, { firstSeen: 0, now: 1 }), /not started/);
  assert.equal(githubStillAnswering({ state: 'none' }, { firstSeen: 0, now: GITHUB_NONE_GRACE_MS }), '');
  // A `gh` call that did not answer is not GitHub measuring anything.
  assert.equal(githubStillAnswering(null), '');
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
