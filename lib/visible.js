/**
 * Is this path tracked, ignored, or a tracked-but-unmaterialised LFS pointer — and what
 * follows from that. `bin/b7e-visible` is the argv parsing and printing; this is the
 * classification.
 *
 * bc-dgx7.141: six delmar sessions (dv-2uu.20, dv-2uu.21, dv-5eu.40, dv-5i2.122,
 * dv-5i2.93, dv-5eu.39) each answered "is this file tracked by git" by hand, in four
 * different spellings (`git check-ignore -v`, `grep -n ... .gitignore`, `cat` and
 * inspecting the bytes, `git ls-files | wc -l`), because in a repo whose worktrees carry
 * only tracked files that single fact silently decides three unrelated things: whether
 * `EnterWorktree` gives you a copy of the file at all, whether the worktree-guard hook
 * lets `Edit`/`Write` touch it in the main checkout, and whether a delivery's commit
 * picks it up. Nobody who asked the git question by hand went on to derive all three
 * consequences; this does.
 *
 * ## The four states a path can be in
 *
 * - **tracked** — `git ls-files --error-unmatch` succeeds. The ordinary case.
 * - **lfs-pointer** — tracked, `git check-attr filter` says `lfs` for it, and what's on
 *   disk (or what would be there) is the ~130-byte pointer text
 *   (`version https://git-lfs.github.com/spec/v1\n...`), not the real bytes — `git lfs
 *   pull` was never run, or the file is missing from disk entirely. A *materialised* LFS
 *   file (filter set, real content on disk) is reported as plain `tracked`; the pointer
 *   is the surprise worth a state of its own, not the LFS attribute by itself.
 * - **ignored** — not tracked, and `git check-ignore -v` matches it. Carries the rule
 *   that matched, as `{ file, line, pattern }` — `.gitignore:32:webseries/episodes/*`
 *   split apart rather than left as one string, since every session above needed the
 *   line number to go edit the rule itself.
 * - **untracked** — neither of the above. An ordinary new file, or nothing there at all.
 *
 * ## The three verdicts, and why each is derived the way it is
 *
 * **`presentInFreshWorktree`** — `git worktree add` (what `EnterWorktree` calls)
 * populates a new worktree from the index, nothing else, so only `tracked` and
 * `lfs-pointer` paths exist there at all. `ignored` and `untracked` paths are simply
 * absent — this is the "empty directory" dv-2uu.20 hit for `webseries/episodes/*`.
 *
 * **`editableInMainCheckout`** — mirrors `~/.claude/hooks/worktree-guard.sh`'s `guard`
 * mode *exactly*, not the informal "blocks tracked paths" gloss the bead that asked for
 * this tool used to describe it. Read the hook script itself: its `allowlisted()` check
 * is `.claude/*|CLAUDE.md|.gitignore` against the repo-relative path, full stop — it
 * never runs `git check-ignore` or `git ls-files` and does not care whether the path is
 * tracked. A `webseries/episodes/*` path is therefore blocked from `Edit`/`Write` in the
 * main checkout for the *same* reason a tracked `lib/foo.js` is: neither is allowlisted.
 * The difference dv-2uu.20 actually hit was which checkout has the bytes at all
 * (`presentInFreshWorktree`, above) — an ignored path has nowhere else to be edited, so
 * it still has to happen in the main checkout, just not through the `Edit`/`Write` tool
 * (a `cat > file <<'EOF'` heredoc is what worked). This field answers "does the hook
 * allow the tool", not "is there any way to get the edit done". When the target repo has
 * no `.claude/worktrees/` directory in its main checkout at all, the hook never engages
 * and every path reports `true`, matching `worktree-guard.sh`'s own opt-in check.
 *
 * **`carriedByDelivery`** — whether the ordinary `git add -A` a session runs before
 * committing would pick this path up at all. `ignored` paths never are, force-add aside;
 * `tracked`, `lfs-pointer` and `untracked` paths all are. This is a structural fact about
 * the path, not a live read of the working tree — for *that* (which paths are dirty
 * right now, the thing that trips `deliver.js`'s `git status --porcelain` refusal, which
 * is what caught out dv-5eu.39's stray `.deliver-body.md`), see `changedPaths` below and
 * `--changed` in `bin/b7e-visible`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';

/**
 * This process's own repo root — `git rev-parse --show-toplevel` from `cwd`. A small,
 * deliberate duplicate of the same helper `lib/where.js`, `lib/repogrep.js` and
 * `lib/cites.js` each already carry independently (see `lib/where.js`'s own header for
 * why: importing across an unmerged sibling PR ties this file's tests to whichever of
 * them lands first).
 */
