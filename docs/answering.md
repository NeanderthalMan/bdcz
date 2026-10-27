# Answering — the reply, the close, and what unblocks

## Answering

- **An open card takes the screen.** It used to expand inline, which on a phone
  meant the brief, the thread and the answer box all competed with the list around
  them — a question is read one at a time. Open, a card is `position: fixed` across
  the viewport with the list underneath it, and there is a way out at each end:
  **↑ Collapse** in the top corner, where your thumb already is when the card opens,
  and another at the foot of the brief, where you land after a diagram and a thread.
  Collapsing scrolls you back onto the card you were reading rather than leaving you
  wherever the shrinking list happened to put you.
- **An option answers from the list, in two taps.** A choice tapped on a collapsed
  card arms for six seconds and says so — *Tap again — answers bc-7qo*, or
  *commissions* it where the option hands the bead back as work — and the second tap
  sends that choice's own sentence and closes the bead, without the card ever opening.
  The pocket is covered by the arm, which is the same two-tap shape everything else
  that makes a card disappear uses. **On an open card the same button fills the box
  instead**, still editable and unsent, and the button under the box commits it —
  that is the path for a choice you want to qualify, and **💬 Discuss** under the
  options is how you get to it. A collapsed card carrying a draft takes that path
  too: there are words on it you have not seen since you wrote them, and an answer
  sent from the list would throw them away.
- **Free text**, with *Answer & close* or *Comment only* if you want the question
  to stay open. **Drafts are saved on every keystroke** to localStorage, so
  collapsing the card, opening a doc, a background refresh, or the phone killing
  the tab can't eat a half-written answer. A collapsed card with a draft says
  *Resume your answer* and shows a "draft saved" flag; the draft is cleared only
  once the answer is accepted. **The list never repaints while an answer is in
  progress** — not on the 25s refresh, not when a two-tap arm timer expires.
  Rebuilding it would destroy the textarea, drop focus, close the keyboard and
  reset scroll, which reads exactly like the answer being thrown away. Repaints
  are deferred until the box is empty and unfocused; which option is lit, and what
  the button under the box promises, are painted in place instead.
