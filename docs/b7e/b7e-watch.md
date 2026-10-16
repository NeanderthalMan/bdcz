### How far a gate has got, and what's red — `b7e-watch`

`bc-gdub.3` names six sessions (`bc-khoe.27.2`, `bc-gdub`, `bc-r2b5.1`, `bc-ka5y.15.2`,
`bc-ka5y.15.3`, `bc-y8k4.4`) that each launched the full suite in the background and then
had no way to ask about it, because nothing wrote the answer down — only a
human-readable log in that session's own scratchpad, in whatever shape its own runner
happened to print. So each one polled: `bc-khoe.27.2` ran `tail -1 …/sweep.log` more
than thirty times in a row, interleaved with `ps -o etime=`; `bc-gdub` ran `grep -c 'ok
\|FAIL' …/gdub-full.log; tail -1 …` about twenty-five times; `bc-r2b5.1` said "I'll stop
polling" three times and then polled again. `bc-ka5y.15.3`'s filter (`grep -viE "] ok"`)
was defeated outright by the runner's own ANSI colour codes and reported every passing
line as a failure until it noticed.

```
b7e-watch                              this worktree's most recent b7e-gate run
b7e-watch --run <id>                   a specific run, from any worktree or session
b7e-watch --wait --timeout <seconds>   block until it finishes, or the deadline (default 570)
```

One line back: suites done/total, elapsed, and — once the run has finished — the name of
every suite that failed, each tagged with whether it also fails on `origin/main`. Exit
`0` while the run is still going, or once it finished clean, or once every red suite is
also red on `origin/main`; `1` once it finished with a suite red that is not
`origin/main`'s; `2` if the run named, or found for this worktree, does not exist.

**The record is `b7e-gate`'s to write, not this command's.** `bin/b7e-gate` (`bc-khoe.39`,
landed first) appends one JSONL line per suite — via `lib/gaterun.js` — to a file under
`.claude/gate-runs` in the *main checkout*, never the worktree a gate happens to be
running in: `git add -A` at delivery time would otherwise sweep a live run's own record
onto whichever branch happened to be open. Two worktrees therefore see the same
directory, which is what makes `--run <id>` correct against a run another session started
elsewhere. Nothing here greps a log — the `status` field on a `result` line is set from
the suite's exit code, not from a pattern match against coloured text — which is the part
`bc-ka5y.15.3` had no way to get right by hand. `b7e-gate --dir <root>` against a
fabricated, non-git tree (every one of `test/gate.mjs`'s own CLI checks) records nothing
rather than throwing: a run record failing to start must never be why the gate itself
refuses to run.

**Whether a red suite is `origin/main`'s is not reimplemented here either.** `lib/blame.js`
(`bin/b7e-blame`, `bc-khoe.42`) already runs exactly that comparison — by named check
rather than by exit code, against a throwaway detached `origin/main` worktree — and a
second implementation of the same question would be the "three separately-built control
sets" mistake the whole epic (`bc-dgx7`) exists to stop repeating. `b7e-watch` calls
`runBlame` directly once a run has finished, on whichever suites are still red. It
deliberately does **not** run that comparison while the gate is still going: doing so
would add a second run of an already-running suite on top of the load the gate itself is
already putting on the Mac, for an answer ("still running") the caller does not need
until the gate is done. A currently-red suite in a running gate is reported by name
alone, with no verdict tag, until the run ends.

Not on `DEFAULT_TOOL_LIST`, for the `b7e-blame` reason rather than
the read-only shape of `b7e-def`/`b7e-owes`/`b7e-affected`/`b7e-readme`: reading a
finished run's own record is free, but once any suite in it is still red this reruns
every one of them through `runBlame`, which is the same "runs a suite, twice, and builds
a real `git worktree`" shape `lib/grants.js` already calls a write on `Bash(npm
test:*)` for. Its whole occasion is a session watching a `b7e-gate` it just started in
the background; `dispatch`, the one agent this list governs, has no branch and starts no
gate of its own to watch.
