#!/usr/bin/env node
/**
 * `lib/checkaudit.js`'s `stripComments`, held to the shape it actually has to handle.
 *
 *     npm test
 *     node test/checkaudit.mjs
 *
 * `stripComments` used to be two independent regexes run one after the other: block
 * comments first, then full-line line comments. That order is the bug (bc-xlz32.15).
 * `test/anchors.mjs` line 18 is a line-comment line whose own text names the glob
 * `docs/*.md`. The block-comment regex runs first and reads the star-slash open in that
 * glob as opening a real block comment, which then ran to the next close-star-slash it
 * could find — the one closing the file's JSDoc header at line 78 — and took the whole
 * import block with it. `buildGraph` in `lib/affected.js` read the stripped file as
 * having no imports at all, so a change to `lib/readme.js` or `lib/docset.js` never
 * selected `test/anchors.mjs`.
 *
 * The fix is a single left-to-right scan that tracks whether it is inside a line
 * comment, a block comment, a string, a template, or a regex literal at each character,
 * so a stray comment-opener that is really just text in one of those never opens
 * anything. These fixtures pin that: the exact anchors.mjs shape, and the same shape
 * happening instead inside a string, a template and a regex literal — the "other
 * direction" the bug filing named. They also pin that line numbers survive a
 * multi-line block comment, since `selectorsIn` and `lib/affected.js` both report a
 * token by counting them.
 */
import { stripComments } from '../lib/checkaudit.js';

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

/**
 * The exact anchors.mjs shape: a `//` line naming a `/*`-looking glob, a real import
 * between it and the next block-comment close, and a real block comment later that
 * must still close.
 */
const ANCHORS_SHAPE = [
  "// bc-28jtc split that file into `README.md` plus `docs/*.md`, and a link now has",
  "// two ways to break rather than one.",
  "import { docFiles } from '../lib/docset.js';",
  '',
  '/**',
  ' * file -> prose',
  ' */',
  'const docs = new Map();',
].join('\n');

{
  const stripped = stripComments(ANCHORS_SHAPE);
  if (/docset\.js/.test(stripped)) {
    ok("a `/*`-looking glob inside a `//` line does not swallow the import that follows it");
  } else {
    bad(
      "a `/*`-looking glob inside a `//` line does not swallow the import that follows it",
      `stripped: ${JSON.stringify(stripped)}`,
    );
  }
  if (stripped.split('\n').length === ANCHORS_SHAPE.split('\n').length) {
    ok('and the line count is unchanged');
  } else {
    bad(
      'and the line count is unchanged',
      `${ANCHORS_SHAPE.split('\n').length} -> ${stripped.split('\n').length}`,
    );
  }
}

/** The other direction: a `/*` or `//` sitting inside a string must not open anything either. */
{
  const src = [
    "const glob = 'docs/*.md and // not a comment';",
    "import { real } from './real.js';",
  ].join('\n');
  const stripped = stripComments(src);
  if (/real\.js/.test(stripped) && /docs\/\*\.md/.test(stripped)) {
    ok('a `/*` and a `//` inside a string are left alone, not read as comment starts');
  } else {
    bad(
      'a `/*` and a `//` inside a string are left alone, not read as comment starts',
      `stripped: ${JSON.stringify(stripped)}`,
    );
  }
}

/** Same, inside a template literal. */
{
  const src = ['const glob = `docs/*.md`;', "import { real } from './real.js';"].join('\n');
  const stripped = stripComments(src);
  if (/real\.js/.test(stripped) && /docs\/\*\.md/.test(stripped)) {
    ok('a `/*` inside a template literal is left alone, not read as a comment start');
  } else {
    bad(
      'a `/*` inside a template literal is left alone, not read as a comment start',
      `stripped: ${JSON.stringify(stripped)}`,
    );
  }
}

/** Same, inside a regex literal — and a real comment right after it still works. */
{
  const src = [
    "const RE = /\\/\\*not a comment\\//;",
    '// a real line comment',
    "import { real } from './real.js';",
  ].join('\n');
  const stripped = stripComments(src);
  if (/real\.js/.test(stripped) && !/a real line comment/.test(stripped)) {
    ok('a `/*`-shaped regex literal is left alone, and a real `//` after it still comments out');
  } else {
    bad(
      'a `/*`-shaped regex literal is left alone, and a real `//` after it still comments out',
      `stripped: ${JSON.stringify(stripped)}`,
    );
  }
}

/** A genuine multi-line block comment still disappears, and every line inside it survives. */
{
  const src = ['const a = 1; /*', 'line two', 'line three */ const b = 2;'].join('\n');
  const stripped = stripComments(src);
  const lines = stripped.split('\n');
  if (
    lines.length === 3 &&
    /const a = 1;/.test(lines[0]) &&
    !/line two/.test(stripped) &&
    !/line three/.test(stripped) &&
    /const b = 2;/.test(lines[2])
  ) {
    ok('a genuine multi-line block comment is removed and its line count survives');
  } else {
    bad(
      'a genuine multi-line block comment is removed and its line count survives',
      `stripped: ${JSON.stringify(stripped)}`,
    );
  }
}

/** A genuine trailing `//` comment is still removed, wherever it sits on the line. */
{
  const src = "const token = 'kept'; // '.mentioned-only-here' must not vouch for itself";
  const stripped = stripComments(src);
  if (/kept/.test(stripped) && !/mentioned-only-here/.test(stripped)) {
    ok('a trailing `//` comment after real code is still removed');
  } else {
    bad('a trailing `//` comment after real code is still removed', `stripped: ${JSON.stringify(stripped)}`);
  }
}

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n\x1b[32mall ${ran} checks passed\x1b[0m\n`);
process.exit(failures ? 1 : 0);
