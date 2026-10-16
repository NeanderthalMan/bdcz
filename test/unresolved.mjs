#!/usr/bin/env node
/**
 * The unresolved sessions, and resuming a workspace's on request — lib/unresolved.js.
 *
 *     npm test
 *     node test/unresolved.mjs
 *
 * bc-wsgj6, the terminal half. Four things are pinned, each of which would fail silently:
 *
 * 1. **The predicate is the one written down.** `isUnresolved` is the whole answer to
 *    bc-r2hmt's question, and a drift in it — a `DONE-` window listed, an unnamed headless
 *    run listed, a reopened window offered for a second resume while its process is still
 *    coming up — would show as a longer or shorter list and nothing else.
 * 2. **A transcript's title is found past the first 64KB.** The title line is written at the
 *    top of a turn and the tool results after it can run to megabytes; a reader that stopped
 *    at the tail would list every long session as unnamed, which is to say not at all.
 * 3. **The plan refuses the same four things the boot pass does** — running, parked, gone,
 *    over the cap — and never another workspace's windows.
 * 4. **The resume writes the report the name restore reads**, in the boot pass's row shape,
 *    accumulated within a boot, so a window brought back on request gets its name the way one
 *    brought back at boot does (bc-5to5r.8).
 *
 * Every door is injected; the one that opens a window is a function that counts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REOPEN_SETTLE_MS,
  UNRESOLVED_LOOKBACK_MS,
  collectSessionRows,
  isUnresolved,
  planResume,
  resumeUnresolved,
  tailCache,
} from '../lib/unresolved.js';
import { MAX_RESUMED, scanTranscripts, tailFacts } from '../lib/rebootresume.js';
import { namesToRestore, sessionRows, statusWords } from '../lib/sessionregister.js';
import { removeTreeSync } from './helpers/tmp.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const id = (n) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`;
const NOW = Date.parse('2026-10-12T21:00:00Z');
const BOOT = NOW - 6 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const closed = (n, extra = {}) => ({
  sessionId: id(n),
  name: `repo${n} - task ${n}`,
  dir: `/r/repo${n}`,
  workspace: `ws${n}`,
  status: 'closed',
  transcriptAt: iso(NOW - n * 60_000),
  ...extra,
});

/* ------------------------------------------------------------------ the predicate */

test('isUnresolved: named, not done-, no process, not parked, with a transcript', () => {
  assert.equal(isUnresolved(closed(1), NOW), true);
  assert.equal(isUnresolved(closed(1, { status: 'gone' }), NOW), true, 'the register has not dropped it yet — same thing');
  assert.equal(isUnresolved(closed(1, { status: 'skipped', why: 'over the cap of 12 windows' }), NOW), true);
  assert.equal(isUnresolved(closed(1, { status: 'failed' }), NOW), true);
  assert.equal(isUnresolved(closed(1, { status: 'waiting' }), NOW), true);
  assert.equal(isUnresolved(closed(1, { name: '' }), NOW), false, 'a session that never named itself was never sat at');
  assert.equal(isUnresolved(closed(1, { name: 'done- repo1 - task' }), NOW), false);
  assert.equal(isUnresolved(closed(1, { name: 'DONE-repo1 - task' }), NOW), false);
  assert.equal(isUnresolved(closed(1, { status: 'live' }), NOW), false);
  assert.equal(isUnresolved(closed(1, { status: 'parked' }), NOW), false, 'an advocate brings that one back');
  assert.equal(isUnresolved(closed(1, { transcriptAt: null }), NOW), false, 'nothing for --resume to restore');
  assert.equal(isUnresolved(null, NOW), false);
});

test('isUnresolved: a window a pass reopened is given time to come up, then counts as closed again', () => {
  const fresh = closed(1, { status: 'reopened', decidedAt: iso(NOW - 10_000) });
  assert.equal(isUnresolved(fresh, NOW), false, 'ten seconds in, its record is still on its way');
  const old = closed(1, { status: 'reopened', decidedAt: iso(NOW - REOPEN_SETTLE_MS - 1000) });
  assert.equal(isUnresolved(old, NOW), true, 'not live after the settle: it was closed again, or never came up');
  assert.equal(isUnresolved(closed(1, { status: 'reopened' }), NOW), false, 'no decision stamp, no guess');
});

