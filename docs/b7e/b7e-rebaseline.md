### Turn a gate's own "expected X — got Y" into the edit — `b7e-rebaseline`

`b7e-checks` just above runs a workspace repo's gate scripts and tells you which are red.
This is what sessions did *next*, by hand (`bc-dgx7.76`, in a repo whose gates are Python
scripts): read the new number off the gate's own FAIL line, then hand-propagate it into
every script constant and doc table the old one was written in — never in one pass, and
once twice over, when a merge conflicted in exactly the files a sibling had re-baselined.

```
b7e-rebaseline -w <workspace>              the plan, touching nothing (the default)
b7e-rebaseline --dir <root>                a checkout directly, no workspace needed
b7e-rebaseline -w <workspace> --write      apply it, then re-run the gate to prove it
b7e-rebaseline -w <workspace> --only S3.1  one assertion, by check id or label text
b7e-rebaseline -w <workspace> --no-recheck with --write, skip the confirming second run
b7e-rebaseline -w <workspace> --json       the whole plan as one object
```

**It is the other half of `b7e-count`, not a second copy of it.** `b7e-count` answers
"where is this literal written, and how many times". This answers "what is that number
*now*, read off the gate's own measurement, and which of those sites belong to that
assertion" — the half those sessions had to do after finding the sites.

**Running the gate is `lib/checks.js`, unchanged.** Discovery, the per-check `judge`, the
per-tree lock and the concurrency are `manifestFor`/`discoverChecks`/`runChecks` — the
same set `b7e-checks` runs, from the checkout's own `.beadcause/checks.json`, so the two
commands can never disagree about what this repo's gate *is*. A checkout that declares
none is refused here exactly as it is there.

**A site is only rewritten when its own context names the check.** The dangerous version
of this command is the one that rewrites every `12` in the tree because a check measured
12. So each stale pair carries anchors — its bracketed id (`[S5.2]`), the distinctive
words of its label, and any qualifier number the label holds ("Ch **4** prose words") —
and a site qualifies only when its line, the few lines above it, the nearest heading above
it or the nearest constant assignment above it names one of them. Everything else carrying
the old literal is still *listed*, under "not rewritten", because "here are five more
places that number is written and I did not touch them" is what a human needs to decide
about the rest. A site two stale assertions both claim, disagreeing about what it should
become, is nobody's to rewrite — a concurrent-re-baseline collision, caught rather than
merged.

**The sites are bucketed the way those sessions thought about them** — "the script",
"the doc it mirrors", "a selftest fixture", and `elsewhere` for anything that is none of
the three, reported under its own heading rather than quietly filed as a doc. The
definition site is called out separately: the assigning line in the gate script itself
(`PROSE_WORDS = {`, `4: 3180,`), which is the one a human goes looking for first.

**Formatting survives the rewrite.** A doc table saying `3,180` gets `3,625`, not `3625`,
and a delta written `+1780` stays signed — not cosmetic, because a gate that parses its own
doc back reads a regrouped number as a different one. A trailing comma in a dict literal
(`4: 3180,`) is not a thousands group; a comma only joins a number when three digits
follow it.

**A failure that is not an expected/got pair is reported as out of scope and refuses the
write.** A dangling pointer or a naming violation is a real finding about the tree, and
moving a baseline is never the answer to it — so those are printed, nothing is written even
with `--write`, and the exit code is `2`.

Exit codes: `0` nothing is stale, or a plan was printed, or `--write` applied it and the
gate came back green. `2` refused — bad usage, no `.beadcause/checks.json`, another gate run holds the
lock, or a failure that is not a pair. `3` `--write` has had its go and the gate is still
red — either its edits were not enough, or no site named the check it belongs to and there
was nothing this command was willing to rewrite.

Not on `DEFAULT_TOOL_LIST`, for the `b7e-checks`/`b7e-gate` reason
rather than the read-only shape of `b7e-def`/`b7e-count`: it runs another repo's gate
scripts as external processes for as long as `--timeout` allows — which `lib/grants.js`
already calls a write on the strength of "nothing about run the tests is a read" — and with
`--write` it rewrites tracked files in a checkout it does not own. `dispatch`, the one
agent this list actually governs, answers one phone comment with one `bd comment`; it has
no branch to re-baseline on and no way to commit or review the result. See
`bin/b7e-rebaseline` and `lib/rebaseline.js`.
