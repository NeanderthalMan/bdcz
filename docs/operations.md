# Running it — the router, the monitor, timings and the HTTP API

## Timing every request — which routes are actually slow

Nothing here used to measure a request. "The app feels slow, some screens worse than
others" was the whole of what could be said about it — which is not a target, and not
something a cache can be judged against either: a caching change with no before-figure is
indistinguishable from a placebo, and so is one that made a screen faster by making the
screen beside it slower.

Every request is timed now, always, and three numbers come off each one because with any
of them missing you cannot tell what to do next:

- **How long it took.** The budget is a page load under a second, and a page load is a
  dozen of these, so a per-route figure is the unit a budget gets spent against.
- **How much of that was a child process.** Nearly everything slow here is a `bd` sweep
  or a `gh pr list` rather than our own code — `bd list --all` over five hundred beads
  answers in about a second idle and took **28 seconds** under a load average of 33, which
  is what a Tuesday looks like on this laptop. A route that is 95% `bd` is a caching
  problem; a route that is 95% ours is a different bug entirely, and from a stopwatch the
  two are identical. **Two numbers, not one**: these routes fan out — one `/api/questions`
  is nine `bd` processes at once, one per workspace — so the *sum* of the children runs
  past the request's own clock and `total − sum` goes negative. It did, on the first real
  run: a 10.3-second `/api/questions` reporting 16.7 seconds of `bd`. So the sum is kept
  as *what the request cost the machine* and the **union of the intervals** — the wall time
  with at least one child running — is what "the subprocess share" means. Their ratio is
  the fan-out, and it is why the ninth workspace is nearly free while the first is not.