/* ------------------------------------------------------------- reading the title */

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-unresolved-'));
process.on('exit', () => removeTreeSync(scratch));

const line = (rec) => `${JSON.stringify(rec)}\n`;
const filler = (bytes) => {
  const unit = line({ type: 'tool_result', content: 'x'.repeat(900) });
  let out = '';
  while (out.length < bytes) out += unit;
  return out;
};

test('tailFacts: the title is the last custom-title line even when it is megabytes before the end', () => {
  const file = path.join(scratch, 'long.jsonl');
  fs.writeFileSync(
    file,
    line({ type: 'custom-title', customTitle: 'old - first name', cwd: '/r/start' }) +
      line({ type: 'custom-title', customTitle: 'repo - the real name' }) +
      filler(700 * 1024) +
      line({ type: 'assistant', cwd: '/r/repo/.claude/worktrees/x-k4t' }) +
      filler(10 * 1024)
  );
  const st = fs.statSync(file);
  const facts = tailFacts(file, st.size, st.mtimeMs);
  assert.equal(facts.title, 'repo - the real name');
  assert.equal(facts.cwd, '/r/repo/.claude/worktrees/x-k4t', 'the last cwd, from the tail');
});

test('tailFacts: a title line that straddles a chunk boundary is still read whole', () => {
  const file = path.join(scratch, 'straddle.jsonl');
  const title = line({ type: 'custom-title', customTitle: 'repo - straddling the boundary' });
  // The chunk is read from the end: put the title so the 64KB boundary falls inside it.
  const after = filler(64 * 1024 - 20);
  fs.writeFileSync(file, filler(5000) + title + after);
  const st = fs.statSync(file);
  assert.equal(tailFacts(file, st.size, st.mtimeMs).title, 'repo - straddling the boundary');
});

test('tailFacts: no title is an empty title, and a missing file is nothing at all', () => {
  const file = path.join(scratch, 'untitled.jsonl');
  fs.writeFileSync(file, line({ type: 'assistant', cwd: '/r/one' }));
  const st = fs.statSync(file);
  assert.deepEqual(tailFacts(file, st.size, st.mtimeMs), { cwd: '/r/one', title: '' });
  assert.deepEqual(tailFacts(path.join(scratch, 'none.jsonl'), 10, 0), { cwd: null, title: '' });
  assert.deepEqual(tailFacts(file, 0, 0), { cwd: null, title: '' });
});

test('tailCache: the same size and mtime are not read twice; a changed file is', () => {
  const file = path.join(scratch, 'cached.jsonl');
  fs.writeFileSync(file, line({ type: 'custom-title', customTitle: 'repo - one', cwd: '/r/a' }));
  const st = fs.statSync(file);
  const tail = tailCache();
  assert.equal(tail(file, st.size, st.mtimeMs).title, 'repo - one');
  // Rewritten with the same byte count: the cache, keyed on size and mtime, still answers
  // the old title — which is the point of the test, since it proves nothing was re-read.
  fs.writeFileSync(file, line({ type: 'custom-title', customTitle: 'repo - two', cwd: '/r/a' }));
  assert.equal(tail(file, st.size, st.mtimeMs).title, 'repo - one');
  assert.equal(tail(file, st.size, st.mtimeMs + 1000).title, 'repo - two', 'a new mtime is a new read');
});

