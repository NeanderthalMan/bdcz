#!/usr/bin/env node
/**
 * bc-bmry.9, and then bc-j2zwo.3 — the approval label vocabulary lives in one place, and
 * that place is the workspace's declaration rather than beadcause's source.
 *
 *     npm test
 *     node test/approvallabels.mjs
 *
 * lib/approval.js (the policy) and lib/approvalcard.js (the display) are deliberately
 * two files — see both their headers for why merging them would be wrong. bc-bmry.9 gave
 * them one shared set of constants instead of two private copies. bc-j2zwo.3 took the
 * constants out altogether: they were one workspace's vocabulary, shipped to every
 * install. Now a workspace declares its own pipeline in `cfg.approval[<workspace>]`, and
 * lib/approvallabels.js's `approvalPipeline` is the one reader of it both files use.
 *
 * Four things worth pinning:
 *
 * 1. **Nothing ships.** No workspace has a pipeline by default, and the label words the
 *    first one used are not spelled as literals in any of the three files — read off the
 *    source, since a passing behavioural test cannot tell "declared" from "hardcoded with
 *    the same value".
 * 2. **One reader.** Both files take the normalised pipeline from lib/approvallabels.js
 *    rather than reading `cfg.approval` themselves.
 * 3. **The normalisation**, which is where a hand-edited config goes wrong: blank labels,
 *    a missing `humanOnly`, a stated one, restated state words.
 * 4. **A declared label drives the card**, checked by behaviour with invented words.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankJs } from './helpers/blank.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LIB = (f) => path.join(ROOT, 'lib', f);
const read = (f) => fs.readFileSync(LIB(f), 'utf8');

let failures = 0;
let ran = 0;
const check = (name, fn) => {
  ran += 1;
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n').slice(0, 4).join('\n      ')}`);
  }
};

const labels = await import(LIB('approvallabels.js'));
const approval = await import(LIB('approval.js'));
const { approvalCard } = await import(LIB('approvalcard.js'));
const { approvalPipeline, REPLIED_LABEL } = labels;

const SRC = {
  'lib/approvallabels.js': blankJs(read('approvallabels.js')),
  'lib/approval.js': blankJs(read('approval.js')),
  'lib/approvalcard.js': blankJs(read('approvalcard.js')),
};

console.log('\n1. nothing ships');
check('no workspace has a pipeline unless the config declares one', () => {
  assert.equal(approvalPipeline({}, 'any'), null);
  assert.equal(approvalPipeline({ approval: {} }, 'any'), null);
  assert.equal(approvalPipeline({ approval: { any: {} } }, 'any'), null, 'an entry with no labels is no pipeline');
  assert.equal(approvalPipeline({ approval: { any: { labels: { review: '  ' } } } }, 'any'), null);
  assert.equal(approvalPipeline({ approval: { any: { labels: { review: 'ok' } } } }, ''), null);
});

check('the only label beadcause owns is its own replied label', () => {
  assert.equal(REPLIED_LABEL, 'human-replied');
  assert.deepEqual(Object.keys(labels).sort(), ['LABEL_KEYS', 'REPLIED_LABEL', 'STATE_IDS', 'approvalPipeline']);
});

const hasLiteral = (src, text) => {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`['"\`]${escaped}['"\`]`).test(src);
};
// Bare `'gate'` is deliberately not in this list: it is also the *name* of a pipeline key
// (`labels.gate`) and of a hold kind (`holdKind`), which are beadcause's words for a role a
// label plays. Whether the label `gate` holds anything is checked by behaviour instead —
// test/onelaw.mjs, "with no pipeline declared nothing is held".
for (const [name, src] of Object.entries(SRC)) {
  for (const word of ['gate:', 'needs-approval', 'revision:']) {
    check(`${name} does not spell '${word}' as a literal`, () => {
      assert.equal(hasLiteral(src, word), false, `${name} still hardcodes '${word}'`);
    });
  }
}

console.log('\n2. one reader of the declaration');
check('lib/approval.js hands on approvalPipeline from ./approvallabels.js rather than its own', () => {
  assert.equal(approval.approvalPipeline, approvalPipeline);
  assert.match(SRC['lib/approval.js'], /export\s*\{\s*approvalPipeline\s*\}\s*from\s*'\.\/approvallabels\.js'/);
});

check('lib/approvalcard.js reads no config at all — it is handed the pipeline', () => {
  assert.doesNotMatch(SRC['lib/approvalcard.js'], /cfg\.approval|\.approval\[/);
  assert.match(SRC['lib/approvalcard.js'], /import\s*\{\s*REPLIED_LABEL as REPLIED\s*\}\s*from\s*'\.\/approvallabels\.js'/);
});

console.log('\n3. the normalisation');
const PIPE = { labels: { review: ' sign-off ', gate: 'milestone', gatePrefix: 'milestone:', draft: 'wip', revisionPrefix: 'pass:' } };
check('labels are trimmed, and an undeclared one is the empty string', () => {
  const p = approvalPipeline({ approval: { w: { labels: { review: ' sign-off ' } } } }, 'w');
  assert.equal(p.review, 'sign-off');
  for (const k of ['gate', 'gatePrefix', 'draft', 'revisionPrefix']) assert.equal(p[k], '', k);
});

check('humanOnly defaults to the gate and review labels the pipeline declares', () => {
  assert.deepEqual(approvalPipeline({ approval: { w: PIPE } }, 'w').humanOnly, ['milestone', 'sign-off']);
  assert.deepEqual(approvalPipeline({ approval: { w: { labels: { draft: 'wip' } } } }, 'w').humanOnly, []);
});

check('a stated humanOnly is the whole list, and [] is kept as stated', () => {
  assert.deepEqual(approvalPipeline({ approval: { w: { ...PIPE, humanOnly: ['legal-hold'] } } }, 'w').humanOnly, ['legal-hold']);
  assert.deepEqual(approvalPipeline({ approval: { w: { ...PIPE, humanOnly: [] } } }, 'w').humanOnly, []);
});

check('a state may restate its words, and an unknown state id is ignored', () => {
  const p = approvalPipeline({ approval: { w: { ...PIPE, states: { 'in-review': { label: 'awaiting' }, bogus: { label: 'x' } } } } }, 'w');
  assert.deepEqual(p.states, { 'in-review': { label: 'awaiting' } });
});

console.log('\n4. a declared label drives the card');
check("approvalCard's draft state follows the pipeline's draft label, not a built-in word", () => {
  const p = approvalPipeline({ approval: { w: PIPE } }, 'w');
  const card = approvalCard({ id: 'x', status: 'open', labels: ['wip'] }, p);
  assert.equal(card.state, 'draft');
  assert.equal(card.label, 'draft');
  assert.equal(approvalCard({ id: 'x', status: 'open', labels: ['draft'] }, p), null, "the old word is nobody's label now");
  assert.equal(approvalCard({ id: 'x', status: 'open', labels: ['wip'] }), null, 'no pipeline, no card');
});

check('restated words reach the card', () => {
  const p = approvalPipeline({ approval: { w: { ...PIPE, states: { 'in-review': { label: 'awaiting', note: 'On your desk.' } } } } }, 'w');
  const card = approvalCard({ id: 'x', status: 'open', labels: ['sign-off', 'human'] }, p);
  assert.equal(card.state, 'in-review');
  assert.equal(card.label, 'awaiting');
  assert.equal(card.note, 'On your desk.');
});

console.log(`\n${ran - failures}/${ran} passed`);
if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
