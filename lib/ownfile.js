/**
 * Move a pre-split tool branch's own text into the tool's own files (bc-dgx7.189).
 *
 * Since bc-fmk4v a `b7e-*` tool's `### ` section lives in `docs/b7e/<name>.md` and the
 * paragraph arguing for its grant sits above the `@grant` line in `bin/<name>`. Roughly
 * twenty-two pull requests (#14-38) were written before that and carry the section in
 * `README.md`, `docs/advocates.md` or `docs/b7e-tools.md`, and the paragraph at the end of
 * `lib/tooldecl.js`. Four revives of them (bc-dgx7.43, bc-7qo.24, bc-dgx7.85, bc-dgx7.44)
 * each took main's side of the shared files and then moved the text by hand, four ways.
 *
 * The functions here are pure strings-in, strings-out so the suite can prove them on
 * fixtures; `planMove` is the one that reads git, and it takes the git function as a
 * parameter for the same reason.
 */
import { slug } from './readme.js';
import { linkFrom } from './docset.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})[ \t]+(.*)$/;

/** Every heading outside a code fence: `{ line, level, text }`, 0-based line. */
export function headingsOf(text) {
  const out = [];
  let fenced = false;
  text.split('\n').forEach((l, i) => {
    if (FENCE.test(l)) fenced = !fenced;
    else if (!fenced) {
      const m = HEADING.exec(l);
      if (m) out.push({ line: i, level: m[1].length, text: m[2].trim() });
    }
  });
  return out;
}

/**
 * The `### ` sections of `text` whose heading names `name` in backticks, as
 * `{ start, end, text }` with `end` exclusive and 0-based line numbers. A section runs to
 * the next heading of the same or a shallower level, and a trailing blank run belongs to
 * the gap between sections rather than to this one.
 */
export function sectionsFor(text, name) {
  const lines = text.split('\n');
  const heads = headingsOf(text);
  const named = new RegExp('`' + escapeRe(name) + '`');
  const out = [];
  for (const [i, h] of heads.entries()) {
    if (h.level !== 3 || !named.test(h.text)) continue;
    const next = heads.slice(i + 1).find((x) => x.level <= 3);
    let end = next ? next.line : lines.length;
    while (end > h.line + 1 && lines[end - 1].trim() === '') end -= 1;
    out.push({ start: h.line, end, text: lines.slice(h.line, end).join('\n') });
  }
  return out;
}

/** `text` with the line range removed, and one of the two blank lines around it with it. */
export function cutLines(text, start, end) {
  const lines = text.split('\n');
  let e = end;
  while (e < lines.length && lines[e].trim() === '') e += 1;
  // The blank line above the section stays as the separator; add one only if there was none.
  const needBlank = start > 0 && e < lines.length && lines[start - 1].trim() !== '';
  lines.splice(start, e - start, ...(needBlank ? [''] : []));
  return lines.join('\n');
}

/**
 * Rewrite the links in a moved section so they still land where they did.
 *
 * `fromFile` is where the section was, `toFile` where it is going, and `where(slug)` says
 * which file in the current tree owns a heading with that slug (or null). A bare `#slug`
 * that the section itself defines is left alone; one that points elsewhere becomes
 * `<relative path>#slug`. A relative path is resolved against the old location and
 * re-expressed from the new one. Returns `{ text, rewritten, unresolved }`.
 */
