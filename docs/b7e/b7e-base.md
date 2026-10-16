### Is this branch based on current main, and what has landed under it since — `b7e-base`

`bc-36xx.25` is the session audit agent naming a fifth question nine sessions each
answered by hand, in five different shapes, at the top of nine separate worktrees.
Seven of the nine never fetched first, so whatever ref they compared against was as
stale as the last time some *other* session happened to fetch — invisible, because a
stale ref still prints a sha. `bc-bmry.8`'s is the sharpest failure: `git log --oneline
-1 main` reads *local* `main`, which can carry commits `origin/main` has never seen,
and it printed "Good, up to date" over a branch that was nothing of the sort. Two
sessions (`bc-ywiy`, `bc-khoe.18`) reinvented the right three-command form on their own,
hours in, at delivery time rather than at the start — a real `git fetch`, a `merge-base
--is-ancestor` check, and a `diff --stat` against what had landed. Neither wrote it
down; the other seven never ran it.

```
b7e-base                  fetch origin/main, compare HEAD against it
b7e-base --base develop   compare against a ref other than the repo's default
b7e-base --no-fetch       skip the fetch — use whatever origin/<base> already is
b7e-base --json           one object on stdout, for a caller
```

One block: the branch, the merge-base, and whether it is **current** (nothing has
landed on the base since the fork point), **behind** (only the base has moved — this
branch has no commits of its own yet) or **diverged** (both sides do); the subjects of
the commits that landed on the base since the fork; and — the part none of the nine
sessions computed by hand — the intersection of the files those commits touched with
the files this branch's own commits touch, because that overlap is what a merge later
actually has to resolve. Exits `1` when behind or diverged, `0` when current, so it
doubles as a gate check.

**Always the fetched remote, never the stale local ref.** Unless `--no-fetch`, this
fetches `origin <base>` first; the comparison then prefers `origin/<base>` over a local
`<base>` whenever both exist, so a local-only commit on `main` — present in this
checkout, never pushed anywhere — is never read as something that landed. That is the
`bc-bmry.8` failure, reproduced and fixed: `test/b7ebase.mjs` clones a real `origin`,
commits directly onto the clone's local `main` without ever pushing it, and asserts the
tool still reports the branch as current rather than behind.

**The default `--base` is the literal `main`, not a call to GitHub.** `lib/pr.js`'s
`defaultBranch` asks GitHub because a delivery has to land in the branch GitHub
actually merges into, and `refs/remotes/origin/HEAD` goes stale in a way that has
burned real repos there (three of forty-seven Northwind checkouts disagreed with
GitHub when it was last measured). This is a cheaper, far more frequent question, asked
at the top of nearly every session before there is anything to deliver; a repo whose
integration branch is not `main` says so with `--base`, the same way `bin/deliver.js`
lets a delivery override it.

Built directly on `lib/gitref.js`'s `git()`/`gitCode()` — the same identity-stamped
runner `lib/sessionlog.js` and `lib/commonrepo.js` already share — rather than a new
module, because everything this needs (`fetch`, `rev-parse`, `rev-list`, `merge-base`,
`diff --name-only`) is already exactly what that file wraps. Read-only in the same
sense as `b7e-siblings` just above: nothing here writes a ref, a commit or a working-tree
file, which is what put `Bash(b7e-base:*)` straight on `DEFAULT_TOOL_LIST` in
`lib/toolbelt.js` and `read` in `lib/grants.js` beside it.
