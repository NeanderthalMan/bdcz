### One deterministic occurrence count for a literal, at a git ref — `b7e-count`

`bc-dgx7.59`: sessions whose beads were about a number in a sentence — "199 occurrences
across 51 files" — each wrote their own counting pipeline, and the pipelines disagreed:
one session measured the same tree three ways and got three different answers, and
another's `grep -rn PATTERN --include=*.md .` was eaten by zsh globbing before it ran.

```
b7e-count Velmora                                  this repo's own checkout, delivery base
b7e-count Velmora "Captain Velmora" Vermola        one count per pattern, in the order given
b7e-count -w myproject --ref origin/main Velmora   another workspace's checkout, a fixed ref
b7e-count --regex 'Vel[mn]ora'                     extended regex instead of a fixed string
b7e-count --paths 'text/**' --exclude CHANGELOG.md Velmora
b7e-count --per-file Velmora                       plus the per-file breakdown
b7e-count --json Velmora                           one JSON object per pattern
```

**`git grep -I -o -n -z` at a ref, not `-c` and never `--no-index`.** `-c` counts
matching *lines*; a line naming a literal twice is one line and two occurrences, exactly
the gap between a `git grep -lI` count and a `python3` one. `-o` prints only
the matched text, one per output line, so counting lines of `-o` output is counting
occurrences directly. Running at a ref (`<pattern> <ref> -- <pathspec>`) reads the git
tree object, never the live working directory — so a stale sibling git worktree sitting
on disk under `.claude/worktrees/`, a second full checkout of the same repo, is never
walked into at all, which is exactly what inflates a plain recursive
`grep -rn --include=*.md .`. `.git` and `.claude/worktrees` are excluded from the
pathspec defensively anyway, so that invariant holds even if a future caller ever points
this at something other than a committed ref.

**`--ref` defaults to "the delivery base"** — `origin/main`, falling back to `main` — the
same fallback `lib/affected.js`'s `resolvableBase` and `lib/counterproof.js`'s own copy
of it already use for the same question, "what does a branch here actually deliver
into". Given explicitly, a ref that does not resolve to a tree is refused rather than
silently falling back to something else.

**`-w <workspace>` resolves through `lib/session.js`'s `resolveSessionDir`**, the one
function twenty-five other call sites already use to turn a workspace name into a
checkout directory — not a second, hand-rolled path-guessing scheme. With neither `-w`
nor `--dir`, it counts in this repo's own checkout.

**Per-file breakdown is sorted by count descending, then path ascending on ties** —
deterministically, regardless of the order `git grep` itself happened to walk the tree
in — which is what makes running the same call twice on an unchanged tree return
byte-identical output, `--json` included.

Read-only in the same construction sense as `b7e-def`/`b7e-owes`/`b7e-affected`/
`b7e-census` above: the only subprocess it ever spawns is `git grep` at a fixed ref, and
the only thing it does with `bd`'s own config is read a checkout path out of it — never a
call to `bd` itself. See `bin/b7e-count` and `lib/count.js`.
