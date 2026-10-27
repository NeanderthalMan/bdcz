/**
 * The default answer to a question nobody answered.
 *
 * Two holds in this repo park a bead in front of Adam and wait: `unendorsed`
 * (lib/endorse.js) asks *should an hour of unattended agent be spent on this?*, and
 * `superseded-by:` (lib/superseded.js), once its original closes, asks *does this go
 * with it?*. Both are correct, both are cheap to raise, and neither of them has an
 * ending when the answer never comes. On 2026-09-19 that cost was measurable: 83 beads
 * held for endorsement, 78 of them untouched for more than a month, against an
 * endorsement queue that draws `QUEUE_MAX` 60 rows — so the oldest third of the pile was
 * not merely unanswered, it was off the bottom of the only screen that shows it. Seven
 * superseded cards had been in the inbox between three and five weeks.
 *
 * That is not a backlog of decisions. It is a decision already made, by silence, with
 * nothing written down — and the cost of leaving it unwritten is paid twice: the queue
 * is unreadable because the answered-by-silence beads are still in it, and a bead
 * somebody *would* have said yes to is buried among eighty they would not.
 *
 * So the silence gets written down. A hold older than its threshold lapses: the bead is
 * closed, with a close reason naming the hold and the age, and a comment saying plainly
 * that nobody turned it down — it simply went unread — and what to do if it still
 * matters. Nothing here decides that the work is bad.
 *
 * ## Three properties this leans on, and it is not safe without all three
 *
 * 1. **It is reversible, and the bead says so.** A lapse is `bd close`, not a delete.
 *    The bead, its description, its comment thread and its edges are all still there,
 *    and reopening it puts it back exactly where it was. The comment says which command
 *    does that, because the person reading it will be reading it on a phone weeks later.
 * 2. **It is announced.** Every lapse is a line in the daemon log and an event on the
 *    advocate's stream, and `describeLapsed` is what the monitor card says. A sweep that
 *    closed eighty beads quietly would be indistinguishable from a tracker that had lost
 *    them.
 * 3. **It is capped per sweep.** `MAX_PER_SWEEP` below. Not for the tracker's sake — bd
 *    would take all eighty — but because a backlog that drains over an hour of ticks is
 *    one somebody can watch going past and stop; one that vanishes in a single tick is
 *    only ever seen afterwards.
 *
 * ## Why the clock is `updated_at` and not `created_at`
 *
 * The bead this came from (bc-iaju1.4) says "lapse unendorsed >30d", and the obvious
 * reading is age since filing. It is the wrong one: a bead that was adjusted, commented
 * on, re-prioritised or argued about last week has been *looked at*, and the whole
 * premise here is that nothing has looked at it. bd stamps `updated_at` on every write,
 * so any attention at all — including an `adjust` from the endorsement queue that
 * deliberately left the marker on — pushes the deadline out. The two readings differ by
 * five beads in the pile that prompted this, and by rather more in the one case where
 * getting it wrong would be worst: a bead somebody is actively arguing about.
 *
 * ## The superseded half, and its disagreement with lib/superseded.js
 *
 * That file argues at length that closing a duplicate is Adam's call and not an agent's,
 * and it is right: "these two beads are the same job" is a judgement a worker made in
 * passing, and closing on it unasked would be the daemon acting on an agent's say-so.
 * Nothing below weakens that. The lapse fires only on a bead that has **already been
 * asked about** — the card is in the inbox, the ask block is on the bead, the comment
 * saying so is on the thread — and only once that card has been sitting there for
 * `SUPERSEDE_DAYS`. The judgement was put to Adam and went unanswered for a fortnight;
 * what closes the bead is the silence, not the marker.
 *
 * It is a separate switch (`lapseSuperseded`) from the endorsement half for exactly that
 * reason: it is the more arguable of the two, and somebody who wants the endorsement
 * backlog drained and the duplicates left alone should not have to give up both.
 *
 * ## The one thing a lapse can do that it is not asked to
 *
 * Closing a bead clears any `blocks` edge pointing out of it, so a bead parked behind a
 * lapsed hold becomes ready. That is not guarded against and should not be: the bead it
 * was waiting on has been decided, and leaving it parked behind a decision that has been
 * made is the state this file exists to end. It is worth knowing about rather than
 * discovering, so: on the backlog that prompted this, two of the 78 due beads had any
 * dependent at all, and on inspection both were `discovered-from`, `parent-child` and
 * `relates-to` edges — `dependent_count` counts every edge type, not just the blocking
 * one — so nothing in that pile would have been unparked. A workspace where that is not
 * true is one where the unparking is the point.
 *
 * ## What is deliberately not here
 *
 * **Delivery cards.** bc-iaju1.4 asks for those too — "close delivery bead when its PR
 * merges" — and lib/landed.js already does it, in the only way that is honest: on a
 * `MERGED` state read from GitHub, which is a fact rather than an age. Dry-run against
 * the live tracker on 2026-09-19 it named the three stale cards then outstanding
 * (bc-cjzvu #12, bc-fupxh #15, bc-p88t0 #23) and would have closed all three. A second
 * mechanism lapsing them on a clock would close cards whose pull request is still open
 * and still wanted — which is the one delivery card that must never close by itself.
 *
 * Nothing here merges, pushes, deploys or deletes anything. It reads the tracker and
 * writes two lines to each bead it closes, and every failure is a returned sentence
 * rather than a throw: the sweep is a courtesy on top of the advocate's tick and may not
 * take the tick down.
 */
