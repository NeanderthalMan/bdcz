import fs from 'node:fs';
import { liveSessions as realLiveSessions, configDirForPid } from './claude.js';
import { sessionReach, openResumedWindow } from './session.js';
import { terminal as realTerminal, can } from './termbackend.js';
import { loadState as realLoadState, saveState as realSaveState } from './config.js';
import { homeKey, homeWindowOf, recordHome } from './iterm.js';
import { signal as realSignal } from './reap.js';

/**
 * Park, consolidate and bring back a workspace's Claude tabs — the three buttons on the
 * advocates view (bc-4olsx).
 *
 * **Why it exists.** On 2026-11-08 the Mac hit 17 GB of swap with ~14 Claude sessions
 * open and iTerm froze. Adam parked the eight `~/northwind.dev` ones by hand — pid →
 * session record → `claude --resume` — and asked for that as a button. Three of them:
 *
 *   - **Close all** (bc-4olsx.1) — close every idle Claude tab of one workspace, writing
 *     down for each what it takes to bring it back.
 *   - **Reopen** (bc-4olsx.2) — `claude --resume` every one of those into the
 *     workspace's home window, then forget the list.
 *   - **Consolidate** (bc-4olsx.3) — gather the workspace's tabs into its one home
 *     window. iTerm's AppleScript cannot move a tab between windows, but its Python API
 *     can, so the tabs are moved for real when the API is usable (busy ones too, since
 *     nothing is interrupted); when it is not, this falls back to the other two in a
 *     row, per idle tab: park it and resume it in the home window. Tabs already home are
 *     left alone either way. See `consolidateTabs`.
 *
 * **It reaches sessions nobody here opened.** Nothing is looked up in the advocate's
 * register: the list is `liveSessions` (every Claude Code record on the Mac with a live
 * pid), and a session is reached by `pid → tty → iTerm tab` — `sessionReach` in
 * lib/session.js, the same join the session composer uses. So a tab Adam started at the
 * keyboard is closed exactly like one the daemon launched.
 *
 * **Two kinds of session are never closed, and both are reported rather than dropped:**
 *
 *   - **busy** — mid-turn. Closing it would cut a turn off half way; the transcript is
 *     written continuously, but a tool call in flight is not something to throw away.
 *     The status is read twice, once to plan and again immediately before the signal,
 *     because a turn can start in between.
 *   - **out of reach** — no tty, or one iTerm is not showing. There is no tab to close,
 *     and `sessionReach`'s own `why` says which.
 *
 * **How a tab is closed.** SIGTERM to `claude` first (lib/reap.js's `signal`, the same
 * stop the advocate gives its own finished windows), a short wait for it to exit, then
 * the tab by its tty (`terminal().close`, scripts/close-tab.applescript). Two steps
 * because neither alone is right for both kinds of tab: a daemon-launched tab ends its
 * own shell when `claude` exits (`sessionEnding` in lib/session.js) but a hand-started
 * one comes back to a prompt and stays, and closing a tab with `claude` still running in
 * it is a SIGHUP rather than a stop. The conversation itself is on disk either way —
 * Claude Code writes the transcript as it goes — which is what makes any of this safe.
 *
 * **The record is written before the signal**, so a daemon that dies mid-press leaves a
 * list that over-reports (a session that was never closed shows as parked, and Reopen
 * skips it as already running) rather than one that forgot a closed tab. It lives in
 * state as `parkedTabs: { [workspace]: [{ sessionId, cwd, name, configDir, parkedAt }] }`
 * — on disk, so a restart keeps it.
 *
 * **`configDir` is the login.** Sessions here run under `~/.claude-personal` or the
 * default `~/.claude` depending on where they were started, and a conversation resumed
 * under the other one bills the other account. It is read off the live process
 * (`configDirForPid` in lib/claude.js — the session record's directory cannot say, see
 * there) and carried into the resume line by `configDirClause` in lib/session.js.
 *
 * **Every door is injectable** (`doors` below), so test/tabpark.mjs runs all three
 * operations with no iTerm, no processes and no state file. The real doors are the
 * existing ones: `terminal().close` and `openResumedWindow` (which goes through the
 * backend's `open`, and so through `assertMayLaunch`) — no parallel osascript path. The
 * one new probe is `tabWindows`, an optional backend capability, because nothing else
 * says which window a tab is in.
 */

