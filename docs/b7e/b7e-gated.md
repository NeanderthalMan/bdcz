### Does a gate run still describe the tree you are about to deliver? — `b7e-gated`

`bc-dgx7.39`, filed by the session audit against four sessions that each launched
`b7e-gate` in the background and kept editing the worktree while it ran, then
delivered the run's verdict as though it still applied. `bc-xl7n.108` started a gate at
suite 62/416, made two more edits to `lib/release.js` and one to `test/release.mjs`
while it ran, then delivered `--tests "all 416 suites passed"` — a run that had never
seen those three edits. `bc-4r10.20` backgrounded the suite, edited `README.md` twice
while it ran, and delivered "420/420 suites green" on it. `bc-4r10.3.2`'s run also
carried a broken `node_modules`, so it re-ran three suites separately afterward and
delivered a verdict assembled by arithmetic across two different trees. `bc-xl7n.110`
is the one that caught it — and only by remembering: "I edited README.md and
`lib/advocate.js` *after* that gate started, so it didn't test what I'm delivering." It
paid for a second full run, roughly 25 minutes, to get a verdict that matched the
commit. `b7e-watch` (just above) can say a run finished green; nothing said which tree
it was green *on*.

```
b7e-gated                 this worktree's most recent gate run vs the working tree now
b7e-gated --run <id>      a specific run, from any worktree
b7e-gated --staged        compare against the INDEX now, instead of the working tree
b7e-gated --json
```

One line back: the run, its state, and whether its own recorded tree still matches —
naming every file responsible when it does not. Exit `0` when it still matches, `1`
when the tree has moved under it (or nothing can confirm it did not), `2` when the run
named, or found for this worktree, does not exist.

**The snapshot is `b7e-gate`'s to write, in the same `start` line `b7e-watch` already
reads.** `lib/gaterun.js`'s `startRun` now stamps `sha` (`HEAD`), `tree` — a single
commit object standing for every TRACKED file's on-disk content at that moment,
computed with `git stash create`, which — unlike `git stash push`/`save` — never
writes `refs/stash`, the ref shared across *every* worktree of this checkout — and
`untracked`, `{ path: contentHash }` for every file git does not track yet, hashed
with `git hash-object` rather than just listed by name. `compareToTree`, beside
`readRun` in the same file, is what asks whether that snapshot still matches: it
diffs the tracked side by content with `git diff --name-only`, deliberately **not**
by comparing the commit shas themselves — two `stash create` calls over an
*unchanged* dirty tree still mint two different commits, because the synthetic "WIP
on ..." commit carries its own timestamp, and a gate is usually run against a tree
that already has local edits in it. Comparing shas would report drift on the common
case, not the rare one. A file touched and then touched back to its original content
reads as unchanged, the same as `git diff` would say — and an untracked file edited
while it *stays* untracked is now caught too, which a by-name-only comparison would
have missed outright, since two untracked snapshots that both simply say "scratch.txt
is there" read as identical regardless of what changed inside it.

**Crossing the tracked/untracked line with the same bytes is not drift** (`bc-dgx7.49`).
It used to read as moved: a file untracked when the run started, later `git add`ed and
committed unchanged — the ordinary next step right after a gate run this command exists
to validate — was named every time, because `tree` only ever captures tracked content, so
that path is simply absent from the baseline and `git diff --name-only` calls it "added"
whatever its bytes are. `bc-dgx7.39` hit this dogfooding the tool on its own delivery, and
it fires on almost every delivery rather than rarely. The untracked half of the comparison
now *nets it out*: a path that left the untracked list is looked up in the new tree, and
when that blob equals the hash recorded at run start the tracked diff's entry is taken
back off — symmetrically for a path that entered it (`git rm --cached`), against the blob
the baseline held. Only the transitions are reconciled, and only on equal content: an
untracked file edited *and then* added is still reported by name.

Netting rather than the merged tree object the bead first sketched — a throwaway index,
`read-tree` + `hash-object -w` + `update-index --cacheinfo` + `write-tree`, so `tree`
covers both halves at once. That route writes to the object store for every untracked file
on every gate start, still needs the tracked-only tree kept for `--staged` (untracked
content is never staged, so a merged baseline diffed against an index tree reads every
baseline-untracked file as removed), and `--cacheinfo` has to name a mode: seeding at
`100644` makes an executable file committed as `100755` diff as a mode change — the same
false positive again, on exactly the file that prompted it, since `bin/b7e-gated` is
`chmod +x`. Blob hashes are mode-blind in both directions and add no state, at the cost of
one batched `git cat-file` per direction.

`--staged` changes only what "now" means — the baseline is always the working tree
`b7e-gate` actually tested, because that is what the suites ran against, but the
comparison can be pointed at the index instead: "if I commit exactly what's staged,
does that still match what was gated?"

**On `DEFAULT_TOOL_LIST`**, unlike `b7e-watch`/`b7e-gate`/
`b7e-blame` just above: it never runs a suite and never calls `runBlame` — the whole
comparison is `git` reads with no working-tree or index side effects (`stash create`,
`write-tree`, `hash-object`, `diff --name-only`, `rev-parse`, `cat-file`) against a run's own
already-written record. That is exactly the read-only shape `b7e-def`/`b7e-owes`/
`b7e-affected`/`b7e-readme` already are, not a lighter version of `npm test`.
