#!/usr/bin/env node
/**
 * `b7e-salvage` — a dead attempt's worktree, read from the inside: what it holds
 * uncommitted, and whether anybody is still in it. lib/salvage.js and bin/b7e-salvage.
 *
 *     npm test
 *     node test/b7esalvage.mjs
 *
 * bc-dgx7.134's own acceptance criteria, replayed against one real throwaway repo with
 * three worktrees for one bead — a retired one, one held by a dead lock and carrying
 * staged + unstaged + untracked content, one occupied by a live session — plus a fake
 * `bd`. Real `git worktree add`/`lock`/`move` throughout, same argument test/siblings.mjs
 * and test/b7eprior.mjs make: the whole point is what `git status`, `git diff` and
 * `git worktree list --porcelain` actually report, not strings this file wrote by hand.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-salvage');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7esalvage-'));
process.on('exit', () => removeTreeSync(tmp));

const { salvageFor, lockPidOf, uncommittedDiff } = await import(path.join(ROOT, 'lib', 'salvage.js'));

/* -------------------------------------------------------------------- the repo */

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@e' },
  }).trim();

const origin = path.join(tmp, 'origin.git');
const REPO = path.join(tmp, 'repo');
git(tmp, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
git(tmp, 'clone', '--quiet', origin, REPO);
git(REPO, 'config', 'user.email', 't@e');
git(REPO, 'config', 'user.name', 'test');
fs.mkdirSync(path.join(REPO, 'lib'), { recursive: true });
fs.writeFileSync(path.join(REPO, 'lib', 'tracked.js'), 'export const one = 1;\n');
fs.writeFileSync(path.join(REPO, 'lib', 'other.js'), 'export const two = 2;\n');
git(REPO, 'add', '-A');
git(REPO, 'commit', '--quiet', '-m', 'root');
git(REPO, 'push', '--quiet', '-u', 'origin', 'main');

/** Backdates every file under `dir` so `lastTouched` reads it as long quiet. */
function backdate(dir, minutesAgo) {
  const at = new Date(Date.now() - minutesAgo * 60000);
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const full = path.join(p, e.name);
      fs.utimesSync(full, at, at);
      if (e.isDirectory()) walk(full);
    }
  };
  walk(dir);
  fs.utimesSync(dir, at, at);
}

// The bead this fixture is all for: `worktree-<name>-<tag>` owns it when `<tag>` is
// everything after the bead id's first dash, alnum-only, lowercased — lib/notinmain.js's
// `tagOf`/`ownsBranch`, which lib/prior.js's `branchesFor` already relies on.
const BEAD = 'ws-salv1';
const TAG = 'salv1';

/** A retired worktree — pushed, clean, moved into the attic. */
const retiredBranch = `worktree-old-attempt-${TAG}`;
const retiredLive = path.join(REPO, '.claude', 'worktrees', 'old-attempt');
git(REPO, 'worktree', 'add', '--quiet', '-b', retiredBranch, retiredLive, 'main');
fs.writeFileSync(path.join(retiredLive, 'lib', 'retired-work.js'), 'export const done = true;\n');
git(retiredLive, 'add', '-A');
git(retiredLive, 'commit', '--quiet', '-m', 'retired: finished');
git(REPO, 'push', '--quiet', 'origin', retiredBranch);
const retiredRoot = path.join(REPO, '.claude', 'worktrees-retired');
fs.mkdirSync(retiredRoot, { recursive: true });
const retiredDest = path.join(retiredRoot, 'old-attempt');
git(REPO, 'worktree', 'move', retiredLive, retiredDest);

// A dead-locked worktree, carrying staged + unstaged + untracked content — the "attempt
// 1 died mid-edit" shape every session this bead was filed over hand-rolled a check for.
const deadBranch = `worktree-dead-attempt-${TAG}`;
const deadDir = path.join(REPO, '.claude', 'worktrees', 'dead-attempt');
git(REPO, 'worktree', 'add', '--quiet', '-b', deadBranch, deadDir, 'main');
fs.writeFileSync(path.join(deadDir, 'lib', 'tracked.js'), 'export const one = 1;\nexport const staged = true;\n');
git(deadDir, 'add', '-A'); // staged
fs.writeFileSync(path.join(deadDir, 'lib', 'other.js'), 'export const two = 2;\nexport const unstaged = true;\n'); // unstaged
fs.writeFileSync(path.join(deadDir, 'lib', 'newfile.js'), 'export const brandNew = true;\n'); // untracked
git(REPO, 'worktree', 'lock', deadDir, '--reason', 'claude session dead-attempt (pid 999999 start Mon Jan  1 00:00:00 2026)');
backdate(deadDir, 20); // well past QUIET_MINUTES (10)

