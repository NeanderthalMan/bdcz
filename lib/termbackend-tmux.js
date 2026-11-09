import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { CONFIG_PATH } from './config.js';
// The same gate lib/session.js asks before it reaches here — asked again in `open`
// itself, because this is the function that reaches tmux (test/launchseam.mjs and
// test/termbackendtmux.mjs both hold it there).
import { assertMayLaunch } from './launchguard.js';

/**
 * The tmux terminal backend — agent windows on a headless host (bc-obucr.2).
 *
 * The same interface lib/termbackend.js describes and lib/termbackend-iterm.js
 * implements, over a tmux server instead of Apple events:
 *
 *   - **one tmux session per workspace** (`bc-<workspace>`), the analogue of iTerm's
 *     per-workspace home window, and **one tmux window per agent** in it;
 *   - **the handle is the pane id** (`%N`), which tmux never reuses for the life of the
 *     server and which is exactly as opaque to the callers as an iTerm session id. A
 *     `/dev/pts/N` path from `sessionReach` is accepted too, and resolved to its pane
 *     here — the same either-form contract the iTerm scripts honour;
 *   - **the title is the window name**, set at birth with automatic and escape-sequence
 *     renaming turned off for that window, so the bead id in it survives whatever
 *     `claude` writes to the terminal title. That name is what `describe` reads back and
 *     what lib/reap.js's `namesBead` matches — a window that stopped naming its bead is
 *     one the reaper leaves alone.
 *
 * **Which server.** The default tmux server unless one is named, so that `tmux attach` on
 * the host shows the agents and a `claude` Adam started by hand in his own tmux is
 * reachable through `ttys`. `BEADCAUSE_TMUX_SOCKET` (what the suite uses, so it never
 * touches the real server) wins over `tmuxSocket` in config.json; a value with a `/` in it
 * is a socket path (`tmux -S`), anything else a socket name (`tmux -L`).
 *
 * **What it cannot do**, and says so by not having the method: `focus`, `layout` and
 * `sweepEmpty`. There is no screen to raise a window on, and a tmux window ends with its
 * last pane, so there is never an empty frame to sweep.
 *
 * **Absence versus refusal.** tmux answering "can't find pane" or "no server running" is
 * a proven absence — the window is gone — and is `missing` / `false` / `null`. Anything
 * else (tmux not installed, a timeout, a socket we may not open) is a rejection, because
 * the interface's one hard rule is that "could not ask" must never free a slot.
 */

const TMUX = 'tmux';
const SESSION_PREFIX = 'bc-';

let configuredSocket;
/** The socket to address, read once — env first, then config.json raw (no migrations). */
export function tmuxSocket() {
  const env = process.env.BEADCAUSE_TMUX_SOCKET;
  if (typeof env === 'string' && env.trim()) return env.trim();
  if (configuredSocket === undefined) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      configuredSocket = raw && typeof raw.tmuxSocket === 'string' && raw.tmuxSocket.trim() ? raw.tmuxSocket.trim() : null;
    } catch {
      configuredSocket = null;
    }
  }
  return configuredSocket;
}

/** `-L name` / `-S path` / nothing, for a socket value. Pure. */
export function socketArgs(socket = tmuxSocket()) {
  if (!socket) return [];
  return socket.includes('/') ? ['-S', socket] : ['-L', socket];
}

/**
 * The tmux session a workspace's agents live in. tmux reserves `.` and `:` in target
 * names (window and pane separators), so everything outside a safe set becomes `_`.
 */
export function sessionName(workspace) {
  const ws = String(workspace || 'default').replace(/[^A-Za-z0-9_-]/g, '_') || 'default';
  return `${SESSION_PREFIX}${ws}`;
}

/** Did tmux say the thing asked about does not exist? That is an answer, not a failure. */
export function isAbsence(detail) {
  return /can't find (pane|window|session)|no server running|error connecting to|no current (client|session)|session not found|window not found|pane not found/i.test(
    String(detail || '')
  );
}

/**
 * tmux has no permission prompt to translate; the failure a person needs worded is tmux
 * not being there at all. Null for anything else, which the caller reports as itself.
 */
export function tmuxBlocked(detail) {
  if (!/\bENOENT\b|spawn tmux|tmux: (command )?not found/i.test(String(detail || ''))) return null;
  return Object.assign(
    new Error('beadcause is set to open agent windows in tmux, and tmux is not installed on this host (apt install tmux).'),
    { status: 503 }
  );
}

