/**
 * The exhibit on a card: which paths it links, and whether the phone can open them.
 *
 * `bc-dgx7.166`, from a session audit of four sessions — `dv-gr6.131`, `dv-gr6.36`,
 * `dv-gr6.13`, `dv-5eu.70` — that each put a draft, an audit or an image on a card by hand,
 * four different ways, and none of them ended green. What they had in common was a
 * question `lib/reachable.js` cannot answer: it holds one verdict for the whole checkout
 * ("is this branch trunk?"), and what a session actually needs is one verdict **per path**,
 * about a card that already exists.
 *
 * ## What the phone reads
 *
 * `docs:` and `images:` in the drawn `decision` block are **absolute paths on this Mac**.
 * `docUrl` wraps whatever `docs:` holds as `/doc?p=<the string>`, and `/api/asset` serves a
 * file only when it is under one of the configured `assetRoots` *and* has one of the
 * extensions in `SERVABLE_EXT` below — 415 for anything else, 403 outside the roots, 404 for
 * a path that is not there. The daemon reads the **main checkout**, never a worktree, so a
 * path into a worktree works today and 404s the day the tidy sweep retires that worktree.
 * That is what makes "link the file I just wrote on my branch" a trap: the path that works
 * when tested is the one that will not survive, and the path that will survive does not
 * exist until the branch merges.
 *
 * ## The two answers this gives
 *
 * The path written on a card is always the **main-checkout form** — a path under this
 * branch's worktree is translated, so it is the same path once the branch merges. And the
 * verdict says which side of that merge it is on right now:
 *
 *  - `live`         — a file is at that path in the main checkout now. The phone opens it.
 *  - `after-merge`  — not there yet, but it is committed on this branch (or on the base ref).
 *                     It becomes `live` when the branch lands and the checkout advances, so
 *                     a gate that says "missing" before then is right, and is not a mistake.
 *  - `uncommitted`  — on disk in the worktree only. Commit it and it is `after-merge`.
 *  - `gitignored`   — on disk, and ignored, so no merge will ever carry it to the checkout.
 *  - `stub`         — the path holds no bytes: an LFS pointer, or a `<file>.md` sidecar that
 *                     stands in for media that lives elsewhere.
 *  - `outside-roots`— the daemon would answer 403.
 *  - `missing`      — nowhere at all.
 *
 * `live` and `after-merge` are the two a card may carry; the rest can never open on a phone
 * without something other than merging changing first, so writing one is refused.
 *
 * ## Why this file holds no policy about any one repo
 *
 * The rule that sends a session here is one workspace's own (it lives in that repo's
 * CLAUDE.md, with its own gate scripts), but everything measured above is beadcause's — the
 * roots, the extensions, the field order the card is drawn from. So this is beadcause's
 * account of when a path on a card works, and the workspace's gate is a separate reader of
 * the same facts. It shells out to `git` and touches the filesystem only through the
 * `ctx` handed in, which is what lets the suite build a repo in a temp dir.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { parseDecision, stripDecisionBlocks } from './decision.js';
import { trunkBranch } from './reachable.js';

/**
 * Mirrors `IMAGE_EXT` / `DOC_EXT` in lib/server.js, which cannot be imported without
 * booting the daemon (see the note on lib/approvallabels.js). test/b7eexhibit.mjs reads
 * server.js and fails on any difference, so this is a copy with a witness, not a promise.
 */
export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg'];
export const DOC_EXT = ['.md', '.markdown', '.txt', '.log', '.csv', '.json', '.jsonl', '.yaml', '.yml', '.pdf'];
export const SERVABLE_EXT = new Set([...IMAGE_EXT, ...DOC_EXT]);

/** The three fields `toQuestion` reads, in the order it reads them. */
export const FIELDS = ['description', 'design', 'notes'];

/** What a card that has no `decision` block carries its exhibit under instead. */
export const SECTION_HEADING = '**Up for review**';

/** Verdicts a card may carry. Everything else is a path that cannot open on a phone. */
export const OK_VERDICTS = new Set(['live', 'after-merge']);

/** The refusal each malformed input earns, and the exit code `bin/b7e-exhibit` gives it. */
export const REFUSAL_EXIT = {
  url: 3,
  route: 3,
  unservable: 4,
  'not-an-image': 4,
  relative: 5,
  encoded: 5,
};

/* ----------------------------------------------------------------------- the path */

