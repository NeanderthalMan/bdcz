#!/usr/bin/env node
/**
 * The advocates view's tab buttons — Close all, Reopen, Consolidate (bc-4olsx).
 *
 *     npm test
 *     node test/tabpark.mjs
 *
 * lib/tabpark.js closes real iTerm tabs and signals real `claude` processes, so every
 * door here is a stub: the session list, the pid → tty join, the terminal backend, the
 * signal, the resume. Nothing in this file can reach iTerm or a process — and the suite
 * runner's launch guard (lib/launchguard.js) would refuse an open if it tried.
 *
 * What is pinned, in the order it would cost the most to get wrong:
 *
 *   1. **A busy session is never closed** — at triage, and again when a turn starts
 *      between the plan and the signal.
 *   2. **What is parked is enough to bring it back** — session id, directory, name, and
 *      the config dir (the login) it ran under, which the resume line exports.
 *   3. **Consolidate leaves the home window's tabs alone** — moving the rest for real when
 *      the backend can (busy ones included, nothing is interrupted), and parking and
 *      resuming the idle ones when it cannot, saying which method ran and why.
 *   4. **Reopen forgets what it reopened**, keeps what it could not, and the list
 *      survives a restart because it is in the state file.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-tabpark-'));
// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { closeTabs, reopenTabs, consolidateTabs, parkedOf, parkedCounts, parkRecord } = await import(LIB('tabpark.js'));
const { loadState, saveState } = await import(LIB('config.js'));
const { resumeCommand, configDirClause } = await import(LIB('session.js'));
const { configDirForPid } = await import(LIB('claude.js'));
const { parseTabWindows, parseCookie, apiPython, itermBackend } = await import(LIB('termbackend-iterm.js'));

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.stack || err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
}

const HOME = os.homedir();
const PERSONAL = path.join(HOME, '.claude-personal');
const dirA = fs.mkdtempSync(path.join(tmp, 'repo-a-'));
const dirB = fs.mkdtempSync(path.join(tmp, "repo b's-"));

/**
 * A Mac in a box. `sessions` is what `liveSessions` reports; `ttys` maps pid → tty (or
 * a `why` for one with no reachable tab); `windows` maps tty → { window, workspace } for
 * the `tabWindows` probe. Every act is logged in `log`.
 */
function mac({ sessions = [], ttys = {}, windows = {}, configDirs = {}, state = {}, stubborn = [], blockClose = false } = {}) {
  const log = { signals: [], closed: [], opened: [] };
  const alive = new Set(sessions.map((s) => s.pid));
  let store = { parkedTabs: {}, itermWindows: {}, ...state };
  const backend = {
    name: 'stub',
    close: async (tty) => {
      if (blockClose) throw new Error('execution error: Not authorized to send Apple events to iTerm. (-1743)');
      log.closed.push(tty);
      // Closing the tab is a SIGHUP: whatever was still in it goes, unless it is stubborn.
      for (const s of sessions) if (ttys[s.pid] === tty && !stubborn.includes(s.pid)) alive.delete(s.pid);
      return true;
    },
    blocked: (detail) => (/-1743/.test(detail) ? Object.assign(new Error('macOS blocked beadcause from controlling iTerm.'), { status: 403 }) : null),
    tabWindows: async () => Object.entries(windows).map(([tty, w]) => ({ tty, window: w.window, workspace: w.workspace || '' })),
  };
  const doors = {
    liveSessions: () => sessions.filter((s) => alive.has(s.pid)),
    reach: async (pid) =>
      typeof ttys[pid] === 'string'
        ? { can: true, tty: ttys[pid], why: null }
        : { can: false, tty: null, why: ttys[pid]?.why || 'It has no terminal — nothing on this Mac has an input line for it.' },
    configDirOf: async (pid) => (pid in configDirs ? configDirs[pid] : path.join(HOME, '.claude')),
    terminal: () => backend,
    openResumed: async (_cfg, args) => {
      log.opened.push(args);
      return { term: `stub-${args.sessionId}` };
    },
    loadState: () => JSON.parse(JSON.stringify(store)),
    saveState: (patch) => {
      store = { ...store, ...JSON.parse(JSON.stringify(patch)) };
    },
    signal: (pid, sig) => {
      log.signals.push([pid, sig]);
      if (!stubborn.includes(pid)) alive.delete(pid);
      return true;
    },
    alive: (pid) => alive.has(pid),
    exists: (dir) => fs.existsSync(dir),
    sleep: async () => {},
    now: () => new Date('2026-11-08T12:00:00Z'),
    stopWaitMs: 0,
  };
  return { doors, log, backend, state: () => store, alive };
}

