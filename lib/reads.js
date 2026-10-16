/**
 * `b7e-reads` — which `test/*.mjs` suites `readFileSync` a `lib/` or `bin/` file's
 * source and assert regexes or literals against the text, so a rename or a restructure
 * can be checked against the list before it ships rather than after the gate does.
 *
 * bc-dgx7.114 is the audit: five sessions (bc-7qo.9, bc-arj0.23, bc-2uj4.9, bc-dgx7.16,
 * bc-dgx7.15) each independently guessed which static-read suites a `lib/`/`bin/` edit
 * would trip, and each guessed a different subset — bc-2uj4.9 guessed wrong and found
 * out from a red `test/surveybrief.mjs` in the full gate, after which it had to grep the
 * guard by hand, rename across four files, and re-run. This is the read that would have
 * told it first.
 *
 * WHAT COUNTS AS "READING THIS FILE AS TEXT". A statement, anywhere in `test/*.mjs`,
 * whose `.readFileSync(...)` call's first argument names this file — either the exact
 * basename as its own string literal (`'advocate.js'`, reached directly, through a
 * `path.join(...)` pair, or through a locally defined `LIB('advocate.js')`-style
 * helper — `literalsIn` finds the inner literal regardless of how many calls wrap it),
 * or the file's relative path joined with `/` (`'lib/advocate.js'`) as one literal —
 * confirmed against a second, independent literal in the same statement naming the
 * file's own directory as a whole word (`\blib\b`, `\bbin\b` — matching the literal
 * `'lib'`, a `LIB` helper's name, or a combined `'lib/advocate.js'` literal that already
 * contains it), so a basename collision with an unrelated `lib/`/`bin/` file elsewhere
 * does not silently match. The declared local this statement binds — a plain `const
 * NAME = fs.readFileSync(...)` is the only shape the corpus uses for this — seeds
 * `deriveHolders` (from `lib/pinned.js`, unchanged: any further local a later statement
 * derives from an existing holder's text, one hop per pass, joins the set too), so
 * `code = blankComments(daemon)` is traced the same way `test/surveybrief.mjs` traces
 * it.
 *
 * WHAT SHAPE A FINDING IS FLAGGED WITH. `IDENTIFIER-FAMILY` — a regex pinned against a
 * holder whose source contains a `\w` class, so it is collecting a *family* of names
 * sharing a prefix rather than one exact word (`/heldBy\w+/g`, the bead's own example).
 * `IMPORT-ORDER` — two `.indexOf(...)` calls on the same holder, in the same statement,
 * compared with `<` or `>`: an assertion about which of two things appears first, not
 * about either one's exact words. `HAS-COUNT` — the pinned text itself carries a digit
 * or a spelled-out count (`NUMBER_WORD`, the same list `lib/pinned.js` uses, because a
 * count baked into a regex or a string is the shape that breaks silently on the next
 * one added, digit or not). `WHOLE-EXPRESSION` — the default: an exact literal or
 * regex, pinned as itself, when none of the above three apply.
 *
 * WHAT THIS DOES NOT DO. It is not a JS parser, no more than `lib/pinned.js` is — the
 * same tokenizer, the same `statements()`/`blankLiterals()` split, and the same known
 * gap: a pattern assembled across a ternary, a template expression, or a helper called
 * three names deep is missed, not misreported. `deriveHolders` has no scope awareness,
 * so two unrelated `readFileSync` sites in one file that happen to bind the same local
 * name (`test/reenter.mjs` does this twice, both named `src`) are folded into one
 * holder set for the whole file — the same imprecision `lib/pinned.js` already accepts
 * for a module's exports. Only `fs.readFileSync` is recognised (the whole corpus uses
 * it, none of it a bare destructured `readFileSync`), and only the call's *first*
 * argument is read for the target file, per Node's own signature.
 */
import fs from 'node:fs';
import path from 'node:path';
import { blankComments } from './evidence.js';
import { blankLiterals, statements } from './harness.js';
import { literalsIn, splitArgs, deriveHolders } from './pinned.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ASSERT_2ARG = new Set(['match', 'equal', 'strictEqual', 'deepEqual', 'deepStrictEqual']);
const NUMBER_WORD = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
const hasNumber = (content) => /\d/.test(content) || NUMBER_WORD.test(content);

/**
 * Statements whose next statement opens with a leading `.` are merged into one — the
 * corpus's own `fs\n  .readFileSync(...)` chain shape, which `statements()`'s
 * bracket-depth split otherwise breaks in two (`const raw = fs` nets to zero brackets
 * on its own line, same trap `lib/pinned.js`'s `mergeContinuations` exists for, but a
 * different trailing shape than the one that function's regex covers).
 */
export function mergeChains(stmts) {
  const out = [];
  let i = 0;
  while (i < stmts.length) {
    let cur = stmts[i];
    let j = i + 1;
    while (j < stmts.length && /^\s*\./.test(stmts[j].text)) {
      cur = { text: `${cur.text}\n${stmts[j].text}`, start: cur.start, end: stmts[j].end };
      j += 1;
    }
    out.push(cur);
    i = j;
  }
  return out;
}

