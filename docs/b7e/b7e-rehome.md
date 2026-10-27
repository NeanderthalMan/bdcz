### Move a bead to the tracker that can actually deliver it, verbatim — `b7e-rehome`

`bc-dgx7.138`, moved here from delmar for the same reason its own deliverable proves the
point: the whole of it is `bin/`, `lib/`, `test/` and this doc, and a delmar session
cannot deliver any of that. Four delmar sessions (`dv-afr.35`, `.36`, `.39`, `dv-b5d.52`)
each hit a bead shaped exactly that way and each solved it by hand, no two of them the
same way. The collision check ran three different `ls | grep` shapes across the four. The
rival sweep of the destination tracker went three different ways too, and one of them —
`dv-afr.36` running `bd config get issue_prefix` from inside `beadcause` and getting back
`dv` — silently searched the *wrong* tracker until it thought to `ls -la ~/beads/beadcause/`
and re-ran under an explicit `BEADS_DIR`. Carrying the bead across cost the most: `dv-afr.35`,
the one session that moved the text verbatim rather than retyping it, paid for that with a
`bd show --json` to a temp file, a Python reshape into `bin/file.js`'s YAML, a `nohup` and a
hand-written poll loop. And `dv-b5d.52` burned a call on an unqualified `--original` to
`bin/supersede.js`, refused with "no issue found" because a cross-tracker original has to be
written `<workspace>/<id>`.

```
b7e-rehome -b dv-afr.40 -w delmar --to beadcause --under bc-dgx7
b7e-rehome -b dv-afr.40 -w delmar --to beadcause --under bc-dgx7 --dry-run
b7e-rehome -b dv-afr.40 -w delmar --to beadcause --under bc-dgx7 --json
```

**Not `lib/filing.js`'s `fileBeads`.** That module derives a parent from a
`discovered-from` bead in the *same* tracker and clamps a fresh finding's priority so an
agent cannot outrank the work it was given — both built for "an agent just noticed
something," and neither is true of a bead somebody already decided is real. `lib/rehome.js`
calls `Bd.create` directly: the caller names the destination parent with `--under`
(required, and never guessed — there is no cross-tracker `discovered-from` to derive one
from), and the title, description, type, priority, acceptance and design all travel
unclamped. The description is `row.description` with nothing done to it — no
`withSurface`, no YAML round-trip — which is what makes "identical to `bd show <id>
--json`'s, diffed rather than eyeballed" a bar this can actually clear.

**The rival sweep is the same ranking `b7e-dup` prints**, run once: the source bead's own
text (`queryFor`) against the destination tracker's rows, open and closed (`scoreAll`,
`withSuccessors`), so "nothing in `beadcause` covers this" is printed as a checked answer
rather than assumed the way six of `bc-dgx7.67`'s ten sessions assumed it. It prints first,
before anything is written, on a `--dry-run` exactly as on a real move.

**The collision check** looks for a `b7e-<verb>` token in the bead's own title — every
`bc-dgx7.*` skill bead is titled that way — and checks whether `<destination>/bin/<name>`
(extensionless, or `.js`) already exists. A hit does not block the move; it is printed so a
caller can tell "this is a duplicate of already-shipped work" from "this is genuinely still
open."

**The supersede half is `mark` (`lib/superseded.js`) — the identical three writes
`bin/supersede.js` makes**, run cross-workspace: the label, `--status=open` if the source was
claimed, and a comment naming where it went. `-w` and `--to` are always different trackers
for this command, so `mark`'s same-tracker edge-drawing branch never fires here — the source
bead is always held by its marker alone, which is the correct shape for a cross-tracker
supersede regardless. A create that lands but a supersede that cannot complete (a lock, a
race) is not reported as a wash: the new bead's id is still printed, and the failure says
in as many words to finish the mark by hand with `beadcause-supersede -w <ws> -b <id>
--original <to>/<new-id>` — a caller told nothing happened would go looking for the
duplicate this command just created.

**`--to` naming the same workspace as `-w`, an unknown `-w`/`--to`/`--under`, or a missing
`-b`/`--under` is a refusal with nothing written to either tracker** — never a bead created
with no supersede, never a supersede with no bead. Exit codes: `0` moved (or `--dry-run`
printed the plan). `1` filed but the supersede half could not complete. `2` bad usage. `4`
a named workspace or bead does not exist. `5` a tracker could not be read at all.

Not on `DEFAULT_TOOL_LIST` — `@grant excluded`, for the same reason `b7e-apply` and
`b7e-commit` are: it writes to two trackers unconditionally, and the allowlist cannot see
which argv a caller is about to pass. See `bin/b7e-rehome`, `lib/rehome.js` and
`test/rehome.mjs`.
