#!/usr/bin/env node
//
// b7e-describes — which paragraphs of the specification describe the code I just changed
// (bc-dgx7.165).
//
//   npm test
//   node test/b7edescribes.mjs
//
// The five sessions that filed this each found the paragraph a change had made false by
// guessing a phrase and grepping, and the fixture is built to give the tool exactly the
// shapes those guesses were standing in for: a paragraph that names the changed file, one
// that names a changed function bare, one that names a *removed* function, a bullet that
// is false without naming anything, a route, an environment variable, and a heading whose
// rename leaves links pointing at nothing.
//
// Section 1 is lib/describes.js's pure parts. Section 2 builds a small repository on disk
// with a real history (a base commit, a branch, uncommitted edits) and drives describes()
// and then the real bin/b7e-describes against it via --dir, because everything that matters
// here is what git says the diff is. Section 3 is one smoke run against THIS repo's real
// specification asserting only its shape — never a line number, which a same-day edit moves.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { blocksOf, definitions, describes, nameRe } from '../lib/describes.js';
import { docFiles } from '../lib/docset.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-describes');

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

/* ===================================================================== *
 * 1. the pure parts
 * ===================================================================== */

console.log('\ndefinitions of one file');

const SRC = [
  /* 1 */ "import x from 'y';",
  /* 2 */ '',
  /* 3 */ '/**',
  /* 4 */ ' * function inBlockComment() is not a definition',
  /* 5 */ ' */',
  /* 6 */ 'export function alpha(a) {',
  /* 7 */ '  return a;',
  /* 8 */ '}',
  /* 9 */ '',
  /* 10 */ '// beta has a line comment above it',
  /* 11 */ 'export const beta = (b) =>',
  /* 12 */ '  b + 1;',
  /* 13 */ '',
  /* 14 */ 'const localThing = {',
  /* 15 */ '  k: 1,',
  /* 16 */ '};',
  /* 17 */ 'main().catch(() => {});',
  /* 18 */ 'export { localThing };',
].join('\n');
const defs = definitions(SRC);
const byName = Object.fromEntries(defs.map((d) => [d.name, d]));

check('finds the top-level definitions and nothing inside a block comment', Object.keys(byName).join() === 'alpha,beta,localThing', Object.keys(byName).join());
check('a range covers the doc comment above the declaration', byName.alpha.start === 3 && byName.alpha.end === 8, JSON.stringify(byName.alpha));
check('a line comment above a declaration belongs to it', byName.beta.start === 10 && byName.beta.end === 12, JSON.stringify(byName.beta));
check('a body ends at the first unindented statement, which then belongs to nothing', byName.localThing.end === 16, JSON.stringify(byName.localThing));
check('`export { name }` marks an earlier declaration exported', byName.localThing.exported && byName.alpha.exported, JSON.stringify(defs));

console.log('\nhow a name is recognised');

check('a mixed-case name matches bare', nameRe('baseVerdict').test('the baseVerdict rule'));
check('a mixed-case name does not match inside a longer word', !nameRe('baseVerdict').test('thebaseVerdictx'));
check('a plain lowercase word does not match as English', !nameRe('slug').test("the slug of a heading"));
check('a plain lowercase word matches when marked as code', nameRe('slug').test('the `slug` helper') && nameRe('slug').test('calls `slug()`'));
check('a name with an underscore matches bare', nameRe('gone_fn').test('gone_fn is gone'));

console.log('\nblocks of a document');

const DOC = ['# T', '', 'One sentence. Two sentence', 'continues here.', '', '- a bullet', '  that wraps', '- second', '', '| a | b |', '|---|---|', '| c | d |', '', '```', 'code line', '```'].join('\n');
const blocks = blocksOf(DOC);
check(
  'heading, paragraph, two bullets, three table rows and a code line',
  blocks.map((b) => b.kind).join() === 'heading,prose,bullet,bullet,table,table,table,code',
  blocks.map((b) => b.kind).join()
);
check('a wrapped bullet is one block and a paragraph spans its lines', blocks[2].end === 7 && blocks[1].start === 3 && blocks[1].end === 4, JSON.stringify(blocks.slice(1, 3)));

/* ===================================================================== *
 * 2. a repository with a history
 * ===================================================================== */

console.log('\nthe diff, against a repository with a history');

