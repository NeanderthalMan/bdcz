#!/usr/bin/env node
//
// Changesets — the merge advocate numbers changelog fragments and folds them into a log
// every branch prepends to (bc-7vt6r).
//
//   npm test
//   node test/changesets.mjs
//
// Real git: a bare origin, a writer clone standing in for the branches and for GitHub's
// merge button, and a separate clone standing in for the checkout the queue reads. The
// whole claim is about what git does with two branches touching one file, which a stub
// cannot show (test/premerge.mjs gives the same reason).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-changesets-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const cs = await import(path.join(ROOT, 'lib', 'changesets.js'));

/* ------------------------------------------------------------------- harness */

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
    console.error(`       ${(err && err.stack ? err.stack : String(err)).split('\n').join('\n       ')}`);
  }
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gitOk = (cwd, ...args) => {
  try {
    git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
};

/* ---------------------------------------------------------------------- repos */

// The head of delmar's CHANGE_LOG.md, cut down: header, a "Pending Entries" anchor, then
// the newest entry. The anchor regex below is the one delmar's changesets.json would use.
const LOG = [
  '# CHANGE_LOG',
  '',
  '**Purpose:** decisions.',
  '',
  '---',
  '',
  '## Entry Format',
  '',
  '```',
  '## Entry [NNN] — [DATE]',
  '```',
  '',
  '---',
  '',
  '## Pending Entries',
  '',
  '---',
  '',
  '## Entry 271 — 2026-10-31',
  '',
  '**Status:** PENDING PROPAGATION',
  '**Decision:** the rings count down.',
  '',
  '---',
  '',
  '## Entry 268 — 2026-10-30',
  '',
  '**Status:** PENDING PROPAGATION',
  '**Decision:** older.',
  '',
].join('\n');

const CONFIG = {
  fragments: 'changelog.d/*.md',
  target: 'CHANGE_LOG.md',
  heading: '^## Entry (\\d+)',
  anchor: '^## Pending Entries\\n\\n---\\n\\n',
  token: 'N',
  separator: '\n---\n\n',
  pad: 3,
};

const frag = (subject, extra = '') =>
  `## Entry {{N}} — 2026-10-31\n\n**Status:** PENDING PROPAGATION\n**Decision:** ${subject}.${extra ? `\n${extra}` : ''}\n`;

let seq = 0;
/** origin (bare), writer (branches + the merge button), queue (the advocate's checkout). */
function world({ config = CONFIG } = {}) {
  seq += 1;
  const base = path.join(tmp, `w${seq}`);
  const origin = path.join(base, 'origin.git');
  const writer = path.join(base, 'writer');
  const queue = path.join(base, 'queue');
  fs.mkdirSync(base, { recursive: true });
  git(base, 'init', '-q', '--bare', '-b', 'main', origin);
  git(base, 'clone', '-q', origin, writer);
  for (const d of [writer]) {
    git(d, 'config', 'user.email', 'test@localhost');
    git(d, 'config', 'user.name', 'test');
  }
  git(writer, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(writer, 'CHANGE_LOG.md'), LOG);
  fs.writeFileSync(path.join(writer, 'other.txt'), 'a\nb\nc\n');
  if (config) {
    fs.mkdirSync(path.join(writer, '.beadcause'), { recursive: true });
    fs.writeFileSync(path.join(writer, '.beadcause', 'changesets.json'), JSON.stringify(config, null, 2) + '\n');
  }
  git(writer, 'add', '-A');
  git(writer, 'commit', '-qm', 'base');
  git(writer, 'push', '-q', 'origin', 'main');
  git(base, 'clone', '-q', origin, queue);
  return { origin, writer, queue };
}

/** A branch off origin/main carrying `files` ({path: text}), pushed. */
function branch(w, name, files) {
  git(w.writer, 'fetch', '-q', 'origin');
  git(w.writer, 'checkout', '-q', '-B', name, 'origin/main');
  for (const [p, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(w.writer, p)), { recursive: true });
    fs.writeFileSync(path.join(w.writer, p), text);
  }
  git(w.writer, 'add', '-A');
  git(w.writer, 'commit', '-qm', `work on ${name}`);
  git(w.writer, 'push', '-q', '-f', 'origin', name);
  git(w.writer, 'checkout', '-q', 'main');
}