/**
 * Run tmux. Resolves `{ err, stdout, stderr }` and never rejects — each method decides
 * what a failure means for it. `input`, when given, is written to tmux's stdin.
 *
 * Always `-u`. Without it tmux decides from LANG/LC_* whether the client speaks UTF-8,
 * and under the C locale — a daemon started by launchd or systemd, or the test gate — it
 * prints every byte it calls unprintable as `_`: the `▶` in a bead's window name, and the
 * tab `describe` and `resolvePane` split their output on. So `describe` answered null for
 * every live pane there (bc-tdes6), which reads as the window being gone.
 */
function run(args, { input = null, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(TMUX, ['-u', ...socketArgs(), ...args], { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })
    );
    // A spawn failure (ENOENT) can close stdin before we write; that is reported through
    // `err` above, so an EPIPE here is not a second error.
    child.stdin?.on('error', () => {});
    if (input !== null) child.stdin?.end(input);
    else child.stdin?.end();
  });
}

const detailOf = ({ err, stderr }) => `${stderr || ''}${err ? err.message : ''}`;
const refusal = (res, fallback) => {
  const detail = detailOf(res);
  return tmuxBlocked(detail) || new Error(detail.split('\n').find(Boolean) || fallback);
};

/**
 * The pane a handle names, as `%N` — or null when nothing carries it. A pane id is checked
 * by asking for it; a tty is looked up in every pane on the server. Rejects when tmux could
 * not be asked.
 */
async function resolvePane(handle) {
  const h = String(handle || '').trim();
  if (!h) return null;
  if (h.startsWith('/dev/')) {
    const res = await run(['list-panes', '-a', '-F', '#{pane_tty}\t#{pane_id}']);
    if (res.err) {
      if (isAbsence(detailOf(res))) return null;
      throw refusal(res, 'could not list tmux panes');
    }
    for (const line of res.stdout.split('\n')) {
      const [tty, id] = line.split('\t');
      if (tty === h && id) return id.trim();
    }
    return null;
  }
  const res = await run(['display-message', '-p', '-t', h, '#{pane_id}']);
  if (res.err) {
    if (isAbsence(detailOf(res))) return null;
    throw refusal(res, 'could not reach that pane');
  }
  const id = res.stdout.trim();
  // `display -t` of a target tmux can resolve loosely (a window name, say) answers with
  // *some* pane; only the exact one we were given counts as still being there.
  return id && (!h.startsWith('%') || id === h) ? id : null;
}

/** What `open`'s `-P -F` printed: `%pane @window`. */
export function parseOpened(stdout) {
  const [term, window] = String(stdout || '').trim().split(/\s+/);
  return { term: term && term.startsWith('%') ? term : null, window: window && window.startsWith('@') ? window : null };
}

/**
 * One open at a time per workspace, for the reason lib/iterm.js's `inTurn` gives: two
 * opens in the same tick would both find no session and both try to create it.
 */
const turns = new Map();
function inTurn(key, fn) {
  const prev = turns.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.catch(() => {});
  turns.set(key, settled);
  settled.then(() => {
    if (turns.get(key) === settled) turns.delete(key);
  });
  return next;
}

/** The window options that keep a title naming its bead for the window's whole life. */
const PIN_TITLE = [
  ['automatic-rename', 'off'],
  ['allow-rename', 'off'],
];

/**
 * Run `command` in a new tmux window named `tabTitle`, in the workspace's session —
 * creating the session (detached) when it is not there yet. `{ err, stderr, term, window }`
 * and never rejects on a tmux failure, as the interface asks; it throws only when the
 * launch guard refuses, which it asks before anything reaches tmux.
 */
function open({ command, tabTitle, workspace }) {
  assertMayLaunch(tabTitle, '');
  const session = sessionName(workspace);
  return inTurn(session, async () => {
    const exact = `=${session}`;
    const has = await run(['has-session', '-t', exact]);
    const title = String(tabTitle || '');
    const format = '#{pane_id} #{window_id}';
    let res;
    if (has.err && !isAbsence(detailOf(has))) {
      // Not "no such session" but tmux itself failing — report it as the open's failure.
      return { err: has.err, stderr: has.stderr, term: null, window: null };
    }
    if (has.err) {
      // A detached session is 80×24 unless told otherwise; an agent's TUI wants room.
      res = await run(['new-session', '-d', '-x', '220', '-y', '50', '-s', session, '-n', title, '-P', '-F', format, command]);
      if (res.err && /duplicate session/i.test(detailOf(res))) res = null; // made by someone else meanwhile
    }
    if (!res) res = await run(['new-window', '-d', '-t', `${exact}:`, '-n', title, '-P', '-F', format, command]);
    if (res.err) return { err: res.err, stderr: res.stderr, term: null, window: null };
    const { term, window } = parseOpened(res.stdout);
    if (window) {
      // Best-effort: a window that has already exited (a command that failed at once) has
      // nothing left to pin, and that is not this open's failure.
      for (const [opt, val] of PIN_TITLE) await run(['set-option', '-w', '-t', window, opt, val]);
      // The command has been running since `new-window` returned, so it may already have
      // retitled the window before the options above took hold. Say the name once more.
      await run(['rename-window', '-t', window, title]);
    }
    return { err: null, stderr: res.stderr, term, window };
  });
}

