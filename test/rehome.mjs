#!/usr/bin/env node
/**
 * `b7e-rehome` — move a bead to the tracker that can actually deliver it, verbatim.
 *
 *     npm test
 *     node test/rehome.mjs
 *
 * bc-dgx7.138: four delmar sessions each moved a bead like this by hand, no two of
 * them the same way, and the one that carried the text across verbatim paid for it with
 * a `bd show --json`, a Python reshape and a hand-rolled poll loop. This file has two
 * halves. The first drives `lib/rehome.js`'s own functions directly — the collision
 * check, the label carry, the field carry — because those are pure and a unit test
 * catches a regression in them for the price of a function call. The second spawns
 * `bin/b7e-rehome` for real, against two fake trackers keyed by `BEADS_DIR` the way
 * `test/supersedecli.mjs` already does for `bin/supersede.js`, because the acceptance
 * bar here is what actually lands: "the description identical to `bd show <id>
 * --json`'s, diffed rather than eyeballed."
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
const LIB = (name) => path.join(ROOT, 'lib', name);

let failures = 0;
let ran = 0;
const check = (name, fn) => {
  ran += 1;
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n').slice(0, 6).join('\n      ')}`);
  }
};
const checkAsync = async (name, fn) => {
  ran += 1;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n').slice(0, 6).join('\n      ')}`);
  }
};

/* -------------------------------------------------------------- lib/rehome.js, direct */

const { impliedCommandName, binCollision, carryLabels, carryFields, rivalSweep } = await import(LIB('rehome.js'));

console.log('\nlib/rehome.js — the collision check, the label and field carry\n');

check('a b7e-<verb> token in the title is the implied command name', () => {
  assert.equal(impliedCommandName('b7e-rehome — Move a bead to the tracker that can actually deliver it'), 'b7e-rehome');
});

check('a title with no b7e- token implies nothing', () => {
  assert.equal(impliedCommandName('Cache-bust site.js'), null);
});

check('binCollision finds the extensionless shape', () => {
  const found = new Set(['/repo/bin/b7e-taken']);
  assert.equal(binCollision('/repo', 'b7e-taken', { existsSync: (p) => found.has(p) }), '/repo/bin/b7e-taken');
});

check('binCollision also finds the .js shape a worker command takes', () => {
  const found = new Set(['/repo/bin/beadcause-taken.js']);
  assert.equal(binCollision('/repo', 'beadcause-taken', { existsSync: (p) => found.has(p) }), '/repo/bin/beadcause-taken.js');
});

check('binCollision is null when neither shape is there, or dir/name is missing', () => {
  assert.equal(binCollision('/repo', 'b7e-nope', { existsSync: () => false }), null);
  assert.equal(binCollision(null, 'b7e-x'), null);
  assert.equal(binCollision('/repo', null), null);
});

check('carryLabels drops held: and filed-while:, keeps the rest, adds rehomed-from', () => {
  const row = { labels: ['agent-filed', 'complexity:medium', 'filed-while:bc-dgx7', 'held:20260918T:me'] };
  assert.deepEqual(carryLabels(row, { rehomedFrom: 'delmar/dv-afr.40' }), ['agent-filed', 'complexity:medium', 'rehomed-from:delmar/dv-afr.40']);
});

check('carryLabels with no rehomedFrom just filters', () => {
  assert.deepEqual(carryLabels({ labels: ['held:x:y', 'topical'] }), ['topical']);
});

check('carryFields passes the description straight through — no surface, no rewrite', () => {
  const row = {
    title: 'b7e-rehome — verbatim move',
    description: 'Line one.\n\nLine two, with a `backtick` in it.',
    issue_type: 'task',
    priority: 1,
    acceptance_criteria: 'It moves.',
    notes: 'A human wrote this.',
    labels: ['agent-filed'],
  };
  const fields = carryFields(row, { parent: 'bc-dgx7', endorsed: true, rehomedFrom: 'delmar/dv-afr.40' });
  assert.equal(fields.body, row.description, 'byte for byte, not reformatted');
  assert.equal(fields.title, row.title);
  assert.equal(fields.type, 'task');
  assert.equal(fields.priority, 1, 'unclamped — this is a relocation, not a fresh finding');
  assert.equal(fields.acceptance, 'It moves.');
  assert.equal(fields.notes, 'A human wrote this.');
  assert.equal(fields.parent, 'bc-dgx7');
  assert.deepEqual(fields.labels, ['agent-filed', 'rehomed-from:delmar/dv-afr.40']);
});

