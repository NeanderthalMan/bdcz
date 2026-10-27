#!/usr/bin/env node
/**
 * A reboot takes every window on the Mac, and every conversation comes back.
 *
 *     npm test
 *     node test/rebootresume.mjs
 *
 * **The failure this pins.** The 2026-09-20 21:53 reboot killed seven Claude Code
 * conversations. beadcause's open-window register held one of them at shutdown and held
 * none a minute after boot — `parkDecision`'s first rule drops a window with no live
 * session, which is right for one Adam closed and wrong for one the machine took away,
 * because a drop parks nothing and a conversation nothing parked cannot be resumed. The
 * other six were never in the register at all: `registerOpen` is called from `launch`, and
 * Adam's own windows do not come through it.
 *
 * So there are two halves and they fail differently, which is why they are asserted apart:
 *
 * 1. **Finding them.** The shutdown flush is the fingerprint — every live session writes
 *    its transcript when it is terminated, so they all land within the same second. The
 *    fixture below is the real reboot's timing (the directories are invented): seven
 *    writes at 00:52:06Z, a boot at 00:53:38Z, and
 *    an eighth conversation that had already been closed eight minutes earlier and must
 *    not come back.
 * 2. **Deciding what to do with each.** A window the register knows is *parked* for its
 *    advocate, never reopened here — the advocate has the bead, the claim and the
 *    one-window guard, and opening it here would let a second window onto the same bead.
 *    A window nothing knows is one of Adam's, and this is what reopens it.
 *
 * And three bounds, each of which is a way this could go wrong in production rather than a
 * shape worth having for its own sake:
 *
 * - **once per boot** — the stamp is written before any window opens, so a crash halfway
 *   through cannot reopen the first five a second time;
 * - **only just after a boot** — a hot swap at 3pm must not reopen what died at breakfast,
 *   and it must *record* that it is not doing so, or the next restart tries again;
 * - **never onto a live conversation** — a transcript that has grown since the boot is one
 *   already resumed, and that is read off the file rather than off a register, because a
 *   window that opened ten seconds ago has not written a session record yet.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BOOT_GRACE_MS,
  FLUSH_CLUSTER_MS,
  MAX_RESUMED,
  bootAt,
  flushCohort,
  planReboot,
  resumeAfterReboot,
  scanTranscripts,
} from '../lib/rebootresume.js';
import { parkDecision } from '../lib/parked.js';
import { interruptedPrompt } from '../lib/resume.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** The reboot this feature was written for, to the millisecond it actually happened. */
const BOOT = Date.parse('2026-09-21T00:53:38Z');
const FLUSH = Date.parse('2026-09-21T00:52:06Z');
const id = (n) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`;

/** The seven that died, plus one closed eight minutes earlier that did not. */
const REBOOT = [
  { sessionId: id(1), dir: '/r/alpha/.claude/worktrees/import-fix-5d2', mtime: FLUSH },
  { sessionId: id(2), dir: '/r/beta/.claude/worktrees/token-qr-k4t', mtime: FLUSH + 400 },
  { sessionId: id(3), dir: '/r/gamma/.claude/worktrees/form-copy-b4e', mtime: FLUSH + 713 },
  { sessionId: id(4), dir: '/r/delta/.claude/worktrees/refs-sweep-4c9', mtime: FLUSH + 220 },
  { sessionId: id(5), dir: '/r/delta/docs/library/entries', mtime: FLUSH + 90 },
  { sessionId: id(6), dir: '/r/epsilon/.claude/worktrees/guard-k4p', mtime: FLUSH + 15 },
  { sessionId: id(7), dir: '/r/delta', mtime: FLUSH + 500 },
  { sessionId: id(8), dir: '/r/delta/.claude/worktrees/outline-beats-5eu71', mtime: FLUSH - 8 * 60000 },
];

/* ------------------------------------------------------------------ finding them */

test('the shutdown flush is the cohort, and a window closed earlier is not in it', () => {
  const cohort = flushCohort(REBOOT, BOOT);
  assert.equal(cohort.length, 7, 'the seven that were alive at the reboot');
  assert.ok(!cohort.some((r) => r.sessionId === id(8)), 'the one closed eight minutes earlier stays closed');
  // Newest first, which is what makes the cap keep the conversation that was typing last.
  assert.deepEqual(
    cohort.map((r) => r.mtime),
    [...cohort.map((r) => r.mtime)].sort((a, b) => b - a)
  );
});

test('a transcript written after the boot is already back, and is excluded by id', () => {
  // The exact shape of running this twice: the same conversation, resumed, has since
  // written. Both its rows are dropped — the old one as well, which is the point, because
  // the pre-boot row is the one that would otherwise put it in the cohort.
  const rows = [...REBOOT, { sessionId: id(1), dir: '/r/alpha', mtime: BOOT + 60000 }];
  const cohort = flushCohort(rows, BOOT);
  assert.equal(cohort.length, 6);
  assert.ok(!cohort.some((r) => r.sessionId === id(1)));
});

test('no flush near the boot is no cohort, rather than a guess at the last one alive', () => {
  const stale = REBOOT.map((r) => ({ ...r, mtime: BOOT - 45 * 60000 }));
  assert.deepEqual(flushCohort(stale, BOOT), []);
});

test('a row without a directory, an id or a time is not a row', () => {
  const junk = [
    { sessionId: id(1), mtime: FLUSH },
    { sessionId: 'not-a-session-id; rm -rf /', dir: '/r/x', mtime: FLUSH },
    { sessionId: id(2), dir: '/r/x', mtime: 'soon' },
  ];
  assert.deepEqual(flushCohort(junk, BOOT), []);
});

test('the cluster is tight enough to exclude a window closed a minute before shutdown', () => {
  const rows = [
    { sessionId: id(1), dir: '/r/a', mtime: FLUSH },
    { sessionId: id(2), dir: '/r/b', mtime: FLUSH - FLUSH_CLUSTER_MS - 1 },
  ];
  assert.deepEqual(
    flushCohort(rows, BOOT).map((r) => r.sessionId),
    [id(1)]
  );
});

/* ------------------------------------------------------------ deciding about each */

const OPENED = {
  [id(7)]: {
    at: new Date(BOOT - 3600000).toISOString(),
    sessionId: id(7),
    dir: '/r/delta',
    workspace: 'delta',
    bead: 'dl-p4cq',
    pr: null,
    kind: 'merge-advocate',
    title: 'merge 531 delta',
  },
};

test('a registered window is parked for its advocate and never reopened here', () => {
  const plan = planReboot({ cohort: flushCohort(REBOOT, BOOT), opened: OPENED });
  assert.deepEqual(
    plan.park.map((p) => p.rec.bead),
    ['dl-p4cq']
  );
  assert.ok(!plan.open.some((r) => r.sessionId === id(7)), 'the advocate resumes it, not this sweep');
  assert.equal(plan.open.length, 6, "Adam's six come back as windows");
});

test("a registered window of one of Adam's kinds comes back as a window, not a park — bc-pszow", () => {
  // Chats and handoffs are registered now so the idle sweep can close them, but nothing
  // brings a parked chat back on its own, and he was sitting at it when the Mac went down.
  for (const kind of ['chat', 'handoff', 'resumed']) {
    const opened = { [id(7)]: { ...OPENED[id(7)], kind } };
    const plan = planReboot({ cohort: flushCohort(REBOOT, BOOT), opened });
    assert.equal(plan.park.length, 0, `${kind}: not parked`);
    assert.ok(plan.open.some((r) => r.sessionId === id(7)), `${kind}: reopened`);
  }
});

test('a window already parked is left to its advocate too — the ordering bug', () => {
  // A park *moves* the row out of `opened` and into `parked`. If an advocate tick beat this
  // sweep to it, checking only `opened` reads it as one of Adam's and opens a second window
  // on a bead the advocate is about to resume.
  const parked = { 'delta/dl-p4cq': { sessionId: id(7), dir: '/r/delta', ending: 'reboot' } };
  const plan = planReboot({ cohort: flushCohort(REBOOT, BOOT), opened: {}, parked });
  assert.ok(!plan.open.some((r) => r.sessionId === id(7)));
  assert.equal(plan.park.length, 0, 'it is not parked twice either');
  assert.match(plan.skipped.find((r) => r.sessionId === id(7)).why, /parked already/);
});

test('a conversation with a process behind it is already back', () => {
  const plan = planReboot({
    cohort: flushCohort(REBOOT, BOOT),
    opened: OPENED,
    live: [{ sessionId: id(3), pid: 4242 }],
  });
  assert.ok(!plan.open.some((r) => r.sessionId === id(3)));
  assert.match(plan.skipped.find((r) => r.sessionId === id(3)).why, /already running/);
});

test('the cap keeps the newest and says what it left', () => {
  const many = Array.from({ length: MAX_RESUMED + 3 }, (_, i) => ({
    sessionId: `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
    dir: `/r/p${i}`,
    mtime: FLUSH + i,
  }));
  const plan = planReboot({ cohort: flushCohort(many, BOOT) });
  assert.equal(plan.open.length, MAX_RESUMED);
  assert.equal(plan.skipped.length, 3);
  assert.ok(plan.skipped.every((r) => /over the cap/.test(r.why)));
  // Newest first: the three dropped are the three oldest writes.
  assert.deepEqual(
    plan.skipped.map((r) => r.mtime).sort((a, b) => a - b),
    [FLUSH, FLUSH + 1, FLUSH + 2]
  );
});