function unfile(s) {
  if (!s.startsWith('file://')) return s;
  const rest = s.slice('file://'.length);
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/** `~`, `file://` and `%20` (in a `file://` only) resolved. A relative path stays relative. */
export function absoluteOf(raw) {
  let s = unfile(String(raw ?? '').trim());
  if (s === '~' || s.startsWith('~/')) s = path.join(os.homedir(), s.slice(1));
  return s;
}

/**
 * Why `raw` may not go under `docs:` / `images:` at all — decided from the string and
 * nothing else, so it can run before any repo is read. `null` when the string is fit to
 * be looked up.
 */
export function refusalFor(kind, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { code: 'empty', why: `an empty path in ${kind}:` };
  if (/^https?:\/\//i.test(s)) {
    return { code: 'url', why: `a URL in ${kind}: — the phone opens it as /doc?p=<url>, which is a 404; pass it as a link instead` };
  }
  if (/^\/(v|doc|docket|graph|api)(\/|\?|$)/.test(s)) {
    return { code: 'route', why: `a beadcause route in ${kind}: — it is wrapped as /doc?p=<route> and 404s; pass it as a link instead` };
  }
  const p = absoluteOf(s);
  if (!path.isAbsolute(p)) {
    return { code: 'relative', why: `a relative path — nothing resolves it against a checkout, so it lands on the daemon's working directory; give the absolute path` };
  }
  // Hand-encoding looks like the careful thing and is the opposite: `docUrl` encodes once
  // more, and `/api/asset` then hunts for a file that really has "%20" in its name. A
  // `file://` URL is decoded above, so this is only a bare path that carries an escape.
  if (!s.startsWith('file://') && /%[0-9a-f]{2}/i.test(s) && !fs.existsSync(p)) {
    return { code: 'encoded', why: `a path with a %-escape in it — write the characters themselves; the phone encodes once and this would be encoded twice` };
  }
  const ext = path.extname(p).toLowerCase();
  if (!SERVABLE_EXT.has(ext)) {
    return { code: 'unservable', why: `/api/asset will not serve ${ext || 'a file with no extension'} (415) — link the document, not the source that writes it` };
  }
  if (kind === 'images' && !IMAGE_EXT.includes(ext)) {
    return { code: 'not-an-image', why: `${ext} is not an image — it belongs under docs:` };
  }
  return null;
}

/** `p`, or — when it does not exist yet — its deepest existing ancestor made real. */
function realish(p) {
  const tail = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail.reverse());
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return p;
      tail.push(path.basename(cur));
      cur = up;
    }
  }
}

const within = (p, root) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------- the context */

function gitIn(cwd, args, { maxBuffer = 1024 * 1024 } = {}) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: res.status ?? -1, out: (res.stdout || '').trim() };
}

/**
 * Everything the verdicts are read against, gathered once.
 *
 * `main` and `here` are `null` when `dir` is not a git checkout — every path is then judged
 * on the filesystem alone, which is the honest answer: with no branch there is no
 * `after-merge` to be had. `base` is the ref a path must be on to count as landed, and
 * defaults to the trunk `lib/reachable.js` already resolves.
 */
