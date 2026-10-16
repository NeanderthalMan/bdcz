/**
 * The gap assessment — every elected criterion, with a state nobody asserted and an owner.
 *
 * A readiness assessment sold by a firm is this exercise with an invoice attached. What it
 * produces is one line per criterion saying whether a control exists, whether that control
 * produces something an auditor could sample, and who closes the difference. Doing it in
 * the tracker first makes the engagement cheap, or unnecessary.
 *
 * ## The state is computed, and that is the whole design
 *
 * bc-4r10.4 names three states, and each is a sentence about two things rather than one:
 * **met** is a control that exists *and* produces evidence, **partial** is one of the two,
 * **absent** is neither. So a record here does not carry a state. It carries the two
 * halves — {@link assessment}'s `control` and `evidence`, each a sentence or `null` — and
 * {@link stateOf} derives the word from them.
 *
 * That is not tidiness. A hand-written state is the field that goes green first and stays
 * green: somebody writes `met` in a planning meeting, the control is descoped a month
 * later, and the row still says met because nothing about deleting a control touches it.
 * Deriving it means **`met` cannot be written without naming both halves**, and removing
 * either one moves the state on its own. `lib/policies.js` makes the same argument about a
 * review date and `lib/documents.js` made it first.
 *
 * ## Absent has two meanings and conflating them is the expensive mistake
 *
 * "We looked and there is no control" and "nobody has enumerated the population this would
 * be tested against" are both absences, and only the first is a finding. The second is an
 * instruction to go and survey something, and a gap assessment that renders them the same
 * hands a remediation plan to the wrong people.
 *
 * So every record names the census kinds its criterion is tested against — `population` —
 * and {@link confidenceOf} reads those against `lib/boundary.js`'s census: any kind the
 * boundary records as `partial` makes the row **provisional**, and a row tested against
 * documents and management rather than an enumerated estate is **assessed**. Derived, so
 * closing a census in `lib/boundary.js` upgrades rows here without an edit, and letting one
 * go partial downgrades them the same way.
 *
 * ## No criterion silently absent
 *
 * The failure this bead is named for: a criterion with no control is a row that says so and
 * somebody sees it; a criterion missing from the list is invisible, and a report is written
 * without it. A hand-kept list cannot refuse that, so the list is not hand-kept — the
 * corpus enumerates, and {@link assessmentProblems} requires exactly one record per elected
 * criterion, no record for an unelected one, and no duplicates. Every command that reads
 * the assessment runs it first, so a criterion added to `lib/controls.js` and not assessed
 * in a subject is a refusal naming the criterion rather than a blank in a report.
 *
 * Election has the same hole one level up: a category that is simply not mentioned is
 * indistinguishable from one nobody considered. {@link notElected} records the ones that
 * were declined, with the decision that declined them, so the absence of eighteen privacy
 * criteria is an answer rather than an omission.
 *
 * ## What it does not carry, and where those come from instead
 *
 * **The control ids that claim to satisfy a criterion are not written here.** bc-4r10.1
 * settled that an edge has exactly one home: crosswalks are declared on controls pointing
 * at criteria and `satisfiedBy()` is the computed inverse. {@link claims} asks the corpus.
 * A second hand-written mapping is how a criterion comes to cite a control that stopped
 * covering it. **Which policy is the documented answer** is `lib/policies.js`'s, and
 * {@link documentedBy} asks it. Both are joins performed at the moment of asking.
 *
 * That makes this a joining module rather than a fourth register — it imports the three
 * leaves the way `lib/systemdescription.js` does, and for the same reason: the leaves
 * deliberately do not import each other, so anything needing two of them is a file of its
 * own. Nothing here writes; there is no git and no network.
 *
 * ## The rows are the subject's, and the rules are beadcause's
 *
 * One row per elected criterion is a statement about a particular organisation's system —
 * what it has described, what it could show an auditor, where the missing half is held — so
 * the rows live in that organisation's compliance subject (`assessment.rows` in the file
 * `compliance.subjects` names; see `lib/boundary.js`). The considered-and-declined
 * categories travel with them (`assessment.notElected`), because declining a category is a
 * decision that organisation made. What stays here is everything that makes a row
 * trustworthy: the derived state, the confidence read off the census, the refusal of a
 * missing criterion, a duplicate, an unelected one, or a `met` resting on an unsurveyed
 * population. An install with no subject has no rows, and every reader answers empty.
 *
 * A subject used to be refused at import, when it shipped compiled in. It is refused by
 * {@link assessmentProblems} now, which every command that reads the assessment runs and
 * prints before rendering anything — the same bar, moved to where the data arrives.
 *
 * ## Zero met is a legitimate finding, and a comfortable number is not
 *
 * A first assessment is usually almost entirely absent, and that is what a readiness call
 * would charge to say. Writing a comfortable number instead produces a register that passes
 * every check and is false in the only way that matters — which is why `met` cannot be
 * typed, only derived.
 */
