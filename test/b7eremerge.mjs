#!/usr/bin/env node
/**
 * `b7e-remerge` — re-queue a stalled merge card. lib/remerge.js and bin/b7e-remerge.
 *
 *     npm test
 *     node test/b7eremerge.mjs
 *
 * bc-dgx7.191: the card is read through the real `mergeBeadBody` serialiser (not a block
 * written by hand here), and `mergeTarget` is judged against the copies `prBranch` reports
 * for a real throwaway repo with a real bare origin and real worktrees. The `bd`/`gh`
 * halves of the command are not exercised; the archived loremia cards are not available
 * to a test, so what is pinned is the rule they showed: work bead + --branch, never the card.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-remerge');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-remerge-')));
process.on('exit', () => removeTreeSync(tmp));

const { cardPlan, deliverCommand, mergeTarget } = await import(path.join(ROOT, 'lib', 'remerge.js'));
const { mergeBeadBody, mergeBeadTitle, MERGE_LABEL } = await import(path.join(ROOT, 'lib', 'mergebead.js'));
const { prBranch } = await import(path.join(ROOT, 'lib', 'prbranch.js'));

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${String(err?.message || err).split('\n').join('\n      ')}`);
  }
};

const delivery = (over = {}) => ({
  workspace: 'loremia',
  repo: 'x/loremia',
  bead: 'lm-5i2.145',
  number: 442,
  url: 'https://github.com/x/loremia/pull/442',
  branch: 'worktree-thing',
  base: 'main',
  method: 'merge',
  title: 'lm-5i2.145: thing',
  ...over,
});
const card = (d, labels = [MERGE_LABEL]) => ({ id: 'lm-5i2.200', title: mergeBeadTitle(d), labels, description: mergeBeadBody(d) });

await check('a card reads into the PR number, branch and the WORK bead', () => {
  const p = cardPlan(card(delivery()));
  assert.deepEqual({ ok: p.ok, number: p.number, branch: p.branch, bead: p.bead }, { ok: true, number: 442, branch: 'worktree-thing', bead: 'lm-5i2.145' });
});

await check('what is not a readable merge card is refused with a reason', () => {
  assert.equal(cardPlan(null).ok, false);
  assert.match(cardPlan({ id: 'x-1', labels: [], description: '' }).reason, /not a merge card/);
  assert.match(cardPlan({ id: 'x-1', labels: [MERGE_LABEL], description: 'no block' }).reason, /no beadpr block/);
});

await check('the delivery names the work bead and --branch, never the card', () => {
  const c = deliverCommand({ root: '/r', workspace: 'loremia', bead: 'lm-5i2.145', branch: 'worktree-thing' });
  assert.ok(c.startsWith('node /r/bin/deliver.js -w loremia -b lm-5i2.145 --branch worktree-thing'), c);
  assert.ok(!c.includes('lm-5i2.200'));
});

await check('a card that names no work bead has no delivery: it needs a tap', () => {
  assert.equal(deliverCommand({ root: '/r', workspace: 'w', bead: null, branch: 'b' }), null);
});

/* ---------------------------------------------------- mergeTarget on a real repo */
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' },
  }).trim();
const origin = path.join(tmp, 'origin.git');
const REPO = path.join(tmp, 'repo');
git(tmp, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
git(tmp, 'clone', '--quiet', origin, REPO);
fs.writeFileSync(path.join(REPO, 'f.txt'), 'one\n');
git(REPO, 'add', 'f.txt');
git(REPO, 'commit', '--quiet', '-m', 'root');
git(REPO, 'push', '--quiet', '-u', 'origin', 'main');
const WT = path.join(REPO, '.claude', 'worktrees', 'w');
git(REPO, 'worktree', 'add', '--quiet', '-b', 'worktree-w', WT, 'main');
fs.writeFileSync(path.join(WT, 'w.txt'), 'w\n');
git(WT, 'add', 'w.txt');
git(WT, 'commit', '--quiet', '-m', 'w');
git(WT, 'push', '--quiet', '-u', 'origin', 'worktree-w');
fs.writeFileSync(path.join(REPO, 'g.txt'), 'g\n');
git(REPO, 'add', 'g.txt');
git(REPO, 'commit', '--quiet', '-m', 'main moves');
git(REPO, 'push', '--quiet', 'origin', 'main');

const r = await prBranch(REPO, { branch: 'worktree-w' });

await check('the trial merge is clean and the clean worktree holding the newest copy is a valid --merge target', () => {
  assert.equal(r.merge.clean, true);
  assert.deepEqual(mergeTarget(r.copies, r.newest, WT, REPO), { ok: true });
});

await check('the main checkout, a stranger, and a dirty worktree are all refused', () => {
  assert.match(mergeTarget(r.copies, r.newest, REPO, REPO).reason, /main checkout/);
  assert.match(mergeTarget(r.copies, r.newest, path.join(tmp, 'nowhere'), REPO).reason, /does not have the PR branch/);
  fs.writeFileSync(path.join(WT, 'w.txt'), 'dirty\n');
  const d = prBranch(REPO, { branch: 'worktree-w', fetch: false });
  return d.then((dr) => {
    assert.match(mergeTarget(dr.copies, dr.newest, WT, REPO).reason, /uncommitted/);
    git(WT, 'checkout', '--quiet', 'w.txt');
  });
});

await check('the command: --help exits 0, no arguments exits 2, --merge without --worktree exits 2, an unknown workspace exits 4', () => {
  assert.equal(spawnSync(process.execPath, [BIN, '--help']).status, 0);
  assert.equal(spawnSync(process.execPath, [BIN]).status, 2);
  assert.equal(spawnSync(process.execPath, [BIN, '-w', 'beadcause', 'x-1', '--merge']).status, 2);
  assert.equal(spawnSync(process.execPath, [BIN, '-w', 'no-such-workspace-xyz', 'x-1']).status, 4);
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