const sh = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const put = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'b7edescribes-')));
const repo = path.join(tmp, 'fixture');
fs.mkdirSync(repo);
sh(repo, 'init', '-q', '-b', 'main');
sh(repo, 'config', 'user.email', 't@example.com');
sh(repo, 'config', 'user.name', 'T');

const THING = [
  '/** Decides. */',
  'export function fooVerdict(x) {',
  "  return x ? 'a' : 'b';",
  '}',
  '',
  'export function gone_fn() {',
  '  return 1;',
  '}',
  '',
  'export function slug(s) {',
  '  return s;',
  '}',
  '',
  'export function keepMe() {',
  '  return 2;',
  '}',
  '',
  'export function unmentioned() {',
  '  return 3;',
  '}',
  '',
].join('\n');

const DOC_A = [
  '# Chapter',
  '',
  '## The verdict',
  '',
  'The decision lives in `lib/thing.js` and is small. It never asks anybody.',
  '',
  '- **A bullet that lifts by itself.** The next tick closes it.',
  '- Another bullet, about something else entirely.',
  '',
  'fooVerdict returns a or b, and that is all it does.',
  '',
  'gone_fn used to do the other half. keepMe is untouched.',
  '',
  'stableThing has not moved in ages.',
  '',
  'The slug of a heading is written in plain English here.',
  '',
  'The `slug` helper is named as code here.',
  '',
  'GET /api/thing/:id returns it. Set BEADCAUSE_THING_MODE to change it.',
  '',
  '-- a line that starts with two dashes',
  '',
  '## Old heading name',
  '',
  'Links point here.',
  '',
  '[same-file](#old-heading-name)',
  '',
].join('\n');

put(repo, 'lib/thing.js', THING);
put(repo, 'lib/stable.js', 'export function stableThing() {\n  return 6;\n}\n');
put(repo, 'lib/unmentioned.js', 'export function nobodyWritesThis() {\n  return 4;\n}\n');
put(repo, 'bin/b7e-thing', '#!/usr/bin/env node\nconsole.log(1);\n');
put(repo, 'package.json', JSON.stringify({ bin: { 'b7e-thing': 'bin/b7e-thing', 'thing-alias': 'bin/b7e-thing' } }, null, 2));
put(repo, 'README.md', '# Summary\n\n[the chapter](docs/a.md#old-heading-name)\n\nRun b7e-thing and thing-alias.\n');
put(repo, 'docs/a.md', DOC_A);
put(repo, 'docs/b.md', '# B\n\n## Elsewhere\n\n[across](a.md#old-heading-name)\n\n[fine](a.md#the-verdict)\n\n```\n[in code](a.md#old-heading-name)\n```\n');
sh(repo, 'add', '-A');
sh(repo, 'commit', '-q', '-m', 'base');
sh(repo, 'checkout', '-q', '-b', 'work');

const clean = describes(repo);
check('a clean tree changes nothing and says nothing', !clean.error && clean.files.length === 0 && clean.hits.length === 0 && clean.headings.length === 0, JSON.stringify(clean.files));

// A committed change, so the merge-base path is exercised as well as the working tree.
put(repo, 'lib/thing.js', THING.replace("return x ? 'a' : 'b';", "return x ? 'a' : 'c';"));
sh(repo, 'commit', '-q', '-am', 'change fooVerdict');

// Uncommitted: remove gone_fn, touch slug, add a route + env var + a route in a comment,
// rename a heading, touch the bin script, and add an untracked module.
let now = fs.readFileSync(path.join(repo, 'lib/thing.js'), 'utf8');
now = now.replace('export function gone_fn() {\n  return 1;\n}\n\n', '');
now = now.replace('export function slug(s) {\n  return s;', 'export function slug(s) {\n  return s.trim();');
now += [
  '',
  'export function wire(app) {',
  "  app.get('/api/thing/:id', () => 1);",
  "  // '/api/commentonly/x' is in a comment",
  '  return process.env.BEADCAUSE_THING_MODE;',
  '}',
  '',
].join('\n');
put(repo, 'lib/thing.js', now);
put(repo, 'docs/a.md', DOC_A.replace('## Old heading name', '## New heading name').replace('-- a line that starts with two dashes\n\n', ''));
put(repo, 'bin/b7e-thing', '#!/usr/bin/env node\nconsole.log(2);\n');
put(repo, 'lib/added.js', 'export function brandNewThing() {\n  return 5;\n}\n');

