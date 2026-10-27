/**
 * Where a bead's work actually is — on trunk, on a branch, in a pull request, or nowhere.
 * `bin/b7e-trace` is the argv shell; this is the git reading behind it.
 *
 * bc-dgx7.96: four sessions (dv-3rn.2, dv-nsy, dv-gr6.36, dv-gr6.45) each answered "has this
 * bead's work landed, and if not where is it" out of raw git plumbing. `b7e-landed` answers
 * one bead against trunk commits. This adds what it does not have, and what the studio
 * board's `ruled_not_evidenced()` (trunk commit messages only) gets wrong:
 *
 * - **tracked file contents that name the bead** — on trunk (`git grep`) and on any
 *   unmerged branch (`git log -G`, which sees what each branch *added*). A bead cited only
 *   in a file body is not uncited.
 * - **every branch**, local or on origin, not the worktree's own.
 * - **many beads in one pass** — the alternation of every id goes to git once, and the
 *   hits are attributed afterwards, so 57 beads cost five git calls rather than 285.
 *
 * ## Verdicts
 *
 * `landed` — trunk has a commit naming the bead, or a tracked file naming it (`via` says
 * which; a file alone is weaker evidence than a commit and is reported as such).
 * `in-review` — not on trunk, but an open pull request is for a branch that carries it, or
 * names it in its title. `on-branch` — only on unmerged branches; `branches` names them.
 * `uncited` — nothing anywhere names it.
 *
 * One commit is reachable from many refs but `git log --source` reports only the first it
 * reached, so a bead whose commits sit on two branches may name only one of them. Run
 * `git branch -a --contains <sha>` on the sha it prints to see the rest.
 *
 * Files under `.beads/` and `.claude/` are not searched: the tracker mirror names every
 * bead there is, and a session log naming a bead is not the bead's work.
 */
import {
  FIELD_SEP,
  RECORD_SEP,
  git,
  idsPattern,
  idsNamedIn,
  branchName,
  resolveTrunk,
} from './refs.js';

const NOT_WORK = [':(exclude).beads', ':(exclude).claude'];

const emptyEvidence = () => ({ trunkCommits: [], trunkFiles: [], branchCommits: [], branchFiles: [] });

/** Commits on `trunk` whose subject or body names an id: `{ sha, subject, pr, ids }`. */
function trunkCommits(dir, trunk, ids) {
  const out = git(dir, ['log', trunk, '-E', `--grep=${idsPattern(ids)}`, `--format=%H${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`]);
  const found = [];
  for (const rec of String(out || '').split(RECORD_SEP)) {
    const [sha, subject = '', body = ''] = rec.split(FIELD_SEP);
    if (!sha || !sha.trim()) continue;
    const named = idsNamedIn(`${subject}\n${body}`, ids);
    const pr = /\(#(\d+)\)\s*$/.exec(subject.trim());
    if (named.length) found.push({ sha: sha.trim(), subject: subject.trim(), pr: pr ? Number(pr[1]) : null, ids: named });
  }
  return found;
}

/** Commits on any ref not already in `trunk` whose message names an id: `{ sha, ref, subject, ids }`. */
function branchCommits(dir, trunk, ids) {
  const out = git(dir, [
    'log', '--branches', '--remotes', '--source', '--not', trunk,
    '-E', `--grep=${idsPattern(ids)}`,
    `--format=%H${FIELD_SEP}%S${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`,
  ]);
  const found = [];
  for (const rec of String(out || '').split(RECORD_SEP)) {
    const [sha, ref = '', subject = '', body = ''] = rec.split(FIELD_SEP);
    if (!sha || !sha.trim()) continue;
    const named = idsNamedIn(`${subject}\n${body}`, ids);
    if (named.length) found.push({ sha: sha.trim(), ref: branchName(ref.trim()), subject: subject.trim(), ids: named });
  }
  return found;
}

/** Tracked files at `trunk` whose contents name an id: `{ path, ids }`. */
function trunkFiles(dir, trunk, ids) {
  const out = git(dir, ['grep', '-I', '-E', '-n', idsPattern(ids), trunk, '--', '.', ...NOT_WORK]);
  const byPath = new Map();
  for (const line of String(out || '').split('\n')) {
    // `<trunk>:<path>:<lineno>:<text>` — the trunk ref itself may contain a slash, never a colon.
    const m = /^[^:]+:([^:]+):\d+:(.*)$/.exec(line);
    if (!m) continue;
    for (const id of idsNamedIn(m[2], ids)) {
      if (!byPath.has(m[1])) byPath.set(m[1], new Set());
      byPath.get(m[1]).add(id);
    }
  }
  return [...byPath].map(([path, set]) => ({ path, ids: [...set] }));
}

/**
 * Files an unmerged ref added or removed lines naming an id in: `{ sha, ref, path, ids }`.
 * `git log -G` shows only the matching files of each commit, so `--name-only` lists just
 * those; the ids are then read off the diff itself, since `-G` takes one pattern for all.
 */
function branchFiles(dir, trunk, ids) {
  const out = git(dir, [
    'log', '--branches', '--remotes', '--source', '--not', trunk,
    '-E', '-G', idsPattern(ids), '--name-only', '--format=%x1e%H%x1f%S', '--', '.', ...NOT_WORK,
  ]);
  const found = [];
  for (const rec of String(out || '').split(RECORD_SEP)) {
    if (!rec.trim()) continue;
    const [head, ...rest] = rec.split('\n');
    const [sha, ref = ''] = head.split(FIELD_SEP);
    for (const p of rest.map((s) => s.trim()).filter(Boolean)) {
      const diff = git(dir, ['show', '--format=', '--unified=0', sha.trim(), '--', p]) || '';
      const added = diff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).join('\n');
      const named = idsNamedIn(added, ids);
      if (named.length) found.push({ sha: sha.trim(), ref: branchName(ref.trim()), path: p, ids: named });
    }
  }
  return found;
}

