#!/usr/bin/env node
/**
 * Conflict hotspots — bc-8nyxa.
 *
 *     npm test
 *     node test/hotspots.mjs
 *
 * Everything here runs against a real git repo built in a temp dir, with real conflicting
 * merges committed into its history, because the whole design rests on one claim: that
 * replaying a merge's two parents through `git merge-tree` names the paths that were
 * conflicted when somebody resolved it. A stub of git would prove nothing about that.
 *
 * What is pinned:
 *
 * 1. **The ledger reads history.** A resolved merge is found and its conflicted paths and
 *    marker lines recorded; a clean merge is not; a rescan adds nothing.
 * 2. **The threshold.** A file is a hotspot at `min` conflicted merges, not before.
 * 3. **The shapes** — every branch of `classify`, including the one a real changelog hit
 *    (a long line must not make a log a blob).
 * 4. **Filing.** One bead per hotspot, with the key label; never a second while one is
 *    open; after a close, only once it has conflicted `min` more times since — and then
 *    naming the bead that did not hold.
 * 5. **The wiring.** `sweepMerged` runs the step only when it is injected, even with pull
 *    requests off, and the daemon injects it.
 * 6. **`b7e-hotspots` runs** and reports.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LIB = (f) => path.join(ROOT, 'lib', f);

let failures = 0;
let ran = 0;
const check = (name, cond, detail = '') => {
  ran += 1;
  if (cond) return console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-hotspots-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const h = await import(LIB('hotspots.js'));
const { requestSweep, sweepMerged } = await import(LIB('mergesweep.js'));

/* ------------------------------------------------------------ a repo with history */

const repo = path.join(tmp, 'widgets');
fs.mkdirSync(repo);
const git = (...args) =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim();
const write = (f, s) => {
  fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
  fs.writeFileSync(path.join(repo, f), s);
};

git('init', '-q', '-b', 'main');
git('config', 'commit.gpgsign', 'false');
write('CHANGELOG.md', '# Changes\n\n- start\n');
write('src/other.js', 'export const a = 1;\n');
git('add', '-A');
git('commit', '-qm', 'base');

/**
 * One feature branch and one main commit that both append to CHANGELOG.md, then the
 * downmerge of main into the branch resolved by keeping both, then the branch merged back.
 * That is the exact shape that costs a resolution: two branches, one end of one file.
 */
function conflictRound(n) {
  git('checkout', '-qb', `feat-${n}`);
  fs.appendFileSync(path.join(repo, 'CHANGELOG.md'), `- feature ${n}\n`);
  git('commit', '-qam', `feat ${n}`);
  git('checkout', '-q', 'main');
  fs.appendFileSync(path.join(repo, 'CHANGELOG.md'), `- hotfix ${n}\n`);
  git('commit', '-qam', `hotfix ${n}`);
  git('checkout', '-q', `feat-${n}`);
  spawnSync('git', ['merge', '-q', '--no-edit', 'main'], { cwd: repo });
  const merged = fs
    .readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8')
    .split('\n')
    .filter((l) => !/^(<{7}|={7}|>{7})/.test(l))
    .join('\n');
  write('CHANGELOG.md', merged);
  git('commit', '-qam', `resolve ${n}`);
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '--no-edit', `feat-${n}`);
}

/** A merge that does not conflict: the branch touches a different file. */
function cleanRound(n) {
  git('checkout', '-qb', `clean-${n}`);
  write('src/other.js', `export const a = ${n + 100};\n`);
  git('commit', '-qam', `clean ${n}`);
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '--no-edit', `clean-${n}`);
}

conflictRound(1);
cleanRound(1);
conflictRound(2);

const ledger = path.join(tmp, 'ledger.json');

/* ------------------------------------------------------------------ 1. the ledger */

console.log('the ledger reads conflicts out of history');

let scan = await h.scanRepo(repo, { ledgerPath: ledger });
check('the repo is named by its directory when there is no origin', scan.repo === 'widgets', scan.repo);
check('two resolved downmerges are two events', scan.events.length === 2, JSON.stringify(scan.events.map((e) => e.files)));
check('each names CHANGELOG.md', scan.events.every((e) => e.files.join() === 'CHANGELOG.md'));
check('and where in it the markers were', scan.events.every((e) => (e.regions['CHANGELOG.md'] || []).length > 0), JSON.stringify(scan.events.map((e) => e.regions)));
check('the clean merge and the merge-backs are not events', scan.added === 2);
const rescan = await h.scanRepo(repo, { ledgerPath: ledger });
check('a rescan with nothing new adds nothing', rescan.added === 0 && rescan.events.length === 2);
check('the ledger remembers the tip it read', h.readLedger(ledger).repos.widgets.seen === git('rev-parse', 'main'));

