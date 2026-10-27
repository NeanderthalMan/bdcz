#!/usr/bin/env node
/**
 * `beadcause-top` — every session on this Mac, live, in a window of its own. lib/top.js and
 * bin/beadcause-top.
 *
 *     npm test
 *     node test/top.mjs
 *
 * bc-5to5r.7. Three things are pinned. **The numbers come from where they say they do**: the
 * context column is the last `message.usage` in the transcript (input + cache read + cache
 * creation, newest line wins, junk skipped), the limit is the status line's rule, and the
 * process columns are one `ps` parsed by pid. **A frame fits**: no line wider than the
 * terminal, the session name is what gives way, and rows that do not fit in the height are
 * counted rather than drawn off the bottom. **The command is read-only and works with no
 * daemon**: run against an isolated config directory with a live record whose pid is this
 * suite's own, `--once` prints a frame with that row's context and cpu, `--json` the same
 * rows, and the directory's hash is the same afterwards.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';
import {
  COLUMNS,
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_SORT,
  LARGE_CONTEXT_LIMIT,
  SORTS,
  TOP_WINDOW,
  collectTop,
  contextFromTail,
  contextLimitFor,
  etimeSeconds,
  fmtMem,
  fmtTokens,
  focusRow,
  nextSort,
  parsePs,
  processStats,
  readContext,
  renderTop,
  runTop,
  shortAge,
  sortRows,
  stateWords,
  topRows,
  ttyOf,
  ttyPath,
} from '../lib/top.js';
import { EventEmitter } from 'node:events';
import { homeKey } from '../lib/iterm.js';
import { dw } from '../lib/width.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'beadcause-top');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const id = (n) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`;
const NOW = Date.parse('2026-10-12T14:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ context */

const usageLine = (tokens, model = 'claude-opus-4-8', extra = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: iso(NOW - 1000),
    message: { model, usage: { input_tokens: tokens.input, cache_read_input_tokens: tokens.read, cache_creation_input_tokens: tokens.create, output_tokens: 99 }, ...extra },
  });

