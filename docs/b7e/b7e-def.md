### Where a symbol is defined — `b7e-def`

The first command [the audit agent](../advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work)
found by watching the same shape break four times rather than by reading a transcript
once. `bc-khoe.27.5` is the finding: four separate sessions each hand-rolled
`grep -n | cut -d: -f1 | sed -n '<n>,+50p'` against files too big to read whole
(`lib/server.js` is 10,560 lines, `public/app.js` 10,380), and it broke a different way
every time. `sed -n "$(grep … | cut -d: -f1),+50p"` fails outright when the grep comes
back empty — `sed: 1: ",+50p": invalid command code ,` — and even when the grep does hit,
it is often hitting the wrong thing: `bc-r2b5.1` spent four calls discovering that
`loadBead` is *imported* into `lib/server.js` at line 12 and actually defined in
`lib/verdict.js:297`. No two sessions spelled the recovery the same way, which is the
tell that the failures were in the spelling and not in the question — "where does this
name actually live, and what does it say" has one answer every time.

```
b7e-def <name>              every definition of <name>, with its doc comment
b7e-def <name> --callers    the above, plus one line per call site
```

It searches `lib/`, `bin/`, `public/`, `scripts/` and `test/` and reports, per match,
`file:startLine-endLine` with the definition and its doc comment printed in full — a
class method, a top-level function, an exported `const`, all found by the same
line-by-line scan rather than a real parser (see the doc comment at the top of
`bin/b7e-def` for exactly where that scan is deliberately narrower than a tokenizer).
Where a definition *ends* is the one half that does use a parser, since `bc-3rjan`: the
brace walk runs over the file with every comment, string, template and regex literal
spaced out off an `acorn` parse, because a hand-rolled scanner reads the `"` inside
`/^["']|["']$/` as a string opener and then runs the span to the end of the file — 82 of
this tree's 3,118 top-level functions got the wrong end line that way, and
`test/b7edef.mjs` now pins every one of them against `acorn`'s own `loc`. `acorn` is a
devDependency, so a worktree without `node_modules` gets the old raw-text walk rather
than a crash.
**Two definitions is a report of two, not a guess** — searching a name reused across
files (three unrelated `normalize` helpers, say) prints all three rather than silently
narrowing to the first hit. When the name is only *imported* where it was found, the
import line is printed first and the real definition — resolved through the specifier,
including through an alias (`import { foo as bar }`) — follows it, which is the one
question that used to cost a session three extra calls. A name with no definition
anywhere in those five directories exits non-zero and says so, rather than printing
nothing and leaving the caller to work out whether that was silence or an answer.

It is read-only by construction — `fs.readdirSync`/`readFileSync` over five directories
and nothing else — which is what put `Bash(b7e-def:*)` straight on `DEFAULT_TOOL_LIST`
in `lib/toolbelt.js` rather than behind an elevation.
