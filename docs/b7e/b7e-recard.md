### Retire the answered block and put the next question where the card reads it — `b7e-recard`

`b7e-card` just above says what the phone *will* show. This is the write half: the bead
has been answered, the answer commissioned work rather than closing anything, and the
card is still drawing a question that is settled.

`bc-dgx7.27`: three sessions — `bc-khoe.33`, `bc-xl7n.77.1`, `bc-1kwl.29` — each opened
on exactly that bead and each built the same transaction from scratch. `bc-khoe.33`
dumped `design` to `/tmp`, assembled the archival comment in `python3`, posted it, wrote
a new `design` from a heredoc, and ran a third `python3` to cut the stale block out of
`notes` — which came back `--notes replaced existing notes (use --append-notes to
preserve)`. `bc-xl7n.77.1` wrote `newdesc.md`, updated, verified through `toQuestion`,
commented, labelled `human` — and then did the whole thing again the next day as
`newdesc2.md` when the answer changed. `bc-1kwl.29` wrote a scratchpad script that
prepended a banner and replaced the trailing question while asserting the body stayed
byte-identical, then ran its own "which block would render" check.

```
b7e-recard -w beadcause -b bc-xyz < next.md          the next question, from stdin
b7e-recard -w beadcause -b bc-xyz -f next.md         …or from a file
b7e-recard -w beadcause -b bc-xyz -f next.md --dry-run
b7e-recard -w beadcause -b bc-xyz -f next.md --reason "split-30, answered 2026-08-22"
b7e-recard -w beadcause -b bc-xyz -f next.md --field design --no-keep
```

**The trap all three were working around is field precedence.** `toQuestion`
(`lib/decision.js`) reads `description`, then `design`, then `notes`, and takes the
**first** block it finds — so a new block appended to `notes` on a bead whose `design`
still holds a spent one renders nothing new. `bd update` succeeds, the notes read
perfectly, and the phone draws the old question; the answer Adam then taps is recorded
against a question nobody asked. That is the whole of the repo memory note
`a-spent-decision-block-in-design-outranks-a-new-one-in-notes`, and it is a rule a
command should hold rather than a fact each session rediscovers.

So one call does six things, in this order: validate the new text against `decisionTail`
(a block, last, with a recommendation on it if it has options); read the bead and find
**every** block on it; archive the ones it is about to cut, verbatim, in one comment;
write the new text into `--field` (default `description`) after that field's surviving
prose and a one-line banner; clear the competing blocks out of the other two fields; and
read the bead back through `toQuestion` — the same code the phone runs — refusing to
call it done unless exactly one block survives and the card asks what went in.

**A malformed block writes nothing at all**, which is why validation is step one and
happens before the tracker is read: no block, a block that is not last, a block whose
YAML will not parse, options with nothing `recommended` — each exits `2` having spawned
no `bd` at all.

**It never clobbers a field.** Every write is that field's own prose with the blocks cut
out of it, so a `<!-- beadcause:… -->` marker anywhere in the three survives — and a
computed body that has lost one is refused rather than written, because `alreadyAsked`
(`lib/superseded.js`) matches those across all three fields and dropping one re-asks a
question that has already been asked. The banner is the one line it writes of its own,
and a second run replaces the first one's rather than stacking them; every retirement is
recorded with its `--reason` in the archive comment anyway.

**It says out loud when a cut block was a machine sweep's.** `supersedeAsk`,
`inMainAsk` and `finishedEpicAsk` each raise their card by appending a block *and* a
marker to `notes`, and that produces two things worth naming, either of which can happen
alone. A block is **shadowed** when the bead's description already carried one — that
card was never drawn and nobody ever saw it, so cutting it changes nothing anybody could
read. A block is **final** when its field carries a `<!-- beadcause:… -->` marker, drawn
or not: `alreadyAsked` (`lib/superseded.js`) reads that marker across all three fields
and will not ask again, and the marker stays, because it is what stops the sweep asking
twice. Neither is a refusal — retiring a question is the whole job — but both are said
rather than quietly done.

Exit codes: `0` written, or `--dry-run` printed; `1` the writes went out and the readback
disagreed — the card on the phone is not the question that was handed in; `2` refused
before anything was written.

**On `DEFAULT_TOOL_LIST`**: `@grant excluded` in its own header — the `b7e-say`/
`b7e-write` shape, not the `b7e-card` one beside it. It rewrites the question a bead is
asking, and `dispatch`, the one agent that list governs, answers a single comment and
exits. The workers this was built for already carry an unrestricted allowlist. See
`bin/b7e-recard`, `stripDecisionBlocks` in `lib/decision.js`, and `test/b7erecard.mjs`.