import { CENSUS_KINDS, boundaryFor, heldBy, subjectFor } from './boundary.js';
import { byFramework, control as corpusRecord, isControl, satisfiedBy } from './controls.js';
import { ELECTED, ROLES, categoryOf, isElected, policiesFor } from './policies.js';

/**
 * Re-exported rather than restated.
 *
 * `ELECTED` and `ROLES` have one home and it is `lib/policies.js`; a second copy here is
 * two answers to "which categories are in scope" and they would disagree within a quarter.
 * `heldBy` names the organisation whose boundary and policy set this is assessed against.
 */
export { ELECTED, heldBy, ROLES };

/**
 * What settled the two questions the shape of this register rests on, for one subject.
 *
 * `subject` is the bead the boundary was decided on and `categories` the one the election
 * was; both are the subject's record, read rather than restated. `null` fields when there
 * is no subject.
 */
export function decidedBy(org = heldBy()) {
  const subject = subjectFor(org);
  return Object.freeze({
    subject: text(subject?.boundary?.decidedBy) || null,
    categories: text(subject?.assessment?.decidedBy?.categories) || null,
  });
}

/** The three states bc-4r10.4 names. Derived by {@link stateOf}, never written down. */
export const STATES = Object.freeze(['met', 'partial', 'absent']);

/** Whether the row rests on a population somebody has enumerated. See {@link confidenceOf}. */
export const CONFIDENCE = Object.freeze(['assessed', 'provisional']);

/** The shortest a `why` may be. It is the only part of a row a person actually reads. */
const WHY_MIN = 40;

/** The Trust Services categories, all five — what an election has to account for. */
export const CATEGORIES = Object.freeze(['CC', 'A', 'C', 'PI', 'P']);

/* ------------------------------------------------------------------ the register */

/**
 * The considered-and-declined categories, from the subject.
 *
 * A category nobody mentions and a category somebody declined look identical in a register
 * that only lists what is in scope. Each entry is `{ category, label, decision, disposition,
 * why }` — `disposition` is `deferred` or `declined` — so "why is there nothing about
 * privacy in here" has an answer that is not a shrug. Empty with no subject.
 */
export function notElected(org = heldBy()) {
  const list = subjectFor(org)?.assessment?.notElected;
  return Array.isArray(list) ? list : Object.freeze([]);
}

/**
 * One record per elected criterion — what exists, what could be sampled, and whose it is —
 * from the subject. Empty with no subject.
 *
 * Each row is `{ id, owner, population, control, evidence, why, bears, held }`:
 *
 * `control` is a control **the service organisation operates over the in-scope system** —
 * described, approved, and somebody's. Not a control over the tooling that builds it: the
 * boundary carves that out, and reading beadcause's own access control as CC6.1 for the
 * described system is the misstatement `lib/servicescope.js` refuses one layer down.
 *
 * `evidence` is an artefact an auditor could sample **today**. Not one that would exist if
 * the control did; a control with no evidence is exactly the half-state `partial` is for.
 *
 * `bears` is the third thing, and it is the one that stops the register lying in the other
 * direction: something that touches the criterion without satisfying it. Beadcause usually
 * appears there, which is the honest description of a carved-out system that an auditor
 * will still ask for records out of.
 *
 * `held` is where the answer lives when it does not live here. A gap without an address is
 * a shrug with a schema — `lib/boundary.js`'s census makes the same demand of itself.
 *
 * `population` names the census kinds the criterion is tested against. There is no `state`
 * and no `confidence`: both are derived below, and a row carrying either is refused.
 *
 * Adding a row is not enough to add a criterion and removing one is not enough to drop it:
 * the corpus decides which criteria exist, and {@link assessmentProblems} refuses any
 * disagreement.
 */
