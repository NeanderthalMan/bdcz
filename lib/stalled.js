/**
 * A workspace that opens no session while it is carrying open work — bc-dhayi.
 *
 * Every other way an advocate can fail to dispatch says so on its own card. A paused one
 * says `paused`, a quiet one says `quiet — watching, not launching`, a full one says `at
 * its limit of 2 session(s)`, and every hold list in lib/advocate.js has a sentence of its
 * own on the note and a pill on the console beside it. Those are all *states*, and a state
 * is reported by being looked at.
 *
 * What none of them report is a **duration**. The tick note is one line, rewritten every
 * thirty seconds and never compared with the one before it, so a workspace that has been
 * saying the same thing since last month is indistinguishable from one that started
 * saying it a minute ago. The bead this module exists for names the shape exactly: the
 * only report of a queue every bead of which had been retired by `maxAttemptsPerBead` was
 * a suffix on that line, and for 27 days it sat beside a clause that read healthy and
 * nobody noticed. Nothing was broken enough to throw, so lib/errors.js never saw it;
 * nothing changed, so lib/sync.js never woke a phone about it. The daemon was working
 * perfectly and the workspace was dead.
 *
 * **So this is a clock, and per lib/incident.js the bead is the notification.** There is
 * no alerting layer here to add a rule to and there is deliberately not going to be one:
 * a P0 in the tracker lands on the inbox the phone is already polling, carries its own
 * history, and is the same object an auditor reads as the record that the outage was
 * detected. Detection and recording are one act — which is the whole of what
 * `SOC2.CC7.2` asks for, and further than a monitoring system whose own silence has to be
 * monitored ever gets.
 *
 * ## The clock has to stop for the silence we asked for
 *
 * Silence is only evidence when the advocate was free to break it. An advocate is
 * deliberately silent while it is paused, inside its space's quiet hours, inside the
 * nightly maintenance window, or switched off and draining — and an observer instance is
 * silent by construction, because it never launches anything at all. A detector that
 * counted those hours would file a P0 every morning against a workspace whose quiet hours
 * are longer than the window, which is exactly the false alarm that gets a detector
 * switched off. So `dispatching` is the caller's answer to "was it free to launch", and
 * a tick where it is false does not accumulate silence.
 *
 * **Capacity is not one of those, and that is a judgement rather than an omission.**
 * An advocate at `maxWorkers`, or one held behind `globalMaxWorkers`, is not being told
 * to stay quiet — it is busy, and a busy advocate still launches, because a window here
 * times out at two hours. Six continuous hours of a full slot table over a non-empty
 * queue means the windows are hung, which is worth a P0 rather than an exemption. The
 * body names how many windows are open precisely so the reader can tell the two apart at
 * a glance without opening anything.
 *
 * ## Why the reading is derived and not stored
 *
 * There is no record in CONFIG_DIR, for lib/redbase.js's reason and lib/sweepcard.js's
 * scar: eight of thirteen sweep cards outlived the record that was supposed to find them
 * again, after which nothing could amend or close them. The condition is "this advocate
 * has been silent for longer than the window **and** there is an open bead about it",
 * both read this tick — the second off the `bd export` index the tick already has warm.
 * A daemon that restarts, a record that is lost and a bead somebody retitled all degrade
 * the same way: the next tick files a fresh one rather than losing the ability to say
 * anything at all.
 *
 * **Which makes the title load-bearing.** {@link stallTitle} is the key, it carries no
 * number, and that is deliberate — a title naming the queue length or the hours would be
 * a different string every tick and therefore a new bead every tick. Retitle one by hand
 * and this stops recognising it, files a second, and reports against that instead, so the
 * body says so in the bead itself.
 *
 * ## Why the bead is `human` and never work
 *
 * lib/redbase.js files its hold as ordinary P0 work on the argument that an advocate
 * picking it up is a second door onto the fix. The opposite is true here, twice over.
 *
 * The bead is a report about *dispatch being dead*, and the one agent that would work it
 * is the one that is dead — so a queueable bead would be filed into a queue that by
 * construction cannot reach it. Worse, if it somehow could: opening a window on it would
 * move the launch clock, the next tick would close the bead as cleared, and a session
 * would be left working a closed bead. And worst, the quiet one — a queueable bead is a
 * bead *in the queue*, so filing it would make `queue > 0` true for ever and the stall
 * could never clear on its own even after the real work drained.
 *
 * `human` (in `QUEUE_EXCLUDED`, lib/endorse.js) answers all three, and it closes
 * lib/redbase.js's other deadlock for free: nothing works under this bead, so nothing
 * files `--from` it, so it can never grow the open child that would make it unclosable.
 * `card` (lib/card.js) says the rest — its whole life is a report and a close, and
 * nothing is ever built for it.
 */

