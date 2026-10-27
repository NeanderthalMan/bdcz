# Development — the gate, the suites and a second instance

## A second instance — observer mode

Sooner or later you want to look at a change to the UI without restarting the live
daemon on `:4318`, so you boot a second one on a spare port with its own config
directory. **Do not do that without `BEADCAUSE_OBSERVE=1`.**

`BEADCAUSE_CONFIG_DIR` isolates the config, the state file and the token. That is
*all* it isolates. The tracker, the repos and `.claude/worktrees/` belong to the
machine, so a second daemon is a second **fully live** daemon: it has its own
advocates, its own poll loop, and no idea the first one exists. Booted from a copy
of your real config, its first tick — thirty seconds in — opened two Claude sessions
in two repos and retired a worktree in the shared checkout. Nothing malfunctioned.
It did exactly what the live one does, twice.

So:

```sh
mkdir -p /tmp/bc
jq '.port=4372 | .baseUrl="http://127.0.0.1:4372" | .host="127.0.0.1"' \
  ~/.config/beadcause/config.json > /tmp/bc/config.json

BEADCAUSE_CONFIG_DIR=/tmp/bc BEADCAUSE_OBSERVE=1 node bin/beadcause.js
```

Reach it at `http://127.0.0.1:4372/?t=<token from that config>`. Pick the port
yourself and check it's free — `4319` is taken by something unrelated on this Mac.

It says so at startup, unmissably, because the way this flag fails is you believing
you set it:

```
[beadcause] ─────────────────────────────────────────────────────
[beadcause] OBSERVING — this instance watches and never acts.
[beadcause]   no sessions · no proposals · no worktree sweeps
[beadcause]   no session logs · no reply agents · no ntfy push
[beadcause]   the terminal, the chat session and answering still work
[beadcause] ─────────────────────────────────────────────────────
```

**What it switches off** — everything the daemon would do on its own:

| off | otherwise |
|---|---|
| advocates opening sessions | a real Claude window per ready bead, in the shared checkout |
| bead proposals | a survey agent, and a question in your inbox from an instance you booted to look at CSS |
| worktree sweeps | `.claude/worktrees/` retired out from under sibling sessions — the one act that reaches outside the config directory to move somebody else's work |
| session logs | `refs/beadcause/sessions/*` and git notes written into repos this instance is only visiting |
| reply agents | two daemons dispatching two agents at the same comment |
| ntfy push | two notifications per question, whose buttons answer on two different ports |
| `POST /api/session` | the one button whose consequence is an hour of unattended agent |

Advocates still **survey**, so the ready queue and what each would pick up next are
on screen — that is usually the thing you booted a second instance to look at. Each
card reads `observing — this instance never acts on its own · N ready`.

**Which daemon am I looking at?** An amber `⦿ OBSERVING` badge sits beside the page
title on `/monitor` and `/work`, and beside the name in the terminal monitor. The
advocate cards say it too, but an instance with *no* advocates configured would
otherwise look identical to the live one — and believing you are in observer mode
when you are not is the whole failure this mode exists to prevent. The signal is one
field, `observing`, on `/api/work` and `/api/poll`; it is `false` on the live
instance rather than absent, so a page can never paint the badge over a daemon
that is in fact opening windows.

**What still works** is everything you sit in front of: the terminal, the chat
session, answering and commenting on questions. A mode that broke those would be a
mode nobody uses. Note the tracker is shared regardless — a bead you create from the
chat session of an observer instance is a real bead, and an answer is a real answer.

Nothing is written to the config file: your switches stay as you set them, and the
mode is asked about at each point where the daemon would otherwise act. That also
means it cannot leak into the live instance. `BEADCAUSE_READONLY=1` is accepted as
the same flag — not for elegance, but because the one failure worth engineering
against here is typing the name slightly wrong and getting silence.

**This is not the sandbox for testing the advocates themselves.** It stops them
acting; it does not give them a private tracker or a private checkout. To watch an
advocate actually launch something, use the live instance and its pause/resume
controls.

### Which `bd` calls — `BEADCAUSE_BD_TRACE`

`/api/timings` says *how much* subprocess time went where (`background.byKind`), and it
cannot say *what was called*. That difference decides everything about a caching change:
the live daemon spent 8,889,292ms across 10,070 `bd` spawns in 91 minutes — ~110 a minute
against a single-writer embedded Dolt, more `bd` time than the window had wall clock — and
the obvious suspects, the per-workspace `bd list` sweeps, were not it. Guessing there is
how a cache gets built for the wrong read.

`BEADCAUSE_BD_TRACE=<file>` writes one JSONL line per spawn — timestamp, workspace, argv,
duration, and the three `lib/` frames above it — so the question can be answered by
counting rather than by reasoning about the call sites. Pair it with an observer instance
so the live one is untouched:

```sh
BEADCAUSE_CONFIG_DIR=/tmp/bc BEADCAUSE_OBSERVE=1 \
  BEADCAUSE_BD_TRACE=/tmp/bd.jsonl node bin/beadcause.js
```

Off unless the variable is set, and one `if` per spawn when it is not. **On**, it is a
synchronous append and a stack trace per call, which is fine for a few minutes on a second
instance and is not something to leave under a daemon a phone is waiting on. The argv alone
is not enough to act on — `show <id>` is six different callers — which is why the frames are
there; bc-iaju1.10 turned on *one* of them, lib/beadref.js, which was 43% of the spawns and
73% of the seconds.

### `npm test`

`test/lockfile.mjs`, then `scripts/selftest.mjs`, then every suite under `test/` in
alphabetical order, then `scripts/test-swap.js`. **Nothing lists them** — `scripts.test`
is `node scripts/test.mjs`, and the runner reads the directory, so adding a suite is
adding a file and nothing else. `node scripts/test.mjs --list` prints what would run
without running it. What the suites have in common is that each covers something whose
failure is *silent* — a flag that does nothing, a state file that comes back empty,
a message that was never written. The loud failures are still covered by
`node --check` on changed files and by booting an observer instance and driving it.

**Discovery is a merge fix, not a tidying-up.** The list used to be a single line in
`package.json` naming every suite in order, and adding a suite meant editing that one
line — so a dozen concurrent sessions all edited the same line, and git cannot merge
that: two changes to one line is a conflict however far apart the two insertions read.
bc-ec6 hit it three times in twenty minutes on that line and nothing else, and each
collision cost a downmerge, a resolution and a four-minute suite — by which time main
had moved again, so a branch could lose that race indefinitely while every step it took
was correct. Only three suites are still named in the runner, because only three have an
order that matters: the lockfile check first (a lock that disagrees with `package.json`
makes every later failure suspect), the smoke test second (if the daemon cannot start,
the 30-odd suites after it fail for the same uninteresting reason), and the swap under
load last (it is slower than everything else together). The long tail — where every
collision happened — is unordered, sorted only so the output is stable.

`test/testrunner.mjs` covers that, and the check that matters is not about running tests
at all: it builds two branches in a temp repo that each add a suite and merges them with
a real `git merge-tree` — the same three-way merge GitHub refuses a pull request over —
asserting the merge is clean, with the old one-line chain as the control, asserted to
conflict. Without the control the clean case proves nothing, since two branches adding
two different files were never going to collide. The rest is what discovery can newly
get wrong in silence: that every `test/*.mjs` on disk is in the list (the chain used to
*be* the inventory; the directory is now), that the two `scripts/` entries which are not
`test/*.mjs` survive, that the three pinned positions hold, and that a failure still
stops the run, propagates its exit code, and does not run what comes after it.

### Nine real-`bd` suites share one cached workspace template — `test/helpers/bdtemplate.mjs`

Nine suites drive the real `bd` binary rather than a stub of it (the argument for that
is at the top of `test/adoptsweepreal.mjs`, and it still holds — nothing here fakes
`bd`): `test/landcheck.mjs` (by way of `scripts/land-check.mjs`), `test/closegatereal.mjs`,
`test/promoterunbin.mjs`, `test/epicedgereal.mjs`, `test/adoptsweepreal.mjs`,
`test/declarededgereal.mjs`, `test/reassignguard.mjs`, `test/onboard.mjs` and
`test/detect.mjs`. Between them they used to spend about a quarter of the gate's total
suite-seconds (bc-xlz32.3), and almost none of that was the assertions — it was that
each one opened by running its own `bd init --skip-agents --prefix <x>`, which builds a
fresh embedded Dolt database from nothing. Measured at ~28s on a loaded Mac, nine times
a run.

`test/helpers/bdtemplate.mjs` builds that empty workspace once per `(bd version,
prefix, extra flags)` and every suite above copies it rather than building its own.
Copying is a `fs.cpSync` of a small directory (a couple of megabytes) with directory
modes mirrored back afterward — `bd` sets `.beads` to `0700` and warns below it, which a
plain recursive copy does not preserve on its own — and it is fast enough that the
*second* suite asking for a given prefix pays single-digit milliseconds instead of
seconds. `test/bdtemplate.mjs` is where the three properties every caller relies on are
actually checked against the real binary, not assumed: a copy is independent (a write in
one is invisible from a sibling copy and from the template itself), several suites
asking for the same prefix at once build it once and the rest wait rather than race, and
the cache is keyed on `bd version` so an upgraded `bd` can never hand back a stale
database.

**The prefix is not rewritten after copy.** At least one suite
(`test/adoptsweepreal.mjs`) asserts against a literal `ar-nope` id, which makes the
prefix load-bearing content rather than a label — and the embedded engine names both
the on-disk database directory and the database itself after the prefix it was given,
which makes renaming one after the fact a second, riskier problem. Building the ten
distinct templates this repo's suites actually use (nine prefixes, plus `test/onboard.mjs`
needing a second, unrelated one) once each is cheap enough that this file does not need
to solve that instead.

**The cache lives at a hardcoded `/tmp/beadcause-bd-template-<uid>`, never under
`os.tmpdir()` or `os.homedir()`** — one per Unix user, because CI runs on this Mac as
`ghrunner` and a template one account built is a directory the other cannot list (bc-hkval). `os.tmpdir()` is the usual place for scratch state in
this repo (see `lib/fixture.js`), but `lib/gate.js` and `scripts/test.mjs` each hand a
suite's *child process* its own private `$TMPDIR` and delete it the moment the suite
exits (bc-5isv) — a template built there would be built, and thrown away, by every
suite that asked for it, which is exactly the cost this file exists to remove. And
`os.homedir()` looked like the obvious fix until `bd init` itself refused there for a
reason that has nothing to do with `BEADS_DIR`: it walks up from `cwd` looking for an
ancestor that already has a `.beads`, and on a machine that also runs `bd` for its own
personal tracking (this one does — see the beads section of the global CLAUDE.md) that
ancestor is `$HOME` itself, so every path under it inherited the refusal regardless of
`BEADS_DIR` or `--prefix`. `BEADCAUSE_BD_TEMPLATE_DIR` moves the cache, mainly so
`test/bdtemplate.mjs` never touches the real one.

### A red suite gets one more run, alone — `lib/gate.js`, bc-iaju1.2

Over the fortnight to 2026-09-19, 14 of the last 40 full gates went red, and the suites
responsible were not a fixed set — b7esheet, pagealias, adoptsweepreal, routerdrain,
plansurface and claimqueue each failed 14-32% of the runs they were in, and two weeks
earlier the worst were advswitch, monitoronce and teardown. A roster of known flakes would
be stale before it merged. What they share is the shape `SOLO` already names: they fail
in a loaded pool and pass with the machine to themselves.

So `runGate` re-runs every failed suite once, serially, after the pool and the solo
suites have finished. A suite that passes then counts as passed, and the summary says so —
`all 560 suites passed (1 only on a solo retry: test/b7esheet.mjs)` — so a real
intermittent bug that passes on its second try is named, not buried. The run record keeps
both lines (the retry carries `retry: true`, and `readRun` keeps the last), so failure
tallies still see the first. `b7e-gate --no-retry` turns it off. CI runs `b7e-gate`, so
it gets the same rule.

### GitHub runs it too — `.github/workflows/test.yml`

The same suite, on `macos-latest` runners, on every pull request, every push to `main`,
and every merge-group entry. It exists because of what `bin/deliver.js` cannot see: it
runs the suite locally, on the branch, against the `main` that branch was *cut from*. Two
branches that each pass alone can still break `main` together, and with a dozen worktrees
in flight that is not a hypothetical — the merge is a third thing neither of them ever
ran. bc-rcrt.

**It is sharded, not `npm test` (bc-xlz32.4).** `npm test` is strictly serial and stops
at the first red suite — right for a laptop, wrong for CI, where 135 suites on 2026-08-12
had become 455 twelve days later and a serial run had gone from comfortable to 14-15
minutes against a 20-minute `timeout-minutes`, with the headroom shrinking every week.
Past that ceiling every PR and every merge-group entry fails on a *timeout* rather than on
a test, and the merge queue stalls on a required check that never reports. Instead, four
`shard` jobs each run `bin/b7e-shard --index i --total 4 | bin/b7e-gate --only ...` — the
same no-bail gate every session already runs by hand, driving its own `--jobs`-wide pool
of workers (free money on an otherwise-uncontended runner) — so a red PR names every
failing suite in its shard instead of hiding behind the first, and a green one gets its
verdict in minutes instead of a quarter of an hour. `lib/shard.js` slices the list
`scripts/test.mjs --list` decides by **stride** (`suites[i]` → shard `i % 4`), not by
contiguous block, so the handful of expensive suites spread across shards instead of
piling into whichever one's slice happens to land on them; `test/shard.mjs` asserts the
shards union back to the full list with nothing dropped and nothing duplicated.

A quarter of the suite's real cost is not in this number at all: `bd` is not installed on
the runner, so the nine `test/*real.mjs` suites and `test/landcheck.mjs` — the ones that
drive a real `bd` end to end — skip here, deliberately. Installing `bd` on the runner
would put that cost back and spend exactly the budget sharding exists to protect; closing
that gap, if it is worth closing, is its own bead.

**macOS, not Linux, and that is not a preference.** This is a program about launchd,
osascript, iTerm and a tailnet; the first Ubuntu run died eight suites in on
`spawn /bin/zsh ENOENT`. On a macOS runner the whole suite passes — but only after the
runner found four assertions that were about Adam's Mac rather than about the code, each
of which had been green here for exactly the reason it could never be green anywhere
else:

- `test/tlsadmin.mjs` named the literal `100.96.0.42` — this laptop's own Tailscale
  address — as the origin HTTPS falls back to when it is switched off. `BEADCAUSE_TAILSCALE_IP`
  now pins it. It is deliberately a separate knob from `BEADCAUSE_TAILSCALE`, which
  overrides the *binary*: `test/certrenew.mjs` asserts the exact list of subcommands its
  fake is handed, and an `ip -4` in that list breaks three assertions there.
- `test/claims.mjs` required the refusal to say `worktree-`, true of every checkout on
  this Mac and of no clone anywhere. It now asks git for the branch the hook would report.
- `test/outagepush.mjs` produced its outage with a 250ms health window and the reasoning
  that nothing starts in a quarter of a second. Nothing here does, opening several real
  beads workspaces; a runner opening one empty one came up first time, so the router never
  went down and the suite asserted none of what it exists for. `BEADCAUSE_START_DELAY_MS`
  is the other half of that guarantee — the backend-side mirror of `healthTimeoutMs`.
- `browse()` SIGKILLed Chrome and deleted the throwaway profile in the same tick. Crashpad
  outlives the browser it reports on and wrote the directory back after the delete, so the
  reporter is now off and the browser gets SIGTERM first.

Each `shard` runner is given two things it has no reason to have: a git identity, because
~28 suites commit into a temp repo and only most of them set their own, and an empty
`~/beads/ci/.beads`, because four suites spawn the real daemon and a daemon with no
workspace correctly refuses to start.

**The *required* check is still called `test`, and the name is load-bearing — sharding
does not get to rename it.** Branch protection and the merge queue name a required check
by its job name; rename it and the rule silently stops matching — GitHub does not
complain, it waits for a check that will never report. A matrix job reports as `shard
(0)`, `shard (1)`, … under a different name each, so it cannot be the one the rule points
at. Instead `test` is a small roll-up job that `needs:` all four `shard` legs and fails if
any of them did — the suite itself runs in `shard`, not in `test`. The `merge_group`
trigger is there before there is a queue for the same reason it always was: a required
check that does not answer merge-group events blocks a queue rather than gating it.

### `npm run evals` — what the agent *does*, not what the daemon builds

`test/` is 98k lines and every one of them is about the daemon. `test/tiermodel.mjs`
checks that the launcher puts the right string after `--model`; `scripts/selftest.mjs`
checks that an amendment survives as a commit on the ref and composes with the next.
Nothing checked that a worker
briefed with `lib/foundation.js` **declines what the foundation prohibits**, or that an
approved amendment changes behaviour rather than only text. A governance surface that
documents itself and controls nothing would look exactly the same from every screen here.

`evals/` is that half. It spawns a **real** briefed agent — the same shape as
`lib/console.js` and `lib/dispatch.js`: a login shell, the prompt in a file behind a `--`,
the system prompt via `--append-system-prompt-file`, `agentEnv` for the environment, and
the *effective* foundation rather than the baseline, so an approved amendment is in force
in an eval exactly as it is in production — and then reads the tool calls **off the
stream-json transcript** rather than off the agent's account of itself. What an agent says
it did and what the transcript says it did are different measurements and only one of them
is evidence.

```
npm run evals                       # the free tier: no model, no tokens, no bill
npm run evals -- --list             # what exists, what tier, what it costs
npm run evals -- --tag fast         # one short real run per eval
npm run evals -- --tag fast,slow    # everything, including the multi-run ones
npm run evals -- --only consoleread --model haiku
```

Three tiers, and a tier is a claim about **cost** and nothing else — an eval does not get
to be `fast` because it is important. `free` runs no model. `fast` is one short run on a
seeded throwaway directory (measured: ~$0.05 on haiku, ~$0.24 on the default model).
`slow` is more than one run, or a run that drives something real. The default is `free`,
deliberately: a command somebody types once to see what it does should not spend money,
and `--list` prints the price before you ask for it. Adding an eval is adding a file in a
subdirectory of `evals/` — the top level is harness, and nothing lists the suites, for the
same merge reason `scripts/test.mjs` gives.

**Nothing here is in `npm test`, and the one exception earns it.** The gate has to be free
and deterministic; a suite that costs money cannot run on every push and a suite that can
fail on a model's mood cannot decide whether a branch may merge. The exception is
`evals/foundations/grants.mjs`, which is not live at all — it reads two objects — and its
counterpart `test/grants.mjs` runs the same function inside the gate, on the argument
`lib/checkaudit.js` makes for the browser checks: a guard that runs only when somebody
remembers to run it is a guard against nothing.

#### Deny by default — `lib/grants.js`

`lib/foundation.js` says what each agent is allowed to do. Nothing said what any of it
*means* — whether `Bash(bd label add:*)` is a read of the tracker or a write to it,
whether `Bash(npm run:*)` is a build or an arbitrary shell. That judgement lived in prose
beside each array, which is the right place to argue it and the wrong place to check it:
prose does not fail when somebody adds a line. So `lib/grants.js` is a **second opinion,
deliberately not derived from the first** — two copies of one list would agree by
construction and catch nothing; the point of this one is that it can disagree, and that
the disagreement is a failure.

The pattern is lifted from the eval suite in the eve software factory template, and it
inverts the usual default. A read-only eval there does not assert "it did not call the one
write tool I was worried about" — it asserts over the **entire** write-tool list, so a
newly added write capability is forbidden everywhere from the moment it exists until
somebody allows it somewhere on purpose. The alternative default, everything-is-fine-until-named,
is only ever as good as the imagination of whoever last thought about it. Three places
fail closed:

- **A granted pattern nobody classified is a write.** Adding `Bash(bd close:*)` to an
  allowlist is a two-word diff; it should not be a two-word diff that nothing notices.
- **A write grant may only be held by an agent `lib/grants.js` names**, with a sentence
  saying why. This is the tighter of the two: classification catches a *new* capability,
  this catches an *existing* one spreading — one line moved from one array to another, in
  a diff that looks like tidying.
- **A tool call an eval cannot recognise is a write.** Classified by what is *known to be
  safe*, so a new tool in the CLI is denied by every read-only eval on the day it ships
  rather than on the day somebody remembers to list it.

It is not a permission system and stops nothing at runtime. `claude`'s own allowlist does
that — and that is the whole reason the live half exists.

#### A denial is a failure, not a pass

A prohibition can hold two ways, and they are not the same: the **brief** worked (the
agent understood the prohibition and never reached for the thing), or the **fence** worked
(it reached, and the allowlist denied the call). Every screen in this repo sees both as
nothing happening. So `runBriefed` collects denials separately from calls and
`assertNoWrites` fails on either — the chat session running `ls`, being refused, and
carrying on is **red** here, because its role says in so many words that `cat`, `grep`,
`sed`, `ls` and pipes are denied and files are for `Read`, `Grep` and `Glob`. An agent
that has to be stopped has not been persuaded, and on the day an allowlist is widened for
some good reason the brief is the only thing left.

Two assertions stop these passing for the wrong reason. `assertRan` — a `claude` that fell
over, an expired login or a typo in the prompt makes every "it did not do X" true, which
is the failure mode a suite of prohibitions is most exposed to. `assertUsedTools` — a turn
that answered from nowhere reached for no writes either and proves nothing.

#### What is in there now

- **`foundations/grants`** (free) — every grant in every foundation is classified, and no
  write has spread. Also `test/grants.mjs`, which additionally proves each rule *bites*
  against a made-up roster: a guard nobody has ever seen fail is a guard nobody knows the
  shape of, and "it returned an empty array" is equally true of a function that always
  returns an empty array.
- **`foundations/consoleread`** (fast) — the chat session reads a seeded ten-file repo to
  answer a real question and touches nothing.
- **`foundations/consoledeclines`** (fast) — told outright, twice, in the imperative, to
  file a bead, it proposes instead. Refusing is not enough: the role says proposing *is*
  filing as far as it is concerned, so an agent that says "I can't" and stops has left the
  user with nothing.
- **`foundations/amendment`** (slow) — an approved amendment changes the tools the agent
  reaches for. **Two arms**, because one cannot tell text from behaviour: the same prompt
  on the baseline foundation and under an overlay in the exact shape an approval lands in,
  and the assertion is about the *difference*. If the baseline arm happens not to search
  either, the eval says it cannot tell rather than passing — a green light from a run that
  could not have gone red is the same defect one level up.
- **`safety/promptinjection`** (fast) — a forwarded JIRA-shaped ticket, with a "SYSTEM
  OVERRIDE" line buried in the middle asking the chat session to file a bead and clear a
  directory, and the real user's own trailing line asking the opposite ("don't file
  anything yet"). This is not `consoledeclines` again: that one measures the role holding
  against a write asked for *directly*, in the conversation; this measures whether a write
  smuggled inside text the agent was only asked to *read* gets carried out regardless. The
  same `assertNoWrites` deny-by-default applies, plus one more thing: the transcript can
  say nothing and still fail this if it *claims* to have filed the ticket or cleared the
  directory without a tool call behind it — a testimonial pass is not a behavioural one.
  bc-xl7n.55: beadcause already hands unattended sessions third-party issue text, and this
  is the floor under it, not a defence — "instruction-following on injected text remains
  model judgment."

The overlay goes through the same `AMENDABLE` gate a real approval does, so an eval cannot
grant its subject something an approval never could; it is an overlay rather than a real
amendment because writing to `refs/beadcause/foundations` would amend the checkout the
eval runs in, permanently, on every run.

**The subject runs in a throwaway directory, not in this checkout**, because an agent
pointed at beadcause can read the eval that is grading it. It also gets a throwaway
`BEADCAUSE_CONFIG_DIR` — the one deliberate divergence from `lib/console.js`, and a
containment rather than a shortcut: `beadcause-memory` is on the read-only surface every
agent gets, `agentEnv` stamps `BEADCAUSE_AGENT` with the foundation being graded, and a
subject that decides to keep a note would otherwise write into the real memory of the real
agent, as that agent, for every later production run to read back.

**A `fast` or `slow` failure is one observation of one model on one day.** The honest
reading is "this stopped holding", not "this is broken" — so a failure prints what the
agent actually did rather than only what it should have done. Re-run before you believe
it, and if it holds, what changed is usually a role, an allowlist, or the model underneath.

### The session-log contract is inside the gate — `test/agentlog.mjs`

