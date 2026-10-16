### Say what the phone will show for this bead's card — `b7e-card`

`bc-dgx7.19`: three sessions (`bc-xl7n.101`, `bc-ka5y.15`, `bc-1kwl`) each hand-wrote a
`decision` block onto an *existing* bead's notes and then a scratchpad script of their
own to find out whether it had actually parsed — `beadcause-ask` refuses a body whose
tail is not a decision block, but only when *creating* a new bead. `bc-xl7n.101` wrote
its first block with `bd update --append-notes`, then a `dbg.mjs` reporting `notes has
decision fence: true … question: <the bead's own title>` with no options — the silent
degradation. A second `dbg.mjs` run against `BLOCK_RE` found the cause: `hint: Costs
nothing — superseded-by: already keeps it out` — a bead label's colon-space made YAML
read a nested mapping, and `bd update` had reported success anyway. `bc-1kwl` lost
`beadcause:waiting`/`beadcause:inmain` markers the same way, writing over `notes` with
`--notes` rather than appending. `lib/decision.js` (`toQuestion`, `parseDecision`,
`decisionTail`) already knows how to answer both questions; this is the command that
asks it, instead of a scratchpad.

```
b7e-card <bead-id>                          what toQuestion() makes of the bead now
b7e-card <bead-id> --field notes            just one field, not all three
b7e-card <bead-id> --file card.md           validate a draft before writing it
b7e-card <bead-id> --file card.md --field description
b7e-card <bead-id> --json
```

**With no `--file`, this is the *after*:** it reads the bead with one `bd show`, runs it
through `toQuestion` — the identical function the inbox itself calls — and prints the
question, every option (id, label, hint, `recommended`/`closes:false`/`defers:true`),
and any parse errors, in the app's own terms rather than implied by a raw field dump.
`--field` narrows the read to one of `description`/`design`/`notes` instead of all
three. A bead carrying no `decision` block at all is not a failure — most beads are not
questions — so `question` falls back to the title and the exit code stays `0`.

**With `--file`, this is the *before*:** the draft is read off disk instead of off the
bead, parsed the same way, and reported the same way — so a card can be checked before
it is ever written. A `decision` block that fails to parse — the exact bc-xl7n.101
shape, a colon inside an unquoted scalar read as a nested mapping — exits non-zero with
the YAML error *and* the offending source line appended (`→ line 5: hint: Costs nothing
— superseded-by: already keeps it out`), naming the fix rather than a line/column pair
nobody wants to go count. Because two of the three sessions above lost markers by
overwriting `notes` wholesale, the live bead's current content in the target field is
also scanned for `<!-- beadcause:... -->` markers the draft does not carry, and a write
that would silently drop one of those (`bc-1kwl`'s failure exactly) is flagged before it
happens rather than found after.

**Markers, not just the block.** Any `<!-- beadcause:... -->` HTML comment anywhere in
the field(s) being read — `beadcause:waiting`/`/beadcause:waiting` (`lib/epicadvocate.js`)
and `beadcause:inmain <branch>` (`lib/inmain.js`) both being the acceptance case here —
is listed, without needing to import either module's own constants: a generic marker
scan outlives any one family of them, and this tool has no business knowing every
family's own opening/closing spelling.

Exit codes: `0` clean, including "no decision block at all" — an ordinary bead, not a
failure; `1` a decision block is present (on the bead or in the file) and failed to
parse; `2` refused — bad usage, or the bead was not found.

**On `DEFAULT_TOOL_LIST`**: `@grant read` in its own header — the `b7e-def`/`b7e-owes`/
`b7e-notes` shape. It runs one `bd show`, reads a file if `--file` is given, and never
writes anything; `lib/tooldecl.js` classifies it `read` from the declaration alone.
