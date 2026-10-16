#!/usr/bin/env node
/**
 * The register of open Claude Code windows, and the table printed off it — lib/sessionregister.js.
 *
 *     npm test
 *     node test/sessionregister.mjs
 *
 * bc-5to5r.2 and bc-5to5r.3. The reboot pass used to *infer* which windows a reboot killed
 * from the shutdown flush, which a hard shutdown never writes. The register writes the
 * answer down every minute while the Mac is up, and the one rule that makes it useful is
 * the one pinned first here: **a session that vanishes while the Mac stays up was closed
 * on purpose and is dropped; one whose last sighting predates the boot was taken by the
 * machine and is kept for the pass.** Everything else — what is tracked, the merge with the
 * flush cohort, the status table — follows from that.
 *
 * Every function here is pure or takes its doors injected, so nothing in this suite reads
 * `~/.claude`, and the one that writes writes under a `mkdtemp`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BOOT_SLACK_MS,
  REGISTER_POLL_MS,
  beadInName,
  loadRegister,
  namesToRestore,
  pollRegister,
  registerCohort,
  renderSessions,
  sameBoot,
  saveRegister,
  sessionRows,
  shortDir,
  startRegisterPoll,
  statusWords,
  trackable,
  withoutSessions,
} from '../lib/sessionregister.js';
import { mergeCohorts } from '../lib/rebootresume.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const id = (n) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`;
const BOOT = Date.parse('2026-10-05T11:21:16Z');
const live = (n, extra = {}) => ({
  pid: 1000 + n,
  sessionId: id(n),
  cwd: `/r/repo${n}`,
  name: `repo${n} - task ${n}`,
  kind: 'interactive',
  status: 'idle',
  ...extra,
});

/* ----------------------------------------------------------------------- the rule */

test('a new session is added, a seen one is refreshed, and the poll is stamped', () => {
  const t1 = BOOT + 60_000;
  const first = pollRegister({ sessions: {} }, [live(1)], { now: t1, boot: BOOT });
  assert.deepEqual(first.added, [id(1)]);
  assert.equal(first.register.polledAt, new Date(t1).toISOString());
  assert.equal(first.register.sessions[id(1)].firstSeen, new Date(t1).toISOString());

  const t2 = t1 + 60_000;
  const second = pollRegister(first.register, [live(1, { name: 'repo1 - renamed' })], { now: t2, boot: BOOT });
  assert.deepEqual(second.added, []);
  assert.equal(second.register.sessions[id(1)].firstSeen, new Date(t1).toISOString(), 'firstSeen is kept');
  assert.equal(second.register.sessions[id(1)].lastSeen, new Date(t2).toISOString(), 'lastSeen moves');
  assert.equal(second.register.sessions[id(1)].name, 'repo1 - renamed', 'the latest name wins');
});

test('a session gone while the Mac stayed up was closed on purpose — dropped', () => {
  const t1 = BOOT + 60_000;
  const { register } = pollRegister({ sessions: {} }, [live(1), live(2)], { now: t1, boot: BOOT });
  const next = pollRegister(register, [live(2)], { now: t1 + 60_000, boot: BOOT });
  assert.deepEqual(next.dropped, [id(1)]);
  assert.deepEqual(Object.keys(next.register.sessions), [id(2)]);
});

test('a session last seen before the boot was taken by the machine — kept for the pass', () => {
  // Written at 11:20, the Mac booted at 11:21, the poll runs at 11:22 and the pid is gone.
  const before = BOOT - 60_000;
  const { register } = pollRegister({ sessions: {} }, [live(1)], { now: before, boot: BOOT - 3_600_000 });
  const after = pollRegister(register, [], { now: BOOT + 60_000, boot: BOOT });
  assert.deepEqual(after.dropped, []);
  assert.ok(after.register.sessions[id(1)], 'still in the register');
  assert.equal(after.register.sessions[id(1)].lastSeen, new Date(before).toISOString(), 'and its lastSeen is not touched');
});

test('once the boot has been handled, the pre-boot rows go — a late daemon must not carry them forever', () => {
  const before = BOOT - 60_000;
  const { register } = pollRegister({ sessions: {} }, [live(1)], { now: before, boot: BOOT - 3_600_000 });
  const after = pollRegister(register, [], { now: BOOT + 60_000, boot: BOOT, handledBoot: true });
  assert.deepEqual(after.dropped, [id(1)]);
});

