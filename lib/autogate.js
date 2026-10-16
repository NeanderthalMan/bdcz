/**
 * The daemon gating its own base — the producer for the run `lib/basegate.js` reads.
 *
 * bc-xl7n.163. bc-3m8en wired the *reading*: a finished, clean, complete, green
 * `b7e-gate` run against the base's exact sha may stand in for GitHub's answer, so the
 * merge queue is not hostage to a CI that cannot start a job. That half works and is
 * unchanged. **Nothing produced the run.** It was a person, or an unattended window
 * opened on a red-base P0, running `b7e-detach` by hand and waiting eight to ten minutes.
 *
 * And the answer does not last, because it is invalidated by the very thing it unblocks.
 * Condition 1 of `refuseBaseRun` is `run.sha === sha`, deliberately and for `bc-rcrt`'s
 * reason. So the moment the queue merges one pull request the base moves, the run stops
 * covering it, `sweepBase` reads a red base again on the next tick, files a fresh P0 and
 * an advocate opens another window to run another ten-minute gate. Measured on
 * 2026-09-20: a green 561-suite run at 15:51 against `ec39220d4`, PR #60 merged at 15:59,
 * and `bc-lsewp` filed at 15:59:24 — the same hold, over a base a green run had covered
 * eight minutes earlier. One gate per merge and one *session* per merge, for as long as
 * the billing block lasts.
 *
 * ## What this does, and the four things it is careful about
 *
 * When the base reads red and no run on disk covers that commit, start one: `b7e-detach`
 * against a throwaway worktree checked out at the base sha (`lib/at.js`). Every part
 * already existed — `b7e-detach` survives the call that started it, `b7e-gate` takes the
 * machine-wide slot so it queues behind session gates rather than fighting them, and
 * `runsDir` resolves through `--git-common-dir` to the main checkout, so a run taken in a
 * throwaway worktree is read by the daemon with no plumbing at all.
 *
 * 1. **It never bypasses the slot.** A 560-suite sweep is eight to ten minutes of a
 *    loaded Mac. `b7e-gate`'s own `acquireSlot` is what serialises it against the gates
 *    session windows are running, and nothing here is allowed to jump that queue — the
 *    thing this exists to unblock is those very windows.
 * 2. **Once per sha, one in flight.** `tried` is the whole debounce: a sha that has had a
 *    gate started for it never gets a second, whatever the run then said. A base that
 *    moves cancels the in-flight run for the old sha rather than leaving a queue of
 *    superseded gates behind it, and the same tick may start the one for where it moved to.
 * 3. **It does not re-measure a base that was measured.** `RETRYABLE_KINDS` in
 *    lib/basegate.js is the line: a run that *failed* says the base is genuinely broken,
 *    and ten more minutes would report the same red. That is a P0 for a person, not a
 *    second gate. Only refusals that are statements about the *run* — absent, narrowed,
 *    dirty, killed — are worth answering with a fresh one.
 * 4. **It is config-gated, and it is this repo's own suite runner.** `b7e-gate` discovers
 *    `test/*.mjs` through *this* repo's `scripts/test.mjs`, so pointing it at a checkout
 *    with no such suites gates nothing and says so as a failed run. That is why
 *    `pr.gateBaseLocallyPerWorkspace` ships naming one workspace rather than
 *    `gateBaseLocally` shipping `true`. Spending ten minutes of the machine on a base
 *    commit is Adam's call rather than a silent new daemon behaviour, and it is only
 *    worth it while GitHub cannot answer at all — which is also why it is self-limiting:
 *    it fires only when the base reads red, and a repo whose CI works has a green base
 *    and never reaches here.
 *
 * ## Why it also *suppresses* the P0, and why that is not the queue going unguarded
 *
 * A gate in flight against this exact base commit is not a base nobody is looking at — it
 * is a base being measured, right now, by the only thing on this Mac that can currently
 * answer. Filing a P0 saying "main is red, go and find out" and opening a window to run a
 * gate, while a gate is running, is the duplicated work this bead is about. So `sweepBase`
 * takes a `measuring` flag (lib/redbase.js): while it is set the queue **still holds** —
 * with a hold record carrying no bead, because there is no bead — but nothing is filed and
 * no window is offered. The queue holding is the load-bearing half: reporting the base
 * *unknown* instead would leave it free to land pull requests onto a base nobody has
 * vouched for, and each merge would move the sha out from under the gate measuring it, so
 * the gate would be cancelled and restarted forever and never once be used.
 *
 * Everything effectful arrives as an argument, for `sweepBase`'s reason in lib/redbase.js:
 * what is under test is a procedure that spawns a ten-minute subprocess and a `git
 * worktree`, and a test must be able to drive every branch of it without either.
 */
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RETRYABLE_KINDS } from './basegate.js';
import { makeAtWorktree, removeAtWorktree } from './at.js';
import { gateLockStatus } from './gate.js';
import { endRun, runFile, runsDir } from './gaterun.js';
import { DETACH_BIN } from './shipgate.js';

