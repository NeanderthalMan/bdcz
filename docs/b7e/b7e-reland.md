### Land a branch that never reached `main` onto today's `main`, one method, downmerges set aside — `b7e-reland`

`bc-dgx7.199` names four sessions (`bc-ka5y.51`, `bc-dgx7.185`, `bc-dgx7.186`, `bc-dgx7.187`)
that each answered a `lib/notinmain.js` "land it" card for a branch 1,100–1,700 commits behind
`main`, and each used a different method: a cherry-pick with the conflicts resolved in scratch
Python; a cherry-pick, then `--abort`, then `git apply --3way`; `git merge --squash`; `git merge
--no-commit`. None could ask in advance what its method would leave the notinmain sweep seeing,
so each re-derived it, and one clean merge silently reverted a newer comment from `main` and
was caught only by reading the diff. This is the one method.

```
b7e-reland <branch> --dry-run                 what landing it involves; writes nothing
b7e-reland <branch> --how merge|squash|pick   land it in this (clean) worktree
b7e-reland <branch> --bead <id>               name the closed bead in the commit message
b7e-reland <branch> --base main --dir <root> --json
```

Run it from a fresh worktree off `origin/main`. **Before any write** (and with `--dry-run`, only
that) it reports:

- the branch's commits split into **real commits** (oldest first), **downmerges** (merge
  commits that brought `main` in — second parent already on `main`, or a subject saying so) and
  real commits whose patch `main` **already has** under another sha (`git cherry`, the same
  question `commitsUpstream` in `lib/notinmain.js` asks);
- how many commits the branch is behind `main`, and every pull request for it with its state;
- a `git merge-tree --write-tree` preview: the files that would **conflict**, the files both
  sides touched that merge clean, and any of those that merge clean yet **drop a line `main`
  added** since the merge-base — the quiet failure `bc-dgx7.185` hit.

`--how` picks what the sweep will see afterwards, and the report says so for all three:

| `--how` | what it does | what the notinmain sweep sees |
|---|---|---|
| `merge` | `git merge --no-ff` of the tip | the old tip is an ancestor of `HEAD`; the card clears by itself |
| `pick` | `cherry-pick -x` of the real commits only | clears only if every real commit was picked |
| `squash` | `git merge --squash`, one commit | still sees the old tip as unmerged; close its card by hand |

A clean landing is committed (`<bead>: land <branch> onto main`). A conflicted one is left in
progress, the conflicted files are named, and the command exits `1`: resolving is judgment and
stays with the session. It refuses (exit `2`) a tree that is dirty or not on `main`, an unknown
branch, or a bad flag.

It is deliberately `@grant excluded`: unlike the read-only `b7e-landed` it writes the working tree
and makes commits. `--dry-run` is the read half. `lib/reland.js` is the library and `bin/b7e-reland`
is argv and printing; `test/reland.mjs` proves it against real git repos.
