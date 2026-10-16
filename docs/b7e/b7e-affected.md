### Given a diff, name the suites that actually cover it — `b7e-affected`

`bc-khoe.40` is the session audit agent naming the same shape a fifth time: eight sessions
(`bc-khoe.23`, `bc-khoe.27.1`, `bc-36xx.6`, `bc-5k22`, `bc-xl7n.74`, `bc-xl7n.71`,
`bc-1kwl.22`, `bc-j52g`) each hand-wrote a grep to answer "what do I need to run before the
full gate finishes" — some against file paths, some against identifiers, one against both
in two separate passes — and no two of the eight agreed on which files to search or what
counted as a match.

```
b7e-affected                          the diff since origin/main, plus anything uncommitted
b7e-affected <path> ...               one or more specific files instead
b7e-affected --why <path> ...         one line per suite, with the reason it matched
b7e-affected --json <path> ...        one object per changed file, then a summary
b7e-affected --dir <root>             another tree — this is how it is tested
```

**Three ways a suite depends on a file, and only one of them is `import`.** `lib/affected.js`
carries the whole argument in its own header, and the short version is: a suite can
*import* the changed file, statically or dynamically, directly or through a chain of other
`lib/` files (`test/filter.mjs` never imports `lib/advocate.js`, but it imports
`lib/server.js`, which does); it can *read the file's own source text* as a string rather
than as a module, which is the only way anything covers `public/*.js` at all — nothing
resolves a browser script as an ESM import, so `test/editfreeze.mjs` and
`test/sweepfail.mjs` cover `public/spacebar.js` by `fs.readFileSync`-ing it and asserting
on what the text says; or it can *name the file in a string without reading it*, the way a
`scripts/*-check.mjs` names a page by its bare filename in a `PAGES`/`ROUTES` table. `--why`
reports which of the three (or, for a check naming a page, the sharper "serves this page")
because the three carry different amounts of confidence, though none of it changes what
`b7e-gate --only` actually runs.

**Comments are stripped, and a text match is exactly one hop.** `lib/checkaudit.js` already
strips comments before hunting for a selector, for the same reason this does: this repo's
own file headers cross-reference other files by path in plain prose constantly, and
counting that as a reference would make almost every file "name" almost every other one.
The one-hop rule is stricter than that and earns its own regression fixture
(`test/affected.mjs`, section 4): a text match is checked against a candidate suite's *own*
source only, never against something the suite merely imports. The first version of this
propagated a match through the whole import graph the way `imports it` legitimately does,
and one line in `lib/foundation.js` — `briefOwner: 'lib/advocate.js'`, real code, not a
comment, in an agent-brief registry imported by nearly every suite in the repo — turned a
change to `lib/advocate.js` into 222 of 449 "affected" suites. That is worse than useless:
indistinguishable from the shrug this file exists to replace. The honest cost of bounding
it that way is real and named rather than hidden — three of the six suites
`bc-xl7n.74` added by hand for `lib/advocate.js` (`test/container.mjs`, whose only trace is
`lib/container.js`'s header prose; `test/notinmain.mjs`; and `test/evidence.mjs`, one hop
further out than a direct check reaches through `lib/evidence.js`'s own `writers` array)
are not found by this. The other three (`test/superseded.mjs`, `test/inmain.mjs`,
`test/filter.mjs`) come back anyway, because they turn out to genuinely import
`lib/advocate.js` transitively.

**Never a shrug.** A changed file with no source-level trace anywhere in `bin/`, `lib/`,
`public/`, `scripts/` or `test/` is reported unmatched, explicitly — never silently absent
from the output, which would read as "nothing needs to run" rather than "this file could
not be placed." Plain-mode stdout carries nothing but exact suite paths, ready to pipe
into `b7e-gate --only` (`xargs -I{} b7e-gate --only {}`, or building the flags directly) —
and if *any* changed file is unmatched, stdout is left completely empty rather than a
partial list, because printing only what narrowed successfully would make "found nothing
for this one file" indistinguishable from "these are the only suites this diff needs." An
empty `--only` selection is `b7e-gate`'s own definition of "everything," which is exactly
the right fallback; each unmatched file still gets a loud, explicit line on stderr so it
cannot corrupt the pipe. Exit `1` when any file is unmatched, `0` when every one matched
at least one suite.

**On `DEFAULT_TOOL_LIST`**, unlike `b7e-gate` just above — this is the
`b7e-def`/`b7e-owes` shape, not the `npm test` shape. It never spawns a daemon, binds a
port or runs a suite; it reads `git diff` and the text of this repo's own source once and
prints a list. `lib/grants.js` classifies it `read`, the same as `b7e-def` and `b7e-owes`.
