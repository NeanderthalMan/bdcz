import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The same gate that stands in front of opening a window, read for closing one. See
// `closeEmptyWindows`.
import { mayLaunch } from './launchguard.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAYOUT_SCRIPT = path.join(ROOT, 'scripts', 'iterm-layout.jxa');
const EMPTY_SCRIPT = path.join(ROOT, 'scripts', 'close-empty-windows.applescript');

/**
 * The terminal windows this daemon opens: a profile of their own, and a place to put them.
 *
 * A session window used to be whatever iTerm felt like making. It inherited the Default
 * profile, so a scrollback trimmed for a shell threw away the first half of an hour-long
 * agent session. Then every session got a window of its own, dealt onto one screen as a
 * grid of scattered cards (bc-gi8u), and a day of normal running left a desk of them with
 * nothing grouping them.
 *
 * So now:
 *
 *   - **A dynamic profile**, written to disk by this daemon and picked up by iTerm
 *     without a restart. It inherits from Default (see `PARENT`) so it still looks like
 *     your terminal, and overrides only what a session needs to differ on.
 *   - **One window per workspace, one tab per session** (bc-2uj4.16.2). The window is
 *     made on the configured screen the first time a workspace needs one, and after that
 *     it is Adam's to move. Which window is which workspace's is recorded by id in the
 *     daemon's state and re-checked by scripts/open-session.applescript before each use.
 *     `homeWindows` below is the record.
 *
 * Everything here except `ensureProfile` and `probe` is a pure function of numbers, and
 * that is deliberate: the screens cannot be exercised for real without a Mac with the
 * right monitors plugged into it, so the arithmetic is kept where a test can reach it
 * and the two functions that touch the world stay thin enough to read.
 */

/** What the profile is called in iTerm's profile list, and what AppleScript asks for. */
export const PROFILE_NAME = 'Beadcause';

/**
 * The profile's identity to iTerm, stable forever.
 *
 * Dynamic profiles are keyed by Guid, not by name and not by filename: change this and
 * iTerm does not update the profile, it grows a second one — and every window already
 * open on the old Guid keeps it. It is not a UUID because it does not have to be one,
 * and a readable string is worth something the day you go looking for it in iTerm's
 * preferences.
 */
export const PROFILE_GUID = 'beadcause-session-card';

/**
 * Inherit from Default rather than specifying a whole profile.
 *
 * The alternative is writing font, colours, cursor, shell and forty other keys into this
 * file, which would mean session windows stop looking like your terminal the moment you
 * change your terminal. With a parent, the only keys here are the ones a session
 * genuinely needs, and everything else follows Default on its own.
 */
const PARENT = 'Default';

/** The directory iTerm watches. Overridable so a test never writes into a real iTerm. */
export function profileDir() {
  return (
    process.env.BEADCAUSE_ITERM_PROFILE_DIR ||
    path.join(os.homedir(), 'Library', 'Application Support', 'iTerm2', 'DynamicProfiles')
  );
}

export function profilePath(dir = profileDir()) {
  return path.join(dir, 'beadcause.json');
}

/**
 * The session variable every tab beadcause opens carries its workspace in.
 *
 * scripts/open-session.applescript sets it on each new tab and reads it back to decide
 * whether a recorded window id is still the workspace's (iTerm reuses window ids), and
 * the profile's custom window title reads it. `user.` is iTerm's namespace for variables
 * a script defines; anything else is iTerm's own.
 */
export const WORKSPACE_VARIABLE = 'user.beadcauseWorkspace';

