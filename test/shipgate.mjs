#!/usr/bin/env node
//
// b7e-shipgate — b7e-affected piped into b7e-gate --only, and the fallback that makes
// that safe (bc-xlz32.2).
//
//   npm test
//   node test/shipgate.mjs
//
// lib/shipgate.js's decide()/selectionArgsFor()/recordWithOutcome()/parseAffectedJson() are
// pure and tested directly, in milliseconds. A handful of end-to-end checks drive the
// real bin/b7e-shipgate against fabricated trees (the same shape test/gate.mjs and
// test/affected.mjs use) with the real bin/b7e-affected and bin/b7e-gate underneath it —
// slower, but the only way to prove the narrow/fallback/--full decision actually reaches
// the gate and comes back out as the right exit code and the right `tests: ` line.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-shipgate');

const shipgate = await import(path.join(ROOT, 'lib', 'shipgate.js'));
const gate = await import(path.join(ROOT, 'lib', 'gate.js'));

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

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-shipgate-test-'));

/** A fresh `<tmp>/<name>/` tree holding the given files, same shape test/affected.mjs uses. */
const tree = (name, files) => {
  const dir = path.join(tmp, name);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
};

/* ===================================================================== *
 * 1. decide() — narrow, or the three ways to fall back
 * ===================================================================== */

console.log('\ndecide()\n');

check('narrows when every changed file matched at least one suite', () => {
  const d = shipgate.decide({ changedFileCount: 2, suites: ['test/a.mjs', 'test/b.mjs'], unmatchedFiles: [] });
  assert.equal(d.narrow, true);
  assert.deepEqual(d.suites, ['test/a.mjs', 'test/b.mjs']);
  assert.equal(d.record, 'affected: 2 suites for 2 changed files');
});

check('singular suite/file wording', () => {
  const d = shipgate.decide({ changedFileCount: 1, suites: ['test/a.mjs'], unmatchedFiles: [] });
  assert.equal(d.record, 'affected: 1 suite for 1 changed file');
});

check('an unmatched file falls back to the whole gate and names the file', () => {
  const d = shipgate.decide({ changedFileCount: 2, suites: [], unmatchedFiles: ['lib/foo.js'] });
  assert.equal(d.narrow, false);
  assert.deepEqual(d.suites, []);
  assert.equal(d.record, 'full gate: lib/foo.js matched no suite');
});

check('several unmatched files are all named, up to three', () => {
  const d = shipgate.decide({ changedFileCount: 3, suites: [], unmatchedFiles: ['a.js', 'b.js', 'c.js'] });
  assert.equal(d.record, 'full gate: a.js, b.js, c.js matched no suite');
});

check('more than three unmatched files are truncated with a count', () => {
  const d = shipgate.decide({ changedFileCount: 4, suites: [], unmatchedFiles: ['a.js', 'b.js', 'c.js', 'd.js'] });
  assert.equal(d.record, 'full gate: a.js, b.js, c.js, +1 more matched no suite');
});

check('zero changed files falls back to the whole gate, distinctly from an unmatched file', () => {
  const d = shipgate.decide({ changedFileCount: 0, suites: [], unmatchedFiles: [] });
  assert.equal(d.narrow, false);
  assert.equal(d.record, 'full gate: no changed files to narrow against');
});

check('--full skips the affected question entirely, even with changed files matched', () => {
  const d = shipgate.decide({ full: true, changedFileCount: 5, suites: ['test/a.mjs'], unmatchedFiles: [] });
  assert.equal(d.narrow, false);
  assert.deepEqual(d.suites, []);
  assert.equal(d.record, 'full gate: --full requested');
});

check('defaults to the zero-changed-files case with no arguments at all', () => {
  const d = shipgate.decide();
  assert.equal(d.narrow, false);
  assert.equal(d.record, 'full gate: no changed files to narrow against');
});

check('browserOnly reports zero local suites instead of narrowing to names b7e-gate cannot run', () => {
  const d = shipgate.decide({ changedFileCount: 1, suites: [], unmatchedFiles: [], browserOnly: true });
  assert.equal(d.narrow, true);
  assert.equal(d.skip, true);
  assert.deepEqual(d.suites, []);
  assert.match(d.record, /affected: 0 local suites for 1 changed file — every match is a browser check/);
});

