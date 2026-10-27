/**
 * Move a bead to the tracker that can actually deliver it — verbatim, with the rival
 * sweep and the supersede marker in one call.
 *
 * bc-dgx7.138. Four delmar sessions (`dv-afr.35`, `.36`, `.39`, `dv-b5d.52`) each did
 * this by hand and no two of them did it the same way — see `docs/b7e-tools.md`'s
 * `b7e-rehome` section for the full account of what went wrong each time. This is the
 * library half; `bin/b7e-rehome` is the argv and the report printed around it, same
 * split every other `b7e-*` tool takes with its `lib/`.
 *
 * Three things this composes rather than reinvents, and none of them is duplicated
 * here:
 *
 *  - **The file half is `Bd.create` (`lib/bd.js`) directly, not `lib/filing.js`'s
 *    `fileBeads`.** That module's homing and priority-floor machinery is built for what
 *    an agent just noticed mid-task — it derives a parent from a `discovered-from` bead
 *    in the *same* tracker and clamps a fresh finding's priority so an agent cannot
 *    outrank the work it was given. Neither applies to a bead somebody already reviewed
 *    and decided is real: the caller names the destination parent directly (`--under`,
 *    required — there is no cross-tracker `discovered-from` to derive one from), and the
 *    priority, type, description, acceptance and design all travel unclamped, because
 *    this is the same bead arriving somewhere else, not a new one.
 *  - **The supersede half is `mark` (`lib/superseded.js`)** — the identical three writes
 *    `bin/supersede.js` makes (the label, the `--status=open` if it was claimed, the
 *    comment), run cross-workspace, which is the *only* shape this command ever needs:
 *    `-w` and `--to` are always different trackers, so `mark`'s edge-drawing branch
 *    (same-tracker only) never fires and the source bead is held by its marker alone,
 *    exactly as a cross-tracker supersede always is.
 *  - **The rival sweep is `queryFor`/`scoreAll`/`withSuccessors` (`lib/dup.js`)** — the
 *    same ranking `bin/b7e-dup` prints, run once against the destination tracker's own
 *    rows (open and closed) using the source bead's own text as the query, so "nothing
 *    covers this" is an answer the report can be checked against rather than one that
 *    was merely asserted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { queryFor, scoreAll, withSuccessors } from './dup.js';

/**
 * A `b7e-<verb>` token in a bead's own title — the command name a skill-candidate bead
 * proposes, if it proposes one. Every `bc-dgx7.*` skill bead titles itself `b7e-<verb> —
 * <question>`, so the token is the first word of the title far more often than it is
 * buried in the body; matching the whole title (not just its first word) still catches
 * the beads that lead with prose instead.
 */
const COMMAND_RE = /\bb7e-[a-z][a-z0-9-]*\b/;
export function impliedCommandName(title) {
  const m = COMMAND_RE.exec(String(title || ''));
  return m ? m[0] : null;
}

/**
 * Is `name` already a real file under `dir`'s `bin/` — extensionless (the house shape
 * since `bc-jlop`/`bc-dgx7.2`) or `.js` (the shape a `beadcause-*` worker command still
 * takes)? Returns the path it found, or `null`. `existsSync` is injectable so a test can
 * fake a checkout without writing one to disk.
 */
export function binCollision(dir, name, { existsSync = fs.existsSync } = {}) {
  if (!dir || !name) return null;
  for (const candidate of [name, `${name}.js`]) {
    const p = path.join(dir, 'bin', candidate);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Labels that describe *this filing*, in *this* tracker — never carried to a new home.
 *
 * `held:<stamp>:<handle>` is a lease on the session that was reading the bead when it
 * held it, not a property of the bead; `filed-while:<bead>` names a `discovered-from`
 * edge that does not exist in the destination tracker (the source bead it points at is
 * not there either). Everything else — `agent-filed`, `complexity:*`, a topical label a
 * person added — is still true of the same bead in its new home and travels.
 */
const TRANSIENT_LABEL_RE = /^(held:|filed-while:)/;
export function carryLabels(row, { rehomedFrom } = {}) {
  const kept = (row?.labels || []).filter((l) => !TRANSIENT_LABEL_RE.test(l));
  const out = new Set(kept);
  if (rehomedFrom) out.add(`rehomed-from:${rehomedFrom}`);
  return [...out];
}

/**
 * Everything `Bd.create` needs to file `row` verbatim under `parent`, in the shape that
 * function's third positional argument takes.
 *
 * `body` is `row.description` untouched — no `withSurface`, no YAML round-trip, no
 * discovery-provenance rewrite — because the acceptance bar this exists to meet is that
 * the new bead's description diffs identical against `bd show <id> --json`'s, not that
 * it reads like a fresh finding. `unendorsed` is added only when the destination space
 * is not auto-endorsing, the same condition `bin/file.js` checks with
 * `autoEndorseAllowed` — a caller passes that answer in as `endorsed` rather than this
 * module reading `lib/spaces.js` itself, so a fixture with no real config can still
 * exercise both branches.
 */
export function carryFields(row, { parent, endorsed = false, rehomedFrom = '' } = {}) {
  const labels = carryLabels(row, { rehomedFrom });
  if (!endorsed && !labels.includes('unendorsed')) labels.push('unendorsed');
  return {
    title: row.title,
    body: row.description || '',
    type: row.issue_type || row.type || 'task',
    priority: row.priority ?? 2,
    acceptance: row.acceptance_criteria || row.acceptance || '',
    design: row.design || '',
    notes: row.notes || '',
    labels,
    parent,
  };
}

/** Floor a candidate has to clear to print — `lib/dup.js`'s own bar, restated so a
 * caller here does not have to import a second module just to default it. */
export const RIVAL_FLOOR = 1.6;

/**
 * Rank the destination tracker's own rows (open and closed) against the source bead's
 * text — the rival sweep half of the report, printed *before* anything is written so
 * "nothing covers this" is checked rather than assumed. `sourceRow` is not filtered out
 * of `destRows` by id — a fresh pair of fixture trackers never collide on one, and a
 * caller moving a bead back into a tracker it once left would want to see that.
 */
export function rivalSweep(sourceRow, destRows, { sourceDirs = [], destDirs = [], destWorkspace = null, limit = 8, floor = RIVAL_FLOOR } = {}) {
  const query = queryFor(sourceRow, { dirs: sourceDirs });
  const tagged = (destRows || []).map((r) => ({ ...r, workspace: r.workspace || destWorkspace }));
  let ranked = scoreAll(query, tagged, { dirs: destDirs, floor, closed: true });
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  ranked = withSuccessors(ranked.slice(0, limit), tagged);
  return ranked;
}
