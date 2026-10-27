/**
 * When a local gate run may stand in for GitHub's answer about the base — bc-3m8en.
 *
 * `lib/redbase.js` holds the merge queue while the base is red, and it learns that the
 * base is red from one place: `pr.baseChecks`, which asks GitHub. That is the right
 * source when GitHub can answer. On 2026-09-18 it stopped being able to. Actions minutes
 * ran out on a four-shard `macos-latest` matrix in a private repo on a free plan, and
 * every job since has died in about eight seconds with `runner_name` empty and `steps`
 * `[]` — **no runner is ever assigned**. GitHub reports that as a failing check, which is
 * indistinguishable, to a rollup, from a suite that actually broke.
 *
 * The consequence is not a slow queue, it is a stopped one, and it cannot clear itself:
 * the hold waits for the base to go green, the base can only go green if a run starts,
 * and no run can start. Thirty-four entries sat behind it. Twenty-seven pull requests
 * were merged by hand, each on a local gate, to get out from under it.
 *
 * **What this module adds is not a new capability — it is the missing wire.** `b7e-gate`
 * already runs the whole suite locally and already writes, on its `start` line, the sha
 * it ran against, the tree, the untracked map and the full selected suite list; its `end`
 * line carries the status (`lib/gaterun.js`). So "was *this exact commit* gated green,
 * from a clean tree, across every suite" has been answerable from disk all along. Nothing
 * read it.
 *
 * ## Why a local run is allowed to outrank a red rollup, and the four conditions on it
 *
 * A full local pass is *stronger* evidence about the base than a check rollup, because it
 * executed every suite against that exact tree rather than reporting what some runner did
 * or failed to start. But it is only stronger when it is genuinely that, so the bar is
 * deliberately four conditions rather than "a green run exists somewhere":
 *
 * 1. **The same commit.** `run.sha` must equal the base sha. A run against an ancestor
 *    says nothing about what is on the base now — that is the whole lesson of `bc-rcrt`,
 *    where two branches each green alone broke `main` together.
 * 2. **A clean tree.** `snapshotTree` records `git stash create`, which is empty for an
 *    unmodified tree and falls back to `HEAD`; so `tree === sha` *is* the cleanliness
 *    test, and `untracked` must be empty too. A run from a dirty worktree gated something
 *    that is not this commit and never will be.
 * 3. **Every suite.** A `--only` run is the common case here — it is how the backlog was
 *    cleared — and a narrowed run is exactly what must NOT satisfy a *base* gate. The
 *    run's own selected list is compared against the suites discovered now, so a run that
 *    skipped one, or was taken before a suite existed, is refused.
 * 4. **Finished, and green.** Not `running`, nothing in `failed`, and nothing selected
 *    that never produced a result line — a run killed halfway (this Mac ran out of memory
 *    doing exactly that on 2026-09-19) has an empty `failed` list and must not read as a
 *    pass.
 *
 * ## And where the run comes from — bc-xl7n.163
 *
 * This module only ever *reads*. For a week that meant a person, or an unattended window
 * opened on a red-base P0, running `b7e-detach` by hand and waiting ten minutes — and
 * condition 1 is what made that a treadmill rather than a fix: the moment the queue merged
 * one pull request the base moved, the run stopped covering it, and the next tick filed a
 * fresh P0 and opened a fresh window to gate the new base. One gate per merge, one session
 * per merge. `lib/autogate.js` is the producer: it watches for exactly the refusals below
 * that a fresh run would answer and starts one itself.
 *
 * **It says which gate answered.** `source` and `runId` ride on the rollup this returns,
 * for `newlyFailing`'s own stated reason: a gate whose source is silent is
 * indistinguishable from no gate at all, and this one is invisible on GitHub by
 * construction. Anything reporting a verdict built from this must name it.
 */
import { listRunFiles, readRun, missingFrom, environmentOf } from './gaterun.js';