const S = (pid, over = {}) => ({
  pid,
  sessionId: `0000000${pid}-aaaa-bbbb-cccc-dddddddddddd`.slice(-36),
  name: `session ${pid}`,
  cwd: dirA,
  workspace: 'demo',
  status: 'idle',
  ...over,
});

console.log('\nthe advocates view tab buttons — lib/tabpark.js\n');

/* ================================================================ 1. never a busy one */

await check('Close all skips a busy session, reports it, and never signals or closes it', async () => {
  const m = mac({
    sessions: [S(101), S(102, { status: 'busy' })],
    ttys: { 101: '/dev/ttys001', 102: '/dev/ttys002' },
  });
  const out = await closeTabs({}, { workspace: 'demo' }, m.doors);
  assert.deepEqual(out.done.map((x) => x.name), ['session 101']);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].name, 'session 102');
  assert.equal(out.skipped[0].reason, 'busy');
  assert.match(out.skipped[0].why, /busy/);
  assert.deepEqual(m.log.signals, [[101, 'SIGTERM']]);
  assert.deepEqual(m.log.closed, ['/dev/ttys001']);
  assert.equal(out.parked, 1);
});

await check('a session that turns busy between the plan and the signal is still not closed', async () => {
  const m = mac({ sessions: [S(111)], ttys: { 111: '/dev/ttys011' } });
  const live = m.doors.liveSessions;
  let calls = 0;
  // First read (triage) idle, every read after it busy.
  m.doors.liveSessions = (cfg) => live(cfg).map((s) => ({ ...s, status: calls++ === 0 ? 'idle' : 'busy' }));
  const out = await closeTabs({}, { workspace: 'demo' }, m.doors);
  assert.equal(out.done.length, 0);
  assert.equal(out.skipped[0].reason, 'busy');
  assert.deepEqual(m.log.signals, []);
  assert.deepEqual(m.log.closed, []);
  assert.deepEqual(parkedOf(m.state(), 'demo'), [], 'a skipped session left a parked record');
});

await check('a session with no iTerm tab is skipped with sessionReach’s own why', async () => {
  const m = mac({
    sessions: [S(121), S(122)],
    ttys: { 121: { why: 'It has no terminal — nothing on this Mac has an input line for it.' }, 122: { why: 'Its terminal (/dev/ttys009) is not an iTerm window — it may be in Terminal.app, tmux, or over ssh.' } },
  });
  const out = await closeTabs({}, { workspace: 'demo' }, m.doors);
  assert.equal(out.done.length, 0);
  assert.deepEqual(
    out.skipped.map((x) => [x.reason, x.why]),
    [
      ['unreachable', 'It has no terminal — nothing on this Mac has an input line for it.'],
      ['unreachable', 'Its terminal (/dev/ttys009) is not an iTerm window — it may be in Terminal.app, tmux, or over ssh.'],
    ]
  );
  assert.deepEqual(m.log.signals, []);
});

await check('only the asked workspace is touched', async () => {
  const m = mac({
    sessions: [S(131), S(132, { workspace: 'other' })],
    ttys: { 131: '/dev/ttys031', 132: '/dev/ttys032' },
  });
  await closeTabs({}, { workspace: 'demo' }, m.doors);
  assert.deepEqual(m.log.closed, ['/dev/ttys031']);
  assert.ok(m.alive.has(132));
});