/* --------------------------------------------------------------- the register sweep */

test('a window gone across the boot is parked, not dropped', () => {
  const rec = { at: new Date(BOOT - 60000).toISOString(), sessionId: id(7), dir: '/r/delta', workspace: 'delta' };
  assert.deepEqual(parkDecision(rec, null, { bootAt: BOOT }), {
    act: 'park',
    ending: 'reboot',
    why: 'the Mac rebooted while it was open',
  });
});

test('a window opened since the boot and now gone is still a drop', () => {
  // Adam closed this one, on a machine that has been up for an hour. Nothing changed.
  const rec = { at: new Date(BOOT + 3600000).toISOString(), sessionId: id(7), dir: '/r/delta', workspace: 'delta' };
  assert.equal(parkDecision(rec, null, { bootAt: BOOT }).act, 'drop');
});

test('with no boot to compare against, the old answer stands', () => {
  const rec = { at: new Date(BOOT - 60000).toISOString(), sessionId: id(7), dir: '/r/delta', workspace: 'delta' };
  assert.equal(parkDecision(rec, null).act, 'drop');
  assert.equal(parkDecision(rec, null, { bootAt: Number.NaN }).act, 'drop');
});

test('a live window is judged on its status, boot or no boot', () => {
  const rec = { at: new Date(BOOT - 60000).toISOString(), sessionId: id(7), dir: '/r/delta', workspace: 'delta' };
  assert.equal(parkDecision(rec, { status: 'busy' }, { bootAt: BOOT }).act, 'wait', 'never close one mid-turn');
});

