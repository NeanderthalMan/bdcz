#!/usr/bin/env node
/**
 * package.json and package-lock.json merge by structure, not by line — bc-g95u9.
 *
 *     npm test
 *     node test/jsonmerge.mjs
 *
 * lib/jsonmerge.js is the three-way merge; scripts/jsonmerge.mjs is the git driver that
 * runs it. Two halves here, and the second is the one that matters:
 *
 * 1. **The merge, as a function.** Appends on both sides are kept, a deletion is honoured,
 *    a re-sorted side still yields JSON, and a key both sides changed differently is a
 *    conflict that names the key rather than a pick.
 * 2. **The driver, through a real `git merge`.** A scratch repo with the driver installed
 *    by `--install`, replaying the two merges union got wrong on 2026-10-23: #40's
 *    (main deleted `b7e-renum`, the branch still had it) and #4's (the branch re-sorted
 *    the bin map). A unit test of the function would pass as happily against an
 *    attribute name the driver is not installed under, so the merge has to go through git.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeJsonText, mergeValues } from '../lib/jsonmerge.js';
import { describeEnsure, driverCommand, driverState, ensureJsonMergeDriver, mainCheckoutScript } from '../lib/jsonmergedriver.js';
import { cleanupTmp } from './helpers/tmp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER = path.join(ROOT, 'scripts', 'jsonmerge.mjs');

let ran = 0;
let failures = 0;
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
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));

const pkg = (bin, extra = {}) => JSON.stringify({ name: 'x', version: '1.0.0', ...extra, bin }, null, 2) + '\n';

console.log('\npackage.json merges by structure\n');

/* ------------------------------------------------------------------ 1. the function */

{
  const base = pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-m': 'bin/b7e-m' });
  const ours = pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-c': 'bin/b7e-c', 'b7e-m': 'bin/b7e-m' });
  const theirs = pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-m': 'bin/b7e-m', 'b7e-z': 'bin/b7e-z' });
  const r = mergeJsonText(base, ours, theirs);
  const keys = r.ok ? Object.keys(JSON.parse(r.text).bin) : [];
  check(
    'two branches each adding a tool keep both, in sorted place',
    r.ok && keys.join(',') === 'b7e-a,b7e-c,b7e-m,b7e-z',
    r.ok ? `got ${keys.join(',')}` : r.reason
  );
}

{
  const base = pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-renum': 'bin/b7e-renum' });
  const ours = pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-renum': 'bin/b7e-renum', 'b7e-repo': 'bin/b7e-repo' });
  const theirs = pkg({ 'b7e-a': 'bin/b7e-a' });
  const r = mergeJsonText(base, ours, theirs);
  const bin = r.ok ? JSON.parse(r.text).bin : {};
  check(
    "a deletion on one side stays deleted (#40's b7e-renum), and the other side's addition stays",
    r.ok && !('b7e-renum' in bin) && bin['b7e-repo'] === 'bin/b7e-repo',
    r.ok ? `got ${Object.keys(bin).join(',')}` : r.reason
  );
}

{
  const base = pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-b': 'bin/b7e-b', 'b7e-c': 'bin/b7e-c' });
  // Ours re-ordered the whole map, as #4's branch did; theirs added one.
  const ours = pkg({ 'b7e-c': 'bin/b7e-c', 'b7e-a': 'bin/b7e-a', 'b7e-b': 'bin/b7e-b', 'b7e-keep': 'bin/b7e-keep' });
  const theirs = pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-b': 'bin/b7e-b', 'b7e-c': 'bin/b7e-c', 'b7e-d': 'bin/b7e-d' });
  const r = mergeJsonText(base, ours, theirs);
  let parsed = null;
  try {
    parsed = r.ok ? JSON.parse(r.text) : null;
  } catch {
    /* reported below */
  }
  check(
    "a side that re-sorted the map still merges to JSON with every entry (#4's shape)",
    parsed && ['b7e-a', 'b7e-b', 'b7e-c', 'b7e-d', 'b7e-keep'].every((k) => k in parsed.bin),
    r.ok ? r.text : r.reason
  );
}

{
  const base = pkg({}, { version: '1.0.0' });
  const r = mergeJsonText(base, pkg({}, { version: '1.1.0' }), pkg({}, { version: '2.0.0' }));
  check(
    'both sides changing one key differently is a conflict that names the key, not a pick',
    !r.ok && /version/.test(r.reason),
    r.ok ? `merged to ${r.text}` : r.reason
  );
}

{
  const r = mergeJsonText(pkg({}), '{ "name": "x", ', pkg({}));
  check('a side that does not parse is refused, not merged', !r.ok && /ours is not JSON/.test(r.reason), r.reason);
}

