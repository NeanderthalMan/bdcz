#!/usr/bin/env node
/**
 * `beadcause-top`'s merge-queue view — lib/topqueue.js and the `m` key in lib/top.js.
 *
 *     npm test
 *     node test/topqueue.mjs
 *
 * bc-n01yg. Four things are pinned. **The rows are the queue, then everything open that is
 * not in it**: a queued entry joins its board row by `<key>#<number>` for GitHub's columns,
 * keeps its position order, and an open pull request with no merge-bead is listed after,
 * marked not queued — merged ones never. **A frame fits** and says why: the title gives
 * way, the bases line names every base a row stands on, the selected row's note and refusal
 * sit under the table, and a workspace the queue could not read is never counted as empty.
 * **The daemon is asked properly and its absence is a sentence**: both routes, the token
 * header, and a refused connection comes back as `error`, not a throw. **The loop swaps
 * views on `m`** without touching the sessions bar, reads the queue on its own clock, and
 * `f` there opens the selected pull request through an injected door.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runTop } from '../lib/top.js';
import { checksWords, collectQueue, queueRows, renderQueue } from '../lib/topqueue.js';
import { dw } from '../lib/width.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const NOW = Date.parse('2026-10-25T22:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

const pr = (number, extra = {}) => ({
  number,
  key: `beadcause#${number}`,
  workspace: 'beadcause',
  url: `https://github.com/o/beadcause/pull/${number}`,
  title: `PR ${number} title`,
  state: 'OPEN',
  draft: false,
  merged: false,
  mergeable: 'MERGEABLE',
  additions: 10,
  deletions: 2,
  createdAt: iso(NOW - 3 * 3600_000),
  checks: { state: 'passing', total: 2, passing: 2, failing: 0, pending: 0, failed: [] },
  beads: [{ id: `bc-p${number}` }],
  ...extra,
});

const entry = (number, extra = {}) => ({
  kind: 'merge',
  workspace: 'beadcause',
  key: 'beadcause',
  bead: `bc-p${number}`,
  mergeBead: `bc-m${number}`,
  number,
  url: `https://github.com/o/beadcause/pull/${number}`,
  title: '',
  stage: 'gate',
  stageLabel: 'Gate tests',
  note: 'Waiting on the checks.',
  attempts: 1,
  downmerges: 2,
  refused: null,
  at: iso(NOW - 600_000),
  ...extra,
});

const fixture = () => ({
  queues: {
    repos: [{ key: 'beadcause', workspace: 'beadcause', merge: [entry(30, { position: 2, queueLength: 2 }), entry(20, { position: 1, queueLength: 2, stage: 'issues', stageLabel: 'Resolving issues', refused: 'test/x.mjs failed\nassert' })] }],
    orphans: [],
    bases: [
      { workspace: 'beadcause', state: 'green', summary: 'main is green on GitHub.' },
      { workspace: 'loremia', state: 'red', summary: 'main is red.', holdBead: 'k-1' },
      { workspace: 'sorrel', state: 'unknown', summary: 'main could not be read on the last tick.' },
    ],
    errors: [],
  },
  prs: {
    repos: [
      {
        key: 'beadcause',
        workspace: 'beadcause',
        prs: [
          pr(30),
          pr(20, { checks: { state: 'failing', total: 3, passing: 2, failing: 1, pending: 0, failed: ['test'] } }),
          pr(40, { draft: true, mergeable: 'CONFLICTING' }),
          pr(41),
          pr(10, { state: 'MERGED', merged: true, mergedAt: iso(NOW - 3600_000) }),
        ],
      },
    ],
  },
});

/* ------------------------------------------------------------------ rows */

test('the queue first, in position order, joined to the board; then every open PR with no merge-bead; never a merged one', () => {
  const rows = queueRows(fixture());
  assert.deepEqual(
    rows.map((r) => [r.number, r.queued]),
    [
      [20, true],
      [30, true],
      [41, false],
      [40, false],
    ]
  );
  const [first] = rows;
  assert.equal(first.title, 'PR 20 title', 'the title comes off the board when the entry has none');
  assert.equal(first.checks, 'failing');
  assert.deepEqual(first.failed, ['test']);
  assert.equal(first.mergeBead, 'bc-m20');
  assert.equal(first.refused, 'test/x.mjs failed\nassert');
  const draft = rows.find((r) => r.number === 40);
  assert.equal(draft.stageLabel, 'not queued (draft)');
  assert.match(draft.note, /skips drafts/);
  assert.equal(rows.find((r) => r.number === 41).bead, 'bc-p41');
});

