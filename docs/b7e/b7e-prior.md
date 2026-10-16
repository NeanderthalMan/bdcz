### Has somebody already done this, or where is it sitting — `b7e-prior`

`bc-zjab.10`. Four sessions independently asked "has somebody already done this, or part
of it?" and each built the answer out of a different tool set. `bc-zjab.1`'s second
session guessed a worktree name, then ran `git status --short`, `git rev-parse
--abbrev-ref HEAD`, a remote check, `gh pr list` and `git diff main...HEAD --stat` —
most of a session's first phase — before concluding attempt 1 had written the whole
change, committed twice, never pushed, opened no pull request and left no comment
saying so. `bc-5e85` was told by its own bead to wait for `bc-1eru`; instead it ran four
more calls and found `bc-1eru`'s own pull request naming `bc-5e85` in its *body* as the
thing it does **not** fix — so the work was owed after all, and `--head` alone could
never have found that, since it never reads the text. `bc-y3qk.4` asked the same
question of its family with a third tool set, and its one hit was a worktree already
moved into the attic.

```
b7e-prior -w beadcause -b bc-zjab.10             the printed report
b7e-prior -w beadcause -b bc-zjab.10 --family    also check every other child of its tracker parent
b7e-prior -w beadcause -b bc-zjab.10 --json      the same facts, machine-readable
```

**This is not `b7e-landed`, which answers "is it on `main`".** Every case above is work
that is *not* on `main`: unpushed commits on a live branch, an open pull request, a
retired worktree, a sibling's branch. `b7e-prior` says what exists and leaves the
verdict to the reader — a branch naming a bead is not proof the work is missing (this
repo carries dozens of unmerged branches, most of them superseded by a sibling's merged
pull request), and a worktree naming it is not proof the work is done.

**One block per bead, four kinds of evidence**, each read off the ground truth rather
than off anything a bead's own prose claims: every worktree — live *and* retired — and
every branch owning the bead's tag (`lib/notinmain.js`'s `ownsBranch`, the one rule the
whole repo uses to say a branch belongs to a bead), with whether it is pushed and how
far ahead of `main`; every commit on any ref naming the bead (`git log --all
--extended-regexp --grep=…`, word-bounded, re-checked in JS with `lib/reap.js`'s
`namesBead`); every pull request that is either on one of those branches or names the
bead in a title or body a plain `--head` lookup would never reach.

**`git worktree list --porcelain` already answers "live or retired" in one call**, and
that is the reuse this is built on rather than a second command against the attic.
Retiring a worktree is `git worktree move`, not `remove` — a retired entry is still a
registered worktree, only under `.claude/worktrees-retired/` instead of
`.claude/worktrees/`, so the two are told apart by a path prefix and nothing else has to
be asked. (A worktree that was fully `git worktree remove`d, or an attic entry old
enough that `lib/tidy.js`'s `expireRetired` has taken it, leaves nothing here to find —
which is the correct reading of "gone", not a gap in this command.)

**Built almost entirely out of `lib/notinmain.js` and `lib/pr.js`, on purpose.**
`tagOf`/`ownsBranch`/`worktreeBranches`/`commitsAhead` were already exported there for
the same branch-to-bead question; `tipOf` and `pickBase` were private and are exported
now because this is the second caller. `lib/pr.js`'s `list(dir, { head })` is the same
call `lib/notinmain.js`'s `githubState` makes, asked once per branch the bead owns.
`list()` gained a `search` option for this bead — `list(dir, { search: '<id>
in:title,body' })` — which is GitHub's own issue-search syntax passed straight through
as `--search`, verified live against this repo: it correctly surfaces PR #488 for
`bc-5e85`, opened for `bc-1eru`'s own branch, entirely from its body text.

`Bash(b7e-prior:*)` is on `DEFAULT_TOOL_LIST` and `read` in
`lib/grants.js`: every path through it is `bd show` (plus `bd export` under `--family`)
and `git`/`gh` reads, nothing that writes anywhere. See `bin/b7e-prior`, `lib/prior.js`
and `test/b7eprior.mjs`.