export function rewriteLinks(section, { fromFile, toFile, where }) {
  const own = new Set(headingsOf(section).map((h) => slug(h.text)));
  const posixDir = (f) => f.split('/').slice(0, -1).join('/');
  const resolve = (base, rel) => {
    const parts = (base ? base.split('/') : []).concat(rel.split('/'));
    const out = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p !== '.' && p !== '') out.push(p);
    }
    return out.join('/');
  };
  let rewritten = 0;
  const unresolved = [];
  let fenced = false;
  const text = section
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(/\]\(([^)\s]+)\)/g, (whole, href) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return whole;
        if (href.startsWith('#')) {
          const s = href.slice(1);
          if (own.has(s)) return whole;
          const file = where(s);
          if (!file) {
            unresolved.push(href);
            return whole;
          }
          if (file === toFile) return whole;
          rewritten += 1;
          return `](${linkFrom(toFile, file)}#${s})`;
        }
        const [pathPart, frag] = href.split('#');
        const target = resolve(posixDir(fromFile), pathPart);
        const next = linkFrom(toFile, target) + (frag !== undefined ? `#${frag}` : '');
        if (next === href) return whole;
        rewritten += 1;
        return `](${next})`;
      });
    })
    .join('\n');
  return { text, rewritten, unresolved };
}

/** Consecutive `// ` comment runs in a module, as `{ start, end, text }` (text uncommented). */
export function commentBlocks(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; ) {
    if (!/^\s*\/\/(?: |$)/.test(lines[i])) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && /^\s*\/\/(?: |$)/.test(lines[j])) j += 1;
    out.push({ start: i, end: j, text: lines.slice(i, j).map((l) => l.replace(/^\s*\/\/ ?/, '')).join('\n') });
    i = j;
  }
  return out;
}

/**
 * The grant paragraph a pre-split branch appended to `lib/tooldecl.js` for `name`: the
 * comment runs in the branch's version that name the tool and are not in the current one.
 * The generated `→ Bash(name:*)` line that sat under a granted one is dropped — it said
 * where the entry came from, and the header's `@grant` line says that now.
 */
