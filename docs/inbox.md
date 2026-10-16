# The inbox

## What the inbox shows

The inbox is `bd human list` filtered to open, and that is the app's whole premise:
a bead reaches your phone because it is *asking you something*. The cost of that
premise is that a workspace with no `human` beads reads as completely idle — the
Northwind space said **0** in the picker while 54 beads were open in it and five were
being worked on. Arithmetically correct, and indistinguishable from a broken app.

So the **row of filter chips** under the top bar carries one setting, in three
positions:

| | shows | costs |
|---|---|---|
| **Human** (default) | beads labelled `human` — the questions | one `bd human list` per workspace |
| **Both** | questions first, then every live bead | both sweeps, in parallel |
| **Agent** | only what is *not* a question | one `bd list` per workspace |

"Live" is `open`, `in_progress` or `blocked`; deferred and closed are out, because
neither is anything an agent is on. **Every count on the screen follows the scope** —
that is the point of it, and it is why the switch is a row of chips rather than the
gear and modal panel it started as. A setting that changes what every number below it
means has to be *readable* without a tap; behind a gear, the only thing saying why
"Northwind 59" was not a count of questions was an accent border on the gear itself,
and you had to already know what it meant.

It sits directly under the space picker, and the two are genuinely different kinds of
control rather than two filters stacked: the picker says which repo any of this is
about — on every page in the app, and to the notifications — while the scope decides
which rows are fetched at all, and only here. That difference is drawn rather than
written: the scope chips are banded into one segmented switch with a rule under it, and
the picker is a dropdown in the chrome above. The space and workspace chip rows that
used to be here are gone; they were this page's private copy of a choice the whole app
now shares.

One thing follows from that and used to be the other way round: **switching scope no
longer resets the repo.** It did when the workspace filter belonged to this page, on the
grounds that it was probably pinned to the one workspace that had a question in it. Now
the same value is on five screens and in the push decision, and a tap on `Both` must not
quietly change what you are working on — here or on the phone in your pocket.

Three things make this safe to widen:

- **The default never moved.** `/api/questions` treats an absent or unrecognised
  `scope` as `human`, so the poller, the pushes and the Android shell see exactly
  what they always saw. Only the phone's own list changes.
- **Agent beads are read-only.** There is no decision block to answer, so the card has
  no options and deliberately no **Answer & close** — that path comments "Answered via
  Beadcause" and closes the bead, which on another session's in-progress work would be
  vandalism rather than an answer. What you get is what the bead is, who has it, its
  description and notes, and the two ways in: the graph, or a session on the Mac.
- **The rows are slim.** `bd list --json` returns the full description *and* notes of
  every row — northwind alone is 88KB of it — so the list carries only what a card
  draws and `/api/bead` fetches the body when you actually open one. `--limit 0`
  overrides bd's default of 50, or a busy workspace would report its first fifty beads
  as the whole truth.

The wider scopes poll at 60s rather than the inbox's 25s: they are a full `bd list`
sweep, about 2.5s of `bd` across seven workspaces, and that does not want to run four
times a minute for a list you are glancing at.

### A repo that could not be read says so, instead of looking empty

A sweep is one `bd` per workspace and those calls fail independently. Embedded Dolt is
single-writer, twenty-odd agent sessions share these workspaces, and a read losing a
lock race is an ordinary Tuesday rather than an outage.

The handling used to be a `catch` that logged a line to the daemon's stdout and
returned `[]` for that repo. Every count on the screen is arithmetic over the rows that
came back, so a workspace whose `bd human list` threw did not show up as broken — it
showed up as **quiet**. "Nothing live", a count beside it, and the questions back on
their own a poll later, with the only record on a console nobody is watching. That is
this app's one unforgivable failure mode wearing the empty state as a costume.

Three things now stand between a lock collision and a lie:

- **The read is retried.** Two attempts, 400ms apart, and only ever for an error that
  looks like a lock — the same treatment every *write* has had since the beginning.
  Anything else still fails at once. Most collisions never get past this, which is the
  right way for the incident to be invisible.
- **The last good answer stands in.** A sweep that still fails returns whatever that
  workspace last said rather than nothing. Stale rows are a smaller lie than none: the
  bead really is open and really is waiting, and only its age is wrong. Answering a
  card drops it from what is held, so a write of your own can never be argued with by a
  sweep that could not read the repo you just wrote to.
- **It is named on screen.** A pane above the list, outside every filter, saying which
  repos could not be read, what `bd` said, and how many of their rows are standing in.
  Above the list rather than inside the empty state, because the usual case is six
  repos answering and one not — a screen that is six-sevenths of itself and looks
  exactly like an inbox.

And the picker stops reporting a confident zero: a space holding an unreadable repo
draws `⚠` beside whatever count it does have. The number is still the best answer
available. It just stops being presented as a fact.

### One list, six kinds — and the two sub-filters

Home is not one list. An advocate asking to create beads, a worker asking you to
merge, a plain question, a **pull request**, a **JIRA ticket** assigned to you, a bead
**held for endorsement**, and — under `Both` and `Agent` — the live beads nobody is asking
you about, are different jobs that happen to arrive at the same address. `KINDS` in
`public/inboxfilter.js` is the table that names them, and it is the only place that knows
which row is which: one row of it buys a pill, a count, a predicate and — where it has a
second axis — a filter pill of its own.

