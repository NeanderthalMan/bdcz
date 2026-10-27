/**
 * Where a sibling name is registered — every tuple/list/set member, dict key, `==`
 * comparison and `in (...)` branch across a tree, and whether a second name is
 * registered alongside it at each site (bc-dgx7.153).
 *
 * Four sessions (dv-5eu.1.16/.17/.18/.20) each answered "everywhere hide_shelter /
 * torch / atlatl / a load form registers" by hand — a grep for the old name, then a
 * second grep for what the first one missed, then `sed` slices read one at a time —
 * and every one of them still missed at least one registry (dv-5eu.1.20 found runner
 * silently dropping a load form only on a *third* pass). This is a single pass instead:
 * for every quoted occurrence of `<sibling>` in a source tree, classify what kind of
 * registration it is and which name owns it, then — with `--new` — say whether the new
 * name is registered at that same site or missing.
 *
 * WHAT THIS DOES NOT PARSE. Sites are found by a single character scan tracking string
 * state, comment state and bracket nesting — not a real parser for any of the languages
 * it runs against. It is deliberately generic rather than Python-specific (this repo
 * must not know about delmar — see the memory note this bead's own body cites): a
 * bracket char decides tuple/list/set-vs-dict, an `==`/`!=` immediately before a match
 * decides an equality branch, an `in` immediately before the enclosing bracket decides
 * an `in (...)` branch, and the *enclosing name* is either the assignment target the
 * bracket hangs off (`NAME = (...)`), the call/index name immediately before it, or —
 * for a branch with no bracket of its own — the nearest enclosing Python-style `def`,
 * found by walking indentation backward (a JS/Go/Ruby file gets no such fallback; its
 * branch sites report an empty enclosing name rather than a guess). Single-line `#` and
 * `//` comments are skipped entirely, matched neither as sites nor as prose. Only
 * triple-quoted Python docstrings and files under `PROSE_EXT` (README, `.md`, `.rst`,
 * `.txt`) are scanned for prose mentions.
 *
 * `--new`'s presence check is site-scoped, not file-scoped: a bracketed site asks
 * whether the new name shares the *same bracket* (`frame` object identity, not text
 * range, so a nested collection at the same source span never counts as the wrong
 * one); a branch site asks whether the new name has a match under the same enclosing
 * `def`. That is what lets a call answer "missing" at nine sites and "present" at one
 * without a human re-reading the diff.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'vendor', 'coverage', '__pycache__', '.venv', 'venv',
  'dist', 'build', '.mypy_cache', '.pytest_cache', '.tox', 'egg-info',
]);

export const CODE_EXT = new Set([
  '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.go', '.rb', '.java',
  '.c', '.h', '.hpp', '.cpp', '.cc', '.rs', '.swift', '.kt', '.scala', '.php',
]);
export const PROSE_EXT = new Set(['.md', '.mdx', '.rst', '.txt']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------ file walk / mode */

export function extOf(relPath) {
  return path.extname(relPath).toLowerCase();
}

/** 'code' | 'prose' | null (skip) — decided by extension, or a shebang for none. */
export function classifyFileMode(relPath, peek) {
  const ext = extOf(relPath);
  if (PROSE_EXT.has(ext)) return 'prose';
  if (CODE_EXT.has(ext)) return 'code';
  if (ext === '') return peek.startsWith('#!') ? 'code' : null;
  return null;
}

export function listFiles(root, { exclude = DEFAULT_EXCLUDE_DIRS } = {}) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (exclude.has(e.name)) continue;
        walk(full);
      } else if (e.isFile()) {
        out.push({ full, rel: path.relative(root, full).split(path.sep).join('/') });
      }
    }
  };
  walk(root);
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

/* -------------------------------------------------------------- prose scanning */

export function scanProseText(content, startLine, names) {
  const out = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const name of names) {
      const re = new RegExp(`\\b${escapeRe(name)}\\b`, 'g');
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        out.push({ name, line: startLine + i, col: m.index, snippet: lines[i].trim() });
      }
    }
  }
  return out;
}

/* ----------------------------------------------------------------- code scan */

const indentOf = (line) => {
  const m = /^[ \t]*/.exec(line)[0];
  return m.replace(/\t/g, '    ').length;
};

