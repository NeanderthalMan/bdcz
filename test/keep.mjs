#!/usr/bin/env node
//
// b7e-keep — put a generated file where a link to it still works tomorrow (bc-2pysw).
// On 2026-09-17 twenty delmar pull requests merged in one sitting and four contact sheets
// put in front of Adam were dead links four minutes later: the merges he had approved
// retired the worktrees holding them. This is the command that stops that.
//
//   npm test
//   node test/keep.mjs
//
// Two kinds of proof. Everything in lib/keep.js that is logic — root resolution, stamping,
// the latest pointer, the history listing, copying, the never-throws contract — runs against
// temp directories and an injected keep root, so it needs no git worktree and no vault. The
// two facts that cannot be faked are then checked against THIS repo: that a command run from
// inside a worktree resolves the MAIN checkout rather than its own tree, and that the root is
// never inside .claude/worktrees/. Those are the whole mechanism; a test that stubbed them
// would be asserting its own stub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ENV_ROOT,
  KEEP_DIR,
  keep,
  keepRoot,
  keeps,
  mainCheckout,
  pointLatest,
  readLatest,
  stamp,
  vaultPublish,
} from '../lib/keep.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-keep');

let failures = 0;
function ok(name) { console.log(`  PASS  ${name}`); }
function bad(name, detail) { failures += 1; console.log(`  FAIL  ${name}: ${detail}`); }
function check(name, fn) {
  try { fn(); ok(name); } catch (exc) { bad(name, exc.message); }
}

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'b7e-keep-')); }
function touch(p, body = 'x') {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

// --- root resolution: the part that cannot be faked ------------------------

check('the main checkout is found from this file', () => {
  const main = mainCheckout(HERE);
  assert.ok(main, 'git-common-dir gave nothing');
  assert.ok(fs.statSync(path.join(main, '.git')).isDirectory(),
    `${main}/.git is not a directory — that is a worktree, not the main checkout`);
});

check('a worktree resolves to the MAIN checkout, not to itself', () => {
  const main = mainCheckout(HERE);
  // This suite may itself be running from a worktree. Either way the answer must be the
  // main checkout — that is the entire mechanism, and the case the bug turns on.
  const fromLib = mainCheckout(path.join(ROOT, 'lib'));
  assert.equal(fromLib, main, `${fromLib} != ${main}`);
  assert.ok(!main.includes(`${path.sep}.claude${path.sep}worktrees`),
    `resolved into a worktree: ${main}`);
});

check('the keep root is under the main checkout and never inside a worktree', () => {
  const saved = process.env[ENV_ROOT];
  delete process.env[ENV_ROOT];
  try {
    const root = keepRoot({ start: HERE });
    assert.equal(root, path.join(mainCheckout(HERE), KEEP_DIR), root);
    assert.ok(!root.includes('worktrees-retired'), root);
  } finally {
    if (saved !== undefined) process.env[ENV_ROOT] = saved;
  }
});

check(`${ENV_ROOT} overrides everything`, () => {
  const d = tmp();
  const saved = process.env[ENV_ROOT];
  process.env[ENV_ROOT] = d;
  try {
    // path.resolve, not realpath: the root is echoed back as given, absolutised. On macOS
    // realpath would rewrite /var to /private/var and the two are the same directory.
    assert.equal(keepRoot({ start: HERE }), path.resolve(d));
  } finally {
    if (saved === undefined) delete process.env[ENV_ROOT]; else process.env[ENV_ROOT] = saved;
  }
});

check('a directory that is not a git checkout is not an error', () => {
  assert.equal(mainCheckout(tmp()), null);
});

// --- keeping ---------------------------------------------------------------

check('a keep copies the files and points latest at them', () => {
  const d = tmp();
  const src = touch(path.join(d, 'wt', 'SEQ_A.contact.png'), 'sheet');
  const root = path.join(d, 'root');
  const got = keep([src], { as: 'SEQ_A', root, vault: false });
  assert.ok(got.ok, JSON.stringify(got.errors));
  assert.equal(got.files.length, 1);
  assert.equal(fs.readFileSync(got.files[0].kept, 'utf8'), 'sheet');
  assert.ok(got.latest, 'no latest pointer');
  assert.equal(path.basename(readLatest('SEQ_A', { root })), path.basename(got.dir));
});

check('a kept file survives its worktree being deleted — the bug itself', () => {
  const d = tmp();
  const src = touch(path.join(d, 'wt', 'sheet.png'), 'bytes');
  const root = path.join(d, 'root');
  const got = keep([src], { as: 'SEQ_B', root, vault: false });
  fs.rmSync(path.join(d, 'wt'), { recursive: true, force: true });
  assert.equal(fs.readFileSync(got.files[0].kept, 'utf8'), 'bytes');
});

check('two keeps of one name do not overwrite each other', () => {
  const d = tmp();
  const root = path.join(d, 'root');
  const t1 = new Date(2026, 8, 17, 14, 15, 0);
  const t2 = new Date(2026, 8, 18, 9, 0, 0);
  const a = keep([touch(path.join(d, 'wt', 'c.png'), 'first')], { as: 'S', root, vault: false, now: t1 });
  const b = keep([touch(path.join(d, 'wt', 'c.png'), 'second')], { as: 'S', root, vault: false, now: t2 });
  assert.notEqual(a.dir, b.dir);
  assert.equal(fs.readFileSync(a.files[0].kept, 'utf8'), 'first', 'the first keep was overwritten');
  assert.equal(fs.readFileSync(b.files[0].kept, 'utf8'), 'second');
  assert.deepEqual(keeps('S', { root }).map((p) => path.basename(p)),
    ['20260917-141500', '20260918-090000']);
  assert.equal(path.basename(readLatest('S', { root })), '20260918-090000');
});

check('latest is repointed, not accumulated', () => {
  const d = tmp();
  const root = path.join(d, 'root');
  for (const h of [10, 11, 12]) {
    keep([touch(path.join(d, 'wt', 'c.png'), `h${h}`)], {
      as: 'T', root, vault: false, now: new Date(2026, 8, 18, h, 0, 0),
    });
  }
  assert.equal(keeps('T', { root }).length, 3, 'latest is being counted as a keep');
  assert.equal(fs.readFileSync(path.join(readLatest('T', { root }), 'c.png'), 'utf8'), 'h12');
});

check('a name defaults to the source directory', () => {
  const d = tmp();
  const src = touch(path.join(d, 'wt', 'MY_SEQ', 'x.png'));
  const got = keep([src], { root: path.join(d, 'root'), vault: false });
  assert.equal(got.name, 'MY_SEQ');
});

check('stamp is sortable and second-resolution', () => {
  assert.equal(stamp(new Date(2026, 8, 17, 14, 15, 6)), '20260917-141506');
  assert.ok(stamp(new Date(2026, 8, 17, 1, 2, 3)) < stamp(new Date(2026, 8, 17, 1, 2, 4)));
});

// --- the never-throws contract ---------------------------------------------

check('a missing file is reported, not thrown', () => {
  const d = tmp();
  const got = keep([path.join(d, 'nope.png')], { as: 'X', root: path.join(d, 'root'), vault: false });
  assert.equal(got.ok, false);
  assert.match(got.errors.join(' '), /no such file/);
});

check('an unwritable root is reported, not thrown', () => {
  const d = tmp();
  const blocker = touch(path.join(d, 'blocked'), 'a file where the directory must go');
  const got = keep([touch(path.join(d, 'wt', 's.png'))], { as: 'X', root: blocker, vault: false });
  assert.equal(got.ok, false);
  assert.ok(got.errors.length, 'nothing reported');
});

check('a repo with no media vault says so rather than failing', () => {
  const d = tmp();
  const got = vaultPublish(touch(path.join(d, 's.png')));
  assert.equal(got.ok, false);
  assert.match(got.skipped || '', /no media vault/);
});

check('one bad file among good ones does not lose the good ones', () => {
  const d = tmp();
  const root = path.join(d, 'root');
  const good = touch(path.join(d, 'wt', 'good.png'), 'g');
  const got = keep([good, path.join(d, 'wt', 'gone.png')], { as: 'M', root, vault: false });
  assert.equal(got.ok, true);
  assert.equal(got.files.length, 1);
  assert.match(got.errors.join(' '), /no such file/);
});

// --- the command as a subprocess -------------------------------------------

function run(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000,
  });
}

