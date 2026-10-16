#!/usr/bin/env node
/**
 * Questions held back so the phone rings once for a batch of them.
 *
 *     npm test
 *     node test/held.mjs
 *
 * bc-obhx3. The daemon log for the first week of October 2026 showed 30 rings on the
 * 6th and 38 on the 9th, every one a class-1 question from loremia, every one buzzing
 * the phone on its own. Landings already collapsed into one card at three or more
 * (`LANDED_MANY_AT`, test/landed.mjs); questions had no rule at all. lib/held.js is the
 * rule, and this suite pins it:
 *
 *   1. **The window.** `settleMs` reads `questions.settleMinutes`, defaults to ten,
 *      treats zero and nonsense as off, and caps a typo at two hours rather than
 *      refusing it.
 *   2. **Hold, due, release.** A workspace that has not rung is due on the tick it
 *      first holds something (a lone question is never late); one that rang inside the
 *      window is not; the window is measured from the last ring and not from the first
 *      hold; release hands keys back oldest first and takes the workspace out.
 *   3. **Pruning.** `retainHeld` drops a held key that left the inbox and a workspace
 *      with nothing left, on the same terms as `ringing`.
 *   4. **The push.** `pushQuestions` with two or more publishes one body — a count in
 *      the title, one line per question, no action buttons, the loudest priority —
 *      and with exactly one hands off to `pushQuestion`, buttons and all. A minimal
 *      workspace gets the count and nothing else. Caught with `fetch` stubbed, the way
 *      test/notify.mjs does.
 *   5. **The class.** `pushQuestions` is in lib/voices.js's table as class 1, so
 *      test/voices.mjs's "every pusher is assigned a class" check keeps holding.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (f) => path.join(HERE, '..', 'lib', f);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-held-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

let failures = 0;
let ran = 0;
const ok = (name) => {
  ran += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
};
const bad = (name, detail) => {
  ran += 1;
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (fn, name) => {
  try {
    fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};
const checkAsync = async (fn, name) => {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};

const held = await import(LIB('held.js'));
const { SETTLE_MINUTES, MAX_SETTLE_MINUTES, settleMs, recentlyRang, ringsAgainInMinutes, hold, due, release, retainHeld } = held;
const notify = await import(LIB('notify.js'));
const { SPEAKS, ANSWER } = await import(LIB('voices.js'));

const MIN = 60_000;
const at = (iso) => new Date(iso);
const q = (ws, id, extra = {}) => ({ workspace: ws, id, key: `${ws}/${id}`, question: `Decide ${id}?`, title: `Bead ${id}`, priority: 2, ...extra });

/* ------------------------------------------------------------------ 1. the window */

console.log('\nthe settle window');
check(() => assert.equal(settleMs({}), SETTLE_MINUTES * MIN), `defaults to ${SETTLE_MINUTES} minutes with no config`);
check(() => assert.equal(settleMs({ questions: { settleMinutes: 3 } }), 3 * MIN), 'reads questions.settleMinutes');
check(() => assert.equal(settleMs({ questions: { settleMinutes: 0 } }), 0), 'zero is off');
check(() => assert.equal(settleMs({ questions: { settleMinutes: 'ten' } }), 0), 'nonsense is off, not ten');
check(() => assert.equal(settleMs({ questions: { settleMinutes: -5 } }), 0), 'negative is off');
check(() => assert.equal(settleMs({ questions: { settleMinutes: 1000 } }), MAX_SETTLE_MINUTES * MIN), `a typo of 1000 is capped at ${MAX_SETTLE_MINUTES}, not refused`);

/* -------------------------------------------------------- 2. hold, due, release */

console.log('\nhold, due, release');
const T0 = at('2026-10-11T13:00:00.000Z');
const settle = 10 * MIN;

check(() => {
  const h = hold({}, q('loremia', 'lm-1'), T0);
  assert.deepEqual(Object.keys(h), ['loremia']);
  assert.deepEqual(Object.keys(h.loremia.keys), ['loremia/lm-1']);
  assert.equal(h.loremia.since, T0.toISOString());
}, 'hold files a question under its workspace with when it arrived');

