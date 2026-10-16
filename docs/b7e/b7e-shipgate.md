### The default local gate before delivering — `b7e-shipgate`

`bc-xlz32.2`: `b7e-affected` just above already answers "which suites cover this diff" and
`b7e-gate --only` already takes the answer, but nothing composed the two by default —
every session ran the whole 440-suite gate before delivering, roughly twenty worktrees at
a time, which is most of the load the rest of `bc-xlz32` is fighting. Since `bc-rcrt` the
full suite also runs in GitHub Actions on the merge that is actually about to happen, so a
full *local* run before delivering is a slower, less accurate copy of a check that is
going to happen regardless.

```
b7e-shipgate                          affected suites for the diff since origin/main
b7e-shipgate <path> ...                affected suites for these specific files instead
b7e-shipgate --full                    skip narrowing — run the whole gate, deliberately
b7e-shipgate --dir <root>              another tree — this is how it is tested
b7e-shipgate --jobs/--timeout/--log/--json/--skip   forwarded to b7e-gate unchanged
```

**Composed outside `b7e-gate`, not inside it.** `bin/b7e-gate`, `lib/gate.js` and
`scripts/test.mjs` stay untouched by this — `bc-xlz32.1`/`.5` own those three files this
week for a machine-wide gate semaphore, and a `--affected` flag on the gate itself would
collide with that. Composing from outside also keeps `b7e-affected`'s own fallback visible
at the exact point the decision gets made, rather than a layer down inside the gate where
nothing but this command would ever read it. `lib/shipgate.js` carries the pure decision
(narrow, or fall back, and the one-line record either way); `bin/b7e-shipgate` is the argv
parsing, the two subprocesses, and the printing around it.

**The fallback survives intact, because it is read the same way the plain pipe means it.**
`b7e-affected` prints nothing on stdout and exits `1` the instant any changed file matched
no suite — a partial list would look identical to a complete one — and an empty `--only`
selection is `b7e-gate`'s own definition of "everything." This reads `b7e-affected --json`
rather than the plain pipe, only to explain itself (which files, which suites, which ones
came back unmatched) — but it treats an empty `suites` list, whether from an unmatched
file or from no changed files to narrow against in the first place, exactly the way the
plain pipe's empty stdout would: run the whole gate. `--full` (or the plain `b7e-gate`)
stays one word away for the deliberate full run, and CI never narrows —
`.github/workflows/test.yml` always runs everything regardless of what this decides.

**A second gap, found dogfooding this on its own diff.** `b7e-affected`'s own universe is
wider than `b7e-gate`'s on purpose: `lib/affected.js`'s `candidateSuites` matches against
`npm test`'s suites *union* every browser check under `scripts/*-check.mjs`, because both
are real coverage — this repo's own diff for `bc-xlz32.2` narrowed to 245 names, 22 of
them browser checks `b7e-gate` has never heard of. Left alone, `b7e-gate --only` would
silently run only the 223 it recognised (harmless, if quieter than the record claimed) —
but a diff matched *only* by browser checks would hand it a list of names that match
nothing at all, landing on its `nothing matches --only …` refusal: a manufactured
*failure* for a diff with no local `npm test` coverage to run. `restrictToKnownSuites`
filters `b7e-affected`'s list down to `b7e-gate`'s own discovered suites before deciding,
so the record's count is exactly what will run, and a browser-check-only diff reports
`affected: 0 local suites for 1 changed file — every match is a browser check, outside npm
test` and exits `0` without ever invoking `b7e-gate` — distinct from an unmatched file,
which still falls back to the whole gate.

**The last line on stdout is built for `beadcause-deliver --tests`** — e.g.
`tests: affected: 14 suites for 2 changed files, all passed` or
`tests: full gate: lib/foo.js matched no suite, all passed` — so a reviewer sees the
narrowing, or the lack of it, instead of guessing at it from a bare "tests passed."

**A signal on this wrapper has to reach the `b7e-gate` it spawned, not just itself.** The
first version killed cleanly on its own `SIGTERM` and left its child running, orphaned,
still holding `b7e-gate`'s own per-tree lock — a session that killed this command believed
nothing was running while a stale run sat on the lock for whoever ran it next. `lib/
teardown.js`'s `onExit` (the same registration `b7e-gate` itself uses for its lock) forwards
the signal to the child before this process actually exits.

**A bare `b7e-gate` now makes this same decision itself (bc-xlz32.14)**, through the same
`affectedDecision`, so the two cannot disagree about a diff. This command is still the one
to reach for before delivering, because it takes explicit paths, refuses when `b7e-affected`
refuses rather than falling back, and prints the `tests:` line. It hands its decision to the
gate as `--only …` or `--full`, plus `--selection`, so the run record says `affected` rather
than `only`.


Exit codes are whatever `b7e-gate` itself exits with — `0` every selected suite passed,
`1` at least one failed or timed out — plus `2` if either subprocess is refused (bad
usage, or `b7e-affected` itself refusing). `node test/shipgate.mjs` covers the decision
directly (narrow, each of the three fallbacks, `--full`) and drives the real CLI against a
fabricated tree the way `test/gate.mjs` and `test/affected.mjs` do, including a suite that
fails inside the narrowed set, a forwarded `--skip`, and that killing the wrapper mid-run
actually ends the gate underneath it rather than orphaning it.

**On `DEFAULT_TOOL_LIST`**: deliberately NOT on it, for the same
reason as `b7e-gate` just above — every run this does is still `Bash(npm test:*)`-shaped
underneath, which `lib/grants.js` already classifies as a write held by merge-advocate
alone, only narrower.