/**
 * Why this run may not stand in for the base, *and which kind of refusal it is* —
 * `{ why, kind }`, both empty when it may.
 *
 * A sentence rather than a boolean because every caller here wants to say *which* of the
 * four conditions was not met: "no local run" and "a local run that was narrowed" are
 * different facts about the same base, and the second is the one somebody acts on.
 *
 * **The `kind` is the half `lib/autogate.js` needs and prose cannot carry.** That module
 * decides whether to go and *produce* a run, and the refusals divide sharply into two
 * populations that read almost identically as English: the ones a fresh, clean, full run
 * against this exact commit would answer (`absent`, `narrowed`, `dirty`, `untracked`,
 * `killed`, `incomplete`, `no-suites`, `no-sha`) and the ones it would not — `failed`,
 * where the base is genuinely broken and ten more minutes of Mac would report the same
 * red, and `running`, where somebody is already measuring it. Matching on the sentence
 * would put a load-bearing decision on wording nobody would think to preserve.
 */
export function baseRunRefusal(run, { sha, allSuites = null } = {}) {
  const no = (kind, why) => ({ kind, why });
  if (!run) return no('absent', 'there is no run');
  if (!sha) return no('no-base', 'no base sha to match against');
  if (run.running) return no('running', `${run.runId} has not finished`);
  if (!run.sha) return no('no-sha', `${run.runId} recorded no sha — too old, or run against a fabricated --dir`);
  if (run.sha !== sha) {
    return no('other-commit', `${run.runId} ran against ${String(run.sha).slice(0, 9)}, not ${String(sha).slice(0, 9)}`);
  }
  if (run.tree && run.tree !== run.sha) return no('dirty', `${run.runId} ran from a modified tree`);
  const untracked = Object.keys(run.untracked || {});
  if (untracked.length) return no('untracked', `${run.runId} ran with ${untracked.length} untracked file(s) present`);
  if ((run.failed || []).length) {
    if (ranThroughSleep(run)) {
      return no('slept', `${run.runId} ran through a sleep — ${run.failed.length} failure(s) are about the run, not the base`);
    }
    if (starvedByLoad(run)) {
      return no('starved', `${run.runId} lost its red to per-suite timeout kills under load — the base itself is unproven red`);
    }
    return no('failed', `${run.runId} failed ${run.failed.length} suite(s)`);
  }
  // `end.status` and an empty `failed` list are not the same claim. A run the harness
  // killed — for memory, on this Mac, on 2026-09-19 — ends without a failing suite and
  // must not read as a pass just because nothing got as far as going red.
  if (run.status && run.status !== 'ok') return no('killed', `${run.runId} ended ${run.status}, not ok`);
  const missing = missingFrom(run);
  if (missing.length) {
    return no('incomplete', `${run.runId} never produced a result for ${missing.length} selected suite(s)`);
  }
  if (!run.suites) return no('no-suites', `${run.runId} recorded no suite list`);
  if (allSuites) {
    const ran = new Set(run.suites);
    const skipped = allSuites.filter((s) => !ran.has(s));
    if (skipped.length) {
      return no('narrowed', `${run.runId} was narrowed — it did not run ${skipped.length} of ${allSuites.length} suites`);
    }
  }
  return { kind: '', why: '' };
}

/** Timeouts finishing this close together were killed by one clock jump, not by their own hangs. */
const SLEEP_CLUSTER_MS = 2000;
const SLEEP_CLUSTER_MIN = 3;

/**
 * Did this run's failures come from the Mac sleeping under it (bc-xl7n.179)?
 *
 * A suite killed for running past its budget stamps its result when the harness's timer
 * fires. After a clamshell sleep every timer that expired during it fires on wake, so
 * several suites, each with its own start time, end inside the same second with an
 * elapsed far past their limit. Honest hangs and load timeouts end spread out. A run with
 * three or more timeouts inside two seconds of each other, every one over its own limit,
 * is a statement about the run: the suites that failed after the wake (the vendor tree
 * swept from under a run that lasted hours) were failing for the same reason.
 *
 * Deliberately narrow: it only reads the run, and a base that really is red still reads
 * `failed` because its failures do not cluster in time.
 */
export function ranThroughSleep(run) {
  const stamps = [];
  for (const r of run?.results || []) {
    if (r.status === 'ok') continue;
    const said = /timed out after (\d+(?:\.\d+)?)s — killed/.exec(r.tail || '');
    if (!said || !(Number(r.elapsed) > Number(said[1]))) continue;
    const at = Date.parse(r.at);
    if (Number.isFinite(at)) stamps.push(at);
  }
  stamps.sort((a, b) => a - b);
  for (let i = 0; i + SLEEP_CLUSTER_MIN - 1 < stamps.length; i += 1) {
    if (stamps[i + SLEEP_CLUSTER_MIN - 1] - stamps[i] <= SLEEP_CLUSTER_MS) return true;
  }
  return false;
}

