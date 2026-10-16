### The brief instead of a CLAUDE.md that does not exist — `b7e-brief`

`bc-ka5y.15` is the session audit naming the same first call *eight* times: every worker
brief tells a session to "read this repo's CLAUDE.md and follow it", and beadcause has
never had one — README.md is the spec, and it is over 2MB. `bc-ka5y.15.5`, `bc-zjab.5`,
`bc-khoe.30.6`, `bc-zjab.4`, `bc-ka5y.15.4`, `bc-khoe.30.7`, `bc-khoe.29` and
`bc-khoe.30.4` each burned a call discovering the absence — no two the same way, one of
them chaining a claim onto a `sed` call so its exit code stopped meaning anything — and
five of the eight then burned a *second* call guessing at which memory-store keys held
the facts they actually needed, between them trying eleven different key names. What they
were assembling by hand is the same brief every time; this prints it.

```
b7e-brief                     the whole brief
b7e-brief --section <name>    just one part: spec, worktree, gate, owed
b7e-brief --dir <root>        another tree — this is how it is tested
```

**Two different kinds of fact, deliberately not treated the same way.** The `spec`
section's README index — every top-level (`#`/`##`) heading with its line number — is
*derived from README.md at run time*, using the same fence-aware heading scan
`b7e-readme` and `test/anchors.mjs` already share (`lib/readme.js`): a `#` at the start of
a line inside a shell snippet is never mistaken for a real heading, which a naive `grep -n
"^# "` gets wrong on this file today (seven hits, six of them comments inside example
config fences). A retitled heading shows up on the next call with no edit to this tool.
Everything else — worktree setup, how the gate is actually run, the sw-cache-bump
question — is read live off this repo's own memory store (`beadcause-memory notes`,
agent `worker`, the agent that actually hits these) under a **fixed set of standing
keys**, one short list per section, and **quoted verbatim, not summarised**: a correction
filed with `beadcause-memory note <key> "..."` changes this command's output on its next
call, no edit here required. The key list is a hard-coded convention rather than "every
note this agent has ever written" — most of which is about something else entirely — and
a key that gets renamed or retired just drops out of the section it belonged to; it never
prints an empty quote.

**This is why `gate` quotes memory rather than stating its own prose.** How the suite is
run here has changed twice already — `npm test` bails at the first red suite, then
`bin/b7e-gate` (`bc-khoe.39`) replaced it as the whole gate — and a brief that hard-codes
"run `npm test`" is worse than a brief that says nothing, because a brief is believed.
Sourcing the description from the same memory keys the notes store already keeps current
(`the-gate-is-one-command-now-bin-b7e-gate`, `b7e-gate-is-the-gate-not-npm-test`) means
the next correction lands the same way any other note correction does, not as a diff to
this file. The one fact computed rather than quoted is the live suite count — `scripts/test.mjs
--list`, the same discovery `b7e-gate` itself uses — because this repo's suite count grows
every week and a number typed into a note goes stale exactly as fast as one typed here.

**Deliberately absent: the checklist for shipping a *new* `b7e-*` command** (two bin
registrations, a `lib/grants.js` classification, `DEFAULT_TOOL_LIST`, this section, a
`test/<name>.mjs`). That is a real and separate debt — `bc-dgx7.2` is where it is defined
— but it is for the rare session extending the toolset, not the ordinary one using it, and
baking it in here would lengthen every unrelated session's brief for a case it is not in.

`Bash(b7e-brief:*)` is on `DEFAULT_TOOL_LIST` and `read` in
`lib/grants.js`, the same shape as `b7e-def`/`b7e-owes`/`b7e-affected`/`b7e-readme` above:
it reads README.md and this repo's own memory store and prints a brief. The one
subprocess it spawns is `node scripts/test.mjs --list`, and only ever `--list` — never a
suite, never `b7e-gate` — which that flag's own header comment already guarantees
"creates nothing". See `bin/b7e-brief` and `test/b7e-brief.mjs`.
