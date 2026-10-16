/**
 * Where the *ruling* on a bead is — **the second axis, drawn beside the pull request.**
 *
 * `lib/prstage.js` owns one ladder and it is about a branch: review, merged, pushed,
 * deployed, live. It is the only place that decides that, deliberately, because three
 * modules once answered "where is this PR" three ways and two screens disagreed in front
 * of somebody. **Nothing here touches it, and nothing here is a rung on it.**
 *
 * This is a different question about a different object. An approval pipeline — declared
 * per workspace in `cfg.approval` (lib/approvallabels.js) — is a four-state machine over
 * labels — draft → in-review → approved (which is a close) → revise — and it is about a
 * **deliverable** and Adam's ruling on it, not about a branch. A chapter can be
 * `in-review` with no pull request in existence; a pull request can be `merged` while the
 * thing it carries has never been ruled on. lm-uhl put the two ways of holding that to
 * Adam — teach `stageOf` to take a ladder, or draw a second axis — and the answer was the
 * second axis: *"the two facts stay two facts because they genuinely are two facts —
 * where the branch is, and where the ruling is."* So a card reads `in-review · PR open`,
 * and neither half is derived from the other or capable of overwriting it.
 *
 * ## Derived here rather than in the browser, and `null` for most beads
 *
 * The same arrangement as `lib/modelcard.js`, for the same reason and with one
 * difference. The reason: `toQuestion` (lib/decision.js) is narrow on purpose and drops
 * `labels`, so an inbox chip has nothing to read client-side, and this state machine is a
 * **policy** rather than a prefix — a browser copy of it would keep drawing confidently
 * after the pipeline had moved. Both cards are handed the identical object so they cannot
 * disagree about a bead, which is the failure that matters: two plausible answers with
 * nothing on either screen to say which one lied.
 *
 * The difference: `modelCard` answers for *every* bead, because every bead is routed
 * somewhere and a blank chip would hide the untiered ones. This answers `null` for every
 * bead not in a pipeline — and for *every* bead in a workspace that declares none, which
 * is the default. That is not a gap, it is the truth — a tracker where nothing is a review
 * packet has no rulings to report, and a chip saying so on every card would be a chip
 * carrying no information. Every inbox payload pays for whatever is added to it, so the
 * absent case is the one worth getting right.
 *
 * **No workspace name appears in this file.** The pipeline is a label vocabulary the
 * caller hands in, and a bead is in it exactly when it carries those labels.
 *
 * ## Why the replied label on its own is not `revise`
 *
 * `human-replied` is beadcause's own label (`REPLIED_LABEL`, lib/server.js) and it is set
 * on *any* bead in *any* workspace the moment you comment without answering. Read alone
 * it would put a `revise` chip across half of every tracker. It is `revise` only on a bead
 * that is a review packet — the pipeline's review label — which is exactly what the state
 * means: the filer asked, Adam declined to rule, the ball is with the agent.
 *
 * ## The vocabulary this shares with lib/approval.js
 *
 * `lib/approval.js` is bc-bmry.2 and it is the **policy** half of the same pipeline: an
 * agent may not close a bead carrying a human-only label. This is the **display** half,
 * and they are deliberately separate files rather than one — merging them would put a
 * card renderer's concerns inside the rule that refuses a close, and make lib/bd.js
 * depend on a chip. Both read one normalised pipeline off lib/approvallabels.js, so the
 * two halves cannot spell a label differently.
 */
import { REPLIED_LABEL as REPLIED } from './approvallabels.js';

/** What actually puts a bead on the phone. Its absence beside the review label is a bug. */
const HUMAN = 'human';

/**
 * The four states, with what each one means — the table both cards take their words
 * from, so neither can invent a fifth. A pipeline may restate a state's `label` and
 * `note` (`states` in its declaration); it may not add or rename one.
 *
 * In the order they happen in, and `revise` is last because it is not a rung after
 * `approved`: it is the loop back to `draft`. There is no `RANK` here and nothing sorts on
 * it, which is the other way this is not `lib/prstage.js` — that ladder exists so a board
 * can put the pull request you must act on first. This is a fact drawn beside another fact.
 */
