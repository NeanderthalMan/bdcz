### What that other worktree is actually adding to this file — `b7e-peek`

`bc-dgx7.43`, a session audit finding: six sessions on 2026-08-1[7-9]/22/23, each handed a
worktree name by a claim refusal (`lib/toolbelt.js is already claimed by another session
(on worktree-b7e-enroll-khoe2711) ... changing lines 198-205 of their copy`), then tried
to see what that worktree was actually doing — no two of them the same way. One took
eight calls: `git log`, an empty `git diff main...<branch> --stat` (the sibling had not
committed yet), a `git -C <path> status` against a path that does not exist, a `find`
to locate it, then `git -C <found path> status --short` and `... diff -- lib/toolbelt.js`
— and later, from inside its own worktree, `git -C <abs sibling> diff -- README.md` was
refused outright ("this command redirects git to the shared checkout via -C. Refusing"),
falling back to `Read <sibling>/README.md`. Another ran `git diff main <branch> --
lib/toolbelt.js` for two siblings by hand. A third and fourth each ran `git log --oneline
-20 <branch>` alone, with no diff at all — branch position, never the actual lines. A
fifth resolved a worktree by `cd`ing into it and separately called `gh pr list --search`
to ask whether it had already shipped.

`bin/b7e-siblings` (`bc-bmry.11`) does not close this. It answers a related but earlier
question — *which* worktrees are on a file at all, with line *ranges* — and it is asked
before an edit exists. This is for the moment after: one worktree already named, by a
claim refusal or by hand, and the actual hunk wanted.

```
b7e-peek <worktree-or-branch> <path> [<path> ...]   that worktree's pending change to
                                                     those files — committed and
                                                     uncommitted together
b7e-peek <worktree-or-branch>                       every file it has touched
b7e-peek <worktree-or-branch> --stat                the same, `+N -M` only
b7e-peek --bead <id> [<path> ...]                   resolve the worktree from a bead's
                                                     own live session first
b7e-peek --json <worktree-or-branch> ...            the same, machine-readable
```

One block per file: whether the change is new, committed, uncommitted, or both, and the
diff itself at git's ordinary context — not `lib/regions.js`'s `--unified=0` line ranges,
because this is read once, by hand, rather than folded into a refusal six holders wide.
Above the files: the branch and how many commits it is ahead of `main`, and whether a
pull request is already open on it (`lib/pr.js`'s `list`, the same `--head` lookup
`lib/prior.js` makes — silently omitted, never guessed at, when `gh` is not available at
all). Nothing pending prints one line saying so and still exits `0` — this answers a
question, it does not gate anything.

**Comparison is against the merge-base with the worktree's own branch, never `main`'s
literal tip**, for the same reason `b7e-siblings` takes it that way: `main` moves
constantly on this repo (see `beadcause-main-moves-constantly`), and a worktree cut a day
earlier has usually fallen behind it by the time anyone asks — diffing against `main`'s
current tip would read every other branch's landed work as this worktree's own.

**A worktree whose directory is gone still answers, from refs alone.** Every worktree of
a repo shares one object store, so a branch tip survives `rm -rf` on its own checkout —
the diff is read `<base>..<branch>` instead of against a working tree that no longer
exists, the same fallback `lib/siblings.js`'s `changedBetween` uses for a pruned sibling.

**A name resolves the same way with or without the `worktree-` prefix, or as the bare
directory under `.claude/worktrees/`** — a claim notice, `git worktree list` and a person
typing one by hand all spell it differently, and this repo's own convention already has
the branch and the directory disagree on the prefix.

**`git diff main...<branch>` — the form a session reached for by hand — silently answers
empty for a sibling whose whole change is still uncommitted**, which is exactly the state
a live sibling mid-edit is usually in. `b7e-peek` reads the merge-base against the
*working tree*, not against the branch's own tip, so uncommitted work is never invisible.

**Never a bare `git -C <sibling>`.** Every git call here runs with the sibling's directory
as a subprocess's `cwd`, never spelled `-C <path>` in an argv a Bash tool call would carry
— the whole point, since that spelling is what a prior session had refused outright.

`--bead` resolves a worktree from a bead id without ever calling `bd`: it reads
`~/.claude/sessions/*.json` for a live session whose own chosen name embeds that bead,
the same convention `lib/siblings.js` reads bead and pid from in the other direction
(`beadInName`, `lib/reap.js`).

`bin/b7e-peek` [declares `@grant read`](../b7e-tools.md#a-new-tool-declares-its-own-grant-and-edits-no-registry)
in its own header, which is what puts `Bash(b7e-peek:*)` on `DEFAULT_TOOL_LIST` and
classifies it a read in `lib/grants.js`: `git worktree list`, `git diff`/`git
log`/`merge-base` against refs, an optional `gh pr list --head`, and a read of
`~/.claude/sessions/*.json` for `--bead` — nothing that writes anywhere, and no `bd`
call at all. See `bin/b7e-peek`, `lib/peek.js`
and `test/b7epeek.mjs`.
