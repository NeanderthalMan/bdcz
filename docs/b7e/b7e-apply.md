### `b7e-apply` — an anchored edit, all-or-nothing and syntax-checked

The library the section above describes has a new tenant. A session audit
found the same tiny program written into a scratchpad and run as a program, by hand, in
five separate sessions: bc-khoe.26 wrote fourteen of them (`css1.py`, `t1.py`…`t7.py`,
`r1.py`…`r3.py`…), bc-khoe.27.3 wrote seven, bc-khoe.27.2 wrote nine and only started
after `Edit` twice refused a comment-heavy block of `public/app.js` with "String to
replace not found in file". Every one opened with the same five lines — read the file,
assert an anchor string appears exactly once, replace it, write, then `node --check` or
run the file's own suite — and two of the hand-rolled ones failed on their own escaping
and cost a further two round trips. The per-change decision, which anchor and what to put
in its place, was the work; retyping the applier around it, badly, eight ways, was not.

`b7e-apply --file <path> --anchor <old> --to <new>` does one pair; `b7e-apply --patch
<edits.yaml>` (or piped on stdin) does several, across one file or several, from a flat
YAML or JSON list of `{file, anchor, to, count?}` — YAML because a multi-line replacement
wants a block scalar, not a shell argument. **All-or-nothing across the whole patch**:
every anchor is resolved against an in-memory copy of its file, in order, before a single
byte reaches disk — an edit later in the patch sees an earlier edit to the same file
already applied. Each edit defaults to `count: 1`: the anchor must match exactly that many
times, and all of them are replaced. The first anchor whose match count disagrees with its
`count` stops everything there, with the expected and found counts, the nearest line by
word overlap (a hint that the anchor drifted since it was read, not a claim about the right
line), and nothing written anywhere — including files whose own edits had already resolved
cleanly. A `.js`/`.mjs`/`.cjs` file is then run through `node --check` (reusing
`parseError` from lib/conflicted.js, the same parse the committed-conflict-marker check
uses) against its *computed* text, still before any write, so an edit left unparseable is
caught here rather than 38 suites into the next `npm test`, reading as an unrelated
regression. A successful, non-`--dry` run then prints a plain-whitespace word-count delta
for each file it actually changed — `path  +12 words` or `path  -340 words` — which is
what bc-dgx7.179 added for the prose sessions that were cutting a chapter to a word target
and re-running `wc -w` by hand after every pass; a file whose word count didn't move prints
nothing. `--dry` no longer aborts at the first bad anchor either: it walks the whole patch,
prints one status line per edit (`ok`, or `FAIL` with the expected-vs-found detail), and
only then exits non-zero if anything failed — so a 49-edit dry run shows every problem in
one pass instead of one round trip per anchor. A real (non-`--dry`) run keeps stopping at
the first failure, since there is nothing left to check once it is about to write.

**Its own filename is the answer to a question two other beads were meant to decide.**
`lib/foundation.js` puts the main checkout's `bin/` on `PATH` directly — no `npm link` —
which resolves a command by the exact name typed: `bin/beadcause-memory` answers to
`beadcause-memory`, but `bin/deliver.js` does not answer to `beadcause-deliver` (bc-jlop).
An allowlist entry matches the command as typed, so a file named `b7e-apply.js` could only
ever be reached as `b7e-apply.js`. This one has no extension — still ESM, since
`package.json` says `"type": "module"` and node infers that for an extensionless entry
point — so the name on disk, the name in `package.json`'s `bin` map, and the
`Bash(b7e-apply:*)` allowlist entry all agree. bc-dgx7.2 is meant to settle this
convention properly and sits blocked behind bc-jlop; neither had landed when this shipped.
