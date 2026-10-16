/**
 * Bringing back every conversation a reboot killed — bc-5to5r.
 *
 * **The hole this fills.** A reboot takes down every Claude Code window on the Mac at
 * once, and until this existed beadcause forgot all of them. The open-window register in
 * lib/parked.js is swept by `parkDecision`, whose first rule is that a window with no live
 * session is **dropped** — exactly right for a window Adam closed, and exactly wrong for
 * one the machine took away, because a drop parks nothing and a conversation nothing
 * parked cannot be resumed by anything. Measured on the 2026-09-20 21:53 reboot: the
 * register held one row at shutdown and held none a minute after boot, with no park
 * written and nothing said in the log.
 *
 * And the register is only ever the smaller half. It holds the windows *this daemon*
 * opened; it never holds a window Adam started by hand in a terminal. Since bc-pszow it
 * does hold the ones he opens *through* beadcause (chat, handoff, resume), but only so they
 * can be closed, and `planReboot` reopens those rather than parking them. Six of the seven
 * conversations that reboot killed were his own. A feature that recovered only the register would have brought back one window
 * out of seven and reported success.
 *
 * ## Finding the ones nothing wrote down
 *
 * Claude Code flushes its transcript when it is terminated, so **every session alive at
 * shutdown writes its last line within the same second**. That is the signature, and it is
 * what this module finds: take the newest transcript write at or before the boot, and the
 * cohort is every transcript written within `FLUSH_CLUSTER_MS` of it. On the reboot above
 * that is exact — seven transcripts at 00:52:06Z against a 00:53:38Z boot, and the next
 * one back is eight minutes earlier, in a window that had already been closed.
 *
 * It is a fingerprint rather than a record, so it is read conservatively:
 *
 * - **A hard shutdown leaves no flush.** Power loss, a panic, `halt -q`: the transcripts
 *   are whatever each session last wrote, scattered, and the cluster is then just the
 *   session that happened to be typing last. This under-recovers, which is the direction
 *   to fail in — it reopens fewer windows than it should rather than windows nobody wanted.
 * - **A session already back is never opened twice.** A transcript that has grown *since*
 *   the boot belongs to a conversation someone has already resumed — Adam by hand, or an
 *   earlier run of this sweep — and it is skipped on that evidence alone, before the live
 *   session list is consulted, because a window that came up ten seconds ago may not have
 *   written its session record yet.
 * - **The directory comes from the transcript, not from the folder name.** A session that
 *   ran `EnterWorktree` has written under two slugs and the last `cwd` in the file is the
 *   one its files are actually in. Resuming in the wrong tree gives an agent a perfect
 *   memory of files that are not there — lib/resume.js makes the same argument at length.
 *
 * ## Why this one may open windows by itself, where lib/terminal.js may not
 *
 * The note at the top of lib/terminal.js refuses exactly this for phone ptys: "a daemon
 * that respawned four `claude` processes at boot would be resurrecting sessions nobody
 * asked for, and doing it before anyone was watching". The difference is what comes up. A
 * resumed conversation is handed **no prompt** — `claude --resume <id>` restores the
 * transcript and waits — so nothing runs, nothing is spent, and nothing acts on an hours-old
 * picture of the repo until a person types. What is resurrected is a window, not an agent.
 * Adam asked for this explicitly on 2026-09-20, against the alternative of a card to tap.
 *
 * Three things bound it anyway, and each is a separate failure it has to survive:
 *
 * 1. **Once per boot.** The boot's own timestamp is written to the app state *before* any
 *    window opens, so a crash halfway through reopening ten windows loses the rest rather
 *    than repeating the ones already done. Losing windows is recoverable by hand; opening
 *    every window twice is what the pile this daemon exists to empty looks like.
 * 2. **Only just after a boot.** `BOOT_GRACE_MS` — a daemon that starts hours into an
 *    uptime (a hot swap, a crash-restart, the first deploy of this file) records the boot
 *    as handled and opens nothing. Without it the first restart of any afternoon would
 *    reopen whatever the *last* reboot killed, days late.
 * 3. **A cap.** `MAX_RESUMED` windows, newest first. A reboot in the middle of a busy day
 *    can have twenty conversations behind it, and twenty windows arriving at once is its
 *    own kind of unusable screen.
 *
 * ## The register, since bc-5to5r.2 — and why the flush is still here
 *
 * lib/sessionregister.js now writes the answer down *while the Mac is up*: every minute, a
 * row per live Claude Code window, Adam's and the daemon's alike, and a row whose last
 * sighting predates the boot is a window the machine took. That is a record where the flush
 * is a fingerprint, and it is what makes a hard shutdown recoverable: the flush needs a
 * signal handler to have run, the register needs only to have been written in the last
 * sixty seconds. So `resumeAfterReboot` takes its cohort from **both**, merged by session
 * id — the register says *which* conversations, and the transcript, where there is one,
 * still says *where* (its last `cwd`) and *whether it is already back* (grown since the
 * boot). A session in the flush but not in the register was opened inside the last poll
 * interval before shutdown and is brought back on the flush's word alone, as before.
 *
 * And it writes down what it did. `rebootReport` in the app state is one row per session
 * the pass considered — reopened, parked, skipped and why, failed and why — because a pass
 * that opens eight windows and silently declines a ninth has made a decision Adam would
 * want to see, and the log under `~/Library/Logs` is not where he looks. `bin/b7e-sessions`
 * prints it, and bc-5to5r.3 opens a window on it after a boot.
 *
 * ## Running under the router — bc-5to5r.1
 *
 * Every backend the router spawns starts as a standby and is promoted through
 * `/internal/activate`, and for two weeks this ran only on a process that started active —
 * which in production is none of them. The log had never seen a `[reboot]` line. It now runs
 * on the first promotion of a process as well; the once-per-boot stamp is what keeps the
 * second promoted backend of the day (a hot swap) from doing it again.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectsRoots, transcriptFile } from './transcript.js';
import { beadKey, dropOpen, prKey, prunePark, recordPark, sessionKey } from './parked.js';
import { adamsWindow } from './reap.js';
import { workspaceFor } from './claude.js';
import { registerCohort, sameBoot, withoutSessions } from './sessionregister.js';

/**
 * How soon after a boot the daemon has to start for this to run at all.
 *
 * Ten minutes. launchd brings the daemon up within seconds of login, so the real gap is
 * always under a minute — this is not a tolerance for a slow start, it is the line between
 * *this process came up with the machine* and *this process came up hours later for some
 * other reason*. Every restart that is not a boot (a hot swap, a crash loop, `npm run
 * swap`, the first run of a build carrying this file) lands on the far side of it and
 * opens nothing, which is what keeps a deploy at 3pm from reopening the windows that died
 * at breakfast.
 */
