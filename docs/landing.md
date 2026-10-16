# Landing work — branches, pull requests and the merge queue

## Landing work — a branch, a pull request, and a merge queue

An advocate opens sessions on ready work. What happens to that work afterwards has now
had four answers, and each one is only defensible because of what the last one taught.

**It merged into `main` on the laptop.** The session did it and closed its bead, so the
first Adam saw of a change was in `git log`, after it had shipped. That worked while one
session ran at a time. With five it fell apart in three ways at once: they raced each
other into `main`, so a session that started from a clean tree finished against one that
had moved twice underneath it; every conflict that came of it landed on him anyway, in
the worst possible form, hours later, in a repo he had not been reading; and nothing was
reviewable, because by the time anything was visible it was already in.

**Then the merge became a question on his phone.** That fixed all three and introduced a
fourth: a queue with a person in it. Every finished piece of work waited for him. A bead
finished at three in the morning sat unmerged until breakfast, and the next bead to touch
the same file started from a `main` that did not have it. Reviewing a diff from a phone
is a real thing to want; doing it forty times a week at the pace an advocate can produce
them is not, and what the gate was actually doing was waiting.

**Then the worker merged its own pull request.** That fixed the waiting, kept the pull
request — the thing that had solved the race — and left one problem standing, which took a
while to see because nothing about it looks like a bug: **the agent that wrote the code
was also the one deciding the code was done.** It decided from inside a single worktree,
with no view of any other open branch, no memory of the last five merges, and no ability
to fix what it found. So every judgement it could not make became a card in the inbox
anyway, and every judgement it could make it made alone, five times over in five separate
processes, each spending five minutes waiting on checks for branches that were about to
conflict with one another.

**So there is a merge queue, and the worker hands the pull request to it.** The route into
`main` has not changed at all — push a branch, open a PR, ask GitHub to merge it — and
neither has the reason for it. What changed is who walks through that door. A worker's
last act is to file a **merge-bead** carrying its pull request, park its own work bead
behind that bead, and stop; the queue runs in the daemon, sees every open branch at once,
merges one at a time, and closes both beads when the merge lands.

```
session finishes ──► beadcause-deliver ──► pushes the branch ──► gh pr create
                                                                     │
                                                    files the merge-bead, parks its own
                                                    work bead behind it, and exits
                                                                     │
                                                         🚦 the merge queue, in the daemon
                                                                     │
                        ┌──── behind main? ── update-branch ────┐    │
                        │                                       ▼    ▼
                        │                       checks green, or red only where
                        │                       main is already red (bc-y738)
                        │                                       │
                        └──── conflicted? ──► a resolver        ▼
                              red? out of tries?        gh pr merge --merge
                                    │                   both beads close
                                    ▼                   ✅ push, nothing to answer
                        the same card as before                  │
                        ──► your phone                            └──► 🔀 PR board → Ship
              Merge · Ship · Request changes · Decline
```

Nine things follow, and they are the whole of the change:

- **The merge is still only ever through a pull request.** Not `git merge`, not
  `git push origin main`, not "just this once because it is trivial". There is still no
  `push` anywhere in `lib/pr.js` — it opens, reads, comments on, merges and closes pull
  requests, and that is all it can do.
- **A worker cannot close its own work, and that is structural rather than a rule.** The
  work bead is made to *depend* on the merge-bead, and the close gate refuses a bead with
  an open blocker. So a session that tries is refused by the tracker, not by its own good
  behaviour — and a future brief that forgets to say so cannot re-open the hole.
- **So a worker cannot honestly call itself `DONE-` either, and it no longer does.** The
  prefix on a finished session's name is what separates shipped work from work that
  stalled halfway, in a `/resume` list where every entry otherwise looks alike — and a
  session that renamed itself the moment its delivery was *queued* was claiming a merge
  it never saw, which is the exact failure the prefix exists to make visible. It writes
  **`QUEUED-`**, which is true when it is written, and the queue writes **`DONE-`** over
  it in `finish` — the same function that closes both beads because GitHub says the pull
  request merged. Nothing infers the merge: the one thing that knows is the thing that
  renames. **Two doors write it now**, because two of them can be the first to know a
  branch landed: the queue's `finish` — which since bc-xl7n.135 is also where a delivery
  card's own Merge tap ends up, `--review` deliveries included, because the tap admits a
  merge-bead the queue can see rather than merging beside it — and `reconcileLanded`, for
  one merged on github.com. Each renames *before* it closes
  the bead — the close is what makes the window reapable, so a rename after it races the
  signal that closes the window. `lib/retitle.js` does the writing, into both stores a
  name lives in — the pid record every guard here reads, and the transcript entry
  `/resume` labels the conversation with forever, without touching its mtime, because
  the picker orders by that. It is best-effort throughout: a window wearing a stale name
  is cosmetic and a merge that reports itself as not having happened is not, so a window
  already reaped is a silent no-op rather than a failure.

- **The downmerge is the queue's, and it happens at the last possible moment.** The worker
  used to be asked to `git merge origin/main` before delivering, which was unverifiable
  after the fact and stale again by the time GitHub saw it. The queue asks GitHub to
  update the branch instead — the same merge, server-side, against `main` as it stands
  right then — which also means it still works after the worker's worktree has been
  retired, which is usually.
- **A red check `main` already has does not count against the branch.** This is bc-y738,
  and it is the difference between a gate and a wall: CI on `main` here was red for five
  consecutive pushes, and under the strict reading nothing would ever have merged again.
  The queue compares the branch's failing checks against the base's and refuses only what
  is *new* — and says out loud, on the bead and in the notification, what it merged over.
  A baseline that is silent is indistinguishable from no gate at all.