export function makeContext({ dir, at = '', assetRoots = [] }) {
  const cwd = dir || process.cwd();
  const top = gitIn(cwd, ['rev-parse', '--show-toplevel']);
  const common = gitIn(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const here = top.code === 0 && top.out ? realish(top.out) : null;
  const main = here && common.code === 0 && common.out ? realish(path.dirname(common.out)) : null;
  return {
    cwd,
    here,
    main,
    base: at || (here ? trunkBranch(here) : ''),
    assetRoots: (assetRoots || []).map((r) => realish(path.resolve(r))),
    git: (args, opts) => gitIn(here || cwd, args, opts),
  };
}

/**
 * Where an absolute path really lives, in terms of the repo: the main-checkout form it
 * will have once this branch merges, and the repo-relative path that names it in git.
 *
 * A path under this branch's worktree, or under any other `.claude/worktrees/<name>/` of
 * the same repo (live or in the retired attic), is translated to the main checkout, and
 * `via` says so. A path outside every checkout of this repo keeps its own form and has no
 * `rel` — nothing about it can be read from git.
 */
export function locate(declared, ctx) {
  const abs = path.resolve(absoluteOf(declared));
  const seen = [...new Set([abs, realish(abs)])];
  const wt = ctx.main
    ? new RegExp(`^${escapeRe(ctx.main)}/\\.claude/worktrees(?:-retired)?/([^/]+)/(.+)$`)
    : null;
  for (const p of seen) {
    if (ctx.here && ctx.main && ctx.here !== ctx.main && within(p, ctx.here)) {
      const rel = path.relative(ctx.here, p);
      return { declared: abs, rel, canonical: path.join(ctx.main, rel), via: 'this branch' };
    }
    const m = wt?.exec(p);
    if (m) return { declared: abs, rel: m[2], canonical: path.join(ctx.main, m[2]), via: m[1] };
    if (ctx.main && within(p, ctx.main) && p !== ctx.main) {
      const rel = path.relative(ctx.main, p);
      return { declared: abs, rel, canonical: path.join(ctx.main, rel), via: null };
    }
  }
  return { declared: abs, rel: null, canonical: abs, via: null };
}

const LFS_MAGIC = 'version https://git-lfs.github.com/spec/v1';

function blobPointer(ctx, rev, rel) {
  const size = ctx.git(['cat-file', '-s', `${rev}:${rel}`]);
  if (size.code !== 0 || Number(size.out) > 1024) return false;
  return ctx.git(['cat-file', '-p', `${rev}:${rel}`]).out.startsWith(LFS_MAGIC);
}

function filePointer(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > 1024) return false;
    return fs.readFileSync(p, 'utf8').startsWith(LFS_MAGIC);
  } catch {
    return false;
  }
}

/**
 * The facts a verdict is drawn from, one path. Every one is a fact about a place, never a
 * judgement — the judgement is `verdictOf`, so a suite can hold either half still.
 */
export function factsOf(loc, ctx) {
  const ext = path.extname(loc.canonical).toLowerCase();
  const here = ctx.here && loc.rel !== null;
  const has = (rev) => here && ctx.git(['cat-file', '-e', `${rev}:${loc.rel}`]).code === 0;
  const atHead = has('HEAD');
  const onBase = ctx.base ? has(ctx.base) : false;
  const inMain = isFile(loc.canonical);
  const onDisk = isFile(loc.declared);
  const ignored = here && !atHead && ctx.git(['check-ignore', '-q', '--', loc.rel]).code === 0;
  const realCanonical = realish(loc.canonical);
  return {
    servable: SERVABLE_EXT.has(ext),
    inMain,
    onDisk,
    atHead,
    onBase,
    ignored,
    pointer: (inMain && filePointer(loc.canonical)) || (atHead && !inMain && blobPointer(ctx, 'HEAD', loc.rel)),
    sidecar:
      !inMain &&
      !atHead &&
      (isFile(`${loc.canonical}.md`) || isFile(`${loc.declared}.md`) || (here && ctx.git(['cat-file', '-e', `HEAD:${loc.rel}.md`]).code === 0)),
    inRoots: !ctx.assetRoots.length || ctx.assetRoots.some((r) => within(realCanonical, r)),
  };
}

/**
 * The verdict for one path — see the top of this file for the vocabulary. The order is the
 * argument: a path the daemon would refuse is refused however present it is, a file that
 * is really there beats every statement about a branch, and only then does the branch
 * decide between "will be", "could be" and "never".
 */
export function verdictOf(facts, ctx = {}) {
  const base = ctx.base || 'the base';
  if (!facts.inRoots) return { verdict: 'outside-roots', ok: false, why: '/api/asset answers 403 — the path is outside every configured assetRoot' };
  if (facts.inMain) {
    return facts.pointer
      ? { verdict: 'stub', ok: false, why: 'the file is a git-lfs pointer — the phone would be handed the pointer text, not the bytes' }
      : { verdict: 'live', ok: true, why: 'a file is at that path in the main checkout now' };
  }
  if (facts.atHead) {
    return facts.pointer
      ? { verdict: 'stub', ok: false, why: 'the committed file is a git-lfs pointer — the bytes are not in the repo' }
      : { verdict: 'after-merge', ok: true, why: 'committed on this branch — it opens on a phone once the branch merges and the main checkout advances' };
  }
  if (facts.onBase) {
    return { verdict: 'after-merge', ok: true, why: `on ${base} but this Mac's main checkout has not advanced to it yet` };
  }
  if (facts.sidecar) return { verdict: 'stub', ok: false, why: 'only a sidecar is here — the media it describes has no bytes on this Mac' };
  if (facts.ignored) return { verdict: 'gitignored', ok: false, why: 'the file is gitignored, so no merge will ever put it in the main checkout' };
  if (facts.onDisk) return { verdict: 'uncommitted', ok: false, why: 'the file is on disk in this worktree but not committed — commit it and it is after-merge' };
  return { verdict: 'missing', ok: false, why: 'no file at that path here, in the main checkout, or on this branch' };
}

