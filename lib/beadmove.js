/**
 * Moving a bead that is already somewhere — the ⋮'s second item, and the write behind it.
 *
 * `POST /api/bead/adopt` has reparented since bc-rfnr.7, and the sheet has offered it
 * since the same bead — but only on an **orphan**. `adoptRowHtml` returns `''` unless
 * `b.noRoot`, because the row it draws is a *refusal being answered*: nothing has decided
 * this bead, so nothing will work it, and here is the fix. That is the right row for that
 * bead and it is not a way to move any other one. A bead under the wrong epic — filed in
 * a hurry, adopted by an `Adopts:` line that meant a sibling, left behind when its parent
 * was retired — could be moved from a terminal and from nowhere else.
 *
 * So this is the same reparent offered unconditionally, plus the one question the adopt
 * row never had to ask.
 *
 * ## What the children make it
 *
 * A bead with children is not one edge. Move `bc-x` under a new epic and its subtree goes
 * with it, which is usually what you meant — the epic and the work under it are one
 * thing. Sometimes it is exactly not: `bc-x` was misfiled and the beads under it were
 * not, and dragging six of somebody else's beads across the tracker to fix one is a
 * bigger wrong than the one being fixed. Both are ordinary, neither is guessable, so it
 * is asked — and only of a bead that has children, because a question with one possible
 * answer is chrome.
 *
 * **"Leave" reparents each direct child to the departing bead's *current* parent**, before
 * the bead itself moves. The grandparent is the honest answer to "where do they belong
 * now": it is what decided them a moment ago, one level removed, and it is what they
 * would have been under had the misfiled bead never existed.
 *
 * ## When there is no grandparent, one is minted
 *
 * A bead that is itself at top level has no grandparent to leave its children with, and
 * the obvious fallback — drop them at top level too — is the one outcome this control
 * must not produce. `hasRootAbove` (lib/underroot.js) is a *gate*: a bead with nothing
 * decided above it is filtered out of every advocate queue and refused at the launcher's
 * door. So "leave them where they are" would silently convert working children into
 * unworkable ones, and it would do it as a side effect of a move that was about their
 * parent. That is the app causing the exact hold bc-rfnr.7 exists to clear, through the
 * control built to clear it.
 *
 * So the move mints a stand-in and puts them under it, rather than reporting the problem
 * it just caused. **An epic**, because `isRoot` (lib/ownership.js) counts an epic at any
 * priority as a root since bc-htoy, and a *task* minted at top level would be as
 * undecided as the orphaning it replaces — a stand-in that does not satisfy the gate is
 * furniture, not a fix. Its title is prefilled from the departing bead and editable in
 * the card before it is written, because the one thing this file cannot know is what the
 * group of beads is actually *for*; its description says what it stands in for and asks
 * to be retitled or dissolved.
 *
 * The stand-in carries no `unendorsed` marker and no `human` label. Both would be wrong
 * and in opposite directions: a person tapped Save on a phone, so nobody is waiting to
 * agree to it, and it is not a question anybody should be rung about. Being an endorsed
 * epic it takes `Bd.create`'s owner stamp for free, which is what keeps it off
 * lib/ownership.js's unowned-root triage.
 *
 * ## What is refused, and what is deliberately not
 *
 * **The destination must have something decided above it**, exactly as adopting does —
 * `hasRootAbove` again, the gate's own predicate. Moving a bead somewhere it cannot be
 * worked is not a move anybody means to make, and the sentence names the same fix.
 *
 * **A cycle is refused before that**, and it is this control's new hazard rather than
 * adopt's: adopt was only ever offered on a bead with nothing above it, and this one is
 * offered on epics with subtrees under them. `bd` will happily write `bc-x --parent
 * bc-x.1`, and the ring that makes is invisible on every screen — `ancestorsOf` walks it
 * with a seen-set and simply stops, so the beads inside it have no root above them and
 * quietly leave every queue. Order matters here: the root check would *pass* for a
 * descendant (it climbs through the bead being moved), so the loop has to be caught
 * first or it is caught not at all.
 *
 * **Detaching is not refused**, and neither is a closed bead. An empty destination is
 * "top level", which is a legitimate thing to say and is how a move into the wrong epic
 * is undone — the sheet redraws the "nothing decided above this" row, which is the point
 * rather than a failure. And a closed bead is filed *somewhere*; tidying where its record
 * sits rewrites no record, which is what lib/beadedit.js's 409 is actually protecting.
 *
 * So "no path through this control leaves a bead parentless" is a statement about the
 * **children**: nothing that was decided by the bead you moved comes out of this
 * undecided. The bead you moved may end at top level, because you picked that.
 */
