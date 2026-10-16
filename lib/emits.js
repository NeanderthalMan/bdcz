/**
 * `b7e-emits` — which line of code printed this, for a log line assembled from a
 * template.
 *
 * bc-dgx7.131 is the session audit: three sessions (`bc-xl7n.149`, `bc-xl7n.146`,
 * `bc-xl7n.150`) each needed the same fact — given a sentence observed in
 * `~/Library/Logs/beadcause.log` or on a console, which template literal in `lib/`
 * produced it — and plain grep cannot answer it, because the sentence is assembled
 * from a template and the *rendered* text is in no file. `bc-xl7n.149` fell back to a
 * fragment after five failed greps; `bc-xl7n.146` proved a negative (nothing is pinned
 * to two strings it was about to change) by hand, four empty greps; `bc-xl7n.150` read
 * three call sites by eye to see which one matched. See bc-dgx7.131's own description
 * for the verbatim commands each of those took.
 *
 * **Every template literal in `lib/`, not only the ones inside a `console.log(...)`
 * call.** A daemon line is usually built by `console.log` with the pieces already in
 * one template (`lib/advocate.js`'s `finish` — `` `[advocate] ${a.name}: ${w.id} —
 * ${why}` ``), but the interesting fragment is very often assembled several calls
 * earlier and only ever *arrives* at that `console.log` as one of its own
 * interpolations — `why` above is built at the call site as `` `the session exited
 * without closing it${ended.code ? ` (exit ${ended.code})` : ''}` `` and never touches
 * `console.log` directly. A search that only looked at `console.log`'s own arguments
 * would find the wrapper and nothing for the sentence actually asked about, which is
 * exactly the shape of bc-xl7n.146's second example. So this treats every template
 * literal in the tree as a candidate — the daemon eventually prints most of them one
 * way or another, and a candidate that cannot be matched costs nothing to have looked
 * at.
 *
 * **What "matches" means.** A template's literal segments (the text between its
 * `${...}` holes) are turned into an exact-text regex, and each hole becomes a
 * non-greedy wildcard capture. The observed text is tried two ways: anchored against
 * the whole thing (a *line* match — every hole is bound to a real span) and, failing
 * that, unanchored (a *fragment* match — plain grep's job, but literal-aware, so a
 * fragment that falls entirely inside one hole's neighbouring literal text is found
 * without needing to resolve any hole at all). A template that is only ever emptiness
 * plus a single hole (nothing to match a fragment against) is not a candidate — see
 * `MIN_LITERAL` below.
 *
 * **What this does not do.** It is not a JS parser; nested `${...}` and nested
 * backtick templates inside a hole are tracked by brace-depth and a backtick toggle,
 * the same bound `lib/pinned.js` documents for its own tokenizer, and a hole whose
 * expression itself contains an unbalanced or oddly-escaped literal can mis-locate the
 * hole's own end. It does not evaluate any expression — a hole's name is its source
 * text, verbatim, never its runtime value — and it does not follow a value through a
 * variable assigned three calls away the way `lib/pinned.js`'s `deriveHolders` does for
 * a different question. It fails in the quiet direction: a template it cannot match is
 * one you are back to grepping for by hand, not one it lies about.
 */
import fs from 'node:fs';
import path from 'node:path';
import { blankComments } from './evidence.js';
import { literalsIn } from './pinned.js';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The escapes this repo's own template literals actually use — a backslash before any
// other character is left alone (verbatim, backslash and all) rather than guessed at,
// which is the same "fails quiet" choice `lib/pinned.js` makes for its own tokenizer.
const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', '`': '`', $: '$', "'": "'", '"': '"' };
const unescape = (text) => text.replace(/\\(.)/g, (m, c) => (c in ESCAPES ? ESCAPES[c] : m));

/**
 * A template literal's inner content (between the backticks, exactly as `literalsIn`'s
 * `content` gives it) split into an ordered `{type: 'lit'|'expr', text}` list.
 *
 * `${` opens a hole; inside it, brace depth is tracked so a ternary
 * (`${bringBack ? 'parked' : 'closed'}`) or an object literal does not close it early.
 * A backtick inside the hole toggles a "we are inside a nested template" flag, and
 * while it is set, `{`/`}` are not counted at all — which is what lets a nested
 * template with its own hole (`` `(exit ${ended.code})` ``) sit inside an outer hole
 * without either level's braces confusing the other, the same net effect
 * `lib/pinned.js`'s own template tokenizer gets from tracking `holes`/`brace` together.
 */