await check('a process that will not exit is left running and not parked', async () => {
  const m = mac({ sessions: [S(141)], ttys: { 141: '/dev/ttys041' }, stubborn: [141] });
  const out = await closeTabs({}, { workspace: 'demo' }, m.doors);
  assert.equal(out.done.length, 0);
  assert.equal(out.skipped[0].reason, 'stuck');
  assert.deepEqual(parkedOf(m.state(), 'demo'), []);
});

await check('a TCC refusal on close arrives as the backend’s 403, with the record kept', async () => {
  const m = mac({ sessions: [S(151)], ttys: { 151: '/dev/ttys051' }, blockClose: true });
  await assert.rejects(closeTabs({}, { workspace: 'demo' }, m.doors), (err) => err.status === 403 && /blocked/.test(err.message));
  // The process was already stopped; the record is what brings it back.
  assert.equal(parkedOf(m.state(), 'demo').length, 1);
});

/* ======================================================== 2. what is parked, exactly */

await check('the parked record is { sessionId, cwd, name, configDir, parkedAt } and nothing else', async () => {
  const m = mac({
    sessions: [S(201, { cwd: dirB, name: 'Beadcause - tabs' })],
    ttys: { 201: '/dev/ttys201' },
    configDirs: { 201: PERSONAL },
  });
  await closeTabs({}, { workspace: 'demo' }, m.doors);
  const [rec] = parkedOf(m.state(), 'demo');
  assert.deepEqual(Object.keys(rec).sort(), ['configDir', 'cwd', 'name', 'parkedAt', 'sessionId']);
  assert.equal(rec.sessionId, S(201).sessionId);
  assert.equal(rec.cwd, dirB);
  assert.equal(rec.name, 'Beadcause - tabs');
  assert.equal(rec.configDir, PERSONAL);
  assert.equal(rec.parkedAt, '2026-11-08T12:00:00.000Z');
});

await check('an unknown config dir is recorded as null, not guessed', async () => {
  assert.equal(parkRecord(S(1), null).configDir, null);
  assert.equal(parkRecord(S(1), '').configDir, null);
});

await check('parking the same conversation twice keeps one record', async () => {
  const m = mac({ sessions: [S(211)], ttys: { 211: '/dev/ttys211' } });
  const sid = S(211).sessionId;
  m.doors.saveState({ parkedTabs: { demo: [{ sessionId: sid, cwd: '/old', name: 'old', configDir: null, parkedAt: 'x' }] } });
  await closeTabs({}, { workspace: 'demo' }, m.doors);
  const list = parkedOf(m.state(), 'demo');
  assert.equal(list.length, 1);
  assert.equal(list[0].cwd, dirA);
});

await check('configDirForPid reads the environment’s CLAUDE_CONFIG_DIR — the last one on the line', async () => {
  const ps = async () => `claude --print CLAUDE_CONFIG_DIR=/from/argv TERM=xterm CLAUDE_CONFIG_DIR=${PERSONAL} HOME=${HOME}\n`;
  assert.equal(await configDirForPid(4242, { ps }), PERSONAL);
  assert.equal(await configDirForPid(4242, { ps: async () => 'claude TERM=xterm HOME=/x' }), path.join(HOME, '.claude'));
  assert.equal(
    await configDirForPid(4242, {
      ps: async () => {
        throw new Error('gone');
      },
    }),
    null
  );
  assert.equal(await configDirForPid(4242, { ps: async () => '' }), null);
  assert.equal(await configDirForPid(-1), null);
});

/* =============================================== 3. the resume line carries the login */

await check('the resume line exports CLAUDE_CONFIG_DIR after the cd, quoted', async () => {
  const line = resumeCommand(dirB, '5fe356fe-8fb6-43e6-8abc-9ba9febe37c7', '/tmp/beadcause-cmd-x.zsh', {
    configDir: "/Users/x/.claude 'odd'",
  });
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  assert.ok(
    line.startsWith(
      `cd ${q(dirB)} && export CLAUDE_CONFIG_DIR=${q("/Users/x/.claude 'odd'")} && claude --resume '5fe356fe-8fb6-43e6-8abc-9ba9febe37c7'`
    ),
    line
  );
});