check('unmatchedFiles still wins over browserOnly — a genuinely uncovered file always falls back', () => {
  const d = shipgate.decide({ changedFileCount: 2, suites: [], unmatchedFiles: ['lib/nope.js'], browserOnly: true });
  assert.equal(d.narrow, false);
  assert.equal(d.skip, undefined);
  assert.equal(d.record, 'full gate: lib/nope.js matched no suite');
});

/* ===================================================================== *
 * 1b. restrictToKnownSuites() — b7e-affected's universe vs b7e-gate's
 * ===================================================================== */

console.log('\nrestrictToKnownSuites()\n');

check('drops suites b7e-gate does not know about, keeps the rest', () => {
  const r = shipgate.restrictToKnownSuites(['test/a.mjs', 'scripts/foo-check.mjs'], new Set(['test/a.mjs']));
  assert.deepEqual(r.suites, ['test/a.mjs']);
  assert.equal(r.wasMatched, true);
});

check('everything matched was a browser check: empty result, but wasMatched stays true', () => {
  const r = shipgate.restrictToKnownSuites(['scripts/foo-check.mjs'], new Set(['test/a.mjs']));
  assert.deepEqual(r.suites, []);
  assert.equal(r.wasMatched, true);
});

check('nothing matched at all: empty result, wasMatched false — distinct from the browser-check case', () => {
  const r = shipgate.restrictToKnownSuites([], new Set(['test/a.mjs']));
  assert.deepEqual(r.suites, []);
  assert.equal(r.wasMatched, false);
});

check('accepts a plain array for "known", not only a Set', () => {
  const r = shipgate.restrictToKnownSuites(['test/a.mjs'], ['test/a.mjs', 'test/b.mjs']);
  assert.deepEqual(r.suites, ['test/a.mjs']);
});

/* ===================================================================== *
 * 2. selectionArgsFor() — what actually gets handed to b7e-gate
 * ===================================================================== */

console.log('\nselectionArgsFor()\n');

check('a narrowed decision becomes repeated --only flags, then the selection', () => {
  const d = shipgate.decide({ changedFileCount: 1, suites: ['test/a.mjs', 'test/b.mjs'] });
  assert.deepEqual(shipgate.selectionArgsFor(d).slice(0, 4), ['--only', 'test/a.mjs', '--only', 'test/b.mjs']);
});

/* ===================================================================== *
 * 3. recordWithOutcome() — the line built for beadcause-deliver --tests
 * ===================================================================== */

console.log('\nrecordWithOutcome()\n');

check('a passing gate is folded in as "all passed"', () => {
  assert.equal(shipgate.recordWithOutcome('affected: 3 suites for 1 changed file', 0), 'affected: 3 suites for 1 changed file, all passed');
});

check('a failing gate says so instead, and points at the output above', () => {
  assert.equal(
    shipgate.recordWithOutcome('full gate: lib/foo.js matched no suite', 1),
    'full gate: lib/foo.js matched no suite — gate failed, see output above'
  );
});

/* ===================================================================== *
 * 4. parseAffectedJson() — b7e-affected --json's own shape, not re-derived
 * ===================================================================== */

console.log('\nparseAffectedJson()\n');

check('one matched file: a count, the suites, no unmatched', () => {
  const stdout = [
    JSON.stringify({ file: 'lib/a.js', suites: ['test/x.mjs'], reasons: { 'test/x.mjs': ['imports it'] } }),
    JSON.stringify({ summary: true, suites: ['test/x.mjs'], unmatchedFiles: [] }),
  ].join('\n');
  assert.deepEqual(shipgate.parseAffectedJson(stdout), { changedFileCount: 1, suites: ['test/x.mjs'], unmatchedFiles: [] });
});

check('two files, one unmatched: the count is still both, not just the matched one', () => {
  const stdout = [
    JSON.stringify({ file: 'lib/a.js', suites: ['test/x.mjs'], reasons: {} }),
    JSON.stringify({ file: 'lib/nope.js', suites: [], reasons: {} }),
    JSON.stringify({ summary: true, suites: ['test/x.mjs'], unmatchedFiles: ['lib/nope.js'] }),
  ].join('\n');
  assert.deepEqual(shipgate.parseAffectedJson(stdout), {
    changedFileCount: 2,
    suites: ['test/x.mjs'],
    unmatchedFiles: ['lib/nope.js'],
  });
});

