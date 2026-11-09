import fs from 'node:fs';
import { CONFIG_PATH } from './config.js';
import { itermBackend } from './termbackend-iterm.js';
import { tmuxBackend } from './termbackend-tmux.js';

/**
 * The terminal-backend seam — one interface over whatever hosts agent windows (bc-obucr.1).
 *
 * Everything that opens, messages, finds or closes an agent window used to talk to iTerm
 * directly, from lib/session.js and lib/reap.js. Now it asks `terminal()` for a backend
 * and calls the backend: iTerm (lib/termbackend-iterm.js) on a Mac, tmux
 * (lib/termbackend-tmux.js, bc-obucr.2) on a headless Linux host. Each is one file
 * registered in `BACKENDS` below, with nothing above this seam knowing which is in use.
 *
 * **The interface**, as the callers actually use it. Required — a backend without one of
 * these cannot host a beadcause window at all:
 *
 *   - `open({ cfg, command, tabTitle, workspace })` → `{ err, stderr, term, window }`.
 *     Runs `command` (a short shell line) in a new window/tab for `workspace`. Never
 *     rejects on a terminal failure — `err` is returned for `blocked` to translate — but
 *     MUST call `assertMayLaunch` itself before reaching its terminal, so a suite can
 *     never get a window out of it (test/launchseam.mjs checks every backend file).
 *     `term` is the **handle**: opaque to every caller, stored in state as-is (an iTerm
 *     session id here, a tmux pane id there), and handed back to the methods below.
 *   - `message(handle, body)` → `'sent' | 'missing'`; rejects when the terminal refused.
 *   - `alive(handle)` → `true | false`; rejects when the terminal refused. Only a proven
 *     absence is `false` — a refusal must never free a slot.
 *   - `describe(handle, { timeout })` → `{ tty, name } | null`; rejects when it could not ask.
 *   - `close(handle, { timeout })` → `true` if the window/tab went.
 *   - `ttys()` → a `Set` of `/dev/…` paths the terminal is showing, or `null` on failure.
 *     The join `pid → tty → window` is how a session nobody here opened is reached.
 *   - `blocked(detail)` → an `Error` to throw instead of `detail`, or null. The terminal's
 *     own permission refusal, worded for a person (iTerm: the Automation checkbox).
 *   - `notHosting(tty)` → the sentence `sessionReach` shows for a tty it does not host.
 *
 * Optional capabilities — a headless host has none of them, and every caller checks
 * (`can`) rather than assuming:
 *
 *   - `focus(handle, { bounds, front })` → the bounds before the call, or null.
 *   - `layout()` → the screens and window rectangles, or null.
 *   - `sweepEmpty({ timeout })` → `{ closed, ids, stuck, error, refused }`; closes frames
 *     left with no session in them. A terminal that cannot leave an empty frame behind
 *     has nothing to sweep.
 *   - `tabWindows({ timeout })` → `[{ tty, window, workspace }]`, one per session: the
 *     window holding it and the workspace its tab was opened for (`''` if none). Rejects
 *     when it could not ask. lib/tabpark.js's Consolidate is the caller (bc-4olsx.3): it
 *     is how a tab already in its workspace's home window is told from one that is not.
 *   - `consolidate({ homeTty, ttys, workspace })` → `{ moved, missing }`, or
 *     `{ unavailable: why }` when the terminal cannot move tabs here. Moves the tabs
 *     holding `ttys` into the window holding `homeTty`, without interrupting them, and
 *     labels that window as `workspace`'s. iTerm does it through its Python API
 *     (bc-4olsx.3); without it, lib/tabpark.js parks and resumes instead.
 *
 * **Chosen in one place**: `cfg.terminalBackend` (`'iterm'` or `'tmux'`), else the
 * platform's default when that backend exists (tmux on Linux, iTerm on a Mac), else
 * iTerm. A named backend that
 * does not exist is an error rather than a quiet fallback, because a config that asked
 * for tmux and got osascript would fail somewhere much less legible.
 */

export const REQUIRED = Object.freeze(['open', 'message', 'alive', 'describe', 'close', 'ttys', 'blocked', 'notHosting']);
export const OPTIONAL = Object.freeze(['focus', 'layout', 'sweepEmpty', 'tabWindows', 'consolidate']);

/** Every backend this build has, by the name `cfg.terminalBackend` uses. */
export const BACKENDS = Object.freeze({ iterm: itermBackend, tmux: tmuxBackend });

/** What a platform gets when nothing is configured — if this build has that backend. */
export const PLATFORM_DEFAULT = Object.freeze({ darwin: 'iterm', linux: 'tmux' });

/** Does `backend` have the optional capability `cap`? */
export const can = (backend, cap) => typeof backend?.[cap] === 'function';

/** The methods `backend` is missing from `REQUIRED` — empty for a usable backend. */
export function missingMethods(backend) {
  return REQUIRED.filter((m) => !can(backend, m));
}

/**
 * The backend name for a config on a platform. Pure, so the selection rule is testable
 * without either.
 */
export function backendName(cfg = null, { platform = process.platform, backends = BACKENDS } = {}) {
  const asked = cfg && typeof cfg.terminalBackend === 'string' ? cfg.terminalBackend.trim() : '';
  if (asked) {
    if (!backends[asked]) {
      throw new Error(
        `terminalBackend "${asked}" is not a terminal this build can drive (it has: ${Object.keys(backends).join(', ')})`
      );
    }
    return asked;
  }
  const native = PLATFORM_DEFAULT[platform];
  return native && backends[native] ? native : 'iterm';
}

/**
 * The configured name, read once from the config file for callers that hold no `cfg` —
 * `messageSession(handle, text)` and its siblings, which are called from a dozen places
 * with nothing but a handle. Read raw rather than through `loadConfig`, which writes
 * migrations back to disk; a terminal lookup must not have side effects. A change takes
 * a daemon restart, as every other launch-time choice does.
 */
let configured;
function configuredCfg() {
  if (configured === undefined) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      configured = raw && typeof raw === 'object' ? { terminalBackend: raw.terminalBackend } : null;
    } catch {
      configured = null;
    }
  }
  return configured;
}

/**
 * The terminal backend to use. `cfg` when the caller has one (the launch doors do), the
 * config file otherwise.
 */
export function terminal(cfg = null) {
  const source = cfg && typeof cfg.terminalBackend === 'string' ? cfg : configuredCfg();
  return BACKENDS[backendName(source)];
}

/**
 * Close the frames left with no session in them, on a terminal that can leave one —
 * lib/advocate.js's tidy-up. A backend without the capability has nothing to sweep, which
 * is the same answer as a sweep that found nothing.
 */
export function sweepEmptyWindows(opts) {
  const t = terminal();
  if (!can(t, 'sweepEmpty')) return Promise.resolve({ closed: 0, ids: [], stuck: [], error: null });
  return t.sweepEmpty(opts);
}
