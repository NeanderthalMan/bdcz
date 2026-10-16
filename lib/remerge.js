/**
 * What it takes to put a stalled merge card's pull request back on the queue (bc-dgx7.191).
 *
 * Four sessions (lm-4o63, lm-wj70, lm-7td5, lm-ns2e) each opened on a card titled
 * `Merge #N — <work-bead>: …`, found the conflict already gone, and then re-read
 * bin/deliver.js to learn the one thing that is not guessable: the re-queue is a delivery
 * of the WORK bead (not the card) with `--branch <pr-head>`, because deliver.js supersedes
 * the open card for that pull request. This module holds that rule and nothing else —
 * the branch facts come from lib/prbranch.js, the card's fields from lib/mergebead.js.
 */
import path from 'node:path';
import { isMergeBead, mergeSpec } from './mergebead.js';

/**
 * Read a card into what the re-queue needs, or say why it cannot be re-queued from here.
 * `{ ok: true, number, branch, base, bead }` or `{ ok: false, reason }`.
 */
export function cardPlan(row) {
  if (!row) return { ok: false, reason: 'no such bead' };
  if (!isMergeBead(row)) return { ok: false, reason: `${row.id} is not a merge card (no merge-queue label)` };
  const d = mergeSpec(row);
  if (!d) return { ok: false, reason: `${row.id} carries no beadpr block` };
  if (d.error) return { ok: false, reason: `${row.id}: ${d.error}` };
  return { ok: true, number: d.number, branch: d.branch, base: d.base || 'main', bead: d.bead || null, repo: d.repo || null };
}

/**
 * The delivery that re-queues, as text. Work bead and `--branch`, never the card: the card
 * is what gets superseded. `null` when the card names no work bead — then only a tap can
 * re-queue it (`bin/merge.js` is a classifier-gated approval, not something to run unasked).
 */
export function deliverCommand({ root, workspace, bead, branch }) {
  if (!bead) return null;
  const bin = path.join(root, 'bin', 'deliver.js');
  return `node ${bin} -w ${workspace} -b ${bead} --branch ${branch} --tests "<what you ran>" <<'EOF'\n<description>\nEOF`;
}

/**
 * Which worktree may be merged into: it holds the newest copy, is clean, is not mid-merge,
 * and is not the main checkout. `{ ok, reason? }`.
 */
export function mergeTarget(copies, newest, worktree, mainDir) {
  const abs = path.resolve(worktree);
  if (abs === path.resolve(mainDir)) return { ok: false, reason: 'that is the main checkout' };
  const c = (copies || []).find((x) => x.kind === 'worktree' && path.resolve(x.path) === abs);
  if (!c) return { ok: false, reason: `${abs} does not have the PR branch checked out` };
  if (c.sha !== newest) return { ok: false, reason: `${abs} is not at the newest copy of the branch — ff it first (see b7e-prbranch)` };
  if (c.mergeHead) return { ok: false, reason: `${abs} is mid-merge` };
  if (c.dirty) return { ok: false, reason: `${abs} has ${c.dirty} uncommitted file(s)` };
  return { ok: true };
}
