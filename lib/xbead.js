/**
 * `b7e-xbead` — read a bead out of whichever tracker owns it. bin/b7e-xbead is argv and
 * printing; everything that decides anything is here, so test/xbead.mjs can drive it
 * without a `bd`.
 *
 * bc-dgx7.192. Eight loremia sessions each had to read `bc-irzp7` from a loremia
 * directory, where `bd` only looks in the lm tracker, and hand-rolled `cd ~ && zsh -c 'bd
 * show …'` — which picks the tracker before the inner `cd` runs and answers a false "no
 * issue found". The tracker is a function of the id's prefix, never of the directory, so
 * this maps prefix → workspace the way lib/newspace.js's `prefixesInUse` does and hands
 * `Bd` that workspace, which sets BEADS_DIR itself.
 */
import { prefixOf as idPrefix } from './mentions.js';
import { blockedByFar } from './farblock.js';

const ID_RE = /^[a-z][a-z0-9]*-[a-z0-9.]+$/i;

/**
 * `bc-irzp7` or `beadcause/bc-irzp7` → where to look.
 *
 * `prefixes` is a Map of prefix → workspace name (lib/newspace.js `prefixesInUse`),
 * `known` the workspace names. A qualified id names its tracker outright; a bare one is
 * looked up by prefix. Returns `{ workspace, id }` or `{ error, reason }` where `error` is
 * `usage` (not an id at all) or `unknown` (a prefix, or workspace, no tracker owns).
 */
export function resolveTarget(raw, prefixes, known = []) {
  const s = String(raw || '').trim();
  const slash = s.indexOf('/');
  const id = slash === -1 ? s : s.slice(slash + 1);
  if (!ID_RE.test(id)) return { error: 'usage', reason: `${s || 'that'} is not a bead id (<prefix>-<id>) or <workspace>/<id>` };
  if (slash !== -1) {
    const workspace = s.slice(0, slash);
    return known.includes(workspace)
      ? { workspace, id }
      : { error: 'unknown', reason: `no workspace named ${workspace}` };
  }
  const prefix = idPrefix(id);
  const workspace = prefixes.get(prefix);
  return workspace
    ? { workspace, id }
    : { error: 'unknown', reason: `prefix ${prefix}- matches no tracker on this Mac (known: ${[...prefixes.keys()].sort().join(', ') || 'none'})` };
}

/** `{ at, author, text }` of the newest comment, or null. */
export function lastComment(comments) {
  const rows = (comments || []).filter(Boolean);
  if (!rows.length) return null;
  const at = (c) => String(c.created_at || c.at || '');
  const newest = rows.reduce((a, b) => (at(b) >= at(a) ? b : a));
  return { at: at(newest), author: newest.author || newest.created_by || '', text: String(newest.text ?? newest.body ?? '') };
}

/**
 * One fixed-shape record from a `bd show` row, its children, and (optionally) comments.
 * Blockers are open `blocks` edges plus a `blocked-by:<ws>/<id>` marker, which is the same
 * fact held in another tracker where no edge can reach.
 */
export function shape(workspace, row, children = [], { comments = null } = {}) {
  const blockers = (row.dependencies || [])
    .filter((d) => d && d.dependency_type === 'blocks' && d.status !== 'closed')
    .map((d) => d.id);
  const far = blockedByFar(row);
  if (far) blockers.push(far);
  const thread = row.comments || comments || [];
  const out = {
    id: row.id,
    tracker: workspace,
    status: row.status || '',
    title: row.title || '',
    assignee: row.assignee || '',
    openChildren: (children || []).filter((c) => c.status !== 'closed').map((c) => c.id),
    openBlockers: blockers,
    lastComment: lastComment(thread),
  };
  if (comments) out.comments = thread;
  return out;
}

/** The fixed-order text form. One bead per block. */
export function render(rec, { comments = false } = {}) {
  const list = (a) => (a.length ? a.join(', ') : 'none');
  const lc = rec.lastComment;
  const lines = [
    `${rec.id} — ${rec.title}`,
    `  tracker:        ${rec.tracker}`,
    `  status:         ${rec.status}`,
    `  assignee:       ${rec.assignee || '(none)'}`,
    `  open children:  ${list(rec.openChildren)}`,
    `  open blockers:  ${list(rec.openBlockers)}`,
    `  last comment:   ${lc ? `${lc.at.slice(0, 10)} ${lc.author}` : '(none)'}`,
  ];
  if (comments && rec.comments?.length) {
    lines.push('  comments:');
    for (const c of rec.comments) {
      lines.push(`    ${String(c.created_at || '').slice(0, 10)} ${c.author || ''}: ${String(c.text ?? '').replace(/\n/g, '\n      ')}`);
    }
  }
  return lines.join('\n');
}

/** Worst exit wins: 3 unknown prefix, 4 id missing in a known tracker, 5 unreadable. */
export const EXIT = { ok: 0, usage: 2, unknown: 3, missing: 4, unreadable: 5 };
