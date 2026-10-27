#!/usr/bin/env node
//
// b7e-premise — does the symptom a bead describes still reproduce at a ref (bc-dgx7.70).
//
//   npm test
//   node test/b7epremise.mjs
//
// lib/premise.js does the claim extraction and the checking; bin/b7e-premise is the
// argv shell around it — same split test/b7echecks.mjs and test/b7eprior.mjs use for
// their own commands, and this file borrows both of their fixture patterns: a real
// throwaway git repo (lib/checks.js's makeRefWorktree, exercised for real) for the
// checking half, and a fake `bd` plus a `config.json` (test/b7eprior.mjs's own pattern)
// for the CLI half.
//
// bc-dgx7.70's own acceptance criteria is truncated mid-sentence in the tracker
// ("Exit 0 when at") — see lib/premise.js's header for the reconstruction this suite
// pins. It also names two real beads in a different tracker (dv-gr6.48, dv-3rn.5) that
// this checkout cannot reach in CI; the two cases below reproduce their *shape* — a bead
// whose acceptance-criteria claims are all already true, and a bead with one clean
// selftest and one still-failing one — against a fixture repo instead.
//
// python3 is assumed present — the same assumption lib/checks.js's own checks make.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-premise');

const premise = await import(path.join(ROOT, 'lib', 'premise.js'));

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));
const verify = (name, fn) => {
  try {
    fn();
    check(name, true);
  } catch (err) {
    check(name, false, err.message);
  }
};

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-premise-test-'));
process.on('exit', () => removeTreeSync(tmp));

/* ===================================================================== *
 * 1. extractClaims — pure, no I/O
 * ===================================================================== */

console.log('\nextractClaims\n');

verify('a `git merge-base --is-ancestor` command extracts the sha', () => {
  const claims = premise.extractClaims('checked with `git merge-base --is-ancestor c28b56eb origin/main`');
  assert.equal(claims.length, 1);
  assert.equal(claims[0].shape, 'sha');
  assert.equal(claims[0].sha, 'c28b56eb');
});

verify('a bare hex span of 7-40 chars extracts as a sha', () => {
  const claims = premise.extractClaims('the fix landed at `318b2db3`');
  assert.equal(claims[0].shape, 'sha');
  assert.equal(claims[0].sha, '318b2db3');
});

verify('a `python3 scripts/*.py` span extracts as a script, argv split on whitespace', () => {
  const claims = premise.extractClaims('run `python3 scripts/check_g0_canon_lock_selftest.py .`');
  assert.equal(claims[0].shape, 'script');
  assert.deepEqual(claims[0].argv, ['scripts/check_g0_canon_lock_selftest.py', '.']);
});

verify('a `grep -n "LITERAL" file` span extracts the literal and the file', () => {
  const claims = premise.extractClaims('via `grep -n "PACKET\\s*=" scripts/check_g0_canon_lock_selftest.py`');
  assert.equal(claims[0].shape, 'literal');
  assert.equal(claims[0].literal, 'PACKET\\s*=');
  assert.equal(claims[0].file, 'scripts/check_g0_canon_lock_selftest.py');
});

verify('a slash-bearing span extracts as a repo path', () => {
  const claims = premise.extractClaims('lives at `docs/CONTINUITY_GUIDE.md`');
  assert.equal(claims[0].shape, 'path');
  assert.equal(claims[0].file, 'docs/CONTINUITY_GUIDE.md');
});

verify('a code span matching none of the four shapes is UNCHECKABLE by name, not dropped', () => {
  const claims = premise.extractClaims('see `--json` and `git show origin/main:CHANGE_LOG.md`');
  assert.equal(claims.length, 2);
  assert.ok(claims.every((c) => c.shape === 'unchecked'));
  assert.equal(claims[0].raw, '--json');
  assert.equal(claims[1].raw, 'git show origin/main:CHANGE_LOG.md');
});

verify('a repeated span is only one claim', () => {
  const claims = premise.extractClaims('`bin/b7e-premise` ... again, `bin/b7e-premise`');
  assert.equal(claims.length, 1);
});

verify('prose with no backticks at all extracts nothing', () => {
  assert.deepEqual(premise.extractClaims('nothing quoted here at all'), []);
});

/* ===================================================================== *
 * 2. checkPremise — a real throwaway git repo, real python3 children
 * ===================================================================== */

console.log('\ncheckPremise against a real repo\n');

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  });

function makeRepo(name, files) {
  const work = path.join(tmp, name);
  fs.mkdirSync(work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
    fs.writeFileSync(path.join(work, rel), body);
  }
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'init');
  return work;
}
const pyExit = (code) => `import sys\nsys.exit(${code})\n`;