/* --------------------------------------------------------------- what it wakes up to */

test('a rebooted agent is told the machine went down, not that it did something', () => {
  const said = interruptedPrompt({ bead: 'dl-p4cq', reason: 'reboot', parkedAt: new Date(BOOT).toISOString() });
  assert.match(said, /Mac rebooted/);
  assert.match(said, /every window on it, at the same moment/);
  assert.match(said, /Nothing was answered and nobody decided anything/);
  // The fact only a reboot has, and the one its transcript cannot contain.
  assert.match(said, /Everything you had running is gone/);
  assert.ok(!/Your window disappeared/.test(said), 'that sentence is for a window that went alone');
});

test('the other two endings are unchanged', () => {
  assert.match(interruptedPrompt({ reason: 'gone' }), /Your window disappeared/);
  assert.match(interruptedPrompt({ reason: 'idle' }), /This window went quiet/);
  assert.ok(!/Everything you had running is gone/.test(interruptedPrompt({ reason: 'gone' })));
});

/* ------------------------------------------------------------------------ the sweep */

/** A state store in memory, shaped like the one in lib/config.js. */
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

test('a daemon that started long after the boot opens nothing, and records that it did not', async () => {
  const s = store({});
  let opened = 0;
  const now = Date.now();
  const out = await resumeAfterReboot(
    {},
    {
      ...s,
      liveSessions: () => [],
      openWindow: async () => {
        opened += 1;
      },
      // The uptime is given, not read. Moving `now` alone moved the boot with it, because
      // the boot is `now - os.uptime()`, so this passed only on a machine that had been up
      // past the grace: the studio Mac always, a fresh hosted runner never (bc-4fyq1, #288).
      now,
      uptimeSeconds: BOOT_GRACE_MS / 1000 + 60,
    }
  );
  assert.equal(out.ran, false);
  assert.equal(out.why, 'not a fresh boot');
  assert.equal(opened, 0);
  // And it is *recorded*, or the next restart tries the same thing again.
  assert.ok(s.state().rebootResumedAt, 'the boot is stamped even when nothing is resumed');
});

