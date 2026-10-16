#!/usr/bin/env node
//
// b7e-vouch — the delivery call checked against the branch, before it fires (bc-dgx7.130).
//
//   npm test
//   node test/b7evouch.mjs
//
// lib/vouch.js has the three checks (flags, paths, tests-vs-ran), each pure and driven
// directly here with fabricated strings. The CLI sections drive the real binary against a
// real `git` fixture (same argument test/b7efresh.mjs makes) with a fake `bd` on PATH
// (same shape test/b7enotes.mjs's own fixture uses).
//
// Replays of real deliveries through the binary live with the repo whose deliveries they
// are, not here (bc-cpl6x): a real PR body is that project's content, and this file is
// generic. Two traps those replays found are kept below in synthetic form — a plain
// lowercase stem must not stand in for a file, and a gate renamed in --tests is a finding.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-vouch');

const vouch = await import(path.join(ROOT, 'lib', 'vouch.js'));

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${String(detail).split('\n').join('\n      ')}`);
};
/** `cond` is either a plain boolean expression or a function returning one — a function
 * so a check can compute intermediate values (spawn the CLI, parse its output) without a
 * separate variable declaration above the call. A thrown error is a failure, not a crash. */
const check = (name, cond, detail = '') => {
  try {
    const result = typeof cond === 'function' ? cond() : cond;
    if (result) ok(name);
    else bad(name, detail);
  } catch (err) {
    bad(name, err.message);
  }
};

/* ===================================================================== *
 * 1. lib/vouch.js — pure, synthetic
 * ===================================================================== */

console.log('\nmentionsToken\n');

check('finds a flag written literally', vouch.mentionsToken('passing --review since I placed every pin', '--review'));
check('does not match inside a longer flag', !vouch.mentionsToken('run with --reviewed on', '--review'));
check('does not match inside a longer identifier', !vouch.mentionsToken('CHANGE_LOG_ARCHIVE.md', 'CHANGE_LOG'));
check('matches at the very start of the text', vouch.mentionsToken('--review is why', '--review'));
check('matches at the very end of the text', vouch.mentionsToken('why: --review', '--review'));
check('empty text or token is never a match', !vouch.mentionsToken('', '--review') && !vouch.mentionsToken('text', ''));

console.log('\ncheckFlags\n');

{
  const f = vouch.checkFlags('Passing --review since every pin is mine.', ['--tests', 'x']);
  check('body claims --review, argv lacks it: exactly one finding', f.length === 1, JSON.stringify(f));
  check('names --review and where it was claimed', /body claims --review/.test(f[0]?.message || ''), f[0]?.message);
}

check('argv passes --review, body never mentions it: one finding (governance flag, reverse direction)', () => {
  const f = vouch.checkFlags('Just fixed a typo.', ['--review']);
  return f.length === 1 && /argv passes --review — the body never mentions it/.test(f[0].message);
});

check('both agree on --review present: silent', vouch.checkFlags('Passing --review.', ['--review']).length === 0);
check('both agree --review absent: silent', vouch.checkFlags('Just fixed a typo.', ['--tests', 'x']).length === 0);

check('--no-merge is the same governance flag as --review', () => {
  const f = vouch.checkFlags('Requesting --no-merge on this one.', []);
  return f.length === 1 && /--no-merge/.test(f[0].message);
});

check('a non-governance flag only checks the forward direction — argv having --tests unmentioned is silent', vouch.checkFlags('No claims here.', ['--tests', 'affected: 3 suites, all passed']).length === 0);

check('a non-governance flag claimed in body but missing from argv still fires', () => {
  const f = vouch.checkFlags('Used a custom --title for this one.', ['--tests', 'x']);
  return f.length === 1 && /--title/.test(f[0].message);
});

check('no `--` given at all (argvTail null): always silent, whatever the body claims', vouch.checkFlags('Passing --review.', null).length === 0);

check('an unrelated double-dash flag not on deliver.js’s surface is ignored entirely', vouch.checkFlags('run the make_interactive.py --force-legacy base-PNG render', []).length === 0);

console.log('\ncheckPaths — synthetic\n');

check('a changed file mentioned by full path: silent', vouch.checkPaths('Edited lib/foo.js for the fix.', '', ['lib/foo.js']).length === 0);
check('a changed file mentioned by bare basename: silent', vouch.checkPaths('Edited foo.js for the fix.', '', ['lib/foo.js']).length === 0);
check('a changed file mentioned only by its stem (an identifier-shaped one): silent', vouch.checkPaths('Updated CHANGE_LOG with the new entry.', '', ['CHANGE_LOG.md']).length === 0);
check('a changed file mentioned nowhere: one finding naming it', () => {
  const f = vouch.checkPaths('Nothing about this file.', '', ['lib/bar.js']);
  return f.length === 1 && /lib\/bar\.js changed — the body never mentions it/.test(f[0].message);
});
check('the bead’s own context is a fallback source of a mention', vouch.checkPaths('See the bead for detail.', 'lib/bar.js needed a fix too.', ['lib/bar.js']).length === 0);
check('the bead’s context never supplies a NEW claim — a file only the context names, that is not in the diff, does not itself become a "body names a path not in the diff" finding', () => {
  const f = vouch.checkPaths('Nothing relevant.', 'lib/unrelated.js is mentioned here.', ['lib/bar.js']);
  // lib/bar.js is still genuinely unmentioned (by body or context) — one finding, and it
  // must be about lib/bar.js, never about lib/unrelated.js (which only the context names).
  return f.length === 1 && /lib\/bar\.js changed/.test(f[0].message);
});
check('a body-named path not in the diff: one finding', () => {
  const f = vouch.checkPaths('Touched lib/real.js and also, confusingly, mentioned lib/ghost.js — never actually part of this diff.', '', ['lib/real.js']);
  return f.length === 1 && /body names lib\/ghost\.js/.test(f[0].message);
});
check('a plain lowercase stem (a common word, not identifier-shaped) never stands in for an unrelated file', () => {
  // "regions" the word must not silently cover "regions.json" the file.
  const f = vouch.checkPaths('New docs/regions/guides/world_x.md carries the entries.', '', [
    'web/data/regions.json',
    'docs/regions/guides/world_x.md',
  ]);
  return f.length === 1 && /regions\.json changed/.test(f[0].message);
});
check('a `.py` mentioned only inside a **Tests:** paragraph is not read as a "this file changed" claim', vouch.checkPaths('Fixed the bug.\n\n**Tests:** python3 scripts/check_ghost.py . -> PASS', '', ['lib/real.js']).length === 1); // only the unmentioned lib/real.js finding, not a spurious check_ghost.py-not-in-diff finding
check('and specifically: no finding names the script from the Tests paragraph', () => {
  const f = vouch.checkPaths('Fixed the bug.\n\n**Tests:** python3 scripts/check_ghost.py . -> PASS', '', ['lib/real.js']);
  return !f.some((x) => /check_ghost/.test(x.message));
});
check('the auto-generated <details> Files-changed block is excluded from claim-extraction, not just the Tests paragraph', () => {
  const body = 'Fixed the bug.\n\n<details><summary><b>Files changed</b></summary>\n\n```\nsome/generated/path.js  +1 -1\n```\n\n</details>';
  const f = vouch.checkPaths(body, '', []);
  return !f.some((x) => /some\/generated\/path\.js/.test(x.message));
});

console.log('\nextractGateNames / checkTests\n');

check('pulls script-shaped names out of a --tests value', () => {
  const names = vouch.extractGateNames('python3 scripts/check_style_audit.py . -> PASS; test/b7evouch.mjs also green');
  return names.includes('scripts/check_style_audit.py') && names.includes('test/b7evouch.mjs');
});
check('a bare summary with no script names extracts nothing', vouch.extractGateNames('affected: 14 suites for 2 changed files, all passed').length === 0);
check('no --ran content: silent regardless of --tests', vouch.checkTests('scripts/check_x.py PASS', null, 'r').length === 0);
check('no --tests value: silent', vouch.checkTests(null, 'scripts/check_x.py: ok', 'r').length === 0);
check('a gate named in --tests is found in --ran: silent', vouch.checkTests('scripts/check_x.py PASS', 'scripts/check_x.py: ok\n', 'run.log').length === 0);
check('a gate named in --tests, absent from --ran: one finding naming it and where it looked', () => {
  const f = vouch.checkTests('scripts/check_x.py PASS', 'scripts/check_y.py: ok\n', 'run.log');
  return f.length === 1 && /check_x\.py/.test(f[0].message) && /run\.log/.test(f[0].message);
});
check('renaming a gate that used to be in --ran makes it exit-worthy — the shape the bead names', () => {
  const before = vouch.checkTests('scripts/check_style_audit.py PASS', 'scripts/check_style_audit.py: ok\n', 'run.log');
  const after = vouch.checkTests('scripts/check_style_audits.py PASS', 'scripts/check_style_audit.py: ok\n', 'run.log');
  return before.length === 0 && after.length === 1;
});

/* ===================================================================== *
 * 2. bin/b7e-vouch — CLI plumbing
 * ===================================================================== */

console.log('\nbin/b7e-vouch — CLI plumbing\n');

check('--help exits 0 and prints usage', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  return r.status === 0 && /b7e-vouch/.test(r.stdout);
});
check('no args: exit 2, usage on stderr', () => {
  const r = spawnSync(process.execPath, [BIN], { encoding: 'utf8' });
  return r.status === 2 && /usage/.test(r.stderr);
});
check('missing --body: exit 2', () => {
  const r = spawnSync(process.execPath, [BIN, '-w', 'x', '-b', 'y'], { encoding: 'utf8' });
  return r.status === 2;
});

/* ===================================================================== *
 * 3. bin/b7e-vouch — end to end, a real git fixture and a fake bd
 * ===================================================================== */

console.log('\nbin/b7e-vouch — end to end\n');

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7evouch-'));
const configDir = path.join(tmp, 'config');
fs.mkdirSync(configDir, { recursive: true });
const HOME = path.join(tmp, 'home');
fs.mkdirSync(HOME, { recursive: true });

function makeOrigin(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'shared.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
function cloneWork(origin, name) {
  const dir = path.join(tmp, name);
  git(tmp, 'clone', '-q', origin, dir);
  return dir;
}
function commitFile(dir, file, content, message) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}
function writeConfig(workspaces, pr = { enabled: true, base: 'main' }) {
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ workspaces, pr }, null, 2));
}
writeConfig([]);

/** A `{name, dir}` workspace entry `loadConfig`'s own reconciliation will not silently
 * drop — it prunes any workspace whose `.dir` does not exist on disk (same reason
 * test/b7efresh.mjs's own `-w` section `mkdirSync`s one), so a fixture repo needs a real
 * (empty) `.beads` directory even though the fake `bd` never reads anything from it. */
function wsFor(work, name) {
  const dir = path.join(work, '.beads');
  fs.mkdirSync(dir, { recursive: true });
  return { name, dir };
}

/** Fake `bd` on PATH: `show <id> --json` against a world this file controls, ignoring
 * BEADS_DIR entirely (a real caller sets it per-workspace; a fake only needs one world
 * per test process, the same simplification test/b7enotes.mjs's own fixture makes). */
const fakebin = fs.mkdtempSync(path.join(tmp, 'fakebin-'));
let WORLD = {};
fs.writeFileSync(
  path.join(fakebin, 'bd'),
  `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const world = JSON.parse(fs.readFileSync(process.env.VOUCH_TEST_WORLD, 'utf8'));
