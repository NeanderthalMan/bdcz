#!/usr/bin/env node
//
// b7e-newest — which ref actually holds the newest version of these paths, and what
// building on it costs (bc-dgx7.83).
//
//   npm test
//   node test/b7enewest.mjs
//
// Real `git init`/`clone`/`worktree add`/`commit` throughout, same argument
// test/b7ebase.mjs and test/siblings.mjs make: the whole point of this tool is what
// `git diff` and `merge-base` report across real worktrees and a real `origin`, and a fake
// listing would only prove the parser can read strings this file wrote. Every CLI run
// passes `--no-prs`, because a suite must not ask GitHub anything; the pull-request half is
// driven through `newestFor`'s `prs` argument instead, with rows shaped as lib/pr.js's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';
import { newestFor, stateOf, costOf } from '../lib/newest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-newest');

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${String(detail).split('\n').join('\n      ')}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

/* ---------------------------------------------------------------- fixtures */

/** git with an identity of its own, so this never depends on the machine's. */
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7enewest-'));
let counter = 0;

function commitFile(dir, file, content, message) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

/**
 * A clone of a one-commit `origin` on `main`, holding `pipeline/lib/a.js`, `pipeline/lib/b.js`,
 * `CHANGE_LOG.md` and `other.txt` — the paths asked about are `pipeline/lib/` and
 * `CHANGE_LOG.md`, and `other.txt` is what must never be dragged in.
 */
function makeRepo() {
  counter += 1;
  const origin = path.join(tmp, `origin${counter}`);
  fs.mkdirSync(origin, { recursive: true });
  git(origin, 'init', '-q', '-b', 'main');
  // A pushed commit updates the (clean) checkout, so `origin` can stay a plain repo that
  // this file also commits to directly.
  git(origin, 'config', 'receive.denyCurrentBranch', 'updateInstead');
  commitFile(origin, 'pipeline/lib/a.js', 'a1\n', 'init a');
  commitFile(origin, 'pipeline/lib/b.js', 'b1\n', 'init b');
  commitFile(origin, 'CHANGE_LOG.md', 'log1\n', 'init log');
  commitFile(origin, 'other.txt', 'o1\n', 'init other');
  const work = path.join(tmp, `work${counter}`);
  git(tmp, 'clone', '-q', origin, work);
  return { origin, work };
}

/**
 * A commit on `work`'s main that is also pushed, so `origin/main` — the base this tool
 * measures against — has it. A commit left unpushed is a different fact, and test 8 makes it
 * on purpose.
 */
function landOnMain(work, file, content, message) {
  commitFile(work, file, content, message);
  git(work, 'push', '-q', 'origin', 'main');
}

/** A new worktree on a new branch cut from `from`. */
function addWorktree(work, name, from = 'main') {
  const dir = path.join(tmp, `${name}-${counter}`);
  git(work, 'worktree', 'add', '-q', '-b', name, dir, from);
  return dir;
}

const PATHS = ['pipeline/lib/', 'CHANGE_LOG.md'];
const run = (cwd, args = []) =>
  spawnSync(process.execPath, [BIN, '--dir', cwd, '--no-fetch', '--no-prs', ...args], { encoding: 'utf8' });
const json = (cwd, args = []) => {
  const r = run(cwd, ['--json', ...args, '--', ...PATHS]);
  try {
    return { ...JSON.parse(r.stdout), status: r.status, stderr: r.stderr };
  } catch {
    return { status: r.status, stderr: r.stderr, raw: r.stdout };
  }
};

/* ============================================================ 0. the states */

console.log('\nstateOf names what each side did, in one word\n');

