/**
 * Who holds a bead's lease — the reading behind `b7e-held`.
 *
 * lib/lease.js answers this already (`leasesOf`, `isLive`, `leaseVerdict`,
 * `describeLease`); no command called it, so three sessions each grepped lib/ for
 * `held:` to learn what the label on their own bead meant (bc-dgx7.198). This turns a
 * bead's labels into one row per lease plus the verdict, and does no I/O of its own.
 */
import { leaseVerdict, describeLease, isLive, leaseLife, LEASE_DEFAULTS } from './lease.js';
import { normalizeHandle } from './addressee.js';

const age = (at, now) => Math.max(0, Math.round((new Date(now).getTime() - new Date(at).getTime()) / 60000));

/**
 * @param {string[]} labels the bead's labels
 * @param {string|null} handle this Mac's handle, or null when `me` is unset
 * @param {{now?: Date, minutes?: number}} opts
 */
export function heldReport(labels, handle, { now = new Date(), minutes = LEASE_DEFAULTS.leaseMinutes } = {}) {
  const me = normalizeHandle(handle || '') || null;
  const verdict = leaseVerdict(labels, me, { now, minutes });
  const leases = verdict.all.map((l) => ({
    label: l.label,
    handle: l.handle,
    at: new Date(l.at).toISOString(),
    ageMinutes: age(l.at, now),
    live: isLive(l, { now, minutes }),
    mine: Boolean(me && l.handle === me),
    holder: Boolean(verdict.holder && verdict.holder.label === l.label),
  }));
  return {
    handle: me,
    leaseMinutes: leaseLife(minutes),
    leases,
    holder: verdict.holder ? verdict.holder.handle : null,
    summary: describeLease(verdict.holder, { now }),
    mine: Boolean(verdict.mine),
    lost: verdict.lost,
    won: verdict.won,
    stale: verdict.stale.length,
  };
}
