### Count the beads that carry a label or an edge — `b7e-census`

`bc-bmry.12`, filed by the session audit (`lib/sessionaudit.js`) against three sessions
that each needed the same thing — which rows in a real tracker match a label or
dependency predicate — and each built its own one-off pipeline. `bc-bmry.2` piped `bd
list --all --limit 0 --json` into an inline `node -e` that accumulated stdin, parsed it
and filtered for the exact `gate` label. `bc-bmry.5` did it in two stages: `bd list
--limit 0 --json > scratchpad/rows.json`, then a whole `scratchpad/real.mjs` to run its
derivation over every row. `bc-xl7n.98` used a third transport entirely — `bd export >
/tmp/bc-export.jsonl`, then three separate `python3 - <<'EOF'` programs over it, one
joining labels to dependency edges to find `in_progress` beads blocked by an open
`pr-delivery` card. Three sessions, three transports, three languages, one question.

```
b7e-census -w acme --label gate --count                        the exact "gate" label, every status
b7e-census -w acme --label gate --label ran:opus --count       ANDed — carries both
b7e-census -w acme --not-label gate:G0                         excludes a label
b7e-census -w acme --values gate:                              the distinct gate*/gate values, with counts
b7e-census -w acme --blocked-by-label pr-delivery --status in_progress
                                                                 bc-xl7n.98's join, in one call
b7e-census -w acme --label gate --json                          the matching rows, unformatted
```

**One `bd export`, whichever combination of flags is given.** There is no `bd list` flag
combination that can ask "carries this label AND is blocked by a bead carrying that
one", so this pulls the whole graph once — the same `{ beads, edges }` shape
`lib/ancestry.js`'s `indexFrom` already parses a `bd export` into for the epic board —
and filters in process. The matching itself is `lib/census.js`, a pure function over
that shape; this command is only the argv parsing and the printing around it, the same
split `lib/affected.js`/`bin/b7e-affected` already made for a different question.

**Labels match exactly, never by prefix**, and this is not a default picked for this
command alone — `lib/approval.js` already argues it for the one label family beadcause
knows the meaning of: the bare label `gate` means "I am a gate" and `gate:G0` is an
ordinary deliverable under it, so `--label gate` matching `gate:G0` too would silently
widen a query about gates into a query about the work gates are for. A caller that wants
the whole family asks `--values` instead, which is where that widening actually belongs.

**No status filter unless `--status` is given, and that is what makes `--label gate
--count` reproduce `bc-bmry.2`'s number** rather than `bd list`'s own default of hiding
closed issues — an index built from `bd export` already carries every status, closed
included, the same as `bd list --all`.

**`--blocked-by-label` reads a `blocks` edge the direction `Bd.gateFor` already reads one
in `lib/bd.js`**: the bead that carries the label has to be the one being depended
*on* — the blocker — not the one carrying the dependency, and only while it is still
open. A closed blocker is finished work, not a live gate on anything still in progress.

Not on `DEFAULT_TOOL_LIST` for a free ride — it earns its place the
same way `b7e-def`/`b7e-owes`/`b7e-affected`/`b7e-readme`/`b7e-ws` do: it runs exactly one
`bd` verb (`export`) and there is no argv path through it that reaches a write. See
`bin/b7e-census` and `lib/census.js`.