if (args[0] === 'show') {
  const row = world[args[1]];
  if (!row) {
    process.stdout.write(JSON.stringify({ error: 'no issues found matching the provided IDs' }) + '\\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify([row]) + '\\n');
  process.exit(0);
}
process.stderr.write('fake bd: unsupported ' + args.join(' ') + '\\n');
process.exit(1);
`
);
fs.chmodSync(path.join(fakebin, 'bd'), 0o755);
const worldFile = path.join(fakebin, 'world.json');
const setWorld = (w) => {
  WORLD = w;
  fs.writeFileSync(worldFile, JSON.stringify(WORLD));
};
setWorld({});

const PATH_WITH_FAKE_BD = `${fakebin}:${process.env.PATH}`;
const run = (cwd, args = []) => {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME, BEADCAUSE_CONFIG_DIR: configDir, PATH: PATH_WITH_FAKE_BD, VOUCH_TEST_WORLD: worldFile },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};
const withBody = (text) => {
  const f = path.join(tmp, `body-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(f, text);
  return f;
};

{
  const origin = makeOrigin('origin-e2e');
  const work = cloneWork(origin, 'work-e2e');
  git(work, 'checkout', '-q', '-b', 'feature');
  commitFile(work, 'lib/foo.js', 'x\n', 'add foo');

  writeConfig([wsFor(work, 'w')]);
  setWorld({ 'bc-1': { id: 'bc-1', title: 'x', description: '', acceptance_criteria: '' } });

  check('unknown workspace: exit 2', () => {
    const r = run(work, ['-w', 'nope', '-b', 'bc-1', '--body', withBody('x')]);
    return r.status === 2 && /no workspace named/.test(r.stderr);
  });

  check('bead not found: exit 2', () => {
    const r = run(work, ['-w', 'w', '-b', 'bc-missing', '--body', withBody('x')]);
    return r.status === 2;
  });

  check('a clean delivery — every changed file mentioned, no argv given: exit 0, silent', () => {
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Added lib/foo.js for the fix.')]);
    return r.status === 0 && r.stdout.trim() === '';
  });

  check('an unmentioned changed file: exit 1, names it', () => {
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Fixed a typo somewhere.')]);
    return r.status === 1 && /lib\/foo\.js changed/.test(r.stdout);
  });

  check('the bead’s acceptance_criteria rescues an unmentioned file, over the real bd call', () => {
    setWorld({ 'bc-1': { id: 'bc-1', title: 'x', description: '', acceptance_criteria: 'lib/foo.js is the fix.' } });
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Fixed a typo somewhere.')]);
    setWorld({ 'bc-1': { id: 'bc-1', title: 'x', description: '', acceptance_criteria: '' } });
    return r.status === 0;
  });

  check('--json prints one object with a findings array', () => {
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Fixed a typo.'), '--json']);
    const parsed = JSON.parse(r.stdout);
    return r.status === 1 && Array.isArray(parsed.findings) && parsed.findings.length === 1;
  });

  check('a flag claimed in the body but absent from the trailing argv: exit 1', () => {
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Added lib/foo.js. Passing --review since it is a judgement call.'), '--', '--tests', 'x']);
    return r.status === 1 && /body claims --review/.test(r.stdout);
  });

  check('the same body, with --review actually in the argv: exit 0', () => {
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Added lib/foo.js. Passing --review since it is a judgement call.'), '--', '--review']);
    return r.status === 0;
  });

  check('no `--` at all: the flags check is skipped even though the body claims --review', () => {
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Added lib/foo.js. Passing --review since it is a judgement call.')]);
    return r.status === 0;
  });

  check('--ran + a --tests value naming a gate absent from the run: exit 1', () => {
    const ranFile = path.join(tmp, 'ran1.log');
    fs.writeFileSync(ranFile, 'scripts/check_other.py: ok\n');
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Added lib/foo.js.'), '--ran', ranFile, '--', '--tests', 'scripts/check_foo.py PASS']);
    return r.status === 1 && /check_foo\.py/.test(r.stdout) && r.stdout.includes(ranFile);
  });

  check('--ran + a --tests value naming a gate that IS in the run: exit 0', () => {
    const ranFile = path.join(tmp, 'ran2.log');
    fs.writeFileSync(ranFile, 'scripts/check_foo.py: ok\n');
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Added lib/foo.js.'), '--ran', ranFile, '--', '--tests', 'scripts/check_foo.py PASS']);
    return r.status === 0;
  });

  check('a --tests value with an unfindable gate, but no --ran given: exit 0 — nothing to check against', () => {
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Added lib/foo.js.'), '--', '--tests', 'scripts/check_whatever.py PASS']);
    return r.status === 0;
  });

  check('--base overrides the resolved default to a literal ref', () => {
    git(origin, 'checkout', '-q', '-b', 'develop');
    commitFile(origin, 'dev-only.txt', 'd\n', 'develop-only commit');
    git(origin, 'checkout', '-q', 'main');
    const r = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Added lib/foo.js.'), '--base', 'develop']);
    // vs develop, this branch's diff also excludes dev-only.txt (that landed on develop,
    // not on this branch) and still names lib/foo.js as its own change — same result as
    // the main-based comparison, so this just proves --base was actually honoured rather
    // than silently ignored: swap to a --base that does not exist and confirm the refusal.
    const ghost = run(work, ['-w', 'w', '-b', 'bc-1', '--body', withBody('x'), '--base', 'ghost-branch-nobody-made']);
    return r.status === 0 && ghost.status === 2 && /nothing to diff against/.test(ghost.stderr);
  });

  check('--dir points the diff at another checkout entirely', () => {
    const origin2 = makeOrigin('origin-dir');
    const work2 = cloneWork(origin2, 'work-dir');
    git(work2, 'checkout', '-q', '-b', 'feature2');
    commitFile(work2, 'lib/other.js', 'y\n', 'add other');
    const r = run(tmp, ['-w', 'w', '-b', 'bc-1', '--body', withBody('Added lib/other.js.'), '--dir', work2]);
    return r.status === 0;
  });

  check('--body - reads from stdin', () => {
    const r = spawnSync(process.execPath, [BIN, '-w', 'w', '-b', 'bc-1', '--body', '-'], {
      cwd: work,
      input: 'Added lib/foo.js for the fix.',
      encoding: 'utf8',
      env: { ...process.env, HOME, BEADCAUSE_CONFIG_DIR: configDir, PATH: PATH_WITH_FAKE_BD, VOUCH_TEST_WORLD: worldFile },
    });
    return r.status === 0;
  });

  writeConfig([]);
}

/* ---------------------------------------------------------------- verdict */

await cleanupTmp(tmp);
console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m\n` : '\n\x1b[32mall checks passed\x1b[0m\n');
process.exit(failures ? 1 : 0);
