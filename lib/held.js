/**
 * Questions held back so the phone rings once for a batch of them.
 *
 * bc-obhx3. The daemon log for the first week of October 2026 has the shape of the
 * problem: 30 rings on the 6th and 38 on the 9th, every one of them a class-1 "answer
 * this" card, every one from loremia, and nearly every one a decision an auto-dispatched
 * worker filed on its way through a bead. Landings already collapse — three or more in
 * one sweep become one card (`LANDED_MANY_AT` in lib/news.js) — but a question had no
 * such rule, so a day on which the advocates opened ninety sessions was a day on which
 * the phone buzzed about each decision as it was written, ten minutes apart, all day.
 *
 * **The rule.** A workspace that has just rung stays silent for a *settle window*
 * (`questions.settleMinutes`, ten by default). A question arriving inside that window is
 * *held*: it files, it counts, the inbox shows it, but the phone is not told to make a
 * noise. When the window lapses, everything held for that workspace goes out as **one
 * ring** — one ntfy push listing them, and on the Android app one buzz for the first with
 * the rest filed silently into the same stacked card (`hushed` on the event; see
 * WatchService.kt). A lone question in a quiet period still rings on the tick it
 * arrives, with its lock-screen buttons, because the window only opens *after* a ring.
 * So the cost of this is bounded and chosen: a second question is never more than one
 * settle window late, and a first one is never late at all.
 *
 * **What is deliberately not batched.** A foundation request — an agent asking to change
 * what it is — rings on its own as before. It is rare, it is a different channel on every
 * surface, and "approve" and "decline" are the whole of it, which is exactly the card
 * that must keep its two buttons. A reply from an agent (`checkReplies`) is not touched
 * either; it is already the answer to something you asked.
 *
 * **Two pieces of state, both in state.json beside `ringing`:**
 *
 *   - `held`   — `{ [workspace]: { since, keys: { [key]: { id, at } } } }`. What is
 *                waiting for the next ring. Pruned to live keys on every sweep, like
 *                `ringing`, so a bead answered from the inbox while it was held is simply
 *                not in the batch.
 *   - `rangAt` — `{ [workspace]: iso }`. When each workspace last rang. This, and not
 *                `held[ws].since`, is what the window is measured from: the window is "how
 *                long since the phone last heard about this repo", which is the question a
 *                person would ask.
 *
 * Both survive a restart on purpose. A deploy of beadcause itself restarts the daemon
 * several times a day, and a batch that was two minutes from ringing should ring two
 * minutes into the new daemon, not be forgotten or — worse — re-ring as the backlog.
 *
 * This module imports nothing, so a suite can pin the rule without a config dir.
 */

/** Default settle window, in minutes. Ten: long enough that a worker's run of three or four decisions arrives as one card, short enough that nothing waits past a cup of coffee. */
export const SETTLE_MINUTES = 10;

/** The most anyone may set. Two hours is already "tell me at lunch"; beyond that it is a mute, and a mute is a space setting. */
export const MAX_SETTLE_MINUTES = 120;

/**
 * The settle window in milliseconds, from `cfg.questions.settleMinutes`.
 *
 * Zero — or anything that is not a positive number — turns batching off, and every
 * question rings as it arrives, which is what the daemon did before bc-obhx3. Capped at
 * [MAX_SETTLE_MINUTES] rather than refused, because a config typo of `100` should mean
 * "a long window" and not "no batching at all".
 */
export function settleMs(cfg) {
  const raw = cfg?.questions?.settleMinutes;
  const n = raw === undefined || raw === null ? SETTLE_MINUTES : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_SETTLE_MINUTES) * 60_000;
}

/** Milliseconds since this workspace last rang, or `Infinity` if it never has. */
function sinceRang(rangAt, workspace, now) {
  const last = Date.parse(rangAt?.[workspace] || '');
  return Number.isFinite(last) ? now.getTime() - last : Infinity;
}

/** Has this workspace rung inside the window? A fresh question for it is held if so. */
export function recentlyRang(rangAt, workspace, now = new Date(), settle = SETTLE_MINUTES * 60_000) {
  return settle > 0 && sinceRang(rangAt, workspace, now) < settle;
}

/** How long until this workspace may ring again, in whole minutes, rounded up; 0 if it may now. */
export function ringsAgainInMinutes(rangAt, workspace, now = new Date(), settle = SETTLE_MINUTES * 60_000) {
  const left = settle - sinceRang(rangAt, workspace, now);
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

/**
 * Put a question in the hold for its workspace. Pure: returns the new map.
 *
 * `since` is kept from the first arrival so the log can say how long the oldest has
 * waited; the per-key `at` is there for the same reason and for a future card. Re-holding
 * a key already held is a no-op on `since` and refreshes nothing — the question is not
 * newer for having been swept twice.
 */
export function hold(held, q, now = new Date()) {
  const ws = q.workspace;
  const prev = held?.[ws] || { since: now.toISOString(), keys: {} };
  if (prev.keys[q.key]) return { ...(held || {}), [ws]: prev };
  return {
    ...(held || {}),
    [ws]: { since: prev.since, keys: { ...prev.keys, [q.key]: { id: q.id, at: now.toISOString() } } },
  };
}

/**
 * Which workspaces may ring on this sweep: those with something held whose window has
 * lapsed — or that never rang at all, which is how a lone question in a quiet period
 * rings on the tick it arrives.
 */
export function due(held, rangAt, now = new Date(), settle = SETTLE_MINUTES * 60_000) {
  return Object.keys(held || {}).filter(
    (ws) => Object.keys(held[ws]?.keys || {}).length > 0 && !recentlyRang(rangAt, ws, now, settle)
  );
}

/** Take a workspace's hold out. Returns the map without it and the keys it held, oldest first. */
export function release(held, workspace) {
  const { [workspace]: gone, ...rest } = held || {};
  const keys = Object.entries(gone?.keys || {})
    .sort(([, a], [, b]) => String(a.at).localeCompare(String(b.at)))
    .map(([key]) => key);
  return { held: rest, keys };
}

/** Keep only held keys still in the inbox; a workspace with nothing left is dropped. */
export function retainHeld(held, liveKeys) {
  const live = liveKeys instanceof Set ? liveKeys : new Set(liveKeys || []);
  const out = {};
  for (const [ws, h] of Object.entries(held || {})) {
    const keys = Object.fromEntries(Object.entries(h?.keys || {}).filter(([key]) => live.has(key)));
    if (Object.keys(keys).length) out[ws] = { since: h.since, keys };
  }
  return out;
}
