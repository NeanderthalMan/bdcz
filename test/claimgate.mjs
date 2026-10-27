#!/usr/bin/env node
/**
 * The claim gate — a merge whose bead declares nothing is refused, naming its control.
 *
 *     npm test
 *     node test/claimgate.mjs
 *
 * bc-eqn1.8.2. lib/claimgate.js decides what counts as a declaration; `gateVerdict` in
 * lib/mergeadvocate.js is where the decision becomes a refusal. Both are pure, so every
 * branch is driven here without a tracker. The sweep's half — the record on the work bead,
 * written once — is in test/mergequeue.mjs beside the rest of the tick.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (f) => path.join(HERE, '..', 'lib', f);

const { CONTROL, GATE, NO_CLAIM_LABEL, claimRefusal, declaredClaim } = await import(LIB('claimgate.js'));
const { gateVerdict } = await import(LIB('mergeadvocate.js'));
const { isControl } = await import(LIB('controls.js'));
const { withControls } = await import(LIB('beadcontrols.js'));
const { withRequirements } = await import(LIB('beadreqs.js'));
const { parseRefusal, refusalComment } = await import(LIB('capa.js'));

let failures = 0;
let ran = 0;
const check = (name, fn) => {
  ran += 1;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`);
  }
};

console.log('\nthe claim gate\n');

const GREEN = { failed: [], failing: 0, pending: 0, total: 3, state: 'passing' };
const silent = { id: 'zz-work', labels: [], notes: 'just prose' };

check('the control it enforces is one the corpus has', () => {
  assert.ok(isControl(CONTROL), `${CONTROL} is not in lib/controls.js`);
});

check('a bead that says nothing is refused, and the record names the control and the gate', () => {
  const r = claimRefusal(silent, { workspace: 'demo', number: 42 });
  assert.ok(r, 'silence was let through');
  assert.match(r.refused, new RegExp(CONTROL.replace(/\./g, '\\.')));
  const back = parseRefusal(refusalComment(r.record));
  assert.equal(back.control, CONTROL);
  assert.equal(back.gate, GATE);
  assert.match(back.subject, /#42/);
  // The remedy is in the sentence, spelled for this workspace and bead.
  assert.match(r.refused, /beadcause-controls none demo zz-work/);
});

check('the refusal sentence is the same every tick, so the queue can count it', () => {
  const a = claimRefusal(silent, { workspace: 'demo', number: 42, at: 1 });
  const b = claimRefusal(silent, { workspace: 'demo', number: 42, at: 2 });
  assert.equal(a.refused, b.refused);
});

check('named controls are a declaration', () => {
  const issue = { ...silent, notes: withControls('', { ids: [CONTROL] }) };
  assert.equal(declaredClaim(issue).how, 'controls');
  assert.equal(claimRefusal(issue), null);
});

check('named requirements are a declaration', () => {
  const issue = { ...silent, notes: withRequirements('', { ids: ['JIRA.billing'] }) };
  assert.equal(declaredClaim(issue).how, 'requirements');
  assert.equal(claimRefusal(issue), null);
});

check(`"exercises none", said with the ${NO_CLAIM_LABEL} label, is a declaration`, () => {
  const issue = { ...silent, labels: [NO_CLAIM_LABEL] };
  assert.equal(declaredClaim(issue).how, 'none');
  assert.equal(claimRefusal(issue), null);
});

check('a controls block of nothing but invented ids is silence, and says which ids', () => {
  const issue = { ...silent, notes: withControls('', { ids: ['ISO42001.A.6.2.99'] }) };
  const r = claimRefusal(issue);
  assert.ok(r, 'an invented control passed for a claim');
  assert.match(r.refused, /ISO42001\.A\.6\.2\.99/);
});

check('a work bead that could not be read is not refused — that is not silence', () => {
  assert.equal(claimRefusal(null), null);
});

check('gateVerdict refuses a green branch carrying a claim refusal, and marks it as one', () => {
  const claim = claimRefusal(silent);
  const v = gateVerdict({ checks: GREEN, baseline: [], baseHasChecks: true, claim });
  assert.equal(v.merge, false);
  assert.equal(v.unclaimed, true);
  assert.equal(v.refused, claim.refused);
  assert.deepEqual(v.broke, [], 'a claim refusal is not a refusal about a check');
});

check('and with no claim refusal — gate off, or declared — it merges exactly as before', () => {
  const v = gateVerdict({ checks: GREEN, baseline: [], baseHasChecks: true, claim: null });
  assert.equal(v.merge, true);
});

check('a conflicted branch is refused for the conflict, not the claim', () => {
  const v = gateVerdict({ checks: GREEN, baseline: [], mergeable: 'CONFLICTING', claim: claimRefusal(silent) });
  assert.equal(v.conflicted, true);
  assert.ok(!v.unclaimed);
});

check('the claim is refused before an approval is asked for', () => {
  const v = gateVerdict({ checks: GREEN, baseline: [], baseHasChecks: true, requireApproval: true, claim: claimRefusal(silent) });
  assert.equal(v.awaitingApproval, false);
  assert.equal(v.unclaimed, true);
});

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n${ran} passed\n`);
process.exit(failures ? 1 : 0);
