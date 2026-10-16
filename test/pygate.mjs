#!/usr/bin/env node
//
// lib/pygate.js — the Python arm of b7e-gate (bc-khoe.61): the interpreter walk-up from a
// fresh worktree with no .venv of its own, exit-code-only gating against a script that
// prints ERROR: lines on a run that still passes, and the CLI dispatch that picks this
// arm from the checkout's own `.beadcause/gate.json` declaration (bc-j2zwo.5) — never
// from a hardcoded script path, and with no default when nothing is declared.
//
// The fake ".venv/bin/python" below is a Node script, not a real interpreter — this repo's
// CI runner is not guaranteed to have Python, and lib/pygate.js never inspects what it
// spawns beyond its exit code, so a Node stand-in exercises the exact same contract.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-gate');

const pygate = await import(path.join(ROOT, 'lib', 'pygate.js'));

process.env.BEADCAUSE_GATE_SLOTS = '0';

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

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-pygate-test-'));

/**
 * The declared script's path in every fixture. Deliberately not any real repo's runner
 * name: the arm must work off the declaration alone, whatever the script is called.
 */
const SCRIPT = path.join('checks', 'run_all.py');

/** Write `<dir>/.beadcause/gate.json` verbatim — a string, so malformed JSON is expressible. */
const declare = (dir, text) => {
  fs.mkdirSync(path.join(dir, '.beadcause'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.beadcause', 'gate.json'), text);
};

/** A Python checkout that declares its gate: the script on disk plus the declaration. */
const pyTree = (name, { declared = true } = {}) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, path.dirname(SCRIPT)), { recursive: true });
  fs.writeFileSync(path.join(dir, SCRIPT), '# not actually run — the fake interpreter ignores it\n');
  if (declared) declare(dir, JSON.stringify({ python: SCRIPT }));
  return dir;
};

/**
 * A `.venv/bin/python` that is actually Node: reads its own argv/env, decides pass or
 * fail from `FAKE_PARTEST_EXIT`, and — unless `quiet` — prints an `ERROR:` line and a
 * traceback-shaped block to stdout regardless of exit code, the same as the real suite
 * does on a run that still passes (bc-khoe.61's whole reason exit code is the only signal
 * `runPythonGate` ever reads).
 */
