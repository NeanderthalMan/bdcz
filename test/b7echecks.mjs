#!/usr/bin/env node
//
// b7e-checks — a workspace repo's own gate scripts, all of them, with a baseline
// (bc-dgx7.57).
//
//   npm test
//   node test/b7echecks.mjs
//
// Named `b7echecks.mjs`, not `checks.mjs` — that name is already the browser-checks
// audit suite (lib/checkaudit.js), an unrelated command with a name one letter away.
// Overwriting it once, by hand, before this file existed is the reason this note is
// here at all.
//
// lib/checks.js does the declaration, the running and the baseline diff; this drives it
// directly against fabricated trees — each carrying its own `.beadcause/checks.json`
// (bc-j2zwo.6: the set is the checkout's declaration, with no default), fake gate
// scripts, and a fake status report judged by `passWhen.emptyArray` — rather than
// against any real checkout, which would make this suite slower than the loop it
// replaces and fail on any machine without that repo cloned. A handful of calls through the real `bin/b7e-checks` binary cover
// what only the CLI does: argv parsing, exit codes, `--json`, the lock refusal and an
// end-to-end `--baseline` run against a real (throwaway) git repo.
//
// python3 is assumed present — the same assumption every check this command runs makes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-checks');

const checks = await import(path.join(ROOT, 'lib', 'checks.js'));

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
const checkAsync = async (name, fn) => {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-checks-test-'));

/** The declaration most trees here carry: every `scripts/check_*.py`, run as `<script> .`. */
const GLOB_DECL = { checks: [{ glob: 'scripts/check_*.py', args: ['.'] }] };

/** A status report declared alongside the glob, judged by an empty `drift` array. */
const STATUS_DECL = {
  checks: [
    { glob: 'scripts/check_*.py', args: ['.'] },
    {
      script: 'scripts/status_report.py',
      args: ['.', '--json'],
      name: 'scripts/status_report.py (DRIFT)',
      passWhen: { emptyArray: 'drift', label: 'DRIFT', describe: ['gate', 'id'] },
    },
  ],
};

/**
 * A fresh `<tmp>/<name>/scripts/` directory holding the given files, plus
 * `.beadcause/checks.json` holding `decl` — `GLOB_DECL` unless told otherwise; `null`
 * for a checkout that declares nothing, a string for one whose file is not JSON.
 */
const tree = (name, files, decl = GLOB_DECL) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  const all = { ...files };
  if (decl !== null) all['.beadcause/checks.json'] = typeof decl === 'string' ? decl : JSON.stringify(decl, null, 2);
  for (const [rel, body] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
};

/** A python script under `scripts/` that exits with `code`, optionally printing `line`. */
const pyExit = (code, line) => `${line ? `print(${JSON.stringify(line)})\n` : ''}import sys\nsys.exit(${code})\n`;

/** A fake status report: honours `--json`, prints a fixed drift payload, exits `exitCode`. */
const pyStatusReport = (drift, exitCode = 0) => `
import json
import sys
payload = {"drift": ${JSON.stringify(drift)}}
if "--json" in sys.argv:
    print(json.dumps(payload))
else:
    print("DRIFT" if payload["drift"] else "no drift")
sys.exit(${exitCode})
`;

/* ===================================================================== *
 * 1. the declaration — .beadcause/checks.json, and no default
 * ===================================================================== */

console.log('\nthe declaration\n');

check('a tree with gate-looking scripts but no .beadcause/checks.json matches no manifest — there is no default', () => {
  const dir = tree('nomanifest', { 'scripts/check_a.py': pyExit(0) }, null);
  assert.equal(checks.manifestFor(dir), null);
  assert.deepEqual(checks.discoverChecks(dir), []);
});

check('a tree that declares its checks is recognised', () => {
  const dir = tree('recognised', { 'scripts/check_a.py': pyExit(0) });
  const m = checks.manifestFor(dir);
  assert.notEqual(m, null);
  assert.deepEqual(m.problems, []);
});

check('a glob finds every match, sorted, each judged by exit code, argv from the declaration', () => {
  const dir = tree('discover', {
    'scripts/check_b.py': pyExit(0),
    'scripts/check_a.py': pyExit(0),
    'scripts/not_a_check.py': pyExit(0),
  });
  const found = checks.discoverChecks(dir);
  assert.deepEqual(found.map((c) => c.name), ['scripts/check_a.py', 'scripts/check_b.py']);
  assert.deepEqual(found[0].argv, ['scripts/check_a.py', '.']);
  assert.equal(found[0].judge, checks.byExitCode);
});

check('the declaration, not a naming convention, decides — a differently-named gate set is found', () => {
  const dir = tree(
    'othernames',
    { 'gates/lint_prose.py': pyExit(0), 'gates/lint_links.py': pyExit(0), 'scripts/check_a.py': pyExit(0) },
    { checks: [{ glob: 'gates/lint_*.py' }] }
  );
  assert.deepEqual(checks.discoverChecks(dir).map((c) => c.name), ['gates/lint_links.py', 'gates/lint_prose.py']);
  assert.deepEqual(checks.discoverChecks(dir)[0].argv, ['gates/lint_links.py']);
});

check('a declared script is appended after the glob, under its own name and passWhen judge', () => {
  const dir = tree('withstatus', { 'scripts/check_a.py': pyExit(0), 'scripts/status_report.py': pyStatusReport([]) }, STATUS_DECL);
  const found = checks.discoverChecks(dir);
  assert.deepEqual(found.map((c) => c.name), ['scripts/check_a.py', 'scripts/status_report.py (DRIFT)']);
  assert.deepEqual(found[1].argv, ['scripts/status_report.py', '.', '--json']);
  assert.notEqual(found[1].judge, checks.byExitCode);
});

check('a declared script that is not on disk is a failing check, never a silent omission', () => {
  const dir = tree('missingscript', { 'scripts/check_a.py': pyExit(0) }, STATUS_DECL);
  const found = checks.discoverChecks(dir);
  const missing = found.find((c) => c.name === 'scripts/status_report.py (DRIFT)');
  assert.ok(missing, 'the missing script vanished from the set');
  assert.equal(missing.judge({ code: 0 }).ok, false);
  assert.match(missing.judge({ code: 0 }).detail, /not on disk/);
});

check('a malformed declaration is recognised but carries problems, not a guess', () => {
  assert.match(checks.manifestFor(tree('badjson', {}, '{ not json'))?.problems[0] || '', /does not parse/);
  assert.match(checks.manifestFor(tree('nochecks', {}, { gates: [] }))?.problems[0] || '', /no "checks" array/);
  assert.match(checks.manifestFor(tree('both', {}, { checks: [{ glob: 'a*', script: 'b' }] }))?.problems[0] || '', /exactly one/);
  assert.match(checks.manifestFor(tree('badpass', {}, { checks: [{ script: 'b', passWhen: {} }] }))?.problems[0] || '', /emptyArray/);
});

check('a glob with * outside its last segment matches nothing', () => {
  const dir = tree('deepglob', { 'scripts/check_a.py': pyExit(0) }, { checks: [{ glob: 'scr*/check_*.py' }] });
  assert.deepEqual(checks.discoverChecks(dir), []);
});

/* ===================================================================== *
 * 2. judging — exit code alone, and passWhen.emptyArray
 * ===================================================================== */

console.log('\njudging a result\n');

check('byExitCode: 0 is ok', () => assert.equal(checks.byExitCode({ code: 0, out: '' }).ok, true));
check('byExitCode: non-zero is not ok', () => assert.equal(checks.byExitCode({ code: 1, out: '' }).ok, false));
check('byExitCode: a timeout is not ok, whatever the code', () => {
  assert.equal(checks.byExitCode({ code: 0, timedOut: true, out: '' }).ok, false);
});
check('byExitCode: detail is the output\'s last line', () => {
  assert.equal(checks.byExitCode({ code: 0, out: 'first\nlast line\n' }).detail, 'last line');
});

const drift = checks.emptyArrayJudge({ emptyArray: 'drift', label: 'DRIFT', describe: ['gate', 'id'] });

check('emptyArray: exit 0, empty array, is ok', () => {
  assert.equal(drift({ code: 0, stdout: JSON.stringify({ drift: [] }) }).ok, true);
});
check('emptyArray: exit 0, non-empty array, is NOT ok — never mistaken for a pass', () => {
  const r = drift({ code: 0, stdout: JSON.stringify({ drift: [{ gate: 'G1', id: 'x-1' }] }) });
  assert.equal(r.ok, false);
  assert.equal(r.detail, 'DRIFT: G1 x-1');
});
check('emptyArray: without describe, an element is shown whole; without label, the field names it', () => {
  const plain = checks.emptyArrayJudge({ emptyArray: 'stale' });
  assert.equal(plain({ code: 0, stdout: JSON.stringify({ stale: ['a', 'b'] }) }).detail, 'stale: a, b');
});
check('emptyArray: non-zero exit is a failure regardless of the array — it could not even report', () => {
  assert.equal(drift({ code: 1, out: JSON.stringify({ drift: [] }) }).ok, false);
});
check('emptyArray: exit 0 but unparseable output is a failure, not a silent pass', () => {
  assert.equal(drift({ code: 0, stdout: 'not json' }).ok, false);
});
check('emptyArray: parses stdout, not the combined stdout+stderr buffer — a stray stderr line must not break the JSON parse', () => {
  const r = drift({
    code: 0,
    out: 'a stderr warning interleaved mid-buffer' + JSON.stringify({ drift: [] }),
    stdout: JSON.stringify({ drift: [] }),
  });
  assert.equal(r.ok, true);
});

/* ===================================================================== *
 * 3. runCheck / runChecks — real python3 children
 * ===================================================================== */

console.log('\nrunning real python3 children\n');

await checkAsync('a passing check reports ok, a failing one does not, exit code read directly (never through a pipe)', async () => {
  const dir = tree('run-mixed', {
    'scripts/check_pass.py': pyExit(0, 'fine'),
    'scripts/check_fail.py': pyExit(1, 'not fine'),
  });
  const list = checks.discoverChecks(dir);
  const result = await checks.runChecks(dir, list, { jobs: 2 });
  assert.equal(result.total, 2);
  assert.equal(result.passed, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].name, 'scripts/check_fail.py');
});

