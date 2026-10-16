# Would Temporal run the merge queue better? A shadow spike

**bc-x0mhc, 2026-09-30.** One pull request's journey through the merge queue, written as a
Temporal workflow, run in shadow beside the live queue against real merge-beads. It never
merged, pushed, commented or closed anything. The code is in
[`spikes/temporal-mq/`](../spikes/temporal-mq/), with its own `package.json` so the daemon's
dependencies are untouched.

**Short answer: the model fits, and the parts it replaces get genuinely smaller. What it
costs is a second always-on service and a determinism discipline that every agent editing
the queue would have to keep.** The spike does not justify a migration by itself, for two
reasons. It has not yet watched enough real transitions to show the two queues agree over
time. And the one piece of cross-PR coordination the live queue depends on (one downmerge
per base at a time) needs a second kind of workflow that was not built. The decision is on
a `human` bead; see [The decision](#the-decision).

## What was built

| file | what it is | code lines |
|---|---|---|
| `workflows.mjs` | `prJourney`: the ladder, the waits, four signals, a status query | 203 |
| `observe.mjs` | the only reader: one merge-bead's facts, from `bd show` and `lib/pr.js` | ~100 |
| `activities.mjs` | `observe`, plus nine **recorders** that write a ledger line and nothing else | 37 |
| `shadow.mjs` | the driver: polls the live queue, starts workflows, turns changes into signals | 93 |
| `worker.mjs`, `replay.mjs` | the worker; the replay check for a workflow-code deploy | 33 |
| `test.mjs` | eight scenarios on Temporal's time-skipping test server | 191 |

**It reuses the daemon's deciding and replaces only its sequencing.** `observe` calls the
same `gateVerdict`, `reviewGated` and `judgeReview` that `sweepMergeQueue` calls, and reads
the same `queueState` and `reviewState` blocks. So where the shadow and the live queue
disagree, the difference is in the ladder, which is the thing under test. The guarantee
that it never acts is an import list, not a flag. `observe.mjs` imports `view`,
`baseChecks` and `commitsBetween` from `lib/pr.js` and nothing that writes; no recorder has
a path to GitHub or the tracker.

**The ladder is `sweepMergeQueue`'s, in its order:** gone → hold → review → conflict →
behind → awaiting approval → pending/stale → refused → merge. The difference is where the
position lives. The daemon walks the ladder for every bead on every tick and rebuilds each
bead's position from the notes block it wrote last time (`attempts`, `turnAt`,
`resolving`, `reviewing`, `heldUntil`…). The workflow keeps the position in local
variables, and a wait is a line that blocks:

```js
if (s.reviewAsked !== round) await say('openReviewer', f.review.why);
s.reviewAsked = round;
await enter('awaiting-review', f.review.why);
await waitFor('30 minutes'); // returns early on the reviewVerdict signal
```

**Signals are where the phone and the reviewer come in.** `reviewVerdict` (the reviewer
wrote a verdict), `humanAnswer` (Adam tapped Merge, Request changes or Decline), `poke`
(something changed; look again) and `liveOutcome` (shadow only: the live queue finished
this bead). In the shadow, one poller stands in for every sender. In a real version each
would come from the place that already knows: the reviewer's session, the phone tap, a
GitHub webhook.

## Running it

```sh
brew install temporal
temporal server start-dev --db-filename ~/.temporal-spike/beadcause-mq.db --ip 127.0.0.1
cd spikes/temporal-mq && npm install
node worker.mjs                 # the worker
node shadow.mjs --max 22        # the driver: follows at most 22 merge-beads
node test.mjs                   # the suite: eight scenarios, ~1s of wall clock
node replay.mjs                 # replay every running history against the code on disk
```

The ledger is `~/.temporal-spike/shadow.jsonl`, one line per thing the workflow would have
done. The Web UI is `http://localhost:8233`, with each PR's full history under
`mq-<merge-bead id>`.

## What the tests show

Eight scenarios on the time-skipping server. Three simulated days run in about a second.

- **A review wait costs nothing.** Two hours in `awaiting-review` re-read the bead at most
  five times (the 30-minute backstop), and asked for the reviewer's window **once**, not
  once per look.
