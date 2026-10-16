#!/usr/bin/env node
//
// b7e-section — a named section of a document, with its line span, instead of
// grep-then-guess-a-range (bc-dgx7.108).
//
//   npm test
//   node test/b7esection.mjs
//
// Section 1 drives lib/section.js directly against small fabricated documents: a normal
// ATX-headed Markdown file, a Markdown file whose "headings" are bolded label lines (the
// shape lm-5i2.52 lost three calls to), and a Python-like file whose sections are `def`s
// levelled by indentation. Section 2 drives the real bin/b7e-section against a fixture
// tree on disk via --dir — argv parsing, --toc, --json, ambiguity, "not found", and the
// exit codes. Section 3 drives --at against a tiny git repo built for this test, since
// that is the one thing that needs a real git history rather than files on disk.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeDocument, describeSection, matchHeadings, nearestHeadings, tableOfContents } from '../lib/section.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-section');

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

/* ===================================================================== *
 * 1. lib/section.js against fabricated documents
 * ===================================================================== */

console.log('\nparsing and matching (fabricated documents)');

const ATX_DOC = [
  /* 1 */ '# Title',
  /* 2 */ '',
  /* 3 */ 'Front matter.',
  /* 4 */ '',
  /* 5 */ '## Alpha section',
  /* 6 */ '',
  /* 7 */ 'Some alpha content.',
  /* 8 */ '',
  /* 9 */ '### Alpha sub',
  /* 10 */ '',
  /* 11 */ 'nested content',
  /* 12 */ '',
  /* 13 */ '## Beta section',
  /* 14 */ '',
  /* 15 */ 'Beta content here.',
].join('\n');

{
  const a = analyzeDocument(ATX_DOC, 'doc.md');
  check('ATX: 4 headings at the right levels and lines', a.headings.length === 4 && a.headings[1].title === 'Alpha section' && a.headings[1].level === 2 && a.headings[1].line === 5, JSON.stringify(a.headings));
  const alpha = describeSection(a, a.headings[1]);
  check('ATX: Alpha section spans up to (not past) Beta section', alpha.startLine === 5 && alpha.endLine === 12, JSON.stringify(alpha));
  check('ATX: headingLine is the source line, verbatim', alpha.headingLine === '## Alpha section');
}

// No ATX heading anywhere — lm-5i2.52's law-per-line shape.
const BOLD_DOC = [
  /* 1 */ 'Front matter, no ATX headings anywhere in this file.',
  /* 2 */ '',
  /* 3 */ '**LAW #5: Do not skip the ritual**',
  /* 4 */ '',
  /* 5 */ 'Body of law 5.',
  /* 6 */ '',
  /* 7 */ '**LAW #6: Do not delete a scene others are using**',
  /* 8 */ '',
  /* 9 */ 'Body of law 6.',
  /* 10 */ 'More body.',
  /* 11 */ '',
  /* 12 */ '**LAW #7: Always credit the muse**',
  /* 13 */ '',
  /* 14 */ 'Body of law 7.',
].join('\n');

{
  const a = analyzeDocument(BOLD_DOC, 'laws.md');
  check('bold-label fallback: 3 flat headings, one per law', a.headings.length === 3 && a.headings.every((h) => h.level === 1), JSON.stringify(a.headings));
  check('bold-label fallback: title is the bold text, not the markdown markers', a.headings[1].title === 'LAW #6: Do not delete a scene others are using');
  const { tier, headings } = matchHeadings(a.headings, 'LAW #6');
  check('bold-label fallback: substring query finds the one law', tier === 'substring' && headings.length === 1 && headings[0].line === 7);
  const section = describeSection(a, headings[0]);
  check('bold-label fallback: span ends right before the next law, not past it', section.startLine === 7 && section.endLine === 11, JSON.stringify(section));
}

// A Python-like file: sections are `def`s, levelled by indentation.
const CODE_DOC = [
  /* 1 */ 'import math',
  /* 2 */ '',
  /* 3 */ '',
  /* 4 */ 'class Framing:',
  /* 5 */ '    def subject_screen_height(self, subject, camera):',
  /* 6 */ '        h = subject.height',
  /* 7 */ '        return h * camera.scale',
  /* 8 */ '',
  /* 9 */ '    def other_thing(self):',
  /* 10 */ '        pass',
  /* 11 */ '',
  /* 12 */ '',
  /* 13 */ 'def top_level_helper():',
  /* 14 */ '    return 1',
].join('\n');