export const APPROVAL_STATES = [
  {
    id: 'draft',
    label: 'draft',
    note: 'An agent is working on it. Nothing has been asked of anybody.',
  },
  {
    id: 'in-review',
    label: 'in-review',
    note: 'A review packet on the phone, waiting on a ruling.',
  },
  {
    id: 'approved',
    label: 'approved',
    note: 'Ruled on and closed — approval is the close, and only a tap can do it.',
  },
  {
    id: 'revise',
    label: 'revise',
    note: 'Commented on without being answered. Back with the agent, not with you.',
  },
];

/** Every state id, in the order above. */
export const APPROVAL_IDS = APPROVAL_STATES.map((s) => s.id);

/**
 * The state's row from the table, for a caller that wants the words — with the pipeline's
 * own wording laid over it where the pipeline restates one.
 */
export const approvalInfo = (id, pipeline = null) => {
  const row = APPROVAL_STATES.find((s) => s.id === id);
  if (!row) return null;
  const own = pipeline?.states?.[id];
  return own ? { ...row, ...own } : row;
};

/**
 * Labels, trimmed, with a lower-cased twin for matching.
 *
 * Matched case-insensitively and *displayed* as written: bd does not normalise labels, so
 * `Gate:g2` is a label it will happily store, and `gate:G2` is a spelling with a capital G
 * that a lower-cased chip would quietly correct.
 */
function labelsOf(bead) {
  return (bead?.labels || [])
    .map((l) => String(l ?? '').trim())
    .filter(Boolean)
    .map((raw) => ({ raw, key: raw.toLowerCase() }));
}

const lower = (v) => String(v || '').trim().toLowerCase();

/**
 * Everything either card needs to draw the ruling, off a `bd --json` row and the
 * workspace's pipeline — or `null` for a bead that is not in the pipeline, which is most
 * of them, and for every bead when there is no pipeline.
 *
 *   - `state` — one of `APPROVAL_IDS`, or `null`. Null *with a card present* is a real
 *     shape rather than a gap: a deliverable can carry a gate-prefixed label before the
 *     filer has put it in any state, and the honest answer then is the gate plus silence
 *     about the ruling.
 *   - `label` / `note` — the words from `APPROVAL_STATES` (or the pipeline's restatement),
 *     so no renderer writes its own.
 *   - `gates` — the `GN`s this bead counts towards, spelled as written. *Which* gate, not
 *     *how many are left*: the count is a query over a whole workspace and a card is
 *     handed one bead.
 *   - `isGate` — the bare gate label: this bead *is* a gate rather than counting towards
 *     one.
 *   - `revision` — the N from the revision prefix, or `null`. It rides the child that
 *     does the pass rather than the packet, which is why it is its own field and not part
 *     of `revise`.
 *   - `problem` — the sentence for a bead whose labels say something the pipeline calls a
 *     bug, or `null`.
 *
 * Never throws and never guesses. No pipeline, no bead, no labels, labels that are
 * numbers — `null`.
 */
export function approvalCard(bead, pipeline = null) {
  if (!pipeline) return null;
  const REVIEW = lower(pipeline.review);
  const DRAFT = lower(pipeline.draft);
  const GATE = lower(pipeline.gate);
  const GATE_PREFIX = lower(pipeline.gatePrefix);
  const labels = labelsOf(bead);
  const has = (name) => !!name && labels.some((l) => l.key === name);
  const needsApproval = has(REVIEW);
  const draft = has(DRAFT);
  const isGate = has(GATE);
  const gates = GATE_PREFIX
    ? labels
        .filter((l) => l.key.startsWith(GATE_PREFIX) && l.key.length > GATE_PREFIX.length)
        .map((l) => l.raw.slice(GATE_PREFIX.length).trim())
        .filter((g, i, all) => g && all.indexOf(g) === i)
    : [];
  const revision = revisionOf(labels, lower(pipeline.revisionPrefix));

  // The gate on the whole card. The replied label is missing from this list on purpose —
  // see the header: alone it is a beadcause-wide flag and would light up a tracker that
  // has never heard of an approval pipeline.
  if (!needsApproval && !draft && !isGate && !gates.length && revision === null) return null;

  const state = stateOf(bead, { needsApproval, draft, replied: has(REPLIED) });
  const info = approvalInfo(state, pipeline);
  return {
    state,
    label: info?.label || '',
    note: info?.note || '',
    gates,
    isGate,
    revision,
    problem: problemWith(pipeline, { needsApproval, human: has(HUMAN), isGate, gates, status: bead?.status }),
  };
}