const fakeInterpreter = (dir, { name = 'python' } = {}) => {
  const bin = path.join(dir, '.venv', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const p = path.join(bin, name);
  const body = [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "const argvPath = process.argv[3] || process.env.FAKE_ARGV_LOG;",
    "if (argvPath) fs.writeFileSync(argvPath, JSON.stringify({ argv: process.argv.slice(2), pythonpath: process.env.PYTHONPATH || null }));",
    "console.log('ERROR: something logged during teardown');",
    "console.log('Traceback (most recent call last): ...');",
    "const sleepMs = Number(process.env.FAKE_PARTEST_SLEEP_MS || 0);",
    "if (sleepMs) { const until = Date.now() + sleepMs; while (Date.now() < until) {} }",
    "process.exit(Number(process.env.FAKE_PARTEST_EXIT || 0));",
  ].join('\n');
  fs.writeFileSync(p, `${body}\n`, { mode: 0o755 });
  return p;
};

/* ===================================================================== *
 * 1. the declaration — which arm a tree is, and which script
 * ===================================================================== */

console.log('\nwhich arm a tree is: its own .beadcause/gate.json\n');

check('a declared tree names its script', () => {
  const dir = pyTree('decl-ok');
  assert.deepEqual(pygate.readGateDecl(dir), { script: SCRIPT });
});
check('the declared path is normalised', () => {
  const dir = pyTree('decl-normalised', { declared: false });
  declare(dir, JSON.stringify({ python: `./${SCRIPT}` }));
  assert.deepEqual(pygate.readGateDecl(dir), { script: SCRIPT });
});
check('no declaration is null — a script on disk alone does not pick the Python arm', () => {
  const dir = pyTree('decl-none', { declared: false });
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tools', 'partest.py'), '# the path the arm used to hardcode\n');
  assert.equal(pygate.readGateDecl(dir), null);
});
check('a declaration that is not JSON is a problem, not a silent null', () => {
  const dir = pyTree('decl-bad-json', { declared: false });
  declare(dir, '{ python: nope');
  assert.match(pygate.readGateDecl(dir).problem, /does not parse as JSON/);
});
check('a declaration with no "python" string is a problem', () => {
  const dir = pyTree('decl-no-key', { declared: false });
  declare(dir, JSON.stringify({ node: 'x.js' }));
  assert.match(pygate.readGateDecl(dir).problem, /needs \{"python"/);
});
check('an absolute or escaping path is a problem', () => {
  const dir = pyTree('decl-escape', { declared: false });
  declare(dir, JSON.stringify({ python: '/usr/bin/true' }));
  assert.match(pygate.readGateDecl(dir).problem, /inside the checkout/);
  declare(dir, JSON.stringify({ python: '../elsewhere/run.py' }));
  assert.match(pygate.readGateDecl(dir).problem, /inside the checkout/);
});
check('a declared script that is not on disk is a problem', () => {
  const dir = pyTree('decl-missing', { declared: false });
  declare(dir, JSON.stringify({ python: 'checks/gone.py' }));
  assert.match(pygate.readGateDecl(dir).problem, /which is not there/);
});

/* ===================================================================== *
 * 2. finding the interpreter — a fresh worktree has no .venv of its own
 * ===================================================================== */

console.log('\nfinding an interpreter\n');

check("root's own .venv/bin/python wins outright", () => {
  const dir = pyTree('venv-own-python');
  const p = fakeInterpreter(dir, { name: 'python' });
  assert.equal(pygate.findInterpreter(dir), p);
});
check('python3 is used when python is absent', () => {
  const dir = pyTree('venv-own-python3');
  const p = fakeInterpreter(dir, { name: 'python3' });
  assert.equal(pygate.findInterpreter(dir), p);
});
check('neither name anywhere reachable is a real null, not a guess', () => {
  const dir = pyTree('venv-none');
  assert.equal(pygate.findInterpreter(dir), null);
});

await checkAsync('a worktree with no .venv of its own walks up to the main checkout that has one', async () => {
  const repoDir = path.join(tmp, 'walkup-main');
  fs.mkdirSync(path.join(repoDir, path.dirname(SCRIPT)), { recursive: true });
  fs.writeFileSync(path.join(repoDir, SCRIPT), '# fixture\n');
  execFileSync('git', ['init', '-q', repoDir]);
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'test']);
  fs.writeFileSync(path.join(repoDir, 'README'), 'fixture\n');
  execFileSync('git', ['-C', repoDir, 'add', '-A']);
  execFileSync('git', ['-C', repoDir, 'commit', '-q', '-m', 'init']);
  const mainInterpreter = fakeInterpreter(repoDir, { name: 'python' });

  const worktreeDir = path.join(tmp, 'walkup-worktree');
  execFileSync('git', ['-C', repoDir, 'worktree', 'add', '-q', worktreeDir, '-b', 'wt-fixture']);

  assert.equal(pygate.findInterpreter(worktreeDir), mainInterpreter);
});

/* ===================================================================== *
 * 3. running the one process — exit code only, never the scraped output
 * ===================================================================== */

console.log('\nrunning the one process, gated on its exit code alone\n');

await checkAsync('exit 0 is ok even though stdout is full of ERROR: lines', async () => {
  const dir = pyTree('run-pass');
  const interpreter = fakeInterpreter(dir);
  const r = await pygate.runPythonGate(dir, { interpreter, script: SCRIPT, extraArgs: [] });
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.match(r.out, /ERROR:/, 'the fixture is supposed to print ERROR: regardless of exit code — that is the whole point');
});

await checkAsync('a non-zero exit is not ok, same ERROR: noise or not', async () => {
  const dir = pyTree('run-fail');
  const interpreter = fakeInterpreter(dir);
  process.env.FAKE_PARTEST_EXIT = '1';
  try {
    const r = await pygate.runPythonGate(dir, { interpreter, script: SCRIPT, extraArgs: [] });
    assert.equal(r.ok, false);
    assert.equal(r.code, 1);
  } finally {
    delete process.env.FAKE_PARTEST_EXIT;
  }
});

await checkAsync('PYTHONPATH is set to "." and extraArgs are forwarded verbatim', async () => {
  const dir = pyTree('run-argv');
  const interpreter = fakeInterpreter(dir);
  const argvLog = path.join(tmp, 'argv-log.json');
  const r = await pygate.runPythonGate(dir, { interpreter, script: SCRIPT, extraArgs: [argvLog, 'tests.test_costing'] });
  assert.equal(r.ok, true);
  const logged = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
  assert.deepEqual(logged.argv, [SCRIPT, argvLog, 'tests.test_costing']);
  assert.equal(logged.pythonpath, '.');
});

