### Where a gate stands in the machine-wide slot queue, and whether anything ahead of it is actually alive — `b7e-queue`

`bc-dgx7.116` is the session audit's own read of `waitingLine` — the one-line "N gates
ahead of you, oldest started Xm ago" `lib/gate.js`'s FIFO semaphore prints while a caller
waits for one of the Mac's two slots — and six sessions each hit it and invented a
different way to sit through it. `bc-dgx7.12` saw "oldest started 447m ago", started the
gate three separate times, wrote a scratchpad daemon to escape the harness's own
background-task cap, and killed it after `b7e-gates` — a *different* view, built for a
*different* question (bc-khoe.55) — showed nothing anywhere near that old: two sources,
disagreeing, neither one able to settle it. `bc-dgx7.17` nohup'd its own runner and polled
`ps` for 35 minutes while zero suites ran. `bc-ka5y.33` tripped a gate by accident and gave
up on the whole idea, delivering with the gate skipped entirely. `bc-dgx7.15` was the only
one of the six who got a turn by actually waiting it out. The honest answer — "you will
not get a turn today, deliver on the affected suites" — was reached four times by
exhaustion rather than by asking.

```
b7e-queue                        the queue as it stands: limit, position, pid, worktree, age
b7e-queue --mine                 just my position, or "not queued"
b7e-queue --wait [--timeout <s>] block until my ticket holds a slot, exit 3 on the deadline
b7e-queue --dir <path>           "mine" is <path>'s worktree, not the caller's cwd
b7e-queue --json                 one object per ticket instead of the printed report
```

**Nothing here is reimplemented.** `lib/gate.js`'s own `liveSlots` is exported for exactly
this question — "what is this gate waiting for is a question worth answering from
outside" — and already reaps a ticket whose pid is gone, so a dead holder is never listed
and never occupies a position ahead of a live one. `queueRows` (`lib/queue.js`) only adds
the FIFO position and the held/waiting split against `slotLimit()`.

**"Mine" is the ticket, not the process asking.** The command asking `b7e-queue --mine` is
not, in general, the process that called `acquireSlot` — it is usually a later, separate
agent checking in on a gate it started earlier through `b7e-detach`. A ticket is written
with `root` set to the tree the gate is running against, and the per-tree lock in
`lib/gate.js` already refuses a second gate on the same tree at once, so "which ticket is
mine" resolves by matching that `root` against the caller's own worktree — stable across
however many processes ask, and honest when none of them hold anything: `--mine` with no
matching ticket says "not queued" and exits `0` rather than guessing.

**The second source is `lib/gates.js`'s own `discover`, cross-checked, not trusted alone.**
`bc-dgx7.12`'s "447m ago" and `b7e-gates`' "nothing near that old" were two answers with no
way to arbitrate between them; here they are the same call. Every row whose pid is alive
(the dead ones are already gone) is checked against `discover()`'s own process-table-and-lock
scan, and a pid `discover` finds no runner for is flagged a mismatch — a ticket a reused pid,
or a run no longer recognisable as the thing that took the slot, has outlived.

**`--wait --timeout` gives up on the deadline and says the sentence above, verbatim**,
rather than leaving the caller to invent its own way of sitting through a queue that may
never clear today — exit `3`, so the caller can decide to deliver on the affected suites
instead, the way `bc-dgx7.12` and `bc-dgx7.17` both eventually did by hand. With no ticket
of the caller's at all, `--wait` reports "not queued" immediately rather than waiting on
something that will never arrive.

`lib/queue.js` is the queue rows, the FIFO/held split, the "mine" match, the mismatch
cross-check against `lib/gates.js`, and the wait loop. `bin/b7e-queue` is the argv shell.

Exit codes: `0` a clean report, or `--mine`/`--wait` finding (or reaching) a held slot, or
finding no ticket of mine at all. `3` `--wait`'s deadline passed before my ticket held. `2`
bad usage.
