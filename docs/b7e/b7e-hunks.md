### Every conflict hunk in the working tree, addressable, with both sides — `b7e-hunks`

`bc-dgx7.78` names three loremia sessions (`lm-3rn.1`, `lm-b5d.14`, `lm-gr6.43`) that each
spent most of a run resolving merge conflicts one hunk at a time, each inventing its own
enumerator. `lm-3rn.1` judged 118 hunks across seven stranded branches with at least four
different listings — an `awk '/^<<<<<<< /{f=1} f{print NR": "$0} /^>>>>>>> /{f=0}'`, the
same with `substr($0,1,220)` once a hunk was too wide, `grep -n '^<<<<<<< HEAD|^=======$|^>>>>>>> '`
for line numbers, `grep -rc '^<<<<<<< HEAD' . --exclude-dir=.git | grep -v ':0$' | sort
-t: -k2 -rn` to rank files — one listing overflowed the output cap at 124.7KB and was
persisted unread — then resolved each with a dozen separate `re.subn` heredocs, one per
file, per side. It also left `git add -A` having staged a file with markers still in it,
because `git add` marks a conflict resolved by touching the file, not by reading it — the
same failure `lib/conflicted.js`'s own committed-conflict-marker check exists to close off
in the other direction (after a commit, rather than before staging). `lm-b5d.14` and
`lm-gr6.43` did smaller
versions of the same thing. Nobody was asking for automatic resolution — which side wins
is the judgement, and it stays exactly that here; what was retyped every time was the
enumeration, the safe printing of a wide hunk, and a take-a-side edit that does not leave
a marker behind.

```
b7e-hunks                                    list every hunk, grouped by file, ordered
                                              by hunk count
b7e-hunks <file>#<n>...                      print one or more hunks in full
b7e-hunks --take ours|theirs <file>#<n>...   replace named hunks with the chosen side —
                                              all ids validated before anything is written
b7e-hunks --stage [<file>...]                git add whatever has zero markers left;
                                              refuses (does not stage) anything that still
                                              has one
b7e-hunks --dir <root>                       resolve against <root>'s repo, not the cwd's
b7e-hunks --width <n>                        truncate a printed line to <n> chars (default
                                              200) — the `substr($0,1,220)` workaround,
                                              built in
```

Discovery is git's own unmerged-file list — `git diff --name-only --diff-filter=U`, the
same set `git status` reports as `UU`/`AA`/`DD` — rather than a full-repo grep for
`<<<<<<<`: this repo's own README is 600KB of Markdown, and `lib/conflicted.js` already
documents why a bare `=======` is not safe to grep for on its own (it is a real setext
`<h1>` underline). A hunk is still found purely structurally — `<<<<<<<` → an optional
`|||||||` diff3 base section → `=======` → `>>>>>>>` — so that hazard never reaches the
parser: it only looks for a separator once a real `<<<<<<<` has opened. A hunk's id is
`<file>#<n>`, numbered by its position among the hunks *currently* in that file —
resolving one hunk renumbers the ones after it in the same file, since there is genuinely
one fewer hunk above them now, so `--take` accepts every id for a file in one call rather
than one id per call across several.

`--take` is all-or-nothing across the whole batch, the same shape `b7e-apply` uses for the
same reason: every id is checked to name a real hunk, in every named file, before a single
byte is written: an id that does not resolve stops the whole batch there, naming every bad
one, with nothing written anywhere — including files whose other edits would have resolved
cleanly. Edits to one file are applied bottom-up so replacing one hunk never shifts the
line numbers of another hunk in the same file still waiting to be applied, and a hunk not
named in the batch is left byte-for-byte untouched. `--stage` reuses `markersIn` from
`lib/conflicted.js` — the exact detection the committed-conflict-marker check runs, not a
second implementation that could disagree with it — so a file is only ever staged once it
is provably marker-free; the lm-3rn.1 failure is refused rather than silently repeated.

Exit codes: `0` no conflicts remain, anywhere in the working tree, after whatever this run
did; `1` conflicts remain; `2` refused — bad usage, an id not shaped like `<file>#<n>` or
naming no real hunk, or the target is not a git repository. See `lib/hunks.js`.

Write-shaped — `--take` and `--stage` edit and stage files in the working tree directly,
not a throwaway scratch copy — so, like `b7e-apply`/`b7e-commit`/`b7e-at`, it is not on
`DEFAULT_TOOL_LIST` and carries no `lib/grants.js` classification.
