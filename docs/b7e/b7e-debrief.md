### A debrief from a file, not an argv string — `b7e-debrief`

`bc-xl7n.172`. `beadcause-memory debrief <text...>` takes its report only as literal
argv text, and the harness's own worktree sandbox guard refuses a Bash call the moment
that text contains a word like "git" — four loremia sessions (lm-52r.24, lm-gr6.166,
lm-5eu.77, lm-5eu.80) each hit this independently and worked around it a different way.
lm-52r.24 split its debrief into seven calls and reworded "git stash" until each one
passed; lm-5eu.80 failed three times and the surviving debrief was "test message only",
losing a real finding (a claim-guard stale-lock discovery) for good.

```
b7e-debrief report.md                              $BEADCAUSE_BEAD / $BEADCAUSE_AGENT
b7e-debrief report.md --bead bc-xl7n.172 --agent me a human at a terminal, or an override
```

**A plain literal file path is not text computed at runtime, and is not itself a word
the guard pattern-matches against.** So a session writes its report to a file with
`Write` — where the same word "git" has never once been refused, because the guard is
about what a Bash call *runs*, not what a file *contains* — and hands this command the
path instead of typing the report on the command line. `b7e-debrief` reads the file,
and calls the same `debrief()` in `lib/memory.js` that `beadcause-memory debrief`
already calls: same store, `refs/beadcause/debrief/<bead>`, same staging-then-archive
lifecycle. Nothing about *how* a debrief is written changes — only how its text reaches
this process.

**`--bead` and `--agent` resolve exactly as `beadcause-memory debrief` resolves them** —
`$BEADCAUSE_BEAD`/`$BEADCAUSE_AGENT` first, stamped by whatever opened the session, with
the flag as an override for a human at a terminal. Missing either is refused rather than
guessed, the same as `whichBead()`/`me()` in `bin/beadcause-memory`.

**A missing or empty file is refused, naming the path** — not silently filed as an empty
report, and not passed through to `lib/memory.js`'s own generic "a debrief with nothing
in it is not a debrief" with no path attached. The printed byte count is the file as
read (`Buffer.byteLength`, not the trimmed text), so a session that pasted a stray
trailing newline can tell its report landed whole.

`Bash(b7e-debrief:*)` is on `DEFAULT_TOOL_LIST`, declared `@grant write` in
`bin/b7e-debrief.js` — the one thing it ever writes is the same tier-4 debrief store
`beadcause-memory debrief` was already granted to write. See `bin/b7e-debrief.js`,
`lib/memory.js`'s `debrief` and `test/b7edebrief.mjs`.
