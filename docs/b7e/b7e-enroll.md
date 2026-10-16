### What a new bin/ command still owes before an agent can call it — `b7e-enroll`

`bc-khoe.27.11` is the same shape breaking repeatedly rather than once, for a *command*
rather than a route or a config key: six sessions (`bc-khoe.27.6`, `bc-khoe.27.7`,
`bc-gdub.2`, `bc-gdub.3`, `bc-bmry.7`, `bc-zjab`) each independently re-derived the same
handful of places a new `bin/` entry incurs debt in — grepping `lib/toolbelt.js` and
`lib/grants.js` by hand, reading the same two memory notes every time, and at least once
(`bc-khoe.27.6`) paying for the gap with a full 369-suite parallel gate that ended on
`test/grants.mjs: dispatch grants Bash(b7e-apply:*), which nothing classified`. `b7e-owes`
above already does this for routes, config keys, the evidence register and page aliases;
this is the same idea, for the registries a command owes rather than a route.

```
b7e-enroll                    every command in bin/ against every registry, right now
b7e-enroll b7e-x               just that one command's registrations
b7e-enroll bin/b7e-x.js        the command a brand-new file in bin/ would be named,
                               checked the same way, before it is registered anywhere
```

Seven checks, but only two are universal — any `bin/` command owes them:

1. **`package.json`'s `bin` map** has an entry for the name.
2. **`package-lock.json`'s `packages[""].bin`** agrees with it — `test/lockfile.mjs` is
   pinned first in the sweep, so a lock that disagrees stops every later suite.

The other five are specifically the `b7e-*` "skill" checklist — `bc-dgx7.2`'s own
definition of a skill is `b7e-<verb>` on `PATH`, on the allowlist, tested and
documented — and the worker-only `beadcause-*` commands (`bin/deliver.js`,
`bin/ask.js`, …) owe none of it: a worker's
Bash is already unrestricted, so they are run by absolute path (`node bin/deliver.js`),
need no exec bit (most are plain `-rw-r--r--`), no dedicated README section, and no
`DEFAULT_TOOL_LIST` entry. `bc-bmry.7` lived this split for real, on a non-`b7e-`
command: it checked exactly `package.json` and `package-lock.json`, found nothing else
owed, and went looking for a different registry (`lib/sessionaudit.js`) instead.

3. **`bin/<name>` itself** exists, is executable, and starts with a node shebang — the
   *extensionless* file, for a name not registered yet: `lib/foundation.js` puts the
   main checkout's `bin/` on `PATH`, so a command resolves by the name it is typed as,
   and a `package.json` rename resolves only after an `npm link` this install has never
   had. Once a name is already registered, this trusts whatever file `package.json`
   already points to, `.js` suffix and all — `b7e-owes` and `b7e-say` both still have
   one, and relitigating an *existing* mismatch belongs to `bc-jlop`/`bc-dgx7.2`, not
   here.
4. **Some file under `test/`** actually spawns it —
   `path.join(ROOT, 'bin', '<name>')` (with or without `.js`) appearing anywhere under
   `test/`, not a fixed filename: the family's own test files disagree with each other
   on that (`test/b7e-say.mjs` keeps the dash, `test/b7eowes.mjs` drops it,
   `test/eyeball.mjs` is named for neither `b7e-eyeball` nor any dash-dropped spelling
   of it).
5. **`README.md` has a `###` heading** naming it, backtick-quoted — a feature is not
   finished here until the docs say it exists.
6. **Its own header carries a `@grant` line** — `read`, `write` or `excluded` — which is
   what puts `Bash(<name>:*)` on `DEFAULT_TOOL_LIST` for the restricted `dispatch` agent
   or deliberately keeps it off. Twenty-nine of the family are excluded, each with a
   paragraph explaining what it writes or spawns, and that decision is exactly as real as
   being on the list. It is only unpaid when the tool declares nothing at all.
7. **If (6) grants it, `lib/grants.js` classifies `Bash(<name>:*)`** — `test/grants.mjs`
   fails the moment something is on `DEFAULT_TOOL_LIST` unclassified, "deny by default"
   being the whole design of that file. Since bc-wbrhi this cannot come apart on its own:
   the classification is built from the same declaration, so check 7 is asserting the
   wiring rather than a second thing somebody had to remember.

Checks 6 and 7 were two readings of two registries' source text until bc-wbrhi — and the
second reading was the one that could be wrong in the direction that matters. "Not granted,
but a comment in the array names it" cannot tell a decision from a mention, so a tool named
in passing inside somebody else's paragraph read as settled. See
[the tools declare their own grants](../b7e-tools.md#a-new-tool-declares-its-own-grant-and-edits-no-registry).

Run with no argument against main as this was written, it named exactly one thing:
`b7e-say` has neither a `DEFAULT_TOOL_LIST` entry nor a comment saying why not — the
same gap `bc-gdub.2`'s own retrospective describes shipping everything else and then
"neither" of this pair. It also found a second, previously uncaught one the same way —
`b7e-sandbox` — filed as its own bead rather than fixed here, on the same argument
`b7e-owes` makes for its own five-page pagepaths gap: deciding whether to grant it is a
real decision, not a registration to paper over in a tool's own diff.

Exit code is a linter's: `0` when nothing is owed, `1` when something is. Read-only by
construction in the same sense `b7e-def`/`b7e-owes`/`b7e-affected` are — it only ever
calls `fs.readdirSync`/`readFileSync`/`statSync` over the files above and prints what
it found — which is what put `Bash(b7e-enroll:*)` on `DEFAULT_TOOL_LIST` beside them.
