#!/usr/bin/env node
//
// b7e-asof — when an artefact was produced, and what governing it changed after
// (bc-xl7n.153, from loremia's lm-2uu.23).
//
//   npm test
//   node test/asof.mjs
//
// Real git repos, really committed with pinned GIT_COMMITTER_DATEs, and real mtimes set
// with utimes: the assertions are about what `git log -1 -- <path>` and `stat` actually
// report, and a stub would only prove the comparison can read dates this file wrote.
// Not loremia's own tree, for the reason in the memory note
// a-real-repo-assertion-in-a-test-rots-between-your-run-and-ci — and it already has:
// the bead's second acceptance example (artist-vision.json vs Entry 107) stopped being
// true when that file was committed again on 2026-09-09. The fixture reproduces the
// SHAPE lm-2uu.15 hit instead: a plate committed before its identity doc and before a
// style relock, with an mtime that disagrees with its commit.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

// CHANGE_LOG headings are calendar days; pin the calendar so a CI runner's zone cannot
// move a production moment across midnight. Children inherit it.
process.env.TZ = 'UTC';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-asof');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-asof-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { expandPaths, sidecarDate, parseVaultListing, vaultDate, ledgerEntries, observe, asofReport, localDay } = await import(
  path.join(ROOT, 'lib', 'asof.js')
);

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
    console.error(`       ${(err && err.message ? err.message : String(err)).split('\n').join('\n       ')}`);
  }
}

const cli = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', ...opts });

/* ---------------------------------------------------------------------- repos */

function repo(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@localhost');
  git('config', 'user.name', 'test');
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const commit = (when, msg, ...files) => {
    execFileSync('git', ['add', ...files], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', msg], {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
    });
    return git('rev-parse', 'HEAD');
  };
  const touch = (rel, when) => {
    const t = new Date(when);
    fs.utimesSync(path.join(dir, rel), t, t);
  };
  return { dir, write, commit, touch };
}

const TEMPLATE = `## Entry Format

## Entry [NNN] — [DATE]

**Type:** [TYPE]
`;
const LEDGER = `# Change log

${TEMPLATE}
## Entry 097 — 2026-08-10

**Type:** CANON (identity files)

## Entry 086 — 2026-07-22

**Type:** STYLE RELOCK (watercolour)

## Entry 050 — 2026-06-01

**Type:** WORLD DECISION
`;

// The lm-2uu.15 shape: a plate committed 06-20, its copy on disk touched 06-27, its
// identity doc written 08-10, and the style relocked (Entry 086) on 07-22.
const A = repo('library');
A.write('chars/corvin/base.png', 'png-bytes');
A.write('chars/corvin/poses/brace.png', 'png-bytes-2');
A.write('CHANGE_LOG.md', LEDGER);
A.commit('2026-06-20T11:45:07Z', 'library: cut-out characters', 'chars', 'CHANGE_LOG.md');
A.touch('chars/corvin/base.png', '2026-06-27T11:04:38Z');
A.touch('chars/corvin/poses/brace.png', '2026-06-27T11:04:38Z');
A.write('chars/corvin/identity.txt', 'who corvin is');
const identitySha = A.commit('2026-08-10T09:00:00Z', 'canon: Entry 097 identity', 'chars/corvin/identity.txt');
// An artefact made after everything, for the "current" row.
A.write('out/fresh.png', 'new');
A.commit('2026-09-01T12:00:00Z', 'fresh render', 'out/fresh.png');
A.touch('out/fresh.png', '2026-09-01T12:00:00Z');
// An artefact made on the relock's own day, and never touched since.
A.write('out/sameday.png', 'x');
A.commit('2026-07-22T15:00:00Z', 'same-day render', 'out/sameday.png');
A.touch('out/sameday.png', '2026-07-22T15:00:00Z');
// A governing file git has never seen: dated by its mtime, and said so.
A.write('notes/draft.md', 'untracked rule');
A.touch('notes/draft.md', '2026-08-15T00:00:00Z');

/* --------------------------------------------------------------------- units */

await check('expandPaths: ** globs from the root, not the cwd, and a miss is reported', () => {
  const r = expandPaths(A.dir, ['chars/**/*.png', 'nope/*.png']);
  assert.deepEqual(r.files, ['chars/corvin/base.png', 'chars/corvin/poses/brace.png']);
  assert.deepEqual(r.unmatched, ['nope/*.png']);
});

