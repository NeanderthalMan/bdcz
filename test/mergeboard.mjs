#!/usr/bin/env node
/**
 * The merge queue on screen: the PRs chip's two subtabs, the base line, and each entry's
 * position (bc-gjlix).
 *
 *     npm test
 *     node test/mergeboard.mjs
 *
 * The queue held 75 pull requests for three days behind a red base and the only place
 * that said so was the daemon log. Three things make it visible, and this suite checks
 * each one without Chrome:
 *
 * - `baseReading` (lib/basegate.js): the sentence and state for one base, which must name
 *   its source, because a local gate answer cannot be seen on GitHub.
 * - `position` on every merge entry (lib/queues.js): the order `sweepMergeQueue` tries
 *   them, which is bead-id order within a workspace, across repo cards and orphans.
 * - The wiring: both documents carry the switch and both lists, mergeboard.js loads
 *   before prs.js, which asks it which subtab is up, and the service worker ships it.
 *
 * scripts/prs-check.mjs drives the board itself in Chrome.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseReading } from '../lib/basegate.js';
import { queues } from '../lib/queues.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${String(err.message).split('\n').join('\n      ')}`);
  }
}

console.log('\nthe base line');

await check('a local gate answer says so, with its run and its suite count', () => {
  const r = baseReading({
    workspace: 'beadcause',
    key: 'beadcause',
    out: { hold: null },
    seen: { sha: 'abcdef0123456789', rollup: { state: 'passing', source: 'local-gate', runId: 'r-42', total: 568 } },
  });
  assert.equal(r.state, 'green');
  assert.equal(r.source, 'local-gate');
  assert.equal(r.runId, 'r-42');
  assert.equal(r.summary, 'main at abcdef012 is green by local gate r-42 (568 suites).');
});

await check('a green GitHub rollup says GitHub', () => {
  const r = baseReading({ out: { hold: null }, seen: { rollup: { state: 'passing' } } });
  assert.equal(r.state, 'green');
  assert.equal(r.source, 'github');
  assert.match(r.summary, /green on GitHub/);
});

await check('a hold is red whatever the rollup said, and names its bead and the checks', () => {
  const r = baseReading({
    base: 'main',
    out: { hold: { bead: 'bc-9qs17', failed: ['test (shard 0)', 'test (shard 1)', 'lint', 'build'] } },
    seen: { rollup: { state: 'passing' }, why: 'no local gate run covers this commit' },
  });
  assert.equal(r.state, 'red');
  assert.equal(r.holdBead, 'bc-9qs17');
  assert.match(r.summary, /^Held — main is red \(test \(shard 0\), test \(shard 1\), lint, \+1\), on bc-9qs17\./);
  assert.match(r.summary, /No local gate stands in: no local gate run covers this commit\./);
});

await check('a reading with no rollup is unknown, not green', () => {
  const r = baseReading({ out: { hold: null }, seen: {} });
  assert.equal(r.state, 'unknown');
  assert.equal(r.source, null);
});

console.log('\nposition in the queue');

const merge = (workspace, id, number, repo = '') => ({
  workspace,
  id,
  spec: { number, bead: `${id}-work`, repo, branch: `b${number}` },
  state: {},
});

await check('entries are numbered in bead-id order within a workspace, not by PR number', () => {
  const card = { workspace: 'beadcause', key: 'beadcause', repo: 'n/beadcause', prs: [] };
  const out = queues(
    { repos: [card] },
    { merges: [merge('beadcause', 'bc-c', 1), merge('beadcause', 'bc-a', 3), merge('beadcause', 'bc-b', 2)], deploys: [], ledger: {} }
  );
  const got = Object.fromEntries(out.repos[0].merge.map((e) => [e.mergeBead, [e.position, e.queueLength]]));
  assert.deepEqual(got, { 'bc-a': [1, 3], 'bc-b': [2, 3], 'bc-c': [3, 3] });
});

await check('orphans share their workspace numbering, and workspaces count separately', () => {
  const card = { workspace: 'ws1', key: 'ws1', repo: 'o/one', prs: [] };
  const out = queues(
    { repos: [card] },
    {
      merges: [merge('ws1', 'x-2', 5, 'o/one'), merge('ws1', 'x-1', 6, 'o/elsewhere'), merge('ws2', 'y-1', 7)],
      deploys: [],
      ledger: {},
    }
  );
  assert.equal(out.repos[0].merge[0].position, 2);
  const orphan = Object.fromEntries(out.orphans.map((e) => [e.mergeBead, e.position]));
  assert.deepEqual(orphan, { 'x-1': 1, 'y-1': 1 });
});

console.log('\nthe wiring');

// index.html is the only document since public/monitor.html was deleted (bc-l75v7).
await check('index.html has the switch, both lists, and the pane id the checks look for', () => {
  const html = read('public/index.html');
  for (const mark of ['id="prs"', 'id="prs-tabs"', 'id="prs-open"', 'id="prs-queue"', 'data-sub="open"', 'data-sub="queue"']) {
    assert.ok(html.includes(mark), `${mark} is missing`);
  }
  assert.ok(html.includes('data-section="prs-open"') && html.includes('data-section="prs-queue"'), 'a subtab names no list');
});

await check('the shell injects it after montabs.js and before prs.js, and the service worker ships it', () => {
  const lazy = read('public/panelazy.js');
  assert.match(lazy, /'\/montabs\.js', '\/monitor\.js', '\/mergeboard\.js', '\/prs\.js'/);
  assert.ok(read('public/sw.js').includes("'/mergeboard.js'"), 'not in SHELL');
});

await check('prs.js draws into the Open PRs list and stands down behind the queue', () => {
  const src = read('public/prs.js');
  assert.ok(src.includes("getElementById('prs-open')"), 'prs.js still draws over the whole pane');
  assert.ok(/prsTabs\?\.up\?\.\(SUB\)/.test(src), 'prs.js does not ask which subtab is up');
});

await check('/api/queues carries the base readings', () => {
  const src = read('lib/server.js');
  assert.ok(src.includes('bases: [...baseReadings.values()]'), 'the route does not send them');
  assert.ok(src.includes('baseReadings.set(memo, baseReading('), 'checkBase does not record them');
});

console.log(failures ? `\n\x1b[31m${ran - failures}/${ran} checks passed\x1b[0m` : `\n\x1b[32mall ${ran} checks passed\x1b[0m`);
process.exit(failures ? 1 : 0);
