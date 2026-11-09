/**
 * Conflict hotspots — the files that keep making merges expensive, and a bead for each.
 *
 * Every conflict resolution here costs a window: a resolver, a MergeAdvocate, or a worker
 * stopping its own work to downmerge. Each of those fixes the conflict in front of it and
 * nothing remembers *where* it was, so the same file conflicts again on the next pair of
 * branches, and the one after. Measured on a busy space (bc-8nyxa): replaying 400 merges
 * through `git merge-tree`, seven files accounted for nearly every conflict — two
 * append-only logs, a README every branch adds a line to, three generated one-line JSON
 * blobs, and a check script carrying hard-coded expected counts. None of those is a
 * disagreement between branches. They are *shapes* that make independent work collide,
 * and a shape can be changed once instead of resolved forty times.
 *
 * So this does two things, and nothing else:
 *
 * 1. **Keeps a ledger of which files conflicted, per repo.** It does not instrument the
 *    places that resolve conflicts — there are at least four (resolver sessions, the
 *    MergeAdvocate, a worker's own downmerge, Adam by hand) and one of them is not even
 *    this process. It reads the history instead: every resolution leaves a merge commit
 *    behind, and replaying that merge's two parents through `git merge-tree` says
 *    exactly which paths conflicted, whoever resolved them. Incremental — the ledger
 *    remembers the last base tip it scanned — and retroactive on first run, so a repo
 *    starts with its last `WINDOW_DAYS` of history rather than from nothing.
 * 2. **Files one bead per file that crosses `MIN_CONFLICTS` in the window**, naming the
 *    file, when and where in it the conflicts landed, what shape it looks like, and the
 *    restructuring that fits that shape. It is filed through lib/filing.js like any
 *    agent's discovery, so it carries `unendorsed` unless the space auto-endorses: the
 *    advocate has the option to work it, and Adam decides whether it should.
 *
 * **It never edits a file.** Restructuring a hotspot is real work with a real diff and it
 * goes through a worker and a pull request like everything else. Nothing here knows any
 * particular repo either — the shapes are generic and the bead says how confident the
 * guess is.
 *
 * **One bead per file, and a second only if the first did not work.** An open bead with
 * the file's key label stops a refile. A closed one stops it too, until the file has
 * conflicted `MIN_CONFLICTS` more times *after* the close — at which point the restructure
 * evidently did not hold, and the new bead says so and names the old one.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { writeJsonAtomic } from './atomic.js';
import { CONFIG_DIR, OBSERVING } from './config.js';
import { fileBeads } from './filing.js';
import { autoEndorseAllowed } from './spaces.js';

export const HOTSPOTS_PATH = path.join(CONFIG_DIR, 'hotspots.json');

/** The label every hotspot bead carries — one query finds them all. */
export const HOTSPOT_LABEL = 'conflict-hotspot';
/** Per-file key label prefix: `hotspot:<12 hex>` of `<repo>:<path>`. */
export const HOTSPOT_KEY_PREFIX = 'hotspot:';

/** How far back a file's conflicts count. Also how much history a first scan replays. */
export const WINDOW_DAYS = 30;
/** Conflicts in the window before a file is a hotspot. Four is "this is a pattern", not bad luck. */
export const MIN_CONFLICTS = 4;
/** A cap on one scan, so a first run over a very busy repo is bounded. */
export const MAX_MERGES_PER_SCAN = 500;
/** Conflicted paths read back per merge for their marker lines. Beyond this, names only. */
const MAX_REGION_PATHS = 20;

/**
 * A conflicted file is a *rewrite collision* — a one-off, not a shape — when one parent's
 * copy is at least this many times the size of the other's. That is a branch cut before
 * the file was split or cut down on main (bc-xl7n.209: a 6,700-line pre-split file against
 * a 171-line chapter; bc-xl7n.210: 37k lines against 87). Restructuring cannot help it:
 * the file already was restructured, and the branch is merely stale.
 */
export const REWRITE_RATIO = 8;
/** Below this the larger side is too small for the ratio to mean anything. */
const REWRITE_MIN_BYTES = 2000;

const DAY = 24 * 3600 * 1000;

