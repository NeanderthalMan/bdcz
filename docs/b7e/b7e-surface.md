### What a module exports, with the one line that says what each export is for — `b7e-surface`

`bc-dgx7.28` is the same shape breaking five times rather than once, found by
[the audit agent](../advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work)
watching five sessions (`bc-bmry.10`, `bc-bmry.11`, `bc-bmry.12`, `bc-khoe.33`,
`bc-xl7n.102`) each ask "what is in here that I can call" before writing against a
`lib/` file, and each invent a regex for it — `grep -n "^export"`, `grep -n "^export
function\|^export const"`, four more spellings across the other four. The tell is in
what came back empty: `bc-bmry.12` guessed `grep -n "^export function isRoot\|
^export function isEpic\|^export function isP0"` against `lib/ownership.js` and got
nothing, because all three are real — as arrow-valued `const`s, which the guessed
shape does not match — and an empty grep looks exactly like "this file has none of
those" whichever one is true. `grep`-for-`export` cannot answer the question at all
against a file whose surface is a *class*: `bc-bmry.10`'s
`grep -n "show(\|comments(\|list(\|ready(\|search("` against `lib/bd.js` came back
with nothing, because `show`, `comments` and the rest are methods on `Bd`, and a
class method carries no `export` keyword of its own. `b7e-def` cannot answer this
either — it takes a symbol name, and the whole point of the question is that the
name is not yet known.

```
b7e-surface <path> [<path> …]      one line per export: kind, name, signature,
                                     line number, first sentence of its doc comment
b7e-surface --all <path>           + module-private functions, consts and classes
b7e-surface --class <Name> <path>  only <Name>'s methods, whichever class it is
```

A module-level `export function`/`export class`/`export const|let|var` is found the
same way `b7e-def` finds a definition — matched against the trimmed start of a
line — restricted to lines at curly-brace depth `0`, so a same-shaped line inside a
function body is never mistaken for a second top-level export. **A file whose whole
surface is a class does not read as empty**: every class found this way (exported,
or — with `--all` — not) has its direct methods listed nested underneath it, found
the same disambiguated way `b7e-def` tells a method definition apart from a call —
the token immediately after the method head's own `(...)` closes must be `{` — and
at exactly one brace-depth deeper than the class's own body, which is what keeps a
bare `if (x) {` or `catch (e) {` *inside* a method from reading as a second, phantom
method of the class. `lib/bd.js`, whose module-level exports are five guard
functions and `Bd`, reads as those five and then `Bd` with its ~60 methods under
it — not as five lines and then silence.

A path that does not resolve to a real, readable source file is a refusal (a
message on stderr, exit `2`) — never empty output, which is exactly the shape that
cost `bc-bmry.11` and `bc-bmry.12` a lost call each: a guess that finds nothing
prints nothing, and nothing looks identical whether the guess was wrong or the file
was.

**What this does not do.** Destructured exports (`export const { a, b } = x`) are
not matched, the same bound `b7e-def` accepts for destructured imports. A class
field assigned an arrow function (`onClick = () => {}`) is not read as a method —
this codebase's classes use method-shorthand throughout — and comments are not
blanked before scanning, the same tradeoff `b7e-def` already makes. Signatures are
read off the source text by the same small hand-rolled scanner as the rest of this
family, not a real parser, and are truncated for display.

**A regex literal with a quote inside its own pattern is not a string.** `lib/bd.js`'s
`CLAIM_GUARD_RE` matches a `bd` error that itself quotes an assignee's name back —
`"[^"]*"` inside the pattern — and the first version of this tool read that
embedded `"` as a string opening, which put every brace and quote for the rest of
the file on the wrong side of it and lost all ~60 of `Bd`'s methods. Division and a
regex literal share the same leading `/` in JavaScript's own grammar, and this tool
resolves it the way a real tokenizer does: by the character immediately before —
an identifier, a number, or a value that just closed leaves a value behind, so `/`
next divides it; anything else — an operator, an open bracket, or nothing yet —
starts a regex.
