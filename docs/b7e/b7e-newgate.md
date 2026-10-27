### The house shape for a new gate in a workspace repo, computed from the gates already there — `b7e-newgate`

`bc-dgx7.107`. Three delmar sessions — `dv-5eu.11`, `dv-52r.6`, `dv-52r.7` — each added a
`scripts/check_*.py` to that repo the same day, and each began by opening a couple of
neighbouring gates to work out the house shape, because it is written down nowhere.
`dv-52r.6` read four before writing one; `dv-52r.7` read all 276 lines of
`check_weapon_depiction.py` to extend it, then spent four edit rounds untangling its
shared `asserted()` helper. They did not converge: eighteen-plus of delmar's own gates
write `checks = 0` / `failures = []`, a `check(cond, msg)` closure, and a `ran N checks`
… `PASS` / `FAILED — N problem(s)` ending, and `dv-52r.6`'s gate printed
`"checked %s for %d …"` / `"FAIL — %d problem(s):"` instead — a different verb, a
different dash, a different frame, found only because a session audit read all three
afterwards (`bc-dgx7.1`). [`b7e-harness`](b7e-harness.md) is the same idea one repo over and does not
reach this: it is wired to `test/*.mjs` with four JS-suite kinds, and delmar has no
`test/` at all.

```
b7e-newgate -w delmar --shape
b7e-newgate --dir <checkout> --shape
b7e-newgate -w delmar --for scripts/check_new_thing.py > scripts/check_new_thing.py
b7e-newgate -w delmar --for scripts/check_new_thing.py --selftest
```

The skeleton goes to **stdout** and the notice — the nearest gates to read, and a
registration checklist — to **stderr**, so `> scripts/x.py` is the whole workflow, the
same split `b7e-harness` uses.

**Not a template, and not `b7e-harness` widened.** `lib/harness.js` votes two-phase, over
four kinds of suite, because JS suites disagree a dozen ways about how to spell the same
binding. A gate corpus is a few dozen files, one kind, not four, so `lib/newgate.js`
votes once — a slot wins on a plain majority of the corpus, and its spelling is the modal
text among the gates that have it — which is enough for this corpus and simpler to read.
It is still computed, not templated: every line the skeleton prints is text some existing
gate actually wrote, chosen by count, so a corpus that converges on something else prints
something else. `test/newgate.mjs` proves this against a small fabricated corpus that
votes the other way, on top of the real delmar evidence above.

**Python statements are indentation-delimited, not brace-delimited.** `lib/harness.js`'s
`statements()` closes a JS statement when bracket depth returns to zero, which is sound
where a block is `{ … }`. A Python `def`/`if`/`for` block has no bracket to close, so
`statementsPy` closes a statement only when a line starts at column zero, carries zero
bracket depth *carried in* from the lines before it, and is not a backslash continuation
— which is what lets `def check(cond, msg): …` read as one statement including its
indented body, while a multi-line bracketed literal that happens to close with a lone `]`
at column zero is not mistaken for a new top-level line, because the depth carried into
that line is still nonzero.

**The ending is voted role-first, text-second, for the same reason `lib/harness.js` votes
two-phase.** No two gates spell the tally line (`print("ran %d checks" % checks)` vs. an
f-string, vs. one with extra context appended) quite the same way, so voting on exact text
would lose it a majority it plainly has; `roleOfEnding` classifies it as `print-tally` by
what it mentions (the `checks` counter) rather than by its literal text, and the modal
spelling among gates with that role wins.

**Discovery reuses `lib/checks.js`'s `checkPyFiles`, not a second glob** — the same
`scripts/check_*.py` list `b7e-checks` runs is what this votes over, split into gates and
their `_selftest.py` twins. **`--selftest`'s scaffold is not a voted shape**, unlike the
gate itself: only one of delmar's fifteen existing twins matches any other on the exact
preamble spelling, because each imports a different callable from the module it tests.
What is common to all of them — import the module under test, a case list, a runner loop,
`ok`/`FAIL` printing, a summary line, `sys.exit` on failure — is structural rather than
textual, so `--selftest` emits that structure with the case list empty rather than
guessing at cases.

**The registration checklist is computed too, not asserted.** Of the bead's own three
sessions, only one added a `CLAUDE.md` reference-table row and none wrote the
`_selftest.py` twin most of the corpus's gates have — so `registrationChecklist` reads
the target `CLAUDE.md` for the `| <topic> | … gate \`scripts/check_<name>.py\` |` rows
that already exist and reports how many, rather than asserting a row is always owed (not
every gate polices a single canonical fact worth a table row).

**The output runs.** The generated gate skeleton executes, green, with zero checks in it,
before anything is added — the same acceptance `b7e-harness`'s skeleton holds itself to —
and so does the `--selftest` scaffold, printing `0 cases, 0 failed` / `PASS`.

`Bash(b7e-newgate:*)` reads the target checkout's `scripts/*.py` and its `CLAUDE.md`, and
writes to stdout only — see `@grant read` in `bin/b7e-newgate`'s own header,
`lib/newgate.js` and `test/newgate.mjs`.
