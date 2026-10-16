### Is this already filed — the bead that covers it, open or long closed — `b7e-dup`

`bc-dgx7.67` and `bc-dgx7.106`, which are the same question asked from opposite ends. Ten
sessions between them wanted to know whether the thing in front of them was already in a
tracker, and every one of them invented the answer.

`bc-dgx7.106`'s four went at it with different tools each time. `lm-k4n.9` dumped `bd list
--status=all --json` into a Python one-liner and eyeballed 2,300 rows to find `lm-afr.19`,
a bead describing the identical defect that had no branch, no pull request and no commits
— invisible to anything that looks for prior *work*. `lm-5eu.11` spent roughly six calls
(`gh pr view` twice, `gh pr diff`, a `gh pr list --json number,files` filter) to learn that
two of its three items were already fixed in queued pull requests. `lm-k4n` wrote the same
dump to a scratch file — 11,284,468 bytes — and ran a per-name collision check over ten
candidate names. `lm-gr6.64` hit the Dolt single-writer lock, timed out at two minutes, and
fell back to `dolt sql` against the embedded database.

`bc-dgx7.67`'s six guessed *words* at `bd search`, and the guessing is the failure.
`bc-1tno1` ran `"socket hang up"` (nothing), `"drain retired backend"` (nothing), then
`"502"` — four hits, one of which was the same bug filed 3h43m earlier. `bc-xl7n.131` ran
six queries in one loop and every single one answered "No issues found", then filed
anyway. And **four of the six answers those sessions actually wanted were closed or
superseded beads**, which is the half nothing else here can reach.

```
b7e-dup -w beadcause -b bc-dgx7.67                    rank the tracker against that bead
b7e-dup -w beadcause --title "b7e-bd — ..."           rank a title with no bead filed yet
b7e-dup -w beadcause --title "..." --files lib/x.js   compare a declared surface too
b7e-dup -w loremia -b lm-k4n.9 --also beadcause       search a second tracker in the same ranking
b7e-dup -w beadcause -b bc-dgx7.67 --no-closed        live beads only, lib/dupe.js's own question
b7e-dup -w beadcause -b bc-dgx7.67 --json             one object per candidate
```

**This is not `lib/dupe.js`, and the difference is the whole bead.** That module answers
"is this proposed *title* a near-verbatim repeat of a live one" — a 0.9 Dice bar, strict
enough to refuse a `Bd.create` unattended — and its `LIVE_STATUSES` is
`open`/`in_progress`/`blocked` on purpose, because a closed bead is no reason to refuse a
new one. Ranking has no such excuse. So closed and superseded beads are ranked here by
default, and every row carries what decides whether a closed hit is still the same job: the
bead that superseded it, the reason it closed, and the pull request named inside that
reason (this repo's merge queue writes `Merged #737 as bb322781.`, so the number is already
on the row and no `gh` call is owed). `titleVerdict` still reports `lib/dupe.js`'s own bar
beside the ranking score, because "the same bead typed twice" and "about the same subject"
are different findings and a caller deciding rival-or-distinct wants both.

**A superseded hit is a signpost, so the chain is followed rather than printed.**
`bc-1tno1`'s whole outcome was `bin/supersede.js` onto `bc-xl7n.134`; a ranking that names
`bc-1tno1` and stops has named the dead end and called it the destination. `withSuccessors`
walks `superseded-by` to the end and prints each hop after the row that pointed at it —
*outside* `--limit`, since a successor is not a candidate the ranking found but where a
candidate says to go, and dropping it to stay inside a limit loses exactly the id the
caller came for. A successor this call did not list (superseded onto a bead in another
tracker) is still named and marked, because a name is enough to go on. That is the
acceptance criterion, and it holds live: `b7e-dup -w beadcause --title "GET /api/questions
failed — HTTP 502 — api/questions"` names `bc-xl7n.134` and `#737` without being told the
word `502`.

**One weighted term vector, not three summed signals.** Words, declared-or-guessed files
(`lib/beadfiles.js`) and backtick-quoted identifiers live in one TF-IDF cosine built fresh
per run over whatever pool is being ranked. A first version summed them separately and put
every other `bc-dgx7.*` skill bead at the top, because the whole family shares a
copy-pasted "what shipping it takes" paragraph *and* that paragraph names real repo paths
(`lib/toolbelt.js`, `test/lockfile.mjs`), so the file signal was reinforcing the false
positive at 6× weight rather than correcting it. Per-run IDF fixes both without any
stopword or "common infrastructure file" list — a term nearly every candidate has is
evidence of nothing — and the printed `shares:` lines are ordered rarest-first for the same
reason, so the cut keeps the discriminating term and drops the boilerplate.

**An empty answer is said out loud, at exit 0.** "Nothing in beadcause reads like …" is the
ordinary case, not a failure, and printing nothing is what leaves a caller guessing another
three wordings. Exit `2` is bad usage, `4` is a workspace or bead that does not exist, and
`5` is a tracker that could not be read at all — a lock or a timeout is a different answer
from "no such bead" and must not print as one, which is the two minutes `lm-gr6.64` lost.

`bin/b7e-dup` declares `@grant read` (`lib/tooldecl.js` reads it out of the header; there is
nothing to add to `lib/toolbelt.js`), and every path through it is `bd show`/`bd list` plus
the `git`/`gh` reads `lib/prior.js` already makes — and it skips even those for a candidate
whose own close reason already names its pull request. See `bin/b7e-dup`, `lib/dup.js` and
`test/b7edup.mjs`.
