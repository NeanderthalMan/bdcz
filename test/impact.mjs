#!/usr/bin/env node
//
// No agent may change what it is without an impact assessment — `lib/impact.js`.
//
//   npm test
//   node test/impact.mjs
//
// bc-eqn1.6: ISO/IEC 42001 Clause 6.1.4 and Annex A.5, run the way ISO/IEC 42005 asks. An
// assessment is a record with a template, an approver and an expiry, one per AI system,
// and two refusals read it: an amendment that widens an agent, and a new agent kind. The
// checks below are in four groups — the register and every rule in it can be shown to
// fail; "widening" means what lib/impact.js says and fails closed; the gate refuses a
// widening and lets a narrowing through; and the refusal reaches the foundations ref and
// the bead, in lib/capa.js's shape, only while the management system is on.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-impact-'));

// Before anything imports lib/config.js: the management switch lives in CONFIG_DIR, and
// this suite turns it on. Never the real one.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const impact = await import('../lib/impact.js');
const foundation = await import('../lib/foundation.js');
const { SYSTEM, SYSTEMS } = await import('../lib/systemcard.js');
const { control } = await import('../lib/controls.js');
const { clause, enforcementProblems, ROLES } = await import('../lib/aims.js');
const { parseRefusal, REFUSAL_LABEL } = await import('../lib/capa.js');
const management = await import('../lib/management.js');
const amendment = await import('../lib/amendment.js');

const {
  REGISTER,
  PREDATES_GATE,
  CONTROL,
  CONTROLS,
  TEMPLATE,
  VALIDITY_MONTHS,
  amendmentGate,
  assessmentFor,
  coverageProblems,
  coveredForm,
  digest,
  entryProblems,
  registerProblems,
  status,
  widening,
} = impact;

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

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(tmp, 'repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root'], {
    cwd: dir,
  });
  return dir;
}

const NOW = new Date('2026-10-04T12:00:00Z');
const holder = ROLES.find((r) => r.id === 'impact-approver').holder;

/** The real draft for an agent, approved — the way a person would approve it, digest and all. */
function approved(system, { on = '2026-10-01', expiresOn = '2027-10-01', alsoCovers = null } = {}) {
  const base = { ...assessmentFor(system), awaitingApproval: null };
  if (alsoCovers) base.alsoCovers = alsoCovers;
  const e = { ...base, approval: { role: 'impact-approver', by: holder, on, expiresOn, digest: '' } };
  e.approval.digest = digest(e);
  return e;
}

/** One sound draft, to be broken a field at a time. */
const sound = () => structuredClone({ ...assessmentFor('dispatch') });

const broken = (mutate) => {
  const e = sound();
  mutate(e);
  return entryProblems(e);
};

console.log('the register');

await check('every AI system has exactly one assessment, and the real register is clean', () => {
  assert.deepEqual(REGISTER.map((e) => e.system).sort(), [...SYSTEMS].sort());
  const { problems } = registerProblems(REGISTER, NOW);
  assert.deepEqual(problems, []);
  assert.deepEqual(coverageProblems({ now: NOW }), []);
});

// Not "every assessment is a draft": the day the approver signs one, that would be a test
// failing on the control working. What must always hold is that a draft is never current
// and always says so.
await check('a draft is never current, and the repo says it is waiting', () => {
  const { warnings } = registerProblems(REGISTER, NOW);
  for (const e of REGISTER.filter((x) => x.approval === null)) {
    assert.equal(status(e, NOW).current, false);
    assert.equal(status(e, NOW).state, 'draft');
    assert.ok(warnings.some((w) => w.startsWith(`REGISTER[${e.system}]: draft`)), `${e.system} is a silent draft`);
  }
});

await check('every control the register cites is a real id in lib/controls.js', () => {
  assert.ok(CONTROLS.includes(CONTROL));
  for (const id of CONTROLS) assert.ok(control(id), `${id} is not in the corpus`);
  for (const t of TEMPLATE) assert.ok(control(t.cites), `template field ${t.field} cites ${t.cites}, which is not in the corpus`);
});