// A live worktree — this test process's own pid, both locking it and matching a fake
// live-session record, same as test/siblings.mjs's own "live session" fixture.
const liveBranch = `worktree-live-attempt-${TAG}`;
const liveDir = path.join(REPO, '.claude', 'worktrees', 'live-attempt');
git(REPO, 'worktree', 'add', '--quiet', '-b', liveBranch, liveDir, 'main');
fs.writeFileSync(path.join(liveDir, 'lib', 'tracked.js'), 'export const one = 1;\nexport const inProgress = true;\n');
git(REPO, 'worktree', 'lock', liveDir, '--reason', `claude session live-attempt (pid ${process.pid} start Mon Jan  1 00:00:00 2026)`);
backdate(liveDir, 20); // old mtime too — occupancy, not recency, must be what makes it not frozen

const sessionsDir = path.join(tmp, 'sessions');
fs.mkdirSync(sessionsDir, { recursive: true });
fs.writeFileSync(
  path.join(sessionsDir, `${process.pid}.json`),
  JSON.stringify({ pid: process.pid, sessionId: 's1', name: 'Beadcause - ws-salv1 b7e-salvage', cwd: liveDir, status: 'busy' })
);

/* ---------------------------------------------------------------------- fake bd */

const FAKE_BD = path.join(tmp, 'bd');
fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const args = process.argv.slice(2);
const die = (m) => { process.stderr.write(m + '\\n'); process.exit(1); };
const KNOWN = new Set([${JSON.stringify(BEAD)}, 'ws-nobody-1']);
if (args[0] === 'show') {
  const id = args[1];
  if (!KNOWN.has(id)) die('Error fetching ' + id + ': no issue found matching "' + id + '"');
  process.stdout.write(JSON.stringify([{ id, title: 'A dead attempt worth salvaging', status: 'open', issue_type: 'task', priority: 2, assignee: '', parent: null }]));
  process.exit(0);
}
die('stub bd: unexpected verb "' + args[0] + '"');
`,
  { mode: 0o755 }
);

/* -------------------------------------------------------------------- config */

const configDir = path.join(tmp, 'config');
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(
  path.join(configDir, 'config.json'),
  JSON.stringify(
    {
      bdBin: FAKE_BD,
      actor: 'beadcause-test',
      workspaces: [{ name: 'salv-ws', dir: path.join(tmp, 'tracker') }],
      sessionDirs: { 'salv-ws': REPO },
      claudeSessionsDir: sessionsDir,
    },
    null,
    2
  )
);
fs.mkdirSync(path.join(tmp, 'tracker'), { recursive: true });

function run(args) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    env: { ...process.env, HOME: tmp, BEADCAUSE_CONFIG_DIR: configDir },
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/* ------------------------------------------------------------------- harness */

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 12).join('\n       ')}`);
  }
};
const acheck = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 12).join('\n       ')}`);
  }
};

console.log('\nb7e-salvage\n');

/* ------------------------------------------------------------------- lib unit */

check('lockPidOf reads the pid out of either writer this repo has', () => {
  assert.equal(lockPidOf('claude session foo (pid 43026 start Fri Sep 18 14:49:09 2026)'), 43026);
  assert.equal(lockPidOf('resolver pid 83789 #767'), 83789);
  assert.equal(lockPidOf('claude session foo'), null, 'no pid named — cannot tell, not zero');
  assert.equal(lockPidOf(''), null);
  assert.equal(lockPidOf(null), null);
});

await acheck('uncommittedDiff includes tracked changes and untracked content, no index write', async () => {
  const statusBefore = git(deadDir, 'status', '--porcelain');
  const patch = await uncommittedDiff(deadDir);
  assert.match(patch, /staged = true/);
  assert.match(patch, /unstaged = true/);
  assert.match(patch, /brandNew = true/);
  assert.match(patch, /newfile\.js/);
  const statusAfter = git(deadDir, 'status', '--porcelain');
  assert.equal(statusAfter, statusBefore, 'reading the diff must not change git status — no add -N');
});

await acheck('uncommittedDiff scoped to one path only carries that file', async () => {
  const patch = await uncommittedDiff(deadDir, { scope: 'lib/newfile.js' });
  assert.match(patch, /brandNew = true/);
  assert.doesNotMatch(patch, /staged = true/);
  assert.doesNotMatch(patch, /unstaged = true/);
});

await acheck('salvageFor: acceptance — right directory, untracked reported, dead-lock frozen, live occupied, main absent', async () => {
  const cfg = { claudeSessionsDir: sessionsDir };
  const found = await salvageFor(REPO, BEAD, { cfg });
  assert.equal(found.worktrees.length, 3, 'retired + dead-locked + live, nothing else');

  const dead = found.worktrees.find((w) => w.branch === deadBranch);
  assert.ok(dead, 'the dead-locked worktree is found');
  assert.equal(fs.realpathSync(dead.path), fs.realpathSync(deadDir), 'names the right directory from the bead id alone');
  assert.equal(dead.locked, true);
  assert.equal(dead.lockPid, 999999);
  assert.equal(dead.lockPidAlive, false, 'ps does not know this pid');
  assert.equal(dead.session, null);
  assert.equal(dead.occupied, false, 'a dead lock is not occupancy');
  assert.equal(dead.frozen, true, 'unoccupied and long unmoved');
  const untrackedRows = dead.status.filter((s) => s.code === '??');
  assert.ok(
    untrackedRows.some((s) => s.path === 'lib/newfile.js'),
    'an untracked file — invisible to any git log view — is on the status list'
  );
  assert.ok(dead.status.some((s) => s.path === 'lib/tracked.js'), 'the staged file is reported too');
  assert.ok(dead.status.some((s) => s.path === 'lib/other.js'), 'the unstaged file is reported too');

  const live = found.worktrees.find((w) => w.branch === liveBranch);
  assert.ok(live, 'the live worktree is found');
  assert.equal(live.occupied, true, 'a live session cwd inside it counts as occupied');
  assert.equal(live.frozen, false, 'occupied overrides an old mtime');
  assert.equal(live.session.pid, process.pid);

  const retiredRow = found.worktrees.find((w) => w.branch === retiredBranch);
  assert.ok(retiredRow, 'the retired worktree still answers');
  assert.equal(retiredRow.state, 'retired');

  assert.ok(
    !found.worktrees.some((w) => fs.realpathSync(w.path) === fs.realpathSync(REPO)),
    'the main checkout is never among the rows'
  );
});

await acheck('a bead nobody has a worktree for reports nothing, not an error', async () => {
  const found = await salvageFor(REPO, 'ws-nobody-1', { cfg: {} });
  assert.deepEqual(found.worktrees, []);
});

/* --------------------------------------------------------------------- CLI */

check('--help prints usage and exits 0', () => {
  const { status, stdout } = run(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /usage: b7e-salvage/);
});

check('a missing -w is refused', () => {
  const { status, stderr } = run(['-b', BEAD]);
  assert.notEqual(status, 0);
  assert.match(stderr, /-w\/--workspace is required/);
});

check('an unknown bead is refused, not reported as untouched', () => {
  const { status, stderr } = run(['-w', 'salv-ws', '-b', 'ws-nope']);
  assert.notEqual(status, 0);
  assert.match(stderr, /no bead ws-nope/);
});

check('the printed report names both the dead-locked and the live worktree, and calls each correctly', () => {
  const { status, stdout } = run(['-w', 'salv-ws', '-b', BEAD]);
  assert.equal(status, 0);
  assert.match(stdout, new RegExp(deadBranch));
  assert.match(stdout, new RegExp(liveBranch));
  assert.match(stdout, /not occupied.*999999/);
  assert.match(stdout, /frozen/);
  assert.match(stdout, new RegExp(`occupied — live session pid ${process.pid}`));
  assert.match(stdout, /lib\/newfile\.js/);
  assert.doesNotMatch(stdout, /^main\b/m);
});

check('a bead with no worktree says so in one line and exits 0', () => {
  const { status, stdout } = run(['-w', 'salv-ws', '-b', 'ws-nobody-1']);
  assert.equal(status, 0);
  assert.match(stdout, /no worktree owns this bead/);
});

check('--json emits parseable, structurally complete output with no diff field by default', () => {
  const { status, stdout } = run(['-w', 'salv-ws', '-b', BEAD, '--json']);
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.workspace, 'salv-ws');
  assert.equal(parsed.id, BEAD);
  const dead = parsed.worktrees.find((w) => w.branch === deadBranch);
  assert.ok(dead);
  assert.equal(dead.diff, null, 'no --diff means no patch computed');
});

check('--diff emits an applicable patch covering staged, unstaged and untracked content', () => {
  const { status, stdout } = run(['-w', 'salv-ws', '-b', BEAD, '--diff', '--json']);
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  const dead = parsed.worktrees.find((w) => w.branch === deadBranch);
  assert.match(dead.diff, /staged = true/);
  assert.match(dead.diff, /unstaged = true/);
  assert.match(dead.diff, /brandNew = true/);
});

check('--diff <path> scopes every worktree block to that one file', () => {
  const { status, stdout } = run(['-w', 'salv-ws', '-b', BEAD, '--diff', 'lib/newfile.js', '--json']);
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  const dead = parsed.worktrees.find((w) => w.branch === deadBranch);
  assert.match(dead.diff, /brandNew = true/);
  assert.doesNotMatch(dead.diff, /staged = true/);
});

check('running the command, with or without --diff, writes nothing to the worktree it reads', () => {
  const before = git(deadDir, 'status', '--porcelain');
  run(['-w', 'salv-ws', '-b', BEAD, '--diff']);
  const after = git(deadDir, 'status', '--porcelain');
  assert.equal(after, before);
});

/* --------------------------------------------- bc-dgx7.173: discovery, counts, patches */

// A worktree whose name and branch share nothing with the bead (the lm-gr6.36 shape),
// holding a staged-only new file no commit has.
const oddDir = path.join(REPO, '.claude', 'worktrees', 'entry-rules-sweep-p4m');
git(REPO, 'worktree', 'add', '--quiet', '-b', 'worktree-entry-rules-sweep-p4m', oddDir, 'main');
fs.mkdirSync(path.join(oddDir, 'audits'), { recursive: true });
fs.writeFileSync(path.join(oddDir, 'audits', 'SWEEP.md'), 'line one\nline two\nline three\n');
git(oddDir, 'add', 'audits/SWEEP.md');
fs.writeFileSync(path.join(oddDir, 'lib', 'tracked.js'), 'export const one = 1;\nexport const a = 1;\nexport const b = 2;\n');
backdate(oddDir, 20);

// A clean worktree with one commit off main naming the bead: the commit trail.
const trailDir = path.join(REPO, '.claude', 'worktrees', 'trail-only');
git(REPO, 'worktree', 'add', '--quiet', '-b', 'worktree-trail-only', trailDir, 'main');
fs.writeFileSync(path.join(trailDir, 'lib', 'trail.js'), 'export const t = 1;\n');
git(trailDir, 'add', '-A');
git(trailDir, 'commit', '--quiet', '-m', `${BEAD}: work with no tag in its branch name`);

// A clean worktree, nothing off main.
const cleanDir = path.join(REPO, '.claude', 'worktrees', 'clean-wt');
git(REPO, 'worktree', 'add', '--quiet', '-b', 'worktree-clean-wt', cleanDir, 'main');
backdate(cleanDir, 20);

const cfg2 = { claudeSessionsDir: sessionsDir };

await acheck('a worktree sharing nothing with the bead id is not found without --all or a name', async () => {
  const found = await salvageFor(REPO, BEAD, { cfg: cfg2 });
  assert.ok(!found.worktrees.some((w) => w.branch === 'worktree-entry-rules-sweep-p4m'));
});

await acheck('the commit trail finds a worktree whose branch name does not carry the tag', async () => {
  const found = await salvageFor(REPO, BEAD, { cfg: cfg2 });
  const w = found.worktrees.find((x) => x.branch === 'worktree-trail-only');
  assert.ok(w, 'found by the commit off main naming the bead');
  assert.match(w.found, /commit off main/);
  assert.equal(w.ahead, 1);
  assert.match(w.where, /local branch only/);
});

await acheck('a worktree resolves by directory name or by branch name', async () => {
  const byDir = await salvageFor(REPO, BEAD, { cfg: cfg2, names: ['entry-rules-sweep-p4m'] });
  const byBranch = await salvageFor(REPO, BEAD, { cfg: cfg2, names: ['worktree-entry-rules-sweep-p4m'] });
  for (const f of [byDir, byBranch]) assert.ok(f.worktrees.some((w) => w.branch === 'worktree-entry-rules-sweep-p4m'));
});

await acheck('staged-only files are their own group, with +/- counts from the index', async () => {
  const found = await salvageFor(REPO, BEAD, { cfg: cfg2, names: ['entry-rules-sweep-p4m'] });
  const w = found.worktrees.find((x) => x.branch === 'worktree-entry-rules-sweep-p4m');
  assert.deepEqual(w.stagedOnly, ['audits/SWEEP.md']);
  const row = w.status.find((s) => s.path === 'audits/SWEEP.md');
  assert.equal(row.stagedAdded, 3);
  const mod = w.status.find((s) => s.path === 'lib/tracked.js');
  assert.equal(mod.added, 2, 'a modified file carries its added lines against HEAD');
  assert.equal(mod.deleted, 0);
  assert.equal(w.added, 5);
});

await acheck('--all sweeps every worktree but the main checkout', async () => {
  const found = await salvageFor(REPO, BEAD, { cfg: cfg2, all: true });
  assert.ok(found.worktrees.length >= 6);
  assert.ok(found.worktrees.some((w) => w.found === '--all' && w.branch === 'worktree-clean-wt'));
  assert.ok(!found.worktrees.some((w) => fs.realpathSync(w.path) === fs.realpathSync(REPO)));
});

await acheck('a clean tree everywhere gets an explicit negative verdict', async () => {
  const found = await salvageFor(REPO, BEAD, { cfg: cfg2, names: ['clean-wt'], hints: '' }).then((f) => ({
    ...f,
    worktrees: f.worktrees.filter((w) => w.branch === 'worktree-clean-wt'),
  }));
  assert.equal(found.worktrees[0].where, 'nothing — clean, no commit off main');
});

check('CLI: the negative verdict prints and exits 0 for a clean worktree', () => {
  const { status, stdout } = run(['-w', 'salv-ws', '-b', 'ws-nobody-1', '--worktree', 'clean-wt', '--no-pr']);
  assert.equal(status, 0);
  assert.match(stdout, /nothing to salvage/);
});

check('CLI: --patch-dir writes one patch per dirty worktree holding a staged-only file in full', () => {
  const out = path.join(tmp, 'patches');
  const before = git(oddDir, 'status', '--porcelain');
  const { status, stdout } = run(['-w', 'salv-ws', '-b', BEAD, '--worktree', 'entry-rules-sweep-p4m', '--patch-dir', out, '--no-pr']);
  assert.equal(status, 0);
  assert.match(stdout, /STAGED ONLY/);
  assert.match(stdout, /audits\/SWEEP\.md/);
  const patch = fs.readFileSync(path.join(out, `${BEAD}-entry-rules-sweep-p4m.patch`), 'utf8');
  assert.match(patch, /line one/);
  assert.match(patch, /line three/);
  assert.equal(fs.existsSync(path.join(out, `${BEAD}-clean-wt.patch`)), false, 'no patch for a clean tree');
  assert.equal(git(oddDir, 'status', '--porcelain'), before, 'reading wrote nothing to the tree');
});

console.log(`\n${failures ? `\x1b[31m${failures} failed\x1b[0m` : '\x1b[32mall passed\x1b[0m'}\n`);
process.exit(failures ? 1 : 0);
