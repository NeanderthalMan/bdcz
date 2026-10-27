/**
 * What another workspace's checkout actually looks like, before writing a command aimed
 * at it — the grouping and the runnable facts; `bin/b7e-repo` is the argv, the workspace
 * resolution and the printing around this.
 *
 * bc-dgx7.113 is the session audit's finding: three sessions each built a beadcause
 * command that operates on a *different* repo in the constellation, and each rediscovered
 * that repo's shape from scratch, differently. `bc-dgx7.16` (targeting sorrel) ran `ls`
 * three levels deep by hand to find `webapp/pages`/`webapp/static`, then compared
 * `git ls-files | wc -l` against a raw `find` to decide what its own walk should
 * enumerate — the comparison this module's `listFiles` reuse (from `lib/where.js`) makes
 * unnecessary a second time. `bc-dgx7.15` (same target, same hour, no shared context)
 * separately hand-found `.venv/bin/python3` and `requirements.txt`. `bc-dgx7.97`
 * (targeting delmar) `ls -la`'d `.claude/agents/` (six files, the wrong roster) before
 * finding `ai-context/agents/` (nineteen, the right one) by grepping for a known role
 * name and narrowing with `xargs dirname | sort -u`.
 *
 * **The surface grouping is `lib/where.js`'s, not a second copy of it.** `listFiles`,
 * `classifySurface`, `SURFACE_LABELS` and `SURFACE_ORDER` are imported, not
 * reimplemented — the same source/docs/tests/served-markup split `b7e-where` already
 * uses for a target repo whose layout is not knowable in advance (`git ls-files`, honouring
 * whatever `.gitignore` the target repo already has, never a hardcoded skip list of this
 * repo's own).
 *
 * **The interpreter fact prefers `python3` over `python`, deliberately not
 * `lib/pygate.js`'s `findInterpreter`.** That function's own test asserts, by name,
 * that "root's own .venv/bin/python wins outright" — a preference order pinned for its
 * one caller (`b7e-gate` just needs *an* interpreter to spawn) that would silently
 * change if reused here. This module's job is to *report* the interpreter, and
 * `python3` is the name every one of this bead's own examples used
 * (`lib/b7e_model.js`'s `sorrelPython`, `bc-dgx7.15`'s hand-found path) and the one that
 * still exists on a system with no bare `python` at all — so it is checked first, in a
 * small function of its own rather than a flag added to `findInterpreter` that would
 * need re-verifying against `test/pygate.mjs`'s pinned order.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifySurface, listFiles, SURFACE_LABELS, SURFACE_ORDER } from './where.js';

export { SURFACE_LABELS, SURFACE_ORDER };

/**
 * `root`'s current commit, or `null` when `root` is not a git repository (or has no
 * commits yet) — a real answer, not a guess, the same "refuse rather than fake it"
 * choice `findInterpreter` makes for a missing `.venv`.
 */
export function gitHead(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The directories that actually hold `relFiles`, ranked by how many of them they hold —
 * what a session would otherwise find with `ls -la` one guess at a time (`bc-dgx7.97`'s
 * `.claude/agents/` before `ai-context/agents/`).
 *
 * Each file is credited to its first `depth` path segments joined back together (a file
 * directly at the top of `root` credits nothing, since it has no directory at all) —
 * `ai-context/agents/sinew/prompt.md` credits `ai-context/agents`, not the 19 separate
 * per-role leaves that would each individually rank too low to appear. `depth: 1` would
 * collapse that same file to `ai-context`, which is too coarse to tell nineteen role
 * directories from the one config file that also happens to live there.
 */
export function topDirs(relFiles, { depth = 2, limit = 5 } = {}) {
  const counts = new Map();
  for (const rel of relFiles) {
    const parts = rel.split('/');
    if (parts.length < 2) continue; // a file with no directory at all credits nothing
    const dir = parts.slice(0, Math.min(depth, parts.length - 1)).join('/');
    counts.set(dir, (counts.get(dir) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([dir, count]) => ({ dir, count }));
}

/**
 * `root`'s tree, grouped the way `lib/where.js` already groups a search's hits — source,
 * docs, tests, served markup — except every file counts, not just ones matching a term.
 * `bySurface[<key>]` is `{ count, topDirs }`; a surface with `count: 0` still appears, so
 * "this repo has no served markup at all" and "it has some but this call found nothing
 * to say about it" stay distinguishable the same way `searchSurfaces`' `verdict` keeps
 * them distinguishable.
 */
export function layoutFor(root, { topDirsDepth = 2, topDirsLimit = 5 } = {}) {
  const files = listFiles(root);
  const bySurfaceFiles = { source: [], docs: [], tests: [], servedMarkup: [] };
  for (const rel of files) bySurfaceFiles[classifySurface(rel)].push(rel);

  const bySurface = {};
  for (const key of SURFACE_ORDER) {
    bySurface[key] = {
      count: bySurfaceFiles[key].length,
      topDirs: topDirs(bySurfaceFiles[key], { depth: topDirsDepth, limit: topDirsLimit }),
    };
  }
  return { filesTotal: files.length, bySurface };
}

const VENV_NAMES = ['python3', 'python'];

/**
 * `<root>/.venv/bin/<name>` for the first name that exists, `python3` preferred — see
 * the module doc comment for why this is not `lib/pygate.js`'s `findInterpreter`.
 */
function venvInterpreter(root) {
  for (const name of VENV_NAMES) {
    const p = path.join(root, '.venv', 'bin', name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * The facts a command needs before it spawns anything against `root`: right now, just
 * the interpreter (`null` when `root` has no `.venv` at all — a target repo with none
 * may still have nothing else installed either, and plain `python3` off `PATH` is a
 * guess this module does not make on the caller's behalf).
 */
export function runnableFacts(root) {
  return { interpreter: venvInterpreter(root) };
}
