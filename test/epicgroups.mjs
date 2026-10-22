#!/usr/bin/env node
/**
 * The question list, grouped by the effort each card belongs to. bc-yjekg.
 *
 * `epicChunks` in public/app.js turns the waiting questions into a heading per epic with
 * its cards beneath, off `rootboard.epics` (`rowEpics` in lib/server.js). What this holds
 * it to: the server's order survives the grouping, "No epic" is last, a folded group
 * keeps a card that is open, and with no epic known the list is the flat one it was.
 *
 * Lifted out of the real file with the same `lift` test/p0card.mjs uses, so a rename
 * fails here by name rather than passing over code that no longer exists. `cardHtml` is
 * stubbed: what a card looks like is other suites' business, only which cards and where.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');

let failures = 0;
let ran = 0;
function check(name, fn) {
  ran += 1;
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n').slice(0, 6).join('\n      ')}`);
  }
}

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

/** The list as `epicChunks` would hand it to the reconciler, for a page state you give it. */
function chunks(rows, { epics = {}, folds = [], open = [] } = {}) {
  const state = { rootboard: { epics }, epicFolds: new Set(folds), open: new Set(open) };
  const context = vm.createContext({
    String,
    Number,
    encodeURIComponent,
    state,
    cardHtml: (q) => `<article>${q.key}</article>`,
  });
  vm.runInContext(
    [
      lift(APP, 'const esc = ('),
      lift(APP, 'function graphUrl(q)'),
      lift(APP, 'function epicChunks(rows)'),
      lift(APP, 'function epicHeadHtml(g, folded)'),
      lift(APP, 'function epicBarHtml(ids)'),
      'globalThis.out = epicChunks(globalThis.rows);',
    ].join('\n'),
    Object.assign(context, { rows })
  );
  // Into this realm: an array built inside the vm is not `deepEqual` to one built here.
  return Array.from(context.out);
}

const q = (key) => ({ key, workspace: key.split('/')[0], id: key.split('/')[1] });
const E = (workspace, id, title, priority = 1) => ({ workspace, id, title, priority });

check('with no epic known for any row, the list is the flat one it was — no bar, no headings', () => {
  const out = chunks([q('bc/a'), q('bc/b')]);
  assert.deepEqual(
    out.map((c) => c.key),
    ['bc/a', 'bc/b']
  );
});

check('groups come in the order of their first card, and keep the server order inside', () => {
  const out = chunks([q('bc/a'), q('bc/b'), q('bc/c')], {
    epics: { 'bc/a': E('bc', 'x', 'X'), 'bc/b': E('bc', 'y', 'Y'), 'bc/c': E('bc', 'x', 'X') },
  });
  assert.deepEqual(
    out.map((c) => c.key),
    ['@epic-bar', '@epic:bc/x', 'bc/a', 'bc/c', '@epic:bc/y', 'bc/b']
  );
});

check('"No epic" is last, even when its card came first', () => {
  const out = chunks([q('bc/a'), q('bc/b')], { epics: { 'bc/b': E('bc', 'y', 'Y') } });
  assert.deepEqual(
    out.map((c) => c.key),
    ['@epic-bar', '@epic:bc/y', 'bc/b', '@epic:none', 'bc/a']
  );
  assert.match(out.at(-2).html, /No effort/);
});

check('a folded group draws its heading alone, but keeps a card that is open', () => {
  const epics = { 'bc/a': E('bc', 'x', 'X'), 'bc/b': E('bc', 'x', 'X') };
  const shut = chunks([q('bc/a'), q('bc/b')], { epics, folds: ['bc/x'] });
  assert.deepEqual(
    shut.map((c) => c.key),
    ['@epic-bar', '@epic:bc/x']
  );
  const open = chunks([q('bc/a'), q('bc/b')], { epics, folds: ['bc/x'], open: ['bc/b'] });
  assert.deepEqual(
    open.map((c) => c.key),
    ['@epic-bar', '@epic:bc/x', 'bc/b']
  );
});

check('the heading counts the whole group, folded or not, and says which epic it is', () => {
  const epics = { 'bc/a': E('bc', 'x', 'X', 0), 'bc/b': E('bc', 'x', 'X', 0) };
  const head = chunks([q('bc/a'), q('bc/b')], { epics, folds: ['bc/x'] })[1].html;
  assert.match(head, /2 waiting/);
  assert.match(head, /aria-expanded="false"/);
  assert.match(head, /class="pill p0">P0</);
  assert.match(head, /href="\/graph\?ws=bc&amp;id=x"/);
});

check('an epic title cannot write markup into the heading', () => {
  const head = chunks([q('bc/a')], { epics: { 'bc/a': E('bc', 'x', '<img src=x onerror=1>') } })[1].html;
  assert.doesNotMatch(head, /<img/);
});

check('the bar offers to fold until everything is folded, then to unfold', () => {
  const epics = { 'bc/a': E('bc', 'x', 'X'), 'bc/b': E('bc', 'y', 'Y') };
  assert.match(chunks([q('bc/a'), q('bc/b')], { epics, folds: ['bc/x'] })[0].html, /Fold all/);
  assert.match(chunks([q('bc/a'), q('bc/b')], { epics, folds: ['bc/x', 'bc/y'] })[0].html, /Unfold all/);
});

check('the heading is a full-size tap target', () => {
  assert.match(CSS, /\.epic-fold \{[^}]*min-height: var\(--tap\)/);
});

console.log(`\n${failures ? `\x1b[31m${failures} of ${ran} failed\x1b[0m` : `\x1b[32mall good\x1b[0m (${ran})`}\n`);
process.exit(failures ? 1 : 0);
