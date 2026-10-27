/**
 * `verified-done` — a bead whose whole fix was already true, and the one actor that may close it.
 *
 * bc-xl7n.193. delmar/dv-8zav was fixed by config on 2026-09-12 (`pr.basePerWorkspace`), dv-geo1
 * already passed all four of its acceptance commands, and in both cases a worker window found
 * exactly that: nothing to build, nothing to push. `bin/deliver.js` rightly refuses a branch with
 * no commits, the "close it?" card was taken off Adam's desk as agent work, and the one remaining
 * move — `bd close` from the worker's own shell — is refused by the auto-mode permission
 * classifier as an external-system write. So the bead looped: advocate opens a window, the window
 * re-verifies the same fact, nobody can close. Three windows were spent on dv-8zav alone, and a
 * fourth worker, unable to close, invented a deliverable (bc-xl7n.194) so it would have something
 * to push.
 *
 * The answer Adam gave (2026-10-24) is the daemon-close option: the worker records a marker with
 * its evidence and the advocate, which is not a session behind the classifier, performs the close.
 * This file is both halves — `mark` for the worker's terminal (`bin/verified-done.js`) and
 * `sweepVerifiedDone` for the advocate tick — in the shape lib/farblock.js already established.
 *
 * ## What the marker is not
 *
 * It is not a way to skip a review of *code*. A bead with a diff goes through `bin/deliver.js` and
 * the queue as ever; this is only for the bead whose deliverable is already true, and the
 * evidence is the whole of the case — `mark` refuses to write without it, and the sweep refuses
 * to close a bead whose thread has no `VERIFIED_PREFIX` comment, so a bare label added by hand
 * closes nothing.
 *
 * ## Guards on the sweep
 *
 * - **Epics are never closed here.** An epic's ending has gates of its own (lib/epicdone.js).
 * - **Nothing is forced past a blocker.** The close goes through `Bd.close` without `--force`
 *   except over the *claim guard*, which is the one refusal that is certain to be stale: the
 *   claimant is the worker that wrote the marker and has stopped. Open children and live
 *   blockers are refused by bd, the bead stays open and marked, and the sweep says so in the log.
 * - **Closing is idempotent.** `Bd.listLabel` returns only live beads, so a closed one drops out.
 */

/** The marker. A fixed string, unlike `superseded-by:`/`blocked-by:`, so `bd list --label` finds it. */
export const VERIFIED_LABEL = 'verified-done';

/** The comment that carries the evidence; the sweep closes only a bead whose thread has one. */
export const VERIFIED_PREFIX = 'Verified done —';

/** Does this `bd --json` row carry the marker? */
export const isVerifiedDone = (issue) => (issue?.labels || []).some((l) => String(l).trim() === VERIFIED_LABEL);

/** The first line of whatever `bd` said, rather than `execFileSync`'s account of the exit code. */
const said = (err) => {
  const captured = String(err?.stderr || '').trim() || String(err?.stdout || '').trim();
  const line = (captured || String(err?.message ?? err ?? '')).split('\n').filter(Boolean)[0] || '';
  return /^Command failed:/.test(line.trim()) ? 'bd refused it and said why on the line above' : line.trim();
};

/** The sentence a marker's comment is written as. Evidence is trimmed and mandatory. */
export const verifiedComment = (evidence) => `${VERIFIED_PREFIX} ${String(evidence || '').trim()}`;

/**
 * Put the marker on: comment first, label second.
 *
 * The opposite order to farblock's `mark`, for the opposite reason: there the label is the
 * guarantee and goes first. Here the *comment* is what authorises the close, and a label with
 * no evidence behind it is exactly the half-written state the sweep must never act on — so the
 * evidence lands first, and a failure after it leaves a comment that closes nothing.
 *
 * `bd` is the synchronous `(argv) => stdout` runner `bin/supersede.js` uses. `row` is the bead
 * the caller already read. Never throws; returns `{ marked, reopened, alreadyMarked, refused, notes }`.
 * A bead left `in_progress` is set back to open for `sweepFarBlocks`'s reason: the marker is read
 * from the live list, and an unambiguous state is cheaper than reasoning about which statuses it covers.
 */
