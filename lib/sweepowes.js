/**
 * What a new advocate sweep still owes, read off `lib/advocate.js` before the gate is
 * worth starting — the checks behind `b7e-sweep` (bc-dgx7.167).
 *
 * Four sessions each added a sweep to the advocate's tick (bc-dhayi, bc-iaju1.12,
 * bc-iaju1.8, bc-iaju1.4) and each rebuilt the registration list from memory notes and
 * greps of a sibling sweep, and each got a different subset. bc-iaju1.4 paid for the gap
 * twice: `test/configtable.mjs` after the code was written, and then, after ~90 minutes
 * of gate queue, `test/wsshape.mjs` refusing `sweepLapsed` because it was in neither
 * `WANT_OBJECT` nor `WANT_NAME`. One line, one wasted gate. `b7e-owes` checks four
 * registries and is silent about all of this, which is the exact bar it says it exists to
 * clear: every one of these goes red only in a full gate, or does not go red at all.
 *
 * THREE READS, each of them the same reading the suite or the daemon makes, done on the
 * text so it costs a second and not a run:
 *
 *   1. **the workspace shape.** Every `a.workspace` in the advocate has to sit in an
 *      argument list of a callee named in `test/wsshape.mjs`'s `WANT_OBJECT`, and no
 *      callee in `WANT_NAME` may be handed one. That suite's own scan, per callee, with
 *      the name of the callee that is missing from the lists rather than the position of
 *      the argument that exposed it — the fix is one string in a list, and this says which.
 *   2. **the interval clocks.** A sweep keeps `a.lastXAt` and `record()` restores it and
 *      `persist()` writes it, by hand, on both sides. Half of that pair is the failure:
 *      restored and never written means a clock that reads null after every restart —
 *      several times a day here, because the daemon is restarted by its own merges — and
 *      written and never restored is the same loss from the other side. NOT reported: a
 *      clock that `record()` starts at `null` and `persist()` leaves out. That is a
 *      decision the record initialiser spells out in a sentence, six times over ("a
 *      daemon that has just come up is exactly when a merge it never saw is most likely
 *      to be sitting there"), and listing it as debt would put six findings on a tree
 *      that owes nothing. They are the `notes`, printed on request.
 *   3. **the settings the sweep reads.** Every `o.<key>` a function reads needs a row in
 *      the specification naming `advocates.<key>`. `test/configtable.mjs` goes red for a
 *      key with a default; a key read with none (`o.flagX === false`) is a knob nothing
 *      documents and no suite notices.
 *
 * WHAT IT DOES NOT CHECK, and why the list is short. It does not check that a sweep's
 * result field (`a.inMain`) has a line in `record()` and in `snapshot()`: on main today
 * `farBlocked` has no initialiser and `notInMain` no snapshot line, both shipped, so a
 * rule for it would put debt on a tree that is meant to owe none. Whether that is a
 * defect is a decision, and `b7e-sweep` is a linter for what is owed rather than an
 * opinion about what was shipped. It does not run any suite either — `b7e-gate` does.
 *
 * Pure over text, like `b7e-owes`'s extractors: `analyse` takes the sources and hands back
 * data, so a fabricated advocate is enough to prove every finding and no second checkout
 * is needed.
 */
import { blankComments } from './evidence.js';
import { blankLiterals } from './harness.js';

export const ADVOCATE = 'lib/advocate.js';
export const WSSHAPE = 'test/wsshape.mjs';
export const CONFIG_DOC = 'docs/config.md';

/** Functions that call everything, so a call from one of them says nothing about whose it is. */
const BROAD = new Set(['createAdvocates', 'tick', 'tickOne']);

/** Words that put a `(` after them without being a call. */
const NOT_A_CALLEE = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'function', 'async', 'new', 'void', 'throw', 'in', 'of']);

/**
 * The one `a.workspace` that is not an argument to anything, exempted in
 * `test/wsshape.mjs` by the same pattern — see its `NOT_A_CALL`. Kept as a third copy
 * because that one is a regex literal inside a suite and cannot be read back as data.
 */
