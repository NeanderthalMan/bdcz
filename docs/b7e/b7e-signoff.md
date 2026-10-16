### End a delivered run — `b7e-signoff`

`bc-dgx7.44` — the session audit's own genre of finding, and the one it filed about
itself: five sessions (`bc-1kwl.32`, `bc-ibt8g.1`, `bc-xl7n.120`, `bc-xl7n.118`,
`bc-36xx.27`) all ended the same way — deliver the branch, leave a debrief, rename the
session — and no two of them did it the same way. `bc-1kwl.32` ran `deliver.js` from the
main checkout and hit `refusing to open a PR from main into main`, then re-ran it with an
absolute path from the worktree. `bc-ibt8g.1` put backticks in a `beadcause-memory
debrief "…"` argument; the shell resolved them before the command ever ran, and the
stored debrief carries `(eval):1: no such file or directory` inside it to this day.
`bc-xl7n.120` and `bc-xl7n.118` hit the worktree guard refusing the same one-liner as
"too complex to verify it stays inside the worktree", and recovered two different ways.
Every session hand-truncated the session's new name to a different length, twice cutting
it mid-word. `beadcause-memory debrief`, `bin/deliver.js` and
`~/.claude/rename-session.sh` all already worked; nothing sequenced them, so the same two
traps were rediscovered on almost every run that used them.

```
b7e-signoff -w beadcause -b bc-dgx7.44 \
  --summary summary.md --debrief debrief.md \
  [--tests tests.md] [--risk risk.md] [--left left.md] \
  [--marker "DEPLOYED, REBUILT"] [--title "..."] [--base main] [--method merge] [--review]

b7e-signoff -w beadcause -b bc-dgx7.44 --dry     print the plan, touch nothing
```

Four steps, run by `lib/signoff.js#runSteps`, which stops — without touching the ones
after it — the instant one throws:

**1. Deliver.** Resolves the bead's own worktree itself, before `bin/deliver.js` is ever
reached: a live worktree's branch is `worktree-<slug>-<tag>`, where `<tag>` is the bead
id with its workspace prefix and punctuation stripped (`bc-dgx7.44` → `dgx744`, the same
rule `lib/notinmain.js`'s `tagOf`/`ownsBranch` already use to tell a stranded branch's
bead apart from an unrelated one). Zero live worktrees claiming that tag, or more than
one, is a refusal naming the pattern it looked for — `deliver.js`'s own "refusing to open
a PR from main into main" never has a chance to fire, because deliver is never handed the
wrong directory to begin with. Runs `node bin/deliver.js -w <ws> -b <bead> --dir
<worktree> …`, forwarding `--summary` as deliver's `-f`, `--tests`/`--risk`/`--left` as
its own inline flags, and `--marker`'s words as `--owed`; prints deliver's own last line
of output unchanged, whichever of its three endings it took.

**2. Debrief.** `lib/memory.js#debrief(agent, bead, text)`, called in-process exactly as
`bin/b7e-say.js --debrief` already does — the report lands in the *main* checkout's ref
regardless of whether this process is standing in the worktree or the main checkout,
because `debrief` resolves that itself.

**3. Rename.** Reads this session's current name (`~/.claude/rename-session.sh --show`,
overridable with `--rename-script`) and prepends `QUEUED-` — never re-derives the rest of
the name, and never stacks a second prefix onto a session that is already `QUEUED-` or
`DONE-` (`lib/signoff.js#queuedTitle`, built on the same `saidFinished` `lib/reap.js`
already uses). With no current name to read at all, falls back to the bead's own title in
full (`fallbackTitle`) — never hand-shortened, which is the other half of the
mid-word-truncation bug above.

**4. Marker.** Prints the closing `** BEAD WORK DONE **` line every worker brief in this
repo ends a delivered run with. A delivery that ended in a question card — auto-merge off
for this space, `--review`, an in-app edit — can only ever owe `REVIEWED`: nothing after
a merge can be owed by work that has not merged. So this overrides `--marker` to
`REVIEWED` in that one case and says so on stderr, rather than printing a marker that
quietly disagrees with what `deliver.js` actually did.

**`--summary`/`--debrief`/`--tests`/`--risk`/`--left` each take a file path, or `-` for
stdin — never inline text**, the same reason `b7e-say` takes its body from `--file` or
stdin: a backtick or `$(...)` inside multi-line prose is resolved by the shell before the
command ever sees it if it arrives as an argv string, and none of these five ever do —
each is read with `fs.readFileSync` and forwarded to `deliver.js` as one argv element of
a real `child_process` call, which never re-parses it. At most one of the five may be
`-`, checked before anything is touched.

Exit codes: `2` bad usage. `4` no such workspace or bead. `5` the worktree could not be
resolved. `6` a later step threw — the message names which one, and every step that did
run is still printed above it, so a re-run's caller can see what already happened.

Not on `DEFAULT_TOOL_LIST` in `lib/toolbelt.js`, for the `b7e-apply` reason rather than a
read-only one: its whole job is `deliver.js` — pushing a branch, opening a pull request,
filing a merge-bead — plus a debrief write and a rename, none of which is a read by any
stretch. `dispatch`, the one agent that list governs, has no branch of its own, delivers
nothing, and would only ever reach this command to end a session it never opened. See
`bin/b7e-signoff`, `lib/signoff.js` and `test/signoff.mjs`.

**The other two endings — `--ending` (`bc-dgx7.69`).** Eleven more hand-run sessions
disagreed about what a run that *delivered nothing* owes: one renamed itself `QUEUED-`
over a run with no pull request and spent a second call undoing it, three printed no
marker at all, and a long debrief passed as a shell argument was refused outright by the
permission classifier. `--ending queued` (the default) is everything above.
`--ending handback` (a decision card, a superseded or blocked marker, "bigger than it
looked") and `--ending nocode` (a tracker-only run, nothing for `deliver.js` to push)
run the debrief step alone — the report comes from `--debrief` or its alias `--note`, a
file or `-`, never a shell argument — and then say, in one line each, that there was no
pull request, no `QUEUED-` rename and no marker line. Neither ending resolves a
worktree, so neither needs one. The `QUEUED-` name `--ending queued` writes is asserted
in `test/signoff.mjs` to satisfy `saidFinished` and `namesBead` for its own bead and not
for a sibling such as `lm-qok` against `lm-qok.1`.
