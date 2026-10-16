#!/usr/bin/env node
//
// b7e-successor — hand a relay round's remainder to the next round (bc-dgx7.196).
//
//   npm test
//   node test/b7esuccessor.mjs
//
// Driven against a fake `Bd` that keeps an in-memory graph and records every write in
// order: what is under test is which writes happen, in which order, and that nothing is
// written when the command should refuse. The CLI is exercised only for usage, because
// everything it does past argv parsing is lib/successor.js.
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSuccessor, SuccessorError } from '../lib/successor.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'b7e-successor');

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
};

const ws = { name: 'acme' };

/** edges: [from, to, type] — `from` depends on `to`. */
function fakeBd({ beads, edges, failReadback = false, dropFails = false }) {
  const log = [];
  let n = 0;
  const g = { beads: { ...beads }, edges: edges.map((e) => [...e]) };
  const bd = {
    log,
    g,
    async show(_w, id) {
      return g.beads[id] ? { id, ...g.beads[id] } : null;
    },
    async json(_w, args) {
      if (args[0] === 'dep' && args[1] === 'list') {
        return g.edges.filter(([f]) => f === args[2]).map(([, t, type]) => ({ id: t, dependency_type: type }));
      }
      throw new Error(`unexpected json ${args.join(' ')}`);
    },
    async children(_w, parent) {
      return Object.entries(g.beads)
        .filter(([id]) => g.edges.some(([f, t, ty]) => f === id && t === parent && ty === 'parent-child'))
        .map(([id, b]) => ({ id, title: b.title, status: b.status || 'open' }));
    },
    async dependents(_w, id) {
      return g.edges
        .filter(([, t]) => t === id)
        .map(([f, , type]) => ({ id: f, title: g.beads[f]?.title || '', status: g.beads[f]?.status || 'open', dependency_type: type }));
    },
    async create(_w, fields) {
      n += 1;
      const id = `ac-new${n}`;
      log.push(['create', fields]);
      g.beads[id] = { title: fields.title, status: 'open' };
      g.edges.push([id, fields.parent, 'parent-child']);
      return id;
    },
    async run(_w, args) {
      log.push(['run', ...args]);
      return '';
    },
    async addDep(_w, a, b) {
      log.push(['add', a, b]);
      if (failReadback && a !== 'ac-new1') return;
      g.edges.push([a, b, 'blocks']);
    },
    async dropDep(_w, a, b) {
      log.push(['drop', a, b]);
      if (dropFails) return;
      g.edges = g.edges.filter(([f, t]) => !(f === a && t === b));
    },
  };
  return bd;
}

const world = () => ({
  beads: {
    'ac-p': { title: 'parent epic' },
    'ac-r3': { title: 'round 3', priority: 1, issue_type: 'task', parent: 'ac-p' },
    'ac-gate': { title: 'the gate' },
    'ac-other': { title: 'another waiter' },
    'ac-done': { title: 'a closed waiter', status: 'closed' },
  },
  edges: [
    ['ac-r3', 'ac-p', 'parent-child'],
    ['ac-gate', 'ac-r3', 'blocks'],
    ['ac-other', 'ac-r3', 'blocks'],
    ['ac-done', 'ac-r3', 'blocks'],
    ['ac-spawned', 'ac-r3', 'discovered-from'],
  ],
});

await check('files one sibling, chains it, moves every open waiter, and reads back', async () => {
  const bd = fakeBd(world());
  const r = await makeSuccessor(bd, ws, { finished: 'ac-r3', title: 'round 4', body: 'a; b "c"' });
  assert.equal(r.id, 'ac-new1');
  assert.equal(r.parent, 'ac-p');
  assert.ok(r.ok && r.chained);
  const created = bd.log.filter((l) => l[0] === 'create');
  assert.equal(created.length, 1, 'exactly one bead filed');
  assert.deepEqual(created[0][1].labels, [], 'born with no labels of its own to inherit into');
  assert.equal(created[0][1].parent, 'ac-p');
  assert.equal(created[0][1].priority, 1, 'priority carried from the finished round');
  assert.equal(created[0][1].body, 'a; b "c"');
  assert.deepEqual(r.moved.map((m) => m.blocker).sort(), ['ac-gate', 'ac-other'], 'closed and discovered-from edges are not moved');
  assert.ok(bd.g.edges.some((e) => e[0] === 'ac-new1' && e[1] === 'ac-r3'), 'new depends on old');
  assert.ok(!bd.g.edges.some((e) => e[0] === 'ac-gate' && e[1] === 'ac-r3'), 'gate no longer waits on old');
  assert.ok(bd.g.edges.some((e) => e[0] === 'ac-gate' && e[1] === 'ac-new1'), 'gate waits on new');
  assert.ok(bd.g.edges.some((e) => e[0] === 'ac-done' && e[1] === 'ac-r3'), 'a closed waiter is left alone');
});

