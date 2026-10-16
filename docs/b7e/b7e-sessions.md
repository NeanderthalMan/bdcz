### Every Claude Code session this Mac knows about, and what the last boot did to it — `b7e-sessions`

`bc-5to5r.3`, from Adam's request on 2026-10-11: "beadcause should open a terminal to present
the status list of all current sessions upon startup". After a reboot the daemon brings back
the windows the machine took (`lib/rebootresume.js`), and until this existed the only record
of what it decided — which came back, which it declined and why — was a handful of
`[reboot]` lines in `~/Library/Logs/beadcause.log`, which is not where anyone looks on a
Monday morning with half their windows missing. The daemon now writes the decision down as
`rebootReport` in the app state, and this prints it beside the live session list and the
register `lib/sessionregister.js` keeps while the Mac is up.

```
b7e-sessions           name · where · bead · status · last transcript write, one row per session
b7e-sessions --json    the same rows as one object
b7e-sessions --watch   the live view, `beadcause-top` (bc-5to5r.7): busy/idle, context, cpu, memory, redrawn until q
```

The header says when this Mac booted, whether the reboot pass has run for *this* boot and
what it did (`2 reopened, 1 skipped`), and when the register was last polled. Then one row
per session, in this order:

| status | meaning |
|---|---|
| `live` | a process is answering right now — with `(reopened at boot)` when the pass is how it got there |
| `reopened` | the pass brought it back with `claude --resume`; no process yet, or one that has not written its record |
| `parked for its advocate` | a daemon window; its advocate resumes it through the dispatch seam, never the pass |
| `alive at shutdown, not yet brought back` | in the register from before the boot, and no pass has decided about it — a daemon that came up too late, or has not come up |
| `skipped — <why>` | the pass declined: its transcript grew since the boot (already back), its directory is gone (a retired worktree — reported, never resumed somewhere else), it is parked already, over the cap of 12 |
| `could not reopen — <why>` | the pass tried and iTerm or the shell said no |

**Where** is the directory said short: a worktree as `repo ⟶ worktree`, anything else by its
basename. **Bead** is the daemon's own record of what the window holds where there is one,
and otherwise a bead or JIRA key read off the window's `<project> - <task>` name — advisory,
and conservative (`re-run` is a word, `bc-5to5r` is a bead). **Last write** is the age of the
transcript's last line, which for a window that has not come back is when it last said
anything.

**Only this boot's report counts.** Last week's "reopened" says nothing about a window
today, so a report stamped with an earlier boot is not shown as status. The two readings of
the boot are compared with slack, because `os.uptime()` is whole seconds and the daemon and
this command read it up to a second apart.

**After a boot the daemon opens one window on this.** Only after a real boot — the pass
says `fresh`, which a hot swap at 3pm never does — and only when the pass had at least one
session to decide about, because a window announcing that nothing was open is noise on every
cold start. The window runs this command and leaves the shell at a prompt, the opposite of
every other tab beadcause opens, because a status window that closed the moment it had
printed would be read by nobody.

Reads the session records under `~/.claude/sessions`, `sessions.json` and `state.json`
under the config directory, and `stat`s one transcript per row. It writes nothing, opens
nothing and needs no token or daemon. `@grant read`.
