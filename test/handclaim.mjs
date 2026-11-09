#!/usr/bin/env node
/**
 * A claim keyed on the session, not the actor — `claim` in lib/handsession.js (bc-3jzrd).
 *
 *     npm test
 *     node test/handclaim.mjs
 *
 * On 2026-10-31 both dv-q52fe successors ran `bd update dv-q52fe --claim`, both claims
 * succeeded (same actor), and both built the whole thing. What this holds:
 *
 *   - the first session claims and marks `worked-by:<pid>`, and the bead stays in_progress;
 *   - a second live session is refused, naming the first — and writes nothing;
 *   - a successor after the first has exited takes it over, and the stale marker goes;
 *   - an old-style claim (no marker) refuses only while a live session is named after it;
 *   - two sessions writing in the same instant: the lower pid keeps it, the other backs off;
 *   - the same session claiming twice is a no-op, not a refusal.
 *
 * `bd` is in-memory and `ps` is injected — no processes, no files.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const H = await import(path.join(HERE, '..', 'lib', 'handsession.js'));

let ran = 0;
let failures = 0;
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

/** A one-bead world, a `bd` over it, and the calls it saw. `onLabel` runs after each label add. */
function world(bead, { onLabel = null, claimFails = false } = {}) {
  const row = { id: 'dv-q52fe', status: 'open', assignee: '', labels: ['handoff'], ...bead };
  const calls = [];
  const bd = (args) => {
    calls.push(args.join(' '));
    const [verb, sub] = args;
    if (verb === 'label' && sub === 'add') {
      row.labels = [...row.labels, args[3]];
      if (onLabel) onLabel(row);
    } else if (verb === 'label' && sub === 'remove') {
      row.labels = row.labels.filter((l) => l !== args[3]);
    } else if (verb === 'update' && args.includes('--claim')) {
      if (claimFails) throw Object.assign(new Error('x'), { stderr: 'already claimed by someone@else' });
      row.status = 'in_progress';
      row.assignee = 'neo@example.com';
    }
    return '';
  };
  const reread = () => ({ ...row, labels: [...row.labels] });
  return { row, bd, reread, calls };
}

/** `ps` for a set of live claude pids; everything else is gone. */
const psOf = (...live) => (pid) => (live.includes(pid) ? 'claude --permission-mode auto' : null);

check('the first session claims it and marks itself; the bead stays in_progress', () => {
  const w = world({});
  const r = H.claim(w.bd, 'dv-q52fe', 66619, { row: w.reread(), reread: w.reread, ps: psOf(66619) });
  assert.equal(r.claimed, true, r.refused);
  assert.ok(w.row.labels.includes('worked-by:66619'));
  assert.equal(w.row.status, 'in_progress', 'not released — `--status=open` is how sessions find free handoffs');
});

check('a second live session is refused, naming the first, and writes nothing', () => {
  const w = world({ status: 'in_progress', labels: ['handoff', 'worked-by:66619'] });
  const r = H.claim(w.bd, 'dv-q52fe', 68073, { row: w.reread(), reread: w.reread, ps: psOf(66619, 68073) });
  assert.equal(r.claimed, false);
  assert.equal(r.holder, 66619);
  assert.match(r.refused, /already being worked by worked-by:66619/);
  assert.deepEqual(w.calls, [], 'not a label, not a claim');
});

check('a successor after the first has exited takes over, and the stale marker goes', () => {
  const w = world({ status: 'in_progress', labels: ['handoff', 'worked-by:66619'] });
  const r = H.claim(w.bd, 'dv-q52fe', 70000, { row: w.reread(), reread: w.reread, ps: psOf(70000) });
  assert.equal(r.claimed, true, r.refused);
  assert.deepEqual(r.replaced, [66619]);
  assert.deepEqual(w.row.labels.filter((l) => l.startsWith('worked-by:')), ['worked-by:70000']);
});

