#!/usr/bin/env node
/**
 * `b7e-taken` — is this command name free? lib/taken.js and bin/b7e-taken.
 *
 *     npm test
 *     node test/b7etaken.mjs
 *
 * bc-dgx7.135's own acceptance is replayed here, against a real throwaway git repo
 * (worktrees and a pushed branch included) and a fake `gh`/`bd`, the same fixture shape
 * test/b7eprior.mjs uses for the same reason: every claim site here is either a real git
 * fact or a real filesystem fact, and faking the process rather than the data is the only
 * way to prove the seven checks against a tree they cannot see coming.
 *
 * Six shapes, one per claim site plus the two that tie them together:
 *
 * 1. **Already on `origin/main`** — and the point of the whole suite is here: once a name
 *    is shared truth, every live worktree in this fixture also has the file, purely
 *    because each one branched from main after it landed. A caller enumerating all of
 *    them as "claimants" would be noise dressed as sixteen separate warnings. This proves
 *    the short-circuit in `lib/taken.js`: `origin/main` reports once and nothing else.
 * 2. **Not yet on main, but an open pull request's head branch already has it** — the
 *    `bc-dgx7.126` shape (PR #841, worktree live), found by a file check on the branch's
 *    own tree rather than a text search of the PR's title or body.
 * 3. **Not yet on main, only a live worktree has it — and only uncommitted** — the
 *    `two-skill-beads-can-claim-the-same-b7e-name` shape: 457 lines sitting in a
 *    worktree with no branch commit at all. Only reading the directory finds this.
 * 4. **Named only by an open bead** — and a *closed* bead naming the same word must not
 *    count, since a closed proposal is not a live claim.
 * 5. **Registered and documented, but nowhere else** — package.json + package-lock.json
 *    (checked as one claim) and a heading in `docs/*.md` (not `README.md` alone, since
 *    this repo's own `b7e-*` surface lives in `docs/b7e/<name>.md`, one file per tool).
 * 6. **Nothing anywhere** — one line, exit 0.
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
const BIN = path.join(ROOT, 'bin', 'b7e-taken');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7etaken-'));
process.on('exit', () => removeTreeSync(tmp));

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

/** Base tree every claim site reads from: an empty registry and one doc file. */
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
writeJson(path.join(REPO, 'package.json'), { name: 'fixture', bin: {} });
writeJson(path.join(REPO, 'package-lock.json'), { packages: { '': { bin: {} } } });
fs.writeFileSync(path.join(REPO, 'README.md'), '# fixture\n');
fs.mkdirSync(path.join(REPO, 'docs'));
fs.writeFileSync(path.join(REPO, 'docs', 'tools.md'), '# tools\n');
fs.mkdirSync(path.join(REPO, 'bin'));
git(REPO, 'add', '-A');
git(REPO, 'commit', '--quiet', '-m', 'root');
git(REPO, 'push', '--quiet', '-u', 'origin', 'main');

/** Add a name to bin/, the two registrations and a docs heading, and land it on main. */
function landOnMain(name) {
  fs.writeFileSync(path.join(REPO, 'bin', name), '#!/usr/bin/env node\n');
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  pkg.bin[name] = `bin/${name}`;
  writeJson(path.join(REPO, 'package.json'), pkg);
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'package-lock.json'), 'utf8'));
  lock.packages[''].bin[name] = `bin/${name}`;
  writeJson(path.join(REPO, 'package-lock.json'), lock);
  fs.appendFileSync(path.join(REPO, 'docs', 'tools.md'), `\n### Does a thing — \`${name}\`\n`);
  git(REPO, 'add', '-A');
  git(REPO, 'commit', '--quiet', '-m', `land ${name}`);
  git(REPO, 'push', '--quiet', 'origin', 'main');
}

/** A live worktree branched from the *current* main tip. */
function liveWorktree(dirName, tag) {
  const branch = `worktree-${dirName}-${tag}`;
  const live = path.join(REPO, '.claude', 'worktrees', dirName);
  git(REPO, 'worktree', 'add', '--quiet', '-b', branch, live, 'main');
  return { branch, dir: live };
}

// Case 1: `b7e-shipped` lands on main before any worktree exists, so every worktree
// created after this point inherits it for free.
landOnMain('b7e-shipped');