- **A card sleeps with no timer at all.** Three days carded: zero reads. It wakes on
  `humanAnswer` and merges, recording that Adam answered Merge.
- **A retried effect happens once.** The merge recorder was made to fail *after* its side
  effect on the first attempt, which is the window-opened-but-result-lost case. The retry
  found the key in the ledger and did not merge twice. A real version needs this check
  before opening any iTerm window, because Temporal retries an activity whose result it
  never heard.
- **The workflow outlives its worker.** Killed mid-wait, twenty minutes with no worker at
  all, then a fresh worker with the cache disabled so it had to replay from history: it
  carried on, and the replay did not re-open the reviewer.
- **Continue-as-new keeps the count.** With the history cap forced to 30 events, three
  refusals spanning several runs still reached the card at attempt 3.
- **A bead the live queue has already carded is adopted, not restarted.**

## What the shadow run found

Started 23:11Z on 2026-09-30, following 12 and then 22 of the 89 merge-beads the live
queue holds.

**The first sample was nearly useless, and the reason is itself a finding.** The first 12
by id were mostly cards from August that nothing will ever move. The live queue had
carded 9 of the 12 before the shadow saw them, and the shadow began each at attempt 0 in
whatever rung the facts suggested. Any move of an in-flight queue onto workflows has this
problem: the state in the notes block has to be *imported*, or every card reopens as new
work. The driver now takes queued beads first, and the workflow adopts the live
`attempts`, refusal and card on first sight.

**The docs said the review gate was on; the config says it is off.** docs/landing.md
records `reviewRequiredPerWorkspace` gaining `{"beadcause": true}` on 2026-08-23. On this
Mac today it is `{"beadcause": false}`, and `pr.reviewRequired` is `false`. The shadow first
hardcoded the documented value and parked every queued PR on a reviewer the real queue was
not waiting for. It now reads the two keys from `~/.config/beadcause/config.json` on every
observe. That was the only disagreement over the queued PRs.

**A merge-bead can name a repo that has since moved.** bc-2g8s delivers
`olduser/beadcause#410`, the repo's old home. Asked of today's checkout, `#410` does not
exist, and the first `observe` retried that error indefinitely. The retry policy is
deliberately unlimited, so that a GitHub outage is a wait. That is right for an outage and
wrong for a permanent error, which it hides. (The live queue does the same thing, but the
bead was already carded.) Two fixes: `observe` asks by URL, and "no such pull request"
becomes a fact that cards the bead, not an exception that retries.

**After those three fixes, the shadow and the live queue agreed on all 22 beads**: 12
carded in both, 10 queued with checks running in both. That is agreement on a snapshot,
not on a sequence. Transitions (a merge, a refusal, a downmerge) are what would show the
ladders agree over time, and this run was too short to see enough of them to count.

## Restarts and deploys, measured

- **SIGKILL of the worker** at 20:15:02 local, new code started immediately. The next three
  workflows due to wake did so at 20:15:32, replayed their histories, and carried on under
  the new code. Nothing was lost and nothing was redone. Three further graceful restarts
  (SIGTERM) behaved the same.
- **The server is the thing that must not go.** Workflows are rows in its SQLite file, so
  the worker, the driver and the daemon can all die freely. A reboot needs
  `temporal server start-dev` back up with the same `--db-filename`, which this spike did
  not wire into launchd.

## Determinism: the real cost

Workflow code is replayed, not resumed. So a change to what the code *does given the same
history* wedges every workflow already running. That is not hypothetical: it happened in
this spike, and the replay check caught it.

- **The adoption change was added while 12 workflows were running.** Unguarded, replaying
  their real histories against it gave **9 of 12 `TMPRL1100 Nondeterminism error`**
  (`Activity type of scheduled event 'openReviewer' does not match activity type of
  activity command 'raiseCard'`). Behind `patched('adopt-live-state')`, all 12 replayed
  clean, and after the SIGKILL restart the workflows adopted live cards at their next wake.
- **Some changes need no marker.** A branch on a field no recorded activity result has
  ever carried (`f.missing`) replays straight past, because replay feeds the old results
  back in. A timer's duration (1 → 2 minutes on the checks wait) is not checked either:
  22 of 22 clean.
