/**
 * What a worktree borrows from the main checkout — and whether it has borrowed it yet.
 *
 * A worktree of this repo is not a clone. Two directories it needs to run are gitignored
 * and so are simply *not there* in a fresh one, and both are meant to be **borrowed** from
 * the main checkout rather than built:
 *
 * - `node_modules` — one symlink, three levels up. bc-mf9s: four worktrees that ran a real
 *   `npm install` instead were 160 MB each and half the retired-worktree attic.
 * - `public/vendor` — a real directory holding one symlink per bundle, five levels up.
 *   bc-oqu7, and the links go on the seven files and never on the directory (bc-0i27.25:
 *   git refuses to resolve any path *underneath* a symlinked directory, which is what
 *   `test/gitignoreresidue.mjs` hits).
 *
 * `scripts/vendor.js` writes the second shape and stays the one owner of what is in it —
 * this file only checks for it. `scripts/preflight.mjs` — via `inspect()` and `repair()` below — is what stops a
 * session discovering the gap as somebody else's failing assertion three suites deep, and
 * `scripts/test.mjs` runs that before the first suite. bc-th3i is the bead: a fresh
 * worktree took four `npm test` runs to get past its own setup, and none of the four
 * failures was about the code under test.
 *
 * ## Why the gaps are invisible until they are expensive
 *
 * Neither shows up as a missing file. Node resolves `node_modules` by walking *up* the
 * tree — `.claude/worktrees/<name>` → `worktrees` → `.claude` → the main checkout — so
 * every in-repo suite passes without one, and only a suite that copies the repo somewhere
 * else fails: `test/tiermodel.mjs` mirrors `lib/` into `/var/folders/…`, where the walk
 * finds nothing, and dies with `ERR_MODULE_NOT_FOUND` for `yaml`. That reads exactly like
 * a broken import in the diff under test. And `public/vendor` surfaces as
 * `test/pagealias.mjs` failing a *content* assertion — five `/vendor/*` paths in
 * `public/sw.js`'s precache list resolving to nothing — which reads exactly like a service
 * worker regression.
 *
 * So the checks here are deliberately about the *prerequisite*, named as one, with the
 * command that fixes it. What they must never do is guess: `inspect()` reports nothing at
 * all for a tree that declares no dependencies and has no `scripts/vendor.js`, which is
 * every temp tree `test/testrunner.mjs` builds to drive the runner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** `.claude/worktrees/<name>` — three levels down from the main checkout, not four. */
export const WORKTREES = `${path.sep}.claude${path.sep}worktrees${path.sep}`;

/** From a worktree root to the checkout it hangs off: `<name>`, `worktrees`, `.claude`. */
export const UP_FROM_ROOT = path.join('..', '..', '..');

/**
 * The names `scripts/vendor.js` writes into `public/vendor`, read out of *that tree's* copy.
 *
 * Parsed rather than imported or restated, on purpose. `scripts/vendor.js` has to stay a
 * file with no imports of its own — candidate trees and several suites copy it alone and
 * run it — so it cannot take its list from here; and a second copy of seven names is a
 * copy that goes stale the first time a bundle is added. Its rows are one per line,
 * `  ['<in node_modules>', '<in public/vendor>'],`, the same shape `test/nodemodules.mjs`
 * already reads them by. An unreadable file is no bundles, which `inspect()` treats as
 * nothing to check.
 */
export function bundlesOf(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, 'scripts', 'vendor.js'), 'utf8');
  } catch {
    return [];
  }
  return [...text.matchAll(/^ {2}\['[^']+', '([^']+)'\],$/gm)].map((m) => m[1]);
}

/**
 * The main checkout a root hangs off, or null for the main checkout itself.
 *
 * Everything before `/.claude/worktrees/`. A retired worktree is deliberately *not* one:
 * nothing is meant to be running there, and `bin/attic.js` has its own rules about what it
 * may take away.
 */
export function mainCheckoutOf(root) {
  const marked = path.resolve(root) + path.sep;
  const at = marked.indexOf(WORKTREES);
  return at === -1 ? null : marked.slice(0, at);
}

/** Does this path exist, following symlinks — so a dangling link reads as absent. */
const there = (p) => fs.existsSync(p);

/** What `node_modules` is here, without following it: 'absent' | 'link' | 'dir' | 'file'. */
function treeShape(root) {
  let st;
  try {
    st = fs.lstatSync(path.join(root, 'node_modules'));
  } catch {
    return 'absent';
  }
  if (st.isSymbolicLink()) return 'link';
  return st.isDirectory() ? 'dir' : 'file';
}

/** The declared runtime dependencies of a tree, or [] when it declares none. */
function declaredDependencies(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return Object.keys(pkg.dependencies || {});
  } catch {
    return [];
  }
}

/** Which declared dependencies cannot actually be resolved from `root/node_modules`. */
function unresolvable(root, deps) {
  return deps.filter((d) => !there(path.join(root, 'node_modules', d, 'package.json')));
}

/** Which bundles are missing from `public/vendor`, by their name there. */
function missingBundles(root) {
  const out = path.join(root, 'public', 'vendor');
  return bundlesOf(root).filter((to) => !there(path.join(out, to)));
}

/**
 * What is missing before this tree can run its own suite.
 *
 * Each problem is `{ id, what, why, fix, repairable }` — `what` names the prerequisite in
 * one line, `why` says which suite fails and how it reads, `fix` is the literal command,
 * and `repairable` is whether `repair()` below can do it without a person. Nothing here
 * reads a suite or runs anything: it is four `lstat`s and a `readFileSync`.
 *
 * An empty array means "nothing to say", which covers both a correctly borrowed worktree
 * and a tree that declares no prerequisites at all.
 */
