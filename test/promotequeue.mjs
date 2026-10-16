#!/usr/bin/env node
/**
 * An endorsed promotion bead is not work an advocate may queue.
 *
 *     npm test
 *     node test/promotequeue.mjs
 *
 * bc-y8k4.7. `promote` was not in `QUEUE_EXCLUDED`, and nothing in lib/advocate.js knows
 * what a promotion bead is, so the moment one was endorsed it became ordinary ready work
 * under an epic that had already shipped. `unplanned()` returned it, a planner window opened
 * on a finished plan (that is what bc-42ow.9 did to bc-42ow), every descendant froze behind
 * it, and after the attempts ran out a plain worker opened on it instead — which can do no
 * better, because a promotion is carried by the release agent and not built.
 *
 * The checks are about the *shape* of the fix, and every bead in the fixture is fully
 * endorsed: a suite that tested held promotion beads would pass against the code that had
 * the bug, because `unendorsed` was already keeping those out.
 *
 * 1. **The label has one spelling and no import cycle.** It is defined in lib/endorse.js
 *    (which lib/promote.js imports from) and re-exported, and both import orders work.
 * 2. **It leaves the advocate's queue and nothing else.** The endorsement screen still shows
 *    an unendorsed one, `bd.ready` with no exclusion still returns it (it is deliberately
 *    not forced the way `ship` and `container` are), and `listLabel` — which is how the
 *    release agent finds its work — is not a queue read at all.
 * 3. **The consequence is gone, on the real machinery.** With the queue as the advocate
 *    reads it, `unplanned()` over a finished plan is empty and the epic is `done`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LIB = (name) => path.join(ROOT, 'lib', name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-promotequeue-'));
// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { UNENDORSED, QUEUE_EXCLUDED, PROMOTE_LABEL: FROM_ENDORSE } = await import(LIB('endorse.js'));
const { PROMOTE_LABEL } = await import(LIB('promote.js'));
const { Bd } = await import(LIB('bd.js'));
const { dispatchable, unplanned, validatePlan } = await import(LIB('plan.js'));

/* ------------------------------------------------------------------- the stub bd */

const WORLD = path.join(tmp, 'world.json');
const FAKE_BD = path.join(tmp, 'bd');
const OLD = '2026-08-01T00:00:00Z';

const issue = (id, over = {}) => ({
  id,
  title: id,
  status: 'open',
  priority: 2,
  issue_type: 'task',
  created_at: OLD,
  labels: [],
  ...over,
});

// A finished epic and its one endorsed promotion bead — the bc-42ow / bc-42ow.9 shape —
// beside one ordinary bead and one promotion bead that is still held.
const WORLD_ROWS = {
  'zz-work': issue('zz-work'),
  'zz-promote': issue('zz-promote', { labels: [PROMOTE_LABEL], issue_type: 'chore' }),
  'zz-held-promote': issue('zz-held-promote', { labels: [PROMOTE_LABEL, UNENDORSED], issue_type: 'chore' }),
};
fs.writeFileSync(WORLD, JSON.stringify({ issues: WORLD_ROWS }));