/**
 * Type `body` into the pane. Through a tmux paste buffer rather than `send-keys -l`,
 * because a brief-sized message would not fit in one tmux command, and `paste-buffer -p`
 * sends it as a bracketed paste when the program asked for one — which is what
 * `pasteSafe` and Claude Code's multi-line input both assume. Then one Enter.
 */
async function message(handle, body) {
  const pane = await resolvePane(handle);
  if (!pane) return 'missing';
  const buffer = `beadcause-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const load = await run(['load-buffer', '-b', buffer, '-'], { input: String(body), timeout: 20000 });
  if (load.err) {
    if (isAbsence(detailOf(load))) return 'missing';
    throw refusal(load, 'could not reach that session');
  }
  const paste = await run(['paste-buffer', '-d', '-p', '-b', buffer, '-t', pane], { timeout: 20000 });
  if (paste.err) {
    await run(['delete-buffer', '-b', buffer]);
    if (isAbsence(detailOf(paste))) return 'missing';
    throw refusal(paste, 'could not reach that session');
  }
  const enter = await run(['send-keys', '-t', pane, 'Enter'], { timeout: 20000 });
  if (enter.err) {
    if (isAbsence(detailOf(enter))) return 'missing';
    throw refusal(enter, 'could not reach that session');
  }
  return 'sent';
}

/** Is that pane still there? Only tmux saying it is not is `false`. */
async function alive(handle) {
  return (await resolvePane(handle)) !== null;
}

/**
 * Every tty this tmux server is showing, as a Set — empty when no server is running (as
 * iTerm not running is), null when tmux could not be asked.
 */
async function ttys() {
  const res = await run(['list-panes', '-a', '-F', '#{pane_tty}'], { timeout: 15000 });
  if (res.err) return isAbsence(detailOf(res)) ? new Set() : null;
  return new Set(
    res.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/** What `sessionReach` says about a session whose tty this server is not showing. */
const notHosting = (tty) =>
  `Its terminal (${tty}) is not a pane on beadcause's tmux server — it may be in another tmux server, another terminal, or over ssh.`;

/** `display -p` of `#{pane_tty}\t#{window_name}`, read back. Null for nothing. */
export function parseDescribed(stdout) {
  const text = String(stdout || '').replace(/\n+$/, '');
  if (!text) return null;
  const tab = text.indexOf('\t');
  if (tab < 0) return null;
  return { tty: text.slice(0, tab).trim() || null, name: text.slice(tab + 1) };
}

/** `{ tty, name }` for a handle, or null when nothing carries it; rejects when tmux could not be asked. */
async function describe(handle, { timeout = 5000 } = {}) {
  const pane = await resolvePane(handle);
  if (!pane) return null;
  const res = await run(['display-message', '-p', '-t', pane, '#{pane_tty}\t#{window_name}'], { timeout });
  if (res.err) {
    if (isAbsence(detailOf(res))) return null;
    throw refusal(res, 'could not describe that session');
  }
  return parseDescribed(res.stdout);
}

/**
 * Close the agent's pane — and with it its window, which holds nothing else. The pane,
 * not the session: the session is the workspace's, and its other agents live in it.
 * `true` if it went, `false` if it was already gone.
 */
async function close(handle, { timeout = 5000 } = {}) {
  const pane = await resolvePane(handle);
  if (!pane) return false;
  const res = await run(['kill-pane', '-t', pane], { timeout });
  if (res.err) {
    if (isAbsence(detailOf(res))) return false;
    throw refusal(res, 'could not close that window');
  }
  return true;
}

/**
 * The backend: the required methods only. `focus`, `layout` and `sweepEmpty` are absent on
 * purpose — every caller asks `can()` first (lib/termbackend.js).
 */
export const tmuxBackend = Object.freeze({
  name: 'tmux',
  open,
  message,
  alive,
  ttys,
  describe,
  close,
  blocked: tmuxBlocked,
  notHosting,
});