/**
 * The profile itself.
 *
 * `Screen` is iTerm's own display preference, and it is the whole of where a new window
 * goes: there are no bounds any more (bc-2uj4.16.2), so a workspace's window is born on
 * this screen at iTerm's own size and stays wherever Adam puts it after that. -1 is
 * iTerm's "no preference", which is the right answer for a Mac with one display.
 *
 * The rest is what a session needs and a shell does not:
 *
 *   - **Unlimited scrollback**, because the interesting part of an agent session is
 *     usually the part that has already scrolled past, and a session that ran for an
 *     hour under a 1000-line default has dropped the evidence you came for.
 *   - **No prompt before closing.** A session ends by closing its own tab; a
 *     confirmation sheet there is a dialog nobody is in the room to answer, and it
 *     leaves dead tabs behind for the sweep to trip over.
 *   - **Normal window type**, so a Default profile set to full screen or full-width
 *     cannot quietly take over a display with a workspace's window.
 *   - **A window title naming the workspace.** iTerm's `name` of a window is read-only
 *     to AppleScript, so the title is a template instead, read from the variable above.
 *     The path goes through `currentTab.currentSession` because a window title is
 *     evaluated in the window's scope: a bare `\(user.beadcauseWorkspace)` there renders
 *     empty (measured, iTerm 3.7.1). It follows whichever tab is in front, and every tab
 *     beadcause opened in the window carries the same workspace, so it reads the same
 *     whatever `claude` has renamed its own tab to. A tab Adam opens by hand has no
 *     variable, so the title is blank while that tab is in front.
 */
export function profileDocument({ columns = 96, rows = 30, screen = -1 } = {}) {
  return {
    Profiles: [
      {
        Name: PROFILE_NAME,
        Guid: PROFILE_GUID,
        'Dynamic Profile Parent Name': PARENT,
        Columns: columns,
        Rows: rows,
        Screen: screen,
        'Window Type': 0,
        'Unlimited Scrollback': true,
        'Prompt Before Closing 2': 0,
        'Use Custom Window Title': true,
        'Custom Window Title': `\\(currentTab.currentSession.${WORKSPACE_VARIABLE})`,
      },
    ],
  };
}

/**
 * Write the profile, but only when it is not already exactly this.
 *
 * iTerm watches the directory and reloads every profile on each write, so rewriting on
 * every session open would reload them a dozen times an hour for nothing. The comparison
 * is on the serialised document rather than on mtime, so a hand-edited file is repaired
 * and an unchanged one is left alone.
 *
 * Failure is returned, never thrown. A profile that could not be written costs the
 * windows their scrollback; a throw here would cost you the session, and the session is
 * the point — which is also why the AppleScript falls back to the default profile rather
 * than erroring when the profile is not there yet.
 */
export function ensureProfile(opts = {}, dir = profileDir()) {
  const file = profilePath(dir);
  const body = `${JSON.stringify(profileDocument(opts), null, 2)}\n`;
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === body) {
      return { name: PROFILE_NAME, path: file, written: false };
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, body);
    return { name: PROFILE_NAME, path: file, written: true };
  } catch (err) {
    return { name: null, path: file, written: false, error: err.message };
  }
}

/* ------------------------------------------------------------------ the screens */

/**
 * AppKit's coordinates, flipped into the ones iTerm's `bounds` speaks.
 *
 * NSScreen measures from the bottom left of the primary display with y growing upwards;
 * an iTerm window's `bounds` is measured from the *top* left with y growing down. So a
 * display stacked above the primary one has a positive y in AppKit and a negative top
 * here — and that is correct: a window on the monitor above this laptop really does live
 * at y = -2127.
 *
 * This is the one piece of arithmetic everything else depends on, which is why the probe
 * hands over raw AppKit numbers instead of doing it in JXA where nothing could test it.
 */
export function screenRects({ primaryHeight = 0, screens = [] } = {}) {
  return screens.map((s) => ({
    index: s.index,
    left: Math.round(s.x),
    top: Math.round(primaryHeight - (s.y + s.height)),
    width: Math.round(s.width),
    height: Math.round(s.height),
  }));
}

