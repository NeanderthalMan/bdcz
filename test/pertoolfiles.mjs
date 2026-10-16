#!/usr/bin/env node
/**
 * Adding a `b7e-*` tool touches only new files — and the two places it used to append to
 * stay empty of per-tool text.
 *
 *     npm test
 *     node test/pertoolfiles.mjs
 *
 * bc-fmk4v. On 2026-09-19, 37 of 48 open pull requests were CONFLICTING, and merging each
 * of them onto `origin/main` locally (with `.gitattributes`' union driver honoured, which
 * GitHub's own flag does not do) said where: **13 in `docs/b7e-tools.md`, 7 in
 * `lib/tooldecl.js`**, and in each case over text no other branch had an opinion about.
 * Both were end-of-file appends. A tool's `### ` section went at the end of the chapter and
 * the paragraph arguing for its grant went at the end of the module, so any two tool
 * branches in flight were writing at the same anchor and whichever landed first conflicted
 * every other — not by bad luck, by construction, the same shape bc-8479e measured in
 * `lib/grants.js` and bc-wbrhi then deleted the cause of.
 *
 * The fix was to give each tool its own files: `docs/b7e/<name>.md` for the section, and
 * the tool's own header for the argument, beside the `@grant` line it argues for. That is
 * only worth anything while it holds. A shared anchor regrows one convenient paragraph at
 * a time — a section appended to the chapter because that is where the others used to be,
 * a `b7e-register` that starts writing the argument back into `lib/tooldecl.js` — and each
 * of those looks like a small tidy edit right up until the next pair of branches collide
 * over it. So this suite is the ratchet: it fails the repo on the *shape* of the regrowth
 * rather than on any one instance of it.
 *
 * Deliberately not a check that the documentation is any good. `b7e-enroll`'s check 5 asks
 * whether a tool's own file names it; this asks the opposite question — whether anything
 * per-tool has landed back in a file every branch shares.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DECLARATIONS } from '../lib/tooldecl.js';
import { docFiles } from '../lib/docset.js';
import { REGISTRY_FILES } from '../lib/enroll.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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
const check = (name, fn) => {
  try {
    fn();
    ok(name);
  } catch (err) {
    bad(name, err.message.split('\n').join('\n      '));
  }
};

console.log('\nOne file per b7e tool — the shared anchors stay empty\n');

const TOOLS = DECLARATIONS.map((d) => d.name);
assert.ok(TOOLS.length > 60, `only ${TOOLS.length} declared tools — the read of bin/ is wrong, not the tree`);

/* ------------------------------------------- the chapter holds no per-tool section */

check('docs/b7e-tools.md carries no `### … `b7e-x`` section', () => {
  const offenders = read('docs/b7e-tools.md')
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /^### /.test(line) && /`b7e-[a-z0-9-]+`/.test(line));
  assert.deepEqual(
    offenders.map((o) => `docs/b7e-tools.md:${o.n}  ${o.line}`),
    [],
    'a tool documented in the shared chapter is the end-of-file anchor bc-fmk4v took apart — 13 of the\n' +
      '48 open pull requests on 2026-09-19 conflicted there. Move the section to docs/b7e/<name>.md,\n' +
      'which no other branch is editing. The chapter keeps the prose that is about the family rather\n' +
      'than about one of them.'
  );
});

check('every declared tool has its own docs/b7e/<name>.md, naming it in a ### heading', () => {
  const missing = [];
  for (const name of TOOLS) {
    const rel = `docs/b7e/${name}.md`;
    let text = null;
    try {
      text = read(rel);
    } catch {
      missing.push(`${rel} is not there`);
      continue;
    }
    if (!new RegExp('^### .*`' + name + '`', 'm').test(text)) missing.push(`${rel} has no ### section naming ${name}`);
  }
  assert.deepEqual(missing, [], `${missing.length} tool(s) are not documented in their own file:\n` + missing.join('\n'));
});

check('a file in docs/b7e/ documents one tool — its own', () => {
  const strays = [];
  for (const file of docFiles(ROOT).filter((f) => f.startsWith('docs/b7e/'))) {
    const own = path.basename(file, '.md');
    for (const m of read(file).matchAll(/^### .*$/gm)) {
      const named = [...m[0].matchAll(/`(b7e-[a-z0-9-]+)`/g)].map((x) => x[1]);
      if (named.length && !named.includes(own)) strays.push(`${file}  ${m[0]}`);
    }
  }
  assert.deepEqual(
    strays,
    [],
    'a `###` section for another tool in a tool\'s own file is the shared anchor again, one file\n' +
      'further down. Give it its own:\n' + strays.join('\n')
  );
});

/* ------------------------------ lib/tooldecl.js holds no per-tool argument either */

check('lib/tooldecl.js has no per-tool grant paragraph appended to it', () => {
  const src = read('lib/tooldecl.js');
  const offenders = src
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    // The two shapes the run was written in: the hand-written excluded paragraph's opening
    // sentence, and the `→` line `b7e-register` wrote under a granted one.
    .filter(({ line }) => /is deliberately NOT on this list/.test(line) || /→ Bash\(b7e-/.test(line));
  assert.deepEqual(
    offenders.map((o) => `lib/tooldecl.js:${o.n}  ${o.line.trim()}`),
    [],
    "the argument for one tool's grant belongs in that tool's own header, above the @grant line it\n" +
      'argues for. Appending it here is the anchor 7 of the 48 open pull requests on 2026-09-19\n' +
      'conflicted at. `git show 7c47d7d77:lib/tooldecl.js` is the run as it stood before bc-fmk4v.'
  );
});

check('a tool whose grant is excluded says why, in its own header', () => {
  const unsaid = [];
  for (const d of DECLARATIONS.filter((x) => x.kind === 'excluded')) {
    const src = read(`bin/${d.file}`);
    const header = src.slice(0, src.search(/^[ \t]*(?:\*|\/\/)?[ \t]*@grant[ \t]/m));
    // Not a word count: the question is whether the file says the decision was deliberate,
    // which is the sentence every one of the sixty-nine moved paragraphs opens with and the
    // one `b7e-register --kind excluded` now writes.
    if (!/deliberately (NOT on|excluded)/i.test(header)) unsaid.push(`bin/${d.file}`);
  }
  assert.deepEqual(
    unsaid,
    [],
    `${unsaid.length} excluded tool(s) declare the decision and never argue it. Say "<name> is\n` +
      'deliberately NOT on DEFAULT_TOOL_LIST" and why, above the @grant line — `@grant excluded` says\n' +
      'what was decided and nothing anywhere else says why:\n' + unsaid.join('\n')
  );
});

/* ------------------------------------------ the applier cannot write them back */

check('b7e-register writes no shared file but the two bin maps', () => {
  assert.deepEqual(
    [...REGISTRY_FILES],
    ['package.json', 'package-lock.json'],
    'REGISTRY_FILES is what b7e-register edits besides the tool\'s own file. Both of these are\n' +
      'merge=union in .gitattributes, which is what makes an append to them resolve itself. Anything\n' +
      'else here is a file two tool branches will conflict in.'
  );
});

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n${ran} passed\n`);
process.exit(failures ? 1 : 0);
