/**
 * The sessions set aside and not finished — *unresolved* — and bringing a workspace's back
 * on request. The terminal half of bc-wsgj6, from Adam's words on 2026-10-12: "the terminal
 * view — by default it should show the unresolved sessions, it should have a 'workspace' view
 * that you can select which workspace to see the sessions for, and be able to resume a
 * workspace's unresolved sessions if they're closed".
 *
 * ## What "unresolved" means here — `isUnresolved`, the one predicate
 *
 * The word is not one the code had (bc-r2hmt), and three readings were on the table. This is
 * the recommended one, **not live and not `done-`**, built behind one function so the answer
 * to that question is a one-line change:
 *
 * - **it has a name.** A session that never named itself — a headless `-p` run, an advocate's
 *   tick, a one-shot question — is not work set aside. Measured on this Mac on 2026-10-12: 536
 *   transcripts written in a week, 153 of them named. Every window on this Mac names itself on
 *   its first turn (the global rule), so an unnamed transcript is one nobody sat at.
 * - **it is not finished.** `done-`/`DONE-` in front of the name is what `rename-session.sh
 *   --done` and lib/retitle.js write when the work landed; `saidDone` in lib/reap.js is the
 *   rule, the same one the reaper uses.
 * - **no process is answering** (`live`), and **no advocate holds it** (`parked` — that
 *   conversation comes back through the dispatch seam, never through here).
 * - **there is a transcript** — the one thing `claude --resume` needs.
 * - **a window a pass reopened is given time to come up.** The record a resumed process writes
 *   lands seconds after the window opens; a `reopened` row not yet live is still arriving for
 *   `REOPEN_SETTLE_MS`, and after that a `reopened` row with no process is a window that has
 *   since been closed, which is unresolved again.
 *
 * Within `UNRESOLVED_LOOKBACK_MS` of transcript writes: past a week a conversation is the
 * `/resume` archive, not the pile this screen exists to show.
 *
 * ## Where the closed ones come from
 *
 * The register (lib/sessionregister.js) **drops** a window the moment the poll finds it gone
 * while the Mac is up — by design, its header says so — so a session closed this morning is
 * nowhere in the daemon's state. It is on disk: its transcript under `~/.claude/projects`, with
 * its last `cwd` and its last `custom-title` line, which are exactly the two facts a resume
 * needs. `scanTranscripts` in lib/rebootresume.js walks them, and `collectSessionRows` folds
 * them under the register, the two reports and the live records (`sessionRows`), so every row
 * carries the most recent thing known about it.
 *
 * ## Resuming — `resumeUnresolved`
 *
 * Goes through the daemon, not the monitor, because bc-wsgj6 wants the phone to offer the
 * same action and the monitor is documented as a consumer that cannot cost the daemon anything.
 * `planResume` mirrors `planReboot`: already running is skipped, parked is its advocate's, a
 * directory that is gone is **reported, never resumed somewhere else**, and `MAX_RESUMED`
 * caps it, newest first. What it did is written as `resumeReport` in the app state — the same
 * row shape as `rebootReport`, stamped with this boot — so `namesToRestore` hands each window
 * its name back the way it does after a boot (bc-5to5r.8), and `sessionRows` shows the rows
 * the pass skipped or could not open. Rows accumulate across resumes within one boot, because
 * the name restore runs on the next register poll and a second resume a minute later must not
 * erase the first's rows before that poll has read them.
 *
 * Every door is injected, as in lib/rebootresume.js: the state store, the live list, the
 * window opener, the clock and the boot. The one irreversible thing — a window — is a function
 * the caller passes, and `openResumedWindow` refuses under a suite (lib/launchguard.js).
 */
import fs from 'node:fs';
import { loadState as readAppState, saveState as writeAppState } from './config.js';
import { liveSessions as readLiveSessions, workspaceFor } from './claude.js';
import { MAX_RESUMED, bootAt, scanTranscripts, tailFacts } from './rebootresume.js';
import { loadRegister as readRegister, sameBoot, sessionRows } from './sessionregister.js';
import { transcriptFile } from './transcript.js';
import { saidDone } from './reap.js';

/** How far back a transcript write counts. A week; older is the `/resume` archive. */
export const UNRESOLVED_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long a window a pass reopened is given to write its record before "reopened and not
 * live" reads as "closed again". Two minutes: a resume takes seconds to come up, and a window
 * that is still not live two minutes on is one that was closed or never came up — either way
 * it is set aside again.
 */