/**
 * Was this run red mostly because suites were killed at their time limit on a starved Mac
 * (bc-xl7n.201)? Timeout kills outnumber (by two to one) every other failure. Unlike a
 * sleep these do not cluster in time, so `ranThroughSleep` cannot see them; the per-suite
 * limit is what made them red, and each passed alone in a fraction of it. A real red among
 * a few kills still reads starved, because the retry is bounded to one per sha.
 */
export function starvedByLoad(run) {
  let kills = 0;
  let others = 0;
  for (const r of run?.results || []) {
    if (r.status === 'ok') continue;
    if (/timed out after \d+(?:\.\d+)?s — killed/.test(r.tail || '')) kills += 1;
    else others += 1;
  }
  return kills > 0 && others * 2 <= kills;
}

/**
 * The refusal kinds a fresh, clean, complete run against this exact commit would answer.
 *
 * Everything that is a statement about *the run* rather than about *the base*. The two
 * left out are the two that are about the base: `failed` says the base is broken and a
 * second gate would spend ten minutes saying so again, and `running` says somebody is
 * already spending them.
 */
export const RETRYABLE_KINDS = Object.freeze(
  new Set(['absent', 'no-sha', 'dirty', 'untracked', 'killed', 'slept', 'starved', 'incomplete', 'no-suites', 'narrowed'])
);

/** `baseRunRefusal`'s sentence alone — the shape every caller before `lib/autogate.js` wanted. */
export function refuseBaseRun(run, opts = {}) {
  return baseRunRefusal(run, opts).why;
}

/**
 * The newest run in `dir` that may stand in for the base, with the reason the others
 * could not — `{ run, why, kind }`, `run` null when none qualifies.
 *
 * `listRunFiles` is already newest-first, so the first acceptable one wins and the rest
 * are not read. The `why` carried back is the *closest miss* rather than the last, which
 * is what a person wants to see: "a run for this commit, but narrowed" is actionable and
 * "some run from another branch" is noise.
 *
 * `kind` is that same closest miss as a token rather than a sentence — `''` when a run
 * qualified, `'absent'` when nothing on disk is even about this commit. `lib/autogate.js`
 * is what reads it, to tell a base nobody has measured from a base a measurement already
 * called red; see `RETRYABLE_KINDS`.
 *
 * `miss` is the closest miss's *run*, for the one caller that needs more than a sentence
 * about it: a run that measured this commit and found it red knows which suites, and a P0
 * that says "GitHub named no checks" instead of naming them sends the session that opens
 * on it to run the same gate again — which is the treadmill bc-xl7n.163 is about, one size
 * smaller. `baseFailureFrom` is what turns it into a reading.
 */
export function findBaseRun(dir, sha, { allSuites = null, read = readRun, list = listRunFiles } = {}) {
  let closest = '';
  let closestKind = '';
  let closestRun = null;
  for (const file of list(dir)) {
    let run;
    try {
      run = read(file);
    } catch {
      continue; // an unreadable run file is not an answer about the base
    }
    const { why, kind } = baseRunRefusal(run, { sha, allSuites });
    if (!why) return { run, why: '', kind: '', miss: null };
    // A miss that is about THIS commit beats one that is about some other branch.
    if (run?.sha === sha && !closest) {
      closest = why;
      closestKind = kind;
      closestRun = run;
    }
  }
  return {
    run: null,
    why: closest || 'no local gate run covers this commit',
    kind: closestKind || 'absent',
    miss: closestRun,
  };
}

/**
 * A `pr.baseChecks`-shaped rollup for a run that measured this commit and found it RED.
 *
 * The mirror of `baseRollupFrom`, and it exists for the same reason one level along: a
 * local gate is the only thing that can currently say anything about the base, so it
 * should be the thing the P0 quotes. Without it `lib/redbase.js` files "`main` is red —
 * failing as of now: checks GitHub did not name", because what GitHub is reporting is a
 * billing refusal with no check names in it, and the session opened on that bead spends
 * its first ten minutes running the gate that already ran.
 *
 * `failed` is suite paths where GitHub's would be check names, and that is right for the
 * one reader it has: `holdIssue` puts them in the bead so somebody can go and open them.
 * Nothing else consumes this — the merge queue takes its own baseline from `pr.baseChecks`
 * directly (lib/mergequeue.js), so a suite path can never be mistaken for a check there.
 */
