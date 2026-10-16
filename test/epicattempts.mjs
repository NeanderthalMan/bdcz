/**
 * An epic is never retired by `maxAttemptsPerBead` — bc-y683b.
 *
 * The cap is a per-*bead* retirement: two windows died on this bead, stop spending windows
 * on it, and the rest of the queue carries on. That arithmetic is true of a leaf and false
 * of an epic, because the survey holds an epic's ready children *behind* it — `foldedInto`
 * for a batch or a planner, `plannedInto` for a group. Retire the one row and every bead
 * held behind it goes too, and nothing anywhere says so: they are not in `givenUp`, which
 * reads the queue and they were taken out of it, and the card draws them as "batched under
 * x-1", which is a sentence about a window that will never open.
 *
 * **Both fallbacks meant to survive a spent epic were dead code before this.**
 * `batchesFor` hands an epic at the cap a *batch* instead of a planner, on the stated
 * reasoning that "a window that will not open again must not be the reason its children are
 * held forever"; `plansFor` dispatches a stale plan's groups rather than re-planning. Both
 * end in a queue row that `candidates` then dropped on the attempt counter, so neither
 * could ever have dispatched anything. loremia lm-5i2, lm-gr6 and lm-b5d were retired on
 * 2026-08-24 and that workspace read as healthy for 27 days — until the loose ready beads
 * either side of them drained and there was nothing left for it to open a window on.
 *
 * Epics are also the most exposed to the charge in the first place: an epic window that
 * parks because it is waiting on Adam is a *normal* epic ending, and every ending that is
 * not one of `reconcile`'s four costs an attempt.
 *
 * Seven claims:
 *
 *   - **an epic at the cap is dispatched**, as the batch its own fallback promises;
 *   - **and a planned one dispatches its groups**, which is the measurement behind saying
 *     that `canPlan` — the gate this bead's body names — was never the freeze;
 *   - **and so is a group lead at the cap**, which strands a group for the same reason on
 *     a smaller scale — one predicate covers both, so the two cannot drift apart;
 *   - **and a leaf at the cap is still retired**, which is the cap doing its job and the
 *     half of it that was never wrong;
 *   - **and it is not reported as given up on**, in either half of that list, because
 *     "nothing here will open another" is now false of it;
 *   - **and the tick says out loud that it is past the cap**, naming the subtree that
 *     retiring it would have stopped — the line that would have found the loremia three on
 *     the day they were charged;
 *   - **and says it once per spell**, not once every thirty seconds until somebody presses
 *     `Forget attempts`.
 *
 *     node test/epicattempts.mjs
 *
 * Built on test/epicplan.mjs's harness: `open` and `openPlan` are both injected, so a
 * batch, a planner and a group lead are three distinguishable outcomes rather than one
 * "a window happened". The attempt counters are seeded into the `advocates.json` the
 * record is built from, which is the file the daemon persists its own into — and the one
 * bc-xl7n.111 was diagnosed by reading, by hand.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quiesce, removeTree } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load, and
// the daemon's own advocates.json is not this suite's to read or to write.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-epicattempts-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const SESSIONS = path.join(tmp, 'claude-sessions');
const REPO = path.join(tmp, 'projects', 'alpha');
fs.mkdirSync(SESSIONS, { recursive: true });
fs.mkdirSync(REPO, { recursive: true });

const { createAdvocates } = await import(LIB('advocate.js'));
const { formatPlan, PLANNED_LABEL, validatePlan } = await import(LIB('plan.js'));

/* ------------------------------------------------------------------ fixtures */

const OLD = '2020-01-01T00:00:00Z';
const bead = (id, over = {}) => ({ id, title: id, priority: 2, issue_type: 'task', created_at: OLD, labels: [], ...over });
const epic = (id, over = {}) => bead(id, { issue_type: 'epic', ...over });
const group = (name, beads) => ({
  name,
  beads,
  prs: [{ repo: 'alpha', title: `${name} pr` }],
  prompt: `Do ${beads.join(' and ')} as one change.`,
});

/**
 * One advocate, and a `run()` that ticks it as many times as the case needs.
 *
 * Two ticks rather than one is what the once-per-spell claim is about, and it has to be
 * two ticks of the *same* advocate: `record` runs at boot and on `enable`, never on a
 * tick, so a harness that rebuilt the advocates between ticks would re-say every line by
 * construction and prove nothing.
 *
 * `logs` is `console.log` for the duration, because the line under test is a log line —
 * there is no card field for it, deliberately: nothing is being held, so there is no
 * `heldBy*` list and no `QUEUE_HOLDS` row. What reaches a surface is the tick note, which
 * is asserted off the card beside it.
 */