export function inspect(root) {
  const problems = [];
  const main = mainCheckoutOf(root);
  const deps = declaredDependencies(root);

  if (deps.length) {
    const shape = treeShape(root);
    const missing = unresolvable(root, deps);
    const borrowable = main && !unresolvable(main, deps).length;
    // A link that resolves to a complete tree is the whole point and says nothing. A link
    // that resolves to nothing is worse than no link at all, because `ln -s` will not
    // overwrite it and the obvious command then fails.
    if (missing.length) {
      const named = missing.slice(0, 3).join(', ') + (missing.length > 3 ? `, +${missing.length - 3} more` : '');
      if (shape === 'dir') {
        // Somebody installed a real tree here and it is incomplete. Replacing 160 MB that
        // a person put there is not a repair, whatever this file thinks of the decision.
        problems.push({
          id: 'node_modules',
          what: `node_modules is missing ${missing.length} declared ${missing.length === 1 ? 'dependency' : 'dependencies'} (${named})`,
          why: 'a suite that mirrors this repo outside it — test/tiermodel.mjs — dies with ERR_MODULE_NOT_FOUND, which reads like a broken import in your diff',
          fix: main
            ? `rm -rf node_modules && ln -s ${UP_FROM_ROOT}/node_modules node_modules   # borrow the main checkout's tree`
            : 'npm install',
          repairable: false,
        });
      } else if (borrowable) {
        problems.push({
          id: 'node_modules',
          what:
            shape === 'absent'
              ? 'node_modules is not here — a fresh worktree has none'
              : `node_modules is a ${shape === 'link' ? 'dangling symlink' : 'file'}, so nothing resolves through it`,
          why: 'test/tiermodel.mjs copies lib/ outside the repo, where node cannot walk up to the main checkout, and dies with ERR_MODULE_NOT_FOUND for a real dependency',
          fix: `ln -s ${UP_FROM_ROOT}/node_modules node_modules`,
          repairable: true,
        });
      } else {
        problems.push({
          id: 'node_modules',
          what: `no dependency tree to borrow — ${named} ${missing.length === 1 ? 'is' : 'are'} missing here${main ? ' and in the main checkout' : ''}`,
          why: 'test/tiermodel.mjs mirrors lib/ outside the repo and dies with ERR_MODULE_NOT_FOUND for a real dependency',
          fix: main ? `npm install --prefix ${main.replace(/\/$/, '')}` : 'npm install',
          repairable: false,
        });
      }
    }
  }

  const bundles = bundlesOf(root);
  if (bundles.length) {
    const out = path.join(root, 'public', 'vendor');
    let linkedDir = false;
    try {
      linkedDir = fs.lstatSync(out).isSymbolicLink();
    } catch {
      /* absent, which the missing-bundle check below covers */
    }
    const missing = missingBundles(root);
    if (linkedDir) {
      problems.push({
        id: 'vendor-dir',
        what: 'public/vendor is a symlink to a directory rather than a directory of symlinks',
        why: "git refuses to resolve any path underneath it — 'fatal: pathspec is beyond a symbolic link' — which is what test/gitignoreresidue.mjs hits (bc-0i27.25)",
        fix: 'rm public/vendor && node scripts/vendor.js',
        repairable: true,
      });
    } else if (missing.length) {
      problems.push({
        id: 'vendor',
        what: `public/vendor is missing ${missing.length} of ${bundles.length} browser bundles (${missing.join(', ')})`,
        why: "test/pagealias.mjs asserts every path in public/sw.js's precache list resolves to a file in public/, and five of them are /vendor/* — it reads as a service worker regression",
        fix: 'node scripts/vendor.js',
        repairable: true,
      });
    }
  }

  return problems;
}

/**
 * Do the ones that can be done, and say what was done.
 *
 * Returns one `{ id, did }` per repair carried out, and re-inspects afterwards rather than
 * trusting itself — the result is `{ done, left }`, where `left` is what a person still
 * has to do. Both repairs are idempotent, cost milliseconds, and write only things
 * `.gitignore` already covers, which is what makes doing them without asking reasonable:
 * `node_modules` (line 1, bare, no trailing slash — bc-slxm) and `public/vendor`.
 */
export function repair(root, problems = inspect(root)) {
  const done = [];
  // node_modules first: in the main checkout `scripts/vendor.js` copies out of the tree
  // this may have just created, and in a worktree it borrows either way.
  for (const p of problems.filter((p) => p.repairable && p.id === 'node_modules')) {
    const at = path.join(root, 'node_modules');
    fs.rmSync(at, { force: true, recursive: false });
    fs.symlinkSync(path.join(UP_FROM_ROOT, 'node_modules'), at);
    done.push({ id: p.id, did: `linked node_modules to the main checkout's tree` });
  }
  for (const p of problems.filter((p) => p.repairable && p.id === 'vendor-dir')) {
    fs.rmSync(path.join(root, 'public', 'vendor'), { force: true });
    done.push({ id: p.id, did: 'removed the symlinked public/vendor directory' });
  }
  if (problems.some((p) => p.repairable && (p.id === 'vendor' || p.id === 'vendor-dir'))) {
    const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'vendor.js')], {
      cwd: root,
      encoding: 'utf8',
    });
    const left = missingBundles(root);
    const all = bundlesOf(root).length;
    done.push({
      id: 'vendor',
      did: left.length
        ? `ran scripts/vendor.js — ${all - left.length} of ${all} bundles${run.status === 0 ? '' : ` (exit ${run.status})`}`
        : `wrote all ${all} browser bundles into public/vendor`,
    });
  }
  return { done, left: inspect(root) };
}

/** One problem as the two lines it is worth printing: what is wrong, then the command. */
export function describe(p) {
  return [`${p.what}\n  ${p.why}`, `  fix: ${p.fix}`].join('\n');
}
