/**
 * Run a regex over any workspace's checkout — or over a git ref of it — without the
 * shell or ugrep changing the question. `bin/b7e-grep` is the argv and the printing;
 * this is the enumeration, the matching and the cap.
 *
 * bc-xl7n.171, re-filed from loremia/lm-gr6.149: six loremia sessions lost round trips to
 * the *search itself* three ways. (1) `--include=*.md` glob-expanded by zsh before grep
 * ran (`no matches found`), four sessions. (2) ugrep refusing `.\{0,100\}Kestrel.\{0,100\}`
 * as past its complexity limit, so the whole query was rewritten as a python one-liner.
 * (3) A `git grep "Day 60"` returning 826KB that got persisted and truncated out of
 * context. So: the pattern and every path filter arrive as argv tokens no shell
 * reparses, matching is a JS `RegExp` (no complexity limit, and `\b` means what the
 * caller wrote), and output is capped with the cap *said out loud* — "showing 40 of 812
 * hits in 19 files" — rather than emitting a megabyte.
 *
 * `lib/repogrep.js` (bc-4r10.21) is the narrower slice this builds beside: this repo's
 * own seven roots, no workspace, no ref. The pattern compiler is shared, so the two never
 * disagree on what a pattern means; the file enumeration is not, because "which files"
 * here is git's answer (tracked, plus untracked-not-ignored, or a ref's tree) rather
 * than a fixed root list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { compilePatterns } from './repogrep.js';

export const DEFAULT_MAX_HITS = 40;
export const DEFAULT_WIDTH = 200;

/** Never searched, whatever the caller asks: git's own store and sibling worktrees. */
const ALWAYS_SKIP = /^(\.git|\.claude\/worktrees)(\/|$)/;

/**
 * A glob as a RegExp over repo-relative, forward-slashed paths. `**` crosses
 * directories, `*` and `?` never cross a `/`. A glob with no `/` in it matches on the
 * basename at any depth (`*.md` finds `docs/a/b.md`, as `.gitignore` reads it); one with a
 * `/` is anchored at the repo root.
 */
export function globToRegExp(glob) {
  const anchored = glob.includes('/');
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}$`);
}

function git(dir, args, opts = {}) {
  return execFileSync('git', args, { cwd: dir, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** `ref` if it names a tree in `dir`; throws, never guesses. */
export function verifyRef(dir, ref) {
  try {
    git(dir, ['rev-parse', '--verify', `${ref}^{tree}`]);
  } catch {
    throw new Error(`${ref} does not resolve to a tree in ${dir}`);
  }
  return ref;
}

/** Every searchable path: the working tree (tracked + untracked, never ignored) or a ref's tree. */
export function listFiles(dir, at) {
  const args = at ? ['ls-tree', '-r', '-z', '--name-only', at] : ['ls-files', '-z', '-c', '-o', '--exclude-standard'];
  let out;
  try {
    out = git(dir, args, { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`cannot list files in ${dir}: ${String(err.stderr || err.message).trim()}`);
  }
  const seen = new Set();
  const files = [];
  for (const f of out.split('\0')) {
    if (!f || seen.has(f) || ALWAYS_SKIP.test(f)) continue;
    seen.add(f);
    files.push(f);
  }
  return files.sort();
}

/** Contents of `files` at `at`, in order, through one `git cat-file --batch` — null for any that are not blobs. */
function readAtRef(dir, at, files) {
  if (!files.length) return [];
  const input = files.map((f) => `${at}:${f}\n`).join('');
  const r = spawnSync('git', ['cat-file', '--batch'], { cwd: dir, input, maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git cat-file failed in ${dir}: ${String(r.stderr).trim()}`);
  const buf = r.stdout;
  const out = [];
  let pos = 0;
  for (let i = 0; i < files.length; i++) {
    const nl = buf.indexOf(10, pos);
    const header = buf.toString('utf8', pos, nl).split(' ');
    pos = nl + 1;
    if (header[1] !== 'blob') {
      out.push(null);
      continue;
    }
    const size = Number(header[2]);
    out.push(buf.subarray(pos, pos + size));
    pos += size + 1;
  }
  return out;
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** `text` cut to about `width` columns around the first match, with an ellipsis on a cut side. */
export function trimLine(text, regexes, width = DEFAULT_WIDTH) {
  if (text.length <= width) return text;
  let at = 0;
  for (const re of regexes) {
    const m = re.exec(text);
    if (m) {
      at = m.index;
      break;
    }
  }
  const start = Math.max(0, Math.min(at - Math.floor(width / 4), text.length - width));
  const end = Math.min(text.length, start + width);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/**
 * Every hit, uncapped: `{ results: [{ file, hits: [{ line, text }] }], total, filesSearched }`.
 * `paths` are globs (any one matching keeps the file); `at` is a ref. Capping is the
 * caller's: `capHits` below.
 */
export function grepWorkspace(dir, patterns, { fixed = false, ignoreCase = false, paths = [], at, width = DEFAULT_WIDTH } = {}) {
  const regexes = compilePatterns(patterns, { fixed, ignoreCase });
  if (at) verifyRef(dir, at);
  const globs = paths.map(globToRegExp);
  let files = listFiles(dir, at);
  if (globs.length) files = files.filter((f) => globs.some((g) => g.test(f)));
  let bufs;
  if (at) {
    bufs = readAtRef(dir, at, files);
  } else {
    bufs = files.map((f) => {
      try {
        return fs.readFileSync(path.join(dir, f));
      } catch {
        return null;
      }
    });
  }
  const results = [];
  let total = 0;
  files.forEach((file, i) => {
    const buf = bufs[i];
    if (!buf || looksBinary(buf)) return;
    const lines = buf.toString('utf8').split('\n');
    const hits = [];
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n].replace(/\r$/, '');
      if (regexes.some((re) => re.test(line))) hits.push({ line: n + 1, text: trimLine(line, regexes, width) });
    }
    if (hits.length) {
      results.push({ file, hits });
      total += hits.length;
    }
  });
  return { results, total, filesSearched: files.length };
}

/**
 * The first `max` hits (in file order) of `result`, with the true totals kept beside them
 * so the printer can say what it left out. `max` of 0 or less means no cap.
 */
export function capHits(result, max = DEFAULT_MAX_HITS) {
  const files = result.results.length;
  if (max <= 0 || result.total <= max) return { shown: result.results, shownHits: result.total, total: result.total, files, capped: false };
  const shown = [];
  let left = max;
  for (const r of result.results) {
    if (left <= 0) break;
    const hits = r.hits.slice(0, left);
    left -= hits.length;
    shown.push({ file: r.file, hits, count: r.hits.length });
  }
  return { shown, shownHits: max, total: result.total, files, capped: true };
}
