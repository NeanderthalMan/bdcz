/**
 * Recovery testing — SOC 2 A1.3 — as a log of restores that goes red when one is owed.
 *
 * A1.3 is the criterion first reports most often take an exception on, and always for the
 * same reason: the organisation has backups, has a continuity plan, and has never restored
 * anything. **A backup that has never been restored is a control with no evidence**, and
 * the evidence an auditor samples is not the plan — it is a restore that was performed on a
 * date, by somebody, from a named backup, with a transcript of what happened.
 *
 * So this is not a policy and not a plan. It is the log of restores actually performed, and
 * the one computation that matters about it: **when the next one is due, and whether it is
 * already late.** A subject that has never logged a restore is `never`, which is red — the
 * same red as overdue, because "has not run" and "has not run lately" are the same finding
 * in an audit. That is the whole point of the bead that asked for this (bc-4r10.11): the
 * restore test is something that *fails* when it has not happened, rather than a line in a
 * plan that reads as satisfied until somebody asks for the transcript.
 *
 * ## Whose record it is
 *
 * The service organisation's, for the reason `lib/commitments.js` gives: the restore is of
 * the organisation's system, inside the organisation's boundary, so the log lives in its
 * compliance subject (`recovery` in the file `compliance.subjects` names) and is read
 * through {@link recovery}. Beadcause holds the rule and no restores of its own — it is
 * outside every subject's boundary (bc-228x), and a restore of this daemon's state would be
 * evidence about the wrong system.
 *
 * ## What one entry is
 *
 * `{ date, restored, from, by, transcript, outcome, changed? }`:
 *
 * - `restored` — the boundary component ids that were brought back. They have to be ids the
 *   subject's own boundary names as inside it; a restore of something the boundary never
 *   mentions is evidence about nothing the report covers, and is refused.
 * - `from` — which backup, in a sentence. "Restored the database" with no source is the
 *   entry that turns out, on sampling, to have been a re-run of a migration.
 * - `transcript` — where the record of the restore is kept: a ticket, a log, a document.
 *   The entry is the index; the transcript is the evidence, and the auditor will ask for it.
 * - `outcome` — `restored` or `failed`. **A failed restore is kept, never edited away**:
 *   it is the most valuable entry in the log, because A1.3 asks that the result *change
 *   the plan* where the plan did not work, so a failure must say in `changed` what changed
 *   (or which bead owns changing it). A failure does not count as a test for the due date —
 *   the component stays `failed` until a later restore of it succeeds.
 *
 * ## The cadence
 *
 * `intervalMonths` on the section, at most {@link MAX_INTERVAL_MONTHS}: an annual test is
 * the floor a SOC 2 auditor will accept for a Type II period, and a register that let it be
 * set longer would let a two-year gap read as current. Every component inside the boundary
 * of a kind in {@link RESTORABLE} is held to it separately — restoring the easy datastore
 * every year does not cover the hard one — and the overall state is the worst of them.
 *
 * ## The recurring bead
 *
 * {@link recurringBead} is the tracker half: the title, due date and body of the bead that
 * owns the next restore. `bin/recovery.js --bead` prints it as a `bd create --due` line for
 * the organisation's own tracker, so the obligation sits in the queue people actually work
 * from with a date on it, rather than only in a report somebody has to remember to run.
 *
 * Near-leaf: `lib/boundary.js` for the subject and its components, `lib/documents.js` for
 * the date arithmetic every expiring register here shares. No state written.
 */
import { boundaryFor, heldBy, inside, subjectFor } from './boundary.js';
import { WARN_DAYS, parseDate, reviewStatus } from './documents.js';

export { WARN_DAYS };

/** The longest the gap between two restores of one component may be set to. */
export const MAX_INTERVAL_MONTHS = 12;

/** What a restore came to. */
export const OUTCOMES = Object.freeze(['restored', 'failed']);

/** The boundary component kinds that hold something a restore brings back. */
export const RESTORABLE = Object.freeze(['datastore', 'host']);

/**
 * What a component's — or a whole subject's — recovery testing is, right now. The first
 * three are red: {@link RED}.
 */
export const STATES = Object.freeze(['never', 'failed', 'overdue', 'approaching', 'current']);

/** The states that are a finding rather than a warning. */
export const RED = Object.freeze(['never', 'failed', 'overdue']);

/** The SOC 2 criteria this register is evidence for. Literal ids — see test/recovery.mjs. */
export const CRITERIA = Object.freeze(['SOC2.A1.2', 'SOC2.A1.3']);

