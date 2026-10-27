#!/usr/bin/env node
/**
 * DemoMode's list and its tap — bc-sj8k.2.
 *
 *     npm test
 *     node test/demomode.mjs
 *
 * `demoRows` is pure and driven directly over board rows shaped the way lib/prboard.js hands
 * them out. `askRouter` and `standOnGreen` are driven against a stub router on a loopback
 * port, because what is under test is what this file does with the router's answer — the
 * router's own behaviour is test/routergreen.mjs's.
 */
import assert from 'node:assert/strict';
import http from 'node:http';

import { askRouter, demoHistory, demoRows, slugOfBranch, standOnGreen } from '../lib/demomode.js';

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${String(err?.stack || err).split('\n').slice(0, 4).join('\n       ')}`);
  }
}

const sha = (c) => c.repeat(40);
const pr = (number, over = {}) => ({
  number,
  title: `bc-x.${number}: change ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  state: 'OPEN',
  draft: false,
  branch: `b${number}`,
  headSha: sha(String(number % 10)),
  base: 'main',
  additions: 10,
  deletions: 2,
  files: 3,
  checks: { state: 'passing', total: 4, failed: [] },
  beads: [{ id: `bc-x.${number}`, title: `bead ${number}`, status: 'in_progress' }],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: `2026-09-0${number}T00:00:00Z`,
  ...over,
});
const record = (number, head, over = {}) => ({
  id: `beadcause.pr${number}.${head.slice(0, 12)}`,
  number,
  headSha: head,
  servable: true,
  unservable: null,
  preparedAt: '2026-09-02T00:00:00Z',
  ...over,
});

console.log('the list');

await check('every open pull request is a row, prepared or not, and nothing that is not open', () => {
  const card = { prs: [pr(1), pr(2), pr(3, { state: 'MERGED' }), pr(4, { state: 'CLOSED' })] };
  const rows = demoRows({ card });
  assert.deepEqual(rows.map((r) => r.number).sort(), [1, 2]);
  for (const r of rows) assert.equal(r.candidate, null);
});

await check('a row carries what changes, where it came from, its gate and its age', () => {
  const [r] = demoRows({ card: { prs: [pr(2, { checks: { state: 'failing', total: 3, failed: ['test'] } })] } });
  assert.equal(r.title, 'bc-x.2: change 2');
  assert.deepEqual(r.beads, [{ id: 'bc-x.2', title: 'bead 2' }]);
  assert.equal(r.gate, 'fail');
  assert.deepEqual(r.failed, ['test']);
  assert.equal(r.checks, 3);
  assert.equal(r.additions, 10);
  assert.equal(r.files, 3);
  assert.equal(r.updatedAt, '2026-09-02T00:00:00Z');
  assert.equal(r.head, '222222222222');
  assert.ok(r.stage, 'a stage off lib/prstage.js');
});

await check('a head nothing ran on is `none`, never a pass', () => {
  const [r] = demoRows({ card: { prs: [pr(1, { checks: {} })] } });
  assert.equal(r.gate, 'none');
});

await check('the prepared candidate is joined on, and an older head is not this one', () => {
  const card = { prs: [pr(1), pr(2)] };
  const rows = demoRows({ card, records: [record(1, sha('1')), record(2, sha('9'))] });
  const one = rows.find((r) => r.number === 1);
  const two = rows.find((r) => r.number === 2);
  assert.equal(one.candidate.current, true);
  assert.equal(one.candidate.servable, true);
  assert.equal(two.candidate.current, false, 'a record for a head the pull request has moved past');
});

await check('on green only when the standing candidate is this head', () => {
  const card = { prs: [pr(1), pr(2)] };
  const records = [record(1, sha('1')), record(2, sha('9'))];
  const rows = demoRows({ card, records, green: { id: records[0].id } });
  assert.equal(rows.find((r) => r.number === 1).onGreen, true);
  assert.equal(rows.find((r) => r.number === 2).onGreen, false);
  // The id of an older head standing on green is not the pull request's current head.
  const stale = demoRows({ card, records, green: { id: records[1].id } });
  assert.equal(stale.find((r) => r.number === 2).onGreen, false);
});

await check('the one you came back from is first, then whatever is on green, then the newest', () => {
  const card = { prs: [pr(1), pr(2), pr(3), pr(4)] };
  const records = [record(1, sha('1')), record(2, sha('2'))];
  assert.deepEqual(
    demoRows({ card }).map((r) => r.number),
    [4, 3, 2, 1]
  );
  assert.deepEqual(
    demoRows({ card, records, green: { id: records[1].id } }).map((r) => r.number),
    [2, 4, 3, 1]
  );
  assert.deepEqual(
    demoRows({ card, records, green: { id: records[1].id }, from: records[0].id }).map((r) => r.number),
    [1, 2, 4, 3]
  );
});

await check('no card is no rows, not a throw', () => {
  assert.deepEqual(demoRows({}), []);
  assert.deepEqual(demoRows({ card: null, records: [record(1, sha('1'))] }), []);
});

