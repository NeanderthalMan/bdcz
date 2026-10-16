### What a new route, page, module or config key still owes — `b7e-owes`

`bc-khoe.27.7` is the second finding [the audit agent](../advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work)
filed against the same shape breaking repeatedly rather than once: four sessions
(`bc-dgx7.5`, `bc-khoe.27.3`, `bc-ka5y.15.2`, `bc-xl7n.56`) each independently
rediscovered the handful of registries a new route, page, `lib/` module or config key
incurs debt in — some by asking memory for the same note one session apart, some by
watching a suite go red after the code was already written. `bc-ka5y.15.2`'s own gap,
`advocates.flagFinishedEpics` shipped with no Config row, was then rediscovered from
scratch by three *more* sessions sweeping main before anyone filed the row. Four
sessions is a repeated shape; this is the command that would have named it in each of
them before a line of code was written.

```
b7e-owes                    every unpaid registration in the working tree, right now
b7e-owes --rev <range>      the same, with any finding whose file the range touched marked
b7e-owes < some.diff        the same annotation, read from a unified diff on stdin
```

Four registries, each checked in the direction this bead is named for — something
served or defined with no row claiming it — and, where the read is already in hand,
the other direction too:

1. **README's own API table** against the `(method, path)` chain `lib/server.js`
   dispatches on — the same read `test/routes.mjs` makes, deliberately duplicated a
   third time: `routeTable()` inside `lib/server.js` already duplicates it once, on
   the argument that a regex that quietly stops matching needs a second one it can be
   asserted to agree with, and this is cheap enough to be the third.
2. **README's Config table** against every key `loadConfig()` and the advocate
   `options()` actually default — the same read `test/configtable.mjs` makes,
   shape-row coverage and its short list of real, undefaulted keys included.
3. **`lib/evidence.js`'s `REGISTER`/`NOT_EVIDENCE`** against every `lib/` or `bin/`
   module that touches `CONFIG_DIR` or a `refs/beadcause/*` ref. `coverageProblems()`
   is imported and run rather than re-implemented — the register's own coverage check
   already *is* the answer to "does this module have a claim", not a description of
   one worth copying.
4. **`test/pagepaths.mjs`'s `PAGES`/`REDIRECTS`** against every alias `serveStatic`
   defines in `lib/server.js` — the run of one-line `if (urlPath === '/x') …` that
   function's own doc comment already calls "read as a table as well as run". An alias
   with no mention anywhere in `test/pagepaths.mjs` is one nothing has ever asked to
   answer for, and this is not hypothetical: `/foundations`, `/flow`, `/map`,
   `/requirements` and `/coverage` are five of them on main as this was written —
   `bc-khoe.27.9`, filed rather than fixed here, because five pages is five separate
   decisions about what each should assert and that is a different piece of work than
   naming that it is owed.

**What this does not check.** The four registries this bead's own evidence names, not
a general documentation linter. `package.json`'s `bin` against `package-lock.json`'s is
already unconditionally gated by `test/lockfile.mjs` on every `npm test`, and
`public/sw.js`'s cache version is deliberately left out — it collides with whichever
other branch is racing it on every merge, which a static read of one working tree
cannot see coming, and "The shell's cache version" section above is already the
answer for it.

Exit code is a linter's, not `b7e-def`'s: `0` when nothing is owed, `1` when something
is — so `b7e-owes || …` gates a script the way `eslint` or `tsc --noEmit` already do in
this house, rather than `b7e-def`'s `1` for "no such symbol".

Like `b7e-def` it is read-only by construction, with one caveat: the Config-table check
imports `lib/config.js` and `lib/advocate.js` to see what they actually default, so it
writes a scratch `config.json` — but only under a throwaway `BEADCAUSE_CONFIG_DIR` it
creates and deletes around the call, never the real `~/.config/beadcause` and never
anything in the repo. That is what put `Bash(b7e-owes:*)` on `DEFAULT_TOOL_LIST` in
`lib/toolbelt.js` beside `b7e-def` rather than behind an elevation.