// `ready` and `list` honour `--label` / `--exclude-label` the way bd does, because the
// filter under test *is* those flags.
fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const w = JSON.parse(fs.readFileSync(${JSON.stringify(WORLD)}, 'utf8'));
const many = (n) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === n) out.push(...String(args[i + 1] || '').split(',')); return out.filter(Boolean); };
if (args[0] === 'ready' || args[0] === 'list') {
  const off = many('--exclude-label');
  const need = many('--label');
  const rows = Object.values(w.issues)
    .filter((i) => i.status === 'open')
    .filter((i) => !(i.labels || []).some((l) => off.includes(l)))
    .filter((i) => need.every((l) => (i.labels || []).includes(l)));
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}
process.stdout.write('[]');
`,
  { mode: 0o755 }
);

const ws = { name: 'beadcause', dir: path.join(tmp, 'ws') };
fs.mkdirSync(ws.dir, { recursive: true });
const bd = new Bd({ bin: FAKE_BD, actor: 'beadcause-test' });
const ids = (rows) => rows.map((r) => r.id).sort();

/* --------------------------------------------------------------------- harness */

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
}

console.log('\nan endorsed promotion bead is not work an advocate may queue\n');

/* ================================================================ 1. the label itself */

await check('one spelling, and promote.js re-exports the endorse.js one', () => {
  assert.equal(PROMOTE_LABEL, 'promote');
  assert.equal(FROM_ENDORSE, PROMOTE_LABEL, 'the two files disagree about the label');
  const src = fs.readFileSync(LIB('promote.js'), 'utf8');
  assert.ok(!/const PROMOTE_LABEL = /.test(src), 'promote.js declares the label a second time');
});

await check('it is on the list the advocate passes, and only the list', () => {
  assert.ok(QUEUE_EXCLUDED.includes(PROMOTE_LABEL), 'an endorsed promotion bead would open a planner window');
  const adv = fs.readFileSync(LIB('advocate.js'), 'utf8');
  assert.match(adv, /Five labels never reach my queue/, 'the survey brief still counts four');
  assert.match(adv, /`promote`|\\`promote\\`/, 'the survey brief never says what a promotion bead is to it');
});

await check('either import order works — no cycle hands endorse.js an uninitialised label', () => {
  for (const first of ['promote.js', 'endorse.js']) {
    const other = first === 'promote.js' ? 'endorse.js' : 'promote.js';
    const script =
      `const a = await import(${JSON.stringify(LIB(first))});` +
      `const b = await import(${JSON.stringify(LIB(other))});` +
      `const endorse = ${JSON.stringify(first)} === 'endorse.js' ? a : b;` +
      `if (!endorse.QUEUE_EXCLUDED.includes('promote')) process.exit(3);`;
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, BEADCAUSE_CONFIG_DIR: process.env.BEADCAUSE_CONFIG_DIR },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, `importing ${first} first failed: ${run.stderr || run.stdout}`);
  }
});

/* ============================================== 2. out of the queue, and nothing else */

await check('bd.ready with the advocate’s list leaves an endorsed promotion bead out', async () => {
  const rows = await bd.ready(ws, { excludeLabels: QUEUE_EXCLUDED });
  assert.deepEqual(ids(rows), ['zz-work'], 'the promotion bead is still queueable work');
});

await check('it is not forced on in Bd.ready — a caller that asks for nothing still sees one', async () => {
  // Deliberate: only the advocate's own queue narrows. Forcing it here would hide the bead
  // from every other reader of `ready`, and the endorsement screen must still show it.
  assert.deepEqual(ids(await bd.ready(ws)), ['zz-promote', 'zz-work']);
});

await check('the endorsement screen and the release agent’s read are both untouched', async () => {
  assert.deepEqual(ids(await bd.readyHeld(ws)), ['zz-held-promote'], 'a held promotion bead must stay endorsable');
  assert.deepEqual(
    ids(await bd.listLabel(ws, PROMOTE_LABEL)),
    ['zz-held-promote', 'zz-promote'],
    'the release agent finds its work by label, not by the queue'
  );
});

/* ================================================ 3. the consequence, on the real code */

await check('a finished plan with an endorsed promotion bead left over is done, not loose', async () => {
  // bc-42ow after 2026-08-22: every group merged, one promotion bead endorsed beneath it.
  const kids = [issue('x-1.1'), issue('x-1.9', { labels: [PROMOTE_LABEL], issue_type: 'chore' })];
  const plan = validatePlan(
    {
      groups: [
        {
          name: 'one',
          beads: ['x-1.1'],
          prs: [{ repo: 'alpha', title: 'one pr' }],
          prompt: 'Do x-1.1 as one change.',
        },
      ],
    },
    { epic: 'x-1', children: [kids[0]] }
  );
  const parents = new Map([['x-1.9', 'x-1']]);

  // What the advocate used to see: the promotion bead in its queue, so the finished epic
  // looked like it had loose work and a planner was opened.
  assert.deepEqual(ids(unplanned(plan, [kids[1]], parents)), ['x-1.9'], 'the fixture no longer reproduces the defect');

  // What it sees now: the same row, filtered by the list it actually passes.
  const queue = [kids[1]].filter((r) => !(r.labels || []).some((l) => QUEUE_EXCLUDED.includes(l)));
  assert.deepEqual(unplanned(plan, queue, parents), [], 'a planner would still open on a finished epic');
  const beads = new Map([
    ['x-1.1', { status: 'closed' }],
    ['x-1.9', { status: 'open' }],
  ]);
  assert.equal(dispatchable(plan, { queue, workers: [], beads }).done, true, 'and the epic takes its own hold path');
});

/* --------------------------------------------------------------------- teardown */

await cleanupTmp(tmp);

console.log(`\n${ran - failures}/${ran} checks passed\n`);
process.exit(failures ? 1 : 0);