test('a blank name from a window still starting up does not erase the name it had', () => {
  const { register } = pollRegister({ sessions: {} }, [live(1)], { now: BOOT + 1000, boot: BOOT });
  const next = pollRegister(register, [live(1, { name: '' })], { now: BOOT + 2000, boot: BOOT });
  assert.equal(next.register.sessions[id(1)].name, 'repo1 - task 1');
});

test('a row records its workspace — which iTerm window it comes back in — and keeps it when the resolver goes quiet', () => {
  // bc-5to5r.6: with no workspace on the row, the reboot pass filed every hand-opened
  // conversation under the shared window.
  const workspaceOf = (cwd) => (cwd === '/r/repo1' ? 'beadcause' : null);
  const { register } = pollRegister({ sessions: {} }, [live(1), live(2)], { now: BOOT + 1000, boot: BOOT, workspaceOf });
  assert.equal(register.sessions[id(1)].workspace, 'beadcause');
  assert.equal(register.sessions[id(2)].workspace, null, 'a directory no rule maps is written down as none, not guessed');
  const next = pollRegister(register, [live(1)], { now: BOOT + 2000, boot: BOOT, workspaceOf: () => null });
  assert.equal(next.register.sessions[id(1)].workspace, 'beadcause', 'a config that stopped naming it does not erase it');
  const plain = pollRegister({ sessions: {} }, [live(1)], { now: BOOT + 1000, boot: BOOT });
  assert.equal(plain.register.sessions[id(1)].workspace, null, 'no resolver: the field is there and empty');
});

/* -------------------------------------------------------------------- what is tracked */

test('only a window a person sits at is tracked', () => {
  assert.equal(trackable(live(1)), true);
  assert.equal(trackable(live(1, { kind: '' })), true, 'no kind is the oldest record format, and interactive');
  assert.equal(trackable(live(1, { kind: 'subagent' })), false);
  assert.equal(trackable(live(1, { kind: 'headless' })), false);
  assert.equal(trackable(live(1, { cwd: '' })), false, 'nowhere to resume in');
  assert.equal(trackable(live(1, { sessionId: '$(rm -rf ~)' })), false, 'this ends up beside --resume');
  assert.equal(trackable(null), false);
  const { register } = pollRegister({ sessions: {} }, [live(1), live(2, { kind: 'subagent' })], { now: BOOT, boot: BOOT });
  assert.deepEqual(Object.keys(register.sessions), [id(1)]);
});

/* ---------------------------------------------------------------- the cohort it hands over */

test('the cohort is every row from before the boot, newest first, in the flush cohort\'s shape', () => {
  const sessions = {
    [id(1)]: { sessionId: id(1), cwd: '/r/a', name: 'a', kind: 'interactive', lastSeen: new Date(BOOT - 90_000).toISOString() },
    [id(2)]: { sessionId: id(2), cwd: '/r/b', name: 'b', kind: 'interactive', lastSeen: new Date(BOOT - 30_000).toISOString() },
    [id(3)]: { sessionId: id(3), cwd: '/r/c', name: 'c', kind: 'interactive', lastSeen: new Date(BOOT + 30_000).toISOString() },
  };
  const cohort = registerCohort({ sessions }, BOOT);
  assert.deepEqual(
    cohort.map((r) => r.sessionId),
    [id(2), id(1)],
    'the one seen after the boot is a live window, not a dead one'
  );
  assert.deepEqual(Object.keys(cohort[0]).sort(), ['dir', 'kind', 'mtime', 'name', 'sessionId', 'source', 'workspace']);
  assert.equal(cohort[0].workspace, null, 'a row an older poll wrote names no workspace; the pass resolves it');
  assert.equal(cohort[0].dir, '/r/b');
  assert.equal(cohort[0].mtime, BOOT - 30_000);
  assert.equal(cohort[0].source, 'register');
  assert.deepEqual(registerCohort({ sessions }, NaN), [], 'no boot, no cohort — never a guess');
});

