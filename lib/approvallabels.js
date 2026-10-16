/**
 * The approval pipeline's label vocabulary — **declared per workspace, never shipped.**
 *
 * An approval pipeline is a state machine over labels: a bead is a draft, then a review
 * packet waiting on a person's ruling, then approved (which is a close), or sent back to
 * revise. Beside it sit gates — beads that *are* a milestone, and beads that count
 * towards one — and numbered revision passes. The first workspace to declare one was a
 * writing studio, and for a while its vocabulary was written into this file as
 * constants. It is not beadcause's to own: a workspace names its own labels in
 * `cfg.approval[<workspace>]` (lib/config.js), and a workspace that names none has no
 * pipeline at all — no label holds a close, no card draws a ruling, and nothing here
 * costs anything.
 *
 * Spelled once, here, so `lib/approval.js` (the policy: no agent closes a bead carrying
 * a label the pipeline names as human-only) and `lib/approvalcard.js` (the display: where
 * the ruling is, drawn on both cards) read one normalised answer rather than two private
 * copies of the config. They stay two files on purpose — merging them would put a card
 * renderer inside the rule that refuses a close, and make lib/bd.js depend on a chip.
 *
 * ## Why the config on this Mac, and not a file in the repo
 *
 * A relay may be declared in the checkout (`.beadcause/relays.yaml`); a pipeline may not.
 * The human-only list is the rule that stops an agent closing a bead that is waiting on
 * you, and a rule any branch could delete by editing a file is not a rule. Same authority
 * line lib/relaydefs.js draws around `packet:`.
 *
 * `human` is deliberately not part of the vocabulary. `lib/server.js`'s `HUMAN_LABEL` is
 * the same string for the whole app — it is what puts *any* bead on the phone — and the
 * pipeline reads it rather than defining its own meaning for it.
 */

/**
 * beadcause's own label, set on any commented-on bead in any workspace — the approval
 * pipeline reads it as `revise`, but only beside the review label. The same string as
 * `lib/server.js`'s `REPLIED_LABEL`, which is what actually sets it; this is the
 * pipeline's own copy for reading it. Not configurable: it is beadcause's, not a
 * workspace's.
 */
export const REPLIED_LABEL = 'human-replied';

/**
 * The label names a pipeline may declare, and what each one means.
 *
 *   - `review` — the bead is a review packet, waiting on a person's ruling.
 *   - `gate` — bare: *"I am a gate"*. Not the prefix below.
 *   - `gatePrefix` — `<prefix>G2`: *"I count towards G2"*, an ordinary deliverable.
 *   - `draft` — an agent is working on it; nothing has been asked of anybody yet.
 *   - `revisionPrefix` — `<prefix>2`: the Nth pass, carried by the child that does it.
 */
export const LABEL_KEYS = Object.freeze(['review', 'gate', 'gatePrefix', 'draft', 'revisionPrefix']);

/** The four state ids a pipeline moves through. Their words may be restated; the ids may not. */
export const STATE_IDS = Object.freeze(['draft', 'in-review', 'approved', 'revise']);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The pipeline a workspace declares, normalised — or `null` where it declares none, which
 * is every workspace until somebody writes one.
 *
 *   { review, gate, gatePrefix, draft, revisionPrefix,   // '' where not declared
 *     humanOnly: [...],                                   // labels only a person closes
 *     states: { <id>: { label?, note? } } }               // wording overrides, may be {}
 *
 * `humanOnly` defaults to the `gate` and `review` labels the pipeline declares, because
 * those are the two a pipeline exists to hold; a workspace that wants a different list
 * states it. A stated list is kept as stated — `[]` is a pipeline whose cards draw but
 * whose closes nothing holds, which is a thing the config on this Mac may say.
 *
 * Never throws; an unreadable entry is no pipeline.
 */
export function approvalPipeline(cfg = {}, workspaceName = '') {
  const name = String(workspaceName || '').trim();
  if (!name) return null;
  const map = cfg && isObj(cfg.approval) ? cfg.approval : null;
  const entry = map && isObj(map[name]) ? map[name] : null;
  if (!entry) return null;
  const given = isObj(entry.labels) ? entry.labels : {};
  const labels = Object.fromEntries(LABEL_KEYS.map((k) => [k, str(given[k])]));
  if (!LABEL_KEYS.some((k) => labels[k])) return null;
  const humanOnly = Array.isArray(entry.humanOnly)
    ? entry.humanOnly.map(str).filter(Boolean)
    : [labels.gate, labels.review].filter(Boolean);
  const states = {};
  if (isObj(entry.states)) {
    for (const id of STATE_IDS) {
      const s = entry.states[id];
      if (!isObj(s)) continue;
      const out = {};
      if (str(s.label)) out.label = str(s.label);
      if (str(s.note)) out.note = str(s.note);
      if (Object.keys(out).length) states[id] = out;
    }
  }
  return { ...labels, humanOnly, states };
}
