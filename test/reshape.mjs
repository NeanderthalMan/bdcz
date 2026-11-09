#!/usr/bin/env node
/**
 * `b7e-reshape` — replay a file's past merges with a proposed change (bc-dgx7.202).
 *
 *     node test/reshape.mjs
 *
 * A real git repo with two merges of one file committed into its history, because the
 * claim is about git's own merge and a stub proves nothing:
 *
 * 1. **fixed** — both sides edit one comma-joined import line, so git conflicts; a
 *    transform that puts one name per line makes the same two edits clean.
 * 2. **caused** — both sides edit two lines with one unchanged line between them, so git
 *    merges cleanly; a transform that joins those lines makes the same edits collide.
 * 3. **The command** — the totals, the worse row first, `--json`, a driver, bad arguments.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-reshape-'));
const lib = await import(path.join(ROOT, 'lib', 'reshape.js'));

const repo = path.join(tmp, 'widgets');
fs.mkdirSync(repo);
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env }).trim();
const write = (f, s) => fs.writeFileSync(path.join(repo, f), s);
const edit = (f, from, to) => write(f, fs.readFileSync(path.join(repo, f), 'utf8').replace(from, to));

const BASE = "import { a, b, c } from 'x';\n\npair-a 1\ngap\npair-b 1\n";
git('init', '-q', '-b', 'main');
git('config', 'commit.gpgsign', 'false');
write('f.txt', BASE);
git('add', '-A');
git('commit', '-qm', 'base');

/** Branch edits, main edits, merge the branch into main; resolve a conflict by keeping `resolved`. */
function round(name, onBranch, onMain, resolved) {
  git('checkout', '-qb', name);
  onBranch();
  git('commit', '-qam', `${name}: branch`);
  git('checkout', '-q', 'main');
  onMain();
  git('commit', '-qam', `${name}: main`);
  spawnSync('git', ['merge', '-q', '--no-ff', '--no-edit', name], { cwd: repo, env });
  write('f.txt', resolved);
  spawnSync('git', ['commit', '-qam', `Merge ${name}`], { cwd: repo, env });
}

// 1: both edit the comma-joined import line (names added at opposite ends)
round('imports', () => edit('f.txt', '{ a, b, c }', '{ a, a2, b, c }'), () => edit('f.txt', '{ a, b, c }', '{ a, b, c, c2 }'), "import { a, a2, b, c, c2 } from 'x';\n\npair-a 1\ngap\npair-b 1\n");
const importsSha = git('rev-parse', 'HEAD');
// 2: both edit pair-a / pair-b, with `gap` between them
round('pairs', () => edit('f.txt', 'pair-a 1', 'pair-a 2'), () => edit('f.txt', 'pair-b 1', 'pair-b 2'), "import { a, a2, b, c, c2 } from 'x';\n\npair-a 2\ngap\npair-b 2\n");
const pairsSha = git('rev-parse', 'HEAD');
// a merge that touched the file on one side only must not be counted
git('checkout', '-qb', 'other');
write('g.txt', 'x\n');
git('add', '-A');
git('commit', '-qm', 'other: g');
git('checkout', '-q', 'main');
edit('f.txt', 'pair-a 2', 'pair-a 3');
git('commit', '-qam', 'main: one-sided');
git('merge', '-q', '--no-ff', '--no-edit', 'other');

// The proposed change: one import name per line, and pairs joined onto one line.
const transform = (text) =>
  text
    .replace(/^import \{ (.*) \} from 'x';$/m, (_, names) => `import {\n${names.split(', ').map((n) => `  ${n},`).join('\n')}\n} from 'x';`)
    .replace(/^(pair-a .*)\ngap\n(pair-b .*)$/m, '$1 | $2');
const tfile = path.join(tmp, 'transform.mjs');
fs.writeFileSync(tfile, `export default ${transform.toString()};\n`);

console.log('library');
const r = await lib.replay(repo, 'f.txt', { ref: 'main', sinceMs: 86400000, transform });
check('only merges that changed the file on both sides are replayed', r.totals.merges === 2, JSON.stringify(r.totals));
check('git conflicts on the import merge and not on the pair merge today', r.totals.sectionsBefore === 1 && r.totals.conflictedBefore === 1, JSON.stringify(r.totals));
check('with the change: one conflict fixed, one caused', r.totals.better === 1 && r.totals.worse === 1 && r.totals.sectionsAfter === 1, JSON.stringify(r.totals));
check('the fixed merge and the caused merge are both listed, worse first', r.rows.length === 2 && r.rows[0].sha === pairsSha && r.rows[0].before === 0 && r.rows[0].after === 1 && r.rows[1].sha === importsSha && r.rows[1].before === 1 && r.rows[1].after === 0, JSON.stringify(r.rows.map((x) => [x.sha.slice(0, 7), x.before, x.after])));
check('a worse merge carries the conflict markers', /<<<<<<< ours/.test(r.rows[0].excerpt));
check('a driver replaces the text merge', (await lib.replay(repo, 'f.txt', { ref: 'main', sinceMs: 86400000, driver: lib.parseDriver('keep=true') })).totals.sectionsAfter === 0);
check('--merges narrows the replay', (await lib.replay(repo, 'f.txt', { ref: 'main', shas: [importsSha], transform })).totals.merges === 1);
let threw = false;
try {
  await lib.replay(repo, 'f.txt', { ref: 'main' });
} catch {
  threw = true;
}
check('no change to test is an error', threw);
check('countSections counts marker lines only', lib.countSections('<<<<<<< a\nx\n=======\ny\n>>>>>>> b\nfoo <<<<<<< not\n') === 1);
check('parseSince and parseDriver', lib.parseSince('30d') === 30 * 86400000 && lib.parseSince('soon') === null && lib.parseDriver('a=b c').cmd === 'b c' && lib.parseDriver('nope') === null);

console.log('\nthe command');
const bin = path.join(ROOT, 'bin', 'b7e-reshape');
const run = (...a) => spawnSync(process.execPath, [bin, ...a, '--dir', repo, '--base', 'main'], { encoding: 'utf8', cwd: tmp });
const out = run('f.txt', '--transform', tfile, '--since', '2d');
const text = out.stdout.split('\n');
check('exits 0 and prints two lines of totals', out.status === 0 && /2 merges changed it on both sides/.test(text[0]) && /sections 1 -> 1 \(1 better, 1 worse\)/.test(text[1]), out.stdout + out.stderr);
check('the worse merge is listed before the better one', /^WORSE/.test(text[2]) && /^better/.test(text[3]), out.stdout);
const js = JSON.parse(run('f.txt', '--transform', tfile, '--json').stdout);
check('--json has totals and rows with excerpts', js.totals.worse === 1 && js.rows.length === 2 && js.rows[0].excerpt.includes('<<<<<<<'));
check('--driver alone works from the command', JSON.parse(run('f.txt', '--driver', 'keep=true', '--json').stdout).totals.sectionsAfter === 0);
check('no file is exit 1', spawnSync(process.execPath, [bin], { encoding: 'utf8' }).status === 1);
check('no change given is exit 1', run('f.txt').status === 1);
check('a missing transform module is exit 1', run('f.txt', '--transform', path.join(tmp, 'nope.mjs')).status === 1);
check('a bad --since is exit 1', run('f.txt', '--transform', tfile, '--since', 'soon').status === 1);
check('a non-commit in --merges is exit 1', run('f.txt', '--transform', tfile, '--merges', 'deadbeef').status === 1);

await cleanupTmp(tmp);
console.log(`\n${failures ? `${failures} of ${ran} failed` : `${ran} passed`}`);
process.exit(failures ? 1 : 0);
