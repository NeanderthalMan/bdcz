#!/usr/bin/env node
/**
 * b7e-dryrun and lib/dryrun.js — a sweep run against live state with every write recorded
 * instead of performed (bc-dgx7.168).
 *
 *     npm test
 *     node test/dryrun.mjs
 *
 * Five layers, because the claim is that NOTHING is written and each layer is a different
 * way to be wrong:
 *
 *   1. the classifiers — an allowlist of reads, so an unknown verb is a write;
 *   2. the process-level guards, in-process, including the two ways they missed on the
 *      first build (a `promisify(execFile)` captured before install, and a bare
 *      `process.kill(pid)`, which is SIGTERM and not a probe);
 *   3. `dryBd` over the real `Bd` class with a stub binary that logs every argv, driving
 *      EVERY write method — the stub's log must hold no write verb afterwards;
 *   4. bin/b7e-dryrun as a real subprocess against a stub tracker;
 *   5. the acceptance run: a real `bd` workspace whose `bd export` is byte-identical after a
 *      sweep that comments on, closes, labels and files beads. Skipped loudly without `bd`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { provisionBdWorkspace } from './helpers/bdtemplate.mjs';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-dryrun');

const dry = await import(path.join(ROOT, 'lib', 'dryrun.js'));
const { Bd } = await import(path.join(ROOT, 'lib', 'bd.js'));

let failures = 0;
let ran = 0;
const check = async (name, fn) => {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
};

console.log('\nb7e-dryrun\n');

/* ============================================================== 1. the classifiers */

const bdCase = (argv, write, verb) =>
  check(`bd ${argv.join(' ')} is a ${write ? 'write' : 'read'}`, () => {
    const c = dry.classifyBd(argv);
    assert.equal(c.write, write, JSON.stringify(c));
    if (verb) assert.equal(c.verb, verb);
  });

// Every argv shape lib/bd.js builds, by verb.
for (const argv of [
  ['show', 'x-1'], ['show', 'x-1', '--include-comments'], ['list', '--limit', '0'], ['list', '--all', '--limit', '0'],
  ['ready', '--limit', '0'], ['status'], ['export'], ['comments', 'x-1'], ['human', 'list'],
  ['dep', 'list', 'x-1'], ['dep', 'list', 'x-1', '--direction=up'], ['dolt', 'remote', 'list'],
  ['search', 'q'], ['graph', '--all', '--html'],
]) await bdCase([...argv, '--json', '--actor', 'a'], false);
for (const [argv, verb] of [
  [['close', 'x-1', '--reason', 'r'], 'close'], [['comment', 'x-1', 't'], 'comment'],
  [['update', 'x-1', '--status', 'open'], 'update'], [['create', '--title', 't'], 'create'],
  [['label', 'add', 'x-1', 'l'], 'label add'], [['label', 'remove', 'x-1', 'l'], 'label remove'],
  [['dep', 'add', 'a', 'b'], 'dep add'], [['dep', 'remove', 'a', 'b'], 'dep remove'],
  [['dep', 'relate', 'a', 'b'], 'dep relate'], [['heartbeat', 'x-1'], 'heartbeat'],
  [['gc', '--skip-decay', '--force'], 'gc'], [['dolt', 'push'], 'dolt push'], [['dolt', 'pull'], 'dolt pull'],
  [['dolt', 'commit'], 'dolt commit'], [['comments', 'add', 'x-1', 't'], 'comments'],
  [['some-verb-bd-grows-next-year', 'x'], 'some-verb-bd-grows-next-year'],
]) await bdCase(argv, true, verb);

await check('a bd line drops --actor and --json, so it reads as the intent', () => {
  const c = dry.classifyBd(['close', 'bc-2g8s', '--reason', 'No pull request #410 in x/y', '--actor', 'beadcause', '--json']);
  assert.equal(c.text, 'close bc-2g8s --reason "No pull request #410 in x/y"');
});

const cmd = (file, args, write) =>
  check(`${file} ${args.join(' ')} is a ${write ? 'write' : 'read'}`, () => {
    assert.equal(dry.classifyCommand(file, args).write, write);
  });
