/**
 * The house shape for a new gate in a workspace repo, computed from the gates already
 * there — the same idea as `lib/harness.js` (`bc-zjab.11`), for a *different* repo's
 * `scripts/check_*.py` instead of this repo's own `test/*.mjs`.
 *
 * `bc-dgx7.107`: three sessions (`dv-5eu.11`, `dv-52r.6`, `dv-52r.7`) each added a gate to
 * delmar on the same day, and none of them read the same neighbours or landed on the same
 * shape. Eighteen-plus of delmar's own gates converge on `checks = 0` / `failures = []` /
 * a `check(cond, msg)` closure and a `ran N checks` … `FAILED -- N problem(s)` / `PASS`
 * ending; `dv-52r.6`'s gate printed `"checked %s for %d …"` / `"FAIL — %d problem(s):"`
 * instead — a different verb, a different dash, a different frame, discovered only because
 * a session audit read all three afterwards. This prints the majority so the next one
 * does not have to open four files to find it.
 *
 * ## Why this is not `lib/harness.js` widened, and not a hand-written template either
 *
 * `lib/harness.js` votes over four *kinds* of JS test suite, two-phase (a majority of a
 * kind decides which bindings it has, a plurality of those decides how each is spelled),
 * because JS suites disagree a dozen ways about how to spell the same binding. A gate
 * corpus here is smaller (a few dozen files, not a few hundred) and is one kind, not four,
 * so a single-phase vote — presence by plain majority, spelling by the modal text among
 * those that have it — is enough; see `deriveGateShape`. It is still **not a template**:
 * every line the skeleton prints is text some existing gate actually wrote, chosen by
 * count, so a corpus that converges on something else prints something else.
 *
 * ## Python statements are indentation-delimited, JS's are brace-delimited
 *
 * `lib/harness.js`'s `statements()` closes a statement when bracket depth returns to zero
 * — sound for JS, where a block is `{ … }`. A Python `def`/`if`/`for` block has no
 * bracket to close; its extent is "every line indented deeper than the header, until the
 * next line that is not." `statementsPy` below closes a statement only when a line starts
 * at column zero, carries zero bracket depth from the lines before it, and is not a
 * backslash continuation — so `def check(cond, msg): …` reads as one statement including
 * its indented body, and a multi-line bracketed literal that happens to close at column
 * zero (`]` alone on its own line) is not mistaken for a new top-level line, because the
 * depth carried into that line is still nonzero.
 *
 * ## Discovery is this tool's own glob, not `lib/checks.js`'s manifest
 *
 * This tool *is* about the `scripts/check_*.py` convention — `--for` refuses any other
 * name — so it reads that glob itself. It used to borrow `checkPyFiles` from
 * `lib/checks.js`, until bc-j2zwo.6 made `b7e-checks`' gate set a per-checkout
 * declaration (`.beadcause/checks.json`) precisely so that file assumes no naming
 * convention for anybody's scripts; the convention lives here instead, beside the one
 * caller that depends on it. `discoverGateFiles` separates `*_selftest.py` files into
 * their own list — the negative twins
 * `--selftest` votes over separately, because their shape (import the module under test,
 * a list of cases, a runner loop) is a different question from the gate's own shape and a
 * much less uniform one (only one of fifteen existing twins matches any other on the exact
 * preamble spelling) — so that half is offered as a lighter scaffold, not a voted majority.
 */
import fs from 'node:fs';
import path from 'node:path';

const NAME_TOKEN = '@@GATE-NAME@@';

/** The gate's own module name (no `.py`) written out of a line, so two gates can vote on
 * the same role despite naming themselves in it — the same trick `lib/harness.js`'s
 * `generalise`/`specialise` use for a suite's own stem. */
function generalise(line, stem) {
  if (!stem) return line;
  return line.split(stem).join(NAME_TOKEN);
}

/** …and written back in, when the shape is rendered for a gate that has a name again. */
export function specialise(text, stem) {
  return text.split(NAME_TOKEN).join(stem);
}

/* ------------------------------------------------------------------ Python scanning */

