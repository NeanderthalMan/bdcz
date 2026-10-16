### Ask for the notes about this bead and these files — `b7e-notes`

`bc-khoe.43`: `beadcause-memory` is key-addressed on purpose (`lib/memory.js`) — retrieval
works only if you already know what a note is called. Eleven sessions (`bc-xl7n.55`,
`bc-42ow.4`, `bc-khoe.23`, `bc-khoe.27.1`, `bc-36xx.6`, `bc-5k22`, `bc-xl7n.74`,
`bc-xl7n.79`, `bc-xl7n.71`, `bc-1kwl.22`, `bc-j52g`) guessed a key by hand rather than
asking for it — 58 calls between them, usually two or three guesses per Bash call — and
the note that would have helped was usually found only *after* the mistake it would have
prevented: `bc-xl7n.71`'s own debrief is explicit that it should have grepped memory for
the suite name *before* writing a runner, not after.

```
b7e-notes <bead-id>                     no paths given: uses what the bead names or guesses
b7e-notes <bead-id> <path> ...          the files it will touch
b7e-notes bc-xl7n.71 lib/superseded.js test/landcheck.mjs
b7e-notes <bead-id> --json
b7e-notes <bead-id> --dir <root>        another tree — this is how it is tested
```

**Three groups, because the evidence is three different kinds, not one ranked list.**
`lib/b7enotes.js` does the matching; this file is the argv parsing, the one `bd show`
call, and the printing.

- **`bead`** — does a note name this bead or one of its ancestors (`bc-khoe.27.1` also
  answers to `bc-khoe.27` and to `bc-khoe`, every dotted prefix — wider than
  `relevantNotes`'s own `family()`, which reaches only the immediate parent because that
  is all one bead's own brief needs), or read like the bead does? Named notes are ranked
  unconditionally ahead of similar ones, and similarity reuses `lib/memory.js`'s own
  `tokens`/`similarity`/`RELEVANT` — exported for exactly this, so this tool and the
  ordinary worker brief never disagree about what "reads like the bead" means.
- **`files`** — does a note mention one of these files, or a suite `lib/affected.js` (the
  matching behind `b7e-affected` above) says covers one of them? Substring, not
  similarity — a single file is too small a bag for the cosine floor in `notesForBead` to
  ever clear, and the acceptance case this was built against is exactly a note that names
  nothing but the path: `test/landcheck.mjs` finds `landcheck-outruns-a-300s-suite-timeout`
  without that note naming the bead at all. A file the caller actually named always
  outranks one only *derived* as a covering suite — `lib/superseded.js` alone is
  transitively imported by fifty-odd suites in this repo, so a note that happens to
  mention one of them by its bare stem cannot crowd out the note about the path itself.
- **`debriefs`** — what earlier runs at this bead's own family (itself, its parent, its
  siblings under that parent — `debriefFamily` in `lib/memory.js`, the exact set
  `beadcause-memory debriefs` reaches) already reported, returned inline instead of
  needing a second command: `bc-j52g` had to run `beadcause-memory debriefs bc-j52g`
  separately to learn its siblings had nothing to say. Bounded by the same `DEBRIEF_KEEP`/
  `DEBRIEF_CHARS` numbers `debriefBrief` already applies to the ordinary worker brief — a
  bead directly under a long-running P0 epic answers to a `parent` whose own debrief
  history can be dozens of visits deep and one archive commit long (measured at 215KB for
  `bc-khoe` itself, building this), and there is no reason to read that twice just because
  it arrived through a different door.

Exit `0` when at least one group returned something, `1` when all three came back empty,
`2` when refused — bad usage, or `bd show` could not find the bead.

**On `DEFAULT_TOOL_LIST`**: the `b7e-def`/`b7e-owes`/`b7e-affected`
shape again, not the `npm test`/`b7e-gate` one. Its one write-shaped-looking step is
already covered by an existing grant — `Bash(bd show:*)` is on the same list — and it
never claims, labels or comments. `lib/grants.js` classifies it `read`.