import { UNENDORSED, PROMOTE_LABEL } from './endorse.js';
import { SHIP_LABEL } from './shipbead.js';
import { CONTAINER } from './container.js';
import { supersededBy, parseSupersedeTarget } from './superseded.js';

/**
 * How long a hold may go unread before its silence counts as an answer.
 *
 * Thirty days is bc-iaju1.4's number and it is the right order of magnitude for the
 * endorsement queue: the screen is checked from a phone, in bursts, and a fortnight of
 * not opening it is an ordinary fortnight. A month is not.
 *
 * The superseded card is shorter because it is a narrower question that has already been
 * put — it carries a `decision` block with two buttons on it, and answering is one tap
 * rather than a paragraph of reading. Both are overridable from config; these are what
 * the advocate passes when nothing says otherwise.
 */
export const LAPSE_DAYS = 30;
export const SUPERSEDE_DAYS = 14;

/**
 * How many beads one sweep may close.
 *
 * Property 3 in the header. Twenty per sweep at the advocate's hourly interval drains
 * the 83-bead pile that prompted this over about four hours of ticks, each batch
 * announced on its own line — which is slow enough to notice and stop, and fast enough
 * that the queue is readable the same day.
 */
export const MAX_PER_SWEEP = 20;

/**
 * What a lapse's close reason starts with.
 *
 * Two prefixes, fixed, for lib/verdict.js's `REVOKED_PREFIX` reason: `bd list --status
 * closed` should read as a class of thing rather than as eighty differently-worded
 * closes, and these are the closes where the *work never happened* — the one property
 * somebody auditing a closed tracker most needs to be able to see at a glance.
 *
 * Deliberately not `REVOKED_PREFIX` itself. A revoke is Adam saying no; this is nobody
 * saying anything, and a tracker that spelled the two the same way would have lost the
 * only evidence that the second thing is happening at all.
 */
export const LAPSED_PREFIX = 'Lapsed before endorsement';
export const SUPERSEDE_LAPSED_PREFIX = 'Lapsed as a duplicate';

/** Days between two instants, as a real number — no rounding, so a threshold is exact. */
export const daysBetween = (then, now) => (now - new Date(then).getTime()) / 86400000;

/**
 * When this bead was last touched, as milliseconds — or `null` if it cannot be told.
 *
 * `null` is the important half and it means *do not lapse this*. A row whose timestamps
 * are missing or unparseable is a row this cannot date, and the safe reading of "I
 * cannot tell how old this is" is never "old enough to close".
 */
