/**
 * The system boundary, as data — what is inside it, what is carved out, and who the
 * report is written for.
 *
 * A SOC 2 report is not about an organisation. It is about a **system** — infrastructure,
 * software, people, procedures and data — inside a stated boundary, described to named
 * **user entities**. Everything downstream is scoped by it: which criteria are worth
 * electing, which controls are tested, which population a sample is drawn from. An
 * argued boundary is the cheapest lever in the whole programme, and it is the one most
 * often written as a paragraph in a document that nothing can read.
 *
 * So it is a record here, and lib/election.js's `declare` takes its projection rather
 * than a paragraph somebody typed. `declaration` below is that projection, which is what
 * stops the scope statement an auditor reads and the boundary a gate cites from ever
 * being two different claims maintained by two different people.
 *
 * **The subject is supplied, not compiled in.** Which system is described, for which
 * service organisation and to which user entities, is the organisation's own record — its
 * customers, its product, its contracts — and it lives in that organisation's repository.
 * Beadcause holds the engine: the shape a boundary must have, the validators that refuse a
 * boundary that only looks finished, and the readers everything downstream asks. The
 * record arrives through config — `compliance.subjects` maps an organisation id to the
 * absolute path of a subject file — and an install that names none has **no subject at
 * all**, which every reader answers as "nothing is claimed here" rather than with a default
 * somebody would mistake for a decision. See {@link loadSubjects}.
 *
 * What beadcause itself is — the daemon, the Mac it runs on, the agent roles it mints — is
 * still knowable only from here, and a subject that carves it out (the ordinary case) names
 * those components in its own record. Carving out is the subject's decision, which is why
 * it travels with the subject rather than being injected by the engine.
 *
 * **Outside the boundary is not outside the audit, and conflating the two is the mistake
 * this file exists to make impossible.** Beadcause opens the agent sessions that change
 * the repositories the in-scope system is built from, which puts it in the change-
 * management path whether or not it is part of what is described to a user entity. The
 * distinction is between what is *described* and what is *tested*: a carve-out is a
 * statement about the system description, and it carries no implication at all about
 * whether an auditor testing CC8.1 will want records out of the carved-out thing. So a
 * carved-out component may name what it still `bearsOn`, and beadcause names change
 * management. A carve-out with nothing recorded against it is the shape of an omission
 * wearing a decision's clothes.
 *
 * **A census is a field, because the alternative is a blank that reads as an answer.**
 * This is the design decision worth arguing with. Almost nothing about a described system's
 * internals is knowable from this repository — the repositories, hosts, data stores and
 * egress destinations inside the boundary are enumerated wherever the organisation keeps its
 * architecture, not here. The two tempting shapes are both wrong: an
 * empty list reads as "there are none", and omitting the field reads as "not applicable".
 * Neither is true, and both validate perfectly. So every kind of thing a boundary can
 * contain carries a `census` — `enumerated` or `partial` — and a `partial` one must name
 * where the authoritative enumeration is `held`. An empty subservice list under a partial
 * census says *nobody has surveyed the processors yet*, which is a finding somebody can
 * act on; the same empty list with no census says *there are none*, which is false and
 * unfalsifiable at the same time. `gaps` is what turns those into sentences.
 *
 * **The carve-outs are enumerated even though the inside is not, and that asymmetry is
 * real rather than convenient.** Carving something out is a decision, and this repository
 * can make it in full: everything beadcause is, is knowable from here. Enumerating what
 * is *inside* is a survey of somebody else's estate. So a census answers for the inside
 * list only — `CARVE_OUTS_ARE_ENUMERATED` says that in one place rather than leaving it
 * to be inferred from a field that does not exist.
 *
 * **Multi-tenant from the first line, for lib/organisation.js's reason.** The loaded
 * subjects are a map keyed by organisation id rather than a single record, even on an
 * install with one entry. A boundary written as a singleton is a boundary that becomes a
 * migration the day a second service organisation enrols, and that migration is over the
 * one record whose entire value is that it has not changed silently.
 *
 * **Read, never crashed on.** The engine is a leaf — no git, no network, nothing written —
 * and the only things it reads are the config file and the subject files it names, once per
 * process. A subject file that is missing, unreadable, not JSON or fails validation is left
 * out of the map and reported by {@link subjectProblems}, which every command prints. The
 * old arrangement threw at import, because a register compiled into the release was a
 * broken build if it failed; a file somebody else maintains is not a build, and a command
 * that crashed on one would hide the sentence saying which field was wrong. What must not
 * happen is the other failure — a broken file read as "nothing is carved out" — and leaving
 * it out of the map while saying why is what prevents that.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Safe to import: lib/config.js never imports this file, and CONFIG_PATH is a plain string
// computed when it loads. The alternative — a second copy of the `~/.config/beadcause`
// path — is the one that goes wrong when BEADCAUSE_CONFIG_DIR is set. Only the path of the
// file is taken, never the directory: this module reads that one file and writes nothing,
// which is why lib/evidence.js's scan for modules persisting state does not list it.
import { CONFIG_PATH } from './config.js';
import { orgProblems } from './organisation.js';

/**
 * The kinds of thing a boundary contains.
 *
 * The first four are the estate — what an auditor walks. `role` is both human and
 * non-human, deliberately one kind rather than two: an agent that can open a pull request
 * against an in-scope repository and an engineer who can are the same question asked of a
 * control, and splitting them is how the non-human half ends up unenumerated.
 */
