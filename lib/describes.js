/**
 * Which paragraphs of the specification describe the code that just changed —
 * `bin/b7e-describes` is the argv shell; this is the diff reading and the matching.
 *
 * bc-dgx7.165 names five sessions (`bc-xl7n.162`, `bc-sj8k.1`, `bc-rfnr.9.13`, `bc-sj8k.6`,
 * `bc-y8k4.8`) that each changed a behaviour in `lib/` and then had to find the sentences in
 * `README.md` and `docs/*.md` the change had made false. None could ask for that: each
 * guessed a phrase and grepped, and they guessed differently every time — one with a
 * deliberately misspelt stem (`andidate`) because it did not know whether the prose said
 * *Candidate* or *candidates*. `lib/readme.js` answers "where does this term live?" for a
 * term somebody already has; this answers the question in front of them, which is "what
 * did I just change, and who has written about it?", and it starts from the diff.
 *
 * **What a change names.** A changed file contributes its path (`lib/redbase.js`, and the
 * bare `redbase.js` a paragraph is just as likely to write), or its command name if it is
 * an extensionless `bin/` script or a `package.json` `bin` target. A changed *code* file
 * also contributes every top-level definition whose body the diff touched — read on the new
 * side for what was added or edited and on the **old** side for what was removed, because a
 * deleted function is the paragraph most certain to be false. The changed lines themselves
 * contribute the `/api/…` routes, `BEADCAUSE_*` environment variables and `cfg.a.b` config
 * keys they mention. Nothing here is fuzzy: every name is a literal the diff put on the
 * table, and every hit is a paragraph that contains that literal.
 *
 * **Plain English is not a name.** A function called `slug` or `analyze` would match every
 * sentence that uses the word. A lowercase-only name therefore matches only when the prose
 * marks it as code (`` `slug` ``, `` `slug()` ``); a name with a capital, an underscore or a
 * digit in it (`baseVerdict`, `MAX_ATTEMPTS`) is not a word anybody wrote by accident and
 * matches bare.
 *
 * **A hit is a block, not a line.** The set is cut into headings, table rows, list items,
 * paragraphs and code lines; a bullet is reported whole, a paragraph as the sentence or
 * sentences that name the thing, since "the sentence or bullet itself" is what a reader
 * decides about. Every hit carries the innermost heading it sits under and that heading's
 * anchor slug (`lib/readme.js`'s, the rule `test/anchors.mjs` enforces).
 *
 * **Neighbours: the paragraph that is false without naming anything.** The bc-xl7n.162 case
 * that started this is the reason. The fix touched `baseVerdict`; the prose that names it is
 * one clause at docs/landing.md:403, and the bullet the fix actually contradicted — "**And
 * it lifts by itself.**", thirty lines up, in the same `###` — mentions neither the file nor
 * the function. No literal in the diff finds it, and a search that could would have to
 * understand the sentence. What *can* be said mechanically is that a paragraph which names
 * the changed code is where a reader is already looking, so every section holding a hit also
 * lists its nearest paragraphs that do **not** name anything, one line each, nearest first.
 * They are labelled as exactly that — neighbours, not matches — and `--near 0` drops them.
 *
 * **Headings are the other half.** A document edited so that a heading's slug no longer
 * exists leaves every `](#old-slug)` link pointing at nothing, and `test/anchors.mjs` is the
 * last thing to notice — bc-y8k4.8 rewrote "The caller — …, and why the sweep waits" and
 * found its inbound links by hand. So each changed document is compared against its merge
 * base, and a heading that has left it is reported with every inbound link to its old
 * anchor, from any document in the set, `README.md`'s `docs/x.md#slug` form included.
 *
 * **Every path through it is a read.** The only subprocess is `git`, and only its
 * `merge-base`, `diff`, `show`, `ls-files` and `rev-parse`. Nothing is written, in the tree
 * or anywhere else, and a module no document mentions returns no hits rather than an error.
 *
 * **What this does not do.** Definitions are found the way `bin/b7e-def` finds them — by
 * matching lines at column 0, not by parsing JavaScript — so a template literal with an
 * unindented `function` inside it can add a phantom name (harmless: nothing names it) or
 * end a definition early (the tail of that definition is then not attributed to it). A
 * config key is found only where the code spells it `cfg.a.b`, `config.a.b` or
 * `options.a.b`; one read some other way is not seen. Line-level tables, sketches and
 * fenced code are searched too, but a diagram drawn around a name in box-drawing
 * characters is matched only if the name survives intact on one line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { docFiles, readDocs } from './docset.js';
import { analyze, headingFor } from './readme.js';

/** The subtrees whose top-level definitions become search terms. `test/` is deliberately
 * out: a suite's helper names are not something the specification describes, though the
 * suite's own path is still a term. */
