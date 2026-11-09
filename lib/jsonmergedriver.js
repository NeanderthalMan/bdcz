/**
 * Installing the `jsonmerge` git merge driver, and keeping it installed — bc-xl7n.207.
 *
 * `.gitattributes` sends `package.json` and `package-lock.json` through `merge=jsonmerge`
 * (bc-g95u9, the merge itself is `lib/jsonmerge.js`). That attribute is only a name: git
 * runs the driver it names only once `merge.jsonmerge.driver` is set in the clone's own
 * config, and a clone without it silently falls back to an ordinary text merge.
 *
 * **That fallback is what bc-xl7n.207 measured.** The conflict-hotspot sweep counted 21
 * conflicted merges of `package-lock.json` in 30 days, and replaying the twelve it listed
 * (2026-10-15 to 2026-10-26) through `git merge-tree` gave the same answer twelve times:
 * a conflict without the driver, a clean merge of the lock with it. Nine of the twelve
 * came after bc-g95u9 landed — and this repo's own clone had never had `--install` run in
 * it, so every resolver window, every downmerge, every hand merge on this Mac was using
 * the text merge the driver was written to replace. The file did not need restructuring;
 * the fix existed and was not switched on.
 *
 * So the install is no longer a step somebody has to remember. The daemon calls
 * `ensureJsonMergeDriver` on its own checkout at every startup (bin/beadcause.js), and
 * because the setting lives in the common git directory, that one write covers the main
 * checkout and every worktree of it — the place every merge on this Mac actually runs.
 * `node scripts/jsonmerge.mjs --install` / `--check` still exist and use the same code.
 *
 * What this deliberately does not reach: GitHub. Its mergeability check and its
 * update-branch never run a custom driver, so a pull request can still read CONFLICTING
 * on these two files. That routes it to a resolver, and the resolver's local merge — in
 * this clone, with the driver — is what now goes through clean.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (dir, args) => {
  try {
    return git(dir, args);
  } catch {
    return '';
  }
};

/** Single-quote for the shell git runs the driver line through. */
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The driver command line git should run, for a given script. `execPath` so it is the same node. */
export function driverCommand(script, execPath = process.execPath) {
  return `${q(execPath)} ${q(script)} %O %A %B %P`;
}

/** The script a driver command line points at, or null. */
export function scriptOf(command) {
  return /'([^']*jsonmerge\.mjs)'/.exec(command || '')?.[1] || null;
}

/**
 * The main checkout's copy of the driver script, or null when there is none.
 *
 * Never a worktree's: a worktree is retired eventually and a driver pointing into it would
 * fail every merge after that (the reason `conflict-check.mjs` gives, bc-xl7n.125). And
 * null rather than a fallback: the router runs backends out of candidate directories that
 * are deleted on the next swap, and a driver pinned to one of those is the same trap.
 */
export function mainCheckoutScript(dir) {
  const common = tryGit(dir, ['rev-parse', '--git-common-dir']);
  if (!common) return null;
  const commonDir = path.resolve(dir, common);
  if (path.basename(commonDir) !== '.git') return null;
  const script = path.join(path.dirname(commonDir), 'scripts', 'jsonmerge.mjs');
  return fs.existsSync(script) ? script : null;
}

/** Whether this checkout's `.gitattributes` names the driver at all. */
export function declaresDriver(dir) {
  const top = tryGit(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return false;
  try {
    return /^\S+\s+merge=jsonmerge\s*$/m.test(fs.readFileSync(path.join(top, '.gitattributes'), 'utf8'));
  } catch {
    return false;
  }
}

/**
 * What is installed now: `{ command, script, ok }`, where `ok` means the setting exists
 * and the script it names is on disk.
 */
export function driverState(dir) {
  const command = tryGit(dir, ['config', '--get', 'merge.jsonmerge.driver']);
  const script = scriptOf(command);
  // The node it names too: process.execPath is an nvm-versioned path here, and an upgrade
  // that removes it would leave a driver git cannot run — repaired on the next startup.
  const node = /^'([^']+)'/.exec(command || '')?.[1] || null;
  const ok = Boolean(command && script && fs.existsSync(script) && (!node || fs.existsSync(node)));
  return { command, script, node, ok };
}

/** Write the setting unconditionally. Returns the command line written. */
export function installDriver(dir, script, execPath = process.execPath) {
  const command = driverCommand(script, execPath);
  git(dir, ['config', '--local', 'merge.jsonmerge.name', 'JSON merged by structure (beadcause scripts/jsonmerge.mjs)']);
  git(dir, ['config', '--local', 'merge.jsonmerge.driver', command]);
  return command;
}

/**
 * Make sure the driver is installed in `dir`'s clone. Never throws.
 *
 * Returns `{ state, command?, was?, reason? }`, `state` one of:
 * - `present`: already installed and pointing at a script that exists; nothing written.
 * - `installed`: it was missing (or pointed at a script that is gone) and is now set. `was` is the old value, '' if none.
 * - `skipped`: nothing to do or nowhere safe to point it (`reason` says which).
 * - `failed`: the write itself failed (`reason`).
 */
export function ensureJsonMergeDriver(dir, { script = null, execPath = process.execPath } = {}) {
  try {
    if (!declaresDriver(dir)) return { state: 'skipped', reason: '.gitattributes does not name merge=jsonmerge' };
    const now = driverState(dir);
    if (now.ok) return { state: 'present', command: now.command };
    const target = script || mainCheckoutScript(dir);
    if (!target) return { state: 'skipped', reason: 'no main checkout with scripts/jsonmerge.mjs to point the driver at' };
    const command = installDriver(dir, target, execPath);
    return { state: 'installed', command, was: now.command };
  } catch (err) {
    return { state: 'failed', reason: String(err?.stderr || err?.message || err).trim() };
  }
}

/** One line for the daemon's startup log, or null when there is nothing worth saying. */
export function describeEnsure(r) {
  if (!r) return null;
  if (r.state === 'present') return `jsonmerge   installed (${r.command})`;
  if (r.state === 'installed') return `jsonmerge   ${r.was ? 'repaired — it pointed at a script or node that is gone' : 'was not installed — installed it'} (${r.command})`;
  if (r.state === 'failed') return `jsonmerge   could not install the merge driver: ${r.reason}`;
  return null;
}
