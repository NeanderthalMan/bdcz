/**
 * A register of every Claude Code window open on this Mac, written down while it is up —
 * bc-5to5r.2.
 *
 * **What this is for.** lib/rebootresume.js brings back the conversations a reboot killed,
 * and until this existed it had to *infer* which ones those were after the fact, from the
 * shutdown flush: every session alive at shutdown writes its transcript within the same
 * second. That fingerprint is exact for a clean shutdown and worthless for a hard one — a
 * power loss, a panic, a `halt -q` — where nothing flushes and the cohort collapses to
 * whichever session happened to be typing last. Its own header says so.
 *
 * So this writes the answer down *before* the question is asked. Every `REGISTER_POLL_MS`
 * the daemon reads Claude Code's own session records — `~/.claude/sessions/<pid>.json`, one
 * per live process, with the session id, the directory and the name — and keeps a row for
 * each one whose process is alive. Adam's hand-opened windows and the daemon's own are the
 * same kind of row here, because the record does not distinguish them and neither does a
 * reboot. The register is one file, `sessions.json` beside `state.json`, and a hard
 * shutdown now loses at most one poll's worth of changes instead of everything.
 *
 * ## The one rule, and the two halves of it
 *
 * **A session that vanishes while the Mac stays up was closed on purpose.** Adam quit it,
 * or it crashed, and either way he does not want it back — so its row is dropped the next
 * time the poll runs and finds its pid gone. **A session that vanishes because the Mac went
 * down was not**, and its row is the whole point: the poll cannot run across a reboot, so a
 * row whose `lastSeen` predates the current boot is exactly a session that was alive at
 * shutdown. `pollRegister` tells the two apart by comparing `lastSeen` with the boot, which
 * is the only clock that survives a shutdown, and `registerCohort` hands the second kind to
 * the reboot pass as the set to bring back.
 *
 * The pre-boot rows are kept until that pass has run — `handledBoot` — and dropped on the
 * poll after. Without that a daemon that came up too late to resume anything (the grace
 * guard in lib/rebootresume.js) would carry a dead cohort forever, and the register would
 * read as twelve windows nobody could find.
 *
 * ## What is tracked
 *
 * Only `kind: 'interactive'` — a window with a person's terminal behind it, which is the
 * only kind anybody wants a window back for. A subagent, a headless `-p` run or a relay
 * step has its own parent and no screen of its own; bringing one back would be a `claude`
 * process with nowhere to put its answer. A record with no `kind` at all is read as
 * interactive, because the field is newer than the record format and the windows that
 * lack it are the oldest ones on the machine, which is to say the ones somebody has been
 * sitting at longest.
 *
 * ## Why its own file, and why it is not snapshotted
 *
 * `state.json` is snapshotted into the common repo on every write (lib/commonrepo.js), and
 * a file rewritten every sixty seconds would be a commit a minute saying nothing. The
 * register is a *current* fact — which windows are open right now — and its history is
 * worth nothing a minute later, exactly like `status.json`. So it lives beside `state.json`
 * under its own name and that name is on the common repo's ignore list.
 *
 * Everything that reads the disk here is best-effort in the shape lib/claude.js uses: a
 * register that will not parse is an empty one, never an error, because a daemon that would
 * not promote over a half-written sessions file is worse than one that forgets which
 * windows were open.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './config.js';
import { writeJsonAtomic } from './atomic.js';
import { agoPhrase } from './resume.js';
import { workspaceFor } from './claude.js';
import { retitle } from './retitle.js';

/**
 * How often the register is brought up to date.
 *
 * Sixty seconds, which is what Adam asked for and is also the bound on what a hard shutdown
 * can lose: a window opened less than a minute before the lights went out is not written
 * down and does not come back, and one closed less than a minute before is written down
 * and does. Both fail toward recovering a conversation, which is the direction to fail in.
 */
export const REGISTER_POLL_MS = 60 * 1000;

