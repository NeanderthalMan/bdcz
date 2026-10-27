#!/usr/bin/env node
/**
 * A bead a live session nobody briefed is working — `worked-by:<pid>`.
 *
 *     npm test
 *     node test/handsession.mjs
 *
 * bc-xl7n.156. A Claude session Adam opens by hand is invisible to every hold the
 * advocate reads, so it kept opening worker windows onto a bead he was building: each
 * found him, stood down, went quiet, was closed; the hand-back took its claim off and the
 * next tick opened another. The acceptance this suite is written to:
 *
 *   - a marked bead is never handed to a worker window — not by `Bd.ready`, and not by
 *     `openWorkSession` while the owner lives — **even after** the worker's claim is off;
 *   - when the owning process exits, the next sweep clears the marker and the bead is
 *     ready again;
 *   - a worker that finds the live session has a way to end that writes the marker
 *     (`mark`, which bin/working.js wraps) and releases its own claim;
 *   - and the reconcile treats that window's quiet ending as a stand-down, not a charge.
 *
 * The "live claude process" is real: a symlink named `claude` to /bin/sleep, spawned, so
 * `ps` sees an argv whose first word's basename is `claude` — on any machine, CI included.
 * `bd` is the stub test/farblock.mjs uses, plus `list --label-pattern`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-handsession-'));
// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { Bd } = await import(LIB('bd.js'));
const H = await import(LIB('handsession.js'));
const { openWorkSession } = await import(LIB('session.js'));

/* ------------------------------------------------------------------- the stub bd */

const WORLD = path.join(tmp, 'world.json');
const BD_LOG = path.join(tmp, 'bd-calls.log');
const FAKE_BD = path.join(tmp, 'bd');

fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(BD_LOG)}, JSON.stringify(args) + '\\n');
const w = JSON.parse(fs.readFileSync(${JSON.stringify(WORLD)}, 'utf8'));
const save = () => fs.writeFileSync(${JSON.stringify(WORLD)}, JSON.stringify(w, null, 2));
const die = (m) => { process.stderr.write(m + '\\n'); process.exit(1); };
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const many = (n) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === n) out.push(...String(args[i + 1] || '').split(',')); return out.filter(Boolean); };
const row = (i) => ({
  ...i,
  dependencies: (i.blockedBy || []).map((id) => ({ id, dependency_type: 'blocks', status: (w.issues[id] || {}).status || 'closed', title: (w.issues[id] || {}).title || '' })),
});
const all = () => Object.values(w.issues).map(row);
const blocked = (i) => (i.dependencies || []).some((d) => d.dependency_type === 'blocks' && d.status !== 'closed');

