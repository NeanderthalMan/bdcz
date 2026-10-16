/**
 * Has Adam already decided this — every ruling on a topic, newest first.
 *
 * bc-dgx7.102: several sessions each needed to know whether a question was already
 * answered before putting it to Adam. The corpus that answers it is the tracker itself:
 * closed `decision`/`human` beads, where the ruling is the comment `respond()` wrote right
 * before closing — `lib/beadanswer.js`'s `answerFromComments` already knows how to find
 * that comment, and this reuses it rather than re-deriving it.
 *
 * Per-repo prose — a checkout's own change log, reference docs — is deliberately not read
 * here: it has no shared shape a generic tool could scan honestly (bc-j2zwo.6 removed the
 * one repo-specific `CHANGE_LOG.md` reader this module used to carry). A repo that keeps
 * its rulings in its own files answers that half with its own tooling.
 *
 * Matching is deliberately plain: every significant word (3+ letters, ignoring a short
 * stopword list) in the topic must appear, case-insensitively, somewhere in the
 * candidate's text. That is the instrument an agent typing a topic phrase can predict the
 * behaviour of.
 */
import { toQuestion } from './decision.js';
import { answerFromComments } from './beadanswer.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'is', 'was', 'were', 'be',
  'been', 'for', 'with', 'this', 'that', 'has', 'have', 'had', 'it', 'its', 'as', 'by',
]);

/** Significant words out of a free-text topic — what `textMatches` requires present. */
export function topicWords(topic) {
  return [
    ...new Set(
      String(topic || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    ),
  ];
}

/**
 * Every word in `words` present, case-insensitively, somewhere in `text` — AND, not OR,
 * so "chapter word count" does not match a document that only ever says "chapter". An
 * empty `words` list (no topic given, `-b` alone scoping the search) matches everything.
 */
export function textMatches(text, words) {
  if (!words.length) return true;
  const hay = String(text || '').toLowerCase();
  return words.every((w) => hay.includes(w));
}

function beadHaystack(issue) {
  return [issue.title, issue.description, issue.design, issue.notes, issue.acceptance_criteria]
    .filter(Boolean)
    .join('\n');
}

/**
 * Every closed `decision`-typed or `human`-labelled bead (or labelled with the workspace's
 * approval review label, where it declares a pipeline), plus every
 * still-open one of those (a packet already sitting on Adam's tap), whose text matches
 * `words`. Two `bd list` calls narrow the corpus before anything is read word-by-word —
 * a whole tracker's beads are never scanned client-side, only the subset that could ever
 * be a ruling.
 */
export async function findBeadRulings(bd, ws, words, { since = null } = {}) {
  // `human`, plus the review label where the workspace declares an approval pipeline — a
  // packet that has been ruled on may have lost `human` and kept that one.
  const review = typeof bd.approvalFor === 'function' ? bd.approvalFor(ws)?.review : '';
  const ruledLabels = ['human', review].filter(Boolean).join(',');
  const [decisions, human] = await Promise.all([
    bd.json(ws, ['list', '--type', 'decision', '--all', '--limit', '0']).catch(() => []),
    bd.json(ws, ['list', '--label-any', ruledLabels, '--all', '--limit', '0']).catch(() => []),
  ]);

  const byId = new Map();
  for (const issue of [...(decisions || []), ...(human || [])]) {
    if (issue?.id && !byId.has(issue.id)) byId.set(issue.id, issue);
  }

  const sinceMs = since ? Date.parse(since) : null;
  const rows = [];
  for (const issue of byId.values()) {
    if (!textMatches(beadHaystack(issue), words)) continue;

    const closed = issue.status === 'closed';
    const { decision } = toQuestion(ws.name, issue);

    let comments = [];
    try {
      comments = (await bd.comments(ws, issue.id)) || [];
    } catch {
      comments = [];
    }

    let text = null;
    let at = null;
    if (closed) {
      const found = answerFromComments(decision, comments);
      if (found?.comment) {
        text = String(found.comment.text ?? found.comment.body ?? found.comment.comment ?? '').trim();
        at = found.comment.created_at || found.comment.createdAt || issue.closed_at || issue.updated_at || null;
      } else {
        at = issue.closed_at || issue.updated_at || null;
      }
    } else {
      at = issue.updated_at || issue.created_at || null;
    }

    if (sinceMs && at && Date.parse(at) < sinceMs) continue;

    rows.push({
      kind: 'bead',
      id: issue.id,
      title: issue.title,
      open: !closed,
      question: decision?.question || null,
      text,
      at,
    });
  }

  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return rows;
}