conflictRound(3);
scan = await h.scanRepo(repo, { ledgerPath: ledger });
check('a new conflicted merge is picked up incrementally', scan.added === 1 && scan.events.length === 3);

const old = h.readLedger(ledger);
old.repos.widgets.events[0].at = new Date(Date.now() - (h.WINDOW_DAYS + 1) * 86400000).toISOString();
fs.writeFileSync(ledger, JSON.stringify(old));
scan = await h.scanRepo(repo, { ledgerPath: ledger });
check('events older than the window are pruned', scan.events.length === 2, String(scan.events.length));

check('markerLines finds only real markers', h.markerLines('a\n<<<<<<< ours\nb\n=======\nc\n>>>>>>> x\n<<<<<<<<< nope').join() === '2');

/* -------------------------------------------------------------- 2. the threshold */

console.log('\na file is a hotspot at the threshold, not before');

const ev = (sha, files, at = new Date().toISOString()) => ({ sha, at, files, regions: {} });
const evs = [ev('a', ['x', 'y']), ev('b', ['x']), ev('c', ['x', 'y']), ev('d', ['x'])];
let spots = h.hotspotsOf(evs, { min: 4 });
check('x conflicted four times and is one', spots.length === 1 && spots[0].file === 'x' && spots[0].count === 4, JSON.stringify(spots));
check('y conflicted twice and is not', !spots.some((s) => s.file === 'y'));
spots = h.hotspotsOf(evs, { min: 2 });
check('worst first', spots.map((s) => s.file).join() === 'x,y');
check('`since` counts only what came after it', h.hotspotsOf(evs, { min: 1, since: Date.now() + 1000 }).length === 0);

console.log('\na stale branch meeting a file main already rewrote is not a conflict hotspot (bc-xl7n.214)');

check('isRewriteCollision: 40x apart is a rewrite', h.isRewriteCollision(120000, 3000) === true);
check('isRewriteCollision: similar sizes are not', h.isRewriteCollision(6000, 5000) === false);
check('isRewriteCollision: a tiny file is not, whatever the ratio', h.isRewriteCollision(900, 50) === false);
check('isRewriteCollision: an add or delete is not', h.isRewriteCollision(5000, 0) === false);
const rw = (sha, files, rewrites = []) => ({ sha, at: new Date().toISOString(), files, regions: {}, rewrites });
const stale = [rw('a', ['doc.md'], ['doc.md']), rw('b', ['doc.md'], ['doc.md']), rw('c', ['doc.md'], ['doc.md']), rw('d', ['doc.md'], ['doc.md'])];
check('four rewrite collisions are not a hotspot', h.hotspotsOf(stale, { min: 4 }).length === 0);
check('an event with no `rewrites` (an old ledger) still counts', h.hotspotsOf(evs, { min: 4 }).length === 1);

// Real git: a big file is cut down on main; a branch cut before the cut edits it and is merged.
{
  const big = Array.from({ length: 400 }, (_, i) => `line ${i} of the long pre-split document`).join('\n') + '\n';
  write('docs/big.md', big);
  git('add', '-A');
  git('commit', '-qm', 'big doc');
  git('checkout', '-qb', 'stale-branch');
  write('docs/big.md', big.replace('line 5 ', 'edited 5 '));
  git('commit', '-qam', 'edit big doc on the old shape');
  git('checkout', '-q', 'main');
  write('docs/big.md', '# Moved\n\nSee docs/big/*.md\n');
  git('commit', '-qam', 'split big doc');
  git('checkout', '-q', 'stale-branch');
  spawnSync('git', ['merge', '-q', '--no-edit', 'main'], { cwd: repo });
  write('docs/big.md', '# Moved\n\nSee docs/big/*.md\n');
  git('commit', '-qam', 'resolve: take main');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '--no-edit', 'stale-branch');
  const rledger = path.join(tmp, 'rewrite-ledger.json');
  const rs = await h.scanRepo(repo, { ledgerPath: rledger });
  const hit = rs.events.find((e) => e.files.includes('docs/big.md'));
  check('the stale-branch merge is in the ledger', Boolean(hit), JSON.stringify(rs.events.map((e) => e.files)));
  check('and docs/big.md is marked a rewrite collision', Boolean(hit) && hit.rewrites.includes('docs/big.md'), JSON.stringify(hit));
  check('so it never reaches a hotspot at min 1', !h.hotspotsOf(rs.events, { min: 1 }).some((s) => s.file === 'docs/big.md'));
  check('while a genuine same-size conflict still does', h.hotspotsOf(rs.events, { min: 1 }).some((s) => s.file === 'CHANGELOG.md'));
}

