/**
 * `beadcause-top` — every Claude Code session on this Mac, live, in a window of its own.
 * bc-5to5r.7.
 *
 * **What this is for.** The reboot pass (lib/rebootresume.js) brings the windows back and
 * `b7e-sessions` prints what it decided, once. Adam asked for the thing `top` is to `ps`:
 * "one iterm window should remain separate, and it is a monitor process that shows all the
 * current sessions … all the current agent processes, their bead/name, and other helpful
 * metrics about them." So this is a *view*, redrawn every few seconds, with one row per
 * session — his hand-opened windows and the daemon's workers alike — and per row what a
 * person glancing at a wall of windows wants to know: what it is called, which workspace
 * (and so which iTerm window) it is in, which bead it holds, whether it is busy or idle and
 * since when, how full its context is, what it is costing the machine, how long it has been
 * up, and when it last wrote.
 *
 * **Where each column comes from.** Nothing here is new instrumentation; every number is
 * already on disk or in the process table:
 *
 * - *session, workspace, bead, kind, status* — `sessionRows` in lib/sessionregister.js, the
 *   same merge of live records, register and reboot report that `b7e-sessions` prints. A
 *   daemon window's kind and bead come from the `opened` register; a window with no row
 *   there is Adam's.
 * - *busy / idle and since* — the session record's own `status` and `statusUpdatedAt`,
 *   which Claude Code writes as it goes.
 * - *context* — the last `message.usage` in the transcript, read off the file's tail:
 *   `input + cache_read + cache_creation` is the context occupancy, which is the number the
 *   status line shows inside the session (`~/.claude/statusline-cost.sh`). The limit is
 *   inferred from the model id, as the status line infers it, and is a guess worth saying
 *   as a percentage and no more than that.
 * - *cpu, mem, up* — one `ps` call for every live pid.
 *
 * **Its own window, not a tab.** `openTab` files a window under its workspace, one window
 * per workspace (bc-2uj4.16.2), and a null workspace joins the shared one — which would make
 * this a tab among the beadcause conversations, the opposite of a monitor. `TOP_WINDOW` is
 * the key it is filed under instead: a workspace name nothing else uses, so it gets a window
 * of its own and, across hot swaps, the same one.
 *
 * **Read-only, and it works when the daemon is down**, because a daemon that is down is the
 * moment this is wanted most. No token, no HTTP; the one process it starts is `ps`. The one
 * exception is the merge-queue view behind `m` (lib/topqueue.js, bc-n01yg), which asks the
 * daemon and says so in a line when it cannot — the sessions view never waits on it.
 *
 * Pure where it can be: the readers take their doors injected (`ps`, the transcript reader,
 * the clock) so test/top.mjs drives every row and every frame without a session on the
 * machine; the loop (`runTop`) takes its streams the same way.
 */
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { loadState } from './config.js';
import { liveSessions, workspaceFor } from './claude.js';
import { bootAt } from './rebootresume.js';
import { agoPhrase } from './resume.js';
import { loadRegister, sameBoot, sessionRows, shortDir, statusWords } from './sessionregister.js';
import { focusSession } from './session.js';
import { transcriptFile } from './transcript.js';
import { QUEUE_REFRESH_MS, queueRows, renderQueue } from './topqueue.js';
import { cut, dw } from './width.js';

/**
 * The workspace key the monitor's iTerm window is recorded under in `itermWindows` —
 * see the header. Not a configured workspace, on purpose: a configured one has
 * conversations in it, and this must never be a tab among them.
 */
export const TOP_WINDOW = 'beadcause-top';

/** How often the frame is redrawn. `ps` and a dozen transcript tails every three seconds is nothing. */
export const TOP_REFRESH_MS = 3000;

/* ------------------------------------------------------------------ context */

/**
 * The context window a model id implies, in tokens. The status line's rule: 1M for a model
 * id that says so (`[1m]`, `-1m`), 200k otherwise, and `CLAUDE_CTX_LIMIT` overrides both.
 * A guess, and said as one — the column is a percentage so a wrong limit reads as a wrong
 * percentage rather than a wrong fact.
 */
