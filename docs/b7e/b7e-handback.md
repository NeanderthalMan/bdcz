### End a run that delivered nothing, the one way the next tick expects — `b7e-handback`

`bc-dgx7.34`. A session audit (`lib/sessionaudit.js`) found the same close-out written
by hand in four sessions that ended without a pull request, each a different way.
`bc-36xx.24` commented and ran `bd unclaim` — assignee cleared, status never touched.
`bc-ogicx.1` commented, set `--status=open`, and added the `human` label — status set,
assignee never cleared, so its own final `bd show` still carried an owner. `bc-zjab.10`
did both writes in one call and narrated it as unclaimed, which its readback would have
caught was not quite true. `bc-khoe.30.9` set the status and stopped, so the next
session on that bead had to `--claim` it again before it could even start. Meanwhile
`lib/bd.js` already had the one write all four needed — `reopenAbandoned`, `--status
open --assignee ''`, forced only when the plain write is refused for holding a claim
beadcause never actually had — and none of the four called it.

```
echo 'Out of time; the harness half is written, the CLI half is not.' > note.md
b7e-handback -w beadcause -b bc-dgx7.34 --note note.md
b7e-handback -w beadcause -b bc-ogicx.1 --note note.md --why blocked --human
b7e-handback -w beadcause -b bc-dgx7.34 --note note.md --json
```

Three writes, in order — comment, `Bd.reopenAbandoned`, and `label add human` when
`--human` is passed — and then a **readback**, because bc-ogicx.1's own session shows
that a write can be trusted by the comment that announced it and still not have landed.
`--human` refuses outright on a bead that is not type `decision`: the label is
`bc-ogicx.1`'s own, for the decision-bead case specifically, not a generic "flag for a
human" switch. A closed bead is refused too — there is nothing left to hand back. Every
refusal happens before the first write, and the exit code says which kind of trouble it
was: `2` bad usage, `3` refused before writing anything, `5` something was written but
the readback did not come back open-and-unassigned, `0` the only case where it did.

**The note is a file, or stdin — never a shell argument.** Two of the four hand
sessions lost or mangled the note going in as a heredoc: `bc-36xx.24`'s first two `bd
comment "$(cat <<EOF...)"` attempts were refused by the worktree guard, and
`bc-zjab.10`'s first attempt failed on a model timeout and had to be retyped shorter.
`--note <file>`, or no flag at all to read stdin, is the same shape `bin/block.js` and
`bin/supersede.js` already use for exactly this reason.

**Not yet on `DEFAULT_TOOL_LIST` or classified in `lib/grants.js`.** Unlike `b7e-prior`
and `b7e-orient`, this one writes — a worker reaches it today the same way the worker
brief already tells it to reach `bin/deliver.js`: by absolute path, through the `Bash`
grant it already has. Wiring it onto the allowlist belongs to `bc-dgx7.2`'s definition
of what a skill needs, not to this bead. See `bin/b7e-handback`, `lib/handback.js` and
`test/b7ehandback.mjs`.
