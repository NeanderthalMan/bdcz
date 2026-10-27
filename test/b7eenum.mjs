#!/usr/bin/env node
//
// b7e-enum — every place a sibling name is registered, and whether a new name is
// registered alongside it (bc-dgx7.153).
//
//   npm test
//   node test/b7eenum.mjs
//
// Section 1 drives lib/enum.js directly against fabricated file text: construct
// classification (tuple/list/set member, dict key vs. value, `==`/`===`, `in (...)`),
// enclosing-name resolution (assignment target, call name, Python `def` fallback),
// docstring/README prose mentions, and comment lines staying invisible. Section 2
// drives the real bin/b7e-enum against a fixture tree on disk via --dir — argv
// parsing, --new present/missing, --json, "nothing found", and the exit codes.
// Section 3 drives --ref against a tiny git repo, the shape the bead's own
// acceptance criteria is written in: missing before a registration commit, present
// after it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeFileText, pythonDefScopeAt, scanProseText } from '../lib/enum.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-enum');

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));
const siteAt = (sites, line) => sites.find((s) => s.line === line);

/* ===================================================================== *
 * 1. lib/enum.js against fabricated file text
 * ===================================================================== */

console.log('\nconstruct classification and enclosing names (fabricated text)');

const PY_FIXTURE = [
  /* 1 */ '"""Module docstring mentioning hearth once."""',
  /* 2 */ '',
  /* 3 */ 'SET_TYPES = (',
  /* 4 */ '    "roundhouse",',
  /* 5 */ '    "hearth",',
  /* 6 */ '    "torch",',
  /* 7 */ ')',
  /* 8 */ '',
  /* 9 */ 'LIGHT_SET_TYPES = {',
  /* 10 */ '    "hearth": 1,',
  /* 11 */ '}',
  /* 12 */ '',
  /* 13 */ 'declared_lights = {"hearth": True}',
  /* 14 */ '',
  /* 15 */ '# "hearth" in a comment must never be a site or a prose mention',
  /* 16 */ 'def build(kind):',
  /* 17 */ '    if kind == "hearth":',
  /* 18 */ '        return make_fire()',
  /* 19 */ '    elif kind == "torch":',
  /* 20 */ '        return make_fire()',
  /* 21 */ '    elif kind in ("roundhouse", "boat"):',
  /* 22 */ '        return make_shelter()',
  /* 23 */ '',
  /* 24 */ 'def solids_of(kind):',
  /* 25 */ '    if kind == "hearth":',
  /* 26 */ '        return HEARTH_SOLID',
].join('\n');

const { sites: pySites, prose: pyProse } = analyzeFileText('pipeline/runner.py', PY_FIXTURE, { sibling: 'hearth', newName: 'torch' });

check('finds every hearth registration site, none extra', pySites.length === 5, JSON.stringify(pySites.map((s) => s.line)));
check('tuple member, enclosed by its assignment target', siteAt(pySites, 5)?.construct === 'tuple member' && siteAt(pySites, 5)?.enclosing === 'SET_TYPES');
check('dict key (not value), enclosed by its assignment target', siteAt(pySites, 10)?.construct === 'dict key' && siteAt(pySites, 10)?.enclosing === 'LIGHT_SET_TYPES');
check('inline dict literal still resolves its assignment target', siteAt(pySites, 13)?.construct === 'dict key' && siteAt(pySites, 13)?.enclosing === 'declared_lights');
check('equality branch, enclosed by the nearest def (indentation fallback)', siteAt(pySites, 17)?.construct === 'equality (== "x")' && siteAt(pySites, 17)?.enclosing === 'build');
check('a second def down the file gets its own enclosing name', siteAt(pySites, 25)?.enclosing === 'solids_of');
check('a comment line is neither a site nor a prose mention', !pySites.some((s) => s.line === 15) && !pyProse.some((p) => p.line === 15));
check('the docstring mention is reported as prose, not a site', pyProse.some((p) => p.line === 1 && p.name === 'hearth'));

check('tuple site: torch shares the same tuple, so present', siteAt(pySites, 5)?.newPresent === true);
check('dict site: torch is not a key here, so missing', siteAt(pySites, 10)?.newPresent === false);
check('inline dict site: torch never appears there, missing', siteAt(pySites, 13)?.newPresent === false);
check('equality site: torch has its own elif in the same def, so present', siteAt(pySites, 17)?.newPresent === true);
check('a def with no torch registration at all reports missing', siteAt(pySites, 25)?.newPresent === false);