for (const [f, a] of [
  ['git', ['status', '--porcelain']], ['git', ['-C', '/x', 'log', '--oneline']], ['git', ['worktree', 'list', '--porcelain']],
  ['git', ['branch', '--merged', 'main']], ['git', ['branch']], ['git', ['config', '--get', 'user.name']],
  ['git', ['rev-parse', '--abbrev-ref', 'HEAD']], ['git', ['for-each-ref', 'refs/heads']], ['git', ['-c', 'a=b', 'diff', 'HEAD']],
  ['gh', ['pr', 'view', '3', '--json', 'state']], ['gh', ['pr', 'list']], ['gh', ['api', 'repos/x/y/pulls']],
  ['gh', ['api', '-X', 'GET', 'repos/x/y']], ['ps', ['-Ao', 'pid=,args=']], ['pgrep', ['-f', 'x']], ['find', ['.', '-name', 'x']],
  ['/opt/homebrew/bin/bd', ['show', 'x-1']],
]) await cmd(f, a, false);
for (const [f, a] of [
  ['git', ['worktree', 'prune']], ['git', ['worktree', 'remove', '/x']], ['git', ['branch', '-D', 'x']], ['git', ['branch', 'new']],
  ['git', ['fetch', '--quiet', 'origin', 'main']], ['git', ['merge', '--ff-only', 'origin/main']], ['git', ['push', 'origin', 'x']],
  ['git', ['config', 'user.name', 'x']], ['git', ['reset', '--hard']], ['git', ['some-new-verb']],
  ['gh', ['pr', 'merge', '3']], ['gh', ['pr', 'comment', '3', '-b', 'x']], ['gh', ['api', '-X', 'POST', 'x']],
  ['gh', ['api', 'x', '-f', 'a=b']], ['rm', ['-rf', 'x']], ['osascript', ['-e', 'x']], ['node', ['x.js']],
  ['find', ['.', '-delete']], ['sed', ['-i', 's/a/b/', 'f']], ['bd', ['close', 'x-1']], ['claude', ['-p', 'x']],
]) await cmd(f, a, true);

await check('a command that went through a shell is never classified as a read', () => {
  assert.equal(dry.classifyCommand('git', ['status'], { shell: true }).write, true);
  assert.deepEqual(dry.splitSimpleShell('git status --short'), { file: 'git', args: ['status', '--short'] });
  assert.equal(dry.splitSimpleShell('git status; rm -rf x'), null);
  assert.equal(dry.splitSimpleShell('echo $(rm x)'), null);
});

