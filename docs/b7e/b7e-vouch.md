### The delivery call checked against the branch, before it fires — `b7e-vouch`

`bc-dgx7.130`, filed originally in another workspace's tracker and moved here for
the same reason `b7e-fresh` was: it describes beadcause tooling, not that project's content. A
session audit (`lib/sessionaudit.js`) found the same close in four deliveries in that
workspace, and no two ended it the same way:
write a `--tests` string and a PR body from memory, run `git diff main...HEAD
--name-only`, read the two against each other by eye, then fire `bin/deliver.js`.
One delivery's own eyeball read "Matches what I described" — true of the file list, false
of a sentence three paragraphs earlier deciding `--review` that was never threaded back
into the actual argv. It went to the auto-merge queue as PR #188, and the repair was a
correction comment after the fact. The file list was never the risk; a claim written as
prose is not re-checked the way an argument is.

```
b7e-vouch -w acme -b ac-5i2.98 --body pr-body.md -- --tests "…" --review
b7e-vouch -w beadcause -b bc-dgx7.130 --body - < body.md    # stdin, no argv to check
b7e-vouch -w acme -b ac-5i2.96 --body pr-body.md --ran run.log -- --tests "…"
b7e-vouch ... --dir <root>      another checkout — this is how it is tested
```

Three independent checks, `lib/vouch.js`, each returning a finding or nothing:

**Flags.** Every flag `bin/deliver.js` reads off its own argv, written literally as
`--flag` in the body's prose, checked against the argv given after `--` on this
command's own line — the exact argv a caller is about to hand `deliver.js`. Both
directions for `--review` / `--no-merge` (the pair whose silent presence or absence
actually changes what a delivery does — `deliver.js`'s own `review = has('--review') ||
has('--no-merge')`); forward-only for the rest, since a body almost never spells out
`--tests` or `--risk` by flag name and checking that direction there would be noise, not
signal. Skipped entirely when no `--` is given at all — there is no argv to compare
against, not an empty one.

**Paths.** Every file the branch actually changed — `git diff <base>...HEAD --name-only`,
the identical three-dot form `bin/deliver.js` runs for its own diffstat — against what
the body names by full path, bare filename, or an identifier-shaped stem (`CHANGE_LOG`
standing in for `CHANGE_LOG.md`; a plain lowercase word never does, so "regions" in an
unrelated sentence about a *different* file's directory can't silently cover
`regions.json`). The bead's own `description` and `acceptance_criteria` (`bd show`, via
`-b`) are folded in as a fallback source of *mentions* — never of new claims to check —
because a body is allowed to say "both files named in the bead's acceptance criteria"
rather than repeat them, which another of those four deliveries' real PR body does for exactly one of its
three changed files. Claim-extraction (the reverse direction: a path the body names that
is not in the diff) excludes `lib/prtext.js`'s own `**Tests:**` / `**Worth knowing:**` /
`**Left undone:**` paragraphs and its auto-generated `<details>` diffstat block first —
none of those are "files I changed" claims (a real `--tests` value routinely reads
`scripts/check_links.py . → PASS`, a path-shaped token this diff never
touched), and the auto block is mechanically derived from the real diff so checking prose
against it is checking `deliver.js` against itself.

**Tests.** Only runs with both `--ran <file>` and a `--tests <value>` inside the given
argv: script/suite names named in that value (`scripts/check_links.py`,
`test/b7evouch.mjs`), checked against the raw content of `--ran` — a transcript, a
`lib/gaterun.js` JSONL run, anything the real name would appear in verbatim. A name not
found there did not run under that name — renamed, typo'd, or never run at all.

Prints one line per disagreement, or nothing. Exit codes: `0` nothing to flag, `1` one or
more disagreements printed, `2` bad usage — missing args, no such workspace, no such
bead, or nothing to diff against. `-w`/`-b` resolve `bd show` (via `BEADS_DIR=<ws>.dir`,
the same explicit override `bin/deliver.js` itself uses for a cross-workspace call — bare
`bd` on `PATH`, like `b7e-notes`, not `cfg.bdBin`, which hardcodes real install locations
ahead of `PATH` and would leave a test unable to substitute a fake) and the delivery base
(`baseFor`, the same resolution `b7e-fresh` uses). Read-only throughout — a `git diff`,
a `git fetch`, a `bd show`, and file reads.
