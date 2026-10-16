### Which call does this to a bead — `b7e-bd`

`bc-dgx7.20`, filed by the session audit (`lib/sessionaudit.js`) against five sessions
that each spent real minutes on the same hunt, from opposite ends. `bc-xl7n.114` ran
`bd --version`, `bd --help`, `bd show --help`, `bd update --help | grep -i "lease\|claim"`,
`bd ready --help`, `bd heartbeat --help`, `bd reclaim --help`, plus `bd ready --id
bc-xl7n.114` → `Error: unknown flag: --id` — and eight greps through `lib/` and `bin/` for
`reclaim`, `heartbeat`, `reclaimStale`, `leaseReclaim`, one of which ran past the 120s
tool timeout. `bc-khoe.33` and `bc-khoe.48` each ran `bd update --help | grep -i parent`
a day apart, hunting for how to detach a child. `bc-xl7n.117` and `bc-jvt0.4` each ran
four greps through `lib/bd.js` for `addLabel`, `reopen`, `children`, `reopenAbandoned` —
the same four greps, twice, to answer "which method does the write". The answers are
load-bearing and easy to get wrong: `Bd.addLabel` is `bd label add <id> <label>`, id
first, label last.

```
b7e-bd label                    # which Bd method does this, and which raw bd command
b7e-bd reparent
b7e-bd close force
b7e-bd lease
b7e-bd --method reopenAbandoned # the reverse lookup: everything about one named method
b7e-bd label --json
```

**Two questions, one command.** Given an intent — a verb or a short phrase — this
answers "which `Bd` method (`lib/bd.js`) wraps that" *and* "what does the raw `bd`
binary installed on this machine call that", side by side, plus any
`beadcause-memory` note whose key or text names it. `lib/bdintrospect.js` does the
work and none of it runs `bd` write-shaped: the `Bd` half is read straight out of the
source (parsed with `acorn`, never executed, never imported), and the raw-`bd` half is
nothing but `bd --help` and `bd <verb> --help` — informational, no workspace ever
touched.

**The `Bd`-method search is `lib/already.js`'s `scoreEntry`, reused rather than
reinvented** — the same convention `b7e-already` (`bc-dgx7.81`) already searches
`lib/` with: a query word must appear, as a substring, in the method's name or the
*first line* of its doc comment. That first-line rule is why `b7e-bd reparent` finds
no `Bd` method: `Bd.graph()`'s doc comment does say, eleven paragraphs down, "the thing
being cached moves only when somebody deliberately *reparents* a bead" — but that
sentence is not the first line, and `Bd.update()` — the method that actually builds
every `--flag` it will ever pass — never touches `--parent` at all; `Bd.adopt()` owns
that flag alone. Reusing the existing scorer rather than a second, subtly different one
is what keeps "no `Bd` method wraps this" an honest answer instead of an accident.

**The raw-`bd` search reads every top-level command's *full* `--help` text, not just
its one-line summary**, which is the other half of the `reparent` answer: `bd --help`'s
own one-liner for `update` is "Update one or more issues" — nothing about a parent
anywhere — and the only place the word shows up at all is the `--parent` flag's own
description, one level down ("New parent issue ID (**reparents** the issue, ...)").
Fetching every subcommand's full `--help` (still under two seconds for the ~50 this
install has) is what makes that findable with no hand-maintained synonym table to keep
in sync with the next `bd` release. Matching is anchored to a *left* word boundary only
(`\bword`, not `\bword\b`) — `\blease` correctly skips the "lease" sitting inside
"re**lease**" while still matching "reparent**s**" for the query `reparent`, which a
two-sided boundary would have missed.

**The argv is read out of the source, never executed.** Most `Bd` methods call
`this.run(workspace, [literal, array], { retries: N })` directly and that array is
resolved element by element — a string prints as itself, a parameter like `id` or
`label` prints as `<id>`, anything more exotic falls back to its own source text. A
handful (`update`, `create`, `closeAnswered`, …) build the argv into a local `const
args = [...]` and grow it with conditional `args.push(...)` calls through the body;
those are resolved too, each push labelled with the `if`/`for` that guards it, which is
exactly how `update()` is shown to never push `--parent`.

**On `DEFAULT_TOOL_LIST`** via its own `@grant read` header (`bc-wbrhi`) — it never
writes anything, so there is nothing here `lib/grants.js` would classify a write.
