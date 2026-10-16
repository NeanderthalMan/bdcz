#!/usr/bin/env node
/**
 * `doltServer` — which trackers get a per-project Dolt server, and what the flip refuses.
 *
 *     npm test
 *     node test/doltmode.mjs
 *
 * The change itself is three keys in a JSON file, so the suite is not about the write.
 * It is about the six ways that write is wrong, every one of which was found by doing it
 * to a real workspace first (see lib/doltmode.js for the measurements):
 *
 * 1. **The default is the advocated workspaces, and nothing else.** A server costs
 *    ~90-400MB resident and the daemon polls every tracker, so "all" is a gigabyte held
 *    for queues nobody is reading. `off` and `all` still mean what they say.
 * 2. **`dolt_data_dir` is pinned by the same write that sets the mode.** Without it the
 *    server comes up on an empty `.beads/dolt` and the tracker reads as empty — beads
 *    that look lost and are not. This is the assertion that matters most in the file.
 * 3. **A tracked metadata.json is refused.** Northwind's `cl-` graph lives in the repo
 *    the team clones and its metadata is committed; `dolt_data_dir` is an absolute path
 *    on one Mac, so committing it points every other clone at a directory that is not
 *    there. `--force` is the only way past, and it has to be asked for.
 * 4. **A flip that empties a tracker is rolled back, and a flip that cannot be measured
 *    is not.** `null` from `bd stats` means "could not ask", which must not read as
 *    "the answer is zero" — that would undo good work on a machine with no bd.
 * 5. **Server mode with nothing pinned is repaired whatever the policy says**, because
 *    that state is already broken; but not when `.beads/dolt` holds data, because then
 *    pinning would swap which database is live and only a person can pick.
 * 6. **The way back stops the server first.** A live server holds the data directory, so
 *    writing `embedded` underneath one leaves every caller blocked on the lock rather
 *    than failing — and if the stop fails, nothing is written at all.
 *
 * `bd` and `git` are both injected, so none of this shells out and none of it needs a
 * real tracker: the workspaces below are directories with a metadata.json in them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

const {
  applyPlan,
  doltServerPolicy,
  planWorkspace,
  planDoltModes,
  revertToEmbedded,
  shouldServe,
} = await import(LIB('doltmode.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-doltmode-'));

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  ✗ ${name}\n      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

/* --------------------------------------------------------------------- the tree */

/**
 * A workspace, as far as this module is concerned: a directory with `.beads/metadata.json`
 * and, unless told otherwise, the `embeddeddolt` directory the flip pins itself to.
 */