async function advocate({ ready = [], children = {}, comments = {}, attempts = {}, rows = [], parents = [], overrides = {} } = {}) {
  const dir = process.env.BEADCAUSE_CONFIG_DIR;
  // `quiesce` + `removeTree` rather than a bare recursive `rmSync`: every write of
  // `advocates.json` schedules a common-repo commit 2000ms out whose `git init` lands in
  // `CONFIG_DIR`, and rmdir on a directory that gained a file since it was read is
  // ENOTEMPTY. test/tmpadoption.mjs fails the repo for the bare form (bc-9d37.9).
  await quiesce();
  for (const f of fs.readdirSync(dir)) await removeTree(path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'advocates.json'), JSON.stringify({ alpha: { workers: [], attempts } }));

  const cfg = {
    projectRoot: path.join(tmp, 'projects'),
    fallbackWorkspace: 'other',
    claudeSessionsDir: SESSIONS,
    spaces: [],
    workspaces: [{ name: 'alpha', dir: path.join(os.homedir(), 'beads', 'alpha', '.beads') }],
    advocates: {
      enabled: true,
      workspaces: '*',
      maxWorkers: 5,
      maxWorkersLimit: 5,
      settleSeconds: 0,
      launchCooldownSeconds: 0,
      // Features with their own suites, each of which would otherwise run real git, a real
      // `gh` or a real agent against a temp directory on every case here. `flagFinishedEpics`
      // is off for test/epicplan.mjs's reason: this fake `bd.ready` hands back every epic a
      // case seeds, and that sweep would call `bd.children` on all of them first.
      propose: false,
      sessionLog: false,
      tidyWorktrees: false,
      respectQuietHours: false,
      reconcileLanded: false,
      askSuperseded: false,
      flagInMain: false,
      flagFinishedEpics: false,
      ...overrides,
    },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));

  const opened = [];
  const planned = [];
  const logs = [];
  const bd = {
    ready: async () => ready,
    listLabel: async () => [],
    listStatus: async () => [],
    // reconcile() finishes any worker whose bead it cannot find, which would empty a
    // fixture's seeded workers on the first tick — see the advocate-tick-fixtures note.
    show: async (_ws, id) => ({ id, title: id, status: 'open' }),
    children: async (_ws, id) => children[id] || [],
    comments: async (_ws, id) => comments[id] || [],
    create: async () => 'new-1',
    addLabel: async () => {},
    // The tick's shared export. `rows` is what the tracker says about beads the queue
    // cannot see — which is the whole of the claimed half of `givenUp`, and the only place
    // an epic's *type* is legible to it (`issue_type`, not `type`).
    graph: async () => ({
      // Child id → parent id, the shape `bd update --parent` leaves behind. Empty for every
      // case that hands back no `rows` either: an empty index is "cannot tell", and the
      // orphan filter fails open on it. A case that seeds *any* row has to seed all of them
      // and the edges between them — see the note on `rows` below.
      parents: new Map(parents),
      beads: new Map(rows.map((b) => [b.id, { title: b.id, status: 'open', assignee: '', labels: [], ...b }])),
      adopts: new Map(),
      edges: new Map(),
    }),
  };

  const advocates = createAdvocates(cfg, {
    bd,
    bus: { emit() {} },
    open: async (_cfg, _ws, b) => {
      opened.push({
        id: b.id,
        batch: (b.batch || []).map((k) => k.id),
        group: b.group ? { epic: b.group.epic, with: b.group.beads.map((k) => k.id) } : null,
      });
      return { dir: REPO, mode: 'test', term: null };
    },
    openPlan: async (_cfg, _ws, b, opts = {}) => {
      planned.push({ id: b.id, kids: (opts.kids || []).map((k) => k.id) });
      return { dir: REPO, mode: 'test', term: null };
    },
  });

  const run = async () => {
    const real = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      await advocates.tick();
    } finally {
      console.log = real;
    }
    return advocates.snapshot().find((a) => a.workspace === 'alpha');
  };
  return { run, opened, planned, logs };
}

/** One tick, for the cases that need only one. */
async function tick(spec) {
  const a = await advocate(spec);
  const card = await a.run();
  return { ...a, card };
}

const openedIds = (r) => r.opened.map((o) => o.id).sort();
const heldWhy = (card, id) => (card.heldByChildren.find((h) => h.id === id) || {}).why || '';
const carriedLines = (logs) => logs.filter((l) => /maxAttemptsPerBead is/.test(l));

