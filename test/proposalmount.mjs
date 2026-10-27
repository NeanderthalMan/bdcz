#!/usr/bin/env node
/**
 * One proposal card, and the three ways a mount of it breaks silently.
 *
 *     npm test
 *     node test/proposalmount.mjs
 *
 * bc-yjekg.5 took the proposal card out of public/app.js and into public/proposal.js, and
 * public/monitor.js and public/mirror.js stopped drawing their own. What that bead was
 * fixing is in docs/ux-review.md §4.3: three renderers, two independent pick stores, and
 * the Advocates page sending `create` without `edits` — so a proposal adjusted on the
 * phone and filed from that page was filed with the agent's original title.
 *
 * The behaviour of the card itself is covered end to end by scripts/proposal-check.mjs,
 * which drives the real app.js in a headless Chrome against a proposal built by
 * lib/proposal.js. That check is not in `npm test` and it only ever exercised the inbox.
 * What is left over is *wiring* — three ways a mount is wrong in a manner no unit suite
 * touching the renderers can see, because none of them loads a page:
 *
 *   1. **A host hook passed as a bare identifier rather than a thunk.** This is not
 *      hypothetical and it is not style. The inbox's mount sits where the proposal code
 *      used to live, ~6500 lines above `byKey` and `listEl`, and both are `const`. Writing
 *      `byKey,` in the object literal reads it in its temporal dead zone and throws a
 *      ReferenceError as public/app.js loads, taking the **whole inbox** down. Every unit
 *      suite stayed green — they exercise renderers directly and never load app.js as a
 *      script — and the symptom in scripts/viewbar-check.mjs was every pill badge reading
 *      0 and the scope switch doing nothing. A page that had not run, not one that had
 *      counted wrong. It cost a browser check to find and one character to fix.
 *   2. **A page that mounts the card without loading it**, or loading it too late. The
 *      module registers on `window.beadcause` and is read at mount time, which is IIFE
 *      time on all three files, so "after" is not a near miss — it is the same
 *      ReferenceError with a different name on it.
 *   3. **A renderer growing back.** The duplication took a month to notice the first
 *      time, because a second `picksFor` in another file is invisible from the first.
 *
 * Read as code, never as prose: every file here argues in comments that name the
 * identifiers, so a grep over a region is routinely satisfied by the paragraph above the
 * line it is guarding (bc-0i27.3). The slicing helpers below drop comment lines by how
 * they *start*, which is the same bargain test/editfreeze.mjs makes and for the same
 * reason.
 *
 * Reads files and nothing else. No network, no spawn, no writes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');
const read = (p) => fs.readFileSync(path.join(PUBLIC, p), 'utf8');

/** The files that mount the card. Named, so a fourth has to be added here deliberately. */
const MOUNTS = ['app.js', 'monitor.js', 'mirror.js'];

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
    console.log(`      ${err.message.split('\n').join('\n      ')}`);
  }
}

/* ------------------------------------------------------------------- slicing */

/**
 * The braced region starting at or after `from`.
 *
 * Brace counting is sound over these object literals and unsound in general — a `{` in a
 * string or a regex would throw it off. It does not fail quietly: an unbalanced slice runs
 * off the end of the file and the check reading it goes red naming the file.
 */
function braceBody(src, from, what) {
  const open = src.indexOf('{', from);
  assert.notEqual(open, -1, `${what}: no object literal follows`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`${what}: the literal never closes`);
}

const codeLines = (body) =>
  body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));

/* --------------------------------------------------------------------- checks */

console.log('\nthe one proposal card, and how a mount of it is wired');

/* ------------------------------------------------------ 1: every hook is a thunk */

/**
 * The hooks whose value is read when the mount is *built*.
 *
 * `root` is here too although proposal.js only ever calls it: a mount that passed the
 * element itself would capture whatever `listEl` was at IIFE time, which on the inbox is
 * the dead zone again and on a page that swaps its container is simply the wrong element.
 */
const HOOKS = ['root', 'markdown', 'byKey', 'gate', 'armed', 'arm', 'disarm', 'rerender', 'submit'];

for (const file of MOUNTS) {
  check(`public/${file} passes every host hook as a thunk, never a bare name`, () => {
    const src = read(file);
    const at = src.indexOf('proposal.bind(');
    assert.notEqual(at, -1, `public/${file} no longer mounts the card — if that is deliberate, take it out of MOUNTS`);
    assert.equal(src.indexOf('proposal.bind(', at + 1), -1, `public/${file} mounts the card twice — the slice is ambiguous`);
    const lines = codeLines(braceBody(src, at, `${file}'s bind`));

    const bad = [];
    for (const line of lines) {
      // `byKey,` — shorthand, the exact shape that threw. Only at the top level of the
      // literal, which is what `codeLines` of the braced body gives us for a one-deep key.
      for (const hook of HOOKS) {
        if (line === `${hook},`) bad.push(`\`${hook},\` is shorthand — it reads ${hook} now; write \`${hook}: (…) => ${hook}(…)\``);
        // `byKey: byKey,` and `byKey: someOtherName,` are the same mistake spelled out.
        const named = new RegExp(`^${hook}:\\s*([A-Za-z_$][\\w$]*)\\s*,?$`);
        const m = line.match(named);
        if (m && m[1] !== 'null' && m[1] !== 'undefined') {
          bad.push(`\`${line}\` hands over ${m[1]} itself — wrap it: \`${hook}: (…) => ${m[1]}(…)\``);
        }
      }
    }
    assert.deepEqual(
      bad,
      [],
      `a hook is read at mount time rather than at call time, which throws if it is a \`const\` below:\n  ${bad.join('\n  ')}`
    );
  });
}