const bystander1 = liveWorktree('bystander-shipped-a', 'x1');
const bystander2 = liveWorktree('bystander-shipped-b', 'x2');

// Case 2: `b7e-pr-only` is not on main. A worktree adds and *pushes* it (so a remote
// tracking ref exists for the fake PR to point `--head` style checks at).
const prWt = liveWorktree('pr-only-work', 'pr1');
fs.writeFileSync(path.join(prWt.dir, 'bin', 'b7e-pr-only'), '#!/usr/bin/env node\n');
git(prWt.dir, 'add', '-A');
git(prWt.dir, 'commit', '--quiet', '-m', 'add b7e-pr-only');
git(prWt.dir, 'push', '--quiet', 'origin', prWt.branch);

// Case 3: `b7e-dormant` sits, uncommitted, in a different live worktree entirely — the
// "457 lines nobody committed" shape. No branch, no PR, just a file on disk.
const dormantWt = liveWorktree('dormant-work', 'dm1');
fs.writeFileSync(path.join(dormantWt.dir, 'bin', 'b7e-dormant'), '#!/usr/bin/env node\n');
// deliberately not `git add`/`commit`ed

/* ---------------------------------------------------------------------- fake gh */

const PRS_FILE = path.join(tmp, 'prs.json');
fs.writeFileSync(
  PRS_FILE,
  JSON.stringify([
    {
      number: 841,
      url: 'https://github.com/NeanderthalMan/widgets/pull/841',
      title: 'b7e-pr-only — a pending command',
      state: 'OPEN',
      headRefName: prWt.branch,
      baseRefName: 'main',
      body: 'Adds bin/b7e-pr-only.',
      mergedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      statusCheckRollup: [],
    },
    {
      number: 900,
      url: 'https://github.com/NeanderthalMan/widgets/pull/900',
      title: 'unrelated, already merged',
      state: 'MERGED',
      headRefName: 'some-other-branch',
      baseRefName: 'main',
      body: 'Nothing to do with this suite.',
      mergedAt: '2026-01-02T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      isDraft: false,
      mergeable: 'UNKNOWN',
      mergeStateStatus: '',
      statusCheckRollup: [],
    },
  ])
);

const BIN_DIR = path.join(tmp, 'fakebin');
fs.mkdirSync(BIN_DIR, { recursive: true });
fs.writeFileSync(
  path.join(BIN_DIR, 'gh'),
  `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
const arg = (f) => { const i = a.indexOf(f); return i === -1 ? null : a[i + 1]; };
if (a[0] === 'auth' && a[1] === 'status') process.exit(0);
if (a[0] === 'repo' && a[1] === 'view') { console.log('{"nameWithOwner":"NeanderthalMan/widgets","viewerPermission":"WRITE"}'); process.exit(0); }
if (a[0] === 'pr' && a[1] === 'list') {
  const rows = JSON.parse(fs.readFileSync(${JSON.stringify(PRS_FILE)}, 'utf8'));
  const state = arg('--state');
  const head = arg('--head');
  const search = arg('--search');
  let out = rows;
  if (state && state !== 'all') out = out.filter((r) => r.state === state.toUpperCase());
  if (head) out = out.filter((r) => r.headRefName === head);
  if (search) {
    const needle = search.replace(/ in:title,body$/, '');
    out = out.filter((r) => r.title.includes(needle) || r.body.includes(needle));
  }
  console.log(JSON.stringify(out));
  process.exit(0);
}
console.error('unexpected gh: ' + a.join(' '));
process.exit(1);
`,
  { mode: 0o755 }
);

/* ---------------------------------------------------------------------- fake bd */

