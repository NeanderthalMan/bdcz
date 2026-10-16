### Re-run a sweep's failures alone, and say which are real — `b7e-triage`

`bc-ka5y.15.16` names four sessions (`bc-ka5y.15.5`, `bc-khoe.29`, `bc-khoe.30.4`,
`bc-r2b5.2`) that each took a wide sweep's list of failed suite names and triaged it by
hand, differently. Two lists were pure noise — a flake, a suite that only needed
`scripts/vendor.js` — and two hid a real red inside the same-looking list; no session
could tell without re-running, and every one did the re-run itself a different way. That
split is the whole argument: the list alone is not readable, and the re-run is
mechanical.

```
b7e-triage <suite>...           re-run each: flake, needs vendor, or real
b7e-triage --from <gate-log>    take every failure out of a b7e-gate log, or a hand-rolled one
b7e-triage --dir <root>         "this tree" is <root>, not the tree this file is in
b7e-triage --timeout <s>        per-run seconds, overriding lib/gate.js's own default
b7e-triage --json               one object per suite instead of the printed report
```

**Not `b7e-gate`.** `b7e-gate` (above) runs the whole sweep concurrently and reports
what failed; this starts from that report and finishes what those four sessions did by
hand — re-running each failure alone, serially, one at a time, never beside another,
because removing the concurrent load the first sweep ran under is the entire point of a
triage step. `test/slowstart.mjs` cannot even be compared against a concurrent run — it
fails only there. `runSuite` and `timeoutMsFor` (`lib/gate.js`) are reused rather than
reimplemented, and this never shells out to `bin/b7e-gate` itself: that command takes its
own per-tree lock, and triage happens right after a sweep, so a caller doing that would
be refused mid-triage for doubling a load that has already finished.

**Three verdicts.** `real` — still fails alone; the report includes the last few lines
of its output. `flake` — passes alone, first try. `needs vendor` — fails alone only
because `public/vendor` (gitignored) had never been built in this tree; running
`scripts/vendor.js` and re-running turns it green. `test/pagealias.mjs` is the suite this
is already written down for, but the check is generic rather than hardcoded to that one
name — any suite this tree adds that reads `public/vendor` gets the same answer for the
same reason, and `scripts/vendor.js` is attempted at most once per run, lazily, the first
time a re-run actually needs it. It always runs as `<root>/scripts/vendor.js` — the
target tree's own copy, never a path resolved through this file's own location — because
`scripts/vendor.js` roots itself from where it is *run from*, not from `--dir`, and a
tool that got that wrong would build vendor for the wrong tree while printing a
normal-looking success line.

**Parsing a log nobody agreed the shape of.** `b7e-gate` did not exist when three of the
four sessions above ran, so each wrote its own throwaway runner and none of their logs
looked alike: `[n/t] FAIL <suite>` off a hand-rolled pool, `FAIL <suite> (NNms)` off a
`grep` of one, a bare suite name off `grep -l`, a `==== FAILURES: N ====` header.
`b7e-blame`'s `suitesFromGateLog` already covers `b7e-gate`'s own two *per-suite* log
shapes and is reused here; `b7e-gate`'s own final tally line (`P/T passed, F failed: a,
b, c`) — the shape most future sweeps will actually hand this command — and the four
looser shapes above are read on top of that. A name with no directory in it
(`pagealias.mjs` rather than `test/pagealias.mjs`) is resolved against the tree's own
suite list by basename; a name that resolves to none, or to more than one, is reported as
`unresolved` rather than silently dropped — a triage tool that drops a failure is worse
than none, and is treated the same as a `real` one for the exit code.

Exit codes: `0` every failure given was explained away (a flake, or fixed by
`scripts/vendor.js`); `1` at least one is still `real`, or could not be resolved to a
suite in this tree at all; `2` refused — bad usage, or nothing to triage.

Not on `DEFAULT_TOOL_LIST`, for the same reason as `b7e-gate` and
`b7e-blame` rather than the read-only shape of `b7e-def`/`b7e-owes`/`b7e-affected`: it
re-runs a suite, which `lib/grants.js` already classifies as a write — `Bash(npm
test:*)` is held by `merge-advocate` alone, on the argument that "nothing about run the
tests is a read" — and on a suite it decides needs it, writes to the tree via
`scripts/vendor.js`. `dispatch`, the one agent this list actually governs, has no sweep
of its own to triage and no branch to have run one on.
