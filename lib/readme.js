/**
 * Where in the specification something belongs — `bin/b7e-readme` is the argv shell; this
 * is the parsing and the matching.
 *
 * Everything down to "the whole set" operates on **one** document's text and is unchanged
 * by bc-28jtc's split; the set layer at the bottom is what knows there are now eighteen of
 * them (`README.md` plus `docs/*.md`, per `lib/docset.js`).
 *
 * bc-khoe.46 names six sessions (`bc-b4fs.1`, `bc-ka5y.15.1`, `bc-dgx7.5`, `bc-y8k4.2`,
 * `bc-xl7n.55`, `bc-mtdb`) that each hand-wrote four to ten greps against a 24,000+ line
 * file to answer the same three questions: which section, what line range, what anchor
 * slug. No two sessions used the same dialect, and one (`bc-ka5y.15.1`) lost a call to
 * shell quoting before landing on `awk -F: '$1>19290 && $1<19430'`. `test/anchors.mjs`
 * already validates the slug this produces; nothing before this found the place to put it.
 *
 * **Two search modes, chosen by how many terms are given.** One term: report every
 * section that mentions it, one row per distinct *innermost* heading, in document order
 * — this is `--for <path>` and the plain single-word case. Two or more terms: report the
 * smallest heading whose whole subtree contains at least one occurrence of *every* term —
 * a lowest-common-ancestor search, not a per-line grep. That second mode is the one that
 * actually answers `bc-b4fs.1`'s question: "bind" is in the router's own opening
 * paragraphs (`a backend that binds in ~2s`) and "tailnet" is two subsections down (`off
 * loopback from the router or straight off the tailnet`) — no single grep line has both,
 * but `## The router — why you never restart it` is the smallest heading that contains
 * both, and that is the section every one of those six sessions was actually hunting for.
 * When no heading contains every term, this falls back to the single-term behaviour, once
 * per term, rather than silently answering "found nothing" — a set of terms that never
 * shares a section is still real information, and the caller can see where each one landed.
 *
 * **A hit is flagged by what it fell inside**, because a `bin/b7e-apply` edit to prose, a
 * fenced ASCII sketch and an `/api/` table row are three different shapes of edit.
 * `'sketch'` is a fenced block (no dedicated language, since this repo's diagrams are
 * plain ``` fences) whose content carries a box-drawing, arrow or pictograph character —
 * `│ ● ▾ ⚙ ⟳` and friends. `'table'` is a line inside a contiguous run of `| ... |` rows
 * that starts with a header and a `|---|` separator, which is what every row of the HTTP
 * API reference is. Anything else fenced is `'code'` (a shell snippet, a JSON blob).
 * Everything else is `'prose'`.
 *
 * **The slug is GitHub's rule**, the same one `test/anchors.mjs` already enforces:
 * lowercase, drop everything that is not a word character, a hyphen or a space, then turn
 * spaces into hyphens. An em dash is punctuation, so it is *dropped* rather than replaced
 * — the two spaces either side of it both become hyphens, which is why `## A second
 * instance — observer mode` slugs to `#a-second-instance--observer-mode`, with two.
 * `test/anchors.mjs` imports this same function rather than keeping its own copy, so the
 * two can no longer drift the way its own header used to warn they might.
 *
 * **What this does not do.** Headings inside fenced code (a `#comment` in a shell
 * snippet) are blanked out before the heading scan, the same way `test/anchors.mjs`
 * blanks them — a real Markdown parser would be sturdier, but this repo's own documents are
 * disciplined about `#{1,6} ` at the start of a line and nothing else needs one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocs, SUMMARY } from './docset.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(HERE, '..');

/** Characters this repo's ASCII sketches actually use — arrows (U+2190-21FF), box
 * drawing through dingbats (U+2500-27BF, a contiguous run that also covers block
 * elements, geometric shapes and misc symbols), and misc symbols/arrows-B (U+2B00-2BFF).
 * Deliberately not "any emoji": a shell snippet with a stray character in a comment
 * should not be mistaken for a sketch. Written as \u escapes rather than literal glyphs
 * so the range boundaries are auditable rather than trusted to render correctly. */
const SKETCH_CHAR_RE = /[\u2190-\u21FF\u2500-\u27BF\u2B00-\u2BFF]/;

/** GitHub's heading slug: lowercased, punctuation dropped, spaces to hyphens. Identical
 * to the rule `test/anchors.mjs` enforces — that file imports this rather than keeping
 * its own copy. */