const FAKE_BD = path.join(tmp, 'bd');
const ROWS = [
  { id: 'ws-tracker1', title: 'File a command at bin/b7e-fromtracker for this', description: '', status: 'open', labels: [] },
  { id: 'ws-closed1', title: 'This once proposed b7e-closedname, but closed', description: '', status: 'closed', labels: [] },
  { id: 'ws-unrelated', title: 'Nothing to do with any of this', description: 'no names here', status: 'open', labels: [] },
];
fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const args = process.argv.slice(2);
const rows = ${JSON.stringify(ROWS)};
const die = (m) => { process.stderr.write(m + '\\n'); process.exit(1); };
if (args[0] === 'list') { process.stdout.write(JSON.stringify(rows)); process.exit(0); }
die('stub bd: unexpected verb "' + args[0] + '"');
`,
  { mode: 0o755 }
);

const LOCKED_BD = path.join(tmp, 'bd-locked');
fs.writeFileSync(LOCKED_BD, '#!/bin/sh\necho "Error: database is locked" >&2\nexit 1\n', { mode: 0o755 });

/* -------------------------------------------------------------------- config */

const configDir = path.join(tmp, 'config');
fs.mkdirSync(configDir, { recursive: true });
writeJson(path.join(configDir, 'config.json'), {
  bdBin: FAKE_BD,
  actor: 'beadcause-test',
  workspaces: [{ name: 'taken-ws', dir: path.join(tmp, 'tracker') }],
});
fs.mkdirSync(path.join(tmp, 'tracker'), { recursive: true });

const lockedConfigDir = path.join(tmp, 'config-locked');
fs.mkdirSync(lockedConfigDir, { recursive: true });
writeJson(path.join(lockedConfigDir, 'config.json'), {
  bdBin: LOCKED_BD,
  actor: 'beadcause-test',
  workspaces: [{ name: 'taken-ws', dir: path.join(tmp, 'tracker') }],
});

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function run(args, { cwd = REPO, configDirOverride = configDir } = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd,
    env: {
      ...process.env,
      HOME: tmp,
      BEADCAUSE_CONFIG_DIR: configDirOverride,
      PATH: `${BIN_DIR}${path.delimiter}${process.env.PATH}`,
    },
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: stripAnsi(res.stdout || ''), stderr: stripAnsi(res.stderr || '') };
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
    console.log(`       ${String(err.message).split('\n').slice(0, 10).join('\n       ')}`);
  }
};

console.log('\nb7e-taken\n');

/* ============================================================== 1. already on main */

console.log('1. already on origin/main — no worktree/PR noise on top\n');

check('taken, exit 3, names origin/main', () => {
  const { status, stdout } = run(['b7e-shipped']);
  assert.equal(status, 3, stdout);
  assert.match(stdout, /b7e-shipped: taken/);
  assert.match(stdout, /on origin\/main: bin\/b7e-shipped on origin\/main/);
});

check('every worktree already has it, and none is listed as a separate claimant', () => {
  const { stdout } = run(['b7e-shipped']);
  assert.ok(fs.existsSync(path.join(bystander1.dir, 'bin', 'b7e-shipped')), 'fixture sanity: bystander worktree should have inherited the file');
  assert.ok(!stdout.includes('live worktree'), `expected no live-worktree noise once it is on main:\n${stdout}`);
  assert.ok(!stdout.includes('open pull request'), `expected no pull-request noise once it is on main:\n${stdout}`);
});

check('the bin/ file, the registration and the docs heading are all reported too', () => {
  const { stdout } = run(['b7e-shipped']);
  assert.match(stdout, /in bin\/ here: bin\/b7e-shipped/);
  assert.match(stdout, /registered: package.json and package-lock.json/);
  assert.match(stdout, /documented: docs[\\/]tools\.md:\d+ — ### Does a thing — `b7e-shipped`/);
});

/* ==================================================== 2. an open PR, not yet on main */

console.log('\n2. not on main, but an open pull request already has it\n');

check("bc-dgx7.126's own shape: named, its PR number and branch, no false origin/main claim", () => {
  const { status, stdout } = run(['b7e-pr-only']);
  assert.equal(status, 3, stdout);
  assert.match(stdout, new RegExp(`open pull request #841 \\(${prWt.branch}\\)`));
  assert.ok(!stdout.includes('on origin/main'), `must not claim origin/main for a name not there:\n${stdout}`);
});

check('a merged, unrelated pull request never counts as a claimant', () => {
  const { stdout } = run(['b7e-pr-only']);
  assert.ok(!stdout.includes('#900'), `PR #900 does not touch bin/b7e-pr-only and must not be named:\n${stdout}`);
});

