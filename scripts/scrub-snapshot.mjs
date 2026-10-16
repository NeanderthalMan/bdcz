#!/usr/bin/env node
/**
 * Make a publishable snapshot of this repo — `npm run scrub`.
 *
 *   npm run scrub -- --out ~/snapshots/bdcz                        # HEAD, scrubbed, gated
 *   npm run scrub -- --out <dir> --ref main --commit               # ...and one commit in it
 *   npm run scrub -- --check <dir>                                 # gate a tree as it is
 *   npm run scrub -- --out <dir> --rules <file>                    # other rules
 *
 * `git archive <ref>` into a fresh directory — tracked files only, so nothing ignored,
 * nothing untracked and no history comes along — then the rules in `scrub.json` are applied
 * (see lib/scrub.js for their shape) and the gate runs. Exit 0 means the gate found nothing;
 * exit 1 prints every file and line it did find. `--check` runs only the gate, which is how
 * to ask the question of a snapshot that has already been published.
 *
 * `--commit` makes a new repository in `--out` with a single commit, authored as the
 * rules' `author` — never as whoever is configured in git here, which is the one identity
 * a scrub is most likely to exist to keep out. The gate reads that commit's author too.
 *
 * It never pushes. Putting a snapshot on the internet stays a step a person takes:
 *
 *   git -C <out> remote add origin <url> && git -C <out> push --force origin main
 *
 * The published snapshot is github.com/NeanderthalMan/bdcz (private; it was named
 * beadcause-public until 2026-10-15).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR } from '../lib/config.js';
import { collisions, gateTree, loadRules, residue, scrubTree } from '../lib/scrub.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const flag = (name) => args.includes(name);

const rulesFile = opt('--rules') || path.join(CONFIG_DIR, 'scrub.json');
if (!fs.existsSync(rulesFile)) {
  console.error(`No rules at ${rulesFile}. Write one (the shape is at the top of lib/scrub.js), or pass --rules.`);
  process.exit(2);
}
const rules = loadRules(rulesFile);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

function gate(dir) {
  const findings = gateTree(dir, rules);
  if (fs.existsSync(path.join(dir, '.git'))) {
    let author = '';
    try {
      author = execFileSync('git', ['-C', dir, 'log', '--format=%an <%ae>%n%cn <%ce>%n%B'], { encoding: 'utf8' });
    } catch {
      // a repository with no commit yet has no history to leak
    }
    for (const h of residue(author, rules)) findings.push({ file: '(git history)', ...h });
  }
  if (!findings.length) {
    console.log(`${green('✓')} gate: nothing denied in ${dir}`);
    return true;
  }
  const shown = findings.slice(0, 200);
  for (const f of shown) console.log(`  ${red('✗')} ${f.file}${f.line ? `:${f.line}` : ''}  ${f.match}  (${f.why})`);
  if (findings.length > shown.length) console.log(`  … and ${findings.length - shown.length} more`);
  const files = new Set(findings.map((f) => f.file)).size;
  console.log(`\n${red('✗')} gate: ${findings.length} finding${findings.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`);
  return false;
}

const check = opt('--check');
if (check) process.exit(gate(path.resolve(check)) ? 0 : 1);

const out = opt('--out');
if (!out) {
  console.error('Pass --out <dir> (a new or empty directory), or --check <dir>.');
  process.exit(2);
}
const dir = path.resolve(out);
if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
  console.error(`${dir} is not empty. The snapshot is always built from nothing — pick a new directory.`);
  process.exit(2);
}
if (flag('--commit') && !rules.author) {
  console.error(`--commit needs "author" in ${rulesFile} — the snapshot is never committed as the git identity here.`);
  process.exit(2);
}

const ref = opt('--ref') || 'HEAD';
const sha = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', ref], { encoding: 'utf8' }).trim();
fs.mkdirSync(dir, { recursive: true });
const tar = path.join(dir, '.snapshot.tar');
execFileSync('git', ['-C', ROOT, 'archive', '-o', tar, ref]);
execFileSync('tar', ['-xf', tar, '-C', dir]);
fs.rmSync(tar);

const before = collisions(dir, rules);
const report = scrubTree(dir, rules);

console.log(`\n${ref} (${sha}) → ${dir}\n`);
console.log(`  ${report.rewritten.length} files rewritten, ${report.renamed.length} renamed, ${report.dropped.length} dropped, ${report.added.length} added`);
const byRule = [...report.counts].sort((a, b) => b[1] - a[1]);
for (const [from, n] of byRule) console.log(`    ${String(n).padStart(5)}  ${from}`);
for (const c of before) console.log(`  note: "${c.to}" was already in the source (${c.file}) — the rule merges into it`);
console.log('');

let ok = gate(dir);

if (ok && flag('--commit')) {
  const [, name, email] = rules.author.match(/^(.*?)\s*<(.*)>$/) || [];
  const env = { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', `beadcause: scrubbed snapshot of ${sha}`);
  ok = gate(dir);
  if (ok) console.log(`\nCommitted. Publishing is yours to do:\n  git -C ${dir} remote add origin <url> && git -C ${dir} push --force origin main\n`);
}
process.exit(ok ? 0 : 1);
