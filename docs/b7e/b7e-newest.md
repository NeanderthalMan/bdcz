### Which ref actually holds the newest version of this path, and what building on it costs — `b7e-newest`

`bc-dgx7.83`, built for a repo with dozens of live worktrees against the same few files:
sessions each had to answer "is the code I need on main yet, or still on somebody's
unmerged branch?" before they could start, each differently — and one got it wrong,
merging a branch cut from a stale main that silently reverted another session's landed
work.

```
b7e-newest -w myproject -- src/lib/ CHANGELOG.md      the survey, then a VERDICT
b7e-newest -w myproject src/lib/ --json                one object on stdout, untruncated
b7e-newest --dir <checkout> --base main src/           a checkout that is not the cwd's
b7e-newest -w myproject --refs origin/x,y -- src/      widen the candidates
b7e-newest -w myproject --all -- src/lib/              also list refs the base has moved past
```

**Candidates** are every live worktree branch, every open pull request head (from `gh`,
which failing empties that half and says why on one line rather than stopping the
survey) and any `--refs`. A branch that is both a worktree and a PR head is one row, and
**the local branch is the one read**: a worktree can hold commits nobody has pushed, and
one session read `origin/<branch>` for one that had moved on. Local `main` is a candidate
too — commits on it that `origin/main` has never seen are exactly work that nobody has
pushed. The base is the delivery base, resolved with `-w` exactly as `b7e-deliverbase`
resolves it (`resolveSessionDir`, `baseFor`), and fetched once, with the PR heads that
have no worktree; `--no-fetch` skips both.

**"Differs from the base" is not "holds the newest version"** — that is the whole of
the stale-main revert above. Each candidate is classified by what each side did *since their merge-base,
on these paths*, by the **net diff** and never by the commit history: `ahead` (the
candidate changed them, the base did not — strictly newer), `diverged` (both did, so
neither is a superset of the other), `behind` (only the base did — the candidate is stale
there), `landed` (an ancestor the base has moved past), or `uncommitted` (nothing
committed, edits on disk). Net diff, because `git log -- <path>` keeps a downmerge of
main into a branch as a "commit on the path" over an empty change — measured on
`b7e-inflight`, where it was the only one. `behind` and `landed` are counted, not listed,
because most of a hundred worktrees differ from the base only because the base moved.

**The verdict names the tip.** Of the `ahead` and `diverged` rows, one that is an
ancestor of another is superseded by it; the survivors are tips, and when there are two
unrelated ones the verdict says so and names both rather than crowning the newest by
clock. Its cost is three numbers, because they are three different mistakes: the files
it changes **outside** the paths (a merge brings all of them in), the files the **base**
changed since it forked (taking its tree wholesale — `reset --hard`, `checkout <ref> --
.` — silently drops these, which is that revert, computed before the merge
instead of after), and the files **both sides** changed (what the merge has to resolve).
Uncommitted edits are listed per worktree and never enter the verdict: they are not a
ref anyone can build on, only a reason to go and ask.

Exit codes: `0` the base holds the newest committed version, `1` some other ref does —
read the verdict before building on the base — `2` bad usage, an unknown workspace, an
absolute path outside the checkout, or a base that exists nowhere. Everything after a
literal `--` is a path, `--help` included, and `--json` is written with an exit code set
rather than `process.exit`, so a long object on a pipe is never truncated.

Read-only: it fetches and reads, and writes no ref, commit or file, which is what
`@grant read` in `bin/b7e-newest`'s header declares. Distinct from `b7e-base` (one ref,
no paths), `b7e-deliverbase` (which base, no content), `b7e-siblings` (who is touching
these files — the candidates, with nothing about content, ancestry or cost) and
`b7e-peek` (one named worktree, right now, uncommitted work included). The logic lives in
`lib/newest.js`.