export const REOPEN_SETTLE_MS = 2 * 60 * 1000;

/** How many resume rows the report keeps across one boot. */
const REPORT_MAX_ROWS = 200;

/** The predicate. See the header. */
export function isUnresolved(row, now = Date.now()) {
  if (!row) return false;
  const name = String(row.name || '').trim();
  if (!name) return false;
  if (saidDone(name)) return false;
  if (row.status === 'live' || row.status === 'parked') return false;
  if (!row.transcriptAt) return false;
  if (row.status === 'reopened') {
    const decided = Date.parse(row.decidedAt || '');
    return Number.isFinite(decided) && Number(now) - decided > REOPEN_SETTLE_MS;
  }
  return true;
}

/**
 * A `tail` for `scanTranscripts` that remembers what it read, keyed by file and invalidated
 * by size and mtime — so a monitor redrawing every ten seconds reads each transcript's tail
 * once, not once per frame. One per process; the cache holds a few hundred small objects.
 */
export function tailCache() {
  const seen = new Map();
  return (file, size, mtime) => {
    const had = seen.get(file);
    if (had && had.size === size && had.mtime === mtime) return had.facts;
    const facts = tailFacts(file, size, mtime);
    seen.set(file, { size, mtime, facts });
    return facts;
  };
}

/**
 * Every session this Mac knows about, with `unresolved` decided on each — the rows the
 * monitor's pane and `GET /api/sessions` show, and the rows `resumeUnresolved` plans from.
 *
 * `sessionRows` over all six sources, then the workspace resolved from the directory for any
 * row that does not say (the rule the shell follows, `workspaceFor`), then the predicate. Each
 * door defaults to the real one and is injectable; `transcripts` can be handed in whole for a
 * caller that already scanned.
 */
export function collectSessionRows(
  cfg,
  {
    loadState = readAppState,
    loadRegister = readRegister,
    liveSessions = readLiveSessions,
    booted = bootAt,
    now = Date.now,
    lookback = UNRESOLVED_LOOKBACK_MS,
    tail = tailFacts,
    transcripts = null,
  } = {}
) {
  const state = loadState() || {};
  const register = loadRegister();
  const live = liveSessions(cfg);
  const boot = booted();
  const at = now();
  const report = state.rebootReport && typeof state.rebootReport === 'object' ? state.rebootReport : null;
  const resumeReport = state.resumeReport && typeof state.resumeReport === 'object' ? state.resumeReport : null;
  const scanned = transcripts || scanTranscripts(cfg, { since: at - lookback, tail });
  const byId = new Map(scanned.map((t) => [String(t.sessionId), t]));
  const transcriptAt = (row) => {
    const known = byId.get(String(row.sessionId));
    if (known) return known.mtime;
    const file = transcriptFile(cfg, { cwd: row.dir, sessionId: row.sessionId });
    if (!file) return null;
    try {
      return fs.statSync(file).mtimeMs;
    } catch {
      return null;
    }
  };
  const rows = sessionRows({
    register,
    report,
    resumeReport,
    live,
    opened: state.opened,
    transcripts: scanned,
    boot,
    now: at,
    transcriptAt,
  }).map((r) => {
    const row = { ...r, workspace: r.workspace || workspaceFor(cfg, r.dir) || null };
    row.unresolved = isUnresolved(row, at);
    return row;
  });
  return { rows, report, resumeReport, register, boot, now: at };
}

/**
 * What to do about a workspace's unresolved sessions — pure, the whole decision.
 *
 * The same four refusals as `planReboot`, for the same reasons, plus the workspace itself:
 * closing never touches another workspace's windows and neither does this. Newest transcript
 * first, so a cap that bites keeps the conversation most recently worked.
 */