const execFileAsync = promisify(execFile);

/**
 * How long an in-flight run may go without its record appearing before it is abandoned.
 *
 * `b7e-detach --start-timeout 0` answers before the child has taken the machine-wide
 * slot, so "no record yet" is the ordinary state of a gate queued behind another session's
 * — not a failure, and it must not be read as one. Forty-five minutes is two full sweeps
 * plus room: long enough that a queued gate is never abandoned while it is still going to
 * run, short enough that a child which died on launch does not pin a throwaway worktree on
 * disk for the life of the daemon.
 */
export const BASE_GATE_STALE_MS = 45 * 60 * 1000;

/**
 * How many attempted shas are remembered, per base.
 *
 * Only a guard against unbounded growth in a long-lived daemon: the list is consulted for
 * the *current* base sha alone, and a base that has moved sixteen times is a base whose
 * older shas nobody will ever ask about again.
 */
export const TRIED_MAX = 16;

/**
 * Does this workspace gate its own base locally? `pr.gateBaseLocallyPerWorkspace` first,
 * then the install-wide `pr.gateBaseLocally`.
 *
 * `typeof` rather than a truthiness test on the lookup, the same rule `configuredBase`
 * keeps for `basePerWorkspace` and lib/spaces.js keeps for its own per-workspace booleans:
 * a map keyed by workspace name is hand-edited, and `{"beadcause": "yes"}` must read as
 * "nothing legible was asked for" rather than as `true`.
 */
export function gatesBaseLocally(cfg = {}, workspaceName = '') {
  const own = cfg?.pr?.gateBaseLocallyPerWorkspace?.[workspaceName];
  if (typeof own === 'boolean') return own;
  return Boolean(cfg?.pr?.gateBaseLocally);
}

/**
 * Would a fresh run answer what the runs on disk could not? `kind` is `findBaseRun`'s.
 *
 * `''` — a run qualified, so there is nothing to ask. Everything else divides on
 * `RETRYABLE_KINDS`, which is argued where it is defined.
 */
export function wantsBaseRun(kind) {
  return Boolean(kind) && RETRYABLE_KINDS.has(kind);
}

/**
 * The whole decision, as a pure function of what is on disk and what this daemon started.
 *
 * - **`off`** — the workspace did not ask for this. The default everywhere.
 * - **`none`** — nothing to do: no base sha, or a base a run already answers, or one a
 *   run already called red, or one somebody else's gate is measuring.
 * - **`wait`** — our run is on disk and running. The steady state, and silent.
 * - **`queued`** — started, no record yet: the gate is behind another on this Mac.
 * - **`done`** — the run this daemon started has ended, whatever it said. Tear the
 *   worktree down; the *answer* is `findBaseRun`'s to give, not this module's.
 * - **`abandoned`** — `BASE_GATE_STALE_MS` passed with no record at all.
 * - **`tried`** — this sha has had its one gate. Never a second.
 * - **`start`** — the only act that spends ten minutes.
 *
 * **Cancelling is not one of them**, and deliberately: a run to tear down rides on
 * whichever act follows it, because the tick that finds the base has moved out from under
 * an in-flight gate is also the tick that may start the gate for where it moved to. So
 * `cancel` is a record on the side, and `act` stays the answer to "what did this tick do
 * about the base".
 */