test('scanTranscripts carries the title, through an injected tail', () => {
  const root = path.join(scratch, 'projects');
  const folder = path.join(root, '-r-repo');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${id(1)}.jsonl`), line({ type: 'custom-title', customTitle: 'repo - scanned', cwd: '/r/repo' }));
  const rows = scanTranscripts({ claudeProjectsDir: root });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'repo - scanned');
  assert.equal(rows[0].dir, '/r/repo');
  const injected = scanTranscripts({ claudeProjectsDir: root }, { tail: () => ({ cwd: '/elsewhere', title: 'from the door' }) });
  assert.equal(injected[0].title, 'from the door');
  assert.equal(injected[0].dir, '/elsewhere');
});

/* --------------------------------------------------------------------- the rows */

test('sessionRows: a transcript nothing else knows is a closed row, and anything else known wins', () => {
  const transcripts = [
    { sessionId: id(1), dir: '/r/one', title: 'one - closed', mtime: NOW - 3600_000 },
    { sessionId: id(2), dir: '/r/two', title: 'two - still open', mtime: NOW - 60_000 },
    { sessionId: id(3), dir: null, title: 'no dir', mtime: NOW },
  ];
  const live = [{ pid: 1, sessionId: id(2), cwd: '/r/two', name: 'two - renamed since', kind: 'interactive' }];
  const rows = sessionRows({ register: { sessions: {} }, report: null, live, transcripts, boot: BOOT, now: NOW });
  const one = rows.find((r) => r.sessionId === id(1));
  const two = rows.find((r) => r.sessionId === id(2));
  assert.equal(one.status, 'closed');
  assert.equal(one.name, 'one - closed');
  assert.equal(one.transcriptAt, iso(NOW - 3600_000), 'the scan already knows the mtime — no stat needed');
  assert.equal(two.status, 'live');
  assert.equal(two.name, 'two - renamed since', 'the live record is fresher than the transcript');
  assert.equal(rows.find((r) => r.sessionId === id(3)), undefined, 'no directory, nothing to resume in');
  assert.equal(statusWords(one), 'closed');
});

test('sessionRows: the resume report is read after the boot report, stamped, and only for this boot', () => {
  const report = {
    boot: iso(BOOT),
    at: iso(BOOT + 60_000),
    rows: [{ sessionId: id(1), name: 'one - at boot', dir: '/r/one', outcome: 'skipped', why: 'over the cap of 12 windows' }],
  };
  const resumeReport = {
    boot: iso(BOOT),
    at: iso(NOW - 30_000),
    rows: [{ sessionId: id(1), name: 'one - at boot', dir: '/r/one', outcome: 'reopened', why: 'resumed on request' }],
  };
  const rows = sessionRows({ register: { sessions: {} }, report, resumeReport, live: [], boot: BOOT, now: NOW });
  assert.equal(rows[0].status, 'reopened');
  assert.equal(rows[0].decidedAt, iso(NOW - 30_000));
  assert.equal(statusWords(rows[0]), 'reopened — resumed on request');
  const stale = sessionRows({ register: { sessions: {} }, report, resumeReport: { ...resumeReport, boot: iso(BOOT - 86_400_000) }, live: [], boot: BOOT, now: NOW });
  assert.equal(stale[0].status, 'skipped', "yesterday's resume says nothing about today");
});

test('collectSessionRows: transcripts within the lookback become rows, the predicate is decided on each', () => {
  const root = path.join(scratch, 'collect');
  const sessionsDir = path.join(scratch, 'collect-sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const write = (n, cwd, title, age) => {
    const folder = path.join(root, cwd.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${id(n)}.jsonl`);
    fs.writeFileSync(file, (title ? line({ type: 'custom-title', customTitle: title }) : '') + line({ type: 'assistant', cwd }));
    fs.utimesSync(file, (NOW - age) / 1000, (NOW - age) / 1000);
  };
  write(1, '/r/a', 'a - set aside', 3600_000);
  write(2, '/r/b', 'DONE-b - shipped', 3600_000);
  write(3, '/r/c', '', 3600_000);
  write(4, '/r/d', 'd - last month', UNRESOLVED_LOOKBACK_MS + 86_400_000);
  const got = collectSessionRows(
    { claudeProjectsDir: root, claudeSessionsDir: sessionsDir },
    { loadState: () => ({}), loadRegister: () => ({ polledAt: null, sessions: {} }), liveSessions: () => [], booted: () => BOOT, now: () => NOW }
  );
  const by = Object.fromEntries(got.rows.map((r) => [r.sessionId, r]));
  assert.equal(by[id(1)].unresolved, true);
  assert.equal(by[id(2)].unresolved, false, 'shipped');
  assert.equal(by[id(3)].unresolved, false, 'never named');
  assert.equal(by[id(4)], undefined, 'past the lookback it is the /resume archive');
  assert.equal(got.boot, BOOT);
});