export function assessment(org = heldBy()) {
  const rows = subjectFor(org)?.assessment?.rows;
  return Array.isArray(rows) ? rows : Object.freeze([]);
}

/* ------------------------------------------------------------------- deriving */

const text = (v) => String(v ?? '').trim();

/**
 * The state, from the two halves rather than from a field somebody typed.
 *
 * A control that produces evidence is met; one of the two is partial; neither is absent.
 * That is bc-4r10.4's definition verbatim, and computing it is what stops a row claiming
 * met after the control it named was descoped.
 */
export function stateOf(record) {
  const hasControl = Boolean(text(record?.control));
  const hasEvidence = Boolean(text(record?.evidence));
  if (hasControl && hasEvidence) return 'met';
  if (hasControl || hasEvidence) return 'partial';
  return 'absent';
}

/**
 * Whether the row rests on a population somebody has actually enumerated.
 *
 * Read out of `lib/boundary.js`'s census rather than asserted here, so surveying the estate
 * upgrades rows without an edit and letting a census lapse downgrades them the same way. A
 * row with an empty `population` is tested against documents and management rather than an
 * estate, so it is assessed — there is nothing left to survey before believing it.
 */
export function confidenceOf(record, boundary = boundaryFor(heldBy())) {
  const census = boundary?.census || {};
  const kinds = Array.isArray(record?.population) ? record.population : [];
  return kinds.some((k) => census[k]?.state === 'partial') ? 'provisional' : 'assessed';
}

/** The control ids that claim to satisfy this criterion, asked of the corpus. */
export const claims = (id) => satisfiedBy(id);

/** The policies that are the documented answer for this criterion, asked of the policy set. */
export const documentedBy = (id) => policiesFor(id);

/** The elected criteria the corpus holds, in id order. The list this register must match. */
export const electedCriteria = () =>
  byFramework('SOC2')
    .filter((r) => r.kind === 'criterion' && isElected(r.id))
    .map((r) => r.id)
    .sort();

/* ----------------------------------------------------------------- validating */

/** A repository path named inside a sentence, so a check can open it. */
const PATH_RE = /\b(?:lib|bin|test|scripts)\/[a-z0-9][a-z0-9-]*\.(?:js|mjs)\b/g;

/** Every module path a record names, across all three of its prose fields. */
export function pathsNamed(record) {
  const found = new Set();
  for (const field of ['control', 'evidence', 'bears', 'held']) {
    for (const hit of text(record?.[field]).matchAll(PATH_RE)) found.add(hit[0]);
  }
  return [...found].sort();
}

/** Everything wrong with one record, as sentences. */
export function recordProblems(record, { boundary = boundaryFor(heldBy()) } = {}) {
  const problems = [];
  const id = text(record?.id);
  const at = id || '(no id)';

  if (!id) problems.push('a record has no criterion id');
  else if (!isControl(id)) problems.push(`${at}: not an id the control corpus mints`);
  else if (corpusRecord(id)?.kind !== 'criterion') problems.push(`${at}: is a ${corpusRecord(id)?.kind}, not a criterion`);
  else if (!categoryOf(id)) problems.push(`${at}: not a SOC 2 Trust Services criterion`);
  else if (!isElected(id)) {
    problems.push(`${at}: category ${categoryOf(id)} is not elected — elect it in lib/policies.js or drop the row`);
  }

  if (!ROLES.includes(text(record?.owner))) {
    problems.push(`${at}: owner "${text(record?.owner)}" is not one of ${ROLES.join(', ')}`);
  }

  const kinds = record?.population;
  if (!Array.isArray(kinds)) problems.push(`${at}: population must be an array of census kinds, even when empty`);
  else {
    for (const k of kinds) {
      if (!CENSUS_KINDS.includes(k)) problems.push(`${at}: population names "${k}", which is not a boundary census kind`);
    }
    if (new Set(kinds).size !== kinds.length) problems.push(`${at}: population repeats a census kind`);
  }

  const why = text(record?.why);
  if (why.length < WHY_MIN) problems.push(`${at}: why is ${why.length} characters; a state nobody explained is a state nobody can argue with`);

  for (const field of ['control', 'evidence', 'bears', 'held']) {
    const v = record?.[field];
    if (v !== null && v !== undefined && typeof v !== 'string') problems.push(`${at}: ${field} must be a sentence or null`);
    else if (typeof v === 'string' && !text(v)) problems.push(`${at}: ${field} is an empty string — use null, which means something`);
  }

  // Derived fields may not be written down. A typed `state` is the field that goes green
  // first and stays green; a typed `claims` is a second crosswalk beside lib/controls.js.
  for (const field of ['state', 'confidence', 'claims']) {
    if (record && typeof record === 'object' && field in record) {
      problems.push(`${at}: carries \`${field}\`, which is derived here and never written in a row`);
    }
  }

  const state = stateOf(record);
  if (state === 'met' && text(record?.held)) {
    problems.push(`${at}: met, and still names somewhere the answer is held — a met criterion has its answer here`);
  }
  if (state !== 'met' && !text(record?.held)) {
    problems.push(`${at}: ${state}, and does not say where the answer is held — a gap without an address is a shrug`);
  }
  if (state === 'met' && confidenceOf(record, boundary) === 'provisional') {
    problems.push(
      `${at}: met against a population nobody has enumerated — the boundary census for ` +
        `${(record.population || []).filter((k) => boundary?.census?.[k]?.state === 'partial').join(', ')} is partial`
    );
  }

  return problems;
}

