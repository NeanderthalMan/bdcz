### Does lib/ already have a function for this — and is it exported — `b7e-already`

`bc-dgx7.81` is the session audit: five beads (`bc-dgx7.64`, `bc-dgx7.62`, `bc-dgx7.61`,
`bc-dgx7.63`, `bc-xl7n.76.3`) each asked "is there already something in `lib/` that does
X" before writing their own, and each answered it with a different pile of speculative
greps against 284 modules. `bc-dgx7.62` found `ago(ms)` in three calls and then spent a
fourth discovering it was not exported. `bc-dgx7.64` grepped `^export function
resolveSessionDir` twice and got nothing, because the real declaration is `export const
resolveSessionDir = (cfg, workspace, bead = null) => ...` — an arrow assigned to a
`const`, a shape that pattern structurally cannot match. `bc-dgx7.62` also spent four
more calls enumerating what the `Bd` class offers, one grep at a time.

```
b7e-already <words>...            match against every declaration in lib/, bin/ and
                                   scripts/ — name and the first line of its doc comment;
                                   exported and private both, private labelled distinctly
b7e-already <words>... --private  only the private (unexported) matches
b7e-already --module <file>       everything one file declares, class methods included —
                                   no search, the whole surface
b7e-already --dir <root>          "this tree" is <root>
```

**Exported and private, in one call.** Unlike `b7e-import`'s `findExporters` — which
only ever names where a symbol *is* exported from — a query here matches every top-level
`function`/`const`/`let`/`class` declaration whether or not it is exported, because "it
exists but you cannot import it" is exactly the answer that cost two of the five
sessions a wasted search each. Each hit prints as `<file>:<line> <export|private>
<signature> — <first line of its doc comment>`, best match first.

**By description, not by literal string.** A query word matches if it appears anywhere
in a candidate's name — split on camelCase/`SCREAMING_CASE` boundaries first, so
`resolve session dir` matches `resolveSessionDir` the way `^export function
resolveSessionDir` never could — or in the first line of its own doc comment. Not every
word has to match: `time ago` still surfaces `ago(ms)`, whose doc ("How long ago, in the
words a refusal can use.") never says "time".

**`--module` is the other question** — not a search, the whole surface of one file:
every declaration `lib/bd.js` makes, class methods included, which is what `bc-dgx7.62`
spent four separate greps assembling by hand.

Exit codes: `0` at least one match (or `--module` found declarations to list). `1`
nothing matched — a legitimate answer, not a crash. `2` refused — bad usage, or
`--module` named a file that can't be read.

Read-only in the same construction as `b7e-def`/`b7e-import` above: its own acorn parse
over `lib/`, `bin/` and `scripts/`, comments included — which `lib/imports.js` doesn't
collect, since this is the one question that needs them. `Bash(b7e-already:*)` is on
`DEFAULT_TOOL_LIST`, and `lib/grants.js` classifies it `read`.