/* --------------------------------------------------------------------- the plan */

test('planResume: one workspace, unresolved only, and the four refusals', () => {
  const rows = [
    closed(1, { workspace: 'sorrel' }),
    closed(2, { workspace: 'sorrel', status: 'live' }),
    closed(3, { workspace: 'ehden' }),
    closed(4, { workspace: 'sorrel' }),
    closed(5, { workspace: 'sorrel' }),
    closed(6, { workspace: 'sorrel', name: 'DONE-sorrel - shipped' }),
    closed(7, { workspace: 'sorrel' }),
  ];
  const plan = planResume({
    rows,
    workspace: 'sorrel',
    live: [{ sessionId: id(4) }],
    parked: { 'sorrel/sp-1': { sessionId: id(5) } },
    exists: (dir) => dir !== '/r/repo7',
    now: NOW,
  });
  assert.deepEqual(
    plan.open.map((r) => r.sessionId),
    [id(1)]
  );
  assert.deepEqual(
    plan.skipped.map((r) => [r.sessionId, r.why]),
    [
      [id(4), 'it is already running'],
      [id(5), 'it is parked — its advocate brings it back'],
      [id(7), 'its directory is gone — the worktree was retired'],
    ]
  );
  assert.ok(!plan.skipped.some((r) => r.sessionId === id(3)), "another workspace's window is not even mentioned");
});

test('planResume: newest first, and the cap is MAX_RESUMED', () => {
  const rows = [];
  for (let n = 1; n <= MAX_RESUMED + 3; n += 1) rows.push(closed(n, { workspace: 'w' }));
  const plan = planResume({ rows, workspace: 'w', now: NOW });
  assert.equal(plan.open.length, MAX_RESUMED);
  assert.equal(plan.open[0].sessionId, id(1), 'the most recently written transcript comes first');
  assert.equal(plan.skipped.length, 3);
  assert.match(plan.skipped[0].why, /over the cap of 12 windows/);
  assert.equal(planResume({ rows, workspace: 'w', max: 2, now: NOW }).open.length, 2);
});

/* -------------------------------------------------------------------- the resume */

const store = (initial = {}) => {
  let state = { ...initial };
  return {
    state: () => state,
    loadState: () => state,
    saveState: (patch) => {
      state = { ...state, ...patch };
    },
  };
};