/**
 * Everything wrong with the register as a whole — and the check the bead is named for.
 *
 * One record per elected criterion, no record for an unelected one, no duplicates. Run
 * against the corpus rather than against a list kept beside it, because the failure worth
 * refusing is the criterion nobody wrote a row for: a hand-kept list agrees with itself by
 * construction and is silent about exactly the thing that went missing.
 */
export function assessmentProblems(
  register = assessment(),
  { boundary = boundaryFor(heldBy()), declinedCategories = notElected(text(boundary?.organisation) || heldBy()) } = {}
) {
  const problems = [];
  if (!boundary) problems.push('no boundary is loaded — the assessment has nothing to be scoped by');
  if (!Array.isArray(register)) return [...problems, 'the assessment is a list of rows, one per elected criterion'];

  const seen = new Set();
  for (const record of register) {
    problems.push(...recordProblems(record, { boundary }));
    const id = text(record?.id);
    if (!id) continue;
    if (seen.has(id)) problems.push(`${id}: assessed twice`);
    seen.add(id);
  }

  for (const id of electedCriteria()) {
    if (!seen.has(id)) {
      problems.push(`${id}: elected and not assessed — ${corpusRecord(id)?.title || 'no title'}`);
    }
  }

  const declinedList = Array.isArray(declinedCategories) ? declinedCategories : [];
  for (const c of declinedList) problems.push(...declinedProblems(c));
  const declined = new Set(declinedList.map((c) => text(c?.category)));
  for (const category of CATEGORIES) {
    if (!ELECTED.includes(category) && !declined.has(category)) {
      problems.push(`category ${category} is neither elected nor recorded as declined — that is the silent absence`);
    }
    if (ELECTED.includes(category) && declined.has(category)) {
      problems.push(`category ${category} is both elected and recorded as declined — one of the two is wrong`);
    }
  }

  return problems;
}

/** What a declined category may be recorded as. */
export const DECLINED_DISPOSITIONS = Object.freeze(['deferred', 'declined']);

/** Everything wrong with one considered-and-declined category, as sentences. */
export function declinedProblems(c) {
  const problems = [];
  const at = `declined ${text(c?.category) || '?'}`;
  if (!CATEGORIES.includes(text(c?.category))) problems.push(`${at}: category must be one of ${CATEGORIES.join(', ')}`);
  if (!text(c?.label)) problems.push(`${at}: needs a label a person can read`);
  if (!text(c?.decision)) problems.push(`${at}: needs the \`decision\` that declined it — a decline with no decision is an omission`);
  if (!DECLINED_DISPOSITIONS.includes(text(c?.disposition))) {
    problems.push(`${at}: disposition must be one of ${DECLINED_DISPOSITIONS.join(', ')}`);
  }
  if (text(c?.why).length < WHY_MIN) problems.push(`${at}: why is too short to be the reason a category is out of the report`);
  return problems;
}

/* -------------------------------------------------------------------- reading */

/**
 * The register, joined to everything derived from it.
 *
 * One computation behind both the readable rendering and `--json`, which is what stops the
 * artefact a person reads and the payload a check gates on from disagreeing.
 */