check('an ancestor the base has since moved past on the paths has landed', stateOf({ isAncestor: true, own: 0, baseOwn: 2, uncommitted: 0 }) === 'landed');
check('an ancestor the base has not moved past is the same, not a row', stateOf({ isAncestor: true, own: 0, baseOwn: 0, uncommitted: 0 }) === 'same');
check('edits on disk outrank landed', stateOf({ isAncestor: true, own: 0, baseOwn: 2, uncommitted: 2 }) === 'uncommitted');
check('own commits, base quiet: ahead', stateOf({ isAncestor: false, own: 2, baseOwn: 0, uncommitted: 0 }) === 'ahead');
check('own commits and the base moved too: diverged', stateOf({ isAncestor: false, own: 2, baseOwn: 1, uncommitted: 0 }) === 'diverged');
check('only the base moved: behind', stateOf({ isAncestor: false, own: 0, baseOwn: 1, uncommitted: 0 }) === 'behind');
check('nothing committed but edits on disk: uncommitted', stateOf({ isAncestor: false, own: 0, baseOwn: 0, uncommitted: 1 }) === 'uncommitted');
check('nothing anywhere: same', stateOf({ isAncestor: false, own: 0, baseOwn: 0, uncommitted: 0 }) === 'same');

/* ======================================================= 1. nothing is ahead */

console.log('\nwith nothing ahead of it, the base holds the newest version\n');

{
  const { work } = makeRepo();
  const wt = addWorktree(work, 'idle');
  commitFile(wt, 'other.txt', 'o2\n', 'touch something else entirely');

  const r = run(work, ['--', ...PATHS]);
  check('exits 0', r.status === 0, `status ${r.status}\n${r.stdout}\n${r.stderr}`);
  check('the verdict names the base', /VERDICT: origin\/main holds the newest committed version/.test(r.stdout), r.stdout);
  check('a branch that never touched the paths is not a row', !/idle/.test(r.stdout.split('VERDICT')[0]), r.stdout);
}

/* ============================================================ 2. one ref ahead */

console.log('\na worktree ahead on the paths is the verdict, with what merging it costs\n');

