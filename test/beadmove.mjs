#!/usr/bin/env node
/**
 * Moving a bead that already has a parent — and what happens to what is under it.
 *
 *     npm test
 *     node test/beadmove.mjs
 *
 * lib/beadmove.js is the sheet's ⋮ → Move (bc-ka5y.44), and the interesting half of it is
 * not the reparent — `bd update --parent` has done that since bc-rfnr.7. It is the two
 * questions the adopt row never had to ask, because adopt was only ever offered on a bead
 * with nothing above it:
 *
 *   - **what happens to the children**, which has no default that is right twice; and
 *   - **where they go when there is no grandparent**, which is the case that must not be
 *     allowed to answer itself. Dropping them at top level would take every one of them
 *     out of the advocate queue and refuse them at the launcher (lib/underroot.js) — the
 *     app causing the exact hold bc-rfnr.7 exists to clear, through the control built to
 *     clear it. So a stand-in epic is minted, and these are the checks that it is.
 *
 * Two halves. `movePlan`, `moveProblem` and `standInFor` are pure and are asserted
 * directly; `moveBead` is driven against a fake `bd` that records what it was asked to
 * write, because **the order of those writes is the safety** — every write before the
 * last one puts a child somewhere decided, so a crash halfway through cannot orphan
 * anything. No tracker, no spawn: the index these take is `Bd.graph`'s shape, which is
 * two Maps.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const {
  MOVE_LEAVE,
  MOVE_WITH,
  moveBead,
  moveMode,
  movePlan,
  moveProblem,
  standInFor,
} = await import(path.join(HERE, '..', 'lib', 'beadmove.js'));

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${err.message.split('\n')[0]}`);
  }
};
const acheck = async (name, fn) => {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${err.message.split('\n')[0]}`);
  }
};

/**
 * A tracker, as `Bd.graph` describes one: `beads` by id and `parents` child → parent.
 *
 * `rows` is `[id, parent, extra]`. An epic at any priority is a root (`isRoot`), which is
 * how these fixtures get something decided above them without inventing a P0 each time.
 */
const index = (rows) => ({
  beads: new Map(rows.map(([id, , extra]) => [id, { id, status: 'open', priority: 2, ...(extra || {}) }])),
  parents: new Map(rows.filter(([, p]) => p).map(([id, p]) => [id, p])),
});

const EPIC = { issue_type: 'epic' };

/** A root, a bead under it, two children under that, and an unrelated top-level task. */
const tracker = index([
  ['bc-root', '', EPIC],
  ['bc-mid', 'bc-root'],
  ['bc-mid.1', 'bc-mid'],
  ['bc-mid.2', 'bc-mid'],
  ['bc-loose', ''],
  ['bc-other', '', EPIC],
]);

console.log('\nwhich mode was asked for\n');

check('the two the card can send', () => {
  assert.equal(moveMode('with'), MOVE_WITH);
  assert.equal(moveMode('leave'), MOVE_LEAVE);
  assert.equal(moveMode('LEAVE'), MOVE_LEAVE);
});

check('an absent mode is "with", because a caller that never asked has no children', () => {
  // The compatible case: a client written before this question existed, or a bead with
  // nothing under it, and both of those mean "the bead and whatever hangs off it".
  assert.equal(moveMode(''), MOVE_WITH);
  assert.equal(moveMode(undefined), MOVE_WITH);
});

check('and anything else is refused rather than guessed at', () => {
  // Guessing which of the two a typo meant is guessing at somebody's subtree.
  for (const bad of ['keep', 'both', 'w', 'true']) assert.equal(moveMode(bad), null, `${bad} was taken for a mode`);
});

console.log('\nwhat is refused\n');

check('nothing at all, for a destination with a root above it', () => {
  assert.equal(moveProblem(tracker, 'bc-loose', 'bc-mid'), null);
});

check('detaching is never refused', () => {
  // Putting a bead back where nothing decides it is always a legitimate thing to say, and
  // it is how a move into the wrong epic is undone.
  assert.equal(moveProblem(tracker, 'bc-mid', ''), null);
});

check('a bead may not be its own parent', () => {
  assert.equal(moveProblem(tracker, 'bc-mid', 'bc-mid')?.status, 400);
});

check('a destination the tracker has never heard of is a 404', () => {
  const p = moveProblem(tracker, 'bc-mid', 'bc-nope');
  assert.equal(p?.status, 404);
  assert.match(p.message, /bc-nope is not a bead here/);
});

check('a destination under the bead being moved is a loop, and is caught', () => {
  // This control's own hazard rather than adopt's: adopt was only ever offered on a bead
  // with nothing above it, and this one is offered on epics with subtrees under them.
  const p = moveProblem(tracker, 'bc-mid', 'bc-mid.1');
  assert.equal(p?.status, 409);
  assert.equal(p.loop, true);
  assert.match(p.message, /would make a loop/);
});

check('and a deeper one is too, not only a direct child', () => {
  const deep = index([['bc-root', '', EPIC], ['bc-a', 'bc-root'], ['bc-b', 'bc-a'], ['bc-c', 'bc-b']]);
  assert.equal(moveProblem(deep, 'bc-a', 'bc-c')?.loop, true);
});

