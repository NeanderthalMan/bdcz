#!/usr/bin/env node
/**
 * The reader's notes layer — anchoring a page selection in the markdown SOURCE, and the
 * `docnotes` block a batch is sent as (bc-03vg2.2, public/docnotes.js).
 *
 *     npm test
 *     node test/docnotes.mjs
 *
 * The real public/docnotes.js in a vm. The selections are not made up: each is cut out
 * of what the real `marked` renders the fixture to, with the tags stripped — the text a
 * finger actually selects — so a projection that drifts from the renderer fails here
 * rather than on the phone.
 *
 * 1. **A quote is verbatim source**, and `source.slice(start, end)` is it. Across
 *    emphasis, a link, a heading that starts with a number, an entity and a tilde.
 * 2. **An emphasis marker is never cut in half** — replacing the quote leaves no stray `**`.
 * 3. **A repeated phrase is told apart by what surrounds it**, and when nothing can tell
 *    the copies apart the answer is a refusal, not a guess.
 * 4. **`section` and `line`** are the nearest heading above and the 1-based source line.
 * 5. **The block parses as YAML** into exactly the epic's shape, whatever the prose holds
 *    — quotes, colons, newlines, a leading dash.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import YAML from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
const check = (what, ok, detail = '') => {
  console.log(`${ok ? '  \x1b[32m✓\x1b[0m' : '  \x1b[31m✗\x1b[0m'} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
};
const section = (s) => console.log(`\n${s}`);

const ctx = vm.createContext({ JSON, String, Number, Math, Map, Set, Array, Object, RegExp, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync(path.join(HERE, '..', 'public', 'docnotes.js'), 'utf8'), ctx, { filename: 'docnotes.js' });
const { anchor, format, project } = ctx.beadcause.docnotes;

const SOURCE = [
  '# Chapter 25',
  '',
  '## 3. The Sky Lit Wrong',
  '',
  'The sky lit wrong that night, and **nobody on the ridge** said a word.',
  'Mara read the [ledger](notes/ledger.md) twice & put it down.',
  '',
  '> She said: "not yet" — and meant ~60 minutes.',
  '',
  '- one line_item here',
  '- the sky lit wrong again',
  '',
  '## 4. Morning',
  '',
  'It was quiet. It was quiet.',
  '',
].join('\n');

// What the page shows: the real renderer, tags stripped, entities decoded, whitespace
// collapsed — the same thing Selection.toString() hands the layer.
const page = marked
  .parse(SOURCE, { gfm: true, breaks: false })
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ');
const around = (sel, nth = 0) => {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = page.indexOf(sel, at + 1);
  if (at < 0) throw new Error(`fixture: "${sel}" is not on the page`);
  return { seenBefore: page.slice(Math.max(0, at - 200), at), seenAfter: page.slice(at + sel.length, at + sel.length + 200) };
};

section('a quote is the source, verbatim');
{
  const cases = [
    ['plain prose', 'The sky lit wrong that night', 'The sky lit wrong that night'],
    ['across bold', 'and nobody on the ridge said', 'and **nobody on the ridge** said'],
    ['across a link', 'read the ledger twice & put', 'read the [ledger](notes/ledger.md) twice & put'],
    ['a heading that starts with a number', '3. The Sky Lit Wrong', '3. The Sky Lit Wrong'],
    ['a quote with a tilde and quotes', 'She said: "not yet" — and meant ~60 minutes.', 'She said: "not yet" — and meant ~60 minutes.'],
    ['snake_case stays itself', 'one line_item here', 'one line_item here'],
    ['across two paragraphs', 'twice & put it down. She said', 'twice & put it down.\n\n> She said'],
  ];
  for (const [what, sel, want] of cases) {
    const a = anchor(SOURCE, sel, around(sel));
    check(`${what}`, a.ok && a.quote === want && SOURCE.slice(a.start, a.end) === a.quote, JSON.stringify(a));
  }
}

section('emphasis is never cut in half');
{
  const sel = 'nobody on the ridge said';
  const a = anchor(SOURCE, sel, around(sel));
  check('a selection starting inside bold takes in the opening marker', a.ok && a.quote === '**nobody on the ridge** said', a.quote);
  const edited = SOURCE.slice(0, a.start) + 'everyone said' + SOURCE.slice(a.end);
  check('and replacing it leaves no stray marker', !/\*\*/.test(edited.split('\n')[4]), edited.split('\n')[4]);
  const inner = anchor(SOURCE, 'nobody on the ridge', around('nobody on the ridge'));
  check('a selection exactly inside a pair keeps the emphasis outside it', inner.ok && inner.quote === 'nobody on the ridge', inner.quote);
}