check(() => {
  assert.equal(recentlyRang({}, 'loremia', T0, settle), false);
  assert.deepEqual(due(hold({}, q('loremia', 'lm-1'), T0), {}, T0, settle), ['loremia']);
}, 'a workspace that never rang is due on the tick it first holds something — a lone question is never late');

check(() => {
  const rangAt = { loremia: at('2026-10-11T12:55:00.000Z').toISOString() };
  assert.equal(recentlyRang(rangAt, 'loremia', T0, settle), true);
  assert.deepEqual(due(hold({}, q('loremia', 'lm-2'), T0), rangAt, T0, settle), []);
  assert.equal(ringsAgainInMinutes(rangAt, 'loremia', T0, settle), 5);
}, 'one that rang five minutes ago is not due, and says it rings again in five');

check(() => {
  const rangAt = { loremia: at('2026-10-11T12:49:00.000Z').toISOString() };
  assert.equal(recentlyRang(rangAt, 'loremia', T0, settle), false);
  assert.equal(ringsAgainInMinutes(rangAt, 'loremia', T0, settle), 0);
  assert.deepEqual(due(hold({}, q('loremia', 'lm-2'), T0), rangAt, T0, settle), ['loremia']);
}, 'one that rang eleven minutes ago is due');

check(() => {
  // Held at 12:52 (a minute after a 12:51 ring); at 13:00 the *ring* is nine minutes
  // old — not due — even though the hold is eight. At 13:02 it is.
  const rangAt = { loremia: at('2026-10-11T12:51:00.000Z').toISOString() };
  const h = hold({}, q('loremia', 'lm-3'), at('2026-10-11T12:52:00.000Z'));
  assert.deepEqual(due(h, rangAt, T0, settle), []);
  assert.deepEqual(due(h, rangAt, at('2026-10-11T13:02:00.000Z'), settle), ['loremia']);
}, 'the window is measured from the last ring, not from the first hold');

check(() => {
  const rangAt = { loremia: at('2026-10-11T12:55:00.000Z').toISOString() };
  assert.equal(recentlyRang(rangAt, 'loremia', T0, 0), false);
  assert.deepEqual(due(hold({}, q('loremia', 'lm-2'), T0), rangAt, T0, 0), ['loremia']);
}, 'a settle of zero never holds anything back');

check(() => {
  const rangAt = { loremia: at('2026-10-11T12:55:00.000Z').toISOString() };
  let h = hold({}, q('loremia', 'lm-2'), T0);
  h = hold(h, q('sorrel', 'sp-9'), T0);
  assert.deepEqual(due(h, rangAt, T0, settle), ['sorrel']);
}, 'workspaces are held apart — sorrel rings while loremia waits');

check(() => {
  let h = hold({}, q('loremia', 'lm-b'), at('2026-10-11T12:57:00.000Z'));
  h = hold(h, q('loremia', 'lm-a'), at('2026-10-11T12:56:00.000Z'));
  h = hold(h, q('sorrel', 'sp-1'), T0);
  const out = release(h, 'loremia');
  assert.deepEqual(out.keys, ['loremia/lm-a', 'loremia/lm-b']);
  assert.deepEqual(Object.keys(out.held), ['sorrel']);
}, 'release hands the keys back oldest first and takes the workspace out, leaving the others');

check(() => {
  const h1 = hold({}, q('loremia', 'lm-1'), at('2026-10-11T12:50:00.000Z'));
  const h2 = hold(h1, q('loremia', 'lm-1'), T0);
  assert.deepEqual(h2, h1);
  assert.deepEqual(release({}, 'loremia'), { held: {}, keys: [] });
}, 'holding a key twice changes nothing, and releasing an empty map is empty');

/* ------------------------------------------------------------------- 3. pruning */