await checkAsync('a check past its timeout is killed and reported timed out', async () => {
  const dir = tree('run-timeout', {
    'scripts/check_hangs.py': 'import time\ntime.sleep(5)\n',
  });
  const list = checks.discoverChecks(dir);
  const result = await checks.runChecks(dir, list, { jobs: 1, timeoutMs: 200 });
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].timedOut, true);
});

await checkAsync('runChecks pools genuinely concurrently, not spawnSync wearing its clothes', async () => {
  const logPath = path.join(tmp, 'concurrency.jsonl');
  const py = (name) => `
import json
import time
with open(${JSON.stringify(logPath)}, "a") as f:
    f.write(json.dumps({"name": ${JSON.stringify(name)}, "at": "start", "t": time.time()}) + "\\n")
time.sleep(0.4)
with open(${JSON.stringify(logPath)}, "a") as f:
    f.write(json.dumps({"name": ${JSON.stringify(name)}, "at": "end", "t": time.time()}) + "\\n")
`;
  const dir = tree('run-concurrent', {
    'scripts/check_x1.py': py('x1'),
    'scripts/check_x2.py': py('x2'),
  });
  const list = checks.discoverChecks(dir);
  const result = await checks.runChecks(dir, list, { jobs: 2 });
  assert.equal(result.ok, true);
  const events = fs
    .readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  const starts = events.filter((e) => e.at === 'start');
  const ends = events.filter((e) => e.at === 'end');
  const laterStart = Math.max(...starts.map((e) => e.t));
  const earlierEnd = Math.min(...ends.map((e) => e.t));
  assert.ok(laterStart < earlierEnd, `expected overlap: later start ${laterStart}, earlier end ${earlierEnd}`);
});