/** How long a SIGTERMed `claude` gets to exit before its tab is closed on it anyway. */
const STOP_WAIT_MS = 4000;
const STOP_POLL_MS = 150;

/** Is this pid still running? Signal 0 asks without delivering; EPERM is alive. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** The real doors. Built per call so nothing is bound at import time. */
function realDoors() {
  return {
    liveSessions: realLiveSessions,
    reach: sessionReach,
    configDirOf: (pid) => configDirForPid(pid),
    terminal: (cfg) => realTerminal(cfg),
    openResumed: openResumedWindow,
    loadState: realLoadState,
    saveState: realSaveState,
    signal: realSignal,
    alive: pidAlive,
    exists: (dir) => {
      try {
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
    stopWaitMs: STOP_WAIT_MS,
  };
}

const doorsFor = (doors = {}) => ({ ...realDoors(), ...doors });

/* ------------------------------------------------------------------ the record */

const isRecord = (r) =>
  r && typeof r === 'object' && typeof r.sessionId === 'string' && r.sessionId && typeof r.cwd === 'string' && r.cwd;

/** The parked records for one workspace, each checked on its own; junk is dropped. */
export function parkedOf(state, workspace) {
  const all = state?.parkedTabs;
  const list = all && typeof all === 'object' && !Array.isArray(all) ? all[workspace] : null;
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

/** `{ workspace: n }` for every workspace with something parked — what /api/work carries. */
export function parkedCounts(state) {
  const all = state?.parkedTabs;
  const out = {};
  if (!all || typeof all !== 'object' || Array.isArray(all)) return out;
  for (const ws of Object.keys(all)) {
    const n = parkedOf(state, ws).length;
    if (n) out[ws] = n;
  }
  return out;
}

/** What is written down for a session about to be closed. */
export function parkRecord(session, configDir, at = new Date()) {
  return {
    sessionId: String(session.sessionId),
    cwd: String(session.cwd),
    name: String(session.name || ''),
    configDir: typeof configDir === 'string' && configDir ? configDir : null,
    parkedAt: (at instanceof Date ? at : new Date(at)).toISOString(),
  };
}

/** `list` with `rec` in it, replacing any earlier record of the same conversation. */
export const withParked = (list, rec) => [...list.filter((r) => r.sessionId !== rec.sessionId), rec];

/**
 * Write one workspace's list, re-reading state first so a write for another workspace
 * (or any other key) in between is kept. An empty list removes the workspace's key.
 */
function writeParked(d, workspace, list) {
  const all = { ...(d.loadState().parkedTabs || {}) };
  if (list.length) all[workspace] = list;
  else delete all[workspace];
  d.saveState({ parkedTabs: all });
}

const brief = (s, extra = {}) => ({ sessionId: s.sessionId || '', name: s.name || '', ...extra });
const skip = (s, reason, why) => brief(s, { reason, why });

/* ---------------------------------------------------------------- one at a time */

/**
 * One press per workspace at a time. Two Close presses racing would each read the same
 * live list and signal every pid twice; a Reopen racing a Close would resume what is being
 * closed. A second press while one runs is a 409, not a queue — the first one's answer is
 * what the page is waiting for.
 */
const running = new Set();
async function exclusive(workspace, fn) {
  if (running.has(workspace)) {
    throw Object.assign(new Error(`${workspace} is already moving its tabs — wait for that to finish.`), { status: 409 });
  }
  running.add(workspace);
  try {
    return await fn();
  } finally {
    running.delete(workspace);
  }
}

/* ---------------------------------------------------------------------- triage */

/**
 * Which of a workspace's live sessions may be closed, and why each other one may not.
 * `eligible` carries the tty `sessionReach` found, which is the close handle.
 */
async function triage(d, cfg, workspace) {
  const sessions = d.liveSessions(cfg).filter((s) => s.workspace === workspace);
  const eligible = [];
  const skipped = [];
  for (const s of sessions) {
    if (!s.sessionId) {
      skipped.push(skip(s, 'no-id', 'It has no session id yet, so there would be nothing to resume it by.'));
      continue;
    }
    if (s.status === 'busy') {
      skipped.push(skip(s, 'busy', 'It is mid-turn — a busy session is never closed.'));
      continue;
    }
    let reach;
    try {
      reach = await d.reach(s.pid);
    } catch (err) {
      reach = { can: false, why: err.message };
    }
    if (!reach?.can || !reach.tty) {
      skipped.push(skip(s, 'unreachable', reach?.why || 'It has no iTerm tab to close.'));
      continue;
    }
    eligible.push({ ...s, tty: reach.tty });
  }
  return { sessions, eligible, skipped };
}

/** Wait for `pid` to exit, up to `d.stopWaitMs`. True once it has. */
async function waitGone(d, pid) {
  const until = Date.now() + (Number(d.stopWaitMs) || 0);
  for (;;) {
    if (!d.alive(pid)) return true;
    if (Date.now() >= until) return false;
    await d.sleep(STOP_POLL_MS);
  }
}

/**
 * Park one session: record it, stop `claude`, close its tab. `{ record }` on success,
 * `{ skipped }` when it turned out it must not or could not be closed — in which case
 * no record is left behind for it. A terminal refusal (TCC) is thrown, translated.
 */
async function parkOne(d, cfg, workspace, s) {
  // Again, now: a turn may have started since the list was read, and this is the last
  // moment it can still change the answer.
  const now = d.liveSessions(cfg).find((x) => x.pid === s.pid);
  if (!now) return { skipped: skip(s, 'gone', 'It exited on its own before it was closed.') };
  if (now.status === 'busy') return { skipped: skip(s, 'busy', 'It started a turn just now — a busy session is never closed.') };

  const configDir = await d.configDirOf(s.pid);
  const record = parkRecord(s, configDir, d.now());
  writeParked(d, workspace, withParked(parkedOf(d.loadState(), workspace), record));
  const unpark = () => writeParked(d, workspace, parkedOf(d.loadState(), workspace).filter((r) => r.sessionId !== record.sessionId));

  try {
    d.signal(s.pid, 'SIGTERM');
  } catch (err) {
    unpark();
    return { skipped: skip(s, 'signal', `Could not stop it: ${err.message}`) };
  }
  let gone = await waitGone(d, s.pid);

  const t = d.terminal(cfg);
  try {
    await t.close(s.tty, { timeout: 5000 });
  } catch (err) {
    const blocked = t.blocked(err.message);
    if (blocked) throw blocked;
    // Any other failure to close is reported below by whether the process went.
  }
  if (!gone) gone = await waitGone(d, s.pid);
  if (!gone) {
    // Still running after a SIGTERM and its tab: resuming it later would put two
    // processes on one conversation, so it is not parked.
    unpark();
    return { skipped: skip(s, 'stuck', 'It did not exit when asked, so it was left running and not parked.') };
  }
  return { record };
}

/* ----------------------------------------------------------------- the three acts */

/** Close all — bc-4olsx.1. */
export function closeTabs(cfg, { workspace }, doors) {
  const d = doorsFor(doors);
  return exclusive(workspace, async () => {
    const { eligible, skipped } = await triage(d, cfg, workspace);
    const done = [];
    for (const s of eligible) {
      const r = await parkOne(d, cfg, workspace, s);
      if (r.record) done.push(brief(s));
      else skipped.push(r.skipped);
    }
    return { workspace, done, skipped, parked: parkedOf(d.loadState(), workspace).length };
  });
}

/**
 * Bring back the conversations `records` names, in the workspace's home window. Returns
 * the records still owed (an open that failed for a reason worth retrying). A refusal —
 * TCC, or the launch guard under a suite — is rethrown after the list is saved with
 * everything not yet tried still on it.
 */
async function resumeAll(d, cfg, workspace, records, { done, skipped }) {
  const live = new Set(d.liveSessions(cfg).map((s) => s.sessionId).filter(Boolean));
  const owed = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (live.has(rec.sessionId)) {
      skipped.push(skip(rec, 'running', 'It is already running somewhere — not opened twice.'));
      continue;
    }
    if (!d.exists(rec.cwd)) {
      skipped.push(skip(rec, 'no-dir', `Its directory ${rec.cwd} is gone, so it was not resumed somewhere else.`));
      continue;
    }
    try {
      await d.openResumed(cfg, {
        dir: rec.cwd,
        sessionId: rec.sessionId,
        title: rec.name || null,
        workspace,
        configDir: rec.configDir || null,
      });
      done.push(brief(rec));
    } catch (err) {
      if (err?.status === 403 || err?.noLaunch) {
        err.owed = [...owed, ...records.slice(i)];
        throw err;
      }
      owed.push(rec);
      skipped.push(skip(rec, 'open', `Could not open it: ${err.message}`));
    }
  }
  return owed;
}

/** Reopen — bc-4olsx.2. */
export function reopenTabs(cfg, { workspace }, doors) {
  const d = doorsFor(doors);
  return exclusive(workspace, async () => {
    const list = parkedOf(d.loadState(), workspace);
    if (!list.length) {
      return { workspace, done: [], skipped: [], parked: 0, message: `Nothing is parked for ${workspace}.` };
    }
    const done = [];
    const skipped = [];
    let owed;
    try {
      owed = await resumeAll(d, cfg, workspace, list, { done, skipped });
    } catch (err) {
      writeParked(d, workspace, keepNewer(d, workspace, list, err.owed || list));
      throw err;
    }
    writeParked(d, workspace, keepNewer(d, workspace, list, owed));
    return { workspace, done, skipped, parked: parkedOf(d.loadState(), workspace).length };
  });
}

/**
 * What the list should hold after a reopen: what is still `owed`, plus anything parked
 * *during* it that was not in the list the reopen started from (there is nothing today
 * that can, `exclusive` sees to that, but a write must not be able to eat one).
 */
function keepNewer(d, workspace, started, owed) {
  const seen = new Set(started.map((r) => r.sessionId));
  const added = parkedOf(d.loadState(), workspace).filter((r) => !seen.has(r.sessionId));
  return [...owed, ...added];
}

/**
 * Consolidate — bc-4olsx.3. Two methods, and the answer's `method` says which ran:
 *
 * **`move`, preferred** — the backend's optional `consolidate` capability moves the tabs
 * themselves (iTerm2's Python API, `Window.async_set_tabs`; see
 * scripts/iterm-consolidate.py). Nothing is interrupted, scrollback survives, and so the
 * busy rule does not apply: a session mid-turn is moved like any other, because moving a
 * tab is not closing it. Only a session with no iTerm tab is skipped.
 *
 * **`park-resume`, the fallback** — when the backend has no `consolidate`, or it answers
 * `unavailable` (no `iterm2` package, the API off, no cookie; the reason is returned as
 * `fallbackWhy`), each idle tab outside home is parked and resumed into it, and busy
 * sessions are skipped exactly as Close all skips them.
 *
 * **Which window is home.** The one `itermWindows` records for the workspace, *if* it
 * still exists and one of its tabs still carries the workspace's variable — the test
 * scripts/open-session.applescript applies before it uses a recorded id, made here from
 * the `tabWindows` probe so the two cannot disagree. When there is none:
 *
 *   - **move** picks the window already holding most of the workspace's sessions (ties
 *     to the lowest id), moves the rest into it, and the helper stamps every session
 *     there with the workspace variable — so the open script will honour it from now on
 *     — and the window is recorded with `recordHome`.
 *   - **park-resume** cannot stamp a window, so it lets `open` decide: every idle tab
 *     moves and the first resume makes the window. Adopting a hand-opened window there
 *     would be refused by the open script, which would open a new one anyway.
 */
export function consolidateTabs(cfg, { workspace }, doors) {
  const d = doorsFor(doors);
  return exclusive(workspace, async () => {
    const parkedNow = () => parkedOf(d.loadState(), workspace).length;
    const sessions = d.liveSessions(cfg).filter((s) => s.workspace === workspace);
    if (!sessions.length) return { workspace, method: null, done: [], skipped: [], stayed: [], parked: parkedNow() };

    const t = d.terminal(cfg);
    if (!can(t, 'tabWindows')) {
      throw Object.assign(new Error('This terminal cannot say which window a tab is in, so there is nothing to consolidate.'), {
        status: 409,
      });
    }
    // Rejects on a refusal, already translated by the backend.
    const rows = await t.tabWindows();
    const where = new Map(rows.map((r) => [r.tty, r.window]));
    const key = homeKey(workspace);
    const recorded = Number(homeWindowOf(d.loadState().itermWindows, workspace)) || null;
    const home = recorded && rows.some((r) => r.window === recorded && r.workspace === key) ? recorded : null;

    let fallbackWhy = null;
    if (can(t, 'consolidate')) {
      const moved = await moveTabs(d, cfg, t, workspace, sessions, where, home);
      if (!moved.unavailable) return { ...moved, parked: parkedNow() };
      fallbackWhy = moved.unavailable;
    } else {
      fallbackWhy = 'this terminal cannot move a tab between windows';
    }
    const out = await parkAndResume(d, cfg, workspace, where, home);
    return { ...out, method: 'park-resume', fallbackWhy, parked: parkedNow() };
  });
}

/** The `move` method. `{ unavailable }` when the backend says it cannot. */
async function moveTabs(d, cfg, t, workspace, sessions, where, recordedHome) {
  const skipped = [];
  const placed = []; // { s, tty, window }
  for (const s of sessions) {
    let reach;
    try {
      reach = await d.reach(s.pid);
    } catch (err) {
      reach = { can: false, why: err.message };
    }
    if (!reach?.can || !reach.tty) {
      skipped.push(skip(s, 'unreachable', reach?.why || 'It has no iTerm tab to move.'));
      continue;
    }
    if (!where.has(reach.tty)) {
      skipped.push(skip(s, 'unreachable', `Its terminal (${reach.tty}) was not in any iTerm window just now.`));
      continue;
    }
    placed.push({ s, tty: reach.tty, window: where.get(reach.tty) });
  }
  if (!placed.length) return { workspace, method: 'move', done: [], skipped, stayed: [] };

  let home = recordedHome;
  if (!home) {
    const tally = new Map();
    for (const p of placed) if (p.window != null) tally.set(p.window, (tally.get(p.window) || 0) + 1);
    home = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  }
  const stayed = placed.filter((p) => p.window === home);
  const toMove = placed.filter((p) => p.window !== home);
  // A tty in the home window names it to the helper: the Python API's window ids are not
  // the AppleScript ones `itermWindows` records. Any session there will do, ours or not.
  const homeTty = stayed[0]?.tty || [...where.entries()].find(([, w]) => w === home)?.[0];
  if (!toMove.length || !homeTty) {
    return { workspace, method: 'move', done: [], skipped, stayed: stayed.map((p) => brief(p.s)) };
  }

  const said = await t.consolidate({ homeTty, ttys: toMove.map((p) => p.tty), workspace: homeKey(workspace) });
  if (said?.unavailable) return { unavailable: said.unavailable };
  const missing = new Set(said?.missing || []);
  const done = [];
  for (const p of toMove) {
    if (missing.has(p.tty)) skipped.push(skip(p.s, 'unreachable', `Its tab (${p.tty}) had gone by the time it was moved.`));
    else done.push(brief(p.s));
  }
  if (home !== recordedHome) {
    try {
      d.saveState({ itermWindows: recordHome(d.loadState().itermWindows, workspace, home) });
    } catch (err) {
      console.error(`[beadcause] could not record ${workspace}'s iTerm window: ${err.message}`);
    }
  }
  return { workspace, method: 'move', done, skipped, stayed: stayed.map((p) => brief(p.s)) };
}

/** The `park-resume` fallback — the idle tabs outside home, one at a time. */
async function parkAndResume(d, cfg, workspace, where, home) {
  const { eligible, skipped } = await triage(d, cfg, workspace);
  const done = [];
  const stayed = [];
  for (const s of eligible) {
    if (!where.has(s.tty)) {
      skipped.push(skip(s, 'unreachable', `Its terminal (${s.tty}) was not in any iTerm window just now.`));
      continue;
    }
    if (home && where.get(s.tty) === home) {
      stayed.push(brief(s));
      continue;
    }
    const r = await parkOne(d, cfg, workspace, s);
    if (!r.record) {
      skipped.push(r.skipped);
      continue;
    }
    // A refusal here is thrown with the record still parked, so Reopen can finish the
    // job once the Automation checkbox is ticked; an ordinary failure to open is the
    // same, one tab at a time.
    const owed = await resumeAll(d, cfg, workspace, [r.record], { done, skipped });
    if (!owed.length) {
      writeParked(d, workspace, parkedOf(d.loadState(), workspace).filter((x) => x.sessionId !== r.record.sessionId));
    }
  }
  return { workspace, done, skipped, stayed };
}