export const BOOT_GRACE_MS = 10 * 60 * 1000;

/**
 * How close two transcript writes have to be to count as the same shutdown flush.
 *
 * Three seconds. The flush is a signal handler running in every process at once, so the
 * spread is milliseconds in practice — measured, all seven at the same whole second — and
 * the slack here is for a machine under load with a dozen node processes being told to
 * stop at the same moment. Widening it costs precision in the one direction that matters:
 * a session Adam closed by hand a minute before shutting down is not a session the reboot
 * killed, and reopening it is a window he already decided he was finished with.
 */
export const FLUSH_CLUSTER_MS = 3000;

/**
 * How far back to look for the flush at all.
 *
 * The cluster is anchored to the newest write at or before the boot, and that anchor is
 * only meaningful if it is *near* the boot. Fifteen minutes: past that, whatever was
 * written is not a shutdown flush but an ordinary session that went quiet, and this
 * declines to guess. A clean shutdown writes its flush seconds before the kernel goes
 * down; the 92 seconds measured on 2026-09-20 is a laptop finishing its own shutdown
 * sequence, and is the shape of the slowest case seen.
 */
export const FLUSH_LOOKBACK_MS = 15 * 60 * 1000;

/** How many windows one boot may reopen. See the header. */
export const MAX_RESUMED = 12;

