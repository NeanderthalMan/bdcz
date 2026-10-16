### Starting a gate that outlives the call that started it — `b7e-detach`

`bc-dgx7.25`, filed by the session audit against five sessions — `bc-bmry.9`,
`bc-bmry.11`, `bc-bmry.12`, `bc-y3qk.11`, `bc-khoe.47` — that each had to solve *"make
the sweep survive the turn that started it"*, and no two of them solved it the same way.
A full sweep here is 400+ suites and eight minutes or more, longer than a single tool
call may run, and `bin/b7e-gate` deliberately never forks: it runs the sweep in its own
foreground process. So one session used a bare `&` inside a backgrounded tool call, one
`nohup … & disown` plus two `Monitor` loops and five filler turns, one wrote its own
double-fork daemon into a scratchpad and had the first invocation refused by the worktree
guard, and `bc-khoe.47` tried four spellings, read a stale log as a corpse, and ran
`pkill -9 -f "bin/b7e-gate"` — which killed a *different* live session's gate in another
worktree and had to be apologised for over `SendMessage`.

```
b7e-detach                              the narrowed gate (b7e-gate's default), in a session of its own
b7e-detach --full                       every suite, on purpose
b7e-detach --only <suite>|<glob> ...    every b7e-gate flag, forwarded unchanged
b7e-detach --log <path>                 the detached run's whole console output
b7e-detach --start-timeout <seconds>    how long to wait for the record (default 20; 0 answers at once)
```

One line back — `run <id> — pid <pid>, log <path>` — and all three of those are what a
later reader needs: the id for `b7e-watch --run <id> --wait`, the pid for `kill <pid>`,
and the log for the case where something went wrong before any of it started.

**What actually detaches it**, which is the whole reason this is not a wrapper around
`nohup`: `spawn(…, { detached: true })` is `setsid(2)` — a session of its own, no
controlling terminal, and no membership in the process group the calling tool call is
about to be reaped with. That last part is what the two memory notes on this were
circling: a `&` from a tool call leaves the child in the caller's group, and the observed
symptom was a sweep dying at ~5 minutes around suite 88 with the log simply stopping
after a normally-completed suite, which reads exactly like a crash and is not one. Its
stdio is three file descriptors and never a pipe, because a pipe whose reader has gone
hands the child a `SIGPIPE` on its next line of output. `test/b7edetach.mjs` asserts the
mechanism rather than the symptom: the child's process-group id is its own pid.

**The run id is minted before the child exists.** `bin/b7e-gate` grew one flag for this,
`--run-id <id>`, passed through to `lib/gaterun.js`'s `startRun` instead of minting one
there — so the answer is known without reading a log back for it, which is what defeated
`bc-ka5y.15.3` (by ANSI colour) and `bc-khoe.47` (by reading a stale one). The id is
still `lib/gaterun.js`'s to build, via the exported `mintRunId`, so a detached run sorts
and reads identically to one started by hand. `--run-id` refuses anything that is not a
bare filename — it decides a path — and refuses an id whose run file already exists,
rather than appending a second `start` line to somebody else's run.

**Having said the id, it then waits for the record.** Briefly — `--start-timeout`
seconds, 20 by default — so that by the time the line is printed a plain `b7e-watch` with
no arguments already reports on it. Two things can make that wait expire, and they are
told apart rather than merged: the child exiting early (a refusal, a bad `--dir`, a
crash) is reported with the tail of its own log and a non-zero exit, and the child still
running is the gate queued behind another on this Mac (`acquireSlot`) — a queue, not a
failure, so the line is printed and the id stays good for whenever the slot frees.

**It refuses the same things `b7e-gate` refuses, before the fork rather than after it.**
A gate already running on this tree (`gateLockStatus`, the read-only half of the same
per-tree lock) and a `--dir` that is not a git checkout are both exit `2` with nothing
started — a child that exits a tenth of a second after being detached is a worse way to
say "already running" than not detaching at all. There is nothing to clean up either way,
which is the other half of `bc-khoe.47`'s incident: `b7e-gate` releases both its lock and
its machine-wide slot on `SIGTERM` (`lib/teardown.js`), so the printed pid is a clean
`kill`, and a pattern kill — which would reach every other session's gate on this Mac — is
never the answer.

`--log` is this command's own and is deliberately **not** forwarded: the child's whole
console goes to that file, which is already every line `b7e-gate --log` would have written
plus the startup lines that explain a launch that never got going. Everything else —
`--only`, `--skip`, `--jobs`, `--timeout`, `--json`, `--dir`, and anything after a literal
`--` — is forwarded verbatim, so this adds no second opinion about what a suite is or how
many run at once.

Not on `DEFAULT_TOOL_LIST`, for the `b7e-gate` reason exactly: what it starts *is* a
`b7e-gate` run, and starting one in the background rather than the foreground does not
make it a lighter capability than the `Bash(npm test:*)` `lib/grants.js` already holds to
`merge-advocate` alone. Its occasion is a worker session with a branch to gate;
`dispatch`, the one agent that list governs, answers a phone comment with one `bd comment`
and has no sweep of its own to start.
