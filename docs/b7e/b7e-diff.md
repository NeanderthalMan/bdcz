### What this branch actually delivers, against its own merge base and nobody else's — `b7e-diff`

`bc-dgx7.17` is the same session audit, naming a narrower question five sorrel sessions
(`sp-weu`, `sp-jb1`, `sp-clh`, `sp-j8f`, `sp-6bt.1`) each answered by hand right before
delivering, in five different shapes — `git diff main...HEAD --name-only`, `git diff
--cached --stat`, `git rev-list --count HEAD..main`, a hand-run `git merge-base`. None
of the five would have caught what `sp-weu` needed caught: it squashed with `git reset
--soft main`, and the resulting `git status` carried five files two *other* branches
had already merged into `main` while it worked — sitting there uncommitted and
indistinguishable from `sp-weu`'s own change until a human read every line by eye.
`main` had simply moved past `sp-weu`'s fork point in the meantime.

```
b7e-diff                  merge-base against local main, report the branch's own diff
b7e-diff --base develop   merge-base against a ref other than main
b7e-diff --json           one object on stdout, for a caller
```

Reports: the merge-base sha; whether `--base` has advanced past it and by how many
commits; this branch's own commits since the merge-base; the file list of
`merge-base...HEAD`; and — the part nobody hand-rolled, and the one that would have
caught `sp-weu` without a human noticing — every uncommitted path `git status` names
that belongs to no commit this branch actually made. Exits `1` when that last set is
non-empty, the same gate shape `b7e-owes` uses.

**`--base` is a literal ref, `main` by default, and never fetched.** This asks a
narrower, cheaper question than `b7e-base` (above): not "has the upstream moved" but
"does everything sitting in this checkout right now belong to a commit this branch
actually made" — meant to run against whatever `main` already is in this checkout,
immediately before a delivery, with no network round-trip. `bc-khoe.27.10`
(`b7e-shipcheck`) asks a different question again — whether a delivery will be
refused — and this bead's own decision comment says explicitly the two stay separate
commands rather than folding one into the other.

Built on `lib/gitref.js`'s `git()`/`gitCode()`, the same runner `b7e-base` uses just
above. Read-only in the same sense: nothing here writes a ref, a commit or a
working-tree file, which is what put `Bash(b7e-diff:*)` on `DEFAULT_TOOL_LIST`.