- **Whether it was warm or cold.** A cached route has two completely different costs, and
  averaging them produces a number that has never once happened: the mean of a 30ms cache
  hit and a 3-second sweep. There were five hand-rolled route caches when this was written
  and there is [one shared layer](#the-shared-cache--past-the-window-nothing-waits-for-the-sweep)
  now, which is a third state — see the note after this list.

**Warm and cold are derived rather than declared.** A request that spawned no child was
answered out of memory; one that spawned something paid for it. That needs no edit at any
cache's call site, and it is honest about the case that matters — a miss is a miss whether
the code around it thinks of itself as cached or not. A route that knows better can say so
(the stale-while-revalidate layer answers from memory *and* refreshes behind it, and filed
as cold it would make the fastest kind of request there is look like the slowest). When
several reads in one request each say something different, [the coldest one
wins](#a-request-is-as-cold-as-its-coldest-read).

**Nothing had to be threaded through for the subprocess half**, which is why it is an
`AsyncLocalStorage` and not a parameter. `bd` is called from a few hundred places and they
all go through `Bd.run`; `gh` goes through lib/pr.js and `git` through lib/gitref.js. Each
of those three asks "which request am I inside?" without any of its callers knowing the
question exists. A child spawned with no request in scope — the poll cycle, an advocate
tick, the sync timer — is charged to `background` instead, which is worth having on its
own: it is not on anybody's request path and it is not free either, because embedded Dolt
is single-writer and it is what a phone's read queues behind.

### Where you read it

Three surfaces, and they answer different questions.

| | for | |
|---|---|---|
| `Server-Timing` on every response | one request, in isolation | `curl -sD- …` prints `total;dur=87430.9, gh;dur=15353.4, git;dur=158.2, bd;dur=1150905.3, children;dur=87230.5, joined;dur=191.7, loop;dur=4520.9, cache;desc=cold` — the per-binary sums, then the union under `children`; `joined` sits beside it and is present only when the request actually waited on somebody else's producer (bc-1kwl.33), the same way `children` is absent when nothing was spawned; `loop` is last, before the cache descriptor, and is how long the event loop was unavailable while the request was open (bc-1kwl.30). Browser devtools draws it in the waterfall |
| a line in the log | the slow one you did not go looking for | `[beadcause] slow GET /api/questions 2026ms stale — 1980ms of it waiting on 8 child process(es) (bd 3039ms of work), ours 46ms; loop busy 89ms`, at `slowRequestMs` (default 1000, the budget itself). A request that joined somebody else's sweep gets its own clause in the middle instead — real, off the same log, both kinds of waiting at once: `slow GET /api/queues 87431ms cold — 87230ms of it waiting on 116 child process(es) (gh 15353ms + git 158ms + bd 1150905ms of work) and 192ms of it waiting on a sweep already running, ours 9ms; loop busy 4521ms` |
| `GET /api/timings` | every route, warm and cold, since the daemon started | what `npm run timings` prints as a table, and the only one of the three the **phone** can be measured through — a phone cannot show you a response header |

Off the running daemon, 2026-08-23 21:39 ADT — the first sample taken since `#570`
(bc-1kwl.33) put `loop` and `join` on the table beside the three columns `#471`
(bc-1kwl.22) made honest. Trimmed to the three routes that make the point; the daemon
had been up 5.5 hours and the rest of the table was ordinary warm asset requests:

```
$ npm run timings

beadcause request timings — 1451 requests over 5.5h  ·  budget 1000ms  ·  slow log at 1000

                                                                  —— cold ——            —— stale ——             —— warm ——
route                  loop  join      n     p50     p95     max  sub%     ×      n     p50     p95      n     p50     p95
GET /api/queues        0.06  0.02      6   37.7s   87.4s   87.4s  0.98 11.4×      ·       ·       ·      ·       ·       ·
GET /api/questions     0.05     ·      ·       ·       ·       ·     ·     ·      1    2.0s    2.0s      1   729ms   729ms
GET /api/work          0.95     ·      ·       ·       ·       ·     ·     ·      2    36ms    60ms      ·       ·       ·

over budget — p95 past 1000ms, cold or warm:
  GET /api/queues
  GET /api/questions
```

`loop` and `join` are the two new columns (bc-1kwl.30, bc-1kwl.33), and each prints `·`
rather than `0.00` on a route that never had one — the same convention the temperature
blocks already use, so a blank column reads as *never happened* rather than *happened for
zero milliseconds*. `GET /api/queues` above spent 6% of its wall clock with the loop
unavailable and 2% of it queued behind another request's sweep; both are real and neither
crosses the half-of-wall-clock share that would put the route on the `blocked behind the
loop` or `waiting on a sweep already running` block below the table — the two log lines
quoted above are where each one actually fires.

`GET /api/questions` above has **no cold samples at all** and is still over budget — its
one stale read, at a 2.0s p95, is what crossed the line, while its one warm read (729ms)
sits comfortably inside it. That is not a fluke of one sample; it is the exact shape the
next section explains.

That last block is the point of the whole thing: **the routes that miss the budget are
named**, rather than left to be read off a table. `--json` gives the snapshot as it comes
off the route, `--top N` the worst few, and `--parked` includes the long-polls.

**Cold, stale or warm, and that is not a hedge in the heading.** A route is over budget
on the worst of its three p95s, because a request that took a second and a half took a
second and a half whichever temperature it was filed under. `GET /api/questions` above is
the case that makes it concrete now: no cold samples, and still over budget, because the
rule was never really about *cold* — it is about the worst reading a route has, across
however many temperatures it has samples in. That used to mean two: `GET /api/session-log`
reads a transcript off disk, so it spawns no child, so it is *warm* by the derivation —
and it has no cold samples at all — the case bc-fg37 fixed the heading for. bc-1kwl.2.4
extended the same worst-of rule to a third temperature rather than writing a new one,
which is why nothing here needed to change except what the table, and this sentence,
call it.

### A request is as cold as its coldest read

The three words used to be a scalar that each read overwrote, which is exactly right
while a route reads one key — and it stopped being right the moment the routes this
instrument exists to judge began fanning out. One `/api/questions` calls the shared cache
about **thirty** times: `questions:`, `foundation:` and `agentbeads:`, once each per
workspace, against the ten workspaces configured here. They go out under one
`Promise.all`, so thirty writes to one field landed in whatever order they came home in,
and the word that survived was whichever read finished last.

**A single request mixing temperatures is the designed state here, not an edge case.**
The change detector re-sweeps `questions:` on its own tick with `refresh: true`, so the
daemon keeps that key warm without any request paying for it — and `foundation:` and
`agentbeads:` have no such tick and stand on the ten-second window alone. So the ordinary
`/api/questions` is ten warm reads racing twenty that may be cold, and which of
the three families got to name the request was a coin toss.

What that produced, off the live daemon on 2026-08-17:

```
[beadcause] slow GET /api/questions 47842ms stale — 47402ms of it waiting on 4 child process(es) (bd 86977ms of work), ours 440ms
[beadcause] slow GET /api/questions 18419ms stale — 18364ms of it waiting on 4 child process(es) (bd 22857ms of work), ours 55ms
```

Those lines cannot be true. A stale hit answers out of memory and starts its refresh
`detached`, so it is *incapable* of spending forty-seven seconds of the request's own
wall clock — the number and the word next to it describe different requests. What
actually happened is that the request paid a cold producer on at least one key and was
then relabelled by a warmer read that came home later.

**The direction is what makes it worth a fix rather than a footnote.** The mislabelling
runs the flattering way: it moves the *worst* samples out of `cold` and into `stale`, the
column this page calls the fastest kind of request there is. `overBudget` is filtered on
those buckets, so the fan-out that made a route slow was also what excused it — and every
figure quoted on this P0's children between the shared cache landing and this being fixed
was read off them. Suspect in a known direction, which is worse than noisy.

So `cache()` escalates instead of assigning: **cold beats stale beats warm**, and a read
can only ever lower the temperature the request already holds. One comparison, no new
field, and it says the honest thing — a single cold key in a fan-out *is* what the user
waited for. It is done there rather than by having `allQuestions` report once at the end
because the same shape is behind `/api/work` (`work:` per workspace) and `/api/prs`
(`board:` plus `prs:` per checkout), and a per-caller fix would have to be re-derived at
each of them and again at the next one. It does not touch the derivation: a route that
declares `warm` is still believed over a subprocess count that would derive `cold`.

**Expect the numbers to get worse on the day this lands, and that is the bug leaving.**
Every fanned-out route moves samples back from `stale` into `cold`, so figures quoted
before it are not comparable with figures quoted after — the earlier ones were flattered.
Nothing about the app got slower.

### What it found the first time it ran

Dated, because it is a measurement and not a claim about how the app behaves today —
2026-08-12, nine workspaces, load average 17/32/47 on a 12-core Mac, which is twenty agent
sessions and a test run, i.e. an ordinary afternoon here. Every `/api` route driven cold
and then again a second time.

| | cold | children | child work |
|---|---|---|---|
| `GET /api/prs` | **74s** | 83 | 665s |
| `GET /api/unendorsed` | **48s** | 49 | 167s |
| `GET /api/graph` | **21s** | 2 | 21s |
| `GET /api/work` | **7.0s** | 27 | 55s |
| `GET /api/questions` | **4.5s** | 15 | 22s |
| `GET /api/foundation` | **2.2s** | 9 | 9.9s |
| `GET /api/bead`, `/api/bead-links` | **1.1–1.9s** | 1–2 | ~1s |
| every route that spawns nothing | **0–1ms** | 0 | — |

Three things fall out of that, and none of them was knowable before:

- **The split is total.** A route that touches `bd` misses the budget by an order of
  magnitude; a route that does not is free. There is no middle group, and "ours" is
  single-digit **milliseconds** on every row — so there is no handler here worth optimising
  and nothing to be gained anywhere except in not spawning.
- **The second pass was not warm.** Not one `bd`-touching route came back warm, which is
  what the empty warm column means: the hand-rolled caches either do not cover these routes
  or expire faster than the sweep they cache takes to run. The PR board's 25-second cache
  cannot ever be warm when its own sweep costs 27–75 seconds. **This is the finding the
  shared cache was built against**, and the reason the fix is stale-while-revalidate rather
  than a longer window: a producer slower than its own freshness can only ever be warm if
  somebody other than the reader pays for the refresh.
- **The fan-out is doing a lot of work already.** `/api/prs` spent 665 seconds of child
  time inside a 74-second request — 13 processes deep on average. Sweeping *less*, not
  sweeping *wider*, is the only direction left.

### The long-polls are counted apart, and the reason is not tidiness

`/api/poll` parks for twenty-five seconds **on purpose**, and answering it sooner would be
the bug. Left in the same bucket as a page load it does not merely look bad, it destroys
every aggregate it touches: one parked poll outweighs a hundred real requests, and a p95
computed over both is a number about nothing. So the two poll routes are flagged `parked`,
kept out of the slow log and out of the over-budget list, and still measured — the
subprocess share of a poll that *did* return is a real fact about what the stream costs
the tracker.

### What it costs, and what it does not keep

Per request: two `hrtime` reads, one object. Per route: two fixed-size buckets and a ring
of the last forty durations, so the map cannot grow with traffic — and it cannot grow with
*paths* either, because past four hundred distinct routes the rest fold into one `other`
key and the snapshot says how many did, rather than looking complete.

It is in memory and **deliberately not persisted**. The figures are a claim about the build
that is running, and a deploy restarts the daemon anyway; a table that outlived the code it
measured would be worse than no table. Turning the slow log off (`slowRequestMs: 0`) turns
off *the log* and nothing else: instrumentation you have to switch on is instrumentation
that was off for every complaint nobody anticipated.

`test/timing.mjs` covers it, and two of its checks are the ones that matter. A
`bd`-sweeping route and a cheap one are fired **at the same time**, and the cheap one has
to come back warm having been charged nothing — `enterWith` on the wrong async resource
would leave every figure in the table plausible and untrue. And a real static file is
fetched, because a static file is handed to the socket as a read stream and never returns
through the dispatch at all: a `try`/`finally` around the handler would have missed every
page load in the app.

## The shared cache — past the window, nothing waits for the sweep

The table above says what is wrong and it is one thing: **every slow route in this app is
slow because it spawns**, and the caches meant to stop that were each a `{ at, value }`
next to the function that filled it. Seven of them, counted on 2026-08-13 — `Bd.graph`, the
ledger's per-workspace sweep, the PR board's board and the per-repo `gh` answers behind it,
the endorsement queue, the sign-in answer and the space picker's snapshot. Every one of them
was correct. Every one of them had re-derived the same argument, and not one of them had the
fifth property, which is the expensive one:

**Inside the window they cost nothing, and on the first second past it somebody paid the
whole sweep.** That is a cliff, not a cache. The PR board is the case that makes it obvious:
its window is 25 seconds and its sweep was measured at 74, so the poll behind the open page
arrived to find the entry expired **every single time** — a cache that could never once be
warm on its own, and a phone holding a spinner for over a minute for a screen it had already
been shown.

lib/cache.js is that argument written once. `read(key, producer, { freshMs })`, and five
properties:

- **Stale-while-revalidate.** Past the window the kept value returns *now*, synchronously
  from memory, and the producer runs behind the response. Nothing on the request path waits.
- **Single-flight, per key.** Two phones and a poll landing together on an expired key cause
  one sweep. On a single-writer Dolt the duplicates are not merely wasted — they queue behind
  each other, so the second set is slower *and* makes the first slower.
- **Last good beats empty.** A producer that throws over a key with a value leaves that value
  readable and puts the failure on the envelope. One `bd` falling over must not blank a
  screen.
- **Explicit invalidation, and therefore a key convention.** Keys are `<what>:<scope>` —
  `ledger:sorrel`, `prs:/Users/x/repo`, `board:` for a thing there is one of — so a write that
  changed one kind of thing can drop every scope of it by prefix without knowing which routes
  cached what. Nothing builds a key out of anything a request carries.
- **The cold miss is the only wait, and it is bounded — by two numbers, not one
  (bc-19vt.1).** `ceilingMs` is about the *slot*: a refresh that never settles must stop
  holding the single-flight entry, or that key is never refreshed again for the life of
  the process and the cache quietly becomes a permanent snapshot — 150 seconds, past
  `bd`'s own 120-second ceiling with room to spare. `waitMs` is about the *caller*: how
  long *this* `Promise.race` will wait on that slot before it is told "not yet", and it
  defaults to `ceilingMs` so a caller that never asked for the split sees no change. A
  caller with somewhere honest to land "not yet" can pass a much smaller `waitMs` — the
  slot still holds for the full 150 seconds and the sweep already running still lands
  into the keep, but the request that arrived on the cold key stops inheriting a wait
  that was never about it. Before the split, a phone landing on a cold `board:` key on a
  busy Mac hung for the whole 150 seconds even though the ⟳ behind it was going to answer
  "unavailable" either way — waiting bought it nothing.
- **And running out of the wait is a different answer from a producer that failed.** The
  error carries a flag, and `cache.timedOut(err)` is how a caller asks. It matters because
  the two mean opposite things: a producer that threw means *this source is broken*, while
  running out of `waitMs` means the source is fine, the Mac is busy, and the sweep is still
  out there and will very likely land into the keep a few seconds later. Three callers act on
  it, behind `/api/prs`, `/api/queues` and `/api/unendorsed`: `collectBoard` turns it into
  the same `unavailable` sentence a missing `gh` produces, and `gatherMerges` and
  `endorsementQueue` turn it into an `errors[]` row per workspace — because none of them was
  reached. Both shapes already existed for "this could not be read", and every reader already
  draws them. That combination — the shape *and*, since bc-19vt.1, the short `waitMs` those
  routes actually pass — is what stopped them answering **HTTP 500** on a busy morning and
  having the phone file a P0 incident bead about a daemon that was working, and then stopped
  the phone hanging for two and a half minutes to get there. `/api/unendorsed` was the one
  left out of bc-19vt and filed its own P0 the next day (bc-774a2), on a Mac with 37 child
  processes and 232 seconds of `bd` work behind that one key. An acting call (Ship, Merge)
  does not pass the short `waitMs` — it needs the real answer rather than a fast one, so it
  keeps waiting the full 150 seconds exactly as before. A producer that genuinely failed
  still throws, and still gets its 500.

### What is on it, and what is deliberately not

| Key | File | Window | What it holds |
|---|---|---|---|
| `ledger:<workspace>` | lib/history.js | 10s | One `bd list --all` per workspace, slimmed to the row a list draws |
| `board:` | lib/prboard.js | 25s | The whole swept PR board — every repo, every rung |
| `prs:<checkout>` | lib/prboard.js | 120s | One checkout's `gh` slug and pull requests |
| `queue:<workspaces>` | lib/endorsequeue.js | 15s | Every held bead in the active account's repos, with provenance |
| `questions:<workspace>` | lib/server.js, lib/openquestion.js | 10s | One `bd human list`, behind `allQuestions()` — and read *and filled* by the endorse row that draws the open question naming a bead, which serves the kept list when a refresh fails rather than blanking the flags |
| `foundation:<workspace>` | lib/server.js | 10s | One `bd list --label`, the foundation channel on its own |
| `agentbeads:<workspace>` | lib/server.js | 10s | One `bd list --exclude-label human` |
| `work:<workspace>` | lib/work.js | 10s | The four `bd` calls behind one workspace's row on `/api/work` |
| `graph:<workspace>` | lib/graph.js | 60s | `bd graph --all --html` + `bd list --status` — the workspace-wide graph page only (bc-1kwl.12) |

The first four windows are the ones each cache always had. Nothing here was retuned: the
point was never that the answers were too old, it was that the sixteenth second cost a
minute. **The last four had no cache to inherit a window from** (bc-1kwl.7) — the two
standing screens, the inbox and the advocate console, were swept fresh on every single
request. Their ten seconds is the ledger's own window and the ledger's own argument: a
bead that changed a moment ago is still ten seconds stale at worst, and the daemon's
own poll cycle already keeps `questions:` warm on a faster clock than that — see the
comment on `tick` in lib/server.js, which reads with `refresh: true` for exactly that
reason. `foundation:`, `agentbeads:` and `work:` have no such tick and stood on the
window alone until bc-1kwl.4 — which is a different question from how old an answer may
be, and is [below](#the-other-half--filling-a-key-before-anybody-asks).

**Why the board has no scope and the queue does**, when the account chip narrows both: the
board is swept for the whole Mac and narrowed *on the way out*, per request, so one cache
entry serves every account. The endorsement queue is narrowed *on the way in* —
`scopedWorkspaces()` is what the route hands it — so the set of workspaces it swept is part
of what the entry is, and an unkeyed one would be one account's held beads drawn on
another's screen for fifteen seconds after the switch. Whenever a cached thing is narrowed
before it is produced, the narrowing belongs in the key; that is what `<what>:<scope>` is
for, and a verdict drops the whole prefix rather than having to work out which accounts
contain the bead it just judged.

**`?refresh=1` still means what it meant.** Skip what is kept, pay the cost, the user asked —
the ⟳ on `/prs`, on `/endorse` and on the history page. It *joins* a sweep already in flight
rather than starting a second one, which is the right reading: a sweep that began a moment
ago and has not returned is reading the tracker now, so it is exactly as fresh as one started
here would be.

**With one exception, and it is the exception that proves the rule.** The PR board *drops*
`board:` before a forced sweep instead of joining one, because its producer is the only one
here that reads another cache — the board is built out of `prs:<checkout>`, which is two
minutes wide. Joining a background refresh would hand an acting call (a merge, a close, a
Ship) pull requests `gh` last answered for two minutes ago, while the code around it believed
it had re-swept, and every acting call on that screen sweeps forced precisely so a button
cannot act on a row the tab has been showing since last night. Dropping takes the in-flight
slot with it, so the sweep that follows really does force its way through to the network. The
rule to carry forward: **join an in-flight refresh when the producer reads a source; drop
first when the producer reads a cache.**

**And the drops are unchanged.** A verdict still drops the whole `queue:` prefix, because a bead you
have just judged has to leave that list on every other device and fifteen seconds of it still
being there is the one staleness that screen cannot afford. Every merge, close and comment
from this daemon still drops `board:` and the one checkout's `prs:` with it — the thing that
went wrong is the `gh` answer, and a board rebuilt from two-minute-old rows would still draw a
merged pull request as open. The ledger deliberately drops on nothing, because a bead that
changed a moment ago is still in the ledger and at worst its status is ten seconds stale.

**Two of the seven stayed hand-rolled, on purpose.**

- **The sign-in answer** (`authNow`, lib/server.js) is two `stat`s and possibly a small file
  read, and it is *synchronous* and on the front of the request path. There is no wait to
  remove, making it async ripples into every caller, and — the reason that actually decides
  it — serving a kept authorisation answer past its window is a security decision and must
  not be acquired as a side effect of plumbing. Its thirtieth second stays a hard edge, so
  switching sign-in on still takes effect without a restart.
- **The space picker's snapshot** (`spacesPending`) is not a cache at all: it has no producer,
  it is a variable the inbox sweep writes on its way past. Putting it on a read layer means
  giving `/api/spaces` a producer, and that producer is `bd human list` across every workspace
  behind a control drawn on every page in the app. It becomes convertible when the inbox sweep
  itself is a cache entry, and not before.

### The one thing it had to tell the instrument

Warm and cold [are derived](#timing-every-request--which-routes-are-actually-slow) from
whether a request spawned anything, which was exactly right while two states were all there
were. A stale hit answers from memory **and** spawns — so left alone every one of them would
have been filed under `cold`, and the change this file exists to make would have shown up in
the figures as no improvement whatsoever. So a read says outright which of the three it was,
and a background refresh is started detached, which puts its `bd` seconds in the daemon's own
column instead of on whichever request happened to trigger it.

How old an answer is also goes back to the browser, on a header rather than in the body:

```
x-beadcause-kept: fresh; age=3
x-beadcause-kept: stale; age=41; refreshing
```

A header because not every route on the layer answers with an object — a body-level field
would need an envelope at each call site, and an envelope changes what every existing client
parses. `age` is seconds, which is what a person reads and what HTTP's own `Age` means.
Deliberately not RFC 9211's `Cache-Status`, which covers this ground and is the standard
answer: it describes handling for *intermediaries*, and its way of saying "stale" is a
negative `ttl` — an inference, over a header a browser cache may also be writing. What a
screen needs is a word it can draw, from a name nothing else uses. **What failed is not in
there**: a message does not belong in a header, and every route on the layer already has an
`errors[]` naming the workspace that could not be read. The header says how old; the payload
says what went wrong.

`test/cache.mjs` covers the layer itself, and the check worth knowing about is the one for a
`drop` that races a refresh in flight. A refresh already out when the key was dropped read
the tracker *before* whatever the drop was about, so its answer is exactly the answer the drop
exists to get rid of — and it lands afterwards, quietly undoing the invalidation. It is not
hypothetical: it is what the ledger's own suite caught the first time this was wired in, as
one repo serving another repo's rows. So a refresh carries the generation it started under
and may only *write* if that is still the current one. It still finishes, and still answers
whoever was waiting on it — a ⟳ that raced a drop asked a real question and gets a real
answer; what it may not do is become the value the next reader sees.

### The other half — filling a key before anybody asks

Everything above takes the wait out of every read **but the first one**. Past the window a
kept answer comes back now and the producer runs behind it; the only request that still
waits on `bd` or `gh` is one that finds a key with nothing kept for it at all. So once
bc-1kwl.3 and bc-1kwl.7 had put the standing screens on the layer, the whole of what was
left of the latency budget was cold keys — and a cold key is not a rare event, because
every key in the process is cold again the moment the daemon restarts, which for beadcause
is **every merge**.

bc-1kwl.4 is the poll cycle filling them. The daemon is already awake on a clock, already
reading these very trackers; `warmKeys` in lib/server.js rides that beat and produces for
the keys behind the screens a notification sends somebody to. First paint after an hour in
a pocket is then a JSON read of memory, including the first one after a deploy.

**The gate is two questions, and neither of them is "is it stale".** That is the part worth
reading, because the obvious build is wrong in a way that undoes bc-1kwl.5. These windows
are ten seconds wide and a cycle is thirty, so *warm every cycle* means every producer
re-run every cycle, forever, for screens nobody is looking at — the exact daemon load
"[noticing in five seconds](android.md#noticing-in-five-seconds--and-not-sweeping-to-find-out)" spent
a bead holding down. `warmDue` asks instead:

1. **Is anything kept for it?** If not, warm it, whatever the clock says. This is the only
   state that can make a request wait, and it is the state at boot.
2. **Has its tracker been written to since?** `bd` is the only source these keys have, so a
   manifest that has not moved means a fresh sweep would return *the same bytes*. Age alone
   is never a reason to ask. When it has moved, a floor of one cycle applies — on a Mac with
   twenty agent sessions writing, something has moved on nearly every five-second beat, and
   without the floor "warm what changed" is "warm everything, six times a minute".

**Both questions are asked per key**, not per screen, and the producer is then handed only
the workspaces that answered yes. That is the correction worth naming, because the obvious
build gates a whole fan-out at once — and since these windows are ten seconds wide, by the
time a pass runs *every* workspace's entry is past it, so one repo being written to would
re-sweep nine.

Measured over three workspaces against a `bd` that logs every invocation:

| Pass | `bd` spawns |
|---|---|
| Boot — everything cold, all five things filled | 21 |
| Idle, keys filled, nothing moved | **0** |
| Windows expired, nothing moved | **0** |
| Windows expired, one workspace moved | 6 |

The two zeroes are the whole point. The six is one workspace's foundation channel, agent
beads and four console calls, and the floor caps it at once per cycle.

**Three keys are cold-only and own that rule themselves.** `queue:` because it is the most
expensive sweep in the app — a `bd list --label` per workspace plus up to forty `bd show`s,
48 seconds — so it is filled at boot and again after each verdict drops it, which is a
person acting and the moment the screen is next opened. `board:` because it is the only
warmed key that reaches the network, and the acceptance says daemon `gh` traffic with nobody
looking must not rise. Cold-only makes that literally true: after the first sweep something
is kept for `board:` for the life of the process, so the steady-state addition is none. What
it does add is one board sweep per daemon start, which the release queue would have made five
minutes later anyway — and those five minutes are the five right after a merge, when somebody
is most likely to open the board to watch the thing they just merged go out.

`graph:<workspace>` (bc-1kwl.12) is the third, and for the same reason `queue:` is: it is
more expensive still — `bd graph --all --html` walks the whole dependency graph, up to two
minutes on the worst workspace measured — so the `moved`-gated shape the recurring keys above
use would mean re-running a two-minute `bd` call on nearly every busy afternoon's beat. It is
warmed last, after `board:`, because it is the priciest sweep in the pass and every earlier
step is one Dolt-write queue it would otherwise sit behind.

**The pass runs beside the cycle, never inside it.** `warmSweep` does not await
`warmKeys`, and that is not a shortcut: `beat` refuses to overlap itself, so an awaited
warm would put a sweep for a screen nobody is looking at in front of the next `tick`, which
is the thing that puts a question on a phone. Detaching costs two things back — a guard, so
a pass that runs longer than a beat does not have a second started on top of it every five
seconds, and a `catch`, because an unhandled rejection out of a timer kills the daemon and
would leave the warmer switched off for the life of the process. Within a pass the order is
by cost and each step is awaited, so a warm is one thing queueing on Dolt's single writer
rather than four.

`test/warmcycle.mjs` is the gate. It counts producer calls rather than timing anything, for
the same reason test/cache.mjs does: a warmer that fills the right keys and asks twice for
them has failed at the only thing it was built for.

## Wireframes you can move — `design/`

There has never been a way to re-lay-out a screen here except by editing `style.css`
and looking at what happened. `design/inbox.excalidraw` is the inbox — the list, and a
card open — as boxes you can drag at <https://excalidraw.com>, save back over the same
file, and hand to a session as `git diff design/`.

Excalidraw and not Figma, and the reason is the round trip rather than the drawing.
Figma can be imported *into*: `html.to.design` will pull a live URL in as real layers
and it starts from a prettier picture than this does. What it cannot do is give the
file back — Figma's REST API is read-only for document content, so nothing an agent
writes becomes a `.fig`, and reading hand-edits out means walking node geometry and
re-deriving what somebody meant. That is a re-implementation, not a diff. An
`.excalidraw` is JSON in the repo: some fidelity given up for a loop that closes.

`design/wireframe.mjs` seeds a screen from the real numbers off `public/style.css` —
the topbar's 10/16/10, `--tabbar-h`, `--radius`, `.card-head`'s 14/15/0, the 12px list
gap, the 52px compose — because a wireframe that lies about spacing gets believed.
**It seeds once.** `--write` over a screen somebody has edited destroys exactly what
the directory exists to collect; `--check` is the safe verb and never exits non-zero,
because drift is the point. Nothing in `npm test` gates on it. Full loop, and the two
details that are load-bearing — bound labels, derived seeds — in `design/README.md`.

## The monitor — what it is doing right now

The daemon works invisibly: polling five workspaces, deciding whether a space is
allowed to interrupt, dispatching agents at your comments. `npm run monitor` is the
window onto that.

```
┌─ Beadcause ───────────────────────────────────── 127.0.0.1:4318  ● live ─┐
│ Personal  4 open                                              🔔 push on │
│ Work      1 open                              🔇 quiet until Mon 09:00   │
├─ sessions · unresolved (3)  every workspace ─────────────────────────────┤
│ sorrel   Sorrel - merge PR #83   sorrel ⟶ telemetry-d7q  closed  2h │
│ ehden    EHDEN - raise box to 30 jobs  ehden ⟶ exit-cone-c4e  closed  9h │
│ sorrel   Sorrel - sp-8drg.1 order sensors              sorrel  skipped 1d│
├─ questions (5) ──────────────────────────────────────────────────────────┤
│ northwind/cl-8f2  P1  Deploy to staging before the demo?              2d │
│    ✍️ drafting · comparing both fee models  auto-dispatch            12m │
│ sorrel/sp-1a9     P2  Which palette for the pricing page?             4h │
│    ⏳ waiting on an agent                                                │
├─ events ─────────────────────────────────────────────────────────────────┤
│ 13:02:11  reply      loremia/lm-5i2.39  from claude-session              │
│ 13:01:48  activity   northwind/cl-8f2   drafting · comparing fee models  │
│ 12:58:02  question   sorrel/sp-1a9      Which palette?  (quiet — not pu… │
└─ q quit · r refresh · w workspace · 0-9 pick · R resume ─ seq 1482 · 13:02 ─┘
```

`q` quits, `r` forces a full refresh. It reads `GET /api/poll` — the same long-poll
feed the phone lives on — so it is a **consumer, not new instrumentation**: a
monitor that is closed, wedged or never started cannot cost the daemon a question.
Agent progress is read straight from `status.json` as well as from the feed,
because `lib/dispatch.js` writes there without raising an event, and a monitor that
sat still while an agent was visibly working would be worse than none.

### The sessions pane — unresolved by default, one workspace on request (bc-wsgj6)

Since 2026-10-12 the frame opens on the **unresolved sessions**: every Claude Code
conversation on this Mac that was set aside and not finished. The word is one predicate,
`isUnresolved` in `lib/unresolved.js`, and it reads *named, not `done-`, no process
answering, not parked for an advocate, and a transcript to resume from*, within the last
week of transcript writes. A session that never named itself — a headless run, an advocate's
tick — is not listed, because nobody sat at it; a window the boot pass has just reopened is
given two minutes to write its record before "reopened and not live" reads as closed again.
That is the recommended reading of `bc-r2hmt`, and the question is still open: the answer is
a one-line change in that function, nowhere else.

The rows are read **locally** — the register, this boot's two reports, the live session
records and the transcripts under `~/.claude/projects`, the same sources `b7e-sessions` prints
— so the pane still draws when the daemon is down, which is when a list of what you had open
is most wanted. The transcripts are the only place a window closed while the Mac was up still
exists (the register drops it on purpose, see [the session register](advocates.md#written-down-while-the-mac-is-up--the-session-register)),
and each one's last `custom-title` line is the name `/resume` knows it by.

- **`w`** cycles through a **workspace view** — that workspace's sessions, unresolved first,
  then live, then the rest, with a rule that counts both — and back to every workspace's
  unresolved. **`1`–`9`** pick a workspace directly, **`0`** goes back. `--workspace <name>`
  starts there, which is also how `--once` renders one.
- **`R`** on a workspace view **resumes** its unresolved sessions. Twice within five seconds,
  because it opens up to twelve windows. The monitor sends `POST /api/sessions/resume` and
  prints the answer as one line in the events pane — how many came back, what was skipped
  and why; the windows themselves are opened by the daemon, through the same
  `openResumedWindow` the boot pass uses, each into its own directory under its own name in
  its workspace's iTerm window, with **no prompt**. The daemon writes `resumeReport` to the
  state in the boot pass's row shape, and the register poll hands each window its name back
  from it, as it does after a boot.

The pane is sized to what it has, up to two fifths of the frame, and counts the rows it
cannot draw (`… 249 more`) rather than drawing them off the bottom.

Quiet state is recomputed locally every second rather than trusted from the poll —
it turns over on a clock, and "why didn't my phone buzz" is the question this is
going to be asked.

**Starting it at login.** Answer `y` to the *open the advocate console at login?*
question in `npm run configure` and
`npm run install-service` generates a second LaunchAgent, `n12n.beadcause.monitor`,
that opens the monitor in its own iTerm2 window when you log in. It is off by
default, because nobody installing this for the first time should find a terminal
window opening itself.

launchd cannot draw a window — a LaunchAgent is headless — so the agent runs
`scripts/open-monitor.sh`, which drives iTerm2 through the same
`scripts/open-session.applescript` the "discuss on the Mac" button uses. macOS will
ask once for permission to control iTerm; if it is refused, the log says so and
what to click. The agent fires once and exits; the window it opened outlives it.

```bash
npm run monitor                  # foreground, any terminal, no install needed
node bin/monitor.js --once       # one frame and exit
node bin/monitor.js --url https://<host>.<tailnet>.ts.net:4318   # another machine's daemon
launchctl kickstart -k gui/$(id -u)/n12n.beadcause.monitor   # reopen the window now
```

Piped rather than shown on a terminal, it drops the box and prints one line per
event instead, so `node bin/monitor.js >> somewhere.log` does something sensible.

### Every Claude session on the Mac, live — `beadcause-top`

The monitor above is the *daemon's* view: workspaces, queues, questions. `beadcause-top`
(`bc-5to5r.7`) is the view of the **Claude Code processes** on this Mac — the windows you
opened by hand and the ones the daemon opened, one row each, redrawn every three seconds
like `top`:

```
beadcause-top  ·  10 live (3 busy, 7 idle), 1 not back  ·  booted 12 minutes ago  ·  register 40s ago  ·  10:51:02
boot pass 11 minutes ago: 9 reopened, 1 skipped

session                                 ws            bead         kind  state      ctx       cpu    mem   up        where                                   last write
──────────────────────────────────────  ────────────  ───────────  ────  ─────────  ────────  ─────  ────  ────────  ──────────────────────────────────────  ──────────
Northwind - SOC 2 first: fix records    architecture  cl-xl7n.195  adam  busy 4s    412k 41%  38.0%  912M  00:11:40  architecture ⟶ soc2-first-order-e4b     4s
beadcause - bc-5to5r.7 beadcause-top    beadcause     bc-5to5r.7   work  idle 2m    88k 44%    0.3%  402M  00:09:12  beadcause ⟶ beadcause-top-5to5r7-m3k    2m
```

Each column comes from somewhere that already exists — nothing was added to the daemon
for it. **state** is the session record's own busy/idle and since when. **ctx** is the last
`message.usage` in the transcript (input + cache read + cache creation: what the model was
handed, the same number the status line shows inside the session) over a limit inferred
from the model id (`1m` → a million, else 200k; `CLAUDE_CTX_LIMIT` overrides), so it is a
percentage worth glancing at and not a fact worth quoting. **cpu**, **mem** and **up** are
one `ps` over every live pid. **kind** is the daemon's record of the window (`work`,
`handoff`, `ship`, …) or `adam` for a window it did not open; **bead** likewise, or a bead
read off the window's name. Rows the boot pass decided about and that have not come back
(`reopened`, `parked for its advocate`, `skipped — …`) sit under the live ones with no
numbers. The header counts the sessions and says when the Mac booted, when the register was
last polled and what the reboot pass did for *this* boot.

```bash
beadcause-top                    # redraw every 3s; q quits, r redraws now
beadcause-top --every 10
beadcause-top --once             # one frame and exit
beadcause-top --json             # the rows as one object
b7e-sessions --watch             # the same view, by the name a session already knows
```

**After a boot the daemon opens it.** Once the reboot pass has run (`lib/rebootresume.js`,
only on a real boot, never on a hot swap), `bin/beadcause.js` opens `beadcause-top` in an
iTerm window **of its own** — recorded under the key `beadcause-top` in `itermWindows`, not
under any workspace, so it is never a tab among the conversations that just went back into
their workspaces' windows (`bc-5to5r.6`). It is read-only, needs no token and does not
talk to the daemon, so it works when the daemon is down, which is when it is wanted most.

### A cron entry that never returns — `monitor --once`

The long-poll loop has always been careful about a connection that stops answering: an
`AbortController` around every request, armed at `POLL_TIMEOUT_MS` (40s, which is
`wait=25` plus room). The `--once` path — one cold fetch, draw, exit — shared none of
that, and for a long time nothing showed it, because the failure everybody actually has
is a daemon that is **not running**. That one refuses the connection, `ECONNREFUSED`
comes straight back, and the offline frame draws in milliseconds.

The case that costs you is a daemon that completes the handshake and then never writes:
a router mid-restart, a backend wedged on a lock, an ssh tunnel whose far end has gone.
There `--once` blocked with no upper bound and no output at all — the worst available
shape for the one mode the documentation advertises for *screenshots, cron, sanity checks*,
because a cron entry that never returns is a cron entry that stacks up. bc-34ku.

`ONCE_TIMEOUT_MS` is **ten seconds**, and deliberately not the loop's forty. A cold poll
sends no `since` and no `wait=`, so the server composes a snapshot and answers at once;
ten seconds is not impatience, it is the point past which the daemon is not answering at
all. Past it the frame draws with `no answer` on the connection line — the same two words
the loop uses for its own abort, which is the whole point of them: a refused connection
says `ECONNREFUSED` instead, and the two failures must never read alike.

`node test/monitoronce.mjs` drives a real `net.createServer` that accepts and says
nothing, and asserts the bound from both sides — that the child returns, and that it did
not return *sooner* than the timeout, which is what would happen if something other than
the timeout were ending the request and the suite had quietly stopped measuring
anything. The refusal is driven beside it as the control, on a claimed `freePort()`
rather than something like `:1`: a privileged port comes back through undici with no
`cause.code` at all, so the frame would say `fetch failed` and prove nothing about which
failure it was.

## The router — why you never restart it

Static files are read from disk on every request. Server code is read **once**, at
startup. So an edit to `lib/` leaves a running daemon serving today's pages against
yesterday's routes, and nothing about it looks wrong: the files are correct, the
process is healthy, and a path the page plainly asks for returns 404.
That happened against a ten-hour-old process, and "remember to restart" is not a fix
— forgetting is the entire bug.

What launchd runs is therefore `bin/router.js`, not the server:

```
     phone ──▶ :4318  router ──▶ :49223  backend (active)   ← polls, notifies
                        │
                        └─────▶ :49238  backend (draining)  ← standby, no poller
```

The router owns the port and never needs replacing. It compares the files on disk
against the build the backend reported *at its own startup*, and when they part it
brings a second backend up beside the first, waits for it to answer, stands the old
one down, promotes the new one, and drains the old one's remaining sockets before
killing it. A few seconds after you save, the port is answering from new code, and
nothing in flight was dropped.

Two properties it holds onto, both of which cost more than they look:

- **Exactly one poller, ever.** A backend starts in `--standby`, with no poller and
  so no advocates and no notifications. The old one is told to stand down *before*
  the new one is promoted, never the other way round — two live pollers would both
  see a new question and both push it, and a duplicate notification on your phone is
  the one thing this must never produce. The few milliseconds in between cost
  nothing; the next tick picks up whatever appeared.
- **Nothing in flight is cut.** `/api/poll` parks for up to 55 seconds by design, so
  a superseded backend is left alive until its last request finishes (or 60 seconds
  pass). Killing it under a parked poll is the difference between a seamless swap and
  the phone deciding it is offline.

Every response carries `x-beadcause-build` and `x-beadcause-pid`, so `curl -sI`
against the real port settles the question that started all this:

```bash
npm run swap:status     # active pid, build, whether disk has moved past it, the certificate
npm run swap            # swap now, even if nothing changed
npm test                # drives a real swap under load and proves nothing drops
curl -sI http://127.0.0.1:4318/api/health | grep beadcause
```

The limits, stated plainly:

- **The router cannot replace itself.** Doing so means giving up the socket, which is
  the outage the whole thing exists to avoid. Change `bin/router.js`, `lib/build.js`,
  `lib/config.js` or `lib/service.js` and you restart it by hand with
  `launchctl kickstart -k gui/$(id -u)/n12n.beadcause`. It is small and it rarely
  moves, which is the trade — and it is the one state here that does **not** clear
  itself, which is why
  [it gets a screen of its own](#a-router-older-than-its-own-source-and-where-that-finally-shows).
- **A build that *dies* is condemned; a build that is merely slow is retried.** If the
  new backend exits before it is healthy — a syntax error, a bad import — the old one
  keeps serving and that build is not retried until the files change again, because
  respawning a broken process every three seconds helps nobody. But a child that is
  still alive and simply has not answered yet is a fact about the *machine*, and the
  two used to be the same thing: on a Mac running ten agent sessions, two other routers
  and eight headless Chromes, a backend that binds in ~2s did not answer inside the
  twenty-second window, and a perfectly good build was condemned. Twice, in one evening.
  So the window scales — it doubles per attempt, and the router remembers how slow this
  machine has been proving to be — and a build that runs out of patience is *deferred*
  rather than poisoned: tried again on the clock, with a longer window, until it comes
  up on its own. `npm run swap:status` says which of the two it is looking at, in the
  two words that are not interchangeable. See `lib/startup.js`, which is where the
  policy lives, with no I/O in it so that `npm test` can assert it as arithmetic.
- **And a build that could not get a *port* is neither of those.** The router picks each
  backend's internal port from the kernel and then spawns the process that binds it, and
  the gap between those is a node startup wide — long enough that on a laptop running
  twenty agent sessions something else can take the number first. The backend then exits,
  and "exited" meant *broken build*: the comment in `attemptStart` said the next spawn
  would break identically, which is true of a syntax error and is the exact opposite of
  true here, because the next spawn asks for a different port. So a build that was never
  broken was condemned, the phone went on being served by the previous one, and the
  evidence was one line in a log file. A bind that fails now exits with its own code —
  `PORT_TAKEN_EXIT`, which is the only channel a backend has to its router, since both
  inherit the same launchd log and neither reads it — and the router retries it *at once*
  on another port, up to `PORT_ATTEMPTS` times, spending neither a health attempt nor a
  mark on `slowness` on it. It can never poison a build: `poisonable()` is the one place
  that is decided, and only a plain `exited` may. If all three tries lose, it is deferred
  like a slow start but says so in its own words — every surface that reads a deferral
  otherwise reports "too slow to answer", which sends whoever is reading it after load
  and then after the build, and it is neither. `test/ports.mjs` covers it, end to end for
  the exit code and as arithmetic for the policy.
- **Nor is a build that was *stopped* — and "exited" was still swallowing two of those.**
  `exitKind` was asked only for the child's exit *code*, and a child that dies on a signal
  has no exit code at all: `code` is `null`, `null` is not `PORT_TAKEN_EXIT`, and the
  answer came back `exited`. So a backend the OOM killer took, or a stray `pkill node`,
  or a runner tearing down a suite, condemned the build it happened to be running — on
  the machine where that is *most* likely, which is the one with twenty agent sessions on
  it. The other one is stranger and was harder to see: **a clean exit 0**. Nothing broken
  exits zero — a syntax error, a throw at import and a bad config are all non-zero — so a
  zero is a child that *chose* to stop, and `bin/beadcause.js` has exactly one such path.
  Its orphan guard `process.exit(0)`s a backend that has had no router contact for
  `ORPHAN_MS` (60s), and a start can outlive that: `healthDeadline` climbs to
  `HEALTH_CEILING_MS` (120s) once the router has learned this machine is slow, so the
  guard fires halfway through a window the router is still patiently waiting out. Both
  are now `STOPPED`: never poisonable, deferred like a slow start but saying `stopped
  before it was healthy` rather than `too slow to answer`, and quoting the `(code 0)` or
  `(signal SIGKILL)` that is the whole diagnosis. The signal has to be *passed* for any
  of that to work — `exitKind(child.exitCode, child.signalCode)` — which is a call-site
  mistake `exitKind`'s own tests can never catch, so `test/ports.mjs` reads the router's
  source for it. bc-r0tx, and it is the third road to bc-dw47's and bc-excc's failure.
- **A router with nothing behind it says so, in three places.** The failure above has a
  worse cousin: when there is *no* old backend to keep serving, the router holds the
  port and answers 503 to everything. Nothing is down in a way launchd would restart,
  the port is bound, and the app is gone. Two things follow from that. The router keeps
  trying — with no active backend, poison and deferral are both ignored, because the
  worst outcome of retrying a broken build is the 503 you already have, and that retry
  did not exist before: `watchDisk` returned early with no active backend, so a *first*
  start that failed was final. And the state gets surfaces that do not depend on the
  thing that is down: the 503 itself is a page saying which build, whether it died or
  was only slow, and when the next attempt is (it reloads itself, so it becomes the app
  again with no tap), and an ntfy push goes to the phone — the same argument as the
  certificate warning, since every other channel this daemon has runs through the
  backend that is missing. A recovery push follows, because an alarm you are never told
  is over is an alarm you learn to ignore. All three surfaces are tested against a real
  router driven into the outage on purpose: `test/slowstart.mjs` for the log and the
  503, and `test/outagepush.mjs` for the push, which points `ntfy.server` at a ten-line
  http server inside the test and asserts that exactly one outage push arrives however
  many bring-ups fail after it, that it names the build, and that the recovery push
  arrives too. The push was the one surface with no test for a while, which is the wrong
  way round — it is also the only one that works when nobody is at the Mac. **"However
  many" is load-bearing in that sentence, and the suite got it wrong for a while.** It
  proved the router kept trying by counting `would not start in time` lines and requiring
  a second one before the recovery — but `healthTimeoutMs` there is 250ms, a window no
  node process starts inside, so whether there *is* a second failure to count is a fact
  about how loaded the Mac is rather than about the router: busy and the next attempt
  loses that race too, quiet and the backend simply comes up. Two sessions gated a
  delivery on a full run and got a red that reproduced in none of the runs after it,
  over a router log that reads as a textbook recovery (bc-nqrr, bc-vwc9). It counts the
  retry *attempt* now — `bin/router.js` logs that before there is an outcome, so it is
  the same fact on either machine, and it is the fact the check is named after. The teeth
  did not move: a router that gives up logs no further attempt and the wait still times
  out. This is the general shape worth recognising in a flaky suite — an assertion whose
  subject is fine and whose *threshold* is whatever the machine did, which
  [teaches people to re-run rather than read](development.md#a-teardown-must-not-be-able-to-fail-a-run--testhelperstmpmjs).
- **And the degraded half of that is on the advocate console.** `/api/work` carries
  `router` beside `service`: one dim line naming the build being served on a good day,
  and an amber block when the phone is on an older build than the disk — because the
  newer one died, or because it was too slow and is being retried. Amber rather than
  the red above it: on all of these the app is up and answering, which is a different
  sentence. A *total* outage is not visible there by construction — the console is
  served by the backend that is missing — which is exactly why the 503 and the push
  exist and why they belong to the router rather than to the app.
- **The stamp is size and mtime**, over `lib/*.js` and `bin/*.js`. `public/` is
  deliberately absent: it is served from disk per request, so a CSS edit is live
  already and swapping for one would be churn. `touch lib/server.js` is enough to
  force a swap by hand.
- **Every handover is written down, because a swap is a restart nothing else can see.**
  The quiet window that stops a reconnect filing a P0 per open screen reads the deploy
  journal, and a swap writes no deploy record — so the router leaves `restart.json`
  instead, at the moment `active` is reassigned and not when the new backend was spawned.
  See [a swap is not a deploy](incidents.md#a-swap-is-not-a-deploy-so-the-router-leaves-a-marker-of-its-own).
- **A backend nobody is steering shuts itself down.** If the router is `kill -9`'d,
  its children survive it — and a stranded backend still holds a poller while the
  replacement router starts a fresh one. So a backend that has heard nothing from a
  router for 60 seconds exits. `npm run start:bare` has no router and is exempt.
- **None of it is live until `npm run install-service` has been re-run.** The plist in
  `~/Library/LaunchAgents` is generated once and never touched by `git pull`, and a
  deploy used to `kickstart` a *label* without looking at what the label points to. So
  the router landed, the installer was updated, this section was written, and launchd went
  on restarting `bin/beadcause.js` for three days with the port answering perfectly the
  whole time. Nothing was broken; nothing was live. It is now checked in four places,
  because the halves fail apart: the installer reads back from `launchctl print`
  what it actually loaded, the daemon prints a `HOT-SWAP IS NOT LIVE` banner when
  launchd started *it* rather than the router, `npm run swap:status` names the
  installed program instead of only reporting that nothing answered, and
  [a deploy refuses to restart a label](pull-requests.md#restarting-a-label-is-not-the-same-as-deploying-a-tree)
  whose plist has drifted from the tree it just pulled. A plist rewritten
  without a bootout counts as stale too — launchd keeps the argv it bootstrapped with,
  so editing the file changes nothing on its own.
- **And it says so where somebody is standing.** All three of those checks land
  somewhere nobody looks: `~/Library/Logs/beadcause.log`, and a command you only type
  once you already suspect something. The reason the original bug survived three days is
  that the inbox and the advocate console — the two surfaces actually read, from a phone,
  every day — reported nothing at all, because from their point of view the port was
  answering perfectly. So **the advocate console carries the same verdict**, above every
  card, on `/api/work`'s `service`: one dim line naming the program launchd runs when it
  is the right one, and a red block with the diagnosis and `npm run install-service` when
  it is not. It is drawn on a good day deliberately — a health line that appears only
  when something is wrong teaches you to read its absence as health, which is exactly
  what that console did while it was wrong. The one wrinkle is that the process serving
  the console is a *grandchild* of launchd, so the router passes down what it was handed
  in `BEADCAUSE_LAUNCHD_PROGRAM`; a backend reading its own `argv` would call every
  healthy install stale.

### A router older than its own source, and where that finally shows

The bullet above says you restart it by hand. The question that leaves open is *how you
find out you need to*, and for a long time the honest answer was "by chance".

Every other degraded state in this section resolves on its own. A stale build swaps in
seconds. A build that was too slow is retried on the clock. A poisoned one clears the
moment the files move. The router's own source is different in kind precisely because it
cannot be acted on: the process holding the socket stays on the code it started with
until somebody restarts the daemon, and nothing — no swap, no merge, no deploy of
anything else — changes that.

It had two surfaces, and both are places nobody stands. One line in
`~/Library/Logs/beadcause.log`, said once at the moment it happens and never again. And
a marker on the router line of `npm run swap:status`, which nothing runs on a schedule:

```
router   pid 62191 on :4318  ⚠ source changed — restart it
active   pid 43669 :58756 build 2c87352d7141 active inflight 2 up 494s
disk     2c87352d7141  (matches what is running)
```

Read that output and the last two lines are reassuring, which is the trap: the *backend*
is current, the hot-swap worked, the disk matches what is running. Only the first line
is about the process in front of them. So a fix for a stopped Tailscale merged, deployed,
and did not run on this Mac for a day — while the advocate console's health line showed a
green ✓ naming a build that genuinely was current. It was naming the backend's.

That verdict is now the same one everywhere, which is what `explain()` in `lib/startup.js`
is for: the log, `swap:status`, and the health block on the advocate console, said in one
vocabulary. A router running old code reads there as an amber block of its own —

> ⚠ **THE ROUTER IS RUNNING OLDER CODE** · `router-source`
> serving build `2c87352d7141`, but the router in front of it is older than its own source
> restart it: `launchctl kickstart -k gui/501/n12n.beadcause`

— and three details in that block are each there because of a specific way it went wrong:

- **Its own headline.** The two the block already had are `THE PHONE IS ON AN OLDER BUILD`
  and `NOTHING IS BEING SERVED`, and both are false here. The phone is on the current
  build; what is old is the program in front of it.
- **Its own verb.** The other states are fixed with `npm run swap`, so the fix line said
  *force it*. A swap is the one thing that cannot clear this — it replaces the backend,
  which is already right — and it is the obvious thing to try from a screen that has just
  told you something is behind.
- **The command, from the router itself.** The uid and the LaunchAgent label are facts
  only that process holds, so it publishes the whole line on `/internal/router/state`
  rather than having three readers each rebuild it. A router too old to carry the field
  still gets the diagnosis, without the command.
- **It never displaces anything more urgent.** The backend states are all about what the
  phone is being served *right now*, so they win; the flag rides the payload as
  `sourceChanged` underneath whichever verdict is being shown, because a poisoned build
  in front of a stale router is both, and only one of them fits on the line.

`test/routersource.mjs` covers the rule as arithmetic, `--status` end to end against a
stub control plane, the passthrough on `routerHealth`, and the drawn block itself.

### The WebSocket goes through it too, and a swap ends it on purpose

[The terminal](android.md#the-terminal--driving-a-session-from-the-phone) is an HTTP upgrade, and
an upgrade is not a request the proxy above can carry: `connection` and `upgrade` are
hop-by-hop headers — they describe *this* hop — so a proxy strips them, and has to state
them again when it means to open the next hop as a tunnel. The router did the first half
and not the second. A server with no `upgrade` listener hands the request to its
ordinary handler rather than refusing it, so `GET /ws/terminal` reached the backend
looking like any other GET, missed the upgrade listener there entirely, and the app
answered the only thing it could: `404`, reported by a browser as `Unexpected server
response: 404`.

Which made it the exact shape of the bug this whole section exists to prevent — correct
files, a healthy process, and a path the page plainly asks for returning 404 — with one
extra turn of the screw: it worked perfectly under `npm run start:bare`, where the phone
reaches `lib/termsocket.js` directly, and that is the one configuration launchd never
runs. Both halves are load-bearing, and the suite proves it by breaking each one on its
own: a listener that forwarded the stripped headers produces the identical 404 one hop
later.

So the router tunnels it. It dials the active backend carrying the original `upgrade`,
`connection` and `sec-websocket-*` headers, relays the `101` back along with whatever
bytes followed it — `ws` sends its first frames immediately, and dropping them would eat
the `hello` the page waits for — then pipes the two sockets together and never looks at
a frame. Nothing in `lib/termsocket.js` changed and nothing should: the handshake, the
subprotocol carrying the token, and the accepted-then-closed `1008` for an unknown id
are the same whether the socket arrived over loopback from the router or straight off the
tailnet. A refusal that is *not* a 101 — `401` for a bad token, `404` for a path that is
not the terminal — is written back verbatim, because a proxy that turned that into a
dropped socket would cost the client the one useful sentence in the exchange.

**What a swap does to an attached terminal is a decision, and this is it.** The pty is a
child of the backend and cannot outlive one, so there is no version of this where the
terminal survives a swap — only versions where it ends well or badly. Left alone, an
attached socket holds `inflight` above zero for the whole 60 seconds of the drain: the
phone spends a minute typing into a process that is already condemned, and then loses it
mid-keystroke with `1006`, which is indistinguishable from a tunnel. So the outgoing
backend is asked to close them itself, with a real close frame carrying **1012 — Service
Restart**. The page reconnects within a second onto the new backend, where the record has
come back `resumable`, and `claude --resume` puts the conversation back with the note
that [says so](android.md#and-it-survives-the-daemon-too). The socket is counted in `inflight`
either way, so a backend is never killed out from under one; `npm run swap:status` names
the count beside the requests.

### Every line it writes carries the time it wrote it

`~/Library/Logs/beadcause.log` used to carry no times at all, and the lines are good
enough that it took a while to notice what that costs. "opened a session on bc-y3qk.3 in
`<path>` (auto, opus (unrated), attempt 1)", "claimed bc-y3qk — a window here has it open
(pid 74048)": reading it you can reconstruct almost everything except *when*, and
therefore except **order across subsystems**. The file is append-only so the lines are
ordered, but they come from a daemon interleaving sweeps, dispatches, merges and syncs
plus its child processes, and line 58021 sitting above line 58251 says nothing about how
far apart they were. "The sync recovered on the very next tick" and "the sync recovered
four hours later" are the same two adjacent lines.

bc-zjab is what that cost. A plan was filed and its children were dispatched ungrouped
about two minutes later; the obvious hypothesis was a tick whose survey ran before the
`planned` label landed, which is cheap to test and was impossible to test *here* — the
log records both events in order and stamps neither. Two sessions failed to close it, and
a defect card went out carrying a guessed cause that turned out to be wrong.

So every line is prefixed with `2026-08-18T22:41:03.512Z ` — ISO 8601, UTC,
milliseconds. UTC because this repo has already misread tracker timestamps as ADT and a
bare `19:43:54` is that trap again; milliseconds because the question that started it is
decided inside one second; and that exact shape because it sorts as plain text, which a
local wall clock stops doing twice a year.

**It is a prefix and nothing else.** Greps and line-number citations into this file are
already written into beads, notes and suites, so no line is reflowed, re-worded,
re-ordered, added or removed, and `grep "could not hand"` still finds what it found. The
mechanism is one wrapper over the console methods in `lib/logstamp.js` rather than a
stamp threaded through the ~300 `console.log` call sites — 182 in `lib/server.js` alone —
because 300 edits is 300 chances to miss one, and a wrapper covers the lines nobody has
written yet.

Two things about it are decisions rather than accidents. **Every line of a multi-line
write is stamped, continuations included**, because an unstamped continuation is exactly
the failure being fixed: you grep for a phrase, land on a line, and it has no time.
**A blank line stays blank**, because stamping a separator turns it into content for a
timestamp that orders nothing.

And it installs itself *on import*, which is why `bin/router.js` and `bin/beadcause.js`
both have `import '../lib/logstamp.js'` as their first line. A call in the body would run
after every other module had been evaluated, and one of them prints while it is being
evaluated — `lib/resolvers.js` restores the previous daemon's resolver windows at module
load and says so — so an explicit call would leave that line, and any added later,
silently unstamped. The CLI modes of those same bins are excluded inside the module, and
one of them would break a build rather than a log: `BASE_URL=$(node bin/beadcause.js
--url)` in `scripts/build-android.sh` wants an address, not an address with the time in
front of it. `--qr`, `--status` and `--swap` are a terminal somebody is reading. None of
the four is ever run by launchd or by the router, so none of them reaches this file.

### Candidates — what a green backend will be spawned from

DemoMode (bc-sj8k) serves an open pull request beside the live build. What it serves is a
**candidate**, and `lib/candidate.js` is the only thing that makes, names, judges or removes
one (bc-sj8k.7):

- **A detached worktree at the pull request's head**, under `.claude/candidates/<id>/`,
  fetched from GitHub's own `refs/pull/<n>/head`. Detached because git will not check one
  branch out twice and the session that opened the pull request is usually still on it; not
  under `.claude/worktrees/` because it is not a session's and outlives the one that made it.
- **One id** — `<repo key>.pr<n>.<12 hex of the head>` — which the router, the card, the
  approve button and a notification all use. A push is a new candidate, not the old one
  changing: what was tried is one commit.
- **A verdict it reads**: `stage` from `stageOf` in `lib/prstage.js` and `gate` from the
  pull request's check rollup (`pass`, `fail`, `pending`, or `none` — never read as a pass).
- **Servable, or said not to be** (bc-sj8k.6). Preparing it lends it the checkout's
  `node_modules` and runs the head's own `scripts/vendor.js`, so a backend spawned from it
  serves marked, purify, mermaid, d3 and xterm rather than a page that boots green with none
  of them. The record's `servable` says whether that worked and `unservable` says why not —
  read it before spawning anything.
- **A record** beside it, `<id>.json`. The directory listing is the registry.

The daemon's slow cycle asks GitHub about every candidate every ten minutes. Merged, closed,
gone or pushed past retires it and removes its worktree; the base moving only flags it
`behind`, because `main` moves too often here for that to be an ending. A pull request GitHub
could not be asked about is kept — an outage is not a merge.

**Green — the router keeps one standing (bc-sj8k.1).** `node bin/router.js --green <id>` (or
`POST /internal/router/green?id=`) spawns a second backend from the candidate's own
`bin/beadcause.js`, in its own tree, on its own internal port — and keeps it up, rather than
handing over and draining as a blue swap does. What that buys and what it refuses:

- **Never activated.** Green lives its whole life in standby: no poller, no pushes. Two
  pollers is two notifications, the one failure a handover is ordered to prevent.
- **Refused before it exists** when `lib/candidate.js`'s `greenRefusal` says so — no record,
  no worktree, `servable` false (its `unservable` sentence is the refusal), or no backend in
  the tree.
- **Blue's startup policy, its own verdicts.** A candidate that *exits* before it is healthy
  is condemned by id (a push is a new id, so it is tried afresh); one that was only slow is
  not. Neither sets `poisoned`, touches `active` or waits on a blue swap.
- **One at a time.** A second candidate replaces the first only once it is healthy; one
  that will not start leaves the first standing.
- **Survives a blue swap, or is dropped loudly.** A swap never touches it. Its process
  dying, its worktree being torn down by the sweep (noticed on the next ten-second
  heartbeat), or `--drop-green` each drop it with a `green: DROPPED` warn line and a
  `greenLast` on the state, which `--status` prints.

**A device reaches green by cookie (bc-sj8k.8).** Same URL, same sign-in: the router
reads a `beadcause_demo` cookie whose value is a candidate id, and sends that device's
requests and terminal upgrades to green only while *that* candidate is the one standing
there. Every other device stays on blue. The router answers two routes itself and never
proxies them:

- `/__demo/green?id=<candidate>` sets the cookie and 303s to `/`. With no id it means
  whatever is on green now. It is a 409 when that candidate is not standing.
- `/__demo/blue` takes the cookie off and 303s to `/`. It works whatever is behind the
  port, and that is why the router owns it rather than the app. A candidate branched
  before DemoMode existed has no such route, and a flip onto it must not strand the phone.

A cookie naming a candidate that has gone (dropped, died, torn down, or replaced by the
next pull request) is served blue, and the response clears the cookie. A request that was
on green when green went away gets the swap-drain 503 (retry), not a 502, and the retry
lands on blue. Every proxied response says which side answered in `x-beadcause-env`
(`blue` or `green`), plus `x-beadcause-candidate` on green.

## The tailnet address, when Tailscale is not up yet

Everything above assumes there is an address to bind. There often is not — not because
anything is broken, but because launchd starts beadcause at login and Tailscale has
frequently not finished connecting at that moment. `cfg.host` is a Tailscale address, so
for those few seconds it is on no interface of this Mac, and binding it fails with
`EADDRNOTAVAIL`.

**What used to happen then is the whole of this section.** Both bind loops treat a bind
failure as fatal only when *every* address failed:

```js
if (++failed === hosts.length && bound === 0) process.exit(PORT_TAKEN_EXIT)
```

Loopback binds, so `bound` is 1, so the process carried on — serving `127.0.0.1` and
nothing else, for as long as it stayed up. One line of `EADDRNOTAVAIL` in a launchd log
nobody reads was the only trace anywhere. `npm run swap:status` said the build was
active. `curl http://127.0.0.1:4318/` said 200. The phone got nothing, and the cure was
noticing by hand and running `launchctl kickstart` after starting Tailscale. That is a
morning, and it is bc-b4fs.

**The obvious fix is the wrong one.** A check that shouts at startup cries wolf at every
boot, because the honest state a second after login is *not yet* rather than *broken* —
and a daemon that shouted and then served loopback forever would still need the restart
by hand. So the check keeps watching:

- **It says which of the states it is in**, not just that a bind failed. `lib/tailnet.js`
  tells five apart, because they have different cures and only one of them is an outage:
  `here`, `starting` (Tailscale names this address, the interface is still coming up —
  the ordinary state at login, and it must not read as a failure), `stopped` (something
  to start), `moved` (Tailscale gives this Mac a *different* address now, so the config
  is stale — nothing to start, something to rewrite) and `no-cli` (a machine that never
  had Tailscale, and is loopback-only on purpose).
- **It binds the address when it appears.** `watchForAddress` polls
  `os.networkInterfaces()` — no subprocess, so it is cheap enough to run on a timer
  forever — and the address is bound the moment it is there. A daemon started before
  Tailscale therefore ends where one started after it ends, a few seconds later, with no
  `launchctl kickstart` in between. Shelling out to `tailscale` is kept for the one thing
  the interface list cannot answer — *why* it is missing — and happens once, on the
  failure path, never on a poll.

### Both bind loops do it now, and joining the socket up is the harder half

`bin/router.js` got this first, because in the installed configuration the router is what
holds the tailnet address. `npm run start:bare` — the unsupervised daemon, on the real
port, with no router in front of it — got the diagnosis and a line telling you to
restart, and that is the half bc-b4fs.1 finished.

The reason it stopped there is that binding the socket is the easy part. Under
`start:bare` the sockets `listen()` hands back are threaded through two more things, and
a socket neither of them has seen is a socket with no terminal on it and no certificate
loop around it. So `listen()` takes an `onLateBind` hook, and `bin/beadcause.js` re-runs
both:

- **The terminal**, through `attachUpgrade` and deliberately *not* a second
  `attachTerminalSocket`. That call builds a whole new `WebSocketServer` — a second
  client set — and the daemon keeps exactly one handle, the one `/internal/release` uses.
  A phone attached over a socket the handle does not know about would survive the release
  and then be cut off as a 1006 mid-keystroke on the next swap, instead of getting the
  close frame it can act on. One socket server, wired onto both.
- **The renewal loop**, rebuilt rather than left alone, because `startRenewal` filters the
  array it is given *once*, at call time, and answers `null` when none of them terminate
  TLS. A daemon that came up loopback-only therefore has no renewal loop at all, and the
  late bind is the first moment there is anything to renew. The certificate is asked for
  again at that moment too, rather than reusing one captured at startup — by then the
  renewal loop may have fetched the very certificate the new socket should come up
  carrying, and a stale capture would leave it on plain http until the next restart.
- **The URL the phone is given**, which names the address until there is a certificate —
  so it moves when the address does, under the same rule as everywhere else in
  [HTTPS on the tailnet name](#https-on-the-tailnet-name): only the process that owns the
  real port may decide what the phone is told.

Three smaller things, each of which was a way to get this wrong:

- **A socket that never came up is not in the array.** The array `listen()` returns is
  what shutdown closes and what the renewal loop filters, and it used to keep the failed
  tailnet server anyway — so `/api/tls` reported HTTPS on a port nothing could connect
  to, and a renewal would have gone onto the dead socket rather than the live one. It is
  dropped and closed on the failure, and only a bind that actually succeeded pushes
  anything back in.
- **An arrival that beats the arming is remembered, not dropped.** `listen()` runs first
  and everything after it is ordinary startup that can outlast a five-second tick on a
  loaded Mac. An address that turns up in that window is held and replayed the moment the
  hook is armed; dropping it would be the original bug with extra steps.
- **A retry waits.** The interface list claiming an address the kernel then refuses to
  bind is a real, if brief, state — and re-arming a watcher that fires immediately for an
  address it already sees would spin rather than retry. One interval of quiet first.

`test/tailnet.mjs` covers the classifier and the watcher; `test/latebind.mjs` covers the
deferral, the late bind, and what happens when the hook throws.

## HTTPS on the tailnet name

The wire was never in the clear — WireGuard already encrypts everything between the
phone and the Mac — so this is not about eavesdropping. It is about three things the
tailnet cannot give you:

- **Secure-context browser features.** The microphone, service workers on anything
  but loopback, the clipboard, WebAuthn: a browser gates all of them on the *origin*,
  and `http://100.x.y.z:4318` is not a secure one whatever tunnel it arrives through.
- **Google sign-in.** It will not accept a non-HTTPS redirect URI. Full stop.
- **Defence in depth.** A tailnet ACL that is one day wrong should cost an
  eavesdropper a TLS handshake, not the whole conversation.

**Where the certificate comes from.** No authority will sign `100.96.0.42`, so
HTTPS means serving the MagicDNS name — `<host>.<tailnet>.ts.net` — and
`tailscale cert` is what gets a certificate for it: Let's Encrypt, fetched through
Tailscale. It is cached in `~/.config/beadcause/tls/`, re-fetched when it has under a
month left, and — because that copy is ours and nothing outside this process touches it
— [renewed by the daemon itself while it runs](#renewing-it-before-it-expires).

**It needs one thing switched on that this repo cannot switch on for you:** *HTTPS
Certificates*, at [the tailnet DNS page](https://login.tailscale.com/admin/dns).
Without it `tailscale cert` answers "your Tailscale account does not support getting
TLS certs", and beadcause says so in the log and **serves plain http exactly as
before** — a daemon that refused to boot over a certificate would take the inbox down
for a feature nobody had asked for yet.

**Switching it on is one step, and you can watch it land.** The click changes the
tailnet, which cannot reach into a daemon that is already running — so the daemon goes
looking. The certificate belongs to whichever process owns port 4318 — the router — and
that process comes up with a socket that can be *given* one later: plain http behind the
same one-byte sniffing front TLS sits behind, and a check **every minute** for a
certificate to put on it. So within about a minute of the click the log says

```
[beadcause] tls  adopted a certificate for mac.tailnet.ts.net without a restart — 89.9
                 days left; https from the next connection
```

`baseUrl` moves to the `https://` name in the same breath, port 4318 is never let go of,
and nothing open is dropped. [The switch on the Admin
screen](#the-switch-on-the-admin-screen) is the same thing from a phone.

**It used to be two steps, and this is what went wrong with the first fetch.** A
`tailscale cert` run seconds after the click can fail with `CreateOrder: 404 …
Certificate not found`, because the tailnet's new certificate permission has not finished
propagating to Let's Encrypt — and the identical command a moment later writes the pair.
The fetch used to happen *once, at boot*, so a restart landing inside that window bought
plain http until somebody restarted the service again, with a perfectly good certificate
available the whole time. That is what the retry above exists for (bc-ij1e), and it is
also why the ask **backs off** — a minute, two, four, doubling to six hours — rather than
knocking on Let's Encrypt once a minute for a year on a tailnet that is never going to
issue one. Between asks the check is two file reads, which is what catches a certificate
some *other* process wrote: the Admin switch fetches into
`~/.config/beadcause/tls/` from a backend, and the router picks it up on the next tick.

If it truly cannot get one it says so on your phone — once, not daily, because plain http
is a supported configuration and not an outage:

```
[beadcause] tls  STILL NO CERTIFICATE — serving plain http on the tailnet address:
                 your Tailscale account does not support getting TLS certs
[beadcause] tls  fix it by hand: tailscale cert mac.tailnet.ts.net
```

**Terminated in the daemon, not by `tailscale serve`.** Fronting it with Tailscale's
own proxy would be less code and the same certificate, but then the protocol floor
would be Tailscale's to choose and ours to discover. An explicit `minVersion` is only
enforceable where the socket is made — so TLS 1.2 is the floor, 1.1 and below are
refused the handshake, and `test/tls.mjs` pins that with a real client rather than
leaving it as an option nobody would notice being dropped.

**Loopback stays plain http, deliberately.** `127.0.0.1` is already a secure context,
so it gains nothing — and it is where the control plane lives: `npm run swap:status`,
`/internal/*`, `npm run monitor`, and the router's own proxy hop to its backend. A
certificate there would guard the one hop that never leaves the machine and break
every one of those callers on the way.

```
     phone ──▶ :4318 tailnet address   TLS 1.2+, cert for <host>.<tailnet>.ts.net
                       │
     mac   ──▶ :4318 127.0.0.1         plain http — control plane, monitor, router hop
```

**Nothing that already points at the IP breaks.** Every QR you have scanned, every
notification already sent and every installed PWA says `http://100.x.y.z:4318/…`, and
a plain request arriving on a TLS port normally produces a parse error with nothing on
screen to explain it. So the tailnet listener peeks at the first byte: a TLS handshake
goes to the HTTPS server untouched, and anything else gets a **307 to the same path on
the certificate's name** — query kept, so the `?t=<token>` on a pairing link still
pairs. It is a temporary redirect, and method-preserving, so a POST stays a POST and
nothing is cached past `tls.enabled: false`.

The terminal WebSocket needs no change: `public/term.js` derives `wss:` from the
page's own scheme, the upgrade is wired onto whatever `listen()` returned, and the
token still travels as a subprotocol rather than in the URL.

```bash
curl -sI https://$(tailscale status --json | jq -r .Self.DNSName | sed 's/\.$//'):4318/api/health
curl -sI http://127.0.0.1:4318/api/health          # still plain, still the control plane
openssl s_client -connect <name>:4318 -tls1_1      # refused: alert 70, protocol version
```

### The switch on the Admin screen

Everything above used to be reachable only from the Mac: `tls.enabled` is a key in
`~/.config/beadcause/config.json`, the certificate comes from a command, and the one
failure that matters announces itself in a launchd log. So the honest description of
the feature was *a setting you cannot see, gated on a setting on a different website,
failing somewhere you would have to be at the Mac to read.* The **HTTPS** card at the
bottom of `/admin` is that switch, and it says the three things the log cannot.

**What is true now.** The setting, the certificate's name and how many days are left on
it, and — separately — what is on the socket. Those last two are apart for about a minute
after pressing the switch, until the process that owns the port adopts what this one
fetched, which is the window in which somebody is actually reading this screen. A
certificate inside the renewal loop's alarm window is
marked rather than merely printed, using the same two thresholds the push uses, so the
screen cannot call "fine" something your phone is being nagged about.

**And when the loop last looked**, in the same words `npm run swap:status` uses:

```
Certificate for mac.tailnet.ts.net — 61 days left, checked 3h ago.
```

The days come off the disk and the check comes off the socket — `serving.checkedAt`,
stamped on the live listener by the renewal loop on every tick — and the card is
unreadable without both. Eighty-nine days left and a check from six weeks ago is a dead
renewal loop sitting on a certificate that still happens to be valid, and the calendar
keeps counting down whether or not anything is still renewing it: until this was on the
card, that state was drawn as *healthy*. It is left as a plain "when" with no threshold
of its own, because how old is too old is the loop's own cadence and that is not on the
wire; the rounding is deliberately the same three tiers as the terminal's, so two
readouts of one fact cannot disagree by a unit and turn into a question about which is
right. Nothing is said at all when the field is absent — an older router cannot hot-swap
itself, so its snapshot predates a deploy until a `launchctl kickstart`, and a card that
filled that in from the fact that it had *something* to draw would be asserting the one
thing this exists to detect. Under `npm run start:bare` the answer comes from this
process's own listener instead, which is honest for the same reason: `bin/beadcause.js`
runs the renewal loop over those very sockets, so the stamp is read off the same object
as the material beside it. `test/tlsadmin.mjs` pins both halves — the field surviving
`tlsView`, and the sentence, by running the real `public/admin.js` in a vm.

**What pressing it costs, in the button, before you press it.** Turning HTTPS on moves
the origin, and the token lives in `localStorage`, which is per origin — so *every
paired browser is signed out, including the one you are pressing it with*. The button
arms rather than acting: the second tap is the one that fires, and the first turns the
button into `every paired browser signs out (100.96.0.42 → studio-mac-mini-m4…)`.
Afterwards a **Pair again** panel appears with the new link and a QR of it: the link is
one tap for the phone in your hand, the code is for every other device. It stays until
you dismiss it — it is the way back in, and a ten-second repaint taking it away
mid-scan is the one failure that leaves you locked out with the Mac in another room.

**Which failure it is.** `tailscale cert` exits 0 and writes nothing when the tailnet
has *HTTPS Certificates* off, so that case is recognised by its sentence and drawn as
itself: what Tailscale said, that nothing here can fix it, and a **Tailscale · HTTPS
Certificates** button that opens the page — through the Tailscale app on Android where
it claims the link, and as the web page everywhere else, because no documented scheme
reaches a tailnet setting in the iOS or macOS app and a tap that does nothing is worse
than a page that opens. Nothing else is classified as that failure: an ACME rate limit
sent to that page would leave you turning on a setting that is already on. Press the
switch again once the tailnet is fixed and it asks for the certificate again — the reply
says whether it worked without restarting anything to find out.

**It writes the setting before it fetches.** A fetch that fails leaves `tls.enabled:
true` on disk on purpose: the intent is recorded, and the daemon picks a certificate up
once the tailnet is fixed without anybody coming back to this screen. And it binds
nothing — this is a *backend*, and the port belongs to the router — but it no longer has
to: a pair written into `~/.config/beadcause/tls/` here is on the router's socket about a
minute later, so the card's `restart needed` turns itself off rather than being a chore
it hands you. It is still shown for the case it is still true of — turning HTTPS *off*,
which a listener already terminating TLS cannot do without being rebound. Turning it off
keeps the certificate where it is; only the setting moves.

`GET /api/tls` is the same picture for anything else that wants it, and is cheap enough
to poll: two file reads, a certificate parse and a memoised MagicDNS name, and it never
asks `tailscale cert` for anything. `POST /api/tls {enabled}` is the switch, refused for
an [observer](development.md#a-second-instance--observer-mode) — a spare-port instance shares this config
with the live daemon, and a press there would sign every paired browser out of the real
origin.

### The URL you are given, and what happens to a phone that already has one

`baseUrl` is the one string every generated link is built from — the pairing QR, the
APK install code, the click target on every ntfy notification, the action buttons that
POST back to `/api/respond`, the terminal's `wss://`. It names the certificate now:

```
https://<host>.<tailnet>.ts.net:4318      what the phone is given
http://127.0.0.1:4318                     the control plane, unchanged and still plain
```

**It follows the certificate, and only the certificate.** If there is no servable pair
in `~/.config/beadcause/tls/` — the tailnet has no *HTTPS Certificates*, `tailscale` is
down, `tls.enabled` is false — every one of those links is the Tailscale address over
plain http exactly as before. This is not caution for its own sake: an `https://` link
to a port serving plain HTTP is a TLS parse error with nothing on screen, and it would
be generated precisely on the machines that cannot fix it. So the address is not a
fallback so much as the honest answer to what the daemon is actually serving.

The move happens on its own, in three places. Every `loadConfig()` — so every `npm run
qr`, every `--url`, every `beadcause-ask` — reads the cached certificate off disk and
builds the URL from it; that costs nothing and never fetches. The daemon asks again
straight after `listen()`, because that is one moment a certificate can *appear*: the
first boot after you switch HTTPS on obtains one, and the config is rewritten then so the
next `npm run qr` in a different process agrees. And it asks a third time at the other
such moment — when a listener that came up on plain http
[adopts a certificate under itself](#renewing-it-before-it-expires), minutes or hours
later, with no restart in between. A saved `baseUrl` only moves if
this repo generated it — a Tailscale address, loopback, or a `.ts.net` name. A real
domain, a LAN address or a proxy is yours and is never rewritten.

**An already-paired device keeps working, and should be re-paired once anyway.**
Nothing breaks: the URL saved in its home-screen shortcut still names the address, and
the TLS front 307s it to the name with the path and query intact. But the token lives
in `localStorage`, which is scoped to an *origin*, and `https://<name>:4318` is a
different origin from `http://100.x.y.z:4318` — so the redirect lands on a page that
asks for a token it cannot see. **Scan the QR from `npm run qr` again**, once per
device, and the new origin captures the token the same way the first one did. The old
shortcut can then be deleted; leaving it costs a redirect and a token prompt.

**The Android app is the one case that does not keep working, and it tells you so.**
It cannot follow that 307: a phone paired before HTTPS holds `http://100.x.y.z:4318`,
and [cleartext is off](android.md#what-it-costs-you-to-know) in the APK, so the request dies at
the socket before there is a redirect to follow. That is a deliberate trade — the
platform refusing cleartext outright is worth more than one hop of automatic
migration — so the app is built to make it a sentence rather than a mystery. Opening
it after the update goes straight to the QR screen, with the address it is refusing
and why on the screen. **Scan `npm run qr` again**; it is the same token, and the
saved pairing is kept rather than cleared until you do, so nothing is lost if you
scan it a week later. The watcher stays stopped in the meantime — a foreground
notification that can never hear anything would be worse than its absence.

### `npm run qr` says when the link is a browser-only one

Both halves of that are now true at once: the http address is the right answer for a
browser, and it is a link the Android app cannot pair with at all. The app explains
itself when it happens — but the person reading that explanation is holding the phone,
and the fix is on the Mac they have just walked away from. So the Mac says it first, at
the one moment it is standing in front of you:

```
  http://100.96.0.42:4318/?t=…

[beadcause] the Android app will refuse this link — it is plain http, and the app only
            sends its token to https://<host>.<tailnet>.ts.net. A browser on the tailnet
            is fine with it.
[beadcause] turn HTTPS Certificates on for the tailnet
            (https://login.tailscale.com/admin/dns), then run this again — the daemon
            picks a certificate up within a minute of it being available.
```

**On stderr, and only when there is something to say.** `node bin/beadcause.js --url` is
piped into shell scripts, so its stdout is a value rather than a display and a sentence
mixed into it would be an address nothing can dial; `npm run qr` prints it after both
codes, where it is the last thing on the screen you walk away from. An https link — a
certificate, or a `baseUrl` you set yourself — prints nothing at all, because a line that
appears on every run is a line nobody reads on the run that matters.

The same discipline covers a notice this flag never asked for — bc-zjab.12. `lib/resolvers.js`
prints its own line, once, at module load, when the last daemon left resolver windows
behind; since every import in `bin/beadcause.js` has already run by the time `--url` is
read, that line used to arrive on stdout ahead of the URL and land in `BASE_URL` in
`scripts/build-android.sh` along with it. It is a boot notice, not a value, so it moved to
stderr with everything else of that kind — still on the daemon's own console
(`beadcause.log` captures both streams), just off the one stream a script trusts to be a
bare address.

**It is judged on the URL, not on the certificate**, and those are different questions. A
`baseUrl` pointing at a reverse proxy or a real domain is pairable with no `tailscale
cert` anywhere in sight. Loopback is exempt for the opposite reason: it is
[plain http forever](#https-on-the-tailnet-name), and it is the one address the APK still
permits cleartext to — `10.0.2.2` is how an emulator reaches the Mac it runs on, and
warning about that would be a warning on every development session. The exception list
lives in `lib/tls.js` beside the warning, and `test/pairhost.mjs` fails the build if it
and `Address.LOOPBACK` in the APK ever stop naming the same three hosts.

The pairing panel on the **Admin screen** says the same thing in the same case — it is
the other place a code is offered to "another device", and on an http origin that device
cannot be the app. It is told so by the server rather than working it out from the URL,
for the same reason: a second copy of that rule inside a browser is a copy that goes
stale unwatched.

### Renewing it before it expires

A `tailscale cert` certificate lasts 90 days, and the copy in
`~/.config/beadcause/tls/` is **ours** — `tailscale serve` would have renewed one for
us, and we are not using it. So the default outcome of fetching a certificate at
startup and never looking again is an app that goes dark about three months later, on a
phone, behind a certificate warning, for a reason nothing on screen explains.

So the listener that owns the port keeps it alive. **Every six hours** it compares the
certificate on the socket against the calendar, and inside the last month it re-asks
`tailscale cert`. Six hours is absurdly often for a date three months out and exactly
right for the two cases that matter: a Mac that sleeps more than it runs is only up for
an hour or two a day, and Tailscale's own renewal — it reissues once a certificate is
two thirds through, so around 30 days left — becomes due at a moment this process has no
way to be told about. A check with nothing due reads one file and compares one date; it
does not shell out.

**The swap does not interrupt anything.** A new certificate goes onto the running
sockets with `setSecureContext`, which decides how the *next* handshake goes and touches
nothing else: the `net.Server` in front still owns port 4318, requests in flight are
still being served, and **a terminal WebSocket that has been open for an hour stays
open**. No restart, no dropped port, nothing for the phone to notice. `test/certrenew.mjs`
holds all three of those — including a WebSocket opened before a renewal, echoing a
message after it.

**And when it cannot renew, it says so where you will see it.** This is the one failure
whose own error message cannot reach you: once the certificate has actually expired the
inbox answers the phone with an interstitial, and the log line explaining it is on a Mac
nobody is sitting at. So a renewal that fails gets an ntfy push — through a relay that
has nothing to do with this listener — carrying what `tailscale` actually said and the
command that fixes it. It repeats daily rather than every six hours, and its priority
climbs as the expiry approaches: a fortnight out this is a chore, three days out it is
the app going dark.

```
[beadcause] tls  CERTIFICATE NOT RENEWING — mac.tailnet.ts.net expires in 6.2 days:
                 your Tailscale account does not support getting TLS certs
[beadcause] tls  fix it by hand: tailscale cert mac.tailnet.ts.net
```

**And you can go and ask, rather than waiting to be told.** A push arrives at the point
where it is nearly too late and a log line is on a Mac nobody is sitting at, so neither
answers "is my certificate fine?" on a day when it is. `npm run swap:status` — the command
already run to ask what the daemon is doing — names the certificate beside the build:

```
cert     mac.tailnet.ts.net — 61.4 days left  (checked 3h ago)
cert     mac.tailnet.ts.net — 9.1 days left  (checked 2h ago)  ⚠ EXPIRING — the renewal
         that should have happened has not: tailscale cert mac.tailnet.ts.net
```

Three things about that line are deliberate. It is **marked**, not merely printed, once
the number is inside the alarm window — the same `ALARM_BELOW_DAYS` the push uses, so the
line and the notification can never disagree about what "fine" means — and it carries the
command that fixes it, because a warning you have to go and research is one that waits
until the weekend. It says **when the loop last looked**: a certificate with two months
left and a check from six weeks ago is a dead renewal loop, and neither fact says that on
its own. And the number is read off the **socket**, through the router's
`/internal/router/state`, so a certificate swapped by `setSecureContext` an hour ago is
what you see rather than whatever was true at boot.

The three answers that are not a number are kept apart on purpose, because collapsing any
pair of them would be reassuring and wrong: `none — serving plain HTTP` is a tailnet
without *HTTPS Certificates* or a provisional listener still waiting, which is supported
and not a fault; `an unreadable expiry` is an alarm, since bytes that will not parse are
not "fine for another 89 days"; and `not reported` means the router answering predates the
field — it cannot hot-swap itself, so `launchctl kickstart -k gui/$(id -u)/n12n.beadcause`
is what makes it answer. `test/certstatus.mjs` pins all of them, and pins the printer by
spawning `--status` against a stub control plane, because a fixture is the only way to
have a certificate that is nine days old on a machine whose real one is ninety.

Two details worth knowing if you ever debug this:

- `tailscale cert` **can fail while exiting 0** — an account without *HTTPS
  Certificates* prints a 500 to stderr and returns success — so what counts as a
  renewal here is a certificate whose bytes *changed*, not an exit code and not the
  presence of a file. A `cert` that hands back the one we already had is normal at 30
  days and an alarm at 10.
- `BEADCAUSE_TAILSCALE` overrides where the `tailscale` binary is looked for (the
  built-in list is three macOS paths, no `PATH` lookup, because launchd's `PATH` is not
  yours). It is what lets `test/certrenew.mjs` drive the whole renewal against
  certificates it mints itself instead of asking Let's Encrypt for a real one every time
  somebody runs the suite.

**And the same machinery gets the *first* certificate, which is the half that used to be
missing.** A listener that could not fetch one at boot is not a plain-http listener with
nothing watching it: it is a **provisional** one — plain http behind the same
`net.Server` that TLS sits behind — and the loop above runs on a one-minute clock instead
of a six-hour one until there is something to serve. When there is, it goes on through
the same `setSecureContext`, so adopting a first certificate costs exactly what renewing
one costs: nothing rebound, nothing dropped, and `baseUrl` moved onto the name in the same
breath. `test/certrenew.mjs` drives it as the sequence that produced the bug — a first
`tailscale cert` that refuses, then a second that works — and checks that the port it
answers https on is the same port it was answering plain http on a moment before.

Two ways it does *not* behave like the renewal loop, both deliberate. The asks **back
off** (a minute, two, four, doubling to six hours) because a machine whose tailnet will
never issue a certificate must not ask Let's Encrypt about it once a minute forever, and
failed-validation limits there are per hour. And "there is still no certificate" is pushed
**once** rather than daily: a tailnet without *HTTPS Certificates* is a configuration this
repo supports, so the first notification is news and the ninetieth is not — unlike a
renewal that is failing, which is an outage with a date on it.

### And once it has actually expired: it stays HTTPS, broken and loud

Ninety days of a renewal that never worked, through a fortnight of daily priority-5
pushes, and the date goes past. **Nothing downgrades.** The expired certificate stays on
the socket, plain http on 4318 is still 307'd to the name, the URL a phone is handed is
still `https://<name>:4318`, and every page now arrives behind a certificate warning
until somebody fixes it. That is a decision (bc-jv86) rather than what happened to fall
out of the code, and it went the other way for half of one release: `certificate()`
counted a past date as *no certificate*, so a daemon that **rebooted** after expiry bound
plain http with no redirect — silently, and only if the Mac happened to restart. Same
machine, same config, two behaviours.

Falling back to plain http is the tempting answer and it buys less than it looks:

- **It does not bring the installed app back.** The PWA on the phone was installed from
  `https://<name>:4318`, and `http://100.x.y.z:4318` is a *different origin* — a fresh
  install, a fresh pairing (localStorage does not follow a cross-origin redirect), and
  still not a secure context, so still no service worker and no microphone. All it buys
  is that a QR scanned *after* the outage answers.
- **Google sign-in is gone either way** — it will not accept a non-HTTPS redirect URI,
  and the check for one is the same expired certificate.
- **It spends the one property worth keeping**: that this origin never quietly gets
  worse without being asked. A version that works at a lower standard from then on is
  exactly the one that never gets fixed — and reaching this state at all means a
  fortnight of pushes already went unread.

So the two halves of the daemon are made to agree instead. `certificateName()` asks
whether there is a pair on disk for this name, not whether the calendar still likes it —
which is what stops `publicBaseUrl` drifting to `http://100.x.y.z:4318` behind the
socket's back, and what stops the first `loadConfig()` after expiry *persisting* that
into `config.json`, where the priority-5 "certificate has EXPIRED" push would click
through to a URL the running daemon bounces straight back to https. The admin card says
**expired — every phone is warned** rather than counting down into negative numbers, and
offers the retry. The inbox itself is not unreachable while you fix it: loopback on the
Mac is plain http and always was.

```
[beadcause] tls  the certificate for mac.tailnet.ts.net EXPIRED 3.1 days ago and could
                 not be replaced — serving it anyway, so every phone gets a certificate
                 warning until this is fixed
[beadcause] tls  fix it by hand: tailscale cert mac.tailnet.ts.net
```

`test/certrenew.mjs` drives a certificate that is genuinely past its date — `openssl
-not_before/-not_after`, because `-days` will not go backwards — and pins that a boot
after expiry puts TLS on the port, redirects plain http, and still pushes the alarm.

## HTTP API

Auth on everything under `/api/` except `/api/health`: header
`x-beadcause-token: <token>`, or `?t=<token>` for URLs that have to be linkable — **or**
a Google session cookie, if [sign-in](integrations.md#signing-in-with-google) is configured and this is
a browser. The token is asked first, always, so nothing below changes for a caller that
has one.

`/auth/*` is the one family of routes with no credential in front of it, because it is
how a browser gets one: `/auth/google` starts the dance, `/auth/google/callback` ends
it, `/auth/whoami` says which credentials this install has (and who you are, if the
cookie says so), and `/auth/signout` ends the session.

| Method | Path | Body / params | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{ok, workspaces[]}` · **no token** |
| GET | `/api/questions` | `?scope=human\|both\|agent` | `{questions[], requests[], workspaces[], spaces[], filter, summary, scope, seq}` — `scope` defaults to `human`, and an unrecognised value falls back to it rather than erroring. `summary` is `{sessions, proposals}`, the two counts the inbox's tab badges draw. `seq` is where in `/api/poll`'s log this list was true, which is what lets a client park on the poll instead of asking again — see [loaded once](navigating.md#loaded-once-and-kept--what-a-tab-tap-actually-costs) |
| GET | `/api/question` | `?workspace=&id=` | one question **plus `comments[]`** |
| GET | `/api/poll` | `?since=<seq>&wait=<s>` | long-poll: `{seq, resync, events[], advocates, presence, observing}` **plus the whole `/api/questions` screen** when something moved — the same `inboxPayload()` builds both, so a client can refresh itself from either and get the same inbox. `questions`, `requests` and `spaces` are `null` rather than `[]` when nothing moved: an empty array means the channel is empty, and a poll that timed out never asked. `want=presence` says the questions are not wanted, which is what makes a quiet poll cost no `bd` at all |
| POST | `/api/landed` | `{workspace, bead, repo, number, url, title, base, sha, owed}` | announces a merge that landed in **another process**, so the phone hears about it. The one caller is `bin/deliver.js` recording a branch that was already merged on github.com; every other landing is the merge queue's, which is inside this daemon and calls the bus directly. Takes the config token and *not* a sign-in, and cannot choose its own event type — `landedEvent()` in `lib/news.js` composes it — so the worst a wrong caller can do is announce a landing that did not happen. `400` without a pull request number |
| POST | `/api/respond` | `{workspace, id, response, create?, edits?}` | comments, then closes the bead. `create` is the 1-based indices of a proposal's beads to file; without it, `CREATE:` in the text means all and `CREATE: 1,3` means those. `edits` is `{n: {title, type, priority, description, acceptance}}` keyed by the same numbers, applied before creating. A `MERGE:` / `CHANGES:` / `DECLINE:` response on a delivery question acts on its pull request first — see [Landing work](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue) |
| GET | `/api/pr` | `?workspace=&id=` | `{delivery, pr, unavailable}` — the live diffstat, check rollup and mergeability of a delivery question's PR. Every failure is an answer rather than a 500: no `gh`, no remote, GitHub unreachable all come back with `pr: null` and a sentence in `unavailable` — and so does a **tracker that did not answer in time**, which used to escape the bead read at the top as a 500 carrying bd's command line, and so filed a sev2 P0 about a daemon that was serving every other route (bc-4jkjv). Only a `bd` *timeout*: a `bd` that answered and said no still reaches the route error handler as itself |
| GET | `/api/prs` | `?refresh=1` | the PR board: every pull request in every repo with its Merged · Pushed · Deployed · Live lamps and its rung of [the ladder](pull-requests.md#the-ladder-in-one-place), plus `observing`. One card per **repo** — `key` is `beadcause` or `northwind/atrium-service`, and it is what every row and every button below is addressed by, because a pull request number is only unique inside a repo. `workspace` is still accepted everywhere `key` is and means the same thing for a workspace that is one repo; see [why](pull-requests.md#a-deploy-is-a-fact-about-a-repo-and-a-workspace-may-be-forty-of-them). Read by the board *and* by the inbox, which draws a card per row. Cached 25s on the daemon; `refresh=1` forces the `gh` sweep |
| POST | `/api/pr/merge` | `{key, number, method?}` | **admits it to the merge queue — it does not merge** (bc-02ldo). `admitPlan` picks the bead this pull request already is (a merge-bead the queue handed back, a delivery card asking about it, one already queued, or nothing open at all) and `admitToQueue` writes `approved`/`approvedBy` into the queue block in its `notes`, where `gateVerdict` reads it — the same two functions `beadcause-merge` calls, because two copies of that sequence is two copies that drift. Answers `{queued, action, id, bead, why, others, warnings}`: `queued` is false on `approve` (it was already on the queue and moving, and claiming a move nothing made is the one thing this must not do) and `others` names any second open bead about the same pull request, which is a work bead that cannot close. A pull request already merged is `{alreadyMerged: true}` and a 200, because "it is already in" is the outcome the tap wanted; a draft or a closed one is a 409. **It used to merge, fast-forward this Mac's base and retire the inbox card** — all three now happen on the queue path, where `afterMerge` does the first two the moment the merge lands and the card is *converted* into the queue entry rather than closed behind it |
| POST | `/api/pr/ship` | `{key, number}` | the declared deploy where the repo has one, an iTerm session where it does not. `409` if the PR is not merged — shipping an unmerged pull request has no meaning. Refused on an observer |
| GET | `/api/queues` | `?refresh=1` | [the two queues](pull-requests.md#the-two-queues-and-where-a-bead-is-in-either), keyed by repo: `{at, repos[], orphans[], counts, unavailable, errors[], observing}`. Each repo carries `merge[]` — one entry per bead with an unmerged branch, from the moment its PR joined the queue — and `release[]`, one per merged PR in the batch it will ship with. Every entry names its bead, its pull request and its `stage`, plus `rungs[]`: the whole ladder with each rung `done` · `now` · `pending` · **`untracked`**, which is what the three stages nothing records yet come back as and is never `done`. A repo with no declared deploy and no visible build returns merge entries and **no release entries**. A release entry is kept one release past the one that made it live (`ago`), then it is gone. Reads nothing of its own: the 25-second board `/api/prs` shares, the deploy journal, and merge-beads kept 20s behind the same `bd.graph()` gate the queue's own tick uses |
| POST | `/api/release/ship` | `{workspace}` | ships the whole release queue — one deploy for every merge sitting on `origin` and not live, which is what a deploy has always done anyway. `409` on an empty queue (a restart for nothing), on a repo that declares no deploy (there is no window that means "and the other three"), and on one already deploying. Refused on an observer |
| POST | `/api/pr/comment` | `{key, number, text}` | a note on the pull request at GitHub and nothing else. Not `/api/comment`, which writes on a *bead* and puts an agent onto answering it |
| GET | `/api/pr/detail` | `?key=&number=&refresh=1` | `{row, pr, agent, unavailable}` — what [the full view](pull-requests.md#tapping-one-opens-it-full-screen) is drawn from. `row` is the board's (the lamps and the rung, from the 25-second sweep, computed once in lib/prstage.js); `pr` is `gh` **now**, for the description the board strips, the datetimes and the mergeability the buttons are drawn from; `agent` is which session wrote it, from the archive in the repo's own refs. Every failure is an answer rather than a 500, exactly as `/api/pr` has it |
| POST | `/api/pr/close` | `{key, number, reason?}` | closes it at GitHub without merging, with your reason as a comment on the pull request. **No bead moves** — `row.beads` is a *match* rather than the block a worker wrote, and reopening a bead is what puts an unattended session on it; putting the work back in the queue is *Decline* on its own card. `409` on one already merged: closing it now cannot un-merge it. The branch is kept |
| POST | `/api/pr/conflicts` | `{key, number}` | opens an iTerm session on the branch whose job is to merge the base into it, resolve, run the repo's own gate and push — then stop. `409` unless GitHub reports it `CONFLICTING` right now, so a resolved conflict cannot leave a window somebody has to close. Refused on an observer, and on a daemon with `openSessions` off. Two resolvers run at a time: past that it answers `{queued, place}` and the window opens when one frees, with GitHub asked again first — [the cap](pull-requests.md#two-windows-at-a-time-and-the-rest-in-line) |
| POST | `/api/comment` | `{workspace, id, text, agent?}` | comments, sets `human-replied`, dispatches that agent to reply (default when absent or unknown) |
| POST | `/api/dismiss` | `{workspace, id, reason?}` | takes the card off the screen and **closes nothing**. Writes your note if you typed one, writes nothing at all if you did not, and never touches the status — "I am not dealing with this now" is not "this is decided" |
| GET | `/api/accounts` | — | what the [account switcher](asking.md#accounts--one-life-at-a-time) draws: `{account, accounts[], workspaces[], repos, me}`. The workspace list here is **every** workspace on the Mac rather than the account's, because it is what the add-an-account form is built from. Costs no `bd` call — a `state.json` read and a walk of the config |
| POST | `/api/accounts` | `{email, label?, workspaces[], repos?}` | add an account or rewrite one. Adding the first one writes **two**: the account you named, and the address this Mac already files as, owning every workspace you did not give it — a repo in no account would be visible from nowhere. Writes `config.json`, which the common repo snapshots. Refused on an observer |
| DELETE | `/api/accounts` | `{email}` or `?email=` | forget one. Removing the last turns the scoping off and puts every workspace back on every screen. The address is taken from the query as well as the body, because Node's own HTTP server refuses a chunked DELETE body outright. Refused on an observer |
| POST | `/api/account` | `{email}` | switch account — the whole of what **Switch accounts** does. Server-side like the filter below it, so the phone and the laptop agree and the push path reads the same value. An address naming no account is a 400. Filing follows it: the daemon's byline, addressee and owner stamps become that address at once |
| POST | `/api/filter` | `{space, workspace}` | which slice the inbox is, remembered server-side so every client agrees and the notifications match. Each is a name or `all`, bounded at 120 characters. Notifications already unread for beads the new filter excludes are left exactly as they are — [nothing tidies them](asking.md#and-it-does-not-tidy-up-the-noise-it-already-made) |
| GET | `/api/spaces` | — | what the [space picker](asking.md#one-space-at-a-time--the-picker-in-the-top-bar) draws: `{spaces, workspaces[], filter}`. Costs no `bd` call — the spaces are cached off the last sweep — because it is fetched on every page load of every standing view. **No counts**: the picker draws none |
| GET | `/api/space` | `?space=` | one space's own configuration, for the [space details](asking.md#space-details--every-setting-a-space-has-on-a-page-of-its-own) screen: `{settings, effective, repos[], defaults, missing[], observing}`. `settings` is `null` per field for "inherit"; `repos[]` is what each workspace actually resolves to, which is not always what the space says. `observing` rides along the way it does on `/api/prs`: `/config` is a page whose only payload is this one, and an instance that merely watches has to draw every control on it disabled. 404 for anything that is not a configured space, the synthetic `Other` group included |
| POST | `/api/space` | `{space, workspace?, settings}` | change that space's settings from the app. A patch — only the keys sent are touched, and `null` clears one back to the global default. `name` and `workspaces` are not settable: moving a repo between spaces decides which questions may reach you and stays a config-file act. With a `workspace`, it writes that **repo's own** override instead — `autoEndorse` only, and a repo the named space does not contain is a 400. Either way the reply is the whole `spaceDetail`, and it writes the live `cfg` *and* `config.json`, so the running daemon and the next restart agree. Refused on an observer |
| GET | `/api/workspaces` | — | every beads workspace this Mac serves and every one retired from it: `{workspaces[], retired[], observing}`. Each live row carries `{name, dir, space, inAccount}` — `space` being what the picker files it under, so a row says where it is about to disappear from; each retired row carries `{name, space, restorable}`, and `restorable` is asked of discovery rather than remembered, because the `null` that retired a name replaced the directory it lived at. Drawn by **Trackers** on `/admin`. Costs no `bd` call |
| GET | `/api/workspaces/roots` | `?workspace=` | `{workspace, me, roots[], error}` — what ＋ Add a bead-space asks about in its last round (bc-9i62w): every **open root** in the bead-space less the crash beads the app filed on itself, `{id, title, priority, epic, owners[], mine, advocate, noAdvocate}`, yours first. `advocate` is `advocate-assigned`; `noAdvocate` is the sentence for an epic an advocate would be refused on (unendorsed, superseded, paused) and `null` otherwise. `me` is the handle ownership would be written as, `null` on a Mac that has not said who it is. Waits for a cold cache, because a bead-space added a second ago has never been read |
| POST | `/api/workspaces` | `{action, workspace}` | `own` — the answer to that round, `{workspace, own[], advocate[]}`, zero or more of each: the `owner:` label on every `own` id (through `ownerUpdate`, so an epic somebody else owned moves rather than gaining a second owner), and an Epic Advocate opened on every `advocate` id through the card button's own door, which also implies owning it. The picks are checked whole against a fresh read first, and a refusal writes nothing; after that each epic reports on its own row, `{results[]: {id, owned, advocate, error}}`. Otherwise, `retire` a tracker or `restore` one. Retiring writes `workspaceDirs.<name>: null` — see [`workspaceDirs`](#where-a-workspace-lives-when-it-is-not-under-beads) — and nothing else, leaving the name in its space so a restore is that one key deleted and the repo returns where it was with its settings intact. Both halves write the live `cfg` *and* `config.json`, so the tracker stops being swept immediately rather than at the next restart. The beads are untouched. The **last** tracker is refused, a name nobody serves is a 404, and so is a restore discovery cannot find — which leaves the retirement standing rather than pointing `workspaces` at nothing. Refused on an observer |
| POST | `/api/ask` | `{workspace, title, body, priority}` | `{id, key}` — files a new `human` bead |
| POST | `/api/bead/create` | `{workspace, title, type?, priority?, description?, acceptance?, parent?, labels?}` | `{ok, id, key, workspace, parent, warnings[]}` — the [create form](inbox.md#a-bead-you-file-yourself-from-the-form-behind-) behind ＋ on **All Beads**. One bead, through the same `createBead` the chat console's accept button calls, so the two doors cannot disagree about labels, the surface block or `created_by`. **Not** `fileBeads`: a bead you typed carries no `unendorsed`, no `agent-filed` and no agent provenance. A blank `parent` is [`lib/homing.js`](landing.md#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists) and lands it under the repo's `unsorted` root — a *named* parent that does not exist is a `400` with nothing filed, because a blank field is "you decide" and a typo is not. `400` for no title or an unknown workspace; `502` carries bd's own first line, which the form keeps on screen |
| POST | `/api/error` | `{message, source?, line?, column?, stack?, url?, userAgent?, at?, kind?, workspace?}` | `{ok, action, id, key, fingerprint}` — an error the app hit, filed as a **P0 bug** or commented onto the bead that already covers it. `action` is `created` · `commented` · `regressed`. **`message` is the only required field**: a cross-origin `window.onerror` is handed `"Script error."` and nothing else, and that is still worth more than a red toast nobody saw. `workspace` defaults to the first configured one — the reporter is a page, which has no idea which repo it is looking at. **Never answers 5xx**, because it is called by error handling: a tracker that is down comes back `200 {ok: false, reason}`. See [an error the app hits files itself as a P0](incidents.md#an-error-the-app-hits-files-itself-as-a-p0) |
| POST | `/api/edits` | `{changes[], page?, view?, at?, workspace?}` | `{ok, workspace, root, session, filed[], dropped[]}` — a pass made with [edit mode](navigating.md#editing-the-app-from-inside-the-app) on, filed as one P1 session bead and one P2 child per change, under a standing P0 root that is found by its `edit-root` marker or created here. The workspace is **this checkout's own**, not the one on screen: an edit typed into this screen is a change to *this app*. `400` on an empty pass, and `502` carries `filed[]` — the phone drops exactly those entries and keeps the rest, because the change list is the only copy of what was said. See [Save files the pass](navigating.md#save-files-the-pass) |
| POST | `/api/session` | `{workspace, id}` | `{dir}` — opens iTerm2 + `claude` on that bead |
| GET | `/api/sessions` | `?workspace=` | `{workspace, boot, polledAt, unresolved, rows[]}` — every Claude Code session this Mac knows about (bc-wsgj6, `lib/unresolved.js`): the register, this boot's `rebootReport` and `resumeReport`, the live records and the last week's transcripts, one row each with `status` (`live`, `closed`, `reopened`, `parked`, `waiting`, `skipped`, `failed`), `workspace`, `bead`, `transcriptAt` and **`unresolved`** — named, not `done-`, no process, not parked, with a transcript (`isUnresolved`, the one predicate). `unresolved` on the payload is the count of rows carrying it. `?workspace=` narrows to one; an unknown name is a `400`. What the terminal monitor's default pane shows, served so the phone can offer the same count |
| POST | `/api/sessions/resume` | `{workspace}` | `{ok, workspace, opened[], skipped[], failed[]}` — reopens every unresolved session of that workspace with `claude --resume`, each in its recorded directory, under its recorded name, in the workspace's iTerm window and **with no prompt** (nothing runs until somebody types, as after a boot). Skips one already running or parked, reports a directory that is gone rather than resuming elsewhere, stops at `MAX_RESUMED` (12), newest first. Writes `resumeReport` to the state in the `rebootReport` row shape so the register poll hands each window its name back (bc-5to5r.8). `403` under `OBSERVING` or with `openSessions` off; `400` for an unknown workspace. The monitor's `R` key, pressed twice |
| POST | `/api/handoff` | `{workspace, id}` | `{ok, dir, mode, repo, endorsed}` — opens the **successor to a handoff**: the door the `/handoff` skill on this Mac asks instead of driving iTerm with AppleScript itself, so the window lands in the daemon's session list and under its duplicate guard. A third door because neither of the other two would do: `POST /api/bead/advocate` needs a P0 carrying an `owner:` label and so 409s every handoff there has ever been, and `POST /api/session` would take it but brief it as a *question to discuss and close as answered* — a successor that discusses its handoff instead of doing the work, which reads as success from every screen. The brief is `handoffPromptFor` (`lib/session.js`): read the body with `bd show <id> --json \| jq`, `bd update <id> --claim`, continue from `## Next action`, verify anything marked UNVERIFIED. Guards: `409` for a bead with no `handoff` label (the brief is only true of one) and for a live-or-opening session already naming it, via the same `advocateSession` rule the P0 door uses; `403` under `OBSERVING` or with `openSessions` off; `400` on an unparseable id. It **endorses**, like `POST /api/session` and for the same reason — a handoff was filed by an agent moments ago and the person who ran `/handoff` is present and asking. Every refusal is one `bin/open-handoff` falls back to iTerm on, so a handoff always opens something |
| POST | `/api/status` | `{workspace, id, phase, detail, actor}` | agent progress |
| GET | `/api/agent-log` | `?workspace=&id=` | `{lines[], running, phase}` — the dispatched agent's log, as the CLI would have shown it |
| GET | `/api/asset` | `?p=<abs path>` | image/doc bytes, restricted to `assetRoots` |
| GET | `/doc` | `?p=<abs path>` | the HTML reader page |
| GET | `/api/confluence` | `?p=<abs path>&workspace=` | what [publishing](integrations.md#publishing-a-document-to-confluence) this document would do, before it happens: `{configured, publishable, site, spaceKey, title, action, existing, lastPublished}`. `{configured: false}` for an install with no `confluence` block, and it reads no credential to say so — the reader tab draws no button at that answer. Costs two GETs to Atlassian when it is on, because `action` is the thing the screen has to be able to say |
| POST | `/api/confluence` | `{p, workspace, spaceKey, title, bead?}` | publish it. `spaceKey` and `title` are the confirmation — the target as the screen drew it — and a `409` is what you get if either has moved since, rather than a second page under the new name. Updates the page it made last time and overwrites its body; Confluence keeps the version history. Records the URL in `state.json` and, with `bead`, as a comment on that bead. Refused on an observer |
| GET | `/api/graph` | `?workspace=&id=` | `{nodes, links}` — the whole workspace with no `id`. A **tracker that did not answer in time** is `200` with empty `nodes`/`links` and a sentence in `unavailable`, which the page draws as "Can't draw this graph" — it used to be a 500 that filed a sev2 P0 about the daemon (bc-h4y6d). Only a `bd` *timeout*: anything else still reaches the route error handler |
| GET | `/api/docket` | `?workspace=` (or `ws=`) `&id=&refresh=1` | `{workspace, root, focus, family[], plan, events[], progress, prsKnown}` — [the docket](navigating.md#the-docket--an-epics-whole-arc): one epic's whole arc, in the order it happened. Roots at the **top of the family** the bead hangs from, not at the nearest thing typed `epic`, and `focus` echoes the bead you asked about so the page can light it up. `events[]` is everything dated in the family — filings, claims, comments, rulings, closes, plans, sessions and pull requests — each flagged `machine` for the fold rather than filtered out, because a stream that dropped the machine's lines cannot answer why a week was quiet. `prsKnown: false` means nobody has swept the pull requests, which is not the same sentence as "this epic has none": the route reads a warm board and never pays for one. One `bd export` per workspace, cached thirty seconds; `refresh=1` forces it. A bead the workspace has never had is a 404 naming it |
| GET | `/api/dockets` | `?workspace=` **or** `?space=`, and `&refresh=1` | `{workspace, space, rows[], errors[]}` — every root that has children, newest activity first, each with its counts. The index you browse when you want to catch up rather than answer something. Same scoping as `/api/history` and the same bargain over a workspace whose `bd` fell over: a row in `errors[]`, not a failed request |
| GET | `/api/bead` | `?workspace=&id=` | one issue in full, plus `comments[]` — for the graph's detail sheet |
| GET | `/api/bead-links` | `?workspace=&id=` | `{children[], dependents[]}` — everything with an edge pointing at that bead, closed ones included, open work first: the `parent-child` rows as `children`, every other kind as `dependents` with its `dependency_type`. One `bd dep list --direction=up` for both, because `bd show` carries `dependent_count` and not one row behind it |
| GET | `/api/beads` | `?q=` | `{beads[], warming, q}` — what [the inbox's bead search box](inbox.md#finding-one-bead) drops down: up to 12 `{key, workspace, id, title, status}`, ranked exact id → id prefix → id substring → title, open before closed. **Every workspace at once**, because you type an id knowing the bead rather than knowing its tracker. The one route that can be asked once per keystroke, so it reads the graph `Bd.graph` already caches and **never waits on a `bd export`** — `warming` counts the workspaces it has not read yet, which is what lets the box say *still reading the trackers* instead of claiming a bead does not exist |
| GET | `/api/bead/tree` | `?workspace=&id=` | `{workspace, id, title, keys[]}` — that bead's key and every descendant's, at any depth, `parent-child` edges only. What a pick in the search box narrows the inbox to. 404 for a bead the graph has never heard of. Unlike `/api/beads` this one **waits** for a cold cache: it is one request per pick, and answering "nothing is under this" from an unread graph would narrow the list to a single row and look exactly like a working filter |
| POST | `/api/bead/advocate` | `{workspace, id}` | opens the **Epic Advocate** on this epic — the button on the inbox's card, and the first one: **the tap is the assignment**, so a successful launch writes the `advocate-assigned` label that [enrols it for automatic re-entry](inbox.md#the-tap-is-the-assignment--what-the-epic-carries-and-what-takes-it-off) — after the launch, never before it, and a label write that fails is a warning rather than a 500 over a window that is already open (`assigned: false` on the response says so). This is where the loop starts rather than a weaker version of it. Four refusals in front of it, all 409 with a sentence: unendorsed, superseded, closed, or not a root anybody owns — an epic at any priority or a P0, since bc-htoy (a crash bead is refused by name — a stack trace is not an epic). **Never two on one epic**: a live session whose window carries this bead id is a 409 rather than a second window — matched with `namesBead`, so a session on a *child* of it no longer refuses it — and so is a launch from the last ten minutes whose window has not named itself yet, since that is the gap a second tap falls through. The card in front of it reads the same rule and draws it: it links to `/session?pid=` while an advocate is up, and says one is opening until then, rather than re-offering a launch that would now be refused (`advocate` on each card of `rootboard`). Blocked under `OBSERVING`, unlike the verdict routes — those are you deciding, this is the daemon opening a window |
| POST | `/api/bead/owner` | `{workspace, id, owner}` | sets `owner:<handle>` — who is answerable for this bead — and answers `{owner, owners[], root, changed}`. An empty `owner` hands it back to nobody, which is a thing you may say; setting the owner it already has is `changed: false` and no `bd` write at all. Every *other* owner label comes off, so resolving two machines' claims from the sheet is visible. A route of its own rather than a field of `/api/bead/adjust`, because adjust refuses a bead anybody has endorsed and ownership is most worth changing on an epic that is live — and because the ✎ may not touch `owner:` at all (`isProtectedLabel`) |
| POST | `/api/bead/addressee` | `{workspace, id, to}` | re-addresses a question — sets `for:<handle>`, the label that decides [whose phone rings](#who-a-question-is-for--me-and-the-for-label), and answers `{addressees[], changed, cleared}`. `to` is one handle; **empty, or `everyone`, means everyone**, which is a decision rather than the absence of one. Every *other* `for:` label comes off, because handing it to Carol means Carol and not also whoever it was addressed to before. Re-sending the handle it already carries is `changed: false` and no `bd` write at all. `cleared: true` says it also pulled the row out of this phone's notification shade, which it does on exactly one condition — the question is now addressed somewhere that is not this Mac — via a `dismissed` event, and with the honest limit [narrowing the filter](asking.md#and-it-does-not-tidy-up-the-noise-it-already-made) ran into: ntfy cannot recall a delivered message, so only the Android shell's own tray is reachable. A route of its own for `/api/bead/owner`'s reasons, and because the ✎ may not touch `for:` at all (`isProtectedLabel`) |
| GET | `/api/roots` | `?workspace=` | `{roots[]}` — every **open root** in that workspace (an epic at any priority, or a P0), `{id, title, priority, epic, owners[], mine}`, yours first. What the sheet offers a held bead to be adopted under. Every root and not only yours, because the dispatch gate measures against all of them; off the cached graph, and this one waits for a cold cache rather than answering "there is nothing to adopt under" |
| POST | `/api/bead/adopt` | `{workspace, id, parent}` | moves a bead under `parent` — the fix for the one hold that never clears itself, offered on the sheet of any bead with **nothing decided above it**. Answers `{parent, workable}`, where `workable` is the gate's own answer after the write rather than a promise about it. A parent with nothing decided above *it* is a 409 naming that, since the adoption would not make the bead workable; an empty `parent` detaches instead, which is how an adoption into the wrong epic is undone. The cached graph is refreshed on the way out, so the next advocate tick acts on the new shape |
| GET | `/api/history` | `?workspace=` **or** `?space=`, and `&status=&priority=&provenance=&id=&limit=&offset=&refresh=1` | `{rows[], total, limit, offset, more, workspaces[], errors[], workspace, space, query}` — [the ledger](#the-ledger-behind-the-history-tab): every bead a space has ever had, closed and deferred included, newest-**updated** first, paged. The four filters are optional and compose; each row carries `hasSession`, whether a session was archived for it, and a `closeReason` cut to 240 characters on a word boundary — two lines of the row hold 226 at the widest, and the whole sentence is on the sheet the row links to. A bad `status` or `priority` is a 400 naming the word rather than an empty list, an unknown `workspace` a 400 and an unknown `space` a 404 — but a space with no beads is `{rows: [], total: 0, more: false}` and a 200. Cached ten seconds per workspace; `refresh=1` forces the sweep |
| GET | `/api/unendorsed` | `?refresh=1` | `{beads[], counts, truncated, errors[]}` — the endorsement queue: every held bead in every workspace, newest first, each carrying the whole card (description, acceptance, the agent's provenance note) and `from`, the bead it was discovered under. No `workspace` parameter — the space picker narrows it on the client. Cached for a few seconds; a verdict drops that cache |
| POST | `/api/bead/start` | `{workspace, id}` | **puts a P0 on the board** — writes `status: in_progress`, which is the one thing the board reads (bc-s8mc). The picker ＋ opens on My Epics is the client, and `p0board.startable` is what it draws. Refusals are all 409 with a sentence, because a write bd rejects has to be visible rather than a card that silently never appears: not a P0, not carrying your `owner:` label, closed, already started, `blocked`, `unendorsed`, superseded, or a crash bead this app filed at P0 itself. Checked here as well as in the picker's own filter — the list on the phone is up to a poll old, and the bead somebody closed in between is exactly the tap that would otherwise go through. Not guarded by `OBSERVING`: like the verdict routes, this is you deciding rather than the daemon acting. The graph cache for that workspace is refreshed on the way out and a `p0board` event is emitted, which is what makes the card arrive on the next poll on every device rather than a minute later |
| POST | `/api/bead/unstart` | `{workspace, id}` | **takes it off again** — back to `status: open`, the exact reverse, and a 409 for a bead that is not on the board. The assignee is left alone, unlike `Bd.reopen`: taking an epic off the board is a decision about what leads your screen, and who is on the work is not that tap's to erase. Distinct from [pausing an epic's advocate](inbox.md#pausing-one-epic--the-button-that-stops-dispatch-under-a-p0-without-stopping-the-repo), which leaves it started and stops dispatch under it |
| POST | `/api/bead/endorse` | `{workspace, id}` or `{workspace, ids[]}` | takes the `unendorsed` marker off, so the bead becomes ordinary work an advocate will queue and a session can be opened on. **Idempotent** — two taps are one endorsement, no error, no second write — and the one verdict that may be aimed at a bead that is not held |
| POST | `/api/bead/revoke` | `{workspace, ids[], reason?}` | closes it with your reason under a fixed prefix, and **leaves the marker on**: what an agent filed and what you thought of it both stay on the record. A bead already closed is `already: true` rather than an error; one already endorsed is a `409` |
| POST | `/api/bead/adjust` | `{workspace, ids[], edits, endorse?}` | the ✎ of the proposal card, aimed at a bead that exists. `edits` may name `title, type, priority, description, acceptance, labels`, through the same clamps a proposed bead goes through; the two labels the daemon owns (`unendorsed`, `agent-filed`) are not yours to set. **Keeps the marker** unless `endorse: true`. A title may not be given to a group |
| POST | `/api/bead/changes` | `{workspace, ids[], note}` | your objection on the thread and nothing else — the bead stays held, so the next session that touches it reads what is wrong instead of re-filing it next week. The note is required, because a changes-requested with nothing said is indistinguishable from having done nothing |
| POST | `/api/bead/edit` | `{workspace, id, edits}` | **the bead detail sheet's ✎**, aimed at a bead that is already real. The same six fields as `/api/bead/adjust` through the same clamps — but **it does not inherit adjust's refusal**, because that one is a verdict on a proposal and this one is not: it works on any **open** bead, endorsed or not, and it moves no marker at all. What it does keep are the protections that were never about endorsement (`isProtectedLabel`): `unendorsed` and `agent-filed` are the daemon's, and `owner:`, `for:`, `ran:` and `filed-while:` are prefixes no card offers you to type, so a save that posted the label set it was showing would lose them by omission — `owner:` moves through [`/api/bead/owner`](#http-api) and nowhere else. One id, never a list. A **closed** bead is a `409`: its description is the record of what was done rather than an instruction, and a comment is the door for that. A bead a session is **working** is edited, and the thread line says a session was on it — refusing would mean it could never be fixed, since `in_progress` goes to closed. Answers `{id, changed, fields[], title, status, inProgress, held}`, and `changed: false` with no `bd` write at all is the ordinary answer for a form that saves on every field. `held` is what makes the endorsement queue redraw: a held bead’s title, priority and labels are what that list *is*, so editing one from the sheet drops its cache the way a verdict does |
| POST | `/api/bead/move` | `{workspace, id, to, children?, epicTitle?, dryRun?}` | **move a bead into another bead-space**, superseding the original. The copy is an **export of the real rows, remapped and imported** — never a `bd create` — because `create` carries no comments and in this tracker an answer *is* a comment, so a re-created decision bead would arrive closed, stamped answered and empty. The originals are **kept**: a bead id is named by dependencies, pull request titles, branch names and archived sessions, so each one stays where it is carrying `superseded-by:<bead-space>/<new id>` and closed — closed rather than open, or the daemon dispatches work on both copies. `children` is `move` (the whole subtree crosses, remapped under the new root) or `leave` (default: each direct child is reparented onto the departing bead's own parent first, so only the one bead goes). **`leave` with nothing above the bead mints an epic** in the old space — `epicTitle`, defaulted from the departing bead — because a closed bead cannot hold open children and no parent edge reaches another bead-space; an epic rather than a task because `hasRootAbove` treats an epic at any priority as a root. Edges *inside* the moving set are remapped; edges to beads staying behind are dropped from the copy and reported in `droppedEdges`, which costs nothing because the surviving original still holds every one of them. One edge does come off the **original**, reported in `blockersToDrop`: bd refuses to close a bead that is *blocked* (*"cannot close blocked issue … use --force"*), and a bead in the wrong tracker is very often the one waiting on work in the right one — so each original's outgoing `blocks` edge is removed before its close, the same move `Bd.dropDep` already makes for a work bead parked behind its merge card. Only `blocks`, only outgoing: an edge *into* the original lives on the other bead's row and is exactly what keeping the originals preserves. **`409` with a sentence naming what is in the way** when a live window is on any bead being moved (the process table, `lib/onewindow.js`) or an open pull request carries one (`lib/inflight.js`); a `gh` that will not answer holds nothing back and says so in `prCheck.reason`. `dryRun: true` writes nothing and answers the whole plan — the id map, the children left behind and where they land, the epic it would mint — and the ids in it are the ids the real run uses, because they are a deterministic hash of `<bead-space>/<id>` rather than something `bd create` hands back |
| POST | `/api/bead/discuss` | `{workspace, id, text, agent?}` | your question on the thread, and a reply agent sent to answer it — the one thing you can do to a held bead that is **not** a verdict. The comment is the only write: no label moves, the `unendorsed` marker stays, and a bead endorsed since the queue was drawn is a `409`. One id only, never a list. Answers `{thread[], dispatched, agent, reason}`, and `reason` is why nobody was sent when nobody was |
| GET | `/api/bead/thread` | `?workspace=&id=` | `{thread[], running, activity}` — the comments on one bead with each author resolved against the roster, plus whether an agent is still writing. What the discussion panel polls, because nothing pushes a reply on a bead that is not a `human` question |
| GET | `/api/jira/ticket` | `?workspace=&key=&epic=` | `{read, epic, children[], childrenError, cancelled}` — what the [ticket view](config.md#the-ticket-opened-over-the-tab--and-the-way-back-from-a-cancelled-one) opens with, and deliberately *not* the whole ticket: the summary, the status and when it moved are on the row already and refresh on the inbox poll. `read` is the description, the thread (newest 40, with `omitted`), the type, the priority, the labels and the ticket's JIRA parent — or `{ok: false, error}`, because a JIRA that will not answer must not take the view with it. `epic` is passed *in*, since the row has it and the server would otherwise pay a `bd list --all` for it. The only `GET` of the four: nothing about opening a ticket decides anything |
| POST | `/api/jira/approve` | `{workspace, key}` | endorses the epic behind a JIRA ticket **and its open children**, in one act — see [approve, discuss, cancel](config.md#approve-discuss-and-cancel-on-the-row--and-a-cancel-that-never-expires). Aimed at the *ticket key*, because which beads make up a ticket is a `bd list --parent` at this end of the wire. Answers the verdict shape (`applied[]`, `failed[]`) plus `{epic, children, truncated}`. A ticket whose epic has not been filed yet is a `409`; a closed child is left closed |
| POST | `/api/jira/cancel` | `{workspace, key}` | earmarks the ticket so it is never proposed again — a keyed record in `state.json` that **nothing prunes** — and closes its epic with a reason that names the ticket, marker left on. An epic that has already been approved is left completely alone (`bead: 'endorsed'`), because by then it is real work. The earmark is written even if `bd` will not answer, since letting the ticket come back next sweep is the failure this prevents. Nothing is written to JIRA |
| POST | `/api/jira/beadify` | `{workspace, key}` | the reverse: lifts the earmark, **reopens** the epic that was closed with it, drops the filer's memory of the workspace so the next sweep re-reads, and drops the *ingester's* memory of this one ticket so a reading that had failed is tried again rather than remembered forever. Reopening rather than re-filing is what makes it one epic and not two — the `external_ref` survives a close, so a fresh sweep would find the closed bead and raise nothing. A ticket that was never cancelled is `restored: false`, not an error |
| POST | `/api/jira/forget` | `{workspace, key}` | drops a cancel record whose ticket the poller can no longer find, and **leaves its closed epic closed** — see [the records with no ticket left](config.md#the-records-with-no-ticket-left). Not beadify: nothing is being put back, so reopening the epic would leave a held bead for a ticket nobody is assigned. The only route here that does not resolve `workspace` against the config, because a workspace that has left the config is the commonest way to strand a record; the name is taken as stored and validated only for being non-empty and slash-free. A ticket the current sweep still returns is a `409` naming beadify — that is the rule that a drop can never un-cancel a live ticket. A record already gone is `forgotten: false`, not an error. Nothing is written to JIRA |
| GET | `/api/work` | — | `{workspaces[], elsewhere[], advocates[], service, router}` — per workspace: claimed beads, live `claude` sessions, counts, errors. `service` is what launchd is running; `router` is whether that program is actually serving anything, or is on an older build than the disk — see the router section. `router` is `null` under `npm run start:bare`, where there is no router |
| GET | `/api/views` | — | `{views[], problems[], held}` — the screens the **repos** declare about themselves, read from each checkout's `.beadcause/views.json`. Each row carries its `view` id (`<workspace>.<id>`), label, icon, the URLs of its script and stylesheet, its address, and `generated` — whether it has a payload behind it. Cheap by construction: it reads a JSON file per workspace and stats what it names, and runs no generator. `problems` is a sentence per malformed entry rather than an error, so one bad view never withholds the good ones. The payload itself is a sibling path this table cannot spell — `/api/views/<workspace>/<id>/data`, `?refresh=1` to spend a real run rather than the held one. See [Repo views](navigating.md#repo-views--a-screen-a-repo-declares-about-itself) |
| GET | `/api/agents` | — | `{agents[], default}` — the roster you can address a comment to |
| POST | `/api/agents` | `{name, description}` | creates one and returns the new roster. `tools` is never accepted here |
| POST | `/api/agent-arm` | `{id, acknowledge?, disarm?}` | arms that agent's configured tools override for **one** reply. `428` the first time, carrying the warning to show; `409` while it is answering; `400` if it has no override |
| DELETE | `/api/agents` | `?id=` | removes one of yours; built-ins refuse |
| GET | `/api/foundation` | — | `{requests[], workspaces[]}` — the foundation channel on its own, without an inbox sweep. **The bare path is the channel and nothing else** |
| GET | `/api/foundations` | `?workspace=` | `{agents[], workspace, workspaces[]}` — every agent kind, for the list on the agents screen. Each row carries `notes`/`memories`/`lastLearnedAt`, so the asymmetry between agents is visible without opening four of them |
| GET | `/api/foundation/agent` | `?id=&workspace=` | `{agent, workspace}` — one agent's foundation, history, activity and `memory` (what it has learned in each tier, and whether any of it has ever been read back). `404` for an id that is not an agent kind. Named for its neighbours `/api/foundation/{amend,decline,log}`, and *not* the bare path: it was registered there too, where it never answered once |
| POST | `/api/foundation/amend` | `{id, workspace?, set, bead?, justification}` | edits one agent's foundation, recorded exactly like an amendment the agent asked for — same history, same justification. `400` naming the field if `set` carries a protected one, rather than dropping it silently |
| GET | `/api/flowchart` | `?workspace=` | `{title, kinds[], flows[], agents[], counts, effective, workspace}` — [the map](agents.md#the-map--which-steps-are-code-and-which-are-an-agent): every step of every flow, each one `code` · `agent` · `human` · `device` · `external` · `store`, with its detail and the files it happens in, plus each flow's mermaid source. `agents[]` is read out of lib/foundation.js with this Mac's approved amendments applied, which `effective: true` is saying. **Reads no tracker**, so it answers on a Mac whose `bd` is broken |
| POST | `/api/advocate` | `{workspace, action}` | `pause` · `resume` · `release` (free the slots) · `forget` (clear attempt counters) · `limit`/`globalLimit` (a number in `value`) · `enable`/`disable` (whether this repo has an advocate at all) · **`epicPause`/`epicResume`** (a **bead id** in `value`, not a number — [pausing one epic](inbox.md#pausing-one-epic--the-button-that-stops-dispatch-under-a-p0-without-stopping-the-repo)): writes the `advocate-paused` label, holds the whole subtree out of the queue, and messages every window under the epic to ask for a debrief before it exits. Both blocked under `OBSERVING`, as `enable`/`disable` is, and unlike `pause`/`resume` — those are a local decision about a loop that is not running here anyway, and these two write to the shared tracker and type into windows this instance did not open |
| GET | `/api/advocate-log` | `?workspace=` | the survey agent's transcript, as the CLI would have shown it |
| GET | `/api/session-archive` | `?workspace=&id=` | the archived sessions for a bead |
| GET | `/api/session-archive` | `?workspace=&commit=&file=` | one archived `session.log`, `meta.json`, `memory.md` or `transcript.jsonl` |
| GET | `/api/bead-session` | `?workspace=&id=&commit=&pr=1` | one **finished** session, addressed by bead: `{ref, sessions[], session: {commit, at, subject, files[], meta}, worktree}`. `files[]` is the archived tree, so the page knows which of the memories, the log and the worktree exist before it asks for any of them. `sessions[]` is the newest 20 on that ref and `commit` picks one of them (newest by default); `pr=1` adds the pull request for its branch, and is the one thing here that costs a `gh` call. `{session: null}` for a bead nothing ever ran on — not a 404 |
| GET | `/api/session-log` | `?pid=` | the whole session record — `{pid, sessionId, name, cwd, where, workspace, status, kind, at, startedAt}` — plus `{file, lines[]}`, the tail of its own transcript. 404 for a pid that is not running |
| GET | `/monitor`, `/advocates`, `/sessions`, `/work`, `/work.html` | — | the advocate console — and the sessions view it absorbed (one page, five paths) |
| GET | `/session` | `?pid=` | the HTML page for one live session: its facts and its transcript |
| GET | `/bead-session`, `/archive` | `?workspace=&id=&commit=` | the HTML page for one **finished** session: what it left behind, addressed by bead |
| GET | `/graph` | `?ws=&id=` | the HTML graph page |
| GET | `/api/consoles` | — | `{consoles[], workspaces[]}` — every chat session, newest first; `closedAt` set on the finished ones |
| POST | `/api/console/close` | `{id}` | soft-closes it and returns the new list. `409` mid-turn; saying anything to it reopens it |
| POST | `/api/console` | `{workspace, seed?}` | `{id, console}` — opens one; a `seed` bead auto-starts the first turn |
| GET | `/api/console` | `?id=` | the whole chat session: messages, draft, created beads |
| POST | `/api/console/message` | `{id, text}` | starts a turn and returns — follow it on `/api/console/poll` |
| GET | `/api/console/poll` | `?id=&since=&wait=` | long-poll: the whole chat session, once its `seq` moves |
| POST | `/api/console/draft` | `{id, draft}` | the cards as you edited them; re-normalised on the way in |
| POST | `/api/console/create` | `{id, draft?}` | `{created[], warnings[]}` — **the only writer in a chat session** |
| GET | `/console` | `?id=` or `?ws=&seed=` | the chat session page |
| GET | `/api/terminals` | — | `{terminals[], workspaces[], enabled}` — every terminal, newest first. `status` is `live` · `resumable` (was running when the daemon restarted; attaching resumes it) · `exited` |
| POST | `/api/terminal` | `{workspace, id?, cols?, rows?}` | `{terminal}` — opens one; an `id` seeds it on that bead |
| GET | `/api/terminal` | `?id=` | `{terminal}` — one, without its bytes |
| POST | `/api/terminal/close` | `{id}` | ends it (SIGTERM, then SIGKILL after 5s) |
| WS | `/ws/terminal` | `?id=`, subprotocols `beadcause.term.v1` + `tok.<token>` | binary frames both ways are pty bytes; JSON carries `hello` · `ready` · `exit` in, `input` · `resize` · `close` out |
| GET | `/terminal` | `?id=` or `?ws=&seed=` | the terminal page |
| GET | `/api/timings` | — | `{since, uptimeMs, budgetMs, slowMs, requests, routes[], overBudget[], starved[], joined[], background, overflow}` — what every route has cost, worst first, **warm and cold counted apart** and the `bd`/`gh`/`git` share broken out of each. `overBudget` names the routes whose p95 misses `budgetMs` on **either** side of the cache — the worse of the two, so a route that only ever answers warm and still takes a second is named — which is the question the whole thing exists to answer. `starved` narrows that to the routes that spawned nothing and had no join either, and still spent at least half their wall clock with the event loop unavailable — queued behind a busy loop with no explanation on offer (bc-1kwl.30). `joined` narrows it the other way: routes that spent at least half their wall clock waiting on a producer another request had already started — a queue with an ordinary explanation, which is why `starved` requires zero joins too (bc-1kwl.33). `background` is the subprocess time the daemon spent on nobody's request. The long-polls carry `parked: true` and are in neither list. Read as a table by `npm run timings`, and cheap enough to poll — two fixed-size buckets per route, in memory, nothing persisted. See [timing every request](#timing-every-request--which-routes-are-actually-slow) |
| GET | `/api/admin` | — | every scope and what pausing it would cost. Read-only and cheap — no `bd` call, no spawn — because `/admin` polls it and the counts on the buttons have to be current when you press one |
| POST | `/api/admin` | `{action, what, scope, mode}` | pause or resume everything, one space, or one half of it. `what` is `all` · `advocates` · `terminals`; `mode` is `drain` (default — no new launches, running workers finish untouched) or `kill`. Never run at boot: a `launchctl kickstart -k` behaves exactly as it did. Refused on an observer |
| GET | `/api/tls` | `?pairing=1` | what HTTPS is doing: the setting, the certificate on disk (name, days left), what the socket is actually serving (`serving`: name, days left, and `checkedAt` — when the renewal loop last looked, `null` from anything too old to say), the URL a phone would be handed, and whether a restart is owed. Cheap enough to poll — two file reads and a memoised MagicDNS name, and it never asks `tailscale cert` for anything. `?pairing=1` adds the link and a QR |
| POST | `/api/tls` | `{enabled}` | turns HTTPS on or off: writes `tls.enabled`, fetches the certificate when it is on (asynchronously — the synchronous one would block every request for the length of a Let's Encrypt round trip), and moves `baseUrl`. Pressing it while it is already on is the retry. Binds nothing: TLS is decided when the listener is created, so the reply carries `restartNeeded`. Refused on an observer, which shares this config with the live daemon |
| GET | `/api/devices` | — | every browser signed in with Google — a label off its user-agent, the address, when it was first and last seen — and `current`, the id of the row asking. `google: false` and an empty list where sign-in is not configured. A token caller may read it and is never one of the rows |
| POST | `/api/devices` | `{action: 'revoke', id}` | ends that one session and no other: the row is deleted, so the cookie naming it authorises nothing on its next request, on this backend and on the one replacing it. `self` when you have just revoked the browser you are holding, which also clears its cookie. **Not** refused on an observer — it shares this list with the live daemon, so the session it revokes is the same session |
| GET | `/api/deploys` | `?limit=` or `?id=` | the recent deploys, or one with its log. Four endings, not two: `ok`, `failed`, and the two that mean nobody knows — `unconfirmed` (the ordinary ending of a restart) and `lost` |
| POST | `/api/deploy` | `{key, bead?, reason?}` | runs that repo's declared deploy. `409` with no declaration, or if one is already running. Means "written down and a process owns it", never "it worked". Refused on an observer |
| GET | `/api/update` | — | what the last deploy did to **the client asking**, and what the published APK now is. `deploy` is `{web, apk}` — did `public/` move, was the shell rebuilt — for deploys of *this* checkout only; `apk` is `{versionCode, versionName, size, builtAt}` off `public/beadcause.apk` and the sidecar beside it, with an unknown version rather than a wrong one where the two disagree. A `stat` and a directory read: no sweep, because every page asks it at boot |
| POST | `/api/presence` | `{device, view, key}` | which view this device has open, so [the mirror](navigating.md#the-mirror--whatever-the-phone-has-open-with-room-to-read-it) can follow it. Wakes `/api/poll` without costing a `bd` sweep — see `changed` there |
| GET | `/api/presence` | — | `{devices[]}` — who is where |
| DELETE | `/api/presence` | `{device}` | forget one device |
| POST | `/api/claims` | `{session, repo, file, dir?, branch?, bead?}` | claim the file a session is about to edit, and be told in the same answer who else holds it — see [one granularity down](pull-requests.md#one-granularity-down-which-file-somebody-is-already-editing). `decision` is `held` or `conflict`, and a `conflict` carries the `reason` `scripts/claim-guard.sh` prints as a denial. The asking *is* the taking: it decides and records in one synchronous call, so two edits a moment apart cannot both find the file free. On the bus deliberately never — an event per claim would hang a `bd` sweep off every keystroke. A `conflict` also carries `regions`: which lines each side has changed, derived from git on that branch only (`lib/regions.js`), `null` whenever git cannot answer. `bead` is filled in by the daemon rather than by the caller — resolved from the branch once per branch and verified against the tracker (`lib/claimbead.js`), so the first claim from a fresh branch answers before it is known and every later one carries it |
| GET | `/api/claims` | `?regions=1` | `{claims[], collisions[]}` — every live claim, and the files more than one session is holding. `regions=1` adds the changed line ranges to each collision and whether they overlap; opt-in, because it is several git spawns per collision and a list of names should not pay for them |
| DELETE | `/api/claims` | `{session, files?}` | let go of one file, or of everything that session held. Sent on `SessionEnd`, so a finished session stops holding files without waiting out the TTL |
| GET | `/api/requirements` | `?id=` | `{corpus, dir, tokens[], totals, orphans[], graph, summary}` — the requirement graph and, first, how much of it is missing: how many of the corpus's requirements have any edge at all, how many of those a merge proved rather than an advocate forecast, and how many edges are recorded against ids the corpus no longer has. `?id=` returns one requirement and its edges instead. `{corpus: null}` and a 200 on an install with no architecture checkout, which is every personal one — a state, not an error. Read-only: promotion into the corpus is a proposal a human applies from `beadcause-requirements promote` |
| GET | `/api/controls` | `?id=`, `?months=` | `{size, crosswalkEdges, reviewMonths, controls[], frameworks[], totals, unevidenced[], forecastOnly[], stale[], orphans[], graph, summary}` — [the control graph](compliance.md#control-to-evidence--refsbeadcausecontrols) and, first, everything it cannot evidence: every control with no edge at all, the ones a bead forecast and no merge has proved, the ones whose newest proof is older than the review period, and edges recorded against ids the corpus no longer has. Each is a **list of ids**, not a count — a finding is a task with a name on it, and each is `controls` filtered by `state`, so a count can never disagree with its own list. `controls` is one row per control carrying its title, kind, group, edge count and state — enough to put a name beside every finding without a request per row, and deliberately not the definition, which is a paragraph 192 times over. `?id=` returns one control, both directions of its crosswalk, and its edges; an id the corpus does not have is a `404` rather than an empty answer, because an empty edge list is the ordinary state of almost every control here. `?months=` measures staleness against a shorter observation window. Unlike `/api/requirements` there is no `{corpus: null}` state — `lib/controls.js` ships with beadcause, so a denominator is always available. Read-only |
| GET | `/api/skills` | `?workspace=` **or** `?space=`, and `&refresh=1` | `{library[], candidates:{counts, rows[]}, audit, checkouts[], untracked[], errors[]}` — [the Skills view](b7e-tools.md#whether-the-library-is-being-used--the-skills-view): the `b7e-*` commands that exist, every candidate bead with its state, and what the audit agent has read. Scoped exactly as `/api/history` is, with the same three refusals. **`untracked` is part of the answer, not an omission**: four of the six numbers the view was asked for need a record of a skill being called and nothing writes one yet, so each is returned named, explained, and carrying the bead that would measure it. Kept 30s per scope; `refresh=1` forces the read |
| POST | `/api/session-say` | `{pid, text}` | says one line into a live session's own iTerm window. `413` with the words left in the box if it is past `SAY_MAX` — the message rides to `osascript` as an argument, and past `ARG_MAX` the failure reads as "the session is gone", which is the one thing this must not lie about |
| POST | `/api/session-focus` | `{pid, action}` | `focus` raises that session's iTerm window and doubles it in place; `restore` puts it back at the bounds it was read at. Focusing is gated on the same `reach` as the composer and on the pid still being live; restoring is gated on neither, because it arrives by `sendBeacon` from a page being torn down and must work for a window whose session has since exited |

Two more, **loopback and token only**, and never proxied to a backend — anyone on
the tailnet holding the token could otherwise stop the poller:

| Method | Path | Returns |
|---|---|---|
| GET | `/internal/router/state` | `{router, disk, stale, poisoned, deferred, serving, outage, retryAt, slowness, certificate, active, retiring[], green, greenStarting, greenLast, greenCondemned[]}` — what `npm run swap:status` prints. `poisoned` is a build that *died* at startup; `deferred` is one that will be tried again, carrying the `kind` of failure it was — slow, a lost port, or stopped from outside — and when.  `certificate` is `{name, daysLeft, checkedAt}` off the live socket, or `null` when the port is serving plain HTTP |
| POST | `/internal/router/swap` | `{ok, active}` — or `{ok:false, error}` if the new build would not start |
| POST | `/internal/router/green?id=` | `{ok, green, active}` — stands candidate `id` up on green beside blue (bc-sj8k.1), or `{ok:false, error}` saying why it was refused or would not start. `node bin/router.js --green <id>` |
| POST | `/internal/router/green/drop` | `{ok, dropped}` — the id taken down, or `null` when nothing was standing. `node bin/router.js --drop-green` |

Every proxied response also carries `x-beadcause-build` and `x-beadcause-pid`,
naming the process that actually answered, and `x-beadcause-env` saying whether that was
blue or green. `/__demo/blue` and `/__demo/green?id=` are the router's own as well; see
[Candidates](#candidates--what-a-green-backend-will-be-spawned-from).

Two things that bite: `commentCount` is **0 from `/api/questions`** and only correct
from `/api/question`, because `bd human list` doesn't return it. And a question
filed through `/api/ask` is **not** pushed — you filed it yourself and are looking
at the screen — though it does raise a `created` event so other clients refresh.

A row from `scope=agent` is **not** a question: it carries `agent: true`, has no
`decision`, and its `description` is deliberately absent — fetch that from
`/api/bead`. `/api/question` is the wrong endpoint for one, because it parses the
decision block and only means anything for a `human` bead.

### The three counts on the poll

`/api/questions` carries a `summary` — `{sessions, proposals, questions}` — because
the chrome of the inbox wants to say how many beads are asking you something, how
many agents are running and how many advocates are waiting on an answer, and it is on
screen whenever the inbox is. Everything else in that picture is on `/api/work`,
which is two `bd` calls per workspace and about a second for six: fine when you open
it, not fine every thirty seconds on a phone.

These three are the exception because none of them costs a `bd` call. `sessions` is a
readdir of `~/.claude/sessions` plus a JSON parse per record — every live session on
the Mac, including ones in no configured workspace, which is exactly the set the
advocate console lists (the ones outside every workspace under **Elsewhere**). It is
no longer a tab badge — see [the pill row](navigating.md#getting-around--the-pill-row) — but the
console's tally is drawn from it. `proposals` counts **advocates**, not beads: one open ask per
advocate is the rule `propose()` enforces, so a repo with two proposal-shaped beads
in it is still one repo waiting on you.

`questions` is the inbox's own count — the beads asking you something — and it is the
questions channel only: a [foundation request](agents.md#a-channel-of-its-own-on-every-surface)
has the ⚖️ badge in the bar already, and counting it in both places would make the two
disagree about the same bead.

`proposals` and `questions` are both held from the last `human` sweep rather than
counted out of the response, and that is deliberate. The `agent` scope runs no
`human` sweep at all, so counting the rows would empty them the moment you switched
tabs — which reads as "answered" rather than as "not fetched". The poller sweeps every
thirty seconds whatever any client asked for, so the numbers are at worst one poll old
in any scope.

The field is additive and its own object: a client that has never heard of it — the
installed Android build, a service worker still serving last week's `app.js` — reads
the fields it always read and renders exactly as it did.

### The ledger behind the History tab

`GET /api/history` is the only endpoint here about the **past**. Every other one answers
a question about now — what is asking you something, what is running, what is waiting on
a tap — and there was no route at all for "what happened to that bead". A closed bead was
reachable only by remembering its id and typing it into `/graph`, while three hundred
closed beads in this repo carried the best writing in the tracker in their close reasons
(`Landed as #92 as 677b5a5b — still owed: DEPLOYED`). The record existed and nothing
displayed it.

**Ordered by `updated_at`, not `created_at`.** Every other list here is newest-*filed*
first, which is right for a queue of things you have not seen yet and wrong for a record:
the bead you want after a night of unattended sessions is the one that just closed, and
it may have been filed in April. That also makes the ordering the answer to "what has
been happening", which is the question the tab exists for.

**One sweep serves every filter and every page.** The filters are applied in the daemon
rather than pushed down to `bd`, which is backwards from how the rest of this app talks
to the tracker and deliberate: the sweep is *cached*, and a cache keyed by the query
misses on every press of a filter chip. A filter bar is a finger moving through four
controls — narrow to closed, then to P1, then type three characters of an id — so with
the query in the key that is four `bd list` invocations over the whole workspace, and
one more for every page of the scroll. Swept once and filtered in process it is one
`bd list --all` per ten seconds, whatever the finger does. What is cached is the *slim*
row, not bd's payload: a `bd list --json` row carries description, acceptance, design and
notes, which is 1.5MB for 503 beads and none of it drawn by a list. A page of five rows
goes out as 3KB.

**The close reason is cut to 240 characters, and that is a measurement rather than a
round number.** It is the one piece of long prose a row does draw, and it used to go out
whole — 1664 characters on the worst bead here. That was right at the time: the bead
detail sheet rendered `close_reason` nowhere, so there was no "tap through for the rest"
to clamp *towards*, and cutting it in the payload would have put the sentence nowhere in
the app at all. [The sheet's outcome block](inbox.md#how-it-ended--the-close-reason-and-when)
removed that reason — a closed bead now shows its whole reason there, and every row of
this ledger already links straight at it. So the row's copy became a preview of something
one tap away, and a preview only has to be as long as the preview can show.
`.hist-why` clamps to two lines in CSS, and two lines were measured in a headless Chrome
at **94 characters** on a 393px phone and **226** at the widest this page can ever be
(`main.work` caps at 780px, so that is a ceiling and not a wide-monitor figure). 240 sits
just above the ceiling on purpose: the CSS clamp stays the only clamp anybody sees, at
every width, and the payload one only ever drops text that was already undrawable. Over
the 600 beads in this repo that takes a fifty-row page's close reasons from 5454 bytes to
3321 — 39% off the field that dominates a ledger page, on a screen that pages fifty rows
at a time over a phone link. It cuts on a word boundary and appends `…`, which matters
for the reader that is not looking at pixels: `-webkit-line-clamp` hides text visually but
a screen reader still reads all of it, so the ellipsis is the only thing that says the
sentence continues. Nothing here filters or searches on the field — the id filter is the
only text one — so a clamped copy costs no behaviour, and `/api/bead` still hands the
sheet bd's issue verbatim.

**That one sweep is the slow part, and it is slower than it looks.** ~1s for 503 beads on
an idle Mac, and **28.6s** measured under a load average of 33 — twenty agent sessions and
a full test suite, which is an ordinary afternoon here. That measurement is where
[the two-minute ceiling on every `bd` call](development.md#notes-on-bd) comes from: under the 30 seconds
it used to get, that afternoon throws, the workspace becomes a row in `errors[]`, and a
repo with five hundred beads in it draws an empty ledger. A cold page can take that long to
arrive and the client should say it is loading rather than time out; every page after it,
for ten seconds, is free.

The cache cannot help in the window *before* the first answer exists, which is the
expensive window — so the in-flight sweep is shared as well. Two requests for the same
workspace arriving before the first returns are one `bd list --all` between them, and a
`refresh=1` **joins** a sweep already running rather than starting a second: a sweep that
began a moment ago and has not come back is reading the tracker now, so it is exactly as
fresh as one started alongside it would be. A sweep that *failed* is not remembered — the
next request tries again.

**Paging is in the daemon because `bd` cannot do it.** `bd list --offset` is documented
as supported only under `--proxied-server`, which is not the mode anything here runs in;
the embedded backend accepts the flag and ignores it, so page 2 would have been a second
copy of page 1. And `more` is computed from a total the daemon counted rather than from
`rows.length === limit` — that inference is wrong exactly once per list, on the page
where the last row lands on the boundary, and the symptom is an infinite scroller that
spins at the bottom forever.

**Provenance is the `agent-filed` label, never the byline.** `created_by` is a field an
agent writes for itself, so it is display only; the label is what filing stamps and what
[a verdict](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time) keeps on through both endorsement and revocation, precisely so
one `bd list --label agent-filed` stays the honest history. Both are on the row and they
will sometimes disagree — when they do, the label is the true one.

**`hasSession` costs one `git` call for the whole page.** Every archived session lives at
`refs/beadcause/sessions/<bead-id>` (see [the session log, kept in the repo](advocates.md#the-session-log-kept-in-the-repo)),
so the set of beads that have one is a single `for-each-ref` over that prefix — 174 refs
in about ten milliseconds here — rather than a `git log` per row. An empty set is
deliberately indistinguishable from a failure: a checkout that is not a repo, a retired
worktree and a repo where nothing has ever been archived all mean "no row here has a
session", which is true for the last and harmless for the others. What it must never do
is refuse to draw the list over a marker.

**`workspace` or `space`, and neither is required.** A space is a *set* of repos, so "the
ledger for a space" has two honest readings and both are served: one repo at a time,
which is what the tab asks for today, or a whole space merged and interleaved by date.
`space=all` (or nothing at all) is every configured workspace, and the synthetic `Other`
group resolves here for the same reason the picker draws it. A repo whose `bd` fell over
is a row in `errors[]` rather than a failed request — six repos where one has a corrupt
Dolt directory should still show you the other five, and the one that did not answer is
named, because a ledger that silently dropped a repo would be saying that repo has no
history.

## A tracker two Macs share

Everything else in these documents treats *the tracker* as one thing, and on one Mac it is
one thing: `~/beads/<name>/.beads` is an embedded Dolt database on this laptop's disk,
and a bead created here is a bead visible here. The whole app is arithmetic over that —
the inbox, the counts, the advocate's ready queue, the endorsement drawer.

Dolt can be pushed to a remote and pulled from one, and until this landed **nothing in
beadcause had ever called either**. `grep -rn dolt lib/ bin/` found five comments about
embedded versus `bd dolt start` mode and not one `bd dolt push`. Syncing was a thing a
person typed, in a terminal, when they remembered — which means on the days nobody
remembered, two engineers running beadcause had two private issue graphs that never met.
Six engineers would have six. That is not a federation with a sync bug in it; it is six
separate apps that happen to look the same.

It is also the failure this app is least able to show you. A repo that could not be
*read* draws a banner and a stale list, and you can see that it might be wrong. A
tracker that is not *syncing* draws a list that is completely correct about this Mac and
silently missing everything the others have written since it stopped. Every count is
real. Nothing is stale. There is nothing on the screen to notice — which is the shape of
every failure this app exists to prevent, arriving one machine removed.

### Which workspaces sync: the ones that have a remote

There is deliberately **no list in the config**. A workspace with a Dolt remote is a
workspace that syncs; a workspace without one is silent, and costs one cheap
`bd dolt remote list` per interval to establish there is nothing to do.

That is not laziness about configuration. A list is a second place to be right, and both
ways of being wrong are invisible: a shared workspace missing from the list never syncs
and never says so, and a solo workspace named in it reports a failure every two minutes
about a tracker working exactly as intended. `bd dolt remote list --json` already answers
the question, from the workspace itself, and cannot disagree with itself. So the whole of
turning this on, for a workspace you want shared, is:

```sh
cd <the workspace — the directory holding its .beads>
bd dolt remote add origin git+ssh://git@github.com/<org>/<repo>.git
bd dolt push
```

The next tick picks it up. Nothing is typed on this side, which is the point — the
acceptance criterion for this was a bead created on one machine being visible on another
*without anybody typing a sync command*.

Note that a workspace is **not necessarily under `~/beads`**: Northwind's lives inside
the `architecture` checkout, because that is the repo the team already clones. So nothing
here builds a path out of a workspace's name — the `cd` a failure notification prints
comes off the workspace's own directory, and the one place that guess was made is the
one place it would have been wrong first.

### Where a workspace lives, when it is not under `~/beads`

Two settings answer this, and the one below is the narrower of them.
[`workspaceRoots`](config.md#where-trackers-live--workspaceroots-and-the-two-shapes-a-root-can-have)
says *where to look*, so everything under a root is found without naming any of it;
`workspaceDirs` names *one workspace* and is the only way to say `null`. Reach for a root
when a directory holds trackers, or is one you would happily have read for new ones;
reach for a name when neither is true, or when the point is to take a name out.

That paragraph was true of the sync code and false of everything upstream of it.
`discoverWorkspaces()` in `lib/config.js` reads `~/beads/*/.beads` and takes what is in
it, and for a long time that was the whole of how beadcause knew a workspace existed —
so a tracker living anywhere else was not merely un-synced, it was **not in the list at
all**. Nothing polled it, nothing queued it, nothing drew it.

That is not a hypothetical, and the two halves of it happened to the same tracker on the
same afternoon. On 2026-08-12 Northwind's `cl-` graph — the one wired to JIRA, the one
forty service repos file into, and the only workspace on this Mac with a Dolt remote —
was moved out of `~/beads/northwind` and into the `architecture` checkout, for the reason
the section above gives: a tracker a team shares belongs in the repo the team already
clones. beadcause stopped seeing it that evening and said nothing, because there is
nothing to say. **A workspace nothing polls is indistinguishable from a workspace with
nothing in it**: an empty inbox, a zero on the tab, and an advocate with no ready beads
is exactly what a quiet Friday looks like.

The copy left behind was the other half, and it is the worse one. It sat at
`~/beads/northwind.retired-20260812`, which is still under `~/beads`, so it was still
discovered and still swept — and its questions, frozen on the day it was set aside, were
drawn as current ones on the phone. A stale question you cannot see is a question that
goes unanswered; a stale question you *can* see is one that gets answered, into a graph
nobody reads. The only way to stop it was to move the directory out of `~/beads`
entirely, which is a person remembering a rule about this program while doing something
else.

So there is one key, `workspaceDirs`, and it says both:

```json
{
  "workspaceDirs": {
    "northwind": "~/northwind.dev/architecture",
    "northwind.retired-20260812": null
  }
}
```

A **directory** serves a workspace from wherever it actually is. Write it as the checkout
or as the `.beads` inside it — the checkout is the thing a person has in their head and
the `.beads` is beads' business, and both name the same workspace. `~` expands, because
this is a hand-edited line that gets copied onto a second Mac. **`null`** takes a name out
and keeps it out, however it was found; nothing is deleted and nothing moves, which is
the point — the directory being *there* is the whole state being talked about, so "drop
what no longer exists" could never have expressed it.

**The `null` half has a button now**, under **Trackers** on `/admin`, and it is the same
key written for you rather than a second mechanism. The list there is every workspace this
Mac reads, each with the space the picker files it under; Retire writes the `null` and
Bring back deletes it. Both take effect without a restart — the running daemon's own list
is updated in the same press, so the tracker stops being swept immediately rather than at
the next start, which is what the screen would otherwise be lying about.

It is on `/admin` rather than on `/config` because it is a statement about the machine
rather than about one space, which is the line those two pages are already divided on. The
thing it cleans up is the space picker, and the picker cannot host it: that control is a
native `<select>` on purpose — a wheel on a phone, a real menu on a laptop, and never
half-open behind a card — and a `<select>` cannot carry a button per row. So a finished
repo used to sit in the dropdown until somebody hand-edited this key on a machine they had
to be sitting at.

Retiring **leaves the name in its space**, and that is deliberate rather than untidy: it
is what makes Bring back one deleted key, returning the repo to the space it was always in
with every per-workspace setting intact. The alternative — dropping it from
`spaces[].workspaces` — would make a restore guess where it came from, and a wrong guess
lands the tracker in "Other" without saying so. A space naming a deliberately retired
workspace is therefore *not* reported as config drift; `/config` says it is retired and
where to bring it back, and keeps the drift warning for the case it was written for, a
checkout that went somewhere without telling anybody.

The beads are untouched by any of this. It is a line about what gets **read** — which is
what makes it safe enough to be a button, and what the confirm sentence on that button
says before the second press. What stops while a tracker is retired is being told: no
questions from it, no advocate, no notifications. All of them are still in the tracker,
and all of them come back with it.

`~/beads` is still the rule and this is still the exception. An install that has never
configured anything finds its workspaces exactly as it always did, which is what makes a
first run work at all; a name that appears in both places resolves to the one that was
named, because two entries called `northwind` pointing at two graphs is the one outcome
nothing downstream could make sense of. A named directory that is not there is a
**warning, not a refusal** — the entry is dropped, a line naming the key goes to the log,
and `~/beads` still answers for that name if it has one. A typo must be loud, since a
workspace silently not served is the exact failure this key exists to end; it must not
also take out a workspace that was working.

The half worth being precise about is that this is a **rule, re-applied on every load**,
and not a list. Before it existed the workaround was to hand-edit `workspaces` — the
saved list, which was auto-discovered but persisted so it *could* be edited. That works
until the first time it doesn't. `workspaces` is reconciled against the disk on every
start: entries whose directory has gone are dropped and the shorter list is written back.
For a discovered workspace that is self-healing, because the next start finds it again.
For a hand-added one it was **one-way** — a single start while the checkout was moved,
re-cloned, or on a volume that had not mounted yet lost it for good, with a log line
saying `no longer exists` at a moment when that was perfectly true. An entry in
`workspaceDirs` comes back on its own the moment the directory does, and that — surviving
a restart — is the whole difference between the two.

Reconciliation applies the exclusions too, so a retired workspace already sitting in a
saved `workspaces` list is evicted on the next start rather than only kept out of future
discovery. Every drop names its reason, and the three reasons are different sentences:
`workspaceDirs.<name> is null`, `workspaceDirs.<name> names <dir> instead`, and the
original `<dir> no longer exists`.

Which leaves the installs that had already worked around this by hand, and they get the
migration rather than a note telling them to make one. Any saved `workspaces` entry that
**cannot have come from discovery** — its directory is not `~/beads/<its name>/.beads` —
is copied into `workspaceDirs` on the next start. Nothing changes about what is served:
the entry was already in the list and already pointed there, and this only writes down
*why*, so that it survives the directory going away for an afternoon. It is bounded by
reading the config rather than by a spent flag — a name already in `workspaceDirs` is
never touched, so an explicit `null` cannot be undone by it, and a directory that is not
there is left for reconciliation to drop rather than pinned as a rule that would warn on
every start forever.

**It says nothing while doing it**, and the drop and pick-up notices moved to stderr —
neither is a matter of taste, and both were measured. `loadConfig` is not the daemon's:
it is every `bin/*.js` in the repo, and both of a CLI's streams are contracts. **stdout
is parsed** — `bin/file.js` prints the id it filed and callers read it with
`stdout.trim()`, so a notice there does not appear *beside* the id, it becomes *part of*
it, and the caller reports that nothing was filed over a bead sitting in the tracker
(`test/autoendorse.mjs` and `test/filing.mjs`, both red). **stderr is asserted empty on
the happy path** — "nothing was reported, because nothing went wrong" is
`test/park.mjs`, which is how the adoption notice went red immediately after being moved
off stdout to fix the first one. So a normalisation nothing went wrong in is not news,
and it leaves its own record: the key it writes is in the config file. A write that
*fails* is news, and is warned about. This is the same argument [the base URL
makes](#the-url-you-are-given-and-what-happens-to-a-phone-that-already-has-one) for its
own notice, arrived at from the other end.

### Where the remote goes, and why beadcause will not choose for you

**beadcause never adds a remote.** It syncs one that exists and it never invents one, and
that refusal is deliberate rather than unfinished: where a tracker is published is a
decision with consequences no daemon should make on somebody's behalf, and it is the one
kind of decision that cannot be taken back. A push to a public repo is on the internet
whatever you do next.

The pattern that works is the one the `northwind` workspace here already uses: ride the
repo the team already clones, as a `git+ssh://` Dolt remote. Issue data goes on
`refs/dolt/data`, so it never touches the file tree, never appears as a branch or a tag,
and `git pull` there never updates issues — which is precisely why co-locating them is
safe. **The repo has to be one you are willing to have the whole issue graph in**, and
"whole" is literal: every bead, every comment, every answer you have ever given from your
phone, in a history no later deletion reaches back into. `Northwind/architecture` is
private and org-visible, which is what makes that instance fine. A public repo is not the
same situation, and the fact that it is *your* public repo does not change it.

Two consequences worth knowing before you do it:

- **A plain `git clone` fetches no issues.** Dolt data on `refs/dolt/data` is not
  something git pulls by default, so a new machine or a new teammate must run
  `bd bootstrap` once. That belongs in the install story rather than in a debugging session
  six weeks later, and it is now in it: `team.json` names the remote, the installer writes
  it into the workspace's `config.yaml` and bootstraps from it, and nobody types the
  command — see [installing against a team's tracker](install.md#installing-against-a-teams-tracker),
  including the two states it refuses instead.
- **Nothing here is a JIRA sync.** Pull-only, surgical, and unchanged — see
  [JIRA, per workspace](config.md#jira-per-workspace--read-only-and-one-setting).

### When it syncs, and why the interval is not a performance knob

Every `sync.seconds` — 120 by default, floored at 30 — the daemon runs `bd dolt pull` and
then `bd dolt push` for each workspace that has a remote. Pull first, and not the other
way round: a push against a remote that has moved is refused, so pushing first would
report a failure on every tick of a tracker that is working perfectly. It is also the
half that matters more. A machine that pulls and never pushes is merely behind; a machine
that pushes and never pulls is the one writing over other people's work.

The interval is a setting because it is the **width of the window in which two machines
can act on stale information** — the same window two advocates opening a session on the
same ready bead live in. It sits between the 30-second poll and the 5-minute release
sweep on purpose: this is the only sweep that touches both the network *and* Dolt's
single writer, so it is genuinely more expensive than the reads, while a five-minute
window is long enough for two Macs to both start an hour of work on one bead. The floor
is 30 rather than the poll's 5 because there is no such thing as a usefully faster sync —
a `git push` per workspace every few seconds would spend more of the day holding the
write lock than the agent sessions do.

Workspaces sync in parallel, because they are separate databases with separate remotes
and doing them in turn makes a tick cost the sum of the slow cases rather than the
slowest one. A workspace still syncing when the next tick comes round is skipped rather
than queued: two `bd dolt push` against one embedded Dolt would only fight each other for
the write lock.

### The ceiling has to be smaller than the interval, and it was not

"The interval is the retry" is the argument all three `bd dolt` calls are built on, and it
is only true while a call *finishes inside the interval*. It did not. `BD_TIMEOUT` is two
minutes and the default `sync.seconds` is two minutes as well — not a coincidence anybody
arranged, just two defaults picked in different files for unrelated reasons — so a tick
that burned its ceiling was **still running when the next tick came due**, got skipped,
and one collision cost two intervals rather than one. Pull and push run in sequence, so
the worst case was four minutes against a two-minute interval.

So the ceiling is now derived from the interval rather than inherited: each call gets 40%
of `sync.seconds`, capped at `BD_TIMEOUT`, which puts a whole tick inside the interval
with margin at every setting including the 30-second floor. The number is computed in
lib/sync.js because that is where the interval lives, and handed to lib/bd.js by the poll
cycle — the only place that holds both.

**A workspace that has never synced still gets the full two minutes**, and that is the
whole reason this could not simply be a smaller constant. A short ceiling is right for a
workspace whose sync is a going concern — its pushes are a handful of Dolt commits — and
wrong for one that may be doing the large *first* sync, where a ceiling set too low is not
a slow tick but a sync that can never complete and reports as broken every time. One clean
sync earns the short ceiling and an outage afterwards does not take it away; a restart
forgets, like everything else here, and pays one generous tick per shared workspace.

### A lock is not the network, and the retry is back

These three calls used to retry nothing at all, argued from the one thing that makes them
unlike every other write: they go to the *network*, and a retry of a two-minute network
timeout is four minutes of a poll cycle spent on a workspace that will be tried again in
two minutes anyway. Sound — and silent about the other thing they queue behind. `bd dolt
pull` run by hand against the `architecture` workspace finished in **four seconds** on a
day the daemon had logged four *"still running after 120s"* lines against that same
remote, and 56 by the time anyone counted. That time was going to embedded Dolt's single
writer, which twenty-plus agent sessions hold in bursts — the exact collision every other
write here retries four times for.

They retry twice now, and **nothing about the network argument had to be given up**: `run`
refuses to retry a timeout at all, so a retry can only fire on a lock refusal that came
back in milliseconds, and a call killed at its ceiling still costs exactly one ceiling.
Two rather than four because these are on a timer — anything 400ms and 800ms of backoff
cannot clear is the next tick's problem by definition.

### A sync that stopped is loud, and a conflict is louder

A sync that works says **nothing**. No line, no event, no push. A tick reporting "synced
4 workspaces" every two minutes is 720 lines a day nobody reads, and the 721st — the one
that says it failed — is the one that scrolls past.

So the *transitions* talk, and there are exactly two of them per incident:

- **It broke.** One line on the daemon's log, one red row in the [monitor](#the-monitor--what-it-is-doing-right-now)'s event pane, one banner on the inbox naming the repo and printing what `bd` said, and one ntfy push. Then silence until something changes.
- **It came back.** The banner clears itself the moment the next sync succeeds, and a second push says so — because a warning with no all-clear is one you keep checking.

The banner is its own pane, directly under the "could not be read" one and in orange
rather than red, and the two are **never merged into one list**. They stack on the same
screen — a locked Dolt fails the read and the sync in the same tick — and they are
opposite claims about the beads underneath: the red one says what you are looking at is
stale, the orange one says it is *perfect about this Mac* and quietly missing everybody
else's.

**A conflict is called out separately from a failure**, and the distinction is the one
thing here worth remembering. A failed sync is transient by nature — a dropped network,
ssh not unlocked, Dolt holding its write lock — and the next interval very often fixes
it, so it is a priority 3 that says it is retrying. A conflict means two machines wrote
the same bead and Dolt cannot merge them; it will still be there in an hour and in a
week, because nothing has ever retried its way out of one. It needs a person, so it says
so in the title, at priority 4, in different words on the banner. Filing those two under
one word is how a divergence sits for a fortnight under a label that says "retrying".

**And a third word, for the failure that is neither.** A conflict is two machines
disagreeing. A failure is the network. `stuck` is one machine that cannot move, and it
exists because the other two words were both wrong about a real outage for a week.

On 2026-08-17 the `architecture` workspace had not pulled in **73 logged ticks**, every
one of them the same string, every one filed as `failed` — a word whose whole meaning is
that the next interval may fix it. It could not. What it turned out to be is worth
writing down, because every tool you would reach for to diagnose it says there is
nothing wrong:

```
$ dolt status
On branch main
nothing to commit, working tree clean

$ dolt merge origin/main
error: local changes would be stomped by merge:
        events
 Please commit your changes before you merge.
```

`dolt status`, `dolt diff`, the `dolt_status` table and `dolt_diff_summary` all reported
nothing, and forty samples over a minute never caught the working set dirty. The root
hashes are what showed it: `WORKING` genuinely differed from `HEAD` while `STAGED`
matched it, and the difference was **physical rather than logical** — the same rows,
stored differently. Merge's guard compares roots, so it fires; every diff a person can
run compares content, so they all say clean. The error asks you to commit changes that
do not exist.

Three things follow, and each is a rule rather than a note:

- **It is not a race**, which was the leading theory. A plain `dolt merge` typed by hand
  fails exactly as the daemon's `bd dolt pull` does, deterministically, against a clean
  tree — so it is not a collision with the twenty agent sessions writing that graph.
- **No interval fixes it**, so the screen stops saying it retries. A `stuck` row says
  how many identical failures instead, and the push to the phone goes to priority 4 with
  a title that says STUCK — the same rank as a conflict, because both need a person,
  and a separate word because they need *different* things: a conflict needs a decision
  about whose write wins, this needs a command typed.
- **The merge had nothing to do.** `main..origin/main` was **zero commits**. The guard
  fires before Dolt notices the merge is a no-op — so this can strand a workspace that
  is not even behind, and pull-then-push returning on the first failure meant **208
  local commits never reached the team** while a no-op pull failed in front of them.
  A stuck pull therefore **still pushes**. Half a sync is worth having, and it is the
  half that gets this Mac's beads out.

Beadcause tries exactly one recovery on its own, and it is the one Dolt's own message
names: `bd dolt commit`, then the pull once more. Committing *keeps* the changes, which
is what makes it safe to do unattended on a tracker twenty sessions are writing into.
The other way out — `dolt checkout <the table the error names>`, which is what actually
cleared this one — **discards** the working set, so it stays a sentence in the
notification for a person to type and is never something the daemon does.

For any error that is *not* one of those shapes, the same promotion happens on a count
instead: five byte-identical failures in a row and it stops calling itself transient.
That threshold is knowingly the weaker half — the daemon restarted 505 times across the
log this was measured on, and 85 of the 97 sync lines in it follow a restart, so an
in-memory streak rarely reaches five. Recognising the *shape* on the first tick is what
survives a restart, and is why the two rules exist side by side.

**And the count is compared against what the tick itself said, never against the word it
was promoted to.** That sounds like an implementation note and it is not: the fifth
identical failure becomes `stuck`, and comparing the sixth tick's `failed` against that
stored `stuck` made the two differ — so the count restarted, the word fell back to
`failed`, and a word changing is the one thing that always reaches the phone. A workspace
failing identically all afternoon buzzed **every ten minutes for ever**, telling you each
time round that it had stopped being stuck. It is the same complaint as the flapping
below, arriving through the escalation path rather than the transition one, and no
damping catches it by design.

**And a fourth thing it can say, for the tracker that has no incidents to report.**
Everything above assumes a sync that breaks and then is broken. One that breaks, comes
back, breaks and comes back on a two-minute clock satisfies the transition rule perfectly
and defeats it completely: every one of those is a genuine transition, so every one of
them is a push. Measured on the log this was filed from, that is **nineteen
notifications about one workspace in one day** — nine recoveries against ten failures,
alternating almost perfectly. It is the swipe-it-away notification arriving by the other
door, and worse than the every-tick version it replaced, because half of them are
recoveries and a recovery carries no urgency at all.

So the transitions are counted as well as reported. **Four inside an hour and the
workspace is flapping**, which is said once — the card names the count and says outright
that the quiet after it is deliberate — and is then the last thing the phone hears about
that workspace until it holds one way for a clear hour. The window doubles as the settle
rule, so the card comes down on the same evidence it went up on.

Three things it deliberately does not do, and each is the difference between damping and
losing a notification:

- **It counts transitions, not ticks.** The obvious shape is to require N ticks in the
  new state before it counts as a transition at all — and that shape fails *silent* here.
  The previous outcome is in memory, this daemon restarts constantly, and every restart
  puts it back to null, so a consecutive-tick counter spends its life at 1 and never
  reaches its threshold: the transition is simply never announced. A transition counter
  under the same churn declares nothing and lets every transition through, which is the
  behaviour this replaced. It can only ever go wrong in the direction of being told too
  much.
- **A single outage is untouched.** One break and one return is two transitions and never
  reaches four, so the case the transition rule was built for behaves exactly as it did.
  Damping that quietened a real outage would be a regression wearing a fix's clothes.
- **Nothing that has stopped retrying is ever damped.** A flapping series whose failures
  turn into a conflict, or into `stuck`, says so at full volume — that is the sentence
  saying the promise of a retry has been withdrawn, and a tracker that will not settle is
  where it most needs hearing. On a flapping workspace that escalation arrives as an
  ordinary break rather than as a word changing under a steady failure, which is why the
  rule asks what state it is in rather than what moved.

**The log and the monitor keep every transition**, damped or not, with a note on the line
saying the phone was spared it. The record is the only account of what a tracker has been
doing — three separate passes over this bead reconstructed a week of it by counting these
lines — and a record with the boring half deleted cannot be counted.

The failure path is what `node test/sync.mjs` covers, and it is the half that is tested
for a reason: a sync that works is provable by looking at a second Mac, and a sync that
quietly stopped looks exactly like a quiet team.

### Who a question is for — `me` and the `for:` label

Sharing the tracker hands every daemon the whole graph, which is the point, and it
creates a problem the moment there is more than one of you. Every push in lib/notify.js
goes to one ntfy topic and the inbox is one list. On one Mac that is correct — there is
one person and every question is theirs. On six it is the same code doing something
quite different: six daemons see the same new `human` bead and each buzzes its own
phone about it. **One question rings six phones and five of those people cannot act on
it.** The fan-out did not arrive with federation; it moved, from inside one process to
across six.

Space and workspace are not the fix, and it is worth being precise about why. Those two
answer *which of my lives is this about*. This is *whose decision is this*, which is a
different question with a different answer: two engineers on the same repo want the same
space, the same workspace, and different questions out of it.

So a question can name who it is for, as a `for:<handle>` label on the bead:

```sh
beadcause-ask -w acme -t 'Gross or net?' --for carol@example.com < brief.md
beadcause-ask -w acme -t 'Which of these two?' --for everyone      < brief.md
```

**The addressee is on the bead, in the shared graph, and it could not be anywhere
else.** Each Mac has to work out on its own that a question is not for the person
holding it, and the tracker is the only thing all six machines agree about. A label
also means `bd show` answers the question on any machine, with nothing beadcause-shaped
in the loop.

**It is stamped where the answer is actually known.** You will not normally type
`--for`: a question filed on this Mac is addressed to this Mac's person automatically —
by `beadcause-ask`, by a worker's [delivery card](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue),
by `beadcause-propose`, and by every question the daemon files itself. That is a write-time
decision rather than a read-time one because `created_by` cannot answer it. It is
`actor` — a *byline*, which since [bc-lx3k](#whose-beadcause-wrote-it--the-byline-on-every-daemon-write)
does name this Mac's person, and which is still the wrong thing to route on: it is bare
on every install that has not set `me`, bare on every bead filed before that, and a
field an agent can write whatever it likes into. The machine doing the asking is the
only thing that knows, and a label is how it says so.

**Set `me` on each machine, to that machine's person.** It takes one handle or a list,
for a person who answers to two addresses in the same graph:

```json
{ "me": ["carol@example.com", "carol@work.example"] }
```

**And with `me` unset — the default, and every install that has never heard of this —
none of the above happens at all.** No label is stamped, no bead is anybody else's, and
every question rings exactly as it did. That is not a default that happens to be quiet;
it is a branch that cannot be entered, because a machine that cannot say who it is has
no grounds to decide a question belongs to somebody else. It is deliberately not asked
by `npm run configure`: on a one-Mac install the honest answer is that there is nobody
to tell you apart from.

**Nothing is ever hidden, and nothing is dropped.** An addressed question is the third
answer `quietReasonFor` gives, beside `filtered` and `muted`, and it inherits their
contract exactly — the event fires, the card files, the badge counts, the inbox shows it
to everybody, and the *phone* stays dark. Every engineer can still read, answer and
close a question addressed to somebody else; the label decides who is rung, and nothing
more. A question that reached the wrong person is an annoyance. A question that reached
nobody is the failure this whole app exists to prevent, which is why routing that could
lose one would not be worth having.

Two consequences of that ordering worth knowing:

- **`addressed` outranks `filtered`.** A bead addressed to another engineer will not
  ring here however far you widen the filter, so reporting it as filtered would be a
  true sentence pointing at the wrong lever. The card says which: *Arrived quietly 3h
  ago · asked of carol@example.com*, where a filtered one names the filter.
- **Unlike the filter, it reaches the [foundation channel](agents.md#what-an-agent-is--and-how-it-asks-to-be-different).**
  The filter is exempted there because its two levels are both answers to "which of my
  lives is this about", and a constitutional request has no answer to that. It has a
  perfectly good answer to "whose agent is this", which is the question being asked
  here.

#### Handing it to somebody else, from the phone

Everything above happens at the moment a question is filed, from a terminal, and until
bc-jg0w that was the *only* moment: `--for` on `beadcause-ask`, the stamp
`bin/deliver.js` and `bin/propose.js` put on their own cards, `Bd.create` for anything
the daemon files. Which left the ordinary case unreachable. A question lands on your
phone, you read it, and it is really Carol's — and the only two moves were to answer it
yourself or to leave it sitting there. Neither of those is the true one, and an addressee
you cannot move is most of the way to not having one.

So the card carries a **📮 pill** in the same row as the workspace and the bead id,
saying who is being asked: *you*, or a name, or *anyone*. Tap it and a panel offers one
button per handle, plus **anyone who is free**, plus a box for somebody the graph has
not seen yet. One tap re-addresses the question, and the tap **replaces** rather than
adds — "it is really Carol's" means Carol, not Carol as well as you.

There is no roster anywhere in beadcause: the config knows who *this* Mac is and nothing
about the other five. So the buttons are read off the inbox itself, where every question
another Mac filed carries its person's `for:` label — which on an install where addressing
means anything is the roster, because everybody is asking questions. The typed field is
what covers the person who has not asked one yet.

**The pill is drawn only when `me` is set.** With it unset there is nobody a question
could be addressed away from, so a control for it would have exactly one state — the same
branch-that-cannot-be-entered guarantee the rest of this section makes, drawn here as an
absence rather than as a pill saying "for everyone" on every card.

**Handing a question away also clears its notification, on one condition.** If the
question is now addressed somewhere that is not this Mac, the row goes out of the phone's
shade. Narrowing the filter deliberately does *not* do this
([why](asking.md#and-it-does-not-tidy-up-the-noise-it-already-made)), and the difference is the
strength of the fact: a filter change is *I do not want to think about this right now*,
and a hand-off is *this is not mine*. Same
`dismissed` event, same honest limit (ntfy cannot recall a delivered message; the Android
shell's tray is what is actually reachable), same promise that the bead is untouched — it
stays open, stays unanswered, stays in everybody's inbox. Re-addressing a question to
*yourself*, or to everyone, leaves the shade alone, because those are the two answers
under which the phone is still being asked.

**And the other phone starts being asked.** That is not automatic and it is worth saying
why: each daemon marks every live question as notified at the end of every sweep, so
Carol's Mac swept this bead the day it was filed, kept quiet because it was addressed to
somebody else, and would never have looked at it again. The poller therefore treats one
narrow case as a fresh arrival — a question it recorded as quiet *for the addressee
reason* which is no longer addressed elsewhere — and pushes it once. A muted space and a
narrow filter are the other two kinds of quiet and neither is undone by a label.

`node test/readdress.mjs` covers the label arithmetic, the route, the shade, and that
half of the poller.

### Whose beadcause wrote it — the byline on every daemon write

The same `me`, answering a different question. `bd` records who made each write, and
beadcause told it `beadcause`: `cfg.actor` is that string, `Bd.run` appends it as
`--actor` to every single command, and `beadcause-ask`, `beadcause-propose` and
`beadcause-deliver` each exported it as `BEADS_ACTOR`. One Mac, one beadcause, a perfectly
good byline. **Six Macs, and it is the same string on all of them** — so `created_by` on
every bead and `author` on every comment says `beadcause`, the history ledger and every
comment thread agree, and nothing anywhere records which engineer did anything.

It cannot be recovered afterwards, either. `owner` comes from the git identity of the
workspace directory, which is the same for everyone working a shared checkout;
`updated_at` says when, not who. So the byline is written with the person in it:

```
created_by: beadcause (carol@example.com)
```

**The base comes first on purpose.** It still reads as beadcause at a glance and as a
*particular* beadcause on inspection, and it survives being truncated in a narrow list
as the thing it is rather than as a person. Suffix-first — `carol@example.com via
beadcause` — would have got that exactly backwards.

**With `me` unset it is the bare `beadcause` it always was**, and not as a default that
happens to match: there is no handle to put in the parenthesis, so the branch cannot be
entered. The token callers `test/attribution.mjs` exists to protect — the ntfy action
button, the Android app, `curl` — write byte-for-byte what they wrote before.

Three things this deliberately is not:

- **It is not authorisation, and it is not provenance.** `--actor` is a field an agent
  can write anything it likes into, so the byline is display only. What an agent filed
  is the `agent-filed` label, which is stamped by lib/filing.js and survives endorsement
  and revocation — see [the ledger behind the History tab](#the-ledger-behind-the-history-tab).
- **It does not change what a person's own writes say.** A signed-in browser still puts
  its own address on the bead, unwrapped, because that is a person speaking and not a
  daemon — see [whose answer it is](integrations.md#whose-answer-it-is).
- **It does not touch what an agent's own `bd comment` says.** That is the shell's
  `BEADS_ACTOR`, and bc-lx3k left it alone for two reasons: it is exactly what the reply
  detection below tells apart, and `[address]` on a comment meaning "an agent typed
  this" was a convention already being read. bc-y3qk.1 picked it up — see
  [whose agent wrote it](#whose-agent-wrote-it--the-byline-on-an-agents-own-bd) below.

**The one thing that had to not break is the reply test.** When you answer a question
from the phone, beadcause watches the thread and pushes the agent's answer back to you —
and it decided "is this an agent talking back?" by asking whether the comment's author
differed from `cfg.actor`. A byline that no longer equals `cfg.actor` would make the
daemon's own relayed comments read as agent replies and buzz your phone about its own
bookkeeping. So that comparison is `writtenByDaemon` now, which compares the *base*
rather than the string — and, as a consequence it could not have had before, recognises
the other five machines' bylines too, so a second engineer's tap on a shared thread stays
bookkeeping rather than arriving on your phone as an answer. `node test/byline.mjs` drives
the real poller over three comments that differ only in their author — this Mac's byline,
another Mac's, and an agent's — and asserts that exactly one of them rings.

### Whose agent wrote it — the byline on an agent's own `bd`

The section above is about writes *beadcause* makes. This is the other half, and on a
shared tracker it is the worse one. A worker, an advocate, the chat console and the two
headless runners are Claude sessions in a shell, and the `bd comment` one of them types
is not a beadcause write at all — it is a `bd` the agent spawned, signed by whatever
that shell exported as `BEADS_ACTOR`. On this Mac `~/.zshenv` derives that from `$PWD`
and it comes out as the engineer's own address, which is **character-for-character what
that engineer's own `bd comment`, typed by hand in a terminal, produces**. So a thread
could say which engineer and could not say whether it was them or something they
started — and those two readings differ in the only way that matters, because one is a
person's decision and the other is a machine's guess at one.

beadcause is the only party that can settle it, because it is the party that builds the
environment. So the byline is stamped where `BEADCAUSE_AGENT` is stamped:

```
author: agent (carol@example.com)
```

Same `me`, same handle, same base-first shape and the same reason for it. One switch
makes a Mac named for routing, for its daemon's writes and now for its agents' writes at
once, and with `me` unset it is the bare `agent` — still nobody's address, which is the
point even on one Mac.

**`agent`, and not `worker` or `advocate`.** The foundation id is right there and it is
tempting. But the two questions anyone asks of an author string are "is this a person"
and "is this one of ours", and both want *one* string; a base that changed with the
roster would be a base nothing could match on. Which agent it was is already recorded
where it is stable — `BEADCAUSE_AGENT` in the session's own environment, the
[session log](advocates.md#the-session-log-kept-in-the-repo), and the `agent-filed` label.

**It cannot be amended.** `env` on a foundation is a field an agent may ask for and Adam
may approve, and this is the one key that approval must not reach: an agent that could
set its own byline could put a comment on a shared thread in the engineer's name. So
`agentEnv` and `agentExports` (lib/foundation.js) emit it *after* the foundation's own
`env`, exactly as they do `BEADCAUSE_AGENT` — a later key in an object literal and a
later `export` in a shell are the same rule. The worker is the one agent where this is
not merely bookkeeping: its command is typed into an iTerm window, so what runs it is a
fresh login shell that has already set `BEADS_ACTOR` from `$PWD`, and only an export
emitted afterwards beats it.

**`writtenByDaemon` still says no to it**, which is the half that could have failed
silently and badly. The base is `agent`, which is neither `cfg.actor` nor `beadcause`,
so an agent's answer still reaches the phone — and note the trap that makes it worth a
test rather than a reading: `agent (carol@example.com)` shares its *handle* with this
Mac's own `beadcause (carol@example.com)`, so anything comparing handles rather than
bases would have concluded the daemon was talking to itself and gone quiet. `node
test/byline.mjs` drives the real poller over four threads now — this Mac's byline,
another Mac's, an agent signed the old way, and an agent signed the new way — and
asserts that exactly the two agents ring.

**One thing downstream had to move with it.** `bd update --claim` takes the assignee
straight off `BEADS_ACTOR` — measured against bd 1.2.1, and worth stating because
`--claim` is otherwise so close to the git identity that the two were assumed to be the
same thing. So every claim an agent makes now carries a byline into `shortActor`
(lib/work.js), which shortened an address at the first `@` and turned
`agent (carol@example.com)` into `agent (carol` on the work screen and the graph sheet.
It shortens inside the parenthesis now. The same was quietly true of anything a daemon
had claimed; nobody had looked, because until agents signed this way it was rare.

**What this deliberately does not change.** `bd` commands that already pass `--actor`
are untouched, and that is every write the daemon and the `beadcause-*` CLIs make: the
flag beats the environment, so `beadcause-ask`, `beadcause-file`, `beadcause-deliver`
and `beadcause-propose` go on filing as `beadcause (carol@example.com)` even when the
agent that ran them signs as `agent`. Nor does it touch a person: a signed-in browser
still writes its own address, unwrapped. And nothing already on the tracker is
rewritten — every agent comment written before this says an address, which is why
`writtenByDaemon` has to keep reading *that* as an agent too.

**And it deliberately stops at the terminal.** A [terminal](android.md#the-terminal--driving-a-session-from-the-phone)
is a `/bin/zsh -lc` with no foundation behind it, so it keeps whatever `~/.zshenv` gives
it — and that is the honest answer there rather than an omission: a terminal is a thing
*both* a person and an agent type into, so a byline stamped on the shell would be a
claim the shell cannot support. Everything with a foundation — the worker, the advocate,
the chat console, the session auditor and the JIRA ingester — is stamped, because there
the spawner does know.

## The management system — off by default, and turning it on is a record

Beadcause is growing a compliance layer: a control corpus, edges from a control to the
evidence that exercises it, gates that refuse work producing none, and the reads an
auditor asks for. None of that is on here, and none of it is on anywhere unless somebody
turned it on and said why.

That is not a courtesy. Most installs have no architecture checkout, no JIRA, no
requirements corpus and no interest in an attestation — sorrel, loremia and ehden are all
three of them — and a compliance layer that warns, throws or blocks work on those installs
makes the platform worse for every user who is not pursuing one. The compliance layer is a
feature of the platform, not a tax on it. So the shape is the one
[the requirements corpus](advocates.md#which-requirement-a-change-was-for--refsbeadcauserequirements)
already takes when the architecture checkout is not on disk: **absent configuration is an
answer, not a failure.** `loadCorpus` hands back `{}` and every caller degrades to knowing
no requirements; `management.state()` hands back off and every caller degrades to knowing
no controls. The feature is off, byte for byte, rather than broken.

### Nothing runs when it is off, and that is enforced by where the door is

`lib/management.js` exports one gate:

```js
const controls = await whenOn(async () => (await import('./controls.js')).build());
```

The loader is not called at all when the layer is off, so the module behind it is never
parsed, never constructed and never given the chance to throw on an install that has none
of what it needs. `null` is what an off install gets back, and `whenOn(fn, { fallback })`
is there for a caller that wants to name its own empty answer instead. A compliance route,
when there is one, is therefore a 200 with a null body rather than a 500 — the same
contract `/api/requirements` already keeps for `{corpus: null}`.

`node test/management.mjs` runs every read against a directory that has no ref, no state
file and no git repo in it, and asserts that not one of them so much as `git init`s the
config directory. Off has to cost nothing, and that includes costing no store.

### Why it is a commit and not a config key

Here is the tension the whole design turns on: **a gate that can be silently switched off
is not a control.** If the enforcement gates could be disabled by editing `config.json`, an
auditor asking "how do you know these operated for the whole observation window" would have
no answer — the key is one line in a file with no history, no author and no reason, and the
report built on it would be worth nothing.

So on is not a value read at startup. It is a **transition**, appended as a commit to
`refs/beadcause/management` in `~/.config/beadcause`, exactly as
[an approved amendment](agents.md#what-an-agent-is--and-how-it-asks-to-be-different) is a commit on
`refs/beadcause/foundations`. The on/off history *is* the evidence, in the same store, with
the same compare-and-swap, and readable months later by a person with git and no beadcause
running at all:

```sh
git -C ~/.config/beadcause log --format='%aI %s' refs/beadcause/management
git -C ~/.config/beadcause cat-file -p refs/beadcause/management:management.json
```

Two consequences fall out of that and both are deliberate. **Nothing in
`lib/management.js` reads the config** — `CONFIG_DIR` is a path and is the only thing taken
from that module — because the moment a settings file can influence the answer, the chain
stops recording what was true and starts recording what somebody last typed. The suite pins
it as a static read of the source. And **the daemon does not import the writers at all**:
the only thing that can flip this is a person at a terminal, which is the point of a switch
whose whole job is to be hard to flip quietly.

**A reason is mandatory in both directions.** An enable with no reason opens a window with
no scope statement — nobody months later can say what the layer was turned on *for* — and a
disable with no reason is precisely the silent gap the mechanism exists to prevent. What
you type becomes the commit message, which is what an auditor reads.

A redundant call writes nothing and says so. Enabling an install that is already on is not
a transition, and a record padded with non-events is one nobody can read.

### A disabled period is a period, not an absence

Off again, from on, is the transition an auditor actually reads. A window with an
unexplained gap in it is a finding; a window with a gap nobody recorded is a report that
cannot be relied on. So the record is read back as **periods** rather than as events:

```
$ beadcause-management windows
OFF  never → 2026-08-15 09:12Z  (default — never enabled)
ON   2026-08-15 09:12Z → 2026-09-02 14:40Z  Adam: SOC 2 Type II observation window opens
OFF  2026-09-02 14:40Z → 2026-09-02 18:05Z  Adam: the gate blocked the release and we needed the release
ON   2026-09-02 18:05Z → now  Adam: gate fixed, window resumes
```

The stretch before the layer was ever enabled is in there too, marked as the implicit one,
because "never enabled before this date" is a fact about the window somebody is looking at
and leaving it out would make the timeline start in the middle.

`beadcause-management coverage --from <iso> --to <iso>` is the question a Type II report is
built on, answered from the record rather than from anybody's memory: it hands back every
gap in that window with the reason recorded at the time and the person who recorded it, so
a finding arrives with its explanation already attached. `complete` is a boolean on purpose
— 99.4% of an observation window is not a passing grade, it is a finding with a number
beside it — and the command exits non-zero when there is a gap, so a scheduled check can be
one line.

`beadcause-management verify` is the integrity read. Every transition carries a dense `seq`
and sits in a commit whose parent is the one before, so removing a transition from the
middle means rewriting every commit after it and leaves a hole the check reports, and a
payload edited without the history shows up as a commit count that no longer matches the
transitions in it. **What it does not defend against is a truncation at the tip** by
somebody with write access to `~/.config/beadcause`: nothing outside that repo records its
head, which is the same honest limit the config repo's own history has — it answers "what
did this say before", not "was this altered". Anchoring the head somewhere an operator
cannot reach is real work and belongs with the enforcement gates, not here.

Note what this makes the enable/disable history: a control in its own right, alongside the
change management it governs — SOC 2 CC8.1 and ISO 27001 A.8.32.

### The commands

```
beadcause-management status                          is it on, since when, who said so
beadcause-management on  --reason "…" [--bead <id>]  turn it on, recorded
beadcause-management off --reason "…" [--bead <id>]  turn it off, recorded as a gap
beadcause-management history [<n>]                   the transitions, newest first
beadcause-management windows                         the same record as periods
beadcause-management coverage --from <iso> --to <iso>  was it on for the whole window
beadcause-management verify                          does the chain hold together
```

There is no config key and no HTTP route that writes any of this, and there is not meant
to be one.
