/**
 * Changesets — a log every branch prepends to, written only by the merge advocate (bc-7vt6r).
 *
 * ## The problem
 *
 * Some repos keep a log whose newest entry goes at the top: delmar's CHANGE_LOG.md, where
 * every ruling is a numbered `## Entry NNN — <date>` block inserted directly under the
 * header. Two open branches that each insert a block there always conflict, because git
 * cannot order two insertions at the same point. On 2026-10-31 #1107 (Entry 271) landing
 * made #1098 (Entries 270, 269) unmergeable, and a resolver session stacked the blocks by
 * hand. The numbers race too. Branches allocate them offline, so two branches pick the
 * same one, and the only fix anybody had was "renumber the later-landing one by hand".
 *
 * Both problems come from a branch writing the log. Only the queue sees pull requests one
 * at a time, so only the queue can number them safely. So a branch writes a **fragment**
 * and the advocate writes the log.
 *
 * ## The shape
 *
 * - **A branch writes `changelog.d/<bead-id>.md`** (the glob is per repo). It holds the
 *   whole entry with `{{N}}` where the number goes: `## Entry {{N}} — 2026-10-31`. A
 *   second entry from the same bead is `<bead-id>__2.md`. A new file in a path of its own
 *   cannot conflict with anything.
 * - **The advocate folds fragments in when it downmerges** (`foldBranch` below, called
 *   from the tick in lib/mergequeue.js in place of GitHub's update-branch). It merges the
 *   base into the head, reads the log's highest number on the merged tree, gives each
 *   fragment the next free number, inserts the blocks newest-first at the log's insertion
 *   point, deletes the fragments, and pushes the result to the pull request's head as one
 *   merge commit. The checks then run on the commit that will actually land: never merge
 *   over a head commit nothing ran on (bc-ysqd.1).
 * - **Per repo, declared in the repo**: `.beadcause/changesets.json`, read off the base
 *   branch, the same convention as checks.json. No file, no behaviour change.
 *
 * ## Order
 *
 * Fragments are numbered in **path order** (natural sort, so `bc-9` before `bc-10`), lowest
 * number first, which puts the last one in path order at the top of the log. Path order
 * rather than commit time because it is a fact about the tree alone: the same tree always
 * numbers the same way, and that is what makes a re-run reproduce the same commit.
 *
 * ## Cross-references
 *
 * A fragment can cite another one that has not landed yet: `{{N:<fragment-name>}}`, where
 * the name is the other fragment's file name without `.md`. Resolved in the same pass, so
 * `[[Entry {{N:dv-x}}]]` becomes `[[Entry 270]]`. A name that is not in this pass is looked
 * up in the fold records already on the base (below). If it is in neither, the pull
 * request is held. A guessed number is worse than none.
 *
 * ## The fold record, idempotence, and the refold
 *
 * Each fold commit carries one trailer line:
 *
 *     Beadcause-Changesets: {"top":271,"entries":[{"path":…,"blob":…,"n":272}],"names":{…}}
 *
 * `top` is the log's highest number when the fold ran. `entries` are the fragments it
 * folded, by blob, so the exact text it inserted can be rebuilt. `names` is every
 * cross-reference it resolved. Three things hang off it:
 *
 * - **Idempotent.** A fold deletes its fragments in the same commit that inserts their
 *   blocks, so the next tick finds no fragments and nothing to do. A crash between the
 *   commit and the push leaves origin's head unchanged. The re-run recomputes from that
 *   head and produces the same tree, because the numbering is a function of the tree.
 * - **The refold.** A folded pull request that then waits, for red checks or a review,
 *   can watch another pull request land a block with the same number. Its log now
 *   conflicts with the base, the same conflict the fragments existed to avoid. So when the
 *   base's highest number has passed the record's `top`, the advocate **unfolds**: it
 *   takes its own blocks back out of the head's log (rebuilt exactly from the record),
 *   restores the fragments, merges the base in again, and folds afresh. Nothing is
 *   hand-resolved. The branch's other edits to the log (Status flips) go through git's
 *   ordinary three-way merge.
 * - **Cross-references to landed fragments.** `{{N:name}}` for a name not in this pass
 *   reads the newest record on the base that mentions it.
 *
 * A folded block that someone edited on the branch after the fold cannot be taken back
 * out exactly. That holds the pull request with a sentence saying so, rather than guessing
 * which lines were the advocate's. To change a folded entry before it lands, edit it and
 * restore the fragment, or wait until it lands.
 *
 * ## What stays a direct edit
 *
 * Only the **prepend** moves to fragments. Flipping an existing entry's `**Status:**` line
 * edits a line inside an entry that has already landed. Two branches flipping two
 * different entries do not conflict, and git merges them on its own. Do not "fix" Status
 * flips into fragments as well.
 *
 * ## Bead titles
 *
 * delmar titles a ruling's tracking bead `Entry NNN — …`, and its
 * check_canon_status_sync.py matches on that. A branch cannot know the number, so it
 * titles the bead `Entry {{N}} — …` (that does not match the gate's pattern, so the
 * gate ignores it until filled in). After a push, the advocate fills in the number on the
 * bead the fragment is named after. Only a title that carries the placeholder is touched:
 * prepending a number to a bead that never asked for one would turn a worker bead into a
 * "canon" bead the gate then fails on. A refold re-fills it from the template, which the
 * record keeps.
 *
 * ## Plumbing only
 *
 * Like lib/premerge.js, nothing here checks anything out: `merge-tree --write-tree`, a
 * throwaway index file for building the folded tree, `commit-tree`, and a fast-forward
 * `push` of that commit to the pull request's branch. The checkout the queue reads is
 * never touched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { git, gitCode, gitInput, ok } from './gitref.js';

export const CONFIG_PATH = '.beadcause/changesets.json';
export const TRAILER = 'Beadcause-Changesets';

/** What a repo gets for any key its changesets.json leaves out. */
export const DEFAULTS = Object.freeze({
  fragments: 'changelog.d/*.md',
  target: 'CHANGE_LOG.md',
  heading: '^## Entry (\\d+)',
  anchor: null,
  token: 'N',
  separator: '\n---\n\n',
  pad: 0,
});

