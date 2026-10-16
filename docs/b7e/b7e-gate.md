### One command runs the whole suite without bailing — `b7e-gate`

`bc-khoe.39` is the fourth finding [the audit agent](../advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work)
filed against the same shape breaking repeatedly rather than once, and it is the biggest
of the four: nine separate sessions (`bc-khoe.23`, `bc-b4fs.1`, `bc-khoe.27.1`, `bc-36xx.6`,
`bc-5k22`, `bc-xl7n.79`, `bc-xl7n.71`, `bc-1kwl.22`, `bc-j52g`) each hand-wrote a runner
into their own scratchpad because `npm test` (`scripts/test.mjs`) has no `--skip`/`--only`
and stops dead at the first red suite — and with `scripts/selftest.mjs` pinned second,
one unrelated failure there hides the other 300-odd. No two of the nine agreed on
parallelism (1, 6, unspecified), per-suite timeout (120s, 300s, none — two of them cost a
session a false red from a suite that needed longer than its guess), or whether to skip
`scripts/test-swap.js`. Five then wrote their own `until grep -q ... ; sleep` polling loop
on top, and two of those were refused by the worktree guard before finding a shape that ran.

```
b7e-gate                              the suites b7e-affected matches for the diff since origin/main
b7e-gate --full                       every suite scripts/test.mjs --list would run, on purpose
b7e-gate --only <suite>|<glob> ...    repeatable — an exact path or a * glob, never a regex
b7e-gate --skip <suite>|<glob> ...    repeatable, applied after --only
b7e-gate --jobs N                     how many suites at once (default: chosen from the load)
b7e-gate --timeout <s>                per-suite seconds, overriding the slow-suite default
b7e-gate --json                       one object per suite, streamed, for a caller to parse
b7e-gate --log <path>                 also write every line here (default: a tmp file, named at the end)
b7e-gate --list                       what would run, without running it
b7e-gate --dir <root>                 another tree — this is how it is tested
```

**Narrowed by default, and every run says why it is the size it is (bc-xlz32.14).** A
bare `b7e-gate` used to be the whole suite, and that default was most of the full lane's
traffic. Measured over the 99 run records with a slot field on 2026-09-22, 37 whole-suite
gates came from sessions and none of them was a deliberate `--full`: 13 were a bare
`b7e-detach`, 5 a bare `b7e-gate`, and 7 were `b7e-shipgate` falling back over a changed
`docs/*.md`. Their median was 24 minutes from queueing to the end. So with no `--only` and
no `--full`, the gate now takes the same decision [`b7e-shipgate`](b7e-shipgate.md)
takes (`affectedDecision`, `lib/shipgate.js`). It runs the suites `b7e-affected` matches for
the diff since origin/main plus anything uncommitted. It runs every suite when a changed
file matches none, when there is no diff at all, or when `b7e-affected` refuses, and in each
of those cases it says so and says why:

```
selection: affected: 14 suites for 2 changed files — `--full` runs all 564
selection: full gate: lib/foo.js matched no suite — running all 564 suites
```

That line is printed before the gate queues for a slot, so a waiting run has already said
what it will run. `--list` prints it on stderr. The same decision goes on the run record's
start line as `selection: { kind, reason }`. `kind` is `affected`, `only` (a caller's own
`--only`), `full-requested` (`--full`), `full-fallback` (narrowing could not be trusted) or
`full-ci`. The next measurement of `.claude/gate-runs` can then tell a whole run somebody
asked for from one narrowing gave up on. **CI never narrows.** Its shards pass `--only`,
and a bare `b7e-gate` with `CI` or `GITHUB_ACTIONS` set runs everything as `full-ci`.
`.github/workflows/test.yml` is untouched. `--full` and `--only` together are refused. A
caller that has already decided (the shipgate) passes `--selection <kind>
--selection-reason <text>` so the decision is recorded rather than made twice.
`test/shipgate.mjs` drives all of it against a real git fixture.

**Prose narrows too.** A `README.md` or `docs/**.md` counts as covered by any suite that reads
the specification. That means one whose imports reach `lib/docset.js`, the enumerator of
README plus `docs/*.md`, or one that walks `docs/` itself. It no longer matches nothing.
Before this change, one doc edit anywhere in a diff ran the whole gate. Now a docs edit
selects the 20-odd suites that check links, headings and config tables. A doc nothing
enumerates, walks or names is still unmatched, and still runs everything.