await checkAsync('a run past its timeout is killed and reported TIMEOUT, not FAIL', async () => {
  const dir = pyTree('run-timeout');
  const interpreter = fakeInterpreter(dir);
  process.env.FAKE_PARTEST_SLEEP_MS = '4000';
  try {
    const r = await pygate.runPythonGate(dir, { interpreter, script: SCRIPT, timeoutMs: 200 });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
  } finally {
    delete process.env.FAKE_PARTEST_SLEEP_MS;
  }
});

/* ===================================================================== *
 * 4. the CLI — dispatch, refusals, and the shared lock
 * ===================================================================== */

console.log('\nthe CLI dispatches on the tree\'s own declaration\n');

{
  const dir = pyTree('cli-pass');
  fakeInterpreter(dir);
  check('--list prints the command line for the Python arm, without running anything', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--list'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /PYTHONPATH=\. .*python.*checks[\\/]run_all\.py/);
  });
  check('a passing script exits 0 through the CLI', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  });
  check('--json summarises the single logical suite', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--json'], { encoding: 'utf8' });
    const lines = run.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = lines.at(-1);
    assert.equal(summary.summary, true);
    assert.equal(summary.total, 1);
    assert.equal(summary.passed, 1);
    assert.deepEqual(summary.failed, []);
  });
}

{
  const dir = pyTree('cli-fail');
  fakeInterpreter(dir);
  check('a failing script exits 1 through the CLI, tail printed despite the ERROR: noise', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir], {
      encoding: 'utf8',
      env: { ...process.env, FAKE_PARTEST_EXIT: '1' },
    });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /FAIL/);
  });
}

{
  const dir = pyTree('cli-extra-args');
  fakeInterpreter(dir);
  check('tokens after -- reach the script as its own argv', () => {
    const argvLog = path.join(tmp, 'cli-argv-log.json');
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--', argvLog, 'tests.test_costing'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const logged = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
    assert.deepEqual(logged.argv.slice(1), [argvLog, 'tests.test_costing']);
  });
}

{
  const dir = pyTree('cli-only-refused');
  fakeInterpreter(dir);
  check('--only/--skip are refused on the Python arm rather than silently ignored', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--only', 'tests.test_costing'], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /--only\/--skip do not apply here/);
  });
}

{
  const dir = pyTree('cli-undeclared', { declared: false });
  fakeInterpreter(dir);
  check('an undeclared tree never takes the Python arm, even with a script and a .venv on disk', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--list'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stdout, /PYTHONPATH=/);
  });
}

{
  const dir = pyTree('cli-bad-decl', { declared: false });
  fakeInterpreter(dir);
  declare(dir, JSON.stringify({ python: 'checks/gone.py' }));
  check('an unusable declaration refuses with exit 2 and says why, rather than falling back', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /gate\.json declares checks[\\/]gone\.py, which is not there/);
  });
}

check('no interpreter anywhere reachable refuses with exit 2, not a crash', () => {
  const dir = pyTree('cli-no-interpreter');
  const run = spawnSync(process.execPath, [BIN, '--dir', dir], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /no \.venv\/bin\/python/);
});

await checkAsync('the Python arm takes lib/gate.js\'s own per-tree lock — a concurrent second run is refused', async () => {
  const dir = pyTree('cli-lock-shared');
  fakeInterpreter(dir);
  process.env.FAKE_PARTEST_SLEEP_MS = '900';
  const { spawn } = await import('node:child_process');
  const first = spawn(process.execPath, [BIN, '--dir', dir], { env: process.env });
  await new Promise((r) => setTimeout(r, 250));
  const second = spawnSync(process.execPath, [BIN, '--dir', dir], { encoding: 'utf8' });
  delete process.env.FAKE_PARTEST_SLEEP_MS;
  assert.equal(second.status, 2, `expected the shared lock's refusal, got ${second.status}: ${second.stderr}`);
  assert.match(second.stderr, /already running/);
  const firstDone = await new Promise((resolve) => first.on('close', (code) => resolve(code)));
  assert.equal(firstDone, 0, 'the first invocation should have run to completion undisturbed');
});

/* --------------------------------------------------------------------- */

removeTreeSync(tmp);

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall pygate checks passed\n');
process.exit(failures ? 1 : 0);