/** File names under the fragment directory that are never fragments. */
const NOT_FRAGMENTS = new Set(['README.md', 'README']);

const naturally = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/**
 * A changesets.json text, checked and filled from DEFAULTS. Returns `{ config }` or
 * `{ error }`. A config that will not parse holds every pull request carrying fragments
 * rather than letting them through unnumbered.
 */
export function parseConfig(text) {
  let raw;
  try {
    raw = JSON.parse(String(text));
  } catch (err) {
    return { error: `${CONFIG_PATH} is not JSON — ${String(err.message || err).split('\n')[0]}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `${CONFIG_PATH} is not an object` };
  const config = { ...DEFAULTS, ...raw };
  for (const key of ['fragments', 'target', 'heading', 'token', 'separator']) {
    if (typeof config[key] !== 'string' || !config[key]) return { error: `${CONFIG_PATH}: "${key}" must be a non-empty string` };
  }
  if (typeof config.anchor !== 'string' || !config.anchor) {
    return { error: `${CONFIG_PATH}: "anchor" must be a regex matching the text the newest entry goes after` };
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(config.token)) return { error: `${CONFIG_PATH}: "token" must be a bare word, like N` };
  try {
    config.headingRe = new RegExp(config.heading, 'm');
    config.anchorRe = new RegExp(config.anchor, 'm');
  } catch (err) {
    return { error: `${CONFIG_PATH}: ${String(err.message || err)}` };
  }
  if (!/\((?!\?)/.test(config.heading)) return { error: `${CONFIG_PATH}: "heading" needs a capture group for the number` };
  config.pad = Number(config.pad) || 0;
  return { config };
}

/** Does `file` (repo-relative) match the config's fragment glob? Only `*` and `?`, never across a `/`. */
export function isFragment(config, file) {
  if (NOT_FRAGMENTS.has(path.posix.basename(file)) || path.posix.basename(file).startsWith('.')) return false;
  const re = new RegExp(
    '^' +
      config.fragments
        .split('')
        .map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$'
  );
  return re.test(file);
}

/** The fixed directory a fragment glob lives under: everything before its first wildcard's segment. */
function fragmentDir(config) {
  const segs = config.fragments.split('/');
  const fixed = [];
  for (const s of segs) {
    if (/[*?]/.test(s)) break;
    fixed.push(s);
  }
  return fixed.join('/');
}

/** A fragment's name: its file name without the extension, which is what `{{N:name}}` cites. */
export const fragmentName = (file) => path.posix.basename(file).replace(/\.[^.]*$/, '');

/** The bead a fragment is filed under: its name, without a `__2` style suffix. */
export const fragmentBead = (file) => fragmentName(file).replace(/__\d+$/, '');

/** Every entry number in a log text, by the config's heading regex. */
export function entryNumbers(config, text) {
  const re = new RegExp(config.heading, 'gm');
  const out = [];
  for (const m of String(text).matchAll(re)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** The highest entry number in a log, 0 for a log with none. */
export function topNumber(config, text) {
  return entryNumbers(config, text).reduce((a, b) => Math.max(a, b), 0);
}

const fmt = (config, n) => String(n).padStart(config.pad || 0, '0');

/**
 * One fragment's text with its numbers filled in. `names` maps fragment names to their
 * numbers, for `{{N:name}}`. Returns `{ text }` or `{ error }`, and the error is the
 * sentence the merge card shows.
 */
export function render(config, file, body, n, names) {
  const tok = config.token;
  const src = String(body).replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (!src.trim()) return { error: `${file} is empty` };
  const self = `{{${tok}}}`;
  if (!src.includes(self)) return { error: `${file} has no ${self} placeholder where its number goes` };
  const missing = [];
  let text = src.split(self).join(fmt(config, n));
  text = text.replace(new RegExp(`\\{\\{${tok}:([^}\\s]+)\\}\\}`, 'g'), (whole, name) => {
    if (Object.hasOwn(names, name)) return fmt(config, names[name]);
    missing.push(name);
    return whole;
  });
  if (missing.length) {
    return {
      error:
        `${file} cites ${[...new Set(missing)].map((m) => `{{${tok}:${m}}}`).join(', ')}, and no such fragment is ` +
        `in this pull request or already in the log. Cite a landed entry by its number.`,
    };
  }
  const stray = new RegExp(`\\{\\{${tok}[^}]*\\}\\}`).exec(text);
  if (stray) return { error: `${file} has a placeholder the advocate cannot read: ${stray[0]}` };
  const first = text.split('\n').find((l) => l.trim()) || '';
  const m = new RegExp(config.heading).exec(first);
  if (!m || Number(m[1]) !== n) {
    return { error: `${file} must open with the entry heading (${config.heading}) carrying ${self}; it opens "${first.slice(0, 80)}"` };
  }
  return { text: text + '\n' };
}

/**
 * Insert rendered blocks, already newest-first, at the log's insertion point. Returns
 * `{ text }` or `{ error }`.
 */
export function insertBlocks(config, log, blocks) {
  if (!blocks.length) return { text: log };
  const m = config.anchorRe.exec(log);
  if (!m) return { error: `${config.target} has nothing matching the insertion anchor ${JSON.stringify(config.anchor)}` };
  const at = m.index + m[0].length;
  return { text: log.slice(0, at) + blocks.join(config.separator) + config.separator + log.slice(at) };
}

/**
 * Take a fold's blocks back out of a log, the exact text it inserted. Returns `{ text }`
 * or `{ error }` naming the block that is no longer there as written.
 */
export function removeBlocks(config, log, blocks) {
  let text = log;
  for (const { block, n } of blocks) {
    const i = text.indexOf(block + config.separator);
    if (i === -1) {
      return {
        error:
          `Entry ${fmt(config, n)} in ${config.target} was changed on the branch after the advocate folded it in, so it ` +
          `cannot be renumbered safely. Restore its fragment with the edit made there, and take the block out of the log.`,
      };
    }
    text = text.slice(0, i) + text.slice(i + block.length + config.separator.length);
  }
  return { text };
}

/**
 * Number and fold a set of fragments into a log, the pure half of `foldBranch`.
 *
 * `fragments` is `[{ path, body }]`; `landed` maps fragment names already in the log to
 * their numbers (for cross-references); `titles` maps bead ids to title templates. Returns
 * `{ text, entries, names, top }` or `{ error }`.
 */
export function foldText(config, log, fragments, { landed = {} } = {}) {
  const top = topNumber(config, log);
  // By name, not path: `dv-c.md` against `dv-c__2.md` compares `.` with `_` otherwise.
  const sorted = [...fragments].sort((a, b) => naturally(fragmentName(a.path), fragmentName(b.path)) || naturally(a.path, b.path));
  const names = {};
  sorted.forEach((f, i) => {
    names[fragmentName(f.path)] = top + 1 + i;
  });
  const dup = sorted.map((f) => fragmentName(f.path)).find((n, i, all) => all.indexOf(n) !== i);
  if (dup) return { error: `two fragments are both named ${dup}; a fragment's name must be unique` };
  const all = { ...landed, ...names };
  const blocks = [];
  for (const f of sorted) {
    const n = names[fragmentName(f.path)];
    const r = render(config, f.path, f.body, n, all);
    if (r.error) return { error: r.error };
    blocks.push(r.text);
  }
  const ins = insertBlocks(config, log, blocks.reverse());
  if (ins.error) return { error: ins.error };
  // Only the cross-references actually used are recorded, so a record stays a line long.
  const used = {};
  for (const f of sorted) {
    for (const m of String(f.body).matchAll(new RegExp(`\\{\\{${config.token}:([^}\\s]+)\\}\\}`, 'g'))) used[m[1]] = all[m[1]];
  }
  return {
    text: ins.text,
    top,
    names: used,
    entries: sorted.map((f) => ({ path: f.path, n: names[fragmentName(f.path)] })),
  };
}

