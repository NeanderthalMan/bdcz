### Will this branch and a sibling actually merge, and does the result still pass — `b7e-premerge`

`bc-dgx7.52` is the session audit agent naming a sixth shape of the question `b7e-siblings`
just above answers only half of: knowing a sibling is on the same file is not knowing
whether the two of you will actually merge. Three sessions on 2026-08-24 hit real
collisions and each resolved "does this merge?" a different way. `bc-3rjan` did the whole
thing by hand — `git merge-tree --write-tree HEAD <branch>`, `git show <tree>:<file>` to
read the conflict markers back out, a `sed`/python heredoc to resolve them, then `cp` the
result over its own working copy to run the suite, eleven calls with the trial running
*inside* the branch it was about to deliver. `bc-dgx7.37` asked only after it had already
committed, discovering a collision it could no longer avoid rather than one it could still
plan around. `bc-dgx7.41` was told twice by the claim guard's own refusal message and did
nothing with it.

```
b7e-premerge                              every colliding worktree lib/siblings.js finds
b7e-premerge --against <branch|worktree>  a specific counterparty, repeatable
b7e-premerge --bead <id>                  the files that bead declares, instead of this branch's own diff
b7e-premerge --tree                       also extract each merge under os.tmpdir()
b7e-premerge --json                       one object per counterparty, for a caller
b7e-premerge --dir <root>                 another tree — this is how it is tested
```

One block per counterparty: `clean`, with the merged tree's oid, or `conflicted`, with
each conflicting path's line range and a few lines of context read straight off the
merged (marker-laden) blob — the same rendering `lib/regions.js` gives a claim refusal.
Exits `0` when every counterparty merges clean, `1` if any conflicts or names a ref this
could not resolve at all, `2` for bad usage.

**`git merge-tree --write-tree` never touches the caller's working tree or index.** That
is the entire point of the plumbing `bc-3rjan` reached for by hand: it computes the merge
of two commit-ish refs and writes the resulting tree straight into the object database,
the same way `lib/gitref.js`'s `hashObject`/`commitToRef` write a session's own ref
without a checkout ever happening. Nothing here runs `git checkout`, `git merge` or `git
stash` — `test/premerge.mjs` asserts the caller's worktree is byte-identical before and
after every call, including the one that finds a conflict.

**Discovery reuses `lib/siblings.js` rather than re-implementing it.** With no
`--against`, the counterparties are whichever live worktrees `siblingsFor` already finds
touching the files this branch has changed since `main` — committed and uncommitted
alike. `--bead` swaps in a bead's declared files for that same survey, mirroring
`b7e-siblings`' own `--bead` exactly; `--against` skips discovery and merges against
exactly the refs named, resolving a worktree path to its branch the same way
`lib/siblings.js` reads `git worktree list --porcelain`.

**`--tree` replaces, never accumulates.** `git archive <tree> | tar -x` unpacks the
merge's content — conflict markers baked in where there are any — into a directory under
`os.tmpdir()` keyed by the two ref names, so a second call for the same pair overwrites
rather than piling up. `node_modules` is symlinked in from the caller's own checkout,
never copied — the same borrow `bin/b7e-worktree` and `lib/blame.js`'s
`makeMainWorktree` already do for a granted read tool — so `node test/<suite>.mjs` runs
there without the caller linking anything, which is what `bc-3rjan`'s manual `cp` back
into its own working copy was standing in for.

Granted on `DEFAULT_TOOL_LIST` despite writing: the write lands only in the object
database (never a working tree or index) and, with `--tree`, a scratch directory outside
the repo — never the repo itself, and nothing here spawns a long-running process the way
`b7e-gate`/`b7e-blame` do, which is the actual reason those two are withheld. `lib/premerge.js`
does the simulation; `bin/b7e-premerge` is the argv shell around it, same split as
`bin/b7e-siblings` and `lib/siblings.js`.