export function repoRoot(cwd = process.cwd(), fallback = cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

/** A CLI-given path, relative to `cwd` or absolute, resolved to a repo-relative posix form. */
export function toRepoRel(root, cwd, given) {
  const abs = path.isAbsolute(given) ? given : path.resolve(cwd, given);
  return path.relative(root, abs).split(path.sep).join('/');
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function isTracked(root, relPath) {
  try {
    git(root, ['ls-files', '--error-unmatch', '--', relPath]);
    return true;
  } catch {
    return false;
  }
}

/** `{ file, line, pattern }` for the `.gitignore` rule that matches, or `null`. */
function checkIgnore(root, relPath) {
  let out;
  try {
    out = git(root, ['check-ignore', '-v', '--', relPath]).trim();
  } catch {
    return null; // exit 1: not ignored
  }
  if (!out) return null;
  const tab = out.indexOf('\t');
  const meta = tab === -1 ? out : out.slice(0, tab);
  const c1 = meta.indexOf(':');
  const c2 = meta.indexOf(':', c1 + 1);
  if (c1 === -1 || c2 === -1) return { file: meta, line: null, pattern: null };
  return { file: meta.slice(0, c1), line: Number(meta.slice(c1 + 1, c2)) || null, pattern: meta.slice(c2 + 1) };
}

/** The `filter` gitattribute for a tracked path — `'lfs'`, `'unspecified'`, or `null` on error. */
function checkAttrFilter(root, relPath) {
  let out;
  try {
    out = git(root, ['check-attr', 'filter', '--', relPath]).trim();
  } catch {
    return null;
  }
  const idx = out.lastIndexOf(': ');
  return idx === -1 ? null : out.slice(idx + 2).trim();
}

/** Reads up to the pointer's usual size and says whether it looks like one, not real bytes. */
function looksLikeLfsPointer(abs) {
  try {
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(200);
    const n = fs.readSync(fd, buf, 0, 200, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).toString('utf8').startsWith(LFS_POINTER_PREFIX);
  } catch {
    return false;
  }
}

/** Repo-relative path match for `~/.claude/hooks/worktree-guard.sh`'s `allowlisted()`. */
export function isAllowlistedForMainCheckout(relPath) {
  if (relPath === 'CLAUDE.md' || relPath === '.gitignore') return true;
  return relPath === '.claude' || relPath.startsWith('.claude/');
}

/** The main checkout `worktree-guard.sh` would resolve `root` to — its git-common-dir's parent. */
function mainCheckoutRoot(root) {
  try {
    const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
    return path.dirname(common);
  } catch {
    return root;
  }
}

/** Whether the repo `root` belongs to opts into the `.claude/worktrees/` workflow at all. */
export function usesWorktreeWorkflow(root) {
  return fs.existsSync(path.join(mainCheckoutRoot(root), '.claude', 'worktrees'));
}

/**
 * Classify one repo-relative path. See the module doc for what each field means and why
 * it is derived the way it is.
 */
export function classifyPath(root, relPath, { worktreeWorkflow = usesWorktreeWorkflow(root) } = {}) {
  const abs = path.join(root, relPath);
  const existsOnDisk = fs.existsSync(abs);
  const tracked = isTracked(root, relPath);

  let state;
  let ignoreRule = null;
  let lfs = null;

  if (tracked) {
    const filter = checkAttrFilter(root, relPath);
    if (filter === 'lfs') {
      const pointer = existsOnDisk ? looksLikeLfsPointer(abs) : true; // missing entirely: unmaterialised
      if (pointer) {
        state = 'lfs-pointer';
        lfs = { filter, materialised: false };
      } else {
        state = 'tracked';
        lfs = { filter, materialised: true };
      }
    } else {
      state = 'tracked';
    }
  } else {
    ignoreRule = checkIgnore(root, relPath);
    state = ignoreRule ? 'ignored' : 'untracked';
  }

  return {
    path: relPath,
    existsOnDisk,
    state,
    ignoreRule,
    lfs,
    presentInFreshWorktree: state === 'tracked' || state === 'lfs-pointer',
    editableInMainCheckout: !worktreeWorkflow || isAllowlistedForMainCheckout(relPath),
    carriedByDelivery: state !== 'ignored',
  };
}

/**
 * Every path `git status --porcelain` would show right now — tracked-and-modified
 * (staged or not) plus untracked-and-not-ignored — the exact set `bin/deliver.js`'s
 * dirty-tree guard refuses on (`bin/deliver.js` around its `git(['status',
 * '--porcelain'])` call). Classified the same way as `classifyPath`, so `--changed` is
 * "what would block or surprise a delivery right now", answered before calling it rather
 * than after it refuses.
 */
export function changedPaths(root) {
  const out = git(root, ['status', '--porcelain']);
  const worktreeWorkflow = usesWorktreeWorkflow(root);
  const rels = out
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    // a rename is "old -> new"; the new path is the one that matters going forward.
    .map((rel) => (rel.includes(' -> ') ? rel.slice(rel.indexOf(' -> ') + 4) : rel));
  return [...new Set(rels)].sort().map((rel) => classifyPath(root, rel, { worktreeWorkflow }));
}
