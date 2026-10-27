### Say whether a bead's work is already on `main`, and under whose pull request — `b7e-landed`

`bc-khoe.47` names four sessions (`bc-42ow.4`, `bc-xl7n.55`, `bc-dgx7.5`, `bc-ka5y.15.3`)
that each answered "is this already done on main?" by hand, with a different chain of
`git`/`gh`/`bd` commands — and twice, a scratch worktree built just to check. `bc-42ow.4`
never wrote code: it ran a `git grep` on `origin/main`, a `gh api` call on a guessed pull
request, a `git log --grep` and a `git log -1 --format=%B` to read what that commit's body
named, and finally a throwaway detached worktree in the scratchpad to run suites in. This
is the one answer.

```
b7e-landed <bead-id>              is <bead-id> already on origin/main?
b7e-landed                        no id given — read it off the current branch's own commits
b7e-landed <bead-id> --base main  compare against a ref other than origin/main
b7e-landed <bead-id> --json       one object instead of the printed report
b7e-landed <bead-id> --dir <root> "your tree" is <root>, not this repo's own root
```

**The family, not just the bead.** A dotted id's siblings are found lexically — one dot up
from the id asked about (`bc-42ow.4`'s family is `bc-42ow`; `bc-ka5y.15.3`'s is
`bc-ka5y.15`, not the whole `bc-ka5y` epic) — rather than through `bd`'s live parent/child
edges, because a bead keeps the dotted prefix it was filed under even after being
reparented elsewhere. `git log --grep` is asked once, over the whole family, because a plan
group is routinely delivered as one branch and one commit for two beads: `bc-42ow.3` and
`bc-42ow.4` both landed on PR #435, and `bc-42ow.4`'s own commit search would still find
that commit (its body names both), but the family search is what surfaces the sibling as a
first-class answer instead of a fact buried in a body the caller still has to go and read.

**What counts as landed.** A commit on `base` naming the id, subject or body. Squash-merge
commits in this repo always carry the merging pull request's number as a trailing `(#NNN)`
on the subject, so the number is read off the text rather than asked of GitHub — no network
needed for the common case. The `git log --grep` pattern is POSIX `-E` with a hand-rolled
boundary, `(^|[^A-Za-z0-9])id(...)([^A-Za-z0-9]|$)`, rather than `-P` with `\b`: `-P` needs
`git` built against PCRE, and `-E`'s own `\b` is silently not a word boundary at all in
POSIX ERE — it matches nothing, which reads exactly like "no commits found" and is the
wrong kind of wrong to fail into.

**Finding the branch, when the tag does not spell the id.** `lib/notinmain.js`'s
`ownsBranch` assumes a worktree branch ends in the bead id's own `tagOf` — but in practice a
session picks its own short tag by hand (`bc-khoe.43` became `worktree-b7e-notes-kh43`, not
`…-khoe43`), and `ownsBranch` misses it. A bead `ownsBranch` finds nothing for gets a second
pass: every `worktree-*` branch is checked for a commit of its own, ahead of `base`, titled
`<id>: ...` — reporting "no evidence" about a bead with an open pull request right now is
the one wrong answer this cannot afford.

**What counts as a collision, for an unlanded branch.** Two tiers. Literal: a file both the
branch and `base` have touched since their merge-base. Textual: a file `base` changed that
*names* a file the branch changed, in its own source at `base`'s tip — a file-list diff
cannot see this, and it is exactly what `bc-ka5y.15.3` missed by hand: a file the branch
wrote, never touched by `base` directly but read by something `base` changed, so a suite
went red on a conflict no name-only diff shows.

Verdicts: `landed` (a commit on `base` names it directly); `superseded` (closed with a
`superseded-by:` marker — `supersededLanded` says whether *that* id's own family search
finds a landing, so superseded never has to be read as "therefore landed" or "therefore
lost"); `unlanded` (a branch of its own exists, ahead of `base`, with no commit naming it
there — the collision check runs, and an open or merged pull request GitHub knows about
that git alone did not resolve is named too); `no-evidence` (no commit, no supersede
marker, no branch — said plainly, not an empty list that reads like a failed lookup).

Exit codes: `0` the work is on `base` (directly, or via a superseding bead that is itself
landed); `1` it is not; `2` refused — bad usage, or neither `origin/<base>` nor `<base>`
resolves in the tree asked about.

`lib/landedcheck.js` is the library, `bin/b7e-landed` is the argv parsing and the printing.

Not on `DEFAULT_TOOL_LIST` in `lib/toolbelt.js`, for the `b7e-worktree`/`b7e-eyeball`
reason rather than a write: its whole occasion is a worker session deciding, at the start
of a window, whether the bead in front of it already landed — a worktree branch to check,
a bead id already in hand. `dispatch` has none of that: no branch of its own,
`ownsRepo: false`, one phone comment to answer with one `bd comment`. It also asks GitHub
(`gh pr list`), which `lib/grants.js` does not classify as free the way a filesystem read
is; a worker session already has the unrestricted CLI default and loses nothing by this
staying off the narrower list.