const inBranch = pySites.find((s) => s.construct.startsWith('in ('));
check('an in (...) branch is its own construct kind', !inBranch, 'hearth is not itself a member of the roundhouse/boat tuple in this fixture, so none should be found');

// hearth appears inside the in(...) tuple too, in a second fixture, to prove that shape
const PY_IN_BRANCH = [
  /* 1 */ 'def build(kind):',
  /* 2 */ '    if kind in ("roundhouse", "hearth", "boat"):',
  /* 3 */ '        return make_shelter()',
].join('\n');
{
  const { sites } = analyzeFileText('runner.py', PY_IN_BRANCH, { sibling: 'hearth', newName: 'torch' });
  check('in (...) branch classified and scoped to its own tuple', sites.length === 1 && sites[0].construct === 'in (...) branch' && sites[0].enclosing === 'build');
  check('in (...) branch: torch is not in the same tuple, so missing even though no other torch exists', sites[0].newPresent === false);
}

// dict value vs. dict key
const PY_DICT_VALUE = ['ALIASES = {', '    "torch": "hearth",', '}'].join('\n');
{
  const { sites } = analyzeFileText('a.py', PY_DICT_VALUE, { sibling: 'hearth' });
  check('a quoted string after a colon is a dict value, not a key', sites.length === 1 && sites[0].construct === 'dict value');
}

// JS: list member, `===`, and no Python def fallback
const JS_FIXTURE = [
  /* 1 */ "// registers kinds",
  /* 2 */ "const KINDS = new Set(['hearth', 'boat']);",
  /* 3 */ '',
  /* 4 */ "function isLit(kind) {",
  /* 5 */ "  if (kind === 'hearth') return true;",
  /* 6 */ '  return false;',
  /* 7 */ '}',
].join('\n');
{
  const { sites } = analyzeFileText('registry.js', JS_FIXTURE, { sibling: 'hearth' });
  check('JS: list member found inside a call, no python def to fall back on', sites.length === 2 && siteAt(sites, 2)?.construct === 'list member');
  check('JS: a triple-equals counts as an equality comparison too', siteAt(sites, 5)?.construct === 'equality (== "x")');
  check('a `//` comment line is invisible, same as `#`', !sites.some((s) => s.line === 1));
}

// Markdown / README prose
const MD_FIXTURE = ['# Types', '', 'A hearth is a kind of light source.', 'See also torch.'].join('\n');
{
  const { sites, prose } = analyzeFileText('README.md', MD_FIXTURE, { sibling: 'hearth', newName: 'torch' });
  check('a markdown file contributes no code sites at all', sites.length === 0);
  check('a markdown file is scanned whole for prose mentions of both names', prose.some((p) => p.name === 'hearth' && p.line === 3) && prose.some((p) => p.name === 'torch' && p.line === 4));
}

check('scanProseText is word-boundary, not substring', scanProseText('hearthside vs hearth', 1, ['hearth']).length === 1);
check('pythonDefScopeAt returns "" with no enclosing def', pythonDefScopeAt(['SET_TYPES = (', '  "hearth",', ')'], 2) === '');

/* ===================================================================== *
 * 2. bin/b7e-enum against a --dir fixture tree
 * ===================================================================== */

console.log('\nbin/b7e-enum --dir (fixture tree on disk)');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-b7eenum-test-')));
fs.mkdirSync(path.join(tmp, 'pipeline'));
fs.writeFileSync(path.join(tmp, 'pipeline', 'runner.py'), PY_FIXTURE);
fs.writeFileSync(path.join(tmp, 'README.md'), MD_FIXTURE);

const run = (args) => spawnSync(process.execPath, [BIN, '--dir', tmp, ...args], { encoding: 'utf8' });

{
  const r = run(['hearth']);
  check('exit 0 when sites are found and --new was not asked for', r.status === 0, r.stdout + r.stderr);
  check('prints one block per file, grouped', /pipeline\/runner\.py/.test(r.stdout));
  check('prints the prose section separately', /prose mentions/.test(r.stdout));
}

{
  const r = run(['hearth', '--new', 'torch']);
  check('exit 1 when at least one site is missing the new name', r.status === 1, r.stdout + r.stderr);
  check('reports both a present and a missing site', /torch present/.test(r.stdout) && /torch missing/.test(r.stdout));
}

{
  const r = run(['torch', '--new', 'torch']);
  // trivial: torch has one site (the tuple), and it always "contains itself"
  check('a name checked against itself at its own site is present', r.status === 0, r.stdout + r.stderr);
}