const statusBefore = sh(repo, 'status', '--porcelain');
const r = describes(repo);
const statusAfter = sh(repo, 'status', '--porcelain');

check('nothing is written anywhere: the tree is exactly as it was', statusBefore === statusAfter);
check('no error and a merge base was found', !r.error && Boolean(r.base), JSON.stringify(r.error));
check(
  'every changed file is listed, the document as a document',
  ['bin/b7e-thing', 'docs/a.md', 'lib/added.js', 'lib/thing.js'].every((f) => r.files.some((x) => x.file === f)) &&
    r.files.find((x) => x.file === 'docs/a.md').role === 'document',
  JSON.stringify(r.files)
);

const term = (kind, text) => r.terms.find((t) => t.kind === kind && t.text === text);
check('the changed file contributes its path', Boolean(term('path', 'lib/thing.js')));
check('an extensionless bin script is a command, and its package.json aliases are too', Boolean(term('cli', 'bin/b7e-thing')) && Boolean(term('cli', 'thing-alias')), JSON.stringify(r.terms.filter((t) => t.kind === 'cli')));
check('a definition whose body the committed diff touched is a name', Boolean(term('export', 'fooVerdict')));
check('a definition the diff REMOVED is a name — read from the old side', Boolean(term('export', 'gone_fn')));
check('a definition edited in the working tree is a name', Boolean(term('export', 'slug')));
check('a definition nothing touched is not', !r.terms.some((t) => t.text === 'keepMe' || t.text === 'unmentioned'));
check('an untracked file is wholly added, so its definitions are names', Boolean(term('export', 'brandNewThing')));
check('a route on a changed line is a name, cut before its parameter', Boolean(term('route', '/api/thing')));
check('a route only in a comment is not', !r.terms.some((t) => t.text.includes('commentonly')));
check('an environment variable on a changed line is a name', Boolean(term('env', 'BEADCAUSE_THING_MODE')));

const hitAt = (file, needle) => r.hits.find((h) => h.file === file && h.text.includes(needle));
const pathHit = hitAt('docs/a.md', 'lib/thing.js');
check('the paragraph naming the changed file is found, with its heading and slug', pathHit && pathHit.heading.title === 'The verdict' && pathHit.heading.slug === 'the-verdict' && pathHit.heading.level === 2, JSON.stringify(pathHit));
check('a prose hit is the sentence that names it, not the whole paragraph', pathHit && !pathHit.text.includes('It never asks anybody'), pathHit && pathHit.text);
check('its line is the sentence\'s line', pathHit && pathHit.line === 5, pathHit && String(pathHit.line));
check('a bare mixed-case function name is found', Boolean(hitAt('docs/a.md', 'fooVerdict returns')));
check('a REMOVED function is found — the paragraph most likely to be false', Boolean(hitAt('docs/a.md', 'gone_fn used to')));
check('a function nobody touched is not, though its paragraph named one that was', !r.hits.some((h) => h.names.includes('keepMe')));
check('a plain word is not a hit as English', !r.hits.some((h) => h.text.includes('plain English')));
check('a plain word is a hit when the prose marks it as code', Boolean(hitAt('docs/a.md', 'named as code')));
check('a route in prose is found by the part before its parameter', Boolean(hitAt('docs/a.md', 'GET /api/thing/:id')));
check('an environment variable in prose is found', Boolean(hitAt('docs/a.md', 'BEADCAUSE_THING_MODE')));
const cliHit = r.hits.find((h) => h.file === 'README.md' && h.names.includes('bin/b7e-thing'));
check('the summary is searched too, and a command name is found by the name it is typed as', Boolean(cliHit) && cliHit.names.includes('thing-alias'), JSON.stringify(r.hits.filter((h) => h.file === 'README.md')));
check('hits come in document order — the summary first, then each chapter by line', r.hits[0].file === 'README.md' && r.hits.every((h, i) => i === 0 || r.hits[i - 1].file < h.file || (r.hits[i - 1].file === h.file && r.hits[i - 1].line <= h.line)), JSON.stringify(r.hits.map((h) => `${h.file}:${h.line}`)));

console.log('\nneighbours: the paragraph that is false without naming anything');