import { CARD_LABEL } from './card.js';

/** The class label, and what makes the search cheap. `bd list --label stalled-queue`. */
export const STALL_LABEL = 'stalled-queue';

/** The same string lib/finishedepic.js and lib/notinmain.js name locally. See the header for why it is here. */
const HUMAN_LABEL = 'human';

/**
 * Priority zero, and it is not a preference.
 *
 * A workspace that dispatches nothing is every bead in that workspace not being worked,
 * so a P1 would sort below the work it is reporting the absence of. It is also what makes
 * the bead a *root* — `isRoot` in lib/underroot.js is `isP0 || isEpic` — which is what
 * puts a parentless card on the phone at all (`p0board.unhomed`, bc-i7tw).
 */
export const STALL_PRIORITY = 0;

/** Six hours. Long enough that a slow morning is not an incident; short enough to be a day's warning, not a month's. */
export const DEFAULT_STALL_HOURS = 6;

const clean = (v) => String(v ?? '').trim();
const line = (err) => clean(err?.message || err).split('\n')[0];

/** Ids, deduped and in the order given — a list for a person, not a set for a machine. */
const ids = (list) => [...new Set((list || []).map((x) => clean(x?.id ?? x)).filter(Boolean))];

/** The first few of a list and a remainder, so the body can be read on a phone. */
function named(list, cap = 6) {
  const all = ids(list);
  if (!all.length) return '';
  const shown = all.slice(0, cap);
  return `${shown.join(', ')}${all.length > shown.length ? `, and ${all.length - shown.length} more` : ''}`;
}

/**
 * A duration a person reads rather than a number of seconds.
 *
 * Rounded down and never below one hour, because the window is hours and a bead that says
 * "5 hours" when the threshold was 6 reads as a detector that fired early.
 */
export function describeSilence(seconds) {
  const secs = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(secs / 3600);
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  if (hours >= 2) return `${hours} hours`;
  return '1 hour';
}

/**
 * The bead's title, which is also the key this whole module is found by.
 *
 * One per workspace, because one advocate is one workspace however many checkouts it
 * spans — the thing that has stopped is the *dispatcher*, not a repository, and a
 * Northwind-shaped workspace of forty checkouts has exactly one of those.
 *
 * No number in it, ever. See the header.
 */
export function stallTitle(workspace) {
  return `The ${clean(workspace) || 'this'} advocate has opened no session while work waits in its queue`;
}

/** Is this row one of these? The label, which is the half a retitle cannot take off. */
export function isStallBead(issue) {
  return (issue?.labels || []).some((l) => clean(l).toLowerCase() === STALL_LABEL);
}

/**
 * The open stall bead for one workspace, out of whatever rows are in hand.
 *
 * Takes rows rather than a tracker so the caller can hand it the `bd.graph` index the
 * advocate tick already built — one `bd export` per workspace per tick, carrying `title`,
 * `labels` and `status` and therefore carrying this question's answer for free.
 *
 * Closed rows are skipped rather than remembered, which is the self-healing half: a stall
 * bead somebody closed by hand is gone, and if the workspace is still stalled the next
 * tick files a fresh one rather than reporting against a bead nobody can see.
 */
export function findStall(rows, { workspace } = {}) {
  const want = stallTitle(workspace);
  const list = rows instanceof Map ? [...rows.values()] : Array.isArray(rows) ? rows : [];
  for (const row of list) {
    if (clean(row?.status).toLowerCase() === 'closed') continue;
    if (!isStallBead(row)) continue;
    if (clean(row?.title) !== want) continue;
    return row;
  }
  return null;
}