/**
 * The name of the nearest `const|let NAME = …` that `beforeIndex` (a `readFileSync`
 * call's own position) still sits inside the right-hand side of — the last such
 * declaration before it, unclosed by a `;` in between. A plain `const daemon =
 * fs.readFileSync(…)` at the top of a suite is its own whole statement, so this is
 * "the" declaration either way; a `const src = fs.readFileSync(…)` nested inside a
 * `check(name, () => { … })` callback is one line of a much bigger merged statement
 * (`statements()` does not split *inside* a bracketed block), so the anchor has to be
 * searched for rather than assumed to open the text handed in.
 */
export function declaredName(codeOnly, beforeIndex) {
  const before = codeOnly.slice(0, beforeIndex);
  const re = /(?:^|[;{}\n])\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g;
  let m;
  let last = null;
  while ((m = re.exec(before))) last = m;
  if (!last) return null;
  const between = before.slice(last.index + last[0].length);
  if (between.includes(';')) return null;
  return last[1];
}

/**
 * Every `.readFileSync(...)` call in `codeOnly` (comment-blanked, literal-preserving
 * `text` alongside it), each `{openIndex}` — `.readFileSync` rather than
 * `fs.readFileSync` so a call broken across a `fs\n  .readFileSync(` chain (already
 * glued back together by `mergeChains`) is still found by the dot immediately before it.
 */
