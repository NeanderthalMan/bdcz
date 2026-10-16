### Confirm a filing batch actually landed — `b7e-filed`

`bc-dgx7.104`, moved from loremia (`lm-afr.34`), filed there against three sessions
(`lm-afr.6`, `lm-afr.7`, `lm-afr.8`) that each filed beads through `bin/file.js`, could
not tell whether the filing had landed, and each invented its own recovery: one polled a
stuck `file.js` for twelve minutes with a scratchpad script; one got a bead back with no
parent and repaired it by hand (`bd update lm-imex --parent=lm-afr`, confirmed with
`bd list --parent=lm-afr | tail -12`); one got no output at all from a call that had in
fact filed, and nearly double-filed the batch running it again. ~20 sessions share this
Dolt workspace, so the contention behind all three is the normal case, not an outage.

```
b7e-filed -w beadcause --from bc-dgx7 -f beads.yaml     one row per intended title
b7e-filed -w beadcause --from bc-dgx7 --repair < spec    also re-attaches a missing parent
b7e-filed -w beadcause --from bc-dgx7 --json -f spec     the machine-readable form
```

Takes the same YAML spec that was piped to `bin/file.js`, plus `--from` — the bead that
was being worked when the batch was filed. Every bead `lib/filing.js` successfully
creates carries `filed-while:<from>` unconditionally, so `bd list --label
filed-while:<from>` (all statuses, including closed) is the exhaustive, exact set of
what that filing produced; a spec title is matched against that set alone, never against
the whole tracker, which is what lets this tell "this title exists elsewhere" apart from
"this filing produced a duplicate" — the one distinction a plain title search cannot
make. No match is `unfiled`; more than one is `duplicate` (the `lm-afr.8` shape, named
outright); exactly one is `filed`, and only then is there a bead to check further —
its real id, parent, labels, assignee, and whether its description arrived whole, by
comparing UTF-8 byte length against what `lib/filing.js#beadToIssue` would have built
from the spec (the `files:` block folded in via `lib/beadfiles.js#withSurface` when the
spec named any). A byte count catches the `lm-afr.6` shape — an apostrophe broke
`file.js`'s shell quoting and truncated the description partway through — without
reproducing bd's own formatting.

**`--repair` re-attaches a missing parent, and nothing else.** It asks
`lib/homing.js#homeIn` the same question `fileBeads` asked at filing time — where does a
bead discovered from `--from` belong — and adopts any singly-matched, non-root
(`lib/ownership.js#isRoot`) bead that is missing a parent and has somewhere to go: the
exact `lm-afr.7` recovery, done for you rather than by hand. It only ever attaches an
*absent* parent; a bead already adopted somewhere on purpose is left alone; running it
twice changes nothing the second time.

Exit codes: `0` every title filed exactly once, with a parent (or root-shaped, or
nowhere to hang one), description whole. `1` at least one title is unfiled, duplicate,
stranded and unrepaired, or truncated. `2` bad usage. `3` the YAML names no beads. `4`
`-w`/`--from` named something this checkout's tracker does not have. Declared `@grant
excluded` in the command's own header — it can mutate the tracker under `--repair`, and
the one caller `DEFAULT_TOOL_LIST` widens is `dispatch`, which files nothing and has no
batch to confirm (same reasoning as `b7e-apply`, `b7e-take`, `b7e-swbump`). See
`bin/b7e-filed.js` and `test/b7efiled.mjs`.