check('the live worktree that owns the branch is also named', () => {
  const { stdout } = run(['b7e-pr-only']);
  assert.match(stdout, new RegExp(`live worktree: .*pr-only-work \\(${prWt.branch}\\)`));
});

/* =============================================== 3. only an uncommitted worktree file */

console.log('\n3. a live worktree holds it, uncommitted — the dormant-work shape\n');

check('found by reading the directory, not the branch tip', () => {
  const { status, stdout } = run(['b7e-dormant']);
  assert.equal(status, 3, stdout);
  assert.match(stdout, /live worktree: .*dormant-work/);
  assert.ok(!stdout.includes('open pull request'), 'nothing was ever pushed for this one');
  assert.ok(!stdout.includes('on origin/main'));
});

/* ======================================================== 4. only an open bead names it */

console.log('\n4. only an open bead names it — a closed one must not count\n');

check('the open bead is named, the closed one is not', () => {
  const { status, stdout } = run(['b7e-fromtracker', '-w', 'taken-ws']);
  assert.equal(status, 3, stdout);
  assert.match(stdout, /open bead: taken-ws\/ws-tracker1/);
});

check('a name only a closed bead ever proposed reads as free', () => {
  const { status, stdout } = run(['b7e-closedname', '-w', 'taken-ws']);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /b7e-closedname: free/);
});

check('without -w, the tracker is not consulted at all', () => {
  const { status, stdout } = run(['b7e-fromtracker']);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /b7e-fromtracker: free/);
});

/* =========================================================== 5. multiple names at once */

console.log('\n5. one verdict per name, and --json\n');

check('one call, several names, mixed verdicts', () => {
  const { status, stdout } = run(['b7e-shipped', 'zzz-totally-unclaimed']);
  assert.equal(status, 3, stdout);
  assert.match(stdout, /b7e-shipped: taken/);
  assert.match(stdout, /zzz-totally-unclaimed: free/);
});

check('--json emits one parseable object per name', () => {
  const { status, stdout } = run(['b7e-shipped', 'zzz-totally-unclaimed', '--json']);
  assert.equal(status, 3, stdout);
  const rows = stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'b7e-shipped');
  assert.equal(rows[0].free, false);
  assert.ok(rows[0].claims.some((c) => c.kind === 'main'));
  assert.equal(rows[1].free, true);
  assert.deepEqual(rows[1].claims, []);
});

/* ==================================================================== 6. free, and --dir */

console.log('\n6. nothing anywhere, and checking another tree with --dir\n');

check('a name nothing claims is free in one line, exit 0', () => {
  const { status, stdout } = run(['zzz-nothing-anywhere']);
  assert.equal(status, 0);
  assert.equal(stdout.trim().split('\n').length, 1);
  assert.match(stdout, /free/);
});

check('--dir points at another checkout entirely', () => {
  const { status, stdout } = run(['b7e-shipped', '--dir', REPO], { cwd: tmp });
  assert.equal(status, 3, stdout);
  assert.match(stdout, /on origin\/main/);
});

/* ---------------------------------------------------------------------- refusals */

console.log('\nrefusals\n');

check('--help prints usage and exits 0', () => {
  const { status, stdout } = run(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /usage: b7e-taken/);
});

check('no names at all is refused at 2', () => {
  const { status, stderr } = run(['-w', 'taken-ws']);
  assert.equal(status, 2);
  assert.match(stderr, /name at least one command/);
});

check('an implausible name is refused at 2', () => {
  const { status, stderr } = run(['../etc/passwd']);
  assert.equal(status, 2);
  assert.match(stderr, /not a plausible command name/);
});

check('an unknown workspace is refused at 4', () => {
  const { status, stderr } = run(['b7e-shipped', '-w', 'not-a-workspace']);
  assert.equal(status, 4);
  assert.match(stderr, /no workspace named not-a-workspace/);
});

check('a tracker that cannot be read is refused at 5, before anything is checked', () => {
  const { status, stderr } = run(['b7e-shipped', '-w', 'taken-ws'], { configDirOverride: lockedConfigDir });
  assert.equal(status, 5);
  assert.match(stderr, /could not read taken-ws/);
});

/* ---------------------------------------------------------------- verdict */

console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m\n` : '\n\x1b[32mall checks passed\x1b[0m\n');
process.exit(failures ? 1 : 0);