/**
 * `source` with every comment and string's contents replaced by spaces (newlines kept),
 * quote/`#` markers themselves left in place. Handles `'`, `"`, `'''` and `"""`; a
 * backslash inside a single/double-quoted string escapes the next character so an escaped
 * quote does not end the string early. This is what makes bracket-counting and
 * blank-line detection below safe against a `#` or a bracket character living inside a
 * string or a comment — the same purpose `lib/evidence.js`'s `blankComments` and
 * `lib/harness.js`'s `blankLiterals` serve for JS, reimplemented here because Python's
 * comment and string grammar (`#…`, `'''…'''`) is not theirs.
 */
export function blankPy(source) {
  const s = String(source);
  let out = '';
  let i = 0;
  let mode = null; // null | "'" | '"' | "'''" | '"""'
  while (i < s.length) {
    const c = s[i];
    if (mode === "'''" || mode === '"""') {
      if (s.startsWith(mode, i)) {
        out += mode;
        i += 3;
        mode = null;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (mode === "'" || mode === '"') {
      if (c === '\\' && i + 1 < s.length) {
        out += '  ';
        i += 2;
        continue;
      }
      if (c === mode) {
        out += c;
        mode = null;
        i += 1;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (c === '#') {
      while (i < s.length && s[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (s.startsWith("'''", i) || s.startsWith('"""', i)) {
      mode = s.slice(i, i + 3);
      out += mode;
      i += 3;
      continue;
    }
    if (c === "'" || c === '"') {
      mode = c;
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * `source` split into top-level statements — each one a shebang-free, comment-free-vote
 * unit of "one thing this module does at module scope," a `def`/`if`/`for` block included
 * whole. See the module docblock for why this is indentation-plus-depth rather than
 * `lib/harness.js`'s depth-only rule.
 */
export function statementsPy(source) {
  const lines = String(source).split('\n');
  const code = blankPy(source).split('\n');
  const out = [];
  let depth = 0;
  let cont = false;
  let start = null;
  for (let i = 0; i < lines.length; i += 1) {
    const bare = code[i] ?? '';
    const blankLine = bare.trim() === '';
    const indented = /^[ \t]/.test(bare) && !blankLine;
    if (start === null) {
      if (blankLine) continue;
      start = i;
    } else if (depth <= 0 && !cont && !indented && !blankLine) {
      out.push({ text: lines.slice(start, i).join('\n').replace(/\s+$/, ''), start, end: i - 1 });
      start = i;
    }
    for (const ch of bare) {
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    }
    cont = /\\\s*$/.test(bare);
  }
  if (start !== null) out.push({ text: lines.slice(start).join('\n').replace(/\s+$/, ''), start, end: lines.length - 1 });
  return out;
}

/**
 * The module docstring, read directly rather than through `statementsPy` — a triple-quote
 * that opens and closes at column zero on its own line is, correctly, not itself a
 * boundary the statement splitter above would draw the same way twice, so this is a
 * dedicated small scan: skip an optional shebang, then if the next non-blank line opens a
 * triple-quoted string, capture through its close.
 */
export function moduleDocstring(source) {
  const lines = String(source).split('\n');
  let i = lines[0]?.startsWith('#!') ? 1 : 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  const open = /^\s*('''|""")/.exec(lines[i] ?? '');
  if (!open) return null;
  const quote = open[1];
  const startLine = i;
  const rest = lines[i].slice(lines[i].indexOf(quote) + 3);
  if (rest.includes(quote)) return { text: lines[i], start: startLine, end: i };
  i += 1;
  while (i < lines.length && !lines[i].includes(quote)) i += 1;
  return { text: lines.slice(startLine, Math.min(i, lines.length - 1) + 1).join('\n'), start: startLine, end: Math.min(i, lines.length - 1) };
}

/** Does the docstring carry an indented `python3 scripts/check_…` run line — the same
 * "the command names the file" test `lib/harness.js`'s `slotsOf` uses for a suite's own
 * docblock, narrowed to the one interpreter this corpus actually runs. */
export function docstringRunLine(doc, stem) {
  if (!doc) return null;
  const lines = doc.text.split('\n');
  const hit = lines.find((l) => /^\s+python3\s+scripts\/\S+\.py/.test(l));
  return hit ? generalise(hit, stem) : null;
}

/* ------------------------------------------------------------------------ discovery */

/** Every `scripts/check_*.py` filename under `root`, sorted. */
export function checkPyFiles(root) {
  const dir = path.join(root, 'scripts');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^check_.*\.py$/.test(f))
    .sort();
}

/** Every `scripts/check_*.py` under `root`, split into gates and their `_selftest.py`
 * twins. */
export function discoverGateFiles(root) {
  const names = checkPyFiles(root);
  const gates = [];
  const selftests = [];
  for (const file of names) {
    const stem = file.replace(/\.py$/, '');
    const source = fs.readFileSync(path.join(root, 'scripts', file), 'utf8');
    const entry = { file, stem, source };
    if (/_selftest$/.test(stem)) selftests.push(entry);
    else gates.push(entry);
  }
  return { gates, selftests };
}

/* -------------------------------------------------------------------------- slots */

const IMPORT_RE = /^import\s+[\w.]+(\s+as\s+\w+)?$/;
const FROM_IMPORT_RE = /^from\s+[\w.]+\s+import\s+/;
const ROOT_RE = /^ROOT\s*=/;
const CHECKS_RE = /^checks\s*=\s*0$/;
const FAILURES_RE = /^failures\s*=\s*\[\]$/;
const CHECK_FN_RE = /^def\s+check\(/;
const MAIN_FN_RE = /^def\s+main\(/;
const DUNDER_MAIN_RE = /^if\s+__name__\s*==\s*['"]__main__['"]/;
const ENDING_HEAD_RE = /^(print\(|if\s+(not\s+)?failures|sys\.exit\(|for\s)/;

/** One gate, decomposed into the slots the vote below asks about — every gate answers
 * the same six questions, generalised so two gates naming themselves differently in a
 * line can still agree on it. */
export function slotsOfPy(source, stem) {
  const lines = String(source).split('\n');
  const shebang = lines[0]?.startsWith('#!') ? lines[0] : null;
  const doc = moduleDocstring(source);
  const runLine = docstringRunLine(doc, stem);

  const sts = statementsPy(source).filter((s) => !doc || s.end > doc.end);
  const gen = (s) => generalise(s.text, stem);

  const imports = sts.filter((s) => IMPORT_RE.test(s.text) || FROM_IMPORT_RE.test(s.text)).map(gen);
  const rootLine = sts.find((s) => ROOT_RE.test(s.text));
  const checksLine = sts.find((s) => CHECKS_RE.test(s.text));
  const failuresLine = sts.find((s) => FAILURES_RE.test(s.text));
  const checkFn = sts.find((s) => CHECK_FN_RE.test(s.text));
  const mainFn = sts.find((s) => MAIN_FN_RE.test(s.text));
  const dunderMain = sts.find((s) => DUNDER_MAIN_RE.test(s.text));

  // Walking back from the end, the ending is every trailing statement that is a print, an
  // `if failures`/`for` block, or a `sys.exit` — the same "walk back until it stops
  // looking like teardown" rule `lib/harness.js`'s `slotsOf` uses for a suite's ending.
  const ending = [];
  for (let i = sts.length - 1; i >= 0; i -= 1) {
    if (!ENDING_HEAD_RE.test(sts[i].text)) break;
    ending.unshift(gen(sts[i]));
  }

  return {
    stem,
    shebang,
    hasDoc: !!doc,
    runLine,
    imports,
    rootLine: rootLine ? gen(rootLine) : null,
    checksLine: checksLine ? gen(checksLine) : null,
    failuresLine: failuresLine ? gen(failuresLine) : null,
    checkFn: checkFn ? gen(checkFn) : null,
    hasMain: !!(mainFn && dunderMain),
    ending,
  };
}

/* ------------------------------------------------------------------------- voting */

function tally(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  return m;
}

/** The most common value; ties broken by the text so the answer never depends on scan
 * order — same rule as `lib/harness.js`'s `modal`. */
function modal(values) {
  let best = null;
  let bestN = 0;
  for (const [v, n] of tally(values)) {
    if (n > bestN || (n === bestN && best !== null && v < best)) {
      best = v;
      bestN = n;
    }
  }
  return best === null ? null : { value: best, count: bestN };
}

/** A slot a plain majority of the corpus writes at all, spelled the way most of the
 * gates that have it spell it — `null` (not on the ballot) when fewer than half do. */
function slot(n, present) {
  if (!n || present.length * 2 <= n) return { present: false, fraction: n ? present.length / n : 0, text: null };
  return { present: true, fraction: present.length / n, text: modal(present).value };
}

/** Roles among the ending statements, voted the same "majority of a kind decides which
 * bindings it has, plurality decides how" two-phase way `lib/harness.js` votes on a
 * suite's ending — a `print(…)` line and an `if failures: …` block are different roles
 * even though both start the same word, so the role key is the statement's *kind* of
 * head, not its exact text. */
function roleOfEnding(text) {
  if (/^if\s+(not\s+)?failures/.test(text)) return 'if-failures';
  if (/^for\s/.test(text)) return 'for-failures';
  if (/^sys\.exit\(0\)/.test(text)) return 'exit-0';
  if (/^sys\.exit\(/.test(text)) return 'exit-other';
  // The tally-line print ("ran N checks") is the one ending role whose spelling varies
  // (`%d` vs an f-string, extra context appended) while its ROLE — a print mentioning the
  // `checks` counter — does not; grouping by role first is what lets it win a majority
  // even though no two gates spell it quite the same way. A print that names `failures`
  // instead is the PASS-line, which is its own role for the same reason.
  if (/^print\(/.test(text) && /\bchecks\b/.test(text)) return 'print-tally';
  if (/^print\(/.test(text) && /\bfailures\b/.test(text)) return 'print-fail-detail';
  if (/^print\(/.test(text)) return 'print-pass';
  return `other ${text.replace(/\s+/g, ' ').slice(0, 24)}`;
}

function endingShape(perGate, n) {
  const seen = new Map();
  perGate.forEach((lines, gi) => {
    lines.forEach((text, pos) => {
      const role = roleOfEnding(text);
      const e = seen.get(role) || { count: new Set(), positions: 0, texts: [] };
      e.count.add(gi);
      e.positions += pos;
      e.texts.push(text);
      seen.set(role, e);
    });
  });
  return [...seen.entries()]
    .filter(([, e]) => e.count.size * 2 > n)
    .sort((a, b) => a[1].positions / a[1].count.size - b[1].positions / b[1].count.size)
    .map(([, e]) => modal(e.texts).value);
}

/**
 * The house shape for a workspace repo's gates — every slot decided by a plain majority
 * of `gates` (a slot fewer than half of them write is left out, not guessed at), the
 * spelling of each by the modal text among the gates that have it. `minimum` below the
 * count that makes a majority meaningful just returns `basis: 'insufficient'` rather than
 * pretending three files are a corpus.
 */
export function deriveGateShape(gates, { minimum = 3 } = {}) {
  const n = gates.length;
  const slots = gates.map((g) => slotsOfPy(g.source, g.stem));
  if (n < minimum) {
    return { sampleSize: n, basis: 'insufficient', minimum };
  }
  const shebang = slot(n, slots.filter((s) => s.shebang).map((s) => s.shebang));
  const runLine = slot(n, slots.filter((s) => s.runLine).map((s) => s.runLine));
  const root = slot(n, slots.filter((s) => s.rootLine).map((s) => s.rootLine));
  const checksLine = slot(n, slots.filter((s) => s.checksLine).map((s) => s.checksLine));
  const failuresLine = slot(n, slots.filter((s) => s.failuresLine).map((s) => s.failuresLine));
  const checkFn = slot(n, slots.filter((s) => s.checkFn).map((s) => s.checkFn));
  const hasMain = slots.filter((s) => s.hasMain).length;
  const ending = endingShape(slots.map((s) => s.ending), n);

  const importCount = new Map();
  for (const s of slots) for (const imp of s.imports) importCount.set(imp, (importCount.get(imp) || 0) + 1);
  const imports = [...importCount.entries()]
    .filter(([, c]) => c * 2 > n)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([text]) => text);

  return {
    sampleSize: n,
    basis: 'corpus',
    shebang,
    runLine,
    root,
    checksLine,
    failuresLine,
    checkFn,
    hasMainWrapper: { present: hasMain * 2 > n, fraction: hasMain / n },
    ending,
    imports,
  };
}

/** The gates that most nearly are the derived shape — what to read when you want more,
 * scored the same way `lib/harness.js`'s `seedSuites` scores a suite: how many of the
 * shape's own lines it actually has. */
export function seedGates(gates, shape, limit = 2) {
  if (shape.basis !== 'corpus') return [];
  const want = [
    ...(shape.root.present ? [shape.root.text] : []),
    ...(shape.checksLine.present ? [shape.checksLine.text] : []),
    ...(shape.failuresLine.present ? [shape.failuresLine.text] : []),
    ...(shape.checkFn.present ? [shape.checkFn.text] : []),
    ...shape.ending,
  ];
  return gates
    .map((g) => {
      const s = slotsOfPy(g.source, g.stem);
      const have = new Set([
        ...(s.rootLine ? [s.rootLine] : []),
        ...(s.checksLine ? [s.checksLine] : []),
        ...(s.failuresLine ? [s.failuresLine] : []),
        ...(s.checkFn ? [s.checkFn] : []),
        ...s.ending,
      ]);
      return { file: g.file, score: want.filter((w) => have.has(w)).length };
    })
    .sort((a, b) => b.score - a.score || (a.file < b.file ? -1 : 1))
    .slice(0, limit);
}

/* ------------------------------------------------------------------------- render */

function indent(text, n) {
  const pad = ' '.repeat(n);
  return text
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}

/** The generated `.py` skeleton — every line either the corpus's own majority text
 * (rendered for `name`) or an explicit `# TODO` the majority left nobody else to guess
 * at (the actual checks, and the one-line summary at the top). Runs, green, zero checks,
 * before anything is added to it — the same acceptance `lib/harness.js`'s render holds
 * itself to. */
export function renderGateSkeleton(shape, { name, forPath }) {
  const lines = [];
  lines.push(shape.shebang.present ? shape.shebang.text : '#!/usr/bin/env python3');
  const summary = `"""TODO: one line saying what this gate protects and why (bead id).\n\nTODO: what regresses without it, and what reads the fact this checks.\n"""`;
  if (shape.runLine.present) {
    const run = specialise(shape.runLine.text, name);
    lines.push(`"""TODO: one line saying what this gate protects and why (bead id).`);
    lines.push('');
    lines.push('TODO: what regresses without it, and what reads the fact this checks.');
    lines.push('');
    lines.push(run);
    lines.push('"""');
  } else {
    lines.push(summary);
  }
  lines.push('');
  for (const imp of shape.imports.length ? shape.imports : ['import os', 'import sys']) lines.push(imp);
  lines.push('');
  if (shape.root.present) lines.push(specialise(shape.root.text, name));
  lines.push('');
  if (shape.checksLine.present) lines.push(shape.checksLine.text);
  if (shape.failuresLine.present) lines.push(shape.failuresLine.text);
  lines.push('');
  if (shape.checkFn.present) {
    lines.push(specialise(shape.checkFn.text, name));
    lines.push('');
  }
  lines.push('# TODO: the gate\'s own checks go here, e.g.:');
  lines.push('# check(condition, "what failed and why it matters")');
  lines.push('');
  for (const e of shape.ending) lines.push(specialise(e, name));
  return { text: lines.join('\n') + '\n', usedRunLine: shape.runLine.present, forPath };
}

/**
 * A lighter scaffold for the `_selftest.py` twin — not a voted shape, because only one of
 * the corpus's fifteen existing twins matches any other on the exact preamble spelling
 * (each imports a different callable from the module it tests). What *is* common to all
 * of them — import the module under test, a list of cases, a runner loop, `ok`/`FAIL`
 * printing, a summary line, `sys.exit` on failure — is structural, not textual, so this
 * emits that structure with the case list empty rather than guessing at cases. It runs,
 * printing `0 cases, 0 failed` and exiting 0, before anything is added to it.
 */
export function renderSelftestSkeleton({ name, gateModule }) {
  const lines = [
    '#!/usr/bin/env python3',
    `"""TODO: selftest for ${gateModule}.py — the failure shapes it must catch, and the near-misses that must NOT fail.`,
    '',
    `    python3 scripts/${name}.py`,
    '"""',
    'import os',
    'import sys',
    '',
    'HERE = os.path.dirname(os.path.abspath(__file__))',
    'sys.path.insert(0, HERE)',
    `import ${gateModule} as gate  # noqa: E402`,
    '',
    'CASES = []  # TODO: (name, ..., should_fail) tuples — see a sibling _selftest.py for the shape',
    '',
    'failed = 0',
    'for case in CASES:',
    '    pass  # TODO: run `case` through the gate and compare against its should_fail',
    '',
    'print(f"\\n{len(CASES)} cases, {failed} failed")',
    'print("FAILED" if failed else "PASS")',
    'sys.exit(1 if failed else 0)',
    '',
  ];
  return { text: lines.join('\n') };
}

/* -------------------------------------------------------------- registration checklist */

/**
 * What shipping a new gate still owes, itself computed from how the corpus's *existing*
 * gates were registered rather than asserted — the same "computed, not templated" rule
 * the shape above follows. `bc-dgx7.107`'s own evidence: of the three sessions that each
 * added a gate the same day, only one added a `CLAUDE.md` reference-table row and none
 * wrote the `_selftest.py` twin three of the corpus's own gates have, so a checklist that
 * is silent about either is exactly the gap this command exists to close.
 */
export function registrationChecklist(root, { gates, selftests }) {
  const items = [];
  const n = gates.length;
  const withSelftest = gates.filter((g) => selftests.some((s) => s.stem === `${g.stem}_selftest`)).length;
  items.push({
    id: 'selftest',
    done: false,
    text: `write scripts/<name>_selftest.py, the negative twin — ${withSelftest}/${n} of this corpus's gates have one (${Math.round((withSelftest / (n || 1)) * 100)}%); pass --selftest to this command for a scaffold`,
  });

  const claudeMdPath = path.join(root, 'CLAUDE.md');
  let claudeMd = null;
  try {
    claudeMd = fs.readFileSync(claudeMdPath, 'utf8');
  } catch {
    /* no CLAUDE.md at this root — the item below still applies, just unmeasured */
  }
  if (claudeMd) {
    const rowsWithGate = (claudeMd.match(/^\|.*gate `scripts\/check_[^`]+\.py`.*\|$/gm) || []).length;
    items.push({
      id: 'claude-md-row',
      done: false,
      text: `if this gate polices a specific canonical fact (not every gate does), add a row to CLAUDE.md's reference table — \`| <topic> | … gate \\\`scripts/check_<name>.py\\\` |\` — ${rowsWithGate} existing row(s) already point at a gate that way`,
    });
    items.push({
      id: 'claude-md-mention',
      done: false,
      text: `mention it in prose near where the gated fact is described — "**Gated:** \`python3 scripts/check_<name>.py .\`" is the phrasing the corpus already uses`,
    });
  } else {
    items.push({
      id: 'claude-md-row',
      done: false,
      text: `${claudeMdPath} was not found — if this repo documents canon elsewhere, add the gate's reference there instead`,
    });
  }
  return items;
}

/** The whole answer for one `--for` target: the derived shape, the seeds, the rendered
 * skeleton(s), and the registration checklist — what `bin/b7e-newgate` prints. */
export function newgate(root, { forPath, selftest = false } = {}) {
  const { gates, selftests } = discoverGateFiles(root);
  if (!gates.length) throw new Error(`no scripts/check_*.py found under ${root}`);
  const shape = deriveGateShape(gates);
  const seeds = seedGates(gates, shape, 2);

  if (!forPath) return { shape, seeds, gates, selftests };

  const file = path.basename(forPath);
  if (!/^check_[\w-]+\.py$/.test(file)) {
    throw new Error(`--for expects scripts/check_<name>.py, got ${forPath}`);
  }
  const stem = file.replace(/\.py$/, '');
  if (shape.basis !== 'corpus') {
    throw new Error(`only ${shape.sampleSize} gate(s) under ${root} — need at least ${shape.minimum} for a majority shape`);
  }
  const skeleton = renderGateSkeleton(shape, { name: stem, forPath: path.join('scripts', file) });
  const checklist = registrationChecklist(root, { gates, selftests });
  const result = { shape, seeds, skeleton, checklist, gates, selftests };
  if (selftest) result.selftestSkeleton = renderSelftestSkeleton({ name: `${stem}_selftest`, gateModule: stem });
  return result;
}
