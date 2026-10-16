/**
 * The one law: **no agent closes a bead carrying a label the workspace's approval pipeline
 * names as human-only** — in practice a gate, and a bead that is waiting to be approved.
 * The tap is the close — and, since bc-bmry.8, the tap is the merge too.
 *
 * The rule came from the first workspace to declare an approval pipeline, where it was
 * written down three times in that repo's own documents and read by nothing. beadcause had
 * no idea what a gate was, so a gate bead came up ready like any other bead, an advocate
 * opened an unattended session on it, and the session ran its ordinary ending, which closes
 * the bead the window was opened for. **It has already fired**: one delivery closed an epic
 * over six open children, four of them gates, and that workspace's status board then
 * reported a gate met and the next ones unblocked, on a lie — the exact silent failure the
 * rule exists to prevent.
 *
 * **Which labels, is the workspace's to say.** beadcause ships no gate vocabulary: the
 * pipeline is declared in `cfg.approval[<workspace>]` (lib/approvallabels.js), and a
 * workspace that declares none holds no close here at all. What stays beadcause's is the
 * rule itself, and that it is enforced in code rather than only in a brief.
 *
 * Decided as *both*: the worker brief states the law in words **and** beadcause refuses the
 * close in code, so a brief that drifts cannot silently reopen the hole.
 *
 * ## And the merge itself, decided later, the same way
 *
 * bc-bmry.2 built the close refusal above and deliberately left the *merge* alone — a gate
 * bead's pull request still went on the merge queue like anything else, and the only thing
 * standing between it and `main` was a session remembering to type `--review`. That is the
 * shape the close answer warns against — a worker is a promise the code did not yet keep.
 * bc-bmry.8 asked whether it should, and the answer is the same *both*: `bin/deliver.js`
 * now holds the merge itself, whether or not `--review` was passed, the same way
 * `editHold` already holds an in-app edit's. Every held delivery becoming a card instead of
 * a queue entry is a decision per gate session, which is the point of a gate.
 *
 * ## What is held, and what deliberately is not
 *
 * The bare gate label means *I am a gate*. The gate *prefix* (`gate:G0`, say) means *I
 * count towards G0* and is an ordinary deliverable — the beads under a gate are exactly the
 * work that moves it, and holding those would stop the whole ladder rather than protecting
 * it. So the match is exact, on the whole label, and a prefix match would be wrong in the
 * one way that is expensive to notice.
 *
 * The review label is the second half of the same law: a bead sitting in the pipeline is
 * waiting on a judgement nothing in a pull request is evidence about.
 *
 * ## Why this is a rule about the *close reason*, and not about the bead
 *
 * The tempting shape is the one lib/endorse.js and lib/shipbead.js use — a filter plus a
 * refusal, so the bead never reaches a queue and cannot be worked at all. That is
 * `QUEUE_EXCLUDED`, and it is **not** what was decided: a gate is not unworkable. Evidence
 * gets gathered against it, notes get written on it, and the answer chose to keep gate
 * beads dispatchable and stop only the close.
 *
 * More importantly, a blanket refusal would break the half of the law that matters most.
 * *The tap is the close* — when a gate is genuinely met, Adam closes it from the phone, and
 * the phone asks `Bd.gateFor` whether a close would be refused before it draws the button
 * (lib/server.js). A rule that refused every close would take the button away and leave a
 * gate that nothing on this machine could ever close.
 *
 * So the refusal keys on the *sentence the close would carry*. `isMergeReason` in lib/bd.js
 * already identifies the three sentences a merge writes — `Landed as #42` from a worker's own
 * delivery and from the tap on a delivery card, `Merged #212 as 72789c0b into main on GitHub`
 * from the sweep that notices a merge made on github.com — and every automated close of a
 * work bead in this program carries one of them. A close Adam asks for by name does not, and
 * goes through untouched.
 *
 * ## Where the rule is enforced, and why it is more than one place
 *
 * `Bd.gateFor` is the funnel for everything inside the daemon: the tap on a delivery card
 * (`finishWorkBead`, lib/server.js), the sweep that notices a merge on github.com
 * (lib/landed.js), and the retry minutes later that runs with nothing in hand but the stored
 * sentence (lib/owed.js). Two paths cannot ask it and are wired separately for the same
 * reason the epic rule is:
 *
 *  - **lib/mergequeue.js** closes the work bead directly after a merge, and already had the
 *    epic branch written out by hand beside it.
 *  - **bin/deliver.js** is a different process shelling out to `bd` synchronously. It cannot
 *    import a `Bd`, it attempts the close and handles the refusal, and it already checks the
 *    merge-reason half itself.
 *
 * Every one of them hands in the workspace's pipeline (`approvalPipeline`); with none, every
 * function below answers "nothing holds this".
 *
 * ## What this is not strong enough to be
 *
 * A `bd close` typed at a terminal still closes a gate. bd has no pre-close hook — `bd hooks`
 * installs git hooks and nothing else — so no rule beadcause holds can reach it. What this
 * covers is the only ending an unattended session has, which is the one that fired.
 */
