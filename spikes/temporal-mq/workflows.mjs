/**
 * One pull request's journey through the merge queue, as a Temporal workflow — bc-x0mhc.
 *
 * The ladder is `sweepMergeQueue`'s (lib/mergequeue.js), in its order: gone → hold →
 * review → conflict → behind → approval → pending/stale → refused → merge. What differs is
 * the shape. The daemon runs the ladder for every bead once a tick and rebuilds each bead's
 * position from the notes block it wrote last time (attempts, turnAt, resolving,
 * reviewing, heldUntil …). Here the position is the workflow's own local state, and a wait
 * is a line of code that blocks: `await condition(…, '30 minutes')` survives a worker
 * restart, a daemon restart and a reboot, because Temporal replays the history to get back
 * to it.
 *
 * Workflow code must be deterministic, so nothing here reads a clock, a file or GitHub.
 * Every fact arrives from the `observe` activity, and every effect leaves through a
 * recorder activity (activities.mjs), which in this spike writes a ledger line and nothing
 * else.
 */
import {
  proxyActivities,
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  workflowInfo,
  continueAsNew,
  patched,
} from '@temporalio/workflow';

const reads = proxyActivities({
  startToCloseTimeout: '3 minutes',
  // A GitHub or tracker outage is a wait, not a failure: retry for as long as it takes.
  retry: { initialInterval: '15 seconds', backoffCoefficient: 2, maximumInterval: '5 minutes' },
});
const effects = proxyActivities({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '2 seconds', maximumAttempts: 5 },
});

/** The driver saw something change on the bead or the PR. Wake up and look again. */
export const poke = defineSignal('poke');
/** The reviewer wrote a verdict. In a real version the reviewer's session sends this. */
export const reviewVerdict = defineSignal('reviewVerdict');
/** Adam answered the card: `merge`, `changes` or `decline`. The phone tap, as a signal. */
export const humanAnswer = defineSignal('humanAnswer');
/** The live queue finished this bead (shadow only): how, so the ledger can compare. */
export const liveOutcome = defineSignal('liveOutcome');
export const status = defineQuery('status');

export const MAX_ATTEMPTS = 3;
export const MAX_DOWNMERGES = 3;
/** Past this many events, hand the state to a fresh run so the history stays small. */
export const HISTORY_LIMIT = 2000;

export function freshState(beadId) {
  return {
    beadId,
    pr: null,
    seq: 0,
    phase: 'start',
    why: '',
    attempts: 0,
    refusal: '',
    downmerges: 0,
    reviewAsked: '',
    answerAsked: '',
    resolverFor: '',
    carded: '',
    answer: null,
    merged: false,
    pokes: 0,
    verdicts: 0,
    live: null,
    lastLive: null,
    runs: 1,
    adopted: false,
  };
}