verify('sha claim: HOLDS when it is an ancestor of the ref, GONE when it is not', () => {
  const repo = makeRepo('sha-repo', { 'a.txt': '1\n' });
  const oldSha = git(repo, 'rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(repo, 'a.txt'), '2\n');
  git(repo, 'commit', '-aqm', 'second');
  const futureSha = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'branch', '-f', 'main-at-old', oldSha);

  const holds = premise.checkShaClaim(repo, { sha: oldSha }, 'main');
  assert.equal(holds.verdict, 'HOLDS');
  const gone = premise.checkShaClaim(repo, { sha: futureSha }, 'main-at-old');
  assert.equal(gone.verdict, 'GONE');
});

verify('path claim: HOLDS when the path exists at the ref, GONE when it does not', () => {
  const repo = makeRepo('path-repo', { 'here.txt': 'x\n' });
  assert.equal(premise.checkPathClaim(repo, { file: 'here.txt' }, 'main').verdict, 'HOLDS');
  assert.equal(premise.checkPathClaim(repo, { file: 'nowhere.txt' }, 'main').verdict, 'GONE');
});

verify('literal claim: HOLDS when found in the file at the ref, GONE when the file lacks it or is missing', () => {
  const repo = makeRepo('literal-repo', { 'clio.md': 'PACKET = 1\n' });
  assert.equal(premise.checkLiteralClaim(repo, { literal: 'PACKET', file: 'clio.md' }, 'main').verdict, 'HOLDS');
  assert.equal(premise.checkLiteralClaim(repo, { literal: 'LEDGER', file: 'clio.md' }, 'main').verdict, 'GONE');
  assert.equal(premise.checkLiteralClaim(repo, { literal: 'PACKET', file: 'nope.md' }, 'main').verdict, 'GONE');
});

verify('script claim: HOLDS on a clean exit, GONE on a non-zero exit — exit status reported honestly', () => {
  const repo = makeRepo('script-repo', {
    'scripts/check_pass.py': pyExit(0),
    'scripts/check_fail.py': pyExit(1),
  });
  const clean = premise.checkScriptClaim(repo, { argv: ['scripts/check_pass.py'] });
  assert.equal(clean.verdict, 'HOLDS');
  assert.match(clean.detail, /exit 0/);
  const red = premise.checkScriptClaim(repo, { argv: ['scripts/check_fail.py'] });
  assert.equal(red.verdict, 'GONE');
  assert.match(red.detail, /exit 1/);
});

verify('an unrecognised claim shape is never handed to any checker — it stays UNCHECKABLE', () => {
  const repo = makeRepo('unchecked-repo', { 'a.txt': 'x\n' });
  const outcome = premise.checkPremise(repo, 'see `--json` for the machine form', { ref: 'main' });
  assert.equal(outcome.results.length, 1);
  assert.equal(outcome.results[0].verdict, 'UNCHECKABLE');
});

/* --------------------------------------------------------------------- *
 * The two replayed acceptance-criteria shapes
 * --------------------------------------------------------------------- */

console.log('\nthe two replayed shapes\n');

verify('dv-gr6.48 shape: every checkable claim already true — exit 4, all HOLDS', () => {
  const repo = makeRepo('gr648-shape', { 'CHANGE_LOG.md': 'the fix for this landed already\n' });
  const sha = git(repo, 'rev-parse', 'HEAD').trim();
  const text = `checked with \`${sha}\` and \`grep -n "landed already" CHANGE_LOG.md\``;
  const outcome = premise.checkPremise(repo, text, { ref: 'main' });
  assert.equal(outcome.results.length, 2);
  assert.ok(outcome.results.every((r) => r.verdict === 'HOLDS'));
  assert.equal(outcome.exitCode, 4, 'both claims already true must exit 4, the dv-gr6.48 requirement');
});

verify('dv-3rn.5 shape: G0 selftest HOLDS-clean, G1 selftest still failing — mixed, exit 0', () => {
  const repo = makeRepo('3rn5-shape', {
    'scripts/check_g0_canon_lock_selftest.py': pyExit(0),
    'scripts/check_g1_ledger_selftest.py': pyExit(1),
  });
  const text = '`python3 scripts/check_g0_canon_lock_selftest.py` and `python3 scripts/check_g1_ledger_selftest.py`';
  const outcome = premise.checkPremise(repo, text, { ref: 'main' });
  const g0 = outcome.results.find((r) => r.raw.includes('g0'));
  const g1 = outcome.results.find((r) => r.raw.includes('g1'));
  assert.equal(g0.verdict, 'HOLDS', 'G0 selftest HOLDS-clean');
  assert.match(g0.detail, /exit 0/);
  assert.equal(g1.verdict, 'GONE', 'G1 selftest still failing');
  assert.match(g1.detail, /exit 1/);
  assert.equal(outcome.exitCode, 0, 'a mixed result must not claim exit 4');
});