await check('the chain edge is written before any blocker is moved', async () => {
  const bd = fakeBd(world());
  await makeSuccessor(bd, ws, { finished: 'ac-r3', title: 'round 4' });
  const order = bd.log.map((l) => l.join(' '));
  const chain = order.indexOf('add ac-new1 ac-r3');
  const firstDrop = order.findIndex((l) => l.startsWith('drop'));
  assert.ok(chain > -1 && chain < firstDrop, order.join(' | '));
});

await check('--move-blocker moves exactly the named beads', async () => {
  const bd = fakeBd(world());
  const r = await makeSuccessor(bd, ws, { finished: 'ac-r3', title: 'round 4', moveBlockers: ['ac-gate'] });
  assert.deepEqual(r.moved.map((m) => m.blocker), ['ac-gate']);
  assert.ok(bd.g.edges.some((e) => e[0] === 'ac-other' && e[1] === 'ac-r3'), 'the one not named stays put');
});

await check('a named blocker that never waited on the old round is added without a drop', async () => {
  const w = world();
  w.beads['ac-fresh'] = { title: 'fresh' };
  const bd = fakeBd(w);
  const r = await makeSuccessor(bd, ws, { finished: 'ac-r3', title: 'round 4', moveBlockers: ['ac-fresh'] });
  assert.ok(r.ok);
  assert.equal(bd.log.filter((l) => l[0] === 'drop').length, 0);
});

await check('a readback that disagrees is reported, not ok', async () => {
  const bd = fakeBd({ ...world(), failReadback: true });
  const r = await makeSuccessor(bd, ws, { finished: 'ac-r3', title: 'round 4' });
  assert.equal(r.ok, false);
  assert.ok(r.moved.every((m) => !m.ok));
});

await check('a drop that did not take is a disagreement too', async () => {
  const bd = fakeBd({ ...world(), dropFails: true });
  const r = await makeSuccessor(bd, ws, { finished: 'ac-r3', title: 'round 4' });
  assert.equal(r.ok, false);
});

await check('--assignee is a separate update on the new bead', async () => {
  const bd = fakeBd(world());
  await makeSuccessor(bd, ws, { finished: 'ac-r3', title: 'round 4', assignee: 'designer' });
  assert.ok(bd.log.some((l) => l[0] === 'run' && l.includes('--assignee') && l.includes('designer') && l.includes('ac-new1')));
});

await check('a rerun with the same title refuses before writing anything', async () => {
  const bd = fakeBd(world());
  await makeSuccessor(bd, ws, { finished: 'ac-r3', title: 'Round 4' });
  const before = bd.log.length;
  await assert.rejects(
    () => makeSuccessor(bd, ws, { finished: 'ac-r3', title: '  round   4 ' }),
    (e) => e instanceof SuccessorError && e.code === 5 && /ac-new1/.test(e.message)
  );
  assert.equal(bd.log.length, before, 'no write on the refused rerun');
});

await check('a finished bead with no parent is refused with code 3', async () => {
  const w = world();
  delete w.beads['ac-r3'].parent;
  w.edges = w.edges.filter((e) => e[2] !== 'parent-child');
  const bd = fakeBd(w);
  await assert.rejects(() => makeSuccessor(bd, ws, { finished: 'ac-r3', title: 'x' }), (e) => e.code === 3);
  assert.equal(bd.log.length, 0);
});

await check('an unknown finished bead is code 4 and a missing title code 2', async () => {
  const bd = fakeBd(world());
  await assert.rejects(() => makeSuccessor(bd, ws, { finished: 'ac-nope', title: 'x' }), (e) => e.code === 4);
  await assert.rejects(() => makeSuccessor(bd, ws, { finished: 'ac-r3', title: ' ' }), (e) => e.code === 2);
});

await check('the CLI prints usage for --help and exits 2 without the required flags', () => {
  const help = spawnSync('node', [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--move-blocker/);
  const bare = spawnSync('node', [BIN, '-w', 'x'], { encoding: 'utf8' });
  assert.equal(bare.status, 2);
  assert.match(bare.stdout + bare.stderr, /usage: b7e-successor/);
});

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
