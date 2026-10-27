#!/usr/bin/env node
//
// b7e-visible — is this path tracked, ignored, or a tracked-but-unmaterialised LFS
// pointer, and does it exist in a worktree at all (bc-dgx7.141).
//
//   npm test
//   node test/b7evisible.mjs
//
// lib/visible.js does the classification; this drives it both directly and through
// bin/b7e-visible, against fixtures built with lib/fixture.js's buildFixture — real
// (throwaway) git trees, never the delmar checkout this bead's evidence came from.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-visible');

const visible = await import(path.join(ROOT, 'lib', 'visible.js'));
const { buildFixture, fixtureRoot } = await import(path.join(ROOT, 'lib', 'fixture.js'));

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

console.log('\nb7e-visible\n');

const run = (args, opts) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', ...opts });

/* ===================================================================== *
 * fixture: a synthetic repo standing in for a "delmar"-shaped checkout —
 * a tracked file, a gitignored generated-content path, an LFS-attributed asset left
 * unmaterialised, and one left materialised for real, plus a bare .claude/worktrees/
 * marker so the worktree-workflow half of the classification has something to say no to.
 * ===================================================================== */

const LFS_POINTER = ['version https://git-lfs.github.com/spec/v1', 'oid sha256:' + 'a'.repeat(64), 'size 123456', ''].join('\n');

const fx = buildFixture({
  name: 'b7evisible-suite',
  steps: [
    { type: 'file', path: '.gitignore', content: 'webseries/episodes/*\n' },
    { type: 'file', path: 'webseries/alban-short.txt', content: 'tracked outline\n' },
    { type: 'file', path: '.claude/worktrees/.keep', content: '' },
    { type: 'file', path: '.gitattributes', content: 'reference/maps/*.png filter=lfs -text\n' },
    { type: 'file', path: 'reference/maps/c1_02_anavarre.png', content: LFS_POINTER },
    { type: 'file', path: 'reference/maps/materialised.png', content: 'not actually a pointer, stands in for real image bytes\n' },
    { type: 'commit', message: 'seed the fixture tree' },
    // left uncommitted on purpose, after the last commit step (lib/fixture.js's own
    // convention) — this is the working-tree dirt --changed and changedPaths answer.
    { type: 'file', path: 'webseries/alban-short.txt', content: 'tracked outline, now edited\n' },
    { type: 'file', path: '.deliver-body.md', content: 'stray untracked file, dv-5eu.39-shaped\n' },
  ],
});
const DIR = fx.dir;
// webseries/episodes/* is gitignored, so it is never committed — it only exists on disk
// in whichever checkout wrote it, exactly like a real "main checkout only" generated file.
fs.mkdirSync(path.join(DIR, 'webseries', 'episodes', 'younger-dryas-impact'), { recursive: true });
fs.writeFileSync(path.join(DIR, 'webseries', 'episodes', 'younger-dryas-impact', 'script.txt'), 'recut notes\n');

/* ===================================================================== *
 * 1. lib/visible.js — classifyPath, one state at a time
 * ===================================================================== */

check('a plain tracked, non-allowlisted path: tracked, present in a fresh worktree, needs a worktree to edit, deliverable', () => {
  const row = visible.classifyPath(DIR, 'webseries/alban-short.txt');
  assert.equal(row.state, 'tracked');
  assert.equal(row.ignoreRule, null);
  assert.equal(row.presentInFreshWorktree, true);
  assert.equal(row.editableInMainCheckout, false);
  assert.equal(row.carriedByDelivery, true);
});

check('an ignored generated-content path: absent from a fresh worktree, not deliverable, names the matching rule', () => {
  const row = visible.classifyPath(DIR, 'webseries/episodes/younger-dryas-impact/script.txt');
  assert.equal(row.state, 'ignored');
  assert.deepEqual(row.ignoreRule, { file: '.gitignore', line: 1, pattern: 'webseries/episodes/*' });
  assert.equal(row.existsOnDisk, true);
  assert.equal(row.presentInFreshWorktree, false);
  assert.equal(row.carriedByDelivery, false);
});