await check('the systems that predate the gate are pinned — the list may shrink and never grow', () => {
  const ORIGINAL = ['beadcause', 'console', 'dispatch', 'advocate', 'epic-advocate', 'worker', 'merge-advocate', 'review-advocate'];
  for (const s of PREDATES_GATE) {
    assert.ok(ORIGINAL.includes(s), `${s} was added to PREDATES_GATE — a new system ships with an approved assessment instead`);
  }
});

console.log('every rule fails when broken');

await check('a sound draft has no problems', () => assert.deepEqual(entryProblems(sound()), []));

await check('a system that is not in the register', () => {
  assert.match(broken((e) => (e.system = 'nobody')).join('\n'), /`system` must be one of/);
});

await check('every template field is owed', () => {
  for (const field of ['context', 'benefits', 'residual', 'reassessWhen']) {
    assert.match(broken((e) => (e[field] = 'tbd')).join('\n'), new RegExp(`\`${field}\``), field);
  }
});

await check('an impact on a party aims.js does not name, or at no known scale', () => {
  assert.match(broken((e) => (e.impacts = [{ ...e.impacts[0], party: 'martians' }, ...e.impacts.slice(1)])).join('\n'), /martians/);
  assert.match(broken((e) => (e.impacts = [{ ...e.impacts[0], scale: 'cosmic' }, ...e.impacts.slice(1)])).join('\n'), /`scale`/);
  assert.match(broken((e) => (e.impacts = [{ ...e.impacts[0], harm: '' }, ...e.impacts.slice(1)])).join('\n'), /`harm`/);
  assert.match(broken((e) => (e.impacts = [{ ...e.impacts[0], mitigation: '' }, ...e.impacts.slice(1)])).join('\n'), /`mitigation`/);
});

await check('no societal impact (A.5.5), or none on individuals or groups (A.5.4)', () => {
  assert.match(broken((e) => (e.impacts = e.impacts.filter((i) => i.scale !== 'society'))).join('\n'), /A\.5\.5/);
  assert.match(broken((e) => (e.impacts = e.impacts.filter((i) => i.scale === 'society'))).join('\n'), /A\.5\.4/);
  assert.match(broken((e) => (e.impacts = [])).join('\n'), /at least one/);
});

await check('alsoCovers may name only capability fields, and beadcause can cover nothing', () => {
  assert.match(broken((e) => (e.alsoCovers = { writes: true })).join('\n'), /may name only/);
  assert.match(broken((e) => (e.alsoCovers = [])).join('\n'), /must be an object/);
  const b = structuredClone({ ...assessmentFor(SYSTEM), alsoCovers: { allowedTools: ['Read'] } });
  assert.match(entryProblems(b).join('\n'), /no amendable form/);
});

await check('a draft must say whose approval it waits for', () => {
  assert.match(broken((e) => (e.awaitingApproval = null)).join('\n'), /awaitingApproval/);
});

await check('an approval is checked against lib/aims.js — the role, its holder, the digest, the expiry', () => {
  assert.deepEqual(entryProblems(approved('dispatch')), []);

  const wrongRole = approved('dispatch');
  wrongRole.approval.role = 'aims-manager';
  wrongRole.approval.digest = digest(wrongRole);
  assert.match(entryProblems(wrongRole).join('\n'), /may not approve an impact assessment/);

  const wrongHolder = approved('dispatch');
  wrongHolder.approval.by = 'Somebody Else';
  assert.match(entryProblems(wrongHolder).join('\n'), /held by/);

  const edited = approved('dispatch');
  edited.residual = `${edited.residual} And something softened after the approval.`;
  assert.match(entryProblems(edited).join('\n'), /changed after it was approved/);

  const widenedAfter = approved('dispatch');
  widenedAfter.alsoCovers = { allowedTools: ['Bash(rm:*)'] };
  assert.match(entryProblems(widenedAfter).join('\n'), /changed after it was approved/);

  const long = approved('dispatch', { expiresOn: '2028-01-01' });
  assert.match(entryProblems(long).join('\n'), new RegExp(`at most ${VALIDITY_MONTHS} months`));

  const both = approved('dispatch');
  both.awaitingApproval = holder;
  assert.match(entryProblems(both).join('\n'), /one of them is not true/);
});

