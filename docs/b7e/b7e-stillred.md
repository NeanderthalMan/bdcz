### Is this suite already known red — whose bead, at what base, and has main fixed it since — `b7e-stillred`

`bc-dgx7.62`, filed by the session audit against six sessions on 2026-08-24
(`bc-ka5y.22`, `bc-ogicx.5`, `bc-9ntye.3`, `bc-beleq`, `bc-9ntye.5`, `bc-dgx7.52`) that
each hit the *same* red suite, `test/finishedepic.mjs`, and each spent five to forty
minutes deciding whose it was, by six different methods, none of them the same: a
reverted-and-rerun scratchpad script, a re-run against the main checkout (`lib/blame.js`'s
own header already calls that tree "routinely tens of commits stale"), moving a live
*locked* worktree's `HEAD` to prove a point and moving it back, `b7e-blame` run against
*current* `origin/main` after the fix had already landed under it, and three separate
`bd search` guesses at the tracker — one of which nearly filed a second bead for a bug
that already had one. Everything needed to answer this was already on disk: `b7e-gate`
writes one JSONL run record per suite to `.claude/gate-runs` in the main checkout, readable
by every worktree on this Mac, and the tracker already held the bead. Nobody after the
session that wrote either one read it.

```
b7e-stillred <suite>...          suites by path, as b7e-gate names them
b7e-stillred --from <gate-log>   take the failures out of a b7e-gate run instead
b7e-stillred --base <ref>        compare against this ref, not the computed merge-base
b7e-stillred --dir <root>        another tree — this is how it is tested
b7e-stillred --json              one object per suite instead of the printed report
```

**Not `b7e-blame` again.** `b7e-blame` (above) answers "is this red on `origin/main`
*right now*" by actually running the suite there — correct, and priced at a real (if
detached and short-lived) `git worktree` and a suite run, twice, every time. This answers
a narrower, cheaper question purely from records: has any `b7e-gate` run on this Mac
*ever* recorded this suite failing, and has any commit touched its own path on
`origin/main` since the base that run was taken against. It never runs the suite and
never builds a worktree — every path through it is a filesystem read of an
already-written record, a handful of bounded `git` plumbing calls (`rev-parse`,
`merge-base`, `log -- <path>`), and a `bd search`.

**Four verdicts.** `no-record` — no gate run on this Mac has ever recorded this suite
failing; nothing to say. `still-red` — it has failed, and no commit has touched its path
on `origin/main` since the base; nothing here says it is fixed. `fixed-on-main` — it has
failed, and at least one commit has touched its path on `origin/main` since the base;
merge `origin/main` rather than re-deriving this by hand. `unclear-base` — it has failed,
but no base could be resolved at all (a run older than the field below, with no `--base`
given, whose own recorded commit no longer merge-bases against `origin/main` either).
Every answer also carries the last recorded failure (worktree, run id, how long ago, at
which commit), how many runs have failed it, the exact commits found on `origin/main`
since the base, and the open bead that already names it, if the tracker has one — a `bd
search` against the suite's own basename, the same word `bc-ka5y.22` searched by hand.

**The base is stamped when the run is taken, not derived from `origin/main`'s current
tip.** `lib/gaterun.js`'s `startRun` now records `mergeBase` — `HEAD`'s merge-base with
`origin/main` *as it stood at that moment* — beside the `sha` it already stamped
(`bc-dgx7.39`), on the same `start` line `b7e-watch` and `b7e-gated` already read. A run
written before that field existed, or one recorded against a `--dir` fixture with no
`origin` remote, falls back to re-deriving the same merge-base from the run's own `sha` at
read time — the answer is identical either way, since a merge-base is a pure function of
the commit graph and a landed commit never moves. This is the exact trap that caught
`b7e-blame` on `bc-dgx7.52`: asked after `bc-beleq`'s fix had already landed, it compared
against `origin/main`'s *then-current* tip and answered "green on main — yours," reading
as "you introduced this" when the truer story was "main moved past you and fixed it
independently." Comparing against the base a run was actually taken at, rather than
whatever `origin/main` has moved to by the time someone asks, is what tells the two apart.
`--base <ref>` overrides this outright, for a caller who already knows the recorded base
is wrong (a rebase, a force-push).

**"Fixed" means a commit touched the path, not that the fix is verified.** `git log
<base>..origin/main -- <suite>` is the whole of the check — every commit on `origin/main`
since the base that touched the suite's own file. A commit that touches a file without
fixing it (a rename, a comment) reads the same way; this reports every such commit rather
than silently deciding among them, so a caller with reason to doubt one still has the
subject lines in front of it. It is not a re-implementation of `b7e-blame`'s named-check
comparison — it is a cheaper, coarser first question, and the honest reason it can afford
to be cheap is that it is answering "does something say this might be fixed," not "prove
it is."

Exit codes: `0` nothing here needs re-deriving (no suite given has any recorded failure,
or every one that does already has a fix on `origin/main` since its base); `1` at least
one suite is recorded red with no fix since its base, or has no base to compare at all;
`2` refused — bad usage, or no suites to look at.

**On `DEFAULT_TOOL_LIST`**, for the `b7e-gated` reason just above
rather than the `b7e-gate`/`b7e-watch`/`b7e-blame`/`b7e-triage` one: it never runs a suite
and never builds a `git worktree`, so it carries none of the "runs the tests" write
`lib/grants.js` already classifies `Bash(npm test:*)` as.
