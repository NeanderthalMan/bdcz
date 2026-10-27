#!/usr/bin/env node
/**
 * The ring for a window of Adam's that has stopped to wait for him — lib/waitalert.js.
 *
 *     node test/waitalert.mjs
 *
 * The decision is a pure function, so every branch is walked here with no Mac: which
 * kinds ring, the quiet threshold, once per quiet spell, a new spell rings again,
 * `repeatMinutes`, and each switch turning it off. Then the wiring: the advocate calls
 * it before the park switch, and the real ring refuses inside a suite.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);
const read = (...p) => fs.readFileSync(path.join(HERE, '..', ...p), 'utf8');

const { WAIT_ALERT_DEFAULTS, waitAlertDecision, waitAlertOptions, waitAlertText, ringMac } = await import(
  LIB('waitalert.js')
);

let failures = 0;
let ran = 0;
const check = async (name, fn) => {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 6).join('\n       ')}`);
  }
};

const NOW = new Date('2026-10-22T16:00:00Z');
const ago = (m) => new Date(NOW.getTime() - m * 60000).toISOString();
const handoff = { sessionId: 's1', kind: 'handoff', bead: 'eh-oac', title: 'Handoff — INNOV v2.3' };
const idle = (m) => ({ pid: 123, status: 'idle', at: ago(m) });
const opts = (over = {}) => waitAlertOptions(over);

await check('the defaults are handoffs, two minutes, notify + sound + focus, once', () => {
  const o = opts();
  assert.deepEqual(o.kinds, ['handoff']);
  assert.equal(o.afterMinutes, 2);
  assert.equal(o.notify, true);
  assert.equal(o.sound, 'Glass');
  assert.equal(o.focus, true);
  assert.equal(o.repeatMinutes, 0);
  assert.equal(WAIT_ALERT_DEFAULTS.enabled, true);
});

await check('a handoff quiet past the threshold rings, and says which spell', () => {
  const d = waitAlertDecision(handoff, idle(3), undefined, opts(), NOW);
  assert.equal(d.ring, true);
  assert.equal(d.spell, ago(3));
});

await check('not before the threshold, and never while busy', () => {
  assert.equal(waitAlertDecision(handoff, idle(1), undefined, opts(), NOW).ring, false);
  assert.equal(waitAlertDecision(handoff, { status: 'busy', at: ago(30) }, undefined, opts(), NOW).ring, false);
  assert.equal(waitAlertDecision(handoff, null, undefined, opts(), NOW).ring, false);
});

await check('once per quiet spell — and a new spell rings again', () => {
  const live = idle(5);
  const first = waitAlertDecision(handoff, live, undefined, opts(), NOW);
  const rang = { spell: first.spell, at: NOW.toISOString() };
  const later = new Date(NOW.getTime() + 20 * 60000);
  assert.equal(waitAlertDecision(handoff, live, rang, opts(), later).ring, false, 'same spell is silent');
  const again = { pid: 123, status: 'idle', at: new Date(later.getTime() - 3 * 60000).toISOString() };
  assert.equal(waitAlertDecision(handoff, again, rang, opts(), later).ring, true, 'answered, worked, stopped again');
});

await check('repeatMinutes re-rings a spell still waiting', () => {
  const live = idle(5);
  const rang = { spell: live.at, at: NOW.toISOString() };
  const o = opts({ repeatMinutes: 10 });
  assert.equal(waitAlertDecision(handoff, live, rang, o, new Date(NOW.getTime() + 5 * 60000)).ring, false);
  assert.equal(waitAlertDecision(handoff, live, rang, o, new Date(NOW.getTime() + 11 * 60000)).ring, true);
});

await check('kinds decides which windows ring; "*" rings them all', () => {
  const chat = { ...handoff, kind: 'chat' };
  assert.equal(waitAlertDecision(chat, idle(5), undefined, opts(), NOW).ring, false);
  assert.equal(waitAlertDecision(chat, idle(5), undefined, opts({ kinds: ['*'] }), NOW).ring, true);
  assert.equal(waitAlertDecision(chat, idle(5), undefined, opts({ kinds: ['chat'] }), NOW).ring, true);
});

await check('every off switch is off', () => {
  assert.equal(waitAlertDecision(handoff, idle(5), undefined, opts({ enabled: false }), NOW).ring, false);
  assert.equal(
    waitAlertDecision(handoff, idle(5), undefined, opts({ notify: false, focus: false }), NOW).ring,
    false,
    'nothing to do'
  );
  assert.equal(waitAlertDecision(handoff, idle(5), undefined, opts({ notify: false }), NOW).ring, true, 'focus alone');
});

await check('the notification names the bead and asks for a decision', () => {
  const t = waitAlertText(handoff, handoff.title);
  assert.match(t.title, /Handoff eh-oac is waiting on you/);
  assert.match(t.message, /decision/);
});

await check('the real ring refuses inside a suite — no chime, no stolen keyboard', async () => {
  const r = await ringMac({ live: idle(5), text: waitAlertText(handoff), opts: opts() });
  assert.equal(r.notified, false);
  assert.equal(r.focused, false);
  assert.match(r.why, /suite/);
});

await check('the advocate rings before the park switch, injectably', () => {
  const src = read('lib', 'advocate.js');
  assert.match(src, /ring = ringMac,/, 'injected with the real one as default');
  const at = src.indexOf('if (!OBSERVING) ringWaiting(a, opened, sessions);');
  const sw = src.indexOf("if (o.parkIdleWindows === false || o.closeFinishedSessions === false || OBSERVING) {");
  assert.ok(at > 0 && sw > at, 'turning parking off must not silence the ring');
});

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m` : `\n\x1b[32m${ran} passed\x1b[0m`);
process.exit(failures ? 1 : 0);