/**
 * What this tick should do about one workspace — the whole decision, as a pure function
 * of a clock, a queue length and what the tracker holds.
 *
 * Five acts, and the three that write nothing are as deliberate as the two that do:
 *
 * - **`file`** — silent past the window, with work waiting, and nothing open about it.
 *   The only act that starts anything.
 * - **`hold`** — still stalled, and the bead is already there. Nothing to write. This is
 *   the steady state and it must stay silent: a tick every thirty seconds that commented
 *   or amended would turn a bad fortnight into an unreadable bead.
 * - **`clear`** — no longer stalled and the bead is still open. Close it, and say which
 *   of the three endings it was.
 * - **`none`** — the ordinary tick, which is almost every tick.
 * - **`unknown`** — the tracker could not be read, so "is there already a bead about
 *   this" has no answer. Decides nothing, for lib/redbase.js's reason: read as "no bead"
 *   it files a second P0 over an outage, read as "a bead" it would close one somebody is
 *   reading.
 *
 * **An empty queue is never a stall**, which is the acceptance criterion written as a
 * predicate: a workspace with nothing to do that does nothing is a workspace working
 * correctly, and it is the overwhelmingly common shape of a quiet tracker.
 */
export function stallVerdict({
  queue = 0,
  silentSeconds = 0,
  windowSeconds = DEFAULT_STALL_HOURS * 3600,
  dispatching = true,
  known = true,
  open = null,
} = {}) {
  if (!known) return { stalled: false, act: 'unknown', why: '' };

  const waiting = Math.max(0, Number(queue) || 0);
  const window = Math.max(0, Number(windowSeconds) || 0);
  const silent = Math.max(0, Number(silentSeconds) || 0);

  // A window of zero is off, not "everything is stalled". The knob is `stallHours`, and
  // the reading a person expects from setting it to nought is silence.
  if (!window) return { stalled: false, act: open ? 'clear' : 'none', why: 'switchedOff' };

  const stalled = Boolean(waiting) && dispatching && silent >= window;
  if (stalled) return { stalled: true, act: open ? 'hold' : 'file', why: '' };

  // Which of the three endings it was, for the close reason. Ordered by what a reader
  // most wants to hear first: a session opened is the thing the bead asked for.
  const why = !dispatching ? 'held' : !waiting ? 'empty' : 'launched';
  return { stalled: false, act: open ? 'clear' : 'none', why };
}

/**
 * The bead. P0, typed as a bug, and written for whoever opens it on a phone knowing
 * nothing except that a card appeared.
 *
 * Four things it has to say that nothing else will:
 *
 * 1. **Which advocate**, by name — there are several, and the card is the only place the
 *    name and the silence appear together.
 * 2. **How long, and how much is waiting.** The two numbers that make it an incident
 *    rather than a status.
 * 3. **The retired ids.** The single likeliest cause, and the one the tick note buried:
 *    a bead at `maxAttemptsPerBead` is out of the queue for good and nothing re-arms it
 *    on its own. Naming three or four of them turns this from a puzzle into a tap on
 *    Forget attempts.
 * 4. **How many windows are open right now**, which is what tells "dispatch is dead"
 *    apart from "every window it has is hung" without opening anything else.
 *
 * The stamp is UTC with an explicit `Z`, for lib/notinmain.js's reason: a reading taken at
 * an instant sits in a tracker for days, and every card and brief around it talks ADT.
 */
