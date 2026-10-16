### Hand a relay round's remainder to the next round, in one call — `b7e-successor`

`bc-dgx7.196`, re-filed from another workspace's tracker. A multi-round job ends every
round the same way: file the remainder as a sibling under the same parent, chain it behind
the round that just finished, and move whatever downstream bead was waiting on the finished
round so it now waits on the next. Eight sessions did that by hand as four or five `bd`
calls plus a readback, and they differed in what they forgot — one never drew the
new→old chain edge, two had the first create refused by the worktree guard and went
grepping `--help` for `--body-file`, one copied labels off the previous round with
`bd show --json | python3`, and the round's candidate count in each title was typed by hand.

```
b7e-successor -w acme -b ac-r3 --title "Panels round 4: the 6 candidates after R3" --body round4.md
b7e-successor -w acme -b ac-r3 --title "..." --body - <<'EOF'     body from stdin
b7e-successor -w acme -b ac-r3 --title "..." --body f.md --assignee designer
b7e-successor -w acme -b ac-r3 --title "..." --body f.md --move-blocker ac-gate ac-other
b7e-successor -w acme -b ac-r3 --title "..." --body f.md --json
```

It creates **exactly one** child of the finished bead's parent, born with its own labels
only (a parent's `container` or `human` marker describes the parent, not the round), adds
`new → old`, and for each blocker drops `blocker → old` and adds `blocker → new` — by
default every open bead that depends on the finished one through a waiting edge (not a
parent-child, discovered-from or related one), or exactly the ids named by
`--move-blocker`. Then it reads each moved blocker's edges back with `bd dep list`, and
exits non-zero if one disagrees: a `dep add` that exits 0 is not a statement about what the
graph now says. A bead the new round is assigned to is `--assignee`; the body is a file or
stdin and never an argv token, so semicolons and backticks arrive intact.

**A rerun refuses before it writes.** If a child of the same parent already carries the
same title (case and whitespace aside), nothing is created and the exit is `5`, naming it.
A finished bead with no parent is `3`: a successor is a sibling round, and there is nothing
to hang it off. `0` is filed, chained, moved and every readback agreed; `1` means something
landed but a readback disagrees; `2` bad usage; `4` an unknown workspace or bead; `6`
create answered with no id, in which case nothing was chained or moved.

`bin/b7e-successor` declares `@grant excluded`, for the reason `b7e-write` does: it files a
bead and rewrites dependency edges in a configured tracker, which is strictly more than any
one command `lib/grants.js` classifies. A worker already carries an unrestricted Bash. See
`bin/b7e-successor`, `lib/successor.js` and `test/b7esuccessor.mjs`.
