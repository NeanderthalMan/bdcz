#!/usr/bin/env node
//
// b7e-emits — which line of code printed this, for a log line assembled from a
// template (bc-dgx7.131).
//
//   npm test
//   node test/b7eemits.mjs
//
// Matching is proved against a FABRICATED fixture `lib/` (plus `test/`+`public/` for
// pinned-by) built to carry the bead's own two founding examples — never against this
// repo's own `lib/advocate.js`, which carries dozens of near-identical
// `${a.name}: ${x} — ${y}` call sites that would make an exact-line assertion rot the
// moment any of them is edited (see the memory note
// a-real-repo-assertion-in-a-test-rots-between-your-run-and-ci). The one real-repo
// check is a loose smoke test: `emitsReport` against this repo's actual `lib/`
// completes and returns an array, which is also what pins the MAX_HOLES performance
// guard against ever regressing silently.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-emits');

const emits = await import(path.join(ROOT, 'lib', 'emits.js'));
const { blankComments } = await import(path.join(ROOT, 'lib', 'evidence.js'));

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, fn) => {
  try {
    fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};

/* ================================================================ 1. segmentsOf */

console.log('\nsegmentsOf — splitting a template into literal and hole segments\n');

check('a plain literal with one hole splits in two', () => {
  const segs = emits.segmentsOf('hello ${name}!');
  assert.deepEqual(segs, [
    { type: 'lit', text: 'hello ' },
    { type: 'expr', text: 'name' },
    { type: 'lit', text: '!' },
  ]);
});

check('a ternary hole is kept whole, brace-depth aware', () => {
  const segs = emits.segmentsOf("a ${x ? 'y' : 'z'} b");
  assert.equal(segs.length, 3);
  assert.equal(segs[1].type, 'expr');
  assert.equal(segs[1].text, "x ? 'y' : 'z'");
});

check('a nested template with its own hole inside a hole does not end it early', () => {
  // The bead's own second example: lib/advocate.js's real `why` builder.
  const segs = emits.segmentsOf("the session exited without closing it${ended.code ? ` (exit ${ended.code})` : ''}");
  assert.equal(segs.length, 2);
  assert.equal(segs[0].text, 'the session exited without closing it');
  assert.equal(segs[1].text, "ended.code ? ` (exit ${ended.code})` : ''");
});

check('a leading hole with no literal before it is not a phantom empty segment', () => {
  const segs = emits.segmentsOf('${x} tail');
  assert.deepEqual(segs, [
    { type: 'expr', text: 'x' },
    { type: 'lit', text: ' tail' },
  ]);
});

/* ================================================================ 2. templatePattern / choice */

console.log('\ntemplatePattern — the derived regex, and the two-way choice hole\n');

check('a plain hole becomes a non-greedy wildcard group', () => {
  const { source, names } = emits.templatePattern(emits.segmentsOf('id=${id}'));
  assert.equal(names.length, 1);
  assert.match(new RegExp(`^${source}$`).exec('id=bc-x')[1], /^bc-x$/);
});

check('a ternary-of-two-string-literals hole becomes a two-way alternation, not a wildcard', () => {
  const { source } = emits.templatePattern(emits.segmentsOf("${on ? 'parked' : 'closed'}"));
  const re = new RegExp(`^${source}$`);
  assert.ok(re.test('parked'));
  assert.ok(re.test('closed'));
  assert.ok(!re.test('neither'), 'a value that is not one of the two literal branches must not match');
});

check("literalWeight counts a choice hole's shorter branch, not the wildcard as zero", () => {
  const withChoice = emits.literalWeight(emits.segmentsOf("x${on ? 'ab' : 'longer'}y"));
  const withoutChoice = emits.literalWeight(emits.segmentsOf('x${on}y'));
  assert.ok(withChoice > withoutChoice, 'the constrained hole should count for more than an open one');
});

/* ================================================================ 3. matchAgainst */

console.log('\nmatchAgainst — line, reverse-fragment and forward-fragment matches\n');

const PARK_SEGMENTS = emits.segmentsOf("[advocate] ${a.name}: ${bringBack ? 'parked' : 'closed'} ${rec.kind} ${what} — ${said}");
const EXITED_SEGMENTS = emits.segmentsOf("the session exited without closing it${ended.code ? ` (exit ${ended.code})` : ''}");

check('the bead\'s own headline example: a full line resolves every hole, named by its own expression', () => {
  const m = emits.matchAgainst('[advocate] beadcause: parked worker bc-x — quiet for 20m', PARK_SEGMENTS);
  assert.ok(m);
  assert.equal(m.mode, 'line');
  const byName = Object.fromEntries(m.spans.map((s) => [s.name, s.value]));
  assert.equal(byName['rec.kind'], 'worker');
  assert.equal(byName['said'], 'quiet for 20m');
  assert.equal(byName["bringBack ? 'parked' : 'closed'"], 'parked');
});

check('a daemon-log ISO stamp in front of the line is stripped before matching', () => {
  const m = emits.matchAgainst('2026-08-28T18:53:47.536Z [advocate] beadcause: parked worker bc-x — quiet for 20m', PARK_SEGMENTS);
  assert.ok(m);
  assert.equal(m.mode, 'line');
});

check('a value that does not fit the ternary choice fails a line match (a fragment before the mismatch may still resolve)', () => {
  const m = emits.matchAgainst('[advocate] beadcause: neither worker bc-x — quiet for 20m', PARK_SEGMENTS);
  assert.ok(!m || m.mode !== 'line', 'the whole line must not be reported as fully resolved when a choice value is wrong');
});

check("the bead's own second example: a short fragment inside one literal segment matches with no span resolved", () => {
  const m = emits.matchAgainst('exited without closing', EXITED_SEGMENTS);
  assert.ok(m);
  assert.equal(m.mode, 'fragment');
  assert.deepEqual(m.spans, []);
});

check('a longer fragment that spans a hole resolves that hole via the forward window', () => {
  const m = emits.matchAgainst('beadcause: parked worker bc-x', PARK_SEGMENTS);
  assert.ok(m);
  assert.equal(m.mode, 'fragment');
  const byName = Object.fromEntries(m.spans.map((s) => [s.name, s.value]));
  assert.equal(byName['rec.kind'], 'worker');
});

check('unrelated text matches nothing', () => {
  assert.equal(emits.matchAgainst('completely unrelated text with no overlap at all', PARK_SEGMENTS), null);
});

check('a short common word is not a forward-fragment match on its own (no bare-substring noise)', () => {
  // Regression for the false positive `` `now` `` matching inside "no*w*here" — a
  // window with no hole at all must never qualify as a fragment match.
  const segs = emits.segmentsOf('now');
  assert.equal(emits.matchAgainst('this happens nowhere in particular', segs), null);
});

check('annotate marks each resolved span in place, left to right', () => {
  const m = emits.matchAgainst('[advocate] beadcause: parked worker bc-x — quiet for 20m', PARK_SEGMENTS);
  const annotated = emits.annotate('[advocate] beadcause: parked worker bc-x — quiet for 20m', m.spans);
  assert.match(annotated, /\[worker=\$\{rec\.kind\}\]/);
  assert.match(annotated, /\[quiet for 20m=\$\{said\}\]/);
});

/* ================================================================ 4. candidateEmitters, against a fixture */

console.log('\ncandidateEmitters — scanning a fabricated lib/ tree\n');

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-emits-test-'));

function fixture(files) {
  const root = fs.mkdtempSync(path.join(tmp, 'root-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

const ADVOCATE_FIXTURE = `
/**
 * A docblock quoting \`[advocate] \${a.name}: \${x}\` as prose must not itself be read as
 * a candidate — comments are blanked before scanning.
 */
export function finish(a, w, why) {
  console.log(\`[advocate] \${a.name}: \${w.id} — \${why}\`);
}

export function park(a, rec, bringBack, what, said) {
  console.log(\`[advocate] \${a.name}: \${bringBack ? 'parked' : 'closed'} \${rec.kind} \${what} — \${said}\`);
}

export function exitedMessage(ended) {
  return \`the session exited without closing it\${ended.code ? \` (exit \${ended.code})\` : ''}\`;
}

export function tooManyHoles(a, b, c, d, e, f, g, h, i) {
  return \`\${a}\${b}\${c}\${d}\${e}\${f}\${g}\${h}\${i}-nine holes, too many to be a candidate\`;
}
`;

const root = fixture({
  'lib/advocate-fixture.js': ADVOCATE_FIXTURE,
  'test/fixture.mjs': "// pins '[advocate] ' — a real assertion would import and call it\nconst x = '[advocate] ';\n",
});

check('a docblock quoting a template is not itself read as a candidate', () => {
  const cands = emits.candidateEmitters(root, 'lib');
  const bogus = cands.find((c) => c.raw.includes('${x}') && c.line < 6);
  assert.equal(bogus, undefined, 'the doc comment above `finish` must be blanked, not scanned');
});

check('the nested-backtick template is read as ONE candidate spanning the whole literal, not split', () => {
  const cands = emits.candidateEmitters(root, 'lib');
  const exited = cands.filter((c) => c.raw.includes('exited without closing'));
  assert.equal(exited.length, 1, 'the nested `${ended.code})` hole must not be read as ending the outer template early');
  assert.equal(exited[0].segments.length, 2);
});

check('a template past MAX_HOLES is excluded entirely', () => {
  const cands = emits.candidateEmitters(root, 'lib');
  assert.ok(!cands.some((c) => c.raw.includes('nine holes')), 'a nine-hole template must not be a candidate');
});

check('every real candidate carries the right file and 1-based line', () => {
  const cands = emits.candidateEmitters(root, 'lib');
  const finish = cands.find((c) => c.raw.includes('${w.id}'));
  assert.ok(finish);
  assert.equal(finish.file, path.join('lib', 'advocate-fixture.js'));
  const lines = fs.readFileSync(path.join(root, 'lib', 'advocate-fixture.js'), 'utf8').split('\n');
  assert.ok(lines[finish.line - 1].includes('w.id'), `line ${finish.line} should be the console.log call itself`);
});

/* ================================================================ 5. pinnedByOf */

console.log('\npinnedByOf — which test/*.mjs or public/*.js already assert on this template\n');

check('a literal segment that appears verbatim in a test file is found', () => {
  const cands = emits.candidateEmitters(root, 'lib');
  const finish = cands.find((c) => c.raw.includes('${w.id}'));
  const pinned = emits.pinnedByOf(root, finish.segments);
  assert.deepEqual(pinned, [path.join('test', 'fixture.mjs')]);
});

check('a segment nothing pins comes back empty — bc-xl7n.146\'s conclusion, mechanically', () => {
  const cands = emits.candidateEmitters(root, 'lib');
  const exited = cands.find((c) => c.raw.includes('exited without closing'));
  assert.deepEqual(emits.pinnedByOf(root, exited.segments), []);
});

/* ================================================================ 6. emitsReport, end to end */

console.log("\nemitsReport — the bead's own two acceptance examples, against the fixture\n");

check('the full observed line names the park() emitter, marking worker and the quiet-for text by their own expressions', () => {
  const found = emits.emitsReport(root, '[advocate] beadcause: parked worker bc-x — quiet for 20m');
  assert.ok(found.length >= 1);
  const top = found[0];
  assert.ok(top.raw.includes('bringBack'), 'the park() template, not finish(), should be the best match');
  assert.equal(top.mode, 'line');
  assert.match(top.annotated, /\[worker=\$\{rec\.kind\}\]/);
  assert.match(top.annotated, /\[quiet for 20m=\$\{said\}\]/);
});

check('the "exited without closing" fragment names exitedMessage() with an empty pinned-by', () => {
  const found = emits.emitsReport(root, 'exited without closing');
  assert.equal(found.length, 1);
  assert.ok(found[0].raw.includes('exited without closing'));
  assert.equal(found[0].mode, 'fragment');
  assert.deepEqual(found[0].pinnedBy, []);
});

check('a line no template in the tree can produce finds nothing', () => {
  assert.deepEqual(emits.emitsReport(root, 'nothing here resembles any template at all, anywhere'), []);
});

/* ================================================================ 7. bin/b7e-emits */

console.log('\nbin/b7e-emits — argv, exit codes, stdin, --json\n');

check('--help exits 0 and prints usage', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /b7e-emits/);
});

check('no observed line and no stdin exits 2', () => {
  const r = spawnSync(process.execPath, [BIN, '--dir', root], { encoding: 'utf8', input: '' });
  assert.equal(r.status, 2);
});

check('-w and --dir together exits 2', () => {
  const r = spawnSync(process.execPath, [BIN, '-w', 'x', '--dir', root, 'anything'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

check('an unknown workspace exits 2', () => {
  const r = spawnSync(process.execPath, [BIN, '-w', 'no-such-workspace-xyz', 'anything'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no workspace named/);
});

check('a matching line exits 0 and prints the file:line and the annotated text', () => {
  const r = spawnSync(process.execPath, [BIN, '--dir', root, '[advocate] beadcause: parked worker bc-x — quiet for 20m'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /advocate-fixture\.js:\d+/);
  assert.match(r.stdout, /worker=\$\{rec\.kind\}/);
});

check('a non-matching line exits 1', () => {
  const r = spawnSync(process.execPath, [BIN, '--dir', root, 'nothing here resembles any template at all, anywhere'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
});

check('stdin is read when no positional argument is given', () => {
  const r = spawnSync(process.execPath, [BIN, '--dir', root], { encoding: 'utf8', input: 'exited without closing\n' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /exited without closing/);
});

check('--json prints one parseable object with the same findings', () => {
  const r = spawnSync(process.execPath, [BIN, '--dir', root, '--json', 'exited without closing'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const obj = JSON.parse(r.stdout);
  assert.equal(obj.observed, 'exited without closing');
  assert.equal(obj.found.length, 1);
});

check('--json on a non-matching line still exits 1', () => {
  const r = spawnSync(process.execPath, [BIN, '--dir', root, '--json', 'nothing here resembles any template at all, anywhere'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  const obj = JSON.parse(r.stdout);
  assert.deepEqual(obj.found, []);
});

/* ================================================================ 8. the blankComments hazard this module's own regex could trip */

console.log("\nlib/emits.js's own source does not desync blankComments's quote-tracking\n");

check('every docblock in lib/emits.js is still read as a comment, not as code', () => {
  // A regex literal containing a bare `['"]` character class desyncs `blankComments`'s
  // quote stack for the rest of the file — see the comment beside `CHOICE_RE` in
  // lib/emits.js. If that ever regresses, a docblock's own backtick-quoted example
  // would stop being blanked, and `candidateEmitters` would start reading this file's
  // prose as a scannable template literal.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'emits.js'), 'utf8');
  const blanked = blankComments(src);
  const srcLines = src.split('\n');
  const blankedLines = blanked.split('\n');
  const leaked = srcLines.filter((line, i) => /^\s*\*/.test(line) && blankedLines[i].includes('`'));
  assert.deepEqual(leaked, [], 'a docblock line still carrying a backtick after blanking means the comment scan desynced');
});

/* ================================================================ 9. a loose sanity check against the real repo */

console.log("\nagainst this repo's own lib/ — a smoke test, not an exact-line pin\n");

check('emitsReport over the real lib/ completes and returns an array (the MAX_HOLES performance guard)', () => {
  const start = Date.now();
  const found = emits.emitsReport(ROOT, 'this text matches no template in this repo, deliberately, xyzzy-plugh');
  const ms = Date.now() - start;
  assert.ok(Array.isArray(found));
  assert.ok(ms < 20_000, `emitsReport took ${ms}ms against the real repo — MAX_HOLES may have regressed`);
});

/* ------------------------------------------------------------------------- verdict */

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) {
  console.log(`\n${failures} failing\n`);
  process.exit(1);
} else {
  console.log('\nall checks passed\n');
}