function workspace(name, { mode = 'embedded', embedded = true, extra = {}, serverDirHolds = null } = {}) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.beads'), { recursive: true });
  if (embedded) fs.mkdirSync(path.join(dir, '.beads', 'embeddeddolt'), { recursive: true });
  if (serverDirHolds) {
    fs.mkdirSync(path.join(dir, '.beads', 'dolt'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.beads', 'dolt', serverDirHolds), 'x');
  }
  fs.writeFileSync(
    path.join(dir, '.beads', 'metadata.json'),
    `${JSON.stringify({ database: 'dolt', backend: 'dolt', dolt_mode: mode, dolt_database: name.slice(0, 2), ...extra }, null, 2)}\n`
  );
  return { name, dir };
}

const meta = (ws) => JSON.parse(fs.readFileSync(path.join(ws.dir, '.beads', 'metadata.json'), 'utf8'));

/** A `spawnSync` that never spawns. `git` answers "not tracked" and `bd` answers as told. */
const fakeRun = ({ tracked = [], counts = {}, stopFails = false, calls = [] } = {}) =>
  function run(bin, args, opts) {
    calls.push({ bin, args, opts });
    if (bin === 'git') {
      const dir = args[1] || '';
      return { status: tracked.some((t) => dir.includes(`${t}/.beads`)) ? 0 : 1, stdout: '', stderr: '' };
    }
    if (bin === 'bd' && args[0] === 'stats') {
      const dir = opts?.cwd || '';
      const name = path.basename(dir);
      const total = counts[name];
      if (total === undefined) return { status: 1, stdout: '', stderr: 'no beads database found' };
      // The count is read twice per apply — before the write and after — and a test that
      // wants to see a rollback hands an array to be consumed in order.
      const value = Array.isArray(total) ? total.shift() : total;
      return { status: 0, stdout: JSON.stringify({ summary: { total_issues: value } }), stderr: '' };
    }
    if (bin === 'bd' && args[0] === 'dolt' && args[1] === 'stop') {
      return stopFails
        ? { status: 1, stdout: '', stderr: 'could not stop server' }
        : { status: 0, stdout: 'Dolt server stopped.', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };

/* ------------------------------------------------------------------ 1. the policy */

console.log('\nwhich workspaces the policy covers');

{
  const cfg = { advocates: { workspaces: ['sorrel'] } };
  check('no setting at all means "advocated"', doltServerPolicy({}) === 'advocated', doltServerPolicy({}));
  check('and a value nobody recognises falls back to it, not to off', doltServerPolicy({ doltServer: 'advocates' }) === 'advocated');
  check('an advocated workspace is served', shouldServe(cfg, 'sorrel'));
  check('one without an advocate is not', !shouldServe(cfg, 'loremia'));
  check('"*" covers everything', shouldServe({ advocates: { workspaces: ['*'] } }, 'anything'));
  check('"all" ignores the advocate list', shouldServe({ ...cfg, doltServer: 'all' }, 'loremia'));
  check('"off" serves nothing, however it is advocated', !shouldServe({ ...cfg, doltServer: 'off' }, 'sorrel'));
}

/* ----------------------------------------------------- 2. the write, and the pin */

console.log('\nthe flip pins the data directory');

{
  const ws = workspace('sorrel');
  const cfg = { advocates: { workspaces: ['sorrel'] } };
  const run = fakeRun({ counts: { sorrel: [12, 12] } });
  const plan = planWorkspace(cfg, ws, { run });
  check('an advocated embedded workspace is planned for a server', plan.action === 'serve', JSON.stringify(plan));

  const problem = applyPlan(plan, { run });
  check('and the write succeeds', problem === null, String(problem));

  const after = meta(ws);
  check('dolt_mode is server', after.dolt_mode === 'server', after.dolt_mode);
  check(
    'dolt_data_dir points at the EMBEDDED directory, not .beads/dolt',
    after.dolt_data_dir === path.join(ws.dir, '.beads', 'embeddeddolt'),
    after.dolt_data_dir
  );
  check('the host is pinned too', after.dolt_server_host === '127.0.0.1', after.dolt_server_host);
  check('and everything else in the file survives', after.dolt_database === 'so' && after.backend === 'dolt', JSON.stringify(after));
}

{
  const ws = workspace('loremia');
  const plans = planDoltModes({ advocates: { workspaces: ['sorrel'] } }, [ws], { run: fakeRun() });
  check('a workspace with no advocate is left alone', plans[0].action === 'none', JSON.stringify(plans[0]));
  check('and it says why, in words', /no advocate/.test(plans[0].what), plans[0].what);
}

{
  // The shape `discoverWorkspaces()` actually hands over. It returns `dir` as the
  // `.beads` directory itself, while lib/team.js calls its `dir` the directory above it —
  // and the first draft of this module only understood the second, so a plan over the
  // real config reported "no metadata.json" for every workspace on the machine. Both
  // shapes, asserted, because both are live in this repo.
  const ws = workspace('discovered');
  const asFound = { name: 'discovered', dir: path.join(ws.dir, '.beads') };
  const run = fakeRun({ counts: { discovered: [7, 7] } });
  const plan = planWorkspace({ doltServer: 'all' }, asFound, { run });
  check('a .beads directory is understood as the workspace', plan.action === 'serve', JSON.stringify(plan));
  check('and the flip applies to it', applyPlan(plan, { run }) === null);
  check(
    'pinning the same embedded path either way',
    meta(ws).dolt_data_dir === path.join(ws.dir, '.beads', 'embeddeddolt'),
    meta(ws).dolt_data_dir
  );
}

{
  // Somebody else's answer wins: a data dir already chosen is not second-guessed.
  const ws = workspace('elsewhere', { extra: { dolt_data_dir: '/somewhere/else' } });
  const run = fakeRun({ counts: { elsewhere: [3, 3] } });
  const plan = planWorkspace({ doltServer: 'all' }, ws, { run });
  applyPlan(plan, { run });
  check('an existing dolt_data_dir is not overwritten', meta(ws).dolt_data_dir === '/somewhere/else', meta(ws).dolt_data_dir);
}

/* ------------------------------------------------------ 3. the in-repo refusal */

console.log('\na tracker whose metadata is committed');

{
  const ws = workspace('architecture');
  const cfg = { doltServer: 'all' };
  const run = fakeRun({ tracked: ['architecture'] });
  const plan = planWorkspace(cfg, ws, { run });
  check('is refused rather than changed', plan.refusal !== null && plan.action === 'none', JSON.stringify(plan));
  check('and the refusal says what would break', /every other clone/.test(plan.refusal), plan.refusal);
  check('nothing was written', meta(ws).dolt_mode === 'embedded', meta(ws).dolt_mode);

  const forced = planWorkspace(cfg, ws, { run, force: true });
  check('--force is the way past, and only --force', forced.action === 'serve' && !forced.refusal, JSON.stringify(forced));
}

/* ------------------------------------------------------------- 4. the rollback */

console.log('\na flip that empties the tracker');

{
  const ws = workspace('lossy');
  // 9 beads before the write, 0 after: exactly the shape of a server that came up on the
  // wrong data directory.
  const run = fakeRun({ counts: { lossy: [9, 0] } });
  const plan = planWorkspace({ doltServer: 'all' }, ws, { run });
  const problem = applyPlan(plan, { run });
  check('is reported rather than left in place', problem !== null, String(problem));
  check('the sentence says nothing was lost', /Nothing was lost/.test(problem || ''), String(problem));
  check('and the metadata is exactly what it was', meta(ws).dolt_mode === 'embedded', JSON.stringify(meta(ws)));
  check('with no pin left behind', meta(ws).dolt_data_dir === undefined, JSON.stringify(meta(ws)));
}

{
  // bd not on the PATH at all: `bd stats` fails, the count is null both times, and a null
  // must never be read as zero — that would roll back every flip on such a machine.
  const ws = workspace('nobd');
  const run = fakeRun({ counts: {} });
  const plan = planWorkspace({ doltServer: 'all' }, ws, { run });
  const problem = applyPlan(plan, { run });
  check('a count that could not be read is not a count of zero', problem === null, String(problem));
  check('so the flip stands', meta(ws).dolt_mode === 'server', meta(ws).dolt_mode);
}

{
  // The other end of the same rule: a tracker that genuinely had no beads before is not a
  // rollback either, because 0 → 0 is not a loss.
  const ws = workspace('empty');
  const run = fakeRun({ counts: { empty: [0, 0] } });
  const plan = planWorkspace({ doltServer: 'all' }, ws, { run });
  check('an empty tracker flips without complaint', applyPlan(plan, { run }) === null);
  check('and stays flipped', meta(ws).dolt_mode === 'server', meta(ws).dolt_mode);
}

/* ---------------------------------------------------- 5. the broken middle state */

console.log('\nserver mode with nothing pinned');

{
  const ws = workspace('halfway', { mode: 'server' });
  // Not advocated, and the policy is the default — repaired anyway, because this state is
  // a tracker that reads as empty whoever configured it.
  const plan = planWorkspace({ advocates: { workspaces: [] } }, ws, { run: fakeRun() });
  check('is repaired whatever the policy says', plan.action === 'pin', JSON.stringify(plan));
  applyPlan(plan, { run: fakeRun({ counts: { halfway: [4, 4] } }) });
  check(
    'by pinning the embedded directory',
    meta(ws).dolt_data_dir === path.join(ws.dir, '.beads', 'embeddeddolt'),
    meta(ws).dolt_data_dir
  );
}

{
  const ws = workspace('ambiguous', { mode: 'server', serverDirHolds: 'manifest' });
  const plan = planWorkspace({ doltServer: 'all' }, ws, { run: fakeRun() });
  check('but not when .beads/dolt already holds data', plan.refusal !== null, JSON.stringify(plan));
  check('because that would swap which database is live', /which of the two/.test(plan.refusal), plan.refusal);
}

{
  const ws = workspace('nodata', { embedded: false });
  const plan = planWorkspace({ doltServer: 'all' }, ws, { run: fakeRun() });
  check('a workspace with no embeddeddolt to point at is left alone', plan.action === 'none', JSON.stringify(plan));
}

{
  const ws = { name: 'ghost', dir: path.join(tmp, 'ghost') };
  fs.mkdirSync(ws.dir, { recursive: true });
  const plan = planWorkspace({ doltServer: 'all' }, ws, { run: fakeRun() });
  check('and a directory with no metadata.json is not a workspace', plan.action === 'none', JSON.stringify(plan));
}

/* --------------------------------------------------------------- 6. the way back */

console.log('\nthe way back');

{
  const ws = workspace('goback', { mode: 'server', extra: {} });
  // The pin this module writes, so reverting should take it away with the mode.
  const file = path.join(ws.dir, '.beads', 'metadata.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.dolt_data_dir = path.join(ws.dir, '.beads', 'embeddeddolt');
  fs.writeFileSync(file, JSON.stringify(json, null, 2));

  const calls = [];
  const problem = revertToEmbedded(ws.dir, { run: fakeRun({ calls }), name: 'goback' });
  check('reverts cleanly', problem === null, String(problem));
  check('the server is stopped FIRST', calls.some((c) => c.bin === 'bd' && c.args.join(' ') === 'dolt stop'), JSON.stringify(calls.map((c) => c.args)));
  check('the mode is embedded again', meta(ws).dolt_mode === 'embedded', meta(ws).dolt_mode);
  check('and our pin went with it', meta(ws).dolt_data_dir === undefined, JSON.stringify(meta(ws)));
}

{
  const ws = workspace('wedged', { mode: 'server', extra: { dolt_data_dir: '/x' } });
  const problem = revertToEmbedded(ws.dir, { run: fakeRun({ stopFails: true }), name: 'wedged' });
  check('a server that will not stop leaves the mode alone', problem !== null, String(problem));
  check('rather than writing embedded under a live lock', meta(ws).dolt_mode === 'server', meta(ws).dolt_mode);
}

{
  const ws = workspace('already');
  check('reverting an embedded workspace is a no-op', revertToEmbedded(ws.dir, { run: fakeRun(), name: 'already' }) === null);
}

await cleanupTmp(tmp);
console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