export const KINDS = Object.freeze(['repo', 'host', 'datastore', 'egress', 'role']);

/**
 * What a component's presence in the record means. There are two, and there is no third.
 *
 * `unknown` is deliberately absent. A thing nobody has decided about is not a component
 * with a state — it is a thing not yet in the list, and the census is what says so.
 * Giving a component an `unknown` disposition makes the census redundant and then wrong,
 * because a survey that is complete except for the undecided ones reads as complete.
 */
export const DISPOSITIONS = Object.freeze(['inside', 'carved-out']);

/**
 * What a subservice organisation's controls do to this report.
 *
 * `carve-out` leaves them out of the description and shifts the reliance onto the user
 * entity, which is why a carve-out here owes at least one CUEC. `inclusive` drags the
 * subservice organisation's own controls into the test population, which is a far larger
 * promise and is why it is never the quiet default.
 */
export const METHODS = Object.freeze(['carve-out', 'inclusive']);

/** How complete the *inside* list is for a kind. See the header. */
export const CENSUS = Object.freeze(['enumerated', 'partial']);

/** Everything that gets a census: every kind, plus the two lists beside them. */
export const CENSUS_KINDS = Object.freeze([...KINDS, 'subservice', 'user-entity']);

/**
 * Said once, out loud, rather than inferred from the absence of a field.
 *
 * A census is about the inside list. Carve-outs are decisions this repository can make in
 * full, so the carve-out list in a record is complete by construction and `boundaryProblems`
 * holds it to that: every carved-out component must carry a reason.
 */
export const CARVE_OUTS_ARE_ENUMERATED = true;

/** The shortest a `why` may be — long enough that a word is not an argument. */
const WHY_MIN = 20;

/** The shortest a scope statement may be. It is the first thing an auditor reads. */
const STATEMENT_MIN = 60;

/** A component or entity id: the same alphabet lib/organisation.js allows, for keys. */
const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/* ------------------------------------------------------------------ validating */

const text = (v) => String(v ?? '').trim();