import { ancestorsOf, childrenFrom } from './ancestry.js';
import { hasRootAbove } from './underroot.js';
import { loadBead } from './verdict.js';

const clean = (v) => String(v ?? '').trim();

/** The subtree goes with it. */
export const MOVE_WITH = 'with';
/** The subtree stays behind, under the grandparent or under a stand-in for it. */
export const MOVE_LEAVE = 'leave';
export const MOVE_MODES = [MOVE_WITH, MOVE_LEAVE];

/**
 * The mode a request asked for, or `null` for anything else.
 *
 * `null` rather than a default, because the two answers are not interchangeable and a
 * typo that silently picked one would move somebody's subtree without being asked. An
 * *absent* mode is the exception and means `with`: a caller that never mentioned children
 * is a bead that has none, or a client written before this question existed, and both of
 * those mean "the bead and whatever hangs off it".
 */
export function moveMode(v) {
  const m = clean(v).toLowerCase();
  if (!m) return MOVE_WITH;
  return MOVE_MODES.includes(m) ? m : null;
}

/** How much of a departing bead's title the stand-in's prefill carries. */
export const STAND_IN_TITLE_MAX = 90;

/**
 * The epic minted in a departing bead's place — title and description.
 *
 * The title is the departing bead's, prefixed rather than copied: two beads with the same
 * title in one tracker is what `Bd.create`'s duplicate check exists to complain about, and
 * here they really are two different things. Truncated at `STAND_IN_TITLE_MAX` because a
 * 200-character title is a paragraph on a card, and the field is on screen and editable
 * before this is written — a prefill nobody can see is the only kind worth being careful
 * about.
 *
 * `typed` wins whenever there is one. This is a default, not a policy.
 */
export function standInFor(bead, typed = '') {
  const said = clean(typed);
  const title = clean(bead?.title);
  const id = clean(bead?.id) || 'the bead that moved';
  const short = title.length > STAND_IN_TITLE_MAX ? `${title.slice(0, STAND_IN_TITLE_MAX - 1).trimEnd()}…` : title;
  return {
    title: said || (short ? `What was under ${short}` : `What was under ${id}`),
    description:
      `A stand-in, minted by the bead sheet's Move when **${id}** was moved out from over these beads and ` +
      'they were left behind.\n\n' +
      `${id}${title ? ` — "${title}" —` : ''} is what decided them until now, and it has gone somewhere else. ` +
      'They had nothing above *it*, so there was no grandparent to leave them with, and leaving them at top ' +
      'level would have taken them out of every advocate queue and refused them at the launcher (see ' +
      'lib/underroot.js). An epic at any priority is a root, so this one is enough to keep them workable.\n\n' +
      'It says nothing about what the work is, because nothing knew. Retitle it, describe it, or adopt these ' +
      'beads somewhere better and close it — it exists only so that none of them was silently orphaned.',
  };
}

/**
 * Why this move may not happen, as an error carrying its own status — or `null`.
 *
 * Ordered, and the order is load-bearing: see the header on why the cycle has to be
 * caught before the root check rather than after it.
 */
