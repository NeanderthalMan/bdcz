### A dead attempt's worktree, read from the inside — `b7e-salvage`

`bc-dgx7.134`. `b7e-prior` above says *where* an earlier attempt's work is sitting —
what it cannot say is what is *in* the tree, and four sessions found that out was
usually the interesting half: `bc-xl7n.137` ran a dozen calls (`git status --short`,
`git diff --stat`, four separate `git diff <file>`, a hash-and-resample to guess
whether anyone was still in it) to read a worktree it opened at the wrong path first —
the directory is the slug, the branch is `worktree-<slug>`, and three of the four
sessions this bead was filed over got that wrong on the first try. `bc-dgx7.129` and
`bc-dgx7.67` each read a different worktree the same way, by hand, to decide whether an
earlier, uncommitted attempt was worth keeping.

```
b7e-salvage -w beadcause -b bc-dgx7.134                   the printed report
b7e-salvage -w beadcause -b bc-dgx7.134 --diff            also emit the uncommitted patch
b7e-salvage -w beadcause -b bc-dgx7.134 --diff lib/foo.js scoped to one file
b7e-salvage -w beadcause -b bc-dgx7.134 --json            the same facts, machine-readable
```

**One block per worktree `b7e-prior`'s own `branchesFor` finds owning the bead's tag**,
live or retired: whether anybody is still in it, whether it is frozen, and what sits
there uncommitted.

- **Occupied** means either of two things a lock's boolean alone cannot tell apart: a
  live Claude session whose `cwd` (`lib/claude.js`'s `liveSessions`) is inside it, or a
  lock reason naming a `pid <n>` (`EnterWorktree` writes `claude session <name> (pid <n>
  start <date>)`; a resolver writes `resolver pid <n> #<pr>`) that `ps` still knows
  about — the same rule `~/.claude/hooks/worktree-guard.sh`'s `lock_pid` uses, so a
  session's own tools and this command agree about what "live" means. A lock whose pid
  `ps` no longer knows is the STALE case that hook already prints on every
  `SessionStart` — prunable, and the tree under it may still hold real, finished work
  (see the repo notes `a-dead-attempts-work-is-uncommitted-in-its-worktree` and
  `a-stale-worktree-lock-can-hold-finished-unmerged-work`).
- **Frozen** means unoccupied *and* nothing under the worktree has moved in
  `lib/tidy.js`'s own `QUIET_MINUTES` — the identical threshold the retirement sweep
  already uses for "is anybody using this", exported rather than reinvented, so the two
  do not quietly disagree about what "quiet" means.
- **What is uncommitted** is `git status --short`, so an untracked file a `git log` view
  can never see is on the list same as a modified tracked one.

**`--diff` never touches the worktree it reads.** Tracked changes come from `git diff
HEAD` (staged and unstaged together, against one command); an untracked file's content
comes from `git diff --no-index -- /dev/null <file>`, which reads it into a real,
applicable patch without an `git add -N` — the acceptance criteria for this bead is that
it writes nothing, and staging even provisionally would not be nothing.

**Finding the worktree when its name shares nothing with the bead (`bc-dgx7.173`).** The
`lm-gr6.36` audit sat staged in `entry106-rules23-sweep-p4m`, a tree that names neither
the bead nor its tag. Besides the branch-tag rule, a worktree is now read when:

- `--all` is given (every worktree but the main checkout);
- `--worktree <name>` names its directory *or* its branch (repeatable; `worktree-` prefix
  optional);
- a commit it has off main names the bead id (the commit trail); or
- the bead's own text or comments name its directory or branch.

Each block says `found by:` which rule brought it in. Per file the report carries `+n/-m`
(`git diff HEAD --numstat`; line counts for untracked files), and **staged-only** paths —
added to the index, in no commit — are their own group with counts from `git diff --cached
--numstat`. Each block ends with a `where it is:` verdict — uncommitted in the tree only,
N commits on a local branch only, on `origin/<branch>` with or without a pull request, or
nothing — using `gh` for the PR lookup (`--no-pr` skips it; an unreachable `gh` reads as
"PR unknown", never "no PR"). When every worktree read is clean with nothing off main the
last line is `nothing to salvage — …` and the exit is still 0.

`--patch-dir [<dir>]` writes one whole-tree patch per dirty worktree
(`<bead>-<worktree>.patch`, default a temp dir), including the full text of staged-only
files; it does not touch the tree.

`Bash(b7e-salvage:*)` is on `DEFAULT_TOOL_LIST` and `read` in `lib/grants.js`: every path
through it is `bd show`, `git worktree list`/`status`/`diff` reads, and `ps` on a pid
already named by a lock — nothing that writes anywhere. See `bin/b7e-salvage`,
`lib/salvage.js` and `test/b7esalvage.mjs`.
