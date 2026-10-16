### Every surface a printed figure appears on, and whether they agree — `b7e-where`

`bc-dgx7.16`: six sessions in a repo whose figures appear on many surfaces each answered
"where is this figure written, and does every surface agree" by hand. Four opened with an
unquoted `--include=*.py` that zsh glob-expanded into `(eval):1: no matches found` before
`grep` ever ran; one had to search both `16x9` and `16×9`, because two documents spelled
the same figure two ways — exactly how a real defect hid.

```
b7e-where <text>                hits under source, docs, tests and served markup, the
                                  registered audit-doc row (if any), and a verdict
b7e-where <text> --json         the same, as one JSON object
b7e-where <text> --dir <root>   run against another tree — this is how it is tested
b7e-where <text> --regex        treat <text> as a real RegExp instead of a literal
```

It never shells out to a system `grep` — the same defence `lib/repogrep.js` (`b7e-grep`)
and `lib/cites.js` (`b7e-cites`) already documented for the same reason — so there is no
`--include`/`--exclude` glob for a shell to reparse in the first place, and `<text>` is
matched as a literal by default, not a pattern. `<text>` is normalised so `x`, `X` and `×`
all match each other, the one figure-spelling problem the bead itself names: a query for
`1920x1080` finds a `1920×1080` line and vice versa, with no second call.

**The surface list is not a fixed set of directories, unlike `b7e-grep`/`b7e-cites`.**
Those two intentionally only ever search *beadcause's own* `lib`/`bin`/`test`/`scripts`/
`public`/`android` — `bin/` of the main checkout is on every session's `PATH` regardless
of which repo it is actually sitting in, so this one has to work from inside any other
repo, on its own tree. The four surfaces are classified by convention, checked
in this order: a path under a `test`/`tests` directory (or named `test_*.py`/`*_test.py`/
`*.spec.*`) is **tests**, whatever its extension, because a fixture belongs with the
other tests rather than with the docs or markup it happens to resemble; a `.md`/`.rst`
file is **docs**; an `.html`/`.htm` file, or anything under a `static`/`public`/`pages`/
`templates`/`views` directory, is **served markup**; everything else is **source**. Root
is resolved from `process.cwd()` via `git rev-parse --show-toplevel`, never from where
this script itself lives on disk (see the memory note this is built against,
`a-worktree-aware-bin-resolves-root-from-cwd-not-here`) — the same reason a worktree's own
uncommitted edits are searched too: the file list is `git ls-files -z --cached --others
--exclude-standard`, which honours whatever `.gitignore` the target repo already has with
no exclusion list of our own to keep in sync, and falls back to a small fixed-skip-list
walk only when the root is not a git repository at all.

**The audit-doc row.** A docs file with `audit` in its name (say, `docs/number_audit.md`)
is treated as the registered ledger for "does this figure agree" — its matching
lines print under their own heading, in addition to counting toward the `docs` surface,
so the one file that is supposed to already answer the question is never buried among
however many other doc hits there are.

**The verdict is presence, not a value comparison** — the same "good enough to replace
the hand grep, not a substitute for reading the file" tradeoff `b7e-def`'s own doc
comment makes. It names which of the surfaces that actually exist in this repo have a
hit and which don't (`1920x1080 found in source, docs, tests — not in served markup`); it
cannot tell you a value printed on two surfaces disagrees, only that one surface never
mentions the figure at all — which is nonetheless how several of the six sessions' real
defects first showed themselves.

Read-only by construction — `git ls-files`/`fs.readFileSync` and nothing else, never a
write or a shelled-out `grep` — which is what put `Bash(b7e-where:*)` on
`DEFAULT_TOOL_LIST` rather than behind an elevation; `lib/grants.js`
classifies it `read`.
