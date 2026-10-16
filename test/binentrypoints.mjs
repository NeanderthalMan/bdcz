#!/usr/bin/env node
/**
 * Three `bin/` entry points that no suite ever ran — bc-xl7n.37.
 *
 *     npm test
 *     node test/binentrypoints.mjs
 *
 * `npm run coverage` (bc-vriu.2) found these by absence rather than by failure: of 149
 * files under lib/ and bin/, exactly three were never *imported* by anything the suite
 * runs — bin/checkin.js, bin/plan.js and bin/status.js. Every other bin/ entry point is
 * reached because some suite spawns the real binary (test/landcheck.mjs and
 * bin/deliver.js is the model this follows); these three had no equivalent, so a change
 * to any of them could pass the whole gate without one line of it executing.
 *
 * The bar the bead set is deliberately modest — "start, parse their arguments and exit
 * cleanly" is what the 60 seconds of a real run would actually catch, and anything
 * deeper is its own bead per binary. So each of the three gets: the usage/error path
 * (bad or missing arguments, exit 1, nothing written), and one real run against a fake
 * `bd` that does what the command actually needs. `bin/checkin.js` and `bin/status.js`
 * only ever touch the filesystem (lib/advocate.js, lib/activity.js) — no `bd` needed at
 * all for the ordinary path. `bin/plan.js` is the one that talks to `bd`, so its fake
 * covers `show`, `list --parent` (children), `comment`, `label add` and `update` — the
 * five calls a plan actually makes, in the shapes `lib/bd.js` calls them in.
 *
 * `NODE_V8_COVERAGE`, when `scripts/coverage.mjs` set it for this suite's own process,
 * is inherited by spawnSync the same way it would be for any other child — passing
 * `env: { ...process.env, ... }` rather than a stripped-down env is what makes running
 * these three for real here also make them *covered*, closing the acceptance criterion
 * rather than just exercising the code.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = (name) => path.join(ROOT, 'bin', name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-binentry-'));
const CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(CONFIG_DIR, { recursive: true });

const WS = { name: 'zz', dir: path.join(tmp, 'zz', '.beads') };
fs.mkdirSync(WS.dir, { recursive: true });

/* --------------------------------------------------------------- a fake bd, plan-shaped */

const EPIC_ID = 'zz-epic';
const CHILD_ID = 'zz-epic.1';
const FAKE_BD = path.join(tmp, 'bd');

fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const args = process.argv.slice(2);
const one = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };

if (args[0] === 'show') {
  const id = args[1];
  const rows = id === ${JSON.stringify(EPIC_ID)}
    ? [{ id, type: 'epic', title: 'The test epic', status: 'open' }]
    : [];
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}
if (args[0] === 'list' && args.includes('--parent')) {
  const parent = one('--parent');
  const rows = parent === ${JSON.stringify(EPIC_ID)}
    ? [{ id: ${JSON.stringify(CHILD_ID)}, title: 'The child', status: 'open', issue_type: 'task', priority: 2 }]
    : [];
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}
if (args[0] === 'comment') { process.stdout.write(''); process.exit(0); }
if (args[0] === 'label' && args[1] === 'add') { process.stdout.write(''); process.exit(0); }
if (args[0] === 'update') { process.stdout.write(''); process.exit(0); }
if (args[0] === 'dep' && args[1] === 'relate') { process.exit(1); }
process.stdout.write('[]');
process.exit(0);
`,
  { mode: 0o755 }
);

fs.writeFileSync(
  path.join(CONFIG_DIR, 'config.json'),
  JSON.stringify({ bdBin: FAKE_BD, actor: 'beadcause-test', workspaces: [WS] }, null, 2)
);

const BASE_ENV = { ...process.env, HOME: tmp, BEADCAUSE_CONFIG_DIR: CONFIG_DIR };

function run(bin, args, opts = {}) {
  const res = spawnSync(process.execPath, [BIN(bin), ...args], {
    encoding: 'utf8',
    env: BASE_ENV,
    ...opts,
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/* --------------------------------------------------------------------------- harness */

let failures = 0;
let ran = 0;
function check(name, fn) {
  ran += 1;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
}

console.log('\nthree bin/ entry points no suite ever ran\n');

/* =============================================================== bin/checkin.js */

check('checkin refuses with no workspace or issue, and names the usage', () => {
  const res = run('checkin.js', []);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /usage: beadcause-checkin/);
  assert.match(res.stderr, /workspaces: zz/);
});

check('checkin refuses a workspace it does not know', () => {
  const res = run('checkin.js', ['-w', 'nope', '-i', 'zz-abc']);
  assert.equal(res.status, 1);
});

check('checkin writes the checkin file and says so', async () => {
  const { checkinFileFor } = await import(path.join(ROOT, 'lib', 'advocate.js'));
  const before = new Date().toISOString();
  const res = run('checkin.js', ['-w', 'zz', '-i', 'zz-abc', '-m', 'rebasing onto main']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /checked in on zz\/zz-abc — rebasing onto main/);

  const file = checkinFileFor('zz', 'zz-abc');
  const said = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(said.note, 'rebasing onto main');
  assert.ok(said.at >= before, 'the timestamp is what the advocate compares its question against');
});

check('and a check-in with no message still writes one, silently on the note', () => {
  const res = run('checkin.js', ['-w', 'zz', '-i', 'zz-xyz']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /checked in on zz\/zz-xyz\n$/);
});

/* ================================================================ bin/status.js */

check('status refuses with no phase and no --clear', () => {
  const res = run('status.js', ['-w', 'zz', '-i', 'zz-abc']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /usage: beadcause-status/);
  assert.match(res.stderr, /phases:/);
});

check('status sets a phase and reports it, without bd — mirrorStateToBeads defaults off', async () => {
  const { readAll } = await import(path.join(ROOT, 'lib', 'activity.js'));
  const res = run('status.js', ['-w', 'zz', '-i', 'zz-abc', '-p', 'researching', '-m', 'reading the docs']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /zz\/zz-abc → researching · reading the docs/);
  const all = readAll();
  assert.equal(all['zz/zz-abc'].phase, 'researching');
  assert.equal(all['zz/zz-abc'].detail, 'reading the docs');
});

check('status --clear removes the activity and says so', async () => {
  const { readAll } = await import(path.join(ROOT, 'lib', 'activity.js'));
  const res = run('status.js', ['-w', 'zz', '-i', 'zz-abc', '--clear']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /cleared zz\/zz-abc/);
  assert.equal(readAll()['zz/zz-abc'], undefined);
});

check('an unknown phase is still accepted and shown as-is — the header says so', () => {
  const res = run('status.js', ['-w', 'zz', '-i', 'zz-abc', '-p', 'yak-shaving']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /→ yak-shaving/);
});

/* ================================================================== bin/plan.js */

check('plan refuses with no workspace or bead, and names the usage', () => {
  const res = run('plan.js', [], { input: 'groups: []' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /usage: beadcause-plan/);
});

check('plan refuses input that is not valid YAML', () => {
  const res = run('plan.js', ['-w', 'zz', '-b', EPIC_ID], { input: '{ not: yaml: at: all' });
  assert.equal(res.status, 3);
  assert.match(res.stderr, /not valid YAML/);
});

check('plan refuses input with no groups', () => {
  const res = run('plan.js', ['-w', 'zz', '-b', EPIC_ID], { input: 'note: nothing here\n' });
  assert.equal(res.status, 3);
  assert.match(res.stderr, /no groups/);
});

check('plan refuses an epic bd does not know about', () => {
  const res = run('plan.js', ['-w', 'zz', '-b', 'zz-missing'], {
    input: `groups:\n  - name: g\n    beads: [zz-missing.1]\n    prs:\n      - repo: beadcause\n        title: t\n    prompt: a plan for a bead that is not there.\n`,
  });
  assert.equal(res.status, 4);
  assert.match(res.stderr, /has no bead zz-missing/);
});

check('a real plan validates, comments, labels and hands the epic back — the whole path', () => {
  const res = run('plan.js', ['-w', 'zz', '-b', EPIC_ID], {
    input:
      `groups:\n` +
      `  - name: the-only-group\n` +
      `    beads: [${CHILD_ID}]\n` +
      `    prs:\n` +
      `      - repo: beadcause\n` +
      `        title: Do the thing\n` +
      `    prompt: This group is one window and one checkout, so it goes together.\n`,
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /planned zz-epic — 1 group, 1 pull request/);
  assert.match(res.stdout, /the-only-group: zz-epic\.1 → 1 in beadcause/);
});

check('and a plan naming a bead that is not a child of this epic is refused', () => {
  const res = run('plan.js', ['-w', 'zz', '-b', EPIC_ID], {
    input:
      `groups:\n` +
      `  - name: g\n` +
      `    beads: [zz-elsewhere.1]\n` +
      `    prs:\n` +
      `      - repo: beadcause\n` +
      `        title: t\n` +
      `    prompt: a plan naming a bead this epic does not have.\n`,
  });
  assert.equal(res.status, 4);
});

removeTreeSync(tmp);

console.log(`\n${ran - failures}/${ran} checks passed\n`);
process.exit(failures ? 1 : 0);
