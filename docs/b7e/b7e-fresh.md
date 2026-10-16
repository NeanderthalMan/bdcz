### Is my worktree's base current, and what will actually land — `b7e-fresh`

`bc-dgx7.127`: sessions each ran a freshness check as their first command and no two ran
the same one — a bare `git log --oneline -1` against a remembered sha, or an honest
`merge-base --is-ancestor` one-liner the worktree sandbox refused as too complex. The
same ambiguity recurs at delivery time: `git diff main...HEAD` and `git log
origin/main..HEAD` disagree the moment a branch carries a commit cherry-picked in from
elsewhere.

```
b7e-fresh                 infer the workspace and base from where you are standing
b7e-fresh -w myproject    the base a named workspace delivers into, not the inferred one
b7e-fresh --base develop  compare against a literal ref instead of resolving one
b7e-fresh --reset         fast-forward once confirmed behind, with a clean tree
b7e-fresh --json          one object on stdout, for a caller
```

**A combine, not a rebuild.** `b7e-base` (above) already answers "is HEAD
current/behind/diverged vs origin/`<base>`"; `b7e-deliverbase` (also above) already
resolves the *actual* delivery base the way `bin/deliver.js` does. Neither combines
"which ref do I actually deliver into" with "is my branch current against it" in one
call — a caller had to run both and reconcile them by hand — and neither splits a
branch's own commits into **authored-here** vs **cherry-picked in from another branch's
stranded work** — a branch with one commit of its own plus one cherry-picked in from
another session's stranded branch is the shape that prompted it. That split
matters because a merge later resolves against the branch's own work, not against a
patch it already got credit for landing once.

**The base is resolved exactly the way a real delivery would resolve it**, with no
network call of its own: the workspace is inferred from where this is run —
`mainCheckout` normalises a worktree back to the checkout `ownWorkspace`
(`lib/deploy.js`) can actually match, the same two-step `bin/beadcause-changes` already
takes — and `baseFor` (`lib/prbase.js`) resolves that workspace's real base, the same
call `b7e-deliverbase` makes. An unresolved workspace (no config on this Mac, or more
than one and none of them this checkout) falls back to the literal `main`, `b7e-base`'s
own standalone default. `-w` names a workspace directly and skips the inference; `--base`
overrides both with a literal ref, never asked of GitHub, the same override
`bin/deliver.js` itself takes.

Reports one block: the branch, the resolved base and its sha, and whether HEAD is
**current**, **behind**, or **diverged** against it — `b7e-base`'s own report, against a
base resolved `b7e-deliverbase`'s way, fetching `origin/<base>` first for the same reason
both tools already do: a local branch can carry commits nobody has pushed, or miss ones
somebody else has, and only fetching first tells the two apart. Then, for this branch's
own commits, a **provenance** split: each is `[authored-here]` or `[cherry-picked from
<sha>, by trailer]` (a `(cherry picked from commit …)` trailer — what `git cherry-pick
-x` leaves) or `[cherry-picked from <sha> on <branch>, by patch-id]` (no trailer, but the
identical patch exists on some other local branch — a cherry-pick made without `-x`, or a
manual re-application). The file list reported alongside it is `git diff --name-only
<base>...HEAD` — the identical three-dot invocation `bin/deliver.js` runs for its own
diffstat, so what this reports as "what will land" is never a second opinion that could
drift from what a delivery actually pushes.

**`--reset`** fast-forwards once `behind` is confirmed safe: nothing of this branch's own
would be discarded (`ahead === 0`) and the working tree is clean (nothing uncommitted
would be silently carried into the merge). It refuses a dirty tree or a genuine
divergence rather than guessing what was meant, and reports exactly why. `--no-provenance`
skips the patch-id scan (the cheap trailer check still runs) for a caller that wants the
base comparison alone without paying to walk every other local branch's history for a
match.

Exit codes: `0` current (or a `--reset` that landed one), `1` behind or diverged, `2` bad
usage, not a git checkout, or a `--reset` that cannot be done safely. Built on the same
`lib/gitref.js` primitives as `b7e-base` and `b7e-deliverbase`, plus `git patch-id` for
the provenance split. Read-only without `--reset` — but the flag can fast-forward the
checkout, so this is a *conditionally*-write tool, the same shape `b7e-apply`, `b7e-take`
and `b7e-swbump` are, and it carries `@grant excluded` for the same reason theirs do: the
allowlist cannot see which argv a caller is about to pass, so it is deliberately left off
rather than trusted read-only.