export function segmentsOf(content) {
  const segments = [];
  let lit = '';
  let i = 0;
  const text = String(content);
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      lit += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === '$' && text[i + 1] === '{') {
      if (lit) segments.push({ type: 'lit', text: lit });
      lit = '';
      i += 2;
      let depth = 1;
      let inNested = false;
      const start = i;
      while (i < text.length && depth > 0) {
        const d = text[i];
        if (d === '\\') {
          i += 2;
          continue;
        }
        if (d === '`') {
          inNested = !inNested;
          i += 1;
          continue;
        }
        if (!inNested && d === '{') {
          depth += 1;
          i += 1;
          continue;
        }
        if (!inNested && d === '}') {
          depth -= 1;
          i += 1;
          continue;
        }
        i += 1;
      }
      segments.push({ type: 'expr', text: text.slice(start, i - 1) });
      continue;
    }
    lit += c;
    i += 1;
  }
  if (lit) segments.push({ type: 'lit', text: lit });
  return segments;
}

// A hole whose whole expression is a ternary between two plain string literals —
// `${bringBack ? 'parked' : 'closed'}` — can only ever render as one of those two
// strings, so it is matched as a two-way choice rather than an open wildcard. This is
// the difference between finding `lib/advocate.js`'s `finish` (57 near-identical
// `${a.name}: ${x} — ${y}` call sites, none of them naming which one printed a given
// line any more precisely than any other) and finding the one candidate that actually
// pins "parked" to a real branch of real code. Nothing here evaluates the *condition*
// — only that both branches are fixed text, so the rendered value is one of exactly two
// known strings regardless of which branch ran.
// The quote delimiter is `[\x27"]` rather than `['"]` on purpose: `lib/evidence.js`'s
// `blankComments` has no notion of a regex literal, so it reads a bare quote character
// anywhere in this file's own source — including inside a character class here — as the
// start or end of a real string. A `['"]` in this position desyncs its quote-tracking
// for the rest of the file: the first `'` opens a string that never really existed, the
// next `'` two character classes later closes it, and everything from there on is read
// one quote character out of phase, including every later `/** */` docblock, which is
// exactly how a comment in this file — of all files — would stop being read as one. See
// `test/b7eemits.mjs`, which pins this against `blankComments` directly.
const CHOICE_RE = /^[\s\S]*?\?\s*([\x27"])((?:\\.|(?!\1)[\s\S])*)\1\s*:\s*([\x27"])((?:\\.|(?!\3)[\s\S])*)\3$/;
function choiceOptionsOf(exprText) {
  const m = CHOICE_RE.exec(exprText.trim());
  return m ? [unescape(m[2]), unescape(m[4])] : null;
}

/**
 * Total non-whitespace characters across every literal segment, plus the shorter
 * branch of every two-way choice hole — how much of a template is pinned rather than
 * open, and so how specific a match against it actually is.
 */
export function literalWeight(segments) {
  return segments.reduce((n, s) => {
    if (s.type === 'lit') return n + s.text.replace(/\s/g, '').length;
    const choice = choiceOptionsOf(s.text);
    return choice ? n + Math.min(...choice.map((o) => o.replace(/\s/g, '').length)) : n;
  }, 0);
}

// A template with fewer literal characters than this is not a useful candidate: it is
// too close to "the whole line is a hole" to mean anything when matched, and would
// otherwise match almost any input by construction.
const MIN_LITERAL = 3;

// A template with more holes than this is not a log line — it is a multi-paragraph
// prompt being assembled (`lib/session.js`'s `workPromptFor` alone has 96) — and
// matching one of those against a short observed string is both meaningless (nobody
// pastes a whole brief as "the observed line") and expensive: an anchored regex built
// from dozens of non-greedy wildcard groups can force the engine through a large
// backtracking search on every candidate that does not match, of which there are
// thousands. Measured against this repo's own `lib/` (4978 templates, ~20 of them
// carrying more than eight holes): unbounded, `emitsReport` took over two minutes;
// capped at eight — comfortably more than any real daemon log line in this tree
// actually uses — a few hundred milliseconds.
const MAX_HOLES = 8;

/**
 * `{re, names}` for one template's segments — `re`'s source has one capture group per
 * hole, in order, and `names` is the hole's own source text (trimmed) at the same
 * index. Built without anchors; the caller decides whether to anchor for a line match
 * or leave it bare for a fragment search.
 */