/** Claude Code's own session ids, and nothing else — this ends up beside `--resume`. */
const SESSION_ID_RE = /^[0-9a-fA-F-]{8,64}$/;

/**
 * When this machine last booted, in epoch milliseconds.
 *
 * `os.uptime()` rather than `sysctl kern.boottime`, which is the other way to ask: it is
 * in the standard library, it needs no subprocess on the daemon's startup path, and it is
 * the same number. Second resolution, which is far finer than anything here compares
 * against — the closest comparison is a three-second cluster.
 *
 * Both arguments are injectable because every test of this is a test of arithmetic about a
 * boot that is not happening.
 */
export const bootAt = (uptimeSeconds = os.uptime(), now = Date.now()) =>
  Math.round(Number(now) - Math.max(0, Number(uptimeSeconds) || 0) * 1000);

/**
 * The transcripts written by the shutdown flush — the conversations the reboot killed.
 *
 * Pure, over rows of `{ sessionId, dir, mtime }`, so the whole of the judgement can be
 * driven from a table. The anchor is the newest write at or before the boot and within
 * `lookback` of it; the cohort is everything within `cluster` of the anchor. No rows at
 * all, or nothing recent enough to anchor on, is an empty list rather than a guess.
 *
 * Rows written *after* the boot are not merely excluded from the cohort — their session is
 * excluded outright, by id, because a transcript that has grown since the boot is a
 * conversation already back. That is the check that makes this safe to run twice, and it
 * is evidence from the file rather than from a register, which is why it holds for a
 * window Adam resumed by hand thirty seconds ago.
 */
export function flushCohort(rows, boot, { cluster = FLUSH_CLUSTER_MS, lookback = FLUSH_LOOKBACK_MS } = {}) {
  const at = Number(boot);
  if (!Number.isFinite(at)) return [];
  const usable = (rows || []).filter(
    (r) => r && SESSION_ID_RE.test(String(r.sessionId || '')) && r.dir && Number.isFinite(Number(r.mtime))
  );
  const backAlready = new Set(usable.filter((r) => Number(r.mtime) > at).map((r) => String(r.sessionId)));
  const before = usable.filter((r) => Number(r.mtime) <= at && !backAlready.has(String(r.sessionId)));
  if (!before.length) return [];
  const anchor = Math.max(...before.map((r) => Number(r.mtime)));
  if (at - anchor > lookback) return [];
  return before
    .filter((r) => anchor - Number(r.mtime) <= cluster)
    .sort((a, b) => Number(b.mtime) - Number(a.mtime));
}

/**
 * What to do about every conversation the reboot killed — the whole decision, pure.
 *
 * Two kinds come out, and they are not the same kind of thing, which is the point of
 * deciding them together:
 *
 * - **`park`** — a window that was in beadcause's own register. It belongs to an advocate:
 *   it has a bead, a claim, an attempt budget and a one-window guard, and the way it comes
 *   back is the way every other parked conversation comes back, through the dispatch seam
 *   in lib/advocate.js. Reopening it here would open a window the advocate does not know
 *   about and then let the advocate open a second on the same bead — which is the one
 *   failure the register exists to prevent.
 * - **`open`** — one of Adam's windows: either nothing wrote it down, or the register
 *   holds it under one of his kinds (`adamsWindow` in lib/reap.js). There is no advocate
 *   and no slot, so there is nothing to hand it to; this module opens it itself.
 *
 * `live` is the session list from lib/claude.js: a conversation with a process behind it
 * is already back and is skipped. It is the second of the two liveness checks and the
 * weaker one — a window that opened seconds ago may not have written its record yet, which
 * is why `flushCohort` does the first one off the transcript's own mtime.
 *
 * **`parked` is checked as well as `opened`, and leaving it out was a real bug rather than
 * a tidiness.** The two stores are one register in two states: a park *moves* a row out of
 * `opened` and into `parked` (`saveAppState({ opened: dropOpen(…), parked: … })` in
 * `parkIdle`). So whether a daemon window is found registered depends on whether an
 * advocate tick beat this sweep to it — and if it did, the row is missing from `opened`,
 * this would read it as one of Adam's, and open a plain window on a bead whose advocate is
 * about to resume it from the park. Two windows on one bead, which is the exact failure the
 * register exists to prevent. Absence from *both* stores is what makes a conversation
 * nobody's but Adam's.
 *
 * `exists` is asked about the directory of every window that would be opened, and a
 * directory that is gone is a **skip with a reason**, not an open that fails: the usual
 * cause is a worktree retired or pruned while the window was still on it, and the right
 * answer is to say so in the report rather than to resume the conversation somewhere else
 * (lib/resume.js: a perfect memory of files that are not there). Injected, defaulting to
 * *yes*, because every pure test of this plans windows in directories that do not exist.
 */
