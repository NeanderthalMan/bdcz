### Who calls this, who imports it, and is anything wired to it at all — `b7e-callers`

`bc-36xx.24` is the session audit agent naming the same shape a seventh time: seven
sessions (`bc-36xx.5`, `bc-36xx.4`, `bc-zjab.2`, `bc-khoe.30.3`, `bc-5e85`, `bc-zjab`,
`bc-zjab.1`) each hand-built "who calls this" and got it wrong at least twice in ways
that read as success rather than failure. `bc-36xx.5` ran `grep -rn "approve("` scoped
to `lib/*.js bin/*.js`, got nothing back, and that silence — four exported functions
with zero callers — turned out to be the session's most valuable finding, filed as
`bc-36xx.22`. `bc-36xx.4` hit `zsh`'s glob expansion on `--include=*.js` twice
(`(eval):1: no matches found`) before it found the right call sites. `bc-khoe.30.3`
needed a *third* grep for `beadcause?.views?.mark?.(...)` because the only real call
site in the tree uses optional chaining, which no literal-text search for `views.mark`
ever matches.

```
b7e-callers approvedReview                 a bare symbol
b7e-callers lib/pr.js#approve               pinned to one file, when the name is ambiguous
b7e-callers views.mark                      a property, disambiguated by its immediate parent
b7e-callers approvedReview --tests          include test/ in the search (excluded by default)
b7e-callers lib/session.js --imports        the module-graph question instead
b7e-callers approvedReview --json
b7e-callers approvedReview --dir <root>     another tree — this is how it is tested
```

**A one-line verdict comes first**, because "grep found nothing" and "this is genuinely
unwired" read identically in a terminal and only one of them is true. It is always one
of four: `wired (N call sites)` — a real call exists outside every file the symbol is
defined in; `no caller outside its own file` — every call is internal, private-helper
shaped; `mentioned only in comments` — no call anywhere, but the name appears in prose
(`bc-36xx.5`'s own `approvedReview`/`approvalComment` case, reproduced: excluding `test/`
by default, both read this way); `referenced, but never called` — a bare mention (passed
as a callback, imported and never invoked) with no comment either. Never a shrug: a name
nowhere in the tree at all still gets `no reference found anywhere searched`.

**Every occurrence is classified, not just counted** — `call` (followed, possibly through
`?.`, by `(`), `import` (bound in a static `import { … } from '…'` clause or this repo's
own `{ … } = await import(…)` convention, either one possibly spanning several lines),
`comment`, or a bare `reference`. This is where `bin/b7e-def`'s own `--callers` stops
short: it is a plain `name\s*\(` regex with no comment or string awareness at all, so a
name mentioned in a doc comment reads exactly like a real call. `b7e-callers` reused
`bin/b7e-def`'s definition-finding shape (the same `skipString`/`findBody`/`matchBrace`
walk) but had to fix one thing in it along the way: a bare `name(` at the start of a line
is exactly as consistent with a method-shorthand *definition* as with a *call* passing an
object literal, and `openReviewAnswerSession(cfg, ws, …, {` — a real call, not a
definition — was being misread as one, its "body" landing on an unrelated `{ branch: …,
owner: … }` object three arguments later in the *enclosing* call. `lib/callers.js`'s
`bodyImmediatelyAfterParens` fixes this specifically for the two head shapes that have no
keyword anchor (`method`, `property function`): the brace has to be the very next token
once the name's own `(…)` closes, not merely the next one found anywhere afterward.

**Comment and string boundaries are found by parsing the file, not by scanning it.** A
hand-rolled character walk is exactly the kind of thing `b7e-harness`'s own two pinned
scanner bugs, just above, warn about — and it is not hypothetical here either:
`` `<script src="/${f}">` `` (a double quote inside a backtick template, in
`test/panes.mjs`) desynced a first hand-rolled version of `blankNonCode`, silently
blanking forty real lines after it as if they were still string content — a call site on
one of those lines would have vanished from every answer with no error anywhere. `acorn`
is already a dependency this repo trusts for exactly this (`lib/noundef.js`'s scope
check); `blankNonCode` walks its AST for every comment and every string/template-literal
*chunk* (never the `${ … }` expression between two chunks, which is real code and may
itself hold a call this repo cares about) and blanks only those ranges, character for
character, never collapsing a `\n` — unlike `lib/checkaudit.js`'s `stripComments`, which
is right for "does this text mention X anywhere" and wrong here, where a call site's line
number *is* the answer. `blankNonCodeNaive`, the original hand-rolled scanner, stays only
as the fallback for text `acorn` cannot parse at all.