{
  const base = pkg({ a: 'bin/a' });
  const r = mergeValues(JSON.parse(base), { ...JSON.parse(base), bin: { a: 'bin/a2' } }, { ...JSON.parse(base) });
  check('a key only one side changed takes that side', !r.conflicts.length && r.value.bin.a === 'bin/a2');
  const tabs = mergeJsonText('{\n\t"a": 1\n}\n', '{\n\t"a": 1,\n\t"b": 2\n}\n', '{\n\t"a": 1\n}\n');
  check('ours\' indentation and trailing newline are kept', tabs.ok && tabs.text === '{\n\t"a": 1,\n\t"b": 2\n}\n', tabs.text);
}

/* ------------------------------------------------------------- 2. through git merge */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-jsonmerge-'));
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
const ident = ['-c', 'user.name=jsonmerge-test', '-c', 'user.email=jsonmerge@localhost', '-c', 'commit.gpgsign=false'];
const git = (...args) => execFileSync('git', [...ident, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const gitTry = (...args) => spawnSync('git', [...ident, ...args], { cwd: repo, encoding: 'utf8' });
const write = (name, text) => fs.writeFileSync(path.join(repo, name), text);
const readPkg = () => fs.readFileSync(path.join(repo, 'package.json'), 'utf8');

try {
  git('init', '-q', '-b', 'main');
  write('.gitattributes', 'package.json merge=jsonmerge\n');
  const install = spawnSync(process.execPath, [DRIVER, '--install'], { cwd: repo, encoding: 'utf8' });
  check('--install sets the driver in the repo\'s own config', install.status === 0, install.stderr);
  const checked = spawnSync(process.execPath, [DRIVER, '--check'], { cwd: repo, encoding: 'utf8' });
  check('--check finds it and the script it points at', checked.status === 0, checked.stderr);

  // #40: main deletes b7e-renum; the branch, cut before that, adds b7e-repo.
  write('package.json', pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-renum': 'bin/b7e-renum' }));
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'branch40');
  write('package.json', pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-renum': 'bin/b7e-renum', 'b7e-repo': 'bin/b7e-repo' }));
  git('commit', '-q', '-am', 'add b7e-repo');
  git('checkout', '-q', 'main');
  write('package.json', pkg({ 'b7e-a': 'bin/b7e-a' }));
  git('commit', '-q', '-am', 'delete b7e-renum');
  git('checkout', '-q', 'branch40');
  const m40 = gitTry('merge', '--no-edit', '-q', 'main');
  const bin40 = m40.status === 0 ? JSON.parse(readPkg()).bin : {};
  check(
    "git merge of #40's shape: clean, b7e-renum stays deleted, b7e-repo stays",
    m40.status === 0 && !('b7e-renum' in bin40) && 'b7e-repo' in bin40,
    m40.status === 0 ? `bin is ${Object.keys(bin40).join(',')}` : m40.stderr || m40.stdout
  );

  // #4: the branch re-sorts the bin map and adds b7e-keep; main adds b7e-b in place.
  git('checkout', '-q', 'main');
  write('package.json', pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-c': 'bin/b7e-c' }));
  git('commit', '-q', '-am', 'reset for #4');
  git('checkout', '-q', '-b', 'branch4');
  write('package.json', pkg({ 'b7e-c': 'bin/b7e-c', 'b7e-keep': 'bin/b7e-keep', 'b7e-a': 'bin/b7e-a' }));
  git('commit', '-q', '-am', 're-sort and add b7e-keep');
  git('checkout', '-q', 'main');
  write('package.json', pkg({ 'b7e-a': 'bin/b7e-a', 'b7e-b': 'bin/b7e-b', 'b7e-c': 'bin/b7e-c' }));
  git('commit', '-q', '-am', 'add b7e-b');
  git('checkout', '-q', 'branch4');
  const m4 = gitTry('merge', '--no-edit', '-q', 'main');
  let bin4 = null;
  try {
    bin4 = JSON.parse(readPkg()).bin;
  } catch {
    /* reported below */
  }
  check(
    "git merge of #4's shape: clean, and package.json is JSON with all four entries",
    m4.status === 0 && bin4 && ['b7e-a', 'b7e-b', 'b7e-c', 'b7e-keep'].every((k) => k in bin4),
    m4.status === 0 ? readPkg() : m4.stderr || m4.stdout
  );

  // A real disagreement: git reports the conflict, and the file carries ordinary markers.
  git('checkout', '-q', 'main');
  write('package.json', pkg({}, { version: '1.0.0' }));
  git('commit', '-q', '-am', 'version base');
  git('checkout', '-q', '-b', 'branchv');
  write('package.json', pkg({}, { version: '1.1.0' }));
  git('commit', '-q', '-am', 'bump minor');
  git('checkout', '-q', 'main');
  write('package.json', pkg({}, { version: '2.0.0' }));
  git('commit', '-q', '-am', 'bump major');
  git('checkout', '-q', 'branchv');
  const mv = gitTry('merge', '--no-edit', '-q', 'main');
  check(
    'a key both sides changed differently stops the merge with conflict markers to read',
    mv.status !== 0 && /<<<<<<< /.test(readPkg()) && /needs a person — both sides changed version/.test(mv.stderr),
    `exit ${mv.status}; ${mv.stderr}`
  );
  gitTry('merge', '--abort');
} finally {
  // `cleanupTmp` rather than a bare `fs.rmSync` — test/tmpadoption.mjs.
  await cleanupTmp(tmp);
}

/* ---------------------------------------------- 2b. the daemon keeps it installed */
//
// bc-xl7n.207: the driver above was never installed in this repo's own clone, so 21 merges
// of package-lock.json conflicted in a month while the fix sat unused. The daemon now calls
// ensureJsonMergeDriver at startup; these pin what that call does to a clone.

const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-jsonmerge-ensure-'));
try {
  const r2 = path.join(tmp2, 'repo');
  fs.mkdirSync(r2);
  const g2 = (...args) => execFileSync('git', args, { cwd: r2, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g2('init', '-q', '-b', 'main');

  check(
    'a clone whose .gitattributes does not name the driver is left alone',
    ensureJsonMergeDriver(r2, { script: DRIVER }).state === 'skipped' && !driverState(r2).command
  );

  fs.writeFileSync(path.join(r2, '.gitattributes'), 'package-lock.json merge=jsonmerge\n');
  check(
    'with no main checkout copy of the script, nothing is pinned to a copy that may vanish',
    mainCheckoutScript(r2) === null && ensureJsonMergeDriver(r2).state === 'skipped' && !driverState(r2).command
  );

  const first = ensureJsonMergeDriver(r2, { script: DRIVER });
  check(
    'an uninstalled clone gets the driver, pointing at the script',
    first.state === 'installed' && first.was === '' && driverState(r2).ok && driverState(r2).script === DRIVER,
    JSON.stringify(first)
  );
  check('a second call writes nothing', ensureJsonMergeDriver(r2, { script: DRIVER }).state === 'present');

  g2('config', '--local', 'merge.jsonmerge.driver', driverCommand(path.join(tmp2, 'retired', 'scripts', 'jsonmerge.mjs')));
  const fixed = ensureJsonMergeDriver(r2, { script: DRIVER });
  check(
    'a driver pointing at a retired worktree is repaired',
    fixed.state === 'installed' && /retired/.test(fixed.was) && driverState(r2).ok,
    JSON.stringify(fixed)
  );
  check('the repair is said in the startup log', /repaired/.test(describeEnsure(fixed) || ''));

  g2('config', '--local', 'merge.jsonmerge.driver', driverCommand(DRIVER, path.join(tmp2, 'gone-node', 'bin', 'node')));
  const reNode = ensureJsonMergeDriver(r2, { script: DRIVER });
  check(
    'a driver naming a node that is gone (an nvm upgrade) is repaired',
    reNode.state === 'installed' && driverState(r2).ok && driverState(r2).node === process.execPath,
    JSON.stringify(reNode)
  );

  // The main-checkout rule: a worktree of a clone that carries the script points at the
  // clone's copy, never at its own.
  fs.mkdirSync(path.join(r2, 'scripts'));
  fs.writeFileSync(path.join(r2, 'scripts', 'jsonmerge.mjs'), '// stand-in\n');
  g2('-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'commit.gpgsign=false', 'add', '-A');
  g2('-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base');
  const wt = path.join(tmp2, 'wt');
  g2('worktree', 'add', '-q', wt, '-b', 'side');
  check(
    "from a worktree, the driver is pointed at the main checkout's script",
    fs.realpathSync(mainCheckoutScript(wt)) === fs.realpathSync(path.join(r2, 'scripts', 'jsonmerge.mjs')),
    String(mainCheckoutScript(wt))
  );
} finally {
  await cleanupTmp(tmp2);
}

const daemon = fs.readFileSync(path.join(ROOT, 'bin', 'beadcause.js'), 'utf8');
check(
  'the daemon installs the driver at startup',
  /ensureJsonMergeDriver\(ROOT\)/.test(daemon)
);

/* ------------------------------------------------------------- 3. this repo declares it */

const attributes = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8');
check(
  "this repo's .gitattributes sends both bin maps through the driver",
  /^package\.json\s+merge=jsonmerge\s*$/m.test(attributes) && /^package-lock\.json\s+merge=jsonmerge\s*$/m.test(attributes)
);

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