await check('lib/bd.js spawns in exactly one place, which is the whole tracker guarantee', () => {
  // dryBd overrides `run`; a second spawn site in Bd would be a write nothing here saw.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'bd.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((code.match(/\bexecFile\(/g) || []).length, 1, 'more than one execFile( call in lib/bd.js');
  assert.ok(!/\bspawn(Sync)?\(|\bexecFileSync\(|\bexecSync\(/.test(code), 'lib/bd.js spawns another way');
});

/* ============================================================ parameter injection */

await check('parameters are read off the real sweeps: bd, ws, dir for reconcileLanded; dir for sweepWorktrees', async () => {
  const landed = await import(path.join(ROOT, 'lib', 'landed.js'));
  const tidy = await import(path.join(ROOT, 'lib', 'tidy.js'));
  assert.deepEqual(dry.injectableParams(landed.reconcileLanded), ['bd', 'ws', 'dir']);
  assert.deepEqual(dry.injectableParams(tidy.sweepWorktrees), ['dir']);
});

await check('injection stops at the first parameter it does not know, a default, or a destructure', () => {
  assert.deepEqual(dry.injectableParams(function f(bd, ws, opts) {}), ['bd', 'ws']);
  assert.deepEqual(dry.injectableParams(async function f(ws, bd = 3, x) {}), ['ws']);
  assert.deepEqual(dry.injectableParams(async function f({ bd }, ws) {}), []);
  assert.deepEqual(dry.injectableParams(function f(cfg, workspace, /* the checkout */ repo, extra) {}), ['cfg', 'ws', 'dir']);
  assert.deepEqual(dry.injectableParams(function f(/* nothing */) {}), []);
  assert.deepEqual(dry.injectableParams((bd) => bd), ['bd']);
  assert.deepEqual(dry.injectableParams(async (bd) => bd), ['bd']);
  assert.deepEqual(dry.injectableParams(bd => bd), []); // no parens at all: not parsed, honestly empty
  assert.deepEqual(dry.injectableParams(async (bd, ws) => bd), ['bd', 'ws']);
});

await check('buildCall fills by name then appends --args, and names what is missing', () => {
  const fn = function sweep(bd, ws, dir, opts) {};
  const c = dry.buildCall(fn, { bd: 'B', ws: 'W', dir: '/d', args: [{ a: 1 }] });
  assert.deepEqual(c.args, ['B', 'W', '/d', { a: 1 }]);
  assert.deepEqual(dry.buildCall(fn, { bd: 'B', args: [] }).missing, ['ws', 'dir']);
});

/* ================================================================ 2. process guards */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-dryrun-'));
const scratchRepo = path.join(tmp, 'repo');
fs.mkdirSync(scratchRepo);
execFileSync('git', ['init', '-q', scratchRepo]);
execFileSync('git', ['-C', scratchRepo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
const branches = () => execFileSync('git', ['-C', scratchRepo, 'branch', '--list'], { encoding: 'utf8' });
const OUTSIDE = path.join(ROOT, 'test', 'tmp-dryrun-must-not-exist.txt');

await check('installed guards refuse a git write and run a git read, then uninstall restores both', async () => {
  const rec = dry.createRecorder();
  const off = dry.installGuards(rec);
  try {
    assert.match(execFileSync('git', ['-C', scratchRepo, 'status', '--short'], { encoding: 'utf8' }), /^$/);
    assert.throws(() => execFileSync('git', ['-C', scratchRepo, 'branch', 'made-by-a-sweep']), /b7e-dryrun refused/);
    assert.ok(!/made-by-a-sweep/.test(branches()));
    assert.equal(rec.writes.length, 1);
    assert.equal(rec.writes[0].kind, 'git');
    assert.equal(rec.writes[0].captured, false);
  } finally {
    off();
  }
  execFileSync('git', ['-C', scratchRepo, 'branch', 'after-uninstall']);
  assert.match(branches(), /after-uninstall/);
});

await check('a promisified execFile made AFTER install is guarded, and refuses on the promise', async () => {
  const rec = dry.createRecorder();
  const off = dry.installGuards(rec);
  try {
    const cp = await import('node:child_process');
    const run = promisify(cp.execFile);
    const ok = await run('git', ['-C', scratchRepo, 'log', '--oneline']);
    assert.match(ok.stdout, /init/); // the custom promisify shape survives: { stdout, stderr }
    await assert.rejects(run('git', ['-C', scratchRepo, 'branch', 'via-promisify']), /b7e-dryrun refused/);
  } finally {
    off();
  }
  assert.ok(!/via-promisify/.test(branches()));
});

await check('a named ESM import of a built-in is guarded too (the live-binding sync)', async () => {
  const rec = dry.createRecorder();
  const fixture = path.join(tmp, 'named-import.mjs');
  fs.writeFileSync(fixture, `import { execFileSync } from 'node:child_process';\nexport const go = (d) => execFileSync('git', ['-C', d, 'branch', 'named']);\n`);
  const off = dry.installGuards(rec);
  try {
    const m = await import(`${pathToFileURL(fixture).href}?named`);
    assert.throws(() => m.go(scratchRepo), /b7e-dryrun refused/);
  } finally {
    off();
  }
  assert.ok(!/named/.test(branches()));
});

await check('fs writes outside the tmp dir are refused, inside it are performed, and a promise rejects rather than throws', async () => {
  const rec = dry.createRecorder();
  const off = dry.installGuards(rec);
  try {
    assert.throws(() => fs.writeFileSync(OUTSIDE, 'x'), /b7e-dryrun refused writeFile/);
    assert.ok(!fs.existsSync(OUTSIDE));
    fs.writeFileSync(path.join(tmp, 'inside.txt'), 'ok');
    assert.equal(fs.readFileSync(path.join(tmp, 'inside.txt'), 'utf8'), 'ok');
    // `.catch()` chained on a call must find the refusal: a synchronous throw would escape it.
    let caught = null;
    await fs.promises.rm(OUTSIDE, { force: true }).catch((e) => {
      caught = e;
    });
    assert.equal(caught?.code, 'EDRYRUN');
    assert.throws(() => fs.openSync(OUTSIDE, 'wx'), /b7e-dryrun refused open/);
    fs.closeSync(fs.openSync(path.join(tmp, 'inside.txt'), 'r')); // a read open is untouched
    assert.throws(() => fs.renameSync(path.join(tmp, 'inside.txt'), OUTSIDE), /b7e-dryrun refused rename/); // out of tmp is not a tmp write
  } finally {
    off();
  }
  assert.ok(!fs.existsSync(OUTSIDE));
});

await check('a non-GET fetch is refused; a bare process.kill is SIGTERM and is refused; signal 0 probes', async () => {
  const rec = dry.createRecorder();
  const off = dry.installGuards(rec);
  try {
    await assert.rejects(fetch('http://127.0.0.1:9/', { method: 'POST', body: 'x' }), /b7e-dryrun refused POST/);
    assert.throws(() => process.kill(process.pid), /b7e-dryrun refused kill/);
    assert.throws(() => process.kill(process.pid, 'SIGTERM'), /b7e-dryrun refused kill/);
    assert.equal(process.kill(process.pid, 0), true);
  } finally {
    off();
  }
});

await check('--allow lets a named binary through, and disarmed guards let everything through', async () => {
  const rec = dry.createRecorder();
  const off = dry.installGuards(rec, { allow: ['git'] });
  try {
    execFileSync('git', ['-C', scratchRepo, 'branch', 'allowed-git']);
    assert.match(branches(), /allowed-git/);
    assert.equal(rec.writes.length, 0);
  } finally {
    off();
  }
  const off2 = dry.installGuards(dry.createRecorder(), { armed: false });
  try {
    fs.writeFileSync(path.join(tmp, 'disarmed.txt'), 'x');
    off2.arm();
    assert.throws(() => fs.writeFileSync(OUTSIDE, 'x'), /b7e-dryrun refused/);
    off2.disarm();
  } finally {
    off2();
  }
});

/* ============================================================ 3. dryBd over the real Bd */

const FAKE_BD = path.join(tmp, 'bd');
fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dir = process.env.BEADS_DIR;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'bd.log'), JSON.stringify(args) + '\\n');
const world = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8'));
const v = args[0];
if (v === 'list' || v === 'ready') { process.stdout.write(JSON.stringify(world.filter((r) => r.status === 'open'))); process.exit(0); }
if (v === 'show') { process.stdout.write(JSON.stringify(world.filter((r) => r.id === args[1]))); process.exit(0); }
if (v === 'comments' || (v === 'dep' && args[1] === 'list')) { process.stdout.write('[]'); process.exit(0); }
if (v === 'create') { process.stdout.write(JSON.stringify({ id: 'REAL-WRITE' })); process.exit(0); }
process.exit(0);
`,
  { mode: 0o755 }
);
const dirFor = (name) => {
  const d = path.join(tmp, name, '.beads');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, 'world.json'),
    JSON.stringify([1, 2, 3].map((n) => ({ id: `lm-${n}`, title: `lm-${n} title`, status: 'open', labels: [], dependencies: [] })))
  );
  return d;
};
const readLog = (d) => {
  const f = path.join(d, 'bd.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const stubWrites = (log) =>
  log.filter((a) => {
    const [v, s] = a;
    if (['close', 'comment', 'update', 'create', 'gc', 'heartbeat'].includes(v)) return true;
    if (v === 'label' || v === 'dep') return s !== 'list';
    if (v === 'dolt') return s !== 'remote';
    return false;
  });

await check('every write method on a real Bd, driven through dryBd, reaches no bd at all', async () => {
  const ws = { name: 'lm', dir: dirFor('methods') };
  const rec = dry.createRecorder();
  const d = dry.dryBd(new Bd({ bin: FAKE_BD, actor: 'beadcause' }), rec);
  await d.close(ws, 'lm-1', 'done');
  await d.comment(ws, 'lm-1', 'a comment');
  await d.update(ws, 'lm-1', { title: 'new title', addLabels: ['a'], removeLabels: ['b'] });
  await d.setStatus(ws, 'lm-1', 'open', { refresh: false });
  await d.addLabel(ws, 'lm-1', 'l');
  await d.removeLabel(ws, 'lm-1', 'l');
  await d.assign(ws, 'lm-1', 'someone');
  await d.casAssign(ws, 'lm-1', { from: '', to: 'me', status: 'in_progress' });
  await d.adopt(ws, 'lm-1', 'lm-2', { refresh: false });
  await d.addDep(ws, 'lm-1', 'lm-2');
  await d.dropDep(ws, 'lm-1', 'lm-2');
  await d.reopen(ws, 'lm-1');
  await d.reopenAbandoned(ws, 'lm-1');
  await d.closeAnswered(ws, 'lm-1', 'answered');
  await d.answerOnce(ws, 'lm-1', 'yes');
  await d.respond(ws, 'lm-1', 'yes, do it');
  await d.commission(ws, 'lm-1', 'go');
  await d.noteOnly(ws, 'lm-1', 'a note');
  await d.appendNotes(ws, 'lm-1', 'more');
  assert.equal(await d.heartbeat(ws, 'lm-1'), true);
  await d.gc(ws);
  await d.doltPull(ws);
  await d.doltPush(ws);
  await d.doltCommit(ws);
  const id = await d.create(ws, { title: 'a follow-up', labels: [] });
  assert.match(id, /^dryrun-\d+$/, 'create must hand back a synthetic id, or the sweep cannot go on to comment on it');

  const said = stubWrites(readLog(ws.dir));
  assert.deepEqual(said, [], `the stub bd was asked to write:\n${JSON.stringify(said)}`);
  const verbs = new Set(rec.writes.map((w) => w.verb));
  for (const v of ['close', 'comment', 'update', 'label add', 'label remove', 'dep add', 'dep remove', 'create', 'gc', 'dolt pull', 'dolt push', 'dolt commit', 'heartbeat']) {
    assert.ok(verbs.has(v), `no recorded ${v} — got ${[...verbs].join(', ')}`);
  }
  assert.ok(rec.writes.every((w) => w.captured), 'a bd write is captured, never refused');
});

await check('reads on a dryBd go to the tracker and come back', async () => {
  const ws = { name: 'lm', dir: dirFor('reads') };
  const rec = dry.createRecorder();
  const d = dry.dryBd(new Bd({ bin: FAKE_BD, actor: 'beadcause' }), rec);
  assert.equal((await d.listStatus(ws, 'open')).length, 3);
  assert.equal((await d.show(ws, 'lm-2')).id, 'lm-2');
  assert.equal(rec.writes.length, 0);
  assert.ok(readLog(ws.dir).some((a) => a[0] === 'list'), 'the read never reached the tracker');
});

await check('close on a dryBd does not throw "the close did not happen", and a later read still sees it open', async () => {
  const ws = { name: 'lm', dir: dirFor('assert') };
  const d = dry.dryBd(new Bd({ bin: FAKE_BD, actor: 'beadcause' }), dry.createRecorder());
  await d.close(ws, 'lm-1', 'done'); // Bd.close ends by asking whether it worked
  assert.equal((await d.show(ws, 'lm-1')).status, 'open');
});

/* ================================================================ 4. the command */

const CFG_DIR = path.join(tmp, 'config');
fs.mkdirSync(CFG_DIR, { recursive: true });
const WS = { name: 'lm', dir: dirFor('cli') };
fs.writeFileSync(path.join(CFG_DIR, 'config.json'), JSON.stringify({ bdBin: FAKE_BD, actor: 'beadcause-test', workspaces: [WS] }, null, 2));

const FIXTURE = path.join(ROOT, 'test', 'tmp-b7edryrun-fixture.mjs');
fs.writeFileSync(
  FIXTURE,
  `import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
export async function sweep(bd, ws, opts = {}) {
  const open = await bd.listStatus(ws, 'open');
  for (const b of open) {
    await bd.comment(ws, b.id, 'lapsed ' + b.id);
    await bd.close(ws, b.id, 'Lapsed');
  }
  await bd.addLabel(ws, open[0].id, 'seen');
  const id = await bd.create(ws, { title: 'follow-up', labels: [] });
  await bd.comment(ws, id, 'child');
  return { closed: open.length, id, opts };
}
export function needsDir(dir, extra) {
  return { dir, extra };
}
export function outsideBd(dir) {
  const out = {};
  try { execFileSync('git', ['-C', dir, 'branch', 'made-by-a-sweep']); out.git = 'ran'; } catch (e) { out.git = String(e.message).split('\\n')[0]; }
  try { fs.writeFileSync(${JSON.stringify(OUTSIDE)}, 'x'); out.fs = 'ran'; } catch (e) { out.fs = String(e.message).split('\\n')[0]; }
  out.status = execFileSync('git', ['-C', dir, 'status', '--short'], { encoding: 'utf8' });
  return out;
}
export async function boom(bd, ws) {
  await bd.close(ws, 'lm-1', 'about to fail');
  throw new Error('kaboom\\nsecond line stays off the terminal');
}
export const notAFunction = 3;
`
);
const FIXTURE_REL = path.relative(ROOT, FIXTURE);

const cli = (args, opts = {}) => {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, HOME: tmp, BEADCAUSE_CONFIG_DIR: CFG_DIR },
    ...opts,
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

await check('--help prints usage and exits 0; no arguments prints it and exits nonzero', () => {
  const a = cli(['--help']);
  assert.equal(a.status, 0);
  assert.match(a.stdout, /usage:[\s\S]*b7e-dryrun/);
  assert.notEqual(cli([]).status, 0);
});

await check('a sweep run with --ws prints one WOULD line per bd write, in order, and a tally', () => {
  const r = cli([`${FIXTURE_REL}#sweep`, '--ws', 'lm']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n').filter((l) => l.startsWith('WOULD '));
  assert.deepEqual(lines.slice(0, 4), [
    'WOULD comment lm-1 "lapsed lm-1"',
    'WOULD close lm-1 --reason Lapsed',
    'WOULD comment lm-2 "lapsed lm-2"',
    'WOULD close lm-2 --reason Lapsed',
  ]);
  assert.ok(lines.some((l) => l === 'WOULD label add lm-1 seen'), r.stdout);
  assert.ok(lines.some((l) => l.startsWith('WOULD create --title follow-up')), r.stdout);
  assert.ok(lines.some((l) => l === 'WOULD comment dryrun-1 child'), 'the comment on the bead it would have filed');
  assert.match(r.stdout, /9 writes would have been made — comment 4, close 3, label add 1, create 1/);
  assert.match(r.stdout, /closed: 3/);
  assert.ok(!/INCOMPLETE/.test(r.stdout));
  assert.deepEqual(stubWrites(readLog(WS.dir)), []);
});

await check('--args supplies what follows the parameters filled by name', () => {
  const r = cli([`${FIXTURE_REL}#sweep`, '--ws', 'lm', '--args', '[{"limit":7}]']);
  assert.match(r.stdout, /limit: 7/);
  const n = cli([`${FIXTURE_REL}#needsDir`, '--repo', tmp, '--args', '["tail"]']);
  assert.match(n.stdout, new RegExp(`dir: '${tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(n.stdout, /extra: 'tail'/);
  assert.match(n.stdout, /0 writes would have been made/);
});

await check('--json is one object: writes, tally, what was returned, and whether it is incomplete', () => {
  const r = cli([`${FIXTURE_REL}#sweep`, '--ws', 'lm', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.equal(o.target, `${FIXTURE_REL}#sweep`);
  assert.equal(o.ws, 'lm');
  assert.deepEqual(o.filled, ['bd', 'ws']);
  assert.equal(o.writes.length, 9);
  assert.equal(o.writes[1].verb, 'close');
  assert.equal(o.tally.byVerb.close, 3);
  assert.equal(o.returned.closed, 3);
  assert.equal(o.incomplete, false);
});

await check('a write through something other than bd is refused, named, and the run says it is incomplete', () => {
  const r = cli([`${FIXTURE_REL}#outsideBd`, '--repo', scratchRepo]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /REFUSED git -C \S+ branch made-by-a-sweep/);
  assert.match(r.stdout, /REFUSED writeFile /);
  assert.match(r.stdout, /INCOMPLETE: 2 of them went through something other than bd/);
  assert.match(r.stdout, /git: 'b7e-dryrun refused git/, 'the sweep must have been handed the error');
  assert.ok(!/made-by-a-sweep/.test(branches()), 'the branch was created');
  assert.ok(!fs.existsSync(OUTSIDE), 'the file was written');
});

await check('a git read inside the sweep runs for real and is not reported', () => {
  const r = cli([`${FIXTURE_REL}#outsideBd`, '--repo', scratchRepo, '--json']);
  const o = JSON.parse(r.stdout);
  assert.equal(o.returned.status, '');
  assert.equal(o.writes.length, 2);
});

await check('--allow names a binary to run for real, and says so', () => {
  const r = cli([`${FIXTURE_REL}#outsideBd`, '--repo', scratchRepo, '--allow', 'git']);
  assert.match(r.stdout, /RUN FOR REAL, unguarded: git/);
  assert.match(branches(), /made-by-a-sweep/);
  execFileSync('git', ['-C', scratchRepo, 'branch', '-D', 'made-by-a-sweep']);
});

await check('a sweep that throws still reports what it would have written, exits 1, and shows one line of the error', () => {
  const r = cli([`${FIXTURE_REL}#boom`, '--ws', 'lm']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /WOULD close lm-1 --reason "about to fail"/);
  assert.match(r.stdout, /THREW: kaboom/);
  assert.ok(!r.stdout.includes('second line stays off'));
});

await check('a leading parameter with nothing to fill it is a plain error naming the flag', () => {
  const r = cli([`${FIXTURE_REL}#sweep`]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /takes ws as a leading parameter/);
  assert.match(r.stderr, /--ws or --repo/);
});

await check('bad usage is refused before anything runs', () => {
  assert.match(cli(['lib/relay.js']).stderr, /missing "#"/);
  assert.match(cli(['/etc/hosts#x']).stderr, /outside the worktree/);
  assert.match(cli(['test/nope.mjs#x']).stderr, /no such module/);
  assert.match(cli([`${FIXTURE_REL}#nope`]).stderr, /no exported function "nope"/);
  assert.match(cli([`${FIXTURE_REL}#sweep`, '--ws', 'zz']).stderr, /no workspace named "zz"[\s\S]*lm/);
  assert.match(cli([`${FIXTURE_REL}#sweep`, '--args', 'nope']).stderr, /not valid JSON/);
  assert.match(cli([`${FIXTURE_REL}#sweep`, '--args', '{}']).stderr, /must be a JSON array/);
  assert.match(cli([`${FIXTURE_REL}#sweep`, '--bogus']).stderr, /unrecognised argument/);
});

/* =========================================== 5. acceptance, against a real bd workspace */

const bdOnPath = !spawnSync('bd', ['version'], { encoding: 'utf8' }).error;
if (!bdOnPath) {
  console.log('  --   skipped: no `bd` on PATH, so "a real tracker is byte-identical afterwards" cannot be asked here');
} else {
  const real = path.join(tmp, 'real');
  fs.mkdirSync(real);
  const init = provisionBdWorkspace({ prefix: 'dr', destRoot: real });
  await check('a real bd workspace can be made to ask in', () => assert.ok(init.ok, init.reason));
  if (init.ok) {
    const dir = path.join(real, '.beads');
    const bdRun = (args) => spawnSync('bd', args, { env: { ...process.env, BEADS_DIR: dir }, cwd: real, encoding: 'utf8', timeout: 120_000 });
    const snapshot = () => {
      const exp = bdRun(['export']);
      assert.equal(exp.status, 0, exp.stderr);
      return exp.stdout;
    };
    const seed = new Bd({ bin: 'bd', actor: 'beadcause' });
    const rws = { name: 'scratch', dir };
    for (const t of ['first', 'second']) await seed.create(rws, { title: `${t} bead`, body: 'x', priority: 2, type: 'task', labels: [] });
    const before = snapshot();
    const rowsBefore = before.trim().split('\n').filter(Boolean).length;

    fs.writeFileSync(path.join(CFG_DIR, 'config.json'), JSON.stringify({ bdBin: 'bd', actor: 'beadcause-test', workspaces: [rws] }, null, 2));
    const r = cli([`${FIXTURE_REL}#sweep`, '--ws', 'scratch']);
    await check('the sweep against a real tracker reports its writes and exits 0', () => {
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /WOULD close dr-\w+ --reason Lapsed/);
      assert.match(r.stdout, /WOULD create --title follow-up/);
    });
    await check('and the tracker is byte-identical afterwards — the same `bd export`, no new bead', () => {
      const after = snapshot();
      assert.equal(after, before, 'bd export changed across a dry run');
      assert.equal(after.trim().split('\n').filter(Boolean).length, rowsBefore);
      const listed = bdRun(['list', '--all', '--json', '--limit', '0']);
      assert.ok(!/follow-up/.test(listed.stdout), 'the follow-up bead was really filed');
    });
  }
}

fs.rmSync(FIXTURE, { force: true });
fs.rmSync(OUTSIDE, { force: true });
removeTreeSync(tmp);

console.log(failures ? `\n${failures}/${ran} failed\n` : `\n${ran}/${ran} passed\n`);
process.exit(failures ? 1 : 0);
