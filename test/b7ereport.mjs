#!/usr/bin/env node
//
// b7e-await — land a relay reviewer subagent's report in the repo verbatim, or say it
// died (bc-dgx7.148). Drives the real CLI as a real subprocess against hand-built
// fixture transcripts in the three shapes the bead's own acceptance criteria name: a
// finished subagent, one killed by a 429, and one still running — plus the registration
// checks every b7e-* command owes (test/usage.mjs's "b7e-usage" checklist, repeated here
// for this command).
//
//   npm test
//   node test/b7ereport.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';
import { DEFAULT_TOOL_LIST } from '../lib/tooldecl.js';
import { specText } from '../lib/docset.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-report');

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
};

console.log('\nb7e-report\n');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'b7ereport-'));
process.on('exit', () => removeTreeSync(TMP));

let n = 0;
function fixtureDir() {
  n += 1;
  const d = path.join(TMP, `fx${n}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// The roster `--role` is checked against comes from whatever relay the config declares —
// beadcause ships none — so every run gets an isolated config directory declaring an
// invented one, and never reads the config on this Mac.
const CONFIG_DIR = path.join(TMP, 'config');
fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.writeFileSync(
  path.join(CONFIG_DIR, 'config.json'),
  JSON.stringify({
    relays: { studio: { departments: { 'dept:story': { members: ['editor', 'critic'], check: ['editor', 'critic'] } } } },
  })
);

function run(args, opts = {}) {
  const env = { ...(opts.env || process.env), BEADCAUSE_CONFIG_DIR: CONFIG_DIR };
  const res = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: ROOT, ...opts, env });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

const line = (obj) => JSON.stringify(obj);
const assistantText = (text) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const subagentStop = () => line({ attachment: { hookName: 'SubagentStop' } });
const apiError = (error, apiErrorStatus) =>
  line({ type: 'assistant', isApiErrorMessage: true, apiErrorStatus, error, message: { role: 'assistant', content: [] } });
const jsonl = (...lines) => lines.join('\n') + '\n';

/* ======================================================================= usage / argv */

check('--help prints usage and exits 0', () => {
  const { status, stdout } = run(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /usage: b7e-report/);
  assert.match(stdout, /--role/);
});

check('no arguments prints usage and exits 2', () => {
  const { status, stdout } = run([]);
  assert.equal(status, 2);
  assert.match(stdout, /usage: b7e-report/);
});

check('an agent id with no --role prints usage and exits 2', () => {
  const { status, stdout } = run(['some-id']);
  assert.equal(status, 2);
  assert.match(stdout, /usage: b7e-report/);
});

check('an unrecognised --role is refused, naming what was given', () => {
  const { status, stderr } = run(['some-id', '--role', 'nassim', '--dir', fixtureDir()]);
  assert.equal(status, 2);
  assert.match(stderr, /--role must be one of critic, editor/);
  assert.match(stderr, /"nassim"/);
});

check('--timeout 0 is refused', () => {
  const { status, stderr } = run(['some-id', '--role', 'editor', '--timeout', '0', '--dir', fixtureDir()]);
  assert.equal(status, 2);
  assert.match(stderr, /--timeout <seconds> must be a positive number/);
});

/* ============================================================ the finished subagent */

check('a finished subagent: writes a file identical to the final message, exits 0', () => {
  const dir = fixtureDir();
  const reportText = "# Editor's Continuity Report — Ch. 10\n\nBody of the report, several lines.\n";
  fs.writeFileSync(path.join(dir, 'clio1.output'), jsonl(assistantText('thinking...'), assistantText(reportText), subagentStop()));
  const target = path.join(dir, 'landed.md');
  const { status, stdout } = run(['clio1', '--role', 'editor', '--dir', dir, '--to', target]);
  assert.equal(status, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), reportText);
  assert.match(stdout, /landed\.md/);
  assert.match(stdout, /Editor's Continuity Report/);
});

check('with no --to: prints the report to stdout instead of writing a file', () => {
  const dir = fixtureDir();
  const reportText = "## Critic's Critique: Ch. 5\n\nCuts and reasons.";
  fs.writeFileSync(path.join(dir, 'muse1.output'), jsonl(assistantText(reportText), subagentStop()));
  const { status, stdout } = run(['muse1', '--role', 'critic', '--dir', dir]);
  assert.equal(status, 0);
  assert.equal(stdout.trim(), reportText.trim());
});

check('--to creates intermediate directories that do not exist yet', () => {
  const dir = fixtureDir();
  const reportText = '# Editor short report';
  fs.writeFileSync(path.join(dir, 'clio2.output'), jsonl(assistantText(reportText), subagentStop()));
  const target = path.join(dir, 'nested', 'deeper', 'landed.md');
  const { status } = run(['clio2', '--role', 'editor', '--dir', dir, '--to', target]);
  assert.equal(status, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), reportText);
});

/* ================================================================== the 429-killed one */

check('a 429-killed subagent: exits non-zero, names the rate limit, writes nothing', () => {
  const dir = fixtureDir();
  fs.writeFileSync(path.join(dir, 'dead1.output'), jsonl(assistantText('partway through...'), apiError('rate_limit', 429)));
  const target = path.join(dir, 'should-not-exist.md');
  const { status, stderr } = run(['dead1', '--role', 'editor', '--dir', dir, '--to', target]);
  assert.notEqual(status, 0);
  assert.match(stderr, /rate limit/);
  assert.equal(fs.existsSync(target), false);
});

check('a subagent that finished with no matching text: distinct exit, writes nothing', () => {
  const dir = fixtureDir();
  fs.writeFileSync(path.join(dir, 'wronganswer.output'), jsonl(assistantText('I decided not to write a report'), subagentStop()));
  const target = path.join(dir, 'nope.md');
  const { status, stderr } = run(['wronganswer', '--role', 'critic', '--dir', dir, '--to', target]);
  assert.notEqual(status, 0);
  assert.match(stderr, /wronganswer/);
  assert.equal(fs.existsSync(target), false);
});

/* ================================================================= the still-running one */

check('a still-running subagent with --timeout 1: exits 124', () => {
  const dir = fixtureDir();
  fs.writeFileSync(path.join(dir, 'running1.output'), jsonl(assistantText('still working...')));
  const started = Date.now();
  const { status } = run(['running1', '--role', 'editor', '--dir', dir, '--timeout', '1']);
  const ms = Date.now() - started;
  assert.equal(status, 124);
  assert.ok(ms >= 900, `--timeout 1 should wait close to a second, took ${ms}ms`);
});

check('a still-running subagent with no --wait and no --timeout: exits 124 immediately, no blocking', () => {
  const dir = fixtureDir();
  fs.writeFileSync(path.join(dir, 'running2.output'), jsonl(assistantText('still working...')));
  const started = Date.now();
  const { status } = run(['running2', '--role', 'editor', '--dir', dir]);
  const ms = Date.now() - started;
  assert.equal(status, 124);
  assert.ok(ms < 900, `with no wait requested this should not block, took ${ms}ms`);
});

check('a task id that never turns up at all: same as still running, exits 124', () => {
  const { status } = run(['does-not-exist', '--role', 'editor', '--dir', fixtureDir(), '--timeout', '1']);
  assert.equal(status, 124);
});

/* ========================================================== real discovery, not --dir */

check('resolving by agent id works from inside a worktree entered after the Agent call', () => {
  // Simulates a session that ran EnterWorktree between backgrounding the subagent and
  // reading its report back — the file lives under the OLD cwd's slug, and this process's
  // *current* cwd (ROOT, per spawnSync above) has no matching slug at all under `base`.
  const base = fixtureDir();
  const sessionId = 'sess-report-fallback-33333333';
  const staleTasksDir = path.join(base, 'some-worktree-cwd-slug-before-entering', sessionId, 'tasks');
  fs.mkdirSync(staleTasksDir, { recursive: true });
  const reportText = '# Editor via fallback resolution';
  fs.writeFileSync(path.join(staleTasksDir, 'fallback1.output'), jsonl(assistantText(reportText), subagentStop()));
  const { status, stdout } = run(['fallback1', '--role', 'editor'], {
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId, B7E_TASKS_TEST_BASE: base },
  });
  assert.equal(status, 0);
  assert.match(stdout, /via fallback resolution/);
});

check('with no --dir and no CLAUDE_CODE_SESSION_ID: refuses with a clear message, exits 2', () => {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  const { status, stderr } = run(['whatever', '--role', 'editor'], { env });
  assert.equal(status, 2);
  assert.match(stderr, /CLAUDE_CODE_SESSION_ID/);
});

/* --------------------------------------------------------------------- registrations */

console.log('\nthe registrations a new bin/ command owes\n');

check('bin/b7e-report is executable, extensionless, and has a shebang', () => {
  assert.ok(fs.existsSync(BIN), 'bin/b7e-report is missing');
  assert.ok(fs.statSync(BIN).mode & 0o111, 'bin/b7e-report is not executable');
  assert.ok(fs.readFileSync(BIN, 'utf8').startsWith('#!/usr/bin/env node'), 'no shebang');
});

check('it is registered in package.json AND in package-lock.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.bin['b7e-report'], 'bin/b7e-report');
  assert.equal(lock.packages[''].bin['b7e-report'], 'bin/b7e-report');
});

check('the specification says it exists — a feature is not finished here until it does', () => {
  assert.match(specText(ROOT), /^### .*`b7e-report`/m, 'no ### section names b7e-report');
});

check('it declares @grant excluded, and stays off DEFAULT_TOOL_LIST — its --to writes an arbitrary path', () => {
  const src = fs.readFileSync(BIN, 'utf8');
  assert.match(src, /^\s*\*\s*@grant excluded\s*$/m, 'b7e-report no longer declares @grant excluded');
  assert.ok(!DEFAULT_TOOL_LIST.includes('Bash(b7e-report:*)'), 'b7e-report is on DEFAULT_TOOL_LIST despite @grant excluded');
});

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('all checks passed\n');
