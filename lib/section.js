/**
 * A named section of an arbitrary document, with its line span — `bin/b7e-section` is the
 * argv shell; this is the parsing, the matching and the span arithmetic.
 *
 * `bc-dgx7.108` names seven sessions (`lm-5i2.52`, `lm-5i2.46`, `lm-5i2.45`, `lm-5i2.90`,
 * `lm-5eu.1.9`, `lm-3rn.12`, `lm-b5d.33`) that each located a heading by hand and then
 * guessed a line range with `sed -n`/`awk`, no two the same way, in a workspace repo where
 * the governing documents *are* the source — `lib/readme.js` already answers this question
 * for this repo's own README, but that tool is specific to one file. This generalises the
 * same act (heading in, span out) to any document, in any tree, optionally at a git ref.
 *
 * **Span arithmetic is not reimplemented — `rangeFor` from `lib/readme.js` is reused as
 * written.** It only ever touches `analysis.headings` (an array with `.level` and `.line`)
 * and `analysis.totalLines`, so any flavour of "heading" below — an ATX line, a bolded
 * label, a `def` at some indentation — works with it unchanged as long as it produces that
 * shape. `analyze` from the same module is reused outright for Markdown's ATX case: fence
 * blanking, heading levels, everything.
 *
 * **Two heading flavours, chosen by the file's own shape, not by extension alone.**
 * Markdown files (`.md`/`.markdown`/`.mdx`) are parsed as ATX headings first (`lib/readme.js`'s
 * `analyze`). `lm-5i2.52` lost three calls to a document that has no ATX headings at all —
 * `docs/MYSTERY_BIBLE.md` states each law as a *bolded label line* (`**LAW #6: ...**`), not
 * a `#`-prefixed one — so when a Markdown document has zero ATX headings, this falls back to
 * treating every line that opens with `**...**` as a flat, single-level heading instead.
 * Anything else (`.py`, `.js`, `.go`, `.rb`, an extensionless script) is parsed as code: a
 * `def`/`function`/`class` line names a section, and its *indentation* stands in for
 * heading level — a nested `def` has a deeper indent, so `rangeFor`'s "next heading at the
 * same or shallower level" rule ends an outer function at the next sibling or the next
 * dedent, exactly the way Python's own block scoping does, without this module needing to
 * know anything about blocks itself.
 *
 * **Matching is two-tier: exact first, substring second**, each independently checked for
 * ambiguity. `subject_screen_height` should match that one function and nothing merely
 * containing it as a substring; `'LAW #6'` should still find `**LAW #6: Do not delete a
 * scene others are using**`, which is not an exact match against anything. Two headings
 * that both match at whichever tier answers first is not this module resolving one over
 * the other — the caller is told name of it, with a status.
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyze, rangeFor } from './readme.js';

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdx']);

/** A line that is nothing but a bolded label (optionally followed by more text after the
 * closing `**`) — `docs/MYSTERY_BIBLE.md`'s law-per-line shape. Requires the `**` to open
 * the (trimmed) line, so a bold word inside an ordinary sentence is never mistaken for one. */
const BOLD_LABEL_RE = /^\*\*(.+?)\*\*/;

/** One `def`/`function`/`class` line, per language, captured as `(indent, name)`. Checked
 * in order, first match wins — a line can only be one kind of definition. */
const DEF_PATTERNS = [
  /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*[(:]/, // Python / Ruby "def name(" or "def name:"
  /^(\s*)class\s+([A-Za-z_]\w*)\b/, // Python / Ruby / JS / TS / Java-ish "class Name"
  /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/, // JS/TS function
  /^(\s*)func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, // Go
];

/** Markdown, falling back to bolded label lines when the document has no ATX heading at
 * all — see the module doc for why that fallback exists. */
function analyzeMarkdown(text) {
  const base = analyze(text);
  if (base.headings.length > 0) return base;

  const lines = text.split('\n');
  const headings = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = trimmed.match(BOLD_LABEL_RE);
    if (!m) continue;
    headings.push({ level: 1, title: m[1].trim(), line: i + 1 });
  }
  return { lines, headings, totalLines: lines.length, fences: [], tables: [] };
}

/** Any non-Markdown file: `def`/`function`/`class` lines, levelled by indentation so a
 * nested definition never swallows its own children's siblings. */
function analyzeCode(text) {
  const lines = text.split('\n');
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (const re of DEF_PATTERNS) {
      const m = lines[i].match(re);
      if (!m) continue;
      headings.push({ level: m[1].length, title: m[2], line: i + 1 });
      break;
    }
  }
  return { lines, headings, totalLines: lines.length, fences: [], tables: [] };
}

/** Parses `text` into `{ lines, headings, totalLines }` — the shape `rangeFor` needs —
 * choosing a flavour from `filePath`'s extension. */
export function analyzeDocument(text, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MARKDOWN_EXTS.has(ext) ? analyzeMarkdown(text) : analyzeCode(text);
}

/** One heading described for printing/JSON: its span (via the shared `rangeFor`) and the
 * source line exactly as written, untouched by whichever flavour found it. */
export function describeSection(analysis, heading) {
  const [startLine, endLine] = rangeFor(analysis, heading);
  return {
    startLine,
    endLine,
    level: heading.level,
    title: heading.title,
    headingLine: analysis.lines[heading.line - 1],
    body: analysis.lines.slice(startLine - 1, endLine).join('\n'),
  };
}

/** Every heading, in document order, described — what `--toc` prints. */
export function tableOfContents(analysis) {
  return analysis.headings.map((h) => describeSection(analysis, h));
}

/**
 * `query` against every heading's title — exact (case-insensitive, whole title) first,
 * then substring (case-insensitive) — the first tier with any hit at all wins, and *that*
 * tier's hit count is what decides found/ambiguous/not-found. Returns
 * `{ tier: 'exact'|'substring'|'none', headings: Heading[] }`.
 */
export function matchHeadings(headings, query) {
  const q = query.trim().toLowerCase();
  const exact = headings.filter((h) => h.title.trim().toLowerCase() === q);
  if (exact.length) return { tier: 'exact', headings: exact };
  const substring = headings.filter((h) => h.title.toLowerCase().includes(q));
  if (substring.length) return { tier: 'substring', headings: substring };
  return { tier: 'none', headings: [] };
}

/** Plain Levenshtein edit distance — used only to rank "nearest" suggestions on a miss,
 * never for matching itself. */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) row[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prevDiag = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, row[j], row[j - 1]);
      prevDiag = tmp;
    }
  }
  return row[n];
}

/** The `limit` headings whose title is textually closest to `query` — what a "not found"
 * answer names instead of a bare miss. */
export function nearestHeadings(headings, query, limit = 3) {
  const q = query.trim().toLowerCase();
  return headings
    .map((h) => ({ heading: h, distance: editDistance(q, h.title.toLowerCase()) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((r) => r.heading);
}

export function readFile(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}