check('the loop is caught BEFORE the root check, or it is not caught at all', () => {
  // `hasRootAbove('bc-mid.1')` is true — it climbs through the bead being moved to
  // bc-root — so a root check placed first would pass a destination that makes a ring.
  const p = moveProblem(tracker, 'bc-mid', 'bc-mid.1');
  assert.equal(p?.loop, true, 'the root check answered first and let the loop through');
  assert.ok(!p.noRoot, 'the loop was reported as an undecided destination');
});

check('a destination with nothing decided above it is the adopt route’s own refusal', () => {
  const p = moveProblem(tracker, 'bc-mid', 'bc-loose');
  assert.equal(p?.status, 409);
  assert.equal(p.noRoot, true);
  assert.match(p.message, /nothing decided above it/);
});

console.log('\nthe plan\n');

check('"with" is one write and no children move', () => {
  const plan = movePlan({ parent: 'bc-other', mode: MOVE_WITH, current: 'bc-root', children: ['bc-mid.1'] });
  assert.deepEqual(plan.orphans, []);
  assert.equal(plan.mint, null);
  assert.equal(plan.parent, 'bc-other');
});

check('"leave" reparents every direct child to the grandparent first', () => {
  const plan = movePlan({ parent: 'bc-other', mode: MOVE_LEAVE, current: 'bc-root', children: ['bc-mid.1', 'bc-mid.2'] });
  assert.deepEqual(plan.orphans, ['bc-mid.1', 'bc-mid.2']);
  assert.equal(plan.to, 'bc-root');
  assert.equal(plan.mint, null);
});

check('"leave" on a bead with no children is "with", not an empty ceremony', () => {
  const plan = movePlan({ parent: 'bc-other', mode: MOVE_LEAVE, current: 'bc-root', children: [] });
  assert.equal(plan.mode, MOVE_WITH);
  assert.equal(plan.mint, null, 'an epic was minted to leave nothing under');
});

check('"leave" with no grandparent mints one rather than dropping them at top level', () => {
  const plan = movePlan({
    bead: { id: 'bc-loose', title: 'A bead nothing decided' },
    parent: 'bc-other',
    mode: MOVE_LEAVE,
    current: '',
    children: ['bc-k1', 'bc-k2'],
  });
  assert.equal(plan.to, '', 'the children were sent to top level');
  assert.ok(plan.mint, 'nothing was minted to leave them under');
  assert.equal(plan.mint.title, 'What was under A bead nothing decided');
});

check('and a title typed into the card wins over the prefill', () => {
  const plan = movePlan({
    bead: { id: 'bc-loose', title: 'A bead nothing decided' },
    mode: MOVE_LEAVE,
    current: '',
    children: ['bc-k1'],
    standInTitle: 'The picker work',
  });
  assert.equal(plan.mint.title, 'The picker work');
});

console.log('\nthe stand-in\n');

check('it is named after the bead that left', () => {
  assert.equal(standInFor({ id: 'bc-x', title: 'Rewrite the picker' }).title, 'What was under Rewrite the picker');
});

check('a very long title is trimmed rather than pasted whole', () => {
  const { title } = standInFor({ id: 'bc-x', title: 'y'.repeat(300) });
  assert.ok(title.length < 120, `${title.length} characters reached the title`);
  assert.match(title, /…$/);
});

check('a bead with no title at all falls back to its id', () => {
  assert.equal(standInFor({ id: 'bc-x' }).title, 'What was under bc-x');
});

check('its description says what it stands in for, and asks to be dissolved', () => {
  const { description } = standInFor({ id: 'bc-x', title: 'Rewrite the picker' });
  assert.match(description, /bc-x/, 'it does not name the bead that left');
  assert.match(description, /stand-in/i, 'it does not say what it is');
  assert.match(description, /close it/, 'it does not say it may be dissolved');
});

console.log('\nand the writes it actually makes\n');

/**
 * A `bd` that writes nothing and remembers everything, in the order it was asked.
 *
 * `graph` answers the same index twice, which is enough: nothing here asserts on the
 * *second* read except that `workable` came from one.
 */
const fakeBd = (idx, { show = { id: 'bc-mid', title: 'The middle bead' } } = {}) => {
  const log = [];
  return {
    log,
    show: async () => show,
    graph: async () => idx,
    adopt: async (ws, id, parent, opts) => log.push({ act: 'adopt', id, parent, refresh: opts?.refresh !== false }),
    create: async (ws, spec) => {
      log.push({ act: 'create', ...spec });
      return 'bc-new';
    },
  };
};

await acheck('a childless move is one write', async () => {
  const bd = fakeBd(index([['bc-root', '', EPIC], ['bc-mid', 'bc-root'], ['bc-other', '', EPIC]]));
  const out = await moveBead(bd, { name: 'w' }, 'bc-mid', { parent: 'bc-other', mode: MOVE_LEAVE });
  assert.deepEqual(bd.log, [{ act: 'adopt', id: 'bc-mid', parent: 'bc-other', refresh: true }]);
  assert.deepEqual(out.moved, []);
  assert.equal(out.standIn, null);
});