/** The file's name, beside `state.json`. On the common repo's ignore list — see the header. */
export const REGISTER_FILE = 'sessions.json';

export const registerPath = (dir = CONFIG_DIR) => path.join(dir, REGISTER_FILE);

/**
 * How far apart two readings of the boot may be and still be the same boot.
 *
 * `bootAt` in lib/rebootresume.js is `now - uptime`, and `os.uptime()` has one-second
 * resolution, so two processes — or one process twice — read the boot up to a second apart
 * in milliseconds. A stamp compared for equality therefore matched only the process that
 * wrote it, and a crash-restart inside the grace window would have run the pass again.
 * Five seconds is far more than the drift and far less than any two real boots.
 */
export const BOOT_SLACK_MS = 5000;

/** Are these two timestamps (ISO or epoch ms) readings of the same boot? */
export const sameBoot = (a, b, slackMs = BOOT_SLACK_MS) => {
  const x = typeof a === 'number' ? a : Date.parse(a || '');
  const y = typeof b === 'number' ? b : Date.parse(b || '');
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= slackMs;
};

/** Claude Code's own session ids, and nothing else — a row's id ends up beside `--resume`. */
const SESSION_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

const EMPTY = () => ({ polledAt: null, sessions: {} });

/**
 * The register on disk, normalised. Anything that is not the expected shape reads as an
 * empty register: the failure to keep out is a poll acting on rows that describe nothing.
 */
export function loadRegister(file = registerPath()) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return EMPTY();
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY();
  const sessions = {};
  for (const [id, row] of Object.entries(raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {})) {
    const rec = normaliseRow(id, row);
    if (rec) sessions[id] = rec;
  }
  return { polledAt: typeof raw.polledAt === 'string' ? raw.polledAt : null, sessions };
}

export function saveRegister(register, file = registerPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { polledAt: register?.polledAt || null, sessions: register?.sessions || {} });
}

function normaliseRow(id, row) {
  if (!SESSION_ID_RE.test(String(id)) || !row || typeof row !== 'object') return null;
  const lastSeen = Date.parse(row.lastSeen || '');
  if (!Number.isFinite(lastSeen) || typeof row.cwd !== 'string' || !row.cwd) return null;
  return {
    sessionId: String(id),
    cwd: row.cwd,
    name: typeof row.name === 'string' ? row.name : '',
    kind: typeof row.kind === 'string' ? row.kind : 'interactive',
    pid: Number(row.pid) || null,
    // A workspace name, or null — never a string of junk that would then name an iTerm
    // window key (bc-5to5r.6). A row from before the field is read as none, and the
    // reboot pass resolves it from the directory.
    workspace: typeof row.workspace === 'string' && row.workspace.trim() ? row.workspace.trim() : null,
    firstSeen: Number.isFinite(Date.parse(row.firstSeen || '')) ? row.firstSeen : row.lastSeen,
    lastSeen: row.lastSeen,
  };
}

/** Is this a window a person would want back? See the header. */
export const trackable = (session) =>
  Boolean(session) &&
  SESSION_ID_RE.test(String(session.sessionId || '')) &&
  typeof session.cwd === 'string' &&
  session.cwd !== '' &&
  (!session.kind || session.kind === 'interactive');

/**
 * One poll, pure: the register after seeing `live` at `now`.
 *
 * `live` is `liveSessions(cfg)` from lib/claude.js — the records whose pid answers — so a
 * row absent from it is a process that is gone. Whether that is a drop or a keep is the
 * boot comparison in the header: `lastSeen > boot` means it died during this uptime and is
 * dropped; `lastSeen <= boot` means it was alive when the machine went down and is kept for
 * the reboot pass, unless `handledBoot` says that pass has already run for this boot.
 *
 * Returns what changed as well as the result, because the daemon logs additions and drops
 * and nothing else — a line a minute saying "still six windows" is the noisiest line in
 * the log and the least read.
 *
 * `workspaceOf(cwd)` names the workspace a row belongs to — `workspaceFor` in lib/claude.js
 * on the daemon, the same rule the shell's `_bd_set_workspace` follows — and is written on
 * the row because it is what decides **which iTerm window the conversation comes back in**
 * (bc-5to5r.6). One window per workspace, each session a tab (bc-2uj4.16.2): a row with no
 * workspace is filed under the shared one, which after the first real reboot put five
 * Northwind conversations and two EHDEN ones in the beadcause window. Resolved at poll time
 * rather than at boot because the rule reads the config, and the config a boot pass runs
 * with may not be the one the window was opened under.
 */
