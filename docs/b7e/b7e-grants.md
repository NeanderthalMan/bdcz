### Is this command granted to dispatch or withheld — and which paragraph decided it — `b7e-grants`

`bc-dgx7.111`, filed by the session audit against six sessions (`bc-dgx7.87`,
`bc-dgx7.90`, `bc-dgx7.92`, `bc-dgx7.91`, `bc-dgx7.86`, `bc-dgx7.97`) that each shipped a
`b7e-*` command and each had to decide for itself whether `dispatch` gets to call it —
and each found the precedent by guessing which sibling was analogous and reading the
registry at random offsets: `grep -n "b7e-apply\|b7e-gate\|b7e-worktree\|b7e-call\b"`,
then `sed -n 400,470p`, then a `find . -iname grants.js` when the guess was wrong. One of
those guesses (`bc-dgx7.87`) named a sibling in passing and, under the reading that
existed then, that accidentally *decided* something about it — caught and re-filed as a
whole extra session (`bc-dgx7.90`).

```
b7e-grants                every b7e-* command, one row each
b7e-grants b7e-x           just that command's verdict
b7e-grants --undecided    only the commands nobody has decided about at all
b7e-grants --json         one JSON object per line instead of the printed report
```

**The bead was filed against an architecture `bc-wbrhi` replaced the day it landed.**
Back then the decision lived in `lib/toolbelt.js`'s prose, and a command's bare name
turning up anywhere in it read as decided — the exact trap the paragraph above
describes. Since `bc-wbrhi`, **the decision is a command's own `@grant read|write|
excluded` header line**, and this reads nothing else to answer `status`: granted, or
withheld (`excluded`), or undecided (no `@grant` line at all). A name appearing inside
`lib/tooldecl.js`'s prose is surfaced separately, as `mention`, explicitly not folded
into the decision — `b7e-say` is mentioned in `lib/tooldecl.js`'s own opening docstring
and is still, correctly, undecided.

**"Which paragraph decided it" is the command's own header.** `decidedAt` is always
`bin/<name>`'s own `@grant` line — the actual decision, for granted and withheld commands
alike. For a withheld command, the paragraph arguing *why* sits in the same header,
directly above that line, since `bc-fmk4v` moved every grant argument there out of
`lib/tooldecl.js`. It is found by the fixed phrase those paragraphs open with and
`lib/enroll.js`'s applier writes (`"<name> is deliberately NOT on DEFAULT_TOOL_LIST.
<why>"`, or the older `this list`), matched only when the command's own name sits
immediately before it, never merely nearby. A header that argues the exclusion without
opening on its own name ("Deliberately NOT on `DEFAULT_TOOL_LIST`: …") still gives its
reason: the paragraph matching the same `deliberately (NOT on|excluded)` test
`test/pertoolfiles.mjs` applies, read only from the tool's own header, where every such
paragraph is about the tool itself. A withheld command whose header has no such
paragraph gets `reason: null` rather than an invented one.

`lib/grantsmap.js` is the read: `grantVerdict` for one command, `allVerdicts` for the
whole candidate union (the same one `b7e-which` and `b7e-enroll` use), and
`excludedParagraphs` for the header reading. `bin/b7e-grants` is the argv shell and the
printing. `--dir` reads another tree directly — this is how it is tested.

Exit codes: `0` ran to completion, whatever it found — undecided is an ordinary result.
`2` bad usage, an unknown command name, or `--dir` naming something with no `bin/` of its
own.

`bin/b7e-grants` declares `@grant read`. See `bin/b7e-grants`, `lib/grantsmap.js` and
`test/b7egrants.mjs`.