test('mergeCohorts: the register says which, the transcript says where and whether it is back', () => {
  const fromRegister = registerCohort(
    {
      sessions: {
        [id(1)]: { sessionId: id(1), cwd: '/r/a', name: 'a', kind: 'interactive', lastSeen: new Date(BOOT - 30_000).toISOString() },
        [id(2)]: { sessionId: id(2), cwd: '/r/b', name: 'b', kind: 'interactive', lastSeen: new Date(BOOT - 30_000).toISOString() },
        [id(3)]: { sessionId: id(3), cwd: '/r/c', name: 'c', kind: 'interactive', lastSeen: new Date(BOOT - 30_000).toISOString() },
      },
    },
    BOOT
  );
  const transcripts = {
    // a moved into a worktree after its record was written; the transcript knows
    [id(1)]: { dir: '/r/a/.claude/worktrees/x-k4t', mtime: BOOT - 100_000 },
    // b has been resumed since the boot
    [id(2)]: { dir: '/r/b', mtime: BOOT + 20_000 },
    // c has no transcript at all
  };
  // And a fourth, seen only by the flush: opened inside the last minute before shutdown.
  const flush = [{ sessionId: id(4), dir: '/r/d', mtime: BOOT - 90_000 }];
  const { cohort, skipped } = mergeCohorts(flush, fromRegister, { boot: BOOT, transcriptFor: (r) => transcripts[r.sessionId] || null });
  assert.deepEqual(cohort.map((r) => r.sessionId), [id(1), id(4)]);
  assert.equal(cohort[0].dir, '/r/a/.claude/worktrees/x-k4t', "the transcript's last cwd beats the record's");
  assert.equal(cohort[0].name, 'a', 'the register\'s name rides along for the report');
  assert.equal(cohort[1].source, 'flush');
  assert.deepEqual(
    skipped.map((r) => [r.sessionId, r.why]),
    [
      [id(2), 'its transcript has grown since the boot — it is already back'],
      [id(3), 'no transcript on disk — nothing for --resume to restore'],
    ]
  );
});

test('mergeCohorts: a row in both is one row, and a row the register skipped stays skipped', () => {
  const reg = [{ sessionId: id(1), dir: '/r/a', mtime: BOOT - 30_000, name: 'a', source: 'register' }];
  const flush = [{ sessionId: id(1), dir: '/r/a2', mtime: BOOT - 90_000 }];
  const both = mergeCohorts(flush, reg, { boot: BOOT, transcriptFor: () => ({ dir: null, mtime: BOOT - 90_000 }) });
  assert.equal(both.cohort.length, 1);
  assert.equal(both.cohort[0].dir, '/r/a2', 'the flush row carries the transcript cwd when the lookup has none');
  const back = mergeCohorts(flush, reg, { boot: BOOT, transcriptFor: () => ({ dir: '/r/a', mtime: BOOT + 1 }) });
  assert.equal(back.cohort.length, 0, 'the flush must not resurrect what the register already ruled already back');
  assert.equal(back.skipped.length, 1);
});

test('withoutSessions takes the decided rows out and leaves the rest', () => {
  const reg = { polledAt: 'x', sessions: { [id(1)]: { sessionId: id(1) }, [id(2)]: { sessionId: id(2) } } };
  assert.deepEqual(Object.keys(withoutSessions(reg, [id(1)]).sessions), [id(2)]);
  assert.equal(withoutSessions(reg, []).polledAt, 'x');
});

/* ----------------------------------------------------------------------- the same boot */

test('two readings of one boot a second apart are the same boot; two boots are not', () => {
  const a = '2026-10-05T11:21:16.243Z';
  assert.equal(sameBoot(a, '2026-10-05T11:21:16.208Z'), true, 'measured drift between two bootAt() calls');
  assert.equal(sameBoot(a, Date.parse(a) + 999), true);
  assert.equal(sameBoot(a, Date.parse(a) + BOOT_SLACK_MS + 1), false);
  assert.equal(sameBoot(a, '2026-10-06T11:21:16.243Z'), false);
  assert.equal(sameBoot(undefined, a), false, 'no stamp is no boot handled');
  assert.equal(sameBoot('soon', a), false);
});

/* ------------------------------------------------------------------------- the disk */