check("ps that cannot answer refuses — \"I could not check\" is not \"free\"", () => {
  const w = world({ status: 'in_progress', labels: ['worked-by:66619'] });
  const ps = (pid) => {
    if (pid === 66619) throw new Error('ps: signal');
    return 'claude';
  };
  const r = H.claim(w.bd, 'dv-q52fe', 68073, { row: w.reread(), ps });
  assert.equal(r.claimed, false);
  assert.equal(r.holder, 66619);
});

check('an old-style claim refuses while a live session is named after the bead', () => {
  const w = world({ status: 'in_progress' });
  const sessions = () => [
    { pid: 66619, name: 'Delmar - handoff dv-q52fe' },
    { pid: 68073, name: 'Delmar - handoff dv-q52fe' },
  ];
  const r = H.claim(w.bd, 'dv-q52fe', 68073, { row: w.reread(), ps: psOf(66619, 68073), sessions });
  assert.equal(r.claimed, false, 'its own name is not a rival');
  assert.equal(r.holder, 66619);
});

check('an old-style claim nobody live is named after is taken over', () => {
  const w = world({ status: 'in_progress' });
  const sessions = () => [{ pid: 66619, name: 'Delmar - handoff dv-q52fe' }, { pid: 5, name: 'Delmar - dv-q52fex other' }];
  const r = H.claim(w.bd, 'dv-q52fe', 68073, { row: w.reread(), reread: w.reread, ps: psOf(68073, 5), sessions });
  assert.equal(r.claimed, true, r.refused);
  assert.match(r.notes.join(' '), /claimed the old way/);
});

check('two sessions writing in the same instant: the lower pid keeps it', () => {
  // The rival's label lands between our read and our re-read.
  const sneak = (row) => {
    if (!row.labels.includes('worked-by:66619')) row.labels.push('worked-by:66619');
  };
  const w = world({}, { onLabel: sneak });
  const loser = H.claim(w.bd, 'dv-q52fe', 68073, { row: w.reread(), reread: w.reread, ps: psOf(66619, 68073) });
  assert.equal(loser.claimed, false);
  assert.equal(loser.holder, 66619);
  assert.ok(!w.row.labels.includes('worked-by:68073'), 'it takes its own marker back off');
  assert.ok(!w.calls.some((c) => c.includes('--claim')), 'and never claims');

  const v = world({}, { onLabel: (row) => !row.labels.includes('worked-by:99999') && row.labels.push('worked-by:99999') });
  const winner = H.claim(v.bd, 'dv-q52fe', 66619, { row: v.reread(), reread: v.reread, ps: psOf(66619, 99999) });
  assert.equal(winner.claimed, true, 'the lower pid, seeing the same two markers, carries on');
});

check('the same session claiming twice is a no-op, not a refusal', () => {
  const w = world({ status: 'in_progress', labels: ['worked-by:66619'] });
  const r = H.claim(w.bd, 'dv-q52fe', 66619, { row: w.reread(), reread: w.reread, ps: psOf(66619) });
  assert.equal(r.claimed, true);
  assert.equal(r.already, true);
  assert.ok(!w.calls.some((c) => c.startsWith('label add')));
});

check("bd's own refusal comes back, and the marker does not stay behind", () => {
  const w = world({}, { claimFails: true });
  const r = H.claim(w.bd, 'dv-q52fe', 66619, { row: w.reread(), reread: w.reread, ps: psOf(66619) });
  assert.equal(r.claimed, false);
  assert.match(r.refused, /bd would not claim/);
  assert.ok(!w.row.labels.some((l) => l.startsWith('worked-by:')));
});

check('closed, missing, and a caller that is not a live session are refused up front', () => {
  const w = world({ status: 'closed' });
  assert.match(H.claim(w.bd, 'dv-q52fe', 1234, { row: w.reread(), ps: psOf(1234) }).refused, /closed/);
  assert.match(H.claim(w.bd, 'dv-q52fe', 1234, { row: null, ps: psOf(1234) }).refused, /no bead/);
  const o = world({});
  assert.match(H.claim(o.bd, 'dv-q52fe', 1234, { row: o.reread(), ps: psOf() }).refused, /not a live claude/);
  assert.deepEqual(w.calls.concat(o.calls), []);
});

console.log(`\n${ran - failures}/${ran} passed`);
if (failures) process.exit(1);