export function baseGateAct({
  enabled = false,
  sha = '',
  kind = '',
  inFlight = null,
  tried = [],
  now = Date.now(),
} = {}) {
  // Switched off with a run in flight — which happens, because the setting is a live
  // config read and Adam may turn it off mid-sweep. The run goes with it: a nine-minute
  // gate nothing will consult is the cost the switch exists to refuse.
  if (!enabled) return { act: 'off', cancel: inFlight, reason: 'this workspace does not gate its own base locally' };
  // A `gh` call that would not answer is transient and leaves the run alone — abandoning
  // one over a rate limit would spend the sha's one attempt on a hiccup.
  if (!sha) return { act: 'none', cancel: null, reason: 'no base sha to gate against' };

  // The base moved out from under a run we started. Cancelling rather than letting it
  // finish is the debounce: a gate whose sha nothing will ever ask about again is ten
  // minutes of a slot that the gate for the *current* base needs.
  const cancel = inFlight && inFlight.sha !== sha ? inFlight : null;
  const mine = cancel ? null : inFlight;

  if (mine) {
    if (kind === 'running') return { act: 'wait', cancel: null, reason: `${mine.runId} is running` };
    // Anything that is not `running` means the record has been written and ended — or, on
    // `absent`, has not appeared at all yet, which is a gate still in line for the slot.
    if (kind !== 'absent') return { act: 'done', cancel: mine, reason: `${mine.runId} has ended`, tried: sha };
    if (now - (mine.at || 0) < BASE_GATE_STALE_MS) {
      return { act: 'queued', cancel: null, reason: `${mine.runId} has not reached a slot yet` };
    }
    return {
      act: 'abandoned',
      cancel: mine,
      reason: `${mine.runId} never recorded a run`,
      tried: sha,
    };
  }

  if (!wantsBaseRun(kind)) {
    return {
      act: 'none',
      cancel,
      reason: kind === 'running' ? 'a gate is already running against this commit' : 'a fresh run would not change the answer',
    };
  }
  if (tried.includes(sha)) {
    return { act: 'tried', cancel, reason: 'this base has already had its one gate' };
  }
  return { act: 'start', cancel, reason: 'nothing on disk answers for this commit' };
}

const short = (sha) => String(sha || '').slice(0, 9);

/**
 * One base, one tick — the decision above, plus the two effects it asks for.
 *
 * - `start({ sha })` — spawns the gate and answers `{ runId, pid, dir, scratchRoot }`, or
 *   throws. Whatever it throws costs the sha its one attempt: a launch that cannot happen
 *   this minute will not start happening on the next tick, and retrying it every thirty
 *   seconds for the life of a red base is the thing `tried` exists to stop.
 * - `stop(record, why)` — kills the child and takes its worktree away. Best-effort by
 *   contract: a teardown that fails must not leave the state claiming a run is in flight,
 *   because that would hold the base for `BASE_GATE_STALE_MS` and then hold it again.
 *
 * Returns the next state — `{ inFlight, tried, act, measuring }` — rather than mutating
 * anything, so the caller owns where it is kept and a test can drive a whole sequence of
 * ticks by passing one result into the next.
 *
 * `measuring` is what lib/redbase.js reads, and within an enabled workspace it is
 * deliberately wider than "we started something": a run *anybody* started against this
 * exact commit is a base being measured, and a session gating the base by hand should
 * suppress the daemon's second window just as the daemon's own gate does. It is `false`
 * wherever the switch is off, because it changes what gets filed.
 */
