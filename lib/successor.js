/**
 * `b7e-successor` — hand a relay round's remainder to the next round, in one call.
 *
 * `bc-dgx7.196`, re-filed from another workspace's tracker. A multi-round piece of work
 * ends every round the same way: file the remainder as a sibling under the same parent,
 * chain it behind the round that just finished, and move whatever downstream bead was
 * waiting on the finished round so it now waits on the next one. Eight sessions did that
 * by hand as four or five `bd` calls and a readback, and they differed in what they forgot —
 * one never wrote the new→old chain edge, one copied labels from the previous round by
 * piping `bd show --json` through python, two lost a create to the worktree guard.
 *
 * What this module owns is the order and the check: create exactly one child of the
 * finished bead's parent (born with its own labels only, never the parent's), add
 * new→old, then for each blocker drop old and add new — and read every moved blocker's
 * edges back, because a `dep add` that exits 0 is not a statement about what the graph
 * now says. A refusal comes before any write, so a rerun with the same title finds the
 * round it already filed and stops rather than filing a second.
 *
 * Takes the `Bd` it is to use so the test can hand it a stub that records order.
 */

const CLOSED = 'closed';

/** Edge kinds that are structure, not waiting: never a blocker to move. */
const NOT_BLOCKERS = new Set(['parent-child', 'discovered-from', 'related', 'relates-to', 'duplicates', 'supersedes']);

export class SuccessorError extends Error {
  constructor(message, { code = 1 } = {}) {
    super(message);
    this.name = 'SuccessorError';
    this.code = code;
  }
}

const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The parent of a bead: the row's own field, else the `parent-child` edge pointing up. */
async function parentOf(bd, ws, row) {
  if (row.parent) return row.parent;
  const edges = (await bd.json(ws, ['dep', 'list', row.id])) || [];
  const up = edges.find((e) => e && e.dependency_type === 'parent-child');
  return up ? up.id : '';
}

/**
 * Open beads waiting on `finished` — the default set to move. `dependents` already sorts
 * and shapes rows; structural edges and the finished bead's own children are not waiters.
 */
async function waitersOn(bd, ws, finished) {
  const rows = await bd.dependents(ws, finished);
  return rows.filter((r) => r.status !== CLOSED && !NOT_BLOCKERS.has(r.dependency_type)).map((r) => r.id);
}

/**
 * What a blocker's outgoing edges say, read with `bd.json` and not a wrapper that
 * swallows a failed read into an empty list — an empty answer must mean "no edge", never
 * "could not ask".
 */
async function dependsOn(bd, ws, id) {
  const rows = (await bd.json(ws, ['dep', 'list', id])) || [];
  return rows.filter(Boolean).map((r) => String(r.id));
}

/**
 * @returns {Promise<{id:string, parent:string, chained:boolean, moved:{blocker:string, ok:boolean, dependsOn:string[]}[], ok:boolean}>}
 */
export async function makeSuccessor(bd, ws, { finished, title, body = '', assignee = '', moveBlockers = null, actor = null }) {
  if (!finished) throw new SuccessorError('a finished bead is required', { code: 2 });
  if (!String(title || '').trim()) throw new SuccessorError('a --title is required', { code: 2 });

  const row = await bd.show(ws, finished);
  if (!row) throw new SuccessorError(`${finished} is not in ${ws.name}`, { code: 4 });
  const parent = await parentOf(bd, ws, row);
  if (!parent) {
    throw new SuccessorError(`${finished} has no parent — a successor is a sibling round, and there is nothing to hang it off`, { code: 3 });
  }

  // Refuse before any write: a round already filed under this title is the one a rerun means.
  const siblings = await bd.children(ws, parent);
  const twin = siblings.find((s) => norm(s.title) === norm(title));
  if (twin) {
    throw new SuccessorError(`${twin.id} under ${parent} already has this title (${twin.status}) — not filing a second`, { code: 5 });
  }

  const blockers = moveBlockers && moveBlockers.length ? moveBlockers : await waitersOn(bd, ws, finished);

  const id = await bd.create(
    ws,
    {
      title,
      body,
      type: row.issue_type || 'task',
      priority: row.priority ?? 2,
      labels: [],
      parent,
    },
    { actor }
  );
  if (!id) throw new SuccessorError(`bd create answered with no id — nothing was chained or moved`, { code: 6 });

  if (assignee) await bd.run(ws, ['update', id, '--assignee', assignee], { retries: 4 });

  await bd.addDep(ws, id, finished);

  const moved = [];
  for (const blocker of blockers) {
    // A named blocker that never waited on the finished round has no edge to drop, and
    // `bd dep remove` refuses a pair it does not hold — so only drop what is there.
    if ((await dependsOn(bd, ws, blocker)).some((d) => same(d, finished))) await bd.dropDep(ws, blocker, finished);
    await bd.addDep(ws, blocker, id);
    const now = await dependsOn(bd, ws, blocker);
    const ok = now.some((d) => same(d, id)) && !now.some((d) => same(d, finished));
    moved.push({ blocker, ok, dependsOn: now });
  }

  const chain = await dependsOn(bd, ws, id);
  const chained = chain.some((d) => same(d, finished));
  return { id, parent, chained, moved, ok: chained && moved.every((m) => m.ok) };
}