/** Everything wrong with one component, as sentences. */
function componentProblems(c, where) {
  const problems = [];
  const id = text(c?.id);
  if (!id) problems.push(`${where}: a component needs an id`);
  else if (!ID_RE.test(id)) problems.push(`${where}: "${id}" is not the shape of a component id — lowercase, dashed`);
  if (!KINDS.includes(c?.kind)) {
    problems.push(`${where}: kind "${text(c?.kind)}" is not one of ${KINDS.join(', ')}`);
  }
  if (!DISPOSITIONS.includes(c?.disposition)) {
    problems.push(
      `${where}: disposition "${text(c?.disposition)}" is not one of ${DISPOSITIONS.join(', ')} — ` +
        'a component nobody has decided about belongs out of the list, with the census saying so'
    );
  }
  if (!text(c?.label)) problems.push(`${where}: a component needs a label a person can read`);
  if (text(c?.why).length < WHY_MIN) {
    problems.push(
      `${where}: needs a \`why\` of at least ${WHY_MIN} characters — ` +
        (c?.disposition === 'carved-out'
          ? 'a carve-out with no reason is an omission wearing a decision\'s clothes'
          : 'why something is inside the boundary is the sentence the scope argument is made of')
    );
  }
  return problems;
}

/** Everything wrong with one subservice organisation, as sentences. */
function subserviceProblems(s, where) {
  const problems = [];
  const id = text(s?.id);
  if (!id) problems.push(`${where}: a subservice organisation needs an id`);
  else if (!ID_RE.test(id)) problems.push(`${where}: "${id}" is not the shape of an id — lowercase, dashed`);
  if (!text(s?.label)) problems.push(`${where}: a subservice organisation needs a label`);
  if (!METHODS.includes(s?.method)) {
    problems.push(
      `${where}: method "${text(s?.method)}" is not one of ${METHODS.join(', ')} — ` +
        'the two do different things to the test population and neither is a default'
    );
  }
  if (text(s?.provides).length < WHY_MIN) {
    problems.push(`${where}: needs \`provides\` — what this organisation does for the system, in a sentence`);
  }
  if (s?.method === 'carve-out' && !(Array.isArray(s?.cuecs) && s.cuecs.filter((c) => text(c)).length)) {
    problems.push(
      `${where}: a carve-out shifts reliance onto the user entity, so it owes at least one CUEC — ` +
        'a carve-out with nothing on the other side is a control that vanished between two documents'
    );
  }
  return problems;
}

/** Everything wrong with one user entity, as sentences. */
function entityProblems(e, where) {
  const problems = [];
  const id = text(e?.id);
  if (!id) problems.push(`${where}: a user entity needs an id`);
  else if (!ID_RE.test(id)) problems.push(`${where}: "${id}" is not the shape of an id — lowercase, dashed`);
  if (!text(e?.label)) problems.push(`${where}: a user entity needs a label — the name the report is addressed to`);
  if (text(e?.why).length < WHY_MIN) problems.push(`${where}: needs a \`why\` — how this entity uses the system`);
  return problems;
}

/**
 * Everything wrong with a boundary record, as sentences. Empty means it is well-shaped.
 *
 * Shape and internal consistency only. It cannot know whether a repository named inside
 * the boundary really is inside it — nothing can, from here — which is exactly why the
 * census is mandatory: the one thing this can check is whether the record admits what it
 * does not know.
 */