const CODE_DIRS = ['lib/', 'bin/', 'scripts/', 'public/'];
const CODE_EXT = new Set(['.js', '.mjs', '.cjs']);
const MAX_FILE_BYTES = 2_000_000;

/* -------------------------------------------------------------------- git */

const git = (root, args) => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

/** This process's own worktree root, so a session in `.claude/worktrees/<n>` reads that
 * worktree's uncommitted edits — never the main checkout's, which is where `bin/` on `PATH`
 * lives and so where `import.meta.url` would send us. */
export function repoRootOf(cwd = process.cwd()) {
  const out = git(cwd, ['rev-parse', '--show-toplevel']);
  return out ? out.trim() : null;
}

/** What "since origin/main" is measured from: the merge base with `origin/main`, else
 * `main`, else `null` (a repo with neither — only uncommitted work counts). */
export function mergeBaseOf(root) {
  for (const cand of ['origin/main', 'main']) {
    if (git(root, ['rev-parse', '--verify', '--quiet', cand]) === null) continue;
    const mb = git(root, ['merge-base', cand, 'HEAD']);
    if (mb && mb.trim()) return mb.trim();
  }
  return null;
}

/**
 * `Map<file, { status, added: [{n, text}], removed: [{n, text}] }>` for everything changed
 * since `base` — commits, staged and unstaged edits in one diff — plus untracked files,
 * which have no diff and are wholly added. `-U0` because only which lines moved matters,
 * and `--no-renames` so a moved file is a deletion and an addition: the old path is the
 * one prose still names.
 */
export function changesSince(root, base) {
  const changes = new Map();
  const diff = git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', base || 'HEAD', '--']);
  let cur = null;
  let header = false; // between a file's `diff` line and its first hunk, where `---`/`+++` are names
  let from = null;
  let oldN = 0;
  let newN = 0;
  for (const line of (diff || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = null;
      header = true;
      from = null;
      continue;
    }
    if (header) {
      if (line.startsWith('--- ')) {
        from = line.slice(4);
        continue;
      }
      if (line.startsWith('+++ ') && from !== null) {
        const to = line.slice(4);
        const file = to === '/dev/null' ? from.replace(/^a\//, '') : to.replace(/^b\//, '');
        const status = from === '/dev/null' ? 'A' : to === '/dev/null' ? 'D' : 'M';
        // a path it had to quote is not one this repo has, and not worth guessing at
        cur = file.startsWith('"') ? null : { status, added: [], removed: [] };
        if (cur) changes.set(file, cur);
        continue;
      }
      if (!line.startsWith('@@')) continue;
      header = false;
    }
    if (!cur) continue;
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldN = Number(hunk[1]);
      newN = Number(hunk[3]);
      continue;
    }
    if (line.startsWith('+')) cur.added.push({ n: newN++, text: line.slice(1) });
    else if (line.startsWith('-')) cur.removed.push({ n: oldN++, text: line.slice(1) });
  }
  for (const rel of (git(root, ['ls-files', '--others', '--exclude-standard']) || '').split('\n').filter(Boolean)) {
    const abs = path.join(root, rel);
    try {
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      const text = fs.readFileSync(abs, 'utf8');
      const added = text.split('\n').map((t, i) => ({ n: i + 1, text: t }));
      changes.set(rel, { status: 'A', added, removed: [] });
    } catch {
      /* unreadable: nothing to say about it */
    }
  }
  return changes;
}

const readNew = (root, file) => {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return null;
  }
};
const readOld = (root, base, file) => git(root, ['show', `${base || 'HEAD'}:${file}`]);

