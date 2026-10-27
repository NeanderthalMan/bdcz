#!/usr/bin/env node
/**
 * `b7e-builder` — is a worktree still being written to, or is it safe to take over?
 * lib/builder.js and bin/b7e-builder.
 *
 *     npm test
 *     node test/builder.mjs
 *
 * bc-xl7n.158's own acceptance criteria, replayed: a worktree with a live writer (files
 * changed within `--since` minutes, nothing committed yet) reports `still-writing`; a
 * worktree whose last writer's session is idle (transcript quiet for hours, tree clean)
 * reports `idle`; a worktree with no live session reports `abandoned`; nothing here
 * mutates anything; and a session found only by `cwd` — with no bead id anywhere on its
 * command line, the interactively-started-`claude` case — still counts as a live writer.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-builder');
const LIB = (name) => path.join(ROOT, 'lib', name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-builder-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const {
  parseWorktreeRows,
  lockPid,
  alive,
  resolveWorktree,
  sessionsIn,
  verdictFor,
  newestWrite,
  aheadBehind,
  statusCounts,
  listWorktrees,
  buildReport,
} = await import(LIB('builder.js'));

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
}

console.log('\nb7e-builder — is a worktree still being written to, or safe to take over\n');

/* --------------------------------------------------------------- parseWorktreeRows */

const PORCELAIN = [
  'worktree /repo',
  'HEAD abc123',
  'branch refs/heads/main',
  '',
  'worktree /repo/.claude/worktrees/thing',
  'HEAD def456',
  'branch refs/heads/worktree-thing',
  'locked claude session thing (pid 12345 start Fri Sep 18 16:55:35 2026)',
  '',
  'worktree /repo/.claude/worktrees/detached-one',
  'HEAD 789abc',
  'detached',
  '',
].join('\n');

await check('parseWorktreeRows reads path, branch, lock reason and detached state', () => {
  const rows = parseWorktreeRows(PORCELAIN);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { path: '/repo', branch: 'main', detached: false, locked: false, lockReason: '' });
  assert.equal(rows[1].branch, 'worktree-thing');
  assert.equal(rows[1].locked, true);
  assert.equal(rows[1].lockReason, 'claude session thing (pid 12345 start Fri Sep 18 16:55:35 2026)');
  assert.equal(rows[2].detached, true);
  assert.equal(rows[2].locked, false);
});

await check('parseWorktreeRows on empty/garbage input is an empty list, not a crash', () => {
  assert.deepEqual(parseWorktreeRows(''), []);
  assert.deepEqual(parseWorktreeRows('nonsense\nlines\n'), []);
});

/* ------------------------------------------------------------------------- lockPid */

await check('lockPid extracts the pid from a real lock reason', () => {
  assert.equal(lockPid('claude session thing (pid 12345 start Fri Sep 18 16:55:35 2026)'), 12345);
  assert.equal(lockPid('resolver pid 83789 #767'), 83789);
});

await check('lockPid is null when the reason names no pid', () => {
  assert.equal(lockPid('taken by hand, no pid recorded'), null);
  assert.equal(lockPid(''), null);
  assert.equal(lockPid(undefined), null);
});

/* --------------------------------------------------------------------------- alive */

await check('alive is true for this process, false for a pid that cannot exist', () => {
  assert.equal(alive(process.pid), true);
  assert.equal(alive(999999999), false);
  assert.equal(alive(0), false);
  assert.equal(alive(-1), false);
});

/* --------------------------------------------------------------------- resolveWorktree */

const rows = parseWorktreeRows(PORCELAIN);

await check('resolveWorktree matches by directory basename', () => {
  const r = resolveWorktree(rows, 'thing');
  assert.equal(r.path, '/repo/.claude/worktrees/thing');
});

await check('resolveWorktree matches by branch name', () => {
  const r = resolveWorktree(rows, 'worktree-thing');
  assert.equal(r.path, '/repo/.claude/worktrees/thing');
});

await check('resolveWorktree returns null when nothing matches', () => {
  assert.equal(resolveWorktree(rows, 'no-such-worktree'), null);
});

await check('resolveWorktree with an existing path wins outright, even one git does not know', () => {
  const r = resolveWorktree(rows, tmp, { exists: () => true });
  assert.equal(r.unregistered, true);
  assert.equal(fs.realpathSync(r.path), fs.realpathSync(tmp));
});

await check('resolveWorktree with an existing path that IS a known worktree returns the real row', () => {
  const known = [{ path: tmp, branch: 'feature', detached: false, locked: false, lockReason: '' }];
  const r = resolveWorktree(known, tmp, { exists: () => true });
  assert.equal(r.branch, 'feature');
  assert.equal(r.unregistered, undefined);
});