export function boundaryProblems(record) {
  const problems = [];
  if (!record || typeof record !== 'object') return ['a boundary record is required'];

  problems.push(...orgProblems(record.organisation).map((p) => `organisation: ${p}`));
  if (!text(record.system)) problems.push('a boundary needs a `system` — the thing being described');
  if (!text(record.serviceOrganisation)) {
    problems.push('a boundary needs a `serviceOrganisation` — who is being held to this');
  }
  if (text(record.statement).length < STATEMENT_MIN) {
    problems.push(
      `a boundary needs a \`statement\` of at least ${STATEMENT_MIN} characters saying what is inside ` +
        'it — the scope statement is the first thing an auditor reads and the last thing anyone writes'
    );
  }
  if (!text(record.decidedBy)) {
    problems.push(
      'a boundary needs `decidedBy` — the bead the subject was settled on. A boundary with no ' +
        'decision behind it is one nobody can argue with later'
    );
  }

  const components = Array.isArray(record.components) ? record.components : [];
  if (!Array.isArray(record.components)) problems.push('`components` must be a list, even an empty one');
  const seen = new Set();
  components.forEach((c, i) => {
    problems.push(...componentProblems(c, `component ${text(c?.id) || `#${i}`}`));
    const key = `${c?.kind}/${text(c?.id)}`;
    if (seen.has(key)) problems.push(`component ${text(c?.id)}: declared twice as a ${c?.kind}`);
    seen.add(key);
  });

  const entities = Array.isArray(record.userEntities) ? record.userEntities : [];
  if (!Array.isArray(record.userEntities)) problems.push('`userEntities` must be a list, even an empty one');
  const entitySeen = new Set();
  entities.forEach((e, i) => {
    problems.push(...entityProblems(e, `user entity ${text(e?.id) || `#${i}`}`));
    if (entitySeen.has(text(e?.id))) problems.push(`user entity ${text(e?.id)}: named twice`);
    entitySeen.add(text(e?.id));
  });

  const subs = Array.isArray(record.subservice) ? record.subservice : [];
  if (!Array.isArray(record.subservice)) problems.push('`subservice` must be a list, even an empty one');
  const subSeen = new Set();
  subs.forEach((s, i) => {
    problems.push(...subserviceProblems(s, `subservice ${text(s?.id) || `#${i}`}`));
    if (subSeen.has(text(s?.id))) problems.push(`subservice ${text(s?.id)}: named twice`);
    subSeen.add(text(s?.id));
  });

  problems.push(...censusProblems(record));
  return problems;
}

/**
 * Everything wrong with the census, as sentences.
 *
 * Split out because it is the half people will be tempted to relax, and having it under
 * its own name makes that argument happen in a code review rather than in a diff.
 */
export function censusProblems(record) {
  const problems = [];
  const census = record?.census;
  if (!census || typeof census !== 'object') {
    return [
      'a boundary needs a `census` — how complete each list is. Without one an empty list reads as ' +
        '"there are none" and an absent field reads as "not applicable", and both validate perfectly',
    ];
  }
  for (const kind of CENSUS_KINDS) {
    const entry = census[kind];
    if (!entry) {
      problems.push(`census: nothing recorded for ${kind} — an unstated census is the blank this field exists to stop`);
      continue;
    }
    if (!CENSUS.includes(entry.state)) {
      problems.push(`census ${kind}: state "${text(entry.state)}" is not one of ${CENSUS.join(', ')}`);
    }
    if (entry.state === 'partial' && !text(entry.held)) {
      problems.push(
        `census ${kind}: a partial census must say where the rest is \`held\` — otherwise it is a shrug ` +
          'with a schema, and nobody knows where to go to close it'
      );
    }
    if (entry.state === 'enumerated' && text(entry.held)) {
      problems.push(
        `census ${kind}: enumerated and \`held\` elsewhere cannot both be true — if the list here is ` +
          'complete, there is no elsewhere; if there is, it is partial'
      );
    }
  }
  for (const kind of Object.keys(census)) {
    if (!CENSUS_KINDS.includes(kind)) problems.push(`census: "${kind}" is not something a boundary has a census of`);
  }
  return problems;
}

/**
 * Everything wrong with a set of boundaries keyed by organisation, as sentences.
 *
 * The key and the record's own `organisation` must agree, because a map that can disagree
 * with its values is a map where a lookup and a read of the result answer different
 * questions. Defaults to the boundaries of the loaded subjects.
 */
export function registryProblems(boundaries = allBoundaries()) {
  const problems = [];
  const firsts = [];
  for (const [key, record] of Object.entries(boundaries)) {
    problems.push(...boundaryProblems(record).map((p) => `${key}: ${p}`));
    if (record?.organisation !== key) {
      problems.push(`${key}: keyed as "${key}" but the record says "${text(record?.organisation)}"`);
    }
    if (record?.first) firsts.push(key);
  }
  if (firsts.length > 1) {
    problems.push(`more than one organisation claims to be the first: ${firsts.join(', ')}`);
  }
  return problems;
}

/* ------------------------------------------------------------------- subjects */

/** The config key that names the subjects, said once so every refusal names it the same way. */
export const SUBJECTS_KEY = 'compliance.subjects';

/**
 * The top-level fields a subject file may carry.
 *
 * `organisation` and `boundary` are required; the rest are the sections the joining modules
 * read — `assessment` by lib/gapassessment.js, `commitments` by lib/commitments.js,
 * `recovery` by lib/recovery.js — and each is validated in full by its own module, which is
 * where the rules for it live. This file checks only that a section is the right *kind* of
 * thing, so a typo'd key is a refusal rather than a section silently read as absent.
 */
export const SUBJECT_FIELDS = Object.freeze(['organisation', 'boundary', 'assessment', 'commitments', 'recovery']);

/** The sentence every command prints when nothing is configured. One line, naming the key. */
export const NO_SUBJECT =
  `no compliance subject is configured — set ${SUBJECTS_KEY} in ${CONFIG_PATH} ` +
  'to map an organisation id to the absolute path of its subject file';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Everything wrong with one parsed subject file, as sentences.
 *
 * Shape only, plus the boundary in full — see {@link SUBJECT_FIELDS} for why the other
 * sections are held to their kind here and to their content by their own modules. `org`
 * is the key it was configured under, and the file has to agree with it for the reason
 * {@link registryProblems} gives.
 */
export function subjectShapeProblems(subject, org) {
  if (!isObject(subject)) return ['a subject file must be a JSON object'];
  const problems = [];
  for (const key of Object.keys(subject)) {
    if (!SUBJECT_FIELDS.includes(key)) {
      problems.push(`"${key}" is not a field a subject has — one of ${SUBJECT_FIELDS.join(', ')}`);
    }
  }
  if (text(subject.organisation) !== text(org)) {
    problems.push(`configured as "${text(org)}" but the file says "${text(subject.organisation)}"`);
  }
  if (!isObject(subject.boundary)) problems.push('`boundary` is required — the record everything else is scoped by');
  else {
    problems.push(...boundaryProblems(subject.boundary).map((p) => `boundary: ${p}`));
    if (text(subject.boundary.organisation) !== text(org)) {
      problems.push(`boundary: configured as "${text(org)}" but the boundary says "${text(subject.boundary.organisation)}"`);
    }
  }
  if (subject.assessment !== undefined) {
    if (!isObject(subject.assessment)) problems.push('`assessment` must be an object with a `rows` list');
    else {
      if (!Array.isArray(subject.assessment.rows)) problems.push('assessment: `rows` must be a list, one per elected criterion');
      if (subject.assessment.notElected !== undefined && !Array.isArray(subject.assessment.notElected)) {
        problems.push('assessment: `notElected` must be a list of the categories considered and declined');
      }
      if (subject.assessment.decidedBy !== undefined && !isObject(subject.assessment.decidedBy)) {
        problems.push('assessment: `decidedBy` must be an object naming the bead each question was settled on');
      }
    }
  }
  if (subject.commitments !== undefined && !Array.isArray(subject.commitments)) {
    problems.push('`commitments` must be a list of commitment categories');
  }
  if (subject.recovery !== undefined && !isObject(subject.recovery)) {
    problems.push('`recovery` must be an object with a `tests` list of restores performed');
  }
  return problems;
}

/** Frozen all the way down, so a reader cannot mutate what every other reader is handed. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** `~/` is expanded and a relative path is read against the config directory. */
const resolveFile = (file) => {
  const f = text(file);
  return path.resolve(path.dirname(CONFIG_PATH), f === '~' || f.startsWith('~/') ? path.join(os.homedir(), f.slice(1)) : f);
};

/**
 * Read one subject file: `{ subject, file, problems }`, with `subject` null on any problem.
 *
 * Every failure is a sentence naming the key and the file — missing, unreadable, not JSON,
 * the wrong shape — and none is a throw. The subject comes back deep-frozen.
 */
export function readSubject(org, file) {
  const where = `${SUBJECTS_KEY}.${text(org) || '?'}`;
  const problems = orgProblems(text(org)).map((p) => `${where}: ${p}`);
  if (typeof file !== 'string' || !text(file)) {
    return { subject: null, file: null, problems: [...problems, `${where}: must be the path of a subject file, as a string`] };
  }
  const abs = resolveFile(file);
  if (problems.length) return { subject: null, file: abs, problems };
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return { subject: null, file: abs, problems: [`${where}: cannot read ${abs} — ${err.code || err.message}`] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { subject: null, file: abs, problems: [`${where}: ${abs} is not JSON — ${err.message}`] };
  }
  const shape = subjectShapeProblems(parsed, org).map((p) => `${where}: ${p}`);
  if (shape.length) {
    return { subject: null, file: abs, problems: [`${where}: ${abs} fails validation, and nothing from it is used`, ...shape] };
  }
  return { subject: deepFreeze(parsed), file: abs, problems: [] };
}

/**
 * Read every subject a `{ org: path }` map names: `{ subjects, files, problems }`.
 *
 * A subject that fails is left out and said; the ones that load are kept. One bad file does
 * not take the others down with it, and it does not become an empty answer either — the
 * problem list is what a command prints before it prints anything else.
 */
export function readSubjects(paths) {
  const subjects = {};
  const files = {};
  const problems = [];
  if (paths == null) return { subjects, files, problems };
  if (!isObject(paths)) {
    return { subjects, files, problems: [`${SUBJECTS_KEY} must be an object mapping an organisation id to a subject file`] };
  }
  for (const [org, file] of Object.entries(paths)) {
    const read = readSubject(org, file);
    problems.push(...read.problems);
    if (read.subject) {
      subjects[org] = read.subject;
      files[org] = read.file;
    }
  }
  const firsts = Object.keys(subjects).filter((org) => subjects[org].boundary.first);
  if (firsts.length > 1) problems.push(`more than one organisation claims to be the first: ${firsts.join(', ')}`);
  return { subjects, files, problems };
}

/** What `compliance.subjects` holds in a config object, or `null` when it holds nothing. */
export const subjectPaths = (cfg) => cfg?.compliance?.subjects ?? null;

/**
 * The subject paths out of the config file on disk, read-only.
 *
 * Deliberately not `loadConfig()`: that writes a fresh config when there is none, and a
 * command asked to print a boundary has no business creating a config directory. A config
 * that is absent names no subjects; one that cannot be parsed is a problem, not a crash.
 */
function configuredPaths() {
  if (!fs.existsSync(CONFIG_PATH)) return { paths: null, problems: [] };
  try {
    return { paths: subjectPaths(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))), problems: [] };
  } catch (err) {
    return { paths: null, problems: [`${CONFIG_PATH} cannot be read for ${SUBJECTS_KEY} — ${err.message}`] };
  }
}

let loaded = null;

/**
 * Load the subjects — from the map given, or from the config file when none is.
 *
 * Called lazily by every reader below, so importing this module reads nothing. A caller that
 * already holds a config (the daemon) or a map of its own (a suite) passes it, and that
 * replaces what is loaded; `loadSubjects()` with no argument re-reads the config file.
 * Returns what {@link readSubjects} returns.
 */
export function loadSubjects(paths) {
  if (paths === undefined) {
    const fromConfig = configuredPaths();
    const read = readSubjects(fromConfig.paths);
    loaded = { ...read, problems: [...fromConfig.problems, ...read.problems] };
  } else {
    loaded = readSubjects(paths);
  }
  return loaded;
}

const current = () => loaded || loadSubjects();

/** What went wrong loading the subjects, as sentences. Empty when every configured one loaded. */
export const subjectProblems = () => [...current().problems];

/** The whole subject for an organisation — boundary and sections — or `null`. */
export const subjectFor = (org) => current().subjects[text(org)] || null;

/** Where an organisation's subject was read from, or `null`. */
export const subjectFile = (org) => current().files[text(org)] || null;

/** Every loaded boundary, keyed by organisation id. */
export const allBoundaries = () =>
  Object.fromEntries(Object.entries(current().subjects).map(([org, s]) => [org, s.boundary]));

/* -------------------------------------------------------------------- reading */

/** Every organisation with a subject loaded on this install. */
export const organisations = () => Object.keys(current().subjects).sort();

/**
 * The boundary for an organisation, or `null`.
 *
 * `null` and not a throw: an install with no subject recorded for an organisation is an
 * ordinary state — it is every install that has not configured one — and it must read as
 * "nothing is claimed here" rather than as a crash.
 */
export const boundaryFor = (org) => subjectFor(org)?.boundary || null;

/** The one boundary, when exactly one subject is loaded. `null` when it is not. */
export const only = () => (organisations().length === 1 ? boundaryFor(organisations()[0]) : null);

/**
 * The organisation whose programme this is, when that is not a question — or `null`.
 *
 * Exactly one subject loaded answers it. None, or two, and it is `null` rather than a guess:
 * a policy set or an assessment attributed to the wrong organisation is worse than one
 * attributed to nobody, and a caller with two subjects has to name the one it means.
 */
export const heldBy = () => (organisations().length === 1 ? organisations()[0] : null);

/**
 * Which subject a command should act on: `{ org, subject, boundary, problem, unconfigured }`.
 *
 * `named` wins when given. Otherwise the one loaded subject is chosen, and zero or several
 * is a `problem` sentence rather than a pick. `unconfigured` is true only when nothing is
 * configured at all and nothing failed to load — the one case a command reports as a plain
 * statement and exits cleanly on, because it is an install that has not opted in rather
 * than one that is broken.
 */
export function chooseSubject(named = null) {
  const known = organisations();
  const failed = subjectProblems().length > 0;
  if (text(named)) {
    const subject = subjectFor(named);
    if (subject) return { org: text(named), subject, boundary: subject.boundary, problem: null, unconfigured: false };
    return {
      org: null,
      subject: null,
      boundary: null,
      problem: `no subject is loaded for "${text(named)}"${known.length ? ` — loaded: ${known.join(', ')}` : ''}`,
      unconfigured: !known.length && !failed,
    };
  }
  if (known.length === 1) {
    const subject = subjectFor(known[0]);
    return { org: known[0], subject, boundary: subject.boundary, problem: null, unconfigured: false };
  }
  if (!known.length) {
    return {
      org: null,
      subject: null,
      boundary: null,
      problem: failed ? `no subject loaded — every configured one failed (see above)` : NO_SUBJECT,
      unconfigured: !failed,
    };
  }
  return {
    org: null,
    subject: null,
    boundary: null,
    problem: `${known.length} subjects are loaded (${known.join(', ')}) — name the one you mean`,
    unconfigured: false,
  };
}

/**
 * {@link chooseSubject} for a command: prints what went wrong, and says how to exit.
 *
 * Every load problem goes to stderr first, whether or not a subject was chosen, because a
 * second subject failing is worth knowing about while reading the first. An install with
 * nothing configured gets {@link NO_SUBJECT} on stdout and `exit: 0` — it has not opted in,
 * which is not an error — and anything else that leaves no subject is `exit: 1`.
 */
export function commandSubject(tool, named = null, { log = console.log, error = console.error } = {}) {
  for (const p of subjectProblems()) error(`${tool}: ${p}`);
  const pick = chooseSubject(named);
  if (pick.org) return { ...pick, exit: null };
  if (pick.unconfigured && !text(named)) {
    log(`${tool}: ${pick.problem}`);
    return { ...pick, exit: 0 };
  }
  error(`${tool}: ${pick.problem}`);
  return { ...pick, exit: 1 };
}

/** Components, narrowed by kind and disposition. Both filters optional. */
export function components(record, { kind = null, disposition = null } = {}) {
  const all = Array.isArray(record?.components) ? record.components : [];
  return all.filter((c) => (!kind || c.kind === kind) && (!disposition || c.disposition === disposition));
}

/** What is inside the boundary, optionally of one kind. */
export const inside = (record, kind = null) => components(record, { kind, disposition: 'inside' });

/** What is carved out, optionally of one kind. */
export const carvedOut = (record, kind = null) => components(record, { kind, disposition: 'carved-out' });

/** The named user entities the report is written for. */
export const userEntities = (record) => (Array.isArray(record?.userEntities) ? record.userEntities : []);

/** The subservice organisations, with their carve-out or inclusive decision. */
export const subservice = (record) => (Array.isArray(record?.subservice) ? record.subservice : []);

/**
 * Every complementary user entity control the carve-outs generate, with what generated it.
 *
 * A CUEC is the other end of a carve-out: the control the user entity has to operate
 * because this report does not cover it. Flattening them into one list is the artefact —
 * it is what a user entity is actually handed, and reading it out of a per-subservice
 * structure by hand is how one goes missing.
 */
export function cuecs(record) {
  return subservice(record)
    .filter((s) => s.method === 'carve-out')
    .flatMap((s) => (Array.isArray(s.cuecs) ? s.cuecs : []).map((control) => ({ control, from: s.id, label: s.label })));
}

/** What the record itself says it does not know, as sentences somebody can act on. */
export function gaps(record) {
  const found = [];
  const census = record?.census || {};
  for (const kind of CENSUS_KINDS) {
    const entry = census[kind];
    if (entry?.state !== 'partial') continue;
    const count = kind === 'subservice' ? subservice(record).length : kind === 'user-entity' ? userEntities(record).length : inside(record, kind).length;
    found.push({
      kind,
      held: text(entry.held),
      recorded: count,
      why: text(entry.note) || `the ${kind} list is partial`,
    });
  }
  // Gated on the subservice census rather than raised whenever the CUEC list is empty,
  // because every gap here has to be closable by somebody: the only thing that produces a
  // CUEC in this record is a subservice carve-out, and validation already refuses one of
  // those without a CUEC. An ungated version stays red on a record whose processors really
  // are enumerated and really are none, which would make `--strict` permanently useless.
  const named = userEntities(record);
  if (named.length && !cuecs(record).length && census.subservice?.state === 'partial') {
    found.push({
      kind: 'cuec',
      held: text(census.subservice.held),
      recorded: 0,
      why:
        `${named.map((e) => e.label).join(' and ')} ` +
        `${named.length === 1 ? 'is named as a user entity' : 'are named as user entities'}, ` +
        'and no complementary control has been written for them. The processors are unsurveyed, ' +
        'so the carve-outs that would produce that list have not been decided yet — and a report with ' +
        'user entities and no CUEC list has told them nothing they have to do.',
    });
  }
  return found;
}

/**
 * The boundary as lib/election.js's `declare` wants it.
 *
 * The projection is the whole point: the scope statement a gate cites is computed from
 * this record rather than typed beside it, so the two can never drift. Deliberately a
 * one-way function — the declaration is a summary, and reconstructing a boundary from a
 * summary is how a census gets lost.
 */
export function declaration(record) {
  const carved = carvedOut(record).length;
  const entities = userEntities(record)
    .map((e) => e.label)
    .join(', ');
  return {
    name: text(record?.serviceOrganisation),
    description:
      `${text(record?.system)}. ${text(record?.statement)}` +
      (entities ? ` User entities: ${entities}.` : '') +
      (carved ? ` ${carved} component${carved === 1 ? '' : 's'} carved out.` : ''),
  };
}

/**
 * One line, for a log or a check.
 *
 * The gap count is in it on purpose. A summary that reads "2 inside, 8 carved out" and
 * stops is the summary that lets six partial censuses go unnoticed for a quarter.
 */
export function summarise(record) {
  const g = gaps(record).length;
  return (
    `${text(record?.serviceOrganisation)} · ${text(record?.system)} · ` +
    `${inside(record).length} inside, ${carvedOut(record).length} carved out, ` +
    `${userEntities(record).length} user entit${userEntities(record).length === 1 ? 'y' : 'ies'}, ` +
    `${subservice(record).length} subservice · ${g} gap${g === 1 ? '' : 's'}`
  );
}