console.log('\nasking the router');

/** A router that answers the two control calls the way bin/router.js does. */
async function stubRouter(answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, token: req.headers['x-beadcause-token'] });
    if (req.headers['x-beadcause-token'] !== 'tok') {
      res.writeHead(403, { 'content-type': 'application/json' });
      return res.end('{"error":"internal"}');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer(req)));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, seen, close: () => new Promise((r) => server.close(r)) };
}

await check('the state is read with the token, and a refusal of the token is null', async () => {
  const r = await stubRouter(() => ({ router: { pid: 1 }, green: { id: 'beadcause.pr1.111111111111' } }));
  try {
    const s = await askRouter({ port: r.port, token: 'tok' }, '/internal/router/state');
    assert.equal(s.green.id, 'beadcause.pr1.111111111111');
    assert.equal(await askRouter({ port: r.port, token: 'nope' }, '/internal/router/state'), null);
  } finally {
    await r.close();
  }
});

await check('no router at all is null — green does not exist under start:bare', async () => {
  const r = await stubRouter(() => ({}));
  const port = r.port;
  await r.close();
  assert.equal(await askRouter({ port, token: 'tok' }, '/internal/router/state'), null);
  const stood = await standOnGreen({ port, token: 'tok' }, 'beadcause.pr1.111111111111');
  assert.equal(stood.ok, false);
  assert.match(stood.error, /no router/);
});

await check('standing a candidate up is a POST naming it, and the refusal comes back as a sentence', async () => {
  const r = await stubRouter((req) =>
    req.url.includes('pr2.')
      ? { ok: false, error: 'candidate beadcause.pr2.222222222222 is unservable — no bundles' }
      : { ok: true, green: { id: 'beadcause.pr1.111111111111', port: 9 } }
  );
  try {
    const cfg = { port: r.port, token: 'tok' };
    const good = await standOnGreen(cfg, 'beadcause.pr1.111111111111');
    assert.deepEqual(good, { ok: true, green: { id: 'beadcause.pr1.111111111111', port: 9 }, error: null });
    assert.equal(r.seen[0].method, 'POST');
    assert.equal(r.seen[0].url, '/internal/router/green?id=beadcause.pr1.111111111111');
    const bad = await standOnGreen(cfg, 'beadcause.pr2.222222222222');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /unservable — no bundles/);
  } finally {
    await r.close();
  }
});

console.log('\nthe card expanded (bc-sj8k.4)');

const head = sha('a');
const branchRow = (over = {}) =>
  pr(4, {
    headSha: head,
    branch: 'worktree-thing-x1',
    checks: { state: 'failing', total: 3, passing: 2, failing: 1, pending: 0, failed: ['test (1)'], failedUrls: ['https://ci/1'], at: '2026-09-04T00:00:00Z' },
    beads: [{ id: 'bc-x.4', title: 'bead 4', status: 'in_progress' }],
    ...over,
  });
const readersFor = (over = {}) => ({
  bead: async (id) => ({
    id,
    title: 'The bead, as the tracker has it',
    status: 'in_progress',
    comments: [
      { author: 'a', text: 'first', created_at: '2026-09-01T00:00:00Z' },
      { author: 'b', text: 'x'.repeat(50), created_at: '2026-09-02T00:00:00Z' },
    ],
  }),
  archive: async () => ({ sessions: [{ commit: 'c'.repeat(40), at: '2026-09-03T00:00:00Z', subject: 'worker session' }] }),
  live: () => [
    { pid: 11, name: 'Beadcause - bc-x.4 thing', at: '2026-09-04T00:00:00Z' },
    { pid: 12, name: 'Beadcause - bc-x.40 other', at: '2026-09-04T00:00:00Z' },
  ],
  namesBead: (name, id) => new RegExp(`(?<![\\w.-])${id.replace(/\./g, '\\.')}(?![\\w.-])`).test(name),
  gateRuns: async (slug) => [
    { runId: `${slug}-2`, status: 'fail', done: 3, total: 3, failed: ['test/a.mjs'], sha: head, startedAt: '2026-09-04T00:00:00Z' },
    { runId: `${slug}-1`, status: 'pass', done: 3, total: 3, failed: [], sha: sha('b'), startedAt: '2026-09-03T00:00:00Z' },
  ],
  changedFiles: async () => ['lib/a.js', 'lib/new.js', 'public/a.js'],
  coverage: () => ({ commit: sha('b'), generated: '2026-09-01T00:00:00Z', files: [] }),
  coverageFor: (_, paths) => ({
    files: [
      { path: 'lib/a.js', loaded: false, functions: null, uncovered: [] },
      { path: 'lib/new.js', loaded: null, functions: null, uncovered: [] },
    ],
    untested: ['lib/a.js'],
    outOfScope: paths.filter((p) => p.startsWith('public/')),
  }),
  ...over,
});

