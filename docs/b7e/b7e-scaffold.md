### The house skeleton for a new bin/ command — `b7e-scaffold`

`bc-dgx7.32`, filed by the session audit against four sessions (`bc-zjab.7`, `bc-zjab.9`,
`bc-zjab.10`, `bc-zjab.6`) that each built a new `b7e-*` command by reading two or three
existing ones for their shape — `bc-zjab.7` read `bin/b7e-def` and `bin/b7e-census` in
full, then `sed -n '40,219p' bin/b7e-call`; `bc-zjab.10` read `bin/b7e-worktree` and
`bin/b7e-orient` in full plus `bin/b7e-siblings` — and then disagreed with each other on
nearly everything they had just copied: extensionless naming vs `bin/b7e-owes.js` and
`bin/b7e-say.js`, everything in the bin file vs a paired `lib/` module, exit code `1` vs
`2` for a bad argv. The shape had already been written down as an assertion —
`test/eyeball.mjs`'s "the registrations a new bin/ command owes" block — but nothing
produced the file that block describes.

```
b7e-scaffold b7e-thing > bin/b7e-thing                    the bare skeleton
b7e-scaffold b7e-thing --workspace-arg > bin/b7e-thing     with the -w/-b + loadConfig()
                                                            block bin/b7e-field's shape uses
b7e-scaffold b7e-thing --json-mode > bin/b7e-thing         with a --json flag and branch
b7e-scaffold b7e-thing --lib                               bin file, then a marked-off
                                                            lib/thing.js stub — split them
                                                            yourself, this prints both
```

It **prints, it never writes** — the bare and flag-combined cases are one file, ready to
redirect straight to `bin/<name>`; `--lib` adds a second, clearly delimited section
naming the `lib/` path to save it under, because two files cannot both come out of one
redirect. A name that does not start with `b7e-`, or that already exists in `bin/`, is
refused rather than silently producing something that would overwrite a real command.

**What the printed skeleton bakes in, and why each is a decision already made
elsewhere, not a guess this command invents:** extensionless naming, because only that
resolves on `PATH` from `lib/foundation.js`'s `bin/`-first prefix; exit `2` for a refused
bad argv, the majority convention across the existing `b7e-*` family; and, for `--grant`,
**no default at all** — the printed header carries a TODO naming the three real choices
(`@grant read` / `@grant write` / `@grant excluded`) rather than picking one, because
`lib/tooldecl.js` treats leaving a tool undeclared as a real, checked state (the same one
`b7e-packet` and `b7e-say` are in today) and a scaffold that guessed would be deciding an
allowlist question on the author's behalf. The TODO prose is written so it cannot
accidentally match `lib/tooldecl.js`'s own `@grant` pattern — `test/scaffold.mjs` asserts
that directly, so a scaffolded-but-unfinished command can never read as already decided.

The templates live in `lib/scaffold.js`, so `test/scaffold.mjs` can assert what they say
without spawning a process for every case; `bin/b7e-scaffold` is the argv parsing and the
refusals around them. Exit codes: `0` printed. `2` refused — bad usage, a name that
isn't `b7e-<word>` shaped, or a name that collides with a file already in `bin/`.
`Bash(b7e-scaffold:*)` is on `DEFAULT_TOOL_LIST`, declared `@grant read` in the command's
own header — it reads `bin/` and prints text, nothing it does ever writes. See
`bin/b7e-scaffold`, `lib/scaffold.js` and `test/scaffold.mjs`.