test('the register round-trips, and junk on disk reads as empty rather than as rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-register-'));
  try {
    const file = path.join(dir, 'sessions.json');
    assert.deepEqual(loadRegister(file), { polledAt: null, sessions: {} }, 'no file yet');
    const { register } = pollRegister({ sessions: {} }, [live(1)], { now: BOOT, boot: BOOT, workspaceOf: () => 'sorrel' });
    saveRegister(register, file);
    assert.deepEqual(loadRegister(file), register);
    assert.equal(loadRegister(file).sessions[id(1)].workspace, 'sorrel', 'the workspace survives the disk');
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
    saveRegister({ ...register, sessions: { [id(1)]: { ...register.sessions[id(1)], workspace: 42 } } }, file);
    assert.equal(loadRegister(file).sessions[id(1)].workspace, null, 'junk in the field is none, never a window key');

    fs.writeFileSync(file, '{"sessions":[1,2,3]}');
    assert.deepEqual(loadRegister(file).sessions, {}, 'an array where the map should be');
    fs.writeFileSync(file, '{"sessions":{"not-an-id":{"cwd":"/x","lastSeen":"2026-01-01T00:00:00Z"},"' + id(1) + '":{"cwd":"/x"}}}');
    assert.deepEqual(loadRegister(file).sessions, {}, 'a bad id and a row with no lastSeen are both no row');
    fs.writeFileSync(file, 'not json');
    assert.deepEqual(loadRegister(file), { polledAt: null, sessions: {} });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the poll runs through its injected doors, logs only changes, and survives a bad tick', () => {
  let store = { polledAt: null, sessions: {} };
  const lines = [];
  const errors = [];
  let now = BOOT + 60_000;
  let liveNow = [live(1), live(2)];
  const timer = startRegisterPoll(
    {},
    {
      liveSessions: () => liveNow,
      load: () => store,
      save: (r) => (store = r),
      loadState: () => ({}),
      booted: () => BOOT,
      now: () => now,
      every: 60 * 60 * 1000,
      log: { log: (l) => lines.push(l), error: (l) => errors.push(l) },
    }
  );
  try {
    assert.equal(REGISTER_POLL_MS, 60_000, 'the default is the minute Adam asked for');
    timer.tick();
    assert.equal(Object.keys(store.sessions).length, 2);
    assert.match(lines.at(-1), /2 windows in the register \(\+2 new\)/);
    now += 60_000;
    timer.tick();
    assert.equal(lines.length, 1, 'a quiet poll says nothing');
    liveNow = [live(2)];
    now += 60_000;
    timer.tick();
    assert.match(lines.at(-1), /1 window in the register \(-1 closed\)/);
    // A reader that throws is one logged line and the next tick runs; it is never the end
    // of the register for the life of the process.
    const broken = startRegisterPoll({}, { liveSessions: () => { throw new Error('ps is gone'); }, load: () => store, save: () => {}, booted: () => BOOT, every: 3_600_000, log: { log: () => {}, error: (l) => errors.push(l) } });
    try {
      broken.tick();
      assert.match(errors.at(-1), /register poll failed — ps is gone/);
    } finally {
      clearInterval(broken);
    }
  } finally {
    clearInterval(timer);
  }
});

/* ------------------------------------------------------------------------- the table */

test('a bead is read off a window name conservatively', () => {
  assert.equal(beadInName('beadcause - bc-5to5r reboot session register'), 'bc-5to5r');
  assert.equal(beadInName('loremia - lm-p4cq.3 species refs'), 'lm-p4cq.3');
  assert.equal(beadInName('Northwind - JIRA-1234 proposal PR'), 'JIRA-1234');
  assert.equal(beadInName('ehden - re-run the flaky suite'), null, '`re-run` is a word, not a bead');
  assert.equal(beadInName('ada.log - e-mail the landlord'), null);
  // Claude Code's default name for a window nobody named: the directory plus a hash. Its
  // tail is bead-shaped and is not a bead — the first beadcause-top frame read nine of them.
  assert.equal(beadInName('soc2-first-order-e4b-93'), null, 'a default name, not a session-given one');
  assert.equal(beadInName('northwind-dev-38'), null);
  assert.equal(beadInName('tech6935-print-x7k-8a'), null);
  assert.equal(beadInName(''), null);
  assert.equal(beadInName(null), null);
  // bc-5to5r.5: Claude Code's default session name is basename-plus-hash, and a hyphen
  // before the candidate made the tail of it read as a bead after the first reboot pass.
  assert.equal(beadInName('northwind-dev-38'), null, 'not dev-38');
  assert.equal(beadInName('soc2-first-order-e4b-93'), null, 'not order-e4b');
  assert.equal(beadInName('v3-user-name-terms-b7e-bd'), null, 'not terms-b7e');
  assert.equal(beadInName('tech6935-print-x7k-35'), null, 'not print-x7k');
  assert.equal(beadInName('ehden-ab'), null);
  assert.equal(beadInName('Sorrel - sp-8drg.8 Nightly backup of the telemetry'), 'sp-8drg.8', 'a real one still reads');
  assert.equal(beadInName('DONE-beadcause - bc-5to5r.8 restore names'), 'bc-5to5r.8', 'the prefix a merge writes does not hide the bead behind it');
});