const NOT_A_CALL = [/order\.map\(\(a\) => a\.workspace\)/];

/** Comments and string contents blanked, positions and line breaks kept. */
export const codeOf = (src) => blankLiterals(blankComments(String(src)));

/** A 1-based line lookup that does not re-split the file for every index. */
export function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

const PAIRS = { '(': ')', '{': '}', '[': ']' };

/** The index of the bracket that closes the one at `open` — `-1` if it never does. */
export function closer(code, open) {
  const up = code[open];
  const down = PAIRS[up];
  if (!down) return -1;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === up) depth += 1;
    else if (code[i] === down) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Every `function name(…) {…}`, with the span of its body. Arrow consts are not listed. */
export function functionsIn(code) {
  const out = [];
  const re = /(?:^|[^\w$.])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of code.matchAll(re)) {
    const paren = m.index + m[0].length - 1;
    const afterParams = closer(code, paren);
    if (afterParams < 0) continue;
    const open = code.indexOf('{', afterParams);
    if (open < 0) continue;
    const close = closer(code, open);
    if (close < 0) continue;
    out.push({ name: m[1], from: m.index, open, close });
  }
  return out;
}

/** The smallest function whose body holds `index`, or `null` at the top level. */
export function enclosing(fns, index) {
  let best = null;
  for (const f of fns) {
    if (index > f.open && index < f.close && (!best || f.close - f.open < best.close - best.open)) best = f;
  }
  return best;
}