**The one place a hand-rolled walk survives is fed a regex-blanked copy of the file.**
Finding a *definition's extent* — where its body opens and closes — still uses the
`findBody`/`matchBrace` walk borrowed from `bin/b7e-def`, because that walk steers by the
`//`, `/*` and quote characters `blankNonCode` would have removed. Round-one review of
`bc-36xx.24` caught what that costs: a regex literal is exactly what such a scanner cannot
read. `/^["']|["']$/` (real, `lib/beadfiles.js:130`) hands it a `"` that opens a string
closing at some later, unrelated quote, so the function's `endLine` ran to the end of the
file; `findCallers` then skipped that entire span as "the definition's own body" and
`b7e-callers normalizeEntry` answered `no reference found anywhere searched` with the
caller sitting nine lines below the definition. A `{2,3}` quantifier unbalances the brace
count the same way. `acorn` already knew where every regex literal was, so
`blankRegexLiterals` now spaces them out — same length, same line numbers, strings and
comments untouched — and the body walk runs over that. This mattered more than an ordinary
bug: the whole argument for a verdict that is *never a shrug* is that a shrug at least
invites a second look, and a wrong `no reference found anywhere searched` does not.

**A wrapped chain still counts as one chain.** `window.beadcause\n  ?.views\n  ?.mark?.(x)`
is a real call to `views.mark`, and 164 files here wrap a chain like that. The parent-segment
window originally stopped at any newline, which made every one of them invisible — the same
silent-miss class as the regex bug, one line break wide. It cannot simply stop treating a
newline as a boundary, because JavaScript requires no semicolon and `const a = foo` followed
by `views.mark(x)` is two statements, not one chain. So a newline is crossed only where the
chain demonstrably continues across it: the first non-space after it opens with `.` or `?.`,
or the last non-space before it closes with one. Neither can begin or end a statement; a
bare identifier on the next line still cuts.

**A dotted target (`views.mark`) is disambiguated by its immediate parent, not resolved
by a parser.** `mark` alone is not distinctive — this repo defines a same-named `mark`
for a review pill's emoji, a duplicate bead, a farblock target, several others — so
neither the definition nor a call site is found by name alone. Both are filtered by
requiring the segment just before the target: a preceding `\bviews\b\s*[:=]` line above
the definition (`window.beadcause.views = { …, mark(id) { … } }` in `public/viewbar.js`),
or an unbroken `.`/`?.` chain ending in `views` immediately before the call. That is
deliberately shallower than a real property-resolution parser — only the one segment
just before the target is checked, not a whole three-or-more-deep chain — the same kind
of tradeoff `bin/b7e-def`'s own header already makes about template literals.

**`--imports` answers the other half: what a module imports, what imports it, and
whether a new edge would close a cycle** — reusing `lib/affected.js`'s own graph
(`buildGraph`, `closureOf`, now exported) rather than rebuilding it. Given a module that
does not yet import some file `X`, `X` is named as a cycle risk exactly when `X` already
(transitively) imports the module back — a file already imported directly is not a *new*
edge and is left out. `b7e-callers lib/session.js --imports` names `lib/advocate.js`
this way: nothing in `lib/session.js` imports `lib/advocate.js` today, but
`lib/advocate.js` already reaches `lib/session.js` transitively (through
`lib/claude.js`/`lib/sessionlog.js`), so the reverse edge would close a cycle.

**Declares `@grant read` in its own header**, the same `b7e-def`/`b7e-owes`/
`b7e-affected` shape: it never spawns a subprocess, never runs `bd` or `git`, and only
ever reads source under `bin/`, `lib/`, `public/`, `scripts/`, `test/`. That one line is
what puts it on `DEFAULT_TOOL_LIST` and classifies it `read` in `lib/grants.js`, both
derived rather than hand-written — this branch was one of the ten pull requests inserting
at `lib/grants.js` line 333 that `bc-wbrhi` exists to stop colliding.

See `bin/b7e-callers`, `lib/callers.js` and `test/callers.mjs`.