export function planResume({
  rows = [],
  workspace,
  live = [],
  parked = {},
  max = MAX_RESUMED,
  exists = () => true,
  now = Date.now(),
} = {}) {
  const ws = String(workspace || '').trim();
  const running = new Set((live || []).map((s) => String(s?.sessionId || '')).filter(Boolean));
  const alreadyParked = new Set(
    Object.values(parked || {})
      .map((r) => String(r?.sessionId || ''))
      .filter(Boolean)
  );
  const open = [];
  const skipped = [];
  for (const row of rows) {
    if (!row || (ws && row.workspace !== ws)) continue;
    if (!isUnresolved(row, now)) continue;
    const id = String(row.sessionId);
    if (running.has(id)) {
      skipped.push({ ...row, why: 'it is already running' });
      continue;
    }
    if (alreadyParked.has(id)) {
      skipped.push({ ...row, why: 'it is parked — its advocate brings it back' });
      continue;
    }
    if (!exists(row.dir)) {
      skipped.push({ ...row, why: 'its directory is gone — the worktree was retired' });
      continue;
    }
    open.push(row);
  }
  open.sort((a, b) => String(b.transcriptAt || '').localeCompare(String(a.transcriptAt || '')));
  const capped = open.slice(0, Math.max(0, Number(max) || 0));
  for (const row of open.slice(capped.length)) skipped.push({ ...row, why: `over the cap of ${max} windows` });
  return { open: capped, skipped };
}

/**
 * Bring back every unresolved session of one workspace. See the header.
 *
 * Returns `{ workspace, opened, skipped, failed, report }`, where `report` is the rows
 * written this call. Throws only for a missing workspace name; a window that will not open
 * is a `failed` row, never a thrown route.
 */
export async function resumeUnresolved(
  cfg,
  {
    workspace,
    loadState = readAppState,
    saveState = writeAppState,
    loadRegister = readRegister,
    liveSessions = readLiveSessions,
    openWindow,
    exists = (dir) => Boolean(dir) && fs.existsSync(dir),
    now = Date.now(),
    booted = bootAt,
    max = MAX_RESUMED,
    tail = tailFacts,
    rows = null,
  } = {}
) {
  const ws = String(workspace || '').trim();
  if (!ws) throw new Error('a workspace to resume is required');
  if (typeof openWindow !== 'function') throw new Error('no window opener was given');
  const boot = booted();
  const stamp = new Date(boot).toISOString();
  const state = loadState() || {};
  const live = liveSessions(cfg);
  const known =
    rows || collectSessionRows(cfg, { loadState: () => state, loadRegister, liveSessions: () => live, booted: () => boot, now: () => now, tail }).rows;
  const plan = planResume({ rows: known, workspace: ws, live, parked: state.parked, max, exists, now });

  const report = [];
  const note = (row, outcome, why = null) =>
    report.push({
      sessionId: String(row.sessionId),
      name: row.name || '',
      dir: row.dir || null,
      workspace: row.workspace || ws,
      bead: row.bead || null,
      source: 'resume',
      outcome,
      why,
    });
  for (const row of plan.skipped) {
    note(row, 'skipped', row.why);
    console.log(`[sessions] leaving ${String(row.sessionId).slice(0, 8)} — ${row.why}`);
  }
  const opened = [];
  const failed = [];
  for (const row of plan.open) {
    try {
      await openWindow(cfg, { dir: row.dir, sessionId: row.sessionId, workspace: row.workspace || ws, title: row.name || null });
      opened.push(row);
      note(row, 'reopened', 'resumed on request');
      console.log(`[sessions] brought back ${String(row.sessionId).slice(0, 8)} in ${row.dir}`);
    } catch (err) {
      const why = String(err?.message || err).split('\n')[0];
      failed.push({ ...row, why });
      note(row, 'failed', why);
      console.error(`[sessions] could not bring back ${String(row.sessionId).slice(0, 8)} in ${row.dir} — ${why}`);
    }
  }

  // The report, accumulated within this boot: the register poll reads it next, and a second
  // resume before that poll must not erase the first's names. Best-effort — a report that will
  // not write must not make the windows that opened look as if they did not.
  try {
    const prior = sameBoot(state.resumeReport?.boot, stamp) ? state.resumeReport.rows || [] : [];
    const fresh = new Set(report.map((r) => r.sessionId));
    const rowsKept = [...prior.filter((r) => !fresh.has(String(r?.sessionId))), ...report].slice(-REPORT_MAX_ROWS);
    saveState({ resumeReport: { boot: stamp, at: new Date(now).toISOString(), workspace: ws, rows: rowsKept } });
  } catch (err) {
    console.error(`[sessions] could not write the resume report — ${String(err?.message || err).split('\n')[0]}`);
  }
  return { workspace: ws, opened, skipped: plan.skipped, failed, report };
}
