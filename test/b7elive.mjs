#!/usr/bin/env node
/**
 * `b7e-live` — which commit the running daemon was deployed from, and is a sha live yet?
 * lib/live.js and bin/b7e-live.
 *
 *     npm test
 *     node test/b7elive.mjs
 *
 * bc-dgx7.164's own acceptance is replayed here against a real throwaway git repo (with a
 * bare origin) and a hand-written deploy journal under an isolated BEADCAUSE_CONFIG_DIR —
 * the same fixture shape as test/b7etaken.mjs, and for the same reason: every answer is a
 * git fact about real commits, and a fake git could only agree with itself.
 *
 * The commits, oldest first:
 *
 *     A   deployed long ago, still an ancestor of everything
 *     B   what the daemon is on (the `to` of the newest deploy that reached it)
 *     C   merged to origin/main after that deploy — "merged, not deployed"
 *     D   merged to origin/main after that, too
 *     X   on a side branch only — "not on origin/main"
 *
 * What is pinned, and why each one is a shape somebody has already got wrong by hand:
 *
 *  1. **The acceptance shape** — deployed B, two commits behind, C "merged, not deployed", B and
 *     A "live", X on neither, a made-up sha "unknown", and `checks` reads "none declared".
 *  2. **A `failed` deploy newer than the good one is not what is running.** It has a `to`
 *     (the fast-forward already happened) and reading it would call code live that never
 *     restarted. It is listed under "since", and the deployed commit stays B.
 *  3. **`unconfirmed` counts**, and says why it is labelled — the ordinary end of a restart.
 *  4. **No record names a commit** — a bare answer with no `--sha`, and exit 5 with one.
 *  5. **Exit codes**: 0 all live, 3 one is not, 2 usage, 4 no repo key.
 *  6. **A swap since the deploy, with the checkout somewhere else**, carries a caveat naming both.
 *  7. **Nothing is fetched**: the command runs with the origin gone and still answers.
 *  8. **`--json`** parses and carries the same verdicts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';
import { deployedRecord, newerThan } from '../lib/live.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-live');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7elive-'));
process.on('exit', () => removeTreeSync(tmp));

let n = 0;
const check = (name, fn) => {
  fn();
  n += 1;
  console.log(`ok ${n} - ${name}`);
};

/* -------------------------------------------------------------------- the repo */

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV }).trim();