/* ------------------------------------------------------------ definitions */

const DEF_PATTERNS = [
  /^(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^(export\s+)?(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/,
];
const LEADING_COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

/**
 * Top-level definitions of one JavaScript file: `[{ name, exported, start, end }]`, 1-based
 * and inclusive, each range covering the doc comment above the declaration and the body
 * below it. A body runs through blank lines, indented lines and column-0 closers (`}`,
 * `)`, `]`, and a chained `.then(`); the first other column-0 line ends it, so imperative
 * statements at the top level of a `bin/` script belong to no definition rather than being
 * swallowed by whichever `const` came before them.
 */
export function definitions(text) {
  const lines = text.split('\n');
  const starts = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const wasIn = inBlock;
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
    } else if (/^\s*\/\*/.test(line) && !line.includes('*/', line.indexOf('/*') + 2)) {
      inBlock = true;
    }
    if (wasIn || inBlock) continue;
    for (const re of DEF_PATTERNS) {
      const m = re.exec(line);
      if (m) {
        starts.push({ name: m[2], exported: Boolean(m[1]), decl: i });
        break;
      }
    }
  }
  const out = [];
  for (const s of starts) {
    let start = s.decl;
    while (start > 0 && LEADING_COMMENT.test(lines[start - 1])) start -= 1;
    let end = s.decl;
    for (let i = s.decl + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === '' || /^\s/.test(line) || /^[}\])]/.test(line) || /^\./.test(line)) {
        if (line.trim() !== '') end = i;
        continue;
      }
      break;
    }
    out.push({ name: s.name, exported: s.exported, start: start + 1, end: end + 1 });
  }
  // `export { a, b }` at the bottom of a file exports names declared earlier.
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      const def = out.find((d) => d.name === name);
      if (def) def.exported = true;
    }
  }
  return out;
}

/** Names of the definitions in `defs` whose range holds any of the changed `lines`. */
const touched = (defs, lines) => defs.filter((d) => lines.some((l) => l.n >= d.start && l.n <= d.end));

/* ------------------------------------------------------------------ terms */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** How a name is recognised in prose — see the header for why a plain lowercase word is
 * only a match when it is marked as code. */
export function nameRe(name) {
  if (/^[a-z]+$/.test(name)) return new RegExp('`' + escapeRe(name) + '(?:\\(\\))?`');
  return new RegExp('(?<![\\w$])' + escapeRe(name) + '(?![\\w$])');
}

const isCodeFile = (file, first) => {
  if (!CODE_DIRS.some((d) => file.startsWith(d))) return false;
  const ext = path.extname(file);
  if (CODE_EXT.has(ext)) return true;
  return ext === '' && file.startsWith('bin/') && /^#!.*\bnode\b/.test(first || '');
};

function pathTerm(file) {
  const dir = path.posix.dirname(file);
  const base = path.posix.basename(file);
  const ext = path.posix.extname(file);
  const bin = dir === 'bin' && ext === '';
  // `bin/b7e-x` is also the command `b7e-x`, which is how prose writes it; `lib/x.js` is
  // often just `x.js`. A dir-less basename is only allowed when it carries an extension or
  // is a command, and never when a longer path precedes it (`test/x.js` is not `x.js` of
  // another directory).
  const src = `(?<![\\w./-])(?:${escapeRe(dir)}\\/)?${escapeRe(base)}(?![\\w-])`;
  return { text: file, kind: bin ? 'cli' : 'path', re: new RegExp(src) };
}