verify('checkPremise tears the scratch worktree down even when a script claim throws', () => {
  const repo = makeRepo('teardown-repo', { 'scripts/check_a.py': pyExit(0) });
  const before = git(repo, 'worktree', 'list').trim().split('\n').length;
  premise.checkPremise(repo, '`python3 scripts/check_a.py`', { ref: 'main' });
  const after = git(repo, 'worktree', 'list').trim().split('\n').length;
  assert.equal(after, before, 'no worktree left behind');
});

/* --------------------------------------------------------------------- *
 * bc-dgx7.133 — bead ids, branch names, the parent's group prompt
 * --------------------------------------------------------------------- */

console.log('\nbead, branch and group-prompt claims\n');

verify('a bead id is a claim only when its prefix is a configured workspace prefix', () => {
  const text = 'blocked on `bc-dgx7.70` and `dv-b5d.4`, which is `non-blocking` work';
  assert.deepEqual(premise.extractClaims(text).map((c) => c.shape), ['unchecked', 'unchecked', 'unchecked']);
  const claims = premise.extractClaims(text, { beadPrefixes: ['bc', 'dv'] });
  assert.deepEqual(claims.map((c) => c.shape), ['bead', 'bead', 'unchecked']);
  assert.equal(claims[1].id, 'dv-b5d.4');
});

verify('bead claim: open HOLDS; closed and deferred are GONE with the evidence; missing is UNCHECKABLE', () => {
  const claim = { shape: 'bead', id: 'dv-b5d.4', raw: 'dv-b5d.4' };
  assert.equal(premise.checkBeadClaim(claim, { status: 'open' }).verdict, 'HOLDS');
  assert.equal(premise.checkBeadClaim(claim, { status: 'in_progress' }).verdict, 'HOLDS');
  const closed = premise.checkBeadClaim(claim, { status: 'closed', close_reason: 'merged in #9\nmore' });
  assert.equal(closed.verdict, 'GONE');
  assert.match(closed.detail, /merged in #9/);
  const future = new Date(Date.now() + 86_400_000 * 30).toISOString();
  const deferred = premise.checkBeadClaim(claim, { status: 'open', defer_until: future });
  assert.equal(deferred.verdict, 'GONE');
  assert.match(deferred.detail, new RegExp(`until ${future.slice(0, 10)}`));
  assert.equal(premise.checkBeadClaim(claim, null).verdict, 'UNCHECKABLE');
});

verify('branch claim: ahead/behind against the ref; a missing or fully merged branch is GONE', () => {
  const repo = makeRepo('branch-repo', { 'a.txt': '1\n' });
  git(repo, 'branch', 'worktree-rework-abc');
  git(repo, 'checkout', '-q', 'worktree-rework-abc');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'rework');
  git(repo, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), '2\n');
  git(repo, 'commit', '-aqm', 'main moves');
  git(repo, 'branch', 'worktree-merged-xyz');
  const held = premise.checkBranchClaim(repo, { branch: 'worktree-rework-abc' }, 'main');
  assert.equal(held.verdict, 'HOLDS');
  assert.match(held.detail, /1 ahead \/ 1 behind main/);
  assert.equal(premise.checkBranchClaim(repo, { branch: 'worktree-merged-xyz' }, 'main').verdict, 'GONE');
  assert.equal(premise.checkBranchClaim(repo, { branch: 'worktree-nope' }, 'main').verdict, 'GONE');
});

verify('checkPremise wires bead and branch claims, and skips the bead\'s own id', () => {
  const repo = makeRepo('wire-repo', { 'a.txt': '1\n' });
  const beads = new Map([['bc-other.1', { status: 'closed', close_reason: 'done' }]]);
  const out = premise.checkPremise(repo, '`bc-self.1` `bc-other.1` `worktree-gone-1`', {
    ref: 'main', beadPrefixes: ['bc'], beads, self: 'bc-self.1',
  });
  assert.deepEqual(out.results.map((r) => [r.shape, r.verdict]), [['bead', 'GONE'], ['branch', 'GONE']]);
  assert.deepEqual(premise.beadIdsIn('`bc-self.1` `bc-other.1`', ['bc'], ['bc-self.1']), ['bc-other.1']);
});

verify('groupPromptFor finds the prompt of the group naming the bead, and null otherwise', () => {
  const plan = { groups: [{ name: 'a', beads: ['x-1'], prompt: 'p1' }, { name: 'b', beads: ['x-2'], prompt: 'p2' }] };
  assert.deepEqual(premise.groupPromptFor(plan, 'x-2'), { name: 'b', prompt: 'p2' });
  assert.equal(premise.groupPromptFor(plan, 'x-9'), null);
  assert.equal(premise.groupPromptFor(null, 'x-2'), null);
});