check('--help exits 0 and names the sidecar as the part that needs committing', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /COMMIT IT/);
});

check('no arguments is a refusal, exit 2', () => {
  const r = run([]);
  assert.equal(r.status, 2, r.stderr);
});

check('an unknown flag is a refusal, exit 2', () => {
  const r = run(['--nope']);
  assert.equal(r.status, 2, r.stderr);
});

check('--json is parseable and carries every path', () => {
  const d = tmp();
  const src = touch(path.join(d, 'wt', 'c.png'), 'bytes');
  const r = run([src, '--as', 'J', '--no-vault', '--json'], { [ENV_ROOT]: path.join(d, 'root') });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.equal(got.name, 'J');
  assert.ok(fs.existsSync(got.files[0].kept), got.files[0].kept);
});

check('--where prints the root, and --where <name> the newest keep', () => {
  const d = tmp();
  const root = path.join(d, 'root');
  const src = touch(path.join(d, 'wt', 'c.png'));
  run([src, '--as', 'W', '--no-vault'], { [ENV_ROOT]: root });
  const bare = run(['--where'], { [ENV_ROOT]: root });
  assert.equal(bare.stdout.trim(), path.resolve(root));
  const named = run(['--where', 'W'], { [ENV_ROOT]: root });
  assert.equal(named.status, 0, named.stderr);
  assert.ok(fs.existsSync(named.stdout.trim()), named.stdout);
});

check('--where on an unknown name exits 1', () => {
  const d = tmp();
  assert.equal(run(['--where', 'nothing-here'], { [ENV_ROOT]: path.join(d, 'root') }).status, 1);
});

check('--list prints the history and exits 1 when there is none', () => {
  const d = tmp();
  const root = path.join(d, 'root');
  const empty = run(['--list', 'none'], { [ENV_ROOT]: root });
  assert.equal(empty.status, 1);
  run([touch(path.join(d, 'wt', 'c.png')), '--as', 'L', '--no-vault'], { [ENV_ROOT]: root });
  const one = run(['--list', 'L'], { [ENV_ROOT]: root });
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stdout.trim().split('\n').length, 1);
});

check('a missing file exits 1, not 0', () => {
  const d = tmp();
  const r = run([path.join(d, 'nope.png'), '--as', 'E', '--no-vault'],
    { [ENV_ROOT]: path.join(d, 'root') });
  assert.equal(r.status, 1, r.stdout);
});

console.log();
if (failures) {
  console.log(`${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('b7e-keep: a kept file outlives the worktree that made it');
