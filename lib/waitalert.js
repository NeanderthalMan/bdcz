import { execFile } from 'node:child_process';
import { mayLaunch } from './launchguard.js';
import { focusSession, sessionReach } from './session.js';

/**
 * Tell Adam, at the Mac, that a window of his has stopped to wait for him.
 *
 * `parkIdle` in lib/advocate.js closes one of Adam's windows — a handoff above all —
 * once it has been quiet for `parkHandIdleMinutes`. That is his rule and it stays: he
 * resumes those by session id. What it left out is the half hour before the close. A
 * handoff successor that finished everything it could and stopped to ask for a decision
 * looked, from across the room, exactly like one still working; nothing said otherwise
 * until the window was gone. Measured on ehden/eh-oac, 2026-10-22: the successor went
 * quiet at 12:34 with three decisions outstanding, was parked at 13:04, and Adam went
 * looking for a window an hour later and found none.
 *
 * So when one of those windows has been idle for `afterMinutes`, this makes a noise
 * once: a macOS notification with a sound, and — if `focus` is on — the window brought
 * to the front, so the question it is waiting on is the thing on the screen. Once per
 * quiet spell: the key is the session id *and* the moment it went quiet, so a session
 * that is answered, works, and stops again is a new spell and alerts again, while one
 * that simply stays quiet does not ring every tick. `repeatMinutes` re-rings a spell
 * that is still waiting, for anybody who wants nagging; 0, the default, never does.
 *
 * Configurable as `advocates.waitAlert` — see `WAIT_ALERT_DEFAULTS`. Every field is
 * independent: `notify: false, focus: true` raises the window silently, `focus: false`
 * only rings, `enabled: false` is the old behaviour exactly.
 */

/**
 * Each value argued beside it, like `PARK_DEFAULTS` in lib/parked.js.
 */
export const WAIT_ALERT_DEFAULTS = Object.freeze({
  enabled: true,
  /**
   * Which kinds of window ring — the `kind` `launch` registered them under (see
   * `SESSION_KINDS` in lib/reap.js). Handoffs only by default: a worker that stops to
   * ask already files a `human` bead, which reaches the phone, and a chat is a window
   * Adam is usually sitting in. `["*"]` rings for every kind.
   */
  kinds: Object.freeze(['handoff']),
  /**
   * Quiet this long before it rings. Two minutes: long enough that the gap between two
   * turns, or a slow command, is not mistaken for a question; short enough that the
   * answer can come while the session still has its whole context warm.
   */
  afterMinutes: 2,
  /** A macOS notification, with `sound`. */
  notify: true,
  /** A name from /System/Library/Sounds (Glass, Ping, Submarine…), or "" for silence. */
  sound: 'Glass',
  /**
   * Bring the waiting window to the front. It takes the keyboard from whatever you were
   * typing into, which is the point and also the reason it can be turned off.
   */
  focus: true,
  /** Ring the same quiet spell again every this many minutes; 0 rings it once. */
  repeatMinutes: 0,
});

/** The effective settings: the defaults, overlaid by whatever `advocates.waitAlert` sets. */
export function waitAlertOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const D = WAIT_ALERT_DEFAULTS;
  return {
    enabled: o.enabled !== false,
    kinds: Array.isArray(o.kinds) ? o.kinds.map(String) : [...D.kinds],
    afterMinutes: num(o.afterMinutes, 0, 24 * 60, D.afterMinutes),
    notify: o.notify !== false,
    sound: typeof o.sound === 'string' ? o.sound : D.sound,
    focus: o.focus !== false,
    repeatMinutes: num(o.repeatMinutes, 0, 24 * 60, D.repeatMinutes),
  };
}

/**
 * Should this window ring now? A pure function of its arguments, so test/waitalert.mjs
 * can walk every branch with no Mac.
 *
 * `rec` is the open-register row (kind, bead, sessionId), `live` the Claude Code session
 * record (`status`, and `at` — when that status was written, which for `idle` is when it
 * went quiet), `rang` the record of the last ring for this session or undefined.
 * Answers `{ ring: true, spell }` — `spell` is what to store as `rang.spell` — or
 * `{ ring: false, why }`.
 */
export function waitAlertDecision(rec, live, rang, opts, now = new Date()) {
  if (!opts.enabled) return { ring: false, why: 'waitAlert is off' };
  if (!opts.notify && !opts.focus) return { ring: false, why: 'nothing to do — notify and focus are both off' };
  if (!opts.kinds.includes('*') && !opts.kinds.includes(rec?.kind)) {
    return { ring: false, why: `a ${rec?.kind || 'kindless'} window does not ring` };
  }
  if (!live || live.status !== 'idle') return { ring: false, why: 'it is not waiting' };
  const spell = String(live.at || '');
  const quietFor = (now.getTime() - Date.parse(spell)) / 60000;
  if (!Number.isFinite(quietFor)) return { ring: false, why: 'it has not said when it went quiet' };
  if (quietFor < opts.afterMinutes) return { ring: false, why: `quiet for ${Math.round(quietFor)}m of ${opts.afterMinutes}m` };
  if (rang && rang.spell === spell) {
    const since = (now.getTime() - Date.parse(rang.at || '')) / 60000;
    if (!(opts.repeatMinutes > 0) || !(since >= opts.repeatMinutes)) {
      return { ring: false, why: 'already rang for this quiet spell' };
    }
  }
  return { ring: true, spell };
}

/** What the notification says. */
export function waitAlertText(rec, title = '') {
  const what = rec?.bead || rec?.title || 'A session';
  const kind = rec?.kind === 'handoff' ? 'Handoff' : 'Session';
  return {
    title: `${kind} ${what} is waiting on you`,
    message: `${title || rec?.title || what} — it has stopped for a decision. Answer it before it is parked.`,
  };
}

// argv rather than string-building, so a bead title's quotes cannot break the script.
const NOTIFY_SCRIPT = [
  'on run argv',
  'if (item 3 of argv) is "" then',
  'display notification (item 2 of argv) with title (item 1 of argv)',
  'else',
  'display notification (item 2 of argv) with title (item 1 of argv) sound name (item 3 of argv)',
  'end if',
  'end run',
];

/** Post a macOS notification. Resolves true/false; never rejects — a ring is best-effort. */
export function notifyMac({ title, message, sound = '' }, { timeout = 5000 } = {}) {
  const args = NOTIFY_SCRIPT.flatMap((l) => ['-e', l]).concat([title, message, sound]);
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', args, { timeout }, (err) => resolve(!err));
  });
}

/**
 * The real ring: the notification, then the window. The default `ring` that
 * `createAdvocates` is handed, and refused inside a suite by `mayLaunch` exactly as a
 * window-opening door is — a test that ticked must not make Adam's Mac chime or steal his
 * keyboard. Resolves `{ notified, focused, why? }`; never rejects.
 */
export async function ringMac({ live, text, opts }) {
  if (!mayLaunch()) return { notified: false, focused: false, why: 'refused inside a suite' };
  const notified = opts.notify ? await notifyMac({ ...text, sound: opts.sound }) : false;
  let focused = false;
  let why;
  if (opts.focus && live?.pid) {
    try {
      const reach = await sessionReach(live.pid);
      if (reach?.can && reach.tty) focused = Boolean(await focusSession(reach.tty, { front: true }));
      else why = reach?.why || 'that window could not be reached';
    } catch (err) {
      why = err.message;
    }
  }
  return { notified, focused, why };
}
