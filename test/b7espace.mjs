#!/usr/bin/env node
/**
 * `b7e-space` — lib/space.js and bin/b7e-space.
 *
 *     node test/b7espace.mjs
 *
 * bc-dgx7.197's acceptance, replayed on a fixture: a fake checkout with .claude/worktrees and
 * an attic, a TMPDIR with gate-run folders, and a sibling repo. Free bytes are stubbed with
 * B7E_SPACE_FREE_BYTES, so "the disk is full" needs no full disk.
 *
 *  1. every group is listed with its size, groups and members largest first
 *  2. a locked worktree is labelled
 *  3. --need gate exits 1 under the floor and 0 above it; --need worktree likewise
 *  4. an explicit byte count, and a bad --need exits 2
 *  5. it writes nothing
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FLOORS } from '../lib/space.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const bin = path.join(ROOT, 'bin', 'b7e-space');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'b7espace-'));
const root = path.join(base, 'repos', 'beadcause');
const tmp = path.join(base, 'tmp');
const sib = path.join(base, 'repos');

function fill(dir, kb) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'blob'), Buffer.alloc(kb * 1024, 1));
}
fill(path.join(root, '.claude', 'worktrees', 'small'), 100);
fill(path.join(root, '.claude', 'worktrees', 'big'), 800);
fill(path.join(root, '.claude', 'worktrees-retired', 'old'), 50);
fill(path.join(tmp, 'beadcause-gate-run-aaa'), 2000);
fill(path.join(tmp, 'beadcause-prfull-bbb'), 1500);
fill(path.join(tmp, 'beadcause-other'), 10);
fill(path.join(tmp, 'unrelated'), 9000);
fill(path.join(sib, 'delmar', '.claude', 'worktrees', 'dw'), 300);
// A real admin dir carrying `locked`, pointed at by big's .git file.
const admin = path.join(base, 'admin-big');
fs.mkdirSync(admin);
fs.writeFileSync(path.join(admin, 'locked'), '');
fs.writeFileSync(path.join(root, '.claude', 'worktrees', 'big', '.git'), `gitdir: ${admin}\n`);

const run = (args, free = '100000000000') =>
  spawnSync('node', [bin, '--root', root, '--tmpdir', tmp, '--siblings', sib, ...args], {
    encoding: 'utf8',
    env: { ...process.env, B7E_SPACE_FREE_BYTES: free },
  });
const snapshot = () => spawnSync('find', [base, '-type', 'f'], { encoding: 'utf8' }).stdout;
const before = snapshot();

const r = run(['--json']);
assert.equal(r.status, 0, r.stderr);
const j = JSON.parse(r.stdout);
const by = Object.fromEntries(j.users.map((u) => [u.label, u]));
assert.equal(by['worktrees'].count, 2);
assert.equal(by['worktrees'].largest[0].name, 'big', 'largest member first');
assert.ok(by['worktrees'].bytes >= 900 * 1024);
assert.equal(by['worktrees'].largest[0].lock, 'locked');
assert.equal(by['worktrees'].largest[1].lock, 'unlocked');
assert.equal(by['worktrees-retired'].count, 1);
assert.equal(by['gate-run folders'].count, 2, 'gate-run and prfull, not unrelated');
assert.equal(by['other beadcause-* in TMPDIR'].count, 1);
assert.equal(by['sibling repos\' worktrees'].count, 1);
const sizes = j.users.map((u) => u.bytes);
assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), 'groups largest first');
assert.equal(j.volumes.length, 2);

const text = run([]).stdout;
assert.match(text, /\[locked\]/);
assert.match(text, /gate-run folders \(2\)/);

assert.equal(run(['--need', 'gate'], String(FLOORS.gate - 1)).status, 1);
assert.equal(run(['--need', 'gate'], String(FLOORS.gate)).status, 0);
assert.equal(run(['--need', 'worktree'], String(FLOORS.worktree - 1)).status, 1);
assert.equal(run(['--need', 'worktree'], String(FLOORS.worktree)).status, 0);
assert.match(run(['--need', 'gate'], '1000').stdout, /DOES NOT FIT/);
assert.equal(run(['--need', '5000'], '4999').status, 1);
assert.equal(run(['--need', '5000'], '5000').status, 0);
assert.equal(run(['--need', 'bogus']).status, 2);
assert.equal(run(['--wat']).status, 2);

assert.equal(snapshot(), before, 'writes nothing');
assert.equal(j.debris, null, 'non-git root: no debris section');

// bc-dgx7.200: debris, on a real git repo.
const gitr = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, a.join(' ') + r.stderr); return r.stdout; };
const repo = path.join(base, 'dbg', 'repo');
fs.mkdirSync(repo, { recursive: true });
gitr(repo, 'init', '-q', '-b', 'main');
gitr(repo, 'config', 'user.email', 't@t');
gitr(repo, 'config', 'user.name', 't');
for (let i = 0; i < 30; i += 1) fs.writeFileSync(path.join(repo, `f${i}`), String(i));
gitr(repo, 'add', '.');
gitr(repo, 'commit', '-qm', 'init');
const W = path.join(repo, '.claude', 'worktrees');
gitr(repo, 'worktree', 'add', '-q', path.join(W, 'healthy'), '-b', 'worktree-healthy');
gitr(repo, 'worktree', 'add', '-q', path.join(W, 'gone'), '-b', 'worktree-gone');
gitr(repo, 'worktree', 'add', '-q', path.join(W, 'half'), '-b', 'worktree-half');
fs.rmSync(path.join(W, 'gone'), { recursive: true });
for (let i = 0; i < 25; i += 1) fs.rmSync(path.join(W, 'half', `f${i}`));
gitr(repo, 'branch', 'worktree-orphan');
gitr(repo, 'checkout', '-q', '-b', 'worktree-orphan-ahead');
fs.writeFileSync(path.join(repo, 'new'), 'x');
gitr(repo, 'add', '.');
gitr(repo, 'commit', '-qm', 'ahead');
gitr(repo, 'checkout', '-q', 'main');
const dargs = ['--root', repo, '--tmpdir', tmp, '--siblings', path.join(base, 'dbg')];
const denv = (free) => ({ ...process.env, B7E_SPACE_FREE_BYTES: free });
const dr = spawnSync('node', [bin, ...dargs, '--json'], { encoding: 'utf8', env: denv('100000000000') });
assert.equal(dr.status, 0, dr.stderr);
const d = JSON.parse(dr.stdout).debris;
// worktree-gone is registered (so not an orphan) but its directory is missing.
assert.deepEqual(d.orphanBranches.map((b) => b.branch).sort(), ['worktree-orphan', 'worktree-orphan-ahead']);
assert.equal(d.orphanBranches.find((b) => b.branch === 'worktree-orphan-ahead').unmerged, 1);
assert.equal(d.orphanBranches.find((b) => b.branch === 'worktree-orphan').unmerged, 0);
assert.equal(d.missing.length, 1);
assert.match(d.missing[0].path, /gone$/);
assert.equal(d.partial.length, 1);
assert.match(d.partial[0].path, /half$/);
const dt = spawnSync('node', [bin, ...dargs], { encoding: 'utf8', env: denv('100000000000') }).stdout;
assert.match(dt, /debris \(4\)/);
assert.match(dt, /branch with no directory: worktree-orphan-ahead {2}\(1 commit not on main\)/);
assert.match(dt, /worktree directory missing\/prunable/);
assert.match(dt, /half-checked-out worktree/);
assert.equal(spawnSync('node', [bin, ...dargs, '--need', 'gate'], { encoding: 'utf8', env: denv('100000000000') }).status, 1 - 1, 'debris alone exits 0');
assert.equal(spawnSync('node', [bin, ...dargs, '--need', 'gate'], { encoding: 'utf8', env: denv('1000') }).status, 1, 'only fit sets exit 1');
fs.rmSync(base, { recursive: true, force: true });
console.log('ok test/b7espace.mjs');