- **A conflict opens a resolver, and a resolver that cannot settle it hands it back.** The
  window is the existing one, with the existing one-per-pull-request registry. What the
  agent in it is told is the thing that makes this job different from every other agent
  here: *you did not write this code*, so resolving a conflict by keeping whichever side
  makes the merge go through is the one failure that looks exactly like success. And a
  hand-back now *sticks*: the queue notices the window ended without making the branch
  mergeable and
  [spends an attempt on it](#a-conflict-a-resolver-will-not-settle-becomes-a-card), which
  is what carries a conflict only you can settle to a card instead of to another window.
- **And it brings the merge back down to this Mac afterwards.** The merge is at GitHub, so
  `origin/main` has it the instant it lands and the laptop's own `main` does not — until
  something happens to fetch: a deploy, a merge from the board, a person. Nothing
  reliably did. In between, every new worktree branched from before the delivery, and the
  session that got it paid with a downmerge of work it had never heard of. So a delivery
  ends by fast-forwarding the **main checkout** — not its own worktree, where the ref
  cannot move anyway — and it is the same `landLocally` the merge queue's own `afterMerge` uses,
  refusal and all: *a checkout with edited work in it is not touched*, it says so on
  the bead instead, and Adam's open files are worth more than a tidy `main`. **It names
  the paths that stopped it.**
- **Untracked residue is the one thing it steps past** — and that is a decision, not an
  oversight. The refusal is per-delivery but the checkout is *shared*, so a single stray
  path used to hold up **every** session's fast-forward at once, silently, until a person
  happened to look. A `.beads/` directory left behind by a reverted `bd init` did
  precisely that for a day and 114 commits — nothing was lost, the merges were all safely
  on `origin`, but nothing merged in that window was *live*, and `--status` went on saying
  `disk … (matches what is running)` throughout, because the checkout was simply old.
  Each session that hit it paid to work that out again. bc-s7fs fixed the *noticing* half
  by making the sentence name the paths and say when all of them were untracked, and
  deliberately left the rest open, because the guard it touches is the one lib/prboard.js
  calls the most destructive thing in this codebase. bc-45g8 settled it: **a fast-forward
  may proceed when every dirty line is `??`, and any tracked modification still stops it
  dead.** The reason the guard exists is unsaved edits, and an untracked file is not an
  edit to anything; the two paths that actually recurred here were a `.DS_Store` and a
  root `.idea/`, which the Finder and a JetBrains IDE put back as fast as anyone cleared
  them. Those two are now in `.gitignore` (bc-0i27.18) and no longer appear at all —
  three separate sessions filed them as a bug in the days either side of bc-45g8, which
  is the measure of how much a permanently dirty shared checkout costs to keep
  re-diagnosing. `test/gitignoreresidue.mjs` is what keeps them ignored, and it asserts
  the rule comes from the repo's own `.gitignore` rather than from a `core.excludesFile`
  on somebody's laptop, since a machine that ignores `.DS_Store` globally is precisely
  the one this would go unnoticed on. That does **not** make the relaxation redundant: it is what covers the
  residue nobody has thought of yet, and the residue in the *next* checkout. What makes
  it safe rather than a hole is that the destructive case is covered twice:
  `git merge --ff-only` refuses outright rather than overwrite an untracked file an
  incoming commit would write, and *that* refusal is reported with the paths like any
  other. `scripts/deploy-runner.mjs` has always read its own dirt with
  `--untracked-files=no`, so the two halves of this codebase that fast-forward a shared
  checkout now draw the same line. Nothing is ever cleared: stepping past residue leaves
  it exactly where it was, which is why the note says *past untracked …* rather than
  claiming a clean tree.
- **It will not merge over a check the branch broke, and it does not sit and wait.** A
  new red check stops it and, after three attempts, becomes a card in your inbox — the
  button there *does* let you merge over red, because a red check is sometimes a flake and
  judging that is what a human is for. Checks that are still running cost nothing at all:
  the queue leaves the branch where it is and looks again next tick, and a wait never
  spends one of those three attempts. That is why slow CI does not turn into a card.
- **Both beads close because the merge happened**, in the same breath, with the PR number
  and the merge commit in the close reason — the merge-bead first, because the work bead
  depends on it. Neither the session nor the delivery closes anything; the queue does, and
  the advocate reads that reason back so the sessions page can say *landed #42* rather
  than the older and much weaker "closed by the session". An **epic** work bead is the one
  exception and stays open: an epic is finished when its theme is, not when a branch
  sharing its name merges.
- **Deploying is still yours to ask for.** The merge is on `origin`; whether that is
  *running* is a different fact with a different button. The notification says what
  landed and what is still owed, and links to
  [the PR board](pull-requests.md#pull-requests--review-merged-pushed-deployed-live), where **Ship** is. A worker
  being right about a merge does not make it right about a deploy, so it never runs one
  — but where the repo has written its deploy down, Ship is one tap and no window. On a card that *did* come
  to you, the two are one tap apart: **Merge** and **Ship it** sit next to each other,
  and the difference between them is the whole of [the next section](#ship-it--the-same-merge-and-then-the-deploy).

**The card is intact, and it is where every ending that is not a merge arrives.**
Everything below about the card, the three answers and the markers is still exactly what
happens when the merge does not — GitHub refused it, a check the branch broke went red
three times over, a conflict nobody could settle, the space
[asks for an approving review](asking.md#spaces--keeping-work-out-of-your-evening) and there is
none, auto-merge is off, the session passed `--review` because it wanted a human on
this one — the two of those never reach the queue at all — or the bead was
[typed into the running app](navigating.md#the-worker-at-the-far-end-and-the-one-thing-it-may-not-do)
— the one kind of work a worker here may not merge, whatever the space says. It went from
being every delivery to being the interesting ones.

### The pull request says what is happening to it

A branch that will not merge looks, from GitHub's side, exactly like a branch nobody is
working on. That was true of every queued pull request here for as long as the queue has
existed: the merge-bead carried the whole account — which gate refused it, which window
was opened on it, what it merged over — and the pull request carried nothing but the
diff. Two readers, and only one of them had to know a tracker existed to find out what
was going on. Since bc-kan5f the pull request is told three times, by the three things
that actually know.

**Approved, when Adam approves it.** `/merge` is the decision, and it lands on the pull
request as a real approving review rather than a note claiming one happened — `approve`
in `lib/pr.js`, submitted by the *second* GitHub account on the Mac, because GitHub
refuses an approving review from the account that opened the pull request. Where there is
no second account the review is skipped and said to be skipped, which is the honest
ending: with no review on it there is no green tick to be mistaken for a person's.

**Taken, when a MergeAdvocate opens on it.** The first step of that window's brief is now
to say so, *before* it touches the tree — what it is merging into what, and what it
expects to come out. The order is the point. A prediction posted in advance is worth
something to whoever reads it next; the same sentence written afterwards is a report, and
the brief already asks for one of those at the end. "This is the routine sw-cache
renumber and I expect it green" and "these two sides disagree and I may hand it back" are
the two useful things to have said in advance, and the second is the more useful.

**Merged, when the queue merges it** — with how it got through, which is the part nothing
else records. How many windows were opened on it, how many times `main` moved underneath
it while it waited, what the base was already failing when it went in, who approved it,
and how long the whole passage took. A branch merged at the fourth attempt with three
downmerges was not a bad branch, it was an unlucky one, and a month later that
distinction is unrecoverable from anywhere else.

**"Who approved it" is two different sentences, and this comment carries them apart.** Your
own admission through **Merge** is one line; the ReviewAdvocate's reading of the diff is
another, and that one says in as many words that *an agent, not you* approved it, names the
agent and the login it spoke as, and links the review. It has to be here as well as on the
review itself: the disclaimer that goes under an approving review is posted at the moment
that review goes out, which on a busy pull request is a dozen comments above the bottom of
the thread — and it is posted only when a review actually reached GitHub, so on a Mac with
one login the whole page would otherwise say nothing at all about what released the merge.
This is the last comment on the thread and it is posted either way. Where a space asks for
both gates, both lines appear, which is what *necessary and not sufficient* looks like
written down on the page somebody actually reads.

The gap was not theoretical: #618 merged on 2026-08-23 **because** an agent approved it, and
its closing comment — *"Merged into `main` as `cb531615` by the beadcause merge queue.
Straight through."* — said nothing whatever about a review having happened at all.

**What the queue's report deliberately does not do is summarise the advocate's.** The two
have different witnesses. The advocate knows the conflicts, which side it kept and why,
and which suites it ran against which tree — and it writes that on the bead. The queue
knows the shape of the passage and nothing about the diff. So `mergeReport` in
`lib/mergequeue.js` reports what it is holding in its own hand and *points* at the rest,
because a summary of somebody else's account, written by a process that did not watch the
merge, is the exact shape of a confident falsehood — and the queue would be the last
thing anybody thought to doubt. `test/mergequeue.mjs` pins it from the other side: the
report may not contain a conflict count or a suite tally, because neither is a number it
ever had.

All three posts are best-effort and none may stand between a merge and its closes. A
report that failed to post is a comment nobody got; a report that threw into the close
path would strand a merged pull request with two open beads, which is the failure the
whole close sequence is written to avoid.

### A red check says what it said — not just that it was red

The refusal a merge card carried used to be this, and it is the same sentence for every
red pull request this repo has ever had:

> 1 check failing (test). A merge queue will not merge over a check the branch broke — if
> it is a flake, that is your call.

There is one check here and it is called `test`, so `(test)` is not a fact about this
branch. And the question it ends on is one the sentence has no way to answer: whether a
red check is a flake or a real break is decided by what is *inside* the run, and the card
names the run and stops. Every instance of it has cost somebody two commands and a trip to
GitHub — `gh run view <id> --log-failed`, then twenty lines of scrolling — to find out
whether to press Merge.

**The second half is worse than the first, because the queue had already answered it.**
`newlyFailing` in `lib/mergeadvocate.js` runs immediately above that sentence and its whole
job is to separate what the branch broke from what it inherited from a red base. By the
time the refusal is written, `fresh` is the names the branch is red on that the base is
green on — the flake reading is the one thing the gate has just ruled out, and it was then
offered unconditionally. On bc-n21dy (#543, 2026-08-21) taking it would have merged a bare
`fs.rmSync` in a teardown, which `test/tmpadoption.mjs` enumerates every suite on disk to
catch — so accepting the flake would have turned `main` red for everybody at 365 of 382.

So two things changed, and the smaller one is the one worth reading twice.

**The flake is offered only where it is still available.** Where the base was measured and
is green on this check, the refusal says so — *"The base is green on it, so this failure
came in with this branch"* — and stops there. Where the baseline could not be read, or
where the base positively runs no checks at all, the old sentence stands unchanged, because
in both of those the queue genuinely cannot tell. That distinction is the whole guard:
a base with no CI reports no failures exactly as a green base does, so `baseHasChecks`
has to be positively **true** before the queue is allowed to call it green. Saying less
than it knows is what it costs to never say more than it knows.

**And the card carries what the check said.** When the refusal is about a check the branch
broke, the tick that refuses fetches the failing job's log, drops everything in it that
reports something *passing*, and keeps the last twelve lines — capped at 160 characters
each and 900 in all, because this is read on a phone. Dropping the passes is the whole of
what makes it useful rather than merely short: a test runner's last screenful is
overwhelmingly ticks, and on the run this was written against the failing assertion was
twenty lines above the end. A plain tail names the suite; this reaches the assertion, the
file, the line, the offending source and the remedy — 774 characters out of a log of
16,149 lines.

    ── [365/382] test/tmpadoption.mjs
    removing a scratch config dir goes through test/helpers/tmp.mjs
      ✗ 1 bare removal(s) of a scratch config dir
          test/labelchip.mjs:136  (root: tmp)
            fs.rmSync(tmp, { recursive: true, force: true });
          Use test/helpers/tmp.mjs: `await cleanupTmp(dir)`, or `removeTreeSync(dir)`
    1 of 13 failed
    test/tmpadoption.mjs failed (exit 1) — stopped at 365 of 382

**The log and not the annotations**, and that is a measurement rather than a preference.
A check run's annotations are the obvious place to look and they are free of the download —
on the run above they are two rows, one a Node deprecation warning and the other
`Process completed with exit code 1.`, which is the same non-answer the refusal already
gives. The answer is in the log or it is nowhere.

**Read once per refusal, not once per tick.** The download is the whole failing job's log —
about two megabytes here — so it is fetched only when the verdict names a check the branch
broke (`broke`, which `gateVerdict` leaves empty on a conflict, a timeout and everything
else GitHub refused), and only when the refusal has *changed* since the one already on the
merge-bead. A refusal the queue is going to repeat verbatim for three ticks has nothing new
inside it. Every failure along the way is an empty excerpt and a refusal exactly as it was
before: a link that is not an Actions run, `gh` refusing, a timeout, an empty log. Nothing
here may turn a merge into a failure.

**It rides on the bead in its own field, beside the refusal and never inside it.** Two
reasons, and both would be invisible if it were folded in. `record` in `lib/mergequeue.js`
decides whether to spend an attempt by comparing this tick's refusal against the stored
one, so an excerpt a network hiccup dropped for a single tick would read as a brand-new
refusal and the pull request would sit at one attempt for ever, never reaching the three
that turn it into a card. And the block collapses `refused` onto one line, which is exactly
what a log tail must not be. `failure` is therefore a list of lines, which is the shape that
round-trips through YAML without anything to be wrong about — and while fixing the
comparison, `refusalKey` now cuts both sides the way the block cuts the stored one, so a
refusal long enough to be truncated still ejects after three. That was latent before this
and the new sentence is longer.

The card draws it as an **indented** code block rather than a fenced one, because a card's
options are a ```` ```decision ```` fence a phone parses into buttons, and a log line that
happened to begin with three backticks would close a fence it never opened.

`test/mergered.mjs` is the suite. It pins the two directions of the flake guard against
each other, that `broke` stays empty on every refusal with no check behind it, that the
excerpt reaches past twenty passing lines to the assertion, that it survives the round trip
through the bead's notes, and that the log is read once and drawn from the bead rather than
fetched again when the card is raised.

### When `main` itself is red — the queue holds, and something is put on the fix

The gate above asks one question about every pull request: *did this branch break
something the base was not already breaking?* A check that is red on the base is red on
every branch cut from it and therefore says nothing about the branch, so it is not counted.
That is right per branch and wrong as a standing condition. On 2026-08-17 `main` went red
at 13:49 and **ten merges landed on top of it**, every one inheriting the red, because
nothing anywhere was asking the other question: *is the base itself broken?*

So there is a second rule beside the first, and it is Adam's own runbook made automatic:
**keep merging over a red base, but only while somebody is actively fixing it.**

Every tick, per repository and per base:

- **The base's own checks are read.** Failing, and the queue **holds**: no merge, no
  downmerge, no resolver — every one of those is preparation for a merge that is not
  happening this tick, and bringing a red base into a branch only re-runs its CI against a
  base that is about to move again. Nothing is refused and no attempt is spent: a hold is
  a wait, exactly as a pending check is, and the retry budget counts refusals.
- **A P0 is filed, once,** naming the failing checks as GitHub reported them that minute —
  and a window is opened on it immediately, *past the workspace advocate even if that
  advocate is paused*. That is the whole point of doing it here: the only per-worker lever
  there is would be pausing advocates, and pausing them to stop the queue would also stop
  the fix being dispatched.
- **The fix's own pull request still merges.** A pull request whose work bead *is* the P0
  is the single exemption from the hold — without it the repo wedges, since the base stays
  red for exactly as long as nothing can land. A fix that lands under some *other* bead is
  still one tap away on the pull request board, because the hold lives inside the queue and
  touches none of the doors a person merges through.
- **And it lifts by itself.** The next tick that finds the base green closes the P0 and the
  queue carries on. Usually nothing has to close anything: the merge of the fix closes that
  bead as its own work bead, and the hold is simply not found on the tick after.

There is **no record of any of this on disk**, deliberately. A hold is exactly *"GitHub
says this base is failing and there is an open bead about it"*, both read this tick — the
same argument the queue itself makes for deriving its contents from the tracker rather than
from a list of windows, and the one `lib/sweepcard.js` learned the hard way when eight of
thirteen cards outlived the record that was meant to find them again. The bead is found by
its exact title and its `red-base` label, which makes the title load-bearing: retitle it by
hand and the hold stops being recognised, so the bead says so in its own body.

Two readings that cannot be taken decide nothing. `gh` failing to answer is **not** a red
base — that would file a P0 and open an unattended window over a rate limit — and it is
**not** a green one either, which would lift a live hold and close a bead somebody is
working. A base whose checks are still running is unknown in the same way, and it has to
be: `main`'s checks re-run on every merge, so treating pending as green would drop the hold
in the window between a push and its first red check, every single time.

**A base with nothing queued against it is watched too**, on a five-minute clock, wherever
a workspace is one repo — because the queue's own reading only happens where a merge is
about to happen, and `main` going red on an evening when nobody is delivering is exactly
the case that went unnoticed for four hours. In a workspace of forty checkouts asking all
forty on the same clock would be the wrong trade — forty `gh` calls every five minutes to
answer a question that matters at one of them — so there it is narrowed instead of skipped:
`watchQueuedBases` asks only the repos the pull request board already says have something
*open* against them, whether or not the merge queue has been handed anything to deliver yet
(bc-xl7n.103). That board is a screen kept warm for its own reason and its cache is what
this reuses, so the narrowing costs no `gh` call of its own — a repo with an open pull
request nobody has queued for hours is no longer invisible to this runbook just because it
shares a workspace with thirty-nine others that are quiet.

`lib/redbase.js` is the decision — pure, and driven state by state in `test/redbase.mjs`;
`lib/mergequeue.js` holds; `lib/server.js` is the wiring onto `pr.baseChecks`, `bd.create`,
`bd.close` and the same door `POST /api/session` opens. The queue's own line says
`N held — the base is red`, and every held pull request carries the sentence in its state
block, naming the bead that is the fix — which is what puts it under *Resolving issues* on
the queues board, whose note is already the right one: *something outside the queue has to
move before it can merge*.

### And the wait the hold leaves behind gets a producer

The hold above lifts by itself, and that is not the whole of what a red base costs. GitHub
builds `refs/pull/N/merge`, so every check that ran while the base was broken is a verdict
on *a merge with a broken base* — and it stays on the pull request afterwards, because
nothing re-runs it. Judged against a base that is green again, that stale red reads as a
failure the branch introduced. #475 and #488 were both condemned that way on 2026-08-18,
neither having ever been broken.

So the lift stamps `heldUntil`, and the gate answers a run that finished before it with a
**wait** rather than a refusal: *"its checks last finished before the base came back, so
they are a verdict on a base that is no longer there rather than on this branch. Nothing is
counted against it until they have run again."* It costs no attempt, which is right —
nothing has been asked of this branch since the base came back.

**Nothing ran them again.** The sentence's own docblock names the downmerge as what ends
the wait, and stakes the safety claim on it: *a branch whose checks predate the repair is
behind the repaired base by construction*. The git relationship is exactly that. **The
field the downmerge tested is not.** `mergeStateStatus` is GitHub's *mergeability* state,
and `BEHIND` there does not mean "the base has moved" — it means "the base has moved **and
this repository refuses a merge until you update**", which is only ever true under a
branch-protection rule requiring branches to be up to date. `NeanderthalMan/beadcause` has no
protection at all (`gh api repos/NeanderthalMan/beadcause/branches/main/protection` answers *403
Upgrade to GitHub Pro* — a private repo on a free plan cannot carry one; the old
`olduser/beadcause` home answered *404
Branch not protected*), so GitHub reports `CLEAN` however far a branch drifts and that arm
had **never executed once**: `grep -c "brought .* into "` over 209,308 lines of the daemon
log was `0`. Nothing else re-runs a check either — there is no `gh run rerun` anywhere in
`lib/` or `bin/`, and nothing on the queue path pushes.

A wait with no producer is a deadlock wearing a wait's clothes, and this one was invisible
by construction, which is why it lasted five days. Because it deliberately costs no
attempt it never ejects to a card, so it is not on the inbox and not in `givenUp`; the only
trace anywhere was one log line per tick per branch. Twelve pull requests were held in a
single tick — #652, #701, #702, #703, #717, #718, #719, #720, #731, #767, #772, #773 —
four of them children of one epic, one of them **approved by Adam a day earlier**. And the
repo looked healthy the whole time: ten pull requests merged normally the same afternoon.
**It is a graveyard, not a jam** — anything delivered *since* the base moved gets fresh
checks and lands, so new work flows straight past a cohort whose checks are pinned to a
base that is gone and which can never leave. That asymmetry is the whole reason nobody
noticed, and it is still the most likely way this gets read as fixed while every held pull
request stays held.

**The reading is taken in the checkout instead.** `behindBase` is `rev-list --count
<head>..<base>`, which has no protection rule attached to it — it is the git relationship
the docblock already reasons about, asked of the repo the queue is holding anyway.
`origin`'s copy of the base first, for `pickBase`'s reason: local `main` on a Mac running
twenty sessions is routinely behind the thing it is being compared against. And `null` is
*could not tell* — a head this checkout has never fetched, a base ref that is not here, a
directory that is not a repository — which must never read as zero: the caller waits rather
than spending a GitHub write on a guess.

**Only the stale branch uses it, and that boundary is the design rather than caution.**
Widening the `BEHIND` arm to the git reading would be the obvious change and the wrong one:
on a `main` that moves twenty times an hour *every* queued branch is behind it, so every
one of them would take three fresh bases and three CI runs before the queue ever got as far
as judging it — which is precisely the starvation `MAX_DOWNMERGES` was written about, and
being behind is not by itself a reason GitHub refuses a merge. A branch whose checks are
current is therefore judged exactly as it was. Both readings stay, because they answer
different questions: GitHub's says *this merge needs an update*, and this one says *there is
something to bring in*.

It is bounded by the same counter, and there is one deliberate difference from the arm
above: **the charge is spent on the ask rather than on the success.** Up there a refused
update is usually a race with somebody else's merge landing a second earlier and the next
tick asks again. Here git has already said there is something to bring in, so an update
GitHub will not perform is a standing condition — and not counting it would spend a write
every thirty seconds for ever. Still no *attempt*, unchanged: nothing has been asked of
this branch's diff, so nothing has refused it.

**And the hold that remains says so out loud.** The tick counts it apart from `waiting`,
because it is the one wait here that nothing else would ever move, and names the pull
requests rather than tallying them — *"merge queue: 4 held on checks older than the base
(#652, #717, #718 and 1 more)"* — for the reason the line names the ones in line for a
window: "which ones" was exactly what nobody could answer. A branch that has had its base
brought in three times and is *still* stale is no longer waiting on the queue at all, and
that list is the only thing that would say so.

**And `could not tell` was itself a permanent answer, because nothing on this path ever
fetched.** The reading is taken in the checkout, so it can only be taken of a commit the
checkout has — and much the commonest null is the cheapest of the three to fix: a head that
has simply never been fetched. Measured on 2026-09-20, in one tick: **6 downmerged, 28 held
on checks older than the base.** Every one of the six was logged by *worktree name* — a
session was sitting on the branch, so its head was local and the drift was computable — and
all 28 of the others by pull request number alone. A dry-run fetch from the main checkout
listed every one of those heads as pending, 33 refs in all. So the remedy the wait promises
was skipped for the branches that needed it, the null was not a one-tick answer but a
standing one, and the next tick asked the same unanswerable question. Four children of one
epic were in that state, at `attempts: 0`, which is to say on no card and no list.

**So the stale arm refreshes `origin` and asks again** — once per checkout per tick,
memoised on the promise rather than the result so a second branch waits on the first
rather than starting another; only on the null, because a branch that answered a number
needs nothing; and only where the downmerge budget allowed the ask in the first place, since
a network read for a reading nobody is going to take buys nothing. A whole fetch rather than
the narrower `fetch origin <sha>`, and that is the point rather than laziness: `behindBase`
counts `<head>..origin/<base>`, so a stale `origin/main` **under-reports** the drift and can
answer a confident `0` for a branch that is genuinely behind — the same silent hold wearing
a different hat. One fetch answers both halves, and on the day this was measured that was
one network read against 28.

**It keeps a floor of two minutes across ticks, which the per-tick memo cannot give it.** A
head that is on no `origin` ref at all — a fork, a branch deleted under an open pull request
— cannot be fixed by fetching, so it asks every tick for as long as it is queued; at the
default `pollSeconds` of 30 that is 120 whole-ref-store fetches an hour, in a checkout well
over a hundred worktrees share, and the cost there is the ref-store locks rather than the
bytes. `refreshRemote` in `lib/prboard.js` keeps a `lastFetch` map against exactly that and
holds a single ref to one fetch every two minutes, so this keeps the same floor at the same
cadence — comfortably under `REPROBE_INTERVAL_MS`, so a branch due for a re-probe is never
what the floor makes wait. Inside the floor it reports what the last fetch reported rather
than a flat failure: the question is whether `origin` is as current as a fetch would make
it, and thirty seconds after a successful one it is. That is what keeps the tick's sentence
honest — a head still missing against a freshly-read `origin` is genuinely not there, and
*"could not refresh origin"* about it would send a reader after the wrong thing.

**What is still unreadable afterwards is named rather than merely counted.** `out.unmeasured`
is a subset of `stale` and not a rival to it — same verdict, same count — but the two want
different acts: `stale` is a wait the downmerge ends, and this is a wait with no remedy at
all, so the tick says *"N whose head this checkout cannot see (#x, #y)"* and the per-branch
line names the head and states that the refresh had already happened. **The condition is
intermittent, and that is the shape of it rather than a refutation.** The rescue was always
incidental: `lib/prtree.js` and `lib/candidate.js` both fetch by sha for their own purposes,
so a head the queue could not see at 16:16 is often in the object store by evening, hours
after the tick that could have used it — 149 occurrences of *"this checkout cannot say"* on
2026-08-26/27, none for three weeks, then 26 more in two minutes. One last honesty: while
the Actions quota is out, a downmerge pushes, CI is refused a runner in seconds, and the
branch is then red against a base `lib/basegate.js` has just called green from a local gate
run — so this converts a silent permanent hold into refusals and inbox cards. That is more
honest, not more merged.

`node test/mergequeue.mjs` drives both arms of the reading and the bound, and it starts
from the case a suite over a red branch would have missed: #717 was `test: SUCCESS`,
`MERGEABLE` and `CLEAN`, held purely because its green run finished on the wrong side of a
hold. `node test/lapsedrefusals.mjs` still owns the verdict itself.

### Most conflicts never happen — four registries git is told to merge both ways

A resolver is the right answer to two branches that disagree. Almost none of the conflicts
here were that.

Measured on 2026-08-26 by merging all 34 open pull requests onto `origin/main` in a
scratch clone, in the order they would have reached the head of the queue: **13 of the 34
conflicted**, and the files they conflicted in were `lib/grants.js` ten times,
`lib/toolbelt.js` five, `package.json` and `package-lock.json` twice, `README.md` three —
and `lib/server.js` **once**. That last one is the only conflict in the whole set where the
two sides had anything to say to each other. Every other one was both sides adding a line.

The reason is that adding one `b7e` tool is mostly new files — a `bin/b7e-X`, a `lib/X.js`,
a `test/b7eX.mjs`, none of which anything else has ever seen — plus one line in each of
four lists that every other branch in flight is also appending to. And there is only one
place to put each line: ten of the fourteen branches touching `lib/grants.js` insert at
line 333, after the last `b7e` grant. So one of them landing conflicts the other nine, not
by bad luck but by construction, and each of those nine costs [a resolver
window](pull-requests.md#a-conflict-is-work-so-it-gets-a-session) — one of this Mac's two session slots —
plus a full `npm test` re-run, to add a line nobody had to think about.

`.gitattributes` is four lines and it is the whole fix:

    lib/grants.js      merge=union
    lib/toolbelt.js    merge=union
    package.json       merge=union
    package-lock.json  merge=union

`union` is git's built-in driver for exactly this shape: where both sides added lines in
the same place, keep both, in that order, rather than stopping to ask. Re-running the same
34-branch simulation with those four lines took the conflicts from **13 to 4**, and all
four survivors are `README.md`. The tree it produced was right rather than merely
parseable — 112 bin entries with no duplicate anywhere, both registries parsing, and
`test/grants.mjs`, `test/loadorder.mjs`, `test/lockfile.mjs` and `test/anchors.mjs` green
over the whole 30-branch merge.

**What union costs is that it is silent.** Keeping both sides is right when both sides
*appended*. When the two sides *edited* the same line — two branches moving one grant from
`read` to `write` — union leaves the key in the file twice, and a JS object literal and a
JSON object both keep the last and discard the first without a word. The file parses, the
suites pass, and one of the two branches has quietly lost.

Nothing here could see that, and `test/grants.mjs` structurally cannot: by the time it
holds `GRANTS`, the duplicate has already collapsed. So `test/unionmerge.mjs` asks the
**source text** instead, and asks it the same way in all four files — more keys in the text
than in the parsed value means one was swallowed. It fails the repo on a duplicate in any
of the four, checks that `package-lock.json`'s copy of the bin map still names exactly what
`package.json` does (union merges the two independently, so divergence is the new failure
mode this introduces), and cross-checks every count against the module rather than trusting
its own regex, because a scan that quietly stops matching passes forever over nothing.

**The documentation is deliberately not on the list**, and it is what conflicts second
most often. Since bc-28jtc that is `docs/*.md` rather than `README.md`, which is now an
84-line summary; the decision covers both, because it was never about the size. All of it
is prose. A duplicated list entry is something
a scan can see and now reddens a suite; a duplicated *paragraph* in 2.6MB of documentation
reads as writing, and there is nothing anywhere that would catch it. A conflict in a
document is a question worth stopping on.

**Which is why the documentation was given one file per tool instead — bc-fmk4v.** The
sentence above used to end by saying the `b7e` sections appended at scattered anchors and
mostly merged clean, three of 34. That stopped being true as the family grew: measured on
2026-09-19 over 48 open pull requests, with the union driver honoured locally, **13
conflicted in `docs/b7e-tools.md` and 7 in `lib/tooldecl.js`**, every one of them an
end-of-file append — a new tool's `###` section, and the paragraph arguing for its grant.
Union was still the wrong answer for both, for the reason above and because
`lib/tooldecl.js` is a module that gets restructured rather than a list that gets appended
to (`.gitattributes` says what union costs a file like that, at length). The right answer
was to stop writing to a shared file at all: each tool's section is `docs/b7e/<name>.md`
now and each grant argument lives in the tool's own header, so adding a tool touches new
files plus the two union'd bin maps. `test/pertoolfiles.mjs` keeps both anchors empty.
And `package.json`/`package-lock.json` are unchanged, still union, still the only shared
lines a new tool writes.

This narrows what a resolver is for rather than replacing it. The conflict that is left is
the `lib/server.js` one, where two branches really did edit the same code — which is the
case the resolver was built for, and the only case worth a window.

### A clean downmerge does not pay for the gate twice

Bringing the base into a branch re-runs its checks, and the queue's second outcome ends
the tick there — judging the old ones would be judging a diff that no longer exists.
That is the right instinct and it has a price nobody was reading. `MAX_DOWNMERGES` is 3,
`main` here takes about forty merges a day, and a branch that sits in the queue for two
days can therefore pay for **three whole gate runs over a diff that never changed**.

`trustChecksAcrossDownmerge` is a repo declining that bill. With it on, a downmerge that
GitHub put in **with no conflict**, on a branch whose checks were **already passing**,
carries straight on to the verdict and merges on the same tick.

Three conditions, and each is doing work:

- **The repo asked for it.** Off everywhere by default. It is a
  [per-repo answer](asking.md#one-repo-may-answer-for-itself-on-the-six-settings-where-it-matters)
  because the thing that makes it safe is a property of one repo's CI, not of beadcause
  as a piece of software.
- **The downmerge went in cleanly.** `pr.updateBranch` refuses on conflict and says so,
  so reaching the question at all is GitHub reporting the base merged. A conflicted
  branch never gets here: it was handed to a resolver one branch earlier, and that
  resolver's brief still tells it to run the repo's own gate. Nothing here ever decides
  a conflict was fine.
- **The branch was passing, positively.** Not *not failing* — `rollup` reports four
  states and two of them mean nothing ran. `pending` is a run in progress and `none` is a
  head commit with no checks at all, which is the shape that
  [condemned #480](#a-red-check-says-what-it-said--not-just-that-it-was-red). Either one
  takes the old path and waits, which is what it would have done anyway. This can only
  ever shorten the life of a pull request that was already green.

**What it gives up is bc-rcrt's, and it is worth naming rather than burying.**
`.github/workflows/test.yml` runs on every pull request because two branches that each
pass alone can still break `main` together — the merge is a third thing neither of them
tested — and the downmerge is where that gets caught before it lands. Skipping the re-run
takes that risk deliberately.

What makes it bearable is that the catch moves rather than disappears. The same job runs
on `push` to `main`, so a bad pairing reddens the base within minutes, and
[a red base holds the entire queue](#when-main-itself-is-red--the-queue-holds-and-something-is-put-on-the-fix)
and files the bead that is the fix. A repo whose CI does *not* run on its base has no
such second chance, and should leave this off — which it is, unless it says otherwise.

### Where that can fire at all, which is narrower than it sounds

**Not here, and the correction is worth more than the feature.** The arm this setting
answers for tests `mergeStateStatus === 'BEHIND'`, and GitHub only ever reports that value
under a branch-protection rule requiring branches to be up to date. `NeanderthalMan/beadcause` has
no protection rule at all, and on a free plan cannot have one — `gh api
repos/NeanderthalMan/beadcause/branches/main/protection` is a *403 Upgrade to GitHub Pro*
where the old `olduser/beadcause` home was a
404 — so **that arm has never fired on this repo.** A green pull request here is judged and
merged without any downmerge being asked for, and there is no wait for this to shorten.

That is [bc-xl7n.121's finding](#and-the-wait-the-hold-leaves-behind-gets-a-producer), arrived at from
the other direction: it is why `verdict.stale` takes its own reading from the checkout with
`behindBase` rather than believing the field. This setting is therefore **off everywhere,
including here**, and the honest description of it is: a switch for a repo whose GitHub
enforces up-to-date branches, where "the base moved, so run the whole gate again before you
may merge" is a rule somebody else is imposing.

**And it is deliberately not wired into the stale path**, which is the one place a
downmerge really is asked for on an unprotected repo. The checks there are stale in the
precise sense that they are a verdict on a base that no longer exists — bc-91srt, #475,
#488 — so they are exactly the checks that must *not* be trusted across a downmerge. The
one path where this would fire here is the one path where it would be wrong.

### A conflict a resolver will not settle becomes a card

A conflicted branch gets [a resolver](pull-requests.md#a-conflict-is-work-so-it-gets-a-session), and that
window has an honest ending its brief offers it in as many words: *both sides are
load-bearing, and only you can say which one wins.* It stands down and says why on the pull
request. Nothing in the queue could hear it.

The reason is one flag. `resolving` is written when a window goes **up**, and the only thing
that ever took it off was the branch ceasing to conflict — so *a resolver is working on it*
and *a resolver looked at it and declined* were the same state on the bead, and a branch
whose conflict was never going to resolve itself sat in the first of them forever. The
retry budget could not help either, because a resolver spends none of it: `MAX_ATTEMPTS`
counts refusals, opening a window is not one, and the three attempts that carry a branch to
a card were therefore unreachable down the whole conflicted path. #488 collected **nine**
windows on byte-identical state — the branch pinned at the same commit since the first one —
each costing a full session to re-derive the same hand-back, and it escaped in the end only
because its conflict eventually turned into a red check, which is a different path and one
that *does* record.

The loop had a second half that made it faster than one window per stand-down. GitHub
computes mergeability asynchronously and answers `UNKNOWN` for every open pull request for a
window right after a merge lands — which is exactly when this sweep runs — and the check
that cleared the flag read anything that was not `CONFLICTING` as *no longer conflicts*. So
a still-conflicting branch was handed back to the queue on a **non-answer**, went round the
conflicted path again, and got another window. `lib/pr.js` has had the answer to that since
the first week — `mergeability` waits the window out and reports `unresolved` rather than
guessing, and `lib/prsweep.js` routes every candidate through it — and the merge queue had
simply never adopted it. It does now, at a zero timeout, because [a tick does not
wait](#landing-work--a-branch-a-pull-request-and-a-merge-queue): the question is *has GitHub
said anything*, and no is a perfectly good answer that costs one tick.

So the queue asks the one thing the flag cannot say. `resolveFor`'s registry knows which
pull requests have a window on them and which are in line for one of the two slots; a branch
that is in neither, and that GitHub still calls conflicting, has had its resolver **end
without resolving**. That records a refusal like any other — a spent attempt, a sentence on
the bead, and `declined` alongside it so the door does not open again. Three of those and
`raiseMergeCard` hands it to you, which is what the three attempts were always for.

- **The sentence says only what was observed.** *The branch still conflicts with `main` and
  no resolver is on it any more — the window that was opened on it ended without making it
  mergeable.* Nothing here watched a session decide anything, and the queue is in no
  position to claim an intent. It also has to read the **same** every tick: attempts count
  the *same* refusal, so quoting the resolver's own `RESOLVER_SAYS` comment — a different
  sentence each round — would restart the count and never reach the card.
- **Every unreadable answer means somebody is on it.** No checkout, a `gh` that will not
  answer, a workspace whose unit cannot be resolved: each of those leaves the flag exactly
  where it was. The direction is the whole of the safety, because the other one spends an
  attempt on a branch a window may still be sitting in — and `find` in `lib/resolvers.js`
  already believes a handle-less record for half an hour, so a daemon restart does not read
  as every resolver having vanished.
- **`declined` is a sentence the queue can take back.** The first read that says the branch
  no longer conflicts clears it, on [the hold's](#when-main-itself-is-red--the-queue-holds-and-something-is-put-on-the-fix)
  reasoning: you may resolve it yourself, or `main` may move so that it no longer collides,
  and a flag left standing would refuse a resolver to a *new* conflict months later over a
  window that stood down from a different one.
- **And `/merge` re-arms one rather than merely approving it.** A declined bead still looks
  perfectly queued — the label, the assignee, attempts to spare — so the obvious reading
  made the tap record an approval and change nothing, on the single bead whose whole point
  is that only you can unstick it. It is admitted instead: the flag goes, the attempts reset,
  and the next tick opens a resolver on a conflict a person has now looked at.

`lib/mergebead.js` carries the field, `lib/mergequeue.js` decides, `lib/server.js` wires the
registry read beside the one that opens the window, and `test/mergequeue.mjs` drives both
halves — including two consecutive ticks on what the first one actually wrote, which is the
only honest way to assert that the sentence is stable enough to count.

### The reviewer — a seventh agent kind, and the diff nobody reads

Everything above judges a pull request by what *happened to it*: whether it conflicts,
whether a check went red, whether the base was already red there. Nothing reads the diff.
On a Mac where the author is an agent and the approver is a queue, the change itself is
the one thing in the whole path that no second party has looked at.

So there is a **ReviewAdvocate** — a seventh kind in `lib/foundation.js`, beside the merge
queue rather than inside it. The difference between those two agents is their permissions
and not their code path, which is what makes it a kind rather than a mode: the merge queue
may push, may merge to `main`, and is the only thing here that closes a work bead. The
reviewer may do none of that. It reads the diff, says what it thinks, and the one thing it
may write is the comment its verdict goes in. A reviewer that could merge the branch it had
just approved would be the same self-certification that was taken away from the worker,
arrived at from the other end.

**Its output is a verdict, and a verdict is a document.** The comments it raised, whether
it approved, and — when it did not — why. `lib/reviewadvocate.js` owns that shape, which is
what `protocolOwner` means and why the field points there. It is written the way an epic's
plan is written: a fenced JSON block between `<!-- beadcause:verdict -->` markers, in a
**comment** on the merge-bead, under a sentence a person can read. Comments are append-only,
so a verdict cannot lose a race with the daemon rewriting `notes` in the same minute; the
round before this one stays on the bead, which is the only record of what the reviewer
objected to before the worker answered it; and every surface that draws a bead already draws
comments, so a review is readable on the phone with no new screen at all.

The markers are `beadcause:verdict` and deliberately **not** `beadcause:review` — that name
belongs to the review *state* block on the merge-bead's `notes`, rewritten every round and
outliving admission. Two documents under one marker is a parser that reads whichever field
it happened to be handed.

**Severity is a closed vocabulary, because the only reader that matters is a machine.**
`blocking`, `suggestion`, `question`, and nothing else — an unrecognised one is refused
rather than coerced, since defaulting it to `blocking` lets a typo hold a branch for ever
and defaulting it to `suggestion` waves a real objection through. `blocking` is a promise:
this branch must not merge as it stands, so it belongs to correctness, data loss, a security
hole, a broken contract with a caller, or a test that does not test what it claims. Style and
taste are suggestions, and something wrong in the code the change landed *next to* is a bead,
not a review comment. The brief spends its longest paragraph on that, because an agent asked
to review a diff will find something to say about every hunk of it, and a review that raises
eleven comments costs somebody eleven answers — as a round, when they are blocking, and as a
follow-up bead nobody can triage when they are not.

**And since bc-9ntye that promise is the whole of the veto, which is what makes the brief's
wording load-bearing rather than decorative.** A `blocking` comment is the only thing that
holds a merge; a verdict carrying nothing but suggestions and questions merges on the sweep
that reads it, and those comments are filed as work of their own instead of coming back as a
round. So the brief has to carry both halves at once, because they fail in opposite
directions: a reviewer that goes on calling taste `blocking` jams a queue dozens of pull
requests deep exactly as before, and one that stops reaching for it on a real bug ships the
bug, since nothing further down the path reads the diff. What it says now is that nothing is
lost by not holding the branch — the point survives as a bead either way — and that
`approved: false` is not a quiet veto, so what the reviewer means belongs in the severity
rather than in the flag. The reviewer's foundation in `lib/foundation.js` says the same rule
in its own words, because the brief is what the agent was asked this run and the foundation is
what it is on every one — and an agent handed both rules at once picks whichever it read last.

**The brief is not a thin wrapper around `/code-review`, and it does not skip it either.**
Round one's instruction is to run the skill first, over the diff, and treat what it returns
as findings to triage into the severity vocabulary above — not as the verdict itself, since
the skill hunts bugs, reuse and simplification issues with no notion of what the pull
request's bead was actually asked for. That second question is the reviewer's own, every
round: read the bead's acceptance criteria off `bd show` and judge whether this diff
delivers them, separately from whatever `/code-review` found. A diff can be clean and still
not be the thing the bead asked for, and that is a `blocking` comment of its own — an
approval an agent could reach by running the skill alone and never checking the bead at all.

Three shapes are refused outright, and each is a verdict something would act on *wrongly*
rather than reject:

- **Approved with a blocking comment on it.** The gate reads `approved` and the worker
  reads the comments, so a verdict saying both merges the branch while telling its author it
  must not. Which half to believe is not a default anything should pick.
- **A refusal that never says why.** That is a round spent on a worker guessing.
- **Two comments sharing an id.** The worker answers comments by id and the next round
  matches its answers back, so one answer would silently resolve both — the failure that
  looks exactly like agreement. A *missing* id is numbered instead, because bookkeeping is
  not worth a round.

**Two rounds, and then it is Adam's.** `MAX_REVIEW_ROUNDS` in `lib/mergebead.js` is two —
review, answer, re-review, escalate — because "repeat until there are no unresolved
comments" is unbounded as written, and a reviewer and a worker that genuinely disagree do
not converge by being asked again: they burn a session per round per side, for ever, and
from outside that is indistinguishable from the pull request being stuck. At the cap the
unresolved comments **escalate rather than lapsing into an approval**, or the loop would
reward a worker for holding out for two rounds. A reviewer that refuses outright does not
wait for the cap at all — asking a worker to answer comments nobody will accept is a round
spent on nothing. Either way the escalation is the merge-bead *becoming* the card, through
the same `raiseMergeCard` a refused merge and an approval wait already go through: one
bead, one blocker, one tap, for the reason in bc-ec6.

**A verdict also records the commit it was given for.** The review state block carries the
pull request's head sha at the moment the reviewer wrote it down — for every verdict, not
only for an approval, since that is the only way a later round can tell whether the worker
pushed anything in answer or answered in prose. It matters here more than it would
elsewhere: this repo has no branch protection, so GitHub does not dismiss an approving
review when new commits land, and without the sha an approval given for one diff would sit
there gating the merge of another. Adam's rule is that only a **worker's** push sends it
round again — a resolver bringing `main` into the branch is not a change to the proposal.

**What exists today is the kind, its verdict format, the brief it argues from, the round cap
and the commit a verdict records, and the approving review a verdict turns into** — which is
[further down](#approving-it-and-saying-on-the-page-that-an-agent-did), because who is
allowed to leave a review here has to be settled first — **and the worker's side of the
round**, below.

**The gate is below**, and it is what makes a verdict mean something to the merge; the
[window](#one-reviewer-per-pull-request--the-window-the-daemon-opens) that opens a reviewer
on a delivered pull request is below that. What is still missing is the step *after* the
verdict: nothing reads a verdict comment back onto the merge-bead's review block, so a
review that happens is a review the gate cannot see — which is why the gate is still
switched off in every workspace.

### The review gate — nothing reaches the merge without a verdict

Everything the queue asks about a pull request, it asks about what *happened to* it: does it
conflict, did a check go red, was the base already red there. So the sentence every worker is
briefed with — *the ReviewAdvocate reads what you delivered and either approves it or leaves
comments on it* — described something that did not happen: the kind, the verdict format and
the brief all existed, and the queue went straight past them to the merge.

So the queue asks one more question first, and it asks it **before the downmerge**: *has
anybody looked at this?* Off the review block on the merge-bead, which is where a review's
state lives between rounds.

| what the block says | what the queue does |
|---|---|
| nothing yet | waits — no downmerge, no resolver, no merge, and **no attempt spent** |
| comments the worker has not answered | opens the worker's window again on the same branch, and waits |
| every comment answered | waits, because settling a comment is the reviewer's to do and not the worker's |
| approved, for the commit that is on the branch | carries on to the checks exactly as before |
| refused, or two rounds without agreement | hands it to you as a card, with the reviewer's own sentence on it |

It sits above the downmerge for the reason
[the hold](#when-main-itself-is-red--the-queue-holds-and-something-is-put-on-the-fix) does:
everything below that point is preparation for a merge that is not going to happen this
tick. Bringing the base into an unreviewed branch re-runs its checks and moves the diff
under the reviewer, and handing its conflict to a resolver spends one of this Mac's two
windows on a rebase that will want doing again afterwards.

**Waiting is not refusing, and the difference is the same one the approval branch keeps.**
Nothing was asked of the branch, so nothing refused it: the merge-bead carries a sentence
saying what is being waited *for*, the queue's line reads *N awaiting review*, and the three
attempts that carry a real refusal towards a card are untouched. It is also a sentence the
queue has to be able to **take back** — a branch that was only ever waiting for a reviewer
has no verdict of its own to write over it, so without that, *nothing has reviewed this*
would sit on a merged-and-approved bead reading as its own problem.

**An approval is for a commit, not for a branch.** This repo has no branch protection, so
GitHub does not dismiss an approving review when new commits land — and a resolver may push
to a pull request after it is queued, which at sixty-odd merges a week happens to nearly
every approved branch before it lands. An approval given for one diff would otherwise sit
there gating the merge of another. So the review records **which commit it was given for**,
and the queue compares that against the head:

- **A downmerge leaves the approval standing.** Merging `main` in is not a change to the
  worker's proposal, and a gate that counted it as one would send every pull request round
  again forever with nothing changed.
- **A worker's push sends it round again**, because that *is* the proposal changing.
- **Anything that cannot be established holds the merge** — an approval with no commit on
  it, a comparison GitHub will not make, a history that diverged. Each of those is *we
  cannot say what was approved*, and each of them is one force-push away from being how a
  diff gets past a reviewer.

A merge commit is a downmerge and a single-parent commit is the worker's own. Nothing
records *which agent pushed* — every session on this Mac pushes as the same identity, and a
resolver's downmerge and the queue's own arrive alike as merge commits — so the shape of the
commit is the whole of the available evidence, and it happens to be exactly the property the
rule is about. The residual risk is accepted and deliberate: a resolver that resolves a
conflict badly ships code no reviewer saw.

**Two gates in series, and neither substitutes for the other.** Where a space also
[asks for your approval](asking.md#spaces--keeping-work-out-of-your-evening), an agent's approval is
necessary and not sufficient — it still comes to you, and you still admit it. Everywhere
else the agent's approval alone releases it. And **a pull request you opened yourself is
never review-gated**: it goes to the queue exactly as it did before, as does one you have
already admitted with **Merge**, because a person's look outranks an agent's and that tap is
what unsticks this queue when the loop itself has gone wrong.

**Off in every workspace until something is actually reviewing there** — `reviewRequired`,
per repo, per space, or globally as `pr.reviewRequired`. It is the one policy default here
that is dangerous the other way round: the gate *holds* a pull request until a verdict
appears, so turning it on where nothing writes one does not slow the queue down, it stops it
— every branch at once, quietly, each merge-bead saying only that nothing has reviewed it.
**It is on in this repo now, and the loop has closed live.** `reviewRequiredPerWorkspace`
gained `{"beadcause": true}` on 2026-08-23, and within the hour the whole thing ran against
real pull requests without anybody watching it: #618 was reviewed, approved by
`NeanderthalMan` at 16:11:58Z under a body that opens *"Approved on #618 by the
ReviewAdvocate — an agent, not Adam"*, and merged six seconds later with both beads closed;
#617 the same at 16:14:35Z. #539 took the other branch — a *changes* verdict with three
comments, and the worker's window opened on it. That is every arrow in the table above
drawn by the daemon rather than by a suite, and it is the evidence bc-36xx was waiting for.
[The whole loop is also driven end to end in one suite](#the-whole-loop-in-one-suite--delivered-reviewed-answered-approved-merged),
with the flag on, so the join stays pinned when nothing happens to be in the queue.

### One reviewer per pull request — the window the daemon opens

A kind, a verdict format and a brief are three things nobody has been handed. Until this
existed nothing in either tree imported `lib/reviewadvocate.js`: the brief was written,
tested, and never given to a window, while the worker's own brief promised every delivery
that a ReviewAdvocate would read it.

So the sweep opens one. The gate above already decides *whether a review is what this pull
request is waiting on*; where it says so, the queue opens a window on the merge-bead as
`review-advocate`, in the checkout the branch is actually in, briefed by
`reviewAdvocatePrompt` and told which round it is conducting. `openReviewAdvocateSession` in
`lib/session.js` is the door, and it is deliberately not the one beside it: that opens the
*author* again, with a worker's reach, to answer what this window said.

**Every tick it is owed, and never twice.** The queue sweeps every thirty seconds and a
review is minutes of reading, so the window is opened through the same `resolveFor` registry
the resolver goes through — one window per pull request, two on this Mac at once, a queue
for the rest. Without it a slow review would not be one extra window but one every tick for
as long as the reviewer read, each arguing with the same diff and writing its own verdict
onto the same bead. It is keyed by the pull request rather than by the door, which is the
half a per-door registry would have missed: the reviewer and the worker answering it can
never be open on one branch at once, and an author editing the diff underneath the reviewer
reading it is not a race anything downstream could recover from.

**Nothing is flagged on the bead to remember that a window went up**, and that is the same
argument the gate makes for asking GitHub rather than trusting `resolving`: the durable
record of whether a review is owed is the review block itself, and it stops saying so the
moment a verdict lands. A flag would be a second answer to a question already answered, and
a wrong one after a restart.

**A restart forgets which windows are open, and does not open a second one anyway.** The
registry is this daemon's memory and the daemon restarts on its own merges several times a
day. What survives is the record it wrote to disk: those come back with no handle, and a
record with no handle still *holds* — the door answers "there is a window on your screen and
it cannot be typed into" rather than opening a second one at the same diff, and ages out
half an hour later. Nothing here invents a second answer for it, because where a review
actually got to was never in the registry.

**A tick that cannot open one refuses nothing.** No attempt is spent, nothing is written
beyond the sentence already there, and the pull request stays in *awaiting review* — which
is true again in thirty seconds. And `openSessions: false` opens nothing at all, the same
switch every other window in the daemon honours.

**The round it is opened under is the next one, not the last one.** The block counts rounds
*finished* and the worker's answers deliberately never touch that number — the round belongs
to the reviewer's passes. A second reviewer opened under the block's own number would be
handed the *first* round's brief and would re-review the whole diff instead of reading the
answers it was opened to read: the loop that never ends, arrived at by an off-by-one.
`nextReviewRound` in `lib/mergebead.js` is that arithmetic, named because getting it wrong
is silent.

### The verdict comes home — the sweep folds it onto the block

A verdict is a comment; the gate reads a block. Those used to be two different documents
that nothing turned one into the other — `verdictFrom`, `approve` and `approvedReview` all
existed, in lib/reviewadvocate.js, and none of them had a caller anywhere in either tree. A
reviewer would open, read, write its verdict, and the next tick would find a pull request
still waiting for one — for ever, one window at a time through the same registry, because
`review` is exactly the state a delivered pull request returns to once the worker has
answered everything. That was bc-36xx.22, and it is why `reviewRequired` stayed off
everywhere: the gate holds a branch until a verdict *it can see* appears, and a verdict
nothing reads back was not one.

So the sweep reads its own comments back, in the same place it already asks whether a base
is red: right before `judgeReview`, for every merge-bead the gate applies to. `bd comments`
is the one call this always costs there — the durable record of whether a verdict is
waiting is the comments themselves, in the same shape `holdFor` and the gate itself already
cost a call apiece to answer their own questions — and most ticks land in between reviews,
so most of those calls come back with nothing new to fold in.

**"Fresh" is a round the block has not recorded, not "the newest comment."** A verdict
carries its own round — the one it was opened under, `nextReviewRound` — and the block's
`round` counts rounds *finished*, so a verdict is fresh exactly when its round is greater
than that. Read this way round rather than "the last comment that parses," a tick that runs
a second after the write does not fold the same verdict in twice, and a verdict `checkVerdict`
cannot validate — two comments sharing an id, an unrecognised severity — is nothing fresh
either: the same holding direction `reviewState` itself takes on a block it cannot parse, so
a comment somebody hand-edited on a phone cannot move a gate on its own say-so.

**Folded in one line above `judgeReview`, so a verdict that lands this tick is judged this
tick** rather than costing a whole extra pass waiting for the sweep to notice its own write.
`syncReviewVerdict` (lib/mergequeue.js) writes the tracker and hands back the state it just
wrote; `judgeReview` reads that rather than re-parsing `issue.notes` a second time.

**And the review actually goes out to GitHub, under `reviewerFor`'s identity** — the same
second account `approve` and `submitReview` (lib/pr.js) always needed and, until now,
nothing in this loop ever called. `approve()` for a bare approval with nothing to anchor to
a line; `submitReview()` — general since `#533`, and it was not when bc-36xx.22 was filed —
for anything that carries inline comments, approving or not, because `approve()` has no way
to attach one. A `REQUEST_CHANGES` review with per-line comments is the ordinary shape a
`changes` verdict takes now, where before this only an approval could ever reach GitHub at
all.

**Never `verdict: 'refused'`, whatever a comment says.** `REVIEW_VERDICTS` has three values
and a ReviewAdvocate's own format can only ever produce two of them — `checkVerdict`
validates `approved` as a boolean and, when it is false, `why`; there is no field for "and I
will never approve this at all." The flat refusal is a state the round cap already reaches
on its own (`reviewEscalation`, two `changes` rounds with no agreement) without the fold
needing to invent a faster way to say it from a single comment.

**A second GitHub account nobody promised is the ordinary case on this Mac, and the fold
already handles it** — the same fallback `approve()` and `submitReview()` themselves take.
`submitted: false` still writes the block: the verdict is recorded as approved (or as
`changes`, with the reviewer's sentence), attributed to the agent kind rather than to a
login that was never submitted, and `approvalUrl` stays empty as the tell that nothing on
GitHub answers for it. A recorded approval, never a refused one — `approvedReview`'s own
distinction, now with a caller.

**Left for later, on purpose: anchoring a comment to the GitHub review thread it became.**
`reviewComment` has carried a `threadId` field since `#560` for exactly this — what would
make `resolveThread` callable at all — and this fold does not write it. Submitting a review
with inline comments does not hand back which thread each one became without a second
GraphQL read to match them by path and line, and a guess here would be worse than the gap:
a wrong anchor closes the wrong thread later. Filed as its own question rather than folded
in unverified.

### The worker answers — one window per round, and it may not resolve anything

A reviewer that raises comments needs somebody to raise them *to*, and the session that
wrote the branch has been gone for an hour. So the worker is **reopened per round**: the
ReviewAdvocate posts its verdict and exits, and a window is opened again on the work bead,
on the same branch, with the unresolved comments in its brief (`reviewAnswerPrompt`,
`lib/reviewanswer.js`; `openReviewAnswerSession` is the door). It answers, pushes, and exits too. No
process sits through a round.

That is not a reversal of [the decision that took the merge away from workers](#landing-work--a-branch-a-pull-request-and-a-merge-queue).
Its actual claim was that nothing *outside a session* may hold work in its head, and it
survives here by making the round durable rather than the process: the review block on the
merge-bead is the conversation, and every window that touches it reads it from there. It has
to be that way round, because this daemon restarts itself on its own merges several times a
day — "the worker is still sitting there waiting" was always a claim about a process that
routinely dies.

**Three answers, and there is no fourth that means done.** `changed`, `clarify`, `declined`
— the vocabulary the review block already carries. What the worker may *not* write is
`resolved`: that field is the reviewer's, and `beadcause-answer` refuses an answer carrying
it rather than dropping it quietly, because a session whose `resolved` was ignored believes
a thread is closed that is still open. The worker replies and pushes; the reviewer reads the
replies next round and settles the ones it accepts.

That is also what makes *"any declined comments or further changes must be raised to the
ReviewAdvocate for scrutiny"* true by construction rather than by a second mechanism. A
declined comment is one the worker did not resolve **and cannot**, so it arrives in front of
the reviewer next round on its own; so does a `changed`, because a change somebody made is a
change somebody has to check. `commentsForReviewer` selects exactly that population, and
nothing has to remember to escalate.

**The answers go in through a command, not by hand.**

```sh
beadcause-answer -w beadcause -b bc-dxrt <<'EOF'
- id: c1
  answer: changed
  note: split the parse out so the empty case is one branch
- id: c2
  answer: declined
  note: the caller already holds the lock, so a second one would deadlock
EOF
```

`notes` is one field with two state blocks in it and the merge queue rewrites its own every
tick, so a session composing YAML into it by hand has four things to get right and the
fourth is somebody's review. The command reads the block, applies the answers and writes the
field back through the same cutter every other writer uses. It refuses — with a sentence,
because the caller is an agent that can fix it and run the command again — an id the review
does not carry, an answer outside the three words, a decline with no reason, two answers to
one comment, and an answer to a comment the reviewer has already settled. It takes the
**merge-bead** or the **work bead**, since the id in a worker's head is its own.

**A reply costs nothing on its own.** Nothing here writes `round`, which counts the
*reviewer's* passes — so a worker that answers three times without pushing anything has not
spent a round, and the cap is a cap on reviews rather than on words. What it does check is
the opposite mistake: a `changed` whose commits are still sitting in the worktree is the
worst outcome the command has, because the reviewer then reads the branch as it was and
spends the round disagreeing with something already fixed. When git can answer, an unpushed
commit stops a `changed` (`--anyway` overrides); when it cannot, the check is skipped rather
than failed, because not knowing is not evidence.

**Nothing in this path reopens the bead in the tracker, and that is deliberate.** The
delivery parks the work bead behind the merge-bead, so it is not in `bd ready` and no
advocate tick can pick it up while a review is running — the window is opened directly, the
way a resolver is. The path that *does* have to reopen is the one where you answer a
delivery card with **Changes requested**, and it has to go through `bd.reopenAbandoned`: a
delivered worker's claim is still on the bead, its window is long gone, and a plain reopen is
refused by `bd`. That refusal, logged and then contradicted by the very next line saying the
bead was back in the queue, is how one bead sat frozen and unqueueable for two hours.

And the delivering worker is told all of this **before** it stops, in the paragraph
`landSection` adds to every auto-merge brief: that something reads the diff, that this bead
may be opened again on the same branch, and that answering is those three words. A session
reopened on work it thought was finished, on a branch it does not remember, opens a second
branch — and then there are two.

### The whole loop in one suite — delivered, reviewed, answered, approved, merged

Every suite named above pins one decision with the rest of the world held still: the gate
judges a review block somebody wrote by hand, the fold translates a verdict nobody
submitted, the answer checker checks answers to comments no reviewer ever raised, and the
queue's own suite drives one tick at a time over a merge-bead handed to it pre-baked. Each
is the right shape for what it covers, and **none of them can see the join** — whether the
document one half writes is the document the other half reads, one round after another,
with nothing in between putting the state right by hand.

That is not a hypothetical failure here. It is exactly what bc-36xx.22 was: seven exported
functions, every one of them unit-tested and correct, and no caller anywhere between the
comment a reviewer wrote and the block the gate read. The loop was green in pieces and did
not close.

So `test/endtoend.mjs` is built the other way round from its neighbours: **one mutable
world, and nothing reaches into it except the code under test.** The tracker is a map that
really keeps what is written to it and hands back a *copy* each tick, so anything the sweep
works out and does not write through `bd.update` is gone by the next one — which is the
property the suite exists to hold. GitHub is an object that remembers what was submitted to
it. Then four ticks run, with `reviewRequired` **on**, and between them the two agents are
played straight — the reviewer by writing its verdict through `formatVerdict`, the worker by
going through `beadcause-answer`'s own `checkAnswers` / `withAnswers` / `withReviewBlock`
with only its argv and its `git rev-parse` taken off:

| tick | what the world looks like | what the queue does |
|---|---|---|
| 1 | delivered, nothing has read it | opens a reviewer, no downmerge, no attempt spent |
| 2 | a round-1 verdict with two comments on the bead | folds it onto the block, sends a real *request changes* review with both comments on their lines, opens the worker |
| 3 | both comments answered, neither resolved | opens the reviewer again — settling is not the worker's |
| 4 | a round-2 verdict approving | submits the approval, stamps the bead, merges, closes both beads |

What it pins that nothing else can: that **the two records of the approval do not straddle a
tick** — before tick 4 neither GitHub nor the bead has one, after it both do, and the merge
is on the same pass. One landing without the other is the one way they go on to disagree: a
review on GitHub the bead does not carry is a pull request the gate holds forever under a
green tick, and a stamp with no review behind it is the queue merging on a review nobody can
go and read.

The rest is what the loop would be *wrong* about rather than what it cannot render. `severity`
and `why` survive the round trip, because which comments are blocking is the one judgement the
reopened worker has to make. A worker's answer moves the turn and settles nothing, so a
`changed` goes back to the reviewer like a `declined` does. And the two gates stay in series
end to end: with `requireApproval` on, the same fully-reviewed, green, clean pull request
still does not merge — it comes to you as a card, no attempt spent, the agent's approval
sitting on it — and it is your admission that releases it, after which both stamps are on the
bead, each in its own block, neither having stood in for the other.

### Merging over open findings — a review becomes work, not another round

The loop above is correct and it is expensive. Reviews run at most two at a time here —
`terminalMax` is 4 on this Mac and the other two slots are ordinary work — so review
throughput sets the merge rate, and every round of back-and-forth on one pull request is a
slot fifty-six others are queued behind. The queue's own sweep on 2026-08-24 signed off
with *69 awaiting review against 75 open pull requests*, 57 of which had never been looked
at.

So the rule bc-9ntye changes is *a merge waits for an approval* → **a merge waits only for a
reason it must not happen**. A `blocking` comment still holds a branch and still means what
the reviewer's brief says it means — correctness, data loss, a security hole, a broken
contract with a caller, a test that does not test what it claims. A `suggestion` or a
`question` is meant to hold nothing.

**What holds a branch is `commentsHolding`** (bc-9ntye.1, `lib/mergebead.js`), and the gate
in `lib/reviewgate.js` asks it rather than `reviewApproved`. It is every unresolved comment
the reviewer did *not* explicitly mark `suggestion` or `question` — so a `blocking` one, and
also one whose severity is missing or unreadable, because the cost of holding wrongly is one
round and the cost of releasing wrongly is the bug on main. Under an `approved` verdict only
an explicit `blocking` comment holds, since an approval already says nothing is left and the
only unreadable severities under one predate the field. `commentsForWorker` is the holding
comments the worker has not answered, so a suggestion never opens an answer window, and the
two-round escalation fires only when something still holds at the cap. Any verdict that
leaves nothing holding merges, and the `reviewedSha` comparison now guards that merge for
every verdict, not approvals only: a suggestion-only `changes` verdict is a look at one diff
exactly as an approval is, and a worker's push since it sends the branch round again.

**Two halves, and this section is the second one.** Narrowing what holds a branch is the
gate's own change, described just above; what is documented here is what happens to the
findings a merge goes over, whichever way they got past the gate — a verdict (approving or
not) that leaves only suggestions and questions unresolved, or a pull request you admitted
yourself through `/merge`. They become **work of
their own**: one follow-up bead per pull request per verdict round, with one child per
finding, filed at the moment the branch merges (`lib/reviewfollowup.js`,
`test/reviewfollowup.mjs`).

What went wrong without it is the obvious thing and it is worth saying plainly: the merge
closes the merge-bead, and the merge-bead's notes are where the reviewer's whole verdict
lives. Everything a reviewer raised and nobody had settled went into a closed bead nothing
reads. Turning the gate off would have drained the queue the same night by not reviewing at
all; this keeps every review that is happening now and stops it costing a merge.

Three things about it are decisions rather than implementation, and each is the sort that
looks like a detail until it is wrong:

- **It hangs off neither bead in front of it.** The merge-bead closes with the merge by
  construction, and the work bead closes with it unless it is an epic. An open child of a
  closed parent is [bc-rfnr.7's held-forever bead](#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists):
  under nothing, not parentless by any obvious query, and drawn on every screen as ordinary
  open work. So the parent is the **root the work bead descends from** — `lib/homing.js`'s
  ordinary answer — reached from the work bead's own parent rather than from the work bead,
  because "a root is above itself" would otherwise answer *the P0 task closing this second*
  for a work bead that happens to be a P0. An epic work bead is the one case that answers
  itself, and it needs no special pleading: an epic stays open over a merge, so it is a
  parent that survives.
- **The key is the pull request *and the round*.** `finish` is best-effort from end to end
  and the sweep re-reads the same review block every tick, so a crash between the filing and
  the close brings the next tick back to exactly this state. A `review-followup:<repo>#<n>:r<round>`
  label is asked about over **every** status, closed included — a follow-up that was filed,
  worked and closed an hour ago is precisely the one a live-only lookup would answer *no*
  about. The round is in the key because a pull request that goes round twice and merges over
  what is left of round 2 has genuinely different findings from round 1's.
- **A comment the worker already answered `changed` files nothing.** That change is on the
  branch that just merged; filing it as work is the review loop reopened by the mechanism
  meant to close it. A `declined` **does** file, with the worker's own words on the child and
  a sentence saying that answer was never re-reviewed — it is context for whoever picks it
  up, not a settlement.

**And the epic's advocate is told, when there is one listening** (bc-9ntye.3,
`lib/followupnudge.js`, `test/followupnudge.mjs`). Filing the bead is usually the whole
job: it is open, unclaimed, under a root, which is what `bd ready` means, and the re-entry
sweep opens an Epic Advocate on the *filed* event without being asked. The case neither
covers is the likely one — the root's advocate window is **already live**, because a merge
under an epic is usually an epic that had a worker out. `reenter` will not open a second
window on a root a session already names, and the live one read `bd children` at the top of
its turn and will not read them again; so without a word from the queue the follow-up waits
for that window to end *and* for the three-hour re-entry cooldown. The queue types one
paragraph into it instead, through the same `messageSession` channel a pause uses. "An
advocated epic" is `wantsAdvocate` **and** `isEnrolled` — the pair `advocatedRoots` queues
on, reused rather than re-derived, because `wantsAdvocate` alone is true of every open owned
root including the many nothing has ever advocated, and typing into one of those is a
paragraph about somebody else's epic in an ordinary worker's window. No advocate, no root,
no window, an iTerm that refuses: all of them are silence, and none of them can reach the
two closes. It also lives in `finish` rather than in `afterMerge`, which is what the bead
asked for and is a variant of the ordering below — `afterMerge` fires before the follow-up
exists, so there is no bead id to hand anybody.

Every sentence the merge writes names the bead the findings went to: the report on the pull
request, the merge-bead's close reason, and the comment on the work bead — and, since
bc-9ntye.5, the **landed notification** too. It was the one place that did not, and the
reason was ordering rather than omission: `landedEvent` used to be built and emitted from
the queue's `afterMerge` callback, which fires *before* the `finish` that files the
follow-up — so the bead id did not exist yet at the moment the card was assembled.

The fix keeps `afterMerge`'s own ordering (its comment argues for firing it early on grounds
that have nothing to do with this — the sweep and the local `main` want to happen while the
merge is still fresh) rather than moving it below `finish`. Instead the card moved: a new
`announceLanding(spec, issue, { landed, findings })` callback is called from inside `finish`
itself, right after `followUpFor` mints the bead and `findings` names it, so `landedEvent`'s
`owed` field can carry the same sentence the other three writes already do. `afterMerge`
keeps the sweep and the local `main`; it no longer builds or emits anything. Wired only to
the call `finish` takes from the queue path — a pull request merged outside the queue (from
GitHub or the phone) still gets no card either way, unchanged: that is a tap of yours, and
the comment on `announceLanding`'s own wiring says why it must not chime for it.
(`test/mergequeue.mjs`.)

**The follow-up parent is a bead with a life, and neither end of it was handled** —
bc-xl7n.137. It is filed as a `task`, its body is a list of the reviewer's findings, its
acceptance criteria are literally *every child is closed*, and it has no diff of its own for
`bin/deliver.js` to push. So a worker window opened on it has nothing to do — which happened
twice, both times about three minutes after the last child was delivered: bc-xl7n.131 at
23:33:06Z and bc-xl7n.132 at 00:53:54Z. The hold that should have stopped it is
`heldByChildren`'s, and it was real only while a child sat in `bd ready`: delivery parks a
child behind its merge bead, which takes it out of that queue while leaving it open, and
`finish` drops a delivered worker from the advocate's own list up to half a minute before its
window actually exits. So both of the cheap checks went quiet at once, and the fourth — the
one that asks `bd children` — was behind `if (bead.type !== 'epic') return null`.

Both ends are now the same rule the epic already had, in the two files that own them:

- **`heldByChildren` (`lib/advocate.js`) asks about any parent, not only an epic.** Check 1
  never cared what a parent was typed as — *a parent and its child must not be launched in
  the same tick* — so all this adds is the child that is open somewhere the queue cannot see
  it. The cost is what kept the type test there, and the tick's own `bd export` is what pays
  it: a `Set` of the parent edges' values answers *could this bead have children* with no
  subprocess, and only a yes costs the `bd children` call. Measured here on 2026-08-28: 331
  open beads, of which 5 are non-epics with any child at all.
- **`sweepFinishedEpics` (`lib/finishedepic.js`) offers a follow-up parent the same one-tap
  close card an epic gets**, in its own words rather than the epic's — nothing in it says
  "theme". Without that half the fix is the worse one: the hold releases when the last child
  closes, and the parent goes back into `bd ready` for ever, with `maxAttemptsPerBead`
  retiring it into `givenUp` after the second wasted window and leaving it open and
  unaskable.

**The population is those two beads and no others, and the narrowing is deliberate.** The
evidence — *every child this tracker knows about is closed* — is type-independent, but the
conclusion is not: an ordinary task's body is usually the work, so its subtasks closing says
nothing about whether it is done, and a card there would pull legitimately ready work out of
the queue to ask a question with no answer. What the two have in common is that they say of
themselves that their children are the work: an epic by its type, a follow-up parent by the
keyed `review-followup:<repo>#<n>:r<round>` label, which is written to the parent and to
nothing else (a finding child carries the plain label only). Labelling the parent `container`
was the cheaper candidate and is wrong for the opposite reason — `container` means permanent
furniture, `Bd.ready` filters it out unconditionally, and a bead that is *meant to end* would
then be held out of the one queue that could end it. (`test/epicqueue.mjs`,
`test/finishedepic.mjs`.)

### The notification with nothing to answer

Every other push from beadcause is a decision arriving. This one is a decision that has
already been taken, by an agent, on your behalf — so it is built to be different in three
ways, each of which is the point:

- **No action buttons, ever.** Not even one. The only thing a button could offer about
  work that is already in `main` is a revert, and a revert is not something to hand
  someone in a lock screen with one line of context.
- **Priority 2 — it arrives, it does not shout.** A question can be urgent because
  something is blocked on it. Nothing is blocked on this. A phone that buzzes hard for
  things that went right is a phone that gets silenced, and it takes the questions with it.
- **It links to `/prs`, not to a bead.** There is no bead to open — it is closed. The
  question this actually raises is *it merged, is it running?*, which lives on the PR
  board, next to the **Ship** button that answers it.

It says what landed, the merge commit, and what the session said is **still owed** —
`Still owed: deploy, rebuild`, in the session's own words from `--owed`, because the
daemon knows the repo but only the session knows what it touched. A workspace in a
[minimal space](asking.md#spaces--keeping-work-out-of-your-evening) gets the contentless version,
same as every other push: *A worker landed its work — tap to open.*

### The question, and what is on it

Its first paragraph is now the most useful thing on it, because it answers the question
you ask on seeing one at all — *why is this here?* Three answers, three different
sentences, never folded into one polite one:

| the card says | what happened |
|---|---|
| *tried to merge it. **It could not:** …* | GitHub refused, or a check went red, or nothing reported. The reason is quoted from whatever refused |
| *its checks are green. **It is waiting on an approving review*** | the space asks for one (`requireApproval`) and the pull request has not got it. Nothing refused and nothing is wrong — your **Merge** *is* the review |
| *could have merged this itself and **deliberately did not*** | the session passed `--review`. Its reason is in the summary |
| *Nothing is merged until you say so* | auto-merge is off for this space, so every delivery is a question and this one is not special |

The second and the fourth are the pair worth keeping apart. Both are a green pull
request sitting unmerged, and only one of them is about a switch: a card that said
*auto-merge is off* over a repo where it is emphatically on would send you looking for
a setting that is already the way you want it.

A refusal is prose on the card and never a field in the `beadpr` block — the block
carries identity and intent, and "why it didn't merge this time" is neither. The same
sentence goes on the pull request itself, because a green PR sitting open for two days
with nothing on it to say why is the state this fallback exists to *not* be mysterious
about.

The rest is built to be answerable without opening GitHub, because the answer to
"should this merge" is usually not in the diff. Above the fold: what changed, in the
words of whoever wrote it, plus how the tests were run, what the author thinks is
risky, and what they deliberately left undone — the commonest reason to ask for
changes is something the author already knew they had skipped.

Under that, the numbers, and these are **read from GitHub when the card is drawn**,
not from the bead: how many files, how many lines each way, and how the checks stand.
A diffstat frozen at the moment a session ended is wrong the instant anyone pushes to
the branch, and the one number that has to be right is the one you are looking at when
you press merge. The block on the bead carries identity and intent; `gh` carries state.

The check chip has four states and they are four different sentences. `3 checks
passing` is not the same as `no checks` — a repo with no CI has told you nothing, and
a green tick there would be a claim nobody made. `2 still running` is *wait*;
`1 failing: build` is *don't*, and it names which. Failing checks do not disable the
merge button: a red check is sometimes a flake, and the decision is yours. Merged,
closed and conflicting *do* disable it, because those are facts GitHub has already
stated and pressing would only produce an error.

**Merge** takes two taps, like every other answer that closes a bead — and unlike
every other one, this also lands code in `main`, which is the strongest argument for
the second tap in the whole app.

### Ship it — the same merge, and then the deploy

The fourth button, and the only one that is not always there. **Ship it** is `MERGE:`
plus the repo's [declared deploy](pull-requests.md#deploying-a-repo-when-it-says-how),
so what changes is not only what is on `origin` but what is *running*.

**It appears only where there is a deploy to run.** `deploys` in the config is empty by
default and most repos have no entry, so most cards get the three answers they always
had — a Ship button in a repo that declares nothing would be a button whose entire
content is a failure message. `beadcause-deliver` looks the declaration up when it files
the card, and the server looks it up **again** before anything runs, so a declaration
removed in between costs a stale button and never a wrong deploy.

**And it says what it will actually do**, on the button, in two lines:

```
  Ship #42
  merge, then runs launchctl · rebuilds apk · restarts beadcause
```

Because "deploy it" means something different in every repo, and the difference is
exactly the part worth a second's thought: `fly deploy` costs nothing you would notice,
and `launchctl kickstart -k` on this Mac SIGKILLs the daemon you are holding.

**Merge is still first, and still the safe one.** Ship sits second, deliberately not
under a thumb aiming at the top button: a merge you meant to ship is two more taps on
[the PR board](pull-requests.md#the-three-buttons), where Ship runs the same declared deploy this one
does, and a deploy you did not mean is not a tap at all. Both arm the same way —
tap, then tap again — and both are disabled on the same facts, because a pull request
GitHub will not take is not one to ship either.

**The deploy starts last of everything.** This is the whole reason it is not simply
`MERGE:` with a flag. A beadcause deploy kills the process serving the request that
asked for it, so by the time it starts, everything durable this answer owed is already
done: the merge is on GitHub, the work bead is closed with the PR number in its reason,
the answer is written, the question is closed, and every other client has been told.
Then — and only then — `startDeploy` hands the work to a detached runner and the reply
goes out. A 200 here means *written down and a process owns it*, never *it worked*; how
it went arrives on `/api/deploys`, on the PR board, and on your phone.

**Ship in a repo with nothing declared still merges.** It has to: the merge is the half
both buttons asked for, and throwing it away over a missing config entry would be the
worst possible reading of "ship it". The bead says why nothing was deployed, in that
sentence, rather than implying it shipped. The same is true of a deploy already running
for that repo, and of a declaration that is present and malformed.

One thing to know about the lock screen: ntfy allows three action buttons and a
shippable delivery offers four, so **decline** is the one that falls off the
notification. That is the right one to lose — declining asks for a direction to take
instead, which is a paragraph and not a tap, and on the card itself it is already a
two-step panel for exactly that reason.

`node test/ship.mjs` drives the whole thing through a real `POST /api/respond` with a
fake `bd`, a fake `gh` and a declared deploy whose command writes a file: that `MERGE:`
deploys nothing, that free text does neither, that a repo with no declaration merges and
says so — and, the one that needs an end-to-end test to prove at all, that the deploy
command sees a `bd` call log which **already** contains the closed bead and the answered
question.

### Request changes is a sentence, not a button

There is no one-tap "changes requested". It opens the card and puts you in the answer
box, because "changes requested" with no note is the least useful thing you could send
a session that is about to try again.

What you type goes to both places it is needed: a comment on the pull request, where
whoever opens the diff will look for it, and a comment on the bead, where the next
session reads it before starting. Then the bead is **reopened and unclaimed** — it was
claimed by the session that built the branch, and a claimed bead never comes back
through `bd ready`, so without this your note would sit on work nothing would ever
pick up again. The branch stays open and the next session pushes to it.

On a delivery card the free-text box has one job, so it says so: the button reads
*Request changes & close*, and prose sent from there travels with the `CHANGES:`
marker. Note which way that fails. No wording of a typed answer can merge anything —
merging needs `MERGE:`, and only the button writes it. Prose is safe in the one
direction where safety matters.

### Decline is the other one, and it is not a stronger no

*Request changes* and *decline* look adjacent on a phone and are not the same act.
Choosing wrong costs a whole session, so the difference is the first thing the panel
says:

|  | request changes | decline |
|---|---|---|
| what was wrong | something **on** the branch | the **approach** |
| the pull request | stays open | closes |
| the branch | stays, push more commits to it | abandoned |
| the bead | back in the queue | back in the queue |
| the next session | continues the same attempt | starts again, fresh branch |

Declining takes two steps rather than a timed double-tap, because the second step has
a box in it. **The direction is optional and it is the most valuable sentence in this
whole channel** — a decline with nothing attached tells the next session only that its
predecessor was wrong, which is exactly enough information to do the same thing again.
So what you type goes onto the bead under a *This approach was declined* heading,
along with the closed PR's number and the name of the branch not to touch. Where you
left nothing, the bead says so plainly rather than pretending there was guidance:
*"No direction was given. Read the closed PR before starting again."*

What is **not** declined is the work. The bead is reopened and unclaimed, never
closed — deciding against an attempt is not deciding against the thing it attempted,
and closing the bead would quietly make it so. The unclaim is the part that actually
matters: the bead was claimed by the session that built the branch, and a claimed bead
never comes back through `bd ready`, so without it the work would sit open forever,
held by a process that exited hours ago.

Both buttons that can finish a decline — the one in the panel, and the primary under
the box you may have scrolled down to type in — send the same thing. They are far
apart on a long card, and either should be able to finish the job.

### A card for a pull request that is not in this repo closes itself — but only on GitHub saying so

Every ending the advocate's landed sweep (`lib/landed.js`) knew was *GitHub says it
merged*, so a delivery card naming a number the repo does not have had none. bc-2g8s
was the case: `Merge #410`, filed when origin was `olduser/beadcause`, sitting in the
inbox for thirty-two days in a repo whose pull requests stop in the eighties. It was
also unanswerable rather than merely stale — every button on a card runs `gh` against
this checkout, so a tap could only say there is no such pull request.

The sweep now closes it, and the design is nearly all about what it must **not** close
over. A `gh` outage, a rate limit, a timeout and the wrong active account (which this Mac
does routinely) all look identical to "not found" from the sweep's side, and closing a
live card on any of them would be the worst thing this could do. So it takes two pieces
of evidence, both required: the number is **higher than any pull request the repo has**
(one `gh pr list` per sweep, and only when some card is unresolved, so thirty open cards
do not cost thirty `gh pr view` every ten minutes), and `gh pr view` then answers with
GitHub's own sentence for a pull request missing under a repository that *did* resolve —
`Could not resolve to a PullRequest with the number of 410`. The wrong-account sentence
says `… to a Repository` instead, and a sentence naming a different number does not
count either. Anything else is left open and reported as a skip.

The probe asks for `--json state`, never `--json number`: `gh pr view 410 --json number`
prints `{"number":410}` without calling GitHub at all, and so finds every pull request
there is. The close reason says which repo the card was filed against, so someone
finding it later can tell *moved* from *never existed*. The work bead behind the card is
told it is ordinary work again and is **not** closed — nothing says its work landed —
and, because nothing merged, this does not fast-forward `main` or ask for a conflict
sweep the way a real merge does. Deliberately not attempted: re-resolving the number
against the old slug the block carries. That is the repo origin moved away from, and
nothing else on the card could reach it either.

### Consent is a marker, because two of the three paths carry only text

The same discipline as an advocate's proposal, for the same reason: the phone sends
the option's response string, and an ntfy action button sends the same. There is no
option id on the wire, so each acting answer *starts* with its marker and nothing else
is treated as consent.

| marker | what it does |
|---|---|
| `MERGE:` | `gh pr merge --merge --delete-branch` (whatever `pr.mergeMethod` says), then closes the work bead with the PR number in its reason |
| `SHIP:` | the same merge, and then the repo's declared deploy — started after the answer is written, never before |
| `CHANGES:` | comments on the PR and the bead, reopens the bead, leaves the branch alone |
| `DECLINE:` | closes the PR unmerged, abandons the branch, reopens the bead — and writes whatever direction you gave onto it |

"Looks good to me" is a comment, which is exactly what it looks like. So is *"I think
we should MERGE: it"* — the marker only counts at the start.

`SHIP:` is a fourth word rather than a flag on `MERGE:` for the same reason the other
three are separate words: the wire carries the response string and nothing else, so the
prefix is the whole protocol — and *merge* must never widen into *merge and deploy*
because somebody appended a sentence to it. `MERGE: ship it after` merges, and deploys
nothing.

The merge happens **before** the question is closed, the same order `createProposed`
keeps: a merge GitHub refuses leaves the question open and answerable rather than
closed on a promise nothing kept. And it is never `gh pr merge --auto`, from either
caller. Queuing a merge to happen later when checks go green would make a tap a promise
rather than an act, and the bead would close on work that had not landed — which is also
why a worker *waits* for its checks and then merges, rather than handing GitHub a
standing instruction and exiting. Whatever closes a bead here is a merge that has
already happened.

**A failure after the merge is not a refusal.** `gh pr merge --delete-branch` is three
acts — merge, delete the remote branch, delete the local one — and a non-zero exit says
only that one of them went wrong. The last one goes wrong routinely: the daemon merges
from the main checkout, every branch a worker pushed is checked out in one of its
worktrees, and git will not delete a branch somebody is standing on. So the failure path
reads the pull request back before believing the exit code, and a pull request that
reads `MERGED` is a merge, however loudly `gh` exited. The card says what `gh` could not
tidy and leaves the branch to `lib/tidy.js`. Untreated, this was bc-s2d8: *bc-g0tx was
not answered — nothing was written and nothing was lost*, sent over #371, merged, with
its remote branch already gone and its work bead left `in_progress` because the answer
never ran. There is no sentence on this board it is worse to be wrong about.

A delivery question closes on all four answers, including *request changes* — the
question was *merge this?* and it has been answered. The next push files a new one, so
the inbox carries one card per attempt rather than one card that quietly changes
meaning under you.

### Discoveries and conflicts, at the moment they happen

**An agent creates the bead, and it arrives held.** Approval did not go away; it moved
to the other side of the creation. A bead an agent files exists in the tracker the
moment it is filed, carrying `unendorsed` — a hold with teeth: no advocate queues it,
no launcher opens a session on it, and it is out of every count that says how much work
is waiting. You endorse it, edit it, or revoke it from
[the endorsement queue](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time), and
until you do, nothing spends an hour on it. That is bc-3zo9, and it is why this section
no longer says an agent may not create a bead: it may, and what it may not do is have
one *worked*.

A session used to write what it found into a `## Discovered` heading in a comment and
carry on. Those sat there — invisible, unanswerable — until the repo's advocate ran
out of ready work and surveyed the comments, which on a repo with a queue is never. So
a discovery arrived a fortnight after the context that made it obvious had gone, or it
arrived not at all.

**There are two tools and they are not interchangeable.** The question that picks one is
whether the finder can carry on without you.

**`beadcause-file` — a discovery, recorded now, worked later.** The overwhelmingly
common case: a session trips over work that is real, is not this bead's, and does not
stop it.

```bash
beadcause-file -w beadcause --from bc-7qo <<'EOF'
- title: Cache-bust site.js
  type: task
  priority: 2
  description: |
    No ?v= on the script tag, so a shipped header change looks absent.
  acceptance: A deploy changes the URL.
  rationale: Found while reading base.html for bc-7qo.
EOF
```

That creates the bead for real, marked `unendorsed`, with a `discovered-from` edge back
to `bc-7qo` recording where it came from, and prints the id. The finder does not wait
and does not stop — it carries straight on with the bead it was opened for. The cost to
you is a tap, at a time of your choosing, rather than an hour of somebody's attention
now; and because the bead exists, the reason it was filed is written down at the moment
it was obvious rather than reconstructed later. Priority is capped at P2, because what
an agent finds may not outrank the work you chose.

#### Where it lands — a bead filed under nothing is unworkable the moment it exists

Since bc-rfnr.7, a bead that is not a **root** and has no root above it is **not
workable**: no advocate queues it, no launcher opens a session on it, and its card wears
a `nothing decided above this` pill offering the fix. That rule is the point of the epic
board, and it has a consequence for everything the daemon files unattended — a bead
created with no parent fails it the moment it exists, and there are two things wrong with
it rather than one:

- It is **held**, which the advocate says out loud: a log line, an event on the bus and
  the pill.
- It is **invisible**, which nothing says at all. The inbox draws only what descends
  from a root you own, so a `human` card filed with no parent is not on the phone. A
  *question* the daemon writes to a screen that will not show it is this app's one
  unforgivable failure arriving through the mechanism meant to prevent it.

**A root is an epic at any priority, or a P0** — `isRoot` in `lib/ownership.js`. Until
bc-htoy it was a P0 and nothing else, and that was a mistake worth naming rather than
quietly correcting: an epic *is* a decision, which is what filing one means, and priority
says how urgent that decision is rather than whether it was made. Tying them together
meant the only way to root work, take an `owner:` label, or be given an Epic Advocate was
to claim the work was the most urgent thing on the tracker — so either the board filled
with P0s nobody thought were urgent, or real epics went unmanaged.

It **widened** rather than moved, and the reason is one bead: `lib/errors.js` files every
daemon crash at P0 by construction, and those are `type=task`. Had a root become "an
epic", the first thing to stop being workable would have been the stack trace the app
filed on itself — off the board and refused at the door, which is exactly the failure
bc-rfnr.4 exists to prevent, arriving through the mechanism meant to fix it.

So the parent is chosen at the filing seam (`lib/homing.js`), and the rule is one
sentence: **a bead lands under the root that the work which found it belongs to** —
`--from` on the command above, the closed bead behind a
[stranded branch](advocates.md#the-bead-that-is-closed-over-a-branch-that-never-reached-main), the
epic behind a promotion, the session behind an amendment request. Failing that, under
the **unsorted backlog**: the open root carrying the `unsorted` label, which is where a
bead goes when nobody has yet decided where it goes. The bead's notes say which happened
and invite you to move it, because a bead quietly adopted into an epic nobody named
otherwise reads as somebody else's decision.

Five things about that rule are deliberate and each is a thing that would be wrong if
reversed:

**Under the root, not under the bead that found it.** The tempting version parents each
discovery under whatever turned it up. It reads better and it manufactures, on a
schedule, the one shape that is held forever with nothing saying why: an open child of a
non-root parent that has since closed. A task closes in a week; a root closing is the end
of an epic, which is the honest moment for what hangs off it to stop being work. The
`discovered-from` edge already records the fine-grained trail, and it is deliberately
*not* an ancestry edge — a `discovered-from` must never pull a bead into a P0's
descendants, since every bead an agent has ever filed carries one.

**A label on the tracker, not an id in config.** `~/.config/beadcause/config.json` is
per-Mac and the graph is shared, so an id in a settings file would name a different bead
— or nothing at all — on the second machine. Label an open P0 `unsorted` and every
daemon writing to that tracker files into the same pile. Two of them is not an error: the
lowest id wins, on every machine, until somebody takes the label off.

**Except for a seam that files one *kind* of bead every time, which names its own home.**
The rule above is right because the root above `--from` is the only thing the daemon
knows about a *discovery*. The [session audit](advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work)
is not filing discoveries: every bead it files is a skill candidate, and which epic
evidenced it is an accident of which sessions happened to end that hour. By 2026-08-21
that had put **thirty-seven open candidates under twelve unrelated epics** — each counted
against a theme it had nothing to do with, and, worse, each one *ahead* of that theme's
own work in the ready queue. Every candidate is P2, so the whole ordering below priority
is `created_at`, and nine filed in one 45-minute burst at midnight can never fall behind
the navigation bugs they outrank; they only leave the front by closing, one worker window
at a time. bc-khoe measured its own theme sitting twenty to forty places behind its
session-tooling children for four days running.

So such a caller passes `homeLabel`, and gets **the open root carrying that label** —
named the same way and for the same reason as the `unsorted` pile, a label rather than an
id, because config is per-Mac and the graph is shared. For the audit that label is
`self-started-skills`, which bc-dgx7
already carries and whose own description says the whole programme is one query on it.
Reusing a label that is *also* on every candidate is safe because only **roots** are
considered — a candidate is a P2 task, and the `unsorted` label is inherited by every
child of the backlog for exactly the same reason and is exactly as harmless.

It sits above `--from` and below an explicit parent: naming a label is the caller saying
*these are all one thing*, which is a stronger claim than *this is what turned it up* and
a weaker one than a parent worked out per bead. And it **falls through** rather than
refusing — no root carries the label, and the answer is the one the seam gave before — so
pointing a seam at a home nobody has raised yet is a no-op, not a pile of orphans.

**Nothing is refused.** No `--from`, a `--from` that is itself under nothing, no
`unsorted` P0, or a `bd export` that lost a Dolt lock race: the bead is filed with no
parent, exactly as it was before any of this existed. A filing seam that failed closed
would turn a lock collision into a discovery nobody kept, which is a worse trade than the
hold it is avoiding. `beadcause-file` says so and names the fix — but only when the
workspace *has* an open P0, because the gate itself fails open on one that does not, and
a warning about a hold that is not happening is a lie printed at every filing. And if bd
refuses the parent outright — its hierarchy is its own, and a P0 that is a crash `bug`
rather than an epic is dispatchable directly, so a session really can be working under
one — the bead is filed again with no parent and the refusal is reported. Nothing here
chose that parent; losing a discovery over it would be the wrong way round.

**And the provenance edge is never written to the bead's own parent, which is the one
thing above that was quietly failing.** bd holds **one typed edge per pair** and refuses a
second of a different type, so `--parent X` alongside `--deps discovered-from:X` fails the
whole create:

    validation failed: dependency → X already exists with type "parent-child"
    (requested "discovered-from"); remove it first with 'bd dep remove' then re-add

That is not a corner. It is exactly what the rule above asks for **every time the work
that found the bead is itself a root**, since a root counts as being above itself — a
worker opened on a P0 hits it on its first discovery, a worker opened on a child of one
never does. So the create failed, the fallback dropped the parent rather than lose the
find, and the bead landed with nothing above it: held, refused at the door, and reported
to the session that filed it as *filed under X*. Every one of the twenty-two `agent-filed`
beads sitting parentless on 2026-08-17 was this, and the three passes over that pile ruled
out a Dolt lock, a failed `bd export` and bd's hierarchy rules in turn, all wrongly. The
**parent-child edge wins and the `discovered-from` goes**: it loses nothing, because a
parent link to the bead you were working is the same trail drawn more prominently, and the
notes say *filed by an agent while working X* either way.

**Except a red-base hold, which is never that root — bc-beleq.2.** "A root counts as
being above itself" is right for an ordinary work-bearing P0: it closes the same way any
bead does, by someone deciding the work is finished, and bd's own children-first rule is
exactly the safety a person would want there too. (An `app-error` P0 is the *other*
exception, landed alongside this one as bc-mwhkg.2 and for its own reason — `lib/errors.js`
files it automatically and it closes the moment the error stops being reported, so a
discovery parented under one is stranded the instant it closes. The two skips are separate
in `rootOver` and both apply.) A [red-base hold](#when-main-itself-is-red--the-queue-holds-and-something-is-put-on-the-fix)
is not that — it is a *standing condition*, closed automatically the moment the base is
green, by `sweepBase`'s own `bd.close(..., { overClaim: true })`, which lifts the claim
guard and not the children guard. A worker opened on the hold, following this very
section's own "found more work, file it" instruction, used to land the discovery as the
hold's child — and the next tick's close was then refused every time, holding every
branch in the repo behind a base that was already fixed, with nothing louder than a log
line saying so. `lib/homing.js`'s `rootOver` now skips a hold bead as a candidate home
the same way it skips a closed one, so a discovery made while working a hold climbs past
it to whatever real root is above (there usually is none) and falls through to the
unsorted backlog exactly as "nothing above it at all" already did. And the refusal
itself, on the rarer path where something does still block the close, is no longer only
a log line: `sweepBase` now comments it onto the hold bead (`stuckReason` in
`lib/redbase.js`), so a card that still reads "holding" after the base went green carries
the reason rather than a green check on GitHub that contradicts it.

**What a refusal says is now what bd said.** `Bd.run` builds its error as `bd <every
argument> failed in <ws>: <reason>`, and a `create` carries `--description` — so the
message's first line is the start of the command and the reason is somewhere past the
description's first newline. Reporting that first line, which is what this seam did for a
fortnight, showed a session its own title echoed back with *Filing it with no parent
instead* bolted on, and never once the sentence that would have named the bug. bd's own
words are on `stderr` and that is what is read now. The summary line beneath it is written
from **what landed** rather than from what was decided: a bead whose parent was refused is
named, with the word `NO PARENT`, instead of being covered by a *filed under X* that was
true of the intention and false of the bead.

**But nothing is silent either, and for a while one thing was.** Fail-open is not the
same promise as fail-quiet, and the difference is a bead that vanished. Three
`beadcause-file` calls minutes apart in one session, same workspace, same `--from`: the
third said *filed under bc-0i27, the P0 bc-0i27.4 belongs to* and the first two said
**nothing at all** and landed with no parent — held by the rule above, and off the phone,
reported as a success. The two failures were `bd export` not answering on a loaded Dolt,
which is not a rare coincidence but a correlated one: the export fails when the machine
is busy, and the machine is busy when twenty sessions are filing.

What made it invisible is one seam further down than it looks. Reading the graph
deliberately never throws — it logs, and hands back the last good answer or an empty one,
because the inbox drawing everything and the dispatch gate withholding nothing both
depend on it returning. But *an empty graph is a graph with no P0s in it*, which is
exactly the case a warning must not be printed for; so "I could not look" arrived wearing
the costume of "there is nothing here to look for", and the one filing that genuinely
owed a warning was the one filing that could not produce one. The fix is a third state
rather than a smarter boolean: the stand-in graph carries the reason it is a stand-in,
`lib/homing.js` hands it out on `error`, and the failure is said once — on the filing
session's own stderr where there is one, in the daemon log for the seven other callers
that file unattended. The bead is still filed; only the silence is gone.

**And the backlog is not for everybody.** A caller may say it must not land there, and
one does: the [release queue](pull-requests.md#the-release-queue--the-number-over-ship)'s per-merge `ship`
bead. Being in the unsorted pile is a *question* — which P0 does this belong to? — and
the pile is finished when it is empty, so it only works while everything in it is a bead
somebody could answer that about. A ship bead is not: it closes itself when the deploy
lands, and it carries `unendorsed`, so nothing will ever open a session on it. Thirty a
week of those buried the beads that were genuinely asking — 40% of the pile, at one
point. Such a caller keeps the first half of the rule and drops the fallback: the P0 above
the merge's own bead where there is one, and no parent at all where there is not, which
for a bead no queue carries is held by nothing.

`test/homing.mjs` covers it, including the property the whole thing is for, asserted
against the tracker after a real `fileBeads`: the bead it just filed has a P0 above it.
`test/filing.mjs` covers the collision from the other end — its stub `bd` refuses two
edges to one bead in bd's own words, so a bead filed while working a root has to actually
land under it, and the inverse holds: take the parent out of `withDiscoveredFrom` and that
check goes red.

#### And when a root does close over open work, something now says so

The rule above says a root closing is "the honest moment for what hangs off it to stop
being work", and it is. What was wrong is that it happened *in silence*. A closed root is
not a root — `rootsOf` in `lib/underroot.js` counts only open ones, and that file argues
out why — so every still-open bead beneath it leaves the ready queue and is refused `409`
at every launcher, while keeping its title, its priority, its labels and its place on
every screen. Nothing distinguished it from ordinary work waiting its turn.

Three beads reached that state and every one of them had been homed **correctly** at
filing time: `bc-b4fs.1`, `bc-ysqd.1` (whose root closed on #489 four minutes after its
own worker filed the child under it) and `bc-ibt8g.1` (root closed on #571). Each was
found by an Epic Advocate running a census by hand off `bd export`; none of them would
have been found otherwise. Since #402 fixed the other source — a daemon filing with no
parent at all — this was the whole remaining inflow to the unsorted backlog.

`lib/rootclose.js` is a sweep on the poll cycle that says it, and the two decisions in it
are worth naming:

**It is a sweep and not a hook on the close**, for `lib/epicdone.js`'s reason and about
the identical event: a bead closes in four places and only one of them is this process — a
tap on this app, `bd close` typed at a terminal, a worker session, or the same arriving
over `bd dolt pull` — and bd has no pre-close hook. There is no call site to hook, only a
row that changes.

**It asks about state rather than about a transition**, which is the one place it departs
from `lib/epicdone.js`. That file accepts losing an epic that closed while the daemon was
down, because "a chime for something that finished yesterday is noise"; the opposite is
true here, since a chime is over in a second and a stranded bead is permanent. So the
question is *is this bead unworkable right now, and was a root closing what did it*,
answerable from one cached graph read with no history — and the duplicate suppression a
transition would have given for free is bought the way `lib/landed.js` buys it, by reading
the thread for the sentence it is about to write again.

What it writes is a comment on each stranded bead naming the root and the one edit that
undoes it, a comment on the closing root listing what it left behind, and a `[stranded]`
line in the log for each. Two beads it deliberately never mentions: one with **no
ancestors at all** was never rooted, which is a different and already-decided question
(such a bead stays parentless on purpose), and a **superseded** one is being tidied away
rather than left behind. An `unendorsed` one *is* mentioned, and that is the case the
whole thing is for — it never reaches the queue, so `heldByNoRoot` structurally cannot
count it.

The test is `hasRootAbove` itself, so what the sweep reports and what the dispatcher
refuses can never disagree — including the fail-open, which is what makes a workspace with
no open roots, or a graph that could not be read, produce silence rather than a comment on
every bead in it. `test/rootclose.mjs` covers it, the acceptance case being the `bc-ysqd`
shape verbatim.

**`beadcause-propose` — a question first, a bead only if you say so.** Nothing is
created until you press the button. That is the right shape when the bead itself is
what is in doubt — a large piece of work an advocate wants a mandate for, or a batch you
should see as one decision — and it is the only shape for the case below.

`--kind conflict` is the other half, and the more valuable one. A session that hits
two things that genuinely disagree — its brief against the repo's `CLAUDE.md`, a bead
against what the code actually does, two beads that cannot both be right — used to
have no move except to pick one and carry on, which is how an unattended queue quietly
does the wrong thing for a week. A conflict is filed at P1, and it **parks the bead
that hit it behind the question**, so nothing reopens that work until you have settled
it. Then the session stops.

#### Parking an epic, which bd refused outright

Three commands park work behind a question — `beadcause-ask --blocks`, the conflict
above, and `beadcause-deliver` when the merge did not happen — and all three did it
with one line, `bd dep add <the work> <the question>`. On an epic, bd refuses:

```
Error: epics can only block other epics, not tasks
```

**bd would not let an epic be blocked by anything that is not itself an epic.** Every
other pair was fine — a bug blocked by a task, a chore blocked by a decision — so the
rule was narrower than it reads and it was exactly one line: epic-ness has to match. The
same sentence with the nouns swapped came back for a task blocked by an epic.

**That rule is gone as of bd 1.2.1** (2026-08-11): "cross-type blocking dependencies are
now allowed" replaced the blanket same-type rule with a hierarchy deadlock guard that
refuses only gating an issue on its own ancestor or its own descendant. Sibling edges —
every edge a park draws — go in whatever the two types are, and `test/epicedgereal.mjs`
pins that against the real binary, skipping itself with a loud line on anything older.
Everything below is kept anyway: it is right under both rules, it costs a string
comparison, and a machine still on 1.1.x gets the working behaviour rather than the stack
trace. What the bump buys that no amount of typing could is that **one question can now
park an epic and a non-epic at once** — the failure that put one decision bead back into
`bd ready` three times, because the question holding its epic could not also hold it.

What made that expensive is the order. The question is created *first*, and
`bin/ask.js` added the edge afterwards without catching anything, so a session asking
about a P0 epic got a raw Node stack trace **having already filed the question**: it
was on the phone, labelled `human`, and the caller had been told the command failed. A
session that believed the error asked nothing. A session that retried asked twice. And
the epic it was supposed to park went on being `bd ready`, so the next advocate tick
opened a window on work that was explicitly waiting for an answer — which is the one
thing `--blocks` exists to prevent.

So the question is now **typed after the bead it is going to park** (`lib/park.js`):
ask about an epic and the question is filed as an epic, and the edge goes in. Nothing
else about it changes — still labelled `human`, still out of every queue because of
that label, still drawn as an ordinary card, because the phone never renders a
question's type. It costs one extra `bd list --parent` when the card is opened, since
[the close gate](answering.md#when-bd-will-not-close-the-bead) asks an epic for its open children;
a question has none, so the gate is null and the card behaves like any other.
And closing it still un-parks the work the moment it is answered, which is the half the
by-hand workaround below cannot do.

Underneath that, a refused edge is no longer only about types — bd mid-write on the
Dolt lock refuses too — so the fallback is what a session had to do by hand: label the
work bead `human`, which takes it out of every queue so nothing opens a session on it.
That is **not** the same thing and the caller is told so in one plain sentence, never a
stack trace: the label does not come off when the answer lands, so somebody has to come
back to that bead deliberately. `beadcause-deliver` opts out of the fallback, because
its work bead is about to be closed by the merge and a label nothing removes would sit
in the inbox as a card with no question on it.

Two smaller rules fell out of the same bug, and both are about what exists afterwards:
a `--blocks` id that is not in the workspace is refused **before** anything is created,
which is the only moment refusing is free; and once the question exists the command
prints its id and exits 0 whatever the parking did, because a caller told it failed over
a question that is already on the phone either asks nothing or asks twice.

`test/park.mjs` covers it, and covers it end to end for the two commands a session
actually runs: a unit test of the type rule alone would pass just as happily against a
`bin/ask.js` that still hardcoded `--type task`, so both are spawned as real
subprocesses against a stub `bd` that enforces bd's epic rule — measured off the real
binary rather than guessed — and the assertions are made against what landed in the
tracker. Including the two states that are only visible from outside the process: a bad
`--blocks` id leaving the tracker with nothing new in it, and a refused edge leaving a
question whose id is still on stdout with one plain sentence, and no stack frame, on
stderr.

### How hard a bead is — `complexity:<tier>`

A bead carries how hard it is, as a `complexity:low`, `complexity:medium` or
`complexity:high` label, and it carries it because most beadcause work does not need
the expensive model and the handful that does must not be run on the cheap one. The
tier is what decides which model a session on that bead runs — that is bc-nc6o, and
this section is the half that puts the tier *on* the bead.
[The next one](#which-model-a-session-comes-up-on--the-tier-at-spawn-time) is the half
that reads it back at spawn time. They were built in that order deliberately: a router
reading a field nothing writes routes everything to the fallback and looks broken.

**Decided when the bead is written, not guessed at when it is opened.** The dispatcher
sees a title and a description three days later; the agent that proposed the bead had
just read the files, and you, endorsing it, had just read the proposal. That is the
moment the answer is cheap, and it is the only moment it is cheap *once* — a guess made
at spawn time has to be re-made, identically, every time the bead is opened. So
`complexity` is a field on a proposal, beside `type` and `priority`:

```yaml
- title: Cache-bust site.js
  type: task
  priority: 2
  complexity: low
  description: |
    No ?v= on the script tag, so a shipped header change looks absent.
```

It is the same field in both places a bead is written: the block an advocate's survey
emits, and the YAML a worker pipes into `beadcause-file` when it trips over something
mid-task. Both prompts now ask for it, in the same words — rate the *work*, not how much
it matters. A one-file change with an obvious fix is `low` even when it is urgent;
anything turning on a design decision, spanning several files that have to agree, or
needing a migration is `high`. Priority already carries "how much this matters" and
carrying it twice would make the two disagree.

**A label, and deliberately the same shape as [`repo:<token>`](config.md#how-a-bead-says-which-repo-it-is-about--repotoken).**
It is the only per-bead thing beads itself will carry, sync and filter on without
beadcause owning a schema: `bd create --label complexity:high`, `bd label add bc-9f2
complexity:low` and `bd list --label complexity:high` all work today and go through Dolt
to every other machine on the workspace. The alternative — a line in the description
that beadcause parses — is prose, and prose is what a routing decision must not be.

**No tier is a legal answer and stays one.** Every bead created by hand, ingested from
JIRA, or filed before this landed carries none, which is most of the tracker; `lib/complexity.js`
answers `{ tier: '', problem: null }` for those rather than treating it as an error, and
the router's fallback for an untiered bead is the **expensive** model, because an unrated
bead is an unknown bead and the cost of that fallback is a bill rather than a botched
session. Which is also why nothing invents a tier: a word that is not one of the three
is dropped, so a proposal saying `complexity: medium-high` files unrated rather than
being rounded to something plausible.

**Two tiers on one bead is refused, the way two `repo:` labels are.** `beadComplexity`
answers with a problem rather than a tier, and picking the first would route by whichever
label sorted first — a coin toss dressed up as a decision. Two labels naming the *same*
tier is not a conflict, it is one answer written twice. A bare `complexity:` with nothing
after it is a problem too, and not "no tier": somebody typed that label meaning something
by it, and treating it as unrated would make a typo indistinguishable from the one case
that is supposed to be invisible.

**You are the last reader before it spends anything.** The tier is printed on the
proposal row beside the type and the priority, and it is the sixth thing
[the ✎ control](#approve-adjust-decline) lets you change — the only field on that card
that costs money, and the one where "this is harder than it thinks" would otherwise have
nowhere to go but declining a good bead. `unrated` is one of the four choices in that
picker rather than a blank, because clearing a tier you disagree with is a decision too.

`test/complexity.mjs` covers it: the label's own vocabulary and its two refusals, the
round trip through the `beadproposal` block (a tier that renders but does not survive
being re-emitted is a tier shown to you and then thrown away), and the acceptance itself
end to end through the real `beadcause-file` against a stub `bd` — a proposal that names
a tier files a bead carrying it, and one that names none files a bead with no
`complexity:` label at all.

### Which model a session comes up on — the tier at spawn time

The other half of bc-nc6o, and the point in it where a label starts costing money. When
the advocate opens a work session it reads the tier off the bead and turns it into
`claude --model`:

| tier | model |
|---|---|
| `complexity:low` | `sonnet` |
| `complexity:medium` | `sonnet` |
| `complexity:high` | `opus` |
| no tier, or labels nobody can route on | `opus` |

`MODEL_BY_TIER` in `lib/complexity.js` is the whole mapping and the only copy of it —
`modelForBead` is the one call the launcher makes, and it answers `{ model, tier, problem }`
because a model on its own cannot be explained. Aliases rather than model ids, for the
same reason [`consoleModel`](config.md#config--configbeadcauseconfigjson) is one: an alias tracks
the current release of a family, and a router written with pinned ids is a router that
quietly keeps spawning last year's model until somebody notices the dates.

**The fallback is the expensive one, and it is the commonest answer rather than an edge
case.** Everything filed before the tier existed, everything created by hand and
everything ingested from JIRA is unrated, so this is the branch that decides most
sessions. It goes the expensive way because the two ways of being wrong are not
comparable: routing an easy bead to Opus costs a bill, and routing a hard one to Sonnet
costs an unattended hour producing something that has to be thrown away and re-run
anyway. **Nothing is logged for an untiered bead** — a line per launch saying so would be
a warning nobody could act on and everybody would learn to scroll past. A bead whose
labels *contradict* each other is different and is said out loud, once, naming the bead
and what it opened on, because that one has a fix and the fix is on the bead.

**Precedence, because `model` is also a foundation field.** Four sources, and each step
is a step up in how specifically somebody said it: the
[baseline](agents.md#what-an-agent-is--and-how-it-asks-to-be-different) in `lib/foundation.js`,
then config where there is a key for it (`consoleModel`, which is the chat session's and
not a worker's), then **the bead's tier**, then an
[approved amendment](agents.md#what-an-agent-is--and-how-it-asks-to-be-different). The tier beats
config because a deployment default is a sentence about every session and the tier is a
fact about this one, decided by whoever wrote the bead while they were looking at the
work — the moment it was cheapest to answer. The amendment beats the
tier because Adam approved a sentence about which model *this agent* runs, by name — and
a router silently ignoring it would make the approval a no-op he had no way to see. So an
amended worker runs on what it was granted whatever the bead says, and the foundations
screen is where that shows.

**Only the worker is routed.** The
[planner](advocates.md#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window) opens on an
epic, and an epic's tier is a claim about the work underneath it rather than about the hour spent
deciding how to cut that work up — planning a subtree of five easy beads is not an easy
job, and it is the one window every other window then depends on. The button that opens a
session by hand is not routed either: it is reached from a question as often as from a
bead, you are standing there when you press it, and `/model` is one line away.

**The selection is recorded on the advocate's card while the session is still running.**
It is the only place "what is this window costing" is answerable in the meantime — the
bead carries [what it actually ran on](#and-what-it-actually-ran-on--the-ran-label) only
once it has stopped — and it carries the tier beside the model because `opus` is equally
the answer for a bead rated `high` and a bead nobody rated at all. It is in the launch
line in the log too, beside the permission mode and for the same reason: both are
decisions made silently at spawn and invisible afterwards.

`test/tiermodel.mjs` covers it, and the checks that matter run the real `openWorkSession`
end to end and read back **the shell command the window would have run** — a mapping that
is right and a flag that never reaches the command line look identical from a unit test.
It drives the launcher against a copy of `lib/` with a stub AppleScript beside it, so a
full launch happens and no window appears; the amendment case commits a real amendment to
a real repo and watches it beat the tier all the way to the `--model`.

### And what it actually ran on — the `ran:` label

Everything above is a **plan**, made in the second before a window opens. What the hour
inside it was billed to is a different fact, and the two come apart for at least four
ordinary reasons: somebody typed `/model` mid-session, an approved amendment beat the
tier, the CLI fell back, a config default moved underneath it. A card showing only the
selection would go on saying `sonnet` about a session that spent the afternoon on Opus —
and it would not look wrong, which is the problem. The number is plausible, there is no
other copy of it, and the first time the two diverge is the one time you would have wanted
to know.

So when a session finishes, its bead gains a `ran:<model>` label — `ran:opus`,
`ran:sonnet` — and `lib/ranmodel.js` is the whole of it.

**Observed, not reported.** Nothing asks the session what it ran on. A session that
changed model and then crashed would never answer, and one that did answer would be
answering about the moment it was asked. Claude Code already writes every assistant turn
to `~/.claude/projects/<slug>/<session-id>.jsonl` with the model id on it, so the answer is
on disk, per turn, whether or not the window is still there. A session somebody moved
halfway through therefore yields **two** models and both are kept: "it ran on opus" and
"it started on sonnet and moved to opus" are different sentences, and only the second one
explains the bill.

**The scan parses each line rather than matching the raw text**, and that is not
fastidiousness. A transcript is full of other people's model names — a tool result quoting
a docs page, a `grep` for the word, an agent reasoning aloud about which one to use — and
every one of them matches a regex over the line. Only `assistant` events count, and only
`message.model` on them. `<synthetic>` is skipped as well: Claude Code stamps it on
messages it composed itself, so counting it would label the bead of every session anybody
pressed escape in with a model that does not exist.

**A label, and a set, for the reasons [`complexity:`](#how-hard-a-bead-is--complexitytier)
is one.** beads carries, syncs and filters on labels without beadcause owning a schema, so
`bd list --label ran:opus` is a question anybody can ask today from any machine on the
workspace. A set is also exactly the shape of the fact: a bead worked twice on two models
keeps both labels, and a bead worked twice on the same one grows nothing the second time —
which is the acceptance in one sentence, an earlier run's model never lost and never
re-stated. Computed against the row rather than written blind, so the second run is no
`bd` write at all rather than a no-op edit in the bead's history.

**The family, not the id.** `claude-opus-5` becomes `ran:opus`, in the same vocabulary the
router selects with, so "did this run where it was sent" is a comparison rather than a
mapping — and a bead worked in March and again in June does not sprout two labels claiming
a divergence that is really two point releases of one model. An id naming a family this
file has never heard of is kept **verbatim** rather than dropped: a blank would be a lie,
and `ran:claude-quartz-9` reads as odd because it is.

**The ✎ cannot lose it.** `isRanLabel` joins `owner:` and `for:` in `isProtectedLabel`
(`lib/verdict.js`), and for a reason those two do not have: `ran:` is not a decision at
all, it is a record. There is nothing to decide about it and no route that sets it, so the
only thing [adjust](#approve-adjust-decline) could ever do to one is lose it — and the
sheet posts the label set the card is showing, where a `ran:` chip is not something anybody
types. Note that `complexity:` is deliberately *not* protected: that one is a claim
somebody made about the work, and correcting it from a phone is what the ✎ is for.

**The exact ids go in the archive, beside the plan.** Every session's `meta.json` on
[`refs/beadcause/sessions/<bead>`](advocates.md#the-session-log-kept-in-the-repo) now
carries `model` and `tier` — what it was routed to and what that was decided from — next to
`ran`, every model id its transcript shows, and `ranDiverged`. The bead carries the
readable fact and the archive carries the forensic one; and because the archive is a chain
of commits, "which model was the *last* run on" has a real answer there, where a label set
has no order and does not pretend to.

**Written whether or not the workspace keeps a session log.** `sessionLog: false` means
"do not put a log in this repo", not "do not know what the bill was for", so the label is
written on the ordinary path from the models the archive read back, and on its own from the
transcript where there is no archive to read them off. A session whose transcript is gone
says **nothing** rather than falling back to the routed model — turning "we do not know"
into "it ran on what we planned" is the one failure this whole label exists to prevent. A
run that diverged is said out loud once in the log, naming the bead, because that one is
news.

`test/ranmodel.mjs` covers it: the vocabulary and both refusals, a transcript built to
contain exactly the text a regex would trip on, the earlier-run-survives case, an adjust
that would have stripped the label, a log long enough to blow the 4MB rendering cap
(because the long session is exactly the one somebody changed model in), the real
`archiveSession` against a throwaway repo and a throwaway `$HOME`, and a real advocate
tick — a window ending, and the label arriving on the bead — down both routes.

### Where you can see it — the chip and the row

Everything above happens in a log. The tier is a label, the model is chosen in the second
before a window opens, and what the session actually ran on arrives as another label when
it ends — and until bc-nc6o.4/.5 none of it appeared on any screen. So the two questions
you actually have about a bill, *what is this bead set to cost* and *did something else
happen*, were answerable only from a terminal, one bead at a time.

Both cards now say it, and they say it from **one derivation**: `lib/modelcard.js` reads
the labels once on the daemon and hands the same object to the inbox card
(`toQuestion`, as a field beside `addressees`) and to the bead sheet (`/api/bead`, as a
field beside `noP0`). Deriving it server-side rather than parsing the labels in the browser
is the point of the file. A prefix is a contract a test can pin and is fine to duplicate —
which is why `public/graph.js` keeps its own copy of `ownersOf`. A **mapping** is a
decision, and [`MODEL_BY_TIER`](#which-model-a-session-comes-up-on--the-tier-at-spawn-time) calls itself the only copy of
it: a second copy in a browser goes stale the first time a model ships, and goes stale
*silently*, because both copies keep drawing confidently.

**The inbox chip** sits in the card's meta row with the workspace, the id and the priority:
`🧠 sonnet · low`. It is drawn on every card, including the untiered ones that are most of
the tracker — an unrated bead is not unrouted, it is routed to the **expensive** model, and
a blank there would hide exactly the beads worth tiering. So an untiered bead reads
`🧠 opus · unrated`, a bead whose labels name two tiers reads `🧠 opus · ⚠ tier`, and a
session that went somewhere else draws the arrow: `🧠 sonnet · low → opus`.

**Everything the chip means is in its text, because a phone has no hover.** The `title`
carries the long form for a desktop and nothing depends on it. What the *styling* carries
is one thing only, and it is a thing you read at a scroll rather than a fact you look up:
an outlined chip is a **plan** — nothing has run on this bead yet — and a filled one is a
**fact**, a session that finished and left a `ran:` label behind.

**The sheet row** has room for the sentence the chip compresses, so it says the three
facts apart: what the bead is routed to, why — the tier, or `no tier — the fallback` — and
what a finished session ran on, as its own clause rather than as a replacement for the
first. It is drawn under the [session row](inbox.md#the-way-through--what-its-session-did) and above the
description, so on a closed bead the sheet reads in order: it closed, here is why, here is
the session, here is what it ran on. Open or closed alike, because the sheet is the one
surface reached for a bead that closed months ago.

Neither renderer decides anything, and both draw **nothing at all** for a bead carrying no
`model` field — which is what a page cached from a newer deploy sees against a daemon that
predates it. `test/modelcard.mjs` covers the derivation, the field arriving on both
payloads, both renderers run for real over the five shapes that matter, and the rule that
every class either of them draws has a rule behind it.

### Whether the hour fitted — `ctx:<verdict>`

Everything above records *which* model. None of it records how much room that model had,
and that is the number the tier is actually a bet about: `low` and `medium` route to
Sonnet, whose window is 200k, and Sonnet-routed workers are hitting it. A session that
hits the wall spends part of an unattended hour auto-compacting — the "botched session"
outcome [the expensive fallback](#which-model-a-session-comes-up-on--the-tier-at-spawn-time)
exists to avoid, arriving through the tiers somebody *did* rate rather than through the ones
nobody did.

Worse, the decision had no feedback of any kind. The agent that rates a bead `medium` — the
proposer, or a session filing a discovery with the files still open — has never been able to
find out how the last rating turned out. So a finished session now lands one more label:
`ctx:fit`, `ctx:tight` or `ctx:over`, and `lib/sessiontokens.js` is the whole of it.

**Peak occupancy cannot say it, and that is the trap the file is built around.** The obvious
measure is how close the context got to the limit, and on its own it is worthless: the
harness compacts *before* the window is exceeded, so a session that ran out of room reads
~90% full and one with plenty to spare reads the same. The number that never crosses its
limit is not evidence about the limit.

What is evidence is the compaction. Claude Code writes a `system` event with
`subtype: 'compact_boundary'`, carrying `compactMetadata.trigger` (`auto` when the harness
ran out of room, `manual` when somebody typed `/compact`), `preTokens`, `postTokens` and
`cumulativeDroppedTokens`. An `auto` boundary is the definitive "this needed more window
than it had", written by the thing that made the decision. So the verdict rests on the
boundary, and occupancy is kept for the case the boundary cannot cover — a session that
fitted, and by how much. "Fitted at 41%" and "fitted at 94%" are the same outcome and
different advice, which is why there are three verdicts and not two. A `manual` boundary is
counted as a compaction and **not** as an overflow, while the occupancy it measured still
raises the peak: how the compaction was started and how full the window was are two facts.

**The window is not in the transcript, so it comes off the selection.** `message.model` is
`claude-opus-5` whether the session was opened on the 200k model or the 1M variant — the
`[1m]` marker belongs to the *selection* and is written to no turn, and no field anywhere in
the file names the context limit. So the window is derived from the model string beadcause
itself passed to `--model`, which it already stores in `meta.json`, by the same rule the
status line uses: a string mentioning `1m` is the long window, anything else is 200k. A
session whose selection was never recorded is refused a grade rather than given the default
one — `fit` is a claim about a limit, and inventing the limit would manufacture reassurance.

**A subagent's tokens are on the bill and not in the window.** Sidechain turns ride in the
same transcript with `isSidechain: true`. Folded into the peak, a session that fanned out to
six readers would look like one about to overflow — exactly backwards, since fanning out is
how a session *avoids* filling its window. So the totals include them, the peak does not,
and `meta.json` counts them apart so no reader has to know that.

**A label, a set, and protected, for the reasons [`ran:`](#and-what-it-actually-ran-on--the-ran-label)
is all three.** `bd list --label ctx:over` is then the list of beads whose tier was wrong,
askable today from any machine on the workspace. A bead that fitted in March and overflowed
in June keeps both labels, and that pair is the most useful thing the tracker can say about
it: the work grew and the tier did not. `isCtxLabel` joins `isRanLabel` in
`isProtectedLabel`, because losing this one costs more than losing most records here — it is
the only feedback the tier decision has ever had, and a bead whose `ctx:over` was dropped by
an unrelated title edit goes back into the queue rated exactly as badly as the first time.
A create cannot state it either: a bead being proposed has never run, and the refusal says
to set `complexity:` instead.

**`ctx:fit` is written rather than left implicit**, and the sheet's row deliberately does not
draw it. Those are not in tension. The absence of `ctx:over` is ambiguous in the direction
that matters — nearly every bead in the tracker has never been measured, and a rater reading
"no overflow label" off one of those is reading reassurance out of a bead nothing has ever
run on — so the label is written for all three outcomes. The row is read by somebody looking
for what to fix, and "the routing did what it promised" is not that, so it draws
`⚠ ran out of context` and `context was tight` and stays quiet about the third.

**The numbers go in the archive.** Every session's `meta.json` gains `tokens`: the turns
(and the sidechain turns apart from them), the fresh input, cache reads, cache creations and
output, the peak occupancy, the window it was routed into, that peak as a percentage of it,
the compaction counts and what they dropped, and the verdict — stored rather than left to be
recomputed, because it is the question the record exists to answer and it should be
answerable from the file alone. `null`, not a record of zeroes, for a session that left
nothing measurable and for every entry archived before the field existed: zeroes would read
as "this session spent nothing", and there are hundreds of the other thing.

Read off the same single pass that already reads the transcript for the log and the
`ran:` ids — a transcript runs to megabytes and that is the one place in the archive it is
already open — and written whether or not the workspace keeps a session log, for the reason
`ran:` is: `sessionLog: false` means "do not put a log in this repo", not "do not know what
the hour cost". An overflow is said out loud once in the daemon log, with the numbers on it,
because "it overflowed" alone is not enough to re-rate anything.

**One thing this does not fix, and it is worth knowing.**
[`MODEL_BY_TIER`](#which-model-a-session-comes-up-on--the-tier-at-spawn-time) sends `high` to
plain `opus`, which is *also* a 200k window. Rating a bead `high` today buys a better model
and not one token more room, so a bead that overflows Sonnet on breadth rather than on
difficulty has nowhere in the current vocabulary to go. Whether the tier should pick the
window as well as the family is bc-nc6o.9, and it was unanswerable before this: it needs
these numbers over a corpus of runs, and until now no run had left any.

`test/sessiontokens.mjs` covers it: the six traps above stated as assertions, a transcript
built to contain a `usage` block quoted inside tool output, the earlier-run-survives case,
an adjust that would have stripped the label, a log long enough to blow the 4MB rendering
cap (because the long session is the one most likely to have run out of window), a session
split across two project slugs, the real `archiveSession` against a throwaway repo and
`$HOME`, and a real advocate tick down all three routes — archived, unlogged, and archive
failed.

### Where the *ruling* is — the second axis, beside the pull request

[`lib/prstage.js`](pull-requests.md#the-ladder-in-one-place) owns one ladder and it is about a branch: review, merged, pushed,
deployed, live. It is the only place that decides that, because three modules once
answered "where is this PR" three ways and two screens disagreed in front of somebody.

An **approval pipeline** is a *different* ladder, about a different object: **draft →
in-review → approved (which is a close) → revise**, over labels, and it is about a
**deliverable** and Adam's ruling on it. The first workspace to declare one was a writing
studio. A chapter can be `in-review` with no branch in existence, and a branch can be merged
over a deliverable nobody has ruled on. The question of which of those beadcause should hold
went to Adam as `dv-uhl`, with a ladder refactor on the table, and the answer was neither of
the two obvious ones:

> the two facts stay two facts because they genuinely are two facts — where the branch is,
> and where the ruling is.

So `lib/prstage.js` is untouched and keeps telling the truth about the pull request, and
the ruling is **drawn beside it**: a card reads `in-review · PR open`.
`test/approvalcard.mjs` asserts the separation directly — the word `approval` does not
appear in `prstage.js` — because the cheap way for a decision like this to be undone is
somebody unifying two files a month later on the strength of them looking alike.

**The labels are the workspace's own.** beadcause ships no gate vocabulary: a workspace
declares its pipeline in the config on this Mac, and a workspace that declares none has no
pipeline — no chip, no row, no held close.

```json
"approval": {
  "atelier": {
    "labels": { "review": "sign-off", "gate": "milestone", "gatePrefix": "milestone:",
                "draft": "wip", "revisionPrefix": "pass:" },
    "humanOnly": ["milestone", "sign-off"]
  }
}
```

`humanOnly` is the list of labels [the one law](answering.md#the-one-law--no-agent-closes-a-gate) holds a merge
close over; left out, it is the gate and review labels. `states` may restate a state's
`label` and `note`, never add one. It lives only in the config and never in a repo file,
because a rule a branch could delete is not a rule. `lib/approvallabels.js`,
`node test/approvallabels.mjs`.

**The states, off the labels.** The review label (always paired with `human`, which is what
actually puts a bead on the phone) is `in-review`; the draft label with no `human` is
`draft`; **approval is the close**, so a review packet that closed is `approved` — there is
no "approved but still open" state and no agent may set one, because the only thing that
can is your tap. `revise` is a review packet you commented on without answering, and it
outranks `in-review` while the bead still carries both labels, because the truer of the two
is that it is no longer waiting on you.

**`human-replied` on its own is never `revise`**, and that is the one trap in the
derivation. beadcause writes that label on *any* bead in *any* workspace the moment you
comment without answering; read alone it would put a `revise` chip across half this tracker.
It counts only on a bead that is a review packet.

**Nothing in the card names a workspace.** The daemon hands `lib/approvalcard.js` the
workspace's pipeline, and it answers `null` for every bead outside it — and for every bead
in a workspace with none. That is the opposite call from the [model chip](#where-you-can-see-it--the-chip-and-the-row) beside it and for the opposite reason: every bead is
routed to a model, so a blank there would hide the ones worth tiering; almost no bead is a
review packet, so a chip on every card would be a chip carrying no information. Both cards
therefore draw **nothing at all** where there is nothing to say, and an ordinary sheet is
byte-for-byte what it was.

**The gate is the third readout, and only half of it is here.** A deliverable carries the
gate prefix — `milestone:G2`, *"I count towards G2"* — and a gate bead carries the bare gate
label, which means the opposite. Both cards say which gate a bead counts towards, because
that is free: it is on the row already. What they deliberately do *not* say is **how many
are left** — `bd list -l "milestone:G2" --status=open` is a query over a whole workspace and
a card is handed one bead. Deriving it per card would mean the inbox sweep and the sheet
answering it from different reads, which is the two-screens-disagree failure this whole
arrangement exists to avoid.

**Two label shapes are drawn as problems**, and the first is the worse: the review label
**without** `human`. The packet never reaches the phone — the inbox *is* `bd human list` —
*and* the advocate, whose whole definition of work is ready-minus-`human`, may open an
unattended session on it. A question nobody was asked, being answered by an agent. **Only
the bead sheet can ever draw that one**, which is the point rather than a limitation: a card
in an inbox of `human` beads is by construction not the card that could complain about a
missing `human` label. The second is a bead carrying both the bare gate label and the gate
prefix, which claims to be a gate and to count towards one.

### Approve, adjust, decline

Every proposal row has had ✓ and ✕ since proposals existed. The third control is new,
and it is there because ✓ and ✕ are a verdict on someone else's sentence and the
common case is neither: the bead is worth filing, but the title is wrong, or it is a
P1 and not a P3. Without a third option that lands as a decline — and the work comes
back next week phrased exactly the same way, because nothing recorded what was
actually wrong with it.

**✎ opens the row for editing**: title, description, what done looks like, type,
priority and [complexity](#how-hard-a-bead-is--complexitytier). Tapping it also approves the row, which is not a shortcut — adjusting a bead
is the strongest possible statement that you want it, and making you rewrite the title
and *then* hunt for the ✓ is how a considered edit turns into an accidental decline.

Labels and dependencies are deliberately not editable here. They are structural, they
are rarely what is wrong with a proposed bead, and a chip editor is not something to
build onto a card you are trying to keep short. What you do not adjust is created
exactly as proposed.

Your edits live in the app's own state, not in the DOM, so a background poll cannot
lose a word of them — the same protection the answer box gives a half-written answer.
A field you type into and then change back stops counting as an edit, because the
**adjusted** flag has to mean something. On create, only the rows you approved carry
their edits: a bead you adjusted and then declined is a bead nobody filed, and sending
the rewrite for it would put your words in the record of something that does not exist.

Every edited field goes back through the same normaliser the block is parsed with, so
a priority typed into the wrong box is clamped on the way in rather than failing at
`bd create` with half the proposal already filed.

### The repos this does not apply to

Not every workspace is a repo, and not every repo has a remote — the scratch trackers
under `~/beads/` mostly have neither. So the whole channel asks three questions before
it engages, and any "no" is a state rather than a failure:

| condition | if no |
|---|---|
| `pr.enabled` in config | every workspace keeps the old ending |
| `gh` installed and authenticated | same, and the reason is logged once |
| the checkout has a GitHub remote | that workspace keeps the old ending; the others are unaffected |

A session in a workspace without a remote is told the older brief — work the bead,
close the bead — and everything else carries on. One unremoted repo must never be able
to stop the advocate working the rest, which is the failure mode a mandatory PR
channel would have.

**A `no` to the second question expires; a `yes` does not.** The daemon starts at
login, which is often before anyone has logged into anything, so the answer it gets
first is the one most likely to be about to change — and it used to keep that answer
until the service was restarted, while telling you on every card to run `gh auth
login`, which is exactly what a process holding a cached answer cannot notice. So an
unauthenticated or missing `gh` is re-asked a minute later, backing off to a quarter of
an hour if nothing changes, and a `gh auth login` in a terminal starts working on its
own. The card names `launchctl kickstart -k gui/$(id -u)/n12n.beadcause` as well, for
when you would rather not wait the minute. A `yes` is still asked exactly once per
process — it is read on every poll, and it does not stop being true.

```json
"pr": {
  "enabled": true,
  "base": "main",
  "mergeMethod": "merge",
  "autoMerge": true,
  "requireApproval": false,
  "mergeWaitMs": 900000,
  "tidyMerged": true
}
```

`merge` — a merge commit — because ancestry is load-bearing here, and this is the one
setting where the obvious answer is the wrong one.

The obvious answer was `squash`: a session's branch is thirty commits of an agent
thinking out loud, and `main` should carry the conclusion. That is right about the log
and wrong about the cost. A squash merge writes a *new* commit with the branch's tree
and none of its history, so the branch never becomes an ancestor of anything — and the
worktree cleanup asks exactly that question, in two places, before it will remove a
directory: the `ship` skill's retirement gate, and the attic sweep that re-checks it
before deleting an entry that has aged out. Both keep anything that fails, with "NOT
merged into main — removing it destroys its only copy", and both are *right* to: that
gate is the only thing standing between the sweep and the sole copy of unmerged work.

So under `squash` every delivered worktree became a permanent attic resident, kept
forever over work that shipped last week. `merge` is the way out that needs no gate
weakened anywhere, and it matches what this repo has always actually done — every
`ship` produces a merge commit, and the log is wall-to-wall `Merge branch
'worktree-…'`. The log stays readable too: `git log --first-parent` reads exactly like
a squash history, one line per branch, with the thirty commits still there when you
want them.

`squash` is still supported and still honoured — `--method` overrides per delivery, and
the daemon's own worktree sweep covers it by asking GitHub whether the PR merged (see
`tidyMerged`). What it costs is that the attic keeps its worktrees, because nothing can
make an external `--is-ancestor` say yes.

**A stored `"squash"` is moved once, and says so.** Changing a default fixes nothing on a
machine that already has a config, because the stored value wins the merge — and this one
said `"squash"` from the day the key existed, when that *was* the default. So the first
`loadConfig` after this change edits that one value in the file, prints a line saying it
did, and records in `state.json` that the move has happened. It happens once, ever: set
`squash` back on purpose and it stays, because the receipt has been spent. The file is
edited rather than rewritten — the other settings in it are left exactly as they were,
including the ones you never set.

`autoMerge: false` is the one knob worth knowing about: it puts every delivery back on
the ask-first ending, where the worker stops after opening the pull request and the merge
is your tap. Nothing else changes — same branch, same PR, same card, same three answers —
so it is a safe thing to flip for an afternoon, and flipping it back needs no cleanup. A
worker can reach the same ending on its own for one delivery with `--review`, and the
card says which of you decided.

`requireApproval: true` is the half-measure between the two, and it is the one to reach
for when other people work in a repo: the worker still opens the pull request and still
waits for the checks, but a green one with no **approving review** on it becomes a merge
card rather than a merge. `reviewDecision` is read off the pull request the worker just
opened — `APPROVED` and nothing else counts, so *changes requested* and *review required*
both stop it — and the card says outright that a review is what is missing. Your **Merge**
is that review. This is beadcause's own gate, not GitHub's: branch protection is free to
require its own on top, and will refuse the merge in its own words if it does.

**Its default was asked about once a reviewer existed, and it stays off.** The argument for
flipping it was that "nobody is going to review it" stopped being true the moment a
ReviewAdvocate read every pull request. The answer is that the reviewer that now exists is
an *agent* and this flag is about the *human*: where a space asks for your approval the
agent's is necessary and not sufficient, and everywhere else the agent's approval alone
releases the pull request. So
[the agent's review is a separate gate in series](#the-review-gate--nothing-reaches-the-merge-without-a-verdict)
with this one rather than a replacement for it, and turning this on by default would start
demanding your tap on every delivery in the repo — the opposite of what that epic is for.
Recorded here and above the default in `lib/config.js` so the next reader can see it was
settled rather than never considered.

**Both are per space, and the global here is only the default.** `autoMerge` was one
global answer for every repo in every space, which is wrong at both edges: a side project
wants its work landed without being asked at three in the morning, and a shared repo wants
eyes on the diff. Put the answer on
[the space](asking.md#spaces--keeping-work-out-of-your-evening) instead, in either direction, and
what is below stays the fallback for everything that has not said.

`mergeWaitMs` is how long a worker waits for its checks before giving up and asking. Too
short and a repo with CI hands you every delivery as a question — a pull request is at
its most pending in the second after it is opened. Too long and a stuck CI queue holds a
worker's window open for an hour. Fifteen minutes, then it asks — measured rather than
picked: `.github/workflows/test.yml` runs the whole suite on a macOS runner in about five
minutes, and the five this used to be would have handed you nearly every delivery as a
question about a pull request that was going green on its own.

**There is a second wait, and it has no setting.** GitHub works out whether a pull request
can merge *asynchronously*: for a few seconds after a push, `mergeable` is `UNKNOWN` —
which is not "we looked and cannot tell" but "we have not looked yet" — and a merge sent
inside that window is refused with **Pull request is not mergeable**, word for word what
it says about a genuine conflict. A repo with no CI reaches the merge a second after the
push every time, because the checks wait above has nothing to wait for. So the merge
preflight polls for up to thirty seconds, three seconds apart, until GitHub has an answer;
if it never gets one it sends the merge anyway — GitHub's own endpoint is the only thing
that can settle it — and any refusal that comes back says the mergeability was still
unknown, rather than reporting a conflict nothing established. That length is not a
preference but the size of a race in somebody else's bookkeeping, so it is a constant in
`lib/pr.js` rather than a key here.

### Seeing a review at all, and who is allowed to leave one

Two facts about this particular repo sit underneath everything the review loop wants to
do, and both are the kind that read as a bug in beadcause when you meet them from above.

**`reviewDecision` cannot see an approval here, and it never will.** GitHub's
`reviewDecision` answers *does this pull request satisfy its review requirement* — not
*has anybody approved it*. A repo with no branch protection and no ruleset has no
requirement, so the answer is the empty string with an approving review sitting on the
pull request, exactly as it is with none. `NeanderthalMan/beadcause` is that repo: measured
2026-08-17 on `olduser/beadcause` (the home until 2026-09-18),
`branches/main/protection` was a 404 — and on `NeanderthalMan/beadcause` it is a 403,
protection being unavailable on a private repo on a free plan,
`.../rulesets` is `[]`, and `reviewDecision` is `""` on all thirty of the most recent
pull requests, merged and open alike. So `requireApproval` above, which reads
`reviewDecision`, is right everywhere the repo configures a requirement and blind on
this one — and a gate that waited on it would look, from the outside, like a reviewer
that reviewed and was ignored.

The fix is to ask the reviews themselves. `latestReviews` — the most recent review from
each reviewer, GitHub's own de-duplication — is in the field list `lib/pr.js` fetches,
and every pull request now carries `reviews` (author, state, association, when) and
`approvedBy` (the logins whose *latest* review is an approval, so a dismissed one stops
counting). It costs nothing measurable: a forty-row `gh pr list` with the field and
without it both came back in 3.5–4.3 seconds against this repo. Review *bodies* are
deliberately not carried — a reviewing agent writes its comments where the worker will
read them, and carrying the prose would put every review's full text into the board's
list payload, which is the cost the board already strips the pull request's own
description to avoid.

**And the account that opens a pull request can never approve it.** GitHub refuses an
approving review from the author, which is not a policy anyone here can turn off. There
are two logins on this Mac — the owner with `ADMIN` on `NeanderthalMan/beadcause`, and
`NeanderthalMan`, a collaborator with `READ` — and `lib/pr.js` has always picked the
first of those, because it picks the account that will *merge* and sweeps for one that
can write. That is the right answer to its own question and the wrong one here: the
account best qualified to merge is precisely the account that cannot approve.

So there is a second lookup beside it, `reviewerFor(dir)`, choosing by **role** rather
than by capability — an account that can see the repo and is *not* the one everything
else runs as. `READ` is enough on purpose: a collaborator with read access may submit an
approving review on a pull request it did not open, so being able to see the repo is the
whole test. On a Mac with one login it returns **null**, which is an ordinary answer and
not an error — one account cannot both open and approve, and a caller that meets a null
records the approval on the bead and says plainly that no GitHub review was submitted,
rather than failing a delivery over a second account nobody promised.

### Approving it, and saying on the page that an agent did

`approve(dir, number, { body, note })` in `lib/pr.js` is what turns a verdict into GitHub
state. It is **the only write in that file made as somebody other than the account
everything else runs as** — every other call goes out as the account `resolve` picked,
because every other call is a read or a merge, and an approval cannot be either. The
identity comes from `reviewerFor`, and `envOf` sends that account's token for these two
calls and no others.

It posts to the **reviews endpoint** rather than shelling `gh pr review --approve`, for a
reason worth one sentence: the endpoint hands back the review it just created, so the
answer carries an anchor to *the approval itself* — `…/pull/42#pullrequestreview-909` —
rather than to the pull request the approval happens to be on. That is the field the
merge-bead keeps, and it is what makes a cheap answer checkable by somebody who no longer
has the bead. It is also the endpoint an inline review comment has to go through, so
whatever needs one next extends a call that is already here.

**Three things have to be true at once, and each of them fails differently.**

**The approval is real.** Not a field on a bead claiming a review happened: a review, with
a submitter, a timestamp and a permanent URL, on the page a person opens six months later.
Proven live on 2026-08-17: `NeanderthalMan` — a `READ` collaborator — approved a pull
request the owner account had opened, which is the first review beadcause has ever put on
GitHub. Until that run, that a read collaborator may approve a pull request it did not
author was documented GitHub behaviour and nothing more. It was proved on **#404**, a probe
pull request opened for it and closed a minute later, because proving it on the branch that
*adds* the reviewer would have meant putting a claim on real work that an agent had
reviewed it when the only thing that had happened was a mechanism check. The approval and
the comment are still on that closed pull request, which is what makes this paragraph
checkable rather than a claim.

**Nobody reading it concludes Adam approved it.** GitHub's own timeline says
"NeanderthalMan approved these changes", which is a person's name as far as the page is
concerned — and here it is not a person, it is the identity the reviewer speaks as. So two
texts go on, both from `lib/reviewadvocate.js`, and they are deliberately different:

| where | what it says | why it is not the other one |
|---|---|---|
| the review body — `approvalNote` | what the reviewer thought: the verdict's prose, the login it spoke as, and that Adam has not read this diff | it sits beside the green tick, so it is the minimum disclosure; the machine block is **not** on it, because a verdict has one home and a second copy is a second thing a later round could parse |
| the last comment — `approvalComment` | what that login *is*: the account the ReviewAdvocate reviews as, chosen because GitHub will not take an approving review from the account that opened the pull request | it is at the bottom of the thread, where somebody scrolling lands, and Adam asked for it by name: *"the last comment on the PR should describe who is actually approving (ie an agent, not me)"* |

The body is **required** — an approval submitted with nothing beside it is a bare green
tick, indistinguishable from the owner glancing at a diff, so an empty one is refused
before `gh` is reached rather than submitted. The comment is posted *after* the review, so
it really is the last thing on the thread, and as the same identity that reviewed: a
comment from the *owner* explaining that the reviewer is an agent would be a second
identity vouching for the first, where from the reviewer it is the same voice that left
the review.

**And a Mac with one login is not a broken delivery.** `reviewerFor` returns null there,
`approve` returns `{ submitted: false, reason }`, and `approvedReview` still records the
approval on the merge-bead — crediting the *agent kind* rather than a login that never
reviewed anything, with an empty `approvalUrl` as the tell that this approval was never on
GitHub. Nothing is posted to the pull request in that case, deliberately: with no review
on it there is no tick to be mistaken for a person's, and a comment disclaiming one would
be disclaiming something that is not there.

`submitted` and `noted` are independent, which is the last of the failures worth naming. A
comment that fails to post *after* the review landed leaves `submitted: true` and a
sentence about the comment — because the approval is on GitHub at that point, and a caller
that read the pair as one atomic act would go on to record that a pull request with an
approval on it has none.

**What the merge-bead ends up with** is `approvedReview` folded through `withReviewBlock`:
`verdict: approved`, the reviewer login, when, and the anchor. The point of writing it at
all is that the gate then reads one field on a bead it has already loaded, rather than
asking GitHub — per merge-bead, per tick — whether anybody approved. It does *not* mark the
reviewer's comments resolved: approving means nothing blocking is left, not that every
suggestion was taken, and a declined suggestion under an approval is the disagreement the
next reviewer wants to see.

The reviewing agent still has no `gh pr review` grant, and that is now the settled answer
rather than a not-yet. An agent shelling that command in its own window would approve as
whichever login `gh` happens to be on, which here is sometimes the author of the branch.
The verdict is the agent's output; the review is submitted *for* it, by the daemon, under
an identity it cannot choose.

### Inline comments, and who is allowed to say a thread is settled

A verdict's comments live on the merge-bead as beadcause's own bookkeeping — an `id` the
worker answers by, a `resolved` flag only the reviewer writes. None of that is visible on
the pull request itself: the diff a person opens six months later shows a green tick and a
comment naming the agent, and nothing that says *this line was objected to and this is what
became of it*. `submitReview`, `reviewThreads` and `resolveThread` in `lib/pr.js` are the
seam that puts the argument where the diff is, so "unresolved" stops being something
beadcause infers from its own block and becomes GitHub's own answer.

**`submitReview(dir, number, { event, body, comments })` is the general shape `approve()`
sits on top of.** `approve()` is Adam's narrower case by name — an approval, always
disclosed, always as the reviewer — and stays exactly as it was, `-f` fields and all, with
its own pinned test. This is for the ordinary case underneath it: the ReviewAdvocate has
objections to raise on specific lines, whether or not the same review also approves.
`comments` is `{ path, line, body }`, one per objection; each becomes an inline review
comment pinned to that line, `side: RIGHT` always, since nothing here reviews a deletion.
A comment missing a path, a positive line or a body does not reach GitHub at all — it is
dropped before the call, and the answer says how many were, so a caller that gets back
`submitted: true, dropped: 2` knows the review went out lighter than it was asked to make it.

It goes to the same reviews endpoint `approve()` does — the only one that takes inline
comments at all, since `gh pr review` has no flag for one — but the request goes out as a
JSON body over `gh api --input -`, piped in on stdin, rather than as `-f` fields. That is
the one addition `gh()` itself needed: `-f`/`-F` each set a single scalar, and `comments` is
an array with no field syntax for a list. Every other call in the file leaves `input`
unset and is unchanged.

Runs under the reviewer identity for the reason `approve()` does: GitHub refuses a review —
inline comments included — from the pull request's own author. A one-login Mac returns
`{ submitted: false, reason }` rather than throwing, the same fallback `approve()` degrades
to, and for the same underlying cause: there is no second account here to submit as.

**`reviewThreads(dir, number)` reads what GitHub itself thinks a thread's state is** — its
own id, `isResolved`, and the comments inside it, each carrying the *real* comment id
(`databaseId`, the same number the REST comments endpoint would give it). REST has no idea
threads are resolvable at all; this is the one place in `lib/pr.js` that speaks GraphQL,
because `pullRequest.reviewThreads` is GraphQL-only. It is the read a review block's own
anchored ids are meant to be checked against: a comment's `resolved` flag in
`lib/mergebead.js`'s block is the reviewer *answering* a comment, where a thread's
`isResolved` here is GitHub's own state, set only by the mutation below — conflating the
two would mean "unresolved" is inferred again rather than read.

**`resolveThread(dir, threadId)` is the one write in the whole file only the reviewer may
make** — Adam's own words, *"only the reviewer marks a thread resolved."* `threadId` is
GitHub's id from `reviewThreads` above, never the review block's own comment id, which
means nothing to this mutation. There is no REST equivalent at all: `resolveReviewThread`
only exists on the GraphQL API, which is why this speaks it too.

Both run under the reviewer identity, for the same reason `submitReview` does, and both
return an ordinary `null` or `{ ..., reason }` rather than throwing on a one-login Mac or a
repo nobody here can see — every caller already has to handle that answer for `approve()`
and `reviewerFor`, so nothing above this file learns a new failure shape.

**What this does not yet do.** Nothing writes a verdict's inline comments through
`submitReview`, and nothing reads `reviewThreads` back onto a merge-bead's review block to
replace beadcause's own `id` with the real thread id it anchors to. That wiring — the
worker answering a specific GitHub thread, the reviewer resolving the ones it accepts — is
further up this epic, not here: this is the primitive the wiring calls.

### What it does to the two things that were already here

**A fourth ending.** The advocate reads three endings off a session that exits: closed,
handed back, or unfinished. A session that *handed over* a pull request is none of them —
its bead is supposed to still be open, because merging is what closes it. Without a
fourth, the second-best outcome in the system would read as "exited unfinished", cost an
attempt, and after two of them the advocate would give up on a bead whose work was
sitting in a pull request waiting on a tap.

| the file appears and… | reading |
|---|---|
| the bead is closed, reason `Landed as #42 …` | **landed #42** — the session merged its own pull request |
| the bead is closed | **done** |
| an open `pr-delivery` question names this bead | **handed over** — waiting on your merge, costs no attempt |
| the bead carries `human` | **handed back to you** |
| neither | **exited unfinished** — costs an attempt |

The first row is read off the close reason `bin/deliver.js` writes, which costs nothing:
`bd show` has already returned by then. The alternative — asking GitHub, per ended worker,
per tick — would be a `gh` call to re-derive something the delivery already knew. And the
distinction is worth drawing, because "closed by the session" is the one sentence on the
sessions page that does not say whether the work reached `main`.

**The sweep learned a second way for a branch to be gone.** Its fifth condition was
"its branch is an ancestor of `main`", and a squash-merged pull request puts a *new*
commit on main with the branch's tree and none of its history — so that test is false
forever. Every delivered worktree would have piled up unswept while the log said "not
merged into main" about work that shipped last week. So when the cheap local test says
no, and only then, the sweep asks GitHub whether the branch's PR merged. The other four
conditions are unchanged, and a repo with no `gh` behaves exactly as it did. (The
default is now a merge commit, so the local test usually answers on its own; this path
is what a deliberate `squash` still rides on.)

The retirement note says which answered: `retired by beadcause after #42` and `retired
by beadcause after a1b2c3d` are different stories, and only one of them is findable
later.

**The session log's landing note had the same blind spot**, and it is worth naming
separately because it fails more quietly. `refs/notes/beadcause` records which commit
finally brought a session's branch into main, and it found that commit by walking the
ancestry — so after a squash merge it would never find one, the note would never be
written, and the entry waiting to write it would sit in the pending list being retried
on every sweep for good. GitHub knows the answer exactly: `mergeCommit` **is** the
squash commit, which is a better anchor than the ancestry walk could produce. Same
rule as the sweep — asked only after the local test says no.

### It will not push an unresolved merge

**git commits conflict markers without a murmur.** `git add -A && git commit` in the
middle of a merge stages a file still full of `<<<<<<<` / `=======` / `>>>>>>>` and
produces a merge commit that is indistinguishable from a resolved one: right parents,
right message, nothing on stderr, nothing in `git status` afterwards. From git's point of
view those are seven characters like any other seven.

On 2026-08-11 that reached one `git push` from `origin`. Two conflict-resolver sessions
raced in `.claude/worktrees/chat-tabs-dmt` (bc-d2y6); one ran `git merge --abort` in the
window between the other's `node --check` and its `git commit`, so the commit captured
the **re-conflicted** `public/console.js`. Nothing said so. The tell, fifteen minutes
later, was `npm test` failing fourteen checks of sixteen in `test/dismissed.mjs` with
`Unexpected token '<<'`, thirty-eight suites into a hundred-and-five-suite run — which
reads as a regression in dismissal, not as *the file you are testing does not parse*. And
`public/console.js` is served to a phone.

So `bin/deliver.js` asks two questions before it pushes anything, and refuses on either:

1. **Does any changed text file carry a conflict marker?**
2. **Does every changed `.js` still parse?** — `node --check`, one file at a time, so the
   error names a file instead of a test.

Both are sub-second, and both are asked *first*: ahead of the push, ahead of `gh`, ahead
of the bead. Everything after that line writes to `origin` or to a phone, and a refusal
is only cheap while nothing has been written anywhere. `node scripts/land-check.mjs`
pins that as negative assertions — the branch must not reach the bare origin, `gh` must
not be called at all, and no delivery question must be filed, because a refusal that has
already opened a pull request has put an unmergeable one in the inbox.

**It reads the committed blob, not the working tree.** That is the whole of bc-d2y6: the
tree can be spotless while `HEAD` is broken, which is exactly what happens when the file
is repaired *after* the commit rather than before it. Every working-tree check passes over
that branch. `git show <ref>:<path>` does not.

**`=======` is deliberately not one of the markers.** It is the one of the three that
occurs in real text — a setext `<h1>` underline in Markdown, and this documentation is 2.6MB of
Markdown. `<<<<<<<`, `>>>>>>>` and diff3's `|||||||` never occur by accident, and a real
conflict has all of them, so dropping the ambiguous one costs no detection and buys a
check that cannot cry wolf. Exactly seven, at the start of a line, followed by a space or
the end of it, which is what git writes. Binary files are skipped on git's own
`--numstat` verdict rather than on their extension, and deleted files are skipped because
they have no blob to read.

The same check, by hand or a commit earlier:

```bash
npm run conflicts                                # this branch, against origin/main
node scripts/conflict-check.mjs --staged         # what `git commit` would write now
node scripts/conflict-check.mjs --commit HEAD~1  # one commit, against its parent
node scripts/conflict-check.mjs --install-hook   # and stop having to remember
```

`--install-hook` writes a `pre-commit` hook, and **one install covers every worktree of
this repo** — git resolves hooks through the *common* git directory, so a hook written
once in the main checkout is already running in all twenty-five, including ones created
after the install. It refuses to overwrite a `pre-commit` it did not write, and prints
the line to add instead. `git commit --no-verify` still skips it, as it skips every hook;
that is the right answer for a repo whose subject is unattended agents, because the guard
that cannot be bypassed on purpose is the one somebody disables permanently at three in
the morning. `bin/deliver.js` has no `--no-verify` to reach for, and it is the one that
actually stands between a broken file and `origin`.

**That resolution goes through `core.hooksPath` first, and this repo has already been
bitten by that once — bc-y3qk.13.** A stray `bd init` run at some point had set it to
`.beads/hooks`; the `.beads` directory was later removed, the config line was not, and
git does not warn when `core.hooksPath` names a directory that does not exist — it just
runs no hook, silently, in the main checkout and in every worktree at once, because they
all resolve the same config. `--install-hook` would have made that worse rather than
catching it: `mkdirSync` does not care whether the path it is creating is a real hooks
directory or an invented one, so it would have written a working `pre-commit` into
`.beads/hooks`, reported success, and left the guard live only until something next
deleted that directory. So `--install-hook` now checks that the path `core.hooksPath`
resolves to is inside this repo's own git directory before writing anything, and refuses
— naming the exact `git config --local --unset core.hooksPath` to run — when it is not.
The resolver commit that put committed conflict markers on `main` (bc-h2iz) would have
been refused by the hook this repo believed was already installed, had this held then.

### The other beads a branch carried — `--also`

A pull request **declares one bead**, the one `-b` names, and the merge closes that bead
and only that one. That is on purpose: `candidateTiers` in `lib/beadref.js` reads the
`bead:` block as a tier of its own above the ids merely named in a title or a branch,
because a merge that closed everything it mentioned once closed a bead a documentation
change only cited (bc-khoe.30.16). The other half of that is the failure this section is
about: a branch that genuinely delivered a *second* bead left it open with no blocker,
straight back in `bd ready`, and an advocate opened a worker window over work already in a
pull request — bc-cigq6, on PR #98, whose whole window was reading the branch and writing
a supersede marker (bc-jvt0.7).

`beadcause-deliver … -b <lead> --also <bead> [--also <bead>]` speaks for each of them, on
whichever ending the delivery takes (the queue, a `--review` card, or a branch already
merged on github.com). For each one it:

- writes **`superseded-by:<lead>`** — the marker `bin/supersede.js` writes, through the
  same `mark` in `lib/superseded.js`. It takes the bead out of every queue and *nothing
  releases it*; when the lead closes, `sweepSuperseded` raises the one-tap close card
  whose comment is the next item. It is not a blocking edge onto the merge-bead, which was
  the first suggestion and is the wrong one: an edge clears the moment the merge lands, and
  the bead is back in the queue with its work already on `main`.
- sets a claimed bead back to `open` (the sweep reads open rows only), draws the edge onto
  the lead (a `relates-to` when the lead is an epic, which bd will not let a task be
  blocked by), and never writes `human`, which would prevent the card for good;
- **comments on it** naming the pull request and the lead, and says the same on the lead
  and on the pull request.

What it does **not** do is widen the merge: the pull request body still declares `-b`
alone, and the suite asserts the other ids are not in it. An id that is not a bead in the
workspace, or that is `-b` itself, is refused before anything is pushed; one that is
already closed, or already carries a different marker, is said on stderr and skipped — the
delivery is never failed over it. The group section of a worker's brief tells a window with
siblings about the flag; a window on a plain bead is not told, because it has no other bead
to name. `test/deliveralso.mjs` drives the real `bin/deliver.js` over a real bare remote
with fake `gh` and `bd`.

### Checking it

`npm test` covers three libraries. `test/pr.mjs` drives `lib/pr.js` against a fake `gh` on
`PATH`, keyed off a JSON world file and a call log, so *"it never shelled out"* is an
assertion rather than a hope — including the wait for the checks, whose `sleep` is
injected and is where the fake's world changes, so pending-then-green runs in
milliseconds. `test/delivery.mjs` covers the block, the markers, the split, and that the
four openings of a card are four different sentences. `test/approval.mjs` covers the
per-space half end to end — `prPolicyFor` resolving both answers in both directions, and
the real `bin/deliver.js` against the same fakes, where the assertion that matters is
again a negative one: a green, unapproved pull request in a require-approval space must
leave no `gh pr merge` in the call log at all, and must produce a card that says it is
waiting on a review rather than that auto-merge is off. `test/land.mjs` covers the thing
with no other interface: the **brief**, which is all beadcause can make a worker do. It
asserts that the landing ending never tells a session to merge `main` by hand, that its
marker line cannot claim `CAN BE MERGED` over work already in `main`, that the ask-first
ending can claim nothing but a review, and that `pr.autoMerge` reaches the brief it
decides. None of the three touches the network, a bead, or a repo.

`node scripts/land-check.mjs` is the end-to-end half, and it is the only place the merge
itself is exercised: a real `git` against a real bare remote, a real `bd` against a
scratch workspace under `/tmp`, the real `bin/deliver.js`, and a fake `gh` that logs every
call. Eight scenarios — green checks, a refusal from GitHub, a red check, `--review`,
`--owed`, where the merge method comes from, the local fast-forward, and a commit
carrying an unresolved merge. The fast-forward is
the only scenario that delivers from a real `git worktree`, because that is where a worker
delivers from and the whole behaviour turns on it: the fake `gh` moves the bare origin's
`main` on merge, and the checks are that the main checkout ends up at `origin/main`, that
it is left alone with the reason on the bead when there is an uncommitted *edit* in it,
and that it follows anyway — residue untouched on disk — when the only dirt is untracked.
The assertions that matter are the negative ones: `gh pr merge` must not appear
in the log for the red check or for `--review`, and the work bead must still be open in
every scenario that did not merge, because a bead closed over work sitting in an unmerged
pull request is invisible from every screen in the app. `BEADCAUSE_CONFIG_DIR` points it
at a scratch config whose ntfy is off, so a harness run cannot reach anyone's phone;
`--keep` leaves the temp world for inspection.

The unresolved-merge scenario is negative all the way through, for the reason above: it
commits the markers the way one really gets committed (`git add -A`, `--no-verify`, no
complaint from git) and then asserts that the branch never reached the bare origin, that
`gh` was not called *once*, that the bead is still open and that no question was filed —
a refusal that has already pushed has published the broken file, and one that has already
asked has put an unmergeable pull request on the phone. It ends by delivering the same
branch resolved, so the refusal is provably about the markers and not about anything else
the scenario did. `test/conflicted.mjs` covers the detection underneath it against a real
scratch repo, and most of its checks are about what must *not* be found: `=======` under a
Markdown heading, six or twenty `<` rather than seven, a marker in the middle of a line, a
binary blob, a deleted file, and a `.txt` that would not parse as JavaScript and is not
asked to. A guard that refuses a delivery it should not is worse than no guard, because
the answer to it is to take it out.

**And it runs inside `npm test`**, via a wrapper at `test/landcheck.mjs` — which is the whole
of what that file is for. It used to be outside, on the same reasoning as the
browser checks below, and that reasoning does not hold for it: those need headless Chrome and
in two cases a vendored `public/vendor`, while land-check needs only `bd`, which is the tool
this project is a client of. The cost of it being outside was measured rather than guessed:
bc-4fq was a bug in `bin/deliver.js`'s argument handling and every other suite in the gate
passed over it, before the fix and after. Without `bd` the wrapper **skips loudly and exits 0** — a
machine that cannot run beadcause should not fail a gate over it — and it reads land-check's
own exit 2 (*"cannot build a scratch workspace"*) as the same kind of skip, which is the
distinction that code was already drawing. A *missing* `scripts/land-check.mjs`, on the
other hand, fails: coverage
quietly ceasing to exist is the failure being fixed, not a thing to shrug at. It is the
slowest suite bar `scripts/test-swap.js` — 70s on its own, 90s from inside a full run —
and nearly all of that is `bd`.

`node scripts/delivery-check.mjs` is the other half: the real `public/app.js` in a
headless Chrome the size of a phone, against a fixture built by `lib/delivery.js` and
parsed back by `lib/decision.js`, with `/api/pr` stubbed through its four states. It
asserts the things only a browser can answer — that a failing check is named and still
leaves merge pressable, that a conflict disables it and says why, that one tap arms
and two send, that typed prose leaves with `CHANGES:` and can never leave with
`MERGE:`, and that adjusting a row survives a background poll and rides out with the
create. `--out=<dir>` writes a screenshot; `--keep` leaves it served so you can open it
yourself. It needs `npm run vendor` to have run — a fresh worktree has no
`public/vendor`, and without it the app throws on its first markdown render and the
list never appears, which looks exactly like a bug in whatever you just changed.

`.gitignore` says `public/vendor` with **no trailing slash**, and that detail is bc-slxm.
A pattern ending in `/` matches directories only, so a session that linked the directory
in from the main checkout instead of rebuilding it left git reporting `?? public/vendor` —
and `beadcause-deliver` refuses a worktree with uncommitted changes in it, at the very
end, after the suite had already passed. `node_modules` above it has always been spelled
without the slash, which is why only vendor bit.

### The cache version a branch forgot to move

`public/sw.js` precaches every path in `SHELL` under one key, `const CACHE =
'beadcause-vNN'`, and moving that number is the whole of what stops a phone holding
Tuesday's `app.js` beside Thursday's `style.css`. Whether a branch owes the move is a
judgement — most changes under `public/` do not, and a bump costs every installed phone
a full re-download of the shell — so it is made by reading the diff. Several suites
assert that a particular file is *listed* in `SHELL`. Nothing asked the other question.

bc-dmt (#115) is what that costs. `public/console.js` gained two calls to
`chat.queue.repaint()`; `public/sendqueue.js` gained the `repaint` key they call, on the
same branch. Both files are in `SHELL`, `const CACHE` was byte-identical to main, all
120-odd suites were green and the pull request was clean and mergeable — and a phone
holding the old `sendqueue.js` beside the new `console.js` throws a `TypeError` on the
one gesture the branch adds. It was caught by somebody reading the diff by eye, and then
two more sessions spent an evening each re-deriving the same finding, one of them nearly
fooled by the five `repaint`s already in the old `sendqueue.js` — every one of them
prose in a comment.

`test/swbump.mjs` asks it now, on every `npm test`, about the branch you are on. It
compares the working tree against the `main` it grew from, so the answer arrives before
the commit rather than after it, and it says one of four things:

- **An advisory, which never fails the run.** Two or more files in `SHELL` changed and
  `const CACHE` did not move: here they are, decide. That over-reports on purpose. The
  purely additive change legitimately skips the bump — bc-p38c.2 put `report.js` on all
  twelve pages and owed nothing, because cached HTML without the new tag is the app
  exactly as it was — and a check that turned that into a failure would be taken out
  within a week.
- **A failure, which is not a judgement.** One modified `SHELL` file gained a member,
  another modified `SHELL` file gained a *call* to it, and the version did not move.
  That is the bc-dmt shape, and on the mixed pair the call lands on `undefined` and
  throws. Both halves have to have existed before the branch: two files added together
  are never a mixed pair, because a cache from before the branch has neither.
- **A named pair inside the advisory.** One modified `SHELL` file newly *draws* a class
  or id and another newly *styles* it — the stylesheet shape, below. It does not fail
  the run; it turns "these five files moved, decide" into "`console.js` newly draws
  `.bead-dupe`, which `style.css` only gained on this branch".
- **A file added whole that a cached page cannot load.** A new `SHELL` file whose only
  way onto a page is a `<script src>` tag another `SHELL` file only just gained, and
  which a third one now calls into off the window. Which side of the line that lands on
  is decided by the caller: reached flat it is a `TypeError` and red, and reached behind
  `&&` or `?.` it is a control that silently does not appear, and it is named inside the
  advisory. The script-tag shape, below.

The reading is deliberately narrow. Comments are stripped before a line is read, and a
member counts as gained only if it is *defined* at head and not at base — appearing in
the file is not enough, which is the difference between catching bc-dmt and being fooled
by the same comments that fooled a human. Bare reads (`.thing` with no call) are left
out: a missing member read is `undefined`, which may well be harmless, and only the
half that fails a branch has to be certain. Against the last 80 merges on `main` the
failing half fires exactly once — on bc-dmt — and the advisory on eleven.

The analysis itself is `lib/swbump.js` and reads nothing: the caller hands it the two
versions of each changed file and the lines the diff added. So the suite can be pointed
at any two revisions, which is how the two branches the rule was written from are
regression-tested in place:

```
node test/swbump.mjs                                     # this branch, working tree included
node test/swbump.mjs --base 65745de5^2 --head 65745de5   # bc-dmt: flagged
node test/swbump.mjs --base cbfd7367^  --head cbfd7367   # bc-p38c.2: silent
node test/swbump.mjs --base e7aa8e68^1 --head e7aa8e68^2 # bc-pzti: the stylesheet pair
```

bc-nib3.3, the branch the script-tag half is written from, is the one that cannot be
replayed that way — it *bumped*, so pointed at its own revisions the check is correctly
silent. The suite pins its `const CACHE` back to the value it had first, which is the
state the branch was actually in when swbump shrugged at it.

### The stylesheet half of the same pair

A member name cannot see the case `public/sw.js`'s own version notes argue about most.
v37's is the canonical one: `console.html` against v36's `style.css` draws the nav as a
run of unstyled links, "which still works, which is exactly the 'looks like a working
page' failure a cache version exists to prevent". Nothing is missing and nothing throws
— the page is simply laid out by a stylesheet that has never heard of it. Until bc-jdwc
that shape landed in the advisory alongside everything else, as two files that moved.

The same trick works on it, from the other side of the diff. `styleSelectors` reads a
stylesheet for the classes and ids it *styles* — only the run before each `{`, because
`background: #141a22` is a declaration and a reader that swept the whole file would
report `#141a22` as a styled id on every branch that touched a colour.
`markupSelectorUses` reads the four shapes this app puts a name on the page with: a
`class=` or `id=` attribute, an assignment to `.className`, and `classList.add` /
`.toggle`. Interpolated tokens (`class="chip ${tone}"`) are dropped rather than guessed
at. A pair is a name that *both* halves gained: the sheet styles it now and did not
before, and the page draws it now and did not before. That is what keeps the churn out
— restyling a `.chip` the page already drew is merely older, and drawing a `.chip` the
sheet already styles is merely older too. It is only when neither cached half has heard
of the name that a phone holding one of them lays out nothing for it.

It sits inside the advisory rather than beside the failure, and that is measured rather
than asserted. Replayed over the last 75 pull requests to merge, it names a pair on
exactly one unbumped branch — bc-pzti (#209), which gained a `class="bead-dupe"`
duplicate warning in `console.js`, the block that lays it out in `style.css`, and did
not touch `public/sw.js` at all — and it independently finds the coupling on **12 of the
13 branches that did bump**. So it agrees with almost every bump a human made, and it
raises no alarm the advisory was not raising already: a pair needs two modified `SHELL`
files, which is the advisory's own condition. Over a wider 211 merges the numbers hold
their shape — 16 unbumped fires, and 20 of the 25 real bumps explained.

What it cannot do is price the damage, and that is the reason it is not red. `.bead-dupe`
unstyled is a warning in the wrong colour on a page that otherwise works; v37's nav
unstyled is a screen with no navigation on it. The check finds the pair and names both
halves of it; how much an unstyled name costs is the judgement, and it stays with the
person reading the diff — who, unlike this file, can open the page.

### The script tag that is the other half

Both rules above pair two files the branch *modified*, and "a file added whole, with its
callers, is never a mixed pair" is a rule with a suite of its own: a cache from before
the branch has neither half of it, so there is nothing to disagree with.

bc-nib3.3 (#247) is the shape that goes straight through the middle of that. The
collapsing filter chrome came out of `public/inboxfilter.js` into a new
`public/filtermenu.js` so the History tab could mount the same control instead of a
second implementation of it. The new file is *added*, so it is neither half of a member
pair; the thing that puts `window.beadcause.filterMenu` on the page is a `<script src>`
tag, which is markup rather than a call; and `inboxfilter.js` — a file the cache has had
all along — gained `window.beadcause.filterMenu.mount(host, …)`. The pair that actually
breaks is the phone's *old* `index.html`, which has no such tag, beside the branch's new
`inboxfilter.js`, and it takes the inbox's whole filter bar out with a `TypeError`.
swbump printed an advisory. The bump was made anyway, argued out by hand in
`docs/sw-cache/v51.md` — which is the hand-written version of the failure the check
should have printed — and the next session lifting a shared browser module would have
read "advisory" and skipped it.

So the added file is not one half of this pair. The *page that loads it* is, and the
page is a file the cache has had all along and this branch edited. `scriptSrcs` reads
the tags a page gained, `globalInstalls` reads the surface the new file puts on the
window — skipping the `window.beadcause = window.beadcause || {}` line every one of
these files carries, which is nobody's surface in particular — and `globalCalls` reads
what another modified `SHELL` file newly reaches for through it.

Which strength it lands at is decided by the caller, and bc-nib3.3 has one of each in a
single commit. `inboxfilter.js` calls `mount` flat, on a page that cannot have loaded
the file: that is a `TypeError`, and it is red. `history.js` mounts the identical
control behind `if (host && window.beadcause && window.beadcause.filterMenu)`, so a
phone without the file draws a ledger with no filter bar and throws nothing — the
"looks like a working page" failure again, named inside the advisory and left to the
reader to price. An optional-chained `window.beadcause?.filterMenu?.mount(…)` counts as
the same guard for the same reason.

It is quiet by construction, and that is measured the way the stylesheet half was.
Replayed over every one of the 240 merges `main` has ever had, it fires on **no unbumped
branch at all**, and independently explains **4 of the 31 that did bump** — bc-nib3.3's
own diff, bc-rk2o putting every view on the delta stream behind a new `stream.js`,
bc-xqnj's `spacebar.js`, and the branch that first added `sendqueue.js`. Every one of
those is a new shared module arriving with the tags that load it, which is exactly the
work this fires on and exactly the work a human bumped for. `bc-p38c.2` stays silent
under it for the reason it always did: `report.js` went onto twelve pages and nothing
gained a call into it, so cached HTML without the tag is the app exactly as it was.