/** Every call to `name(` with the span its arguments occupy — `test/wsshape.mjs`'s `callsTo`. */
export function callsTo(code, name) {
  const escaped = name.replace(/[.?*+^$()[\]{}|\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\w$.])${escaped}\\s*\\??\\.?\\s*\\(`, 'g');
  const out = [];
  for (const m of code.matchAll(re)) {
    const open = code.indexOf('(', m.index + m[0].length - 1);
    const end = closer(code, open);
    if (end >= 0) out.push({ name, at: m.index, from: open + 1, to: end, text: code.slice(open + 1, end) });
  }
  return out;
}

/**
 * The callee of the innermost call whose argument list holds `index` — the thing that
 * would have to be named in one of the lists. `null` when nothing encloses it.
 */
export function calleeAround(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0 && index - i < 6000; i -= 1) {
    const c = code[i];
    if (c === ')') depth += 1;
    else if (c === '(') {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const head = code.slice(Math.max(0, i - 120), i);
      const m = head.match(/([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*)\s*\??\.?\s*$/);
      const callee = m ? m[1].replace(/\s+/g, '') : '';
      if (callee && !NOT_A_CALLEE.has(callee)) return { callee, open: i };
    }
  }
  return null;
}

/** `{name, line}` for every quoted entry of `const <listName> = [ … ];`, plus the list's own lines. */
export function listEntries(wsshapeSrc, listName) {
  const code = blankComments(String(wsshapeSrc));
  const at = code.search(new RegExp(`const\\s+${listName}\\s*=\\s*\\[`));
  if (at < 0) return null;
  const open = code.indexOf('[', at);
  const end = closer(code, open);
  if (end < 0) return null;
  const lineOf = lineIndex(code);
  const entries = [];
  for (const m of code.slice(open, end).matchAll(/'([^']+)'/g)) entries.push({ name: m[1], line: lineOf(open + m.index) });
  return { entries, from: lineOf(open), to: lineOf(end) };
}

/** Of the entries in `list`, the one whose name shares the longest prefix with `name`. */
export function besideEntry(list, name) {
  let best = null;
  let bestLen = -1;
  for (const e of list.entries) {
    let n = 0;
    while (n < e.name.length && n < name.length && e.name[n] === name[n]) n += 1;
    if (n >= bestLen) {
      best = e;
      bestLen = n;
    }
  }
  return best;
}

/* ===================================================================== *
 * 1. the workspace shape
 * ===================================================================== */

function workspaceShape({ code, fns, lineOf, wsshapeSrc }) {
  const findings = [];
  const object = listEntries(wsshapeSrc, 'WANT_OBJECT');
  const named = listEntries(wsshapeSrc, 'WANT_NAME');
  if (!object || !named) {
    findings.push({
      kind: 'unreadable',
      fn: null,
      file: WSSHAPE,
      line: 1,
      message: 'cannot find WANT_OBJECT and WANT_NAME — the lists this reads were renamed, so the workspace-shape check cannot be judged',
      suite: null,
    });
    return findings;
  }
  const wantObject = new Set(object.entries.map((e) => e.name));
  const wantName = new Set(named.entries.map((e) => e.name));

  const spans = [];
  for (const name of wantObject) for (const c of callsTo(code, name)) spans.push(c);
  for (const m of code.matchAll(/\bbd\.[a-zA-Z]+\s*\(/g)) {
    const open = code.indexOf('(', m.index);
    const end = closer(code, open);
    if (end >= 0) spans.push({ from: open + 1, to: end });
  }

  // A site in a call that wants the name is `wrong`, whichever list the callee is in.
  const wrong = [];
  for (const name of wantName) {
    for (const c of callsTo(code, name)) {
      if (/\ba\.workspace\b/.test(c.text)) wrong.push({ name, at: c.at });
    }
  }
  for (const w of wrong) {
    findings.push({
      kind: 'wrong-shape',
      fn: enclosing(fns, w.at)?.name || null,
      callee: w.name,
      file: ADVOCATE,
      line: lineOf(w.at),
      message: `${w.name}(… a.workspace …) hands the object to a callee that wants the name — bc-2uj4.6, silent on every tick`,
      suite: WSSHAPE,
    });
  }
  for (const m of code.matchAll(/\bbd\.([a-zA-Z]+)\s*\(\s*a\.name\b/g)) {
    findings.push({
      kind: 'wrong-shape',
      fn: enclosing(fns, m.index)?.name || null,
      callee: `bd.${m[1]}`,
      file: ADVOCATE,
      line: lineOf(m.index),
      message: `bd.${m[1]}(a.name …) — every bd call takes the workspace object, never its name`,
      suite: WSSHAPE,
    });
  }
  for (const m of code.matchAll(/\$\{[^}]*\ba\.workspace\b[^}]*\}/g)) {
    findings.push({
      kind: 'wrong-shape',
      fn: enclosing(fns, m.index)?.name || null,
      callee: null,
      file: ADVOCATE,
      line: lineOf(m.index),
      message: 'a.workspace inside a template literal reads "[object Object]" — use a.name',
      suite: WSSHAPE,
    });
  }

  // The rest: an `a.workspace` in no call that wants the object. Named by callee, once.
  const unlisted = new Map();
  const lines = code.split('\n');
  for (const m of code.matchAll(/\ba\.workspace\b/g)) {
    if (spans.some((s) => m.index >= s.from && m.index < s.to)) continue;
    if (NOT_A_CALL.some((re) => re.test(lines[lineOf(m.index) - 1]))) continue;
    const around = calleeAround(code, m.index);
    // Already reported above as the wrong shape, which is the more useful sentence.
    if (around && wantName.has(around.callee)) continue;
    const key = around ? around.callee : `(outside any call, line ${lineOf(m.index)})`;
    const site = { at: m.index, fn: enclosing(fns, m.index)?.name || null };
    if (!unlisted.has(key)) unlisted.set(key, { callee: around?.callee || null, sites: [] });
    unlisted.get(key).sites.push(site);
  }
  for (const [key, u] of unlisted) {
    const first = u.sites[0];
    if (!u.callee) {
      findings.push({
        kind: 'wsshape-unlisted',
        fn: first.fn,
        callee: null,
        file: ADVOCATE,
        line: lineOf(first.at),
        message: `a.workspace is not an argument to any call — ${key}. Add an exemption to NOT_A_CALL in ${WSSHAPE} if it is deliberate`,
        suite: WSSHAPE,
      });
      continue;
    }
    const beside = besideEntry(object, u.callee);
    const where = `called at ${ADVOCATE}:${lineOf(first.at)}${first.fn ? ` in ${first.fn}` : ''}${u.sites.length > 1 ? `, +${u.sites.length - 1} more` : ''}`;
    findings.push({
      kind: 'wsshape-unlisted',
      fn: first.fn,
      callee: u.callee,
      file: WSSHAPE,
      line: beside ? beside.line : object.to,
      message: `${u.callee} is in neither WANT_OBJECT nor WANT_NAME — add it beside '${beside ? beside.name : '…'}' once you have read which shape it takes (${where})`,
      suite: WSSHAPE,
    });
  }
  return findings;
}

/* ===================================================================== *
 * 2. the interval clocks
 * ===================================================================== */

function intervalClocks({ code, fns, lineOf }) {
  const findings = [];
  const notes = [];
  const record = fns.find((f) => f.name === 'record');
  const persist = fns.find((f) => f.name === 'persist');
  if (!record || !persist) {
    findings.push({
      kind: 'unreadable',
      fn: null,
      file: ADVOCATE,
      line: 1,
      message: `cannot find ${!record ? 'record()' : 'persist()'} — the clock check reads both, so it cannot be judged`,
      suite: null,
    });
    return { findings, notes };
  }
  const recordBody = code.slice(record.open, record.close);
  const persistBody = code.slice(persist.open, persist.close);

  const sites = new Map();
  for (const m of code.matchAll(/\ba\.(last[A-Z]\w*At)\b/g)) {
    const fn = enclosing(fns, m.index)?.name || null;
    if (!sites.has(m[1])) sites.set(m[1], new Set());
    if (fn && fn !== 'record' && fn !== 'persist') sites.get(m[1]).add(fn);
  }

  const lastLine = (body, base, re) => {
    let last = null;
    for (const m of body.matchAll(re)) last = m;
    return last ? lineOf(base + last.index) : lineOf(base);
  };
  const recordLine = lastLine(recordBody, record.open, /\blast[A-Z]\w*At\s*:/g);
  const persistLine = lastLine(persistBody, persist.open, /\blast[A-Z]\w*At\s*:/g);
  const restoredLine = lastLine(recordBody, record.open, /\blast[A-Z]\w*At\s*:\s*prev\./g);

  for (const [clock, fnSet] of sites) {
    const esc = clock.replace(/\$/g, '\\$');
    const declared = new RegExp(`\\b${esc}\\s*:`).test(recordBody);
    const restored = new RegExp(`\\b${esc}\\s*:\\s*prev\\.${esc}\\b`).test(recordBody);
    const persisted = new RegExp(`\\b${esc}\\s*:\\s*a\\.${esc}\\b`).test(persistBody);
    const fnList = [...fnSet];
    const fn = fnList[0] || null;
    const base = { fns: fnList, fn };
    if (restored && !persisted) {
      findings.push({
        ...base,
        kind: 'persist-drops',
        file: ADVOCATE,
        line: persistLine,
        message: `persist() drops ${clock} — record() restores it from advocates.json and nothing ever writes it there, so the interval clock resets on every restart; add \`${clock}: a.${clock},\` beside the others`,
        suite: null,
      });
    } else if (persisted && !restored) {
      findings.push({
        ...base,
        kind: 'record-forgets',
        file: ADVOCATE,
        line: restoredLine,
        message: `record() never restores ${clock} — persist() writes it and the next boot starts it at ${declared ? 'null' : 'undefined'}; add \`${clock}: prev.${clock} || null,\``,
        suite: null,
      });
    } else if (!declared) {
      findings.push({
        ...base,
        kind: 'no-record-line',
        file: ADVOCATE,
        line: recordLine,
        message: `record() has no line for ${clock} — decide whether it survives a restart: \`${clock}: prev.${clock} || null,\` and a persist() entry, or \`${clock}: null,\` with the sentence that says why it should not`,
        suite: null,
      });
    } else if (!restored && !persisted) {
      const own = recordBody.match(new RegExp(`\\b${esc}\\s*:`));
      notes.push({ ...base, kind: 'restart-runs', file: ADVOCATE, line: own ? lineOf(record.open + own.index) : recordLine, message: `${clock} starts at null on every boot, so this sweep runs on the first tick after a restart — a decision record() already carries` });
    }
  }
  return { findings, notes };
}

