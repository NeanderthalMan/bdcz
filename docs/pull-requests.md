# Pull requests and the endorsement queue

## Pull requests — review, merged, pushed, deployed, live

A delivery question asks *may I merge this?* and is gone the moment you answer it — and
most work never raises one, because [the worker merged it
itself](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue). Either way the
question that starts once the merge has happened had nowhere to be asked from a phone:
**it merged — did it reach origin, did anything deploy it, and is it running?** Those are
four different facts. They go true at four different times, and the gap between them is
where work sits for a week believing it has shipped. This is the only place that gap is
visible, which is what makes it the *more* important screen now that a worker lands its own
work: the merge stopped being a thing Adam does, and the deploy did not.

### The ladder, in one place

Where a pull request has got to is **one word**, decided by `stageOf` in `lib/prstage.js`
and nowhere else, and every screen reads it off the row:

| rung | what it means |
|---|---|
| **review** | open on GitHub, waiting on a decision |
| **merged** | merged at GitHub, and this Mac has not seen the merge commit on `origin` |
| **pushed** | on `origin`, and no deploy has carried it |
| **deployed** | a deploy *ran* that carried it — an `ok` record in the journey journal (`lib/deploy.js`) that started after the merge |
| **live** | it is in the build **this daemon is running** |
| *closed* | closed without merging. Off the ladder: not a rung on the way anywhere |

**deployed and live are two rungs on purpose.** They answer different questions and only
one of them is provable here. `deployed` is the deploy journal's answer, and for every repo
but this one it is the *only* answer available — sorrel goes out by `fly deploy` and nothing
on this Mac can then look at what is serving. `live` is ancestry against the commit this
process booted from, which only beadcause can claim about beadcause. Collapsing them would
mean either calling a `fly deploy` "live" — a claim nothing here can check — or calling a
merge that demonstrably is not running "deployed", which is the lie this whole screen exists
to prevent. Both are reachable in a real flow, and `test/prstage.mjs` asserts each rung is.

That ladder was three independent flags until bc-l8jp.6, computed in the board and about to
be computed a second time by the inbox. One function, six rungs, and the sort order
(`RANK`) generated from the same table, so the words and the order cannot move apart.

### Where you read it: an inbox card, and the board