**Discovery is reused, not reimplemented.** `lib/gate.js` shells out to
`scripts/test.mjs --list --dir <root>` for the suite list, which is the pinned order
(`test/lockfile.mjs`, `scripts/selftest.mjs` first, `scripts/test-swap.js` last) and the
sorted middle both at once — the same argument `scripts/coverage.mjs` already makes for
doing this rather than a second `readdirSync`: a suite list can never disagree with
`npm test` about what a suite is if there is only one place it is decided.

**No bail, and real concurrency.** Every suite in the selection runs regardless of an
earlier failure — the exit code is non-zero if any of them did, but the tally names which
ones and the rest were not held hostage to being alphabetically first. The pool is `spawn`
(async), not `spawnSync` in a loop dressed up as workers — `spawnSync` blocks the one JS
thread, so N "workers" built on it run strictly one at a time and a serial run wears a
parallel runner's clothes. `test/gate.mjs` proves the
difference by writing a start/end timestamp either side of a sleep in two fabricated
suites and asserting the windows actually overlap, and each concurrent suite gets its own
`TMPDIR` sandbox the same way `scripts/test.mjs` and `scripts/checks.mjs` already do
(bc-5isv), so nothing here can leak the shared `$TMPDIR` twenty other sessions are using.

**Two suites cannot take the pool, and one family wants longer alone.**
`scripts/test-swap.js` drives a real blue/green swap under load and `test/slowstart.mjs`
is a documented flake under concurrent load that passes alone — both are held out of the
concurrent pool and run afterward, one at a time, rather than being skipped by convention the way some of the
nine sessions did and some did not. Every suite driving the *real* `bd` against shared
state (`test/*real.mjs`) plus `test/landcheck.mjs`, which drives a real `git`+`bd` end to
end through `bin/deliver.js`, gets fifteen minutes instead of the ordinary five by
default — a loaded Mac should report one of these slow, not manufacture a red from it —
and `--timeout` overrides both defaults uniformly, because an explicit ask from whoever is
running the gate is a real ask.

**One gate per tree at a time.** A second invocation against the same root while the
first is still running would double the load a busy Mac is already under, so it refuses
(exit `2`) rather than doing that — a lock file under the system temp directory, keyed by
the resolved root, holding the running pid. A lock whose pid is no longer alive is stale
and is silently reclaimed on the next attempt, because a runner that leaves a permanent
lock behind after a crash is worse than the race it exists to prevent. That reclaim is a
backstop and not the ordinary path: a run that ends at all — cleanly, red, or signalled —
removes its own lock file, which for a long time it did not (bc-dgx7.40). `onExit` hands
back a *disarm*, which marks the teardown done without running it, so calling only that on
the happy path meant the file was never removed at all — and because the path is keyed by
the root, that is one permanent `beadcause-gate-<hash>.lock` for every tree that has ever
run a gate, outliving the worktree itself by however long the temp directory lasts.
Measured on this Mac while fixing it: **108** of them. The stale-lock reclaim above is
exactly why nobody noticed — the next run on that tree worked every time.

**And two gates on the Mac, with the third in a queue — `bc-xlz32.1`.** That refusal was
right and too narrow: the doubling happens just as thoroughly from a different worktree,
and there are ~20 of those. Measured from the 60 run records in `.claude/gate-runs`, which
carry per-suite elapsed and had never been read: a gate with nothing overlapping it is a
mean **9.6 min** (n=16); the same run with >=1.5 concurrent sibling gates is **16.7 min**
(n=13). Identical work, 74% slower, and nobody gains — the machine has the same 12 cores
whether one gate or six are asking for them. Six were in flight at once at load average 99,
and the loaded runs are also the ones that manufacture false reds: a full gate came back
434/440 with six reds that same day and **all six passed** re-run serially, same tree, no
changes.