export const DEFAULT_CONTEXT_LIMIT = 200_000;
export const LARGE_CONTEXT_LIMIT = 1_000_000;
export function contextLimitFor(model, env = process.env, tokens = 0) {
  const forced = Number(env?.CLAUDE_CTX_LIMIT);
  if (Number.isFinite(forced) && forced > 0) return forced;
  // The status line's own test, kept as loose: any `1m` in the id. And one thing the status
  // line does not do: a context already holding more than 200k tokens is in a bigger window
  // than 200k whatever the id says — the first frame after the 2026-10-12 reboot showed a
  // `claude-fable-5-1` session at 144% — so the occupancy itself promotes the guess.
  if (/1m/i.test(String(model || '')) || Number(tokens) > DEFAULT_CONTEXT_LIMIT) return LARGE_CONTEXT_LIMIT;
  return DEFAULT_CONTEXT_LIMIT;
}

/**
 * The newest `message.usage` in a transcript tail → `{ tokens, model, at }`, or null.
 *
 * Scanned from the end, because the last assistant turn is the only one that says what the
 * context holds *now*. A line that is not JSON (one still being written) or has no usage is
 * skipped, never fatal. `tokens` is input + cache read + cache creation: what the model was
 * handed, which is the context occupancy, not what it produced.
 */
