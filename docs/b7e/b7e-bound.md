### Run one thing under a deadline, on a Mac with no `timeout` binary — `b7e-bound`

`bc-xl7n.120` is another finding [the audit agent](../advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work)
filed against the same shape breaking repeatedly rather than once. Four sessions
(`bc-dgx7.8`, `bc-xl7n.93`, `bc-khoe.32`, `bc-1kwl.30`) each typed `timeout <n> <cmd>` and
got `(eval):1: command not found: timeout` — there is no coreutils `timeout` on this Mac,
and each one found that out the same way. What followed was worse than the missing
binary: `bc-xl7n.93` dropped the bound, hit the harness's 120s cutoff, and cycled through
a background task, `sleep`, a `tail` that printed nothing and `TaskOutput`. `bc-dgx7.8` is
the worst case: five rounds of `background & sleep & TaskOutput` on a suite that takes two
seconds when it passes and never returns when it doesn't, one round of which piped a timed
command into `head -60; echo "EXIT: $?"` and got back `EXIT: 0` for a run that never
finished at all — the exit code it read belonged to `head`, not to what was piped into it.

```
b7e-bound --for <seconds> -- <command> [args...]
```

Runs `<command>` directly — no shell, so there is no pipe for an exit code to go missing
into the way `bc-dgx7.8`'s did, and no shell metacharacters in `<command>`'s own arguments
are interpreted. Its combined stdout/stderr streams through as it happens, and it ends one
of two ways:

- **Inside the deadline**, it exits with **the command's own exit code** (128+signal if
  the command died of one) — `b7e-bound --for 90 -- foo; echo $?` behaves exactly like
  `foo; echo $?` would, so nothing downstream that checks `$?` has to change.
- **Still running at the deadline**, `SIGTERM` and then, after a short grace, `SIGKILL` go
  to the command's whole process **group** — not just the one child it spawned — so a
  command that itself backgrounds work (`npm test`'s own workers, a daemon a hung script
  started) leaves nothing behind holding a port. It prints how long it waited and the last
  line the command produced, and exits `124`: the code coreutils' own `timeout` already
  uses for exactly this, chosen so it reads the same way to anyone who has used that
  command before. Like coreutils' `timeout`, this is not distinguishable from a command
  that happens to exit `124` on its own — no in-band exit code can be, on any Unix — and
  `124` is the one value this repo's users already half-remember the meaning of.

The file is `bin/b7e-bound`, no `.js`: `lib/foundation.js` puts this repo's `bin/` on
every agent's `PATH`, resolving the literal filename typed, and a `package.json` `bin`
entry that renames a `.js` file only resolves after an `npm link` this install has never
had — the same reasoning `b7e-apply` and `b7e-worktree` give for the same choice
elsewhere in this file.

**Deliberately not on `DEFAULT_TOOL_LIST`**, for the `b7e-call`
reason rather than the `b7e-gate` one: `b7e-call` runs whatever export its argument names,
and `b7e-bound` runs whatever command its argument names — there is no argv shape to check
for "reaches a write", because reaching whatever the caller points it at is the entire
job. `dispatch`, the one agent `DEFAULT_TOOL_LIST` actually widens, is a single turn that
answers a phone comment with one `bd comment` and has no branch and no oversight loop;
granting it the ability to run an arbitrary command under a time bound would be strictly
more capability than `Bash(npm test:*)`, which `lib/grants.js` already classifies as a
write held by `merge-advocate` alone. A worker session, which is what actually hits the
shape this bead is about, already carries an unrestricted allowlist and needs no grant to
run it.