export function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .replace(/ /g, '-');
}

export function readmePath(dir = REPO_ROOT) {
  return path.join(dir, 'README.md');
}

/**
 * Parses `text` (one document's contents) into headings, fenced blocks and table blocks —
 * everything the rest of this file needs, computed once so a search never re-scans.
 */
export function analyze(text) {
  const lines = text.split('\n');

  // Fenced blocks blanked out before the heading scan, same as test/anchors.mjs, so a
  // '#' at the start of a line inside a shell snippet or sketch is never mistaken for a
  // heading.
  const fences = [];
  const proseLines = lines.slice();
  {
    let open = null; // { contentStart (1-based), buf: [] }
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (open === null) {
        if (trimmed.startsWith('```')) {
          open = { contentStart: i + 2, buf: [] };
          proseLines[i] = '';
        }
        continue;
      }
      if (trimmed.startsWith('```')) {
        const contentEnd = i; // 1-based line before the closing fence
        fences.push({
          startLine: open.contentStart,
          endLine: contentEnd,
          isSketch: SKETCH_CHAR_RE.test(open.buf.join('\n')),
        });
        for (let l = open.contentStart - 1; l < contentEnd; l += 1) proseLines[l] = '';
        proseLines[i] = '';
        open = null;
        continue;
      }
      open.buf.push(lines[i]);
    }
  }
  const prose = proseLines.join('\n');

  const headings = [];
  for (const m of prose.matchAll(/^(#{1,6}) +(.+)$/gm)) {
    const line = prose.slice(0, m.index).split('\n').length;
    headings.push({ level: m[1].length, title: m[2].trim(), line, slug: slug(m[2]) });
  }

  // Table blocks: a contiguous run of ASCII '|...|' lines whose second line is a bare
  // separator ('|---|---|'). Deliberately scanned outside fenced ranges only, so a
  // sketch's box-drawing '│' (not the ASCII pipe) is never mistaken for one.
  const inFence = (lineNo) => fences.some((f) => lineNo >= f.startLine - 1 && lineNo <= f.endLine);
  const tableLineRe = /^\s*\|.*\|\s*$/;
  const sepLineRe = /^\s*\|?[\s:|-]+\|?\s*$/;
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    if (inFence(lineNo)) continue;
    if (!tableLineRe.test(lines[i])) continue;
    if (i + 1 >= lines.length || !sepLineRe.test(lines[i + 1]) || !tableLineRe.test(lines[i + 1])) continue;
    const start = lineNo;
    let j = i;
    while (j < lines.length && tableLineRe.test(lines[j]) && !inFence(j + 1)) j += 1;
    tables.push({ startLine: start, endLine: j });
    i = j - 1;
  }

  return { lines, headings, fences, tables, totalLines: lines.length };
}

/** 'sketch' | 'code' | 'table' | 'prose' for one 1-based line number. */
export function kindAt(analysis, lineNo) {
  const fence = analysis.fences.find((f) => lineNo >= f.startLine && lineNo <= f.endLine);
  if (fence) return fence.isSketch ? 'sketch' : 'code';
  if (analysis.tables.some((t) => lineNo >= t.startLine && lineNo <= t.endLine)) return 'table';
  return 'prose';
}

/** Every 1-based line number containing `term` (case-insensitive substring), optionally
 * restricted to lines whose kind is 'sketch'. */
export function findOccurrences(analysis, term, { sketchOnly = false } = {}) {
  const needle = term.toLowerCase();
  const out = [];
  for (let i = 0; i < analysis.lines.length; i += 1) {
    if (!analysis.lines[i].toLowerCase().includes(needle)) continue;
    const lineNo = i + 1;
    if (sketchOnly && kindAt(analysis, lineNo) !== 'sketch') continue;
    out.push(lineNo);
  }
  return out;
}

/** The nearest heading at or before `lineNo` — the innermost section containing it, or
 * `null` if the line is above every heading (front matter). */
export function headingFor(analysis, lineNo) {
  let found = null;
  for (const h of analysis.headings) {
    if (h.line > lineNo) break;
    found = h;
  }
  return found;
}

/** The full subtree range of `heading`: its own line through the line before the next
 * heading at the same or a shallower level (or end of file). Always a superset of every
 * descendant heading's own range, which is what makes it safe to use as the containment
 * test for the multi-term search below. */
export function rangeFor(analysis, heading) {
  const idx = analysis.headings.indexOf(heading);
  for (let i = idx + 1; i < analysis.headings.length; i += 1) {
    if (analysis.headings[i].level <= heading.level) return [heading.line, analysis.headings[i].line - 1];
  }
  return [heading.line, analysis.totalLines];
}