// Re-exported so a caller that enforces the rule needs one import for the rule and the
// workspace's pipeline it is enforced over.
export { approvalPipeline } from './approvallabels.js';

const heldBy = (pipeline) => (Array.isArray(pipeline?.humanOnly) ? pipeline.humanOnly : []);

/**
 * Which human-only label holds this bead's close, or `''` for a bead none holds — which is
 * every bead in a workspace with no pipeline.
 *
 * Takes a `bd --json` row, or anything with `labels`, and the workspace's pipeline.
 * Returns the label rather than a boolean because every refusal below has to *say which
 * one stopped it* — "it is a gate" and "it is waiting to be approved" send a reader to two
 * different places, and a session told only that something refused retries.
 */
export function approvalHold(issue, pipeline = null) {
  const held = heldBy(pipeline);
  if (!held.length) return '';
  const labels = (issue?.labels || []).map((label) => String(label).trim());
  return held.find((label) => labels.includes(label)) || '';
}

/** What kind of hold a label is, in this pipeline: `review`, `gate`, or `other`. */
export function holdKind(label, pipeline = null) {
  if (label && label === pipeline?.review) return 'review';
  if (label && label === pipeline?.gate) return 'gate';
  return 'other';
}

/**
 * The refusal, in the words that go on the bead and onto the phone.
 *
 * One sentence, written once, because it is said by five callers in four files and a
 * refusal that reads differently depending on which door it came through is a refusal
 * nobody can search for.
 *
 * It names the label, says what the close would have destroyed, and says what to do
 * instead — which for a session is `--review`, and for anybody reading afterwards is the
 * tap. A refusal that only says no is the one a session works around.
 */
export function approvalRefusal(label, pipeline = null) {
  const kind = holdKind(label, pipeline);
  if (kind === 'review') {
    return (
      `a bead labelled \`${label}\` does not close on a merge — it is waiting on an approval, ` +
      'and merging its pull request is not that approval. Deliver with `--review` and let the tap close it'
    );
  }
  if (kind === 'gate') {
    return (
      `a bead labelled \`${label}\` does not close on a merge — a gate closes when the gate is met, ` +
      'which a merged pull request is no evidence about. Deliver with `--review` and let the tap close it'
    );
  }
  return (
    `a bead labelled \`${label}\` does not close on a merge — this workspace's approval pipeline names it ` +
    'human-only, so a person closes it and a merged pull request does not. Deliver with `--review` and let the tap close it'
  );
}

/**
 * The one-line reason a *delivery* of one of these hands over instead of merging — the
 * merge-time twin of `approvalRefusal`, which is about the close. Written separately
 * rather than reused, because the two happen at different moments and are read by two
 * different audiences: the refusal explains a close that already failed, this explains a
 * merge `bin/deliver.js` chose not to attempt at all. Shaped like `EDIT_HOLD` in
 * lib/editwork.js — a standalone clause naming the bead, usable in a console line, a
 * comment, or a pull-request note without further framing.
 */
export function approvalMergeHold(label, pipeline = null) {
  const kind = holdKind(label, pipeline);
  if (kind === 'review') {
    return (
      `this bead is labelled \`${label}\`, and it is waiting on a judgement a green pull ` +
      'request is not — it merges when the tap does, not on its own'
    );
  }
  if (kind === 'gate') {
    return (
      `this bead is labelled \`${label}\`, and a gate closes when the gate is met, which a pull ` +
      'request merging is no evidence about — it merges when the tap does, not on its own'
    );
  }
  return (
    `this bead is labelled \`${label}\`, which this workspace's approval pipeline names human-only — ` +
    'it merges when the tap does, not on its own'
  );
}

/**
 * The whole rule, for a caller that has the bead, the sentence its close would carry, and
 * the workspace's pipeline.
 *
 * Returns the refusal, or `''` when the close may go through — the same shape as
 * `Bd.gateFor`'s `null`, and deliberately not a throw: every caller here has already
 * merged something by the time it asks, and a refusal is a state to write down rather than
 * an error to unwind.
 *
 * `merged` is passed in rather than computed, because the one predicate that decides it —
 * `isMergeReason` — lives in lib/bd.js and importing it here would put a cycle between the
 * two files the moment lib/bd.js imports this one.
 */
export function approvalStop(issue, merged, pipeline = null) {
  if (!merged) return '';
  const held = approvalHold(issue, pipeline);
  return held ? approvalRefusal(held, pipeline) : '';
}