/** git's stdout and exit code, never a throw: `merge-tree` answers 1 for a conflict. */
function gitRaw(dir, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: dir, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** `<repo>:<path>` → the stable key label. Repo by name, not dir, so every Mac agrees. */
export function hotspotKey(repo, file) {
  const h = crypto.createHash('sha1').update(`${repo}:${file}`).digest('hex').slice(0, 12);
  return `${HOTSPOT_KEY_PREFIX}${h}`;
}

/** The repo's name as a tracker shared between Macs would know it: origin's basename. */
export async function repoName(dir) {
  const r = await gitRaw(dir, ['config', '--get', 'remote.origin.url']);
  const url = r.stdout.trim();
  const base = (url ? url.split(/[/:]/).pop() : '') || path.basename(dir);
  return base.replace(/\.git$/, '');
}

/** The base ref to read history from: `origin/<base>` when there is one, else `<base>`. */
async function baseRef(dir, base) {
  for (const ref of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
    if ((await gitRaw(dir, ['rev-parse', '--verify', '--quiet', ref])).code === 0) return ref;
  }
  return '';
}

/** The 1-based line numbers of every `<<<<<<<` in a blob — where in the file it conflicted. */
export function markerLines(text) {
  const out = [];
  String(text)
    .split('\n')
    .forEach((l, i) => {
      if (/^<{7}( |$)/.test(l)) out.push(i + 1);
    });
  return out;
}

/** True when the two sizes read as a wholesale rewrite on one side. Pure. */
export function isRewriteCollision(a, b) {
  if (!(a > 0) || !(b > 0)) return false; // an add/delete is not a rewrite
  const big = Math.max(a, b);
  return big >= REWRITE_MIN_BYTES && big / Math.min(a, b) >= REWRITE_RATIO;
}

async function sizeAt(dir, rev, file) {
  const r = await gitRaw(dir, ['cat-file', '-s', `${rev}:${file}`]);
  return r.code === 0 ? Number(r.stdout.trim()) : 0;
}

/**
 * Replay one merge. `{ files: [paths], regions: { path: [lines] }, rewrites: [paths] }`
 * (`rewrites` are files whose two sides differ in size by `REWRITE_RATIO`), or null when git
 * could not say (an octopus, a parent missing from this clone, a git without --write-tree).
 */
export async function replayMerge(dir, p1, p2) {
  const r = await gitRaw(dir, ['merge-tree', '--write-tree', '--name-only', '--no-messages', p1, p2]);
  if (r.code === 0) return { files: [], regions: {}, rewrites: [] };
  if (r.code !== 1) return null;
  const lines = r.stdout.split('\n');
  const tree = lines[0].trim();
  const files = [];
  for (const l of lines.slice(1)) {
    if (!l) break;
    if (!files.includes(l)) files.push(l);
  }
  const regions = {};
  for (const f of files.slice(0, MAX_REGION_PATHS)) {
    const b = await gitRaw(dir, ['show', `${tree}:${f}`]);
    if (b.code === 0 && !b.stdout.slice(0, 8000).includes('\0')) {
      const m = markerLines(b.stdout);
      if (m.length) regions[f] = m;
    }
  }
  const rewrites = [];
  for (const f of files) {
    if (isRewriteCollision(await sizeAt(dir, p1, f), await sizeAt(dir, p2, f))) rewrites.push(f);
  }
  return { files, regions, rewrites };
}

/**
 * The merges on `ref` not yet in the ledger: `[{ sha, at, p1, p2 }]`, oldest first.
 *
 * From `seen` when it is still an ancestor; otherwise (first run, or a rewritten base)
 * the whole window, and the caller drops what it already has by sha.
 */
async function newMerges(dir, ref, seen, now) {
  let range = [ref];
  if (seen && (await gitRaw(dir, ['merge-base', '--is-ancestor', seen, ref])).code === 0) range = [`${seen}..${ref}`];
  else range = [`--since=${new Date(now - WINDOW_DAYS * DAY).toISOString()}`, ref];
  const r = await gitRaw(dir, ['log', '--merges', `--max-count=${MAX_MERGES_PER_SCAN}`, '--format=%H %ct %P', ...range]);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split(' '))
    .filter((p) => p.length === 4) // two parents exactly; an octopus never conflicts
    .map(([sha, ct, p1, p2]) => ({ sha, at: new Date(Number(ct) * 1000).toISOString(), p1, p2 }))
    .reverse();
}

export function readLedger(file = HOTSPOTS_PATH) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && v.repos ? v : { repos: {} };
  } catch {
    return { repos: {} };
  }
}