check('empty stdout — the zero-changed-files case — is a zero count, not a crash', () => {
  assert.deepEqual(shipgate.parseAffectedJson(''), { changedFileCount: 0, suites: [], unmatchedFiles: [] });
  assert.deepEqual(shipgate.parseAffectedJson('   \n  '), { changedFileCount: 0, suites: [], unmatchedFiles: [] });
});

/* ===================================================================== *
 * 5. the CLI, end to end — real b7e-affected, real b7e-gate, a fabricated tree
 * ===================================================================== */

console.log('\nthe CLI, end to end\n');

{
  const dir = tree('narrow', {
    'lib/a.js': 'export const A = 1;\n',
    'test/x.mjs': "import { A } from '../lib/a.js';\n",
    'test/y.mjs': "// unrelated\n",
    'test/z.mjs': "import { A } from '../lib/a.js';\n",
  });

  check('a matched file narrows to its own suites and reports it, exit 0', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, 'lib/a.js'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.match(run.stderr, /affected: 2 suites for 1 changed file/);
    assert.match(run.stdout, /^tests: affected: 2 suites for 1 changed file, all passed$/m);
    // the narrowing actually reached the gate — the unrelated suite never ran
    assert.doesNotMatch(run.stdout, /test\/y\.mjs/);
    assert.match(run.stdout, /test\/x\.mjs/);
    assert.match(run.stdout, /test\/z\.mjs/);
  });

  check('an unmatched file falls back and runs every suite in the tree', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, 'lib/nope.js'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.match(run.stderr, /full gate: lib\/nope\.js matched no suite/);
    assert.match(run.stdout, /^tests: full gate: lib\/nope\.js matched no suite, all passed$/m);
    assert.match(run.stdout, /test\/x\.mjs/);
    assert.match(run.stdout, /test\/y\.mjs/);
    assert.match(run.stdout, /test\/z\.mjs/);
  });

  check('a file matched only by a browser check reports zero local suites, never a b7e-gate refusal', () => {
    const browserdir = tree('browser-only', {
      'lib/onlybrowser.js': 'export const X = 1;\n',
      'scripts/only-check.mjs': "import { X } from '../lib/onlybrowser.js';\n",
      'test/unrelated.mjs': "// nothing to do with lib/onlybrowser.js\n",
    });
    const run = spawnSync(process.execPath, [BIN, '--dir', browserdir, 'lib/onlybrowser.js'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.match(run.stderr, /affected: 0 local suites for 1 changed file — every match is a browser check/);
    assert.equal(run.stdout.trim(), 'tests: affected: 0 local suites for 1 changed file — every match is a browser check, outside npm test, nothing to run');
    // b7e-gate never even ran — no "nothing matches --only" refusal, no unrelated suite run
    assert.doesNotMatch(run.stdout, /test\/unrelated\.mjs/);
    assert.doesNotMatch(run.stdout, /nothing matches/);
  });

  check('--full skips b7e-affected and runs everything regardless of what changed', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--full', 'lib/a.js'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.match(run.stderr, /full gate: --full requested/);
    assert.match(run.stdout, /test\/x\.mjs/);
    assert.match(run.stdout, /test\/y\.mjs/);
    assert.match(run.stdout, /test\/z\.mjs/);
  });

  check('a red suite in the narrowed set fails the run and says so in the record', () => {
    const reddir = tree('narrow-red', {
      'lib/a.js': 'export const A = 1;\n',
      'test/x.mjs': "import { A } from '../lib/a.js';\nprocess.exit(1);\n",
    });
    const run = spawnSync(process.execPath, [BIN, '--dir', reddir, 'lib/a.js'], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /^tests: affected: 1 suite for 1 changed file — gate failed, see output above$/m);
  });

  check('an unrecognised flag is refused with exit 2, before anything is spawned', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--nope'], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.equal(run.stdout, '');
  });

  check('--help prints usage and exits 0 without touching either subprocess', () => {
    const run = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /usage: b7e-shipgate/);
  });

  check('a --skip flag forwards through to the narrowed gate run', () => {
    // narrowed to [test/x.mjs, test/z.mjs] by lib/a.js, then test/z.mjs is skipped —
    // one suite left, proving --skip actually reached b7e-gate rather than being dropped.
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--skip', 'test/z.mjs', 'lib/a.js'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /all 1 suite passed/);
    assert.match(run.stdout, /test\/x\.mjs/);
    assert.doesNotMatch(run.stdout, /test\/z\.mjs/);
  });

  await checkAsync('killing the wrapper kills the b7e-gate it spawned, not just itself', async () => {
    // Regression: an earlier version left the spawned b7e-gate running, orphaned and
    // still holding the tree's lock, the moment the wrapper was killed instead of
    // letting it finish — a session that killed this command believed nothing was
    // running while a stale run sat on the lock for everyone after it.
    const slowdir = tree('signal-kill', {
      'lib/a.js': 'export const A = 1;\n',
      'test/x.mjs': "import { A } from '../lib/a.js';\nawait new Promise((r) => setTimeout(r, 6000));\n",
    });
    const child = spawn(process.execPath, [BIN, '--dir', slowdir, 'lib/a.js'], { stdio: 'ignore' });
    // Give the wrapper time to spawn b7e-gate and for that to acquire the lock.
    for (let i = 0; i < 40 && !gate.gateLockStatus(slowdir); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(gate.gateLockStatus(slowdir), 'the gate never even started — nothing to prove');
    child.kill('SIGTERM');
    await new Promise((resolve) => child.on('exit', resolve));
    // The lock is released synchronously by b7e-gate's own onExit teardown once it is
    // actually signalled — give that a moment to land, then it must be gone.
    for (let i = 0; i < 20 && gate.gateLockStatus(slowdir); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(gate.gateLockStatus(slowdir), null, 'the spawned b7e-gate must not still hold the lock once the wrapper is gone');
  });
}

/* ===================================================================== *
 * bc-xlz32.14 — b7e-gate narrows by default, and every run says why it is the size it is
 * ===================================================================== */

console.log('\nthe selection, and b7e-gate narrowing by default (bc-xlz32.14)\n');

check('every decision carries its selection kind, and every kind is a known one', () => {
  assert.equal(shipgate.decide({ full: true }).selection, 'full-requested');
  assert.equal(shipgate.decide({}).selection, 'full-fallback');
  assert.equal(shipgate.decide({ changedFileCount: 1, unmatchedFiles: ['lib/x.js'] }).selection, 'full-fallback');
  assert.equal(shipgate.decide({ changedFileCount: 1, suites: ['test/a.mjs'] }).selection, 'affected');
  assert.equal(shipgate.decide({ changedFileCount: 1, browserOnly: true }).selection, 'affected');
  assert.deepEqual([...shipgate.SELECTIONS], ['affected', 'only', 'full-requested', 'full-fallback', 'full-ci']);
});

check('selectionArgsFor hands b7e-gate the decision, and a whole run is always an explicit --full', () => {
  const narrow = shipgate.decide({ changedFileCount: 1, suites: ['test/a.mjs'] });
  assert.deepEqual(shipgate.selectionArgsFor(narrow), ['--only', 'test/a.mjs', '--selection', 'affected', '--selection-reason', narrow.record]);
  const whole = shipgate.decide({ changedFileCount: 1, unmatchedFiles: ['lib/x.js'] });
  // Never a bare b7e-gate: that would now narrow a second time, on its own.
  assert.deepEqual(shipgate.selectionArgsFor(whole), ['--full', '--selection', 'full-fallback', '--selection-reason', whole.record]);
});

check('b7e-affected refusing is a full-fallback with the refusal as its reason, never a crash', () => {
  const fake = path.join(tree('refusing-affected', { 'bin/refuse.mjs': "console.error('not a tree I can read');\nprocess.exit(2);\n" }), 'bin', 'refuse.mjs');
  const d = shipgate.affectedDecision(tmp, [], { affectedBin: fake });
  assert.equal(d.selection, 'full-fallback');
  assert.equal(d.narrow, false);
  assert.match(d.record, /b7e-affected refused — not a tree I can read/);
  assert.match(d.refused, /not a tree I can read/);
});

{
  // A real git tree, so "the diff since main" means something: lib/a.js is edited after
  // the commit, test/x.mjs and test/z.mjs import it, test/y.mjs does not.
  const repo = tree('default-narrows', {
    // as the real repo does — without it, the gate's own run record is a "changed file"
    '.gitignore': '.claude/\n',
    'lib/a.js': 'export const A = 1;\n',
    'test/x.mjs': "import { A } from '../lib/a.js';\n",
    'test/y.mjs': '// unrelated\n',
    'test/z.mjs': "import { A } from '../lib/a.js';\n",
  });
  const g = (...args) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(repo, 'lib', 'a.js'), 'export const A = 2;\n');
  const GATE = path.join(ROOT, 'bin', 'b7e-gate');
  // Neither CI's variables nor a real slot: this has to behave the same on a laptop and a runner.
  const env = { ...process.env, BEADCAUSE_GATE_SLOTS: '0' };
  delete env.CI;
  delete env.GITHUB_ACTIONS;
  const gateRun = (...args) => spawnSync(process.execPath, [GATE, '--dir', repo, ...args], { encoding: 'utf8', env });

  check('a bare b7e-gate runs only what the diff can break, and says --full is one word away', () => {
    const run = gateRun('--list');
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.stdout.trim().split('\n'), ['test/x.mjs', 'test/z.mjs']);
    assert.match(run.stderr, /selection: affected: 2 suites for 1 changed file — `--full` runs all 3/);
  });

  check('--full is every suite, on purpose', () => {
    const run = gateRun('--full', '--list');
    assert.deepEqual(run.stdout.trim().split('\n'), ['test/x.mjs', 'test/y.mjs', 'test/z.mjs']);
    assert.match(run.stderr, /selection: full gate: --full requested — running all 3 suites/);
  });

  check('CI never narrows', () => {
    const run = spawnSync(process.execPath, [GATE, '--dir', repo, '--list'], { encoding: 'utf8', env: { ...env, CI: 'true' } });
    assert.deepEqual(run.stdout.trim().split('\n'), ['test/x.mjs', 'test/y.mjs', 'test/z.mjs']);
    assert.match(run.stderr, /full-ci|CI never narrows/);
  });

  check('--full with --only is refused rather than guessed at', () => {
    assert.equal(gateRun('--full', '--only', 'test/x.mjs', '--list').status, 2);
  });

  check('an unknown --selection is refused', () => {
    assert.equal(gateRun('--selection', 'whatever', '--list').status, 2);
  });

  check('the run record names the selection on its start line', () => {
    const run = gateRun('--run-id', 'selection-record-check');
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /selection: affected: 2 suites/);
    const file = path.join(repo, '.claude', 'gate-runs', 'selection-record-check.jsonl');
    const start = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]);
    assert.deepEqual(start.selection, { kind: 'affected', reason: 'affected: 2 suites for 1 changed file' });
    assert.deepEqual(start.suites, ['test/x.mjs', 'test/z.mjs']);
  });

  check('a fallback says out loud that it is running everything, and records why', () => {
    fs.writeFileSync(path.join(repo, 'lib', 'orphan.js'), 'export const O = 1;\n');
    const run = gateRun('--run-id', 'selection-fallback-check');
    fs.rmSync(path.join(repo, 'lib', 'orphan.js'));
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /selection: full gate: lib\/orphan\.js matched no suite — running all 3 suites/);
    const file = path.join(repo, '.claude', 'gate-runs', 'selection-fallback-check.jsonl');
    const start = JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]);
    assert.equal(start.selection.kind, 'full-fallback');
    assert.equal(start.total, 3);
  });

  check('b7e-shipgate hands its decision in, so the record says affected rather than only', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', repo, 'lib/a.js'], { encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const dir = path.join(repo, '.claude', 'gate-runs');
    const newest = fs.readdirSync(dir).filter((f) => !f.startsWith('selection-')).sort().pop();
    const start = JSON.parse(fs.readFileSync(path.join(dir, newest), 'utf8').split('\n')[0]);
    assert.equal(start.selection.kind, 'affected');
  });
}

/* ===================================================================== */

removeTreeSync(tmp);

console.log(`\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