/** Nearest enclosing Python-style `def NAME(` above `lineNo` (1-based), by indentation. */
export function pythonDefScopeAt(lines, lineNo) {
  const matchIdx = lineNo - 1;
  let currentIndent = indentOf(lines[matchIdx] || '');
  for (let i = matchIdx - 1; i >= 0; i -= 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const ind = indentOf(raw);
    if (ind < currentIndent) {
      const m = /^\s*(?:async\s+)?def\s+(\w+)/.exec(raw);
      if (m) return m[1];
      currentIndent = ind;
      if (currentIndent === 0) break;
    }
  }
  return '';
}

const wordCharsBack = (text, endExclusive) => {
  let k = endExclusive - 1;
  while (k >= 0 && /[A-Za-z0-9_.]/.test(text[k])) k -= 1;
  return text.slice(k + 1, endExclusive);
};

/** Character scan of one file's text: every quoted occurrence of a name in `names`,
 * tagged with line/col/index/endIndex and the enclosing bracket frame (or null),
 * plus prose mentions found inside triple-quoted docstrings. Single-line and block
 * comments are skipped entirely. */
export function scanCodeText(text, names) {
  const nameSet = new Set(names);
  const matches = [];
  const prose = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let quote = null; // '"' | "'" | '"""' | "'''"
  let quoteStart = -1;
  let quoteStartLine = 1;
  let quoteIsDoc = false;
  let inLineComment = false;
  let inBlockComment = false;
  const stack = [];

  while (i < n) {
    const ch = text[i];

    if (ch === '\n') {
      line += 1;
      lineStart = i + 1;
      inLineComment = false;
      i += 1;
      continue;
    }

    if (inLineComment) { i += 1; continue; }

    if (inBlockComment) {
      if (ch === '*' && text[i + 1] === '/') { inBlockComment = false; i += 2; continue; }
      i += 1;
      continue;
    }

    if (quote) {
      if (quoteIsDoc) {
        if (text.startsWith(quote, i)) {
          const content = text.slice(quoteStart + 3, i);
          for (const p of scanProseText(content, quoteStartLine, names)) prose.push(p);
          quote = null;
          quoteIsDoc = false;
          i += 3;
          continue;
        }
        if (ch === '\\') { i += 2; continue; }
        i += 1;
        continue;
      }
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) {
        const content = text.slice(quoteStart + 1, i);
        if (nameSet.has(content)) {
          matches.push({
            name: content,
            index: quoteStart,
            endIndex: i + 1,
            line: quoteStartLine,
            col: quoteStart - lineStart,
            frame: stack[stack.length - 1] || null,
          });
        }
        quote = null;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    // not in a string or a comment
    if (ch === '#') { inLineComment = true; i += 1; continue; }
    if (ch === '/' && text[i + 1] === '/') { inLineComment = true; i += 2; continue; }
    if (ch === '/' && text[i + 1] === '*') { inBlockComment = true; i += 2; continue; }

    if (ch === '"' || ch === "'") {
      if (text[i + 1] === ch && text[i + 2] === ch) {
        quote = ch.repeat(3);
        quoteIsDoc = true;
        quoteStart = i;
        quoteStartLine = line;
        i += 3;
        continue;
      }
      quote = ch;
      quoteIsDoc = false;
      quoteStart = i;
      quoteStartLine = line;
      i += 1;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      const frame = { char: ch, openIndex: i, openLine: line, closeIndex: n, closeLine: -1 };
      stack.push(frame);
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack.pop();
      if (top) {
        top.closeIndex = i;
        top.closeLine = line;
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  return { matches, prose };
}

function dictOrSet(text, m) {
  let k = m.endIndex;
  while (k < text.length && /\s/.test(text[k])) k += 1;
  if (text[k] === ':') return 'dict key';
  let j = m.index - 1;
  while (j >= 0 && /\s/.test(text[j])) j -= 1;
  if (text[j] === ':') return 'dict value';
  return 'set member';
}

/** Attaches `.construct` and `.enclosing` to every match, in place, and returns it. */
export function classifyMatches(text, matches, lines) {
  for (const m of matches) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (/(==|!=)\s*$/.test(before)) {
      m.construct = 'equality (== "x")';
      m.enclosing = pythonDefScopeAt(lines, m.line);
      continue;
    }

    const frame = m.frame;
    if (!frame) {
      m.construct = 'reference';
      m.enclosing = pythonDefScopeAt(lines, m.line);
      continue;
    }

    let j = frame.openIndex - 1;
    while (j >= 0 && /\s/.test(text[j])) j -= 1;
    const wordBefore = wordCharsBack(text, j + 1);
    const isIn = /(^|[^A-Za-z0-9_])in$/.test(text.slice(Math.max(0, j - 1), j + 1));

    if (isIn) {
      m.construct = frame.char === '{' ? 'in {...} branch' : 'in (...) branch';
      m.enclosing = pythonDefScopeAt(lines, m.line);
      continue;
    }

    const baseKind = frame.char === '[' ? 'list member' : frame.char === '{' ? dictOrSet(text, m) : 'tuple member';
    m.construct = baseKind;

    if (text[j] === '=' && text[j - 1] !== '=' && text[j - 1] !== '!' && text[j - 1] !== '<' && text[j - 1] !== '>' && text[j + 1] !== '=') {
      let k = j - 1;
      while (k >= 0 && /\s/.test(text[k])) k -= 1;
      const name = wordCharsBack(text, k + 1);
      m.enclosing = name || pythonDefScopeAt(lines, m.line);
    } else if (wordBefore && !/^\d+$/.test(wordBefore)) {
      m.enclosing = wordBefore;
    } else {
      m.enclosing = pythonDefScopeAt(lines, m.line);
    }
  }
  return matches;
}

/** Full analysis of one file's text against a sibling name and an optional new name.
 * Returns { sites, prose } — `sites` are code-construct registrations of `sibling`
 * with `.newPresent` (`true`/`false`/`null` when `newName` was not given); `prose` are
 * README/docstring mentions of `sibling` or `newName`, unclassified. */
export function analyzeFileText(relPath, text, { sibling, newName }) {
  const names = newName ? [sibling, newName] : [sibling];
  const mode = classifyFileMode(relPath, text.slice(0, 2));

  if (mode === 'prose') {
    const found = scanProseText(text, 1, names);
    return { sites: [], prose: found.map((p) => ({ ...p, file: relPath })) };
  }
  if (mode !== 'code') return { sites: [], prose: [] };

  const { matches, prose } = scanCodeText(text, names);
  const lines = text.split('\n');
  classifyMatches(text, matches, lines);

  const sites = matches
    .filter((m) => m.name === sibling)
    .map((m) => {
      let newPresent = null;
      if (newName) {
        newPresent = matches.some((o) => {
          if (o.name !== newName) return false;
          if (m.frame || o.frame) return o.frame === m.frame;
          return o.enclosing === m.enclosing;
        });
      }
      return {
        file: relPath,
        line: m.line,
        col: m.col,
        construct: m.construct,
        enclosing: m.enclosing,
        snippet: (lines[m.line - 1] || '').trim(),
        newPresent,
      };
    });

  return { sites, prose: prose.map((p) => ({ ...p, file: relPath })) };
}

/** Reads a file's text via `readText(entry)`, given a list of `{ full, rel }` (or
 * whatever shape `readText` expects) entries, and aggregates every file's analysis.
 * This is the one seam `scanDir` and `scanRef` both go through so a fs-backed walk
 * and a git-tree-backed walk stay one code path. */
export function scanEntries(entries, readText, sibling, newName) {
  const sites = [];
  const prose = [];
  for (const entry of entries) {
    let text;
    try {
      text = readText(entry);
    } catch {
      continue;
    }
    if (text == null || text.includes('\0')) continue;
    const result = analyzeFileText(entry.rel, text, { sibling, newName });
    sites.push(...result.sites);
    prose.push(...result.prose);
  }
  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  prose.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { sites, prose };
}

export function scanDir(root, sibling, { newName } = {}) {
  const entries = listFiles(root);
  return scanEntries(entries, (e) => fs.readFileSync(e.full, 'utf8'), sibling, newName);
}

/** Throws if `ref` does not resolve in `root` — the caller turns that into exit 3. */
export function listFilesAtRef(root, ref) {
  execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${ref}^{commit}`], { stdio: 'pipe' });
  const out = execFileSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', ref], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((rel) => ({ rel }));
}

export function scanRef(root, ref, sibling, { newName } = {}) {
  const entries = listFilesAtRef(root, ref);
  const readText = (e) => execFileSync('git', ['-C', root, 'show', `${ref}:${e.rel}`], { encoding: 'utf8' });
  return scanEntries(entries, readText, sibling, newName);
}