/**
 * Bring one repo's ledger up to date with `<base>`. Returns `{ repo, events, added }`.
 *
 * An event is one merge that conflicted: `{ sha, at, files, regions }`. Clean merges are
 * not stored — only `seen` moves past them. Events older than the window are pruned on
 * every write, so the file stays the size of a month of conflicts.
 */
export async function scanRepo(dir, { base = 'main', now = Date.now(), ledgerPath = HOTSPOTS_PATH } = {}) {
  const repo = await repoName(dir);
  const ref = await baseRef(dir, base);
  const ledger = readLedger(ledgerPath);
  const entry = ledger.repos[repo] || { seen: '', events: [] };
  if (!ref) return { repo, events: entry.events, added: 0, error: `no ${base} in ${dir}` };

  const tip = (await gitRaw(dir, ['rev-parse', ref])).stdout.trim();
  const known = new Set(entry.events.map((e) => e.sha));
  let added = 0;
  if (tip && tip !== entry.seen) {
    for (const m of await newMerges(dir, ref, entry.seen, now)) {
      if (known.has(m.sha)) continue;
      const res = await replayMerge(dir, m.p1, m.p2);
      if (!res || !res.files.length) continue;
      entry.events.push({ sha: m.sha, at: m.at, files: res.files, regions: res.regions, rewrites: res.rewrites });
      known.add(m.sha);
      added++;
    }
    entry.seen = tip;
  }
  const cutoff = now - WINDOW_DAYS * DAY;
  entry.events = entry.events.filter((e) => new Date(e.at).getTime() >= cutoff);
  ledger.repos[repo] = entry;
  writeJsonAtomic(ledgerPath, ledger);
  return { repo, events: entry.events, added };
}

/**
 * Files that conflicted in at least `min` merges since `since`, worst first:
 * `[{ file, count, events: [{ sha, at, lines }] }]`.
 */
export function hotspotsOf(events, { min = MIN_CONFLICTS, since = 0 } = {}) {
  const by = new Map();
  for (const e of events || []) {
    if (new Date(e.at).getTime() < since) continue;
    for (const f of e.files || []) {
      // A stale branch meeting a file main already rewrote is not evidence the shape is bad.
      if ((e.rewrites || []).includes(f)) continue;
      if (!by.has(f)) by.set(f, []);
      by.get(f).push({ sha: e.sha, at: e.at, lines: e.regions?.[f] || [] });
    }
  }
  return [...by.entries()]
    .map(([file, evs]) => ({ file, count: evs.length, events: evs }))
    .filter((h) => h.count >= min)
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
}

/**
 * The patterns. Each is a shape a file can have that makes independent branches edit the
 * same lines, and the restructure that takes that collision away. Order matters:
 * `classify` returns the first that matches.
 */
