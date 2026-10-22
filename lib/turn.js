/**
 * Whose move is this bead — an agent's, or Adam's — decided before a window does anything
 * (bc-dgx7.193). Eight sessions opened on a bead whose next move was Adam's, and each
 * worked that out by hand and ended with a comment, a `human` label and no commits.
 *
 * Pure: `turn()` takes a bead row (comments included) and answers; the caller reads the
 * tracker. The rules run in this order and the first to match decides, so the answer
 * always names one rule rather than a pile of them:
 *
 *   1. `human` label        — somebody already handed it to Adam.
 *   2. assignee is Adam     — it is held in his name.
 *   3. unanswered decision  — an open decision block nobody has answered
 *                             (lib/beadanswer.js's evaluateBead decides "answered").
 *   4. read card, no notes  — a send-to-phone Read card whose thread holds no `docnotes`
 *                             comment: Adam reads, then writes notes; until then there
 *                             is nothing to do.
 *
 * Anything else is the agent's. A closed bead is `agent` with rule `closed`: nobody's
 * move, and the caller should not open a window on it either way.
 */
import { evaluateBead } from './beadanswer.js';
import { accountList } from './accounts.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Who counts as Adam when a comment's author is read — built from the config, never
 * spelled here (bc-x79kq.1). It used to be a literal naming his handles, and the public
 * tree's scrub rewrites those, so a scrubbed checkout stopped recognising his own turns.
 *
 * `owner` (the bare name a hand assignment uses), every address in `me` and in
 * `accounts`, and each address's local part — a bd comment is signed with whichever of
 * those the writing shell had. `null` when the config names nobody: then only a
 * `docnotes` comment counts as input, which is the safe direction.
 */
export function humanPattern(cfg) {
  const names = new Set();
  const add = (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (s) names.add(s);
  };
  add(cfg?.owner);
  const emails = [...[].concat(cfg?.me || []), ...accountList(cfg).map((a) => a.email)];
  for (const e of emails) {
    add(e);
    if (String(e).includes('@')) add(String(e).split('@')[0]);
  }
  if (!names.size) return null;
  const alts = [...names].map((n) => `(?<![\\w.])${escapeRe(n)}(?![\\w])`);
  return new RegExp(alts.join('|'), 'i');
}
// Only the bare name: a claim stamps the git identity (an email) on every bead a worker takes,
// so matching that would call every claimed bead Adam's.
const ASSIGNEE_RE = /^adam$/i;
const DOCNOTES_RE = /docnotes/i;
// Title or label only — a body that merely talks about Read cards (this bead's own) is not one.
const READ_CARD_RE = /^\s*(send[- ]to[- ]phone\b|read\s*[:—-])/i;

const textOf = (c) => String(c?.text ?? c?.body ?? c?.comment ?? '').trim();
const whenOf = (c) => String(c?.created_at || c?.at || '');
const authorOf = (c) => String(c?.author || c?.created_by || '');

function typeOf(row) {
  return String(row?.issue_type || row?.type || '').toLowerCase();
}

/** Is this the bead's send-to-phone Read card? Title, labels or body say so. */
export function isReadCard(row) {
  if (typeOf(row) === 'decision') return false;
  const labels = (row?.labels || []).map((l) => String(l).toLowerCase());
  if (labels.some((l) => ["read", "read-card", "send-to-phone"].includes(l))) return true;
  return READ_CARD_RE.test(String(row?.title || ""));
}

/** The newest comment that counts as Adam's input: a `docnotes` comment, or one written
 * by somebody `human` (from `humanPattern`) matches. */
export function adamInput(comments, { human = null } = {}) {
  const list = Array.isArray(comments) ? comments : [];
  const counts = list.filter((c) => DOCNOTES_RE.test(textOf(c)) || Boolean(human?.test(authorOf(c))));
  const sorted = [...counts].sort((a, b) => whenOf(a).localeCompare(whenOf(b)));
  const last = sorted[sorted.length - 1];
  return last ? { at: whenOf(last), author: authorOf(last), text: textOf(last).slice(0, 200) } : null;
}

/**
 * @returns {{ turn: 'agent'|'adam', rule: string, reason: string, input: object|null }}
 */
export function turn(wsName, row, { answered = {}, human = null } = {}) {
  if (!row) return { turn: 'agent', rule: 'missing', reason: 'no such bead', input: null };
  const input = adamInput(row.comments, { human });
  const done = (t, rule, reason) => ({ turn: t, rule, reason, input });

  if (String(row.status || '').toLowerCase() === 'closed') {
    return done('agent', 'closed', "already closed — nobody's move");
  }
  if ((row.labels || []).includes('human')) {
    return done('adam', 'human-label', 'already labelled human');
  }
  if (ASSIGNEE_RE.test(String(row.assignee || '').trim())) {
    return done('adam', 'assignee', `assignee is ${row.assignee}`);
  }
  if (typeOf(row) === 'decision') {
    const verdict = evaluateBead(wsName, row, answered);
    if (verdict.hasDecision && verdict.state === 'unanswered') {
      return done('adam', 'unanswered-decision', 'a decision block with no recorded answer');
    }
  }
  if (isReadCard(row) && !(row.comments || []).some((c) => DOCNOTES_RE.test(textOf(c)))) {
    return done('adam', 'read-card-no-docnotes', 'a Read card with no docnotes comment on its thread');
  }
  return done('agent', 'default', "no rule says it is Adam's");
}

export function render(id, r) {
  const lines = [`${id}: ${r.turn} — ${r.rule} (${r.reason})`];
  if (r.input) {
    lines.push(`  newest input of Adam's: ${r.input.at || 'undated'}${r.input.author ? ` by ${r.input.author}` : ''}: ${r.input.text}`);
  }
  return lines;
}
