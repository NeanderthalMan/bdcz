### Read the plan on an epic, or check a candidate before filing it — `b7e-plancheck`

`bc-dgx7.18`, filed by the session audit against three planners that each needed exactly
this and each built a different one-off. `bc-ka5y.15` filed a `plan.yaml` and was refused
for a prompt over `MAX_PROMPT_CHARS`, then ran ten successive `python3 - <<'PY'` heredocs
re-measuring every group's dedented length after each trim, guessing at how the writer's
own indentation was being stripped, and was refused a second time. `bc-1kwl` was a
*replan* and needed the plan already on the bead back first: five scratchpad programs —
`replan.cjs` (reconstructing through `planFrom` over `bd comments --json`), a Python
trimmer, two versions of an `addgroup.cjs`, and a `verify.mjs` to run `dispatchable` and
`unplanned` against the live queue by hand. `bc-khoe.33` did the same job a third way,
with a `dump.mjs` and a `python3 -` pass over the dump to print `prompt len` per group.
`lib/plan.js` already exported everything all three needed — this is the argv and the
printing around it, and it never writes.

```
b7e-plancheck bc-jk4m -w beadcause                       the plan (or whole-job decision)
                                                           on the bead right now
b7e-plancheck bc-jk4m -w beadcause --json                 the same facts, machine-readable
b7e-plancheck bc-jk4m -w beadcause --check plan.yaml      would this candidate be accepted?
cat plan.yaml | b7e-plancheck bc-jk4m -w beadcause --check
                                                           same, from stdin
b7e-plancheck bc-jk4m -w beadcause --out plan.yaml        the current plan, as the literal
                                                           YAML beadcause-plan -f accepts
b7e-plancheck bc-jk4m -w beadcause --out | beadcause-plan bc-jk4m -w beadcause -f -
                                                           revise a plan by editing a file
                                                           instead of retyping it from
                                                           `bd comments` by hand
```

**Named `b7e-plancheck` rather than the `bin/b7e-plan` the bead itself asked for.**
`bc-jvt0.6` landed a *different* command at that exact path while this one was being
built — a thin write-shaped proxy that spawns `node bin/plan.js` unchanged, so an Epic
Advocate (whose allowlist has no `node` grant) can reach the door that already writes and
validates a plan or a whole-job decision. Opposite direction from this one — theirs
writes, `@grant excluded`; this one only ever reads, `@grant read` — the same shape as
`bc-dgx7.86`'s `b7e-write` renaming off `b7e-bd`: two beads settling on one name for
opposite jobs, resolved by moving the reader rather than the writer, since the writer is
what an allowlist and a role already depend on by that exact name.

**Default mode prints whichever document actually governs the epic**, by the label the
epic carries — `planned` or `whole-job` — rather than by which comment merely parses,
because a comment can outlive a label write that failed (`bin/plan.js` warns and carries
on rather than refusing). `--check` runs a candidate through the same
`validatePlan`/`validateWhole` `bin/plan.js` would — same refusals, same exit codes (`3`
for a shape `bin/plan.js` itself refuses at the YAML/document level, `4` for a legal
document `validatePlan`/`validateWhole` refuses) — without writing the comment, the
label, or the handback.

**Both modes end with the two verdicts a planner actually needs.** `unplanned` — every
ready bead under the epic no group names, the one that freezes the whole subtree until
it is cleared, at whatever depth the export's parent edges reach (see
"A plan may now name a bead under its epic at any depth" above). And `dispatchable` —
which groups a tick could actually open a window on. The second is **best-effort**: which
windows are already live is `a.workers`, in-memory state inside the daemon's own process
that nothing outside it can read (see `DISPATCHED_PREFIX`'s own header in
`lib/advocate.js`) — so a group is treated as live here when the tracker itself shows one
of its beads `in_progress`, the same mark a real worker window's first line
(`bd update --claim`) leaves. Close to `a.workers`, not identical to it: a bead claimed by
hand outside dispatch reads the same way.

One `bd export` (`Bd.graph`, already cached a minute) answers both `unplanned`'s parent
edges and `dispatchable`'s live-bead guess together — the same status map also backs
`isClosed`'s `unclosed`/`done` verdict, so nothing here pays for a second read of it.

**`--out [file]` (`bc-dgx7.79`) is default mode's own document, back out as the literal
write shape.** Found by a session audit against three *loremia* planning sessions that
each needed to *revise* an existing plan and each rebuilt the read by hand to get there:
`bd comments --json` piped through a Python pass to pull the fenced block and list group
keys in order, one of them then resubmitting six times (4355 → … → 3994 characters) to
land back under `MAX_PROMPT_CHARS` by hand. `lib/plan.js` already has the read — `planFrom`
parses exactly what is stored — `--out` is that document printed in the shape
`beadcause-plan -f` takes, to `<file>` or stdout if none is given. Piping it straight into
`--check` (or into `beadcause-plan -f`) reproduces the stored plan byte-for-byte, because
`validatePlan` rebuilds every group in the same fixed key order regardless of what order
the YAML gave it — that round-trip is `bc-dgx7.79`'s whole acceptance test. Only the YAML
goes to stdout/`<file>`; the per-group budget line and the unplanned list still print, but
to stderr, so a group whose stored prompt already exceeds `MAX_PROMPT_CHARS` (reachable
only by hand-editing a comment or by a cap that shrank after the plan was filed — never
through this tool's own write paths) is flagged in the same run rather than only
discovered on a later `--check`.

Exit codes: `0` printed — a plan or whole-job decision exists, or `--check` reports a
candidate that would be accepted. `1` bad usage. `2` the tracker would not answer, the
epic does not exist, or `--out` was asked for an epic with neither a plan nor a whole-job
decision — nothing to write out. `3`/`4` — see above. `Bash(b7e-plancheck:*)` is on
`DEFAULT_TOOL_LIST`, declared `@grant read` in the command's own header: every `bd` verb
it spawns (`show`, `comments`, `children`, `export`, `ready`, a batched `show` for surface
notes) is a read, and `--check` validates in memory only. See `bin/b7e-plancheck` and
`test/b7eplancheck.mjs`.
