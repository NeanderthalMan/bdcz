### Which suites read this file as text, and what shape they demand of it — `b7e-reads`

`bc-dgx7.114` is the same shape breaking five times rather than once. Five sessions
(`bc-7qo.9`, `bc-arj0.23`, `bc-2uj4.9`, `bc-dgx7.16`, `bc-dgx7.15`) each independently
guessed which `test/*.mjs` suites `readFileSync` a `lib/`/`bin/` file and assert a
regex against its raw text — a static-read guard, not an import — and each guessed a
different subset. `bc-2uj4.9` guessed wrong: it added `heldByWorker` to
`lib/reenter.js` and found out from a red `test/surveybrief.mjs` in the full gate,
after which it had to `grep -n "QUEUE_HOLDS" -r lib/ test/` to read the guard, rename
the export across four files, and re-run. This is the read that would have told it
before the edit what the gate told it after.

```
b7e-reads lib/advocate.js               every suite that reads it as text, and the pattern each applies
b7e-reads lib/advocate.js heldByWorker  narrowed to the patterns that identifier would actually trip
b7e-reads lib/advocate.js --json        one object instead of the printed report
b7e-reads --dir <root> lib/x.js         a different checkout, not this process's cwd
```

A statement anywhere in `test/*.mjs` counts as reading the file when its
`.readFileSync(...)` call's first argument names it — the exact basename as its own
string literal, reached directly, through a `path.join(...)` pair, or through a locally
defined `LIB('advocate.js')`-style helper, confirmed against a second literal in the
same statement naming the file's own directory as a whole word, so a basename collision
with an unrelated file elsewhere in the tree does not silently match. The local it binds
seeds the same one-hop holder tracing `b7e-pinned` uses (`lib/pinned.js`'s
`deriveHolders`, unchanged), so `const code = blankComments(daemon)` is traced the same
way `test/surveybrief.mjs` traces it, and every `assert.match`/`equal`/`strictEqual`/
`deepEqual`/`deepStrictEqual`, bare `.test(`, `.includes(`, `.match(`/`.matchAll(`, or
`.indexOf(` on a holder is read for the pattern it pins.

Each finding is flagged with the shape it demands:

- **`IDENTIFIER-FAMILY`** — a regex whose own source carries a `\w` class, so it is
  collecting a *family* of names sharing a prefix rather than one exact word. The
  bead's own example: `code.match(/heldBy\w+/g)`.
- **`IMPORT-ORDER`** — two `.indexOf(...)` calls on the same holder, in the same
  statement, compared with `<` or `>` — an assertion about which of two things appears
  first in the source, not about either one's exact words.
- **`HAS-COUNT`** — the pinned text itself carries a digit or a spelled-out count (the
  same `one` through `twelve` list `b7e-pinned` checks for), because a count baked into
  a regex or a string is the shape that breaks silently on the next one added.
- **`WHOLE-EXPRESSION`** — the default: an exact literal or regex, pinned as itself,
  when none of the above three apply.

`name`, given as a second positional, narrows findings to the ones that identifier would
actually trip rather than every pattern the file's readers carry — a regex finding whose
pattern does not match `name`, or a string finding that is not a substring of it either
way, is dropped. The suite itself is still reported (it does still read the file as
text), only its finding list narrows — `b7e-reads lib/advocate.js heldByWorker` still
names `test/surveybrief.mjs`, but only the `/heldBy\w+/g` line, not every other pattern
that file pins against `lib/advocate.js`'s source.

**What this does not do.** Same bound `b7e-pinned` states for its own regexes, and it
fails in the quiet direction: a pattern assembled across a ternary, a template
expression, or a helper called three names deep — `blockLines(toolbeltSrc, /regex/)`,
where the pattern is a bare argument to a custom helper rather than a method call on
the holder — is missed, not misreported. `deriveHolders` has no scope awareness, so two
unrelated `readFileSync` sites in one file bound to the same local name
(`test/reenter.mjs` does this twice, both named `src`) are folded into one holder set
for the whole file. Only `fs.readFileSync` is recognised, and only its first argument.

Exit code is a report's, not a gate's: `0` whether or not anything is found — a file no
suite reads as text prints nothing and exits `0` — and `2` only for a path that does
not resolve to a file. Read-only by construction: every path through it is a
`readFileSync` and a regex, and it never runs a suite or imports the file it reads.