check('editable in the main checkout only when the hook would allow it — an ignored path is still blocked there, matching worktree-guard.sh\'s own allowlist', () => {
  const row = visible.classifyPath(DIR, 'webseries/episodes/younger-dryas-impact/script.txt');
  assert.equal(row.editableInMainCheckout, false, 'not one of .claude/**, CLAUDE.md, .gitignore — the hook blocks it too, same as a tracked path');
});

check('a tracked, unmaterialised LFS pointer: classified lfs-pointer, not plain tracked', () => {
  const row = visible.classifyPath(DIR, 'reference/maps/c1_02_anavarre.png');
  assert.equal(row.state, 'lfs-pointer');
  assert.deepEqual(row.lfs, { filter: 'lfs', materialised: false });
  assert.equal(row.presentInFreshWorktree, true, 'tracked — the pointer text itself checks out into a fresh worktree');
});

check('a materialised LFS file (filter set, real bytes on disk) reports plain tracked, not lfs-pointer', () => {
  const row = visible.classifyPath(DIR, 'reference/maps/materialised.png');
  assert.equal(row.state, 'tracked');
  assert.equal(row.lfs.materialised, true);
});

check('an untracked, non-ignored path: untracked, absent from a fresh worktree, still deliverable if added', () => {
  const row = visible.classifyPath(DIR, '.deliver-body.md');
  assert.equal(row.state, 'untracked');
  assert.equal(row.ignoreRule, null);
  assert.equal(row.presentInFreshWorktree, false);
  assert.equal(row.carriedByDelivery, true);
});

check('a path that does not exist on disk at all is still classifiable, as untracked', () => {
  const row = visible.classifyPath(DIR, 'never/written/here.txt');
  assert.equal(row.existsOnDisk, false);
  assert.equal(row.state, 'untracked');
});

check('a clean, allowlisted, tracked path reports every verdict green — worktree-guard.sh\'s own exception', () => {
  const row = visible.classifyPath(DIR, '.gitignore');
  assert.equal(row.state, 'tracked');
  assert.equal(row.presentInFreshWorktree, true);
  assert.equal(row.editableInMainCheckout, true);
  assert.equal(row.carriedByDelivery, true);
});

/* ===================================================================== *
 * 2. lib/visible.js — the worktree-workflow opt-in and the allowlist by itself
 * ===================================================================== */

check('isAllowlistedForMainCheckout matches only .claude/**, CLAUDE.md and .gitignore, verbatim against worktree-guard.sh', () => {
  assert.equal(visible.isAllowlistedForMainCheckout('.claude/worktrees/foo'), true);
  assert.equal(visible.isAllowlistedForMainCheckout('CLAUDE.md'), true);
  assert.equal(visible.isAllowlistedForMainCheckout('.gitignore'), true);
  assert.equal(visible.isAllowlistedForMainCheckout('lib/foo.js'), false);
  assert.equal(visible.isAllowlistedForMainCheckout('.claudemd'), false, 'a lookalike prefix must not match');
});

check('usesWorktreeWorkflow is true for this fixture (it seeded .claude/worktrees/.keep)', () => {
  assert.equal(visible.usesWorktreeWorkflow(DIR), true);
});

check('when the repo opts out of the worktree workflow, editableInMainCheckout is true everywhere — the hook never engages', () => {
  const bare = buildFixture({ name: 'b7evisible-no-workflow', steps: [{ type: 'file', path: 'lib/x.js', content: 'x\n' }, { type: 'commit', message: 'seed' }] });
  assert.equal(visible.usesWorktreeWorkflow(bare.dir), false);
  const row = visible.classifyPath(bare.dir, 'lib/x.js');
  assert.equal(row.editableInMainCheckout, true);
  fs.rmSync(path.join(fixtureRoot(), 'b7evisible-no-workflow'), { recursive: true, force: true });
});