/* ------------------------------------------------------------- the name a resume loses */

const reopened = (n, name, extra = {}) => ({ sessionId: id(n), name, dir: `/r/repo${n}`, outcome: 'reopened', why: null, ...extra });
const back = (n, extra = {}) => live(n, { name: `repo${n}-3f`, nameSource: '', ...extra }); // the default a resumed process mints

test('namesToRestore: a reopened window wearing its default gets the name the pass knew it by', () => {
  // bc-5to5r.8: `claude --resume` continues the conversation but not the record's name.
  const report = { boot: new Date(BOOT + 300).toISOString(), at: new Date(BOOT + 20_000).toISOString(), rows: [reopened(1, 'repo1 - task 1'), reopened(2, 'repo2 - task 2')] };
  const todo = namesToRestore({ report, live: [back(1), back(2)], boot: BOOT });
  assert.deepEqual(
    todo.map((t) => [t.session.sessionId, t.name]),
    [
      [id(1), 'repo1 - task 1'],
      [id(2), 'repo2 - task 2'],
    ]
  );
});

test('namesToRestore: a name a person gave wins, a hand-opened window is never touched, and only this boot counts', () => {
  const rows = [
    reopened(1, 'repo1 - task 1'),
    reopened(2, 'repo2 - task 2'),
    reopened(3, ''), // the pass had no name for it
    reopened(4, 'repo4 - task 4'),
    { sessionId: id(5), name: 'repo5 - task 5', dir: '/r/repo5', outcome: 'skipped', why: 'already back' },
    { sessionId: id(7), name: 'lm-p4cq species', dir: '/r/repo7', outcome: 'parked', why: 'its advocate brings it back' },
  ];
  const report = { boot: new Date(BOOT).toISOString(), at: new Date(BOOT + 20_000).toISOString(), rows };
  const live = [
    back(1, { name: 'repo1 - renamed on its first turn', nameSource: 'user' }), // the session has spoken; keep it
    back(2, { name: 'repo2 - task 2' }), // a Claude Code that carried the title through: nothing to do
    back(3),
    // id(4) has not written its record yet — next poll
    back(5),
    back(6), // Adam opened this one by hand after the boot; not in the report
    back(7),
  ];
  assert.deepEqual(namesToRestore({ report, live, boot: BOOT }), [], 'nothing on this list is ours to rename');
  assert.deepEqual(
    namesToRestore({ report, live: [...live, back(4)], boot: BOOT }).map((t) => t.session.sessionId),
    [id(4)],
    'the record that arrives late is picked up when it does'
  );
  const yesterday = { ...report, boot: new Date(BOOT - 86_400_000).toISOString() };
  assert.deepEqual(namesToRestore({ report: yesterday, live: [back(4)], boot: BOOT }), [], "last boot's report names nothing today");
  assert.deepEqual(namesToRestore({ report, live: [back(4)], boot: 0 }), [], 'no boot known, no restore');
  assert.deepEqual(namesToRestore({ report: null, live: [back(4)], boot: BOOT }), []);
  assert.deepEqual(namesToRestore({ report, live: [back(4, { kind: 'subagent' })], boot: BOOT }), [], 'not a window');
});

