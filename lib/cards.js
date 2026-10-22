/**
 * Which of the cards a round bead is waiting on moved since the last round, and what
 * they now say (bc-xl7n.202, from delmar's dv-5eu.186).
 *
 * Seven delmar sessions each hand-wrote a different shell loop over a "Cards to act on
 * if answered:" list of ~21 bead ids. The variants printed different things — two printed
 * no comments at all — so a comment left on a card that is still open was missed by some
 * of them. This is the one reading: ids from the bead, a `since` from its predecessor, and
 * per card whether it MOVED and what Adam said.
 *
 * **MOVED is not "status changed".** A card Adam commented on is still `open`; the
 * comment is the whole signal, so a card moves when its `updated_at` OR the newest
 * comment's `created_at` is after `since`. Same reading for a decision answered through
 * beadcause, via lib/beadanswer.js's `evaluateBead` (the chosen option).
 *
 * **"Non-agent" is an author test, and a coarse one.** Agents here write under the bd
 * actor (`beadcause …`, `agent`), and the actor the config names; anything else is read as
 * a person. A session running under Adam's own git identity is indistinguishable from
 * Adam, which is why the newest comment of *any* author is reported too.
 */
import { evaluateBead } from './beadanswer.js';

// An id as this tracker spells them: prefix, a dash, then a slug with optional .N children.
const ID_RE = /\b[a-z][a-z0-9]{1,6}-[a-z0-9]{2,8}(?:\.\d+)*\b/g;
// The lines that introduce a list of cards: "Cards to act on if answered:", "Read X first".
const HEADING_RE = /cards to act on|^\s*read\b.*\bfirst\b/i;
const REMAINDER_RE = /remainder of\s+([a-z][a-z0-9]{1,6}-[a-z0-9]{2,8}(?:\.\d+)*)/i;
const AGENT_AUTHOR_RE = /^(beadcause|agent)\b/i;

const textOf = (c) => String(c?.text ?? c?.body ?? c?.comment ?? '').trim();
const atOf = (c) => c?.created_at || c?.at || null;
const ms = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : t;
};

/**
 * Ids named under a "Cards to act on" / "Read … first" heading: the ids on the heading
 * line and on the lines after it, up to the first blank line. A bead id on any other line
 * is a passing mention and not a card the round waits on. The bead itself never counts.
 */
export function idsFromDescription(description, selfId) {
  const lines = String(description || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!HEADING_RE.test(lines[i])) continue;
    for (let j = i; j < lines.length && (j === i || lines[j].trim() !== ''); j += 1) {
      for (const id of lines[j].match(ID_RE) || []) out.push(id);
    }
  }
  return [...new Set(out)].filter((id) => id !== selfId);
}

/** The ids of a bead's blocking dependencies — the cards a round is parked behind. */
export function blockingIds(issue) {
  return (issue?.dependencies || [])
    .filter((d) => (d.dependency_type || d.type) === 'blocks')
    .map((d) => d.depends_on_id || d.id)
    .filter(Boolean);
}

/** `--since` as given: an ISO time, or `last-round` / nothing, meaning the predecessor's close. */
export async function resolveSince(bd, ws, issue, since) {
  if (since && since !== 'last-round') {
    if (ms(since) === null) throw new Error(`--since "${since}" is neither an ISO time nor "last-round"`);
    return { at: new Date(since).toISOString(), from: 'flag' };
  }
  const named = REMAINDER_RE.exec(String(issue.description || ''))?.[1];
  const edge = (issue.dependencies || []).find((d) => (d.dependency_type || d.type) === 'discovered-from');
  const predecessor = named || edge?.depends_on_id || edge?.id;
  if (!predecessor) return { at: null, from: null, note: 'no predecessor named (remainder of / discovered-from) — pass --since' };
  const pred = await bd.show(ws, predecessor);
  const at = pred?.closed_at || null;
  if (!at) return { at: null, from: predecessor, note: `${predecessor} has no close time yet — pass --since` };
  return { at, from: predecessor };
}

/** One card, read against `sinceAt` (epoch-comparable ISO or null). */
export function readCard(wsName, issue, sinceAt, { answered = {}, isAgent = () => false } = {}) {
  const comments = Array.isArray(issue.comments) ? issue.comments : [];
  const sorted = [...comments].sort((a, b) => (ms(atOf(a)) ?? 0) - (ms(atOf(b)) ?? 0));
  const newest = sorted[sorted.length - 1] || null;
  const newestHuman = [...sorted].reverse().find((c) => !isAgent(c.author) && textOf(c)) || null;
  const since = ms(sinceAt);
  const touched = ms(issue.updated_at);
  const lastComment = ms(atOf(newest));
  const newer = (t) => since !== null && t !== null && t > since;
  const moved = newer(touched) || newer(lastComment);
  const verdict = evaluateBead(wsName, issue, answered);
  const view = (c) => c && { author: c.author || null, at: atOf(c), text: textOf(c) };
  return {
    id: issue.id,
    status: issue.status,
    title: issue.title || issue.id,
    updatedAt: issue.updated_at || null,
    moved,
    answered: verdict.state === 'answered',
    chosenOption: verdict.chosenOption,
    newestComment: view(newest),
    newestHumanComment: view(newestHuman),
    // Only comments after `since` are "what they now say"; an older one is already read.
    humanCommentIsNew: !!newestHuman && newer(ms(atOf(newestHuman))),
  };
}

/**
 * The whole round. A card the tracker cannot read comes back `{ id, error, missing }` —
 * a transient `bd` failure must not read as "not found" (bc-dgx7.109), so `missing` is true
 * only when the error text says there is no such bead.
 */
export async function cardsReport(bd, ws, beadId, { since, ids, answered = {}, isAgent } = {}) {
  const issue = await bd.show(ws, beadId);
  if (!issue) return { bead: beadId, missing: true, cards: [], summary: null };
  const named = ids?.length ? ids : [...new Set([...idsFromDescription(issue.description, beadId), ...blockingIds(issue)])];
  const sinceInfo = await resolveSince(bd, ws, issue, since);
  const cards = [];
  for (const id of named) {
    let card;
    try {
      card = await bd.showWithComments(ws, id);
    } catch (err) {
      const msg = String(err?.message || err).split('\n')[0];
      cards.push({ id, error: msg, missing: /no issues? found/i.test(msg) });
      continue;
    }
    if (!card) cards.push({ id, error: 'no such bead', missing: true });
    else cards.push(readCard(ws.name, card, sinceInfo.at, { answered, isAgent }));
  }
  const read = cards.filter((c) => !c.error);
  const summary = {
    total: cards.length,
    answered: read.filter((c) => c.answered).length,
    moved: read.filter((c) => c.moved).length,
    untouched: read.filter((c) => !c.moved).length,
    unread: cards.length - read.length,
  };
  return { bead: beadId, since: sinceInfo, cards, summary };
}

export function isAgentAuthor(actor) {
  return (author) => !!author && (AGENT_AUTHOR_RE.test(author) || (actor && author === actor));
}
