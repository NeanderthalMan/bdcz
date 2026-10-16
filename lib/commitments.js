/**
 * The principal service commitments — DC 200's own words — as a register that expires,
 * not a paragraph waiting to be drafted.
 *
 * A SOC 2 description has to state what the service organisation has committed to its
 * user entities — availability, confidentiality, processing and privacy commitments — and
 * the system requirements those commitments impose. **The commitment is not the control.**
 * A control that keeps a promise is evidence the promise is kept; it is not the promise,
 * and a promise inferred from a control is one nobody actually made. The only place a real
 * commitment lives is the document that made it: the executed agreement, the SLA, the
 * privacy notice.
 *
 * Those documents are not in this repository, and a subject's gap assessment will usually
 * say so against `SOC2.CC2.3`: a system description cannot state service commitments that
 * nobody has read out of a contract. So this is a register of the *categories* of
 * commitment a platform makes, each carrying who it is made to and what it is measured
 * against, and — following `lib/policies.js`'s split exactly — `owed` until somebody reads
 * the actual agreement and transcribes what it says. Writing plausible SLA numbers here
 * instead would produce a register that reads as complete and describes a promise nobody
 * made, which is the one failure this whole layer exists to refuse.
 *
 * ## Two categories, not four
 *
 * DC 200 names four kinds — availability, confidentiality, processing integrity, privacy —
 * and this register carries two. `ELECTED` in `lib/policies.js` is `['CC', 'A', 'C']`;
 * processing integrity and privacy are not elected (`bc-yfgo`), so a processing or privacy
 * commitment would describe criteria this report does not cover. Electing either category
 * is meant to make {@link coverage}'s `unclaimed` non-empty until this register grows to
 * meet it — the same red `lib/policies.js` and `test/controls.mjs` already use.
 *
 * ## Who it is held by, and who it is owed to
 *
 * The service organisation's, for the reason `lib/policies.js` gives {@link heldBy}: a
 * commitment is made by the organisation, not by this daemon. The entries are the
 * organisation's record too — which user entities each is owed to, and eventually what the
 * agreement says — so they live in its compliance subject (`commitments` in the file
 * `compliance.subjects` names) and are read through {@link commitments}. An install with no
 * subject has no commitments, and every read below answers empty.
 *
 * A commitment is owed to user entities **by the ids the subject's own boundary gives
 * them** — {@link userEntityIds} reads them out of `lib/boundary.js` rather than keeping a
 * second list, so a commitment owed to an entity the boundary never named is a refusal
 * rather than a promise to nobody. That is the one neighbour this file imports.
 *
 * ## The seam it feeds
 *
 * `lib/systemdescription.js` accepts a supplied record for the `commitments` section
 * (`SUPPLIABLE`), held to its own bar: every entry names a `statement` and a `source`. This
 * file is that register, and {@link suppliable} is the conversion — it hands back only the
 * entries that are actually `adopted`, in the shape the description wants, so a
 * still-`owed` category contributes nothing rather than a placeholder sentence. Nobody
 * calls this from `lib/systemdescription.js` itself: the CLI (`bin/description.js`) is
 * where the record gets assembled, the same way a caller with a real record would, so
 * `lib/systemdescription.js`'s own import list — pinned in its suite — never has to grow
 * to know this file exists.
 *
 * Near-leaf, like the register it mirrors: `lib/documents.js`, node builtins, and
 * `lib/boundary.js` for whose commitments these are and to whom. No state written.
 */
import { boundaryFor, heldBy, subjectFor, userEntities } from './boundary.js';
import { MAX_REVIEW_MONTHS, WARN_DAYS, parseDate, reviewStatus } from './documents.js';

export { MAX_REVIEW_MONTHS, WARN_DAYS };

/** The organisation whose commitments these are — the one loaded subject — or `null`. */
export { heldBy };

/**
 * The user entities a commitment may be owed to: the ids the subject's boundary names in
 * `userEntities`, read rather than restated. Empty with no subject.
 */
export const userEntityIds = (org = heldBy()) => userEntities(boundaryFor(org)).map((e) => String(e.id));

/**
 * The commitment categories the subject records, or an empty list with no subject.
 *
 * Each is `{ id, title, aim, toUserEntities, criteria, ownerRole, reviewMonths, adoption,
 * owes }` while owed, and gains {@link ADOPTION_FIELDS} — and loses `owes` — once somebody
 * reads the agreement and transcribes what it says.
 */
export function commitments(org = heldBy()) {
  const list = subjectFor(org)?.commitments;
  return Array.isArray(list) ? list : Object.freeze([]);
}

/**
 * The DC 200 commitment categories this register covers.
 *
 * Not all four: processing integrity and privacy are not elected. See the header.
 */
export const ELECTED = Object.freeze(['A', 'C']);

/** Whether a commitment is a recorded promise, or still owed. */
export const ADOPTION = Object.freeze(['adopted', 'owed']);