/** `heading` plus every ancestor above it, in document order — what prints as the
 * `## → ### → ####` path. */
export function pathFor(analysis, heading) {
  const idx = analysis.headings.indexOf(heading);
  const out = [heading];
  let level = heading.level;
  for (let i = idx - 1; i >= 0; i -= 1) {
    const h = analysis.headings[i];
    if (h.level < level) {
      out.unshift(h);
      level = h.level;
    }
    if (level <= 1) break;
  }
  return out;
}

function describeHeading(analysis, heading, occurrenceLines) {
  const [startLine, endLine] = rangeFor(analysis, heading);
  const kinds = new Set();
  for (const lineNo of occurrenceLines) {
    if (lineNo >= heading.line && lineNo <= endLine) kinds.add(kindAt(analysis, lineNo));
  }
  return {
    heading,
    path: pathFor(analysis, heading),
    startLine,
    endLine,
    slug: heading.slug,
    kinds: [...kinds].sort(),
  };
}

/**
 * The core of `b7e-readme <term> ...`. Returns `{ mode, sections }`:
 *
 * - `mode: 'each'` (one term, or terms that share no common section): one entry per
 *   distinct innermost heading that contains at least one occurrence, in document order.
 * - `mode: 'lca'` (two or more terms that do share one): a single entry, the smallest
 *   heading whose subtree contains every term at least once.
 *
 * `sketchOnly` restricts which lines count as an occurrence at all — see `--sketch`.
 */