- **So `replay.mjs` has to become a gate.** In this repo that is a real burden. Dozens of
  agent sessions edit it concurrently, and none of them has a reason to know that
  reordering two `await`s in a workflow is a breaking change to data on disk. The daemon
  as written has no equivalent hazard: its state is the notes block, and a code change
  simply reads it differently next tick.

## What got simpler

- **Waits are code, not state.** The per-PR ladder no longer needs `turnAt`, `resolving`,
  `reviewing`, `heldUntil` or `staleProbedAt` to find its place again. The workflow is
  standing where it stopped. The ladder itself is ~200 lines against a per-bead loop body
  of roughly 800 raw lines in lib/mergequeue.js. That comparison flatters the spike,
  because the loop body also carries everything under [Not built](#not-built).
- **"Once per round" is a variable.** `reviewAsked`, `answerAsked` and `resolverFor` replace
  the daemon's "is this window already owed?" reasoning, which bc-36xx.35 describes as the
  hard part of the escalate branch (*"whatever records that the window went up has to
  survive, or the veto gets a fresh session every sweep for ever"*).
- **Cards and review waits stop polling.** They sleep on a signal with a long backstop,
  where the daemon re-reads every queued bead every tick.
- **Retries, backoff and timeouts are declarations**, and every attempt and failure is
  visible in the UI's history, not reconstructed from log lines. bc-2g8s's stuck read was
  one click to diagnose: activity `observe`, attempt 4, the GraphQL error.

## What got worse

- **A second always-on service**, and a single point of failure for the queue:
  `temporal server start-dev` on the laptop, with its own SQLite file, its own reboot story
  and its own upgrades. Temporal Cloud (bc-syhxm) moves that off the Mac and adds a network
  dependency and a bill instead.
- **Weight.** 253 MB of `node_modules` for the spike alone, a native Rust core, and a 1.6 MB
  webpack bundle of the workflow built at every worker start. The daemon today has nine
  runtime dependencies.
- **Two sources of truth, unless it is careful.** The PWA, the phone and every agent read
  queue state off the bead. Workflow state is invisible to them unless it is mirrored back
  onto the bead, and a mirror is the second source of truth the handoff ruled out. The
  honest version keeps writing the notes block from activities, so Temporal owns *where
  the process is* and the bead owns *what is true*.
- **Cross-PR rules need a second workflow.** "One downmerge per base at a time"
  (bc-lkddg), "two merges per tick", and "the base moved this tick, so downmerge rather
  than merge" are all about the queue, not one PR. In Temporal each becomes a long-lived
  per-base *lane* workflow that PR workflows signal and wait on: a mutex built out of
  messages. The daemon gets this for free by sweeping everything in one loop. This is the
  biggest structural cost, and the spike did not build it.
- **The determinism discipline**, above.

## Not built

The per-base turn and lane, `MERGES_PER_TICK`, moved-base downmerges, card reclaim
(`cardedFor`, cooldown, `MAX_RECLAIMS`), stranded-PR reporting, the stale arm's reprobe
schedule, the check-failure log capture, everything in `finish` after the merge (the review
follow-up bead, the advocate nudge, the `DONE-` rename, the landing note), and deriving the
red-base hold: the shadow borrows the live queue's `held` flag, because the hold is decided
in the daemon's memory (lib/redbase.js). The downmerge cap is simplified to a count, without
the success/refusal split bc-johbj added.

## The decision

Filed as a `human` bead, with three options:

1. **Stop here.** Keep this as the reference, migrate nothing. The live queue's
   state-in-the-bead design already survives restarts, because the bead *is* the state; what
   Temporal adds is mostly shape, and the price is a service and a discipline.
2. **One more shadow slice, then decide.** Build the per-base lane workflow, move the three
   processes under launchd so the shadow survives reboots, and let it run for a week so the
   ledger shows agreement over real transitions, not a snapshot. Still read-only.
3. **Go.** Propose (not create) beads to move the merge queue onto workflows, then
   promotion beads, then session lifecycle, in the order the handoff set.

The spike's own recommendation is **2**. The evidence so far says the model fits and the
per-PR code gets simpler. It does not yet say whether the cross-PR half fits, or whether
the two ladders agree once things start moving. Both are cheap to find out and expensive
to discover after a migration.