export const SHAPES = {
  blob: {
    name: 'one-line generated blob',
    why: 'The whole file is one (or a few) enormous lines, so *any* two edits anywhere in it are the same line to git.',
    fix: [
      'If it is generated from other files in the repo, stop committing it: build it where it is consumed (a build step, a server route, a pre-commit hook) and add it to `.gitignore`.',
      'If it must be committed, emit it one record per line, sorted by a stable key (e.g. `JSON.stringify` per entry, joined with `,\\n`), so two branches adding or changing different records touch different lines.',
      'Either way, make sure whatever regenerates it is deterministic (stable key order, no timestamps), or every regeneration is a whole-file change again.',
    ],
  },
  log: {
    name: 'append-only log',
    why: 'Every branch adds its entry at the same end of the file, so every pair of branches conflicts on the same few lines even though they never disagree.',
    fix: [
      'If it is a numbered, newest-first log and the repo merges through the beadcause merge queue, turn on changesets for it (lib/changesets.js, bc-7vt6r): branches write `changelog.d/<bead-id>.md` with `{{N}}` for the number, and the merge advocate numbers and folds them in. Check whether it is already on before doing anything else — if it is, find out what is still writing the log directly.',
      'Split it into fragments: one small file per entry in a directory (e.g. `<name>.d/<date>-<slug>.md`), and either read the directory where the log is consumed or compile the single file at release/build time. Branches then only ever add new files.',
      'If the single file must stay, and only local merges touch it, `merge=union` in `.gitattributes` keeps both sides automatically — but GitHub ignores custom merge drivers, so this does not help pull requests merged there.',
      'If entries are written by a tool, change the tool to write a fragment instead of appending.',
    ],
  },
  index: {
    name: 'registry / index every branch adds to',
    why: 'Each new thing registers itself with a line in one shared list, so branches adding different things collide at the list\'s end or at the same heading.',
    fix: [
      'Generate the list from the things themselves (front matter, a directory listing, a manifest per item) instead of maintaining it by hand.',
      'If it stays hand-written, keep it strictly sorted with one entry per line, so additions land in different places rather than all at the bottom.',
      'Move volatile sections (status tables, counts, "latest" lists) out into their own file, generated or fragmented, and leave the rest of the document stable.',
    ],
  },
  expectations: {
    name: 'hard-coded expected values',
    why: 'The file pins numbers or strings that change whenever the content changes, so every branch that changes content edits the same constants.',
    fix: [
      'Derive the expected values at run time from the source of truth rather than pinning them.',
      'If they must be pinned, move them to a data file with one entry per line (one key per item), so branches changing different items touch different lines.',
    ],
  },
  module: {
    name: 'large module edited from many directions',
    why: 'Unrelated changes all land in one big file; even when they touch different functions, shared tables, imports and nearby lines collide.',
    fix: [
      'Look at where the conflicts landed (the line numbers below). If they cluster in one table, list or switch, move that into its own file, one entry per line.',
      'If they are spread out, split the module by concern so independent work lands in different files.',
      'Keep import lists and registries sorted, one per line.',
    ],
  },
  other: {
    name: 'unclassified',
    why: 'Nothing about the file\'s shape explains the collisions on its own.',
    fix: [
      'Read the conflicted regions below: if they are the same few lines every time, those lines are a shared counter, list or summary that should be generated or split out.',
      'If the conflicts are genuine disagreements about content, there may be nothing to restructure — close this with that reason.',
    ],
  },
};

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.sh', '.php', '.cs']);
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.rst', '.adoc', '']);

/**
 * A guess at the shape of `file`, from its content at `ref` and its name. Pure — `text`
 * is handed in — so a test can pin every branch. Returns a key of `SHAPES`.
 */
export function classify(file, text) {
  const name = path.basename(file).toLowerCase();
  const ext = path.extname(name);
  const lines = String(text || '').split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const size = String(text || '').length;

  if (lines.length <= 3 && size > 2000) return 'blob';
  // The name outranks one long line: a changelog with a pasted table is still a log.
  if (/(change_?log|changes|history|news|journal|(^|[_.-])log)([_.-]|$)/.test(name) && TEXT_EXT.has(ext)) return 'log';
  if (longest > 4000 && !TEXT_EXT.has(ext)) return 'blob';
  if (/^(readme|index|toc|contents|summary|manifest|registry|catalog|sidebar)([_.-]|$)/.test(name)) return 'index';
  if (CODE_EXT.has(ext)) {
    // A test or check script dense with literal numbers in assertions pins expectations.
    const pinned = lines.filter((l) => /(==|expect|assert|EXPECTED|: *\d{2,})/.test(l) && /\d{2,}/.test(l)).length;
    if (/(test|check|spec|audit|gate)/.test(name) && pinned >= 10) return 'expectations';
    if (lines.length > 800) return 'module';
  }
  if (TEXT_EXT.has(ext) && lines.length > 500) return 'log';
  return 'other';
}

