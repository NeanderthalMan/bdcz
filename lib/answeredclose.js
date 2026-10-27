/**
 * The label a commission leaves when the option Adam picked said, in effect,
 * "close this once the work it orders is actually done".
 *
 * bc-eqn1.5.2: Adam answered "Close bc-eqn1.5" on an epic whose commission also
 * listed work to do — re-parent a child, hand a residual acceptance elsewhere —
 * so the option had to carry `closes: false` like any other commission (lib/
 * decision.js), and the fact that the eventual verdict was *close* had nowhere
 * to land. `commission()` in lib/bd.js writes a comment, drops the `human` label
 * and reopens the bead — none of those three writes says what the answer was
 * actually *for*, so once the commissioned pull request merged the epic sat open
 * on purpose (lib/mergequeue.js's epic branch: "an epic closes when its theme is
 * done") and the finished-epic sweep (lib/finishedepic.js) asked the same
 * question a third time the moment its children cleared.
 *
 * So this is the marker `commission()` writes when the picked option carries
 * `closesOnLanding: true`, and the two readers of it: the merge queue's epic
 * branch closes the epic once the commissioned work lands and nothing is open
 * under it, quoting the answer as the close reason; the finished-epic sweep
 * treats a marked epic as already answered and does not draw a second card over
 * the same verdict. A plain label rather than anything heavier, because reading
 * it back costs nothing beyond the `bd show` both callers already pay for.
 */
export const ANSWERED_CLOSE_LABEL = 'answered-close';

/** Does this row carry the marker? Reads straight off the labels `bd show` returns. */
export const carriesAnsweredClose = (issue) => (issue?.labels || []).some((l) => String(l).trim() === ANSWERED_CLOSE_LABEL);
