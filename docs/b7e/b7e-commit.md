### The commit before the delivery, written the house way instead of four ways — `b7e-commit`

`bc-xl7n.119` is the fifth finding [the audit agent](../advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work)
filed against the same shape breaking repeatedly rather than once. Every one of ten runs
across five beads (`bc-xl7n.93`, `bc-1kwl.30`, `bc-7qo.14`, `bc-ka5y.19`, `bc-dgx7.7`) ends
the same way — confirm the scope with `git diff main...HEAD --name-only`, commit, then
`bin/deliver.js` — and the confirm and the deliver were each one call that worked first
time. The commit in between was written four different ways and failed three of them:
`bc-xl7n.93` ran a `git commit -m "…\`backticked\`…"` inside a Bash tool call and hit the
same command-substitution hazard `b7e-say` exists for, at the one call site it did not
cover — the call hung two minutes before anyone noticed. The same run also hardcoded
`--author="…you@northwind.example"`, the *work* address, in a personal repo whose
`~/.gitconfig` `includeIf` exists to resolve the personal one instead, and separately
forgot the `Co-Authored-By` trailer, patching it in after the fact with a `printf` append
and an amend. The other nine got the message onto the command line a different way each —
a scratch file plus `-F`, a `$(cat <<'EOF' … EOF)`, a plain multi-line `-m`, a one-line
`-m` — and none of them checked for or normalised the trailer.

```
b7e-commit -w <workspace> -b <bead> [--amend] [--file <path>]
```

The body is `--file <path>` or stdin, exactly the `b7e-say` idiom and for the same
reason — never a positional argument, so a shell never re-scans it for backticks,
`$(...)` or a heredoc terminator. It stages the whole tree (`git add -A`), then commits
with `git commit -F <tmpfile>`: the subject is `<bead>: <first line>`, everything after
the first line is the body untouched, and a `Co-Authored-By` trailer is added as its own
paragraph unless the body already carries one anywhere. `--author` is never passed —
identity is whatever `git` resolves for the checkout, which is exactly what `bc-xl7n.93`
got wrong by hardcoding it. It refuses, having written nothing, on the workspace's base
branch (`main`/`master` too), on a tree with nothing staged, and on a body that is empty
once trimmed; an `--amend` is exempt from the empty-tree refusal, since amending only the
message with the same tree staged is a legitimate call. It prints the staged file list
before the sha and subject it wrote, so the confirmation of scope and the confirmation of
the commit are never two different numbers.

Deliberately not on `DEFAULT_TOOL_LIST`, for the same reason as
`b7e-say`: staging and committing the whole tree is a write no reading of "the read-only
surface every reply agent gets" can cover, and `dispatch` — the one agent that list
reaches — has no branch of its own to commit onto and no delivery waiting on one. A
worker session, which is what actually hit this bug five times, already carries an
unrestricted allowlist and needs no grant to run it.
