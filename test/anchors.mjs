#!/usr/bin/env node
//
// Every `](#…)` and `](other.md#…)` link across the specification points at a heading that
// exists — and the mirror has a section for them to point at.
//
//   npm test
//   node test/anchors.mjs
//
// bc-h3t7: the README is this project's spec and it cross-links itself constantly — which
// is the only thing that makes a document this long navigable. Nothing checked those links.
// A broken one is silent in the worst way: GitHub renders it as an ordinary link, clicking
// it scrolls nowhere, and the reader concludes the section it promised does not exist.
// Three were already broken when this file was written, two of them because a heading had
// been *retitled* — `## Pull requests — merged, pushed, deployed` gained "review" and
// "live", and every link to it died without anything moving. That is the failure this
// catches, and it is the common one: a heading is edited in one place and the links to it
// are somewhere else entirely.
//
// bc-28jtc split that one file into `README.md` plus `docs/*.md`, and a link now has two
// ways to break rather than one. **The second is worse**, because it is invisible to the
// check this file used to be: a link written `](#some-heading)` that used to resolve inside
// one file still *parses* after the section it points at has moved to another document, and
// a checker that only looks in the current file reports "no such heading" — or, if the two
// documents happen to share a slug, reports nothing at all and lets the link scroll to the
// wrong place. So resolution here is set-wide: a bare `#slug` must be a heading in the file
// that wrote it, and `other.md#slug` must be a heading in the file it names, with the path
// resolved the way a reader's browser would resolve it.
//
// The slug rules are GitHub's, and the trap is the em dash: it is punctuation, so it is
// *dropped* rather than replaced, and the spaces on either side of it both become hyphens.
// `## A second instance — observer mode` is `#a-second-instance--observer-mode`, with two.
//
// Deliberately only the anchors: this says nothing about whether the prose is right, only
// that a link you followed lands where it says it does.
//
// Duplicate headings are still fine — "Checking it" is how nine different sections end, and
// nothing needs those to be unique. What is *not* fine is linking to one, because GitHub
// resolves an ambiguous slug by document order, and that is the last check here (bc-gop1).
// Two links were in exactly that position when this file was written: both happened to land
// on the heading they meant, because the intended heading was the first occurrence in both
// cases, and neither was stable — inserting a section with the same subheading *earlier* in
// the file would have silently redirected the link, with nothing to see. The link still
// renders. It just scrolls somewhere else. The fix was to retitle the later duplicates, so
// a link that reads as unambiguous is unambiguous. **Ambiguity is now per file**, because
// that is the scope a browser resolves a fragment in: the same slug in two documents is not
// a collision, and treating it as one would have failed the split for `### Install` in
// `docs/android.md` sitting alongside `## Install` in `docs/install.md`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug } from '../lib/readme.js';
import { docFiles } from '../lib/docset.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message.split('\n').join('\n      ')}`);
  }
}

console.log('Specification cross-links\n');

const FILES = docFiles(ROOT);

// Fenced code blocks hold sketches and shell snippets, and a `#comment` in one is not a
// link. Blanked rather than dropped so the line numbers below still mean something.
const blank = (md) => md.replace(/^```[\s\S]*?^```/gm, (b) => b.replace(/[^\n]/g, ' '));