await check('the default dir is an unset, and no dir leaves the line as it always was', async () => {
  assert.equal(configDirClause(path.join(HOME, '.claude')), 'unset CLAUDE_CONFIG_DIR && ');
  assert.equal(configDirClause(null), '');
  assert.equal(configDirClause(''), '');
  assert.equal(
    resumeCommand('/w', 'abcdef12', '/tmp/f'),
    resumeCommand('/w', 'abcdef12', '/tmp/f', { configDir: null })
  );
  assert.match(resumeCommand('/w', 'abcdef12', '/tmp/f'), /^cd '\/w' && claude --resume 'abcdef12'/);
});

await check('and a real shell reads the exported dir back exactly, quote and all', async () => {
  const odd = path.join(tmp, "cfg dir's");
  const clause = configDirClause(odd);
  const r = spawnSync('/bin/sh', ['-c', `${clause}printf '%s' "$CLAUDE_CONFIG_DIR"`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, odd);
  const u = spawnSync('/bin/sh', ['-c', `${configDirClause(path.join(HOME, '.claude'))}printf '%s' "\${CLAUDE_CONFIG_DIR-unset}"`], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: '/somewhere/else' },
  });
  assert.equal(u.stdout, 'unset');
});

/* ======================================================================= 4. reopen */

await check('Reopen resumes each parked session in the workspace’s window, with its name and login', async () => {
  const m = mac({ sessions: [S(301, { cwd: dirB, name: 'tabs work' })], ttys: { 301: '/dev/ttys301' }, configDirs: { 301: PERSONAL } });
  await closeTabs({}, { workspace: 'demo' }, m.doors);
  const out = await reopenTabs({}, { workspace: 'demo' }, m.doors);
  assert.deepEqual(m.log.opened, [
    { dir: dirB, sessionId: S(301).sessionId, title: 'tabs work', workspace: 'demo', configDir: PERSONAL },
  ]);
  assert.equal(out.done.length, 1);
  assert.equal(out.parked, 0);
});

await check('Reopen clears the list; a second Reopen is a no-op that says so', async () => {
  const m = mac({ sessions: [S(311), S(312)], ttys: { 311: '/dev/ttys311', 312: '/dev/ttys312' } });
  await closeTabs({}, { workspace: 'demo' }, m.doors);
  assert.equal(parkedOf(m.state(), 'demo').length, 2);
  await reopenTabs({}, { workspace: 'demo' }, m.doors);
  assert.deepEqual(parkedOf(m.state(), 'demo'), []);
  assert.equal(m.state().parkedTabs.demo, undefined, 'an emptied list should drop its key');
  const again = await reopenTabs({}, { workspace: 'demo' }, m.doors);
  assert.equal(again.done.length, 0);
  assert.equal(again.parked, 0);
  assert.match(again.message, /Nothing is parked for demo/);
  assert.equal(m.log.opened.length, 2);
});

await check('an untitled session reopens with no title, so the opener names it', async () => {
  const m = mac({ sessions: [S(321, { name: '' })], ttys: { 321: '/dev/ttys321' } });
  await closeTabs({}, { workspace: 'demo' }, m.doors);
  await reopenTabs({}, { workspace: 'demo' }, m.doors);
  assert.equal(m.log.opened[0].title, null);
});

await check('Reopen skips one already running and one whose directory is gone, and forgets both', async () => {
  const running = S(331);
  const m = mac({ sessions: [running], ttys: {} });
  m.doors.saveState({
    parkedTabs: {
      demo: [
        parkRecord(running, null),
        parkRecord(S(332, { cwd: path.join(tmp, 'gone') }), null),
      ],
    },
  });
  const out = await reopenTabs({}, { workspace: 'demo' }, m.doors);
  assert.deepEqual(out.skipped.map((x) => x.reason).sort(), ['no-dir', 'running']);
  assert.equal(m.log.opened.length, 0);
  assert.equal(out.parked, 0);
});

