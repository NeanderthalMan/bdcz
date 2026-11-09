import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  sessionProfile,
  frontmostApp,
  restoreApp,
  focusMode,
  boundsArg,
  parseBounds,
  homeKey,
  homeWindowOf,
  recordHome,
  parseOpened,
  inTurn,
  probe,
  closeEmptyWindows,
} from './iterm.js';
// The same gate lib/session.js asks before it reaches here. Asked again at the open
// script itself — see `open` — because this is now the function that reaches osascript.
import { assertMayLaunch, mayLaunch } from './launchguard.js';
import { loadState, saveState } from './config.js';

/**
 * The iTerm terminal backend — every Apple event that opens, speaks to, reads or closes an
 * agent window, behind the interface lib/termbackend.js describes (bc-obucr.1).
 *
 * **Moved, not rewritten.** Each method below is the body that used to sit in
 * lib/session.js (`openTab`, `messageSession`, `focusSession`, `sessionAlive`,
 * `itermTtys`) or lib/reap.js (`describeSession`, `closeTabByTerm`), with the same
 * osascript argv, the same timeouts and the same state keys (`itermWindows`). The bar for
 * this file is that iTerm cannot tell the refactor happened. What changed is only *where*
 * the calls live: the callers ask `terminal()` for a backend and never name iTerm, so a
 * second backend (tmux, bc-obucr.2) is one new file rather than a rewrite of session.js.
 *
 * The handle every method takes is opaque to its callers: here it is the iTerm session id
 * `open-session.applescript` printed, or a `/dev/ttysNNN` path from `sessionReach`, which
 * the scripts match either way. Callers store it and hand it back; they never parse it.
 *
 * Scripts resolve off this file's own location, as they did off lib/session.js's — which
 * is what test/tiermodel.mjs relies on when it copies `lib/` beside a stub
 * `scripts/open-session.applescript`.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'open-session.applescript');
const MESSAGE_SCRIPT = path.join(ROOT, 'scripts', 'message-session.applescript');
const TTY_SCRIPT = path.join(ROOT, 'scripts', 'iterm-ttys.applescript');
const FOCUS_SCRIPT = path.join(ROOT, 'scripts', 'focus-session.applescript');
const DESCRIBE_SCRIPT = path.join(ROOT, 'scripts', 'describe-session.applescript');
const CLOSE_TAB_SCRIPT = path.join(ROOT, 'scripts', 'close-tab.applescript');
const TAB_WINDOWS_SCRIPT = path.join(ROOT, 'scripts', 'iterm-tab-windows.applescript');
const CONSOLIDATE_SCRIPT = path.join(ROOT, 'scripts', 'iterm-consolidate.py');
/** The per-machine venv docs/install.md sets up for the iTerm2 Python API. Gitignored. */
const API_VENV_PYTHON = path.join(ROOT, '.venv-iterm', 'bin', 'python3');

/**
 * macOS refusing the Apple event, said once for every script that can hit it.
 *
 * -1743 is the refusal, and it is the one `osascript` failure worth translating: this
 * daemon runs under launchd, where a TCC prompt may never be shown to anybody at all,
 * so the error a person sees has to name the checkbox rather than the error code. Null
 * when the failure was something else, which the caller reports as itself.
 */
export function itermBlocked(detail) {
  if (!/-1743|not authori[sz]ed|Not authorized to send Apple events/i.test(detail)) return null;
  return Object.assign(
    new Error(
      'macOS blocked beadcause from controlling iTerm. Approve it once in ' +
        'System Settings → Privacy & Security → Automation, then try again.'
    ),
    { status: 403 }
  );
}

/**
 * Hand iTerm a command to run as a new tab in the workspace's window. See `openTab` in
 * lib/session.js for the whole account of the window record and the borrowed focus; this
 * is its body, unchanged.
 *
 * Never rejects on an osascript failure: `err` is returned for the caller to translate
 * (through `blocked`). It *does* throw when the launch guard refuses — and it asks the
 * guard itself, because this is the function that reaches `osascript`, and
 * test/launchseam.mjs checks that the guard sits in the same function as every call to
 * the open script.
 */