export function templatePattern(segments) {
  let source = '';
  const names = [];
  for (const seg of segments) {
    if (seg.type === 'lit') {
      source += escapeRe(unescape(seg.text));
      continue;
    }
    const choice = choiceOptionsOf(seg.text);
    source += choice ? `(${choice.map(escapeRe).join('|')})` : '([\\s\\S]*?)';
    names.push(seg.text.trim());
  }
  return { source, names };
}

/**
 * Every template literal in `<root>/<dir>/*.js` (flat, not recursive — `lib/` has no
 * subdirectories today), comments blanked first so a docblock's own backtick-quoted
 * examples are not read as code. Each candidate: `{file, line, raw, segments}`, where
 * `raw` is the literal exactly as written, backticks included.
 */
export function candidateEmitters(root, dir = 'lib') {
  const full = path.join(root, dir);
  let files;
  try {
    files = fs.readdirSync(full).filter((f) => f.endsWith('.js')).sort();
  } catch {
    files = [];
  }
  const candidates = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(full, file), 'utf8');
    const blanked = blankComments(source);
    for (const lit of literalsIn(blanked)) {
      if (lit.kind !== 'template') continue;
      const segments = segmentsOf(lit.content);
      if (literalWeight(segments) < MIN_LITERAL) continue;
      if (segments.filter((s) => s.type === 'expr').length > MAX_HOLES) continue;
      const line = 1 + (blanked.slice(0, lit.index).match(/\n/g) || []).length;
      candidates.push({ file: path.join(dir, file), line, raw: lit.raw, segments });
    }
  }
  return candidates;
}

// A daemon log line carries a leading ISO-8601 stamp (`lib/logstamp.js`) that is never
// part of the template that produced the rest of the line — stripped before matching
// so a line pasted straight out of `~/Library/Logs/beadcause.log` matches the same way
// a bare console line would.
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z /;

/** `{name, value, index}` for each hole `names[i]` bound by capture group `i+1` of match `m` against `text`. */
function spansFrom(m, names, text) {
  const spans = [];
  let cursor = m.index;
  for (let i = 0; i < names.length; i += 1) {
    const value = m[i + 1];
    const at = text.indexOf(value, cursor);
    spans.push({ name: names[i], value, index: at === -1 ? cursor : at });
    cursor = at === -1 ? cursor : at + value.length;
  }
  return spans;
}

/**
 * Try `observed` against one candidate's segments. `null` if nothing at all lines up.
 * Otherwise `{mode: 'line'|'fragment', spans: [{name, value, index}]}` — `spans` in
 * template order, `index` into `observed` (after the stamp strip) so a caller can
 * render an annotated copy of it.
 *
 * Three shapes, tried in order, because a fragment can be *shorter* than the template
 * (bc-xl7n.149's whole opening question) or *longer* (it still contains the daemon's
 * own prefix and other lines' worth of text around the part that matters):
 *
 * 1. **`line`** — the whole template, anchored, consumes the whole (trimmed) observed
 *    text. Every hole is bound to a real span.
 * 2. **`fragment`, reverse** — `observed` itself is short enough to sit *inside* one of
 *    the template's own literal segments (bc-xl7n.146's "exited without closing" inside
 *    `` `the session exited without closing it${…}` ``'s literal run) — no hole is
 *    resolved, because none had to be.
 * 3. **`fragment`, forward** — some contiguous run of the template's segments,
 *    unanchored, is found somewhere inside `observed` — the ordinary case of a longer
 *    fragment that also happens to resolve one or more holes. The run covering the most
 *    segments wins, so a match through more of the template is preferred over one that
 *    only grazes a single literal at the edge.
 */
export function matchAgainst(observed, segments) {
  const text = String(observed).replace(STAMP_RE, '');
  const trimmed = text.trim();

  const { source, names } = templatePattern(segments);
  if (source) {
    const m = new RegExp(`^${source}$`).exec(trimmed);
    if (m) return { mode: 'line', spans: spansFrom(m, names, text), matchedText: m[0] };
  }

  if (trimmed) {
    for (const seg of segments) {
      if (seg.type !== 'lit') continue;
      if (unescape(seg.text).includes(trimmed)) return { mode: 'fragment', spans: [], matchedText: trimmed };
    }
  }

  // A forward window with no hole at all is indistinguishable from plain substring
  // search — `` `now` `` "matching" inside "no**w**here" is not a finding, it is noise
  // — so a window only qualifies here if it actually resolves at least one hole, and to
  // a higher literal bar than `MIN_LITERAL`: a wildcard can match zero characters, so a
  // short literal beside one (`` `his ` `` matching inside "t**his** string…") is just
  // as weak a signal as the no-hole case.
  let best = null;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = segments.length; j > i; j -= 1) {
      const window = segments.slice(i, j);
      if (!window.some((s) => s.type === 'expr')) continue;
      if (literalWeight(window) < MIN_PINNED) continue;
      const built = templatePattern(window);
      if (!built.source) continue;
      const m = new RegExp(built.source).exec(text);
      if (!m) continue;
      if (!best || j - i > best.width) best = { width: j - i, spans: spansFrom(m, built.names, text), matchedText: m[0] };
      break; // widest window starting at i that matches — a narrower one from the same i adds nothing
    }
  }
  if (best) return { mode: 'fragment', spans: best.spans, matchedText: best.matchedText };

  return null;
}