test('the same boot is never resumed twice', async () => {
  const boot = new Date(bootAt(os.uptime(), Date.now())).toISOString();
  const s = store({ rebootResumedAt: boot });
  let opened = 0;
  const out = await resumeAfterReboot({}, { ...s, liveSessions: () => [], openWindow: async () => (opened += 1) });
  assert.equal(out.ran, false);
  assert.equal(out.why, 'this boot has already been resumed');
  assert.equal(opened, 0);
});

test('switched off is switched off', async () => {
  let opened = 0;
  const out = await resumeAfterReboot(
    { resumeAfterReboot: false },
    { ...store(), liveSessions: () => [], openWindow: async () => (opened += 1) }
  );
  assert.equal(out.ran, false);
  assert.equal(opened, 0);
});

test('a boot that cannot be stamped opens nothing — unstamped is unbounded', async () => {
  let opened = 0;
  const out = await resumeAfterReboot(
    {},
    {
      loadState: () => ({}),
      saveState: () => {
        throw new Error('read-only file system');
      },
      liveSessions: () => [],
      openWindow: async () => (opened += 1),
    }
  );
  assert.equal(out.ran, false);
  assert.equal(opened, 0);
});

test('a fresh boot brings the windows back, in their own directories', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-'));
  try {
    const now = Date.now();
    const uptimeSeconds = 60; // the daemon came up with the machine, a minute ago
    const boot = now - uptimeSeconds * 1000;
    const write = (session, cwd, mtime) => {
      const folder = path.join(root, cwd.replace(/[^A-Za-z0-9]/g, '-'));
      fs.mkdirSync(folder, { recursive: true });
      const file = path.join(folder, `${session}.jsonl`);
      fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', cwd })}\n`);
      fs.utimesSync(file, mtime / 1000, mtime / 1000);
    };
    // Two in the flush, and one that had been closed half an hour before the shutdown.
    write(id(1), '/r/alpha/.claude/worktrees/import-fix-5d2', boot - 5000);
    write(id(2), '/r/delta/.claude/worktrees/refs-sweep-4c9', boot - 4800);
    write(id(3), '/r/delta/docs/library/entries', boot - 30 * 60000);

    const s = store({});
    const opened = [];
    const out = await resumeAfterReboot(
      { claudeProjectsDir: root },
      {
        ...s,
        liveSessions: () => [],
        // The fixture directories are names, not places; the directory check is tested below.
        exists: () => true,
        openWindow: async (_cfg, win) => {
          opened.push(win);
          return win;
        },
        now,
        uptimeSeconds,
      }
    );
    assert.equal(out.ran, true);
    assert.equal(opened.length, 2, 'the two in the flush, and not the one already closed');
    assert.deepEqual(
      opened.map((w) => w.dir).sort(),
      ['/r/alpha/.claude/worktrees/import-fix-5d2', '/r/delta/.claude/worktrees/refs-sweep-4c9']
    );
    assert.equal(s.state().rebootResumedAt, new Date(boot).toISOString());

    // And running it again on the same boot opens nothing — the property that makes a
    // crash-restart safe.
    const again = await resumeAfterReboot(
      { claudeProjectsDir: root },
      { ...s, liveSessions: () => [], openWindow: async () => opened.push('again'), now, uptimeSeconds }
    );
    assert.equal(again.ran, false);
    assert.equal(opened.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a registered window is parked by the sweep rather than reopened', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-'));
  try {
    const now = Date.now();
    const uptimeSeconds = 60;
    const boot = now - uptimeSeconds * 1000;
    const folder = path.join(root, '-r-delta');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${id(7)}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', cwd: '/r/delta' })}\n`);
    fs.utimesSync(file, (boot - 5000) / 1000, (boot - 5000) / 1000);

    const s = store({ opened: { ...OPENED } });
    let opened = 0;
    const out = await resumeAfterReboot(
      { claudeProjectsDir: root },
      { ...s, liveSessions: () => [], openWindow: async () => (opened += 1), now, uptimeSeconds }
    );
    assert.equal(opened, 0, 'the advocate resumes this one, not the sweep');
    assert.equal(out.parked.length, 1);
    assert.equal(out.parked[0].ending, 'reboot');
    // On disk, under the bead's own key, and out of the open register in the same write.
    assert.equal(s.state().parked['delta/dl-p4cq'].ending, 'reboot');
    assert.match(s.state().parked['delta/dl-p4cq'].waitingOn, /rebooted/);
    assert.deepEqual(s.state().opened, {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the stamp is written before any window opens', async () => {
  // The ordering that bounds a crash: if the first window opens before the boot is
  // recorded, a crash after it reopens that window again on the next start.
  const seen = [];
  const s = store({});
  await resumeAfterReboot(
    {},
    {
      loadState: s.loadState,
      saveState: (patch) => {
        seen.push(`stamp:${patch.rebootResumedAt ? 'boot' : 'other'}`);
        s.saveState(patch);
      },
      liveSessions: () => [],
      openWindow: async () => seen.push('window'),
      now: Date.now(),
    }
  );
  if (seen.includes('window')) assert.ok(seen.indexOf('stamp:boot') < seen.indexOf('window'));
  assert.equal(seen[0], 'stamp:boot');
});

/* ------------------------------------------------------------- the session register */

/**
 * The fixture for a **hard** shutdown — bc-5to5r.2's reason to exist. No flush: the three
 * transcripts were last written at scattered times, an hour and more before the boot, and
 * the old fingerprint would have found at most the newest of them. The register, polled a
 * minute before the lights went out, holds all three.
 */
function hardShutdown(root, boot) {
  const write = (session, cwd, mtime) => {
    const folder = path.join(root, cwd.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${session}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', cwd })}\n`);
    fs.utimesSync(file, mtime / 1000, mtime / 1000);
    return file;
  };
  const dirs = {
    [id(1)]: fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-dir-')),
    [id(2)]: fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-dir-')),
    [id(3)]: fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-dir-')),
  };
  const files = {
    [id(1)]: write(id(1), dirs[id(1)], boot - 70 * 60000),
    [id(2)]: write(id(2), dirs[id(2)], boot - 3 * 3600000),
    [id(3)]: write(id(3), dirs[id(3)], boot - 25 * 60000),
  };
  const seen = new Date(boot - 45000).toISOString();
  const register = {
    polledAt: seen,
    sessions: Object.fromEntries(
      Object.entries(dirs).map(([sid, cwd], i) => [
        sid,
        { sessionId: sid, cwd, name: `repo${i + 1} - task`, kind: 'interactive', firstSeen: seen, lastSeen: seen },
      ])
    ),
  };
  return { dirs, files, register, cleanup: () => Object.values(dirs).forEach((d) => fs.rmSync(d, { recursive: true, force: true })) };
}

/** The two stores a sweep writes, in memory. */
function stores(state = {}, register = { polledAt: null, sessions: {} }) {
  let st = { opened: {}, parked: {}, ...state };
  let reg = register;
  return {
    loadState: () => st,
    saveState: (patch) => (st = { ...st, ...patch }),
    loadRegister: () => reg,
    saveRegister: (r) => (reg = r),
    state: () => st,
    register: () => reg,
  };
}

test('a hard shutdown: no flush, and every window in the register still comes back', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-'));
  const now = Date.now();
  const uptimeSeconds = 60;
  const boot = now - uptimeSeconds * 1000;
  const fx = hardShutdown(root, boot);
  try {
    const s = stores({}, fx.register);
    const opened = [];
    const out = await resumeAfterReboot(
      { claudeProjectsDir: root },
      { ...s, liveSessions: () => [], openWindow: async (_cfg, win) => (opened.push(win), win), now, uptimeSeconds }
    );
    assert.equal(out.ran, true);
    assert.equal(out.fresh, true);
    assert.deepEqual(
      opened.map((w) => w.sessionId).sort(),
      [id(1), id(2), id(3)],
      'the fingerprint alone would have found one of these at most'
    );
    assert.deepEqual(opened.map((w) => w.dir).sort(), Object.values(fx.dirs).sort(), 'each in its own directory');
    // The report: one row each, reopened, carrying the name the register knew.
    const report = s.state().rebootReport;
    assert.equal(report.boot, new Date(boot).toISOString());
    assert.deepEqual(
      report.rows.map((r) => [r.sessionId, r.outcome, r.source]).sort(),
      [
        [id(1), 'reopened', 'register'],
        [id(2), 'reopened', 'register'],
        [id(3), 'reopened', 'register'],
      ]
    );
    assert.equal(report.rows.find((r) => r.sessionId === id(1)).name, 'repo1 - task');
    // And the register has let go of the rows it decided about.
    assert.deepEqual(s.register().sessions, {}, 'decided rows leave the register');
  } finally {
    fx.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the register row says which; the transcript still says where, and whether it is already back', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-'));
  const now = Date.now();
  const uptimeSeconds = 60;
  const boot = now - uptimeSeconds * 1000;
  const fx = hardShutdown(root, boot);
  try {
    // 1 moved into a worktree after its record was written: its transcript's last cwd is
    // the worktree, and the worktree exists.
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-wt-'));
    fs.appendFileSync(fx.files[id(1)], `${JSON.stringify({ type: 'assistant', cwd: worktree })}\n`);
    fs.utimesSync(fx.files[id(1)], (boot - 60 * 60000) / 1000, (boot - 60 * 60000) / 1000);
    // 2 has been resumed by hand since the boot: its transcript has grown.
    fs.appendFileSync(fx.files[id(2)], `${JSON.stringify({ type: 'user', cwd: fx.dirs[id(2)] })}\n`);
    fs.utimesSync(fx.files[id(2)], (now - 5000) / 1000, (now - 5000) / 1000);
    // 3's worktree was retired while the window was on it.
    fs.rmSync(fx.dirs[id(3)], { recursive: true, force: true });

    const s = stores({}, fx.register);
    const opened = [];
    const out = await resumeAfterReboot(
      { claudeProjectsDir: root },
      { ...s, liveSessions: () => [], openWindow: async (_cfg, win) => (opened.push(win), win), now, uptimeSeconds }
    );
    assert.equal(out.ran, true);
    assert.deepEqual(opened.map((w) => w.sessionId), [id(1)]);
    assert.equal(opened[0].dir, worktree, "the transcript's last cwd, not the record's");
    const by = Object.fromEntries(s.state().rebootReport.rows.map((r) => [r.sessionId, r]));
    assert.equal(by[id(2)].outcome, 'skipped');
    assert.match(by[id(2)].why, /grown since the boot/);
    assert.equal(by[id(3)].outcome, 'skipped');
    assert.match(by[id(3)].why, /directory is gone — the worktree was retired/);
    assert.equal(by[id(3)].dir, fx.dirs[id(3)], 'the report names the directory that is gone');
    fs.rmSync(worktree, { recursive: true, force: true });
  } finally {
    fx.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a daemon window in the register is still parked for its advocate, never reopened', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-'));
  const now = Date.now();
  const uptimeSeconds = 60;
  const boot = now - uptimeSeconds * 1000;
  const fx = hardShutdown(root, boot);
  try {
    const rec = { at: new Date(boot - 60000).toISOString(), sessionId: id(2), dir: fx.dirs[id(2)], workspace: 'loremia', bead: 'lm-p4cq', kind: 'work', title: 'lm-p4cq species' };
    const s = stores({ opened: { [id(2)]: rec } }, fx.register);
    const opened = [];
    const out = await resumeAfterReboot(
      { claudeProjectsDir: root },
      { ...s, liveSessions: () => [], openWindow: async (_cfg, win) => (opened.push(win), win), now, uptimeSeconds }
    );
    assert.deepEqual(opened.map((w) => w.sessionId).sort(), [id(1), id(3)]);
    assert.equal(out.parked.length, 1);
    assert.equal(s.state().parked['loremia/lm-p4cq'].ending, 'reboot');
    const row = s.state().rebootReport.rows.find((r) => r.sessionId === id(2));
    assert.equal(row.outcome, 'parked');
    assert.equal(row.bead, 'lm-p4cq');
    assert.equal(row.workspace, 'loremia');
  } finally {
    fx.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('with no register at all, the flush alone is the cohort — the shape before bc-5to5r.2', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-'));
  try {
    const now = Date.now();
    const uptimeSeconds = 60;
    const boot = now - uptimeSeconds * 1000;
    const folder = path.join(root, '-r-x');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${id(1)}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', cwd: '/r/x' })}\n`);
    fs.utimesSync(file, (boot - 5000) / 1000, (boot - 5000) / 1000);
    const s = stores();
    const opened = [];
    await resumeAfterReboot(
      { claudeProjectsDir: root },
      {
        loadState: s.loadState,
        saveState: s.saveState,
        liveSessions: () => [],
        exists: () => true,
        openWindow: async (_cfg, win) => (opened.push(win), win),
        now,
        uptimeSeconds,
      }
    );
    assert.deepEqual(opened.map((w) => w.sessionId), [id(1)]);
    assert.equal(s.state().rebootReport.rows[0].source, 'flush');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a stamp a second off is the same boot — a crash-restart inside the grace window runs nothing', async () => {
  // `os.uptime()` is whole seconds; two processes read the boot up to a second apart. The
  // old equality check recognised only its own stamp.
  const now = Date.now();
  const uptimeSeconds = 60;
  const boot = now - uptimeSeconds * 1000;
  const s = stores({ rebootResumedAt: new Date(boot + 700).toISOString() });
  let opened = 0;
  const out = await resumeAfterReboot(
    {},
    { ...s, liveSessions: () => [], openWindow: async () => (opened += 1), now, uptimeSeconds }
  );
  assert.equal(out.ran, false);
  assert.match(out.why, /already been resumed/);
  assert.equal(opened, 0);
});

test('a register that will not read is logged and the flush is used alone', async () => {
  const s = stores();
  const out = await resumeAfterReboot(
    { claudeProjectsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-empty-')) },
    {
      ...s,
      loadRegister: () => {
        throw new Error('EACCES');
      },
      liveSessions: () => [],
      openWindow: async () => assert.fail('nothing to open'),
      now: Date.now(),
      uptimeSeconds: 60,
    }
  );
  assert.equal(out.ran, true, 'a broken register is not a reason to skip the boot');
  assert.deepEqual(out.report, []);
});

/* ------------------------------------------------------------------ reading the disk */

test('the directory comes from the transcript, not from the folder name', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-'));
  try {
    // A session that entered a worktree writes under the slug of where it *started*; the
    // last `cwd` in the file is where its files are. Un-slugging the folder could not
    // recover it — every non-alphanumeric character became the same dash.
    const folder = path.join(root, '-r-delta');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${id(4)}.jsonl`);
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ type: 'user', cwd: '/r/delta', timestamp: '2026-09-21T00:10:00Z' }),
        JSON.stringify({ type: 'assistant', cwd: '/r/delta/.claude/worktrees/refs-sweep-4c9' }),
        '',
      ].join('\n')
    );
    const rows = scanTranscripts({ claudeProjectsDir: root });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, id(4));
    assert.equal(rows[0].dir, '/r/delta/.claude/worktrees/refs-sweep-4c9');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a transcript with no cwd in it is no row at all', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-'));
  try {
    const folder = path.join(root, '-r-x');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${id(5)}.jsonl`), `${JSON.stringify({ type: 'summary' })}\n`);
    // Resuming somewhere wrong is worse than not resuming: the agent comes back with a
    // perfect memory of files that are not there, and acts on it.
    assert.deepEqual(scanTranscripts({ claudeProjectsDir: root }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the real window opener refuses inside a suite, before it writes a file', async () => {
  // The door this feature adds to lib/session.js is a second call site for the AppleScript
  // that opens a real iTerm window on Adam's Mac. `assertMayLaunch` is what stands in front
  // of it, and it has to be the *first* thing, not merely somewhere above the Apple event —
  // a guard that fires after the command file is written litters the spool on every test
  // run. test/launchseam.mjs asserts the same property by reading the source; this asserts
  // it by calling the thing.
  const { openResumedWindow } = await import('../lib/session.js');
  const spool = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('beadcause-cmd-')).length;
  let err = null;
  try {
    await openResumedWindow({}, { dir: os.tmpdir(), sessionId: id(1) });
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'a window was opened by a test run');
  assert.equal(err.noLaunch, true, `refused by something else: ${err.message}`);
  assert.equal(
    fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('beadcause-cmd-')).length,
    spool,
    'it wrote a command file before deciding it was not allowed to open anything'
  );
});

test('and it refuses a session id that is not one, or a directory that is not there', async () => {
  const { openResumedWindow } = await import('../lib/session.js');
  // `--resume` takes this on a command line. Everything upstream checks the shape too;
  // this is the seatbelt at the door itself.
  await assert.rejects(() => openResumedWindow({}, { dir: os.tmpdir(), sessionId: '$(rm -rf ~)' }), /not a session id/);
  await assert.rejects(
    () => openResumedWindow({}, { dir: path.join(os.tmpdir(), 'no-such-tree-7f3'), sessionId: id(1) }),
    /not a directory/
  );
});

/* ------------------------------------------------- which iTerm window it comes back in */

/**
 * bc-5to5r.6. One iTerm window per workspace, each session a tab; a window opened with no
 * workspace joins the shared one. After the first real reboot every hand-opened
 * conversation came back as a tab of the beadcause window, because a register row said
 * nothing about its workspace and the pass passed the nothing on. Three rows, three ways
 * of knowing: the register wrote it down; nothing did and the directory is under the
 * project root; nothing did and the directory is outside it (the shell's fallback).
 */
test('each conversation goes back into its own workspace\'s window, under its own name', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-proj-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-reboot-out-'));
  const now = Date.now();
  const uptimeSeconds = 60;
  const boot = now - uptimeSeconds * 1000;
  const write = (session, cwd, mtime) => {
    const folder = path.join(root, cwd.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${session}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: 'assistant', cwd })}\n`);
    fs.utimesSync(file, mtime / 1000, mtime / 1000);
    return file;
  };
  try {
    const d1 = path.join(proj, 'sorrel', '.claude', 'worktrees', 'x-k4t');
    const d2 = path.join(proj, 'ehden');
    const d3 = outside;
    const d4 = path.join(proj, 'ehden', 'sub');
    for (const d of [d1, d2, d4]) fs.mkdirSync(d, { recursive: true });
    write(id(1), d1, boot - 70 * 60000);
    write(id(2), d2, boot - 3 * 3600000);
    write(id(3), d3, boot - 25 * 60000);
    // 4 is in no register at all: the flush fingerprint alone finds it.
    write(id(4), d4, boot - 1000);
    const seen = new Date(boot - 45000).toISOString();
    const row = (sid, cwd, name, extra = {}) => [sid, { sessionId: sid, cwd, name, kind: 'interactive', firstSeen: seen, lastSeen: seen, ...extra }];
    const register = {
      polledAt: seen,
      sessions: Object.fromEntries([
        row(id(1), d1, 'Sorrel - solarium view', { workspace: 'sorrel' }),
        row(id(2), d2, 'EHDEN - round C pod launch'),
        row(id(3), d3, 'Northwind - SOC 2 first'),
      ]),
    };
    const cfg = {
      claudeProjectsDir: root,
      projectRoot: proj,
      fallbackWorkspace: 'architecture',
      workspaces: [
        { name: 'sorrel', dir: path.join(proj, 'beads', 'sorrel', '.beads') },
        { name: 'ehden', dir: path.join(proj, 'beads', 'ehden', '.beads') },
        { name: 'architecture', dir: path.join(proj, 'beads', 'architecture', '.beads') },
      ],
    };
    const s = stores({}, register);
    const opened = [];
    const out = await resumeAfterReboot(cfg, {
      ...s,
      liveSessions: () => [],
      openWindow: async (_cfg, win) => (opened.push(win), win),
      now,
      uptimeSeconds,
    });
    assert.equal(out.ran, true);
    const by = Object.fromEntries(opened.map((w) => [w.sessionId, w]));
    assert.deepEqual(Object.keys(by).sort(), [id(1), id(2), id(3), id(4)]);
    assert.equal(by[id(1)].workspace, 'sorrel', 'the register wrote it down');
    assert.equal(by[id(2)].workspace, 'ehden', 'under the project root: the first path segment names the workspace');
    assert.equal(by[id(3)].workspace, 'architecture', 'outside it: the fallback, as a shell there would resolve');
    assert.equal(by[id(4)].workspace, 'ehden', 'a flush-only row is resolved from its directory too');
    assert.equal(by[id(1)].title, 'Sorrel - solarium view', 'the tab carries the name, not "resumed x-k4t"');
    assert.equal(by[id(4)].title, null, 'a row nothing named gets the opener\'s default');
    // The report says where each went, which is what b7e-sessions prints.
    const report = Object.fromEntries(s.state().rebootReport.rows.map((r) => [r.sessionId, r]));
    assert.equal(report[id(2)].workspace, 'ehden');
    assert.equal(report[id(3)].workspace, 'architecture');
    assert.equal(report[id(4)].workspace, 'ehden');
  } finally {
    for (const d of [root, proj, outside]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('the boot is now minus the uptime', () => {
  assert.equal(bootAt(120, 1_000_000), 880_000);
  assert.equal(bootAt(0, 5), 5);
  // A machine that answers something that is not a number is one that booted now, which
  // makes every record predate it — and the grace check then declines the whole sweep.
  assert.equal(bootAt(null, 42), 42);
  assert.equal(bootAt('soon', 42), 42);
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
