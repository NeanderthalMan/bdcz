/**
 * The data environment a repo script needs in a worktree (bc-dgx7.175).
 *
 * A worktree carries only tracked files, so a git-LFS asset is a ~130-byte pointer there
 * while the main checkout holds the real bytes. Scripts that read such an asset take the
 * directory from an environment variable, and nothing in the repo says which variable
 * belongs to which script. This module reads that table from the checkout's own
 * `.beadcause/data.json` (the convention `lib/derived.js` uses for `derived.json`) and
 * resolves each entry against the main checkout, reusing `lib/visible.js` for the one
 * question "is this path a pointer, and is the real copy materialised".
 *
 *     { "vars": [ { "var": "ATLAS_ELEVATION_DIR",
 *                   "reads": ["reference/maps/atlantica_minor_common.py"],
 *                   "holds": "reference/maps/web/elevation.bin",
 *                   "dir": "reference/maps/web" } ] }
 *
 * `holds` is the file whose bytes matter; `dir` (default: `holds`' directory) is what the
 * variable is set to, under the main checkout; `reads` names the modules that read the
 * variable, for the report only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyPath } from './visible.js';

export const MANIFEST_DIR = '.beadcause';
export const MANIFEST_FILE = 'data.json';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.claude', 'vendor']);
const SCAN_EXT = /\.(py|js|mjs|cjs|ts|sh)$/;
const ENV_READS = [
  /os\.environ\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /os\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /os\.environ\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
];

/** The main checkout `root` is a worktree of — its git-common-dir's parent (root itself in the main one). */
export function mainCheckout(root) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return path.dirname(common);
  } catch {
    return root;
  }
}

/** `{ entries, problems }`; no manifest is `{ entries: [], problems: [] }`. Never throws. */
export function loadManifest(root) {
  const rel = `${MANIFEST_DIR}/${MANIFEST_FILE}`;
  let raw;
  try {
    raw = fs.readFileSync(path.join(root, MANIFEST_DIR, MANIFEST_FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { entries: [], problems: [] };
    return { entries: [], problems: [`cannot read ${rel} — ${err.message.split('\n')[0]}`] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { entries: [], problems: [`${rel} does not parse as JSON — ${err.message.split('\n')[0]}`] };
  }
  const entries = [];
  const problems = [];
  (Array.isArray(parsed?.vars) ? parsed.vars : []).forEach((v, i) => {
    const where = `${rel} vars[${i}]`;
    if (!v || typeof v !== 'object' || typeof v.var !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.var)) {
      problems.push(`${where} has no valid var name`);
      return;
    }
    if (typeof v.holds !== 'string' || !v.holds) {
      problems.push(`${where} (${v.var}) has no holds path`);
      return;
    }
    const holds = v.holds.replace(/^\.?\//, '');
    const dir = typeof v.dir === 'string' && v.dir ? v.dir.replace(/^\.?\//, '').replace(/\/$/, '') : path.posix.dirname(holds);
    const reads = Array.isArray(v.reads) ? v.reads.filter((s) => typeof s === 'string') : [];
    entries.push({ var: v.var, holds, dir, reads });
  });
  return { entries, problems };
}

/** How one entry resolves here: `here` (bytes already in this tree), `main`, or `nowhere`. */
export function resolveEntry(root, main, entry) {
  const local = classifyPath(root, entry.holds);
  const hereReal = local.existsOnDisk && local.state !== 'lfs-pointer';
  if (hereReal) return { ...entry, source: 'here', state: local.state, value: path.join(root, entry.dir) };
  if (main !== root) {
    const theirs = classifyPath(main, entry.holds);
    if (theirs.existsOnDisk && theirs.state !== 'lfs-pointer') {
      return { ...entry, source: 'main', state: theirs.state, value: path.join(main, entry.dir), localState: local.state };
    }
  }
  return { ...entry, source: 'nowhere', state: local.state, value: null };
}

/** Resolve every entry, or only those whose `holds` is `onlyPath` when given. */
export function resolveAll(root, { onlyPath = null } = {}) {
  const { entries, problems } = loadManifest(root);
  const main = mainCheckout(root);
  const chosen = onlyPath ? entries.filter((e) => e.holds === onlyPath.replace(/^\.?\//, '')) : entries;
  return { main, problems, results: chosen.map((e) => resolveEntry(root, main, e)), declared: entries.length };
}

/** The env assignments to apply: only variables that need pointing away from this tree. */
export function envFor(results) {
  const env = {};
  for (const r of results) if (r.source === 'main') env[r.var] = r.value;
  return env;
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** An eval-able line. */
export function printLine(env) {
  return Object.entries(env).map(([k, v]) => `export ${k}=${shq(v)}`).join('\n');
}

/** Draft a manifest by scanning source files for environment reads — heuristic, hence a draft. */
export function discover(root, { limit = 5000 } = {}) {
  const found = new Map();
  let seen = 0;
  const walk = (dir) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (seen >= limit) return;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs);
      } else if (SCAN_EXT.test(e.name)) {
        seen += 1;
        let text;
        try {
          text = fs.readFileSync(abs, 'utf8');
        } catch {
          continue;
        }
        for (const re of ENV_READS) {
          for (const m of text.matchAll(re)) {
            if (!/(_DIR|_PATH|_ROOT|_FILE)$/.test(m[1])) continue;
            const rel = path.relative(root, abs).split(path.sep).join('/');
            if (!found.has(m[1])) found.set(m[1], new Set());
            found.get(m[1]).add(rel);
          }
        }
      }
    }
  };
  walk(root);
  return {
    vars: [...found.entries()].sort().map(([v, files]) => ({ var: v, reads: [...files].sort(), holds: 'FILL-IN: the LFS file whose bytes this variable points at' })),
  };
}
