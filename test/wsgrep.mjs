#!/usr/bin/env node
//
// b7e-grep's general form (bc-xl7n.171): any checkout or git ref, -e / --path / --at /
// --max, JS-regex matching, and a cap that says what it left out.
//
//   node test/wsgrep.mjs
//
// Everything runs against a fabricated git repo in a tmp dir; `--dir` is how the CLI is
// pointed at it, and `--path` is what switches the general form on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-grep');
const { globToRegExp, grepWorkspace, capHits, trimLine } = await import(path.join(ROOT, 'lib', 'wsgrep.js'));

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${String(err.message).split('\n')[0]}`);
  }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsgrep-'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (dir, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
git(repo, 'init', '-q');
git(repo, 'config', 'user.email', 't@example.com');
git(repo, 'config', 'user.name', 't');
put(repo, 'reference/a/one.md', 'timeline B is here\ntimeline Bx not a word match\n');
put(repo, 'docs/two.md', 'timeline C\n');
put(repo, 'src/code.py', 'timeline B in python\n');
put(repo, 'big.md', Array.from({ length: 100 }, (_, i) => `Day 60 line ${i}`).join('\n') + '\n');
put(repo, 'long.md', `${'x'.repeat(500)} Kestrel ${'y'.repeat(500)}\n`);
put(repo, 'bin.dat', 'timeline B\0binary\n');
put(repo, '.gitignore', 'ignored.md\n');
git(repo, 'add', '-A');
git(repo, 'commit', '-q', '-m', 'one');
put(repo, 'ignored.md', 'timeline B ignored\n');
put(repo, 'fresh.md', 'timeline B untracked\n');
put(repo, '.claude/worktrees/sib/x.md', 'timeline B sibling\n');
put(repo, 'reference/a/one.md', 'edited, no match now\n');

const run = (...args) => spawnSync(process.execPath, [BIN, '--dir', repo, ...args], { encoding: 'utf8' });
const files = (res) => res.results.map((r) => r.file);

console.log('\nglobs\n');
check('no slash matches the basename at any depth', () => {
  assert.ok(globToRegExp('*.md').test('reference/a/one.md'));
  assert.ok(!globToRegExp('*.md').test('src/code.py'));
});
check('a slash anchors it, ** crosses directories, * does not', () => {
  assert.ok(globToRegExp('reference/**/*.md').test('reference/a/one.md'));
  assert.ok(globToRegExp('reference/**/*.md').test('reference/one.md'));
  assert.ok(!globToRegExp('docs/*.md').test('docs/x/two.md'));
  assert.ok(!globToRegExp('docs/*.md').test('other/docs/two.md'));
});

console.log('\nthe search\n');
check('the working tree is git\'s list: tracked edits and untracked files in, ignored and sibling worktrees out', () => {
  const r = grepWorkspace(repo, ['timeline B']);
  assert.deepEqual(files(r), ['fresh.md', 'src/code.py'], 'edited file no longer matches; binary skipped');
});
check('--at reads the ref, not the working tree', () => {
  const r = grepWorkspace(repo, ['timeline B'], { at: 'HEAD' });
  assert.deepEqual(files(r), ['reference/a/one.md', 'src/code.py']);
});
check('a ref that does not resolve throws, it does not search nothing', () => {
  assert.throws(() => grepWorkspace(repo, ['x'], { at: 'no-such-ref' }), /does not resolve/);
});
check('\\b and alternation mean what was written — no complexity limit', () => {
  const r = grepWorkspace(repo, ['timeline [B-C]\\b'], { paths: ['reference/**/*.md', 'docs/*.md'], at: 'HEAD' });
  assert.deepEqual(files(r), ['docs/two.md', 'reference/a/one.md']);
  assert.equal(r.total, 2, '"timeline Bx" must not match \\b');
  const big = grepWorkspace(repo, ['.{0,100}Kestrel.{0,100}'], { paths: ['long.md'] });
  assert.equal(big.total, 1);
});
check('--path keeps only matching files; several are OR\'d', () => {
  assert.deepEqual(files(grepWorkspace(repo, ['timeline'], { paths: ['*.py'], at: 'HEAD' })), ['src/code.py']);
  assert.deepEqual(files(grepWorkspace(repo, ['timeline'], { paths: ['*.py', 'docs/*.md'], at: 'HEAD' })), ['docs/two.md', 'src/code.py']);
});
check('a bad regex is a named error', () => {
  assert.throws(() => grepWorkspace(repo, ['(unclosed']), /bad pattern/);
});
check('long lines are trimmed around the match', () => {
  const r = grepWorkspace(repo, ['Kestrel'], { paths: ['long.md'] });
  const text = r.results[0].hits[0].text;
  assert.ok(text.length < 260 && text.includes('Kestrel') && text.startsWith('…') && text.endsWith('…'));
  assert.equal(trimLine('short', [/short/]), 'short');
});

console.log('\nthe cap\n');
check('capHits keeps the first n hits and the true totals', () => {
  const c = capHits(grepWorkspace(repo, ['Day 60'], { paths: ['big.md'] }), 10);
  assert.equal(c.capped, true);
  assert.equal(c.shownHits, 10);
  assert.equal(c.total, 100);
  assert.equal(c.shown[0].hits.length, 10);
  assert.equal(c.shown[0].count, 100);
});
check('max 0 and under-cap results are untouched', () => {
  const r = grepWorkspace(repo, ['Day 60'], { paths: ['big.md'] });
  assert.equal(capHits(r, 0).capped, false);
  assert.equal(capHits(r, 100).capped, false);
});

console.log('\nthe CLI\n');
check('says "showing N of M hits in F files" when capped, and prints N lines', () => {
  const r = run('Day 60', '--path', 'big.md', '--max', '5');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /showing 5 of 100 hits in 1 file/);
  assert.equal(r.stdout.split('\n').filter((l) => l.startsWith('big.md:')).length, 5);
});
check('the default cap is 40', () => {
  const r = run('Day 60', '--path', 'big.md');
  assert.match(r.stdout, /showing 40 of 100 hits/);
});
check('-e carries a pattern that starts with a dash; patterns OR', () => {
  put(repo, 'dash.md', '--include=*.md\nplain\n');
  const r = run('-e', '--include=\\*', '-e', 'plain', '--path', 'dash.md', '--count');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /dash\.md: 2/);
});
check('--count and --files under the general form', () => {
  assert.match(run('timeline', '--at', 'HEAD', '--count').stdout, /4 matches across 3 files at HEAD/);
  assert.equal(run('timeline', '--at', 'HEAD', '--files').stdout.trim().split('\n').length, 3);
});
check('exit 1 with no match, 2 on a bad ref, an unknown workspace, a bad --max, or --in mixed in', () => {
  assert.equal(run('zzzzz', '--path', '*.md').status, 1);
  assert.equal(run('x', '--at', 'nope').status, 2);
  const w = spawnSync(process.execPath, [BIN, '-w', 'no-such-workspace-xyz', 'x'], { encoding: 'utf8' });
  assert.equal(w.status, 2);
  assert.match(w.stderr, /no workspace named no-such-workspace-xyz — have:/);
  assert.equal(run('x', '--path', '*.md', '--max', 'many').status, 2);
  assert.equal(run('x', '--path', '*.md', '--in', 'lib').status, 2);
});
check('a glob in --path reaches b7e-grep as written: no shell expansion in between', () => {
  const r = spawnSync(process.execPath, [BIN, '--dir', repo, 'timeline', '--path', '*.py', '--at', 'HEAD', '--files'], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'src/code.py');
});
check('without -w, --path or --at the old seven-roots form is unchanged', () => {
  const r = run('anything', '--in', 'lib');
  assert.equal(r.status, 1);
});

removeTreeSync(tmp);
console.log(failures ? `\n${failures} check(s) failed\n` : '\nall wsgrep checks passed\n');
process.exit(failures ? 1 : 0);
