/**
 * `beadcause-top`'s second view — the merge queue, and every open pull request beside it.
 * bc-n01yg.
 *
 * Adam, 2026-10-25: "add a view to the beadcause-top to show the queue and the PRs in the
 * queue with data for each". The same afternoon the queue held nothing while nine pull
 * requests sat open, and the only way to learn that was to ask a session to read
 * `/api/queues` by hand. So the view draws two populations and says which is which:
 *
 * - **Queued** — a merge-bead exists (lib/mergebead.js). Its position in the order the
 *   sweep tries them, its rung on the merge ladder (`MERGE_STAGES` in lib/queues.js),
 *   attempts spent, downmerges, and what refused it last.
 * - **Not queued** — open on the board and no merge-bead at all. Nothing will merge these
 *   until somebody approves one (`/merge`), and a view that left them off would read as a
 *   repo with nothing waiting.
 *
 * Each row also carries what GitHub says now: checks, mergeable, size, age. The bases line
 * above the table is `baseReadings` — whether each base is green, red or held, which is the
 * one thing that decides whether anything in the queue can move at all.
 *
 * **It asks the daemon, unlike the sessions view.** The queue's stages live in merge-bead
 * notes across every workspace and the pull requests' state lives on GitHub; the daemon
 * already keeps both warm (`gatherMerges` twenty seconds, the board twenty-five) behind
 * `GET /api/queues` and `GET /api/prs`. Reading them again from here would be a `bd` per
 * workspace and a `gh` per repo every few seconds, from a second process with no cache. So
 * this view needs the daemon, says so in one line when it is not there, and the sessions
 * view — which needs nothing — is untouched by that.
 *
 * Pure apart from `collectQueue`, whose `fetch` is injected, so test/topqueue.mjs drives
 * every row without a daemon.
 */
import { MAX_ATTEMPTS } from './mergebead.js';
import { shortAge } from './top.js';
import { cut, dw } from './width.js';

/**
 * How often the queue is asked for while its view is up. Slower than the sessions frame on
 * purpose: the daemon's own answer only changes every twenty seconds, so asking every
 * three would be the same payload six times. `r` asks now.
 */
export const QUEUE_REFRESH_MS = 10_000;

/** How long one request may take before the view says the daemon did not answer. */
export const QUEUE_TIMEOUT_MS = 8_000;

/* ------------------------------------------------------------------ reading */

/**
 * Both payloads, from the daemon on loopback — `{ queues, prs, error }`, never a throw.
 * An error is one sentence the header can carry; a daemon that is down is the ordinary
 * case, not an exception.
 */