function open({ cfg, command, tabTitle, workspace }) {
  assertMayLaunch(tabTitle, '');
  const key = homeKey(workspace);
  return inTurn(key, async () => {
    const windows = cfg.sessionWindows || {};
    const { profile } = await sessionProfile(windows);
    const takeFocus = windows.stealFocus === true;
    // Asked *before* the tab exists, because a moment later the answer is iTerm.
    const prior = takeFocus ? null : await frontmostApp();
    let home = '';
    try {
      home = homeWindowOf(loadState().itermWindows, key);
    } catch {
      home = '';
    }
    const { err, stdout, stderr } = await new Promise((resolve) => {
      const args = [SCRIPT, command, tabTitle, profile, home, focusMode(takeFocus, prior), key];
      execFile('/usr/bin/osascript', args, { timeout: 20000 }, (e, out, errOut) =>
        resolve({ err: e, stdout: out, stderr: errOut })
      );
    });
    if (prior) restoreApp(prior);
    if (err) return { err, stderr, term: null, window: null };
    // `term` is the iTerm session id the script printed: the handle `messageSession`
    // needs to talk to this tab later. Null rather than absent on an iTerm that returns
    // nothing — the caller must treat "no handle" as a state.
    const { term, window } = parseOpened(stdout);
    if (window && String(window) !== home) {
      // Wrapped for the reason the `opened` register is: a state file that will not write
      // costs the next session a new window, not this one its launch.
      try {
        saveState({ itermWindows: recordHome(loadState().itermWindows, key, window) });
      } catch (e) {
        console.error(`[beadcause] could not record ${key}'s iTerm window: ${e.message}`);
      }
    }
    return { err: null, stderr, term, window };
  });
}

/**
 * Type `body` into the session `handle` names. `'sent'` or `'missing'`; rejects on a
 * refusal, which must never read as `missing`. `body` is already `pasteSafe` — see
 * `messageSession` in lib/session.js for the contract.
 */
function message(handle, body) {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      [MESSAGE_SCRIPT, String(handle), body],
      { timeout: 20000 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = `${stderr || ''}${err.message}`;
          const blocked = itermBlocked(detail);
          if (blocked) return reject(blocked);
          return reject(new Error(detail.split('\n')[0] || 'could not reach that session'));
        }
        resolve(String(stdout || '').trim() === 'missing' ? 'missing' : 'sent');
      }
    );
  });
}

/**
 * Raise and/or resize the window `handle` is in, resolving the bounds it had *before*
 * this call — or null when nothing carries the handle. See `focusSession`.
 */
function focus(handle, { bounds = null, front = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      [FOCUS_SCRIPT, String(handle), boundsArg(bounds), front ? 'front' : 'quiet'],
      { timeout: 20000 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = `${stderr || ''}${err.message}`;
          const blocked = itermBlocked(detail);
          if (blocked) return reject(blocked);
          return reject(new Error(detail.split('\n')[0] || 'could not reach that session'));
        }
        // `missing` and an unparseable reading end the same way, and must: both mean
        // there is no rectangle to put back, and inventing one would move the window.
        resolve(parseBounds(String(stdout || '').trim()));
      }
    );
  });
}

/**
 * Is that window still there? The focus script in the mode that touches nothing — no
 * bounds, `quiet` — so it is a pure reading. `true`, `false` (proven gone), or a
 * rejection when macOS will not talk to iTerm. See `sessionAlive` in lib/session.js.
 */
function alive(handle) {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      [FOCUS_SCRIPT, String(handle), '', 'quiet'],
      { timeout: 20000 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = `${stderr || ''}${err.message}`;
          const blocked = itermBlocked(detail);
          if (blocked) return reject(blocked);
          return reject(new Error(detail.split('\n')[0] || 'could not reach that session'));
        }
        resolve(String(stdout || '').trim() !== 'missing');
      }
    );
  });
}

