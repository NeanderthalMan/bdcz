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
process.env.BEADCAUSE_HOST_NAME = 'here';
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
  assert.ok(w.row.labels.includes('worked-by:66619@here'));
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
  assert.deepEqual(r.replaced, ['worked-by:66619']);
  assert.deepEqual(w.row.labels.filter((l) => l.startsWith('worked-by:')), ['worked-by:70000@here']);
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

/*
 * bc-obucr.26 — one tracker, two machines. Studio's daemon serves the personal
 * workspaces and laptop sessions write to them over the tailnet, so a marker can name a
 * pid this machine's ps has never heard of. Every check below runs as host `here`.
 */
console.log('\nmarkers from another machine (bc-obucr.26)\n');

check('a marker names its host; a bare one is read as this machine, as every old marker was', () => {
  assert.deepEqual(H.parseMarker('worked-by:42@laptop'), { pid: 42, host: 'laptop', label: 'worked-by:42@laptop' });
  assert.deepEqual(H.parseMarker('worked-by:42'), { pid: 42, host: '', label: 'worked-by:42' });
  assert.equal(H.parseMarker('worked-by:42@'), null);
  assert.equal(H.parseMarker('worked-by:x@laptop'), null);
  assert.equal(H.isLocalMarker(H.parseMarker('worked-by:42')), true);
  assert.equal(H.isLocalMarker(H.parseMarker('worked-by:42@here')), true);
  assert.equal(H.isLocalMarker(H.parseMarker('worked-by:42@laptop')), false);
  assert.equal(H.workedBy({ labels: ['worked-by:42@laptop'] }), 42);
});

check("another machine's marker is never read as gone — even for a pid nothing here is running", () => {
  const m = H.parseMarker('worked-by:66619@laptop');
  assert.equal(H.probeMarker(m, { ps: psOf() }), 'remote');
  assert.equal(H.probeMarker(H.parseMarker('worked-by:66619'), { ps: psOf() }), 'gone');
  assert.throws(
    () => H.assertNotHandWorked({ id: 'dv-q52fe', labels: ['worked-by:66619@laptop'] }, { ps: psOf() }),
    (err) => err.status === 409 && /worked-by:66619@laptop/.test(err.message)
  );
});

check("a claim is refused over another machine's marker, and writes nothing", () => {
  const w = world({ status: 'in_progress', labels: ['handoff', 'worked-by:66619@laptop'] });
  const r = H.claim(w.bd, 'dv-q52fe', 70000, { row: w.reread(), reread: w.reread, ps: psOf(70000) });
  assert.equal(r.claimed, false);
  assert.equal(r.holder, 66619);
  assert.match(r.refused, /worked-by:66619@laptop, on laptop/);
  assert.deepEqual(w.calls, []);
});

check('the same pid on another machine is not this session', () => {
  const w = world({ status: 'in_progress', labels: ['worked-by:70000@laptop'] });
  const r = H.claim(w.bd, 'dv-q52fe', 70000, { row: w.reread(), reread: w.reread, ps: psOf(70000) });
  assert.equal(r.claimed, false, 'not "already this session\'s"');
  const m = world({ labels: ['worked-by:70000@laptop'] });
  assert.match(H.mark(m.bd, 'dv-q52fe', 70000, { row: m.reread(), ps: psOf(70000) }).refused, /a session on laptop/);
});

check("this session's own bare marker, from before hosts, is still its own", () => {
  const w = world({ status: 'in_progress', labels: ['worked-by:70000'] });
  const r = H.claim(w.bd, 'dv-q52fe', 70000, { row: w.reread(), reread: w.reread, ps: psOf(70000) });
  assert.equal(r.claimed, true, r.refused);
  assert.equal(r.already, true);
  assert.ok(!w.calls.some((c) => c.startsWith('label add')), 'no second marker');
});

check('a race across machines resolves the same way on both: lower pid keeps it', () => {
  const v = world({}, { onLabel: (row) => !row.labels.includes('worked-by:500@laptop') && row.labels.push('worked-by:500@laptop') });
  const r = H.claim(v.bd, 'dv-q52fe', 70000, { row: v.reread(), reread: v.reread, ps: psOf(70000) });
  assert.equal(r.claimed, false);
  assert.equal(r.holder, 500);
  assert.ok(!v.row.labels.includes('worked-by:70000@here'), 'it takes its own marker back off');
});

/** An async `Bd` over rows, for the sweep. */
function sweepWorld(rows) {
  const removed = [];
  const comments = [];
  return {
    removed,
    comments,
    bd: {
      listHandWorked: async () => rows,
      removeLabel: async (_ws, id, label) => removed.push(`${id} ${label}`),
      comment: async (_ws, id, text) => comments.push(`${id} ${text}`),
    },
  };
}

const HOUR = 3600000;
const NOW = Date.parse('2026-11-18T12:00:00Z');
const ago = (h) => new Date(NOW - h * HOUR).toISOString();

const sweepChecks = [
  [
    "the sweep leaves another machine's marker alone, quietly, while the bead is being touched",
    async () => {
      const w = sweepWorld([{ id: 'bc-a', labels: ['worked-by:66619@laptop'], updated_at: ago(3) }]);
      const out = await H.sweepHandSessions(w.bd, 'bc', { ps: psOf(), now: NOW });
      assert.deepEqual(out.cleared, []);
      assert.deepEqual(out.skipped, [], 'not in skipped, which the advocate logs every pass');
      assert.deepEqual(out.remote, [{ id: 'bc-a', labels: ['worked-by:66619@laptop'] }]);
      assert.deepEqual(w.removed, []);
    },
  ],
  [
    'after a day without an update it is read as abandoned and cleared, and the comment says why',
    async () => {
      const w = sweepWorld([{ id: 'bc-a', title: 't', labels: ['worked-by:66619@laptop'], updated_at: ago(25) }]);
      const out = await H.sweepHandSessions(w.bd, 'bc', { ps: psOf(), now: NOW });
      assert.equal(out.cleared.length, 1);
      assert.deepEqual(w.removed, ['bc-a worked-by:66619@laptop']);
      assert.match(w.comments[0], /another machine, and untouched for 24h/);
    },
  ],
  [
    "a local marker beside a fresh remote one is not cleared out from under it",
    async () => {
      const w = sweepWorld([{ id: 'bc-b', labels: ['worked-by:9', 'worked-by:66619@laptop'], updated_at: ago(1) }]);
      const out = await H.sweepHandSessions(w.bd, 'bc', { ps: psOf(), now: NOW });
      assert.deepEqual(out.cleared, []);
      assert.deepEqual(w.removed, []);
    },
  ],
  [
    "this machine's own gone marker, with its host, is cleared at once as before",
    async () => {
      const w = sweepWorld([{ id: 'bc-c', labels: ['worked-by:9@here'], updated_at: ago(0) }]);
      const out = await H.sweepHandSessions(w.bd, 'bc', { ps: psOf(), now: NOW });
      assert.equal(out.cleared.length, 1);
      assert.match(w.comments[0], /has exited/);
    },
  ],
];
for (const [name, fn] of sweepChecks) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`);
  }
}

console.log(`\n${ran - failures}/${ran} passed`);
if (failures) process.exit(1);
