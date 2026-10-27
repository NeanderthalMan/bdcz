### Where this bead's work actually is — trunk, branch, PR, or nowhere — `b7e-trace`

Four sessions (`dv-3rn.2`, `dv-nsy`, `dv-gr6.36`, `dv-gr6.45`) each had to answer "has this
bead's work landed, and if not, where is it" and each built the answer out of git plumbing:
`git log --grep` per bead, a script scanning tracked file bodies for ids, a loop over every
local branch, a `gh pr list`. `dv-3rn.2` did it for 57 beads at once, after finding that the
studio board's `ruled_not_evidenced()` matches trunk *commit messages* only — which is why it
over-reports. `b7e-landed` answers one bead against trunk commits; this goes bead → refs.

```
b7e-trace <bead-id>...        where is each bead's work
b7e-trace --label <label>     every bead carrying the label (closed ones included)
b7e-trace --stdin             ids from stdin, whitespace separated
b7e-trace ... --trunk <ref>   a trunk other than main (origin/<ref> first)
b7e-trace ... --no-pr         do not ask GitHub (in-review then reads as on-branch)
b7e-trace ... --json          one object instead of the report
b7e-trace ... --dir <root>    read <root>, not this repo
```

**Verdicts.** `landed` — trunk has a commit naming the bead, or (`via file`) a tracked file
naming it and no commit does; the second is weaker and is printed as such. `in-review` — not
on trunk, but an open pull request is for a branch carrying it or names it in its title or
body. `on-branch` — only on unmerged branches, which are named. `uncited` — nothing names it.

**What it reads that `b7e-landed` does not.** Tracked file contents on trunk (`git grep`) and
what every unmerged branch *added* naming the bead (`git log -G`), so a bead cited only in a
file body is not reported uncited. Every local and `origin/*` branch, not the worktree's own.
Batch: all ids go to git as one alternation and hits are attributed afterwards, so a batch
costs a handful of git calls, not a handful per bead. A dotted child (`bc-1.10`) is never read
as its parent (`bc-1.1`). `.beads/` and `.claude/` are not searched — the tracker mirror
names every bead.

**A limit.** `git log --source` reports only the first ref that reached a commit, so a bead
on two branches names one of them; `git branch -a --contains <sha>` shows the rest.

Exit codes: `0` every bead is `landed`; `1` at least one is not; `2` bad usage, or the trunk
does not resolve.

`lib/trace.js` is the reading, `lib/refs.js` the git helpers it shares, `bin/b7e-trace` the
argv parsing and printing.

Not on `DEFAULT_TOOL_LIST`, for the `b7e-landed` reason: it asks GitHub, which
`lib/grants.js` does not count as free like a filesystem read, and its occasion — a worker
deciding whether a bead's work exists — has a branch and worktree that `dispatch` does not.
