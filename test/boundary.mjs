#!/usr/bin/env node
//
// The system boundary is data, not prose — `lib/boundary.js`.
//
//   npm test                       (runs it alongside the other suites)
//   node test/boundary.mjs         (on its own)
//
// bc-4r10.2. The boundary decides everything downstream — which criteria are worth
// electing, which controls are tested, which population a sample comes out of — and the
// usual failure is not that somebody writes the wrong boundary. It is that somebody
// writes a boundary that *looks* finished. An empty list reads as "there are none", an
// absent field reads as "not applicable", and both of them validate perfectly against any
// schema that only checks types.
//
// So the claim this suite defends is a strange one for a data file: **the record has to
// admit what it does not know.** Three parts.
//
//  1. **A census is mandatory, and a partial one has to say where the rest is held.**
//     This is the whole design and it is the half a later edit will be tempted to relax,
//     so it is asserted from both directions — a record with no census fails, a partial
//     census with no `held` fails, and an `enumerated` census that *also* claims to be
//     held elsewhere fails, because those two cannot both be true.
//  2. **A carve-out is a decision and owes a reason; a subservice carve-out owes a CUEC.**
//     Carving a subservice organisation out shifts reliance onto the user entity, and a
//     carve-out with nothing on the other side is a control that vanished between two
//     documents. That one is checked by constructing exactly that record and requiring a
//     refusal.
//  3. **A loaded boundary is the projection lib/election.js accepts.** The scope
//     statement a gate cites is computed from this record rather than typed beside it, so
//     the two cannot drift — and the way that is proved is by running the real
//     `boundaryProblems` from lib/election.js over the real `declaration`, rather than by
//     asserting a shape that could agree with nothing.
//  4. **The subject is loaded from config, and a broken one is said rather than thrown.**
//     Beadcause ships no subject; `compliance.subjects` names a file the organisation keeps.
//     No subject configured is a plain state every reader answers empty; a file that is
//     missing, not JSON, keyed wrong or fails validation is left out *and named*, and the
//     command says so in one line rather than crashing.
//
// The subject exercised below is the synthetic Acme one from test/helpers/subject.mjs —
// invented, and shaped like a first real subject so the checks mean something. No git, no
// tracker, no network; the only files are the scratch ones this suite writes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CARVE_OUTS_ARE_ENUMERATED,
  CENSUS,
  CENSUS_KINDS,
  DISPOSITIONS,
  KINDS,
  METHODS,
  NO_SUBJECT,
  SUBJECTS_KEY,
  allBoundaries,
  boundaryFor,
  boundaryProblems,
  carvedOut,
  censusProblems,
  chooseSubject,
  commandSubject,
  components,
  cuecs,
  declaration,
  gaps,
  heldBy,
  inside,
  loadSubjects,
  only,
  organisations,
  readSubject,
  registryProblems,
  subjectFile,
  subjectFor,
  subjectProblems,
  subjectShapeProblems,
  subservice,
  summarise,
  userEntities,
} from '../lib/boundary.js';
import { boundaryProblems as electionBoundaryProblems } from '../lib/election.js';
import { acmeSubject, configureSubjects, useAcme, writeSubject } from './helpers/subject.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const acmeSetup = useAcme();

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message.split('\n').join('\n      ')}`);
  }
}

/** A well-shaped record, as the smallest thing that passes. Mutated per case below. */
const wellShaped = () => ({
  organisation: 'acme',
  system: 'The Widget Platform',
  serviceOrganisation: 'Acme',
  decidedBy: 'bc-0000',
  statement:
    'The Widget Platform operated by Acme — the services its user entities reach, the data they ' +
    'submit and the reporting they receive.',
  components: [
    {
      id: 'widget-api',
      kind: 'repo',
      label: 'the widget API',
      disposition: 'inside',
      why: 'It serves every user entity request and holds the request path end to end.',
    },
  ],
  userEntities: [{ id: 'someone', label: 'Someone', why: 'They submit widgets and read the reporting.' }],
  subservice: [],
  census: Object.fromEntries(CENSUS_KINDS.map((k) => [k, { state: 'enumerated' }])),
});

/* ------------------------------------------------- 1. the loaded register is sound */

check('the loaded register validates', () => {
  assert.deepEqual(subjectProblems(), []);
  assert.deepEqual(registryProblems(), []);
});

check('the map key and the record agree about which organisation this is', () => {
  for (const [key, record] of Object.entries(allBoundaries())) assert.equal(record.organisation, key);
});

check('a register whose key disagrees with its record is refused', () => {
  const problems = registryProblems({ elsewhere: wellShaped() });
  assert.ok(
    problems.some((p) => /keyed as "elsewhere" but the record says "acme"/.test(p)),
    problems.join('\n')
  );
});

check('only one organisation may claim to be the first', () => {
  const a = { ...wellShaped(), first: true };
  const b = { ...wellShaped(), organisation: 'beta', first: true };
  const problems = registryProblems({ acme: a, beta: b });
  assert.ok(problems.some((p) => /more than one organisation claims to be the first/.test(p)), problems.join('\n'));
});

check('multi-tenant from the first line: the register is a map, not a constant', () => {
  assert.deepEqual(organisations(), ['acme']);
  assert.equal(typeof allBoundaries(), 'object');
  assert.equal(boundaryFor('nobody-here'), null, 'an organisation with no boundary reads as null, not a throw');
});

check('`only` and `heldBy` answer for an install with exactly one subject', () => {
  assert.equal(only(), allBoundaries()[organisations()[0]]);
  assert.equal(heldBy(), 'acme');
  assert.equal(subjectFile('acme'), acmeSetup.file);
});

/* ---------------------------------------- 2. the census, which is the whole argument */

check('a record with no census at all is refused', () => {
  const r = wellShaped();
  delete r.census;
  const problems = boundaryProblems(r);
  assert.ok(problems.some((p) => /needs a `census`/.test(p)), problems.join('\n'));
});

check('a census missing one kind is refused — the blank this field exists to stop', () => {
  for (const kind of CENSUS_KINDS) {
    const r = wellShaped();
    delete r.census[kind];
    const problems = censusProblems(r);
    assert.ok(
      problems.some((p) => p.includes(`nothing recorded for ${kind}`)),
      `${kind}: ${problems.join('\n')}`
    );
  }
});

check('a partial census must say where the rest is held', () => {
  const r = wellShaped();
  r.census.repo = { state: 'partial' };
  const problems = censusProblems(r);
  assert.ok(problems.some((p) => /must say where the rest is `held`/.test(p)), problems.join('\n'));
  r.census.repo = { state: 'partial', held: 'somewhere real' };
  assert.deepEqual(censusProblems(r), []);
});

check('enumerated and held-elsewhere cannot both be true', () => {
  const r = wellShaped();
  r.census.host = { state: 'enumerated', held: 'somewhere else' };
  const problems = censusProblems(r);
  assert.ok(problems.some((p) => /cannot both be true/.test(p)), problems.join('\n'));
});

check('a census state outside the two is refused, and so is a census of something else', () => {
  const r = wellShaped();
  r.census.egress = { state: 'probably' };
  assert.ok(censusProblems(r).some((p) => /is not one of enumerated, partial/.test(p)));
  const s = wellShaped();
  s.census.weather = { state: 'enumerated' };
  assert.ok(censusProblems(s).some((p) => /not something a boundary has a census of/.test(p)));
});

check('an empty list under a partial census is a finding rather than a blank', () => {
  const r = wellShaped();
  r.subservice = [];
  r.census.subservice = { state: 'partial', held: 'the architecture repo' };
  assert.deepEqual(boundaryProblems(r), [], 'it is a legal record');
  const found = gaps(r);
  assert.ok(
    found.some((g) => g.kind === 'subservice' && g.recorded === 0 && g.held === 'the architecture repo'),
    JSON.stringify(found)
  );
});

check('the same empty list under an enumerated census raises no gap — it means none', () => {
  const r = wellShaped();
  r.subservice = [];
  r.census.subservice = { state: 'enumerated' };
  assert.equal(
    gaps(r).some((g) => g.kind === 'subservice'),
    false
  );
});

/* -------------------------------- 3. dispositions, carve-outs and what they each owe */

check('there is no third disposition — undecided belongs out of the list', () => {
  assert.deepEqual([...DISPOSITIONS], ['inside', 'carved-out']);
  const r = wellShaped();
  r.components[0].disposition = 'unknown';
  const problems = boundaryProblems(r);
  assert.ok(problems.some((p) => /disposition "unknown" is not one of/.test(p)), problems.join('\n'));
});

check('a carve-out with no reason is refused, and the message says why', () => {
  const r = wellShaped();
  r.components.push({ id: 'tooling', kind: 'repo', label: 'some tooling', disposition: 'carved-out', why: 'no' });
  const problems = boundaryProblems(r);
  assert.ok(problems.some((p) => /omission wearing a decision/.test(p)), problems.join('\n'));
});

check('carve-outs are enumerated by construction, and that is said rather than implied', () => {
  assert.equal(CARVE_OUTS_ARE_ENUMERATED, true);
  for (const c of carvedOut(only())) assert.ok(String(c.why).length >= 20, `${c.id} has no reason`);
});

check('a component of an unknown kind is refused', () => {
  const r = wellShaped();
  r.components[0].kind = 'vibe';
  assert.ok(boundaryProblems(r).some((p) => /kind "vibe" is not one of/.test(p)));
});

check('the same id declared twice under one kind is refused', () => {
  const r = wellShaped();
  r.components.push({ ...r.components[0] });
  assert.ok(boundaryProblems(r).some((p) => /declared twice as a repo/.test(p)));
});

check('a subservice organisation must choose carve-out or inclusive — there is no default', () => {
  const r = wellShaped();
  r.subservice = [{ id: 'host-co', label: 'HostCo', provides: 'It runs the platform for us, entirely.' }];
  const problems = boundaryProblems(r);
  assert.ok(problems.some((p) => /is not one of carve-out, inclusive/.test(p)), problems.join('\n'));
});

check('a subservice carve-out with no CUEC is refused — the control would vanish', () => {
  const r = wellShaped();
  r.subservice = [
    { id: 'host-co', label: 'HostCo', method: 'carve-out', provides: 'It runs the platform for us, entirely.' },
  ];
  const problems = boundaryProblems(r);
  assert.ok(problems.some((p) => /owes at least one CUEC/.test(p)), problems.join('\n'));
  r.subservice[0].cuecs = ['The user entity reviews HostCo’s own report annually.'];
  assert.deepEqual(boundaryProblems(r), []);
});

check('an inclusive subservice organisation owes no CUEC — its controls are in the population', () => {
  const r = wellShaped();
  r.subservice = [
    { id: 'host-co', label: 'HostCo', method: 'inclusive', provides: 'It runs the platform for us, entirely.' },
  ];
  assert.deepEqual(boundaryProblems(r), []);
  assert.deepEqual(cuecs(r), []);
});

check('the CUECs flatten across every carved-out subservice organisation', () => {
  const r = wellShaped();
  r.subservice = [
    { id: 'a-co', label: 'ACo', method: 'carve-out', provides: 'It does one thing for us, always.', cuecs: ['one'] },
    { id: 'b-co', label: 'BCo', method: 'inclusive', provides: 'It does another thing for us, always.' },
    { id: 'c-co', label: 'CCo', method: 'carve-out', provides: 'It does a third thing for us, always.', cuecs: ['two', 'three'] },
  ];
  assert.deepEqual(
    cuecs(r).map((c) => `${c.from}:${c.control}`),
    ['a-co:one', 'c-co:two', 'c-co:three']
  );
});

check('the CUEC gap is gated on what can close it, so `--strict` is not permanently red', () => {
  const r = wellShaped();
  r.census.subservice = { state: 'enumerated' };
  r.subservice = [];
  assert.equal(
    gaps(r).some((g) => g.kind === 'cuec'),
    false,
    'a record whose processors really are enumerated and really are none has no CUEC to write'
  );
  r.census.subservice = { state: 'partial', held: 'the architecture repo' };
  assert.ok(gaps(r).some((g) => g.kind === 'cuec'), 'but an unsurveyed one owes the list');
  r.subservice = [
    { id: 'a-co', label: 'ACo', method: 'carve-out', provides: 'It does one thing for us, always.', cuecs: ['one'] },
  ];
  assert.equal(
    gaps(r).some((g) => g.kind === 'cuec'),
    false,
    'and one carve-out with a CUEC against it closes it'
  );
});

/* ------------------------------------------------ 4. what a loaded subject record says */

const acme = boundaryFor('acme');

check('the subject as its file records it is the one loaded', () => {
  assert.ok(acme, 'a boundary is recorded for acme');
  assert.equal(acme.serviceOrganisation, 'Acme');
  assert.equal(acme.system, 'Widget Cloud');
  assert.equal(acme.decidedBy, 'bc-0000');
  assert.equal(acme.first, true, 'the first service organisation, not the only one');
});

check('beadcause is carved out, and the carve-out names what it still bears on', () => {
  const b = carvedOut(acme, 'repo').find((c) => c.id === 'beadcause');
  assert.ok(b, 'beadcause is in the record');
  assert.equal(b.disposition, 'carved-out');
  assert.match(b.bearsOn, /[Cc]hange management/, 'out of the boundary is not out of the audit');
  assert.equal(
    inside(acme).some((c) => c.id === 'beadcause'),
    false
  );
});

check('every agent kind is a named role, because an auditor asks per identity', () => {
  const roles = carvedOut(acme, 'role').map((c) => c.id);
  for (const agent of ['console', 'dispatch', 'advocate', 'epic-advocate', 'worker', 'merge-advocate', 'review-advocate']) {
    assert.ok(roles.includes(`agent-${agent}`), `${agent} is not in the role list`);
  }
});

check('the user entities are named, and each says where it came from', () => {
  const entities = userEntities(acme);
  assert.deepEqual(
    entities.map((e) => e.id).sort(),
    ['globex', 'initech']
  );
  for (const e of entities) assert.equal(e.source, 'bc-0000', `${e.id} has no source`);
});

check('the record admits that the inside of the boundary is not enumerated here', () => {
  const found = gaps(acme);
  assert.ok(found.length > 0, 'a record claiming to know everything would be the failure');
  for (const kind of ['repo', 'host', 'datastore', 'egress', 'role', 'subservice']) {
    const g = found.find((x) => x.kind === kind);
    assert.ok(g, `${kind} is not reported as a gap`);
    assert.ok(g.held.length > 0, `${kind} is partial but says nowhere where the rest is held`);
  }
});

check('named user entities with no CUEC list is itself a gap', () => {
  const g = gaps(acme).find((x) => x.kind === 'cuec');
  assert.ok(g, 'no gap raised for the missing CUEC list');
  assert.match(g.why, /Globex/);
  assert.match(g.why, /Initech/);
});

check('the summary carries the gap count, so a partial census cannot pass unnoticed', () => {
  const line = summarise(acme);
  assert.match(line, /Acme/);
  assert.match(line, new RegExp(`${gaps(acme).length} gaps?`));
});

/* -------------------------------------- 5. the projection lib/election.js actually takes */

check('the declaration satisfies the real boundaryProblems in lib/election.js', () => {
  for (const org of organisations()) {
    assert.deepEqual(electionBoundaryProblems(declaration(boundaryFor(org))), [], `${org} cannot be declared`);
  }
});

check('the declaration is computed, so the scope statement cannot drift from the record', () => {
  const d = declaration(acme);
  assert.equal(d.name, acme.serviceOrganisation);
  assert.ok(d.description.includes(acme.system));
  assert.ok(d.description.includes(acme.statement));
  for (const e of userEntities(acme)) assert.ok(d.description.includes(e.label), `${e.label} is not declared`);
  assert.match(d.description, new RegExp(`${carvedOut(acme).length} components? carved out`));
});

/* --------------------------------------------------- 6. the readers, and the leaf claim */

check('components narrows by kind and by disposition, and by both', () => {
  assert.deepEqual(components(acme, { kind: 'role', disposition: 'inside' }), []);
  assert.equal(components(acme, { kind: 'role' }).length, carvedOut(acme, 'role').length);
  assert.equal(components(acme).length, inside(acme).length + carvedOut(acme).length);
});

check('every reader answers empty rather than throwing on a record that is not one', () => {
  for (const junk of [null, undefined, {}, 'nonsense', 42]) {
    assert.deepEqual(inside(junk), []);
    assert.deepEqual(carvedOut(junk), []);
    assert.deepEqual(userEntities(junk), []);
    assert.deepEqual(subservice(junk), []);
    assert.deepEqual(cuecs(junk), []);
    assert.deepEqual(gaps(junk), []);
  }
  assert.ok(boundaryProblems(null).length, 'but validation still says so');
});

check('the vocabularies are frozen, so nothing widens them at runtime', () => {
  for (const v of [KINDS, DISPOSITIONS, METHODS, CENSUS, CENSUS_KINDS]) assert.ok(Object.isFrozen(v));
});

/* ------------------------------ 7. the subject comes from config, and fails out loud */

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-boundary-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const broken = () => {
  const s = acmeSubject();
  delete s.boundary.census;
  return s;
};

check('with no subject configured there is no boundary, and every reader answers empty', () => {
  loadSubjects(null);
  assert.deepEqual(organisations(), []);
  assert.equal(only(), null);
  assert.equal(heldBy(), null, 'no default subject — nobody is a truer answer than a guess');
  assert.equal(boundaryFor('acme'), null);
  assert.deepEqual(subjectProblems(), [], 'not configuring one is not a problem');
  const pick = chooseSubject();
  assert.equal(pick.org, null);
  assert.equal(pick.unconfigured, true);
  assert.equal(pick.problem, NO_SUBJECT);
  assert.ok(NO_SUBJECT.includes(SUBJECTS_KEY), 'the sentence names the key to set');
  assert.equal(NO_SUBJECT.split('\n').length, 1, 'and it is one line');
});

check('a command with no subject says so in one line and exits cleanly', () => {
  loadSubjects({});
  const out = [];
  const err = [];
  const pick = commandSubject('tool', null, { log: (s) => out.push(s), error: (s) => err.push(s) });
  assert.equal(pick.exit, 0);
  assert.deepEqual(err, []);
  assert.equal(out.length, 1);
  assert.match(out[0], /^tool: no compliance subject is configured — set compliance\.subjects in /);
});

check('a subject file that fails validation is left out, and the problem names the key, the file and the field', () => {
  const file = writeSubject(scratch, broken(), 'broken.json');
  const read = readSubject('acme', file);
  assert.equal(read.subject, null);
  assert.ok(read.problems.some((p) => p.startsWith('compliance.subjects.acme: boundary: a boundary needs a `census`')), read.problems.join('\n'));
  loadSubjects({ acme: file });
  assert.deepEqual(organisations(), [], 'a broken boundary is never read as "nothing is carved out"');
  assert.ok(subjectProblems().length > 0);
  const out = [];
  const err = [];
  const pick = commandSubject('tool', null, { log: (s) => out.push(s), error: (s) => err.push(s) });
  assert.equal(pick.exit, 1, 'broken is not the same as unconfigured');
  assert.equal(pick.unconfigured, false);
  assert.ok(err.some((e) => e.includes(file)), err.join('\n'));
  assert.deepEqual(out, []);
});

check('missing, unreadable-as-JSON and mis-keyed files are each a sentence, never a throw', () => {
  const missing = readSubject('acme', path.join(scratch, 'nope.json'));
  assert.match(missing.problems[0], /cannot read .*nope\.json — ENOENT/);
  const garbled = path.join(scratch, 'garbled.json');
  fs.writeFileSync(garbled, '{ not json');
  assert.match(readSubject('acme', garbled).problems[0], /is not JSON/);
  const good = writeSubject(scratch, acmeSubject(), 'good.json');
  assert.ok(readSubject('globex', good).problems.some((p) => /configured as "globex" but the file says "acme"/.test(p)));
  assert.ok(readSubject('default', good).problems.some((p) => /compliance\.subjects\.default: /.test(p)), 'a reserved org id is refused');
  assert.ok(readSubject('acme', 42).problems.some((p) => /must be the path of a subject file/.test(p)));
  assert.deepEqual(loadSubjects(['not', 'a', 'map']).problems, [`${SUBJECTS_KEY} must be an object mapping an organisation id to a subject file`]);
});

check('the shape is checked, so a typo is a refusal rather than a section read as absent', () => {
  assert.deepEqual(subjectShapeProblems(acmeSubject(), 'acme'), []);
  assert.ok(subjectShapeProblems({ ...acmeSubject(), comitments: [] }, 'acme').some((p) => /"comitments" is not a field/.test(p)));
  assert.ok(subjectShapeProblems({ ...acmeSubject(), commitments: {} }, 'acme').some((p) => /`commitments` must be a list/.test(p)));
  assert.ok(subjectShapeProblems({ ...acmeSubject(), assessment: { rows: {} } }, 'acme').some((p) => /`rows` must be a list/.test(p)));
  const s = acmeSubject();
  delete s.boundary;
  assert.ok(subjectShapeProblems(s, 'acme').some((p) => /`boundary` is required/.test(p)));
  assert.deepEqual(subjectShapeProblems('nonsense', 'acme'), ['a subject file must be a JSON object']);
});

check('one broken subject does not take a sound one down with it', () => {
  const good = writeSubject(scratch, acmeSubject(), 'good.json');
  const other = { ...acmeSubject(), organisation: 'beta' };
  other.boundary = { ...other.boundary, organisation: 'beta', first: false };
  delete other.boundary.census;
  const bad = writeSubject(scratch, other, 'beta.json');
  loadSubjects({ acme: good, beta: bad });
  assert.deepEqual(organisations(), ['acme']);
  assert.ok(subjectProblems().length > 0);
  assert.ok(subjectProblems().every((p) => /^compliance\.subjects\.beta: /.test(p)), subjectProblems().join('\n'));
});

check('two subjects both claiming to be first is said', () => {
  const good = writeSubject(scratch, acmeSubject(), 'good.json');
  const other = acmeSubject();
  other.organisation = 'beta';
  other.boundary.organisation = 'beta';
  const second = writeSubject(scratch, other, 'beta-first.json');
  const read = loadSubjects({ acme: good, beta: second });
  assert.ok(read.problems.some((p) => /more than one organisation claims to be the first: acme, beta/.test(p)));
  assert.equal(heldBy(), null, 'two subjects and no name is not a question this answers');
  assert.match(chooseSubject().problem, /2 subjects are loaded \(acme, beta\) — name the one you mean/);
  assert.equal(chooseSubject('beta').org, 'beta');
});

check('a loaded subject is frozen all the way down', () => {
  loadSubjects({ acme: acmeSetup.file });
  const s = subjectFor('acme');
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.boundary.components[0]) && Object.isFrozen(s.assessment.rows));
  assert.throws(() => s.boundary.userEntities.push({}), TypeError);
});

check('beadcause-boundary reads the config file an install has, and fails out loud on a broken subject', () => {
  const run = (configDir, args = []) =>
    spawnSync(process.execPath, [path.join(ROOT, 'bin/boundary.js'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, BEADCAUSE_CONFIG_DIR: configDir },
    });

  const empty = path.join(scratch, 'empty-config');
  fs.mkdirSync(empty);
  const none = run(empty);
  assert.equal(none.status, 0, none.stderr);
  assert.equal(none.stdout.trim().split('\n').length, 1, none.stdout);
  assert.match(none.stdout, /compliance\.subjects/);
  assert.equal(fs.existsSync(path.join(empty, 'config.json')), false, 'asking for a boundary writes no config');

  const shown = run(acmeSetup.configDir);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /^Acme — Widget Cloud/);
  assert.match(shown.stdout, /read from .*acme-subject\.json/);
  assert.equal(run(acmeSetup.configDir, ['gaps', '--strict']).status, 1, 'the partial censuses are gaps');

  const badDir = path.join(scratch, 'bad-config');
  configureSubjects(badDir, { acme: writeSubject(scratch, broken(), 'broken-cli.json') });
  const bad = run(badDir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /compliance\.subjects\.acme: boundary: a boundary needs a `census`/);
  assert.doesNotMatch(bad.stderr, /at .*\.js:\d+/, 'a sentence, not a stack trace');
});

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
