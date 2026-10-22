#!/usr/bin/env node
//
// b7e-cards — which cards a round bead waits on moved, and what they now say
// (bc-xl7n.202).
//
//   node test/b7e-cards.mjs
//
// lib/cards.js against a fake Bd (the shape is `show` / `showWithComments`), plus the CLI's
// usage paths. The acceptance case is the second check group: a card still `open` that got
// a new human comment after the predecessor closed must read MOVED with that comment.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'b7e-cards.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-cards-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { idsFromDescription, blockingIds, resolveSince, readCard, cardsReport, isAgentAuthor } = await import(
  path.join(ROOT, 'lib', 'cards.js')
);

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${String(err?.message || err).split('\n').join('\n       ')}`);
  }
}

const SINCE = '2026-10-18T12:00:00Z';
const isAgent = isAgentAuthor('beadcause (neo@example.com)');

console.log('\nwhich cards\n');
await check('ids come from the "Cards to act on" block, to the first blank line', () => {
  const d = 'Intro mentions dv-zzz1 in passing.\n\nCards to act on if answered: dv-aaa.1, dv-bbb\n  dv-ccc.2\n\nLater: dv-ddd';
  assert.deepEqual(idsFromDescription(d, 'dv-self'), ['dv-aaa.1', 'dv-bbb', 'dv-ccc.2']);
});
await check('"Read X first" lines count, and the bead itself never does', () => {
  assert.deepEqual(idsFromDescription('Read dv-aaa and dv-self first\n', 'dv-self'), ['dv-aaa']);
});
await check('blocking deps are cards, parent-child edges are not', () => {
  const issue = { dependencies: [{ id: 'dv-x', dependency_type: 'blocks' }, { id: 'dv-p', dependency_type: 'parent-child' }] };
  assert.deepEqual(blockingIds(issue), ['dv-x']);
});

console.log('\nmoved\n');
const card = (over) => ({ id: 'dv-a1x', status: 'open', title: 't', updated_at: '2026-10-18T10:00:00Z', comments: [], ...over });
await check('an open card with a new human comment is MOVED, with that comment', () => {
  const r = readCard('delmar', card({ updated_at: '2026-10-18T09:00:00Z', comments: [{ author: 'adam', created_at: '2026-10-19T08:00:00Z', text: 'keep it' }] }), SINCE, { isAgent });
  assert.equal(r.moved, true);
  assert.equal(r.newestHumanComment.text, 'keep it');
  assert.equal(r.humanCommentIsNew, true);
});
await check('a card untouched since the cut-off is not MOVED', () => {
  assert.equal(readCard('delmar', card({ comments: [{ author: 'adam', created_at: '2026-10-17T00:00:00Z', text: 'old' }] }), SINCE, { isAgent }).moved, false);
});
await check('a newer agent comment moves it but is not reported as a person speaking', () => {
  const r = readCard('delmar', card({ comments: [{ author: 'beadcause (x)', created_at: '2026-10-19T08:00:00Z', text: 'swept' }] }), SINCE, { isAgent });
  assert.equal(r.moved, true);
  assert.equal(r.newestHumanComment, null);
  assert.equal(r.newestComment.author, 'beadcause (x)');
});
await check('with no cut-off nothing is judged MOVED', () => {
  assert.equal(readCard('delmar', card({ updated_at: '2030-01-01T00:00:00Z' }), null, { isAgent }).moved, false);
});

console.log('\nthe report\n');
function fakeBd(beads, { failOn } = {}) {
  return {
    show: async (_ws, id) => beads[id] || null,
    showWithComments: async (_ws, id) => {
      if (id === failOn) throw new Error('database is locked');
      if (!beads[id]) throw new Error(`No issues found matching ${id}`);
      return beads[id];
    },
  };
}
const ws = { name: 'delmar' };
const round = {
  id: 'dv-r',
  description: 'Remainder of dv-prev.\n\nCards to act on if answered: dv-a1x, dv-b2x, dv-c3x, dv-gone',
  dependencies: [],
};
const beads = {
  'dv-r': round,
  'dv-prev': { id: 'dv-prev', closed_at: SINCE },
  'dv-a1x': card({ id: 'dv-a1x', comments: [{ author: 'adam', created_at: '2026-10-19T08:00:00Z', text: 'hold off' }] }),
  'dv-b2x': card({ id: 'dv-b2x' }),
  'dv-c3x': card({ id: 'dv-c3x', status: 'closed', updated_at: '2026-10-19T00:00:00Z' }),
};
await check('since defaults to the predecessor close; the summary counts moved and untouched', async () => {
  const r = await cardsReport(fakeBd(beads), ws, 'dv-r', { isAgent });
  assert.equal(r.since.at, SINCE);
  assert.equal(r.since.from, 'dv-prev');
  assert.equal(r.cards.find((c) => c.id === 'dv-a1x').moved, true);
  assert.equal(r.cards.find((c) => c.id === 'dv-b2x').moved, false);
  assert.equal(r.cards.find((c) => c.id === 'dv-gone').missing, true);
  assert.deepEqual(r.summary, { total: 4, answered: 0, moved: 2, untouched: 1, unread: 1 });
});
await check('a transient bd failure is a tracker error, never "not found"', async () => {
  const r = await cardsReport(fakeBd(beads, { failOn: 'dv-b2x' }), ws, 'dv-r', { isAgent });
  const c = r.cards.find((x) => x.id === 'dv-b2x');
  assert.match(c.error, /locked/);
  assert.equal(c.missing, false);
});
await check('--ids overrides the description', async () => {
  const r = await cardsReport(fakeBd(beads), ws, 'dv-r', { ids: ['dv-b2x'], isAgent });
  assert.deepEqual(r.cards.map((c) => c.id), ['dv-b2x']);
});
await check('an unparseable --since is refused, not ignored', async () => {
  await assert.rejects(resolveSince(fakeBd(beads), ws, round, 'yesterday'), /--since/);
});
await check('no predecessor says so rather than guessing', async () => {
  const r = await resolveSince(fakeBd(beads), ws, { description: 'x', dependencies: [] }, undefined);
  assert.equal(r.at, null);
  assert.match(r.note, /pass --since/);
});

console.log('\nthe CLI\n');
const cli = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
await check('--help prints usage and exits 0', () => {
  const r = cli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage: b7e-cards/);
});
await check('no -b is a usage error (2)', () => {
  assert.equal(cli(['-w', 'x']).status, 2);
});
await check('an unknown workspace is 4', () => {
  assert.equal(cli(['-w', 'no-such-ws', '-b', 'x-1']).status, 4);
});

await cleanupTmp(tmp);
console.log(`\n${ran - failures}/${ran} b7e-cards checks passed`);
process.exit(failures ? 1 : 0);