{
  const a = analyzeDocument(CODE_DOC, 'framing.py');
  check('code flavor: finds the class and both methods and the top-level def', a.headings.length === 4, JSON.stringify(a.headings.map((h) => [h.level, h.title, h.line])));
  const { tier, headings } = matchHeadings(a.headings, 'subject_screen_height');
  check('code flavor: exact match on the function name', tier === 'exact' && headings.length === 1 && headings[0].line === 5);
  const section = describeSection(a, headings[0]);
  check(
    'code flavor: nested def spans up to (not past) its sibling method, dedent ends it correctly',
    section.startLine === 5 && section.endLine === 8,
    JSON.stringify(section)
  );
  const top = matchHeadings(a.headings, 'top_level_helper');
  const topSection = describeSection(a, top.headings[0]);
  check('code flavor: top-level def spans to end of file', topSection.startLine === 13 && topSection.endLine === 14, JSON.stringify(topSection));
}

{
  // exact tier wins over substring even when a substring match also exists elsewhere.
  const a = analyzeDocument('## Overview\n\nx\n\n## Overview of the whole system\n\ny\n', 'x.md');
  const { tier, headings } = matchHeadings(a.headings, 'Overview');
  check('exact tier wins: "Overview" matches only the exact heading, not the longer one too', tier === 'exact' && headings.length === 1 && headings[0].line === 1, JSON.stringify(headings));
}

{
  // a heading occurring twice is ambiguous, not silently resolved to the first.
  const a = analyzeDocument('## Overview\n\nfirst\n\n## Overview\n\nsecond\n', 'dup.md');
  const { tier, headings } = matchHeadings(a.headings, 'Overview');
  check('duplicate heading: both are reported at the exact tier', tier === 'exact' && headings.length === 2, JSON.stringify(headings));
}