/**
 * `observed` annotated in place: each hole's captured span replaced with
 * `[value=${expr}]`, left to right, so `"worker"` bound to `${rec.kind}` prints as
 * `[worker=${rec.kind}]` at the position it actually occupied.
 */
export function annotate(observed, spans) {
  const text = String(observed).replace(STAMP_RE, '');
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.index < cursor) continue; // overlapping/unresolved span — leave the text as-is around it
    out += text.slice(cursor, span.index);
    out += `[${span.value}=\${${span.name}}]`;
    cursor = span.index + span.value.length;
  }
  out += text.slice(cursor);
  return out;
}

// A segment shorter than this is too common to mean "this file is pinned to this
// template" — `lib/pinned.js` draws the same kind of line for its own literals.
const MIN_PINNED = 6;

/**
 * `{rel, text}` for every file under each of `dirs`, read once per `(root, dirs)` pair
 * and cached for the life of the process — one call's worth of candidates typically
 * shares the same handful of boilerplate literal text (`lib/advocate.js`'s `finish`
 * alone accounts for dozens of candidates sharing `"[advocate] "`), and without this
 * every one of them would re-read the whole of `test/` and `public/` from disk.
 */
const corpusCache = new Map();
function corpusOf(root, dirs) {
  const key = `${root}\0${dirs.join(',')}`;
  if (corpusCache.has(key)) return corpusCache.get(key);
  const files = [];
  for (const dir of dirs) {
    const full = path.join(root, dir);
    let names;
    try {
      names = fs.readdirSync(full).filter((f) => f.endsWith('.mjs') || f.endsWith('.js'));
    } catch {
      continue;
    }
    for (const file of names) {
      try {
        files.push({ rel: path.join(dir, file), text: fs.readFileSync(path.join(full, file), 'utf8') });
      } catch {
        continue;
      }
    }
  }
  corpusCache.set(key, files);
  return files;
}

/**
 * Every `test/*.mjs` or `public/*.js` file that carries one of `segments`' literal
 * substrings verbatim — bc-xl7n.146's four hand-run greps, in one call. Whitespace-only
 * or short (`< MIN_PINNED` non-space characters) literal segments are skipped, the same
 * way a hole with too little literal text is not a candidate at all.
 */
export function pinnedByOf(root, segments, dirs = ['test', 'public']) {
  const needles = [...new Set(segments.filter((s) => s.type === 'lit').map((s) => unescape(s.text)))].filter(
    (t) => t.replace(/\s/g, '').length >= MIN_PINNED
  );
  if (!needles.length) return [];
  const hits = new Set();
  for (const { rel, text } of corpusOf(root, dirs)) {
    if (needles.some((n) => text.includes(n))) hits.add(rel);
  }
  return [...hits].sort();
}

/**
 * The whole answer: every candidate emitter in `<root>/<dir>` that matches `observed`,
 * each with its match mode, its annotated rendering, and its `pinnedBy` list — sorted
 * so a whole-line match comes before a fragment match, and within a tier, the template
 * with the most literal text (the most specific match) comes first.
 */
export function emitsReport(root, observed, { dir = 'lib' } = {}) {
  const candidates = candidateEmitters(root, dir);
  const found = [];
  for (const c of candidates) {
    const m = matchAgainst(observed, c.segments);
    if (!m) continue;
    found.push({
      file: c.file,
      line: c.line,
      raw: c.raw,
      mode: m.mode,
      spans: m.spans,
      annotated: annotate(observed, m.spans),
      pinnedBy: pinnedByOf(root, c.segments),
      weight: literalWeight(c.segments),
    });
  }
  found.sort((a, b) => (a.mode === b.mode ? b.weight - a.weight : a.mode === 'line' ? -1 : 1));
  return found.map(({ weight, ...rest }) => rest);
}