export function pollRegister(register, live, { now = Date.now(), boot = 0, handledBoot = false, workspaceOf = () => null } = {}) {
  const at = new Date(now).toISOString();
  const prior = register?.sessions || {};
  const seen = new Set();
  const sessions = {};
  const added = [];
  for (const s of live || []) {
    if (!trackable(s)) continue;
    const id = String(s.sessionId);
    seen.add(id);
    const was = prior[id];
    if (!was) added.push(id);
    const cwd = String(s.cwd);
    sessions[id] = {
      sessionId: id,
      cwd,
      // The name moves — a session renames itself every turn — so the latest wins, but a
      // blank from a window still starting up does not erase the name it had.
      name: String(s.name || was?.name || ''),
      kind: String(s.kind || 'interactive'),
      pid: Number(s.pid) || null,
      workspace: workspaceOf(cwd) || was?.workspace || null,
      firstSeen: was?.firstSeen || at,
      lastSeen: at,
    };
  }
  const dropped = [];
  for (const [id, row] of Object.entries(prior)) {
    if (seen.has(id)) continue;
    const last = Date.parse(row.lastSeen || '');
    const predatesBoot = Number.isFinite(last) && last <= Number(boot);
    if (predatesBoot && !handledBoot) {
      sessions[id] = row; // alive at shutdown; the reboot pass decides
      continue;
    }
    dropped.push(id);
  }
  return { register: { polledAt: at, sessions }, added, dropped };
}

/**
 * The rows that were alive when the machine went down — the register's half of the reboot
 * cohort, in the shape `flushCohort` in lib/rebootresume.js produces so the two can be
 * merged: `{ sessionId, dir, mtime }`, plus the name the register knew the window by and
 * the workspace whose iTerm window it goes back into (null on a row an older poll wrote;
 * the reboot pass then resolves it from the directory).
 *
 * `mtime` is `lastSeen`, which is the best the register can say about when the window was
 * last alive. Newest first, like the flush cohort, so a cap that bites keeps the ones most
 * recently confirmed alive.
 */
