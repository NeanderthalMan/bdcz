#!/usr/bin/env node
/**
 * Which beads a pull request is for — the tiering, and the dotted child id.
 *
 *     npm test
 *     node test/beadref.mjs
 *
 * lib/beadref.js is the one implementation of "which bead is this PR for", and three
 * things read it: lib/prboard.js decides what the board says a row is about,
 * lib/landed.js decides which bead a merge closes, and lib/release.js decides which bead
 * a deploy labels `shipped`. Until bc-68ou.10 it had no test of its own, which is how a
 * one-character gap in a regex reached all three at once.
 *
 * **The gap was the dot.** `\b bc-[a-z0-9]{2,10} \b` stops at the first `.`, so every
 * child id written in a title resolved to its **parent**: `bc-68ou.6: …` came back as
 * `bc-68ou`, a P0 epic. The `bead:` block a delivery writes captures `\S+` and always
 * kept its dots, so a delivery's own pull request produced both forms *in one tier* —
 * the right bead and the epic above it, indistinguishable to everything downstream.
 *
 * It stayed invisible for as long as nothing acted on the second one. lib/landed.js is
 * saved by a guard much further down (`closeGate` refuses to close an epic on a merge
 * reason); lib/release.js's `homeOf` is saved by coincidence, because the P0 above a
 * child and the P0 above its epic are usually the same bead. Labelling has no such
 * guard, so the first real deploy sweep marked seven P0 epics `shipped` because one
 * child of each had merged. That is what this file is here to stop coming back.
 *
 * No tracker is needed for any of it: `candidateTiers` is pure, and the tiering — which
 * of the four sources wins — is the whole of what matters before `bd` is ever asked.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (f) => path.join(HERE, '..', 'lib', f);

const { beadsFor, candidateTiers } = await import(LIB('beadref.js'));

let ran = 0;
let failures = 0;
const check = (name, fn) => {
  ran += 1;
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n').slice(0, 4).join('\n      ')}`);
  }
};

/** A pull request row in the shape lib/prboard.js hands `candidateTiers`. */
const row = (over = {}) => ({ title: '', branch: '', body: '', ...over });

/** The strongest tier that has anything in it — what `beadsFor` would try first. */
const first = (over) => candidateTiers(row(over), 'bc')[0] || [];

console.log('\nthe dotted child id — bc-68ou.10\n');

check('a child id in a title resolves to the child, never to its parent epic', () => {
  assert.deepEqual(first({ title: 'bc-68ou.6: The deploy sweep labels the work bead' }), ['bc-68ou.6']);
});

check('and the epic is not smuggled in beside it — that is what labelled seven P0s', () => {
  assert.ok(!first({ title: 'bc-68ou.6: something' }).includes('bc-68ou'));
});

check('a delivery that declares its bead agrees with its own title, so the tier is one id', () => {
  // The exact shape of PR #303: `bead:` block and a title prefix naming the same bead.
  // Before the fix this tier was ['bc-68ou.6', 'bc-68ou'] — the answer and the epic.
  assert.deepEqual(
    first({ title: 'bc-68ou.6: The deploy sweep labels the work bead', body: 'bead: bc-68ou.6\n\nprose' }),
    ['bc-68ou.6']
  );
});

check('a suffix nests, because bc-rfnr.9.3 is a real bead on this board', () => {
  assert.deepEqual(first({ title: 'bc-rfnr.9.3: Every card expands when you tap it' }), ['bc-rfnr.9.3']);
});

check('an undotted id is untouched — the ordinary case did not move', () => {
  assert.deepEqual(first({ title: 'bc-kki5: A bead sheet costs one bd spawn, not two' }), ['bc-kki5']);
});

check('two children before the colon are two ids, which is one merge shipping both', () => {
  assert.deepEqual(first({ title: 'bc-68ou.2, bc-68ou.3: two beads, one merge' }), ['bc-68ou.2', 'bc-68ou.3']);
});

check('a claim in the body keeps its dot too — "fixes bc-68ou.6" is not a claim on the epic', () => {
  assert.deepEqual(first({ title: 'no bead here', body: 'fixes bc-68ou.6 and nothing else' }), ['bc-68ou.6']);
});

check('a trailing sentence period is punctuation, not a suffix', () => {
  assert.deepEqual(first({ title: 'a sentence ending in bc-68ou.' }), ['bc-68ou']);
});

console.log('\nthe tiering it already had\n');

check('the `bead:` block outranks everything, and a weaker tier is a separate entry', () => {
  const tiers = candidateTiers(row({ body: 'bead: bc-aaa\n\nfixes bc-bbb' }), 'bc');
  assert.deepEqual(tiers[0], ['bc-aaa']);
  assert.ok(tiers.some((t) => t.includes('bc-bbb')));
});