await check('status: missing, draft, invalid, expired, current', () => {
  assert.equal(status(null, NOW).state, 'missing');
  assert.equal(status(sound(), NOW).state, 'draft');
  const bad = approved('dispatch');
  bad.approval.digest = 'deadbeef';
  assert.equal(status(bad, NOW).state, 'invalid');
  assert.equal(status(approved('dispatch', { on: '2025-09-01', expiresOn: '2026-09-01' }), NOW).state, 'expired');
  const ok = status(approved('dispatch'), NOW);
  assert.equal(ok.state, 'current');
  assert.equal(ok.current, true);
});

await check('an expired approval fails the repo, and one close to expiry warns', () => {
  const expired = approved('dispatch', { on: '2025-09-01', expiresOn: '2026-09-01' });
  assert.match(registerProblems([expired], NOW).problems.join('\n'), /expired on 2026-09-01/);
  const soon = approved('dispatch', { on: '2025-10-20', expiresOn: '2026-10-20' });
  assert.match(registerProblems([soon], NOW).warnings.join('\n'), /expires 2026-10-20/);
});

console.log('a new agent kind');

await check('a system with no assessment fails the repo', () => {
  const out = coverageProblems({ systems: [...SYSTEMS, 'scribe'], now: NOW });
  assert.match(out.join('\n'), /scribe is an AI system with no impact assessment/);
});

await check('a new system with only a draft fails — it must ship with an approved, current one', () => {
  const draftEntry = { ...sound(), system: 'scribe' };
  const out = coverageProblems({ register: [...REGISTER, draftEntry], systems: [...SYSTEMS, 'scribe'], now: NOW });
  assert.match(out.join('\n'), /scribe is a new AI system and its impact assessment is a draft/);
  assert.match(out.join('\n'), new RegExp(CONTROL.replace(/\./g, '\\.')));
});

await check('a new system with an approved, current assessment passes', () => {
  const e = { ...approved('dispatch'), system: 'scribe' };
  e.approval = { ...e.approval, digest: digest(e) };
  const out = coverageProblems({ register: [...REGISTER, e], systems: [...SYSTEMS, 'scribe'], now: NOW });
  assert.deepEqual(out, []);
});

await check('an assessment about a system that does not exist, or two about one', () => {
  assert.match(coverageProblems({ register: [...REGISTER, { ...sound(), system: 'ghost' }], now: NOW }).join('\n'), /ghost, which is not/);
  assert.match(coverageProblems({ register: [...REGISTER, sound()], now: NOW }).join('\n'), /2 assessments for dispatch/);
});

console.log('what widening means');

await check('an allowlist entry added widens; one removed does not', () => {
  const from = { allowedTools: ['Read', 'Grep'] };
  assert.deepEqual(widening(from, { allowedTools: ['Read', 'Grep', 'Edit'] }), [{ field: 'allowedTools', added: ['Edit'] }]);
  assert.deepEqual(widening(from, { allowedTools: ['Read'] }), []);
  assert.deepEqual(widening({ allowedTools: null }, { allowedTools: ['Read'] }).length, 1);
});

await check('matching is exact, so a broader entry is never covered by a narrower one', () => {
  assert.equal(widening({ allowedTools: ['Bash(git log:*)'] }, { allowedTools: ['Bash'] }).length, 1);
});

await check('tools: lifting a restriction widens, imposing one does not', () => {
  assert.equal(widening({ tools: ['Read'] }, { tools: null }).length, 1);
  assert.equal(widening({ tools: ['Read'] }, { tools: ['Read', 'Bash'] }).length, 1);
  assert.deepEqual(widening({ tools: null }, { tools: ['Read'] }), []);
  assert.deepEqual(widening({ tools: ['Read', 'Bash'] }, { tools: ['Read'] }), []);
});

await check('permissionMode: less supervision widens, more does not, and an unknown mode is the widest', () => {
  assert.equal(widening({ permissionMode: null }, { permissionMode: 'auto' }).length, 1);
  assert.deepEqual(widening({ permissionMode: null }, { permissionMode: 'plan' }), []);
  assert.deepEqual(widening({ permissionMode: 'auto' }, { permissionMode: 'default' }), []);
  assert.equal(widening({ permissionMode: 'bypassPermissions' }, { permissionMode: 'yolo' }).length, 0);
  assert.equal(widening({ permissionMode: 'auto' }, { permissionMode: 'yolo' }).length, 1);
});