/**
 * Every terminal iTerm is hosting, as a Set of `/dev/ttysNNN` paths — or null when the
 * probe failed (a TCC refusal, a timeout). One uncached probe; the cache that makes it
 * affordable to poll is the caller's (`hostedTtys` in lib/session.js), because it is the
 * same cache whichever terminal answers.
 */
function ttys() {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', [TTY_SCRIPT], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(
        new Set(
          String(stdout || '')
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        )
      );
    });
  });
}

/** What `sessionReach` says about a session whose tty this terminal is not showing. */
const notHosting = (tty) => `Its terminal (${tty}) is not an iTerm window — it may be in Terminal.app, tmux, or over ssh.`;

/** What `describe-session.applescript` printed, read back. `null` for `missing`. */
export function parseDescribed(stdout) {
  const text = String(stdout || '').trim();
  if (!text || text === 'missing') return null;
  const nl = text.indexOf('\n');
  if (nl < 0) return null;
  return { tty: text.slice(0, nl).trim() || null, name: text.slice(nl + 1) };
}

/**
 * What iTerm knows about a handle right now — `{ tty, name }`, or `null` when nothing
 * carries it. Rejects on a real failure to ask (a TCC refusal, `osascript` timing out),
 * which the caller must not read as `null`: "could not ask" and "the answer is nothing"
 * are different facts, and only the second one means the window is gone.
 */
function describe(term, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', [DESCRIBE_SCRIPT, String(term)], { timeout }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${stderr || ''}${err.message}`.split('\n')[0] || 'could not describe that session'));
      resolve(parseDescribed(stdout));
    });
  });
}

/**
 * Ask iTerm to close the tab for this handle. `true` if it did.
 *
 * The tab, not the window: since bc-2uj4.16.2 a window holds every session of its
 * workspace, and closing it would end the siblings too. scripts/close-tab.applescript.
 */
function close(term, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', [CLOSE_TAB_SCRIPT, String(term)], { timeout }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${stderr || ''}${err.message}`.split('\n')[0] || 'could not close that tab'));
      resolve(String(stdout || '').trim() === 'closed');
    });
  });
}

/**
 * What `iterm-tab-windows.applescript` printed, read back: one `{ tty, window, workspace }`
 * per session. `window` is a number or null; `workspace` is `''` for a tab nobody here
 * opened. A line without a tty is dropped — it names nothing a pid could be joined to.
 */
export function parseTabWindows(stdout) {
  const rows = [];
  for (const line of String(stdout || '').split('\n')) {
    const [tty = '', win = '', workspace = ''] = line.replace(/\r$/, '').split('\t');
    if (!tty.trim()) continue;
    rows.push({
      tty: tty.trim(),
      window: /^\d+$/.test(win.trim()) ? Number(win.trim()) : null,
      workspace: workspace.trim(),
    });
  }
  return rows;
}

/**
 * Which window every session is in — the optional `tabWindows` capability (bc-4olsx.3).
 *
 * Rejects rather than resolving null on a failure, unlike `ttys`: its one caller
 * (lib/tabpark.js's Consolidate) is about to close tabs on the strength of the answer, so
 * "could not ask" must stop it, and a TCC refusal must arrive as the Automation sentence.
 */
function tabWindows({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', [TAB_WINDOWS_SCRIPT], { timeout }, (err, stdout, stderr) => {
      if (err) {
        const detail = `${stderr || ''}${err.message}`;
        return reject(itermBlocked(detail) || new Error(detail.split('\n')[0] || 'could not ask iTerm where its tabs are'));
      }
      resolve(parseTabWindows(stdout));
    });
  });
}

/**
 * The interpreter that has the `iterm2` package: the repo's own `.venv-iterm` when it
 * exists (docs/install.md), else whatever `python3` the daemon's PATH finds — which on a
 * stock Mac does not have it, and the helper then says so with exit 3.
 */
