#!/usr/bin/env node
/**
 * `b7e-tokens` — token spend by session kind (bc-bdjbs). bin/b7e-tokens over lib/tokenspend.js.
 *
 *     npm test
 *     node test/b7etokens.mjs
 *
 * The real command against an isolated projects directory holding one transcript per kind
 * it has to tell apart. The traps it exists to catch, each a number that looks right:
 *
 * 1. **One response, several lines.** Claude Code writes an assistant message once per
 *    content block, each line carrying the same `usage`. Summed per line, a session costs
 *    double; it must be counted once per message id.
 * 2. **Subagents are on the bill.** `<session>/subagents/*.jsonl` belongs to its parent.
 * 3. **A harness line is not the brief.** `<command-name>` and `<system-reminder>` arrive
 *    as user messages before the brief does; classifying on them makes every session manual.
 * 4. **First visit is per epic, in time order.** Two visits to one epic are one first and
 *    one repeat; a visit to another epic is that epic's first.
 * 5. **A PR resolved twice is a repeat.** The per-PR count is what the conflict question
 *    turns on.
 * And it writes nothing — asserted by hashing the directory before and after.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';
import { classify, beadInConflictTitle, readTranscript, rootOf, weightedOf } from '../lib/tokenspend.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-tokens');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7etokens-'));
process.on('exit', () => removeTreeSync(tmp));
const config = path.join(tmp, 'config');
const projects = path.join(tmp, 'projects');
const proj = path.join(projects, '-Users-x-repo');
for (const d of [config, proj]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(
  path.join(config, 'config.json'),
  JSON.stringify({ token: 'x', claudeProjectsDir: projects, ntfy: { enabled: false } }, null, 2)
);

let n = 0;
const sid = () => `${String(++n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const user = (ts, content, extra = {}) => ({ type: 'user', timestamp: ts, message: { role: 'user', content }, ...extra });
const asst = (ts, id, usage) => ({ type: 'assistant', timestamp: ts, requestId: `req-${id}`, message: { id, model: 'claude-opus-5-5', usage } });
const U = (input, cw, cr, out) => ({ input_tokens: input, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: out });

function session(ts, brief, { lines = [], subagents = [] } = {}) {
  const id = sid();
  const body = [
    user(ts, '<command-name>/clear</command-name>'),
    user(ts, [{ type: 'text', text: '<system-reminder>noise</system-reminder>' }], { isMeta: true }),
    user(ts, [{ type: 'text', text: brief }]),
    ...lines,
  ];
  fs.writeFileSync(path.join(proj, `${id}.jsonl`), body.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (subagents.length) {
    const dir = path.join(proj, id, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    subagents.forEach((s, i) => fs.writeFileSync(path.join(dir, `agent-${i}.jsonl`), s.map((l) => JSON.stringify(l)).join('\n') + '\n'));
  }
  return id;
}

const T = (h) => new Date(Date.UTC(2026, 10, 1, h)).toISOString();

// A worker whose one response is written as three lines (trap 1), with a subagent (trap 2)
// that also repeats one of the parent's message ids — that response is counted once.
session(T(0), 'You are working bead **repo/rp-abc.4**, opened automatically.', {
  lines: [asst(T(0), 'm1', U(10, 100, 1000, 50)), asst(T(0), 'm1', U(10, 100, 1000, 50)), asst(T(0), 'm1', U(10, 100, 1000, 50))],
  subagents: [[user(T(0), 'look around'), asst(T(0), 's1', U(5, 0, 200, 20)), asst(T(0), 'm1', U(10, 100, 1000, 50))]],
});
// Epic Advocate: two visits to rp-abc (first + repeat), one to rp-xyz (first).
session(T(1), 'You are the Epic Advocate for **rp-abc** in `repo`: Things\n\nYou were opened because `rp-abc.4` has closed under it.', {
  lines: [asst(T(1), 'a1', U(1, 10, 100, 5))],
});
session(T(5), 'You are the Epic Advocate for **rp-abc** in `repo`: Things\n\nYou were opened because `rp-abc.5` was filed under it.', {
  lines: [asst(T(5), 'a2', U(1, 10, 100, 5))],
});
session(T(6), 'You are the Epic Advocate for **rp-xyz** in `repo`: Other', { lines: [asst(T(6), 'a3', U(1, 10, 100, 5))] });
// The same PR resolved twice (trap 5), and another once.
session(T(2), 'Get **#7** mergeable again in `Me/repo` — rp-abc.4: do the thing', { lines: [asst(T(2), 'c1', U(1, 0, 50, 2))] });
session(T(3), 'Get **#7** mergeable again in `Me/repo` — rp-abc.4: do the thing', { lines: [asst(T(3), 'c2', U(1, 0, 50, 2))] });
session(T(4), 'Get **#8** mergeable again in `Me/repo` — tidy the README', { lines: [asst(T(4), 'c3', U(1, 0, 50, 2))] });
session(T(4), 'You are deciding whether a bead a worker is about to file is **the same job**', { lines: [asst(T(4), 'f1', U(20, 0, 0, 1))] });
session(T(4), 'what is going on with the build?', { lines: [asst(T(4), 'h1', U(3, 3, 3, 3))] });
// Old: excluded by --since.
session('2026-09-01T00:00:00.000Z', 'You are working bead **repo/rp-old**, opened automatically.', { lines: [asst('2026-09-01T00:00:00.000Z', 'o1', U(1, 1, 1, 1))] });

const hashTree = (dir) => {
  const h = crypto.createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      h.update(p);
      if (e.isDirectory()) walk(p);
      else h.update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
};
const before = hashTree(tmp);

const run = (...args) =>
  spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, BEADCAUSE_CONFIG_DIR: config } });

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${String(err.message).split('\n').join('\n    ')}`);
  }
};

console.log('b7e-tokens');

check('classify reads each brief kind, and anything else is manual', () => {
  assert.equal(classify('You are the Epic Advocate for **dv-k4n** in `delmar`: X').kind, 'epic-advocate');
  assert.equal(classify('You are the **epic worker** for **delmar/dv-nsy**, opened').bead, 'dv-nsy');
  assert.equal(classify('You are working epic **beadcause/bc-x** and the 3 under it').kind, 'worker');
  assert.deepEqual(
    { ...classify('Get **#1013** mergeable again in `NeanderthalMan/delmar` — t') },
    { kind: 'conflict-resolve', ws: 'delmar', bead: null, pr: 1013 }
  );
  assert.equal(classify('You are the MergeAdvocate for **bc-1** in `beadcause`: pull request #3').kind, 'merge-advocate');
  assert.equal(classify('You are the ReviewAdvocate for **bc-1** in `beadcause`: pull request #3').kind, 'review-advocate');
  assert.equal(classify('You are the worker for **bc-1** in `beadcause`: pull request #3').kind, 'review-answer');
  assert.equal(classify('# Audit 12 finished session(s) in delmar').kind, 'session-audit');
  assert.equal(classify('Read handoff **delmar/dv-5sna4** and continue it.').bead, 'dv-5sna4');
  assert.equal(classify('Read handoff dv-8za0h. Run: bd show').bead, 'dv-8za0h');
  assert.equal(classify('can you verify this in staging?').kind, 'manual');
});

check('a conflict brief yields the bead only when the PR title leads with it', () => {
  assert.equal(beadInConflictTitle('Get **#33** mergeable again in `X/beadcause` — bc-khoe.30.18: B7e-lint'), 'bc-khoe.30.18');
  assert.equal(beadInConflictTitle('Get **#923** mergeable again in `X/delmar` — lore: Entry 256 (dv-5eu.3)'), null);
  assert.equal(rootOf('dv-k4n.149.2'), 'dv-k4n');
});

check('one response written as three lines is counted once (trap 1)', () => {
  const t = [asst(T(0), 'm', U(1, 2, 3, 4)), asst(T(0), 'm', U(1, 2, 3, 4))].map((l) => JSON.stringify(l)).join('\n');
  const r = readTranscript(t);
  assert.equal(r.calls, 1);
  assert.equal(r.input + r.cacheWrite + r.cacheRead + r.output, 10);
  assert.equal(weightedOf(r), 1 + 2 * 1.25 + 3 * 0.1 + 4 * 5);
});

const json = run('--json', '--since', '2026-10-01');
check('--json exits 0 and writes nothing', () => {
  assert.equal(json.status, 0, json.stderr);
  assert.equal(hashTree(tmp), before);
});
const s = JSON.parse(json.stdout || '{}');

check('every kind is told apart, and --since drops the September session', () => {
  const by = Object.fromEntries(s.byKind.map((k) => [k.kind, k.sessions]));
  assert.deepEqual(by, { worker: 1, 'epic-advocate': 3, 'conflict-resolve': 3, 'filing-gate': 1, manual: 1 });
});

check('the worker carries its subagent, and the shared message id is not counted twice (traps 1, 2)', () => {
  const w = s.byKind.find((k) => k.kind === 'worker');
  assert.equal(w.calls, 2);
  assert.equal(w.raw, 10 + 100 + 1000 + 50 + 5 + 200 + 20);
});

check('the harness lines before the brief do not make it manual (trap 3)', () => {
  assert.equal(s.byKind.find((k) => k.kind === 'manual').sessions, 1);
});

check('first vs repeat Epic Advocate visit is per epic, in time order (trap 4)', () => {
  assert.equal(s.advocate.first.sessions, 2);
  assert.equal(s.advocate.repeat.sessions, 1);
  const abc = s.advocate.epics.find((e) => e.bead === 'rp-abc');
  assert.equal(abc.visits, 2);
  assert.equal(abc.minGapMin, 240);
});

check('a PR resolved twice is counted as a repeat (trap 5)', () => {
  assert.equal(s.conflicts.prs, 2);
  assert.equal(s.conflicts.repeated, 1);
  assert.equal(s.conflicts.byPr[0].pr, 7);
  assert.equal(s.conflicts.byPr[0].sessions, 2);
});

check('per effort gathers the worker, the advocate and the titled conflict under one root', () => {
  const e = s.efforts.find((x) => x.root === 'rp-abc');
  assert.deepEqual(Object.keys(e.kinds).sort(), ['conflict-resolve', 'epic-advocate', 'worker']);
  assert.equal(e.kinds['epic-advocate'].sessions, 2);
  assert.equal(e.kinds['conflict-resolve'].sessions, 2);
  assert.equal(s.efforts.find((x) => x.root === 'rp-old'), undefined);
});

check('the text report names each section', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  for (const want of ['epic-advocate', 'Epic Advocate visits', 'Conflict resolution: 3 sessions over 2 PRs', 'Per effort', 'rp-old']) {
    assert.ok(r.stdout.includes(want), `missing ${want}:\n${r.stdout}`);
  }
});

check('--kind lists one kind, heaviest first; --json --sessions gives rows', () => {
  const r = run('--kind', 'epic-advocate');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^3 epic-advocate sessions/);
  const rows = JSON.parse(run('--json', '--sessions').stdout);
  assert.equal(rows.length, 10);
  assert.ok(rows.every((x) => typeof x.weighted === 'number'));
});

check('bad usage exits 2', () => {
  assert.equal(run('--kind', 'nope').status, 2);
  assert.equal(run('--since', 'yesterdayish').status, 2);
  assert.equal(run('--top', '0').status, 2);
  assert.equal(run('--frobnicate').status, 2);
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