So a third gate now **waits** — `acquireSlot` in `lib/gate.js`, a FIFO semaphore of two
(`BEADCAUSE_GATE_SLOTS` to change it, `0` to opt out) — and says what it is waiting for:
`1 gate ahead of you, oldest started 4m ago`. Waiting rather than refusing is the whole
design: a session told to go away runs `node scripts/test.mjs` instead, which is invisible
to every overlap metric and worse for everyone. Which is also why **`npm test` takes the
same token** — the two runs measured at 41 and 51 minutes elapsed on the load-99 Mac were
both the plain serial runner, and a semaphore only `b7e-gate` respects is one the heaviest
caller walks straight past.

Tickets rather than a counter, so two runs starting in the same millisecond cannot both
read "one free" and both take it, and so a loser keeps its place instead of going to the
back of the queue on every retry. **The stamp on a ticket keeps its sub-millisecond part**,
which is the half of that the first version got wrong: the queue is ordered by `startedAt`
and `Date.now()` is a whole millisecond, so tickets taken back-to-back all landed inside one
and the order fell through to the random suffix in each ticket's filename. A gate arriving
third then sorted first about two times in three, and took a slot the two ahead of it were
already holding — `limit + 1` gates on the Mac, which is the one thing the semaphore is for.
`performance.now()` is monotonic within a process, so a later ticket is now always a larger
number and the queue is creation order rather than a coin toss. A holder killed with `SIGKILL` frees its slot the same
way a stale lock is reclaimed — by its pid being dead. Three runs never queue: CI (a
GitHub runner is a machine of its own), anything that opted out, and **a runner started
inside a gate**, which would otherwise wait for the slot its own parent is holding — both
runners mark every suite child with `BEADCAUSE_GATE_HELD` for exactly that.

**A small gate has a lane of its own — `bc-xlz32.12`.** The queue used to be size-blind:
the slot was taken before the suite list was computed, so a gate with 11 suites and twelve
seconds of work was charged as a full one and waited 35 minutes behind two 500-suite gates.
`b7e-gate` now selects its suites first, and one selecting `SMALL_GATE_SUITES` (60) or fewer
queues in a second lane of `SMALL_SLOTS` (2, `BEADCAUSE_GATE_SMALL_SLOTS` to change it) that
never sees a full gate's ticket, nor a full gate one of its. The full lane — the load budget
of two — is unchanged, and both lanes are off wherever the full one is (held, CI, opted out).
Sizes here are bimodal (nothing between 236 and 420 suites across 400 records), which is why
a count is a good enough proxy for work.

**The wait is on the record — `bc-xlz32.11`.** `startRun` is stamped once the slot is held,
on purpose (a run killed in the queue leaves nothing behind), which used to make the queue
invisible. The start line now carries `slot: {admission, limit, held, waitedMs, ahead,
queuedAt}` — `admission` is `full`, `small` or `off` (no semaphore applied), `waitedMs` is `0`
rather than absent for a run that got straight in, and a session's wait + run is
`end.at − slot.queuedAt` from the record alone.

**`--jobs` is chosen from the load, not from a constant — `bc-xlz32.5`.** 6 was wrong in
both directions. Too few on a quiet Mac: the longest single suite is `test/landcheck.mjs`
at 307s against ~50 min of total suite work, so a pool does not begin waiting on a
straggler until roughly 15 jobs, and at 6 on an idle 12-core Mac half the machine sits
unused. Too many on a busy one: six sessions each asking for 6 is 36 concurrent suites on
12 cores. `chooseJobs` clamps `cores - loadavg1` between 2 and `cores - 2`, sampled once at
start — a pool that resized itself mid-run would make two runs of the same suite
incomparable. An explicit `--jobs N` still wins outright, the rule `--timeout` already
follows, and the opening line says which number was picked and why, so a slow gate can be
accounted for after the fact.

**Deliberately not on `DEFAULT_TOOL_LIST`**, for a sharper version of
the reason `b7e-say` is not there: `lib/grants.js` already classifies `Bash(npm test:*)` —
running this repository's own suites — as a `write`, "spawns daemons, binds ports and
writes scratch directories," and grants it to `merge-advocate` alone. `b7e-gate` does
exactly that, concurrently, for up to fifty minutes on a loaded Mac; it is a heavier
version of the same capability, not a lighter one. `DEFAULT_TOOL_LIST` widens exactly one
agent's baseline — `dispatch`, the single-turn phone comment answerer — which has no more
use for running the whole suite than it does for
`b7e-say`'s seven write actions. A worker session, which is what actually hits the
shape this bead is about, already carries an unrestricted allowlist and needs no grant to
run it.