/** What a commitment is, right now — `owed`, or how its review date stands. */
export const STATES = Object.freeze(['owed', 'current', 'approaching', 'overdue']);

/** The functions a commitment can be owned by — see `lib/policies.js`'s `ROLES` for why. */
export const ROLES = Object.freeze([
  'executive sponsor',
  'security lead',
  'engineering lead',
  'operations lead',
  'people lead',
]);

/** A SOC 2 criterion id, held to the shape the corpus holds its own to. */
const CRITERION_RE = /^SOC2\.(CC|PI|[ACP])(\d+)\.(\d+)$/;

/** Which Trust Services category a criterion belongs to, or `null` if that is not one. */
export function categoryOf(id) {
  const hit = CRITERION_RE.exec(String(id ?? '').trim());
  return hit ? hit[1] : null;
}

/** Is this criterion one this register's elected categories cover? */
export const isElected = (id) => ELECTED.includes(categoryOf(id));

/* ---------------------------------------------------------- what must hold */

const text = (v) => String(v ?? '').trim();
const prose = (v) => typeof v === 'string' && v.trim().length >= 40;
const named = (v) => typeof v === 'string' && v.trim().length >= 2;

/**
 * The five fields adoption fills in, and which an owed commitment must not have.
 *
 * Both directions are enforced, exactly as `lib/policies.js`'s `ADOPTION_FIELDS` are: an
 * adopted commitment missing a statement is the obvious failure, and an owed one carrying
 * one is the dangerous one — the shape a register takes when somebody writes what the
 * agreement *would probably* say.
 */
export const ADOPTION_FIELDS = Object.freeze(['statement', 'source', 'recordedBy', 'recordedOn', 'reviewedOn']);

/**
 * Everything wrong with one commitment, as sentences.
 *
 * Takes an entry rather than reading {@link commitments}, for `lib/policies.js`'s reason:
 * a rule only ever run against a register that passes is a rule nobody has seen fail.
 * `userEntities` is the list a `toUserEntities` id must come from — the loaded subject's by
 * default, so a commitment is checked against the boundary it is made under.
 */
export function entryProblems(c, { userEntities: known = userEntityIds() } = {}) {
  const problems = [];
  const at = `COMMITMENTS[${text(c?.id) || '?'}]`;

  if (!/^[a-z][a-z0-9-]*$/.test(text(c?.id))) problems.push(`${at}: id must be kebab-case`);
  if (!named(c?.title)) problems.push(`${at}: \`title\` must be the name the commitment category is asked for by`);
  if (!prose(c?.aim)) problems.push(`${at}: \`aim\` must say what the commitment has to state, in a sentence`);

  if (!Array.isArray(c?.toUserEntities) || c.toUserEntities.length === 0) {
    problems.push(`${at}: \`toUserEntities\` must name at least one user entity — a commitment owed to nobody is not one`);
  } else {
    for (const id of c.toUserEntities) {
      if (!known.includes(text(id))) {
        problems.push(
          `${at}: \`toUserEntities\` names "${text(id)}", which is not ${known.length ? `one of ${known.join(', ')}` : 'a user entity the boundary names — it names none'}`
        );
      }
    }
  }

  if (!Array.isArray(c?.criteria) || c.criteria.length === 0) {
    problems.push(`${at}: \`criteria\` must name at least one criterion — a commitment measured against nothing is a paragraph, not a commitment`);
  } else {
    for (const id of c.criteria) {
      if (!categoryOf(id)) problems.push(`${at}: \`${text(id)}\` is not the shape a SOC 2 criterion id has`);
      else if (!isElected(id)) {
        problems.push(
          `${at}: \`${text(id)}\` is in the ${categoryOf(id)} category, which this register does not elect — ` +
            'either elect it in ELECTED or stop naming it'
        );
      }
    }
    if (new Set(c.criteria.map(text)).size !== c.criteria.length) problems.push(`${at}: \`criteria\` names the same criterion twice`);
  }

  if (!ROLES.includes(text(c?.ownerRole))) problems.push(`${at}: \`ownerRole\` must be one of ${ROLES.join(', ')}`);
  if (!Number.isInteger(c?.reviewMonths) || c.reviewMonths < 1 || c.reviewMonths > MAX_REVIEW_MONTHS) {
    problems.push(`${at}: \`reviewMonths\` must be a whole number of months between 1 and ${MAX_REVIEW_MONTHS}`);
  }

  if (!ADOPTION.includes(text(c?.adoption))) problems.push(`${at}: \`adoption\` must be one of ${ADOPTION.join(', ')}`);

  if (text(c?.adoption) === 'owed') {
    if (!prose(c?.owes)) problems.push(`${at}: \`owes\` must say what has to happen before this can be adopted, in a sentence`);
    for (const field of ADOPTION_FIELDS) {
      if (c?.[field] != null) {
        problems.push(`${at}: \`${field}\` is set on a commitment that is still owed — a promise nobody read out cannot be recorded`);
      }
    }
  }

  if (text(c?.adoption) === 'adopted') {
    if (!prose(c?.statement)) problems.push(`${at}: \`statement\` must be the commitment itself, in the organisation's own words`);
    if (!prose(c?.source)) problems.push(`${at}: \`source\` must name where this is recorded — the agreement, the SLA, the notice, and where in it`);
    if (!named(c?.recordedBy)) problems.push(`${at}: \`recordedBy\` must name who read the agreement and transcribed this`);

    const recorded = parseDate(c?.recordedOn);
    const reviewed = parseDate(c?.reviewedOn);
    if (recorded === null) problems.push(`${at}: \`recordedOn\` must be a real date, as YYYY-MM-DD`);
    if (reviewed === null) problems.push(`${at}: \`reviewedOn\` must be a real date, as YYYY-MM-DD`);
    if (recorded !== null && reviewed !== null && reviewed < recorded) {
      problems.push(`${at}: reviewed ${c.reviewedOn}, before it was recorded on ${c.recordedOn} — one of the two dates is wrong`);
    }
  }

  return problems;
}

