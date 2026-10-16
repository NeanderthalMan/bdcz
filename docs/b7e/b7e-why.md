### What the failing suite actually printed, out of a finished gate run — `b7e-why`

`bc-dgx7.66`, filed by the session audit against five sessions (`bc-xl7n.131.1`,
`bc-xl7n.132.1`, `bc-774a2`, `bc-eqn1.5`, `bc-xl7n.131.2`) that each ran `b7e-gate`
detached, got a verdict naming one or two reds, and then had to read the raw log to find
out what the red *said*. No two did it the same way. `bc-xl7n.131.1` took four calls: a
`grep -A 25` to locate the suite, a `sed` range piped through `cat -v` that died with
`sed: RE error: illegal byte sequence`, an `LC_ALL=C sed` over the whole log into a
second plain-text file, and finally a `sed` range over *that*. `bc-774a2` had to
`grep -o` its own log for the runner's real log filename before it could begin.
`bc-xl7n.131.2` re-ran the same `grep -E` five times against a live run.

The answer was already written down. `lib/gaterun.js`'s `appendResult` records
`{ suite, status, elapsed, tail }` per suite, one JSONL line, and that file's header says
in as many words that a reader never has to grep a log for it. But `b7e-watch` renders
`r.failed.join(', ')` — the suite names and a blame tag, never the tail. So the one thing
a session needs after a red was the one thing the command that reads that file did not
print, and every session fell back to the log. `whyFor` is that read, wired to a CLI.

```
b7e-why                   every failed suite of this worktree's most recent run
b7e-why <suite> ...       those suites only, whatever they did
b7e-why --run <id>        a specific run, from any worktree
b7e-why --json            the raw records
b7e-why --dir <root>      another tree
```

**It never runs a suite, and that is the whole economy of it.** The tail was captured
when the gate ran it, so printing it costs a file read rather than the ten to twenty-five
minutes a re-run costs here. `test/b7ewhy.mjs` proves that the only way it can be proved:
a run recorded as red on a suite whose file was never written at all still prints its
tail — anything that tried to *run* it would have to report the missing file instead.

**The blame tag the bead sketched as part of this output is deliberately not here.**
Whether a red is also `origin/main`'s is `lib/blame.js`'s question and it costs a local
run *plus* an `origin/main` one — which is why every command in this family that can
spawn a suite or cut a `git worktree` (`b7e-gate`, `b7e-watch`, `b7e-blame`,
`b7e-triage`) is `@grant excluded`. `b7e-watch` already prints that tag, for the same
run's same reds. So: this answers "what did it say", `b7e-watch` answers "is it mine",
`b7e-triage` answers "is it real" — one question each, at one price each, and only this
one is free.

**Nothing it prints is coloured, deliberately.** The recorded tail has ANSI in it — a
suite's own green `✓` and red `✗` — and it comes off, because this output is routinely
pasted into a bead comment or a pull-request body, and a control byte in a tracker field
is the one thing `test/filter.mjs` fails this repo for. `b7e-triage` dims its tail
because it is printing alongside its own verdicts; here the tail *is* the output, so
stripping the recorded escapes and then adding new ones would be a joke. The stripper
(`stripAnsi`, in `lib/gaterun.js`) takes a lone escape byte with nothing recognisable
after it as well — the one a naive `s/ESC\[[0-9;]*m//` leaves behind, invisible in every
reader.

**A suite named that did not fail says so.** With no arguments the set is the run's own
failed list; name a suite explicitly and it is answered whatever it did — `ran ok … —
nothing to explain`, or `never-ran` for one the run never reached. A name that is not a
suite in the repo at all is refused with exit `2` rather than reported as `never-ran`,
the same refusal `b7e-ran` makes and for the same reason.

**On `DEFAULT_TOOL_LIST`**: `@grant read` in the file's own header, which is what puts it
there — see `b7e-tool-grant-is-now-a-self-declared-header-tag`. It reads one JSONL file
and, only to refuse a typo, shells to `scripts/test.mjs --list`. It never spawns a suite
and never builds a worktree, which is the `b7e-ran`/`b7e-stillred` reading rather than
the `b7e-gate`/`b7e-watch`/`b7e-blame`/`b7e-triage` one.

Exit codes: `0` nothing asked about failed; `1` at least one did, or a named suite never
ran; `2` refused — bad usage, no run found, or a suite name that is not a suite in this
repo at all.
