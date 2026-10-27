### What this branch actually ships, and whether the delivery will be refused — `b7e-shipcheck`

`bc-khoe.27.10` is the sixth finding [the audit agent](../advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work)
filed against the same shape breaking repeatedly rather than once: five sessions
(`bc-khoe.27.5`, `bc-fh0sz`, `bc-xl7n.109`, `bc-gdub`, `bc-khoe.27.7`) each ended by
asking "what does my branch change against main", with a different git incantation
every time, and in a fresh worktree the first guess is often empty — `bc-gdub.1` ran
`git diff main...HEAD --name-only`, got nothing, and fell back twice more before
`git status --short` told it the truth. Two of the five then hit `bin/deliver.js`'s own
refusals — main-into-main, and a dirty tree — only *after* the delivery summary had
already been written, one of them into a file sitting untracked in the very worktree it
was about to describe as clean.

```
b7e-shipcheck                 this checkout, against origin/main
b7e-shipcheck --base <ref>    against origin/<ref> instead
b7e-shipcheck --dir <root>    a different checkout, not this process's cwd
b7e-shipcheck -b <bead>       name a bead in the printed header (cosmetic only)
b7e-shipcheck --json          one object instead of the printed report
```

**The base is a merge-base against a freshly fetched `origin/<base>`, never a bare
`main...HEAD`.** That bare form is exactly what answered empty for `bc-gdub.1`: a fresh
worktree's local `main` ref is whatever this checkout's object store last happened to
see, and a three-dot diff against a *stale* local ref can read as "nothing to ship" over
a branch that plainly has commits of its own. `lib/shipcheck.js`'s `resolveBase` fetches
`origin/<base>` first and takes its merge-base with `HEAD` — the same freshness
`bin/deliver.js` itself relies on a few lines before its own ahead-count — and falls
back to a local `<base>` branch only when there is no `origin` remote to ask at all.

**The verdict is `bin/deliver.js`'s own three guard clauses, transplanted verbatim, in
its own order and its own wording**, not a paraphrase of them: a detached `HEAD`; a
branch that already *is* the base (`refusing to open a PR from X into Y — the work
should be on its own branch`); and a working tree `git status --porcelain` names
anything in at all (`the worktree has uncommitted changes — commit them first, they are
not in the PR:`, followed by every path, staged or not). Reading the identical sentence
here that the real refusal would print is the point — a session that sees it before
writing its summary loses nothing by fixing it first.

**What this does not check.** It does not replicate `lib/conflicted.js`'s
`inspectBranch` — a committed merge-conflict marker, or a commit that no longer parses
— which is a check on the committed blobs `bin/deliver.js` runs after these two, and a
different question from "what does this branch ship and is the tree clean enough to
ship it". It never pushes, opens anything, or calls `gh`; every read is local, so
running it costs nothing and changes nothing.

Exit codes are a linter's: `0` when `bin/deliver.js` would not refuse on these grounds,
`1` when it would (a detached `HEAD`, branch-equals-base, or an uncommitted path
anywhere), `2` when the base cannot be resolved at all (no such ref, locally or on
`origin`) — a usage problem, not a verdict.

Read-only by construction, in the same sense `b7e-def` and `b7e-owes` are — every path
through it is a `git` read, never a write — which is what put `Bash(b7e-shipcheck:*)` on
`DEFAULT_TOOL_LIST` in `lib/toolbelt.js` beside them.