/**
 * Everything wrong with the set as a set, without touching the disk or the clock.
 *
 * Run by the command that reads it (`bin/description.js`) before anything is rendered — the
 * bar that used to be an import-time throw, when the register shipped compiled in.
 */
export function registerProblems(register = commitments(), { userEntities: known = userEntityIds() } = {}) {
  if (!Array.isArray(register)) return ['the commitments set is a list of commitments'];

  const problems = [];
  const seen = new Set();
  for (const c of register) {
    problems.push(...entryProblems(c, { userEntities: known }));
    if (seen.has(text(c?.id))) problems.push(`COMMITMENTS[${text(c?.id)}]: two commitments with the same id`);
    seen.add(text(c?.id));
  }
  return problems;
}

/* -------------------------------------------------------------- the reads */

/** Every criterion any commitment claims, deduplicated and sorted. */
export function claimed(register = commitments()) {
  const ids = new Set();
  for (const c of register) for (const id of c.criteria || []) ids.add(text(id));
  return [...ids].sort();
}

/**
 * The register measured against the real corpus — see `lib/policies.js`'s `coverage`.
 *
 * `criteria` is every SOC 2 id the corpus holds, passed in rather than imported so this
 * keeps working in a release where `lib/controls.js` has not landed.
 */
export function coverage(criteria, register = commitments()) {
  const all = [...(criteria || [])].map(text).filter((id) => categoryOf(id));
  const elected = all.filter(isElected);
  const exempt = all.filter((id) => !isElected(id));
  const claims = claimed(register);
  return {
    elected,
    exempt,
    claimed: claims,
    unclaimed: elected.filter((id) => !claims.includes(id)),
    unknown: claims.filter((id) => !all.includes(id)),
  };
}

/**
 * What this commitment is right now: `owed`, or how its review date stands.
 *
 * `now` is a parameter rather than a call to the clock — `lib/documents.js`'s reason.
 */
export function stateOf(entry, now = new Date()) {
  if (text(entry?.adoption) !== 'adopted') return { state: 'owed', due: null, days: null };
  const { due, days, state } = reviewStatus(entry, now);
  return { state: state ?? 'owed', due, days };
}

/** The commitment categories nobody has recorded yet — the readiness gap, in order. */
export const gaps = (register = commitments()) => register.filter((c) => text(c.adoption) === 'owed');

/**
 * The register, converted to what `lib/systemdescription.js`'s supplied-record seam
 * wants — only the categories that are actually recorded.
 *
 * An owed category contributes nothing, on purpose: `suppliedSection` there treats an
 * empty list as "nothing to show", which is the honest answer for a category nobody has
 * read the agreement for yet. This is the one function in this file that knows the shape
 * the other side wants, so `bin/description.js` does not have to.
 */
export function suppliable(register = commitments()) {
  return register
    .filter((c) => text(c.adoption) === 'adopted')
    .map((c) => ({ id: text(c.id), label: text(c.title), statement: text(c.statement), source: text(c.source) }));
}

/** The set in one paragraph, for a README, a report or a card. */
export function summarise(register = commitments(), now = new Date()) {
  const states = register.map((c) => stateOf(c, now).state);
  const recorded = states.filter((s) => s !== 'owed').length;
  const overdue = states.filter((s) => s === 'overdue').length;
  const owedTo = [...new Set(register.flatMap((c) => (c.toUserEntities || []).map(text)))];
  return (
    `${register.length} commitment categor${register.length === 1 ? 'y' : 'ies'}, ${recorded} recorded and ` +
    `${register.length - recorded} owed${overdue ? `, ${overdue} of them past their review date` : ''}. ` +
    `They are measured against ${claimed(register).length} criteria, owed to ${owedTo.join(' and ') || 'nobody'}.`
  );
}
