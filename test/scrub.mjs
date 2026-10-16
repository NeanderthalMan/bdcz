#!/usr/bin/env node
//
// Scrubbing a tree for publication — `lib/scrub.js` and `scripts/scrub-snapshot.mjs`.
//
//   node test/scrub.mjs
//
// bc-n2n0t. The claims, each of which a hand-made snapshot got wrong once:
//
//  1. **A literal follows the case of what it replaces**, so `ACME_DIR`, `Acme` and
//     `acme` stay in step with each other and a suite comparing them still passes.
//  2. **The longest literal wins**, so an address rule is not pre-empted by the rule for
//     its domain.
//  3. **`keep` protects a string from the rules and from the gate** — a timezone that
//     happens to contain a denied city.
//  4. **The gate reads paths, lines, binary bytes and the commit's author**, and a name
//     taken from a directory fails it even though no rule was ever written for it.
//  5. **The script never commits as the git identity here**, and refuses to build into a
//     directory that already has something in it.
//
// Every name below is invented. The real rules live outside this repo on purpose.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';
import { collisions, compile, gateTree, isBinary, residue, scrubText, scrubTree } from '../lib/scrub.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-scrub-'));

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const workDir = path.join(tmp, 'work');
fs.mkdirSync(path.join(workDir, 'zephyr-service'), { recursive: true });
fs.mkdirSync(path.join(workDir, 'tools'), { recursive: true });
fs.writeFileSync(path.join(workDir, 'loose-file.json'), '{}');

const rules = compile({
  replace: [
    { from: 'acme', to: 'northwind' },
    { from: 'jo@acme.com', to: 'dev@northwind.example' },
    { from: 'OPS-(\\d+)', to: 'JIRA-$1', regex: true },
    { from: 'Gotham', to: 'Metro' },
  ],
  keep: ['America/Gotham'],
  deny: ['/srv/(?!you\\b)[a-z]+'],
  denyNamesFrom: [{ dir: workDir, match: '-' }],
  exclude: ['SECRET.md', 'private/**'],
});

test('a literal follows the case of what it matched', () => {
  assert.equal(scrubText('acme Acme ACME ACME_DIR', rules), 'northwind Northwind NORTHWIND NORTHWIND_DIR');
});

test('the longest literal runs first, so an address is not split by its domain', () => {
  assert.equal(scrubText('mail jo@acme.com', rules), 'mail dev@northwind.example');
});

test('a dotted literal is also rewritten where it appears regex-escaped', () => {
  assert.equal(scrubText('/jo@acme\\.com/.test(body)', rules), '/dev@northwind\\.example/.test(body)');
});

test('a regex rule rewrites with its captures', () => {
  assert.equal(scrubText('see OPS-12 and OPS-7', rules), 'see JIRA-12 and JIRA-7');
});

test('a kept string survives both the rules and the gate', () => {
  const out = scrubText('tz America/Gotham, city Gotham', rules);
  assert.equal(out, 'tz America/Gotham, city Metro');
  assert.deepEqual(residue(out, rules), []);
  assert.equal(residue('city Gotham', rules).length, 1, 'outside the kept string it is still denied');
});

test('counts are tallied per rule', () => {
  const counts = new Map();
  scrubText('acme acme OPS-1', rules, counts);
  assert.equal(counts.get('acme'), 2);
  assert.equal(counts.get('OPS-(\\d+)'), 1);
});

test('a name from a directory is denied without a rule, and files there are not names', () => {
  assert.equal(residue('calls zephyr-service', rules)[0]?.match, 'zephyr-service');
  assert.deepEqual(residue('the tools dir', rules), [], 'no "-" in it, so the match filter leaves it out');
  assert.deepEqual(residue('reads loose-file.json', rules), [], 'a file is not a checkout');
  assert.deepEqual(residue('xzephyr-services', rules), [], 'a name only counts on a boundary');
});

test('a deny pattern catches what no rule rewrites', () => {
  assert.equal(residue('at /srv/jo/x', rules).length, 1);
  assert.deepEqual(residue('at /srv/you/x', rules), []);
});

test('a string deny entry is case-insensitive; an object entry takes its flags as given', () => {
  const pat = 'ZZ\\.[A-Z][A-Za-z]+\\.[A-Z]';
  const loose = compile({ deny: [pat] });
  assert.equal(residue('buzz.chips.map(x)', loose).length, 1, 'a string entry still ignores case');
  const strict = compile({ deny: [{ from: pat, flags: '' }] });
  assert.deepEqual(residue('buzz.chips.map(x)', strict), [], 'with no i flag, ordinary code is not a finding');
  assert.equal(residue('see ZZ.Widget.X', strict)[0]?.match, 'ZZ.Widget.X');
  assert.equal(compile({ deny: [{ from: pat, flags: 'gm' }] }).denied[0].re.flags, 'm', 'a g flag is dropped');
  assert.match(strict.denied[0].why, /ZZ/, 'the why still names the pattern');
});