export function planReboot({ cohort = [], opened = {}, parked = {}, live = [], max = MAX_RESUMED, exists = () => true } = {}) {
  const registered = new Map(
    Object.values(opened || {})
      .filter((r) => r?.sessionId)
      .map((r) => [String(r.sessionId), r])
  );
  const alreadyParked = new Set(
    Object.values(parked || {})
      .map((r) => String(r?.sessionId || ''))
      .filter(Boolean)
  );
  const running = new Set((live || []).map((s) => String(s?.sessionId || '')).filter(Boolean));

  const park = [];
  const open = [];
  const skipped = [];
  for (const row of cohort) {
    const id = String(row.sessionId);
    if (running.has(id)) {
      skipped.push({ ...row, why: 'it is already running' });
      continue;
    }
    // One of Adam's own kinds (a chat, a handoff, an earlier resume) is registered only so
    // the park sweep can close it once it goes quiet (bc-pszow). It has no advocate to hand
    // it back, and he was sitting at it, so it comes back the way an unregistered window
    // does: opened here.
    if (registered.has(id) && !adamsWindow(registered.get(id).kind)) {
      park.push({ ...row, rec: registered.get(id) });
      continue;
    }
    if (alreadyParked.has(id)) {
      skipped.push({ ...row, why: 'it is parked already — its advocate brings it back' });
      continue;
    }
    if (!exists(row.dir)) {
      skipped.push({ ...row, why: 'its directory is gone — the worktree was retired' });
      continue;
    }
    open.push(row);
  }
  // Newest first, so a cap that bites keeps the conversation that was typing when the
  // machine went down rather than whichever one the filesystem listed first.
  const capped = open.slice(0, Math.max(0, Number(max) || 0));
  for (const row of open.slice(capped.length)) skipped.push({ ...row, why: `over the cap of ${max} windows` });
  return { park, open: capped, skipped };
}

/* ------------------------------------------------------------------ reading the disk */

/**
 * Every transcript on this Mac, as `{ sessionId, dir, mtime }`.
 *
 * `mtime` comes from the directory entry and `dir` from the **last `cwd` written inside
 * the file**, which is the one field here that cannot be taken from the cheaper source: a
 * session that entered a worktree mid-run has written under the slug of where it started,
 * and un-slugging a folder name is not reversible anyway (every non-alphanumeric character
 * became the same dash). So the tail is read — 64KB, only for files in the window that
 * could possibly be in the cohort, which is a handful on any real boot.
 *
 * Best-effort throughout, in the shape lib/claude.js uses: an unreadable file is one fewer
 * row, never an error. A daemon that would not start because a transcript was half-written
 * is worse than one that brings back six windows out of seven.
 */