test('an entry the board does not list still gets its row, with GitHub\'s columns blank', () => {
  const data = fixture();
  data.queues.orphans = [entry(99, { key: 'elsewhere', workspace: 'elsewhere', position: 1, queueLength: 1, title: 'orphan' })];
  const row = queueRows(data).find((r) => r.number === 99);
  assert.equal(row.title, 'orphan');
  assert.equal(row.checks, null);
  assert.equal(row.mergeable, null);
  assert.equal(queueRows({}).length, 0, 'nothing in, nothing out');
});

test('checksWords says the state and the count that matters for it', () => {
  assert.equal(checksWords({ checks: 'passing', total: 2, passing: 2 }), '✓ 2/2');
  assert.equal(checksWords({ checks: 'failing', total: 3, failing: 1 }), '✗ 1/3');
  assert.equal(checksWords({ checks: 'pending', total: 4, pending: 2 }), '… 2/4');
  assert.equal(checksWords({ checks: 'none', total: null }), 'none');
  assert.equal(checksWords({ checks: null }), '');
});

/* ------------------------------------------------------------------ the frame */

test('a frame fits, names the bases its rows stand on and any red one, and draws the selected row\'s why', () => {
  const lines = renderQueue({ data: fixture(), now: NOW, width: 200, selected: 'beadcause#20', interactive: true, fetchedAt: NOW - 4000 });
  assert.match(lines[0], /^beadcause-top {2}· {2}merge queue {2}· {2}2 queued, 2 open not queued {2}· {2}read 4s ago/);
  assert.match(lines[1], /^bases {2}beadcause: main is green on GitHub {2}· {2}loremia: main is red$/, 'the row\'s base and the red one; not the unknown one nobody stands on');
  const table = lines.find((l) => /^\s*#\s+ws\s+pr/.test(l));
  assert.ok(table, 'a header row');
  const row20 = lines.find((l) => l.includes('#20') && l.includes('bc-p20'));
  assert.ok(row20.startsWith('\x1b[7m'), 'the selected row is in inverse video');
  assert.match(row20, /1\/2 .*Resolving issues .*10m .*1\/3 ↓2 .*✗ 1\/3 .*clean .*\+10 −2 .*3h .*PR 20 title/);
  assert.match(lines.find((l) => l.includes('#40')), /— .*not queued \(draft\).*conflict/);
  assert.ok(lines.includes('#20  Waiting on the checks.'), 'the note under the table');
  assert.ok(lines.includes('refused: test/x.mjs failed assert'), 'the refusal on one line');
  assert.ok(lines.includes('failing: test'));
  assert.match(lines.at(-1), /^q quit · r refresh · ↑↓ select · f open pr · m sessions · every 10s$/);

  const narrow = renderQueue({ data: fixture(), now: NOW, width: 90 });
  assert.ok(narrow.every((l) => dw(l.replace(/\x1b\[[0-9;]*m/g, '')) <= 90), 'nothing wider than the terminal');
  const short = renderQueue({ data: fixture(), now: NOW, width: 200, height: 7 });
  assert.match(short.at(-1), /^… and \d more$/, 'rows past the height are counted');
});

test('an unread workspace is said, not counted as empty; an unreachable daemon is one sentence; an empty queue says so', () => {
  const data = fixture();
  data.queues.errors = [{ workspace: 'beadcause', error: 'the merge queue did not answer within 5s' }];
  const lines = renderQueue({ data, now: NOW, width: 200 });
  assert.match(lines[0], /2 queued \(1 workspace unread\)/);
  assert.ok(lines.some((l) => /^unread {2}beadcause: the merge queue did not answer within 5s$/.test(l)));
  const down = renderQueue({ data: { error: 'the daemon at http://127.0.0.1:4318 could not be read — refused' }, now: NOW, width: 200 });
  assert.ok(!down[0].includes('queued'), 'no count when nothing was read');
  assert.match(down[1], /could not be read — refused/);
  const empty = renderQueue({ data: { queues: { repos: [], orphans: [], bases: [], errors: [] }, prs: { repos: [] } }, now: NOW, width: 120 });
  assert.match(empty.at(-1), /^nothing queued and no open pull requests on the board$/);
});

/* ------------------------------------------------------------------ reading */

test('collectQueue asks both routes on loopback with the token, and turns a failure into a sentence', async () => {
  const asked = [];
  const ok = await collectQueue({
    cfg: { port: 5555, token: 'tok' },
    fetch: async (url, opts) => {
      asked.push([url, opts.headers['x-beadcause-token']]);
      return { ok: true, json: async () => ({ url }) };
    },
  });
  assert.equal(ok.error, null);
  assert.deepEqual(asked.sort(), [
    ['http://127.0.0.1:5555/api/prs', 'tok'],
    ['http://127.0.0.1:5555/api/queues', 'tok'],
  ]);
  const fresh = [];
  await collectQueue({ cfg: { port: 5555 }, refresh: true, fetch: async (url) => (fresh.push(url), { ok: true, json: async () => ({}) }) });
  assert.ok(fresh.every((u) => u.endsWith('?refresh=1')), 'r asks for a fresh read');
  const refused = await collectQueue({
    cfg: {},
    fetch: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:4318\nstack');
    },
  });
  assert.equal(refused.queues, null);
  assert.equal(refused.error, 'the daemon at http://127.0.0.1:4318 could not be read — connect ECONNREFUSED 127.0.0.1:4318');
  const denied = await collectQueue({ cfg: {}, fetch: async () => ({ ok: false, status: 401 }) });
  assert.match(denied.error, /answered HTTP 401$/);
});

/* ------------------------------------------------------------------ the loop */

function terminal() {
  const input = new EventEmitter();
  Object.assign(input, { isTTY: true, raw: null, setRawMode: (v) => (input.raw = v), resume() {}, pause() {}, setEncoding() {} });
  const frames = [];
  const out = new EventEmitter();
  Object.assign(out, { isTTY: false, columns: 200, rows: 40, write: (s) => frames.push(s) });
  const tick = () => new Promise((r) => setImmediate(r));
  const press = async (key) => {
    input.emit('data', key);
    await tick();
    await tick();
  };
  const latest = () => frames.at(-1) || '';
  const barOn = () => /\x1b\[7m([^\x1b]*)\x1b\[0m/.exec(latest())?.[1] || null;
  return { input, out, press, latest, barOn, tick };
}

test('runTop: m swaps to the queue and back, the queue is read on its own clock, f opens the PR under the bar', async () => {
  const t = terminal();
  let clock = NOW;
  let reads = 0;
  const refreshes = [];
  const opened = [];
  const sessions = [{ sessionId: 's1', name: 'beadcause - one', status: 'live', activity: 'idle' }];
  const ended = runTop({
    collect: async () => ({ rows: sessions, boot: NOW - 600_000 }),
    collectQueue: async ({ refresh }) => (reads++, refreshes.push(refresh), fixture()),
    openUrl: async (url) => opened.push(url),
    every: 60_000,
    queueEvery: 10_000,
    out: t.out,
    input: t.input,
    alt: false,
    now: () => clock,
  });
  await t.tick();
  await t.tick();
  assert.match(t.latest(), /m merge queue/, 'the sessions footer offers the swap');
  assert.equal(reads, 0, 'the queue is not read until it is looked at');

  await t.press('m');
  assert.match(t.latest(), /merge queue {2}· {2}2 queued/);
  assert.equal(reads, 1);
  assert.match(t.barOn(), /#20/, 'the bar starts on the first pull request');
  await t.press('j');
  assert.match(t.barOn(), /#30/);
  await t.press('l');
  await t.press('o');
  assert.match(t.barOn(), /#30/, 'the sort keys do nothing here');
  await t.press('f');
  assert.deepEqual(opened, ['https://github.com/o/beadcause/pull/30']);
  assert.match(t.latest().split('\n')[0], /·  opened #30$/);

  await t.press('j');
  assert.equal(reads, 1, 'a move redraws from what was read');
  clock += 11_000;
  await t.press('m');
  await t.press('\t');
  assert.equal(reads, 2, 'back on the queue past its interval, it is read again');
  await t.press('r');
  assert.equal(reads, 3);
  assert.deepEqual(refreshes, [false, false, true], 'only r asks for a fresh read');
  assert.match(t.barOn(), /#41/, 'the bar kept its pull request across the swap');

  await t.press('m');
  assert.match(t.barOn(), /beadcause - one/, 'and the sessions bar is where it was');
  await t.press('q');
  assert.equal(await ended, 0);
});

test('runTop without a queue door: m does nothing and the footer does not offer it', async () => {
  const t = terminal();
  const ended = runTop({
    collect: async () => ({ rows: [{ sessionId: 's1', name: 'a', status: 'live' }], boot: NOW }),
    every: 60_000,
    out: t.out,
    input: t.input,
    alt: false,
    now: () => NOW,
  });
  await t.tick();
  await t.tick();
  assert.ok(!t.latest().includes('m merge queue'));
  await t.press('m');
  assert.ok(!t.latest().includes('merge queue'));
  await t.press('q');
  assert.equal(await ended, 0);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}
console.log(failed ? `\n${failed} failed` : `\n${tests.length} passed`);
process.exit(failed ? 1 : 0);
