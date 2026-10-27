#!/usr/bin/env node
//
// The weekly memory curator (lib/curator.js, bc-u1ltu.5).
//
//   npm test
//   node test/curator.mjs
//
// What has to hold:
//
// 1. **The archive policy is bc-ltgld's, exactly.** Evidence-stale notes go on sight. An
//    unused note goes only when it is older than sixty days *and* the read log reaches back
//    that far, at most fifty a run, oldest first. Before the log is old enough an unused note
//    is held back, because "nobody read it" may only mean "nobody was counting".
// 2. **Nothing the model writes reaches the store unchecked.** A merge that does not merge,
//    a note over the cap or with no evidence, a key it was not given, a key that collides
//    with a live note: each is dropped with a reason, and the rest still applies.
// 3. **Every merge or split is one commit**, and the ref's history still has what it replaced.
// 4. **Once a week, and never twice for the same promotion.** The ledger is what says so,
//    and it is a ref, so a restart changes nothing.
//
// Throwaway git repos and a temp BEADCAUSE_CONFIG_DIR. The model and the tracker are fakes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const store = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-curator-'));
process.env.BEADCAUSE_CONFIG_DIR = store;
process.on('exit', () => removeTreeSync(store));

const curator = await import('../lib/curator.js');
const memory = await import('../lib/memory.js');
const { recordRead } = await import('../lib/memoryuse.js');
const { mainCheckout } = await import('../lib/gitref.js');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}\n      ${detail}`);
  }
};

const DAY = 86400000;
const NOW = Date.parse('2026-12-01T00:00:00Z');

/* ------------------------------------------------------------- the planners */

console.log('planning');

{
  const index = Object.fromEntries(
    ['sw-cache-a', 'sw-cache-b', 'sw-cache-c', 'sw-cache-d', 'sw-cache-e', 'b7e-gate-a', 'b7e-gate-b', 'tests'].map((k) => [k, { bytes: 100 }])
  );
  index.tests.bytes = 5000;
  const clusters = curator.prefixClusters(index);
  check('five keys sharing their first two words are a cluster, two are not', clusters.length === 1 && clusters[0].prefix === 'sw-cache' && clusters[0].keys.length === 5, JSON.stringify(clusters));
  check('a one-word key belongs to no cluster', !clusters.some((c) => c.keys.includes('tests')));
  check('a note over the cap is oversized', JSON.stringify(curator.oversizedNotes(index)) === '[{"key":"tests","bytes":5000}]');
}

{
  const old = new Date(NOW - 90 * DAY).toISOString();
  const older = new Date(NOW - 120 * DAY).toISOString();
  const young = new Date(NOW - 10 * DAY).toISOString();
  const index = { ev: { at: young }, u1: { at: old }, u2: { at: older }, u3: { at: young } };
  const stale = [
    { key: 'ev', reasons: ['cites paths gone at HEAD: lib/x.js'], evidence: true, unused: false },
    { key: 'u1', reasons: ['no read, verify or rewrite in 60 days'], evidence: false, unused: true },
    { key: 'u2', reasons: ['no read, verify or rewrite in 60 days'], evidence: false, unused: true },
    { key: 'u3', reasons: ['no read, verify or rewrite in 60 days'], evidence: false, unused: true },
  ];
  const early = curator.archivePlan(stale, index, { now: NOW, logSince: NOW - 30 * DAY });
  check(
    'with a read log younger than the window, only the evidence-stale note is archived',
    early.moves.length === 1 && early.moves[0].key === 'ev' && /lib\/x\.js/.test(early.moves[0].reason) && early.unusedHeld === 3,
    JSON.stringify(early)
  );
  const covered = curator.archivePlan(stale, index, { now: NOW, logSince: NOW - 100 * DAY, max: 1 });
  check(
    'with the log old enough, unused notes past sixty days go too, oldest first, capped',
    JSON.stringify(covered.moves.map((m) => m.key)) === '["ev","u2"]' && covered.unusedHeld === 1,
    JSON.stringify(covered)
  );
  check('and a note written ten days ago is never archived as unused', !covered.moves.some((m) => m.key === 'u3'));
  check('no read log at all holds every unused note back', curator.archivePlan(stale, index, { now: NOW, logSince: null }).moves.length === 1);
}

{
  const index = { a: {}, b: {}, c: {}, gone: {} };
  const reads = new Map([['a', 30], ['b', 90], ['c', 24], ['archived-already', 99]]);
  const plan = curator.promotionPlan(reads, index, { filed: [] });
  check('notes read 25 times or more are promoted, most-read first', JSON.stringify(plan.map((p) => p.key)) === '["b","a"]', JSON.stringify(plan));
  check('and one already filed is not filed again', curator.promotionPlan(reads, index, { filed: ['b'] }).map((p) => p.key).join() === 'a');
  const bead = curator.promotionBead({ agent: 'worker', key: 'b', reads: 90, entry: { value: 'the rule', evidence: 'test/x.mjs' } });
  check(
    'a promotion bead names the note, the count, the rule and how to retire it',
    /read 90 times/.test(bead.title) && /the rule/.test(bead.description) && /note --archive=b/.test(bead.description) && bead.labels.includes(curator.PROMOTE_LABEL),
    JSON.stringify(bead)
  );
}

/* ---------------------------------------------------- what the model may write */

console.log('\nchecking the model');

{
  const tasks = [
    { id: 'merge:worker/sw-cache', kind: 'merge', agent: 'worker', notes: { 'sw-cache-a': {}, 'sw-cache-b': {}, 'sw-cache-c': {} } },
    { id: 'split:worker/tests', kind: 'split', agent: 'worker', notes: { tests: {} } },
  ];
  const live = { worker: new Set(['sw-cache-a', 'sw-cache-b', 'sw-cache-c', 'tests', 'unrelated']) };
  const text = `Here is my answer.