/* ===================================================================== *
 * 3. the settings the sweep reads
 * ===================================================================== */

/**
 * The spans of every callback that names its own parameter `o` — `.filter((o) => o.id …)` —
 * where `o` is a queue row and not the advocate's options. The span runs to the bracket that
 * closes the call the arrow is an argument of. An arrow that is not an argument (`const
 * wanted = (o) => …` at the top of the file) is left alone: there `o` is the options.
 */
function callbacksBindingO(code) {
  const spans = [];
  for (const m of code.matchAll(/(?:\(\s*o\s*\)|\bo)\s*=>/g)) {
    let depth = 0;
    for (let i = m.index - 1; i >= 0; i -= 1) {
      const c = code[i];
      if (c === ')' || c === ']' || c === '}') depth += 1;
      else if (c === '(' || c === '[' || c === '{') {
        if (depth > 0) depth -= 1;
        else {
          if (c === '(') spans.push([m.index, closer(code, i)]);
          break;
        }
      }
    }
  }
  return spans;
}

function settingsRead({ code, fns, lineOf, docs }) {
  const findings = [];
  const spec = docs.map((d) => d.text).join('\n');
  const documented = (key) => new RegExp('`[^`\\n]*\\badvocates\\.' + key.replace(/\$/g, '\\$') + '\\b[^`\\n]*`').test(spec);
  const seen = new Map();
  const rebound = callbacksBindingO(code);
  for (const m of code.matchAll(/\bo\.([A-Za-z_$][\w$]*)/g)) {
    if (rebound.some(([from, to]) => m.index > from && m.index < to)) continue;
    const key = m[1];
    const fn = enclosing(fns, m.index)?.name || null;
    if (!seen.has(key)) seen.set(key, { fns: new Set(), first: m.index });
    if (fn) seen.get(key).fns.add(fn);
  }
  const configDoc = docs.find((d) => d.file === CONFIG_DOC);
  let besideLine = 1;
  let besideKey = null;
  if (configDoc) {
    const lines = configDoc.text.split('\n');
    lines.forEach((l, i) => {
      const m = l.match(/^\|\s*`advocates\.([A-Za-z_$][\w$]*)`/);
      if (m) {
        besideLine = i + 1;
        besideKey = m[1];
      }
    });
  }
  for (const [key, s] of seen) {
    if (documented(key)) continue;
    const fnList = [...s.fns];
    findings.push({
      kind: 'undocumented-setting',
      fns: fnList,
      fn: fnList[0] || null,
      key,
      file: CONFIG_DOC,
      line: besideLine,
      message: `no row names \`advocates.${key}\` — read at ${ADVOCATE}:${lineOf(s.first)}${fnList[0] ? ` in ${fnList[0]}` : ''}; add one beside \`advocates.${besideKey || '…'}\``,
      suite: 'test/configtable.mjs, when the key has a default',
    });
  }
  return findings;
}