await check('expandPaths: a directory stands for every file under it', () => {
  const r = expandPaths(A.dir, ['chars/corvin/poses']);
  assert.deepEqual(r.files, ['chars/corvin/poses/brace.png']);
});

await check('ledgerEntries: dated entries only — the two template headings never count', () => {
  const e = ledgerEntries(LEDGER);
  assert.deepEqual(e.map((x) => x.entry), ['097', '086', '050']);
  assert.equal(e[1].day, '2026-07-22');
  assert.equal(e[1].summary, 'STYLE RELOCK (watercolour)');
});

await check('observe: produced-at is the EARLIEST reading, and a day apart is a disagreement', async () => {
  const o = await observe(A.dir, 'chars/corvin/base.png');
  assert.equal(o.source, 'git');
  assert.equal(o.producedAt, '2026-06-20T11:45:07.000Z');
  assert.equal(o.disagree, true);
  assert.deepEqual(o.readings.map((r) => r.source), ['git', 'mtime']);
});

await check('sidecarDate: a sidecar claims the moment directly and beats earlier readings', async () => {
  const B = repo('sidecar');
  B.write('plate.png', 'p');
  B.write('plate.json', JSON.stringify({ generated_at: '2026-06-25T08:00:00Z' }));
  B.commit('2026-06-20T00:00:00Z', 'plate', 'plate.png', 'plate.json');
  assert.deepEqual(sidecarDate(B.dir, 'plate.png'), { date: '2026-06-25T08:00:00.000Z', file: 'plate.json', key: 'generated_at' });
  const o = await observe(B.dir, 'plate.png');
  assert.equal(o.source, 'sidecar');
  assert.equal(o.producedAt, '2026-06-25T08:00:00.000Z');
});

await check('sidecarDate: a JSON artefact is never its own sidecar', () => {
  const C = repo('selfside');
  C.write('artist-vision.json', JSON.stringify({ date: '2020-01-01' }));
  assert.equal(sidecarDate(C.dir, 'artist-vision.json'), null);
});

await check('parseVaultListing + vaultDate: the lm-2uu.12 line, matched by basename', () => {
  const listing = parseVaultListing('  9678246 2026-07-22 23:57:20.000000000 teaser/teaser_03_dolor_v1.png\nnoise\n');
  assert.equal(listing.length, 1);
  assert.equal(listing[0].date, '2026-07-22T23:57:20.000Z');
  assert.equal(vaultDate(listing, 'out/teaser_03_dolor_v1.png')?.name, 'teaser/teaser_03_dolor_v1.png');
  // Two rows sharing a basename, neither a suffix: a guess, so no match.
  const two = parseVaultListing('1 2026-01-01 00:00:00 a/x.png\n1 2026-01-02 00:00:00 b/x.png');
  assert.equal(vaultDate(two, 'c/x.png'), null);
  assert.equal(vaultDate(two, 'root/b/x.png')?.name, 'b/x.png');
});

await check('localDay: the calendar a CHANGE_LOG heading means', () => {
  assert.equal(localDay('2026-07-22T23:59:00Z'), '2026-07-22');
});

/* --------------------------------------------------------------------- report */

await check('report: the lm-2uu.15 finding — the plate predates its identity doc and the relock', async () => {
  const r = await asofReport(A.dir, { artefacts: ['chars/**/*.png'], against: ['chars/*/identity.txt'] });
  assert.equal(r.artefacts.length, 2);
  for (const row of r.artefacts) {
    assert.equal(row.verdict, 'predates');
    assert.equal(row.newer.length, 1);
    assert.equal(row.newer[0].path, 'chars/corvin/identity.txt');
    assert.equal(row.newer[0].sha, identitySha);
    assert.equal(row.newer[0].subject, 'canon: Entry 097 identity');
    assert.deepEqual(row.laterEntries.map((e) => e.entry).sort(), ['086', '097']);
  }
  assert.deepEqual(r.changelog, { file: 'CHANGE_LOG.md', entries: 3 });
});

await check('report: an entry dated the production day is reported as same-day, not dropped', async () => {
  const r = await asofReport(A.dir, { artefacts: ['out/sameday.png'] });
  const row = r.artefacts[0];
  assert.deepEqual(row.sameDayEntries.map((e) => e.entry), ['086']);
  assert.deepEqual(row.laterEntries.map((e) => e.entry), ['097']);
  assert.equal(row.verdict, 'predates');
  const only = await asofReport(A.dir, { artefacts: ['out/sameday.png'], changelog: false });
  assert.equal(only.artefacts[0].verdict, 'current');
});