export function scanTranscripts(cfg, { since = 0, until = Infinity, tail = tailFacts } = {}) {
  const out = [];
  for (const root of projectsRoots(cfg)) {
    let dirs;
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      let files;
      try {
        files = fs.readdirSync(path.join(root, entry.name));
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const sessionId = file.slice(0, -'.jsonl'.length);
        if (!SESSION_ID_RE.test(sessionId)) continue;
        const full = path.join(root, entry.name, file);
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.mtimeMs < since || st.mtimeMs > until) continue;
        const facts = tail(full, st.size, st.mtimeMs) || {};
        out.push({ sessionId, dir: facts.cwd || null, title: facts.title || '', mtime: st.mtimeMs, file: full });
      }
    }
  }
  return out.filter((r) => r.dir);
}

/** The last `cwd` recorded in a transcript — where that agent's files actually are. */
function lastCwd(file, size) {
  return tailFacts(file, size).cwd;
}

/**
 * How far back a transcript is read for its title. Sixteen chunks of 64KB: a session that
 * renames itself every turn (the rule every window on this Mac follows) has its title inside
 * the last turn, and one megabyte is past the longest turn measured; a transcript with no
 * title in its last megabyte is read as unnamed rather than read to the top.
 */
const TITLE_CHUNK = 64 * 1024;
const TITLE_CHUNKS = 16;

/**
 * The two facts a transcript's tail holds about the session: where it was (`cwd`, from the
 * last line that names one) and what it was called (`title`, the last `custom-title` line
 * — what `rename-session.sh` writes and what the `/resume` picker labels it with).
 *
 * The `cwd` comes from the last 64KB, as `lastCwd` always read it. The title is looked for
 * further back, in chunks from the end, because a turn's tool results can run past 64KB and
 * the title line sits *before* them: written at the top of the turn, when the session renamed
 * itself. Both are best-effort and null-for-absent, in the shape the rest of this file uses.
 */