/** One path, end to end: the string checks, the translation, the facts, the verdict. */
export function judgePath(kind, raw, ctx) {
  const refused = refusalFor(kind, raw);
  if (refused) return { kind, raw, canonical: null, verdict: refused.code, ok: false, why: refused.why, refusal: refused.code, facts: null };
  const loc = locate(raw, ctx);
  const facts = factsOf(loc, ctx);
  const v = verdictOf(facts, ctx);
  return { kind, raw, canonical: loc.canonical, via: loc.via, verdict: v.verdict, ok: v.ok, why: v.why, refusal: null, facts };
}

/* ------------------------------------------------------------------------- the card */

const MD_LINK = /(^|[^!])\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)/g;
const MD_LINK_SPACED = /(^|[^!])\[([^\]\n]*)\]\(\s*(\/[^)\n]*\s[^)\n]*)\)/g;
// A path-shaped token in prose — the "names a file, links nothing" reading. Repo-relative
// (`docs/X.md`, resolved against the main checkout) or absolute under /Users or ~/, where a
// space is allowed because the files this matters for live under `Delmar Book 3/`.
const EXT = 'md|markdown|txt|log|csv|json|jsonl|yaml|yml|pdf|png|jpg|jpeg|gif|webp|avif|svg';
const CITE = new RegExp(`(?<![\\w/.-])((?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\\.(?:${EXT}))(?![\\w])`, 'g');
const CITE_ABS = new RegExp(`(?<![\\w./-])((?:/Users/|~/)[^\\n\`"'<>()\\[\\]|*]*?\\.(?:${EXT}))(?![\\w])`, 'g');

/** Every path a piece of prose names, absolute ones first and without their tails counted twice. */
export function citedPaths(prose) {
  const text = String(prose || '');
  const abs = [...text.matchAll(CITE_ABS)].map((m) => absoluteOf(m[1]));
  const rest = text.replace(CITE_ABS, ' ');
  const rel = [...rest.matchAll(CITE)].map((m) => m[1]);
  return [...new Set([...abs, ...rel])];
}

/**
 * What a bead already shows: every `docs:` / `images:` / `links:` entry in every block on it
 * (the drawn one first, since it is the one the phone draws), and every markdown link in its
 * prose that points at a path. Prose with the blocks cut out is returned for the citation scan.
 */