/* ------------------------------------------------------------------- harness */

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err && err.message ? err.message : String(err)).split('\n').join('\n       ')}`);
  }
}

/* ------------------------------------------------------------------ the cases */

/**
 * The incident, in the smallest queue that can hold it. Two windows died on the epic, so
 * `batchesFor` takes its documented fallback and hands it a batch rather than a planner —
 * and before bc-y683b `candidates` then dropped that row on the counter, leaving the epic
 * unopened and both of its children held behind a window that was never going to exist.
 */
await check('an epic at the cap is dispatched, and its children are not stranded', async () => {
  const r = await tick({
    ready: [epic('x-1', { priority: 1 }), bead('x-1.1'), bead('x-1.2')],
    children: { 'x-1': [bead('x-1.1'), bead('x-1.2')] },
    attempts: { 'x-1': 2 },
  });

  assert.deepEqual(openedIds(r), ['x-1'], 'the epic takes its window at 2 attempts of 2');
  assert.deepEqual(r.opened[0].batch, ['x-1.1', 'x-1.2'], 'as the batch its own fallback promises');
  assert.deepEqual(r.planned, [], 'not a planner — the cap still decides plan-versus-batch');
  assert.match(heldWhy(r.card, 'x-1.1'), /batched under x-1/, heldWhy(r.card, 'x-1.1'));
});

/** The control: one attempt short, and the cap decides nothing except which brief it gets. */
await check('an epic under the cap still plans, exactly as it did', async () => {
  const r = await tick({
    ready: [epic('x-1', { priority: 1 }), bead('x-1.1'), bead('x-1.2')],
    children: { 'x-1': [bead('x-1.1'), bead('x-1.2')] },
    attempts: { 'x-1': 1 },
  });

  assert.deepEqual(openedIds(r), [], 'no worker window');
  assert.deepEqual(r.planned.map((p) => p.id), ['x-1'], 'a planner, which is the unspent path');
  assert.deepEqual(r.planned[0].kids, ['x-1.1', 'x-1.2'], 'over all of them, uncapped');
});

/**
 * And the claim that says which gate was actually broken, measured rather than argued.
 *
 * bc-y683b's body names `canPlan` in `plansFor` as the freeze. It is not: at the cap that
 * branch is simply not taken, the groups a stale plan already names are dispatched, and a
 * bead no group names goes out as ordinary work. Same shape as `batchesFor`'s gate — both
 * decide *which brief* a spent epic gets, and both leave the subtree moving. The freeze
 * was one line later, in `candidates`, which is why neither of those gates was touched:
 * removing `canPlan` would arm an unbounded re-planning loop that holds the whole subtree
 * in `awaiting` while it runs, which is strictly worse than the batch it falls back to.
 */
await check('a planned epic at the cap dispatches its groups rather than re-planning', async () => {
  const plan = validatePlan({ groups: [group('router', ['x-1.1', 'x-1.2'])] }, { epic: 'x-1', children: null });
  const r = await tick({
    // x-1.3 is ready and in no group, which is the event a re-entry exists for. At the cap
    // the planner is not opened for it — it takes an ordinary window of its own instead.
    ready: [epic('x-1', { priority: 1, labels: [PLANNED_LABEL] }), bead('x-1.1'), bead('x-1.2'), bead('x-1.3')],
    comments: { 'x-1': [{ text: formatPlan(plan) }] },
    attempts: { 'x-1': 2 },
  });

  assert.deepEqual(r.planned, [], 'no planner — that gate is untouched and still bites');
  assert.deepEqual(openedIds(r), ['x-1.1', 'x-1.3'], 'the group lead, and the ungrouped bead on its own');
  assert.match(heldWhy(r.card, 'x-1.2'), /grouped under x-1\.1/, heldWhy(r.card, 'x-1.2'));
});

/**
 * A group lead strands its group for the same reason and by a different route — `plansFor`
 * holds every other bead of a group in `plannedInto` behind whichever of them is in front.
 * One predicate covers both, which is what stops the two answers drifting apart.
 */
await check('a group lead at the cap is carried too, and its group moves', async () => {
  const plan = validatePlan({ groups: [group('router', ['x-1.1', 'x-1.2'])] }, { epic: 'x-1', children: null });
  const r = await tick({
    ready: [epic('x-1', { priority: 1, labels: [PLANNED_LABEL] }), bead('x-1.1'), bead('x-1.2')],
    comments: { 'x-1': [{ text: formatPlan(plan) }] },
    attempts: { 'x-1.1': 2 },
  });

  assert.deepEqual(openedIds(r), ['x-1.1'], 'the lead opens although it is spent');
  assert.deepEqual(r.opened[0].group.with, ['x-1.2'], 'with the rest of its group in the brief');
  assert.match(heldWhy(r.card, 'x-1.2'), /grouped under x-1\.1/, heldWhy(r.card, 'x-1.2'));
});

/**
 * And the half of the cap that was never wrong. A leaf holds nothing behind it, so
 * retiring it costs exactly the one bead the counter was charged to — which is the whole
 * of what `maxAttemptsPerBead` was for.
 */
await check('a plain task at the cap is still retired, and still reported', async () => {
  const r = await tick({ ready: [bead('x-2')], attempts: { 'x-2': 2 } });

  assert.deepEqual(openedIds(r), [], '2 < 2 is false, and stays false');
  assert.deepEqual((r.card.givenUp || []).map((g) => g.id), ['x-2'], 'and it is named');
  assert.match(r.card.note, /1 given up on after 2 attempt\(s\) \(x-2\)/, r.card.note);
});

/**
 * The list says "nothing here will open another", and on a tick that is opening one that
 * sentence is simply false. Both halves of `givenUp` — the ready rows and the counters
 * walked for claimed beads, which have only the export's `issue_type` to go on.
 */
await check('an epic past the cap is not reported as given up on, claimed or ready', async () => {
  const r = await tick({
    ready: [epic('x-1', { priority: 1 }), bead('x-1.1'), bead('x-1.2')],
    children: { 'x-1': [bead('x-1.1'), bead('x-1.2')] },
    attempts: { 'x-1': 2, 'x-3': 2 },
    // `x-3` is not in the queue at all, claimed, and spent: the population bc-xl7n.117
    // added, and the one a delivery lands in. An epic there is re-armed by being unclaimed.
    //
    // **And the queue's own three rows have to be in here beside it**, which every other
    // case in this file gets away with omitting. An empty graph index is "cannot tell" and
    // holds nothing back; a graph with *one* row in it answers `rootsOf` — and then x-1 is
    // under no root, `withoutOrphans` takes all three out, and this case passes over an
    // empty queue without ever reaching the list it is about. See the note in
    // test/reenter.mjs on seeding a ready queue.
    rows: [
      { id: 'x-1', issue_type: 'epic', priority: 1 },
      { id: 'x-1.1' },
      { id: 'x-1.2' },
      { id: 'x-3', issue_type: 'epic', status: 'in_progress' },
    ],
    // And the edges, because `hasRootAbove` goes through `underAnyOf`, which has no
    // id-splitting fallback: x-1 is a root by being an epic and is above itself, but
    // x-1.1 and x-1.2 are under nothing the graph can see without these.
    parents: [['x-1.1', 'x-1'], ['x-1.2', 'x-1']],
  });

  // The vacuity guard. An orphan filter that ate all three would leave an empty queue and
  // an empty `givenUp` beside it, and this case would pass having tested nothing.
  assert.equal(r.card.queue, 1, 'the epic is in the queue; its two children are folded into its batch');
  assert.match(heldWhy(r.card, 'x-1.1'), /batched under x-1/, heldWhy(r.card, 'x-1.1'));

  assert.deepEqual((r.card.givenUp || []).map((g) => g.id), [], 'neither of them');
  assert.doesNotMatch(r.card.note, /given up on/, r.card.note);
});

/**
 * And what is said instead. "bc-x is past the cap" is not a diagnosis; the number of ready
 * beads that retiring it would have taken with it is, and it is the sentence that would
 * have found the loremia three on the day they were charged rather than 27 days later.
 */
await check('the tick says it is past the cap, and names the subtree it would have stopped', async () => {
  const r = await tick({
    ready: [epic('x-1', { priority: 1 }), bead('x-1.1'), bead('x-1.2')],
    children: { 'x-1': [bead('x-1.1'), bead('x-1.2')] },
    attempts: { 'x-1': 2 },
  });

  const said = carriedLines(r.logs);
  assert.equal(said.length, 1, `one line, naming the epic — ${JSON.stringify(r.logs)}`);
  assert.match(said[0], /x-1 has spent 2 window\(s\)/, said[0]);
  assert.match(said[0], /would stop 2 ready bead\(s\) under it/, said[0]);
  assert.match(r.card.note, /1 epic\(s\) past the cap, dispatched anyway \(x-1\)/, r.card.note);
});

/**
 * Once per spell, on `heldByUndecided`'s idiom: an epic past the cap stays past it until
 * somebody presses `Forget attempts`, and a line every thirty seconds until then is a line
 * nobody reads — which is the failure mode this whole bead is about, one level up.
 */
await check('and says it once, not once every tick', async () => {
  const a = await advocate({
    ready: [epic('x-1', { priority: 1 }), bead('x-1.1'), bead('x-1.2')],
    children: { 'x-1': [bead('x-1.1'), bead('x-1.2')] },
    attempts: { 'x-1': 2 },
  });
  await a.run();
  assert.equal(carriedLines(a.logs).length, 1, 'said on the first tick');
  const card = await a.run();
  assert.equal(carriedLines(a.logs).length, 1, `and not again — ${JSON.stringify(carriedLines(a.logs))}`);
  // Still true of the card, though: what is rationed is the log, not the state.
  assert.match(card.note, /1 epic\(s\) past the cap/, card.note);
});

/* ---------------------------------------------------------------------- out */

await quiesce();
console.log(`\n${ran - failures}/${ran} checks passed`);
process.exit(failures ? 1 : 0);