test('the poll hands the name back once, through the retitle door, and files the row under it in the same tick', () => {
  const records = { [id(1)]: back(1), [id(2)]: back(2) }; // what liveSessions would read off disk
  const writes = [];
  const restore = (session, name) => {
    writes.push([session.sessionId, name]);
    if (session.sessionId === id(2)) return { record: false, transcript: true }; // its record would not take it
    records[session.sessionId] = { ...records[session.sessionId], name, nameSource: 'user' }; // what lib/retitle.js leaves on disk
    return { record: true, transcript: true };
  };
  let store = { polledAt: null, sessions: {} };
  const lines = [];
  const errors = [];
  const report = { boot: new Date(BOOT).toISOString(), at: new Date(BOOT + 20_000).toISOString(), rows: [reopened(1, 'repo1 - task 1'), reopened(2, 'repo2 - task 2')] };
  let now = BOOT + 60_000;
  const timer = startRegisterPoll(
    {},
    {
      liveSessions: () => Object.values(records).map((r) => ({ ...r })),
      load: () => store,
      save: (r) => (store = r),
      loadState: () => ({ rebootResumedAt: new Date(BOOT).toISOString(), rebootReport: report }),
      booted: () => BOOT,
      now: () => now,
      every: 60 * 60 * 1000,
      log: { log: (l) => lines.push(l), error: (l) => errors.push(l) },
      restore,
    }
  );
  try {
    timer.tick();
    assert.deepEqual(writes, [
      [id(1), 'repo1 - task 1'],
      [id(2), 'repo2 - task 2'],
    ]);
    assert.equal(store.sessions[id(1)].name, 'repo1 - task 1', 'the register never carried the default');
    assert.equal(store.sessions[id(2)].name, 'repo2-3f', 'a write that did not land is not pretended');
    assert.match(lines[0], /^\[sessions\] 11111111 is "repo1 - task 1" again \(brought back at boot\)$/);
    assert.match(errors.at(-1), /could not give 22222222 its name back — its record would not take it/);
    now += 60_000;
    timer.tick();
    assert.equal(writes.length, 3, 'id(1) is done — nameSource says so; id(2) is tried again');
    assert.equal(writes.at(-1)[0], id(2));
    // A door that throws is one logged line, and the register is still kept.
    const throwing = startRegisterPoll({}, { liveSessions: () => [back(1)], load: () => store, save: (r) => (store = r), loadState: () => ({ rebootReport: report }), booted: () => BOOT, now: () => now, every: 3_600_000, log: { log: () => {}, error: (l) => errors.push(l) }, restore: () => { throw new Error('disk full'); } });
    try {
      throwing.tick();
      assert.match(errors.at(-1), /could not give 11111111 its name back — disk full/);
      assert.ok(store.sessions[id(1)], 'the row is still written');
    } finally {
      clearInterval(throwing);
    }
  } finally {
    clearInterval(timer);
  }
});

test('a directory is said as short as it can be', () => {
  assert.equal(shortDir('/Users/a/projects/beadcause/.claude/worktrees/x-k4t'), 'beadcause ⟶ x-k4t');
  assert.equal(shortDir('/Users/a/northwind.dev'), 'northwind.dev');
  assert.equal(shortDir('/Users/a/projects/loremia/'), 'loremia');
  assert.equal(shortDir(''), '');
});

test('sessionRows merges live, report and register, and only this boot\'s report counts', () => {
  const register = {
    polledAt: new Date(BOOT + 120_000).toISOString(),
    sessions: {
      [id(1)]: { sessionId: id(1), cwd: '/r/a', name: 'a - one', kind: 'interactive', lastSeen: new Date(BOOT + 120_000).toISOString() },
      [id(5)]: { sessionId: id(5), cwd: '/r/e', name: 'e - five', kind: 'interactive', lastSeen: new Date(BOOT - 30_000).toISOString() },
    },
  };
  const report = {
    boot: new Date(BOOT + 400).toISOString(), // a few hundred ms off, as two processes read it
    at: new Date(BOOT + 20_000).toISOString(),
    rows: [
      { sessionId: id(1), name: 'a - one', dir: '/r/a', outcome: 'reopened', why: null },
      { sessionId: id(2), name: 'b - two', dir: '/r/b', outcome: 'skipped', why: 'its directory is gone — the worktree was retired' },
      { sessionId: id(3), name: '', dir: '/r/c', workspace: 'loremia', bead: 'lm-p4cq', outcome: 'parked', why: 'its advocate brings it back' },
      { sessionId: id(4), name: 'd - four', dir: '/r/d', outcome: 'failed', why: 'iTerm did not answer' },
    ],
  };
  const rows = sessionRows({
    register,
    report,
    live: [live(1, { name: 'a - one' }), live(6, { kind: 'subagent' })],
    opened: { [id(3)]: { bead: 'lm-p4cq', workspace: 'loremia', title: 'lm-p4cq species refs' } },
    boot: BOOT,
    now: BOOT + 300_000,
    transcriptAt: (r) => (r.sessionId === id(1) ? BOOT + 290_000 : null),
  });
  const by = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
  assert.equal(by[id(1)].status, 'live');
  assert.equal(by[id(1)].why, 'reopened at boot', 'live now, and the report says how it got there');
  assert.equal(by[id(1)].transcriptAge, 'a moment ago');
  assert.equal(by[id(2)].status, 'skipped');
  assert.equal(by[id(3)].status, 'parked');
  assert.equal(by[id(3)].bead, 'lm-p4cq');
  assert.equal(by[id(3)].name, 'lm-p4cq species refs', 'a daemon window with no name shows its title');
  assert.equal(by[id(4)].status, 'failed');
  assert.equal(by[id(5)].status, 'waiting', 'in the register from before the boot, and the report does not mention it');
  assert.equal(by[id(6)], undefined, 'a subagent is not a window');
  assert.deepEqual(
    rows.map((r) => r.status),
    ['live', 'parked', 'waiting', 'skipped', 'failed'],
    'live first, then what the pass did, then what it declined'
  );

  const stale = sessionRows({ register, report: { ...report, boot: new Date(BOOT - 86_400_000).toISOString() }, boot: BOOT, now: BOOT });
  assert.equal(stale.find((r) => r.sessionId === id(2)), undefined, "yesterday's report is not today's status");
});