/**
 * Which display a workspace's new window is made on.
 *
 * `largest` by default: a window holding every session of a workspace wants the most
 * room there is, which on a laptop with nothing plugged in is the laptop, so one default
 * is right in both cases without being configured.
 *
 * A number is an index into the same order AppKit and iTerm use, so it agrees with the
 * `Screen` key in the profile. An index that no longer exists — a monitor unplugged
 * mid-week — falls back rather than failing: a window on the wrong screen is a nuisance,
 * a session that would not open is a problem.
 */
export function pickScreen(rects, choice = 'largest') {
  if (!rects.length) return null;
  const n = typeof choice === 'string' && /^\d+$/.test(choice) ? Number(choice) : choice;
  if (Number.isInteger(n)) return rects.find((r) => r.index === n) || rects[0];
  if (n === 'main') return rects.find((r) => r.index === 0) || rects[0];
  return rects.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
}

/** How a rectangle reaches AppleScript: four integers it can coerce and set as bounds. */
export const boundsArg = (rect) =>
  rect ? [rect.left, rect.top, rect.right, rect.bottom].map((n) => Math.round(n)).join(',') : '';

/**
 * …and back again: the same four integers, as the focus script prints them.
 *
 * `scripts/focus-session.applescript` returns the window's bounds *before* it changed
 * anything, and that string is the only record of where the window was — so a reading
 * that will not parse must be null rather than a rectangle of NaNs, which would be
 * saved as the thing to restore to and would move the window somewhere unreachable.
 */
export function parseBounds(text) {
  const parts = String(text || '')
    .trim()
    .split(',')
    .map((n) => Number(n.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [left, top, right, bottom] = parts.map(Math.round);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

/** Which measured screen a rectangle is on, by its centre. Null when nothing was measured. */
export function screenOf(rect, rects = []) {
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  return (
    rects.find(
      (s) => cx >= s.left && cx < s.left + s.width && cy >= s.top && cy < s.top + s.height
    ) || null
  );
}

/**
 * Twice as wide and twice as tall, about the same centre, kept on its screen.
 *
 * "Twice the size" is read as each edge doubled rather than the area doubled, which is
 * the reading that makes the window worth walking over to: a 780×540 window becomes
 * 1560×1080, which is most of a laptop display and a comfortable quarter of a 4K.
 *
 * **Clamped, not allowed to overflow.** A window doubled about its centre near an edge
 * would put half of itself past the screen, and the half that goes missing is as likely
 * to be the one with the prompt in it as not — a window you then have to drag back is
 * worse than one that grew a little less than asked. So the size is capped at the
 * screen, and the position is slid back inside it; a window already filling its screen
 * therefore does not move at all, which is the honest answer rather than a failure.
 *
 * **A null screen means nothing could be measured**, and then it does not grow about the
 * centre at all: it pins the top left corner and extends right and down. That is not a
 * lesser version of the same thing, it is the safe direction. Growing about the centre
 * without knowing where the screen edges are put a real window 368px off the left of a
 * real display the first time this ran — and the corner that goes missing that way is
 * the one with the window's controls on it, which is a window you cannot drag back.
 * Overflowing right and down is recoverable; overflowing up and left is not.
 */
export function magnify(rect, screen = null, factor = 2) {
  let width = Math.round(Math.max(1, rect.right - rect.left) * factor);
  let height = Math.round(Math.max(1, rect.bottom - rect.top) * factor);
  if (!screen) return { left: rect.left, top: rect.top, right: rect.left + width, bottom: rect.top + height };

  width = Math.min(width, screen.width);
  height = Math.min(height, screen.height);
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  const left = Math.min(Math.max(Math.round(cx - width / 2), screen.left), screen.left + screen.width - width);
  const top = Math.min(Math.max(Math.round(cy - height / 2), screen.top), screen.top + screen.height - height);
  return { left, top, right: left + width, bottom: top + height };
}

/** The whole decision, from a probe reading: where a window goes when it is made big. */
export function enlarged(rect, measured = null, factor = 2) {
  return magnify(rect, screenOf(rect, screenRects(measured || {})), factor);
}

/* -------------------------------------------------------------------- the probe */

/**
 * Ask the Mac where its displays are, and where iTerm's windows already are.
 *
 * Five seconds, which is generous for a call that measures ~150ms with a dozen windows
 * open, and never fatal: a probe that fails resolves to null and the window opens
 * without bounds, exactly as it did before any of this existed. The layout is a
 * courtesy; the session is not.
 */
export function probe({ timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', LAYOUT_SCRIPT], { timeout }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const parsed = JSON.parse(String(stdout || '').trim());
        resolve(parsed && Array.isArray(parsed.screens) ? parsed : null);
      } catch {
        return resolve(null);
      }
    });
  });
}