await checkAsync('env overrides reach the child — how BEADS_DIR is pointed at the checked repo\'s own workspace', async () => {
  const dir = tree('run-env', { 'scripts/check_env.py': 'import os, sys\nsys.exit(0 if os.environ.get("BEADS_DIR") == "/x/y" else 1)\n' });
  const list = checks.discoverChecks(dir);
  const result = await checks.runChecks(dir, list, { jobs: 1, env: { BEADS_DIR: '/x/y' } });
  assert.equal(result.ok, true);
});

await checkAsync('a real status report writing to stderr as well as stdout still parses — end to end, not just the unit judge', async () => {
  const dir = tree('run-stderr-noise', {
    'scripts/status_report.py': `
import json
import sys
print("a noisy warning nobody asked for", file=sys.stderr)
if "--json" in sys.argv:
    print(json.dumps({"drift": []}))
sys.exit(0)
`,
  }, STATUS_DECL);
  const list = checks.discoverChecks(dir);
  assert.equal(list.length, 1);
  const result = await checks.runChecks(dir, list, { jobs: 1 });
  assert.equal(result.ok, true, `expected the DRIFT probe to pass despite stderr noise; got: ${JSON.stringify(result.failed)}`);
});

/* ===================================================================== *
 * 4. classifyAgainstBaseline
 * ===================================================================== */