await check('an open that fails stays parked; a refusal keeps everything not yet opened', async () => {
  const m = mac({});
  m.doors.saveState({ parkedTabs: { demo: [parkRecord(S(341), null), parkRecord(S(342), null), parkRecord(S(343), null)] } });
  let n = 0;
  m.doors.openResumed = async () => {
    n += 1;
    if (n === 1) throw new Error('osascript timed out');
    if (n === 2) return {};
    throw Object.assign(new Error('macOS blocked beadcause from controlling iTerm.'), { status: 403 });
  };
  await assert.rejects(reopenTabs({}, { workspace: 'demo' }, m.doors), (err) => err.status === 403);
  assert.deepEqual(
    parkedOf(m.state(), 'demo').map((r) => r.sessionId),
    [S(341).sessionId, S(343).sessionId]
  );
});

/* ================================================================== 5. consolidate */

await check('fallback: Consolidate leaves the home window’s tabs alone and parks+resumes the rest into it', async () => {
  const m = mac({
    sessions: [S(401), S(402), S(403, { status: 'busy' })],
    ttys: { 401: '/dev/ttys401', 402: '/dev/ttys402', 403: '/dev/ttys403' },
    windows: {
      '/dev/ttys401': { window: 7, workspace: 'demo' },
      '/dev/ttys402': { window: 9, workspace: '' },
      '/dev/ttys403': { window: 9, workspace: '' },
    },
    state: { itermWindows: { demo: 7 } },
  });
  const out = await consolidateTabs({}, { workspace: 'demo' }, m.doors);
  assert.deepEqual(out.stayed.map((x) => x.name), ['session 401']);
  assert.deepEqual(out.done.map((x) => x.name), ['session 402']);
  assert.deepEqual(out.skipped.map((x) => x.reason), ['busy']);
  assert.deepEqual(m.log.closed, ['/dev/ttys402']);
  assert.deepEqual(m.log.opened.map((o) => [o.sessionId, o.workspace]), [[S(402).sessionId, 'demo']]);
  assert.ok(m.alive.has(401), 'a home tab was closed');
  assert.equal(out.parked, 0, 'a moved tab should not stay on the parked list');
  assert.equal(out.method, 'park-resume');
  assert.match(out.fallbackWhy, /cannot move a tab/);
});

await check('fallback: a recorded window that no longer carries the workspace is not home — everything moves', async () => {
  const m = mac({
    sessions: [S(411), S(412)],
    ttys: { 411: '/dev/ttys411', 412: '/dev/ttys412' },
    // Window 7 is still there, but iTerm gave its id to a window Adam opened by hand.
    windows: { '/dev/ttys411': { window: 7, workspace: '' }, '/dev/ttys412': { window: 8, workspace: '' } },
    state: { itermWindows: { demo: 7 } },
  });
  const out = await consolidateTabs({}, { workspace: 'demo' }, m.doors);
  assert.deepEqual(out.stayed, []);
  assert.equal(out.done.length, 2);
  assert.deepEqual(m.log.closed.sort(), ['/dev/ttys411', '/dev/ttys412']);
});

await check('Consolidate refuses on a terminal that cannot say where its tabs are', async () => {
  const m = mac({ sessions: [S(421)], ttys: { 421: '/dev/ttys421' } });
  delete m.backend.tabWindows;
  await assert.rejects(consolidateTabs({}, { workspace: 'demo' }, m.doors), (err) => err.status === 409);
  assert.deepEqual(m.log.closed, []);
});

/* ------------------------------------------------- the real move, via the Python API */

/** `mac()` with a backend that can move tabs; `answer` is what its `consolidate` says. */
function movingMac(opts, answer = null) {
  const m = mac(opts);
  m.log.moves = [];
  m.backend.consolidate = async (args) => {
    m.log.moves.push(args);
    return answer || { moved: args.ttys, missing: [] };
  };
  return m;
}