await check('every section is filled from its reader, and the thread keeps its newest end', async () => {
  const h = await demoHistory({ row: branchRow(), readers: readersFor(), limits: { beads: 6, comments: 1, text: 10, sessions: 8, runs: 5 } });
  assert.equal(h.number, 4);
  assert.equal(h.head, head.slice(0, 12));
  assert.deepEqual(h.checks.failed, ['test (1)']);
  assert.deepEqual(h.checks.failedUrls, ['https://ci/1']);
  const b = h.beads[0];
  assert.equal(b.title, 'The bead, as the tracker has it');
  assert.equal(b.comments, 2);
  assert.equal(b.thread.length, 1, 'only the newest, to the limit');
  assert.equal(b.thread[0].author, 'b');
  assert.equal(b.thread[0].cut, true);
  assert.equal(b.thread[0].text, `${'x'.repeat(10)}…`);
  assert.equal(b.sessions[0].subject, 'worker session');
  assert.deepEqual(
    b.live.map((s) => s.pid),
    [11],
    'bc-x.40 is not bc-x.4'
  );
});

await check('a gate run is on this head only when its commit is this head', async () => {
  const h = await demoHistory({ row: branchRow(), readers: readersFor() });
  assert.equal(h.gates.known, true);
  assert.equal(h.gates.slug, 'thing-x1');
  assert.deepEqual(
    h.gates.runs.map((r) => r.onHead),
    [true, false]
  );
  assert.deepEqual(h.gates.runs[0].failed, ['test/a.mjs']);
});

await check('a branch that is not a worktree branch has no gate runs to find — unknown, not none', async () => {
  let asked = false;
  const h = await demoHistory({ row: branchRow({ branch: 'feature/x' }), readers: readersFor({ gateRuns: async () => ((asked = true), []) }) });
  assert.equal(asked, false);
  assert.equal(h.gates.known, false);
  assert.match(h.gates.why, /not a worktree branch/);
});

await check('coverage says which commit it measured, and keeps untested, new and out-of-scope apart', async () => {
  const h = await demoHistory({ row: branchRow(), readers: readersFor() });
  assert.equal(h.coverage.known, true);
  assert.equal(h.coverage.onHead, false);
  assert.equal(h.coverage.commit, sha('b').slice(0, 12));
  assert.equal(h.coverage.changed, 3);
  assert.deepEqual(h.coverage.untested, ['lib/a.js']);
  assert.deepEqual(h.coverage.outOfScope, ['public/a.js']);
  assert.equal(h.coverage.files.find((f) => f.path === 'lib/new.js').loaded, null);
  const same = await demoHistory({ row: branchRow(), readers: readersFor({ coverage: () => ({ commit: head, files: [] }) }) });
  assert.equal(same.coverage.onHead, true);
});

await check('a head this machine does not have, or no report at all, is unknown coverage with the reason', async () => {
  const missing = await demoHistory({ row: branchRow(), readers: readersFor({ changedFiles: async () => null }) });
  assert.equal(missing.coverage.known, false);
  assert.match(missing.coverage.why, /does not have/);
  const none = await demoHistory({ row: branchRow(), readers: readersFor({ coverage: () => null }) });
  assert.equal(none.coverage.known, false);
  assert.match(none.coverage.why, /npm run coverage/);
});

await check('a reader that throws is an error on its own section, never an empty one', async () => {
  const h = await demoHistory({
    row: branchRow(),
    readers: readersFor({
      bead: async () => {
        throw new Error('database is locked\nmore');
      },
      archive: async () => {
        throw new Error('not a git repository');
      },
      gateRuns: async () => {
        throw new Error('EACCES');
      },
    }),
  });
  const b = h.beads[0];
  assert.equal(b.threadError, 'database is locked');
  assert.equal(b.thread, undefined, 'no empty thread drawn over a failure');
  assert.equal(b.status, 'in_progress', "the board's own status still stands");
  assert.equal(b.sessionsError, 'not a git repository');
  assert.equal(b.sessions, undefined);
  assert.deepEqual(h.gates, { known: false, why: 'EACCES' });
});

await check('no readers at all says every section is unreadable rather than empty', async () => {
  const h = await demoHistory({ row: branchRow({ checks: undefined }) });
  assert.equal(h.checks, null);
  assert.equal(h.gates.known, false);
  assert.equal(h.coverage.known, false);
  assert.ok(h.beads[0].threadError && h.beads[0].sessionsError && h.beads[0].liveError);
});

await check('the prepared candidate is joined, and one for an older head says so', async () => {
  const h = await demoHistory({ row: branchRow(), record: record(4, sha('b')), readers: readersFor() });
  assert.equal(h.candidate.current, false);
  const now = await demoHistory({ row: branchRow(), record: record(4, head), readers: readersFor() });
  assert.equal(now.candidate.current, true);
});

await check('the branch slug is what lib/gaterun.js files a run under', () => {
  assert.equal(slugOfBranch('worktree-candidate-history-sj8k4-w2r'), 'candidate-history-sj8k4-w2r');
  assert.equal(slugOfBranch('main'), '');
  assert.equal(slugOfBranch(''), '');
});

console.log(`\n${ran - failures}/${ran} passed`);
process.exit(failures ? 1 : 0);