check('a title that names a second bead does not ride along with the declared one — bc-khoe.30.16', () => {
  // The exact shape of PR #503: `bead: bc-khoe.30.6` and a title reading "Rewrite
  // bc-khoe.4". Before the fix both landed in the same tier, so the merge closed
  // bc-khoe.4 — a bead the PR only mentioned — alongside the one it actually delivered.
  const tiers = candidateTiers(
    row({ title: 'bc-khoe.30.6: Rewrite bc-khoe.4 — Advocates is a pane', body: 'bead: bc-khoe.30.6\n\nprose' }),
    'bc'
  );
  assert.deepEqual(tiers[0], ['bc-khoe.30.6']);
  assert.ok(!tiers[0].includes('bc-khoe.4'));
});

check('with no `bead:` block, a title still resolves exactly as it always did', () => {
  assert.deepEqual(first({ title: 'bc-khoe.30.6: Rewrite bc-khoe.4 — Advocates is a pane' }), [
    'bc-khoe.30.6',
    'bc-khoe.4',
  ]);
});

check('a mention with no verb is not a claim — the three-bead false link stays fixed', () => {
  // The case beadref's header is written about: "nothing was done about bc-2tr / bc-es8,
  // which this unblocks" linked a PR to beads it explicitly had not touched.
  assert.deepEqual(candidateTiers(row({ body: 'nothing was done about bc-2tr / bc-es8, which this unblocks' }), 'bc'), []);
});

check("the branch's own tag is its own tier, below ids that were written out", () => {
  const tiers = candidateTiers(row({ title: 'bc-aaa: x', branch: 'worktree-something-zzz' }), 'bc');
  assert.deepEqual(tiers[0], ['bc-aaa']);
  assert.deepEqual(tiers[1], ['bc-zzz']);
});

check('no prefix, no candidates — a tracker that would not answer guesses nothing', () => {
  assert.deepEqual(candidateTiers(row({ title: 'bc-aaa: x' }), null), []);
});

/**
 * Where the answer comes from — bc-iaju1.10.
 *
 * `resolve` used to spawn one `bd show` per candidate id, and that was the single most
 * expensive thing the daemon did: traced over a real poll cycle it was 145 of 334 `bd`
 * spawns and 326 of 446 seconds of `bd` wall time, from lib/prboard.js (one resolve per
 * pull request per board sweep) and lib/inflight.js (every advocate, every tick, with a
 * fresh memo each time). It now reads `Bd.graph`'s per-workspace index instead — the same
 * `bd export` lib/adoptsweep.js has already taken at the top of the cycle.
 *
 * What these cover is the *safety* half of that, which is the half a suite can hold:
 *
 *   - a hit answers out of the index and spawns nothing,
 *   - a **miss still spawns**, because the index is up to a minute old and answering
 *     "no such bead" for one created inside that minute would drop a tier,
 *   - `live: true` never looks at the index at all — lib/landed.js branches on `status`
 *     and turns the answer into a close,
 *   - and a tracker with no `graph` at all behaves exactly as it did before.
 */
const acheck = async (name, fn) => {
  ran += 1;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n').slice(0, 4).join('\n      ')}`);
  }
};

const WS = { name: 'widgets', dir: '/tmp/widgets' };

/**
 * A tracker stub that counts what it was asked to spawn.
 *
 * `indexed` becomes the `beads` Map of the graph index; `tracked` is what a `bd show`
 * would find. Keeping them separate is the whole point — it is what lets a test say
 * "this id is only in the index" or "this id is only live".
 */
const stub = ({ indexed = null, tracked = {}, graphFails = false } = {}) => {
  const calls = { show: [], graph: 0 };
  const bd = {
    show: async (ws, id) => {
      calls.show.push(id);
      return tracked[id] || null;
    },
  };
  if (indexed || graphFails) {
    bd.graph = async () => {
      calls.graph += 1;
      if (graphFails) throw new Error('bd export timed out');
      return { beads: new Map(Object.entries(indexed)) };
    };
  }
  return { bd, calls };
};

console.log('\nwhere the answer comes from — bc-iaju1.10\n');

await acheck('an id the index knows is answered out of it, with no `bd show` at all', async () => {
  const { bd, calls } = stub({ indexed: { 'bc-aaa': { id: 'bc-aaa', title: 'A thing', status: 'open' } } });
  const found = await beadsFor(bd, WS, 'bc', row({ title: 'bc-aaa: x' }), new Map());
  assert.deepEqual(found, [{ id: 'bc-aaa', title: 'A thing', status: 'open' }]);
  assert.deepEqual(calls.show, []);
});

