/**
 * Claude Code allow rules for the `bd` commands an agent session runs (bc-eg9tj).
 *
 * Without them every `bd create`, `bd update` and `bd comments add` an advocate's worker
 * runs stops on a permission prompt, and the sessions beadcause opens mostly run with
 * nobody at the screen. So `npm run install-service` merges these rules into the
 * user-scope Claude Code settings, and `npm run uninstall-service` takes back exactly the
 * ones it added.
 *
 * Left out on purpose, so they still prompt:
 *   - `bd delete`   — irreversible from the session's point of view.
 *   - `bd jira …`   — JIRA is pull-only; a push writes to the team's source of truth.
 *   - `bd dolt push` — a shared graph (the northwind one) is the team's, not this Mac's.
 *   - `bd init`     — writes CLAUDE.md, AGENTS.md and .claude/ into the current directory.
 *
 * Three things this has to get right, and why:
 *
 * 1. **Merge, never replace.** settings.json also holds the status line, the hooks and the
 *    env block. Only `permissions.allow` is touched, and only by appending.
 * 2. **Write through a symlink, never over it.** On Adam's Mac
 *    `~/.claude-personal/settings.json` is a symlink to `~/.claude/settings.json`. Writing
 *    the link path with a rename would replace the link with a copy, and the two accounts
 *    would quietly stop sharing settings. So every path is resolved to its real file
 *    first, the real files are deduplicated, and the write lands on the real file.
 * 3. **Uninstall removes only what install added.** A rule the user already had before
 *    the install is not recorded, so it is never taken away. The record is a ledger in
 *    beadcause's own config dir, never a marker inside settings.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BD_ALLOW_RULES = Object.freeze([
  // The write side — the reason this exists.
  'Bash(bd create:*)',
  'Bash(bd update:*)',
  'Bash(bd close:*)',
  'Bash(bd comments add:*)',
  'Bash(bd dep add:*)',
  'Bash(bd label:*)',
  // The read side. Most of these already pass as reads; listing them stops a long
  // argument (a --json | jq pipeline) from tipping one into a prompt.
  'Bash(bd list:*)',
  'Bash(bd show:*)',
  'Bash(bd search:*)',
  'Bash(bd ready:*)',
]);

/** Verbs that must never be pre-approved. Checked by the test, so a later edit to the
 * list above cannot slip one in. */
export const BD_NEVER_ALLOW = Object.freeze(['bd delete', 'bd jira', 'bd dolt push', 'bd init']);

/**
 * Pure: `settings` with `rules` appended to `permissions.allow`, skipping any already
 * there. Returns `{ settings, added }`; `settings` is a new object and `added` is the
 * rules that were not there before, in order. Every other key is carried over untouched.
 */
export function addRules(settings, rules = BD_ALLOW_RULES) {
  const next = structuredClone(settings ?? {});
  const permissions = next.permissions && typeof next.permissions === 'object' ? next.permissions : {};
  const allow = Array.isArray(permissions.allow) ? [...permissions.allow] : [];
  const have = new Set(allow);
  const added = [];
  for (const rule of rules) {
    if (have.has(rule)) continue;
    have.add(rule);
    allow.push(rule);
    added.push(rule);
  }
  if (!added.length) return { settings: next, added };
  next.permissions = { ...permissions, allow };
  return { settings: next, added };
}

/**
 * Pure: `settings` with exactly `rules` taken out of `permissions.allow`. An `allow` left
 * empty is removed, and so is a `permissions` left empty — so install then uninstall on a
 * file that had neither gives back the file it started from.
 */
export function removeRules(settings, rules) {
  const next = structuredClone(settings ?? {});
  const allow = next.permissions?.allow;
  if (!Array.isArray(allow)) return { settings: next, removed: [] };
  const drop = new Set(rules);
  const kept = allow.filter((r) => !drop.has(r));
  const removed = allow.filter((r) => drop.has(r));
  if (!removed.length) return { settings: next, removed };
  if (kept.length) next.permissions.allow = kept;
  else delete next.permissions.allow;
  if (!Object.keys(next.permissions).length) delete next.permissions;
  return { settings: next, removed };
}

/**
 * The user-scope settings files this install should write, as real paths, deduplicated.
 *
 * `$CLAUDE_CONFIG_DIR` is the live config dir of whichever account the install is run
 * from, and `~/.claude` is the default one. Both are written when both exist: a Mac with
 * two accounts runs sessions under each, and an install run from one must not leave the
 * other prompting. A directory that does not exist is skipped, except that with neither
 * present `~/.claude` is created, so a machine that installs beadcause before it first
 * runs Claude Code still gets the rules.
 */
