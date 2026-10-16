### Was this bead's question answered, and which bead carries the answer — `b7e-answered`

`bc-dgx7.84` is the session audit: four sessions (`bc-mwhkg.1`, `bc-jjdar.1`, `bc-jjdar.2`,
`bc-mwhkg.2`) each opened on a bead they had been told was answered, and each spent its
opening working out — a different way each time — whether that was true and where the
answer actually was. It was on the parent twice, absent once. `bc-jjdar.1` ran `bd show`,
`bd comments` ("No comments"), then `bd comments <parent> | tail -60` and found the
answer there, then a JSON notes dump to confirm the bead itself carried no `decision`
block — four calls. `bc-mwhkg.1` got the same brief and the brief was wrong: six calls to
correct the premise and conclude the parent was unanswered too.

```
b7e-answered -w <workspace> -b <bead>                    the bead alone
b7e-answered -w <workspace> -b <bead> --family            also walk ancestors — parent, grandparent...
b7e-answered -w <workspace> -b <bead> --json              the machine-readable form
b7e-answered -w <workspace> -b <bead1> -b <bead2>          several beads, one call — repeat `-b`...
b7e-answered -w <workspace> -b <bead1>,<bead2>             ...or comma-join them
```

**Two things it reads, because the fact was already recorded in both and nothing read
them together.** `lib/decision.js` parses whichever `decision` block a bead's
description/design/notes carries, if any — a bead with none is plain work, not a
question. `lib/answered.js` is beadcause's own record of what you chose, kept in
`state.json` precisely so a re-arriving card can say "you said this already" — and it is
the *only* place a **deferred** answer shows up at all, because deferring answers a card
without writing anything to the bead at all (see `lib/decision.js`'s `defersFlag`).
Combined with the bead's own `status`/`close_reason` and its `human-replied` label —
`/api/comment`'s own tell for a real reply that has not yet been processed — one call
tells apart the three endings an answer can have: **closed** (`respond()`: a comment,
then `bd close` with reason `Answered via Beadcause`), **commissioned** (`commission()`:
a comment, the `human` label removed, reopened and unclaimed — an instruction to go
build it, not a verdict), and **deferred** (nothing on the bead at all).

**`--family` walks ancestors, not siblings.** Parent, grandparent, and so on, stopping at
the first bead with no parent — the `bc-jjdar.1` shape, where the bead itself is plain
work and the question it was opened over is actually on its parent. This is a different
walk from `b7e-prior --family`, which widens to every other child under a shared parent;
the two commands answer different questions and happen to share a flag name.

One block per bead in the chain — whether it carries a `decision` block, whether it has
been answered, which option was chosen (matched against the recorded response text), and
the outcome — then one verdict line naming the bead the answer is actually on, or saying
none of them in the chain carries one (the `bc-mwhkg.1` shape: nothing on the bead *or*
its parent, despite the brief).

**`bc-dgx7.95`: `close_reason` says a ruling happened, never what it was.** Every bead
`respond()` closes gets the identical constant string, `Answered via Beadcause` — that
is the whole of what the old fallback had to show once `state.json`'s own record had
gone (past its 30-day TTL, or the bead was answered by hand with a plain `bd comment`
rather than through the app). The actual choice is the comment `respond()` wrote
immediately before closing, and this now searches the thread for it — most-recent-first,
so anything said on the bead *after* the ruling does not get mistaken for it — and
resolves the chosen option from that text exactly as it would from a `state.json`
record. The option list prints with the taken one marked and `recommended` kept where it
was set; the comment's own text and timestamp print alongside it. A still-open bead
carrying `human-replied` gets the same search. The one case nothing can answer — closed
as a ruling with no comment on the thread at all — reads as the outcome
**`answered-but-unrecorded`**, not as an empty `(closed)`: the gap is real and the report
says so, rather than reading like a ruling with nothing behind it.

**Several beads in one call**, for the case `lm-3rn.2` needed it: 32 beads answered by
hand, where a `bd show`/`bd comments` pair per bead ran so slowly under contention that a
backgrounded script hadn't finished in five minutes. `-b` may be repeated
(`-b a -b b`) or comma-joined (`-b a,b`), or both. The batch form skips the extra
existence-checking `bd show` the single-bead form still does — a bead `beadAnswer`
itself cannot find comes back with an empty chain, which already says "not found" — so
it costs one `bd` read per bead in the chain rather than two, the other half of the
64-calls-for-32-beads this bead was filed to cut. `--json` becomes `{ beads, results }`,
one entry per requested id in the order given, `notFound: true` on the ones that
weren't there.

Exit codes: `0` ran to completion, whatever the verdict(s) — "nobody has answered this"
is a legitimate answer, not a failure; with several beads, `0` means at least one of them
was findable. `2` bad usage. `4` `-w` named a workspace this checkout's tracker does not
have, or (single-bead form only) `-b` named a bead it does not have.

Read-only: one `bd` read per bead in the chain (`bd show --include-comments`) in the
batch form; the single-bead form keeps its original extra existence check, so two for the
bead named on `-b` and one for each further ancestor `--family` walks to. Plus
`state.json`'s own `answered` map. Never a write. `Bash(b7e-answered:*)` is on
`DEFAULT_TOOL_LIST`, and `lib/grants.js` classifies it `read`.