export async function collectQueue({ cfg = {}, fetch: get = globalThis.fetch, timeoutMs = QUEUE_TIMEOUT_MS, refresh = false } = {}) {
  const base = `http://127.0.0.1:${cfg.port || 4318}`;
  const ask = async (path) => {
    const res = await get(`${base}${path}${refresh ? '?refresh=1' : ''}`, {
      headers: { 'x-beadcause-token': cfg.token || '' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${path} answered HTTP ${res.status}`);
    return res.json();
  };
  try {
    const [queues, prs] = await Promise.all([ask('/api/queues'), ask('/api/prs')]);
    return { queues, prs, error: null };
  } catch (err) {
    const why = err?.name === 'TimeoutError' ? `no answer in ${Math.round(timeoutMs / 1000)}s` : String(err?.message || err).split('\n')[0];
    return { queues: null, prs: null, error: `the daemon at ${base} could not be read — ${why}` };
  }
}

/* ------------------------------------------------------------------ rows */

const isOpen = (pr) => !pr?.merged && !pr?.mergedAt && String(pr?.state || 'OPEN').toUpperCase() === 'OPEN';
const prKey = (key, number) => `${key}#${Number(number)}`;

/**
 * One row per queued entry, then one per open pull request with no entry — the shape the
 * table draws and `--json` prints.
 *
 * The join is the board's own key, `<repo key>#<number>`: a merge entry carries the card's
 * `key` and its pull request's number, and a board row carries `key` already built. An
 * entry whose pull request the board does not list (an orphan, or one older than the
 * board's window) still gets its row, with GitHub's columns blank rather than guessed.
 */
export function queueRows({ queues = null, prs = null } = {}) {
  const board = new Map();
  for (const card of prs?.repos || []) {
    for (const pr of card.prs || []) board.set(pr.key || prKey(card.key ?? card.workspace, pr.number), pr);
  }
  const entries = [...(queues?.repos || []).flatMap((r) => r.merge || []), ...(queues?.orphans || [])];
  const queued = entries
    .map((e) => {
      const pr = board.get(prKey(e.key ?? e.workspace, e.number)) || null;
      return {
        id: prKey(e.key ?? e.workspace, e.number),
        queued: true,
        workspace: e.workspace,
        position: e.position ?? null,
        queueLength: e.queueLength ?? null,
        number: e.number,
        url: e.url || pr?.url || '',
        bead: e.bead || pr?.beads?.[0]?.id || null,
        mergeBead: e.mergeBead || null,
        title: e.title || pr?.title || '',
        stage: e.stage,
        stageLabel: e.stageLabel || e.stage || '',
        note: e.note || '',
        attempts: e.attempts || 0,
        downmerges: e.downmerges || 0,
        refused: e.refused || null,
        stageAt: e.at || null,
        ...github(pr),
      };
    })
    .sort((a, b) => String(a.workspace).localeCompare(String(b.workspace)) || (a.position ?? 1e9) - (b.position ?? 1e9));
  const seen = new Set(queued.map((r) => r.id));
  const waiting = [...board.entries()]
    .filter(([key, pr]) => !seen.has(key) && isOpen(pr))
    .map(([key, pr]) => ({
      id: key,
      queued: false,
      workspace: pr.workspace,
      position: null,
      queueLength: null,
      number: pr.number,
      url: pr.url || '',
      bead: pr.beads?.[0]?.id || null,
      mergeBead: null,
      title: pr.title || '',
      stage: 'unqueued',
      stageLabel: pr.draft ? 'not queued (draft)' : 'not queued',
      note: pr.draft
        ? 'A draft. The merge queue skips drafts, so this will not merge until it is marked ready and approved.'
        : 'Open, with no merge-bead. Nothing will merge it until it is approved onto the queue (/merge).',
      attempts: 0,
      downmerges: 0,
      refused: null,
      stageAt: null,
      ...github(pr),
    }))
    .sort((a, b) => String(a.workspace).localeCompare(String(b.workspace)) || (b.number || 0) - (a.number || 0));
  return [...queued, ...waiting];
}

/** What GitHub says about the pull request now — blank where the board has no row. */
function github(pr) {
  const c = pr?.checks || null;
  return {
    draft: !!pr?.draft,
    checks: c?.state || null,
    passing: c?.passing ?? null,
    failing: c?.failing ?? null,
    pending: c?.pending ?? null,
    total: c?.total ?? null,
    failed: c?.failed || [],
    mergeable: pr?.mergeable || null,
    additions: pr?.additions ?? null,
    deletions: pr?.deletions ?? null,
    createdAt: pr?.createdAt || null,
  };
}

/* ------------------------------------------------------------------ words */

/** `3/4 ✓` passing, `1 ✗ of 4` failing, `2 … of 4` pending — or the bare state. */
export function checksWords(r) {
  if (!r.checks) return '';
  if (r.total == null) return r.checks;
  if (r.checks === 'passing') return `✓ ${r.passing}/${r.total}`;
  if (r.checks === 'failing') return `✗ ${r.failing}/${r.total}`;
  if (r.checks === 'pending') return `… ${r.pending}/${r.total}`;
  return r.checks;
}

const MERGEABLE = { MERGEABLE: 'clean', CONFLICTING: 'conflict', UNKNOWN: '?' };

/** The base reading for one workspace, as the bases line says it. */
const baseWords = (b) => `${b.workspace}: ${String(b.summary || b.state || '').replace(/\.$/, '')}`;

/* ------------------------------------------------------------------ the frame */

export const QUEUE_COLUMNS = [
  { id: 'pos', head: '#', cell: (r) => (r.queued ? (r.queueLength ? `${r.position}/${r.queueLength}` : String(r.position ?? '')) : '—'), right: true },
  { id: 'ws', head: 'ws', cell: (r) => r.workspace || '' },
  { id: 'pr', head: 'pr', cell: (r) => (r.number ? `#${r.number}` : ''), right: true },
  { id: 'bead', head: 'bead', cell: (r) => r.bead || '' },
  { id: 'stage', head: 'stage', cell: (r) => r.stageLabel || '' },
  { id: 'in', head: 'in stage', cell: (r) => (r.stageAt ? shortAge(r.stageAt, r.now) : ''), right: true },
  { id: 'tries', head: 'tries', cell: (r) => (r.queued ? `${r.attempts}/${MAX_ATTEMPTS}${r.downmerges ? ` ↓${r.downmerges}` : ''}` : '') },
  { id: 'checks', head: 'checks', cell: (r) => checksWords(r) },
  { id: 'merge', head: 'merge', cell: (r) => (r.mergeable ? MERGEABLE[String(r.mergeable).toUpperCase()] || String(r.mergeable).toLowerCase() : '') },
  { id: 'size', head: 'size', cell: (r) => (r.additions == null ? '' : `+${r.additions} −${r.deletions ?? 0}`), right: true },
  { id: 'age', head: 'age', cell: (r) => (r.createdAt ? shortAge(r.createdAt, r.now) : ''), right: true },
  { id: 'title', head: 'title', cell: (r) => r.title || '', min: 12, give: 1 },
];

/**
 * The queue frame, as lines that fit `width` and at most `height` — `renderTop`'s rules:
 * the title column gives way, every cell is cut, nothing wraps, and rows past the height
 * are counted. Under the table, the selected row's note and refusal — the sentence that
 * says *why* it is where it is, which no column has room for.
 */
export function renderQueue({
  data = null,
  rows = null,
  now = Date.now(),
  width = 120,
  height = Infinity,
  interactive = false,
  every = QUEUE_REFRESH_MS,
  selected = null,
  notice = null,
  fetchedAt = null,
} = {}) {
  const w = Math.max(40, Number(width) || 120);
  const all = rows || queueRows(data || {});
  const queued = all.filter((r) => r.queued).length;
  // A workspace the queue could not read is not a workspace with nothing queued — the
  // daemon's cold first answer is every workspace unread, and "0 queued" there is a lie.
  const unread = data?.queues?.errors?.length || 0;
  const head = [
    'beadcause-top',
    'merge queue',
    data?.error ? null : `${queued} queued${unread ? ` (${unread} workspace${unread === 1 ? '' : 's'} unread)` : ''}, ${all.length - queued} open not queued`,
    fetchedAt ? `read ${shortAge(fetchedAt, now)} ago` : null,
    new Date(now).toTimeString().slice(0, 8),
  ].filter(Boolean);
  if (notice) head.push(String(notice));
  const lines = [fit(head.join('  ·  '), w)];
  const footer = interactive
    ? [fit(`q quit · r refresh · ↑↓ select · f open pr · m sessions · every ${Math.round(every / 1000)}s`, w)]
    : [];
  if (data?.error) {
    lines.push(fit(data.error, w), '', 'The sessions view still works without it — m to go back.');
    return [...lines, ...footer];
  }
  // Every base a row stands on, and any base that is not green — a red base holds a queue
  // that is not on screen yet, the moment something joins it.
  const wanted = new Set(all.map((r) => r.workspace));
  const bases = (data?.queues?.bases || []).filter((b) => wanted.has(b.workspace) || b.state === 'red' || b.holdBead);
  if (bases.length) lines.push(fit(`bases  ${bases.map(baseWords).join('  ·  ')}`, w));
  const errors = data?.queues?.errors || [];
  if (errors.length) lines.push(fit(`unread  ${errors.map((e) => `${e.workspace}: ${e.error}`).join('  ·  ')}`, w));
  lines.push('');
  if (!all.length) {
    lines.push('nothing queued and no open pull requests on the board');
    return [...lines, ...footer];
  }
  const heads = QUEUE_COLUMNS.map((c) => c.head);
  const cells = all.map((r) => QUEUE_COLUMNS.map((c) => String(c.cell({ ...r, now }) ?? '')));
  const widths = QUEUE_COLUMNS.map((c, i) => Math.max(dw(heads[i]), ...cells.map((row) => dw(row[i]))));
  const gap = 2;
  const total = () => widths.reduce((n, x) => n + x, 0) + gap * (widths.length - 1);
  for (const c of QUEUE_COLUMNS.filter((x) => x.min).sort((a, b) => a.give - b.give)) {
    const over = total() - w;
    if (over <= 0) break;
    const i = QUEUE_COLUMNS.indexOf(c);
    widths[i] = Math.max(Math.max(dw(heads[i]), c.min), widths[i] - over);
  }
  const pad = (s, i) => {
    const { text, width: tw } = cut(s, widths[i]);
    const fill = ' '.repeat(Math.max(0, widths[i] - tw));
    return QUEUE_COLUMNS[i].right ? fill + text : text + fill;
  };
  const fmt = (row) => fit(row.map((s, i) => pad(s, i)).join(' '.repeat(gap)).trimEnd(), w);
  const picked = all.find((r) => r.id === selected) || null;
  const detail = picked ? detailLines(picked, w) : [];
  const table = [fmt(heads), fmt(widths.map((x) => '─'.repeat(x)))];
  const room = Number.isFinite(height)
    ? Math.max(1, height - lines.length - table.length - footer.length - (detail.length ? detail.length + 1 : 0))
    : Infinity;
  const shown = cells.length > room ? cells.slice(0, Math.max(0, room - 1)) : cells;
  shown.forEach((row, i) => {
    const line = fmt(row);
    table.push(all[i].id === selected ? `\x1b[7m${line.padEnd(Math.min(w, line.length + (w - dw(line))))}\x1b[0m` : line);
  });
  if (shown.length < cells.length) table.push(fit(`… and ${cells.length - shown.length} more`, w));
  return [...lines, ...table, ...(detail.length ? ['', ...detail] : []), ...footer];
}

/** The selected row's sentences: its note, what refused it, which checks failed. */
function detailLines(r, w) {
  const out = [fit(`#${r.number}  ${r.note}`, w)];
  if (r.refused) out.push(fit(`refused: ${String(r.refused).replace(/\s+/g, ' ')}`, w));
  if (r.failed?.length) out.push(fit(`failing: ${r.failed.join(', ')}`, w));
  return out;
}

const fit = (s, w) => cut(String(s), w).text;