/* ===================================================================== *
 * 4. the module a sweep lives in
 * ===================================================================== */

/** Names a module exports as functions. */
export function exportedFunctions(moduleSrc) {
  const code = codeOf(moduleSrc);
  const names = new Set();
  for (const m of code.matchAll(/\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  return [...names];
}

function moduleWiring({ code, advocateSrc, moduleRel, moduleText }) {
  const findings = [];
  const base = moduleRel.replace(/^lib\//, './');
  const imported = new RegExp(`from\\s+['"]${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(String(advocateSrc));
  const exported = exportedFunctions(moduleText);
  if (!imported) {
    findings.push({
      kind: 'not-wired',
      fn: null,
      file: ADVOCATE,
      line: 1,
      message: `${ADVOCATE} does not import ${base} — nothing in the tick can reach ${moduleRel}`,
      suite: null,
    });
  }
  const uncalled = exported.filter((n) => callsTo(code, n).length === 0);
  if (imported && exported.length && uncalled.length === exported.length) {
    findings.push({
      kind: 'not-wired',
      fn: null,
      file: ADVOCATE,
      line: 1,
      message: `${ADVOCATE} imports ${base} and never calls any of ${exported.join(', ')} — it is not a sweep the tick reaches`,
      suite: null,
    });
  }
  return { findings, exported };
}

/* ===================================================================== *
 * the whole
 * ===================================================================== */

/**
 * `{ reached, findings, notes, targets }`.
 *
 * `advocateSrc`, `wsshapeSrc` are the two files' text; `docs` is `[{file, text}]` for the
 * specification. `sweep` narrows the answer to one function — by its own name or by the
 * name a function in the advocate calls it — and `module` (`{ rel, text }`) widens that to
 * everything the module exports and adds the wiring check for it.
 */
export function analyse({ advocateSrc, wsshapeSrc, docs = [], sweep = null, module = null }) {
  const code = codeOf(advocateSrc);
  const fns = functionsIn(code);
  const lineOf = lineIndex(code);

  const names = new Set(fns.map((f) => f.name));
  const reached = new Set();
  for (const root of ['tick', 'tickOne']) {
    const f = fns.find((x) => x.name === root);
    if (!f) continue;
    const body = code.slice(f.open, f.close);
    for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (names.has(m[1]) && m[1] !== 'tick' && m[1] !== 'tickOne') reached.add(m[1]);
    }
  }

  let findings = [
    // Comments blanked and nothing else, as `test/wsshape.mjs` reads it: a template hole
    // is code, and `${a.workspace}` is the `[object Object]` bug it exists to find. The
    // same length as `code`, so every index below means the same place in both.
    ...workspaceShape({ code: blankComments(String(advocateSrc)), fns, lineOf, wsshapeSrc }),
    ...settingsRead({ code, fns, lineOf, docs }),
  ];
  const clocks = intervalClocks({ code, fns, lineOf });
  findings.push(...clocks.findings);
  let notes = clocks.notes;

  let exported = [];
  if (module) {
    const wired = moduleWiring({ code, advocateSrc, moduleRel: module.rel, moduleText: module.text });
    findings.push(...wired.findings);
    exported = wired.exported;
  }

  let targets = null;
  if (sweep || module) {
    targets = new Set([...(sweep ? [sweep] : []), ...exported]);
    // The function a call to one of the names sits in owns what that call needs — the
    // *smallest* one, because every helper here is nested inside `createAdvocates` and
    // `tickOne` calls all of them, and a caller that broad would claim every finding.
    for (const t of [...targets]) {
      for (const c of callsTo(code, t)) {
        const home = enclosing(fns, c.at)?.name;
        if (home && !BROAD.has(home)) targets.add(home);
      }
    }
    const known = [...targets].some((t) => names.has(t) || callsTo(code, t).length);
    findings = findings.filter(
      (f) => f.kind === 'not-wired' || f.kind === 'unreadable' || targets.has(f.fn) || targets.has(f.callee) || (f.fns || []).some((n) => targets.has(n))
    );
    notes = notes.filter((n) => (n.fns || []).some((x) => targets.has(x)));
    if (!known && sweep) return { reached: [...reached], findings: [], notes: [], targets: [...targets], unknown: true };
  }
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { reached: [...reached].sort(), findings, notes, targets: targets ? [...targets] : null, unknown: false };
}

/** One line per finding: where, what, and what goes red without it. */
export function renderFinding(f) {
  const tail = f.suite ? `  [red: ${f.suite}]` : '  [silent: no suite fails]';
  return `${f.file}:${f.line}  ${f.message}${tail}`;
}
