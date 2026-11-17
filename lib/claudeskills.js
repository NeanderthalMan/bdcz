/**
 * Claude Code skills that ship in this checkout, linked into the user's skills folder
 * (bc-eszkl).
 *
 * `skills/<name>/` holds a skill beadcause owns, such as `/bdcz` (file a bead) and
 * `/handoff`. `npm run install-service` links each one into `<config dir>/skills/<name>`,
 * and `npm run uninstall-service` removes exactly the links it made.
 *
 * Choices, and why:
 *
 * 1. **A symlink, not a copy.** The skill and the scripts it calls change together. A
 *    copy would go stale on the next `git pull`; a link is always the checkout's current
 *    text. The scripts beside a SKILL.md reach `lib/` through the link: node resolves a
 *    symlinked entry point to its real path, and bin/open-handoff walks its own links.
 * 2. **The same two config dirs as lib/claudeperms.js.** `$CLAUDE_CONFIG_DIR` and
 *    `~/.claude`, each resolved to its real path and deduplicated. On Adam's Mac
 *    `~/.claude-personal/skills` is itself a link to `~/.claude/skills`, so that is one
 *    target, not two.
 * 3. **Never replace what someone else put there.** A real directory, or a link that
 *    points anywhere but a beadcause checkout's `skills/<name>`, is left alone and
 *    reported. `replace: true` moves a real directory into beadcause's config dir
 *    (`replaced-skills/<name>-<stamp>`) before linking, so nothing is deleted. A link
 *    into *another* beadcause checkout is re-pointed, because that is the same skill.
 * 4. **Uninstall removes only its own links.** The ledger in beadcause's config dir
 *    records each link made. A link someone has since re-pointed is not ours any more
 *    and is kept.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LEDGER_NAME = 'claude-skills.json';

/** The skills this checkout ships: every `skills/<name>/` holding a SKILL.md. */
export function bundledSkills(root) {
  const dir = path.join(root, 'skills');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => !n.startsWith('.') && fs.existsSync(path.join(dir, n, 'SKILL.md')))
    .sort()
    .map((name) => ({ name, source: path.join(dir, name) }));
}

/**
 * The skills folders to link into, as `{ path, real }`, deduplicated by real path. With
 * neither config dir present, `~/.claude` is used and its `skills/` created on install.
 */
export function skillsTargets({ env = process.env, home = os.homedir() } = {}) {
  const dirs = [];
  if (env.CLAUDE_CONFIG_DIR) dirs.push(path.resolve(env.CLAUDE_CONFIG_DIR));
  dirs.push(path.join(home, '.claude'));
  const existing = dirs.filter(isDir);
  const chosen = existing.length ? existing : [path.join(home, '.claude')];
  const seen = new Set();
  const out = [];
  for (const dir of chosen) {
    const p = path.join(dir, 'skills');
    const real = realOrSelf(p);
    if (seen.has(real)) continue;
    seen.add(real);
    out.push({ path: p, real });
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

/** Real path of `p`; for a missing path, its parent's real path plus the name. */
function realOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
    } catch {
      return p;
    }
  }
}

/** Does this link target look like `<some beadcause checkout>/skills/<name>`? */
function isBeadcauseSkillLink(target, name) {
  if (path.basename(target) !== name || path.basename(path.dirname(target)) !== 'skills') return false;
  const checkout = path.dirname(path.dirname(target));
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(checkout, 'package.json'), 'utf8'));
    return pkg.name === 'beadcause';
  } catch {
    return false;
  }
}

/**
 * What to do at `dest` for a skill whose source is `source`:
 * `link` (nothing there), `ok` (already ours), `repoint` (another beadcause checkout's),
 * `replace` (a real directory, only with `replace`), or `skip` with a reason.
 */
export function plan(dest, source, name, { replace = false } = {}) {
  let st;
  try {
    st = fs.lstatSync(dest);
  } catch {
    return { action: 'link' };
  }
  if (st.isSymbolicLink()) {
    const target = path.resolve(path.dirname(dest), fs.readlinkSync(dest));
    if (target === source) return { action: 'ok' };
    if (isBeadcauseSkillLink(target, name)) return { action: 'repoint', from: target };
    return { action: 'skip', reason: `a link to ${target}, not beadcause's` };
  }
  if (st.isDirectory()) {
    return replace
      ? { action: 'replace' }
      : { action: 'skip', reason: 'a directory of your own (re-run with --replace to move it aside and link beadcause\'s)' };
  }
  return { action: 'skip', reason: 'a file, not a skill directory' };
}

export function readLedger(configDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(configDir, LEDGER_NAME), 'utf8'));
    return parsed && Array.isArray(parsed.links) ? parsed : { links: [] };
  } catch {
    return { links: [] };
  }
}

function writeLedger(configDir, ledger) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, LEDGER_NAME), `${JSON.stringify(ledger, null, 2)}\n`);
}

/**
 * Link every bundled skill into every target. Returns one row per (target, skill):
 * `{ dest, name, action, reason?, movedTo? }`. With `dryRun`, nothing is written.
 */
export function installSkills({ root, configDir, env, home, replace = false, dryRun = false, now = new Date() }) {
  const skills = bundledSkills(root);
  const ledger = readLedger(configDir);
  const rows = [];
  for (const target of skillsTargets({ env, home })) {
    for (const { name, source } of skills) {
      const dest = path.join(target.real, name);
      const step = plan(dest, source, name, { replace });
      const row = { dest, name, ...step };
      rows.push(row);
      if (dryRun || step.action === 'ok' || step.action === 'skip') continue;
      fs.mkdirSync(target.real, { recursive: true });
      if (step.action === 'repoint') fs.unlinkSync(dest);
      if (step.action === 'replace') {
        const stamp = now.toISOString().replace(/[:.]/g, '-');
        const aside = path.join(configDir, 'replaced-skills', `${name}-${stamp}`);
        fs.mkdirSync(path.dirname(aside), { recursive: true });
        fs.renameSync(dest, aside);
        row.movedTo = aside;
      }
      fs.symlinkSync(source, dest);
      if (!ledger.links.some((l) => l.dest === dest)) ledger.links.push({ dest, source });
      else ledger.links = ledger.links.map((l) => (l.dest === dest ? { dest, source } : l));
    }
  }
  if (!dryRun && rows.some((r) => ['link', 'repoint', 'replace'].includes(r.action))) writeLedger(configDir, ledger);
  return rows;
}

/** Remove the links install made that still point where it pointed them. */
export function uninstallSkills({ configDir, dryRun = false }) {
  const ledger = readLedger(configDir);
  const rows = [];
  for (const { dest, source } of ledger.links) {
    let target = null;
    try {
      if (fs.lstatSync(dest).isSymbolicLink()) target = path.resolve(path.dirname(dest), fs.readlinkSync(dest));
    } catch {
      rows.push({ dest, action: 'gone' });
      continue;
    }
    if (target !== source) {
      rows.push({ dest, action: 'kept', reason: 'no longer beadcause\'s link' });
      continue;
    }
    if (!dryRun) fs.unlinkSync(dest);
    rows.push({ dest, action: 'removed' });
  }
  // Every entry is settled now — removed, gone, or someone else's — so the ledger goes.
  if (!dryRun) fs.rmSync(path.join(configDir, LEDGER_NAME), { force: true });
  return rows;
}
