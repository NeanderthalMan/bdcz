/**
 * Why each of a hot file's merges conflicted — bc-dgx7.201.
 *
 * lib/hotspots.js says WHICH files keep conflicting. It cannot say whether the file needs
 * restructuring, and that is the question every hotspot bead then asks. Five sessions
 * (bc-xl7n.207, .209, .210, .211, .212) each wrote a one-off script to find out, each
 * tested a different idea, and four of five concluded that there was nothing to
 * restructure: the merges were branches cut before the file was rewritten, or a merge
 * driver `.gitattributes` named that this clone never installed. This is that script, once.
 *
 * Each conflicted merge gets exactly one cause, tried in this order:
 *
 * - `driver-not-installed` — `.gitattributes` named a custom merge driver for the file at
 *   the time, the clone has no definition for it, and re-running the same two parents
 *   *with* the driver is clean. The fix is installing the driver, not touching the file.
 * - `stale-branch` — the base had a whole-file rewrite (line count grew or shrank over
 *   {@link REWRITE_RATIO}x in one commit) that one parent has and the other's merge-base
 *   predates. The branch was cut before the file was restructured; the conflict is its age.
 * - `rewrite-collision` — one parent's copy is {@link REWRITE_RATIO}x larger or smaller
 *   than the merge-base's: that branch rewrote the file while the other side edited it.
 * - `real` — none of those. Two sides edited neighbouring lines. This is the only cause
 *   that a restructure of the file can remove.
 *
 * Read-only: it runs `git merge-tree` and `git show`, never touches a worktree or index.
 */
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';

/** A commit that grows or shrinks the file by more than this factor is a rewrite. */
export const REWRITE_RATIO = 5;
/** Below this many lines on both sides a ratio means nothing (3 lines → 20 is not a rewrite). */
export const REWRITE_MIN_LINES = 40;
export const CAUSES = ['driver-not-installed', 'stale-branch', 'rewrite-collision', 'real', 'clean-on-rerun'];

function git(dir, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: dir, maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || '') });
    });
  });
}

/** Lines in `file` at `rev`, or null when the file is not there. */
export async function lineCount(dir, rev, file) {
  const r = await git(dir, ['show', `${rev}:${file}`]);
  if (r.code !== 0) return null;
  if (!r.stdout) return 0;
  return r.stdout.split('\n').length - (r.stdout.endsWith('\n') ? 1 : 0);
}

/** Is this size change a whole-file rewrite? */
export function isRewrite(before, after) {
  if (before == null || after == null) return false;
  if (!before || !after || Math.max(before, after) < REWRITE_MIN_LINES) return false;
  const lo = Math.max(1, Math.min(before, after));
  return Math.max(before, after) / lo > REWRITE_RATIO;
}

/**
 * Every whole-file rewrite on the base's first-parent history, newest first:
 * `[{ sha, at, subject, bead, before, after }]`. One `git log --numstat`; line counts are
 * walked backwards from the tip's, so no blob is read per commit.
 */
export async function baseRewrites(dir, ref, file) {
  const tip = await lineCount(dir, ref, file);
  if (tip == null) return [];
  const r = await git(dir, ['log', '--first-parent', '-m', '--numstat', '--format=@@%H%x09%ct%x09%s', ref, '--', file]);
  if (r.code !== 0) return [];
  const commits = [];
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('@@')) {
      const [sha, ct, ...s] = line.slice(2).split('\t');
      cur = { sha, at: new Date(Number(ct) * 1000).toISOString(), subject: s.join('\t'), added: 0, deleted: 0 };
      commits.push(cur);
    } else if (cur && /^\d+\t\d+\t/.test(line)) {
      const [a, d] = line.split('\t');
      cur.added += Number(a);
      cur.deleted += Number(d);
    }
  }
  const out = [];
  let after = tip;
  for (const c of commits) {
    const before = after - c.added + c.deleted;
    if (isRewrite(before, after)) out.push({ sha: c.sha, at: c.at, subject: c.subject, bead: beadIn(c.subject), before, after });
    after = before;
  }
  return out;
}

