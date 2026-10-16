### Which test assertions are pinned to the exact words of a module's prose — `b7e-pinned`

`bc-khoe.27.12` is the same shape breaking repeatedly rather than once. Three sessions
(`bc-bmry.8`, `bc-bmry.7`, `bc-xl7n.99`) each edited a generated brief by hand — `lib/session.js`'s
`workPromptFor`, `lib/epicadvocate.js`'s `epicAdvocatePrompt` — and each learned which of
its words were load-bearing by breaking one and reading the failure: a guessed
`grep -rn "a\|b\|c" …` that still shipped a red because a line wrap put a newline where
`test/onelaw.mjs`'s own pattern had none, a count baked into a regex nobody remembered was
there (`/three honest endings/`, now `/four honest endings/`, which will break again on the
fifth), four corrective `Edit`s narrated "let me clean this up properly" to a suite whose
substrings were found by trial rather than read off a list.

```
b7e-pinned lib/session.js               every export's output, across every suite that reads it
b7e-pinned lib/session.js workPromptFor narrowed to one export's output
b7e-pinned lib/session.js --json        one object instead of the printed report
b7e-pinned --dir <root> lib/x.js        a different checkout, not this process's cwd
```

For every `test/*.mjs` suite that imports the module, it traces which *local names*
actually hold the module's output — the module's own exports, plus, transitively, any
local `const NAME = …` whose right-hand side calls one of them (the one-hop indirection
`test/onelaw.mjs`'s own `briefFor` is over `workPromptFor`) or any destructured binding
of one (the `for (const [name, brief] of […])` shape `test/land.mjs` walks its three
endings with) — and reports every string or regex literal an `assert.match`/`equal`/
`strictEqual`/`deepEqual`/`deepStrictEqual`, a bare `.test(`, or a bare `.includes(`
checks one of those names against. Three flags per literal:

- **`NOT IN SOURCE`** — the literal (or, for a regex, the pattern itself) does not
  match the module's source text today. A stale pin, or wording this static a read
  cannot trace through a `.push()`-built or interpolated string — either way, worth a
  look before the words under it move again.
- **`HAS-NEWLINE`** — a literal `\n` inside the pattern, so a rewrap of the source
  breaks the assertion with nothing about the suite's own name to explain why. The
  argument the bead itself was filed over: `test/planbrief.mjs`'s `/no path here by
  which an agent endorses its own\nsubtree/` is exactly this shape.
- **`HAS-NUMBER`** — a digit, or a spelled-out count (`one` through `twelve`) — a count
  baked into a regex needs updating by hand every time the thing it counts changes, and
  a plain `\d` check misses `/four honest endings/` entirely because there is no digit
  in it at all.

**What this does not do.** It is not a JS parser. Statements are split by
`lib/harness.js`'s `statements()` — the same bracket-depth splitter the house test-shape
tool already trusts — glued back across an arrow function's line break, and calls are
found and their arguments split by a small hand-rolled tokenizer, not an AST. A local
name is only ever traced by *name*, never by import alias — `const { workPromptFor: wpf
}` would be missed, because nothing in this corpus renames an import that way today. A
literal built across a ternary, a template expression, or a helper called three names
deep will not be found either. That is the same bound `b7e-owes` documents for its own
regexes, and it fails in the quiet direction: a literal it misses is one you still have
to grep for by hand, not one it lies about.

Exit code is a report's, not a gate's: `0` whether or not anything is found — a module
nobody asserts prose on prints nothing and exits `0` — and `2` only for a module path
that does not resolve to a file. Read-only by construction: every path through it is a
`readFileSync` and a regex, and it never runs a suite or calls the module it reads.