test('scrubTree drops, renames, rewrites and leaves binaries alone', () => {
  const tree = path.join(tmp, 'tree');
  fs.mkdirSync(path.join(tree, 'private'), { recursive: true });
  fs.mkdirSync(path.join(tree, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'SECRET.md'), 'x');
  fs.writeFileSync(path.join(tree, 'private', 'a.txt'), 'x');
  fs.writeFileSync(path.join(tree, 'docs', 'acme-notes.md'), 'Acme ships OPS-3\n');
  fs.writeFileSync(path.join(tree, 'logo.png'), Buffer.from([0x89, 0x50, 0, 0, 0x61, 0x63, 0x6d, 0x65]));
  const report = scrubTree(tree, rules);
  assert.deepEqual(report.dropped.sort(), ['SECRET.md', 'private/a.txt']);
  assert.ok(!fs.existsSync(path.join(tree, 'private')), 'an emptied directory goes too');
  assert.deepEqual(report.renamed, [['docs/acme-notes.md', 'docs/northwind-notes.md']]);
  assert.equal(fs.readFileSync(path.join(tree, 'docs', 'northwind-notes.md'), 'utf8'), 'Northwind ships JIRA-3\n');
  assert.deepEqual(report.binary, ['logo.png']);
  assert.ok(isBinary(fs.readFileSync(path.join(tree, 'logo.png'))));
  const findings = gateTree(tree, rules);
  assert.deepEqual(
    findings.map((f) => [f.file, f.match]),
    [['logo.png', 'acme']],
    'a binary cannot be rewritten, so the gate reads its bytes'
  );
});

test('a replacement that already exists in the source is reported', () => {
  const tree = path.join(tmp, 'collide');
  fs.mkdirSync(tree);
  fs.writeFileSync(path.join(tree, 'a.md'), 'Northwind was here first\n');
  assert.deepEqual(collisions(tree, rules), [{ to: 'northwind', file: 'a.md' }]);
});

// --- the script, end to end, against this repo's HEAD --------------------------------

const config = path.join(tmp, 'config');
fs.mkdirSync(config);
const env = { ...process.env, BEADCAUSE_CONFIG_DIR: config };
const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'scrub-snapshot.mjs'), ...args], { env, encoding: 'utf8' });

test('with no rules file it stops and says where it looked', () => {
  const r = run('--out', path.join(tmp, 'none'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /scrub\.json/);
});

const rulesFile = path.join(config, 'scrub.json');
fs.writeFileSync(rulesFile, JSON.stringify({ replace: [], deny: ['secret-scan\\.mjs'] }));

test('a denied string left in the snapshot fails the gate with its file and line', () => {
  const r = run('--out', path.join(tmp, 'snap-deny'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /package\.json:\d+ {2}secret-scan\.mjs/);
});

test('--commit without an author refuses before building anything', () => {
  const r = run('--out', path.join(tmp, 'snap-noauthor'), '--commit');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /author/);
  assert.ok(!fs.existsSync(path.join(tmp, 'snap-noauthor')));
});

test('a non-empty --out is refused', () => {
  const r = run('--out', path.join(tmp, 'snap-deny'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not empty/);
});

fs.writeFileSync(rulesFile, JSON.stringify({ replace: [], author: 'Snap Shot <snap@example.com>', deny: ['someone@private\\.example'] }));

test('--commit makes one commit as the rules author, and --check reads that author', () => {
  const out = path.join(tmp, 'snap-ok');
  const r = run('--out', out, '--commit');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const log = spawnSync('git', ['-C', out, 'log', '--format=%an <%ae>|%cn <%ce>'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(log, 'Snap Shot <snap@example.com>|Snap Shot <snap@example.com>');
  assert.equal(run('--check', out).status, 0);
  fs.writeFileSync(rulesFile, JSON.stringify({ replace: [], deny: ['snap@example\\.com'] }));
  const again = run('--check', out);
  assert.equal(again.status, 1);
  assert.match(again.stdout, /\(git history\)/);
});

await cleanupTmp(tmp);
console.log(`\n${passed}/${passed} ok`);