/** Open pull requests: `[{ number, url, branch, text }]`, or `[]` when GitHub cannot be asked. */
async function openPulls(dir) {
  try {
    const pr = await import('./pr.js');
    const gh = await pr.available();
    if (!gh.ok) return null;
    const rows = (await pr.list(dir, { state: 'open', limit: 200 })) || [];
    return rows.map((r) => ({ number: r.number, url: r.url, branch: r.branch, text: `${r.title || ''}\n${r.body || ''}` }));
  } catch {
    return null;
  }
}

/**
 * Trace `ids` against `trunk`. `{ ok, trunk, pulls, beads: { <id>: { id, verdict, via, ... } } }`.
 * `pulls: false` skips GitHub (then `in-review` cannot be told from `on-branch`, and the
 * result says so with `prsChecked: false`).
 */
export async function traceBeads(dir, ids, { trunk = 'main', pulls = true } = {}) {
  const trunkRef = resolveTrunk(dir, trunk);
  if (!trunkRef) return { ok: false, reason: `neither origin/${trunk} nor ${trunk} resolves in ${dir}` };
  const unique = [...new Set(ids)];
  if (!unique.length) return { ok: true, trunk: trunkRef, prsChecked: false, beads: {} };

  const ev = Object.fromEntries(unique.map((id) => [id, emptyEvidence()]));
  for (const c of trunkCommits(dir, trunkRef, unique)) for (const id of c.ids) ev[id].trunkCommits.push(c);
  for (const f of trunkFiles(dir, trunkRef, unique)) for (const id of f.ids) ev[id].trunkFiles.push(f.path);
  for (const c of branchCommits(dir, trunkRef, unique)) for (const id of c.ids) ev[id].branchCommits.push(c);
  for (const f of branchFiles(dir, trunkRef, unique)) for (const id of f.ids) ev[id].branchFiles.push({ ref: f.ref, path: f.path, sha: f.sha });

  const open = pulls ? await openPulls(dir) : null;
  const beads = {};
  for (const id of unique) {
    const e = ev[id];
    const branches = [...new Set([...e.branchCommits.map((c) => c.ref), ...e.branchFiles.map((f) => f.ref)])].filter(Boolean);
    const prs = (open || []).filter((p) => branches.includes(p.branch) || idsNamedIn(p.text, [id]).length);
    const base = { id, trunkCommits: e.trunkCommits, trunkFiles: [...new Set(e.trunkFiles)], branchCommits: e.branchCommits, branchFiles: e.branchFiles, branches, prs: prs.map(({ number, url, branch }) => ({ number, url, branch })) };
    if (e.trunkCommits.length) beads[id] = { ...base, verdict: 'landed', via: 'commit' };
    else if (base.trunkFiles.length) beads[id] = { ...base, verdict: 'landed', via: 'file' };
    else if (prs.length) beads[id] = { ...base, verdict: 'in-review' };
    else if (branches.length) beads[id] = { ...base, verdict: 'on-branch' };
    else beads[id] = { ...base, verdict: 'uncited' };
  }
  return { ok: true, trunk: trunkRef, prsChecked: open != null, beads };
}
