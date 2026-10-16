#!/usr/bin/env node
/**
 * A candidate — an open pull request made into a worktree that can be served. bc-sj8k.7.
 *
 *     npm test
 *     node test/candidate.mjs
 *
 * The pure half (the id, the verdict, `assess`) is driven directly. The half that touches
 * git runs against a real repository: a bare "origin" carrying `refs/pull/<n>/head` the way
 * GitHub does, and a clone of it as the checkout. GitHub itself is a stub `view` — what is
 * under test is what this does with GitHub's answer, not GitHub.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CANDIDATE_DIR,
  assess,
  candidateId,
  findCandidate,
  listCandidates,
  parseCandidateId,
  prepareCandidate,
  sweepCandidates,
  teardownCandidate,
  vendorCandidate,
  verdictOf,
} from '../lib/candidate.js';

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${String(err?.stack || err).split('\n').slice(0, 4).join('\n       ')}`);
  }
}

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

console.log('the id');

await check('one id, cookie- and filename-safe, carrying the head', () => {
  const id = candidateId({ key: 'beadcause', number: 42, headSha: SHA });
  assert.equal(id, 'beadcause.pr42.aaaaaaaaaaaa');
  assert.match(id, /^[a-z0-9.-]+$/);
  assert.deepEqual(parseCandidateId(id), { key: 'beadcause', number: 42, head: 'aaaaaaaaaaaa' });
});

await check('a multi-repo key folds into the alphabet', () => {
  assert.equal(candidateId({ key: 'Northwind/Api_Svc', number: 3, headSha: SHA }), 'northwind-api-svc.pr3.aaaaaaaaaaaa');
});

await check('refuses what is not a pull request at a full head', () => {
  assert.throws(() => candidateId({ key: 'x', number: 0, headSha: SHA }));
  assert.throws(() => candidateId({ key: 'x', number: 4, headSha: 'abc123' }));
  assert.equal(parseCandidateId('../../etc'), null);
  assert.equal(parseCandidateId('x.pr4.abc'), null);
});

console.log('the verdict is read');

await check('stage from the ladder, gate from the rollup', () => {
  const v = verdictOf({ state: 'OPEN', checks: { state: 'failing', failed: ['test'], total: 4, at: 't' } });
  assert.deepEqual(v, { stage: 'review', gate: 'fail', failed: ['test'], total: 4, at: 't' });
  assert.equal(verdictOf({ state: 'OPEN', checks: { state: 'passing', total: 4 } }).gate, 'pass');
  assert.equal(verdictOf({ state: 'OPEN', checks: { state: 'pending', total: 4 } }).gate, 'pending');
  assert.equal(verdictOf({ state: 'MERGED', pushed: false, checks: {} }).stage, 'merged');
});

await check('a head nothing ran on is none, never pass', () => {
  assert.equal(verdictOf({ state: 'OPEN', checks: { state: 'none', total: 0 } }).gate, 'none');
  assert.equal(verdictOf({ state: 'OPEN' }).gate, 'none');
});

console.log('staleness');

const rec = { id: 'x.pr1.aaaaaaaaaaaa', headSha: SHA, baseSha: 'base1' };
await check('open at the same head is a candidate', () => {
  assert.deepEqual(assess(rec, { state: 'OPEN', headSha: SHA }, { baseTip: 'base1' }), {
    candidate: true,
    retire: null,
    behind: false,
  });
});
await check('merged, closed, gone and a moved head each retire it', () => {
  assert.equal(assess(rec, { state: 'MERGED', headSha: SHA }).retire, 'merged');
  assert.equal(assess(rec, { state: 'CLOSED', headSha: SHA }).retire, 'closed');
  assert.equal(assess(rec, null).retire, 'gone');
  assert.equal(assess(rec, { state: 'OPEN', headSha: SHA2 }).retire, 'superseded');
});
await check('the base moving flags it behind without ending it', () => {
  const a = assess(rec, { state: 'OPEN', headSha: SHA }, { baseTip: 'base2' });
  assert.equal(a.candidate, true);
  assert.equal(a.behind, true);
  assert.equal(assess(rec, { state: 'OPEN', headSha: SHA }).behind, false, 'an unknown base tip is not behind');
});

console.log('against a real repository');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-candidate-'));
const g = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

const origin = path.join(tmp, 'origin.git');
const seed = path.join(tmp, 'seed');
const checkout = path.join(tmp, 'checkout');
g(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
g(tmp, 'clone', '-q', origin, seed);
fs.writeFileSync(path.join(seed, 'app.txt'), 'main\n');
// The real vendor script, not a stand-in: what a candidate runs is its own head's copy, and
// what is under test is that the head it came from can serve its frontend (bc-sj8k.6).
const here = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(path.join(seed, 'scripts'));
fs.copyFileSync(path.join(here, '..', 'scripts', 'vendor.js'), path.join(seed, 'scripts', 'vendor.js'));
fs.writeFileSync(path.join(seed, 'package.json'), '{ "type": "module" }\n');
fs.writeFileSync(path.join(seed, '.gitignore'), 'node_modules\npublic/vendor\n');
g(seed, 'add', '.');
g(seed, 'commit', '-q', '-m', 'main');
g(seed, 'push', '-q', 'origin', 'HEAD:main');
g(seed, 'checkout', '-q', '-b', 'feature');
fs.writeFileSync(path.join(seed, 'app.txt'), 'feature one\n');
g(seed, 'commit', '-q', '-am', 'feature one');
const head1 = g(seed, 'rev-parse', 'HEAD');
g(seed, 'push', '-q', 'origin', 'HEAD:feature', 'HEAD:refs/pull/7/head');
g(tmp, 'clone', '-q', origin, checkout);
// The session that opened the pull request is sitting on its branch — which is why a
// candidate has to be detached.
g(checkout, 'checkout', '-q', 'feature');
// The checkout's dependency tree: a real directory of links to just the five packages the
// seven bundles come from, so one can be taken away without touching the real tree.
const deps = path.join(checkout, 'node_modules');
const realDeps = fs.realpathSync(path.join(here, '..', 'node_modules'));
const PACKAGES = ['marked', 'dompurify', 'mermaid', 'd3', '@xterm'];
fs.mkdirSync(deps);
for (const p of PACKAGES) fs.symlinkSync(path.join(realDeps, p), path.join(deps, p));

const github = { state: 'OPEN', head: head1, checks: { state: 'passing', total: 3, failed: [] }, missing: false, down: false };
const view = async (_dir, number) => {
  if (github.down) throw new Error('error connecting to api.github.com');
  if (github.missing) throw new Error('GraphQL: Could not resolve to a PullRequest with the number of 7.');
  return {
    number: Number(number),
    url: `https://example/pull/${number}`,
    title: 'Feature',
    state: github.state,
    branch: 'feature',
    base: 'main',
    headSha: github.head,
    checks: github.checks,
  };
};
const home = path.join(checkout, CANDIDATE_DIR);

try {
  let first;
  await check('an open pull request becomes a detached worktree at its head, with a record', async () => {
    const out = await prepareCandidate(checkout, { number: 7, key: 'beadcause', view });
    first = out.candidate;
    assert.equal(out.reused, false);
    assert.equal(first.id, candidateId({ key: 'beadcause', number: 7, headSha: head1 }));
    assert.equal(first.dir, path.join(fs.realpathSync(checkout), CANDIDATE_DIR, first.id));
    assert.equal(g(first.dir, 'rev-parse', 'HEAD'), head1);
    assert.equal(fs.readFileSync(path.join(first.dir, 'app.txt'), 'utf8'), 'feature one\n');
    assert.throws(() => g(first.dir, 'symbolic-ref', '-q', 'HEAD'), 'detached, not on the branch');
    assert.equal(first.verdict.gate, 'pass');
    assert.equal(first.verdict.stage, 'review');
    assert.equal(first.baseSha, g(checkout, 'rev-parse', 'origin/main'));
    assert.equal((await findCandidate(checkout, first.id)).number, 7);
  });

  await check('a candidate made minutes ago serves every vendored asset', async () => {
    assert.equal(first.servable, true, first.unservable);
    assert.equal(first.unservable, null);
    assert.equal(first.bundles, '7/7');
    const vendor = path.join(first.dir, 'public', 'vendor');
    assert.equal(fs.lstatSync(vendor).isDirectory(), true, 'a real directory, never a link to one');
    const names = fs.readdirSync(vendor).sort();
    assert.deepEqual(names, ['d3.js', 'marked.js', 'mermaid.js', 'purify.js', 'xterm-addon-fit.js', 'xterm.css', 'xterm.js']);
    for (const n of names) assert.ok(fs.statSync(path.join(vendor, n)).size > 0, `${n} is empty`);
    assert.equal(fs.readlinkSync(path.join(first.dir, 'node_modules')), path.join('..', '..', '..', 'node_modules'));
    assert.equal((await findCandidate(checkout, first.id)).servable, true, 'and the record says so');
  });

  await check('asking again reuses it and keeps when it was prepared', async () => {
    github.checks = { state: 'failing', total: 3, failed: ['test'] };
    const out = await prepareCandidate(checkout, { number: 7, key: 'beadcause', view });
    assert.equal(out.reused, true);
    assert.equal(out.candidate.preparedAt, first.preparedAt);
    assert.equal(out.candidate.verdict.gate, 'fail');
    assert.deepEqual(out.candidate.verdict.failed, ['test']);
  });

  await check('a pull request that is not open is refused', async () => {
    github.state = 'MERGED';
    await assert.rejects(prepareCandidate(checkout, { number: 7, key: 'beadcause', view }), /merged/);
    github.state = 'OPEN';
  });

  let second;
  await check('a push makes a new candidate and retires the old head', async () => {
    fs.writeFileSync(path.join(seed, 'app.txt'), 'feature two\n');
    g(seed, 'commit', '-q', '-am', 'feature two');
    github.head = g(seed, 'rev-parse', 'HEAD');
    g(seed, 'push', '-q', '-f', 'origin', 'HEAD:feature', 'HEAD:refs/pull/7/head');
    second = (await prepareCandidate(checkout, { number: 7, key: 'beadcause', view })).candidate;
    assert.notEqual(second.id, first.id);
    assert.equal(fs.existsSync(first.dir), false);
    assert.deepEqual((await listCandidates(checkout)).map((c) => c.id), [second.id]);
    assert.equal(second.servable, true, second.unservable);
  });

  await check('a bundle that cannot be put in place is recorded unservable, and asking again retries', async () => {
    await teardownCandidate(checkout, second.id);
    fs.rmSync(path.join(deps, 'd3'));
    const bad = (await prepareCandidate(checkout, { number: 7, key: 'beadcause', view })).candidate;
    assert.equal(bad.servable, false);
    assert.match(bad.unservable, /only 6 of its 7 browser bundles/);
    assert.equal((await findCandidate(checkout, bad.id)).servable, false, 'on the record, before anything spawns');
    fs.symlinkSync(path.join(realDeps, 'd3'), path.join(deps, 'd3'));
    const out = await prepareCandidate(checkout, { number: 7, key: 'beadcause', view });
    assert.equal(out.reused, true);
    assert.equal(out.candidate.servable, true, out.candidate.unservable);
    assert.equal(out.candidate.bundles, '7/7');
  });

  await check('a checkout with nothing to lend makes an unservable candidate, not a thrown one', async () => {
    await teardownCandidate(checkout, second.id);
    const aside = path.join(tmp, 'deps-aside');
    fs.renameSync(deps, aside);
    try {
      const bad = (await prepareCandidate(checkout, { number: 7, key: 'beadcause', view })).candidate;
      assert.equal(bad.servable, false);
      assert.match(bad.unservable, /no node_modules to lend it/);
    } finally {
      fs.renameSync(aside, deps);
    }
    const good = (await prepareCandidate(checkout, { number: 7, key: 'beadcause', view })).candidate;
    assert.equal(good.id, second.id);
    assert.equal(good.servable, true, good.unservable);
  });

  await check('a head with no vendor script is unservable', async () => {
    const bare = path.join(tmp, 'bare-tree');
    fs.mkdirSync(bare);
    const v = await vendorCandidate(bare, fs.realpathSync(checkout));
    assert.equal(v.servable, false);
    assert.match(v.unservable, /no scripts\/vendor\.js/);
  });

  await check('the sweep keeps an open one, refreshes its verdict, and flags a moved base', async () => {
    github.checks = { state: 'passing', total: 3, failed: [] };
    g(seed, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(seed, 'other.txt'), 'x\n');
    g(seed, 'add', '.');
    g(seed, 'commit', '-q', '-m', 'main moves');
    g(seed, 'push', '-q', 'origin', 'HEAD:main');
    g(checkout, 'fetch', '-q', 'origin');
    const out = await sweepCandidates(checkout, { view });
    assert.deepEqual(out.retired, []);
    assert.equal(out.kept.length, 1);
    assert.equal(out.kept[0].behind, true);
    assert.equal(out.kept[0].verdict.gate, 'pass');
  });

  await check('an outage is not a merge — the candidate is kept untouched', async () => {
    github.down = true;
    const out = await sweepCandidates(checkout, { view });
    github.down = false;
    assert.equal(out.unknown.length, 1);
    assert.equal(fs.existsSync(second.dir), true);
  });

  await check('an orphaned worktree directory and a record without a worktree are both collected', async () => {
    fs.mkdirSync(path.join(home, 'beadcause.pr9.cccccccccccc'), { recursive: true });
    fs.writeFileSync(
      path.join(home, 'beadcause.pr8.dddddddddddd.json'),
      JSON.stringify({ id: 'beadcause.pr8.dddddddddddd', number: 8, headSha: 'd'.repeat(40) })
    );
    const out = await sweepCandidates(checkout, { view });
    const reasons = Object.fromEntries(out.retired.map((r) => [r.id, r.reason]));
    assert.equal(reasons['beadcause.pr9.cccccccccccc'], 'orphan');
    assert.equal(reasons['beadcause.pr8.dddddddddddd'], 'missing');
    assert.deepEqual(fs.readdirSync(home).sort(), [second.id, `${second.id}.json`].sort());
  });

  await check('a merged pull request stops being a candidate without anyone asking', async () => {
    github.state = 'MERGED';
    const out = await sweepCandidates(checkout, { view });
    assert.deepEqual(out.retired.map((r) => r.reason), ['merged']);
    assert.equal(fs.existsSync(second.dir), false);
    assert.deepEqual(await listCandidates(checkout), []);
    assert.equal(g(checkout, 'worktree', 'list', '--porcelain').includes(CANDIDATE_DIR), false, 'git forgot it too');
    assert.deepEqual(fs.readdirSync(deps).sort(), [...PACKAGES].sort(), 'tearing down the lent link left the lender alone');
    github.state = 'OPEN';
  });

  await check('a pull request GitHub no longer has is gone', async () => {
    const c = (await prepareCandidate(checkout, { number: 7, key: 'beadcause', view })).candidate;
    github.missing = true;
    const out = await sweepCandidates(checkout, { view });
    github.missing = false;
    assert.deepEqual(out.retired.map((r) => r.reason), ['gone']);
    assert.equal(fs.existsSync(c.dir), false);
  });

  await check('teardown is idempotent and refuses a path', async () => {
    await teardownCandidate(checkout, 'beadcause.pr7.eeeeeeeeeeee');
    await assert.rejects(teardownCandidate(checkout, '../../x'), /not a candidate id/);
  });

  await check('a checkout with no candidates sweeps to nothing', async () => {
    fs.rmSync(home, { recursive: true, force: true });
    assert.deepEqual(await sweepCandidates(checkout, { view }), { kept: [], retired: [], unknown: [] });
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${ran - failures}/${ran} passed`);
process.exit(failures ? 1 : 0);
