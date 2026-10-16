### A runnable copy of this repo at any commit, taken away afterwards — `b7e-at`

`bc-dgx7.63` names four sessions (`bc-dgx7.52`, `bc-beleq`, `bc-9ntye.3`, `bc-ogicx.5`)
that each needed this repo, at some other commit, runnable — and each built the copy a
different way, two of them unsafe. `bc-dgx7.52` leaked three `git worktree` registrations
into a `mktemp` scratch dir and had to `git worktree remove --force` them by hand.
`bc-beleq` used `git archive <sha> | tar -x`, twice, and `rm -rf`'d the results itself
afterward. `bc-9ntye.3` ran `git checkout` inside its own live, *locked* worktree and
checked the branch back out when it was done. `bc-ogicx.5` read the shared main checkout
instead — exactly what `b7e-blame`'s own header above warns is "routinely tens of commits
stale". `lib/blame.js` already had the answer, hardwired to `origin/main`; this is that
same worktree-building code, lifted into `lib/at.js` and generalised to take any ref, with
`lib/blame.js` calling it too.

```
b7e-at <ref> -- <command>...    run <command> in a detached worktree at <ref>
b7e-at <ref> --keep             build the tree, print its absolute path, leave it
b7e-at <ref> --dir <root>       resolve/fetch <ref> from <root>, not the cwd's repo
b7e-at --list                   every tree this command has left on this Mac
b7e-at --reap                   tear all of them down
```

`<ref>` is anything `git worktree add --detach` accepts — a sha, a branch, a tag, a
merge-base expression. It resolves against `--dir`'s repo, or, without `--dir`, whichever
repo the caller's own `cwd` is inside — **never** this file's own location: every `b7e-*`
command actually runs from the *main checkout's* `bin/` (`lib/foundation.js` puts it first
on `PATH`), so a worktree session that resolved from `import.meta.url` would silently
build against the wrong tree no matter which worktree actually typed the command, the same
discipline `b7e-prtree` and `b7e-swbump` already hold.

**With a command, the tree is a detached `git worktree`** — never `EnterWorktree`, which
claims a lock a sibling session could trip over for a tree nobody is here to edit, and
never inside `.claude/worktrees/`, so `git worktree list` in a sibling session never shows
it as a claimable worktree — with `node_modules` symlinked from the source repo's own
(never copied, the same rule `b7e-worktree` and `scripts/vendor.js` hold elsewhere) and
`public/vendor` linked the same way, by running the new tree's own `scripts/vendor.js`
(best-effort: a ref with no such script, or a run that fails, still returns a usable
tree). The command runs with that tree as its working directory, inheriting stdio, and
whatever it exits with is what `b7e-at` itself exits with — the tree is removed
afterward regardless, success, a nonzero exit, or the command being killed outright.
**Without a command**, `--keep` is required — a tree built and immediately torn down
does nothing — and the tree's absolute path is printed on stdout, one line, so
`DIR=$(b7e-at <ref> --keep)` is the whole workflow; everything else goes to stderr.

**`--list`/`--reap` answer the one case a `finally` cannot cover: this process getting
killed before it gets there.** Every tree carries a `meta.json` sidecar inside its own
scratch directory, so removing that directory is also what takes it off the list — no
registry to keep in sync by hand. `--list` prints every tree this command has ever left
on this Mac, whichever repo or session built it, and nothing when there is none; `--reap`
tears every one of them down the same way `removeAtWorktree` always has, and is the
direct answer to the `git worktree list | grep ..., git worktree remove --force` three
times, `git worktree prune` cleanup `bc-dgx7.52` had to run by hand.

Exit codes: with a command, whatever that command itself exited with. Otherwise `0`
(built and printed the path, or listed/reaped with nothing to report), `2` refused — bad
usage, or not run from inside a git repository, `3` building the tree failed (a bad
`ref`, or `git worktree add` itself failing).

Not on `DEFAULT_TOOL_LIST`, for the `b7e-blame`/`b7e-worktree`
reason and the `b7e-call`/`b7e-bound` one together: it creates a real (if detached and
short-lived) `git worktree` — the same write-shaped step `b7e-blame` is withheld for —
and, given a command, runs whatever the caller names with whatever arguments the caller
names, the same "no argv shape to check for reaches a write" `b7e-call` is withheld for.
`dispatch`, the one agent this list actually governs, has no branch of its own, no ref
to want a runnable copy of, and no oversight loop past its own single `bd comment` for
whatever a caller-named command might do.