/** A fold record out of a commit message, or null. */
export function parseRecord(message) {
  const line = String(message || '')
    .split('\n')
    .reverse()
    .find((l) => l.startsWith(`${TRAILER}: `));
  if (!line) return null;
  try {
    const rec = JSON.parse(line.slice(TRAILER.length + 2));
    return rec && Array.isArray(rec.entries) && Number.isFinite(rec.top) ? rec : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ git plumbing */

const show = (dir, spec) => ok(git(dir, ['show', spec]));

/** The base ref to read from: origin's copy first, for behindBase's reason in lib/mergequeue.js. */
async function baseRef(dir, base) {
  for (const ref of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
    const sha = await ok(git(dir, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]));
    if (sha && sha.trim()) return { ref, sha: sha.trim() };
  }
  return null;
}

/** The repo's changesets config as it stands on `ref`: `{ config }`, `{ error }`, or null for none. */
export async function readConfig(dir, ref) {
  const text = await show(dir, `${ref}:${CONFIG_PATH}`);
  if (text === null) return null;
  return parseConfig(text);
}

/** Every fragment path in a tree. */
async function fragmentsIn(dir, config, treeish) {
  const where = fragmentDir(config);
  const out = await ok(git(dir, ['ls-tree', '-r', '--name-only', treeish, ...(where ? ['--', where] : [])]));
  return String(out || '')
    .split('\n')
    .filter(Boolean)
    .filter((f) => isFragment(config, f));
}

/** The newest fold record on commits in `head` that `base` does not have. */
async function branchRecord(dir, baseSha, head) {
  const out = await ok(git(dir, ['log', '-1', '--format=%B', `--grep=^${TRAILER}: `, `${baseSha}..${head}`]));
  return out ? parseRecord(out) : null;
}

/** Names → numbers from fold records already on the base, newest record winning. */
async function landedNames(dir, baseSha, wanted) {
  const found = {};
  if (!wanted.length) return found;
  const out = await ok(git(dir, ['log', '-n', '500', '--format=%x1e%B', `--grep=^${TRAILER}: `, baseSha]));
  for (const msg of String(out || '').split('\x1e')) {
    const rec = parseRecord(msg);
    if (!rec) continue;
    for (const e of rec.entries) {
      const name = fragmentName(e.path);
      if (wanted.includes(name) && !Object.hasOwn(found, name)) found[name] = e.n;
    }
  }
  return found;
}

/** Cross-reference names a set of fragment bodies cite. */
function citedNames(config, bodies) {
  const names = new Set();
  for (const b of bodies) for (const m of String(b).matchAll(new RegExp(`\\{\\{${config.token}:([^}\\s]+)\\}\\}`, 'g'))) names.add(m[1]);
  return [...names];
}

const TREE_OID_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const STAGE_LINE_RE = /^\d+ [0-9a-f]{40,64} \d\t(.+)$/;

/** `merge-tree --write-tree`, conflict-aware: `{ tree, conflicts: [paths] }` or `{ error }`. */
async function mergeTree(dir, ours, theirs) {
  const r = await gitCodeOut(dir, ['merge-tree', '--write-tree', ours, theirs]);
  const lines = r.stdout.split('\n');
  const tree = (lines[0] || '').trim();
  if (!TREE_OID_RE.test(tree)) return { error: r.stderr.trim().split('\n')[0] || `merge-tree exited ${r.code}` };
  const conflicts = [];
  if (r.code !== 0) {
    for (const l of lines.slice(1)) {
      const m = STAGE_LINE_RE.exec(l);
      if (m && !conflicts.includes(m[1])) conflicts.push(m[1]);
    }
  }
  return { tree, conflicts };
}

/** git, run raw: a conflicted merge-tree exits 1 with the tree still on stdout. */
function gitCodeOut(dir, args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'user.name=beadcause', '-c', 'user.email=beadcause@localhost', ...args],
      { cwd: dir, maxBuffer: 64 * 1024 * 1024, timeout: 30000 },
      (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') })
    );
  });
}

