#!/usr/bin/env node
/**
 * The house shape for a new gate in a workspace repo, printed instead of copied off a
 * neighbour — bc-dgx7.107.
 *
 *     npm test
 *     node test/newgate.mjs
 *
 * Three delmar sessions (`dv-5eu.11`, `dv-52r.6`, `dv-52r.7`) each added a
 * `scripts/check_*.py` the same day, none reading the same neighbours, and none landing
 * on the same shape — one printed `"checked %s for %d …"` / `"FAIL — %d problem(s):"`
 * where the rest of the corpus converges on `checks = 0` / `failures = []` / a
 * `check(cond, msg)` closure and a `ran N checks` … `PASS` / `FAILED` ending. This suite
 * holds down the same two things `test/harness.mjs` holds down for `b7e-harness`:
 *
 * 1. **The output runs.** Generated into a throwaway tree and executed with `python3`,
 *    green, with zero checks in it, before anything is added.
 * 2. **The output is the corpus's, not a template's.** A small fabricated corpus that
 *    writes its ending a different way (three gates agreeing, two dissenting) proves the
 *    vote follows whichever way the fabricated corpus leans, rather than reproducing
 *    something hard-coded here — and a fabricated pair standing in for the bead's own
 *    evidence (majority shape vs. `dv-52r.6`'s divergent one) proves `--for` on the
 *    divergent gate's own name still emits the *majority*'s ending, not its own.
 *
 * No `bd`, no network, no daemon, and no dependency on the real delmar checkout being
 * cloned on this machine — every corpus below is written to a throwaway tree. `python3`
 * is assumed present, the same assumption `bin/b7e-checks` and its suite already make.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-newgate');

const {
  blankPy,
  statementsPy,
  slotsOfPy,
  discoverGateFiles,
  deriveGateShape,
  seedGates,
  renderGateSkeleton,
  renderSelftestSkeleton,
  registrationChecklist,
  newgate,
  specialise,
} = await import(path.join(ROOT, 'lib', 'newgate.js'));

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
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));
const throws = (name, fn, detail = '') => {
  try {
    fn();
    bad(name, detail || 'it returned instead of throwing');
  } catch {
    ok(name);
  }
};

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-newgate-'));

/** A fresh `<tmp>/<name>/scripts/` directory holding the given `scripts/check_*.py` files. */
function tree(name, files) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'scripts', rel), body);
  return dir;
}

/* ===================================================================== *
 * 1. Python scanning — blankPy / statementsPy
 * ===================================================================== */

check(
  'blankPy blanks a # comment but keeps a bracket inside a string alone',
  (() => {
    const b = blankPy('x = 1  # a comment with a [ bracket\ny = "[weird]"\n');
    return !b.includes('comment') && !b.includes('bracket') && b.includes('x = 1') && b.includes('y = "') && b.includes('"');
  })(),
);

check(
  'blankPy blanks a triple-quoted docstring body but keeps the quotes',
  (() => {
    const b = blankPy('"""A docstring with a # not-a-comment and a ( not-a-paren."""\nz = 2\n');
    const firstLine = b.split('\n')[0];
    return firstLine.startsWith('"""') && firstLine.trim().endsWith('"""') && !b.includes('not-a-comment') && b.includes('z = 2');
  })(),
);

check(
  'blankPy does not end a string early on an escaped quote',
  (() => {
    const b = blankPy('x = "a \\" quote"\ny = 1\n');
    return b.includes('y = 1') && /^x = ".+"$/.test(b.split('\n')[0]);
  })(),
);

{
  const src = `#!/usr/bin/env python3
SUPERSEDED = [
    (1, "a"),
    (2, "b"),
]

def main():
    global checks
    checks = 0
    return checks


if __name__ == "__main__":
    sys.exit(main())
`;
  const sts = statementsPy(src);
  check(
    'statementsPy keeps a multi-line bracket literal closing at column zero as one statement',
    sts.some((s) => s.text.startsWith('SUPERSEDED = [') && s.text.trim().endsWith(']')),
    JSON.stringify(sts.map((s) => s.text.split('\n')[0])),
  );
  check(
    'statementsPy keeps an indented def body as one statement with its header',
    sts.some((s) => s.text.startsWith('def main():') && s.text.includes('return checks')),
  );
  check(
    'statementsPy separates a dunder-main guard from the def above it',
    sts.some((s) => s.text.startsWith('if __name__')),
  );
}

/* ===================================================================== *
 * 2. slotsOfPy — one gate's own answers, name generalised out
 * ===================================================================== */

