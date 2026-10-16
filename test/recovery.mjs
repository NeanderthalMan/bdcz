#!/usr/bin/env node
//
// Recovery testing (SOC 2 A1.3) — a log of restores that goes red when one is owed —
// `lib/recovery.js` and `bin/recovery.js`.
//
//   npm test
//   node test/recovery.mjs
//
// bc-4r10.11: "the restore test is a bead that fails when it has not run". So the first
// thing pinned below is that a subject with no restore logged is RED, not empty; then that
// each in-scope component is held to the interval on its own, that a failed restore keeps
// the component red until a later one succeeds, and that the bead the CLI prints is dated
// today when the test is already owed.
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadSubjects, subjectShapeProblems } from '../lib/boundary.js';
import { isControl, satisfiedBy } from '../lib/controls.js';
import {
  CRITERIA,
  MAX_INTERVAL_MONTHS,
  RED,
  STATES,
  recovery,
  recurringBead,
  registerProblems,
  restorable,
  sectionProblems,
  status,
  testProblems,
} from '../lib/recovery.js';
import { acmeSubject, configureSubjects, writeSubject } from './helpers/subject.mjs';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'recovery.js');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message.split('\n').join('\n      ')}`);
  }
}

const NOW = new Date('2026-10-04T12:00:00Z');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-recovery-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

const inside = (kind, id) => ({
  id,
  kind,
  label: id,
  disposition: 'inside',
  why: `The ${id} serves Globex and Initech directly and holds what they submit.`,
});

/** Acme, with two restorable components inside the boundary and the given recovery section. */
function subject(section) {
  const s = acmeSubject();
  s.boundary.components.push(inside('datastore', 'orders-db'), inside('host', 'app-host'));
  if (section !== undefined) s.recovery = section;
  return s;
}

/** Load a subject as `acme` in this process, and return the file it was written to. */
function load(section, name = 'acme.json') {
  const file = writeSubject(path.join(tmp, 'org'), subject(section), name);
  const loaded = loadSubjects({ acme: file });
  assert.deepEqual(loaded.problems ?? [], [], 'the fixture subject did not load');
  return file;
}

const restore = (date, restored, outcome = 'restored', extra = {}) => ({
  date,
  restored,
  from: `the nightly snapshot taken the day before ${date}`,
  by: 'Ops On-call',
  transcript: 'OPS-412',
  outcome,
  ...extra,
});
const section = (tests, intervalMonths = 12) => ({ ownerRole: 'operations lead', intervalMonths, tests });

console.log('never run is red');

await check('a subject with no recovery section is `never`, and `never` is red', () => {
  load(undefined);
  assert.equal(recovery('acme'), null);
  const s = status('acme', NOW);
  assert.equal(s.state, 'never');
  assert.equal(s.red, true);
  assert.deepEqual(s.components.map((c) => [c.id, c.state]), [['orders-db', 'never'], ['app-host', 'never']]);
});

await check('an empty tests list is `never` too — a plan with no restore is not a test', () => {
  load(section([]));
  assert.deepEqual(registerProblems('acme', NOW), []);
  assert.equal(status('acme', NOW).state, 'never');
});

await check('the red states are never, failed and overdue, in worst-first order', () => {
  assert.deepEqual(RED, ['never', 'failed', 'overdue']);
  assert.deepEqual(STATES.slice(0, 3), RED);
});

console.log('\nthe interval, per component');

await check('restoring one component does not cover the other — the overall state is the worst', () => {
  load(section([restore('2026-09-01', ['orders-db'])]));
  const s = status('acme', NOW);
  assert.equal(s.components.find((c) => c.id === 'orders-db').state, 'current');
  assert.equal(s.components.find((c) => c.id === 'app-host').state, 'never');
  assert.equal(s.state, 'never');
});

await check('both restored this year is current, due a year after the older one', () => {
  load(section([restore('2026-03-15', ['app-host']), restore('2026-09-01', ['orders-db'])]));
  const s = status('acme', NOW);
  assert.equal(s.state, 'current');
  assert.equal(s.red, false);
  assert.equal(s.due, '2027-03-15');
});

await check('within the warning window is approaching, and past it is overdue', () => {
  load(section([restore('2025-10-20', ['orders-db', 'app-host'])]));
  assert.equal(status('acme', NOW).state, 'approaching');
  load(section([restore('2025-09-01', ['orders-db', 'app-host'])]));
  const s = status('acme', NOW);
  assert.equal(s.state, 'overdue');
  assert.equal(s.red, true);
});

await check('a shorter interval moves the due date with it', () => {
  load(section([restore('2026-03-01', ['orders-db', 'app-host'])], 6));
  assert.equal(status('acme', NOW).components[0].due, '2026-09-01');
  assert.equal(status('acme', NOW).state, 'overdue');
});

console.log('\na failed restore');

await check('a failure after the last success keeps the component red', () => {
  load(
    section([
      restore('2026-02-01', ['orders-db', 'app-host']),
      restore('2026-09-01', ['orders-db'], 'failed', { changed: 'the snapshot schedule moved to hourly — bc-0099' }),
    ])
  );
  const s = status('acme', NOW);
  assert.equal(s.components.find((c) => c.id === 'orders-db').state, 'failed');
  assert.equal(s.state, 'failed');
  assert.equal(s.red, true);
});

await check('a later success clears it, and the failure stays in the log', () => {
  load(
    section([
      restore('2026-09-01', ['orders-db', 'app-host'], 'failed', { changed: 'the snapshot schedule moved to hourly — bc-0099' }),
      restore('2026-09-20', ['orders-db', 'app-host']),
    ])
  );
  assert.equal(status('acme', NOW).state, 'current');
  assert.equal(recovery('acme').tests.length, 2);
});

await check('a failure that does not say what the plan changed is refused', () => {
  const p = testProblems(restore('2026-09-01', ['orders-db'], 'failed'), { now: NOW });
  assert.ok(p.some((x) => /`changed`/.test(x)), p.join('\n'));
});

console.log('\nwhat an entry must carry');

await check('a well-formed log passes against its own boundary', () => {
  load(section([restore('2026-09-01', ['orders-db', 'app-host'])]));
  assert.deepEqual(restorable('acme'), ['orders-db', 'app-host']);
  assert.deepEqual(registerProblems('acme', NOW), []);
});

await check('a restore of a carved-out component, or one the boundary never named, is refused', () => {
  load(section([restore('2026-09-01', ['beadcause-host']), restore('2026-09-02', ['nowhere-db'])]));
  const p = registerProblems('acme', NOW);
  assert.ok(p.some((x) => /"beadcause-host" is not/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /"nowhere-db" is not/.test(x)), p.join('\n'));
});

await check('no source, no performer, no transcript, a future date and a made-up outcome are each refused', () => {
  const p = testProblems(
    { date: '2026-12-01', restored: ['orders-db'], from: 'backup', by: '', transcript: '', outcome: 'fine' },
    { now: NOW }
  );
  for (const re of [/has not happened yet/, /`from`/, /`by`/, /`transcript`/, /`outcome`/]) {
    assert.ok(p.some((x) => re.test(x)), `${re} not among:\n${p.join('\n')}`);
  }
});

await check(`an interval past ${MAX_INTERVAL_MONTHS} months, or a log out of date order, is refused`, () => {
  const p = sectionProblems(section([restore('2026-09-01', ['orders-db']), restore('2026-03-01', ['orders-db'])], 24), {
    now: NOW,
  });
  assert.ok(p.some((x) => /intervalMonths/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /date order/.test(x)), p.join('\n'));
});

await check('the subject file accepts `recovery` as an object and refuses it as anything else', () => {
  assert.deepEqual(subjectShapeProblems(subject(section([])), 'acme'), []);
  const bad = subjectShapeProblems(subject([]), 'acme');
  assert.ok(bad.some((x) => /`recovery` must be an object/.test(x)), bad.join('\n'));
});

console.log('\nthe recurring bead');

await check('when it is owed, the bead is due today and names what is owed', () => {
  load(section([restore('2026-09-01', ['orders-db'])]));
  const s = status('acme', NOW);
  const bead = recurringBead('acme', s, NOW);
  assert.equal(bead.due, '2026-10-04');
  assert.match(bead.title, /app-host/);
  assert.doesNotMatch(bead.title, /orders-db/);
});

await check('when it is current, the bead is due on the earliest due date', () => {
  load(section([restore('2026-03-15', ['app-host']), restore('2026-09-01', ['orders-db'])]));
  assert.equal(recurringBead('acme', status('acme', NOW), NOW).due, '2027-03-15');
});

console.log('\nthe criteria');

await check('every criterion this register claims is one the corpus mints', () => {
  for (const id of CRITERIA) assert.ok(isControl(id), id);
});

await check('backup testing and information deletion crosswalk into A1.3 and C1.2', () => {
  assert.ok(satisfiedBy('SOC2.A1.3').includes('ISO27001.A.8.13'));
  assert.ok(satisfiedBy('SOC2.C1.2').includes('ISO27001.A.8.10'));
});

console.log('\nthe command');

const run = (args, configDir) =>
  spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, BEADCAUSE_CONFIG_DIR: configDir },
  });

await check('with no subject configured it says so in one line and exits 0', () => {
  const dir = path.join(tmp, 'empty-config');
  configureSubjects(dir, {});
  const r = run([], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no compliance subject is configured/);
});

await check('never run prints NEVER, and --strict exits 1 on it', () => {
  const dir = path.join(tmp, 'never-config');
  configureSubjects(dir, { acme: writeSubject(path.join(tmp, 'never'), subject(undefined)) });
  const r = run([], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^acme: NEVER/);
  assert.match(r.stdout, /never\s+orders-db/);
  assert.equal(run(['--strict'], dir).status, 1);
});

await check('--bead prints a bd create line with a due date, and --json carries the state', () => {
  const dir = path.join(tmp, 'bead-config');
  configureSubjects(dir, { acme: writeSubject(path.join(tmp, 'bead'), subject(section([]))) });
  const r = run(['--bead'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^bd create --type task --title '.*' --due \d{4}-\d{2}-\d{2} --description '/);
  const j = JSON.parse(run(['--json'], dir).stdout);
  assert.equal(j.state, 'never');
  assert.equal(j.red, true);
});

await check('a log that fails its checks is refused with the problem named, exit 1', () => {
  const dir = path.join(tmp, 'bad-config');
  const bad = subject(section([restore('2026-09-01', ['nowhere-db'])]));
  configureSubjects(dir, { acme: writeSubject(path.join(tmp, 'bad'), bad) });
  const r = run([], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /"nowhere-db" is not/);
});

console.log(failures ? `\n${failures} failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
