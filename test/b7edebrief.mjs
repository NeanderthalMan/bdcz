#!/usr/bin/env node
//
// b7e-debrief — file a debrief from a file, not an inline argument (bc-xl7n.172).
//
//   npm test
//   node test/b7edebrief.mjs
//
// `beadcause-memory debrief <text...>` takes its report only as literal argv text, and
// the harness's own worktree sandbox guard refuses a Bash call the moment that text
// contains a word like "git" — the bead this file is about. `bin/b7e-debrief.js` reads
// the report from a file instead, so this suite drives it end to end through the real
// binary against a throwaway repo: argv parsing, the missing/empty-file refusals, the
// bead/agent resolution from the environment vs. flags, and — the one thing that
// actually proves the fix — a report containing the word "git" lands whole.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-debrief.js');

let failures = 0;
let ran = 0;
const ok = (name) => {
  ran += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
};
const bad = (name, detail) => {
  ran += 1;
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
function check(name, fn) {
  try {
    const detail = fn();
    if (detail === false) bad(name);
    else ok(name);
  } catch (err) {
    bad(name, err.message);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7edebrief-'));
process.on('exit', () => removeTreeSync(tmp));

const REPO = path.join(tmp, 'repo');
fs.mkdirSync(REPO, { recursive: true });
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'test@localhost');
git('config', 'user.name', 'test');
git('commit', '-q', '--allow-empty', '-m', 'root');

function run(args, env = {}) {
  // BEADCAUSE_BEAD/BEADCAUSE_AGENT are deliberately cleared rather than inherited — this
  // suite may itself be running inside a real beadcause session with both set for its
  // own bead, and a child that inherited them would silently pass real identity through
  // the "no bead"/"no agent" refusal cases below.
  const res = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: REPO,
    env: { ...process.env, BEADCAUSE_BEAD: '', BEADCAUSE_AGENT: '', ...env },
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

console.log('\nb7e-debrief — argv and the file-not-argv fix\n');

check('--help prints usage and exits 0, taking no bead or agent', () => {
  const { status, stdout } = run(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /usage: b7e-debrief <path>/);
});

check('no path at all is refused', () => {
  const { status, stderr } = run([], { BEADCAUSE_BEAD: 'bc-x', BEADCAUSE_AGENT: 'tester' });
  assert.notEqual(status, 0);
  assert.match(stderr, /no path given/);
});

check('two paths is refused, not "first wins"', () => {
  const { status, stderr } = run(['a.md', 'b.md'], { BEADCAUSE_BEAD: 'bc-x', BEADCAUSE_AGENT: 'tester' });
  assert.notEqual(status, 0);
  assert.match(stderr, /expected exactly one path, got 2/);
});

check('an unknown flag is refused', () => {
  const { status, stderr } = run(['--nope', 'a.md'], { BEADCAUSE_BEAD: 'bc-x', BEADCAUSE_AGENT: 'tester' });
  assert.notEqual(status, 0);
  assert.match(stderr, /unknown flag "--nope"/);
});

check('a missing file is refused, naming the path', () => {
  const { status, stderr } = run(['does-not-exist.md'], { BEADCAUSE_BEAD: 'bc-x', BEADCAUSE_AGENT: 'tester' });
  assert.notEqual(status, 0);
  assert.match(stderr, /could not read does-not-exist\.md/);
});

check('an empty file is refused, naming the path — not silently filed as nothing', () => {
  fs.writeFileSync(path.join(REPO, 'empty.md'), '');
  const { status, stderr } = run(['empty.md'], { BEADCAUSE_BEAD: 'bc-x', BEADCAUSE_AGENT: 'tester' });
  assert.notEqual(status, 0);
  assert.match(stderr, /empty\.md is empty/);
});

check('a file that is only whitespace is refused the same way', () => {
  fs.writeFileSync(path.join(REPO, 'blank.md'), '   \n\n  ');
  const { status, stderr } = run(['blank.md'], { BEADCAUSE_BEAD: 'bc-x', BEADCAUSE_AGENT: 'tester' });
  assert.notEqual(status, 0);
  assert.match(stderr, /blank\.md is empty/);
});

check('no bead — neither $BEADCAUSE_BEAD nor --bead — is refused, not guessed', () => {
  fs.writeFileSync(path.join(REPO, 'report.md'), 'fine content');
  const { status, stderr } = run(['report.md'], { BEADCAUSE_AGENT: 'tester' });
  assert.notEqual(status, 0);
  assert.match(stderr, /no bead/);
});

check('no agent — neither $BEADCAUSE_AGENT nor --agent — is refused', () => {
  const { status, stderr } = run(['report.md'], { BEADCAUSE_BEAD: 'bc-x' });
  assert.notEqual(status, 0);
  assert.match(stderr, /no agent/);
});

/* --------------------------------------------------------------- the actual write */

const memory = await import(path.join(ROOT, 'lib', 'memory.js'));

check('a normal report is filed under $BEADCAUSE_BEAD/$BEADCAUSE_AGENT and reports bead, count, repo, and bytes read', () => {
  const content = 'Ran the suite twice; both green.';
  fs.writeFileSync(path.join(REPO, 'report.md'), content);
  const { status, stdout } = run(['report.md'], { BEADCAUSE_BEAD: 'bc-env1', BEADCAUSE_AGENT: 'env-agent' });
  assert.equal(status, 0);
  assert.match(stdout, new RegExp(`^debriefed bc-env1 \\(1 this run\\) in .+ — ${Buffer.byteLength(content, 'utf8')} bytes from report\\.md\\n$`));
});

const stagedEnv1 = await memory.stagedDebrief(REPO, 'bc-env1');
check('the entry actually landed in the staging ref, with the right agent and text', () => {
  assert.equal(stagedEnv1.entries.length, 1);
  assert.equal(stagedEnv1.entries[0].agent, 'env-agent');
  assert.equal(stagedEnv1.entries[0].text, 'Ran the suite twice; both green.');
});

check('--bead and --agent override the environment rather than being ignored', () => {
  const { status, stdout } = run(['report.md', '--bead', 'bc-flag1', '--agent', 'flag-agent'], {
    BEADCAUSE_BEAD: 'bc-env1',
    BEADCAUSE_AGENT: 'env-agent',
  });
  assert.equal(status, 0);
  assert.match(stdout, /^debriefed bc-flag1/);
});

const stagedFlag1 = await memory.stagedDebrief(REPO, 'bc-flag1');
check('the flagged write landed under the flagged bead and agent, not the env ones', () => {
  assert.equal(stagedFlag1.entries.length, 1);
  assert.equal(stagedFlag1.entries[0].agent, 'flag-agent');
});

check('a second call against the same bead appends rather than replacing', () => {
  fs.writeFileSync(path.join(REPO, 'report2.md'), 'A second finding from the same run.');
  const { status, stdout } = run(['report2.md'], { BEADCAUSE_BEAD: 'bc-env1', BEADCAUSE_AGENT: 'env-agent' });
  assert.equal(status, 0);
  assert.match(stdout, /^debriefed bc-env1 \(2 this run\)/);
});

// The one check that actually proves the bug this bead fixes: a report containing "git"
// and "git stash" — the exact shape the harness's own worktree sandbox guard refuses as
// inline argv text — has to land whole when it arrives as a file instead.
check('a report containing "git" and "git stash" lands whole — the thing this bead fixes', () => {
  const trigger = 'Recovered by running git stash pop against the wrong worktree; do not repeat that.';
  fs.writeFileSync(path.join(REPO, 'trigger.md'), `${trigger}\n`);
  const { status, stdout } = run(['trigger.md'], { BEADCAUSE_BEAD: 'bc-trigger1', BEADCAUSE_AGENT: 'tester' });
  assert.equal(status, 0);
  assert.match(stdout, /^debriefed bc-trigger1 \(1 this run\)/);
});

const stagedTrigger1 = await memory.stagedDebrief(REPO, 'bc-trigger1');
check('and the git-containing text reads back byte for byte, not trimmed or split', () => {
  assert.equal(stagedTrigger1.entries.length, 1);
  assert.equal(stagedTrigger1.entries[0].text, 'Recovered by running git stash pop against the wrong worktree; do not repeat that.');
});

check('the printed byte count matches the file actually written, not the trimmed text', () => {
  // Trailing newline plus a leading/trailing space, so byte count and trimmed length
  // diverge — proving the count is Buffer.byteLength(raw), not text.length.
  const content = '  padded on both sides  \n';
  fs.writeFileSync(path.join(REPO, 'padded.md'), content, 'utf8');
  const { status, stdout } = run(['padded.md'], { BEADCAUSE_BEAD: 'bc-padded1', BEADCAUSE_AGENT: 'tester' });
  assert.equal(status, 0);
  assert.match(stdout, new RegExp(`— ${Buffer.byteLength(content, 'utf8')} bytes from padded\\.md`));
});

console.log(`\n${ran - failures}/${ran} passed`);
if (failures > 0) process.exit(1);