export const apiPython = (exists = fs.existsSync) => (exists(API_VENV_PYTHON) ? API_VENV_PYTHON : 'python3');

/** `request cookie and key` printed `<cookie> <key>`. Null for anything else. */
export function parseCookie(stdout) {
  const [cookie = '', key = ''] = String(stdout || '').trim().split(/\s+/);
  return cookie && key ? { cookie, key } : null;
}

/**
 * Move the tabs holding `ttys` into the window holding `homeTty`, for real — the optional
 * `consolidate` capability (bc-4olsx.3), through iTerm2's Python API
 * (scripts/iterm-consolidate.py), because AppleScript cannot move a tab at all.
 *
 * Resolves `{ moved, missing }` when it ran, or `{ unavailable: <why> }` when the API
 * cannot be used here — no `iterm2` package, the API server switched off, no cookie —
 * which lib/tabpark.js answers by falling back to park + resume and saying why. Rejects
 * only on a TCC refusal, translated, since that is a checkbox Adam can tick.
 *
 * Authentication is the cookie dance an external script needs: AppleScript's `request
 * cookie and key for app named "beadcause"` (beadcause already holds Automation
 * permission for iTerm), handed to the helper as ITERM2_COOKIE / ITERM2_KEY. A process
 * iTerm itself launched would get them for free; the daemon is not one.
 *
 * Under a test run this answers `unavailable` without reaching osascript at all: it
 * moves real windows, and a suite must never — the same rule `assertMayLaunch` keeps for
 * `open`, said as a fallback rather than a throw because nothing here is a launch.
 */
function consolidate({ homeTty, ttys = [], workspace = '', timeout = 30000 } = {}) {
  if (!mayLaunch()) return Promise.resolve({ unavailable: 'refused under a test run' });
  const run = (file, args, opts) =>
    new Promise((resolve) => execFile(file, args, opts, (err, stdout, stderr) => resolve({ err, stdout, stderr })));
  return (async () => {
    const asked = await run(
      '/usr/bin/osascript',
      ['-e', 'tell application id "com.googlecode.iterm2" to request cookie and key for app named "beadcause"'],
      { timeout: 10000 }
    );
    if (asked.err) {
      const detail = `${asked.stderr || ''}${asked.err.message}`;
      const blocked = itermBlocked(detail);
      if (blocked) throw blocked;
      return { unavailable: `iTerm would not hand out an API cookie (${detail.split('\n')[0]}) — is its Python API enabled?` };
    }
    const auth = parseCookie(asked.stdout);
    if (!auth) return { unavailable: 'iTerm answered the cookie request with nothing usable' };
    const out = await run(apiPython(), [CONSOLIDATE_SCRIPT, String(homeTty), String(workspace), ...ttys.map(String)], {
      timeout,
      env: { ...process.env, ITERM2_COOKIE: auth.cookie, ITERM2_KEY: auth.key },
    });
    let said = null;
    try {
      said = JSON.parse(String(out.stdout || '').trim().split('\n').pop());
    } catch {
      said = null;
    }
    if (out.err || !said || said.error) {
      const why = said?.error || `${out.stderr || ''}${out.err?.message || 'no answer'}`.split('\n')[0];
      return { unavailable: why };
    }
    return { moved: Array.isArray(said.moved) ? said.moved : [], missing: Array.isArray(said.missing) ? said.missing : [] };
  })();
}

/**
 * The backend. The required half is what every terminal must do; `focus`, `layout`,
 * `sweepEmpty`, `tabWindows` and `consolidate` are the optional capabilities
 * lib/termbackend.js names — iTerm has all five, a headless tmux host has none of them.
 */
export const itermBackend = Object.freeze({
  name: 'iterm',
  open,
  message,
  alive,
  ttys,
  describe,
  close,
  blocked: itermBlocked,
  notHosting,
  focus,
  layout: probe,
  sweepEmpty: closeEmptyWindows,
  tabWindows,
  consolidate,
});