/** One hotspot → the bead lib/filing.js files. `previous` is a closed bead that did not hold. */
export function hotspotBead(repo, spot, shapeKey, { windowDays = WINDOW_DAYS, previous = null } = {}) {
  const shape = SHAPES[shapeKey] || SHAPES.other;
  const history = spot.events
    .slice(-12)
    .map((e) => `- ${e.at.slice(0, 10)} \`${e.sha.slice(0, 9)}\`${e.lines.length ? ` — markers at line${e.lines.length > 1 ? 's' : ''} ${e.lines.slice(0, 8).join(', ')}` : ''}`)
    .join('\n');
  const description = [
    `\`${spot.file}\` in **${repo}** conflicted in **${spot.count}** merges in the last ${windowDays} days. ` +
      'Each one cost a resolution session. The aim of this bead is to restructure the file so parallel branches stop editing the same lines — not to change what it does.',
    ...(previous ? ['', `A previous restructure (${previous}) was closed, and the file has kept conflicting since. Read what it did before trying again.`] : []),
    '',
    `**Likely shape: ${shape.name}.** ${shape.why} (A guess from the file's size, name and line lengths — confirm it before acting on it.)`,
    '',
    '**Patterns that fit this shape:**',
    ...shape.fix.map((f) => `- ${f}`),
    '',
    '**Where the conflicts landed** (merge date, merge commit, line numbers of the conflict markers in the merged file):',
    history,
    '',
    '**How to work it.** Replay a couple of the merges above (`git merge-tree --write-tree <parent1> <parent2>`, then `git show <tree>:' +
      spot.file +
      '`) to see what actually collided. Pick the smallest change that makes those collisions impossible, update whatever reads or writes the file, and leave a short note in the repo (a comment at the top of the file or the contributor doc) saying how it is now meant to be edited, so the next agent does not undo it. ' +
      'If the conflicts turn out to be genuine disagreements rather than a shape, close this bead saying so.',
  ].join('\n');
  return {
    title: `Conflict hotspot: restructure ${spot.file} (${repo}) — ${spot.count} conflicted merges in ${windowDays}d`,
    type: 'task',
    priority: 3,
    description,
    acceptance:
      `Branches that each make an ordinary change to what ${spot.file} holds no longer conflict with each other there; ` +
      'whatever consumes or generates it still works; the new editing convention is written down in the repo.',
    labels: [HOTSPOT_LABEL, hotspotKey(repo, spot.file)],
  };
}

/** The file's text at the base ref, for `classify`. Empty on any failure. */
async function textAt(dir, ref, file) {
  const r = await gitRaw(dir, ['show', `${ref}:${file}`]);
  return r.code === 0 ? r.stdout : '';
}

/**
 * Scan one repo and file a bead for every new hotspot. Called after a merge lands in it
 * (lib/mergesweep.js). Never throws; returns `{ repo, added, filed: [ids], skipped, error }`.
 *
 * `bd` and `ws` are the workspace the repo's beads live in. `file` is injectable so a test
 * never writes to a real tracker.
 */
export async function fileHotspots(
  bd,
  cfg,
  ws,
  dir,
  { base = 'main', now = Date.now(), ledgerPath = HOTSPOTS_PATH, file = fileBeads, min = MIN_CONFLICTS } = {}
) {
  const out = { repo: '', added: 0, filed: [], skipped: [], error: '' };
  if (OBSERVING) return { ...out, error: 'observer daemon — files nothing' };
  try {
    const scan = await scanRepo(dir, { base, now, ledgerPath });
    out.repo = scan.repo;
    out.added = scan.added;
    if (scan.error) return { ...out, error: scan.error };
    const ref = await baseRef(dir, base);
    for (const spot of hotspotsOf(scan.events, { min })) {
      const key = hotspotKey(scan.repo, spot.file);
      const existing = (await bd.listLabelAny(ws, key).catch(() => [])) || [];
      if (existing.some((b) => b.status !== 'closed')) {
        out.skipped.push(spot.file);
        continue;
      }
      // Closed: only refile when it has conflicted `min` more times since the close.
      let previous = null;
      let candidate = spot;
      if (existing.length) {
        const last = existing.reduce((a, b) => (String(a.closed_at || '') > String(b.closed_at || '') ? a : b));
        const since = new Date(last.closed_at || last.updated_at || 0).getTime();
        candidate = hotspotsOf(scan.events, { min, since }).find((h) => h.file === spot.file);
        if (!candidate) {
          out.skipped.push(spot.file);
          continue;
        }
        previous = last.id;
      }
      const bead = hotspotBead(scan.repo, candidate, classify(spot.file, await textAt(dir, ref, spot.file)), { previous });
      const res = await file(bd, ws, [bead], {
        endorsed: Boolean(autoEndorseAllowed(cfg || {}, ws.name)),
        homeLabel: HOTSPOT_LABEL,
        onWarn: () => {},
      });
      for (const f of res?.filed || []) out.filed.push(f.id || f);
    }
  } catch (err) {
    out.error = String(err?.message || err).split('\n')[0];
  }
  return out;
}

/** One log line, or empty when nothing happened worth saying. */
export function describeHotspots(o) {
  if (!o) return '';
  if (o.error) return `hotspot scan of ${o.repo || 'repo'} failed — ${o.error}`;
  if (!o.filed.length) return '';
  return `${o.repo}: filed ${o.filed.length} conflict-hotspot bead${o.filed.length > 1 ? 's' : ''} (${o.filed.join(', ')})`;
}
