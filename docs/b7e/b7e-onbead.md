### Who else is live on this bead right now — `b7e-onbead`

`bc-7qo.24`. Done by hand in three sessions on three different beads, and each built a
different, partial instrument for it. `bc-7qo.11` opened by guessing a worktree slug;
`EnterWorktree` answered "a worktree with this name already existed and was resumed
as-is", which it read as inheriting a *dead* attempt and began planning edits against
what it had just read — it was a live peer's tree. The tell was an `Edit` that failed
to match a string it had read four minutes earlier. It recovered, but then spent four
separate worktree-guard claim refusals reasoning by hand about whose they were, and two
failed `SendMessage` calls (`No agent named 'beadcause-2b' is reachable. Did you mean:
beadcause-bd?`) before two `ListAgents` round trips found the actual address.
`bc-xl7n.113.1` folded a bare `pgrep`/`lsof` cwd census into its first tool call — a
list with no bead, no branch, no dirty state in it. `bc-xl7n.113.2` got there a third
way: `git log` on a sibling's worktree, then `cd` into it to read `git status` and `git
diff` directly. Measured cost: two windows built the identical fix independently, one
committed and died without pushing, and a regression whose only assertion lived in the
dead tree still merged clean at 379/379 — because four windows on one bead was invisible
to `advocates.json`, which believed it held two.

```
b7e-onbead -w beadcause -b bc-7qo.24             the printed report
b7e-onbead -w beadcause -b bc-7qo.24 --json      the same facts, machine-readable
```

**One row per live window naming the bead, plus every dead tree its branch left
behind.** Built almost entirely on `lib/prior.js`'s `branchesFor` — every worktree,
live or retired, and every branch owning the bead's tag, with how far ahead of `main`
and whether it is pushed — layered with `lib/claude.js`'s `liveSessions` (pid, cwd,
chosen name, busy/idle, matched to a worktree by `realPath`) and `liveProcessLines`
(a window's argv names the *qualified* `<workspace>/<id>` from the instant the shell
reaches `claude`, closing the gap before a session has cut a worktree or renamed
itself at all). Per row: pid and age, its own chosen name, the worktree path and
branch, and one of `dirty` / `committed-unpushed` / `committed-pushed` / `empty` /
`gone` — read fresh from `git status --porcelain` in that worktree, never from
`scripts/claim-guard.sh`'s claimed line ranges, which are *intent*, not disk (that
conflation is exactly what `bc-7qo.11`'s own debrief records catching itself doing).

**The address a report prints for `SendMessage` is the session's own chosen name, with
a caveat, not a promise.** `ListAgents` is what actually resolves the address —
copying a row's printed name exactly, or falling back to a short slug
(`beadcause-2b`) the moment two live sessions share one display name, which is the
exact collision that cost `bc-7qo.11` two failed sends. This command can only see that
collision *within its own rows*, so a shared name here is flagged rather than trusted;
`ListAgents` is still the one live source of truth for the disambiguated form.

`Bash(b7e-onbead:*)` is on `DEFAULT_TOOL_LIST` in `lib/toolbelt.js` and `read` in
`lib/grants.js`: every path through it is `bd show`, `git`/`git status` reads and
`~/.claude/sessions/*.json`/`ps` reads — nothing writes anywhere. See `bin/b7e-onbead`,
`lib/onbead.js` and `test/onbead.mjs`.
