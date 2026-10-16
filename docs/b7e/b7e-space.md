### How full the disk is, what of ours is filling it, and whether a worktree or a gate will fit — `b7e-space`

`bc-dgx7.197`, filed by the session audit against three windows (`bc-dgx7.196`,
`bc-j2zwo.20`, `bc-j2zwo.14`) that all hit `ENOSPC` on 2026-10-15. `EnterWorktree` died
partway through checkout; a `git worktree add` in another repo did the same; the local
shipgate died at about suite 173 of 601. Each then worked out the cause with its own list of
`df` and `du` commands — `.claude/worktrees` (5.4G), `~/Library/Caches` (13G), the
`beadcause-gate-run-*` folders (6.1G) — and none checked before starting.
`lib/gaterun.js` only notices `ENOSPC` after a run has failed (`bc-xl7n.196`); the free-space
floor before admitting a run, its option (a), is `--need gate` here.

```
b7e-space                       free/total, then our space users, largest first
b7e-space --need worktree       exit 1 when a worktree checkout would not fit
b7e-space --need gate           exit 1 when a gate run would not fit
b7e-space --need 2147483648     an explicit byte count
b7e-space --json                the same answer as one object
```

It prints free and total bytes for the volume holding the checkout and for `TMPDIR` (one
line when they are the same), then the groups that are ours, largest first, each with its
count and its five largest members: live `.claude/worktrees` (with **`[locked]`** where
git's admin directory holds a lock), `.claude/worktrees-retired`,
`beadcause-gate-run-*` and `beadcause-prfull-*` folders in `TMPDIR`, other `beadcause-*`
folders there, and sibling repos' `.claude/worktrees` next to this checkout.

**The floors** are 1 GiB for a worktree and 8 GiB for a gate run, judged against the tightest
volume the thing writes to (a gate fans out into `TMPDIR`, so it takes the lower of the two).
They are floors rather than forecasts: below them, failing is the ordinary outcome.

Exit `0` answered (and it fits, if asked), `1` it does not fit, `2` bad usage. It writes
nothing and deletes nothing — it says where the space went; clearing it is a person's call.
`lib/space.js` exports `survey` and `fits` so gate admission can ask the same question.
