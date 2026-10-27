/**
 * For one `b7e-*` command: is it granted or withheld from `dispatch`, and which paragraph
 * decided it — `bin/b7e-grants` is the argv shell; this is the reading.
 *
 * bc-dgx7.111, filed by the session audit against six sessions (bc-dgx7.87, bc-dgx7.90,
 * bc-dgx7.92, bc-dgx7.91, bc-dgx7.86, bc-dgx7.97) that each had to decide whether the
 * command they had just written belongs on `DEFAULT_TOOL_LIST` and each found the
 * precedent by guessing which siblings were analogous and reading the registry at random
 * offsets — `sed -n 400,470p`, a `grep` of a file that did not exist yet, a `find .
 * -iname grants.js`. Every one of those guesses is now a single, cheap read.
 *
 * **The bead was filed against an architecture bc-wbrhi replaced the day it landed.**
 * Six of these sessions predate bc-wbrhi: back then the decision — granted, or
 * deliberately withheld, or never decided at all — lived in `lib/toolbelt.js`'s prose,
 * found by whether a command's bare name occurred in it at all, which is exactly the
 * substring trap bc-dgx7.90 spent a whole session on (`b7e-run`'s own paragraph
 * mentioning `b7e-hunks` in passing made `b7e-hunks` read as "decided" when nobody had
 * decided anything about it). Since bc-wbrhi, **the decision is the command's own
 * `@grant read|write|excluded` header line** (`lib/tooldecl.js`), and nothing else — a
 * name turning up inside another command's reasoning is never a decision, only a
 * mention. `grantVerdict` below reads the header line and nothing but the header line for
 * `status`; a paragraph in that same header arguing the decision is attached only as
 * *why*, for a command already decided the other way, and a bare mention for an
 * undecided one is kept clearly separate as `mention`, never folded into `status`.
 *
 * **Granted or excluded, the file:line that decided it is `bin/<name>`'s own `@grant`
 * line.** That is the actual decision now, so it is reported for every declared command,
 * granted or withheld alike. For a withheld command the *why* sits in the same header,
 * directly above that line: bc-fmk4v moved every grant argument out of `lib/tooldecl.js`
 * into the tool's own header (`test/pertoolfiles.mjs` keeps it there), so `reason` below
 * is read from `bin/<name>` and nowhere else. A withheld command whose header carries no
 * paragraph naming it is a real, reportable gap rather than a bug in this reader —
 * `reason: null` says so rather than guessing at one.
 *
 * **Paragraph-finding is regex over the header's comment text, not a parser**, because
 * those paragraphs are prose written by hand across forty-odd sessions and have no
 * machine-checked structure beyond one sentence. It looks for the fixed phrase
 * `is|are (also) deliberately NOT on this list|DEFAULT_TOOL_LIST` — the wording the moved
 * paragraphs open with and the one `lib/enroll.js`'s applier writes for every new one —
 * immediately preceded by the command's own name (optionally with a `(bc-...)` bead id,
 * optionally joined to a second name by `and`). Two things make this safe rather than a
 * second copy of the old substring trap: the name has to sit *immediately* before the
 * fixed phrase, not merely appear somewhere nearby, and the result only ever becomes a
 * `reason` for a command whose own `@grant` line already decided it — never the deciding
 * signal itself. Failing a name-led paragraph, the header's first paragraph that passes
 * `test/pertoolfiles.mjs`'s own `deliberately (NOT on|excluded)` test is the reason
 * (`ownHeaderParagraph`) — safe only because it is the tool's own header.
 */
import fs from 'node:fs';
import path from 'node:path';

import { candidateNames } from './which.js';
import { readDeclarations } from './tooldecl.js';

/** The `@grant <kind>` line's own line number in a command's source, 1-based — the same
 * pattern `lib/tooldecl.js`'s private `GRANT_RE` reads, kept here rather than exported
 * from there so this file never has to change when that one's internals do. */
function grantLineNumber(src) {
  const lines = String(src ?? '').split('\n');
  // `@grant write: <why>` carries its reason on the same line, as GRANT_RE allows.
  const re = /^[ \t]*(?:\*|\/\/)?[ \t]*@grant[ \t]+[^\s:]+(?::[ \t]*.+?)?[ \t]*$/;
  const idx = lines.findIndex((l) => re.test(l));
  return idx === -1 ? null : idx + 1;
}

/** The line a bare name first turns up on in `text` — informational, never a decision. */
function firstMentionLine(text, name) {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const lines = String(text ?? '').split('\n');
  const idx = lines.findIndex((l) => re.test(l));
  return idx === -1 ? null : idx + 1;
}

const NAME_GROUP = '(?:b7e-[\\w-]+(?:\\s*\\(bc-[\\w.-]+\\))?)';
const HEADER_RE = new RegExp(
  `(${NAME_GROUP}(?:\\s*(?:,\\s*|and\\s+)${NAME_GROUP})*)\\s+(?:is|are)\\s+(?:also\\s+)?deliberately NOT on (?:this list|\`?DEFAULT_TOOL_LIST\`?)[.,:]?`,
  'g'
);
const ARROW_RE = /→ Bash\(([\w.-]+):\*\)/g;

/**
 * Comment text flattened into one string, one source line's text after another (a leading
 * `//`, `*`, `/**` or `*\/` stripped, joined with spaces so a phrase split across a line
 * wrap still matches), with an offset table back to the real line numbers and the offset
 * of every blank comment line — a paragraph break, which ends a paragraph.
 */