console.log('\nclassifying against a baseline\n');

check('a check failing both now and at the baseline is ALREADY RED', () => {
  const current = [{ name: 'a', ok: false }];
  const baseline = [{ name: 'a', ok: false }];
  assert.equal(checks.classifyAgainstBaseline(current, baseline)[0].baseline, 'already-red');
});
check('a check failing now but passing at the baseline is newly red', () => {
  const current = [{ name: 'a', ok: false }];
  const baseline = [{ name: 'a', ok: true }];
  assert.equal(checks.classifyAgainstBaseline(current, baseline)[0].baseline, 'newly-red');
});
check('a check with no baseline counterpart at all is newly red, not blamed on nothing', () => {
  const current = [{ name: 'new-check', ok: false }];
  assert.equal(checks.classifyAgainstBaseline(current, [])[0].baseline, 'newly-red');
});
check('a passing check is green whatever the baseline said', () => {
  const current = [{ name: 'a', ok: true }];
  const baseline = [{ name: 'a', ok: false }];
  assert.equal(checks.classifyAgainstBaseline(current, baseline)[0].baseline, 'green');
});
check('matched by name, not position', () => {
  const current = [{ name: 'b', ok: false }, { name: 'a', ok: false }];
  const baseline = [{ name: 'a', ok: false }, { name: 'b', ok: true }];
  const out = checks.classifyAgainstBaseline(current, baseline);
  assert.equal(out.find((c) => c.name === 'a').baseline, 'already-red');
  assert.equal(out.find((c) => c.name === 'b').baseline, 'newly-red');
});

/* ===================================================================== *
 * 5. makeRefWorktree / removeRefWorktree — a real git repo
 * ===================================================================== */

console.log('\nthe baseline worktree\n');

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  });

function makeGitRepo(name, files) {
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
const worktreeCount = (dir) => git(dir, 'worktree', 'list').trim().split('\n').length;

await checkAsync('makeRefWorktree checks out a ref detached, removeRefWorktree leaves nothing behind', async () => {
  const work = makeGitRepo('refwt', { 'scripts/check_a.py': pyExit(0) });
  const before = worktreeCount(work);
  const { dir, scratchRoot } = checks.makeRefWorktree(work, 'main');
  assert.ok(fs.existsSync(path.join(dir, 'scripts', 'check_a.py')));
  assert.equal(worktreeCount(work), before + 1);
  checks.removeRefWorktree(work, dir, scratchRoot);
  assert.equal(worktreeCount(work), before, 'the scratch worktree was removed again');
  assert.equal(fs.existsSync(scratchRoot), false);
});

/* ===================================================================== *
 * 6. the CLI itself
 * ===================================================================== */

console.log('\nthe CLI\n');

check('--dir against a tree that declares no checks is refused with exit 2', () => {
  const dir = tree('cli-nomanifest', { 'scripts/check_a.py': pyExit(0) }, null);
  const run = spawnSync(process.execPath, [BIN, '--dir', dir], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /no manifest/);
});

check('neither -w nor --dir is refused with exit 2 and a usage line', () => {
  const run = spawnSync(process.execPath, [BIN], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /required/);
});

check('an unknown workspace is refused with exit 2', () => {
  const run = spawnSync(process.execPath, [BIN, '-w', 'no-such-workspace-xyz'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /no workspace named/);
});

{
  const dir = tree('cli-mixed', {
    'scripts/check_a_pass.py': pyExit(0),
    'scripts/check_b_fail.py': pyExit(1),
  });

  check('--list prints the selection without running anything', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--list'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.deepEqual(run.stdout.trim().split('\n'), ['scripts/check_a_pass.py', 'scripts/check_b_fail.py']);
  });

  check('--only narrows the CLI selection, exit code never piped through anything else', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--only', 'scripts/check_a_pass.py', '--list'], { encoding: 'utf8' });
    assert.equal(run.stdout.trim(), 'scripts/check_a_pass.py');
  });

  check('--skip drops a named check and nothing else', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--skip', 'scripts/check_b_fail.py', '--list'], { encoding: 'utf8' });
    assert.equal(run.stdout.trim(), 'scripts/check_a_pass.py');
  });

  check('a red check exits 1 and names both checks in the output', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /check_b_fail\.py/);
    assert.match(run.stdout, /check_a_pass\.py/);
  });

  check('a clean tree exits 0', () => {
    const cleanDir = tree('cli-clean', { 'scripts/check_a.py': pyExit(0) });
    const run = spawnSync(process.execPath, [BIN, '--dir', cleanDir], { encoding: 'utf8' });
    assert.equal(run.status, 0);
  });

  check('--json prints one parseable object per line, exit codes never read through a pipe', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--json'], { encoding: 'utf8' });
    const lines = run.stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line), `not JSON: ${line}`);
    const summary = JSON.parse(lines.at(-1));
    assert.equal(summary.summary, true);
    assert.equal(summary.total, 2);
    assert.deepEqual(summary.failed, ['scripts/check_b_fail.py']);
  });
}