check('carryFields adds unendorsed when the destination is not auto-endorsing', () => {
  const fields = carryFields({ title: 't', description: '', labels: [] }, { parent: 'bc-dgx7', endorsed: false });
  assert.ok(fields.labels.includes('unendorsed'));
});

check('carryFields does not double up unendorsed if it was already there', () => {
  const fields = carryFields({ title: 't', description: '', labels: ['unendorsed'] }, { parent: 'bc-dgx7', endorsed: false });
  assert.equal(fields.labels.filter((l) => l === 'unendorsed').length, 1);
});

check('rivalSweep ranks a near-verbatim title top, and skips an unrelated bead', () => {
  const source = { id: 'dv-afr.40', title: 'b7e-rehome — move a bead to the tracker that can deliver it', description: 'verbatim move across trackers' };
  const destRows = [
    { id: 'bc-1', title: 'b7e-rehome — move a bead to the tracker that can actually deliver it', description: 'verbatim move across trackers, rival sweep and supersede', status: 'open' },
    { id: 'bc-2', title: 'Fix a typo in the deploy script', description: 'unrelated', status: 'open' },
  ];
  const ranked = rivalSweep(source, destRows, { destWorkspace: 'beadcause' });
  assert.ok(ranked.length >= 1, 'the near-verbatim bead ranks above the floor');
  assert.equal(ranked[0].id, 'bc-1');
  assert.ok(!ranked.some((r) => r.id === 'bc-2'), 'the unrelated bead never clears the floor');
});

check('rivalSweep returns nothing when nothing in the pool is alike', () => {
  const source = { id: 'dv-x', title: 'b7e-rehome — move a bead verbatim', description: 'moves a bead' };
  const destRows = [{ id: 'bc-1', title: 'Unrelated bug in the router', description: 'a 502 on checkout', status: 'open' }];
  assert.deepEqual(rivalSweep(source, destRows, { destWorkspace: 'beadcause' }), []);
});

/* --------------------------------------------------------------- bin/b7e-rehome, real */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-rehome-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const FAKE_BD = path.join(tmp, 'bd');

/**
 * A tracker per `BEADS_DIR`, the same shape `test/supersedecli.mjs` already proved out
 * for a cross-workspace `bin/supersede.js` run — `Bd.run` and the raw `execFileSync`
 * runner `mark` takes both set `BEADS_DIR` to `workspace.dir`, so one fake binary
 * dispatching on that variable serves every call this command makes, in either
 * workspace, however it reaches `bd`.
 */
fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2).filter((a, i, all) => a !== '--actor' && all[i - 1] !== '--actor');
const WORLD = path.join(process.env.BEADS_DIR, 'world.json');
const w = JSON.parse(fs.readFileSync(WORLD, 'utf8'));
const save = () => fs.writeFileSync(WORLD, JSON.stringify(w, null, 2));
const die = (m) => { process.stderr.write(m + '\\n'); process.exit(1); };
w.calls.push(args.join(' '));
save();
const one = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const many = (n) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === n) out.push(args[i + 1]); return out; };