{
  const { work } = makeRepo();
  const wt = addWorktree(work, 'props-vocab');
  commitFile(wt, 'pipeline/lib/a.js', 'a1\na2\n', 'extend a');
  commitFile(wt, 'other.txt', 'o-branch\n', 'and something the caller did not ask about');
  // main moves on something else after the fork — what taking the branch's tree would drop
  landOnMain(work, 'other2.txt', 'x\n', 'main-only file');

  const r = run(work, ['--', ...PATHS]);
  check('exits 1 — something other than the base is ahead', r.status === 1, `status ${r.status}\n${r.stdout}\n${r.stderr}`);
  check('names the ref in the verdict', /VERDICT: props-vocab \(/.test(r.stdout), r.stdout);
  check('says the merge brings in one file outside the paths', /brings in 1 file outside these paths/.test(r.stdout), r.stdout);
  check('says taking its tree wholesale would drop the base-side file', /wholesale would drop 1 file changed on origin\/main/.test(r.stdout), r.stdout);
  check('lists the outside file by name', /\+ other\.txt/.test(r.stdout), r.stdout);
  check('shows the per-path diffstat', /pipeline\/lib\/  1 file \+1 -0/.test(r.stdout), r.stdout);
  check('names the commit on the paths', /extend a/.test(r.stdout) && !/main-only file/.test(r.stdout.split('VERDICT')[0].split('props-vocab')[1] || ''), r.stdout);
  check('says a worktree is on it', /worktree/.test(r.stdout.split('VERDICT')[0]), r.stdout);

  const j = json(work);
  const row = j.rows?.find((x) => x.name === 'props-vocab');
  check('--json carries the same row', row?.state === 'ahead' && row.outside.join() === 'other.txt' && row.baseSide.join() === 'other2.txt', JSON.stringify(j.rows));
  check('--json verdict kind is ref', j.verdict?.kind === 'ref' && j.verdict.name === 'props-vocab', JSON.stringify(j.verdict));
  check('--json exit code agrees', j.status === 1, String(j.status));
}

/* ==================================================== 3. a stale branch is not newer */

console.log('\na branch that differs only because the base moved past it is not the newest (lm-b5d.28)\n');

{
  const { work } = makeRepo();
  const wt = addWorktree(work, 'stale-cut');
  commitFile(wt, 'other.txt', 'branch\n', 'the branch does something unrelated');
  landOnMain(work, 'pipeline/lib/a.js', 'a1\na-main\n', 'main updates a after the fork');
  landOnMain(work, 'CHANGE_LOG.md', 'log1\nmain-entry\n', 'main adds a log entry after the fork');

  const r = run(work, ['--', ...PATHS]);
  check('exits 0 — the base is the newest', r.status === 0, `status ${r.status}\n${r.stdout}`);
  check('the stale branch is not crowned', /VERDICT: origin\/main holds the newest/.test(r.stdout), r.stdout);
  check('it is counted rather than listed', /not listed \(--all\): 1 behind the base on these paths/.test(r.stdout), r.stdout);

  const all = json(work, ['--all']);
  const row = all.rows?.find((x) => x.name === 'stale-cut');
  check('--all lists it, as behind', row?.state === 'behind', JSON.stringify(all.rows));
}

/* ============================================================== 4. diverged */

console.log('\nwhen both sides changed the paths, neither is called a superset\n');

{
  const { work } = makeRepo();
  const wt = addWorktree(work, 'both-moved');
  commitFile(wt, 'pipeline/lib/a.js', 'a-branch\n', 'branch edits a');
  landOnMain(work, 'pipeline/lib/a.js', 'a-main\n', 'main edits a');

  const r = run(work, ['--', ...PATHS]);
  check('exits 1', r.status === 1, `status ${r.status}\n${r.stdout}`);
  check('says diverged', /both-moved \([0-9a-f]{8}\) diverged/.test(r.stdout), r.stdout);
  check('verdict says neither is a superset', /neither is a superset of the other/.test(r.stdout), r.stdout);
  check('names the file changed on both sides', /! pipeline\/lib\/a\.js/.test(r.stdout) && /1 file changed on both sides will need resolving/.test(r.stdout), r.stdout);
  check('--json calls it contested', json(work).verdict?.kind === 'contested');
}

/* ========================================================= 5. supersession */

console.log('\na branch contained in another is superseded by it, and is not a rival\n');

{
  const { work } = makeRepo();
  const first = addWorktree(work, 'step-one');
  commitFile(first, 'pipeline/lib/a.js', 'a1\nstep-one\n', 'step one');
  const second = addWorktree(work, 'step-two', 'step-one');
  commitFile(second, 'pipeline/lib/b.js', 'b1\nstep-two\n', 'step two');

  const j = json(work);
  check('the later branch is the verdict', j.verdict?.name === 'step-two', JSON.stringify(j.verdict));
  check('the earlier one is not a competing tip', j.verdict?.competing?.length === 0, JSON.stringify(j.verdict));
  check('the verdict is a plain ref, not contested', j.verdict?.kind === 'ref', j.verdict?.kind);
}

console.log('\ntwo unrelated tips are both named, not settled by the clock\n');

{
  const { work } = makeRepo();
  const one = addWorktree(work, 'tip-one');
  commitFile(one, 'pipeline/lib/a.js', 'a-one\n', 'tip one');
  const two = addWorktree(work, 'tip-two');
  commitFile(two, 'pipeline/lib/b.js', 'b-two\n', 'tip two');

  const r = run(work, ['--', ...PATHS]);
  check('exits 1', r.status === 1, r.stdout);
  check('says there is another unrelated tip', /1 other tip on these paths, unrelated to it and not superseded/.test(r.stdout), r.stdout);
  const j = json(work);
  check('--json is contested and names the rival', j.verdict?.kind === 'contested' && j.verdict.competing.length === 1, JSON.stringify(j.verdict));
}

/* ==================================================== 6. a downmerge is not work */

console.log('\na branch that only downmerged main did not change the paths\n');

{
  const { work } = makeRepo();
  const wt = addWorktree(work, 'downmerged');
  commitFile(wt, 'other.txt', 'branch\n', 'branch work outside the paths');
  landOnMain(work, 'pipeline/lib/a.js', 'a-main\n', 'main edits a');
  git(wt, 'merge', '-q', '--no-edit', 'main');

  const j = json(work, ['--all']);
  check('it is not a row, even with --all', !j.rows?.some((x) => x.name === 'downmerged'), JSON.stringify(j.rows));
  check('the base is the newest', j.verdict?.kind === 'base', JSON.stringify(j.verdict));
}

/* ================================================== 7. uncommitted edits */

console.log('\nuncommitted edits on the paths are reported, and never make a verdict\n');

{
  const { work } = makeRepo();
  const wt = addWorktree(work, 'wip');
  fs.writeFileSync(path.join(wt, 'pipeline/lib/a.js'), 'a1\nunsaved-to-history\n');
  fs.writeFileSync(path.join(wt, 'pipeline/lib/new.js'), 'brand new\n');

  const r = run(work, ['--', ...PATHS]);
  check('exits 0 — nothing committed is ahead', r.status === 0, `status ${r.status}\n${r.stdout}`);
  check('names the worktree with its file count', /uncommitted edits on these paths in: wip \(2\)/.test(r.stdout), r.stdout);
  check('lists it as a row', /wip \([0-9a-f]{8}\) uncommitted/.test(r.stdout), r.stdout);
  check('says it is not counted in the verdict', /not counted in the verdict/.test(r.stdout), r.stdout);
  check('--json carries the count', json(work).uncommitted?.[0]?.files === 2, JSON.stringify(json(work).uncommitted));
}

/* ====================================================== 8. local main, pull requests */

console.log('\nlocal main ahead of origin/main is a candidate: unpushed work is still work\n');

{
  const { work } = makeRepo();
  commitFile(work, 'pipeline/lib/a.js', 'a-unpushed\n', 'committed on main and never pushed');
  const r = run(work, ['--', ...PATHS]);
  check('exits 1', r.status === 1, `status ${r.status}\n${r.stdout}\n${r.stderr}`);
  check('names local main as the newest', /VERDICT: main \(/.test(r.stdout), r.stdout);
}

console.log('\nan open pull request head with no worktree is read as origin/<branch>; a worktree wins over it\n');

{
  const { origin, work } = makeRepo();
  git(origin, 'checkout', '-q', '-b', 'pr-only');
  commitFile(origin, 'pipeline/lib/a.js', 'a-pr\n', 'the pull request commit');
  git(origin, 'checkout', '-q', 'main');
  git(work, 'fetch', '-q', 'origin');

  // A branch with a live worktree that is also a PR head: the local, unpushed commit must win.
  const wt = addWorktree(work, 'pr-and-wt');
  commitFile(wt, 'pipeline/lib/b.js', 'b-local\n', 'a local commit nobody pushed');

  const prs = [
    { branch: 'pr-only', number: 7, url: 'https://example.test/7', draft: false, mergeable: 'MERGEABLE' },
    { branch: 'pr-and-wt', number: 8, url: 'https://example.test/8', draft: true, mergeable: 'UNKNOWN' },
  ];
  const res = await newestFor(work, 'origin/main', PATHS, { prs });
  const byName = Object.fromEntries(res.rows.map((r) => [r.name, r]));
  check('the PR-only head is a row read as origin/<branch>', byName['pr-only']?.ref === 'origin/pr-only' && byName['pr-only'].state === 'ahead', JSON.stringify(res.rows.map((r) => [r.name, r.ref, r.state])));
  check('it carries its pull request', byName['pr-only']?.pr?.number === 7 && byName['pr-only'].worktree === null);
  check('the worktree branch is read locally, with its PR folded on', byName['pr-and-wt']?.ref === 'pr-and-wt' && byName['pr-and-wt'].pr?.number === 8 && byName['pr-and-wt'].pr.draft === true, JSON.stringify(byName['pr-and-wt']));
  check('a branch that is both is one row, not two', res.rows.filter((r) => r.name === 'pr-and-wt').length === 1);
}

/* ===================================================== 9. --refs and skipped */

console.log('\n--refs widens the candidates; a ref that does not resolve is said, not fatal\n');

{
  const { work } = makeRepo();
  git(work, 'checkout', '-q', '-b', 'no-worktree');
  commitFile(work, 'CHANGE_LOG.md', 'log1\nlog2\n', 'a branch nobody has a worktree on');
  git(work, 'checkout', '-q', 'main');

  const plain = json(work);
  check('without --refs it is not a candidate', !plain.rows?.some((x) => x.name === 'no-worktree'), JSON.stringify(plain.rows));
  const wide = json(work, ['--refs', 'no-worktree,ghost-ref-nobody-made']);
  check('with --refs it is', wide.rows?.some((x) => x.name === 'no-worktree' && x.state === 'ahead'), JSON.stringify(wide.rows));
  check('the unresolved one is skipped with a reason', wide.skipped?.some((s) => s.ref === 'ghost-ref-nobody-made'), JSON.stringify(wide.skipped));
}

/* ============================================================ 10. fetch */

console.log('\nthe base is fetched before it is measured, unless --no-fetch\n');

{
  const { origin, work } = makeRepo();
  const wt = addWorktree(work, 'behind-a-fetch');
  commitFile(wt, 'pipeline/lib/a.js', 'a-branch\n', 'branch edits a');
  commitFile(origin, 'pipeline/lib/a.js', 'a-origin\n', 'origin edits a, and nobody has fetched');

  const stale = spawnSync(process.execPath, [BIN, '--dir', work, '--no-fetch', '--no-prs', '--', ...PATHS], { encoding: 'utf8' });
  check('--no-fetch reads the stale base: the branch is simply ahead', /behind-a-fetch \([0-9a-f]{8}\) ahead/.test(stale.stdout), stale.stdout);
  const fresh = spawnSync(process.execPath, [BIN, '--dir', work, '--no-prs', '--', ...PATHS], { encoding: 'utf8' });
  check('after the fetch it is diverged', /behind-a-fetch \([0-9a-f]{8}\) diverged/.test(fresh.stdout), fresh.stdout);
}

/* ============================================================ 11. usage */

console.log('\nusage errors exit 2 and say why\n');

{
  const { work } = makeRepo();

  const noPaths = run(work, []);
  check('no path: exits 2', noPaths.status === 2 && /give at least one path/.test(noPaths.stderr), `${noPaths.status}\n${noPaths.stderr}`);

  const badFlag = run(work, ['--frobnicate', '--', 'x']);
  check('an unknown flag: exits 2', badFlag.status === 2 && /unknown flag --frobnicate/.test(badFlag.stderr), `${badFlag.status}\n${badFlag.stderr}`);

  const notRepo = path.join(tmp, 'not-a-repo');
  fs.mkdirSync(notRepo, { recursive: true });
  const nr = run(notRepo, ['--', 'x']);
  check('outside a checkout: exits 2', nr.status === 2 && /not a git checkout/.test(nr.stderr), `${nr.status}\n${nr.stderr}`);

  const ghost = spawnSync(process.execPath, [BIN, '--dir', work, '--no-fetch', '--no-prs', '--base', 'ghost-branch-nobody-made', '--', 'x'], { encoding: 'utf8' });
  check('a base that exists nowhere: exits 2', ghost.status === 2 && /nothing to measure against/.test(ghost.stderr), `${ghost.status}\n${ghost.stderr}`);

  const outside = run(work, ['--', '/etc/hosts']);
  check('an absolute path outside the checkout: exits 2', outside.status === 2 && /outside the checkout/.test(outside.stderr), `${outside.status}\n${outside.stderr}`);

  const inside = run(work, ['--', path.join(work, 'pipeline/lib/a.js')]);
  check('an absolute path inside it is made root-relative', inside.status === 0 && /— pipeline\/lib\/a\.js/.test(inside.stdout), `${inside.status}\n${inside.stdout}`);

  const unknownWs = spawnSync(process.execPath, [BIN, '-w', 'no-such-workspace-anywhere', '--', 'x'], { encoding: 'utf8' });
  check('an unknown workspace: exits 2', unknownWs.status === 2 && /no workspace named/.test(unknownWs.stderr), `${unknownWs.status}\n${unknownWs.stderr}`);
}

/* ========================================================== 12. --help and -- */

console.log('\n--help says how to call it, but only before a literal --\n');

{
  const help = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  check('exits 0 and prints usage', help.status === 0 && /b7e-newest/.test(help.stdout) && /usage:/.test(help.stdout), `${help.status}\n${help.stdout}`);

  const { work } = makeRepo();
  const after = run(work, ['--', '--help']);
  check('a --help after -- is a path, not a request for usage', !/usage:/.test(after.stdout) && /VERDICT/.test(after.stdout), `${after.status}\n${after.stdout}\n${after.stderr}`);
}

/* ============================================================ 13. json is whole */

console.log('\n--json is one object, untruncated, on an unpiped stdout\n');

{
  const { work } = makeRepo();
  // Enough rows that the object is far larger than a pipe buffer (64KB).
  for (let i = 0; i < 40; i++) {
    const wt = addWorktree(work, `bulk-${i}`);
    for (let f = 0; f < 6; f++) fs.writeFileSync(path.join(wt, `pipeline/lib/generated-file-with-a-long-name-${i}-${f}.js`), `x${i}${f}\n`);
    // and files outside the paths, which every row lists by name
    fs.mkdirSync(path.join(wt, 'elsewhere'), { recursive: true });
    for (let f = 0; f < 30; f++) fs.writeFileSync(path.join(wt, `elsewhere/another-quite-long-file-name-for-branch-${i}-number-${f}.txt`), `y${i}${f}\n`);
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', `bulk ${i} adds a good many files on the asked-about path`);
  }
  const r = spawnSync(process.execPath, [BIN, '--dir', work, '--no-fetch', '--no-prs', '--json', '--', ...PATHS], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    /* reported below */
  }
  check('stdout parses as one JSON object', parsed !== null, `${r.stdout.length} bytes; tail: ${r.stdout.slice(-80)}`);
  check('it is bigger than a pipe buffer', r.stdout.length > 65536, String(r.stdout.length));
  check('every candidate is a row', parsed?.rows?.length === 40, String(parsed?.rows?.length));
  check('exit code is still 1', r.status === 1, String(r.status));
}

/* =========================================================== 14. costOf */

console.log('\ncostOf says the three mistakes in plain words\n');

{
  const clean = costOf({ outside: [], baseSide: [], overlap: [], behind: 0 }, 'origin/main');
  check('a clean cherry says it touches nothing outside', /touches nothing outside these paths/.test(clean) && !/wholesale/.test(clean), clean);
  const dirty = costOf({ outside: ['a', 'b'], baseSide: ['c'], overlap: ['d'], behind: 4 }, 'origin/main');
  check('a real merge names all three costs', /brings in 2 files outside/.test(dirty) && /wholesale would drop 1 file/.test(dirty) && /4 behind origin\/main/.test(dirty) && /1 file changed on both sides/.test(dirty), dirty);
}

/* ---------------------------------------------------------------- verdict */

await cleanupTmp(tmp);
console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m\n` : '\n\x1b[32mall checks passed\x1b[0m\n');
process.exit(failures ? 1 : 0);
