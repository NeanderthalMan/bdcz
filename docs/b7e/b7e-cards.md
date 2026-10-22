### Which cards a round bead waits on moved, and what they now say — `b7e-cards`

`bc-xl7n.202`, from delmar's session audit (`dv-5eu.186`): seven sessions each hand-wrote a
different shell loop over a "Cards to act on if answered:" list of about 21 bead ids. The
variants printed different things — two printed no comments at all — so a comment Adam left
on a card that was still open could be missed.

```
b7e-cards -w <workspace> -b <round-bead>                         cards read off the bead, since last round
b7e-cards -w <workspace> -b <round-bead> --since <iso>           an explicit cut-off
b7e-cards -w <workspace> -b <round-bead> --ids <id,id,...>       an explicit card list
b7e-cards -w <workspace> -b <round-bead> --json                  the machine-readable form
```

**Which cards.** Without `--ids`: every id on a "Cards to act on" or "Read … first" line of
the bead's description (and the lines after it, to the first blank one), plus the bead's
blocking dependencies. An id mentioned anywhere else is a passing mention, not a card.

**Since when.** `--since last-round` (the default) is the close time of the bead this one is
the remainder of (`remainder of <id>` in the description) or was `discovered-from`. If none
can be found, nothing can be judged MOVED and the report says so rather than guessing.

**MOVED is not "status changed".** A card moves when its `updated_at` *or* its newest
comment is after the cut-off, so a still-open card with a new comment is MOVED. Each MOVED
card prints its newest non-agent comment (an author that is not `beadcause…`, `agent` or the
configured actor — a session running under Adam's own git identity cannot be told from Adam)
and, for a decision answered through beadcause, the option chosen, read by
`lib/beadanswer.js`. The last line is `N answered, M moved, K untouched`.

A card the tracker cannot read is reported `tracker error` and counted `unread`; only a
"no issues found" error is called `not found` (`bc-dgx7.109`). Exit codes: `0` ran, `2` bad
usage, `4` unknown workspace or bead, `1` tracker failure.

Read-only. `Bash(b7e-cards:*)` is on `DEFAULT_TOOL_LIST` from the tool's own `@grant read`.
