### What the open pull requests are actually doing — `b7e-inflight`

`bc-4r10.19`, and three sessions the session audit found doing the same thing by hand.
`bc-4r10.1` was a review handback: the ReviewAdvocate said "main is green on `test`, so
this is your branch's own breakage", and the session ran `gh pr view`, `gh run view
--log-failed`, `gh run list` over `main`, and `git merge-base --is-ancestor` on four
commits by hand to find out the red was `test/outagepush.mjs` — a known load flake —
from a check run three days old, on a branch 593 commits behind `main` with nothing
pushed to it since. `bc-khoe.30.6` asked the opposite question, looping `gh pr list` then
`gh pr view`/`gh pr diff --name-only` over three pull requests to find out one of them —
from a worktree already retired — deleted the very section it was about to write.
`bc-khoe.30.5` asked a third: is #502 still open and conflicting before touching it. The
data behind all three already lived in `lib/pr.js` and `lib/beadref.js`; nothing exported
it to a command.

```
b7e-inflight                        every open PR in this checkout's repo
b7e-inflight 433                     one PR by number
b7e-inflight --bead bc-x             the PRs naming this bead (open + recently merged)
b7e-inflight --files public/a.js public/b.js   PRs whose diff touches either path
b7e-inflight --files public/a.js --since 30    …reaching 30 days back instead of 14
b7e-inflight -w sorrel               a workspace other than this checkout's own
b7e-inflight --json                  one object per row, for a caller
```

**The one rule this exists to enforce: a red check is a fact about the branch only when
the branch is the thing that changed.** GitHub builds `refs/pull/N/merge`, so a check run
is a verdict against the base *as it stood when the run fired* — while `main` was broken
every open pull request went red, and those runs never re-ran once it was fixed. So every
row's check line carries the run's own timestamp, the sha it ran against, and how far the
head is behind its base **right now** (`lib/prsurvey.js`'s `behindOf`, off the same
`compare` endpoint `commitsBetween` already asked for `bc-91srt`) — and a completed check
whose base has since moved gets a `STALE` marker rather than a bare verdict:

```
#323  no bead named  worktree-old-branch
  OPEN  CLEAN  56d4c4d1
  1 failing (test/outagepush.mjs) — ran 2026-08-15T14:31:00.000Z against 56d4c4d1,
  593 commits behind main — STALE: this base has moved since, so the red is not (yet)
  a fact about this branch's own diff
```

**Unknown is a third answer, never rounded to one of the other two.** A `gh` that cannot
be asked at all — no CLI, not authenticated, GitHub down — comes back as `reachable:
false` over the whole sweep, and the CLI exits `3` and never prints "nothing matches";
reading an empty `rows: []` as "no open pull requests" is exactly the misreading this
guards against. Narrower, per row: `--files` asks `gh pr diff <n> --name-only` (`lib/pr.js`'s
`filesTouched`, asked of GitHub rather than of any worktree on disk — which is what
catches a PR from a worktree that has already been retired, the `bc-khoe.30.6` case) and a
PR whose diff could not be fetched is **kept**, flagged `filesUnknown`, never silently
dropped — dropping it would read exactly like "confirmed not to touch these files".

`--bead` and `--files` both reach past `open`, because a bead or a path collision can
matter about a PR that already merged — the same reasoning `lib/landed.js` gives for
asking `lib/beadref.js`'s `beadsFor` the identical question. Passing a bare PR number is
its own narrowing and refuses to combine with either flag, and `--files` with no paths
after it refuses too rather than quietly widening back to everything.

**A sweep says how wide it was, because an empty answer means nothing without that.**
The first version of this asked `gh pr list --state all --limit 100` and printed the page
it got back. On this repo that page stops at #562 of 661, so `--files public/monitor.js`
listed five pull requests and silently omitted `#433` — the collision `bc-khoe.30.6` was
actually hunting — while `--bead` on anything older printed `(nothing matches)` and
exited `0`. A truncated sweep read exactly like a complete one. So the sweep is now two
calls whose coverage can be checked and is reported: every `open` pull request (at a
ceiling of 400, and a full page is treated as evidence of more rather than as the
answer), plus everything merged inside a window — `listMergedSince`, which already
bisects its own date range and already reports `complete`/`cap`. Every run leads with the
line, and `--json` leads with the same thing as a `{ scope }` object:

```
searched 45 open + 612 merged in the last 14 days (since 2026-08-10)
```

Fourteen days because a `--files` sweep costs one `gh pr diff` per candidate and 278
pull requests merged here in the week to 2026-08-23; `--since` widens or narrows it, and
whichever number is used is printed. That default is not free — `--files
public/monitor.js` over 45 open + 612 merged took 1m39s on 2026-08-23 — and the trade is
deliberate: it is the price of an answer that contains `#433` rather than a fast one that
does not. When something *does* cap the sweep, the line says `INCOMPLETE` and which
number bit, rather than letting a short list pass for a whole one. Open plus merged is
also not literally every state: a pull request closed *without* merging is in neither
half, which is allowed only because the scope line says so on every run — ask for one of
those by number.

The behind-count comes off GitHub's `compare` endpoint, and **`total_commits` is the
count while `.commits` is a page of at most 250**. Reading the array's length — which is
what the first version did — printed `250 commits behind main` for every branch 250 or
more behind, so the `593` in the example above could not be produced by the binary at
all. Measured on this repo: `compare/4ea4b599...main` answers `{returned: 250,
total_commits: 348}`, and `b7e-inflight 323` now says 348.

It declares `@grant read` in its own header, which is all the registration it needs — it only
ever asks `gh` (`pr list`/`view`/`diff`, all reads) and `bd show`, and writes nothing to
either. See `bin/b7e-inflight`, `lib/prsurvey.js` and `test/inflight.mjs`.
