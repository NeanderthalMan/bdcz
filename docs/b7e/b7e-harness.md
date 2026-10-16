### The house shape of a suite, computed rather than copied — `b7e-harness`

`bc-zjab.11`. Six sessions wrote a suite in this repo and all six began the same way: by
opening a *different* neighbouring suite and reading its preamble to copy it. `bc-zjab.2`
read five ranges across three files — `test/planbrief.mjs`, `test/epicqueue.mjs`,
`test/epicplan.mjs` — before it could write `test/plandispatch.mjs`. `bc-bmry.3` read
`test/prbase.mjs`, then grepped `test/wsshape.mjs` for its imports, then took lines 53–80
for the `HERE`/`ROOT`/`LIB` block and `tail -12` for the ending. `bc-arf8` read
`test/mergequeue.mjs` twice for its recording fake `bd`. `bc-5e85` approached it as a
survey instead and established *by counting* that this repo does not use `node:test`.
There is a house shape — 352 of the 412 files under `test/` open with their own `const HERE
= …` and 395 declare their own `failures` counter — and it was written down nowhere, so "the
house shape" meant whatever file the last person happened to open.

```
b7e-harness --kind lib  --for lib/prbase.js > test/prbase.mjs
b7e-harness --kind tick --for lib/advocate.js
b7e-harness --kind app  --for p0RelayHtml
b7e-harness --kind bin  --for bin/deliver.js
b7e-harness --like test/plandispatch.mjs --for lib/beadfiles.js
b7e-harness --kinds
```

The skeleton goes to **stdout** and the notice to **stderr**, so `> test/x.mjs` is the
whole workflow.

**It is not a template, and that is the whole design.** A hard-coded skeleton would be a
second source of truth for a shape with four hundred witnesses, and it would be wrong the
first time the convention moved and *right-looking* for months afterwards. So every line is
voted for by the suites already in `test/`: each is decomposed into the same seven slots —
shebang, the docblock's run lines, imports, preamble, the `check`/`ok`/`bad` harness, the
declarations below it, the ending — and the shape of a kind is the slot-by-slot majority
among the suites of that kind. `test/harness.mjs` proves this by pointing the same
derivation at a small fabricated corpus that writes `const BASE = …` and runs itself with
`yarn verify`, and asserting the output says `BASE` and `yarn verify`.

**The vote happens twice, over two different things.** A majority of a kind decides *which
bindings a suite of this kind has*; a plurality of the suites that have each one decides
*how it is written*. Voting on exact text answers the wrong question — the 232 `lib` suites
agree almost unanimously that a suite opens with a `ROOT`, and disagree a dozen ways about
how to spell it, so counting spellings loses `ROOT` a majority it plainly has. The
threshold is two fifths rather than half for the same reason in the other direction: rank
what the `lib` suites declare and there is a plateau — `HERE` 192, `tmp` 129, `LIB` 115,
`ROOT` 112, the two config-dir lines 100 and 98 — and then a cliff to 53. That plateau *is*
the preamble, and `LIB` and `ROOT` sit one and four suites below half.

**The four kinds are read off an existing suite the same way they are chosen for a new
one**, by `classifySuite`:

| kind | what it is | suites |
|---|---|---|
| `lib` | a pure export out of `lib/`, imported and called directly | 232 |
| `app` | a function lifted out of `public/app.js` and run in a `node:vm` | 17 |
| `tick` | an advocate tick against a fake tracker, with `open` injected | 35 |
| `bin` | a command under `bin/` driven end to end as a subprocess | 128 |

The marker for `app` is the *lifting*, not the mention: a suite that merely reads
`public/app.js` as text is a static read and wants a `lib` preamble. Widening it to the
mention doubles the group with suites that share none of its shape, and `lift` — the one
helper that kind cannot do without — then loses its majority to them. That marker is also
the one thing read off the code with **strings** blanked as well as comments, because it is
a call rather than a module name: `test/harness.mjs` asserts on the exact opener string
`lift(APP, 'function p0RowHtml(card, row)')`, and read the lenient way it classified itself
as an app suite and joined the corpus it was measuring.

**The `app` kind owes one more thing, and it is the expensive half.** A function lifted out
of `public/app.js` is listed in several suites at once, because each lift list is the
renderer *and every function it calls*; a list missing the new one dies with `<name> is not
defined` from inside the `vm`, in a file you did not touch. `bc-bmry.4` found its three —
`p0card.mjs`, `p0bead.mjs`, `p0start.mjs` — only by watching 26 of 55 assertions fail.
Asked about a `public/app.js` function, this names them in the generated docblock and again
on stderr, with the exact `lift(APP, 'function p0RowHtml(card, row)')` opener each one needs.
The answer is the **direct** callers only: `public/app.js` is one IIFE whose renderers all
reach each other eventually, so walking the call graph up from any symbol reaches 581 of its
600 declarations and names three quarters of the app suites — and it is the wrong question
besides, since a lift is a textual slice and only a lifted function whose *text* names the
symbol can break.

**The output runs green with zero assertions in it**, for each of the four kinds — that is
the bead's acceptance and `test/harness.mjs` generates all four into a sandbox and executes
them. A pure majority vote does not give you that on its own: a slot can win and reference a
binding that lost. So the render finishes with a completion pass — anything the assembled
file names but never binds is looked up in the corpus and its commonest declaration pulled
in, but only a candidate that introduces no new unknown of its own, and never more than
eight. The first version had neither rule and produced a thousand-line file made of other
suites' fixtures.

**Two scanner bugs are pinned as regressions rather than described**, because each one is
silent and each collapses a whole suite into a single statement — in the direction that
looks like agreement. A suite that prints in colour writes `\x1b[32m`, which is an unmatched
`[` inside a string; and `/[&<>"']/g` is a lone double quote inside a regex, which a scanner
that does not know a regex from a division reads as the start of a forty-line string. Before
`blankLiterals` handled both, 241 of the 411 suites were parsed as one statement each and
handed the vote nothing.

`Bash(b7e-harness:*)` is on `DEFAULT_TOOL_LIST` and `read` in
`lib/grants.js` — it is the plainest read on that list, spawning no subprocess at all: it
reads `test/*.mjs` and `public/app.js` off disk and writes to stdout. See `bin/b7e-harness`,
`lib/harness.js` and `test/harness.mjs`.