/* ------------------------------------------------------------------------- sessionsIn */

await check('sessionsIn keeps a session whose cwd is the worktree itself or a subdirectory', () => {
  const sessions = [
    { pid: 1, cwd: '/repo/.claude/worktrees/thing' },
    { pid: 2, cwd: '/repo/.claude/worktrees/thing/lib' },
    { pid: 3, cwd: '/repo/.claude/worktrees/other' },
    { pid: 4, cwd: '/repo/.claude/worktrees/thing-longer-name' },
  ];
  const rows2 = sessionsIn(sessions, '/repo/.claude/worktrees/thing');
  assert.deepEqual(
    rows2.map((s) => s.pid),
    [1, 2]
  );
});

await check('sessionsIn finds a session with no bead id anywhere in it — matched by cwd alone', () => {
  // The acceptance-criteria case: an interactively-started claude, no worker brief, no
  // argv at all in the session record — cwd is the only thing that ties it to the tree.
  const sessions = [{ pid: 9, cwd: '/repo/.claude/worktrees/thing', name: '' }];
  assert.deepEqual(
    sessionsIn(sessions, '/repo/.claude/worktrees/thing').map((s) => s.pid),
    [9]
  );
});

/* -------------------------------------------------------------------------- verdictFor */

await check('no live sessions: abandoned, whatever the tree looks like', () => {
  const v = verdictFor({ sessions: [], newest: { path: 'x', mtimeMs: Date.now() }, sinceMs: 900000 });
  assert.equal(v.verdict, 'abandoned');
});

await check('a busy session is still-writing outright, even with no recent file write', () => {
  const v = verdictFor({
    sessions: [{ pid: 1, status: 'busy' }],
    newest: { path: 'x', mtimeMs: Date.now() - 999999999 },
    sinceMs: 900000,
  });
  assert.equal(v.verdict, 'still-writing');
});

await check('files changed within --since minutes, live session idle: still-writing', () => {
  const now = Date.now();
  const v = verdictFor({
    sessions: [{ pid: 1, status: 'idle' }],
    newest: { path: 'src.js', mtimeMs: now - 60000 }, // 1 minute ago
    sinceMs: 15 * 60000, // 15-minute window
    now,
  });
  assert.equal(v.verdict, 'still-writing');
});

await check('idle session, transcript/tree quiet for hours: idle', () => {
  const now = Date.now();
  const v = verdictFor({
    sessions: [{ pid: 1, status: 'idle' }],
    newest: { path: 'src.js', mtimeMs: now - 4 * 3600000 }, // 4 hours ago
    sinceMs: 15 * 60000,
    now,
  });
  assert.equal(v.verdict, 'idle');
});

await check('idle session, no files at all: idle, not a crash', () => {
  const v = verdictFor({ sessions: [{ pid: 1, status: 'idle' }], newest: null, sinceMs: 900000 });
  assert.equal(v.verdict, 'idle');
});

/* ------------------------------------------------------------------------- newestWrite */

await check('newestWrite finds the most recently written file and skips .git/node_modules', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'nw-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'x');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'pkg.js'), 'x');
  fs.utimesSync(path.join(dir, '.git', 'HEAD'), new Date(), new Date());
  fs.utimesSync(path.join(dir, 'node_modules', 'pkg.js'), new Date(), new Date());

  const old = new Date(Date.now() - 3600000);
  fs.writeFileSync(path.join(dir, 'old.js'), 'x');
  fs.utimesSync(path.join(dir, 'old.js'), old, old);

  fs.mkdirSync(path.join(dir, 'sub'));
  const fresh = new Date();
  fs.writeFileSync(path.join(dir, 'sub', 'new.js'), 'x');
  fs.utimesSync(path.join(dir, 'sub', 'new.js'), fresh, fresh);

  const n = newestWrite(dir);
  assert.equal(n.path, path.join('sub', 'new.js'));
});

await check('newestWrite on an empty tree is null', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'empty-'));
  assert.equal(newestWrite(dir), null);
});

/* --------------------------------------------------------- real git fixture: a repo + worktree */

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo, { recursive: true });
git(repo, ['init', '-q', '-b', 'main']);
git(repo, ['config', 'user.email', 'test@example.com']);
git(repo, ['config', 'user.name', 'test']);
fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
git(repo, ['add', '.']);
git(repo, ['commit', '-q', '-m', 'initial']);

const wt = path.join(tmp, 'wt-feature');
git(repo, ['worktree', 'add', '-q', '-b', 'feature', wt]);