export function settingsTargets({ env = process.env, home = os.homedir() } = {}) {
  const dirs = [];
  if (env.CLAUDE_CONFIG_DIR) dirs.push(path.resolve(env.CLAUDE_CONFIG_DIR));
  dirs.push(path.join(home, '.claude'));
  const existing = dirs.filter((d) => isDir(d));
  const chosen = existing.length ? existing : [path.join(home, '.claude')];
  const seen = new Set();
  const out = [];
  for (const dir of chosen) {
    const real = realSettingsPath(path.join(dir, 'settings.json'));
    if (seen.has(real)) continue;
    seen.add(real);
    out.push({ path: path.join(dir, 'settings.json'), real });
  }
  return out;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The file a write to `p` should land on: through every symlink, including a dangling
 * one's target, so a link is never replaced by a regular file. */
export function realSettingsPath(p) {
  let cur = p;
  for (let hops = 0; hops < 32; hops += 1) {
    let st;
    try {
      st = fs.lstatSync(cur);
    } catch {
      // Missing: resolve the directory, keep the name.
      const dir = path.dirname(cur);
      let realDir = dir;
      try {
        realDir = fs.realpathSync(dir);
      } catch {
        /* the directory does not exist yet either; it is created on write */
      }
      return path.join(realDir, path.basename(cur));
    }
    if (!st.isSymbolicLink()) return fs.realpathSync(cur);
    cur = path.resolve(path.dirname(cur), fs.readlinkSync(cur));
  }
  throw new Error(`too many symlinks at ${p}`);
}

/** Read a settings file. Missing or empty is `{}`; anything that is not a JSON object
 * throws, so a hand-broken file is refused rather than overwritten. */
export function readSettings(real) {
  let text;
  try {
    text = fs.readFileSync(real, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('not a JSON object');
  }
  return parsed;
}

/** Write atomically next to the real file, keeping its mode. */
export function writeSettings(real, settings) {
  fs.mkdirSync(path.dirname(real), { recursive: true });
  let mode = 0o644;
  try {
    mode = fs.statSync(real).mode & 0o777;
  } catch {
    /* new file */
  }
  const tmp = `${real}.beadcause-${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode });
  fs.renameSync(tmp, real);
}

/* ------------------------------------------------------------------ ledger */

export const LEDGER_NAME = 'claude-permissions.json';

export function readLedger(configDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(configDir, LEDGER_NAME), 'utf8'));
    return parsed && typeof parsed.files === 'object' ? parsed : { files: {} };
  } catch {
    return { files: {} };
  }
}

function writeLedger(configDir, ledger) {
  const file = path.join(configDir, LEDGER_NAME);
  if (!Object.keys(ledger.files).length) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

/**
 * Merge the rules into every target. Returns one result per target:
 * `{ path, real, added, error? }`. A target that fails is reported and skipped; the
 * others are still written. The ledger records only what was actually added.
 */
export function installRules({ configDir, env, home, rules = BD_ALLOW_RULES, dryRun = false } = {}) {
  const ledger = readLedger(configDir);
  const results = [];
  for (const t of settingsTargets({ env, home })) {
    try {
      const { settings, added } = addRules(readSettings(t.real), rules);
      if (added.length && !dryRun) {
        writeSettings(t.real, settings);
        const prior = ledger.files[t.real] ?? [];
        ledger.files[t.real] = [...prior, ...added.filter((r) => !prior.includes(r))];
      }
      results.push({ ...t, added });
    } catch (e) {
      results.push({ ...t, added: [], error: e.message });
    }
  }
  if (!dryRun) writeLedger(configDir, ledger);
  return results;
}

/** Take back exactly what the ledger says install added, file by file. */
export function uninstallRules({ configDir, dryRun = false } = {}) {
  const ledger = readLedger(configDir);
  const results = [];
  for (const [real, rules] of Object.entries(ledger.files)) {
    try {
      const { settings, removed } = removeRules(readSettings(real), rules);
      if (removed.length && !dryRun) writeSettings(real, settings);
      if (!dryRun) delete ledger.files[real];
      results.push({ real, removed });
    } catch (e) {
      results.push({ real, removed: [], error: e.message });
    }
  }
  if (!dryRun) writeLedger(configDir, ledger);
  return results;
}
