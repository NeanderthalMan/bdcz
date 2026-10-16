### Is this command name free — in bin/, on main, in an open PR, in a live worktree, and in the tracker — `b7e-taken`

`bc-dgx7.135`, filed by the session audit against four sessions (`bc-dgx7.67`, `bc-dgx7.70`,
`bc-dgx7.73`, `bc-dgx7.66`) that each asked "is this name already taken?" from a different
subset of the places a name can be claimed. `bc-dgx7.67` checked the most of the four — a
`git show` against main, `gh pr list`, `ls bin/`, a toolbelt grep, two sibling worktrees read
by hand — and still missed the one that mattered: the name it had been told to use,
`b7e-covers`, had already been claimed three days earlier by a pull request that was open
and a worktree that was live. It shipped under a different name instead, superseded a bead,
and wrote down the memory that this bead turned into a command.

```
b7e-taken b7e-covers                     check bin/, the registrations, the docs, origin/main
b7e-taken b7e-covers -w beadcause         and the beadcause tracker's open beads too
b7e-taken b7e-covers b7e-dup -w beadcause one verdict per name, in one call
b7e-taken b7e-covers --json               one object per name
```

Seven claim sites, checked the way each one actually has to be to mean anything:

- **`bin/` in the checkout asking** — a plain file check, because the case this exists for
  is a session about to run `Write` on that exact path.
- **`package.json`'s `bin` and `package-lock.json`'s `packages[""].bin`**, as one claim —
  `test/lockfile.mjs` is pinned first in the sweep precisely because the two are meant to
  always agree.
- **A `### ` heading naming it in backticks, anywhere in the specification** — `lib/docset.js`'s own
  `README.md` + `docs/*.md` set, the same one `lib/enroll.js`'s `readmeProblem` reads, so
  this and `b7e-enroll` never disagree about whether a command is documented.
- **`bin/<name>` at the tip of `origin/main`** — the shared truth, not the local `main`,
  which can be ahead or behind it.
- **Every open pull request whose head branch's tip already has the file** — a file check
  on the branch's own tree, not a text search over titles and bodies. A pull request
  opened for an unrelated reason can still be the one that first adds a name.
- **Every live (not retired) worktree whose own working tree already has the file** — read
  off disk, not off the branch's last commit: `two-skill-beads-can-claim-the-same-b7e-name`
  found 457 lines of finished work sitting **uncommitted** in exactly such a worktree,
  invisible to every git-log-based search.
- **Any open bead, in a workspace passed with `-w`, whose title or description names it** —
  word-bounded, and restricted to beads that are not closed, since a closed bead's proposal
  is not a live claim.

**Once a name is already on `origin/main`, the last two checks do not run at all.** Every
worktree in this repo branches from main, so once a name lands there every one of them
technically "has" the file — enumerating all of them as separate claimants would be noise
dressed as several dozen warnings for a question `origin/main` alone already answers.

Exit codes: `0` every name is free. `3` at least one name is taken — every claimant is
still printed either way, so a caller sees what a `0` never needed to show. `2` bad usage.
`4` a named workspace does not exist. `5` a named tracker could not be read at all — the
same distinction `b7e-dup`'s own `tracker()` helper draws between a Dolt lock and "no such
bead", so a lock does not read as "nothing here".

`bin/b7e-taken` declares `@grant read`; every path through it is a filesystem read, a `git
cat-file -e`/`git worktree list`, `gh pr list` through `lib/pr.js`, or `bd list` through
`lib/bd.js` — nothing here opens a pull request, comments on a bead, or touches a worktree.
See `bin/b7e-taken`, `lib/taken.js` and `test/b7etaken.mjs`.
