### Did the gate actually run this suite, and what did it say — `b7e-ran`

`bc-dgx7.92`, filed by the session audit against six sessions (`bc-dgx7.80`, `.86`,
`.82`, `.77`, `.81`, `.78`) that each added a new `test/*.mjs`, ran a gate, and then
had to work out by hand whether that file had actually been in the run — no two of
them the same way. `bc-dgx7.86` grepped a persisted log for `"b7ewrite\|b7e-write"`,
then again under a different spelling. `bc-dgx7.77` tried three greps in a row before
giving up and searching for `"test/role"` plain. `bc-dgx7.80` is the one that shows why
a basename grep is not an answer: it built the real check by hand across four calls —
`b7e-gate --list` to a file, the log's own suite names to another, `sort -u` both,
`comm -23` between them — and only that way found that its own two new suites had
*never run at all*; a plain grep for one of their names had matched an unrelated file
instead and read as "there."

The data already existed: `lib/gaterun.js`'s `readRun` already parses the JSONL
`b7e-gate` writes, one line per suite, precisely so nothing has to grep a log — it just
had no way to ask about one named suite, or which selected suites produced no result at
all. `resultsFor`/`missingFrom` are that read, wired to a CLI.

```
b7e-ran <suite> ...        one row per named suite, against this worktree's most
                            recent gate run
b7e-ran --missing          every suite the run selected that produced no result
b7e-ran --run <id>         a specific run, from any worktree
b7e-ran --json             the raw records
b7e-ran --dir <root>       another tree
```

**`never-ran` is its own answer, not a verdict.** A suite that never produced a
`result` line in the run — never selected, or a run that stopped before reaching it —
reports `never-ran`, distinct from any `ok`/`FAIL`/`TIMEOUT`. That is exactly the
ambiguity a basename grep collapses: it cannot tell "not there" from "there and green"
from "matched something else entirely."

**`TIMEOUT` is recovered from the tail, not stored as its own status.** `b7e-gate`'s own
`onResult` collapses `FAIL` and `TIMEOUT` into the JSONL's `status: 'fail'` before
writing — see its header. `lib/gaterun.js`'s `verdictFor` tells them apart the only way
the record still can: by matching the `"timed out after Xs — killed"` line `runSuite`
(`lib/gate.js`) appends to a suite's own tail when it is killed for running past its
timeout, which `appendResult` keeps as the last lines of `tail` for any non-`ok` result.

**A typo is refused, not reported as `never-ran`.** Named suites are checked against
`discoverSuites` (`scripts/test.mjs --list`, the same list `b7e-gate` itself selects
from) before anything is read from the run; a name that is not a real suite in the repo
exits `2` rather than printing a real-sounding negative for something that was never a
suite. `--missing` does not need this check — it reads names straight out of the run's
own `start` line, which `b7e-gate` only ever populated from a real `discoverSuites` call
in the first place.

Exit codes: `0` every named suite ran with verdict `ok` (or, with `--missing`, nothing
is missing); `1` at least one named suite never ran or came back `FAIL`/`TIMEOUT` (or,
with `--missing`, at least one suite is missing); `2` refused — bad usage, no run found,
or a suite name that is not in the repo at all.

**On `DEFAULT_TOOL_LIST`**, the same read-only argument as
`b7e-gated`/`b7e-stillred` just above: it only parses an already-written JSONL record
and, to refuse a typo, shells to `scripts/test.mjs --list` — it never runs a suite and
never touches `bd`.