{
  const r = run(['no-such-sibling-anywhere']);
  check('nothing found: exit 1, says so plainly, not a crash', r.status === 1 && /no occurrence/.test(r.stdout), `status ${r.status}\n${r.stdout}`);
}

{
  const r = run(['hearth', '--json']);
  const lines = r.stdout.trim().split('\n').filter(Boolean);
  let parsedOk = lines.length > 0;
  for (const line of lines) {
    try { JSON.parse(line); } catch { parsedOk = false; }
  }
  check('--json prints one parseable object per line', parsedOk, r.stdout);
  check('--json includes both sites and prose, tagged by kind', lines.some((l) => JSON.parse(l).kind === 'site') && lines.some((l) => JSON.parse(l).kind === 'prose'));
}

{
  const r = spawnSync(process.execPath, [BIN], { encoding: 'utf8' });
  check('no sibling argument: exit 2, not a scan of cwd', r.status === 2, `status ${r.status}\n${r.stderr}`);
}

{
  const r = spawnSync(process.execPath, [BIN, 'hearth', '--nonsense'], { encoding: 'utf8' });
  check('an unrecognised flag: exit 2', r.status === 2, `status ${r.status}\n${r.stderr}`);
}

{
  const r = spawnSync(process.execPath, [BIN, 'hearth', '--dir', path.join(tmp, 'does-not-exist')], { encoding: 'utf8' });
  check('--dir naming a path that does not exist: exit 3', r.status === 3, `status ${r.status}\n${r.stderr}`);
}

{
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  check('--help exits 0 and prints usage without scanning anything', r.status === 0 && /usage: b7e-enum/.test(r.stdout));
}

/* ===================================================================== *
 * 3. --ref against a tiny git repo — the bead's own acceptance shape
 * ===================================================================== */

console.log('\nbin/b7e-enum --ref (a tiny git repo, before/after a registration commit)');

const gitOpts = { cwd: tmp, env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com' } };
execFileSync('git', ['init', '-q'], gitOpts);
execFileSync('git', ['add', '-A'], gitOpts);
execFileSync('git', ['commit', '-q', '-m', 'before: hearth only'], gitOpts);
const before = execFileSync('git', ['rev-parse', 'HEAD'], { ...gitOpts, encoding: 'utf8' }).trim();

// The pre-existing SET_TYPES already has both hearth and torch (fixture reuse), but the
// dict and the two defs do not yet — mirror that by removing torch's registrations first.
const PY_BEFORE = PY_FIXTURE.replace('    "torch",\n', '').replace('    elif kind == "torch":\n        return make_fire()\n', '');
fs.writeFileSync(path.join(tmp, 'pipeline', 'runner.py'), PY_BEFORE);
execFileSync('git', ['commit', '-q', '-am', 'strip torch back out, so "before" has none'], gitOpts);
const strippedBefore = execFileSync('git', ['rev-parse', 'HEAD'], { ...gitOpts, encoding: 'utf8' }).trim();

const PY_AFTER = PY_FIXTURE
  .replace('    "hearth": 1,\n', '    "hearth": 1,\n    "torch": 1,\n')
  .replace('declared_lights = {"hearth": True}', 'declared_lights = {"hearth": True, "torch": True}')
  .replace('    if kind == "hearth":\n        return HEARTH_SOLID', '    if kind == "hearth":\n        return HEARTH_SOLID\n    elif kind == "torch":\n        return TORCH_SOLID');
fs.writeFileSync(path.join(tmp, 'pipeline', 'runner.py'), PY_AFTER);
execFileSync('git', ['commit', '-q', '-am', 'after: register torch everywhere hearth is'], gitOpts);
const after = execFileSync('git', ['rev-parse', 'HEAD'], { ...gitOpts, encoding: 'utf8' }).trim();

{
  const r = run(['hearth', '--new', 'torch', '--ref', strippedBefore]);
  check('--ref at the commit before: torch missing at every site, exit 1', r.status === 1 && /torch missing/.test(r.stdout) && !/torch present/.test(r.stdout), `status ${r.status}\n${r.stdout}`);
}

{
  const r = run(['hearth', '--new', 'torch', '--ref', after]);
  check('--ref at the commit after: torch present everywhere, exit 0', r.status === 0 && /all \d+ site\(s\) already have "torch"/.test(r.stdout), `status ${r.status}\n${r.stdout}`);
}

{
  const r = run(['hearth', '--ref', 'no-such-ref-at-all']);
  check('--ref that does not resolve: exit 3, not a crash', r.status === 3, `status ${r.status}\n${r.stderr}`);
}

void before; // recorded for readability of the fixture history; not asserted on directly

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
