### Does the symptom this bead describes still reproduce at a ref — `b7e-premise`

`bc-dgx7.70`. Five sessions (`dv-gr6.48`, `dv-3rn.5`, `dv-b5d.30`, `dv-gr6.47`,
`dv-gr6.44`) each arrived at a bead, hand-checked whether the problem it describes still
exists, and found it already fixed — every one by a different hand-built route.
`dv-3rn.5` and `dv-b5d.30` are the argument by themselves: two separate windows, filed
against the same pair of gate selftests, both independently discovering that
`check_g0_canon_lock_selftest.py` was already green — one duplicated worktree and one
duplicated pull request re-anchoring the same fixture. `dv-gr6.48` checked its two
acceptance criteria with `git merge-base --is-ancestor` and a couple of greps and found
both already true, so the only real work left was a config key.

```
b7e-premise -w beadcause -b bc-dgx7.70                    the printed report, against origin/main
b7e-premise -w beadcause -b bc-dgx7.70 --ref <ref>        against any other ref
b7e-premise -w beadcause -b bc-dgx7.70 --json             the same facts, machine-readable
```

**This is not `b7e-prior` and not `b7e-landed`/`b7e-unlanded`.** Those trace a bead's
*work* — a branch, a pull request, a worktree. `b7e-premise` asks whether the reported
*symptom* still reproduces, which in the founding cases had no branch and no pull
request behind it at all: the defect had been fixed incidentally by somebody else's
merge.

**Claim extraction reads only inline code spans, conservative on purpose.** Every
single-backtick span in a bead's description and acceptance criteria is classified into
exactly one of four checkable shapes — a commit sha (bare, or wrapped in `git merge-base
--is-ancestor <sha> <ref>`), a `python3 scripts/*.py`-shaped command, a slash-bearing
repo path, or a `grep`-shaped literal-in-file check — and checked against the ref. A
span matching none of the four is reported `UNCHECKABLE` by its own raw text, never
silently dropped and never guessed at by looser matching.

**`HOLDS` and `GONE` are the one fact each shape has, not a guess at the bead's
narrative.** A sha *is* an ancestor of the ref (`HOLDS`) or is not (`GONE`); a script
*exits clean* at the ref or does not; a path *exists* or does not; a literal *is
present* in its file or is not. This file never tries to infer whether a bead's prose
meant a claim as a symptom ("still broken") or as a fix condition ("must pass") —
bc-dgx7.70's own examples mix both framings, and guessing the direction is exactly the
kind of guess "conservative on purpose" rules out. The reader is handed the fact and the
evidence and draws the conclusion, same disclaimer `b7e-prior` makes for its own
results.

**The closing verdict and exit code are a reconstruction, not a quote.**
`bc-dgx7.70`'s own acceptance criteria is truncated mid-sentence in the tracker ("Exit 0
when at") — the source bead itself, not a rendering artefact; `bd show bc-dgx7.70
--json` reproduces the same cut. What survives intact is two concrete replay
requirements: against `dv-gr6.48` (two acceptance-criteria claims, "both already true")
this command must exit `4`; against `dv-3rn.5` it must show the G0 selftest
`HOLDS`-clean and the G1 selftest still failing. One rule satisfies both: **exit `4`
when every checkable claim (excluding `UNCHECKABLE`) came back `HOLDS`; exit `0`
otherwise**, including when nothing checkable was found at all. `test/b7epremise.mjs`
pins this reading against fixture repos rather than the two real external beads, which
this checkout cannot reach in CI.

**Only the script claim needs a worktree, and that costs this command its default
grant.** A sha's ancestry, a path's existence and a literal's presence are all plain
`git` plumbing reads against the target checkout. Actually running a `python3
scripts/*.py` claim needs real files on disk at the ref, so `lib/premise.js` reuses
`lib/checks.js`'s `makeRefWorktree`/`removeRefWorktree` — the same throwaway detached
`git worktree add` `b7e-checks --baseline` uses — lazily, only when a script claim is
present, and always torn down before returning. That is the same write-shaped step
`b7e-checks` and `b7e-at` are withheld from `DEFAULT_TOOL_LIST` for, so `b7e-premise` is
withheld too, on the same reasoning, even though bc-dgx7.70's own text asks for the
grant. See `bin/b7e-premise`, `lib/premise.js` and `test/b7epremise.mjs`.