if (args[0] === 'show') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error fetching ' + args[1] + ': no issue found');
  process.stdout.write(JSON.stringify([issue]));
  process.exit(0);
}
if (args[0] === 'list') {
  process.stdout.write(JSON.stringify(Object.values(w.issues)));
  process.exit(0);
}
if (args[0] === 'create') {
  const id = w.nextId || 'zz-new1';
  w.issues[id] = {
    id,
    title: one('--title', ''),
    description: one('--description', ''),
    acceptance_criteria: one('--acceptance', ''),
    design: one('--design', ''),
    notes: one('--notes', ''),
    status: 'open',
    issue_type: one('--type', 'task'),
    priority: Number(one('--priority', '2')),
    labels: many('--label'),
    parent: one('--parent', ''),
  };
  save();
  process.stdout.write(JSON.stringify({ id }));
  process.exit(0);
}
if (args[0] === 'label' && args[1] === 'add') {
  const issue = w.issues[args[2]];
  if (!issue) die('Error: no issue found matching "' + args[2] + '"');
  issue.labels = [...(issue.labels || []), args[3]];
  save();
  process.exit(0);
}
if (args[0] === 'update') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error: no issue found matching "' + args[1] + '"');
  if (args.includes('--status=open')) issue.status = 'open';
  save();
  process.exit(0);
}
if (args[0] === 'comment') {
  (w.comments[args[1]] = w.comments[args[1]] || []).push(args[2]);
  save();
  process.exit(0);
}
if (args[0] === 'dep') { process.exit(0); }
process.stdout.write('[]');
`,
  { mode: 0o755 }
);

const aDir = path.join(tmp, 'a', '.beads');
const bDir = path.join(tmp, 'b', '.beads');
fs.mkdirSync(aDir, { recursive: true });
fs.mkdirSync(bDir, { recursive: true });

fs.writeFileSync(
  path.join(process.env.BEADCAUSE_CONFIG_DIR, 'config.json'),
  JSON.stringify(
    {
      bdBin: FAKE_BD,
      actor: 'beadcause-test',
      workspaces: [
        { name: 'a', dir: aDir },
        { name: 'b', dir: bDir },
      ],
    },
    null,
    2
  )
);

const worldFile = (dir) => path.join(dir, 'world.json');
const issue = (id, extra = {}) => ({
  id,
  title: `bead ${id}`,
  description: '',
  acceptance_criteria: '',
  design: '',
  notes: '',
  status: 'open',
  issue_type: 'task',
  priority: 2,
  labels: [],
  parent: '',
  ...extra,
});

const sourceBead = issue('dv-afr.40', {
  title: 'b7e-rehome — Move a bead to the tracker that can actually deliver it, verbatim',
  description: 'Four delmar sessions did this by hand. Every deliverable lives in `bin/` and `lib/` in beadcause.',
  acceptance_criteria: 'The description diffs identical to `bd show <id> --json`.',
  notes: 'A human added this note.',
  priority: 1,
  labels: ['agent-filed', 'complexity:medium', 'filed-while:dv-y3', 'held:20260918T000000Z:someone@example.com'],
});

const reset = ({ nextId = 'bc-new1' } = {}) => {
  fs.writeFileSync(
    worldFile(aDir),
    JSON.stringify({ calls: [], comments: {}, nextId, issues: { 'dv-afr.40': sourceBead } }, null, 2)
  );
  fs.writeFileSync(
    worldFile(bDir),
    JSON.stringify({ calls: [], comments: {}, nextId, issues: { 'bc-dgx7': issue('bc-dgx7', { issue_type: 'epic' }) } }, null, 2)
  );
};

const world = (dir) => JSON.parse(fs.readFileSync(worldFile(dir), 'utf8'));

const rehome = (args) => {
  const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'b7e-rehome'), '-w', 'a', '--to', 'b', ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmp, BEADCAUSE_CONFIG_DIR: process.env.BEADCAUSE_CONFIG_DIR },
  });
  if (res.error) throw res.error;
  return { status: res.status, out: res.stdout || '', err: res.stderr || '' };
};

console.log('\nbin/b7e-rehome, spawned against two fake trackers\n');

await checkAsync('a real move: the description diffs identical, the parent, and the marker', async () => {
  reset({ nextId: 'bc-new1' });
  const { status, out } = rehome(['-b', 'dv-afr.40', '--under', 'bc-dgx7']);
  assert.equal(status, 0, out);
  const wb = world(bDir);
  const landed = wb.issues['bc-new1'];
  assert.ok(landed, `expected bc-new1 in b's tracker: ${JSON.stringify(Object.keys(wb.issues))}`);
  assert.equal(landed.description, sourceBead.description, 'diffed, not eyeballed');
  assert.equal(landed.title, sourceBead.title);
  assert.equal(landed.priority, 1, 'unclamped');
  assert.equal(landed.parent, 'bc-dgx7');
  assert.ok(landed.labels.includes('agent-filed'));
  assert.ok(!landed.labels.some((l) => l.startsWith('held:')), 'a lease on the OLD session does not travel');
  assert.ok(!landed.labels.some((l) => l.startsWith('filed-while:')), 'an edge into a tracker this bead is not in does not travel');
  assert.ok(landed.labels.includes('rehomed-from:a/dv-afr.40'));

  const wa = world(aDir);
  assert.deepEqual(wa.issues['dv-afr.40'].labels.filter((l) => l.startsWith('superseded-by:')), ['superseded-by:b/bc-new1']);
  assert.ok(wa.comments['dv-afr.40']?.[0]?.includes('b/bc-new1'), `comment: ${JSON.stringify(wa.comments)}`);
  assert.match(out, /filed b\/bc-new1, under bc-dgx7/);
  assert.match(out, /marked a\/dv-afr\.40 superseded-by b\/bc-new1/);
});