export function mark(bd, id, evidence, { row = null } = {}) {
  const out = { marked: false, reopened: false, alreadyMarked: false, refused: '', notes: [] };
  const beadId = String(id || '').trim();
  const text = String(evidence || '').trim();

  if (!beadId) return { ...out, refused: 'a bead has to be named' };
  if (!text) {
    return {
      ...out,
      refused:
        `pipe in the evidence that ${beadId}'s deliverable is already true — the command you ran and what it printed. ` +
        'It is the whole of the case for closing with no diff, and nothing was written.',
    };
  }
  if (!row) return { ...out, refused: `no bead ${beadId} here — nothing was written` };
  if (String(row.status || '').toLowerCase() === 'closed') return { ...out, refused: `${beadId} is already closed` };
  if (String(row.issue_type || row.type || '').toLowerCase() === 'epic') {
    return { ...out, refused: `${beadId} is an epic, and an epic's ending has gates this marker does not pass` };
  }
  if (isVerifiedDone(row)) {
    return { ...out, marked: true, alreadyMarked: true, notes: [`${beadId} already carries ${VERIFIED_LABEL} — nothing to do`] };
  }

  try {
    bd(['comment', beadId, verifiedComment(text)]);
  } catch (err) {
    return { ...out, refused: `could not record the evidence on ${beadId} — ${said(err)}. Nothing else was written.` };
  }
  try {
    bd(['label', 'add', beadId, VERIFIED_LABEL]);
    out.marked = true;
  } catch (err) {
    return { ...out, refused: `the evidence is on ${beadId} but the label did not land — ${said(err)}. Run \`bd label add ${beadId} ${VERIFIED_LABEL}\`.` };
  }
  if (String(row.status || '').toLowerCase() === 'in_progress') {
    try {
      bd(['update', beadId, '--status=open']);
      out.reopened = true;
    } catch (err) {
      out.notes.push(`${beadId} is still \`in_progress\` (${said(err)}); the sweep reads live beads, so this is only cosmetic.`);
    }
  }
  return out;
}

/**
 * Close every live bead carrying the marker whose thread holds the evidence. Returns what it
 * closed and what it deliberately left.
 *
 * The close reason names the evidence's first line, because `bd show` prints it months later
 * and "closed by the advocate on a worker's say-so" is something the next reader must be able
 * to tell from a merge.
 */
export async function sweepVerifiedDone(bd, ws) {
  const out = { ok: false, reason: '', checked: 0, closed: [], skipped: [] };

  let rows;
  try {
    rows = await bd.listVerifiedDone(ws);
  } catch (err) {
    out.reason = `could not read the marked beads — ${String(err.message || err).split('\n')[0]}`;
    return out;
  }

  out.ok = true;
  for (const row of rows || []) {
    if (!isVerifiedDone(row)) continue;
    out.checked += 1;

    if (String(row.issue_type || row.type || '').toLowerCase() === 'epic') {
      out.skipped.push({ id: row.id, why: 'it is an epic — an epic is closed by its own gates, not by a marker' });
      continue;
    }

    let comments;
    try {
      comments = (await bd.comments(ws, row.id)) || [];
    } catch (err) {
      out.skipped.push({ id: row.id, why: `cannot read its thread — ${String(err.message || err).split('\n')[0]}` });
      continue;
    }
    const evidence = [...comments]
      .reverse()
      .map((c) => String(c?.text ?? c?.body ?? '').trim())
      .find((t) => t.startsWith(VERIFIED_PREFIX));
    if (!evidence) {
      out.skipped.push({ id: row.id, why: `it carries ${VERIFIED_LABEL} but no "${VERIFIED_PREFIX}" comment — a label alone closes nothing` });
      continue;
    }

    const gist = evidence.slice(VERIFIED_PREFIX.length).trim().split('\n')[0].slice(0, 200);
    const reason = `Verified already done, no diff — closed by the advocate on a worker's marker. ${gist}`;
    try {
      await bd.close(ws, row.id, reason, { overClaim: true });
    } catch (err) {
      out.skipped.push({ id: row.id, why: `bd would not close it — ${String(err.message || err).split('\n')[0]}` });
      continue;
    }
    out.closed.push({ id: row.id, title: row.title || '' });
  }

  return out;
}

/** One line for the log and the monitor card. Empty when the sweep found nothing to say. */
export function describeVerifiedDone(result) {
  if (!result.ok) return result.reason ? `verified-done sweep skipped — ${result.reason}` : '';
  if (!result.closed.length) return '';
  const named = result.closed.map((c) => c.id).join(', ');
  return `closed ${result.closed.length} verified-done bead${result.closed.length === 1 ? '' : 's'} — ${named}`;
}