check('and the hazard behind that rule is still real in the inbox', () => {
  const src = read('app.js');
  const mountAt = src.indexOf('proposal.bind(');
  const declAt = src.indexOf('const byKey =');
  assert.notEqual(declAt, -1, 'public/app.js no longer declares `const byKey =`');
  // Not "this must stay broken": the thunks are correct either way. This is the note to
  // whoever relaxes the rule above, and it says the cost is not hypothetical — `byKey` is
  // still declared thousands of lines *below* the mount that uses it, so a bare name
  // there is still a ReferenceError at load and still takes the whole inbox with it. If
  // this ever fails because the two were reordered, the rule is cheap to keep anyway;
  // read the header before deciding it has stopped earning its place.
  assert.ok(
    declAt > mountAt,
    '`const byKey =` now precedes the mount, so the dead-zone hazard has moved — re-read the thunk check above before relaxing it'
  );
});

/* ------------------------------------------- 2: every page that mounts it loads it */

const PAGES = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));

check('every page loading a mount loads /proposal.js first', () => {
  const bad = [];
  for (const page of PAGES) {
    const html = read(page);
    const mounted = MOUNTS.filter((m) => html.includes(`/${m}"`));
    if (!mounted.length) continue;
    const modAt = html.indexOf('/proposal.js"');
    if (modAt === -1) {
      bad.push(`${page} loads ${mounted.join(', ')} but never loads /proposal.js`);
      continue;
    }
    for (const m of mounted) {
      const at = html.indexOf(`/${m}"`);
      if (at < modAt) bad.push(`${page} loads /${m} before /proposal.js — the mount runs on an undefined namespace`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n  '));
});

check('and the service worker precaches it beside app.js', () => {
  const sw = read('sw.js');
  // SHELL is an array, so this is bracket matching rather than `braceBody` — the `{` in
  // a comment inside it would otherwise be counted. Same caveat either way: an
  // unbalanced slice runs off the end and this check goes red naming the list.
  const open = sw.indexOf('const SHELL = [');
  assert.notEqual(open, -1, 'public/sw.js no longer declares `const SHELL = [`');
  let depth = 0;
  let close = -1;
  for (let i = sw.indexOf('[', open); i < sw.length; i++) {
    if (sw[i] === '[') depth += 1;
    else if (sw[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  assert.notEqual(close, -1, 'SHELL never closes');
  assert.ok(
    codeLines(sw.slice(open, close)).some((l) => l.startsWith("'/proposal.js'")),
    'a cached page holding the new app.js without this file finds window.beadcause.proposal undefined and throws where the inbox builds a proposal card'
  );
});

/* ------------------------------------------------- 3: no renderer has grown back */

check('the rows, the picks and the bulk controls are written in exactly one file', () => {
  const owned = ['picksFor', 'editsFor', 'keepIndices', 'undecidedCount', 'bulkLabel'];
  const bad = [];
  for (const file of MOUNTS) {
    const lines = codeLines(read(file));
    for (const name of owned) {
      // A *definition*, not a mention: `const picksFor = ` or `function picksFor(`.
      const defines = lines.some((l) => l.startsWith(`const ${name} =`) || l.startsWith(`function ${name}(`));
      if (defines) bad.push(`public/${file} defines its own ${name} — that is the duplication bc-yjekg.5 removed`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n  '));
});

check('and the module that does own them exports what a mount needs', () => {
  const lines = codeLines(read('proposal.js'));
  for (const name of ['function bind(', 'function rowsHtml(', 'function bulkHtml(', 'function answerFor(', 'function paint(']) {
    assert.ok(
      lines.some((l) => l.startsWith(name)),
      `public/proposal.js no longer defines \`${name}…\``
    );
  }
});

check('the mirror answers with the real buttons rather than naming another screen', () => {
  const src = read('mirror.js');
  // The sentence the review quoted, in the shape it was written. Its absence is asserted
  // rather than left to the diff: it is the one line that made this pane a dead end.
  assert.ok(
    !src.includes('Per-bead buttons live on'),
    'the Mirror is telling you to go to the Advocates tab again — it has the buttons now'
  );
  assert.ok(src.includes('proposal.bind('), 'the Mirror no longer mounts the card at all');
});

check('all three send edits, not just the approved indices', () => {
  const bad = [];
  for (const file of MOUNTS) {
    const src = read(file);
    // app.js routes through its own submit(), which takes `edits` as an option; the other
    // two build the request body themselves. Either way the word has to appear in the
    // submit hook, because sending `create` alone is precisely the bug that shipped.
    const at = src.indexOf('proposal.bind(');
    const body = braceBody(src, at, `${file}'s bind`);
    const lines = codeLines(body).join('\n');
    const inline = lines.includes('edits');
    // A mount may delegate to a named function instead of inlining the request.
    const delegated = /submit:[^\n]*=>\s*([A-Za-z_$][\w$]*)\(/.exec(lines);
    const named = delegated ? codeLines(src).join('\n').includes(`function ${delegated[1]}`) : false;
    if (!inline && !named) bad.push(`public/${file}'s submit hook mentions neither edits nor a named submitter`);
  }
  assert.deepEqual(bad, [], bad.join('\n  '));
});

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m` : `\n\x1b[32mall ${ran} checks passed\x1b[0m`);
process.exit(failures ? 1 : 0);
