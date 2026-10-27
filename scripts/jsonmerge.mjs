#!/usr/bin/env node
/**
 * The `jsonmerge` git merge driver — `package.json` and `package-lock.json` merged by
 * structure rather than by line. bc-g95u9; the reasoning is in `lib/jsonmerge.js`.
 *
 *   node scripts/jsonmerge.mjs --install            # once per clone; every worktree shares it
 *   node scripts/jsonmerge.mjs --check              # is it installed, and pointing somewhere real
 *   node scripts/jsonmerge.mjs %O %A %B %P          # what git runs, from .gitattributes
 *
 * `.gitattributes` names the driver; this installs what the name means, as
 * `merge.jsonmerge.driver` in the repo's own config. That config lives in the common git
 * directory, so one install covers the main checkout and every worktree of it, including
 * ones made later — the same reach `conflict-check.mjs --install-hook` relies on.
 *
 * **Where the driver is not installed, nothing silently goes wrong.** Git treats a driver
 * name it has no definition for as its ordinary text merge, so an uninstalled clone (CI,
 * GitHub's own update-branch, a fresh machine) conflicts on these two files exactly the
 * way any other file does: a question, with markers, rather than union's answer.
 *
 * **When the structural merge cannot decide**, because a side does not parse or both
 * sides changed one key to two different values, the driver falls back to `git
 * merge-file`, which writes ordinary conflict markers into the file, and exits 1 so git
 * reports the path as conflicted. The reason goes to stderr, naming the key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeJsonText } from '../lib/jsonmerge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

if (has('--help') || has('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
  process.exit(0);
}

/**
 * The copy of this script the installed driver should run: the main checkout's, never a
 * worktree's — for the reason `conflict-check.mjs` gives (bc-xl7n.125). A worktree is
 * retired eventually, and a driver pointing into it would fail every merge after that.
 */
function mainCheckoutScript() {
  const commonDir = path.resolve(process.cwd(), git(['rev-parse', '--git-common-dir']));
  const candidate = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : null;
  const root =
    candidate && fs.existsSync(path.join(candidate, 'scripts', 'jsonmerge.mjs')) ? candidate : ROOT;
  return path.join(root, 'scripts', 'jsonmerge.mjs');
}

/** The driver command line git should run. `process.execPath` so it is the same node. */
function driverCommand(script = mainCheckoutScript()) {
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  return `${q(process.execPath)} ${q(script)} %O %A %B %P`;
}

if (has('--install')) {
  const command = driverCommand();
  git(['config', '--local', 'merge.jsonmerge.name', 'JSON merged by structure (beadcause scripts/jsonmerge.mjs)']);
  git(['config', '--local', 'merge.jsonmerge.driver', command]);
  console.log(`installed merge.jsonmerge.driver = ${command}`);
  process.exit(0);
}

if (has('--check')) {
  let command = '';
  try {
    command = git(['config', '--get', 'merge.jsonmerge.driver']);
  } catch {
    /* unset */
  }
  if (!command) {
    console.error('merge.jsonmerge.driver is not set — run: node scripts/jsonmerge.mjs --install');
    process.exit(1);
  }
  const script = /'([^']*jsonmerge\.mjs)'/.exec(command)?.[1];
  if (!script || !fs.existsSync(script)) {
    console.error(`merge.jsonmerge.driver points at a script that is not there: ${command}`);
    process.exit(1);
  }
  console.log(`merge.jsonmerge.driver = ${command}`);
  process.exit(0);
}

/* ------------------------------------------------------------------ the driver itself */

const [basePath, oursPath, theirsPath, pathname = 'the file'] = argv;
if (!basePath || !oursPath || !theirsPath) {
  console.error('usage: jsonmerge.mjs %O %A %B [%P]   (or --install, --check, --help)');
  process.exit(2);
}

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const result = mergeJsonText(read(basePath), read(oursPath), read(theirsPath));
if (result.ok) {
  fs.writeFileSync(oursPath, result.text);
  process.exit(0);
}

console.error(`jsonmerge: ${pathname} needs a person — ${result.reason}; leaving ordinary conflict markers`);
const fallback = spawnSync('git', ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs', oursPath, basePath, theirsPath], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
process.exit(fallback.status === 0 ? 1 : fallback.status || 1);