export function searchSections(analysis, terms, { sketchOnly = false } = {}) {
  const occByTerm = terms.map((t) => findOccurrences(analysis, t, { sketchOnly }));

  const each = () => {
    const allLines = [...new Set(occByTerm.flat())].sort((a, b) => a - b);
    const byHeading = new Map();
    for (const lineNo of allLines) {
      const h = headingFor(analysis, lineNo);
      if (!h) continue;
      if (!byHeading.has(h)) byHeading.set(h, []);
      byHeading.get(h).push(lineNo);
    }
    const sections = [...byHeading.entries()]
      .sort((a, b) => a[0].line - b[0].line)
      .map(([h, lines]) => describeHeading(analysis, h, lines));
    return { mode: 'each', sections };
  };

  if (terms.length < 2) return each();
  if (occByTerm.some((lines) => lines.length === 0)) return each();

  // Level 1 is the document's own title (`# Beadcause`), not a real section — its
  // "subtree" is the whole file, which would make it a valid but useless answer to
  // every multi-term query nothing more specific covers. Excluded here so that case
  // falls through to the per-term fallback below instead.
  const candidates = analysis.headings
    .filter((h) => h.level >= 2)
    .map((h) => {
      const [s, e] = rangeFor(analysis, h);
      const allPresent = occByTerm.every((lines) => lines.some((l) => l >= s && l <= e));
      return allPresent ? { h, s, e, span: e - s } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.span - b.span);

  if (!candidates.length) return each();

  const best = candidates[0];
  const anchoring = occByTerm.map((lines) => lines.find((l) => l >= best.s && l <= best.e));
  const section = describeHeading(analysis, best.h, anchoring);
  return { mode: 'lca', sections: [section] };
}

/** Every heading whose slug is exactly `query` — GitHub itself resolves an ambiguous
 * slug to the first one in document order (see test/anchors.mjs's own "no link points at
 * a slug more than one heading produces" check), so document order is the meaningful
 * order here too. */
export function findByAnchor(analysis, query) {
  const wanted = query.replace(/^#/, '');
  return analysis.headings.filter((h) => h.slug === wanted).map((h) => describeHeading(analysis, h, []));
}

export function readReadme(dir = REPO_ROOT) {
  return fs.readFileSync(readmePath(dir), 'utf8');
}

/* ------------------------------------------------------------------ the whole set */

/**
 * bc-28jtc split the one 40,211-line README into `README.md` plus `docs/*.md`, and every
 * function above still does exactly what it did — to **one** document. What changes is
 * which documents there are, so the set layer below fans those out and merges, rather than
 * re-implementing any of the matching.
 *
 * **Why the fan-out is not just "call `searchSections` per file and concatenate".** The
 * two-or-more-terms mode is a lowest-common-ancestor search, and `searchSections` falls
 * back to per-term reporting when *its* document contains no section holding every term.
 * Concatenating would therefore mix one file's real LCA answer with fifteen files' fallback
 * noise, and the fallback rows would outnumber the answer. So the set decides the mode
 * once, for the set: if any document has a section containing every term, the smallest such
 * section anywhere wins and nothing else is reported; only when no document does at all
 * does the whole set fall back to per-term reporting.
 *
 * **Document order is set order**, which `lib/docset.js` fixes as the summary first and
 * then `docs/` by filename — so "the first place this is mentioned" names the summary
 * before it names a chapter, and two runs of the same query agree.
 *
 * ## The summary answers only when no chapter does
 *
 * `README.md` is an index: a table with one row per document, and each row names that
 * document's subjects. That makes it, by construction, the smallest section in the set
 * mentioning almost any *pair* of terms — the first run of this after the split answered
 * `router tailnet` with `README.md:57-85 (table) #the-documentation`, which is true, and
 * is the one answer that helps nobody. It is the same failure the level-1 exclusion above
 * was written for, arriving by a different route: a section whose subject is "all of
 * them" is a valid container and a useless address.
 *
 * So the summary is consulted only when no chapter matches at all. That is a rule about
 * what this tool is for rather than a special case about tables — the question is where a
 * thing belongs, and a line that points at the chapter is never the place it belongs. A
 * term the summary alone mentions is still found, because then there is no chapter to
 * prefer and the summary is the honest answer.
 */

/** `[{ file, analysis }]` for the whole specification, in `docFiles` order. */
export function analyzeSet(dir = REPO_ROOT) {
  return readDocs(dir).map(({ file, text }) => ({ file, analysis: analyze(text) }));
}

/** Tag a section with the document it came from, so a caller can print `file:line`. */
const inFile = (file, section) => ({ ...section, file });

/**
 * `searchSections` over every document — see the note above for why the mode is decided
 * for the set rather than per file. Sections carry a `file`.
 */
export function searchSet(docs, terms, { sketchOnly = false } = {}) {
  const all = docs.map(({ file, analysis }) => ({
    file,
    analysis,
    occByTerm: terms.map((t) => findOccurrences(analysis, t, { sketchOnly })),
  }));

  // See "The summary answers only when no chapter does" above.
  const chapters = all.filter((d) => d.file !== SUMMARY);
  const hits = (d) => d.occByTerm.some((lines) => lines.length > 0);
  const perFile = chapters.some(hits) ? chapters : all;

  const each = () => {
    const sections = [];
    for (const { file, analysis, occByTerm } of perFile) {
      const allLines = [...new Set(occByTerm.flat())].sort((a, b) => a - b);
      const byHeading = new Map();
      for (const lineNo of allLines) {
        const h = headingFor(analysis, lineNo);
        if (!h) continue;
        if (!byHeading.has(h)) byHeading.set(h, []);
        byHeading.get(h).push(lineNo);
      }
      for (const [h, lines] of [...byHeading.entries()].sort((a, b) => a[0].line - b[0].line)) {
        sections.push(inFile(file, describeHeading(analysis, h, lines)));
      }
    }
    return { mode: 'each', sections };
  };

  if (terms.length < 2) return each();

  // The smallest section, anywhere in the set, whose subtree holds every term. Level 1 is
  // a document's own title, whose subtree is the whole file — excluded for the same reason
  // the single-document search excludes it.
  let best = null;
  for (const { file, analysis, occByTerm } of perFile) {
    if (occByTerm.some((lines) => lines.length === 0)) continue;
    for (const h of analysis.headings) {
      if (h.level < 2) continue;
      const [s, e] = rangeFor(analysis, h);
      if (!occByTerm.every((lines) => lines.some((l) => l >= s && l <= e))) continue;
      const span = e - s;
      if (!best || span < best.span) best = { file, analysis, h, s, e, span, occByTerm };
    }
  }
  if (!best) return each();

  const anchoring = best.occByTerm.map((lines) => lines.find((l) => l >= best.s && l <= best.e));
  return { mode: 'lca', sections: [inFile(best.file, describeHeading(best.analysis, best.h, anchoring))] };
}

/**
 * `findByAnchor` over every document. A slug that names a heading in two different
 * documents is not ambiguous to a reader — a browser resolves a fragment inside the page
 * it is already on — so every hit is returned with its file and the caller decides.
 */
export function findByAnchorSet(docs, query) {
  const out = [];
  for (const { file, analysis } of docs) {
    for (const s of findByAnchor(analysis, query)) out.push(inFile(file, s));
  }
  return out;
}