if (args[0] === 'ready') {
  const off = many('--exclude-label');
  const need = many('--label');
  const rows = all()
    .filter((i) => i.status === 'open' && !i.assignee)
    .filter((i) => !blocked(i))
    .filter((i) => !(i.labels || []).some((l) => off.includes(l)))
    .filter((i) => need.every((l) => (i.labels || []).includes(l)));
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}
if (args[0] === 'show') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error fetching ' + args[1] + ': no issue found');
  process.stdout.write(JSON.stringify([row(issue)]));
  process.exit(0);
}
if (args[0] === 'comments') { process.stdout.write(JSON.stringify(w.comments[args[1]] || [])); process.exit(0); }
if (args[0] === 'comment') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error: no issue found matching "' + args[1] + '"');
  (w.comments[args[1]] = w.comments[args[1]] || []).push({ text: args[2] });
  issue.comment_count = w.comments[args[1]].length;
  save();
  process.exit(0);
}
if (args[0] === 'close') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error: no issue found matching "' + args[1] + '"');
  if (blocked(row(issue))) die('Error: cannot close ' + args[1] + ': blocked by open issues');
  issue.status = 'closed';
  issue.close_reason = flag('--reason') || '';
  save();
  process.exit(0);
}
if (args[0] === 'update') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error: no issue found matching "' + args[1] + '"');
  if (args.includes('--status')) issue.status = flag('--status');
  if (args.includes('--status=open')) issue.status = 'open';
  if (args.includes('--assignee')) issue.assignee = flag('--assignee') || '';
  save();
  process.exit(0);
}
if (args[0] === 'label' && (args[1] === 'add' || args[1] === 'remove')) {
  const issue = w.issues[args[2]];
  if (!issue) die('Error: no issue found matching "' + args[2] + '"');
  issue.labels = issue.labels || [];
  if (args[1] === 'add') { if (!issue.labels.includes(args[3])) issue.labels.push(args[3]); }
  else {
    if (!issue.labels.includes(args[3])) die('no label ' + args[3] + ' on ' + args[2]);
    issue.labels = issue.labels.filter((l) => l !== args[3]);
  }
  save();
  process.exit(0);
}
if (args[0] === 'list') {
  const pat = flag('--label-pattern');
  const eq = args.find((a) => a.startsWith('--status='));
  const statuses = String((eq && eq.slice(9)) || flag('--status') || 'open').split(',');
  const pre = pat ? pat.slice(0, -1) : null;
  const rows = all()
    .filter((i) => statuses.includes(i.status))
    .filter((i) => !pre || (i.labels || []).some((l) => l.startsWith(pre)));
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}
process.stdout.write('[]');
`,
  { mode: 0o755 }
);

const issue = (id, extra = {}) => ({
  id,
  title: `bead ${id}`,
  description: `what ${id} is for`,
  notes: '',
  status: 'open',
  issue_type: 'task',
  priority: 2,
  labels: [],
  blockedBy: [],
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-01T00:00:00Z',
  ...extra,
});

const reset = (issues) => fs.writeFileSync(WORLD, JSON.stringify({ comments: {}, issues }, null, 2));
const world = () => JSON.parse(fs.readFileSync(WORLD, 'utf8'));
const beadOf = (id) => world().issues[id];

const wsDir = path.join(tmp, 'ws', '.beads');
fs.mkdirSync(wsDir, { recursive: true });
const ws = { name: 'demo', dir: wsDir };
const bd = new Bd({ bin: FAKE_BD, actor: 'beadcause-test' });
/** The synchronous runner `mark` takes, against the same stub. */
const syncBd = (args) => execFileSync(FAKE_BD, args, { env: { ...process.env, BEADS_DIR: wsDir }, encoding: 'utf8' });

/** A real process whose argv's first word is `.../claude`. */
const CLAUDE = path.join(tmp, 'claude');
fs.symlinkSync('/bin/sleep', CLAUDE);
const startClaude = async () => {
  const child = spawn(CLAUDE, ['300'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 150));
  return child;
};
const stop = (child) =>
  new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGKILL');
  });
const OTHER = spawn('/bin/sleep', ['300'], { stdio: 'ignore' }); // live, and not claude
const ps = (pid) => (pid === 8 || pid === 7 ? 'claude' : null);

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
}

console.log('\na bead a hand-opened session is working\n');

await check('the marker is the prefix and a pid, and nothing else is one', () => {
  assert.equal(H.handLabel(14758), 'worked-by:14758');
  assert.equal(H.workedBy({ labels: ['agent-filed', 'worked-by:14758'] }), 14758);
  assert.equal(H.workedBy({ labels: ['worked-by:somebody'] }), 0, 'free text holds nothing');
  assert.equal(H.workedBy({ labels: ['worked-by:0'] }), 0);
  assert.equal(H.isHandWorked(null), false);
});

await check('liveness: a claude argv is live, anything else or nothing is gone, a ps that fails is unknown', () => {
  assert.equal(H.probe(5, { ps: () => '/usr/local/bin/claude --model opus' }), 'live');
  assert.equal(H.probe(5, { ps: () => 'claude' }), 'live');
  assert.equal(H.probe(5, { ps: () => '/bin/zsh -c make' }), 'gone', 'a reused pid holds nothing');
  assert.equal(H.probe(5, { ps: () => '/opt/claude-tools/bin/node x' }), 'gone', 'only the basename counts');
  assert.equal(H.probe(5, { ps: () => null }), 'gone');
  const broken = () => {
    throw new Error('no ps');
  };
  assert.equal(H.probe(5, { ps: broken }), 'unknown');
});

await check('the real ps agrees, against real processes', async () => {
  const c = await startClaude();
  try {
    assert.equal(H.probe(c.pid), 'live');
    assert.equal(H.probe(OTHER.pid), 'gone', 'alive but not claude');
  } finally {
    await stop(c);
  }
  assert.equal(H.probe(c.pid), 'gone', 'and gone once it exits');
});

await check('claudeAncestor walks up to the session, and a briefed window is recognisable', () => {
  const table = new Map([
    [300, { ppid: 200, args: 'node bin/working.js' }],
    [200, { ppid: 100, args: '/bin/zsh -c node bin/working.js' }],
    [100, { ppid: 1, args: 'claude --permission-mode auto -- You are working bead **demo/zz-1**' }],
  ]);
  const found = H.claudeAncestor(300, (p) => table.get(p) || null);
  assert.equal(found.pid, 100);
  assert.equal(H.isBriefedArgs(found.args), true);
  assert.equal(H.isBriefedArgs('claude --permission-mode auto'), false);
  assert.equal(H.claudeAncestor(300, () => null), null);
});

await check('the whole loop: marked, never dispatched even unclaimed, cleared when the session exits', async () => {
  const hand = await startClaude();
  reset({
    // A worker window found the live builder, after claiming the bead as the brief says.
    'zz-a': issue('zz-a', { status: 'in_progress', assignee: 'neo@example.com' }),
    'zz-work': issue('zz-work'),
  });

  const out = H.mark(syncBd, 'zz-a', hand.pid, { row: beadOf('zz-a') });
  assert.equal(out.refused, '');
  assert.equal(out.marked, true);
  assert.equal(out.released, true, 'its own claim came off');
  assert.deepEqual(beadOf('zz-a').labels, [H.handLabel(hand.pid)]);
  assert.equal(beadOf('zz-a').status, 'open');
  assert.equal(beadOf('zz-a').assignee, '');

  // Open and unclaimed — exactly what the hand-back leaves — and still not ready work.
  const ready = (await bd.ready(ws)).map((r) => r.id);
  assert.ok(!ready.includes('zz-a'), 'the marker keeps it out of the queue');
  assert.ok(ready.includes('zz-work'), 'the control is unaffected');

  // Refused at the launcher while the session lives, off the tracker's own row.
  const cfg = { sessionDirs: { demo: tmp }, openSessions: true };
  await assert.rejects(
    () => openWorkSession(cfg, ws, { id: 'zz-a', title: 'x', labels: [] }, { bd }),
    (err) => err.status === 409 && err.handWorked === true
  );

  let swept = await H.sweepHandSessions(bd, ws);
  assert.equal(swept.ok, true);
  assert.equal(swept.checked, 1);
  assert.equal(swept.cleared.length, 0, 'a sweep while it lives changes nothing');
  assert.deepEqual(beadOf('zz-a').labels, [H.handLabel(hand.pid)]);

  await stop(hand);
  swept = await H.sweepHandSessions(bd, ws);
  assert.deepEqual(
    swept.cleared.map((c) => c.id),
    ['zz-a']
  );
  assert.deepEqual(beadOf('zz-a').labels, []);
  assert.match(world().comments['zz-a'].at(-1).text, /has exited/);
  assert.ok((await bd.ready(ws)).map((r) => r.id).includes('zz-a'), 'ordinary work again');
  assert.match(H.describeHandSessions(swept), /cleared 1 hand-session marker — zz-a/);
});

await check('the sweep sees an in_progress bead too — a hand session that claimed its own', async () => {
  reset({ 'zz-b': issue('zz-b', { status: 'in_progress', assignee: 'x', labels: ['worked-by:999999999'] }) });
  const swept = await H.sweepHandSessions(bd, ws, { ps: () => null });
  assert.deepEqual(
    swept.cleared.map((c) => c.id),
    ['zz-b']
  );
});

await check('a stale marker is not a refusal at the launcher; a live or unknown one is', () => {
  const row = { id: 'zz-c', labels: ['worked-by:42'] };
  assert.equal(H.assertNotHandWorked(row, { ps: () => null }), row);
  assert.throws(() => H.assertNotHandWorked(row, { ps: () => 'claude' }), (e) => e.handWorked === true);
  const broken = () => {
    throw new Error('x');
  };
  assert.throws(() => H.assertNotHandWorked(row, { ps: broken }), (e) => e.handWorked === true);
});

await check('an unknown answer from ps never clears a marker', async () => {
  reset({ 'zz-d': issue('zz-d', { labels: ['worked-by:42'] }) });
  const broken = () => {
    throw new Error('ps is gone');
  };
  const swept = await H.sweepHandSessions(bd, ws, { ps: broken });
  assert.equal(swept.cleared.length, 0);
  assert.equal(swept.skipped.length, 1);
  assert.deepEqual(beadOf('zz-d').labels, ['worked-by:42']);
});

await check('mark refuses a pid that is not a live claude, a closed bead, and a second live owner', () => {
  reset({ 'zz-e': issue('zz-e'), 'zz-f': issue('zz-f', { status: 'closed' }) });
  assert.match(H.mark(syncBd, 'zz-e', OTHER.pid, { row: beadOf('zz-e') }).refused, /not a live claude/);
  assert.match(H.mark(syncBd, 'zz-f', 8, { row: beadOf('zz-f'), ps }).refused, /already closed/);
  assert.match(H.mark(syncBd, 'zz-e', 'x', { row: beadOf('zz-e'), ps }).refused, /not a pid/);
  const owned = { ...beadOf('zz-e'), labels: ['worked-by:7'] };
  assert.match(H.mark(syncBd, 'zz-e', 8, { row: owned, ps }).refused, /still alive/);
  assert.deepEqual(beadOf('zz-e').labels, [], 'nothing was written by any of them');
  assert.equal(H.mark(syncBd, 'zz-e', 7, { row: owned, ps }).alreadyMarked, true);
});

await check('mark replaces a marker whose owner has gone', () => {
  reset({ 'zz-g': issue('zz-g', { labels: ['worked-by:9'] }) });
  const out = H.mark(syncBd, 'zz-g', 8, { row: beadOf('zz-g'), ps });
  assert.equal(out.replaced, 9);
  assert.deepEqual(beadOf('zz-g').labels, ['worked-by:8']);
});

await check('the reconcile ends a quiet window on a marked bead as a stand-down, ahead of the charging arm', () => {
  const src = fs.readFileSync(LIB('advocate.js'), 'utf8');
  const guard = src.indexOf('if (quiet && isHandWorked(issue))');
  assert.ok(guard > 0, 'the stand-down arm exists');
  const arm = src.slice(guard, guard + 400);
  assert.match(arm, /delete a\.attempts\[w\.id\]/, 'it clears the counter rather than charging');
  assert.match(arm, /'stood-down'/);
  assert.ok(src.indexOf('if (ended) {', guard) > guard, 'and the ended arm that charges comes after it');
});

OTHER.kill('SIGKILL');
console.log(`\n${ran - failures}/${ran} passed`);
cleanupTmp(tmp);
process.exit(failures ? 1 : 0);