export function contextFromTail(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.includes('"usage"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry?.message?.usage;
    if (!usage || typeof usage !== 'object') continue;
    const tokens =
      (Number(usage.input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0);
    return {
      tokens,
      model: typeof entry.message.model === 'string' ? entry.message.model : null,
      at: typeof entry.timestamp === 'string' ? entry.timestamp : null,
    };
  }
  return null;
}

/**
 * `contextFromTail` over the last `bytes` of a transcript file. The first line of a tail
 * that did not start at the file's start is a fragment and is dropped. Null for a file that
 * cannot be read; a session whose transcript is gone is a row with no context, not an error.
 */
export function readContext(file, { bytes = 256 * 1024 } = {}) {
  if (!file) return null;
  let fd;
  try {
    const size = fs.statSync(file).size;
    const length = Math.min(size, bytes);
    if (!length) return null;
    const buf = Buffer.alloc(length);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, length, size - length);
    const text = buf.toString('utf8');
    return contextFromTail(size > length ? text.slice(text.indexOf('\n') + 1) : text);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/* ------------------------------------------------------------------ processes */

/** `ps -o pid=,%cpu=,rss=,etime=` → Map(pid → { cpu, rssKb, etime }). Lines that are not that shape are skipped. */
export function parsePs(stdout) {
  const out = new Map();
  for (const line of String(stdout || '').split('\n')) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    if (!m) continue;
    out.set(Number(m[1]), { cpu: Number(m[2]), rssKb: Number(m[3]), etime: m[4] });
  }
  return out;
}

/**
 * One `ps` for every pid at once. A pid that died between the record and the call makes
 * `ps` exit non-zero while still printing the others, so the output is kept whenever there
 * is any; `ps` itself failing is an empty map, and the columns stay blank.
 */
export async function processStats(pids, { ps } = {}) {
  const list = [...new Set((pids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!list.length) return new Map();
  try {
    const stdout = ps
      ? await ps(list)
      : await new Promise((resolve, reject) =>
          execFile('ps', ['-o', 'pid=,%cpu=,rss=,etime=', '-p', list.join(',')], { timeout: 5000 }, (err, out) =>
            err && !out ? reject(err) : resolve(out)
          )
        );
    return parsePs(stdout);
  } catch {
    return new Map();
  }
}

/* ------------------------------------------------------------------ rows */

/**
 * `sessionRows` plus the live numbers: for a row with a live record, the record's own
 * busy/idle and since-when, the process's cpu/rss/etime from `stats`, and the context from
 * `context(row, rec)`; for every row, which kind of window it is — the daemon's `opened`
 * kind (`work`, `handoff`, `ship`, …) or `adam` for a window nothing opened. In the order
 * `sessionRows` gave them: the *frame* orders them (`sortRows`), by a column the reader
 * chose, and never by what just changed — a table that re-sorts itself as windows go busy
 * is one you cannot keep your eyes on (Adam, 2026-10-12).
 */
export function topRows({ rows = [], live = [], stats = new Map(), context = () => null, opened = {}, now = Date.now() } = {}) {
  const liveBy = new Map((live || []).map((s) => [String(s.sessionId), s]));
  const out = rows.map((row) => {
    const rec = liveBy.get(String(row.sessionId));
    const daemon = opened?.[row.sessionId];
    const st = rec ? stats.get(Number(rec.pid)) : null;
    const ctx = rec ? context(row, rec) : null;
    const limit = ctx ? contextLimitFor(ctx.model, process.env, ctx.tokens) : null;
    return {
      ...row,
      kind: daemon?.kind || (row.status === 'parked' ? 'daemon' : 'adam'),
      pid: rec?.pid ?? row.pid ?? null,
      activity: rec ? String(rec.status || '') : '',
      activityAt: rec?.at || null,
      activityAge: rec?.at ? shortAge(rec.at, now) : '',
      cpu: st ? st.cpu : null,
      rssKb: st ? st.rssKb : null,
      etime: st ? st.etime : null,
      model: ctx?.model || null,
      contextTokens: ctx ? ctx.tokens : null,
      contextLimit: limit,
      contextPct: ctx && limit ? Math.round((ctx.tokens / limit) * 100) : null,
    };
  });
  return out;
}

/* ------------------------------------------------------------------ order */

/** `01:02:03`, `2-03:04:05`, `05:12` — `ps`'s elapsed time, as seconds. Null for anything else. */
export function etimeSeconds(etime) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(String(etime || '').trim());
  if (!m) return null;
  const [, d, h, mi, s] = m;
  return (Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + Number(mi) * 60 + Number(s);
}

/** The state column's order: busy, then idle and the other words a live record uses, then what is not back. */
const STATE_RANK = (r) => (r.status !== 'live' ? 9 : r.activity === 'busy' ? 0 : r.activity === 'idle' ? 2 : 1);

/**
 * How each column orders. `text` compares as strings; otherwise as numbers, with a row
 * that has no number (no process, no transcript) after every row that has one, whichever
 * way the sort runs — an empty cell is not a small value.
 */
export const SORTS = Object.freeze({
  session: { text: (r) => r.name || '' },
  ws: { text: (r) => r.workspace || '' },
  bead: { text: (r) => r.bead || '' },
  kind: { text: (r) => r.kind || '' },
  state: { number: (r) => STATE_RANK(r) * 1e12 + (r.activityAt ? -Date.parse(r.activityAt) : 0) },
  ctx: { number: (r) => r.contextTokens },
  cpu: { number: (r) => r.cpu },
  mem: { number: (r) => r.rssKb },
  up: { number: (r) => etimeSeconds(r.etime) },
  where: { text: (r) => shortDir(r.dir) },
  last: { number: (r) => (r.transcriptAt ? Date.parse(r.transcriptAt) : null) },
});

/** The order the frame opens in: the workspace's window, then the name inside it — the same grouping iTerm shows. */
export const DEFAULT_SORT = Object.freeze({ by: 'ws', reverse: false });

/**
 * The rows in the chosen order. **Live rows first, always**: a row the boot pass decided
 * about and that has not come back has no numbers, and a sort by cpu or context that
 * interleaved it among the live ones would be sorting blanks. Within each tier, by the
 * column; ties — two sessions in one workspace, two idle windows — by the default order
 * and then by session id, so the order is total and the same on every frame. `reverse`
 * flips the column's order only; the tiers and the tie-break stay.
 */
export function sortRows(rows, { by = DEFAULT_SORT.by, reverse = false } = {}) {
  const spec = SORTS[by] || SORTS[DEFAULT_SORT.by];
  const dir = reverse ? -1 : 1;
  const cmp = (a, b) => {
    if (spec.text) return spec.text(a).localeCompare(spec.text(b), undefined, { sensitivity: 'base', numeric: true }) * dir;
    const x = spec.number(a);
    const y = spec.number(b);
    const xNone = x == null || Number.isNaN(x);
    const yNone = y == null || Number.isNaN(y);
    if (xNone || yNone) return xNone === yNone ? 0 : xNone ? 1 : -1;
    return (x - y) * dir;
  };
  const tie = (a, b) =>
    SORTS.ws.text(a).localeCompare(SORTS.ws.text(b), undefined, { sensitivity: 'base' }) ||
    SORTS.session.text(a).localeCompare(SORTS.session.text(b), undefined, { sensitivity: 'base', numeric: true }) ||
    String(a.sessionId).localeCompare(String(b.sessionId));
  const tier = (r) => (r.status === 'live' ? 0 : 1);
  return [...(rows || [])].sort((a, b) => tier(a) - tier(b) || cmp(a, b) || tie(a, b));
}

/** The sort column after `by`, stepping `step` through the columns in table order, wrapping. */
export function nextSort(by, step) {
  const ids = COLUMNS.map((c) => c.id);
  const at = Math.max(0, ids.indexOf(by));
  return ids[(at + step + ids.length) % ids.length];
}

/**
 * Everything one frame needs, read fresh: the state, the register, the live records, one
 * `ps`, and one transcript `stat` plus tail per row. This is the `collect` both
 * `beadcause-top` and `b7e-sessions --watch` hand `runTop`, with every door defaulted to the
 * real one and injectable for a test. The transcript file is looked up once per row and
 * shared between the mtime and the context read.
 */
export async function collectTop({
  cfg,
  loadState: readState = loadState,
  loadRegister: readRegister = loadRegister,
  liveSessions: readLive = liveSessions,
  booted = bootAt,
  ps,
  now = Date.now,
} = {}) {
  const state = readState() || {};
  const register = readRegister();
  const live = readLive(cfg);
  const boot = booted();
  const at = now();
  const report = state.rebootReport && typeof state.rebootReport === 'object' ? state.rebootReport : null;
  const files = new Map();
  const fileFor = (row) => {
    const key = String(row.sessionId);
    if (!files.has(key)) files.set(key, transcriptFile(cfg, { cwd: row.dir, sessionId: row.sessionId }));
    return files.get(key);
  };
  const transcriptAt = (row) => {
    const file = fileFor(row);
    if (!file) return null;
    try {
      return fs.statSync(file).mtimeMs;
    } catch {
      return null;
    }
  };
  const base = sessionRows({ register, report, live, opened: state.opened, boot, now: at, transcriptAt }).map((r) => ({
    ...r,
    workspace: r.workspace || workspaceFor(cfg, r.dir),
  }));
  const stats = await processStats(
    live.map((s) => s.pid),
    { ps }
  );
  const rows = topRows({ rows: base, live, stats, opened: state.opened, now: at, context: (row) => readContext(fileFor(row)) });
  return { rows, report, register, boot };
}

/* ------------------------------------------------------------------ words */

/** `12s`, `5m`, `2h`, `3d` — an age that fits a column. Blank for no time. */
export function shortAge(at, now = Date.now()) {
  const then = typeof at === 'number' ? at : Date.parse(at || '');
  if (!Number.isFinite(then)) return '';
  const s = Math.max(0, Math.round((Number(now) - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export const fmtTokens = (n) =>
  n == null ? '' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

export const fmtMem = (kb) => (kb == null ? '' : kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)}G` : `${Math.round(kb / 1024)}M`);

/** The state column: a live row's busy/idle and since when; any other row's boot outcome. */
export function stateWords(row) {
  if (row.status !== 'live') return statusWords(row);
  const word = row.activity || 'live';
  return row.activityAge ? `${word} ${row.activityAge}` : word;
}

/** The context column: `412k 41%` — or `412k` alone when no limit could be inferred. */
export const contextWords = (row) =>
  row.contextTokens == null ? '' : `${fmtTokens(row.contextTokens)}${row.contextPct == null ? '' : ` ${row.contextPct}%`}`;

/* ------------------------------------------------------------------ focus */

/**
 * `ps -o tty=` → the `/dev/ttysNNN` path iTerm knows a session by, or null.
 *
 * A row reaches its tab through its process, not through any handle beadcause stored
 * (bc-5to5r.9): the daemon knows the iTerm session id of the windows it opened and
 * nothing at all about the ones Adam opened, but every one of them has a controlling
 * terminal, and `tty of s` is what scripts/focus-session.applescript matches a `/dev/`
 * path against. `??` is `ps`'s word for no terminal — a headless run — and is null here.
 */
export function ttyPath(stdout) {
  const name = String(stdout || '').trim();
  return /^tty[a-z0-9]+$/i.test(name) ? `/dev/${name}` : null;
}

export async function ttyOf(pid, { ps } = {}) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    const stdout = ps
      ? await ps(n)
      : await new Promise((resolve, reject) =>
          execFile('ps', ['-o', 'tty=', '-p', String(n)], { timeout: 5000 }, (err, out) => (err && !out ? reject(err) : resolve(out)))
        );
    return ttyPath(stdout);
  } catch {
    return null;
  }
}

/**
 * Bring a row's tab and window to the front. Resolves a sentence for the header line:
 * what was focused, or why nothing was. `focus` is `focusSession` in `front` mode, which
 * selects the tab inside its window, selects the window and activates iTerm — the same
 * door the phone's "find this window" uses — and resolves null when no iTerm session has
 * that tty, which is a window that is not iTerm's (a plain Terminal, an ssh) or is gone.
 */
export async function focusRow(row, { ps, focus = (tty) => focusSession(tty, { front: true }) } = {}) {
  if (!row) return 'nothing selected';
  const name = row.name || String(row.sessionId || '').slice(0, 8);
  if (row.status !== 'live' || !row.pid) return `${name}: no process to focus — ${stateWords(row)}`;
  const tty = await ttyOf(row.pid, { ps });
  if (!tty) return `${name}: its process has no terminal`;
  try {
    const found = await focus(tty);
    return found === null ? `${name}: no iTerm window has ${tty}` : `focused ${name}`;
  } catch (err) {
    return `${name}: ${String(err?.message || err).split('\n')[0]}`;
  }
}

/* ------------------------------------------------------------------ the frame */

/**
 * The table's columns, in order. `min` marks the ones that give way when the terminal is
 * narrow, and how far: the directory first (its worktree name is usually in the session
 * name anyway), then the session name, each down to its floor, before anything else is cut.
 */
export const COLUMNS = [
  { id: 'session', head: 'session', cell: (r) => r.name || `(unnamed ${String(r.sessionId).slice(0, 8)})`, min: 16, give: 2 },
  { id: 'ws', head: 'ws', cell: (r) => r.workspace || '' },
  { id: 'bead', head: 'bead', cell: (r) => r.bead || '' },
  { id: 'kind', head: 'kind', cell: (r) => r.kind || '' },
  { id: 'state', head: 'state', cell: (r) => stateWords(r) },
  { id: 'ctx', head: 'ctx', cell: (r) => contextWords(r), right: true },
  { id: 'cpu', head: 'cpu', cell: (r) => (r.cpu == null ? '' : `${r.cpu.toFixed(1)}%`), right: true },
  { id: 'mem', head: 'mem', cell: (r) => fmtMem(r.rssKb), right: true },
  { id: 'up', head: 'up', cell: (r) => r.etime || '', right: true },
  { id: 'where', head: 'where', cell: (r) => shortDir(r.dir), min: 12, give: 1 },
  { id: 'last', head: 'last write', cell: (r) => (r.transcriptAt ? shortAge(r.transcriptAt, r.now) : '') },
];

/**
 * The frame, as lines that fit `width` columns and at most `height` lines.
 *
 * A header line counts the sessions and says when the Mac booted and the register was
 * last polled; a second says what the reboot pass did for *this* boot, if it ran. Then the
 * table. Rows that do not fit in `height` are summarised on one line rather than drawn off
 * the bottom. The `session` column gives way first when the terminal is narrow, then every
 * cell is cut, so a frame never wraps — a wrapped frame on an alternate screen is a frame
 * that scrolls itself away.
 *
 * `selected` is the session id the arrows are on (bc-5to5r.9); its row is drawn in inverse
 * video, applied after the fit so the escape codes never count as width. `notice` is one
 * sentence for the header line — what `f` just did. `sort` is the order the rows are
 * already in (`sortRows` ran before this): its column's heading carries ▲ or ▼.
 */
export function renderTop({
  rows = [],
  report = null,
  register = null,
  boot = 0,
  now = Date.now(),
  width = 120,
  height = Infinity,
  interactive = false,
  every = TOP_REFRESH_MS,
  selected = null,
  notice = null,
  sort = DEFAULT_SORT,
  queue = false,
} = {}) {
  const w = Math.max(40, Number(width) || 120);
  const lines = [];
  const live = rows.filter((r) => r.status === 'live');
  const busy = live.filter((r) => r.activity === 'busy').length;
  const notBack = rows.length - live.length;
  const bootIso = Number.isFinite(Number(boot)) && boot > 0 ? new Date(boot).toISOString() : null;
  const head = [
    `beadcause-top`,
    `${live.length} live (${busy} busy, ${live.length - busy} idle)${notBack ? `, ${notBack} not back` : ''}`,
    bootIso ? `booted ${agoPhrase(bootIso, new Date(now))}` : null,
    register?.polledAt ? `register ${shortAge(register.polledAt, now)} ago` : 'no register',
    new Date(now).toTimeString().slice(0, 8),
  ].filter(Boolean);
  if (notice) head.push(String(notice));
  lines.push(fit(head.join('  ·  '), w));
  if (bootIso && sameBoot(report?.boot, bootIso) && report?.at) {
    const counts = {};
    for (const r of report.rows || []) counts[r.outcome] = (counts[r.outcome] || 0) + 1;
    const said = Object.entries(counts)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ');
    lines.push(fit(`boot pass ${agoPhrase(report.at, new Date(now))}${said ? `: ${said}` : ': nothing was open'}`, w));
  } else if (bootIso) {
    lines.push('no reboot pass has run for this boot');
  }
  lines.push('');
  const footer = interactive
    ? [fit(`q quit · r refresh · ↑↓ select · f focus · ←→ sort column · o reverse${queue ? ' · m merge queue' : ''} · every ${Math.round(every / 1000)}s`, w)]
    : [];
  if (!rows.length) {
    lines.push('no sessions — nothing live, nothing in the register, nothing decided at boot');
    return [...lines, ...footer];
  }
  const heads = COLUMNS.map((c) => (c.id === sort?.by ? `${c.head} ${sort.reverse ? '▼' : '▲'}` : c.head));
  const cells = rows.map((r) => COLUMNS.map((c) => String(c.cell({ ...r, now }) ?? '')));
  const widths = COLUMNS.map((c, i) => Math.max(dw(heads[i]), ...cells.map((row) => dw(row[i]))));
  const gap = 2;
  const total = () => widths.reduce((n, x) => n + x, 0) + gap * (widths.length - 1);
  // Give way in `give` order, each column down to its floor, until the row fits.
  for (const c of [...COLUMNS].filter((x) => x.min).sort((a, b) => a.give - b.give)) {
    const over = total() - w;
    if (over <= 0) break;
    const i = COLUMNS.indexOf(c);
    widths[i] = Math.max(Math.max(dw(heads[i]), c.min), widths[i] - over);
  }
  const pad = (s, i) => {
    const { text, width: tw } = cut(s, widths[i]);
    const fill = ' '.repeat(Math.max(0, widths[i] - tw));
    return COLUMNS[i].right ? fill + text : text + fill;
  };
  const fmt = (row) => fit(row.map((s, i) => pad(s, i)).join(' '.repeat(gap)).trimEnd(), w);
  const table = [fmt(heads), fmt(widths.map((x) => '─'.repeat(x)))];
  const room = Number.isFinite(height) ? Math.max(1, height - lines.length - table.length - footer.length) : Infinity;
  const shown = cells.length > room ? cells.slice(0, Math.max(0, room - 1)) : cells;
  shown.forEach((row, i) => {
    const line = fmt(row);
    const picked = selected != null && String(rows[i].sessionId) === String(selected);
    // Inverse video over the padded line, so the bar runs the row's full width.
    table.push(picked ? `\x1b[7m${line.padEnd(Math.min(w, line.length + (w - dw(line))))}\x1b[0m` : line);
  });
  if (shown.length < cells.length) table.push(fit(`… and ${cells.length - shown.length} more`, w));
  return [...lines, ...table, ...footer];
}

const fit = (s, w) => cut(String(s), w).text;

/** `open <url>` — the browser door for the queue view's `f`. */
export const openInBrowser = (url) =>
  new Promise((resolve, reject) => execFile('open', [String(url)], { timeout: 10_000 }, (err) => (err ? reject(err) : resolve())));

/* ------------------------------------------------------------------ the loop */

/**
 * Draw, wait, draw again — until `q`, Ctrl-C or a signal. `collect` is the caller's
 * asynchronous "everything the frame needs", so this knows nothing about config, files or
 * `ps`; the bin wires those. With `once` it draws one frame and resolves. On a terminal it
 * takes the alternate screen (`alt`) and hides the cursor, and gives both back on the way
 * out; piped, it prints one frame per tick, which is what a log wants.
 *
 * Resolves with the exit code when the loop ends. Never throws for a bad tick: a `collect`
 * that fails draws the last good frame with the error on the header line and tries again.
 *
 * **Keys** (bc-5to5r.9): `↑`/`↓` and `k`/`j` move a highlighted row; `f` or Enter brings
 * that row's iTerm tab and window to the front through `focus` (`focusRow` by default)
 * and says what happened on the header line; `←`/`→` move the sort to the previous or
 * next column and `o` reverses it (`sortRows`; the heading carries ▲/▼); `r` redraws now;
 * `q` or Ctrl-C quits. The selection is a session id, not a row number, so the bar stays on
 * the conversation it was on when the sort changes or a row leaves. One focus in flight at
 * a time; an `f` while one is running is dropped rather than queued. The monitor keeps
 * running after `f` — the point of the key is to leave it.
 *
 * **The merge-queue view** (bc-n01yg): with a `collectQueue` door, `m` or Tab swaps the
 * table for lib/topqueue.js's — the queue and every open pull request — and back. It is
 * read every `queueEvery`, not every tick, because the daemon's answer only changes that
 * often; `r` reads it now. There `↑`/`↓` pick a pull request, `f` or Enter opens it in the
 * browser through `openUrl`, and the sort keys do nothing. Its selection is the pull
 * request's key, kept apart from the session one, so going back finds the bar where it was.
 */
export async function runTop({
  collect,
  every = TOP_REFRESH_MS,
  once = false,
  out = process.stdout,
  input = process.stdin,
  alt = Boolean(out.isTTY) && !once,
  now = Date.now,
  focus = focusRow,
  noticeMs = 4000,
  sort: initialSort = DEFAULT_SORT,
  collectQueue = null,
  view: initialView = 'sessions',
  queueEvery = QUEUE_REFRESH_MS,
  openUrl = openInBrowser,
  // Piped, a stream has no size; COLUMNS and LINES stand in, as they do for `ps` and `ls`.
  size = () => ({
    width: out.columns || Number(process.env.COLUMNS) || 120,
    height: out.rows || Number(process.env.LINES) || Infinity,
  }),
} = {}) {
  const interactive = Boolean(input?.isTTY) && !once;
  let last = null;
  let lastError = null;
  let selected = null;
  let notice = null;
  let noticeAt = 0;
  let focusing = false;
  let sort = { by: SORTS[initialSort?.by] ? initialSort.by : DEFAULT_SORT.by, reverse: Boolean(initialSort?.reverse) };
  let view = collectQueue && initialView === 'queue' ? 'queue' : 'sessions';
  let queueData = null;
  let queueAt = 0;
  let queuePick = null;
  const rows = () => sortRows(last?.rows || [], sort);
  const prs = () => (queueData ? queueRows(queueData) : []);
  const draw = () => {
    const { width, height } = size();
    if (notice && now() - noticeAt > noticeMs) notice = null;
    if (view === 'queue') {
      const lines = renderQueue({
        data: queueData,
        now: now(),
        width,
        height: alt ? height : Infinity,
        interactive,
        every: queueEvery,
        selected: interactive ? queuePick : null,
        notice: interactive ? notice : null,
        fetchedAt: queueAt || null,
      });
      if (alt) out.write(`\x1b[H${lines.map((l) => `${l}\x1b[K`).join('\n')}\x1b[J`);
      else out.write(`${lines.join('\n')}\n`);
      return;
    }
    const lines = renderTop({
      ...(last || {}),
      rows: rows(),
      sort,
      now: now(),
      width,
      height: alt ? height : Infinity,
      interactive,
      every,
      selected: interactive ? selected : null,
      notice: interactive ? notice : null,
      queue: Boolean(collectQueue),
    });
    if (lastError) lines[0] = fit(`${lines[0]}  ·  ${lastError}`, width);
    if (alt) out.write(`\x1b[H${lines.map((l) => `${l}\x1b[K`).join('\n')}\x1b[J`);
    else out.write(`${lines.join('\n')}\n`);
  };
  const frame = async (force = false) => {
    if (view === 'queue') {
      if (force || !queueAt || now() - queueAt >= queueEvery) {
        queueData = await collectQueue({ refresh: force === true });
        queueAt = now();
      }
      const all = prs();
      if (interactive && all.length && !all.some((r) => r.id === queuePick)) queuePick = all[0].id;
      return draw();
    }
    try {
      last = await collect();
      lastError = null;
    } catch (err) {
      lastError = String(err?.message || err).split('\n')[0];
    }
    // Keep the bar on a conversation that is still there; otherwise on the first row.
    if (interactive && rows().length && !rows().some((r) => String(r.sessionId) === String(selected))) selected = rows()[0].sessionId;
    draw();
  };
  const move = (by) => {
    if (view === 'queue') {
      const all = prs();
      if (!all.length) return;
      const at = all.findIndex((r) => r.id === queuePick);
      queuePick = all[Math.min(all.length - 1, Math.max(0, (at < 0 ? 0 : at) + by))].id;
      return draw();
    }
    const all = rows();
    if (!all.length) return;
    const at = all.findIndex((r) => String(r.sessionId) === String(selected));
    const next = Math.min(all.length - 1, Math.max(0, (at < 0 ? 0 : at) + by));
    selected = all[next].sessionId;
    draw();
  };
  const say = (text) => {
    notice = text;
    noticeAt = now();
    draw();
  };
  const resort = (step) => {
    if (view === 'queue') return;
    sort = step === 0 ? { ...sort, reverse: !sort.reverse } : { by: nextSort(sort.by, step), reverse: false };
    draw();
  };
  const swap = () => {
    if (!collectQueue) return undefined;
    view = view === 'queue' ? 'sessions' : 'queue';
    return frame();
  };
  const openPick = async () => {
    const pr = prs().find((r) => r.id === queuePick);
    if (!pr?.url) return say('no pull request selected');
    try {
      await openUrl(pr.url);
      say(`opened #${pr.number}`);
    } catch (err) {
      say(`could not open #${pr.number} — ${String(err?.message || err).split('\n')[0]}`);
    }
  };
  const bringToFront = async () => {
    if (view === 'queue') return openPick();
    if (focusing) return;
    focusing = true;
    try {
      say(await focus(rows().find((r) => String(r.sessionId) === String(selected)) || null));
    } finally {
      focusing = false;
    }
  };
  if (once) {
    await frame();
    return 0;
  }
  if (alt) out.write('\x1b[?1049h\x1b[2J\x1b[?25l');
  return new Promise((resolve) => {
    let ticker = null;
    let done = false;
    const quit = (code) => {
      if (done) return;
      done = true;
      if (ticker) clearInterval(ticker);
      if (interactive) {
        try {
          input.setRawMode(false);
        } catch {
          /* already gone */
        }
        input.pause?.();
      }
      if (alt) out.write('\x1b[?25h\x1b[?1049l');
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      out.off?.('resize', onResize);
      resolve(code);
    };
    const onSignal = () => quit(0);
    const onResize = () => frame();
    if (interactive) {
      input.setRawMode(true);
      input.resume();
      input.setEncoding('utf8');
      input.on('data', (key) => {
        if (key === 'q' || key === '\u0003') return quit(0);
        if (key === 'r') return frame(true);
        if (key === 'm' || key === '\t') return swap();
        if (key === '\x1b[A' || key === 'k') return move(-1);
        if (key === '\x1b[B' || key === 'j') return move(1);
        if (key === 'f' || key === '\r' || key === '\n') return bringToFront();
        if (key === '\x1b[D' || key === 'h') return resort(-1);
        if (key === '\x1b[C' || key === 'l') return resort(1);
        if (key === 'o') return resort(0);
        return undefined;
      });
    }
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    out.on?.('resize', onResize);
    ticker = setInterval(frame, every);
    frame();
  });
}