/** The first bead-looking id in some text: `bc-xl7n.211`, `cl-ab3`. */
export function beadIn(text) {
  const s = String(text || '').replace(/pull request #\d+ from \S+/i, '');
  // "bc-8nyxa: …" at the start is a bead whatever its letters; anywhere else it must carry a
  // digit, or "dolt-server" and "merge-queue" are beads.
  const lead = /^([a-z]{2,4}-[a-z0-9]{2,8}(?:\.\d+)*)\b[:\s]/.exec(s);
  if (lead) return lead[1];
  const any = /\b([a-z]{2,4}-(?=[a-z0-9.]*\d)[a-z0-9]{2,8}(?:\.\d+)*)\b/.exec(s);
  return any ? any[1] : null;
}

/** Does `.gitattributes` text name a merge driver for `file`? The driver's name, or ''. */
export function mergeAttrFor(attrText, file) {
  let found = '';
  for (const raw of String(attrText || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pat, ...attrs] = line.split(/\s+/);
    const m = attrs.map((a) => /^merge=(.+)$/.exec(a)).find(Boolean);
    if (!m) continue;
    const re = new RegExp(`^${pat.replace(/^\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
    if (re.test(file) || (!pat.includes('/') && re.test(path.basename(file)))) found = m[1];
  }
  return found;
}

const BUILTIN_DRIVERS = new Set(['union', 'text', 'binary']);

async function configuredDriver(dir, name) {
  return (await git(dir, ['config', '--get', `merge.${name}.driver`])).stdout.trim();
}

/** The driver command to try for a driver this repo ships a script for; '' if it has none. */
function knownDriverCommand(dir, name) {
  const script = path.join(dir, 'scripts', `${name}.mjs`);
  if (!fs.existsSync(script)) return '';
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  return `${q(process.execPath)} ${q(script)} %O %A %B %P`;
}

async function isAncestor(dir, a, b) {
  return (await git(dir, ['merge-base', '--is-ancestor', a, b])).code === 0;
}

async function conflicts(dir, p1, p2, file, extra = []) {
  const r = await git(dir, [...extra, 'merge-tree', '--write-tree', '--name-only', '--no-messages', p1, p2]);
  if (r.code === 0) return false;
  if (r.code !== 1) return null;
  return r.stdout.split('\n').slice(1).includes(file);
}

/**
 * Explain one merge. `merge` is `{ sha }` (parents are read from it) and `rewrites` is the
 * output of {@link baseRewrites}. Returns the row the command prints.
 */
export async function explainMerge(dir, file, merge, rewrites) {
  const parents = (await git(dir, ['rev-list', '--parents', '-n', '1', merge.sha])).stdout.trim().split(' ');
  const [, p1, p2] = parents;
  const meta = (await git(dir, ['log', '-1', '--format=%ct%x09%s', merge.sha])).stdout.trim().split('\t');
  const row = {
    sha: merge.sha,
    at: new Date(Number(meta[0]) * 1000).toISOString(),
    subject: meta.slice(1).join('\t'),
    lines: null,
    cause: 'real',
    rewrite: null,
    driver: null,
    detail: '',
  };
  if (!p1 || !p2) return { ...row, cause: 'unknown', detail: 'not a two-parent merge in this clone' };

  const base = (await git(dir, ['merge-base', p1, p2])).stdout.trim();
  const [n1, n2, nb] = await Promise.all([lineCount(dir, p1, file), lineCount(dir, p2, file), base ? lineCount(dir, base, file) : null]);
  row.lines = { p1: n1, p2: n2, base: nb };

  // 1. a driver the attributes named, that this clone never defined
  //    The clone this runs in may have installed the driver since, so "uninstalled" is
  //    emulated: a driver that runs plain `git merge-file` is exactly git's text merge,
  //    which is what a clone with no definition falls back to.
  const attrs = (await git(dir, ['show', `${p1}:.gitattributes`])).stdout;
  const name = mergeAttrFor(attrs, file);
  if (name && !BUILTIN_DRIVERS.has(name)) {
    const have = await configuredDriver(dir, name);
    const cmd = have || knownDriverCommand(dir, name);
    row.driver = { name, installed: !!have, cleanWithDriver: null };
    if (cmd) {
      const textual = await conflicts(dir, p1, p2, file, ['-c', `merge.${name}.driver=git merge-file -L ours -L base -L theirs %A %O %B`]);
      const withDriver = await conflicts(dir, p1, p2, file, ['-c', `merge.${name}.driver=${cmd}`]);
      row.driver.cleanWithDriver = withDriver === null ? null : !withDriver;
      if (textual === false) return { ...row, cause: 'clean-on-rerun', detail: 'git text-merges these parents cleanly; whatever conflicted was resolved differently' };
      if (textual && withDriver === false) {
        return { ...row, cause: 'driver-not-installed', detail: `.gitattributes names merge=${name}; without that driver the merge conflicts, with it the same merge is clean${have ? ' (installed in this clone now)' : ' (not installed in this clone)'}` };
      }
    }
  } else if ((await conflicts(dir, p1, p2, file)) === false) {
    return { ...row, cause: 'clean-on-rerun', detail: 'git merges these parents cleanly now' };
  }

  // 2. one parent is cut before a rewrite the other has
  const at = new Date(row.at).getTime();
  for (const rw of rewrites) {
    if (new Date(rw.at).getTime() > at) continue;
    const [in1, in2, inBase] = await Promise.all([isAncestor(dir, rw.sha, p1), isAncestor(dir, rw.sha, p2), base ? isAncestor(dir, rw.sha, base) : false]);
    if (inBase || in1 === in2) continue;
    row.rewrite = { sha: rw.sha, bead: rw.bead, subject: rw.subject, before: rw.before, after: rw.after, has: in1 ? 'p1' : 'p2' };
    return { ...row, cause: 'stale-branch', detail: `the ${in1 ? 'second' : 'first'} parent was cut before ${rw.sha.slice(0, 9)} rewrote the file (${rw.before}→${rw.after} lines)` };
  }

  // 3. one side rewrote it against the other's edits
  for (const [side, n] of [['p1', n1], ['p2', n2]]) {
    if (isRewrite(nb, n)) {
      row.rewrite = { sha: null, bead: null, subject: '', before: nb, after: n, has: side };
      return { ...row, cause: 'rewrite-collision', detail: `the ${side === 'p1' ? 'first' : 'second'} parent changed the file ${nb}→${n} lines while the other side edited it` };
    }
  }

  return { ...row, detail: 'both sides edited the file; no rewrite or driver explains it' };
}

/** Tally causes for a summary line. */
export function tally(rows) {
  const t = {};
  for (const r of rows) t[r.cause] = (t[r.cause] || 0) + 1;
  return t;
}