await checkAsync('--dry-run writes to neither tracker', async () => {
  reset();
  const { status, out } = rehome(['-b', 'dv-afr.40', '--under', 'bc-dgx7', '--dry-run']);
  assert.equal(status, 0, out);
  assert.match(out, /DRY RUN/);
  const wb = world(bDir);
  assert.deepEqual(Object.keys(wb.issues), ['bc-dgx7'], 'b: no bead created');
  assert.deepEqual(world(aDir).issues['dv-afr.40'].labels, sourceBead.labels, 'a: untouched');
});

await checkAsync('--to the same workspace as -w is refused, nothing written', async () => {
  reset();
  const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'b7e-rehome'), '-w', 'a', '--to', 'a', '-b', 'dv-afr.40', '--under', 'bc-dgx7'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmp, BEADCAUSE_CONFIG_DIR: process.env.BEADCAUSE_CONFIG_DIR },
  });
  assert.equal(res.status, 4);
  assert.match(res.stderr, /nowhere to move this to/);
  assert.deepEqual(world(aDir).calls, [], 'nothing was even read');
});

await checkAsync('an unknown --to is refused, nothing written', async () => {
  reset();
  const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'b7e-rehome'), '-w', 'a', '--to', 'ghost', '-b', 'dv-afr.40', '--under', 'bc-dgx7'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmp, BEADCAUSE_CONFIG_DIR: process.env.BEADCAUSE_CONFIG_DIR },
  });
  assert.equal(res.status, 4);
  assert.match(res.stderr, /no workspace named ghost/);
});

await checkAsync('a missing --under in the destination tracker is refused before anything is written', async () => {
  reset();
  const { status, err } = rehome(['-b', 'dv-afr.40', '--under', 'bc-ghost']);
  assert.equal(status, 4);
  assert.match(err, /no bead bc-ghost/);
  const wb = world(bDir);
  assert.deepEqual(Object.keys(wb.issues), ['bc-dgx7'], 'b: no bead created');
});

await checkAsync('--under omitted is a usage refusal, not a guess', async () => {
  reset();
  const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'b7e-rehome'), '-w', 'a', '--to', 'b', '-b', 'dv-afr.40'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmp, BEADCAUSE_CONFIG_DIR: process.env.BEADCAUSE_CONFIG_DIR },
  });
  assert.equal(res.status, 2);
});

await checkAsync('--json prints one object, with the rival sweep and the new id', async () => {
  reset();
  const { status, out } = rehome(['-b', 'dv-afr.40', '--under', 'bc-dgx7', '--json']);
  assert.equal(status, 0, out);
  const parsed = JSON.parse(out);
  assert.equal(parsed.newId, 'bc-new1');
  assert.equal(parsed.to, 'b');
  assert.ok(Array.isArray(parsed.rivals));
});

console.log(failures ? `\n${failures}/${ran} failed\n` : `\n${ran}/${ran} passed\n`);
await cleanupTmp(tmp);
process.exit(failures ? 1 : 0);