export async function gateBase(
  { key = '', base = 'main', sha = '', kind = '', enabled = false, inFlight = null, tried = [] } = {},
  { start, stop, now = () => Date.now(), log = () => {} } = {}
) {
  const decided = baseGateAct({ enabled, sha, kind, inFlight, tried, now: now() });
  let held = decided.cancel ? null : inFlight;
  let seen = [...tried];
  let retryGranted = false;

  if (decided.cancel) {
    const why = decided.cancel.sha === sha ? decided.reason : `the base moved to ${short(sha)}`;
    try {
      await stop(decided.cancel, why);
    } catch {
      // Best-effort by contract — see the docblock. `lib/at.js`'s own `--reap` is the
      // backstop for a worktree this could not remove, and forgetting the record here is
      // what stops one failed teardown holding the base for another forty-five minutes.
    }
    log(`stopped the base gate ${decided.cancel.runId} for ${short(decided.cancel.sha)} — ${why}`);
    if (decided.tried) seen = [...seen, decided.tried];
    // A run the Mac slept through measured nothing about the base, so its sha gets ONE more
    // gate. The marker records that the retry was granted; a second sleep keeps the sha
    // spent, so a laptop that sleeps every night cannot loop the gate for ever.
    if (decided.act === 'done' && (kind === 'slept' || kind === 'starved')) {
      const token = `${kind}:${sha}`;
      if (!seen.includes(token)) {
        seen = [...seen.filter((s) => s !== sha), token];
        retryGranted = true;
      }
    }
    held = null;
  }

  if (decided.act === 'start') {
    let started;
    try {
      started = await start({ sha, base, key });
    } catch (err) {
      // The sha is spent either way. A launch this Mac refused — no checkout, a `git
      // worktree add` that failed, a gate already on that tree — refuses the same way on
      // the next tick, thirty seconds later, for as long as the base is red.
      log(`could not start a base gate for ${short(sha)} — ${String(err?.message || err).split('\n')[0]}`);
      return { inFlight: null, tried: [...seen, sha].slice(-TRIED_MAX), act: 'failed', measuring: false };
    }
    const rec = { ...started, sha, base, key, at: now() };
    log(
      `${base} at ${short(sha)} has no local gate run — started ${rec.runId} against it` +
        `${rec.pid ? ` (pid ${rec.pid})` : ''}`
    );
    return { inFlight: rec, tried: [...seen, sha].slice(-TRIED_MAX), act: 'start', measuring: true };
  }

  return {
    inFlight: held,
    tried: seen.slice(-TRIED_MAX),
    act: decided.act,
    // Behind the switch like everything else here, and deliberately: `measuring` changes
    // what lib/redbase.js files and whether it opens a window, so a workspace that never
    // asked for any of this keeps exactly the red-base runbook it had.
    measuring: enabled && (Boolean(held) || kind === 'running' || retryGranted),
  };
}

/* --------------------------------------------------------------- the two effects */

/**
 * What `b7e-detach` prints on success: the run id, the child's pid and its log.
 *
 * Parsed rather than re-derived because `b7e-detach` is the one that *minted* the id
 * (`mintRunId`, before the child has done anything), and a second spelling of a run id
 * here would be the "three separately-built control sets" mistake lib/gaterun.js's own
 * header names. The em dash is that command's, verbatim.
 */
const DETACH_LINE = /^run (\S+) — pid (\d+)/m;

/**
 * Start the gate against one base commit — a throwaway worktree at that sha, and
 * `b7e-detach` inside it.
 *
 * `--start-timeout 0` on purpose: this is a poll-cycle tick, and the default twenty
 * seconds would be twenty seconds of the daemon waiting for a record that only appears
 * once the machine-wide slot frees — which, on a Mac running session gates, is minutes
 * away. The id is good either way, and `findBaseRun` is what reads the answer.
 *
 * The run record is written to `runsDir(tree)`, which resolves through `--git-common-dir`
 * to the main checkout: the daemon reads a run taken in a directory under `os.tmpdir()`
 * with no plumbing at all, and the worktree going away later does not take the answer
 * with it.
 */