**Pull requests are cards in the inbox** — [under their own filter, with a sub-filter over
the ladder](inbox.md#what-the-inbox-shows) — and the board, [the PRs chip on the advocates
page](navigating.md#the-board-is-a-pane-too), is where you act on one. Both draw the row from the same
renderer, `public/prcard.js`; there were two before that bead, and a fact added to one
screen was a fact missing from the other.

A row on the board folds open to what you can *do* — Queue to merge, Ship, Comment, and
**Full view**, which is a link into the inbox's own full-screen sheet for that pull request
rather than a second copy of it. The status sub-filter widens itself when that link names a
rung it is hiding (`revealPr` in `public/app.js`): the board's whole subject is what has
merged and not shipped, and the inbox's default is `unmerged`, so without that the link
would silently land on a list the row is not in.

```
#42  Turn the launcher's repo chips into tabs            2h ›
     beadcause  Pushed  bc-jin   +764 −20   5 files   ✓ 3
     ● Merged   ● Pushed   ○ Deployed   ○ Live
```

**The lamps are the evidence; the word is the conclusion.** They are on every row rather
than behind the fold, because "which of these has not shipped" is a question you answer by
scanning, and a fold would make it a question you answer by tapping twelve times. On the
board, tapping a row opens what you can do about it. In the inbox it opens
[full screen](#tapping-one-opens-it-full-screen).

**A delivery bead and its own pull request are one row here, not two.** bc-khoe.2 folded
`delivery` into the `pr` kind so both sat under the one pill, and that only fixed the
filter — the two were still drawn by two different renderers, from two different sweeps,
so a finished worker's card showed twice: once as the delivery card (the human sweep's
`beadpr` block, with **Merge** and **Decline**, which act on *the bead*) and once as this
row (the `gh` sweep, with the rung and the lamps, which act on *the pull request*). bc-khoe.18
folds them: `render()` in `public/app.js` matches a delivery to its board row by bead id —
`p.beads` is what `beadsFor` (`lib/beadref.js`) already verified against the tracker from the
same `bead:` line the delivery's own block carries — and leaves that row out of the list
once matched, so its number is not counted or drawn a second time. What survives of it is
`stageHtml` and `lampsHtml`, drawn on the delivery card itself (`deliveryBoardHtml`); the
diffstat and the checks stay the delivery card's own live fetch (`/api/pr`, `prStatsHtml`),
which is fresher than the 25-second sweep this row is drawn from.

### Tapping one opens it full screen

A merge decision is the one thing in this app that changes something outside this Mac and
cannot be taken back, and until bc-l8jp.7 the inbox's card could not make it: it carried a
link to GitHub and a link to the board, so the decision was made two screens away from the
row you were reading. Tapping a card now opens **the whole screen** — the same `.card.open`
sheet a question opens into, for the reason that one exists: expanded inline, the
description, the facts and the buttons all compete with the list around them, and a merge is
not a thing to press with half a screen of context.

It carries what a merge decision needs and nothing else:

- **the title, linking out to the pull request on GitHub** — the answer to "I need to see
  the diff" is a perfectly good answer and this is meant to make it rarer, not impossible;
- **the description**, as markdown, through the same sanitiser every other body in the app
  goes through — it is the only text on the screen that came from outside this Mac;
- **the branch and base, the bead, the authoring agent, and the datetimes** — opened, last
  touched, merged where there is one, and the merge commit;
- **Queue #N to merge**, **Close it** and **Comment on GitHub**;
- and, where GitHub reports a conflict, **Resolve conflicts** and **Cancel** in place of
  merge.

**The row is fetched twice, from two sources, and the view says which is which.** The lamps
and the rung are the board's, from the 25-second sweep — recomputing them here would be the
second implementation of the ladder that `lib/prstage.js` exists to prevent, and a view
whose lamps disagreed with the list it was opened from would be one screen contradicting
another about the one subject where that is the whole failure. The description, the
datetimes and the mergeability come from `gh` **at the moment the sheet opens**, because the
number that has to be right is the one you are looking at when you press merge. See `GET
/api/pr/detail`.

**Merge keeps its confirm and close keeps its reason box.** Two taps for the merge, with
the consequence written into the button between them — the same arming the board and the
delivery card use, and for the same reason: a `confirm()` on a phone is a system sheet you
dismiss by reflex. Close is a *mode* rather than an armed button, because the sentence in
the box is the only thing that will explain a closed pull request in six weeks and no
six-second timer survives typing one.

**Closing it moves no bead, deliberately.** `gh pr close` with your reason on the pull
request, the branch kept, and nothing written to the tracker. The act that puts work back in
the queue already exists and is better at it: *Decline* on a delivery card closes the PR
**and** reopens the work bead unclaimed with the direction to take instead, and it can,
because the bead it acts on is the one the worker named in its `beadpr` block. What this
screen has is `row.beads`, which was *matched* — from a branch name, a title, or a claim in
a body. Those tiers are right for drawing a link on a row and far too weak to reopen a bead
on, because reopening one is what puts an advocate's unattended session on it: a pull
request whose body said "fixes bc-x" would start a session in another repo at three in the
morning. So the two paths stay distinct, and the sheet says so where the reason box is.

#### A conflict is work, so it gets a session

GitHub refusing a merge for a conflict is the one refusal on this screen that is not a
decision. Nobody has to choose anything — somebody has to merge `main` into the branch and
re-run the tests — and the old outcome was `lib/pr.js`'s sentence ("the branch needs a
rebase before it can merge") on a card, with the next step yours to work out at the Mac.

**Resolve conflicts** opens an iTerm session on that branch, which is deliberately the same
act as *Request changes* on a delivery card: a note back to a session on the same branch,
where the only difference is who wrote the note — Adam's sentence about the code there,
GitHub's about the merge base here. The brief (`conflictPromptFor` in `lib/session.js`) pins
down six things, because an unattended session with a vague scope invents one:

1. **the branch is what is behind, not `main`** — read the other way round, "resolve the
   conflict" is a session merging a branch into main by hand, which is the one act nothing
   here may do;
2. **work in a worktree** — `git worktree list` first, because six sessions share these
   checkouts and the main one is the daemon's own;
3. **take that tree's lock, and read a refusal as an answer** — an occupied worktree looks
   exactly like an idle one otherwise, which is
   [its own section](#an-occupied-worktree-that-reads-as-idle) below;
4. **a tree already mid-merge is somebody else's** — stand down and say so, and do *not*
   run `git merge --abort`. That one is the second layer under the de-duplication below,
   for the two resolvers that are already up rather than the second one that must not be
   opened;
5. **push, and let the pull request's own checks be the gate** — a clean merge of two
   working branches is not a working tree, so the suite has to run over the merge, but the
   resolver does not have to be what runs it. The push starts the checks on the merge commit
   itself and `lib/mergeadvocate.js` will not merge over a red rollup, a pending one or a
   head commit nothing ran on at all (`bc-ysqd.1`), so an unverified push cannot land by
   being ignored — where sitting on the local gate instead means an hour behind `3 gates
   ahead of you` for the answer GitHub gives in a minute. The local gate is still named, for
   a workspace with no CI wired up: there it is the only one;
6. **release the lock, then stop** — the merge stays a tap here.

It is armed like merge, because it starts something unattended. It refuses unless GitHub
reports the pull request `CONFLICTING` *right now*, asked again at the moment of the press
rather than trusted from the row: a session opened for a conflict somebody has already
resolved is a window you have to go and close, and a pointless window is worse than a
sentence. Refused outright on an observer instance, for the reason `POST /api/session` is —
an unattended agent in a checkout it is only visiting.

#### The sweep a merge sets off

Everything above starts with a thumb. A merge into `main` is measured against every other
open branch in the same repo and asks none of them first, so one merge can leave five pull
requests conflicting at once — and until this existed the only thing that noticed was the
board, which draws a red chip whenever you next look at it, with the fix waiting on a tap
per pull request that you have to remember to go and make.

`sweepConflicts` in `lib/prsweep.js` is the trigger. Given a repo and the merge that just
landed in it, it lists the open pull requests, decides which of them conflict *now*, and
hands the ones that are ours to the queue above. **It merges nothing, ever** — the merge
into the base stays an act somebody initiates, from a card, from `beadcause-deliver` or
from github.com, and the most a sweep leaves behind is a branch pushed and mergeable
again.

Four things it will not touch, and the reasons are four different reasons:

- **Somebody else's pull request.** In a Northwind workspace forty repos share one tracker
  and other engineers have branches open in all of them; merging `main` into a teammate's
  branch and pushing it is not ours to do, whatever GitHub says about the merge base. The
  test is either half of *how beadcause knows a branch*: a bead the tracker confirms the
  pull request is [for](#which-bead-a-pull-request-is-for), or a session archived in
  `refs/beadcause/sessions/` that names this exact branch ([the session log, kept in the
  repo](advocates.md#the-session-log-kept-in-the-repo)). Either is
  enough and a pull request with neither is a human's — left alone, red chip and all,
  which is the correct outcome there rather than a failure. The second half is not
  decoration for the first: embedded Dolt is single-writer with twenty sessions sharing
  this laptop, and a lock collision makes the tracker answer *no beads* about a pull
  request a worker opened this morning. Git answers when `bd` cannot.
- **A draft.** A draft is a branch somebody is still writing, its worktree is very likely
  locked by the session that opened it, and a resolver sent into a locked tree stands down
  at step 2 of its own brief — a window opened in order to be closed. The next merge sweeps
  it again, by which time it is either ready for review or still nobody's business.
- **A pull request based somewhere else.** A merge into `main` says nothing about a branch
  stacked on `release-2`, and a resolver sent to it would merge the wrong base in.
- **Anything at all, on an observer instance or with `openSessions` off.** Both refusals
  come *before* the first read rather than after it, which is the opposite order to the
  button's — the button checks the pull request first so that "openSessions is disabled" is
  never the answer to a question about a conflict that is not there, and nobody asked a
  sweep anything. A sweep is the worse of the two to get wrong, not the better: the tap
  opens one window and somebody asked for it, and this can open two while nobody is
  watching.

**And nothing here reads `mergeable` off a row.** For a few seconds after any merge lands,
GitHub answers `UNKNOWN` about every other open pull request in the repo while it recomputes
the merge bases — so a sweep that read the board once and believed it would report a clean
board, reliably, every time, and look exactly like a feature that does not work. Every
candidate goes through `mergeability` in `lib/pr.js` instead, which polls to a bounded
deadline; `UNKNOWN` that never resolves is a third state and is **not** a conflict, so that
pull request is reported as unanswered and left alone rather than given a window on a guess.

Ownership is decided *before* mergeability, which is the opposite of how the work reads and
the right way round for what it costs: ownership is a `bd` lookup and one `git log`, while
mergeability is a network round trip that may sit out a thirty-second poll. A repo with
thirty teammate branches open would otherwise spend a quarter of an hour finding out about
pull requests it was never going to touch.

The sweep **never throws at its caller**. Every one of them is a merge that has already
succeeded, and turning a landed merge into an error because `gh` blinked would be the sweep
doing more damage than the conflicts it exists to clear — so a failure lands in the result
instead: `refused` for the two above, `error` for a sweep that could not run at all,
`trouble` for the pull requests it could not read, `failed` for the windows that would not
open. `node test/prsweep.mjs` stages the whole thing against a real repo with real session
archives and a `gh` that answers `UNKNOWN` once before it answers the truth.

**"Once" is decided by a marker file, and the reason is `atOnce` (bc-9d37.7).** That fake
`gh` used to count views in the same `prs.json` it read the rows from — load, add one,
write — and the sweep asks about candidates six at a time, so six of those processes were
doing it to one file at once. Both things that can go wrong did. A lost update moved #14's
window, so the pull request that is *meant* to answer `UNKNOWN` first and `CONFLICTING`
after sometimes answered `CONFLICTING` first, and a different check went red each time. And
a `JSON.parse` landed on a truncated file, which the sweep dutifully reported as `trouble` —
so the one visible difference between a green run and a red one was `1 could not be read` in
the suite's own progress line. It failed about one run in three under load, for two months,
and because `scripts/test.mjs` stops at the first failure it took the rest of the gate with
it. The counter is now one file per number created with `wx`, which is the same question put
to the filesystem, and the filesystem can answer it for six processes at once: exactly one
`open` wins and the rest get `EEXIST`. Nothing writes `prs.json` any more.

The tempting fix was to lower `atOnce` in the suite, and it would have gone green. Six in
flight is the thing being tested; a harness that cannot survive the concurrency the code
really runs at is a harness that has stopped testing it. The suite now asserts
`trouble.length === 0` outright, so the next time that line appears it accuses the fixture
rather than `lib/prsweep.js` — which is where twelve interleaved A/B runs on this bead had
already ruled it out.

#### Every way a merge lands sets it off

A sweep is only worth having if it happens whichever way the merge happened, and there are
three ways into `main` here:

- **the merge queue**, which is how most work lands — a worker files a merge-bead as its
  last act and the daemon merges it (`lib/mergequeue.js`), and both taps now send their
  pull request here rather than merging on the spot: the [PR board's **Queue to
  merge**](#the-three-buttons) since bc-02ldo, and the delivery card's own Merge tap
  since bc-xl7n.135;
- **a worker's own merge**, `beadcause-deliver` in a space with no queue in front of it;
- the **merge button on github.com**, from a phone browser or from somebody else, which
  nothing here performs and `reconcileLanded` notices afterwards.

A door that does not sweep is not a gap you would ever see; it is a feature that looks
broken exactly on the day you happened to merge that way. So all three call one function,
and none of them calls `sweepConflicts` where it stands. What they do instead is write down
that a merge landed, keyed by the repo it landed in — `lib/mergesweep.js` — and the
daemon's poll cycle sweeps it a few seconds later.

**The reason is where the resolvers are counted.** One resolver per pull request, two on
this Mac at once, and a queue for the rest are all guarantees held in the daemon's memory
(`lib/resolvers.js`). `beadcause-deliver` is a *different process*. It would open a second
window on the same branch, which is the incident that whole file exists to prevent — and
then exit, taking any queue it had built with it. The registry has to be one registry, and
only the daemon holds it.

Since bc-9d37.11 the *keys* of that registry outlive the process, so a restart no longer
starts from nothing — but that does not make a second process safe, and it is worth being
precise about why. What survives is enough to know a branch is taken; the iTerm handle is
not, and cannot be. A daemon reading those keys back can refuse to open a second window,
which is the guarantee that matters. It cannot nudge, cannot count toward another
process's cap, and cannot drain another process's queue.

Three things fall out of recording rather than sweeping, and each of them was wanted:

- **No merge waits for a window.** A tap on a card returns when the merge is done, not when
  a resolver has opened; the record is one small atomic file write.
- **A sweep that goes wrong cannot fail the merge that caused it.** Different tick,
  different stack, and the merge already happened.
- **Two merges into one repo cost one sweep**, because the records are keyed by repo and
  the higher pull request number wins — which is the number the resolver's brief should
  name anyway.

Records are **taken before they are acted on** and never retried. A sweep is a courtesy on
top of a merge that already succeeded, so a request that outlived a daemon restart, or one
that failed once, is dropped rather than re-run: the next merge into that repo asks GitHub
again, which is a better answer than a four-hour-old note about a base that has moved twice
since. `merge-sweeps.json` is ignored by the [config repo](agents.md#where-the-rest-lives-configbeadcause-is-a-git-repo)
for the same reason `restart.json` is — it is empty again within thirty seconds, and what it
recorded is on the pull request it merged.

The one door with a gate in front of it is github.com's, and the gate is the one the
[fast-forward](advocates.md#the-merge-that-happened-somewhere-else) already uses: the sweep is asked for only
when that tick actually *closed* something. Anything else is a `gh pr list` per repo per
interval — forty of them on a workspace like northwind — for a question whose answer is
nearly always "nothing conflicts". The blind spot is the same one and the same size: a pull
request merged by hand with no bead behind it is noticed by nothing, and the next merge that
is noticed sweeps past both.

#### A resolver the sweep opened is told so

That brief opens with *Adam pressed **Resolve conflicts** in beadcause*, which is true of
every window a thumb opened and false of every window a sweep does — and the sweep is
where most of them will come from once a merge landing triggers one. The wrongness is not
cosmetic. It is the **first line an unattended session reads**, and an agent handed a wrong
reason for its own existence reasons the rest out to match: if somebody pressed a button,
somebody is at the Mac waiting for an answer, and the six steps get read in that light
rather than as the whole of the job.

So `conflictPromptFor` takes `sweptAfter` — the number of the pull request whose merge set
the sweep off — and it changes exactly one paragraph, the one under the title:

> **Nobody pressed anything — a merge landed and this is the sweep.** #204 merged into
> `main`, so every branch still open behind it is now measured against a base it has never
> seen. GitHub says `bead/zz-work` is one of the ones that conflict with `main` as a result,
> so the pull request cannot merge as it stands — it carries zz-work.

Every other word is the same string: the six things above, the worktree lock below, and the
ending that says to stand down and leave the branch unmerged rather than pick a winner
between two load-bearing sides. That is the whole reason this is one parameter rather than a
second brief — two briefs drift, and the one that drifts is the one nobody ever presses a
button to read. `test/prfull.mjs` asserts that by exhaustion instead of by naming the parts
twice: it splits both briefs into paragraphs, and requires that exactly one of them differs
and that it is the second.

A sweep that cannot name the merge still gets the swept sentence, with *A pull request merged
into `main`* where the number would be. The obvious coercion would not have: `Number(true)`
is `1`, so a caller with nothing but "yes, a sweep" to say would have opened a session on
"#1 merged into main" — the same confident falsehood in a different sentence, and harder to
spot for being arithmetically true of something.

#### One press, one session — and what a second press does

On 2026-08-11 one press of that button produced **two** sessions. Both carried the same
brief, and the brief correctly says *if the branch is already checked out somewhere, use
that* — right for one resolver, wrong for two. They merged `main` into the same worktree at
the same time, and the damage was not the kind anybody notices in a log: one session's
`git merge --abort` landed between the other's resolution and its `git add && git commit`,
so commit `2183762` carried **unresolved conflict markers into `public/console.js`**, with
two parents and the shape of a perfectly ordinary merge commit. `test/dismissed.mjs` went
2/16. A human reading the diff is the only reason it was caught, and the repair had to
check that `main`'s side was genuinely still in the tree — an aborted merge can reset the
index and still commit, silently reverting everything the base added while looking clean.
That is bc-utyr.

So the daemon now remembers which session it opened for which pull request (`lib/resolvers.js`),
and a second press **does not open a second window**. It does the useful half of what the
press was asking for instead: it types one line into the window that already has the pull
request — the same channel [Reclaim](advocates.md#reclaiming-a-slot-by-asking) speaks to workers over —
saying the button was pressed again, that nothing new is coming, and that starting a second
merge in that tree is precisely what the press must not cause. The phone reads back
*"Already being resolved on `<branch>` — told that session you pressed again"*.

Three states, not two, and the third is the point:

- **nothing is on it** — open a window, and remember the handle;
- **something is on it and answers** — the nudge lands, and no second window;
- **something is on it and cannot be asked** — an iTerm too old to report a session id
  leaves a record with no handle, and *"I cannot ask"* is not *"it is gone"*. It is
  refused, with the age said out loud, and the record ages out by itself after half an
  hour rather than stranding the button for good. Same distinction `reclaim` keeps about a
  worker whose window macOS would not talk to, and for the same reason: treating a refusal
  as absence is what opens the second window.

**Everything for one pull request is serialised**, which is not belt-and-braces — it is the
actual shape of the incident. One press produced two requests a moment apart, and a
check-then-launch with an `await` in the middle is a check both of them pass. Under the
lock the second request arrives after the first has a handle to hand it.

**The keys are on disk; the handles are not** — and until bc-9d37.11 neither was. The old
rule was *in memory, never on disk*, on the reasoning that a record surviving a restart
"would only ever be a claim about a window nobody can address". Every clause of that is
still true; the conclusion assumed the thing asking again is **a press**, arriving hours
later with no memory of its own. The sweep is not. It runs because a merge landed, and a
merge landing is what kickstarts this daemon — so the restart happens *immediately before*
the caller asks, every time. On 2026-08-14 that was 475 boots against 19 sweeps, and PR
#243 was handed to `resolveFor` by eighteen consecutive sweeps over seven hours, thirteen
of which opened or queued a window for it. Thirteen resolvers, one branch, over a green
suite — because every assertion in it was about a single process.

So the keys survive and the handle does not, which is not a compromise: a record read back
after a restart is exactly the third state above — *something is on it and cannot be
asked*. The file already refuses to open a second window for that, and already lets go of
it after half an hour. The daemon says so at boot (`2 windows restored from the last
daemon`), the sweep logs those branches as `left #243 to the window already on it` rather
than as failures, and the card calls them **working**, because that is what they are.

The queue still lives only in memory, and that is now written down as a decision rather
than an omission: a waiting entry carries a closure that opens a window and a `recheck`
that asks GitHub, neither of which can be serialised — and the next sweep re-derives it
from GitHub anyway. A lost queue costs a delay; a lost registry costs a second window in
the same tree, which is bc-utyr. `node test/resolvers.mjs` asserts all of it — including
ten simultaneous presses producing one window and nine nudges, and six cases that call
`restart()` because nothing inside one process can see this.

**And that line said *Adam pressed Resolve conflicts again* whatever asked**, which is the
same falsehood the brief above carries a `sweptAfter` to avoid, arriving by the other door
— and a worse one, because the nudge is what a session is told *while it is mid-merge*.
Once a merge landing triggers a sweep, the common case is that one of the branches it finds
already has a resolver on it, from an earlier tap or from the previous merge's sweep. That
window was being told a person had pressed a button, so it read as somebody standing at the
Mac waiting for it to hurry up. `nudgeMessage` takes the same two facts the brief does now,
threaded through `resolveFor`, and says one of three things:

- **a second press** — unchanged, and still the default;
- **a sweep** — *Nobody pressed anything — #204 merged and beadcause swept the branches
  still open behind it, and #212 is one that no longer fits*, with the same `Number(true)`
  guard the brief has, so a sweep that cannot name the merge says *A pull request* rather
  than inventing `#1`;
- **an answer** — see below. That one is the only variant that does not end in *there is
  nothing new to do*, because it is the only one where there is.

The card's own sentence follows it: a row the sweep reused reads *told it the sweep found
this one again* rather than claiming a thumb.

#### Two windows at a time, and the rest in line

Everything above caps resolvers **per pull request**, and for as long as the only way to
open one was a tap that was the whole of the problem: a thumb presses one button at a
time, so five conflicting branches meant five deliberate presses spread over an
afternoon. A merge landing does not work that way. One merge into `main` can leave five
open pull requests measured against a base they have never seen, and the sweep that
reacts to it hands all five here in the same tick. Every lock in the section above is
*satisfied* by that — five different pull requests are five different keys — and what
comes out is five iTerm windows each running this repo's own gate, which is every suite
in `test/` and a good twelve minutes of node, simultaneously, on one laptop.

So there is a cap of **two live resolvers** — `advocates.maxResolvers`, and see the
section below for why that number is not the whole of it — and the ones that do not fit
**queue**
rather than being refused. Refusing would hand the work back to whoever asked, and the
sweep has nowhere to put it: it reacts to a merge that has already happened and does not
come round again until the next one. Two rather than one because the common case is a
merge that conflicts a *pair* of branches, and serialising those costs a whole gate run
of wall-clock for nothing. The phone is told the same thing the queue knows — *"#117 is
3rd in line — 2 resolvers are already running on this Mac, and a window opens for it as
soon as one of them is done"* — because a tap during a busy sweep has to read as a place
in a queue rather than as a dead button.

Two things make that a queue rather than a list:

- **A slot frees when a window closes, and that has to be learned.** Every question this
  file used to ask arrived with a sentence to deliver, so liveness came free with the
  nudge; nothing presses a button on a queued entry's behalf. The drain asks instead, and
  asks *silently* — `sessionAlive` runs the focus script in the mode that sets no bounds
  and raises nothing, so it reads whether the window is there without typing into it. A
  nudge per drain into an agent that is mid-merge would be worse than having no queue.
  It runs every twenty seconds while anything is waiting, and not at all when nothing is:
  a daemon nobody has swept on never asks. macOS refusing to answer **holds** the slot,
  and so does a record with no handle to ask through — the same rule the whole file is
  built on, arrived at from the other side. Freeing a slot on "I cannot tell" takes a
  window away from an agent in the middle of a merge, which is bc-utyr's damage again.
- **A queued pull request is asked about again before its window opens.** An hour can
  pass in the line, and everything that clears a conflict is *more* likely to have
  happened during that hour than before it: another resolver pushed, `main` moved again,
  Adam merged it from his phone. So the two refusals the press itself makes — open, and
  conflicting *right now* — are made again at the moment the window would open, and an
  entry whose conflict has gone is dropped with the reason rather than opened. A
  pointless window is worse than a sentence, and it is worse still an hour later when
  nobody remembers asking for it.

An entry nobody reached in four hours is dropped too, for the reason the record has a TTL:
past that, nothing here describes the present, and the next merge's sweep will ask GitHub,
which is a better source than a closure this daemon has been holding since breakfast. The
queue is in memory like the rest of the file, and more so — an entry carries the closure
that opens its window, and there is no way to write that down. `node test/resolverqueue.mjs`
asserts it: five handed over at once open two, the third opens only once one of the first
two is gone, and one whose conflict cleared while it waited is dropped instead.

#### And the Mac has one window budget, not two

For a while there were two caps on unattended windows here and **neither could see the
other**. `advocates.globalMaxWorkers` counted advocate workers across every repo; the
resolver cap counted resolvers; and a resolver is the same kind of thing as a worker — a
Claude Code session in an iTerm window running this repo's own gate for twelve minutes.
So a busy morning was legitimately twenty-two of them, the number that actually matters
to the laptop was the sum, and the sum was written down nowhere and enforced by nobody.
The way you found out was the fans. That is bc-29b3, and it was filed by the session that
added the resolver cap, at the moment it noticed the other one.

They are one budget now. `globalMaxWorkers` is **every unattended window this daemon
opens**, and `maxResolvers` is a sub-cap *inside* it rather than a second allowance
beside it — the most of the budget a sweep may take, because five gate runs at once is
its own problem whatever the total allows. Both halves yield, which is the part that took
the wiring:

- **An advocate's free slots subtract live resolvers.** `globalFree` is
  `globalMaxWorkers - workers - resolvers`, so two resolvers on a Mac capped at twenty
  leave eighteen coding windows and not twenty. When that is what stops a launch the
  card says so out loud — *"held by globalMaxWorkers (20) · 2 of them are sessions
  resolving pull requests"* — because the alternative is an advocate quoting a cap of 20
  over eighteen live sessions, and whoever goes looking for the missing two will not find
  them on any advocate's card. They are on the pull request board.
- **A sweep yields to a full Mac.** The queue that already existed for the resolver cap
  is the queue for this one: a conflict handed over while every window is spoken for
  waits in line rather than being opened or refused, and the sentence the phone reads
  back names *which* cap it is waiting on — *"#117 is 3rd in line — this Mac is at its
  20-window limit, 18 sessions and 2 resolvers are already open"* is a different fact
  about the wait from *"2 resolvers are already running"*, and they are cleared by
  different windows closing.

The direction of the wiring is the one thing to keep straight if you touch this.
`lib/advocate.js` imports the resolver registry to subtract it; the registry cannot
import back without a cycle, so it is handed a function by the daemon
(`accountAgainst`, one line in `lib/server.js` beside `createAdvocates`). A registry
nobody has told about the world outside it caps only what it can count, which is exactly
what it did before, and is why every test and every non-daemon consumer needs no fixture
for this. The console's global row adds them too — `20 of 20 sessions open across every
advocate · 2 resolving pull requests` — for the same reason the advocate's note does.

`node test/windowbudget.mjs` asserts all of it: the subtraction, the note, the yield in
both directions, and that a Mac nobody has described still caps resolvers at
`maxResolvers` on its own.

#### And a queue for that budget presses on it

Sharing the budget made a resolver *wait* for a full Mac. Nothing made the dispatcher
notice it waiting, and that turned out to be the whole of a second bug. Every window the
merge queue opens for itself — the resolver on a conflicting branch, the reviewer on a
delivered one, the worker answering what a reviewer said — goes through the same
registry, so a full Mac puts all three **in line**. The advocate's arithmetic subtracted
the resolvers that were *live* and read the line behind them nowhere at all. A slot freed
by a worker closing was handed straight back to a new bead; the drain that would have
taken it runs on a twenty-second timer, and lost the race almost every time.

It compounds, because the pipeline being starved is the one that *finishes* work. A merge
gives a worktree, a bead and a slot back. A dispatch costs all three. So the queue grew
and the dispatcher kept filling the gaps: on the day this was filed the line went from 8
to 25 over three hours and moved exactly once — when a window happened to close in a tick
the dispatcher had nothing ready for. Five delivered pull requests were waiting on a
worker at the same moment, one of them for seven hours. That is bc-xl7n.129.

**One window is kept back while anything is in line.** `globalFree` is
`globalMaxWorkers - workers - resolvers - reserved`, and `reserved` is 1 whenever the
queue has something in it — renewed every tick for as long as it is still owed, so the
queue takes the freed slot rather than racing a timer for it. One rather than the whole
line, because the drain opens entries one at a time and reserving twenty-five would empty
the Mac of workers for as long as anything waited. And **nothing at all when the line is
held by `maxResolvers` rather than by the Mac** — a queue that cannot take a worker's slot
would hold one open for ever, which is the same bug pointed the other way.

The card says so, for the reason it names the resolvers: *"held by globalMaxWorkers (4) ·
1 of them is a session resolving a pull request · 1 more is being kept for the 25 pull
requests in line for a window"*. Otherwise a cap of four over three live windows reads as
arithmetic that does not add up, and the fourth is not a window at all.

The reservation is subtracted in `lib/advocate.js` and **nowhere else** — `globals()` in
particular must not learn about it. That object is what the daemon hands the registry
through `accountAgainst`, so a reservation folded into its `live` would tell the queue the
Mac is fuller than it is and make it refuse the very window the reservation is holding
open. It would cancel itself, silently, while the card went on saying the slot was kept.

The wait is sayable now, too, which it was not: the queue's own line counts the windows it
opened for itself apart from the ones it asked for and could not get, and names them —
*"merge queue: 1 being reviewed · 5 in line for a window (#539, #626, #627 and 2 more)"*.
Before this, a door that queued and a door that opened returned the same `true`, so a pull
request whose window never went up was counted beside one whose had, and the only trace of
the wait anywhere was a count in the resolver's own log that named nothing.

`node test/windowbudget.mjs` covers the reservation, the release, and the bound that keeps
it from deadlocking; `node test/mergequeue.mjs` covers the reporting.

#### One card for the whole sweep, amended as the windows close

A sweep opens two windows and queues a third, and then says nothing for twenty minutes,
because at the moment it returns nothing has happened yet. The answer you actually want —
*is my board clean again, and if not, which one needs me?* — arrives later, one pull request
at a time, in windows nobody is watching. So a sweep that acted on anything files **one
`human` card** for the whole sweep (`lib/sweepcard.js`), naming every pull request it
touched and what became of each — or, when one of them is already on an open card,
[amends that card instead of filing beside it](#a-branch-that-keeps-conflicting-does-not-keep-filing-cards):

> - [#210](#) `worktree-poll-stream-rk2o1` — Park the inbox on /api/poll (bc-rk2o.1)
>   ✅ mergeable again
> - [#212](#) `worktree-history-filter-nib33` — Filter closed history (bc-nib3.3)
>   ⚠️ **handed back** — the session stopped and it still conflicts — *"both sides rewrote
>   `renderRow` and only you can say which wins"*
> - [#214](#) `worktree-wireframe-l5mw` — The wireframe page (bc-l5mw)
>   ⏳ a session is working on it

**A sweep that found nothing files nothing**, which is most of them: a merge whose repo's
other branches still fit conflicts nobody, and a card every time would be the inbox
reporting the weather. What the sweep *left alone* is left off too — a teammate's branch, a
draft, a pull request GitHub would not answer about are the board's ordinary contents, the
red chip is the right surface for them, and listing them would bury the one row that is
actually about you under twelve that are not.

**It is filed at the start and amended, not held until the last window closes.** That was
the open question on the bead, and the case for holding is real — a card that says *three
sessions are working* needs you to do nothing at all. Three things settled it the other way.
A held card is invisible exactly while it is interesting, since *two windows are open on
this right now* is a state that only exists during the twenty minutes. Held state is lost
state: everything a held card would be built from lives in the resolver registry, which is
in memory and forgotten by every restart, deliberately. And amending costs nothing at the
end, because **when the last pull request comes back mergeable and none was handed back, the
card closes itself** — so the inbox is clean without a tap, which is what this whole feature
promises, and an open card means either something is still running or something is waiting
on you.

**A state is never taken from the resolver's own account of itself.** It is read off the two
things that outlive an iTerm window: the [registry](#two-windows-at-a-time-and-the-rest-in-line),
which is exact for as long as a session is live, and then GitHub. A row the registry has let
go of is *resolved* if GitHub now calls the pull request mergeable and **handed back** if it
still calls it conflicting — which is the honest ending the brief offers a resolver, a
conflict where both sides are load-bearing and only you can say which wins. `UNKNOWN` is
neither, and is asked again next cycle rather than declared a hand-back: a card telling you
to decide something nobody has established is worse than a card that is a cycle late.

**The one thing GitHub cannot supply is *why*.** A branch that still conflicts is a fact; the
reason both sides mattered is only in the head of the session that gave up, and that session
reports into a window that closes when it stops. So the brief now tells a resolver stopping
without a mergeable branch to leave one line on the pull request beginning
`beadcause-resolver:`, and the card quotes it back beside the number. Comments from before
the sweep began are ignored — a reason from last week's conflict, quoted as this week's,
would be a falsehood with a timestamp to make it convincing — and a hand-back with no
sentence is still reported, as the fact with the reason missing, because a branch that
silently stopped being resolvable is the exact thing this exists to stop being invisible.

The follow-up runs in the poll cycle, in the same step that drains the merge records, and
**writes to the tracker only when something moved**: an amendment every two minutes saying
what it said last time would be a `bd` write and a woken phone for no news. A card whose
rows are all still running after four hours stops claiming so — the same window every other
part of this feature uses — and says *nothing here can say* rather than leaving an assertion
nothing can check. `node test/sweepcard.mjs` stages the bead's own acceptance: three
conflicting pull requests, one resolved, one handed back and one still running, producing
exactly one card that names all three.

#### A branch that keeps conflicting does not keep filing cards

The card above is filed per *sweep*, and a sweep runs per merge into the base. That is the
right shape for the case it was designed around — a merge conflicts a branch, a resolver
fixes it, the card closes itself — and the wrong shape for a branch that conflicts and
**stays** conflicting, because every subsequent merge conflicts it again and files another
card saying the same sentence about the same branch. Measured on one ordinary day: pull
request #243 was caught by **thirteen consecutive merges in seven hours** and filed thirteen
cards, eleven of them naming it and nothing else, which was two thirds of that day's
unsorted backlog. The amplification is per merge and it is independent of whether the cards
ever close, since a row whose resolver is still working keeps its card open by design.

So before filing, a sweep looks for an **open card that already names one of its pull
requests** and folds into that one instead. The rows are updated in place, the merge is
added to the card's list of them, and the title stops naming a merge as the cause and starts
counting the merges the branch has survived:

> **1 conflicting pull request in beadcause has survived 13 merges since #231**
>
> - [#243](#) `worktree-history-filter-nib33` — Filter closed history (bc-nib3.3)
>   ⚠️ **handed back** — the session stopped and it still conflicts
>
> **One card per conflicting branch, not one per merge.** … The 13 merges folded in here,
> oldest first: #231, #232, #233 …

That paragraph is on the card on purpose, because the fix is otherwise invisible from a
phone: what you see is a card that *did not appear*, and a card naming one merge while
reporting states learned five merges later would be quietly lying about its own age.

**The test is an overlap, not a subset**, which is the one part of this with a wrong answer
that looks right. *Fold when the open card's rows are a subset of this sweep's* is the
obvious rule and it re-splits on the first sweep that finds fewer: card `{243}` folds into
sweep `{243, 300}` and becomes `{243, 300}`; the next sweep is `{243}` again, which is not a
superset, so it files a second card about #243 and the whole thing is back. Overlap has no
such state — a pull request stays on the card that already names it, for as long as that
card is open, whatever else joins or leaves. A sweep that overlaps nothing still files its
own card, as before.

**The card is asked whether it is still open before anything is written to it**, and this is
the one place in the feature that treats a `bd` that will not answer as a *no*. The
[follow-up does the opposite](#one-card-for-the-whole-sweep-amended-as-the-windows-close) —
it holds a record over a tracker that blinked, because dropping it would kill the buttons on
a card still on your phone. Here a wrong answer loses the sweep's report entirely, since
amending a closed bead writes into something nothing will show you, so anything short of a
definite *open* files a new card. One duplicate card is the cheaper failure than a silent
one.

This is deliberately **not** the [duplicate check in `bd create`](android.md#and-the-same-check-runs-at-bd-create-whoever-filed-it),
and could not have been. That one declines outright on anything labelled `human` — an inbox
card is addressed to somebody, and two questions are two things to answer rather than one
thing filed twice — and it compares *titles*, which here differ by exactly the merge number
that is the problem. The duplication is not two cards that resemble each other; it is the
same branch reported again, and only the row set says so.

#### And the hand-back has a button that does something

The card above closed the loop at one end and left it open at the other. Its decision block
had exactly one option — **Noted**, which closes it — because every other choice a hand-back
raises lives on the pull request itself, and a button that pretended to pick a winner from a
phone would file a wish. So you read *both sides rewrote `renderRow` and only you can say
which wins*, typed which one wins into the box, and **nothing read it**. The next step was a
Mac, a branch, and *Resolve conflicts* — which opens a session with the ordinary brief,
knowing nothing about the decision you had just made.

A resolver hands back for exactly one reason, and it is a reason you can answer in a
sentence. So the card now carries **one option per branch that is waiting**, beside Noted:

> **Answer #212** — opens a session on `worktree-history-filter-nib33` carrying what you
> write — this card stays open

Tapping it writes `RESOLVE #212: ` into the box; what you type after that is the
instruction. **With exactly one branch waiting the tap is optional** — a bare sentence is
unambiguous then, and requiring a button would be ceremony. With two or more it is not
optional, because *take main's version* over three pull requests is an instruction to
nobody in particular, and guessing which one you meant is the single thing this must never
do. The card says which of the two it is, above the block.

**Those options do not close the card**, which is semantics rather than convenience: the
card amends itself as rows finish and closes itself when they all come back mergeable, so
an option that puts a row back to *working* is starting that loop again and a closed card
could not report the end of it. They take the `closes: false` path
[a commission](answering.md#a-question-you-have-already-answered-arriving-again) already uses — and the bare-sentence
path is decided the same way even though it names no option, because otherwise the answer
that starts the work would close the card that is about to report on it.

The act is `resolveSweepFor` in `lib/server.js`, beside the three other answers that write
something and in the same place in the handler: **before the close**, so a window macOS
refuses leaves the card answerable rather than closed over a promise nothing kept. It has to
be the daemon and can be nothing else — `resolveFor`'s registry, its cap of two and its
queue are module state in the daemon's own memory, so any other process starts from an
empty one and opens the second window this whole feature exists to prevent. Being
`resolveFor` also means the three answers come free: a pull request with no live resolver
gets a window whose brief carries your sentence, one that already has a resolver gets your
sentence typed into that window (the third variant of the nudge above), and one the Mac is
full for is queued and told its place.

What the window is told is one paragraph of the brief, in the same place `sweptAfter`
changes and quoted whole:

> **Adam answered the card about this one, and his answer is below.** #231 merged into
> `main` … Nothing has got it mergeable yet — what is different this time is that the
> decision it needs has been made, and it is this:
>
> > take main's `renderRow` and keep our tests
>
> **Take that as the decision on the conflict, not as a suggestion.**

Everything else is the same string, and `test/prfull.mjs` asserts that by exhaustion: an
answer is a decision about a conflict, not permission to skip the repo's gate or to merge
into the base. **The record outlives the hand-back now**, which it did not before — a row
nothing can move on its own used to end the follow-up, and the record is the only thing that
can say which repo and which branch an answer should open a window on. It is bounded by the
card rather than by a clock, since a card answered five hours later must not find its own
button dead: the follow-up asks `bd` whether the card is still open, and drops the record
the cycle after you tap Noted or dismiss it. `node test/sweepanswer.mjs` drives the whole
path through a real `POST /api/respond` — the card stays open, the refusals say which pull
request they are about, and every other question in the inbox is untouched.

#### A question the pull request answers by landing

The card above is bounded by you: a row waiting for your answer is one nothing else was
ever going to move, so the follow-up asked GitHub about the two live states and returned
every other row untouched. That is one word wrong, and the word is *nothing*. **A pull
request that is waiting on you can still be merged, closed, or rebased into fitting on
github.com**, by a hand that never saw the card — and when it is, the card is asking you to
pick a winner among branches that have already landed. There is no answer to type. Tapping
*Answer #n* would open a session on a branch that is gone; tapping *Noted* closes a card
that had stopped being about anything hours earlier. It could not close itself either,
because closing needs every row settled and that row was never asked about again.

It is not hypothetical and it is not rare. `bc-xl7n.30` sat in the inbox for **thirty-eight
hours** over `#243`, which merged in the first of them; a second card reached the identical
shape a day later, from a sweep filed that afternoon. The follow-up was alive throughout and
walked past both every thirty seconds.

So **a row waiting on you is asked about too**, and what it is asked is narrow — *has this
pull request ended* — with the four outcomes the live rows already have: merged, closed,
mergeable again, or still conflicting and still yours. A row that still conflicts comes back
exactly as it was, sentence and all, so `failed` and `unknown` stay the different sentences
they are and the resolver's own words are not re-derived every cycle. A row that ended stops
quoting that sentence, for the reason a stale queue note is dropped: *"both sides are
load-bearing"* beside ✅ **merged** reads as a fact about the merge. When the last waiting
row ends this way the card closes itself with the ordinary reason, which is the whole point
— the fix is what clears the inbox, rather than a hand.

**Only GitHub is asked, never the resolver registry**, which is the one trap in a change
this small. A registry entry outlives the session that made it by up to four hours, so a
resolver that handed a row back is often still in there; reading it would turn a settled
question back into *a session is working on it* and put the card straight back where it was.

Two clocks, because the two kinds of row stop for different reasons. A row that is still
*moving* is given up on at the four-hour window, as it always was — after that nothing in
the record describes the present. A row waiting on you is chased for as long as the card is
open, because the thing being watched for is a merge that can happen at any point in that
wait, and thirty-eight hours is eight windows of never asking. What bounds *that* is a
cadence rather than a deadline: **a quarter of an hour**, `WAITING_RECHECK_MS`, written into
the record as `askedAt` so a restart does not reset it. The arithmetic is the argument — the
poll cycle is thirty seconds and one card has carried seven waiting rows, so asking every
cycle is 840 `gh pr view`s an hour for a card that is doing nothing; at this cadence it is
28, and the worst a card can be is fifteen minutes stale, which is well inside how long it
takes to pick one up off a phone. The tap itself is unaffected: answering a card still asks
GitHub about that one row [before it opens
anything](#and-the-hand-back-has-a-button-that-does-something), so a fifteen-minute-old
card cannot open a window on a branch that landed ten minutes ago.

`node test/sweepcard.mjs` covers both ends: a row handed back and then merged behind the
system's back is merged rather than still waiting, its button disappears off the card, the
next cycle inside the window asks GitHub nothing at all, and a card thirty-eight hours old
— well past the follow-up window — is still asked about and closes itself when the answer
is that the branch has landed.

#### A card that outlives its record, and the card as its own backup

Everything above runs off `sweep-cards.json`: one record per open card, holding the repo, the
checkout, the base and every pull request with its branch. `followSweepCards` iterates *the
records* and nothing else, and `resolveSweepFor` reads the same record to learn which branch
an **Answer #n** should open a window on. So a card that has lost its record is not merely
behind — it is unreachable. Nothing visits it, so it can never be amended and can never
close; its buttons do nothing; and it sits in the inbox asserting, in its own body, that it
closes itself when the pull requests come back mergeable, which for that card is untrue and
always will be.

**This happened, to eight cards in one morning.** On 2026-08-14 thirteen sweep cards were
filed in beadcause between 02:42Z and 08:24Z and five records survived. The cause is not
subtle in hindsight and it is worth naming, because the shape of the mistake is general: the
end of `followSweepCards` used to run `keep(id, null)` — *drop the record* — whenever a card
was **finished with**, on the reasoning that a card nothing can move on its own has nothing
left to chase. [The hand-back button](#and-the-hand-back-has-a-button-that-does-something)
made that false, and the fix that made the drop conditional landed at 07:30Z. Every card
that reached that line before it — the eight — was orphaned on the cycle it printed
`is finished — 1 still needs you` in the daemon log, and every card that reached it after was
kept. The five survivors were not a race or a partial write; they were simply the cards
processed after the deploy.

**So the record now has a backup, and it is the card.** The card names the merge, the repo,
the base and every pull request with its branch, because it was written for a human to read —
and that is a whole record. Both shapes of it: a card that a branch's later merges have been
*folded* into (bc-xl7n.36) counts them in its title rather than naming one, and prints the
whole list in its body for the same human-readable reason — so it reads back with its merges
intact and is amended back into the folded title rather than reverting to *#244 left 1
conflicting pull request behind it*. The recovery also feeds the fold, which is the second
reason it matters: folding looks for an open card **in the records**, so an orphan cannot be
folded into and every later merge would file a fresh card beside it, forever. Every half hour (`RECOVER_EVERY_MS`, not a config key) the daemon
scans the inbox of each workspace that has a repo, and any open card whose title matches the
one `sweepCardTitle` writes and which has no record gets one rebuilt from its own body,
before the follow-up runs so it is chased on the same cycle. Nothing is written to the
tracker to do it. On a clock of its own rather than every cycle because it is a backstop for
something having gone wrong, it costs one `bd human list` per workspace, and a card that has
been orphaned for hours is not made worse by another half hour.

**What is not read back is the states.** Whatever the card says a row was, the missing record
is proof that nothing has checked it lately, and a row recovered straight into *handed back*
is a row [asked only whether its pull request has
ended](#a-question-the-pull-request-answers-by-landing) — so for as long as the branch went
on conflicting it would keep the state and the missing sentence it was read off a stale card
with, which is the orphan again with extra steps. So every
rebuilt row starts at `recovering` and GitHub decides, and until it has, **nothing is written
onto the card**: *we lost our own bookkeeping* is not news about a pull request, and it is
not worth waking a phone for. A GitHub that never answers is ended by the same four-hour
window as everything else here, which turns the row into *nothing here can say* — the honest
version of the same admission, and one you can act on. The refusal is strict for the same
reason: the title counts the rows and the body lists them, so a card whose body does not
produce exactly that many rows is not rebuilt at all, because half a record would close a
card on behalf of a pull request it never asked about.

One drop was removed as well as backstopped. A `bd close` that failed used to drop the
record — a card in the inbox saying everything is fine is a tap to dismiss rather than a lost
finding — but that is a card orphaned by one busy tracker, so it is now kept and retried next
cycle, exactly as a failed amendment already was. `node test/sweepcardorphan.mjs` covers both:
it asserts the premise (an orphan is invisible to the follow loop), rebuilds a record from a
real card body and closes the card by the ordinary loop with nothing done by hand.

#### An occupied worktree that reads as idle

The de-duplication above stops the *second window*, and it is worth being honest about what
it does not stop. The record is in memory, so a daemon restart forgets every session it
opened; and a window opened by hand — the ordinary case at this Mac — was never in the record
at all. In both, the next resolver arrives at a worktree somebody is already merging in, and
asks the only question available to it: *is anything happening here?*

Nothing in a worktree answered that. `git worktree list` shows an occupied tree and an idle
one identically, and so did the `SessionStart` hook that prints them
(`~/.claude/hooks/worktree-guard.sh`). The reason is narrower than it looks: `EnterWorktree`
locks the worktrees it **creates** — `locked claude session <name> (pid 82761 start …)` —
and only those. Measured on 2026-08-11: entering an existing worktree by path — which is
exactly what the brief asks of a resolver whose branch is already checked out somewhere —
locks nothing. So the tell that a tree was busy existed for every worktree except the ones
where two sessions could collide.
`ps aux | grep <path>` and `ListAgents` were the only answers, and the second one sees only
peers of the same harness.

So the brief now has the session say so in the tree itself, `git worktree lock .` with a
reason carrying this window's pid and the pull request number. Two properties do the work:

- **The lock refuses.** `git worktree lock` on an already-locked tree exits 128 and prints
  the existing reason — so the *attempt* is the occupancy check, with no gap between reading
  and taking for a second resolver to arrive in. Four answers, and they are four rather than
  two: it succeeds (yours, release it at the end); it names a pid `ps` still knows (somebody
  is in there — say which, and leave); it names a pid `ps` does not know (a session crashed
  — take it over, and say so, because standing down for a dead session is how a tree becomes
  permanently unusable); or it names *your own* pid, which is the lock the harness took when
  you created the tree, so carry on and leave it alone — it goes when the window does.
- **The pid is already understood.** The `SessionStart` hook resolves the pid in a lock
  reason against `ps` and prints a dead one as `STALE pid <n> — prunable`, which is what
  keeps a crashed resolver's lock from reading like a live one for ever. That convention
  predates this and is the reason the reason has that shape.

Finding your own pid is the awkward part, and the brief spells it out rather than leaving an
unattended session to work it out twice: `$$` is a shell that dies with the command that
printed it, so a lock taken in its name reads as stale within seconds, and the walk up the
process tree to the `claude` process has to be wrapped in `zsh -c '…'` — a worktree-isolated
session's own Bash calls refuse `$$`, `$PPID` and every shell loop as *"too complex to verify
that it stays inside the worktree"*. A brief that handed a session a command it will be
refused would have told it nothing at all.

What this deliberately does not fix. The daemon cannot take the lock on the session's behalf:
it knows neither the pid nor how long the window will outlive the launch call. A session that
dies without unlocking leaves a stale lock — which is the pid's whole job, not an oversight.
And `git worktree lock` is being repurposed from the removable-media case it is documented
for; the one real cost of that is `sweepWorktrees` in `lib/tidy.js`, which leaves a locked
worktree alone (`why: 'locked'`) — correct while a resolver is in there, and the reason
releasing the lock is a numbered step rather than a suggestion. That is bc-7uie.

`node test/prfull.mjs` covers the daemon's half: that the description comes from `gh` and
the rung from the board, that the attribution finds the session for *this* branch when a
bead was worked twice and says so plainly when it cannot, that a close writes to GitHub and
to nothing else, that a merged pull request refuses to be closed, and that the conflict path
refuses everything but a live conflict. It runs with `openSessions: false`, so nothing in it
can open a window — the brief is asserted off `conflictPromptFor` directly.
`node scripts/prfull-check.mjs` is the phone's half in headless Chrome.

**The card repaints in place, and takes neither the comment nor the selection in it.** A
pull request card is redrawn on its own several times while it is open: arming a button,
the timer six seconds later that disarms it, a request going out and its answer coming
back. `render()` would rebuild the whole list and take the keyboard with it, so
`paintPrCard` replaces the one card — which still replaces the textarea under the button
you pressed. The words come back because they live in `state.prDraft` rather than in the
DOM; where you were in them is carried across by hand, and **both ends of the selection
are carried, not just the near one**. A caret is the case where the two are equal, so
carrying only `selectionStart` handed every selection back as a caret at its left edge —
the sentence you had picked out to type over, gone the moment an arm timer expired
(bc-nh19; the same one-ended restore that was in the Mirror's composer as bc-c3ve and in
the session's say box). The direction rides along because it is the end the next
Shift-arrow extends from. The check drives it at the arming press, which is the repaint
nobody asked for.

**A lamp has three states, not two.** On, off, and *unknown* — a hollow, dashed ring:

- **Merged** — GitHub says so.
- **Pushed** — the merge commit is reachable from `origin/<base>` **as this Mac last
  fetched it**. The board re-fetches each checkout at most every two minutes, and
  only when something merged is waiting on the answer.
- **Deployed** — a deploy of this repo ran, and ended `ok`, after the merge. Read from the
  same journal the [release queue](#the-release-queue--the-number-over-ship) counts, so
  the two cannot disagree about what has been shipped.
- **Live** — the merge commit is in the build that is *running*. beadcause deploys
  by `launchctl kickstart`, a restart, so the code that is running is the code that
  was at `HEAD` when this process started and nothing after it. That commit is read
  **once, at import**, and never again: reading it lazily would report main's newest
  commit as deployed the moment another session merged something, which is exactly
  the lie this column exists to prevent. The page names the commit at its foot, so
  the word is never a claim you have to take on trust.

The third state is the one that matters. This Mac has never fetched that commit; this
repo has no deploy the daemon can see at all — only its own. An unknown drawn as
"off" would tell you work was not pushed when the truth is that nobody has looked,
and that is the one way this screen could actively mislead you. A repo the daemon
does not run says so in words on the row, rather than showing a dark lamp that means
something else everywhere else on the page.

#### One granularity down: which *file* somebody is already editing

The lock above answers "is anything happening in this tree". It cannot answer the question
a session actually has when it opens a file, because the collision it is worried about is
not in its tree at all: two sessions in two worktrees editing `lib/foo.js` never overwrite
each other — separate checkouts — they collide at **downmerge**, as a semantic conflict
nobody sees until the merge. With thirty live worktrees that is a daily cost, and nothing
warned either side.

So there is now a register of it, `lib/claims.js`, and its shape is lifted from
`lib/presence.js` — a TTL'd map, pruned as it is read, bounded field by field because a
report is a claim by a client rather than a fact. It is keyed by the **main checkout** and
the repo-relative path, never by the worktree copy: the whole point is that two trees
editing one logical file are one claim, and keying on the path each session actually wrote
to would make them two.

**The client is a hook, not a brief.** A register nothing writes to is shelfware, and a
brief that asks an agent to remember to claim its files will be forgotten by the third
turn. `scripts/claim-guard.sh` runs on `PreToolUse` for `Write|Edit`, exactly where
`~/.claude/hooks/worktree-guard.sh` runs, and the file path is in the tool call — so the
claim is taken at the moment of the edit with no agent cooperation at all, and `SessionEnd`
releases the lot rather than leaving files looking busy for the length of the TTL.

**Refused once, then it is yours.** A cross-worktree collision is ordinary; a register that
forbade it would be one everybody turns off. So the first edit against a file somebody else
holds is denied *naming the bead and the branch the holder is on* — where the bead comes
from is further down — and the refusal records the intent —
the session that has been told and means it anyway claims the file on its next attempt —
and keeps it, which for a while it did not: the only route to `held` ran through `told`, so
the edit *after* the one that insisted was demoted and refused all over again, alternating
for as long as both sessions were on the file and making the sentence the refusal ends with
untrue (bc-n1qq — found by it happening twice to the session writing this paragraph). One
wasted tool call buys the warning, and only one.
Two sessions in the **same** tree is the other case, and
that one reads as a stop, because it is the bc-utyr shape rather than a merge-time
disagreement: it is where two sessions genuinely overwrite each other's bytes.

**And it says which lines, because otherwise both collisions read the same.** Two sessions
rewriting one function and two sessions at opposite ends of a thousand-line file produced
the identical warning, and only the first is a conflict — so the message that fired on the
harmless case taught you to skip the message on the other one. `lib/regions.js` fixes that
by reading, at the moment of the refusal, what each side has actually changed:

```
public/monitor.js is already claimed by another session (bc-9d37 on worktree-advocates-roster-8kq)
— a different worktree, so nothing is overwritten now. They are changing lines 565–640, 652–666
of their copy; yours are at 120–140 — a different region of the merge base (a7cf008). Those regions
do not touch, so git should merge them cleanly — keep out of their lines and it stays that way.
```

**Derived, never stored**, and that is the whole design rather than an optimisation. Line
numbers recorded onto a claim are wrong the moment that session inserts forty lines above
them, and nothing in the record can know it happened; worse, two sessions' numbers are
numbers *in different files*, so "A touched 120" and "B touched 120" are not statements
about the same line and comparing them answers nothing. So nothing is kept. Each side's
ranges are read out of git when somebody asks, and the comparison happens in the one frame
the two branches share — the **merge base**, taken pairwise, because two branches cut at
different times do not have one base between them. That also disposes of the lifecycle
question a stored version would have had: there is nothing to clear at merge, rebase or
downmerge, because once the work lands the merge base advances past it and the diff empties
itself.

Three details are the difference between a useful sentence and a confident wrong one. The
diff is against a **base commit rather than a log**, so uncommitted work counts — a session
mid-edit has most of its changes in the working tree, and a reading that saw only commits
would report it as idle. Overlap is padded by **three lines**, because that is the context
git merges with and two hunks two lines apart already conflict. And every number *printed*
is in the file its reader can open — theirs in their copy, yours in yours — while the
comparison behind them is in base coordinates, which is precise and is a file neither of
them has.

None of it runs on the hot path. `POST /api/claims` is in front of every Write and Edit in
every session on this Mac and its budget is a map write; the git spawns happen after
`claim()` has already decided, on the refusal branch, which is a few times a day.
`scripts/claim-guard.sh` is untouched by it and pays nothing, and if git cannot answer —
unreadable repo, shipped worktree, no common ancestor — the refusal is the one it was
before any of this existed. `GET /api/claims?regions=1` asks the same question about
collisions nobody is claiming right now, opt-in because a reader drawing a list of names
should not pay for a column it is not showing.

Four properties are the file, and three of them fail silently if they are wrong:

- **the asking is the taking** — `claim()` decides and records in one synchronous call with
  no `await` in it, so two requests a moment apart cannot both observe a free file. That is
  the same property the resolver dedupe buys with a lock, got here by having nothing to
  wait for;
- **a tree that is gone holds nothing** — shipping removes the worktree, so a claim is
  dropped when its directory is, and `ship` releases every file it held without knowing
  this exists. A claim that outlived its tree would make a live session stand down for a
  dead one, which is how a file becomes permanently un-editable;
- **a restart forgets**, for the reason a phone's whereabouts is not on disk either;
- **it fails open, always.** No daemon, no token, no `jq`, a timeout: the hook exits 0 and
  says nothing. It sits in front of every edit in every session on this Mac, so the failure
  mode has to be "the warning is missing", never "the edit is blocked".

**And it says which bead, which the hook could not.** A claim carries a `bead` field and
`scripts/claim-guard.sh` deliberately leaves it empty: turning a branch tail into a
verified id needs the tracker prefix, and [the tier
rules](#which-bead-a-pull-request-is-for) are clear that a guess must not pass as an
answer — so doing it there meant a 20KB transcript read and two more processes on **every
Write in every session on this Mac**, for a fact that is the same for every claim from
that branch. `lib/claimbead.js` does it in the daemon instead, and the arithmetic is the
whole design: thirty branches ever, against thousands of claims a day, so it is asked
once per branch and every later claim is a map lookup. Without it a refusal read `held by
worktree-park-epic-p9vx`, which leads you to the right place — every worktree here ends
in its bead's own tag — and is one hop short of the id.

Three things make it an answer rather than a guess. It is **verified**: `bc-p9vx` is a
candidate until `bd show` says that bead exists, exactly the way a pull request's tiers
are settled. The candidates are **plural**, because a tag is lossy — `tagOf` strips the
punctuation a ref cannot hold, so `bc-p49x.5` and `bc-p49x5` share the tail `p49x5`, and
reading only the undotted form would leave the field empty for most of this laptop, where
nearly every live worktree belongs to a child of an epic. And where more than one of them
turns out to exist the field **stays empty and says so in the log**: two beads whose tags
collide cannot be told apart by a branch name, and naming the wrong one is worse than
naming none.

None of it is on the hot path either. The lookup is started by a claim and never awaited
by one, so the first claim from a fresh branch answers without it and the answer is
written onto the records when it arrives — which is in time for every reader that matters,
since a refusal names the *holder's* bead and a holder claimed its file before the session
colliding with it turned up. A tracker that could not be read is not an answer and is not
kept, the same distinction `prefixFor` makes about a workspace mid-write; a bead that does
not exist *is* an answer, and is.

**And the register is read a second time, one step earlier.** The hook asks at
`PreToolUse`, which is the last honest moment for an *edit* and one step too late to be
cheap: by the time it fires the session exists, has been briefed, has read the tree and has
a plan, so the refusal costs a wasted tool call by design and the session that means it
insists and proceeds. The advocate asks the same map at **dispatch**, where the same fact is
free to act on — see [the bead whose files somebody is already
editing](advocates.md#the-bead-whose-files-somebody-is-already-editing). No new state, no fourth lock,
no protocol between agents: the same register, read at a moment when standing down costs
nothing rather than a whole session.

`node test/regions.mjs` covers the line-range half against a real repository with real
worktrees — there is nothing worth faking there, since the entire assertion is about what
`merge-base` and `diff --unified=0` actually report, and a stub would only prove the parser
can read strings the test wrote.

That last one is why `node test/claims.mjs` runs the real script against a real server
rather than testing the register alone: a fail-open client that has broken produces exactly
the same output as one that found nothing to report, and nothing anywhere else would
notice. (It also has to spawn it *asynchronously* — `spawnSync` blocks the event loop the
server is on, so the hook's `curl` times out against a daemon that cannot answer until the
hook has exited. That reads precisely like a hook that failed to claim anything.)

**It is not `lib/lease.js`**, which answers a question that sounds like the same one. That is
the **bead**-level claim, and it lives in the tracker because the tracker is the one thing two
Macs share — it exists so two advocates on two machines do not open two windows on one bead.
This is **file**-level, on one machine, and deliberately nowhere but memory. Neither makes the
other redundant: a bead is legitimately held by one session while five others edit files that
bead's work happens to touch.

**Why not the harness's own agent-ref comms API**, which is the obvious reach:
`SendMessage` cannot refuse, so two sessions announcing one file both proceed; it has no
state, so it answers "let me tell everyone" rather than the question that matters, *is
anyone on this*, which is asked at arrival by a session that did not exist when the
broadcast went out; it costs a turn in a dozen other contexts per claim; and it sees only
same-harness peers — where the incident behind the tree lock above was a window opened by
hand. It is a fine courier and it is not a register. That is bc-q5c2.

### Which bead a pull request is for

The list comes from `gh pr list --state all` per repo — so a pull request opened by
hand, with no bead and no delivery block, is on the board like any other. Beads are
then matched back to it in **tiers**, strongest first, and the first tier that
resolves to a real bead wins outright:

1. the `bead:` line inside a [`beadpr` block](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue),
   or an id in the **title** or the **branch name**;
2. the branch's trailing tag — `worktree-launcher-repo-tabs-jin` ends in the bead's
   own suffix, because that is where the tag comes from;
3. the body, and only where it **claims** a bead: "fixes bc-x", "for bc-x". Not a
   mention.

The tiers exist because of a real row. A delivery whose body signed off with "nothing
was done about bc-2tr / bc-es8 / bc-dmt, which this unblocks" came back linked to four
beads, three of which it explicitly had not touched — and all four exist, so asking
the tracker cannot tell them apart. Only *where they were written* can. Every
candidate is still checked against `bd` before it is drawn, so a branch ending in a
word that names no bead simply drops out, and a pull request nobody tied to a bead
says **no bead named** rather than borrowing one.

### The three buttons

- **Queue to merge** — hands the pull request to the [merge queue](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue),
  and does not merge it. It is `beadcause-merge` from the phone: the same `admitPlan`
  decides which bead this pull request already *is* — a merge-bead the queue handed back,
  a delivery card asking about it, one already queued, or nothing open at all — and the
  same `admitToQueue` writes the approval into the queue's own block in `notes`, where
  `gateVerdict` reads it. Then every gate still applies: the base comes into the branch,
  the checks are judged against what the base is already failing, one merge per repo at a
  time, and a branch that broke something comes back as a card with the approval still on
  it. A draft, a closed pull request, or one already merged is refused *here* with a
  sentence saying which.

  **It used to merge, and that was the bug** (bc-02ldo). The tap was `gh pr merge`
  straight through — no downmerge, no baseline comparison, no one-at-a-time, and no
  record in the tracker that anybody had decided anything. loremia merged three pull
  requests on one afternoon in August 2026: #53 and #54 went through `/merge` and each
  left a merge-bead closed with the commit it landed as, #55 went through this button and
  its approval exists nowhere. Two doors into `main` that disagreed about what merging
  was, while the `/merge` skill named this endpoint by path as the thing not to do.

  **The cost is that it stops being instant, and it is the reason the button no longer
  says "Merge".** The queue's "is anything waiting" read is cached, so the merge lands a
  minute or two later; a button still promising a merge would look broken for exactly
  that long, which is what made the same pull request get tapped three times. What comes
  back names the bead the queue will act on, says it is *not* merged yet, and names any
  other open bead about the same pull request — two of those is a work bead that cannot
  close, and the phone has no stderr to print them to.

  It takes **two taps**, with the consequence written into the button between them —
  the same arming pattern as the destructive control on /admin, and for the same
  reason: a `confirm()` on a phone is a system sheet you dismiss by reflex. The arming
  survived the change on its own argument: what the second tap makes is the *approval*,
  which the queue then acts on unattended.
- **Ship** — **runs this repo's declared deploy** ([below](#deploying-a-repo-when-it-says-how))
  where there is one, and opens an iTerm session with a deploy-only brief where there is
  not. Which of the two it will do is on the button before you press it — *Ship* against
  *Ship on the Mac* — with the command named in the line underneath, because `fly deploy`
  costs nothing you would notice and `launchctl kickstart -k` kills the daemon you are
  reading it on. The deploying one takes **two taps**, like Merge: the reason the old
  Ship needed no guard was that a window is something you can watch and stop, and a
  declared deploy is not. The session's brief carries what is already true — merged, on
  origin, not in the running build — so it does not start by working out what this
  screen already knew. Offered on merged rows even when every lamp is lit, because
  a repo can need shipping twice.

  Both halves of the app now mean the same thing by the word: **Ship it** on a delivery
  card merges and then deploys, and this deploys work that is already merged. One word
  that did two different things depending on which screen you were on was the thing
  worth fixing; a repo that has declared nothing keeps the window, and loses nothing.
- **Comment** — goes to the pull request on GitHub and stops there. Not
  [`/api/comment`](agents.md#the-conversation-both-ways), which writes on a *bead* and puts an
  agent onto answering it.

An observer instance ([`BEADCAUSE_OBSERVE`](development.md#a-second-instance--observer-mode)) can merge, because
merging happens at GitHub. It refuses to **ship**, for the same reason it refuses
`POST /api/session`: a button whose consequence is an unattended agent deploying a
checkout it is only visiting.

### The release queue — the number over Ship

A deploy has never shipped one pull request. It fast-forwards the checkout to
`origin/<base>` and restarts, so it makes **every** merge sitting there live at once —
pressing Ship on one row has always carried the four behind it. What the button could
not say was how many, and with six sessions a day merging here that is the difference
between a routine press and the day's work going out.

So the top of each repo's card carries **the queue** — one card per repo, which in a
workspace with an approved list of checkouts is one per approved repo: the merges that are on `origin`
and are not running, with the count drawn over a Ship that deploys the lot in one press
(`POST /api/release/ship`). It is the same `startDeploy` the row's Ship calls, with the
pull requests named in the record's reason so the deploy log afterwards says what it
carried, and it arms the same way. It refuses an **empty** queue rather than restarting
the daemon for nothing, refuses a repo that has **declared no deploy** (there is no
window that means "and the other three"), and refuses one already deploying.

A merge only joins the queue once its commit is on `origin/<base>` **as this Mac has
seen it** — a merge nobody has fetched could not be picked up by the pull, so it stays
off the queue and keeps the row note it already had. And it leaves the queue when it is
demonstrably live: in the build this daemon is running, or covered by a deploy that
exited 0 and started *after* GitHub timestamped the merge. `unconfirmed` and `lost` — the
two words lib/deploy.js has for "nobody knows" — settle nothing, ever.

**And each merge gets a bead.** The notification a delivery sends says *still owed:
deploy* and is gone by morning; a bead is still in the tracker the next time you look,
and it closes itself when the merge goes live. One per pull request, labelled `ship`,
carrying a `ship: <repo>#<n>` marker that makes filing idempotent whatever else is going
on, and labelled `unendorsed` — lib/endorse.js's hold, which is a filter in every
advocate queue *and* a refusal in the launcher — so nothing ever opens a session on one:
shipping is a tap or nothing (see auto-ship below), never an agent. Two things bound it,
because a tracker filling with chores is worse than no tracker at all —

- **The first sight of a repo files nothing.** The board carries three weeks of merged
  pull requests; a new install, a new workspace, or this feature's own first run writes a
  watermark (`~/.config/beadcause/releases.json`) and only merges after it are its
  business. An unreadable watermark file stops the sweep outright rather than starting
  again from nothing, because starting again from nothing is exactly the flood.
- **Only where a ship is visible.** A repo with no declared deploy and no build this
  daemon can see has no event that would ever close one of these, so none is filed there.
- **A repo, never a workspace.** The watermark and the filed-bead record are keyed per
  repo, as [the deploy is](#a-deploy-is-a-fact-about-a-repo-and-a-workspace-may-be-forty-of-them),
  because forty Northwind services all have a #7: one entry per workspace would have read
  the seventh pull request of one service as already filed because another's was. The first
  sweep after that change re-watermarks each repo of a multi-repo workspace and files
  nothing, which is the safe direction and the whole reason the watermark exists.

**It is filed under the P0 the merge's own work belongs to.** The pull request is merged
and beadcause already knows which bead it was *for* — that is the same tiered answer the
board's rows carry (a `bead:` line in the block a delivery writes, the title, the branch
tag, and only then a body that claims one). One lookup up from there gives the P0, and
the follow-up sits under the epic whose reader is the person who wants to know it has not
shipped yet. Where a pull request named no bead, or named one under nothing, it is filed
**with no parent** rather than into the
[unsorted backlog](landing.md#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists):
that pile means *nobody has decided where this goes*, and a bead that closes itself when
a deploy lands is not asking anybody anything. Before this, every one of them landed flat
and was swept into the backlog — 32 of its 83 open children, on the day it was measured,
were `ship` beads. And if bd refuses the parent the bead is filed again without one, since
the record that a merge is sitting unshipped is worth more than the home nothing chose.

**The work bead behind a live merge wears `shipped` — unless it is a parent.** The label
says the code is live; it never touches status, because a deploy says nothing about
whether the work is right, and lib/landed.js already closed what the merge closed. So an
open work bead carrying `shipped` is not a contradiction: it is live code over work
somebody has not finished.

On a **parent** the same true sentence misinforms. A pull request that lands one slice of
an epic names the epic, the epic takes the label, and every survey of the graph then reads
"shipped" over a bead with twenty children still open — on 2026-09-19 that was 32 open
beads carrying it, 18 of them epics, median age 35 days, and each one looked like finished
work that had never closed. So a bead with an open child does not take the label
(bc-iaju1.9). Nothing is lost: the merge is on the epic's own thread either way, the
children carry their own labels, and the epic takes `shipped` on the first merge after its
last child closes — which is when the word becomes true of the bead it is written on.

`release.beads: false` turns the filing off and leaves the number; `release.seconds`
(300) is how often the queue is swept, which is slow on purpose — it is a `gh` call per
repo when nobody has looked at the board recently, and "this merged and has not shipped"
keeps for five minutes.

**Closing asks the tracker what is open; only filing asks the board.** The two halves of
the sweep look opposite ways, and until bc-xl7n.108 both looked the same way. The board is
trimmed to the **twelve** most recently settled rows per repo (`RECENT_MAX` in
lib/prboard.js) because a board is a screen; the sweep then looped over exactly those rows
and found each one's bead by number, which quietly made a display decision the rule for
what could ever close. A merge pushed off the twelve by later merges was never visited
again — not that tick and not any tick after it — and nothing logged a line, because
there was no loop it could have fallen out of. On 2026-08-17 nine pull requests merged
between 23:47 and 23:49, thirteen more merged by 23:54, and the nine sat open for four
days until they were closed by hand. Thirteen is greater than twelve; that is the whole
mechanism, and this repo merges in batches, so it is the ordinary case rather than a race.

So each sweep now also walks the ship beads the tracker still has **open** and subtracts
the numbers the board accounted for. Whatever is left is asked about directly — one
`gh pr view` apiece, newest first, at most twenty per repo per tick and at most once every
half hour per repo — and closed on exactly the evidence a board row is closed on. Three
things about that are deliberate:

- **Both bounds are on the asking, never on the answer, and the slice moves.** What does
  not fit this tick is named on the sweep's `skipped` lines and taken by the *next* one,
  starting below the number this one stopped at — a tick that left a backlog does not wait
  out the half hour, and a cycle runs until the cursor falls off the end of the list, so a
  long tail costs minutes and not beads. That the slice moves is the half worth saying out
  loud: a ship bead is open precisely because its merge is not live yet, so a head that
  does not close is the ordinary case rather than a corner, and a fixed top slice would
  have re-asked those twenty every tick forever while never reaching the tail at all —
  which is the bug being fixed with a `skipped` line over it rather than a fix. The half
  hour between cycles is there because that answer changes when somebody deploys rather
  than every five minutes; a bounded, stated delay is what this bug did not have.
- **A row off the board can close a bead and cannot start a deploy.** Ship's queue is
  `owedFor`, which counts board rows, so a batch that quietly carried a merge the queue
  never counted would deploy a number the screen it came from does not show. Such a merge
  is not stranded by that: it goes out with the next batch like anything else, and this
  closes it when it does.
- **The lookup is injected, not imported** — lib/prboard.js imports lib/release.js, so it
  is passed in from lib/server.js, and a caller that passes none never asks GitHub about
  anything. The close line says which side of the join found it, so the next four-day
  silence is one `grep` rather than one census.

**And the sweep says when it did not run.** On the morning of 2026-08-14 the queue filed
nothing for roughly three hours while eight pull requests merged, and then caught the
whole backlog up in one pass — six beads and one settle window, all at 09:23. The
mechanism was working. What was missing was any way to notice, and it was missing twice
over. `sweepRelease` in lib/server.js `return`ed on `board.unavailable` and said nothing
at all, so a board that would not collect for three hours read exactly like three quiet
hours; and `~/.config/beadcause/releases.json` — the file the gap was eventually
diagnosed from — recorded only what each sweep *found*, so a pass that found nothing and
a pass that never happened left the same file behind. So:

- **A heartbeat in the ledger**, under `$sweep`, written on every completed pass rather
  than only on one that changed something. It is the one key there that is not a
  workspace, and it is on disk rather than in the poller because the gap spanned six
  daemon restarts — a timestamp that resets at boot cannot see across one. It also makes
  the file's own mtime mean "the sweep is alive", which is what was looked at first and
  answered the wrong question.
- **Three lines about a board that will not collect** (`sweepVoice` in lib/release.js):
  the first skip of a run, a nag every thirty minutes while it goes on, and a recovery
  naming how long it was out and how many sweeps it cost — so the catch-up burst that
  follows reads as a catch-up rather than as a surprise. A storm rather than a tick,
  because `gh` being absent is a legitimate permanent state and a line every five minutes
  forever would be the same silence by other means.
- **A line when a sweep is simply late** — more than three intervals since the last
  completed one. That is the case a run of skips cannot cover, because the sweep can be
  late for reasons it never sees: a cycle ahead of it that ran long, a restart before its
  first interval elapsed, a Mac asleep.

### Auto-ship — the merge that does not wait for the tap

Everything above ends at a bead that waits for you. That is the right default and it is
not always the right answer: on a repo you are the only reader of, "merged, not live"
is a state with no purpose, and the work sits on `origin/main` for as long as it takes
you to notice a bead. So a space may say **`autoShip`** and the release queue runs the
repo's own declared deploy itself — no session, no tap, and the ship bead then closes on
exactly the evidence it always did.

It is a space setting for the same reason `autoMerge` is one, with the same three values
(on, off, and absent meaning inherit) and the same global default behind it —
`release.autoShip`, **off**, which is what every install does today.

**And it is not the last word at either end.** Below the space, a single repo
[answers for itself](asking.md#one-repo-may-answer-for-itself-on-the-six-settings-where-it-matters)
through `autoShipPerWorkspace`, which is the level this setting most needed: only one of
the six repos in the Personal space here has a deploy this Mac can run at all, so saying
"ships itself" through the space armed five repos nobody had asked about.

Above all of it, **an epic beats the lot, in either direction.** Label an epic
`no-auto-ship` and its work stays parked on a repo that ships everything else; label one
`auto-ship` and it goes out on a repo that does not. A merge finds its epic by walking up
from the bead it delivered (`parent`, one `bd show` per level) and the *nearest* opinion
wins, so an exception written on the work beats the rule written above it. A label rather
than a config key because it is visible on the bead you are looking at, and because it is
one word to add from anywhere.

What none of those four levels can do is skip the gate, and that is structural rather
than a check written anywhere: the release queue only ever sees a merge that is already
on `origin/main`, and the only ways to get there are the merge queue — which waits for the
pull request's checks and refuses over any red one the base does not already have — or
your thumb. Auto-ship
deploys work that already passed; there is no path by which it deploys work that has not.

Four properties make it safe to leave running while nobody is watching:

- **A settle window, not a trigger.** The first merge that may ship arms a ten-minute
  clock on the workspace and nothing happens; merges arriving while it runs join the same
  batch and do **not** push it back. Four merges in ten minutes are one deploy carrying
  all four — which is what pressing Ship does anyway, and what a deploy that restarts
  beadcause itself demands. `release.settleSeconds` moves it. It is a timestamp in
  `releases.json` rather than a timer, because a timer does not survive the deploy it is
  waiting to start.
- **One attempt per merge, ever.** Firing stamps every merge in the batch as tried
  *before* the deploy is spawned, so **a failed deploy is not retried** — its beads stay
  open, the Ship button stays armed, and the fallback is exactly today's behaviour: your
  tap. Nothing unattended runs a failing deploy in a loop against the thing that restarts
  the server. A ledger that will not write cancels the fire rather than deploying and
  hoping.
- **Not knowing is not a yes.** A tracker mid-write — Dolt is single-writer and six
  sessions share it — means the epic could not be read, and that falls through to doing
  *nothing this tick*, never to the space's own answer. The next sweep asks again.
- **A repo that declares no deploy is untouched.** beadcause cannot ship it, so it files
  the bead and waits for a session, exactly as before.

The deploy it starts is the same `startDeploy` the button calls, with the queue named in
its reason and the oldest merge's bead on the record — so it is indistinguishable
afterwards from one you pressed, every screen that draws deploys draws it, and its
outcome reaches you through the space's ordinary deploy notification. One thing `false`
does not buy, and it is a property of deploying rather than a gap: a deploy makes
everything on `origin/main` live at once, so a parked merge still goes out if something
*else* fires a deploy of that checkout. What `false` guarantees is that nothing in this
space is ever the reason a deploy ran.

`node test/autoship.mjs` covers it with a `ship` stub that starts nothing: that the
window arms rather than deploys, that a second merge joins it without moving it, that one
deploy carries both, that a merge already tried never arms again — the retry loop, proved
absent over merges that are still owed — that a failed deploy leaves the beads open, that
an epic saying no holds its work back on a space saying yes, and that with auto-ship off
the bead filed is byte for byte the one filed today, tap and all.

### What it costs, and what it keeps

One `gh pr list` per repo plus a handful of `bd` lookups, cached for 25 seconds on the
daemon — the page polls, and two phones looking at the same board must not be twice
the traffic of one. Past those 25 seconds nobody waits for the next sweep: the board is
[on the shared cache](operations.md#the-shared-cache--past-the-window-nothing-waits-for-the-sweep), so
the kept one comes back immediately and the sweep runs behind the response. That matters
here more than anywhere else in the app, because this sweep takes longer than its own
window — it could never once be warm before. ⟳ forces a fresh sweep, and so does every
acting call, so a button never acts on a row the tab has been showing since last night. Open pull requests are
never aged out; settled ones drop off the board after three weeks. A repo with no
GitHub remote is a sentence, not an error — most workspaces under `~/beads/` are
trackers rather than repos, and they are named in one line at the foot rather than
given a card each.

`node test/prboard.mjs` covers the daemon's half against real git in a temp directory
with a real `origin` to fetch from — the three-state ancestry, deployed meaning the
boot commit rather than the newest one, the bead tiers, and that `landLocally` leaves
a checkout with edited work in it exactly as it found it — asserted from three sides
since bc-45g8, because the rule is now a distinction rather than a flat no: untracked
residue is stepped past and left on disk, one edited file stops it however much residue
sits beside it, and an untracked file the incoming commit would have written is refused
by git and reported with the path. `landParent` — the same fast-forward asked for
from inside a worktree, which is how [a worker's own
delivery](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue) ends — has
its own real worktree there, because the only thing it adds is *which checkout moves*,
and it has to be the one the next `git worktree add` will branch from. `node scripts/prs-check.mjs` covers the
phone's half in headless Chrome with every POST recorded: that the first tap on merge
sends *nothing*, that Ship is absent until it is merged, that the deploying Ship arms
and the window-opening one does not, and that a refusal lands under the row as GitHub's
own sentence. `node test/prship.mjs` covers the fork itself end to end through the
daemon — a declared deploy started with no window, a repo with none falling through to
the session, two taps not becoming two deploys, and an unmerged pull request deploying
nothing. `node test/release.mjs` covers the queue: what counts as shipped and the three
answers it can give, that the first sight of a repo files nothing, that two ticks over
one merge file one bead — with the ledger entry torn out from under the second, because
the ledger is a watermark and the marker on the bead is what stops the duplicate — that
`unconfirmed` closes nothing, and, over real HTTP against `createApp`, that one press
runs one deploy for the whole queue and the next one is refused.

### Ship from the console you are already on

The queue above lives on the PR board, which is a pane you switch to. The page you are
*actually* on while work is finishing is the advocate console — sessions opening, beads
closing, worktrees tidying themselves — and the question that follows immediately from
watching that is **"is any of it live?"**. Answering it meant the PRs chip, a board that
re-sweeps every repo, and finding the card again.

So each advocate card carries the same strip: the merges this repo is holding that are
not running, the ones you can read at a glance, and a **Ship** that arms on the first tap
and deploys the lot on the second. It is `POST /api/release/ship` — the board's own
endpoint, the board's own queue out of `lib/release.js`, the same `startDeploy` — so a
Ship from here and a Ship from the board are one act with two doors, and there is no
second code path to keep true. A repo with nothing waiting draws no strip at all.

`node scripts/advocate-ship-check.mjs` drives the real console in headless Chrome with
every POST recorded: that the strip lands on the card for the repo it is about and above
that advocate's own folds, that the first tap sends **nothing** and says how many are
about to go out, that the second sends one `/api/release/ship` carrying the repo's *key*,
that a repo with an empty queue draws no strip at all, and that a refusal lands on the
card in the daemon's own words.

The board it draws from is **borrowed, not owned**: `/api/prs` is a `gh` sweep per repo,
so the console asks for it at most once a minute, only while its own pane is up, and
again the moment anything on the log could have moved the number — a merge, a deploy, a
review declined. A fetch that fails keeps what it had and says nothing: the strip is a
bonus on this page, not its subject, and an error banner over the advocates because
GitHub was slow would be a worse page than one whose count is a minute old.

### After the deploy — the app updating itself

A deploy moves two things that are not the daemon, and until bc-jznr it told nobody about
either. The files under `public/` that every open tab is made of, and — when `android/`
moved — the APK the phone's shell *is*. A phone left on the inbox went on running the
bundle it loaded that morning against a daemon that had moved underneath it, and the
shell was upgraded by somebody remembering to open a URL and thumb through an installer.

So the daemon now says what it did, and the app decides what that means for it.
`GET /api/update` and two booleans on the `deploy` event every client is already parked
on: **`web`** — something under `public/` is different from what you loaded — and
**`apk`** — the rebuild step ran and republished the shell. `lib/update.js` derives both
from the record the runner already writes, and two of its rules are load-bearing:

- **They follow the pull, not the restart.** This daemon serves `public/` from disk on
  every request and the runner's pull is a fast-forward of that very checkout, so the
  files moved the moment the pull did — whether or not the restart after it worked. A
  beadcause deploy ordinarily settles as `unconfirmed` (it killed the process that would
  have reported on it), and gating on `ok` would leave every client stale forever.
- **Only this checkout.** A deploy of sorrel moves `public/` too. The test is the
  record's own `dir` against the tree this daemon is running out of — not the repo's key,
  which is config, and which is `null` on a Mac where the clone is in no workspace.

`public/update.js` is the client half, on every standing page. It **borrows the page's
poll** rather than opening one — `stream.listen`, added for this — because a second
parked request on every page of every device for one boolean is exactly the cost this app
spends care avoiding elsewhere.

**The event alone is not enough, and that is not a detail.** A beadcause deploy kills the
daemon every client is parked on; the settle event is emitted by the *new* process, by
which time every poll has broken and is sitting out a backoff, and a poll that comes back
asks cold — current sequence, no backlog. The one event that matters is precisely the one
a page can be relied upon to miss. So the boot read acts too, behind two guards that have
to be read together: **one reload per deploy id, per device, ever** — written down before
the reload, because a reload is what stops this page existing — and **only where this page
predates the deploy**, so a tab opened after it does not flicker for nothing. The first is
the guarantee and holds whatever else is wrong; the second compares two machines' clocks
and is therefore allowed to be wrong and never load-bearing.

**The page reloads itself, and the shell asks first.** Those are deliberately different:

- A reload is cheap and invisible when it lands well, so it happens on its own. Through
  `registration.update()` first, or the service worker's cache hands back the very bundle
  we are leaving — and never over a caret: anything typed into is a deferred reload,
  taken when the box is left or the screen comes back.
- Installing an APK restarts the app. So the download happens silently the moment the
  shell learns it is behind — 28 MB over a tailnet costs nothing anybody notices — and
  the **ask** comes after the bytes have landed, so saying yes is a moment rather than a
  minute of watching a bar. Say *Later* and an **Update app** button stays in the top bar
  until it is applied. It arms like everything else here that restarts something.

The version is a real number now. `versionCode` was `1` in every build ever made, which
makes "is the published one newer?" unanswerable; `npm run android` derives it from the
commit count, stamps it into the APK and writes the same pair into
`public/beadcause.apk.json` beside it — because an APK's version lives in a binary the
daemon has no business unpacking. The two are cross-checked by byte count, and where they
disagree the version is **unknown** rather than wrong: a sidecar describing some other
file is the one input that could put a phone in a download loop.

The install itself is `PackageInstaller`, not an intent at the system installer — only
the session API reports what happened, so every ending has a name instead of "did the
version change next time somebody looked". On Android 12+ an update to a package this app
installed may be applied with `USER_ACTION_NOT_REQUIRED`, so the *second* update onward
needs no system dialog at all; the first goes through the platform's confirm screen,
because the installed copy came from a browser download and this app is not yet its
installer of record. Both are ordinary paths and both are handled. It needs the one-off
"install unknown apps" toggle, and `Updater` opens that settings screen rather than
failing inside a coroutine where nobody would see it.

Coming back up is asked for **twice**, on purpose. Replacing a package kills the process,
and whether the receiver that hears about it may then start an activity depends on state
it cannot see. So the relaunch is attempted and a *"Beadcause updated — tap to reopen"*
notification goes out beside it, which `MainActivity` cancels the moment it is on screen.
The cost is a row that flashes and clears on the phones where the relaunch worked; the
cost of trusting the relaunch alone is an app that quietly does not come back on the
phones where it did not.

`node test/update.mjs` covers the daemon's half — that an `unconfirmed` restart still
reports the page it moved, that a rebuilt APK in `public/` is not "the page changed", that
another checkout's deploy says nothing to us, and that a sidecar which does not match the
file beside it names no version. `node test/appupdate.mjs` runs the real
`public/update.js` in a vm against a stub DOM and a fake bridge: that the boot read
catches the deploy whose event the restart ate, that the page which comes back does not
reload again, that a caret defers one, that a browser is never offered an APK, that a
version nothing can compare is left alone, and that one tap arms where two install.

### Deploying a repo, when it says how

For a long time the daemon could do everything after a merge except the last thing.
`grep` for `launchctl` across `lib/` and `bin/` found prose in comments and nothing that
runs: every deploy on this Mac was Adam at a keyboard, and the Ship button above was a
window that asked him to be. `lib/deploy.js` is the missing verb, and Ship now runs it
wherever it has been written down.

**A deploy is declared, never guessed.** `deploys` in `~/.config/beadcause/config.json`,
keyed **per repo**, empty by default and empty for most repos forever:

```json
"deploys": {
  "beadcause": {
    "command": ["launchctl", "kickstart", "-k", "gui/{uid}/n12n.beadcause"],
    "restarts": true,
    "rebuild": [{ "label": "apk", "when": ["android"], "command": ["npm", "run", "android"] }]
  },
  "sorrel": { "command": ["fly", "deploy"] },
  "northwind/atrium-service": { "command": ["fly", "deploy"] }
}
```

A workspace that is one repo is keyed by its own name, which is what every entry anybody
has written already says; a workspace with
[an approved list of checkouts](config.md#many-repos-one-workspace--the-approved-list-and-the-token-that-names-each)
is keyed `<workspace>/<repo>`, and the half after the slash names one the way
`repos.<workspace>.default` does — its directory name, its service token, or its path. See
[the argument for keying it that way](#a-deploy-is-a-fact-about-a-repo-and-a-workspace-may-be-forty-of-them),
which is short: `deploys.northwind` has no true answer.

beadcause restarts under launchd, sorrel runs `fly deploy`, the next repo will do
something else — there is no shape those share that could be read off a checkout, and a
daemon that guessed would guess at three in the morning in a repo nobody was watching. A
repo with no entry keeps the answer the board already gives it: **no deploy
beadcause can see.**

**Except its own, which it writes for you — once.** The rule above is about *other*
repos; a daemon cannot read a deploy off a checkout it has never run, and it does not
have to be told about the one it *is*. The label is a constant in this repo, the tree
that label starts is a plist on disk it can open, and whether restarting it kills the
caller is a fact about `launchctl kickstart -k`. So the beadcause entry above is written
into your config at startup — exactly as printed, `{uid}` and all — and the daemon says
so on stdout when it does.

It refuses in every case where it would not be true. The LaunchAgent has to be installed
already and its plist has to name **this** checkout's `bin/router.js` (the same test
[the refusal below](#restarting-a-label-is-not-the-same-as-deploying-a-tree) applies), so
a clone that is not the one being served declares nothing. A configured **repo** has to
actually map to this checkout, since that is the key the entry hangs on — the workspace is
not enough where one holds forty of them. Anything already written there is left alone
rather than merged into. And the whole thing happens **once, ever** —
the receipt is in `state.json`, so an entry you delete on purpose stays deleted.

The APK rebuild is declared only where `public/beadcause.apk` exists, which is the one
honest signal that this Mac builds the app: `npm run android` needs the Android SDK and
exits non-zero without it, and where the file *does* exist a deploy that moved `android/`
without rebuilding leaves a stale APK being served to a phone.

**It is argv, and never a shell line.** `["launchctl", "kickstart", …]`, not
`"launchctl kickstart …"`. That file is hand-edited, rewritten by `saveConfig` and
[synced as a git repo](agents.md#where-the-rest-lives-configbeadcause-is-a-git-repo); a string would
make every one of those somewhere a metacharacter changes what runs. The cost is that
`&&` and pipes are unavailable, and the answer to wanting them is a script in the repo —
a thing you can read and test. `{uid}`, `{home}`, `{dir}` and `{base}` are substituted;
nothing else is, and an unrecognised brace is left exactly as typed.

**What it runs, in order:** fast-forward the checkout to `origin/<base>`, so what goes
live is the merged tree rather than whatever this Mac happened to have; rebuild anything
whose `when` paths the fast-forward actually moved; then the deploy command. Every step
records its own exit code, and a non-zero one stops the rest — a rebuild that failed
never reaches a restart. **It will not merge over uncommitted work:** a checkout with
edited work in it stops the whole deploy before anything is built, because six sessions
edit these checkouts and a deploy that quietly stashed one of them would be the worst
kind of helpful. Edited work, read with `--untracked-files=no` — untracked files are
nobody's unsaved edit, and the fast-forward the delivery path does
([above](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue)) now draws
the same line for the same reason.

#### Restarting a label is not the same as deploying a tree

`["launchctl", "kickstart", "-k", "gui/{uid}/n12n.beadcause"]` restarts whatever job is
loaded **under that label**, which is not necessarily the checkout the two steps above it
just brought up to date. That is not hypothetical: it is
[the three-day bug](operations.md#the-router--why-you-never-restart-it) in a form a deploy walks into
on its own. The plist in `~/Library/LaunchAgents` is generated once by
`scripts/install.sh` and is the one file in the chain `git pull` never touches, so a
deploy can fast-forward the tree, rebuild the APK, restart the label, exit 0 — and have
restarted the program the label was pointed at in March.

So the runner checks the label before it restarts it, and **refuses** rather than
rewriting anything:

```
refusing to restart n12n.beadcause: the LaunchAgent is not in step with /Users/you/beadcause.
launchd would have restarted /Users/you/beadcause/bin/beadcause.js.
launchd runs bin/beadcause.js directly, not bin/router.js.
...
fix it: npm run install-service
```

The verdict is `lib/service.js`'s, whole — the same one the daemon prints as a banner and
`npm run swap:status` names — because the actual bug is a plist pointing at *the right
checkout's wrong file*, which no "is the program under this directory" test would ever
catch. Any **other** label gets that weaker test instead, since there is no router to
expect: the program launchd starts must live inside the directory the deploy just
fast-forwarded, or the restart puts back exactly what was already running.

It judges only a command that restarts an already-loaded user job — `launchctl
kickstart|kill|stop` against `gui/<uid>/<label>` or `user/<uid>/<label>`. `fly deploy` has
no label; `bootout`/`bootstrap` *are* the reload and second-guessing them would refuse the
command that fixes the drift; `system/<label>` is a LaunchDaemon this daemon has no view
of. Two keys move it: `"launchAgent": "bin/router.js"` names the program exactly (stricter
than containment, and relative to the deployed directory), and `"launchAgent": false`
turns the check off for a job loaded some way this cannot see.

**The other way out is a rebuild step, and needs no code:**

```json
"rebuild": [{ "label": "launchagent", "when": ["scripts/install.sh", "bin/router.js"],
              "command": ["bash", "scripts/install.sh"] }]
```

`install.sh` is idempotent and already boots the job out and back in, so the drift is
gone and the check then passes — which is why the check runs *after* the rebuilds rather
than before them. It is the right shape for the repo that wants it and the wrong default
for everyone: rewriting a LaunchAgent from inside an unattended deploy at three in the
morning is a big hammer for a failure a sentence names perfectly well.

**The refusal above is also four fields, and that is what you actually read it as.** The
paragraph is the log's shape; a phone's is a list. So the verdict lands on the deploy
record as `launchAgent`, carrying `label`, `program`, `plist`, `fix` and `fixCommand`
beside the prose, and both readers take the fields:

- On the deploy strip the unfolded row draws them as a bordered block — the label, the
  program launchd would have restarted, the plist that says so, and the command in
  `<code>` under a heading that says **Fix** — with the reasoning as a quiet line under
  it and the `error` paragraph not repeated beside them.
- The ntfy push sends three short lines: `refused: <label> is stale`, `launchd would
  restart <program>`, `fix: <command>`. It used to send `error.slice(0, 300)`, and since
  the message leads with the refusal and *ends* with the command, the truncation ate the
  fix — a push telling you a deploy was refused and unable to say what to type.

`fixCommand` is null wherever there is no honest one: how a label this repo did not
install gets reinstalled is not ours to know, so those verdicts carry the action as a
phrase and offer no command to stand behind.

`node test/launchagent.mjs` covers the verdicts against plists it writes in a temp home,
so it never reads the real `~/Library/LaunchAgents`; `node test/deploy.mjs` covers the
runner acting on one — the command never runs, the rebuild before it did;
`node test/launchagentcard.mjs` covers the fields reaching the record, the push and the
screen, including the arithmetic that the old 300-character slice cut the fix off.

#### A deploy is a fact about a repo, and a workspace may be forty of them

Everything above was written when a workspace *was* a repo: one tracker, one checkout, one
remote, one deploy. Northwind is the shape that breaks it — a GitHub org of forty-odd repos
sharing the single `cl-` beads workspace, because only `architecture` has beads installed —
and it breaks it in a way that reads as working. `deploys.northwind` is a config line
somebody can write, the Ship button on a merged Northwind pull request draws itself, and
what it deploys is `architecture`, whichever service the pull request was in. The reverse
map was the same lie from the other side: `deployFor` resolved a key's directory through
`resolveSessionDir`, which answers with the workspace's *default* repo, so one entry named
one checkout out of forty and nothing on any screen said which.

So a deploy, a board card and a release queue are keyed by **repo**, and the key is a
workspace name where the workspace is one repo and `<workspace>/<repo>` where it is not.
Three consequences worth knowing before you go looking for them:

- **Nothing anybody has configured needs editing.** `beadcause`, `sorrel`, `loremia`: the
  key of a one-repo workspace is its own name, character for character. The same is true on
  the wire — every button still sends `workspace`, and sends `key` beside it — and true of
  the deploy journal, where a record written before any of this carries only a `workspace`
  and groups correctly because for those installs that string *is* the key.
- **A bare `northwind` key is refused, not resolved.** It names no checkout, so the button
  that reads it says so, with the key that would have worked in the sentence. Resolving it
  to the default repo is the one thing it will not do: an unattended deploy of the one
  service nobody asked about is not improved by having been convenient.
- **The board lists every approved repo, each row naming its own.** Which is what makes the
  next paragraph necessary.

**The cost is `gh`, and it is why the board has two caches.** A sweep asks each repo for its
remote and its pull requests — two network calls — and forty repos at the board's own
25-second cache is over eleven thousand calls an hour, reached by leaving /prs open on a
phone. Against a limit of five thousand. So the `gh` half of a sweep is cached per checkout
for two minutes — `prs:<checkout>` on the shared layer, beside the board's own `board:` —
and the git half is redone every time, which puts the staleness in exactly
the right place: `pushed`, `local`, `deployed` and `shipped` are local reads and stay as
fresh as they ever were, and what goes stale is "has a new pull request appeared" — the one
fact on this screen nobody watches a second hand for. Three things drop it, which between them
cover everything you would notice: the ⟳, every acting call (they all sweep forced), and any
merge, close or comment from this daemon — those drop the cache **for the checkout they acted
on**, so the repo you just touched is re-asked and the other thirty-nine are not. A sweep is
also capped at six repos at a time, because `Promise.all` over forty is eighty concurrent `gh`
processes and the ones that time out come back looking like real errors.

**And a delivery card is now matched by its repo, not its workspace.** The card in the inbox
names its pull request the way everything outside this Mac does — `Northwind/atrium-service`
and a number — so answering **Ship it** resolves that slug against the board and refuses if
no approved repo matches. It used to resolve the workspace's directory, which means
`gh pr merge 123` running in `architecture`: a call that does not fail, because
`architecture` has a #123 too, and merges the wrong pull request.

#### The awkward part: a beadcause deploy kills beadcause

`launchctl kickstart -k gui/<uid>/n12n.beadcause` SIGKILLs the process that asked for it.
Run inside the daemon, that is the daemon killing itself mid-statement: the HTTP response
never written, and whatever it was about to record about the deploy never recorded.

So the daemon spawns a **detached runner** and returns. `POST /api/deploy` answers before
the deploy has happened — a 200 there means *it is written down and a process owns it*,
never *it worked*. The other half of the contract belongs to the caller: whatever made
the deploy worth doing — the merge, the answer, the closed bead — is durable **first**,
and then the deploy is asked for. Nothing in `lib/deploy.js` writes to a bead, on purpose:
a process that may be SIGKILLed inside the next second is the wrong one to be holding the
only copy of anything. A one-second grace on top buys the response its way out of the
socket.

#### Silence is never success

Every state a deploy can be in has a name on disk, including the two that mean *we do not
know*:

- **ok** / **failed** — the runner said so, and `failed` carries which step and its exit
  code. No output is ever scanned for reassuring strings.
- **unconfirmed** — the runner was killed at the deploy step of a deploy declared
  `restarts: true`. That is what a restart looks like from here: launchd takes the job's
  processes and the runner is one of them. It means *the command ran and nothing outlived
  it to check*, which is the whole truth available, and it is deliberately not rounded to
  either side.
- **lost** — the runner disappeared anywhere else, or never started at all.

The last two are settled by a sweep that runs on every poll — **including the first one,
which is process start**, and that is the case this is really for: the ordinary way a
beadcause deploy ends is by killing the daemon that asked for it, so the process that
comes back is the first one able to read what happened. Then it says so once, on
`/api/deploys` and on your phone, marked on disk rather than in memory so a daemon
replaced by the deploy it was reporting on does not push the same notification twice —
or, if it crashed first, forget to push it at all.

**The journal is a directory, one file per deploy**, not a key in `state.json`. Two
processes are involved and they overlap, and in the middle of a restart one of them
changes identity; a single JSON file read-modify-written by both is last-writer-wins over
the whole document, so the daemon marking a record announced would silently drop the
runner's last step. A file each means the runner owns its own and the daemon only reads
it. It also keeps this clear of `loadState`'s fallback entirely — a pending-deploy flag
parked in `state.json` would need a default there, or a corrupt file would read as a
deploy nobody asked for, or drop one that was.

`node test/deploy.mjs` runs the whole thing against real git repositories in a temp
directory and real detached processes, with nothing restarted and no `launchctl` in
sight: that a shell string is refused rather than run, that a dirty checkout is left
exactly as it was found, that a rebuild fires only for the paths that moved, that
`startDeploy` returns while its command is still running, and that a runner with a dead
pid settles to `unconfirmed` or `lost` and never to `ok`.

### The two queues, and where a bead is in either

Everything above this line is a stage of something, and until `GET /api/queues` there was
nowhere that said so. The merge queue wrote *attempts*, *downmerging*, *resolving* and
*refused* into a merge-bead's notes. The deploy journal wrote `queued · pulling ·
building · deploying · ok · failed · unconfirmed · lost` into a file per deploy. The
release queue batched merged-and-not-live work per repo behind the settle window. Three
files, three clocks; ask any one of them where a bead is and you get a third of an answer.

**They are two queues and not one long one**, because they are entered by different
events, drained by different agents, and nothing is ever in both:

- **The merge queue** — one entry per bead with an unmerged branch, entered the moment its
  pull request joins the queue (a worker files a merge-bead and stops) and left by the
  merge. Its stages are **queued for merge · downmerging · resolving conflicts · gate
  tests · resolving issues**.
- **The release queue** — entered when a pull request **merges**, never before. Several
  merges batch into one release at the end of the settle window, because one restart makes
  all of them live at once. Its stages are **merged · building · deploying · deployed to
  green · green verification · swapping to blue · live**.

Drawing them as one ladder would say that a branch waiting on CI and a merge waiting on a
deploy are the same kind of waiting. They are not: one is waiting on a decision nobody has
made, the other on a clock that is already running.

**Three of the release rungs come off the router rather than the deploy journal.** `npm
run swap` replaces the backend every open phone is talking to and writes no deploy record —
[deliberately](incidents.md#a-swap-is-not-a-deploy-so-the-router-leaves-a-marker-of-its-own), because a
swap wearing one would appear in the deploy history and in a push notification announcing a
deploy nobody pressed Ship on. So *deployed to green*, *green verification* and *swapping to
blue* are drawn off [the handover trail](incidents.md#and-the-trail-the-release-board-reads) instead, and
each one arrives with the time it was observed at:

```json
{ "id": "verifying", "label": "Green verification", "state": "done", "at": "2026-08-17T09:41:22.104Z" }
```

Every rung of both ladders carries that `at`, and on the merge ladder every one of them is
`null` — a merge rung is a *position*, and a release rung that the router observed is a
*stamp*. Where there is no handover to read the three come back `state: "untracked"` and
**never `done`**, however far along the entry is: a repo the router is not in front of, a
swap older than the trail, a router that could not write it. A ladder that quietly skipped
from *deploying* to *live* would say the handover does not happen, and one that filled the
three in from the current stage would tick a green verification that nobody ran.

**Two rules decide what exists at all.** A repo with nothing to release — no service, no
webapp, no declared deploy — creates **no release entry**: nothing could ever move one
along, so its merge entry simply disappears when the pull request merges, which is all
that is true about it from here. And an entry leaves the board **one release after** it
went live, not the moment it did: the moment a deploy lands is the moment you want to look
at what it carried, so an entry released by the current release or the one before it is
still returned and one released two releases ago is gone. `ago` is on the wire — `0` for
the release that is live now, `null` while a merge is still waiting for one — because "this
went out in the release before last" is a different sentence from "this is not live".

A merge that is **live with no record of the release that carried it** is history rather
than a queue entry, and it is left off. This is the same hole the release ledger's
[watermark](#the-release-queue--the-number-over-ship) fills, met from the other side: the
board carries three weeks of merged pull requests and the deploy journal keeps forty
records, so a first run finds every one of those merges live in the build that is running
and nothing that says which deploy did it. Calling that the current release would put three
weeks of work on the board at once, and the rule is *one release past the one that made it
live* — which is not something you can say about an entry nothing can place.

**Nothing is swept for.** The board is the same 25-second `gh` sweep `/api/prs` shares, the
journal is a directory read, and the merge-beads are gathered behind the same cheap
`bd.graph()` question the queue's own tick asks before it spends a subprocess, kept for
twenty seconds. A phone polling this and the board together pays for one sweep, not two.
A merge-bead whose repo is not on the board comes back under `orphans` rather than being
dropped — an account that does not name that repo, a `gh` that would not answer, a
checkout that is not on this Mac — because a branch that cannot merge must not look like
one that already has.

`node test/queues.mjs` is the whole of it, and it reaches no tracker, no checkout and no
network: every rung of both ladders from the states that produce it, the three handover
rungs never drawn as done without a handover and never drawn from a handover belonging to
another release, a repo with no declared deploy carrying merge entries and no release
entries, and an entry that went live in the previous release still returned where one from
two releases ago is not.

### Releases — the view those queues are drawn on

`/releases` is where both of them are on a screen (`/deploys` reaches the same page).
Before it, `GET /api/queues` was an answer with nowhere to be read: the merge queue was a
YAML block in a bead's notes, and the only thing on any screen that said a deploy was
happening was a strip at the top of the PR board.

**Two kinds of card, and one renderer over both.** A **Merge Card** per bead with an
unmerged branch, from the moment its pull request joins the merge queue; a **Release Card**
per merged pull request, in the batch it will ship with — which is what the grouping by
repo *is*, since one release takes everything on that repo's `origin` with it. They are
drawn by the same function, because every entry in either queue carries the same `rungs[]`
shape on purpose; a card that had to ask which queue it was in would be two renderers
wearing one name.

**The stage is the collapsed summary, and the whole card is the tap target.** A card says
where the work is without being opened — *Gate tests*, *Resolving conflicts*, *Merged*,
*live in what is running now* — because "where is it" is the question the page exists for
and an answer behind a fold is a worse answer than none. Unfolding gets you the ladder:
every rung, the one it is on with the sentence explaining it, and the times somebody
actually recorded. The tap is the card and not the chevron, which on a phone is the
difference between a list you can use one-handed and one you have to aim at.

**A rung nobody observed says so, in a word.** The three that come off the router's
handover trail rather than the deploy journal are drawn `not tracked`, with a dash rather
than a tick — on a release that has gone *live*, which is exactly when filling them in
would be tempting and wrong. Where a handover *was* recorded they are ticked with the time
on them, which is the same field arriving with a value instead of `null`.

**A live entry says which release it went out in**, not merely that it is live: `live in
what is running now`, or `live — one release back`, because the board keeps an entry one
release past the one that made it live and those two sentences are the only thing telling
them apart.

**The deploy strip came here from the PR board** (bc-khoe.7) unchanged: what is being
built and restarted this second, every step it has run, what the runner printed, and the
banner that says a dropped connection *is* the deploy rather than the page breaking. It
was on `/prs` because that was the nearest page, not because it was about a pull request —
a deploy is the rung after one. What the board keeps is everything that is about a pull
request, [the Ship button and the count over it](#the-release-queue--the-number-over-ship)
included; what it no longer does is poll `/api/deploys` at all.

**Two clocks, and only one of them ticks.** The queues are woken by the event log and ask
for nothing in between. A deploy in flight keeps the four-second tick it has always had,
because the steps inside one are a file being written on this Mac and no event can carry
them — and a page with no stream behind it falls back to the thirty-second tick rather
than quietly not refreshing. See [the last
timer](navigating.md#the-last-timer-and-the-event-that-deleted-it), which is this strip and is why it
survived the move onto the stream.

`node test/releases.mjs` runs the real `public/releases.js` in a `vm` on top of the real
`public/prcard.js`: the stage readable in the collapsed card, one renderer opening both
ladders, three rungs untracked on a release that is live and ticked once a handover exists,
the picker narrowing what is drawn without asking again — and, from the other side, that
`public/prs.js` no longer fetches the deploy journal while keeping Ship and its count.
`node scripts/releases-check.mjs` is the same claims in a headless Chrome the size of a
phone, including the case only a browser shows: the daemon going away mid-restart.

## The endorsement queue — a group tap, or a row at a time

A worker that trips over work no longer stops to ask. It files the bead there and then
with `beadcause-file`, and the bead arrives carrying `unendorsed`, which is a hold with
teeth: no advocate queues it, no launcher will open a session on it, and it is out of
every count that says how much work is waiting (lib/endorse.js, lib/filing.js). The
decision is still yours and it is still made before an agent spends an hour on the
thing; it is simply no longer the thing the finder waits on.

That trade only holds up if the other end of it exists. Until this screen the held
beads were a muted pill on the advocate console reading `3 held for endorsement` —
a number with no door behind it, and no way at all to see which three from a phone.

**A space — or a single repo — can opt out of this screen entirely**, and it is worth
knowing before you read the rest of it: `autoEndorse` on the space
([above](asking.md#spaces--keeping-work-out-of-your-evening)), or
[`autoEndorsePerWorkspace` on one repo](asking.md#one-repo-may-answer-for-itself-on-the-six-settings-where-it-matters)
where the space is the wrong unit, files without the hold — so those workspaces'
discoveries never appear in this queue at all: they go straight to `bd ready` and the
advocate picks them up. Off unless you ask for it, and the bead still says on its face
that nobody read it first. The queue below is what happens everywhere
else, which is everywhere by default.

**`/endorse` is the door** (`/queue` and `/endorsements` reach the same page). One
list, every workspace at once, newest first, narrowed by the space picker in the top
bar like every other standing view.

**And it arrives drawn, then stays true without asking.** Both halves are recent
(bc-bsgn) and they answer different halves of the same complaint. Arriving used to mean
watching a spinner: this is the most expensive payload in the app — every workspace
listed, then a bead read per row — so the [warm
layer](navigating.md#and-every-other-warmed-path-decided-one-at-a-time) now holds the queue you were
last shown and paints it while the sweep is still in the air. Staying true used to mean a
45-second full refetch, four times a minute, filed bead or not; it is [on the delta
stream](navigating.md#the-delta-stream--every-view-on-the-event-log) instead, so a bead filed by a
worker in the next room lands on the phone in the moment it was filed and an idle queue
costs the daemon nothing at all. A wake that arrives while you are mid-sentence is held
back rather than repainting over your thumb — and taken the moment the box is empty,
which is the half a guard like that usually forgets.

### Releases as a pane, and the two clocks it brought with it

Everything above describes `/releases`, a document. It is a **pane of the shell** now:
`[data-pane="releases"]` in `public/index.html`, shown by a `display: none` swap on a pill
tap with nothing fetched and nothing rebuilt. `/releases`, `/deploys` and `/releases.html`
still answer — any of them can be sitting on a phone's home screen — but as a **302 onto the
pane** since bc-khoe.30.7 rather than as the document. `public/releases.js` is still one
file written to run in either, deciding which by asking whether the one it is in has panes
at all; `public/releases.html` is still on disk and is simply no longer reachable, the way
`public/history.html` is not. It is the second view to make that move, after [the
ledger](navigating.md#the-ledger-as-a-pane-and-its-filters-in-the-hash), and it went the same way for
the same reasons; what is worth writing down is the three places it did **not**.

**It follows the log while it is hidden, where the ledger sets a flag and re-reads on
arrival.** That difference is the views themselves rather than a choice about mechanism.
The ledger is a record of what has finished, so an hour-old one is merely an hour old and
re-reading it as you arrive costs nothing anybody notices. This view is *about things
moving*: a merge card that is three rungs behind, or a deploy that finished twenty minutes
ago and still says `deploying`, is the one thing it must never draw. So its `wake` does the
work rather than deferring it, which is the same handler the document's own `onWake` runs —
one function, registered two ways, because a pane that drew a second copy of that logic
would be the place the two documents quietly diverge.

**It has a clock of its own, and it keeps running while the pane is hidden.** A deploy's
*steps* are a file being written on the Mac and no event carries them, so a deploy in
flight is watched on four seconds — and that tick is deliberately not paused when you
switch away. It only runs while something is actually deploying, which is minutes rather
than hours, and the whole of what this epic buys is that arriving at a view costs nothing.
A pane that had stopped watching would owe a fetch on the tap that showed it, which is the
document load wearing a different mechanism. With nothing running there is no timer at all;
the fallback is thirty seconds and it goes up only when the page has no stream to wake it.

**Which is why `public/stream.js` grew `awake()`.** As a page this view read `following` off
the mount it held itself. As a pane it holds none — [the
stager](navigating.md#the-stager--built-at-boot-and-one-poll-behind-all-of-them) owns the document's one
poll and fans the answers out — and the existing `busy()` is the arbiter's question, blind
to standbys by design. `awake()` is the other one: is *anything* on this page following the
log. Asking `stage.standing()` instead would have answered `false` whenever the inbox owned
the socket, which is the common case, and put a thirty-second poll up beside a stream that
was working perfectly.

**Two element ids moved with it**, and both are the kind of collision a clean merge reports
nothing about. `id="releases"` became `id="rel-list"`, because in one document `#releases`
is the hash that *names this view* — an element of that id is a fragment target the browser
scrolls into view on arrival, throwing away the scroll position `panes.js` has just
restored. And `id="observing"` became `id="rel-observing"`, because `monitor.html` carries
one too — and bc-khoe.4 has since folded it into this same document, where the advocate
console's keeps the bare name because this one gave it up. The `⦿ observing` chip also
moved *inside* the pane rather than staying beside the mark: the top bar belongs to every
view now, and which Mac's deploys these are is a fact about one of them.

The brand dot and the ⟳ went the other way — the pane takes the shell's and leaves them
alone, the dot because `public/report.js` is already driving it off its own count of what
is in flight, and the ⟳ because there is one for the whole app, so each pane asks whether
the press was its own before spending a sweep on it.

`node test/releases.mjs` runs the real file both ways from one harness — `shell: true` is
the only lever, because the file asks the document which it is — and the pane half pins
what a second copy of the logic would have broken: that it registers `presence` and not a
wider want, that it opens no mount of its own, that a wake it was handed re-reads only for
an event that moved a queue, that arriving fetches nothing, that the shared ⟳ is spent by
the pane that is up and by no other, and that the board it draws is card-for-card the one
the document draws. `node scripts/releases-check.mjs` is the other half and the claims only
a browser can make: that the pill stopped being an `<a>`, that a tap loads no document at
all, and that the scroll position comes back — measured at a deliberately short viewport,
because at phone height the board fits and an assertion about a scroll position that was
never there would pass while proving nothing.

### Config as a pane, and the fetch it deliberately does not make

Everything above describes `/config`, a document. It is a **pane of the shell** now:
`[data-pane="config"]` in `public/index.html`, shown by a `display: none` swap with nothing
fetched and nothing rebuilt. `/config`, `/settings` and `/config.html` still answer — any of
them can be sitting on a phone's home screen — but as a **302 onto the pane** since
bc-khoe.60 rather than as the document. `public/config.js` was written to run in either,
deciding which by asking whether the one it is in has panes at all; `public/config.html`
stayed on disk for a while after the hop landed, unreachable by any path, and bc-l75v7
deleted it as `public/history.html` and `public/releases.html` were before it. It is the
third view to make this move, after
[the ledger](navigating.md#the-ledger-as-a-pane-and-its-filters-in-the-hash) and
[Releases](#releases-as-a-pane-and-the-two-clocks-it-brought-with-it), and the smallest —
what is worth writing down is the one place it went a different way.

**It has no `wake` and no clock, where both of the other two have at least one.** Nothing
about a space's settings changes except a press on this card or the picker moving to a
different space, so there is no event a poll could carry that a fetch this file already
made would not already answer. It registers with the stager as `{ build }` alone, the same
bare shape `public/app.js` registers Home with, and it means a genuine cost rather than an
oversight: a setting changed on another device does not reach this pane until the picker
moves or ⟳ is pressed, where the document it replaced got a free re-read on every
navigation back to it. That is the trade this whole epic is making, paid here in the open
rather than hidden behind a mechanism that looks complete.

**Two element ids moved with it, and one of them for a reason the ledger and Releases did
not have.** `id="cfg-observing"` rather than the bare `observing` — not because `#config`
is a fragment target (nothing in this pane is named that), but because the Advocates pane
already holds the bare name, the same collision `rel-observing` exists to dodge. The chip
moved *inside* the pane rather than staying beside the mark, for the reason Releases'
did: the top bar belongs to every view now, and which group is being watched is a fact
about one of them. `id="space"` did not move — nothing else in the shell wanted it.

**Presence reporting is dropped in the shell rather than carried over.** The document
version reports `{ view: 'config', space }` to `public/mirror.js` on every load and every
picker move; the pane does not, matching `public/history.js` and `public/releases.js`,
neither of which reports anything once folded. The mirror does not yet know how to say
"this device is on a pane other than Home", and teaching it that is a shell-wide question
none of the three pane folds has answered — this one just states the gap explicitly rather
than leaving it to be rediscovered.

`node scripts/space-check.mjs` is the browser half, and the claims a static read cannot
make: that a navigation to `/config` lands on the pane rather than the document, that the
pill on the row is lit while it is up, and that a press under a repaint mid-flight cannot
take a half-typed Slack channel id away — the whole reason that check exists, unchanged by
which document is drawing the card.

### The row is the bead, not a summary of it

Unfolded, a row shows what the agent actually wrote: what the work is, what done looks
like, and the provenance paragraph saying how it was found — whether the priority was
clamped, whether it looks like a duplicate. Everywhere else in this app a list row is
a teaser for a sheet. Here the sheet is the point, so it is in the list: you are being
asked whether an hour of unattended agent should go on this, and a decision made off a
title is a rubber stamp with extra steps.

Folded, the row carries the id, the workspace, the type, the priority, a **💬 count if
anything has been said about it**, [**the newest comment and any open question that names
it**](#and-what-was-learned-after-the-bead-was-filed) — and **the bead
it was found under**, which is the one sentence a bead cannot say about itself and
usually the thing that tells you whether this is a real discovery or a tangent. That
line costs a `bd show` per row, because `bd list --json` carries every text field but
not `dependencies[]`, and the `discovered-from` edge is where the answer lives. It is
bounded and it is a read, so it never queues behind Dolt's single writer; a lookup that
fails costs the row its provenance line and nothing else.

The list caps at sixty and **says so when it has** — an endorsement queue with sixty
beads in it is a backlog to answer, not a list to page through, and a silent truncation
would read as "you have answered them all". A workspace whose `bd` fell over is named
on the page for the same reason: an empty queue over a broken tracker is the one lie
this screen could tell.

### And what was learned after the bead was filed

Everything above is the **filing agent's own words**, typed at the moment it found the
work and before anybody had looked at it. That is most of what the queue is for, and it
is also the hole: the evidence that a bead should *not* be endorsed is later than the
bead by definition, and it lands in the two places this list did not read.

**Measured, 2026-08-20.** bc-wi3s had been finished work for two days. The bc-xl7n epic
advocate had run its suite, found it green, written that on the bead as a comment, and
filed bc-xl7n.101 — a `human` bead, P1, open — recommending it be closed rather than
endorsed. The endorse sweep took it anyway, in a batch of 56, and it went into a
105-deep ready queue as ordinary work. Nothing on the row said a word about any of it.
An advocate's instrument for *do not work this* is a card, and **a card loses a race with
a bulk endorse that cannot see it** — so the card has to be on the row.

Two lines, both on the **folded** row, because the press that misfires is the one made
without opening anything:

- **The newest comment**, quoted, muted, one line. The 💬 count says a thread exists; it
  does not say whether the thread is a clarifying question or an advocate writing *I ran
  the suite, this is green, close it.* The count is what makes you look; this is what
  makes you stop. It costs nothing: the provenance pass was already spending one `bd
  show` per row, and it spends `bd show --include-comments` instead — the same one spawn,
  which on this tracker is the entire cost model (see `showWithComments` in lib/bd.js).
  It inherits that pass's bound as well as its cost, so on a queue at the sixty cap the
  last twenty rows carry the 💬 count and not the quotation — the same trade the
  provenance line already makes, and the reason the count stays.
- **⚑ An open question names this bead**, with the question's id, its priority and what
  it asks, and a tap through to it. This one is bordered rather than merely coloured,
  because the failure it exists to stop is a thumb moving down a list of rows that all
  look alike.

**A question names a bead by writing its id, and that is the whole of the join.** There
is no edge to read — a `bd human` bead is a question put to you, and a decision block is
prose with options in it — so lib/openquestion.js scans the title, description, notes
(where `--append-notes` puts a block), design and acceptance of every open `human` bead
for ids, and intersects what it finds with the ids already on the queue. Scanning against
the ids in hand rather than against a pattern is deliberate: a bead-id regex is how
`bc-xl7n.101` becomes `bc-xl7n`, which is [lib/beadref.js's bug twice
over](#which-bead-a-pull-request-is-for), and a question about one child of an epic would
flag the epic and every other child of it. Nothing here ever truncates, so it cannot.

**A standing card is not a question, and excluding the two kinds of them is the whole of
the precision.** A row that cries wolf is a row you learn to scroll past, which costs this
whole section what it is for — so both exclusions were measured against live trackers
rather than guessed at, and both are exclusions of a *class*: a card the machinery raises
about its own progress, whose text names beads for bookkeeping.

**A `human` *epic*.** Measured against the live beadcause tracker on 2026-08-23: 130 held
beads, 17 open `human` beads, four of them P0/P2 epics — and those four produced *every*
false positive there was, three unrelated held beads flagged because `bc-9d37`'s and
`bc-rfnr.9`'s notes happen to mention them. That is not a tuning problem. A `human` epic is
a **standing board card**: the epic *is* the work, the label is what puts it on the P0
board, and its notes are an advocate's running log naming every bead it has touched this
week. One line of exclusion took that measurement from four flags to one, and the one is
true: bc-xl7n.77.1 on bc-xl7n.77.2.

**And a `pr-delivery` card**, which the first measurement could not see because beadcause's
own tracker had none open that day. It is a **merge** card — the queue relabels a merge-bead
into one when it hands a pull request back — so what it asks is *should this branch merge*,
never *should an hour of unattended agent be spent on this bead*, and its body is a
`beadpr` block whose title and summary name every bead the branch touched. Measured against the configured `architecture` workspace on 2026-08-24:
**77 held beads, 46 open `human` beads, 28 flagged rows — and every one of the 18 questions
doing the flagging was a `pr-delivery` card.** `cl-ae8` (*Merge #569? cl-tcg*) alone named
five further beads on the same root cause, so five held rows each drew *An open question
names this bead* about a merge decision that was not about them. That is a third of one
configured workspace's queue drawing a ⚑ that means nothing, on the first production sweep.
With the exclusion the same measurement is **0**, and beadcause's own is unchanged.

A `human` task, bug or decision that is neither of those is the other thing entirely —
somebody asking about something, once, and naming what they mean.

It is **one `bd human list` per workspace that has a row in the queue**, on the
`questions:<workspace>` key [the inbox already keeps warm](operations.md#what-is-on-it-and-what-is-deliberately-not) —
so on a running daemon this costs no spawn at all, and on a cold one it pays for a read
the inbox was about to pay for anyway. A workspace whose read fails leaves the field
`null` rather than `[]`, because `[]` is the sentence *nobody has asked about this bead*
and saying that on the strength of a `bd` call that never came back is the exact failure
the section is about. **A refresh that fell over is stale, not missing**: the cache layer's
own rule is [last good beats
empty](operations.md#the-shared-cache--past-the-window-nothing-waits-for-the-sweep), so a workspace
whose list is *kept* and whose refresh failed keeps drawing the ⚑ it is holding — `null` is
for a read with nothing at all behind it.

**Endorse all counts them between its two taps** — *one of them has an open question ⚑ —
worth reading before you do* — and does not refuse. A bead can carry a stale question for
a month, and a bulk control that would not fire until you had cleared every one of them is
a control you stop using, which quietly takes the meaning out of the hold in exactly the
way [the section below](#endorse-all--the-tap-that-empties-it) is about. The rows say
which; the header says how many, at the moment you are about to act on all of them at once.
**And it is the one place the `null` is spent** — *one of them could not be checked for
open questions* — because everywhere else `null` and `[]` correctly draw the same nothing
(a folded row cannot usefully say *maybe*), while this press is the only control that acts
on *nothing here has a question against it* for sixty beads at a time.

### Four verdicts per row, and a group tap above them

The four are lib/verdict.js and they are four different acts:

- **Endorse** — the marker comes off and the bead becomes ordinary work. One tap, no
  arming: it is idempotent all the way down, so two taps on a train are one
  endorsement and no error card.
- **Adjust ✎** — the six fields the proposal card offers, aimed at a bead that already
  exists: title, type, priority, description, acceptance, labels. The two labels the
  daemon owns are kept out of the box entirely rather than shown and then stripped.
  Saving **keeps the hold** — rewriting a title is not the same act as agreeing to the
  work — and *Save & endorse* is the one tap that does both.
- **Ask for changes** — your objection on the thread, the bead left exactly where it
  was, so the next session that touches it reads what is wrong instead of re-filing the
  same bead next week. The note is required, and an empty box says so rather than
  quietly doing nothing.
- **Revoke** — closed, with your reason, and the marker left on so the discovery and
  your rejection both stay on the record. This is the one that cannot be taken back, so
  it is the one that **arms**: the first press writes nothing at all and the button
  changes to say what the second will do. The same trade Merge makes on the PR board,
  and for the same reason — a `confirm()` on a phone is a sheet you dismiss by reflex.

Above the list, rows **tick**. Six discoveries filed overnight and five of them
obviously fine is what a busy week actually produces, so the bar endorses every
selected bead in one request per workspace — not one request per bead, which would be
six Dolt write locks taken in a row over a phone link. Group revoke is there too and it
arms; group *adjust* and group *ask for changes* are deliberately not, even though the
API takes them, because one title cannot be given to six beads and one objection typed
at six is an objection about none of them.

### Endorse all — the tap that empties it

A tick per bead is fine for six. It is not fine for a hundred, and a hundred is what
this queue actually reaches: a hundred held beads is not a hundred decisions, it is one
decision about a hundred beads, and a queue that can only be drained a tick at a time is
one nobody drains — which quietly takes the meaning out of the hold, because a hold
nobody lifts is indistinguishable from work nobody filed.

So **Endorse all** sits in the header beside the count, reachable with nothing ticked —
not in the selection bar, which does not exist until you have started ticking, and which
is therefore the one place a control for "I have not ticked anything" cannot live. Three
things about it:

- **It acts on what is drawn, never on what merely exists.** The count is taken over the
  rows the space picker is showing, exactly like the header line beside it, so a page
  narrowed to one repo endorses that repo. What the picker is holding back is *named* in
  the confirmation and left alone — "1 bead in another space stays held" — because a tap
  you made while looking at one space silently reaching into another is the single thing
  this control must never do. So is the cap: the sweep stops at sixty, and a queue of a
  hundred and one endorsing sixty under the word *all* would be the truncation lying
  twice, so the overflow is named too.
- **It arms, where the single row and the group bar deliberately do not.** Those two are
  one tap because endorsing is idempotent all the way down and the worst a stray tap does
  is queue work you meant to queue eventually. That argument stops being true somewhere
  around the hundredth bead, and releasing a hundred beads to the advocate at once is the
  exact act [the hold](#the-endorsement-queue--a-group-tap-or-a-row-at-a-time) exists to
  make deliberate. So the first tap writes nothing and only says what the second will do,
  and it says it as a count and the repos it covers — the same rule the inbox's bulk
  approve is under: the button names what it will act on before it acts.
- **Moving the picker disarms it.** An armed *Endorse all 60 in beadcause* whose second
  tap landed after the filter moved would endorse a different sixty in a different repo.
  That is one line in the page's `onChange`, and it is the line the promise above rests
  on.

Underneath it is the same request the group bar makes — one POST per workspace carrying
that workspace's ids, never one per bead — and it needs no new route, because the cap on
a single verdict is a hundred ids and the cap on the queue is sixty. A partial failure is
reported the way every other group reports one: *Endorsed 59 beads. cl-xyz did not: …*,
with the bead that did not go through still sitting on the queue.

What happened is never toasted away. An endorsed bead leaves the queue immediately, so
its outcome is pinned to the top of the list where the rows used to be — the only
evidence the tap worked, on a screen where "did that go through?" must not be a question
you answer by opening a laptop. Each verdict says what it actually did, including when
that is nothing: *already endorsed*, *nothing to change — it already reads that way*,
*endorsed 5 of 6* with the reason the sixth did not.

### A ship bead is not a proposal, and Endorse all could reach one

Everything above is about beads an agent filed and nobody has read. **Ship beads are not
those**, and for a while they were on this screen anyway.

[The release queue](#the-release-queue--the-number-over-ship) files one bead per
merged-but-undeployed pull request, and its acceptance criterion is not something an agent
can satisfy: *the merge commit for #164 is in what beadcause is running*. Only a deploy makes
that true, and a deploy is your tap. So the bead's own rendered text has always promised
that nothing will open a session on it — and the mechanism behind that promise was that it
was filed carrying `unendorsed`, which kept it out of `bd ready` and therefore out of the
advocate's reach.

That put a guarantee no tap should be able to break on **the one label this screen exists to
remove**. The queue is every bead carrying the marker, with no filter, so ship beads were
drawn here as things to judge — and being the highest-frequency thing filed here, one per
merge, newest-first put them permanently at the *front* of the sixty. Endorse all did not
happen to catch them; the ordering guaranteed it. On 2026-08-11 one press took the marker off
the ship beads for PRs #147–#174 in a single go. Two days later twenty-five of the seventy-five
rows in the advocate's ready queue were ship beads, and it duly opened unattended worker
windows on three of them — each one an hour of agent spent rediscovering that a merged pull
request is merged.

Putting the marker back does not fix it, and that was tried: twenty-five beads repaired one
morning, twelve of them back the next. Re-labelling cannot move a bead out of the front of a
list sorted by `created_at`.

So the guarantee keys on the `ship` label itself, which nothing on a phone removes, and it is
the same two layers as [the hold](#the-endorsement-queue--a-group-tap-or-a-row-at-a-time):

- **A filter.** `ship` joins `human` and `unendorsed` in the advocate's excluded set, and
  `Bd.ready` forces it on whatever a caller asks for — so no queue and no count that says how
  much work is waiting can name one. It is filtered out of this screen too, so Endorse all
  never draws one to act on.
- **A refusal.** Every door into an unattended session — `openWorkSession` and its two
  siblings — refuses a ship bead **whatever its endorsement state**, reading the row the
  tracker just returned. Endorsing one by id is refused for the same reason rather than
  quietly performed: a filter is what stops a refusal being reached, and it is never the
  guarantee. That distinction is the whole lesson of the incident, since the old guarantee
  turned out to have been a filter all along.

**Shipping itself is untouched by any of it.** The pull request board finds ship beads with a
query on the label, not through the ready queue, so filtering them out of the *agent's*
queues cannot take a merge off the board or change what a press of Ship carries. New ship
beads are still filed with `unendorsed` on them — it is simply no longer the thing holding
the door shut.

**Two numbers on the advocate console move with it**, because a filter that a count has not
heard of is a screen that disagrees with itself. `N held for endorsement` is a *link to this
page*, so a pill reading thirteen over a queue drawing one would be the kind of number you
stop believing: ship beads come out of it. And they come out of `N ready` in the same
breath — `bd status` counts a ship bead as ready, since it is open and unblocked, so twelve
of them sat inside that number for two days as work waiting on nobody. The held count and
the ship count are deliberately made to *partition* rather than overlap, since a ship bead
filed today carries the marker and one Endorse all reached does not, and subtracting both
sets naively would take the same bead off `ready` twice. Ship beads get no pill of their
own: what they are waiting for already has a number over
[its own button](#the-release-queue--the-number-over-ship).

### Endorsing from the inbox — an answer that names another bead

The gesture lives in four places and until bc-xl7n.76.3 none of them was the inbox.
`POST /api/bead/endorse` is the door; this page and `bin/endorse.js` (the `/endorse`
skill) both post to it. The fourth is `POST /api/session`, and its own reasoning is why
there is now a fifth: tapping **work on this** on a held bead takes the marker off first
and opens the window second, because *you tapping it is you present and choosing, and a
refusal there would send you to another screen to press a button and come back*.

That reasoning applies word for word to an answer that says *endorse bc-xl7n.121*. It
just only ever covered the bead the card was **on**, never one the answer **named** —
and twice, three days apart, an answer named one and nothing happened. Once typed
(*"bc-xl7n.121 endorsed so the class stops recurring."*) and once by tapping an option
whose own response text said *"Run the update-branch on PR 703, and endorse bc-xl7n.121
so the stale-check hold gets a producer instead of a manual nudge each time."* Both were
recorded as prose, both cards closed, and both times the marker stayed exactly where it
was — while bc-xl7n.121, the class fix for ten pull requests held by the stale-check
gate, sat one label away from dispatch.

So `/api/respond` reads the answer (`lib/endorseanswer.js`) and performs what it finds,
through `applyVerdict` and the same `endorsement` event this page's own verdicts use —
so a bead endorsed from an answer leaves the queue on every device at the same moment,
by the same mechanism, as one endorsed from a row here. A second, quieter endorsement
path is exactly what the hold warns against.

**Why prose is read here when the same handler refuses to read it elsewhere.** An
[ambiguous typed answer](answering.md#answering)
comes back *pick an option* rather than being guessed at, and the comment there is
explicit that matching words against option labels reads *"ship it but not yet"* as a
commission just as confidently as *"ship it"*. This is not that, and the difference is
the **id**: `bc-xl7n.121` is a name written out, not a meaning to be inferred. The
reading is narrow enough that only one bit is ever inferred — the word has to be there,
the id has to be adjacent to it, and a negation in front of the word takes the clause off
the table. `endorse bc-a and close bc-b` endorses exactly one bead, because a second verb
ends the list.

**Ids are found by the workspace's prefix, and that is the precision rather than an
economy.** The general shape of a bead id is also the shape of an ordinary hyphenated
word — the very sentence above contains `update-branch`, which any prefix-free pattern
reads as a bead. So an answer endorses in its own workspace or not at all, and an id
under another prefix is never seen.

**And an endorsement `bd` will not perform does not close the card.** A named bead that
does not exist, or a [ship bead](#a-ship-bead-is-not-a-proposal-and-endorse-all-could-reach-one),
leaves the question open in the inbox with the reason on the thread, the way an ambiguous
answer does: nothing about the card moves, no label is written, and it can be answered
again. The one ending this class must never have — recorded as settled with the marker
still on — is what that is for. At most eight beads come off one answer, and anything
past that is named on the thread rather than dropped in silence.

### Talking about one before you decide

**Discuss 💬** is the fifth control on a row and the only one that is not a verdict. The
four above all end with the bead somewhere else; this one deliberately leaves it exactly
where it was, because half of what a decision needs at 07:00 is not endorse-or-revoke but
a question — *is this not already filed, which file would it even touch, what breaks if
we leave it.* Without somewhere to ask, the queue is a choice between approving work you
have not understood and turning down work that might have been right.

Almost none of it is new, which is the point. Commenting on a bead has always dispatched
an agent to answer it ([who you are talking to](agents.md#who-you-are-talking-to)), and the roster
is already the four shapes a question about a proposal takes: answer it, go and find the
evidence, argue the other side, or say what is left to decide. What was missing was a
conversation that **does not resolve the bead**.

So: pick who answers from the same chips the inbox uses, type the question, and the
comment goes on the bead as *you*. The bead keeps its `unendorsed` marker however long
the thread runs — nothing here writes a label — and the agent could not take it off if
it tried: its allowlist names the read-only `bd` verbs one at a time, so `bd label`,
`bd update`, `bd close` and `bd create` are all off it (lib/agents.js). The prompt says
so as well, and says which of the two is the guard.

Two consequences worth knowing:

- **The answer is pulled, not pushed.** Nothing will buzz your phone when the agent
  replies, because the reply poller watches `bd human` questions and an unendorsed bead
  is not one. The panel polls the thread every few seconds while the daemon says an agent
  is running, and names the one that is thinking while you wait. Close the panel and the
  poll stops; the thread is on the bead either way.
- **A bead endorsed on the laptop while the page was open refuses the question**, with
  the same 409 revoke and ask-for-changes give. A question typed at work that has already
  been approved reads as if it had not been.

The folded row then carries a **💬 count**, and that is not decoration: a bead you asked
three questions about last night must never read as one nobody has opened, which is the
state this whole queue exists to empty. It costs nothing — `bd list` carries
`comment_count` already — and the verdict cache is dropped on the way out so the count is
there on the next poll rather than fifteen seconds later.

*Discuss* and *Ask for changes* are different acts and both are worth having: an
objection is a verdict you have reached and want the next session to read; a discussion
is the one you have not reached yet.

### Where it lives, and the tab it is not

Never a sixth tab. The bottom bar is full at five and what gives up its place is its own
decision (bc-j0zl); a screen that settled that by squeezing itself in would be answering a
question nobody asked it. What the page is reached *from* has changed once, and the change
was a deletion:

- **The advocate console's `N held for endorsement` pill is a link.** That is the
  number you were already reading, and it was the thing with no door behind it.
- **Every held bead in the inbox is a link**, from the `held for endorsement` pill on its
  own card, deep-linked with `?bead=<workspace>/<id>` so the page opens on the row you
  tapped.
- **🗳️ in the inbox's top bar is gone** (bc-w156). It was a door in the chrome to a list
  the inbox turned out to be carrying already: held beads ride the agent sweep like any
  other open bead, so they are now rows under the
  [Questions pill](inbox.md#one-list-six-kinds--and-the-two-sub-filters) rather than a fifth
  destination to remember. Nothing replaced the icon.
- **Every advocate on the console has a `Requested endorsements` subcard**, carrying the
  held beads that advocate's own work produced — [below](#and-the-advocate-console-splits-them-by-who-produced-them).

That icon carried **no badge**, deliberately, and it was the one thing on this page that
had an obvious one and should not: the count would have cost a `bd list --label
unendorsed` per workspace on every thirty-second poll, where the counts already in that
bar are free by-products of a sweep the poller was making anyway. The argument is worth
keeping because it is what the replacement had to beat — and the chip's count clears it,
being a label test on a row already in hand rather than a query of its own.

### And the advocate console splits them by who produced them

The queue is one list of everything, which is the right shape for the screen where the
decision is made and the wrong shape for the screen where you are watching the machine
work. On the [advocate console](advocates.md#advocates--an-agent-per-repo-whose-job-is-the-queue-reaching-zero)
an endorsement is not an item in a backlog: it is **a decision one particular advocate is
stopped on**, and the card that is otherwise a complete account of what that advocate is
doing said only how many there were.

So every advocate carries a folded `Requested endorsements` section, and which beads land
in whose is a hybrid rather than one rule. Verbatim, from the answer that settled it
(bc-w156.2): *"shown under EpicAdvocate if they were produced by its work or by the agents
it spawns. per workspace otherwise."*

- **Under an EpicAdvocate** where the graph says so. An advocate's agents are the sessions
  opened on beads under its epic, and a discovery one of them files is filed *under* the
  bead it was working — `beadcause-file` homes it there and keeps the parent even when bd
  refuses to hold the provenance edge beside it. So the epic is an ancestor of the held
  bead, and the **nearest** advocate above it owns it: an epic's own subcard beats the P0
  three levels up, which is the difference between a dozen readable sections and one
  section holding the whole repo.
- **On the repo's own card otherwise** — a bead with no parent, one filed under an epic
  nobody is planning, one you filed yourself from the console. This half is why the split
  works at all. Per-advocate on its own was rejected precisely because a bead no advocate
  owns would have vanished from this screen entirely; with the repo as the bucket, nothing
  is ever unreachable, and the two counts add up to the `N held for endorsement` pill at
  the top of the card.

**It is a proxy and it says so.** Nothing records which *agent* filed a bead, so a bead
somebody parented under an epic by hand reads here exactly like one an advocate's worker
found. The exact reading needs a stamp written at file time, which is its own work; this
is the reading available today, and it is right for every bead the advocates actually
produce.

**The rows cost nothing, which is the part that had to be checked rather than assumed.**
The count was already there and the rows behind it were being thrown away: `bd ready
--label unendorsed` is one of the four calls the console's own row has always made,
because `ready` is a lie until the held beads come out of it (lib/work.js). So this is a
projection of a list already in hand, and the objection that keeps a held count *off* the
inbox's chrome — a `bd list --label` per workspace per poll — does not apply here at all.
The chain of epics above each bead is read from `bd export`, which lib/bd.js caches for a
minute — and this card **never builds one**. It asks whether anything has read the graph
already before it asks what is in it, and takes what is on hand rather than waiting: the
daemon's own tick exports every workspace that has an advocate, and so does the inbox's
P0 board, so on the machine this card is drawn on the answer is a cache hit. Where it is
not, a repaint seconds after a restart draws every held bead on the repo's own card and
gains the per-advocate split on the next one. No bead is ever missing; only its section
is, and only briefly.

These are the rows behind the pill on the same card and not a second sweep, which also
decides what is in them: `bd ready --label unendorsed` minus the ship beads, so a held
bead that is *blocked* is on the queue and not here. That is deliberate — a section
disagreeing with the number six inches above it would be the worse of the two errors, and
the complete list is one tap away.

A row is a title, an id and a link, where the queue gives the same bead its whole
description and the agent's argument. That asymmetry is deliberate and it is the queue's
own reasoning turned around: the fat row exists because a decision made off a title is a
rubber stamp, and this is not the screen the decision is made on — it is the screen that
tells you there is one to make, on the card of the advocate that is waiting for it. The
link is `?bead=<workspace>/<id>`, the same deep link the inbox uses, so the queue opens on
the bead you tapped.

The list is capped, because the one thing an endorsement backlog does is grow, and what
the cap takes off is said inside the section rather than left to look complete.

### Checking it

`node test/endorsequeue.mjs` covers the sweep with a stub `bd`: that the provenance
comes off the edge rather than the prose and that the edge beats the parent, that the
two fields bd names differently arrive renamed, that the list is one list across
workspaces, that a broken workspace is named and the rest still answer, that the cap is
reported, and that a verdict drops the cache — so the laptop on its own poll stops
drawing a bead the phone has just endorsed. Since bc-xl7n.76.2 it also covers the two
fields nobody wrote at filing time: that a bead with a thread carries what was last said
on it *and* its provenance off the one `bd show`, that an open `human` bead naming a
queued bead lands on that row, that `aa-new.3` does not flag `aa-new`, that a question in
one workspace never reaches a same-named id in another, and that a workspace whose `bd`
fell over leaves `questions` null where a read that found nothing leaves `[]`.

`node test/openquestion.mjs` is the join on its own, which is where every silent way to
get it wrong lives: read too loosely and rows cry wolf until you learn to scroll past
them, read too tightly and the screen draws nothing, which is indistinguishable from
nobody having asked. It pins the dotted-child trap in both directions, that all five text
fields are read, that a question naming only itself is about nothing, that several
questions come loudest first and bounded, that neither a `human` epic nor a `pr-delivery`
merge card ever flags a row while an ordinary task, bug or decision does — however the
label is cased or padded, because bd does not normalise them — that only the workspaces
with rows in the queue are asked at all, that a refresh which fell over keeps serving the
list it is holding rather than blanking every ⚑ in the workspace, and that the answer is
kept on the key `allQuestions()` writes.

`node scripts/endorse-check.mjs` is the half only a browser can make, and it is the
acceptance the bead was written with: that both lines are on the row **folded**, that the
question names its id and what it asks, that the comment is quoted with whoever said it,
that the rows nobody asked about carry nothing at all, that the armed *Endorse all* counts
the beads somebody has asked about without refusing the press and says so when a repo's
question list could not be read at all — and that all of it was drawn off
the one sweep the page had already made, because a row that had to fetch its own thread
would raise the flag a second after the thumb had gone.

`node test/discuss.mjs` covers the conversation, and every assertion in it is a way the
thread could quietly decide something: that the comment is the *only* write and the
marker is still on afterwards, that a bead endorsed on the laptop is refused before
anything is written, that one question cannot be typed at two beads, that no `bd` verb a
reply agent may run (`label`, `update`, `close`, `create`, `delete`) is on its allowlist,
that an agent you have since deleted keeps its own name in the thread rather than being
relabelled the default — and that a bead you have just asked about comes back from
`/api/unendorsed` carrying its 💬 rather than reading as untouched.

`node test/heldsubcard.mjs` covers the console's half. The server end is argv against a
stub `bd` — that the rows ride the call the row was already making, that the graph is
never waited on, and that a workspace whose tracker fell over reports its error rather
than an empty list. The page end runs public/monitor.js in a `node:vm` and reads which
section each bead was actually drawn in, because the join is the feature: a source read
could confirm every string and still miss a bead landing in two sections or in none.

`node scripts/endorse-check.mjs [--out=DIR]` drives the real page in a headless Chrome
the size of a phone, against a fixture that records every write. The three assertions it
exists for are the ones invisible from the server: that a group tap is **one request
per workspace** carrying all of its ids, that the first press of Revoke — and of Endorse
all — writes **nothing at all**, and that Endorse all under a narrowed picker leaves the
bead in the space you were not looking at exactly where it was.

Its fixture keeps an event log and counts sweeps, which is how the refresh half is
asserted from outside: a `presence` event — somebody else's thumb — costs **no sweep**, a
filing costs **exactly one** and is on screen inside a second, a wake arriving mid-sentence
costs none and leaves the half-typed question alone, and emptying that box takes the wake
it deferred. Then the sweep is held for two and a half seconds and the page is opened
again, so "the queue was on screen before the answer could have arrived" is a measurement
rather than an impression.

## May this run unattended? — the map, not the merger

Every capability here eventually asks the same question a different way: does this need
a human, or does it just go? By 2026-08-17 at least six places already answered it, each
for a reason specific to itself — the `unendorsed` hold just above, the P2 ceiling on
what an agent may file, `autoEndorse` skipping the hold for a workspace that asked for
it, the pause switch on the Admin screen, `OBSERVING` refusing a second instance's writes,
and the P0 path below that deliberately skips the first two. None of them was wrong. What
was missing was a place to read all six at once, which is exactly the thing a new
capability has to get right and had no single file to learn it from — so `lib/authority.js`
is that file: not a rewrite of any of the six, a map of them, plus the one the earlier
list missed (`lib/underroot.js`'s "is this even under something a human decided on" check,
which rides in the identical door as the `unendorsed` one, one line below it, every time).

**It is deliberately not a merger.** Two guards that look alike from a distance can still
be answering different questions — `lib/proposedlabels.js` already made this argument for
a smaller pair of label lists — and collapsing the six into one function would have hidden
exactly the distinction that matters most here: a crash the app filed on itself and a bead
an agent merely *thinks* is worth doing are not the same claim, and get different
treatment on purpose. So `lib/authority.js` exports three outcomes — `RUN`, `ASK`, `DENY`,
the same three the eve software factory template's `agent/lib/github/approval.ts` names
not-applicable / user-approval / denied — and a `SITES` table naming, for each of the
seven, the question it answers, the module and export a caller actually wants, which of
the three it produces, and why:

| site | outcome | decided in |
|---|---|---|
| endorsement | ASK, backstopped by DENY | `lib/endorse.js` |
| priority ceiling | RUN (a clamp, not a gate) | `lib/filing.js` |
| `autoEndorse` | RUN (a lever on endorsement) | `lib/spaces.js` |
| root requirement | DENY | `lib/underroot.js` |
| admin pause | ASK (a standing switch) | `lib/admin.js` / `lib/advocate.js` |
| observer mode | DENY, mostly | `lib/config.js`'s `OBSERVING` |
| the error P0 path | RUN (bypasses two of the above) | `lib/errors.js` |

`lib/claims.js` is named on the bead that asked for this map and is deliberately not in
the table: it answers who else is editing a file right now, on one machine, with no
notion of endorsement anywhere in it — a different question that only resembles this
family from a distance. `test/authority.mjs` imports every module the table names and
checks the exports it points at still exist, so the table cannot drift out from under the
code the way a comment-only map could.
