#!/usr/bin/env node
//
// A build-time gate names its control and leaves a record — bc-eqn1.8.3 and bc-eqn1.8.4.
//
//   npm test
//   node test/buildgates.mjs
//
// Two gates, both red-suite refusals: the supplier sweep (lib/suppliers.js) and the
// model-card check (lib/modelrouting.js). A red test is gone on the next green run, so
// a refusal is also written to refs/beadcause/build-refusals (lib/buildrefusal.js) and
// the failure says which corpus control it enforces.
//
// Part one proves the gates *can* fail, against mappings and trees nobody committed — a
// static check that has never been seen red is a comment. Part two runs them on the real
// repo and, on a problem, records the refusal and fails naming the control.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { BUILD_REFUSAL_REF, buildRefusals, recordBuildRefusal, refuseBuild } from '../lib/buildrefusal.js';
import { MODEL_BY_TIER, FALLBACK_MODEL } from '../lib/complexity.js';
import { agentCardProblems, MODEL_ROUTING_CONTROL, MODEL_ROUTING_GATE, routingProblems } from '../lib/modelrouting.js';
import { SUPPLIER_CONTROL, SUPPLIER_GATE, egressProblems } from '../lib/suppliers.js';
import { SYSTEM, systemCard } from '../lib/systemcard.js';
import { isControl } from '../lib/controls.js';
import { cleanupTmp } from './helpers/tmp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}\n     ${String(err.stack || err).split('\n').join('\n     ')}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buildgates-'));
const repo = (name) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  execFileSync('git', ['init', '-q', dir]);
  return dir;
};

/* ------------------------------------------------------- the model-card gate */

await check('the controls the two gates name are real corpus ids', () => {
  assert.ok(isControl(MODEL_ROUTING_CONTROL), MODEL_ROUTING_CONTROL);
  assert.ok(isControl(SUPPLIER_CONTROL), SUPPLIER_CONTROL);
});

await check('changing MODEL_BY_TIER alone fails, naming the tier', () => {
  const moved = { ...MODEL_BY_TIER, medium: 'opus[1m]' };
  const problems = routingProblems({ mapping: moved });
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /tier `medium` routes to `opus\[1m\]`.*written against `sonnet\[1m\]`/);
});

await check('a new tier, a removed tier and a moved fallback each fail', () => {
  assert.equal(routingProblems({ mapping: { ...MODEL_BY_TIER, xl: 'opus[1m]' } }).length, 1);
  const { low, ...fewer } = MODEL_BY_TIER;
  assert.equal(routingProblems({ mapping: fewer }).length, 1);
  assert.equal(routingProblems({ fallback: 'sonnet[1m]' }).length, 1);
});

await check('changing the mapping together with the card passes', () => {
  const moved = { ...MODEL_BY_TIER, medium: 'opus[1m]' };
  const card = systemCard(SYSTEM);
  card.routing.mapping.medium = 'opus[1m]';
  assert.deepEqual(routingProblems({ mapping: moved, card }), []);
});

await check('a card with no routing record fails rather than passing for want of one', () => {
  const card = systemCard(SYSTEM);
  delete card.routing;
  assert.match(routingProblems({ card })[0], /records no `routing`/);
});

await check('the agent cards that say they are routed agree with the fallback', () => {
  assert.deepEqual(agentCardProblems({ fallback: FALLBACK_MODEL }), []);
  assert.ok(agentCardProblems({ fallback: 'haiku' }).length > 0, 'and it is not vacuous');
});

/* --------------------------------------------------- the record of a refusal */

await check('a refusal is kept on a ref, parses back, and names its control', async () => {
  const dir = repo('a');
  const { commit, deduped } = await recordBuildRefusal(dir, {
    control: SUPPLIER_CONTROL,
    gate: SUPPLIER_GATE,
    problems: ['evil.example is reached from lib/x.js and no supplier claims it.'],
    at: Date.parse('2026-10-24T12:00:00Z'),
  });
  assert.ok(commit && !deduped);
  const [r, ...rest] = await buildRefusals(dir);
  assert.equal(rest.length, 0);
  assert.equal(r.control, SUPPLIER_CONTROL);
  assert.equal(r.gate, SUPPLIER_GATE);
  assert.equal(r.at, Date.parse('2026-10-24T12:00:00Z'));
  assert.match(r.subject, /evil\.example/);
  assert.equal(execFileSync('git', ['-C', dir, 'rev-parse', BUILD_REFUSAL_REF]).toString().trim(), commit);
});

await check('the same failure twice is one record, a different one is another', async () => {
  const dir = repo('b');
  const once = { control: MODEL_ROUTING_CONTROL, gate: MODEL_ROUTING_GATE, problems: ['tier `low` moved'] };
  const first = await recordBuildRefusal(dir, once);
  const again = await recordBuildRefusal(dir, once);
  assert.equal(again.deduped, true);
  assert.equal(again.commit, first.commit);
  await recordBuildRefusal(dir, { ...once, problems: ['tier `high` moved'] });
  assert.equal((await buildRefusals(dir)).length, 2);
});

await check('a worktree writes to the one shared ref, not to a ref of its own', async () => {
  const dir = repo('c');
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'root']);
  const wt = path.join(tmp, 'c-wt');
  execFileSync('git', ['-C', dir, 'worktree', 'add', '-q', '-b', 'side', wt]);
  await recordBuildRefusal(wt, { control: SUPPLIER_CONTROL, gate: SUPPLIER_GATE, problems: ['x'] });
  assert.equal((await buildRefusals(dir)).length, 1, 'visible from the main checkout, and so after the worktree is gone');
});

await check('a control that is not in the corpus is refused, not recorded', async () => {
  await assert.rejects(
    recordBuildRefusal(repo('d'), { control: 'ISO42001.A.6.2.99', gate: SUPPLIER_GATE, problems: ['x'] }),
    /not a control/
  );
});

await check('refuseBuild returns the sentence a suite fails with, and it names the control', async () => {
  const msg = await refuseBuild(repo('e'), { control: SUPPLIER_CONTROL, gate: SUPPLIER_GATE, problems: ['one', 'two'] });
  assert.match(msg, new RegExp(SUPPLIER_CONTROL.replace(/\./g, '\\.')));
  assert.match(msg, /refs\/beadcause\/build-refusals/);
});

/* ------------------------------------------------------------- the real repo */

// Recorded into this checkout's main repo only when something is actually wrong.
async function gate(gateName, control, problems) {
  if (!problems.length) return;
  assert.fail(await refuseBuild(ROOT, { control, gate: gateName, problems }));
}

await check(`the system card and MODEL_BY_TIER agree (${MODEL_ROUTING_CONTROL})`, () =>
  gate(MODEL_ROUTING_GATE, MODEL_ROUTING_CONTROL, [...routingProblems(), ...agentCardProblems()])
);

await check(`no unclaimed supplier host or command in lib/ or bin/ (${SUPPLIER_CONTROL})`, () =>
  gate(SUPPLIER_GATE, SUPPLIER_CONTROL, egressProblems(ROOT))
);

await cleanupTmp(tmp);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