{
  const a = analyzeDocument(BOLD_DOC, 'laws.md');
  const nearest = nearestHeadings(a.headings, 'LAW #99');
  check('nearest: a miss still names candidates, closest first among the three laws', nearest.length === 3 && nearest.every((h) => /^LAW #\d/.test(h.title)), JSON.stringify(nearest));
}

{
  const a = analyzeDocument(ATX_DOC, 'doc.md');
  const toc = tableOfContents(a);
  check('--toc data: one row per heading, in document order, with span and level', toc.length === 4 && toc[0].title === 'Title' && toc[0].startLine === 1 && toc[0].endLine === 15, JSON.stringify(toc.map((s) => [s.level, s.startLine, s.endLine, s.title])));
}

/* ===================================================================== *
 * 2. bin/b7e-section against a fixture tree, via --dir
 * ===================================================================== */

console.log('\nthe CLI (fabricated tree, via --dir)');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-b7esection-test-')));
fs.writeFileSync(path.join(tmp, 'doc.md'), ATX_DOC);
fs.writeFileSync(path.join(tmp, 'laws.md'), BOLD_DOC);
fs.writeFileSync(path.join(tmp, 'framing.py'), CODE_DOC);
fs.writeFileSync(path.join(tmp, 'dup.md'), '## Overview\n\nfirst\n\n## Overview\n\nsecond\n');
const run = (args) => spawnSync(process.execPath, [BIN, '--dir', tmp, ...args], { encoding: 'utf8' });

{
  const r = run(['doc.md', 'Alpha section']);
  check('exits 0 on a unique match', r.status === 0, r.stderr);
  check('header line names path, span and the heading as written', /^doc\.md:5-12 {2}## Alpha section$/m.test(r.stdout), r.stdout);
  check('body is printed verbatim, including the nested subsection', r.stdout.includes('nested content'), r.stdout);
}

{
  const r = run(['laws.md', 'LAW #6']);
  check('bold-label doc: exits 0', r.status === 0, r.stderr);
  check('bold-label doc: body is the law body only, not the neighbouring laws', r.stdout.includes('Body of law 6') && !r.stdout.includes('Body of law 5') && !r.stdout.includes('Body of law 7'), r.stdout);
}

{
  const r = run(['framing.py', 'subject_screen_height']);
  check('python def: exits 0', r.status === 0, r.stderr);
  check('python def: body is that one method only', r.stdout.includes('return h * camera.scale') && !r.stdout.includes('other_thing'), r.stdout);
}

{
  const r = run(['doc.md', '--toc']);
  check('--toc: exits 0', r.status === 0, r.stderr);
  check('--toc: one line per heading, depth first', /^2 {2}5-12/m.test(r.stdout), r.stdout);
  check('--toc: all four headings present', r.stdout.trim().split('\n').length === 4, r.stdout);
}

{
  const r = run(['doc.md', '--toc', '--json']);
  check('--toc --json: exits 0', r.status === 0, r.stderr);
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
    ok('--toc --json: valid JSON');
  } catch (err) {
    bad('--toc --json: valid JSON', err.message);
  }
  check('--toc --json: an array of 4 headings, bodies not included', Array.isArray(parsed) && parsed.length === 4 && parsed.every((s) => !('body' in s)), r.stdout);
}

{
  const r = run(['dup.md', 'Overview']);
  check('ambiguous: exits 1, not 0', r.status === 1, `status ${r.status}\n${r.stdout}`);
  check('ambiguous: both spans are listed', /1-4/.test(r.stdout) && /5-8/.test(r.stdout), r.stdout);
}

{
  const r = run(['laws.md', 'LAW #99']);
  check('not found: exits 1', r.status === 1, `status ${r.status}\n${r.stdout}`);
  check('not found: names the nearest laws instead of a bare miss', /LAW #5|LAW #6|LAW #7/.test(r.stdout), r.stdout);
}

{
  const r = run(['doc.md', 'Alpha section', '--json']);
  check('--json: exits 0', r.status === 0, r.stderr);
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
    ok('--json: valid JSON');
  } catch (err) {
    bad('--json: valid JSON', err.message);
  }
  check('--json: same section the plain form reported', parsed && parsed.startLine === 5 && parsed.endLine === 12 && parsed.title === 'Alpha section' && typeof parsed.body === 'string', r.stdout);
}

{
  const r = spawnSync(process.execPath, [BIN], { encoding: 'utf8' });
  check('no args at all: exit 2', r.status === 2, `status ${r.status}`);
  check('no args at all: usage on stderr', /b7e-section/.test(r.stderr), r.stderr);
}

{
  const r = run(['doc.md']);
  check('path with no query and no --toc: exit 2', r.status === 2, `status ${r.status}\n${r.stderr}`);
}

{
  const r = run(['doc.md', 'Alpha section', '--toc']);
  check('--toc plus a query together: exit 2, refused rather than ignoring one', r.status === 2, `status ${r.status}\n${r.stderr}`);
}

{
  const r = run(['nope-does-not-exist.md', 'anything']);
  check('unreadable path: exit 3, not a crash', r.status === 3, `status ${r.status}\n${r.stderr}`);
}

/* ===================================================================== *
 * 3. --at against a real, tiny git history
 * ===================================================================== */

console.log('\n--at (a real git history)');

execFileSync('git', ['init', '-q'], { cwd: tmp });
execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'add', '-A'], { cwd: tmp });
execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '-m', 'before'], { cwd: tmp });
const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(tmp, 'doc.md'), ATX_DOC.replace('Beta section', 'Gamma section'));
execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '-am', 'after'], { cwd: tmp });

{
  const r = run(['doc.md', 'Beta section', '--at', before]);
  check('--at an earlier ref: finds the section as it read back then', r.status === 0 && /Beta section/.test(r.stdout), r.stdout + r.stderr);
}

{
  const r = run(['doc.md', 'Beta section']);
  check('without --at: the working tree already moved on, so the old heading is gone', r.status === 1, `status ${r.status}\n${r.stdout}`);
}

{
  const r = run(['doc.md', 'Gamma section', '--at', before]);
  check('--at an earlier ref: a heading only added later is correctly not found there', r.status === 1, `status ${r.status}\n${r.stdout}`);
}

{
  const r = run(['doc.md', 'Beta section', '--at', 'no-such-ref-at-all']);
  check('--at a ref that does not resolve: exit 3, not a crash', r.status === 3, `status ${r.status}\n${r.stderr}`);
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
