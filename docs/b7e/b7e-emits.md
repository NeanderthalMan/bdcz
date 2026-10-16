### Which line of code printed this — `b7e-emits`

`bc-dgx7.131` is the session audit: three sessions (`bc-xl7n.149`, `bc-xl7n.146`,
`bc-xl7n.150`) each needed the same fact — given a sentence observed in
`~/Library/Logs/beadcause.log` or on a console, which template literal in `lib/`
produced it — and plain grep cannot answer it, because the sentence is a template and
the *rendered* text is in no file. `bc-xl7n.149` needed the emitter of `"parked worker
bc-x — quiet for 20m"` and ran five searches that came back empty or broken before
falling back to a fragment that happened to also turn up the answer, incidentally, in
an unrelated grep's output several calls later. `bc-xl7n.146` had to prove the reverse
— that nothing was pinned to two strings it was about to change — and took four empty
greps to do it, filing the result as prose ("no test anywhere greps the log strings I
changed") that the next session could not act on without re-deriving it. `bc-xl7n.150`
read three call sites by eye to see which one matched.

```
b7e-emits "[advocate] beadcause: parked worker bc-x — quiet for 20m"
tail -1 ~/Library/Logs/beadcause.log | b7e-emits
b7e-emits "exited without closing"          a fragment is enough
b7e-emits -w loremia "..."                  another workspace's checkout
b7e-emits --json "..."
```

**Every template literal in `lib/` is a candidate, not only the ones inside a
`console.log(...)` call.** A daemon line is usually built by `console.log` with the
pieces already in one template, but the interesting fragment is very often assembled
several calls earlier and only ever *arrives* at that `console.log` as one of its own
interpolations — `lib/advocate.js`'s `finish` prints `` `[advocate] ${a.name}: ${w.id}
— ${why}` ``, and `why` is built at the call site, several hundred lines away, as `` `the
session exited without closing it${ended.code ? ` (exit ${ended.code})` : ''}` `` and
never touches `console.log` directly. A search scoped to `console.log`'s own arguments
finds the wrapper and nothing for the sentence actually asked about — exactly
`bc-xl7n.146`'s second example — so this reads every template literal in the tree.

**A hole whose whole expression is a two-branch ternary of string literals** —
`` ${bringBack ? 'parked' : 'closed'} `` — **is matched as a two-way choice, not an open
wildcard.** `lib/advocate.js`'s `finish` alone has 57 near-identical `${a.name}: ${x} —
${y}` call sites, none of them naming which one printed a given line any more precisely
than any other; the choice hole is what lets the one candidate that pins `"parked"` to
a real branch of real code outrank all 57 of them, without evaluating the *condition*
that picks a branch — only that both branches are fixed text, so the true value is one
of exactly two known strings regardless of which one ran.

**Three ways to match, because a fragment can be shorter or longer than the line it
came from.** The whole template, anchored, consuming the whole observed text (every
hole resolved) is a *line* match. A short fragment sitting entirely inside one of the
template's own literal segments — `bc-xl7n.146`'s `"exited without closing"` inside
`` `the session exited without closing it${…}` `` — is a *fragment* match with no hole
resolved, because none had to be. And a longer fragment that also happens to span one
or more holes is found by trying every contiguous run of the template's segments,
unanchored, against the observed text, and keeping the run that covers the most
segments.

**The report, per candidate: file:line, the template verbatim, the observed text
annotated in place** (`[worker=${rec.kind}]`, `[quiet for 20m=${said}]` — the exact
labelling the bead itself was filed to produce) **and "pinned by"** — every
`test/*.mjs` or `public/*.js` file that already carries one of the template's own
literal substrings, `bc-xl7n.146`'s four hand-run greps in one call.

A template past eight holes is not read as a candidate at all — a multi-paragraph
prompt (`lib/session.js`'s `workPromptFor` alone has 96) is not a log line, and
matching a short observed string against dozens of non-greedy wildcard groups is both
meaningless and, multiplied across the ~5,000 templates in `lib/`, slow enough to
matter: unbounded, one query took over two minutes against this repo's own tree; capped,
comfortably under a second.

`bin/b7e-emits` declares `@grant read` (nothing to add to `lib/toolbelt.js`); it only
ever reads `lib/`, `test/` and `public/` off disk, and the one `bd`-adjacent thing it
touches is `lib/session.js`'s `resolveSessionDir`, for `-w`. Exit `0` — at least one
candidate matched. `1` — no template in the tree could have produced the given text,
a real answer rather than a crash. `2` — bad usage. See `bin/b7e-emits`, `lib/emits.js`
and `test/b7eemits.mjs`.