/**
 * A tree edited through a throwaway index: `writes` is `{ path: text }`, `blobs` is
 * `{ path: oid }`, `removes` is `[path]`. Returns the new tree's oid.
 */
async function editTree(dir, tree, { writes = {}, blobs = {}, removes = [] } = {}) {
  const index = path.join(fs.realpathSync(os.tmpdir()), `beadcause-changesets-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    await git(dir, ['read-tree', tree], { env });
    for (const [p, text] of Object.entries(writes)) {
      const oid = (await gitInput(dir, ['hash-object', '-w', '--stdin'], text)).trim();
      await git(dir, ['update-index', '--add', '--cacheinfo', `100644,${oid},${p}`], { env });
    }
    for (const [p, oid] of Object.entries(blobs)) {
      await git(dir, ['update-index', '--add', '--cacheinfo', `100644,${oid},${p}`], { env });
    }
    for (const p of removes) await git(dir, ['update-index', '--force-remove', '--', p], { env });
    return (await git(dir, ['write-tree'], { env })).trim();
  } finally {
    fs.rmSync(index, { force: true });
  }
}

/**
 * Is there anything for the advocate to do on this branch? The cheap question, asked
 * before `foldBranch` is worth running. `{ applies: false }` for a repo with no config or
 * a branch with nothing pending; `{ applies: true, why }` otherwise; `{ error }` for a
 * config that will not parse on a branch that carries fragments.
 */
export async function planFold(dir, { head, base }) {
  const b = await baseRef(dir, base);
  if (!b || !head) return { applies: false };
  const cfg = await readConfig(dir, b.sha);
  if (!cfg) return { applies: false };
  // A repo that has changesets and a head this checkout has never fetched: "could not
  // tell", never "nothing to fold", or a branch would merge with its fragments as files.
  if ((await gitCode(dir, ['cat-file', '-e', `${head}^{commit}`])).code !== 0) return { applies: false, unknown: true };
  if (cfg.error) {
    // A broken config only matters to a branch that has something it would fold.
    const frags = await fragmentsIn(dir, DEFAULTS, head);
    return frags.length ? { applies: true, error: cfg.error } : { applies: false };
  }
  const config = cfg.config;
  const frags = await fragmentsIn(dir, config, head);
  if (frags.length) return { applies: true, why: `${frags.length} fragment${frags.length === 1 ? '' : 's'} to fold` };
  const rec = await branchRecord(dir, b.sha, head);
  if (!rec) return { applies: false };
  const baseLog = await show(dir, `${b.sha}:${config.target}`);
  const baseTop = topNumber(config, baseLog || '');
  if (baseTop > rec.top) return { applies: true, why: `${config.target} on ${base} reached Entry ${baseTop} after this branch was folded at ${rec.top}` };
  return { applies: false };
}

/**
 * Fold a pull request's fragments into its log and push the result to its branch.
 *
 * Resolves to one of:
 * - `{ action: 'none' }`: nothing to do (no config, nothing pending, already folded).
 * - `{ action: 'pushed', sha, entries, retitles }`: a merge commit pushed to the branch.
 * - `{ action: 'hold', reason, bug? }`: a fragment or the log is wrong; the merge card
 *   shows `reason`. `bug: true` is a conflict inside the region the advocate owns.
 * - `{ action: 'conflicted', conflicts }`: the branch conflicts with its base somewhere
 *   other than the log. The resolver path takes it.
 * - `{ action: 'wait', reason }`: could not push (the branch moved, origin refused).
 *
 * `titleOf(beadId)` returns a bead's current title or null; `push: false` builds the
 * commit without pushing it (the suite's crash-before-push case).
 */
export async function foldBranch(dir, { head, base, branch, titleOf = null, env = undefined, push = true } = {}) {
  const b = await baseRef(dir, base);
  if (!b || !head) return { action: 'none' };
  const cfg = await readConfig(dir, b.sha);
  if (!cfg) return { action: 'none' };
  if (cfg.error) return { action: 'hold', reason: cfg.error };
  const config = cfg.config;

  // 1. Unfold: take an earlier fold's own blocks back out of the head, and restore its fragments.
  const rec = await branchRecord(dir, b.sha, head);
  // Nothing pending and the fold still good against the base: the re-run is a no-op. This
  // is `planFold`'s question, asked again so a caller that skips the plan is still safe.
  if (!(await fragmentsIn(dir, config, head)).length) {
    if (!rec) return { action: 'none' };
    const baseTop = topNumber(config, (await show(dir, `${b.sha}:${config.target}`)) || '');
    if (baseTop <= rec.top) return { action: 'none' };
  }
  let ours = head;
  let restored = {};
  if (rec) {
    const headLog = (await show(dir, `${head}:${config.target}`)) || '';
    const blocks = [];
    for (const e of rec.entries) {
      const body = await show(dir, e.blob);
      if (body === null) return { action: 'hold', reason: `the fragment folded as Entry ${e.n} (${e.path}) is not in this checkout` };
      const r = render(config, e.path, body, e.n, { ...(rec.names || {}), ...Object.fromEntries(rec.entries.map((x) => [fragmentName(x.path), x.n])) });
      if (r.error) return { action: 'hold', reason: r.error };
      blocks.push({ block: r.text, n: e.n });
    }
    const un = removeBlocks(config, headLog, blocks);
    if (un.error) return { action: 'hold', reason: un.error };
    const present = new Set(await fragmentsIn(dir, config, head));
    for (const e of rec.entries) if (!present.has(e.path)) restored[e.path] = e.blob;
    const headTree = (await git(dir, ['rev-parse', `${head}^{tree}`])).trim();
    const tree = await editTree(dir, headTree, { writes: { [config.target]: un.text }, blobs: restored });
    ours = (await git(dir, ['commit-tree', tree, '-p', head, '-m', 'unfold (never pushed)'])).trim();
  }

  // 2. Downmerge, in the object store only.
  const merged = await mergeTree(dir, ours, b.sha);
  if (merged.error) return { action: 'wait', reason: `could not merge ${base} in: ${merged.error}` };
  if (merged.conflicts.length) {
    if (merged.conflicts.some((p) => p === config.target || isFragment(config, p))) {
      return {
        action: 'hold',
        bug: true,
        reason:
          `bringing ${base} in conflicted in ${config.target}, which only the merge advocate writes ` +
          `(${merged.conflicts.join(', ')}). That is a beadcause bug, not this branch's; nobody should resolve it by hand.`,
      };
    }
    return { action: 'conflicted', conflicts: merged.conflicts };
  }

  // 3. Number and fold, on the merged tree.
  const fragPaths = await fragmentsIn(dir, config, merged.tree);
  if (!fragPaths.length) return { action: 'none' };
  const fragments = [];
  for (const p of fragPaths) {
    const body = await show(dir, `${merged.tree}:${p}`);
    const blob = (await git(dir, ['rev-parse', `${merged.tree}:${p}`])).trim();
    fragments.push({ path: p, body: body || '', blob });
  }
  const log = await show(dir, `${merged.tree}:${config.target}`);
  if (log === null) return { action: 'hold', reason: `${CONFIG_PATH} names ${config.target}, and there is no such file on the merged tree` };
  const pending = new Set(fragPaths.map(fragmentName));
  const cited = citedNames(config, fragments.map((f) => f.body)).filter((n) => !pending.has(n));
  const landed = await landedNames(dir, b.sha, cited);
  const folded = foldText(config, log, fragments, { landed });
  if (folded.error) return { action: 'hold', reason: folded.error };
  const tree = await editTree(dir, merged.tree, { writes: { [config.target]: folded.text }, removes: fragPaths });

  // 4. Bead titles that asked for the number, from the template the record keeps.
  const templates = { ...(rec?.titles || {}) };
  if (titleOf) {
    for (const e of folded.entries) {
      const bead = fragmentBead(e.path);
      if (templates[bead]) continue;
      const t = await Promise.resolve(titleOf(bead)).catch(() => null);
      if (t && t.includes(`{{${config.token}}}`)) templates[bead] = t;
    }
  }
  const retitles = [];
  for (const [bead, template] of Object.entries(templates)) {
    const e = folded.entries.find((x) => fragmentBead(x.path) === bead && fragmentName(x.path) === bead) || folded.entries.find((x) => fragmentBead(x.path) === bead);
    if (e) retitles.push({ id: bead, title: template.split(`{{${config.token}}}`).join(fmt(config, e.n)) });
  }

  // 5. One merge commit, parents [head, base], so the review gate reads it as a downmerge.
  const record = {
    top: folded.top,
    entries: folded.entries.map((e) => ({ ...e, blob: fragments.find((f) => f.path === e.path).blob })),
    names: folded.names,
    ...(Object.keys(templates).length ? { titles: templates } : {}),
  };
  const nums = folded.entries.map((e) => fmt(config, e.n)).join(', ');
  const message =
    `Merge ${base} into ${branch || 'the branch'}; changesets folded as Entry ${nums}\n\n` +
    `The merge advocate numbers changelog fragments when it downmerges (lib/changesets.js).\n\n` +
    `${TRAILER}: ${JSON.stringify(record)}`;
  const sha = (await git(dir, ['commit-tree', tree, '-p', head, '-p', b.sha, '-m', message])).trim();
  const result = { action: 'pushed', sha, entries: folded.entries, retitles, refold: !!rec };
  if (!push) return { ...result, action: 'built' };
  if (!branch) return { action: 'wait', reason: 'no branch name to push the fold to' };
  // A plain push, never forced: the commit's first parent is the head we read, so origin
  // takes it only if nobody has pushed since. Anything else is the next tick's question.
  const pushed = await gitCode(dir, ['push', '--quiet', 'origin', `${sha}:refs/heads/${branch}`], { env });
  if (pushed.code !== 0) return { action: 'wait', reason: `origin refused the fold: ${pushed.stderr.split('\n')[0] || `exit ${pushed.code}`}` };
  return result;
}