export function exhibitsOf(bead) {
  const entries = [];
  const prose = [];
  const unparsed = [];
  let drawn = true;
  for (const field of FIELDS) {
    const text = String(bead?.[field] || '');
    if (!text) continue;
    const { body, blocks } = stripDecisionBlocks(text);
    for (const block of blocks) {
      const d = parseDecision(block.text).decision;
      if (!d) unparsed.push(field);
      else {
        for (const x of d.docs) entries.push({ field, kind: 'docs', label: x.label, raw: x.path, drawn });
        for (const x of d.images) entries.push({ field, kind: 'images', label: '', raw: x, drawn });
        for (const x of d.links) entries.push({ field, kind: 'links', label: x.label, raw: x.url, drawn });
      }
      drawn = false;
    }
    prose.push(body);
    for (const m of body.matchAll(MD_LINK)) {
      if (/^(file:\/\/|~\/|\/)/.test(m[3])) entries.push({ field, kind: 'prose', label: m[2], raw: m[3], drawn: false });
      else if (/^https?:\/\//i.test(m[3])) entries.push({ field, kind: 'links', label: m[2], raw: m[3], drawn: false });
    }
    for (const m of body.matchAll(MD_LINK_SPACED)) {
      entries.push({ field, kind: 'prose-spaced', label: m[2], raw: m[3].trim(), drawn: false });
    }
  }
  return { entries, prose: prose.join('\n'), unparsed };
}

/**
 * The audit of one card: a verdict per exhibit, and the two findings that are about the
 * card rather than a path — an approval that links nothing, and a card that names a file it
 * could have linked. Writes nothing and reads nothing but the bead it is handed.
 */
export function auditCard(bead, ctx) {
  const { entries, prose, unparsed } = exhibitsOf(bead);
  const rows = [];
  for (const e of entries) {
    if (e.kind === 'links') {
      const empty = !String(e.raw || '').trim();
      rows.push({ ...e, canonical: null, verdict: empty ? 'empty' : 'link', ok: !empty, why: empty ? 'a link with no url' : 'a URL — nothing on this Mac to check', facts: null });
      continue;
    }
    if (e.kind === 'prose-spaced') {
      rows.push({ ...e, canonical: null, verdict: 'spaced-link', ok: false, why: 'an absolute path with a space in a markdown link — the linkifier stops at the space and it renders as dead text; use docs:, or file:// with %20', facts: null });
      continue;
    }
    const judged = judgePath(e.kind === 'prose' ? 'docs' : e.kind, e.raw, ctx);
    const row = { ...e, ...judged, kind: e.kind };
    // A path under a worktree "works" while that worktree lives, which is exactly why it is
    // worse than a broken one: nothing looks wrong until the sweep retires it.
    if (!row.refusal && row.via) {
      row.verdict = 'worktree';
      row.ok = false;
      row.why = `points into ${row.via === 'this branch' ? 'this branch' : `the worktree ${row.via}`} — it 404s once that worktree is retired; use ${row.canonical}`;
    }
    rows.push(row);
  }

  const warnings = [];
  const linked = rows.some((r) => r.kind !== 'links' || r.ok);
  const labels = bead?.labels || [];
  if (!linked && labels.includes('needs-approval')) {
    rows.push({ kind: 'card', raw: '', canonical: null, verdict: 'unlinked', ok: false, why: 'labelled needs-approval and links nothing — an approval with nothing to approve', facts: null });
  }
  // A file the prose names is either linked (some entry above resolves to it), or it is grey
  // text nobody can tap. Per file, not per card: linking one draft does not link the other.
  const shown = new Set(rows.map((r) => r.canonical).filter(Boolean));
  for (const r of rows) if (r.kind === 'prose-spaced') shown.add(absoluteOf(r.raw));
  for (const m of citedPaths(prose)) {
    const abs = path.isAbsolute(m) ? m : ctx.main ? path.join(ctx.main, m) : null;
    if (!abs || shown.has(abs)) continue;
    if (isFile(abs) && SERVABLE_EXT.has(path.extname(abs).toLowerCase())) {
      rows.push({ kind: 'card', raw: m, canonical: abs, verdict: 'dead-path', ok: false, why: 'the card names a file that is in the main checkout and links nothing — in prose it is grey text you cannot tap', facts: null });
    } else if (!linked) {
      warnings.push(`names ${m} in prose and links nothing`);
    }
  }
  if (unparsed.length) warnings.push(`a decision block in ${[...new Set(unparsed)].join(', ')} is not valid YAML — its exhibits could not be read`);
  return { id: bead?.id || '', title: bead?.title || '', rows, warnings, ok: rows.every((r) => r.ok) };
}

/* -------------------------------------------------------------------- the write side */

/** A YAML scalar on one line — `lineWidth: 0` because the default folds at 80 columns. */
function scalar(s) {
  const y = YAML.stringify(String(s), { lineWidth: 0 }).trim();
  return y.includes('\n') ? JSON.stringify(String(s)) : y;
}

/** `- label: …` / `path: …`, indented to match the list they join. */
function itemLines(kind, item, ind) {
  if (kind === 'images') return [`${ind}- ${scalar(item)}`];
  const key = kind === 'docs' ? 'path' : 'url';
  return [`${ind}- label: ${scalar(item.label)}`, `${ind}  ${key}: ${scalar(item[key])}`];
}

const KEYS = { docs: ['docs', 'doc', 'files', 'read'], images: ['images', 'image'], links: ['links'] };

/**
 * `inner` (the YAML between a block's fences) with `items` added under `kind:`, as text
 * surgery rather than a parse-and-print — a round trip through a YAML library would
 * rewrite the block's comments and quoting, and the block is the one thing on the card the
 * phone parses. Appends to the list already there when there is one (in that list's own
 * indent), and adds a new key at the end when there is not.
 *
 * Throws `{ code: 'inline' }` for a key written inline (`docs: [a, b]`), which cannot be
 * extended without re-printing it.
 */
export function insertUnder(inner, kind, items) {
  if (!items.length) return inner;
  const lines = inner.replace(/\n$/, '').split('\n');
  const keyRe = new RegExp(`^(${KEYS[kind].join('|')})\\s*:(.*)$`);
  const at = lines.findIndex((l) => keyRe.test(l));
  if (at === -1) {
    const out = [...lines, `${kind}:`, ...items.flatMap((it) => itemLines(kind, it, '  '))];
    return out.join('\n') + '\n';
  }
  const tail = keyRe.exec(lines[at])[2].replace(/^\s*#.*$/, '').trim();
  if (tail) throw Object.assign(new Error(`${kind}: is written inline on the block (${lines[at].trim()}) — expand it into a list first`), { code: 'inline' });
  let last = at;
  for (let j = at + 1; j < lines.length; j += 1) {
    const l = lines[j];
    if (l.trim() === '') continue;
    if (/^\s/.test(l) || /^-\s/.test(l)) last = j;
    else break;
  }
  const firstItem = lines.slice(at + 1, last + 1).find((l) => /^\s*-\s/.test(l));
  const ind = firstItem ? /^(\s*)/.exec(firstItem)[1] : '  ';
  lines.splice(last + 1, 0, ...items.flatMap((it) => itemLines(kind, it, ind)));
  return lines.join('\n') + '\n';
}

/** A card with no block carries its exhibit as a markdown list under this heading. */
function proseHref(p) {
  return /\s/.test(p) ? `file://${encodeURI(p)}` : p;
}

/**
 * The write a card needs to carry `add`, or `null` when it already carries all of it — the
 * property that makes a second run leave the card byte-identical.
 *
 * `add` is `{ docs: [{label, path}], images: [path], links: [{label, url}] }`, every path
 * already judged and already in main-checkout form. The block the phone draws is edited in
 * place; a bead with no block gets a `**Up for review**` list on its description, because
 * that is the one spot a card with nowhere for keys still shows links.
 */
export function planExhibit(bead, add) {
  const seen = new Set();
  const key = (k, v) => `${k}\u0000${v}`;
  const { entries } = exhibitsOf(bead);
  for (const e of entries) seen.add(key(e.kind === 'prose' ? 'docs' : e.kind, e.kind === 'links' ? e.raw : absoluteOf(e.raw)));
  const fresh = {
    docs: (add.docs || []).filter((d) => !seen.has(key('docs', d.path)) && !seen.has(key('images', d.path))),
    images: (add.images || []).filter((p) => !seen.has(key('images', p)) && !seen.has(key('docs', p))),
    links: (add.links || []).filter((l) => !seen.has(key('links', l.url))),
  };
  const count = fresh.docs.length + fresh.images.length + fresh.links.length;
  if (!count) return null;

  const field = FIELDS.find((f) => stripDecisionBlocks(String(bead?.[f] || '')).blocks.length) || null;
  if (field) {
    const text = String(bead[field]);
    const block = stripDecisionBlocks(text).blocks[0];
    const cut = block.text.indexOf(block.raw);
    let inner = block.raw;
    for (const kind of ['docs', 'images', 'links']) inner = insertUnder(inner, kind, fresh[kind]);
    const next = block.text.slice(0, cut) + inner + block.text.slice(cut + block.raw.length);
    const at = text.indexOf(block.text);
    return { mode: 'block', field, before: text, after: text.slice(0, at) + next + text.slice(at + block.text.length), fresh, count };
  }

  const text = String(bead?.description || '');
  const lines = [
    ...fresh.docs.map((d) => `- [${d.label}](${proseHref(d.path)})`),
    ...fresh.images.map((p) => `- [${path.basename(p)}](${proseHref(p)})`),
    ...fresh.links.map((l) => `- [${l.label}](${l.url})`),
  ];
  const src = text.split('\n');
  const h = src.findIndex((l) => l.trim() === SECTION_HEADING);
  let after;
  if (h === -1) {
    const head = text.replace(/\s+$/, '');
    after = `${head ? `${head}\n\n` : ''}${SECTION_HEADING}\n\n${lines.join('\n')}`;
  }
  else {
    let last = h;
    for (let j = h + 1; j < src.length; j += 1) {
      if (/^\s*-\s/.test(src[j]) || (src[j].trim() === '' && j === h + 1)) last = j;
      else break;
    }
    src.splice(last + 1, 0, ...lines);
    after = src.join('\n');
  }
  return { mode: 'section', field: 'description', before: text, after, fresh, count };
}