console.log('\npruning');
check(() => {
  let h = hold({}, q('loremia', 'lm-1'), T0);
  h = hold(h, q('loremia', 'lm-2'), T0);
  h = hold(h, q('sorrel', 'sp-1'), T0);
  const kept = retainHeld(h, new Set(['loremia/lm-2']));
  assert.deepEqual(Object.keys(kept), ['loremia']);
  assert.deepEqual(Object.keys(kept.loremia.keys), ['loremia/lm-2']);
  assert.equal(kept.loremia.since, h.loremia.since);
}, 'a held key that left the inbox is dropped, and a workspace with nothing left goes with it');
check(() => assert.deepEqual(retainHeld(undefined, []), {}), 'nothing held is nothing kept');

/* ------------------------------------------------------------------- 4. the push */

console.log('\nthe push');

/** Run a pusher with `fetch` stubbed, and hand back what it would have published. */
async function published(fn) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => '' };
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
  return sent;
}

const cfg = {
  baseUrl: 'https://example.test:4318',
  token: 'tok',
  ntfy: { enabled: true, server: 'https://ntfy.example', topic: 'bc-test', detail: 'full', minimalWorkspaces: ['secret'], actionButtons: true },
  spaces: [],
  workspaces: [{ name: 'loremia' }, { name: 'secret' }],
};
const withOptions = (ws, id, extra = {}) =>
  q(ws, id, { decision: { options: [{ id: 'yes', label: 'Yes', response: 'Yes.' }, { id: 'no', label: 'No', response: 'No.' }] }, ...extra });

await checkAsync(async () => {
  const batch = [withOptions('loremia', 'lm-1', { priority: 3 }), withOptions('loremia', 'lm-2', { priority: 0 }), withOptions('loremia', 'lm-3', { answeredBefore: { at: T0.toISOString(), response: 'Yes.' } })];
  const sent = await published(() => notify.pushQuestions(cfg, 'loremia', batch));
  assert.equal(sent.length, 1, 'one push for three questions');
  const body = sent[0];
  assert.equal(body.topic, 'bc-test');
  assert.equal(body.title, 'loremia · 3 questions · 1 asked again');
  assert.deepEqual(body.message.split('\n'), ['lm-1 — Decide lm-1?', 'lm-2 — Decide lm-2?', 'lm-3 — Decide lm-3?']);
  assert.equal(body.actions, undefined, 'no action buttons on a batch');
  assert.equal(body.priority, 5, 'the loudest of the batch: a P0 among P3s is a P0');
  assert.equal(body.click, 'https://example.test:4318/', 'one tap opens the inbox');
}, 'three questions publish as one body: count in the title, one line each, no buttons, loudest priority');

await checkAsync(async () => {
  const sent = await published(() => notify.pushQuestions(cfg, 'loremia', [withOptions('loremia', 'lm-1')]));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'loremia · lm-1');
  assert.equal(sent[0].actions?.length, 2, 'a lone question keeps its buttons');
  assert.equal(sent[0].click, `https://example.test:4318/#${encodeURIComponent('loremia/lm-1')}`);
}, 'exactly one hands off to pushQuestion, buttons and deep link and all');

await checkAsync(async () => {
  const sent = await published(() => notify.pushQuestions(cfg, 'secret', [withOptions('secret', 's-1'), withOptions('secret', 's-2')]));
  assert.equal(sent[0].title, 'Beadcause');
  assert.equal(sent[0].message, '2 decisions are waiting — tap to open.');
  assert.equal(sent[0].actions, undefined);
}, 'a minimal workspace gets the count and nothing else');

await checkAsync(async () => {
  assert.deepEqual(await notify.pushQuestions(cfg, 'loremia', []), { skipped: true });
  assert.deepEqual(await notify.pushQuestions({ ...cfg, ntfy: { ...cfg.ntfy, enabled: false } }, 'loremia', [withOptions('loremia', 'lm-1'), withOptions('loremia', 'lm-2')]), { skipped: true });
}, 'an empty batch and a disabled ntfy both skip, the way pushQuestion does');

/* ------------------------------------------------------------------- 5. the class */

console.log('\nthe class');
check(() => assert.equal(SPEAKS.pushQuestions, ANSWER), 'pushQuestions speaks in class 1, beside pushQuestion');

/* ----------------------------------------------------------------------- summary */

await cleanupTmp(tmp);
console.log(`\n${ran} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
