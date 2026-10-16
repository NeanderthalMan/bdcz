### Every bead id quoted in the tree, with what the tracker now says — `b7e-cites`

This repo argues in its own comments and cites beads by id, and the citations go stale
silently the moment the bead they name settles. `bc-4r10.9` grepped for one string across
three files and found `lib/incident.js:41` — "(bc-228x has not settled whose boundary
this is)" — long after `bc-228x` had closed with its answer,
and found it only because it had just read `bc-228x` for another reason entirely.
`bc-4r10.4` found `lib/policies.js` still crediting itself with work it no longer owned,
and filed a bead about it rather than fixing it in place. `bc-eqn1.2` hit a doc comment
saying some clauses were "still to come" while it was in the middle of writing those
clauses. `bc-4r10.1`, sweeping for something unrelated, found `test/servicescope.mjs:25`
still saying two files "are landing on" main, read unchanged by three later sessions
after both had. `bc-4r10.22` is the session audit naming all four as one shape: nothing
ever swept the tree for the rest.

```
b7e-cites                     every citation under lib, bin, test, scripts, public,
                                android and README.md
b7e-cites <path> [<path> ...] only these files/directories
b7e-cites --stale             only the two definite cases: an unknown id, or a pending
                                phrase about a bead that has since closed
b7e-cites --bead bc-4r10.22   just this one id, everywhere it is quoted
b7e-cites --json              one object per line instead of the printed report
b7e-cites --dir <root>        another tree — this is how it is tested
```

`lib/mentions.js` already had the id matcher — built for prose, over bead fields, for
`scripts/relate-sweep.mjs` — and `lib/bd.js` already had the status; this joins them over
the working tree instead of over a bead's own description. `citationsIn` (`lib/cites.js`)
calls `mentionsIn` once per line rather than once per file, which is what turns "this id
is mentioned somewhere" into "this id is mentioned *here*" — `path:line` is the whole
point of a citation, and every id found is batched into a single `bd show` spawn rather
than one per id (spawn count is the whole cost on this tracker — see the note on `graph`
in `lib/bd.js`).

**The file walk duplicates `lib/repogrep.js` (`bin/b7e-grep`, `bc-4r10.21`) rather than
importing it.** That command settled the same roots and exclusions — skip
`node_modules`, `.git`, `.claude` (so a sibling worktree's own copy of a file is never a
second hit), `.coverage`, `dist`, `.gradle`, `.idea`, `build` — two hours before this bead
was picked up, and its pull request was still on the merge queue, not yet on `main`, when
this was written. Depending on it would have made this branch's own tests only pass in
whichever order the two happened to merge; ~30 duplicated lines costs nothing that a
later consolidation can't undo, and importing an unmerged sibling's module costs a build
that works by luck.

**`--stale`'s pending-phrase list is a reconstruction, not a recovered quote.** The
originating bead's own acceptance text was truncated mid-word — "...is landing, ha" — in
the *stored* description itself (checked with `bd show --json`, not just the wrapped
terminal view), so the closed list in `lib/cites.js` (`PENDING_PHRASES`) is built from the
three citations actually quoted above ("has not settled", "still to come", "are landing
on") plus the natural variant the truncation was reaching for ("has not landed"). A
phrase alone is never a verdict: `lib/cites.js`'s `staleFilter` only flags a pending
phrase when the bead it names has **since closed** — the same sentence about a bead still
genuinely open is not wrong yet, and is not reported.

**What it does not know.** An id shaped like a real one but never filed — `bc-swr`,
`bc-q1`, a typo, a deliberate placeholder in a sentence explaining what a fake id looks
like — reports as `unknown`, same as a genuine stale reference; there is no way from the
text alone to tell "this was never real" from "this used to be real". And it only checks
this checkout's own tracker's prefix (`bc`, via `lib/beadref.js`'s `prefixFor`) — an
example id from another workspace quoted in passing (this file uses a few, illustrating
what another tracker's ids look like) is never resolved, by design: resolving it would
need a live `bd` call against a tracker this Mac may not even have configured.

`Bash(b7e-cites:*)` is on `DEFAULT_TOOL_LIST` and `read` in
`lib/grants.js`, the same shape as `b7e-def`/`b7e-siblings`/`b7e-census` above: its file
walk never leaves the fixed roots, and the only `bd` verbs it spawns — `list --limit 1`
(to learn this tracker's own prefix) and one batched `show` — are both reads. See
`bin/b7e-cites`, `lib/cites.js` and `test/cites.mjs`.