function findReadCalls(codeOnly) {
  const calls = [];
  for (const m of codeOnly.matchAll(/\.readFileSync\s*\(/g)) {
    calls.push({ openIndex: m.index + m[0].length - 1 });
  }
  return calls;
}

/**
 * Does `argText` (a `readFileSync` first argument's raw text) name `targetRelPath`?
 * Every literal inside it — however many calls it is wrapped in, `LIB('advocate.js')`
 * or a bare `'advocate.js'` alike, since `literalsIn` does not care about nesting — is
 * checked against the basename and the `/`-joined relative path; a match on the
 * basename alone is confirmed by the directory's own name appearing as a whole word
 * anywhere in the *statement* that holds the call, so `'session.js'` elsewhere in the
 * tree cannot be mistaken for this file by basename alone.
 */
export function argNamesTarget(argText, stmtText, targetBase, targetRelDir) {
  const literals = literalsIn(argText).filter((l) => l.kind !== 'template' || !l.content.includes('${'));
  const targetJoined = targetRelDir ? `${targetRelDir}/${targetBase}` : targetBase;
  const named = literals.some((l) => l.content === targetBase || l.content === targetJoined);
  if (!named) return false;
  if (!targetRelDir) return true;
  const dirWord = targetRelDir.split('/')[0];
  return new RegExp(`\\b${escapeRe(dirWord)}\\b`, 'i').test(stmtText);
}

/** The literal(s) `call` (a `.match`/`.test`/`.includes`/`assert.*`/`.indexOf` call) pins. */
function findCalls(codeOnly) {
  const calls = [];
  for (const m of codeOnly.matchAll(/\bassert(?:\.strict)?\.(match|equal|strictEqual|deepEqual|deepStrictEqual)\s*\(/g)) {
    calls.push({ method: m[1], openIndex: m.index + m[0].length - 1 });
  }
  for (const m of codeOnly.matchAll(/\.test\s*\(/g)) {
    calls.push({ method: 'test', openIndex: m.index + m[0].length - 1, dotIndex: m.index });
  }
  for (const m of codeOnly.matchAll(/\.includes\s*\(/g)) {
    calls.push({ method: 'includes', openIndex: m.index + m[0].length - 1 });
  }
  for (const m of codeOnly.matchAll(/\.match(?:All)?\s*\(/g)) {
    calls.push({ method: 'strMatch', openIndex: m.index + m[0].length - 1, dotIndex: m.index });
  }
  for (const m of codeOnly.matchAll(/\.indexOf\s*\(/g)) {
    calls.push({ method: 'indexOf', openIndex: m.index + m[0].length - 1, dotIndex: m.index });
  }
  return calls;
}

function receiverName(text, dotIndex) {
  const before = text.slice(0, dotIndex);
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(before);
  return m ? m[1] : null;
}

function pinnedFromCall(text, call) {
  if (call.method === 'test') {
    const before = text.slice(0, call.dotIndex);
    const lits = literalsIn(text);
    const receiver = lits.find((l) => l.kind === 'regex' && l.index + l.raw.length === before.length);
    return receiver ? [receiver] : [];
  }
  const { args, closeIndex } = splitArgs(text, call.openIndex);
  if (closeIndex === -1) return [];
  if (ASSERT_2ARG.has(call.method)) {
    if (args.length < 2) return [];
    return literalsIn(args[1].text).map((l) => ({ ...l, index: l.index + args[1].index }));
  }
  if (call.method === 'includes' || call.method === 'indexOf' || call.method === 'strMatch') {
    if (args.length < 1) return [];
    return literalsIn(args[0].text).map((l) => ({ ...l, index: l.index + args[0].index }));
  }
  return [];
}

/** True if two `.indexOf(` calls on `holder`, both in `stmtText`, are compared with `<`/`>`. */
function isImportOrder(stmtText, holder, call) {
  if (call.method !== 'indexOf') return false;
  if (receiverName(stmtText, call.dotIndex) !== holder) return false;
  const rest = stmtText.slice(call.dotIndex);
  const secondOnHolder = new RegExp(`\\b${escapeRe(holder)}\\b\\s*\\.indexOf\\s*\\(`).test(
    rest.slice(rest.indexOf('(') + 1),
  );
  return secondOnHolder && /[<>]/.test(stmtText);
}

/** `\w` (or an equivalent identifier char class) somewhere in a regex's own source. */
function isIdentifierFamily(kind, content) {
  return kind === 'regex' && /\\w|\[A-Za-z0-9_$]|\[A-Za-z_\$]/i.test(content);
}

export function shapeOf(stmtText, holder, call, lit) {
  if (isImportOrder(stmtText, holder, call)) return 'IMPORT-ORDER';
  if (isIdentifierFamily(lit.kind, lit.content)) return 'IDENTIFIER-FAMILY';
  if (hasNumber(lit.content)) return 'HAS-COUNT';
  return 'WHOLE-EXPRESSION';
}

/**
 * `{dir, base}` for `targetRelPath` (already relative to the checkout root, forward
 * slashes) — `dir` is `''` when the file sits at the root, which no `lib/`/`bin/` file
 * this command is meant for ever does, but is handled rather than assumed away.
 */
function splitTarget(targetRelPath) {
  const norm = targetRelPath.split(path.sep).join('/');
  const at = norm.lastIndexOf('/');
  return at === -1 ? { dir: '', base: norm } : { dir: norm.slice(0, at), base: norm.slice(at + 1) };
}

/**
 * Every suite in `root/test` that `readFileSync`s `targetRelPath`'s source and asserts
 * a pattern against it, grouped by suite: `{file, reads: [{line}], findings: [{line,
 * kind, raw, shape}]}`. `name`, if given, narrows findings to the ones a pattern with
 * that identifier as its subject would actually trip — a regex finding whose pattern
 * does not match `name`, or a string finding that is not a substring of it, is dropped.
 */
export function readsOf(root, targetRelPath, { name = null } = {}) {
  const { dir: targetRelDir, base: targetBase } = splitTarget(targetRelPath);
  const testDir = path.join(root, 'test');
  let files;
  try {
    files = fs.readdirSync(testDir).filter((f) => f.endsWith('.mjs')).sort();
  } catch {
    files = [];
  }
  const suites = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(testDir, file), 'utf8');
    const blanked = blankComments(raw);
    if (!blanked.includes(targetBase)) continue;
    const stmts = mergeChains(statements(blanked));

    const reads = [];
    const seed = new Set();
    for (const st of stmts) {
      const codeOnly = blankLiterals(st.text);
      for (const call of findReadCalls(codeOnly)) {
        const { args, closeIndex } = splitArgs(st.text, call.openIndex);
        if (closeIndex === -1 || args.length < 1) continue;
        if (!argNamesTarget(args[0].text, st.text, targetBase, targetRelDir)) continue;
        const decl = declaredName(codeOnly, call.openIndex);
        if (!decl) continue;
        seed.add(decl);
        const line = st.start + (st.text.slice(0, args[0].index).match(/\n/g) || []).length + 1;
        reads.push({ line, local: decl });
      }
    }
    if (seed.size === 0) continue;

    const holders = deriveHolders(stmts, seed);
    const findings = [];
    for (const st of stmts) {
      const codeOnly = blankLiterals(st.text);
      const mentioned = [...holders].filter((h) => new RegExp(`\\b${escapeRe(h)}\\b`).test(codeOnly));
      if (mentioned.length === 0) continue;
      for (const call of findCalls(codeOnly)) {
        const holder = call.dotIndex !== undefined ? receiverName(codeOnly, call.dotIndex) : null;
        if (holder !== null && !holders.has(holder)) continue;
        for (const lit of pinnedFromCall(st.text, call)) {
          if (lit.kind === 'template') continue;
          if (name !== null) {
            const trips =
              lit.kind === 'regex'
                ? (() => {
                    try {
                      return new RegExp(lit.content, lit.flags.replace(/[gy]/g, '')).test(name);
                    } catch {
                      return false;
                    }
                  })()
                : name.includes(lit.content) || lit.content.includes(name);
            if (!trips) continue;
          }
          const before = st.text.slice(0, lit.index);
          const line = st.start + (before.match(/\n/g) || []).length + 1;
          const usedHolder = holder ?? mentioned[0];
          findings.push({ line, kind: lit.kind, raw: lit.raw, shape: shapeOf(codeOnly, usedHolder, call, lit) });
        }
      }
    }
    if (reads.length === 0) continue;
    findings.sort((a, b) => a.line - b.line);
    reads.sort((a, b) => a.line - b.line);
    suites.push({ file, reads, findings });
  }
  return suites;
}