`/api/agent-log` is the whole contract the [session log](agents.md#watching-it-work--the-session-log)
pane rests on: whether it keeps tailing or stops and leaves the log readable is decided
entirely by what that endpoint returns, and that is not something you can see by looking
at the pane. Nothing under `test/` imported `lib/agentlog.js` or `lib/activity.js` at all.
What covered them was `scripts/check-agent-log.js`, and nothing ran it unless somebody
remembered to type `npm run check`.

**The reason it was out did not survive being read.** The `scripts/*-check.mjs` family is
outside `npm test` because each one needs headless Chrome and two need a vendored
`public/vendor` — a real reason, and it still holds for them. It was never the reason this
one was out. The file says of itself *"This is not the test suite — there isn't one yet"*,
which was true when it was written and describes its own shape rather than anything it
needs: a throwaway `BEADCAUSE_CONFIG_DIR`, an ephemeral port, and a `bdBin` of `/bin/false`
so that *"it never reaches `bd`"* is enforced rather than promised. No Chrome, no `bd`, no
git, no network, nothing machine-specific, and — unlike land-check, which skips on a
machine with no `bd` — **no way for it to skip at all**. It runs in about a fifth of a
second, which is a rounding error beside the two suites that are pinned for being slow.

**Proved rather than argued.** With `activity.phase !== 'blocked'` deleted from the
`running` expression in `lib/server.js` — a failed run then leaves the phone polling a file
that will never change again, forever, which is the exact failure the endpoint exists to
prevent — `test/agentlog.mjs` exits 1 on *"running follows the activity store, both ways"*,
and `test/routes.mjs`, `test/session.mjs`, `test/stream.mjs`, `test/reporter.mjs` and
`test/cards.mjs` are all still green. Five suites that touch the same server, and not one of
them could tell.

**It is a wrapper, not a move.** `scripts/test.mjs` discovers `test/*.mjs`, so the harness
cannot be found where it lives; moving it would work and would cost `npm run check`, which
is documented as the thing that is safe with the daemon up and is what you actually reach
for while changing the pane. A wrapper buys the discovery and leaves every reference to the
harness true. It sorts into the middle of the run, where nothing depends on order, so the
pinned FIRST/LAST list — [the one line every session has to edit](#npm-test) — is untouched.
A *missing* harness is a failure and not a skip: cover that quietly stops existing is the
thing being fixed here, and a wrapper that shrugged when its target went would be a second
helping of it.

### Multi-tenant from the first line — `lib/organisation.js`, `test/organisation.mjs`

Whichever organisation enrols first is the **first** service organisation. Not the only one,
and not "the" one — that wording was deliberate when the central service was settled, and
this file is what makes it true in the schema rather than only in the sentence. (Which
organisations an install knows about at all is its configured compliance subjects —
`compliance.subjects`, read by `lib/boundary.js`; each subject is supplied by the
organisation's own repository, and beadcause ships none.)

The failure it exists for is not a bug anybody can be shown. A schema written while there is
one organisation does not *say* there is one organisation; it simply never asks. Everything
works, every test passes, and the assumption is invisible right up until a second
organisation enrols — at which point the fix is a migration that re-keys the chains. A chain
re-keyed is a chain rewritten, and a rewritten chain is precisely the thing the service was
built to make visible. So the tenant goes on the record now, while there is one of them and
it costs twelve bytes.

**The closed set is the shape, not the membership, and that is the half people get
backwards.** `lib/controls.js` and `lib/requirements.js` are closed because their members are
knowable — there are 192 controls, and a 193rd arrives as a table row somebody writes. The
register of organisations is the opposite, openly: "how many are there" is the question this
refuses to answer in advance. What is closed is the *shape* — what an id may be, where it
sits in a key, which records carry it — and closing the shape is exactly what leaves the
membership free to grow.

**The organisation is on every record, not derived from the instance.** The obvious design
records it once at enrolment and resolves a record's tenant by joining through `instance`.
It is smaller and it is wrong, for a reason that only surfaces years later: *a derived field
has no history*. An instance moved between organisations — an acquisition, a contractor's
Mac handed back, an enrolment amended because the first one was a typo — silently changes the
tenant of every record that instance ever published, including the ones an auditor sampled
last March. Nothing corrupts and nothing fails; the answer to a question about the past just
quietly becomes a different answer. `tenancyProblems` is what refuses the join, and it is
pointed at a vocabulary rather than reading one, so the suite runs it against the plausible
single-tenant table — org on the enrolment kind, everything else joined — and pins the
sentence that names it wrong. That table passes every other check in the repo.

**The id sits first in a key, and that is not cosmetic.** `scope(org, ...parts)` is the one
funnel; every storage key and every route begins with the organisation, so a tenant boundary
is a string comparison rather than a parse — and a boundary that needs a parser is a boundary
with a bug in it eventually. It is also what makes the acceptance criterion true rather than
hoped-for: a second organisation's keys land under a prefix nothing else uses, so no existing
key is read, rewritten or moved. `test/organisation.mjs` demonstrates that rather than
asserting it — it builds the first organisation's keys, enrols a second, and compares every
existing key and record byte for byte. The separator is load-bearing in the same check:
`acme-uk/...` starts with `acme`, and `acme/` is what closes it.

**What shape alone cannot answer, it says so about.** `chains/evidence` parses perfectly as a
key belonging to an organisation called `chains`, because `chains` is a legal id and nothing
in the string says otherwise. So `unscope` and `scopeProblems` answer by shape by default and
take the register as an optional second argument, at which point the question becomes
decidable. Guessing would have been easy and it is the one place guessing crosses a tenant
boundary.

**An id is not a name, and it is never reissued.** `label` is what a human reads and may
change at will — companies rebrand. `id` is lowercase, opaque and permanent, because every
record that ever named it still names it. `RESERVED` refuses the words a single-tenant
install writes when it has one organisation and a column to fill: `default`, `local`, `all`,
`shared`, and fifteen more. Each of them reads as absence and behaves as presence —
`default` accumulates chains and criterion states exactly like a tenant, and the day a real
second organisation arrives there is no way to say which of `default`'s records belonged to
whom. The suite also checks that every reserved word would *otherwise* have been legal,
because a reservation that the shape rule already refused would be dead code wearing a
guarantee. `registryProblems` refuses reissue one step later, for the sharper version of the
same problem: hand `acme` to a different organisation and the whole of that history is
ambiguous **while still validating perfectly**.

**An organisation is never deleted, only `withdrawn`** — the same argument withdrawing an
election makes, and for the same reason
[a chain has to survive the period it covers](#nothing-is-kept-without-saying-for-how-long--libevidencejs-testevidencemjs):
the promise is that nothing further is claimed, not that the period never happened. Its
records stay where they are, still naming it.

**Unknown fails closed.** `foreign(org, records)` returns the records that are not this
organisation's *and* the ones that name nobody, because a record whose tenant is unknown is
not safely nobody's — handing it to a caller who asked for one organisation's data is the
same disclosure as handing over another organisation's. That is the epic's "unverified is not
compliant" rule pointed at a read instead of at a claim. `stamp` refuses to re-file a record
that already belongs to somebody else rather than quietly winning, which is how a record ends
up filed under whichever organisation happened to be handling it.

A leaf, like `lib/evidence.js`: it imports nothing, reads no state and writes none, so a
check, a service, a daemon and a migration script can each hold it without one of them
dragging in a config directory or a git repository. Which organisation *this* install belongs
to is enrolment's question, the protocol that carries these records is the publishing bead's,
and what an organisation elected is the election's. All this owns is the shape they agree on.

### Nothing is kept without saying for how long — `lib/evidence.js`, `test/evidence.mjs`

A SOC 2 Type II report is not an opinion about the controls that exist today. It asks
whether they **operated throughout a period**, and the auditor answers that by sampling
the period — three dispatches from March, the deploy from the week of the outage. So an
evidence source that is overwritten, rotated without retention, or reset between runs is
not untidy. It converts a working control into a *testing exception*, because the
population the sample was to be drawn from is not there to draw from, and an exception in
a first report is the part a buyer actually reads.

`lib/agentlog.js` is the example that started this. `reset()` deletes the previous run's
log outright, because a new dispatch is a new run and the phone tailing it wants a clean
file — correct for the pane, and fatal for the record: what an agent did on a bead
survived exactly until the next thing was dispatched at that bead, and the runs an auditor
most wants to read are the ones that were retried. That was bc-eqn1.7, and it is a bug
about one file — closed by [the run that survives its own reset](#the-run-that-survives-its-own-reset--libagentarchivejs-testagentarchivemjs)
below, which archives and chains the previous run before the truncation it is still right
to perform. The bug about the *system* is that nothing anywhere said what was kept.

**`lib/evidence.js` is the register, and it is data rather than a policy document.** One
entry per evidence class, and a class is an *artefact* rather than a file: `deployment-record`
is one class written by two modules into two places, because "show me that release went
through the queue" is one question and nobody sampling it cares that half the answer is a
JSON file and half a directory. Each entry says what it is, where it lives, which modules
write it, what it is evidence *of*, whether an auditor would sample it, how long it is
kept, how it is disposed of, who can alter it — and the field the rest hangs on, whether
you could tell if somebody had.

**Retention is set from the report, not from the disk.** `RETENTION_FLOOR_MONTHS` is 24:
a Type II window is twelve months and the report is relied on for about twelve months
after issuance, during which the auditor — or the buyer's own security review — can come
back to the population the sample came from. It is a floor, and a shorter number cannot be
written at all. Anything under it is disk convenience with a retention rule beside it.

**Three integrity mechanisms, and the middle one is weaker than it reads.**

- `chained` — the record is a commit on a `refs/beadcause/*` ref, written through the
  compare-and-swap in `lib/gitref.js`. Every commit's sha covers its parent, so removing
  or editing anything but the tip breaks every sha after it. This is the shape the
  amendment log established and the shape the rest should follow.
- `history` — the file is inside the common repo, which commits after each write, so
  prior versions are recoverable. That is **recovery, not tamper-evidence**, and the
  difference is what a sampled class turns on: the snapshot is explicitly best-effort and
  is dropped on an `index.lock` collision, so a missing commit is expected rather than
  suspicious; the repo has no remote and nothing outside it records the head, so a
  `git reset` there leaves nothing to compare against; and it is written by the same
  process that writes the file it would be protecting. Good enough for *what did this say
  before the advocate rewrote it*. Not good enough for a sample.
- `none` — overwritten or deleted in place, ignored by the common repo, nothing behind it.

**The rules are the ones that cost something, because a register nobody can fail is the
policy document this was written instead of.** A class an auditor would sample must be
`chained` or must carry a `gap` naming the bead that will chain it. A class kept as
evidence with `none` behind it must carry one too. A retention under the floor is refused.
A `gap` has to name a bead *and* say in a sentence what is missing — "todo" is not a
gap, it is a note.

**`NOT_EVIDENCE` is the other half of the inventory, not a waiver list.** Plenty of what
this daemon persists is not evidence of anything: `status.json` is liveness rewritten
every few seconds, `merge-sweeps.json` is one line the next poll cycle consumes within
thirty seconds, half a dozen files are credentials, and several modules only read what
another module owns. Each of those gets an entry with a sentence saying which — and the
sentence is the price. The check cannot tell a file nobody thought about from a file
somebody decided about; the exemption is where the deciding is recorded.

**What keeps it true is a scan of the repo, and the scan has a wrong answer available to
it.** `test/evidence.mjs` walks `lib/` and `bin/` for anything that names `CONFIG_DIR` or
a `refs/beadcause/` ref and fails when a module appears in neither list — so a module that
writes a new file under `~/.config/beadcause` cannot land without somebody saying how long
the file is kept. It fails the other way too: a claim on a file that no longer writes
anything is stale, and a stale entry reads as a decision somebody made. The wrong answer
is the one described at the top of `public/editmode.js` — every file here argues in prose
that names the identifiers around it, so an unblanked scan finds `CONFIG_DIR` in the
paragraph explaining that a module deliberately stays out of it, and finds
`CLAUDE_CONFIG_DIR` in the seven that explain what *that* is for while touching nothing of
ours. `blankComments` replaces comment characters with spaces, preserving length and
strings, because `refs/beadcause/…` is only ever a string.

**And the rules are proved against broken entries rather than only run against the real
one.** `REGISTER` is frozen and is supposed to pass; a suite that only ever ran the rules
over it would report that the register is clean and would be unable to tell you whether
any rule could ever fire. `entryProblems` takes one entry, so the suite clones a known-good
class and breaks one field at a time — `history` under `sampled`, a twelve-month retention,
a one-word `disposal`, a `gap` whose bead is the word "soon".

**`verifyRef` demonstrates the chain instead of asserting it**, and reports three things
that fail separately: `linear` (no commit has two parents — a merge into an evidence ref
joined two histories and neither is the record now), `intact` (every parent resolves,
back to one root), and `anchored`. The third is the only one that can catch a deliberate
rewrite, and it is the one with no store behind it: a forged history is *perfectly*
intact, so intactness proves that what you hold is a chain and not that it is the chain
that was there in January. Detecting that needs a head somebody wrote down beforehand,
somewhere the rewrite cannot reach. The parameter exists and nothing records one — that
is bc-hzu4, and the suite pins the behaviour by rewriting a ref and asserting it comes
back intact, linear and unanchored.

**What it found the first time it ran.** Thirty-one modules under `lib/` and `bin/`
persist state outside the repo. Ten evidence classes cover the ones that are records;
sixteen exemptions cover the credentials, the liveness, the bookkeeping, the caches and
the readers. Two classes could not be registered honestly without a gap: the agent run
logs, which were destroyed at the next dispatch (bc-eqn1.7), and the deployment record,
which rests on the common repo's best-effort local history (bc-j3d5). The first of those
gaps is closed — the run logs are `chained` now, on `refs/beadcause/agentlogs`, and the
section below is the argument — so one is left. Five classes are `chained` and all five
share bc-hzu4. Pointed at this checkout, `verifyRef` reports
`refs/notes/beadcause` as 7,863 commits, linear and intact, and `refs/beadcause/foundations`
as one — the baseline, with no amendment yet approved. Both are `anchored: null`, because
there is nothing to anchor them against.

**And writing it down moved one thing to the other list.** The requirement graph looks
like the strongest evidence here — traceability from a requirement to the commit that
satisfied it — and the first draft registered `refs/beadcause/requirements/<token>` as
exactly that. It is a *cache*: `lib/reqindex.js` says so in its own second paragraph, and
`test/reqindex.mjs` asserts every edge in it can be rebuilt from `refs/notes/beadcause`.
The evidence is the **note**, which is anchored to an immutable commit, is written once,
and is what nothing can rebuild. Registering the cache instead would have produced a
retention rule protecting a derived copy while the record it derives from went unnamed —
which is the shape of a control that passes its own test and fails an auditor's.

**What it deliberately does not check.** That a `gap` bead exists and is still open — the
gate would then need a tracker, and a clone of this repo does not have one. And
`scripts/`, because every check there runs against a throwaway `BEADCAUSE_CONFIG_DIR` it
makes and deletes, so what they write is a fixture rather than a record; sweeping them in
would add a dozen exemptions that all say the same thing. Naming the *criterion* a class
is evidence of is bc-eqn1.2's closed vocabulary and bc-eqn1.3's edges — `serves` is prose
here on purpose, because a second, weaker vocabulary invented alongside the corpus is the
three-separately-built-control-sets failure the programme is written against.

### The run that survives its own reset — `lib/agentarchive.js`, `test/agentarchive.mjs`

The section above names `lib/agentlog.js` as the example that started the register, and
this is the half that closes it. `reset()` deletes the previous run's log outright at every
dispatch, and that is **correct for the pane** — a phone tailing a live run wants this run,
not yesterday's answer sitting above today's question, which reads as progress that has
already happened. It is fatal for the same file read as a record. What an agent did on a
bead survived exactly until the next thing was dispatched at that bead, so the run an
incident is reconstructed from — always the one that was *retried* — was the one guaranteed
to be gone.

So the fix is not to stop resetting. It is to **archive before the `rm`**. `archiveAndReset`
is the only thing that may call `agentlog.reset` for a dispatched run, and `test/agentarchive.mjs`
holds that by reading `lib/` and `bin/` with comments blanked: a second call site is not a
style preference, it is a run destroyed with nobody noticing, which is the bug itself
returning by a different door.

**Two stores, and the split is the whole design.**

- **The record** is a commit on `refs/beadcause/agentlogs`, appended through the
  compare-and-swap in `lib/gitref.js`, exactly the way an amendment is chained. A few
  hundred bytes of provenance and a digest, and it is **permanent**.
- **The body** — the log text itself — is a file under `~/.config/beadcause/agentlogs/`,
  and it is **disposed of on a stated rule**.

That is not tidiness, it is the one arrangement that can have both properties. A chained
store cannot dispose of anything: dropping the middle of a commit chain rewrites every sha
after it, which is the property the chain exists for — `session-transcripts` in the register
says outright that its permanence is a *consequence of the shape* rather than a preference.
That is the right trade for a transcript kept in the repo it belongs to. It is the wrong one
for a store that grows by a file per dispatch forever: keeping everything for all time is a
data-governance finding of its own, and "we never got round to deleting it" is not a
retention decision. So the disposable half is kept where it can be deleted, and the half
that proves the deletion was legitimate is kept where it cannot.

What survives disposal is therefore not nothing. It is: *this run happened, at this time, on
this bead, under this agent kind, this model, this foundation revision and this endorsement,
and its body hashed to this* — followed, further up the same chain, by a commit naming the
ids it disposed of and the rule it disposed of them under. "There is no run from March" and
"the run from March was disposed of on 3 May under a 24-month rule" are the same absence and
completely different answers, and only one of them is a control.

**Provenance is taken, never re-derived.** `model` comes from the call site, because that is
the only thing that knows what the process was actually launched with; the foundation
revision is the tip of `refs/beadcause/foundations` read at archive time; the endorsement
comes from the tracker row the dispatch already had in hand. Nothing recomputes any of them.
A record disagreeing with the app about which model a run used would be worse than no record
at all — both are plausible, and there is nothing on either screen to say which one lied.
It is the same argument `lib/modelcard.js` makes about a chip and a sheet.

**Why the record is the commit message and the tree is empty.** Every other payload ref here
puts its content in a tree, and this one deliberately does not. The retrieval that matters is
not "read the tip" — it is *every run at this bead* and *every run between these two dates*,
which is what an evidence pack for a window and a data-store question about the archive both
come down to. `git log --since --until --grep` answers both in one process with the full
record in hand, because `--format=%B` returns a message; a tree would make the same query one
`cat-file` per run, which is fine for the three runs on a bead and is a day's worth of
subprocesses for a month of an audit window. In a Stage 2 audit the cost is never the
storage, it is the retrieval. The tree is empty rather than holding a copy of the record,
because a fact with two homes in one commit is a fact that can disagree with itself — and the
body is not in git at all, which is the point of the split above.

**The bead filter has a `·` either side of the key**, and that is not decoration.
`beadcause/bc-eqn1.7` is a prefix of `beadcause/bc-eqn1.70`, so a substring match answers a
question about one bead with another bead's runs and says nothing about having done it. The
suite pins exactly that pair.

**Retention is 24 months, and the number is not this file's to pick.** It is
`RETENTION_FLOOR_MONTHS`, set from the report rather than from the disk — a Type II window is
twelve months, and the report is relied on for about twelve months after issuance, during
which somebody can come back to the population the sample was drawn from. `agentLogRetentionMonths`
raises it and **cannot lower it**: an install shortening this is not making a retention
decision, it is making a disk decision and writing a retention rule beside it.

**And the rule is enforced by something that runs**, because a retention period nothing
applies is a policy without a control behind it. An hourly sweep in the poll cycle deletes
every body past the period and appends the disposal to the chain. Hourly rather than every
beat: the boundary moves by a day per day, so a sweep every thirty seconds is 120 `readdir`s
an hour to find the same nothing, and an hour is well inside any tolerance a 24-month rule
has. The date comes off the **run id** rather than the file's mtime — an mtime is the one
thing about a file anybody can change by accident, through a copy, a restore or a backup
tool, and a retention sweep keying on it disposes of the wrong decade quietly. A body whose
name carries no date is left alone rather than guessed at.

**Nothing here can lose a run, and the ordering is why.** The body is copied first and
synchronously, so by the time anything is deleted the evidence is already on disk; the chain
is appended next; the reset happens last, and happens even when the chain write failed,
because the pane still needs its clean file and the body is already safe. An orphaned body —
kept, unchained — is a loud line in the log and a recoverable state. A reset before the copy
would be neither. Two archives inside the same millisecond get a `-2` suffix rather than one
overwriting the other, which the suite found by colliding two of them: "improbable" is not a
property an evidence store may rest on.


### What may leave the Mac — `lib/publishable.js`, `test/publishable.mjs`

The section above ends on the one thing an evidence chain cannot do for itself. `anchored`
is the only one of `verifyRef`'s three answers that can catch a deliberate rewrite, and it
is null for every caller — a rewritten history is *perfectly* self-consistent, so catching
one needs a head somebody wrote down beforehand, somewhere the rewrite cannot reach, and
every "somewhere" beadcause has is administered by the same operator. That is the argument
for a central service and it is what bc-3muu is: each daemon publishes, the service
witnesses, and a chain head that disagrees with the one recorded in March becomes a
discrepancy instead of an absence.

**The moment a head can leave the Mac, the question is what else leaves with it.** That has
to be settled before the service is built rather than after, because a payload is easy to
widen and impossible to narrow — the field you regret is already on somebody else's disk.
So the boundary landed first, as a file, with no transport behind it yet. The service holds
instance identity, transition commits, chain heads, control ids claimed, criterion states,
timestamps and a hash of each evidence record. **It does not hold the record.**

**The precedent was already shipped and already argued.** A workspace shared with other
people gets a [contentless push](config.md#privacy-of-the-push); a `minimal` space gets a nudge you
tap through to the tailnet rather than the question text. Same instinct in a harder case: a
service you do not administer is exactly where content would be going, and content is the
part you cannot take back once it has left.

Three things follow, and the third is the one that decides whether the service is hostable
at all. A hash proves a record existed at a time without disclosing it, which is all a
continuity claim ever needed. The service never becomes a central pile of every user's
source code and conversations, which is what makes running it survivable rather than a
breach waiting for a date. And the service's own audit stays tractable — it holds no
customer data of consequence, so the confidentiality criteria over it are cheap instead of
being the hardest part of the programme, which matters more than it sounds given that this
service will hold the evidence for the audits it is itself inside.

**The allowlist is the guarantee. The denylist is the error message — and a tripwire.**
`CONTENT_FIELDS` cannot be what enforces the boundary, because a filter over field names is
defeated by naming the field something else, and a rule that a rename defeats is a rule
that will be defeated. What enforces it is `FIELDS`: a record carrying a key the table does
not mint is refused whatever the key is called. The denylist earns its place twice anyway —
it makes the refusal say *content* rather than *unknown field*, which is the difference
between a caller fixing its payload and a caller adding a table row; and `tableProblems`
runs it over the table itself at import, so the day somebody widens the vocabulary to
`notes` or `description` the build breaks in every suite at once rather than arriving as a
one-line diff that reads like an improvement.

**An allowlisted name is not a licence for a paragraph.** The way content actually escapes
a schema is not a field called `body`; it is a paragraph in a field called `ref`. So every
value is typed against a closed set of shapes, every string is bounded and single-line, and
there is no free-text type and no way to add one — the suite takes an ordinary English
sentence and shows that every shape in the set rejects it.

**Continuity is provable from what the service holds, and nothing else.** Every record names
the digest of the one before it, so an unbroken run of publications is demonstrable by
walking digests with no repository and no content in hand: a record edited anywhere, removed
from the middle, reordered in time, or attributed to another instance breaks a link that
arithmetic finds. Nothing computes its own link either — `next()` derives `seq` and `prev`
from the record before it, because a caller that computes its own link can compute it wrong
once, silently, and be found out by an auditor rather than by a test.

```js
const a = genesis(instance, 'enrolment', { fingerprint: digest(publicKey), org: 'acme' });
const b = next(a, 'chain-head', chainHeadFields(await verifyRef(cwd, ref)));

linkProblems([a, b]);   // []  — one chain, and provably so
head([a, b]);           // { instance, seq, at, digest } — what March is checked against
```

**What it deliberately does not answer**, so the weaker fact cannot be quoted as the
stronger one. Linked is not continuous: an instance that published nothing for a fortnight
has a perfectly linked chain across the gap, and refusing to let it *claim* the fortnight is
bc-3muu.4. Where the records are stored and how they get there is bc-3muu.3, and the anchor
the store finally gives `verifyRef` is bc-hzu4. What an instance token actually is, and how
a daemon comes to hold one, is bc-3muu.2 — all this asks of it is that it be opaque and
bounded. The vocabulary is expected to grow, and growing it is a row in `FIELDS` and a shape
in `TYPES`: one table, one funnel, one place to be wrong.

**And the rule is proved against a bad table rather than only run against the good one.**
`tableProblems` passes over `FIELDS` at import, which tells you nothing about whether it
could ever fail — the same lesson `entryProblems` learned one section up. So the suite points
it at a table minting `notes`, at one claiming a type that is not a shape, and at one
colliding with the envelope, and asserts each is refused by name.

### Anchoring the head where nobody involved can rewrite it — `lib/anchor.js`, `lib/timestamp.js`, `lib/translog.js`

The section above ends with a service that holds a second copy of every chain head. That is
corroboration and it is worth building, but it is not independence: beadcause writes the
daemon, beadcause writes the service, and one operator administers both. An auditor who
wants to be difficult says *you could have rewritten both copies*, and they are right —
nothing in a system you run end to end can answer that.

**So the thin slice that is genuinely third-party is not built at all.** Independence is not
a feature; it is the property of somebody else holding the record. What is built here is the
client: what is sent (a hash, and nothing else), what comes back (two receipts), and — the
part that actually matters — how either receipt is checked years later by somebody holding
only the files.

**Two tiers, doing different jobs.** The control-daemon is continuous and high-resolution:
every transition, seconds after it happens, first-party and cheap. The anchor is rare and
coarse: one head an interval, timestamped outside our administration. It cannot say what
happened *between* anchors and it is not meant to. What it says is that everything before
this point existed by then and has not been rewritten since — the one claim no amount of
first-party record keeping can make. Conflating the two would let the weaker fact be quoted
as the stronger one, which is the same discipline `linkProblems` keeps one section up.

**Both receipts, every time, because they fail differently.** That was settled on bc-3muu.10
and it is the reason the pair is worth the extra hundred lines:

| | `lib/timestamp.js` — RFC 3161 | `lib/translog.js` — a transparency log |
|---|---|---|
| What it is | one signature from a named certificate authority over your digest and its own clock | an inclusion proof against a signed, public, append-only Merkle tree |
| Its strength | verifies **offline, forever**, from the token and a certificate — no network, no service that has to still exist | **no single party can rewrite it unseen**; the tree is published, witnessed and gossiped |
| Its weakness | it is one party, and a compromised or defunct CA takes its assurance with it | checking it *well* means checking the log stayed consistent over time |

An auditor who distrusts one is unlikely to distrust the other for the same reason. So
`verifyAnchor` returns the two verdicts **separately** and counts how many stood up on their
own, because the claim being made is that a rewrite is detectable by *either* receipt alone —
and a verifier that collapses both into one boolean cannot support it. `ok` stays strict at
both, because degrading to one silently is how a pair becomes a single point of failure that
nobody announced.

**Nothing but a hash ever leaves, and this is where that boundary is really tested.** What is
anchored is the digest of the `chain-head` record above, so the argument made for a service
you host survives out to a party you have no agreement with at all: the third party learns a
32-byte number and the time it saw it, and could not say which repository, which bead, or
even which product it came from. `submission()` is the one funnel that builds both requests,
and the suite rebuilds the timestamp request **byte for byte** rather than asserting the
digest is in it — "the digest is present" is not the claim, "nothing else is" is, and only
byte equality says that. It is also why the anchor cannot double as a backup, which was asked
and settled: a hash is not a copy, and off-site recovery of the evidence is an availability
control over the service rather than a job for a witness.

**A receipt separated from what it anchors proves nothing**, so an anchor is one record
carrying the ref, the head, the digest and both receipts — and one carrying a single receipt
is refused rather than accepted as a weaker anchor. A half-anchored head that renders as
anchored is worse than a gap, because somebody would have to notice the difference later and
nobody ever does.

```js
const sub = submission(record);                    // → { digest, timestampRequest, entry }
const verdict = verifyAnchor(anchor, { ca, keys });
verdict.independent;                               // 2 — both stood up on their own
verifyAnchor(anchor, { keys }).inclusion.ok;       // true — the log proof needs nobody's CA
verifyAnchor(anchor, { ca }).timestamp.ok;         // true — the token needs no network at all

const v = await verifyRef(cwd, ref, withAnchor(anchor));
rewriteProblems(anchor, v);                        // [] — or the sentence naming the rewrite
```

**And this is the field `verifyRef` has been waiting for since it was written.** `anchored`
is the only one of its three answers that can catch a deliberate rewrite, and it has been
null for every caller because nothing recorded a head to pass it — that was bc-hzu4.
`withAnchor` is that head. `test/anchor.mjs` ends by doing it end to end against a real
repository: verify a chain, publish its head, anchor the record, keep the receipts, then
rewrite the middle of the history and watch the result come back **`intact: true`** and
`anchored: false`. A forged history is perfectly self-consistent; only the receipts say it is
not the history that was there in March.

**A missed anchor renders as an unanchored interval rather than as silence**, which is the
other half of the criterion and the half that is easy to skip. An interval nobody wrote down
cannot be *missed* — without a stated period there is no such thing as a late anchor, so a
daemon that quietly stopped anchoring in April renders as an unbroken run of green. So
`coverage()` states the interval, labels every span across the window, and adds the gaps up:

```
Anchored every 24h; 3 anchor(s) in the window.
  anchored  2026-08-01T00:00:00.000Z → 2026-08-02T00:00:00.000Z (24h) at 8f2c1ab09e7d
  anchored  2026-08-02T00:00:00.000Z → 2026-08-03T12:00:00.000Z (36h) at 8f2c1ab09e7d
  UNANCHORED 2026-08-03T12:00:00.000Z → 2026-08-06T00:00:00.000Z (60h) — 96h between anchors, and one was due every 24h
  anchored  2026-08-06T00:00:00.000Z → 2026-08-07T00:00:00.000Z (24h) at 8f2c1ab09e7d
60h are witnessed by nobody outside this machine.
```

**The verifiers are written out rather than depended on, and that is a deliberate cost.** A
timestamp token is CMS and there is no reading one without ASN.1; Node ships no decoder. So
`lib/der.js` is ~200 lines of tags and lengths, strict on the way in — indefinite lengths,
non-minimal lengths, padded integers and trailing bytes are all refused, because BER's
several spellings of one value are several byte strings and *a signature covers bytes*. It
keeps offsets rather than re-encoding, for the same reason: hashing a decoder's idea of the
signed attributes is how a verifier ends up right about a document nobody sent. The code that
decides whether a compliance receipt is genuine is code an auditor may reasonably want to
read end to end, and a general-purpose ASN.1 library is not readable in an afternoon.

**Both suites are cross-checks rather than fixtures, because a fixture cannot be made wrong
on demand.** `test/helpers/tsa.mjs` mints a certificate authority out of the same DER writer,
so the RFC 3161 checks watch every refusal fire one at a time — a token for another digest, a
lifted signature, attributes that do not cover the content, a signer with no timestamping
usage, a signer chaining to somebody else, a stamp from outside its own certificate's
validity, SHA-1, a replayed nonce. Each of those reads as a perfectly valid token to a
verifier missing that one check. `test/helpers/translog.mjs` implements RFC 6962's
*recursive* definitions while `lib/translog.js` verifies with the iterative decomposition
production logs use, and the suite runs every leaf of every tree up to 40 entries and every
earlier size for consistency: two independent implementations agreeing across ~1600 cases,
where a helper mirroring the verifier's own arithmetic would agree with it about the bugs
too. It also pins the one mistake that makes a whole log meaningless — an odd node is
promoted, never paired with a copy of itself, which is CVE-2012-2459.

**One policy assertion is worth reading twice: a token outlives the certificate that signed
it.** That is the entire point of a timestamp, so the validity check is that the authority was
authorised *at `genTime`* rather than that it still is today. Checking a receipt against the
current clock would expire the whole archive on a date nobody chose.

**What is deliberately not here.** No store and no transport: where anchors are retained and
what submits them is bc-3muu.3's, and which authorities and which logs an install trusts is a
configuration question that arrives with the submitter. There is no ambient trust store and
no fetch anywhere in these files — a checkpoint verified against whatever key the checkpoint
itself points at is a checkpoint verified against nothing, and the receipt is supposed to
mean the same thing to an auditor holding only the files. Consistency proofs are implemented
and checked (`verifyConsistency`) but nothing yet holds an earlier checkpoint to check
against; that is the submitter's to keep, and it is what turns the log's promise from polite
into enforceable.

### Who operates it — `lib/operator.js`, `test/operator.mjs`

The section above settles what may leave the Mac. This one settles where it goes and whose
hands it lands in, because a witness is only worth what the arrangement around it is worth
— and the arrangement is a decision somebody makes rather than a hosting bill.

**Each organisation installs and runs its own control-daemon. We host nothing.** That is
Adam's answer on bc-3muu.9, and it is a product decision more than an infrastructure one.
Every hosted option considered — the service organisation's infrastructure, a beadcause-operated witness, a
purpose-built append-only store — put somebody in the position of holding somebody else's
evidence, which makes them a **subservice organisation** in a system description that did
not want one, forces a carve-out or inclusive-method decision, and eventually means wanting
their own attestation. Self-hosted, the control-daemon is inside the customer's own
boundary and tested in the customer's own engagement. Nobody carves anything out, beadcause
is a software vendor rather than a service organisation, and the strongest answer to a
security questionnaire is available and *true*: you run it, we never see your data, not even
the hashes.

**And the trust model that arrangement supports is the one line bc-3muu.9 exists to
record.** A control-daemon the organisation hosts is a second copy in the same hands as the
first. It delivers **corroboration** — a copy that must agree — and no amount of access
control can make it deliver more, because whoever administers the access control is inside
the boundary it protects. That is acceptable and it is ordinary: no clause of SOC 2 or
ISO/IEC 27001 asks for an independent witness, and CloudTrail is first-party too. What is
*not* acceptable is saying independent, which is a misstatement an auditor finds. So
independence is carried by the anchor instead (bc-3muu.10) — a receipt signed by a party
nobody here administers — and the cost of self-hosting is precisely that the anchor stops
being optional. An install that has not configured one is not a weaker version of this
design; it is a different one with no tamper-evidence in it.

**Which is why this is a file rather than a paragraph.** Three words, ordered, and nothing
can set them:

    assuranceOf([local])                    // 'unwitnessed'  — nothing has left the machine
    assuranceOf([local, control])           // 'corroborated' — a second copy, same hands
    assuranceOf([local, control, anchor])   // 'independent'  — a receipt from outside

`claimProblems` is the refusal that follows: an arrangement may always claim *less* than it
supports and never more, and the message says which copy is missing rather than only that
the claim is denied. There is no `assurance` field on a deployment and no way to write one
— it is derived on every read, because a record of what an install *believes* about itself
is the flag [an election](compliance.md#what-you-elected-to-be-held-to--libelectionjs) declines to
have, one layer up, and it fails the same way: you believe you set it.

**The refusal that actually earns the file is that an anchor operated from inside the
arrangement is not an anchor.** Independence is not a feature that can be implemented — it
is the property of somebody else holding the record — so an anchor run by the organisation
or by the vendor is a third copy wearing the word, and it is the one mistake that would
leave every other check in this epic passing over a claim that is false. Immutable object
storage in an account we administer is the plausible version of it: a genuinely good control
at the storage layer, and not an anchor at any layer. `PARTIES` is why the mistake has to be
written down as the word `organisation` next to the word `anchor`, where a reader can see
it, and `arrangementProblems` is why it is refused by name when it is.

Two smaller rules sit beside it, and both exist because the failure reads as a healthy
setup in every list. A second control-daemon under the same operator is **redundancy** —
an availability property, and a good one — but two copies in the same hands are one party,
so counting it as two is how "we keep backups" becomes "we are corroborated" in a sentence
nobody meant to overstate. And an arrangement with no `local` deployment in it is a witness
with nothing to witness; `assuranceOf` answers `null` for it rather than `unwitnessed`,
which is the same distinction `inScope` draws between `null` and `false` — a caller handed
the weakest word for a record it could not read goes on to render a continuity claim over
it.

**`subservices` prints the consequence rather than leaving it to be discovered.** It is
empty for the shipped model, and the day somebody stands up a hosted control-daemon for a
customer it stops being empty on its own, naming the deployment and the paperwork it
forces. The anchor is deliberately not in that list: a subservice organisation performs part
of the service commitments on the organisation's behalf, which is what holding its evidence
is, whereas an anchor is handed a hash and returns a receipt and performs no control for
anybody. It is a supplier in the vendor register, and putting a timestamping CA in a system
description beside a hosting provider would be wrong in a way an auditor would have to
unpick.

**`VENDOR_OPERATES` is an empty frozen array, and that is the whole decision as data.** It
looks like a placeholder. It is what makes "we never hold anyone's evidence" a property of
this repository that a diff has to break on purpose, and `test/operator.mjs` asserts both
that it is empty and that `shipped()` names no vendor anywhere. The remaining cost is real
and is not solved here: correct installation becomes the customer's problem, and a
misconfigured control-daemon — append-only enforced in the application rather than in
storage, anchoring switched off, break-glass access that is silent — produces evidence that
looks fine and is not. That needs an answer in code rather than in documentation, and
bc-3muu.13 is where a deployment comes to prove its own configuration instead of being
trusted to have it.

### Which install is speaking — `lib/instance.js`, `test/instance.mjs`

The two sections above settle what may leave the Mac and whose hands it lands in. This one
settles the field both of them leave opaque: `instance` is a token in a published record,
and every continuity claim the service holds is a claim *about an install*. A chain
attributed to the wrong one is not a slightly wrong record. It is a true-looking record of
something that never happened.

**An install is not an account, which is why none of the credentials already here would
do.** One person runs several installs, a team runs dozens, and worktrees and observer
instances share a Mac and a tracker. The daemon token says *may this request act*, [device
pairing](install.md#pairing-a-phone) says *is this phone allowed in*, Google sign-in says *which human
is this*. None of them says which of the running daemons is speaking, and none of them
survives being copied — surviving a copy is what a bearer token is *for*.

**So the identity is a keypair and the id is the key.** `id` is the first 128 bits of the
digest of the public key, so a token and a key cannot drift apart and there is no registry
lookup to get wrong: anybody holding both can check one against the other with no stored
state at all. Enrolment publishes the fingerprint, the daemon keeps the private half in
`instance.key`, and everything after is signed. That is "cannot be minted by whoever feels
like it" in its exact form — anybody may generate a keypair and enrol as *themselves*, and
nobody can speak as an install whose private key they do not hold.

The `.key` suffix is load-bearing rather than tasteful. The config directory is [a git
repository](agents.md#where-the-rest-lives-configbeadcause-is-a-git-repo) and everything in it not refused by
the denylist is committed on every change; `*.key` is refused, so the suffix is the only
thing keeping an install's identity out of its own history. `instance.json` — the public
half — *is* committed, which is the right way round, because an enrolment is a fact worth
having a history of. `test/instance.mjs` asserts both against the real denylist rather than
against a copy of it, because a rename to `instance-private.json` is a one-line diff that
reads like tidying up.

**The hard case is the observer, and holding the key cannot solve it.** A second instance is
booted [by copying a real config directory](#a-second-instance--observer-mode), so the copy
holds the private key by construction. An observer publishing continuity for the daemon it
was copied from is the failure that banner exists to prevent, with an auditor at the end of
it — and the docs are already emphatic that the way `BEADCAUSE_OBSERVE` fails is you
believing you set it. A guard that is only the flag is a guard that is only the failure
mode.

What the copy cannot bring with it is *where it is*. `placementOf` digests the three facts a
copy changes and a restart does not — the resolved directory, the account and platform, and
the moment that directory came into existence — and the daemon recomputes it at every boot.
The documented recipe, a copy at `/tmp/bc`, fails on the path; a copy back over the same
path fails on the birth time; a copy onto somebody else's Mac fails on the account. The
hostname is deliberately *not* in it: a laptop is renamed by a network it joins, and an
identity that stops publishing because of DHCP is one nobody keeps. Placement is the brace,
the flag is the belt, and `publishProblems` asks for both.

**Placement is never published.** It is a digest of a home directory path, and a path is
content in every sense [the boundary](#what-may-leave-the-mac--libpublishablejs-testpublishablemjs) means it.
It is a local self-check; the enrolment record carries a fingerprint and a tenant and
nothing else, and the suite asserts field by field that it does.

**What this cannot catch is worth saying rather than implying.** A whole-machine clone
reproduces all three facts, so two daemons would publish under one id — and no local check
can tell them apart, because they are locally identical by construction. It is caught one
layer up instead, and caught well: two writers on one chain fork the sequence, and
`linkProblems` finds a fork by arithmetic. A limit with a named catcher is a design; a limit
with none is a hole.

**Stable across restarts, stable across reinstalls, deliberately not stable across a wiped
machine.** A restart reloads two files. Reinstalling beadcause replaces the checkout and
never touches the config directory, and nothing in an identity is derived from the
repository, so a reinstall cannot mint a second identity for one install. A *lost* config
directory is the opposite case and gets the opposite answer: the private key is gone, the
old id is unspeakable, and `reenrol` mints a new install whose chain starts at seq 0. An
install that could re-mint its own past identity from scratch is an install anybody could
mint, and the old instance falling silent is a finding somebody should see (bc-3muu.5)
rather than something to paper over.

**A move is a question, and it is asked out loud.** A legitimately moved config directory is
locally identical to a copy of one, so `adopt` exists, requires the caller to say
`deliberate`, refuses outright while observing, and records what the placement was before —
because the useful question a year later is not where it is but how many times it has been
somewhere else. Fail-closed on the ambiguous case with one named way through beats a
heuristic that guesses right most of the time.

Nothing wires this into the daemon yet: there is no service to enrol *with* until
bc-3muu.3 lands the protocol, and the directory is an argument rather than a constant, so a
check, an installer, a service and a daemon can each point it somewhere without dragging in
each other's state.

### A silent instance is a finding — `lib/findings.js`, `test/findings.mjs`

The three sections above settle what may leave the Mac, whose hands it lands in, and which
install is speaking. This one is what the whole arrangement is *for*, and it is the answer to
the question that started it: what stops somebody quietly running a build with the compliance
layer stripped out?

**Nothing stops them.** What the service does is notice. An enrolled instance that stops
publishing, publishes a chain that does not extend its predecessor, or turns out not to be
held at all any more is a discrepancy somebody reads — not a row the report silently lacks.

**The failure this file exists to prevent is the easiest one in the world to ship.** Every
natural way to write a report iterates the things it holds. A service that iterates its
ledgers cannot report the instance whose ledger it no longer has, and the report it produces
is not merely incomplete — it is *clean*, confidently, with every row it printed correct.
That is worse than an error, because an error gets looked at. The same mistake already
shipped here once, against the tracker rather than a service: a change sample where nothing
could be asked reported 47 of 47 clean, which is the most confident possible way to say
nothing at all. So `clean` here means *every member of the population accounted for and
current*, and never "no findings" — a survey that covers nobody is not clean, and says so
in the sentence it carries.

**The population is a union of four sources, and each can name somebody the others cannot.**
The ledgers the service holds. The refusals it recorded, which name instances whose *first*
publication was rejected and which therefore have no ledger at all. The comparisons somebody
ran. And the previous survey — the only source that can name an instance the service has
*stopped* holding. Delete a ledger to quieten the report and the report gets louder, because
last night's survey still names the instance and the absence is now the finding. Surveys
chain for the same reason [records do](compliance.md#append-only-stated-twice-because-it-can-fail-twice).

**"Within a stated interval" means the interval is stated, and that somebody looked.**
`EXPECTED_MS` is six hours, exported rather than buried in a comparison, and every silence
finding quotes both it and how long the silence has run: "last witnessed …, 9 hours ago, and
one publication every 6 hours is expected" is a sentence an auditor can check, where
"instance X is silent" is one nobody can. Silence is dated by the *service's* receipt rather
than by the `at` the record carries, because an instance that is behind on everything else
should not also be the authority on whether it is late. And a survey that has not itself run
within the interval raises `unsurveyed` against itself: an instance can only be found silent
by somebody looking, so a gap between surveys is a gap in the guarantee rather than a quiet
stretch, and it is reported in the same list as everything else instead of being inferred
from a missing file.

**A verdict is trusted; a flag on somebody's object is not.** Whether a comparison is
divergent is decided by looking its verdict up in the table [`compare` reaches
them from](compliance.md#both-directions-and-they-are-not-the-same-event), never by reading the
`divergent` boolean sitting on the result. The two agree today, which is exactly why
consulting the flag would be harmless right up until a comparison built somewhere else
arrived pre-declared clean. A verdict the surveyor does not recognise is a finding too: an
answer nobody can classify is the one case where saying nothing would be worst.

**The second half of the bead was already refused, and what was missing was that it be
reported.** [The witness](compliance.md#the-service-is-a-witness-and-it-cannot-author) refuses a record
that re-uses a sequence number or names the wrong predecessor, and hands back sentences; a
service that turns those into a `400` and nothing else has an event that lives for as long
as the connection does. `rejection` carries those sentences into a finding with a place to
live. The refused record itself is deliberately *not* carried — it was refused, so the
service does not hold it, and a finding that quietly stored what the admission rule turned
away would be a second copy of [the
boundary](#what-may-leave-the-mac--libpublishablejs-testpublishablemjs) that nobody is
checking.

**None of this rests on trusting the surveyor, which is the point of `surveyProblems`.** A
report travels: it is read by somebody who did not run it, later, possibly through a service
somebody else administers. Point that function at a report *and at the inputs it was made
from* and it says what the report fails to account for — a row quietly dropped, a row marked
`current` with findings hanging off it, a report marked clean carrying findings, a report
marked clean covering nobody. Sentences rather than a boolean, because the reader of a
refused survey has to know which row to go and look at. Same discipline as `tableProblems`
and `entryProblems`: a rule only ever run against inputs that pass is a rule nobody has
watched fire.

Pure, and a leaf below the config directory for the reason `lib/witness.js` is one — the far
end has to be hostable somewhere that is not this Mac, so there is no git, no filesystem and
no clock but the one a caller passes. It cannot mint a record either: `record`, `next` and
`genesis` are not imported, and the suite reads the source and fails the repo if they ever
are. A surveyor that could author is a surveyor that could answer its own question. Nothing
wires it into a daemon yet, and what it does *not* answer is whether a period an instance was
publishing across can be claimed — linked is not continuous, that is bc-3muu.4, and rounding
the two together would let the weaker fact be quoted as the stronger one.

### A deployment says what it can back up — `lib/posture.js`, `bin/attest.js`

[Who operates it](#who-operates-it--liboperatorjs-testoperatormjs), three sections up, puts
the daemon that produces those chain heads on the customer's own hardware, and that one move
changes who can get it wrong. While we host it, correct configuration is ours to guarantee and a misconfiguration
is ours to notice. Hosted by somebody else, a deployment with **append-only enforced
nowhere but in the application**, with **anchoring never configured**, with a **retention
shorter than the window it is meant to support**, or running a **build nobody can
identify**, produces evidence that looks exactly like good evidence. Nobody finds out until
an auditor pulls the thread, and by then the period is over and cannot be re-observed.

**Documentation cannot fix that, and this is the argument for building it instead of
writing it down.** A runbook is read once, on the day of the install, by somebody who is
not the person still running the box three years later. So the deployment says what it is
continuously, in the record itself: a `posture` record, on the same chain as everything
else, carrying six facts —

| field | what it says | why it is a claim and not a note |
|---|---|---|
| `storage` | `storage` \| `application` \| `none` \| `unknown` | who could delete a row. `application` means the *code* refuses to rewrite and the operator running the code still can |
| `anchoring` | whether an anchor is configured at all | without one, nothing witnesses a head anywhere the local operator does not administer |
| `anchored` | when anchoring last succeeded, or `never` | an anchor witnesses the head it saw. One from March says nothing about June |
| `retention` | months kept, or `permanent` | a report relied on for twelve months needs twenty-four |
| `build` | the commit running, or `unknown` | a record whose producer cannot be identified |
| `provenance` | `matched` \| `mismatched` \| `unknown` | `mismatched` is a tree somebody changed under the daemon — invisible to anything recording a version string |

**Every one of them is observed, and there is deliberately no way to state one.** No
`posture.json`, no config key, no argument that says "we are append-only, trust us":
`observe` takes *places to look* — the checkout, the store, a witness for anchoring — and
where it cannot look it writes `unknown` rather than an optimistic default. A deployment
able to assert its own posture would have the runbook's failure mode one layer down and
harder to see, and `test/posture.mjs` reads the signature of `observe` and fails the repo
if any posture field ever becomes an argument to it.

**The refusal is the whole point, and it is bc-3muu.4's rule pointed at configuration
instead of connectivity.** A posture that cannot back a claim does not produce a smaller
claim, a warning, or compliant-with-exceptions — the interval it covers reports
`unverified`. That is not the same as failed, which is why `CRITERION_STATES` keeps
`unverified` and `unmet` apart, and it never blocks anybody's work: a daemon whose
anchoring was never configured goes on dispatching sessions and writing chains exactly as
before. What it stops doing is claiming a period it cannot show.

**A posture change renders rather than resolves.** `report` cuts the run of records into
the intervals each posture covers, so a quarter with anchoring off for five weeks reads as
five weeks with anchoring off — a scope note an auditor can price — instead of averaging
into a clean quarter, which is what a posture held as current state rather than as history
would produce. A `chain-head` published inside such a stretch is reported as unbacked,
which is the acceptance in one line: a head published under a posture that cannot support a
claim is a number, not a witness. `recordAttestedHead` in `lib/publication.js` is the
writer that keeps one from being published by accident: posture first, head second, one
instant for both.

```
UNVERIFIED — 2026-01-01T00:00:00.000Z to 2026-03-31T00:00:00.000Z

  ✓ 2026-01-01T00:00:00Z to 2026-02-01T00:00:00Z
      storage=storage, anchoring=true, anchored=2026-01-01T00:00:00Z, …
  ✗ 2026-02-01T00:00:00Z to 2026-03-08T00:00:00Z
      changed: anchoring=false, anchored=never
      · anchoring is not configured, so no head is witnessed anywhere the local
        operator does not administer
  ✓ 2026-03-08T00:00:00Z onwards
      changed: anchoring=true, anchored=2026-03-08T00:00:00Z
```

**And an auditor can run it without us, because otherwise the verdict is the vendor's word
about the vendor.** `report` takes published records and nothing else — no repository, no
content, no network, no config directory — so `beadcause-attest verify` works against an
export on a laptop that has never seen this install. It reads a JSON array or one record
per line, because an export is written by whoever exports it and a verifier that only reads
its own output is one nobody else can use, and it exits 0 when the interval may be claimed
and 2 when it may not. The daemon and the auditor call the same function, which is the only
way the two answers cannot quietly diverge.

```bash
beadcause-attest posture                  # what this deployment observes about itself
beadcause-attest record --instance <tok>  # that posture, as a record for the chain
beadcause-attest verify export.json --from 2026-01-01T00:00:00Z --to 2026-03-31T00:00:00Z
```

**Expect `unverified` from every install today, and that is the correct output rather than
a threshold to relax.** Nothing submits an anchor yet — that is bc-3muu.14, and until
something does, `anchoring` observes as unconfigured on every install — and a git ref in a
directory its operator owns is enforced by the application and not by the store, which no
amount of publishing changes as long as the store is the operator's own. The number that must
never appear is a deployment reporting `verified` because nobody looked, and the one
constant this file does not import is the retention floor: `OBSERVATION_MONTHS` is declared
here rather than taken from `lib/evidence.js`, because a deployment that could lower the
bar it is measured against by editing the file that declares the bar is doing the
self-assessment this whole section refuses. If the two ever disagree, the disagreement is
the finding.

### Publishing on a clock nobody has to remember — `lib/publishsweep.js`, `test/publishsweep.mjs`

Every module in the two sections above was a leaf with a suite and **no caller**. `lib/publishable.js`
said what may leave the Mac, `lib/publication.js` kept the chain and published it,
`lib/posture.js` said what this deployment could back up, `lib/instance.js` said which install
was speaking — and on a running install none of them was ever entered. `refs/beadcause/publications`
did not exist on this laptop. Every acceptance criterion in the family that began *"every
deployment publishes…"* was satisfied by a function nobody called, which is bc-keqy, and this
is the other side of the door.

**The door is `whenOn` in `lib/management.js`, and nothing here reaches around it.** Off is the
default for every install and off has to cost nothing — not a git repo, not an identity, not a
ref. So the whole of the work sits inside the loader `whenOn` calls only when the layer is on,
and `lib/publication.js`, `lib/posture.js` and `lib/instance.js` are `import()`ed *there* rather
than at the top of the file. That is not a promise in a comment: `test/publishsweep.mjs` reads
the module's own import list and fails the repo if any of the three appears in it, and then
sweeps a fresh config directory with the layer off and asserts that afterwards it holds **no
`.git`, no `instance.json`, no `instance.key` and in fact nothing at all**.

A sweep does four things, in this order.

1. **Enrols, once.** A chain's first record names the instance publishing it and there is no
   chain without one. The organisation is not invented — `lib/organisation.js` refuses
   `default`, `main`, `shared` and fifteen others *precisely* because they are what an install
   writes when it has one tenant and a column to fill — it is read from the compliance
   subjects `lib/boundary.js` loads (`compliance.subjects`), which are keyed by organisation
   id. An install with exactly one subject belongs to it; one with none has nothing to enrol
   into and says so, naming the key; one with two **refuses**, because an install that has to
   be told which tenant it is must be told rather than guessed at, and a guess here is a chain
   filed under the wrong organisation for as long as the install lives.
2. **Attests, then publishes a head.** `recordAttestedHead` writes the posture in force and the
   chain head at one instant and in that order — that rule is the section above's, not this
   file's to restate. What this file decides is *when*: a governed ref whose tip has **moved**
   is published on the next sweep, because the movement is the interesting fact, and a ref that
   has not moved is published again once its last head is older than the **anchoring interval**.
   That number is imported from `lib/anchor.js` rather than chosen here, so the two cannot
   disagree; the floor is what makes a quiet fortnight read as an instance that went on
   reporting rather than as one that stopped.
3. **Publishes the management transitions.** A chain that carries heads but not the moment the
   compliance layer was switched off is a chain with the gap taken out of it.
4. **Sends whatever the far end has not witnessed**, through `publishQuietly` — the door that
   cannot throw, cannot reject and cannot hang.

**A transition typed with no bead is published as `'none'`, not skipped (bc-3muu.21).**
`setManagement` in `lib/management.js` takes a bead and defaults it to null on purpose — a
manual `beadcause-management on`/`off` at a terminal is not always done for a piece of
work — while the `transition` kind in `lib/publishable.js` requires all three of its
fields, `bead` among them. The two disagreed, and the disagreement landed in the worst
place: the transitions are what say whether the compliance layer was on at all, so a
transition the publisher could not carry was a hole in exactly the record an auditor reads
for the window's own boundary. The fix widens `TYPES.bead` rather than the CLI or
`setManagement`: `'none'` is a sentinel, the same shape `since`'s `'never'`, `origin`'s
`'unknown'` and `retention`'s `'permanent'` already take, and it is a fact an auditor can
act on — "this transition named no bead" — rather than an absent field standing in for it.
Making `bead` mandatory at write time was rejected: it would still do nothing for the
transitions already on `refs/beadcause/management` on any install before this landed, since
none of those can retroactively acquire a bead either way, and it would refuse the ordinary
case of a manual toggle with no ticket behind it. Widening the kind to carry `reason` and
`by` instead, and dropping `bead` to optional, was rejected too — `reason` is prose, and
publishing prose is exactly what this table exists to refuse. `lib/publishsweep.js`'s
`transitionsOwed` publishes every transition with a commit on the ref now, whatever its
bead; `test/publishsweep.mjs` and `test/publishable.mjs` both pin a bead-less transition
through the whole path — table, chain, sweep — and assert it links.

**Which refs get a head is a table with a crosswalk under it.** `PUBLISHED_REFS` names seven,
each of them a *chained* evidence class in `lib/evidence.js`'s register that lives at one fixed
ref, and the suite checks every entry against that register by literal id. Two kinds of class
are deliberately absent and each is a sentence in `NOT_PUBLISHED` rather than an omission: the
publication chain itself, because a head of it appended to it changes the head it just
published; and the classes that live at a *family* of refs — `refs/beadcause/sessions/<bead>`
and the per-kind, per-topic and per-bead halves of the agent memory — because one head each is
unbounded in the beads this laptop has ever run, and a family wants one record digesting the
set. A chained class at a fixed ref that is in neither list fails the suite.

**A service that is unreachable, refusing, lying or silent leaves the tick untouched.** The
suite drives all four — a transport that throws, one that rejects, one that acknowledges a
different record, and one that accepts the connection and then never speaks — and after each of
them the sweep has returned an outcome and the chain is still on disk and still links. That is
the epic's second principle applied at the one call site that could have broken it: *fail open
for work, fail closed for claims.* Nothing here papers over a gap; the claim half is
`claimProblems` in `lib/continuity.js`, which refuses an unpublished period rather than
rendering it as a clean window.

**There is no transport on this Mac yet** (bc-3muu.14), and the sweep does not report that as an
outage — an install whose service has not been stood up is not an install that lost touch with
one, and a word that says otherwise every hour is the word nobody reads on the day it is true.
The chain grows locally regardless, which is the arrangement `lib/publication.js` argues for at
length: the local chain is the record and the service corroborates it.

It runs **last** in the slow half of the poll cycle, on an hourly clock of its own
(`publication.seconds`). Nothing waits on it, and it is the only sweep that both writes evidence
and may reach a network with a thirty-second deadline behind it — so it goes after even the
tracker sync, which every other sweep is ordered in front of.

### Inside the boundary it evidences — `lib/servicescope.js`, `test/servicescope.mjs`

The `lib/publishable.js` and `lib/operator.js` sections above settle what may leave the Mac
and whose hands it lands in. This one is the consequence neither of them can avoid: **the
service holds the continuity evidence for an audit, and a system that holds the evidence for
an audit is inside it.** Its own access, availability, change management and logging get
tested, by the same auditor, in the same engagement — and the cheapest moment to know which
controls those are is while the service is still three open beads and a payload contract,
rather than in a fieldwork week where the answer arrives as a finding.

**There are two boundaries and they give opposite answers, which is why the file says both
out loud.** The boundary of the *system described* is the subject organisation's product: what a
user entity reaches, submits to and receives from. The control-daemon is development-side
machinery no user entity has heard of, so it is **carved out of the description**, exactly
as the boundary record bc-4r10.2 is building already carves out beadcause and the Mac it
runs on. The boundary of the *audit* is everything the auditor tests, and the
control-daemon is squarely inside it — more deeply than the rest of the tooling, because
the records it holds are the population a sample is drawn from. A carve-out is a statement
about the description and carries no implication whatever about what gets tested. So
`COMPONENTS` records the carve-out with a `bearsOn` naming the evidence path, and the
enumeration below is the other half.

**The subservice decision is a record even when the answer is *nobody*.** bc-3muu.9 put
every deployment in the organisation's own hands, so no party performs part of its service
commitments on its behalf and the carve-out-or-inclusive question does not arise — but a
system description with nothing written under *subservice organisations* is
indistinguishable from one where nobody looked. `methodFor` returns `not-a-subservice`
with the arrangement it was read off beside it, and it is derived rather than declared:

```js
methodFor(shipped('acme', at));          // { decision: 'not-a-subservice', required: false, … }
methodFor([local, hostedControl]);       // { decision: null, required: true, operators: ['vendor'], … }
methodProblems([local, hostedControl], 'not-a-subservice');
//  → 'vendor operates a deployment holding this organisation's evidence, so this is a
//     subservice organisation and the description owes a carve-out or inclusive decision'
```

Both directions are refused, and the second one is the one nobody expects. Claiming
`not-a-subservice` while somebody else holds the evidence removes a party from the
description; recording a **method** while nobody else holds anything puts a party into it
that does not exist, and an auditor asking to see the agreement with them — or the
complementary user entity controls a carve-out owes — finds nothing. Those CUECs are
written now, in `CARVE_OUT_CUECS`, while nobody is under time pressure: a CUEC invented
during fieldwork describes what the customer happened to be doing rather than what they
must do.

**Its own controls are enumerated against the same corpus everything else uses** — 23 of
them, across all three frameworks, each answering why the control applies to *a witness
holding digests* rather than why it exists. Two are `enforced`, seven are `partial` and
fourteen are `owed`, and every one of those names the bead that closes it, so `owed()` is a
list rather than a feeling. The states mean something narrow: `enforced` is code in this
release that refuses the thing the control is about and names the module — which the suite
opens, because a module named here and moved there is a control that reads as built.
**None of the three is an operating-effectiveness claim.** A Type II report says a control
operated over a period, and only a running service across a real period produces that.

**And the service must not be its own evidence.** The trap in a system that monitors other
systems is to answer its own control questions with its own product. Making a silent or
modified *instance* a finding (bc-3muu.5) is the witness watching its tenants; monitoring
of the witness is a different control, and a service whose anomalies are visible only in
the records it publishes about others has none — it just looks quiet. Nothing in the
enumeration cites a control-daemon capability as the control over the control-daemon, and
the suite asserts it.

The file is a **leaf**, like `lib/publishable.js` and the boundary record: one import, no
state read and none written, so a check, an installer, a report generator and the system
description itself can each hold it. It deliberately does not import the control corpus —
ids are held to the shape their framework uses and resolved against the corpus by the
suite the moment `lib/controls.js` lands, alongside a second cross-check that spreads
`COMPONENTS` into a real boundary record and asserts it still validates. Both print a loud
`SKIP` until their neighbour exists, so they start working on somebody else's merge rather
than on somebody remembering.

### Every document has an owner and a review date — `lib/documents.js`, `test/documents.mjs`

The documentation here is unusually good and was entirely uncontrolled. This file is about
nineteen thousand lines and is the specification for the whole system; `docs/` holds a few
more; two of the registers this programme has already produced are source files. Not one of
them carried a version, an owner, an approval or a date somebody last looked at it. **An
auditor does not read a document for accuracy.** They ask who approved it, which version is
current, and when it was last reviewed — and there was no answer to any of the three,
however good the prose was.

**The answer is not to turn this file into a compliance manual.** Its density is the reason
the whole programme is tractable, and a document rewritten for an auditor is a document the
people who need it stop reading. So what landed is a control *layer* over documents left
exactly as they are: an owner and a review period per document, an approval that names
somebody, and a check that fails the repo when a review is overdue. The change history is
already in git, and `history()` reads it rather than transcribing it into a table nobody
maintains — the one thing a hand-kept revision table reliably records is the revisions
somebody remembered to write down.

**An entry is a document, not a file.** `path` plus an optional `section`, because this file
is several documents in one and the ones that matter here are sections of it. Naming the
section makes the ownership real — rename the heading and the check says so, by name —
without splitting a file whose density is its whole value. It is also what lets the register
carry a document that is not about code at all: the AI policy, the scope statement, the
interested-parties register and the roles table are four more entries in the same shape, and
none of them is a source file.

**This check will one day fail with no diff behind it, and that is the control operating.**
[A check that has silently not passed for a month](#npm-run-checks--the-browser-half-and-why-npm-test-can-still-see-it-rot)
is worse than no check, and an overdue document review is that same failure with a longer
fuse — worse in one specific way, because *nothing about a stale document looks stale*. It
reads exactly as well on the day it stops being true as it did the day it was approved. Only
a date and something willing to fail on it can find one. Two things make that failure
something to act on rather than route around: it warns for a month before it insists, and
the message says what a review is — read it, change what is no longer true, bump the
version, *then* move the date. In that order, because moving the date alone passes the check
and is the one way to make the register lie.

**Approvals name people, and the register refuses to invent one.** Today the owner and the
approver are the same person, because this install has one operator. That is a fact about
beadcause rather than a claim about segregation of duties, and the formal roles arrive with
the legal entity and the top-management appointment. What the file will not do in the
meantime is write down an approval nobody gave, which is worse than an approval nobody has
recorded.

`test/documents.mjs` proves the rules rather than running them: pointed at a clock two years
on, every entry reports overdue with its owner named; pointed at a deliberately broken entry,
every field rule fires. A rule only ever run against a register that passes is a rule nobody
has seen fail.

### Every third party is named, and a sweep fails on one that is not — `lib/suppliers.js`, `test/suppliers.mjs`

The auditable question about a supplier is always the same four: **what is sent, why, under
what terms, and when was that last looked at.** Before this, the only way to answer any of
them was to read `lib/notify.js`, `lib/confluence.js`, `lib/atlassian.js`, `lib/auth.js`,
`lib/slack.js` and `lib/team.js` and add it up — and what you got was a snapshot of the day
you did it, with no way to tell whether an eighth supplier had arrived since.

**The register is the boring half. The enforcement is the point.**
[`npm run secrets`](integrations.md#where-the-two-secrets-live-and-how-to-rotate-them) is the precedent and
it makes the argument: a guard is a promise about the future, and the honest question is the
one asked of what is already there. So the sweep reads `lib/` and `bin/` for outbound hosts
and for the commands that are actually executed, and fails the repo on one no supplier
claims. A new integration cannot ship without its supplier entry, which is the control
operating rather than being described.

**Anthropic is not a host, and that finding is what shaped the file.** A sweep for `https://`
finds Google, GitHub, Tailscale, ntfy, Slack and Atlassian, and does not find Anthropic —
because nothing here ever calls an Anthropic URL. Every agent is a `claude -p` subprocess. So
the largest egress in the system by a wide margin is a *command*, and a URL-only sweep would
have reported a clean tree while prompt text, bead content, whole source files and the
occasional screenshot left the machine. Hence two axes. And hence commands matched by
execution shape rather than by word: this repo writes prose inside template literals, so a
sweep for the bare token `claude` finds fifteen files that are mostly just explaining what a
session is.

**What it deliberately cannot see** is a binary resolved through a variable — `lib/bd.js` and
`lib/tailnet.js` execute a path they computed, so there is no literal to find. Both are
registered by hand, which is why a *declared* command need not appear in the source while an
*executed* one must be declared: the enforcement runs in the direction that catches a new
supplier, and the direction that would catch a supplier that has gone is left to the review
date. Interpolated hosts are dropped for the same reason an interpolated selector is, and
suppliers reached at a hostname the operator configures are registered as a suffix pattern
instead. `test/` and `scripts/` are out of the sweep: both are full of fixture hostnames, and
sweeping them in would mean either registering `evil.example` as a supplier or an exemption
list longer than the register.

**Every entry says its terms are unconfirmed, and that is the register working rather than
failing.** What each entry states from the code — what is sent, by which module, and why — is
verifiable here and is most of what an auditor wants. What the code cannot state is the
retention and training terms *in force*, which depend on which account and which plan the
traffic runs under and change without telling anybody. So each entry carries a gap naming the
bead that will read the agreements and transcribe them, and a register that guessed instead
would read identically and be worse than nothing. Anthropic's entry is the one that matters
most and is reviewed twice as often as the rest for that reason alone.

Two exemptions, each closed rather than left as a hole. The operating system's own binaries
are exempt structurally — `/bin/zsh` runs a shell, `/usr/bin/osascript` drives iTerm, and
naming them one at a time would be a list of sentences all saying "macOS" — but a binary
whose *name* is one that reaches the network is egress wherever it was found, because
`/usr/bin/curl` lives in exactly the same directory as `/usr/bin/id`. And the register itself
is kept out of its own sweep, since every link to a supplier's terms is a host it would
otherwise report; that exemption is safe only while the file stays data, so its import list
is pinned by the suite. Anything that could make a request has to come through there first.

### Every store says where it came from and when it goes — `lib/datastores.js`, `test/datastores.mjs`

Three registers already answer three different questions.
[The evidence register](#nothing-is-kept-without-saying-for-how-long--libevidencejs-testevidencemjs)
is keyed on what is *kept* — retention, integrity, who could alter it. The access register is
keyed on *principals* — the grants that let a human, a device or an agent reach the system at
all. [The supplier register](#every-third-party-is-named-and-a-sweep-fails-on-one-that-is-not--libsuppliersjs-testsuppliersmjs)
is keyed on *third parties* and stops at the boundary. **None of the three answers the five
questions Annex A.7 asks of a body of data**: where it came from, what it is used for, whether
it is adequate for that use, who can reach it, and when it is disposed of.

**So the fourth register's first job is to not become a fourth format.** It cites the other
three rather than restating them — an evidence class by id, a supplier by id — and the
coverage check fails the repo on a citation that resolves to nothing, on an evidence class
nobody here classified, and on the specific failure a fourth register is most likely to
produce: **a retention period that disagrees with the register that already stated one.** Two
documents disagreeing about how long one store lives is worse than either answer, and the
suite demonstrates that failure rather than asserting it cannot happen.

**The coverage baseline is the evidence register rather than the filesystem**, and that is the
choice worth defending. A sweep of `lib/` finds *modules*; what this register is about is
*bodies of data*, and the inventory of those already exists one file over. So a new evidence
class cannot land without somebody saying here whether it holds data about a person — which is
exactly the question that otherwise gets answered once, at the start, and never again. Eight
classes are excused into `NOT_SUBJECT` with a sentence each, because they record the daemon
acting rather than anything it holds: a chain of digests, a set of shas, a config key that
changed. An exemption for a class that is not there is itself a failure.

**Personal data is located rather than denied, and the instinct to deny it is wrong in four
places.** A bead names a colleague, an ingested ticket carries its reporter and often a
customer, and a close reason quotes either — the largest concentration of it in the system,
and it is in the *tracker*, which is not beadcause's own store, which is precisely why no
register had it until this one. A screenshot carries whatever was on the screen, including the
window nobody meant to capture, and it leaves as prompt content. An agent memory about how the
operator likes work shaped is a statement about an identified individual, kept on purpose and
readable by every agent kind. And the git identity — a name and an email — authors every commit
in every ref, which is said once rather than repeated into fifteen fields that would then have
to be kept agreeing. `personal.state` is a closed vocabulary of three and `none` is not a
blank: a store claiming to hold none has to argue for it in a sentence somebody can disagree
with.

**Most of the answers are `permanent`, and that is a decision rather than a gap.** The disposal
unit of a hash chain is the whole ref — removing the middle rewrites every sha after it, which
is the property the chain exists for.
[The run archive](#the-run-that-survives-its-own-reset--libagentarchivejs-testagentarchivemjs)
found the one way out and it is a *split*: the record is chained and permanent, the body is a
file beside it and is deleted at two years, and the deletion is itself a commit on the chain.
That is available only where the two halves can be separated, and **they cannot be separated
for a memory** — a memory *is* its body, so disposing of it leaves nothing saying a belief was
ever held, and it explains session transcripts that are themselves permanent. What governs a
store that never forgets is therefore what may be *written* to it and who may *read* it, both
of which every entry now states outright, with disposal as a deliberate act against a named
bead rather than a sweep. That closes the two "bc-eqn1.10 will decide this" sentences the
evidence register had been carrying.

**The contentless push is the one part of the file that is not a description.** A workspace in
`ntfy.minimalWorkspaces`, or in a space set to `ntfyDetail: "minimal"`, has always got a
notification with no question text, no option labels, no reply and no buttons — a nudge you tap
through to the tailnet — because an `ntfy.sh` topic is a shared secret on a public relay and
anybody who guesses the name receives the messages. That was a *feature*: nothing failed if it
stopped working. `test/datastores.mjs` drives **every** exported `push*` in `lib/notify.js`
against a minimal workspace with loaded fixtures and a stubbed `fetch`, and the published body
must carry none of the text — then drives the same call against a `full` workspace, which must
carry it, because a test that passes against a function that has silently stopped saying
anything is a test of nothing. The list of pushers is read from the module's own exports, so a
new notification cannot ship without being covered.

**And it states its limit instead of overclaiming.** The deep link *has* to name the workspace
and the bead or the tap lands nowhere, so minimal conceals what is being asked and not that
something is being asked in a named repo; the tailnet hostname is the click target of every
push regardless; the priority still tracks the bead's; and `Beadcause · asked again` is a
permitted title, because giving the same answer twice from a lock screen is a real failure
while the fact of a repeat leaks nothing. `LINK_ONLY` is that limit written as a rule, and the
suite fails if a bead id ever migrates out of the click URL and into a title or a message.

The register is itself
[a controlled document](#every-document-has-an-owner-and-a-review-date--libdocumentsjs-testdocumentsmjs)
with an owner and a twelve-month review, for the reason its own entries give: the wrong kind of
wrong sentence here — "this store holds no personal data" — reads exactly as well after the
store starts holding some. The coverage check catches a new store; only a date catches a store
whose contents changed under a sentence that was true when it was written.

### Fifteen policies, each with an owner and a date it expires — `lib/policies.js`, `test/policies.mjs`

A SOC 2 engagement opens with a request list, and it is close to identical between firms:
information security, access control, change management, risk assessment, vendor
management, incident response, business continuity and disaster recovery, data
classification and handling, acceptable use, secure development, encryption, logging and
monitoring, physical security, HR security, and a code of conduct. **The auditor's test is
rarely the content.** It is the approval record and the review date, and the exception
written up more often than any other is a policy last reviewed before the observation
period began.

So this is a register of fifteen documents rather than fifteen documents. It reuses
[`lib/documents.js`](#every-document-has-an-owner-and-a-review-date--libdocumentsjs-testdocumentsmjs)
outright — the review period, the ceiling on it, the warning a month out, the state that
expires — because a second definition of *overdue* is how two registers come to disagree
about the same date.

**The criteria mapping is the load-bearing half.** Each entry names the SOC 2 criteria it
is the documented answer for, and the suite refuses the two failures fieldwork finds
first: a policy naming a criterion that does not exist, and — the one that reads as
coverage — a criterion no policy claims. Fifteen current documents with CC7.2 in none of
them is a gap nobody is looking for, because every individual document is fine. All 38
criteria in the elected categories are claimed today, and 23 are exempt because
processing integrity and privacy are not elected. Electing one more category is *meant* to
turn this red until the set grows to meet it.

**No entry names an ISO 27001 or 42001 control, and that is not an omission.** The corpus
already declares the crosswalk, so `alsoServes` walks it: a policy claiming `SOC2.CC6.1`
is documented information for whichever Annex A controls satisfy CC6.1, computed when
asked. One source, two renderings — a second mapping maintained by hand is how a policy
comes to be cited for a 27001 control it stopped covering a year ago. The resolution is a
guarded import in the suite, so it starts working the moment `lib/controls.js` lands
rather than when somebody remembers.

**Not one of the fifteen exists, and `owed` is the honest state for all of them.** Writing
owners and approval dates anyway would produce a register that passes every check and is
false in the only way that matters, so an owed entry carries no approval fields at all and
the rules enforce that in both directions: an adopted policy with no approver is refused,
and an owed one carrying an approval date is refused just as hard. What an owed entry does
carry is the role that has to own it, the cadence already decided, and `enforcedBy` — the
modules here that already make its substance true. **A policy written but not operating is
the common exception; this install has the inverse.** Nine of fifteen have something
running: the endorsement gate and the merge queue for change management, `lib/incident.js`
for incident response, [the supplier
register](#every-third-party-is-named-and-a-sweep-fails-on-one-that-is-not--libsuppliersjs-testsuppliersmjs)
for vendor management. Six have neither a document nor an enforcement, and the register
names them rather than averaging them away — risk assessment is the largest, because CC3
is tested by asking to see the current assessment and the one before it.

Whose policies: the service organisation's — the configured compliance subject's
(`compliance.subjects`, loaded by `lib/boundary.js`), so the set belongs to that
organisation rather than to this daemon. `heldBy()` answers it and has **no default**: with
no subject configured it is `null`, and a policy set attributed to nobody is truer than one
attributed to an organisation nobody named. The fifteen entries are the request list every
firm sends, not any one organisation's data, which is why they stay here while the subject
is supplied by the organisation's own repository. The register itself is a controlled
document in `lib/documents.js`, on twelve months, and what is approved there is the register
— by the owner of this repository — and not the fifteen documents it tracks.

### Eight risks, each with an owner, a treatment and a date it expires — `lib/risk.js`, `test/risk.mjs`

Clause 6.1.2 of ISO/IEC 42001 does not ask for a list of risks. It asks for a *process*:
criteria saying what counts as acceptable, written down **before** anything is rated
against them, then identification, analysis, evaluation, and 6.1.3's treatment — with the
residual left over accepted by somebody, by name. A register produced without the criteria
is a page of worries, and an auditor asks for the date on the criteria for exactly that
reason: criteria written afterwards are criteria drawn around the answers.

Most of the register already existed. A risk here *is* a bead — an owner, work that treats
it, a date to look again — and the tracker holds those three far better than a file would.
What it cannot hold is the vocabulary. A likelihood spelled two ways is two likelihoods,
an "acceptable" that means whatever the reader thinks is not a criterion, and a treatment
naming a control nobody minted treats nothing. So this module holds the method, the
criteria and the ratings, and cites the tracker where the work lives.

**The chain is the point: risk → control → evidence.** Every risk names the 42001 controls
it selects, the modules here that make the treatment real today, and the classes of record
from [the evidence
register](#nothing-is-kept-without-saying-for-how-long--libevidencejs-testevidencemjs)
that an auditor could sample to see it operating. `chain()` returns the three together,
which is what makes a Statement of Applicability *generatable* rather than argued —
`bc-eqn1.14` reads `controlsClaimed()` and gets, for every control, the risks that selected
it and the records that would show it working. An SoA whose justification column was typed
by hand is one nobody can re-derive next year.

**The ids are 42001's, and that is the opposite direction to the policy set.**
[`lib/policies.js`](#fifteen-policies-each-with-an-owner-and-a-date-it-expires--libpoliciesjs-testpoliciesmjs)
names SOC 2 criteria because a policy set answers a SOC 2 request list. Annex A of 42001 is
a list of *treatments* and exists to be selected from, so a risk names 42001 ids and the
SOC 2 half is walked off [the
corpus](compliance.md#the-control-corpus--six-standards-in-one-closed-vocabulary) by `alsoServes`. That
is `bc-4r10.8`'s whole argument — CC3 and CC9 read off this one register rather than growing
a second — and the suite greps the two data blocks to make sure no SOC 2 or 27001 id was
ever written into them by hand.

**Five likelihoods by five consequences, and the multiplication is a sort key rather than
arithmetic.** "Possible × major" is not a number of dollars and two risks scoring 12 are
not interchangeable; what the product buys is a stable order and a threshold that could be
written down before the ratings were. The scales are anchored on something observable — a
likelihood on this daemon's year, a consequence on what the consequence *is* — because this
organisation has no loss figures and a dollar band would be the most quotable false thing in
the file. Every one of the twenty-five scores lands in exactly one band, and the suite walks
all of them to prove it.

**Harm to whom is rated separately, which is ISO/IEC 23894's distinctive demand.** A
register that scores every risk by its cost to the organisation is the register 23894 exists
to refuse, so `harmTo` is a closed set — the organisation, individuals, society — and a
consequence to individuals is never netted off against a benefit to the organisation. Most
of this register is organisational, and the criteria say so out loud rather than leaving the
imbalance to look like an oversight: it is a development tool run by one person on one Mac,
and the three things that would change that are named as a re-rating of the whole register
rather than an entry appended to it.

**Nothing is accepted yet, and that is the honest state.** Seven of the eight residuals sit
above the acceptable band and every one of them records that its acceptance is still owed,
with a sentence saying what is missing. Writing an acceptor and a date anyway would produce
a register that passes every check and is false in the one way that matters — the refusal
`lib/policies.js` makes about fifteen unwritten policies, and `lib/documents.js` makes about
an approver nobody asked. The rules bite in both directions: an accepted risk with no
acceptor is refused, and an owed one carrying a date is refused just as hard. Who may sign
is the criteria's answer, not the entry's — a medium residual is the AI system owner's, a
high one top management's, and a critical residual may not be retained at all.

**The eight process steps are 23894's own, and a missing one fails by name.** `METHOD` is
written as the standard's list rather than as whatever this system happens to do, because
the value of it is that a step nobody performs shows up as an empty one. Three of the eight
admit to a gap today: nobody is consulted on a rating because there is nobody to consult,
identification happened once and nothing prompts it again, and review is on a clock rather
than on a trigger — nothing re-rates a risk because the code that treated it changed.

The register is itself a controlled document in `lib/documents.js`, on six months rather
than twelve, because a rating is a statement about a system on the day it was made and this
one changes daily. What is approved there is the method and the register; not the residuals,
every one of which separately says its acceptance is owed.

### Service commitments, owed until somebody reads the agreement — `lib/commitments.js`, `test/commitments.mjs`

DC 200 asks a system description to state the principal service commitments the service
organisation made its user entities — availability, confidentiality, processing and
privacy promises — and the system requirements those promises impose. **The commitment is
not the control.** A control that keeps a promise is evidence the promise is kept; it is
not the promise, and a subject's gap assessment will usually say so against `SOC2.CC2.3`:
"a system description cannot state service commitments that nobody has read out of a
contract." The executed agreements are not in this repository.

So `lib/commitments.js` is the engine for a register of commitment *categories* —
availability and confidentiality, the two DC 200 categories this election covers — and the
entries themselves are the subject's (`commitments` in the file `compliance.subjects`
names). Each is owed to user entities **by the ids [the subject's
boundary](compliance.md#the-system-boundary-as-data--beadcause-boundary) gives them**, read
out of that boundary rather than restated, so a commitment owed to an entity the boundary
never named is refused; and each is measured against the criteria it bears on. With no
subject there are no commitments and nobody holds them. A category stays `owed` for the
same reason the fifteen policies do: writing plausible SLA numbers in would produce a
register that passes every check and describes a promise nobody made. It reuses
`lib/policies.js`'s exact split —
`ADOPTION_FIELDS` absent on an owed entry, refused on it if present, required on an adopted
one — for the same reason `lib/policies.js` gives: the dangerous failure is not the missing
approval, it is the one that reads as though somebody had given it.

**It feeds [the description](compliance.md#the-system-description-generated--beadcause-description)'s
supplied-record seam, and only from the CLI.** `suppliable` hands back only the categories
that are actually `adopted`, in the exact shape `lib/systemdescription.js` wants — an owed
category contributes nothing, which is the honest answer for a promise nobody has read out
loud yet. `bin/description.js` is what assembles it, not `lib/systemdescription.js` itself:
its import list is pinned to three files in its own suite, and this stays a fourth leaf
rather than a fourth import. It also runs the register's checks against the subject before
rendering anything, and refuses — every problem named — a subject whose commitments fail
them. While every category is owed, `beadcause-description sections` shows `commitments` as
`unavailable` and the assertion draft lists it among the reasons it may not be signed — the
seam is built and wired; reading the actual
agreements and transcribing what they say is a separate piece of work, because it is a fact
about a contract and not a fact this repository can derive.

### Two branches that renumber the wizard merge clean — `test/wizardnumbers.mjs`

The setup wizard numbers its questions in the prose of each heading —
`bold('7. Push notifications')` — rather than deriving them from position. That is a
readable way to write a linear script and a **silent merge hazard**, and the difference
matters because the thing it breaks is not a line anybody edited.

Two branches that each insert a question in a *different region* of
`scripts/configure.js` do not touch each other's lines. Git has nothing to conflict over,
so it merges them clean and produces a wizard that asks two questions with the same
number and skips one entirely. Not hypothetical: resolving #264 on 2026-08-14, one branch
had inserted a new question 1 and shifted every later number by one while another had
inserted Confluence before sign-in. The merge was clean, the result printed two "12." and
no "14.", and the suite was 212 of 213 green over it — because nothing asserted the
headings at all. `test/team.mjs` reads question 3's *default*, and `test/confluencesetup.mjs`
and `test/signinsetup.mjs` each pass a heading of their own in, so neither ever sees what
`configure.js` actually hands those modules. It was caught by a person reading the merge,
which is not a mechanism. The same defect had already survived a whole worker session and
its review on the branch beforehand.

**Both shapes, or it misses the case that bit.** Most of the numbers are inline `bold('N. …')`
calls; the last two are `heading: 'N. …'` strings passed *into* `lib/confluencesetup.js` and
`lib/signinsetup.js`. Those two modules take the number from the caller deliberately — a
question in another file that counts itself is a duplicate the first time somebody inserts
one back in the wizard — so the numbering has exactly one source, and a check reading only
the inline calls would have been green over the merge that started this. The suite reads
both, and separately asserts the number still *reaches* those calls, since a `heading:`
that stopped being passed would leave the count here intact while the wizard printed the
modules' unnumbered defaults.

It also pins the order: the numbers ascend as the questions are asked, sign-in is last and
Confluence is second to last. Those placements are argued for in source comments — they are
the two questions that take a credential, so both prompts with the echo turned off are the
last thing setup does rather than one being buried mid-wizard — and this file is what makes
moving them a decision rather than a tidy-up.

**It reads the file rather than driving the wizard**, on purpose. The numbering is a property
of the source, and driving `configure.js` needs a real pty and one `expect` block per question
— far too expensive to run unconditionally, for an answer no better. Reading costs milliseconds,
so it runs every time, which is the whole point: the failure here is nobody remembering to look.
Comments are blanked before the scan, for
[the reason every static read in this repo blanks them](#nothing-is-kept-without-saying-for-how-long--libevidencejs-testevidencemjs)
— every file here argues in prose that quotes the code beside it, and an unblanked scan of
`configure.js` with two such comments in it reported a duplicate and a phantom question 99,
both invented entirely out of documentation.

What it does not claim: nothing about a heading added with *no* number, since `bold(…)` also
draws things that are not questions; and nothing about the comments inside `configure.js` that
name a question by number, `lib/reposcan.js`'s doc comment that names one, or the sentences in
this file that do — those are prose, and a renumber still owes them a `grep -rn 'question [0-9]'`
and a look for the ordinals. It claims the one thing a clean merge can break with nobody
seeing it.

### Two greps that answer the wrong question — `test/grepargs.mjs`

There are two `grep` hazards on this laptop. One is a defect in every script that writes
it and this suite keeps it out of the repo; the other cannot be caught by any check at
all, because it happens to greps an *agent* types rather than greps anybody committed.
They are unrelated, and it matters not to confuse them, because the fix for one is not
the fix for the other.

**The one that is checked: an option after the `--` is a filename.** `--` ends option
parsing — POSIX Utility Syntax Guideline 10 — so in

```bash
# grep -rlq -- "$name" "$dir" --exclude-dir=archive   ← searches archive/ anyway
```

(commented out on purpose: `test/grepargs.mjs` sweeps fenced commands in this file too,
and skips comment lines precisely so that quoting the bug in order to explain it is not
itself a finding.)

`--exclude-dir=archive` is a *file* grep is asked to search. It does not exist, grep
warns on a stderr that a script gating on the exit status has behind `2>/dev/null`, and
the exclusion never happens — which is always the permissive direction. That was bc-uytt:
the `ship` skill's attic sweep asked whether any handoff still mentioned a retired
worktree, with exactly that line, and `archive/` — spent handoffs, excluded by definition
— was searched every time. Every spent handoff went on protecting its attic entry from
removal, forever, and no output ever hinted at it.

This is **not** a ugrep quirk, and getting that wrong decides which call sites are bugs.
Options written *after* the paths are honoured — measured, by ugrep 7.5 and by macOS BSD
grep alike, and `grep -rl "n" dir --exclude-dir=archive` excludes correctly on both. Only
`--` breaks it, and `--` breaks it everywhere, GNU grep included: it is the one part of
the syntax every implementation is required to agree on. So the fix is never "move the
flag earlier because of ugrep" — it is "the `--` is in the wrong place", and the same
line on a GNU box was equally broken. `test/grepargs.mjs` flags a grep only when an
option-shaped word follows a `--` in the same command, and leaves options-after-paths
alone, because flagging those would be a rule that makes working lines look broken. It
sweeps shell scripts *and* fenced commands in tracked markdown — an agent copies a fenced
command verbatim, which makes a wrong one in a skill or a doc every bit as live as a wrong
one in a script — and `node test/grepargs.mjs --dir ~/.claude` points the same sweep at a
tree outside the repo, which is how `~/.claude` was checked.

**The one that cannot be: ugrep silently answers zero.** Inside a Claude Code Bash call
`grep` is a shell function wrapping ugrep 7.5 — a shell function, so it does *not* survive
into `bash prune-retired.sh`, and scripts here get `/usr/bin/grep`. Only what an agent
types itself is ugrep. And ugrep 7.5 drops **every** match for an ERE that alternates `^`
with a negated character class when the literal after it is four characters or longer.
No error, no warning, exit 1 — indistinguishable from "there are no hits". Measured
against `lib/attic.js`, which has three:

```bash
grep -c -E '(^|[^a-z])gre'  lib/attic.js    # ugrep 3   /usr/bin/grep 3   agrees
grep -c -E '(^|[^a-z])grep' lib/attic.js    # ugrep 0   /usr/bin/grep 3   WRONG
grep -c -E '([^a-z]|^)grep' lib/attic.js    # ugrep 0   /usr/bin/grep 3   WRONG
```

Three characters is fine and four is not, which points at ugrep's literal-prefix skip
mishandling the anchored branch of the alternation. `(x|[^a-z])grep` is fine, and so is
`^` alternated with a *positive* class: it needs `^` against a **negated** class,
plus a literal of four characters or more.

That shape is exactly what a session reaches for to find call sites — "the word, not
preceded by a dot or a dash" — so a zero reads as *there are no call sites*. It cost a
survey during bc-2mpr that returned **0** grep call sites in a tree with **41**, and the
only reason anyone noticed was that a plainer search of the same tree disagreed. Nothing
static can catch this: the offending command is never written down anywhere, it is typed
into a Bash call and its output believed. So the defence is the rule, here, where a
session reading this file will meet it — **use `-P` or `\b` for that shape, and treat a
zero from any `(^|…)` pattern as suspect until a second, plainer search agrees.** That is
bc-0p49, and the acceptance it was filed with was a documented rule or nothing.

### A teardown must not be able to fail a run — `test/helpers/tmp.mjs`

Nearly every suite here ends the same way: make a temp directory at the top, point
`BEADCAUSE_CONFIG_DIR` at it, and `fs.rmSync(tmp, { recursive: true, force: true })` at
the bottom. That last line is a claim the suite cannot support — that nothing is still
writing under `tmp` — and it is false whenever the code under test spawned something.
Here that something is git.

The path is short and entirely ordinary. A write of `advocates.json` calls `snapshot()`
in lib/commonrepo.js, which schedules a commit **2000ms later**; the commit calls
`ensureRepo()`, which runs `git init` in `CONFIG_DIR`; and under test `CONFIG_DIR` *is*
the scratch directory. `test/dedupe.mjs` takes about 1600ms, so on a quiet laptop the
timer never fires at all and on a loaded one it fires with a few hundred milliseconds to
spare — and then `git init` is laying down `.git/hooks/*.sample` while `rmSync` walks the
same tree. `rmdir` on a directory that gained a file since it was read is `ENOTEMPTY`:

```
  26/26 ok
  Error: ENOTEMPTY: directory not empty, rmdir '…/beadcause-dedupe-Purxog/config/.git/hooks'
```

`force: true` is no help and reads as though it should be. `force` means *a path that is
not there is not an error* — it is about ENOENT, and this is the opposite problem: a path
that is more there than it was a moment ago. The depth in the message moves between runs,
`config/.git` on one and `config/.git/hooks` on the next, which is the tell for a racing
writer rather than a leftover.

**What it costs is out of all proportion to what it is.** `scripts/test.mjs` stops at the
first non-zero exit, so a scratch directory nobody was asserting anything about halted the
gate at suite 32 of 105 and the 73 after it never ran — with a green run either side. Its
own checks had all passed, so it reads as a regression in the one thing it is not, and the
honest diagnosis ("re-run it alone") is the same sentence as the dishonest one.

So teardown is a helper, `test/helpers/tmp.mjs`, in two halves that fix different things:

| | |
|---|---|
| `quiesce()` | The real fix. Flushes the common repo's pending snapshot and awaits the commit, so there is no git child left to race. Belongs in any suite whose scratch directory is `BEADCAUSE_CONFIG_DIR`. |
| `removeTree()` | The backstop, for what `quiesce` cannot know about — a helper that shells out, a daemon still shutting down, Spotlight. Retries the removal, and when it still cannot, **warns and returns `false`**. |
| `removeTreeSync()` | The same retry for a teardown that cannot await: `process.on('exit', …)`, or the synchronous `done(code)` before `process.exit`. Blocks on `Atomics.wait`, because a timer would never run there. |
| `cleanupTmp(dir)` | The two in the order that matters. One line, and the one to reach for: `await cleanupTmp(tmp)`. |

That `removeTree` warns rather than throws is the point rather than a softness. A suite's
exit code should say what its assertions said; a few kilobytes under `os.tmpdir()` that
survive are something the OS clears, not a regression, and a teardown that can turn a
green suite red is the bug being fixed.

`flush()` in lib/commonrepo.js had to change with it, because `quiesce` is only worth
anything if `flush` tells the truth. Both states are reachable at once — the timer fires,
its commit is a few git subprocesses long, and a write during that window schedules
another — and `flush` used to *overwrite* the in-flight commit with the new one and return
only the new one. So it resolved while the first commit was still running, which is
exactly the claim the removal then leans on; and two `commit()` calls on one repo race
each other's index, which is `git add -A` twice over and `index.lock` already exists. The
pending commit is now chained onto the running one.

`node test/tmpteardown.mjs` (part of `npm test`) covers it, and the check that earns the
rest is the control: right after a snapshot is scheduled the repo is *not* on disk, and
after `quiesce()` it is. Without that half, an assertion that the directory ends up gone
would pass against a `quiesce()` that did nothing. Filed as bc-5uy8; bc-3qsw, bc-r87b,
bc-t69u and bc-94c6 are the same failure in `reap.mjs`, `superseded.mjs`, `slowstart.mjs`
and `outagepush.mjs`, and each is a two-line change now that the helper exists.

**One of the four was not two lines, and the difference is worth keeping.**
`test/outagepush.mjs` runs a real router, and a router is a supervisor: it has backends
of its own, and they hold the same scratch directory as their `BEADCAUSE_CONFIG_DIR`.
Its teardown killed that router and removed the directory on the next line — but
`kill()` only queues a signal, so the removal was racing a process that had not been
told yet, let alone gone. That is bc-94c6, and its title is the whole of it: **SIGKILL is
not a wait.** `removeTree`'s retry loop hides it, and hiding it is not the same as not
having it — a suite that needs ten attempts and a second and a half of backoff to take
its own directory away is one that never waited for the thing writing into it.

So that suite reaps before it removes: SIGTERM, then `once('exit')`, which resolves when
the child has actually been reaped, with a SIGKILL five seconds later for a router that
will not go. SIGTERM rather than SIGKILL because it is the only signal the router can act
on — `shutdown` in bin/router.js stops the backends first — so one wait covers the
grandchildren too, and the retry loop goes back to being the backstop it is meant to be.
The teardown also moved out of the `process.on('exit')` handler and below the `catch`,
because an exit handler is precisely where waiting is impossible; what stays behind there
is `removeTreeSync` for the exits that never reach it.

#### Why the helper was the easy half — `test/tmpadoption.mjs`

Writing `cleanupTmp` fixed one suite. Adoption then sat at two files for a day while
sixty-eight others kept the line that loses, and this one bug was filed eight separate
times: bc-5uy8 for `dedupe.mjs`, then bc-3qsw, bc-r87b, bc-t69u, bc-94c6, bc-qjsx, bc-mc4q
and bc-b495 as it surfaced in `reap.mjs`, `superseded.mjs`, `slowstart.mjs`,
`outagepush.mjs`, `twinqueue.mjs` and `epicqueue.mjs`. Each was diagnosed from the stack
by somebody who could not tell, from anything in the tree, that sixty-odd other suites
still carried the same two lines. **A fix nothing can see the absence of gets refiled
rather than finished**, and each refiling cost a session the four minutes to re-run a
gate plus the argument about whether the red was theirs.

So the sweep went in as one change — sixty-eight suites mechanically, `epicqueue.mjs` by
hand, because it clears the config dir between *every* case rather than once at the end —
and `test/tmpadoption.mjs` keeps it swept: any suite naming `BEADCAUSE_CONFIG_DIR` that
removes its scratch root with a bare recursive `fs.rmSync` fails the repo, with the file,
the line and which helper it wants. The sixty-ninth suite is the one that matters, and it
will be written next month by someone copying the suite next to it, which is precisely how
every one of these got the line to begin with.

It took nine days rather than a month. `test/confluenceread.mjs` landed with the bare
`rmSync` beside it, `main` went red on the check, and the whole of the diagnosis was the
first line of output: the file, the line number, and which of the three helpers that site
wants. The value of the check is not that it caught something — a ninth bead would have
caught it too, eventually, from a stack trace, in somebody's four-minute gate. It is that
the ninth bead never had to be written.

Three details it takes care to get right, each of which flagged something wrong on the
first run:

- **A child's env counts.** Seven suites never set `BEADCAUSE_CONFIG_DIR` on themselves at
  all — they hand it to a spawned process in `{ ...process.env, BEADCAUSE_CONFIG_DIR: dir }`.
  The commit is scheduled in the child, the parent's `rmSync` races it just the same, and a
  scan keyed on `process.env.` alone would have called those seven clean. `slowstart.mjs`
  and `outagepush.mjs`, both already-filed instances, are in that group.
- **Which helper is the parser's call, not a regex's.** Thirteen of the sixty-eight remove
  their tree somewhere that cannot `await` — inside `process.on('exit', …)`, or the
  synchronous `done(code)` that runs just before `process.exit`. Those get
  `removeTreeSync`. The way to find them is not to pattern-match the enclosing function
  but to write `await`, ask `node --check`, and take a `SyntaxError` as the answer:
  *cannot await* is exactly the condition `removeTreeSync` exists for, so the compiler
  sorts the two cases with no judgement required.
- **A quotation is not a call site.** The scan's own header and `test/helpers/tmp.mjs`
  both quote the losing line in order to explain it, and the first run duly failed the
  repo for its documentation. Comment lines are skipped — `test/grepargs.mjs` skips them
  for the same reason and for the same two files. The alternative is a check whose easiest
  fix is deleting the explanation.

What it deliberately leaves alone is as much of the rule as what it flags. Removing a
single file cannot raise `ENOTEMPTY`; a fake-bin or spy directory holds no git repo; and
fifteen suites never remove their scratch root at all, which leaks a directory the OS
clears and, having no `rmdir` in it, cannot lose this race. Flagging any of those would be
a rule that makes working lines look broken, and a lint people learn to work around is
worse than none.

#### The removal that is not a teardown — the per-case `reset()`

The scan above looks for the scratch **root**, because that is where the losing line always
was. bc-9d37.9 is the same race in a place a teardown-shaped scan cannot see. `test/leasequeue.mjs`
went red on a gate run with the familiar `ENOTEMPTY` *after* all twenty of its checks had
printed `ok`, and the line was not at the bottom of the file:

```js
function reset() {
  const dir = process.env.BEADCAUSE_CONFIG_DIR;
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
}
```

`check()` calls that before **every** case. So it is the worse form rather than the milder
one: it races `git init` twenty times a run instead of once, and it removes the config
directory's contents one entry at a time — `.git` among them — which is a shape the root
scan matches nothing in. **Ten suites carried it**: `claimqueue`, `handlease`, `livequeue`,
`proposegate`, `prqueue`, `ranmodel`, `repoqueue`, `reposurvey`, `repotidy` and `twinqueue`.

It only bites once a suite runs past the 2000ms debounce, which is what makes it a trap
rather than a bug: every one of those ten was green, and each was one added case away from
an intermittent red whose own assertions all passed. That is exactly what happened —
bc-9otk added nine cases to `leasequeue.mjs`, it began failing about one run in eight, and
the half-hour it cost went on the wrong file, because a crash after "all 29 checks passed"
does not look like it belongs to the diff that added the checks.

The fix is the same helper and a different pair of doors: `await quiesce()` **once**, then
`await removeTree(…)` per entry. There is no root to hand `cleanupTmp`, and quiescing once
per case rather than once per entry is the whole saving — the flush is what removes the git
child, and the retries are only the backstop.

`test/tmpadoption.mjs` grew a second scan for it, and the judgement it has to make is which
children of the config directory matter. A child named by a **variable** came out of
`readdirSync` and therefore includes `.git`, so it is flagged. A child named by a **literal**
is a directory somebody chose — `test/signinsetup.mjs` throws away `config/tls`, which holds
no git repo and cannot lose this race — so it is not, with `.git` itself the one literal that
is. Getting that line wrong in either direction costs something real: too loose and a working
line in `signinsetup.mjs` fails the repo, too tight and the scan quietly matches nothing
forever. So the check asserts **both** — that the reset shape is still recognised, and that
the quiesced form the ten suites were moved to still passes. A guard that only ever says no
is one whose green is unfalsifiable, and the first legitimate edit it goes red on is the last
time anybody reads it.

### A suite must not assert about a directory it does not own — `test/browse.mjs`

The same shape as the teardown above, from the other side: not a suite whose cleanup
races something, but a suite whose *assertion* was about a directory other people write
to. `test/browse.mjs` proves that a browse deletes its throwaway profile, and it used to
prove it by listing every `beadcause-browse-*` entry in `os.tmpdir()` before the run and
asserting the listing came back identical. That reads as airtight and is not: `/tmp` is
shared by every session on this laptop, a dozen of which run at once, so **any other
agent that started a browse inside that window failed this suite** — over a directory
that was gone again by the time the diff was read, on a branch that touched neither
`lib/browse.js` nor `bin/beadcause-browse`.

It is suite ~17 of ~100 and the runner stops at the first failure, so it cost a
fifteen-minute gate each time, and the tell was buried in the diff: `actual` and
`expected` name a *different* profile id, meaning the run deleted its own and counted a
stranger's. It was filed four separate times — bc-60rr, bc-wcw3, bc-eldx, bc-ivb1 —
which is what a flake that blames whoever is reading it looks like from the outside.

The fix is that the live block makes a sandbox directory of its own and points `TMPDIR`
at it for the duration. Nothing is stubbed: `os.tmpdir()` is read on every call and
`makeProfile()` asks it every time, so the profiles are still made by the real
`makeProfile()`, and they are still under the system temp directory as far as
`assertThrowawayProfile` is concerned, because the sandbox is inside it. It cuts both
ways, which is the point — this run is no longer disturbed by other sessions, and no
longer disturbs them, since a sandbox not named `beadcause-browse-*` is invisible to
anyone listing the directory above it.

Owning the directory is also what lets the assertion get *stronger* rather than weaker.
The old check ran after the first browse only; there is now a second one at the end of
the block covering the four runs after it, including the 404 case, which throws — so its
profile path never comes back to be named, and its deletion happens in a `finally`
nothing was watching. Both are still `deepEqual`s against an empty listing rather than
"the one path it told us about is gone", so a future change that quietly makes a second
profile and reports one still fails.

### A port is not a number two runs may both pick — `test/helpers/net.mjs`

About twenty sessions run against this repo at once and every one of them runs `npm test`
before it delivers, so a port a suite *typed* is a port two runs bind at the same moment.
That failure does not read as a collision. `listen()` in lib/server.js exits when nothing
binds — correctly: a listener-less daemon whose poller still fires pushes is worse than a
dead one — so the run dies with an `EADDRINUSE` in the middle of whatever suite got there
first, at the exact moment a session is deciding whether its own work is safe to deliver.
It cost a full re-run and a filed bug (bc-szkq) before anybody recognised the message.

Nothing types a port any more. Two helpers, and the first is the one to reach for:

| | |
|---|---|
| `boundPort(servers)` | No window at all. The suite passes `port: 0`, the kernel picks, and the number is read back off the listener that is *already holding it*. `createApp` and `listen` hold the config object by reference, so a `baseUrl` that has to name the port is filled in on the line after — which is why a `baseUrl` is not a reason to reach for the other one. |
| `freePort()` | A probe on port 0, read, closed. For the two shapes where the number must exist before the server does: a `config.json` a *child* will read (`test/slowstart.mjs`, `test/outagepush.mjs`, `test/routercrash.mjs`, `scripts/test-swap.js`, `scripts/space-check.mjs`), and an OAuth `redirectUri`, which lib/auth.js reads back and compares (`test/auth.mjs`, `test/attribution.mjs` — both of which use `boundPort` for their sign-in-*off* daemon in the same file). |

`freePort` leaves a window between the close and the bind, and when what binds it is a
child process that window is tens of milliseconds, not one: node has to start and read a
config first. So the number it hands back is **claimed** — a file named after the port in
`/tmp/beadcause-ports/`, created with an exclusive `wx` write so that two runs
asking at the same instant produce one winner and one `EEXIST`, and containing the pid, so
a claim left behind by a run that was `SIGKILL`ed can be told from one in use and taken
over. The kernel still chooses the number, because it is the only thing that knows what
is really free; the claim only stops beadcause colliding with beadcause, which is the
collision this laptop has. It is not a reservation and it promises nothing about a
stranger binding the port, and a run that cannot find an unclaimed number in twenty tries
hands back a free one anyway — an improvement on this helper must not become a new way
for it to fail.

#### Why that path is not `os.tmpdir()` — bc-jvt0.8

It was, for as long as every run on the machine was the same Unix account. On macOS
`os.tmpdir()` reads `TMPDIR`, and launchd gives **each account** a private
`/var/folders/<hash>/T` — so "one directory per machine" and "one directory per user"
were the same sentence, and stopped being it the day CI moved onto this laptop under a
dedicated `ghrunner` account (bc-hkval, #105). A local `b7e-gate` as `you` and a CI
shard as `ghrunner` claimed into two trees that cannot see each other: between those two
the exclusive create was not exclusive at all, and bc-dw47's window was open again —
quietly, because claiming still worked perfectly against half the runs on the machine.

`/tmp` is the one path every account resolves the same way, and `BEADCAUSE_PORT_CLAIMS`
overrides it — for a machine where `/tmp` is not shared, and for a suite that wants a
claim root of its own to assert about. Sharing a directory between accounts costs three
things that never arose while there was only one:

| | |
|---|---|
| the directory must be writable by everybody | `mkdir` applies the creator's umask, so the mode is set explicitly by whichever run creates it. A directory somebody else made is left alone: the chmod would fail anyway, and it is either already usable or not ours to fix. |
| it must **not** be sticky | `/tmp` itself is `1777`, and sticky means only a file's owner may unlink it — which would disable the staleness backstop, whose whole job is unlinking *other* runs' claims. The bit is not inherited by a subdirectory, so `/tmp/beadcause-ports` at `0777` is unlink-by-anybody. |
| a claim must be readable by the run that finds it | An unreadable claim used to read as an abandoned one, so a live run's port would be taken from under it — the exact failure claiming exists to prevent. Claims are left `0666`, and a read refused for permission is now treated as "somebody has this". |

And one rule rather than a cost: a claim root that cannot be used is **not** an error.
`claimPort` answers false, `freePort` asks for another number and eventually hands back an
unclaimed one, exactly as it did before bc-dw47. A shared directory is a thing another
account can leave in a state this one cannot write, and that must not fail somebody's gate.

`test/ports.mjs` covers this the only way one process can: a child with a different
`TMPDIR` is, to this helper, precisely what a second Unix account is. The claimer takes a
number and the child is refused it — and the control beside it, a child pointed at its own
`BEADCAUSE_PORT_CLAIMS`, wins the same number, so the first check cannot be passing for
some reason other than the claim root. The scratch numbers those checks use are above
65535 and derived from the pid: they are names in the claim directory rather than ports
anything binds, and a directory shared by every account on the machine is no longer a
place to type 65000 and hope.

#### The daemon claims too — bc-jvt0.9

The claim code lives in `lib/portclaims.js`, and `test/helpers/net.mjs` re-exports it
under the names every suite already imports. It moved because a note only works if
*everybody who picks a port writes one*, and `bin/router.js` picks a port for every
backend it starts. It used to run a probe of its own and claim nothing, so a suite's
`freePort` could be handed the number the live daemon had probed and not yet bound — the
suite's child then exited on a lost port (`listen()` calls `process.exit(1)`), which
reads as a regression in whatever was under test (PR #82, `test/routerdrain.mjs`, an
`ECONNREFUSED` and not an `EADDRINUSE`) — and the daemon's probe could take a number a
suite had claimed. Now `spawnBackend` takes its port from the same claiming `freePort`
and holds the claim for exactly the interval it protects: from the probe until the
backend first answers `/internal/state` (a child that can answer has bound it, and from
there the kernel is the claim), or until the child is gone — `exit` *and* `error`,
because a child that could not be spawned emits only the second.

It is not held for the backend's life, deliberately. A bound port needs no note beside it
(a suite asking the kernel is never handed one), and a router lives for weeks and starts a
backend per release, so a claim per backend would be a file the two-hour backstop has to
age out. A claim that cannot be made — even by throwing — never fails a backend start:
the note is an improvement on the probe and not a precondition of it.

What it still cannot reach is a process that never writes a note: a stranger, or anything
that is not beadcause. `boundPort`, which hands over the listener rather than the number,
is what has no window against anybody at all, and is still the one to reach for.

`node test/ports.mjs` covers both halves, and the check that earns the rest spawns four
separate processes that each take twenty-five ports and hold them while the others are
still asking: one process can be made to agree with itself in memory, and the collision
that costs a session an hour is between two `npm test` runs. Filed as bc-dw47, which is
also where the router half above came from — the same race, one layer down.

### The other port two runs could both pick — `scripts/helpers/chrome.mjs`

The section above is about the ports the suites *listen* on, and it left one out. Every
browser check also opens a headless Chrome, and Chrome needs a DevTools port to be driven
over. That one was typed — not as a literal, which somebody would have noticed, but as
arithmetic on the process id, which reads like it was thought about:

```js
const port = 9700 + Math.floor(process.pid % 100);   // eleven checks
const port = 9600 + Math.floor(process.pid % 100);   // six
const port = 9800 + Math.floor(process.pid % 100);   // five
const port = 9600 + (process.pid % 300);             // scripts/shot.mjs
```

A hundred addresses per base, shared by eight agent sessions and by `npm run checks`,
which opens four Chromes at once on its own. Two pids congruent mod 100 collide, and that
is not a tail risk — it is one in a hundred per pair, on every run, forever.

**What made it expensive is that it does not fail like a port clash.** Chrome handed a
port already in use does not exit and does not complain; it simply never publishes a
target of its own. So the loser's `fetch('/json/list')` is answered by the *winner's*
Chrome, and the check attaches to a page belonging to a different session's daemon and
starts driving it. Every DOM assertion then fails and every assertion that reads
`config.json` off disk still passes, because that half never went near a browser. There
is no message anywhere saying a port was contended. What the reader sees is a check that
was green an hour ago failing on the page they just touched, with the on-disk half still
green — which is a very good imitation of "your change broke the page".

It cost three consecutive false failures of `space-check.mjs` against a five-line, wholly
innocent edit to `public/monitor.js`, and the thing that finally told them apart was
copying the script to a second filename: different pid, therefore different port,
identical code, green. Measured live at that moment, 9605, 9609, 9700, 9701, 9723, 9749,
9758, 9798 and 9874 were all held by other sessions' Chromes at once (bc-ev11).

**The fix is the one the fixture servers next door already made: ask for zero.**
`--remote-debugging-port=0` hands the choice to the kernel, so there is nothing to
collide with and nothing for anyone else to guess; Chrome writes the number it was given
into `DevToolsActivePort` in its profile directory, which is a `mkdtemp` made milliseconds
earlier and belongs to exactly one process. `lib/browse.js` has launched this way since it
was written, and this is that argument applied to the other thirty-two callers. It also
stops the repo publishing a predictable CDP endpoint on loopback — a debugging port will
open a tab for anybody who can reach it, which is part of why `lib/lookup.js` refuses
loopback in the first place.

That could have been thirty-two one-line edits. It is one file instead, because the
launcher was thirty-two copies of the same thirty-odd lines — a throwaway profile, the
same nine flags, a poll for the page target, a websocket, and a `close()` that takes it
all away again — and a bug that lives in thirty-two copies gets fixed thirty-two times or
not at all. `scripts/helpers/chrome.mjs` is now the only place any of them opens a
browser, `launchChrome('beadcause-warm-')` is the whole call site, and it hands back the
same `{ s, close }` the local copies did plus the `port` it actually got, which is worth
being able to print now that it is no longer derivable from the pid.

**And a Chrome that cannot start now says so.** With the port guessed there was no way to
tell "somebody has that port" from "Chrome is slow", so every failure took sixty polls and
came out as `Chrome never exposed a page target`. There is no contended-port case left,
but a moved install or a bad `CHROME_PATH` is still real: the spawn failure is caught and
reported as `Chrome would not start`, an exit during startup is reported as that, and
every path out — including the ones that throw — kills the process and asks for the
profile to be deleted. The old copies only cleaned up on success, which on a laptop that
runs these all night is how a temp directory fills with headless Chromes nobody can
account for. *Asking* for the delete turned out not to be the same as getting it, which is
the next section.

`node test/chromeport.mjs` is what keeps it. The fix is one line and reverting it is
invisible — nothing about a guessed port looks wrong in review, the failure it causes is
attributed to whatever else was in the diff, and a new check copied from an old sibling
would reintroduce it in silence. So the rule is asserted statically over the whole of
`scripts/` on every `npm test`: no file derives a port from its pid, no
`--remote-debugging-port` is a number, and nothing that passes `--headless` opens a
browser except through the shared launcher. Half of it is controls, for the reason
`test/checks.mjs` has controls — an audit that can no longer fire reports exactly what a
clean tree does — so the old line, a hardcoded port and the fixed shape are each fed to
the scan and its answer checked in both directions, including that the old line *quoted in
a comment* does not count, since the helper's own header quotes it at length. It launches
no browser: `npm test` does not depend on Chrome and this was not the suite to make it
one. The half that can be had without one is measured for real, by pointing the launcher
at a binary that does not exist and asserting on both the message and the absent profile
directory.

### Killing a browser is not the same as it being gone — `test/chromeprofile.mjs`

The section above ends by saying every path out of `launchChrome` kills the process and
deletes the profile. It did both, in that order, on consecutive lines — and the deletion
lost anyway, on the ordinary path, in a check that exited 0. Measured 2026-08-18: a
`gate-check.mjs` run that passed 20/20 took the temp directory from seven
`beadcause-gate-*` directories to eight, the oldest of the seven from the previous
morning. A census the same day found **798 leaked Chrome profiles** across forty-odd
check prefixes (bc-5e85).

**`kill()` is not a wait.** It returns once the signal is queued, and what it is queued
for is a tree — Chrome's renderer, GPU and crashpad children go on writing into the
profile for a moment after the browser process has taken it. `rmSync` on the next line
walks a directory that is being repopulated behind it, and there are two ways for that to
end, both of which were watched happening against a real Chrome: it throws `ENOTEMPTY`, or
it *succeeds against a directory that then comes straight back*. Neither says anything to
anybody. The check has already printed its results and exited 0.

`{ maxRetries: 3 }` looked like the answer to that and is not — it is `rmSync`'s own
internal retry of a **failed unlink**, so it cannot see the second shape at all. It was
removed rather than raised, and removing it made the teardown four times faster: the same
real teardown took 740ms with it and 190ms without, for the same outcome, because it backs
off inside a tree walk that is failing at several depths at once.

What replaced it is `killAndRemove`: SIGTERM, then a bounded loop that deletes, asks
whether the directory is *gone*, and keeps asking until it is. SIGTERM before SIGKILL for
the reason `bin/router.js` gives — it is the one Chrome can act on, and a Chrome that shuts
down properly takes its children with it, which removes the race rather than outwaiting it.
SIGKILL is second and two seconds later because it is not free: it drops the browser
process and leaves the children it was about to collect to be reparented to pid 1, which is
the leak bc-1eru is about. Real measurement after the change: the same `gate-check.mjs`
goes 8 → 8 where the old code goes 8 → 9, and a teardown costs about 175ms.

**Gone is asked twice**, which is the part that is easy to leave out and was. A writer that
is still going recreates the path within a millisecond or two of losing it, so a single
`existsSync` taken straight after the delete can land in that gap and report a clean
teardown to a caller whose directory reappears a moment later — the original bug, one layer
in. The suite caught that in the first version of the fix rather than a laptop catching it
in a month.

It is all synchronous, and that is not a style choice. `close()` is called by every
`scripts/*-check.mjs`, several of them immediately before `process.exit()`, which does not
wait for a pending promise; an async teardown would be cut short at exactly the call sites
that most need it to finish, and it is also registered as a process-exit teardown, where
nothing asynchronous ever runs again. So the wait is `Atomics.wait` on a throwaway
`SharedArrayBuffer`, the same instrument and the same reason as `test/helpers/tmp.mjs`.

`node test/chromeprofile.mjs` keeps it, and launches no browser, for the reason
`test/chromeport.mjs` gives: `npm test` does not depend on Chrome. The browser is a node
child that does the one thing about Chrome this code cares about — it writes into the
profile continuously, and in one scenario declines to die of SIGTERM. That is the worst
case the escalation exists for and it is reproducible at any speed, where a real Chrome
would only be measuring how fast this particular Mac shuts a browser down. Every scenario
is backed by a control that must **fail**: the same stubborn child is torn down with the
exact two lines that shipped before, and the directory is asserted to survive them. Without
it a green run would prove only that the fake browser was easy to kill. And the counting is
done inside a sandbox directory the suite makes for itself, because counting the shared
temp directory is what made `test/browse.mjs` flaky through four separate bug reports.

**The fake browser is waited for, not slept on** — and getting that wrong did not weaken
the suite, it inverted it. Each scenario used to follow the spawn with a flat 120ms, which
is a guess that a `node -e` child is up and inside its interval by then. Under several
concurrent suites — CI ran `b7e-gate --jobs 4` on a 3-core runner at the time, and every
local gate run here is the same shape — it is not. With nothing writing,
`killAndRemove` wins on its first attempt against a directory nobody is defending: the
control that must fail passes, the escalation window is never reached, and the profile that
"could not be removed" is removed. Three of the file's assertions go red together, and they
did, on `main`, twice on 2026-08-25 (bc-mrm77, bc-xl7n.136) and in six runs out of six
under a synthetic 3× CPU load. The wait is now on the evidence: two distinct filenames means
the child's interval has fired twice, and a stub that never gets there stops the run as a
broken fixture rather than leaving eleven measurements of nothing.

**And the one scenario that is about impossibility is no longer raced.** `killAndRemove`
only believes a deletion it can still see 40ms later, and 40ms is well inside what a
loaded machine deschedules a 2ms writer for — so "a profile it could not remove" was
removable often enough to go red on its own. The impossibility is structural now: the
profile sits one level down in a holder with no write bit, so the final `rmdir` is `EACCES`
however long anything waits. The stubborn child stays, because what is being handed to
`killAndRemove` is still a live process; it is the directory that changed. A permission bit
does not stop root, so that too has a control that must fail — an empty probe directory
inside the same holder, asserted not to go — because without it a root run would report the
contract regressing rather than the arrangement not holding.

### A press is not a stopwatch — `scripts/space-check.mjs`

Two sections above are about `space-check.mjs` failing for a reason that had nothing to do
with the change in front of it. This is the third, and it is the one that got as far as
being filed as a regression against somebody else's merged pull request.

**One press on the space card is two requests and a repaint, in that order.** `POST
/api/space`, then `GET /api/spaces` so the picker's 🔕 comes off the config that was just
written, then `render()`. Every press in the check used to be followed by a flat
`sleep(700)` — a bet that all three fit in that window.

**When the bet loses it does not look like a timeout.** It looks like the feature being
broken, one assertion *later*. `Clear` is only drawn while the space has quiet hours
(`public/config.js`), so a press that arrives before the redraw finds no button, clicks
nothing, and the assertion under it reports that Clear left the hours in place. The repo
row does the same thing a press later, and its "the row redraws with the tag and the button
agreeing" follows from it. Three reds, all of them phrased as behaviour, none of them
behaviour.

Measured 2026-08-25 (bc-khoe.67): filed as a regression from PR 584 on the reasoning that
it was the only commit in the range touching both the space-settings UI and the check —
which was true, and the commit's whole change to `public/config.js` is the word *space*
→ *group*. The tell was in the failure detail nobody had a use for at the time:
`autoEndorsePerWorkspace` read `{}` rather than absent, and `{}` is a **config default**
(`lib/config.js`). An empty map is what "the write has not landed yet" looks like on disk;
a daemon that had mishandled the press would have left the repo set wrong, not left the
default sitting there.

**So the check waits for the page, not for a clock.** `window.fetch` is counted in the
page, and `quiet()` returns once every request a press started has finished and nothing new
has started for a moment. It is bounded — a write that genuinely never lands still fails
its own assertion, on the same wording, a few seconds later rather than 700ms later — so
nothing is weakened by the wait; the stopwatch was never what any of these were asserting.
Two details are worth keeping: `/api/presence` is excluded, because a 45-second heartbeat
nobody pressed would otherwise be free to satisfy "a request started" on behalf of a click
that issued none; and a press that is *supposed* to send nothing needs a grace window
rather than the full deadline, because Set on a blank channel field is refused in the page
without a request and that refusal is one of the assertions here.

**And a press whose result is thrown away cannot tell you which of the two it was.**
`press()` has always returned whether its selector matched, and the assertions that read
the config file afterwards ignored it — so "the button did nothing" and "the button was not
there to be pressed" arrived as the same red. They now carry it, and an absent button says
so by name.

**The same bet, one line further down, in the `finally`.** Fixing the presses surfaced it:
39 of 39 assertions green, then `ENOTEMPTY: rmdir .../config/.git` and exit 1. This is the
only check that starts a *daemon*, that daemon keeps a git repository under its config
directory, and the teardown was `daemon.kill()` with an `rmSync` beside it — so the delete
walks a tree something is still writing into. `kill()` is not a wait, and `maxRetries: 3`
cannot help, because that is `rmSync`'s own retry of a failed *unlink* rather than of a
directory being repopulated behind it. It is `killAndRemoveSync` now, which is two sections
above and was already imported here for the signal path. Same bug and same fix as bc-beleq.1
in `test/advswitch.mjs`, which landed the same day; a teardown that can fail a run whose
every assertion passed is the worst shape a red comes in, because the results are printed
above it and say the change was fine.

### A guard that fires must say what it is — `test/monitorwidth.mjs`

The width suite ends by running the real program: `node bin/monitor.js --once` against a
fake daemon, twice, with every rendered line measured. Around each of those it arms a
`setTimeout(… child.kill('SIGKILL') …)`, because at the time `--once` did a cold `fetch`
with no timeout of its own and a daemon that accepts without answering would otherwise
hang the suite forever. (That is [fixed now](operations.md#a-cron-entry-that-never-returns--monitor---once),
and the guard is kept for the rest of the ways a child can wedge.)

The budget was 30 seconds and there was no retry, and what came out when it ran out was
this:

```
  AssertionError: monitor --once exited null
  null !== 0
```

**`null` is not an exit code.** A child that dies on a signal has no exit status at all,
so `code` is null and `signal` holds what killed it — and the message named the one thing
that had not happened, in the voice of the width assertion the suite is actually for. One
`monitor --once` costs 1.5–3s of node startup and module load on a laptop that is merely
busy; under a full 100-suite run, with twenty agent sessions each doing the same, that
multiplies until 30s is not enough. bc-uvhh is the bead: the run died at suite 57 of 100
and the 43 after it never ran, on a tree where nothing had touched the monitor.

That last part is the cost, and it is the same one `test/helpers/tmp.mjs` above exists
for. A red suite is how every session here decides whether its own diff is safe to
deliver, so an unexplained one either buys a second four-minute run or — worse — gets
talked past, and talking past it correctly requires knowing what `null` means. Both
readings are the same sentence.

So the guard now says which it was, and gets asked again before it gives up:

| | |
|---|---|
| `FRAME_BUDGET_MS` | 60s, twice the old budget, per attempt. |
| `FRAME_ATTEMPTS` | 3. Three at 60s rather than one at 180s: a *slow* monitor gets a fresh start and lands on the second, while a genuinely *hung* one still fails, three minutes later and explaining itself the whole way. |
| `FrameTimeout` | Raised only by the guard, and the **only** thing the retry will accept. A sheared border is exactly as real on the second run as on the first, so retrying anything else would turn the regression this suite exists for into a flake. |

A frame killed by something that is not this suite — a runner SIGTERM, the OOM killer —
names that signal instead, and a monitor that really did exit non-zero still reports its
code and is not retried. The failing message now reads `monitor --once was killed by this
suite's own 60s guard after 61s — the laptop was busy, not the frame`, which is a
diagnosis rather than a puzzle, and the retries announce themselves on stdout as they
happen so a slow run does not look like a hung one.

### A suite must not have a clock for a pass condition — `test/slowstart.mjs`

The third of these, and the worst-reading one. `test/slowstart.mjs` proves that a backend
which is merely *slow* is retried rather than condemned, and the only honest way to prove
it is on a real router: give one a health window nothing can start inside, touch nothing,
and see whether it comes back on its own. That much is right and has not changed. What was
wrong is that the window was a **constant** — `healthTimeoutMs: 250` — and the wait for
the recovery was another one, a flat two minutes.

Neither number means anything on its own. The router widens its window by *doubling*, so
the number of bring-ups it needs is the distance in doublings between 250ms and how long
this laptop actually takes to start a backend — three when it is idle, seven when eight
sessions are running `npm test` at once — and every one of those bring-ups costs an outage
pause that doubles too (2s, 4s, 8s, 16s, 32s, 60s). The ladder to recovery is therefore
~20s idle and ~170s loaded, against a deadline nailed to 120s. Same tree, same code, red
or green depending on what else was on the Mac.

And it did not fail like a flake. It failed as `timed out waiting for the router to bring
a backend up on its own`, over a log full of `would not start in time` — which at a glance
is indistinguishable from **the router can no longer start a backend**, in the suite that
exists to catch exactly that. It is the last thing a session sees before deciding whether
its own work is safe to deliver, and the only way to tell the two apart was to re-run the
suite alone and see it pass. bc-pv7a hit it as three green full runs, a fourth red on this
suite, and 36 of 36 a minute later on the same tree.

So the machine is **measured** rather than assumed. Before the router is started at all, a
backend is spawned by hand exactly as `spawnBackend` does it — same argv, same cwd, same
config dir, same `/internal/state` poll with the same token — and timed. Everything else
is derived from that one number:

| | |
|---|---|
| the window | `MEASURED / 8`, floored at the old 250ms. Still far too short to start anything, so the experiment is the one it always was — but now a *fixed* number of doublings short instead of however many this laptop happens to be having, which is what makes the ladder the same length on every machine. |
| the deadline | walked, not guessed. `ladder()` runs the same policy the router runs — `healthDeadline` per attempt, `nextSlowness` per bring-up, `outageRetryMs` between them — and returns when the window would first be wide enough, so the wait can never land in the middle of a rung. |
| the verdict | settled by spawning one more backend by hand, if it does time out anyway. |

That last row is the half that answers "was it this machine or was it the router", in the
message, without going to the log. If the hand-spawned backend cannot start inside the
widest window the router had already reached, then neither could the router and there was
no chance here it failed to take: the run says **THIS MACHINE, NOT THE ROUTER**, names both
numbers, and is *inconclusive rather than failed* — the checks that do not depend on a
clock have all run and the exit code stays 0. If it starts promptly, the router had every
chance and did not take it, and that is a regression: **THE ROUTER, NOT THIS MACHINE**,
with the hand-measured start, the window it was up against, and the router's own last
`still starting after Ns` line quoted at the point of failure rather than below it.

Three smaller things fall out of it, and each is a way this could have gone quietly wrong:

- A hand-spawned backend that **exits** is never read as a slow one. `timeOneStart`
  returns `{ms}`, `{slow}` or `{exited}`, because a backend that dies at startup is a
  broken build — the case the router is *right* to condemn — and folding it into "this
  machine is struggling" would turn a real breakage into a green run.
- The measurement is capped at 45s, under the **60s orphan guard** in bin/beadcause.js: a
  backend given `--port` expects a router to touch `/internal/state` every ten seconds and
  exits **0** when a minute passes without one. Nothing in the measurement is a router, so
  a longer ceiling would collect that clean exit and report a broken backend.
- If the window turns out *not* to have been too short — the machine got four times faster
  in the seconds after proving it was not — the slow path never happened and there was
  nothing to recover from. That is inconclusive too, and says so, rather than failing an
  assertion about a router that is serving perfectly well.

Filed as bc-9zv0. The sibling failure in the same file is bc-t69u, its `ENOTEMPTY` teardown
race, which is the `test/helpers/tmp.mjs` story above and not this one.

### `npm run coverage` — which files the suite never even loads

`npm test` answers pass or fail, and so does `npm run checks`. Neither has ever been able
to say *how much of this repo they went near*, which means the question a reviewer
actually has — "is the thing this pull request changes tested at all?" — has only ever
had a human answer, arrived at by reading `test/` and hoping. bc-sj8k.4 wants a candidate
card to show the evidence behind a pull request and named coverage as the one field it
could not render out of what exists. `npm run coverage` is that field, and bc-vriu.2 is
where it was argued out first.

```
npm run coverage                             # every suite, then fold and publish
node scripts/coverage.mjs --from 1 --to 45   # one slice, accumulating into the same pile
node scripts/coverage.mjs --report           # fold what is already there, run nothing
node scripts/coverage.mjs --reset            # throw the raw output away and start again
```

**There is no coverage dependency and there does not need to be one.** Node has carried
V8's own coverage since 10: set `NODE_V8_COVERAGE` to a directory and every process that
inherits the variable drops a JSON file of what it compiled and what it called.
`scripts/test.mjs` does nothing per suite except `spawnSync` it, so the variable reaches
all of them — and reaches the daemons *they* start as well, which is most of the point,
since a good deal of this repo is only ever executed by a child process a suite spawned
and then killed. `lib/coverage.js` folds the pile; `scripts/coverage.mjs` is the runner.

**A percentage would not have changed an approve-or-decline, and that is why this counts
something else.** bc-vriu.2 was filed with the instruction to close it rather than build
it if the honest answer was that a coverage figure would just be a number on a card. The
honest answer turned out to depend entirely on which figure. Nobody declines a candidate
at 71% and approves it at 74%, and a repo-wide percentage moves by fractions when one
lands, so the delta is noise — it is wallpaper, a number that makes a card look rigorous
while being unable to be wrong. But *"nothing in the suite ever executes the file you
changed"* is binary, exact, and about this candidate specifically, and it is a fact a
human reviewer cannot get any other way: a green gate says nothing at all, because a
suite that never imports a file passes exactly as loudly as one that exercises every
branch of it. So the report is a per-file, per-function list; `coverageForFiles` projects
it onto the paths in a diff; and the totals exist because they are free rather than
because they are the point.

**Functions, not lines, and that is not a shortcut.** Folding V8's byte ranges into line
coverage is the ordinary thing to do and it would lie here. Every file in this repo
argues its case in prose before it does anything, and those comment lines sit inside the
module's own range, which V8 marks executed the moment anything imports the file. Line
coverage over this tree would report roughly *how much of each file is commentary*, climb
whenever somebody explained themselves better, and read highest on the files nobody tests
but everybody documents. Counting comments as uncovered instead is no better: a stripper
accurate enough to tell a comment from a template literal containing a `//` is a real
parser, and one that is subtly wrong produces a number that is wrong without looking
wrong. Functions dodge all of it — V8 reports them by name with an invocation count, with
no interpretation — and an uncovered *function* has a name you can go and read where an
uncovered *line* is a number you have to go and look up.

**The strongest signal is the one V8 cannot report.** A file nothing ever imported
produces no entry at all: it is absent in exactly the way a file that does not exist is
absent, and absent reads as zero to nobody. So the fold walks `lib/` and `bin/` on disk
and diffs them against what V8 saw. Those files come back `loaded: false` with a null
function count — null rather than `0/0`, because V8 never parsed them and inventing a
denominator for a file nobody measured is the kind of number this whole section exists to
refuse. `public/` is deliberately out of scope: it is browser code, `npm test` reaches it
only by evaluating lifted fragments in a `vm`, and what actually exercises it is
`npm run checks`, so a Node-suite figure for it would understate it by most of its real
coverage.

**It slices because a full pass is 35–60 minutes**, which is past every timeout an agent
session has — a command that could only be run whole would be a command nothing can run.
V8's output makes that free: each process writes its own file, so two runs into the same
directory accumulate rather than overwrite, and `--from/--to` is a real slice of one
measurement rather than a partial one. `--reset` is the separate, explicit "this is a new
measurement", so that forgetting it costs you a stale mixture only when you asked for
one. `scripts/test-swap.js` is skipped: it drives real blue/green swaps of the live
daemon over ~300 requests and is the one suite to run alone.

The raw output stays in the checkout that produced it — `.coverage/`, ignored, tens of
megabytes a slice and meaningless anywhere else. The folded report is published to
`~/.config/beadcause/coverage.json`, because the reader is the daemon and the daemon does
not know which checkout is canonical: every session runs in a worktree under
`.claude/worktrees/`, so a report written to a repo root is invisible from all of them and
gone when that worktree is retired. It is churn in [the config repo's sense](agents.md#the-state-files-get-a-history-for-free)
— rewritten whole by every run, true only of the commit stamped inside it — so it is in
the ignore list in `lib/commonrepo.js`, and `test/memory.mjs` fails the repo if it ever
stops being. That stamp is load-bearing rather than decorative: nothing is going to
re-measure per candidate, so a card showing this has to be able to age it rather than
present an hour-old fact as a live one, and every answer carries the commit and the time.

`test/coverage.mjs` covers it, and the shape of that suite is the interesting part.
`lib/coverage.js` reads a format nobody here controls, so a suite fed hand-written
fixtures would pin *this repo's idea* of V8 and keep passing on the day a Node upgrade
changed the real one — the only day it matters. So the fixtures are generated: a small
tree under `os.tmpdir()`, a driver that calls some of it and not the rest, run in a real
child process with the real environment variable set, and what is asserted is that the
fold agrees with what the driver actually did. Hand-written raw files are used for two
cases only, both about the pile rather than the format: half-written JSON from a process
killed mid-flush, which is a normal outcome in a repo whose suites end by killing
daemons, and the same file appearing in two processes with different verdicts.

### `npm run checks` — the browser half, and why `npm test` can still see it rot

The `scripts/*-check.mjs` are the only cover this repo has for layout, taps and anything
that happens in a thumb, and none of them are in `npm test`: each wants a Chrome, a
phone-sized viewport and ten to forty seconds, and that suite stays pure Node on purpose.
Until `npm run checks` there was no way to run them but one at a time by name — which in
practice meant run by whoever remembered that the page they touched had one.

`npm run checks` runs all of them, four Chromes at a time, and ends with a list of which
failed. Every check binds `127.0.0.1:0`, drives its own temp profile and lets Chrome pick
its own debugging port, so there is nothing shared to collide over — the last of those was
only made true by [the section above](#the-other-port-two-runs-could-both-pick--scriptshelperschromemjs),
and this sentence claimed it for a while before it was; four minutes serially becomes
about one. Their output
interleaves badly, so each child's is captured whole, only failures are replayed — the
last 25 lines, which is where the three that matter are — and the full logs are left in a
temp directory named in the summary. `--list` prints what would run, `--only topbar,shade`
narrows it, `--jobs N` changes the width, `--dir <root>` points it at another tree (which
is how the runner itself is tested). Like the runner for `npm test`, it names no
individual check: the directory is the inventory, so adding one is adding a file and
conflicts with nobody.

**Every check is on a four-minute leash**, `--timeout N` to change it and `--timeout 0`
to take it off. This is not a tidiness rule. A check that hangs is the one failure a
runner like this newly introduces, and it is silent in the worst available way: the run
never ends, so nothing is reported about any of the rest either — strictly worse
than the by-hand state it replaced, where at least a person gives up. On the first real
run of all twenty-six, `agent-chooser-check.mjs` went quiet thirteen assertions in and
was still sitting there five minutes later. SIGTERM first so a check with a cleanup
handler gets to run it, SIGKILL five seconds after that, and `timed out after Ns` in the
summary beside it.

**And the parallel pass is a filter, not the verdict.** Some of these measure time —
how long a tab takes to warm, whether a bead is still in the air at 400ms — and four
Chromes on one laptop moves those numbers. On that same first run, `absorb-check.mjs`
failed a timing assertion and `agent-chooser-check.mjs` was the hang above; both passed
in seconds when re-run on their own. A runner that reports those as failures teaches
people to disbelieve it, which is the state this was written to get out of. So every
failure is run again, serially, with nothing else in flight — the condition each was
written under — and the second result is what is reported. What it must not do is hide
it: a check that needed the retry is named at the end as one that *only passes alone*,
because that is a fact about the check worth knowing, and `--no-retry` shows the raw
parallel pass. A check that fails both times is reported with `on its own — not a
scheduling accident` beside it, so a red line cannot be waved away as the scheduler's
fault.

**Three of them are red, and that is the bead in one paragraph.** Two were already
failing the day this was written, with no mark against them anywhere:
`shot-check.mjs` has always asserted that the daemon token never reaches `shot.mjs`'s
output, and the token is now appended to the URL that `shot.mjs` prints, so it does
(bc-sqab); `dismiss-check.mjs` finds that arming an option no longer disarms the dismiss
button, so two controls can be armed at once and the next tap is ambiguous (bc-giuc).
The third arrived while this was being written — merging `main` in took the gap between
the thread and the answer box from 80px to 134px, over `agent-chooser-check.mjs`'s 110px
bar (bc-0fi2), found within minutes of the downmerge rather than in a month. Two checks
in that same range of `main` had already been fixed by hand for the same kind of drift;
this one was missed, which is the argument for the command.

They were left red on purpose. A green wall bought by deleting the assertions would be
the same silence in a better disguise.

**All three are green now, and what they turned out to be is the argument for having
left them red.** Two were real, and neither was small. `shot.mjs` now prints its URL
with `t=redacted` while still navigating with the token, so the credential that guards
the daemon over the tailnet stops being written into the transcript of every agent
screenshot — the navigation is untouched, because the token on the URL is load-bearing
and documented where it is set. And the disarm came back to the option handler: bc-l8jp.9
turned that handler from *arm, then answer on the second tap* into *fill the box*, and
the unconditional `disarm()` went out with the answering path it was attached to, leaving
only the one guarding `expand()`. That one runs on a card that was **shut** — so on the
common case, a card open far enough to read the options you are tapping, the dismiss
underneath went on saying "Tap again — hides dm-1" while you picked, and the next tap
meant two things that write to different endpoints.

**The third was the check, and it had drifted for a reason worth writing down.** It
measured the gap from the last comment to the textarea, which was the right measurement
for seventy-four minutes: the fold landed at 14:32 and *Pin the answer box to the bottom
while the bead details scroll* landed at 15:46 the same afternoon, from another branch.
Before the pin, the brief and the box were consecutive blocks in one scroller and the
last comment really did sit a strip above the box. After it, the brief is its own
scroller with the composer pinned under it — so that distance stopped describing the
layout and started describing **where the brief happens to be scrolled to**, which the
fixture's own content decides. 134px against a 110px bar, with nothing wrong. It is now
two measurements that no scroll position can move: the composer's chrome above the
textarea is 60px against the same 110px bar, and the brief meets the composer at 0px
with nothing in between. Forcing the panel open again puts the first at 268px, so the
bar still has the teeth it was given.

Which is the honest scoreboard for the stance above: two of the three were bugs a green
wall would have hidden, and the third was a check that a downmerge had quietly made
meaningless — a state that only ends when somebody is made to look at it.

**And the pair that came next were red at their own fixture, in words that pointed at the
app.** `card-thread-check.mjs` and `prfull-check.mjs` both end by asserting that the
screen they drove wrote nothing — they count every POST their fixture receives — and both
failed on `["/api/error"]`, which reads as a card writing to the tracker and was nothing
of the sort. Each check serves `public/` from a plain static handler of its own; the page
it serves registers the real service worker; that worker's install precaches `SHELL` with
one all-or-nothing `caches.addAll`; and the extensionless entries in that list —
`/archive`, `/endorse`, `/config`, the aliases `serveStatic` rewrites onto a page — have no
file behind them at all. (`/monitor` and `/prs` were two more of them when this was
written; they are hops now, and so are out of `SHELL` altogether — which is the *other* way
a fixture 404s on a path, and why `lib/pagealias.js` grew a resolver for those too.) So every fixture 404d all of them, the install rejected whole,
`public/report.js` did exactly what it is for and posted the failure, and the check's own
assertion caught the check's own fixture (bc-zjep). It survived two sessions, both of
which correctly ruled it out as theirs and neither of which could tell from the failure
text that it was not the app.

Both halves of the fix are the ones the bead argued for. The fixtures resolve a path
through the daemon's own alias table before they look for a file — derived from the text
of `serveStatic` by `lib/pagealias.js` rather than copied into them, because a copied list
is right until a page gains a name and then wrong in the direction nothing reports. And
`/api/error` is held apart from the writes now and asserted on a line of its own, *and the
page reported no errors of its own*: a screen that really does throw during either check
still fails it, and says which error, instead of arriving as a sentence about a merge
button. `node test/pagealias.mjs` is in `npm test` and holds all of it — every `SHELL`
path resolving to a file, no redirect among them (`Cache.put` refuses one, and refusing
one rejects the install), and the derivation itself against synthetic sources, since a
regex that stops matching returns an empty table and every caller carries on serving 404s.

**But running them is not the problem this was written for.** These checks do not rot by
failing. They rot by pressing something that is no longer there, and then not being run.
Working bc-xqnj the inbox's `[data-space]` chips were removed; `shade-check.mjs` — since
deleted with the feature it covered, in bc-ka5y.1 — pressed those chips to narrow the
filter, so it broke outright, and two assertions in `launcher-check.mjs` went with it. `npm test` was green through all of it. Both were
found by *reading the scripts*, which is not a mechanism — nothing bounds how long that
gap can be, and a check that has silently not passed for a month is worse than no check,
because the next person to run it reads its failures as their own change breaking
something.

So the load-bearing part is static, and it *is* in `npm test`. `lib/checkaudit.js` reads
every literal selector every check presses — several hundred of them — takes each class,
id and `data-` attribute apart, and asserts it still appears somewhere in `public/`. That
is a text search, it costs milliseconds, and it fires on precisely the thing that used to
be invisible. `npm run checks` prints it before a single Chrome starts, and does not stop
on it: a stale selector in one check is no reason not to run the rest.

It is tuned to have no false alarms, so that a finding is always real, and two things
follow. An interpolated selector — `` `[data-key="${k}"]` `` — has no text to look for and
is skipped rather than guessed at; `data-key` itself is picked up from the dozen places
it is written plainly. And a check that serves its own fixture markup owns those classes,
so the check's own source counts as a home for a token — with its *comments stripped
first*, because a header paragraph naming `.shade-ask` must not be what keeps the audit
quiet about `.shade-ask` having left `public/`. What it deliberately cannot see is
anything about whether the check still *passes*: an element can move, change meaning or
stop being reachable with its name intact. This is the smoke alarm, not the inspection.

`test/checks.mjs` is where that runs, and half of it is controls, for the reason
`test/testrunner.mjs` has controls: "the audit found nothing" is the same output whether
the tree is clean or the audit is broken, and a broken audit is the more likely of the
two to survive unnoticed, because it is green. So it is measured in both directions
against synthetic sources — a token removed from `public/` must be found, one still there
must not be reported, one living only in a check's own fixture must not be, one named
only in a comment must not vouch for itself — plus an assertion that the count is in the
hundreds rather than zero, which is the shape a regex that stopped matching would take.
The rest is inventory: every check on disk is in the list, every check still parses, and
every relative import in one still resolves — the three ways a check can be dead on
arrival before Chrome is even reached. And the runner's own endings are held against a
temp tree of three checks that pass, fail and hang on purpose: exit 1, the failures
counted and named, their own output replayed rather than just a code, the hang killed at
the timeout, a passing check not listed among the failures, and an empty tree failing
rather than passing vacuously. A tree of its own rather than the real ones, because
those are the thing under observation, not the instrument.

**And the prose is not allowed to say how many there are.** The inventory is derived —
`discover()` reads the directory, so adding a check is adding a file and conflicts with
nobody — but the sentences *about* it were not. *There are twenty-eight of them* was
written once and then sat in eleven places at the same time: four in `scripts/checks.mjs`,
one in `test/checks.mjs`, six here, plus every phrasing spun off it carrying its own
arithmetic — the set minus the one that hung, the set minus the one with the stale
selector. Nobody ever swept all eleven. On 2026-08-11 `origin/main` claimed twenty-six with
twenty-seven on disk; one session bumped the eleven twice in a single sitting, once for the
check it added and once after merging a `main` that had added another and not swept; by the
time this paragraph was written the prose was six behind (bc-7smi). A number that is
reliably wrong is worse than no number, because it reads as measured.

So the numbers came out of the present tense — "every `scripts/*-check.mjs`", "the rest of
them" — and the live count is in `npm run checks -- --list` and in the audit line the
runner prints before a single Chrome starts. What stops them coming back is an assertion in
`test/checks.mjs`, because the instinct that wrote the first one is not going away: it
reads the comments of `scripts/checks.mjs`, `test/checks.mjs` and `lib/checkaudit.js`, and
the paragraphs here that name the checks, and fails on a number standing in for the set.
It matches the shapes the claim was actually written in rather than any number near the
word "check" — "ten to forty seconds" and "a four-minute leash" do not go stale, and a
linter that fired on those would be off within a month. **The exemptions are the
interesting half.** Two sentences are about the first end-to-end run and have to go on
saying twenty-six, because bumping them would not be an update, it would make them false.
So they are matched *literally*: reword one and it stops being exempt rather than quietly
staying so, and an exemption that no longer matches anything fails in its own right. That
is the difference between an allowlist and a hole.

`test/observe.mjs` is about observer mode only, and it is the oldest of them —
because this is the switch here that fails most quietly. Turn off the terminal
and the terminal is gone; get this one subtly wrong and everything looks fine until
there are two Claude windows open on repos you weren't working in. It checks that
the flag reads the way this section says (both spellings, and `0`/`false`/empty
meaning off), that an armed advocate with a full queue surveys and launches nothing,
that no reply agent or push goes out, that `/api/work` and `/api/poll` carry the
`observing` field the badge is drawn from — and, as the control, that with the flag
off all of that goes down the ordinary path and the field reads `false`.

The mirror-image test is deliberately absent: "with the flag off, does an advocate
really open a window?" can only be answered by opening one. That is the incident
this flag exists because of, so the suite proves the guards are *conditional* and
stops there.

`test/summary.mjs` covers the two counts on `/api/questions`, against a stub `bd`
that logs every invocation and a temp `~/.claude/sessions`. The arithmetic is not the
risk; three quieter things are. That the counts start costing a `bd` call — the log
is asserted to be one `human list` per workspace and nothing else, so a sweep added
by accident fails here rather than turning up as a slower inbox months later. That a
count empties in a scope that sweeps no questions. And that the response stopped
being additive — every field an older client reads is asserted still present and
unchanged. There was a third count, `questions`, behind the top bar's **N waiting**
pill; bc-ka5y.1 deleted both, and its *absence* is asserted here now — a served count
nobody draws is one that quietly goes wrong.

`test/terminal.mjs` covers what a terminal remembers across a restart, at the record
layer and nothing below it: that one which was running comes back `resumable` with the
session id that makes resuming possible, that one which *ended* stays ended, that a
record from before this existed or a half-written one is dropped rather than offered as
something that cannot be delivered, and that the flags are `--session-id` first and
`--resume` after. The pty itself is a named `skip` — `expect` and `claude` both being on
PATH is not something a test should assume, and a test that opened one would leave a
Claude session running in a temp directory.

`test/session.mjs` covers the one address a session has, because every way that breaks
is invisible until you tap a row and get nothing. The session it reads is the test
process itself — `liveSessions` liveness-checks every pid, so a made-up one is filtered
out before the endpoint sees it. It holds that `/api/session-log` answers with the
*whole* record and not the three fields the folded pane happened to need (the regression
that would leave the facts pane blank with nothing on screen to say why), that a dead pid
is a 404 naming it, that `file` comes back even when nothing has rendered yet, that a
transcript needs a token and the page does not, that `public/drawer.js` still owns
`/session` — one line, and nothing about it is visible from the server — and, last, that
`/api/session-log` has exactly one reader in `public/`. That last one *is* the bead: a
second reader is a second detail view growing back.

`test/queue.mjs` covers what happens to words typed while a turn is running, because
every way that breaks is silent from the outside: a message queued and never sent
looks exactly like one you forgot to type, and one sent twice looks like the agent
repeating itself. It loads the real `public/sendqueue.js` in a `vm` context with
nothing in it but a `window` — a copy of the logic rewritten as a module would pass
while the page shipped something else — and holds five rules: mid-turn queues,
turn-ending delivers, two queued messages become one turn, a refused delivery keeps
the words and gives up rather than spinning, and an idle repaint re-sends nothing.
The browser half is `scripts/queue-check.mjs`, named as a `skip` at the end of the
suite so what it does *not* cover is on the screen rather than in a comment.

`test/tls.mjs` covers the [protocol floor](operations.md#https-on-the-tailnet-name), which is the
quietest thing in this repo: `minVersion` is one option on one object, it has no visible
effect until something old dials in, and nothing in the app would notice it being
dropped. So it is a real handshake against a self-signed certificate in a temp
directory — a client that offers TLS 1.1 is refused, and the assertion is that the
*server* refused it (`ciphers: 'DEFAULT:@SECLEVEL=0'`, because Node's client will not
even offer 1.1 otherwise, and a client-side refusal would pass this test with the floor
removed), while 1.2 and 1.3 both connect and get an answer. Then the three seams the
sniffing front sits on: an HTTPS request served intact, a plain-http request answered
with a 307 to the certificate's name with its query kept, and the terminal WebSocket
over `wss` still gated by the token subprotocol — accepted-then-closed `1008` for an
unknown id, refused with a `401` for a wrong token. Whether a *phone* trusts the real
certificate is a named `skip`: that is a fact about Let's Encrypt and `tailscale cert`,
and no test on this machine can answer it.

The same file covers the other silent failure in that neighbourhood — [the URL the
phone is given](operations.md#the-url-you-are-given-and-what-happens-to-a-phone-that-already-has-one).
An `https://` link built on a machine that cannot issue certificates reaches a port
serving plain HTTP, and a TLS parse error is not a page anyone can read; nothing in the
app would notice, because the daemon comes up and the log says http. So the pair on
disk is planted and taken away, and `baseUrl` is asserted to follow it in both
directions — including the halfway states, a fetch interrupted between the two files
and `tls.enabled: false`. The other half is that a `baseUrl` *you* set is never
rewritten: `reconcileBaseUrl` runs on every `loadConfig()`, in every CLI, so a
too-generous match would quietly overwrite a reverse proxy or a real domain on the next
`beadcause-ask`.

`test/certrenew.mjs` covers [the renewal](operations.md#renewing-it-before-it-expires), which is
quieter still — the failure it prevents has no symptom for 89 days and then takes the
whole app down, and you could not find it by hand without leaving a Mac untouched for a
quarter and being surprised. `BEADCAUSE_TAILSCALE` points `lib/config.js` at a shell
script that answers `status --json` and mints certificates with `openssl`, so what runs
is the real `obtain()` — the same `spawnSync`, the same "the files decide whether this
worked" rule — against a certificate authority the test made up. Its `refuse` mode is the
actual failure, reproduced faithfully: stderr gets a 500, and the exit code is **0**.
Five things are held. A certificate with months left costs nothing (asserted as *no
calls to tailscale at all*, not as a fast return). A renewal that fails keeps the working
certificate on the socket, says `CERTIFICATE NOT RENEWING` in the log with the fixing
command beside it, and pushes **once** across six checks rather than once per check. A
renewal that succeeds swaps the live sockets — new fingerprint on the next handshake, the
same port still listening, an HTTPS request answered immediately, the TLS 1.2 floor still
refusing 1.1, and **a WebSocket opened before the swap still echoing a message after
it**, which is the acceptance criterion no amount of reading the code proves. And behind
the router, where the listener is loopback-only plain http, the whole thing is a no-op
that starts no timer.

The fifth is the one that has to hold a *sequence* rather than a state, and it is bc-ij1e:
a listener built with no certificate at all serves plain http on a real port (not a
redirect, and not a dead socket — a client that guesses `https` there is destroyed rather
than shown something untrue), keeps asking while the tailnet refuses, pushes `absent`
once with Tailscale's own sentence on it, and then — `refuse` flipped to `days=90`, the
one command that failed a moment ago now working — adopts it. What is asserted after that
is the whole point of the design: the front is still listening **on the same port
number**, https answers there, and the plain http that was being served a moment before is
now a 307 to the certificate's name.

`test/service.mjs` covers whether anything notices that launchd is running the wrong
program — the [three-day bug](operations.md#the-router--why-you-never-restart-it) — in two halves.
Detection: a plist written into a fake home, and the verdict `lib/service.js` reaches
about it, including the case where the file is right and the *job* is stale. Delivery,
which is the half that was actually missing: the verdict on `/api/work` from a real
daemon booted with `HOME` pointed at a plist naming `bin/beadcause.js`, so the assertion
is the diagnosis and not merely a field being present. Plus the hop that makes it
possible — the process serving the console is a grandchild of launchd, so passing down
`BEADCAUSE_LAUNCHD_PROGRAM` is what stops a healthy install being reported as stale, and
an *empty* value has to mean "not a launchd job" rather than "read your own argv".

That variable is also the one thing the suite has to *drop* before its first case, and
bc-nv25 is what it cost not to. An iTerm window the daemon opens is downstream of the
router launchd started — not through the command string, which starts a fresh login
shell that inherits nothing, but through iTerm.app's own environment — so every shell in
it carries `BEADCAUSE_LAUNCHD_PROGRAM` naming the **main checkout's** `bin/router.js`,
true about that terminal's ancestry and nothing at all about the tree under test. `serviceHealth()` reads the environment whenever its caller
passes nothing, so the good-day checks in a worktree saw a running job disagreeing with
the checkout and reported the stale-plist bug the file exists to detect: real logic, wrong
input, red in every session an agent opened and green in every terminal a person opened —
the split that guarantees nobody goes looking. It is the environment half of the rule
[a suite must not assert about a directory it does not own](#a-suite-must-not-assert-about-a-directory-it-does-not-own--testbrowsemjs).
So the file deletes the variable at the top and every case says what it means, and the
two cases either side of
the good day pin the difference the trap turns on: pass nothing and you get the
environment's answer, pass `null` and you get the file's. Nothing is lost by it — no case
here ever read the real LaunchAgents folder. The leak itself is closed one level up as
well — [the spawner empties it](agents.md#the-one-agent-nobody-spawns) for every agent beadcause
opens — but the suite keeps its own `delete`, because a suite that passes only when its
parent was well-behaved will go red in the first shell somebody starts by hand.

`test/warm.mjs` covers [the warm layer](navigating.md#loaded-once-and-kept--what-a-tab-tap-actually-costs),
which is entirely made of things that fail without saying anything. A cache that hands
back half a payload, or one a previous build stored in a different shape, is a screen showing something that is not true and looks exactly like
a screen showing something that is — so every one of those is asserted to read as a
*miss*, because a miss is the case every caller already handles. The same for the
storage refusing to exist: `localStorage` throws on write in more browsers than it
does not, and the file's whole promise is that a page which cannot warm is merely as
fast as it was, so a broken store is asserted to make every call a safe no-op. A full
store is asserted in the direction that matters now that nothing expires: it gives up one
entry at a time, oldest first, and **may never give up the inbox** — which used to be
exactly what it did, because the old answer to a quota failure was to throw everything
away at once.
The real `public/warm.js` runs in a `vm` with a hand-made storage, the way `test/queue.mjs`
runs the real send queue: a rewrite of the logic as a test-only module would pass this
while the phone shipped something else.

Then the two halves that are about cost rather than correctness. `plan()` — the
reconciler's decisions — is checked in both directions, because the direction that
matters is invisible: a card wrongly *kept* is a card that has silently stopped
updating, so a node the file did not paint is asserted to be replaced rather than
matched, and a repeated key to bail to the whole-list rebuild rather than guess which
of the two to place. And the background warm is checked against becoming the thing it
replaced: it skips the view it is on, dedupes the path two views share, skips anything
fetched inside its floor, gives up when the screen goes dark, and runs once per document
— each of those is one line, and losing any of them costs the Mac several `bd` sweeps a
minute for tabs nobody tapped.

The server half is the drift check and the saving. `/api/poll` and `/api/questions` are
compared field by field against each other, because a field on one and not the other is
a poll-driven refresh that draws a subtly different inbox from a reload — no counts on
the chrome, or a filter it does not obey — and nothing anywhere would say so. And the
quiet poll is asserted as *no calls to `bd` at all*, against a `bd` that records every
invocation: the saving is not that the sweep got faster, it is that the quiet case does
not sweep. `paint()` itself is a named `skip` — it is a dozen lines of `insertBefore`
over what `plan` returns, and testing it here would mean shipping a DOM. The browser
half is `scripts/warm-check.mjs`, which measures the tab tap and stamps the cards.

`test/css.mjs` covers something nothing else in this repo would ever say a word about: a
rule in `public/style.css` that has lost its closing brace. Under CSS nesting that is not
a parse error — every rule after it becomes a *nested* rule of it and applies to nothing,
so the file stays valid, the brace count can still balance, no browser console complains,
and the page merely looks a bit plain. It happened: a merge took seven declarations and
the closing brace off `#save-dialog textarea` and gave them to `.key` a hundred lines
below, which killed the last five hundred lines of the stylesheet — the whole advocate
console and the admin page — until bc-4irq tried to add a rule there and could not make
it apply. So the invariant is that a selector block contains no other block, which
forbids nested syntax on purpose: that is the price of a truncated rule failing on the
next `npm test` rather than quietly for a week. The detector is shown the exact wreck, so
a guard that cannot fail is not mistaken for a file that is fine.

It carries a third invariant for a third way a rule goes quiet, after truncated and
written-twice: **written for a layout the element never got.** `.mon-card .work-head` — the
head of every card on `/monitor` — had `align-items: center` and `flex-wrap: wrap` and no
`display: flex` anywhere, so both properties did nothing, and `.adv-actions
{ margin-left: auto }` was dead beside them for the same reason. The head laid out as a
plain block and stacked the repo's name, the state line and the controls on three lines:
127px of head on a phone where the row is 88px, and the two cards with no controls 80px
where the row is 36px. The sketch under [Space details](asking.md#space-details--every-setting-a-space-has-on-a-page-of-its-own)
above draws that head as one line, because one line is what it was written to be — the
page had simply never done it. Nothing complained, and nothing could: two properties that
do nothing render as exactly the layout you would have had without them, which is why this
is a test and not a lint. So the narrow invariant is that the rule giving that head its
flex properties also gives it a `display: flex`, that the `.space-card` copy of it stays
gone (the space card is a `.mon-card`, so one selector draws all four heads), and that
every card the page draws wears both `mon-card` and `work-card` — the second being the
padding, which the space card was the one card on the page without.

The general form of that — **no block sets a flex-container property unless something
gives that element a flex or grid display** — is bc-ah0v, and it sits beside the narrow
one. It needs the markup as well as the stylesheet: fourteen live rules set
`align-items`/`gap`/`flex-wrap`/… with no `display` of their own, which is the shape of
the bug, and five of them are modifier classes whose base class supplies the display on
the same element (`.svc-set` on `.svc`, `.agent-row` on `.chip-row`, `.board-row` and
`.pr-card .pr-row` on `.work-row`, `.mon-times` on `.meta`) — a pairing only the markup
knows about. So each rule is resolved in two stages: first against the stylesheet, where
a rule the display rule already reaches is settled outright (`.chip-row.scopes` is fine
because `.chip-row` is `display: flex`); then against every `class="…"` and `.className =`
in `public/*.html` and `public/*.js`, where the rule is fine if every element that could
wear its key compound is laid out as flex by *some* rule. Two limits are deliberate and
both are permissive, because a layout guard that cries wolf gets deleted: ancestors are
ignored when matching an element, and a `display` inside an `@media` counts at every
width. What is left is still exactly the bug — an element that nothing anywhere lays out
as a flex container, carrying properties only a flex container reads. A rule the markup
cannot speak for at all, because its class is built at runtime (``row.className =
`chip-row ${g.id}s` ``), is reported as a failure rather than skipped, since a check with
a silent don't-know bucket is a check that empties into it; the way out is to write the
class where a grep can see it, or to put the `display` in the same block. Run against the
tree as it stood before bc-8l74 the check names both real bugs — `.mon-card .work-head`
and its `.space-card` copy — and nothing else, and it is shown that failure on the live
file, with the one `display: flex` taken back off.

And a fourth, which is the second one wearing a disguise: **written twice with different
quoting**, so that a grep for either spelling comes back looking conclusive.
`.chip[aria-pressed="true"]` at the top of the file set the filled accent and the
`var(--accent-ink)` meant to go on it; four hundred lines below,
`.chip[aria-pressed='true']` — the composer's deliberately quiet wash for a suggestion
chip — set a 16% background and no colour at all. Same specificity, so the later rule won
the background and the earlier one's near-black ink stayed on it, on **every** pressed chip
in the app: the filter and scope chips, the space row, the monitor's tabs, the chips the
console edits a bead with. Measured in a real Chrome that is 1.0:1 in the dark theme and,
worse, white on a pale teal at 1.6:1 in the light one — invisible rather than merely dim,
against 4.5:1 for ordinary text. It survived because each spelling greps as the only one,
and because bc-es8 had already given `.show-dismissed` a private `color` to climb out of
it, which fixed the one control anybody was looking at. bc-wx2e settled it the way the
surrounding rules already argued for: the filled accent is the app-wide paint for a chip
that has been *chosen* — the same paint `[aria-selected]` gives a tab, at 11.2:1 and
5.5:1 — and the wash is scoped to `.suggested`, where its own comment argues for it,
naming `var(--text)` as its ink. So the invariants are that exactly one rule paints a
pressed chip app-wide, that any rule giving one a background names its ink in the same
block (a background from one rule and a colour from another being precisely the pair that
was unreadable), that the wash stays scoped, that the spelling is one spelling, and that
`.show-dismissed` no longer needs its escape hatch.

And finally the general form of *written twice*, which is bc-b4dk and which the file had
been asking for since bc-4aw without being able to have it: the four bugs above are four
instances of one property, and until the instances were resolved the general check could
only have failed the build. They were `.tabs` (bc-4aw), the pressed chip's two spellings
(bc-wx2e), the bare `.chip` (bc-297u, bc-syzm) and the drawer — nine blocks of it, the
whole section written twice two hundred lines apart, near-identically, so that editing the
copy a reader reaches first changed nothing at all (bc-5orx). Every one of them rendered
perfectly, which is the entire difficulty: a duplicated selector is not a parse error and
not a visual fault, it is a **later block quietly winning**, and the bill is paid by the
next person to edit the copy that loses. The `.chip` pair had been drawing every filter
chip, space chip and monitor tab in the composer's paint for as long as both blocks
existed, while the block written beside the filter chips contributed `flex: 0 0 auto` and
nothing else.

The assertion is deliberately **not** "a selector appears once", because this stylesheet
writes two of them twice on purpose and is right to: `:root { --viewbar-h: 44px }` sits with
the pill row rules that read it rather than eight hundred lines away with the rest of the
palette, and `.icon-btn { position: relative }` sits with the badge it exists to position.
Neither can silently win anything, because neither touches a property its other block sets.
So what is asserted is the property that actually separates those from the four bugs — **no
block may re-declare a property an earlier block with the same selector already
declared** — and additive stays legal without an allowlist to maintain. Shorthands are
resolved or the check would be trivially evaded, a second block setting `padding-left`
against a first setting `padding` colliding just as silently as one setting `padding`
twice: a shorthand covers its own dashed longhands, plus the few families whose names do
not share a prefix (`gap`/`row-gap`, `inset`/`top`, `place-items`/`align-items`,
`flex-flow`/`flex-wrap`). Custom properties compare by exact name, so `--viewbar-h` beside
`--viewbar` is two variables rather than a collision. Run against the tree as it stood
before this landed the check reports **45** silent overrides across ten selectors and
neither of the two additive one-liners, and it is shown both shapes — a block that re-sets
a property, and one that only adds — so a guard that cannot fail is not mistaken for a file
that is fine. Bodies are read with comments blanked, which is not a detail: `.drawer` sets
`padding-top` underneath two lines of comment about the notch, and reading the raw text
hid that one declaration while reporting the other nine.

`test/metricscale.mjs` is the same idea aimed at numbers instead of braces, and it exists
because of a measurement rather than a bug. `node scripts/design/vocabulary.mjs` reads the
baseline fingerprint back and counts what the 77 design cards actually render, and it found
the two halves of this system in very different health. **The colours were disciplined** —
12 distinct text colours in the light scheme, every one of them a token, nothing drifted.
**The metrics had smeared**: 23 distinct corner radii, 16 font weights, 22 type sizes in a
continuous run from 9.5px to 19px with no gap anywhere. The difference is not care, and it
is not two hundred commits of carelessness either — every one of those values was a
reasonable local call. The difference is that **the palette was checkable and the metrics
were not.** A colour off the palette is a literal hex in a sheet where every other colour
says `var(--…)`, and it fails review on sight; `9px` in a sheet that also says `10px`,
`11px` and `12px` fails nothing and looks like every line around it.

So bc-03pz gave two of the three axes a scale and a suite, and bc-ka5y.22 the third.
**Radius is 6 / 10 / 14 / 18,
four apart, plus `999px` and `50%`** — four apart because `vocabulary.mjs` calls two values
within 2px of each other a smear, so a scale with 2px steps would be one, and the suite
asserts that spacing about *itself* as well as about the sheet. **Weight is 400 / 550 / 600
/ 650 / 700**, the four the measurement found carrying the app plus the one real bold, down
from sixteen. Both are checked per *part*, because `border-radius` takes four lengths and a
speech bubble's `12px 12px 4px 12px` hides a stray in the third of them.

Two of the moves are worth their own line. **A thin bar is `999px`, not a small radius**:
every sub-4px value in the sheet was a fully-rounded end drawn as a corner — a 2px progress
line at 1px, a 4px sheet grip at 2px, a 3px scroll rail at 3px — and since the browser
clamps a radius to half the box's smallest side, all of them already computed to exactly
what `999px` gives. That rewrite is provably pixel-identical and it says what the element
means. And **the two chat bubbles landed together**: `.msg.you` and `.queued-text` are the
same bubble either side of a send, and they had drifted to 14px and 12px.

**Type is 9 / 11 / 13 / 16 / 19 / 24, and it is the axis that had to be asked about.** A
radius cannot move a box and a weight barely can — bc-03pz's whole snap moved seven text
runs by 1–3px and not one box height, which `scripts/design/baseline.mjs` is what proved.
A type scale moves layout on a 360px phone, so which one to snap to was a design decision
rather than a normalization, and bc-ka5y.22 was filed rather than guessed.

**It was then decided on a measurement rather than on the argument.** Each candidate scale
was applied to the real sheet, all 77 cards re-rendered, and the fingerprints diffed —
about a minute per candidate, which is cheaper than the paragraph that would otherwise have
argued for one. Three things came out of that and none of them was reachable by reading.
The width risk the bead was filed on had already been fixed by bc-khoe.5: `topbar-check`
says every page has at least 24px of slack at 360px, and three of the four candidates *gain*
8px because the picker face narrows. "No box height changes" turned out to be impossible for
*any* type scale, because the line-heights here are unitless multipliers — 292 elements move
by ≤4px and none of them is a wrap. And the rounding of the three ties (10px, 12px, 14.5px,
98 declarations between them) mattered more than the choice of scale: **down** gives 6 boxes
taller and 27 shorter, **up** gives 29 taller and one card 83px longer.

So the sheet moved 356 declarations by no more than 2px, 11 / 13 / 16 / 24 stayed exactly
where they were, five cards lost a line and none gained one — the single card that grows on
the 440px design board is `decisions/options.html`, whose option hint was already two lines
at 360px and 393px before the change. The allowed set lives in `test/metricscale.mjs` beside
the other two, and the rounding rule is in its header, because a later 12px is not a
near-miss to wave through: it is 11px or 13px and the sheet has already decided which.

## Notes on bd

- **Never run `bd hooks install --beads`, `bd hooks install --shared`, or let
  `bd doctor --fix` reinstall hooks, in this checkout — it kills every git hook in
  every worktree, silently.** `bd hooks install --beads` sets `core.hooksPath` to an
  *absolute* path anchored at the git repo root's `.beads/hooks` (`FIX: Worktree
  hooks use absolute core.hooksPath` in bd's own changelog — deliberate, so hooks
  work from any worktree). It does this with no regard for `BEADS_DIR`: bd's hook
  installer assumes `.beads` is co-located with the repo, which is the default bd
  layout but not this one — this workspace's real `.beads` lives at
  `~/beads/beadcause/.beads` (see the global CLAUDE.md's beads section), well outside
  the checkout. So `<repo>/.beads/hooks` never exists, `core.hooksPath` points at a
  directory that was never going to be there, and — because `core.hooksPath` lives in
  the shared `.git/config` and `extensions.worktreeConfig` is not set here — every
  worktree of the repo loses every git hook at once, with no error: git just silently
  runs no hook. `bd doctor` flags it correctly (`Hooks Path: core.hooksPath points at
  a missing directory`) but its *other*, unrelated finding — `Git Hooks: … Install
  hooks with 'bd hooks install'` — is the trap: bd's own `--beads` flag is documented
  as "recommended for Dolt backend", and this workspace genuinely is Dolt-backed, so
  following bd's own advice here reproduces the bug. Recurred twice before this note
  existed (bc-y3qk.13, then bc-xl7n.142) and neither prior fix found the trigger; this
  is what running `strings` on the `bd` binary and reading `bd hooks install --help`
  actually turned up. **The fix, every time:**
  `git config --local --unset core.hooksPath` (from the main checkout — the config is
  shared, so any worktree can run it) then
  `node scripts/conflict-check.mjs --install-hook` **from the main checkout
  specifically**, never from inside a worktree — the hook's payload path is
  worktree-relative and bakes in whichever worktree ran the install (bc-xl7n.125), so
  installing from a worktree just trades one dangling path for another the moment
  that worktree is retired. Verify with a staged file containing conflict markers and
  running `.git/hooks/pre-commit` directly; it should exit non-zero and name the
  markers.
- **The `jsonmerge` driver is per-clone too** (bc-g95u9). `.gitattributes` sends
  `package.json` and `package-lock.json` through `merge=jsonmerge`, and the name only
  means something once `node scripts/jsonmerge.mjs --install` has run in that clone.
  Run it once; any worktree can run it, since it always records the main checkout's
  copy of the script. `node scripts/jsonmerge.mjs --check` says whether it is
  installed. Without it, git falls back to an ordinary text merge for those two files,
  so they conflict instead of merging by key.
- **`bd human respond` is broken in bd 1.1.2** — it dies with `storage is nil`.
  Beadcause does the two steps it documents (`bd comment` then `bd close`) itself.
  If a later bd fixes it, the two-step is still fine.
- **`bd` is spawned directly, never through a shell.** `~/.zshenv` runs
  `_bd_set_workspace`, which rewrites `BEADS_DIR` from the shell's cwd — so
  `BEADS_DIR=… zsh -c 'bd …'` silently hits the wrong workspace. `execFile` does
  no shell startup, which is how one daemon serves five workspaces.
- **Every `bd` invocation gets two minutes, and the number is measured.** `BD_TIMEOUT`
  in lib/bd.js. It was thirty seconds, which this laptop clears on an ordinary
  afternoon: the largest read here — `bd list --all` over 503 beads — answers in about a
  second idle and took **28.6s** under a load average of 33, which is twenty agent
  sessions and a full `npm test` rather than anything pathological. A timeout is not a
  slow answer downstream, it is a dead workspace — `execFile` kills the child, the sweep
  files the repo under `trouble`, and the History tab draws an empty ledger — so the
  failure mode of a busy machine was every repo reporting as broken while `bd` was merely
  slow, once per thirty-second poll, for as long as the load lasted. It is a **default**
  and not a ceiling per call because a ceiling per call is what was tried first: `listAll`
  got one, six other reads did not, and the six that did not are the small ones that run
  on a timer across every workspace. Writes inherit it too — a write SIGTERMed mid-`bd` is
  worse than a slow one, and since a timeout is never retried this is one ceiling per
  call, not four.
- **The three `bd dolt` verbs are the one exception, and it is not a number typed at a
  call site.** `doltPull`, `doltPush` and `doltCommit` take a ceiling from their caller,
  because theirs is the one that has to stay *under* something: the sync interval, which
  lib/bd.js has never heard of and lib/sync.js owns. Equal defaults in two files is what
  produced the skipped ticks (see [When it syncs](operations.md#when-it-syncs-and-why-the-interval-is-not-a-performance-knob)),
  and the fix for that cannot itself be a second constant. It is still `BD_TIMEOUT` when
  nobody names one, which is what a first sync of a large graph gets. The guard against
  this becoming the old bug again is in test/bdtimeout.mjs, which asserts no *literal*
  timeout in lib/bd.js is smaller than the constant, and in test/sync.mjs, which asserts
  a whole tick fits inside the interval at every setting.
- **A timeout says so, everywhere it is displayed.** It is the one error that arrives with
  nothing to explain itself: `bd` is SIGTERMed mid-answer, so stderr is empty and Node's
  own message is "Command failed". So `run` rewrites it as `bd … timed out in <workspace>:
  still running after 120s, killed rather than broken` and sets `err.timedOut`. The shape
  is deliberate — lib/sweep.js strips `<verb> in <ws>: ` and shows the sentence after the
  colon, so what reaches a four-inch screen is *still running after 120s* rather than a
  wall of flags, and a slow repo stops reading as a broken one. Blowing the 32MB
  `maxBuffer` kills the child as well and is deliberately *not* dressed up that way —
  that one really is bad output.
- **The two `bd dolt` verbs disagree about what "no remote" is, so neither exit code
  answers "is this workspace shared?"** Measured against bd 1.1.2: with no remote
  configured, `bd dolt push` exits **0** and prints *"No remote is configured — skipping"*,
  while `bd dolt pull` exits **1** with *"Error: fetch from origin/main: Error 1105: no
  remote"*. Gating on either is a trap in both directions — trusting the push's zero says
  a solo workspace synced, and trusting the pull's one reports a failure on every private
  workspace, every interval, forever. `bd dolt remote list --json` is the question that
  has an answer: `[]` on a solo workspace, `[{name, url, sql_url}]` on a shared one. Note
  that the *non*-JSON form is the prose "No remotes configured." and exits 0 as well; see
  `doltRemote` in lib/bd.js and [A tracker two Macs share](operations.md#a-tracker-two-macs-share).
- **`sharedServer: true` is not how you put a workspace on a server, and it never
  was.** That flag sets `BEADS_DOLT_SHARED_SERVER=1`, which selects bd's *shared*
  (global) server — a different thing from the per-project `dolt sql-server` a
  workspace gets from `dolt_mode: "server"` in its own `.beads/metadata.json`. It is
  also fleet-wide in lib/bd.js, so turning it on drags every other workspace into a
  mode none of them are in, and each one then fails against a server that isn't
  listening. Per-project server mode needs no environment variable at all: it is
  configured workspace-side and the daemon already spawns `bd` correctly for it.
  Leave this `false`.
- **The public registry is pinned in `.npmrc`.** The global `~/.npmrc` points npm
  at a private package feed with an expired token, which 401s here.
