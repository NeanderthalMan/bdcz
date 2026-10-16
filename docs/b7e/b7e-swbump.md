### Which number a sw-cache bump takes, and the renumber a downmerge forces — `b7e-swbump`

`test/swbump.mjs` (above) answers *whether* a branch owes a bump. Nothing answered
*which number*, wrote the note, or resolved the add/add conflict a downmerge routinely
produces — and `bc-khoe.44`'s session audit found three sessions doing that by hand,
three different ways, none of them the same: `bc-khoe.23` grepped `const CACHE` and
copied `docs/sw-cache/v69.md`'s shape by eye; `bc-khoe.26` used `sed` on the same line;
`bc-ka5y.15.3` hit the real conflict and got the number wrong the first time, taking
`v78` because a *sibling worktree on the same Mac* held an unmerged `v77` — evidence
about nothing but that Mac, since the number is a property of `origin/main`, not of any
worktree sitting beside this one.

```
b7e-swbump                  bump if this branch owes one, against origin/main
b7e-swbump --check          print the verdict, write nothing
b7e-swbump --against <ref>  compare against <ref> instead of origin/main
b7e-swbump --renumber       resolve an unresolved add/add on a sw-cache note
```

The default mode only ever auto-bumps on `lib/swbump.js`'s one non-judgement signal —
a member gained in one changed shell file and called from another, unbumped, which is a
`TypeError` and not an opinion. The advisory cases (two shell files merely both changed,
a named style pair, a guarded script tag) are reported and left alone: `lib/swbump.js`'s
own header is explicit that the reader still judges those, and a command that bumped
over an additive change that owed nothing would be worse than not having it. When a
bump is owed, the number is read out of `--against`'s own tree — `git ls-tree
<ref> docs/sw-cache` — never out of the working directory, which is what keeps a
sibling worktree's unmerged note from ever being mistaken for a claim again. The note
it scaffolds carries `lib/swbump.js`'s own `report()` lines as its argument, because the
pairing that made the bump owed is already known, in prose, before the command is ever
run.

`--renumber` is the other half: run inside an unresolved add/add on
`docs/sw-cache/vNN.md` (a downmerge that met a note already claiming the same number on
`origin/main`), it keeps the incoming note — already reachable through the tracked
history — at its number, moves this branch's note up to the next free one, appends the
`## The number` section the convention already carries (`docs/sw-cache/v81.md`,
`v98.md`), retargets `const CACHE`, and stages all three paths. It assumes the ordinary
downmerge direction — `origin/main` merged *into* this branch, so git's "ours" is the
note staying on this branch and "theirs" is the one already on `origin/main` — and does
not try to detect a rebase, which flips that; resolve a rebase's add/add by hand.

Not on `DEFAULT_TOOL_LIST`, for the `b7e-apply` reason rather than
`b7e-gate`/`b7e-blame`'s: it writes to whatever checkout it runs in, with no branch of
its own and no path to commit or review the result, and `dispatch` — the one agent that
list governs — has no oversight loop to catch a bad write.