test('the context is the newest usage line: input + cache read + cache creation, output not counted', () => {
  const text = [
    usageLine({ input: 10, read: 20, create: 30 }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    usageLine({ input: 1000, read: 400_000, create: 11_000 }, 'claude-opus-4-8[1m]'),
    '{"type":"assistant","message":{"usage":"not an object"}}',
    '{ this line is still being written',
    '',
  ].join('\n');
  const ctx = contextFromTail(text);
  assert.equal(ctx.tokens, 412_000);
  assert.equal(ctx.model, 'claude-opus-4-8[1m]');
  assert.equal(ctx.at, iso(NOW - 1000));
  assert.equal(contextFromTail('nothing here\n{"type":"user"}'), null);
  assert.equal(contextFromTail(''), null);
});

test('the limit is the status line\'s rule: 1m in the id means a million, else 200k, and the env wins', () => {
  assert.equal(contextLimitFor('claude-opus-4-8', {}), DEFAULT_CONTEXT_LIMIT);
  assert.equal(contextLimitFor('claude-opus-4-8[1m]', {}), LARGE_CONTEXT_LIMIT);
  assert.equal(contextLimitFor('claude-sonnet-4-5-1m', {}), LARGE_CONTEXT_LIMIT);
  assert.equal(contextLimitFor(null, {}), DEFAULT_CONTEXT_LIMIT);
  assert.equal(contextLimitFor('claude-opus-4-8', { CLAUDE_CTX_LIMIT: '500000' }), 500_000);
  assert.equal(contextLimitFor('claude-opus-4-8', { CLAUDE_CTX_LIMIT: 'lots' }), DEFAULT_CONTEXT_LIMIT);
  assert.equal(contextLimitFor('claude-fable-5-1', {}, 289_000), LARGE_CONTEXT_LIMIT, 'more than 200k in it: the window is bigger than 200k');
  assert.equal(contextLimitFor('claude-fable-5-1', {}, 150_000), DEFAULT_CONTEXT_LIMIT);
  assert.equal(contextLimitFor('claude-fable-5-1', { CLAUDE_CTX_LIMIT: '200000' }, 289_000), 200_000, 'the env still wins');
});

test('readContext reads the tail of the file and drops the fragment a mid-file start leaves', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-top-'));
  try {
    const file = path.join(dir, 't.jsonl');
    // A long first line so a small window starts inside it; the fragment must not be parsed.
    const lines = [usageLine({ input: 1, read: 2, create: 3 }, 'x'.repeat(2000)), usageLine({ input: 100, read: 200, create: 300 })];
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    assert.deepEqual(readContext(file, { bytes: 400 }).tokens, 600);
    assert.equal(readContext(file).tokens, 600, 'the whole file: still the newest');
    assert.equal(readContext(path.join(dir, 'missing.jsonl')), null);
    assert.equal(readContext(null), null);
    fs.writeFileSync(file, '');
    assert.equal(readContext(file), null, 'an empty transcript has no context');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ processes */

test('ps output is parsed by pid; lines of another shape are skipped', () => {
  const m = parsePs('  101   3.5  245760 01:02:03\n  202   0.0 1048576 2-03:04:05\nPID %CPU RSS ELAPSED\n\n');
  assert.deepEqual(m.get(101), { cpu: 3.5, rssKb: 245760, etime: '01:02:03' });
  assert.deepEqual(m.get(202), { cpu: 0, rssKb: 1048576, etime: '2-03:04:05' });
  assert.equal(m.size, 2);
});

test('processStats asks once for every pid, keeps output a dead pid made ps complain about, and survives no ps', async () => {
  const asked = [];
  const stats = await processStats([5, 7, 7, 'x', 0], { ps: async (pids) => (asked.push(pids), '  5  1.0  1024 00:10\n') });
  assert.deepEqual(asked, [[5, 7]]);
  assert.equal(stats.get(5).etime, '00:10');
  assert.equal(stats.has(7), false);
  const none = await processStats([5], {
    ps: async () => {
      throw new Error('no ps');
    },
  });
  assert.equal(none.size, 0);
  assert.equal((await processStats([], { ps: async () => assert.fail('must not be called') })).size, 0);
  // The real ps, on this process: a number, not a shape.
  const real = await processStats([process.pid]);
  assert.ok(real.get(process.pid)?.rssKb > 0, 'this process has memory');
});

/* ------------------------------------------------------------------ rows */

const liveRec = (n, extra = {}) => ({
  pid: 1000 + n,
  sessionId: id(n),
  cwd: `/r/repo${n}`,
  name: `repo${n} - task ${n}`,
  kind: 'interactive',
  status: 'idle',
  at: iso(NOW - 90_000),
  ...extra,
});

test('topRows: live rows carry busy/idle, process and context numbers, in the order they came — the frame orders them', () => {
  const rows = [
    { sessionId: id(1), name: 'repo1 - task 1', dir: '/r/repo1', status: 'live', workspace: 'beadcause', bead: null },
    { sessionId: id(2), name: 'repo2 - task 2', dir: '/r/repo2', status: 'live', workspace: 'loremia', bead: 'lm-p4cq' },
    { sessionId: id(3), name: 'repo3 - gone', dir: '/r/repo3', status: 'skipped', why: 'its directory is gone', workspace: null, bead: null },
  ];
  const live = [liveRec(1), liveRec(2, { status: 'busy', at: iso(NOW - 5000) })];
  const stats = new Map([
    [1001, { cpu: 12.5, rssKb: 512 * 1024, etime: '01:00:00' }],
    [1002, { cpu: 0.1, rssKb: 100 * 1024, etime: '05:00' }],
  ]);
  const context = (row) => (row.sessionId === id(2) ? { tokens: 410_000, model: 'claude-opus-4-8[1m]' } : { tokens: 50_000, model: 'claude-opus-4-8' });
  const opened = { [id(2)]: { kind: 'work', bead: 'lm-p4cq', workspace: 'loremia' } };
  const out = topRows({ rows, live, stats, context, opened, now: NOW });
  assert.deepEqual(
    out.map((r) => r.sessionId),
    [id(1), id(2), id(3)],
    'the order it was given: nothing here re-sorts on activity'
  );
  const [idle, busy, gone] = out;
  assert.equal(busy.kind, 'work');
  assert.equal(busy.activity, 'busy');
  assert.equal(busy.activityAge, '5s');
  assert.equal(busy.cpu, 0.1);
  assert.equal(busy.contextTokens, 410_000);
  assert.equal(busy.contextLimit, LARGE_CONTEXT_LIMIT);
  assert.equal(busy.contextPct, 41);
  assert.equal(idle.kind, 'adam', 'a window nothing opened is Adam\'s');
  assert.equal(idle.contextPct, 25);
  assert.equal(idle.rssKb, 512 * 1024);
  assert.equal(idle.etime, '01:00:00');
  assert.equal(gone.activity, '');
  assert.equal(gone.cpu, null);
  assert.equal(gone.contextTokens, null, 'no process, no numbers');
  assert.equal(stateWords(busy), 'busy 5s');
  assert.equal(stateWords(idle), 'idle 2m');
  assert.match(stateWords(gone), /^skipped — its directory is gone/);
});

/* ------------------------------------------------------------------ order */

const orderRows = () =>
  topRows({
    rows: [
      { sessionId: id(1), name: 'Northwind - b', dir: '/r/architecture', status: 'live', workspace: 'architecture', bead: null, transcriptAt: iso(NOW - 10_000) },
      { sessionId: id(2), name: 'beadcause - a', dir: '/r/beadcause', status: 'live', workspace: 'beadcause', bead: 'bc-1', transcriptAt: iso(NOW - 90_000) },
      { sessionId: id(3), name: 'Northwind - a', dir: '/r/architecture/.claude/worktrees/x', status: 'live', workspace: 'architecture', bead: null, transcriptAt: null },
      { sessionId: id(4), name: 'delmar - gone', dir: '/r/delmar', status: 'skipped', why: 'its directory is gone', workspace: 'delmar', bead: 'dv-9' },
    ],
    live: [liveRec(1, { status: 'busy', at: iso(NOW - 5000) }), liveRec(2), liveRec(3, { status: 'busy', at: iso(NOW - 60_000) })],
    stats: new Map([
      [1001, { cpu: 1.5, rssKb: 300 * 1024, etime: '01:00:00' }],
      [1002, { cpu: 40.0, rssKb: 100 * 1024, etime: '2-00:00:00' }],
      [1003, { cpu: 0.0, rssKb: 900 * 1024, etime: '00:30' }],
    ]),
    context: (row) => (row.sessionId === id(2) ? { tokens: 500_000, model: 'x' } : row.sessionId === id(1) ? { tokens: 50_000, model: 'x' } : null),
    now: NOW,
  });

test('sortRows: the default is workspace then name; live rows first; the same answer on every frame', () => {
  const ids = (rows) => rows.map((r) => r.sessionId);
  assert.deepEqual(ids(sortRows(orderRows())), [id(3), id(1), id(2), id(4)], 'architecture a, architecture b, beadcause a; the not-back row last');
  assert.deepEqual(DEFAULT_SORT, { by: 'ws', reverse: false });
  assert.deepEqual(ids(sortRows(orderRows(), DEFAULT_SORT)), ids(sortRows([...orderRows()].reverse())), 'input order does not leak through');
  // Going busy does not move a row: the same rows a frame later, one of them now busy.
  const later = orderRows().map((r) => (r.sessionId === id(2) ? { ...r, activity: 'busy', activityAt: iso(NOW) } : r));
  assert.deepEqual(ids(sortRows(later)), ids(sortRows(orderRows())));
});

test('sortRows: by a number, blanks last either way up; by text, case-blind; by state, busy first; by up, days beat hours', () => {
  const ids = (rows) => rows.map((r) => r.sessionId);
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'cpu' })), [id(3), id(1), id(2), id(4)]);
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'cpu', reverse: true })), [id(2), id(1), id(3), id(4)], 'the not-back row has no cpu and stays last');
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'ctx' })), [id(1), id(2), id(3), id(4)], 'no transcript, no context: after the numbers');
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'ctx', reverse: true })), [id(2), id(1), id(3), id(4)]);
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'mem', reverse: true })), [id(3), id(1), id(2), id(4)]);
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'up', reverse: true })), [id(2), id(1), id(3), id(4)], 'two days, an hour, thirty seconds');
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'last' })), [id(2), id(1), id(3), id(4)], 'oldest write first; none last');
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'session' })), [id(2), id(3), id(1), id(4)], 'beadcause - a, Northwind - a, Northwind - b: case does not count');
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'state' })), [id(1), id(3), id(2), id(4)], 'busy (most recently) first, then idle');
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'bead' })), [id(3), id(1), id(2), id(4)], 'no bead sorts as the empty string, before bc-1');
  assert.deepEqual(ids(sortRows(orderRows(), { by: 'nonsense' })), ids(sortRows(orderRows())), 'an unknown column is the default');
  assert.equal(Object.keys(SORTS).length, COLUMNS.length, 'every column orders');
  for (const c of COLUMNS) assert.ok(SORTS[c.id], `${c.id} has a sort`);
});