/** file -> { prose, headings: Map<slug, title>, slugLines: Map<slug, number[]> } */
const docs = new Map();
for (const file of FILES) {
  const prose = blank(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const headings = new Map();
  const slugLines = new Map();
  for (const m of prose.matchAll(/^#{1,6} +(.+)$/gm)) {
    const s = slug(m[1]);
    headings.set(s, m[1].trim());
    if (!slugLines.has(s)) slugLines.set(s, []);
    slugLines.get(s).push(prose.slice(0, m.index).split('\n').length);
  }
  docs.set(file, { prose, headings, slugLines });
}

const lineOf = (prose, index) => prose.slice(0, index).split('\n').length;

/**
 * Every link in the set, already resolved to the file it addresses. `target` is null when
 * the link names a document that is not part of the specification — a broken path, which
 * is reported separately from a broken fragment because the fix is a different one.
 */
function* links() {
  for (const file of FILES) {
    const { prose } = docs.get(file);
    for (const m of prose.matchAll(/\]\(([^)\s]*)#([^)\s]+)\)/g)) {
      const [, href, frag] = m;
      const target = href === '' ? file : path.normalize(path.join(path.dirname(file), href));
      yield { file, line: lineOf(prose, m.index), href, frag, target, known: docs.has(target) };
    }
  }
}

check('the specification has headings to link to', () => {
  const total = [...docs.values()].reduce((n, d) => n + d.headings.size, 0);
  assert.ok(total > 100, `only ${total} headings across ${FILES.length} files — the parse is wrong, not the files`);
});

check('the summary is the index — every document is linked from README.md', () => {
  // bc-fmk4v: a document in a subdirectory of `docs/` is indexed by its directory, not by
  // its own line. `docs/b7e/` holds one file per `b7e-*` tool for exactly one reason —
  // naming every tool in one place is the shared append anchor that had thirteen open pull
  // requests conflicting in `docs/b7e-tools.md` — and an index listing all hundred of them
  // would be that same anchor written here instead. So the summary links the directory,
  // which GitHub renders as a listing, and the list is read off the filesystem when
  // somebody wants one (`b7e-readme`, `b7e-which`) rather than kept in a file.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const indexed = (f) => readme.includes(f) || (path.dirname(f) !== 'docs' && readme.includes(`${path.dirname(f)}/`));
  const orphans = FILES.filter((f) => f !== 'README.md' && !indexed(f));
  assert.deepEqual(
    orphans,
    [],
    `${orphans.length} document(s) nothing in the summary links to. A document the index does ` +
      'not name is one a reader only finds by listing the directory:\n' + orphans.join('\n')
  );
});

check('every link names a document in the set', () => {
  const strays = [];
  for (const l of links()) {
    if (l.known) continue;
    strays.push(`${l.file}:${l.line}  ${l.href}#${l.frag}`);
  }
  assert.deepEqual(
    strays,
    [],
    `${strays.length} link(s) point at a file that is not part of the specification:\n` + strays.join('\n')
  );
});

check('every link resolves to a heading in the document it names', () => {
  const broken = [];
  for (const l of links()) {
    if (!l.known) continue;
    if (docs.get(l.target).headings.has(l.frag)) continue;
    const elsewhere = FILES.filter((f) => docs.get(f).headings.has(l.frag));
    const hint = elsewhere.length ? `  (that heading is in ${elsewhere.join(', ')})` : '';
    broken.push(`${l.file}:${l.line}  ${l.href}#${l.frag}${hint}`);
  }
  assert.deepEqual(
    broken,
    [],
    `${broken.length} link(s) point at no heading — a retitled heading is the usual cause, and a ` +
      'section that moved to another document is the new one:\n' + broken.join('\n')
  );
});

check('no link points at a slug more than one heading in that document produces', () => {
  const ambiguous = [];
  for (const l of links()) {
    if (!l.known) continue;
    const lines = docs.get(l.target).slugLines.get(l.frag);
    if (!lines || lines.length < 2) continue;
    ambiguous.push(`${l.file}:${l.line}  ${l.href}#${l.frag}  → headings at ${l.target}:${lines.join(', ')}`);
  }
  assert.deepEqual(
    ambiguous,
    [],
    `${ambiguous.length} link(s) point at a slug more than one heading produces — GitHub picks the\n` +
      'first by document order, so the link works until somebody inserts a section above it. Retitle\n' +
      'the duplicate that is *not* being linked to, rather than the one that is:\n' +
      ambiguous.join('\n')
  );
});

check('the mirror is a section, and the tab-bar decision links to it', () => {
  // bc-h3t7: the mirror's prose lived only in the header of `public/mirror.js`, and the
  // one README subsection that mentioned it did so in order to argue about the tab bar.
  // A surface with a mechanism this size gets a section like every other surface does.
  // `## ` exactly: a `###` under the tab bar is what there was before, and is not this.
  //
  // bc-28jtc: both halves moved into `docs/navigating.md` together, so the link between
  // them stayed a bare fragment. This looks the section up across the set rather than in
  // one named file, so the check survives either of them moving again.
  let heading = null;
  let home = null;
  for (const file of FILES) {
    const found = [...docs.get(file).prose.matchAll(/^## +(.+)$/gm)]
      .map((m) => m[1].trim())
      .find((h) => /^The mirror\b/i.test(h));
    if (found) {
      heading = found;
      home = file;
      break;
    }
  }
  assert.ok(heading, 'no top-level section on the mirror — see bc-h3t7');

  const marker = '### The Mirror is a pane, not a tab';
  const decisionFile = FILES.find((f) => docs.get(f).prose.includes(marker));
  assert.ok(decisionFile, `"${marker}" is in none of the documents`);

  const prose = docs.get(decisionFile).prose;
  const from = prose.indexOf(marker);
  const rest = prose.slice(from);
  const end = rest.indexOf('\n## ');
  const body = end === -1 ? rest : rest.slice(0, end);

  const href = decisionFile === home ? '' : path.relative(path.dirname(decisionFile), home);
  const anchor = `${href}#${slug(heading)}`;
  assert.ok(
    body.includes(anchor),
    `"The Mirror is a pane, not a tab" (${decisionFile}) does not link to ${anchor} — that ` +
      'subsection is the decision, not the description, and it should point at the description ' +
      'rather than restate it'
  );
});

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
