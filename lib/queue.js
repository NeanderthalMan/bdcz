/**
 * `b7e-queue` — where a gate stands in the machine-wide slot queue, and whether anything
 * ahead of it is actually alive.
 *
 * bc-dgx7.116 names six sessions (bc-ka5y.33, bc-khoe.60, bc-dgx7.15, bc-dgx7.17,
 * bc-dgx7.12, bc-dgx7.13) that each hit `lib/gate.js`'s `waitingLine` — "N gates ahead
 * of you, oldest started Xm ago" — and had no way to tell a genuine deep queue from a
 * stale-looking one. bc-dgx7.12 saw "oldest started 447m ago" while `b7e-gates` (a
 * *different* view of the same machine, built for a *different* question — bc-khoe.55)
 * showed nothing anywhere near that old: two sources, disagreeing, neither one able to
 * settle it. This module is the third view, built to answer exactly that question,
 * reusing both of the others rather than re-deriving what they already know:
 * `liveSlots`/`slotLimit` (`lib/gate.js`) for the queue itself, and `discover`
 * (`lib/gates.js`) to say whether a ticket's pid is still a real gate.
 *
 * `bin/b7e-queue` is the argv shell; everything that can be gotten wrong lives here so
 * `test/b7equeue.mjs` can drive it directly, against a fabricated slot directory and a
 * fabricated `discover`, without starting a real gate.
 */
import { liveSlots, slotLimit, REPO_ROOT } from './gate.js';
import { listWorktrees, worktreeFor, discover } from './gates.js';
import { realPath } from './tidy.js';

/**
 * Every live ticket, oldest first (`liveSlots` already sorts and reaps the dead ones —
 * see its own header), tagged with its queue position and whether that position is
 * inside the machine's `limit`.
 */
export function queueRows(base, { limit = slotLimit(), now = Date.now() } = {}) {
  return liveSlots(base).map((ticket, position) => ({
    ...ticket,
    position,
    held: position < limit,
    ageMs: now - ticket.startedAt,
  }));
}

/** The header's own numbers: the limit, and how many rows are held vs still waiting. */
export function queueSummary(rows, { limit = slotLimit() } = {}) {
  const held = rows.filter((r) => r.held).length;
  return { limit, held, waiting: rows.length - held, total: rows.length };
}

/**
 * The row that is "mine" — the ticket whose `root` is the worktree the caller is
 * standing in. A ticket is written with `root` set to the tree the gate was started
 * against (`ROOT` in both `bin/b7e-gate` and `scripts/test.mjs`), and the per-tree lock
 * in `lib/gate.js` already refuses a second gate on the same tree at once, so "which
 * ticket is mine" is stable even from a process — an agent checking in later — that
 * never called `acquireSlot` itself.
 */
export async function myRow(rows, { dir = process.cwd(), root, listWorktreesFn = listWorktrees, worktreeForFn = worktreeFor } = {}) {
  const worktrees = await listWorktreesFn(root || dir || REPO_ROOT);
  const mine = worktreeForFn(dir, worktrees);
  if (!mine) return null;
  return rows.find((r) => r.root && realPath(r.root) === mine.real) || null;
}

/**
 * Cross-checks every row's pid against `lib/gates.js`'s own discovery — the second
 * source bc-dgx7.12 had and could not reconcile with the first. `liveSlots` already
 * drops a ticket whose pid is simply gone, so a row that reaches here has a pid that is
 * *alive*; `mismatch: true` means alive but not found by `discover` as any kind of gate
 * runner — a ticket a reused pid, or a run no longer recognisable as the thing that
 * took the slot, has outlived. That is the exact shape of the 447m/21m disagreement.
 */
export async function withMismatches(rows, { dir = process.cwd(), discoverFn = discover } = {}) {
  if (!rows.length) return rows;
  const { runners } = await discoverFn({ dir });
  const known = new Set(runners.map((r) => r.pid));
  return rows.map((r) => ({ ...r, mismatch: !known.has(r.pid) }));
}

/** "4m ago" / "less than a minute ago" — the phrasing `lib/gate.js`'s own `waitingLine` uses. */
export function agePhrase(ms) {
  const mins = Math.max(0, Math.round(ms / 60_000));
  return mins < 1 ? 'less than a minute ago' : `${mins}m ago`;
}

/** One line per ticket: position, pid, worktree, age, MINE, and a mismatch flag. */
export function formatRow(r, { mine = false } = {}) {
  const state = r.held ? 'holding' : `waiting (${r.position + 1} in line)`;
  const who = mine ? '  MINE' : '';
  const flag = r.mismatch ? '  — no matching runner in b7e-gates; this ticket may be stale' : '';
  const root = r.root || 'unknown worktree';
  return `${state}  pid ${r.pid}  ${root}  started ${agePhrase(r.ageMs)}${who}${flag}`;
}

/** "2 held / 1 waiting, limit 2" — or the empty-queue line. */
export function headerLine(summary) {
  if (!summary.total) return `no gates queued right now (limit ${summary.limit})`;
  return `${summary.held} held / ${summary.waiting} waiting, limit ${summary.limit}`;
}

/**
 * How long a full run tends to take end to end — `scripts/test.mjs`'s own header
 * measured two real runs at 41 and 51 minutes; this picks the middle of that rather
 * than either extreme. Used only for the footer's rough estimate, never for a decision
 * this file makes on its own.
 */
const TYPICAL_RUN_MS = 45 * 60_000;

/**
 * A rough "expect roughly Xm" footer for a still-waiting caller, from how long the
 * oldest holder has already been running — a guess, not a promise, which is exactly
 * why it is said as one. `null` when nobody is waiting or nothing is held, since an
 * estimate with no queue behind it is not an estimate of anything.
 */
export function waitEstimateLine(rows, summary, { now = Date.now() } = {}) {
  const holders = rows.filter((r) => r.held);
  if (!holders.length || !summary.waiting) return null;
  const oldest = holders.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
  const elapsed = now - oldest.startedAt;
  const remainingMs = Math.max(0, TYPICAL_RUN_MS - elapsed);
  const remaining = Math.round(remainingMs / 60_000);
  return (
    `oldest holder started ${agePhrase(elapsed)} — a full run is typically ` +
    `~${Math.round(TYPICAL_RUN_MS / 60_000)}m, so expect roughly ${remaining}m before a slot frees, ` +
    'if it is still making progress'
  );
}

/**
 * The sentence bc-dgx7.12 and bc-dgx7.17 each wrote by hand after burning turns waiting
 * — the honest answer, said once, on the deadline `--wait --timeout` asks for.
 */
export const TIMEOUT_LINE = 'you will not get a turn today, deliver on the affected suites';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until the caller's own ticket is held, or `timeoutMs` elapses. Resolves the held
 * row, or `null` on the deadline — `bin/b7e-queue --wait` turns a `null` into exit 3
 * and the timeout sentence above, rather than leaving the caller to invent its own way
 * of giving up the way all six sessions in the bead did.
 */
export async function waitForMine({
  base,
  limit = slotLimit(),
  timeoutMs = Infinity,
  pollMs = 1000,
  sleep = defaultSleep,
  now = Date.now,
  dir,
  root,
  onWait,
} = {}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const rows = queueRows(base, { limit, now: now() });
    const mine = await myRow(rows, { dir, root });
    if (mine?.held) return mine;
    onWait?.(mine);
    if (now() >= deadline) return null;
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
}
