#!/usr/bin/env node
//
// lib/checkoutfresh.js — keeping every configured workspace's main checkout current
// (bc-xl7n.177), so /api/asset and a repo's own CI gates stop resolving a card's
// docs:/images: path against a checkout nobody has pulled in days.
//
//     npm test
//     node test/checkoutfresh.mjs
//
// Real `git init`/`clone`/`commit` throughout, same argument test/reachable.mjs and
// test/b7efresh.mjs make: the whole point is what a real `git fetch` and a real
// `--ff-only merge` actually do against a real remote-tracking ref, not strings this
// file asserted by hand.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const { freshenCheckout, freshenAllCheckouts, hasOwnDeploy, checkoutRefreshEveryMs } = await import(
  path.join(ROOT, 'lib', 'checkoutfresh.js')
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-checkoutfresh-'));

const git = (dir, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();

/** A one-commit repo on `main`, to be cloned as an `origin`. */
function makeOrigin(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

/** A real `git clone` of `origin` — sets up `origin/HEAD` the way a real checkout has it. */
function cloneWork(origin, name) {
  const dir = path.join(tmp, name);
  git(tmp, 'clone', '-q', origin, dir);
  return dir;
}

function commit(dir, file, content, message) {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

const head = (dir) => git(dir, 'rev-parse', 'HEAD');

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${String(err.message).split('\n').join('\n       ')}`);
  }
}

console.log('\nlib/checkoutfresh.js — keeping a workspace\'s main checkout current\n');

await check('freshenCheckout fast-forwards a clean checkout on trunk', () => {
  const origin = makeOrigin('origin-a');
  const work = cloneWork(origin, 'work-a');
  const before = head(work);
  commit(origin, 'a.txt', 'two\n', 'second');
  const after = head(origin);
  assert.notEqual(before, after);

  const result = freshenCheckout(work);
  assert.equal(result.skipped, false);
  assert.equal(result.branch, 'main');
  assert.equal(result.from, before);
  assert.equal(result.to, after);
  assert.equal(result.changed, true);
  assert.equal(head(work), after);
});

await check('freshenCheckout reports changed:false when already current', () => {
  const origin = makeOrigin('origin-b');
  const work = cloneWork(origin, 'work-b');
  const sha = head(work);
  const result = freshenCheckout(work);
  assert.equal(result.skipped, false);
  assert.equal(result.changed, false);
  assert.equal(result.from, sha);
  assert.equal(result.to, sha);
});

await check('freshenCheckout skips a dirty tree and leaves it untouched', () => {
  const origin = makeOrigin('origin-c');
  const work = cloneWork(origin, 'work-c');
  const before = head(work);
  fs.writeFileSync(path.join(work, 'a.txt'), 'uncommitted\n');
  commit(origin, 'a.txt', 'two\n', 'second'); // origin moves; work must not follow

  const result = freshenCheckout(work);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /uncommitted work/);
  assert.equal(head(work), before);
  assert.equal(fs.readFileSync(path.join(work, 'a.txt'), 'utf8'), 'uncommitted\n');
});

await check('freshenCheckout skips a checkout that is not on trunk', () => {
  const origin = makeOrigin('origin-d');
  const work = cloneWork(origin, 'work-d');
  git(work, 'checkout', '-q', '-b', 'worktree-thing');
  const before = head(work);
  commit(origin, 'a.txt', 'two\n', 'second');

  const result = freshenCheckout(work);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /is on `worktree-thing`, not `main`/);
  assert.equal(head(work), before);
});

await check('freshenCheckout skips rather than merges when the branch has diverged', () => {
  const origin = makeOrigin('origin-e');
  const work = cloneWork(origin, 'work-e');
  const localSha = (() => {
    commit(work, 'b.txt', 'local\n', 'local-only');
    return head(work);
  })();
  commit(origin, 'a.txt', 'two\n', 'second'); // origin moves too — ff-only cannot resolve this

  const result = freshenCheckout(work);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /could not fast-forward/);
  assert.equal(head(work), localSha, 'a diverged branch must be left exactly as it was');
});

await check('freshenCheckout skips a directory that is not a git checkout', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'notgit-'));
  const result = freshenCheckout(dir);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /is not a git checkout/);
});

await check('hasOwnDeploy is true only for a workspace with a deploys entry', () => {
  const cfg = { deploys: { beadcause: { command: ['true'] } } };
  assert.equal(hasOwnDeploy(cfg, 'beadcause'), true);
  assert.equal(hasOwnDeploy(cfg, 'delmar'), false);
  assert.equal(hasOwnDeploy({}, 'beadcause'), false);
});

await check('freshenAllCheckouts skips a workspace with its own deploy, untouched', () => {
  const origin = makeOrigin('origin-f');
  const work = cloneWork(origin, 'work-f');
  const before = head(work);
  commit(origin, 'a.txt', 'two\n', 'second');

  const cfg = {
    deploys: { hasdeploy: { command: ['true'] } },
    workspaces: [{ name: 'hasdeploy', dir: path.join(work, '.beads') }],
  };
  const results = freshenAllCheckouts(cfg);
  assert.equal(results.length, 1);
  assert.equal(results[0].workspace, 'hasdeploy');
  assert.equal(results[0].skipped, true);
  assert.match(results[0].reason, /own deploy/);
  assert.equal(head(work), before, 'a workspace with its own deploy must never be touched here');
});

await check('freshenAllCheckouts freshens a workspace with no deploy declared', () => {
  const origin = makeOrigin('origin-g');
  const work = cloneWork(origin, 'work-g');
  commit(origin, 'a.txt', 'two\n', 'second');
  const after = head(origin);

  const cfg = { workspaces: [{ name: 'nodeploy', dir: path.join(work, '.beads') }] };
  const results = freshenAllCheckouts(cfg);
  assert.equal(results.length, 1);
  assert.equal(results[0].workspace, 'nodeploy');
  assert.equal(results[0].skipped, false);
  assert.equal(results[0].changed, true);
  assert.equal(head(work), after);
});

await check('freshenAllCheckouts sweeps two workspaces at the same checkout only once', () => {
  const origin = makeOrigin('origin-h');
  const work = cloneWork(origin, 'work-h');
  commit(origin, 'a.txt', 'two\n', 'second');

  const cfg = {
    workspaces: [
      { name: 'first', dir: path.join(work, '.beads') },
      { name: 'second', dir: path.join(work, '.beads') },
    ],
  };
  const results = freshenAllCheckouts(cfg);
  assert.equal(results.length, 2);
  assert.equal(results[0].skipped, false);
  assert.equal(results[0].changed, true);
  assert.equal(results[1].skipped, true);
  assert.match(results[1].reason, /already swept this tick/);
});

await check('freshenAllCheckouts records, rather than throws on, a workspace it cannot resolve', () => {
  const cfg = {
    sessionDirs: { broken: '/nonexistent/does-not-exist-at-all' },
    workspaces: [{ name: 'broken', dir: path.join(tmp, 'nope', '.beads') }],
  };
  const results = freshenAllCheckouts(cfg);
  assert.equal(results.length, 1);
  assert.equal(results[0].skipped, true);
  assert.match(results[0].reason, /could not resolve a checkout/);
});

await check('checkoutRefreshEveryMs defaults to fifteen minutes and floors at one', () => {
  assert.equal(checkoutRefreshEveryMs({}), 15 * 60 * 1000);
  assert.equal(checkoutRefreshEveryMs({ checkoutRefreshMinutes: 5 }), 5 * 60 * 1000);
  assert.equal(checkoutRefreshEveryMs({ checkoutRefreshMinutes: 0.5 }), 1 * 60 * 1000);
});

console.log(failures ? `\n${failures}/${ran} failed\n` : `\n${ran}/${ran} passed\n`);
await cleanupTmp(tmp);
process.exit(failures ? 1 : 0);
