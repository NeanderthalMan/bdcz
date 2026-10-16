### How often does this actually fail, over N runs, with every run's output kept — `b7e-flake`

`bc-dgx7.73` names three sessions that each needed a failure *rate*, not a *verdict*, and
each built the loop by hand. `bc-beleq.1` (acceptance was "20 solo runs, pre-fix vs
post-fix") started with `for i in 1 2 3; do node test/advswitch.mjs 2>&1 | tail -5; done`
— the worktree-isolation guard refused it as too complex to prove it stays in the
worktree — retried as a backgrounded `seq 1 8` loop, refused again, fell back to two
solo runs redirected into scratchpad files, then finally wrote a heredoc script with its
own pass/fail counters, which outran the 180s Bash timeout and had to move to the
background — and wrote a SECOND, nearly identical script for the pre-fix side.
`bc-khoe.67` wrote a fourth shape, `... | grep -E "^(✗|✘|×|FAIL)" | head -10 ...`, and the
grep-through-a-pipe form threw away the one thing it was after — its own debrief: "Run 3
failed but I lost its output. Save every run to its own file from the start." `bc-dgx7.57`
wrote a fifth, for a two-run sanity check before delivering.

```
b7e-flake <suite|script>...     one or more targets, each run --runs times
b7e-flake --runs N              how many times each target runs (default 10)
b7e-flake --jobs N              how many runs at once, per target (default 4)
b7e-flake --env K=V             env var forwarded to every run — repeatable
b7e-flake --dir <root>          "this tree" is <root>, not the tree this file is in
b7e-flake --timeout <s>         per-run seconds, overriding lib/gate.js's own default
b7e-flake --json                one object per run instead of the printed report
```

**Not `b7e-triage`.** That command (above) re-runs each *failure* exactly once and
classifies flake/vendor/real — it answers "is this real", never "how often". This runs
every target `--runs` times up front and reports a rate plus the failures grouped by
signature, which is the question all three sessions above actually had.

**Every run's output is kept, on disk, whether it passed or not.** The one lesson
repeated across all three sessions is that deciding which run's output is "worth
keeping" *after the fact* is exactly the judgement that loses the one you needed —
`bc-khoe.67`'s own debrief names this directly. `runSuite` (`lib/gate.js`, reused as-is
for the spawn and the per-suite timeout) already hands each run its own `TMPDIR`
sandbox; this writes that run's full stdout+stderr to its own log file under
`.claude/gate-runs` — the same directory `b7e-gate` already writes JSONL run records to,
resolved through `lib/gaterun.js` so both land in the *main checkout* rather than inside
a worktree's own tree (a `git add -A` at delivery time must not sweep a live run's log
onto whichever branch happens to be open), and both are visible from any worktree by the
same path. A flake run's id is prefixed `flake-` so it is never confused with a gate's
own run record. A `--dir` that is not a git checkout — every fabricated tree
`test/flake.mjs` drives the CLI against — has no such directory to resolve; rather than
throw, it falls back to a plain directory under the system temp dir, the same "fail soft
in the safe direction" `b7e-gate` itself follows for a non-git `--dir`.

**Failures are grouped by signature**, not just tallied. `failureSignature` looks for, in
order: an errno-style code (`ENOTEMPTY`, `ENOENT`, ...), an `AssertionError` line, a
`SomethingError:` line, a signal, or the bare exit code — the first of these actually
present in a run's output. `bc-beleq.1`'s own acceptance is exactly this shape: 20 runs
of `test/advswitch.mjs` on the pre-fix content report `ENOTEMPTY` on roughly 1 run in 20,
each with its own log path printed; the fixed content reports 20/20 passed.

`--env` is `runSuite`'s one new option, merged in *underneath* the safety envs it always
sets (`NO_LAUNCH`, `HELD_ENV`, `TMPDIR`) — a caller can parameterise a run (`bc-khoe.67`'s
own `PRESS_MS` sweep across a budget) but can never use it to turn off the launch guard
or hand two runs the same scratch directory.

Exit codes: `0` every target passed every run; `1` at least one target had at least one
failing run; `2` refused — bad usage (no target given, a malformed `--env`).

Not on `DEFAULT_TOOL_LIST` (`@grant excluded`), for the `b7e-triage`/`b7e-counterproof`
reason: it re-runs a suite, which `lib/grants.js` already classifies as a write.
`dispatch`, the one agent that list governs, has no branch and no rate of its own to
measure.