export function touchedAt(issue) {
  for (const field of ['updated_at', 'created_at']) {
    const raw = issue?.[field];
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

const labelsOf = (issue) => (issue?.labels || []).map((l) => String(l));
const has = (issue, label) => labelsOf(issue).includes(label);

/**
 * Which beads the endorsement half will not touch, whatever their age.
 *
 * Every one of these is a bead whose `unendorsed` marker is doing a job other than
 * asking a question, so there is no silence to read:
 *
 * - **`ship`** — lib/release.js files one per merged pull request, and the marker there
 *   means "nothing may open a session on this". Only a deploy closes a ship bead
 *   (lib/shipbead.js), and lapsing one would file a deploy as decided-against.
 * - **`promote`** — same shape, one file along (lib/promote.js): the marker keeps it out
 *   of the advocate's queue because the release agent carries it, not because anybody is
 *   being asked.
 * - **`container`** — not work at all, the standing root other beads are filed under.
 * - **`human`** — a *different* question is already in front of Adam about this bead,
 *   with its own card and its own answer. Lapsing it would close that question by a
 *   clock it was never told about. The superseded half below is the one deliberate
 *   exception, and it owns its own beads for that reason.
 * - **a `superseded-by:` marker** — the other half of this file, on its own clock.
 *
 * Status matters too and is checked by the caller: only `open` beads lapse. bd refuses
 * to close a blocked bead, and an `in_progress` one has a window on it right now.
 */
export const LAPSE_EXCLUDED = [SHIP_LABEL, PROMOTE_LABEL, CONTAINER, 'human'];

/**
 * Is this row an endorsement hold old enough to lapse?
 *
 * Pure, and takes `now` so a suite can put the clock where it needs it. Everything the
 * decision rests on is on the row `bd list` already returned — no `bd show`, no
 * comments — which is what keeps this half of the sweep one tracker call however big the
 * backlog is.
 */
export function lapsable(issue, { now = Date.now(), days = LAPSE_DAYS } = {}) {
  if (!onlyHeld(issue)) return false;
  const at = touchedAt(issue);
  if (at === null) return false;
  return daysBetween(at, now) >= days;
}

/**
 * The same test with the clock taken out: is this row an endorsement hold at all?
 *
 * Its own export because the sweep counts *examined* holds separately from *lapsed*
 * ones — "85 held, 78 past the threshold" is what somebody tuning `lapseDays` needs to
 * read, and a `checked` built from `lapsable` could only ever report the second number.
 */
export function onlyHeld(issue) {
  if (!issue?.id) return false;
  if (String(issue.status || '').toLowerCase() !== 'open') return false;
  if (!has(issue, UNENDORSED)) return false;
  if (LAPSE_EXCLUDED.some((l) => has(issue, l))) return false;
  return !supersededBy(issue);
}

/**
 * Is this row a superseded duplicate whose card has been up long enough to lapse?
 *
 * The `human` label is required rather than merely allowed: it is the evidence that
 * lib/superseded.js actually raised the card. A bead carrying the marker and no card is
 * one nobody has been asked about, and closing it would be precisely the thing that
 * file refuses to do. How long the card has been up is not on the row — it is the date
 * of the ask comment — so this is the cheap half of the test and `askedAt` is the rest.
 */
export function supersedeLapsable(issue) {
  if (!issue?.id) return false;
  if (String(issue.status || '').toLowerCase() !== 'open') return false;
  if (!has(issue, 'human')) return false;
  return Boolean(supersededBy(issue));
}

/**
 * The sentence lib/superseded.js leaves on the thread when it raises the card.
 *
 * Matched on its stable half — `has closed. Asking whether this goes with it` — rather
 * than on the whole line, because the marker it interpolates varies per bead. This is
 * the clock the superseded half runs on: the bead's own `updated_at` would be reset by
 * the sweep's own writes, so it dates the ask rather than the bead.
 */
const ASK_COMMENT = /has closed\. asking whether this goes with it/i;

/** When the card went up, in milliseconds — or `null` if no ask comment can be found. */
export function askedAt(comments) {
  for (const c of comments || []) {
    const text = String(c?.text || c?.body || c?.comment || '');
    if (!ASK_COMMENT.test(text)) continue;
    const raw = c?.created_at || c?.createdAt || c?.timestamp || c?.at;
    const t = raw ? new Date(raw).getTime() : NaN;
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/** A whole-day count for prose, floored — "31 days" reads better than "31.4 days". */
const wholeDays = (n) => Math.max(0, Math.floor(n));

/** The close reason for an endorsement hold that ran out. */
export const lapseReason = (age) =>
  `${LAPSED_PREFIX} — ${wholeDays(age)} days with nobody deciding either way`;

/** The close reason for a duplicate whose card went unanswered. */
export const supersedeLapseReason = (original, age) =>
  `${SUPERSEDE_LAPSED_PREFIX} of ${original} — the card was up ${wholeDays(age)} days unanswered`;

/**
 * The comment left on a lapsed endorsement hold.
 *
 * Written for somebody reading it weeks later with no memory of the bead, and the two
 * things it has to say are that **this is not a refusal** and that **it is one command
 * to undo**. A close with only a reason line would read, correctly, as "beadcause
 * decided against this" — which is the one thing that did not happen.
 */
export const lapseNote = (id, age, days) =>
  `Closed automatically: this was filed ${wholeDays(age)} days ago and has been waiting for an ` +
  `endorsement ever since. Nothing here decided against it — the endorsement queue simply never ` +
  `reached it, and a hold older than ${wholeDays(days)} days lapses so the queue stays a list of ` +
  `decisions still worth making.\n\n` +
  `**If this still matters, it comes straight back:** \`bd update ${id} --status open\` reopens ` +
  `it with its description, thread and edges intact, and endorsing it then puts it in the queue as ` +
  `ordinary work. Nothing about the bead was changed on the way out.`;

/** The comment left on a lapsed duplicate. */
export const supersedeLapseNote = (id, original, age) =>
  `Closed automatically as a duplicate of ${original}. The card asking whether this goes with ` +
  `${original} has been in the inbox ${wholeDays(age)} days with no answer, and the default answer ` +
  `to that card is the one a worker already reached when it marked this bead.\n\n` +
  `**If they are not the same job**, reopen it — \`bd update ${id} --status open\` — and take ` +
  `the \`superseded-by:\` label off; it is the label rather than the close that holds a bead out ` +
  `of every queue.`;

/**
 * Close one bead and say why — asking bd first whether the close is even available.
 *
 * Three acts in a fixed order, and each position is load-bearing.
 *
 * **The gate is asked before anything is written**, and this is the one that had to be
 * learned rather than designed. A bead bd will not close — an open blocker, an epic with
 * live children, a bead waiting on an approval — is not a one-off failure here: the
 * candidate set is rebuilt from scratch on every sweep, so the same bead is offered
 * again next hour and every hour after that. Comment-then-fail would leave it
 * accumulating one identical comment per sweep, for ever, on a bead nobody is looking at.
 * `closeGate` is one `bd show` and it turns that into a skip with bd's own sentence on it.
 * A gate that cannot be read comes back `null`, which means *try the close anyway* — not
 * being able to ask is not the same as being refused.
 *
 * **Then the comment, then the close.** A bead closed with no explanation on it is the
 * worst outcome available here — it is the state that reads as the tracker having lost
 * something — whereas a comment on a bead that then failed to close costs a stray
 * sentence. With the gate asked first, the only way that happens is a genuinely
 * transient failure, which is the case worth spending a sentence on.
 */
async function closeWithNote(bd, ws, id, { note, reason }) {
  const gate = await bd.closeGate(ws, id, { reason });
  if (gate) throw new Error(`bd will not close it — ${gate.reason}`);
  try {
    await bd.comment(ws, id, note);
  } catch {
    // The close is the act and the comment is the courtesy. A tracker that took one and
    // not the other should still close: a missing sentence costs context, and a bead
    // left open costs the whole point of the sweep.
  }
  await bd.close(ws, id, reason);
}

/**
 * Lapse what has gone unanswered — see the header for what that means and does not mean.
 *
 * One `bd list` for the whole workspace, then one `bd comments` per superseded candidate
 * (there are never many: the candidate has to carry both the marker and a card), then a
 * `bd show` and two writes per bead the cap lets through. The per-bead cost is bounded by
 * `max` rather than by the size of the backlog, which is the other thing the cap buys.
 *
 * **`checked` and `remaining` count different things and both are deliberate.** `checked`
 * is every bead examined — every hold either half looked at, whatever its age — because
 * "85 held, 78 of them past the threshold" is the sentence somebody tuning `lapseDays`
 * needs. `remaining` is only the beads that *would have lapsed* and did not because the
 * cap ran out, because it appears in the log as "N left for the next sweep" and a number
 * that also counted the fresh ones would be a promise the next sweep does not keep.
 */
export async function sweepLapsed(
  bd,
  ws,
  {
    now = Date.now(),
    days = LAPSE_DAYS,
    supersedeDays = SUPERSEDE_DAYS,
    max = MAX_PER_SWEEP,
    superseded = true,
    workspaces = null,
  } = {}
) {
  const out = { ok: false, reason: '', checked: 0, lapsed: [], skipped: [], remaining: 0 };

  let rows;
  try {
    rows = await bd.listLive(ws);
  } catch (err) {
    out.reason = `could not read the tracker — ${String(err.message || err).split('\n')[0]}`;
    return out;
  }

  out.ok = true;
  const knownWorkspaces = (workspaces || []).map((w) => w.name);
  const budget = Math.max(0, Number(max) || 0);

  // Oldest first, and it is not cosmetic: the cap means a sweep closes a slice of the
  // backlog rather than all of it, and the slice worth taking is the one furthest past
  // the threshold. Newest-first would leave the thirty-nine-day beads for last on every
  // sweep of a backlog that keeps growing at the front.
  const endorsementHolds = (rows || [])
    .filter((r) => onlyHeld(r))
    .sort((a, b) => (touchedAt(a) || 0) - (touchedAt(b) || 0));
  out.checked += endorsementHolds.length;

  for (const row of endorsementHolds) {
    if (!lapsable(row, { now, days })) continue;
    if (out.lapsed.length >= budget) {
      out.remaining += 1;
      continue;
    }
    const age = daysBetween(touchedAt(row), now);
    try {
      await closeWithNote(bd, ws, row.id, { note: lapseNote(row.id, age, days), reason: lapseReason(age) });
    } catch (err) {
      out.skipped.push({ id: row.id, why: `could not close it — ${String(err.message || err).split('\n')[0]}` });
      continue;
    }
    out.lapsed.push({ id: row.id, title: row.title || '', kind: 'endorsement', days: wholeDays(age) });
  }

  if (!superseded) return out;

  const duplicates = (rows || []).filter(supersedeLapsable);
  out.checked += duplicates.length;

  for (const row of duplicates) {
    const raw = supersededBy(row);
    const target = parseSupersedeTarget(raw, knownWorkspaces);
    if (target.reason) {
      // Not a skip worth reporting: lib/superseded.js's own sweep already says this
      // about the same bead every ten minutes, and saying it twice an hour as well
      // would bury the lines that are only ever printed once.
      continue;
    }

    let comments;
    try {
      comments = await bd.comments(ws, row.id);
    } catch (err) {
      out.skipped.push({ id: row.id, why: `cannot read its thread — ${String(err.message || err).split('\n')[0]}` });
      continue;
    }
    const asked = askedAt(comments);
    if (asked === null) {
      // The bead carries the marker and a `human` label, but nothing on the thread says
      // this sweep's sibling raised the card — so the card in the inbox may be about
      // something else entirely, and its silence is not an answer to this question.
      out.skipped.push({ id: row.id, why: `nothing on its thread says the ${raw} card was ever raised` });
      continue;
    }
    const age = daysBetween(asked, now);
    if (age < supersedeDays) continue;
    // The budget is spent *here*, after the card has been proved due, rather than at the
    // top of the loop: `remaining` is read as "left for the next sweep", and counting a
    // card raised yesterday towards it would be a promise the next sweep does not keep.
    if (out.lapsed.length >= budget) {
      out.remaining += 1;
      continue;
    }

    try {
      await closeWithNote(bd, ws, row.id, {
        note: supersedeLapseNote(row.id, raw, age),
        reason: supersedeLapseReason(raw, age),
      });
    } catch (err) {
      out.skipped.push({ id: row.id, why: `could not close it — ${String(err.message || err).split('\n')[0]}` });
      continue;
    }
    out.lapsed.push({ id: row.id, title: row.title || '', kind: 'superseded', original: raw, days: wholeDays(age) });
  }

  return out;
}

/** One line for the log and the monitor card. Empty when the sweep found nothing to say. */
export function describeLapsed(result) {
  if (!result.ok) return result.reason ? `lapse sweep skipped — ${result.reason}` : '';
  if (!result.lapsed.length) return '';
  const named = result.lapsed
    .map((l) => (l.kind === 'superseded' ? `${l.id} (duplicate of ${l.original}, ${l.days}d)` : `${l.id} (${l.days}d)`))
    .join(', ');
  const more = result.remaining ? `, ${result.remaining} left for the next sweep` : '';
  return `lapsed ${result.lapsed.length} unanswered hold${result.lapsed.length === 1 ? '' : 's'}${more} — ${named}`;
}
