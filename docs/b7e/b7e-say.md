### Agent prose goes into a bead or a memory from a file, never a shell argument — `b7e-say`

`bc-gdub.2` is the third finding [the audit agent](../advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work)
filed against the same shape breaking repeatedly rather than once, and the shape here is
narrower and nastier than the other two: `beadcause-memory debrief`, `note` and
`remember`, `bin/checkin.js -m`, and three of `bin/deliver.js`'s flags (`--tests`,
`--risk`, `--left`) all take the text a session wants to say as a literal argv token. A
session ending a run has paragraphs to say and that prose is about code, so it is full of
backticks — and a Bash tool call embeds its command as one double-quoted string, in which
bash resolves a backtick as command substitution **before** the command being quoted ever
runs. `beadcause-memory debrief "…\`git checkout main -- lib/server.js\`…"` does not
describe that checkout; it performs it. That happened twice, on two different beads
(`bc-gdub`, `bc-ka5y.15.2`), the second time reverting three files mid-session with
nothing said about it until `bin/deliver.js` refused over a dirty tree. Five sessions
(`bc-gdub`, `bc-ka5y.15.2`, `bc-khoe.27.2`, `bc-y8k4.4`, `bc-r2b5.1`) each hand-rolled a
different scratch-file workaround around exactly this — one of them wrote and
`rm -f`'d a wrapper script mid-session to get a debrief past the worktree isolation
check, which refuses a `$(cat …)` command substitution as too complex to verify.

```
b7e-say -w <workspace> -b <bead> --debrief                [--file <path>]
b7e-say -w <workspace> -b <bead> --note <key>              [--file <path>]
b7e-say -w <workspace> -b <bead> --remember <key>          [--file <path>]
b7e-say -w <workspace> -b <bead> --checkin                 [--file <path>]
b7e-say -w <workspace> -b <bead> --tests|--risk|--left     [--file <path>]
```

Exactly one action, and the body always comes from `--file <path>` or stdin — never a
positional argument, so there is nothing for a shell to re-scan. A heredoc with a quoted
delimiter (`<<'EOF' … EOF`) is untouched by this: nothing inside it is expanded, which is
the whole reason every worker brief in this repo already tells a session to spend one on
its debrief and its delivery summary. `--debrief`, `--note` and `--remember` call
`lib/memory.js`'s functions of the same name directly — the same store, the same 64
character key limit, checked synchronously before either reads or writes a ref, so a key
that is too long is refused before anything lands rather than after (`bc-y8k4.4` hit the
"after" case the hard way). `--checkin` writes the same file `bin/checkin.js` does, via
the same `checkinFileFor` (`lib/advocate.js`). `--tests`, `--risk` and `--left` post a
labelled `bd comment` on the bead (`**Tests:** …`, `**Worth knowing:** …`,
`**Left undone:** …`) through `lib/bd.js`'s `Bd` class — an `execFile`, never a shell, so
the same body is safe there too.

**What it deliberately leaves alone.** `bin/deliver.js`'s own `--tests`, `--risk` and
`--left` flags are still argv — this does not change them, and a delivery with anything
dangerous in those three still has to keep them short or paste them from a comment
`b7e-say --tests` already put on the bead. Fixing that is a `bin/deliver.js` change (a
`--tests-file` alongside the summary's existing `--file`, most likely) and it is a
different, separately-reviewable diff — filed rather than folded in here.

It is not on `DEFAULT_TOOL_LIST`, unlike `b7e-def` and `b7e-owes`.
Both of those are read-only lookups any reply agent benefits from; this is a write tool
for ending a worker's own run, and the one agent `DEFAULT_TOOL_LIST` actually reaches —
`dispatch`, "the comment answerer" — has no bead of its own to debrief, no repo notes to
leave, and no worker slot to check in on. A worker session, which is what actually hits
this bug, already carries an unrestricted allowlist and needs no grant to run it.
