### One `bd` write that survives contention, instead of a blind retry that double-posts — `b7e-write`

`bc-dgx7.86`, re-filed from another workspace's tracker (the session audit, `lib/sessionaudit.js`).
`b7e-ws` above forwards read verbs and refuses to mutate anything "on purpose — this is a
lookup, not a second door into bd". Every mutating call three sessions needed therefore
went out as raw `bd` from a Bash tool call, against a workspace where embedded Dolt's
single writer was contended all afternoon, under the harness's own 120s ceiling — and each
session invented something different, one of them destructive. The first session's `bd comment`
timed out; its own check read raced the still-queued write and answered "No comments", so
the session retried — both writes landed, the same finding twice. The second spent seven
round-trips (`ps | grep`, hand-written `until ! kill -0` loops) confirming a backgrounded
`--claim`. The third abandoned per-bead reads entirely after one hung for two minutes and
exited 143.

```
b7e-write -w acme comment ac-vry <<'EOF'      text from --file or stdin, never argv
Whatever happened, however many backticks or heredoc terminators it needs.
EOF
b7e-write -w acme claim ac-vry                shorthand for `bd update ac-vry --claim`
b7e-write -w acme unclaim ac-vry
b7e-write -w acme close ac-vry --reason "duplicate"
b7e-write -w acme update ac-vry --status=open
b7e-write -w acme label add ac-vry human
b7e-write -w acme dep add ac-vry ac-abc
```

**The retry logic already exists and is already correct.** `lib/bd.js`'s `run` never
retries a timeout, whatever `retries` says — a timeout means the machine has just proved
it is too busy, and asking again inside the same ceiling wastes the ceiling twice. What was
missing is the step between "the write timed out" and "is it safe to ask again": a
verification read that can tell "the write is not there" apart from "I could not find
out", because the first session's read was exactly the second case dressed as the first. On a
timeout, this command runs exactly one such read — on a *fresh* `Bd` instance, never the
one the write just used, because `run`'s quarantine is keyed per-instance and fires the
moment a write times out; reusing it would have the verification read refused before it
ever spawned, on every single timeout, which is the one case this command exists to
answer — and reports one of four outcomes: **landed** (wrote first try), **already
landed** (the write timed out but the read found it — nothing retried), **not landed**
(the read found no trace of it — safe to retry), or **unconfirmed** (the read could not
answer either, so nothing is retried and the bead needs a human look).

**Only the mutating set `b7e-ws` itself refuses is accepted** — `comment`, `update`,
`close`, `claim`, `unclaim`, `label`, `dep` — anything else (a read verb, `create`, a
typo) is refused before a workspace is even resolved, pointing a read at `b7e-ws`
instead. `claim` is not a real `bd` verb; it is shorthand for `bd update <id> --claim`,
offered because that is the one shape almost every worker brief in this repo runs first.
Comment text is always `--file <path>` or stdin, never a positional argument — the
`b7e-say` rule (bc-gdub.2) that a Bash tool call's own double-quoted argv re-parses
backticks and `$(...)` before the command they are quoting ever runs; once read into this
process the text goes to `execFile` as one argv element with no shell in between, so that
hop needs no escaping at all.

**Deliberately NOT on `DEFAULT_TOOL_LIST`.** Unlike `b7e-ws`, this command *is* the write
door — granting it to `dispatch`, the one agent that list governs, would be a
general-purpose write into any configured tracker, which is strictly more capability than
any single mutating `bd` command `lib/grants.js` classifies as a write. A worker session,
which is what all three originating sessions actually were, already carries an
unrestricted allowlist and needs no grant to run it.