const nb = r.neighbours.find((n) => n.file === 'docs/a.md' && n.heading.title === 'The verdict');
check('a section holding a hit lists its nearest paragraphs that name nothing', Boolean(nb) && nb.blocks.some((b) => b.text.includes('lifts by itself')), JSON.stringify(nb));
check('a bullet is a neighbour whole and labelled by its kind', nb && nb.blocks.some((b) => b.kind === 'bullet'));
check('a hit is never also its own neighbour', nb && !nb.blocks.some((b) => b.text.includes('fooVerdict returns') || b.text.includes('lib/thing.js')));
check('a section with no hit has no neighbours', !r.neighbours.some((n) => n.heading.title === 'Elsewhere'));
const one = describes(repo, { near: 1 }).neighbours.find((n) => n.heading.title === 'The verdict');
check('--near caps how many, nearest first', one && one.blocks.length === 1, JSON.stringify(one));
check('--near 0 drops them', describes(repo, { near: 0 }).neighbours.length === 0);

console.log('\nheadings: the other half');

const hc = r.headings.find((h) => h.title === 'Old heading name');
check('a heading that left the document is reported, and the one that replaced it', hc && hc.slug === 'old-heading-name' && hc.now && hc.now.title === 'New heading name', JSON.stringify(hc));
check(
  'with every inbound link to its old slug — same file, a sibling document, and the summary',
  hc && ['docs/a.md', 'docs/b.md', 'README.md'].every((f) => hc.links.some((l) => l.file === f)),
  JSON.stringify(hc && hc.links)
);
check('a link inside fenced code is not a link', hc && !hc.links.some((l) => l.text.includes('in code')));
check('a link to a heading that still exists is not reported', hc && !hc.links.some((l) => l.text.includes('the-verdict')), JSON.stringify(hc && hc.links));
check('a removed line that starts with two dashes did not derail the diff parser', r.files.some((f) => f.file === 'docs/a.md') && r.headings.length === 1, JSON.stringify(r.headings));

console.log('\nnarrowing, explicit paths and refusals');

const nar = describes(repo, { paths: ['lib/thing.js'], only: 'fooVerdict' });
check('one file and one export searches for that name alone', !nar.error && nar.terms.length === 1 && nar.terms[0].text === 'fooVerdict', JSON.stringify(nar.terms));
check('so the paragraph that only names the path is not a hit', !nar.hits.some((h) => h.text.includes('lib/thing.js')) && nar.hits.length === 1, JSON.stringify(nar.hits.map((h) => h.text)));
check('an export the file does not define is refused', /defines no top-level 'nope'/.test(describes(repo, { paths: ['lib/thing.js'], only: 'nope' }).error || ''));
check('an export can be named for a definition the diff REMOVED', !describes(repo, { paths: ['lib/thing.js'], only: 'gone_fn' }).error);
check('a file that exists nowhere is refused', /no such file/.test(describes(repo, { paths: ['lib/nope.js'] }).error || ''));
check('a name needs exactly one file', /exactly one file/.test(describes(repo, { paths: ['lib/thing.js', 'lib/added.js'], only: 'x' }).error || ''));

const untouched = describes(repo, { paths: ['lib/unmentioned.js'] });
check('a module no document mentions returns no hits and is not an error', !untouched.error && untouched.hits.length === 0 && untouched.headings.length === 0);
const changedFile = describes(repo, { paths: ['lib/thing.js'] });
check('a file that IS in the diff is read by its diff, even when named: only what moved is a name', !changedFile.terms.some((t) => t.text === 'keepMe') && changedFile.terms.some((t) => t.text === 'fooVerdict'));

// A file the diff never touched, asked about by name: every export is in question.
const stable = describes(repo, { paths: ['lib/stable.js'] });
check('a file the diff never touched, asked about by name, puts every export in question', stable.terms.some((t) => t.text === 'stableThing'), JSON.stringify(stable.terms.map((t) => t.text)));
check('and finds the paragraph that names it', Boolean(stable.hits.find((h) => h.names.includes('stableThing'))));
sh(repo, 'add', '-A');
sh(repo, 'commit', '-q', '-m', 'work');
check('after a commit the diff since the merge base is still the branch\'s own', describes(repo).files.some((f) => f.file === 'lib/added.js'));

/* ===================================================================== *
 * 3. the real command
 * ===================================================================== */

console.log('\nbin/b7e-describes');