await acheck('the index is asked once per sweep, not once per row', async () => {
  const { bd, calls } = stub({ indexed: { 'bc-aaa': { id: 'bc-aaa', title: 'A', status: 'open' } } });
  const seen = new Map();
  await beadsFor(bd, WS, 'bc', row({ title: 'bc-aaa: one' }), seen);
  await beadsFor(bd, WS, 'bc', row({ title: 'bc-aaa: two' }), seen);
  assert.equal(calls.graph, 1);
});

await acheck('a bead the index has never heard of still costs a `bd show` — the minute it may be old', async () => {
  // The bead was filed thirty seconds ago; the index is from before it. Answering "no such
  // bead" here would drop the declared tier and let the branch tag win, which is the exact
  // class of mistake the tiering exists to prevent.
  const { bd, calls } = stub({
    indexed: { 'bc-old': { id: 'bc-old', title: 'Old', status: 'closed' } },
    tracked: { 'bc-new': { id: 'bc-new', title: 'Brand new', status: 'open' } },
  });
  const found = await beadsFor(bd, WS, 'bc', row({ title: 'bc-new: x' }), new Map());
  assert.deepEqual(found, [{ id: 'bc-new', title: 'Brand new', status: 'open' }]);
  assert.deepEqual(calls.show, ['bc-new']);
});

await acheck('a candidate that is nowhere falls through to the weaker tier, exactly as before', async () => {
  const { bd } = stub({
    indexed: { 'bc-zzz': { id: 'bc-zzz', title: 'The branch tag', status: 'open' } },
  });
  // `bc-aaa` is in neither the index nor the tracker, so the title tier resolves to
  // nothing and the branch's own tag — a weaker tier — is what the row is about.
  const found = await beadsFor(bd, WS, 'bc', row({ title: 'bc-aaa: x', branch: 'worktree-thing-zzz' }), new Map());
  assert.deepEqual(found, [{ id: 'bc-zzz', title: 'The branch tag', status: 'open' }]);
});

await acheck('`live: true` never reads the index — lib/landed.js closes on `status`', async () => {
  const { bd, calls } = stub({
    // The index still says open; the tracker says closed. A writer must see the tracker.
    indexed: { 'bc-aaa': { id: 'bc-aaa', title: 'A', status: 'open' } },
    tracked: { 'bc-aaa': { id: 'bc-aaa', title: 'A', status: 'closed' } },
  });
  const found = await beadsFor(bd, WS, 'bc', row({ title: 'bc-aaa: x' }), new Map(), { live: true });
  assert.deepEqual(found, [{ id: 'bc-aaa', title: 'A', status: 'closed' }]);
  assert.equal(calls.graph, 0);
  assert.deepEqual(calls.show, ['bc-aaa']);
});

await acheck('a tracker with no `graph` is the path it always had', async () => {
  const { bd, calls } = stub({ tracked: { 'bc-aaa': { id: 'bc-aaa', title: 'A', status: 'open' } } });
  const found = await beadsFor(bd, WS, 'bc', row({ title: 'bc-aaa: x' }), new Map());
  assert.deepEqual(found, [{ id: 'bc-aaa', title: 'A', status: 'open' }]);
  assert.deepEqual(calls.show, ['bc-aaa']);
});

await acheck('an export that failed is a sweep that pays the old price, never a board that does not draw', async () => {
  const { bd, calls } = stub({ graphFails: true, tracked: { 'bc-aaa': { id: 'bc-aaa', title: 'A', status: 'open' } } });
  const found = await beadsFor(bd, WS, 'bc', row({ title: 'bc-aaa: x' }), new Map());
  assert.deepEqual(found, [{ id: 'bc-aaa', title: 'A', status: 'open' }]);
  assert.deepEqual(calls.show, ['bc-aaa']);
});

await acheck('the row handed back is a copy — a caller cannot mutate the shared index', async () => {
  const shared = { id: 'bc-aaa', title: 'A', status: 'open' };
  const { bd } = stub({ indexed: { 'bc-aaa': shared } });
  const [found] = await beadsFor(bd, WS, 'bc', row({ title: 'bc-aaa: x' }), new Map());
  found.status = 'closed';
  assert.equal(shared.status, 'open');
});

console.log(`\n${failures ? `\x1b[31m${failures} of ${ran} failed\x1b[0m` : `\x1b[32mall ${ran} passed\x1b[0m`}\n`);
process.exit(failures ? 1 : 0);