export function tailFacts(file, size, _mtime, { chunk = TITLE_CHUNK, chunks = TITLE_CHUNKS } = {}) {
  const total = Number(size) || 0;
  if (!total) return { cwd: null, title: '' };
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return { cwd: null, title: '' };
  }
  const read = (start, length) => {
    const buf = Buffer.alloc(length);
    try {
      fs.readSync(fd, buf, 0, length, start);
    } catch {
      return null;
    }
    return buf.toString('utf8');
  };
  try {
    let cwd = null;
    let title = '';
    // A chunk ends on a line break only by luck, so the partial first line of each chunk is
    // carried into the next (earlier) chunk, where its beginning is.
    let carry = '';
    let end = total;
    for (let i = 0; i < chunks && end > 0; i += 1) {
      const start = Math.max(0, end - chunk);
      const text = read(start, end - start);
      if (text === null) break;
      const lines = (text + carry).split('\n');
      carry = start > 0 ? lines.shift() : '';
      // Newest line last, so a scan from the end finds the last title and the last cwd.
      for (let j = lines.length - 1; j >= 0; j -= 1) {
        const line = lines[j];
        if (!line.startsWith('{')) continue;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        if (i === 0 && cwd === null && typeof rec?.cwd === 'string' && rec.cwd) cwd = rec.cwd;
        if (!title && rec?.type === 'custom-title' && typeof rec.customTitle === 'string') title = rec.customTitle.trim();
        if (title && (cwd !== null || i > 0)) break;
      }
      if (title) break;
      end = start;
    }
    return { cwd, title };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The two cohorts as one, by session id — pure, with the transcript lookup injected.
 *
 * `fromRegister` is `registerCohort` from lib/sessionregister.js: the windows the register
 * last saw alive before the boot. For each, `transcriptFor(row)` answers `{ dir, mtime }`
 * for its transcript, or null. Two of those answers are skips rather than drops, so the
 * report can say why: a transcript that has **grown since the boot** is a conversation
 * already back — the same check `flushCohort` makes off its own rows, made here off the
 * register's — and **no transcript at all** is nothing for `--resume` to restore. Where
 * there is one, its last `cwd` beats the register's, for the reason in `scanTranscripts`:
 * a session that entered a worktree has moved, and the record Claude Code keeps per pid
 * still says where it started.
 *
 * `flush` is the fingerprint cohort, and a row of it not in the register is kept: it is a
 * window opened inside the last poll interval before the shutdown, and the flush is the
 * only thing that saw it. One already skipped on the register's evidence stays skipped.
 */
export function mergeCohorts(flush, fromRegister, { boot, transcriptFor = () => null } = {}) {
  const at = Number(boot);
  const byId = new Map();
  const skipped = [];
  const skippedIds = new Set();
  for (const row of fromRegister || []) {
    const id = String(row.sessionId);
    const t = transcriptFor(row);
    if (!t) {
      skipped.push({ ...row, why: 'no transcript on disk — nothing for --resume to restore' });
      skippedIds.add(id);
      continue;
    }
    if (Number(t.mtime) > at) {
      skipped.push({ ...row, why: 'its transcript has grown since the boot — it is already back' });
      skippedIds.add(id);
      continue;
    }
    byId.set(id, {
      ...row,
      dir: t.dir || row.dir,
      mtime: Math.max(Number(row.mtime) || 0, Number(t.mtime) || 0),
    });
  }
  for (const row of flush || []) {
    const id = String(row.sessionId);
    if (skippedIds.has(id)) continue;
    if (byId.has(id)) {
      byId.set(id, { ...byId.get(id), dir: row.dir || byId.get(id).dir });
      continue;
    }
    byId.set(id, { ...row, source: 'flush' });
  }
  return { cohort: [...byId.values()].sort((a, b) => Number(b.mtime) - Number(a.mtime)), skipped };
}

/* ------------------------------------------------------------------- the sweep */

/**
 * Bring back everything the reboot killed. Called once per process, from the daemon's
 * startup when it starts active and from its first promotion when it starts as a standby.
 *
 * The order is the argument, and it is the opposite of lib/parked.js's:
 *
 * > **Stamp the boot first, then open the windows.**
 *
 * That file writes the park record before closing a window because the record is the only
 * copy of the conversation and a crash in between is unrecoverable. Here the conversation
 * is already safe on disk and the scarce thing is the screen, so the hazard runs the other
 * way: a crash halfway through opening ten windows, followed by a launchd restart, would
 * open the first ones a second time. Stamping first means a crash costs the windows that
 * had not opened yet — recoverable by hand, and visible, because nothing came back.
 *
 * Everything after the stamp is best-effort and logged per window. One directory that has
 * been deleted, or one iTerm that will not answer, must not take the other nine with it.
 *
 * Every door it touches is injected — the state store, the register store, the
 * live-session list, the window opener — for the reason the rest of this file is pure: the
 * whole of this decision is testable, and the one irreversible thing in it is a function
 * the suite passes in. `loadRegister`/`saveRegister` default to *no register*, which is the
 * state before bc-5to5r.2 and the state of a config directory that has never had the poll
 * run in it; the flush alone is then the cohort, exactly as before.
 *
 * The result carries `fresh` (this really was a boot, and the pass ran) and `report` (the
 * rows written to `rebootReport`), which is what bin/beadcause.js reads to decide whether
 * there is anything worth a status window.
 */
export async function resumeAfterReboot(
  cfg,
  {
    loadState,
    saveState,
    liveSessions,
    openWindow,
    loadRegister = null,
    saveRegister = null,
    // Whether a window's directory is still there. Injected so a suite can plan windows
    // in directories it never made; the daemon passes nothing and gets the disk.
    exists = (dir) => Boolean(dir) && fs.existsSync(dir),
    now = Date.now(),
    // Injected beside `now`, and it has to be: how late this is runs off the *uptime*
    // alone — `now - boot` is `uptime` by construction, since the boot is derived from it
    // — so a suite that moved only the clock could never reach the branch that opens a
    // window. That is not a testing convenience; the un-injectable version of this file
    // had exactly one untested path and it was the one that does the work.
    uptimeSeconds = os.uptime(),
  } = {}
) {
  if (cfg?.resumeAfterReboot === false) return { ran: false, why: 'switched off' };
  const boot = bootAt(uptimeSeconds, now);
  const stamp = new Date(boot).toISOString();

  let state;
  try {
    state = loadState();
  } catch {
    // No state file is no memory of which boots have been handled, and this is the one
    // sweep that must never run twice. Declining is the safe half of that.
    return { ran: false, why: 'the app state could not be read' };
  }
  // `sameBoot`, not equality: `os.uptime()` is whole seconds, so two processes read the
  // same boot up to a second apart, and an exact match would only ever recognise the
  // process that wrote the stamp. A crash-restart inside the grace window ran it twice.
  if (sameBoot(state?.rebootResumedAt, stamp)) return { ran: false, why: 'this boot has already been resumed' };

  // Read before the stamp, and before anything is awaited: the register poll drops
  // pre-boot rows once the boot is stamped as handled, and this is the one reader that
  // wants them.
  let register = null;
  if (loadRegister) {
    try {
      register = loadRegister();
    } catch (err) {
      console.error(`[reboot] the session register could not be read — ${err.message.split('\n')[0]}; using the flush alone`);
    }
  }

  const late = now - boot > BOOT_GRACE_MS;
  try {
    saveState({ rebootResumedAt: stamp });
  } catch (err) {
    // Unstamped is unbounded: without the record this would run again on the next restart
    // and open every window a second time. So nothing opens.
    console.error(`[reboot] not resuming anything — the boot could not be stamped: ${err.message}`);
    return { ran: false, why: 'the boot could not be stamped' };
  }
  if (late) {
    console.log(
      `[reboot] started ${Math.round((now - boot) / 60000)}m into this uptime, so nothing here was killed by a ` +
        'reboot — noted, and nothing resumed'
    );
    return { ran: false, why: 'not a fresh boot' };
  }

  // `since` and deliberately no `until`: the rows written *after* the boot are the ones
  // that prove a conversation is already back, and `flushCohort` needs them in hand to
  // exclude it. Bounding the scan at the boot would hide exactly that evidence.
  const flush = flushCohort(scanTranscripts(cfg, { since: boot - FLUSH_LOOKBACK_MS }), boot);
  const transcriptFor = (row) => {
    const file = transcriptFile(cfg, { cwd: row.dir, sessionId: row.sessionId });
    if (!file) return null;
    try {
      const st = fs.statSync(file);
      return { dir: lastCwd(file, st.size), mtime: st.mtimeMs, file };
    } catch {
      return null;
    }
  };
  const merged = mergeCohorts(flush, registerCohort(register, boot), { boot, transcriptFor });
  const cohort = merged.cohort;
  const report = [];
  const note = (row, outcome, why = null) =>
    report.push({
      sessionId: String(row.sessionId),
      name: row.name || row.rec?.title || '',
      dir: row.dir || row.rec?.dir || null,
      workspace: row.rec?.workspace || row.workspace || null,
      bead: row.rec?.bead || null,
      source: row.source || 'flush',
      outcome,
      why,
    });
  for (const row of merged.skipped) {
    note(row, 'skipped', row.why);
    console.log(`[reboot] leaving ${row.sessionId.slice(0, 8)} — ${row.why}`);
  }

  /**
   * Written whether or not anything was open, and *before* the register is trimmed, so a
   * crash between the two leaves a report that says what was decided rather than a register
   * that has forgotten the rows and a report that never mentions them. Best-effort: a report
   * that will not write must not stop a window opening.
   */
  const writeReport = () => {
    try {
      saveState({ rebootReport: { boot: stamp, at: new Date(now).toISOString(), rows: report } });
    } catch (err) {
      console.error(`[reboot] could not write the report — ${err.message.split('\n')[0]}`);
    }
    if (register && saveRegister) {
      try {
        const handled = Object.values(register.sessions || {})
          .filter((r) => Date.parse(r.lastSeen || '') <= boot)
          .map((r) => r.sessionId);
        if (handled.length) saveRegister(withoutSessions(register, handled));
      } catch (err) {
        console.error(`[reboot] could not trim the session register — ${err.message.split('\n')[0]}`);
      }
    }
  };

  if (!cohort.length) {
    console.log('[reboot] no conversation was open when this Mac went down');
    writeReport();
    return { ran: true, fresh: true, opened: [], parked: [], skipped: merged.skipped, report };
  }

  const plan = planReboot({
    cohort,
    opened: state.opened,
    parked: state.parked,
    live: liveSessions(cfg),
    exists,
  });
  for (const row of plan.skipped) {
    note(row, 'skipped', row.why);
    console.log(`[reboot] leaving ${row.sessionId.slice(0, 8)} — ${row.why}`);
  }
  /**
   * The register's own rows are **parked, not opened** — see `planReboot`.
   *
   * `ending: 'reboot'` so `resumeFor` in lib/advocate.js can tell the resumed agent what
   * actually happened to it, and `waitingOn` is the console's sentence about the same
   * fact. Both say the one thing that distinguishes this from every other park: nobody
   * closed this window and nothing was decided — the machine went down under it.
   */
  const parked = [];
  for (const planned of plan.park) {
    const { rec } = planned;
    const key = rec.bead
      ? beadKey(rec.workspace, rec.bead)
      : rec.pr
        ? prKey(rec.workspace, rec.pr)
        : sessionKey(rec.sessionId);
    const row = { ...rec, ending: 'reboot', waitingOn: 'the Mac rebooted while it was open — nothing was decided' };
    try {
      // One write per park, and the register row dropped in the same one — the pattern
      // `parkIdle` in lib/advocate.js uses, and for its reason: a batched write means a
      // crash in the middle leaves rows dropped from the register with nothing parked in
      // their place, which is the loss this whole module exists to stop.
      const store = loadState();
      saveState({
        parked: prunePark(recordPark(store.parked, key, row)),
        opened: dropOpen(store.opened, rec.sessionId),
      });
    } catch (err) {
      console.error(`[reboot] not parking ${rec.sessionId.slice(0, 8)} — ${err.message.split('\n')[0]}`);
      note(planned, 'failed', `could not be parked — ${err.message.split('\n')[0]}`);
      continue;
    }
    parked.push(row);
    note(planned, 'parked', 'its advocate brings it back');
    console.log(
      `[reboot] ${rec.bead || rec.title || rec.sessionId.slice(0, 8)} was open when the Mac went down — parked for ` +
        'its advocate to bring back'
    );
  }

  /**
   * Each conversation goes back into **its own workspace's iTerm window** — bc-5to5r.6. One
   * window per workspace, each session a tab (bc-2uj4.16.2), and `openTab` files a window
   * with no workspace under the shared one; so a row that does not say which workspace it
   * is — a flush-only row, or a register row an older poll wrote — is resolved here from
   * its directory, by the rule the shell follows (`workspaceFor`). After the first real
   * reboot every hand-opened conversation came back as a tab of the beadcause window,
   * because the register rows said nothing and nothing here asked. The row is updated
   * before `note` so the report says where the window went, and the tab carries the name
   * the register knew the window by instead of `resumed <basename>`.
   */
  const opened = [];
  for (const row of plan.open) {
    row.workspace = row.workspace || workspaceFor(cfg, row.dir) || null;
    try {
      opened.push(
        await openWindow(cfg, { dir: row.dir, sessionId: row.sessionId, workspace: row.workspace, title: row.name || null })
      );
      note(row, 'reopened');
      console.log(`[reboot] brought back ${row.sessionId.slice(0, 8)} in ${row.dir}`);
    } catch (err) {
      note(row, 'failed', err.message.split('\n')[0]);
      console.error(
        `[reboot] could not bring back ${row.sessionId.slice(0, 8)} in ${row.dir} — ${err.message.split('\n')[0]}`
      );
    }
  }
  console.log(
    `[reboot] ${opened.length} window${opened.length === 1 ? '' : 's'} brought back` +
      (parked.length ? `, ${parked.length} parked for an advocate` : '')
  );
  writeReport();
  return { ran: true, fresh: true, opened, parked, skipped: [...merged.skipped, ...plan.skipped], report };
}