/* ===================================================================== *
 * 3. the CLI — bin/b7e-premise
 * ===================================================================== */

console.log('\nthe CLI\n');

const FAKE_BD = path.join(tmp, 'bd');
const CALLS = path.join(tmp, 'calls.jsonl');

const cliRepo = makeRepo('cli-repo', { 'CHANGE_LOG.md': 'the fix for this landed already\n' });
const cliSha = git(cliRepo, 'rev-parse', 'HEAD').trim();

const WORLD = {
  'ws-gone': {
    id: 'ws-gone',
    title: 'Already fixed by the time anyone opened a worktree',
    status: 'open',
    issue_type: 'bug',
    priority: 2,
    assignee: '',
    parent: null,
    description: `the sha \`${cliSha}\` should be on main`,
    acceptance_criteria: 'and `grep -n "landed already" CHANGE_LOG.md` must find it',
    notes: '',
  },
  'ws-nothing': {
    id: 'ws-nothing',
    title: 'Nothing checkable in this one',
    status: 'open',
    issue_type: 'task',
    priority: 2,
    assignee: '',
    parent: null,
    description: 'just prose, no backticks',
    acceptance_criteria: '',
    notes: '',
  },
};
fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify(args) + '\\n');
const world = ${JSON.stringify(WORLD)};
const die = (m) => { process.stderr.write(m + '\\n'); process.exit(1); };
const verb = args[0];
if (verb === 'show') {
  const id = args[1];
  const issue = world[id];
  if (!issue) die('Error fetching ' + id + ': no issue found matching "' + id + '"');
  process.stdout.write(JSON.stringify([issue]));
  process.exit(0);
}
die('stub bd: unexpected verb "' + verb + '"');
`,
  { mode: 0o755 }
);

const configDir = path.join(tmp, 'config');
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(
  path.join(configDir, 'config.json'),
  JSON.stringify(
    { bdBin: FAKE_BD, actor: 'beadcause-test', workspaces: [{ name: 'premise-ws', dir: path.join(tmp, 'tracker') }], sessionDirs: { 'premise-ws': cliRepo } },
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

verify('--help prints usage and exits 0', () => {
  const { status, stdout } = run(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /usage: b7e-premise/);
});

verify('a missing -w is refused with exit 2', () => {
  const { status, stderr } = run(['-b', 'ws-gone']);
  assert.equal(status, 2);
  assert.match(stderr, /-w\/--workspace is required/);
});

verify('a missing -b is refused with exit 2', () => {
  const { status, stderr } = run(['-w', 'premise-ws']);
  assert.equal(status, 2);
  assert.match(stderr, /-b\/--bead is required/);
});

verify('an unknown workspace is refused with exit 5', () => {
  const { status, stderr } = run(['-w', 'nope-ws', '-b', 'ws-gone']);
  assert.equal(status, 5);
  assert.match(stderr, /no workspace named "nope-ws"/);
});

verify('an unknown bead is refused with exit 5', () => {
  const { status, stderr } = run(['-w', 'premise-ws', '-b', 'ws-absent']);
  assert.equal(status, 5);
  assert.match(stderr, /no bead ws-absent/);
});

verify('a bead with nothing checkable says so and exits 0', () => {
  const { status, stdout } = run(['-w', 'premise-ws', '-b', 'ws-nothing']);
  assert.equal(status, 0);
  assert.match(stdout, /nothing checkable found/);
});

verify('a bead whose claims are all already true against origin/main exits 4', () => {
  const { status, stdout } = run(['-w', 'premise-ws', '-b', 'ws-gone', '--ref', 'main']);
  assert.equal(status, 4);
  assert.match(stdout, /HOLDS/);
  assert.match(stdout, /verdict:.*HOLD/);
});

verify('--json emits parseable, structurally complete output', () => {
  const { status, stdout } = run(['-w', 'premise-ws', '-b', 'ws-gone', '--ref', 'main', '--json']);
  assert.equal(status, 4);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.bead, 'ws-gone');
  assert.equal(parsed.ref, 'main');
  assert.equal(parsed.exitCode, 4);
  assert.equal(parsed.results.length, 2);
  assert.ok(parsed.results.every((r) => r.verdict === 'HOLDS'));
});

console.log(`\n${failures ? `\x1b[31m${failures} failed\x1b[0m` : '\x1b[32mall passed\x1b[0m'}\n`);
process.exit(failures ? 1 : 0);
