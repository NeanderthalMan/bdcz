/**
 * Git reading shared by the b7e tools that ask "which ref holds this" — `b7e-trace` first;
 * `b7e-newest` and `b7e-base` keep their own copies until they are moved onto it.
 *
 * Every function takes the directory to read in and never throws: git failing is "no
 * answer", not a crash, because these run in the middle of a session that has other
 * things to do.
 */
import { execFileSync } from 'node:child_process';

export const FIELD_SEP = '\x1f';
export const RECORD_SEP = '\x1e';

/** Run `git args` in `dir`; stdout, or `null` when git exits non-zero. */
export function git(dir, args) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    // `git grep` exits 1 for "no match", which is an answer (empty), not a failure.
    if (err.status === 1 && !err.stderr?.length && typeof err.stdout === 'string') return err.stdout;
    return null;
  }
}

export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `base` resolved to a ref that exists in `dir`: `origin/<base>` first, then `<base>`. `null` if neither. */
export function resolveTrunk(dir, base = 'main') {
  for (const cand of [`origin/${base}`, base]) {
    // `git()` reads exit 1 as an empty answer (right for `git grep`); here empty is "no such ref".
    if ((git(dir, ['rev-parse', '--verify', '--quiet', cand]) || '').trim()) return cand;
  }
  return null;
}

/** Every local branch and every `origin/*` branch except HEAD, short names, once each. */
export function allBranches(dir) {
  const out = git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin']) || '';
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'origin' && s !== 'origin/HEAD');
}

/** A branch's own name: `origin/x` and `x` are one branch. */
export const branchName = (ref) => String(ref || '').replace(/^origin\//, '');

/**
 * An ERE matching any of `ids` as a whole id — a dotted child (`bc-1.2`) is not `bc-1`,
 * and `bc-1x` is not either. POSIX ERE has no `\b` (see lib/landedcheck.js), so the
 * boundary is spelled out; the trailing `\.[0-9]` exclusion is applied afterwards in JS
 * by `idsNamedIn`, since ERE cannot look ahead.
 */
export function idsPattern(ids) {
  return `(^|[^A-Za-z0-9-])(${ids.map(escapeRe).join('|')})([^A-Za-z0-9]|$)`;
}

/** Which of `ids` `text` names exactly — not as a prefix of a longer id or of a dotted child. */
export function idsNamedIn(text, ids) {
  const found = new Set();
  for (const id of ids) {
    if (new RegExp(`(?<![A-Za-z0-9-])${escapeRe(id)}(?![A-Za-z0-9-]|\\.[0-9])`).test(text)) found.add(id);
  }
  return [...found];
}