test('resumeUnresolved: opens each window in its directory under its name, and writes the report in the boot pass shape', async () => {
  const s = store({});
  const opened = [];
  const rows = [closed(1, { workspace: 'sorrel', bead: 'sp-1' }), closed(2, { workspace: 'sorrel' }), closed(3, { workspace: 'sorrel' })];
  const out = await resumeUnresolved(
    {},
    {
      workspace: 'sorrel',
      ...s,
      liveSessions: () => [{ sessionId: id(3) }],
      openWindow: async (_cfg, win) => {
        opened.push(win);
        if (win.sessionId === id(2)) throw new Error('iTerm said no\nand more');
      },
      rows,
      // The fixture directories are names, not places; the directory check is planResume's.
      exists: () => true,
      now: NOW,
      booted: () => BOOT,
    }
  );
  assert.deepEqual(
    opened.map((w) => [w.sessionId, w.dir, w.title, w.workspace]),
    [
      [id(1), '/r/repo1', 'repo1 - task 1', 'sorrel'],
      [id(2), '/r/repo2', 'repo2 - task 2', 'sorrel'],
    ]
  );
  assert.equal(out.opened.length, 1);
  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].why, 'iTerm said no');
  assert.equal(out.skipped.length, 1);
  const report = s.state().resumeReport;
  assert.equal(report.boot, iso(BOOT));
  assert.equal(report.at, iso(NOW));
  assert.equal(report.workspace, 'sorrel');
  assert.deepEqual(
    report.rows.map((r) => [r.sessionId, r.outcome, r.why, r.source]),
    [
      [id(3), 'skipped', 'it is already running', 'resume'],
      [id(1), 'reopened', 'resumed on request', 'resume'],
      [id(2), 'failed', 'iTerm said no', 'resume'],
    ]
  );
  assert.deepEqual(Object.keys(report.rows[1]).sort(), ['bead', 'dir', 'name', 'outcome', 'sessionId', 'source', 'why', 'workspace'].sort());
  assert.equal(report.rows[1].bead, 'sp-1');
});

test('resumeUnresolved: rows accumulate within a boot, a session decided again is replaced, and the name restore reads them', async () => {
  const s = store({});
  const doors = { ...s, liveSessions: () => [], openWindow: async () => {}, exists: () => true, now: NOW, booted: () => BOOT };
  await resumeUnresolved({}, { ...doors, workspace: 'a', rows: [closed(1, { workspace: 'a' })] });
  await resumeUnresolved({}, { ...doors, workspace: 'b', rows: [closed(2, { workspace: 'b' })], now: NOW + 60_000 });
  let rows = s.state().resumeReport.rows;
  assert.deepEqual(rows.map((r) => r.sessionId), [id(1), id(2)], "the second resume kept the first's rows");
  await resumeUnresolved({}, { ...doors, workspace: 'a', rows: [closed(1, { workspace: 'a', status: 'failed' })], now: NOW + 120_000 });
  rows = s.state().resumeReport.rows;
  assert.deepEqual(rows.map((r) => r.sessionId), [id(2), id(1)], 'decided again: the newer row replaces the older');

  // The window comes up wearing its default; the poll's name restore hands it the name.
  const live = [{ pid: 7, sessionId: id(2), cwd: '/r/repo2', name: 'repo2-9f3', nameSource: '', kind: 'interactive' }];
  const todo = namesToRestore({ report: null, resumeReport: s.state().resumeReport, live, boot: BOOT });
  assert.deepEqual(
    todo.map((t) => [t.session.sessionId, t.name]),
    [[id(2), 'repo2 - task 2']]
  );
  assert.deepEqual(namesToRestore({ report: null, resumeReport: s.state().resumeReport, live, boot: BOOT + 86_400_000 }), [], 'another boot, nothing');
});

test('resumeUnresolved: a report that will not write does not undo the windows; no workspace is refused', async () => {
  let opened = 0;
  const out = await resumeUnresolved(
    {},
    {
      workspace: 'a',
      loadState: () => ({}),
      saveState: () => {
        throw new Error('read-only');
      },
      liveSessions: () => [],
      openWindow: async () => (opened += 1),
      rows: [closed(1, { workspace: 'a' })],
      exists: () => true,
      now: NOW,
      booted: () => BOOT,
    }
  );
  assert.equal(opened, 1);
  assert.equal(out.opened.length, 1);
  await assert.rejects(() => resumeUnresolved({}, { workspace: '', loadState: () => ({}), saveState: () => {}, liveSessions: () => [], openWindow: async () => {} }), /a workspace/);
  await assert.rejects(() => resumeUnresolved({}, { workspace: 'a', loadState: () => ({}), saveState: () => {}, liveSessions: () => [] }), /opener/);
});

/* ------------------------------------------------------------------------- run */

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${String(err?.stack || err).split('\n').slice(0, 6).join('\n      ')}`);
  }
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\n${tests.length} passed`);
process.exit(failed ? 1 : 0);