/** GitHub's merge button: a --no-ff merge of origin/<name> into main, or false on conflict. */
function mergeButton(w, name) {
  git(w.writer, 'fetch', '-q', 'origin');
  git(w.writer, 'checkout', '-q', '-B', 'main', 'origin/main');
  if (!gitOk(w.writer, 'merge', '--no-ff', '-q', '-m', `Merge ${name}`, `origin/${name}`)) {
    git(w.writer, 'merge', '--abort');
    return false;
  }
  git(w.writer, 'push', '-q', 'origin', 'main');
  return true;
}

/** The tick's view: fetch, then fold `name` the way lib/mergequeue.js does. */
async function fold(w, name, opts = {}) {
  git(w.queue, 'fetch', '-q', 'origin');
  const head = git(w.queue, 'rev-parse', `origin/${name}`);
  return cs.foldBranch(w.queue, { head, base: 'main', branch: name, ...opts });
}
async function plan(w, name) {
  git(w.queue, 'fetch', '-q', 'origin');
  const head = git(w.queue, 'rev-parse', `origin/${name}`);
  return cs.planFold(w.queue, { head, base: 'main' });
}

const mainLog = (w) => {
  git(w.writer, 'fetch', '-q', 'origin');
  return git(w.writer, 'show', 'origin/main:CHANGE_LOG.md');
};
const headings = (text) => [...text.matchAll(/^## Entry (\d+)/gm)].map((m) => m[1]);

/* ----------------------------------------------------------------- pure parts */

await check('parseConfig fills defaults and refuses a config with no anchor or no capture group', () => {
  assert.ok(cs.parseConfig(JSON.stringify(CONFIG)).config);
  assert.match(cs.parseConfig('{}').error, /anchor/);
  assert.match(cs.parseConfig(JSON.stringify({ ...CONFIG, heading: '^## Entry \\d+' })).error, /capture group/);
  assert.match(cs.parseConfig('{nope').error, /not JSON/);
});

await check('isFragment matches the glob, never a README or a nested path', () => {
  const { config } = cs.parseConfig(JSON.stringify(CONFIG));
  assert.equal(cs.isFragment(config, 'changelog.d/dv-x.md'), true);
  assert.equal(cs.isFragment(config, 'changelog.d/README.md'), false);
  assert.equal(cs.isFragment(config, 'changelog.d/sub/dv-x.md'), false);
  assert.equal(cs.isFragment(config, 'CHANGE_LOG.md'), false);
  assert.equal(cs.fragmentBead('changelog.d/dv-k4n.183__2.md'), 'dv-k4n.183');
});

await check('foldText numbers in natural path order and inserts newest-first under the anchor', () => {
  const { config } = cs.parseConfig(JSON.stringify(CONFIG));
  const r = cs.foldText(config, LOG, [
    { path: 'changelog.d/bc-10.md', body: frag('ten') },
    { path: 'changelog.d/bc-9.md', body: frag('nine') },
  ]);
  assert.equal(r.error, undefined);
  assert.deepEqual(headings(r.text), ['273', '272', '271', '268']);
  assert.deepEqual(r.entries.map((e) => [e.path, e.n]), [
    ['changelog.d/bc-9.md', 272],
    ['changelog.d/bc-10.md', 273],
  ]);
  assert.match(r.text, /## Entry 273 — 2026-10-31\n\n\*\*Status:\*\* PENDING PROPAGATION\n\*\*Decision:\*\* ten\.\n\n---\n\n## Entry 272/);
  assert.match(r.text, /\*\*Decision:\*\* nine\.\n\n---\n\n## Entry 271/);
});

/* ------------------------------------------------------------------- the flow */

for (const order of [
  ['a', 'b'],
  ['b', 'a'],
]) {
  await check(`two PRs, each with a fragment, merged ${order.join(' then ')}: consecutive numbers, no conflict`, async () => {
    const w = world();
    branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
    branch(w, 'b', { 'changelog.d/dv-b.md': frag('from b') });
    const [first, second] = order;

    const r1 = await fold(w, first);
    assert.equal(r1.action, 'pushed', JSON.stringify(r1));
    assert.deepEqual(r1.entries.map((e) => e.n), [272]);
    assert.equal(mergeButton(w, first), true, `${first} merged`);

    const r2 = await fold(w, second);
    assert.equal(r2.action, 'pushed', JSON.stringify(r2));
    assert.deepEqual(r2.entries.map((e) => e.n), [273]);
    assert.equal(mergeButton(w, second), true, `${second} merged with no conflict`);

    const log = mainLog(w);
    assert.deepEqual(headings(log), ['273', '272', '271', '268']);
    assert.match(log, new RegExp(`## Entry 273[^]*from ${second}[^]*## Entry 272[^]*from ${first}`));
    assert.equal(git(w.writer, 'ls-tree', '--name-only', 'origin/main', 'changelog.d/'), '', 'every fragment deleted');
  });
}

await check('both folded before either lands: the second refolds rather than conflicting', async () => {
  const w = world();
  branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
  branch(w, 'b', { 'changelog.d/dv-b.md': frag('from b') });
  assert.deepEqual((await fold(w, 'a')).entries.map((e) => e.n), [272]);
  assert.deepEqual((await fold(w, 'b')).entries.map((e) => e.n), [272]);
  assert.equal(mergeButton(w, 'a'), true);
  // b's 272 now collides with main's 272, and GitHub's own downmerge would conflict.
  assert.equal(mergeButton(w, 'b'), false, 'unfolded refold is genuinely needed');
  const p = await plan(w, 'b');
  assert.equal(p.applies, true, JSON.stringify(p));
  assert.match(p.why, /reached Entry 272/);
  const r = await fold(w, 'b');
  assert.equal(r.action, 'pushed', JSON.stringify(r));
  assert.equal(r.refold, true);
  assert.deepEqual(r.entries.map((e) => e.n), [273]);
  assert.equal(mergeButton(w, 'b'), true);
  assert.deepEqual(headings(mainLog(w)), ['273', '272', '271', '268']);
  assert.equal((mainLog(w).match(/from b/g) || []).length, 1, 'b inserted once, not twice');
});

await check('a cross-reference between two pending fragments resolves in the same pass', async () => {
  const w = world();
  branch(w, 'c', {
    'changelog.d/dv-c.md': frag('the ruling', 'Companion to [[Entry {{N:dv-c__2}}]].'),
    'changelog.d/dv-c__2.md': frag('the companion', 'See [[Entry {{N:dv-c}}]].'),
  });
  const r = await fold(w, 'c');
  assert.equal(r.action, 'pushed', JSON.stringify(r));
  assert.deepEqual(r.entries.map((e) => [e.path, e.n]), [
    ['changelog.d/dv-c.md', 272],
    ['changelog.d/dv-c__2.md', 273],
  ]);
  assert.equal(mergeButton(w, 'c'), true);
  const log = mainLog(w);
  assert.match(log, /the ruling\.\nCompanion to \[\[Entry 273\]\]\./);
  assert.match(log, /the companion\.\nSee \[\[Entry 272\]\]\./);
});

await check('a cross-reference to a fragment that already landed reads its number off the base', async () => {
  const w = world();
  branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
  await fold(w, 'a');
  assert.equal(mergeButton(w, 'a'), true);
  branch(w, 'd', { 'changelog.d/dv-d.md': frag('follows a', 'Builds on [[Entry {{N:dv-a}}]].') });
  const r = await fold(w, 'd');
  assert.equal(r.action, 'pushed', JSON.stringify(r));
  assert.equal(mergeButton(w, 'd'), true);
  assert.match(mainLog(w), /follows a\.\nBuilds on \[\[Entry 272\]\]\./);
});

await check('an unresolvable cross-reference holds, and pushes nothing', async () => {
  const w = world();
  branch(w, 'e', { 'changelog.d/dv-e.md': frag('lonely', 'See [[Entry {{N:dv-nowhere}}]].') });
  const before = git(w.queue, 'ls-remote', 'origin', 'refs/heads/e');
  const r = await fold(w, 'e');
  assert.equal(r.action, 'hold');
  assert.match(r.reason, /\{\{N:dv-nowhere\}\}/);
  assert.equal(git(w.queue, 'ls-remote', 'origin', 'refs/heads/e'), before);
});

await check('a fragment with no placeholder holds; so does one that does not open with the heading', async () => {
  const w = world();
  branch(w, 'f', { 'changelog.d/dv-f.md': '## Entry 999 — 2026-10-31\n\nhand-numbered\n' });
  const r = await fold(w, 'f');
  assert.equal(r.action, 'hold');
  assert.match(r.reason, /no \{\{N\}\} placeholder/);
  branch(w, 'g', { 'changelog.d/dv-g.md': 'Some prose about {{N}} first.\n' });
  const g = await fold(w, 'g');
  assert.equal(g.action, 'hold');
  assert.match(g.reason, /must open with the entry heading/);
});

await check('a re-run is a no-op: nothing planned, nothing folded twice', async () => {
  const w = world();
  branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
  assert.equal((await plan(w, 'a')).applies, true);
  assert.equal((await fold(w, 'a')).action, 'pushed');
  const after = git(w.queue, 'ls-remote', 'origin', 'refs/heads/a');
  assert.equal((await plan(w, 'a')).applies, false);
  assert.equal((await fold(w, 'a')).action, 'none');
  assert.equal(git(w.queue, 'ls-remote', 'origin', 'refs/heads/a'), after);
});

await check('a crash between commit and push: the re-run builds the same tree, numbered once', async () => {
  const w = world();
  branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
  const built = await fold(w, 'a', { push: false });
  assert.equal(built.action, 'built');
  const r = await fold(w, 'a');
  assert.equal(r.action, 'pushed');
  assert.equal(git(w.queue, 'rev-parse', `${r.sha}^{tree}`), git(w.queue, 'rev-parse', `${built.sha}^{tree}`));
  git(w.queue, 'fetch', '-q', 'origin');
  assert.deepEqual(headings(git(w.queue, 'show', 'origin/a:CHANGE_LOG.md')), ['272', '271', '268']);
});

await check('the fold is a two-parent merge commit (so the review gate reads it as a downmerge) with a record', async () => {
  const w = world();
  branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
  const r = await fold(w, 'a');
  const parents = git(w.queue, 'rev-list', '--parents', '-n', '1', r.sha).split(' ');
  assert.equal(parents.length, 3);
  const rec = cs.parseRecord(git(w.queue, 'log', '-1', '--format=%B', r.sha));
  assert.equal(rec.top, 271);
  assert.equal(rec.entries[0].path, 'changelog.d/dv-a.md');
  assert.equal(rec.entries[0].n, 272);
});

await check('a Status flip on another branch is a direct edit and merges alongside a fold', async () => {
  const w = world();
  branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
  branch(w, 's', { 'CHANGE_LOG.md': LOG.replace('**Status:** PENDING PROPAGATION\n**Decision:** older.', '**Status:** PROPAGATED\n**Decision:** older.') });
  await fold(w, 'a');
  assert.equal(mergeButton(w, 's'), true);
  assert.equal(mergeButton(w, 'a'), true);
  const log = mainLog(w);
  assert.deepEqual(headings(log), ['272', '271', '268']);
  assert.match(log, /## Entry 268[^]*PROPAGATED/);
});

await check('a bead titled with the placeholder gets the number, on a refold too; others are left alone', async () => {
  const w = world();
  branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
  branch(w, 'b', { 'changelog.d/dv-b.md': frag('from b'), 'changelog.d/dv-plain.md': frag('plain') });
  const titles = { 'dv-a': 'Entry {{N}} — from a', 'dv-b': 'Entry {{N}} — from b', 'dv-plain': 'a worker bead' };
  const titleOf = (id) => titles[id] ?? null;
  const ra = await fold(w, 'a', { titleOf });
  assert.deepEqual(ra.retitles, [{ id: 'dv-a', title: 'Entry 272 — from a' }]);
  const rb = await fold(w, 'b', { titleOf });
  assert.deepEqual(rb.retitles, [{ id: 'dv-b', title: 'Entry 272 — from b' }]);
  assert.equal(mergeButton(w, 'a'), true);
  // The bead now reads "Entry 272 — from b"; the template rides on the record.
  titles['dv-b'] = 'Entry 272 — from b';
  const again = await fold(w, 'b', { titleOf });
  assert.equal(again.refold, true);
  assert.deepEqual(again.retitles, [{ id: 'dv-b', title: 'Entry 273 — from b' }]);
  // Path order: dv-b before dv-plain, so dv-b takes 273 and dv-plain 274.
  assert.deepEqual(again.entries.map((e) => [e.path, e.n]), [
    ['changelog.d/dv-b.md', 273],
    ['changelog.d/dv-plain.md', 274],
  ]);
});

await check('a folded block edited on the branch after the fold holds instead of being guessed at', async () => {
  const w = world();
  branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
  branch(w, 'b', { 'changelog.d/dv-b.md': frag('from b') });
  await fold(w, 'a');
  await fold(w, 'b');
  // A worker fixes a typo in b's folded block by hand.
  git(w.writer, 'fetch', '-q', 'origin');
  git(w.writer, 'checkout', '-q', '-B', 'b', 'origin/b');
  const p = path.join(w.writer, 'CHANGE_LOG.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('from b', 'from B'));
  git(w.writer, 'commit', '-qam', 'typo');
  git(w.writer, 'push', '-q', 'origin', 'b');
  git(w.writer, 'checkout', '-q', 'main');
  assert.equal(mergeButton(w, 'a'), true);
  const r = await fold(w, 'b');
  assert.equal(r.action, 'hold');
  assert.match(r.reason, /changed on the branch after the advocate folded it/);
});

await check('a repo with no changesets.json is untouched, fragment-shaped files and all', async () => {
  const w = world({ config: null });
  branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
  const before = git(w.queue, 'ls-remote', 'origin', 'refs/heads/a');
  assert.equal((await plan(w, 'a')).applies, false);
  assert.equal((await fold(w, 'a')).action, 'none');
  assert.equal(git(w.queue, 'ls-remote', 'origin', 'refs/heads/a'), before);
});

await check("the queue's own checkout is never touched", async () => {
  const w = world();
  branch(w, 'a', { 'changelog.d/dv-a.md': frag('from a') });
  git(w.queue, 'fetch', '-q', 'origin');
  const before = [git(w.queue, 'status', '--porcelain'), git(w.queue, 'rev-parse', 'HEAD'), fs.readFileSync(path.join(w.queue, 'CHANGE_LOG.md'), 'utf8')];
  await fold(w, 'a');
  const after = [git(w.queue, 'status', '--porcelain'), git(w.queue, 'rev-parse', 'HEAD'), fs.readFileSync(path.join(w.queue, 'CHANGE_LOG.md'), 'utf8')];
  assert.deepEqual(after, before);
});

/* -------------------------------------------------------------- in the tick */

// The fold's outcomes routed through sweepMergeQueue, with the fold itself injected: the
// git half is asserted above, and this is about what the queue does with each answer.
const { MERGE_LABEL, MERGE_ASSIGNEE, mergeBeadBody, queueState } = await import(path.join(ROOT, 'lib', 'mergebead.js'));
const { sweepMergeQueue } = await import(path.join(ROOT, 'lib', 'mergequeue.js'));

const SPEC = { workspace: 'demo', bead: 'zz-work', repo: 'acme/log', number: 42, url: 'https://github.com/acme/log/pull/42', branch: 'work-a', base: 'main', method: 'merge' };
const mergeBead = () => ({ id: 'zz-merge', title: 'Merge #42', status: 'open', labels: [MERGE_LABEL], assignee: MERGE_ASSIGNEE, description: mergeBeadBody(SPEC), notes: '' });
const GREEN = { failed: [], failedUrls: [], failing: 0, pending: 0, total: 1, state: 'passing' };

function tick({ plan: planned, fold: folded, mergeable = 'MERGEABLE', mergeState = 'CLEAN', openResolver = null } = {}) {
  const calls = { updates: [], comments: [], created: [], merged: 0, updateBranch: 0, folded: 0 };
  const bd = {
    listAgent: async () => [mergeBead()],
    show: async (ws, id) => (id === 'dv-a' ? { id, title: 'Entry {{N}} — from a' } : null),
    close: async () => {},
    comment: async (ws, id, text) => calls.comments.push({ id, text }),
    update: async (ws, id, patch) => calls.updates.push({ id, ...patch }),
    create: async (ws, spec) => calls.created.push(spec),
    comments: async () => [],
  };
  const prApi = {
    view: async () => ({ state: 'OPEN', mergeable, mergeState, checks: GREEN, reviewDecision: null, mergedAt: null, headSha: 'aaaa1' }),
    baseChecks: async () => ({ failed: [], state: 'passing' }),
    updateBranch: async () => ((calls.updateBranch += 1), { updated: true, reason: '' }),
    merge: async () => ((calls.merged += 1), { mergeCommit: 'abc' }),
    checkFailure: async () => [],
  };
  const changesets = {
    plan: async () => planned,
    fold: async (dir, opts) => {
      calls.folded += 1;
      calls.titleOf = await opts.titleOf('dv-a');
      return folded;
    },
  };
  const resolve = async () => ({ unit: { key: 'demo/log' }, dir: '/tmp/log', reason: '' });
  return sweepMergeQueue(bd, { name: 'demo' }, { resolve, prApi, changesets, openResolver, refresh: async () => true }).then((out) => ({ out, calls }));
}

await check('tick: nothing to fold leaves the ordinary path exactly as it was', async () => {
  const { out, calls } = await tick({ plan: { applies: false } });
  assert.equal(calls.folded, 0);
  assert.equal(calls.merged, 1);
  assert.deepEqual(out.merged.length, 1);
});

await check('tick: a pushed fold is a downmerge — counted, retitled, and nothing merges this tick', async () => {
  const { out, calls } = await tick({
    plan: { applies: true, why: '1 fragment' },
    fold: { action: 'pushed', sha: 'bbbb2', entries: [{ path: 'changelog.d/dv-a.md', n: 272 }], retitles: [{ id: 'dv-a', title: 'Entry 272 — from a' }] },
  });
  assert.equal(calls.merged, 0, 'merged over a head commit nothing ran on');
  assert.equal(calls.updateBranch, 0, 'asked GitHub to downmerge as well');
  assert.deepEqual(out.updated, ['zz-merge']);
  assert.equal(calls.titleOf, 'Entry {{N}} — from a', 'titleOf reads the bead');
  assert.ok(calls.updates.some((u) => u.id === 'dv-a' && u.title === 'Entry 272 — from a'), JSON.stringify(calls.updates));
  const state = queueState({ notes: calls.updates.find((u) => u.id === 'zz-merge').notes });
  assert.equal(state.downmerges, 1);
});

await check('tick: a bad fragment holds the pull request with the reason, like a red check', async () => {
  const { out, calls } = await tick({ plan: { applies: true }, fold: { action: 'hold', reason: 'changelog.d/dv-a.md has no {{N}} placeholder where its number goes' } });
  assert.equal(calls.merged, 0);
  assert.deepEqual(out.refused, ['zz-merge']);
  const state = queueState({ notes: calls.updates.filter((u) => u.id === 'zz-merge').at(-1).notes });
  assert.match(state.refused, /^changesets: .*no \{\{N\}\} placeholder/);
  assert.equal(calls.created.length, 0, 'a bad fragment is the branch, not a bug');
});

await check('tick: a conflict inside the log holds and files a bug, never a resolver', async () => {
  let opened = 0;
  const { out, calls } = await tick({
    plan: { applies: true },
    fold: { action: 'hold', bug: true, reason: 'bringing main in conflicted in CHANGE_LOG.md' },
    mergeable: 'CONFLICTING',
    mergeState: 'DIRTY',
    openResolver: async () => ((opened += 1), true),
  });
  assert.equal(opened, 0);
  assert.deepEqual(out.refused, ['zz-merge']);
  assert.equal(calls.created.length, 1);
  assert.match(calls.created[0].title, /beadcause bug/);
  // Filed once: the flag has to survive the queue block's round trip, which is a whitelist.
  const state = queueState({ notes: calls.updates.filter((u) => u.id === 'zz-merge').at(-1).notes });
  assert.equal(state.changesetBug, true);
});

await check('tick: a conflict elsewhere falls through to the resolver as before', async () => {
  let opened = 0;
  const { out } = await tick({
    plan: { applies: true },
    fold: { action: 'conflicted', conflicts: ['other.txt'] },
    mergeable: 'CONFLICTING',
    mergeState: 'DIRTY',
    openResolver: async () => ((opened += 1), true),
  });
  assert.equal(opened, 1);
  assert.deepEqual(out.raised, ['zz-merge']);
});

await check('tick: a head this checkout cannot read waits rather than merging its fragments as files', async () => {
  const { out, calls } = await tick({ plan: { applies: false, unknown: true } });
  assert.equal(calls.merged, 0);
  assert.deepEqual(out.waiting, ['zz-merge']);
});

/* -------------------------------------------------------------------- report */

cleanupTmp(tmp);
console.log(`\n${ran - failures}/${ran} changesets checks passed`);
process.exit(failures ? 1 : 0);
