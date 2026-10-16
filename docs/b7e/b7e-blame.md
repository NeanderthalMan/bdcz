### Say whether a failing suite is already failing on `origin/main` — `b7e-blame`

`bc-khoe.42` names eight sessions (`bc-khoe.23`, `bc-b4fs.1`, `bc-36xx.6`, `bc-5k22`,
`bc-xl7n.74`, `bc-xl7n.79`, `bc-1kwl.22`, `bc-j52g`) that each hit a red suite mid-gate
and each decided, from scratch and by a different method, whether it was theirs: a
re-run in the untouched main checkout, a read of imports and a claim they were
byte-identical to main, a memory of an advocate pass from earlier the same day, an
attribution by inference to a bead nobody checked. Two directions to get wrong and both
expensive — believing a real red is main's ships a break, and disbelieving main's red
costs an investigation nobody needed to run.

```
b7e-blame <suite>...             blame each: your tree vs a detached origin/main
b7e-blame --from <gate-log>      take every FAIL/TIMEOUT suite out of a b7e-gate log
b7e-blame --dir <root>           "your tree" is <root>, not this repo's own root
b7e-blame --timeout <s>          per-run seconds, both sides
b7e-blame --json                 one object per suite instead of the printed report
b7e-blame --keep                 leave the origin/main scratch worktree in place
```

**A suite here is a list of named checks, not a pass/fail bit.** This repo's own
convention — `test/systemcard.mjs` and `scripts/selftest.mjs` both follow it — prints
`  ok   <name>` or `  FAIL <name>` (or a close variant of that spacing) once per check,
and comparing two runs *by name* is the entire point of building this rather than
reading `b7e-gate`'s exit code twice: a suite red on `origin/main` for reasons A and B,
and red here for A, B and C, is not "already red on main" — it is red on main *and* you
introduced C. The verdict says which: `clean` (passes here, `origin/main` never
consulted), `main-red` (fails here, every named failure also fails on `origin/main`),
`partial` (red on both, but at least one named failure here is not on `origin/main` —
partly yours), `yours` (`origin/main` passes clean, or does not have the file at all),
`unclear` (red on both sides but neither run named a check — nothing to compare by name,
decide by hand), `unknown` (the `origin/main` worktree could not be built at all —
inconclusive, not evidence either way), `no-local` (the suite path does not exist in
your tree — a usage mistake, most likely).

**The comparison runs against a throwaway detached `git worktree` at `origin/main`,
never the main checkout** — routinely tens of commits behind whatever landed since —
**and never `EnterWorktree`** — a duplicate-check run makes no edits and should
take no lock a sibling session could then trip over, exactly the ritual every one of
those eight sessions had been running by hand. One worktree is
built lazily, the first time a suite actually fails locally, and reused across the rest
of the list — a run where every suite given passes locally never builds one at all — and
it is torn down in a `finally`, `--keep` aside, so a crash partway through the list
still cleans up. `node_modules` is symlinked into it from your own tree, the same
never-copy rule `b7e-worktree` and `scripts/vendor.js` hold elsewhere; `public/vendor`
is not, because the suites this command targets are `scripts/test.mjs`'s own discovery
— browser checks, the only suites that want a built `vendor/`, are not among them.

`--from <gate-log>` reads either shape a `b7e-gate --log` actually writes — the plain
`[done/total] STATUS suite secs s` line, or one JSON object per line under `--json` —
and blames every suite it named `FAIL` or `TIMEOUT`, so the ordinary flow is `b7e-gate`
first, `b7e-blame --from <the log it printed>` second, with no suite paths retyped by
hand in between.

Exit codes: `0` nothing here needs your attention (every failing suite given is already
failing on `origin/main` with the same named checks, or passed outright); `1` at least
one suite carries a failure `origin/main` does not have, in full or in part, or could
not be checked against it at all; `2` refused — bad usage, or no suites to look at.

Not on `DEFAULT_TOOL_LIST`, for the same reason as `b7e-gate`
rather than the read-only shape of `b7e-def`/`b7e-owes`/`b7e-affected`: it runs a suite,
twice, which `lib/grants.js` already classifies as a write — `Bash(npm test:*)` is held
by `merge-advocate` alone, on the argument that "nothing about run the tests is a read"
— and it creates a real `git worktree`, if a detached and short-lived one.
`dispatch`, the one agent this list actually governs, has no branch of its own and no
suite run to doubt.
