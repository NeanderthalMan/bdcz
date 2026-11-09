#!/usr/bin/env node
/**
 * `b7e-hotspot` — why each conflicted merge of a file conflicted (bc-dgx7.201).
 *
 *     node test/hotspotwhy.mjs
 *
 * A real git repo in a temp dir with one merge of each cause committed into its history,
 * because the causes are claims about git's own behaviour and a stub of git proves none:
 *
 * 1. **stale-branch** — a branch cut before main rewrote a 100-line file down to 5.
 * 2. **rewrite-collision** — a branch that itself rewrote a file while main edited it.
 * 3. **driver-not-installed** — `.gitattributes` names a driver this clone never defined,
 *    and the same merge is clean with it.
 * 4. **real** — two sides editing neighbouring lines of a small file.
 * 5. **The command** — one call, `--json`, the rewrite commit named, bad arguments exit 1.
 * 6. **Helpers** — `mergeAttrFor`, `isRewrite`, `beadIn`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let failures = 0;
let ran = 0;
const check = (name, cond, detail = '') => {
  ran += 1;
  if (cond) return console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-hotspotwhy-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const why = await import(path.join(ROOT, 'lib', 'hotspotwhy.js'));
const spots = await import(path.join(ROOT, 'lib', 'hotspots.js'));

const repo = path.join(tmp, 'widgets');
fs.mkdirSync(repo);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env }).trim();
const write = (f, s) => {
  fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
  fs.writeFileSync(path.join(repo, f), s);
};
const lines = (n, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n';
const withLine = (text, n, to) => text.split('\n').map((l, i) => (i === n - 1 ? to : l)).join('\n');

git('init', '-q', '-b', 'main');
git('config', 'commit.gpgsign', 'false');
write('big.txt', lines(100));
write('col.txt', lines(100));
write('real.txt', lines(10));
write('d.json', lines(10, 'key'));
write('.gitattributes', 'd.json merge=fakejson\n');
// A stand-in for scripts/jsonmerge.mjs: keeps ours, always clean.
write('scripts/fakejson.mjs', 'process.exit(0);\n');
git('add', '-A');
git('commit', '-qm', 'base');

/** Branch from main, run `onBranch`, edit main with `onMain`, downmerge main into the branch, resolve, merge back. */
function round(name, onBranch, onMain, resolveTo) {
  git('checkout', '-qb', name);
  onBranch();
  git('commit', '-qam', `${name}: branch`);
  git('checkout', '-q', 'main');
  onMain();
  git('commit', '-qam', `${name}: main`);
  git('checkout', '-q', name);
  spawnSync('git', ['merge', '-q', '--no-edit', 'main'], { cwd: repo, env });
  for (const [f, text] of Object.entries(resolveTo)) write(f, text);
  git('commit', '-qam', `Merge main into ${name}`);
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '--no-edit', name);
  return git('rev-parse', `${name}`);
}
const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8');

// stale-branch: the branch is cut first and edits big.txt line 50; main then rewrites it to 5 lines
git('checkout', '-qb', 'stale');
write('big.txt', withLine(read('big.txt'), 50, 'edited on the stale branch'));
git('commit', '-qam', 'stale: branch edit');
git('checkout', '-q', 'main');
write('big.txt', lines(5, 'new'));
git('commit', '-qam', 'bc-rew1: big.txt becomes five lines');
const rewriteSha = git('rev-parse', 'HEAD');
git('checkout', '-q', 'stale');
spawnSync('git', ['merge', '-q', '--no-edit', 'main'], { cwd: repo, env });
write('big.txt', lines(5, 'new'));
git('commit', '-qam', 'Merge main into stale');
git('checkout', '-q', 'main');
git('merge', '-q', '--no-ff', '--no-edit', 'stale');

// rewrite-collision: the branch shrinks col.txt to 5 lines; main edits line 50
round('collide', () => write('col.txt', lines(5, 'short')), () => write('col.txt', withLine(read('col.txt'), 50, 'main edit')), { 'col.txt': lines(5, 'short') });

// real: neighbouring lines of a small file
round('real', () => write('real.txt', withLine(read('real.txt'), 5, 'branch five')), () => write('real.txt', withLine(read('real.txt'), 6, 'main six')), { 'real.txt': withLine(withLine(lines(10), 5, 'branch five'), 6, 'main six') });

// driver: both sides change the same line; the driver this clone lacks would have kept ours
round('driven', () => write('d.json', withLine(read('d.json'), 3, 'key 3 ours')), () => write('d.json', withLine(read('d.json'), 3, 'key 3 theirs')), { 'd.json': withLine(lines(10, 'key'), 3, 'key 3 ours') });