- **Or set it aside**, under the two buttons — see [Setting a card
  aside](#setting-a-card-aside-is-not-answering-it) below. Two taps like everything
  else that makes something disappear, and the second one spells out what it is
  about to do: *Tap again — hides bc-7qo*.
- **From the notification**, when a question has ≤3 options: ntfy's action buttons
  POST the answer straight to the daemon over the tailnet.

An answer lands as a comment authored by `beadcause` and the bead closes with reason
"Answered via Beadcause".

### Not yet — the third thing an answer can mean

**A card offering "not yet" used to eject itself.** bc-7qo.10 asked which environments
the release agent promotes into, and its third option read exactly as an agent would
write one:

```yaml
- id: park
  label: Not yet — leave it blocked
  hint: Keeps this card on the list.
  closes: false
```

Tapping it took the `human` label off, reopened the bead and dropped the claim — the
commission path, which is right for *build both as written* and backwards for this. The
card fell out of the inbox into `bd ready`, and the next advocate tick opened an
unattended worker window on the question that had just been put off. The hint said
*keeps this card on the list* and the machinery did the opposite of it.

**The two answers are not the same answer and a boolean cannot tell them apart.** Both
leave the bead open; what differs is who has it next.

| the option says | the bead | the `human` label | who has it next |
|---|---|---|---|
| nothing — the ordinary case | closed, reason *Answered via Beadcause* | irrelevant, the bead is closed | nobody, it is settled |
| `closes: false` — a commission | open, unclaimed | **off** | an agent, via `bd ready` |
| `defers: true` — a deferral | open, unclaimed | **on** | nobody, until it comes back to you |

So `defers: true` is `closes: false` **plus** the label staying, and that one write is
the whole difference: the inbox is `bd human list` and an advocate's queue is `bd ready
--exclude-label human`, so it is one fact read from two sides rather than two states to
keep in step. Nothing can open a session on a bead you have deferred.

**And the card is set aside rather than left on the list.** That is bc-y9cof, and it is
the second half of *not yet* — the half that was missing long enough to look like a bug
in the first. A deferral used to leave the card in the inbox with all three options
still on it, so the next sweep drew the identical question with *⟳ You answered this 1m
ago* above buttons still asking to be tapped, and there was nothing on screen to
distinguish that from the app having lost the answer. bc-xl7n.132 was answered *leave it
open until 717 and 719 have merged* and was back a minute later wanting the same
decision.

The fix is not a fourth ending: it is the one beadcause already had. Answering a
deferral writes the same record [*Set aside for now*](#setting-a-card-aside-is-not-answering-it)
writes, so the card leaves the inbox and comes back when its **gate** clears — every
child closed, blockers gone — or, for a bead with no gate, when somebody comments.
*Leave it open until both children merge* **is** that gate clearing, so the trigger the
dismissal picks on its own is the sentence the answer wrote. The toast says which:
*bc-xl7n.132 set aside — back when its open children clear*.

The `human` label still stays on, and now for a sharper reason than "the card stays on
your list". A dismissal record only hides a bead the sweep still returns; drop the label
and the bead leaves the sweep, the record is pruned as stale, and the deferral becomes a
bead that quietly left the inbox with nothing due to bring it back. The label is what
makes a deferral **reversible** rather than a disappearance.

Nothing about the bead moves either way, which is why this is still one flag. `defers`
declares that the option decides nothing and commissions nothing; where the card goes is
beadcause's business, not the tracker's.

**Why the cost of not having it was more than one wrong tap.** Every advocate writing a
card had to give *every* option `closes: false`'s opposite as a workaround, and reason
it out separately each time — bc-7qo.12, bc-7qo.13 and bc-7qo.17 all say so in their own
words. Nobody could offer a *not yet* at all, on any card, which is a tax the whole card
layer was paying for one routing decision.

**A typed answer is never a deferral**, and that is deliberate rather than an omission.
A sentence on a card where a button would have *commissioned* is [not an answer
yet](#a-question-you-have-already-answered-arriving-again) — the words are saved and the
card comes back, because a commission may not be granted on a guess about what a
sentence meant, nor discarded on one. A deferral is excluded from that rule: it starts
nothing, so there is no instruction at risk of being dropped by closing on your
sentence, and counting it would have moved the tax rather than removed it. Tapping is
how you defer; typing still closes.

The thread says which happened, in as many words, because the next reader is an agent
deciding whether it has just been given work: *Left open, and nothing has been handed to
an agent — this answer defers the question rather than settling it or commissioning
anything. The card is set aside in beadcause and comes back on its own when what it is
waiting on has cleared.* The second sentence is there so an agent that finds this bead
open with nothing happening reads it as waiting rather than as dropped. And a deferral
does not lift a [superseded marker](advocates.md#the-duplicate-that-comes-ready-the-moment-its-original-lands), where a
commission does — *not yet* is not *these are two jobs*.

**One surface still gets it wrong, and it is not new.** An ntfy action button POSTs the
option's `response` text and no option *id*, so the server has nothing to look up and
takes the ordinary closing path — which has always been true of `closes: false` and is
worse for a deferral, because a commission at least leaves its instruction on a thread
somebody reads where a deferral just loses the card. It is a notification-wire change
rather than a card change, so it is **bc-7qo.20** rather than part of this: until that
lands, treat a *not yet* offered on a card you may answer from a lock screen as an
ordinary close. The phone, the Mirror and the Slack path all send the id and are fine.

`node test/defer.mjs` drives all four endings against one card: the deferral keeps the
label and the commission beside it still drops it, an ordinary option still closes, and
a typed answer on a card whose only non-closing option is a deferral still closes. It
also drives the set-aside: the deferred card leaves `/api/questions`, its record carries
the bead's gate as the trigger, a gateless bead falls back to the comment count with the
answer's own comment already counted, and a `bd` that cannot be read leaves the card
visible rather than hiding it on a promise nothing kept.

### Close it, once this lands — a fourth thing a commissioning option can mean

**bc-eqn1.5.2.** Adam answered "Close it" on an epic — bc-eqn1.5 — whose commission also
listed work to do: re-parent a child, hand a residual acceptance elsewhere. So the option
had to carry `closes: false` like any other commission, and the fact that the *verdict*
was close had nowhere to land. The three writes a commission makes — a comment, the
`human` label off, reopened and unclaimed — say nothing about it. Once the commissioned
pull request merged, the merge queue's own rule for an epic ("an epic closes when its
theme is done, not when a branch sharing its name merges") left it open on purpose, and
the finished-epic sweep asked the identical question a third time the moment its children
cleared.

An option may say this too:

```yaml
- id: close
  label: Close it, move the rest elsewhere
  response: "Close the epic. Re-parent the child, hand the rest to the review, then close it."
  closes: false
  closesOnLanding: true
```

`closesOnLanding: true` is not a fifth kind of answer — the bead ends up exactly where an
ordinary commission leaves it, open and out of the inbox, unclaimed. What it adds is
`ANSWERED_CLOSE_LABEL` (`answered-close`, `lib/answeredclose.js`), the one thing nothing
else here writes down: that the eventual verdict, once the commissioned work is actually
in, was close. The merge queue's epic branch reads it back the moment that pull request
lands — if the epic has no open children (or an approval hold, or an unapplied `Adopts:`
line — the same gate any other close is asked, `Bd.gateFor`) it closes the epic, quoting
what was actually answered, instead of writing the stays-open comment. The finished-epic
sweep treats a marked epic as already answered and does not draw a second card over the
same verdict — the fallback for a merge that happened some other way, never a licence to
ask a third time.

`node test/mergequeue.mjs` pins the merge-queue half: a marked epic with no open children
closes on the commission's own pull request landing, quoting the answer; the same marker
on an epic the gate refuses (an open child, say) still falls back to the ordinary
stays-open carve-out — the marker tells the queue to *act* on a verdict already given, not
to skip asking whether it is actually safe to. `node test/commission.mjs` pins the write:
an option carrying `closesOnLanding: true` gets the label beside the ordinary commission
writes, and an ordinary commission never writes it.

### Setting a card aside is not answering it

**Dismissing closes nothing.** It used to — comment the reason, then `bd close
--reason "Dismissed via Beadcause"` — and that was the wrong shape rather than a
broken one. It read like the tracker's own `bd human dismiss` and it passed its
tests. What it could not survive was the card you most want gone: an **epic with
thirty open children**, which bd flatly refuses to close. Three taps, three
duplicate comments, no dismissal.

The fix was not to make the close work. *"I am not dealing with this now"* is not
*"this is decided"*, and closing the bead to clear the card throws away the thing it
was tracking. So the acknowledgement lives in beadcause's own state, keyed
`workspace/id`, and the tracker never hears about it:

| you typed | what bd is told |
|---|---|
| nothing | **nothing at all** — bd has no idea it happened |
| a note | one comment, verbatim, no wrapper — and no close |

The note is a comment rather than a close reason because an agent watching the
thread reads comments; a close reason is a line only `bd show` prints. And it is
recorded **verbatim**: the bead is not dismissed, you are, so an agent should see
what you wrote rather than a status word beadcause invented.

Dismissing still consents to nothing else. No proposal is created, no amendment
committed, no pull request merged or declined, so a dismissed delivery leaves its PR
open on GitHub. It no longer records a *refusal* against an agent's amendment
request either — that was bookkeeping a close owed, and setting a card aside decides
nothing to record.

#### What brings it back

A card that never returned would be the silent loss this whole app exists to
prevent, so every dismissal is stored with the condition that ends it, decided once
at the moment you dismiss rather than re-derived on every sweep:

| the bead | comes back when |
|---|---|
| an **epic** with open children | every child is closed |
| **blocked** by open dependencies | every blocker is closed |
| anything else | somebody comments on it |

The first two are the same question the answer path's gate asks, which is why they
share `closeGate` — the moment a bead stops being un-closeable is the moment it
stops being a question's *future* and becomes a question. The third is the honest
fallback: nothing about an unblocked bead will change on its own, so a new comment
is the only trigger there is. The toast says which, because a card that vanishes
under the word *Dismissed* reads as gone for good.

The recheck costs one `bd show` per dismissed bead per sweep, and only for beads
still in the inbox — a handful, usually none. A bead that has left the sweep was
answered or closed elsewhere, so its record goes with it rather than accumulating.

#### More than one at a time

One tap per card is fine for the card in front of you and is not a way through a
backlog. Measured on 2026-09-19 the inbox held **58 open questions with a median age
of 26 days**, and nothing on the screen could act on two of them at once.

So a card on the **Questions** view carries a tick, hard left of its top bar, and
ticking anything puts a bar over the list: *N cards selected*, **Set aside N**, and
**Clear** (bc-iaju1.5). It is the endorsement queue's bar and the endorsement queue's
tick, in the same classes — two lists you tick rows in should not be two controls that
look nearly alike.

The bar **arms**, where /endorse's does not, and the difference is the act rather than
the count: endorsing is idempotent and the worst a stray tap does is queue work you
meant to queue eventually, where setting a card aside takes it off the screen until
something else moves. The armed hint says what it will not do — nothing is closed,
nothing is answered, and anything typed into a card is left where it is.

Underneath it is **one request per bead, to the same `/api/dismiss` a single set-aside
uses**. There is no bulk route, deliberately: a dismissal writes beadcause's own
record, puts a typed note on the thread, drops every other device's notification and
settles the Slack message, and a second plural implementation of all that would be five
things to keep in step instead of one. `bd` is a single Dolt writer anyway. No reason
is sent — one sentence about eleven beads is a sentence about none of them, which is
the same argument the group revoke on /endorse makes — and a card that needs a word
gets it by being opened.

It reports as it goes and never says a flat *done*: *Setting aside 3 of 11…* while it
runs, then the count and the first thing that did not work. A bead whose write was
refused comes back where it was, wearing the same red note a single refused set-aside
leaves, and **stays ticked** — so pressing the button again is the right move rather
than a guess about which nine of the eleven went through.

Only rows that offer a single set-aside can be ticked. A bead **held for endorsement**
cannot: the decision there is an endorsement and it is made on /endorse, which is also
what the count row at the top of the *Held* half links to. Neither can a JIRA ticket,
which has no bead of its own to set aside.

`node scripts/dismiss-check.mjs` holds the interaction to its promises in headless
Chrome at phone size: that one tap writes nothing, that the arm expires and any
other armed control steals it, that the note reaches the wire as a `reason` and
never as a `response` — a dismissal read as an answer would be read for markers, and
`MERGE:` in the box would merge a pull request you meant to walk away from.
`node test/dismiss.mjs` is the other end: the argv `bd` actually receives, pinned so
that a wordless dismissal stays a no-op and nothing here drifts back into being a
close. `node test/closepaths.mjs` is what keeps answering and dismissing from being
confused for each other again.

### When bd will not close the bead

*Answer & close* is two writes, and only the second one has a gate on it. bd
refuses to close a bead **blocked by open dependencies**, and refuses to close an
**epic with open children** — both with a sentence and a `--force` you are not
being offered here.

That used to arrive as a failure. The comment went in first, the close threw, and
the whole answer came back to the phone as a red toast over a question that had in
fact been answered. The card stayed in the inbox looking untouched, so it got
answered again — five beads across two workspaces ended up carrying the same
answer two and three times over, and one of them says *"Do your best"* four times.

So the refusal happens **before anything is written**. The server asks the two
questions bd would ask — the `blocks` dependencies that are still open, and, for
an epic only, the children that are still open — and answers with a `409` carrying
the reason and the beads behind it. Nothing is commented, nothing is created, and
the question is exactly as answerable as it was a moment ago.

What you get is not an error. The card comes back with the reason on it, the
blockers named and linked into the graph, and the offer: **Save as a comment**,
which is the half that was always going to work. Three things about it are
deliberate:

- **The note lives on the card, not in a toast.** A toast is gone in three
  seconds, and the one conclusion that must never be reached here is *the answer
  was lost*. Your draft is still in the box underneath for the same reason.
- **It is amber, not red** — the same `--warn` as the unfinished mark down a
  card's edge. Something is incomplete and waiting on you; nothing went wrong.
- **Saving goes down the ordinary comment path** — same endpoint, same
  `human-replied` label, same agent dispatched. What you typed is a reply on a
  thread, and the only thing the tracker refused was the closing of the bead.

There is deliberately **no force-close**. "Close this epic over its 24 open
children" is not a decision to take from a lock screen, and a `force` flag that
skipped the check would only reach the same refusal from bd a moment later, since
`respond` does not pass `--force` either.

#### Exactly which beads — and the two that read backwards

Inventing a gate is the worse of the two failures here and the silent one: a bead bd
would close happily becomes unanswerable from the phone, and nothing anywhere says
why. So the rules are measured against the binary rather than described from memory —
`test/closegatereal.mjs` builds each shape below in a throwaway workspace and asserts
that what beadcause answers and what `bd close` then does are the same answer — except
for the two **epic** rows at the bottom, which are beadcause's own rules and are asserted
there as disagreements on purpose. Against bd 1.2.1:

| the bead | bd | beadcause |
|---|---|---|
| an **epic** with a child not closed | refuses | refuses |
| an **epic** whose children have all closed, or has none | closes | permits |
| a **feature**, **task**, **bug** or **chore** with open children | refuses | refuses |
| **blocked** by a `blocks` dependency not closed | refuses | refuses |
| a `related`, `parent-child` or `discovered-from` edge, open | closes | permits |
| a **blocker** closing while what it blocks stays open | closes | permits |
| an **epic** with an unapplied `Adopts:` entry | **closes** | **refuses** |
| an **epic** closed with a merge as the reason | **closes** | **refuses** |
| a **work bead** closed with a merge as the reason | closes | permits |

Two things there are worth saying out loud:

- **The open-children gate is on every parent since bd 1.2.1, not only on epics.** It
  used to be the word `epic` alone — a feature, task, bug or chore closed over as many
  open children as it liked — and `bc-5864` was filed on exactly that: `bc-rk2o`, a
  feature, was closed by `bin/deliver.js` while `bc-rk2o.1` was still open, which read
  as bd permitting a close the gate would have refused. It had not — `bc-rk2o` is a
  feature, bd 1.1.x agreed with the gate, and the evidence was misread. bd 1.2.1 then
  widened its own rule to `N open child issue(s); close children first or use --force`,
  whatever the parent's type, and `gateFor` was widened to match, measured against the
  real binary (bc-xl7n.39; `test/closegatereal.mjs` pins both parent types). So the row
  above is agreement now, not the surprise it used to be — a feature or task with open
  children refuses exactly like an epic does.
- **Not-closed is what counts, not open.** `in_progress` is a child a session is
  working on right now, and `deferred` reads as *settled* everywhere else in this app.
  Neither is closed, so both still gate — on a child and on a blocker alike.

And the delivery path does not ask this question at all, which is agreement rather
than a second opinion. `bin/deliver.js` attempts the close and handles the refusal —
it records it for the daemon to retry (`lib/owed.js`) and says so on the bead in bd's
own words — because by then the merge has already happened and a refusal has somewhere
to go. A tap on a card has nowhere: it is about to write a comment it cannot take
back, so it asks first. Same rules on both paths; bd is the thing refusing in both.

##### One refusal is stepped over, and only one

bd 1.2.1 added a guard that refuses a close when the bead's **assignee is not the
actor**. That is the ordinary state of every delivered work bead: a worker is told to
`bd update --claim`, which sets the assignee to its git identity, while everything
beadcause runs carries the `beadcause (…)` byline so `created_by` says which machine
filed it. The two strings differ. From the moment the upgrade landed, **no delivery
could close the bead it had just merged** — and the symptom was quiet rather than loud,
because an open bead that is still *assigned* is skipped by `bd ready`, so nothing
crashed and nothing re-opened. The tracker simply filled with work that claimed to be
in flight hours after it had landed, and `owed-closes.json` retried the identical
failing command every poll cycle forever. That is bc-9d37.13.

`--force` clears it. It also clears open children, live blockers and the epic gates,
which is why it is never simply passed: the close is attempted exactly as before, and
`--force` is reached for **only when the claim guard is what refused** (`isClaimGuard`
in lib/bd.js, matched on *assignee is* and *actor is* together — two of bd's other
refusals also end in "use --force to override" and must not match). A close refused by
a blocker does not force, stays owed, and is retried when the gate clears, exactly as
it always was.

Five call sites opt in, and they are the ones where **a merge or a ship is the
evidence**: `bin/deliver.js`, the Merge tap in `lib/server.js`, `lib/landed.js` when
GitHub reports the branch merged, `lib/release.js` when the build is live, and
`lib/owed.js` retrying any of them. Closing a *question* is not on that list — a card is
answered, not delivered.

The alternative was to reclaim first (`bd update --assignee ''`, which also works).
It is not used **here** because it rewrites the assignee on every delivered bead, so the
tracker would permanently forget who did the work. A closed bead keeping its worker's
name is worth more than a guard the merge has already satisfied.

##### The question is the sixth path, and it reclaims instead

Ruling a question out of those five was right about the evidence and left the answer
path refusing. Adam hit it the same morning, on bc-jrvh: the comment is written *before*
the close on purpose — so an answer survives a Dolt lock — and here that guarantee
inverted. The answer landed, the close threw, the card stayed in the inbox looking
unanswered, and it got answered again. That bead carried the same answer three times
over four comments. **bc-ko7n**, and `Bd.closeAnswered` is the fix.

**It reclaims rather than forcing, and the trade is genuinely the other way round from a
delivery's.** The objection above — reclaiming forgets who did the work — is decisive on
a work bead and empty on a question. A card's assignee is an artifact of some worker
window having touched it; nobody claimed a question in order to own it, and `bd ready`
skipping it is the whole of what that claim was doing. So the narrow instrument is
available: dropping the assignee lifts exactly the rule in the way, where `--force`
would lift the blocker and epic gates with it. Same shape as the five otherwise — the
close is attempted as it always was, and the clear happens only when `isClaimGuard`
matches, so an unclaimed question is never written to on its way out.

**The gate is deliberately not taught this refusal.** `Bd.gateFor` is what the phone
draws a card from and what `lib/landed.js` and `lib/owed.js` skip on; a branch there for
something both paths now recover from would make every bead any session ever claimed
read as unclosable. That is the *inventing a gate* failure `test/closegatereal.mjs`
exists to catch, and it pins the agreement instead: the gate stays silent, and the close
goes through.

What stops a duplicate answer next time is `Bd.answerOnce`, not the gate. Comment-first
means *any* failure after the comment leaves a card that will be answered again, so
`respond` and `commission` skip a comment that is already the newest thing on the
thread — the repeat finishes the close rather than saying the same sentence twice. Only
the newest, and only an exact match: the same words six comments up are a real answer,
and `lib/answered.js` is what tells you about that on the card.

##### And a zero exit is not a close

Everything above is about a refusal — a sentence on stderr and a non-zero exit, which is
something a caller can read, log, owe and retry. **bc-q6qc is the case where there is no
sentence at all.** `bc-3muu.12` merged as #339, took the comment `finish` writes
immediately before its close, and sat `in_progress` for a day. There was no `[bd] …
closing over the claim guard` line, so nothing forced; no `[merge-queue] … but the work
bead did not close` line and an empty `owed-closes.json`, so nothing threw. All three are
written by code either side of that one call, and their absence is the measurement: `bd
close` came back **0** and the row did not move. The merge-queue card said `merged 1`,
the bead carried a comment saying it had merged, and the bead was open. That is bc-ec6's
failure class — every layer reporting a close it never had — and it is the expensive one,
because an assigned open bead is skipped by `bd ready`, so nothing crashes and nothing
re-opens; the tracker just fills with landed work that reads as in flight.

So the close is **asked about** rather than assumed. `Bd.assertClosed` reads the row back
after every close — the plain one and the forced one alike — and throws if the bead is
still live, which turns the invisible ending into the one all five call sites already
handle: logged, written to `owed-closes.json`, and said on the bead in bd's own words. One
`bd show` per merge is the whole price. `bin/deliver.js` carries the same check because it
is a separate process shelling out to `bd` synchronously, and imports `LIVE_STATUSES` from
lib/bd.js rather than restating it, so the two cannot disagree about what counts as open.

**The sixth path — the answer — deliberately does not have it yet.** Not because the lie
would be smaller there but because the *consequence* is: a question whose close silently
did not happen stays in the inbox with its answer on the thread, which Adam sees within
the hour and which `Bd.answerOnce` and `lib/answered.js` are both already built to
survive, where a delivery's failure is invisible by construction. What it costs to change
is honest fixtures in five suites whose fake `bd` serves a fixed row still reading `open`
after closing it — which is worth doing, and is `bc-2uj4.8` rather than a doubled diff
here.

Two things it deliberately does **not** do, and both are the same instinct as the rest of
this section:

- **It never forces.** A refusal bd can explain buys a `--force`; a close bd said nothing
  about is a close nobody can explain, and forcing would be a guess that also lifts open
  children, live blockers and the epic gates. A silent non-close leaves as an *owed*
  close instead. Closed, or loudly owed — never silently open.
- **It fails towards believing the close.** A tracker that will not answer the `show`, a
  row that has been renamed away, a status this codebase has never heard of: none of
  those is evidence that the close did not happen. `LIVE_STATUSES` therefore names what
  is **open** rather than what is done, because bd's done state is configurable and a
  list of closed words would read a workspace using its own as an open bead — turning
  every successful close there into a landed bead retried out of `owed-closes.json`
  every thirty seconds for ever. An unfamiliar status reads as closed, which can only
  ever miss this bug rather than invent it.

The bead also proposed widening `isClaimGuard` to bd's other wording for a held claim —
*held by "…" (in_progress); coordinate with the holder* — on the theory that a close had
come back that way. **It had not.** Measured against bd 1.2.1: a close refused over a
claim says *assignee is / actor is*, whether the bead is flat or dotted, whether it is a
child of an epic, and whether the lease is live or six minutes expired; the *held by*
sentence belongs to `bd update --assignee`, which is a reassign and not a close. The
alternation is in the regex anyway, anchored on `cannot close` and on a quoted holder
followed by `(in_progress)`, because it costs nothing and this exact sentence has already
been reworded once (bc-9d37.12) — and because so anchored it cannot reach any of the
refusals `--force` must never be reached for. `test/closeverify.mjs` pins both halves.

The last three rows of the table are the exception to every sentence above — the two
where beadcause refuses what bd closes, and the one underneath them that says what is
*not* refused — and the section below is about them.

#### An epic does not close because a branch that shared its name merged

Two of the rules are beadcause's own, and bd disagrees with both. `test/closegatereal.mjs`
asserts that disagreement as deliberately as it asserts the agreements — the same
workspace, the same real `bd close`, and a case that passes only when the binary closes
what beadcause refused.

They exist because of a measurement taken on 2026-08-13, on a graph of 792 issues.
**Seven epics carried an `Adopts:` line naming ninety beads between them, and not one of
the ninety was ever reparented.** The line was prose in a description: nothing read it, so
`bd list --parent` said the epics had no children and `bd close` had no objection to any
of them. Six of the seven then closed on their own pull request merging, with sixty
adoptees still open — `bc-ka5y` is the clearest, twenty-three adoptions and a close reason
reading *Merged #212 as 72789c0b into main*. Every classification lost that day was lost
by an epic closing, not by anyone deciding the grouping was wrong.

So:

- **An epic with an unapplied `Adopts:` entry cannot be closed.** A bead named on that
  line counts as a child for the gate before the adoption is applied, and whatever its
  status — an entry nothing applied is a piece of structure the close would destroy even
  where the bead behind it has since finished, because nothing then records it was ever
  part of this theme. The refusal names the entries and says what to do: adopt them, or
  drop them from the line. `lib/adopts.js` is the parser, and it stops at the first token
  that is not an id — the paragraph *under* a list names beads too ("bc-297u and bc-syzm
  are the same bug filed twice") and those are explained, not claimed.
- **An epic cannot close on a merge reason.** *Landed as #42*, *Merged #212 as 72789c0b
  into main* — a pull request is evidence that a diff landed and no evidence at all about
  whether a theme is finished, which is the only question an umbrella epic answers. A
  work bead closing on exactly those words is the ordinary, correct case and is untouched.

The rule is matched on the **sentence** rather than taken as a flag from the caller, and
that is what makes it hold: `lib/owed.js` retries a refused close minutes later with
nothing in hand but the stored reason, so a rule living in the callers would be walked
around by the retry and by every record already in `owed-closes.json`. A merge-reason
close owed on an epic is the one *terminal* refusal in that file — dropped rather than
retried, because no amount of waiting turns a merge into evidence about a theme.

All four doors are wired, which they have to be or the rule looks broken exactly when
Adam happens to merge that way:

| door | what happens now |
|---|---|
| a tap on a delivery card (`lib/server.js`) | since bc-xl7n.135 it admits the pull request to the merge queue rather than merging; the epic guard lives on the queue's own merge, in `lib/mergequeue.js`'s `finish`, which calls `finishWorkBead` the moment it actually lands one |
| the PR board's **Queue to merge** (`lib/server.js`) | the same, and for the same reason (bc-02ldo): it does not close anything either — the tap admits the pull request to the queue, and the queue's own merge is where the close happens |
| a worker's own `beadcause-deliver` | merges, prints `landed #n`, comments, and says on stderr that the epic stays open |
| the sweep that notices a merge on github.com (`lib/landed.js`) | reports the epic as a skip, and writes nothing to it |

**bd itself still closes an epic over both**, and cannot be taught not to: it has no
pre-close hook — `bd hooks` installs git hooks and nothing else — so `bd close bc-ka5y
--reason "Merged #212"` typed at a terminal goes through. That is the honest limit of
this. Which is why the rule sits on every path beadcause closes through rather than in
one place, and why `scripts/land-check.mjs` presses the real `bin/deliver.js` against a
real tracker with a real epic: a refactor that lost the rule would pass every unit test
that models it and fail there.

#### And the entry it is held over is applied on the tick

A refusal that can only be answered by hand is a refusal that gets walked around. The
gate above says *adopt them or drop them from the line*, and until bc-arj0.2 "adopt them"
meant a person typing `bd update <bead> --parent <epic>` once per bead — ninety of them
on the day the measurement was taken. So the daemon does it: `lib/adoptsweep.js` runs in
the poll cycle, reads each epic's list off the same `bd export` the epic board is already
built from, and reparents what it names. **The list is the contract; the edges are the
machine's job.** Write the line, wait a tick, and `bd dep tree` draws what the prose says.

It runs **before the advocate tick**, which is the whole of the placement argument: the
advocate reaches an epic's work through its children, so an epic whose list has just
become edges dispatches as an epic with children on the same beat rather than the next.
It costs the write lock ahead of the tick and nothing else — a settled graph writes
nothing, and after the first pass over a workspace that is every pass.

**Applying it is one line of code; the refusals are the feature.** Each is a case
where the write would destroy something somebody decided on purpose, and a daemon on a
thirty-second clock is the wrong thing to be deciding those:

| the entry | what happens | why |
|---|---|---|
| names a bead with no parent | **adopted** | the ordinary case |
| names a bead that is already its child | nothing | already applied |
| names a bead with a *different* parent | **refused**, naming the parent | somebody decided that; a line in a description is not evidence they were wrong |
| names a bead already linked to this epic by any other edge | **refused**, naming the type | bd holds one edge per pair, so applying it means deleting the other — and `discovered-from` is where the bead *came from*, an older fact than who claims it |
| …except a `relates-to`, which is **replaced** | adopted, see-also dropped first | see below |
| named by **two** epics | **refused for both**, each told about the other | there is no answer here that is not a judgement, and the order bd exports two rows in is not a way to pick one |
| names an id no bead here has | **refused** | a typo, or another workspace's prefix — and the gate's sentence on the phone is how a typo gets found |
| written on a closed epic, or on something that is not an epic | nothing | a closed epic's list is a record, and moving live work under a closed parent is how a bead becomes held and invisible |
| would make the epic its own descendant | **refused** | bd refuses it too; asking is what costs the spawn |

The `relates-to` exception is not a nicety — without it this applies **nothing** on any
graph beadcause has been running against. Writing a description through beadcause runs
[the mention hook](inbox.md#every-bead-id-in-prose-is-an-edge-behind-it) over it, and the ids in an
`Adopts:` line are bead ids in prose, so an epic filed through beadcause's own seam
arrives already see-also'd to everything it adopts — and every adoption is then refused by
the row above it, forever, with the close gate holding the epic open over a list that can
never be applied. Replacing it loses nothing, which is the argument: a see-also claims
only *mentioned near*, and a parent link says that and more. `test/adoptsweepreal.mjs`
asserts the hook really does draw it, so the rule cannot quietly become dead code.

A refusal is a standing condition rather than an event — *bc-4bet cannot adopt bc-d5sv:
already a child of bc-xl7n.1* is true on every beat until somebody arbitrates it — so it
is logged on the beat it appears and on the beat it goes away, the way a sync failure is,
and not once a cycle. The phone hears about it through the gate: the epic will not close,
and the refusal names the entries.

**What proves it is the round trip, not the write.** Three files written at different
times have to agree — `lib/adopts.js` reads the line, `lib/adoptsweep.js` applies it,
`Bd.gateFor` refuses the close over an entry that is not a child — and the failure that
matters is not any of them being absent but two of them disagreeing, which is an epic held
closed over an adoption nothing believes in and no way to fix it from a phone.
`test/adoptsweepreal.mjs` therefore closes the loop against the real binary: write a list,
sweep once, and the gate lets the epic go. `test/adoptsweep.mjs` is where the refusals
live, over fixtures, because a rule that can only be tested by writing to a tracker is one
nobody re-tests after changing it.

**And the sweep will not plan against a reading it could not take.** The plan is built
from `Bd.graph`, which is one `bd export` cached for a minute, and an export that fails is
answered with the *last good* index rather than with nothing — the right answer for
everything drawing a screen, and the wrong one for the caller that turns an index into
`bd update --parent` writes: an epic filed since that reading is simply not in it, so the
sweep plans nothing for it, applies nothing, refuses nothing and says nothing, which from
the outside is a tick with no work to do. The stand-in now carries `stale` (`error` still
means *never read at all*), the sweep skips a workspace carrying either and logs which,
and the cache entry it fell back on keeps its own age rather than being stamped fresh —
a failed read used to buy the pre-failure graph another sixty seconds with no retry in it.
That was bc-j52g, and one lost export was a red `test/adoptsweepreal.mjs` about one run in
four on a loaded Mac. `test/graphstale.mjs` pins all of it against a fake `bd` that answers
once and then stops.

### The best refusal is a button that was never there

Refusing before anything is written fixed the damage. It did not fix the shape:
you still opened an epic with thirty open children, read it, typed a paragraph,
pressed **Answer & close**, and *then* learned the tracker was never going to
allow it. That is a lot of work to be told no, and on the beads it happens to —
the epic that is a whole feature's worth of children — it happens every single
time.

So the card asks when it **opens** instead. `/api/question` already does a
`bd show` to build the detail; it now runs the same gate check off that record and
sends the answer with it. Free for anything that is not an epic, because the
blockers are on the record already; one `bd list --parent` for one that is.
Deliberately **not** on `/api/questions` — there it would be a child list per epic
row on every 25-second poll, for cards nobody has opened.

Knowing it, an open card on a gated bead **draws no *Answer & close* at all**.
What is in its place:

- **Comment**, promoted to the primary button, because it is now the only thing
  the box does. The placeholder changes with it — *Say something on the thread…*
  rather than *Answer in your own words…*, which would be inviting a decision the
  screen cannot record.
- **A dashed amber note** where the button would have been, naming the reason and
  linking the children into the graph. Quieter than the `409` note above it —
  dashed and unfilled, with no buttons — because nothing has gone wrong and
  nothing is waiting on you: it is a fact about the bead, and the buttons on the
  refusal note exist only to rescue words you had already typed.
- **Set aside**, unchanged. It closes nothing, so it was never gated, and the bead
  you can least close is the one you most want off the screen.

The `409` path stays exactly as it is, and is now the rare one: what reaches it is
a gate that appeared **between** the card opening and the press — a child reopened,
a blocker filed while you were reading. That window is real, so nothing about the
server-side check is relaxed on the strength of the card having asked first.

One known limit, deliberate: a **proposal's Create-all** also closes the bead and is
still drawn on a gated card, falling back to the `409` note when pressed — hiding it
would leave a proposal with no visible way to approve it. And a **delivery** keeps its
three buttons, because those are about a pull request rather than about the bead.

A **decision block's option buttons** are on that list again, but only on the half of
them that sends. Tapped on an **open** card they still write into the answer box and
close nothing, so on a gated card a choice fills a box whose only button is *Comment*
— the choice reaches the thread, the bead stays open because it was always going to,
and nothing has to be refused to say so. Tapped on a **shut** card they answer and
close, and there the gate is simply not known: it is asked when a card opens and
deliberately never on the list poll, so this is the one path that finds out from the
`409`. It is built to survive that. The option's words go into the draft *before* the
write leaves, so the refusal hands the card back open with the note above the box, the
sentence still in it and the choice still lit — the same place the open card would
have started from, reached the long way round.

### What is gated, and what is deliberately not

The gate belongs to **closing**, and only one of the three ways out of a card
closes anything:

| | closes the bead? | gated? |
|---|---|---|
| **Answer & close** | yes | yes — and not even drawn when the card knew in advance |
| **Comment only** | no | no |
| **Set aside** | **no** — see [above](#setting-a-card-aside-is-not-answering-it) | no |

Dismissing briefly *was* gated, and that was a mistake worth recording: it made the
card bd would least let you close also the card you could not get off your screen.
Fixing the answer path and then applying the same fix to dismiss looked consistent
and was exactly backwards — the two acts are not the same act, and gating both is
what proved it.

The one close that is deliberately **not** gated is the work bead a merged pull
request finishes — with one exception, below. That one is already `.catch`-ed and
logged: the merge has happened by then, and failing the request over a bead that
would not close would be reporting the merge as a failure.

### The one law — no agent closes a gate

**Agents draft, Adam approves, and no agent closes a bead carrying a label the workspace's
approval pipeline names as human-only — in practice a gate, or a bead waiting to be
approved. The tap is the close.** The first workspace to declare an approval pipeline had
written this into its own charter three times, and nothing read any of them.

Until `lib/approval.js` existed beadcause had no idea what a gate was. So a gate bead came
up `bd ready` like any other bead, an advocate opened an unattended window on it, and that
session ran its ordinary ending — which closes the bead the window was opened for.

**It has already fired.** One delivery closed an epic over six open children, four of them
gates, and that workspace's status board then reported a gate met and the next ones
unblocked, on a lie — the exact silent failure the rule exists to prevent.

#### Which labels — the workspace's declaration

beadcause ships no gate vocabulary. The labels are declared per workspace in `approval` in
the config on this Mac — `labels.review`, `labels.gate`, `labels.gatePrefix`,
`labels.draft`, `labels.revisionPrefix`, and `humanOnly`, the list this rule holds (the gate
and review labels when it is left out). A workspace that declares none holds nothing, and
the rule is dormant there. It is deliberately **not** declarable in a repo file the way a
relay is: a rule a branch could delete is not a rule. The full shape is in
[Where the ruling is](landing.md#where-the-ruling-is--the-second-axis-beside-the-pull-request).

#### What is held, and what deliberately is not

The **bare** gate label means *I am a gate*, and the review label means *a person has still
to judge this*. The gate prefix — `milestone:G0`, say — means *I count towards G0* and is
an ordinary deliverable with an ordinary ending: the beads under a gate are exactly the
work that moves it, and holding those would stop the ladder rather than protect it. So the
match is on the whole label, and a `startsWith` here would be wrong in the one way that is
expensive to notice.

The pipeline is read in one place — `approvalPipeline` in `lib/approvallabels.js` — and
`lib/approval.js` (this policy) and `lib/approvalcard.js` (the display) are both handed
what it returns, so the vocabulary cannot drift between the rule and the chip.
`test/approvallabels.mjs` pins that none of the three files spells a label of its own.

#### It is a rule about the close *reason*, not a hold on the bead

The obvious shape is the one `unendorsed`, `ship` and `container` already use — a
filter plus a refusal, so the bead is in no queue and cannot be worked at all. That
was on the table as lm-8o5's other option and it is **not** what was decided, for a
reason easy to lose: a gate is not unworkable. Evidence gets gathered against it and
notes get written on it; only the close is anybody's but Adam's.

And a blanket refusal would break the half of the law that matters most. *The tap is
the close* — when a gate is genuinely met, the close is a tap on the phone, and the
phone asks `Bd.gateFor` whether that close would be refused before it draws the
button. A rule that refused every close would take the button away and leave a gate
nothing on this machine could ever close, silently, because the card would simply
render without it.

So the refusal keys on the **sentence the close would carry**. `isMergeReason` already
identifies the three a merge writes — `Landed as #42` from a worker's own delivery and
from the tap on a delivery card, and `Merged #212 as 72789c0b into main on GitHub` from
the sweep that notices a merge made on github.com — and every automated close of a work
bead in this program carries one of them. A close Adam asks for by name carries none,
and goes through untouched. It is the same shape, and the same argument, as
[an epic not closing on a merge](#when-bd-will-not-close-the-bead): here it is stronger,
because a merge is not merely poor evidence about a gate, it is not the gate's evidence
at all.

#### Wired to every door, because a merge arrives four ways

| where | what it does |
|---|---|
| `Bd.gateFor` (`lib/bd.js`) | the funnel for the daemon: the tap on a delivery card, the sweep that notices a merge on github.com, and the retry minutes later |
| `lib/owed.js` | drops the record rather than retrying — nothing about waiting turns a merge into an approval, and `owed-closes.json` may hold a record written before this rule existed |
| `lib/mergequeue.js` | merges, comments, and leaves the bead open — written out beside the epic branch it already had, because this path does not ask the gate |
| `bin/deliver.js` | a separate process shelling out to `bd`; it merges first and handles the refusal, and it already checked the merge-reason half itself |
| `lib/session.js` | the other half of the answer: the worker's brief **states the law in words**, so a refused session reads the ending as the work finishing rather than as something to retry |

The brief matters more than it looks. A session refused by a rule it was never told
about does not stop — it re-runs the delivery, files a bead about the tracker being
broken, or closes the bead by hand at a terminal, which is the one route the code
cannot cover. lm-vry was answered *both* for exactly that reason: the brief states
it and the code holds it, so a brief that drifts cannot silently reopen the hole.

**What this is not strong enough to be.** A `bd close` typed at a terminal still
closes a gate. bd has no pre-close hook — `bd hooks` installs git hooks and nothing
else — so no rule beadcause holds can reach it. What is covered is the only ending an
unattended session has, which is the one that fired.

#### And the merge itself, held the same way (bc-bmry.8)

The table above is the **close**. Until bc-bmry.8, a gate or review-packet bead's
*merge* was untouched: its pull request went on the merge queue exactly like anything
else, and the only thing standing between it and `main` was a session remembering to
type `--review`. That is precisely the shape [lm-vry](#the-one-law--no-agent-closes-a-gate)
warned against — a brief is a promise a session can forget to keep — applied to the merge
instead of the close.

So `bin/deliver.js` now holds the merge too, whether or not `--review` was passed:
`autoMerge = policy.autoMerge && !review && !editHold && !approvalLabel`, the same shape
[`editHold`](navigating.md#the-worker-at-the-far-end-and-the-one-thing-it-may-not-do) already uses for
an in-app edit. The
delivery opens the pull request and files the question card exactly as `--review` would
have, the brief says so before the session has to wonder, and the pull request's own note
and the PR body say the same thing to whoever reads the diff. lm-8o5's own words about the
close are why the wider cost — every gate delivery becomes a card instead of a queue entry
— is not a reason to stop: *"costs a decision per gate session, which is the point of a
gate."*

#### Checking the one law

**`node test/onelaw.mjs`** — the predicate, the gate, the retry, the merge queue driven
end to end with a fake tracker, the brief, and (since bc-bmry.8) `bin/deliver.js`'s own
`autoMerge`/`asked` lines, read rather than driven for the same reason as the close. Three
failures are worth the file and the middle one is the expensive one: missing a door,
refusing a close Adam asked for, and retrying a terminal refusal for ever. `bin/deliver.js`
is a separate process that cannot be imported, so it is read rather than driven — the
drive of the real binary is `test/landcheck.mjs`. The `gate` opening in `deliveryBody` and
the `gate` clause in the pull-request footer are pinned beside their own neighbours in
`test/delivery.mjs` and `test/prtext.mjs`.

### Checking it

Five, because the things that can break here are different things:

- **`node test/closegate.mjs`** — the gate itself: the two refusals, and, the
  expensive half, the seven cases that must **not** be refused. A question bd would
  close happily becoming unanswerable from the phone is a worse bug than the one
  this fixes, and a silent one.
- **`node test/closegatereal.mjs`** — the same claims, asked of `bd` instead of a
  fixture. The file above stubs `run()`, so it proves the gate matches what this
  code *believes* about bd and can never catch the belief being wrong — which is
  the failure bc-5864 was filed about. This one runs `bd init` in a throwaway
  workspace, builds each shape from the [table above](#exactly-which-beads--and-the-two-that-read-backwards),
  and for every one asserts the gate's answer *and* what a real `bd close` then
  does. ~35s and a real tracker, which is what the question costs; it skips out
  loud where `bd` is not on PATH.
- **`node test/closepaths.mjs`** — what each of the two ways out is allowed to
  write, which is a different claim and the one that kept breaking. Both endpoints
  are driven over real HTTP with `cfg.bdBin` pointed at a fake `bd`, so *"wrote
  nothing"* is asserted against the argv bd would have been given: the answer path
  refusing before it writes, the dismiss path succeeding on the same bead and
  writing at most a comment, the card leaving the inbox, and — the promise that
  makes setting aside safe — coming back once what it was waiting on clears.
- **`node scripts/gate-check.mjs`** — what it looks like in your hand: headless
  Chrome at phone size driving the real `public/app.js`, asserting mostly what must
  *not* happen — no error toast, no write, the draft still in the box, and the
  dismiss button never claiming to close anything. Note what it cannot tell you:
  the fixture supplies the responses itself, so it passes whether or not the real
  server would send them. That is `closepaths`' job, and the reason it exists.
  `--baseline` serves the committed `app.js`/`style.css`; `--out=<dir>` writes the
  note.
- **`node scripts/card-thread-check.mjs`** — the other half of the same story: that
  a gated epic never draws the button at all, that the comment takes its place as the
  primary, that the note names the children, and — the control that matters most —
  that an ordinary question keeps every button it had. The same script covers the
  folded thread below, since both are about what an opened card spends your attention
  on.

### A question you have already answered, arriving again

The close gate above explains four of the five beads that ended up carrying the
same answer twice. It does not explain the fifth, and the fifth is a different
mechanism entirely.

**Answering closes the bead — and for a decision, closing is often wrong.** Three
of bc-goo.2's four options were build orders: *build both as written*, *build the
common repo only*, *build the API only*. An answer like that is a commission, not a
conclusion, so the session that picks the work up reopens the bead — and a reopened
bead still labelled `human` walks straight back into the inbox. The card is rebuilt
from the tracker every time, so it arrives carrying the same question, the same four
options, and no trace whatsoever of the answer given an hour earlier. It was
answered identically at 13:33 and again at 14:35 on 2026-08-09, and the log said
only `bc-goo.2 arrived` three times, with nothing marking two of those as the same
question coming back.

**So it still arrives, and it arrives saying what you said.** The other fix — refuse
the second arrival, because the bead has been answered — trades a duplicated answer
for a lost question, and nothing in the tracker distinguishes a pointless reopen
from a bead that has genuinely come back with something new to ask. A question in
front of you is the whole premise here. What was missing was not the card; it was
the fact.

Where that fact shows up, in the order you would meet it:

- **On the card**, between the question and the buttons that answer it — on the
  collapsed row as well as the open card, because the gesture that goes wrong is a
  two-tap answer straight from the list. `⟳ You answered this an hour ago`, the
  answer quoted underneath, and `answered 2 times already` once it has happened
  twice. Nothing is disabled: re-answering is often right, and this states the fact
  rather than making the decision.
- **On the notification**, for the same reason and more urgently — the shade offers
  the first three options as buttons, so a repeat can be answered from a lock screen
  with the card never opened. The title gains `asked again` and the body leads with
  the previous answer. A `minimal` workspace gets the marker and not the answer: *you
  have seen this before* leaks nothing, the sentence you typed leaks as much as the
  question does.
- **In the log**, so this is reconstructable next time: `bc-goo.2 arrived — asked
  again, you answered it an hour ago`.

It is remembered in beadcause's own `state.json`, keyed `workspace/id` like
`dismissed` and `ringing`, written once at the moment you answer — the answer is on
the bead as a comment, and finding it there would be a `bd comments` call per inbox
row per poll for cards nobody has opened. Unlike those two it is **not** pruned
against the live inbox: an answered bead is closed and out of the sweep, so pruning
on absence would throw the record away moments before the reopen that needs it.
Thirty days, and 500 records, are what bound the file instead.

`node test/answered.mjs` pins it end to end against a fake `bd`: a first arrival
carrying nothing, an answer recorded, the bead leaving the inbox with its record
surviving — the assertion that stops someone pruning it like the others — the reopen
arriving with the answer on both the list payload and the detail fetch, and the count
going up when it is answered again.

### Where the answer goes

Answering used to end in a dead pause. The card dimmed to half opacity, a
"Recording your answer…" row appeared under it, and then nothing happened at all
for as long as `bd` spent retrying against the Dolt lock — a second, sometimes
three — after which the list rebuilt itself and the card was simply gone. Dim,
hang, jump cut. Nothing said where the thing you had just decided went, and on a
slow write it read as a freeze rather than as work.

What happens instead is that **the answer becomes a bead, and the bead goes into
the tracker**, in six steps:

1. **Collapse.** The open answer view shrinks and rounds down in place, from card
   to a single bead-sized circle, floating *in front of* a list that has already
   reflowed underneath it. The card is gone by the time the bead exists.
2. **Ignite.** At bead size it pulses once, white → blue, and holds blue.
3. **Travel.** It arcs across the screen toward the app mark in the top-left of the
   header — an arc, not a shove.
4. **Attract.** Just short of the mark the motion goes magnetic: it stops coasting
   and starts being pulled.
5. **Thread.** A line grows out of the mark to meet it. Contact is capture.
6. **Absorb.** It is drawn straight down the thread into the mark and swallowed,
   and the thread retracts with it.

**One bead per bead created, plus one for the bead you answered.** Approving an
advocate's proposal files N beads in the same call, and today they arrived with no
ceremony whatsoever; now each one flies its own arc, and the created ones pulse
**green and faster** than the answered one's single slow blue pulse. The thing you
decided and the things your decision made should not look identical. They fan out
around the mark rather than stacking on it, each with a thread of its own, because
four beads landing on one point look like one bead.

**Flights fan against each other too, for the same reason.** Answering three cards in
a row now puts three flights in the air at once (below), and the fan above is *within*
one flight — so without a second one they would hold on the identical standoff point
and three answers waiting to be swallowed would read as one. Each live flight takes a
**lane**: a further half-fan around the mark and a further ring out from it, held for
as long as the flight is and given back when its last bead lands. Four lanes, which is
what a phone can hold before the outermost ring leaves the top of the screen; a fifth
simultaneous flight shares the last lane rather than flying somewhere silly.

Four things about this are load-bearing, and each of them is a way it could have
been built wrong:

- **It plays over the wait, not after it.** The flight starts on the tap and the
  write is issued behind it. Everything up to *attract* runs while the request is
  out; the beads then hold in the magnetic zone, visibly being pulled, for however
  long `bd` takes. The latency lands in the one part of the sequence that already
  looks like something is happening. A flight that began when the response arrived
  would only have moved the pause somewhere else.
- **A refused write takes it back.** The last step is gated: the beads are absorbed
  only once the server has accepted, and if it hasn't they fly home the way they
  came and the card re-opens underneath them **marked red, carrying the reason** —
  see *Answering does not wait for the tracker* below. A tracker that rejected your
  answer must not be shown swallowing it. Which is why the card is removed
  *optimistically* but every piece of state it was built from — its index in each
  channel, whether it was open, the proposal's per-bead yes/no, and above all the
  draft, which is still only cleared once the server says yes — is kept until the
  write resolves. A poll that overlaps the write is suppressed for that one bead, or
  the list would drop a card back underneath the flight leaving it.
- **A comment ends differently, deliberately.** *Comment only* does not close the
  bead, so nothing is absorbed: the card collapses to a bead on the tap and the bead
  settles back onto the row it came from. The mark eating a bead that is still open
  would be a lie about what just happened.
- **The beads are not in the list.** They live on a fixed overlay on `<body>`,
  because `render()` destroys the card they came out of while they are still in the
  air. A flight parented to that card would be wiped out by the very repaint it
  exists to cover.

With `prefers-reduced-motion` nothing is put in the air at all — the end state is
reached directly, per the convention the rest of the app follows. The target is
resolved from a short list of selectors ending at `.brand`, so the mark can be
swapped for something else without any of the geometry being redone.

`node scripts/absorb-check.mjs` checks all of it: headless Chrome at phone size,
driving the real `public/app.js` and `public/absorb.js` against fixtures served by
the script itself, with `/api/respond` deliberately slow — which is what turns a
1.5-second animation into something a test can stand in the middle of and measure.
It asserts that the card leaves the list on the tap rather than when the write
lands, that what replaces it is a bead-sized circle on the overlay, that approving
three beads puts four in the air in two colours, that a forced repaint underneath
destroys none of them, that they arrive at the mark and are held there with nothing
threaded while the write is still out, that a thread then grows and the overlay ends
empty, that three cards answered back to back all leave inside one write's worth of
time and hold in three separate lanes while exactly one write is on the wire, that a
refused write returns the beads and gives the card back with the typed answer verbatim
*and marked red*, that the red survives collapsing the card and clears when the note is
dismissed without eating the draft, that a comment is never threaded, and that with
reduced motion no bead ever moves and the card still goes.

`--baseline` serves the committed `public/` instead of the working copy — which is how
you tell a real failure from a flaky one. **Not every case discriminates, and it is
worth knowing which.** The flight cases and the red-card cases fail at baseline and
pass here. *"All three are answerable inside the time a single write takes"* passes at
baseline too, and that is not a broken assertion — it is the honest measurement, and it
is why the queue's own claim is the line under it. The card has been removed
optimistically since the flight landed, so three taps have always been possible in a
few milliseconds; what a page without the queue cannot do is keep them off the wire at
the same time. `--shots` drops a PNG per stage into `.claude/shots/`, because the one
thing an assertion about coordinates cannot tell you is whether it looks like anything.

### Answering does not wait for the tracker

Three cards answered in a row used to put three writes on the wire at the same time.
Nothing on screen said so — the card has left the list on the tap since the flight
landed, so the *thumb* was already free — but `bd` is a single Dolt writer, and three
simultaneous closes against one lock is three of them retrying each other out of the
way. The second and third answers were racing the first for a lock, and the only thing
that ever said one had lost was a toast.

So the write moved off the tap and onto a queue. **`public/submitqueue.js`** holds every
write this page owes and drains them one at a time, oldest first; `submit()` does its
optimistic half — launch the flight, splice the card out, repaint — and then hands the
write over and returns. What is parallel is the thumb and the writes, not the writes and
each other.

Three rules it holds, and each is a way it could have been built wrong:

- **Serial on the wire, and only there.** Two writes in the air buy nothing against one
  writer and cost lock contention. The queue is the only thing keeping them apart now:
  `submit()` used to `await flight?.absorb()` on the argument that two flights must not
  overlap, and that await is exactly what would have made each queued write wait out an
  animation it has nothing to do with. Flights overlap deliberately now — see the lanes
  above — and the writes are single-filed by the queue instead.
- **Tap order, never reordered.** The beads one answer creates can be what the next
  answer is about, and a queue that filed them in a sequence you never chose would be
  worse than a slow one.
- **A refused write must not strand the queue.** Each job owns its own failure — that is
  what hands the card back — so a throw is caught and the drain carries on. One refusal
  taking every answer tapped behind it with it would be the worst outcome available.

**It is not `public/sendqueue.js`, and the difference is the whole reason there are two
files.** That queue exists to *join*: two things said to an agent mid-turn are
concatenated and delivered as one turn, because two `claude -p` runs back to back would
answer the first without knowing the second exists. Submits are the opposite — each entry
is its own write against its own bead, and joining two of them would be answering one
question with another question's words. The failure modes differ the same way: a refused
message goes back into a composer, a refused submit hands a whole card back to the list.
One file each rather than a mode flag, because nothing but "run them in order" is
actually shared.

**Nothing draws the queue**, and that is deliberate. The flight already is that chrome:
an answer whose write is still out is a bead visibly held at the mark being pulled in,
and three queued is three beads in three lanes. A counter in the top bar would say the
same thing again, in a bar that has no room for it.

**A page closed mid-drain would take the writes with it**, so it asks first —
`beforeunload`, and only while something is genuinely owed, which is why `size()` counts
the write that is *on the wire* as well as the ones behind it. The browser will not show
our words; the generic "leave site?" sheet is the entire vocabulary available.

**And it degrades rather than breaking.** A page that dropped the file — the fetch is
network-first, and the one moment it is wanted is the moment the link is bad — falls back
to sending each write straight out, which is what every build before this one did. Same
bargain as `absorb.js` and `dictate.js`: a missing script costs the flourish, never the
function.

`node test/submitqueue.mjs` drives the real file in a vm with nothing in it but a
`window`, the way `test/queue.mjs` drives its neighbour: that a tap returns before its
write does, that jobs run one at a time and in tap order, that a refusal does not strand
the ones behind it, that nothing is joined, and that `size()` counts the one in the air.
The browser half is `scripts/absorb-check.mjs`, above.

### A write that fails comes back on the card, not in a toast

A refused write used to put its reason in a toast and hand the card back. That was
honest while the tap waited for the write — you had not moved, and the thing that had
failed was in front of you. It stopped being honest the moment submits queued: the
refusal can now arrive while you are three cards further on, and a message that fades
after five seconds over an unrelated question is indistinguishable from the answer
having gone through.

So it goes on the card. `q.failed` carries the server's own reason, `failedNoteHtml`
draws it above the answer box, and the card is opened and scrolled to it — an open card
is `position: fixed; inset: 0`, so opening it is most of "bring it into focus", but on a
bead with a real description the note is below a brief you land at the top of, and a red
edge you have to scroll to find is a red edge you find tomorrow.

**That genuinely interrupts, and it is meant to.** If you were part-way through the next
card when the refusal landed, that card collapses and this one comes up over it. What
makes it safe rather than rude is that every keystroke is already kept — see *the answer
box* below — so the sentence you were in the middle of is in its draft and its card is
one tap away, still marked amber. The alternative is a write nobody knows did not
happen, which is the failure this whole section exists to stop.

**And it does not always get to say nothing was written.** An answer is several acts in a
row — the merge behind a delivery card, an endorsement a sentence asked for, the beads a
"yes" files — and the answer itself is written **last**, deliberately: a merge GitHub
refuses has to leave the question answerable, and a question closed on a promise nobody
kept is the ending this app exists to prevent. The cost of that ordering is a second in
which the act has happened and the answer has not. bd goes away inside it — restarted,
locked, a 500 — and the card said *nothing was written and nothing was lost* over a pull
request that is merged, a branch that is gone and a work bead that closed. That reads as
*try again*, and it is wrong in the direction that costs an afternoon. bc-s2d8 closed the
one path that reached it in practice; this is the class.

So the failure carries what happened. `performed` in lib/server.js collects the notes each
act composed — the same sentences the thread would have carried, rather than a second
vocabulary invented for the failure case, which would be two accounts of one act that can
disagree — the handler's own catch puts them on the JSON body as `landed`, and
`failedNoteHtml` draws them **in place of** the reassurance rather than beside it, because
the two cannot both be true. Minus their markup, which is the same call `shipWhat` makes
one screen up: an alert full of rendered markdown would stop being the shape `gateNoteHtml`
is, and being that shape is the point of it. A refusal with nothing behind it still says
nothing was written, because it is true — a note that hedged on every refusal would teach
you to ignore the one that matters.

One act does not wait for `performed`, because it can half-happen: a batch of creates is
beads made one at a time, and it throws out of `createProposed` before the handler has
composed anything at all. That catch already commented what it managed on the thread; it
puts the same sentence on the failure now, so the thread and the card agree.

`node test/landednote.mjs` drives a real `POST /api/respond` with a bd that dies mid-write,
over a delivery card whose merge has already gone through, and lifts `failedNoteHtml` out
of public/app.js into a vm for the sentence itself. The browser half is in
`scripts/absorb-check.mjs`, whose fixture can now put a `landed` on its refusal.

**It joins the close gate's family rather than being a second mechanism.** Same shape as
`gateNoteHtml` — a sentence naming the bead and the reason, a paragraph saying what that
leaves, a row with the way out — because a refused close and a refused *write* are two
versions of "nothing was recorded and here is why", and drawing them as two unrelated
things would make the rarer one read as a new kind of trouble.

**Red where the gate note is amber, and that inversion is the point of having two.** The
gate note is the tracker declining on purpose: nothing failed, something is incomplete,
and red there would read as the answer having been lost — the one conclusion it exists to
prevent. This is the opposite case, the request genuinely not going through, and amber
here would file a broken write under "waiting on you". `--danger`, and the only place on
a card this app uses it.

Down the left edge of the shut card it is the same three pixels of inset shadow as the
unfinished-draft mark, in the bad colour — `.card.has-failed:not(.open)` after
`.card.has-draft:not(.open)` at identical specificity, so a card that is both (which is
the ordinary case, since a refused write hands the draft back with it) shows red. A
failure outranks an unfinished sentence: one of them needs a decision from you and the
other only needs your thumb.

The red clears two ways and no others: **answering again**, which drops it on the tap
rather than when the second write lands, and **dismissing the note**, which takes only
the marker and leaves the draft. Dismissal has its own action rather than sharing the
gate note's, because the two notes can in principle both be on one card — a close the
tracker gated, then a write that failed outright — and one button clearing both would
take away a refusal you have not read.

### The answer box does not scroll away

An open card is the same three-part shape the bead console uses: a **head that
stays** — workspace, id, the question, its option buttons — a **brief that scrolls
on its own**, and the **answer box pinned to the bottom of the screen**. Before
this the card was one long scroller, so on a bead with a real description the box
sat several screens below the fold: you read down, scrolled back to reply, and
every glance back at the details lost the box again.

The composer needs no position of its own. The card is already a fixed full-screen
layer, so once the card stops being the scroller its last row *is* the bottom of
the screen. The keyboard is handled a level up — the Android activity is
`windowSoftInputMode="adjustResize"` and the page asks a browser for
`interactive-widget=resizes-content` — so both shrink the layout viewport rather
than sliding the keyboard over a fixed layer, and the box comes up with it.

Resizing the viewport is also what makes the keyboard the hard case, because it
takes a third of the screen away at the moment you most need the box. So the rows
above the brief **shrink rather than push**: the question, the options and an open
session log each get a share of what is left and scroll within it, in the order
they can most afford to, and the brief keeps a floor of 80px so there is still a
strip of the details to glance at while you type. Nothing switches layout on
focus — a card that unpinned the box the moment you tapped it would be worse than
one that never pinned it.

Below **440px** of viewport it does switch: the card goes back to being one long
scroller. That threshold has the keyboard on the right side of it deliberately — a
phone with the keyboard up is still around 500px, a phone on its side is around
390px, and only the second one genuinely wants the old shape back, because head,
options and composer are the better part of 400px between them.

**Landscape with two real columns undoes the pin**, deliberately. There the
question and its options are already pinned on the left while the brief scrolls on
the right, so the answer box just sits at the foot of the left column — visible
without pinning, and the card can scroll as a whole if that column runs long.

### Keeping your place in a long brief

Deferring the repaint covers the case where you are typing. It does not cover the
much commoner one: reading. An open card is `position: fixed; inset: 0` — it takes
the whole screen and **scrolls its own contents**, its `.brief` in the shape above
or the card itself on a viewport too short for it — so
`window.scrollY` is 0 for the entire time a brief is on screen, and the list's
`innerHTML` rebuild throws that card away and builds a new one at `scrollTop` 0.
That is the jump back to the top of the card, and it is why putting `window.scrollY`
back afterwards never helped anyone with a brief open: it was restoring a number
that was zero all along. (It was doing real work for the list behind, which is why
the list's own offset is still put back too.)

Restoring the card's own offset is still not enough on its own, because mermaid
renders **asynchronously**. At the instant the position is put back, every diagram
is an empty placeholder and the card is at its shortest; the offset gets clamped to
the short content, the diagrams then draw and push everything down, and you are left
above where you were by exactly the height of the diagrams above you.

So what is stored is an *element* — the card by its key, then the way down into it
by child index to the deepest thing still starting above the fold — and it is
re-measured every time the layout changes: immediately, on the next frame, as each
image decodes, and when the diagrams finish. **Which part of the card was scrolling
is stored by name, not measured twice**: straight after a rebuild the card is at its
shortest and would measure as scrolling nothing at all, so capture decides — the
brief, the card, or the page — and restore obeys. The fold the descent measures
against is the top of *that* scroller rather than the top of the card, or with the
head fixed it would match the head every time and never reach the brief. Each
restore is absolute rather than
incremental, so a later one refines the answer instead of compounding the last.
Anything deliberate that moves the page — your thumb, a wheel, an arrow key, or the
scroll that **↑ Collapse** does to put you back on the card's head — ends the
sequence rather than fighting it. The caret, the selection and the focused textarea
come back the same way, for the repaints that genuinely cannot be deferred.

`node scripts/scroll-check.mjs` checks all of it: headless Chrome at phone size,
driving the real `public/app.js` against fixtures served by the script itself, so it
never touches a bead. It asserts that a poll leaves a long brief where it was, that
it still does when a diagram sits above the reading point and sizes late, that a
deep link naming the card you already have open moves nothing, that a forced repaint
keeps a half-typed answer with its caret, and that collapsing still lands on the
card's head. `--baseline` serves `HEAD:public/app.js` instead of the working copy —
which is how you tell a real failure from a flaky one: baseline must fail the scroll
cases, the working copy must pass all of them.

### One open at a time, and where you are in the list

Opening a question **collapses whichever one was open before it**. An open card is a
fixed full-screen layer, so before this a second one just stacked on the first — tap a
notification while reading, close what it opened, and you were looking at a brief you
had already finished with rather than the list. Left to accumulate they also made the
list unscrollable in the only sense that matters: you could not find your place in it.

**Collapsing is never suppressed, not even for an unsent draft.** The alternative — a
card that refuses to close because you started typing in it — trades a small surprise
for a bigger one. Instead the card comes back **marked in orange down its left edge**,
so a question you have half answered is legible from the list while you scroll past it.
Same `--warn` as the "draft saved" flag it sits beside, deliberately: one orange, one
meaning. It is a solid edge where the P0/P1 pill is a 22% tint of the same colour, so
*high priority* and *unfinished* can't be mistaken for each other. The mark comes off
where the draft does — on **Comment only**, which is the one path that clears a draft
and leaves the card in the list.

Scrolling raises a **"5 of 9"** against the right edge, with a rail whose thumb is
sized by how much of the list is on screen: how many above, how many below, how many
in total, which several open questions otherwise give you no sense of at all. It fades
out 1.6s after you stop, because it is a navigation aid and not a permanent fixture
sitting on top of a card's buttons. It counts what the space picker has left in the
list rather than what the server sent, and it is hidden entirely while a
card is open — that card scrolls itself, and a count of the list underneath would be
describing something you can't see.

Both are painted the way `paintArmed()` is — a class toggled on the card in place, not
a `render()` — so nothing here can rebuild the list under a half-typed answer.

### Reading a paragraph bd folded at 78 columns

bd hard-wraps what it stores. A phone is narrower than 78 columns, so every one of
those stored lines wraps again on its own — and rendering markdown with `breaks` on
puts a `<br>` at each fold as well, which draws a paragraph as a staircase and a
folded list item as two lines of loose prose. Turning `breaks` off everywhere is not
the fix either: a comment is typed on the phone, by a person, who means the newlines
they put in.

So `renderMarkdown` takes the flag rather than assuming it, and the caller decides.
Description, notes, design, acceptance and the decision block's own context came out
of bd and reflow; comments and chat-session messages were typed and keep their breaks. The
graph's detail sheet follows the same split.

`node scripts/wrap-check.mjs` checks both halves, in the same headless-Chrome-on-
fixtures way as the scroll check, over the inbox card and the graph sheet: a folded
paragraph comes back as one sentence with no break in it, a folded list item stays
one item, and a three-line comment still has its two breaks. `--baseline` serves
`HEAD:public/app.js` and `HEAD:public/graph.js`, where the bd-prose cases must fail.

### The thread is folded to the last exchange, and opens on your half of it

A bead that has been round four times has a thread that is mostly history, and a
card that draws all of it spends the screen on the part you have already read.
Every entry is folded to its author line except **two: the last thing you said, and
the last thing the other side said.**

Two rather than one, and one from each side rather than the last two:

- The recent exchange **is** a pair. The last reply only means anything next to what
  it was replying to.
- Taking "the last two comments" would leave nothing of yours on screen whenever the
  final two are both an agent's, which on a thread where an agent answered and then
  followed up is the ordinary case.

A folded entry keeps its author, its age and **one clipped line of what it said** —
enough to recognise, never enough to wrap, because two lines is not folded. The
author line *is* the toggle: a 12px chevron of its own would be a second target on a
bubble whose whole point is the sentence inside it, and the who-and-when line is
already what your eye uses to decide whether this is the comment you were after.
Yours are still the plain bubbles and an agent's still carry the teal stripe, folded
or not — the fold changes what is shown, never who said it.

**Opening a card lands you on your last message.** The top of a card is the question,
and the question is the part you already know — it is why you tapped. What you have
lost is the conversation. So the brief scrolls to your last comment with the reply to
it just below, and the description is above you, still there when you swipe back. If
there is nothing of yours on the thread — a question you have not answered yet, the
common case — the card opens at the top as it always did. The jump happens **only on
the way in**: a card already open stays exactly where you put it, because a poll that
dragged you back down to your own comment every 25 seconds would undo the whole of
[keeping your place](#keeping-your-place-in-a-long-brief). It re-measures as the
diagrams draw, for the same reason the restore does.

Both halves are **repaint-proof**, which is the part that took the care. Opening a
folded comment is a class flipped on that one bubble — never a `render()`, because
the answer box under the thread is holding a draft and possibly the caret — and the
choice is recorded in `state.thread`, keyed by the comment's own uuid, so the next
poll paints it back the way you left it. A comment you opened to read folding up
again under a background refresh is the same category of loss as a half-typed answer
disappearing.

`node scripts/card-thread-check.mjs` covers this and the missing *Answer & close*
above, in the same headless-Chrome-at-phone-size way: that all seven comments are on
the card but only two have a body on screen, that they are the right two, that each
folded one shows a single line, that the card opened somewhere other than the top
with your last message at the fold, that a tap opens one in place without touching
the draft or the caret, and that a refresh leaves it open. `--baseline` serves
`HEAD:public/app.js` and `HEAD:public/style.css`, where every comment is open, the
epic offers to close itself and the card opens at the top — so baseline must fail.
`--out=<dir>` writes the two screenshots.
