### Which live worktrees are already changing these files — `b7e-siblings`

`bc-bmry.11` is the session audit agent naming a fourth shape of the same failure
`b7e-def`/`b7e-owes`/`b7e-affected` above already fixed once each: a question worth
asking *before* the first edit, answered by hand every time because nothing said it back.
Four sessions on 2026-08-18, all against `lib/server.js`, each built a different partial
survey of who else was on it. One ran six separate `git` calls — `git log`, `git diff
--stat`, `git worktree list | grep`, then `cd` into two other worktrees in turn — before
it had even cut its own. One asked a shorter version and learned about the collision only
from the `Edit` tool's own refusal, after the module name and the design were already
chosen. One wrote a loop with the other branches' names typed in by hand, which is the
part that cannot generalise past that one session. One did not look at all, and paid for
it twice — a `Write` refused, a rename mid-session, a third refusal naming three more
holders it still had not looked for.

```
b7e-siblings <path> [<path> ...]      which worktrees have changed these files
b7e-siblings --bead <id>               the files that bead declares (lib/beadfiles.js)
b7e-siblings --bead <id> -w <workspace>  a workspace this checkout is not the tracker for
b7e-siblings --json <path> ...        one object per row instead of the printed report
b7e-siblings --dir <root> ...         another tree — this is how it is tested
```

One row per colliding worktree: its branch, the bead and pid of a live session sitting in
it if one is, whether it is `git worktree lock`ed and whether that lock still has a live
session behind it, the line ranges it has touched in each file — the same rendering
`lib/regions.js` gives a refused claim — and its commits ahead of `main` that actually
touch one of the named files (capped, with a count of what was left off rather than a
silent truncation). Nothing at all, exit `0`, when no worktree has touched any of them.

**Comparison is against the merge-base with each worktree's own branch, never against
`main`'s literal tip.** `main` moves the moment any other branch merges, and a worktree
cut a day earlier has almost always fallen behind it by the time this asks — a diff taken
against `main`'s current tip would read every one of those *other* branches' landed
changes as this worktree's own, which is exactly backwards. The merge-base is the one
commit both sides agree on, the same reason `lib/regions.js` takes it between two claim
holders rather than diffing either one against a literal ref.

**A worktree whose directory is gone still answers, correctly labelled `pruned` rather
than reported as `live`.** `rm -rf` on a worktree without `git worktree remove` leaves the
registration in `git worktree list` pointing at nothing — every worktree of a repo shares
one object store, so the branch and its commits are still there to read even once the
checkout itself is not. `lib/regions.js`'s `changedSince` needs an actual working tree to
diff against and returns nothing for one that no longer exists; `changedBetween`, added
alongside it for exactly this case, diffs two refs instead and needs no working tree at
all. This module picks whichever of the two a worktree can actually answer.

Bead and pid come from `lib/claude.js`'s `liveSessions`, matched by `cwd`, with the bead
id read off a session's own chosen name by `beadInName` (`lib/reap.js`) — the same
convention the reap sweep already trusts, and best-effort in the same way: a worktree with
no matching live session still gets a row, with no bead and no pid, because the git
evidence does not depend on anyone still being logged in to have produced it.

Like `b7e-def`, `b7e-owes`, `b7e-affected` and `b7e-readme` above, this is read-only by
construction — `git worktree list`, `git diff`/`git log` against refs, a `bd show` for
`--bead` that never writes, and a read of `~/.claude/sessions/*.json` — which is what put
`Bash(b7e-siblings:*)` straight on `DEFAULT_TOOL_LIST` and `read` in
`lib/grants.js` beside the other four. `lib/siblings.js` does the survey; `bin/b7e-siblings`
is the argv shell around it.