const ledger = path.join(tmp, 'ledger.json');
const scan = await spots.scanRepo(repo, { ledgerPath: ledger });
const eventFor = (file) => scan.events.find((e) => e.files.includes(file));
const explain = async (file) => why.explainMerge(repo, file, { sha: eventFor(file).sha }, await why.baseRewrites(repo, 'main', file));

console.log('each cause');

const stale = await explain('big.txt');
check('a branch cut before the rewrite is stale-branch', stale.cause === 'stale-branch', JSON.stringify(stale));
check('and names the rewrite commit', stale.rewrite?.sha === rewriteSha, JSON.stringify(stale.rewrite));
check('and its bead', stale.rewrite?.bead === 'bc-rew1', JSON.stringify(stale.rewrite));
check('with each parent\'s line count', stale.lines && [stale.lines.p1, stale.lines.p2].sort((a, b) => a - b).join() === '5,100', JSON.stringify(stale.lines));

const col = await explain('col.txt');
check('a side that shrank the file against the other\'s edit is rewrite-collision', col.cause === 'rewrite-collision', JSON.stringify(col));

const real = await explain('real.txt');
check('neighbouring lines of a small file are real', real.cause === 'real', JSON.stringify(real));

const drv = await explain('d.json');
check('a named-but-undefined driver that resolves it is driver-not-installed', drv.cause === 'driver-not-installed', JSON.stringify(drv));
check('and records that the driver makes it clean', drv.driver?.name === 'fakejson' && drv.driver.cleanWithDriver === true && drv.driver.installed === false, JSON.stringify(drv.driver));

git('config', 'merge.fakejson.driver', `${JSON.stringify(process.execPath)} scripts/fakejson.mjs %O %A %B %P`);
const drv2 = await explain('d.json');
check('still driver-not-installed once the clone has installed it since', drv2.cause === 'driver-not-installed' && drv2.driver.installed === true, JSON.stringify(drv2));
git('config', '--unset', 'merge.fakejson.driver');

console.log('\nthe command');

const bin = path.join(ROOT, 'bin', 'b7e-hotspot');
const run = (...a) => spawnSync(process.execPath, [bin, ...a, '--dir', repo, '--ledger', ledger], { encoding: 'utf8', env: process.env });
const cli = run('big.txt', '--json');
let parsed = null;
try {
  parsed = JSON.parse(cli.stdout);
} catch {
  /* reported below */
}
check('it exits 0 and prints JSON', cli.status === 0 && parsed, cli.stderr + cli.stdout.slice(0, 200));
check('one row per conflicted merge, tallied', parsed?.merges?.length === 1 && parsed.summary['stale-branch'] === 1, JSON.stringify(parsed?.summary));
check('the rewrite is in the report', parsed?.rewrites?.[0]?.sha === rewriteSha);
const text = run('big.txt');
check('the text report names the cause and the rewrite', /stale-branch/.test(text.stdout) && text.stdout.includes(rewriteSha.slice(0, 9)), text.stdout);
const exact = run('d.json', '--merges', eventFor('d.json').sha, '--json');
check('--merges explains exactly the merges given', JSON.parse(exact.stdout).merges[0].cause === 'driver-not-installed', exact.stdout.slice(0, 200));
check('a file nothing conflicted on has no rows', JSON.parse(run('src/none.js', '--json').stdout).merges.length === 0);
check('no file is exit 1', spawnSync(process.execPath, [bin], { encoding: 'utf8' }).status === 1);
check('a bad --since is exit 1', run('big.txt', '--since', 'soon').status === 1);
check('a non-commit in --merges is exit 1', run('big.txt', '--merges', 'deadbeef').status === 1);

console.log('\nhelpers');
check('mergeAttrFor finds an exact path and a basename glob', why.mergeAttrFor('# c\npackage.json merge=jsonmerge\n*.lock merge=union\n', 'package.json') === 'jsonmerge' && why.mergeAttrFor('*.lock merge=union\n', 'a/b.lock') === 'union');
check('mergeAttrFor says nothing for an unlisted file', why.mergeAttrFor('package.json merge=jsonmerge\n', 'README.md') === '');
check('isRewrite wants both a big change and a big file', why.isRewrite(100, 5) && why.isRewrite(5, 100) && !why.isRewrite(3, 30) && !why.isRewrite(0, 500) && !why.isRewrite(100, 90));
check('beadIn takes a leading id, ignores branch words', why.beadIn('bc-8nyxa: x') === 'bc-8nyxa' && why.beadIn('Merge pull request #3 from NeanderthalMan/dolt-server') === null && why.beadIn('fix (bc-xl7n.207) thing') === 'bc-xl7n.207');

await cleanupTmp(tmp);
console.log(`\n${failures ? `${failures} of ${ran} failed` : `${ran} passed`}`);
process.exit(failures ? 1 : 0);
