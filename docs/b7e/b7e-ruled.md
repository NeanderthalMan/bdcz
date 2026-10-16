### Has Adam already decided this — every ruling on a topic, newest first — `b7e-ruled`

`bc-dgx7.102`: several sessions each needed to know, before writing a decision card,
whether Adam had already ruled on the question, and each worked it out by hand from
`bd show`/`bd comments` greps.

```
b7e-ruled -w myproject "chapter word count"
b7e-ruled -w myproject -b mp-afr.9            topic taken from that bead's own title
b7e-ruled -w myproject "travel times" --since 2026-08-01
b7e-ruled -w myproject "travel times" --json
```

**The tracker is the corpus.** What this reads: closed beads of type `decision` or
labelled `human` (or the workspace's approval review label), each with the ruling text
pulled from the comment `respond()` wrote right before closing (reusing `lib/beadanswer.js`'s
`answerFromComments` rather than re-deriving it — the fix for `bc-dgx7.95`'s
`answered-but-unrecorded` gap applies here too); and the same beads still open, reported
as still awaiting Adam rather than as a ruling. A repo's own files — a change log,
reference prose — are deliberately not read: they have no shared shape a generic tool can
scan honestly (bc-j2zwo.6 removed the one repo-specific `CHANGE_LOG.md` reader this used
to carry, along with its `--dir`, `--base` and `--file` flags).

**Matching is deliberately plain.** Every significant word (3+ letters, past a short
stopword list) in the topic must appear, case-insensitively, somewhere in the candidate's
title, description, design, notes or acceptance criteria. It is the rule an agent typing a
topic phrase can predict.

`lib/ruled.js` is the read — `findBeadRulings`, newest first. `bin/b7e-ruled` is the argv
shell and the printing. `-b`/`--bead` is a convenience, not a second question: given
instead of (or alongside) a topic, it pulls that bead's own title in as the search text,
for the case in hand where you have a candidate bead but no topic phrase yet typed out.

Exit codes: `0` ran to completion, whether or not anything was found — no ruling on a
topic is a legitimate, useful answer, not a failure. `2` bad usage — no `-w`, or neither a
topic nor `-b`. `4` `-w` named a workspace this checkout has no config for, or `-b` named
a bead the workspace does not have.
