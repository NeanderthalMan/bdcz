# Advocates — an agent per repo

## Advocates — an agent per repo, whose job is the queue reaching zero

Everything above is a **channel**. A question reaches your phone, an answer reaches
the bead, a comment reaches an agent. None of it ever cared whether the work got
done — so a repo could sit on nine ready beads for a fortnight, and the daemon that
knew about all nine would say nothing, because none of them was labelled `human` and
nobody had asked.

An advocate is the missing party: one per repo, interested in nothing except *that*
repo's queue reaching zero.

```
poll tick ──► bd ready (minus human, minus P4)
                 │
                 ├── something ready, a slot free ──► iTerm2 + claude on the bead
                 │                                        │
                 │                                   bd close ──► slot frees
                 └── nothing ready ──► survey agent ──► "create these 3?" ──► your phone
                                                                  │
                                                     you tap create ──► bd create ×3
```

Turn them on by naming repos — the list is empty out of the box, because something
that opens Claude sessions on your Mac unprompted should never be a surprise. This is
the setting; there is [a switch for it on the console](#which-repos-have-one-from-the-console)
that writes the same list without a restart:

```json
"advocates": {
  "workspaces": ["sorrel", "beadcause"],
  "maxWorkers": 1,
  "maxWorkersLimit": 3,
  "globalMaxWorkers": 20,
  "perWorkspace": { "sorrel": { "maxWorkers": 2 } }
}
```

### Which repos have one, from the console

That list is also a switch on every card in the advocate console, which is where you
will actually want it: the moment you know a repo should have an advocate is the moment
you are looking at what it is not doing, on a phone, and the alternative used to be
`~/.config/beadcause/config.json` on the Mac followed by a restart — because
`bin/beadcause.js` reads the list once, at boot. Giving northwind one took a `node`
script plus `npm run swap`, and nothing on the console said the setting existed.

A repo with no advocate has always been drawn as a plain card saying `no advocate`, and
that card now carries **Turn on**; an advocate's own card carries **Turn off**, last in
the row of controls. Both write `advocates.workspaces` *and* reconcile the running
daemon, so the advocate starts ticking on the next poll and is still there after a
`launchctl kickstart` — the two halves that can each be wrong on their own.

**Turning one off drains it rather than killing it.** An advocate is the only record of
the iTerm windows it opened: which bead each is on, when to ask it to check in, when its
bead has closed and the window may be signalled. So the setting goes off immediately —
nothing new is launched, and it stops surveying the queue at all — while the sessions it
already opened keep being reaped, archived and asked about by the advocate that opened
them. Its card says `switched off · 2 sessions still finishing`, and the card goes on the
first tick that finds nothing left. Turning it back on mid-drain takes the drain off and
hands it back the sessions it never let go of.

The drain is a *live* state and is deliberately not written down: `advocates.json` would
then hold a second copy of "this repo has no advocate" that can disagree with the config,
and a daemon restarted mid-drain would resurrect an advocate for a repo the config says is
off. So a restart mid-drain leaves those windows exactly where a repo with no advocate
leaves them — running, and nobody's to reap, since [the finished-window sweep](#the-windows-nobody-is-holding)
runs per advocate over its own repo. That is the same bargain the switch makes anyway; it
is only worth knowing that the restart brings it forward.

**Where the switch would be a lie, there is a sentence instead.** Three settings can make
a repo un-switchable, and none of them is visible from the console, so the daemon says
which it is and the button is not drawn at all:

| What is set | What the card says instead |
|---|---|
| `advocates.enabled: false` | every advocate is off, whatever the list says |
| `advocates.workspaces: "*"` | every configured repo already has one, and there is no list to take this out of |
| a space's `advocate: false` | that space vetoes every workspace in it — see [Spaces](asking.md#spaces--keeping-work-out-of-your-evening) |

The `"*"` case is the one worth an argument. Expanding the star into a frozen list would
make one Off button work and silently stop every repo added afterwards from getting an
advocate, which is precisely the thing the star was chosen to say. The space veto is the
same judgement in the other direction: it is a setting on a *group*, deliberately above
the per-repo switch, so a repo written into the list under one still gets nothing.

An observer instance refuses both, with a 403 — its `cfg` is the live daemon's config
file, so a press there would hand the *other* process a repo to open windows on, which
is the one kind of press an instance that never acts must not make.

### It has no clock

There is no schedule and no interval to tune. The daemon is already asking every
workspace what is ready every `pollSeconds`, and *a bead becoming actionable* is the
event worth waking for — so the advocates run on that same tick. Adding a timer would
only mean two answers that can disagree. The tick runs **after** the pushes, so a slow
`bd ready` across six workspaces can never delay a question reaching your phone.

### What counts as work

`bd ready`, which is already blocker-aware: it excludes `in_progress`, `blocked`,
`deferred` and hooked issues, so an advocate never pushes at something only another
bead can move. On top of that, two exclusions of our own:

- **`human` beads are yours.** A question is not work an agent can do.
- **P4 is a backlog** — a list of things deliberately not being done. Without this
  the queue can never reach zero and "clear" stops meaning anything. Move the line
  with `minPriority`.
- **The same job twice is one session.** Two beads can carry near-identical titles
  without anyone proposing anything — filed by hand, pulled in from JIRA, or created
  by an approval that *was* flagged as a duplicate and that you tapped anyway. Both
  are ready, and the second window's first act would be to find the work already
  committed on the first one's branch. So a bead whose title matches one that is
  already in progress — or that a session is already open on — waits for it, at the
  same near-verbatim threshold that refuses a duplicate approval. Waits, not
  disappears: it is a pill on the repo's advocate card naming the bead it is behind,
  and it goes back in the queue by itself when that one closes.
- **A container is not work at all.** Some beads are shelves — the standing roots
  everything else is filed under, which exist so that other work has somewhere to go and
  are never themselves finished. They carry a `container` label and they are out of every
  queue and every count. See [a standing root is furniture, not
  work](#a-standing-root-is-furniture-not-work).
- **A bead whose pull request is already open is not ready.** The work exists, on a
  branch, and what happens to it next is a merge, a review or a conflict resolution —
  none of which is a fresh session's job, and a worker briefed to *merge* opened beside a
  resolver briefed that the merge is not its to make is how a branch lands out from under
  a review. Held, with the pull request number on the card. See [the bead whose work is
  already in an open pull
  request](#the-bead-whose-work-is-already-in-an-open-pull-request).

When that set is empty the advocate says **clear** and stops. That is the whole of
"done".

### An epic is planned, not worked — and each group gets its own window

An epic is not a bead. Its children are the work, and an advocate that opened a session
on one used to be opening a window whose only honest move was to write nothing, because
a sibling window already held the first child. The first answer to that was to *hold* the
epic and let each child take its own tick. The second was to hand one worker the epic and
all its ready children at once, so that somebody could see which of them belonged in the
same change. Both are still here, and neither is what happens now by default.

The problem with handing one window five beads is the window. It has one context, one
`workerTimeoutMinutes`, and no way to be resumed: it either runs out of room three beads
in, or it holds a worker slot for the rest of the day. A session that watched an epic all
the way from planning to a production deploy would be measured in days, and a daemon
restarted in the middle of it forgets its workers entirely.

So an epic gets an **epic worker**, and an epic worker plans:

1. It reads the epic and everything under it, and **files the beads it decides should
   exist** — through the same `beadcause-file` every other agent uses, so they arrive
   `unendorsed` and nothing opens a window on one until you have looked at it. There is
   deliberately no path by which a planner endorses its own subtree.
2. It **groups** the beads. A group is one session, in one checkout, doing those beads as
   one change. That is the judgement the window exists to make, and it is the one thing
   here that a rule could not have produced.
3. It writes **each group's prompt** — what the group is, what order the parts go in, and
   whatever it worked out reading the code that the beads themselves do not say — along
   with how many pull requests that group will open and in which repos.
4. It runs `beadcause-plan`, which checks the whole thing, writes it onto the epic, and
   hands the epic back to the queue. Then the window closes. It writes no code.

From the next tick the advocate opens **one child-worker per group**, each briefed on its
own beads and carrying the planner's paragraph as a quoted section *inside* the ordinary
worker brief — the claim, the endings, the marker step and the delivery command are all
still the generated ones. That matters more than it reads: the brief is the entire
interface between this daemon and an unattended agent, and it is asserted line by line in
`test/land.mjs` precisely because of that. A group's prompt is the only text in any brief
here that another agent wrote, so it is quoted rather than spliced, it is capped, and
`beadcause-plan` refuses outright a prompt containing the phrases that belong to the
generated brief — the marker line, the delivery command, a label removal.

**The plan is a document on the epic bead, not state in a window**, and that is the whole
design. It is a comment carrying a fenced JSON block, so a revision cannot lose a write to
whatever else touched the bead in the same minute and every earlier version is still
there. Every tick reads it fresh, which is what makes the dispatch self-healing: the
"lead" bead of a group — the one the window is opened on — is simply whichever of the
group is first in this tick's queue, so a group whose window ended picks its remaining
work back up on the next one, and a live window anywhere in a group holds all of it.

**A group member the queue never reaches is still named, and told why — bc-ogicx.12.**
`dispatchable` used to render only the beads this tick's queue actually held, so a bead
the plan named that the queue did not reach was silently missing from the brief: no line,
not even "and one more you cannot see." A P4 member is the sharp case, not an unlucky one
— the advocate's own priority floor (`minPriority`) drops it before the queue is even
built, so it is invisible to `dispatchable` on *every* tick, forever, not on the one the
plan happened to be written on. The brief now carries the plan's whole membership: a
member sitting only below the priority floor is offered as more work — nothing is in its
way, so the window should simply do it too — while every other absence (`unendorsed`,
`human`, already closed, or the residual case that only an unclosed dependency explains)
is named without a `bd show` to run, because that is a bead nobody has cleared for this
window to touch.

**Nothing is supervised by a window that stays open.** There is exactly one event that
re-opens a planner: a bead comes up ready under the epic that no group names — in
practice, work a child-worker filed and you have since endorsed. The planner is re-entered
to fold it in, is told it is revising so it leaves the groups already running alone, and
everything under that epic waits for the one tick that takes, because dispatching a group
against a plan being rewritten is a window briefed on a plan that will not exist by the
time it opens a file.

When every bead the plan named has closed — beads close on merge — the epic's work is in
`main`, and what is left is not a window. beadcause files a **promotion bead**: one per
epic, naming the repos whose merge build has to go to UAT, be tested, and be promoted to
production and tested again. That is not the same thing as the [release
queue](pull-requests.md#the-release-queue--the-number-over-ship)'s bead, which is one per *merge* and
closes when a `launchctl kickstart` makes it live on this Mac. One epic produces one
promotion bead and, on the way, four or five ship beads. They differ in both of the two
things a board sorts on — a `promote` label against `ship`, and a `chore` type against
`task` — because two things called a release bead, settling on different evidence, is a
board that lies.

**"Every bead has closed" is asked of the tracker's rows, and it used not to be.** Until
bc-4bet.2 the test was "nothing of this plan is in the queue and nothing is running", and
that reads *not-ready* as *done*: the queue is the advocate's, which excludes `unendorsed`
by design, and a bead blocked behind a dependency is not in `bd ready` either. Both are open
work nobody has started, and both looked exactly like a group that had finished — so a
promotion bead went out on 2026-08-14 saying an epic's work was in `main` over two beads
that had never been touched. The check is now a status check: a plan is done when every bead
it named is *closed*, read off the same cached `bd export` the advocate already takes once a
tick, so it costs no tracker call of its own. A bead the export has no row for — a cold
cache, an export that failed — is **not** closed, and nothing is filed; the promotion bead
asks a release agent for UAT and production, and a false premise stated as fact on one is
worse than no bead at all. Where an epic is waiting like that, the card says which of its
beads have not closed rather than only that it is holding.

#### What a group is *for*, and how a planner learns its plan ran

Two things a planner had no way to know, and neither of them was a bug in any code that
ran — they were both things nothing said.

**A group is one change, and a shared file is not one.** The brief said what a group may
not be (two repos, two groups over one bead, two groups declaring one file) and never said
what one is *for*, so "these beads all live in `lib/sync.js`" read as a reason to put them
in a window together. Measured on bc-y3qk: four beads were grouped on exactly that
reasoning, ran as four windows anyway, and merged as four pull requests seven minutes apart
— three of them touching `lib/sync.js`, `lib/server.js` and `test/sync.mjs` together, with
no collision at all. The merge queue downmerges the base into each branch before it merges
it, so two pull requests over one file are serialised rather than conflicted; grouping to
avoid a file collision buys protection that already exists, and pays three windows that did
not run for it. So `planPromptFor` now states the rule it was missing: group beads only
where they genuinely cannot be done apart — a later bead that cannot be written until an
earlier one's *decision* exists, or a split that would put half a mechanism in each pull
request and leave `main` coherent in neither. Shared files fail both tests, and so do "same
subsystem" and "same author". The cost of getting it wrong is asymmetric and that is said
outright: under-grouping is loud, because a window arrives, finds it cannot do its bead
alone, and says so. Over-grouping is silent, and a four-bead group is three windows nobody
will ever be told did not run.

**And a plan that was ignored looked exactly like a plan that was obeyed.** A planner files
its plan, gets exit 0, and exits — it is re-entrant by design, so the party who would care
has already gone by the time the next tick dispatches. On bc-y3qk the plan said two groups
and the daemon opened five windows, one per bead, and every surface reachable from the
tracker said it had worked: the `planned` label was on the epic, the plan comment parsed,
the epic was open and unassigned, and the children were `in_progress` — which is what a
dispatched group looks like too. The only evidence that existed was the *wording* of a log
line, `opened a session on bc-36xx.7 for "the review gate" in bc-36xx's plan` against a bare
`opened a session on bc-y3qk.3`, and knowing that contrast requires having seen both.

So the dispatch leaves a mark where the plan lives. When a group takes a window the advocate
stamps its epic `dispatched:<the group's name, slugged>` — one label per group, beside the
`planned` it already carries — and the planner's brief says to look for it. `planned` with a
`dispatched:` label per group is a plan that ran; `planned` with none of them, over children
that are in progress or closed, is a plan that was passed over. The slug is not decoration:
bd splits a label on the comma and normalises nothing else, so a group name written through
unchanged would arrive as two labels, neither of them the group.

**Nothing in the daemon reads the mark, and that is deliberate.** Dispatch is recomputed
from the plan and the queue every tick, and what stops a second window inside one group is
the live worker list. A label that were consulted would be state that can be wrong — lost to
a `bd` that would not answer, or to an edit from a phone that posts the label set a card is
showing — and a lost mark would then stop work rather than merely stop explaining it. It is
a record, and a record is allowed to be incomplete in a way a decision is not. That is also
why it is not protected in `lib/verdict.js`, alongside `planned` and `promoted`: all three
are daemon-written markers whose loss costs an explanation rather than an hour. `dispatchLabel`
in lib/advocate.js is the whole of it, and `test/plandispatch.mjs` is what pins the brief's
spelling of the prefix to the code's, because the brief cannot import it — lib/advocate.js
imports lib/session.js to open the windows, so the reverse would be a cycle.

#### A plan reaches the whole subtree, and for a long time it reached one level

Two pieces of this file asked the same question — *is this bead under that epic?* — and
answered it differently, and the disagreement had a direction that made it expensive.

`unplanned` walks the tracker's **parent edges**, at any depth. That is what decides whether
a planner is re-opened: a bead comes up ready anywhere under the epic and no group names it,
so the plan is out of date and everything under that epic waits for the one tick a rewrite
takes. `validatePlan` checked the ids a group named against **`bd children`**, which is one
level and nothing more, and refused anything else with *"which bc-x has no child by"*. That
sentence was true about what the check could see and false about what the rest of the
machinery does.

So an epic with a sub-epic had beads it was **required to cover and forbidden to name**. The
loose grandchild held every ready bead in the subtree, the planner was re-opened to fold it
in, `beadcause-plan` refused the plan that folded it in, and the same thing happened again on
the next tick until the two-attempt fuse blew — after which dispatch resumed with the bead
ungrouped, one window per bead, in the subtree whose recurring failure is two windows editing
`public/app.js` at once. It was not a rare shape: bc-khoe reached eleven such beads across two
sub-epics, and the answer for a year was to flatten the tree or split the epic by hand.

The fix is not a new rule. It is giving `validatePlan` the graph `unplanned` already had:
`bin/plan.js` reads `bd.graph`'s parent edges beside its `bd children` call and passes them,
and membership becomes `isUnder(id, epic, parents)` — the same function, on the same edges, as
the sweep that re-opens the window. A grandchild is nameable exactly as a child is, at any
depth; a bead adopted in with `bd update --parent` is under the epic whatever its id says; and
one that was **reparented out** is refused however much its id still looks like a member,
which the one-level check could not see either.

**The graph is preferred, not required, and the fallback is the point of the design.** An
export that will not run leaves `children` in place — the narrow check still takes every plan
it ever took, so the cost is one run that cannot name a grandchild, and `beadcause-plan` says
so on stderr rather than leaving a planner to discover it as a refusal it cannot act on. There
is a second, quieter way to have no graph and it is the one worth guarding: an **empty** index
carries no error, and `isUnder` deliberately falls back to the id for a bead the graph has no
row for — so believing an empty index would admit every id-shaped guess *and* take the
`children` check off in the same move. `bin/plan.js` therefore asks whether the index has a row
for the epic it is planning; a root epic has one even though it has no parent edge, and an
index without one did not read this tracker.

The briefs changed with it, because permission nobody is told about is permission nobody uses.
`planPromptFor` says a group may name a bead under the epic at any depth and what an ungrouped
one costs, and the Epic Advocate's brief — which lists direct children, and so could not see
half of what it was deciding about — now lists what is open further down as well, off the
subtree `advocatedRoots` already walks beside the children. `test/epicplan.mjs` pins the two
ends answering alike, and `test/wholejob.mjs` drives the real CLI, because the half that was
missing was a *read*: `validatePlan` could always be handed a graph and nothing was handing it
one.

### A childless epic is its advocate's call — do it whole or split it, and nothing dispatches before that call

An epic with no children is work, not a shelf. Two places used to disagree about what to do
with one, and both were sincere.

The Epic Advocate's brief said *"this epic has no children yet, so planning it is the whole
job this time"* — read the repo, decompose it, file each child under it. So the one agent
that had actually read the bead was told to split it whatever it said. Meanwhile the queue
had already answered the opposite question by silence: `heldByChildren` in lib/advocate.js
deliberately left a leaf epic workable, on the argument that *"an epic with nothing under it
is an ordinary bead with an ambitious type"*, so a childless epic went out as a plain worker
window on the first tick it was seen. That argument is right about what such an epic **is**
and wrong about who gets to say so — and because a tick comes round every thirty seconds and
an advocate window comes round every few hours, the queue won every time. The judgement
arrived after the question had been settled.

**Adam's decision (2026-08-21): the advocate judges, and the default is to do the work.** It
decides whether the epic's description holds enough to act on and whether the job is simple
enough; if so, a worker carries it out under the epic alone, and no child bead is filed
merely to give a worker something to hold. It splits into children only when the work
genuinely needs them.

So three answers rather than two, and the third is the one worth naming out loud:

- **One job.** The epic is dispatched as itself, exactly as before — but now because
  somebody decided it, not because nobody had. Recorded as a `whole-job` label on the epic
  plus a comment carrying the reason.
- **Several pieces.** Children, filed under the epic with `--parent`. Nothing marks this
  answer, because the children *are* the mark: the moment one exists the epic is no longer
  childless, and [the hold that has always applied to an epic with open children](#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window)
  takes over and dispatches the children instead.
- **Neither — ask.** If the description is not enough to act on and reading the repo does not
  settle it, the answer is a `human` bead under the epic carrying a `decision` block, and
  `human` on the epic itself so the queue stops offering it while the question stands. A plan
  filed to look productive is the failure this feature is closest to, and an agent with no
  third answer has to pick one of the first two.

**And the queue waits.** `heldByChildren` gained a fourth check: an **owned** epic with no
children at all and no `whole-job` label is held out of the dispatch queue. That is what
turns the advocate's judgement from a recommendation into a decision — before it, a decision
recorded an hour after the window opened was a decision about work already under way.

Two words in that sentence are doing real work. **Owned**, because `wantsAdvocate` needs an
`owner:` label: an unowned epic has no advocate and never will, so holding one would hold it
for ever with nothing that could ever clear it. And **no children at all** rather than no
*open* children — an epic whose last child closed has already been decomposed, the judgement
is in the graph, and holding it would be waiting for a decision it does not need. A
`container` epic never reaches any of this: `Bd.ready` filters it out of every queue before
the survey sees it, so a standing root is still neither dispatched nor held, because it is
not work.

The hold is on the card and in the log rather than silent, which is a departure from the
three hierarchy checks beside it. Those clear themselves when a window closes or a child
lands; this one clears only when somebody decides something, so it is drawn as its own
`heldByUndecided` pill — `p1`, with the two other holds no amount of waiting resolves — and
the reason names both ways out. It is a separate list from `heldByChildren` on purpose:
"waiting on their children" printed over an epic that has none is the kind of line that
teaches a reader to skip the line.

**Both answers go through one door.** `beadcause-plan` takes a second shape of input:

```yaml
whole:
  why: |
    The description names both files and the check, and the change is one edit to each.
    Splitting it would file two beads so that two windows could each hold one, which is a
    decomposition made for the dispatcher rather than for the work.
```

That writes the comment, adds the label and hands the epic back to the queue — the same
three writes in the same order as a group plan, for the same reasons: the comment is the
document, so a label with nothing behind it is not a state the tool can produce, and a
claimed epic is out of `bd ready` and would be a decision nothing could act on. `groups:`
and `whole:` in one document is refused rather than resolved; they are opposite conclusions
and picking one would be the tool deciding the thing it exists to record.

`why:` is not optional and has a floor of forty characters — the only prose floor anywhere
in this repo. Everywhere else a document is checkable without its prose: a plan's groups
either name beads under the epic or they do not. Here the reason *is* the decision, and
"one job" with nothing behind it is indistinguishable from a window that ran out of turn and
reached for the cheapest exit. The worker opened on that epic reads it before the diff.

lib/plan.js owns the format and `validateWhole` owns the refusals. `test/wholejob.mjs` drives
the real `bin/plan.js` against a fake `bd` for the three writes and their order;
`test/epicqueue.mjs` pins the hold and every way out of it; `test/epicadvocate.mjs` pins one
case per answer.

### An Epic Advocate reaches that same door through `beadcause-epicplan`, not by hand-typing the markers

The door above assumes whoever writes the document can run `beadcause-plan` — a real
`node` process — which is true of a planning **worker** (`worker`'s `allowedTools` is the
unrestricted CLI default) and was not true of the **Epic Advocate** (bc-jvt0.6). Its
allowlist (lib/foundation.js's `epic-advocate` role) has no `Bash(node:*)` grant — far too
wide to add just for this — and `beadcause-plan` is not on PATH regardless, being a
package.json rename of `bin/plan.js` that only resolves after an `npm link` this install has
never had (bc-jlop). So until this bead, the one agent that actually writes both of these
documents wrote them by hand instead: a `bd comment` whose body it typed to match
`WHOLE_OPEN`/`WHOLE_CLOSE` by eye, then a separate `bd label add`. Nothing checked that what
it typed was the document it meant — a malformed block reads as no decision at all, and
silently: the label still goes on, the epic still dispatches, and the reason nobody can
parse the comment is the only record of why.

`bin/beadcause-epicplan` is the fix, and it is deliberately thin: an extensionless,
filename-is-the-command wrapper — the same shape `beadcause-get` and
`beadcause-requirements` already use — that spawns `node bin/plan.js` with its own argv and
stdin unchanged and exits with whatever that exits with, the same composition
`b7e-shipgate` uses to spawn `b7e-gate` rather than reimplementing it. It is deliberately
*not* named `b7e-plan`: lib/tooldecl.js turns any `bin/b7e-*` file's `@grant` header into an
entry on `DEFAULT_TOOL_LIST`, the read-only surface every `dispatch` reply agent gets, and
this is neither read-only nor for `dispatch` — it is a tracker write, scoped to the one
agent that plans epics. It decides nothing of its own: `bin/plan.js` stays the one place
either document's format, validation and the three-write order live, so a rename there
cannot leave the wrapper out of step. `Bash(beadcause-epicplan:*)` is on the Epic
Advocate's allowlist and nowhere else, classified in lib/grants.js as a tracker write held
only by `epic-advocate` — hand-written there exactly as `beadcause-get` is, rather than
through `lib/tooldecl.js`'s `@grant` mechanism, because writing a bead's plan is not
something `dispatch` does at all. lib/epicadvocate.js's brief now tells the agent to pipe
its YAML into `beadcause-epicplan` for either answer, rather than quoting the markers for
it to retype. `test/epicplanwrite.mjs` drives the real `bin/beadcause-epicplan` against the
same fake-`bd` fixture `test/wholejob.mjs` uses, and proves the wrapper is transparent: a
valid decision reaches the tracker, a refused one is refused with `bin/plan.js`'s own exit
code and writes nothing, and the flags and stdin survive the extra hop.

**And what happens when that job lands** is the section below: an epic worked as one job is
delivered by a pull request that merges, and the merge queue deliberately leaves an epic open.

### An epic worked as one job comes back as a card that says it is done, with Close as the tap

The section above lets an advocate decide a childless epic is one job and dispatch it as
itself. Nothing then closed it, and three separate rules — each right on its own — combined
to make it invisible.

`epicStaysOpen` in `bin/deliver.js`, and the identical carve-out in the merge queue, leave an
epic **open over its own merge**: *an epic closes when its theme is done, not when a branch
sharing its name merges*. That rule was written for the umbrella epic that claims twenty-three
beads in prose and has no children bd knows about, and for that epic it is the difference
between a theme and a coincidence. They also leave the **claim** on, deliberately: an epic
left open *and unclaimed* is one the next tick hands to a second worker, to be refused the
same way — closing it was the old way out of that loop and is the thing the rule exists to
stop. And the sweep that asks
whether an epic is finished walks `bd ready`, which is *"open, unblocked, nobody on it"*, and
skips a bead with no children at all on purpose, because "no children" has until now meant a standing root nobody has filled
in yet.

So: the work merged, the epic sat open and claimed, and no queue, sweep or card had anything
to say about it. It is the one shape in this system that fails by being **quiet** — a closed
bead over unmerged work at least reads as wrong when somebody looks.

**The fix is a second question in `lib/finishedepic.js`, and it is a second question rather
than a widening of the first because every part of it differs.**

| | every child closed | worked as one job |
| --- | --- | --- |
| where the rows come from | `bd ready` | `bd list --label whole-job` |
| what makes it finished | no child of it is open | a branch it owns is in `main` |
| its fingerprint | `beadcause:finishedepic` | `beadcause:wholeepic` |

The population is the narrowest part and carries the whole of the safety. Only an advocate
that read the epic and decided it does not want splitting writes `whole-job`, so no epic
nobody has judged can ever be asked about this way — and it has to be a *label* query rather
than the ready queue, because being claimed is the state this case is stuck in and `bd ready`
is defined as excluding it.

**The evidence is `landingMerge` from `lib/inmain.js`, imported rather than re-derived**, and
the reason is the case it exists to reject: a fresh worktree branch is cut from `main`, so its
tip *is* a `main` commit, so `merge-base --is-ancestor` says yes before a line has been written
in it. What tells a real landing from that is whether some merge holds the tip as a **later**
parent — main taking something in, rather than main carrying on — and a second implementation
of that rule is how the two come to disagree. The branch itself comes from `worktreeBranches` +
`ownsBranch` rather than from the bead's own text the way that sweep reads it: a delivering
worker writes its branch into a **comment**, which is in none of the fields that sweep scans, so
scanning this epic's prose would find nothing on precisely the beads this exists for.

**None of this widens the rule that an epic is never offered a close on a merge.** That refusal
lives in `closeOffer` and it stands untouched — it is about a branch name found in some prose on
a bead that may hold a subtree, where closing takes the subtree with it. Here the epic *was* the
work, by a decision recorded on the bead, with nothing open underneath it; the close is offered
because those three facts together say the job is done, and any one of them alone would not.

The card is the shape the file already emits — a line on the thread, a `decision` block appended
to the notes, then the `human` label, in that order because the label *is* "it is in the inbox"
and a card whose options had not been written yet would be a question with no answers. Two
options: **Close it — the work is in main**, recommended, and **Keep it open — the one job was a
first step**, which is a commission, so it drops the label and calls `reopenAbandoned` and the
epic goes back to `bd ready` **unclaimed** — the one thing the delivery deliberately would not
do. One card per bead either way: `alreadyAsked` reads both fingerprints, so a bead that
acquired one question can never acquire the other.

Both questions run on one switch (`flagFinishedEpics`) and one interval
(`finishedEpicIntervalMinutes`), because they are two ways of establishing the same finding
about the same kind of bead and emit the same card; a second flag would be a way to turn half
of it off with no reason anybody could give for wanting to. The whole-job half runs **per
checkout**, like the in-main sweep and for its reason — a branch is in the `main` of the repo it
was cut from and in nobody else's — and a workspace with no checkout mapped to it skips that
half and still runs the first. `test/finishedepic.mjs` covers both, with a real git repository
under its tmp dir carrying a merged branch, an unmerged one, and an unstarted worktree branch,
which is the case that makes the second-parent rule necessary rather than decorative.

### One card per advocate — an EpicAdvocate is not a fold inside the repo's card

The advocates view draws one card per repo, and until bc-henk every EpicAdvocate under
that repo was a **collapsed section inside it**, listed under an "Advocates" fold whose
count was `1 + epicsOf(a).length`. A repo with fourteen open P0s was one card with fifteen
advocates folded into it, and the nesting made a claim that is not true: that an
EpicAdvocate is a part of the repo advocate. It is not. It has [its own
budget](config.md#config--configbeadcauseconfigjson) (`maxEpicAdvocates`, rationed separately from
`maxWorkers`), its own state, [its own pause](inbox.md#pausing-one-epic--the-button-that-stops-dispatch-under-a-p0-without-stopping-the-repo),
and its own queue — the beads under one epic. The only thing it shares with the repo
advocate is the repo.

**So an advocate is a card.** The repo advocate keeps its own, with its state chip, its
stepper and its five controls; each epic with an advocate assigned gets a card at the same
level, headed by the epic's title, its id, what its advocate is doing, and the two controls
that were previously buried in a section's foot — Pause/Resume and *Open the epic*. Cards
are emitted **repo, then that repo's epics**, rather than every repo followed by every
epic: on a phone the second shape puts the reason a repo is dispatching groups a whole
screen away from the repo doing it.

**The half you cannot see from the layout is where the windows went.** A group dispatched
from an epic's plan carries the epic it came from (`w.group.epic`), so those sessions are
now rows on *that epic's* card, and the repo card's "Working now" is only the work no epic
claimed. Before this they were rows in the repo's list, indistinguishable from the beads
the repo advocate picked up one at a time — a plan that put four windows up had nothing on
screen tying them together. No window is drawn on two cards.

**"Working now" keeps counting every coder, and that is not a bug in the arithmetic.** The
section's count is `codersOf(a).length/limit` — all of them, including the ones an epic
claimed — because `limit` is what the daemon actually rations per repo, and a section
headed `2/4` over a repo with four coding windows would be the card disagreeing with what
`tickOne` will do next. The rows are the subset; a line underneath says how many went to an
epic's card, so the difference is stated rather than left as arithmetic you have to notice.

**The head of an epic card *is* its fold**, and that is the decision that makes a dozen of
them affordable. A card cannot be the 40px a collapsed section was — it has a border, its
own padding and a head — so instead of a head sitting above a collapsed strip, the head is
the summary: the caret, the epic's title on one line, its id, what its advocate is doing,
and Pause plus *Open the epic*. Everything else is behind it. The toggle is a `<button>`
with the controls as its siblings rather than its children, because a button inside a
button is not markup and Pause has to be pressable without opening anything.

Measured in a headless Chrome at 393×852 — one repo, twelve assigned epics, a window on
none of them, everything shut:

| shape | the repo and its twelve epics |
|---|---|
| twelve folds inside one card (before this) | 2304px |
| thirteen cards, each head its own fold | 1656px = 372 + 12×107 |

So a repo with a dozen open P0s is **shorter** after being taken apart into cards than it
was as one card. A fold whose 40px summary strip sat under a two-line card head cost more
than a head that is the fold. The fold also keeps the key it had as a section
(`<ws>:epic:<id>`), so an epic you had open before this landed is still open after it.

### What to test is asked of the tracker, not read off the bead — `beadcause-promotework`

A promotion bead's body is written once, at the moment it is filed, and cannot grow. That
is right for an epic whose plan is its final word, and wrong for the shape this daemon
actually produces: an advocate is re-entered on child events precisely so it can file what
the first plan missed, so an epic goes on closing work for days after its plan completes.

Measured on bc-9d37 (2026-08-17). Its promotion bead was filed on 08-14 naming four beads.
By 08-15 the epic had closed nine pieces of work, and the most visible behaviour change it
has — a handed-back sweep card over a merged pull request settling by itself — was among
the five that landed afterwards. The **image** promoted is right regardless; it is `main`'s
merge build and carries everything. What was wrong is what the release agent would be told
to **exercise in UAT**, and a promotion that tests the wrong things and *passes* is worse
than one that fails.

So the body is the reason the card exists, and the test plan is derived when somebody
promotes:

    beadcause-promotework -w beadcause -e bc-9d37      the epic
    beadcause-promotework -w beadcause -b bc-9d37.10   the promotion bead, which names it

One place decides what an epic's work was and it is the tracker, which cannot go stale. The
filed body says so in as many words and prints that command with the epic already in it —
the snapshot it *also* carries is dated and labelled as a snapshot, because a body with no
list at all is a card nobody can judge at a glance. `landedWork` in lib/promote.js is the
single derivation both ends call.

Three things it deliberately does, each of which is a way of being wrong on purpose:

- **It over-includes.** Ship beads, promotion beads, containers, superseded ones and, since
  bc-7qo.9, `card` beads are cut — nothing was built for any of them — and nothing else is.
  Before bc-7qo.9 there was no label separating landed work from a card the daemon filed and
  Adam answered: bc-xl7n.15 (*#244 left 1 conflicting pull request behind it*) and bc-xl7n.35
  (*a sweep card whose record is dropped can never close*) are both closed under bc-9d37 and
  both carry `inbox`, and only the second was built. Now a bead a sweep or an advocate raises
  purely to ask a question — never to be built — carries `card` (lib/card.js) from the moment
  it is filed, and `NOT_WORK` (lib/promote.js) excludes it the same way it excludes `ship` and
  `promote`. `card` is narrower than `human`: a decision made mid-flight through a bead that
  still owes code once answered keeps `human` without `card`, so it still counts as work —
  pinned by `whyNotWork({labels:['human','p0']}) === ''` in test/promotework.mjs. Beads filed
  before `card` existed carry no such marker and still over-include — bc-xl7n.15 and
  bc-xl7n.35 among them, since neither was backfilled by hand. bc-9d37 therefore still derives
  29 rows where fourteen are its own work, on beads this old. The titles separate them in a
  glance either way; the alternative is silently testing four of nine and passing.
- **`unendorsed` is not an exclusion, though it reads like the strongest one there is.**
  bc-9d37.12 and bc-9d37.14 are closed, still carry it, and are two of that epic's nine —
  a session working a neighbour fixed them and nothing takes the label off. Cutting it
  would drop two of the beads this whole thing exists to stop dropping. An *open*
  `unendorsed` bead is excluded, where it means the opposite: a discovery nothing will open
  a window on, not work in flight.
- **A tracker that will not answer is a refusal, not an empty list.** `bd export` times out
  under load and `Bd.graph` hands back an empty index carrying `.error`; printing that as
  "nothing to test" is the same lie in a new place. The command exits 5 and says why, and
  filing falls back to the plan's list with the failure written into the body.

It prints what it left out and why, and — separately — anything still open under the epic,
which is bc-4bet.2's defect (a promotion filed over work that has not landed) showing up in
front of the last reader in a position to stop a release over it. `node
test/promotework.mjs` covers the derivation, both exclusion decisions above, the refusal,
and what the filed body says.

**And the mechanical grouping did not go away; it became the fallback.** Where planning is
switched off (`planEpics: false`), and where an epic's planning has failed
`maxAttemptsPerBead` times, the epic is handed to one worker as a batch exactly as it was
before — because a window that will not open again must never be the reason its children
are held forever. That second half was written down here and was **not true** until
bc-y683b: the batch row it produced was then dropped by the pick's own attempt filter, so
the fallback could never dispatch anything and the children were held behind a window
nothing was going to open. [An epic is no longer retired by the
cap](#an-epic-is-never-retired-by-the-cap) at all, which is what makes this paragraph
describe the program. The two never both dispatch one subtree: a planned epic is a set the
batching consults before it considers an epic at all, in either direction, so a nested
epic cannot become a batch head inside a plan.

`node test/epicplan.mjs` covers the document, the dispatch, the re-entry, the promotion
bead and both fallbacks; `node test/planbrief.mjs` covers the two briefs — including that
an epic worker is told not to implement and not to endorse, and that the whole standard
brief is still present around a group's quoted section.

### Carrying a promotion bead — four steps, three states, and a close that is earned

Filing the bead is one half; the other is something that picks one up. `lib/promoterun.js`
is that half, and it is deliberately the half that does not know what the pipeline is. It
claims the bead the way every other agent here claims work, drives four calls in order, and
closes it only when production has answered:

| call | what it must answer |
|---|---|
| `deployToUat` | the UAT deploy happened, **and the image it deployed** |
| `testInUat` | the release was exercised in UAT, and by which checks |
| `promoteToProd` | that *same* image is in production — promoted, never rebuilt |
| `testInProd` | the release was exercised in production, and by which checks |

The four are a **driver interface** rather than any one CI system, and the split is what makes
this testable at all: every acceptance clause on the release agent except *identify the
exact image* and *test against something the release actually contains* is expressible
against those four names, and both of those belong to the driver. `node
test/promoterun.mjs` drives the whole thing against a fake — no network, no pipeline, no
`bd`.

**Three states, and the third one is why this is not fifty lines.** `passed`, `failed`, and
*cannot say* — the same three the [release queue](pull-requests.md#the-release-queue--the-number-over-ship)
settles a ship bead on. Cannot-say neither closes nor promotes. A driver that **throws** is
cannot-say and not failure: an exception on the way out of `deployToUat` means nobody knows
whether the deploy happened, and calling that a failure is as much an invention as calling
it a success.

Two of the three are *read out of* what the driver said rather than taken from it, and both
are the epic's own argument turned into code:

- **A test step that passes without naming a single check is cannot-say.** A green deploy of
  the *previous* image looks identical from outside, so a `testInUat` that answers `passed`
  and cannot say what it exercised has not distinguished this release from the last one.
  That is the exact failure the release agent exists to prevent, and it is indistinguishable
  from success unless it is refused here.
- **The checks outrank the step's own verdict.** `passed` over a failed check is failed;
  `passed` over a check nothing could settle is cannot-say. A summary that disagrees with
  its own rows is a summary nobody can trust, and over-claiming closes a bead over a release
  nobody verified.

**The same image, or it is a rebuild.** `deployToUat` names the image and `promoteToProd` is
handed that name; a production step that comes back with a different digest is **failed**
rather than cannot-say, because it is not ignorance — it is a positive answer that what is
in production is not what was tested. A deploy that passes and names no image at all is
cannot-say instead: nothing can promote what it cannot name.

**What was deployed and what was checked is written on the bead**, in one comment per run,
whatever the outcome — the image, every step including the ones never reached, every check
with the driver's own words, and the sentence saying where it stopped and in which
environment. Not only in a log: a promotion is read weeks later by whoever asks what was
released, and the log has rolled by then. The comment is written *before* the close and
before the handback and outside both of their failure paths, so a bead closed with nothing
saying what was checked is not a state this can reach.

A run that ends anywhere but a verified production result hands the bead back **unclaimed**,
because an `in_progress` bead nobody holds is invisible to every queue here forever. The
test list handed to both test steps is `landedWork`'s, derived at the moment of the run —
the same read [`beadcause-promotework`](#what-to-test-is-asked-of-the-tracker-not-read-off-the-bead--beadcause-promotework)
prints — and anything still open under the epic is named on the record, which is bc-4bet.2's
defect in front of the last reader who can stop a release over it.

**The hold is not routed around.** Every promotion bead is filed `unendorsed`, and that
marker is the only thing standing between an unattended sweep and a production deploy — so
it is enforced in the two layers everything else here is: a filter, so an unendorsed bead is
never picked up, and a refusal, so one handed straight to `carry` is still not carried. The
filter keeps the refusal from being reached; the refusal is the guarantee, because a filter
is one caller away from being routed around.

**The refusals all happen before the bead is claimed**, because by the third call a bead is
claimed, an image is in UAT and the half-finished state is on the tracker: a bead that is
not a promotion bead, one already closed, one another agent is holding, one whose title does
not name its epic, one naming no repo at all, a tracker that will not say what the epic
closed, and a driver missing one of the four calls.

### The caller — `beadcause-promoterun`, and the sweep that sits beside it

bc-7qo.14. `carry()` and `openPromotions()` landed under bc-y8k4.2 with exactly one
caller in the repo: `test/promoterun.mjs`, against a fake `bd` and a fake driver. Nothing
asked a real workspace for its open promotions and nothing carried one by hand — the bead
half of the release agent existed and had nobody to drive it.

```
beadcause-promoterun -w beadcause -b bc-9d37.10 --driver ./pipeline-driver.mjs
beadcause-promoterun -w beadcause -b bc-9d37.10 --driver ./pipeline-driver.mjs --json
```

This is the one-at-a-time, human-triggered shape the bead asked for first, and it suits a
first production promotion better than an unattended sweep would: a person names the bead,
names the driver, and reads the record `carry()` writes back — the same text either way,
`--json` only adds the machine-readable run alongside it.

**`--driver` is a path, not a name, because there is no default to pick.** `carry()` is
written against a driver *interface* — `deployToUat`, `testInUat`, `promoteToProd`,
`testInProd` — precisely so this file does not need to know what a pipeline is. bc-y8k4.3
was meant to fill that interface with a pipeline driver for a real CI system, and landed
instead as something that knows no pipeline at all: [`--driver pipeline`](#any-other-pipeline--the-pipeline-hook-a-bead-repo-declares),
the hook a workspace's bead repo declares. A `--pipeline <ci>` flag would have been a CLI
that knows one CI system; `--driver <path>` is dynamically imported instead, so the same file
carries a bead against whichever driver a workspace actually has, real or otherwise.
The first real one is now in the repo: [`lib/singledriver.js`](#one-environment--the-single-environment-driver-and-why-the-collapse-is-in-the-lib),
for a repo with one environment. `test/promoterunbin.mjs` proves the whole thing against the real `bd` binary and a driver
module loaded off disk — a fresh `bd init`, a real epic with a real closed work bead under
it, a real promotion bead in the shape `lib/promote.js` files, carried to a verified close
by a driver `beadcause-promoterun` imports exactly as it would in production. Exit codes:
`1` usage, `2` the driver would not load or is missing a call, `3` `carry` refused before
touching production, `4` it ran but did not close, `0` every repo it names is verified.

**The sweep is [the next section's](#the-daemon-carries-an-endorsed-promotion-bead-itself)
(bc-y8k4.8).** It was deferred until there was a real driver to hand it; `lib/singledriver.js`
is one. The CLI above is unchanged and is still the way to carry a bead in a workspace that
has not said `autoShip`, to carry one the sweep has given up on, or to carry a beadcause
promotion from a shell that outlives the restart.

### One environment — the single-environment driver, and why the collapse is in the lib

bc-y8k4.6, and the first driver the repo actually ships: `lib/singledriver.js`, for a repo
whose only deploy is production — beadcause's `launchctl kickstart`, sorrel's `fly deploy`.

```
beadcause-promoterun -w beadcause -b <promotion bead> --driver lib/singledriver.js
```

**It wraps the deploy the repo already declares and names neither command.** `deploy` looks
the repo up in [`deploys`](config.md) through `deployFor`, runs it through `startDeploy` —
the same runner and the same durable record the Ship button and the release queue use — and
waits on **the record on disk**, never on the child, because a beadcause kickstart SIGKILLs
whoever asked for it. `ok` is passed, and the image is the commit the runner fast-forwarded
to (the record's `to`); `failed` is failed; `unconfirmed`, `lost` or a record still live when
the wait runs out are cannot-say. A repo with no declaration is a refusal, which `carry()`
reads as cannot-say.

**The checks are declared too — `deploys.<key>.checks`, argv, with `{image}` filled in.**

```json
"checks": [
  { "label": "health", "command": ["curl", "-fsS", "--retry", "10", "--retry-connrefused", "http://127.0.0.1:4318/api/health"] },
  { "label": "running build", "command": ["scripts/is-running.sh", "{image}"], "timeoutMs": 30000 }
]
```

Run in the checkout after the deploy settles, one at a time, each named on the record: exit 0
passed, any other exit failed, not runnable or timed out cannot-say. **A repo that declares
none never closes a promotion** — its test step is cannot-say and says why, because a green
deploy alone does not show the release is the one running.

**beadcause's own entry is the one exception, because only the daemon can say what it is
running** (bc-rfnr.9.13). `/api/health` carries `commit` — HEAD of the checkout *at the moment
the backend booted*, not the router's build id (a bundle hash that does not move when only a
comment does) and not the deploy record's `to` (which is what the runner fast-forwarded to, the
very thing being checked). A `restarts: true` entry for this checkout that says nothing about
`checks` gets one built in, `node {dir}/scripts/serving.mjs {image}`: it waits up to a minute for
the restart the deploy just caused, then exits 0 only if the daemon reports that commit. Not
answering, answering without a commit, and answering as another commit all fail it. `"checks":
[]` is a declaration and turns it off; any `checks` you write replace it rather than join it.
`/api/health` needs no token, so the commit is readable by anyone who can reach the port — the
same audience that already reads the workspace names beside it.

**Why the collapse is in `lib/promoterun.js` and not in the driver.** The step names on the
record are the lib's, not the driver's, so a four-call driver for one environment prints
"UAT deploy — passed" over a deploy that went straight to production. It then has two
choices for `testInProd`, and neither is honest. It can repeat the same checks as a second
production verification that never separately happened. Or it can name none, which leaves
the bead cannot-say forever. So a driver may say **`environments: 1`** and export two calls,
`deploy` and `test`. `carry()` then records exactly those two steps (`SINGLE_STEPS`), both in
`production`, and opens the record with a sentence saying there is one environment, deployed
once and checked once, with nothing promoted or tested a second time. The ledger carries
`"environments": 1`. Nothing about the reading is relaxed: the deploy must still name its
image, and a test that names no check is still cannot-say. A four-call driver is untouched.

**From a shell the runner survives a beadcause restart; from inside the daemon it does not.**
From `beadcause-promoterun` in a terminal, the runner is not in the LaunchAgent's job and
survives the restart to write `ok`. A caller *inside* the daemon — the unattended sweep below —
dies with the restart, and hands the wait to the deploy journal instead: see how the sweep
resumes a carry it finds half-done.

### Any other pipeline — the pipeline hook a bead repo declares

bc-y8k4.3: `lib/pipelinehook.js`. The bead asked for an Azure DevOps driver. The survey on
bc-u7syq found that Northwind's pipeline is not the shape the bead assumed: ADO stops at
staging, and UAT and production are blue/green releases run by another service's scripts.
The answer there was that **beadcause stays agnostic of the company, organization and
pipeline, and provides a hook for invoking the external one**. The bead repo that knows the
pipeline configures its own.

**Declared by the bead repo** — the checkout a workspace's `.beads` lives in, so for
Northwind that is `architecture` — at `.beadcause/pipeline.json`, beside `views.json` and
`derived.json`:

```json
{ "run": ["node", "tools/beadcause-pipeline.mjs"], "environments": 2, "timeoutMinutes": 90 }
```

`run` is argv, never a shell string, run in the bead repo. `environments` is 2 (the default:
`deployToUat`, `testInUat`, `promoteToProd`, `testInProd`) or 1 (`deploy`, `test` — see the
section above). `timeoutMinutes` bounds one call and defaults to 60.

**One call per step, JSON both ways.** The hook is run as `run… <call>`. It gets
`{ call, bead, epic, workspace, repo, image, work }` on stdin, where `image` is empty before
the first deploy and is what that deploy named on every later step, so `promoteToProd` is
*handed* the image UAT tested. It answers with the same object an in-process driver returns,
on the last stdout line that parses, so it may log above it:

```json
{ "state": "passed", "image": "simptek.azurecr.io/api:4242@sha256:…", "detail": "…",
  "checks": [{ "name": "i9n", "state": "passed" }] }
```

The answer goes through the same `readStep` as every driver's. A test pass that names no
check, a deploy that names no image, and a promote that comes back with a different image are
all refused, exactly as they would be for a driver in a module.

**Cannot-say is never invented into failed.** A hook that cannot be started, overruns its
timeout, or exits without a JSON answer has told nobody anything, and every one of those is
`unknown`. A non-zero exit *with* an answer is that answer, so a hook may say `failed` and
exit 1. What the hook does — deploy, ask a person to, or request an approval gate and answer
`unknown` until it is granted — is its repo's business.

```
beadcause-promoterun -w architecture -b <promotion bead> --driver pipeline
```

**The unattended sweep uses it too.** A repo that [`promoteDrivers`](config.md) does not name
is carried by the bead repo's hook when one is declared. That is a declaration, made in that
repo's own commit, rather than an inference. A named entry still wins, and a malformed
`pipeline.json` is refused by name rather than read as undeclared.

### The daemon carries an endorsed promotion bead itself

bc-y8k4.8: `lib/promotesweep.js`, called from `cycle()` beside `sweepRelease` and holding no
logic of its own in `lib/server.js`. Everything it touches — `bd`, the config, the driver
loader, the deploy journal, the clock — is injected, so `test/promotesweep.mjs` runs the whole
of it against a fake driver and a fake `bd`, with no network and no daemon.

It looks at every workspace's open promotion beads on the release cadence and starts **at most
one carry**, in the background: a deploy takes minutes and the cycle has other sweeps to run.
A bead it does not carry is **never silent about why** — one log line per change, prefixed
`[promote]`, and the same reasons come back from `sweep()` for a suite to read:

| the bead is left alone when… | because |
|---|---|
| it is `human`, or `unendorsed` | a question waiting on a person / nobody has agreed to it |
| the workspace's [`autoShip`](pull-requests.md#auto-ship--the-merge-that-does-not-wait-for-the-tap) answer is no | a space that has not said yes to unattended deploys gets nothing carried unattended; `beadcause-promoterun` by hand is still there |
| a repo it names has no [`promoteDrivers`](config.md) entry and its bead repo declares no [pipeline hook](#any-other-pipeline--the-pipeline-hook-a-bead-repo-declares), or two repos name different drivers | never inferred — `carry()` takes one driver, and whether it is single-environment is that driver's property |
| `bd ready` does not list it | a dependency, or a `blocked-by:` marker, says not yet |
| a `held:` lease is live on it, or a deploy for it or its repo is in flight | somebody, or something, is on it |
| it is claimed by somebody else, or by the daemon's own actor and the claim is fresh | `carry()` only refuses a *different* holder, and the daemon's actor is the one `beadcause-promoterun` uses, so the sweep reads the lease itself |
| three runs are recorded on it, or the last was under thirty minutes ago | a failed production deploy is not retried every five minutes by a daemon nobody is watching. Counted off the bead's own run comments |

**A beadcause deploy kills the daemon mid-carry, and the next tick has to recover from the
record, never from memory.** The in-process slot only says whether a carry is running *in this
process*. A bead left `in_progress` on the daemon's actor is read as a dead carry when its claim
is older than thirty minutes **or older than this process** — the restart case. It is then
carried again with a `deploy` that **adopts the journal record the dead carry started** rather
than deploying a second time, which is what would otherwise make a self-deploying promotion loop
for ever: `ok` is passed, `failed` is failed, and `unconfirmed` — the ordinary ending of a deploy
that restarts the daemon — is passed only for a deploy that `restarts`, and only because this
process started after it asked. The `test` step still runs, so the bead closes on its checks.

**Two Macs on one tracker are not coordinated by this.** The claim is an assignee that both
daemons write as the same actor, so a Mac that boots later reads the other's live carry as a
dead one once it is old enough. A live `held:` lease is respected, but the sweep does not write
one. Turn `autoShip` and `promoteDrivers` on for the one Mac that should carry promotions.

The record on the bead is the same `carry()` comment `beadcause-promoterun` writes. A run emits
a `promotion` bus event when it starts and when it settles — on change only, never per sweep.

### One image per repo — an epic that spans three repos, and a result that is partial

An epic spanning three repos is three images, three UAT runs and three production runs, and
**they may not all pass**. That used to be refused by name, because one bead cannot hold "two
of three promoted" without either lying or closing early. It is now carried as **one leg per
repo on one bead**, which takes three things:

- **A per-repo outcome, written where the next run can read it.** Every run appends a ledger
  to its own comment — a `beadcause:promotion` block of JSON, for the same reason
  [a plan](#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window) is a block in
  a comment: append-only, so a run can never destroy what an earlier one wrote, and the
  machine-readable state sits inside the very prose a human reads about that run rather than
  in a second place that can disagree with it. The JSON sits **inside** an HTML comment
  rather than in a fenced block beside one, which is where it differs from a plan: a plan is
  written to be read, and this is bookkeeping that says nothing the prose above it has not
  already said in words — three runs of it drawn on a phone would be the card getting *less*
  legible for having recorded more. The next run starts from the union of every ledger on the
  bead, so **a repo verified in production is not driven again** — not re-deployed, not
  re-tested, not re-promoted.
- **A close that waits for all of them.** Two of three leaves the bead open with the third
  named on the card, under *Still owed*. The bead can be partial without the board lying,
  which is exactly what it could not do before.
- **UAT for everything before production for anything.** The four steps stay in order within
  a repo, but they are driven in two passes across repos: every owed repo is deployed to UAT
  and tested there, and production is entered only if *all* of them got through. An epic is
  one feature; putting two of its three repos live while the third is red is a half-shipped
  feature in front of customers, and UAT is the cheap place to find that out. A repo held
  back this way says so on the record — *held back — `beta` did not get through UAT* — rather
  than reading as untried. A repo whose own UAT fails does not stop the next repo being
  exercised, because a run should come back knowing as much as it can.

**Only `verified: true` skips a repo**, and everything else — a garbled block, a ledger from
before this existed, a `bd` that will not list comments — means carry it again. The two
directions are not symmetrical: a repeat costs a deploy of an image that is already there,
and the other way closes a bead over a repo that has never been near production. The trap
the suite is built around is the same asymmetry one layer down: a repo that passed UAT and
was held back has `passed` as its last step and is **not** verified, and writing that into
the ledger would skip it for good.

A partial result can still happen in production — the second repo's promote can fail after
the first has been verified — and that is the state the ledger is for. It is not designed
away; it is written down, and the run that follows finishes what is owed. One repo makes the
two passes indistinguishable from the plain four calls, which is why a single-repo record and
its close reason read exactly as they did before.

### A department relay — when the assignee is a role rather than a person

Everything above decides *which window opens on which bead*. None of it ever decided **who
the agent in that window is**, because until now there was only one answer: a worker, with
the same brief every time.

That is not enough for a repo that already has an org chart — named roles, grouped into
departments, each with checkers, and a filer who is the only route to the phone. The first
workspace to declare a relay was a writing studio; beadcause ships none, and every role,
department and profile path below is the workspace's own declaration.

**The relay is that org chart being executed.** When a bead's **assignee** names a role
rather than a person, one launch carries the work through that department's whole chain:

```
at-71   assignee: author   labels: dept:story

    1. draft   author   staff/author/author.md
    2. check   editor   staff/editor/editor.md
    3. check   critic   staff/critic/critic.md
    4. revise  author   staff/author/author.md
    5. file    steward  staff/steward/steward.md
```

The session reads each profile before it takes that role, does that role's part and only
that role's part, and writes a line onto the bead at every handoff. One window, five
agents, no card in between.

**Unattended was a decision, and it cost something.** `lm-vzg` put three shapes to Adam:
full relay; one role per launch with a card between each; or a relay that stops at the
department boundary. The answer was the full relay — *"Full Relay, but all the steps and
handoffs are recorded in the bead for me to view/access in the EpicCards"*. What it buys is
one card per deliverable instead of five. What it costs is real: a bad choice at step 1
propagates through three more roles before anybody sees it. The handoff trail is the
mitigation, and it is why the brief asks for an entry per step rather than a summary at the
end — from outside, a relay stalled at step 2 and one quietly working step 4 look identical.

**The chain is derived, not typed.** A department is written down as its members and its
checks, and the loop's shape — draft, then the checks, then the drafting role again to
answer what they raised, then the filer — builds the order. So a department that gains a
checker gains it in every chain at once, and no chain can quietly disagree with the table
above it. Two consequences fall out rather than being written: an agent never checks its own
draft (editor drafting a Story bead is checked by critic alone), and a department with no
checks gets no revise step, because handing a bead back to the agent that just drafted it
for nothing is not a step.

**Executive is not a department and gets no relay.** Roles listed under `executive` produce
process, not reviewable deliverables, so a bead assigned to one of them opens the ordinary
worker window. The filer is the case that matters when it is also executive, because it is
then a role the definition knows about — a relay on its own beads would be the filer filing
packets to itself.

**The chain ends at a review packet, not at a merge.** The last role delivers the work the
ordinary way — the artifact has to exist on the base branch and not inside
`.claude/worktrees/`, or the packet points at a path a phone cannot open — and then files
the packet as a bead of *its own*, carrying `human` (behind the workspace's review label,
where it declares an [approval pipeline](landing.md#where-the-ruling-is--the-second-axis-beside-the-pull-request))
and a [`decision` block](asking.md#asking-a-question). Its own bead and not the work bead, on purpose: the
work bead is closed by [the merge queue](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue) when the branch lands, and an
approval that closes itself the moment the code merges is not an approval — it is a merge
wearing one. The packet is a bead nothing in this system closes. The tap is the approval,
and it is the only one there is.

**The assignee is destroyed by the claim, and that is why the hand-back names a role.**
`bd update --claim` is the first thing any window does and it overwrites the assignee with
the claiming identity, so the chain is resolved at launch — off the `bd show` row
`openWorkSession` has already paid for, before any window exists. What that costs is the
*second* window: a relay that ran out of room mid-chain has no assignee left to say where
it stopped. So the brief's hand-back is `bd update <id> --status open --assignee <the role
that should run next>`, which is the existing idiom with the one word that makes it
resumable. Nothing is persisted anywhere else, and a relay is recomputed every launch
rather than remembered between them.

**Why this is a declaration and not a parse of the org chart.** A workspace's own account
of its roles is usually a document that argues — a table in markdown, a hierarchy in a
diagram, a numbered loop with the rules in the prose beside it. A parser can read all of
that today and misread it silently the moment somebody rewrites a sentence — into a chain
with a check missing, which is worse than a relay that never ran. So the chain is stated
once, in a form that cannot be misread, and the document stays the human document it is.

A definition lives in one of two places: the repo's own `.beadcause/relays.yaml` (below,
and the better home), or `relays` in the config, keyed by **workspace name**. Both are
empty until a workspace declares one. `"relays": {}` turns the config half off, and there
is no other switch — a relay nothing is assigned to costs nothing, because the only bead
that reaches it is one somebody assigned to a role on purpose.

```json
"relays": {
  "atelier": {
    "profile": "staff/{role}/{role}.md",
    "profiles": { "crier": ".claude/agents/crier.md" },
    "docs": ["docs/CHARTER.md"],
    "filer": "steward",
    "executive": ["chair", "steward"],
    "departments": {
      "dept:story": {
        "name": "Story",
        "lead": "plotter",
        "members": ["scribe", "author", "plotter", "editor", "critic"],
        "check": ["editor", "critic"]
      }
    }
  }
}
```

Which department a bead belongs to is a label it carries that **is** a department key —
`dept:story` is literally the key and literally the label, the routing label a person
actually set — and otherwise the department that *staffs* the role. Read that first half
exactly as written: nothing reads a prefix. `departmentOf` matches *any* label a bead
carries against the department keys, so `dept:` is a convention rather than a rule, and it
is enforced only where the keys stop being yours (below). The difference is load-bearing for
checkers who work across departments: an editor staffed by Story checking Design work is
still a Story agent, so an unlabelled bead assigned to it is Story work, but a bead labelled
`dept:design` and assigned to it is Design work and gets Design's chain.

`profiles` overrides the template for one role, because a template is rarely universal: a
role wired as a real Claude Code subagent lives under `.claude/agents/` rather than beside
its siblings. A path in a brief that resolves to nothing is worse than no path, because the
session opens it, gets nothing, and has to decide on its own whether the role is real.

The **packet** is not the definition's to state. It is `human`, behind the workspace's
approval review label where the config declares an approval pipeline (`packetFor` in
`lib/relay.js`); a config entry may override it with `packet`, and a repo file may not.

`lib/relay.js`, `node test/relay.mjs`. The brief section is built in `workPromptFor` beside
the batch and group sections and is asserted the same way — by comparing a relayed brief
against an unrelayed one, so a section that leaked into an ordinary worker's page would be
a failure rather than a thing somebody noticed later.

### A repo's own definition — `.beadcause/relays.yaml`

A definition in `config.json` is a definition on one Mac, changed by hand and reviewed by
nobody. A workspace's departments are usually argued out in a document *inside its repo*;
the code that reads them was outside it. And `relayFor` takes a workspace name and
returns *the* definition, which is the wrong shape for sorrel, where software-dev,
marketing and engineering are three relays in one workspace — not a bigger entry, but a
second question, **which relay**, that nothing was ever asked.

So a checkout may carry `.beadcause/relays.yaml` (`.json` accepted), holding **named**
relays and an optional `default:`. Each block is shape-identical to the `cfg` entry above,
so migrating one is a copy. `lib/relaydefs.js`, `node test/relaydefs.mjs`.

**Whole-definition replacement, never a merge.** A file that parses and validates replaces
`relays.<workspace>` entirely; only an absent or refused file falls through to it. That is
what makes an *empty* file meaningful — `relays: {}` says *no relay in this checkout*, the
only off switch a repo has, the same sentence `"relays": {}` is for the config. An **absent**
file is the opposite answer. The two are one typo apart, which is why `relaysIn` reports
`defined` rather than leaving them to be told apart by their contents.

**Two things a repo may not say, and they are the same line drawn twice.** The config is
yours and is unvalidated; the repo file is *a branch's*, so it is checked against an
allow-list and an unknown key refuses the whole file with the key named — a typo'd
`deparments:` quietly skipped is a repo dispatching with no departments at all, which reads
as working. On top of that: `packet:` is refused, because the packet labels are what make a
review packet answerable from a lock screen and a repo that could restate them could file
approvals that never reach the phone; and a department key that does not start
with `dept:` is refused, because the key is matched against *every* label a bead carries, so
an unprefixed `agent-filed` would sweep up every agent-filed bead in the checkout.

**Which relay, first match wins:** a `relay:<name>` label naming a key in the file → the
bead's department label, where exactly one relay declares it → the relay that staffs the
assignee in `members` → the file's `default:` → nothing, and dispatch exactly as today. An
unknown `relay:` name and a department two relays claim are **problems, not fallbacks**:
falling back is how marketing work quietly dispatches as engineering.

A refused file is never a hold — the bead dispatches as it does today, with a sentence
somebody can act on. Nothing throws, and the ordinary answer for a repo with no
`.beadcause/` at all costs one failed `stat`: no read, no parse, no directory listing, which
is what lets the advocate ask per checkout on every tick.

One department key is not about the chain at all: `capacity:` is how many windows that
department may hold at once, and it is the one number in this file that changes what
dispatches — see [Department capacity](#department-capacity--the-first-thing-a-relay-does-to-dispatch-rather-than-to-a-brief)
below for why only a *department* may state it and why it can only ever subtract.

**And the launcher asks the bead's own checkout.** `openWorkSession` resolves the relay off
the directory `resolveSessionRepo` already picked for the bead, not off the workspace name —
which is what makes *several relays in one workspace* fall out for a multi-repo workspace as
well, because each checkout answers for itself and nothing in the launcher has to know a
workspace can hold more than one. The `packet` stays the config's either way, since a repo
file naming one is refused. `bc-ogicx.5`, `node test/relaywiring.mjs`.

`bin/relaystep.js` is the other consumer and it asks a different question. It is handed a
workspace, a role and a step — no bead, no checkout — so under named relays it cannot know
which relay a `--role` was meant to belong to, and it checks against the **union** of every
relay's roles across every checkout the workspace has. Deliberately wider than any one
relay: what that list is for is catching `--role edtor` for `editor`, not enforcing routing,
and the same command already declines to check step *order* for exactly that reason. A
`--relay` flag would be a second routing decision typed by hand at the one place that cannot
verify it. `bc-ogicx.7`.

### Department capacity — the first thing a relay does to dispatch rather than to a brief

Everything above decorates. The advocate picked the bead first — by priority, then by age —
and the chain was computed afterwards, at launch, out of whatever bead the queue had already
chosen. So a department with four beads near the top of a workspace's queue could take every
window the workspace had, and one with a single bead could wait all day behind it. Nothing
was wrong and nothing said anything.

A **department** may now declare `capacity: N`, and `candidates` drops a bead whose
department is already at it. `lib/relaydefs.js`, `node test/deptqueue.mjs`.

```yaml
relays:
  studio:
    departments:
      dept:story:
        members: [author, editor]
        check: [critic]
        capacity: 1
```

**Only a department may declare one, and a capacity can only ever subtract.** Those two
sentences are the same decision from either side. A relay-level `capacity:` is a second
spelling of `advocates.perWorkspace.<ws>.maxWorkers` — that number is *yours*, it lives in
the config on this Mac, and two switches for one limit is the failure this family objects to
everywhere else; so it is an unknown key, and it refuses the whole file. What is left is
counted *inside* `maxWorkers` and inside `globalMaxWorkers` and can never raise either, which
is the whole reason a file a pull request can edit is allowed to state it at all: a repo may
slow its own department down, and may not take a window from anybody.

**The department comes from the graph, and it could not have come from the queue row.** A
relay is keyed off the bead's **assignee**, and `bd ready --json` carries no `assignee` field
— not one the survey drops, one the payload does not contain. A filter reading the row could
see a `dept:` label and nothing else: a ceiling that applied to the beads somebody had
happened to label and silently not to the rest. So it is read off the tick's own `bd export`,
which the roster and the pause set have already paid for. A graph that would not answer this
tick means **no cap**, never an empty one.

**Both sides of the count ask the same question.** A bead is under a ceiling only where it
would get a *chain* — not merely where `departmentOf` would match a label. A bead labelled
`dept:story` whose assignee is a person resolves no chain, so its window records no
department and could never be counted as occupying one; holding it would be a ceiling that
subtracts for ever. And the window's department is written down **at launch**, because the
first thing that window does is `bd update --claim`, which overwrites the assignee — a
department re-derived a minute later is `null` for every window that has started work, and a
ceiling counted that way never binds at all.

**It binds within the tick as well as across it.** A tick opens `min(free, globalFree,
ready)` windows straight down one list, so a ceiling counted only against *running* windows
would let three windows into a department capped at one and only notice on the next tick.
Every candidate kept therefore counts too. The cost is deliberate: a bead can be held behind a
same-tick sibling that then does not launch because the worker limit ran out first, and it
comes back on the next tick with nothing to release — exactly as a same-tick surface collision
does. The sentence on the card says which of the two is holding it, so a full department and a
busy tick are never reported as each other.

**And it is said out loud**, which is the half that is not optional. A held bead joins the
`heldBy*` family as `heldByDept`, with the department named as well as the bead, because the
department is where the number is. `heldBySurface` is the only other hold that is not counted
into the "nothing ready" block, and for the same reason: this one subtracts from `candidates`
and not from the queue, so it can never be what empties one — its sentence goes on the line
that reports a queue with nothing pickable in it and on the line that says how many windows
are opening. A silent subtraction is what `bc-xl7n.111` cost a bead's finished work, and the
sixty lines above `givenUp` in `lib/advocate.js` are that argument at length.

**A definition that will not load is said out loud too, and holds nothing.** A checkout whose
`.beadcause/relays.yaml` fails to parse or validate dispatches every one of its beads exactly
as it did before the file existed — without a relay. So it gets one sentence on the tick note,
one log line per spell of being broken, a `p1` pill of its own, and **no** `heldBy*` entry,
because nothing is waiting. What is wrong is that a repo believes it has departments and has
none, which nothing else can say: the launcher has carried the sentence as far as
`relayProblem` since `bc-ogicx.5`, and `test/relaywiring.mjs` pins that with *"the problem
dies inside the launcher"*. This is where it stops dying. Note `repoList().warnings` is
deliberately **not** the model — it reads well and is read by nobody; the pattern that reaches
a surface is a sentence on the advocate's record plus one guarded line, which is what
`repoProblem` already does. `bc-ogicx.6`.

Deliberately **not** here, and argued against rather than merely deferred: making the relay
influence pick *order* — round-robin, per-department weighting. That is a scheduler, it
interacts with `byPickOrder`, `maxAttemptsPerBead` and the lease, and it buys much less than
the cap does. Cap first; propose weighting only if starvation is observed with the cap in
place.

### The relay journal — every step and handoff, on the bead and on the epic card

A relay runs four or five roles in one window with nobody watching, and that was allowed on
a condition: *"Full Relay, but all the steps and handoffs are recorded in the bead for me to
view/access in the EpicCards"*. The journal is that recording, and it is not a nicety
attached to the answer — it is the whole mitigation for the cost the answer carries. A bad
early choice now propagates through three more roles before anyone sees it, and from outside
a relay stalled at step 2 and one quietly working step 4 are the same silence. That is the
argument [the waiting-on sentence](inbox.md#the-advocate-that-comes-back--what-re-opens-an-epic-advocate-and-what-it-costs)
makes for an epic, one grain finer, because here the steps are the thing.

The window writes one entry per handoff, before it starts the next role:

```
beadcause-relay -w atelier -b at-abc --role editor --step check --next author \
  --flag "two dates unsourced" -m "fact pass done, everything else holds"
```

Five steps are legal — `draft`, `check`, `revise`, `file` and `handback`. The first four are
the derived chain; `handback` is the one thing that chain cannot contain, and it is the
entry the card most needs, because it is the only one that says the relay is not going to
move again until something launches it. It is written *alongside* the assignee, and the two
are not the same fact twice: the assignee is what the next launch reads to rebuild the
chain, and the `handback` step is what says on the card that this relay stopped rather than
went quiet.

**It goes in `notes`, and the reason is the half of the bead that renders it.** A trail is
append-only, and comments are the append-only surface here — bd stamps each with a time,
nothing can rewrite an earlier one, and both [the plan](#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window)
and the promotion ledger live there. But `bd export` carries `notes` and does not carry
comments, and the epic card's tree is sixty rows off one export per workspace: a
comment-stored trail is a `bd comments` spawn per descendant per tick, which is not a slower
board but no board at all. So it is `notes`, and the append-only property is kept by hand —
one appended block per entry, never a rewritten field. Every other marked block in this
program is a *current answer* that later writes replace, which is why the merge bead's
cutter has to be careful about where a block ends; this one has no cutter and cannot have
one, so an entry physically cannot destroy an earlier entry, a hand-written note, or another
agent's block. The cost is that a journal is never tidied, which is the right side to fail
on: the trail of a relay that went wrong is the one thing worth keeping.

The payload is JSON *inside* the HTML comment, so it draws nothing where the notes field is
rendered and appears only where it is rendered as a trail. `-->` inside a role's own words is
escaped, because otherwise a sentence about an arrow ends the comment and takes the rest of
the notes out of the document with it.

**It is parsed where the notes still exist, which is not where you would put it.** The
index `bd export` builds keeps `notes` for a *root* and blanks them for everything else —
seven hundred bodies of prose have no business in a minute-long cache, and until this
landed nothing but the epic-advocate's waiting-on sentence read the field, which is only
ever on a root. A relay runs on the *leaves*. So a mark parsed on the request path, off the
row the board draws, would have answered "no relay" for every row in every tree, for ever,
with nothing anywhere saying so. It is parsed in `lib/ancestry.js` instead, where the export
text is still in hand, and what is kept on the row is the mark — six short fields, `null` unless
a relay has actually run — rather than the prose it came from.

**Two readers, because two surfaces want different amounts of it.** Each row of an epic's
tree carries the last entry alone — `⇄ editor · check · 2 steps · 40m ago`, with a `⚑` when
something was flagged and a warning colour when the last step was a hand-back. There is no
threshold in that: nobody has decided what *stalled* means for a role that reads a
hundred-page brief first, so the row states the age and the reader judges it. It says how
far the relay has got and not how far it has to go, because the chain comes off the assignee
and the claim destroyed that — a denominator here would be one the board cannot honestly
produce. Open the bead and the whole trail is there, oldest first, one row per step with what
it handed on and what it flagged. Oldest first unlike everything else on that screen: the
pull requests are a queue you check, and this is a story, and a story read backwards loses
the one thing it is for.

`lib/relayjournal.js` and `bin/relaystep.js`, marked onto the index row in
`lib/ancestry.js`, drawn by `p0RelayHtml` and `p0RelayTrailHtml` in `public/app.js`.
`node test/relayjournal.mjs`, and the end-to-end from an export line to a tree row is in
`node test/p0tree.mjs`.

### What a P0 advocate *is* — its foundation, and what one visit consists of

[The advocate that comes back](inbox.md#the-advocate-that-comes-back--what-re-opens-an-epic-advocate-and-what-it-costs)
is the machinery: three events, a cooldown, a sweep, a budget of its own. This is the other
half — what the agent those windows open actually *is*. It lives in `lib/foundation.js` as
the `epic-advocate` baseline, which is [what an agent is on every
run](agents.md#what-an-agent-is--and-how-it-asks-to-be-different) whatever a particular brief says,
and it answers four questions: what it is for, what it may and may not do, how it is
re-entered, and what it writes down and where.

It used to answer one and a half of those. The role said *"write everything down on the
bead"* and named one place to put it; the agent actually has four, and a supervisor that
puts the same conclusion in all four leaves a P0 with four answers that disagree. So the
foundation now names them, and what each is *for* is the part that stops them colliding:

| carrier | what belongs in it |
|---|---|
| the **plan**, a `beads` block in a comment | which children should exist and how they group. `lib/plan.js`'s format, because the repo advocate reads the same block — a plan only the P0 advocate could read would make the two of them two trackers. Updated in place; a second plan comment is a second answer |
| the **waiting-on block** in `notes` | one line of *current* state, which is what the P0's card draws on a phone. It answers "is this getting done, and what is in the way" — it is not a summary of the visit, and there is only ever one of it |
| **labels** | the facts a machine acts on: `planned`, `promoted`, the progress the card counts. Anything the daemon has to read is a label or a marked block, never prose it would have to interpret |
| **`beadcause-memory`** | `note` for what is still true next week about this repo; `debrief` for what *this visit* was — the child it looked at and decided was fine, the blockage it thought it had found and had not, what it would look at first tomorrow. None of that fits on a card, and it used to be written as though it did |

Anything a person needs to read and no machine does is an ordinary comment. The rule is that
each thing is said once, in the carrier that owns it.

**Two of the refusals were wrong and one was missing**, which is the other reason this was
worth rewriting rather than lengthening.

- *"You may not endorse your own subtree"* did not describe what happens. A child filed
  under an **owned** P0 is workable the moment it is filed — owning the epic was the
  agreement, and that is the whole argument for this agent having `bd create` where the
  repo advocate does not. What is genuinely not its to do is take `unendorsed` off a bead
  that arrived carrying one: those are somebody else's discoveries waiting for a tap, and
  removing the label *is* the tap. Same prohibition, aimed at the write that actually
  exists.
- **Nothing said it may not close.** It has no `bd close`, but it has `bd update`, and a
  status is a field — so the one thing standing between an advocate and closing the epic it
  is answerable for was that nobody had thought to mention it. A work bead closes when its
  merge lands and [the merge queue is what closes
  it](answering.md#an-epic-does-not-close-because-a-branch-that-shared-its-name-merged); a P0 closes
  when its theme is done, which is a call its owner makes. An advocate that believes its P0
  is finished says so in the waiting-on line, which is the sentence on the card the close
  would be tapped from anyway.
- **Nothing said it may not pause itself.** [Pause is a button on your
  screen](inbox.md#pausing-one-epic--the-button-that-stops-dispatch-under-a-p0-without-stopping-the-repo)
  and the label behind it is yours. An advocate that could set it would be the one agent
  here able to stop being asked.

**And the run brief now says what to do with the reason it was opened for.** The sweep hands
a window one prose sentence — `bc-x.3 has been in progress for over 1h with nothing on this
Mac in a window on it and no live lease elsewhere` — and until now said nothing at all about
what that asks of it. Three shapes, in the order `reason` composes them:

- **a child closed** — does the plan still fit, is anything now unblocked that nobody has
  noticed, and is the P0 itself finishable? That last only ever becomes true on a close;
- **a child was filed** — is it in the plan, under the right parent, and work this P0 has to
  carry at all? One carrying `unendorsed` is waiting on you, not on the advocate;
- **a child stalled** — look for a branch or an open pull request carrying its work first,
  because if there is one the work exists and the bead is exactly where it should be. If
  there is not, the claim belongs to a window that died, and **while it stands the bead is
  invisible to `bd ready`** — no advocate, no worker and no queue will ever look at it
  again. `bd update <id> --status open --assignee ""` puts it back, and a comment saying
  what was found stops the next window redoing the reasoning.

That last one is not hypothetical, and the example is this section's own bead.
`bc-xl7n.8.1` was left `in_progress` on 2026-08-14 by a session that delivered and exited,
and the answer that arrived on the 16th — *"back to `bd ready` as ordinary work"* —
commissioned more work without writing the status that would let anything see it. Claimed,
with nothing in a window on it and no lease anywhere, under an enrolled P0: exactly the
shape above. It was in no queue for three days, and it came back only because an advocate
window eventually worked out for itself that the *status* was what was hiding it.
The rule was always derivable; putting it in the brief is the difference between an agent
that can derive it and one that starts there.

`node test/epicadvocate.mjs` holds the foundation and the brief together: that the kind has
a role at all, that its four carriers and its refusals are in it, and that the three shapes
are in the brief a window is actually handed.

### One to three sessions, and never silently fewer

`maxWorkers` is how many sessions one advocate may have open at once; it is clamped
to `maxWorkersLimit` (default 3, and a config asking for six gets three *and a log
line*, rather than failing to start). `globalMaxWorkers` caps every advocate
together (default 20, hard ceiling 36), so six repos each allowed 3 cannot open
eighteen windows. Both count *workspaces*, not checkouts — a workspace holding forty
approved repos still gets `maxWorkers` windows in total, which is
[a decision with a cost](config.md#one-advocate-many-checkouts--what-spans-repos-and-what-does-not).

Whenever a cap is what stopped a launch, it says so — on the card and in the log —
because a slot limit that quietly drops a launch reads exactly like an advocate that
has decided there is nothing to do.

Neither number needs an editor. The per-repo one is a stepper on that repo's advocate
card, and the global one is a stepper in the block at the top of the console, beside
the two health lines — both change the running daemon on the next tick *and* write
themselves to the config, so a `launchctl kickstart` does not put the old number back.
The global row also says how much of the cap is in use (`3 of 20`), which is the
question you actually came to that number with. A config written before the default
moved is bumped from 10 to 20 exactly once, with a line in the log saying so; a 10 set
deliberately afterwards stays 10.

Each session opens the same way the **Discuss** button does: a real iTerm2 window
running `claude --permission-mode auto` in the repo, which means you can watch it,
steer it, or close it. Its brief tells it to claim the bead first, to read and obey
the repo's own `CLAUDE.md` (worktrees, tests, deploy — the daemon has no business
knowing those), and to end in one of exactly three ways: **landed** — its own pull
request merged and its bead closed — **handed over** as a pull request for you to
decide, or **handed back** to you with the `human` label and a decision block. A session
with no honest exit invents one, and the one it invents is "close it and hope".

Landed is the ordinary ending. Handed over is what happens when the merge was refused or
the session asked for a human; closing its own bead over a local commit is what it is
told to do only where there is nowhere to open a pull request at all — see
[Landing work](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue), which
is where the rest of that lives.

### It will not create beads

Opening a session on a bead you filed needs no permission — you filed it. Filing a
bead *for* you is a different act: it makes you answerable for something an agent
thought of, and a tracker full of an agent's opinions is worse than an empty one.

That rule is unchanged, and it now has two ways of being kept rather than one. A
session that trips over something mid-work proposes it *then*, with
[`beadcause-propose`](landing.md#discoveries-and-conflicts-at-the-moment-they-happen) — same
card, same buttons, nothing created until you tap. What follows is the other way: what
happens when a repo runs *out* of work and something has to go looking.

So when a repo [runs out of ready work](#when-it-actually-goes-looking--what-out-of-ready-work-has-to-mean),
which is a narrower condition than it sounds, the advocate spawns a **read-only** survey
agent (`bd`, `git log`, read, grep, and the [web lookups](agents.md#looking-something-up--and-why-it-is-not-bashcurl) — nothing that can create, close or delete a bead) which reads the recent
closes, the blocked beads, any `## Discovered` notes left in comments by sessions
older than the propose command, and the repo's own docs. If it finds nothing worth filing it says so and the advocate
goes idle, which is a perfectly good outcome and one the prompt asks for explicitly.

**One write got let back in, deliberately: `bd label add`.** It is the exception to
the paragraph above, and the reason is that a survey often finds work that is
*already tracked* and just needs you — `bd label add <id> human` is how a bead
reaches the inbox, and going the long way round (proposing a bead about a bead) would
be absurd. So the survey gets `bd label add` plus `bd label list` and `bd label
list-all`, because a label chosen without seeing which labels exist is how a graph
grows six spellings of one tag. It does **not** get `bd label remove` or `bd label
propagate`, and the grant is spelled one level down — three entries, not
`Bash(bd label:*)` — for exactly the reason the reply agents' list is spelled verb by
verb. The prompt says what labelling is for, so it is not used as a general-purpose
bead editor, and `test/allowlist.mjs` asserts both halves: that `add` and the two
reads work, and that `remove` and `propagate` are still unreachable. The advocate's
`writes` flag stays `false` — it means *may create, close or delete work*, and
labelling sits outside that on purpose, because drawing the advocate the same as a
work session would overstate what it can do.

If it does find something, you get **one ordinary question in the inbox** carrying
the entire text of every bead it wants — title, type, priority, the full
description, what done looks like, and how it found it. Nothing is created until you
say so. Approving runs `bd create` for each, labelled `advocate`, and the answer
comes back with the new ids in it.

**Each bead gets its own ✓ and ✕, and the bulk controls are in the card's top bar.** A
proposal is *n* decisions that happen to arrive together, and flattening them into
all-or-nothing is what makes an agent's suggestions annoying: one good bead in three
is an ordinary outcome, and having to decline all three to avoid the two bad ones
teaches you to decline everything. So the card draws a row per bead — approve,
decline, or leave it undecided — and **Approve** / **Decline** sit up in the top bar
beside an undecided count, hard right. (They are the only thing left in that bar on a
shut card: [reading is the card itself now](inbox.md#the-card-is-the-control--tap-it-anywhere-to-open-it).) Two taps to commit, like
every other answer here. The YAML block no longer renders on the phone at all; it is
parsed out and drawn as those rows.

**There is no third button, and the two that are left are not symmetrical.** The card
used to end in three full-width buttons — the two bulk ones, which only *marked* every
row, and a primary underneath that did the filing. Two of them existed to set up the
third, which is a lot of a phone screen for one decision, and none of the three
answered the question they sat under. So the bulk pair took the primary's job: each
arms on the first tap and files on the second. **Approve** files everything you have
not explicitly declined, which is what keeps *"Approve 1 of 2"* reachable with the
primary gone — ✕ the one you don't want, then approve. **Decline** files nothing at
all whatever the rows say; it is the full stop, and a full stop that quietly created
two beads would be the worst button in the app. Both name their count before the
second tap (*"Tap again · create 2 of 3"*, *"Tap again · create nothing"*), because
the exact number the next tap files is the one thing the old primary carried that had
to survive the move. Undecided rows are still counted rather than folded into the
declines: *"3 undecided"* is the difference between a considered decline and a
half-read card.

**Each row is the whole record, not a summary of one.** The number sits in a gutter
and the body hangs off it, so the column reads as a numbered list of beads. Under the
title: the type and priority pills, then the description, then everything else that
approval would actually write — **Done when**, **Design**, **Notes**, **Labels**,
**Depends on** — each under a quiet label, in the same order the question body prints
them. Description and acceptance go through the markdown renderer, so a bulleted
description is bullets rather than one run-on line; before this they were escaped
text clamped to three lines, and acceptance criteria wrapped in among the pills with
nothing saying what they were. The rationale comes last and in italics, because it is
an argument for the bead and not part of it. A long row starts folded with a **Show
the rest** under it, so three proposals still fit on a screen — a fold and not a
clamp, because a clamp cuts a list mid-item and offers no way to see the rest.
Unfolding touches that one row and nothing else: the picks you have already made, and
the count on the approve button, are exactly where you left them.

`node scripts/proposal-check.mjs` checks that: headless Chrome at phone size driving
the real `public/app.js` against a proposal built by `lib/proposal.js` and parsed back
by `lib/decision.js`, so the fixture is a round trip and it never touches a bead. It
asserts the lists render as lists under their labels, that every field appears, that
the body lines up under the title, that a long row folds and a short one is left
alone, that unfolding leaves the picks and the button untouched, that the bulk pair
is in the top bar with no third button under the rows, and that each of them arms,
disarms the other and says its own count — and that a poll does not fold the row back
up under you. `--baseline` serves `HEAD:public/app.js`
and `HEAD:public/style.css` instead of the working copy, which is how you tell a real
failure from a flaky one. `--out=<dir>` writes a screenshot of each state.

What was **declined is recorded** on the closed question along with what was created,
because a proposal answered "create 1 and 3" and closed with only the new ids reads,
later, as though 2 was never offered.

Consent is still checked against text, because two of the three paths have nothing
else: an ntfy action button and a typed answer can only send a string. `CREATE:` on
its own means all of them; `CREATE: 1,3` picks by the numbers printed beside the
beads. The app sends both — the sentence for you, the indices as a field — and the
field wins. Free text can never create a bead by accident: *"yeah go on then"* is a
comment, which is exactly what it looks like. One open proposal per repo at a time,
and at most one every `proposeCooldownHours`.

### When it actually goes looking — what "out of ready work" has to mean

The paragraph above says *when a repo runs out of ready work*, and that sentence hides
the whole mechanism. Six things have to be true in the same tick before `propose` is
even entered, and every one of them is a filter somebody added for its own incident:

- **the advocate is not paused**, and is not inside quiet hours — pausing means "open
  no more sessions", and proposing is one;
- **it has no window open on this repo**, because an advocate that proposed new work
  while it was doing old work would be doing the easy half of its job;
- **`bd ready` is empty** of anything it could take;
- **and empty for no *reason*** — none of the eleven holds fired. A queue emptied by a
  hold is not a clear one: `heldByChildren`, `heldByUndecided`, `heldByRepo`,
  `heldByTwin`, `heldByPr`,
  `heldByLive`, `heldByLease`, `heldByClaim`, `heldByNoRoot`, `heldByPause` and
  `heldByOwed` each stand
  for work that *is* there and cannot be started yet, and an advocate that said "clear" over one and
  then filed new beads beside it would be burying the one sentence that says what to
  fix. This is the condition that does most of the stopping, and the card says which:
  *"nothing ready · 1 already in an open pull request"* is not the same sentence as
  *"clear — no ready beads"*, on purpose;
- **`propose` is on**;
- **and `proposeCooldownHours` has elapsed** since the last survey. The stamp goes on
  *both* outcomes, including "nothing worth proposing", so an advocate that found
  nothing does not spend another ten agent-minutes finding nothing again before lunch.

Then one more, inside `propose` itself: **no proposal is already waiting on you**. Two
asks in an inbox is how an advocate starts reading as noise, and the second would be
written without the answer to the first.

**That conjunction is rare by design, and for a while it looked broken instead.** On
2026-08-11 it had never once been true on this laptop: `lastProposalAt` was null for
all six advocates and no `<workspace>_advocate.log` existed, so the entire survey half
of the advocate had run only in its own tests. Three of the eight holds were added
*after* `propose` was written, and each one makes "clear" rarer — which is a reasonable
thing to be suspicious of. It fired for real the next day: the `architecture` advocate
surveyed on 2026-08-12, wrote its transcript, stamped `lastProposalAt`, proposed two
beads and asked to change its own foundation. So the gate opens; it opens for a repo
that is genuinely idle. Four of those six advocates were *paused*, which is a stop long
above the queue and says nothing about the gate at all. `beadcause`'s own still has a
null stamp, and that is the gate working rather than the gate stuck: this repo has not
had an empty, unheld queue and no open window in the same tick since the advocate was
switched on. A queue that is never dry is a queue that never needs proposals.

`test/proposegate.mjs` is that measurement turned into something that can fail, because
one reading of one file on one laptop does not stay true and the next filter added above
`propose` would close the door again with nothing to say so. It drives a clear queue
through a real tick and asserts the survey is reached, then takes away one condition at
a time — a worker, a hold, the pause, the cooldown, the switch — and asserts it is not.
The positive case is the point: `test/repoqueue.mjs` already covers a queue that must
*not* propose over itself, and a gate only ever tested shut cannot tell "correctly
closed" from "welded shut".

### The premise the survey could disprove in one command

Everything above is what the daemon means by an empty queue. What the survey agent was
*told* was something else, and much simpler: *"Your queue is empty: there is no ready
work left in this repo's beads tracker."*

That is a claim about the tracker, and the tracker is one command away. The survey's `bd`
is the read-only half but `bd ready` is very much in it, so the first thing the agent can
do is check — and on the one real survey this Mac has run, it did. Its third line was
*"The stated premise — an empty queue — doesn't match reality here; there are 49 ready
beads"*; its write-up to Adam opened *"First, the premise was wrong."* It then spent its
opening moves re-deriving what the daemon was already holding, and wrote itself a
cross-repo memory — `advocate.verify-the-empty-queue-premise`, *"treat the empty-queue
claim as a hypothesis"* — which is the prompt teaching an agent to distrust its own brief.
That is a worse outcome than a vague sentence, because it generalises: the next survey
arrives suspicious of everything else it is told too.

**The premise was not even close, and the reason is that two of the subtractions are
invisible from the agent's side.** `Bd.ready` forces `unendorsed`, `ship` and `container` on every
caller, the advocate's own `QUEUE_EXCLUDED` adds `human` and `promote` (a release bead the
release agent carries — bc-y8k4.7), plus anything marked
`superseded-by:<id>` — and then `minPriority` takes out the backlog. The agent's own
`bd ready` applies neither. On a tracker fed from JIRA, where every ingested ticket
arrives `unendorsed` (see [an epic per ticket](config.md#an-epic-per-ticket--filed-once-forever-and-held)), that
gap is most of the graph. So *"no ready work left in the tracker"* is false whenever the
queue was emptied by a filter rather than by the work being done — which is most of the
time.

So the sentence now claims only what is true — **my** queue is empty, after the filters —
and the gap between the two lists is handed over rather than left to be discovered.
`queueBrief` in lib/advocate.js is that paragraph: it names the five labels and why each
one is not work, gives the priority floor with the number of beads sitting under it, and
predicts the disagreement outright — *"your own `bd ready` will not agree with me … it is
not a contradiction of this brief, so do not spend your opening moves proving it wrong"*.

**It carries the counts, and that is what turns an apology into the most useful paragraph
in the prompt.** A survey that knows thirty-seven beads are waiting on your endorsement
can say *that* — or `bd label add` one of them to your inbox — instead of proposing a
thirty-eighth beside them, which is a better answer to "is this genuinely finished" than
anything it would have found by grepping. The two numbers come from `Bd.readyHeld` and
`Bd.readyShip`, the same narrow calls the [monitor's ready count](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time) already uses;
they are free here, where a screen refreshing every twenty seconds could not afford them,
because a survey runs at most once per `proposeCooldownHours` and immediately precedes a
ten-minute agent. Both are allowed to fail, and a failure costs the paragraph its numbers
rather than the survey its run — `null` and `0` are kept apart all the way down, because
*"nothing is waiting on you"* is a claim and *"I could not ask"* is not.

**The eleven holds get the opposite treatment: a promise rather than a list of zeros.** They
are always empty when a survey runs — that is the gate in the section above — so the brief says
so in one sentence and tells the agent nothing is hiding behind them, which is worth more
than eleven lines reading `0`. It is derived rather than asserted: `queueBrief` reads the
lists, and a future caller reaching it without that gate would get the counts instead. The
hold names live in one exported table, `QUEUE_HOLDS`, and `test/surveybrief.mjs` fails the
repo for any `heldBy*` field of the agent record that has no row in it — so a twelfth hold
filter is a red test rather than a hold the survey is silently never told about. The bead
that asked for this said "eight"; `heldByPause` had been added in between, and the list in
the section above still said `heldByNoP0` a rename later. `heldByUndecided` is the tenth
(bc-jvt0.4) and the counts above were nine when it landed, which is the same drift a third
time. `heldByOwed` is the eleventh (bc-4r10.20), and the *count* remains the only part of
these two paragraphs a reader should distrust.

### What you see, and where

- **The advocate console** (📣 in the tab bar, at `/monitor` — and at `/sessions` and
  `/work`, which it absorbed) is one card per repo: what the advocate is doing, the
  beads it has windows open on, what it will pick up next, its survey transcript, the
  proposals waiting on you, what its finished sessions left behind, and the other work
  in that repo — your own claimed beads and every live `claude` process, each one
  tappable for its transcript. Plus **Pause** / **Reclaim sessions** / **Forget
  attempts**. *Reclaim sessions* asks each open window whether it is still working —
  see below. Above every card, one line saying **which program launchd is running** —
  dim when it is this checkout's `bin/router.js`, and a red block with the fix when it
  is not; see [the router](operations.md#the-router--why-you-never-restart-it) for why that line is
  there on a good day too.
- **The monitor** (`npm run monitor`) has an advocates pane above the questions, and
  every launch, close, lapse and proposal appears in its event log.
- **The launchd log** (`~/Library/Logs/beadcause.log`) carries the same events as
  `[advocate] <repo>: …` lines, and the startup banner names every repo that has one
  with the number of sessions it may open.

### How a session starts: iTerm runs the command, nothing is typed

Since bc-txh7w, `scripts/open-session.applescript` creates the window **on** its command
(`create window with profile … command …`) instead of typing it into a login shell. The
command is `launchCommand` in `lib/session.js`:

```
/usr/bin/env DISABLE_AUTO_UPDATE=true /bin/zsh -lic 'source <command file>; exec /bin/zsh -il'
```

A typed launch line is just more input on the tty, like anything else typed there, and
three bugs came from that. The two sections below are two of them. The third is why it changed:
iTerm always takes the keyboard when it opens a window, and focus only comes back a beat
later (`restoreApp`). Anything you typed in that beat went into the new window's shell,
ahead of or in the middle of the launch line, and broke it. As an argv, the launch line
cannot be touched by anything typed. Stray keystrokes wait in the tty's input queue and
are read by `claude`, as input to the session.

What each part does:

- `-l` and `-i` give back what iTerm's own login shell used to: `path_helper` and
  `~/.zprofile` for `PATH`, and `~/.zshrc` for the `chpwd` hook that `cd` fires to point
  `BEADS_DIR` at the right tree. Both were checked in a real iTerm window.
- `DISABLE_AUTO_UPDATE=true`, because oh-my-zsh's update question runs `read -r -k 1` while
  `~/.zshrc` loads, even under `-c`. When the launch line was typed, it fed that read
  (see below). With nothing typed, the read would **block** and the window would wait at
  the question until someone pressed a key.
- `exec /bin/zsh -il`, because iTerm closes a window when its command exits. A work
  session's `exit` ends the shell before this is reached, so its window still closes.
  A chat or a resumed conversation drops to a prompt when `claude` exits
  (bc-2uj4.16.1).

`test/strayinput.mjs` types into a real pty while the shell starts, and checks each of
those points.

### History: the 1024 bytes a tty will take

A window opened, echoed its command cut off mid-argument, and sat at a prompt. Nothing
had crashed and nothing was logged, because nothing had run.

`scripts/open-session.applescript` types the command in with iTerm's `write text`, and
what it types into is a fresh login shell **still working through `~/.zshrc`** — nvm,
pnpm, a second or two of nothing in particular. Until zsh's line editor takes over that
tty is in canonical mode, and a canonical-mode tty on macOS holds exactly `MAX_CANON` =
**1024 bytes** of unread input. Byte 1025 onward is discarded, and what is discarded
includes the newline — so the line is never submitted at all.

The command had simply grown past it. On the day it was reported every session was over
the line: worker 1047 bytes, advocate 1541, epic-advocate 1622. The two furthest over
are the two with the longest allowlists, and an allowlist only ever gets longer — every
tool an agent is granted is another ~20 bytes of a line the tty will not read. So a
shorter command is not the fix; a command that is not typed is.

What gets typed now is `source '<path>'` — a constant ~60 bytes however large the real
command grows. `source` rather than running the file as a script, because everything
below the first line needs to be in *this* shell: `cd` fires the interactive `chpwd`
hook that points `BEADS_DIR` at the right tree, and the closing `exit` is what ends the
window. The file deletes itself on the way out through the same cleanup the system
prompt uses — after the exit status is captured, never before, since every `rm` sets
`$?` too.

`test/canonline.mjs` pins all of it, and measures the limit against a real pty rather
than quoting it: 1500 characters sent, 1024 echoed, nothing delivered.

### History: the other thing eating that line — a reader in the rc files

(`sourceLine`, `TTY_PAD` and `test/ttyread.mjs`, described below, were removed in
bc-txh7w, because nothing is typed any more.)

A window came up and printed this, and the third line is the whole bug:

```
[oh-my-zsh] Would you like to update? [Y/n]
[oh-my-zsh] You can update manually by running `omz update`
ource '/var/folders/.../beadcause-cmd-4eaf3aa87171.zsh'
zsh: command not found: ource
```

The section above is about a line too *long*. This is about a line typed while the
shell's line editor is not yet the thing reading the terminal — and while that is true,
anything in the rc files that reads the tty reads **our bytes**.
`~/.oh-my-zsh/tools/check_for_upgrade.sh` is `read -r -k 1 option`: one character,
straight off the front. It took the `s`. What the line editor then submitted was
`ource '<path>'`, and the `s` fell through omz's `case` to its `*)` arm — which is why
the window also answers a question nobody was there to answer.

That window ran nothing, and it did not look like it. It sat at a zsh prompt with the
tab still named after its bead, so every liveness check read it as healthy; the bead was
pinned to a session that did not exist until the lease lapsed. The cost is bc-xl7n.113.2's
subject and it is worth reading beside this.

**oh-my-zsh is one instance of a class, and the class is what is defended.** The front of
the typed line is not safe, so nothing load-bearing goes there: `sourceLine` pads it with
eight spaces, which a shell throws away before it parses and a reader eats instead of the
command. Eight readers' worth of food, eight bytes against the 1024 above, and when there
is no reader at all it costs a line of history that `HIST_IGNORE_SPACE` would have
dropped anyway.

**Spaces, and never a newline.** A newline is the obvious sacrifice and the one character
that must not be used: omz's arm is `[yY$'\n'])`, so a newline does not get eaten quietly
— it answers *yes* and runs `omz update`, minutes of git on your machine because a byte
was wanted. A space falls to `*)` and changes nothing.

Which is also why the prompt keeps coming back: `*)` records no answer, so omz asks
again in every window for the rest of its 13-day window. `n` would land on `[nN])` and
stamp the timestamp and stop it — but `n` is not inert to a *shell*, so with no reader to
eat it the line reads `nsource '<path>'` and nothing runs at all. It would have to be a
sacrificial line of its own, and then every window beadcause opens is quietly answering
a question of yours on your behalf, forever. A repeated prompt in a scrollback is the
cheaper of the two.

Both halves were measured rather than reasoned about, because either one being false
would have made the whole fix an inert comment:

| the question | how it was answered |
|---|---|
| does iTerm's `write text` deliver leading spaces, or trim them? | eight of them into a live session running `head -1 \| cat -et`, which came back `        source '…'$` |
| does the reader eat the pad instead of the command? | a real pty, an rc file that does nothing but `read -r -k 1`: unpadded reproduces `command not found: ource` bit for bit, padded runs |

`test/ttyread.mjs` is that second measurement, kept: the reproduction is a check of its
own, so taking the pad out cannot look like a passing suite. It uses a stand-in rc file
rather than oh-my-zsh, since a suite that needed omz installed would be testing the
laptop rather than the repo. And it uses a pty throughout for a reason worth knowing
before you try to simplify it — `read -k` refuses a pipe outright (*"not interactive and
can't open terminal"*) and leaves the byte alone, so a pipe does not reproduce this bug,
it makes it look already fixed.

**What is not covered, and two shapes that were declined.** A *line*-oriented reader — a
bare `read answer` in an rc file — consumes up to the newline and takes the command with
it, pad and all. Defending that needs a sacrificial line typed ahead of this one, which
costs an empty prompt at the top of every window forever, and nothing in these rc files
does it. Of the alternatives:

- **Quiet the readers from the dynamic profile.** iTerm will run a Custom Command instead
  of the login shell, and `env DISABLE_AUTO_UPDATE=true zsh -il` means omz never asks. But
  a Custom Command is not run through `login`, so `path_helper` and the login `PATH` go
  with it, and nothing in the suite can exercise an iTerm profile. Getting it wrong is
  *every* window opening a shell that cannot find `claude`, found out by a queue that
  stopped moving. Eight spaces cannot fail that way.
- **Wait for the prompt before typing.** It sounds like the fix for the whole class and it
  is the opposite: a `read` with an empty buffer **blocks**, so the shell never reaches a
  prompt, so the wait times out — and then the same character is lost to the same blocked
  read, a timeout later. Buffered input is what keeps that reader moving; the pad is what
  makes it eat the right byte.

### How a session ends, and the parts that stay guesses

The command runs in an interactive shell, so when `claude` exits you get a
prompt back and the window sits there forever — fine for the one you opened to talk
something through, useless for an advocate that will open dozens. So a **work**
session's command ends with two extra things: its exit status written to
`~/.config/beadcause/workers/<repo>-<bead>.done`, and `exit`, which ends the shell
and lets iTerm close the window behind it.

The file is the more valuable half. Without it the daemon can only *infer* that a
session finished; with it, four endings stop looking alike:

| the file appears and… | reading |
|---|---|
| the bead is closed | **done** — the slot frees, the attempt counter resets |
| an open `pr-delivery` question **or an open `merge-queue` merge-bead** names this bead | **delivered** — the work is in a pull request; a documented ending, so it costs no attempt |
| the bead carries `human` | **handed back to you** — a documented ending, so it costs no attempt |
| neither | **exited unfinished** — costs an attempt, and the exit code is logged |

The delivered row is asked of the tracker rather than read off the bead, because a
bead blocked by a question is not distinguishable from a bead blocked by anything
else — and the id of the question is worth having anyway. "Delivered" and "delivered,
and here is what to go and answer" are different things to put on a card.

**Both labels, because there are two things a delivery leaves behind.** `pr-delivery`
was the whole of that row while a worker's delivery *was* a card in your inbox. Since
bc-r941 it is not: a worker files a **merge-bead** — `merge-queue`, one per pull
request, a blocker on the work bead by construction — and stops; a `pr-delivery` card
is raised later, and only on the failure path, when the merge queue has tried three
times and the merge has become yours. So on a repo whose workers take the queue route,
asking for `pr-delivery` alone asks whether the merge *failed*, and a delivery that is
going perfectly well answers no. That is not a labelling nicety: **delivered** is the
ending that frees the slot and hands the window to the reaper, so without it a worker
that had done everything right fell through every ending to `workerTimeoutMinutes` —
two hours — holding a slot against `maxWorkers` and holding its window on the screen
with `** BEAD WORK DONE ** CAN BE CLOSED **` sitting in it the whole time. That was
most of the window pile bc-2uj4.5.4 was filed about: 204 `releasing the slot` lines in
one daemon log, and every `delivered as a pull request` line in its whole history
belonging to a repo still on the older route.

Everything else really is inference, and is treated as such. Nothing on the Mac
records which process is on which bead; an advocate knows it *opened a window* for
a bead, and that is all it knows. So:

- The bead is the evidence. Claimed means started; closed means done.
- A window closed by hand kills its shell with a SIGHUP before it can write
  anything, so the guess is kept as a fallback: a bead never claimed, with nothing
  running in that repo, is treated as closed-by-hand after `lapseMinutes` — the slot
  frees and the bead costs an attempt. After `maxAttemptsPerBead` the advocate
  leaves it alone rather than reopening the same window forever.
- A pid is shown only where the session took the bead id into its own name, which
  the brief asks it to do. Where it didn't, the row says when the window was opened
  and nothing more.

#### The window that opened and never ran its command

Every ending above starts from a session. This is the one that does not: the window came
up, the command was typed into it, and the shell never ran a line of it.

A dispatch does not *start* the command — it **types** it, with iTerm's `write text`,
into a fresh login shell that is still running `~/.zshrc`. Until zsh's line editor takes
over, anything in those rc files that reads the terminal reads **our bytes**. On
2026-08-21 that was oh-my-zsh's upgrade prompt, whose `read -r -k 1 option` took one
character off the front of the buffered line; the window then submitted `ource '<file>'`
and sat at a prompt. Fixing *that* is a different piece of work. This is about the fact
that **nothing noticed**.

Nothing could. The window is alive. It is sitting at a zsh prompt, in the right
directory, with the bead's id on its tab, and it has no `claude` in it — so there is no
session record, no pid, no status, no done file, and nothing for the reaper to signal.
Every liveness check in this daemon reads it as healthy, and the first thing that ever
disagreed was `workerTimeoutMinutes`, two hours later. Three costs, in the order they
matter:

1. **the bead is pinned for two hours** — the worker record holds the slot, and a bead
   this advocate has a worker on is not dispatchable;
2. **it is then charged an attempt**, and `maxAttemptsPerBead` is 2 with nothing that
   decrements it. So two launches lost to a shell prompt can retire a bead from this
   machine's queue for good — which is [the state that reads as ordinary ready work
   everywhere else](#a-bead-it-has-given-up-on-says-so);
3. **it leaks its three temp files**, because the shell that would have removed them is
   the shell that never ran.

82 leftover command files had accumulated in TMPDIR in eighteen hours when this was
measured, 55 of them with their prompt file still beside them. Two beads accounted for
most of it, relaunched about every three minutes, and the log line `bc-khoe.21 was
claimed by 26 machines — this one holds it` turned out to be the claim counter counting
failed launches.

**The probe was already on the disk; nothing was reading it.** `sessionCommand` emits, in
order, `P="$(cat <prompt>)" && rm -f <prompt> && claude … && rm -f <system> <command>`.
So the prompt file goes away *before* `claude` starts and the command file *after* it
exits, and two `existsSync` calls answer the question exactly:

| prompt | command | reading |
|---|---|---|
| present | present | **the shell never reached line 3** — nothing ran |
| gone | present | the session is running now |
| gone | gone | it ran and exited |
| present | gone | something else took a file — `unknown`, and nothing is concluded |

The last row is why this reads two files rather than the obvious one. A prompt file with
no command file beside it is not a state this daemon can produce, so it is somebody
else's — a TMPDIR sweeper, a suite tidying up after a fixture — and the safe answer to a
state you cannot explain is to leave the window alone. Asking only about the prompt file
would take a live session's slot away on a sweeper's schedule.

So `launchProgress` in lib/session.js reads those two files, `launch` reports the three
paths back for the first time (it always minted them and always forgot them the moment
`osascript` returned), the worker record carries them, and `reconcile` asks once per tick
for any worker older than `advocates.neverStartedSeconds` — 45 by default, seconds rather
than minutes because the whole value is answering before the two hours, and not
milliseconds because what is being waited out is a `~/.zshrc` with nvm and pnpm in it.
`0` or `false` switches the probe off and restores the old behaviour exactly.

When it fires: the ending is logged against the bead as **never-started**, the slot comes
back, the three temp files are removed, the claim is handed back if there was one — and
**no attempt is charged**. Not *counter cleared*: not charged. A launch that never ran is
not an attempt at the work, and wiping the counter would erase a real earlier failure
that this launch says nothing about. That is the load-bearing half; the slot would have
come back on the timeout eventually, and the attempt would not.

**The order of those two is what makes a mistimed grace safe.** The fair objection to
measuring this in seconds is the false positive: a Mac loaded enough that `~/.zshrc` takes
longer than the grace, a launch cancelled that was about to work, and two windows on one
bead — which is the worst failure in this file. It cannot happen, because the temp files
are taken away **before** the slot goes back, and the command file is the only thing that
slow shell was ever going to read. When it finally gets past its rc files it sources a path
that is not there, says so, and stays at its prompt. A launch cancelled this way is
cancelled for good, so the worst a mistimed grace costs is one wasted window and one fresh
dispatch — never a second agent on work somebody else is already doing. Cleaning up after
releasing the slot would give up exactly that property.

Two things it deliberately does not do. It does not teach the stall sweep about
handed-back beads, which would undo
[the re-entry rule](#the-claim-a-window-leaves-behind). And it knows nothing about
`delivered` or `handback` — both leave the bead open and the TUI on screen, which is
exactly what a stalled window looks like from every other angle, and both consumed their
prompt file at line 2 an hour before they got there. The probe cannot see them, so it
cannot confuse them, and it sits *ahead* of every inference branch for that reason and
*behind* the tracker's own answers — a closed bead is a fact somebody just handed over,
and it outranks anything on a disk.

`never-started` is not in `REAPABLE`, and could not usefully be: closing a window needs a
pid, and the pid on this record is null because no `claude` ever ran there. The window
stays on screen — one to close by hand, which is what a `zsh` prompt with the bead's name
on it is.

`test/neverstarted.mjs` is the check: the four states off a real directory, the ending,
the temp files, the same bead dispatched three times without the counter moving, and
delivered and handed-back sessions coming out unchanged.

#### The window that disappeared — and the conversation that comes back into the next one

The section above is a window that never started. This is the opposite end: a window that
started, worked for an hour, and then **went away** — closed by hand, killed, or lost with
its terminal.

Until bc-y7l2m nothing noticed. There was no ending for it, so the window fell through to
`workerTimeoutMinutes`: the slot was held for **two hours**, then the bead was charged an
attempt and its claim forced off, and the next window was briefed from scratch. Measured on
2026-08-24, both windows on this Mac that died that morning stopped writing at 10:47 and
were written down as having timed out at 11:55 and 12:22 — four hours of held slots between
them, and two full transcripts sitting unread on disk the entire time.

**The whole fix rests on one distinction: a window that is *gone* is not a window that is
*quiet*.** `silent`, `timeout` and `lapsed` are all read off a window still sitting on the
screen, and the note beside `parkWorker` is right about them — an agent that stopped
answering may be wedged mid-turn, and resuming it would resume the wedge. A window whose
live-session row is *absent* stopped answering for a reason that says nothing about the
agent at all. Somebody hit ⌘W.

So `reconcile` now watches for the absence, and what follows is the ordinary parking
machinery pointed at a new ending:

| | |
|---|---|
| **noticing** | a worker with a session id whose row is not in Claude Code's live-session list, on a Mac where *other* rows still are, for `goneMinutes` (default 3) of consecutive ticks. Three minutes and not one tick because the evidence is an absence: a list being rewritten can be read a moment short, and concluding from one miss would take a working agent's slot, force its claim off and hand its bead to a second window — [which is the worst failure this file has](operations.md#a-tracker-two-macs-share) |
| **the ending** | `gone`, and it fires long before the two-hour timeout. The slot comes back, `handBack` puts the claim back in the queue, and **the bead is charged no attempt** — the same argument as `silent`, only stronger. A window vanishing is evidence about the window; `maxAttemptsPerBead` is 2, so charging a closed terminal would retire beads for something no session did wrong |
| **the park** | the conversation is written down exactly as a handed-back one is — session id, directory, and now the **ending** that put it there, because that is what decides which turn it wakes up to |
| **the other sensor** | pressing **Reclaim sessions** asks iTerm about each window by id, and `missing` is the same fact measured a stronger way — that one needs no clock, and it now reaches the same ending rather than the older `reclaimed`. The `!term` branch beside it stays `reclaimed`: a slot freed *without asking* measured nothing, so there is nothing to conclude about the conversation |
| **the resume** | the next dispatch through `launch` finds the park and opens that conversation instead of briefing a stranger, in the worktree it was standing in. Usually the same tick: the hand-back happens at the end of `reconcile`, and the survey a few lines later reads a bead that is ready again |

### And a claim this daemon never made — `lib/claimsweep.js`

Everything above is about a window **this daemon opened**. A claim left by a session it did
not open — a `claude` started by hand in a worktree, one that crashed before it delivered, a
planner killed at the wrong moment — has no worker record for `reconcile` to miss, so
nothing ever freed it. Measured on the `bc-` graph on 2026-09-19: **81 beads in progress, 52
of them untouched for a week or more, the oldest 39 days**. A claimed bead is not in `bd
ready`, so the queue looked 52 beads shorter than it was.

`sweepClaims` runs at the end of the slow half of the cycle, after the advocate tick,
because the tick is what rebuilds the snapshot it reads to find out which beads a live
window is on. A bead is freed only when *every* one of these is true:

- nothing has touched it for `staleClaimHours` (default 72 — see [config.md](config.md));
- no live advocate window holds it, batches and plan groups included;
- no live session **names** it (`namesBead`, the same read `reconcile` uses) and no live
  process **argv** names it (`linesNameBead`, workspace-qualified — the read that covers a
  window still inside its first slow suite, which is exactly when one looks abandoned);
- it carries none of `pr-delivery`, `merge-queue`, `shipped` or `stood-down`, which mean the
  work is done and waiting on a pull request rather than waiting on a session.

It comments and reopens, and it never closes or judges anything: the bead comes back exactly
as it was, minus the claim, with a note saying how long it had been silent. A session that
*is* still on it takes it back with one `bd update <id> --claim`. `staleClaimHours: 0` turns
the sweep off.

The turn it wakes up to is **not** the one an answered question gets. `resumePrompt` opens
with "Adam answered", and handing that to an agent whose window was merely closed sends it
hunting through the bead, the comments and its own transcript for a decision nobody made —
the one failure here that the agent cannot detect for itself. `interruptedPrompt` says the
opposite in its first line: your window disappeared, **nothing was answered**, do not start
over. Then the two facts its transcript cannot contain, because both happened after its last
line — its claim was forced off and it has to take it back, and time has passed so `main` has
probably moved. The two turns are chosen off the recorded `ending` and never off whether an
answer happens to be in hand, because a perfectly ordinary handback whose question was filed
as its own bead has no answer under that key either.

**And it does not loop.** `maxResumes` (default 1) is the guard. The first disappearance is
an accident, repaired for free. A conversation whose *resumed* window also disappears is not
an accident any more — something about that agent, that worktree or that bead is killing
windows — so that one is charged an attempt, nothing is parked, and the bead falls through
to the fresh brief the attempt counter was always arranging. Two counters, deliberately:
`resumes` bounds how many times a **conversation** is carried over, `attempts` bounds how
many times a **bead** is tried. The trip count rides on the worker record between one park
and the next, because the resume *drops* the park — a record left behind is a conversation
two dispatches would both try to bring back.

One quiet consequence, in `archiveFinished`: the salvage comment that tells a handed-back
bead ["what its dead window built"](#and-the-hand-back-tells-the-bead-what-its-dead-window-built) is suppressed for a
conversation parked for resume. Every word of that comment's justification is "the next
window opens a fresh worktree", and here the same agent comes back to the same tree holding
the same commits — the note would be telling it, about its own live branch, that it was
abandoned. The archive under `refs/beadcause/sessions/<bead>` is still written either way;
that is the record, and the comment was only ever a courtesy to a stranger who is not
coming.

`test/gonewindow.mjs` is the check: the ending inside the grace, the attempt not charged,
the park and its ending, the resume into the parked tree wearing the interrupted turn, the
trip count surviving into the next window and stopping the second one, and the four things
that are never called gone — a window merely idle, a worker matched by name rather than by
id, a Mac whose session list came back empty, and one tick of absence on its own.

#### A bead it has given up on says so

`maxAttemptsPerBead` is a floor nothing decrements. The counter is cleared on the four
endings that are not failures — closed, delivered, handed back, stood down — and on
nothing else, so two windows that die without reaching one of them retire the bead from
this machine's queue **permanently**: `2 < 2` is false, and stays false until somebody
presses something.

That is the right behaviour. A bead that kills two windows should stop taking them, and
the cure has been one press on the console since the counter existed — **Forget attempts**,
which clears them all. What was missing was every word of the diagnosis, and the cost of
that was not theoretical.

The bead reads as ordinary available work on every surface there is: open, unclaimed,
carrying no queue-excluding label, sitting in `bd ready`, counted in the advocate's own
`queue` number, drawn on the board beside beads that will be picked up in thirty seconds.
The one line that ever mentioned the state was the tick's own note, and it said this:

```
[advocate] beadcause: 3 ready · 3 settling or already tried
```

`settling` was `queue − ready`, which welded a bead thirty seconds inside `settleSeconds`
to a bead that will wait for ever, reported them as one figure, and named neither. And
`note` says a thing once — `if (a.note === text) return` — so once the queue steadies the
line prints a single time and the log is silent from then on. Correct logging behaviour,
and it means the only clue to a permanently retired bead was one unrepeated sentence whose
number could not distinguish thirty seconds from forever.

**bc-xl7n.37 is what it cost.** Five consecutive Epic Advocate passes read that bead as
healthy — "queued behind a busy Mac, not stalled; do not release it and do not file for
it" — and every one of those readings was reasonable, because the Mac genuinely was at its
worker limit each time. The two explanations only separated when the Mac went completely
empty and the bead still was not dispatched. Its second window had committed working code
when it died: `test/binentrypoints.mjs`, 247 lines, fourteen checks passing, never pushed,
still sitting in its worktree. There is no third window, so nothing was ever coming back
for it — and two earlier passes had concluded the opposite, on the strength of
`lib/session.js`'s "this is attempt N, read the comments first" injection, which only ever
fires on attempts 2..`maxAttemptsPerBead`.

So `givenUp` in lib/advocate.js is the other half of `candidates`'s attempt filter, and it
is said in three places:

- **in the note, on every tick that has a non-empty queue** — `· 2 given up on after 2
  attempt(s) (bc-xl7n.37, bc-sj8k.7)`, appended to whichever line the tick writes,
  including the one that says it is opening windows. That last part is the case the old
  line could never have reported: a tick that opens two sessions beside a bead retired for
  ever looks exactly like a tick that opens two sessions, and the retired bead is the one
  still there tomorrow. `heldBySurface` is on that line for the same reason;
- **as a pill on the advocate card**, `p1` alongside `heldByRepo` and `heldByNoRoot` — the
  holds that never clear on their own. This one is worse than either: both of those are
  visibly held, and this one reads as ready work everywhere else. The tooltip names each
  bead and how many windows it spent;
- **on the button**, which now reads `Forget attempts (2)` and lists them in its tooltip.
  The count is the subject the control never had. `forget` clears *every* counter at once,
  so pressing it blind also re-arms a bead that really does break every window it gets —
  knowing which beads are in it is the difference between a lever and an action.

What is deliberately not done: raising the cap, and clearing the counter on a dead window.
Both would undo the thing the cap is for. `settling` keeps only what genuinely does clear
itself — a bead inside `settleSeconds`, or one this advocate already has a window open on
— and a bead with a live window is never reported as given up on, because it is at the cap
by construction for as long as that window is up.

##### An epic is never retired by the cap

Everything above is an argument about **one bead**: two windows died on it, so stop
spending windows on it, and the rest of the queue carries on. That arithmetic is true of a
leaf and false of an epic, because the survey holds an epic's ready children *behind* it —
`foldedInto` for a batch or a planner, `plannedInto` for a group. Retire the one row and
every bead held behind it goes with it, and none of the three surfaces above says so: they
are not in `givenUp`, which reads the queue and they were taken out of it; the card draws
them as `batched under bc-x`, which is a sentence about a window that will never open; and
the pill counts one bead where the subtree may be twenty.

**Both fallbacks written to survive a spent epic were therefore dead code.** [The
mechanical grouping](#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window)
hands an epic at the cap a batch instead of a planner, on the stated reasoning that a
window that will not open again must not hold its children forever; `plansFor` dispatches a
stale plan's groups rather than re-planning. Both end in a queue row that the attempt
filter then dropped, so neither could ever dispatch anything.

**loremia lm-5i2, lm-gr6 and lm-b5d are what that cost.** They were charged out on
2026-08-24 and that workspace read as healthy for 27 days — the loose ready beads either
side of them kept the queue moving and the card kept saying so, and the stall only became
visible when the loose work drained and there was nothing left to open a window on.

Epics are also the most exposed to the charge in the first place. The counter is cleared on
[four endings](#a-bead-it-has-given-up-on-says-so) and an epic advocate reaches none of
them when it does the most ordinary thing it does: parking because it is waiting on an
answer from Adam is a *normal* epic ending, and every ending that is not one of the four
costs an attempt. Two quiet epic windows retire a subtree.

So `retiredByAttempts` is the one predicate the pick, the surface-collision skip and
`givenUp` all read, and it answers **no** for anything the survey has made speak for other
beads — an epic by its type, and anything carrying a `group`, a `batch` or a `planner` this
tick. A group lead is in that list for the smaller version of the same reason: the rest of
its group waits behind it in `plannedInto`, so retiring the lead freezes the group.

What does **not** change: the counter still charges, **Forget attempts** still clears it,
and the cap still decides *which brief* a spent epic gets — plan versus batch, re-plan
versus dispatch-the-groups-as-written. Only the retirement is lifted, because the thing it
was withholding is not one bead.

And the tick says so, once per spell, naming the thing that would have been stopped:

```
[advocate] loremia: lm-5i2 has spent 2 window(s) and maxAttemptsPerBead is 2 —
dispatching it anyway, because retiring it would stop 9 ready bead(s) under it
```

with `· 1 epic(s) past the cap, dispatched anyway (lm-5i2)` on the tick note beside the
given-up list, which is the same fragment for the same reason: both are answers to *what
has the attempt cap done to this queue*. There is no card pill and no `QUEUE_HOLDS` row,
because nothing is being held — this is the opposite report.

`node test/epicattempts.mjs` is the check: the epic dispatched at the cap and its children
not stranded, the group lead carried for the same reason, a plain task still retired, both
halves of `givenUp` staying quiet about the epic, the line with the subtree count in it,
and the line being said once rather than every thirty seconds.

##### The bead is in two queues, and only one of them is the tracker's

Answering **Request changes** on a delivery card says, on the card and on the phone, that
the work bead *is back in the queue*. It puts it back in exactly one of them.
`handBackWorkBead` reopens the bead and drops the assignee, which is the whole of `bd
ready` — and `candidates` filters again, on `a.attempts`, in the daemon's memory, where no
tracker write reaches. So a bead already at `maxAttemptsPerBead` came back open,
unclaimed, carrying no queue-excluding label, and permanently unpickable, while the one
sentence that reached a phone said the opposite.

**bc-xl7n.87 is the bead it happened to**, and how it got there is the ordinary shape
rather than an unlucky one: both of its advocate windows timed out at two hours with no
commits, so both charged an attempt, and the pull request was then made by a session the
daemon never opened — so the `delivered` clear in `reconcile`, which only ever fires for a
window this advocate launched, never ran. It was retired before anybody had read a line of
its diff.

Two halves, and the first is the fix:

- **the hand-back clears that bead's charges** — `advocates.rearm(workspace, bead)`, called
  by `handBackWorkBead` after the reopen and never instead of it. An answer of yours is a
  fresh commission, not a third retry, which is the same reasoning `reconcile` already
  states out loud for `delivered` and `handback`: "documented endings the brief asks for,
  so neither costs an attempt". It is the **per-bead** clear and not `forget`, because
  re-arming every other bead in the repo as a side effect of answering one card is not
  what the tap said. Where there were charges the log line says so, and where the bead was
  actually *retired* the card says so too — the one case where the promise it made was
  false. A hand-back bd refused clears nothing: the bead is still claimed by a session that
  is gone, and clearing its counter would only make the log read better.
- **and a retired bead that is claimed is now reported at all.** `givenUp` was computed
  over the ready queue, so a bead that is retired *and* claimed — which is what a delivered
  bead is — was in neither queue nor list: the tick note named three other beads while
  bc-xl7n.87 sat there. It walks the counters too now, and names a bead the tick's own
  export says is `in_progress` or assigned, marked `claimed` so the card can tell it from
  the ready ones. Only what that export can vouch for: nothing decrements `a.attempts`, so
  a counter outlives its bead, and a list built from the map alone would name last week's
  closed work for ever.

`test/givenup.mjs` and `test/handbackdelivery.mjs` are the checks — the first for the
report and the per-bead clear, the second for the whole answer driven through
`/api/respond` against a `bd` that enforces the refusal.

##### A fix does not un-write the counters it was about

The idle sweep closes a quiet window on purpose, and the shell in it writes `$?` on the
way out — so the next `reconcile` found a done file and took the `ended` arm, whose whole
premise is "it exited, closed nothing, delivered nothing and asked nothing; that is the
one ending here nobody chose". Somebody chose it: this daemon. The next dispatch then
resumed that same conversation rather than briefing a new one, it went quiet into the same
silence, and the second park charged again. A bead could reach a cap of two having had
**one** reading of its brief and one replay of that reading's silence.

Both halves are fixed — `w.idleParked`, and the trip count riding on the worker so
`carryOver` binds. **Neither fix touches a counter already written.** When they landed, 64
beads in this workspace stood at the cap: 16 whose bead had closed under them, 10 epics
that lose only their planning, and **36 live open work beads carrying no queue-excluding
label** — about a third of the ready queue, every one of them in `bd ready` looking exactly
like work about to be picked up. And the only lever that reached them was `forget`, which
clears all 64 and would have re-armed the beads that genuinely do break every window they
get.

So the daemon recounts, and the recount is a proof rather than a guess. Every ending
`reconcile` reaches writes one line through `finish`, and the sentence on it says which
ending it was — so a bead's whole charge history is in `~/Library/Logs/beadcause.log`, in
order, and `lib/attemptaudit.js` replays it twice:

- **once under the rule that was in force when the lines were written.** If that lands on
  the number the counter actually holds, the log explains the counter completely — nothing
  charged it before the log begins and nothing charged it by a path the replay cannot read.
  That equality is the *only* warrant for touching anything;
- **and once withholding the charges for endings this daemon chose** — an `ended` arm that
  followed a `parked worker <id>` line. That number is never larger, and where it is
  smaller the difference is exactly the two shapes above.

The verb in the park line is the discriminator and it is not cosmetic. **Parked** means the
conversation reached the disk and today's `ended` arm skips the charge; **closed** means
`carryOver` refused the trip, the transcript was thrown away, the next window gets a fresh
brief and the charge is owed exactly as it always was. Reading the two the same way would
forgive the one charge `maxResumes` exists to write.

What the guard buys is the case that would otherwise have been cleared wrongly.
`bc-khoe.21` holds 27 `the nightly maintenance window is closing the Mac down` endings in
the log against a counter of 2, because that ending only started charging later and most
of those lines predate it. Any heuristic reading — "it was never really given a fair go" —
clears that bead. The equality refuses to, and says how far apart the two numbers are. On
the day it landed the split was 38 repaired, 25 left retired, 1 refused.

Three properties keep it cheap and keep it safe:

- **it can only ever lower a counter.** The recount is accepted only where it is *below*
  what is held, so the worst a misread log can do is give a bead one more window. The
  other direction — a repair that retires something — is not reachable from the code at
  all;
- **the log is read once per bead, not once per tick.** `attemptAudited` in
  `advocates.json` records which counters have been recounted and at what value, so a 39MB
  file is opened only when a bead newly reaches the cap, and never on an ordinary tick.
  Persisted for the reason `lastWindowSweepAt` is: this daemon is restarted by its own
  merges several times a day;
- **a log it cannot read repairs nothing.** Every sentence matched is one lib/advocate.js
  writes, and `test/attemptaudit.mjs` pins all twenty-six of them against that file's
  source — because when a template changes the module's own failure is *silence*, which is
  indistinguishable from the healthy quiet pass it usually is.

And the lever is now per bead. `rearm` had always done exactly one bead and had exactly one
caller — `handBackWorkBead`, reachable only by answering **Request changes** or **Decline**
on a delivery card — so a bead that *delivered* had a lever and a bead that never delivered
had none, which is the whole population the cap actually retires. The console's advocate
card grows a **Given up on** section directly above *Up next*, one row per bead with the id,
what it is, how many windows it spent, and a **Give it a window** button beside it. A
retired bead that is *claimed* is drawn without one and says which door instead: its lever
is `Request changes` on its own card, which re-arms it on the way through.

What is deliberately still not done: raising the cap and clearing the counter on a dead
window. `w.idleParked` is read once, ahead of all three arms that would otherwise charge a
window this daemon closed — `ended`, `timeout` and `lapsed` (bc-xl7n.150). A park raced by
the two-hour timeout used to reach `timeout` before the shell wrote its exit status and
charged; each of the three arms now writes `— this daemon parked it for being quiet` on
the sentence when it declines, and `lib/attemptaudit.js` reads that suffix the same way for
all three, so a window that genuinely ran out its two hours without being parked is still
charged by both. Counters written by the old code for a raced park are repaired by the
recount's park flag, not by the suffix, because an old line never had one.
`test/attemptaudit.mjs` is the arithmetic and `test/attemptrepair.mjs` is the daemon
half — the repair reaching `a.attempts` before anything reads it, surviving a restart, and
`rearm` through `control` taking the charges off one bead where `forget` takes them off all
of them.

#### The claim a window leaves behind

A worker claims its bead as its first act, because that is what stops a second window
being opened on top of it. Every ending in the table above takes the claim off again: a
delivery closes the bead, "request changes" reopens it, `bin/plan.js` hands an epic back
explicitly. The endings *nobody* chose — exited unfinished, timed out, asked to check in
and never answered — used to take it off nowhere. The slot went back, the attempt was
charged, and `in_progress` stayed on the bead for good.

A claimed bead is not in `bd ready`, and `bd ready` is the whole of what an advocate can
see. So a window shut by hand at midnight took its bead out of every queue this daemon
builds, permanently, on the strength of a session that did nothing — and counted the
attempt, which is the tell: counting attempts against `maxAttemptsPerBead` on work that
can never be attempted again is counting nothing.

**Where it bit hardest was an epic.** A planner claims its epic like any other window, and
`bin/plan.js` un-claims it as its last act, precisely because the advocate reads plans off
epics **in `bd ready`** — a claimed epic makes its own plan invisible. A planner that died
before that step left the epic claimed, the plan it had already written unread, and the
epic's children falling back to one window each. Degraded rather than stuck, self-healing
the moment anybody reopened the epic by hand, and silent: nothing anywhere said "this
epic's plan is unreadable because a window that is gone is still holding it".

So `reconcile` now puts the claim back, on those three endings only, and only where
nothing is sitting in the bead:

- **a busy window keeps its claim** — `timeout` and `silent` are both endings a session can
  reach mid-sentence, and un-claiming under a live one is how two windows end up on a bead
  that spans ten repos;
- **an idle window counts as gone** — a worker's window holds exactly one turn, the brief,
  so the moment that turn is over the session is finished. This is the case that matters:
  a window whose agent fell over does not vanish, it sits there idle, and a rule that
  waited for the window to *disappear* would hold the claim for as long as nobody happened
  to close it;
- **the three endings the session reached for itself change nothing** — closed, delivered
  and handed back all want the bead exactly where it is, and a delivered bead reopened
  would be handed to a fresh window while the pull request it is waiting on sits there;
- **`stood-down` changes nothing either**, because that claim is one row both Macs can see
  and dropping it here would drop the winner's;
- **a tracker that refuses the write is not an error** — the bead stays claimed, which is
  where it already was, and the next window to reach one of these endings tries again.

The hand-back runs before the same tick's survey, so a bead freed this way is workable
immediately rather than thirty seconds later — and where the dead window is still on
screen, the live-session filter is what stops a second one opening over it.

#### And then the tracker refused it — twenty beads, and four that never came back

That last bullet was the bug rather than a caveat, and it took bd two minor versions and
a month to show it. **bd 1.2.1 refuses to clear a claim from an actor that is not the
holder:**

    cannot reassign bc-xl7n.61: held by "neo@example.com" (in_progress); coordinate
      with the holder (bd mail neo@example.com) — pass --force only if their claim is
      abandoned (crashed agent, expired lease), or use bd reclaim

On this path actor and assignee can never match, *by construction*. The window claimed
the bead under the human's git identity — that is what the brief tells it to do, and what
`bd ready` reads — and every write beadcause makes is stamped `beadcause`. So the write
was not refused sometimes: it was refused every time, from the moment the version landed,
and the three retries behind it could not help because nothing here is a race.

Which turns "the next window tries again" into a sentence with nothing behind it. There
**is** no next window: the bead is still `in_progress` and still assigned, so it is not in
`bd ready`, so no advocate can see it, so the only thing that would ever have retried the
hand-back was the hand-back that just failed. `grep "could not hand" ~/Library/Logs/`
`beadcause.log` on 2026-08-17 found 20 distinct beads, against 39 windows that exited
without closing one — roughly half of every dead window since the bump.

**It partly self-heals, which is why nobody noticed.** Sixteen of the twenty closed anyway
in the end, because a pull request landed or somebody reclaimed the bead by hand. Four did
not: they sat `in_progress` under no window at all, one of them for two days, indexed
nowhere and mentioned by nothing. A bead in that state is not *late* — it is gone, and the
only trace of it is a line in a log.

So the hand-back asks for `Bd.reopenAbandoned` rather than `Bd.reopen`, which is the same
write with `--force` appended — but only after the plain one has come back refused, and
only when *that* refusal is what came back. The flag is what the refusal itself prescribes
for a claim that is abandoned, and this is the one caller that can be sure it is: it runs
**because** the window is gone. `bin/plan.js`'s last act goes the same way, for the same
reason and a shorter one — the claim it is releasing is its own.

**Three things were deliberately left alone.** `Bd.reopen` still has no flag on it, because
`lib/jiragate.js` reopens a ticket coming back off Jira whose holder may still be typing,
and there the guard is doing exactly the job it was added for; force belongs at the call
site that has established otherwise, not in the shared write. `Bd.commission` was on this
list too when it was first written, and [it should not have
been](#bdcommission-was-on-that-list-too-and-so-was-the-other-half-of-the-answer-path)
either. The refusal is
matched by its own regex (`REASSIGN_GUARD_RE`) rather than by widening the one that reads
a refused *close*, because both hand `--force` to their caller and the two sentences share
no wording — a regex that drifted across them would step over a live blocker or an epic's
open children on the strength of a claim. And `--force` on `bd update` lifts the gates
around moving an issue into a *done* status as well as this guard, so the argv it is
attached to is pinned, whole, in `test/reassignguard.mjs` — the status it names can only
ever be `open`.

That suite asks the binary as well as the code: a stub can only confirm what `lib/bd.js`
already believes, and *that the plain write is refused at all* is a claim about bd. Like
`test/closegatereal.mjs` it runs against a fresh throwaway workspace, and skips loudly
where `bd` is not installed.

##### The review path was on that list and should never have been

The first of those three said the review path in `lib/server.js` reopens a bead whose
holder may still be typing. It does not, and had not since **bc-r941**: a worker delivers
and *stops*, so the window that claimed the bead is reaped minutes later and the answer
comes hours after that. Every `CHANGES:` and every `DECLINE:` was therefore releasing an
abandoned claim through the write bd refuses for abandoned claims, and the bead stayed
`in_progress` and assigned — out of `bd ready`, with the delivery card already closed as
answered and nothing that re-raises one. The pull request sat open with a change requested
and nothing anywhere was coming back for it.

Eleven of these were answered on 2026-08-17 and two were refused. `bc-36xx.10` on #401 was
frozen for two hours and read as healthy from every angle — open PR, `MERGEABLE`, a
downmerge pushed by a resolver — and was found only because an Epic Advocate happened to
look at its timestamps: `started_at`, `heartbeat_at` and `lease_expires_at` were all still
the original claim's. The other nine survived because the worker window happened still to
be alive, which is luck rather than design.

Both answers now go through one helper, `handBackWorkBead`, which asks for
`Bd.reopenAbandoned` — so a live claim is still handed back unforced, and a dead one no
longer strands the branch. **And the helper returns whether it worked**, which is the other
half of this. The old code caught the refusal into a log line and then announced
`— <bead> back in the queue` on the very next line, unconditionally, after a call whose
outcome nothing looked at; the card said the same to the phone. That is what made this two
hours of hunting rather than one `grep` of the log, so the line and the card now report
what happened, and the response carries `delivery.handedBack` for anything watching.
`test/handbackdelivery.mjs` drives the whole answer through `/api/respond` against a fake
`bd` that *enforces* the refusal and reads the bead's row back afterwards — a stub that
only records argv would pass with the bug still in.

##### Bd.commission was on that list too, and so was the other half of the answer path

The review-path correction above fixed the *hand-back* half of this guard. **The
*answer* half — the one Adam actually taps — had the identical bug in two places, and
both of them were on the "deliberately left alone" list above.** That is bc-xl7n.88.

`Bd.closeAnswered` recovers from bd's *close* refusal (`assignee is … actor is …`) by
clearing the assignee and closing again: `bd update <id> --assignee ''`, no flag. The
docblock above it said the clear was "permitted from an actor that is not the
assignee", measured against an *open* bead. Every question this method ever runs on is
`in_progress` — a worker claims it as its first act, same as the hand-back's beads —
and against an `in_progress` bead the clear is refused in the reassign guard's own
words, every time. The failure was quiet in the worst way: `answerOnce` had already
written the answer to the thread, the close then threw, and the card stayed in the
inbox to be answered again — bc-ko7n's shape, reopened through the door bc-ko7n had
just closed. `Bd.commission` — "build both as written", the answer that orders work
instead of settling the question — called the plain `Bd.reopen` for the same reason
this section's list gave it a pass: "the holder may still be typing". It never was. A
question's assignee is the same worker-window artifact the hand-back's is, and by the
time an answer reaches `commission` that window has always already delivered, handed
back, or filed the question and stopped.

Both now escalate the way the hand-back does: try the plain write, and reach for
`--force` only on the specific write that guard refuses, only after that refusal comes
back. `closeAnswered`'s escalation is narrower than `reopenAbandoned`'s, on purpose —
its write never touches status, so there is no "moving into a done status" for the flag
to lift, only the one guard it names — and `commission` was simply pointed at
`Bd.reopenAbandoned`, the method already built for this. `lib/jiragate.js` is the one
caller left on the live-holder list, and it is a different shape: a ticket coming back
off Jira really can still be under a claim nobody has released yet.

Measured against the real binary rather than reasoned about, the same way the
hand-back's refusal was: an `in_progress` bead refuses a bare `--assignee ''` clear and
a bare `reopen` in the exact words `REASSIGN_GUARD_RE` already matched, `--force`
clears both, and a subsequent close or reopen then succeeds
(`test/reassignguard.mjs`'s real-`bd` section). `test/answerclose.mjs` covers the fake
side of `closeAnswered`'s escalation and `commission`'s new call, argv by argv.

##### And the hand-back tells the bead what its dead window built

Forcing the claim off fixed the four beads that never came back, and it opened a gap of
its own — bc-xl7n.102. Before it, a dead window left the bead `in_progress`, which is the
single state the stall sweep reports; **every** recorded stall shape, including "committed
but never pushed", was found from an `in_progress` bead. Once the claim comes off, the bead
is genuinely workable again *and* there is nothing left saying a window ever ran.

Which matters because a window that dies is often a window that dies *after committing*.
`archiveSession` has the facts at exactly that moment — the branch, the head sha, the
commit list — and hands them back; the advocate puts them into `pendingNotes`, whose only
consumer writes its git note **when the branch reaches main**. For a bead going back into
the queue that never happens: nothing will push the branch, because the bead is workable
and the next window opens a fresh worktree. So the commits were counted, logged, and then
dropped on the floor.

bc-xl7n.37 is the measured case. Attempt 2 exited 143 having committed `ceaa82df` on
`worktree-bin-entrypoint-cover-xl7n37b` — `test/binentrypoints.mjs`, 247 lines, fourteen
checks passing, the whole bead — and the log said `archived bc-xl7n.37 → …(1 commit(s))`
in the same reconcile pass that handed the bead back. It then sat in `bd ready`
indistinguishable from unstarted work, and was rescued twice by an advocate typing a
comment on it by hand.

So `archiveFinished` writes that comment itself, on the ending nobody chose and only
there: the worker was handed back, the archive reported commits, and they are not already
in main. The carrier is chosen rather than invented — an ordinary worker's brief runs
`bd comments <id>` before it claims, unconditionally, at attempt 1 — so this needs no new
label, no new sweep, and in particular **not** teaching the stall sweep to look at
handed-back beads, which would put the bead straight back into the state the force-off
exists to end.

`salvageNote` (lib/sessionlog.js) builds it: branch, worktree, head sha, count and commit
subjects, because for an unpushed branch nothing else records them — plus the two facts
that change what the reader should *do*. **How far behind main it is**, since a branch a
hundred commits back wants a cherry-pick onto a fresh worktree rather than a checkout. And
**whether it was ever pushed**: unpushed, that worktree is the only copy of the work in the
world and the comment says so; pushed, there is very likely a pull request already carrying
it — bc-xl7n.83 was handed back on a timeout with its work sitting in an open PR — and
telling a worker "never pushed" there would simply be false. One `rev-parse` picks the
sentence.

It is written after the archive rather than in `handBack`, because `handBack` runs inside
`reconcile` where none of those facts exist yet; the bead is back in `bd ready` for the
seconds in between, which is the same tick. A tracker that refuses the comment is logged
and dropped: the archive is the record and the comment is a courtesy to the next window,
and one bead's failed write must not cost the rest of the finished list its archive.
`node test/salvage.mjs`.

#### Closing the window — a session that has finished should not still be on screen

The `exit` above only runs **when `claude` exits**, and a session that has finished its
work does not exit. `claude … -- "$P"` is interactive — the brief is its first prompt, not
its whole life — so when the last turn ends the TUI goes back to waiting for a human
who, by construction, is not there. The bead is closed, the pull request is merged, and
the window is still open.

The cost is not the window. It is that a screen of them is indistinguishable from a
screen of sessions that stopped to ask something, so every one has to be read before
any can be dismissed — which is the whole of what beadcause exists to stop. Seven of
them were sitting here when this was written, all named `DONE-…`, all idle, every bead
closed hours earlier.

So the daemon finishes the sentence the session could not. When a worker has **reached
one of its own endings** and its process is still running, the advocate signals it:
`claude` exits, the shell runs the two commands after it, the done file lands, and iTerm
closes the window exactly as it does for a session that ended on its own.

##### Which endings those are

Three of the eight. Not because three is a compromise, but because the brief gives a
session exactly three ways to *finish*, and every one of them ends somewhere that is not
the window:

| ending | where it is answered |
|---|---|
| `done` — the bead is closed | nowhere. There is nothing left to answer |
| `delivered` — the merge was refused, or it asked for review | a card in the inbox whose one tap is the merge, on a pull request that is open on GitHub |
| `handback` — it needs a decision | the question is on the bead, under a `human` label, in a `decision` block written to be answerable from a phone |

Four of the others — `unfinished`, `timeout`, `lapsed`, `silent` — are not endings a
session reached. They are the daemon inferring from a window that went quiet that
something went wrong, and a window somebody should read is precisely what that is. Those
stay open.

And the eighth is neither, which is why it is not here either:
[`never-started`](#the-window-that-opened-and-never-ran-its-command) is a measurement
rather than an inference — the launch's own temp files say the shell never ran a line —
but there is nothing to close. No `claude` ever started in that window, so the record
carries no pid, and `closingFor` would refuse it on guard 2 whatever this set said.

`delivered` and `handback` were left out at first, on the theory that a session waiting
on a decision has something on screen worth reading. It has not, and that is not luck:
both endings put everything they know **on the bead**, by design, because being
answerable from a phone is the whole of what they are for. Nor does the answer come back
through the window — [ship](landing.md#ship-it--the-same-merge-and-then-the-deploy),
[request changes](landing.md#request-changes-is-a-sentence-not-a-button) and
[decline](landing.md#decline-is-the-other-one-and-it-is-not-a-stronger-no) all comment on the bead
and reopen it, an answered question unblocks it, and every one of those routes ends with
the advocate opening a **new** session on the same branch with the note waiting for it. The window that delivered was never the channel; it was a second
copy of a card, costing a read.

The payoff is the sharper for including them. A `done` window closes inside the minute,
so with the other two left open, anything still on screen an hour later was delivered,
handed back, or broken — three things that look identical until each is read. With them,
a window still there is a window in trouble.

Reaching them at all took a second change, because **neither is an exit**. Both leave the
bead open on purpose, so neither trips the closed-bead test; and `claude` is interactive,
so neither writes a done file. Tested only against the done file, they were recognised
solely once *you* had closed the window — until which point a delivered session held its
slot until `workerTimeoutMinutes` and was then written down as having **timed out**,
charged an attempt for reaching an ending the brief had asked it to reach. So the test is
now "has it stopped talking": the done file, or an idle window. `idle` carries that for a
worker because a worker's window holds exactly one turn — the brief — so the only moment
that turn is over is the moment the session is finished.

Everything about the rest of it is a guard against signalling the wrong thing, because a
signal is the one act here with no undo:

| before anything is sent | why |
|---|---|
| the session **reached one of its three endings** | not timed out, not lapsed, not gone silent. Those four are this daemon's inference about a quiet window, and the inference is the reason to read it |
| Claude Code still reports that pid as a live session **named after this bead** | records in `~/.claude/sessions` outlive their process and pids get reused, so the pid alone is worthless. A subtask id (`<bead>.1`) is not its parent, either — the id has to stand on its own in the name |
| the session is **idle** | it goes on working for a moment after it reaches its ending — the `QUEUED-` rename, the last message — and that moment is `busy` |
| and has been for `closeGraceSeconds` | "idle" is a status file the session writes itself, and the gap between two turns looks exactly like the end of the last one |

Then `SIGTERM`; then `SIGKILL` if that was ignored for `closeHardSeconds`; then, after
`closeGiveUpMinutes`, it stops and leaves the window alone. Giving up is a real
outcome: a session that will not take a signal is one worth looking at by hand, and a
daemon that escalated forever would be worse than the windows. A busy session that
never goes idle is left open for the same reason, and costs nothing but a line in the
log.

The waiting list survives a restart, alongside the workers and for the same reason —
the windows are still open, and a daemon that forgot them would leave the pile this
was written to clear. An observer instance signals nothing at all.

##### And which window a worker row is actually about

Guard 2 above is only as good as the pid and session id on the row it is checking, and
those are re-read on every tick — a worker is joined back to its window each pass, because
a window opened seconds ago has not renamed itself yet and a daemon that has just come up
adopted its slot list from a file. That join used to be made on the window's **name**: the
first live session whose title carried the bead id. A name is a string the *session* writes
about itself, and a reviewer, a resolver and an Epic Advocate all quote the bead they are
about, so it cannot tell a worker's window from any of them. Measured here on 2026-08-23:
the worker row for `bc-zjab.12` had re-bound onto `beadcause - review PR 617 (bc-zjab.12)`,
the review window this daemon had opened itself on the pull request that worker delivered.

A re-bind is three bugs at once. The reviewer's window becomes a window an advocate holds a
slot for, so the [idle sweep](#parking--a-window-waiting-on-you-closes-and-your-answer-brings-it-back) steps over it and
nothing ever closes it. The slot it occupies is one the repo cannot dispatch into. And when
the bead does close, the closing record is written with the *reviewer's* pid **and session
id** — so guard 2, whose entire job is "never signal a window that is not the one we
launched", compares the reviewer against itself, agrees, and `SIGTERM`s a review halfway
through.

So the join is by **session id**, which `launch` mints before the window exists and Claude
Code reports straight back off its own live-session record: this is the same conversation,
or the conversation is gone. The name match survives as the adoption path and nothing else
— a worker with no session id was adopted from an older daemon, and once one is found it is
written down, so a row is adopted at most once. One question stays deliberately wide: *is
anybody at all in a window about this bead*, which is what decides whether the claim is
handed back. A window you opened by hand, on the same bead, after the daemon's own closed,
is exactly what makes that claim true — asking it by identity is how one bead ends up with
two windows.

##### The windows nobody is holding

Everything above starts from a **worker**: a row on the slot list, carrying the pid the
advocate launched. That is the narrowest possible claim to a window and it is why the
signal is safe. It is also why it could not touch the pile it was written for — those
windows had left the slot list hours or days before the feature existed, so nothing knew
their pids and nothing was ever going to signal them. Same for any window open when the
daemon was down: the session finished, the worker was reconciled away, and the window
stayed.

`sweepFinishedWindows` is the other end of the same job. It reads every live Claude Code
session in the advocate's workspace — whether or not this daemon opened it — and puts the
finished ones on the same closing list, where the four guards above decide the rest. That
is a genuinely wider claim than a worker row, which is why it is its own setting rather
than a detail of the one above, and why the two guards that replace the worker row are
the two that carry the weight:

| before a window with no worker is queued at all | why |
|---|---|
| its name **starts** with `QUEUED-`, `DONE-` or `done-` | not a guess about the session — the session's own account of itself. The work brief writes `QUEUED-` at the end of the work, `rename-session.sh --done` writes `done- ` for one shipped by hand, and the merge queue writes `DONE-` over the first when the branch actually lands. A window that closed its bead and never got as far as renaming itself is missed on purpose: a session that did not finish its own protocol is a window somebody should read |
| the bead named in that name is **closed** | the strictest reading of guard 1, and the one that does the work here. The case this widening risks is a window of *yours*, opened by hand and named after a bead — and while that bead is open, nothing can reach it. It stays the strict reading even though guard 1 itself now covers delivered and handed-back work, because those two are claims about a **worker** — this advocate launched that pid onto that bead — and a swept window has no worker, so nothing ties an open delivery card to the window in front of you |
| it has been **idle** for `sweepIdleMinutes` (default 20) | minutes rather than the 90 seconds a worker's window gets, because this window's identity is inferred from its *name* and not from a launch we made. Anybody actually reading it would have touched it inside twenty |

The bead id is read out of the name as the left-most lowercase `prefix-slug` — the second
field, ahead of the title — so a title may contain hyphenated words or mention other
beads. `DONE-Beadcause` is that exact shape and is *not* an id: matching is
case-sensitive, which is what tells a project name from a bead.

The sweep looks every `sweepIntervalMinutes` (default 5) rather than every poll, because
each candidate window costs a `bd show` and nothing makes one appear suddenly. It runs
while an advocate is paused — pausing means "open no more sessions", not "leave the
screen full" — and never while observing. `closeFinishedSessions: false` switches it off
along with everything else in this section: an off switch that only delayed the signal by
twenty minutes would not be one.

##### The windows that are no longer windows

Every sweep above ends at a pid, and every guard any of them keeps is there because there
is an agent in that window whose work would go with it. This last one closes windows that
have **no tabs left in them at all**.

They are not something anything here asks for. They are what iTerm occasionally leaves
behind when the last session in a window ends: the tab goes, the frame stays. Two were
caught on 18 Aug by sampling iTerm every twenty seconds — the `bc-y8k4.4` worker went
from a live session on `/dev/ttys018` to `tabs=0` inside one sample, and another worker
did the same two hours later. Both had been signalled in the ordinary way, and both were
left named `sleep`, which is the last job of a session's send-off: the shell got all the
way through its countdown and ran `exit`. The teardown was right. The window just did not
follow it.

What is left looks like a bug in this daemon and is not reachable by it. There is nothing
in the frame to read, nothing running, and no way in — ⌘W is *Close Session*, which is
disabled when there is no session, so the keystroke only beeps and the window can be
dismissed by hand alone. And nothing here would ever have closed it: the only close in
this daemon is the shell's own `exit`, and that shell is precisely what is missing. So
they accumulate, a handful a day, until you go round the desk clicking red buttons.

`closeEmptyWindows` (default `true`) closes them on the tick, and the test is the whole
of its safety argument: `count of tabs is 0`. No process, no transcript, no scrollback —
the thing the other sweeps' guards protect does not exist in one of these, and there is
no version of "it was still busy" that can be true. A window with any tab at all is never
touched. It runs once per tick for the whole Mac rather than once per advocate, because
an empty frame belongs to no workspace: the session that could have said which one is
exactly what is gone from it. And it never runs from a test suite — the same gate that
stops a suite *opening* a window on your Mac stops it closing one.

It also has to prove it worked, which it did not used to. The first version counted a
window as closed the moment `close` came back without raising, and iTerm accepts a close
on one of these frames without raising *and without removing the window* — the same
behaviour as the disabled ⌘W above, seen from the other side. So the daemon announced
2,330 closures it had never performed, the same handful of ids on every tick, while the
frames stayed on the desk; that is `bc-xl7n.110`. Each id is now re-queried after the
close and only counted once it is genuinely absent, so `closed 2` means two frames went.
Any that took the close and stayed get a line of their own — once each, not once a tick,
because a window that will not go is in every sweep from then until you dismiss it.

##### Parking — a window waiting on you closes, and your answer brings it back

Both sweeps above close a window that **finished**. Neither can touch the one there are
thirteen of: a window that **stopped**. A resolver that pushed its rebase, a MergeAdvocate
waiting on a review, an Epic Advocate that wrote its waiting-on sentence and had nothing left
to say — each has an open bead and a name that says nothing about being finished, so both
sweeps look straight past them, correctly, and they sit there until somebody opens them one
at a time. That was the state of this Mac on 2026-08-16: fifteen live Claude sessions,
thirteen idle, none of them on any advocate's slot list.

They were left open for a good reason. Closing a window destroys the only copy of what that
agent worked out, and an hour of context is worth more than a rectangle — which is why the
sweeps above only ever close windows whose work is provably *elsewhere*, in a closed bead or
a merged pull request.

**`claude --resume <id>` is what removes that reason.** The id is minted by the launcher
before the window exists (`--session-id` on the first turn, the same trick the chat session
and the in-app terminals have always used), so a window whose id has been written down is
not destroyed when it closes. It is **parked**: the conversation, the directory it ran in,
and one sentence about what it is waiting for, in `state.json`. When the thing it was
waiting on arrives, the advocate opens that conversation again instead of briefing a
stranger.

So the order is the whole safety property, and it is asserted in `test/parked.mjs`: **write
the record, verify it reached the disk, then close the window.** Never the close without the
record — one `saveAppState` per park rather than one batched write at the end of the sweep,
because a batch means the first nine windows are signalled on the strength of a record that
only lands after the tenth. A failed write is a window left open, which is exactly the state
that existed before any of this.

**And the sweep itself is asserted in `test/parked.mjs`'s companion, `test/parkidle.mjs`,
which builds no fixture at all.** For its first fortnight this feature parked nothing —
`state.parked` was empty, no `parked …` line had ever been written to the daemon log, and
resolver records from windows that closed hours earlier were still sitting in the open
register. The sweep asked lib/parked.js for its list with the workspace *object*, where
every writer of that register puts the workspace *name*, so the filter compared an object
against a string, matched nothing, and the loop body never once ran. There was nothing to
notice: an empty list is what a quiet laptop looks like, and `` `${object}/${id}` `` is a
perfectly good string, so keys were happily written as `[object Object]/bc-x` and read back
under themselves. `test/parked.mjs` was green throughout, because it passes the name by hand
— the one argument the daemon never passed. So the second suite stands up the real
`createAdvocates`, runs a real tick, and lets the advocate record be built the way the daemon
builds it, with both shapes on it; reaching for the wrong one is now a failing assertion
rather than an empty list. lib/parked.js also takes either shape and uses the name, because
the honest lesson of that fortnight is that this mistake does not announce itself.

The parks that *were* written in the meantime — by `finish`, for handed-back and delivered
workers, under the same wrong key — are **adopted rather than orphaned**, once, on the first
sweep that runs the fix. They are live conversations on live branches waiting for an answer,
and correcting the key without moving them would have made every one of them silently
unresumable as the fix's own first act. The workspace name cannot be recovered from a record
the bug wrote, so it is recovered from the one field that still says where the agent was
standing: the record's directory, resolved by the same rule a live session's `cwd` is. A
record whose directory belongs to another workspace is left for that workspace's advocate,
and one that maps to nothing at all is left alone to age out under the seven-day TTL — a
park nothing can place is not a park to guess at.

| before a window is parked | why |
|---|---|
| this daemon **opened** it, and said so at the time | the register in `state.json` is keyed by **session id**, written by `launch` itself. Every earlier attempt to match a window to what opened it matched on the *name*, and a name is something the session writes about itself and can change; the id is chosen by the launcher and reported straight back off Claude Code's own live-session record, so the join is exact. A window you opened yourself is not in the register and cannot be reached |
| it is not **busy** | the guard that is not about time at all. A window mid-turn is never closed, whatever else is true |
| it has been **idle** for `parkIdleMinutes` (default 10) | minutes, not the 90 seconds a finished worker gets, because here the ending is *inferred from silence* rather than proved by a closed bead. Ten and not sixty: an hour's grace means the screen is full for an hour before anything helps, which is the state of affairs already |
| if it is **one of Adam's own windows** (kind `chat`, `handoff` or `resumed`), it has been idle for `parkHandIdleMinutes` (default 30) | every kind of window beadcause opens declares when it is finished, in `SESSION_KINDS` in lib/reap.js, and `launch` refuses a kind that is not there. Adam's windows used to be exempt. They close now because he resumes them by session id, and they wait longer because he may be reading one |
| if it is a **worker whose slot this advocate still holds**, it has been idle for `parkWorkerIdleMinutes` (default 20) | the sweep yields to `reconcile` first, because `reconcile` knows what the session was asked and can say "delivered as a pull request" where this can only say "it went quiet". What that yield did not have was an end, and `reconcile` has no clock shorter than `workerTimeoutMinutes` — so a worker whose ending it could not classify kept its window for **two hours**, and `timeout` is not an ending that closes anything, so the close came from this sweep anyway, two hours late. Forty ticks for a better sentence, and then the honest one beats a rectangle |
| if its status is neither `idle` nor `busy`, it has stood there for `parkStuckMinutes` (default 60) | an unrecognised status used to answer `wait` **forever**, and a Claude Code record only moves when its session moves — so a window abandoned in a state nothing enumerates was invisible to every sweep on the Mac at once. One was measured at four days and sixteen hours in `shell`, holding a worktree lock. `busy` keeps its unconditional exemption: that is the one status that means an agent is mid-sentence |
| its conversation is **written down** | an id that is really an id, and the directory it ran in. `--resume <id>` finds the conversation from anywhere — measured on Claude Code 2.1.x — so the directory is not what locates it; it is what supplies everything the transcript cannot, which is the branch, the uncommitted edits and the files every path in that agent's context points at. Resuming in the wrong tree gives an agent a perfect memory of files that are not there, and it will act on it |

Two windows are exempt by their own door rather than by a guard: **Open a session** and a
**handoff**. Both mean *open me a window to work in*, and a window somebody is sitting in is
not a window waiting on somebody.

A worker that reaches one of its documented endings is parked by `finish` instead, which
knows which ending it was and can say so: **handed back** — it asked a question, and
answering the bead brings the session back — or **delivered** — a pull request is open, and
the merge brings the session back. Delivered says *which* of the two delivery routes it
took, because they end differently: a `merge-queue` merge-bead is the queue's to merge and
nothing is waiting on you, while a `pr-delivery` card is a tap you owe. Saying "waiting on
you" about the first would send you looking for a button that is not there. The other five endings park nothing, and the test is not "did
this window stop" but *does a conversation with this agent still have somewhere to go*: a
closed bead has nothing to answer, a stood-down window belongs to another Mac, and a session
that timed out or went silent is not one to hand an answer to.

**And the close this sweep performs costs the bead nothing.** It used to cost two, which was
enough to retire it. The sweep closes the window on purpose; the shell in it writes `$?` on
the way out; the next `reconcile` finds that exit status and takes the arm whose whole
sentence is *"it exited, closed nothing, delivered nothing and asked nothing — that is the
one ending here nobody chose, and it costs an attempt"*. Somebody chose it: this sweep did,
one tick earlier, and wrote the conversation down so it could come back. The `gone` ending
has had `carryOver` against exactly this since bc-y7l2m, and the two are the same event seen
from either side — a window that stopped answering with a transcript worth resuming — so the
guard now reaches the path that actually fires. Measured on `bc-xl7n.142`, 2026-08-27: one
brief at 18:31, parked at 18:51, reaped and charged at 18:55, resumed at 19:04, parked at
19:26, reaped and charged at 19:29. Two charges against a `maxAttemptsPerBead` of 2, on one
brief and one replay of that brief's silence; `bc-xl7n.144` the same hour, and about a third
of this repo's ready queue was sitting at the cap when it was found.

**It is bounded by the same `maxResumes` the `gone` ending is**, and for the sharper version
of the same reason. A `handback` waits on you and a `delivered` waits on a merge, so neither
can run away — the loop needs a person in it. A window that simply stopped talking waits on
nothing at all, so a park that ignored the trip count would resume the same transcript into
the same silence for ever. The sweep therefore withholds the record from a conversation that
has had its trips, closes the window anyway, and lets `reconcile` charge that ending the way
it always did. Two quiet windows cost one attempt: not none, and not two. The count itself
has to be handed over on the worker record, because the row this sweep holds is the
*open-register* row and has never carried one — miss that line and every idle park is written
down as the first trip, which is `maxResumes` never binding at all.

**The resume happens at the dispatch seam, not at `/api/respond`.** Opening the window from
the answer handler is tempting — the answer is right there — and it is wrong twice. Every
gate that decides whether a window may open lives on the advocate's tick: attempts, claims,
cross-machine leases, the endorsement door, quiet hours, the worker limit, `OBSERVING`. A
launch from the answer handler is a launch past all of them, and the first time two Macs
answered one question there would be two windows on one bead. And the answer does not only
arrive from the phone: it arrives from Slack, from the laptop, from `bd` on the command line,
and from a bead somebody unblocked by hand. The tracker is the one place all of those meet.

So the flow is the flow that already existed, with one lookup added — the answer unblocks the
bead, the bead goes ready, the advocate surveys it, and at the moment it would open a window
it asks *is there a conversation parked on this bead?* What that conversation wakes up to is
deliberately short: who answered, what they said, and that time has passed so `main` may have
moved. Not the brief — it already has the brief, and handing it a second copy is a strong
signal to start over, re-read the files, re-derive the conclusion and ask the same question
again.

A **retired worktree comes back out of the attic** to be resumed in, with `git worktree
move` and never a rename. That is the ordinary life of a parked window — deliver, park, the
branch merges, the worktree retires, and only then do you answer — and the attic exists
precisely so a retired tree stays resumable for two days. Where the tree is genuinely gone,
or no transcript survives, the dispatch opens a **fresh** session and says so in the log: a
fresh session that reads as a resume is the one outcome worth guarding against, because it
looks identical on the console and the agent has no idea it was supposed to know anything.

Parked conversations are drawn on the advocate's card under **Parked — waiting on you**,
above *Up next*, because everything below that line happens on its own and this is the only
section blocked on you. Each row says what it was, what it is waiting for, and how many
times it has already been round the loop. There is deliberately no *resume now* button: the
resume is not something you do to a conversation, it is what happens when the thing it is
waiting on arrives, and a button there would be a second door into a launch.

##### A reboot takes every window at once, and every conversation comes back

Everything above is about one window ending. A reboot is the other shape: **every** window
on the Mac goes at the same instant, and before bc-5to5r every one of them was lost.

The register's first rule is the reason. `parkDecision` drops a row with no live session —
right for a window you closed, and exactly wrong here, because a drop *forgets* the
conversation rather than writing it down, so nothing can resume it afterwards. Measured
across the 2026-09-20 21:53 reboot: the register held one row at shutdown, held none a
minute after boot, and nothing was parked or logged in between.

And that one row is the smaller half. The register holds the windows **this daemon opened**
— `registerOpen` is called from `launch` and from nowhere else — so a window you opened
yourself has never been in it. Six of the seven conversations that reboot killed were yours.

**The shutdown flush is what finds them.** Claude Code writes its transcript when it is
terminated, so every session alive at shutdown lands its last line within the same second.
lib/rebootresume.js takes the newest transcript write at or before the boot and treats
everything within three seconds of it as the cohort. On that reboot it is exact: seven
transcripts at 00:52:06Z against a 00:53:38Z boot, with the next one back eight minutes
earlier, in a window that had already been closed.

| what comes back | how |
|---|---|
| a window **this daemon** opened | **parked**, with `ending: 'reboot'`, and resumed through the dispatch seam like any other park. Never reopened by the sweep itself: the advocate holds the bead, the claim, the attempt budget and the one-window guard, and a window opened around all four is a second window on the same bead |
| a window **you** opened | **reopened**, in its own directory, by `claude --resume <id>` |

**Why this one is allowed to open windows unasked**, where lib/terminal.js refuses to
respawn a phone pty at boot for what sounds like the same reason. What comes up is handed
**no prompt**. A resume restores the transcript and waits at it — nothing runs, nothing is
spent, and nothing acts on an hours-old picture of the repo until you type. What is
resurrected is a window, not an agent.

Three bounds, each for a way it could go wrong rather than for tidiness:

- **once per boot** — the boot's own timestamp is written to `state.json` *before* any
  window opens. The order is the opposite of the park's, and deliberately: there the record
  is the only copy of the conversation, so it must be written first; here the conversation
  is already safe on disk and the hazard is a crash halfway through reopening ten windows,
  followed by a restart that opens the first five again.
- **only just after a boot** — `BOOT_GRACE_MS`, ten minutes. A daemon that starts hours into
  an uptime — a hot swap, a crash-restart, the first deploy of the feature — records the
  boot as handled and opens nothing, so a swap at 3pm cannot reopen what died at breakfast.
- **a cap** — twelve windows, newest first.

Two things it will not do. A conversation whose transcript has **grown since the boot** is
one already resumed, by you or by an earlier run, and is skipped on that evidence before the
live-session list is even consulted — a window opened ten seconds ago has not written its
session record yet. And a **hard** shutdown leaves no flush at all: the transcripts are
scattered, the cohort collapses to whichever session was typing last, and fewer windows come
back than should. That is the direction to fail in — a window you have to reopen by hand
beats a window nobody asked for.

The ordinary tick carries the same rule, because a row can arrive after the startup sweep
has run: `parkDecision` now parks a window whose record predates the boot instead of dropping
it. The boot is injectable into `createAdvocates` for the reason the process table is —
otherwise every fixture in `test/parkidle.mjs` means one thing on a Mac that has been up for
days and the opposite on one that rebooted half an hour ago.

A resumed agent is told which of the three silences it woke from, and the reboot one says so
in as many words: the machine went down, not your window alone, every window on it at the
same moment, nobody answered anything — **and everything you had running is gone**. That last
line is the one fact only a reboot has and the one its own transcript cannot contain: the dev
server, the background job, the test run whose log stops mid-line. Without it an agent goes
and reads that log, or concludes a port is taken.

###### Written down while the Mac is up — the session register

The flush is a fingerprint, and a hard shutdown leaves none. So since bc-5to5r.2 the daemon
writes the answer down *before* the question is asked: every sixty seconds it reads Claude
Code's own session records (`~/.claude/sessions/<pid>.json`, one per live process) and keeps
a row for every window whose process is alive — yours and the daemon's alike, because the
record does not distinguish them and neither does a reboot — in `sessions.json` beside
`state.json` (lib/sessionregister.js). The one rule: **a session that vanishes while the Mac
stays up was closed on purpose** and its row is dropped on the next poll; **one whose last
sighting predates the boot was taken by the machine** and is exactly the set to bring back.
Only `interactive` windows are tracked — a subagent or a headless run has no screen to come
back to.

At boot the pass takes its cohort from **both**: the register says *which* conversations,
and the transcript, where there is one, still says *where* (its last `cwd`, because a session
that entered a worktree has moved) and *whether it is already back* (grown since the boot). A
session the flush saw and the register did not — opened inside the last minute before
shutdown — comes back on the flush's word alone, as before. A session whose directory is gone
is **reported, never resumed somewhere else**: the usual cause is a worktree retired under
it, and a conversation with a perfect memory of files that are not there is worse than one
you reopen by hand.

**The dropped rows are not lost — they are on disk.** A window closed while the Mac was up
exists afterwards only as its transcript under `~/.claude/projects`, with its last `cwd` and
its last `custom-title` line, which are the two facts a resume needs. `lib/unresolved.js`
reads those (through `scanTranscripts`, titles included since bc-wsgj6) under the register,
the reports and the live records, decides *unresolved* on each row — named, not `done-`, no
process, not parked, with a transcript — and is what the terminal monitor's default pane and
`GET /api/sessions` show. `POST /api/sessions/resume` brings one workspace's unresolved
sessions back through `openResumedWindow`, with the boot pass's four refusals, and writes
`resumeReport` in the same row shape as `rebootReport`, so the name restore below applies to
a window brought back on request exactly as to one brought back at boot. See
[the sessions pane](operations.md#the-sessions-pane--unresolved-by-default-one-workspace-on-request-bc-wsgj6).

And it writes down what it did, as `rebootReport` in the state — one row per session it
considered: reopened, parked for its advocate, skipped and why, failed and why.
[`b7e-sessions`](b7e/b7e-sessions.md) prints that beside the live list and the register, and
**after a boot the daemon opens one window on it** — only after a real boot, never after a
hot swap, and only when there was at least one session to decide about (bc-5to5r.3).

**A reopened window gets its name back** (bc-5to5r.8). `claude --resume` continues the
conversation but not the window's name: the resumed process writes a fresh session record
wearing the default Claude Code mints from the directory (`soc2-first-order-e4b-93`), and
the `<project> - <task>` name lives only in the old pid's record, which is gone, and in the
transcript's `custom-title` line, which `/resume` reads and the record does not. After the
first real reboot all nine windows came back that way. The register poll now reads this
boot's `rebootReport`, and for every row the pass **reopened** whose record still wears a
default (`nameSource` is not `user`) it writes the name the pass knew back through
lib/retitle.js — both stores, the same write `/rename` does. A name the session gives
itself on its first turn wins, a window you opened by hand is never touched, and the write
is once-only because it is what sets `nameSource: user`. The restored name goes on the
live row before the register is written, so the register never carries the default either.

**It runs at promotion, not only at an active start.** Under the router every backend starts
as a standby and is promoted through `/internal/activate`, and for two weeks the pass was
gated on the process having started active — which in production none of them does. The log
had never seen a `[reboot]` line (bc-5to5r.1). It now runs on the first promotion of a
process as well; the once-per-boot stamp is what keeps the second backend of the day from
doing it again, and the stamp is compared with a few seconds' slack, because `os.uptime()`
is whole seconds and two processes read the same boot up to a second apart.

Switch the whole thing off — the pass, the register and the window — with
`resumeAfterReboot: false`.

##### The nightly window — stop dispatching, empty the Mac, collect the store

Every write to a beads workspace is a Dolt commit, and until this nothing ever collected
them. Measured on this repo's own workspace on 2026-08-17: **9469 commits and 825MB behind
1326 beads** — and the size is what every `bd` call pays for, because every `bd` is a fresh
process that opens the store from cold.

|  | uncollected (825MB) | after `bd gc` (299MB) |
|---|---|---|
| `bd show <id>` | 1560–2710ms | **158–169ms** |
| `bd list --all --limit 0` | 1862–2236ms | **326ms** |
| six of them at once | 11972ms | **864ms** |

`bd version`, which opens nothing, is 130ms — so a collected store puts `bd` within 40ms of
the floor and an uncollected one at ten times it. The daemon spends **381 seconds of `bd` in
nine minutes** on an ordinary afternoon (`npm run timings`), and that is what a phone read
queues behind. One command fixes it; the whole of this section is about when to run it.

**The collection does not need the Mac empty, and it is worth being straight about that.**
`bd gc` was measured with six concurrent readers against the same store: all six answered
correctly, and it finished in 2.9 seconds. bd takes its own gate lock, so a collection
serialises against other `bd` processes rather than racing them. Nothing here is protecting
the database from the sessions. What the window is for is narrower:

- **A store collected under load is re-bloated by morning.** The commits come from writes and
  the writes come from sessions, so collecting once the writers have stopped is what makes
  the small store last the night rather than an hour.
- **Three seconds idle is not three seconds under twenty sessions**, where it is behind
  however much of that 381s/9min is already queued — and every session's next `bd` waits
  behind it in turn.
- **The end of the night is the cheapest moment to stand a fleet down** anyway.

So the sequence is: at `maintenanceAt` **dispatching ceases everywhere** — one window for the
daemon, not one per advocate, because "empty the Mac" is not something one advocate can be
responsible for. Every open window is asked to wrap up, once, through the same `reclaim` the
card's button uses. `maintenanceDrainMinutes` later anything still running is **stood down**
— `finish(…, 'stood-down')`, so the conversation is parked *before* anything is closed, and
then `SIGTERM`/`SIGKILL` through the ordinary reaper. Once the last window has gone, every
workspace's store is **collected**, and dispatching resumes the moment that returns — not at
the end of the window. On a quiet night the whole thing costs the fleet about three seconds.

**Four things it will not bend**, and they are the reason to trust it running unattended:

1. **The decay phase is never run.** `bd gc` has three phases and the first one *deletes
   closed beads older than ninety days*. This repo's own `CLAUDE.md` makes the Dolt commit
   log the recovery path for beads that go missing, so a nightly job that quietly deletes
   either is not maintenance. The collection is `--skip-decay`, hard-coded, with no config key
   to turn it on. `bd flatten` — which the gc output helpfully suggests, and which would
   squash all 9469 commits into one — is out for the same reason and more strongly: it is the
   recovery net itself.
2. **The window always ends.** A session that will not take a signal must not leave a fleet
   that never dispatches again. `maintenanceMaxMinutes` is the outer bound on the whole
   sequence, and past it dispatching resumes whatever state the night reached — loudly.
3. **The collection gets reserved time inside that bound.** Five minutes before the ceiling
   the sequence stops waiting for anything and collects, over the top of whatever is still
   running. Derived rather than configured, because it is not a preference: it is the
   difference between a stuck window costing tonight's drain and costing tonight's whole
   point.
4. **Identity guards are never waived.** The force skips the *busy* check and the grace
   period — a window still working after a 45-minute notice had its notice. It does not skip
   the check that the pid is still the session we launched, because a signal is the one act
   here with no undo and pids get recycled.
5. **It happens once a night, and that took an incident to get right.** A verdict of `idle`
   over a night that had already collected erased the only memory that it had — the caller
   writes the phase straight back into its own state — so the next tick started the sequence
   again from the top, and again, for the whole window. On 2026-08-21 that opened and tore
   down 55 windows on two beads in six hours, every one archived with 0 commits, because
   dispatch is live in the gap between each collection and the next re-entry into `closing`.
   A finished night now stays `done` until the clock reaches the next one. Standing a window
   down also **costs its bead an attempt** now, for the same incident: a window torn out
   mid-turn reached none of its own endings, and 27 of bc-7qo.11's 28 launches logged
   `attempt 1`, so `maxAttemptsPerBead` could not bite on the one loop that needed it. The
   charge is visible on the console and `Forget attempts` re-arms it. See [three windows on
   one bead](#three-windows-on-one-bead-and-the-daemon-reporting-two).

**Every configured workspace is collected, not just the advocated ones** — the inbox sweeps
all of them on every poll, so all of their stores are on the path of a phone read, and
collecting only the subset with advocates would leave most of this Mac exactly as slow as
before. **Except a workspace with a Dolt remote**, which is skipped and *said to be skipped*:
`bd gc`'s compact phase cannot be turned off, and a nightly job that might one day start
rewriting a shared tracker's history is not a thing to leave running unattended. On this Mac
that is one workspace — `architecture`, the tracker every Northwind service checkout resolves
to — and `maintenanceCollectShared` is how somebody says they have decided otherwise.

It is **off by default** (`advocates.maintenance`), and that is deliberate: every other sweep
in this part of the program reads something, and this one closes windows somebody may be
typing into. One line in `config.json` turns it on:

```json
"advocates": { "maintenance": true, "maintenanceAt": "03:00" }
```

While it runs, every advocate's card says which phase it is in — `draining`, `closing`,
`collecting` — beside the queue it is not picking up, because a board that has gone still
without saying why is the thing this whole console exists to avoid.

#### Reclaiming a slot, by asking

The inference above is what the daemon can work out on its own. **Reclaim sessions** is
what it can find out by asking, and it exists because the button before it — *Free
slots* — could only assume: it emptied the slot list on the strength of you having
pressed it, so a session three hours into a bead lost its slot to the next launch, and
one whose window you had closed looked exactly the same.

There is no socket to an advocate's session; it is an iTerm window, and the daemon owns
neither the window nor the shell in it. What it does own is the window's **iTerm session
id**, captured from `scripts/open-session.applescript` at launch. That is the channel:
`scripts/message-session.applescript` writes into that session exactly as if it had been
typed, and Claude Code takes input mid-turn and answers it when the turn lands. The
check-in itself is still one line, but by its own choice now rather than the channel's —
one instruction and one command to run is not something to spread over six lines in a
window somebody is working in. Three outcomes per open session, each a fact rather than a guess:

| addressing the window… | reading |
|---|---|
| no session carries that id | **gone** — the slot frees immediately, proven rather than assumed |
| the line lands | **asked** — the slot is **held**, and the session has `checkinMinutes` (default 10) to answer |
| macOS refuses the Apple event | **unreachable** — the slot is held; a refusal is evidence about iTerm, not about the session |

An asked session has two honest answers, and both already existed. It can check in —
`beadcause-checkin -w <repo> -i <bead> -m "what you are doing"`, which writes
`~/.config/beadcause/workers/<repo>-<bead>.checkin` beside the done file, for the same
reason: the reply comes minutes later, from a process the daemon does not own, possibly
across a restart. Or it can finish, doing the `** BEAD WORK DONE **` steps its brief
already specifies and exiting, which the done file above catches unchanged.

Say nothing for `checkinMinutes` and the slot goes back — and the bead is charged **no
attempt**, because silence is evidence about the window, not about the work. A bead that
lost two attempts to unanswered questions would be given up on for something no session
did wrong. A check-in older than the question never answers it, so a session that
answered once and hung since does not keep its slot forever.

A worker launched before any of this has no window id recorded; the card says *no window
handle*, and reclaiming frees its slot without asking, which is all the old button ever
did.

Those four endings are what the *daemon* can tell apart. What **you** read is the last
line the session printed, and the brief asks for it in fixed words so it can be
searched for across a wall of windows:

    ** BEAD WORK DONE ** CAN BE DEPLOYED, REBUILT **

`** BEAD WORK DONE **` never varies. What follows names every step the work has not been
through yet, and `CAN BE CLOSED` on its own is the one line that means nothing is
outstanding at all. Which words are even *available* depends on the ending the session
was given, because the whole value of the line is that it is honest:

| the session | may owe | because |
|---|---|---|
| landed its own work | `DEPLOYED`, `REBUILT` — or `REVIEWED` if the merge was refused | the delivery merged and pushed it, so claiming either would describe work already on `origin` |
| handed the PR over (auto-merge off for its space) | `REVIEWED`, and nothing else | it never merges, pushes or deploys; it can owe nothing but your answer |
| has no remote to push to | `MERGED`, `PUSHED`, `DEPLOYED`, `REBUILT` | all four are still yours, and the session names them without doing them |

Whatever it writes, it passes the same thing to the delivery as `--owed`, which puts it on
the bead and in the notification — the marker is for a human reading a wall of windows,
and `--owed` is for the one who is not in front of it.

That line used to be `CAN BE CLOSED` unconditionally, which said the *window* had
nothing left to do and said nothing about the work — and it is the sweep below that
makes the difference expensive. An unmerged branch is never retired, so a session that
stopped at a worktree commit left it sitting there indefinitely while reading as
finished in every list. Nothing parses the marker; it is prose for a human. `lib/session.js`
is the only file that writes it and `test/land.mjs` the only one that asserts it — which is
worth having, because "the marker claimed a step the session did not take" is a regression
no screen in the app would show you.

### Clearing up after it

A session that obeys its repo's rules makes a git worktree before its first edit.
Two beads a day is seven hundred worktrees a year, so the daemon sweeps them: on the
tick after a session ends, and every `tidyIntervalMinutes` otherwise.

A worktree is retired only when **all five** hold — and if any one fails it is left
alone and *named*, with the reason, in the log and on the card:

| condition | why |
|---|---|
| under `.claude/worktrees/` | never the main checkout, never `worktrees-retired/`, never anything outside |
| not locked | a lock is a session's claim on it, and `EnterWorktree` takes one |
| no live `claude` in it | nothing is moved out from under someone working |
| `git status --porcelain` empty | untracked files count; uncommitted work is never swept |
| its branch is an ancestor of `main`, **or** GitHub says its PR merged | everything it did is already in main |

That last condition grew a second half when nothing started merging locally: a
squash-merged pull request puts a new commit on main carrying the branch's tree and
none of its history, so the ancestor test is false forever and every delivered
worktree would sit there unswept. GitHub is asked only when the local test has already
said no, and only for a branch that has a PR — so a repo with no `gh` behaves exactly
as it did.

The default has since moved to a merge commit (`pr.mergeMethod`), which makes the local
half true again and turns this second half into the belt beside those braces: it is
what covers a workspace that asks for `squash` on purpose. The reason the default
moved is that this sweep is not the only thing gating on ancestry — the `ship` skill
does too, and its own step 7 is still outside this repo. Its *attic* sweep is not:
since bc-uytt that is `bin/attic.js` here, so it asks GitHub the same way this does.

**Retired means moved, not deleted**: `git worktree move` into
`.claude/worktrees-retired/`, the same soft delete the `ship` skill does by hand, so
it is resumable. The branch is kept deliberately — `git branch -d` refuses a branch
checked out in another worktree, and the branch is what makes the retirement
reversible.

**What holds those gates is `test/retire.mjs`,** and for a long time nothing did. The
attic below had two suites while this half — the one that acts on a directory somebody
may still be *sitting in* — was named in no test file in the repo, running unattended
every fifteen minutes with `prMerges` on. Each gate is now asserted on its own with its
own reason, in a real repo with a real `origin` and real worktrees, because every claim
here is a question about refs and registrations and a fake git would only prove the fake
works. The one thing faked is `gh`, and it is on `PATH` for the sweeps run *without*
`prMerges` too: with GitHub present and answering MERGED, a worktree left as "not merged"
can only mean the flag gated the call. Then every gate was deleted from `lib/tidy.js` one
at a time to watch the suite go red — seventeen of eighteen, including the four that are
not `if` statements and are therefore the easy ones to lose in a refactor: the
symlink-aware `realPath`, `origin/main` asked before `main`, the `.note` stamp, and `git
worktree move` swapped for a plain rename. The eighteenth survives deletion and no test
can catch it, because there is nothing to catch: the main checkout is never *under*
`.claude/worktrees/`, so the location gate has already refused it, and the line excluding
it by path is a second lock on a door that was not there. It is kept for the same reason
its comment gives — excluded by location is a thing to say out loud — but it is worth
knowing that it is the one line here whose removal changes nothing.

#### Emptying the attic

A soft delete nothing ever hardens is a rename. Retiring ran unattended every fifteen
minutes; the only thing that ever *emptied* `.claude/worktrees-retired/` was a shell
script in the `ship` skill, which runs when a human ships — so on this repo the attic
reached **a hundred entries and 1.2 GB in two days**, and bc-2v7k was filed against it.
The half that fills was automatic and the half that empties was not.

So the same tick now does both. After the sweep retires, `expireRetired` removes what
has outlived its resumability: older than `tidyAtticDays` by the `.note` stamp, plus
every gate the retirement itself had to pass — unlocked, on a branch, nobody's `cwd`
inside it, no *tracked* modifications, contained in main or merged as a pull request,
and not named by a live handoff in `.claude/handoffs/`. Anything failing one is kept
and named, exactly as above. Removal is `git worktree remove`, never `rm -rf`, and the
branch survives the directory. Unregistered directories are ignored rather than
removed: one means somebody moved things by hand, which is a thing to look at.

**The removal takes `--force`, and that is not a loosened gate.** `git worktree remove`
refuses a worktree carrying *untracked* files, and a retired worktree is allowed to carry
them — that is what the soft delete is for. Without the flag such an entry passes all
seven gates and then loses to git on the last line, permanently: two of the 105 entries
in the attic that filed this were in exactly that state, and no amount of waiting would
have moved them. (Ignored files are fine unforced — git objects only to untracked ones,
which is worth knowing before assuming a `node_modules` symlink is the problem.)
`test/attic.mjs` caught this on its first run. A single `--force` covers the unclean case
and nothing else — a *locked* worktree needs two, and the lock gate means this never
reaches one; tracked edits and unmerged commits were both refused several gates earlier,
on their own evidence.

**A deletion is not an edit, and reading it as one wedges an entry for ever.** The
tracked-modifications gate counted `git status --porcelain` lines, and a directory whose
*contents* had been removed — by a hand `rm`, a tool clearing space, anything outside this
sweep — reports one line per file. Five entries on this repo sat in the attic 28–29 days
being told they had "465 uncommitted tracked files" when nothing had been edited at all,
and waiting could never clear it: a removed file does not come back, so the count only
grows. A deletion carries nothing to lose, so the gate now looks only at lines that are
*not* deletions. Whether the work survives is still asked separately, on its own evidence:
the branch has to be in main. An entry that has been **edited** is kept exactly as before,
because an edit is somebody's unsaved work (bc-iaju1.8).

**Occupancy is compared through symlinks.** git reports worktree paths fully resolved
and a session's `cwd` keeps whatever prefix it started with — on macOS `/var/folders/…`
and `/private/var/folders/…` are one directory sharing none of their first eight
characters. Compared with `path.resolve` alone, the check that stops a worktree being
taken out from under somebody answers "nobody is in it" every time.

An entry with no `.note` is kept forever and says so. Directory mtime is the only other
signal and it is the wrong one — a background process touching a file is not somebody
resuming a session, and it is the difference between keeping a directory and deleting
it. `bin/attic.js --backfill` is where a stamp gets invented, under a human, with
`--dry-run` available to see what it would say first.

**Ancestry is asked of `origin/main`, not `main`.** Nothing merges locally any more, so
the local `main` branch stays wherever the last `git pull` left it while GitHub moves
the real one — on this checkout the gap was *fifty commits*, and eight retired worktrees
were being described as "not merged into main" over work that had shipped two days
earlier. Both sweeps ask `origin/main` first and fall back to `main` for a repo with no
remote, which is also what stops a stale local ref from quietly holding the attic shut.

#### Bounded by age is not bounded by size

Expiry bounds how *full* the attic gets. It does nothing about how heavy it is, and on
this repo those were different numbers: of the 1.2 GB, **650 MB was four entries out of
122**. `merge-sessions-advocates-4d2`, `tab-bar-4nq`, `proposal-record-91k` and
`in-app-terminal-49g` were 160–167 MB each, against ~6 MB for a normal entry, and the
whole difference was `node_modules` — a real installed tree where the other 37 entries
carrying anything had a symlink to the main checkout's. None of them was old enough to
expire, and a repeat would put 650 MB back however fast the sweep runs. bc-mf9s.

**Where they come from.** Each of the four had `node_modules/.package-lock.json` inside
it, which is `npm install`'s own fingerprint: somebody ran a real install in the worktree
instead of `ln -s ../../../node_modules node_modules`. The likeliest reason was in this
repo. `scripts/vendor.js` is the first thing run in a fresh worktree — nothing else can
run until `public/vendor/` exists — it finds nothing to copy, and it used to answer
*"missing marked/lib/marked.umd.js — run npm install"*, seven times, which is correct
advice in the main checkout and 160 MB in a worktree. It now says the other thing: a
worktree with no tree is told to link, and a worktree that already has its own is told so
with the command to replace it, printed last so it survives a `postinstall`.

**And `slimAttic` drops the ones that still happen.** Third on the same tick, after
retiring and expiring, it removes a retired worktree's *build output*: a real
`node_modules`, and `android/app/build`, `android/build`, `android/.gradle` with it —
83 MB more across the handful of entries that had built an APK, and the only reason any
of them was still over ~10 MB once the dependency trees had gone. It is deliberately not
the same kind of act as removing an entry, so it does not wait for the two-day line and
does not ask GitHub anything: nothing it removes is work, `npm install` puts the tree
back byte for byte from a committed lock file, `npm run android` rebuilds the rest, and
git cannot see any of it either way. The gates are only the ones about interrupting
somebody — a lock, a session's `cwd` inside it, or a directory touched in the last ten
minutes — and a **symlinked** `node_modules` is left exactly alone, since following it
would empty the main checkout's tree through the link.

`public/vendor/` is the line the list stops at, and the rule is what makes it a line:
heavy *and* rebuilt by a command the resumer was going to run anyway. Vendor is 4 MB, no
browser check in this repo starts without it, and rebuilding it needs the dependency tree
that has just gone — so it is never dropped.

**Which left it as what the attic was made of, so it is borrowed rather than copied.**
With the dependency trees and the gradle output gone, 4.2 MB of every ~6 MB entry was
`public/vendor`: the same seven files 123 times, about 500 MB of 636. Deleting them was
the one move ruled out above, so `scripts/vendor.js` goes the other way and does in a
worktree what `node_modules` has always done — **symlinks the seven at the main
checkout's copy** instead of copying them (bc-oqu7). A normal attic entry is now about
2 MB, the entry stays resumable in one command because the link resolves without
anything being rebuilt, and a fresh worktree gets a working `public/vendor` *before* it
has a dependency tree at all, which it previously could not.

Two things make that safe rather than clever. The link is **relative**, and a retired
worktree sits at `.claude/worktrees-retired/<name>` — the same depth as the live one —
so retirement moves it without breaking it. And the links go on the seven **files**,
never on the directory: `.gitignore` says `public/vendor/` with a trailing slash, which
matches a directory and not a symlink to one, so a symlinked `public/vendor` would read
as `?? public/vendor` and `bin/deliver.js` would refuse the delivery after the suite had
already passed. `node_modules` escapes that only because its own rule has no slash.

The `.note` gains a second line saying what went and how to get it back; line one, the
stamp the whole expiry rests on, is never rewritten. `bin/attic.js` reports what it
dropped and what it freed, and `test/nodemodules.mjs` holds every half of this, the
borrowed vendor below included.

#### The sweep a human runs — and why it moved in here

The daemon empties the attic on its own tick. The `ship` skill sweeps it too, and until
bc-uytt that was a **second implementation of the same gates**: 210 lines of bash in
`~/.claude-personal/skills/ship/prune-retired.sh`, versioned by nothing, tested by
nothing, run by every ship, drifting from the code above that fills the directory it
reads. Both of its bugs came from that, and neither was findable from its output.

**bc-bcdp is the first.** It tested each retired directory for a registration by piping
`git worktree list` into `grep -q` under `set -o pipefail`: grep exits at its first
match, git takes SIGPIPE while it is still walking the rest, the pipeline reports 141,
and a directory that *is* registered reads as one that is not. It called most of a
healthy 85-entry attic unregistered, a different subset each run, which is what a race
looks like from the outside. A session read that, believed it, and filed a bug describing
a hand-`mv` that never happened and a name collision that did not exist. The attic was
fine, and every directory in it had been put there by `git worktree move` exactly as this
page describes. `test/pipefail.mjs` keeps the construct out of this repo's own scripts,
where it sat in four places.

**The second was found by the port, which is the argument for it.** `grep -rlq -- "$n"
"$dir" --exclude-dir=archive` writes the flag *after* the `--`, which ends option parsing
— so grep took `--exclude-dir=archive` for a filename, warned to a stderr that
`2>/dev/null` swallowed, and searched `archive/` anyway. Every *spent* handoff went on
protecting its attic entry forever. This was filed as a ugrep quirk about flag *order*
and is not one: options after the paths are honoured by ugrep and by BSD grep alike, and
`--` breaks this on GNU grep too. See [the two greps](development.md#two-greps-that-answer-the-wrong-question--testgrepargsmjs)
for the distinction and for the second hazard, which is ugrep's and is not checkable.

So `bin/attic.js` is what the skill calls now, and `lib/attic.js` is a **layer, not a
second sweep**: it calls `expireRetired` above for every gate and every removal, and adds
only what a fifteen-minute tick has no reason to produce — the `STRAY` rows (an
unregistered directory, or a `.note` whose directory is gone: reported by name, never
deleted), the report a person reads, and `--backfill`. `test/atticcli.mjs` holds it,
starting with the claim the bash version could not make: a healthy attic reports **zero**
strays, and the same zero five runs running.

It is still repo-agnostic — it takes any repo's main checkout, and sorrel, which has no
daemon, still depends on it as the only thing that empties its attic.

**And the old name is in here too, which is the rest of the same fix.** Moving the gates
into `lib/` left `prune-retired.sh` behind at the old path as a forwarder, so that
anything still naming it kept working — and that file, the one a ship actually invokes,
was still outside every repo with no history, no review and no test. A shim is small
right up until somebody edits it, and nothing would have shown that they had: it is the
arrangement that produced both bugs above, in miniature. So it is `scripts/prune-retired.sh`
now, and `~/.claude/skills/ship/prune-retired.sh` is a **symlink** to it rather than a
copy — a copy is what drifted, and one `cp` is all it would take to have that back.
`test/pruneshim.mjs` asserts the symlink is a symlink, so a hand-copy put in its place
fails a suite instead of being discovered six weeks later.

It finds the checkout it is part of by resolving itself through the symlink, which is
also what makes the "your checkout is behind" failure rare: reached through the installed
link, the `bin/attic.js` it execs is the one sitting beside the shim that named it, so
the two cannot be different versions of each other. `BEADCAUSE_DIR` still overrides, and
a copy stranded outside every checkout still falls back to `~/projects/beadcause`
and says which directory it looked in when there is nothing there.

Two limits worth knowing. A session's `cwd` is recorded when it starts, so a session
that later entered a worktree does not show as being *in* it — the lock is what
actually protects it, which is why `EnterWorktree` taking one matters. And the sweep
runs whether or not the advocate is paused: pausing means "open no more sessions",
not "leave the mess". `tidyWorktrees: false` is the setting that means that.

#### A lock whose window is dead is not a claim

Gate 2 of the five above — *it is not locked* — is right almost all of the time and has
one hole in it, which is that `git worktree lock` has no owner and no expiry. A window
killed mid-session leaves its lock behind, nothing ever takes it off, and the worktree
is pinned for ever: every other gate can pass and never gets asked. On the checkout that
filed this, five of the empty never-committed-to worktrees were in exactly that state,
the oldest 41 days old.

So a lock is honoured while its holder is alive, and only then. Everything here writes
its pid into the reason — `claude session <name> (pid N start <date>)` from a launch or
from `EnterWorktree`, `resolver pid N #<pr>` from a resolver — and liveness is
`process.kill(pid, 0)`, which is the kernel's own answer rather than a `ps` spawn. Pid
reuse can make a dead holder read as alive, which leaves the worktree for another
fifteen minutes; that is the direction to be wrong in.

**A lock with no pid in it is honoured, always.** `live session: b7e-keep (bc-2pysw)`
and `sorrel session editing … by path` are real locks on this laptop, written by a hand
or by another tool, and "I cannot tell who holds this" must never read as "nobody holds
this" — that is the one failure mode that loses work. The stale lock comes off at the
last moment, immediately before `git worktree move`, so a worktree the dirty-tree or
not-merged gate then declines to move is left locked exactly as it was found. It is
recorded in the `.note`, because once the lock is off `git worktree list` will not say
it again.

### The branches nothing ever deleted

The sweep above keeps the branch every time, on purpose: a retired worktree is resumable
only while its ref is there. Nothing else deleted one either, and on a checkout that had
been running for a few months that came to **687 local branches, 604 of them already
contained in `origin/main`**. Every branch listing, every ref walk, every fanout over
`worktree-*` pays for all of them, and a human looking for the one branch that has not
landed reads six hundred that have.

`pruneBranches` in lib/branchprune.js is the other end of the same job, on a **daily**
clock rather than the sweep's fifteen minutes — a finished worktree is in the way of the
next session immediately, a merged branch is in the way of somebody reading a list, and
the number moves by a handful a day. Four gates, and anything failing one is left alone
and named:

1. **not the base itself**;
2. **contained in `origin/main`** — the remote ref, not the local one. Nothing merges
   locally here, so local `main` sits wherever it was last pulled to; asking it was fifty
   commits wrong on this checkout, the same trap the worktree sweep documents;
3. **`origin/<same name>` still exists**. Not about the commits — those are in `main` by
   gate 2 and cannot be lost — but about the *name*. `tipOf` in lib/notinmain.js resolves
   a bead's branch as `refs/heads/<b>` then `refs/remotes/origin/<b>`, and
   `worktreeBranches` unions the two, so deleting a local branch origin has also
   forgotten takes a name two sweeps can still ask about out of the repo entirely.
   Keeping those cost six branches out of 604 here;
4. **not checked out in any worktree**, the attic's entries included — they are still
   registered worktrees. git refuses these on its own; asking first turns a thrown error
   into a row naming the worktree that holds it.

It runs after the attic expiry in the same tick, and the order is deliberate: expiring an
entry is a `git worktree remove`, which un-checks-out a branch, so a branch freed this
second is prunable this second rather than tomorrow.

`git branch -d` is the safe one and it is the wrong tool for this — it checks containment
against the current HEAD or the branch's upstream, which is that same lagging local
`main`, so it refuses nearly everything gate 2 has already proved. `-D` skips that check,
and gate 2 *is* that check asked of the ref that is actually authoritative.

One property worth stating, because a few dozen suites build fixture repos with no remote
at all: **in a repo with no origin this deletes nothing**, since every branch fails gate 3
vacuously. `advocates.pruneBranches: false` turns it off; `advocates.pruneBranchesMax`
(default 200) bounds a single run, because the first one on a checkout nobody has ever
pruned has hundreds of candidates and no hurry about any of them.

### The Chromes and scratch directories nothing was clearing up

A worktree is not the only thing a run leaves behind. Every browser check makes a
throwaway `--user-data-dir` under `$TMPDIR` and hands it to a headless Chrome; every
test suite makes a scratch directory beside it. All of them are removed in a `finally`
— and **a `finally` covers exactly one of the three ways a process ends**. It runs on a
return and on a throw. It does not run when the process is *signalled*, and being
signalled is the ordinary case here, not the exotic one: `scripts/checks.mjs` sends
`SIGTERM` to any check that overruns its timeout, and Ctrl-C sends `SIGINT`. When that
happens Chrome is reparented to launchd and runs forever, because nothing about a
headless Chrome makes it notice that whoever asked for it has gone.

What that costs, measured on this Mac (bc-5isv): **15 orphaned processes and 9,324
`beadcause-*` directories totalling 15.38 GB** — essentially the whole of `$TMPDIR`. Two
days later, after 1,907 of them had already been swept by hand: **13,458 directories,
7,922 of them over a day old, and 18 headless Chromes, four still running from four days
before.** Nothing bounded it but macOS's own periodic purge. One of the orphans was a
fixture `bin/beadcause.js` still listening on a loopback port out of a worktree that had
since been retired into the attic — a running process does not lock a worktree, so the
sweep above had removed the code it was executing out from under it.

**Not leaking is the first half, and it is three lines in three files.** `onExit` in
`lib/teardown.js` is the arm a `finally` cannot reach: the same teardown, run on `SIGINT`,
`SIGTERM`, `SIGHUP` and an uncaught throw, exactly once either way. `launchChrome` in
`scripts/helpers/chrome.mjs` registers one, so **every** browser check takes its Chrome
and its profile with it however it dies; `lib/browse.js` does the same for the browse an
agent asked for, which used to leak on every daemon restart; and the two checks that
start a real daemon take that with them too.

Two details in there had to be learnt rather than reasoned out. **Listening for a signal
disables Node's default action for it**, so each handler re-raises after running — a
handler that forgot would leave a process calmly ignoring the `SIGTERM` it was just sent,
which is worse than the leak. And **`kill()` is not a wait**: it returns once the signal
is queued, Chrome's renderer and GPU children go on writing for a moment after their
parent is signalled, and a delete in that moment races them. Written as signal-then-delete
the guard left the profile behind *every* time. There is nothing to `await` from an exit
handler — the event loop has already stopped — so `killAndRemoveSync` keeps removing and
re-checking until the directory is gone and stays gone.

**The re-raise had a third detail, and it took the daemon's shutdown with it (bc-fh0sz).**
The first version removed the listener with `process.removeAllListeners(sig)`, which is a
far larger claim than it looks: it throws away every *other* handler the process
registered for that signal, and the re-raise then meets Node's default disposition, which
is death on the spot. For a check that is exactly right, because there is nobody else. The
daemon is not a check. `bin/beadcause.js`, `bin/router.js` and `bin/monitor.js` each
register a `shutdown` at load, and the router's ends with `setTimeout(() =>
process.exit(0), 300)` on purpose — 300 ms of grace so its `SIGTERM` lands on the backends
before its own exit orphans them. `onExit`'s own handlers wire *lazily*, on the first call,
which in the daemon is the first browse; so they were registered second, ran second, and
killed the process out from under a shutdown that had already started. Measured with a
probe in that shape: shutdown started, profile removed, exit 143, the grace line never
printed. The daemon is signalled on every restart, deploy and `launchctl kickstart`, so
this was not a rare corner — and it is wider than "a browse in flight", because `wire()`
latches: the listeners are attached on the first browse and stay for the life of the
process, so every restart after the first browse of the day lost the grace, whether or not
anything was browsing at the time. The fix is one line either side: the handler removes **only
itself**, and re-raises **only if `process.listenerCount(sig) === 0`** — somebody else
still listening is somebody else's exit to take. A check registers no handler of its own,
so the count is zero, the re-raise happens, and nothing about the case this was written
for changes. What is given up is the process whose other handler ignores the signal
outright: that one now goes on running, which is a bug in that handler, and `SIGKILL` and
`lib/strays.js` are behind it either way. `test/teardown.mjs` pins it in both registration
orders, because which of the two was registered first decides which runs first and neither
may lose.

**The scratch directories are fixed one level up instead**, because 242 files under `test/`
and `scripts/` call `mkdtempSync` and fixing each one is a chance per site to get one wrong. `scripts/test.mjs` and
`scripts/checks.mjs` now give each child a `TMPDIR` of its own and remove it from the
parent when the child exits. `os.tmpdir()` reads the variable on every call and the
environment is inherited, so everything a suite makes — and everything made by anything
it spawns — lands somewhere the runner owns. A suite that never cleaned up is now
indistinguishable from one that did, and nothing in any suite had to change. A run that
*fails* keeps its scratch and the runner says where it is, which is strictly more than
survived before: it used to go into a `$TMPDIR` twenty sessions share, under a name
nothing recorded.

**`lib/strays.js` is the other half** — what earlier runs already stranded, and what
`SIGKILL`, the one signal nothing can catch, will still strand tomorrow. It runs on the
daemon's slow clock, on its own hourly cadence, and it is the only sweep in beadcause
that signals a process it did not start. Everything about it is therefore a refusal:

| it will not | because |
|---|---|
| touch anything younger than `strayHours` | a check another session started thirty seconds ago looks exactly like one abandoned thirty seconds ago, and only waiting tells them apart. Three were watched finishing normally between two measurements of the pile. No real run lasts a day; every orphan does |
| match on "an orphaned Chrome" | your own browser is `PPID 1` and is a Chrome. A match needs `--headless=new`, a `--user-data-dir` under a top-level `beadcause-` directory in `$TMPDIR`, **and** an executable whose own name contains "chrom" |
| match itself | a `ps \| grep -- --headless=new` finds its own `grep`, every time, because the pattern is on that process's command line. The executable test is what refuses it |
| remove a directory a live Chrome is on | whatever its age. The profiles of *every* matching Chrome are collected, the young ones included, and held out of the removal pass |
| reap at all inside a test | twenty-odd suites boot a real daemon, which runs the real cycle. `lib/launchguard.js`'s predicate gates it, and `BEADCAUSE_ALLOW_LAUNCH` does **not** open it: that variable means a stub is in front of the window opener, and there is no stub in front of `process.kill` |
| signal a process it has not just re-read | the pid is checked against a fresh `ps` between the `SIGTERM` and the `SIGKILL`. Two seconds is not long enough for macOS to recycle a pid in practice, and "in practice" is not the standard for the one act with no undo |

It kills the browser before its `--type=` children, because a Chrome that shuts down
properly takes them with it, and it kills before it removes, so no directory is ever
taken from under a live browser. Directory removals are bounded per pass and the
remainder is **reported** rather than dropped — a sweep that stops at a cap and says
"removed 2000" reads as a sweep that found 2000. It reports counts and not bytes: a `du`
over eight thousand trees costs more than removing them.

A settled machine says nothing at all, which after the first pass is every pass.
`test/strays.mjs` holds the refusals and `test/teardown.mjs` holds the claim that
matters — a real `launchChrome` in a child that is killed mid-check, and afterwards no
Chrome on that profile and no profile.

The command that lists them, and reaps the ones nobody owns, is `b7e-chrome` —
[say which headless Chromes this repo's checks left behind](b7e/b7e-chrome.md#say-which-headless-chromes-this-repos-checks-left-behind--b7e-chrome).
Its section lives in `docs/b7e/` with every other `b7e-*` tool's (bc-fmk4v), so documenting a
tool never appends to a shared chapter.

### The merge that happened somewhere else

beadcause closes a bead on the paths where **it** performs the merge: the merge queue —
which since bc-xl7n.135 is also where the tap on a delivery card ends up, rather than
merging where it stands — and a worker merging its own pull request. The merge button on
github.com is neither. A pull request merged there is merged as far as `main` is concerned and
invisible as far as the tracker is concerned, so the bead stays open, stays in
`bd ready`, and the advocate opens a fresh session on work that is already in `main`.

bc-4irq cost two sessions that way. #29 was merged at 19:43:54 by the GitHub web
identity; the log carries no `[pr] … merged #29` line, because nothing here did it. Two
hours later the advocate released the slot ("still open after 2h") and opened attempt 2,
which spent its whole life proving there was nothing to do.

So the advocate asks. Every `landedIntervalMinutes`, and **again, unconditionally, in the
moment before it opens a window** — being ten minutes late on a timer is one session
spent discovering that landed work has landed, and one `gh pr list` against twenty
seconds of iTerm is not a cost worth economising on. Whichever beads a merged pull
request was for (`lib/beadref.js`, the same tiering the [PR board](pull-requests.md#pull-requests--review-merged-pushed-deployed-live) uses to link a row to a bead) are commented on and
closed, and the stale "Merge #42?" card in front of them is closed first — bd refuses to
close a bead with an open blocker, and that card is the blocker.

**The card closes on the merge, not on the bead.** It used to close only while a bead
behind that pull request was still open and unswept, which left it on the phone forever
in three ordinary states: a work bead somebody closed by hand, a bead reopened
deliberately (left alone by the rule below), and a pull request tied to no bead at all —
hand-opened, or one the tracker would not resolve that tick. Nothing else sweeps a
delivery card. The card asks one question, *merge #42?*, and `state: MERGED` answers it
whatever became of the work afterwards.

Two things it will not do. **A bead that already says it landed is left alone**: `bd`
clears `closed_at` on reopen, so an open bead carrying `Landed as [#42](…)` is the trace
of *you* reopening something this closed, and closing it again would be a fight rather
than a sweep. And **a close bd would refuse writes nothing at all** — the comment is what
that guard reads, so a comment left over a close that failed would blind this to that
bead permanently. `reconcileLanded: false` switches the whole thing off.

**And a sweep that closed something brings this Mac's `main` up.** A worker's delivery
fast-forwards the main checkout after its own merge, and the tap on the pull request board
has always done it — which left this one door into `main` not doing it, and it is the door
this sweep exists for. So the bead closed, the board drew merged, and local `main` stayed
behind until something else happened to fetch: every worktree cut afterwards branched from
before the merge, which is [the staleness the delivery path already fixed](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue) arriving by the one route it did not cover. It is the same
`landLocally`, including its refusal to touch a checkout with edited work in it — one
line naming the paths, and `main` left exactly where it was. Only when the sweep actually
closed a bead or a card, because that is the moment the answer is known to be worth a
fetch; a workspace of forty checkouts asking every ten minutes for a question that is
nearly always "no" is forty fetches for nothing.

**And it asks for the conflict sweep**, behind the same gate and for a reason one sentence
along: a merge does not only leave this laptop behind, it leaves every branch still open on
that base measured against a base it has never seen. The other three doors into `main` know
the moment they merge; this is the one where the trigger arrives late and still has to fire
exactly once — see [every way a merge lands sets it off](pull-requests.md#every-way-a-merge-lands-sets-it-off).
The blind spot is the same one and the same size: a pull request merged by hand with no bead
behind it is noticed by neither half.

#### The fortnight that was really forty rows

The sweep says it looks back fourteen days, and for its first weeks it did not. It asked
for the **forty most recent merged pull requests** and *then* filtered those to a
fortnight, so the forty decided and the fourteen days were decoration — forty merges is
under a day on this repo, which merged 152 pull requests in the two days to 2026-08-11.

That is worse than a short window, because it does not expire. A bead past the fortieth
row is not stranded for a fortnight, it is stranded **for good**: the next sweep asks the
same question of a window that has moved further forward, so nothing ever looks at it
again. bc-8ug and bc-jin are the worked examples — both merged well inside the fourteen
days, both about a hundred pull requests back by the time anything swept, both left
`in_progress` over shipped work, and bc-jin holding three beads out of `bd ready` behind
it for two days. They were closed by hand.

The cap was not carelessness; it was buying something. `beadsFor` costs a `bd show` per
candidate id on every row it is handed, and each bead it resolves costs a `bd comments`
and another `bd show` behind that. `bd` here is a subprocess and a Dolt read, so a wide
window multiplied subprocesses by how busy the fortnight had been — every ten minutes,
for rows the sweep had already decided about. Three changes bought it back:

- **The window goes into the query.** `pr.listMergedSince` asks GitHub for a span of time
  — `merged:A..B` — and halves the interval whenever a slice comes back full, so the
  fortnight is the fortnight and the limit is only a guard against a runaway answer. It
  bisects rather than walking backwards a page at a time because `gh pr list --search`
  answers in **creation** order, not merge order: a full page is an arbitrary subset with
  respect to `mergedAt`, so moving the bound to its oldest row steps straight over
  everything that merged in between and was not on that page. A slice that answers with
  fewer rows than the limit answered whole, and that is the only fact being relied on.
- **The fields shrink.** A merged pull request is not a merge decision, so the sweep stops
  asking for `statusCheckRollup` — which walks every check run on every row. Measured
  against the same 152 merges: **15.9 seconds with it, 2.2 without**. Asking about a
  fortnight is now four times faster than asking about forty rows used to be.
- **The per-row `bd` work is gated on one query.** `candidateTiers` is pure string work —
  it reads the title, the branch and the body — so every id a pull request could resolve
  to is knowable for free, and one `bd list` says which beads are not closed. A row naming
  no live bead is decided without spawning anything, which on a fortnight of merges is
  very nearly all of them. A quiet fortnight and a frantic one now cost the same sweep.

Two things that deliberately did not change. **Retries.** A bead a transient refusal
skipped stays open, so it stays in the live set, so its pull request is looked at again on
every tick for the full fourteen days — which is why the gate is built from open beads
rather than from a memo of pull requests already decided about. And **the truncation
report**, which arrived with bc-4qmp: a ceiling that cannot be paged past is still a
ceiling, so `result.truncated` still says how far back the sweep actually reached, and the
advocate still logs it when the answer *changes* rather than every ten minutes. It is no
longer reached on a quiet Tuesday.

The same hole had a second side. `beadcause-deliver` on a branch whose pull request has
already merged has nothing to push and nothing to open, and it used to die there with
`exit 2` — so the one command a worker is given to land work with could not close the
bead over work that had landed, and the worker was left choosing between disobeying its
brief and leaving the bead open for attempt 3. It now recognises that state, closes the
bead exactly as its own merge would, and prints `landed #42` — having pushed nothing,
because a card merge deletes the remote branch and pushing would recreate it.

**And it asks GitHub about the branch rather than for the newest forty pull requests**,
which is the same cap one command along. `gh pr view <branch>` resolves a *ref*, so it
misses the moment a merge deletes the branch — and deleting the branch is precisely what a
merge from a card does, which makes the fallback the part that actually runs on the case
that matters. That fallback listed forty merges and matched the head ref here, so a branch
merged from a card yesterday was already off the end of the list and the delivery died
with `no commits that origin/main does not` over work that had landed (bc-kbr6). The match
moved into the query, as `--head`, which GitHub answers from the `headRefName` it keeps on
the pull request for good. There is no window to get wrong now, and no dependence on how
much else merged in between.

### The duplicate that comes ready the moment its original lands

The sweep above closes work that turned out to be done. This one asks about work that
turned out to be somebody else's, and the difference between "closes" and "asks" is the
whole design.

A worker that finds two beads describing the same job has always had the right instinct
and no tools for it. Closing a bead is not a worker's call, so the move available was to
park the duplicate behind the original with `bd dep add` and write *"when the original
lands, close this as superseded rather than working it"* in a comment. Every step of that
is correct, and it holds right up until the original lands — at which point closing the
blocker makes the duplicate `bd ready`, the advocate picks it up, and an unattended
session opens on a bead whose own comments say not to work it.

bc-e1kv, parked behind bc-0nea, which landed as #33. The session that opened did the only
honest thing available — verified the fix really was in `main`, filed a question asking
for the close — and spent its whole window re-deriving a conclusion already written on
the bead. The gap was that "superseded, pending approval to close" lived in prose, where
nothing between the blocker closing and a worker reading that prose could act on it.

So it is a label. A worker runs one command and stops:

```sh
beadcause-supersede -w beadcause -b bc-e1kv --original bc-0nea <<'EOF'
Both are the same fix in lib/router.js — bc-0nea landed it as #33.
EOF
```

That is `bin/supersede.js`, and it writes the label, the graph edge, the reason as a
comment, and the status the sweep needs the bead left in. It used to be two lines a
worker typed by hand, and [three of the ways to get them wrong read as
success](#an-epic-adopting-its-own-child-cannot-block-it-so-the-marker-holds-it-alone).

`superseded-by:<id>` is [endorsement](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time)'s shape with a different ending. Same two layers: the marked bead is out
of `bd ready` and out of every advocate queue, and `openWorkSession` asks the tracker
itself and refuses one handed straight to it. The refusal carries more weight here than
it does for `unendorsed`, and that is worth knowing rather than glossing — the marker
carries the original's id inside it, so there is no fixed string to give bd's
`--exclude-label` and the filter is a row check in one function rather than a flag the
tracker honours.

The ending is what differs. An `unendorsed` bead is waiting to be let *into* the queue;
this one is waiting to be let *out of the tracker*, and nothing but you may decide that.
So when the named original closes, the advocate does not open a session — it puts the
duplicate in the inbox as a card, with two options and both of them real:

- **Close it — bc-0nea covered it.** The tap *is* the close. Answering a `human` bead
  closes it, which is why the card is the duplicate itself rather than a separate
  question about it: nothing to keep in step, nothing to clean up.
- **Keep it — not the same job.** A `closes: false` option, so it commissions rather than
  concludes, and it takes the marker off on the way past. A handover that left the marker
  on would be a button that did not do what it said.

Three writes, in the order that survives a failure halfway: the comment, then the ask
appended to the bead's notes (`--append-notes`, so nothing it already said is
overwritten), then the `human` label — which *is* "it is in the inbox", and goes last so
a card never appears before its options. A retry recognises its own work by a marker in
those notes, so a label write that failed on the Dolt lock costs a sweep rather than a
second comment every ten minutes.

Two things it deliberately will not do. **It never asks about a bead whose original it
could not read**: "the tracker is mid-write" and "that bead is gone" are the same
sentence from here, and a card claiming a bead had vanished would be wrong every time it
was the former — so the duplicate stays held and the reason is logged every sweep. And
**tapping "open a session" on the card does not lift the marker**, unlike the same tap on
an unendorsed bead. The two markers do not mean the same thing: `unendorsed` is "nobody
has looked at this", and looking at it is exactly what that tap does, where
`superseded-by:` is a claim about two beads that opening one of them to read is no
verdict on.

`askSuperseded: false` switches it off; `supersededIntervalMinutes` is how often it
looks, defaulting to 10. The worker's brief carries the command, which is what makes any
of it reachable — nothing but a worker ever sets this marker.

### An epic adopting its own child cannot block it, so the marker holds it alone

The command above was two hand-typed `bd` lines for about a day, and then somebody marked
a bead whose original was an **epic**:

```
$ bd dep add bc-nqrr bc-4m2j
Error: tasks can only block other tasks, not epics
```

bd would not let a task be blocked by an epic. That was [the same one-line rule
`lib/park.js` is built around](landing.md#parking-an-epic-which-bd-refused-outright), seen from the other
side, and it mattered more here than it looks, because adoption by an epic is how this
tracker gathers duplicates in the first place — bc-4m2j named eighteen beads under an
`Adopts:` heading. So the marking took the label and drew no edge at all, and nothing
said so. Three beads were marked that way on 2026-08-12 before anybody noticed.

**bd 1.2.1 deleted that rule, and the conclusion survives it for a different reason.**
Cross-type blocking is allowed since 1.2.1 — so the blocking edge onto an arm's-length
epic would now go in — but the same release added a hierarchy deadlock guard, and the
case this section is about walks into it: adoption by an epic is usually an epic adopting
its **own child**, and `bd dep add <child> <its parent>` is refused because children
already inherit the parent's completion. `edgeFor` therefore still draws the see-also,
now as a choice rather than a wall, and `mark` still says out loud that the bead is held
by its label. Making it take the blocking edge where it can is real work with a case
split in it; it has not been done.

**There is no second-choice edge.** Of the ten types `bd dep add --type` accepts, `blocks`
is the only one that takes a bead out of `bd ready`. `tracks`, `relates-to`, `supersedes`,
`parent-child` and the rest all go in against an epic — they always did — and every one of
them leaves the bead exactly as ready as it was. That half is untouched by 1.2.1: what the
release moved is whether the blocking edge is *offered*, never which edge *holds*. Measured
against the real binary in `test/epicedgereal.mjs` rather than reasoned about.

Which is survivable, because **the edge was never what timed the card**. The sweep reads
the original and asks nothing until it is `closed`, so a marked bead with no blocking edge
is swept over in silence, every pass, until the original really does land. What the
missing edge costs is the *graph record* — and on a tracker whose whole complaint is that
[structure lives in prose](inbox.md#every-bead-id-in-prose-is-an-edge-behind-it),
that is the part worth fixing. So when the original is an epic the edge drawn is
`relates-to`, via `bd dep relate`, and the command says out loud that the bead is held by
its marker rather than by the graph.

Two candidates were rejected on the way, and both for the same reason — a graph that says
something untrue is worse than one that says less. `supersedes` is bd's own type for
exactly this and renders as `DEPENDS ON` on the duplicate and `BLOCKS` on the epic while
blocking nothing whatsoever, which is a lie told in the one place somebody would go to
check. `parent-child` would make the duplicate a child of the epic — and [an epic cannot
close over an open child](answering.md#when-bd-will-not-close-the-bead), so the
epic would end up held by the duplicate, which is the hold pointing backwards.

Two more things the command knows that a worker typing three lines did not:

- **A pair holds exactly one edge**, of any type, in either direction. Any existing edge —
  the `discovered-from` that `beadcause-file --from` leaves behind is the common one —
  makes every other type refuse, `bd update --parent` included. That refusal is treated as
  success: the pair is linked, which was the point, and trading provenance for a different
  link is not a call this may make on its own.
- **A worker reaches this having claimed its own bead**, and `bd ready` returns open rows
  only. A marked bead left `in_progress` is invisible to the sweep forever — held, with
  nobody ever asked — so the status goes back to `open`, after the label and before the
  edge. That order is the one that survives a failure halfway: the label is the guarantee,
  so anything that fails after it leaves a bead held and short of a record rather than
  released and unmarked.

And the write it will never make is `bd label add <dup> human`. It is the tempting fourth
line — the brief's *other* ending says to hand a bead over exactly that way — and it is
the one that permanently prevents the card, because the sweep excludes the inbox by that
label. The sweep adds it when the question is actually due, and nothing else may.

### A blocker in another tracker, which no edge can ever draw

bc-bmry.6 carried *"BLOCKED ON the charter amendment (lm side)"* in its description and
named `lm-265` as the thing that had to land first. `lm-265` is in the loremia tracker;
bc-bmry.6 is in beadcause's. `bd dep add` reads both ids from *one* `BEADS_DIR`, so there
was no edge that could ever be written — the block existed only as a sentence a human
wrote in the description, and `bd ready` had no way to read it. The bead sat in every
queue, the advocate opened an unattended window on it, and the session's whole job was to
read the description, discover it was blocked, and stop.

The shape is [the duplicate marker's](#the-duplicate-that-comes-ready-the-moment-its-original-lands) — bc-xl7n.71 had already solved the identical problem for
*that* verb, by letting `--original` carry a workspace qualifier. This is the dependency
case: a label, `blocked-by:<workspace>/<id>`, written with one command:

```sh
beadcause-block -w beadcause -b bc-bmry.6 --on loremia/lm-265 <<'EOF'
BLOCKED ON the charter amendment landing on the lm side — lm-265.
EOF
```

That is `bin/block.js`. Same two layers as every other hold in this repo: `Bd.ready`
filters a marked bead out of every queue — a row check rather than `--exclude-label`,
because the far id is inside the label and there is no fixed string to give bd's own
filter — and `openWorkSession` refuses one handed straight to it by any other route.

**Deliberately workspace-qualified only — never a bare id.** A block inside one tracker
already has a real mechanism, `bd dep add`, which draws an edge bd itself understands and
every other tool already reads correctly. This marker exists only for the case that
mechanism cannot reach; accepting a bare id here would be a second, weaker way to spell
what `bd dep add` already does properly, and two ways to hold the same bead is one more
than a reader can trust.

The ending is where it diverges from the duplicate marker, and the divergence is the
whole point. Whether two beads are the same job is a judgement, so that sweep *asks*.
Whether the thing a bead was waiting on has closed is a fact, so this sweep just **clears
the marker and says why in a comment** — no card, no `human` label, nothing for anyone to
tap. `clearFarBlocked: false` switches it off; `farBlockedIntervalMinutes` is how often it
looks, defaulting to 10, for the identical reason the duplicate sweep's interval does:
there is no label to narrow the query with, and the event it watches for — a bead in
another tracker closing — happens rarely.

Nothing here writes an edge, ever, unlike the duplicate marker's epic case above: every
target this accepts is cross-workspace by construction, and no tracker spans two Dolt
databases. The bead is held by the marker alone from the moment it is written to the
moment the far bead closes, and the sweep runs *before* the survey — clearing the marker
is exactly what lets `Bd.ready`'s row filter admit the bead again, so a block that closed
since the last sweep can go straight from cleared to queued in the same tick.


### A session nobody briefed, which no window list can see

bc-xl7n.156. The advocate knows a bead is being worked from its claim, its deps, its labels
and the windows it opened itself. A Claude session Adam opens by hand in a worktree is in
none of those. It has no brief on its command line for the brief's `ps` check to find, no
worker record and usually no claim. So the advocate kept opening worker windows onto a bead
he was building. Each window found him, commented and went quiet. The idle sweep then closed
it, the hand-back took its claim off (every window claims as the same `bd` user, so a claim
cannot say whose it is), and the next tick opened another one.

The fix is the marker `worked-by:<pid>`, written by `beadcause-working` (`bin/working.js`),
where the pid is the owning `claude` process:

- **From inside the hand session:** `beadcause-working -w <ws> -b <bead>` walks up to its own
  `claude` process and marks that. A briefed worker window is refused this form, because it
  would be marking itself.
- **From a worker window that found one:** `--pid <its pid>`. The brief tells a worker how to
  find it. The command also releases the worker's claim, and the reconcile then treats the
  quiet window as a **stand-down**: no attempt is charged.
- **`--release`** takes the marker off by hand.

`Bd.ready` filters a marked bead out of every queue with a row check, since the pid in the
label leaves nothing fixed to exclude on. `openWorkSession` refuses one while its pid is a
live `claude` process. Liveness is `ps -p <pid> -o args=`, and a pid that now belongs to
anything other than `claude` counts as gone, so a reused pid holds nothing. The sweep reads
every non-closed marked bead with `bd list --label-pattern 'worked-by:*'`, not `bd ready`,
because a hand session that claimed its bead leaves it `in_progress`. When the process is
gone the sweep removes the marker and says so in a comment, and the bead is ordinary work
again. When `ps` cannot answer, the marker stays. `clearHandSessions: false` switches the
sweep off, and `handSessionIntervalMinutes` (default 2) sets how often it runs.

### The hold nobody ever answered

Every sweep above this one *raises* something: a card, a finding, a marker coming off. None
of them has an ending for the case where the thing raised is never answered, and both holds
in this repo are cheap to raise and expensive to read.

On 2026-09-19 that was measurable. **83 beads held for endorsement, 78 of them untouched
for more than a month**, against an endorsement queue screen that draws sixty rows — so the
oldest third of the pile was not merely unanswered, it was off the bottom of the only
screen that shows it. Seven `superseded-by:` cards had been in the inbox between three and
five weeks. That is not a backlog of decisions waiting to be made; it is a decision
already made, by silence, with nothing written down — and the cost is paid twice, because
the queue is unreadable while the answered-by-silence beads are still in it, and a bead
somebody *would* have said yes to is buried among eighty they would not.

So the silence is written down. Every `lapseIntervalMinutes`, a hold older than its
threshold **lapses**: the bead is closed, with a close reason naming the hold and the age,
and a comment saying plainly that nobody turned it down — the queue simply never reached
it — and exactly which command brings it back. `lapseDays` is the threshold for an
`unendorsed` bead, defaulting to 30, measured from the bead's **last write** rather than
its filing date: a bead adjusted, commented on or argued about last week has been looked
at, and the whole premise is that nothing has looked at it.

This is the only sweep here that closes a bead on its own initiative, so it carries three
guards the rest do not need:

1. **It is reversible, and the bead says so.** A lapse is `bd close`, not a delete: the
   description, the thread and the edges are all still there, and `bd update <id> --status
   open` puts it back exactly where it was. The comment names that command, because whoever
   reads it will be reading it on a phone weeks later.
2. **It is announced.** Every lapse is a line in `~/Library/Logs/beadcause.log`, an event on
   the advocate's stream and a count on its card.
3. **It is capped.** `lapseMaxPerSweep`, default 20 — not a tracker limit, but what makes a
   backlog drain over an hour of announced batches rather than vanish in a single tick
   nobody was watching. Oldest first, so a backlog that keeps growing at the front does not
   leave the forty-day beads for last on every pass.

**What it will not touch.** An `unendorsed` marker is doing a job other than asking a
question on four kinds of bead, and none of them has a silence to read: a `ship` bead (only
a deploy closes one), a `promote` bead (the release agent carries it), a `container`, and
any bead carrying `human` — which has a *different* question already in front of you, with
its own card and its own answer. Only `open` beads lapse; `in_progress` has a window on it
right now, and bd refuses to close a blocked bead anyway. A row whose timestamps cannot be
read is never old enough, because "I cannot tell how old this is" must never resolve to
"old enough to close".

**The duplicates are the arguable half, and they have their own switch.**
[The duplicate sweep](#the-duplicate-that-comes-ready-the-moment-its-original-lands)
argues at length that closing a duplicate is yours and not an agent's, and it is right:
"these two beads are the same job" is a judgement a worker made in passing. Nothing here
weakens that. The lapse fires only on a bead that has **already been asked about** — the
card is in the inbox, the ask block is on the bead, the comment that raised it is on the
thread — and only once that card has sat there for `supersedeLapseDays`, defaulting to 14.
The clock is that comment's date rather than the bead's, because the sweep's own writes
would otherwise reset it. What closes the bead is the silence, not the marker; a bead
carrying the marker with no ask on its thread is skipped and named in the log. Set
`lapseSuperseded: false` to drain the endorsement backlog and leave the duplicates alone.

**Delivery cards are deliberately not in it.** bc-iaju1.4 asked for those too — "close the
delivery bead when its PR merges" — and
[the merge-that-happened-somewhere-else sweep](#the-merge-that-happened-somewhere-else)
already does it, on a `MERGED` state read from GitHub, which is a fact rather than an age.
A second mechanism lapsing them on a clock would close cards whose pull request is still
open and still wanted, which is the one delivery card that must never close by itself.

`lapseBacklog: false` switches the whole thing off. Like the sweeps above it, it runs
whether or not the advocate is paused — pausing means "open no more sessions", and this
opens none; a paused workspace is in fact the one whose queue most needs draining, since
nothing else is reading it — and like them it is off entirely under `BEADCAUSE_OBSERVE`,
where it matters more than anywhere else in the file: a spare-port instance closing eighty
beads in somebody else's tracker is the worst thing an observer could do.

### The bead whose branch is already in main

The third member of that family, and the one whose evidence is weakest — which is exactly
why it is the one that may not close anything.

bc-u5f asked for `worktree-sessions-accordion-log-5f7` to be landed. It had been: the
branch came into `main` inside the `land-six-branches-q8v` batch, which landed six
branches under one bead and closed only its own. No pull request named bc-u5f, so
[the sweep above](#the-merge-that-happened-somewhere-else) could not see it; nothing had
marked it a duplicate, so the [one before that](#the-duplicate-that-comes-ready-the-moment-its-original-lands) could not either. So bc-u5f stayed open, stayed in
`bd ready`, kept bc-h2s blocked behind it, and was handed to an unattended session that
spent its turn proving the work was already there.

So every `inMainIntervalMinutes`, before the survey, the advocate reads its open beads for
a `worktree-*` branch name and asks git whether that branch is already in `origin/main`. On
a hit it does what the superseded sweep does — a line on the thread, an ask with two real
options appended to the notes, the `human` label — and **nothing else**. It cannot close a
bead and does not try: "the branch is in main" is a fact, and "so the bead is finished" is
a judgement, because a bead can name a branch that landed and still want more than what
landed. "Keep it open" is a `closes: false` option, so it hands the bead straight back to
`bd ready` with the finding on it.

**What it may offer is narrower than what it may say, and that is bc-xl7n.52.** The sweep
reads a bead's `notes` like every other field, and nothing checks that a branch named there
belongs to the bead the text was found in — so when an advocate wrote a triage paragraph
naming the branches its two children were sitting in, as evidence they were alive and
should be left alone, the P0 that commissioned that survey acquired two cards offering to
close *itself*. It has seven open descendants. The failure is correlated with the beads it
is worst on: only a P0 gets an advocate, and only an advocate writes long notes surveying
other beads' branches, so the more thorough the note the more close-offers its own root
accrues.

So **`close-it` is offered only where closing could not strand anything** — never on an
epic, never over a live descendant at any depth, and never where the `bd export` shape
could not be read, because "I cannot tell what is under this bead" is not "nothing is".
Everything else is unchanged: the fact still goes on the thread, the card still says the
branch is in `main`, and "keep it open" is still there. What goes is the one tap, and the
card says in a sentence why it went. That is stricter than the tracker's own close gate in
two ways, both on purpose — bd refuses a close over an open **child**, so a bead whose
children are all closed over a live *grandchild* passes it, and bd has no opinion at all
about an epic with nothing under it yet, which is exactly the standing root a survey is
about to fill.

The other half of that fix is on the phone, and without it the first half would have been a
worse card rather than a better one. bd's gate is a refusal rather than an absence: it
arrives as a 409 after the press, and a card that already knows one is coming
[draws no answer button at all](answering.md#when-bd-will-not-close-the-bead). Those are
the same beads — so a card left holding only a `closes: false` option would have been
unanswerable, with `human` sitting on it until somebody closed the children. A card whose
*every* option commissions is now the one shape that gate leaves alone, because
`/api/respond` skips the close gate for a commission, and a typed answer on a card where
any option would have commissioned rides the same path rather than closing on a guess.

The label is also the whole of the saving. `bd ready` excludes `human`, so a flagged bead
is out of the queue built moments later in the same tick and no session is opened on it —
which is the cost this exists to avoid, collected without anybody having answered yet.

**Ancestry alone is not the test, and that is the one part worth reading.** A fresh
worktree branches from `main`, so its tip *is* a main commit, so
`git merge-base --is-ancestor` says yes — and a bead filed by a session mid-task would be
told its work had landed before it had written a line. That is the one way this could do
real harm. So a hit needs a second parent: some **merge** between the branch tip and the
base must hold that tip as a *later* parent, which is the only trace git keeps of "main
took this in". An unstarted branch's tip is a commit on main's own line, so every merge
past it holds it as a *first* parent, and it is refused.

Three things it will not claim. A **squash merge** — the squash commit carries the tree and
none of the history, so ancestry is false forever and this says nothing at all; that case
is GitHub's to answer and the sweep above already reads it. A **fast-forward**, where there
is no merge commit to find and an unstarted branch looks identical. And anything measured
against this laptop's own `main`: the base is `origin/main` where it exists, because a
dozen sessions land through GitHub and pull at their own pace, so local `main` routinely
carries what nobody else has. It asks once per bead per branch, recognising its own work by
a marker in the notes — the `human` label cannot be the guard, because answering "keep it
open" takes that label off. `flagInMain: false` switches it off.

### The bead that is closed over a branch that never reached main

The same question upside down, and the only one in the family where the cost of missing
one is **the work itself** rather than a wasted window.

bc-nib3.5 built `/bead-session`, ran the whole suite green, and closed itself with a close
reason ending "On worktree-bead-session-nib35, not merged". The branch was never pushed
and no pull request was ever opened. From every screen there is, that bead reads as
finished — a closed bead with a detailed close reason is the least suspicious thing in the
tracker — so `bd ready` handed out the child bead that *links to* the page, and an
unattended session was opened against a page that does not exist. bc-5lcc and bc-0nq8 are
two more, each found the same way: weeks later, by somebody going to reuse something that
turned out not to be there. Left alone, the worktree is retired and the only trace is a
local branch nobody is looking at.

So every `notInMainIntervalMinutes` the advocate reads its **closed** beads of the last
fortnight, works out which `worktree-*` branch each one owns, and asks git and GitHub
whether that work landed. It owns the branch whose trailing tag is its own id —
`worktree-squash-proof-5lcc` for bc-5lcc — and deliberately **not** a branch it merely
mentions in its prose, which is what the sweep above matches on. The two are asking
different questions: "is the branch this bead asked for already in?" can be answered by
any branch the bead names, but "was this bead closed over work that never landed?" is a
claim about its own delivery, and bc-5lcc's description names *another* bead's branch.

Four facts have to hold before it says anything. The branch still **exists**; it has
**commits the base does not**; **GitHub has no pull request for it**, merged or open; and
**its newest commit has stopped moving for two hours**. The third is not optional and is
why the sweep refuses to run without `gh`: a squash merge leaves no ancestry at all, so
git alone reports every deliberate squash as lost work for ever, and a sweep that cries
wolf daily is one nobody reads. An open pull request is not a merge either, but somebody
is already looking at it.

The fourth is bc-xl7n.63, and it is about the third one having a *time* on it. On
2026-08-14 this sweep filed a card at 15:40:21Z saying of a branch that "GitHub has no
pull request for it — not merged, not open, not refused". Pull request #315 for that exact
branch was opened at 15:48:35Z, eight minutes later. Nothing was wrong with the reading:
it was taken in the gap every delivery has between pushing its branch and opening its pull
request — `beadcause-deliver` pushes, then calls `gh pr create` — and a sweep on an hourly
tick lands in that gap whenever somebody is delivering, which here is most evenings. So a
branch whose newest commit is younger than two hours is **held rather than carded**: no
fingerprint is written, exactly as for a branch over the twenty-branch cap, so it is looked
at again next sweep and carded then if it really was abandoned. The delay costs nothing —
every bead this is about was closed over work its own session already finished, and a
genuinely abandoned branch has a tip weeks old.

There is no ancestry walk here, which is the one difference from the sweep above worth
knowing. That one has to tell a merged branch apart from an unstarted worktree, and both
are ancestors of `main`. This one never does: a branch with nothing of its own is not
stranded work whichever of the two it is, so one `rev-list --count` answers the whole
question.

**It does not close, reopen, merge or push anything, and it especially does not reopen the
bead** — that would put it straight back in `bd ready`, where a session would be opened on
work you have not been told about yet. The finding is filed as its own bead, and it has to
be: `bd human list` returns open issues, so a card appended to a closed bead is a question
nothing would ever render. That new bead carries the branch, the commits and the id of the
bead it is about, and its two options are **Land it** — a `closes: false` commission, so
one tap hands it to `bd ready` as ordinary work with everything a session needs already on
it — and **Let it go**, which closes it and leaves the original closed with the finding on
its thread. Neither is recommended: that a bead was closed over unlanded work says nothing
about whether the work is still worth having.

**The card is filed under the P0 the stranded bead itself belongs to**, or the unsorted
backlog — see [where a filed bead
lands](landing.md#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists).
This is the sweep bc-rfnr.8 was filed over: four of these cards were sitting parentless on
the day the P0 gate landed, and a parentless `human` card is not merely held, it is off
the inbox entirely. A sweep whose whole justification is that the cost of missing one is
the work itself cannot report into a screen that will not draw it.

It asks once. The fingerprint goes in the *closed* bead's notes rather than on the card,
because the card gets answered and closed and a guard that read its existence would refile
it for ever. The card is written first all the same, and the fingerprint second: a creation
that fails has written nothing and simply comes back next interval, where a fingerprint
written over a card that was never filed would be a finding lost in silence.

**And the card is re-asked every sweep, because the reading has an age.** The grace above
is a guess about how long a session takes to open its pull request, so it cannot be the
whole of the fix — a delivery whose gate runs three hours gets carded anyway. The card
therefore says *when* GitHub was asked, in UTC and marked as such, and on every sweep the
advocate walks the cards of this sweep's still in the inbox and asks GitHub again. One
whose central claim has stopped being true is **closed with a reason saying so** rather
than left for you to answer a question about a state that no longer exists: "Wrong when it
was asked: #315 is open for `worktree-…`", and a line on the original bead's thread taking
back the one the sweep put there.

Closed rather than amended, which is the difference from [the conflicting-merge
card](pull-requests.md#a-branch-that-keeps-conflicting-does-not-keep-filing-cards). That one is a running report on merges still
moving and there is more to say each cycle. This is a single question with two buttons, and
once a pull request exists neither means anything — **Land it** would commission a session
to rebuild a branch already in review, and **Let it go** would record a decision to abandon
work nobody is abandoning. A question whose options have both become wrong is not one to
reword.

A card of this sweep's is found by its own title — `worktree-… never reached main — bc-… is
closed over it` — and not by a record on disk. That is deliberate: the conflicting-merge
sweep keeps its mapping in `~/.config/beadcause/sweep-cards.json`, and bc-xl7n.35 is the
bead about eight of thirteen cards in one day outliving their record, after which nothing
can ever amend or close them. Here the recovery path and the ordinary path are the same
path, so there is no second one to go stale.

The one asymmetry worth knowing: a **merge** settles the question for good and the
fingerprint stays, so the branch costs no further `gh` call ever. An **open** pull request
does not — it can be refused unmerged next week, and then the branch really is stranded —
so closing a card for that reason writes a second mark that takes the ask back, and a later
sweep may file a fresh card. The last mark on the bead wins.

This is also what keeps this sweep and the conflicting-merge sweep from holding two open
cards asking incompatible things about one branch, which they did on `worktree-reenter-gate-f31f`
on the day above: one offering *land it / let it go* as if the work were abandoned, the
other naming #315 and asking which side wins. There is no cross-check between them and
there does not need to be — the other sweep only ever files about a branch that *has* a
pull request, and the moment one exists this card cannot survive its next follow-up.

Two costs shape the schedule. It is the only sweep here that reads *closed* beads, which is
half a megabyte of `bd list` on a busy tracker; and it spends a `gh pr list` on each branch
git says never landed, of which this laptop keeps every retired worktree's. So it runs
hourly rather than every ten minutes, and asks GitHub about at most twenty branches a
sweep — nothing is dropped, since a branch it did not reach writes no fingerprint and is
first in line next time, and the count of what it skipped goes in the log. `flagNotInMain:
false` switches it off.

### The bead whose work is already in an open pull request

The three sweeps above are all about work that **finished** without the tracker noticing.
This one is about work that has not finished and does not need a second session either: a
bead whose pull request is *open*.

bc-utyr is what it costs. The advocate opened a worker on bc-dmt while #115 — the pull
request that *was* bc-dmt, built and delivered by the previous attempt — was open,
conflicting, and had two sessions on it resolving the conflict. There was nothing left for
a worker to do, and the window was worse than merely wasted: the two briefs disagree about
who merges. A worker's brief tells it to run `beadcause-deliver`, which **merges**; a
resolver's says outright that the merge is a tap on the phone and is not its to make. Two
live briefs disagreeing about that is how a branch lands out from under a review that had
not finished.

So an open pull request is work in flight, and **the bead it carries is not ready**. It is
not *done* either — `state: OPEN` is not `state: MERGED`, so nothing here closes anything —
which leaves held as the only honest third thing, exactly as the [duplicate
filter](#what-counts-as-work) already does. Which beads a pull request carries is the same
tiering the board uses ([Which bead a pull request is
for](pull-requests.md#which-bead-a-pull-request-is-for)): the delivery block, the title, the branch tag,
then the body's claims, each verified against the tracker before it is believed.

**This one errs toward holding, and the duplicate filter errs toward working — deliberately,
and the difference is the evidence.** A title comparison can be wrong about two genuinely
different jobs, so it must risk doing the work twice. A pull request naming a bead is not a
resemblance; it is a branch with commits on it. The cost of a wrong hold is one bead that
waits, named on the advocate's card with the pull request number on it, until that pull
request merges or is closed — both of which happen on their own. The cost of a wrong launch
is the incident above.

A draft is still open and is still held: work on a branch with somebody's intention
attached, and a second session writing the same feature beside it is the same waste with a
different label. A pull request naming no bead holds nothing, because there is no bead to
hold. And **a `gh` that will not answer holds nothing back** — a network failure must not
be able to empty a queue — though a failed read keeps the map the last good one left
rather than clearing it, because the map that was true four minutes ago is a better answer
than none.

Asked every `inflightIntervalMinutes` (default 5, shorter than the sweeps above because
this is the one whose answer moves the moment *this daemon* does something — a delivery
that could not merge opens a pull request and hands the bead back to `bd ready` in the same
minute), and **again, unconditionally, before a window opens**. `holdOpenPrs: false`
switches it off. `node test/prqueue.mjs` covers the filter and `node test/twinqueue.mjs`
the sibling it sits beside.

### The bead somebody is already sitting in

The filter above holds a bead because of something in a repository. This one holds it
because of something on the laptop: a **window that is already open on it**.

bc-vq78 is what it costs, and it is the worst of the family. Two sessions were open on
northwind/cl-xe2 at the same time — one busy since 17:18 and writing files, the other
handed the same bead an hour later with a plain brief, which told it that claiming the bead
"is what stops a second session being opened on top of you". It ran the claim, got no
complaint, and worked for seventy minutes before noticing that files it had not written
were changing mtime. cl-xe2 spanned ten separate repositories; both windows were pointed at
the same uncommitted worktrees. Nothing but the second session's suspicion stood between
that and two agents editing one tree.

**The claim is not the guard the brief advertises**, and that is the whole of it. Things
take it off again, all of them legitimately:

- **"Request changes" reopens the bead and drops the assignee** — that is the only signal
  an advocate reads, so asking for changes has to do it, and the session that built the
  branch is usually still sitting in its worktree when you tap it.
- **A worker can lose its slot without its window going anywhere.** A timeout, or a
  check-in it never answered: the advocate stops counting it, which is right — a slot is
  not a bead — but the window is still there.
- **A restarted daemon forgets its workers outright**, and a restart usually follows a
  merge, which is exactly when sessions are live.

So the evidence here is the window itself: a running Claude Code process whose name carries
this bead's id. That is not a new inference — it is the same `namesBead` rule the
[reaper](#closing-the-window--a-session-that-has-finished-should-not-still-be-on-screen)
already trusts to decide which window
to close, and it is what the incident report reconstructed by hand from `ps` and
`~/.claude/sessions/*.json`.

**Two guards, and each covers the other's gap.** A worker this advocate remembers opening
is filtered where the launch is chosen, which catches the session that is *too young* to
have renamed itself — a window carries no bead id until its first turn runs. This filter
catches the session the advocate has *forgotten*, which is every case above. Neither is
sufficient alone, and the failure they prevent is not a wasted window but a corrupted tree,
so both stay.

It matches against every live session on the laptop rather than this workspace's, because
ids are prefixed per workspace (`cl-`, `bc-`, `sp-`) and a match therefore cannot cross
one — while a window working a northwind bead from a directory that maps somewhere else is
exactly the case a workspace filter would miss. A record whose process is gone holds
nothing: nothing deletes those files on exit, so "a record exists" and "a session is
running" are different questions, and every row is liveness-checked before it is believed.
An idle window holds it too — an interactive session says its last word and goes back to
waiting, so a delivered or handed-back worker sits there idle with a worktree full of
uncommitted work, which is the same collision with a quieter first half.

There is no interval on this one, unlike the three sweeps above it: the session records are
files on this laptop, so the read is free and happens on every tick — and again,
unconditionally, immediately before a window opens, which is the read that catches a
session that renamed itself while the tick was running. The cost of a wrong hold is one
bead that waits, named on the advocate's card with the pid of the window holding it, until
that window closes. `holdLiveSessions: false` switches it off. `node test/livequeue.mjs`
covers it.

**It is a filter, though, and a filter is never the guarantee.** The queue is not the only
route into a launch, and a window that re-ran its own command line came through no route of
this daemon's at all — three of them, on one bead, while this filter was on. The refusal at
the door is [three windows on one
bead](#three-windows-on-one-bead-and-the-daemon-reporting-two).

### The bead another Mac has claimed

Every filter above reads something this laptop can see — a row in this tracker, a pull
request on this repo's GitHub, a process in this process table. That is the whole of the
world right up until the tracker is [shared between machines](operations.md#a-tracker-two-macs-share),
and then it is a blind spot with a session in it: two engineers, two daemons, two
advocates, **one `bd ready`**. The same bead comes up ready on both, `candidates()` on
each filters against its own busy ids and its own attempt counts, and two windows open on
two Macs to write the same feature twice on two branches. It is the same-job collision the
twin filter above catches, with the one guard that catches it removed: `findDuplicate`
compares against rows *this* daemon can see, and `a.workers` is *this* daemon's worker
list.

**`bd update --claim` is not the answer, and why it is not is the whole design.** It is
atomic, it does set the assignee and the status, and it is atomic *against the local
Dolt* — which is the wrong scope. Sync is discrete: a claim written on one Mac is
invisible to the other until the first has pushed and the second has pulled, which is
`sync.seconds` later, two minutes by default. Claim-then-check inside that window is not a
lease at all. It is two local writes that both succeed, and whichever syncs second
silently takes a bead the other already has a window open on.

There is nowhere to move it to, either. beadcause solved the same problem in the other
direction once — five sessions racing to merge into a local `main`, fixed by handing the
merge to GitHub *because GitHub serialises it*, which is why [the merge does not happen in
this checkout](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue). Dolt
offers nothing of the sort. So this is honestly eventually consistent, and it says so out
loud:

- **The claim is a label, and it names the machine and the moment.**
  `held:20260812T094200Z:adam@example.com`. A label, because labels are *rows*: two
  machines writing two different ones is not a conflict Dolt has to resolve, it is two
  rows, and after a sync **both machines can see both claims**. That is the entire
  mechanism. A cell — the assignee, the status — would have been a real write conflict,
  and the loser's evidence would be gone.
- **The collision is detected afterwards, and the tiebreak is a string sort.** Earliest
  stamp wins and the handle breaks a tie — and because the stamp leads the label, that is
  exactly `labels.sort()[0]`. Both machines compute it from the same strings with no
  further communication and cannot disagree, which is what makes *exactly one session
  survives* a fact rather than a hope. Two clocks can make the **fair** answer wrong; they
  cannot make the two machines answer **differently**, and only the second matters.
- **The loser stands down loudly.** A cap that is silent reads exactly like an advocate
  that has decided there is nothing to do, so the stand-down is a log line, an event, a
  pill on the advocate's card — and a message into the losing window, which is told before
  anything is signalled at it. The window then joins [the reaper's
  list](#closing-the-window--a-session-that-has-finished-should-not-still-be-on-screen)
  and closes once it is idle, so a session mid-sentence finishes the sentence. The bead is
  charged no attempt: losing a coin toss is not evidence about the work.
- **A claim expires.** `leaseMinutes`, an hour by default, restamped at half that by any
  advocate still holding the worker. This is not a detail — a Mac that sleeps mid-bead
  would otherwise park that work permanently, and a bead nobody may ever open is strictly
  worse than the duplicate window the whole thing exists to prevent. A duplicate costs an
  hour; a park costs the bead.

**A Mac that does not know who it is claims nothing.** The handle comes from
[`me`](operations.md#who-a-question-is-for--me-and-the-for-label), which is null by default — and with it null no label is
written, no bead is held, and nothing here has a branch to enter. That is the same
guarantee the addressee makes, out of the same setting and for the same reason: a
single-person install is byte-for-byte what it was.

The cost of a wrong hold is one bead that waits, named on the card with the handle of the
person to go and ask — the only pill on that row that names something you cannot settle by
looking at your own screen. `holdLeases: false` switches it off. `node test/lease.mjs`
covers the tiebreak and the expiry, and `node test/leasequeue.mjs` drives two advocates
over one faked tracker whose label store is per machine until a sync unions it, which is
the only shape in which the race can be staged at all.

#### …and the subtree under it

A claim is written on **one** bead, and for most of a day that is all a window is
responsible for. It is not always: an advocate can hand one worker an epic *and its ready
children*, brief it on all of them and let it sequence them — and that window leases the
epic, because the epic is what it was launched on. Every other machine then sees the
children exactly as it would see unclaimed work. Nothing labels them, and the worker that
would have held them back is in an `a.workers` on somebody else's laptop.

So the second Mac holds the epic correctly, opens a window on the first child, and the
subtree has two windows on two branches — which is the duplicate this whole section exists
to prevent, one level down. **A live claim on an epic above a bead therefore holds that
bead**, and both halves of the rule ask it:

- **Before a window opens**, as part of the same filter. The bead's own labels are answered
  from the `bd ready` rows that are already in hand, and so is an ancestor's if it happens
  to be ready too. Otherwise it is one `bd show` per ancestor per pass — cached, so an epic
  with five children in the queue is one read, not five — and none at all for a bead with no
  parent, which is most beads, or for an install with no `me`.
- **And after one has**, because the pre-launch half cannot reach the race that matters:
  the collision happens *before* either machine has synced. One Mac takes the epic, the
  other takes a child, and neither could see the other when it launched. The sync makes it
  visible, and the tick after it is where the machine inside the subtree stands its window
  down — while the machine above stands nobody down, which is what keeps the answer at
  exactly one and not zero.

**Any ancestor**, not only an epic. It was epics only until bc-zgfo, on the argument that a
batch head is always an epic and a session on a *plain* parent was handed one bead and
speaks for one bead. The local rule drew that line first and this one followed it, because
the same two beads must not resolve one way when the window is on this Mac and another way
when it is on the next desk — and [when the local rule dropped the
qualifier](#the-child-that-goes-ready-after-its-parents-window-opened), this had to drop it
in the same commit. It costs nothing: the type test sat *after* the `bd show`, so a non-epic
ancestor was already being read and then discarded. Everything else about that window is
unknowable from here and is not guessed at: a label says a machine and a moment, not what
the session was briefed on.

Which leaves the tiebreak, and it is the asymmetry rather than the stamp: the machine above
wins, however recently it claimed. Earliest-stamp would have been the *fairer* answer and
the wrong one — it can leave the ancestor's window and the child's window both standing,
which is the bug. Holding is also the cheaper mistake and a self-cancelling one: the claim
comes off when that worker ends, expires on `leaseMinutes` if the Mac went to sleep, and
says whose it is on the card the entire time it lasts. The cases are in
`node test/leasequeue.mjs`, including the read count, the sibling that is *not* held, the
plain parent that holds its subtree too, and the two-machine race resolved after a sync.

#### …and the window already inside it

The rule above reads upward: a claim on an ancestor holds the bead. Read downward it said
nothing, and the hole that leaves is the same duplicate stood on its head. The other Mac
opens a window on `x-1.1`, a subtask, and claims it. `x-1` — a plain task, its parent —
goes ready here, and every check that should have stopped a second window is looking the
wrong way. No ready child, because the child is *claimed* and claimed beads are out of
`bd ready` entirely. No live worker under it, because that worker is in an `a.workers` on
the other laptop. And the `bd children` question — the one that holds an epic while
anything under it is open — is asked only of an **epic**, which a task with subtasks is
not. So the parent launches here, and the subtree has two windows on two branches.

**What made this the half that was left out is that descendants are not in the id.**
`ancestorsOf` is free: `x-1.2.3` is under `x-1.2` and `x-1`, and that is arithmetic on a
string. There is no `descendantsOf`, and the honest ways to get one are a `bd children` per
queued parent per tick, recursively, or the whole graph out of a `bd export` — a read per
tick to learn something that changes about as often as somebody opens a window.

So the question is asked the other way round. Not *what is under this bead, and is any of it
claimed*, but **what is claimed, and is any of it under this bead** — and that second form
needs no enumeration at all, because `isDescendantOf` answers it in the ids already in hand,
at any depth. The list of claims comes from the in-progress rows, which [the twin
filter](#what-counts-as-work) has read on every survey since it was built and uses only the
titles of. This reads the labels off the same rows. **It costs nothing**, which is the
second time that has been the answer here and for the same reason: the read was already
being paid for and thrown away.

That the rows are the *in-progress* ones leaves one gap, and the filter above it covers
that gap. A bead the other machine's advocate has staked is claimed by its worker within
the first minute, so the two writes ride the same sync — by the time a pull can show you the
label at all, it shows you the status. In the window where it has not, the bead carries no
claim here yet, so it is still in this tick's `bd ready`, and the *first* check holds a
parent whose child is ready for exactly the reason this one holds a parent whose child is
claimed.

**And this half is a filter and never a stand-down**, which is the one place the two
directions are deliberately not symmetric. `reconcile` withdraws a window when a claim is
*above* it, and that asymmetry is what resolves the after-the-fact race to exactly one
survivor: the machine above keeps its window, the machine inside gives its up. Asking the
downward question there too would make both of them withdraw — the one above because
somebody is below, the one below because somebody is above — and a subtree nobody is working
is worse than the duplicate that started this. So it runs before a launch, where the answer
is *do not open a second window*, and never after one, where the answer is already settled.

#### …and the window this daemon never opened

Everything above is written by the launch. The advocate stakes the claim and then opens the
window, so every session **it** opens is visible on the other Macs — which is most of them,
and was all of them for as long as the only thing that opened a window on a bead was an
advocate. It is not. A bead opened from the phone or the console opens a session on the
Mac; so does a terminal seeded on one; so does opening iTerm yourself and starting a
session on a bead by hand, which is the oldest way of all. None of those goes past the
launch, so none of them staked anything.

On one laptop that has never shown, and the reason is the filter two sections up: [a window
already open on a bead](#the-bead-somebody-is-already-sitting-in) holds it, on the evidence
of the process alone, whoever opened it. Across two Macs there is no process to see. The
other machine reads a bead that is ready, unclaimed as far as the shared graph knows, and
opens a second window on it — bc-bllw's incident exactly, reached through the one door
bc-bllw did not close. That is bc-3p53.

So the same evidence is **published**. Every tick already reads the session records to
decide which beads a window is open on; each one that names a bead this workspace has, and
that no worker of this advocate is on, now gets this Mac's claim written on it. The other
machine's filter reads it like any other claim, and holds the bead.

**And the terminals, which are the same fact from a register rather than an inference.** An
[in-app terminal](android.md#the-terminal--driving-a-session-from-the-phone) seeded on a bead is briefed
for a phone-sized screen and told outright *not to rename itself*, so no session record
will ever carry its id and the sweep over names is blind to every one of them. It does not
need a name: this daemon starts the pty and this daemon ends it, so `live` is not something
inferred from a process table. Live ones only — a **resumable** terminal is a conversation
waiting to be picked up, with no process behind it and possibly days before anybody does,
and a claim held across that is the park this whole mechanism is trying not to cause.

**The release is what made this a bead rather than a line, and it is why the claim follows
the window rather than the door that opened it.** A hand-opened window is not a worker: no
slot, no reconcile, nothing that would ever renew or drop a label on its behalf. Staking
where the window is opened is one line of code and leaves only `leaseMinutes` to end it —
so closing a window you had open for five minutes would park that bead on every other Mac
for an hour, which is the trade [the lease itself](#the-bead-another-mac-has-claimed) calls
strictly worse than the duplicate window the whole thing exists to prevent. The window is
the better signal and it is free: it arrives every tick, in the same snapshot every other
filter here already reads. So the claim is staked while a session names the bead, restamped
at half the lease for as long as one does, and **taken off on the first tick after the last
one has gone**. Expiry stays underneath for the single case this cannot see — a daemon that
was down when the window closed — which is what expiry was always for.

Three windows it deliberately says nothing about, and each would otherwise have cost a
duplicate label:

- **A worker**, or a window on a bead beneath one. The launch staked that claim and the
  reconcile renews it; a second mechanism writing a second label from the same handle is a
  second row to sync and a bead the tracker reports as contested by a machine that is not
  contesting anything.
- **A window whose name says `QUEUED-` or `DONE-`.** A session finished by its own
  account is not working the bead, and its window can sit there for an hour before the
  sweep closes it.
- **A bead another Mac already holds.** A claim of ours would be later and would lose the
  tiebreak anyway — and writing it would only tell the holder's card the bead is contested
  when nothing here is going to stand down. This window is a person at a keyboard, and no
  advocate closes one of those.

It costs one `bd show` per hand-opened window per half a lease: the read that says whether
the id in a window's title is a bead this workspace has at all, since a title can carry a
hyphenated word in exactly an id's shape. The answer is remembered either way, including
the negative, and ages rather than sticking, because every one of those answers can change.
It is off wherever the lease is off — `holdLeases: false`, or no `me` at all, which is every
single-person install and costs not so much as a read — and off with `holdLiveSessions:
false` as well: a window is the only evidence it has, so an advocate told not to treat an
open window as a bead being worked has no business telling the other machines that it is.
`node test/handlease.mjs` covers it, including the release, the adoption of a claim a
restarted daemon left behind, and the other Mac holding the bead after a sync.

### The bead whose files somebody is already editing

Every filter above asks about the **bead**: has another Mac claimed it, is a window open on
it, does a pull request carry it, is another bead the same job. There is a sixth way for a
window to be a bad idea and none of them can see it — the bead is unclaimed, unopened,
unduplicated and in nobody's pull request, and the three files it is going to rewrite are
open in a session two worktrees over. Nothing collides today; it collides at downmerge, as a
semantic conflict somebody resolves by hand a day later.

The answer to that already existed and was being asked in the wrong place. `lib/claims.js`
has known which file each session is editing since the [register was
built](pull-requests.md#one-granularity-down-which-file-somebody-is-already-editing), and the only thing
that ever asked it was `scripts/claim-guard.sh`, at `PreToolUse`. So this filter adds
nothing but a read: `claims.list()` is a map in the daemon's own process, and the advocate
walks it once per survey.

**Which files, though.** That is the half a `bd ready` row cannot answer, and `lib/beadfiles.js`
is where the answer is worked out — from two sources whose strengths are deliberately not
the same:

- **declared** — the bead says which files it expects to touch. That is a forecast somebody
  wrote down on purpose, and it holds;
- **guessed** — the paths written in the bead's own prose, kept only where one names a file
  that is really on disk in the checkout that bead would be worked in. That existence check
  is what separates `lib/advocate.js` from a package name or a path that used to exist, and
  it still is not evidence enough to withhold work.

**How a bead declares one: a `beadfiles` block in its description.** A bead is a `bd` row
and `bd` has no surface column, so the field has to live inside one of the text fields it
does have — and which one is a measurement rather than a preference. `bd list --json`
returns `description` on every row and returns neither `notes` nor `design`; those cost a
`bd show` **per bead**, and the advocate asks this of every candidate on every tick, so a
surface in `notes` would put one tracker read per candidate behind a thirty-second timer.
Labels are the other free field and are the wrong shape: a path is full of `/` and `.`,
five files would be five labels, and bd's label vocabulary is one flat namespace that
`repo:`, `human`, `unendorsed` and the lease markers already mean something in. So:

```beadfiles
lib/advocate.js
lib/beadfiles.js
public/app.js
lib/          # everything under here — a trailing slash means lib/**
```

Fenced the way the `beads` and `decision` blocks are, and read out of the description
wherever it appears in it. One path per line, `#` for a comment, `*` inside a segment and
`**` across them. It is the one block here that does **not** carry YAML, and it cannot:
`*` is YAML's alias indicator, so a path beginning with one is a parse error rather than a
path — `files: [*.js]` fails with "unresolved alias" — and a glob is the single most
useful thing anybody writes into a surface. Lines have nothing to quote and nothing to
escape.

`lib/beadfiles.js` reads that block and also writes it, and those are the only two
implementations of the format there are: `formatSurface` and `withSurface` are what every
path that files a bead calls, so a block written by the console and a block written by a
plan cannot come to be spelled differently. Writing replaces any block already in the
description rather than appending — a corrected surface that silently lost to the one it
corrected would be worse than no correction — and an empty list withdraws the block and
leaves the prose. The bounds are the ones the register already had: 24 files, 300
characters an entry, `node_modules/`, `.git/` and `.claude/worktrees/` never, duplicates
folded, the overflow dropped rather than the bead refused.

**A missing block and an unreadable one are the same answer, and the answer is dispatch.**
No block, an empty block, a block of nothing but comments, an unclosed fence, a block full
of things that are not paths — all yield nothing, which is exactly what a bead that never
mentioned files yields. A declaration is a forecast somebody wrote at filing time, before
anybody read the code; a field that could withhold work by being malformed would be worse
than not having the field at all. `node test/beadfiles.mjs` asserts each of those ways of
having no surface, and that what the writer writes the reader reads back.

**A guess may speak, but it may not hold.** It is `withoutTwins`' rule — evidence that is a
resemblance must err toward doing the work twice rather than not at all — and the opposite
of [the open-pull-request rule](#the-bead-whose-work-is-already-in-an-open-pull-request),
whose evidence is a branch with commits on it. So a bead whose *guessed* surface collides
with a live claim is dispatched anyway and the collision goes on the card as its own pill,
separate from the holds and never counted among them: a near miss, kept visible precisely so
that "would holding on a guess have helped?" is a question the screen can answer.
`holdGuessedFiles: true` turns the guess into a hold for a workspace whose beads are written
with their files named; `holdClaimedFiles: false` takes the whole filter out.

**And the session it dispatches anyway is told.** That was the hole left in the paragraph
above: the near miss reached the card and the log, and the one party it never reached was
the window being opened into it. That session then learned the same fact at its first
`Write`, from `scripts/claim-guard.sh`'s denial — after it had read the tree, chosen an
approach and started typing, which is exactly the lateness reading the register at dispatch
exists to end. One step earlier for the dispatcher, unchanged for the agent. So the entry
the filter built rides the queue row into the launch, and the brief `workPromptFor` writes
carries a section naming the files, the worktree holding them and the three things worth doing about
it — start where those files are not, go and read what that branch is doing first, or, if
it turns out to be the same job, say so. It is worded as a warning and not as a boundary,
deliberately: the evidence is a resemblance, and a brief that told the session to stand
down would put back in prose precisely the hold `holdGuessedFiles` is off in order not to
take. A bead with no collision gets a brief unchanged to the character, and the row's copy
is stripped back out of the wire — the card already draws the same sentence once, and two
places saying one thing is how they come to disagree. `node test/land.mjs` asserts the
words; `node test/claimqueue.mjs` asserts the seam.

The sentence all three of them carry — the pill, the log line and that brief — names the
branch the holder is on and, where the daemon managed to [resolve
one](pull-requests.md#one-granularity-down-which-file-somebody-is-already-editing), the bead in brackets
after it: `lib/advocate.js on worktree-queue-filter-8kq (bc-8kq)`. Both, in that order,
because they answer different questions. The branch is where the work is and is what the
next paragraph of that brief tells the session to go and read; the bead is what you type
into `bd show`, and until it was resolved the session had to get there by decoding a
worktree name.

**Nothing here has to be released**, which is the property worth the most. The hold is not a
record — it is recomputed from the register on every survey, and `claims.list()` prunes what
has expired and what belongs to a worktree no longer on disk as it reads. So a session that
ends, a claim that ages out at 90 minutes and a `ship` that removes the tree all release
this without knowing it exists, in the same way a merged pull request releases the filter
above. The filter also runs **outermost** of the six: a bead any of the others would hold
reads better as "a window is already open on it" than as "somebody is editing
`lib/advocate.js`" — and a session's claim on its own bead's files can never hold that bead,
because the live-session filter one call in took it out first. `node test/claimqueue.mjs`
covers it.

### The collision that has not happened yet — two beads, one tick

Every filter above reads a collision that already exists: a window that is open, a branch
with commits on it, another Mac's claim, a file somebody has their hands on right now. Two
ready beads whose *declared* surfaces intersect are none of those. Neither has claimed
anything, because neither has been opened; both therefore pass the filter above, both are
dispatched in the same tick, and the collision happens about ninety seconds later in two
windows. The first anybody hears of it is `scripts/claim-guard.sh` refusing an edit — which
is exactly the lateness reading the register at dispatch exists to end, one tick further up.

**A tick already knows every bead it is about to open.** Comparing their surfaces to each
other costs nothing and the answer is free, so the outermost filter of the seven does that
and **defers** the later of the two to the next tick. Later defers to earlier, so the
ordering the survey has already established decides it rather than a new one invented here.
`advocates.holdCollidingSurfaces: false` takes the filter out.

Three things about the shape of that, and each is the same argument made elsewhere in this
file:

- **Deferred, not blocked.** The loser comes up on the next tick with nothing to release, no
  timer and nobody to ask. By then the winner is holding a real claim, so what holds the
  loser from that point on is the filter above — with a sentence that names a branch. This
  one keeps no state between ticks at all.
- **Declared surfaces only**, whatever `holdGuessedFiles` says. That flag decides whether a
  guess may hold against a claim somebody is really holding; a hold with a guess at *both*
  ends has no evidence at either. A bead that declared nothing is dispatched, exactly as it
  is everywhere else in this field's story.
- **It says so on the card**, as its own pill with its own reason, because a bead that
  quietly never opens is indistinguishable from a bead nobody wants. The pill names the
  other bead, which is all there is to look at — there is no window and no branch yet.
- **And a bead at `maxAttemptsPerBead` reserves nothing**, because the first bullet is only
  true if the winner really is being opened. This filter is the last stage of the survey and
  [the attempt filter](#a-bead-it-has-given-up-on-says-so) is the first stage of the pick,
  so a bead the advocate has already given up on is still in the queue here: it sorted in
  pick order, it took every file it declared, and it was then dropped before any window
  opened. The counter is a floor nothing decrements, so the bead behind it was not deferred a
  tick — it was withheld for ever, waiting on work that could never come up. Measured at
  eighteen hours over one file, and with 38 retired beads in a single tick that was not a
  corner: the cap had stopped being a per-bead retirement and become a repo-wide lock on
  every surface any of them had ever named. A retired bead is now skipped before it is
  compared, so it neither reserves nor is reserved against — it stays in the queue, where
  "given up on" is the one list whose job it is to report it, and it is kept out of the pill
  above, because a bead drawn as retired *and* as held behind a file is one bead as two.

  Since bc-y683b the skip is `retiredByAttempts` rather than the raw counter, which is the
  same predicate the pick uses — so [an epic past the cap](#an-epic-is-never-retired-by-the-cap),
  which *is* about to be opened, reserves its files like any other winner. The two reading
  one predicate is the point: a bead that skipped the comparison and then took a window is a
  window opening straight into a file another window already has its hands on.

**And one tick earlier still, a plan may not create the collision at all.** A plan is the
one document in this system where somebody decides, in one sitting, what several windows
will each go and do, which makes it the only place a file collision can be *designed out*
rather than arbitrated afterwards. So [a plan group](#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window)
may declare a `files:` list, `formatPlan` prints it on the group's line so the person reading
the plan comment can see the seam, and `validatePlan` **refuses** a plan whose groups
intersect within one repo — naming the earlier group, which is the one the planner wrote
first and is most likely to keep. It is a refusal rather than a deferral for the reason the
strictness is worth stating: everywhere else a surface is a forecast and an overlap is a
risk, but a plan is a decomposition somebody has just made, so an overlap in one is not a
fact about the world, it is a bug in the plan — and the planner is the only party still
holding the context to split it. Declaring nothing is legal and intersects nothing.

**Legal, and no longer silent.** Because `files:` is optional, that refusal is opt-out — a
plan that declared on no group exited 0 with a clean summary, indistinguishable from one
that declared and passed. On bc-y3qk the planner worked that out and used it, reasoning
that a wrong declaration is a hard refusal where no declaration is not, and so it reasoned
its way out of the only automatic check on its own work. `surfaceNotes` makes the two
states different without making either illegal: `bin/plan.js` prints a line per group that
declared nothing, naming the check that did not run for it, and a line wherever two groups'
surfaces meet once the undeclared ones are read off their beads' own text — the same
`overlap`, and the same guess `lib/beadfiles.js` already makes for the dispatcher's *"which
this bead's text names"*. They are warnings on the stderr the refusals already use, the exit
codes are unchanged, and `files:` stays optional: a bead whose file surface is genuinely not
known this early in an epic is a real state, and refusing it would withhold work for a
forecast.

The overlap test itself lives in `lib/beadfiles.js` beside the parser and the writer, and
there is exactly one of it. Both sides of a comparison may be globs — `lib/**` against
`lib/pr*.js` is a real pair — so the question is not "does A match B" but whether any path
exists that both would match, decided exactly for a language of three things: `*` within a
segment, `**` across them, and a literal. A plan that computed overlap differently from the
dispatcher would be the worst outcome available, two mechanisms that both believe they are
reading one field. `node test/plansurface.mjs` covers both ends.

### The child that goes ready after its parent's window opened

Every filter so far asks about work *underneath* a bead: is a child ready, is a session in
the subtree, does this epic still have open children. The mirror question — is a session
already open **above** this bead — was asked only against a **batch head**, a worker that
had been handed a whole subtree in one brief. The reasoning was that an epic is not the
work, its children are, so holding a child because something sits on its parent would leave
nobody doing either.

That has one hole, and it is bc-zgfo. **A hold behind a live window is a wait, not a
stall.** The worker above ends, the reconcile pass drops it, and the child launches on the
next tick — bounded in the worst case by `workerTimeoutMinutes`. What the qualifier let
through instead was two windows inside one subtree, on one laptop, with the parent's brief a
superset of the child's: the [bc-3zo9 duplicate](#the-bead-somebody-is-already-sitting-in)
with the order reversed, costing a branch rather than a wait.

Two ways in, and neither needs a batch to exist:

- **A non-epic parent whose only child was blocked when it launched.** A plain task with
  subtasks is ordinary work; its window has no batch. An hour later the subtask unblocks,
  goes ready, and nothing holds it.
- **An epic that launched with no open children, and gained one.** Such an epic is
  deliberately workable — an epic with nothing under it is an ordinary bead with an
  ambitious type, and it should not need a human to retype it before anything picks it up.
  But a worker that files a bead under the epic it is working has just created a ready bead
  inside its own subtree. bc-2uj4 was in exactly that state while this was written.

So the check is now unqualified: **any live session on any ancestor holds the bead**, and
the card says which window and which bead it is under. The floor is unchanged — with no
workers there is nothing to match, and a session on a bead that is not an ancestor of
anything queued matches nothing, so an ordinary busy advocate is untouched. Matching is
prefix-on-the-id with the dot included, so `x-11` is not underneath `x-1`.

The batch dispatcher asks the same question on the same terms, because it never reaches the
suppression: a batch head goes straight onto the workable list, so an inner epic under a
live window would otherwise be promoted to a dispatcher of its own. The two rules moving
together is the invariant — one subtree, one answer, per tick. `node test/epicqueue.mjs`
covers both, including the sibling that is not held.

### The bead that closed while the queue was being built

Every guard above holds a bead that *should* be worked but not right now. This one refuses a
bead that should not be worked at all, because it is finished.

bc-uaxn is the incident. A worker window was handed a full brief for bc-ikj6 —
"opened automatically by the beadcause advocate because it came up ready" — seventy-eight
minutes after `bin/deliver.js` closed it and #173 had merged. `bd ready` cannot return a
closed bead and the survey is built from it, so no fresh survey queued that window; the
launch path was never established from what was left on disk, and that is precisely the
argument for a refusal at the door rather than one more filter upstream. A guard that only
holds when you can name the route is a guard that holds until the day you cannot.

**The wasted window is the harmless half.** The brief opens with *claim it before you touch
anything*, and `bd update <id> --claim` sets `in_progress`. On a closed bead that
**resurrects merged work**: it reopens the bead, puts it back in front of the next advocate
tick, and that tick can open another window on it. A session that simply obeys its brief in
order does this before it ever reads the close reason. The window that found bc-ikj6 escaped
only because it happened to run `bd show` first and noticed `[CLOSED]`.

Two layers, matching [endorsement](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time)'s
two and for the same reason:

- **A refusal**, in the two doors into an unattended session — the worker and the epic
  planner. It reads the row the endorsement check has already fetched from the tracker, so
  it costs nothing and it cannot be fooled by a stale queue row, which is the entire shape
  of the bug: the bead closed *after* the queue was built. It bites hardest on the planner,
  which ends by reopening its epic so the plan is visible to the queue — a planner opened on
  a closed epic would un-close it as its last act.
- **A sentence in the brief**, because the refusal only covers the doors this daemon owns.
  A window opened by hand, resumed, or launched by something written later still starts by
  reading its brief, and the brief now says what to do when `bd show` answers `CLOSED`:
  do not claim it, say what the close reason says landed, and stop.

**Only `closed`.** `in_progress` stays workable and that is load-bearing — attempt 2 on a
bead the previous window claimed and abandoned is an ordinary retry, and refusing it would
turn every abandoned session into a bead nothing may ever pick up again. Blocked and
deferred are queue questions `bd ready` already answers, and answering them twice here would
be a second opinion with no incident behind it. `node test/stillopen.mjs` covers both layers,
including that the gate reads the tracker rather than the row it was handed.

### Three windows on one bead, and the daemon reporting two

The guard above refuses a bead because it is finished. This one refuses a bead because
somebody is already in it — and it is the same subject as [the bead somebody is already
sitting in](#the-bead-somebody-is-already-sitting-in), one layer further down, because
that filter turned out not to be reachable from every route in.

bc-7qo.19 is the incident and it is a worse shape than bc-vq78's two windows. At 10:56Z on
2026-08-21 **three** live `claude` processes were carrying the identical worker brief for
bc-7qo.11 — pids 84917, 85731 and 2693, in three worktrees, two of them editing
`lib/server.js` in the same minute. bc-khoe.21 had three the same minute, and two of *its*
three had independently written the same fix into two branches. The daemon knew about one:
its log has a single `opened a session on bc-7qo.11` for the whole hour, `advocates.json`
held one worker row, and at 11:01:20Z it was still printing `92 ready · at its limit of 2
session(s)`.

**None of the three was dispatched, and that is the part that matters.** Earlier the same
morning their windows had been torn down mid-turn, and the *shells* survived — parent shells
three hours older than the `claude` processes inside them — and re-ran the command they had
been given. Nothing on that route passes through this daemon, so every counter it keeps was
bypassed at once: the session cap, the per-bead attempt count, and the claim.

**A claim cannot be the answer here, and it is worth being clear why.** Every window on this
Mac writes as the same `bd` actor, so three `--claim`s all succeed and a lease renewed by
three windows reads exactly like a lease renewed by one. `bd` cannot tell them apart because
from where `bd` is standing they are not different. What *can* tell them apart is the
process table: [`sessionCommand`](#how-a-session-starts-iterm-runs-the-command-nothing-is-typed)
puts the whole brief on `claude`'s own command line, so the workspace-qualified bead id is on
a window's argv from the instant the shell reaches it — before the session names itself,
before it claims anything, before it has run a tool.

Two layers, the same two the refusal above has:

- **A refusal at the door** — `lib/onewindow.js`, in `openWorkSession`, `resumeWorkSession`
  and `openPlanSession`. The queue filter one section up is the right thing and covers the
  ordinary path, but it is a *filter*, it is switchable (`holdLiveSessions`), and the queue
  is not the only way into those doors: a resumed conversation, the red-base sweep and the
  console all arrive there having been past no filter at all. It fails **open** on purpose —
  a process table that cannot be read leaves the launch alone rather than stopping the fleet
  on an unreadable answer — and it signals nothing: whichever window is already there is
  working, and the honest act is not to open a second one.
- **A sentence in the brief**, because the refusal only covers the doors this daemon owns and
  the three windows came through none of them. The brief no longer tells a session that
  claiming the bead "stops a second session being opened on top of you", which was not true;
  it gives the one command that answers the question instead:

  ```
  ps -Ao pid=,args= | grep 'beadcaus[e]/bc-7qo.19' | cut -c1-120
  ```

  Every line is a live window on that bead and one of them is yours, so two lines is the bug.
  **The `cut` is load-bearing too** (bc-dgx7.172): `args=` prints a window's whole command line,
  which for a work session is the appended brief itself — ~100KB a line, enough to overflow the
  window's very first tool call. Only the pids and the count matter, so each line is capped.
  **The bracket is load-bearing** and it is why this is worth spelling out rather than left
  to each session: `grep` finds its own argv in the process table and so does the shell around
  the pipeline, so the unbracketed pattern answers at least two on a Mac with one window on
  it. `grep -v grep` is the other idiom for that and it is wrong *here* specifically — a
  worker's argv carries its whole memory store, and this repo's store discusses `grep` at
  length, so filtering on the word drops the real window and keeps nothing.

**And a third thing, because the refusal cannot cover the route the three windows took.**
Nothing can stop a shell re-running its own command, so once a tick the daemon counts the
live processes naming each bead it is holding a worker for, and **says** when there is more
than one — with the pids, and with which of them it opened. That is one `ps` for the whole
fleet, said once per spell rather than once per tick, and it holds and signals nothing:
both windows are working, and choosing between two agents mid-turn on the strength of a
process-table read is not a decision a sweep gets to make. What it replaces is a log that
said `92 ready · at its limit of 2 session(s)` for an hour with three windows on one bead.

**And the amplifier, which was in the nightly window rather than in dispatch at all.** The
28 windows opened on bc-7qo.11 between 05:18Z and 09:55Z — every one archived with 0 commits
— were not three windows racing; they were one loop. `decide` in `lib/maintenance.js` answered
`idle` to a night that had already finished, the caller writes a verdict's phase straight back
into its own state, and `idle` is indistinguishable from *nothing has run tonight* — so the
next tick drained, forced every open window down, collected, and did it again, for the length
of the window. Dispatch is live in the gap between each collection and the next re-entry into
`closing`, which is a hole exactly wide enough for a launch. A finished night now stays
`done`, and [the fifth thing the window will not
bend](#the-nightly-window--stop-dispatching-empty-the-mac-collect-the-store) is that it
happens once.

`node test/livequeue.mjs` covers the counting — that it is said once per spell, that the
pids are in the line, and that neither a subtask nor a memory note quoting a bare id is a
second window. `node test/onewindow.mjs` covers both layers — including that deleting any of the three call
sites turns it red, and that the pattern the brief hands out cannot match the command line
carrying it. `node test/maintenance.mjs` and `node test/maintenancetick.mjs` cover the night
that no longer restarts itself, driven over a run of ticks rather than one verdict, because
the bug is in what the tick *after* reads.

### A standing root is furniture, not work

The guard above refuses a bead because it is finished. This one refuses a bead that was
never a job in the first place — and unlike every other refusal here, the bead it protects
is one that must stay open forever.

Some beads are shelves. bc-w156 says of itself "a permanent container, not a piece of
work", and its acceptance criterion is that the root must exist and *not be closed*;
bc-xl7n is the unsorted backlog, where every bead nothing has yet decided a home for
lands. Nothing in the daemon could read either sentence, and the dispatcher did the
opposite of both.

**What that cost, measured on 2026-08-13.** bc-w156 was an open P0 epic with no children,
so it sat in `bd ready` like anything else. [An epic is planned, not
worked](#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window) only reaches an
epic with enough ready children to batch: below `minBatchBeads` an epic is never a batch
head and never a planner candidate, so a *childless* one falls through the hierarchy filter
and is dispatched as an ordinary ready bead. That is a worker window, and a worker window's
one sanctioned ending is `bin/deliver.js -b <bead>`, which runs `bd close`. So an advocate
tick that found a standing root ready opened a session whose **success deletes the root from
the board**. Three windows were opened on that state in two days; all three survived by
reading the prose and handing back, which is exactly the protection [the duplicate
marker](#the-duplicate-that-comes-ready-the-moment-its-original-lands) exists to replace —
the gap was that it had no machine-readable form.

The other roots were safe by accident and not by property: they happened to have ready
children. The day the last child of one closes, it is bc-w156.

So a container carries a `container` label, and the hold is the same two layers as
everything else here:

- **A filter**, forced on in `bd ready` rather than left to the caller, so nothing can ask
  for a queue containing a container. The bead leaves every queue and every count of how
  much work is waiting.
- **A refusal**, at the worker's door and the planner's. It reads the row the endorsement
  check has already fetched, so a container that reached the launcher by a retry, a tap on
  a stale row, or a caller written next month still cannot be worked. It bites on the
  planner too: a planner's job is to cut an epic into the children that finish it, and a
  shelf is never finished.

**Nothing here is quiet by accident, and nothing is loud by accident either.** The
[no-P0-above](landing.md#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists)
rule announces every bead it withholds, because a bead held with nothing on screen reads
as an advocate that decided there was nothing to do. This one says nothing: a container is
not withheld work, it is not work, and a line every thirty seconds for the life of the
daemon would teach everyone to scroll past exactly the kind of line that rule needs read.
The refusal at the door is loud, because that one is a caller being told no.

**The Epic Advocate's door is deliberately left open to containers**, and it is the only
asymmetry between the three doors into an unattended session. An [EpicAdvocate](#advocates--an-agent-per-repo-whose-job-is-the-queue-reaching-zero)
is re-entrant, belongs to its epic for as long as the epic is open, files children *under*
the root, and never closes it — a standing root is precisely what that agent is for.
Guarding this door too would point the one agent that looks after standing roots at
everything except standing roots.

**A container still draws on the epic board, and stays a valid parent**, which is the half
that keeps this from being a way to delete a subtree: the marker says "do not work *this*",
never "do not work under this". No code was needed for it — the board is built from the
tracker's graph and never from `bd ready`, so a bead this filter removes from every queue is
untouched on the screen. That is the right way round: the board's furniture has to be
visible *as* furniture, because filing under it is what it is for.

**And a bead filed under one is ordinary work** — which turned out to take a change rather
than nothing. `bd create --parent` copies the parent's labels onto the child, so for three
days every bead the daemon filed under `bc-xl7n` was born carrying `container` and `human`.
That is the unsorted backlog, and by construction the busiest filing target in the graph:
every ship follow-up, sweep card and advocate finding lands there. Both labels are in the
queue's exclusion list, so each of those beads was out of every queue *after* being
endorsed — the part that makes it worse than being unendorsed, because the tap looked like
it worked and changed nothing — refused 409 at both doors, and drawn on the phone as a
question that asks nothing. `Bd.create` now passes `--no-inherit-labels` whenever it passes
`--parent`, so a child arrives with exactly the labels its filer chose, which every caller
already spells out in full. Off wholesale rather than filtered down to the markers that
hurt: a list of labels a child may not inherit is a list somebody has to extend every time
a marker is invented, and the window lease `held:` riding down to beads no window was ever
opened on is the proof that nobody does. An older `bd` that has never heard of the flag is
retried without it rather than losing the bead, and `bd update --parent` inherits nothing,
so reparenting was never a second door onto this.

What this is *not* strong enough to be: a container is not protected from `bd close` typed
by hand, and could not be — bd is a separate tool with no hook in it. What it is protected
from is the only ending a dispatched session has. The belt on top of that is already there
and is not this marker's: a delivery refuses to close an **epic** on a merge, and every
standing root is an epic. `node test/container.mjs` covers both layers, the planner's door,
the filing seam — with a fake `bd` that inherits the way the real one does, since the check
that a child is workable was green for three days over a hand-written child that could not
occur — and, the assertion most likely to be "fixed" by somebody tidying, that the Epic
Advocate's door still lets one through.

### The workspace that opens no session — the one thing the card could not say

Every refusal above is a **state**, and every one of them has a sentence on the advocate's
card. Paused says `paused`. Quiet hours says `quiet — watching, not launching`. A full slot
table says `at its limit of 2 session(s)`. Every hold list has a clause of its own and a
pill beside it. Read the card and you know exactly why nothing is happening.

What none of them says is **how long it has been the answer**. The card is one line,
rewritten every thirty seconds and never compared with the one before it, so a workspace
that has been saying the same thing since last month is drawn identically to one that
started saying it a minute ago.

That is not hypothetical. A queue whose every bead had been retired by
`maxAttemptsPerBead` — the state with [no way back on its
own](#a-bead-it-has-given-up-on-says-so) — reported itself as a suffix on that
line, and for 27 days it sat beside a clause that read perfectly healthy. Nothing threw, so
the error filer never saw it. Nothing changed, so no device was ever woken. The daemon was
working correctly and the workspace was dead.

**So the advocate keeps a clock, and the bead is the notification.** At the end of every
tick, for every advocate: was it *free to launch*, was there work waiting, and how long has
both been true with nothing opened? Past `advocates.stallHours` — six by default — it files
one P0 into that workspace's own tracker naming the advocate, the queue length, how many
windows it has open and the retired ids, which are the likeliest cause and the one the card
buried. There is no alerting layer to add a rule to and deliberately will not be one: a P0
lands on the inbox the phone is already polling, carries its own history, and is the same
object that records, afterwards, that the outage was detected at all.

**The clock stops for silence somebody asked for.** Paused, quiet hours, the nightly
maintenance window, switched off — an advocate told to stay quiet is not stalled, and on
this install quiet hours alone are longer than the window, so a clock that counted them
would file a bead against a healthy workspace every morning. Being *busy* is not on that
list: a window here times out at two hours, so six unbroken hours of a full slot table over
a waiting queue means the windows are hung, and the bead says how many are open so the two
are one glance apart.

**One bead per workspace, and it closes itself.** It is found by its own exact title, with
no number in it — a title carrying the queue length would be a different string every tick
and so a fresh P0 every tick. The next tick on which that advocate opens a session, or its
queue empties, or you pause it, closes the bead with the reason on it. An empty workspace
never gets one: a tracker with nothing in it and an advocate doing nothing is an advocate
that is right.

The bead is filed `human` and `card`, which is load-bearing three times over. The one agent
that would work it is the one that has stopped; a window opened on it would reset the very
clock that filed it and be left working a closed bead; and a queueable bead is a bead *in
the queue*, which would make "there is work waiting" true forever and the stall unable to
end. `node test/stalled.mjs` covers the four answers, and most of it is the three that
write nothing.

### The worktrees holding work nobody committed

Everything above is about beads. This one is about the directories a dead session leaves
behind. A worker window that dies before it commits leaves its whole diff in its worktree,
and `lib/tidy.js` — rightly — will not retire a worktree with uncommitted files, so it
leaves them for ever. Nothing said so. Measured on one checkout on 2026-09-19 (bc-iaju1.12):
of 105 live worktrees, 31 had no commits of their own, 28 of those had been untouched for a
week, and 26 were dirty — one with 45 modified files, one holding a whole uncommitted
`lib/surface.js` and two new suites, the oldest 41 days old. The bead each belonged to had
gone back to the queue reading like work nobody had started.

Every `orphanWorkIntervalMinutes` the advocate walks each approved checkout's
`.claude/worktrees/` and names a worktree when **all** of these hold:

- it has **no commits of its own** — nothing in `origin/main..HEAD`. One with commits is
  the [closed-over-a-branch](#the-bead-that-is-closed-over-a-branch-that-never-reached-main)
  case, and its work at least survives on a ref;
- `git status` is not empty, untracked files included;
- **the newest uncommitted file is `orphanWorkIdleDays` old or more** — measured on the
  dirty files themselves, so a `node_modules` symlink or a build directory touched last
  night cannot make a dead session look alive;
- **nobody is in it**: no live `claude` session has it as a cwd, and it is not locked to a
  pid that is still running. A lock whose pid is *dead* does not protect it — that is the
  dead attempt this exists to find — and a lock whose reason names no pid at all is
  honoured, since there is nothing to check it against.

What it says is **one card per workspace**, not one per worktree: twenty-six cards would be
the attention load the improvement review this came from is trying to reduce. The card
lists them biggest first, with the file count split into modified and new, how long they
have sat, the three first paths, and the bead the worktree's name encodes when exactly one
bead does. It asks one question — *salvage them?* — and **salvage is the recommended
answer and does not close the card**: it becomes ordinary work, and a session reads each
diff and lands what is worth keeping. *Let them go* closes it.

**It never deletes, moves, commits or cleans anything**, and must not grow into a sweep that
does — the whole point is that this work is worth reading, not that it is in the way.

The card is found again by its own title, not by a record on disk, and stays true: it is
rewritten when the census moves, closed when it is empty, and left alone while a session
is working it. A card that has been **answered** is not re-asked for the worktrees it
listed — its description carries the names — so *let them go* holds, and only a worktree
that was not on it is news. `flagOrphanWork: false` switches it off.

### The session log, kept in the repo

A session's window closes when it exits, the rendered log in `~/.config/beadcause/`
is per-bead and the next run overwrites it, and Claude Code's transcript lives under
`~/.claude/projects/` — outside the repo, on one laptop. Three months later the
commit is all that is left, and a commit does not say which bead it was, which agent
wrote it, or what it was asked.

So the log goes into the repo, in refs — the same trick beads uses to carry Dolt data
on `refs/dolt/*`. It is worth separating the two halves of that trick, because only
one of them is Dolt's:

- **Transport.** A ref outside `refs/heads/*` and `refs/tags/*` is invisible to
  `git log`, `git branch`, `git status` and `git checkout`, is never fetched or
  pushed unless named, and keeps its objects alive against `gc`. Dolt layers a
  database inside those objects; a log file needs no database, so these are plain
  blobs.
- **Anchoring.** Dolt attaches nothing to a code commit — its history is its own.
  Attaching data *to a commit hash* is what `git notes` is for.

Both, therefore, written when the session exits:

```
refs/beadcause/sessions/<bead>   one commit per session, chained, tree =
                                 meta.json + session.log [+ transcript.jsonl]
refs/notes/beadcause             three lines on each commit the session made — and
                                 on the merge that later lands them in main
```

Read it with plain git, which is the whole reason for storing it this way:

```bash
git log --notes=beadcause main                        # which bead wrote each commit
git log refs/beadcause/sessions/bc-bk6                # every session that worked it
git cat-file -p refs/beadcause/sessions/bc-bk6:session.log
git for-each-ref refs/beadcause/                      # note the trailing slash
```

**`session.log` is a rendering, not the transcript.** It reuses `renderEvent` from
lib/agentlog.js — the same code that draws the live pane on your phone — so one real
session came out at **31KB from a 1.7MB transcript**, which is the difference between
something you can keep forever and something you can't. The raw `.jsonl` is stored
too only where `sessionTranscripts` is on, per repo, because it is megabytes and it
carries absolute paths, environment and whatever tool output scrolled past.

`meta.json` records the branch, the worktree, the outcome, the session uuid and the
commits — plus `commitsFrom`, which says **how** the commit list was decided:
`not-in-main` when the work was still on its branch (exact), or
`since-session-start` when it had already been merged and the only remaining signal
was time (a heuristic, labelled as one rather than presented as fact). A session that
committed nothing gets no landing note at all, since its branch is trivially an
ancestor of main and the note would put its bead's name on someone else's merge.

Two caveats. `git log --all` **does** walk `refs/*`, so these commits appear there and
in some GUIs — everything else ignores them. And nothing is pushed unless you ask:
`git push origin 'refs/beadcause/*:refs/beadcause/*'` and `refs/notes/beadcause` are
explicit acts, and on a shared repo they should stay that way.

**Which run filed a bead — `beadcause-whofiled`.** `created_by` cannot answer this: it
is the git identity of the workspace directory, the same string for every session that
has ever written there (bc-vlv9c). What can is a chain that already exists on every
bead an agent has filed, and it is two hops rather than one: `filed-while:<bead>`
(`lib/filing.js`) names the bead the filer was working, and *that* bead's own archive,
above, carries the session. Assembling it by hand is three commands — `bd show` twice
and a `git cat-file`; this is one:

```bash
beadcause-whofiled -w beadcause -b bc-abc123
beadcause-whofiled -w beadcause -b bc-abc123 --json
```

A filer worked more than once — a stall, then a resumed session — archives more than
one entry, and `lib/sessionlog.js#filerSession` picks the one whose own recorded
window actually contains the moment of filing rather than whichever was archived
last, flagging the answer `exact: false` on the rare entry where nothing's window
confirms it and the nearest archive is the best guess this repo has. A bead with no
`filed-while` label was not filed this way at all (exit `2`); one that has the label
but whose filer bead was never archived — still running, or ended before a commit was
there to archive — is the chain **not closing**, and it says so rather than printing
nothing (exit `1`).

### The agent a session *ending* starts — reading the archive back for repeated work

Every other agent here is started by work. A bead goes ready and an advocate opens a
window on it; a comment arrives and dispatch answers it; a ticket lands and the ingester
decomposes it. The audit agent (lib/sessionaudit.js) is started by a session **finishing**,
and it asks the one question none of the others can: *what did that agent do by hand that
code should have done?*

The reason it is worth an agent is that nothing else was ever going to notice. A worker
session opens by reading its bead, its comments, its debriefs, whatever memory looks
relevant and whatever the last attempt left on the branch — several minutes of the same
reads, done in a different order every time, before a line of the actual work. One session
doing that is a session doing its job. Fifty sessions doing it fifty ways is a command
nobody has written, and the only place all fifty exist is the archive above.

**A finding is a repeated shape, not a one-off**, and the floor is enforced in code rather
than asked for in the prompt — "cite three sessions" is exactly the instruction a model
satisfies by citing three, so a finding whose beads are not among the ones the run actually
read is dropped with the reason recorded. A pattern the library **already covers** is not a
candidate either: it is a *miss*, the command existed and went unused, and the work there
is adoption rather than code. Misses are recorded on the run and nothing is filed for them.

What is filed is one bead per finding, through the ordinary filing seam and therefore
[held](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time) — `unendorsed`,
`agent-filed`, clamped to P2, and workable by nothing until you say so. Each carries the
sessions it was seen in, what the command would take and return, and
**what shipping it would take**: both bin registrations, the `test/<name>.mjs`, the docs
section, and the `Bash(b7e-<verb>:*)` allowlist entry if agents are meant to call it. That
list is written once in lib/sessionaudit.js rather than rediscovered per finding, because
it is a fact about this repo and the registration everybody forgets is the one that stops
the whole test sweep at suite one.

**Candidates land under the skills epic, not under whatever evidenced them.** Every other
agent-filed bead goes under the root the work that found it belongs to
([the filing seam](landing.md#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists)),
which is right for a discovery and wrong for this: a candidate's evidence is whichever
sessions happened to end that hour, so for four months candidates piled up under whichever
epic was busiest — thirty-seven of them across twelve unrelated epics by 2026-08-21, each
counted against a theme it had nothing to do with and each one *ahead* of that theme's own
work in the queue. So this seam names its home rather than inferring it: the open root
carrying `self-started-skills`, which is bc-dgx7, the epic this whole programme is. The
`discovered-from` edge back to the evidencing session is unchanged — that is what the
parent link never was. No such root, and the old rule applies exactly as before.

**Exactly once, from a ledger rather than from memory.** `refs/beadcause/audits` in the
audited checkout is one chained commit per run — `run.json` for what happened this time,
`state.json` for the cumulative answer every later run asks:

```bash
git log refs/beadcause/audits                       # every audit, newest first
git cat-file -p refs/beadcause/audits:run.json      # what the last one read and filed
```

A daemon that restarts has forgotten every audit it ever ran and the ref has not, which is
what makes re-running safe in both directions: a session commit already in `audited` is not
read again, and a finding naming a command already filed is dropped even when somebody
forces a run over the same sessions.

The cost is a `claude -p` reading up to twelve transcripts, so three things bound it, all
config: `sessionAuditEvery` unread sessions have to pile up before a run is worth starting
(five, which is also the scale a repeated shape is visible at), `sessionAuditCooldownMinutes`
is the floor between runs whatever the arrivals, and one runs at a time across every
workspace. The transcripts reach the agent as files in a temporary directory handed over
with `--add-dir` and removed afterwards — never inside the checkout, whose tree a delivery's
dirty guard is watching — because the read-only allowlist has `Read` and `Grep` and no
`git` at all.

It runs as the chat session's foundation rather than a kind of its own. What it needs is
exactly the read-only surface every other reading agent has, and [a new
kind](agents.md#what-an-agent-is--and-how-it-asks-to-be-different) owes five registrations that would each say something
already true of `console`.

**The trigger is a session ending, and a checkout that stops having those is a checkout
this agent stops looking at.** `sessionAuditEvery` is what makes a busy repo wait for a
batch; in a repo that finishes four sessions and then goes quiet, nothing ever pushes the
count past the threshold, because nothing else here ends a session in it. The backstop is
the poll cycle's own look at every checkout of every configured workspace, on its own
clock (`sessionAuditSweepMinutes`, thirty by default — not the fast poll, since asking costs
two `git` reads per checkout and a workspace can hold forty): past `sessionAuditMaxAgeMinutes`
(a day by default), the oldest unread archive is audited *whatever the count*. It is not a
second decision — the bypass lives inside the one function both callers share, next to the
count threshold it widens — and it never widens the cooldown, which still bounds how often an
agent actually starts. Dispatched and never awaited, for the same reason `noteArchive` is:
a run that actually starts can take minutes, and this runs beside the advocate tick and the
merge queue in the same beat.

### Which requirement a change was for — `refs/beadcause/requirements`

Some teams record acceptance criteria as **requirements**: a directory of YAML files in a
repo of their own — a few dozen files and a few hundred ids of the shape `<TOKEN>.Feature.Thing`,
each with a definition and often a link to the Playwright spec that covers it. beadcause
reads them from wherever `requirements.corpus` in config.json says they are, and from
nowhere else: the location is configured, never guessed from the repos it knows about. Nothing
joined that vocabulary to code. JIRA has tickets, beads has beads, git has commits, and
none of the three can answer either direction of the only question that matters here:

- **requirement → files** — what implements `SF.CustomerPortal.HiddenOrders`?
- **files → requirements** — I am about to edit this file; what acceptance does it already
  carry, and which of the e2e suite has to still pass?

The second is the one that changes how a session works, and it is nearly free: the corpus
*already* names the spec against most product requirements, so inverting the first answer
produces the second with no new data at all.

**The id usually does not exist yet, and that is the design constraint.** Requirements get
written down when a ticket ships, so a bead filed on Monday names none — and an agent asked
for one anyway will invent it. A fabricated `SF.CustomerPortal.Hidden` sitting beside the
real `SF.CustomerPortal.HiddenOrders` is two nodes in the graph forever with nothing to tell
them apart, which is the same silent failure lib/edits.js argues about with matching an epic
by its title. So there are three states, all of them normal:

| The AC says | What is recorded | Where |
|---|---|---|
| an id that exists | the id, validated against the corpus | `lib/beadreqs.js`, in the bead's notes |
| something requirement-shaped, no id | a **candidate**: token, name, one definition sentence | the same block, in a separate list |
| nothing requirement-shaped | the bead is labelled `req-glean` at landing, and the Epic Advocate is asked what shipped | `lib/reqglean.js` |

An id is refused at the door if the corpus does not have it — and the refusal is *said out
loud* in the next brief, because an advocate that is not told writes the same invented id
every run and from outside that is indistinguishable from the feature not working.

**The note is the truth and the index is a cache.** At the moment a merge lands,
`noteMerge` already writes to `refs/notes/beadcause`; it now carries the requirement ids and
the files that merge actually changed. That is the strongest evidence this system can have —
not "an agent thought this bead was about X" but "this diff, in main, changed these files
while closing a bead that named X". The lookup index is
`refs/beadcause/requirements/<token>` in the *common* repo (tier 2, because the edge spans
repos by construction: the requirement is in the corpus's repo, the files are in one of
forty service checkouts), one ref per product token so two landings in two products never contend
on one compare-and-swap. Everything in it is rebuildable from the notes, and
`node test/reqindex.mjs` asserts exactly that by wiping the store and rebuilding.

```bash
beadcause-requirements files lib/auth.js     # what these files have carried before
beadcause-requirements show AS.verify        # one requirement, and every commit for it
beadcause-requirements coverage              # how much of the corpus has any edge at all
beadcause-requirements rebuild <repo>        # the repair, and the proof
```

**Edges are keyed on commits, not paths.** A commit is immutable; a path is renamed next
month. Paths ride along and are existence-checked when they are read, exactly as
lib/beadfiles.js checks a guessed path — a dead path drops out of the answer rather than out
of the record, since it was true of that commit and still is. No line ranges: lines rot
within days, and if finer ever earns its place the honest unit is an exported symbol.

**It is a hint and never a gate.** Coverage is partial by construction — an edge exists only
where a merge landed naming a requirement — so `/requirements` leads with the denominator
rather than the list, provenance is kept per edge (`declared`, `observed-from-diff`,
`human-confirmed`) so a forecast is never counted as proof, and no dispatch, hold or edit
path consults the index at all. That last one is asserted at the import boundary in
`test/requirements.mjs`, because it is a property about what is *not* wired up: the first
person to reach for `edgesForFiles` inside a hold predicate has to change that list and say
why. It is lib/beadfiles.js's rule — a guess must not withhold work — applied to something
with considerably less evidence behind it.

**Promotion is a proposal.** A candidate becomes a real requirement only by being written
into the corpus, which is a repo the whole team clones, so the daemon renders the
exact YAML block it would add and a person applies it with
`beadcause-requirements promote <workspace> <bead>`. It refuses an unknown token outright —
a token that does not exist is a question for a human, not a file to create — and it never
rewrites a definition it did not add.

An install that names no corpus has none, every path above switches itself
off, and a landing writes byte-for-byte the note it wrote before any of this existed.

### Reading it back on the phone — `/bead-session`

Storing all of that and then needing `git cat-file` to see it is half a feature. There
was already a page for one session — `/session?pid=…`, its facts and its transcript,
[described above](navigating.md#tap-a-session-to-see-what-it-is-actually-doing) — and it cannot be the
page for this, for a reason that is structural rather than fixable: **it is addressed by
pid.** It resolves a running process, tails the file that process is writing, and 404s
the moment the pid has gone. That is exactly right for a session that exited between the
refresh and the tap, and it is no answer at all for a bead that closed in June. A process
id stops identifying anything the instant the process ends; a bead is the thing that
lasts.

So `/bead-session?workspace=…&id=…` — `/archive` is the same page — is the archived
counterpart, addressed by the two facts that outlive every process that ever worked it.
Three things, in this order:

1. **The memories the session left.** The point of the page: a log says what happened, a
   memory is the session saying what it *learned*, which is the one thing that would
   otherwise have died with the window. `memory.md` in the archived tree.
2. **The log**, with the metrics `meta.json` carries — outcome and exit code, when it ran
   and for how long, its branch, the commits it made, and `commitsFrom`, so an exact
   commit list is never confused with the since-session-start heuristic.
3. **Where its worktree went.** `live` and somebody may be sitting in it, `retired` into
   `.claude/worktrees-retired/` where [the sweep](#emptying-the-attic) removes it two days
   later, or `gone`, which is where a worktree whose work has landed
   is supposed to end up. There is no file browser in this app, so "viewing" it means the
   pull request for its branch where there is one — this page does not promise to render a
   tree. The nuance that bites: **the main checkout is a registered worktree too**, so a
   session that never entered one comes back as `live` under the repo's own name, which is
   true and reads as though a directory had been kept for it. That is carried as `isMain`
   rather than as a fourth state, and the page says which it was.

**Absence is most of the design, not an edge case.** Each of the three is missing
independently and for ordinary reasons: a bead closed by hand from the phone had no
session at all, a session that crashed may have a log and no memory, a session that never
entered a worktree has no worktree to have gone anywhere. Each says the words *"not
available"* with the reason, and offers nothing to tap. That last part is the whole
requirement — a link that opens an empty pane is worse than a sentence, because you spend
the tap before you learn anything.

Which is why the page is **told** what exists rather than finding out by trying.
`/api/bead-session` returns `session.files[]` — the archived tree, listed — and the text
of the log and the memory is fetched from `/api/session-archive` only for names that
listing contained. A section saying nothing is there is stating a fact it was given, not
describing the shape of a request that failed. One local read decides all three, and the
one fact that leaves the machine — the pull request — arrives on a second request *after*
the page has drawn, so nothing on screen waits on GitHub to say that a directory has been
tidied away.

It reads and does nothing else: every request is a `GET`, there is no composer because a
finished session cannot be answered, no button to raise its window because there is no
window left, and **no polling** — an archive commit is a git object, and a second session
on the same bead writes a new one rather than changing this one. A bead worked more than
once gets a row of pills, one per session; the archive is a chain, so going back through
them is `?commit=`.

`test/beadsession.mjs` covers it, and two of its assertions are the ones worth knowing
about: that each section says "not available" for its own missing piece with the other two
still rendering, and that `public/beadsession.js` contains no non-`GET` request at all —
"read-only" being the kind of property that stays true right up until somebody adds a
convenience button.

### Stopping it

Pause from the phone, per repo. `advocates.enabled: false` stops all of them.
Removing a repo from `workspaces` stops that one. A space with `"advocate": false`
vetoes every workspace in it, the same way it can veto auto-dispatch — which is the
setting that keeps applying as you add repos to a shared space, instead of being
forgotten. A quiet space's advocate **watches without launching**: the same asymmetry
as the notifications, where quiet means "not into my evening", never "hidden".
