/**
 * What is true about one merge-bead right now — the read half of the shadow (bc-x0mhc).
 *
 * This is the only module here that touches the real tracker or GitHub, and it can only
 * read: it imports `view`, `baseChecks` and `commitsBetween` from lib/pr.js and nothing
 * that writes. The shadow's guarantee that it never acts on a pull request is this import
 * list, not a flag — there is no `merge`, `updateBranch`, `approve` or `bd update` in reach.
 *
 * The deciding is the daemon's own: `gateVerdict`, `reviewGated` and `judgeReview` are the
 * functions `sweepMergeQueue` calls, so where the workflow and the live queue disagree, the
 * difference is in the ladder (the order and the waits), which is the thing under test.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { view, baseChecks, commitsBetween, NO_SUCH_PR_RE } from '../../lib/pr.js';
import { gateVerdict } from '../../lib/mergeadvocate.js';
import { reviewGated, judgeReview } from '../../lib/reviewgate.js';
import { mergeSpec, queueState, reviewState, MERGE_LABEL } from '../../lib/mergebead.js';

const run = promisify(execFile);

/** Where the checkout lives. The spike shadows the beadcause workspace only. */
export const CHECKOUT = process.env.SPIKE_CHECKOUT || '/Users/you/projects/beadcause';

const CONFIG = process.env.SPIKE_CONFIG || path.join(os.homedir(), '.config', 'beadcause', 'config.json');

/**
 * The live policy for a workspace, read from the daemon's config file on every call.
 *
 * It was first written here as a constant — `reviewRequired` on, because docs/landing.md
 * says it was turned on for beadcause on 2026-08-23 — and the live config had it off, so
 * the shadow parked every queued pull request on a reviewer the real queue was not
 * waiting for. The per-workspace key wins over the global one, as in `prPolicyFor`
 * (lib/spaces.js); this reads just the two keys rather than the daemon's whole loader.
 */
export function policyFor(ws = 'beadcause', file = CONFIG) {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  const pick = (perWs, global) => (cfg[perWs] && ws in cfg[perWs] ? !!cfg[perWs][ws] : !!cfg.pr?.[global]);
  return {
    reviewRequired: pick('reviewRequiredPerWorkspace', 'reviewRequired'),
    requireApproval: pick('requireApprovalPerWorkspace', 'requireApproval'),
  };
}

/** Read-only `prApi` for `judgeReview`, which only ever asks `commitsBetween`. */
const readOnlyPr = { commitsBetween };

export async function showBead(id) {
  const { stdout } = await run('bd', ['show', id, '--json'], { cwd: CHECKOUT, maxBuffer: 16 << 20 });
  const rows = JSON.parse(stdout);
  return Array.isArray(rows) ? rows[0] : rows;
}

/**
 * Every merge-bead the live queue is holding or has carded, as ids — the queued ones
 * first, because those are the ones that move. Carded beads can sit untouched for weeks.
 */
export async function listQueue() {
  const ids = new Set();
  for (const label of [MERGE_LABEL, 'pr-delivery']) {
    const { stdout } = await run('bd', ['list', `--label=${label}`, '--status=open', '--json', '--limit=200'], {
      cwd: CHECKOUT,
      maxBuffer: 16 << 20,
    });
    const rows = JSON.parse(stdout || '[]').filter((row) => row.assignee === 'merge-advocate');
    for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) ids.add(row.id);
  }
  return [...ids];
}

/**
 * The facts one rung of the ladder needs, plus what the live queue has recorded, so the
 * ledger can put the two side by side.
 */
export async function factsFor(issue, { pr = { view, baseChecks }, policy = null, dir = CHECKOUT } = {}) {
  const labels = issue.labels || [];
  const state = queueState(issue);
  const review = reviewState(issue);
  const live = {
    status: issue.status,
    queued: labels.includes(MERGE_LABEL),
    carded: labels.includes('human') && !labels.includes(MERGE_LABEL),
    attempts: state.attempts || 0,
    refused: state.refused || null,
    held: !!state.held,
    reviewing: !!state.reviewing,
    resolving: !!state.resolving,
    approved: !!state.approved,
    verdict: review?.verdict || null,
    round: review?.round || 0,
    closeReason: issue.close_reason || '',
  };
  const spec = mergeSpec(issue);
  if (!spec) return { broken: true, live };
  policy = policy || policyFor(spec.workspace || 'beadcause');
  if (issue.status === 'closed') return { spec, gone: { how: 'bead-closed', reason: live.closeReason }, live };

  // By URL, not number: a merge-bead filed before the repo moved names the old repo, and
  // `#410` asked of today's checkout is a different pull request or none at all.
  let v;
  try {
    v = await pr.view(dir, spec.url || spec.number);
  } catch (err) {
    // Permanent, not an outage: retrying it for ever is how a workflow hides it.
    if (NO_SUCH_PR_RE.test(String(err.message)) || /Could not resolve to a Repository/i.test(String(err.message))) {
      return { spec, missing: String(err.message).split('\n')[0], live };
    }
    throw err;
  }
  if (v.state === 'MERGED') return { spec, gone: { how: 'merged', commit: v.mergeCommit }, live };
  if (v.state === 'CLOSED') return { spec, gone: { how: 'closed-unmerged' }, live };

  const gated = reviewGated(spec, state, policy);
  const reviewOutcome = gated ? await judgeReview(readOnlyPr, dir, { review, head: v.headSha }) : null;
  const baseline = await pr.baseChecks(dir, spec.base).catch(() => null);
  const verdict = gateVerdict({
    checks: v.checks,
    baseline: baseline ? baseline.failed : null,
    baseHasChecks: baseline ? baseline.state !== 'none' : null,
    mergeable: v.mergeable,
    timedOut: false,
    reviewDecision: v.reviewDecision,
    requireApproval: !!policy.requireApproval,
    approved: !!state.approved,
    checksAt: v.checks?.at || null,
    heldUntil: state.heldUntil || null,
  });
  return {
    spec,
    head: v.headSha,
    // The hold is decided in the daemon's memory (lib/redbase.js), so the shadow borrows
    // the live queue's answer rather than deriving its own. Recorded as a limitation.
    held: live.held,
    review: gated ? { act: reviewOutcome.act, why: reviewOutcome.why || '', round: live.round, verdict: live.verdict } : null,
    conflicted: v.mergeable === 'CONFLICTING' || v.mergeState === 'DIRTY',
    behind: v.mergeState === 'BEHIND',
    checks: v.checks?.state || 'none',
    verdict: {
      merge: !!verdict.merge,
      pending: v.checks?.state === 'pending',
      stale: !!verdict.stale,
      awaitingApproval: !!verdict.awaitingApproval,
      refused: verdict.refused || '',
    },
    live,
  };
}

export async function observeBead(id, opts) {
  return factsFor(await showBead(id), opts);
}