await check('move: tabs outside home are moved — busy ones too — and nothing is closed or resumed', async () => {
  const m = movingMac({
    sessions: [S(701), S(702, { status: 'busy' }), S(703), S(704)],
    ttys: { 701: '/dev/ttys701', 702: '/dev/ttys702', 703: '/dev/ttys703', 704: { why: 'It has no terminal — nothing on this Mac has an input line for it.' } },
    windows: {
      '/dev/ttys701': { window: 7, workspace: 'demo' },
      '/dev/ttys702': { window: 9, workspace: '' },
      '/dev/ttys703': { window: 9, workspace: '' },
    },
    state: { itermWindows: { demo: 7 } },
  });
  const out = await consolidateTabs({}, { workspace: 'demo' }, m.doors);
  assert.equal(out.method, 'move');
  assert.deepEqual(m.log.moves, [{ homeTty: '/dev/ttys701', ttys: ['/dev/ttys702', '/dev/ttys703'], workspace: 'demo' }]);
  assert.deepEqual(out.done.map((x) => x.name).sort(), ['session 702', 'session 703']);
  assert.deepEqual(out.stayed.map((x) => x.name), ['session 701']);
  assert.deepEqual(out.skipped.map((x) => x.reason), ['unreachable']);
  assert.deepEqual(m.log.signals, []);
  assert.deepEqual(m.log.closed, []);
  assert.deepEqual(m.log.opened, []);
  assert.equal(out.parked, 0);
});

await check('move: with no home, the window holding most of the workspace becomes home and is recorded', async () => {
  const m = movingMac({
    sessions: [S(711), S(712), S(713)],
    ttys: { 711: '/dev/ttys711', 712: '/dev/ttys712', 713: '/dev/ttys713' },
    windows: {
      '/dev/ttys711': { window: 4, workspace: '' },
      '/dev/ttys712': { window: 5, workspace: '' },
      '/dev/ttys713': { window: 5, workspace: '' },
    },
  });
  const out = await consolidateTabs({}, { workspace: 'demo' }, m.doors);
  assert.equal(m.log.moves[0].ttys.join(), '/dev/ttys711');
  assert.ok(['/dev/ttys712', '/dev/ttys713'].includes(m.log.moves[0].homeTty));
  assert.equal(out.stayed.length, 2);
  assert.equal(m.state().itermWindows.demo, 5);
});

await check('move: everything already home is a no-op that never asks the API', async () => {
  const m = movingMac({
    sessions: [S(721)],
    ttys: { 721: '/dev/ttys721' },
    windows: { '/dev/ttys721': { window: 7, workspace: 'demo' } },
    state: { itermWindows: { demo: 7 } },
  });
  const out = await consolidateTabs({}, { workspace: 'demo' }, m.doors);
  assert.equal(out.method, 'move');
  assert.deepEqual(m.log.moves, []);
  assert.equal(out.stayed.length, 1);
});

await check('move: a tab the helper could not find is reported, not claimed', async () => {
  const m = movingMac(
    {
      sessions: [S(731), S(732)],
      ttys: { 731: '/dev/ttys731', 732: '/dev/ttys732' },
      windows: { '/dev/ttys731': { window: 7, workspace: 'demo' }, '/dev/ttys732': { window: 8, workspace: '' } },
      state: { itermWindows: { demo: 7 } },
    },
    { moved: [], missing: ['/dev/ttys732'] }
  );
  const out = await consolidateTabs({}, { workspace: 'demo' }, m.doors);
  assert.deepEqual(out.done, []);
  assert.equal(out.skipped[0].name, 'session 732');
});

await check('move unavailable → park+resume runs instead, says why, and still skips busy', async () => {
  const m = movingMac(
    {
      sessions: [S(741), S(742), S(743, { status: 'busy' })],
      ttys: { 741: '/dev/ttys741', 742: '/dev/ttys742', 743: '/dev/ttys743' },
      windows: {
        '/dev/ttys741': { window: 7, workspace: 'demo' },
        '/dev/ttys742': { window: 8, workspace: '' },
        '/dev/ttys743': { window: 8, workspace: '' },
      },
      state: { itermWindows: { demo: 7 } },
    },
    { unavailable: 'the iterm2 Python package is not installed' }
  );
  const out = await consolidateTabs({}, { workspace: 'demo' }, m.doors);
  assert.equal(out.method, 'park-resume');
  assert.equal(out.fallbackWhy, 'the iterm2 Python package is not installed');
  assert.deepEqual(m.log.closed, ['/dev/ttys742']);
  assert.deepEqual(m.log.opened.map((o) => o.sessionId), [S(742).sessionId]);
  assert.deepEqual(out.skipped.map((x) => x.reason), ['busy']);
});

