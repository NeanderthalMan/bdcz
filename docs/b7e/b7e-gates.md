### Which gate runners are on this Mac, whose worktree each is, and ending only mine — `b7e-gates`

`bc-khoe.55` names four sessions (`bc-4r10.13`, `bc-khoe.4`, `bc-khoe.30.14`,
`bc-khoe.53`) that each worked out, unaided, which long-running `scripts/test.mjs` or
`scripts/coverage.mjs` process was *theirs*, on a machine where dozens of worktrees of
this repo can be live at once and several may be running one at the same time. No two of
the four used the same method, and two got it wrong first — `bc-khoe.30.14`'s `pkill -f
'scripts/test.mjs'` reported success and killed nothing; the child a `spawnSync` had
started survived its parent's death and kept running, ownerless. Only `lsof -a -p <pid>
-d cwd -Fn` ever actually answered "whose worktree is this pid in", and it took each
session three to five calls to arrive there by trial.

```
b7e-gates                      every runner: pid, kind, worktree, MINE or whose it is
b7e-gates --mine                only runners in this worktree
b7e-gates --others              only runners NOT in this worktree
b7e-gates --end-mine            end every runner in this worktree, verified
b7e-gates --end-mine --stale    more than one mine: spare the newest, end the rest
b7e-gates --match <re>          also match this against a process's whole command line
b7e-gates --dir <path>          "this worktree" is <path>, not the caller's own cwd
b7e-gates --json                one object per runner instead of the printed report
```

**Two ways a runner is found, cheapest first.** `b7e-gate` (`bc-khoe.39`, above) already
writes a lock file per tree holding `{ pid, startedAt }`; `lib/gate.js`'s
`gateLockStatus` reads it back, keyed by the worktree root itself, so for any run that
went through it "which worktree is this pid in" is one file read — no `lsof`, no false
hit from an agent process whose own prompt text happens to contain the words `scripts/
coverage.mjs`. That does not cover a direct `npm test` or `node scripts/coverage.mjs`,
which take no lock — every process-table match not already accounted for by a lock falls
back to `lsof`, and each runner in the report says which of the two (`lock` or `pgrep`)
told it.

**Fails closed.** `lsof` returning "I could not tell" — no binary, or a refusal it did
not explain — is reported `unresolved`, never guessed at as mine or silently dropped;
`--end-mine` never signals an unresolved runner. `BEADCAUSE_LSOF` names one binary and
skips the search, the same override `lib/gitref.js`'s own lock-owner check uses.

**Ending one is verified, not assumed.** `bc-khoe.30.14`'s trap — a signal to the parent
does not reliably take a `spawnSync`'d child down with it — is closed by snapshotting the
*whole* descendant tree of a runner's pid before sending anything, so a child that would
otherwise be orphaned mid-signal is signalled directly rather than left to a cascade that
may not happen. SIGTERM every pid in the snapshot, wait, SIGKILL whatever is still there,
wait once more, then report which are still alive. A runner is `ended` only when nothing
in its tree survived; a survivor is named, never silently written off. Exit `1` when
`--end-mine` leaves one, and also — the acceptance criterion for the plain report —
when more than one runner is mine at once, the same concurrent-gate hazard this repo's
own notes already name as a source of false reds; `--end-mine --stale` is what to run in
that case, sparing the newest.

Not on `DEFAULT_TOOL_LIST`. `--end-mine` sends `SIGTERM`/`SIGKILL`
to a live process — a write with no undo — and the allowlist has no syntax to grant the
plain report while withholding that one flag from the same binary. `dispatch`, the one
agent this list governs, has no gate of its own running and no branch to have started one
on.