\`\`\`curate
ops:
  - replaces: [sw-cache-a, sw-cache-b, sw-cache-c]
    notes:
      - key: sw-cache
        kind: gotcha
        evidence: test/pagealias.mjs
        value: Bump the cache when the shell changes.
  - replaces: [tests]
    notes:
      - key: tests-run-in-batches
        evidence: scripts/test.mjs
        value: ok
      - key: unrelated
        evidence: e
        value: collides
  - replaces: [tests]
    notes:
      - key: tests-two
        value: no evidence
  - replaces: [not-given]
    notes:
      - key: x
        evidence: e
        value: y
\`\`\`
`;
  const { ops, error } = curator.extractCuration(text);
  check('the curate block is read', !error && ops.length === 4, error || JSON.stringify(ops));
  const { good, dropped } = curator.checkCuration(ops, tasks, live);
  check('a real merge passes', good.length === 1 && good[0].task === 'merge:worker/sw-cache' && good[0].add['sw-cache'].from.length === 3, JSON.stringify(good));
  check('a new key that collides with a live note is refused', dropped.some((d) => /unrelated is already a note/.test(d)), JSON.stringify(dropped));
  check('a note with no evidence is refused', dropped.some((d) => /needs --evidence/.test(d)), JSON.stringify(dropped));
  check('a key the model was not given is refused', dropped.some((d) => /from no task/.test(d)), JSON.stringify(dropped));

  const { good: g2, dropped: d2 } = curator.checkCuration(
    [
      { replaces: ['sw-cache-a', 'sw-cache-b'], notes: [{ key: 'p', evidence: 'e', value: '1' }, { key: 'q', evidence: 'e', value: '2' }] },
      { replaces: ['tests'], notes: [{ key: 'big', evidence: 'e', value: 'x'.repeat(5000) }] },
    ],
    tasks,
    live
  );
  check('a merge that leaves as many notes as it replaced is refused', g2.length === 0 && d2.some((d) => /is not a merge/.test(d)), JSON.stringify(d2));
  check('a split that writes a note over the cap is refused', d2.some((d) => /bytes and the cap/.test(d)), JSON.stringify(d2));
  check('no block at all is an error, not a silent nothing', curator.extractCuration('I did it.').error !== null);
  check('an empty ops list is a correct answer', curator.extractCuration('```curate\nops: []\n```').ops.length === 0 && curator.extractCuration('```curate\nops: []\n```').error === null);
}

/* --------------------------------------------------------- a real store */

const dir = path.join(store, 'repo');
fs.mkdirSync(dir);
const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' }).trim();
git('init', '-q', '--initial-branch=main');
fs.mkdirSync(path.join(dir, 'lib'));
fs.writeFileSync(path.join(dir, 'lib', 'kept.js'), 'export function keptThing() {}\n');
fs.writeFileSync(path.join(dir, 'lib', 'gone.js'), 'export function goneThing() {}\n');
git('add', '-A');
git('commit', '-q', '-m', 'code');
git('rm', '-q', 'lib/gone.js');
git('commit', '-q', '-m', 'delete');
const repo = await mainCheckout(dir);

const inRepo = async (fn) => {
  const back = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(back);
  }
};
const put = (key, value) => inRepo(() => memory.note('worker', key, value, { evidence: 'fixture' }));
for (const k of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) await put(`sw-cache-${k}`, `sw-cache rule ${k}`);
await put('about-gone', 'lib/gone.js is where the trap was');
await put('hot-rule', 'lib/kept.js exports `keptThing`');
for (let i = 0; i < 26; i += 1) recordRead({ by: 'worker', tier: 'notes', subject: 'worker', key: 'hot-rule', hit: true, repo });

console.log('\nreplacing notes');

{
  const before = git('rev-parse', 'refs/beadcause/agents/worker');
  let refused = '';
  try {
    await memory.replaceNotes(dir, 'worker', { remove: ['sw-cache-alpha'], add: { 'hot-rule': { value: 'x', evidence: 'e' } } });
  } catch (err) {
    refused = err.message;
  }
  check('replacing refuses to overwrite a live note it was not given', /already a note/.test(refused), refused);
  check('and writes nothing when it refuses', git('rev-parse', 'refs/beadcause/agents/worker') === before);
}