export async function prJourney(input) {
  const s = input?.state || freshState(input.beadId);
  const wf = workflowInfo().workflowId;

  setHandler(poke, () => void s.pokes++);
  setHandler(reviewVerdict, () => void s.verdicts++);
  setHandler(humanAnswer, (a) => void (s.answer = a?.answer || null));
  setHandler(liveOutcome, (o) => void (s.live = o || { how: 'ended' }));
  setHandler(status, () => s);

  const key = (kind) => `${wf}:${++s.seq}:${kind}`;
  const say = (kind, why = '') =>
    effects[kind]({ key: key(kind), beadId: s.beadId, pr: s.pr, why, live: s.lastLive });
  /** Move to a phase, and write the move to the ledger only when it is a move. */
  const enter = async (phase, why = '') => {
    if (s.phase === phase && s.why === why) return;
    s.phase = phase;
    s.why = why;
    await say('note', `${phase}${why ? ` — ${why}` : ''}`);
  };
  /** Block until the driver or a signal says something changed, or the timer fires. */
  const waitFor = async (timeout, also = () => false) => {
    const pokes = s.pokes;
    const verdicts = s.verdicts;
    await condition(() => s.pokes !== pokes || s.verdicts !== verdicts || !!s.live || also(), timeout);
  };

  /** A card: raised once, then the workflow sleeps until Adam answers it. */
  const card = async (why) => {
    if (!s.carded) await say('raiseCard', why);
    s.carded = why;
    await enter('carded', why);
    await condition(() => !!s.answer || !!s.live);
    if (s.live) return;
    const answer = s.answer;
    s.answer = null;
    s.carded = '';
    s.attempts = 0;
    if (answer === 'merge') {
      await say('merge', 'Adam answered Merge on the card');
      await say('closeBeads', 'merged from the card');
      s.merged = true;
    } else if (answer === 'changes') {
      await say('openAnswer', 'Adam asked for changes on the card');
      s.answerAsked = '';
    } else if (answer === 'decline') {
      await say('closeBeads', 'Adam declined it');
      s.merged = true;
    }
  };

  const refuse = async (why) => {
    s.attempts = why === s.refusal ? s.attempts + 1 : 1;
    s.refusal = why;
    if (s.attempts >= MAX_ATTEMPTS) return card(why);
    await enter('refused', `attempt ${s.attempts}/${MAX_ATTEMPTS}: ${why}`);
    await waitFor('1 minute');
  };

  const limit = input?.historyLimit || HISTORY_LIMIT;
  for (;;) {
    if (workflowInfo().historyLength > limit || workflowInfo().continueAsNewSuggested) {
      return continueAsNew({ beadId: s.beadId, historyLimit: input?.historyLimit, state: { ...s, runs: s.runs + 1 } });
    }

    if (s.live) {
      await say('agreement', `live queue ended it (${s.live.how}${s.live.reason ? `: ${s.live.reason}` : ''}); shadow was at ${s.phase}${s.merged ? ' having merged' : ''}`);
      return { ...s, phase: 'ended' };
    }

    const f = await reads.observe({ beadId: s.beadId });
    s.lastLive = f.live;
    if (f.spec) s.pr = f.spec.number;

    // A bead the live queue was already carrying when the shadow first saw it: adopt its
    // count and its card rather than start it at attempt 0. Moving an in-flight queue onto
    // workflows needs exactly this import. Behind `patched` because it was added while
    // twelve workflows were running, and without the marker their replay would diverge.
    if (!s.adopted && patched('adopt-live-state')) {
      s.adopted = true;
      if (f.live && !f.gone) {
        s.attempts = f.live.attempts || 0;
        s.refusal = f.live.refused || '';
        if (f.live.carded && s.phase !== 'carded') {
          await card(`carded before the shadow started: ${f.live.refused || 'no reason recorded'}`);
          continue;
        }
      }
    }

    if (f.broken) {
      await card('the merge-bead has no readable delivery block');
      continue;
    }
    // Keyed on a field no recorded result has ever carried, so running histories replay
    // straight past it — no `patched` needed, unlike a change to what old facts lead to.
    if (f.missing) {
      await card(`GitHub has no such pull request: ${f.missing}`);
      continue;
    }
    if (f.gone) {
      if (f.gone.how === 'merged' && !s.merged) await say('closeBeads', `PR merged (${f.gone.commit || 'no commit'})`);
      if (f.gone.how === 'closed-unmerged') await say('closeBeads', 'PR closed unmerged: close the merge-bead only');
      await say('agreement', `gone (${f.gone.how}); shadow was at ${s.phase}${s.merged ? ' having merged' : ''}`);
      return { ...s, phase: 'ended' };
    }
    if (s.merged) {
      // The shadow has merged; the live queue has not caught up yet. Wait for it.
      await enter('merged-in-shadow');
      await waitFor('10 minutes');
      continue;
    }
    if (f.held) {
      await enter('held', 'base is red and somebody is on it');
      await waitFor('5 minutes');
      continue;
    }

    if (f.review && f.review.act !== 'merge') {
      const round = `${f.review.round}:${f.head}`;
      if (f.review.act === 'escalate') {
        await card(`review: ${f.review.why}`);
        continue;
      }
      if (f.review.act === 'answer') {
        if (s.answerAsked !== round) await say('openAnswer', f.review.why);
        s.answerAsked = round;
        await enter('awaiting-answer', f.review.why);
      } else {
        if (s.reviewAsked !== round) await say('openReviewer', f.review.why);
        s.reviewAsked = round;
        await enter('awaiting-review', f.review.why);
      }
      // No polling while a person or an agent is thinking: the verdict arrives as a signal.
      // The timer is only a backstop for a signal that was never sent.
      await waitFor('30 minutes');
      continue;
    }

    if (f.conflicted) {
      if (s.resolverFor !== f.head) {
        await say('openResolver', 'branch conflicts with its base');
        s.resolverFor = f.head;
        await enter('resolving');
        await waitFor('15 minutes');
        continue;
      }
      await refuse('a resolver had this head and it still conflicts');
      continue;
    }
    if (f.behind && s.downmerges < MAX_DOWNMERGES) {
      await say('downmerge', `behind ${f.spec.base}`);
      s.downmerges++;
      await enter('downmerged', `${s.downmerges}/${MAX_DOWNMERGES}`);
      await waitFor('2 minutes');
      continue;
    }
    if (f.verdict.awaitingApproval) {
      await card('awaiting Adam’s approval');
      continue;
    }
    if (f.verdict.pending || f.verdict.stale) {
      await enter('checks-running', f.verdict.stale ? 'checks predate the base coming back' : '');
      // Two minutes, not the daemon's one: every look is two `gh` calls on the account the
      // live queue also spends from. A webhook signal would make this a wait, not a poll.
      await waitFor('2 minutes');
      continue;
    }
    if (f.verdict.refused) {
      await refuse(f.verdict.refused);
      continue;
    }
    if (f.verdict.merge) {
      await say('merge', 'checks green, or red only where the base is');
      await say('closeBeads', 'merged by the queue');
      s.merged = true;
      continue;
    }
    await enter('unclassified', JSON.stringify(f.verdict));
    await waitFor('5 minutes');
  }
}