/** The shortest `from` or `changed` may be — long enough that a word is not an account. */
const SENTENCE_MIN = 20;

const text = (v) => String(v ?? '').trim();
const isoDay = (now) => now.toISOString().slice(0, 10);

/**
 * The subject's recovery section, or `null` with no subject or no section.
 *
 * `{ ownerRole, intervalMonths, tests }`. Absent is not an error — it is `never`, which is
 * what {@link status} says about it.
 */
export function recovery(org = heldBy()) {
  const section = subjectFor(org)?.recovery;
  return section && typeof section === 'object' && !Array.isArray(section) ? section : null;
}

/** The ids of the components a restore may name: inside the boundary, of a restorable kind. */
export function restorable(org = heldBy()) {
  const record = boundaryFor(org);
  return RESTORABLE.flatMap((kind) => inside(record, kind)).map((c) => String(c.id));
}

/* ---------------------------------------------------------- what must hold */

/**
 * Everything wrong with one restore entry, as sentences.
 *
 * `known` is the list of component ids the entry may name; omit it to check shape alone.
 */
export function testProblems(t, { known = null, now = new Date() } = {}) {
  const at = `restore ${text(t?.date) || '(undated)'}`;
  const problems = [];
  const day = parseDate(t?.date);
  if (day === null) problems.push(`${at}: \`date\` must be a real YYYY-MM-DD`);
  else if (day > Date.parse(isoDay(now))) problems.push(`${at}: \`date\` is ${t.date}, which has not happened yet`);

  const restored = Array.isArray(t?.restored) ? t.restored.map(text).filter(Boolean) : [];
  if (!restored.length) {
    problems.push(`${at}: \`restored\` must name at least one boundary component that was brought back`);
  }
  if (new Set(restored).size !== restored.length) problems.push(`${at}: \`restored\` names a component twice`);
  if (known) {
    for (const id of restored) {
      if (!known.includes(id)) {
        problems.push(
          `${at}: "${id}" is not a ${RESTORABLE.join(' or ')} the boundary puts inside — ` +
            'a restore of something the report does not cover is evidence about nothing'
        );
      }
    }
  }
  if (text(t?.from).length < SENTENCE_MIN) {
    problems.push(`${at}: \`from\` must say which backup was restored, in a sentence of at least ${SENTENCE_MIN} characters`);
  }
  if (!text(t?.by)) problems.push(`${at}: \`by\` must name who performed the restore`);
  if (!text(t?.transcript)) {
    problems.push(`${at}: \`transcript\` must say where the record of the restore is kept — it is what gets sampled`);
  }
  if (!OUTCOMES.includes(t?.outcome)) {
    problems.push(`${at}: \`outcome\` "${text(t?.outcome)}" is not one of ${OUTCOMES.join(', ')}`);
  } else if (t.outcome === 'failed' && text(t?.changed).length < SENTENCE_MIN) {
    problems.push(
      `${at}: a failed restore must say in \`changed\` what the plan changed, or which bead owns changing it — ` +
        'A1.3 asks that the test result change the plan where it did not work'
    );
  }
  return problems;
}

/** Everything wrong with a recovery section, as sentences. Empty means it is well-formed. */
export function sectionProblems(section, { known = null, now = new Date() } = {}) {
  if (section === null || section === undefined) return [];
  if (typeof section !== 'object' || Array.isArray(section)) return ['`recovery` must be an object with a `tests` list'];
  const problems = [];
  const months = Number(section.intervalMonths);
  if (!Number.isInteger(months) || months < 1 || months > MAX_INTERVAL_MONTHS) {
    problems.push(
      `\`intervalMonths\` must be a whole number from 1 to ${MAX_INTERVAL_MONTHS} — ` +
        'an annual restore is the longest gap an auditor will accept for a period'
    );
  }
  if (!text(section.ownerRole)) problems.push('`ownerRole` must name the function that owns the restore test');
  if (!Array.isArray(section.tests)) problems.push('`tests` must be a list — empty until the first restore is performed');
  else {
    for (const t of section.tests) problems.push(...testProblems(t, { known, now }));
    const dated = section.tests.map((t) => text(t?.date));
    if (dated.some((d, i) => i > 0 && d < dated[i - 1])) {
      problems.push('`tests` must be in date order, oldest first — the log is appended to, never reordered');
    }
  }
  return problems;
}