export function grantParagraph(oldSrc, currentSrc, name) {
  const named = new RegExp('(^|[^A-Za-z0-9-])' + escapeRe(name) + '($|[^A-Za-z0-9-])');
  const found = [];
  for (const b of commentBlocks(oldSrc)) {
    if (!named.test(b.text) || currentSrc.includes(b.text.split('\n')[0])) continue;
    const keep = b.text.split('\n').filter((l) => !/^\s*→ Bash\(/.test(l));
    while (keep.length && keep[keep.length - 1].trim() === '') keep.pop();
    if (keep.length) found.push(keep.join('\n'));
  }
  return found.join('\n\n');
}

/** Wrap prose to `width`, keeping the author's own line breaks as paragraph-internal. */
function rewrap(text, width = 92) {
  return text.split('\n').map((l) => (l.length <= width ? l : wrapLine(l, width))).flat();
}
function wrapLine(l, width) {
  const out = [];
  let cur = '';
  for (const w of l.split(' ')) {
    if (cur && cur.length + 1 + w.length > width) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  out.push(cur);
  return out;
}

/**
 * Put `paragraph` in `src`'s header docblock directly above its `@grant` line. Returns the
 * new source, or `{ skipped }` when there is nothing to do or nowhere to put it.
 */
export function placeParagraph(src, paragraph) {
  if (!paragraph) return { skipped: 'no paragraph found' };
  const lines = src.split('\n');
  const at = lines.findIndex((l) => /^[ \t]*\*[ \t]*@grant[ \t]/.test(l));
  if (at === -1) return { skipped: 'no @grant line in the tool header to put it above' };
  const probe = paragraph.split('\n')[0].trim();
  if (src.includes(probe)) return { skipped: 'already in the header' };
  const block = [];
  for (const l of rewrap(paragraph)) block.push(l ? ` * ${l}` : ' *');
  // One blank comment line above the paragraph and one between it and @grant.
  const before = /^[ \t]*\*[ \t]*$/.test(lines[at - 1]) ? [] : [' *'];
  lines.splice(at, 0, ...before, ...block, ' *');
  return { src: lines.join('\n') };
}

/** The old text of a file at a ref, or '' when it is not there. */
function showOr(git, ref, file) {
  try {
    return git(['show', `${ref}:${file}`]);
  } catch {
    return '';
  }
}

/**
 * What would move, computed against a checkout and a git function (`args -> stdout`).
 * Returns `{ sections, paragraph, edits, report, owed }` where `edits` is
 * `[{ rel, before, after }]` in the shape `applyEdits` in lib/enroll.js takes.
 *
 * `read(rel)` reads the current tree and returns '' for a missing file; `files` is the
 * current specification (`docFiles`), `oldFiles` the same list at `ref`.
 */
export function planMove({ name, ref, git, read, files, oldFiles }) {
  const dest = `docs/b7e/${name}.md`;
  const bin = `bin/${name}`;
  const report = [];
  const edits = new Map();
  const edit = (rel, after) => {
    const before = edits.has(rel) ? edits.get(rel).before : read(rel);
    edits.set(rel, { rel, before, after });
  };
  const current = (rel) => (edits.has(rel) ? edits.get(rel).after : read(rel));

  // Which file owns each slug in the current tree, for links that crossed a file boundary.
  const owner = new Map();
  for (const f of files) {
    if (f === dest) continue;
    for (const h of headingsOf(read(f))) if (!owner.has(slug(h.text))) owner.set(slug(h.text), f);
  }

  // ---- the section: first copy found at the ref that the destination does not have
  const have = read(dest);
  let moved = null;
  for (const f of oldFiles) {
    if (f.startsWith('docs/b7e/')) continue;
    const old = showOr(git, ref, f);
    const found = sectionsFor(old, name)[0];
    if (!found) continue;
    // Anchors the section's links point at that moved with it, or never left the old file.
    const oldOwner = new Map();
    for (const h of headingsOf(old)) oldOwner.set(slug(h.text), f);
    const where = (s) => owner.get(s) || oldOwner.get(s) || null;
    const { text, rewritten, unresolved } = rewriteLinks(found.text, { fromFile: f, toFile: dest, where });
    moved = { f, found, text, rewritten, unresolved };
    break;
  }
  if (moved && !sectionsFor(have, name).length) {
    const body = have.trim() ? `${have.replace(/\n+$/, '')}\n\n${moved.text}\n` : `${moved.text}\n`;
    edit(dest, body);
    report.push(
      `section '${moved.found.text.split('\n')[0]}' (${moved.found.end - moved.found.start} lines) from ` +
        `${moved.f}:${moved.found.start + 1}-${moved.found.end} -> ${dest}`
    );
    report.push(`links rewritten: ${moved.rewritten}`);
    for (const u of moved.unresolved) report.push(`link ${u} points at no heading anywhere — left as written`);
  } else if (moved) {
    report.push(`${dest} already has its section — nothing moved`);
  } else if (!sectionsFor(have, name).length) {
    report.push(`no '### … \`${name}\`' section at ${ref} outside docs/b7e/ — nothing to move`);
  }

  // ---- the leftovers in the shared files, as the tree stands now
  for (const f of files) {
    if (f.startsWith('docs/b7e/')) continue;
    for (let secs = sectionsFor(current(f), name); secs.length; secs = sectionsFor(current(f), name)) {
      const s = secs[0];
      edit(f, cutLines(current(f), s.start, s.end));
      report.push(`stale copy (${s.end - s.start} lines) removed from ${f}:${s.start + 1}-${s.end}`);
    }
  }

  // ---- the grant paragraph
  const paragraph = grantParagraph(showOr(git, ref, 'lib/tooldecl.js'), read('lib/tooldecl.js'), name);
  const placed = placeParagraph(current(bin), paragraph);
  if (placed.src !== undefined) {
    edit(bin, placed.src);
    report.push(`grant paragraph (${paragraph.split('\n').length} lines) from lib/tooldecl.js -> ${bin} header above @grant`);
  } else {
    report.push(`grant paragraph: ${placed.skipped}`);
  }

  return { dest, bin, moved, paragraph, edits: [...edits.values()].filter((e) => e.before !== e.after), report };
}