/* -------------------------------------------------------------------- 3. shapes */

console.log('\nthe shape decides the advice');

const long = 'x'.repeat(5000);
check('a one-line JSON blob is a blob', h.classify('web/data.js', `window.X = {${long}};\n`) === 'blob');
check('a changelog is a log', h.classify('CHANGE_LOG.md', '# Log\n- a\n') === 'log');
check('even with one very long line in it', h.classify('CHANGE_LOG.md', `# Log\n${long}\n- a\n`) === 'log');
check('a series log by name is a log', h.classify('novel/SERIES_CHAPTER_LOG.md', '# x\n') === 'log');
check('a README is an index', h.classify('README.md', '# Hi\n') === 'index');
const checker = Array.from({ length: 30 }, (_, i) => `    assert count('s${i}') == ${100 + i}`).join('\n');
check('a check script full of pinned numbers is expectations', h.classify('scripts/check_audit.py', checker) === 'expectations');
check('a long module is a module', h.classify('lib/big.js', 'x;\n'.repeat(900)) === 'module');
check('a big unnamed markdown file is a log', h.classify('notes/thing.md', '- a\n'.repeat(600)) === 'log');
check('anything else is other', h.classify('src/small.js', 'x;\n') === 'other');
check('every shape has advice', Object.values(h.SHAPES).every((s) => s.name && s.why && s.fix.length));

const bead = h.hotspotBead('widgets', { file: 'CHANGELOG.md', count: 5, events: [{ sha: 'abcdef1234567', at: '2026-10-31T00:00:00Z', lines: [7, 12] }] }, 'log');
check('the bead names the file and the count', bead.title.includes('CHANGELOG.md') && bead.title.includes('5 conflicted merges'), bead.title);
check('it carries the shared label and the per-file key', bead.labels.includes(h.HOTSPOT_LABEL) && bead.labels.includes(h.hotspotKey('widgets', 'CHANGELOG.md')));
check('it says where the markers were', bead.description.includes('lines 7, 12'));
check('it gives the pattern for its shape', bead.description.includes('fragments'));
check('the key is stable and per file', h.hotspotKey('r', 'a') === h.hotspotKey('r', 'a') && h.hotspotKey('r', 'a') !== h.hotspotKey('r', 'b'));
check('a refile names the bead that did not hold', h.hotspotBead('r', { file: 'f', count: 4, events: [] }, 'other', { previous: 'zz-9' }).description.includes('zz-9'));

/* ------------------------------------------------------------------- 4. filing */

console.log('\none bead per hotspot, and a second only if the first did not hold');

conflictRound(4);
conflictRound(5); // CHANGELOG.md now has 4 conflicted merges in the window

const ws = { name: 'demo', dir: path.join(tmp, 'demo') };
let tracker = [];
const fakeBd = { listLabelAny: async (_ws, label) => tracker.filter((b) => b.labels.includes(label)) };
const filedCalls = [];
const fakeFile = async (_bd, w, beads, opts) => {
  filedCalls.push({ w, beads, opts });
  const filed = beads.map((b, i) => {
    const id = `demo-${tracker.length + i + 1}`;
    tracker.push({ id, status: 'open', labels: b.labels });
    return { id };
  });
  return { filed, failed: [] };
};

let res = await h.fileHotspots(fakeBd, {}, ws, repo, { ledgerPath: ledger, file: fakeFile });
check('it files one bead for CHANGELOG.md', res.filed.length === 1 && filedCalls.length === 1, JSON.stringify(res));
check('unendorsed unless the space auto-endorses', filedCalls[0].opts.endorsed === false);
check('homed under the hotspot label', filedCalls[0].opts.homeLabel === h.HOTSPOT_LABEL);

