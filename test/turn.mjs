#!/usr/bin/env node
/**
 * `b7e-turn` — lib/turn.js and bin/b7e-turn (bc-dgx7.193).
 *
 *     node test/turn.mjs
 *
 * The rules are pure and proved against fixtures; the binary is spawned only for usage.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { turn, isReadCard, adamInput, humanPattern } from '../lib/turn.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'b7e-turn');

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 10).join('\n       ')}`);
  }
};

const BLOCK = '```decision\nquestion: Which?\noptions:\n  - id: a\n    label: A\n    response: "A."\n    recommended: true\n```';
const bead = (o = {}) => ({ id: 'x-1', status: 'open', issue_type: 'task', title: 'Work', labels: [], comments: [], ...o });

check('an ordinary open bead is the agent\'s', () => {
  const r = turn('w', bead());
  assert.equal(r.turn, 'agent');
  assert.equal(r.rule, 'default');
});

check('the human label hands it to Adam', () => {
  assert.equal(turn('w', bead({ labels: ['human'] })).rule, 'human-label');
});

check('assignee adam is Adam\'s; the git identity a claim stamps is not', () => {
  assert.equal(turn('w', bead({ assignee: 'adam' })).rule, 'assignee');
  assert.equal(turn('w', bead({ assignee: 'neo@example.com' })).turn, 'agent');
});

check('a decision with an unanswered block is Adam\'s; an answered one is not', () => {
  const open = bead({ issue_type: 'decision', description: `ctx\n\n${BLOCK}` });
  assert.equal(turn('w', open).rule, 'unanswered-decision');
  const closed = { ...open, status: 'closed', close_reason: 'Answered via Beadcause' };
  assert.equal(turn('w', closed).turn, 'agent');
});

check('a Read card with no docnotes is Adam\'s; with docnotes it is the agent\'s', () => {
  const card = bead({ title: 'Read: chapter 4', assignee: 'aria', comments: [{ text: 'triage note', created_at: '2026-10-04' }] });
  assert.equal(turn('w', card).rule, 'read-card-no-docnotes');
  const noted = { ...card, comments: [...card.comments, { text: 'docnotes: fix the ending', author: 'adam', created_at: '2026-10-05' }] };
  assert.equal(turn('w', noted).turn, 'agent');
  assert.equal(adamInput(noted.comments).at, '2026-10-05');
});

// bc-x79kq.1: who is Adam comes from the config, so a scrubbed tree (whose source no
// longer spells his handles) still recognises his comments on this Mac.
check('humanPattern reads owner, me and accounts — address and local part', () => {
  const human = humanPattern({ owner: 'Pat', me: ['pat.k@corp.example'], accounts: [{ email: 'patk@home.example' }] });
  for (const who of ['Pat', 'pat Smith', 'pat.k@corp.example', 'pat.k', 'PATK@home.example', 'patk']) {
    assert.ok(human.test(who), `${who} should be Pat`);
  }
  for (const who of ['patrick', 'spat', 'claude', 'beadcause']) assert.ok(!human.test(who), `${who} is not Pat`);
  assert.equal(humanPattern({}), null);
});

check('a comment by the configured human is input; with nobody configured only docnotes counts', () => {
  const comments = [{ text: 'looks right', author: 'pat.k@corp.example', created_at: '2026-10-06' }];
  assert.equal(adamInput(comments, { human: humanPattern({ me: 'pat.k@corp.example' }) }).at, '2026-10-06');
  assert.equal(adamInput(comments), null);
  assert.equal(turn('w', bead({ comments }), { human: humanPattern({ owner: 'Sam' }) }).input, null);
});

check('prose about Read cards in the body does not make a bead one', () => {
  assert.equal(isReadCard(bead({ description: 'eight send-to-phone Read cards' })), false);
  assert.equal(isReadCard(bead({ labels: ['read'] })), true);
});

check('a closed bead is nobody\'s move, and a missing one is named', () => {
  assert.equal(turn('w', bead({ status: 'closed', labels: ['human'] })).rule, 'closed');
  assert.equal(turn('w', null).rule, 'missing');
});

check('the binary refuses a call with no bead', () => {
  const r = spawnSync(process.execPath, [BIN, '-w', 'beadcause'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall passed');