test('statusWords says what a reader needs and nothing else', () => {
  assert.equal(statusWords({ status: 'live' }), 'live');
  assert.equal(statusWords({ status: 'live', why: 'reopened at boot' }), 'live (reopened at boot)');
  assert.equal(statusWords({ status: 'skipped', why: 'over the cap of 12 windows' }), 'skipped — over the cap of 12 windows');
  assert.equal(statusWords({ status: 'failed', why: 'x' }), 'could not reopen — x');
  assert.equal(statusWords({ status: 'parked' }), 'parked for its advocate');
  assert.equal(statusWords({ status: 'waiting' }), 'alive at shutdown, not yet brought back');
});

test('renderSessions: a header about the boot and the pass, then one aligned row per session', () => {
  const now = BOOT + 600_000;
  const report = { boot: new Date(BOOT).toISOString(), at: new Date(BOOT + 30_000).toISOString(), rows: [{ outcome: 'reopened' }, { outcome: 'reopened' }, { outcome: 'skipped' }] };
  const rows = [
    { sessionId: id(1), name: 'beadcause - bc-5to5r register', dir: '/r/beadcause/.claude/worktrees/x-k4t', bead: 'bc-5to5r', status: 'reopened', transcriptAge: '9 minutes ago' },
    { sessionId: id(2), name: '', dir: '/r/loremia', bead: null, status: 'skipped', why: 'over the cap of 12 windows', transcriptAge: '' },
  ];
  const lines = renderSessions({ rows, report, register: { polledAt: new Date(now - 60_000).toISOString() }, boot: BOOT, now });
  assert.match(lines[0], /^this Mac booted 10 minutes ago \(2026-10-05T11:21:16\.000Z\)$/);
  assert.match(lines[1], /^the reboot pass ran 10 minutes ago: 2 reopened, 1 skipped$/);
  assert.match(lines[2], /^register last polled a moment ago$/);
  assert.equal(lines[3], '');
  assert.match(lines[4], /^session\s+where\s+bead\s+status\s+last write$/);
  assert.match(lines[6], /^beadcause - bc-5to5r register\s+beadcause ⟶ x-k4t\s+bc-5to5r\s+reopened\s+9 minutes ago$/);
  assert.match(lines[7], /^\(unnamed 22222222\)\s+loremia\s+skipped — over the cap of 12 windows$/);
  const where = lines[4].indexOf('where');
  assert.equal(lines[6].indexOf('beadcause ⟶'), where, 'columns line up');

  const none = renderSessions({ rows: [], report: null, register: null, boot: BOOT, now });
  assert.match(none[1], /^no reboot pass has run for this boot$/);
  assert.match(none.at(-1), /^no sessions known/);
  const empty = renderSessions({ rows: [], report: { ...report, rows: [] }, boot: BOOT, now });
  assert.match(empty[1], /: nothing was open$/);
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