/* ------------------------------------------------------- the windows left behind */

/**
 * What `scripts/close-empty-windows.applescript` printed, read back.
 *
 * Its own function, and exported, because it is the only part of that sweep a test can
 * reach: the script itself needs a Mac with iTerm on it and windows in the exact state
 * this exists to clean up — a state that cannot be manufactured, since iTerm closes a
 * window with its last tab every time you ask it to (measured, on 3.6.11) and only
 * occasionally fails to on its own. So the boundary is where the testing stops: the
 * script is read by eye, and everything downstream of its output is arithmetic.
 *
 * Anything that is not a count followed by ids reads as zero rather than as an error.
 * A sweep that could not be understood closed nothing, and that is the same outcome for
 * the caller as a sweep that found nothing — the honest one, too, since the script only
 * ever prints after it has finished closing.
 *
 * Two lines now, not one, and the second is the whole of bc-xl7n.110. The first is what
 * it has always been — a count and the ids behind it — except that the script now verifies
 * each one is really gone before it goes in there. The optional second line, `stuck 47768
 * 47792`, names the windows that were asked to close and did not, which used to be counted
 * as successes and announced 2,330 times. `stuck` is empty when the line is absent, which
 * is the ordinary case.
 *
 * A garbled first line still voids the whole read, `stuck` included. One rule rather than
 * two: output this did not understand is a sweep whose result is unknown, and reporting
 * half of an unknown result as a finding is how the last version of this got believed.
 */