res = await h.fileHotspots(fakeBd, {}, ws, repo, { ledgerPath: ledger, file: fakeFile });
check('not again while that bead is open', res.filed.length === 0 && res.skipped.includes('CHANGELOG.md'), JSON.stringify(res));

tracker[0].status = 'closed';
tracker[0].closed_at = new Date().toISOString();
res = await h.fileHotspots(fakeBd, {}, ws, repo, { ledgerPath: ledger, file: fakeFile });
check('not again right after it closed — the restructure gets its chance', res.filed.length === 0, JSON.stringify(res));

tracker[0].closed_at = new Date(Date.now() - 86400000).toISOString();
const rewritten = h.readLedger(ledger);
for (const e of rewritten.repos.widgets.events) e.at = new Date().toISOString();
fs.writeFileSync(ledger, JSON.stringify(rewritten));
res = await h.fileHotspots(fakeBd, {}, ws, repo, { ledgerPath: ledger, file: fakeFile });
check('but again once it has conflicted `min` more times since the close', res.filed.length === 1, JSON.stringify(res));
check('and the new bead names the old one', filedCalls.at(-1).beads[0].description.includes(tracker[0].id));

const broken = await h.fileHotspots(fakeBd, {}, ws, path.join(tmp, 'nope'), { ledgerPath: ledger, file: fakeFile });
check('a directory that is not a repo is an error on the result, not a throw', Boolean(broken.error));
check('describeHotspots is quiet when nothing was filed', h.describeHotspots({ repo: 'r', filed: [], error: '' }) === '');
check('and names what was', h.describeHotspots({ repo: 'r', filed: ['a-1'], error: '' }).includes('a-1'));

/* --------------------------------------------------------------------- 5. wiring */

console.log('\nthe merge sweep runs it, and only when asked to');

const cfg = { workspaces: [ws], sessionDirs: { demo: repo }, pr: { enabled: false } };
requestSweep({ workspace: 'demo', key: 'demo', number: 1, base: 'main' });
let seen = null;
let out = await sweepMerged({}, cfg, {
  hotspots: async (_bd, _cfg, w, dir, opts) => {
    seen = { w: w.name, dir, base: opts.base };
    return { repo: 'widgets', filed: [], skipped: [], error: '' };
  },
});
check('it runs with pull requests turned off', seen?.dir === repo && seen.w === 'demo' && seen.base === 'main', JSON.stringify(seen));
check('and lands on the outcome', out[0]?.status === 'off' && out[0].hotspots?.repo === 'widgets', JSON.stringify(out[0]));

requestSweep({ workspace: 'demo', key: 'demo', number: 2, base: 'main' });
out = await sweepMerged({}, cfg, {});
check('without the injection nothing scans', out[0]?.hotspots === null, JSON.stringify(out[0]));

requestSweep({ workspace: 'demo', key: 'demo', number: 3, base: 'main' });
out = await sweepMerged({}, cfg, { hotspots: async () => { throw new Error('boom'); } });
check('a throwing step is an error on the outcome, not a failed sweep', out[0]?.hotspots?.error === 'boom', JSON.stringify(out[0]));

const server = fs.readFileSync(LIB('server.js'), 'utf8');
check('the daemon injects fileHotspots', /sweepMerged\(app\.bd, cfg, \{ hotspots: fileHotspots \}\)/.test(server));

/* ------------------------------------------------------------------ 6. the command */

console.log('\nb7e-hotspots reports');

const cli = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'b7e-hotspots'), '--dir', repo, '--ledger', path.join(tmp, 'cli.json'), '--min', '2', '--json'], { encoding: 'utf8' });
let parsed = null;
try {
  parsed = JSON.parse(cli.stdout);
} catch {
  /* reported below */
}
check('it exits 0', cli.status === 0, cli.stderr);
check('and names CHANGELOG.md as a log', parsed?.hotspots?.[0]?.file === 'CHANGELOG.md' && parsed.hotspots[0].shape === 'log', cli.stdout.slice(0, 300));
const badArg = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'b7e-hotspots'), '--min', 'zero'], { encoding: 'utf8' });
check('a bad --min is exit 1', badArg.status === 1);

/* ------------------------------------------------------------------------ done */

await cleanupTmp(tmp);
console.log(`\n${failures ? `${failures} of ${ran} failed` : `${ran} passed`}`);
process.exit(failures ? 1 : 0);