export function registerCohort(register, boot) {
  const at = Number(boot);
  if (!Number.isFinite(at)) return [];
  return Object.values(register?.sessions || {})
    .filter((r) => Number.isFinite(Date.parse(r.lastSeen || '')) && Date.parse(r.lastSeen) <= at)
    .map((r) => ({
      sessionId: r.sessionId,
      dir: r.cwd,
      mtime: Date.parse(r.lastSeen),
      name: r.name || '',
      kind: r.kind,
      workspace: r.workspace || null,
      source: 'register',
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * The register with these sessions taken out — what the reboot pass does to the rows it
 * has decided about, so they are not decided about again by the next poll.
 */
export function withoutSessions(register, ids) {
  const gone = new Set((ids || []).map(String));
  const sessions = {};
  for (const [id, row] of Object.entries(register?.sessions || {})) if (!gone.has(id)) sessions[id] = row;
  return { polledAt: register?.polledAt || null, sessions };
}

/**
 * The reopened conversations whose name the boot pass owes them — bc-5to5r.8.
 *
 * `claude --resume <id>` continues the conversation but not the window's name: the
 * resumed process writes a fresh `~/.claude/sessions/<pid>.json` with the default Claude
 * Code mints from the directory (`soc2-first-order-e4b-93`), and the `<project> - <task>`
 * name the window had lives only in the previous pid's record, which is gone, and in the
 * transcript's last `custom-title` line, which `/resume` reads and the record does not.
 * After the first real reboot every one of the nine windows the pass brought back wore
 * its default in the status line, in `/sessions`, in this register and in the table.
 *
 * The pass knew the name — it is on the `rebootReport` row it wrote for each window — so
 * this hands it back. Pure: `report` is this boot's `rebootReport` (any other boot's is
 * ignored, exactly as `sessionRows` ignores it), `live` is the live records, and the
 * answer is the `(session, name)` pairs to write. Three rules bound it:
 *
 * - **only a window the pass reopened** — `outcome: 'reopened'`, which is never a window
 *   Adam opened by hand, nor one parked for an advocate, nor one that was already back;
 * - **only while the record still wears a default** — `nameSource !== 'user'`. The
 *   session names itself on its first turn and `/rename` writes `user`, and either must
 *   win over a name from before the boot. This is also what makes it once-only without a
 *   stamp: the write sets `nameSource: 'user'`, and the next poll sees nothing to do;
 * - **nothing to say, nothing written** — a report row with no name, or a record already
 *   showing that name (a Claude Code that one day carries the title through `--resume`),
 *   is left alone.
 */
export function namesToRestore({ report, resumeReport = null, live = [], boot = 0 } = {}) {
  if (!(boot > 0)) return [];
  const byId = new Map();
  for (const s of live) if (trackable(s)) byId.set(String(s.sessionId), s);
  const out = [];
  const done = new Set();
  // Two reports of one shape: what the boot pass reopened, and what a resume on request
  // reopened since (lib/unresolved.js). Both are stamped with the boot they ran under and
  // ignored outside it, for the same reason — a window brought back under an earlier boot
  // is a window that has since been named, or closed, or both.
  for (const rep of [report, resumeReport]) {
    if (!sameBoot(rep?.boot, boot)) continue;
    for (const row of rep?.rows || []) {
      if (row?.outcome !== 'reopened') continue;
      const name = String(row.name || '').trim();
      if (!name) continue;
      const sid = String(row.sessionId || '');
      if (done.has(sid)) continue;
      const session = byId.get(sid);
      if (!session) continue;
      if (session.nameSource === 'user') continue;
      if (String(session.name || '').trim() === name) continue;
      done.add(sid);
      out.push({ session, name });
    }
  }
  return out;
}

/**
 * Start polling. Returns the interval, unref'd, so a daemon shutting down does not wait on it.
 *
 * Every door is injected: the live-session reader, the register store, the boot and the
 * clock, and the app state (for `rebootResumedAt`, which is what `handledBoot` reads, and
 * `rebootReport`, which is what the name restore reads). The first poll is a full interval
 * away rather than immediate, on purpose: the reboot pass runs at promotion and reads the
 * register as it was at shutdown, and a poll that beat it to the file could clear the very
 * rows it was about to bring back.
 *
 * The name restore (`namesToRestore`) runs on the live records *before* they are folded
 * into the register, and the restored name is put on the live row in hand, so the same
 * poll that sees a reopened window for the first time writes it down under the name it
 * had rather than the default — otherwise the register would carry `northwind-dev-38` for
 * a minute and the table with it. `restore` is lib/retitle.js, which writes both stores;
 * what it reports back is logged and never thrown, because a name the daemon could not
 * hand back is not a reason to stop keeping the register.
 *
 * A poll that throws is logged and the next one runs. One unreadable record must not stop
 * the register for the life of the process.
 */
export function startRegisterPoll(
  cfg,
  {
    liveSessions,
    load = loadRegister,
    save = saveRegister,
    loadState,
    booted,
    every = REGISTER_POLL_MS,
    now = Date.now,
    log = console,
    workspaceOf = (cwd) => workspaceFor(cfg, cwd),
    restore = (session, name) => retitle(cfg, session, name),
  } = {}
) {
  const tick = () => {
    try {
      const boot = booted();
      const state = loadState ? loadState() : {};
      const handledBoot = sameBoot(state?.rebootResumedAt, boot);
      const live = liveSessions(cfg);
      for (const { session, name } of namesToRestore({ report: state?.rebootReport, resumeReport: state?.resumeReport, live, boot })) {
        let wrote;
        try {
          wrote = restore(session, name);
        } catch (err) {
          log.error(`[sessions] could not give ${String(session.sessionId).slice(0, 8)} its name back — ${String(err?.message || err).split('\n')[0]}`);
          continue;
        }
        if (!wrote?.record) {
          log.error(`[sessions] could not give ${String(session.sessionId).slice(0, 8)} its name back — its record would not take it`);
          continue;
        }
        session.name = name; // so this poll files it under the name, not the default
        log.log(`[sessions] ${String(session.sessionId).slice(0, 8)} is "${name}" again (brought back at boot)`);
      }
      const { register, added, dropped } = pollRegister(load(), live, { now: now(), boot, handledBoot, workspaceOf });
      save(register);
      const n = Object.keys(register.sessions).length;
      if (added.length || dropped.length) {
        const parts = [];
        if (added.length) parts.push(`+${added.length} new`);
        if (dropped.length) parts.push(`-${dropped.length} closed`);
        log.log(`[sessions] ${n} window${n === 1 ? '' : 's'} in the register (${parts.join(', ')})`);
      }
    } catch (err) {
      log.error(`[sessions] register poll failed — ${String(err?.message || err).split('\n')[0]}`);
    }
  };
  const timer = setInterval(tick, every);
  timer.unref?.();
  timer.tick = tick; // for a test, and for a caller that wants one now
  return timer;
}

/* ------------------------------------------------------------------ the status table */

/**
 * A bead or ticket id named in a window's title, or null.
 *
 * A beadcause window carries its bead in the register row (`opened[...].bead`); Adam's own
 * windows carry it, when they carry it at all, in the `<project> - <task>` name the session
 * gave itself. Two shapes: a beads id (`bc-5to5r`, `cl-xl7n.195`, lower case, and here
 * required to contain a digit so that `re-run` and `e-mail` are not read as beads), and a
 * JIRA key (`JIRA-1234`). Advisory — the column it fills says what the window is *about*,
 * and a wrong guess costs a reader one glance at the name beside it.
 *
 * Two guards, each from a reboot pass that printed the defaults as beads. Only a name a
 * session *gave itself* is read — one with the ` - ` between project and task. A window
 * nobody has named carries Claude Code's default, the directory's basename plus a hash
 * (`soc2-first-order-e4b-93`, `northwind-dev-38`), and every one of those has a bead-shaped
 * tail that is not a bead (`order-e4b`, `dev-38`). The first beadcause-top frame after the
 * 2026-10-12 reboot read nine of them that way (bc-5to5r.7). And a hyphen is not a boundary
 * (bc-5to5r.5): `v3-user-name-terms-b7e-bd` would otherwise read as `terms-b7e` even inside
 * a given name, so a candidate that is the tail of a hyphenated word is a word, and is left
 * alone.
 */
export function beadInName(name) {
  const text = String(name || '');
  if (!text.includes(' - ')) return null;
  const bead = /(?:^|[^a-z0-9-])([a-z]{1,5}-(?=[a-z0-9]*\d)[a-z0-9]{2,8}(?:\.\d+)*)(?![a-z0-9])/.exec(text);
  if (bead) return bead[1];
  const ticket = /(?:^|[^A-Z0-9-])([A-Z]{2,8}-\d{1,7})(?![A-Z0-9])/.exec(text);
  return ticket ? ticket[1] : null;
}

/**
 * The directory, as short as it can be said: a worktree by its own name, a checkout by its
 * basename, and a plain directory the same way. `/r/beadcause/.claude/worktrees/x-k4t` is
 * `beadcause ⟶ x-k4t`, because the repo is the part a reader scans for first.
 */
export function shortDir(dir) {
  const d = String(dir || '');
  if (!d) return '';
  const m = /^(.*)\/\.claude\/worktrees\/([^/]+)\/?$/.exec(d);
  if (m) return `${path.basename(m[1])} ⟶ ${m[2]}`;
  return path.basename(d) || d;
}

/**
 * Every session this Mac knows about, one row each, with what happened to it.
 *
 * Six sources, merged by session id and read in this order of authority:
 *
 * - `live` — a process is answering right now: **live**, whatever anything else says;
 * - `resumeReport` — what a resume on request did about it since the boot (lib/unresolved.js,
 *   the same row shape as the boot pass writes): reopened, skipped and why, failed and why;
 * - `report` — what the last boot's pass decided about it (`rebootReport` in `state.json`):
 *   reopened, parked, skipped and why, or failed and why;
 * - `register` — written down and not live: **waiting for the boot pass** if it predates
 *   the boot and no pass has run, otherwise **gone**;
 * - `transcripts` — a conversation on disk and nothing else: **closed**. The register drops
 *   a window the poll finds gone (its header: closed on purpose), so a session Adam set aside
 *   this week exists only as its transcript, and this is the row that says so. Rows of
 *   `scanTranscripts` in lib/rebootresume.js, whose `title` is the transcript's last
 *   `custom-title` line — the name `/resume` lists it under;
 * - `opened` — the daemon's own register, for the bead a daemon window holds.
 *
 * A row decided by either report carries `decidedAt`, the report's own stamp, so a reader can
 * tell a window reopened a moment ago (not yet live) from one reopened this morning and since
 * closed — `isUnresolved` in lib/unresolved.js is that reader.
 *
 * `transcriptAt` is injected because it is a `stat` per row and this is otherwise pure.
 */
export function sessionRows({
  register,
  report,
  resumeReport = null,
  live = [],
  opened = {},
  transcripts = [],
  boot = 0,
  now = Date.now(),
  transcriptAt = () => null,
} = {}) {
  const rows = new Map();
  const touch = (id, patch) => {
    if (!SESSION_ID_RE.test(String(id || ''))) return;
    rows.set(id, { sessionId: id, ...(rows.get(id) || {}), ...patch });
  };
  for (const t of transcripts || []) {
    if (!t?.dir) continue;
    touch(t.sessionId, { name: t.title || '', dir: t.dir, status: 'closed', why: null, transcriptMtime: Number(t.mtime) || null });
  }
  for (const r of Object.values(register?.sessions || {})) {
    const row = rows.get(r.sessionId) || {};
    touch(r.sessionId, { name: r.name || row.name, dir: r.cwd, lastSeen: r.lastSeen, status: 'gone', why: 'closed while the Mac was up' });
    const last = Date.parse(r.lastSeen || '');
    if (Number.isFinite(last) && last <= Number(boot)) {
      touch(r.sessionId, { status: 'waiting', why: 'alive at shutdown — the boot pass has not run' });
    }
  }
  // Only this boot's reports: last week's "reopened" says nothing about a window today. The
  // resume report is read after the boot pass's because it is the later decision.
  for (const rep of [report, resumeReport]) {
    const current = boot > 0 && sameBoot(rep?.boot, boot) ? rep.rows || [] : [];
    for (const r of current) {
      const row = rows.get(r.sessionId) || {};
      touch(r.sessionId, {
        name: r.name || row.name,
        dir: r.dir || row.dir,
        workspace: r.workspace || row.workspace || null,
        bead: r.bead || row.bead || null,
        status: r.outcome,
        why: r.why || null,
        decidedAt: rep.at || null,
      });
    }
  }
  for (const s of live) {
    if (!trackable(s)) continue;
    const row = rows.get(s.sessionId) || {};
    const decided = row.status && !['live', 'gone', 'waiting', 'closed'].includes(row.status);
    touch(s.sessionId, {
      name: s.name || row.name,
      dir: s.cwd || row.dir,
      workspace: s.workspace || row.workspace || null,
      status: 'live',
      why: decided ? `${row.status} at boot` : null,
      pid: s.pid,
    });
  }
  const out = [];
  for (const row of rows.values()) {
    const daemon = opened?.[row.sessionId];
    const bead = row.bead || daemon?.bead || beadInName(row.name);
    const stat = transcriptAt(row);
    const at = Number.isFinite(stat) ? stat : row.transcriptMtime;
    out.push({
      ...row,
      name: row.name || daemon?.title || '',
      bead: bead || null,
      workspace: row.workspace || daemon?.workspace || null,
      transcriptAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
      transcriptAge: Number.isFinite(at) ? agoPhrase(new Date(at).toISOString(), new Date(now)) : '',
    });
  }
  const rank = { live: 0, reopened: 1, parked: 2, waiting: 3, skipped: 4, failed: 5, gone: 6, closed: 7 };
  return out.sort(
    (a, b) =>
      (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
      String(b.transcriptAt || b.lastSeen || '').localeCompare(String(a.transcriptAt || a.lastSeen || ''))
  );
}

/** What a row's status says in the table. */
export function statusWords(row) {
  switch (row.status) {
    case 'live':
      return row.why ? `live (${row.why})` : 'live';
    case 'reopened':
      return row.why ? `reopened — ${row.why}` : 'reopened';
    case 'closed':
      return 'closed';
    case 'parked':
      return 'parked for its advocate';
    case 'skipped':
      return `skipped${row.why ? ` — ${row.why}` : ''}`;
    case 'failed':
      return `could not reopen${row.why ? ` — ${row.why}` : ''}`;
    case 'waiting':
      return 'alive at shutdown, not yet brought back';
    default:
      return row.why || row.status || '';
  }
}

/**
 * The table, as lines. A header says which boot this is about and what the pass did; then
 * one row per session: name, where, bead, status, last transcript write.
 */
export function renderSessions({ rows, report, register, boot, now = Date.now() } = {}) {
  const lines = [];
  const bootIso = Number.isFinite(Number(boot)) && boot > 0 ? new Date(boot).toISOString() : null;
  const head = [];
  if (bootIso) head.push(`this Mac booted ${agoPhrase(bootIso, new Date(now))} (${bootIso})`);
  if (bootIso && sameBoot(report?.boot, bootIso) && report?.at) {
    const counts = {};
    for (const r of report.rows || []) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
    const said = Object.entries(counts)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ');
    head.push(`the reboot pass ran ${agoPhrase(report.at, new Date(now))}${said ? `: ${said}` : ': nothing was open'}`);
  } else if (bootIso) {
    head.push('no reboot pass has run for this boot');
  }
  if (register?.polledAt) head.push(`register last polled ${agoPhrase(register.polledAt, new Date(now))}`);
  lines.push(...head, '');
  if (!rows?.length) {
    lines.push('no sessions known — nothing live, nothing in the register, nothing decided at boot');
    return lines;
  }
  const cols = [
    ['session', (r) => r.name || `(unnamed ${r.sessionId.slice(0, 8)})`],
    ['where', (r) => shortDir(r.dir)],
    ['bead', (r) => r.bead || ''],
    ['status', (r) => statusWords(r)],
    ['last write', (r) => r.transcriptAge || ''],
  ];
  const cells = rows.map((r) => cols.map(([, f]) => String(f(r) ?? '')));
  const widths = cols.map(([h], i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const fmt = (c) => c.map((v, i) => (i === c.length - 1 ? v : v.padEnd(widths[i]))).join('  ').trimEnd();
  lines.push(fmt(cols.map(([h]) => h)));
  lines.push(fmt(widths.map((w) => '─'.repeat(w))));
  for (const c of cells) lines.push(fmt(c));
  return lines;
}