export function parseClosedWindows(stdout) {
  const lines = String(stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const head = lines.find((l) => !l.startsWith('stuck')) || '';
  const parts = head.split(/\s+/).filter(Boolean);
  const closed = Number(parts[0]);
  if (!Number.isInteger(closed) || closed < 0) return { closed: 0, ids: [], stuck: [] };
  const stuckLine = lines.find((l) => l.startsWith('stuck'));
  const stuck = stuckLine ? stuckLine.split(/\s+/).slice(1) : [];
  return { closed, ids: parts.slice(1, closed + 1), stuck };
}

/**
 * Which of this sweep's stuck windows have not been reported yet — and remember them.
 *
 * `reported` is the caller's Set and is updated in place; the return is the ids worth a
 * line. A window that will not close will be in *every* sweep from now until somebody
 * dismisses it by hand, and a line a tick is how a log stops being read — which is the
 * lesson bc-xl7n.110 is made of, since the 2,330 lines it was filed over were the same
 * handful of ids repeated. So each id is said once.
 *
 * An id is forgotten the moment it stops coming back, rather than kept for the life of the
 * daemon. iTerm reuses window ids freely, so a number that has gone quiet and returns is a
 * *different* frame, and it has never been reported: holding the id for ever would swallow
 * it. That is also what makes the memory bounded by what is on the desk now rather than by
 * how long the daemon has been up.
 */
export function unreportedStuck(reported, stuck = []) {
  const now = new Set(stuck);
  for (const id of reported) if (!now.has(id)) reported.delete(id);
  const fresh = stuck.filter((id) => !reported.has(id));
  for (const id of fresh) reported.add(id);
  return fresh;
}

/**
 * Close every iTerm window that has lost its last tab. See the script for what they are.
 *
 * Shaped like `probe` above and for the same reasons: five seconds, and never fatal. A
 * failure here is a blank window left on the desk for one more tick, which is exactly
 * where the daemon was before this existed — so the error is *returned* rather than
 * thrown, and the caller decides whether it is worth a line in the log.
 *
 * `closed`/`ids` are windows that were verified gone afterwards, and `stuck` names the ones
 * that took a close and stayed — see `parseClosedWindows`. A caller that logs `closed` is
 * logging an effect now rather than an attempt; a caller that logs `stuck` should do it
 * once per window and not once per tick, because the whole point of that list is that its
 * members do not change.
 *
 * Note what it does not take: a list of windows to close, or a window to spare. The
 * script asks iTerm and closes what it finds in the same Apple event, because the two
 * halves cannot be split without inventing a race that does not otherwise exist — a
 * window read as empty here and closed a second later is a window that could have been
 * given a tab in between (`create tab` targets `current window`, and bin/open-handoff
 * does exactly that). Inside one event there is no in between.
 */
export function closeEmptyWindows({ timeout = 5000 } = {}) {
  // A process that may not *open* a window on this Mac may not close one either, and
  // that is one rule rather than two: both are this daemon reaching out of its process
  // and moving something on somebody's desk. lib/launchguard.js already answers it, and
  // answers it for every suite at once — scripts/test.mjs sets `BEADCAUSE_NO_LAUNCH`, so
  // no test can drive iTerm here by forgetting to stub something. `refused` rather than
  // an error: nothing went wrong, and a caller that logged this would log it every tick.
  if (!mayLaunch()) return Promise.resolve({ closed: 0, ids: [], stuck: [], error: null, refused: true });
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', [EMPTY_SCRIPT], { timeout }, (err, stdout) => {
      if (err) return resolve({ closed: 0, ids: [], stuck: [], error: String(err.message || err).split('\n')[0] });
      resolve({ ...parseClosedWindows(stdout), error: null });
    });
  });
}

/* ------------------------------------------------------------ borrowing focus */

/** iTerm's bundle id, in the one place that has to compare against it. */
export const ITERM_BUNDLE_ID = 'com.googlecode.iterm2';

/**
 * Which app has the keyboard right now, as a bundle id.
 *
 * `lsappinfo`, not System Events. Asking System Events for the frontmost process is the
 * usual recipe and it needs an Automation grant — and this daemon runs under launchd,
 * where a TCC prompt may never be shown to anybody at all, so the usual recipe fails
 * invisibly and permanently on the one machine it has to work on. `lsappinfo` is a plain
 * command against the launch services database and needs nothing.
 *
 * Two calls because the first gives an ASN and only the second turns it into a bundle
 * id. Null on any failure, which the caller reads as "nothing to hand back to".
 */
export function frontmostApp({ timeout = 2000 } = {}) {
  return new Promise((resolve) => {
    execFile('/usr/bin/lsappinfo', ['front'], { timeout }, (err, stdout) => {
      const asn = String(stdout || '').trim();
      if (err || !asn) return resolve(null);
      execFile('/usr/bin/lsappinfo', ['info', '-only', 'bundleid', asn], { timeout }, (e2, out2) => {
        if (e2) return resolve(null);
        const m = String(out2 || '').match(/"CFBundleIdentifier"="([^"]+)"/);
        resolve(m ? m[1] : null);
      });
    });
  });
}

/**
 * Give the keyboard back to the app that had it.
 *
 * `open -b` rather than an `activate` of our own: the bundle id came from
 * `lsappinfo front` a second ago, so the app is running and this only raises it. Errors
 * are swallowed — this is the courtesy at the end of opening a session, and a session
 * that opened successfully must not be reported as failed because the app that had focus
 * quit while it was starting.
 */
export function restoreApp(bundleId, { timeout = 3000 } = {}) {
  if (!bundleId || bundleId === ITERM_BUNDLE_ID) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-b', bundleId], { timeout }, (err) => resolve(!err));
  });
}

