### What a repo command takes — without running it to find out — `b7e-usage`

`bc-dgx7.31`, filed by the session audit against `bc-zjab.9`, `bc-zjab.7`, `bc-zjab.8`,
`bc-xl7n.102`, `bc-y3qk.13` and `bc-zjab.6`: six sessions each needed a `bin/` command's
flags before calling it, and no two got them the same way. Two of the six ran the
command itself with `--help` to find out and started a real 400-suite gate sweep
instead — `b7e-gate` had no branch that did not run the whole thing — and a third
polled the resulting run for eleven minutes before noticing what had launched it. The
rest grepped `USAGE\|process.argv` in the file, or read it cold. Every command in this
repo already carries its own invocation lines and exit codes in its header doc
comment; this reads that text and nothing else.

```
b7e-usage                    every command in package.json's bin map, one line each
b7e-usage --json             the same, structured
b7e-usage <command>          one command's invocation lines and exit codes, by name
b7e-usage <path>             the same command, by path — bin/b7e-owes.js resolves the
                              same as b7e-owes
b7e-usage <command> --json   the same, structured
```

`lib/usage.js` does the parsing: the header comment's first paragraph is the one-line
summary (the name-dash pattern where a header has one, its first sentence otherwise),
the first run of consecutive paragraphs whose own first line starts with the command's
*registered* name — not always its filename; `beadcause-deliver` is `bin/deliver.js`,
`b7e-owes` is `bin/b7e-owes.js` — is the invocation block, plus a trailing `Flags:`
paragraph where one follows (`b7e-sandbox`'s shape), and the first paragraph anywhere
that opens "Exit code" is the exit codes. None of it executes the file being read
about — `fs.readFileSync` and string matching are the whole of it, which is the point:
asking a command what it takes must never be how a real run of it gets started.

**The second half of what makes this safe to trust is that `--help` on the command
itself is inert**, everywhere in the family, so running one by hand to check this
tool's answer never repeats the six sessions' own mistake. `b7e-gate` fell through
`--help` into a real run before this landed; `b7e-affected`, `b7e-apply`, `b7e-card`,
`b7e-notes`, `b7e-shard` and `b7e-packet` turned it away as an unrecognised flag, a
missing positional, or (worst, for `b7e-packet`) a hang on a stdin nothing was ever
going to write to. All seven now answer `--help` with their own usage line and exit
`0` before touching real work, and `test/eyeball.mjs` spawns every `bin/b7e-*` file
with `--help` and a closed stdin to keep it that way.

Exit codes: `0` printed; `1` the command is registered but its file carries no header
doc comment to read; `2` refused — bad usage, or the name or path given does not
resolve to anything `package.json`'s `bin` map has. `@grant read`: it only ever reads
`package.json` and the files under `bin/` it is asked about.