await check('the real backend’s move refuses under a suite without reaching osascript', async () => {
  const r = await itermBackend.consolidate({ homeTty: '/dev/ttys001', ttys: ['/dev/ttys002'], workspace: 'demo' });
  assert.deepEqual(r, { unavailable: 'refused under a test run' });
  assert.deepEqual(parseCookie('abc123 def456\n'), { cookie: 'abc123', key: 'def456' });
  assert.equal(parseCookie(''), null);
  assert.equal(apiPython(() => false), 'python3');
  assert.match(apiPython(() => true), /\.venv-iterm\/bin\/python3$/);
});

await check('the tab-windows probe is read back line by line', async () => {
  assert.deepEqual(parseTabWindows('/dev/ttys001\t7\tdemo\n/dev/ttys002\t9\t\n\n\tjunk\n/dev/ttys003\t\t'), [
    { tty: '/dev/ttys001', window: 7, workspace: 'demo' },
    { tty: '/dev/ttys002', window: 9, workspace: '' },
    { tty: '/dev/ttys003', window: null, workspace: '' },
  ]);
});

/* ====================================================== 6. one press at a time, on disk */

await check('a second press on the same workspace while one runs is a 409', async () => {
  const m = mac({ sessions: [S(501)], ttys: { 501: '/dev/ttys501' } });
  let release;
  const gate = new Promise((r) => (release = r));
  const reach = m.doors.reach;
  m.doors.reach = async (pid) => {
    await gate;
    return reach(pid);
  };
  const first = closeTabs({}, { workspace: 'demo' }, m.doors);
  await assert.rejects(reopenTabs({}, { workspace: 'demo' }, m.doors), (err) => err.status === 409);
  release();
  await first;
});

await check('the parked list is in the state file, so a restart keeps it', async () => {
  const m = mac({ sessions: [S(601), S(602, { workspace: 'other' })], ttys: { 601: '/dev/ttys601', 602: '/dev/ttys602' }, configDirs: { 601: PERSONAL } });
  // The real state file this time, under the suite's own CONFIG_DIR.
  m.doors.loadState = loadState;
  m.doors.saveState = saveState;
  saveState({ itermWindows: { demo: 3 } });
  await closeTabs({}, { workspace: 'demo' }, m.doors);
  await closeTabs({}, { workspace: 'other' }, m.doors);
  const onDisk = JSON.parse(fs.readFileSync(path.join(process.env.BEADCAUSE_CONFIG_DIR, 'state.json'), 'utf8'));
  assert.equal(onDisk.parkedTabs.demo[0].configDir, PERSONAL);
  assert.equal(onDisk.parkedTabs.other.length, 1);
  assert.deepEqual(onDisk.itermWindows, { demo: 3 }, 'parking clobbered another state key');
  assert.deepEqual(parkedCounts(loadState()), { demo: 1, other: 1 });
  await reopenTabs({}, { workspace: 'demo' }, m.doors);
  assert.deepEqual(parkedCounts(loadState()), { other: 1 }, 'reopening one workspace touched another');
});

await check('a junk parkedTabs field reads as nothing parked', async () => {
  saveState({ parkedTabs: ['not', 'an', 'object'] });
  assert.deepEqual(loadState().parkedTabs, {});
  assert.deepEqual(parkedOf({ parkedTabs: { demo: [{ sessionId: '' }, null, 'x', { sessionId: 'abc', cwd: '/w' }] } }, 'demo'), [
    { sessionId: 'abc', cwd: '/w' },
  ]);
});

await cleanupTmp(tmp);

console.log(`\n${ran - failures}/${ran} checks passed\n`);
process.exit(failures ? 1 : 0);