/** The screen the profile should name before anything has been measured. */
function configuredScreen(settings) {
  const choice = settings.screen;
  if (Number.isInteger(choice)) return choice;
  if (typeof choice === 'string' && /^\d+$/.test(choice)) return Number(choice);
  return -1;
}

/**
 * The profile a session opens with, written for the screen a new window should go on.
 *
 * What this used to be was `placement`, which also dealt the window a rectangle on a
 * card table (bc-gi8u). That half is gone with the table (bc-2uj4.16.2): a session is a
 * tab in its workspace's window now, and the only geometry left is which display a new
 * window is born on — the profile's `Screen`.
 *
 * A configured index needs no measuring, so it costs nothing. `largest` and `main` need
 * the probe (~150ms) to be turned into an index; a probe that fails costs the preference,
 * never the session — the profile then says -1 and iTerm picks.
 */
export async function sessionProfile(settings = {}) {
  const configured = configuredScreen(settings);
  // On a machine that has never had the profile, write it before the probe rather than
  // after: those ~150ms are time in which iTerm can notice the new file, which is the
  // difference between the *first* session of a new install opening on the profile and
  // falling back to Default.
  if (!fs.existsSync(profilePath())) ensureProfile({ screen: configured });
  let screen = configured;
  if (screen < 0) {
    const target = pickScreen(screenRects((await probe()) || {}), settings.screen ?? 'largest');
    if (target) screen = target.index;
  }
  const profile = ensureProfile({ screen });
  return { profile: profile.name || '', screen };
}

/* ------------------------------------------------------ one window per workspace */

/**
 * What a session with no workspace is filed under. A resumed conversation from before a
 * reboot may have none; it still gets a window to share rather than one of its own.
 */
export const NO_WORKSPACE = 'beadcause';

/** The key a workspace's window is recorded under, and the label its tabs carry. */
export const homeKey = (workspace) => String(workspace || '').trim() || NO_WORKSPACE;

/**
 * The window id recorded for a workspace, as the string the AppleScript takes: `''` when
 * there is none, or when what is recorded is not a window id at all. The script checks
 * that the window still exists and is still this workspace's before it uses it, so a stale
 * id costs a new window, never a tab in somebody else's.
 */
export function homeWindowOf(record, workspace) {
  const id = record && typeof record === 'object' ? record[homeKey(workspace)] : null;
  return Number.isInteger(id) && id > 0 ? String(id) : '';
}

/** `record` with the workspace's window set to `windowId`. A new object; nothing mutated. */
export function recordHome(record, workspace, windowId) {
  const base = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
  const id = Number(windowId);
  if (!Number.isInteger(id) || id <= 0) return base;
  return { ...base, [homeKey(workspace)]: id };
}

/**
 * What scripts/open-session.applescript printed: the new session's id, then the id of the
 * window it went into. Either may be absent — an older script printed only the session,
 * and a stub in a test prints whatever it likes — and each is then null rather than a
 * guess.
 */
export function parseOpened(stdout) {
  const [term = '', win = ''] = String(stdout || '').trim().split(/\s+/);
  return { term: term || null, window: /^\d+$/.test(win) ? Number(win) : null };
}

/**
 * Run `fn` only after every earlier call for the same key has settled.
 *
 * Two sessions for one workspace opened in the same tick would otherwise both find no
 * window recorded, and both make one — two windows for one workspace, which is the thing
 * this whole arrangement exists to stop. The window id is recorded when the first open
 * returns, so the second, waiting its turn, finds it. A failure is passed to its own
 * caller and does not stop the queue behind it.
 */
const turns = new Map();
export function inTurn(key, fn) {
  const prior = turns.get(key) || Promise.resolve();
  const run = prior.then(() => fn());
  const settled = run.then(
    () => undefined,
    () => undefined
  );
  turns.set(key, settled);
  settled.then(() => {
    if (turns.get(key) === settled) turns.delete(key);
  });
  return run;
}