await checkAsync('a second invocation on the same tree is refused rather than doubling the load', async () => {
  // The first run must still hold the lock when the second arrives. A fixed 250ms sleep lost
  // that race under the full parallel gate (same flake bc-ifb07 fixed in test/gate.mjs), so
  // wait for the lock file itself and give the first run 5s of work to outlast the probe.
  const dir = tree('cli-lock', { 'scripts/check_slow.py': 'import time\ntime.sleep(5)\n' });
  const { spawn } = await import('node:child_process');
  const probe = checks.acquireLock(dir);
  probe.release();
  const first = spawn(process.execPath, [BIN, '--dir', dir]);
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(probe.lockPath) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  assert.equal(fs.existsSync(probe.lockPath), true, 'the first run never took the lock, so there is nothing to refuse');
  const second = spawnSync(process.execPath, [BIN, '--dir', dir], { encoding: 'utf8' });
  assert.equal(second.status, 2, `expected refusal exit code 2, got ${second.status}: ${second.stderr}`);
  assert.match(second.stderr, /already running/);
  const firstDone = await new Promise((resolve) => first.on('close', (code) => resolve(code)));
  assert.equal(firstDone, 0, 'the first invocation should have run to completion undisturbed');
});

await checkAsync('--baseline: a pre-existing failure is ALREADY RED, a new one is newly red, end to end', async () => {
  const work = makeGitRepo('cli-baseline', {
    '.beadcause/checks.json': JSON.stringify(GLOB_DECL),
    'scripts/check_old.py': pyExit(1, 'always broken'),
    'scripts/check_clean.py': pyExit(0),
  });
  const baselineSha = git(work, 'rev-parse', 'HEAD').trim();
  // Add a NEW failing check on top of the baseline commit — one the baseline ref never had.
  fs.writeFileSync(path.join(work, 'scripts', 'check_new.py'), pyExit(1, 'freshly broken'));
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'add a newly-broken check');

  const run = spawnSync(process.execPath, [BIN, '--dir', work, '--baseline', baselineSha], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  // Strip ANSI colour codes — the tag and the name are on the same printed line but not
  // textually adjacent once the colour escapes for the tag sit between them.
  const plain = run.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(plain, /ALREADY RED\s+scripts\/check_old\.py/);
  assert.match(plain, /newly red\s+scripts\/check_new\.py/);
});

await checkAsync('--baseline at a ref that predates the declaration measures the same set there, not nothing', async () => {
  const work = makeGitRepo('cli-baseline-predates', {
    'scripts/check_old.py': pyExit(1, 'always broken'),
    'scripts/check_clean.py': pyExit(0),
  });
  const baselineSha = git(work, 'rev-parse', 'HEAD').trim();
  fs.mkdirSync(path.join(work, '.beadcause'), { recursive: true });
  fs.writeFileSync(path.join(work, '.beadcause', 'checks.json'), JSON.stringify(GLOB_DECL));
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'declare the gate set');

  const run = spawnSync(process.execPath, [BIN, '--dir', work, '--baseline', baselineSha], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  const plain = run.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(plain, /ALREADY RED\s+scripts\/check_old\.py/, plain);
});

check('--dir against a malformed declaration is refused with exit 2, naming the problem', () => {
  const dir = tree('cli-badjson', { 'scripts/check_a.py': pyExit(0) }, '{ nope');
  const run = spawnSync(process.execPath, [BIN, '--dir', dir], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /does not parse as JSON/);
});

/* --------------------------------------------------------------------- */

removeTreeSync(tmp);

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
