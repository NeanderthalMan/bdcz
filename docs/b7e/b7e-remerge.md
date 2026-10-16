### Re-queue a stale merge card — `b7e-remerge`

`bc-dgx7.191`. Four loremia sessions (`lm-4o63`, `lm-wj70`, `lm-7td5`, `lm-ns2e`) each opened
on a stalled `Merge #N — <work-bead>: …` card (assignee `merge-advocate`, so `bd update
--claim` is refused), found by `gh pr view` and `git merge-tree` that the conflict was already
gone, and then went to re-queue. That is where they split: three re-read `bin/deliver.js` to
learn the answer (deliver the **work** bead, not the card, with `--branch <pr-head>`, because
deliver.js supersedes the open card for that pull request); one ran `bin/merge.js`, was
refused by the classifier as "Merge Without Review", and left the card un-queued. Three also
hit the worktree guard twice before a literal absolute-path `git -C` worked.

```
b7e-remerge -w loremia lm-5i2.200                                   read the card
b7e-remerge -w loremia lm-5i2.200 --merge --worktree /abs/worktree  and merge main into that worktree
b7e-remerge -w loremia lm-5i2.200 --json                            machine-readable
```

**It reads** the card (its `beadpr` block, through `lib/mergebead.js`'s `mergeSpec`), the pull
request's current head, then hands the branch to `lib/prbranch.js` — every copy, which is
newest, which worktree holds it, and a dry-run `git merge-tree` of `origin/main` into the
newest — so the answer is the one `b7e-prbranch` gives and the two cannot drift.

**It prints the delivery**: `node <repo>/bin/deliver.js -w <ws> -b <work-bead> --branch
<pr-head> …`, to run from a worktree whose HEAD contains the remote branch. It never runs it.
A card whose block names no work bead has nothing to deliver against; the command says a
re-queue needs Adam's tap. A pull request that is no longer open is reported as nothing to
re-queue.

**`--merge --worktree <abs>`** merges `origin/main` in that one worktree, and refuses unless
the worktree has the PR branch checked out at the newest copy, is clean, is not mid-merge, is
not the main checkout, and the dry run was clean. It does not push; deliver.js does.

Exit `0` fine; `1` diverged, conflicted or `--merge` refused; `2` bad usage; `4` the
workspace, card or pull request is not there. `test/b7eremerge.mjs`.