const origin = path.join(tmp, 'origin.git');
const REPO = path.join(tmp, 'repo');
git(tmp, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
git(tmp, 'clone', '--quiet', origin, REPO);

function commit(msg) {
  fs.writeFileSync(path.join(REPO, 'f.txt'), `${msg}\n`);
  git(REPO, 'add', '-A');
  git(REPO, 'commit', '--quiet', '-m', msg);
  return git(REPO, 'rev-parse', 'HEAD');
}
const A = commit('A');
const B = commit('B');
git(REPO, 'push', '--quiet', '-u', 'origin', 'main');
git(REPO, 'checkout', '--quiet', '-b', 'side');
const X = commit('X');
git(REPO, 'checkout', '--quiet', 'main');
const C = commit('C');
const D = commit('D');
git(REPO, 'push', '--quiet', 'origin', 'main');
git(REPO, 'reset', '--quiet', '--hard', B); // the checkout sits where the deploy left it
const NOPE = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

/* ---------------------------------------------------------------- the journal */

const CONFIG = path.join(tmp, 'config');
fs.mkdirSync(path.join(CONFIG, 'deploys'), { recursive: true });
const writeConfig = (deploys) =>
  fs.writeFileSync(path.join(CONFIG, 'config.json'), JSON.stringify({ workspaces: [], workspaceRoots: [], deploys }));
writeConfig({ demo: { command: ['true'], restarts: true } });

let seq = 0;
function record(over) {
  seq += 1;
  const id = `d-fixture${seq}`;
  const rec = {
    id,
    key: 'demo',
    workspace: 'demo',
    repo: null,
    dir: REPO,
    base: 'main',
    status: 'ok',
    requestedAt: `2026-09-19T20:0${seq}:00.000Z`,
    startedAt: `2026-09-19T20:0${seq}:01.000Z`,
    finishedAt: `2026-09-19T20:0${seq}:09.000Z`,
    from: A,
    to: B,
    ...over,
  };
  fs.writeFileSync(path.join(CONFIG, 'deploys', `${id}.json`), JSON.stringify(rec));
  return rec;
}
const clearJournal = () => {
  for (const f of fs.readdirSync(path.join(CONFIG, 'deploys'))) fs.rmSync(path.join(CONFIG, 'deploys', f));
  fs.rmSync(path.join(CONFIG, 'restart.json'), { force: true });
  seq = 0;
};

function live(args = [], { cwd = REPO } = {}) {
  const r = spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, BEADCAUSE_CONFIG_DIR: CONFIG } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/* ----------------------------------------------------------------- the readers */

check('deployedRecord picks the newest record that reached the daemon and names a commit', () => {
  const recs = [
    { id: 'f', status: 'failed', to: D },
    { id: 'l', status: 'lost', to: D },
    { id: 'u', status: 'unconfirmed', to: C },
    { id: 'o', status: 'ok', to: B },
  ];
  assert.equal(deployedRecord(recs).id, 'u');
  assert.deepEqual(newerThan(recs, deployedRecord(recs)).map((r) => r.id), ['f', 'l']);
  assert.equal(deployedRecord([{ id: 'x', status: 'ok' }]), null, 'an ok record with no `to` names nothing');
  assert.equal(deployedRecord([{ id: 'f', status: 'failed', to: D }]), null, 'failed never reaches the daemon');
});

/* ------------------------------------------------------ 1. the acceptance shape */

clearJournal();
record({ to: A });
const good = record({ to: B });
fs.writeFileSync(path.join(CONFIG, 'restart.json'), JSON.stringify({ at: '2026-09-19T20:09:30.000Z', pid: 4242, build: 'abc123', reason: 'first start' }));

const first = live(['--sha', C, B, A, X, NOPE]);
check('exits 3: something asked about is not live', () => assert.equal(first.code, 3, first.err));
check('names the deploy the daemon came from', () => {
  assert.match(first.out, new RegExp(`deployed\\s+${B.slice(0, 9)}\\s+\\(${good.id}, ok, from ${A.slice(0, 9)}\\)`));
  assert.match(first.out, new RegExp(`last deploy\\s+${good.id}\\s+ok\\s+requested 2026-09-19T20:02:00`));
});
check('says when the daemon last restarted', () => assert.match(first.out, /restarted\s+2026-09-19T20:09:30\.000Z\s+\(first start, build abc123\)/));
check('counts the commits behind origin/main', () => assert.match(first.out, /behind\s+2 commits behind origin\/main/));
check('an empty deploy `checks` reads as none declared', () => assert.match(first.out, /checks\s+none declared/));
check('a commit inside the deploy is live', () => {
  assert.match(first.out, new RegExp(`^${B}\\s+live$`, 'm'));
  assert.match(first.out, new RegExp(`^${A}\\s+live$`, 'm'));
});
check('a commit on main and not in the deploy is "merged, not deployed"', () =>
  assert.match(first.out, new RegExp(`^${C}\\s+merged, not deployed$`, 'm')));
check('a commit on a side branch is on neither', () => assert.match(first.out, new RegExp(`^${X}\\s+not on origin/main$`, 'm')));
check('a commit the checkout has never heard of is unknown, not "not merged"', () =>
  assert.match(first.out, new RegExp(`^${NOPE}\\s+unknown`, 'm')));
check('a short sha resolves', () => {
  const r = live(['--sha', C.slice(0, 7)]);
  assert.match(r.out, /merged, not deployed/);
  assert.equal(r.code, 3);
});

check('exits 0 when everything asked about is live', () => {
  const r = live(['--sha', A, B]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(live([]).code, 0, 'no --sha, nothing to fail');
});
check('--sha=<x> and repeated --sha both work', () => {
  const r = live([`--sha=${A}`, '--sha', B]);
  assert.equal(r.code, 0);
  assert.match(r.out, new RegExp(`^${A}\\s+live$`, 'm'));
});

check('--json carries the same verdicts', () => {
  const r = live(['--json', '--sha', C, B]);
  const j = JSON.parse(r.out);
  assert.equal(j.deployed.to, B);
  assert.equal(j.behind, 2);
  assert.equal(j.remote, 'origin/main');
  assert.deepEqual(j.shas.map((s) => s.verdict), ['merged, not deployed', 'live']);
  assert.equal(r.code, 3);
});

/* ---------------------------------------------- 2. a failed deploy is not running */

record({ status: 'failed', to: D, error: 'the deploy command failed (exit 1)' });
const afterFail = live(['--sha', D]);
check('a failed deploy newer than the good one does not move what is deployed', () => {
  assert.match(afterFail.out, new RegExp(`deployed\\s+${B.slice(0, 9)}`));
  assert.match(afterFail.out, new RegExp(`^${D}\\s+merged, not deployed$`, 'm'), 'D was pulled by the failed deploy but never restarted');
  assert.equal(afterFail.code, 3);
});
check('and it is named under "since", with its reason', () => {
  assert.match(afterFail.out, /since\s+d-fixture3\s+failed\s+the deploy command failed \(exit 1\)/);
  assert.match(afterFail.out, /last deploy\s+d-fixture3\s+failed/);
});

/* ------------------------------------------------------- 3. unconfirmed counts */

record({ status: 'unconfirmed', to: C });
const afterUnconfirmed = live(['--sha', C]);
check('an unconfirmed restart deploy counts as reaching the daemon, and says it was never confirmed', () => {
  assert.match(afterUnconfirmed.out, new RegExp(`deployed\\s+${C.slice(0, 9)}`));
  assert.match(afterUnconfirmed.out, /note: that deploy is "unconfirmed"/);
  assert.equal(afterUnconfirmed.code, 0);
  assert.match(afterUnconfirmed.out, /behind\s+1 commit behind/);
});

/* --------------------------------------------- 6. a swap with the checkout elsewhere */

fs.writeFileSync(path.join(CONFIG, 'restart.json'), JSON.stringify({ at: '2026-09-19T21:00:00.000Z', pid: 1, build: 'zzz', reason: 'swap' }));
check('a swap newer than the deploy, with HEAD not on the deployed commit, is caveated', () => {
  const r = live([]);
  assert.match(r.out, new RegExp(`note: the daemon restarted at 2026-09-19T21:00:00.000Z without a deploy record.*checkout is at ${B.slice(0, 9)}, not the deployed ${C.slice(0, 9)}`));
});
check('and no caveat when the checkout sits on the deployed commit', () => {
  git(REPO, 'reset', '--quiet', '--hard', C);
  assert.doesNotMatch(live([]).out, /without a deploy record/);
  git(REPO, 'reset', '--quiet', '--hard', B);
});

/* ---------------------------------------------------- 7. nothing is fetched */

check('runs with the origin gone: it reads local refs and fetches nothing', () => {
  fs.renameSync(origin, `${origin}.away`);
  const r = live(['--sha', C]);
  fs.renameSync(`${origin}.away`, origin);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /behind\s+1 commit behind origin\/main/);
});

/* -------------------------------------------------------- 4. no commit on record */

clearJournal();
record({ status: 'failed', to: D, error: 'boom' });
record({ status: 'lost', to: null });
check('a journal with nothing that reached the daemon says it cannot say', () => {
  const r = live([]);
  assert.equal(r.code, 0);
  assert.match(r.out, /deployed\s+no deploy record that reached the daemon names a commit/);
  assert.match(r.out, /since\s+d-fixture2\s+lost/);
});
check('and exits 5 when a --sha was asked, since it cannot be judged', () => assert.equal(live(['--sha', B]).code, 5));

clearJournal();
check('an empty journal is a state and not an error', () => {
  const r = live([]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /last deploy\s+none on record/);
});

/* ----------------------------------------------------- 5. usage and repo keys */

check('usage errors exit 2', () => {
  assert.equal(live(['--bogus']).code, 2);
  assert.equal(live(['--sha']).code, 2);
  assert.equal(live(['--sha', '--json']).code, 2);
  assert.equal(live(['--sha', '-x']).code, 2);
  assert.equal(live(['--sha=--upload-pack=x']).code, 2);
  assert.equal(live(['--repo']).code, 2);
});
check('--help prints usage and exits 0', () => {
  const r = live(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.out, /usage: b7e-live/);
});
check('an unknown --repo key exits 4 and lists the known ones', () => {
  const r = live(['--repo', 'nonesuch']);
  assert.equal(r.code, 4);
  assert.match(r.err, /no deploy key "nonesuch"/);
  assert.match(r.err, /known keys: demo/);
});
check('two declared keys and no way to tell which is this checkout exits 4', () => {
  writeConfig({ demo: { command: ['true'] }, other: { command: ['true'] } });
  const r = live([]);
  assert.equal(r.code, 4);
  assert.match(r.err, /cannot tell which repo/);
  assert.equal(live(['--repo', 'other']).code, 0, 'naming it fixes it');
  writeConfig({ demo: { command: ['true'], restarts: true } });
});
check('a deploy with `checks` declared reports how many', () => {
  writeConfig({ demo: { command: ['true'], checks: [{ command: ['true'] }, { command: ['true'] }] } });
  assert.match(live([]).out, /checks\s+2 declared/);
});

/* ------------------------------------------- a record naming a checkout that is gone */

check('a deploy whose directory is not on this Mac says nothing can be compared', () => {
  clearJournal();
  record({ dir: path.join(tmp, 'gone') });
  writeConfig({ demo: { command: ['true'] } });
  const r = live(['--sha', B]);
  assert.match(r.out, /note: the deploy's directory .* is not on this Mac/);
  assert.equal(r.code, 5, 'a sha that cannot be judged is not answered "no" either');
});

console.log(`${n}/${n} ok`);