export function moveProblem(index, id, parent) {
  const from = clean(id);
  const to = clean(parent);
  if (!to) return null;
  if (to === from) return Object.assign(new Error('a bead cannot be its own parent'), { status: 400 });
  if (!index?.beads?.get?.(to)) return Object.assign(new Error(`${to} is not a bead here`), { status: 404 });
  if (ancestorsOf(index?.parents, to).includes(from)) {
    return Object.assign(
      new Error(`${to} is already under ${from} — moving ${from} beneath it would make a loop nothing could get out of`),
      { status: 409, loop: true }
    );
  }
  if (!hasRootAbove(index, to)) {
    return Object.assign(
      new Error(`${to} has nothing decided above it either, so moving ${from} under it would not make it workable`),
      { status: 409, noRoot: true }
    );
  }
  return null;
}

/**
 * The whole move as data, before a single `bd` runs — what the tests are written against.
 *
 * Pure, and it is what makes the interesting half of this file assertable without a
 * tracker: which children move away first, where they go, whether an epic has to be
 * minted, and what it would be called.
 */
export function movePlan({ bead = null, parent = '', mode = MOVE_WITH, current = '', children = [], standInTitle = '' } = {}) {
  const kids = (children || []).map(clean).filter(Boolean);
  const leaving = mode === MOVE_LEAVE && kids.length > 0;
  const grandparent = clean(current);
  return {
    mode: leaving ? MOVE_LEAVE : MOVE_WITH,
    parent: clean(parent),
    // The children that are reparented *before* the bead moves. Empty for `with`, which
    // is what makes that case one write.
    orphans: leaving ? kids : [],
    // Where they go — `''` when there is nothing to leave them with and `mint` answers it.
    to: leaving ? grandparent : '',
    mint: leaving && !grandparent ? standInFor(bead, standInTitle) : null,
  };
}

/**
 * Do it: mint if one is owed, settle the children, then move the bead.
 *
 * **In that order, and the order is the safety.** Every write before the last one puts a
 * child somewhere decided; the last one is the only write that can leave anything worse
 * than it found it, and by then the children are already safe. Crashing halfway through
 * the other order — the bead moved, its children still pointing at where it used to be —
 * is the orphaning this whole file exists to prevent, arriving as a partial failure.
 *
 * `refresh: false` on each child, `true` on the last write. `Bd.adopt` rebuilds the whole
 * cached graph — an export, a second or more on a loaded Dolt — and doing that once per
 * child is what turns a six-child move into six of them for one tap. The final write's
 * refresh is what makes `workable` below the state the next advocate tick will act on
 * rather than a promise about it.
 */
export async function moveBead(bd, ws, id, { parent = '', mode = MOVE_WITH, standInTitle = '', actor = null } = {}) {
  const bead = await loadBead(bd, ws, id);
  const index = await bd.graph(ws);
  const problem = moveProblem(index, id, parent);
  if (problem) throw problem;
  const plan = movePlan({
    bead,
    parent,
    mode,
    current: index?.parents?.get?.(clean(id)) || '',
    children: childrenFrom(index?.parents).get(clean(id)) || [],
    standInTitle,
  });
  let standIn = null;
  if (plan.mint) {
    const minted = await bd.create(
      ws,
      { title: plan.mint.title, body: plan.mint.description, type: 'epic', priority: 2, labels: [] },
      { actor }
    );
    if (!minted) throw Object.assign(new Error('could not create the epic to leave these beads under'), { status: 502 });
    standIn = { id: minted, title: plan.mint.title };
  }
  const home = standIn ? standIn.id : plan.to;
  for (const child of plan.orphans) await bd.adopt(ws, child, home, { actor, refresh: false });
  await bd.adopt(ws, id, plan.parent, { actor });
  const after = await bd.graph(ws);
  return {
    id: clean(id),
    parent: plan.parent || null,
    mode: plan.mode,
    moved: plan.orphans,
    left: plan.orphans.length ? home : null,
    standIn,
    workable: hasRootAbove(after, id),
  };
}