/**
 * Which of the four, or `null`.
 *
 * The order of the branches is the whole of it, and two are worth the words:
 *
 * - **`approved` is a close.** There is no "approved but still open" state, and no agent
 *   may set it, because the only thing that can is Adam's tap. So this reads `status`, not
 *   a label, and a review packet that closed is approved however it closed. That last part
 *   is a deliberate over-reach: a packet closed by hand is one somebody decided about, and
 *   calling it `in-review` on the strength of the label still sitting there would have the
 *   card telling you a question is outstanding when it is not.
 * - **`revise` outranks `in-review`.** Between your comment and the agent's next pass the
 *   bead carries both labels, and the truer of the two is that it is no longer waiting on
 *   you. The agent strips the review label when it opens the revision child; until that
 *   happens, this is what the card should say.
 *
 * A closed bead that is only a draft — or only a gate — gets `null` rather than a state.
 * It is not approved, and it is not in draft any more; it is finished work, and the
 * status pill beside the chip already says so.
 */
function stateOf(bead, { needsApproval, draft, replied }) {
  const closed = String(bead?.status || '').toLowerCase() === 'closed';
  if (needsApproval && closed) return 'approved';
  if (closed) return null;
  if (needsApproval && replied) return 'revise';
  if (needsApproval) return 'in-review';
  if (draft) return 'draft';
  return null;
}

/**
 * `<prefix>2` → `2`. Ignores a bare prefix and anything that is not a whole number, and
 * answers `null` for a pipeline that declares no revision prefix at all.
 *
 * Digits rather than `Number()`, and that is not fussiness: `Number('')` is **0**, so a
 * bare prefix typed by hand would have read as revision zero and put a card on a bead
 * that is not in the pipeline at all. `Number('2e1')` is 20, which is not a revision
 * anybody wrote.
 */
function revisionOf(labels, prefix) {
  if (!prefix) return null;
  for (const l of labels) {
    if (!l.key.startsWith(prefix)) continue;
    const text = l.raw.slice(prefix.length).trim();
    if (/^\d+$/.test(text)) return Number(text);
  }
  return null;
}

/**
 * The two label shapes a pipeline calls bugs, as a sentence — or `null`.
 *
 * Both are invisible from the phone *by construction*, which is why they are worth
 * drawing at all. The review label without `human` is the worse one and comes first: it
 * is the specific bug where the packet never reaches the inbox — the inbox is `bd human
 * list` — *and* the advocate, whose whole definition of work is ready-minus-`human`, may
 * open an unattended session on it. A question nobody was asked, being answered by an
 * agent.
 *
 * **Only the bead sheet can ever draw this one**, and that is the point rather than a
 * limitation: the inbox is the set of `human` beads, so a packet missing that label is by
 * definition not on the card that would have complained about it.
 *
 * Only while open, too. A packet that has been ruled on and closed is not waiting to
 * reach anybody, and flagging it would raise an alarm about something that already
 * happened.
 */
function problemWith(pipeline, { needsApproval, human, isGate, gates, status }) {
  const closed = String(status || '').toLowerCase() === 'closed';
  if (needsApproval && !human && !closed) {
    return `${pipeline.review} without human — this never reaches the phone, and an advocate may open a session on it`;
  }
  if (isGate && gates.length) {
    return `a gate carries the bare \`${pipeline.gate}\` label, never \`${pipeline.gatePrefix}GN\` — the namespaced one means it counts towards a gate`;
  }
  return null;
}