/** The subject's section checked against its own boundary. */
export const registerProblems = (org = heldBy(), now = new Date()) =>
  sectionProblems(recovery(org), { known: restorable(org), now });

/* ---------------------------------------------------------- where it stands */

/**
 * Where one component's recovery testing stands.
 *
 * `{ id, state, last, failed, due, days }` — `last` is the date of its last successful
 * restore, `failed` the date of a failure since then (or `null`), `due` when the next is
 * owed. `never` has no `due` of its own: it was due the day the criterion was elected.
 */
export function componentStatus(id, section, now = new Date()) {
  const tests = (Array.isArray(section?.tests) ? section.tests : []).filter(
    (t) => Array.isArray(t?.restored) && t.restored.map(text).includes(id)
  );
  const ok = tests.filter((t) => t.outcome === 'restored');
  const last = ok.length ? text(ok[ok.length - 1].date) : null;
  const failures = tests.filter((t) => t.outcome === 'failed' && (!last || text(t.date) >= last));
  const failed = failures.length ? text(failures[failures.length - 1].date) : null;
  if (!last) return { id, state: failed ? 'failed' : 'never', last: null, failed, due: null, days: null };
  const { due, days, state } = reviewStatus({ reviewedOn: last, reviewMonths: section.intervalMonths }, now);
  return { id, state: failed && failed > last ? 'failed' : state, last, failed: failed > last ? failed : null, due, days };
}

/** The worse of two statuses — {@link STATES} is in worst-first order. */
const worse = (a, b) => (STATES.indexOf(b.state) < STATES.indexOf(a.state) ? b : a);

/**
 * Where the subject's recovery testing stands, as a whole and per component.
 *
 * `{ state, red, components, due, ownerRole, intervalMonths }`. With no restorable
 * component enumerated inside the boundary, the log is judged as one — any successful
 * restore counts — and `components` is empty; that is a weaker claim, and the boundary's
 * own census already says the estate is unsurveyed when it is.
 */
export function status(org = heldBy(), now = new Date()) {
  const section = recovery(org);
  const ids = restorable(org);
  const components = ids.map((id) => componentStatus(id, section, now));
  const named = (Array.isArray(section?.tests) ? section.tests : []).flatMap((t) => (Array.isArray(t?.restored) ? t.restored : []));
  const judged = components.length ? components : [...new Set(named.map(text))].map((id) => componentStatus(id, section, now));
  const overall = judged.length ? judged.reduce(worse) : componentStatus('(none)', section, now);
  const dues = judged.map((c) => c.due).filter(Boolean).sort();
  return {
    state: overall.state,
    red: RED.includes(overall.state),
    components,
    due: overall.state === 'never' || overall.state === 'failed' ? isoDay(now) : dues[0] || null,
    ownerRole: text(section?.ownerRole) || null,
    intervalMonths: Number(section?.intervalMonths) || null,
  };
}

/** One line saying where it stands, for a CLI or a card. */
export function line(s) {
  const owner = s.ownerRole ? ` (${s.ownerRole})` : '';
  switch (s.state) {
    case 'never':
      return `no restore has ever been logged — a backup never restored is a control with no evidence${owner}`;
    case 'failed':
      return `the last restore failed and none has succeeded since — owed now${owner}`;
    case 'overdue':
      return `the next restore was due ${s.due} and has not been logged${owner}`;
    case 'approaching':
      return `the next restore is due ${s.due}, within ${WARN_DAYS} days${owner}`;
    default:
      return `current — the next restore is due ${s.due}${owner}`;
  }
}

/**
 * The bead that owns the next restore: `{ title, due, description }` for the organisation's
 * own tracker. The due date is the earliest one owed, and today when it is already late.
 */
export function recurringBead(org, s, now = new Date()) {
  const late = s.components.filter((c) => RED.includes(c.state)).map((c) => c.id);
  const due = s.red ? isoDay(now) : s.due || isoDay(now);
  const which = late.length ? late.join(', ') : s.components.map((c) => c.id).join(', ') || 'the in-scope stores';
  return {
    title: `Restore test (A1.3) for ${org} — restore ${which} from backup and log it`,
    due,
    description:
      `Perform a restore of ${which} from a real backup, keep the transcript, and append it to the ` +
      `\`recovery.tests\` log in ${org}'s compliance subject: date, restored, from, by, transcript, outcome. ` +
      'A failed restore is logged too, with what the plan changed. ' +
      `Current state: ${line(s)}.`,
  };
}
