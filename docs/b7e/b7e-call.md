### Call one export from this repo, with arguments or over a real tracker — `b7e-call`

`bc-zjab.7`, filed by the session audit against seven sessions that each needed "import
this export, call it, show me what comes out" and hand-rolled it as a `node -e
"import('./lib/x.js').then(m=>...)"` one-liner, every one of them differently. Two of
those round trips were spent on shell quoting rather than the answer: `bc-bmry.5`'s NUL
scan came back `command contains control characters` and had to be rewritten around
`String.fromCharCode(0)`.

```
b7e-call lib/session.js#workPromptFor --json '["acme", bead, opts]'
                                                       the return value, printed for a
                                                       human — a string comes back
                                                       verbatim, newlines/>/quotes/NULs
                                                       intact, because it never crosses
                                                       a shell argument
b7e-call lib/relay.js#chainFor --over acme:ready --limit 20
                                                       one line per bead plus a tally,
                                                       over a real tracker, with no
                                                       script written and no directory
                                                       guessed
```

**`--json` is the fix for the shell-quoting half.** The arguments and the answer both
cross as data — a JSON array in, the return value printed raw if it is a string — so
nothing has to be re-escaped to survive a shell word. A throwing export exits non-zero
naming the module and only the error's *first* line, not a stack trace.

**`--over <workspace>[:ready|open|all]` is the half nothing here covered.** `bc-bmry.3`,
`bc-bmry.5` and `bc-bmry.2` each wrote a throwaway `scratchpad/*.mjs` to run a predicate
written minutes earlier against every row of a real tracker. This does the same thing
without writing one: it never shells `bd` itself and never guesses which directory a
workspace name resolves to — `lib/bd.js` and `lib/config.js` already own both, the same
two modules `bin/b7e-census` is built on. `ready`/`open` map to `Bd.ready`/`bd list
--status=open`; `all` is bd's own default, `bd list --limit 0 --json` — mode defaults to
`ready` when the `:` is left off. `--limit N` caps the rows and always says so
(`showing 20 of 348 ready beads in acme — --limit 20`), never truncates silently.
`--fields a,b,c` prints those bead fields before the arrow on each line.

**This is next to `b7e-census` (`bc-bmry.12`) and is not it.** A census counts a label or
edge it already knows the meaning of; this calls a predicate that did not exist ten
minutes ago, over rows it has never heard of — the whole point is that the code under
test and the export under test are both new in the same session.

**Over mode calls `<export>(bead)`** — the row, exactly as `bd` returns it, as the sole
argument — or `<export>(...args, bead)` when `--json` is also given, with `bead` appended
after whatever fixed leading arguments `--json` supplies. An export whose own signature
does not put its interesting parameter last (`lib/relay.js#chainFor`'s is `(cfg,
workspaceName, bead)`) still runs to completion and still prints a tally; it is not this
command's job to know every export's calling convention, only to call it the one way
that is true for all of them and say plainly what came back.

**Not on `DEFAULT_TOOL_LIST`, unlike its read-only siblings above.**
Unlike `b7e-def`/`b7e-census`/`b7e-owes`, which each run exactly one fixed, read-only
operation, this one calls whatever export its argument names — including a write, three
imports deep, with no argv shape to check for it. See the exclusion comment in
`lib/toolbelt.js` next to `b7e-apply`/`b7e-gate`/`b7e-worktree` for the same argument made
about those. See `bin/b7e-call`.