/* ===================================================================== *
 * 3. lib/visible.js — changedPaths, the dv-5eu.39 case
 * ===================================================================== */

check('changedPaths finds the modified tracked file and the stray untracked one, never the ignored one', () => {
  const rows = visible.changedPaths(DIR);
  const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.equal(byPath['webseries/alban-short.txt']?.state, 'tracked');
  assert.equal(byPath['.deliver-body.md']?.state, 'untracked');
  assert.equal(byPath['webseries/episodes/younger-dryas-impact/script.txt'], undefined, 'ignored paths never show up in git status --porcelain');
});

/* ===================================================================== *
 * 4. bin/b7e-visible — argv, exit codes, --json, --changed
 * ===================================================================== */

check('--help exits 0 without touching any git state', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /b7e-visible/);
});

check('no path and no --changed is refused with exit 2', () => {
  const r = run([], { cwd: DIR });
  assert.equal(r.status, 2);
});

check('a path together with --changed is refused with exit 2', () => {
  const r = run(['--changed', 'webseries/alban-short.txt'], { cwd: DIR });
  assert.equal(r.status, 2);
});

check('--dir <root> classifies the given paths, plain text, one block per path', () => {
  const r = run(['--dir', DIR, 'webseries/alban-short.txt', 'webseries/episodes/younger-dryas-impact/script.txt']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /webseries\/alban-short\.txt/);
  assert.match(r.stdout, /state: .*ignored/);
  assert.match(r.stdout, /ignored by: \.gitignore:1/);
});

check('--json on explicit paths is valid JSON carrying every field', () => {
  const r = run(['--dir', DIR, '--json', 'reference/maps/c1_02_anavarre.png']);
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.rows[0].state, 'lfs-pointer');
  assert.equal(parsed.rows[0].presentInFreshWorktree, true);
});

check('--changed --json reflects the fixture\'s own dirty tree', () => {
  const r = run(['--dir', DIR, '--changed', '--json']);
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  const paths = parsed.rows.map((r2) => r2.path).sort();
  assert.deepEqual(paths, ['.deliver-body.md', 'webseries/alban-short.txt']);
});

check('a relative path is resolved against cwd, not against --dir, when --dir is not given', () => {
  const r = run(['webseries/alban-short.txt'], { cwd: DIR });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /state: tracked/);
});

/* ===================================================================== *
 * 5. wiring — executable, exactly one @grant, both bin registrations
 * ===================================================================== */

check('bin/b7e-visible is executable and declares exactly one @grant', () => {
  const st = fs.statSync(BIN);
  assert.ok(st.mode & 0o111, 'bin/b7e-visible should be executable');
  const src = fs.readFileSync(BIN, 'utf8');
  const grants = [...src.matchAll(/^[ \t]*(?:\*|\/\/)?[ \t]*@grant[ \t]+(\S+)[ \t]*$/gm)];
  assert.equal(grants.length, 1);
  assert.equal(grants[0][1], 'read');
});

check('package.json and package-lock.json both register b7e-visible at bin/b7e-visible', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.bin['b7e-visible'], 'bin/b7e-visible');
  assert.equal(lock.packages?.['']?.bin?.['b7e-visible'], 'bin/b7e-visible');
});

check('docs/b7e/b7e-visible.md documents b7e-visible (one file per tool since bc-fmk4v)', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'b7e', 'b7e-visible.md'), 'utf8');
  assert.match(doc, /### .*b7e-visible/);
});

// Only the fixtures this run itself created — never the whole of fixtureRoot(), which
// this machine's other concurrent uses of the same command also share.
for (const entry of fs.existsSync(fixtureRoot()) ? fs.readdirSync(fixtureRoot()) : []) {
  if (entry === 'b7evisible-suite' || entry === 'b7evisible-no-workflow') {
    fs.rmSync(path.join(fixtureRoot(), entry), { recursive: true, force: true });
  }
}

console.log(`\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