export function baseFailureFrom(run) {
  if (!run || run.running || !(run.failed || []).length) return null;
  const total = (run.suites || []).length;
  return {
    total,
    passing: Math.max(0, total - run.failed.length),
    failing: run.failed.length,
    pending: 0,
    failed: [...run.failed],
    failedUrls: [],
    state: 'failing',
    at: run.endedAt || run.startedAt || null,
    source: 'local-gate',
    runId: run.runId,
    environment: environmentOf(run),
  };
}

/**
 * A `pr.baseChecks`-shaped rollup built from a local run, or `null`.
 *
 * Deliberately the same shape rather than a new one, so `baseVerdict` in lib/redbase.js
 * needs no change at all: it reads `state` and `failed`, and both mean here exactly what
 * they mean there. The two extra fields are additive and ignored by every existing
 * reader — `source` so a verdict can say a local gate answered, `runId` so it can be
 * looked up in `.claude/gate-runs` afterwards.
 */
export function baseRollupFrom(run) {
  if (!run) return null;
  return {
    total: (run.suites || []).length,
    passing: (run.suites || []).length,
    failing: 0,
    pending: 0,
    failed: [],
    failedUrls: [],
    state: 'passing',
    at: run.endedAt || run.startedAt || null,
    source: 'local-gate',
    runId: run.runId,
  };
}

/**
 * What the last tick learned about one base, as the merge queue's screen draws it —
 * bc-gjlix.
 *
 * `out` is `sweepBase`'s answer (lib/redbase.js) and `seen` is what `checkBase` in
 * lib/server.js kept on the way through: the rollup it handed over, the sha it matched a
 * local run against, and — when no run could stand in — the closest miss `findBaseRun`
 * gave. The hold decides the colour, because the hold is what the queue acts on: a base
 * with a P0 open on it is `red` whatever the rollup said, and a green rollup with no hold
 * is `green`.
 *
 * `summary` is the one sentence a screen shows, written here rather than in the page so a
 * suite can read it and the page does not grow a second copy of what "green by local
 * gate" means. It names the source for this file's own reason: a local answer is
 * invisible on GitHub, and a verdict that does not say where it came from is
 * indistinguishable from no verdict.
 */
export function baseReading({ workspace = '', key = '', base = 'main', out = null, seen = {}, at = new Date().toISOString() } = {}) {
  const rollup = seen?.rollup || null;
  const hold = out?.hold || null;
  const state = hold ? 'red' : rollup?.state === 'passing' ? 'green' : rollup?.state === 'pending' ? 'pending' : 'unknown';
  const source = rollup ? (rollup.source === 'local-gate' ? 'local-gate' : 'github') : null;
  const sha = String(seen?.sha || '');
  const failed = (hold?.failed?.length ? hold.failed : rollup?.failed) || [];
  const suites = source === 'local-gate' ? Number(rollup.total) || 0 : 0;
  const short = sha.slice(0, 9);
  let summary;
  if (state === 'green' && source === 'local-gate') {
    summary = `${base}${short ? ` at ${short}` : ''} is green by local gate ${rollup.runId} (${suites} suites).`;
  } else if (state === 'green') {
    summary = `${base} is green on GitHub.`;
  } else if (state === 'red') {
    const names = failed.length ? ` (${failed.slice(0, 3).join(', ')}${failed.length > 3 ? `, +${failed.length - 3}` : ''})` : '';
    summary = `Held — ${base} is red${names}${hold.bead ? `, on ${hold.bead}` : ''}.`;
    if (seen?.why) summary += ` No local gate stands in: ${seen.why}.`;
  } else if (state === 'pending') {
    summary = `${base}'s checks are still running.`;
  } else {
    summary = `${base} could not be read on the last tick.`;
  }
  return {
    workspace,
    key,
    base,
    state,
    source,
    runId: source === 'local-gate' ? rollup.runId || null : null,
    suites,
    sha: sha || null,
    failed,
    holdBead: hold?.bead || null,
    why: seen?.why || null,
    summary,
    at,
  };
}