const run = (...args) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', cwd: repo });
put(repo, 'lib/thing.js', fs.readFileSync(path.join(repo, 'lib/thing.js'), 'utf8').replace("'c'", "'d'"));

const plain = run();
check('no arguments describes the working diff and exits 0', plain.status === 0 && /docs\/a\.md:5 {2}\(prose\) {2}names lib\/thing\.js/.test(plain.stdout), plain.stdout + plain.stderr);
check('each hit says where, under which heading with its slug, and quotes the sentence', /under ## The verdict {2}#the-verdict/.test(plain.stdout) && /The decision lives in `lib\/thing\.js` and is small\./.test(plain.stdout));
check('neighbours are labelled as neighbours, not matches', /neighbours — same section/.test(plain.stdout) && /docs\/a\.md:\d+ {2}- \*\*A bullet that lifts by itself/.test(plain.stdout));
check('a renamed heading prints its old slug and every inbound link', /heading renamed: ## Old heading name {2}\(was #old-heading-name\)/.test(plain.stdout) && /inbound README\.md:3 /.test(plain.stdout) && /inbound docs\/b\.md:5 /.test(plain.stdout), plain.stdout);

const j = run('--json');
let parsed = null;
try {
  parsed = JSON.parse(j.stdout);
} catch {
  /* reported below */
}
check('--json is one parseable object with the same parts', parsed && Array.isArray(parsed.hits) && Array.isArray(parsed.neighbours) && Array.isArray(parsed.headings) && Array.isArray(parsed.terms), j.stdout.slice(0, 200));

const narrowed = run('lib/thing.js', 'fooVerdict');
check('a file and an export narrow it: the paragraph naming only the path is left out', narrowed.status === 0 && /names fooVerdict\n/.test(narrowed.stdout) && !/names lib\/thing\.js/.test(narrowed.stdout), narrowed.stdout);
check('--near 0 leaves the neighbours out', !/neighbours/.test(run('--near', '0').stdout));

const badFile = run('lib/nope.js');
check('a file that exists nowhere exits 2 with the usage', badFile.status === 2 && /no such file/.test(badFile.stderr) && /b7e-describes <file>/.test(badFile.stderr), badFile.stderr);
check('an export the file lacks exits 2', run('lib/thing.js', 'nope').status === 2);
check('an unknown flag exits 2', run('--bogus').status === 2);
check('--near wants a number', run('--near', 'x').status === 2);
const help = run('--help');
check('--help prints the usage and exits 0', help.status === 0 && /b7e-describes <file> <export>/.test(help.stdout));

const empty = spawnSync('node', [BIN, 'lib/unmentioned.js'], { encoding: 'utf8', cwd: repo });
check('a module no document mentions prints nothing and exits 0', empty.status === 0 && empty.stdout === '', JSON.stringify(empty.stdout));

const outside = spawnSync('node', [BIN, '--dir', tmp], { encoding: 'utf8' });
check('a directory that is not a repository exits 2', outside.status === 2 && /not inside a git repository/.test(outside.stderr), outside.stderr);

const viaDir = spawnSync('node', [BIN, '--dir', repo, 'lib/thing.js', '--json'], { encoding: 'utf8', cwd: tmp });
check('--dir points the whole thing at another tree, and a path is read against it', viaDir.status === 0 && JSON.parse(viaDir.stdout).files[0].file === 'lib/thing.js', viaDir.stdout + viaDir.stderr);

fs.rmSync(tmp, { recursive: true, force: true });

/* ===================================================================== *
 * 4. THIS repo, shape only
 * ===================================================================== */

console.log('\nthis repository (shape only — never a line number)');

const real = describes(ROOT, { paths: ['lib/docset.js'] });
const docs = new Set(docFiles(ROOT));
check('asked about a real module it answers without error', !real.error && Array.isArray(real.hits));
check(
  'every hit is in a document of the specification, under a heading, at a line that exists',
  real.hits.every((h) => {
    const n = fs.readFileSync(path.join(ROOT, h.file), 'utf8').split('\n').length;
    return docs.has(h.file) && h.line >= 1 && h.line <= n && h.heading && h.heading.slug;
  })
);
check('bin/b7e-describes is itself named in the specification once it is documented', describes(ROOT, { paths: ['bin/b7e-describes'] }).hits.some((h) => h.names.includes('bin/b7e-describes')));

assert.ok(true);
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
