### Is another live window already on this bead — `b7e-window`

`bc-dgx7.88` is the session audit: seven sessions in one workspace's tracker each opened by
asking whether a second agent window was already working the same bead, and each wrote
its own `ps` pipeline for it. No two were the same, and the variation was not cosmetic —
one flooded 50KB of output to a file nobody read then retried twice; one got a **false
negative** on the one question this exists to get right, and only found the second
window a call later by luck. The bracket idiom that keeps a `grep` from matching its own
invocation (`grep 'beadcaus[e]/<id>'`) was independently rediscovered by all seven.

```
b7e-window -w <workspace> -b <bead>            one line per live window naming it
b7e-window -w <workspace> -b <bead> --family   also census every bead under its nearest root
b7e-window -w <workspace> -b <bead> --json     the machine-readable form
```

**A self-check, not the dispatch-time door.** `lib/onewindow.js` (`bc-7qo.19`) refuses at
*dispatch* time, when the daemon already knows a bead is live. This is for a window that
cannot assume that door caught every case — a hand-opened session, a race, a stale lease
— and wants the answer for itself, with an exit code it can act on: `0` at most one live
window names the bead, `1` two or more do (their pids are named). `2` bad usage. `4`
`-w`/`-b` named something this checkout's tracker does not have.

One `ps -Ao pid=,etime=,args=` read is the whole of the evidence, matched with the same
word-boundary rule (`namesBead`, `lib/reap.js`) the rest of the codebase already trusts
for this — including its guarantee against a *dotted child* reading as a match (a live
window on `bc-x.1.3` does not make `bc-x.1` look occupied). "This session's own window"
is found by walking up the process tree from `ps -Ao pid=,ppid=` until a pid with a live
`~/.claude/sessions/<pid>.json` record turns up — the same walk
`~/.claude/rename-session.sh` does in shell, ported to JS.

**`--family` widens to the nearest root (P0 or epic) above the bead, and everything
under it** — the per-bead census a couple of those sessions
assembled by hand for a whole epic's worth of live windows. Under
`--family` this is a report, not a gate: a sibling bead worked in a different window is
ordinary, not a competitor, so the exit code stays `0` regardless of what turns up. Worth
knowing before trusting a wide `--family` census: a live process's argv can carry its
whole loaded context, and this repo's own memory notes are free to *quote* another
bead's qualified id as example text — measured live while building this, `--family`
against a large epic picked up two ordinary sessions as "live on" a sibling bead purely
because a note in their context quoted that bead's qualified id in a worked
`beadcause-supersede` example. Not a false positive this tool introduces — the same
trade-off the rest of the codebase already accepts for the single-id case, just visible
at fifty times the width.

**Not `b7e-onbead` (`bc-7qo.24`), a closely related but distinct question, still
unmerged as of this writing (PR #656, conflicted, no resolver).** `b7e-onbead` is an
investigative report for *reaching* a live peer — worktree, dirty disk state, a
`SendMessage`-able name; this command is a fast boolean gate for a session's *own*
self-check, with an exit code and a `--family` census neither of `b7e-onbead`'s
acceptance criteria ask for. Kept separate rather than merged into one, the way
`b7e-siblings` and `b7e-onbead` were kept separate before them — worth folding together
once `b7e-onbead` actually lands, if that reads better then.

Read-only: one `ps` read, plus (for `--family`) one `bd export` — never a write, never
touches a worktree. `Bash(b7e-window:*)` is on `DEFAULT_TOOL_LIST`,
and `lib/grants.js` classifies it `read`. See `bin/b7e-window` and `lib/window.js`.