await check('report: an untracked governing file is dated by its mtime, and says so', async () => {
  const r = await asofReport(A.dir, { artefacts: ['chars/corvin/base.png'], against: ['notes/draft.md'], changelog: false });
  assert.equal(r.artefacts[0].newer[0].source, 'mtime');
  assert.equal(r.artefacts[0].newer[0].sha, null);
});

/* ------------------------------------------------------------------------ CLI */

await check('CLI: the finding in one call, exit 0, naming the doc and Entry 086', () => {
  const run = cli(['--dir', A.dir, 'chars/**/*.png', '--against', 'chars/*/identity.txt']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /entry ledger: CHANGE_LOG\.md \(3 dated entries\)/);
  assert.match(run.stdout, /newer: chars\/corvin\/identity\.txt {2}[0-9a-f]{8} {2}2026-08-10 {2}canon: Entry 097 identity/);
  assert.match(run.stdout, /Entry 086 — 2026-07-22 {2}STYLE RELOCK/);
  assert.match(run.stdout, /sources disagree:/);
  assert.match(run.stdout, /2 artefact\(s\): 2 predate something, 0 same-day only, 0 current/);
});

await check('CLI: an artefact newer than everything exits 0 and prints current', () => {
  const run = cli(['--dir', A.dir, 'out/fresh.png', '--against', 'chars/*/identity.txt', '--check']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /→ CURRENT/);
});

await check('CLI: --check exits 1 when anything predates', () => {
  const run = cli(['--dir', A.dir, 'chars/corvin/base.png', '--check']);
  assert.equal(run.status, 1, run.stderr);
});

await check('CLI: a root with no CHANGE_LOG.md still runs and says no entry ledger was found', () => {
  const D = repo('noledger');
  D.write('a.png', 'a');
  D.commit('2026-06-01T00:00:00Z', 'a', 'a.png');
  const run = cli(['--dir', D.dir, 'a.png']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /entry ledger: none found/);
  assert.match(run.stdout, /→ CURRENT/);
});

await check('CLI: no --dir resolves the git toplevel of the cwd, from a subdirectory', () => {
  const run = cli(['chars/corvin/base.png', '--json'], { cwd: path.join(A.dir, 'chars') });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(fs.realpathSync(JSON.parse(run.stdout).root), fs.realpathSync(A.dir));
});

await check('CLI: --vault adds a fourth reading and it can be the earliest', () => {
  const listing = path.join(tmp, 'listing.txt');
  fs.writeFileSync(listing, '  9 2026-06-19 10:00:00.000000000 base.png\n');
  const run = cli(['--dir', A.dir, 'chars/corvin/base.png', '--vault', listing, '--json', '--no-changelog']);
  assert.equal(run.status, 0, run.stderr);
  const row = JSON.parse(run.stdout).artefacts[0];
  assert.equal(row.source, 'vault');
  assert.deepEqual(row.readings.map((r) => r.source), ['git', 'mtime', 'vault']);
});

await check('CLI: a pattern that matches nothing exits 3 and names it', () => {
  const run = cli(['--dir', A.dir, 'nope/**/*.png']);
  assert.equal(run.status, 3);
  assert.match(run.stderr, /matched nothing: nope\/\*\*\/\*\.png/);
});

await check('CLI: a named --changelog that is missing exits 3', () => {
  const run = cli(['--dir', A.dir, 'out/fresh.png', '--changelog', 'LEDGER.md']);
  assert.equal(run.status, 3);
});

await check('CLI: usage — no artefact is exit 2, --help is exit 0, --dir with -w is refused', () => {
  assert.equal(cli(['--dir', A.dir]).status, 2);
  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: b7e-asof/);
  assert.equal(cli(['--dir', A.dir, '-w', 'x', 'a.png']).status, 2);
});

await check('CLI: never writes to the tree', () => {
  const before = execFileSync('git', ['status', '--porcelain'], { cwd: A.dir, encoding: 'utf8' });
  cli(['--dir', A.dir, 'chars/**/*.png', '--against', 'chars/*/identity.txt', '--json']);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: A.dir, encoding: 'utf8' }), before);
});

/* -------------------------------------------------------------------- report */

await cleanupTmp(tmp);
console.log(`\n${ran - failures}/${ran} b7e-asof checks passed`);
process.exit(failures ? 1 : 0);