test('etimeSeconds reads every shape ps prints', () => {
  assert.equal(etimeSeconds('05:12'), 312);
  assert.equal(etimeSeconds('01:02:03'), 3723);
  assert.equal(etimeSeconds('2-03:04:05'), 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.equal(etimeSeconds(''), null);
  assert.equal(etimeSeconds('soon'), null);
});

test('nextSort steps through the columns in table order and wraps', () => {
  assert.equal(nextSort('ws', 1), 'bead');
  assert.equal(nextSort('ws', -1), 'session');
  assert.equal(nextSort('session', -1), 'last');
  assert.equal(nextSort('last', 1), 'session');
  assert.equal(nextSort('nonsense', 1), 'ws', 'an unknown column steps from the first');
});

/* ------------------------------------------------------------------ focus */

test('ttyPath and ttyOf: a tty from ps, /dev/ in front; ?? is no terminal; a bad pid asks nothing', async () => {
  assert.equal(ttyPath('ttys012\n'), '/dev/ttys012');
  assert.equal(ttyPath('  ttys003 '), '/dev/ttys003');
  assert.equal(ttyPath('??'), null);
  assert.equal(ttyPath(''), null);
  assert.equal(ttyPath('ttys012; rm -rf /'), null, 'nothing but a tty name reaches osascript');
  const asked = [];
  assert.equal(await ttyOf(4242, { ps: async (pid) => (asked.push(pid), 'ttys007\n') }), '/dev/ttys007');
  assert.deepEqual(asked, [4242]);
  assert.equal(await ttyOf('x', { ps: async () => assert.fail('must not be called') }), null);
  assert.equal(
    await ttyOf(1, {
      ps: async () => {
        throw new Error('no ps');
      },
    }),
    null
  );
  assert.equal(await ttyOf(process.pid), ttyPath(spawnSync('ps', ['-o', 'tty=', '-p', String(process.pid)], { encoding: 'utf8' }).stdout), 'the real ps, on this process');
});

test('focusRow: a live row reaches its tab by tty; a row with no process, no terminal or no iTerm window says so', async () => {
  const calls = [];
  const live = { sessionId: id(1), name: 'Northwind - SOC 2', status: 'live', pid: 4242 };
  const doors = { ps: async () => 'ttys012\n', focus: async (tty) => (calls.push(tty), [0, 0, 800, 600]) };
  assert.equal(await focusRow(live, doors), 'focused Northwind - SOC 2');
  assert.deepEqual(calls, ['/dev/ttys012']);
  assert.equal(await focusRow(live, { ...doors, focus: async () => null }), 'Northwind - SOC 2: no iTerm window has /dev/ttys012');
  assert.equal(await focusRow(live, { ...doors, ps: async () => '??' }), 'Northwind - SOC 2: its process has no terminal');
  assert.equal(
    await focusRow(live, {
      ...doors,
      focus: async () => {
        throw new Error('iTerm said no\nmore');
      },
    }),
    'Northwind - SOC 2: iTerm said no'
  );
  const gone = { sessionId: id(3), name: 'delmar - refs', status: 'skipped', why: 'its directory is gone' };
  assert.match(await focusRow(gone, doors), /^delmar - refs: no process to focus — skipped — its directory is gone/);
  assert.equal(await focusRow(null, doors), 'nothing selected');
});

test('the short words', () => {
  assert.equal(shortAge(iso(NOW - 12_000), NOW), '12s');
  assert.equal(shortAge(iso(NOW - 5 * 60_000), NOW), '5m');
  assert.equal(shortAge(iso(NOW - 3 * 3_600_000), NOW), '3h');
  assert.equal(shortAge(iso(NOW - 5 * 86_400_000), NOW), '5d');
  assert.equal(shortAge(null, NOW), '');
  assert.equal(fmtTokens(412_345), '412k');
  assert.equal(fmtTokens(1_250_000), '1.3M');
  assert.equal(fmtTokens(999), '999');
  assert.equal(fmtTokens(null), '');
  assert.equal(fmtMem(512 * 1024), '512M');
  assert.equal(fmtMem(1.5 * 1024 * 1024), '1.5G');
  assert.equal(fmtMem(null), '');
});

/* ------------------------------------------------------------------ the frame */

const frameRows = () =>
  topRows({
    rows: [
      { sessionId: id(1), name: 'Northwind - a very long session name that will not fit in a narrow terminal at all', dir: '/r/architecture/.claude/worktrees/soc2-e4b', status: 'live', workspace: 'architecture', bead: 'cl-xl7n.195', transcriptAt: iso(NOW - 30_000) },
      { sessionId: id(2), name: 'EHDEN - pods', dir: '/r/ehden', status: 'live', workspace: 'ehden', bead: null, transcriptAt: iso(NOW - 3_600_000) },
      { sessionId: id(3), name: 'loremia - refs', dir: '/r/loremia', status: 'reopened', workspace: 'loremia', bead: 'lm-p4cq' },
    ],
    live: [liveRec(1, { status: 'busy', at: iso(NOW - 2000) }), liveRec(2)],
    stats: new Map([[1001, { cpu: 45.2, rssKb: 900 * 1024, etime: '03:12:00' }]]),
    context: () => ({ tokens: 123_456, model: 'claude-opus-4-8' }),
    now: NOW,
  });

test('renderTop: a header that counts, a boot line for this boot only, the table, and nothing wider than the terminal', () => {
  const boot = NOW - 600_000;
  const report = { boot: iso(boot + 300), at: iso(boot + 60_000), rows: [{ outcome: 'reopened' }, { outcome: 'reopened' }, { outcome: 'skipped' }] };
  const register = { polledAt: iso(NOW - 45_000), sessions: {} };
  // Wide enough that nothing gives way; the narrow case is the next test.
  const lines = renderTop({ rows: frameRows(), report, register, boot, now: NOW, width: 220 });
  assert.match(lines[0], /^beadcause-top {2}· {2}2 live \(1 busy, 1 idle\), 1 not back {2}· {2}booted 10 minutes ago {2}· {2}register 45s ago/);
  assert.match(lines[1], /^boot pass 9 minutes ago: 2 reopened, 1 skipped$/);
  assert.equal(lines[2], '');
  assert.deepEqual(
    lines[3].trim().split(/\s{2,}/),
    COLUMNS.map((c) => (c.id === 'ws' ? 'ws ▲' : c.head)),
    'the sorted column wears the arrow'
  );
  const bySession = renderTop({ rows: frameRows(), report, register, boot, now: NOW, width: 220, sort: { by: 'session', reverse: true } });
  assert.match(bySession[3], /^session ▼/);
  assert.ok(!bySession[3].includes('ws ▲'));
  const row1 = lines[5];
  assert.match(row1, /Northwind - a very long session name/);
  assert.match(row1, /architecture +cl-xl7n\.195 +adam +busy 2s +123k 62% +45\.2% +900M +03:12:00 +architecture ⟶ soc2-e4b +30s/);
  assert.match(lines[6], /EHDEN - pods +ehden +adam +idle 2m/);
  assert.match(lines[7], /loremia - refs +loremia +lm-p4cq +adam +reopened/);
  assert.equal(lines.length, 8, 'no footer when not interactive');
  for (const l of lines) assert.ok(dw(l) <= 220, `too wide: ${l}`);

  const old = renderTop({ rows: frameRows(), report: { ...report, boot: iso(boot - 86_400_000) }, register, boot, now: NOW, width: 220 });
  assert.equal(old[1], 'no reboot pass has run for this boot', 'last boot\'s report says nothing about today');
});

test('renderTop: a narrow terminal cuts the directory first, then the session name, and a short one counts the rows it cannot draw', () => {
  // 190: the directory gives way and the name still fits whole.
  const mid = renderTop({ rows: frameRows(), boot: NOW - 600_000, now: NOW, width: 190 });
  for (const l of mid) assert.ok(dw(l) <= 190, `too wide at 190: ${l}`);
  assert.ok(mid.some((l) => l.includes('narrow terminal at all')), 'the name is whole');
  assert.ok(!mid.some((l) => l.includes('architecture ⟶ soc2-e4b')), 'the directory was cut first');
  // 100: the directory is at its floor, so the name gives way too.
  const narrow = renderTop({ rows: frameRows(), boot: NOW - 600_000, now: NOW, width: 100 });
  for (const l of narrow) assert.ok(dw(l) <= 100, `too wide at 100: ${l}`);
  assert.ok(narrow.some((l) => /architecture +cl-xl7n\.195 +adam +busy 2s/.test(l)), 'every other column survives');
  assert.ok(!narrow.some((l) => l.includes('narrow terminal at all')), 'the long name gave way');
  assert.ok(narrow.some((l) => /Northwind - a ve/.test(l)), 'but not below its floor');
  // Eight lines: two of header, a blank, two of table head, one row, the count, the footer.
  const short = renderTop({ rows: frameRows(), boot: NOW - 600_000, now: NOW, width: 160, height: 8, interactive: true });
  assert.equal(short.length, 8);
  assert.match(short[5], /Northwind/);
  assert.match(short.at(-2), /^… and 2 more$/);
  assert.match(short.at(-1), /^q quit · r refresh · ↑↓ select · f focus · ←→ sort column · o reverse · every 3s$/);
  const picked = renderTop({ rows: frameRows(), boot: NOW - 600_000, now: NOW, width: 160, interactive: true, selected: id(2), notice: 'focused EHDEN - pods' });
  const bar = picked.slice(4).find((l) => l.includes('EHDEN - pods')); // past the header, which carries the notice
  assert.ok(bar.startsWith('\x1b[7m') && bar.endsWith('\x1b[0m'), 'the selected row is in inverse video');
  assert.ok(!picked.find((l) => l.includes('Northwind')).includes('\x1b[7m'), 'and only that row');
  assert.ok(dw(bar.replace(/\x1b\[[0-9;]*m/g, '')) <= 160, 'the bar does not widen the line');
  assert.match(picked[0], /·  focused EHDEN - pods$/, 'the notice rides the header line');
  const empty = renderTop({ rows: [], boot: NOW - 600_000, now: NOW, width: 80 });
  assert.match(empty.at(-1), /^no sessions/);
});

test('the monitor\'s window key is its own, never a configured workspace\'s and never the shared one', () => {
  assert.equal(homeKey(TOP_WINDOW), 'beadcause-top');
  assert.notEqual(homeKey(TOP_WINDOW), homeKey(null));
  assert.notEqual(homeKey(TOP_WINDOW), homeKey('beadcause'));
});

/* ------------------------------------------------------------------ the loop */

test('runTop --once draws one frame to the stream it is given and resolves; a failing collect still draws', async () => {
  let out = '';
  const stream = { write: (s) => (out += s), isTTY: false, columns: 120 };
  const rows = frameRows();
  const code = await runTop({ collect: async () => ({ rows, boot: NOW - 600_000 }), once: true, out: stream, input: { isTTY: false }, now: () => NOW });
  assert.equal(code, 0);
  assert.match(out, /^beadcause-top {2}· {2}2 live/);
  assert.ok(!out.includes('\x1b[?1049h'), 'no alternate screen for a single frame');
  let bad = '';
  await runTop({
    collect: async () => {
      throw new Error('ps exploded\nmore');
    },
    once: true,
    out: { write: (s) => (bad += s), isTTY: false, columns: 120 },
    input: { isTTY: false },
    now: () => NOW,
  });
  assert.match(bad.split('\n')[0], /ps exploded$/);
  assert.match(bad, /no sessions/);
});

/**
 * A terminal in the hand: `input` is a raw-mode tty that emits keys, `out` a tty that
 * records frames. `collect` hands back the same rows every tick, so what moves is only
 * what a key moved.
 */
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
  const barOn = () => {
    const m = /\x1b\[7m([^\x1b]*)\x1b\[0m/.exec(latest());
    return m ? m[1].trim().split(/\s{2,}/)[0] : null;
  };
  return { input, out, frames, press, latest, barOn, tick };
}

test('runTop: arrows move the bar, f focuses the row under it, ←→ and o change the order, q quits — through injected doors', async () => {
  const t = terminal();
  const focused = [];
  const rows = orderRows();
  const ended = runTop({
    collect: async () => ({ rows, boot: NOW - 600_000 }),
    every: 60_000,
    out: t.out,
    input: t.input,
    alt: false,
    now: () => NOW,
    focus: async (row) => (focused.push(row?.sessionId || null), row ? `focused ${row.name}` : 'nothing selected'),
  });
  await t.tick();
  await t.tick();
  assert.equal(t.input.raw, true, 'raw mode, for single keys');
  assert.equal(t.barOn(), 'Northwind - a', 'the first row in the default order');
  await t.press('\x1b[B');
  assert.equal(t.barOn(), 'Northwind - b');
  await t.press('j');
  assert.equal(t.barOn(), 'beadcause - a');
  await t.press('\x1b[B');
  await t.press('\x1b[B');
  assert.equal(t.barOn(), 'delmar - gone', 'clamped at the last row');
  await t.press('k');
  await t.press('\x1b[A');
  assert.equal(t.barOn(), 'Northwind - b');

  await t.press('f');
  assert.deepEqual(focused, [id(1)], 'f hands the row under the bar to the focus door');
  assert.match(t.latest().split('\n')[0], /·  focused Northwind - b$/);
  await t.press('\r');
  assert.deepEqual(focused, [id(1), id(1)], 'Enter is f');

  // The order changes under the bar; the bar stays on its conversation.
  await t.press('\x1b[C');
  assert.match(t.latest().split('\n')[3], /bead ▲/, 'one column right of ws');
  assert.equal(t.barOn(), 'Northwind - b', 'still on the same session');
  await t.press('o');
  assert.match(t.latest().split('\n')[3], /bead ▼/);
  await t.press('h');
  assert.match(t.latest().split('\n')[3], /ws ▲/, 'back, and the other way up is forgotten');
  for (const _ of 'bead kind state ctx cpu'.split(' ')) await t.press('l');
  assert.match(t.latest().split('\n')[3], /cpu ▲/);
  const order = t
    .latest()
    .split('\n')
    .slice(5, 9)
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim().split(/\s{2,}/)[0]);
  assert.deepEqual(order, ['Northwind - a', 'Northwind - b', 'beadcause - a', 'delmar - gone'], 'cpu ascending, the not-back row last');

  await t.press('q');
  assert.equal(await ended, 0);
  assert.equal(t.input.raw, false, 'raw mode given back');
});

test('runTop: the bar follows a session that moves and lands on the first row when its session leaves', async () => {
  const t = terminal();
  let rows = orderRows();
  const ended = runTop({ collect: async () => ({ rows, boot: NOW - 600_000 }), every: 60_000, out: t.out, input: t.input, alt: false, now: () => NOW, focus: async () => 'x' });
  await t.tick();
  await t.tick();
  await t.press('j');
  assert.equal(t.barOn(), 'Northwind - b');
  rows = rows.map((r) => (r.sessionId === id(1) ? { ...r, name: 'Northwind - z' } : r));
  await t.press('r');
  assert.equal(t.barOn(), 'Northwind - z', 'renamed and re-sorted, still the same session');
  rows = rows.filter((r) => r.sessionId !== id(1));
  await t.press('r');
  assert.equal(t.barOn(), 'Northwind - a', 'its session left: the bar lands on the first row');
  await t.press('\u0003');
  assert.equal(await ended, 0);
});

/* ------------------------------------------------------------------ the command */

test('bin/beadcause-top --once and --json on an isolated config directory: this process is a row, with its context and cpu; nothing is written', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-top-'));
  try {
    const config = path.join(tmp, 'config');
    const sessions = path.join(tmp, 'sessions');
    const projects = path.join(tmp, 'projects');
    for (const d of [config, sessions, projects]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(
      path.join(config, 'config.json'),
      JSON.stringify({ token: 'x', claudeSessionsDir: sessions, claudeProjectsDir: projects, ntfy: { enabled: false } }, null, 2)
    );
    const cwd = '/r/beadcause/.claude/worktrees/top-m3k';
    fs.writeFileSync(
      path.join(sessions, `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, sessionId: id(1), cwd, kind: 'interactive', name: 'beadcause - bc-5to5r.7 top', status: 'busy', startedAt: Date.now() - 60_000, statusUpdatedAt: Date.now() - 4000 })
    );
    fs.writeFileSync(path.join(sessions, '999999.json'), JSON.stringify({ pid: 999999, sessionId: id(9), cwd: '/r/gone', kind: 'interactive', name: 'gone' }));
    const folder = path.join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${id(1)}.jsonl`), `${JSON.stringify({ type: 'assistant', cwd })}\n${usageLine({ input: 2000, read: 60_000, create: 8000 })}\n`);
    fs.writeFileSync(path.join(config, 'state.json'), JSON.stringify({ opened: { [id(1)]: { kind: 'work', bead: 'bc-5to5r.7', workspace: 'beadcause' } } }));
    const digest = () =>
      crypto
        .createHash('sha256')
        .update(fs.readdirSync(config).sort().map((f) => `${f}:${fs.readFileSync(path.join(config, f))}`).join('\n'))
        .digest('hex');
    const before = digest();
    // Piped, so no terminal width: COLUMNS stands in for it, as it does for `ps` and `ls`.
    const run = (...args) =>
      spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, BEADCAUSE_CONFIG_DIR: config, CLAUDE_CTX_LIMIT: '', COLUMNS: '200' } });

    const once = run('--once');
    assert.equal(once.status, 0, once.stderr);
    assert.match(once.stdout, /^beadcause-top {2}· {2}1 live \(1 busy, 0 idle\)/);
    assert.match(once.stdout, /beadcause - bc-5to5r\.7 top +beadcause +bc-5to5r\.7 +work +busy \d+s +70k 35% +\d+\.\d% +\d+M +\S+ +beadcause ⟶ top-m3k/);
    const narrow = run('--once').stdout;
    assert.ok(narrow.split('\n').every((l) => dw(l) <= 200), 'nothing wider than COLUMNS');
    assert.ok(!once.stdout.includes('gone'), 'a dead pid is not a session');
    assert.ok(!once.stdout.includes('\x1b[?1049h'), 'no alternate screen when piped');

    const json = run('--json');
    assert.equal(json.status, 0, json.stderr);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].contextTokens, 70_000);
    assert.equal(parsed.rows[0].kind, 'work');
    assert.equal(parsed.rows[0].pid, process.pid);
    assert.ok(parsed.rows[0].rssKb > 0);

    const bad = run('--nope');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unknown argument --nope/);
    const everyBad = run('--every', 'soon');
    assert.equal(everyBad.status, 2);
    const sortBad = run('--sort', 'colour');
    assert.equal(sortBad.status, 2);
    assert.match(sortBad.stderr, /--sort wants one of session, ws/);
    const sorted = JSON.parse(run('--json', '--sort', 'cpu', '--reverse').stdout);
    assert.deepEqual(sorted.sort, { by: 'cpu', reverse: true });
    const marked = run('--once', '--sort', 'mem').stdout;
    assert.match(marked.split('\n')[3], /mem ▲/);
    const help = run('--help');
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^usage: beadcause-top/);
    assert.equal(digest(), before, 'the command wrote nothing under the config directory');

    // The collector itself, on the same fixture, through its injected doors — the config
    // handed to it directly, because lib/config.js reads BEADCAUSE_CONFIG_DIR once at import.
    const cfg = { claudeSessionsDir: sessions, claudeProjectsDir: projects };
    const got = await collectTop({
      cfg,
      loadState: () => ({ opened: {} }),
      loadRegister: () => ({ polledAt: null, sessions: {} }),
      ps: async () => `${process.pid} 1.0 2048 00:01\n`,
    });
    assert.equal(got.rows.length, 1);
    assert.equal(got.rows[0].cpu, 1.0);
    assert.equal(got.rows[0].contextTokens, 70_000);
    assert.equal(got.rows[0].kind, 'adam', 'with nothing in opened, the window is Adam\'s');
  } finally {
    removeTreeSync(tmp);
  }
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
