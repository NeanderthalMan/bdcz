### A handful of named suites, in one call the worktree guard will allow — `b7e-suite`

`bc-khoe.30.17` is the fourth finding the session audit filed against the same shape
breaking repeatedly: seven sessions (`bc-khoe.30.14`, `bc-khoe.53`, `bc-4r10.14`,
`bc-4r10.4`, `bc-4r10.3`, `bc-4r10.9`, `bc-eqn1.2`) each wrote `for s in <names>; do node
test/$s.mjs; done` after an edit — wanting a handful of suites, not the whole gate — and
the worktree guard refused every one of the seven with "this command is too complex to
verify that it stays inside the worktree", because a loop is not a command a guard can
read in one pass. Two of the seven also asked for a suite that is not on disk (`readme`,
`beadreqs`) and paid for it with a `MODULE_NOT_FOUND` stack from `node test/<name>.mjs`
rather than a plain answer.

```
b7e-suite panes releases deploystart   bare names, resolved against the tree's own suites
b7e-suite test/panes.mjs               a full suite path works too
b7e-suite 'test/b7e*.mjs'              a glob — quote it, or the shell expands it first
b7e-suite --all                        the whole sweep — the same set b7e-gate/npm test run
b7e-suite --jobs N                     how many suites at once (default 6)
b7e-suite --dir <root>                 another tree — this is how it is tested
```

**One command, because the guard only ever refused the loop.** Every prior session's
actual list of suites was fine; what tripped the guard was asking for more than one by
shelling a loop over `node test/<name>.mjs`. A flat argv is one command, so this is the
whole fix — `lib/suite.js` resolves the names, `lib/gate.js` (the same runner
`bin/b7e-gate` already uses) runs them concurrently, with its own per-suite `TMPDIR`
sandbox, its own solo suites and slow-suite timeouts, and its own per-tree lock, so a
suite passing here and a suite passing in the whole gate can never disagree about what
passing means, and this can never double a `b7e-gate` already running on the same tree.

**Resolution, before anything runs.** A name already in the tree's own suite list —
`test/panes.mjs`, `scripts/selftest.mjs` — resolves to itself. A name with a `*` is a
glob over that list, the same grammar `b7e-gate --only` uses (`*` only, never a regex). A
bare word (`panes`) is matched by *stem*, not basename, so it resolves whether the real
file ends in `.mjs` or `.js` without this file guessing an extension. A name that matches
nothing — a typo, or a suite that does not exist — is reported as `MISSING <name>` before
a single suite starts, which is the answer the two sessions above never got: no worktree,
no `bd`, nothing on disk changes on the strength of a name nobody checked.

Exit codes: `0` every suite passed; `1` at least one failed or timed out; `2` refused —
bad usage, a name that resolves to nothing, or another gate already running on this tree.

**Why this and not `b7e-sh -c 'for s in …'`.** `b7e-sh` (bc-ka5y.29) also gets a loop
past the guard, and it was the reason bc-khoe.30.17 was first closed unlanded. It runs
whatever script it is handed, though, so it has no idea what a suite is: a typo'd name
still comes back as a `MODULE_NOT_FOUND` stack, the suites run one after another with no
`TMPDIR` sandbox and no timeouts, and nothing stops it running on top of a `b7e-gate`
that is already going on the same tree. This command does nothing except run suites, and
it does that through `lib/gate.js`.

Its grant is `@grant excluded`, declared in its own header, for `b7e-gate`'s reason and
not for the read-only reason `b7e-def`/`b7e-owes`/`b7e-affected` have: running suites is
a write. `Bash(npm test:*)` belongs to `merge-advocate` alone, on the grounds that
"nothing about run the tests is a read". `dispatch` has no branch and no suite of its own
to re-run. A worker session, which is what keeps hitting the shape this bead is about,
already carries an unrestricted allowlist and needs no grant to run it. See
`lib/suite.js`, `bin/b7e-suite` and `test/suite.mjs`.