await check('fields that are not capability — model, role, env — never widen', () => {
  assert.deepEqual(widening({ model: 'haiku' }, { model: 'opus', role: 'x', env: { A: '1' } }), []);
});

await check('an assessment covers its shipped baseline plus what it names in alsoCovers', () => {
  const e = approved('dispatch', { alsoCovers: { allowedTools: ['Bash(git log:*)'] } });
  const form = coveredForm(e);
  for (const t of foundation.baseline('dispatch').allowedTools) assert.ok(form.allowedTools.includes(t));
  assert.ok(form.allowedTools.includes('Bash(git log:*)'));
});

console.log('the gate, as a function');

const dispatch = () => foundation.baseline('dispatch');
const plus = (t) => ({ ...dispatch(), allowedTools: [...dispatch().allowedTools, t] });

await check('a narrowing passes with no assessment anywhere', () => {
  const to = { ...dispatch(), allowedTools: dispatch().allowedTools.slice(1) };
  assert.equal(amendmentGate({ agent: 'dispatch', from: dispatch(), to, register: [], now: NOW }), null);
});

await check('a widening against a draft is refused, naming the control and what widened', () => {
  const out = amendmentGate({ agent: 'dispatch', from: dispatch(), to: plus('Bash(git log:*)'), now: NOW });
  assert.ok(out);
  assert.equal(out.record.control, CONTROL);
  assert.equal(out.record.gate, 'impact-assessment');
  assert.match(out.record.why, /Bash\(git log:\*\)/);
  assert.match(out.record.why, /is a draft/);
});

await check('a widening the current assessment covers passes; one it does not cover is refused', () => {
  const e = approved('dispatch', { alsoCovers: { allowedTools: ['Bash(git log:*)'] } });
  assert.equal(amendmentGate({ agent: 'dispatch', from: dispatch(), to: plus('Bash(git log:*)'), register: [e], now: NOW }), null);
  const out = amendmentGate({ agent: 'dispatch', from: dispatch(), to: plus('Bash(rm:*)'), register: [e], now: NOW });
  assert.match(out.record.why, /does not cover allowedTools \+Bash\(rm:\*\)/);
});

await check('an expired assessment covers nothing', () => {
  const e = approved('dispatch', { on: '2025-09-01', expiresOn: '2026-09-01', alsoCovers: { allowedTools: ['Bash(git log:*)'] } });
  const out = amendmentGate({ agent: 'dispatch', from: dispatch(), to: plus('Bash(git log:*)'), register: [e], now: NOW });
  assert.match(out.record.why, /expired/);
});

console.log('the gate, in amend()');

// The fixture every amendment test here uses: a widening that owes its card sentence too,
// because the card gate (cardGap) stands in front of this one and refuses without it.
const WIDEN = (dir) => ({
  allowedTools: [...foundation.baseline('dispatch').allowedTools, 'Bash(git log:*)'],
  intendedUse: 'Answering comments about a repo, and now naming the commit a line came from.',
});

await check('with the management system off, a widening goes through as it always did', async () => {
  const dir = tempRepo();
  await foundation.amend(dir, 'dispatch', WIDEN(dir), { management: false, by: 'test' });
  assert.ok((await foundation.effective(dir, 'dispatch')).allowedTools.includes('Bash(git log:*)'));
});

await check('with it on, the widening is refused, nothing is amended, and the refusal is on the ref', async () => {
  const dir = tempRepo();
  const err = await foundation
    .amend(dir, 'dispatch', WIDEN(dir), { management: true, bead: 'beadcause/bc-1', by: 'test', now: NOW })
    .then(() => null, (e) => e);
  assert.ok(err, 'the amendment was not refused');
  assert.equal(err.status, 422);
  assert.equal(err.refusal.control, CONTROL);
  assert.match(err.message, /impact assessment gate/);

  const f = await foundation.effective(dir, 'dispatch');
  assert.ok(!f.allowedTools.includes('Bash(git log:*)'), 'a refused amendment took effect');
  assert.deepEqual(f.amended, []);
  const refused = f.amendments.filter((a) => a.outcome === 'refused');
  assert.equal(refused.length, 1);
  assert.equal(refused[0].control, CONTROL);
  assert.equal(refused[0].bead, 'beadcause/bc-1');

  const [top] = await foundation.history(dir, { agent: 'dispatch' });
  assert.match(top.subject, /^dispatch: refused allowedTools/);
  assert.match(top.message, /ISO42001\.Clause6\.1\.4/);
});