console.log('\na weekly run');

const filed = [];
const fakeFile = async (_bd, _ws, beads) => {
  const rows = beads.map((b, i) => ({ id: `bc-p${filed.length + i}`, title: b.title }));
  filed.push(...beads);
  return { filed: rows, failed: [] };
};
const prompts = [];
const fakeRun = async ({ prompt }) => {
  prompts.push(prompt);
  return '```curate\nops:\n  - replaces: [sw-cache-alpha, sw-cache-bravo, sw-cache-charlie, sw-cache-delta, sw-cache-echo]\n    notes:\n      - key: sw-cache\n        kind: procedure\n        evidence: merged from five fixture notes\n        value: Every sw-cache rule, in one place.\n```\n';
};
let clock = NOW;
const settled = [];
const make = () =>
  curator.createCurator({
    cfg: { advocates: {} },
    bd: {},
    run: fakeRun,
    file: fakeFile,
    now: () => clock,
    logStart: () => clock - 10 * DAY,
    onSettled: (o) => settled.push(o),
    log: () => {},
    warn: () => {},
  });

const dry = await make().curate(dir, { name: 'ws' }, { dryRun: true });
check(
  'a dry run plans an archive, a promotion and a merge',
  dry.plan.archive.some((a) => a.key === 'about-gone') && dry.plan.promote.some((p) => p.key === 'hot-rule') && dry.plan.merge.length === 1,
  JSON.stringify(dry.plan)
);
check('and writes nothing: no model, no bead, no ledger', !prompts.length && !filed.length && !git('for-each-ref', 'refs/beadcause/curator'));

// scripts/memory-curate.mjs is the same dry run, for a person. Its own process, against the
// same temp config, so its read of the log is the one the daemon would make.
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'memory-curate.mjs');
const printed = JSON.parse(execFileSync(process.execPath, [script, '--json', dir], { encoding: 'utf8', env: { ...process.env } }));
check(
  'scripts/memory-curate.mjs prints the same plan, and writes nothing either',
  printed.archive.some((a) => a.key === 'about-gone') && printed.promote.some((p) => p.key === 'hot-rule') && !git('for-each-ref', 'refs/beadcause/curator'),
  JSON.stringify(printed)
);

const tipBefore = git('rev-parse', 'refs/beadcause/agents/worker');
const first = await make().curate(dir, { name: 'ws' });
check('the run ran', first.ran && !first.error, JSON.stringify({ why: first.why, error: first.error, dropped: first.dropped }));
check('the evidence-stale note is in the archive', first.archived.some((a) => a.key === 'about-gone') && git('cat-file', '-t', 'refs/beadcause/agents-archive/worker:notes/about-gone.json') === 'blob');
check('the hot note got a promotion bead', first.promoted.length === 1 && first.promoted[0].key === 'hot-rule' && filed.length === 1, JSON.stringify(first.promoted));
const after = JSON.parse(git('cat-file', '-p', 'refs/beadcause/agents/worker:index.json')).notes;
check('the cluster is now one note, and the five are gone', 'sw-cache' in after && !Object.keys(after).some((k) => k.startsWith('sw-cache-')), Object.keys(after).join());
const merged = JSON.parse(git('cat-file', '-p', 'refs/beadcause/agents/worker:notes/sw-cache.json'));
check('the merged note says what it came from', merged.from.length === 5 && merged.evidence === 'merged from five fixture notes', JSON.stringify(merged));
const log = git('log', '--format=%s', `${tipBefore}..refs/beadcause/agents/worker`).split('\n');
check('the merge is its own commit, beside the archive commit', log.length === 2 && log.some((s) => /^curate worker: merge/.test(s)) && log.some((s) => /^archive worker/.test(s)), log.join(' | '));
check('and the old notes are still in the history', git('cat-file', '-t', `${tipBefore}:notes/sw-cache-alpha.json`) === 'blob');
check('the run is in the ledger', JSON.parse(git('cat-file', '-p', 'refs/beadcause/curator:state.json')).promoted['worker/hot-rule'] === 'bc-p0');
check('and the settle callback heard it', settled.length === 1 && settled[0].applied.length === 1);

const again = await make().curate(dir, { name: 'ws' });
check('a second run inside the week does nothing', !again.ran && /0 day/.test(again.why), again.why);

clock += 8 * DAY;
const week = await make().curate(dir, { name: 'ws' });
check('a week later it runs again, and files no second bead for the same note', week.ran && week.promoted.length === 0 && filed.length === 1, JSON.stringify(week.promoted));
check('with nothing left to merge it does not call the model', prompts.length === 1, String(prompts.length));

const off = await curator.createCurator({ cfg: { advocates: { memoryCurator: false } }, now: () => clock + 30 * DAY, log: () => {}, warn: () => {} }).curate(dir, { name: 'ws' });
check('switched off in config, it does not run', !off.ran && /switched off/.test(off.why), off.why);

assert.equal(typeof curator.createCurator, 'function');
if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
