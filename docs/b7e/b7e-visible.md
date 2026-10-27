### Is this path tracked, ignored, or an unmaterialised LFS pointer — and does it exist in a worktree at all — `b7e-visible`

Six delmar sessions (`dv-2uu.20`, `dv-2uu.21`, `dv-5eu.40`, `dv-5i2.122`, `dv-5i2.93`,
`dv-5eu.39`) each worked out, by hand and in four different spellings (`git check-ignore
-v`, a `grep` against `.gitignore`, `cat`-ing a file to see if its bytes were really an
LFS pointer, `git ls-files | wc -l`), whether a path was tracked by git — because in a
repo whose worktrees carry only tracked files that single fact silently decides three
unrelated things at once: whether `EnterWorktree` gives you a copy of the file at all,
whether `~/.claude/hooks/worktree-guard.sh` lets `Edit`/`Write` touch it in the main
checkout, and whether an ordinary `git add -A` before a delivery picks it up. Nobody who
answered the git question by hand went on to derive all three; this does.

```
b7e-visible <path> [<path> ...]        classify one or more paths, against cwd's own repo
b7e-visible --dir <root> <path>        another checkout, not cwd — this is how it is tested
b7e-visible --changed                  everything `git status --porcelain` shows right now
b7e-visible ... --json
```

Each path is one of four states: **tracked** (the ordinary case); **lfs-pointer** —
tracked, `git check-attr filter` says `lfs`, and what's on disk (or would be, if it
existed at all) is the ~130-byte pointer text, not the real bytes — `git lfs pull` was
never run; a *materialised* LFS file reports plain `tracked` instead, since the pointer
is the surprise worth flagging, not the attribute; **ignored** — not tracked, and `git
check-ignore -v` matches it, reported with the matching rule split into `{ file, line,
pattern }` rather than left as one string, since every session above needed the line
number to go edit the rule itself; **untracked** — neither, an ordinary new file, or
nothing there at all.

Three verdicts follow. **`presentInFreshWorktree`** is true only for `tracked` and
`lfs-pointer` — `git worktree add` populates a new worktree from the index and nothing
else, so an `ignored` path like `webseries/episodes/*` is simply absent, the empty
directory `dv-2uu.20` hit. **`editableInMainCheckout`** mirrors `worktree-guard.sh`'s
`guard` mode *exactly*, not the informal "blocks tracked paths" shorthand this bead was
filed with: the hook's own `allowlisted()` check is `.claude/*|CLAUDE.md|.gitignore`
against the repo-relative path, full stop — it never runs `git check-ignore` or `git
ls-files`, so an ignored path is blocked from `Edit`/`Write` in the main checkout for the
same reason a tracked one is. What actually differs for an ignored path is that it has
nowhere *else* to be edited (see `presentInFreshWorktree`), so the edit still has to
happen in the main checkout — through a `cat > file <<'EOF'` heredoc instead of the
`Edit`/`Write` tool, which is what `dv-2uu.20` fell back to once it hit the block. When
the target repo's main checkout has no `.claude/worktrees/` directory at all, the hook
never engages and this reports `true` everywhere, matching `worktree-guard.sh`'s own
opt-in check. **`carriedByDelivery`** is whether an ordinary `git add -A` would pick the
path up at all — true for `tracked`, `lfs-pointer` and `untracked`, false only for
`ignored` (force-add aside). It is a structural fact about the path, not a live read of
the working tree; for that, see `--changed`.

**`--changed`** classifies every path `git status --porcelain` shows right now — the
exact set `bin/deliver.js`'s dirty-tree guard refuses on — instead of paths given on the
command line. This is `dv-5eu.39`'s case: it wrote `.deliver-body.md` into the worktree
and only found out it was untracked when `deliver.js` refused; `b7e-visible --changed`
answers that before the call, not after the refusal.

`lib/visible.js` is the classification; `bin/b7e-visible` is the argv shell.

Exit codes: `0` always, once usage is valid — a path that doesn't exist is still
classifiable, as `untracked`. `2` bad usage: no path and no `--changed`, or both together.