**A second arm, declared by the checkout — `bc-khoe.61`, `bc-j2zwo.5`.** `bc-khoe.39`
above is the *beadcause* arm: this repo's own `scripts/test.mjs` discovery, a suite list,
a concurrent pool. `bc-khoe.61` names ten sessions in a Python checkout that each hand-
assembled `PYTHONPATH=. .venv/bin/python <its test runner>` from a worktree instead — nine
hardcoded the main checkout's absolute interpreter path, because a fresh worktree never has
its own `.venv`, and the runner prints `ERROR:` lines and a logging-teardown traceback on a
run that still passes, so scraping its stdout for a verdict is actively wrong (its own exit
code is the only honest signal).

`--dir <root>` (or its default, this repo's own root) still names the tree. Whether the
Python arm runs, and which script it runs, is that checkout's own declaration in
`.beadcause/gate.json` — `{"python": "<repo-relative script>"}`, read by `lib/pygate.js`'s
`readGateDecl` — the same per-checkout convention as `.beadcause/derived.json`, so the
script's path lives in the commit that changes it and nothing here names another repo's
files. There is no default: an undeclared tree is the Node arm, and a declaration that does
not parse, is not a relative path inside the checkout, or names a missing file is refused
with exit `2` rather than falling back. (Until `bc-j2zwo.5` this arm was chosen by one
hardcoded runner path existing.)
`findInterpreter` checks `<root>/.venv/bin/python(3)` first and, failing that, walks up via
`git rev-parse --git-common-dir` to the main checkout's own `.venv` — the one call every
hand-rolled interpreter path above was standing in for. `--only`/`--skip` are the Node arm's
own suite-glob selection and are refused outright on this arm rather than silently doing
nothing; a module filter is the declared script's own positional argument, so it is forwarded
verbatim through a literal `--` (`b7e-gate --dir <python worktree> -- tests.test_report`).
Everything else about the command is shared, unchanged, between both arms: the per-tree
lock, the machine-wide slot queue, `--json`, `--log`, and the `.claude/gate-runs` record
`bin/b7e-watch` reads — the whole reason a run longer than the caller's own timeout is
retrievable rather than restarted, on this arm exactly as on the first.

**A queued gate whose session has gone leaves the queue — `bc-xl7n.165`.** The semaphore
reclaims a holder whose *pid* is dead, which is the wrong question for a gate whose window
died and whose own process did not: it is alive, so it holds its place, and then takes a
slot and runs a whole gate for a result nothing will read (pid 89475 on 2026-09-20, five
gates deep for the better part of an hour). The rule the bead first proposed — treat
`ppid === 1` as stale — is **not** the fix and must not be tried again: `b7e-detach`
starts every gate it makes with `setsid(2)`, so a healthy detached gate mid-suite for a
live session has `ppid` 1 by design (measured the same afternoon on pid 70952). What
separates the two is who asked. `findOwner` (`lib/gate.js`) names the nearest `claude`
process above the gate, with its start time so a recycled pid is not mistaken for it;
`b7e-detach` and `b7e-shipgate` resolve it themselves and hand it across the `setsid` in
`BEADCAUSE_GATE_OWNER` (`0` means "no owner"). While the gate is *queued* it asks every ten
seconds whether that process is still there and, if not, withdraws its ticket, releases
its per-tree lock and exits `3` (`acquireSlot`'s `abandoned`). Three things it deliberately
does not do: a gate with no `claude` above it (a shell, launchd, CI) has no owner and is
never touched; a gate that already holds a slot is left to finish, because its
`.claude/gate-runs` record outlives whoever started it and `b7e-watch` reads it from any
later session; and it changes nothing for a gate already running on old code — those still
need their own `kill <pid>`, which an agent's classifier will refuse. A session that is
closed and later *resumed* has a new pid, so a gate it left queued is withdrawn too; the
message on the log says so, and the run is a re-run away.

Also **deliberately not on `DEFAULT_TOOL_LIST`**, and for the identical reason as the arm
above rather than a new one: it is still `Bash(npm test:*)`-shaped load — a subprocess that
runs a whole suite for minutes — in a second repo, and which repo it happens to be running
against changes nothing about who should be allowed to ask for it.