function flatten(text) {
  const lines = String(text ?? '').split('\n');
  let acc = '';
  const offsets = [];
  const breaks = [];
  for (const raw of lines) {
    offsets.push(acc.length);
    const body = raw.replace(/^[ \t]*(?:\/\*\*?|\*\/|\*|\/\/)[ \t]?/, '');
    if (!body.trim()) breaks.push(acc.length);
    acc += body + ' ';
  }
  return { acc, offsets, breaks };
}

function lineForOffset(offsets, pos) {
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= pos) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1;
}

/**
 * Every withheld command `text` (a tool's own header, in practice) has a paragraph for,
 * keyed by name: `{ line, text }`, `text` trimmed and whitespace-collapsed, capped at 500
 * characters (a paragraph's own next boundary — a blank comment line, the next such
 * header, or an arrow line ending a granted one — usually arrives well before that; the
 * cap is only a backstop against two paragraphs run together with no marker between).
 */
export function excludedParagraphs(text) {
  const { acc, offsets, breaks } = flatten(text);
  const headers = [];
  let m;
  const headerRe = new RegExp(HEADER_RE.source, 'g');
  while ((m = headerRe.exec(acc))) {
    const names = [...m[1].matchAll(/b7e-[\w-]+/g)].map((x) => x[0]);
    headers.push({ start: m.index, end: m.index + m[0].length, names });
  }
  const arrowRe = new RegExp(ARROW_RE.source, 'g');
  const boundaries = [...breaks, ...headers.map((h) => h.start)];
  while ((m = arrowRe.exec(acc))) boundaries.push(m.index);
  boundaries.sort((a, b) => a - b);

  const byName = {};
  for (const h of headers) {
    let nextStart = acc.length;
    for (const b of boundaries) {
      if (b >= h.end && b < nextStart) nextStart = b;
    }
    const body = acc
      .slice(h.end, Math.min(nextStart, h.end + 500))
      .trim()
      .replace(/\s+/g, ' ');
    const line = lineForOffset(offsets, h.start);
    for (const name of h.names) byName[name] = { line, text: body };
  }
  return byName;
}

/**
 * The paragraph of a tool's own header that argues its exclusion when none opens with the
 * tool's name — "Deliberately NOT on `DEFAULT_TOOL_LIST`: …", "deliberately excluded from
 * the auto-run …". Only ever applied to the tool's own header, where every such paragraph
 * is about the tool itself, and found by the same test `test/pertoolfiles.mjs` uses to say
 * an excluded tool argued its decision at all. `{ line, text }` or null.
 */
function ownHeaderParagraph(header) {
  const { acc, offsets, breaks } = flatten(header);
  const m = /deliberately (NOT on|excluded)/i.exec(acc);
  if (!m) return null;
  let start = 0;
  let end = acc.length;
  for (const b of breaks) {
    if (b <= m.index && b > start) start = b;
    if (b > m.index && b < end) end = b;
  }
  const text = acc.slice(start, Math.min(end, start + 500)).trim().replace(/\s+/g, ' ');
  const line = lineForOffset(offsets, start + (acc.slice(start).length - acc.slice(start).trimStart().length));
  return { line, text };
}

/**
 * Everything known about `name`: `status` is `'granted'`, `'withheld'` or `'undecided'`,
 * read from nothing but the command's own `@grant` line (or its absence) — see this
 * file's own header for why that is the only thing allowed to set it.
 *
 *   granted:   { status: 'granted',   kind, decidedAt: { file, line } }
 *   withheld:  { status: 'withheld',  kind: 'excluded', decidedAt: { file, line },
 *                reason: { file: 'bin/<name>', line, text } | null }
 *   undecided: { status: 'undecided', kind: null, decidedAt: null,
 *                mention: { file: 'lib/tooldecl.js', line } | null }
 *
 * `root` is a parameter, not a fixed checkout, for the same reason every other `b7e-*`
 * reader takes one: a suite has to be able to drive this against a fixture instead of the
 * real repo, which is the only tree this could otherwise be shown passing against.
 */
export function grantVerdict(root, name) {
  const bin = path.join(root, 'bin');
  const { declared } = readDeclarations(bin);
  const found = declared.find((d) => d.name === name);
  const file = found ? path.join(bin, found.file) : path.join(bin, name);
  let src = '';
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    // No file at all — reported as undecided below, same as a file with no @grant line.
  }
  const relFile = path.relative(root, file);

  if (!found) {
    let mention = null;
    try {
      const tooldeclText = fs.readFileSync(path.join(root, 'lib', 'tooldecl.js'), 'utf8');
      const line = firstMentionLine(tooldeclText, name);
      if (line) mention = { file: 'lib/tooldecl.js', line };
    } catch {
      // No lib/tooldecl.js under this root (a bare fixture tree) — no mention to report.
    }
    return { name, status: 'undecided', kind: null, decidedAt: null, mention };
  }

  const line = grantLineNumber(src);
  const decidedAt = line ? { file: relFile, line } : null;

  if (found.kind === 'read' || found.kind === 'write') {
    return { name, status: 'granted', kind: found.kind, decidedAt };
  }

  // excluded — the why is in the same header, above the @grant line (bc-fmk4v).
  const header = line ? src.split('\n').slice(0, line - 1).join('\n') : src;
  const p = excludedParagraphs(header)[name] || ownHeaderParagraph(header);
  const reason = p ? { file: relFile, line: p.line, text: p.text } : null;
  return { name, status: 'withheld', kind: 'excluded', decidedAt, reason };
}

/** Every candidate `b7e-*` command under `root`, name-sorted, each with its verdict —
 * the same candidate union `b7e-enroll` and `b7e-which` already use. */
export function allVerdicts(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return candidateNames(root, pkg).map((name) => grantVerdict(root, name));
}

export { grantLineNumber };