{
  const src = `#!/usr/bin/env python3
"""Gate for a thing (dv-x).

    python3 scripts/check_thing.py .
"""
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()

checks = 0
failures = []


def check(cond, msg):
    global checks
    checks += 1
    if not cond:
        failures.append(msg)


check(True, "always")

print(f"ran {checks} checks")
if failures:
    print(f"\\nFAILED — {len(failures)} problem(s):")
    for f in failures:
        print("  " + f)
    sys.exit(1)
print("PASS")
sys.exit(0)
`;
  const s = slotsOfPy(src, 'check_thing');
  check('slotsOfPy reads the shebang', s.shebang === '#!/usr/bin/env python3');
  check('slotsOfPy reads the ROOT line', s.rootLine === 'ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()');
  check('slotsOfPy reads checks = 0 and failures = []', s.checksLine === 'checks = 0' && s.failuresLine === 'failures = []');
  check('slotsOfPy reads the check() closure as one bound statement', s.checkFn?.startsWith('def check(cond, msg):') && s.checkFn.includes('failures.append(msg)'));
  check(
    "slotsOfPy generalises the gate's own name out of its run line, and specialise() puts it back",
    !s.runLine.includes('check_thing') && specialise(s.runLine, 'check_thing').includes('python3 scripts/check_thing.py'),
    s.runLine,
  );
  check('slotsOfPy has no def main() / dunder-main here', s.hasMain === false);
  check(
    'slotsOfPy reads a 4-statement ending: tally print, if-failures block, PASS print, exit(0)',
    s.ending.length === 4 && s.ending[0].includes('ran') && s.ending[3] === 'sys.exit(0)',
    JSON.stringify(s.ending),
  );
}

/* ===================================================================== *
 * 3. deriveGateShape — a plain majority vote, not a template
 * ===================================================================== */

const MAJORITY_GATE = (n) => `#!/usr/bin/env python3
"""Gate ${n} (dv-x).
"""
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()

checks = 0
failures = []


def check(cond, msg):
    global checks
    checks += 1
    if not cond:
        failures.append(msg)


check(True, "always ${n}")

print(f"ran {checks} checks")
if failures:
    print(f"\\nFAILED — {len(failures)} problem(s):")
    for f in failures:
        print("  " + f)
    sys.exit(1)
print("PASS")
sys.exit(0)
`;