await check('with it on, a narrowing and a non-capability amendment still pass', async () => {
  const dir = tempRepo();
  const narrower = foundation.baseline('dispatch').allowedTools.filter((t) => t !== 'WebSearch');
  await foundation.amend(
    dir,
    'dispatch',
    { allowedTools: narrower, intendedUse: 'Answering comments about a repo, without searching the web.' },
    { management: true, by: 'test', now: NOW }
  );
  await foundation.amend(dir, 'dispatch', { timeoutMs: 1234 }, { management: true, by: 'test', now: NOW });
  const f = await foundation.effective(dir, 'dispatch');
  assert.ok(!f.allowedTools.includes('WebSearch'));
  assert.equal(f.timeoutMs, 1234);
});

await check('with it on, an approved assessment that covers the widening lets it through', async () => {
  const dir = tempRepo();
  const e = approved('dispatch', { alsoCovers: { allowedTools: ['Bash(git log:*)'] } });
  await foundation.amend(dir, 'dispatch', WIDEN(dir), { management: true, assessments: [e], by: 'test', now: NOW });
  assert.ok((await foundation.effective(dir, 'dispatch')).allowedTools.includes('Bash(git log:*)'));
});

console.log('the refusal reaches the bead');

await check('an approved request refused by the gate is commented and labelled on its bead, and the question stays open', async () => {
  // The real switch this time, not the option: resolveAmendment does not pass one.
  await management.enable({ reason: 'test/impact.mjs exercises the gate', by: 'test' });
  assert.equal(await management.isOn(), true);

  const dir = tempRepo();
  const REQUEST = `\`\`\`amendment
agent: dispatch
kind: prohibited
scope: reading git history in the repo I am already reading; no writes, no other repo
justification: |
  The comment asked which commit introduced the bug, and I could only guess at the file.
evidence: |
  Bash(git log --oneline -20) was denied.
set:
  intendedUse: Answering comments about a repo, and now naming the commit a line came from.
add:
  allowedTools:
    - Bash(git log:*)
\`\`\`
`;
  const request = amendment.parseAmendment(REQUEST);
  assert.ok(request && !request.error, request?.error);
  const f = await foundation.effective(dir, 'dispatch');
  const issue = { id: 'bc-1', description: amendment.amendmentBody(request, f, { workspace: 'beadcause' }) };
  const comments = [];
  const labels = [];
  const bd = {
    show: async () => issue,
    comment: async (_ws, id, text) => comments.push({ id, text }),
    addLabel: async (_ws, id, label) => labels.push({ id, label }),
  };

  const err = await amendment
    .resolveAmendment(bd, { name: 'beadcause', dir }, dir, 'bc-1', 'AMEND: apply it.')
    .then(() => null, (e) => e);
  assert.ok(err?.refusal, 'the approval went through a gate that should have refused it');

  assert.equal(comments.length, 1);
  const parsed = parseRefusal(comments[0].text);
  assert.equal(parsed.gate, 'impact-assessment');
  assert.equal(parsed.control, CONTROL);
  assert.deepEqual(labels, [{ id: 'bc-1', label: REFUSAL_LABEL }]);
  assert.ok(!(await foundation.effective(dir, 'dispatch')).allowedTools.includes('Bash(git log:*)'));

  await management.disable({ reason: 'test/impact.mjs is done with the gate', by: 'test' });
});

console.log('the policy says so');

await check('AIP-2 claims the widening half as enforced; AIP-6 stays planned and names bc-eqn1.8', () => {
  const aip2 = clause('AIP-2');
  assert.equal(aip2.state, 'enforced');
  assert.ok(aip2.by.includes('lib/impact.js'));
  const aip6 = clause('AIP-6');
  assert.equal(aip6.state, 'planned');
  assert.equal(aip6.bead, 'bc-eqn1.8');
  assert.ok(aip6.by.includes('lib/impact.js'));
  assert.deepEqual(enforcementProblems(ROOT), []);
});

await cleanupTmp(tmp);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