await acheck('"with" leaves the subtree alone — the children are never touched', async () => {
  const bd = fakeBd(tracker);
  await moveBead(bd, { name: 'w' }, 'bc-mid', { parent: 'bc-other', mode: MOVE_WITH });
  assert.equal(bd.log.length, 1, 'a child was written for a move that said "with"');
  assert.equal(bd.log[0].id, 'bc-mid');
});

await acheck('"leave" settles every child under the grandparent BEFORE the bead moves', async () => {
  // The order is the safety: every write before the last one puts a child somewhere
  // decided, so a crash halfway through cannot leave one pointing at a bead that has gone.
  const bd = fakeBd(tracker);
  const out = await moveBead(bd, { name: 'w' }, 'bc-mid', { parent: 'bc-other', mode: MOVE_LEAVE });
  assert.deepEqual(
    bd.log.map((w) => `${w.id}→${w.parent}`),
    ['bc-mid.1→bc-root', 'bc-mid.2→bc-root', 'bc-mid→bc-other']
  );
  assert.deepEqual(out.moved, ['bc-mid.1', 'bc-mid.2']);
  assert.equal(out.left, 'bc-root');
});

await acheck('and only the last of those rebuilds the cached graph', async () => {
  // `Bd.adopt` refreshing is a whole `bd export`; one per child is what turns a six-child
  // move into six of them for one tap.
  const bd = fakeBd(tracker);
  await moveBead(bd, { name: 'w' }, 'bc-mid', { parent: 'bc-other', mode: MOVE_LEAVE });
  assert.deepEqual(bd.log.map((w) => w.refresh), [false, false, true]);
});

await acheck('with no grandparent, the epic is minted first and the children land under it', async () => {
  const idx = index([['bc-loose', ''], ['bc-loose.1', 'bc-loose'], ['bc-other', '', EPIC]]);
  const bd = fakeBd(idx, { show: { id: 'bc-loose', title: 'A bead nothing decided' } });
  const out = await moveBead(bd, { name: 'w' }, 'bc-loose', { parent: 'bc-other', mode: MOVE_LEAVE });
  assert.equal(bd.log[0].act, 'create', 'the children were written before there was anywhere to put them');
  assert.equal(bd.log[0].type, 'epic', 'a task was minted, which is as undecided as the orphaning it replaces');
  assert.deepEqual(
    bd.log.slice(1).map((w) => `${w.id}→${w.parent}`),
    ['bc-loose.1→bc-new', 'bc-loose→bc-other']
  );
  assert.deepEqual(out.standIn, { id: 'bc-new', title: 'What was under A bead nothing decided' });
});

await acheck('and it is minted endorsed, and not as a question', async () => {
  // A person tapped Save on a phone, so nobody is waiting to agree to it — and nobody
  // should be rung about it either.
  const idx = index([['bc-loose', ''], ['bc-loose.1', 'bc-loose'], ['bc-other', '', EPIC]]);
  const bd = fakeBd(idx, { show: { id: 'bc-loose', title: 'x' } });
  await moveBead(bd, { name: 'w' }, 'bc-loose', { parent: 'bc-other', mode: MOVE_LEAVE });
  assert.deepEqual(bd.log[0].labels, [], 'the stand-in was born carrying markers nobody chose');
});

await acheck('no path through it leaves a child with nothing above it', async () => {
  // The acceptance criterion, said as the thing it actually guarantees: whatever the
  // destination, and whichever mode, every child ends under something `hasRootAbove` likes.
  const idx = index([['bc-loose', ''], ['bc-loose.1', 'bc-loose'], ['bc-other', '', EPIC]]);
  for (const parent of ['bc-other', '']) {
    const bd = fakeBd(idx, { show: { id: 'bc-loose', title: 'x' } });
    await moveBead(bd, { name: 'w' }, 'bc-loose', { parent, mode: MOVE_LEAVE });
    const kid = bd.log.find((w) => w.id === 'bc-loose.1');
    assert.ok(kid, `no child write for a move to ${parent || 'top level'}`);
    assert.ok(kid.parent, `the child was detached by a move to ${parent || 'top level'}`);
  }
});

await acheck('a refusal writes nothing at all', async () => {
  const bd = fakeBd(tracker);
  await assert.rejects(
    () => moveBead(bd, { name: 'w' }, 'bc-mid', { parent: 'bc-mid.1', mode: MOVE_LEAVE }),
    /would make a loop/
  );
  assert.deepEqual(bd.log, [], 'a refused move still moved something');
});

await acheck('a bead the tracker does not have is a 404 before anything is written', async () => {
  const bd = fakeBd(tracker);
  bd.show = async () => {
    throw new Error('no issues found matching');
  };
  await assert.rejects(() => moveBead(bd, { name: 'w' }, 'bc-gone', { parent: 'bc-other' }), (e) => e.status === 404);
  assert.deepEqual(bd.log, []);
});

console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
