### Is a worktree still being written to, or safe to take over — `b7e-builder`

`bc-xl7n.158`: four separate delmar worker windows (`dv-b5d.60.1` twice, `dv-b5d.60.2`,
`dv-b5d.60.6`) each hand-assembled the same answer from `ps`, `git log`/`status` and file
mtimes, and the fourth read the session record and transcript tail and reached the
*opposite* verdict from the first three — idle vs. still-writing — because it used
different evidence.

```
b7e-builder <worktree name or path>                the report, printed
b7e-builder <worktree name or path> --since 30      widen the "recent write" window (default 15m)
b7e-builder <worktree name or path> --json          machine-readable
```

**Three verdicts, and what decides between them.** No live Claude Code session has this
worktree as its `cwd`: `abandoned`, whatever the git tree looks like — there is nobody
left to ask. A live session that is `busy` right now: `still-writing`, outright, because a
model mid-turn has not necessarily flushed a file write yet and file mtimes would
under-report it. Otherwise it comes down to the most recently written file in the tree
(skipping `.git` and `node_modules` — the latter a symlink into the main checkout in every
worktree here, so its mtimes belong to whoever last ran `npm install`, not to this
worktree's writer): inside `--since` minutes of now is `still-writing`, older is `idle`
(safe to take over). ahead/behind against `main` and the modified/untracked counts are
reported alongside the verdict rather than driving it — they are what a session taking
over wants to see next, not evidence this tool weighs itself.

**Found by `cwd`, never by matching an id in a session's argv.** `lib/claude.js`'s own
`linesNameBead`/`isWorkerLine` both read a session's command line, which is exactly the
evidence an *interactively*-started `claude` does not carry — no worker brief, no bead id
anywhere on it. This is bc-xl7n.158's own acceptance criteria: a session found only by its
`cwd` being inside the worktree must still count as a live writer, and `sessionsIn` in
`lib/builder.js` never looks at argv at all.

**The worktree lock and its holder are reported, read-only.** `git worktree lock`
refuses a tree that is already locked and — per the resolver brief in `lib/session.js` —
the reason it prints always carries the holder's pid (`claude session <name> (pid <N>
start <date>)`), which is the same convention `~/.claude/hooks/worktree-guard.sh` reads to
label a dead lock prunable. `b7e-builder` reads that same reason, extracts the pid, and
checks it against the process table — but never takes, releases, or otherwise touches the
lock itself. A worktree git does not know about at all (an absolute path handed to it
directly) is still reported, marked `unregistered`, rather than refused.

`lib/builder.js` is the parsing, the git plumbing (`aheadBehind`, `statusCounts`,
`newestWrite`) and the verdict; `bin/b7e-builder` is the argv shell and the printing.

Exit codes: `0` `idle` or `abandoned` — safe to take over. `1` `still-writing` — leave it
alone. `2` bad usage. `3` the argument names no worktree this repo's git knows about and
no path that exists on disk.
