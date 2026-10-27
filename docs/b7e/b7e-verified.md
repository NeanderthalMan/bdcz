### What actually ran, and what it said, in one line fit for `--tests` — `b7e-verified`

`bc-36xx.27` names six sessions (`bc-36xx.18`, `bc-khoe.30.8`, `bc-ka5y.16`, `bc-42ow.6`,
`bc-xl7n.76.1`, `bc-dgx7.8`) that each composed a delivery's `--tests` string by hand,
from memory, after a run that had scrolled past hours earlier — and no two used the same
shape. `bc-36xx.18` is the one worth naming on its own: it attested `test/approval.mjs`'s
failure was "a pre-existing bug on main." It was not — the worktree simply had no
`node_modules` symlink — and the session found out only after delivering, by re-running
the suite in a scratch worktree by hand, and had to file a correction. The evidence for
the real answer was sitting on disk the whole time, in the run's own log; nothing read it
back.

```
b7e-verified                     auto-discover this worktree's own gate evidence
b7e-verified <log>...            one or more gate logs — a b7e-gate log, a
                                  lib/gaterun.js run record, or a directory of them
b7e-verified --since <ref>       the diff-coverage check is against <ref>...HEAD (default: main)
b7e-verified --dir <root>        "here" is <root>, not this repo's own root
b7e-verified --json              the same report, as one JSON object
```

**Three log shapes, never a fourth guessed at.** A `lib/gaterun.js` run record
(`.claude/gate-runs/*.jsonl`) is read with `readRun`, never re-parsed. `b7e-gate`'s own
plain `--log` text (`[n/t] STATUS suite secs`) and its `--json` shape are both read the
same way `b7e-blame`'s `suitesFromGateLog` already does. The third is the shape three of
the six sessions above actually left behind, predating `b7e-gate` entirely: a shell
transcript, one suite run per its own Bash call, each announced by a `$ node <suite>` (or
bare `node <suite>`) line — the block between one announcement and the next (or EOF) is
read for its verdict. A named `FAIL` line is `lib/blame.js`'s `extractFailures`, reused
as-is; but a **missing** one is not a pass. `lib/blame.js` is explicit that no `FAIL`
line means "cannot be compared by name", never "zero failures", and it only ever asks
after it already knows the suite's exit status — which a transcript does not carry. So a
block is green only on positive evidence that the check convention ran (an `ok <name>`
line, a `N checks passed` tally), red on a failure or on Node's own death rattle (an
error headline, a stack frame, a `throw`), and otherwise `unknown` — counted as neither
passed nor red, and named as unreadable in the line. That last distinction is
`bc-36xx.18` itself: a missing `node_modules` symlink killed the suite with
`ERR_MODULE_NOT_FOUND` before its first check, so it printed no `FAIL` line at all. A log
matching none of the three shapes contributes no suites; it is not counted as partial
evidence that a run happened.

**Auto-discovery is one source, not a scan of `os.tmpdir()`.** With no logs named, this
worktree's most recent `lib/gaterun.js` run (`latestRunFor`) is read if there is one —
the same lookup `b7e-watch` makes, scoped to a worktree by construction. `b7e-gate`'s
default `--log` destination (`beadcause-gate-<pid>.log`, flat in `os.tmpdir()`) was
deliberately **not** added as a second auto-discovered source: nothing in that filename
says which worktree or which repo wrote it, so scanning for one would as happily hand
back a stale log from an unrelated session on the same Mac — wrong in the permissive
direction, which is worse than reporting nothing. A `--log` a caller wants read has to be
named on the command line.

**Red suites are never a second red/green implementation.** Every suite this tool finds
red is handed straight to `lib/blame.js`'s `runBlame` — the exact `origin/main`
comparison `b7e-blame` and `b7e-watch` already make, by named check rather than exit
code — and the report's own line is built from `verdictLine`'s own wording (`"green on
main — yours"`, `"red on main too"`, …) rather than a paraphrase that could drift from
what those words actually mean.

**Diff coverage is best-effort, and says so.** `git diff --name-only <since>...HEAD`
names what changed; a changed file is reported as uncovered if its own path (or
basename) is not a substring of any suite's own source among the suites that **actually
ran** — not among the suites a run merely planned to run, and not a real import-graph
trace. The distinction is load-bearing rather than pedantic: a `lib/gaterun.js` record
names its whole plan on line one and fills in results as it goes, and `latestRunFor`
returns unfinished runs, so auto-discovery reads a partial run by default. Crediting a
touched file to a suite that has not started yet would be a false coverage claim from the
one command whose whole job is to stop false `--tests` claims. A run that is still going
says so in its own line, with how many of its planned suites have reported so far.
A file reached through an indirection this cannot see (a
second `import` hop, a path built at runtime) can still be silently reported uncovered;
it is a lead worth checking by hand, not proof either way.

Exit `0` once a report line is produced — reds and diff gaps are reported inline, not
gated on, so a red suite does not by itself fail the command. Exit `1`, with nothing
printed to stdout, when no run is evidenced at all: no log named or discovered names a
single recognisable suite.

Not on `DEFAULT_TOOL_LIST` in `lib/toolbelt.js`, for the exact `b7e-blame`/`b7e-watch`
reason: any red suite it is told about it hands to `runBlame`, which re-runs that suite
here and, if still red, again against a real `origin/main` worktree — `Bash(npm
test:*)`'s own shape, a write `lib/grants.js` already holds to `merge-advocate` alone.
Checked against `lib/grants.js` before deciding, per the write-shaped precedent every
sibling above already set: the answer is "not on this list at all," not "add it and
classify it read." `dispatch`, the one agent this list governs, has no gate run of its
own, no branch, and nothing to deliver past its own single `bd comment`.


