#!/usr/bin/env node
/**
 * A shut question card leads with the question and says where it is from in one line
 * (bc-yjekg.4).
 *
 * Adam measured Home at ~430px a card — 113 cards, ~46 phone screens — and most of what
 * sat above each question was a header of pills: workspace, id, priority, the model
 * chip, who it is for, the age, and often a two-line arrived-quietly postmark under
 * them. The new shape: shut, the question first and then one muted
 * `workspace · id · Pn · age` line; open, the full pill row exactly as before, which is
 * where the labels (model, approval) and the owner (`📮 for`) now live.
 *
 * What this pins, by drawing `cardHtml` both ways in a vm (the stub floor is the one
 * test/cardtap.mjs explains — every helper this file has no opinion about returns ''):
 *
 *   1. shut, there is no pill row, no owner pill, no model chip and no postmark, and the
 *      meta line comes *after* the title;
 *   2. the meta line carries the four facts, in that order, and keeps the states that are
 *      not mere metadata — a saved draft, a ruling, a broken tier — as pills;
 *   3. open, every one of the moved things is back in the head, so nothing was lost.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const APP = read('public/app.js');
const CSS = read('public/style.css');

let failures = 0;
let ran = 0;
function check(name, fn) {
  ran += 1;
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${err.message}`);
  }
}

/** Lift one declaration out of public/app.js — the same two shapes as test/cardtap.mjs. */
function lift(src, opener) {
  const at = src.indexOf(opener);
  assert.notEqual(at, -1, `public/app.js no longer declares \`${opener}\``);
  if (opener.startsWith('function')) {
    let depth = 0;
    for (let i = src.indexOf('{', at); i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (!depth) return src.slice(at, i + 1);
      }
    }
    throw new Error(`unbalanced braces after ${opener}`);
  }
  let depth = 0;
  for (let i = at; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`no statement end after ${opener}`);
}

const STUB = () => '';
const real = {
  String,
  JSON,
  Date,
  Math,
  Object,
  Boolean,
  Array,
  Number,
  state: null,
  // Markers rather than the real chips: what is asserted is *where* each one is drawn,
  // and the chips' own contents are test/modelcard.mjs's and test/readdress.mjs's.
  modelChipHtml: () => '<span class="pill model">MODEL</span>',
  approvalChipHtml: (q) => (q.approval ? '<span class="pill approval">RULING</span>' : ''),
  addresseeHtml: () => '<button class="pill for">OWNER</button>',
  arrivedQuietHtml: () => '<p class="quiet-note">QUIET</p>',
  getDraft: () => '',
};
const ctx = vm.createContext(
  new Proxy(real, {
    has: () => true,
    get: (t, k) => (k in t ? t[k] : STUB),
  })
);
vm.runInContext(
  [
    lift(APP, 'const esc = ('),
    lift(APP, 'const shutCardAct = ('),
    lift(APP, 'function relTime(iso)'),
    lift(APP, 'function metaLineHtml(q, draft)'),
    lift(APP, 'function cardHtml(q)'),
  ].join('\n'),
  ctx
);

const draw = (q, { open = false, draft = '' } = {}) => {
  real.state = { open: new Set(open ? [q.key] : []), menu: null, logs: new Set() };
  real.getDraft = () => draft;
  return vm.runInContext('cardHtml(Q)', Object.assign(ctx, { Q: q }));
};

const question = (extra = {}) => ({
  key: 'beadcause/bc-aaa1',
  workspace: 'beadcause',
  id: 'bc-aaa1',
  priority: 1,
  title: 'Slim the card header',
  question: 'Should the question come first?',
  sections: [],
  decision: { options: [] },
  createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  ...extra,
});

/** The card head's markup, which is where everything here is drawn. */
const head = (html) => html.slice(html.indexOf('<div class="card-head">'), html.indexOf('<div class="brief"'));

console.log('\nshut: the question, then one line\n');

check('a shut card draws no pill row, owner, model chip or postmark', () => {
  const h = head(draw(question()));
  assert.doesNotMatch(h, /<div class="meta">/, 'the pill row is still drawn on a shut card');
  assert.doesNotMatch(h, /OWNER/, 'the owner pill is still on the shut card');
  assert.doesNotMatch(h, /MODEL/, 'the model chip is still on the shut card');
  assert.doesNotMatch(h, /QUIET/, 'the arrived-quietly postmark is still on the shut card');
});

check('the meta line comes after the title, not before it', () => {
  const h = head(draw(question()));
  const title = h.indexOf('class="q"');
  const line = h.indexOf('class="meta-line"');
  assert.ok(line > -1, 'no meta line on the shut card');
  assert.ok(title > -1 && line > title, 'the meta line is drawn above the question');
});

check('it says workspace · id · Pn · age, in that order', () => {
  const h = head(draw(question()));
  const text = h
    .slice(h.indexOf('class="meta-line"'))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  assert.match(text, /beadcause · bc-aaa1 · P1 · 3d ago/, text);
});

check('P0 and P1 keep their warn colour', () => {
  assert.match(head(draw(question())), /class="pri p1"/);
  assert.match(CSS, /\.meta-line \.pri\.p0, \.meta-line \.pri\.p1 \{[^}]*var\(--warn\)/);
});

check('no stray separator when the bead has no priority or no date', () => {
  const h = head(draw(question({ priority: null, createdAt: '' })));
  const line = h.slice(h.indexOf('class="meta-line"'), h.indexOf('</p>', h.indexOf('class="meta-line"')));
  assert.equal((line.match(/class="sep"/g) || []).length, 1, line);
});

check('states that ask something of you stay visible on the shut card', () => {
  const h = head(draw(question({ approval: { label: 'in-review' }, model: { model: 'opus', problem: 'two tiers' } }), { draft: 'half an answer' }));
  const line = h.slice(h.indexOf('class="meta-line"'));
  assert.match(line, /draft saved/, 'a saved draft went quiet');
  assert.match(line, /RULING/, 'a ruling in progress went quiet');
  assert.match(line, /MODEL/, 'a broken complexity tier went quiet');
});

check('a healthy model chip is metadata, and waits for the open card', () => {
  const h = head(draw(question({ model: { model: 'opus' } })));
  assert.doesNotMatch(h, /MODEL/);
});

console.log('\nopen: nothing was lost\n');

check('open, the full pill row is back with the labels, the owner and the postmark', () => {
  const h = head(draw(question({ approval: { label: 'in-review' } }), { open: true }));
  assert.match(h, /<div class="meta">/, 'the open card lost its pill row');
  for (const m of ['MODEL', 'RULING', 'OWNER', 'QUIET']) assert.match(h, new RegExp(m), `${m} is gone from the open card`);
  assert.doesNotMatch(h, /class="meta-line"/, 'the open card says it twice');
});

check('the meta line has a rule to draw it with', () => {
  assert.match(CSS, /^\.meta-line \{/m);
});

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n${ran} passed\n`);
process.exit(failures ? 1 : 0);