export async function startBaseGate({ sha }, { root, log = () => {} } = {}) {
  const { dir, scratchRoot } = makeAtWorktree(root, sha);
  try {
    const { stdout } = await execFileAsync(process.execPath, [DETACH_BIN, '--dir', dir, '--start-timeout', '0'], {
      cwd: root,
      encoding: 'utf8',
    });
    const said = DETACH_LINE.exec(String(stdout || ''));
    if (!said) throw new Error(`b7e-detach printed nothing this could read: ${String(stdout || '').trim().slice(0, 200)}`);
    log(`gating ${String(sha).slice(0, 9)} in ${dir}`);
    return { runId: said[1], pid: Number(said[2]), dir, scratchRoot, root };
  } catch (err) {
    // A launch that never happened must not leave a whole checkout under os.tmpdir() —
    // `lib/at.js`'s `--reap` would find it eventually, but eventually is a person.
    removeAtWorktree(root, dir, scratchRoot);
    throw err;
  }
}

/**
 * Stop one — the child, then its worktree. Best-effort throughout, by `gateBase`'s
 * contract.
 *
 * **The kill is gated on the per-tree gate lock naming this exact pid**, and that is not
 * belt and braces: a record can outlive its child (a run that ended, a daemon that has
 * been up for weeks), and a pid on macOS is a small recycled integer, so an unguarded
 * `process.kill` is a signal sent to whatever happens to hold that number now. The lock
 * is written by `b7e-gate` before it asks for a slot and removed on exit, its own reader
 * re-checks the pid is alive, and the tree it is keyed by is one this call created — so a
 * match is proof, not a heuristic.
 */
export async function stopBaseGate(rec, why = '', { log = () => {} } = {}) {
  if (!rec) return;
  let signalled = false;
  if (rec.pid && rec.dir) {
    let held = null;
    try {
      held = gateLockStatus(rec.dir);
    } catch {
      // `lockPathFor` realpaths the tree to key the lock, so a tree already gone — a
      // teardown run twice, a daemon restarted over a `--reap` — throws rather than
      // answering null. There is nothing to signal in that case either way.
      held = null;
    }
    if (held && held.pid === rec.pid) {
      try {
        process.kill(rec.pid, 'SIGTERM');
        signalled = true;
        log(`sent SIGTERM to the base gate ${rec.runId} (pid ${rec.pid})${why ? ` — ${why}` : ''}`);
      } catch {
        /* gone between the lock read and the signal; nothing left to stop */
      }
    }
  }
  if (signalled) await closeKilledRun(rec);
  if (rec.root && rec.dir) removeAtWorktree(rec.root, rec.dir, rec.scratchRoot);
}

/**
 * Write the `end` line a killed gate never got to write — and this is not tidiness.
 *
 * `bin/b7e-gate` calls `endRun` only on the paths where it finished; a SIGTERM releases
 * its lock and its slot and exits without one. `readRun` is `running: !end`, so a record
 * abandoned that way reads as **still running for ever** — and `running` is the one
 * refusal kind that means *somebody is already measuring this*, which suppresses both the
 * P0 and the window. Cancel a gate on a sha, come back to that same sha, and the queue
 * would hold on a measurement that stopped an hour ago with nothing to file about it.
 *
 * `killed` is the honest status and `refuseBaseRun` already knows it — it is the case
 * this Mac produced for real on 2026-09-19 running out of memory mid-sweep: inconclusive,
 * never a pass, and worth answering with a fresh run rather than waiting on.
 */
async function closeKilledRun(rec) {
  // Long enough for the signalled child to stop appending result lines, short enough that
  // a poll tick is not held up by it. A duplicate `end` would be harmless anyway —
  // `readRun` takes the last one — but a torn interleave is worth not inviting.
  for (let i = 0; i < 20; i++) {
    try {
      process.kill(rec.pid, 0);
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    const file = runFile(await runsDir(rec.dir), rec.runId);
    // `endRun` appends, and an append CREATES the file — so the existence check is what
    // stops a gate killed before `startRun` ever ran from leaving a record that is an
    // `end` line and nothing else. A gate that recorded nothing has nothing to close, and
    // a file that is not there reads as no run rather than as a run still going.
    if (fs.existsSync(file)) endRun(file, { status: 'killed', elapsed: rec.at ? (Date.now() - rec.at) / 1000 : 0 });
  } catch {
    /* an unreadable runs directory is not worth failing a teardown over */
  }
}
