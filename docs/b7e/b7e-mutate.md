### Mutation-test a change without hand-rolling the backup-mutate-restore dance — `b7e-mutate`

`bc-dgx7.12`, a session audit against ten sessions (`sp-mgq`, `sp-0l0`, `sp-zg9`,
`sp-42u`, `sp-2cw`, `sp-vbm`, `sp-zli`, `sp-dei.2`, `sp-h3z`, `sp-sp9`) that each proved a
fix actually gets caught by mutating the code and re-running the tests — this repo's rule
that a green test proves nothing until it has been seen fail — and each wrote the
backup-mutate-restore loop by hand, no two of them the same way. Two failure modes
recurred across them: a stale `__pycache__` can mask a same-length mutation (the test
reports "caught" over bytecode that was never recompiled), and a mutation whose text never
actually matched anything can silently "pass" as though it had been applied.

```
b7e-mutate --file <path> --from <literal> --to <literal> --test <cmd> [--label <text>]
b7e-mutate --plan <file|-> [--test <cmd>] [--keep-going] [--dir <root>] [--json]
```

A plan is YAML — a bare list, or `{ mutations: [...] }` — of `{ file, from, to, label?,
test? }` records; a record's own `test` overrides the plan-wide `--test`. Every distinct
test command a plan actually uses is run once, unmutated, before any file is touched —
refusing the whole run if any of them is already red, since a mutation test against a
failing suite proves nothing. By default a run stops at the first mutation that
`SURVIVED` (the test still passed after the bug was introduced) or that errored (its
`--from` matched nothing, or its file could not be read); `--keep-going` runs the rest of
the plan regardless.

**Always restores from a copy held outside the working tree, and only as a `Buffer`.**
Each mutated file is backed up to a real file under `os.tmpdir()` before it is touched,
never just a JS string kept in this process, and restored from that exact backup as raw
bytes rather than round-tripped through a string — so the tree comes back byte-identical
regardless of the file's encoding.

**Restoring even when the process is killed mid-run.** Restoration is armed through
`lib/teardown.js`'s `onExit` the instant a file is mutated. The test command itself runs
via async `spawn`, not `spawnSync`, on purpose: a process blocked inside a synchronous
child-process call does not reliably service an incoming signal until that call returns
on its own — measured directly building this command, where `SIGTERM` sent to a
`spawnSync`-based run had no effect until the mutation's own test finished naturally,
several seconds later. Keeping the event loop free while the test runs is what lets
`SIGINT`/`SIGTERM`/`SIGHUP` restore the file within milliseconds instead of only after the
test would have finished anyway. `SIGKILL` cannot be caught by anything and is out of
scope here too, same as everywhere else `lib/teardown.js` is used.

**Not on `DEFAULT_TOOL_LIST` or in `lib/grants.js`.** Same reasoning `b7e-handback`
already gives for itself: it mutates a file on disk, however briefly, so it widens
nothing an agent could not already reach with the write tools it holds, and adding it to
the read-only allowlist would be the two-word diff `lib/grants.js`'s own header warns
against.

Exit codes: `0` every mutation was caught. `2` bad usage. `3` a baseline test command was
already red — nothing was mutated. `1` at least one mutation `SURVIVED` or errored. See
`bin/b7e-mutate`, `lib/mutate.js` and `test/b7emutate.mjs`.