await check('listWorktrees sees every worktree of the repo, run from any of them', async () => {
  const fromRepo = await listWorktrees(repo);
  const fromWt = await listWorktrees(wt);
  assert.equal(fromRepo.length, 2);
  assert.equal(fromWt.length, 2);
  assert.ok(fromWt.some((r) => path.basename(r.path) === 'wt-feature'));
});

await check('aheadBehind counts real commits both ways', async () => {
  fs.writeFileSync(path.join(wt, 'a.txt'), 'a\n');
  git(wt, ['add', '.']);
  git(wt, ['commit', '-q', '-m', 'feature commit']);
  const ab = await aheadBehind(wt, 'main');
  assert.equal(ab.ahead, 1);
  assert.equal(ab.behind, 0);
});

await check('statusCounts separates modified from untracked', async () => {
  fs.appendFileSync(path.join(wt, 'a.txt'), 'more\n');
  fs.writeFileSync(path.join(wt, 'b.txt'), 'new\n');
  const c = await statusCounts(wt);
  assert.equal(c.modified, 1);
  assert.equal(c.untracked, 1);
});

await check('statusCounts on a clean tree is 0/0', async () => {
  git(wt, ['add', '.']);
  git(wt, ['commit', '-q', '-m', 'clean it up']);
  const c = await statusCounts(wt);
  assert.equal(c.modified, 0);
  assert.equal(c.untracked, 0);
});

/* --------------------------------------------------------------------------- the CLI */

const sessDir = path.join(tmp, 'sessions');
fs.mkdirSync(sessDir, { recursive: true });
fs.writeFileSync(
  path.join(process.env.BEADCAUSE_CONFIG_DIR, 'config.json'),
  JSON.stringify({ claudeSessionsDir: sessDir }, null, 2)
);

function writeSession(pid, cwd, status, statusUpdatedAt) {
  fs.writeFileSync(
    path.join(sessDir, `${pid}.json`),
    JSON.stringify({ pid, cwd, status, sessionId: `sid-${pid}`, statusUpdatedAt, startedAt: statusUpdatedAt })
  );
}

const run = (args, cwd = repo) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd, env: process.env });

await check('usage: a worktree name or path is required, exit 2', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /a worktree name or path is required/);
});

await check('an unknown worktree exits 3', () => {
  const r = run(['no-such-thing']);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /names no worktree/);
});

await check('no live session on the worktree: abandoned, exit 0', () => {
  const r = run(['wt-feature']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /verdict: abandoned/);
});

await check('a live busy session on the worktree: still-writing, exit 1', () => {
  writeSession(process.pid, wt, 'busy', Date.now());
  const r = run(['wt-feature']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /verdict: still-writing/);
  fs.rmSync(path.join(sessDir, `${process.pid}.json`));
});

await check('a live idle session with an old tree: idle, exit 0', () => {
  writeSession(process.pid, wt, 'idle', Date.now());
  const r = run(['wt-feature', '--since', '0']);
  // --since 0: nothing can be "within the window" except a write at this exact instant,
  // so an idle live session here is reported idle even though the tree was touched
  // moments ago in the fixture above.
  assert.equal(r.status, 0);
  assert.match(r.stdout, /verdict: idle/);
  fs.rmSync(path.join(sessDir, `${process.pid}.json`));
});

await check('--json is machine-readable and carries the same verdict', () => {
  writeSession(process.pid, wt, 'busy', Date.now());
  const r = run(['wt-feature', '--json']);
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, 'still-writing');
  assert.equal(out.sessions[0].pid, process.pid);
  fs.rmSync(path.join(sessDir, `${process.pid}.json`));
});

await check('a path argument works even for a worktree given by absolute path', () => {
  const r = run([wt]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /verdict: abandoned/);
});

await check('--since must be a non-negative number', () => {
  const r = run(['wt-feature', '--since', 'nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--since must be a non-negative number/);
});

/* -------------------------------------------------------------------- buildReport (lib) */

await check('buildReport end-to-end matches the CLI shape, called directly', async () => {
  const cfg = { claudeSessionsDir: sessDir };
  const report = await buildReport(cfg, 'wt-feature', { cwd: repo });
  assert.equal(report.found, true);
  assert.equal(report.verdict, 'abandoned');
  assert.equal(report.behind, 0);
});

await check('buildReport reports found:false for an unknown argument', async () => {
  const cfg = { claudeSessionsDir: sessDir };
  const report = await buildReport(cfg, 'nope-nope', { cwd: repo });
  assert.equal(report.found, false);
});

/* -------------------------------------------------------------------------- summary */

console.log(`\n${ran - failures}/${ran} ok\n`);
await cleanupTmp(tmp);
process.exitCode = failures ? 1 : 0;