**There were ten of these and they were chips inside a collapsed panel.** bc-khoe.2
promoted them out and amalgamated them to six. The argument is the one the whole [pill
row](navigating.md#getting-around--the-pill-row) is built on: ten categories of *incoming thing* is a
navigation rather than a filter, and a navigation you have to open something to see is a
navigation nobody uses. Four rows went into two:

| Pill | What it carries | What it absorbed |
|---|---|---|
| **Home** | Everything at once — nothing narrowed | — |
| **My Epics** | The epics you have started — the board, and nothing under it | — |
| **Questions** | Everything waiting on a word from you | `proposal`, `jira`, `endorsement` |
| **PRs** | Pull requests, and the finished branches waiting on a merge | `delivery` (Merges) |
| **Chats** | The conversations you have open | — |
| **Ledger** | Every bead the space has ever had — a page of its own | — |
| **All Beads** | Every live bead nobody is asking you about | `claimed`, `blocked`, `unclaimed`, as a sub-filter |

**Two of the seven are places rather than slices.** A kind with a `test` is a predicate
over the rows the list holds. `Home` and `Ledger` have no predicate: the first is Home with
nothing selected, the second is a different page. They are in the table anyway, because the
row is seven pills and a reader asking "what are the seven" must not have to find two of
them somewhere else, and `set()` refuses to select one — a place has no predicate, so
selecting it would match no row at all and leave Home empty with a lit pill above it and
nothing to read as the reason.

**`My Epics` is the odd slice, and its predicate is `false` — bc-fwp2c.** It was a place
too, and the same place as Home: one pill that both landed you on the list and drew the
epic board. That could not survive the badges. A place's number can only ever be the sum of
every slice — that is what a tap on it leaves you with — so the pill read `My Epics 46` on
a tracker holding three epics, and the word and the number were about different screens.

Splitting them made My Epics a screen of its own, and the predicate is what earns it a
place among the slices: no inbox row is *ever* an epic — a started one is a card on
`rootboard`, an unstarted one an offer in `startable` — so `false` states the measured truth
about this list, and `pick()` selects the pill instead of clearing the selection the way it
does for a place. Its badge cannot come from the row loop and does not: `survey` takes it
from the caller, off the cards just drawn, and the `board: true` flag keeps that number out
of Home's sum so Home never counts a screen it does not draw.

**A view shows its own kind, and that is one line in `render` rather than six.** Home draws
every view on top of the same page, and until bc-khoe.28 it drew *both* halves on all of
them: the [P0 board](#epics-assigned-to-you-and-the-tree-each-one-carries) above, the card
list below, whichever pill was lit. So no pill showed only its own kind — Questions had the
epic board over it, and `My Epics`, being the empty selection, drew every row the sweep had
produced underneath a board whose trees already held the same work. `render` asks
`current()` which pill is lit and draws one of the two:

- **`My Epics` is the board, and there is never a list beneath it.** Each card already
  expands to its own tree, so the rows below were a second, flatter copy of what the cards
  hold — the argument bc-rfnr.9.7 made about your epics' descendants, finished. What that
  took out of the list was the beads; what this takes out is the rest, and a question under
  nobody's root is now on `Questions`, where it is the plainest example of a row a tree
  cannot hold.
- **The board is not on any other pill in any form** — not collapsed to a heading, not a
  count. A board over a list of chats is the thing bc-khoe.28 was about.

Two things put a list back under the board, and neither is a hedge on the rule. **A bead
picked in the search box**, which is the same sentence `inBoard` already makes one line
above — an explicit filter outranks an implicit one, and the box is in the panel on every
pill, so a search run from `My Epics` with no list to answer into would be a control that
does nothing. And **an open card**, which is not a list at all: `.card.open` is a
full-screen sheet built out of a list row, so the clause is what makes `p0-answer` on a
bead in a tree — the ordinary way to answer a question from the board — open anything.
It is the same exception `underOwnedRoots` already makes for the card that is up.

**The third clause is gone, and that is bc-fwp2c.** A board with no cards on it used to
fall back to the flat list (bc-6s96), because `My Epics` *was* Home and a pill drawing
neither a card nor a list would have been a blank page on the one install most likely to
see it. It is also exactly what made the badge wrong: an empty board became a list, and the
number followed the list. Home is its own pill now, so an empty board is an empty
`My Epics` and says so in as many words — `epicsEmptyHtml`, which names the space or
workspace chip when either is what emptied it, and points at the ＋ that ends the state.

The control never loading draws both, which is the shape this page had before there was a
pill row: a page served without `public/inboxfilter.js` must not be a page with half its
content missing and nothing on screen saying why. Same fallback `inKind` takes, same
reason.

**And once the board is off a pill, that pill needs its own rule** (bc-khoe.29). The four
kind pills kept the narrowing the page had while the board was over them —
[`under`](#a-question-under-nothing-is-still-drawn), "which started root of yours draws
this row in its tree" — and every property of that map is wrong for a screen the board is
not on. It is a *removal*, so the commonest row on the tracker (a question in an epic of
yours you have started) was the one row `Questions` could not show. It is keyed on
**roots**, so a question on a bead of yours that is not an epic had never been in it. And
it is keyed on **started** roots, so a question under an epic you have filed and not
claimed left it with bc-6s96 — and it is not `unhomed` either, because a root above it is
still a root. Those last two were on no screen at all.

So there are two narrowings now, and `render` picks by which pill is lit:

| | what it answers | who draws it |
|---|---|---|
| `underOwnedRoots` | is a card on the board already drawing this bead? | `My Epics`, and the fallback with no pill row |
| `assignedToMe` | is this bead **yours** — labelled `owner:<you>`, or under something that is, at any depth, whatever the status of the bead above it? | the kind pills |

The second reads a field of its own, `rootboard.assigned`, computed off `bd export` and the
`parent-child` edges beside `under` rather than derived on the phone — ancestry is a graph
walk and the answer has to be the same on the laptop and the watch. "Assigned" is the
`owner:<handle>` label (`lib/ownership.js`), not bd's `assignee` cell, which the first agent
claim overwrites.

**It is keyed by bead where the other two are keyed by row**, `<workspace>/<id>`, and that
is what finally makes a pull request judgeable: a PR row is keyed `pr:<repo>#<n>` and is
decided by the beads it *names*, most of which have no inbox row at all. Under the board's
rule every pull request naming any bead is dropped — its map cannot tell yours from a
stranger's — so `PRs` showed only the ones naming nothing. Now a delivery over a bead of
yours is on the pill it belongs to, and one naming a bead of somebody else's is not.

Everything the board's rule keeps whatever the ownership says, this one keeps too, and for
the same reasons: a chat, a JIRA ticket, a pull request naming no bead, a
[card that is open](#the-question-has-to-survive-the-list), and a
[question under nothing at all](#a-question-under-nothing-is-still-drawn) — that last one
carries no owner label and no parent, and there is no other screen it could be on. The
no-op cases are the board's minus the `roots` test: an install with no `cfg.me`, and one
that owns nothing yet, are not narrowed — but *having started nothing* is exactly when your
questions most need to be reachable, which is the whole of the difference.
`node test/assignedrows.mjs` holds it, from `bd export` through to the real client filter.

**And the two screens either side of the tap are `scripts/p0board-check.mjs`'s**, which is
where the rule was caught disagreeing with itself. That check was written for bc-khoe.28
and asked, on the Questions pill, that the bead the board draws is "still not doubled into
it" — the rule bc-khoe.29 then reversed — so main was red on it for a day after #498
landed, on a check that needs real Chrome and is therefore not in `npm test` (bc-7wwbb).
The assertion is inverted now rather than deleted, because there is no board on that pill
to double anything into and the row's presence is the whole of what #498 bought. Its
fixture gained an `assigned` map at the same time: without one `assignedToMe` returns its
rows untouched, so the check had been passing this half of its claim without ever running
the code that decides it, and a question under somebody else's P0 is in the fixture now to
keep that from happening again.

**The row carries a copy of the six, and the copy is checked.** `public/viewbar.js` is
loaded on twelve pages and `public/inboxfilter.js` on one, so the row cannot read the
table at paint time. `test/inboxkinds.mjs` holds the two lists to the same six ids, labels
and icons, in the same order. A checked copy is not a second place that knows; an
unchecked one is. What is deliberately *not* copied is where a pill goes: the table knows
what a kind is and the row knows the URLs, so there is no href written down twice — which
is the drift the check above exists to catch, made unnecessary rather than caught.

**On Home a kind pill is a `<button>`, not a link.** Five of the six point at the page you
are already on, so as links they would each be a full document load — a refetch of every
workspace, a rebuild of forty cards, an open card thrown away — to change which rows of a
list already in hand get drawn. Off Home they are `<a href="/?kind=…">`, read once at load,
and the service worker matches with `ignoreSearch` so a query on the shell's own path
still resolves to the precached document offline. Which pill is lit is therefore not
always a fact about the path: off Home it is, and on Home the *filter* is the answer,
pushed at the row through `window.beadcause.views.mark()`. The per-kind counts ride the
same channel and for the same reason — `counts(map)` beside `mark(id)`, from the same
`paint`, filling [the badge four of the pills
carry](navigating.md#getting-around--the-pill-row).

**The selected kind is not one of the narrowings the filter row admits to**, and that is
the reverse of what the panel did while the kinds were in it. A narrowing has to be
admitted to somewhere on screen; the lit pill is where, and it is on screen without being
reached for. A control that went bold for every pill but the leftmost would be bold nearly
always, which is a signal that has stopped signalling.

Each kind carries a `side` — which scope can fetch it — and after the amalgamation exactly
one still has a real one. `bead` is `agent`, because the agent sweep is the only thing that
returns a live bead nobody is asking you about, so a selection the new scope cannot produce
is dropped rather than kept and ignored. Everything else is `any`.

**A `side` is a fact about the fetch and not a veto on the tap** (bc-khoe.25). The row is
drawn by `public/viewbar.js` on twelve pages and knows nothing about a scope, so `All Beads`
is on it whatever the scope is — and under the default `Human`, where `bead` is unreachable,
`set()` dropped the one selection that pill could ever make, `current()` fell back and the
row lit `My Epics`. The most-tapped scope had a dead control on it and nothing said why.
Asking for the beads is asking for the sweep that fetches them, so `pick` widens instead: it
asks `widen` — the seam `public/app.js` registers with `onWiden` and answers with
`chooseScope('both')` — and then selects. `Both` rather than `Agent`, because widening must
not take the questions away. The same request arriving as `/?kind=bead` from another page is
settled in `bootScope`, before the first `survey` that would drop it and while there is
still nothing fetched to refetch. Dropping is what happens when the *scope* had the last
word; widening is what happens when the *pill* did.
That is straightforward for a pull request (off `gh`) and a chat session (off no sweep at
all); **`Questions` is `any` for a different reason**, and it is the one place the
amalgamation changed the meaning of a field. A plain question comes off the human sweep and
a held bead off the agent one, so *both* scopes can produce a row of that kind and neither
can be called the one that fetches it.

**Endorsements were the cheapest row the table ever took**, and the only one that added a
chip without adding a fetch. A bead an agent filed mid-task carries the `unendorsed` marker
and nothing may open a session on it until you say so — but it is an ordinary open bead as
far as `bd list` is concerned, so it was *already* in the agent sweep, drawing as one more
**Unclaimed**. Splitting it out cost one row, a `held` flag that `agentBeads` in
`lib/server.js` computes with a label test, and `!q.held` in the predicates it was taken
out of. It has no pill of its own now — bc-j0zl recorded "never a sixth tab" and bc-khoe.2
folded it into `Questions` rather than spending a pill on it — but the `held` flag and its
predicate are exactly where they were: `!q.held` is what keeps a held bead out of **All
Beads**, and `q.agent ? Boolean(q.held) : true` is what lets it into **Questions**.

**A held bead also says so on its own card.** Under an unnarrowed Home it would otherwise
sit in a list of forty looking exactly like an open one, and "open" is the one thing it is
not, so the status pill gets a neighbour reading `held for endorsement` — a link, deep-linked
to that bead on the endorsement page, in the same words the advocate console's pill uses.
The four verdicts stay on that page: an agent card is read-only on purpose, and the
decision *is* reading the bead.

**A ship bead is not one of these.** `lib/release.js` files one per merged pull request
carrying the same marker, and it is waiting on a deploy rather than on a judgement. The
rule that separates them is `awaitingEndorsement` in `lib/endorsequeue.js` — held, and not
a ship bead — and it is one predicate rather than two tests at each call site because the
second half is the half that gets forgotten. See [Endorse all could reach
one](pull-requests.md#a-ship-bead-is-not-a-proposal-and-endorse-all-could-reach-one) for what it cost the
last time it was spelled out twice.

**Three of the things this list holds are not beads at all**, and that is the table
earning its keep rather than a special case. A pull request, a chat session and a JIRA
ticket each cost exactly one row when they arrived — a chip, a count, a predicate and a
word of what the filters say. Folding two of them into a neighbour cost the same table nothing
it did not already have: the predicates moved, the rows went, and the rest of the app went
on asking `kindOf` and `matches` the same two questions. See [the tickets
themselves](config.md#the-tickets-as-a-section-of-the-inbox).

**PRs and All Beads each have a second axis, and their defaults are deliberately
opposite.** Selecting `PRs` reveals a status sub-filter over [the ladder](pull-requests.md#the-ladder-in-one-place)
— `review · merged · pushed · deployed · live` — and with nothing chosen the list shows
only what has **not merged**. A merged pull request is history, and history should be
asked for: five are open right now and thirty have merged in the last three weeks, so a
PRs pill with no second axis would be a list of last month with this morning somewhere
inside it. Two rules keep that honest:

- **The default is a narrowing nobody set, so the control says so.** At rest it reads
  `PR status: unmerged` without being touched — since bc-khoe.26 that is written on the
  filter pill's own face rather than shared out along a summary line. On a screen with no
  pull requests on it at all, it says nothing about them.
- **A status outlives the pill that set it, as long as the new pill can still hold a
  pull request.** Pick `Live`, then widen back to `My Epics`, and the control goes away
  while the narrowing does not — so `PR status: Live` stays on the row as a **note**: the
  same words, without the border and the caret, because `My Epics` cannot use that filter
  and a button that changes a list it is not about is the complaint the pills answer. A
  list narrowed by something nothing on screen admits to is the one thing this control
  exists to prevent. Tap `Questions` instead and the rung is **dropped**, because there is
  no pull request in that list for it to narrow; see [the filters that
  remain](#the-filters-that-remain-are-the-ones-the-selected-pill-can-use).

`All Beads` has the other kind. `claimed`, `blocked` and `unclaimed` were three pills'
worth of one thing in three states, and none of the three is history the way a merged pull
request is — so the group has **no fallback**: nothing chosen means every rung, and its
pill reads `Bead status` and nothing else until you choose one, because a control
reporting a filter that is not filtering is noise around the one that is. `inSub` and `subSaid` in
`public/inboxfilter.js` are where the two behaviours part, and both directions are pinned
in `test/inboxkinds.mjs` — getting this backwards is an All Beads pill that shows nothing
at all, which reads as a broken sweep rather than as a filter.

A closed pull request gets **no card at all**: it is not on the way anywhere, and a rung
the sub-filter deliberately does not offer must not be able to reach the list. The board
still shows them.

The board itself is fetched on its own clock — a minute, and only while a pull request
could be in the list at all — because `/api/prs` is a `gh` call per repo behind a
25-second cache on the daemon, and asking it every 25 seconds because the inbox polls
would keep that sweep hot all day for six repos. The rows are synthesised at render time
and never merged into `state.questions`: nearly everything reading that array is about
beads — the kind filter's counts, the epic board, the answer path — and a pull request is
none of them.

**Four retired kind ids are written down on every phone in the house.** `proposal`,
`delivery`, `jira` and `endorsement` were selectable until bc-khoe.2 and the selection
lives in `localStorage['beadcause.kinds']`. `set()` has always dropped an id the table
does not know, so the upgrade lands on an unnarrowed Home rather than on an empty screen —
and both halves of that are pinned rather than assumed, because "the filter silently hid
everything" is indistinguishable from "the sweep stopped working".

**A kind filter does not change what rings your phone.** The space picker's does — it is
stored on the server and the push path reads it — and this deliberately does not: it
lives in `localStorage`, on the device, because "I am reading pull requests this hour" is
not "do not tell me about questions". The accepted consequence is that a hidden kind can
still notify you, and the lit pill is the standing reminder that the list is narrowed.
`node test/inboxkinds.mjs` covers the table (every row matches exactly one kind, in both
directions, and over every combination of the fields the payload can carry rather than
only over the rows it writes), the row's copy of it, the scope rule and the widening that
is its exception, both sub-filters' defaults the pills' own rule about when a
narrowing goes on their face, and the chrome on a pointer and a touchscreen. The widening
is also driven end to end, in a real Chrome, by
`node scripts/viewbar-check.mjs` — tap `All Beads` on `Human` and the pill stays lit, the
switch beside it moves to `Both` and `/api/questions?scope=both` goes out — because the
three files that have to agree on it are the row, the filter and the page, and no vm
holds all three.

### The filters that remain are the ones the selected pill can use

The kinds left the panel and three controls stayed behind: the bead search, PR status and
bead status. **Not one of the three is relevant to every pill**, and until bc-khoe.3 all
of them were offered under all of them. That is the complaint that made the kinds pills in
the first place, one level down — a control that cannot change what is on screen is chrome
you have to reach for to discover is useless. (The three are [a filter pill
each](#the-filter-panel-comes-apart--one-pill-per-filter) since bc-khoe.26; the rule below
was written for the panel and survived the change of container unaltered, which is what it
was worth writing separately for.)

So each row of `KINDS` in `public/inboxfilter.js` carries a **`filters`** list: the ids of
the filter pills that view pill can use, and nothing else in the file decides it.

| Pill | What it can be narrowed by | Why not the rest |
|---|---|---|
| **Home** | the bead search | Home holds every kind, so both sub-filters *could* narrow it — and offering two second axes over a list that is mostly neither is two more controls for a view you have not picked. What they still do here is confessed as a note instead. |
| **Questions** | the bead search | A question is not a pull request and it is not one of the live beads nobody is asking you about. |
| **PRs** | the bead search, PR status | The one pill with both: a pull request follows its beads, so the search narrows it too. |
| **Chats** | *nothing* | A chat is in no tracker. It is under no bead, and it has no rung. |
| **All Beads** | the bead search, bead status | — |
| **Ledger** | *nothing* | A page of its own, with a filter bar of its own. |

**`Chats` is the case that was actually broken, not merely noisy.** `inBead` in
`public/app.js` hides every row that is not a bead — deliberately, because a filter you
typed should mean what it says — so a bead picked under `PRs` and then carried into
`Chats` produced a screen with **nothing on it at all**, under a control that was still
offering to narrow it further. Now the pick is dropped when the pill changes, the search
box goes with it, and with nothing left to offer **the whole filter row takes itself off
the chrome** — a strip of controls for a view that can use none of them is worse than no
strip.

Three rules fall out of the one list, and the third is the one worth stating twice:

- **The row draws what the lit pill names.** `hidden()` on every group, the page's own
  included — `public/inboxfilter.js` wraps a page group rather than writing onto it, so
  `beadGroup` in `public/app.js` is the same descriptor `public/filterpills.js` would take.
- **A selection the newly-lit pill cannot use is dropped**, which is `set()`'s existing
  rule for a kind the new scope cannot produce, applied one level in. A sub-filter's
  selection lives in `inboxfilter.js` and is dropped there; a page group's lives with the
  page, so all this end can do is ask — `clear()` is optional, and a group without one
  keeps what it had.
- **Dropped means *cannot use*, not *cannot see*.** A rung chosen under `PRs` is still
  biting under `My Epics`, because that list holds pull requests; it is dormant under
  `Questions`, because that one does not. Only the second is dropped, and what the row
  says is gated on the same question. Getting *that* backwards is the subtler bug of the
  two:
  the counts a chip carries are taken **before** the kind filter — which is what makes a
  pill's number the list it would open — so under `Questions` there are still four pull
  requests counted and none of them on screen, and an ungated row reads `unmerged` over a
  screen with no pull request on it. Naming a filter that is not filtering is the same lie
  as hiding one that is.

**The standing `unmerged` default does not move.** It is a fact about what Home *is*
rather than about what you last tapped, so it still applies under every pill that can hold
a pull request, and the row still says so. What changed is only that it stops being said
where it cannot be true.

The last of it is the empty state. A pill that empties the list now keeps its own sentence
even when the P0 board is on screen: "your epics are on the board above" is a true
sentence about the wrong thing when the reason the list below is empty is a lit pill, and
the way out is a tap on the row rather than a look at the board. `node
test/inboxkinds.mjs` pins the table, the drop in both directions, the gate on what the row
says, the row hiding itself under `Chats`, and the warning a page gets for handing over a
group no pill names.

### The filter panel comes apart — one pill per filter

The scope going out onto the chrome left one collapsed line holding everything else, and
bc-khoe.26 takes that apart the same way. The line was the last thing on Home you had to
open before you could read it. What it said was a comma-joined digest of three different
questions — `Any bead · unmerged · Blocked` — and the only way to change any of them was to
open a panel that then covered the list you were changing.

So each of the three is **its own pill**, in the row under the view pills, each opening its
own chips. `public/filtermenu.js` still draws them, so the History tab's four filters came
apart in the same commit and by the same code: status, priority, filed-by and the bead-id
box are four pills there rather than four boxes inside one panel. One component with two
shapes is exactly what splitting that file out was meant to avoid.

**A pill says the narrowing exactly when there is one.** At rest it is its legend and
nothing else — `Bead status ▾` — because a pill that also said `any status` would be three
words of chrome for a control that is not filtering. The moment it narrows, the value goes
on its face: `PR status: unmerged`, `Bead: bc-0xil`, `Status: Closed`. That is more than
the one line could say, not less: it names *which* control is doing it, where a digest left
you to work out which of four to reach for. A group answers `narrowing()` for itself,
because "nothing chosen" does not mean the same thing in two of them — PR status is showing
you the unmerged ones with nothing chosen and bead status is showing you every rung, which
is the [two opposite defaults](#one-list-six-kinds--and-the-two-sub-filters) stated once
more, in the one place a reader will meet them.

**A narrowing whose pill has gone is said as a note.** `hidden()` takes a pill off the row
when the view cannot use it, and a selection that goes on biting after the pill has gone is
the one thing a filter control must never do quietly — so that case draws `.filter-note`
instead: the same words, no caret, not a button. Under `My Epics` the standing `unmerged`
default is exactly that, and so is a rung you chose under `PRs` and then widened away from.
The distinction is the whole point of taking the panel apart: a *control* offered over a
view it does nothing for is what bc-khoe.3 was about, and a *statement* is not a control.

Three smaller decisions, each of which had an obvious wrong answer:

- **One panel open at a time.** The row is a row of controls and the list is under all of
  them; two panels open at once would cover the thing both are about. Opening a second
  shuts the first, and hover moves between pills the way a menu bar does.
- **A pill that stops being offered takes its open panel with it.** Otherwise a filter you
  can still change is a filter you can no longer see, which is the failure this whole
  control exists to prevent, arriving through the door marked *fixed*.
- **The panels hang off the nav, not off the pill.** A 260px panel anchored to a pill two
  thirds of the way across a 360px phone opens off the side of the screen. Anchored to
  `.filters` they all open at the page margin, 16px in, wherever their pill wrapped to.
  The `#filters .filter-panel { right: 0 }` special case bc-khoe.24 needed is gone with
  it, and so is the reason it had to be scoped to one page.

**It wraps, and the pills wrap *with* the scope switch rather than under it.** The switch
is 214px measured and the three pills are another 431, so on a phone this is more than one
line whatever is done. What decides how many is whether a pill may share a line with the
switch, which is why `.filter-menu` is `display: contents` — its pills are items of the
nav's own flex row. Measured against the real stylesheet at three widths, nav height, shut
and open (they must agree, because `paintScrollPos` in `public/app.js` takes this nav's
bottom edge as the line a card has to clear to count as the one you are reading):

| width | lines | `.filters` height | open panel |
|---|---|---|---|
| 360 | 3 | 134px | 16…344, on screen |
| 393 — the phone this is thumbed on | 2 | 92px | 16…377, on screen |
| 900 | 1 | 44px | 420px wide |

Boxed rather than `display: contents`, 393 is three lines and 134px too: the 84px beside
the switch goes to waste and the bead pill has nowhere to be but a line of its own.

The view pill row is untouched and still fits a 360px phone without wrapping: it is a
different row (`.viewbar`), and the wrapping above is the filter row growing below the
scope switch rather than anything being added beside the views.

`node test/inboxkinds.mjs` drives the row against a hand-made document — the pill at rest,
the narrowing on its face, the note where a pill has gone, one panel at a time, and the
panel that closes with its pill. `node test/historyfilter.mjs` does the same for the
ledger's four, and `node test/beadsearch.mjs` for the typeahead, whose query is
deliberately *not* a narrowing while the ledger's id box deliberately is.

### ＋ belongs to the view, so two of the six do not have one

＋ always means *new*. What *new* is belongs to the screen you are on rather than to the
button — and once the kinds became five screens rather than one list, a single ＋ drawn
across all of them was a control whose meaning depended on a pill it did not look at.

| Pill | ＋ | Because |
|---|---|---|
| **Home** | yes | File a bead — the same form All Beads opens (bc-fwp2c) |
| **My Epics** | yes | Take a bead and make it an epic of yours (bc-khoe.27.2) |
| **Questions** | **no** | A queue of things waiting on a word from you |
| **PRs** | **no** | The same, arriving off `gh` |
| **Chats** | yes | Start a conversation — what ＋ has always done |
| **All Beads** | yes | File a bead, from a form (bc-khoe.27.3) |
| **Ledger** | — | A page of its own, and it never had one |

**Questions and PRs are the interesting half.** Neither is a place you make something;
both are lists of things somebody else has put in front of you, and the only honest
label a ＋ could carry on either would be "make yourself another thing to answer". A
button that has to invent a purpose to justify being drawn is one that should not be.

`compose` is a field on the kind, one row of `KINDS` beside its predicate and its icon,
for the same reason the predicate is there: a list of ids in `public/app.js` would be a
second file that knows what the six kinds are, and nothing would say which of the two
was wrong. `composes()` answers it for whichever pill is lit — derived from `current()`
rather than stored, because `revealPr` and a scope change both move which kind you are
on without a pill being tapped.

**It names the create rather than merely admitting to one** (bc-khoe.27.2). The value is
the word for what ＋ makes here — `epic`, `chat`, `bead` — and `creates()` hands that word
to the one click listener in `public/app.js`, which branches on it. A boolean would have
sent that listener looking somewhere else for what to do, and the somewhere else is always
a second list of kind ids, which is the thing this table exists to make unnecessary. Absent
is still the third answer and still the important one: `composes()` is `Boolean` over the
same field, so a row with no `compose` draws no button. The `bead` row said `chat` for as
long as ＋ on All Beads started one, and became `bead` the day the [create
form](#a-bead-you-file-yourself-from-the-form-behind-) landed behind it (bc-khoe.27.3) — a
row promising a create nobody wrote is a button that does nothing when tapped, so the word
moves with the thing it names and not before.

There are two panels above ＋, and it opens whichever one its kind names: `#compose-pick`
asks which repo to start a chat in, `#compose-epics` offers [the epics you could
start](#starting-an-epic-from-the-board-and-taking-one-off). Both live inside the fixed
`.compose-wrap`, so hiding the wrapper hides them, and `hideComposePick` shuts *both*
whichever was open — the one that is open belongs to the kind you just left.

**The third create is not one of those panels**, and the asymmetry is the form's size
rather than an oversight: `bead` opens `#beadform`, a full `.sheet` over the list, because
eight fields do not fit in a panel the width of a button. So `public/app.js` guards that
branch on the sheet's *markup* as well as on the word — a phone can be running today's
script against last week's document for one load, and a ＋ that silently did nothing would
be worse than the chat it replaced, so a missing `#beadform` falls back to the chat.

**Three things move together in `public/app.js`, and any one of them moving alone is the
bug.** `paintCompose` does all three on every change of kind:

- **The button**, hidden on the `.compose-wrap` rather than on `#compose`, so the repo
  picker anchored above it goes with it. `hidden` alone loses to `display: flex`, which
  is why the stylesheet carries a rule for it — a ＋ still drawn while the padding is
  gone covers the last card of the list.
- **`body.has-compose`**, which reserves the button's height at the foot of the scroller
  and lifts the toast clear of it. It used to be added once, at load, as a record that
  the script had wired ＋ up at all, and never removed; on a kind with no ＋ that is 76px
  of nothing under the last card, which reads as a list that failed to finish loading.
- **The picker**, closed on *every* change of kind rather than only the ones that take
  the button away. It was opened to answer "which repo do I start this in", and on the
  three kinds that keep ＋ the create it belongs to is a different create.
- **What the button says it does**, since bc-khoe.27.2 — its `aria-label` and the
  `aria-controls` naming the panel this kind's tap opens. The label is the only thing on
  this control that says what a tap will do, and a ＋ announcing "start a chat session" on
  the screen where it starts an epic is worse than an unlabelled one: a screen reader would
  be reading out the wrong promise rather than none.

A page served without `public/inboxfilter.js` draws ＋ anyway. That is the generous
fallback on purpose: a cached document against a script that never loaded is a state
this app is built to survive, and losing the primary action to a missing file is a worse
failure than drawing the button one screen too wide.

`node test/composekind.mjs` drives `paintCompose` in a `vm` — both directions of the
padding, the picker outliving its button, the picker outliving a kind change that keeps
it, and the fallback — and `node test/inboxkinds.mjs` holds the table to the three and
the three.

### A bead you file yourself, from the form behind ＋

`All Beads` is every live bead in the tracker nobody is asking you about, which makes it
the one screen where *file another one* is the obvious next thing to do. ＋ there opens a
sheet — title, type, priority, description, acceptance, parent, labels, and the workspace
it lands in — and filing it creates the bead.

**It is not the chat console, and the difference is what you already know.** The console
is right when the question is *what should be filed*: an agent argues a proposal into
shape and you edit the cards it draws. It is the wrong tool for a bug you just hit, or a
thing you noticed two rows down this very list — a create whose turnaround is measured in
replies is not a create. The fields are the console's all the same, in the console's
order, with the same `.field` markup and the same chip rows, because two editors for one
bead shape that drifted apart would be two answers to "what is a bead" with nothing saying
which is right.

**One `bd create`, two doors.** `createBead` in `lib/server.js` is the whole of the write,
shared with `POST /api/console/create`, which now calls it once per card in the draft.
The alternative was a second create with the same eight fields beside the first, and the
two would then have been free to disagree about which labels survive, where a
[declared surface](android.md#a-card-says-which-files-its-bead-expects-to-touch) goes, and whether `created_by` is
stamped. What the form decides on its own is only what a form has and a draft does not.

**What it is deliberately not is `fileBeads`.** That is the seam an *agent* files through
(`lib/filing.js`), and it stamps what an agent-filed bead has to carry: `unendorsed`,
`agent-filed`, a `discovered-from` edge, and a provenance note that opens "Filed by an
agent". None of that is true of a bead you typed, and one filed from your own phone
arriving held for your own endorsement reads as a bug in the tracker rather than as a
policy. `node test/beadform.mjs` asserts the absence of all four by name on the argv `bd`
was really spawned with, because it is the sort of thing a later tidy-up puts back.

**Parent is the field the form exists to have.** Per this tracker's own discipline a bead
with nothing decided above it is not workable — no advocate queues it and no session opens
on it — and `underOwnedRoots` draws only what descends from a root you own, so it is
invisible as well as held. A create that quietly made those would be a button for filing
beads nobody will ever see. So blank does **not** mean parentless: it goes through the same
[filing seam](landing.md#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists)
every agent-filed bead does, and lands under the repo's `unsorted` root. Five states, and
they are five different sentences:

| What you typed | What happens |
|---|---|
| A bead id that exists | Filed under it, untouched |
| A bead id that does not | **400**, and nothing is filed — a blank field is "you decide" and a typo is not |
| Nothing, and the repo has an `unsorted` root | Filed under that root, and the reply says which |
| Nothing, and it has roots but no pile | Filed parentless, with a warning naming the `unsorted` label as the fix |
| Nothing, and it has no roots at all | Filed parentless, and **no** warning — the gate fails open, so the bead is workable and a hold nobody is applying would be a false claim |

**Which repo is the same question ＋ already answers for a chat**, from the same
`startableRepos`: `space.inside()` is what the picker in the top bar allows. One candidate
is stated rather than asked about, more than one is a chip row, and a workspace the picker
stops allowing while the sheet is open does not stay selected — filing into a repo you are
not looking at is the one thing that filter exists to stop.

**A refusal stays on the sheet.** bd's own first line, in the form, with everything you
typed still in it; a create that failed and closed would be a bead you have to write out
again to find out why. Warnings are the same and for a sharper reason — "filed with no
parent, so nothing will work it" is a sentence you have to be able to read twice, and a
toast is gone in 2.6 seconds. A clean filing closes the sheet, toasts the id, and the row
arrives in the list off the `created` bus event without a reload.

`node test/beadform.mjs` drives the real route against a `bd` that records its argv — the
fields as typed, all five parent states, the refusal, the labels guard — and lifts the
form's own painting into a `vm` for the workspace row.

### The scope is a control you can see

`Human`, `Both`, `Agent` — three words on the chrome, above the list and in front of
everything else in the filter row. It is the coarsest control this page has, because it is
the only one that changes what gets **fetched**: `human` sweeps the questions, `agent`
sweeps the live beads nobody is asking you about, `both` does both. Every other filter on
Home narrows rows already in hand; this one decides what Home is *able to contain*.

It spent a while as the `Show` group inside the collapsing panel, on the argument that two
collapsing controls side by side would be the three permanent rows of chips again with
extra steps. That was the wrong trade and bc-khoe.24 undoes it. A control you have to open
something to see is a control you forget is set, and the cost of forgetting this one is a
screen that is empty for a reason that is off screen — which is the same complaint that
promoted the ten kinds out to [the pill row](#one-list-six-kinds--and-the-two-sub-filters),
and it has the same answer.

**It is a segmented switch and not a pill that opens three chips.** Three options with
exactly one always armed is the definition of a segmented control, three words fit across a
360px phone, and a pill saying `Human ▾` would cost a tap to change and put the choice back
behind something you have to open. The look did not change with the move — it is the same
`.chip-row.scopes` banding it had inside the panel, in front of the filter pills instead of
inside a panel with them — so somebody who used the old one finds the same control in a
place they can see.

**The mechanism is `public/filterpills.js`, and it is deliberately more general than one
switch.** A group here is exactly the descriptor `public/filtermenu.js` takes —
`{ id, legend, all?, multi?, options(), pick(id), hidden?() }` — so moving a filter between
the two containers is editing which list it is handed to, rather than rewriting it. It paid
for itself within the day: bc-khoe.26 took the bead search and the two status sub-filters
out of the collapsed panel and gave each of them a pill, and not one of the three
descriptors changed. Two shapes are refused rather than half-drawn out here: a `text` group
(the typeahead genuinely wants a dropdown under it, which needs somewhere to open into) and
`said`/`narrowing` (they are about what a pill says about itself, and there is no pill here
— the chips are on screen, so they are the whole statement). A refused group is a
`console.warn`, not a silent skip, because a filter the page believes it drew and has not
is the worst of the three outcomes.

Two properties are load-bearing and neither is visible by reading the file. `paint()`
touches text and attributes only and rebuilds a group's chips only when the *set* of option
ids changes, because the inbox repaints every 25 seconds and a row rebuilt on that clock
drops the focus ring off a chip somebody is tabbing through. And **nothing in `.filters`
may set `overflow`**: a panel opened beside the switch is absolutely positioned so it draws
*over* the list, and a scroll container on either axis makes the other one `auto` too,
which would clip that panel to the 34px line it hangs off. A narrow phone gives the width
up by wrapping instead, and the switch never shrinks.

**And the controls beside it have to fit somewhere.** That is the one thing the move broke
and it is invisible outside a browser: a 260px panel hanging off a `.filter-menu` the
switch pushes to x=240 on a 360px phone runs 140px off the side of the screen. bc-khoe.24
answered that by right-anchoring it (`#filters .filter-panel { right: 0 }`), which was only
ever safe while the menu was the *last* thing on its row. bc-khoe.26 answered it at the
root and took that rule out: `.filters` wraps and is the panels' containing block, so they
open under the whole nav at the page margin on both pages — see [one pill per
filter](#the-filter-panel-comes-apart--one-pill-per-filter) for what that measures at.

What did **not** move is what the switch does. `chooseScope` in `public/app.js` is still
the one place that stores the preference, drops selections the new scope cannot produce,
and refetches — and since bc-khoe.25 it is also what the `All Beads` pill goes through when
the tap needs a wider scope than the one you are on. And it is
still this device's preference and nothing else's: `beadcause.scope` is read and written in
`public/app.js` alone, so **changing scope cannot change what rings your phone** — that is
the space picker's, stored on the server, where the push path can read it.
`node test/filterpills.mjs` covers the switch, the repaint, the refusals and all four of
those wirings; `node test/inboxkinds.mjs` still covers the panel it left.

### Finding one bead

The chips answer "what *kind* of thing"; the box under them answers "which one". It sits
in the collapsed panel, behind the line the scope switch now sits in front of, and it is a
typeahead: type any part
of a bead id — or any part of a title — and the matches drop down, narrowing as you type.
Click one and it becomes a pill with an × beside it, and the inbox is that bead and every
bead under it. Take the × off and the list comes back. Several pills at once mean the
union of their trees, which is the only reading a pill with its own × supports: removing
one has to leave the other's rows on screen.

Four things about it are decisions rather than defaults.

**It searches every workspace at once, not the selected one.** You type `rfnr` because
you know the bead, not because you have first remembered which tracker it is in. Every
suggestion carries its own `workspace/id`, so a pick is unambiguous even where two
trackers hold the same id.

**It matches titles as well as ids**, and it ranks the id matches first — exact id, then
ids starting with what you typed, then ids containing it, then titles. The dropdown shows
the title beside every id either way, and a box that displayed a title and then refused to
match it would read as broken rather than as scoped. The ordering is `lib/beadsearch.js`
and `node test/beadsearch.mjs` is the whole of it.

**A picked bead means that bead and its descendants**, following `parent-child` edges
alone — a `discovered-from` trail does not drag half the backlog in. That is the answer
the rest of the app already gives: the epic board keys rows by the P0 they descend from and
a P0 card expands to every descendant at any depth, so a filter that showed one bead and
hid its six children would be the only place in the inbox where "this piece of work"
meant one row. It is also the answer that **replaces** the epic board's own narrowing rather
than stacking on it — half the beads worth searching for are under somebody else's P0 or
under none at all, and stacked, the commonest search on a shared tracker would end in an
empty list with a pill on screen naming the bead it was hiding. An explicit filter
outranks an implicit one.

**Nothing is stored.** The kind pills' selection lives in `localStorage` because "I read merges" is a
standing preference; a picked bead is not one, and an inbox that opened narrowed to a bead
you had forgotten about would be worse than one that opened wide. It is also why the box
empties itself on a pick: the question it asked has been answered, and the next word you
type is a *second* bead rather than a correction of the first.

Two routes behind it, and the split is about cost. [`GET
/api/beads?q=`](operations.md#http-api) is the dropdown — it is the one route in the app that can be
asked once per keystroke, so it reads the graph `Bd.graph` already caches and never waits
on a `bd export` (nine of those were measured at 7.3 seconds on this Mac). It reports
`warming` for any workspace it has not read yet, so a cold daemon says *still reading the
trackers* rather than telling you a bead you filed a minute ago does not exist. [`GET
/api/bead/tree`](operations.md#http-api) is the pick — one request, once, and it waits, because a cold
cache answering "nothing is under this" would narrow the list to a single row and look
exactly like a working filter.

Shipping the id-and-title index with the inbox payload and matching on the phone was the
obvious alternative and it is much more expensive than it looks: 938 beads in `beadcause`
alone on 2026-08-14, 97KB of `{id,title}` JSON, times nine workspaces, on every 25-second
poll, to answer a question that is asked for about four seconds a week.

### Beadepic — the word on the screen for a bead epic

A work workspace with JIRA on puts two different things called *epic* on one phone: the
bead of type `epic` that beadcause files for each ticket assigned to you (and every other
bead epic on the board), and JIRA's own **Epic** issue type, which a ticket may *be* or
may sit under. Two things called epic on the same card is how somebody approves the
wrong one. So the screen says **beadepic** for the bead kind — `My Beadepics`, *Start a
beadepic*, *Beadepics assigned to you*, the monitor's cards, the docket index — and
leaves the bare word to JIRA, where the ticket card's type pill still reads `Epic` for a
JIRA epic (bc-6s383).

It is a word on the screen and nothing else. `bd`'s issue type is still `epic` (the type
pickers offer it by that name, because that is what `bd create --type` takes), and so
are the code, the routes (`/epic`, `?view=epics`), the config keys
(`maxEpicAdvocates`) and the agent role — an **EpicAdvocate** is still an EpicAdvocate,
because that name is a label on beads and a word in agents' briefs, not a UI label.

### Epics assigned to you, and the tree each one carries

The section at the top of the inbox is the **roots you have started** — `owner:<you>`,
either an epic at any priority or a P0, and `in_progress` rather than merely open
([why](#the-board-is-the-epics-you-have-started)) — and `rootboard` on `/api/questions` is
where it comes from. Each card says its priority, what is left under it (`open`,
`inFlight`), what it is waiting on once an Epic Advocate has written one
(`lib/epicadvocate.js`, and the 🧭 button on the card is
[`POST /api/bead/advocate`](operations.md#http-api)), and, since bc-rfnr.9.1, **`tree`: every descendant
of that root at any depth**. Since bc-s8mc it also carries `startable` — the roots of
yours that are *not* on the board and could be, which is what [the picker ＋ opens on My
Epics](#starting-an-epic-from-the-board-and-taking-one-off) draws.

The tree is not the row filter seen from the other end, and that is the whole reason it
exists. `rootboard.under` is a fact about the *inbox rows* — one string per row naming the
root it descends from, which is what lets the list narrow itself to your work. It is keyed
by row, and most of a root's descendants have no row, because nobody is being asked about
them: `bc-rfnr` had 16 descendants and one pending question the day this landed. A card
drawn from `under` would have said "16 open" over a tree of three.

So the tree is built from the graph instead, and it arrives **flat**:

| field | what it is |
|---|---|
| `id`, `title`, `issue_type`, `status`, `priority` | what a row draws |
| `assignee` | who claimed it — not `owner`, which is the git identity that created the bead and is the same one on most of the tracker |
| `parent` | the id it hangs off. Always the P0 itself or a row **earlier in the array** |
| `depth` | 1 for a child, 2 for a grandchild — an indent with no walk at all |
| `key` | `<workspace>/<id>`, the same key the inbox rows are filed under |
| `pending` | whether this bead is itself asking you something — open, and carrying `human` |

Pre-order, parents before children, so a client nests it with one loop and a map. Real
nested objects would cost a recursive renderer on a phone and could not be reconciled by
key, which is how every other list in this app repaints.

`pending` is read off the label rather than off the rows below, and that is deliberate:
`/api/questions?scope=agent` sweeps no questions at all, and the board is drawn in every
scope, so a rows-derived answer would go quiet about a bead that is genuinely waiting on
you — a question on a screen that will not show it, which is the one failure this app
exists to prevent. An open bead carrying `human` *is* a question here; answering one
takes the label back off.

**Closed descendants are in it.** The counts on the card are of what is left, but the
tree is the board, and the one status filter over the whole board (bc-rfnr.9.6) can only
default to not-closed if the closed ones were sent. Measured on this tracker on
2026-08-13: 18 owned P0s, 152 descendants between them, **31KB** of JSON, half of it
rows that have closed.

It costs no extra `bd`. The whole board — the cards, `under`, and every tree — comes off
one `bd export` per workspace, cached for a minute by `Bd.graph` and **never built on
the request path**: nine of those measured 7.3 seconds cold, and bc-1kwl's budget is a
page under a second. So a cold daemon answers with an empty `roots` for a repaint or two
and then fills in, which the client already reads as "do not narrow anything" — the flat
inbox, briefly, rather than an empty one. A workspace whose tracker cannot be read
contributes no cards and hides nothing, for the same reason. `node test/p0tree.mjs`
holds all of that, including the one assertion that separates the feature from `under`
renamed: a descendant with no pending question is in the tree.

### The board is the epics you have started

A card is drawn for a P0 you own **whose status is `in_progress`**. Raising a P0 does not
put it on the board; starting it does — from the phone, with [the picker ＋ opens on My
Epics](#starting-an-epic-from-the-board-and-taking-one-off), or on the Mac with `bd
update <id> --claim`. The P0s that are off the board are still reached the way every other
bead is as well, through search and the bead sheet.

The rule used to be *not closed*, and the count is the argument. bc-6s96 measured the
board across all nine workspaces on 2026-08-16: **~42** owned P0s not closed against
**9** in progress; this repo's own tracker on 2026-08-17 was 18 against 4, the same shape.
A section that draws all 42 is a backlog under a heading that says "Epics assigned to
you", and what it costs is the one thing the board is for — the top of the inbox stopped
being a picture of the week and became a list you scroll past to reach the questions.
Closed was already off it for the same reason from the other end: a P0 that landed is not
something to lead the screen with. Open-but-not-started is that sentence's other half.

**The flat list below follows, and that is a decided consequence rather than a side
effect.** The list is narrowed by `p0board.under`, which is keyed on the same roots the
cards are — so a question hanging off a P0 you have not started leaves the inbox with its
card. It is not moved anywhere, nothing is deleted, and it comes back the moment the epic
is started. That is acceptable because it is already true that nothing is dispatched under
an epic you have not begun; a question there was waiting on a screen you were not reading.

**What it must not do is come back as `unhomed`,** and that is the one line of this that
could have gone quietly wrong. That map means *no open P0 above this bead at all* — the
thing that rescues a question filed with no parent — and it is false here, because the
unstarted P0 is open and is above the row. So `p0Board` keeps two root sets that now
disagree on purpose: the cards' (yours, started) and `unhomed`'s (anybody's, open). A row
under an unstarted P0 of yours is in neither, which is exactly the "hidden, and honestly
so" that somebody else's P0 has always got. `node test/ownquestion.mjs` pins all four
shapes against each other — under a started P0 of yours, under a colleague's, under one
that closed, and under one you have not started — because the only way to be sure about a
map with a hole in it is to stage every shape at once.

**With nothing started, the board is empty and the whole section switches off.** The
client draws the flat inbox when `p0s` is empty — the same branch a cold daemon takes for
a repaint or two — so the screen you get for having started nothing is the inbox this app
had before the board existed, not an empty one.

**The dispatch gate is untouched, and the two are meant to differ now.** Workability still
means an *open* P0 above (`lib/underp0.js`): that gate asks "did anybody decide this work
should happen", and raising a P0 is that decision whether or not you have got to it.
Narrowing the gate to started epics would have stopped the advocate on five sixths of the
tracker overnight, which is a rule about a screen reaching into the queue.

### Starting an epic from the board, and taking one off

The board is what you have started, so there has to be a way to start something without
leaving the inbox — otherwise the one screen that says what the week is about is the one
screen that cannot change it, and the answer to "this is what I am on today" is a laptop.
**The ＋ on My Epics is that way in.** It opens a picker of the P0s you own that are open
and have not been started, each with the same "N open" count the cards carry, in the same
order the board uses — most still open first, because a picker sorted by id would put
whichever epic was filed first at the top for ever. Choosing one writes
`status: in_progress` and it is a card on the next poll.

**It was a `+ Start an epic` button at the foot of the board until bc-khoe.27.2**, and the
move is [＋ belonging to the view](#-belongs-to-the-view-so-two-of-the-six-do-not-have-one) rather than a relocation for
its own sake: *new* means a different thing on each of Home's five kinds, and on the board
it means this. Three things came out of it beyond one button instead of two. The control is
in the bottom corner where a thumb is, rather than at the far end of a scroller past every
card on the board. The picker no longer has a scroll to protect — it used to open *above*
the inbox list, so growing the board pushed the page down by the height of what had just
opened and took the button you pressed off the screen, and the repaint was wrapped in
`keepTheScreenStill` for exactly that; the panel is inside the fixed wrapper and adds no
flow height at all, so the jump is designed out rather than held still. And an empty board
draws nothing where it used to draw a bare offer — the offer had to be reachable with
nothing started, which is why that section existed, and a button that is always on screen
is a better answer to the same requirement.

The panel is filled when it opens rather than on every repaint, which is the one thing that
got weaker: at the foot of the board the list was rebuilt by every poll and could never be
more than a tick stale. That is deliberate — rebuilding a floating menu under an open
finger moves the row being reached for — and it costs nothing, because the write was always
built for a stale list. See the refusals below.

**A status write, deliberately, and not a phone-local pin.** One source of truth: the
advocates, `bd list`, the console, the other Mac and the screen in your hand all agree,
and `bd show` says `Started:` afterwards. A pin would have been cheaper and would have
made the board a thing only this phone believed.

**The reverse is on the card** — `↩ Take it off the board`, back to `open`, which is the
same tap undone. It leaves the assignee alone: who is on the work is a different fact from
what leads your screen, and a screen decision must not quietly erase it. It is also *not*
[pausing the epic's advocate](#pausing-one-epic--the-button-that-stops-dispatch-under-a-p0-without-stopping-the-repo), which stops dispatch under a P0 and leaves
it started — the two are different axes and compose. Nothing is lost either way: an epic
taken off is open, owned and one tap from the picker again.

**Four beads are never offered**, and each is a tap that would have been refused
downstream: an `unendorsed` one (nobody has said the work should happen — the answer to it
is the endorsement queue), a superseded one (the job is somewhere else), a **crash**
(`lib/errors.js` files every daemon crash at P0 with an owner, so a bad week would fill the
picker with stack traces — a stack trace is not an epic, the same sentence the advocate
launch makes), and a `blocked` one (the tracker says it cannot move, so a card claiming the
week is about it would be the screen contradicting the graph). `bd` is still there for the
case where you mean it.

**Every refusal is loud and on screen.** `POST /api/bead/start` answers 409 with a
sentence for each of those and for the races the picker cannot see — the bead closed, or
started from the other device, since the list you are looking at was drawn — and the
button says it rather than leaving you with a card that never appears. The rules are
checked again at the door rather than trusted from the client for exactly that reason: the
picker's list is up to one poll old.

**And it appears without a reload.** The write refreshes that workspace's `Bd.graph`
entry, so the next payload is built from a graph that knows — without it the card would
take up to a minute to turn up, the write having worked and the screen having nothing to
say about it. The phone that tapped re-polls immediately; every other device is woken by a
`p0board` event on its parked log request. `node test/p0start.mjs` holds both halves — the
picker's list and the two writes, against a fake `bd` that really changes its mind.

**And one thing about it is only visible in a browser.** The picker opens at the foot of
the board, which is *above* the inbox list — and `capturePlace` anchors the page's scroll
on the first card in that list, so a repaint that grew the board scrolls the page down by
exactly the height of what just opened: the button you pressed leaves the screen. The fix
is `keepTheScreenStill`, the same one bc-rfnr.9.4 needed one surface along, and nothing in
the HTML shows whether it is there. `node scripts/p0start-check.mjs` is the half a string
cannot reach — a real tap in headless Chrome at 393×852, reading `getBoundingClientRect()`
before and after. Measured with the call taken out: the button moved from 467px to 318px
under the thumb.

### The board is a grid, and tapping a card opens it full-tab

The comment over `.p0-card` used to say these were the four or five things the week was
about, and the board was a single vertical stack of full-width cards on that premise. It
has never been four or five. Until [bc-6s96](#the-board-is-the-epics-you-have-started) it
was every open owned P0 — about two dozen on this tracker — and since bc-6s96 it is the
ones you have started, which was nine. Either number is a column you scroll rather than
scan on a phone, and on a desktop it is one narrow ribbon down an empty page whatever the
count. And a tapped card unfolded its tree *inline*, between the board and the inbox
list, which is both cramped and the whole of how bc-rfnr.9.9's scroll jump was possible.

bc-grut is three changes, and each one is the reason for the next.

**The cards are a grid**: `.p0-cards`, one across on a phone, two from 640px, three from
960px. The cards did not have to change shape to do it — they were always a column of
short lines — but the track sizing did: `minmax(0, 1fr)` rather than `1fr`, because a
grid track's automatic minimum is its content and a bead title is one unbroken
60-character string often enough that plain `1fr` lets a column bid wider than its share
and pushes the third card off the row. `.p0-acts` takes `margin-top: auto` at the same
time, so the advocate button and the graph link land on one line across the row instead
of following each card's own last line of text; a grid item stretches to its row, and
controls that stepped up and down with the length of the titles are the thing that makes
three cards side by side unreadable.

**A collapsed card says enough to be worth scanning across.** The id, how much is in
flight, how much is open, the title, the advocate's sentence if there is one — and then
two things bc-grut adds. A **progress bar with `12 of 19 done` under it**, which is the
number the open count can never give you: "9 open" says nothing about whether the epic is
nine of ten or nine of sixty, and a proportion is the only thing on a card that can be
taken in without being read. And an **`N ask you` pill** when anything under the epic is
itself a question, because on a grid of cards read in one pass that is the one field
that means *you* are the thing holding the epic up. Neither is counted through the status filter,
which matters — see below. An epic with nothing filed under it gets "Nothing filed under
it yet" instead of a bar at zero, because a bar at zero claims that nothing has landed
where the truth is that nothing has been written down.

**And the tap takes the whole tab.** `p0FullHtml` is a fixed layer over the viewport with
the four rows `.card.open` has always used for an inbox row: a top bar carrying the only
way back, a head that stays, a body that scrolls on its own, and the acts pinned to the
bottom where a thumb is. The way back says `‹ Board` rather than a cross, because a cross
leaves you guessing whether it closed the epic or the app. It takes that shape at *every*
height, unlike `.card.open` which falls back to scrolling whole below 440px — there is no
composer here, so nothing on the layer needs to stay above a keyboard.

Inside it the tree is what it always was: indented under each parent, one row per
descendant at any depth. A row says the bead's id and title, marks it **asks you** when it
is itself a question (`pending`), and names any status that is not `open` — sixty rows all
saying `open` is the default restated sixty times. Closed work is struck through and faded
where it is drawn at all; whether it is drawn is [the status
filter](#one-status-filter-in-the-tab-with-the-tree-it-narrows), which defaults to not and
lives in the tab with it. Each row is a disclosure of its own bead — see [the next
section](#and-a-bead-in-the-tree-opens-where-it-stands). A P0 with nothing under it opens
to a sentence saying so — an empty gap reads as a tree that failed to arrive.

**This ends bc-rfnr.9.9 by construction rather than by correction.** That bug is the
board's own tap scrolling the page out from under you: `capturePlace` anchors on the first
`.card` in the list and faithfully holds it still, so six hundred pixels inserted *above*
the list moved the page down by six hundred pixels. A layer over the tab inserts nothing
into the flow at all, so there is no height to hold still and no scroll to jump.

What the layer does need is the other half of that: `capturePlace` now records
`.p0-full-body`'s own `scrollTop` and `restorePlace` puts it back. The tab is a scroller
that is not a `.card`, so the anchor cannot see it, and it lives inside the one reconcile
chunk that any moved count on the board replaces whole — without this a 25-second poll
drops you back at the top of a sixty-row tree.

**At most one is open at a time**, which the `p0` handler enforces by clearing the set
rather than deleting one key. It is the accordion `openOnly` keeps for `.card.open` and
for the same reason: a second fixed layer stacks on the first with nothing on either
saying which epic you are reading. Escape closes it — behind the two menus and only when
neither was open, so one press never dismisses two things — and focus follows the layer in
both directions, to the way out when it opens and back to the card it came from when it
shuts, because delegation cannot do that for you and the alternative is a Tab that starts
again at the top of the document.

**And Tab wraps at the layer's own edges rather than leaving it** (bc-ywiy). Moving
focus in and back was only two of the three things `role="dialog" aria-modal="true"`
implies — the third is that Tab from the last control lands on the first and Shift-Tab
from the first lands on the last, which nothing here did until now. Caught by the
shared `keydown` listener that already closes the layer on Escape: it looks the tab
up fresh — `document.querySelector('.p0-full')` — on every keypress rather than
holding a reference, because a poll replaces this node whole every 25 seconds and a
held reference would be trapping focus in a layer already thrown away. Part of
[the same check](agents.md#allow-tools--for-one-comment-and-only-that-one) as the drawer and
the tools-arming warning.

Two things about the tree itself are less obvious than they look.

**The indent is capped at three steps.** The rows arrive flat with a `depth` each, and
the client turns that into `margin-left: calc(var(--d) * 13px)` — a margin rather than a
padding, so a deep row's box *narrows* and its title wraps inside the card. Past the third
step it stops stepping. This tracker nests six deep (bc-rfnr.9.2.1.1 is a great-grandchild
of an epic that is itself a child), a phone is 360px wide and a bead title needs most of
them; an indent that kept going would push the sixth generation off the right edge, and an
element wider than the screen does not scroll on a phone — it shrink-fits the whole page,
so every other card pays for it too.

**What is open is page state, and that is what makes it survive a poll.** The board is
drawn as *one* reconcile chunk (`warm.paint` keys it `@p0`), because every count on it
comes from one sweep — so any repaint that moves a single number replaces the whole
section's HTML. An `open` attribute on a `<details>`, or a `hidden` toggled on a node,
would therefore fold up under your thumb every 25 seconds. The open card key lives in the
page's state, the section is rebuilt from it on every render, and the tap does nothing but
write to the set and repaint. It is not persisted across a reload, unlike the filter:
which epic you are reading is where you are looking *now*, and a phone that came back to a
tab over the inbox would be a screen you had to dismiss before you could see what you
opened it for.

`node test/p0card.mjs` runs the real renderer out of `public/app.js` in a `node:vm` — no
browser, no `bd` — over a fixture nested five deep: that a collapsed card draws no tree at
all and does draw its progress and its `asks you`, that an open one draws every descendant
in the server's order, that the indent steps and then stops, that only the tapped card
opens and only one tab is ever drawn, that the card's numbers do not move when the filter
does, that the same state renders the same board twice, and that the tap handler writes
state rather than reaching into the DOM.

`node scripts/p0grid-check.mjs` is everything in that list that is a *measurement* rather
than a string, over six epics in headless Chrome at 393px, 760px and 1280px: that one row
is one card, then two, then three; that the controls line up across a row rather than
following each card's own last line; that the tab's four edges are the viewport's four
edges, which is the one thing a `position: fixed` inside `#list` can lose to any ancestor
with a `transform` on it while every rule and every attribute stays right; that a bead
title with no spaces in it does not push its neighbours off the row, which is the whole
reason the track is `minmax(0, 1fr)`; and — bc-rfnr.9.9, read the way that bug was
measured — that the card you tapped has the same `top` after the tab has opened and closed
again as it had before you touched it.

### And a bead in the tree opens where it stands

A row used to be a link into [the dependency graph](#what-a-question-is-blocking) at that
bead. It works, and it is the wrong tap: the graph is another page, in a drawer, over a
force layout you have to find your bead in and then come back from — three gestures to
read one description, on the screen you opened *because* you wanted to read the tree. A
graph you have to come back from is a graph you stop opening.

So the row is a `<button>` and the tap expands it in place, into the same details the
inbox card gives a question — priority, type, owner, every label the tracker holds,
what it is under and what it is behind, the description, the acceptance criteria, the
design and notes, and the whole thread. The graph is still one tap away and is drawn
*inside* the expansion, on the bead you actually tapped rather than on the card above it.

Three things about it are the bead.

**It renders from bead data alone.** This app already had one full bead view and it is
built out of a *pending question*: parsed options, a box to answer in, a dismissal. Most
beads under a P0 have never had a question and never will — bc-rfnr had 16 descendants
and one pending question the day the board was written — and that view drawn over one is
a card offering to answer something nobody asked. So the expansion reads `/api/bead`,
which is `bd show` plus the thread and is the same route [the graph's detail
sheet](#tap-a-bead-then-open-it) paints from, and draws what is there. Anything a bead does
not carry is simply not drawn, so a one-line bead opens to one line.

**It goes between a bead and its children, not over them.** The tree arrives flat and
pre-order, so a bead's children are the rows immediately after it; the block is inserted
after the row, and everything under it stays exactly where it was, one indent further in,
still tappable and still expandable itself. This is the half of the acceptance that is
invisible in a screenshot of a leaf — an expansion that replaced the rows under it, or
appended itself at the end of the tree, would look right on every bead with nothing filed
under it. It is also why this is not an accordion, unlike the inbox's cards: opening a
child would close the parent you opened it from, and the parent is the thing holding the
child's place.

**The details are fetched on the tap and never on the poll.** The tree rows the server
sends carry an id, a title, a status and a depth — enough for sixty rows and nothing like
enough for one bead, so the rest is a `bd show` each. One per deliberate tap is a fair
price; one per open bead every 25 seconds is a phone parked on the inbox spawning `bd`
forever, and a description does not move on its own. What *does* move is the thread, so
the fetch runs again on every open — and the copy already in hand stays on screen while it
does, because taking a bead off the screen to fetch the same bead is losing your place for
nothing. A tap whose call has not landed says `Reading bc-… from bd…`; a refusal says why,
naming the bead; a failed *refresh* over a bead you are already reading says neither and
keeps the text.

Which beads are open lives in `state.p0beadopen`, a second set beside the cards' own and
for the same reason: the board is one reconcile chunk replaced whole every 25 seconds, so
an expansion held as a class on a node would fold up under your thumb. Two sets rather
than one because a card key and a row key have the same shape, and "is this open?" asked
of the wrong kind of thing would not even be visible.

`node test/p0bead.mjs` runs the real renderers out of `public/app.js` in a `node:vm` over a
fixture bead carrying no question at all: that the details draw from bead data and none of
the question card's controls appear, that the expansion lands between a bead and its
children with the tree still in pre-order, that two beads open at once, that reading,
refused and refreshing are three different screens, that a reopened bead does not carry the
reason it closed last time, that the parent is never drawn as something the bead waits on,
and that a label out of the tracker cannot write markup into the board.

`node scripts/p0bead-check.mjs` is the half a string cannot reach — a real tap in headless
Chrome at 393×852, against a fixture `/api/bead`: that the tap is delegated to at all
(a row is a `<button>` nested in a card whose summary is also one), that the fetch is made
and made *once*, that the child row is still drawn below the expansion and still indented
deeper, that nothing overflows a 393px phone, and one thing that is invisible everywhere
else. **The page must not move.** `capturePlace` anchors the scroll to the first card in
the list, which is right for a poll and wrong for a disclosure that opens above the list:
six hundred pixels of bead appearing over that card scrolled the page down by 486, so the
row you tapped left the top of the screen and you landed in the middle of its description.
`keepTheScreenStill` holds the page offset across the repaint instead — exact rather than
approximate, because nothing above the row changes height — and calls `releasePlace()`
after, so the restores `settlePlace` has queued for the next frame do not put the anchor's
answer back.

### What happened to it — its pull requests, and its session

The block at the foot of an expanded bead answers the question the rest of it raises and
cannot reach: **and then what?** Everything above it is the bead as `bd` holds it. This is
the part that is *about* the bead and lives somewhere else — on GitHub, and in a window
that has probably already closed.

It exists because [taking the flat list away](#the-board-is-the-inbox-and-the-list-under-it-is-what-a-tree-cannot-hold)
took the last surface that connected the two. A pull request row in that list carried
[the beads it names](pull-requests.md#which-bead-a-pull-request-is-for), so the trail from a delivery to
its bead was one glance; now that row follows its bead off the list, and the trail had no
screen at all. This is the same index walked from the other end.

**The pull requests are that index, reversed — not a sweep of their own.** `/api/prs`
already resolves `beads[]` per row on the daemon, so "which pull requests are for this
bead" is a question this page has the answer to before it is asked. What it costs is one
subtlety worth stating plainly: **a board this page has not got is not a board with
nothing on it.** The sweep is a `gh` call per repo behind its own minute, and the kind
filter can switch it off entirely — so until it lands the block says it is reading, and
never that no pull request exists. A sweep that *failed* is a third answer again and says
which, for the same reason the list under the board names the repos it could not read. An open bead also counts as a reader of the board, so
the sweep runs while one is open whatever the filter says; without that the section would
sit on "reading" for ever on a filter with pull requests hidden, which is worse than the
call it was avoiding.

**An open pull request is a button into the card this app already has** — the full view
with the diffstat, the checks, the merge and the decline on it — because reimplementing
any of that inside a tree row would be a second copy of it, drifting from the first from
the day it landed. A **closed** one gets a link out to GitHub instead, and that is not a
style choice: the inbox's own row list drops closed pull requests, so a button would open
nothing at all, and a control whose only outcome is nothing happening is invisible until
somebody taps it.

**The session is two different addresses and they are not interchangeable.** A window
running right now is reachable only by pid — `/session?pid=…` — and that pid rides the
tree row itself, because the daemon already had the session list in hand when it built the
card, so it is a `find` rather than a request. A window that has finished has no pid at
all and is addressed by the bead: [`/bead-session`](advocates.md#reading-it-back-on-the-phone--bead-session),
which is also where the memories it left are shown. A bead can honestly have both — one
run archived and another going now — and both are drawn, because collapsing them would
hide whichever one the reader came for.

Whether anything is archived is one `git log` over one ref (`/api/session-archive`), asked
after the bead has painted rather than folded into it, and it has the three states [the
graph's sheet](#the-way-through--what-its-session-did) gave the same question: **looking**,
which is deliberately not tappable, because a row that is a link and then stops being one
loses the tap of somebody who reached for it as it resolved; **an archive**, with the count
and when the newest ran; and **nothing archived**, which is the same box, muted, and not a
link. A check that *failed* offers the link anyway — the two errors are not symmetrical.
Saying "no session" over a bead that has one hides the page for good; offering one over a
bead that has none costs a tap onto a page whose whole design is saying plainly what is not
there.

**And a bead with neither says so in one sentence and offers nothing to tap.** That is the
acceptance criterion and it is the common case, not the edge: most beads in this tracker
have never had a pull request or a session, so a heading over two rows both reading "none"
would be three lines of furniture on every bead you open. One sentence instead, naming the
bead, with no anchor and no button anywhere in the block.

`node test/p0happened.mjs` runs the renderers out of `public/app.js` in a `node:vm` over a
fixture board and a fixture archive: that a bead lists every pull request naming it and no
others, that the match is on the id and not on a prefix of it (every parent id here is a
prefix of its children's, so `startsWith` would put two children's deliveries on their
epic), that an open one is a button and a declined one is a link out, that a live session
and an archived one are drawn at their own addresses and both when both are true, that
"still looking" is not tappable, that a bead with neither has nothing tappable in it at
all, that a board this page never fetched says so rather than claiming an absence, and
that an open bead makes the board wanted whatever the kind filter says.

`node scripts/p0happened-check.mjs` is the half a string cannot reach — the real page in
headless Chrome at 393×852, with `/api/prs` held back until the tap has landed so that the
"reading" state is a frame somebody actually sees: that the block draws before the board
answers and has nothing to press while it is unresolved, that the rows arrive off one sweep
and the archive off one request, that every row is a thumb-sized target and none of them
pushes a 393px page wider than itself, that a bead nothing happened to has no control
anywhere inside the block, and the one that is only true in a browser — **that tapping a
pull request actually opens the card.** That button is nested in the bead expansion, which
is nested in a card whose summary is also a button, and the sheet it opens is a row the
inbox's own filter had already dropped. It came up empty the first time it was run, which is
what turned up the ordering above.

### One status filter, in the tab with the tree it narrows

At the top of an open epic's tab sits one control — **Not closed · All · Closed** — and
it decides what the tree under it draws. It is one *pick*, not one per card: `p0status` is
a single page-state field, persisted, so whichever epic you open next is drawn the way you
last asked for. A pick per card would be a control you set again on every epic, and four
trees that could each be showing something different with the only record of which on the
cards themselves.

**It sat between the heading and the cards until bc-grut**, and the argument for putting
it there is exactly what moved it: a control over things that are not on screen is a
control you set and cannot see the effect of. The trees are in the tab now, so the board
is precisely where its effect cannot be seen. What that buys as well is the collapsed
card's own summary — `12 of 19 done`, `3 ask you` — which counts the whole tree and is
unreachable by the filter, so nothing on the grid moves because of a control that is not
on the screen.

**It defaults to not closed**, which is the whole reason it exists. `bc-rfnr` has 16
descendants and nine of them have landed; a tree that drew all sixteen by default is an
epic reading as twice the size it is, and the number you came for — what is left — is the
one you have to count out of the list yourself. Open, in progress and blocked are one
answer here (*this is still going*) rather than three chips, because the four other
combinations of three checkboxes mean nothing anybody wants to ask.

**And closed work is one tap away rather than gone.** A closed child is how you read what
a P0 has *delivered*, which is the one thing the "N open" count on the card can never tell
you. Each chip carries what it would leave you with — counted over the epic in front of
you since bc-grut, where it used to be counted across every card on the board — so
`Closed 0` says *this* epic has delivered nothing before you tap to find out.

The part that fails silently is the ancestors. The rows arrive flat with a `depth` drawn
as an indent, so a row's place in the tree is carried entirely by what is above it: drop
an open parent while keeping its closed child and the child does not leave a gap, it
indents under whatever row happened to precede it and reads as *that* bead's child. So a
row the filter excludes is still drawn when something under it is included — marked with
a dashed leading edge, because it is scaffolding rather than an answer, and a `Closed`
filter drawing open beads with nothing to say why reads as the filter not working. Pre-
order is what makes that cheap: a parent is always seen before its children, so the walk
up the parent chain can stop at the first ancestor already kept.

Three smaller decisions, each of which had a wrong way that looked fine:

- **It narrows the trees and nothing else, and it cannot hide a question.** The second half
  is bc-rfnr.9.7's. This bullet used to say that a bead you filtered out of a tree was still
  a question you were being asked — true, because there was a flat list underneath to be
  asked it on. [There is not any more](#the-board-is-the-inbox-and-the-list-under-it-is-what-a-tree-cannot-hold),
  so a pending row is kept whatever the filter says: `Closed` is one tap, and it would
  otherwise take every open question in the tracker off the screen with it. The row is still
  drawn as itself, so a question in a `Closed` tree reads as what it is rather than as the
  filter having failed.
- **The pick is page state, persisted** (`beadcause.p0status`), like the fold and unlike
  which card is open. The board is one reconcile chunk replaced whole every 25 seconds,
  so a filter applied by hiding nodes would come undone under your thumb; and whether you
  are reading what is left or what has landed is a standing preference. An id the page
  does not know — a newer option, a hand-edited key — reads as the default rather than
  being stored, so the phone can never come back with no chip pressed and an empty board.
- **An epic the filter empties says so in its own sentence.** "Nothing under `bc-done`
  matches the filter" and "nothing filed under it yet" are different facts, and the second
  one over an epic with nine closed children is the control lying about the tracker.

`node test/p0card.mjs` covers it in the same `node:vm` as the rest of the board, over a
fixture with both awkward shapes in it: a closed parent with an open child, and an open
parent with a closed one. `node scripts/p0filter-check.mjs` is the half no renderer test
can see — a real tap in headless Chrome at 393×852, on an epic opened first because the
chips are in its tab: that the chips are inside `#list` at all, since every handler on this
page is delegated from that element and one drawn outside it renders perfectly and does
nothing; that three chips fit one line on a phone; that the list under the board has
exactly the rows it had either side of every tap; and that a reload comes back where you
left it, which is two separate ends — the write on the tap and the read at boot — either of
which can be missing with the page looking right all session.
The mark on a held-up row is read as a computed border style rather than as a class, so it
fails on a stale stylesheet too, which is what [v62](docs/sw-cache/v62.md) is about.

### Under a heading that says what it is, and no longer a fold

The heading was a disclosure of its own (bc-eevn) — one button the width of the section,
`aria-expanded` on it, the same `.chev` every other fold on this app turns. Tap it and the
cards went away. The argument was that on a phone four epics with their controls *are* the
first screen, and there are days when what you came to the inbox for is the questions
underneath; before it, the board could only be scrolled past.

**bc-khoe.28 took the fold out, and the reason is that its argument was answered by a
better control.** The questions are one tap away on their own pill now, and `My Epics` is
[the board and nothing else](#one-list-six-kinds--and-the-two-sub-filters) —
so what the fold used to reveal is not underneath the board any more. On a board-only view
its whole effect is to leave the screen blank, and it was persisted (`beadcause.p0shut`),
so one tap would have left the app's landing screen blank until you found the line and
tapped it again. The specification's own three guarantees for keeping the fold honest — the count
stays on the shut line, it is display only, it leaves `state.p0open` alone — all assumed a
list underneath it. Without one there is nothing left for them to be true *of*.

The alternative considered and rejected was to leave it and let shut mean "the heading is
the whole of My Epics": one line with both counts, which is honest as far as it goes and
costs nothing to keep. What decides against it is that this is where you land. A control
whose only effect is to blank the view it is on, and which remembers having done so, is not
a control — it is a way to lose the board, which is the exact thing every rule in this
section was written to prevent.

What is left is a heading: `<h2 class="p0-kind">`, no `aria-expanded`, no chevron, no
`--tap` height and no pointer, because a line that says it can be pressed and cannot is
worse than a plain label. **Both counts stay**, and they are now the whole reason the line
is drawn: how many epics, and how many beads under them are asking you something. A
question four levels down a tree nobody has opened is otherwise a number nothing on the
screen carries.

It says **"Epics assigned to you"**, not "Your P0s". Every card on it is a **root** carrying
your `owner:<handle>` — an epic at any priority, or a P0 — and a heading that names a
priority field would read as a filter you set rather than as the work you are answerable
for. That heading was a kindness until bc-htoy, when the board still selected on P0 alone;
it is now literally true, and the only cards on it that are not epics are the crashes the
app filed on itself, which are the one thing you want at the top of a screen called this.

Because the board is no longer all one priority, **each card draws its own** beside the id,
and `rootBoard` sorts on it before it sorts on how much is still open — a P3 epic with
sixty children left must not push a crash off the top. The stylesheet only tints P0 and P1,
so the urgent ones stand out rather than every card carrying a colour. The wire moved with
the rule (`rootboard`, `roots`, `GET /api/roots`); the CSS class names did not — `.p0-card`
is a namespace prefix rather than a claim, and restyling four hundred selectors would buy
nothing a reader can see.

The "*N* ask you" count is the half of the old fold that survives it, and it survives for
the reason it was added: now that
[the trees are where a question is drawn](#the-board-is-the-inbox-and-the-list-under-it-is-what-a-tree-cannot-hold),
a board heading with no "*N* ask you" on it is a week of unanswered questions with nothing
on screen saying they exist. bc-rfnr.9.7 put it there so a board shut on Monday could still
say so on Friday; there is no shut board now, and it still has no rival — every card on the
board defaults to a folded tree.

Removing the fold takes a state field, a `localStorage` key and a tap branch with it, and
the way that rots is a half-removal: a heading left as a `<button>` with an `aria-expanded`
nothing writes, or a `state.p0shut` no longer read but still saved. `node test/p0card.mjs`
asserts all three ends are gone — the `data-act`, the disclosure attribute, and the state
with its key — as well as the two that stay, the heading's counts and every card and
open tab always being drawn with it. `node scripts/p0board-check.mjs` presses where the
fold used to be, in headless Chrome at 393×852, and requires the board to be exactly as it
was. `scripts/p0fold-check.mjs` is deleted with the feature it covered; its live claims —
that the heading is inside `#list` where the delegated handler can see it, and that the
rows either side of a board tap are the same rows — are now p0board-check's, which drives
the pill row for real.

### The board is the inbox, and the list under it is what a tree cannot hold

[bc-rfnr.2](#epics-assigned-to-you-and-the-tree-each-one-carries) narrowed the inbox to
what descends from your epics. [bc-rfnr.9.1](#epics-assigned-to-you-and-the-tree-each-one-carries)
put every one of those beads in its epic's own tree, on the card above the list. From that
day the list was a second, flatter, parentless copy of the same beads, and the reason to
scroll past the board was to read the board again with the tree taken out of it. So the
copy goes: with epics owned, a bead the board draws is not drawn again underneath it.

**What stays is what a tree cannot hold**, and each of the four is a row that no card on
the board has:

- **A chat.** It has no bead — and it is where a new epic gets filed, so a screen that hid it
  would make the board the one thing on this app you could not get out of.
- **A pull request naming no bead.** One that names a bead is a row about a bead: yours,
  drawn in its epic's tree, or somebody else's, which bc-rfnr.2 already hid. What that
  trade costs is worth naming — the *ladder* a delivery is on (in review, waiting on a
  deploy: `lib/prstage.js`) is not on a tree row, so it is now a thing the board does not
  tell you. A delivery that actually needs you is a `human` bead and is still drawn, as a
  question, in the tree. What closes that gap is
  [the block at the foot of an expanded bead](#what-happened-to-it--its-pull-requests-and-its-session),
  which draws the same ladder on the bead itself.
- **A JIRA ticket**, for the same reason as a chat: it has no bead at all until
  `bd jira pull` files one.
- **A question under nobody's root** — [`unhomed`](#a-question-under-nothing-is-still-drawn),
  and this is now most of what is in the list. No card on the board holds it, so removing it
  with the rest would put it on no screen, which is the exact bug that map exists to fix.

**And a card that is open has a row, whoever's P0 its bead hangs off.** That test runs
before every one of the four, because `.card.open` is a full-screen sheet built out of an
inbox row: a sheet opened over a row this filter had dropped comes up empty. It sat *below*
the pull request rule until bc-rfnr.9.5 and that was a real gap rather than an ordering
nicety — a pull request naming a bead is filtered out unconditionally, so tapping one on
the board page's `Full view`, following a notification into it, or using the new control on
the bead itself put a sheet up over nothing and looked like a tap the app had ignored.

The three no-op cases still hold, unchanged: an install with no `cfg.me`, one that owns no
epics yet, and a payload from a server that predates the board all keep the flat inbox they
have always had.

#### The question has to survive the list

The inbox exists for one thing — an agent waiting on an answer — and a board that swallowed
those would be a redesign that lost the feature. Three things carry it instead, and none of
them is optional:

- **The row says so.** `pending` on a tree row draws an **asks you** pill and a solid
  leading edge on the row.
- **The card and the heading count them.** A collapsed card carries "*N* ask you" beside its
  id, and [the section heading](#under-a-heading-that-says-what-it-is-and-no-longer-a-fold)
  carries the total for the whole board. A question four levels down a tree that is shut by
  default is not findable; a number on the line above it is.
- **The status filter cannot hide one.** A pending row is kept whatever
  [the filter](#one-status-filter-in-the-tab-with-the-tree-it-narrows) says. `Closed` is one tap, and
  before the list went it merely narrowed the trees — now it would take every open question
  in the tracker off the screen with it.

#### And it is answerable from the bead it is on

Tap the bead in the tree, and its expansion carries **✍ Answer it** above the graph link.
That opens the inbox card the app already has — the full-screen sheet with the parsed
options and their recommendation, the arm-then-confirm, the brief, the saved draft, the
thread, the box and the dismissal. It is `expand(key)`, the same call the list's own toggle
makes, and reimplementing any of that inside a tree row would be a second copy of the
hardest screen in the app, drifting from the first from the day it landed.

Two lines make it possible, and both are the same exception written at different heights.
`underOwnedRoots` keeps a bead in the list for exactly as long as its card is open —
`.card.open` is built out of an inbox row, so the row has to survive the filter or the
sheet comes up empty; collapse it and the row drops back out, because the board is drawing
it. And since bc-khoe.28, `listHere` draws a list on `My Epics` for exactly as long as
there is an open card, because that view otherwise has none at all: the sheet is the whole
of what is drawn, and closing it leaves the board alone on the screen again. The control is drawn only where there is a row to open —
`/api/questions?scope=agent` sweeps no questions at all, so on that scope a pending bead is
marked in the tree and has no button, which is the scope saying what it says rather than a
button that does nothing.

`node test/ownquestion.mjs` drives the real filter over a real payload — a bead the board
draws, one under a colleague's epic, one under nobody's, a pull request each way, and the
open-card exemption in both directions. `node test/p0card.mjs` and `node test/p0bead.mjs`
have the renderers. `node scripts/p0board-check.mjs` is the half none of them can see: a
real tap in headless Chrome at 393×852, ending on a card with a box in it.

### The advocate that comes back — what re-opens an Epic Advocate, and what it costs

The 🧭 button opens an Epic Advocate. For a fortnight that was the *only* thing that did,
and the agent's own brief told it otherwise on every run: *"You are re-entrant, not
resident. You will be re-opened on child events rather than left running — so write
everything down on the bead."* It duly wrote everything down. Nothing came back to read
it. `openEpicAdvocateSession` had exactly one caller, the route behind that button, and
the route's own comment said so — bc-rfnr.3 argued for the trigger, closed without it,
and nobody re-filed the half that was missing. An agent that faithfully records its
conclusions and is never re-entered is not a persistence success with a scheduling gap;
it is the write-only diary this whole P0 exists to disprove, in its purest form.

`lib/reenter.js` is the trigger, swept from the advocate tick. **Enrolment is the bead**,
and that is the decision worth the most here: an epic is enrolled when the tracker says so,
and the tracker is the one thing both doors read. Three things follow, and all three are
why it is done this way rather than with a registry file:

- the button and the sweep **cannot disagree** about who is enrolled, because neither of
  them holds the fact — the tracker does;
- it **survives losing `advocates.json`**, a restart, or a machine, and beadcause restarts
  itself several times a day on its own merges;
- **taking the record off un-enrols the epic**, which is an off switch that costs no new
  control: an advocate that concludes an epic needs no more supervision un-assigns itself,
  and nothing re-opens it.

#### The tap is the assignment — what the epic carries, and what takes it off

The record used to be the advocate's own **waiting-on block**: the sentence the last thing
every advocate window is told to do writes into `notes` before it exits. That made the
enrolment a consequence of a window having *survived long enough to write a sentence*, and
`lib/reenter.js` named the cost out loud from the day it landed — an advocate window that
dies before writing its sentence never enrols its epic, and a tap is needed again. That
cost turned out to be most of the feature. On 2026-08-17, **10 of 40 open epics carried the
block**, so an assignment Adam had made was more likely than not to be gone by the time he
came back to it, with nothing on the card saying so.

So bc-r2b5.1 moved the record to the **launch**. Both doors — the 🧭 button
(`POST /api/bead/advocate`) and the sweep's own launch — write an **`advocate-assigned`
label** on the epic the moment the window is up, and the sweep enrols on **either** carrier:

| carrier | written by | means |
|---|---|---|
| `advocate-assigned` label | both launch doors, immediately after the window comes up | somebody assigned this epic. Survives a window that died in its first second, a restart, losing `advocates.json`, and another Mac |
| the waiting-on block in `notes` | the advocate itself, as the last thing it does | an advocate has been here and left a sentence. Still enrols, so nothing already enrolled fell out on the deploy that shipped the label |

A **label** rather than a second marked block, on the same argument `advocate-paused` is a
label: `bd label add` is one atomic write, where writing into `notes` is a read, a
concatenate and a write — with the advocate's own rewrite of its waiting-on block landing
in the middle of it. A lost write there would un-assign an epic as a side effect of
enrolling it, which is the one failure this must not have.

Written **after** the launch and not before, because the launch has four refusals in front
of it: an epic enrolled by a launch that was refused is one the sweep would re-argue every
three hours for ever. And a label write that fails is a **warning, not a thrown request** —
the window is already open, and a 500 over the top of it would say the tap did nothing.

**Un-assigning is taking the record off, and there are two of them now**, so an advocate
that concludes its epic needs no more supervision has to remove both: `bd label remove <id>
advocate-assigned` *and* erase its waiting-on block. Either one left in place keeps the
sweep bringing it back. `epicAdvocatePrompt` says exactly that in the brief, because an off
switch nothing is told about is an off switch nobody presses.

**And the sentence is now held to its 160 characters on the path advocates actually take**
(bc-zjab.5). `WAITING_MAX` used to be applied only in `waitingBlock`, which nothing calls:
an advocate is composing a whole `notes` field around the markers and writes it by hand
through `bd update --notes`, so no code of ours was ever on that path — and `waitingOn`
did not truncate on read either. Measured on bc-y3qk 2026-08-18, the block was **942
characters**, written that long by four consecutive visits and drawn in full every time,
turning a one-line card into a paragraph. Two halves, and neither alone is enough:
`waitingOn` holds the line to `WAITING_MAX` **on read**, which is the path every drawing
takes and is what makes the fix retroactive for blocks already in notes; and the brief now
states the number where the sentence is asked for, because the markers it quotes say
nothing about length. Same shape as bc-zjab.1 — a rule enforced only where nobody goes.

The button still stays, and its job is now smaller and clearer: it is what assigns an epic
**nobody has ever assigned**, rather than a thing you press again because the last window
died young.

#### What the epic's card is told about its advocate

The board card's `advocate` field was `advocateSession(…)` — a live window, or `null`. For a
**re-entrant** supervisor that is a boolean wearing a session's clothes: an Epic Advocate
takes a turn and exits, so between turns nothing is running to find, `null` came back, and
the card drew *"Put an advocate on it"* over an epic that already had one. That is bc-r2b5
in one sentence — an assignment reading as lost because the thing being drawn was a
process rather than a decision.

So each card in `rootboard` now carries an **`advocacy`** object beside the old field —
beside, and not instead of, because the client half lands separately and swapping the field
would blank the advocate line on every phone that had not reloaded its JavaScript. Seven
facts, none of them a new read:

| field | from | says |
|---|---|---|
| `assigned` | the epic's labels and notes | somebody put an advocate on this. **True between turns**, which is nearly all the time |
| `by` | the same | `label` or `waiting` — which carrier holds it, because the two have different un-assign gestures |
| `paused` | `advocate-paused` | assigned *and* stopped, which is a fourth state and wrong drawn as either of the other two |
| `session` | the board's one sessions snapshot | whatever `advocate` says, passed through rather than recomputed, so the two cannot disagree |
| `lastAt` | `advocated[id].at` in `advocates.json` | when a window last ran. "Idle since 09:40" and "idle since a fortnight ago" are the same card without it |
| `hold` / `heldAt` | the re-entry sweep's own record | why no window is opening right now, **in the sweep's own words**, and when it decided that |
| `finished` | either of `lib/finishedepic.js`'s two ask markers | whether the sweep has already asked Adam if the theme is done |

`hold` is **reported, not re-derived**, and that is the one decision in here worth stating.
Three of the five reasons a window is held — the tick's one-window budget, a worker this
advocate is holding, a live lease on another Mac — are things only a tick can see, so a
card computing its own answer would be a second answer to one question, disagreeing with
the daemon on exactly the epics somebody is looking at. The sweep writes what it decided
onto the record it already persists, and the card reads it through `advocates.advocacy()`
— a `Map` get on a request path, no `bd` call.

`waitingOn` is **not** repeated inside the object: the card already carries it at the top
level, and one fact arriving twice in one payload is two copies of a state that can drift.

#### What the card draws, and what a tap on the advocate line opens

The control on a P0 card is four states now rather than a button (bc-r2b5.2). All four are
read off `advocacy` in one place — `p0AdvState` in public/app.js — so the grid cell, the
epic's own tab and the advocate sheet cannot disagree about which state an epic is in:

| state | what the card is |
|---|---|
| nobody on it | *"Put an advocate on it"*, exactly as it was |
| opening | a disabled button. There is no pid to link to for the minute before a window names itself, and the honest thing to do with a control that would 409 is say why it is not offered |
| **assigned, idle** | who has it, **when its last window ran** — "last looked 3h ago" — and why one is not up right now if something is holding it. **Not** an offer to open a second one |
| live | the anchor into `/session?pid=…`, unchanged, with the way into its history beside it |
| **done** | `lib/finishedepic.js` has already asked whether this epic is finished — every child closed, or [worked as one job and that work is in `main`](advocates.md#an-epic-worked-as-one-job-comes-back-as-a-card-that-says-it-is-done-with-close-as-the-tap) — so the card offers the close rather than leaving it to be found in the inbox |

"Advocated" on its own is the same card whether the advocate looked twenty minutes ago or a
fortnight ago, and only one of those is a problem — so the time is not decoration, it is the
half that makes idle readable. An epic assigned but never opened says *that* rather than
borrowing a time from a record that does not exist.

The done state's close is `expand(key)` and nothing else: the inbox card that
`lib/finishedepic.js` already wrote, with its parsed options, its arm-then-confirm and its
submit queue. A second answer surface would be a second copy of the hardest screen in the
app. Where this page's payload has no row for the epic — `/api/questions?scope=agent` sweeps
none — it says where the close is instead of offering a tap that would do nothing.

**Tapping the advocate line opens the advocate**, as a fixed layer over the epic's own tab
(`z-index: 41` to the tab's 40 — the one place in this app where two of these stack on
purpose). Four sections: *where it is* (the assignment, its carrier, what is holding the next
window), *what it is waiting on* (the advocate's sentence in full, where the card shows a
line of it), *the plan* — `lib/plan.js`'s groups, read back off the epic's thread, with how
many beads of each have closed — and *what has run*: its own archived sessions, then per
child what ran on that child.

Three fetches on that tap and they cost three different things: `/api/bead` for the epic (a
`bd show`, and where the plan comment is), `/api/session-archive` for the epic (one `git
log`), and one more per **direct child**. One level, which is what "per child" means and is
the same question `lib/finishedepic.js` asks — a whole subtree would be a `git log` per
descendant on a single tap.

Every source in there has a third state and each is drawn as itself: the plan is absent,
unreadable or **not fetched yet**; the archive is looking, present, absent, or "we asked and
could not find out" (which offers the link anyway); the waiting-on sentence is written or it
is not. Nothing renders *we have not looked* as *there is nothing*.

**Three events, and deliberately not all of them.** A descendant that *closed*, one that
was *filed*, one that *stalled*. Not one that started — `open → in_progress` is a worker
window coming up, which is the system working, and on a subtree of thirty that flip is
most of the traffic there is. Over the whole subtree rather than direct children only,
because a P0 whose children are epics has its real movement a level further down, and the
card above it already counts descendants. A burst collapses into one window briefed on all
of it.

**A stall is measured in windows, not in timestamps.** `updated_at` says nothing useful —
a comment bumps it and a session dying does not — so a stalled child is one the tracker
says is `in_progress` while nothing on this Mac is in a window on it and no other machine
holds a live lease on it, for `reenterStallMinutes`. That is the shape of the real
failure: a bead claimed by a session that died, sitting `in_progress` with nobody coming
back. It takes two sweeps to fire, because the clock starts the first time the state is
seen — which is also what stops a launch racing the sweep and reading as a stall.

**And the two endings that look exactly like one and are not.** A worker window has three
endings it can reach without exiting, and the daemon names two of them where it writes
them down: **delivered** — the merge was refused or the session asked for review, so a pull
request is waiting on a tap — and **handback** — it needs a decision, so the question is on
the bead under a `human` label. Both leave the bead open on purpose, and both also leave it
`in_progress`, assigned, with a lease that then expires, which is character for character
the state above. So every bead that reached one of the two endings the brief *asked* for
was reported to its epic's advocate as a stall. Both fired on `bc-xl7n` inside one day and
both were false: `bc-8t3b`, whose pull request was open with its delivery card open beside
it, and `bc-xl7n.25`, which the daemon's own log said it had handed back. Neither is a
loop — a bead fires once per stall episode — but each one is a whole unattended window
opened on a false alarm, and until the question is answered or the branch merges the bead
sits in every later brief's child list as `in_progress` for the advocate to disambiguate by
hand.

Both answers are free, off what the sweep already reads. The handback half is one label on
a row it has in its hand. The delivery half is the same cached `bd export`: delivery is
*structural*, because `beadcause-deliver` parks the work bead behind whichever bead it
filed — `pr-delivery` when the merge is yours to make, `merge-queue` when the queue's —
with a `blocks` edge, since the close gate refuses a bead with an open blocker and that is
what stops a worker closing its own work. So a `blocks` edge to an open bead carrying one
of those two labels *is* an open delivery, without asking GitHub anything, and it stops
being one the moment the card is answered or the merge lands — which is exactly when the
bead should be able to stall again. A dead window with no pull request and no question is
untouched by either: that is the real failure, and it still fires. Fifteen `in_progress`
beads on this tracker were sitting behind an open delivery card the day this landed.

**And a third exclusion, which is not a worker's ending at all.** On a *root*,
`in_progress` is not a claim a dispatcher wrote — it is what pressing **Start** on the
board writes, deliberately into the tracker rather than as a pin on one screen, so the
board is the same fact on every device. Nothing takes it off again but closing the epic or
a second Start. A board-started sub-epic therefore has no worker, no lease, no `human`
label and no delivery, and it trips the clock for as long as it is on the board — `bc-xl7n`
carried `bc-xl7n.113` in its re-entry reason for four sweeps and counting while that epic's
own advocate ran it perfectly. **The cost is not the wasted window, it is what the brief
then tells the advocate to do**: the stall paragraph prescribes `bd update <id> --status
open --assignee ""`, which is that write's exact inverse, and running it would silently
take the epic off your board. So a child carrying [`advocate-assigned`](#the-tap-is-the-assignment--what-the-epic-carries-and-what-takes-it-off)
is excluded — the wider and cheaper question, since a row with a supervisor of its own is
that supervisor's business whatever route put it there, and the label is one every route
stamps. It is annotated in the child list rather than hidden (*supervised by an advocate of
its own, not stalled*), the brief now forbids the release in as many words, and taking the
advocate off starts the clock again.

**What bounds it**, since this spends unattended windows that file beads:

| bound | default | why |
|---|---|---|
| `advocates.reenterIntervalMinutes` | 10 | how often it looks. One `bd export` per workspace — and it is the *cached* one the inbox already builds. The EpicAdvocate roster rebuilds off that same cache on every tick, so the export is paid whether this sweep runs or not, and no phone need be open for it |
| `advocates.reenterCooldownMinutes` | 180 | the floor between two automatic windows on **one P0**. Deliberately against being responsive: nothing waits on an advocate, because advocacy does not gate dispatch, so a supervisor taking stock three hours after a child landed is not late for anything |
| one window per tick | — | per workspace, so a morning where four P0s all move opens one window and the rest wait for the next sweep |
| never two on one P0 | — | `advocateSession` on the live session records, the same rule the button refuses a second tap on, plus the launch this daemon made in the last ten minutes whose window has not named itself yet |
| a window or a lease already on it | — | a worker or planner window this advocate is holding on the P0 itself, which has no session record until it has named itself, and a live `held:` lease — another Mac's window, which nothing on this laptop can otherwise see |

Measured on this tracker on 2026-08-14, over the previous seven days: six enrolled P0s,
375 parent edges, and **36 windows in a week — 5.1 a day for the whole repo** at a 180
minute cooldown (`bc-goo` 11 of them, `bc-xl7n` 12, `bc-sj8k` one). A six-hour cooldown
would have made it 4.1 a day, which is the same feature costing a third less and arriving
a third stale, so 180 stayed.

Two more things it does not do. A Epic Advocate **takes no worker slot** and competes for
none — it is supervision, not throughput — so the sweep sits above every number the queue
is bounded by, and a repo already at its `maxWorkers` can still get one, which is the
state where supervision is worth the most. And it opens **no window at all** under
`OBSERVING`, on a paused advocate, or in a space's quiet hours: it is doing rather than
looking, and those three lines mean what they say.

**Its own filings are news to the next window, and that is the design.** Filing children is
part of what this agent does, so a window that files three leaves three `filed` events
behind and — three hours later at the earliest — another window opens to see how they are
going. It is not a loop: it stops the moment the subtree stops moving. Nothing tries to
attribute a filing to a window and discount it, because the daemon cannot tell which agent
filed a bead and guessing would make the one signal here less trustworthy rather than
quieter.

**It runs inside the advocate tick, so it reaches advocated workspaces only.** A repo with
no advocate has no sweep and its P0s are still a tap each — the button is unaffected
either way, in every workspace. And the launch is remembered *both ways*: the queue holds a
bead this daemon just opened an advocate on (`resight`, and the `heldByLive` filter behind
it), because the survey runs before the sweep and a P0 sitting in `bd ready` is one a worker
would otherwise be opened on in the same minute — two windows in one worktree, which is the
worst failure the dispatch side has.

**A held event is not a consumed one**, which is the single subtlety in the code and the
one whose failure is invisible. The snapshot of what the subtree looked like is what
"something moved" is measured against, so a sweep that declined to open a window — the
cooldown, the one-per-tick, a session already there, a refusal at the launch door — keeps
the *old* snapshot rather than the new one. Store the new one and the child that closed is
recorded as already-seen-closed and no window ever opens for it. `advocates.reenterAdvocates`
is `false` to switch the whole thing off and be back to a button. `node test/reenter.mjs`
holds all of it: the first sight that must be silent, each event, the stall's two sweeps,
every bound, and — as a source read, because a behaviour test cannot see it cheaply — that
the sweep is still below the three lines that stop the tick.

**The no-worker-slot half of that is driven, not grepped, and the difference is bc-t5k0.**
It used to be a fourth source read in the same check, matching the queue's slot arithmetic
by string and asserting the sweep appeared above it. That line is arithmetic, and arithmetic
gets renamed: `a.workers.length` became `codersOf(a).length`, `indexOf` returned `-1`, and
the suite went red announcing that the sweep "has become queue work" while it sat exactly
where it belongs. A static read cannot tell a rename from a regression, and that one
printed the same sentence for both. bc-xl7n.39 made the failure honest — the anchor is
shorter and a `queueAt > 0` guard now says "re-point this check" — but honest is still a
red for a correct edit, and still no evidence about the property itself. So the suite now
ticks a repo holding its one worker against a queue that has a bead in it, and asserts the
advocate gets its window anyway: the state this section calls the one where supervision is
worth the most, and the only state in the file where the queue is actually full. It is also
strictly more sensitive than the string was. Gate `reenter` on a free slot instead of moving
it, and every source read still passes — that one case goes red alone.

### Pausing one epic — the button that stops dispatch under a P0 without stopping the repo

Everything above holds an epic back for **contention**: a twin already being worked, a
branch in an open pull request, a lease on another Mac, a file somebody has their hands
on. None of those is a decision, and every one of them clears itself the moment the other
thing finishes. So until bc-lco2 there was no way to say *stop* to one epic. You could
close it, or you could pause the whole repo — which stops the four other epics that were
fine.

**Pause is a per-P0 control in the head of its own card on `/monitor`, and the fact lives
on the bead** as an `advocate-paused` label. A label rather than a marked block in `notes`, which is the
opposite of the choice the waiting-on sentence makes one file over, and the two facts are
why: a waiting-on sentence is prose only the advocate writes, so it needs a field that can
hold a clause; a pause is a boolean somebody toggles from a phone, and `bd label add` is
one atomic operation where writing into `notes` is a read, a concatenate and a write with
the advocate's own rewrite landing in the middle of it. A toggle that occasionally erased
the waiting-on block would **un-enrol the epic as a side effect of pausing it**, which is
the one failure this feature must not have. On the bead rather than in `advocates.json` for
the reasons enrolment is: it survives a restart and losing the state file, it is readable
from the phone and from another Mac, and the button and the sweep cannot disagree about it
because neither of them holds it.

**Three things stop, and one deliberately does not:**

| | what happens |
|---|---|
| the re-entry sweep | opens no advocate window on that P0. The snapshot of what moved is **kept**, not pruned, so the window opened after the resume is briefed on everything that happened while it was paused — dropping the record would make the resume a *first sight*, which is silent by design |
| the queue | `withoutPausedEpics` takes every ready bead in the subtree out of the survey — the P0 itself included, since a leaf P0 is workable in its own right — and says so as `heldByPause`, a pill on the card and a line in the note. It runs **innermost of the seven filters**: a bead under a paused epic reported as "another Mac has claimed it" would be true and would be the wrong sentence, sending you to look at a machine when what holds it is a button on this screen |
| the launch door | `openEpicAdvocateSession` refuses with a 409 naming the pause, so the 🧭 button cannot get round a pause the sweep respects |
| **the windows already open** | **nothing.** They keep their slots, keep their claims, and finish on their own briefs. A pause that killed them would lose exactly the half-finished work it was pressed to protect |

**But they are told, and the message is the second half of the feature rather than a
courtesy.** A session ordinarily hands its unfinished thinking to the next window on the
bead half an hour later; a pause is a promise that there will not be one, so it is the
exact moment the cost of an unwritten debrief comes due. Each window under the epic gets a
line saying the epic is paused, that this is *not* a check-in and nothing is being taken,
and asking for `beadcause-memory debrief` before it exits — which is what `debriefBrief`
hands to whatever opens after the resume. A window that cannot be reached (iTerm refusing
the Apple event, or one that has already gone) does **not** undo the pause: the label is
written first, the queue is already holding, and the honest report is "paused, and I could
not reach two of the windows".

Resume takes the label off and dispatch comes back on the next tick. Nothing is typed into
a window on a resume — the sessions that were told were told there would be no next one,
and a "resumed" line arriving in one that has since wound down is noise in a window
somebody is reading.

The button writes into the daemon's in-memory set as well as onto the bead, and that is
not belt-and-braces: `bd.graph` is cached for a minute, so a pause that waited for the
roster to re-derive it would be a button you press twice. The label stays the fact — the
set is re-read from the graph before **every** survey, which is what lets a resume from
another Mac, or from `bd` on the command line, land within a tick.

### A question under nothing is still drawn

Narrowing the inbox to your P0s means a row that is in no P0's descendants is not drawn,
and for most of a tracker that is exactly right — a bead under a colleague's epic is on
their screen. But `under` cannot tell that case from a bead under **nothing at all**, and
for that one there is no other screen. It is not a corner: `POST /api/ask` is the share
target the phone files a question with, and it files with no parent, so the sharpest
version of the failure was *you file a question from your phone, and it disappears from
the phone you filed it on*. `bd` has it, `bd human list` returns it, and nothing anywhere
says a word. `POST /api/console/create` does the same for a draft that names no parent.

So the board carries a second map beside `under`:

| field | what it is |
|---|---|
| `under` | `<workspace>/<id>` → the id of the P0 **you own** that this row descends from |
| `unhomed` | `<workspace>/<id>` → `true` when **no open P0 at all** is above this row, whoever owns it |
| `assigned` | `<workspace>/<id>` → `true` when this **bead** carries your `owner:` label or descends from one that does, at any depth, whatever its status — the [kind pills' own narrowing](#one-list-six-kinds--and-the-two-sub-filters), and the one field here keyed by bead rather than by row |

The client draws a row that is in either. The two questions are genuinely different on a
shared graph — "which of my P0s has this" and "has anybody's P0 got this" — and the whole
bug was one map answering both. A row under somebody else's open P0 is in neither map and
stays hidden, which is [bc-rfnr.2](#epics-assigned-to-you-and-the-tree-each-one-carries) still working.

**Since bc-rfnr.9.7 `unhomed` is most of what the list holds.** A row in `under` is drawn
on the board, in its epic's tree, and not a second time underneath it — so the flat list
below the board is [what a tree cannot hold](#the-board-is-the-inbox-and-the-list-under-it-is-what-a-tree-cannot-hold),
and this map is the half of it that is a bead.

Three things land in `unhomed` and all three are the same fact:

- **A bead with no parent** — the share target's own beads, and anything else filed
  without one.
- **A bead whose P0 has closed.** A closed P0 is not a root (see [the dispatch
  gate](landing.md#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists))
  and its descendants stop being
  pulled onto the board with it, so an open question under a finished epic is under
  nothing. It was invisible *and* held, and only the held half was ever loud.
- **Every row of a workspace whose graph could not be read.** `Bd.graph` answers an empty
  shape rather than throwing, so nothing is known about what is above those rows — and no
  evidence must not mean no question. This is the direction the whole board already fails
  in; it just was not true of the rows until `unhomed` existed.

This is the other half of [what the daemon does at the filing
seam](landing.md#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists):
that gives a daemon-filed bead a parent when it can, this draws the bead when nothing did.
Deliberately a screen fix and not a second filing fix — auto-adopting what a *person*
filed is a decision about the tracker's shape, and a fix at the filing seam is only ever
as good as the graph cache was at that instant, where this one has no such hole.
`node test/ownquestion.mjs` holds it, from `bd export` through to the real client filter.

### The top bar says who is asking, not what the app is called

The widest part of the bar used to be the word **Beadcause** — on a screen you
reached by tapping an icon labelled Beadcause, in an app whose title bar says
Beadcause. It is the app mark now, the same artwork as the home-screen icon, still
inside the `<h1>` with the name as the image's `alt` so the header is labelled and a
reader still hears which app this is.

**And the bar is one row** (bc-khoe.5). It was two: a first row of the mark, up to four
icon buttons and the account chip, and the space picker below at full width. Now it is
the mark, the page's own title, and the picker:

```
  ●  ▣⚙  [ beadcause      ▾ ]
```

That is 116px of sticky chrome with the tab bar, against 159px — 43px of a 640px phone
handed back to the list, on every standing view at once. What paid for it is that the
first row was emptied rather than squeezed. **The mark is wrapped in a gear and is the
menu**, and everything that was a loose icon up there is a row inside it: refresh,
foundations, open-in-Chrome, Admin, and Switch account with the address under it. On the
eleven pages that draw a title rather than a mark, the trigger is the gear on its own, in
the same place, so it is one control and not twelve.

The one cost worth naming is **refresh, which is two taps now**. It is the app's most
pressed control and it was deliberately left loose in the bar for exactly that reason
until this landed. It went in with the rest because a single icon floating between the
mark and the picker is the shape the flattening was for.

**There is no count up here.** An **N waiting** pill sat beside the mark until
bc-ka5y.1 — how many beads were asking you something, hidden at zero, dropping its word
under 360px, and a tap on it was a shortcut back to the `human` scope. It went because
the list under it *is* that number: the pill spent the widest part of the bar restating
what you were already looking at, and cost a reconciliation between a server-held figure
and a locally-swept one on every repaint to do it. The shortcut is no loss either — the
scope chips in the filter panel are the same tap.

The two numbers that remain — agents running, advocates waiting — are **badges on the
tabs that answer them**, not chips up here: the number and the way to act on it end up
as the same tap target, and neither is a count of the list you are looking at. See
[the pill row](navigating.md#getting-around--the-pill-row).

### The dot at the left of the bar is an orbit while a view is loading

There is a teal dot at the left of every top bar in this app, and for most of its life it
did nothing. `.dot.busy` was a ring pulsing outward from it, ten page scripts toggled the
class by hand, and **five of the fourteen pages that carry a dot never toggled it at all**
— so on those the app simply went quiet between the tap and the screen. A phone on a tailnet from a train is
exactly where that gap is longest and exactly where nothing was saying anything.

It is an orbit now. A ring of seven small beads travels a circle seen from above its
plane — so on screen an ellipse, 21px by 8 — and the half nearest you is larger and
brighter while the half going round the back is smaller and dimmer. **Beads pass in front
of the dot and then behind it**, which is the whole of what makes it read as one ring in a
tilted plane rather than as a flat spinner drawn around a circle. It is the app's own noun
doing the one job a loading signal has, and at 26px across it is a detail in the chrome
rather than a spinner bolted onto it.

**It is driven from one place, and that place is not the views.** `public/report.js` is
the only file every page loads and the first script on all of them, because it wraps
`window.fetch` to catch failures — so it also counts what is in flight and publishes the
number as `window.beadcause.requests`. `public/orbit.js` subscribes and draws. That is
what makes the signal universal without a line in any view: there are ten hand-written
copies of `api()` across ten page scripts, and a per-view spinner would have meant ten
places to add one and ten places to forget. A page that fetches anything at all now gets
the orbit from its own load.

**Two requests are deliberately not a load.** `/api/poll` is the delta stream's long poll
and it *parks* for twenty-five seconds by design; counted, every standing view in the app
would be permanently loading and the signal would never say anything again. `/api/presence`
is the heartbeat behind the thumbs on the mirror — somebody else's finger on a timer, not
this screen fetching. And a request has to be out for **140ms** before the ring appears at
all, then stays for **600ms** once it has — about a fifth of a turn, far enough round for a bead
to visibly cross the dot. Every cached view here answers in single figures,
and a ring that flashed on for one frame of every tap would be noise the eye reads as a
glitch rather than as work.

**`.dot.busy` still works and its ten callers were not touched.** The stylesheet draws
the orbit for that class as well as for the `loading` the shared watch sets, because two of
those callers mean something a request count cannot see: the console and the agents page
light the dot while an *agent* is thinking, which is not a fetch. Two reasons for one
picture, and they are two classes rather than one so that neither can switch the other off.

Under `prefers-reduced-motion` **the ring is drawn and does not turn**, which is a
departure from what the rest of the app does under that preference. An animation that
decorates an outcome is skipped — the answer's flight to the mark builds no elements at all
(see [Where the answer goes](answering.md#where-the-answer-goes)) — but this one *is* the message, and
skipping it would leave the five pages that never toggled `busy` with no loading signal at
all, which is the hole it was opened to fill. A still ring that appears while the app is
fetching and goes when it settles says the same thing once, without asking anybody to watch
it.

**The answer's flight to the mark is untouched by it**, which is the one collision worth
checking: the orbit lives inside the dot and the flight lands on the app mark next to it,
so the two never reach for the same element. `scripts/absorb-check.mjs` still passes 29/29
with the orbit loaded on the inbox. The one place they would meet is `.dot.absorbing` — a
`transform`, and therefore a stacking context, which for its 380ms would pull the far half
of the ring in front of the dot. It cannot happen as things stand: absorb.js is loaded by
the inbox alone and its first target is the mark image, with `.brand .dot` left in its list
as a fallback for a top bar that has not existed since the bar became one row.

The depth is done with two clipped layers rather than by animating `z-index` per bead: a
near half and a far half, each holding a whole ring and each clipped to its own side of the
dot's centre line, with the far one behind the dot and the near one in front. The clips are
exactly complementary, so a bead crossing the line is drawn by one layer up to the line and
by the other beyond it — nothing twice, nothing dropped. `scripts/orbit-check.mjs` proves
in a real Chrome that the far half loses to the dot and the near half wins; `test/orbit.mjs`
covers everything about *when* it is on screen, in a vm, with no browser.

### The card is the control — tap it anywhere to open it

Every collapsed card used to carry a **Show details** button hard left in its top bar.
It said *this card can be opened*, next to a card that can be opened, on the one screen
in this app where vertical space is the scarce thing — and it was a 38px target inside a
row that was already 120px tall and doing nothing with any of it. So it is gone. **The
body of a shut card is the way into it**: the title, the pills, the whitespace beside
them. A pull request row and a JIRA row already worked this way, and now the question
card, the proposal, the delivery and the read-only agent bead do too.

Mechanically it is one attribute. A shut card's `<article>` carries the `data-act` the
button used to, so the list's existing delegated handler — one listener on `#list`,
`closest('[data-act]')` — resolves a tap on the body to the same branch. It is only
there while the card is shut: an open card is a full-screen sheet whose way out is
**↑ Collapse**, unchanged and in the same corner, and an article that still answered to
the act would close the sheet under the first tap on a paragraph of the brief.

**What a card contains is the whole difficulty**, and it is the half that does not show
when it is wrong. A tap on the graph link, on a proposal's ✓, on the answer box, on the
session log you are dragging sideways, on the bead id you are trying to select and copy
— every one of those must do its own job and *not* also open the card underneath it, and
when it goes wrong the control still fires: the card opening over it just reads as the
app being keen. Two rules keep it right, and they divide the work:

- **`closest()` does most of it for free.** Every control drawn on a card carries its own
  `data-act`, so it is *nearer* than the article and the card never hears about the tap.
  That is not a list to maintain — it is the same delegation the app already had.
- **`cardBodyOpens` covers what carries none**: links, the native form elements and the
  `<label>` that stands for a checkbox, and the `<pre>` a session log is read in. Plus
  the one that is not an element at all — **a live text selection**. Selecting a bead id
  to copy ends in a click, and a card that expanded under every attempt to copy the one
  line worth copying would be worse than the button ever was. Nothing sets `user-select:
  none`; the tap is dropped, the selection is kept.

Saying so, on a screen with no hover and no cursor, is a **press tint**: the card goes
down under the finger, which is what every native list row does. It is suppressed while
a control *on* the card is the thing being pressed, because a ✓ tinting the whole card
would say the card was about to open, which is the one thing that tap does not do.
`cursor: pointer` is beside it for the desktop half — and on iOS it is also what makes
`:active` fire on a non-button element at all, so the two rules are load-bearing in that
order.

`node test/cardtap.mjs` (part of `npm test`) holds it: both renderers run for real in a
`node:vm`, the guard driven case by case over a fake tap, and a source read that no
`<button>` anywhere in `public/app.js` answers to the act any more — a second emitter of
it would be the old control grown back somewhere else in the file.

### And the card says it heard you before the brief arrives

Opening a card is a fetch. `expand()` asks `/api/question` — or `/api/bead`, for a read-only
agent bead — and only *when that comes back* does it open the card and repaint. On a laptop
beside the daemon that is invisible. On a phone on a train it is a card that sits there
doing nothing for a second, and **a tap with nothing to show for itself is a tap people
make again**: the press tint above lasts exactly as long as the finger is down, so the
moment it lifts there is no evidence the app heard anything at all. The second tap then
lands on the card as it opens, on whatever is now under the thumb.

So the tap is answered at once, by the card itself. `.card.opening` is a ring around the
card it was tapped on, put on inside the tap's own handler — before the request is even
made — and taken off by the repaint that opens the card. Three things about it are the
whole design:

- **It cannot arrive late.** The class is written by `paintOpening()`, DOM surgery on the
  one node, the same choice the ⋮ menu makes and for a sharper version of its reason: a
  `render()` would rebuild the list to add one class, and the reconciler would then rebuild
  that card a second time when the fetch landed. `state.opening` holds the key as well, so
  a poll repainting the list mid-fetch paints the mark back rather than losing it with the
  node it was written on — the division of labour `state.menu` already had.
- **Nothing moves.** It is an outline at `outline-offset: -2px`, drawn inside the card's
  own border box, so the box and the words on it are pixel-identical across the tap. The
  [draft edge](android.md#an-unsent-draft-outlives-the-page) is an inset shadow for the same reason,
  and the difference in *shape* between the two is deliberate: an edge down the left is a
  standing property of the row — you did not finish, the tracker refused — and a ring is
  something happening to it right now. A card can wear both, which is the ordinary case
  rather than a corner.
- **A card that is already open in all but name never flashes it.** If the list row already
  carries the thread, `expand()` fetches nothing — and with nothing to await, the mark is
  set, cleared and the card redrawn inside the one event, which a browser cannot paint the
  middle of. That is not a timing trick: it is why the clear lives in `expand()` immediately
  before `openOnly()` rather than back at the tap.

The mark is cleared **whether or not the fetch worked**, which is the failure this feature
could newly introduce. `expand()` swallows both of its refusals and opens the card on what
the list already knew, so a mark cleared only on success would sit lit on a card that had
finished with it until the page was reloaded. Under `prefers-reduced-motion: reduce` the
ring stays and its slow pulse stops — the animation starts *at* the full ring rather than
fading up to it, so switching it off leaves exactly the first frame.

It belongs to the two card kinds that actually wait: the question card and the read-only
agent bead, which share the one `toggle` branch. A pull request row and a JIRA row answer
to their own acts, and both of those already put the sheet up first and fetch underneath
it — they never sat inert, so there is nothing to mark.

**A third place waits the same way, and bc-ka5y.14 gave it the same mark.** `p0-answer` —
"Answer it" on a bead already expanded in an epic's tree — is `await expand(key)` and
nothing else, the identical call the list's own `toggle` makes, so it had the identical
half-second of nothing on a slow link. `[data-p0bead]` is the tree row's own shape, not
`.card`, so `paintOpening()` grew a second selector rather than a second function, and
`p0RowHtml` interpolates it exactly as `cardHtml` does — through the one shared
`openingCardClass`, called with a plain `{ key }` since a row is drawn from a `bd` row and
not a question. One `state.opening`, whichever surface set it; both selectors sweep every
time, because the caller only knows a key and not which screen it is currently on.

Reusing the mechanism surfaced a bug the card side never had to face. **A card's own
`render(true)` was always enough on its own — a tree row's is not.** Opening a card always
flips `.open` on that same list chunk, so its rendered HTML is never what `warm.paint` last
recorded for that key and the node is rebuilt clean, taking the surgically-added class with
it. A tree row tapped through `p0-answer` transitions nothing of its own: it was already
open in the tree before the tap, and every class on it besides `opening` is unchanged by
the card it answers landing — so the freshly rendered `@p0` chunk can come out
byte-for-byte what `warm.paint` already has on file, and a reconciler that sees no
difference leaves the stale node exactly as it was, mark and all. `expand()` now calls
`paintOpening()` a second time, right after its own `render(true)`, to strip the class by
DOM surgery regardless of whether the render rebuilt anything under it — one query with
nothing to find on the card path, and the only thing that clears the row path at all.

`node test/cardpending.mjs` (part of `npm test`) holds the half a browser is not needed
for: both renderers run for real, `paintOpening()` is driven over a hand-made list — cards
and rows both, together and singly keyed — to prove a second tap *moves* the mark rather
than adding one, and the style is read for anything that could shift a pixel.
`node scripts/pending-check.mjs` and `node scripts/p0answerpending-check.mjs` are where the
timing itself is proved, in a real Chrome against a deliberately slow fixture each — the
click is dispatched and the class counted inside one evaluation, so no frame can have gone
by in between.

## What a question is blocking

A question whose answer nothing is waiting on is just a question. One that blocks
seven issues is a queue, and that changes how fast you want to answer it — so an
open card that blocks anything gets a **What this is blocking** link, into the
dependency graph. It appears with the details rather than on the collapsed card,
because `bd human list` doesn't return a dependent count and `bd show` does — the
same reason `commentCount` is 0 until you open a question.

The graph itself is at `/graph?ws=<workspace>` with an optional `&id=<bead>`, and a
scope switch between *this bead* and the *whole workspace*. Tapped from any view, it
opens as a [drawer over that view](navigating.md#detail-opens-over-the-tab-not-instead-of-it)
rather than as a page you have to find your way back from.

### It grows, five beads at a time

beadcause used to frame `bd graph --html` directly. It was free, and it was wrong on
a phone in three ways — all of which came from the same thing: the page is built to
be opened on a desktop, once, by somebody who will wait.

- **Nothing happened for five seconds, then everything did.** loremia is 108 beads
  and 140 edges; `bd` takes ~4s to walk it, and the page draws the lot in one frame.
  A blank screen for five seconds reads as broken.
- **Every title was truncated.** bd's nodes are 130x40, so each one is an ellipsis.
- **A node was a dead end.** Tapping told you nothing you didn't already see.

So the server now hands over `{nodes, links}` and the phone draws it (`lib/graph.js`,
`public/graph.js`). Beads arrive in batches of **five, every 130ms**, ordered by bd's
computed layer — so the graph grows the way the work does, things that can start now
first — and a counter reads `35 of 108` while it fills, with a **Pause**. The view
re-frames itself as it grows and once the layout settles, never zooming past 1:1.

The numbers still come out of `bd graph --html`, parsed server-side, rather than from
`bd graph --all --json`: that page embeds exactly the render model we want — id,
title, status, priority, type, layer, typed edges — where `--json` returns entire
issue descriptions we would throw away.

### Tap a bead, then open it

Tapping a node raises a **card** with the whole title, its status, priority and type,
and two buttons. **Details** opens the bead itself in a sheet — who owns it, what it
blocks and what it waits on, **how it ended** if it has, **what its session did** where
one ran, then the whole body:
description, **acceptance**, **design**, **notes** and the thread, each rendered as
markdown under its own label, in the order `bd` itself prints them. Served by `/api/bead`, which is `bd show` plus
comments rather than `/api/question`'s decision shape (every node is an ordinary
issue; only some are questions). The sheet takes 72% of the screen, and **⤢** takes
the rest of it.

This is the only general-purpose bead reader in the app — the inbox card only ever
shows beads carrying the `human` or agent labels — so anything the sheet leaves out
is readable nowhere but a terminal. It used to stop after the description, which
meant the acceptance criteria, the one part you close a bead against, were exactly
that. The description alone stays unlabelled, the way it is on the card, so a bead
carrying none of the other three looks precisely as it did.

#### The ⋮, and editing the bead you are looking at

The sheet had no menu. Every action it offered was a row it had decided to draw — the
owner buttons, the adopt picker on an orphan — so anything that was not one of those was
not reachable from a phone at all, and the general-purpose bead reader was a reader only.

It carries the inbox card's **⋮** now, left of ⤢ and ✕: what is about the *bead*, beside
the two that are about the sheet. Same button, same popover, same CSS (`.kebab`, `.menu`,
`.menu-item`) — the two surfaces that show a bead should not need learning twice. Behind
it, one item: **Edit**, which swaps the sheet body for the six-field card the adjust form
on `/endorse` already uses — `editHtml` in `public/endorse.js`, so `title`, `type`,
`priority`, `description`, `acceptance` and `labels`, which is `EDITABLE` in
`lib/verdict.js` — with Save and Cancel.

Four things about it are decisions rather than details:

- **It posts to [`/api/bead/edit`](operations.md#http-api), not to `/api/bead/adjust`.** The adjust
  route is a verdict on a *proposal* and refuses anything no longer `unendorsed`; the
  sheet is not a queue row drawn a minute ago, it is the bead in front of you, so it
  inherits none of that. Nothing on this page endorses, revokes or moves any marker.
- **Save repaints from `/api/bead`, not from the form.** The route answers what *moved*
  (`{changed, fields[], …}`), which is not what the bead now says: `normalizeEdits`
  clamps what it was sent, and the edit writes a line on the thread saying what changed.
  Both of those are on screen a second later because the sheet re-read the bead. One
  extra round trip, and the only version of this that cannot drift from what `bd` holds.
- **Cancel repaints from the copy the last fetch left**, so it costs nothing and can
  never show a bead assembled out of what you had typed.
- **On a closed bead, Edit is greyed out with the reason under it.** The route answers a
  closed bead with a `409` — its description is the record of what was done rather than
  an instruction — and that is the one refusal a client can predict, because the sheet
  already knows the status. Predicted as a *missing* item it would read as "this app has
  no editor"; disabled, with the sentence, it is the same fact said out loud.

**The labels the daemon owns are not in the box.** The card posts the label set it is
showing, so "remove what I no longer see" is how a removal is expressed, and a protected
label drawn there is one you can delete and watch come back. `isProtectedLabel` in
`lib/verdict.js` is the authority and `public/graph.js` keeps a copy of it, because
nothing under `public/` imports from `lib/`. `human` is hidden for a neighbouring reason
— `normalizeEdits` filters it out of the *incoming* set, so the card can never send it —
and what that costs is `bc-ka5y.46`. `complexity:` is deliberately still offered.

#### How it ended — the close reason, and when

The sheet drew the status pill, and the status pill said `closed`. What it never drew
was `close_reason` or `closed_at`, which is the sentence saying what actually happened
— and those sentences are the good part of this tracker. `bin/deliver.js` writes
`Landed as #138 as 10892e4b — still owed: CAN BE DEPLOYED`; an answer closes with
*Answered via Beadcause*; a revoke keeps its reason under a fixed prefix; a supersede
says `Superseded by bc-rk2o`. Every ending in the system is a sentence, and none of
them was on the one screen every bead link in the app opens. It was readable from a
terminal, or nowhere.

So a closed bead now carries a framed note **directly under its pills**: *Closed 11 Aug
2026, 18:54*, and the reason under it, through the same `FROM_BD` renderer every other
bd field on the sheet goes through. Above the description rather than below it, which
is the whole placement argument — the pill raises the question, and on a finished bead
the answer is what you came for. Below the body is where you go looking for it, scroll
past it, and conclude it is not there.

**Nothing here clamps.** The worst close reason in this tracker is 1664 characters and
the sheet body already scrolls, so there is nothing to gain by folding it — and
something real to lose. [The History tab](navigating.md#the-ledger--the-history-tab) clamps its own
copy to two lines precisely because tapping the row lands here; clamping at both ends
would put the sentence nowhere in the app at all. That page can now go the other way
too, and carry a slimmer payload with a real tap-through behind it.

**Only while the bead is actually closed.** `bd` clears `closed_at` on reopen and
leaves `close_reason` sitting there — `lib/landed.js` leans on exactly that — so
reading the field without checking the status would tell you a bead that is open again
finished last Tuesday. A closed bead nobody gave a reason for still gets the date; a
bead with neither draws nothing at all, and looks precisely as it did before.

`test/graphsheet.mjs` covers it, in the same node:vm slice of the real `sheetHtml` the
relations block is checked in — including that the stylesheet has rules for the block
and that none of them clamp.

#### The way through — what its session did

The close reason says a bead landed. It does not say what the session that landed it
*did*, and that is archived in full: a log, its metrics, the memories it left, where its
worktree went. So under the outcome block the sheet carries one more row, and it is the
only row on the sheet that leaves the tracker — everything else here goes to another bead.
Tapping it opens
[`/bead-session?workspace=…&id=…`](advocates.md#reading-it-back-on-the-phone--bead-session) in the same
drawer panel the sheet itself opens in, so one back gesture returns you to whatever list
you came from.

That completes the trail the [History tab](navigating.md#the-ledger--the-history-tab) starts. A row
there carries `🗄` when a session was archived for that bead, tapping the row opens this
sheet, and until now the mark you followed was the end of the road: the page behind it
existed and nothing in the app pointed at it. The row wears the same glyph deliberately —
the mark you chased is the mark you land on.

**Three states, and the interesting part is which way each is allowed to be wrong.** The
row is drawn on every bead at first paint, before the answer is in, because finding out
costs a request and the sheet may not wait on one — the same trade the children block
makes. So it starts as *looking*, and resolves to either a link or a plain sentence:

- *Looking* is deliberately **not tappable**. A row that is a link and then stops being one
  loses the tap of somebody who reached for it as it resolved; quiet-then-tappable cannot
  lose anything. The flicker only goes one way.
- **An archive** is a link, with how many sessions ran on the bead and when the newest one
  did. Three sessions on a bead is a fact about the bead, and the page opens on the newest.
- **Nothing archived** is the same box, muted, and a `<div>` — nothing to tap, nothing to
  focus. That matters more than it sounds: most beads in this tracker were never worked by
  a session at all, and a link that opened *"not available"* three times in a row would
  teach you to stop following it.

And a **check that fails offers the link anyway**, which looks like the wrong branch and is
not. The two mistakes are not symmetrical. Saying *no session* over a bead that has one
hides the page for good, because nothing on the sheet would ever suggest looking again;
offering a link over a bead that has none costs one tap onto a page whose entire design is
[saying plainly what is not there](advocates.md#reading-it-back-on-the-phone--bead-session). The
degraded path goes the way you can recover from.

**It asks `/api/session-archive`, not the endpoint the page itself uses.** Not a field on
`/api/bead`, for the reason `/api/bead-links` is a route of its own: anything folded in
there is a `git` call every sheet open waits for. Not `/api/bead-session` either, though
that is what `/bead-session` loads — it reads the archived tree, `meta.json` and the state
of the worktree, which is several `git` invocations spent answering what is really
`sessions.length > 0`. `?workspace=&id=` on `/api/session-archive` is one `git log` over
one ref, it already existed, and presence plus a date is the whole of what the row draws.

`test/graphsheet.mjs` covers all three states out of the same slice, plus the four lines
that do the resolving — asserted on the source, because every render check above them
passes just as happily over a row stuck saying *looking…* forever.

#### What is under it — the children, and the ones already done

Under the description, an epic lists **every child it has**, one tappable row each, with
the fraction beside the heading that `bd show` prints under its own CHILDREN section:
`6/7 done`. Closed children are shown by **default**, because an epic whose finished work
is invisible reads as though it never started; **Hide closed (6)** folds them away when
what is left is the question, and that choice is remembered — across sheets, and across
reloads. Nothing is folded on your behalf.

This one costs a second `bd` call, and everything about how it is loaded follows from
that. Children are simply **not in `bd show --json`**: on bc-goo, an epic with seven, it
returns `dependent_count: 7` and not a single row — the text output has a CHILDREN
section and the JSON has nothing to read it from. So it is `/api/bead-links`, a route
of its own, and the sheet **does not wait for it**: it paints from `/api/bead`, then
appends the block below the description when it lands. A call that is slow costs the
block; a call that fails costs the block and says nothing, because replacing a sheet you
can already read with an error would take the bead away over the part of it that did not
arrive.

It is not asked for at all unless something points at the bead, and what decides that is
`dependent_count` — every edge pointing *at* it, of which a child's is one. Zero
dependents means nothing to draw, so the leaf beads that are most of what you tap ask
nothing.

#### What is waiting on it — the list `blocks 7` used to be

The other half of the same hole, and the reason the route is not called
`/api/bead-children` any more. `dependent_count` was a pill and nothing else: `blocks 7`,
not tappable, answering none of the question it raises. Worse, it counts **every** edge
pointing at the bead and a child's is one of them — so bc-goo, an epic with eleven
children and nothing whatsoever waiting on it, announced that it blocked eleven beads,
every one of them already listed under Children.

So the same call answers both, and one row per edge lands under the heading its edge
actually means:

- **Blocks** — beads that cannot start until this one closes. A queue, and the thing the
  pill was trying to say.
- **Discovered here** — work that came *out* of this bead, `discovered-from`. It waits on
  nothing; calling it blocked would invent a queue.
- **Related** — `related`, which bd stores once, on whichever bead it was created from.
  So it appears above the description on one of the pair and down here on the other, under
  the same word, because it means the same thing from either end. Its successor
  `relates-to` — what `bd dep relate` writes, and what [every bead id in
  prose](#every-bead-id-in-prose-is-an-edge-behind-it) now draws — is stored at **both**
  ends instead, so it is already up above the description and is dropped here rather than
  printed twice.
- **Children** are lifted out entirely and drawn by the block above. The same eleven beads
  under two headings is the failure this split exists to prevent.

`bd dep list <id> --direction=up` is what knows. It hands over a full row per edge **plus
the `dependency_type`**, which is why it replaced `bd list --parent` as the sheet's one
call rather than being added beside it: parenthood in bd *is* a row in `dependencies` —
the issues table has no parent column — so `--direction=up` filtered to `parent-child`
and `list --parent --all` answer with the same eleven ids, and asking for the children
separately would have been a second round trip for something already in hand.
`Bd.children` stays for the two callers that only ever wanted children: the close gate and
the advocate.

**The pill goes when the rows land, and only then** — the rule `waits on N` already
follows. The count is what can be said before the edges are in hand and a worse version of
what they say afterwards, so a call that fails leaves it up, because then it really is all
there is. A bead that blocks something and parents nothing — bc-7w1l, one dependent — used
to pay for a call that came back with nothing to draw; it gets a row now, which is what
makes the gate above exact in both directions.

Three bugs found building the sheet, all worth knowing because they're the kind that look
like something else:

- **`hidden` loses to `display`.** `#empty` is an absolutely-positioned overlay across
  the whole canvas; giving it `display: grid` silently beat the UA's `[hidden]` rule,
  so an invisible box sat over the graph eating every tap. The graph looked drawn and
  completely dead. Every overlay here now carries its own `[hidden] { display: none }`.
- **d3-drag suppresses the click after any movement.** Its `clickDistance` defaults to
  0, so a tap that slides one pixel — which is every tap made by a finger — is a drag,
  and the click never fires. `.clickDistance(8)` fixes it.
- **d3 transitions share a default name.** The nodes' fade-in and the auto-fit's zoom
  transition kept cancelling each other, leaving every node stuck at opacity 0.0004 —
  a fully drawn, entirely invisible graph. The fade is a CSS animation now.

### Every bead id in prose is an edge behind it

The **Related** rows above were, for most of this tracker's life, a heading nothing ever
filled. Measured on 2026-08-13 over 850 beads: the prose held **1,633 references** from
one bead to another, **710** pairs were already joined by an edge of some kind, and the
whole graph contained **two** see-also edges — one drawn by hand days earlier, the other
minutes before this was built. Everything an agent needs to start fast was in those
references — "the same defect as bc-767a", "see also bc-rcrt", "sits in bc-42ow's
neighbourhood", "superseded by" — and none of it was reachable by `bd show`, `bd dep
tree`, this graph or a dispatch brief. So building context was a reading task rather than
a traversal, every session paid it again, and mostly did not: bc-xl7n filled to 87
unsorted children while seven epics that had already classified most of them sat closed.

The fix is not better habits. A bead id written in a paragraph now becomes an edge, in two
passes that share one module (`lib/mentions.js`):

- **As it is written.** Every prose write that goes through `Bd` — a comment, an answer, a
  close reason, an appended note, a bead's description at `create`, the fields an `update`
  actually moved — draws a `relates-to` edge for each bead it names. `Bd.relateMentions`.
- **Over what was already written.** `npm run relate -- -w <workspace>` sweeps the export
  and every comment thread on it. Dry by default: it prints every pair it would draw and
  writes nothing until `--apply`, because a sweep over a tracker two Macs and twenty
  sessions share is not something to find out about afterwards. `--no-comments` makes it a
  single `bd export` and no per-bead reads, which is the right shape for a fast look.

  **Run `--apply` against an instance that already has this code deployed.** The two
  spelling fixes below are what keep a fresh see-also off the "waits on" side of a card,
  and until the daemon is running them a thousand new edges would land on the phone
  counted as live blockers. Nothing is *broken* by that — `bd ready`, the close gate and
  every advocate read `blocks` edges only, so no queue moves — but the graph would read as
  a tracker where everything is stuck behind everything.

**What an edge here claims is `mentioned near`, and nothing more.** lib/beadref.js argues
the opposite case and is right about its own question — "which bead is this pull request
*for*" decides what gets *closed*, so a delivery whose body ended "nothing was done about
bc-2tr, which this unblocks" must not count as four claims. This question is weaker and is
answered honestly: there is no verb tier, because a bead that says it did *not* touch
bc-2tr is still a bead a reader of bc-2tr wants to know exists. The precision is in what
is refused instead — a bead's own id, a pair the graph already joins by any edge at all, an
id that does not exist, and anything past a cap of 40 on one bead.

**The cap is a runaway guard, not a precision knob.** An epic naming twenty-three adoptees
really does relate to all twenty-three, and capping that at five would throw away the exact
structure this exists to capture. What it is for is the comment nobody intended as a list —
a queue dump, a paste of `bd ready` — which can name every open bead in the workspace. Forty
is where the gap is: exactly one bead here reaches it — bc-xl7n, the catch-all root, whose
prose names 55 because naming every kind of work there is *is* what it is for — and the next
largest description names 28. The first full sweep of this workspace plans **1,308** new
pairs across 554 beads.

**It costs nothing when there is nothing to do.** The regex runs in process, before any
child: prose naming no bead — most comments — spawns nothing at all. Prose that does name
one costs two reads, and a *write* only for a pair with no edge yet, which after the sweep
is nearly never. Reads do not take Dolt's single writer, so a comment repeating the same
three ids is two reads and no lock.

**And one write draws at most eight, against the sweep's forty.** The hook runs inside
`bd.respond` — what a tap on a phone runs, awaited on the request path — and a `bd dep
relate` is about a second and a half, so forty would be a minute of somebody waiting for an
answer that was already recorded before the first edge was drawn. Eight is well clear of
what a single write produces: 1,308 pairs across 554 beads is 2.4 apiece for a bead's
*entire* history of descriptions, notes and comments together. A comment past eight is a
list somebody pasted.

**Nothing here may fail the write it hangs off.** The comment is what the caller was asked
to record; the edge is a courtesy on top of it, and a tracker that refused to record an
answer because a see-also would not draw would be far worse than one with a missing edge.
Every failure is swallowed and what is returned is the ids actually drawn.

Four things that had to be got right, and each of them was a real failure first:

- **`relates-to`, not `related`.** `bd dep relate` writes the first; every reader in this
  repo — `NOT_BLOCKING` in lib/graph.js, `RELATED` in public/graph.js — was written against
  the second, because the single edge that existed when they were written was made by hand
  under the older name. Harmless over one edge; load-bearing over a thousand, every one of
  which would otherwise have arrived on a card counted as a **live blocker**. A bead that
  merely mentions eight others would have announced that it waits on eight.
- **Both ends have to be read before anything is written.** `bd show --json` carries only
  the *outgoing* half — bc-arj0, an epic with eight children, comes back with an empty
  `dependencies[]` and `dependent_count: 8`, because a `parent-child` edge is stored on the
  child. And `bd dep relate` **refuses** a pair that already carries an edge of another
  type, *after* writing the first of its two rows, so a relate over a parent-child edge
  leaves a one-ended see-also behind and reports failure. The sweep collects pairs from
  both ends of every export row for the same reason: read one-directionally, bc-xl7n
  planned sixty-nine see-alsos to beads it already parents.
- **Bulk wiring is all-or-nothing.** `bd dep add --file` takes newline-delimited
  `{from, to, type}` and does a thousand edges in one spawn instead of half an hour of
  `bd dep relate` holding the single writer — but it validates the whole batch and rejects
  **every** line if one names a deleted id. Ten such ids were in this workspace's prose
  (`bc-swr`, `bc-q1`, `bc-xxx` — typos, placeholders, beads long deleted), which is why the
  sweep filters against the export's own id set and then chunks: a surprise costs one chunk
  rather than the sweep. The write-time hook uses one `bd dep relate` per pair instead,
  where the batch is two or three and a per-pair failure costs only that pair.
- **A `relates-to` must not be printed twice.** bd stores it at both ends, so it is already
  in `bd show`'s dependencies and drawn above the description; the incoming copy is dropped
  from the list below rather than grouped, the same way children are.

**And when a declared dependency lands on the same pair, the declared edge wins.** bd
holds one row per *ordered* pair and refuses a second type on it, which turned the good
habit into the bug: a proposal that says *why* it waits on `bc-x` names `bc-x`, the hook
draws the see-also as the description is written, and the dependency the proposal actually
declared is then refused for ever — `already exists with type "relates-to" (requested
"blocks"); remove it first`. That is exactly the shape of proposal this app asks people to
write. So the collision is settled by precedence rather than by ordering the two writes:
a `relates-to` came from a word appearing in a paragraph and a `blocks` came from somebody
deciding, so the mention is taken off and the declared edge goes in its place. Ordering
would only have hidden it — the sweep above runs on its own, long after the bead was
filed, on a pair nobody is writing.

Three things that fall out of that, and the middle one is the one a passing test would
have lied about:

- **Never the other way round.** A prose mention does not demote anything, because it
  never reaches the question: `planFor` skips any pair the graph already joins. And only a
  see-also may be displaced — `discovered-from` above all, because provenance is an older
  fact than whatever wants the pair now, which is the same trade `lib/adoptsweep.js` makes
  from the other side.
- **Both ends of it.** `bd dep relate` writes two rows and bd refuses per *ordered* pair,
  so dropping only the row bd named lets the retry through and leaves the pair holding a
  `blocks` one way and a `relates-to` the other — two rows saying different things about
  the same two beads, printed under two headings on the card. The far row is read before
  it is deleted, so a pair that holds a mention one way and something older the other
  keeps the older one.
- **A refusal is asked once.** The retry test in `Bd.run` was a substring match on `lock`,
  and bd's sentence ends `(requested "blocks")` — so every refused edge looked exactly
  like Dolt lock contention and spent five spawns and four seconds of backoff proving what
  the first millisecond already knew. Fine while a refused edge was an accident; not fine
  on `/api/console/create`, which is a tap on a phone. Answered here for that one sentence
  and, since, for every sentence — see below.

### Every refusal that says "blocks", not just the one that was in the way

The line above was true of far more than edges, and the general half of it was left
deliberately: narrowing the retry test touches **every** `bd` call in the daemon, which is
not a change to make as a side effect of a bug fix about dependencies. It is made on its
own terms now.

`LOCK_RE` in `lib/bd.js` decides whether `run` asks again, and it read
`/(lock|locked|another process|resource busy|database is busy)/i` — a substring match. Both
*blocks* and *blocked* contain *lock*, and those are two of bd's commonest refusals: a
`dep add` over a pair that already holds an edge, and a close over an open dependency
(`cannot close bc-x: blocked by open issues […]`). Neither is contention and neither
changes its mind, so a write with `retries: 4` spent five spawns and 400+800+1200+1600ms
being told the same thing five times, and a sweep read spent three.

**Nothing failed and nothing warned, which is why it lasted.** The rejection is identical
either way, down to the sentence in it — the only observable difference is the spawn count
and the wait, so it surfaced only when a fixture that expected two `dep add`s watched ten
go past. `TERMINAL_RE` fixed the one sentence that had just become routine on a request
path; this is the rest of them.

The fix is one word boundary:

```js
const LOCK_RE = /(\block\w*|deadlock|another process|resource busy|database is busy)/i;
```

`\block\w*` still matches *lock*, *locked*, *locking* and *lockfile*, and does not match
*blocks* or *blocked*, because the boundary fails after a `b`. `deadlock` is spelled out
separately for the mirror-image reason — the *lock* in it is preceded by a word character,
so `\block` can never reach it.

**The way this comes back is not somebody deleting the boundary.** It is somebody adding a
spelling beside it — putting bare `locked` or `locking` back as an alternative, which reads
like a widening and is a silent revert, because *blocked* contains *locked*. So
`test/lockword.mjs` checks the alternatives **one at a time**, each against bd's real
refusal sentences, rather than checking the regex as a whole — the whole regex is exactly
what a new alternative keeps passing. The rest of that suite drives `run` against a fake
`bd` that prints one sentence and tallies a byte, and counts the spawns for each: the
count is the assertion, because it is the only thing the two families disagree about.

**And the rule reaches two writers that are not in the daemon at all.** `Bd.addDep` is
the funnel for every declared edge the daemon writes, and it is `async` all the way down
because everything around it is. Two more run in a worker's terminal over a synchronous
`(argv) => stdout` runner — `park`, which is what `beadcause-ask --blocks`,
`beadcause-propose --kind conflict` and `beadcause-deliver` use to hold work behind a
question, and `mark`, which puts a `superseded-by:` marker on a duplicate. Neither could
reach the funnel, so neither carried the rule. `addDeclaredEdge` in `lib/mentions.js` is
the synchronous half of it: the same `demoteRows` judgement, the same both-ends demotion,
the same one retry and no loop, and a refusal over anything that is not a see-also is
thrown back at the caller in bd's own words exactly as before.

Worth doing before either path could actually collide, because the two failures are not
the same size. `mark`'s fallback is a note — the `superseded-by:` label holds the bead
whether or not the edge went in, so the collision costs the graph record. `park`'s
fallback is to label the *work* bead `human`, which takes it out of every queue **and does
not come off when the question is answered**. So there a collision does not lose an edge,
it strands the bead until somebody goes back to it deliberately — and a bead whose
description says why it is waiting on `bc-x`, which is the description doing its job, is
exactly the bead a mention would have got to first.

One thing it does not fix, deliberately: the `blocks N` pill at first paint is
`dependent_count` straight from bd, which counts every edge pointing at a bead — children
already, and now see-alsos too. It is replaced by the real rows the moment
`dep list --direction=up` lands, and there is no count bd offers that would be better.

Checked by `test/mentions.mjs` (the module, the hook against a fake `bd` that records its
argv, and the two client-side spellings in source) and by `test/graphwaits.mjs`, which is
where the `relates-to` spelling is held to not blocking anything. The precedence rule has
its own two: `test/declarededge.mjs` against a fake `bd` that remembers its own edges, and
`test/declarededgereal.mjs`, which files a bead whose description names the bead it depends
on against the real binary and asks bd what is left. The synchronous half is pinned where
each of its two callers already is — `test/park.mjs`, whose stub `bd` grew bd's
one-row-per-ordered-pair rule so a park can be refused over a mention and go in anyway,
and `test/superseded.mjs`, where the same collision is staged against a `bd` with a graph
behind it.

### The glass in the middle

A phone can hold the whole graph or one readable bead, never both. loremia's 128
beads only fit a 393px screen by shrinking to a thirteenth, where a title measures
**1.4 css px** — the fit was working perfectly and producing a field of coloured
specks. Zooming in to read one is the obvious answer and the wrong one: you lose
the shape of the work, which is the only reason to draw a graph at all.

So the fitted view stays, and a **circle in the middle of it is magnified** — sized
for three beads across and the rows above and below, at a scale that never passes
1:1. You pan the graph under the glass instead of zooming into it. A `[ ]` reticle
frames whichever bead is under it and a pill underneath names it in full, because
a node clips its title at twenty characters and that is the one thing magnifying
cannot fix. Open the graph for a particular bead — the **What this is blocking**
link — and once the layout settles that bead slides under the glass on its own.

The magnification needs no layout maths at all. Holding the centre of the screen
fixed and scaling about it by `m` is, in screen space, exactly
`translate(c(1-m)) scale(m)` — so the loupe is a `<use>` of the scene carrying that
transform, clipped to a circle. There is no second layout and nothing to keep in
sync: the force simulation ticks the original and the copy follows.

Two things that are not obvious:

- **The copy takes no pointer events, so taps have to be re-aimed.** Inside the
  circle you are looking at the magnified copy while your finger lands on the
  shrunken original underneath — without intercepting the tap and mapping it back
  through the magnification, tapping a bead you can read selects a different bead
  you cannot. It is a capture-phase listener, so it runs before the nodes' own.
- **The glass is down until the graph has finished arriving**, and hides itself
  whenever it would magnify by less than 1.1 — at that point it is a ring drawn
  around what the screen already shows.

On a workspace as large as loremia the glass is about as wide as the whole fitted
graph, so the overview it is supposed to sit inside has very little left to show.
That is the layout's fault rather than the loupe's: the force spreads by dependency
layer along **x**, so a portrait phone fits to width and leaves 59% of the screen
empty above and below. Rotating that axis is still open — see `bc-z7s`.

### Checking it on a phone

The graph is the one screen that was only ever verified in a desktop browser, which
is the one place it is never used. `node scripts/phone-check.mjs <workspace>` opens
it the way a phone does — headless Chrome emulating an iPhone 14 Pro at 393x852 and
3x, mobile user agent, real two-finger touch events — and asserts the four things
that only break on a phone: every bead ends up on screen, a pinch zooms, the view it
opened on is still reachable afterwards, and a tap raises the card. It needs the
daemon running; `--base=http://127.0.0.1:PORT` points it at a checkout instead, and
`--out=DIR` saves a screenshot. No dependency — it drives Chrome over the DevTools
protocol on Node's built-in `WebSocket`.

Run it with the window hidden and it will still be honest: Chrome throttles an
occluded renderer to about one frame a second, the force layout never settles, and
every measurement becomes a measurement of the throttling — so the script disables
that explicitly. That is also the answer if the numbers ever look impossible.

It also prints what the glass is doing — how much it magnifies, how big a title is
inside it, how many beads it has room for — and `--id=<bead>` opens the graph the
way **What this is blocking** does and asserts that bead ends up under it.
