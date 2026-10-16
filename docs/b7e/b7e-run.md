### Run this checkout's own `bin/` command, not whichever copy `PATH` found — `b7e-run`

`bc-dgx7.87`, a session audit against three sessions (`bc-dgx7.80`, `bc-dgx7.77`,
`bc-dgx7.81`) that each had to invoke a `b7e-*` command from inside their own worktree
and each worked out how differently, because `lib/foundation.js` puts the MAIN
checkout's `bin/` on every agent's `PATH` — so a bare command name, or even a relative
`./bin/x` typed from the wrong place, does not reliably run the copy sitting in the
worktree a session is actually doing its work in, and nothing says so when it silently
doesn't. `bc-dgx7.80` burned four hours gating the main checkout by mistake because a
`--dir` argument it believed pointed at its own worktree pointed at the main checkout
instead. `bc-dgx7.77` carried an absolute path as a shell variable through a dozen
consecutive Bash calls purely to be sure. `bc-dgx7.81` used a relative path that happened
to work, then hit `./bin/b7e-gate --help` — not a help flag — and silently started a real
478-suite run against the wrong tree.

```
b7e-run <command> [args...]                run <root>/bin/<command>, root = the caller's
                                            own worktree — resolved from cwd, never from
                                            this file's own path
b7e-run --dir <root> <command> [args...]   a checkout other than the caller's
b7e-run --which <command>                  resolve and report only; runs nothing
```

**Resolution is by `cwd`, not by this file's own location.** `git rev-parse
--show-toplevel` against `process.cwd()` — deliberately not the `path.join(HERE, '..')`
pattern several existing `b7e-*` commands use for their own default root, because `HERE`
is always the MAIN checkout's `lib/` directory: this file always executes from the main
checkout's `bin/` regardless of which worktree invoked it, so its own path can never
answer "where is the caller actually sitting." See memory note
`a-worktree-aware-bin-resolves-root-from-cwd-not-here`.

**No extension guessing, no `package.json` lookup.** The target is exactly
`<root>/bin/<command>` — the same file a shell would run for `bin/<command>` typed from
that root. A name registered under a different filename (`b7e-owes` → `bin/b7e-owes.js`)
has to be typed as that filename.

**Prints the resolution before running it, every time.** One stderr line names the root
it resolved and the file it is about to run. When the same command name would resolve to
a *different* file on `PATH`, a second stderr line names that file and the checkout it
belongs to — the exact gap that cost `bc-dgx7.80` four hours, made visible instead of
silent.

**Not on `DEFAULT_TOOL_LIST`.** The same argument `b7e-call` and `b7e-bound` already
make for themselves: it runs whatever `bin/` entry its own argument names, with whatever
arguments follow, so there is no argv shape to check for "reaches a write" — reaching
whatever the caller points it at is the entire job, including commands already refused a
grant here on their own for exactly that reason. See the comment beside
`DEFAULT_TOOL_LIST`.

Exit codes: whatever the resolved command exits with, unchanged — including non-zero.
`2` refused before anything ran: bad usage, or no file at the resolved path. Killing
`b7e-run` forwards the signal to whatever it spawned first (`lib/teardown.js`'s
`onExit`), the same fix `b7e-shipgate` needed for the identical trap — a wrapper that
composes `b7e-gate` and does not forward its own kill signal orphans the gate, still
holding its per-tree lock. See `bin/b7e-run`, `lib/run.js` and `test/b7erun.mjs`.
