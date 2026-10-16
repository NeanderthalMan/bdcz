### Prove a new check is red without the fix, and put the tree back — `b7e-counterproof`

`bc-68ou.14` names three sessions (`bc-fh0sz`, `bc-xl7n.109`, `bc-gdub`) that each wrote a
regression check, then had to answer "does this actually catch the bug?" by hand, each a
different way: `git stash push -- <path> && node <suite>; echo "EXIT=$?"`, then `git
stash pop`; the same stash with the pop chained onto a `grep`'d pipe, so the exit code
echoed was the pipe's, not the suite's; a `sed` mutation of a copy, three separate times
for three separate lines, with no restore at all until the very end. Two of those forms
leave the tree wrong if the suite crashes between mutate and restore, and one of them
actually lost an uncommitted fix that way, redone by hand.

```
b7e-counterproof <path>... -- <suite>...   revert <path>s to --at, run each <suite>
b7e-counterproof --at <ref>                what to revert to (default: merge-base with main)
b7e-counterproof --dir <root>               "this tree" is <root>, not this repo's own root
b7e-counterproof --timeout <s>              per-run seconds, overriding lib/gate.js's own default
b7e-counterproof --keep-going               keep going past a suite name that will not resolve
b7e-counterproof --json                     one object, machine-readable, instead of the printed report
```

Every suite named runs **twice**: once against the tree exactly as it is, once with
`<path>...` reverted to `--at`. Only a check that is green the first time and red the
second is *proven* by the revert — the report calls those out by name, with the failure
text underneath, same as `bc-fh0sz`'s own debrief asked for ("5/7, failure text showing
the missing grace line"). A check red both times is reported separately rather than
folded in: it may be red for a reason that has nothing to do with the paths being
reverted, and counting it would be exactly the mistake `bc-xl7n.109`'s first PATH check
made the other way — `PATH=/usr/bin:/bin` hard-coded, so it "passed" with and without the
fix and proved nothing either way. A check that passes both ways is the same failure in
reverse, and the exit code says so: `0` only when every named suite flipped at least one
check.

**The restore is `lib/teardown.js`'s `onExit`, not a fourth hand-rolled one.** Every
path is snapshotted to raw bytes *before* anything is mutated — not read back through
git, not assumed to match any ref — so an uncommitted fix sitting in the tree when this
is called is exactly what comes back, the case `bc-gdub` lost work to. The snapshot, the
`onExit` registration and the mutation itself happen on one synchronous tick with no
`await` between them, so a `SIGTERM` (a caller's own timeout, `Ctrl-C`, an agent harness
stopping the run) cannot land in a window where the paths are mutated but the restore is
not yet armed — `test/counterproof.mjs` drives a real kill mid-run and checks `git
status` before and after are identical, uncommitted edit included.

`--at` defaults to the merge-base between `HEAD` and whichever of `origin/main`/`main`
resolves — the ordinary case being a branch that added the fix on top of a commit `main`
has not moved past. A bare suite name (`teardown`, not `test/teardown.mjs`) resolves
against `lib/affected.js`'s `candidateSuites` — `npm test`'s own list *union* every
`scripts/*-check.mjs` — with `.mjs`/`.js` tried in turn, the same "suites or
`scripts/*-check.mjs`" scope the bead names. An unresolved name refuses the whole call
before anything is mutated, unless `--keep-going` is given, in which case it is dropped
and the rest of the named suites still run.

The tree-wide lock is `lib/gate.js`'s own `acquireLock` — the same one `b7e-gate` takes,
on purpose: this does everything a gate run does and then mutates tracked files on top,
so a gate and a counterproof racing on one tree is worse than either racing itself.

Exit codes: `0` every named suite flipped at least one check; `1` ran fine but at least
one suite passed both ways, or was skipped as unresolved under `--keep-going`; `2`
refused outright — bad usage, an unresolved suite name without `--keep-going`, a `--at`
that does not resolve, or the lock already held.

Not on `DEFAULT_TOOL_LIST`, for the `b7e-triage`/`b7e-blame` reason
and then some: it re-runs a suite, which `lib/grants.js` already classifies as a write,
and it also writes to the tracked tree while it runs, if only for the run. `dispatch`,
the one agent that list governs, has no branch and no new check of its own to prove.
