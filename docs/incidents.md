# Incidents and nonconformities

## An error the app hits files itself as a P0

Everything above is about work somebody decided to do. This is about the other kind:
the app breaks in front of you, a red toast says so, and then the fact is gone. Four
files had their own local `toast(msg, bad)` — `public/app.js`, `public/console.js`,
`public/foundations.js`, `public/term.js` — and nothing on either side caught an
uncaught exception or an unhandled rejection at all. You saw it on a phone, in a room,
once. By the time you were at the Mac you remembered that *something* went wrong on the
graph sheet and not what.

So an error reported to `POST /api/error` becomes tracker state. A **P0 bug**, endorsed,
labelled `app-error` — and the advocate then picks it up ahead of everything else with
no change of its own, because its queue was already sorted highest-priority-then-oldest.
Nothing new had to be taught how to care.

**Filing is the easy half. Not filing the same thing forty times is the hard half.** One
broken selector on a view that re-renders on every poll is not forty bugs, and a tracker
that says it is has been made useless by the feature meant to help it. So every report
is fingerprinted twice, in a deliberate order:

1. **The source `file:line`** — the primary key, because it is the most specific thing a
   report carries. Two different bugs on one line are vanishingly rarer than two
   different lines with the same generic message; there are a great many ways to say
   "Failed to fetch".
2. **The message text** — the backup, and it exists for one case: an unrelated edit
   above the throw site moves the line. Without it, the same bug files a fresh P0 every
   time somebody adds an import.

Both go on the bead as labels, hashed — a bd label has no quoting story and a message
can contain anything at all, and a stack-frame path is long enough to make `bd show`
unreadable. The readable form is written into the description, where a person can see
what a later report will be matched *on*. The lookup is one `bd list --all --label-any`
per report: an OR over both keys in a single call, because this runs on the hot path of
a page that may be reporting several times a second.

Four outcomes, and the last two are where the arguments are:

| The fingerprint matches | What happens |
|---|---|
| nothing | a new **P0 bug**, titled from the message, with everything the report carried |
| **an open bead** | a comment on it — occurrence number, timestamp, page. No second bead |
| **an open bead with a window running** | nothing is written at all. The report is counted, and the count becomes one comment when the window closes — see [below](#a-burst-is-one-comment-not-a-comment-each) |
| **a closed bead** | a **new** bead, with a `discovered-from` edge to the closed one |

That last row is a decision, not an oversight. A bug that comes back after being fixed
is a regression, and a regression that silently reopens the old bead loses the fact that
it was ever fixed — along with the commit that was supposed to have fixed it, and the
close reason somebody wrote. The edge is what carries "we have been here before" to
whoever picks it up, and a reopened bead cannot carry it.

**A bead matched on the message alone learns the new `file:line`.** The label is added
the moment the drift is noticed, so the next report hits the primary key directly and
the bead accumulates every line the bug has lived on — which turns out to be the fastest
way to see that a bug has been moving around a file for three weeks.

### A burst is one comment, not a comment each

One bead was only half of the bargain. The dedupe above stops a view whose render throws
filing forty beads, and then writes forty *comments* on the one it filed — which is the
same tracker ruined by the same loop, arriving a little more slowly. A page reporting ten
times a second is ten `bd` writes a second against an embedded single-writer Dolt that
about eight worker sessions are also writing to, so the cost is not only that the bead
becomes unreadable: it is a lock, held over and over, in front of everybody else's work.

So the **second** occurrence comments — that is the useful one, the moment an error stops
being a one-off — and opens a **coalescing window** on that fingerprint. Every report
inside the window is counted and nothing is written. When the window closes, one comment
says how many there were and between when:

> **48 more occurrences** — between 2026-08-11T12:00:02.000Z and 2026-08-11T12:00:49.000Z,
> on https://mac.tail1234.ts.net:4318/#bc-p38c from `app.js:3315`.

**The count is checked before the lookup, not after it.** `bd list` takes the same
single-writer lock `bd comment` does, so a window that skipped only the write would still
be ten lock acquisitions a second. Inside a window a report costs the tracker nothing in
either direction — no read and no write — which is the half of this that matters to a
session that is not looking at the bead at all.

**And the window doubles every time it closes with something in it**, up to an hour. A
fixed minute would have been 1,440 comments a day for a page that has been looping since
yesterday — the unreadable bead again, by a slower route. Doubling makes a ten-second
burst cost one extra comment and a two-day loop cost about a dozen. A window that closes
**empty** is dropped instead, so an error that happens twice a week is never made to wait
an hour for its comment: it always gets one of its own, immediately.

Two things it deliberately does not do. It does not survive a restart — the counts are in
memory, and a deploy loses a pending summary line rather than delaying shutdown for a
`bd` write that may not fit in the two seconds shutdown has. And it does not fire the
`created` event that a new bead fires, which is why both callers now ask `isNewBead(action)`
rather than `action !== 'commented'`: a coalesced report is the loudest thing that is not
news, and waking every parked poller ten times a second is the storm this exists to stop.

This is the tracker-side floor, and it is the only one that holds for reports the page's
own ceiling cannot see — a phone on a stale cached bundle without the reporter, a second
tab hitting the same bug independently, the daemon's own uncaught errors, anything at all
that can POST to the endpoint.

### The reporter on the page, and the six beads it refuses to file

`public/report.js` is the caller. One file, loaded ahead of every other script on every
page, and it watches five things — four of which nothing was watching:

| It sees | Which was previously |
|---|---|
| `window.onerror` | nothing at all. A render that throws halfway leaves half a screen and says nothing on either side |
| `unhandledrejection` | nothing at all, and worse: silent even in a console, on a phone that has none |
| a **failed fetch** | what most errors here actually are — the daemon is on a tailnet address and the phone is on a train |
| any **`toast(msg, true)`** | a red bar for five seconds. If it was worth showing red, it is worth a bead |
| anything the **service worker** hit | nothing at all, and invisible from here by construction — see [the one part of the app the page cannot see](#the-one-part-of-the-app-the-page-cannot-see) |

The toast is the one that needed the four copies to grow a line each, and they grew the
same line: `if (bad === true) window.beadcause?.report?.toast?.(msg)`, **last** in the
function, after the DOM writes, guarded at every `?.` so a page whose reporter did not
load behaves exactly as it did the week before. The other three are wired in report.js
and nowhere else, which is the whole argument for one shared file over a fifth copy.

**It counts as well as watches, which is the one job it does that is not about failure.**
Wrapping `fetch` a second time to answer a second question would mean two shims around the
one function the whole app is built on, each transparent only for as long as the other
stays polite — so the number of requests in flight is published from here too, as
`window.beadcause.requests`, and the wrapper is otherwise unchanged in what it hands back.
`public/orbit.js` is the only subscriber; see [the orbiting
dot](inbox.md#the-dot-at-the-left-of-the-bar-is-an-orbit-while-a-view-is-loading) for what it draws
and for the two endpoints that deliberately do not count.

**It is additive, and that is a constraint rather than a nicety.** The toast still
appears, unchanged, whether or not a report can be sent — so nothing is awaited on a path
somebody is waiting on, every handler is wrapped whole in a `try`, and a report that
cannot be delivered is **dropped**. Not retried and not queued: replaying it the moment
the daemon is back is the same storm, delayed, and the failure being recorded is not worth
breaking the screen that was going to mention it anyway.

**Nothing from the URL goes with a report.** The pages authenticate with `?t=<token>`
where a document request would otherwise be bounced to sign-in — `scripts/shot.mjs` does
it on every agent screenshot — so `location.href` *is* a credential; that is bc-sqab,
where the token reached a transcript by being printed. So a report carries
`location.pathname` and the query and fragment are thrown away rather than filtered, and
every free-text field is swept for a `t=`/`token=`/`key=` shaped parameter on the way out
anyway. Two guards for one secret, because a stack frame from an inline handler carries
the document URL and nobody will be watching the day one appears. The token still travels
as the `x-beadcause-token` **header**, which is how the daemon knows the report is yours;
the body is the part that becomes a bead.

Then the refusals, and they are most of the file. Every one of these is a **P0 bead filed
on a page that was working perfectly**, which is the same way a tracker gets ruined as
filing one bug forty times:

| Not reported | Because |
|---|---|
| a fetch abandoned by a **navigation** | a tap on the tab bar rejects every request in flight. Without this, one "Failed to fetch" per open poll, every time you changed screens. `pagehide` closes the shutter — `pagehide` and not `unload`, which makes a page ineligible for the back/forward cache merely by being listened for |
| an **`AbortError`** | the long poll being torn down on purpose. Bookkeeping, not a failure |
| a **moment's** failure of the **long poll** | `/api/poll` — and `/api/console/poll`, the same park for a chat (bc-i9lhr) — is parked almost all of the time, so it is what every momentary loss of the connection lands on — a phone waking, a tailnet reconnecting, an extension that wraps `fetch` and drops one in passing. The app recovers on its own and the staleness banner says so meanwhile. A failure of a poll that has been failing for **half a minute** with nothing answering in between is still filed, because that one never came back — see below |
| a **4xx** | the daemon declining on purpose: a 409 close gate, a 403 for a feature switched off in the config, a 401 that means sign in again. `>= 500` is the line, because a 500 is the daemon failing rather than answering |
| a **5xx that says it is not the daemon** | three responses carry a header saying so, and `report.js` reads it before anything else: the router's swap-drain 503 (bc-xl7n.134), a repo view's generator 502 (bc-3wf1r), and the tracker-timeout 504 — a `bd` killed at its two-minute ceiling, or refused while its workspace sits out the last one (bc-v6024, filed twice when loremia's Dolt went unreadable under an answer). Each is a real failure of something other than this daemon, and each route that sends one already draws the reason on the screen it happened on; the answer card also says whether the write may have landed, because a `bd` stopped mid-write may have finished first |
| the report's **own request** | a report that reports the failure of reporting is a loop with no floor. `report.js` keeps the `fetch` the page was born with and sends on that, so its traffic cannot reach its own wrapper |
| the **echo** of a failure already reported | a failed fetch is reported here *and* toasted by the caller a moment later. One incident, one bead — and the same rule collapses "every endpoint is unreachable" onto one bead instead of twelve |
| a **refusal** | `toast(msg, 'refused')` is red because the app declined what you typed. "Give it a name" is not a bug, and it was a `toast(…, true)` before this existed |
| **anything, while a deploy is hushing the page** | a restart makes every screen fail every fetch at once, and all of it is the one fact that you pressed Ship. The daemon decides, because only it knows — see below |

**It is deliberately not in the service worker's shell, and the `CACHE` version does not
move for it.** That version exists to stop a phone holding one release's HTML beside
another's script — a page that draws a control with nothing behind it, or styles a block
that is not there, both of which look like a working screen. There is no such pairing
here: old HTML without the tag is a page that reports nothing, which is the app as it was
last week, and a new page whose reporter did not load is that same page. `report.js` is
network-first like `presence.js` and `mirror.js` before it, cached on the first online
visit by `fetchAndStore` in the same load that fetches the HTML asking for it. Nothing is
gained by putting a file that cannot work offline into the shell that exists for offline —
and the bump would have cost a merge against every other branch touching `public/`.

`'refused'` is the third state of a two-state argument, and it is worth knowing about
before you write the next red toast: `true` means *a failure*, and is filed; `'refused'`
is red and files nothing. `node test/reporter.mjs` fails the repo on a `toast('some fixed
message', true)`, because a fixed message is the shape of a validation notice and there
is no other way to tell one from a caught error at runtime.

**The long poll is the one refusal that times rather than decides**, and it is worth the
paragraph because it is the only place this file keeps state about anything but the
moment it is in.
`/api/poll` parks for twenty-five seconds at a time, continuously, for the whole life of
every open page — which makes it the one request in the app that is nearly always in
flight, and therefore the one that catches every blip in the connection whether or not
anything is wrong with the app. bc-y8wf is that bead: a single "Failed to fetch", never
repeated in the two days it stayed open, filed from a stack whose top two frames are a
browser extension's request interceptor. A P0, an advocate, and a window opened on it,
for a Wi-Fi handover.

Nothing is lost by staying quiet through a blip, and that is an argument rather than a
hope. `public/stream.js` retries on a backoff and `public/freshness.js` raises the
staleness banner, so the screen already says so to the person who can act on it — this
file staying silent changes what the *tracker* hears, not what the reader sees. And a poll
that stays broken is not silenced: a failure of one that has been failing for half a
minute with nothing answering in between is reported, which is the case the blips were
drowning out — a proxy that kills long connections, a daemon answering every short request
and no park. So a bead about the poll now carries a stronger claim than it used to: it had
been failing for half a minute, and nothing had answered on it in that time. The clock is
cleared by **any** response at all, whatever its status, because a 500 is the daemon
failing *and* proof the connection is there, and reachability is the only thing being
counted.

**What is counted is the span, not the number of failures**, and that is what makes the
claim survive contact with the page. One blip fails more than one request: on any page
carrying a *standby* mount, the ordinary mount's failure runs `arbitrate` in
`public/stream.js`'s `finally`, nothing is following by then, so every standby is started
on the spot and issues its own `/api/poll` into the same dead connection milliseconds
later. `public/index.html` is such a page — `public/panestage.js` mounts the standby the
panes ride — and it is the page bc-y8wf was filed from, so a rule counting occurrences
would have filed the very bead it exists to stop. Half a minute is a park (twenty-five
seconds) plus stream.js's first retry (five), the shortest stretch in which the poll has
had a turn, failed, waited, and had another. A standing failure older than three minutes
is forgotten rather than counted against, because a gap that long is a poll that was not
being made — a stood-down mount, a hidden tab — and the same reasoning clears the clock
outright on a `visibilitychange`. It is narrower than the pair the in-flight count ignores
— `/api/presence` is a short request on a timer, only ever caught by an outage a dozen
other requests are catching too, and the echo rule already folds those onto one bead.

**And a ceiling**: eight reports per page per minute, and the same error not twice inside
thirty seconds. A render loop that throws on every frame files a handful and stops. The
cap lives next to the reporting because it is eight lines and needs no clock of its own;
the other half of bc-p38c.3, the quiet window across a deploy, could not — see the next
section for where it went and why.

### The one part of the app the page cannot see

Everything above is a page watching itself, and `public/sw.js` is not on the page. A
service worker runs in its own global — its own `self.onerror`, no `window`, no
`localStorage`, and none of the twelve `<script>` tags that put a reporter on every
screen. So the piece of the app whose failures are hardest to notice was, until bc-u3g4,
the only piece with nothing watching it at all:

| What went wrong in there | What you saw |
|---|---|
| `caches.addAll(SHELL)` rejecting on install — **one** path in the list that 404s after a rename | nothing. The install fails whole, the shell is not cached at all, and the app is merely *slow*, for as long as that version of the worker lives |
| a `cache.put` rejecting on a phone with no room left | nothing, and it was an unhandled rejection inside a worker nobody was watching. The cache silently stops being maintained; the app works perfectly until the day you are offline |
| `caches.match` rejecting — storage evicted or gone bad under an installed app | a blank screen. The fetch handler's own fallback is what failed, so there was no answer and nowhere for the failure to go |

The first row is checked now rather than waited for: `node test/pagealias.mjs` resolves
every path in `SHELL` against `serveStatic`'s alias table and fails the repo if one of
them has nothing to serve it. That was the state every browser check's fixture was in
until bc-zjep — an install rejecting whole on every run, with the report as the only
symptom and nothing to place it against.

**The worker notices and the page sends**, and the split is the whole design rather than
an implementation detail. The obvious shape is a `fetch('/api/error')` from inside the
worker, and it is wrong twice over. The endpoint is behind the daemon token, which lives
in `localStorage` — which a worker does not have — so a direct post would work only where
Google sign-in is on and the session cookie happened to ride along, and would silently
401 everywhere else: **reporting that reports nothing is worse than no reporting, because
it reads as no errors.** And `report.js` is four hundred lines of judgement about what
*not* to file — the eight-per-minute cap, the thirty-second cooldown, the deploy quiet
window, the credential scrub, the shutter on `pagehide` — every line of which was a false
P0 filed on a page that was working. A second copy in the worker would have drifted from
the first the first time either changed.

So the worker `postMessage`s one line to whichever page is on screen, and `report.js`
turns it into a report like any other — kind `sw`, and every guard above still spent on
it. Three consequences worth knowing:

- **It cannot loop.** The relay is a message, not a request, and the report leaves the
  *page* as `POST /api/error`, which the fetch handler ignores twice over: not a `GET`,
  and inside `/api/`. There is no path by which the failure of a report re-enters the
  worker.
- **A failure with no page open is dropped, not queued** — the same argument the deploy
  window makes below. Every event the worker can raise is raised *because* a page asked
  for something, so the empty case is close to hypothetical.
- **Being offline is not a failure.** A rejected `fetch` in the handler is expected, and a
  hit out of the cache is what the cache is for; only the cache *itself* refusing is
  reported. Without that line this feature would file a bead every time the phone went
  into a tunnel.

**No `source` goes with a worker report, on purpose.** The daemon fingerprints by
source-and-line first (`lib/errors.js`), so a constant `/sw.js` with no line would make a
broken install, a full cache and a bad request all match each other and comment onto one
bead. The stack carries a real frame where the browser has one; where it does not, the
message alone is the honest key. `node test/swreport.mjs` holds that, along with both
halves of the wire — the real files in a `vm`, with a hand-made `self`/`caches`/`clients`
on one side and a hand-made `navigator.serviceWorker` on the other.

**And `startMessages()` is load-bearing.** A message posted to a page is queued until that
page's message channel is started; setting `onmessage` starts it implicitly and
`addEventListener` does not. Without the call the listener is registered, correct, and
never fires — which is exactly the failure this feature exists to end, wearing the costume
of one that works.

The `CACHE` version does not move for any of this, for the reason it did not move for
`report.js`: there is no mixed pair. A phone holding the old worker beside the new
`report.js` has a listener nothing talks to, and the new worker beside an old cached
`report.js` posts a message nothing hears — both are the app exactly as it was last week,
which is *older*, not broken.

### Nothing is filed across a deploy, and the daemon is what decides

Pressing Ship on a beadcause pull request SIGKILLs the daemon (lib/deploy.js). Every open
page then fails every fetch at once, from four screens, and without a quiet window each of
those is a P0 in front of the advocate — a dozen beads whose single cause is that you
pressed a button. They still appear on screen throughout: the toast is drawn before the
report is built and does not depend on it, because you should see the failure even when
the tracker should not hear about it.

**The storm is not where you would look for it.** Nothing is filed *during* the outage at
all — a page whose fetch just failed posts the report through the same dead socket, and
`report.js` drops what it cannot deliver rather than queueing it. What files is the
**reconnect**: the daemon is answering again, and the requests that failed a second ago
are only now being described to it. So the window that matters is a grace period *after*
the connection comes back, which is `REPORT_GRACE_MS` — thirty seconds, comfortably past
the last straggler (`stream.js` backs off before retrying, and `warm.js` prefetches four
other views on a page load) and short enough that a bug you hit while watching a deploy
land is still filed while you are looking at it.

**`reportingQuiet` in lib/deploy.js is the authority, and `POST /api/error` refuses on its
own account.** Only the deploy journal knows a restart happened, and putting the decision
on the daemon is what makes it hold for a phone still running last week's cached copy of
`report.js` — a client-side-only gate fails on exactly the device the storm arrives from.
Three states count as quiet, and the middle one is the one nobody guesses:

| The record says | Read as |
|---|---|
| a live status with a **live pid** | a deploy in flight. Quiet for one grace period, then asked again |
| **`deploying` with no runner** | the normal ending of a restart — launchd took the runner along with the daemon — so it reads as "just now". This is the storm |
| **settled** within the grace period | the pages are reconnecting into it |

Only a deploy that **`restarts`** beadcause. `fly deploy` for another repo takes nothing
down that a phone was talking to, and is no reason to stop hearing that this app is
broken. And a `deploying` record more than twenty minutes old counts for nothing, because
a runner that vanished before the sweep reached it would otherwise silence every report
this Mac ever makes — a false P0 is a bead you close, and silence is a bug nobody hears
about.

**The gate is on the route and deliberately not inside `intake`.** bc-p38c.4 files the
daemon's *own* uncaught exceptions through the same module, and a daemon that crashes
during its own deploy is the most valuable bead this app can file: it is the new build
failing to come up. That one has to get through.

**What the page does with the refusal.** The answer carries `quiet.until`, and
`report.js` then stops asking until then — so a reconnecting page does not spend its eight
per minute on requests that are dropped on arrival. Dropped, not queued: replaying them
the moment the daemon is back is the same storm a minute later. Two details worth knowing
before you touch it. The window is a *floor* — a deploy still in flight has no known end,
so a page is hushed for one grace period and comes back to ask, rather than being trusted
for the whole deploy. And the page will not accept a window more than ten minutes ahead
whatever it is told, because a wall clock arriving over a wire could otherwise produce the
worst failure available here: a page that has quietly stopped reporting anything, which
looks exactly like a page with no errors. `window.beadcause.report.quietUntil()` is the
second thing to check when a report has silently not arrived, after `capacity()`.

**No `CACHE` bump for it, for the same reason as before.** There is no mixed pair that
breaks: a phone running the old `report.js` against the new daemon is refused server-side
and merely posts a few reports that are dropped, and the new file against an older daemon
finds no `quiet` in the answer and behaves as it did. Neither draws a control with nothing
behind it, which is what that version exists to prevent.

### A swap is not a deploy, so the router leaves a marker of its own

Everything above reads the deploy journal, and the journal only knows about restarts
somebody pressed Ship on. The restart that happens most often on this Mac is not one of
those. `npm run swap` is what the ship skill runs, what you run by hand when the router
has poisoned a build — and `bin/router.js` does the same thing unasked, on its own, every
time `lib/` moves on disk. None of that writes a record anywhere, so `reportingQuiet` saw
nothing and the reconnect after a swap filed exactly the storm the last section exists to
stop: "GET /api/poll failed — HTTP 503" from four open screens, each one a P0 in front of
the advocate. That is bc-kttd, and it was filed by the agent that built the quiet window,
as the honest limit of what it could see.

So every handover writes one fact to `restart.json` in the config directory — when, which
build, which pid, and why — and `reportingQuiet` reads it when the journal has nothing to
say. Three decisions in that sentence are worth the paragraph they take:

**A file of its own, not a record in the journal.** A swap wearing a deploy record would
turn up in `listDeploys`, and from there on the release board, in the deploy history, and
— through `unannounced` — in a push to the phone announcing a deploy nobody asked for. The
journal is a list of things somebody pressed Ship on and it has to stay one. This is a
single fact that overwrites itself: the last time the port changed hands.

**Written at the handover, not at the spawn.** A backend that is merely slow to start is
spawned, health-checked, timed out and tried again while the old one goes on serving
perfectly — see [the router](operations.md#the-router--why-you-never-restart-it).
Marking those would hush a daemon that never moved, for as long as the retries went on,
which is precisely the window in which you most want to hear that the app is broken. Only
the moment `active` is reassigned is the service changing hands.

**No ceiling, because it expires by arithmetic.** The journal needs `ORPHAN_QUIET_MS`
because a `deploying` record that nothing sweeps would silence this Mac forever; a bare
timestamp cannot, so a marker nobody ever cleans up goes quiet on its own one grace period
later. A stamp *ahead* of now — a clock stepped back, a config directory copied off another
machine — is read as no restart at all, which is the same direction: a false P0 is a bead
you close, and silence is a bug nobody ever hears about.

It is written from `bin/router.js` by lazy import, never fatally, for the reason that file
gives about everything it depends on: a router that cannot write this is a router that
swaps and files a few beads, which is what it did before, and it is never a reason to fail
a swap. One gap left on purpose — `npm run start:bare` runs a backend with no router above
it, so it has no handover to mark. That is not the installed configuration, and a restart
of it is you at a keyboard rather than a deploy.

`node test/deployquiet.mjs` holds the rule, including a marker from the future and four
shapes of garbled one. The proof that a real router actually writes it is in
`scripts/test-swap.js`, after the explicit `--swap` — a marker written by hand can only
show what the rule does with one.

### And the trail the release board reads

The marker above answers one question — *was there a handover in the last thirty seconds* —
and it is shaped for exactly that: one fact that overwrites itself, expiring by arithmetic.
The [release queue](pull-requests.md#the-two-queues-and-where-a-bead-is-in-either) asks a different one:
*which* handover carried release 42, and when did each of its stages happen. That is a
question about a handover which is no longer the last one, so it needs a second file, and
`handovers.json` is it (lib/handover.js).

**One record per handover, carrying three moments**: the backend was spawned on its green
port, it answered its health check, and it was promoted. Those are the last three rungs of
the release ladder, and the router is the only process on this Mac that ever sees any of
them.

**Written once, after the fact, and that costs something worth naming.** Because the record
appears only when the swap has finished, the first two rungs are only ever drawn `done` —
a card can never show you a verification in progress. What it buys is that every record here
is a handover that actually happened. A record opened at the spawn would have to be closed
by something, and the two ways a swap ends without a handover — a build that is
[condemned](operations.md#the-router--why-you-never-restart-it), and one that is merely slow and is
retried on a widening window — are exactly the cases where nothing comes back to close it.
A rung reading "verifying" for a swap that died twenty minutes ago is the same over-claim
`untracked` was drawn to avoid. A failed swap has its own trail and it is a loud one: the
log, the 503 body, `npm run swap:status` and the console health line, all off one verdict.

**Which release it belongs to is the journal's question, not the router's.** `restartingDeploy`
in lib/deploy.js answers it, at the moment of the handover, and it is the same read the quiet
window makes: the newest record that restarts this daemon and has not been settled into
something that never ran. `unconfirmed` counts, and it has to — launchd takes the runner along
with the daemon, so by the time the new router is handing over, the record of the deploy that
caused it may already have been swept. `failed` and `lost` do not: nothing went live in
either. **Null is the ordinary answer**, and it is not a gap: a swap the router did because
`lib/` moved belongs to no deploy at all, and a release must not pick that up because it is
the only handover there is.

That read can over-claim in one window — an `unconfirmed` record from twenty minutes ago is
still the newest one when you run `npm run swap` by hand — so the reader takes the
**earliest** handover claiming a deploy, which is the real one. A window tight enough to
exclude the hand-run case would also be tight enough to miss a build step that took longer
than usual, and that failure is silent where this one is not.

**Churn, so no history.** The file is rewritten whole and holds the last twenty handovers, so
a commit per swap in the [config repo](agents.md#the-state-files-get-a-history-for-free) would be the
same twenty rows written twenty times over; it is ignored there, and lib/evidence.js records
it under `NOT_EVIDENCE` for the same reason. What shipped and whether it took is `deploys/`,
which is kept. Twenty is also deliberately shorter than the forty deploy records it points
into: a handover whose deploy has aged out of the journal is a row nobody can join to
anything.

`node test/handover.mjs` holds the reading rules — every garbled shape answering "no
handover", the earliest claim winning, a moment nobody recorded left out rather than given a
borrowed stamp — and `scripts/test-swap.js` is where a real router produces three real
timestamps in order, on a green port that is not the public one, attributed to no deploy,
with the deploy journal still empty afterwards.

### Why these are the one thing filed without the hold

Everything else an agent files arrives `unendorsed` and nothing may work it until you
say so, and everything else an agent files is clamped to P2 or worse — what an agent
*decided* was work may not outrank what you chose. Both are switched off here, in the
one place that says so (`ERROR_PRIORITY` in lib/errors.js).

The reason is that a reported error is not a judgement. No agent thought this might be
worth doing; a program failed, and the report is a fact about your Mac. Holding a P0
crash behind a tap you have not read yet defeats the entire point, which is that the
advocate is already on it by the time you look. The provenance stamps stay on — the bead
still carries `agent-filed`, so `bd list --label agent-filed` is still the whole audit —
and the note on the bead says in its own words why it arrived endorsed, rather than
blaming a space setting that was never consulted.

The honest cost: a broken build can file several P0s at once, and they are workable
immediately. `bd list --label app-error` is the list, and closing one is a tap.

### The race it has to survive, which is not the one you would guess

A page whose render throws reports, re-renders, and reports again — three requests in
flight before the first `bd create` has returned. bd's own single-writer retry does not
help at all here, because those three creates do not conflict with each other. They all
succeed, and you get three P0 beads for one bug: the exact failure this whole thing
exists to prevent, arriving through the door built to guard it.

So `intake` serialises per fingerprint, in-process. Two *different* errors still file
concurrently, and a report whose predecessor failed is still filed rather than
inheriting the rejection — one `bd` lock timeout must not silently swallow every later
occurrence of that error for as long as the daemon runs.

**Per fingerprint means one key each, waited on together — not one key for the pair.**
The lookup is an OR: `--label-any` asks for both labels and `pickMatch` takes a row
carrying *either*. The chain key was an AND (`workspace::atLabel::msgLabel`), and the two
disagree for exactly the reports that share one fingerprint and not the other. Two
reports from one throw site with different messages got different chain keys, never
queued behind each other, and both ran the lookup before either `bd create` landed —
which is the failure the chain exists to prevent, reached by the one door it left open.
It is measured, not theoretical: bc-jjdar and bc-mwhkg were filed 27 milliseconds apart
for one root cause, and the advocate opened an unattended window on each. `intake` now
takes a key per fingerprint and waits on *all* of them, which also has to be both rather
than a primary with a fallback — a cross-origin `Script error.` has no source at all, so
`atLabel || msgLabel` would key it on its message while the report it matches keyed on
its source. The coalescing window is registered under both keys for the same reason, so
a report matching on either one is counted rather than commented.

**The endpoint never answers 5xx.** It is called *by* error handling: a 500 here is
itself an error, the page reports the failure of its own reporting, and the loop has no
floor. A tracker that is down answers `200 {ok: false, reason}` instead, which a
reporter can log and stop on.

### And the daemon reports itself, through the same door

All of the above was about the *phone*. The daemon had nothing at all: nothing in `lib/`
or `scripts/` handled `uncaughtException` or `unhandledRejection`, so a thrown error in
the one process that runs unattended all night went to stderr, into whatever log launchd
happens to be keeping, and no further — and then launchd restarted it. That is the worst
available combination, because the failure is invisible *and* it looks like it healed.

So `lib/crash.js` installs those two handlers and calls `intake` directly. **In process,
with no HTTP round trip to its own port** — which is the whole reason `lib/errors.js`
knows nothing about requests. A crash cannot be relied on to be able to make an HTTP call
to a server it has just broken, and a loopback POST from a process that is about to exit
is a race with its own death.

**The fingerprint is the same shape on purpose, so a daemon crash and a browser error
that are genuinely the same bug land on the same bead.** Nothing had to be added for
that: `normalizeSource` already reduced `/Users/…/worktrees/x-1/lib/graph.js` and
`https://mac.tail1234.ts.net:4318/lib/graph.js?v=27` to the same `lib/graph.js`, because a
bug is not a different bug for having been noticed from a worktree. The daemon's report is
a `report`, exactly like the phone's, and that is the point.

**It does not stop being a crash.** Installing an `uncaughtException` listener takes over
from Node, whose default is to print the stack and exit 1 — and a daemon that swallowed
the exception instead would keep serving from a process whose invariants are, by
definition, unknown. That is a far larger decision than "file a bead about it", and it is
not this one. So the sequence is: print the stack exactly as before, file, exit 1. The
only change to the process's life is that it lives a few seconds longer than it used to
(`FILE_TIMEOUT_MS`, ten of them) and a bead exists afterwards. `unhandledRejection` gets
the same treatment, because since Node 15 *its* default is already an uncaught exception —
exiting is what preserving today's behaviour means, not a new severity.

Which graph it files onto is the one thing that is not obvious: **this checkout's own**,
resolved by `ownWorkspace`, not `workspaces[0]`. A beadcause bug belongs on the beadcause
graph, and the first configured workspace here is very often the one wired to a team's
JIRA.

#### The three edges, which are most of the work

**It must not file during shutdown.** SIGTERM closes servers, kills terminals and flushes
a git ref, and things in flight reject as they are torn down — every one of them a P0 bug
about a daemon doing exactly as it was told. The router SIGTERMs a backend on *every hot
swap*, which is to say on every deploy, so a handler that filed during shutdown would file
on every deploy. `beginShutdown()` is called by `shutdown()` before anything is closed, and
by the orphan guard, which exits by a path of its own.

**A failure while filing must not recurse**, and this is the acceptance criterion that
needed real care. Four guards, overlapping deliberately, because the failure mode is
unbounded rather than merely wrong:

| Guard | What it catches |
|---|---|
| the stack passes through `lib/crash.js`, `lib/errors.js` or `lib/filing.js` | the filer's own failure, which is the direct loop. Those modules are only ever on a stack when we are filing |
| one fingerprint is never filed twice at once | the same error coming back while we are filing it. Keyed, not a global flag — two different sweeps failing in one tick is an ordinary Tuesday, and a global flag would have thrown the second one away |
| `PER_ERROR_CAP` — five per distinct error, per process | a sweep that fails on every tick. There is no coalescing window on occurrence comments yet (bc-5f9b), and a day of that is 2,880 identical comments |
| `PROCESS_CAP` — forty in total | a loop that manages to be a different error every time |

The two caps are what make a loop *impossible* rather than merely unlikely: they only
count up, so no arrangement of failures inside the filer can produce unbounded work. And
`reportCrash` never rejects — a rejected promise nobody awaited is an
`unhandledRejection`, which is the one input guaranteed to bring it straight back here.

**An observer files nothing.** `BEADCAUSE_OBSERVE` means every autonomous act is off, and
filing a P0 unbidden is an autonomous act — the same reason a second instance sends no
ntfy push, so the live daemon's output stays unambiguous. A *reported* error still files on
an observer, because a phone asking it to is not the observer acting on its own.

#### The failures it already noticed and swallowed

The poll cycle catches and logs six background failures — the poll itself, the deploy
sweep, the owed-close sweep, the advocate tick, the release sweep, and the per-question
reply push — and carries on. That is right, and it stays: none of them may be allowed to
stop the others. But it also means a `TypeError` in the advocate has been logged every
thirty seconds for a week with nobody reading it, and *that* is a bug that should be a bead.

So each of those six now also calls `reportSweepFailure`, and **the bar there is higher
than the crash path's**: only errors that are bugs by construction are filed. A sweep that
failed did not kill anything and may well work on the next tick, so `spawn gh ENOENT` or a
bd lock timeout stays a log line, while a `TypeError` or a `ReferenceError` — which cannot
be anything except code that is wrong — becomes a P0 naming the sweep it came from.
`SyntaxError` is deliberately *not* on the bug list: in a sweep it is nearly always
somebody else's output being parsed, and a real syntax error in this repo would stop the
module loading rather than surface in a tick.

#### And the router, which was the crash that mattered most

All of the above was the *backend*, and the backend is the survivable half. A backend that
dies is replaced by the router inside a few seconds and the phone never notices. The
process holding port 4318 is `bin/router.js`, it is the one launchd runs, it is the one
carrying the certificate — and when it dies the whole service is gone until launchd
notices. So the crash least worth a bead had one and the crash most worth a bead had none.
It has one now (bc-ega4), through exactly the same `lib/crash.js`: same handlers, same
fingerprint, same graph, so a bug that kills the router and a bug that kills a backend land
on the same bead if they are the same bug.

Two things had to be decided differently there, and both are about the port.

**It arms itself *after* `listen()`, by dynamic import.** The rule `bin/router.js` lives by
is that nothing in the app can stop it binding — every `import` at the top of that file is a
leaf, which is what makes a syntax error in `lib/server.js` cost you a swap rather than the
port. A static `import` of `lib/crash.js` would have quietly spent that: it reaches
`lib/errors.js`, `lib/filing.js`, `lib/proposal.js` and `lib/endorse.js`, and `ownWorkspace`
lives in `lib/deploy.js`, which reaches `lib/session.js` and through it most of the roster,
the foundations and the tracker — a third of the app, evaluated before the port is bound.
Loading it after the socket is bound inverts the failure: the worst case is a router
that serves normally and says in its log that its crashes are only log lines, which is
precisely what it did before any of this. `notifyCertificate` loads `lib/notify.js` the same
way for the same reason. The arming says which graph it chose, in one line, because the
alternative is silence in both directions:

```
[router] own crashes file on beadcause, with 5000ms to do it
```

**And it gives filing five seconds rather than ten.** `FILE_TIMEOUT_MS` bounds a dying
backend, which costs nothing at all — the router is what the phone is talking to either
way. Here the process being held open is the one launchd restarts. That is *not* an
outage: an `uncaughtException` does not close a server, so 4318 stays bound and proxying
for the whole window — which is exactly the argument against being generous with it, since
what is answering is a router whose invariants have just been shown to be wrong. Five and
not one, though: a `bd create` that hits a lock retry takes a couple of seconds, and this
is the crash it would be worst to lose the bead for.

The one thing the router does not get is the event bus — that belongs to the backend, in
another process — so a bead filed here reaches a parked phone on its next poll rather than
immediately. The router is on its way out at that point and the poll is about to be
reconnected regardless.

### Checking it

`node test/apperrors.mjs` covers the three outcomes against a stub `bd` that implements
`--label-any`, `--all` and the status filter the way bd implements them — a stub that
returned everything whatever it was asked would pass whatever the code did. It asserts
the acceptance criteria directly (twice → one bead and one comment; a moved line → still
one bead, matched on the message; a closed match → a second bead carrying the edge), the
argv the lookup is actually made with, and the three-at-once race.

Its own fixture is worth a sentence, because it was wrong first: one JSON file for the
whole tracker made `bd create` a read-modify-write race *between processes*, so two
distinct errors came back holding the same id — which reads exactly like the
serialisation bug the test exists to disprove. It is one file per bead now, and the id
is claimed with an exclusive create.

`node test/reporter.mjs` is the browser half, and it runs the real `public/report.js` in a
`vm` with a hand-made `window` — the same shape as test/dictate.mjs and test/queue.mjs, so
a rewrite of the logic as a test-only copy cannot pass it while the phone ships something
else. It asserts the acceptance criteria directly (an exception, a rejection and a failed
fetch each reaching the endpoint; the toast surviving a transport that throws rather than
rejects; no token in the body), then one check per refusal in the table above, then two
static reads the stub cannot see: that **every** `public/*.html` loads the file ahead of
its other scripts, and that each of the four `toast` functions reports *after* it has
drawn. Neither of those is something the app would tell you about — a page that quietly
stopped loading the reporter looks exactly like a page with no errors.

`node test/deployquiet.mjs` is the deploy window, in the three layers it has to be right
in at once. The rule, against hand-written journal records — including a `deploying`
record whose runner is gone, which is what a restart looks like from the process that came
back and is the state the whole feature is for. Then the acceptance criterion through the
real route with a stub tracker behind it: sixteen reports, four pages by four endpoints,
and `bd create` asserted to have been **unreached** rather than merely unproductive — a
daemon that filed and then said it had not would be a passing test and a ruined tracker.
Then the page, in a `vm`, handed *the real body the real route answered* rather than a
fixture: the payload between the two halves is a bare JSON object with no schema anywhere,
so a rename of `quiet.until` on either side would otherwise leave both halves green and
the phone reporting straight through the next deploy. The window it resumes after is made
short by **aging a real record** — a deploy that settled just before the grace period runs
out — so the resumption is the code's own arithmetic and not a number the suite invented.

`node test/crash.mjs` is the daemon half, over the same fixture. It fires the real
handlers the way Node fires them — `process.emit('uncaughtException', …)` — and takes the
exit as an injected function, because a suite cannot assert what a process filed on its way
out of a process that really exits. The four ways filing can fail are each a check of their
own (the tracker refusing the create, an error thrown *out of* `lib/errors.js`, the same
fingerprint arriving twice at once, and the same error arriving forever), and so is the
case the whole in-process design exists for: a daemon crash in `lib/graph.js:41` and a
browser report from the same line land on **one** bead, asserted rather than assumed.

Several of its checks read source rather than behaviour, which is worth knowing before one
fails on you. Observer mode is driven in a child process, because `OBSERVING` is read from
the environment once at module load and cannot be flipped in-process. The six swallowed
failures are asserted by grepping `lib/server.js` for their `sweepFailed('…')` labels — a
seventh added to the poll cycle without one will fail that check by name, which is the whole
intent: the list going stale silently is how "logged for a week with nobody reading it"
comes back. And the arming in `bin/beadcause.js` and `bin/router.js` is read the same way,
including the negative one that matters most: neither `lib/crash.js` nor `lib/deploy.js`
may appear in the router's *static* imports. That is the single line of bc-ega4 a later diff
could undo by accident — an editor's auto-import would do it — and the cost is not a failed
test, it is port 4318 held hostage to a syntax error somewhere in `lib/`.

`node test/routercrash.mjs` is the end-to-end half, and it has to be: what is being
asserted about the router is wiring, and no module in isolation can tell you whether a real
process armed anything. So it spawns a real `bin/router.js` against a scratch config and a
stubbed `bd`, and really crashes it — an uncaught exception becomes a P0 carrying the
stack, on this checkout's graph and not on the decoy sitting first in `workspaces`, and the
process still exits 1; then a second router is SIGTERMed and broken on the way down, and
files nothing, which is what stops every `launchctl kickstart` from filing a P0 about a
router doing as it was told. The crash comes from *outside* the program —
`test/helpers/crashon.cjs` is preloaded with `node --require` and throws on SIGUSR2 — so
that the one file this repo works hardest to keep free of seams did not have to grow one
for a test. Two things about it are worth knowing before changing it: the router's output
goes to a *file* and not a pipe, because writes to a pipe are asynchronous and
`process.exit()` drops them, so the last lines a dying process writes are the ones that
disappear; and the SIGTERM and the SIGUSR2 are sent **back to back, with nothing in
between**, because the shutdown they have to interrupt is over in milliseconds. Both of
those failed by going *quiet*, which reads as a broken exemption rather than as a test
that was mistimed.

**Why there is no gap between the two signals** (bc-1wf9). `shutdown` appears to give
itself 300ms before `process.exit(0)`, but that timer is `unref`ed: once the port is closed
and the backends are stopped there is nothing holding the loop open, and the router is gone
in a few milliseconds. The suite used to send the SIGTERM, wait up to 80ms for the
`shutting down — stopping backends` line, and only then send the SIGUSR2 — and under a
full-tree run on a loaded laptop that wait routinely lost the race. The crash then landed on
a router that had already gone, and what came back was the shutdown's own exit `0`, or a
bare `SIGUSR2` when it caught the process mid-teardown with that handler already restored
to its default. Retrying the same race three times did not make it likelier; the log said
"signalled before it was listening", which was the one thing it was not. Sent together
there is no gap to lose, and both orderings agree on which arrives first — the kernel
delivers the lower-numbered pending signal first, and libuv dispatches what it queued in
the order it was posted — so the suite asserts the ordering from the log afterwards rather
than trying to buy it with a sleep.

The other half of that is in the router itself, and it is not only a test fix:
`process.on('SIGTERM')` used to be registered on the **last line** of `bin/router.js`,
after the first bring-up. Until then node's default disposition answered a SIGTERM, so a
`launchctl kickstart -k` landing during startup killed the router where it stood — no
`shutdown`, backends orphaned to their own minute-long guard, the port dropped rather than
closed — and that window covered arming the crash handlers, fetching a certificate and the
whole first bring-up, which is seconds on a cold start and exactly the seconds a
restart-loop lands in. The handlers go on immediately after `listen()` now, which is the
earliest point at which `shutdown` has a socket to close; everything else it touches is
either empty (`active`, `retiring`) or optional (`crash`, still null until
`armCrashHandlers` finishes, which is what the `if (shuttingDown)` on that function's way
out has always been for).


### The severity, the clock, and the commitment it is measured against

Everything above is **detection**, and detection is the half most incident programmes
never finish: theirs is a document describing a process that runs when somebody remembers
to run it. Here the error files itself the moment it happens, so detection and recording
are one act and neither can be forgotten.

What that leaves missing is everything asked *after* "do you detect them". A daemon that
exited and a red toast on one phone were both `app-error`, which means either everything
is an emergency or nothing is. "We respond promptly" is not a control; "acknowledged
within fifteen minutes, resolved within four" is one — **but only if the number was
written down before the incident rather than after it**.

So every filed error now carries a severity, and the severity carries a commitment:

| | what it means | acknowledge | resolve |
|---|---|---|---|
| **sev1** | the daemon is not running — nothing works until it is back | 15 min | 4h |
| **sev2** | the daemon is up and a function of it has stopped working | 1h | 24h |
| **sev3** | one page or one action is broken for whoever is looking at it | 24h | 7d |
| **sev4** | the app caught it and said so; nothing was lost | 7d | 30d |

**The scale is closed, and an id nobody minted is a refusal rather than a warning** — the
same rule the requirements corpus is built on, for the same reason: a severity scale you
can add to at the moment of the incident says whatever the person filing wanted it to say.

**It is decided by impact, not by how alarming the stack looked.** `lib/incident.js` reads
the `kind` the reporter gave, and the two reporters between them emit nine and no more.
`uncaughtException` and `unhandledRejection` are `sev1` and nothing else can be — those
arrive only from `installCrashHandlers`, which prints the stack and *then exits 1*, so by
the time the bead is written the daemon is going down. That is the one fact about impact
this system knows for certain. A failed `fetch` is `sev2` rather than `sev3`, which is the
least obvious one: the browser only reports it when the daemon did not answer, and from the
phone's side that is indistinguishable from the daemon being down. A kind nobody knows is
`sev3`, deliberately not `sev4` — a report we cannot classify is not thereby harmless, and
the cheaper mistake is the one that puts a middling bead on the board rather than the one
that quietly buries something on a thirty-day clock.

**The same bug forty times is worse than the same bug once**, so past ten occurrences the
severity goes up a level — and it can never reach `sev1`, because that one is a statement
that the process died and not a statement that something happened a lot. The label is
rewritten only when it would actually change: this is the hot path of a page in a render
loop, and a `bd` write per occurrence is the exact cost the [coalescing
window](#an-error-the-app-hits-files-itself-as-a-p0) exists to avoid.

**And then the clock, which is read and never written.** Nothing in `lib/incident.js`
stamps a timestamp of its own. `created_at` is when the error filed itself, `started_at` is
when a session claimed the bead, `closed_at` is when the merge queue closed it — three
timestamps bd was already keeping, written by people and agents doing their ordinary work
with no idea an auditor would ever read them. **That is exactly what makes them evidence.**
A log kept *for* the audit is a log somebody maintains, and a log somebody maintains is one
that gets maintained the week before the audit. The acknowledgement is `bd update --claim`,
which every worker session runs as its third line; nothing had to be added, and nothing can
be forgotten without the work itself not happening.

    beadcause-incidents -w beadcause                 the register, worst first
    beadcause-incidents -w beadcause --period 90d    what happened in the last 90 days

**Met, missed and pending are three answers, not two.** An incident ninety seconds old has
not missed a fifteen-minute commitment — it is inside its window — and a report that folded
"not yet" into "missed" would show a total breach every time it was run *during* an
incident. Only `false` is a breach.

The communication step is stated and measured, and **sends nothing**, which is deliberate
in both halves. The bead already *is* the notification here: a P0 lands on the inbox the
phone is polling. The interesting half is the one that does not exist yet — if the system
this is ever attested about has user entities under contract, they have to be told inside
whatever window that contract names, and which system that is has not been settled. A
commitment stated on the bead and measured is worth having now; a mail-out to a customer
list nobody has agreed on is not.

### The post-incident review, and the loop it closes

A `sev1` or `sev2` that has been resolved owes a review. Not a document and not a memory —
**a bead**, because the only thing worse than a review nobody wrote is a review whose
absence nobody can see.

    beadcause-incidents -w beadcause --reviews          which resolved incidents owe one
    beadcause-incidents -w beadcause --reviews --file   file the ones that are owed

It asks four questions and the last one is the only one that changes anything. What
happened, in order. Why — the cause, not the trigger, since the trigger is on the bead
already. What held and what did not. And then: **does the risk register move?** Either a
risk already in it now has a different likelihood or a different treatment, or this
incident was not covered by any risk in it and one is missing — say which, and name it. A
review whose output is "we fixed the bug" changed nothing; the bug was already fixed, which
is why the review is being written.

The review is filed **held**, unlike the incident it is about. A P0 crash behind a tap
defeats the point of filing it automatically; a review is work somebody has to sit down and
do, and queueing that unasked is how an advocate spends a night on a form. The record
exists either way, and the record is what the clock reads.

### The exercise, because a plan nobody has run is a document

Everything above is machinery, and machinery is not the thing that fails first. What fails
first is the hour nobody has ever spent asking what actually happens — and a response plan
that has never been run is an exception waiting to be written down by somebody else.

    beadcause-incidents -w beadcause --tabletop                the scenarios worth walking
    beadcause-incidents -w beadcause --tabletop night-exit --file --with "Adam" --when 2026-09-01

Three scenarios come with it, and each is chosen because it breaks a *different*
assumption this system quietly makes. **night-exit** — the daemon takes an
`uncaughtException` at 02:00 and launchd restarts it into the same fault four times, and
nobody is awake; it breaks the assumption that a P0 reaching the inbox is the same thing as
somebody being told. **silent-sweep** — a background sweep has been throwing for six days
and the daemon has carried on each time; it breaks the assumption that a degraded system
looks different from a working one. **no-fix-critical** — a critical advisory with no
published fix, seven days from its SLA; it breaks the assumption that every finding has a
remediation you can perform.

The exercise is a bead, filed **before** it happens so it can be scheduled and so its
absence is visible, with the date and the people on it. Four answers go on it afterwards,
and the fourth is what changed as a result — a bead, a revised commitment, a registered
risk. If nothing changed, that goes on it too, because "we ran an exercise and learned
nothing" is a finding of its own.

An exercise carries the `incident` label so the register stays one `bd` call, and is
**pulled out of the register** exactly as a review is. Neither is an incident, and counting
the paperwork about incidents as incidents would make a bad month look worse for having
been handled properly.

### Dependencies on the same clock

`npm audit` has been in the box the whole time. What it never had is a **deadline**, and
the deadline is the whole difference between "we scan our dependencies" and a control.

    beadcause-incidents -w beadcause --vulns          the scan, on a remediation clock
    beadcause-incidents -w beadcause --vulns --file   file what is new, close what is fixed

One vulnerable package is one bead: filed the first time a scan sees it, closed by the
first scan that no longer does, and the days between the two are the remediation time. The
SLA is by npm's own severity word — critical 7 days, high 30, moderate 90, low 180 — taken
as published rather than re-scored locally, because a local score is a judgement made on
the day by whoever was looking and it is not reproducible a year later. `info` is
deliberately absent from that table and gets **no bead at all**: an informational advisory
is not a finding, and a board full of beads nobody will ever action is how the ones that
matter stop being read.

**There is no state file of first-seen dates**, and that is the design rather than a
shortcut: an SLA measured against a file this repo writes is measured against a file this
repo can rewrite. Measured against a bead it is measured against something with a history,
that somebody had to close, in a graph nobody edits by hand. Same argument as the incident
clock, and the same three timestamps.

**The severity is read back off the bead rather than re-scanned**, which matters more than
it sounds: an advisory can be re-scored upstream after the bead is filed, and the deadline
that counts is the one that was in force when it was detected. Re-scoring a live finding
into a longer SLA is how a breach disappears.

Reconciliation closes as well as files, and the closing half is the one that is easy to
leave out. A register that only ever files grows for ever and evidences nothing — `closed_at`
is the entire measurement.

### Which criteria this answers, and for which system

    beadcause-incidents --criteria    the crosswalk, and the scope line above it

The scope line comes first, and it is the thing that makes the rest of the table honest.
Everything above measures **beadcause** — the daemon, its sweeps, its surfaces — and the
system a SOC 2 report here describes is the configured compliance subject's (see [The
subject is supplied, not compiled in](compliance.md#the-subject-is-supplied-not-compiled-in)),
which **carves beadcause out**. A daemon crash is not an incident in the described system.
Printed without that line, "CC7.2 — monitoring — `lib/errors.js`" reads as monitoring of
the audited system, and an auditor handed that reading has been misled by a report rather
than by anybody. The line names the config key rather than an organisation, because the
incident register is beadcause's whether or not any subject is configured.

So the described system's own CC7 is a gap, not a silence: `lib/gapassessment.js` requires
a row for each of CC7.1–CC7.5 in the subject's assessment, and the breach-notification
windows CC7.4 turns on are in that organisation's agreements with its user entities rather
than in this repo. Carved out of the description is still inside the audit — a subject
records the carve-out with a `bearsOn` naming CC8.1.

The ids are `lib/controls.js`'s and **neither `lib/incident.js` nor `lib/vulnscan.js`
imports it**. That is the same leaf discipline `lib/servicescope.js` keeps: a register that
pulls the corpus in stops loading in a release where the corpus is not there, so the ids
are literals in the module and are resolved against the corpus in the tests. Only the
SOC 2 ids appear, and the ISO 27001 and 42001 counterparts printed under each are the
corpus's own crosswalk read backwards — `A.5.26` names `SOC2.CC7.4`, so `satisfiedBy`
answers the three-framework question from one edge set. A second list here would be the
second corpus [the corpus](compliance.md#the-control-corpus--six-standards-in-one-closed-vocabulary) exists to
prevent.

CC7.1 is split and claimed once: the scanning half is `lib/vulnscan.js`, and the
configuration-baseline half, over a host estate this repo has never seen, is on the gap
assessment. Claiming a whole criterion from an `npm audit` wrapper is the shape of an
overstatement an auditor finds in an afternoon.


## The nonconformity, and why a refusal is not one — `beadcause-capa`

Everything above this line is **detection and correction**, and both are automatic: the
error files itself, the crash files itself, a severity and a commitment land on the bead
and the merge queue closes it when the fix ships. That is already further than most
programmes get. What it does not do is the part Clause 10.2 asks for *after* the bug is
fixed — why it happened, what was changed so it cannot happen again, and whether that
actually worked.

The third one is the whole reason this exists. **A corrective action whose effectiveness
nobody ever checked is the commonest finding there is**, and it is common because the
check has no natural moment: the bug is fixed, the bead is closed, everybody has moved on,
and thirty days later nothing reminds anyone. Here something does, and it is not a
reminder — it is a bead, and it **blocks the record from closing**. bd refuses a close
over an open blocker, so the tracker itself declines to call a corrective action finished
before somebody has looked at whether it worked. Nothing has to remember; the graph
refuses.

    beadcause-capa -w beadcause                  the register, what is wrong with it first
    beadcause-capa -w beadcause --sections       the five questions a record answers
    beadcause-capa -w beadcause --owed           incidents that breached and have no record
    beadcause-capa -w beadcause --raise bc-x --file --days 30
    beadcause-capa -w beadcause --checks         the checks, soonest due first
    beadcause-capa -w beadcause --refusals       what the gates refused — the control working

### The record is not the bug bead, and the code is what settles that

The obvious design is to grow these fields on the P0 the error path already files. It
cannot be that, and the reason is not taste. **The merge queue closes the bug bead when
the fix lands**, so a blocker on it turns every merge into an owed close with a P0 sitting
open on the board over a fix that has already shipped. The two records also have genuinely
different close conditions — the bug is resolved when the fix merges, the nonconformity is
closed when the action is *shown* to have worked — and one bead cannot carry two.

So a nonconformity is its own bead, raised *from* the bug and carrying a `raisedfrom:` edge
back to it, exactly as the post-incident review above is its own bead and for the same
reason: a record whose absence is invisible is a record that does not exist.

It answers five things, seeded with the question under each heading so that nobody has to
invent it, and **the third is the one that decides whether any of this was worth doing**.
What happened — which requirement was not met, not only the symptom, since the symptom is
on the bug. The correction — what stopped the bleeding, and what the failure had already
done that had to be undone. Then the root cause, which is the *evaluation* the clause asks
for and not the fix: what would have had to be different for this to be impossible, and is
that same cause sitting anywhere else in the system right now. Then the action — what
changed, naming the bead and the commit. And then effectiveness, which is answered
somewhere else.

An answer counts wherever it is written — the description, the notes, a comment — because
insisting on one of those produces records that are complete and read as empty, and the
later answer wins, since appending is how anybody actually corrects one. What does **not**
count is the seeded question itself: if that prose read as an answer, every record would be
complete the moment it was filed, and the whole thing would be a form.

### The check is dated, and `deferred` still blocks

The effectiveness check is a bead with the date in three places — in its title, in a
`due:<day>` label a list can sort by, and in its own first sentence. It is filed **held**,
like the post-incident review above and for the same reason — a check is work somebody has
to sit down and do, and queueing that unasked is how an advocate spends a night on a form —
and then **deferred until its day**, which is what makes the date real rather than
decorative: it is out of every queue until then and arrives on the date. A deferred bead is
not a closed one, and the close gate filters on *not closed* rather than on *open*, so it
goes on holding the door for the whole thirty days regardless.

It asks three narrow questions rather than one wide one. Has it recurred, and what did you
look at to say so. Is the change still in place — an action reverted in a merge nobody read
is an action that was never taken. And did it address the cause or the symptom: the root
cause named something, so is that thing now impossible, or merely less likely because one
instance of it was fixed? **"It did not work" is a real answer and the useful one**; an
ineffective action raises the next nonconformity rather than being quietly rewritten into a
success on the way to closing this one.

Because bd refuses the close, a record closed with its check still open can only have been
`--force`d. That is a decision somebody made rather than an accident, and the register
sorts it to the very top and calls it what it is, so the decision was at least made in the
open.

### A gate refusal is the control working, and it is not stored like a finding

This is the distinction that matters most here, and it is worth more than any field above.
The enforcement gates refuse work that does not conform — a session on a bead with no
impact assessment, a merge carrying no control claim, an egress to a host nobody
registered. **Every one of those refusals is the control operating correctly.** An auditor
who reads a pile of them as failures draws exactly the wrong conclusion, and unwinding that
costs far more than preventing it.

So they are not merely labelled differently — they are not the same kind of thing in
storage. A nonconformity is a bead. **A refusal is a comment on the bead it refused**, with
a parseable first line naming the gate and the control it enforced, and the refused bead
carries `gate-refused` so one `bd list` finds every bead a gate has ever stopped. Two
reasons that beats a second kind of bead. A gate that works refuses often, and a bead per
refusal is a board nobody reads — with the beads that matter stopping being read alongside
it. And a refusal is *about* a bead, which it already has: the work that was stopped, which
is where anybody hitting the refusal will actually look.

A row carrying both labels is a **throw**, not a guess, because the two available guesses
are "count the control working as a failure" and "stop counting a real finding". The period
report puts the two in separate fields with separate sentences, and the refusal count is
printed next to the words saying it is never a finding of any kind. There is no arrangement
of these two that quietly adds up to twelve failures this quarter.

### What is owed without anybody deciding

One source of a nonconformity needs no judgement at all: an incident that **missed a
commitment stated in advance**. The number was written down before the incident — that is
the entire argument for stating it — so a miss is a requirement not met, by construction.
`--owed` lists those, `--owed --file` raises them, and everything else is raised by hand
with `--raise`. That asymmetry is deliberate: automating the ones that need a decision
fills the register with records nobody believes, and a register nobody believes is worse
than a short one.