section('repeats');
{
  const first = anchor(SOURCE, 'sky lit wrong', around('sky lit wrong', 0));
  check('the first "sky lit wrong" is picked by the text around it', first.ok && first.line === 5, JSON.stringify(first));
  const later = anchor(SOURCE, 'sky lit wrong', around('sky lit wrong', 1));
  check('and the second, in the list, by its own', later.ok && later.line === 11, JSON.stringify(later));
  const twin = anchor(SOURCE, 'It was quiet.', { seenBefore: '', seenAfter: '' });
  check('with nothing to tell two copies apart, it refuses', !twin.ok && /2 times/.test(twin.why), JSON.stringify(twin));
  const told = anchor(SOURCE, 'It was quiet.', around('It was quiet.', 1));
  check('and with the page around it, it picks the second', told.ok && SOURCE.slice(told.start - 1, told.start) === ' ', JSON.stringify(told));
  const none = anchor(SOURCE, 'a sentence nobody wrote', {});
  check('text that is not in the source is refused with a sentence', !none.ok && /can't be found/.test(none.why));
}

section('section and line');
{
  const a = anchor(SOURCE, 'Mara read the ledger', around('Mara read the ledger'));
  check('section is the nearest heading above', a.section === '## 3. The Sky Lit Wrong', a.section);
  check('line is 1-based', a.line === 6, String(a.line));
  check('before and after are the source either side', SOURCE.endsWith(a.after) || SOURCE.includes(a.before + a.quote + a.after));
  const b = anchor(SOURCE, 'It was quiet. It was', around('It was quiet. It was'));
  check('a later section is its own', b.section === '## 4. Morning', b.section);
}

section('plain text is anchored as itself');
{
  const txt = 'a *literal* star\nand [not a link](x)\n';
  const a = anchor(txt, 'a *literal* star and [not', { markdown: false });
  check('no markdown is stripped from a .txt', a.ok && a.quote === 'a *literal* star\nand [not', JSON.stringify(a));
  check('project keeps a map for every character it emits', project(txt, { markdown: false }).map.length === project(txt, { markdown: false }).plain.length);
}

section('the docnotes block');
{
  const notes = [
    { kind: 'suggest', section: '## 3. The Sky Lit Wrong', line: 5, quote: 'The sky lit wrong', before: '', after: ' that night', replacement: 'The sky burned: "wrong"' },
    { kind: 'comment', section: '## 3. The Sky Lit Wrong', line: 8, quote: 'She said: "not yet"', before: '> ', after: ' — and', note: '- is this line\nfrom chapter 2?' },
    { kind: 'suggest', line: 15, quote: 'It was quiet.', before: '', after: ' It', replacement: '' },
  ];
  const body = format({ file: '/Users/a/loremia/CHAPTER 25.md', ref: 'worktree-agent-aa1', blob: 'a'.repeat(40), notes });
  const m = /```docnotes\n([\s\S]*?)\n```/.exec(body);
  check('one fenced docnotes block', Boolean(m) && body.split('```docnotes').length === 2, body);
  let doc = null;
  try {
    doc = YAML.parse(m[1]);
  } catch (err) {
    check('it parses as YAML', false, err.message);
  }
  check('it parses as YAML', Boolean(doc));
  check('file, ref and blob', doc?.file === '/Users/a/loremia/CHAPTER 25.md' && doc?.ref === 'worktree-agent-aa1' && doc?.blob === 'a'.repeat(40), JSON.stringify(doc));
  check('every note, in order, with its kind', doc?.notes?.map((n) => n.kind).join(',') === 'suggest,comment,suggest');
  check('quotes, colons and newlines survive', doc?.notes?.[0]?.replacement === 'The sky burned: "wrong"' && doc?.notes?.[1]?.note === '- is this line\nfrom chapter 2?');
  check('an empty replacement is kept (it means delete)', doc?.notes?.[2]?.replacement === '');
  check('a comment carries no replacement', !('replacement' in (doc?.notes?.[1] || {})));
  check('line is a number', doc?.notes?.[0]?.line === 5);
  const noref = format({ file: '/x.md', ref: '', blob: '', notes: [notes[1]] });
  check('ref and blob are omitted when there are none', !/^ref:/m.test(noref) && !/^blob:/m.test(noref));
  check('the lead line counts the notes', /^3 notes on CHAPTER 25\.md at worktree-agent-aa1/.test(body) && /^1 note on x\.md/.test(noref), body.split('\n')[0]);
}

if (failures) {
  console.log(`\n\x1b[31m${failures} failed\x1b[0m`);
  process.exit(1);
}
console.log('\n\x1b[32mall passed\x1b[0m');