const ROUTE_RE = /['"`](\/(?:api|internal)\/[A-Za-z0-9_\-./]+)/g;
const ENV_RE = /\bBEADCAUSE_[A-Z0-9_]+\b/g;
const CONFIG_RE = /\b(?:cfg|config|options)\.([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)/g;

function literalsIn(lines) {
  const out = [];
  for (const { text } of lines) {
    // A comment that mentions a route is describing it, not registering it.
    if (LEADING_COMMENT.test(text)) continue;
    for (const m of text.matchAll(ROUTE_RE)) {
      // A route with a parameter is named by the part before it: `/api/bead/:id` is
      // `/api/bead`, which is what the prose says.
      const cut = m[1].split(/\/:|\$\{/)[0].replace(/\/$/, '');
      if (cut.split('/').filter(Boolean).length >= 2) {
        out.push({
          text: cut,
          kind: 'route',
          re: new RegExp('(?<![\\w/])' + escapeRe(cut) + '(?![\\w-])'),
        });
      }
    }
    for (const m of text.matchAll(ENV_RE)) out.push({ text: m[0], kind: 'env', re: nameRe(m[0]) });
    for (const m of text.matchAll(CONFIG_RE)) {
      out.push({ text: m[1], kind: 'config', re: new RegExp('(?<![\\w.])' + escapeRe(m[1]) + '(?![\\w])') });
    }
  }
  return out;
}

function packageBinKeys(root, file) {
  const pkg = readNew(root, 'package.json');
  if (!pkg) return [];
  try {
    const bin = JSON.parse(pkg).bin || {};
    return Object.entries(bin)
      .filter(([, v]) => v === file || v === `./${file}`)
      .map(([k]) => k);
  } catch {
    return [];
  }
}

/**
 * What one changed file puts into the search: `[{ text, kind, re, from }]`. `only` narrows
 * to a single named definition — `b7e-describes lib/redbase.js baseVerdict` — and then the
 * path, command and diff literals are left out on purpose: the question was about the one
 * name.
 */
export function termsForFile(root, base, file, change, { only = null, explicit = false } = {}) {
  const terms = [];
  const push = (t) => terms.push({ ...t, from: file });
  const nowText = change.status === 'D' ? null : readNew(root, file);
  const oldText = change.status === 'A' ? null : readOld(root, base, file);
  const first = (nowText ?? oldText ?? '').split('\n', 1)[0];
  const code = isCodeFile(file, first);
  const nowDefs = code && nowText ? definitions(nowText) : [];
  const oldDefs = code && oldText ? definitions(oldText) : [];

  if (only) {
    const known = [...nowDefs, ...oldDefs].some((d) => d.name === only);
    if (!known) return { terms, error: `${file} defines no top-level '${only}'` };
    push({ text: only, kind: 'export', re: nameRe(only) });
    return { terms };
  }

  push(pathTerm(file));
  for (const key of packageBinKeys(root, file)) {
    push({ text: key, kind: 'cli', re: new RegExp('(?<![\\w/-])' + escapeRe(key) + '(?![\\w-])') });
  }
  if (!code) return { terms };

  const hitDefs = explicit && change.added.length + change.removed.length === 0
    ? nowDefs.filter((d) => d.exported)
    : [...touched(nowDefs, change.added), ...touched(oldDefs, change.removed)];
  const seen = new Set();
  for (const d of hitDefs) {
    if (d.name.length < 4 || seen.has(d.name)) continue;
    // A file's own plain-word locals (`cwd`, `root`, `argv`) are not something prose
    // describes, and a script's top level is nothing but them; only an export is a name
    // the specification can be right or wrong about in a plain word.
    if (!d.exported && /^[a-z]+$/.test(d.name)) continue;
    seen.add(d.name);
    push({ text: d.name, kind: d.exported ? 'export' : 'internal', re: nameRe(d.name) });
  }
  for (const t of literalsIn([...change.added, ...change.removed])) push(t);
  return { terms };
}

/* ------------------------------------------------------------------ blocks */

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;
const TABLE = /^\s*\|.*\|\s*$/;
const HEADING = /^#{1,6} +\S/;

/** A document cut into `{ kind, start, end, lines }` blocks — see the header. */
export function blocksOf(text) {
  const lines = text.split('\n');
  const out = [];
  let cur = null;
  let fenced = false;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const n = i + 1;
    if (line.trim().startsWith('```')) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      if (line.trim()) out.push({ kind: 'code', start: n, end: n, lines: [line] });
      continue;
    }
    if (!line.trim()) {
      flush();
    } else if (HEADING.test(line)) {
      flush();
      out.push({ kind: 'heading', start: n, end: n, lines: [line] });
    } else if (TABLE.test(line)) {
      flush();
      out.push({ kind: 'table', start: n, end: n, lines: [line] });
    } else if (BULLET.test(line)) {
      flush();
      cur = { kind: 'bullet', start: n, end: n, lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
      cur.end = n;
    } else {
      cur = { kind: 'prose', start: n, end: n, lines: [line] };
    }
  }
  flush();
  return out;
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The sentences of a paragraph that contain a match — `[{ line, text }]` — where a
 * sentence ends at `. ! ?` (plus any closing quote or markup) and a space. */
function matchingSentences(block, terms) {
  const full = block.lines.join('\n');
  const bounds = [0];
  for (const m of full.matchAll(/[.!?]["')*_`\]]*\s+/g)) bounds.push(m.index + m[0].length);
  bounds.push(full.length);
  const out = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const s = full.slice(bounds[i], bounds[i + 1]);
    if (!terms.some((t) => t.re.test(s))) continue;
    out.push({ line: block.start + full.slice(0, bounds[i]).split('\n').length - 1, text: collapse(s) });
  }
  return out;
}

/* ------------------------------------------------------------ prose search */

const TEXT_LIMIT = 400;
const NEAR_LIMIT = 100;

/**
 * Every block of every document in the set that names any of `terms`, in document order,
 * and for each section holding a hit its nearest `near` blocks that name nothing.
 */
export function findHits(root, terms, { near = 10 } = {}) {
  const hits = [];
  const neighbours = [];
  if (!terms.length) return { hits, neighbours };
  for (const { file, text } of readDocs(root)) {
    const analysis = analyze(text);
    const blocks = blocksOf(text);
    const hitBlocks = new Set();
    const sectionsWithHits = new Map();
    for (const b of blocks) {
      const body = b.lines.join('\n');
      const names = terms.filter((t) => t.re.test(body));
      if (!names.length) continue;
      hitBlocks.add(b);
      const heading = headingFor(analysis, b.start);
      let line = b.start;
      let shown = clip(collapse(body), TEXT_LIMIT);
      if (b.kind === 'prose') {
        const sentences = matchingSentences(b, names);
        if (sentences.length) {
          line = sentences[0].line;
          shown = clip(sentences.map((s) => s.text).join(' … '), TEXT_LIMIT);
        }
      }
      const h = {
        file,
        line,
        endLine: b.end,
        kind: b.kind,
        heading: heading ? { level: heading.level, title: heading.title, slug: heading.slug, line: heading.line } : null,
        names: [...new Set(names.map((t) => t.text))],
        text: shown,
      };
      hits.push(h);
      if (heading) sectionsWithHits.set(heading.line, { heading, at: [] });
    }
    if (!near) continue;
    for (const [hline, sec] of sectionsWithHits) {
      sec.at = hits.filter((h) => h.file === file && h.heading && h.heading.line === hline).map((h) => h.line);
      const pool = blocks.filter(
        (b) =>
          (b.kind === 'prose' || b.kind === 'bullet') &&
          !hitBlocks.has(b) &&
          headingFor(analysis, b.start)?.line === hline
      );
      const dist = (b) => Math.min(...sec.at.map((l) => Math.abs(b.start - l)));
      const nearest = pool.sort((a, b) => dist(a) - dist(b)).slice(0, near).sort((a, b) => a.start - b.start);
      if (!nearest.length) continue;
      neighbours.push({
        file,
        heading: { level: sec.heading.level, title: sec.heading.title, slug: sec.heading.slug, line: sec.heading.line },
        blocks: nearest.map((b) => ({ line: b.start, kind: b.kind, text: clip(collapse(b.lines.join(' ')), NEAR_LIMIT) })),
      });
    }
  }
  return { hits, neighbours };
}

/* --------------------------------------------------------- heading changes */

/** Every inline `](target#fragment)` link in the set, outside fenced code:
 * `[{ file, line, target, fragment, text }]` with `target` resolved to a repo-relative
 * path (the linking file itself when the link is a bare `#fragment`). */
export function inboundLinks(root) {
  const links = [];
  for (const { file, text } of readDocs(root)) {
    let fenced = false;
    text.split('\n').forEach((line, i) => {
      if (line.trim().startsWith('```')) {
        fenced = !fenced;
        return;
      }
      if (fenced) return;
      for (const m of line.matchAll(/\]\(([^)\s#]*)#([^)\s]+)\)/g)) {
        const target = m[1] ? path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])) : file;
        let fragment = m[2];
        try {
          fragment = decodeURIComponent(fragment);
        } catch {
          /* keep it raw */
        }
        links.push({ file, line: i + 1, target, fragment: fragment.toLowerCase(), text: clip(collapse(line), 160) });
      }
    });
  }
  return links;
}

/**
 * For one changed document: each heading it had at `base` whose anchor slug it no longer
 * has, with the heading that took its place when the removals and additions pair up one for
 * one, and every link in the set that still points at the old slug.
 */
export function headingChanges(root, base, file, links) {
  const oldText = readOld(root, base, file);
  const nowText = readNew(root, file);
  if (oldText === null || nowText === null) return [];
  const oldHeads = analyze(oldText).headings;
  const newHeads = analyze(nowText).headings;
  const nowSlugs = new Set(newHeads.map((h) => h.slug));
  const oldSlugs = new Set(oldHeads.map((h) => h.slug));
  const gone = oldHeads.filter((h) => !nowSlugs.has(h.slug));
  const added = newHeads.filter((h) => !oldSlugs.has(h.slug));
  return gone.map((h, i) => {
    const now = gone.length === added.length ? added[i] : null;
    return {
      file,
      line: h.line,
      level: h.level,
      title: h.title,
      slug: h.slug,
      now: now ? { line: now.line, level: now.level, title: now.title, slug: now.slug } : null,
      links: links
        .filter((l) => l.target === file && l.fragment === h.slug)
        .map(({ file: f, line, text }) => ({ file: f, line, text })),
    };
  });
}

/* ------------------------------------------------------------------- whole */

/**
 * The whole answer. `paths` is what the caller named (`[]` for "my diff"); `only` narrows a
 * single named path to one definition. Returns `{ root, base, files, terms, hits,
 * neighbours, headings }`, or `{ error }` for a usage problem the caller should refuse.
 */
export function describes(root, { paths = [], only = null, near = 10 } = {}) {
  const base = mergeBaseOf(root);
  const all = changesSince(root, base);
  const explicit = paths.length > 0;
  const targets = [];
  if (only && paths.length !== 1) return { error: 'a definition name needs exactly one file before it' };

  if (explicit) {
    for (const given of paths) {
      const rel = path.isAbsolute(given) ? path.relative(root, given).split(path.sep).join('/') : given.replace(/^\.\//, '');
      let change = all.get(rel);
      if (!change) {
        // Not in the diff: still a fair question ("who describes this file?") if it exists
        // at all, and answered as if every export of it were in question.
        if (readNew(root, rel) === null && readOld(root, base, rel) === null) {
          return { error: `${given}: no such file in this tree or at the base` };
        }
        change = { status: 'M', added: [], removed: [] };
      }
      targets.push([rel, change]);
    }
  } else {
    for (const [rel, change] of [...all.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) targets.push([rel, change]);
  }

  const docs = new Set(docFiles(root));
  const terms = [];
  const files = [];
  const headingFiles = [];
  for (const [rel, change] of targets) {
    if (docs.has(rel)) {
      headingFiles.push(rel);
      files.push({ file: rel, status: change.status, role: 'document' });
      continue;
    }
    if (rel.endsWith('.md')) continue; // a note that is not in the specification set
    const r = termsForFile(root, base, rel, change, { only: explicit ? only : null, explicit });
    if (r.error) return { error: r.error };
    files.push({ file: rel, status: change.status, role: 'changed' });
    terms.push(...r.terms);
  }

  const unique = new Map();
  for (const t of terms) if (!unique.has(`${t.kind}:${t.text}`)) unique.set(`${t.kind}:${t.text}`, t);
  const list = [...unique.values()];
  const { hits, neighbours } = findHits(root, list, { near });
  const links = headingFiles.length ? inboundLinks(root) : [];
  const headings = headingFiles.flatMap((f) => headingChanges(root, base, f, links));
  return {
    root,
    base,
    files,
    terms: list.map(({ text, kind, from }) => ({ text, kind, from })),
    hits,
    neighbours,
    headings,
  };
}