export function assess(register = assessment(), boundary = boundaryFor(heldBy())) {
  return register.map((record) => ({
    ...record,
    title: corpusRecord(record.id)?.title || null,
    category: categoryOf(record.id),
    state: stateOf(record),
    confidence: confidenceOf(record, boundary),
    claims: claims(record.id),
    documentedBy: documentedBy(record.id).map((p) => p.id),
  }));
}

/** The rows in one state, joined. */
export const byState = (state, register = assessment(), boundary = boundaryFor(heldBy())) =>
  assess(register, boundary).filter((r) => r.state === text(state));

/** Everything that is not met — the remediation list, in the order a report is written. */
export const gaps = (register = assessment(), boundary = boundaryFor(heldBy())) =>
  assess(register, boundary).filter((r) => r.state !== 'met');

/** What each owning function is carrying, worst state first. */
export function byOwner(register = assessment(), boundary = boundaryFor(heldBy())) {
  const rank = { absent: 0, partial: 1, met: 2 };
  const out = new Map(ROLES.map((r) => [r, []]));
  for (const row of assess(register, boundary)) out.get(row.owner)?.push(row);
  for (const rows of out.values()) rows.sort((a, b) => rank[a.state] - rank[b.state] || a.id.localeCompare(b.id));
  return out;
}

/** Counts by state and by confidence, for a header or a check. */
export function counts(register = assessment(), boundary = boundaryFor(heldBy())) {
  const rows = assess(register, boundary);
  const tally = (key, keys) => Object.fromEntries(keys.map((k) => [k, rows.filter((r) => r[key] === k).length]));
  return { total: rows.length, state: tally('state', STATES), confidence: tally('confidence', CONFIDENCE) };
}

/**
 * One line, for a log or a check.
 *
 * The provisional count is in it deliberately. A summary reading "0 met, 1 partial, 37
 * absent" and stopping is the summary that sends somebody to write thirty-seven controls
 * when twenty-one of the rows are waiting on a survey instead.
 */
export function summarise(register = assessment(), boundary = boundaryFor(heldBy())) {
  const c = counts(register, boundary);
  return (
    `${text(boundary?.serviceOrganisation) || 'no subject'} · ${text(boundary?.system) || 'no system recorded'} · ` +
    `${c.total} elected criteri${c.total === 1 ? 'on' : 'a'} · ` +
    `${c.state.met} met, ${c.state.partial} partial, ${c.state.absent} absent · ` +
    `${c.confidence.provisional} provisional`
  );
}

/**
 * One criterion as the bead bc-4r10.4 asks for, ready for `bin/file.js`.
 *
 * A projection rather than a filing, and the distinction is the point. Thirty-eight beads
 * typed by hand drift from the register within a quarter, and a criterion quietly dropped
 * from the tracker is the exact failure this module exists to refuse — the register is what
 * cannot lose one, because the corpus enumerates it. So the beads are emitted from here,
 * carry their state, their owner, the control ids that claim them and what would be
 * sampled, and can be regenerated when any of those change.
 */
export function beadFor(row) {
  const claimed = row.claims?.length ? row.claims.join(', ') : 'nothing in the corpus';
  const docs = row.documentedBy?.length ? row.documentedBy.join(', ') : 'no policy';
  return {
    title: `${row.id} ${row.title} — ${row.state}${row.confidence === 'provisional' ? ' (provisional)' : ''}`,
    type: 'task',
    priority: 2,
    complexity: 'medium',
    description:
      `${row.why}\n\n` +
      `State: ${row.state}, ${row.confidence}. Owner: ${row.owner}.\n` +
      `Control today: ${row.control || 'none described'}\n` +
      `Evidence an auditor could sample today: ${row.evidence || 'none'}\n` +
      `Claimed by, in the control corpus: ${claimed}\n` +
      `Documented answer, in the policy set: ${docs}\n` +
      (row.bears ? `Bears on it without satisfying it: ${row.bears}\n` : '') +
      (row.held ? `Held: ${row.held}\n` : ''),
    acceptance:
      `A control over ${row.id} is described, approved and owned, and an artefact exists that an auditor ` +
      'could sample for the period — at which point lib/gapassessment.js records both halves and the state ' +
      'computes to met.',
    rationale: 'Generated from lib/gapassessment.js by beadcause-gaps, on bc-4r10.4.',
  };
}
