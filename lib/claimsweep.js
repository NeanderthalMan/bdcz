/**
 * A claim nobody is holding any more — put back in the queue.
 *
 * bc-iaju1.3. `handBack` in lib/advocate.js already does this for a window **this
 * daemon opened**: the window dies, the advocate notices its own worker is gone, and
 * `bd.reopenAbandoned` frees the bead. Nothing does it for a claim left by a session
 * nobody here launched — a `claude` Adam started by hand in a worktree, a session that
 * crashed before it delivered, a planner killed at the wrong moment. The daemon has no
 * worker record for those, so the bead stays `in_progress` for ever.
 *
 * Measured on the `bc-` graph on 2026-09-19: **81 beads in progress, 52 of them
 * untouched for a week or more, the oldest 39 days**, and only 50 had a worktree whose
 * name even resembled their id. A claimed bead is not in `bd ready`, so every one of
 * those is invisible to every advocate — the queue looked 52 beads shorter than it was.
 *
 * ## What it will not touch, and why each one would be a mistake
 *
 * - **A bead whose session is still live.** Two reads, both of them the same ones
 *   lib/advocate.js trusts for this exact question: a live session whose *name* says the
 *   bead (`namesBead`), and a live process whose *argv* says it (`linesNameBead`) — the
 *   second because a window's first turn can spend twenty minutes in a slow suite before
 *   it ever renames itself, and that is precisely when it looks most abandoned.
 * - **A bead a live advocate worker holds.** Passed in by the caller rather than read
 *   here: the advocate knows its own windows, and it is already the thing that hands
 *   those back when they die.
 * - **Anything carrying a delivery or merge label.** `pr-delivery` and `merge-queue`
 *   mean the work is *done* and waiting on a pull request — reopening one would hand it
 *   to a new window while the branch it is waiting on sits there. That is the same
 *   distinction `handBack` draws when it refuses to touch `delivered`.
 * - **A bead somebody touched recently.** `hours` (72 by default) measured against the
 *   tracker's own `updated_at`. A session working a bead comments, labels and claims
 *   children as it goes, so a genuinely live bead does not go three days silent.
 *
 * ## What it does, and what it deliberately does not
 *
 * It comments and reopens. It does **not** close, and it does not judge the work: the
 * bead comes back exactly as it was, minus the claim, and the next session — human or
 * advocate — picks it up with the comment explaining why it was free. A session that is
 * in fact still on it re-claims it, which is one `bd update --claim` and no lost work.
 *
 * `reopenAbandoned` rather than `reopen`, for lib/bd.js's reason: bd refuses to clear a
 * claim held by another actor, and on this path the holder is always another actor.
 */
import { liveSessions, liveProcessLines, linesNameBead } from './claude.js';
import { namesBead } from './reap.js';
import { DELIVERY_LABEL } from './delivery.js';
import { MERGE_LABEL } from './mergebead.js';

/** Work that is finished and waiting on something else — never this sweep's to reopen. */
export const KEEP_LABELS = new Set([DELIVERY_LABEL, MERGE_LABEL, 'shipped', 'stood-down']);

/** The default silence before a claim is treated as abandoned. */
export const DEFAULT_STALE_HOURS = 72;

const hoursSince = (at, now) => {
  const t = Date.parse(at || '');
  return Number.isFinite(t) ? (now - t) / 3_600_000 : Infinity;
};

/** The sentence left on the bead, so the next reader knows this was a sweep and not a person. */
export const lapseNote = (idle, hours) =>
  `Claim released by beadcause: nothing has touched this for ${Math.floor(idle)} hours ` +
  `(the limit is ${hours}), and no live session or process names it. The work is not judged — ` +
  `the bead is back in the queue exactly as it was. If you are still on it, \`bd update <id> --claim\` takes it back.`;

/**
 * One pass. Returns `{ released, kept }` and throws nothing a caller has to guard: a
 * tracker that refuses one write leaves that bead claimed, which is where it already
 * was, and the next pass tries again.
 */
export async function sweepStaleClaims(
  bd,
  workspaces,
  { hours = DEFAULT_STALE_HOURS, held = new Set(), cfg = {}, now = Date.now(), onLog = () => {}, ps } = {}
) {
  if (!hours) return { released: [], kept: [] };
  const sessions = liveSessions(cfg);
  const lines = await liveProcessLines({ ps });
  const released = [];
  const kept = [];

  for (const workspace of workspaces || []) {
    /**
     * `cfg.workspaces` holds `{ name, dir }` objects and every `Bd` method takes one whole,
     * but `linesNameBead` matches the *qualified* `<name>/<id>` a brief's argv carries — so
     * the name has to be pulled out rather than interpolated. A `${workspace}` there reads
     * `[object Object]/bc-x`, matches nothing, and the guard it belongs to silently never
     * fires: a live window's bead freed under it. A plain string workspace still works.
     */
    const name = typeof workspace === 'string' ? workspace : workspace?.name || '';
    let rows;
    try {
      rows = await bd.listStatus(workspace, 'in_progress');
    } catch (err) {
      onLog(`[claims] ${name || 'the tracker'}: could not list in-progress beads — ${err.message.split('\n')[0]}`);
      continue;
    }

    for (const row of rows) {
      const id = String(row.id || '');
      if (!id) continue;
      const labels = row.labels || [];
      const idle = hoursSince(row.updated_at || row.updatedAt || row.created_at, now);
      const why =
        labels.some((l) => KEEP_LABELS.has(l)) ? 'waiting on a pull request'
        : held.has(id) ? 'an advocate window holds it'
        : idle < hours ? 'touched recently'
        : sessions.some((s) => namesBead(s.name, id)) ? 'a live session names it'
        : linesNameBead(lines, name, id) ? 'a live process names it'
        : null;
      if (why) {
        kept.push({ workspace: name, id, why });
        continue;
      }

      try {
        await bd.comment(workspace, id, lapseNote(idle, hours));
        await bd.reopenAbandoned(workspace, id);
      } catch (err) {
        onLog(`[claims] ${name}/${id}: still claimed — ${err.message.split('\n')[0]}`);
        continue;
      }
      released.push({ workspace: name, id, idleHours: Math.floor(idle) });
      onLog(`[claims] ${name}/${id}: claimed and silent for ${Math.floor(idle)}h with nothing running — back in the queue`);
    }
  }

  return { released, kept };
}