export function stallBody({
  workspace,
  queue = 0,
  retired = [],
  working = 0,
  silentSeconds = 0,
  windowSeconds = DEFAULT_STALL_HOURS * 3600,
  at = '',
} = {}) {
  const name = clean(workspace) || 'this workspace';
  const gone = ids(retired);
  const list = named(retired);
  return [
    `The **${name}** advocate has not opened a session in **${describeSilence(silentSeconds)}**, and ` +
      `**${queue}** bead${queue === 1 ? '' : 's'} ${queue === 1 ? 'is' : 'are'} waiting in its queue. It was not ` +
      `paused, in quiet hours, in the maintenance window or switched off for any of that time — it was free to ` +
      `launch and launched nothing.`,
    '',
    `**As of ${at || 'this reading'}:** ${queue} ready · ${working} window${working === 1 ? '' : 's'} open · ` +
      `silent for ${describeSilence(silentSeconds)} against a ${describeSilence(windowSeconds)} window.`,
    '',
    gone.length
      ? `**${gone.length} bead${gone.length === 1 ? ' has' : 's have'} been given up on** after ` +
        `\`maxAttemptsPerBead\` windows ended without delivering: ${list}. Nothing re-arms those on its own — ` +
        `a bead at the cap is out of the queue for good until somebody presses **Forget attempts** or re-arms ` +
        `it from its own card. A queue every bead of which is retired reads, on the tick note, exactly like a ` +
        `queue that is being worked; that is bc-dhayi, and it is the first thing to check here.`
      : `**Nothing in the queue has been given up on**, so \`maxAttemptsPerBead\` is not the cause — which ` +
        `rules out the usual one. Look next at whether the windows it has open are hung (${working} of them), ` +
        `at the hold list on its card, and at the daemon log for the last thing this advocate said.`,
    '',
    `**Why this is a bead rather than an alert.** A stalled workspace breaks nothing and changes nothing, so ` +
      `no exception is thrown and no notification fires — the tick note goes on being rewritten every thirty ` +
      `seconds with the same sentence, which is why one sat unnoticed for 27 days. The bead *is* the ` +
      `notification here (lib/incident.js), and the clock is what nothing else was keeping.`,
    '',
    `**This bead closes itself.** The next tick on which this advocate opens a session — or its queue empties, ` +
      `or you pause it — closes it with the reason. Nothing has to be cleared by hand. Do not retitle it: this ` +
      `bead is found by its exact title, and a retitled one is a report nothing can close and a second bead on ` +
      `the next tick.`,
  ]
    .filter((l) => l !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** What the bead is done when it is done. About the dispatcher, deliberately not about a diff. */
export function stallAcceptance(workspace) {
  const name = clean(workspace) || 'this workspace';
  return (
    `The ${name} advocate opens a session again — or its queue empties, or it is deliberately paused. The tick ` +
    `that sees any of those closes this bead itself, so nothing here is finished by a commit.`
  );
}

/** The close reason, naming which of the three endings it was. A bare "resolved" is unauditable. */
export function clearReason(workspace, why = 'launched', at = '') {
  const name = clean(workspace) || 'this workspace';
  const stamp = at ? ` as of ${at}` : '';
  if (why === 'empty') {
    return (
      `The ${name} advocate's queue is empty${stamp} — there is no longer any waiting work for it to be silent ` +
      `about. Closed by beadcause; this bead is a standing condition, and the condition is over.`
    );
  }
  if (why === 'held') {
    return (
      `The ${name} advocate is no longer free to launch${stamp} — it is paused, in quiet hours, in the nightly ` +
      `maintenance window, or switched off. Silence it was told to keep is not a stall. Closed by beadcause.`
    );
  }
  if (why === 'switchedOff') {
    return (
      `The stall detector has been switched off (\`advocates.stallHours\` is 0)${stamp}, so nothing is measuring ` +
      `this any more and an open bead about it would go stale. Closed by beadcause.`
    );
  }
  return (
    `The ${name} advocate has opened a session again${stamp}. Closed by beadcause — this bead is a standing ` +
    `condition, and the condition is over.`
  );
}

/**
 * What is said on the bead when the stall ended but `bd` would not let it close.
 *
 * Same argument as lib/redbase.js's `stuckReason`: the log line the caller also gets is
 * real and nobody tails it, and a card that still says "no sessions" over a workspace that
 * is visibly dispatching is worse than no card at all — it is the one that teaches a
 * reader to stop believing these.
 */
export function stuckReason(workspace, why = 'launched', at = '', err) {
  return (
    `${clearReason(workspace, why, at)} The close was refused, so this bead is still open: ${line(err)}. It will ` +
    `be tried again on the next tick; if it has open children, close or reparent them first.`
  );
}

/** The bead, as `Bd.create` takes one. Built here so the daemon's filer is three lines. */
export function stallIssue(spec = {}) {
  return {
    title: stallTitle(spec.workspace),
    type: 'bug',
    priority: STALL_PRIORITY,
    body: stallBody(spec),
    acceptance: stallAcceptance(spec.workspace),
    /**
     * No `unendorsed`, for lib/redbase.js's reason and one of its own: this is a reading
     * the daemon took about itself rather than a discovery an agent would like permission
     * to pursue, and holding it behind a tap would put a report about nothing being
     * dispatched behind the endorsement queue that nothing dispatches from.
     *
     * `human` and `card` are load-bearing rather than cosmetic — see the header.
     */
    labels: [STALL_LABEL, HUMAN_LABEL, CARD_LABEL],
  };
}

/**
 * One workspace, one tick: read, decide, and do the one thing the decision asks for.
 *
 * Everything effectful arrives as an argument, for lib/redbase.js's reason: what is under
 * test is a procedure that files a P0 into a live tracker, and a test has to be able to
 * drive every branch of it without one. lib/advocate.js is then a handful of adapters
 * onto doors that already exist there.
 *
 * - `rows()` — the workspace's beads, for `findStall`, or `null` for a tracker that could
 *   not be asked. The tick's own `bd export` index carries exactly this.
 * - `file(issue)` — `bd.create`, answering the new id.
 * - `close(id, reason)` — the close that ends the report.
 * - `comment(id, text)` — optional, and called only when `close` was refused.
 * - `settle()` — whatever cached `rows()` needs telling that it just changed. Without it
 *   a P0 filed thirty seconds ago is invisible to the next tick and a second is filed on
 *   top of it.
 * - `announce(id, act)` — the bus event, so a parked phone finds out. On the change only,
 *   for lib/sync.js's reason: a stall that has lasted a week must not wake a phone every
 *   tick. `act` is `'file'` or `'clear'`, because the two are opposite news and a caller
 *   that had to infer which from the return value would be reading it after the event.
 *
 * Returns `{ act, id, stalled }`.
 */
export async function sweepStall(spec = {}, {
  rows,
  file,
  close,
  comment = null,
  settle = null,
  announce = null,
  log = () => {},
} = {}) {
  const at = new Date().toISOString();
  const known = await rows().catch(() => null);
  const open = known ? findStall(known, spec) : null;
  const verdict = stallVerdict({ ...spec, known: Boolean(known), open });
  const name = clean(spec.workspace) || 'this workspace';

  if (verdict.act === 'unknown' || verdict.act === 'none') {
    return { act: verdict.act, id: '', stalled: verdict.stalled };
  }

  if (verdict.act === 'hold') return { act: 'hold', id: open?.id || '', stalled: true };

  if (verdict.act === 'file') {
    let id = '';
    try {
      id = await file(stallIssue({ ...spec, at }));
    } catch (err) {
      log(`could not file the P0 for a stalled ${name} — ${line(err)}`);
      return { act: 'unknown', id: '', stalled: true };
    }
    log(
      `${name} has opened no session in ${describeSilence(spec.silentSeconds)} with ${spec.queue} ready — filed ${id}`
    );
    if (settle) await settle().catch(() => {});
    if (announce) announce(id, 'file');
    return { act: 'file', id, stalled: true };
  }

  // `clear`.
  try {
    await close(open.id, clearReason(spec.workspace, verdict.why, at));
  } catch (err) {
    log(`${name} is dispatching again but ${open.id} would not close — ${line(err)}`);
    if (comment) await comment(open.id, stuckReason(spec.workspace, verdict.why, at, err)).catch(() => {});
    return { act: 'stuck', id: open.id, stalled: false };
  }
  log(`${name} is dispatching again — closed ${open.id}`);
  if (settle) await settle().catch(() => {});
  if (announce) announce(open.id, 'clear');
  return { act: 'clear', id: open.id, stalled: false };
}