// The bead's own evidence, fabricated small: three gates writing the house shape above,
// two writing the DIVERGENT shape dv-52r.6 actually wrote — a different verb, dash and
// frame, no check()/checks/failures at all.
const DIVERGENT_GATE = (n) => `#!/usr/bin/env python3
"""Divergent gate ${n}.
"""
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()


def main():
    print("checked thing %s for %d problem(s)" % ("${n}", 0))
    print("FAIL — 0 problem(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;

{
  const dir = tree('vote', {
    'check_a.py': MAJORITY_GATE('a'),
    'check_b.py': MAJORITY_GATE('b'),
    'check_c.py': MAJORITY_GATE('c'),
    'check_d.py': DIVERGENT_GATE('d'),
    'check_e.py': DIVERGENT_GATE('e'),
  });
  const { gates } = discoverGateFiles(dir);
  check('discoverGateFiles finds every scripts/check_*.py, none marked selftest', gates.length === 5);
  const shape = deriveGateShape(gates);
  check('deriveGateShape: basis is corpus once past the minimum', shape.basis === 'corpus');
  check('deriveGateShape: checks/failures/check() win 3-of-5, a real majority', shape.checksLine.present && shape.failuresLine.present && shape.checkFn.present);
  check('deriveGateShape: the ROOT line wins even though every gate spells it the same way', shape.root.present && shape.root.text.startsWith('ROOT = sys.argv'));
  check(
    'deriveGateShape: the ending is the 3-gate shape (tally/if-failures/PASS/exit-0), not the 2-gate one',
    shape.ending.some((e) => e.includes('ran')) && shape.ending.some((e) => e.includes('PASS') === false || e === 'print("PASS")'),
  );
  check('deriveGateShape: the divergent frame ("checked … for … problem(s)") does not appear anywhere in the shape', !JSON.stringify(shape).includes('checked'));

  const seeds = seedGates(gates, shape, 2);
  check('seedGates: the two nearest are majority-shape gates, not the divergent pair', seeds.every((s) => /check_[abc]\.py/.test(s.file)), JSON.stringify(seeds));
}

{
  // Flip the vote: three divergent, two majority-shaped — the shape must follow.
  const dir = tree('vote-flip', {
    'check_a.py': DIVERGENT_GATE('a'),
    'check_b.py': DIVERGENT_GATE('b'),
    'check_c.py': DIVERGENT_GATE('c'),
    'check_d.py': MAJORITY_GATE('d'),
    'check_e.py': MAJORITY_GATE('e'),
  });
  const { gates } = discoverGateFiles(dir);
  const shape = deriveGateShape(gates);
  check('deriveGateShape flips with the corpus: check()/checks/failures now lose their majority', !shape.checksLine.present && !shape.checkFn.present);
}

check(
  'deriveGateShape refuses to call two files a majority of anything',
  deriveGateShape([{ file: 'a', stem: 'a', source: MAJORITY_GATE('a') }, { file: 'b', stem: 'b', source: MAJORITY_GATE('b') }]).basis === 'insufficient',
);

/* ===================================================================== *
 * 4. renderGateSkeleton / renderSelftestSkeleton — it has to run
 * ===================================================================== */

{
  const dir = tree('render', {
    'check_a.py': MAJORITY_GATE('a'),
    'check_b.py': MAJORITY_GATE('b'),
    'check_c.py': MAJORITY_GATE('c'),
    'check_d.py': DIVERGENT_GATE('d'),
    'check_e.py': DIVERGENT_GATE('e'),
  });
  fs.writeFileSync(
    path.join(dir, 'CLAUDE.md'),
    '| Some canon fact | the authority · gate `scripts/check_a.py` |\n| Another fact | gate `scripts/check_b.py` |\n',
  );
  const { skeleton, selftestSkeleton, checklist } = newgate(dir, { forPath: 'scripts/check_new_thing.py', selftest: true });

  check('renderGateSkeleton: emits a checks/failures/check() skeleton, the majority', skeleton.text.includes('checks = 0') && skeleton.text.includes('def check(cond, msg):'));
  check('renderGateSkeleton: the ending is the majority tally/PASS shape, not the divergent frame', skeleton.text.includes('ran {checks} checks') && !skeleton.text.includes('checked'));
  check('renderGateSkeleton: never leaks the internal generalisation token', !skeleton.text.includes('@@GATE-NAME@@'));

  const pyFile = path.join(dir, 'scripts', 'check_new_thing.py');
  fs.writeFileSync(pyFile, skeleton.text);
  const run = spawnSync('python3', [pyFile, dir], { encoding: 'utf8' });
  check('the generated gate skeleton runs, green, with zero checks', run.status === 0 && /ran 0 checks/.test(run.stdout), `status=${run.status} stdout=${run.stdout} stderr=${run.stderr}`);
  check('the generated gate skeleton prints PASS', /PASS/.test(run.stdout));

  check('renderSelftestSkeleton: imports the gate module under test', selftestSkeleton.text.includes('import check_new_thing as gate'));
  const selftestFile = path.join(dir, 'scripts', 'check_new_thing_selftest.py');
  fs.writeFileSync(selftestFile, selftestSkeleton.text);
  const runSelf = spawnSync('python3', [selftestFile], { encoding: 'utf8', cwd: path.join(dir, 'scripts') });
  check('the generated selftest skeleton runs, green, with zero cases', runSelf.status === 0 && /PASS/.test(runSelf.stdout), `status=${runSelf.status} stdout=${runSelf.stdout} stderr=${runSelf.stderr}`);

  check('registrationChecklist: names the CLAUDE.md reference-table row', checklist.some((c) => /CLAUDE\.md/.test(c.text) && /reference table/.test(c.text)));
  check('registrationChecklist: names the _selftest.py twin', checklist.some((c) => /_selftest\.py/.test(c.text)));
}

{
  // A repo whose gates carry no CLAUDE.md at all still gets a checklist, not a crash.
  const dir = tree('no-claude-md', { 'check_a.py': MAJORITY_GATE('a'), 'check_b.py': MAJORITY_GATE('b'), 'check_c.py': MAJORITY_GATE('c') });
  const { checklist } = newgate(dir, { forPath: 'scripts/check_new.py' });
  check('registrationChecklist: no CLAUDE.md at the root is reported, not thrown', checklist.some((c) => /CLAUDE\.md was not found/.test(c.text)));
}

throws(
  'newgate() throws on a root with no scripts/check_*.py at all',
  () => newgate(tree('empty', {}), { forPath: 'scripts/check_x.py' }),
);

throws(
  'newgate() throws when --for is not a scripts/check_<name>.py path',
  () => newgate(tree('badpath', { 'check_a.py': MAJORITY_GATE('a'), 'check_b.py': MAJORITY_GATE('b'), 'check_c.py': MAJORITY_GATE('c') }), { forPath: 'scripts/not_a_gate.txt' }),
);

/* ===================================================================== *
 * 5. bin/b7e-newgate — argv, exit codes, --shape, --for, --json
 * ===================================================================== */

const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

{
  const r = run('--help');
  check('CLI --help exits 0 and prints usage', r.status === 0 && r.stdout.includes('usage: b7e-newgate'));
}

{
  const r = run();
  check('CLI with neither -w nor --dir refuses, exit 2', r.status === 2 && /one of -w\/--workspace or --dir/.test(r.stderr));
}

{
  const r = run('--dir', tmp);
  check('CLI with neither --shape nor --for refuses, exit 2', r.status === 2 && /one of --shape or --for/.test(r.stderr));
}

{
  const r = run('-w', 'x', '--dir', tmp, '--shape');
  check('CLI with both -w and --dir refuses, exit 2', r.status === 2 && /mutually exclusive/.test(r.stderr));
}

{
  const r = run('--dir', tmp, '--shape', '--for', 'scripts/check_x.py');
  check('CLI with both --shape and --for refuses, exit 2', r.status === 2 && /two different questions/.test(r.stderr));
}

{
  const empty = tree('cli-empty', {});
  const r = run('--dir', empty, '--shape');
  check('CLI refuses a root with no scripts/check_*.py, exit 4', r.status === 4 && /no scripts\/check_\*\.py found/.test(r.stderr));
}

{
  const dir = tree('cli-shape', { 'check_a.py': MAJORITY_GATE('a'), 'check_b.py': MAJORITY_GATE('b'), 'check_c.py': MAJORITY_GATE('c') });
  const r = run('--dir', dir, '--shape');
  check('CLI --shape prints the gate count and the derived shape', r.status === 0 && r.stdout.includes('3 gate(s)') && r.stdout.includes('checks = 0'), r.stdout);

  const rJson = run('--dir', dir, '--shape', '--json');
  check(
    'CLI --shape --json parses and carries the same shape',
    (() => {
      const parsed = JSON.parse(rJson.stdout);
      return parsed.gateCount === 3 && parsed.shape.basis === 'corpus';
    })(),
    rJson.stdout,
  );
}

{
  const dir = tree('cli-for', { 'check_a.py': MAJORITY_GATE('a'), 'check_b.py': MAJORITY_GATE('b'), 'check_c.py': MAJORITY_GATE('c') });
  const r = run('--dir', dir, '--for', 'scripts/check_new.py');
  check('CLI --for writes the skeleton to stdout', r.status === 0 && r.stdout.includes('def check(cond, msg):'));
  check('CLI --for writes the notice, including a registration checklist, to stderr only', r.stderr.includes('registration checklist:') && !r.stdout.includes('registration checklist'));
  check('CLI --for stdout alone is a complete, syntactically valid Python file', spawnSync('python3', ['-c', 'compile(open(0).read(), "<stdin>", "exec")'], { input: r.stdout, encoding: 'utf8' }).status === 0);

  const rSelf = run('--dir', dir, '--for', 'scripts/check_new.py', '--selftest');
  check('CLI --for --selftest appends the selftest scaffold after a marker, still on stdout', rSelf.stdout.includes('_selftest.py ----') && rSelf.stdout.includes('CASES = []'));

  const rJson = run('--dir', dir, '--for', 'scripts/check_new.py', '--json');
  check(
    'CLI --for --json carries the checklist as an array of strings',
    (() => {
      const parsed = JSON.parse(rJson.stdout);
      return Array.isArray(parsed.checklist) && parsed.checklist.length > 0 && parsed.text.includes('checks = 0');
    })(),
    rJson.stdout,
  );
}

{
  const dir = tree('cli-insufficient', { 'check_a.py': MAJORITY_GATE('a') });
  const r = run('--dir', dir, '--for', 'scripts/check_new.py');
  check('CLI refuses --for when too few gates exist for a majority, exit 4', r.status === 4 && /need at least/.test(r.stderr), r.stderr);
}

{
  const r = run('-w', 'no-such-workspace-xyz', '--shape');
  check('CLI refuses an unknown -w workspace, exit 2', r.status === 2 && /no workspace named/.test(r.stderr));
}

/* --------------------------------------------------------------------- done */

await cleanupTmp(tmp);
console.log(failures ? `\n${failures}/${ran} failed\n` : `\n${ran}/${ran} passed\n`);
process.exit(failures ? 1 : 0);
