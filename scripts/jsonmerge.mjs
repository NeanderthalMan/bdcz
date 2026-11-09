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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeJsonText } from '../lib/jsonmerge.js';
import { driverState, installDriver, mainCheckoutScript } from '../lib/jsonmergedriver.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);

if (has('--help') || has('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
  process.exit(0);
}

/**
 * The install itself lives in lib/jsonmergedriver.js (bc-xl7n.207), because the daemon
 * runs the same thing at every startup. Pointed at the main checkout's copy of this
 * script, never a worktree's (bc-xl7n.125); outside a clone that has one — a scratch
 * repo, a test — at this copy.
 */
if (has('--install')) {
  const command = installDriver(process.cwd(), mainCheckoutScript(process.cwd()) || path.join(ROOT, 'scripts', 'jsonmerge.mjs'));
  console.log(`installed merge.jsonmerge.driver = ${command}`);
  process.exit(0);
}

if (has('--check')) {
  const now = driverState(process.cwd());
  if (!now.command) {
    console.error('merge.jsonmerge.driver is not set — run: node scripts/jsonmerge.mjs --install (the daemon also installs it at startup)');
    process.exit(1);
  }
  if (!now.ok) {
    console.error(`merge.jsonmerge.driver points at a script that is not there: ${now.command}`);
    process.exit(1);
  }
  console.log(`merge.jsonmerge.driver = ${now.command}`);
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
