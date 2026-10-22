# Navigating the app

## Getting around — the pill row

The standing views — it started as four: the **inbox**, the **chat session**, the
**sessions** and the **advocates**, with the **pull requests** and the **admin**
screen since. They are separate pages, and each one used to end in an ✕ in the top right
that hard-navigated back to `/`. That made the inbox a hallway — chat session to advocates
was two taps through a page you did not want — and the ad-hoc cross-links that grew to
paper over it (sessions → advocates, advocates → sessions) were the same complaint,
admitting itself.

The answer to that was a bar along the bottom, where a thumb already is. It was the right
answer for a year and it is gone (bc-khoe.1), because by the end the app had **two** of
them: that bar, which moved between pages, and the chip row on `/monitor`, which swaps a
pane — drawn alike, at opposite ends of the screen, and telling them apart was something
you had to have learned. On top of the two, the inbox's filter panel held ten *kinds*,
which are categories doing a view's job.

So there is one row now, under the top bar on every page the bottom bar was on:

```
  ┌──────────────────────────────────────────────────────┐
  │ ● Beadcause                              🗳  ⌨️  ⟳ │
  │ Personal ▾                                    3 ▸    │
  ├──────────────────────────────────────────────────────┤
  │ [🏠 Home 7] 🎯 My Epics 2 ❓ Questions 3 🚢 PRs 2 …  │  ← scrolls sideways
  └──────────────────────────────────────────────────────┘
```

Ten pills today, on ten pages: the [seven kinds](inbox.md#one-list-six-kinds--and-the-two-sub-filters)
bc-khoe.2 promoted out of the inbox's filter panel — Home, My Epics, Questions, Chats,
Ledger, All Beads, PRs — plus Advocates, plus
[Releases](pull-requests.md#releases--the-view-those-queues-are-drawn-on), plus
[Config](asking.md#space-details--every-setting-a-space-has-on-a-page-of-its-own), the selected
space's own settings, which bc-khoe.10 took off the advocate console. Releases sits next to
Advocates because the two are read one after the other — the board is where you decide
something may land and Releases is where you watch it do so — and Config is rightmost
because the row is ordered by how often a thumb reaches a pill and this is the one you
reach about once a month. Its glyph is knobs and not a gear: the gear in this app is
`/admin`, which is the *machine's* settings and is in the mark's menu, and two settings
screens behind one glyph is the confusion that menu exists to end. The other five pages
that used to load the bottom bar (`/admin`, `/console`, `/endorse`, `/flow`,
`/requirements`) draw the row with **nothing on it current**, which is their way off a page
that would otherwise be reachable only by the browser's back gesture.

**A pill is a link only when there is somewhere to go, and the current one is a `<span>`.**
Tapping where you already are should do nothing, not throw away the list, the conversation
and your scroll position to rebuild the same screen. The current pill is marked twice over
— `aria-current="page"` for a reader that cannot see the accent, and the filled pill for
one that can — because colour alone is not a mark.

**Two more things count as "already here", and each one turns a link into a `<button>`.**
The first is a view whose [pane is in this document](#the-shell--one-document-one-pane-per-view):
since bc-khoe.30.3 the app is one document with a container per view, so the pill writes
the hash and the pane swaps, and nothing is fetched. The second is a kind, which is Home
under a different narrowing (bc-khoe.2) — five of the nine pills are that, and as links
they would each be a full document load to change which rows of a list already in hand get
drawn. On the shell that holds from *every* pane: `PRs` tapped while the Ledger is up carries
both the pane to show and the kind to select, so one tap does both. On a page that is not
the shell it is an ordinary link, `/?kind=pr`, read once at load — so the pill behaves the
same way from anywhere and only the mechanism differs.

**Which one is lit follows the same split.** Away from Home it is the view showing — the
pane on the shell, the address on the eleven pages that are still their own documents. On
Home five pills share one address *and* one (empty) hash, because a narrowing is not a
place and is not something the back button should walk, so the *filter* is the answer
there, pushed at the row by `public/inboxfilter.js` rather than read by it. The row is on
twelve pages and the filter on one; a row that read the selection itself would have to know
the storage key, which is the second place that knows what a kind is.

**The row scrolls sideways and never wraps.** There are nine pills today — Releases joined
them when the deploy strip left the PR board, and Config when the space's settings left the
advocate console — and there will be roughly ten once Advocates and Mirror fold in. A row
that wrapped to a second line on a 360px phone would spend a row of a screen that is mostly
chrome already, which is the thing this change exists to stop. The selected pill is scrolled
into view on load — done by arithmetic on the two rectangles rather than with
`scrollIntoView`, which is allowed to scroll every ancestor and would quietly move the list
under it.

**Five counts, and only on Home.** Home, My Epics, Questions, PRs and Chats each carry a
number: how many rows tapping that pill would leave you with. All Beads, Ledger, Advocates,
Releases and Config carry none — the first is unbounded and says nothing you would act on,
and the other four are pages of their own with their own polls.

This reverses a decision this section used to record, and the objection it was written
against still stands as written. Advocates carried a badge once — how many proposals were
waiting — and it went with the bar, because a badge is a number about a page you are
*not* looking at and it was only ever live on the one page whose poll happened to fetch
it. What answers that is **where** the number is drawn rather than what it counts. It is
drawn on Home alone, off data the page is already holding: `surveyKinds` in
`public/app.js` counts the rows per kind on every render — before the kind filter and
after the space picker, so the number is what *picking* the pill gets you rather than what
you are already looking at — because the filter panel needed those numbers before the row
did. The badge is a second reading of that one count, refreshed by the same 25-second poll
that redraws the list beneath it, and there is no page it can be stale on because there is
no other page it is drawn on. Off Home the pills are plain links with nothing on them.

`Home` is the number nothing counts directly, and it is derived in
`public/inboxfilter.js` rather than by the caller. Home is a *place* and not a slice — it
has no predicate, so no row is ever *of* that kind — and what tapping it does is clear the
selection, which leaves every row that survives its own sub-filter. That is the sum of the
slices, so summing them is the same arithmetic done once, and the badge and the list cannot
come to disagree about it.

**`My Epics` is the other one, and it is handed in rather than derived.** Its screen is the
board, which is not a list of rows at all, so `public/app.js` counts the cards it just drew
and passes them to `survey` — unconditionally, on every render. The `board: true` flag on
that row keeps the number out of Home's sum, because a board is not something Home draws.

**This is the shape bc-fwp2c left, and it is worth saying what it replaced.** The two pills
were one pill. Landing on Home *was* landing on My Epics, so one badge had to describe two
screens, and bc-khoe.49 made it a choice: the cards when the board was what a tap left you
with, the row sum when a list was. The condition turned on the board having cards — an
empty board fell back to the flat list (bc-6s96), and the number honestly followed it. What
that produced, on an account whose epics are somebody else's, was `My Epics 46` printed over
`Questions 21` and `PRs 25`: the sum, correct about the screen, sitting under a word about
epics. Two pills need no such choice. Home draws the list and counts the rows; My Epics
draws the board and counts the cards; neither number is ever a promise about the other's
screen. The other three badges never had the problem at all — `surveyKinds` runs ahead of
any gate, so `Questions`, `PRs` and `Chats` have always counted exactly what tapping them
draws.

**Pushed at the row, never pulled by it, and written as text.** `public/viewbar.js` is
loaded on twelve pages and `public/inboxfilter.js` on one, so the row cannot read the
numbers itself — they arrive through `window.beadcause.views.counts(map)`, beside the
`mark(id)` that says which pill is lit, from the same `paint`. It is a no-op off Home and
for any id the row draws no badge for. The update replaces the badge's *text* and never
goes through the row's `draw()`, which rebuilds every node in it: the inbox repaints every
25 seconds, and a row rebuilt on that timer drops the focus ring off a pill somebody is
tabbing through. A count of zero is drawn as `0` rather than by hiding the badge, so a
pill does not change width under a thumb already on its way to it.

The count the bar used to carry is still served and still on screen, in the advocate
console's own tally ("3 working · 1 to answer"), beside the repo it belongs to instead of
standing in for all of them.

**What is not a pill, and why.** `/admin` is the screen you least want under a stray
thumb, so it loses the rightmost tab it had — and it does not need one: since bc-khoe.5 it
is a row in the menu the top bar's gear-wrapped mark opens, on every page rather than only
the one that happened to carry a ⚙. **A create** has had no place on the navigation since
bc-l8jp.5: `Chats` is a pill now, but it is the pill for the conversations you already
have open, and starting one is still the ＋ on Home — a pill goes somewhere, it does not do
anything. The endorsement queue's absence is a recorded decision (bc-j0zl, [never a sixth
tab](pull-requests.md#where-it-lives-and-the-tab-it-is-not)), and bc-khoe.2 honoured it: a bead held for
endorsement is a row under **Questions** rather than a pill of its own. `/flow` and
`/requirements` are pages you read when you are new to the system or arguing about it, not
pages you check. A page can be reachable, load-bearing, and not a view.

**The board is not a pill, and the word `PRs` now means something else.** bc-l8jp.6 took
`/prs` off the bottom bar on the rule that a tab was a claim a page is somewhere you
*live*; bc-d4d5 then found that taking it off had left nothing at all pointing at it, and
made it a chip on the advocates page; bc-khoe.1 gave it a pill back. bc-khoe.2 needed the
label — **PRs** is the kind pill now, the pull requests and the finished branches *in
Home* — so the board's three paths (`/prs`, `/pulls`, `/prs.html`) moved to the Advocates
pill, which is the pill that points at the page they actually serve. The board is two taps
rather than one, and it stays two: bc-khoe.30.6 re-decided it with the rest of the chip row
and left it a mode of the console — see
[The advocate console is one pane, and its chip row stays](#the-advocate-console-is-one-pane-and-its-chip-row-stays).

⟳ stays in the top bar of the views that have it: it acts on the view you
are looking at rather than taking you off it. ⌨️ (the terminal) and ⚖️ (the
foundations) stay in the inbox's top bar too — they are places you go for one thing
and come back from, not views you live in.

An **open question is the exception**: a card you have opened takes the whole screen,
pill row included, because the answer buttons at its foot must not sit under anything.
Collapsing it gives the row back. That behaviour belongs to `.card.open` and to the
inbox alone — the accordion on the pull request view marks its unfolded card
`unfolded` instead, because a card that took the screen over the navigation was a page you
could not leave, on a view whose first load unfolds one.

### Every page is an app shell, not a document

The chrome used to be `position: sticky` (the top bar) and `position: fixed` (the bar along
the bottom), on a document that scrolled — and on a phone neither of them stayed still.
Both are laid out against the **layout** viewport while what you are looking at is the
**visual** one, and on iOS those are not the same rectangle: the URL bar collapses as you
scroll down and grows back as you scroll up, moving the layout viewport under a fixed
element, and a rubber-band overscroll translates the whole page with its fixed children in
tow. The bottom bar slid half off the screen. No arithmetic fixes that, because the numbers
are right and the rectangle they are measured against is the one that moves. That was
bc-7utr, and Adam superseded it with bc-khoe.1 — deleting one of the two bars dissolves
half of it, and the technique below is the other half.

So the document does not scroll. `html` and `body` are clipped, `body` is exactly one
viewport tall (`position: fixed; inset: 0`), and every page is a flex column:

```
  .topbar        flex: none
  .viewbar       flex: none
  .pagescroll    flex: 1; min-height: 0; overflow-y: auto   ← the only thing that scrolls
```

`.pagescroll` is marked **in the HTML** rather than inferred from a content class, because
"the scrolling region" and "the list" are not the same claim: the reader (`/doc`) wraps two
elements in one scroller, and the foundations screen has a `.thread` inside a `.pagescroll`
that scrolls on its own. Anything that must *not* scroll away goes outside it — the two
rows of chrome, the inbox's filter line, the advocate console's chip row.

Two declarations in there are load-bearing and neither is obvious. `min-height: 0`, because
a flex item's default `min-height: auto` is its content, so without it the scroller grows
to fit the list instead of scrolling it and pushes everything else off the screen — the
original bug back, wearing a different mechanism. And `.pagescroll > * { flex-shrink: 0 }`,
because `.card` is `overflow: hidden` and a flex item that clips has an automatic minimum
size of **zero**: without it every card in a list squashes to a fraction of its height to
make the whole list fit one screen, and the page still scrolls and still looks like a list.

The quiet half of the same change is in the scripts. On a shell `window.scrollY` is 0 for
the whole visit and `window.scrollTo` moves nothing, so any repaint that "restored your
place" through them was restoring a number that was never anything else — `app.js`,
`endorse.js`, `prs.js` and `flow.js` all read and write the scroller's own `scrollTop`
instead. `app.js`'s scroll listener is `{ capture: true }` for the same reason: a `scroll`
event on an element does not bubble, so a bubble-phase listener on the window never hears
it, but it is still dispatched down the capture path.

`node test/shell.mjs` is the static half of the guard, in `npm test`: neither row of chrome
is `fixed` or `sticky`, `body` still carries the shell's declarations, every page marks a
scroller or is named as one with nothing to scroll, a pill is still over the 44px a thumb
needs, and no page reaches for `window.scrollY` again. `node scripts/topbar-check.mjs`
measures the real thing in a real Chrome at 360×640 and 393×852: it scrolls the scroller
and asserts that both rows are in *exactly* the same place afterwards and that the document
has not moved at all, which is the same geometry as the bar staying still through a URL-bar
collapse.

`node scripts/tabbar-check.mjs` — ~750 lines of cover for the deleted bar — went with it,
and `node scripts/viewbar-check.mjs` is the row's own replacement (bc-khoe.9). It drives
every page that loads `/viewbar.js` at 360×640 and 393×852 and asks the things a row of
navigation has to be true of before anybody can trust it: that exactly the pills the
source lists are drawn, in its order; that the one saying *you are here* is a `<span>` with
no href and the rest are links or buttons; that each is a 44px tap target and a tap on it
reaches it rather than something drawn over it; that the row is one line and scrolls
sideways instead of wrapping; and that the pill saying where you are is scrolled into view
on load, which is asked again on a viewport too narrow for the row to fit, because that
promise is unobservable on a row with room to spare.

It also holds [the four counts](#getting-around--the-pill-row), and that half is the only
one it feeds real data for. The fixture serves a known list — three questions, two chats
and three pull requests of which one is merged — so the badges are asserted against
arithmetic on what was served rather than against themselves, and the merged one is the
point of the third: `PRs` is counted through its own status sub-filter, so a badge saying
3 there would be the pill promising a screen it does not open. Then each pill is tapped
and the rows it leaves on screen are counted, because *the number agrees with the list* is
the whole claim and the numbers alone cannot make it. Which pills carry a badge is read
out of `PILLS` like everything else, so a pill gaining or losing one is an edit to the row
rather than to the check; that no pill carries one off Home is asserted on all eight pages.
Two more are asked by pushing numbers straight at `window.beadcause.views.counts` — that
the badge element is the *same node* after the number moved and focus is still on the pill
it was on, and that the row is still one line at 360px with every count at three digits.

Two things about it are derivations rather than lists. The **pills** are read out of
`PILLS` in `public/viewbar.js` — bc-khoe.10 and bc-khoe.7 each change that set, and a list
copied into the check would make both of them a check edit as well; which pill should be
lit on a given page comes from that same array's `paths`, so *nothing is current* on
`/console` or `/admin` is asserted exactly as firmly as *`advocates` is* on `/monitor`. The
**pages** are read out of `public/` — every `*.html` that pulls in `/viewbar.js` has to be
driven, so a page that starts drawing the row without being added fails the check rather
than quietly going uncovered. The one list it does write down is the eight pages the
deleted bottom bar was on, which is history rather than state: without it the page list is
only self-consistent, and a page could drop the row and drop out of the check in the same
edit. It closes by asking the other half of [the row's own
argument](#getting-around--the-pill-row): that nothing the bottom bar reached is a dead
end, and that `/admin` — which is on no row on purpose — is still reachable from a standing
page, through the Admin row in the mark's menu or a page's own ⚙.

The static half of the row is in `npm test` alongside it, because a browser check wants a
Chrome and this repo's gate does not have one: `node test/inboxkinds.mjs` holds the row's
six kind pills to the kinds table they are a copy of, and `node test/prstage.mjs` holds the
board's three paths to whichever pill is claiming them.

The *paths* are checked separately, in `npm test`: `node test/pagepaths.mjs` asks a
real server for every URL a phone might still have on its home screen and checks which
document came back — all five that reach the advocate console, both that reach the pull
request board, and so on — plus the two kinds of path that must **not** resolve: `/work.js`,
deleted with the sessions view, and `/mirror` and `/mirror.html`, which were never made
because [the Mirror is a pane](#the-mirror-is-a-pane-not-a-tab). The aliases live in a
run of one-line `if`s in `serveStatic`, which is exactly the shape a merge eats, and a
broken one is silent: the page is fine, the shortcut is not.

### One hash, two claimants — the grammar in `public/hashroute.js`

The URL hash is a single slot and two different things want it.

It has meant one thing since the app had notifications: `#<workspace>/<beadId>`, a card to
open on Home. That is what `lib/notify.js` puts in every ntfy `click`, what `lib/slack.js`
links to and what the Android shell deep-links with — `${baseUrl}/#${encodeURIComponent(q.key)}`,
which is why a bead key's slash arrives as `%2F`. Those URLs are **not ours any more**.
They are sitting in a notification shade, in a Slack channel and in the phone's own
notification history, and there is no migration available for any of them, so a phone
opening one next month has to land where it landed the day it arrived.

bc-khoe.30 wants the same slot: [every view becomes a pane](#getting-around--the-pill-row)
of one document and the hash is how you move between them — `/#history`, `/#advocates` —
so that a pill tap costs a `display:none` rather than a document load. Two grammars over
one slot, written in two files, is how a deep link quietly changes a filter instead of
opening a card. `public/hashroute.js` is the one place that decides, and it decides four
things:

* **A view is a bare name; a card is everything with a shape.** The view names are a closed
  list of three (`epics`, `history`, `advocates`) held in that file. A card key is
  recognised by shape rather than by lookup, because the app mints exactly three:
  `workspace/id` for a bead — the only form that has ever been in a notification — plus the
  `pr:` and `jira:` prefixes for the two rows synthesised rather than stored. No view name
  contains a `/` or a `:` and no bead key is a bare word, which is what makes the two halves
  incapable of colliding.
* **A card hash always means Home.** `parse` answers with a view for *every* hash, and for a
  card that view is Home. A deep link names a question and questions live on Home, so a bead
  link arriving while another pane is showing is *switch to Home, then focus the card*.
* **An unrecognised hash falls to Home and changes nothing.** A typo, a stale link to a
  renamed view, a fragment some other tool appended — none of those is a reason to show a
  blank pane, and none is a reason to write anything.
* **One slot, so the last write wins.** There is no combined form, because a card already
  names its view: there is nothing to hold alongside it.
* **A view may carry a query, and only a view may.** `#history?status=closed&priority=P0`
  is [the ledger](#the-ledger-as-a-pane-and-its-filters-in-the-hash) narrowed, and the
  part after the `?` is handed back as an opaque string for that view to read — this file
  has no opinion about what a filter means, only about where one is written down. The split
  is on the **raw** hash, at the **first** `?`, before any decoding, and only a head that is
  one of the closed list of view names may have one: a card key is percent-encoded, so a `?`
  inside one arrives as `%3F` and can never start a query, and a hash whose head is not a
  view name is parsed exactly as it was before this decision existed.

**The bug it exists to prevent is not hypothetical.** `focusHash` in `public/app.js` used to
decode the whole hash and hand it to `byKey`, and when `byKey` came back empty on the
`agent` scope it widened the scope to `both`, wrote that to `localStorage` and reloaded —
a good rescue for a deep link to a question the current scope hides, and completely wrong
for anything that was never a key. Every hash was a key, so every hash was a card that could
not be found, and `/#history` landing on Home silently changed a filter you had set on its
way to doing nothing at all.

The file also holds each view's **addresses** — the nine that are all the advocate console,
the two that are Home — which look like routing rather than grammar and are here because
they are the same question asked of the other half of the URL: which view an address names.
`public/viewbar.js` lights its current pill by asking `viewOfPath` rather than by carrying a
table of its own, and `test/pagepaths.mjs`, `test/prstage.mjs` and `scripts/viewbar-check.mjs`
all read the answer from there.

It touches no DOM and reads no `location` at load, so `node test/hashgrammar.mjs` runs the
whole grammar in a `node:vm` with an empty context: an old notification link round-trips to
the key that went in, a view hash is its view, a bead hash is Home from every address, and
an unrecognised hash is nothing. The wiring is checked as text in the same suite, because a
`<script>` tag is markup and no unit test sees a missing one — that both readers go through
the module, that every page loading either of them loads it first, and that it is precached,
which it must be: both callers call it flat, so a page cached without it throws before it
draws.

### The shell — one document, one pane per view

Every pill tap used to be a document load. History was `/history`, the advocate console was
`/monitor`, and a kind tapped from off Home was a full load of `/` to change which rows of a
list got drawn. Each of those threw away the list, the open card and where you were in it,
to fetch and rebuild a screen that was mostly the same screen — the same top bar, the same
pill row, the same workspaces re-surveyed. On a phone on a tailnet that is a second of white
several times a minute, to move between views of one app.

So `public/index.html` stops being Home and becomes the **shell**: one `[data-pane]`
container per view, all but one hidden, with `public/panes.js` deciding which from the URL
hash. Home is one pane among them rather than the document everything else departs from.

```
  <body>                       ← one viewport tall, clipped, a flex column
    <header class="topbar">    ← flex: none
    <nav class="viewbar">      ← flex: none, inserted at load by viewbar.js
    <div class="pane" data-pane="epics">      ← flex: 1 — the filter, the list, ＋
    <div class="pane" data-pane="history"     hidden>
    <div class="pane" data-pane="advocates"   hidden>
    <div id="toast">  <dialog id="setup">     ← the app talking, not a view
```

**Hiding is `display: none` and it cannot be anything else.** `visibility: hidden` and an
offscreen transform both leave the element in layout, and three panes in
[that column](#every-page-is-an-app-shell-not-a-document) would divide the slack three ways whether or not
two of them are painted: the shown pane would get a third of the screen and scroll inside
it, which is bc-7utr's bug back again wearing a third mechanism.

**The price of that is scroll position, and it is paid by hand.** An element with
`display: none` has no layout box, so it has no scrollport, so its `scrollTop` reads 0 while
hidden and comes back 0 — which is exactly the thing this change is buying. `panes.js` reads
every `.pagescroll` inside a pane on the way out and writes it back on the way in, in the
same turn as the unhide: the content was never unbuilt, only unpainted, so there is no
height still to arrive and no frame to wait for.

**A pane can be present and unshowable, and every one of them has been at some point.**
`data-pending` names the bead that fills a container, and it is load-bearing rather than a
note: a pending pane is registered nowhere, can never be shown, and the pill row asks the
same question, so its pill stays the `<a href>` it has always been and still loads its own
document. That is what let the shell land on its own. The alternative was two of seven
pills leading to a blank screen until two further beads merged, on an app that
[deploys itself](landing.md#ship-it--the-same-merge-and-then-the-deploy) the moment a branch lands.
History's attribute came off when
[bc-khoe.30.5 filled its container](#the-ledger-as-a-pane-and-its-filters-in-the-hash),
Releases' with bc-khoe.30.14, and Advocates' — the last of the four the shell shipped with
— with **bc-khoe.4**, which folded the whole advocate console in, chip row and all. Config's
went **on** afterwards, which is the direction worth noticing: bc-khoe.50 gave the row a
fifth view because a pill pointing at a page that is not a view marks nothing current on the
page it points at, and a view the grammar knows owes a container the same day. **bc-khoe.60**
filled it, and its going with nothing behind it is the fact worth stating: every view the
grammar knows has a live pane now, and the attribute is how a view *arrives* rather than a
debt the shell was born with — the next one to join `VIEWS` will carry it exactly the same
way. The attribute names the bead whose merge *deletes* it, which is why History's and
Releases' named the fold rather than the ruling that decided it, and why Advocates' named
**bc-khoe.4** rather than bc-khoe.30.6: that bead ruled how the fold goes rather than
folding it. `test/panes.mjs` covers the mechanism against fixtures now that the shell
itself has none left to read it off of.

**The row asks; it does not require.** `public/viewbar.js` is drawn on twelve pages and one
of them is the shell, so it reaches for `window.beadcause.panes` with `?.` and takes *no* as
the ordinary answer — where it reaches for the hash grammar flat, because a page that cannot
say where it is should fail loudly. That asymmetry is also why a phone still holding the
previous cached `index.html` is fine: no tag, no panes, no panes object, and the row draws
exactly what it drew before.

**A pill tap always pushes (bc-khoe.30.9).** Home's hash is the empty string, so `route.go`
clears it with `pushState`/`replaceState` rather than by assignment — a bare `#` left hanging
would be a different URL from the one the phone's home screen holds. It defaults to
`pushState`, because every pill tap, Home included, is a step the back button should walk
back through; `go` takes a `dismiss` argument for the one case that should still replace — a
card closing back to Home rather than a view being visited — which nothing calls yet, since
this shell has no card of its own.

`node test/panes.mjs` runs both files in a `node:vm` against a hand-made document: which
pane a hash lands on, that a pending one is never shown, that a scroll position survives a
switch away and back, that a view with a pane is never an `<a>`, and that the row with no
panes at all draws exactly the seven links it always did. Landing the old addresses on the
right pane was the last piece and it has landed (bc-khoe.30.7): `/history`, `/monitor`,
`/prs` and `/releases` are hops onto their panes now rather than documents of their own.

### The stager — built at boot, and one poll behind all of them

`panes.js` swaps which container is on screen and builds nothing. `public/panestage.js` is
the other half, and it is two claims that pull against each other.

**The view you land on must not be slower than it was.** A home-screen shortcut to
`/#history`, or a notification tap on a bead, must not spend its first frames building a
board nobody asked for. So the landed-on pane is built first, in the boot's own turn — for
Home that is the same instant `app.js` booted itself before any of this existed.

**Every other pane must be ready before the first tap.** A pane built on the tap that shows
it is the document load this whole change removed, wearing a new mechanism. So the rest are
built after the first paint, one task each, and are up long before a thumb has moved.
Nothing is ever constructed while you wait for it, and a pane hidden for an hour is correct
the instant it is shown.

**That is only affordable with one poll.** `public/stream.js` is one long poll, and its own
note is blunt about the bill: a parked client that asked for the inbox questions makes the
daemon sweep `bd` per event, so five panes each mounting one would be five sweeps per event
from a single page — [the timer's bill](#the-delta-stream--every-view-on-the-event-log)
arriving by another route. So the document holds one and the stager fans its wakes out. A
pane declares what it does with an event (`wake`) and what it needs from one (`want`), and
never opens a socket. **The request asks for the union of what the built panes want**, which
is `want=presence` — the free park — until some pane actually draws the inbox.

**There are two mounts and never two sockets.** The inbox owns the real one: it is the only
consumer that asks for the questions, it takes its sequence off its own payload, and it has
a timer behind it. But it follows the log only in `human` scope, so on any wider scope it is
off — and panes riding its wakes would go quiet with it, where the pages they replaced kept
polling. So the stager mounts a second with `standby: true`, which `stream.js` runs *only*
while no ordinary mount is following: it is stood down the moment one starts, put back when
the last one ends, and refused if it is started from anywhere else meanwhile — a visibility
handler, a retry, the freshness banner's **Retry now**.

**A pane that cannot register builds itself.** `register` answers whether the stager took
it, and a script whose answer is no does exactly what it did before — which is what keeps a
phone on a service-worker cache from before this file working, and why the boot moved into a
named function rather than into the stager. A builder that throws takes its own pane down
and nothing else; it is rethrown out of a timer so `public/report.js` still
[files it](incidents.md#an-error-the-app-hits-files-itself-as-a-p0) as the P0 it is, because a pane that
silently did not build is a blank screen with no account of why.

The standby is up now, and it is what every pane but Home rides: the ledger, the release
board and all three sections of the advocate console declare a `wake` and open no socket of
their own. Home still keeps its own poll, and the union of what the panes want stays at
`presence` — the free park — because not one of them draws the inbox's questions.

`node test/panestage.mjs` runs the four real files in a `node:vm` with the document still
parsing, which is what makes the staging visible at all: that the landed-on pane is built in
the boot's turn and the rest only after a frame, that a tap beating the staged pass builds
what it showed, that a throwing builder is contained and never retried, that the `want` is a
union and widening it moves the one request rather than opening a second, and that the
standby yields the socket the instant a view wants it and takes it back when the view lets
go.

### An address that names a view is a hop, not a document

`/history` is not a page any more. It is `/` with `#history` on it — and a phone's home
screen, the Android shell's history and every notification this daemon has ever sent still
hold the old address. A bookmark that 404s is a worse outcome than several names for one
view, so every one of them keeps working; what changed is what they answer with.

**A 302, and it cannot be a rewrite.** Every other short name in `serveStatic` rewrites the
path and the browser never finds out — `/queue` becomes `endorse.html` and the address bar
still says `/queue`. That works exactly because the thing being chosen is a *file*. A pane
is chosen by the hash, and a hash is
[never sent to a server](#one-hash-two-claimants--the-grammar-in-publichashroutejs), so
serving `index.html` at `/history` would load the shell with an empty hash: Home, built
first and shown, whatever was tapped. The hop is the only shape that can put a fragment on
the address bar, and it is better than a rewrite would have been even if a rewrite could
have worked — after it the URL says which view is up, and what you send somebody is the
screen you are looking at.

**The query string splits in two, and that is the only fiddly part of it.** A filter that
used to live in `location.search` lives in the hash's own query now, because in one document
a search string outlives the view that wrote it. But `?t=` is not the view's, it is the
daemon's: it is the pairing token an ntfy action and a home-screen shortcut both arrive
with, and a fragment is never sent to a server, so a hop that swept it behind the `#` would
turn the very next navigation into a login screen. So everything this daemon reads stays in
front of the `#` and everything else goes behind it, which is why `/closed?t=…` comes back
as `/?t=…#history?status=closed` rather than as either half alone. `viewHop` in
`lib/server.js` is the one place that split is made.

**A hopped path cannot be precached, and that is not a detail.** `Cache.put` refuses a
redirected response outright and the shell is installed as one all-or-nothing `addAll`, so a
single hopped path left in `SHELL` would leave *nothing* cached on every installed phone for
as long as that worker lived — an app that had merely got slower, with nothing said. So a
path leaves that list in the same commit that makes it a hop.

**Which leaves the offline half, and the worker answers it itself.** With those paths out of
the shell there is nothing cached under them, so an offline phone opening the `/history`
shortcut would miss twice and fall to the index page — the shell, served under the old path,
with an empty hash. Home, whatever was tapped, on exactly the phone the aliases exist for.
So `public/sw.js` holds `VIEW_HOPS`, the same table, and answers the same hop with a
`Response.redirect` when there is no daemon to ask. It sits *below* both cache lookups in
`fallback`, which is what makes it self-gating as the rest of the epic lands: a view still
served as its own document is still precached under its own name, so the exact match answers
it and the table is never reached. `/closed` and `/done` gain something they never had this
way — they still cannot be in the shell, but the far end of their hop is now a fragment of a
document the worker already holds rather than a page only the daemon can name.

**Two lists in two files, held together by a suite rather than by anybody remembering.**
`lib/pagealias.js` reads the daemon's hops back out of `serveStatic`'s own run of `if`s —
the path, the view and whatever the door narrows for itself — and `test/pagealias.mjs`
asserts the worker's table is that table, view for view, that no hopped path is in `SHELL`,
and that every path naming a view is a hop rather than a rewrite. `test/pagepaths.mjs` drives
the hops against a real server, including both halves of what one does with a query string,
and checks that each lands on the view whose own pill claims that address — a `/history`
that hopped to `#advocates` would show one pane and light another pill.

**Sixteen are hops now**, and they arrived in three commits rather than one. The
ledger's went first, while the other two containers were still
[`data-pending`](#the-shell--one-document-one-pane-per-view) — a path whose pane is pending
must keep its document, because a hop onto a pending container is Home, whatever was
tapped. So the rule the suites above enforce runs in *both* directions: a view whose pane
has landed owes its addresses as hops, and one still pending must not have them. That is
what made this safe to land in pieces, and it is what caught bc-khoe.4 and bc-khoe.30.14
filling their containers without flipping their paths — the failure names the addresses and
the three edits each one owes. It is also why Config's three addresses are **not** in that
table: bc-khoe.50 made it a view so the row could light its pill, its container is still
`data-pending`, and the same rule that forces a hop when a pane lands forbids one until it
does.

The board's three are the only hops that carry a **chip** as well as a view.
`/prs`, `/pulls` and `/prs.html` have always meant the board rather than merely the view it
is a section of, and `public/montabs.js` read that off `location.pathname`; after a hop
there is no pathname left, so the fact rides behind the `#` as
[`#advocates?tab=prs`](#the-advocate-console-is-one-pane-and-its-chip-row-stays).

### The advocate console is one pane, and its chip row stays

The Advocates pane is the biggest of the three by a distance and the only one with an
argument in it. `public/monitor.js` is 3,357 lines and it does not arrive alone:
`public/prs.js` (1,334), `public/mirror.js` (965) and `public/montabs.js` come with it,
because `/monitor` is not one screen — it is a chip row over four sections. So the pane
that costs the most to build is also the one that raises the question this epic exists to
ask, and it raises it *inside itself*: **two rows of things you tap, one above the other,
is the shape [the pill row](#getting-around--the-pill-row) was written to remove** — and
the chip row is the last one left. bc-khoe.30.6 is where that was settled, and the answer
is that it stays. Three reasons, in the order they decide it.

**The Mirror cannot be a pill, so the row cannot be dissolved.** It follows *another*
device and drops its own — the whole of
[The Mirror is a pane, not a tab](#the-mirror-is-a-pane-not-a-tab) — so a pill for it on
the phone the pill is tapped from leads to a screen that says "Looking for a device…" and
means it. That has now been tested three times against three different empty slots (a sixth
bottom tab, a bottom bar with room after PRs left, and this row) and come out the same way
each time. Whatever else happens to the chips, one of them is staying a mode.

**A row of one is worse than the row it replaced.** If the board and the settings became
pills and the Mirror did not, what is left is a single chip floating above the roster, which
is a control with no row to explain it — the reader has to work out that it is a switch
rather than a heading. The pair only reads as a switch because there is more than one of it.

**These are modes, not views.** A view is a different question about the tracker; the pill
row moves between those. What is under these chips is *one space's work* asked three ways —
what is running this minute, what is waiting to ship, and what another device is looking at
— which is the argument bc-3xb made for the Mirror and bc-d4d5 made again for the board, on
their own merits, before any of this. What was always wrong with the pair is that the two
rows are **drawn alike**, and that is bc-stci: restyle the chips as the segmented control
they already are. A restyle, not a deletion.

The row shrank on its own on the way here. bc-khoe.10 took **Config** out to a view of its
own, which leaves **Advocates · PRs · Mirror** — and it is why the fold waited: folding in a
section that another branch was deleting is work with a conflict already written into it.
bc-khoe.4 did the fold once that had landed, and bc-khoe.30.6 is the bead that decided the
shape and wrote it down here.

**What the fold actually moved, and what it deliberately did not.** The markup is
monitor.html's below the top bar, unchanged. The four scripts are not rewritten: each already
found its elements by id and each already started and stopped on `montabs.js`'s `onChange`,
so the row goes on owning the swap and is the pane's **one** registration with the stager —
`register` holds one spec per view id, and the row is the only thing on the screen that knows
which of the three is up. `build` is "put the remembered chip up"; `wake` is "hand the poll's
answer to whichever section asked", and it hands it to all three, because each of them knows
which half of a wake is free. Two element ids had to be decided rather than moved: `pulse` and
`refresh` exist in both documents, so the pane takes the shell's and leaves them alone — the
brand dot because `report.js` is already driving it and a second writer would clear it under a
fetch still out, the ⟳ because there is one for the whole app and each pane asks whether the
press was its own. `observing` kept its bare name only because the Releases pane gave it up
(`rel-observing`) for exactly this collision. The ⚙ did **not** come with it: bc-khoe.5 put a
standing Admin row in the mark's menu on every page, so a second one
hoisted out of this pane would be the same row drawn twice.

**`⦿ observing` and the roster's tally came down out of the bar into the row.** On
monitor.html both sit at the right of that page's own top bar. In the shell the top bar
belongs to every view and those two are facts about one of them — which Mac's daemon this is,
and how many advocates are working — so left up there they would sit over the inbox. They are
at the right-hand end of the chip row instead, which is the same place on the screen.

The row **wraps** rather than scrolling for them, and that was measured rather than guessed.
On a 393px phone, three chips and `⦿ observing` and the busiest sentence the tally can
produce — `12 working · 34 to answer` — come to more than the width, and the row's own
`overflow-x` would have answered that by putting the count off the right-hand edge where
nothing says it is there. A second line is the honest answer and it is only ever drawn when
there is something to put on it: both halves are empty on most installs, and the observer
mark on every Mac but one.

**The chip is on the address, and that is the third of the three ways out bc-khoe.30.6
named.** `/#advocates?tab=prs` — the query slot
[decision 5](#one-hash-two-claimants--the-grammar-in-publichashroutejs) opened for the ledger's
filters, because a chip is the same kind of thing as a filter: not a view of the tracker, a
narrowing of one. The alternatives were a second hash *form* for the chip, which bc-khoe.30.2
decision 4 declined outright, and a `sessionStorage` handoff, which is a second place the same
fact lives and cannot be reloaded into or sent to a phone. It is worth something on its own —
a reload comes back to the chip you were on — and it is what makes bc-khoe.30.7's redirect
possible at all: `/prs`, `/pulls` and `/prs.html` mean the **board**, not merely this view,
and once they arrive as `/#advocates` there is no pathname left to read them off.
`localStorage` stays the memory in both documents; the address says which chip *this arrival*
wants, and the store says which one you were last on when it does not.

**The nine paths stayed; the file did not.** Several are on a phone's home screen and in the
notifications the ship path sends, so bc-khoe.30.7 made each of them a 302 onto this pane — a
redirect in `serveStatic`, the path out of `SHELL` and into the offline hop table, and its row
moved from `PAGES` to `REDIRECTS` in `test/pagepaths.mjs`. After that no path could serve
`public/monitor.html`, and bc-l75v7 deleted it. The four files still carry the branches that
asked which document they were in; with one document left, those are dead code.

**And this is the one pane that stands down while it is hidden.** The stager's rule is that
a hidden pane stays live, so a pane you come back to is already right rather than catching
up, and that rule is correct everywhere else. It is wrong for all three of these sections.
The board is a `gh` sweep per repo — real money, spent on a screen behind two hidings. The
Mirror is worse than expensive: while it is up this device reports `view: null`, because you
are looking at somebody else's screen rather than at anything here, and a Mirror left
running behind Home would tell every other device in the house that this one is nowhere when
it is in fact on the inbox. So inside a pane, *hidden* means the chip is down **or** the pane
is, and a chip that is up inside a hidden pane is down.

That is one question with one answer, and it is `monTabs.up(chip)` — the row's, because the
row is the only thing that knows both halves. Each section asks it instead of reading its own
`hidden` attribute, which was the whole answer while this was a page and is half of one now.
The row is told the pane went away by `panes.onShow`, and it says so to its subscribers as
the empty string: every one of them already read its own name out of that argument, so a
hiding stands all three down through the code path that was there for a chip swap, and coming
back is the same call a first paint is. The presence report goes `null` with it, which is the
word this row already sends for the Mirror.

The roster is the exception to the exception, and it is free: its snapshot rides the stager's
shared wake, so it is current the moment you come back without having asked for anything.
That is why the fan-out hands a wake to all three sections rather than only to the one that is
up — `monitor.js` takes the free half of every wake whatever is on screen and guards only the
requests below it, and the board, which has no free half, guards on the first line.

### The ledger — the History tab

**The pill reads `Ledger`, and has since bc-khoe.53.** This section keeps the old word in
its heading because the anchor is linked from two places above and because the paragraphs
below are the record of a decision made when it *was* a tab. The rename is one word and no
mechanism: the id, the kind, `/history`, `/history.html` and the `#history` hash all stay
exactly what they were. What moved is the promise. `History` said *what already happened*
and the note under it said *the ledger of answered questions, merges and deploys*, and the
list has never been either — `parseQuery` in `lib/history.js` opens at `status: null` and
applies no default, so an open bead filed a minute ago is in it beside a bead closed last
month. `Ledger` is the word the page has always used for itself in its own first line, and
it does not collide with `All Beads`, which is live beads only.

There was no way to look back. The inbox is what is arriving, the advocate console is what
is running this minute, and a bead that closed last week had left both lists by definition:
it was reachable only if you still remembered its id and could be bothered to type it into
the graph's query string. Meanwhile 298 beads are closed in beadcause alone, and their
close reasons are unusually good — `Landed as #92 as 677b5a5b — still owed: DEPLOYED` is a
better answer to *did that ship?* than the PR board can give. The record existed in full
and nothing displayed it.

So **📜 History is the fourth tab**, and it earns one by the rule above rather than in
spite of it: the historical record is somewhere you live — it is where you go to ask *what
happened to that*. It sits third, between Advocates and Admin, which is two decisions at
once. The bar had to grow in the **middle**: Inbox stays leftmost because it is home and
it is `/`, Admin stays rightmost because it is the tab you least want under a stray thumb,
so neither of the two positions anybody has learned moves to a different edge. And of the
two middle slots it takes the later one, because the first three then read left to right
in the order the work does — what is **arriving**, what is **running**, what is
**finished** — and Inbox and Advocates, which are the pair you cross between all day, stay
adjacent.

The page is the selected space's beads, **most recently updated first**, paged as you reach
the end of it. Each row carries the id, the title, the type, the status, the priority, when
it last moved, its close reason when it has one, and a marker when a session was archived
for it. The reason is clamped to two lines here rather than ellipsised on one — these
sentences carry the PR number and the sha at the *end*, which is the half a single line
throws away — and the rest of it is one tap down, on
[the sheet's own outcome block](inbox.md#how-it-ended--the-close-reason-and-when), which is also
why [the payload stops at 240 characters](operations.md#the-ledger-behind-the-history-tab) rather than
carrying a sentence this page could never show. Tapping one
opens the bead detail sheet that already exists — `/graph?ws=…&id=…&open=1`, the deep
link `&open=1` was built for — so this page needed no detail view of its own and does
not have one. The `🗄` marker leads somewhere too, one hop further on: the sheet carries
[a row through to what that session did](inbox.md#the-way-through--what-its-session-did), which is
what makes the mark on the row worth following rather than a fact about it. The rows are real `<a href>`s, which is what
lets [the drawer](#detail-opens-over-the-tab-not-instead-of-it) hold that sheet *over* the list: this
is the one list you legitimately scroll four hundred rows down, and a full-page navigation
would spend that scroll on every bead you looked at.

**One picker, one request.** The [top-level picker](asking.md#one-space-at-a-time--the-picker-in-the-top-bar)
has exactly three states and `GET /api/history` takes exactly the same three: one repo is
`workspace=`, a space is `space=`, and `All spaces` is neither. So the selection is not a
filter applied to the response — it *is* the request, handed straight through, and what
comes back is already merged, sorted and paged across every repo in the selection, with a
`total` counted over all of them. What is left in the page is a cursor: an `offset`, a
`more` the server counted rather than inferred, and rows appended in the order they came.

One parameter and not two, which is the one place this is easy to get wrong: the picker
fills the *space* half in whenever you pick a workspace, so `{space: 'Personal', workspace:
'beadcause'}` means **one repo**, and sending both would be asking the server to guess
which of the two was meant. A page that got that wrong would draw a plausible list of the
wrong beads, which is the failure nobody reports because it looks like data.

This page was first built the other way, and the other way looked reasonable: one request
per repo and a k-way merge in the client over a buffer each, re-filling whichever ran dry
before the next comparison. It worked, and it was a second implementation of what
`lib/history.js` already does — with the subtlety in the merge, so having two was one to
disagree with the other. `ledgerWorkspaces` resolves all three picker states including the
synthetic `Other` group, which is what makes one request enough; the client merge is gone.

Two things it does **not** do. It does not stream: every other standing view mounts
`stream.js`, and one more long poll parked against a page about what already happened would
be paying for liveness nobody asked for, so ⟳ is the refresh and a record that reordered
itself while your thumb was travelling would be worse than one that did not. And **nothing
on it writes** — which is also why it is the one standing view with no `⦿ observing` chip:
that chip warns you that a button might reach a Mac you are not looking at, and there is no
such button on a ledger. It *does* filter, which it did not at first —
[four of them, in the query string](#narrowing-the-ledger--four-filters-that-live-in-the-url).

A repo that will not answer is named above the list rather than taking the other repos down
with it, and the total is drawn only when nothing is in `errors[]` — a count over the repos
that replied, presented as the whole, is the same class of lie the space picker's ⚠ used
to exist to prevent — and the reason that ⚠ is gone is that the picker stopped drawing
the number it qualified. When the answer is empty *and* something failed, the page says only that it could
not read: a selection nobody could read gives no grounds for a claim about what is in it.

Two things about failure and waiting here are not visible in the obvious place, and both
would look like a bug in the page:

- **A repo whose `bd` fell over is a `200`.** It comes back with a row in `errors[]` and
  the other repos' rows still present, not a failed request — so reading the status code
  alone draws it as a repo with nothing in it, and under a space of several repos that is
  one of them silently vanishing out of a merged list with nothing on screen to say so. The
  page reads `errors[]` and treats it exactly as it treats a refusal, every response rather
  than only when it is non-empty, so a repo that recovers on ⟳ stops being warned about.
- **The first read of a repo is slow, and legitimately so.** The daemon holds the
  unfiltered sweep for ten seconds, which makes the whole scroll free — but the sweep
  behind it has been measured at about a second for 500 beads on an idle Mac and **28
  seconds** on one under the load an ordinary afternoon here produces. So the page arms no
  client-side timeout at all (the daemon's own is 120s, and anything shorter here would
  make the tab look broken on exactly the busy afternoons somebody opens it to catch up),
  and it draws *Reading the ledger…* rather than an empty one, because `{rows: [], total:
  0}` is a perfectly good answer for a repo nobody has filed anything in and the two are
  otherwise the same blank card. ⟳ sends `refresh=1` and forces a fresh sweep — once per
  press, not once per page of the scroll that follows it.

### Narrowing the ledger — four filters that live in the URL

Five hundred beads newest-first is a record rather than an answer. The four things you
actually arrive wanting to say are **status**, **priority**, **who filed it** and *some of
the id* — and `GET /api/history` took all four from the day it landed, so the work here was
the controls and where their state lives.

They are in **the same collapsing panel the inbox uses**, and that is the point of the
control rather than a saving: `public/filtermenu.js` is the panel — the one line at rest,
the chips, the hover-on-a-laptop and tap-on-a-phone state machine — lifted out of
`public/inboxfilter.js` when the History tab became the second list in the app to narrow.
Two copies of it would not have looked like two copies. They would have looked like one
control that behaves subtly differently on two screens: the grace period on a diagonal exit
towards a chip, the tap that pins the panel open, the `pointerdown` that closes it *before*
the tap lands on the row underneath rather than after. Each of those is a decision somebody
made once after using the thing on a phone, and none of them is visible by reading the
second copy. So the inbox kept its half — which kinds of thing it carries, the counts, the
[PR sub-filter](inbox.md#one-list-six-kinds--and-the-two-sub-filters) — and the panel
became shared. `test/inboxkinds.mjs` passed over the seam unchanged, which is the whole
evidence that the split moved no behaviour.

The three chip groups are `Status`, `Priority` and `Filed by`; the fourth is a text box for
a **substring of the bead id**, which is deliberately not a title search. `nib3` should be
the five beads under that epic, not every bead whose title mentions history — titles are
what `bd search` is for, and one box next to three pickers that matched both would answer
neither question. `Filed by` is the **`agent-filed` label** and never `created_by`, which
is a field an agent writes whatever it likes into; the chip says so, because *Agent* over a
list that disagreed with a byline you can read on the sheet is a screen you would be right
not to trust.

**All four live in the query string and nowhere else.** No localStorage half, no
server-side memory, nothing to disagree with the address bar — because a narrowed ledger is
a *link*. `/history?status=closed&priority=P0` is a home screen shortcut to the P0s that
landed, it is the same screen for whoever you send it to, and
[`/closed`](#closed-and-done--what-got-finished-as-a-place) is that same URL under a
shorter name — a whole entry point that costs one redirect, and stays that small only
because the state is addressable rather than kept somewhere. The
inbox's kinds go the other way and stay on the device, because *I am reading merges this
hour* is not a place. Every chip is a `replaceState` — a filter is not somewhere you go
back *to*, and a panel of them would otherwise fill the back stack with steps between you
and the page you arrived from — and the `?t=` token is dropped on the way past, because a
filter link is a thing you send to a phone rather than a credential.

Which makes the URL something a person can type, so the four are **sent as written and
refused out loud**. `parseQuery` 400s on a word it does not know and
[names it](operations.md#the-ledger-behind-the-history-tab), rather than dropping the parameter — a
dropped filter is the whole ledger under chips claiming otherwise, and an empty one is
indistinguishable from a space nobody has filed in. The page draws that sentence under the
control, verbatim, and it does one more thing that matters more on a phone than it sounds:
a value the chips cannot represent becomes **a chip of its own, pressed, labelled with the
word**. So `?status=close` arrives as a refusal *and* as something to tap off, and the way
out of a mistyped link is never the address bar.

The rest is arithmetic that has to stay honest. `total` is what the filters matched rather
than what the space holds, so the count line says *2 beads match in beadcause* while
anything is narrowed and *4 beads in beadcause* when nothing is; an empty narrowed list
says *nothing matches* rather than *nothing here yet*, because those blame two different
things and only one of them sends you looking for a bead that is sitting under `All`. The
id box waits 250ms for you to stop typing, since `bc-nib3` is otherwise seven sweeps. And
clearing the last chip is a bare address, a request with none of the four parameters on it,
and the whole list back with no reload — which is the acceptance criterion this was built
against.

### The ledger as a pane, and its filters in the hash

Everything above describes `/history`, a document. It is a **pane of the shell** now:
`[data-pane="history"]` in `public/index.html`, shown by a `display: none` swap on a pill tap
with nothing fetched and nothing rebuilt. The old addresses still work and no longer serve
anything — `/history`, `/history.html` and
[`/closed`](#closed-and-done--what-got-finished-as-a-place) are all
[a hop to the pane](#an-address-that-names-a-view-is-a-hop-not-a-document) since
bc-khoe.30.7. `public/history.js` still holds the half that drew the document, because it
had to run in both while both existed; nothing can reach it now, and taking it out is
bc-khoe.30.15. Three things differ between the two, and they are the whole of the
difference.

**Where the filters are written.** On the page, the query string, exactly as above. In the
shell, the hash's own query — `/#history?status=closed`, which is
[decision 5](#one-hash-two-claimants--the-grammar-in-publichashroutejs) of the grammar. The
slot had to move, because in one document `location.search` outlives the view that wrote
it: narrow History to P0, tap Home, and the address the phone's home screen holds is
`/?status=P0`, carrying a filter for a view you are not on. `route.go('')` keeps `search` on
purpose — that is where `?t=` and everything else lives — so nothing else was going to drop
it. In the hash it is part of the name of the view, and leaving the view is what drops it.
Everything above about the URL being the state still holds; only the slot moved. A pill tap
writes the bare `#history`, so the pane puts its filters back on the address as it is shown
— otherwise the URL you could copy off the screen would be a wider list than the one on it.

**When it is built.** [The stager](#the-stager--built-at-boot-and-one-poll-behind-all-of-them)
builds the landed-on pane first and the rest after the first paint, so the ledger's boot is
offered to it and called by hand only when there is no stager to take it — a document, or a
service worker cache from before that file existed. A load that lands on Home costs one
script parse and no request at all; a load that lands on `/#history?status=closed` makes its
very first request the narrowed one, because the address is read before anything is drawn.

**What ⟳ means, and what keeps a pane honest.** The page had a ⟳ of its own; the shell has
one for the whole app, so it means *read the view I am looking at again* — each pane asks
whether the press was its own before spending a sweep on it, and `public/app.js` asks the
mirror of that question before reloading the inbox. And because a pane is built once rather
than fetched by the act of arriving at it, a ledger you came back to an hour later would be
an hour old with nothing saying so. So the pane does now listen to the shell's one poll —
**not** to fetch on an event, which would be a `bd` sweep per wake against a record of what
already happened, but to remember that *something moved* and re-read once, quietly, the next
time you look at it. Quietly means the rows you left stay under your thumb until the first
page of the new read lands and replaces them: a pane that blanked itself to *Reading the
ledger…* on every return would be the document load this whole epic exists to remove,
wearing a different mechanism. It declares no `want`, so the poll it rides is the free park,
and it is the first pane to put that standby mount up at all.

One id changed with the markup and it is not cosmetic: the list container is `hist-list`
rather than `history`, in both documents. The hash naming this view is `#history`, and an
element of that id in the same document is a **fragment target** — a browser asked to go to
`#history` scrolls it into view, which on the pane you are returning to is the scroll
position `panes.js` had just restored, thrown away by the URL.

`node test/historyfilter.mjs` runs the real `public/history.js` and `public/filtermenu.js`
in a `node:vm` in both documents: on the page every check above, and in the shell that
nothing is fetched before the stager builds it, that the hash it landed on narrows the first
request, that a chip writes the hash and leaves the query string alone, that leaving and
coming back keeps the filters and puts them back on the address, that a wake which moved
something is re-read on the next look with the rows left up meanwhile, that a `presence`
event costs nothing, and that ⟳ is spent by the pane that is up and by no other.

`node scripts/historypane-check.mjs` is the other half, and a different kind of claim: the
real `panes.js`, `panestage.js`, `viewbar.js` and stylesheet, in a real Chrome at 393px,
against its own fixture ledger and no daemon. Four things are only true in a browser — that
the pane lays out as one scroller inside the shell's column, that the scroll position comes
back (which is the single thing this epic is buying), that the pill stopped being an `<a>`,
and that landing on `/#history?status=closed` builds the ledger *first* and makes one
narrowed request rather than a wide one corrected afterwards. It ends by loading `/history`
as a document and asserting the same list with its filters in the query string, which is the
compatibility half this bead is standing on until bc-khoe.30.7.

### The docket — an epic's whole arc

Adam, on the cards that arrive on the phone: *"the cards coming to me are sometimes hard to
understand quickly because a lot of context is missing."* A card carries the bead and
nothing around it — its title, its description, its decision block, its thread. What it
cannot say is where the bead sits in the arc it belongs to: what was decided before it,
what has landed, what is in flight beside it, why it sat for four days. The only way out
of a card was `/graph?ws=…&id=…&open=1`, which draws what the bead is *wired* to and has no
dates in it at all.

`/docket?ws=…&id=…` is the rest of it. One page per epic, four blocks, and the order of
them is the argument:

1. **Where it is** — the epic's own title and description, and one line of counts. First,
   because it is the question you arrive with: is this nearly done or barely started.
2. **The phases**, when the epic has [a plan](advocates.md#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window). A planner
   already broke the work into named groups, and a page that made you re-derive that from
   a list of thirty beads would be throwing away the best writing on the bead. Each group
   is `done`, `running` or `waiting`, computed from the family rather than stored — a plan
   is written once and the beads under it move for weeks afterwards.
3. **The map** — every bead in the family, indented by depth, **in the order they were
   filed**. A board sorts done-last because a board is a list of what to do next; a docket
   is the opposite question, so a bead that closed in June keeps the place it had. The
   bead you came from is lit.
4. **The chronology** — everything dated, grouped by day.

**It roots at the top of the family, not at the nearest thing typed `epic`.** `issue_type`
is what the filer chose and nothing enforces it: there are roots here typed `feature`,
`task` and `bug` with a dozen children under them, and beads typed `epic` with none. What
a person means by "the epic this card belongs to" is the top of the tree it hangs from. So
a card links to `/docket` with **its own** id and the page walks up itself, which is what
makes it one link rather than a lookup — the inbox does not carry ancestry for every card,
and a link that needed it would fail exactly when the graph cache was cold.

That also means the second card out of the same epic lands you on a page you have already
read once, rather than on a fresh wall of text.

#### What is folded, and how each rule knows

Everything dated is in the payload. What the fold does is decide which lines a day draws
before you ask — and it is not a guess at what is interesting. Each visible kind is tied
to the one place in this tree that writes the thing:

- **a ruling** — the comment `Bd.respond` writes immediately before closing with
  `Answered via Beadcause`, found by the clock: the last comment at or before `closed_at`
  on a bead closed for that reason. Not the "noted, thanks" an agent leaves on the thread
  the next morning.
- **a reply** — a comment on a bead carrying `human-replied`, which `POST /api/comment` is
  the only thing that sets, and it sets it when you typed into the box on a card.
- **a filing and a close**, the close carrying its reason, which is the best writing in
  the tracker.
- **a plan**, because an epic's phases are a decision about the epic.
- **a pull request opened or merged** — the deliveries.

Everything else folds: every other comment, the claim, and each archived session run. A
day says how many lines are behind its control, because a control that did not would be
asking you to tap to find out whether tapping was worth it. **Folded is not dropped** —
the events are all in the payload, flagged `machine`, and *why was this week quiet* is
answered by exactly the lines a stream that dropped them could not show. The fold is per
day rather than one switch for the same reason: the question is always local, and a single
switch answers it by expanding a fortnight at once.

**Author is not the test, and could not be.** [The byline
rules](operations.md#whose-beadcause-wrote-it--the-byline-on-every-daemon-write) are explicit about
it: a `beadcause` byline covers both your relayed tap and the daemon's own bookkeeping,
and a bare address is either you at a terminal or an agent whose shell exported your
`BEADS_ACTOR`. So who spoke rides on the line as a **voice** for you to weigh — `an agent`,
`beadcause`, or a name — and never as the thing that decides what the page shows.

#### What it costs, and the two joins it refuses to pay for

One `bd export` per workspace, cached thirty seconds under its own key, and everything on
the page filtered out of it in process — the ledger's bargain, for the ledger's reason. It
is deliberately **not** the export `Bd.graph` already keeps: that index drops the
timestamps, the close reasons and every comment on purpose, because seven hundred bodies
of prose in a cache every inbox repaint reads would be a cost with no reader. The docket is
made of exactly what it throws away, and it is opened a few times a day.

The two joins are both borrowed rather than bought:

- **Pull requests come off a board somebody else already swept.** A `gh` sweep is the most
  expensive thing in the app; a page opened from a card cannot start one. So `prsKnown:
  false` travels out to the page and it says *pull requests not swept yet* rather than
  *no deliveries* — those are different sentences, and only one of them is about this epic.
- **Sessions are one `for-each-ref` for the whole workspace**, intersected with the family
  before anything is read, and then a `git log` only for the beads that listing says have
  an archive. A family of twenty on a tracker of eight hundred would otherwise be twenty
  `git log`s to discover that two of them ran.

There is no poll. A docket describes a fortnight, and the one thing it must not do is
compete for the daemon with the inbox that is waiting on an answer.

#### Getting to one

Every card links to it — the agent card's actions row, the question card's brief, and every
bead row on the [epic board](inbox.md#epics-assigned-to-you-and-the-tree-each-one-carries), where it sits *before* the graph link because
the tree you are already looking at is this bead's family and the docket is that same
family with its dates on. And every bead's **detail sheet** carries it too, as a row under
the session row — which is how [the ledger](#the-ledger--the-history-tab) reaches one
(bc-xl7n.152). The ledger's row is itself a link to that sheet, and a list you scan is not
one that grows a second control per row, so the docket is the sheet's second tap rather than
the row's first. `/docket` with no `id` is the index: every root that has
children, newest activity first, with its counts, for when you want to catch up rather
than answer something. `/epic` and `/dockets` are the same page — both are names a person
types.

`node test/docket.mjs` holds the rules: that only `parent-child` edges make a family (a
`discovered-from`, which `lib/filing.js` puts on everything an agent files, must never pull
the backlog in), that a ruling is found by the clock and not by the author, that nothing is
dropped by the fold, that a cycle is answered rather than hung, and that `public/docket.js`
writes nothing at all.

### `/closed` and `/done` — what got finished, as a place

Every surface in this app is about work that is **not** done. The inbox is what needs
answering, the advocate console is what is running this minute, the board is what is
waiting to land, and even the ledger opens on everything the space has ever had. The one
question none of them takes is *what shipped* — and it is a question you ask constantly,
because the close reasons here are the best record of it that exists.

The filters above already answer it. `/history?status=closed` is that screen, exactly, and
it has been since they landed. What it is not is somewhere you can **go**: it is a query
string you have to know the shape of, typed into an address bar, on a phone. So `/closed`
and `/done` are that URL under a name — two words because which one comes to mind depends
on whether you are thinking about beads or about work, and the same bargain every
multi-path page here makes with its aliases.

**It is a redirect, and that is the only interesting thing about it.** Every other short
name in `serveStatic` is a rewrite — `/queue` becomes `endorse.html` and the browser never
finds out — and a rewrite is exactly what does not work here. Those lines change the path
and leave the query string as the browser sent it, so `/closed` rewritten to
`history.html` arrives with no `status=` on it and the page has no way at all to tell it
came in by that door: the whole unfiltered ledger, under a name that promised otherwise.
That is the failure nobody reports, because a plausible list of the wrong beads looks like
data. A **302 to `/#history?status=closed`** is the mechanism instead, and it is better than
a rewrite would have been even if a rewrite had worked: after the hop the address bar says
what is on screen, the chips are drawn from it already pressed, clearing them is a tap, and
what you send somebody is the screen you are looking at. The far end moved with the ledger —
it was `/history?status=closed` until that became
[a hop of its own](#an-address-that-names-a-view-is-a-hop-not-a-document) — and the filter
crossed the `#` with it, because a `status=` left in the search string is a filter for a
view the next tap takes you off.

Everything else on the incoming URL is carried across and only `status` is overruled.
`?t=` in particular — an ntfy action button and a home-screen shortcut both arrive with the
pairing token on them, and a door that dropped it would turn the very next navigation into
a login screen. It is also the one parameter that stays *in front of* the `#`: the filters
are the view's and cross it, the token is the daemon's and a fragment never reaches a
daemon, so `/closed?t=…` lands on `/?t=…#history?status=closed`.
`/closed?priority=P0` is *what P0s landed*, which is the second-most useful address in the
app. `/closed?status=open` is a contradiction, and the name of the door is
the half of it that is not a typo.

The one thing that looks like an oversight and is not: **neither path is in the service
worker's shell**, though every other multi-name page precaches all of its names. They
cannot be. `Cache.put` rejects a redirected response outright, and the shell is installed as
a single all-or-nothing `addAll` — so adding them would leave *nothing* cached on every
phone, for as long as that worker lives, and the symptom would be an app that had merely
got slower. Nothing is lost by it any more either, and that took two goes. `/closed` with no
signal used to fall through to the index page, which was already what `/history?status=closed`
did, because the offline fallback matched on the whole URL and no query string had ever
matched anything in that list; that half closed with `ignoreSearch`. What was left was the
bare `/closed`, and the reason for leaving it was that resolving it meant knowing a redirect
only the daemon holds. That stopped being true when the ledger became a pane: the far end is
a fragment of a document the worker already has, so
[`VIEW_HOPS`](#an-address-that-names-a-view-is-a-hop-not-a-document) holds the answer and
`fallback` gives it.
`test/pagepaths.mjs` asserts the hop and where it lands — including both halves of what the
door does with a query string — beside every other path a phone still has on its home
screen.

### The door from the advocate console — `N closed`

The advocate console's repo row is nine or ten pills of work outstanding — open, ready,
blocked, in progress, and the [nine ways a bead is held back](advocates.md#advocates--an-agent-per-repo-whose-job-is-the-queue-reaching-zero)
— and nothing at all about what had been finished. It now ends with a muted **`N
closed`**, and the two things worth saying about it are that it is free and that it is
last.

**Free.** `bd status` has carried `closed_issues` since long before that row existed, and
`forWorkspace` in `lib/work.js` has always read that summary for `open`, `ready`,
`blocked` and `in progress`. So the count is a field already in hand rather than a fourth
`bd` invocation — which is the whole argument, on a card that repaints every twenty
seconds across every workspace at once. `test/closedpill.mjs` asserts that as *argv*
rather than by reading the code: its `bd` is a stub binary that logs every call, and the
check is that three are made and that they are the same three as before.

**Last.** Every other number on the row is work that is not done, so this one reads as one
of them if it sits beside `open` where the tracker itself puts it. At the end, after the
holds, it is plainly the other kind of number.

It is drawn from that field or not drawn at all: `?? null`, not `?? 0`. A `bd` too old to
report it leaves the pill off, because `0 closed` over a repo with three hundred closed
beads is not a missing number, it is a wrong one — and a workspace whose tracker fell over
takes the error path and gets no count of any kind.

The pill is a link to [the ledger](#the-ledger--the-history-tab), and its tooltip says
what that is: *every bead this space has ever had*, not the closed ones on their own.
That distinction is deliberate rather than an oversight — there is no closed-only list to
send it to yet, the ledger does not filter, and a link that quietly showed you more rows
than the number beside it promised would be the kind of small lie this app spends a lot of
prose avoiding. Narrowing it is its own bead, behind the filters.

No `?ws=` on the href, exactly as the `N held for endorsement` and `N in an open pull
request` pills above it carry none. Scope in this app is
[one picker](asking.md#one-space-at-a-time--the-picker-in-the-top-bar), it lives on the server, and
it is shared: a link that narrowed a page without moving the picker would land you on a
list whose own control disagreed with it, and one that moved the picker would change what
every other client is looking at because you tapped a count.

This pill is the last thing off `worktree-closed-history-qsj6`. That branch built a
closed-only page before [the ledger](#the-ledger--the-history-tab) existed; bc-qsj6 was
closed as a duplicate of bc-nib3 and the branch can never merge, since it writes the two
files the ledger landed as. The count was the one part of it worth copying out (bc-1sj4),
and with it out nothing needs the branch.

### Why Chat is not a tab, and ＋ is not a tab either

Chat went the same way as PRs, in the same afternoon, and for one more reason on top of
the one above: it was two jobs at one address — the conversations you had already started,
and the only way to start another. Neither belonged on this bar.

The **list** is incoming work like everything else the inbox holds — a conversation
you left half-finished is a thing waiting on you in exactly the sense a question is —
so open chat sessions are rows in the inbox now, under their own category in the
[kind pills](inbox.md#one-list-six-kinds--and-the-two-sub-filters), as **Chats** — beside My
Epics, Questions, PRs and All Beads. The row
says which conversation it is and what state it is in without opening it: the repo, a
breathing spark while the agent is composing, "2 proposed · your turn" when there is a
proposal waiting to be read, and when it last moved. Tapping it goes into the session.

**Starting** one is the ＋ in the bottom-right corner of the inbox, above the bar. A
bar drawn identically on every standing page cannot hold a *create*, because whatever it
did would have to mean the same thing on all of them and creating does not; and the button
belongs next to the thumb rather than in the top bar with ⟳, because it is the primary
action of the app. It floats over the list and the list pays for it — the foot of the
page reserves the button's height, the same way it reserves the bar's, so the last card
still clears everything. It is drawn on the kinds that have a create and [not on the two
that do not](inbox.md#-belongs-to-the-view-so-two-of-the-six-do-not-have-one), which is the same
argument one step down: a create cannot mean the same thing on every screen either.
With one repo in the selected space it starts there; with
more it asks which, because offering to start work in a repo the app is not showing
you is the one thing the space picker exists to stop. Either way it lands on
`/console?id=<id>`, which is exactly where the launcher's own ＋ lands.

**`/console` is still a live route with no tab pointing at it** — the last one, now that
`/prs` [is a pane on the advocates page](#the-board-is-a-pane-too). The id and the href are
in stored conversation records and on the phone's home screen, so both of its paths still
serve the page — a bookmark that 404s is a worse outcome than a page with no tab. It keeps
the bar, because that is how you leave it, and nothing on the bar is marked current there:
you are not on one of the four.

### The ✕ came with the row

A conversation moved into the inbox as a row, and for a while it could only be
*opened*. The launcher has had a ✕ on every chat row since chats gained a dismissed
state, so the only way to clear a finished conversation off the inbox was to navigate
to `/console` and do it on the other screen — a list that only ever grows, on the one
page whose whole job is that it empties.

So the inbox's chat cards have the same ✕, and it does the same thing: `POST
/api/console/close`, which is [soft](android.md#a-chat-session-ends-when-the-beads-exist) — the
transcript stays, the id keeps working, saying anything reopens it. Nothing was needed
on the server; `/api/questions` already filters `closedAt` out of `consoles`, so a
dismissed conversation leaves the inbox and turns up in the launcher under
`Dismissed`.

- **One tap, no arm-then-confirm.** The two-tap path this page uses for
  [setting a question aside](answering.md#setting-a-card-aside-is-not-answering-it) is a promise
  about a thing that leaves the screen for longer than a tap can take back. This is, and the launcher's ✕ has never asked either.
- **The card is a wrapper now, not the link.** A `<button>` cannot live inside an
  `<a>`, so the row and the ✕ are siblings inside `.card.chat-card` — the same shape
  `.console-row` has in the launcher, and the reason dismissing can never also open
  the conversation. `data-key` moved to the wrapper with the `.card` class, because
  that pair is what the scroll position anchors to: a chat row without one is a hole
  in the list the poll cannot put you back at.
- **The row goes on the tap**, not at the next 25-second poll. That means suppressing
  it until the server agrees it is gone — `consoles` is adopted whole off every
  payload, and the poll already in flight when you tapped was assembled before the
  write landed, so without the guard the row slides back a second later and leaves
  again twenty seconds after that. Each id stops being suppressed on the first payload
  that no longer carries it, which is also what lets a reopened conversation come back
  as a row.
- **Refused mid-turn puts the row back**, with the server's own sentence under it. A
  conversation with an agent streaming into it cannot be closed under it.
- **The accessible name says which conversation** — the title, and the agent for an
  agent chat, exactly as the launcher's does. Six ✕s all called "Dismiss" are six
  buttons a screen reader cannot tell apart.
- **And it says where the conversation went.** A card that vanishes silently reads as
  data loss; the toast names the launcher and the `Dismissed` toggle it is under.

`test/chatinbox.mjs` (in `npm test`) covers the shape and the endpoint, and drives the
real close against a real server: the row leaves `/api/questions` and is still in
`/api/consoles`, stamped. `scripts/chatdismiss-check.mjs` is the finger — a real tap in
a headless Chrome at phone size, including the tap that must *not* navigate, the poll
that still lists the row, and the mid-turn refusal.

### Dismissed is hidden, not gone

The ✕ on a launcher row is soft and always was: it stamps `closedAt`, the transcript
stays, the id keeps working, and saying anything to that conversation brings it back.
What it did not do was get the row off the screen. Closed ones sorted under the live
ones — the right order, and no help after a fortnight, because every one of them is a
row you have already dealt with and they never stop arriving.

So **the launcher lists the live ones, and a `Dismissed` toggle beside the repo tabs
gives the rest back**, carrying how many are being held under the tab you are on. The
count is the point of it: a filtered list that says nothing about being filtered is
indistinguishable from a repo you have never talked to, which is why the tab counts
also moved to counting the rows they would actually list — a tab reading 3 over an
empty list is the same lie one line higher up. A repo whose conversations have *all*
been dismissed says so in as many words rather than offering the never-used wording.

The revealed rows are marked `dismissed`, dimmed, and still the way back in: tapping
one opens it, saying anything reopens it, and there is deliberately no "reopen" button,
because the conversation is the reopen. The answer lives in `sessionStorage`, which is
the whole design of it — tapping a dismissed row is a navigation and coming back must
not re-hide what you were reading, while opening the app tomorrow has to start on the
live ones again, or the ✕ buys you nothing. It is not the repo tab: nobody else's
screen depends on it and it decides nothing about what your phone rings for, so unlike
the space picker there is no reason for the server to hold it.

### The Mirror is a pane, not a tab

The app's navigation and [the Mirror](#the-mirror--whatever-the-phone-has-open-with-room-to-read-it)
landed in the same window, so for two days `/monitor` carried **two rows of tabs**: the bar
along the bottom, which moved between pages, and an in-page pair (Advocates | Mirror) that
swaps a pane. (That bar is gone — bc-khoe.1 replaced it with the
[pill row](#getting-around--the-pill-row) across the top — and this decision is the reason
the Mirror is not a pill on it either.) Either reading was defensible on the face of it — a standing view of its own, or a
mode of the advocates page — and bc-3xb was the bead about which one it is.

**It is a pane** — ruled in `docs/ux-review.md` §3 and §5, and approved with the rest of
that review on bc-j0zl. Two reasons, and both are about what the Mirror *is* rather than
about how much room the bar has:

- **It is a mode, not a destination.** "Show me what the phone has open instead of what
  this Mac is running" is a lens on the advocates page — the same repos, the same
  sessions, the same questions, seen from the other device. The rule above decides it:
  a tab is a claim that the page is somewhere you live, and nobody lives in a lens.
- **It is the one surface in the app that is meaningless on a phone** — which is the
  device the navigation is tapped from. The Mirror follows *another* device and drops its
  own (`notMe` in `public/mirror.js`, and its chip declares no view at all — `data-view=""`
  in `monitor.html`, so `public/montabs.js` publishes `view: null` while the pane is up and
  a mirror cannot circle back onto the page it is drawn on). A phone that tapped a Mirror
  tab would therefore find nothing to follow and read "Looking for a device…" forever.
  That is not a tab, it is a dead end with an icon.

There was a third reason when this was decided — *the bar is full at five, and
`style.css`'s `:has(.tab-item:nth-child(6))` rule is the stylesheet quietly admitting
it* — and it has **twice since expired**: PRs left the bar in bc-l8jp.6, and then bc-khoe.1
deleted the bar for a row that scrolls sideways and has no fullness to be at. The decision
does not move, and that is exactly the point of writing the other two down: the next person
to notice the room should not have to re-derive why the Mirror is not what goes in it. It
*was* properly re-decided, by bc-khoe.30.6, together with the chip row it lives on, and it
came out the same way a third time — see
[The advocate console is one pane, and its chip row stays](#the-advocate-console-is-one-pane-and-its-chip-row-stays).

### The board is a pane too

The empty slot was tested a second time and the answer came out the same way. bc-l8jp.6
took **PRs** off the bar on the rule at the top of this section; what nobody noticed for a
week is that it left the board with no route in except a link on an inbox card, so on a day
with no pull request in the inbox there was no way to reach it — and **Ship** is on it.
bc-d4d5 put it back as the **third chip on this same row**, between Advocates and Mirror,
on the Mirror's own two reasons: it is a mode of the advocates page (the same space's
repos, seen as work waiting to ship rather than work running), and it is somewhere you
glance and act on rather than somewhere you live. bc-me2b added **Config** on the same
test and bc-khoe.10 took it off again — the only one of the four that ever arrived by
*leaving* the Advocates pane rather than by folding a page into it, and the only one to
fail the test on a second reading: a space's configuration is not a mode of the page that
shows its work, it is [a view of its own](asking.md#space-details--every-setting-a-space-has-on-a-page-of-its-own).
So the row reads **Advocates · PRs · Mirror** again,
and `/prs`, `/pulls` and `/prs.html` are three more paths to `monitor.html` with the second
chip up. (Those three are also the PRs pill's own
`paths` since bc-khoe.1, so
the row across the top marks it current on all of them while the chip row puts the board
up — the duplication is not transitional after all, and
[The advocate console is one pane, and its chip row stays](#the-advocate-console-is-one-pane-and-its-chip-row-stays)
says why.)

What that cost, and what it did not:

- **`public/prs.html` is gone; `public/prs.js` is not.** The board is the same renderer,
  drawing into a `<section id="prs">` on the advocates page instead of a `<main>` of its
  own — so there is still one PR card renderer (`public/prcard.js`) and one status ladder
  (`lib/prstage.js`), which is the thing bc-l8jp.6 bought and this had no business
  spending.
- **The chip row grew a file.** A two-way swap can live in whichever pane owns it, which
  is where it was (`mirror.js`); a three-way one cannot, because the pane going *away* has
  to be told as much as the one arriving and "the other one" stops naming anything. So
  `public/montabs.js` owns the row, the panes subscribe, and each of them answers only
  for itself. The mapping — which section a chip shows, and what `presence.js` should say
  this device is looking at — is declared on the chips in the HTML.
- **A hidden pane is stood down, not merely invisible.** All three hold a parked
  `/api/poll`, and the board's wakes are a `gh` call per repo; the subscription is what
  stops them running at once. Nothing is fetched for the board until its chip is up.
- **The top bar is shared.** One ⟳ for the page, and each pane ignores it while it is
  hidden — rather than a second refresh button that would mean a different half of the same
  screen depending on where your thumb landed.

`node test/montabs.mjs` runs the real chip row in a vm and holds what no single pane can
see: exactly one pane up after every swap, every subscriber told on every change *and* once
at boot, one pane throwing not stranding the two beside it, and the board's three URLs
selecting the board whatever chip was stored. `node test/prstage.mjs` holds the pair of
claims above it: the bar still has no PRs tab, and `monitor.html` still carries the chip,
the shared renderer ahead of the board, and the bar that is the way off it. `node
test/pagepaths.mjs` asks a running server for all three of the old paths and requires the
page they land on to be one that draws a board — `/monitor.js` proves they reach the
advocates page and only `/prs.js` proves the page can draw the Ship button, which is the
failure that started this.

So `public/mirror.js` stays a pane inside `monitor.html`, and what the other answer would
have cost is not spent: no `/mirror` route, no `mirror.html`, and the pane-swap keeps the
one-line `.work[hidden]` rule it runs on. `node test/mirrorpane.mjs` holds it — a static
read asserting the Mirror is not in the bar's tab list, that neither the route nor the page
exists, that the chip and the pane are both still on `monitor.html`, and that the
device-filter the second reason rests on is still there.

`node test/pagepaths.mjs` holds the same two absences from the other side, and the pair is
deliberate rather than duplicated. The static read knows the *shape* the route would take
today — `urlPath === '/mirror'` in `lib/server.js` — and would miss a `/mirror` that arrived
by any other spelling: a redirect, a prefix match, a `mirror.html` served straight off
`public/`. So `pagepaths.mjs` asks a running server for `/mirror` and `/mirror.html` and
requires a 404 from both, which is the claim the decision actually makes — not "the code
does not say `/mirror`" but "there is nothing there". Reversing the decision on purpose
means deleting an assertion in each, which is two lines in a diff somebody can argue with.

**What is still owed is the ambiguity, not the decision.** Two tab bars stacked on one
screen with nothing visual to say that one changes the page and the other changes a pane
is the actual complaint, and the fix is to restyle the in-page pair as the segmented
control it already is (two mutually exclusive modes) — filed as bc-stci. The edit it was
meant to share, scoping this bar's CSS apart from the foundations page's, has landed
ahead of it as bc-4aw: `.mon-tabs` is now this bar's own selector, which is what a
restyle needs to be able to move it without moving the other page.

**The strip is sticky, and for a while that bought nothing.** It has to be — the
advocates list is long enough that halfway down it there is nothing on screen saying
which of the three panes you are in, and no way to the other two without scrolling to
the top first. It was sticky at `top: 0`, inherited wholesale from `.agent-tabs` on the
foundations page, where zero is correct because that strip's scroll container is a
`.launcher` that already *starts* below the top bar. Here the scroll container is the
window, whose top is behind a sticky `.topbar`, so the strip pinned itself out of sight
and the pane swap disappeared on the first scroll (bc-ugd4 — the other half of the same
inheritance was the negative margin that made the page lay out 16px too wide, bc-3ui6).

It sticks at `var(--topbar-h)` now, and that number cannot live in the stylesheet
because it is not one number: the bar is **104px** with the space picker's row and
**61px** without it, and the picker takes itself away below two workspaces — same build,
same page, one payload to the next. `public/montabs.js` publishes it from a
`ResizeObserver` on the bar, which answers that and the three nobody would have thought
to enumerate: `env(safe-area-inset-top)` is zero in a browser and is not zero in the
installed app, and the bar is `flex-wrap: wrap`, so a narrow enough screen can rewrap it
at any moment. What it publishes is the bar's measured height, whatever made it that —
which is the whole reason it is not `spacebar.js` setting the variable as it shows and
hides itself, a fix that would be true for the one cause somebody thought of. The
stylesheet's fallback is the two-row bar, so a page that somehow loses that script is
wrong by 43px in the uncommon case rather than by a whole bar in the common one, and
`scripts/topbar-check.mjs` fails on either.

## Repo views — a screen a repo declares about itself

Every view above is about **beads**: the inbox, the ledger, the advocate console, the
release board. That is the right spine and it is not the whole of what a repo needs in
order to manage itself.

The first repo to need one was a writing studio whose status board — a script reading its beads, its history and its own documents — could only reach a phone as a snapshot, and *what is waiting on you right now* is the one question a snapshot answers worst.

The general shape: **the repo knows something about itself that this app cannot know, and
the phone is where it needs to be read.** So the app stops trying to know and starts
hosting.

### What a repo declares

One file in the checkout, `.beadcause/views.json`:

```json
{
  "views": [
    {
      "id": "board",
      "label": "Board",
      "icon": "🎬",
      "script": "board.js",
      "style": "board.css",
      "data": { "run": ["python3", "scripts/board.py", "--json"], "ttl": 180 }
    }
  ]
}
```

| Field | | |
|---|---|---|
| `id` | required | lowercase, digits and hyphens. Becomes `<workspace>.<id>` everywhere |
| `label`, `icon` | | the pill. Both fall back rather than refusing — a view with no label is a pill that says its id |
| `script` | required | the JS this app loads into the pane, relative to `.beadcause/`. **This is the view** |
| `style` | | a stylesheet beside it. Optional, because the pane already inherits `public/style.css` |
| `data.run` | | an **argv** — never a shell string — run in the checkout root, whose stdout is JSON |
| `data.ttl` | | seconds the payload is held. Default 120 |
| `want` | | `"questions"` if the view needs the inbox off the shared poll. Default is the free park |

That is the whole of the configuration. There is nothing to add to `config.json` and
nothing to restart: a repo gains a view by landing a commit, which is what "pluggable"
has to mean to be worth having.

**The manifest is in the checkout and not in the config**, for the reason `repos` reads a
service token out of a repo rather than restating it — one source of truth, moving with
the commit that changes it. A branch that renames `scripts/board.py` renames it in
the manifest too, in the same diff, and there is no JSON file on one Mac left saying
otherwise. The cost is the same cost: the manifest is a fact about a checkout on disk, so
it can be missing, unparseable, or name a script that is not there. All three are reported
in `problems` on `/api/views` and none is guessed at — a view that cannot be built is a
sentence saying why, never a silent absence, and one bad entry never withholds the good
ones beside it.

### What it gets for free

A repo view is a **view**, not a page in a frame. It joins the same grammar every other
view is in, so it arrives with:

* **an address** — `/v/<workspace>/<id>`, which hops to `#<workspace>.<id>` exactly the
  way `/history` hops to `#history`, so a phone's home screen can hold it, and an address
  for **what the view is showing** rather than only for the view (*A view's own state is
  in the URL*, below);
* **a pane** — its scroll position survives switching away and back, and it is built once
  and never rebuilt (`public/panes.js`);
* **a pill**, at the end of the one row of chrome this app has;
* **the stylesheet** — a `.card` a repo view draws is the card the inbox draws, and it
  follows the phone's light and dark scheme without knowing either exists;
* **the poll** — the document's one long poll, fanned out per pane, rather than a socket
  per view (`public/panestage.js`);
* **bead ids that are tappable.**

That last one is the argument for hosting the view here rather than letting it be a page
somewhere. `ctx.bead.link(id)` builds the exact hash a notification carries, so a board
full of bead ids stops being something you read and then go and act on somewhere else: the
tap opens the real card, with its thread and its answer box, in the app you are already
in. loremia's board draws 139 of them.

### The SDK

The script calls `define` once and is handed a context:

```js
window.beadcause.view.define({
  build(ctx) { ctx.el.innerHTML = draw(ctx.data); },
  wake(ctx, { data, events }) { /* an answered poll */ },
});
```

| On `ctx` | |
|---|---|
| `el`, `pane` | where to draw, and the whole pane if you want the header |
| `data`, `meta` | the last payload, and `{at, age, stale, problem}` about it |
| `onData(fn)`, `refresh()` | a new payload landed; go and get a fresh one |
| `api(path, opts)` | the daemon, with the credential on it — `/api/questions` and everything else |
| `bead.link(id, text)`, `bead.open(id)`, `bead.href(id)` | the workspace is pre-bound |
| `space.filter`, `space.onChange(fn)` | what the picker has selected |
| `esc(s)`, `md(text)` | escape, and sanitised markdown through the app's own two libraries |
| `asset(rel)`, `note(text, kind)` | another declared file; one line above the board |
| `query`, `setQuery(q, {push})`, `onQuery(fn)` | the view's own slice of the address |

`build` is called once, when the first payload has landed **or failed to** — never before.
A view whose `build` had to cope with `data === null` would make every view author write
the same empty state, and the chrome already draws the waiting and the failure.

### A view's own state is in the URL

A repo view could always be linked *to*. It could not be linked to **at** anything.
loremia's Briefs view is the case that made that obvious: which brief is open lived in a
variable, so sharing the brief you were reading shared the index of briefs, and the back
button walked out of the view instead of back through it. The Studio board has the same
shape waiting for it — a gate, a production line, a department.

The slot is the view's own query, the one every other view already had:
`#loremia.briefs?b=chapter-one`, and `/v/loremia/briefs?b=chapter-one` for the form a
phone's home screen holds or a person pastes. The hop between them was already there —
the daemon splits its own `?t=` off the front and everything else goes behind the `#`.

```js
build(ctx) {
  open(ctx.query.get('b'));                 // what the link that arrived named
  ctx.onQuery((q) => open(q.get('b')));     // the address moved: the back button
}
// on a tap into one brief:
ctx.setQuery(`b=${encodeURIComponent(slug)}`, { push: true });
```

Three rules, and each is the shell's to enforce rather than the view's to remember:

* **`query` is only ever yours.** It answers `''` while the hash is naming another pane —
  which is the state of the world for the several hundred milliseconds between
  `/api/views` answering and a generator landing. Without that check a view picks up the
  ledger's filters and opens a brief called `closed`.
* **`onQuery` means somebody else moved you.** Never your own `setQuery`, and never the
  deep link that *built* you — at that moment there was no pane to hold a listener, which
  is why `build` reads `ctx.query` rather than waiting to be told.
* **A pane that is not on screen may not write the address.** `setQuery` refuses, and
  answers `false`. Both built-in views that keep state this way make the same refusal for
  themselves; a repo view's script is in somebody else's checkout, so it is made for it.

`push: true` for a narrowing that is really a *place* — tapping into one brief out of a
list is somewhere the back button should leave. The default is `replaceState`, because a
filter chip is not somewhere you go back to and a panel of them would fill the back stack
with steps between you and the screen you arrived from.

### What a badly-behaved view can and cannot take down

Three containments, one per failure:

* a **script that fails to load** leaves its pill drawn and its pane holding the reason.
  Not removed: a pill that vanishes is indistinguishable from a repo that never had a
  view, and the one thing worth knowing is that it is broken.
* a **`build` that throws** takes its own pane and nothing else, rethrown out of a timer
  so the P0 filer still files it.
* a **generator that fails does not blank the board.** The daemon hands back the last good
  payload with `stale: true` and the reason, and the pane draws that reason above a board
  that is merely old. A board with a timestamp on it is worth a great deal more than an
  empty pane with an error in it.

### The trust position, said out loud

A repo view's script runs on this app's origin with this app's DOM, and `data.run` spawns
a process the repo chose. Neither is sandboxed and neither is going to be. The manifest
lives in a checkout this daemon already runs test suites, deploy scripts and unattended
Claude Code sessions inside — a repo that can make this Mac run its tests can already make
it run anything — so an iframe here would cost the theme, the card-opening and the offline
behaviour to prevent nothing.

What *is* enforced is **reach**, and it is enforced rather than assumed:

* only a workspace this daemon is already configured for, resolved through the same
  `resolveSessionDir` that decides where a session opens;
* only under that checkout's `.beadcause/`, with every path resolved through `realpath`
  and re-checked against the resolved prefix — which is what catches a symlink, where a
  string check cannot;
* only the files the manifest itself named. A view directory may hold a generator, a
  fixture, notes; "inside `.beadcause/`" is a weaker claim than "this view said this was
  one of its files", and the manifest is the allowlist;
* `run` is an argv, so nothing in it is word-split, globbed or substituted;
* a 30-second timeout and an 8MB output cap, because a generator that hangs must not take
  the poll down with it.

`test/repoviews.mjs` drives all of that against a real temporary checkout with a real
symlink in it, because a suite that checked the regex would have passed on the day the
symlink case was written wrong.

### Where the code is

| | |
|---|---|
| `lib/repoviews.js` | discovery, the manifest, path resolution, the generator and its cache |
| `public/viewhost.js` | the host and the SDK — pane, pill, address, script loading |
| `public/hashroute.js` | `route.add()`, which admits a repo view to the grammar at runtime |
| `public/panes.js` | `panes.adopt()`, for a container built after the document was parsed |
| `public/viewbar.js` | `views.add()`, which appends the pill |

A repo view's id is `<workspace>.<id>` and its hash is that id verbatim. The dot is
load-bearing: the hash grammar reads a `/` or a `pr:`/`jira:` prefix as the shape of a
bead card key, so `#loremia/studio` would parse as a bead nobody has and the pill would
switch to the inbox and hunt for it. A bare word with a dot in it is not a card under any
of the three shapes.

## Loaded once, and kept — what a tab tap actually costs

Five standing views, five documents. Tapping a tab is a navigation: the page you were
on is thrown away, the next one is parsed, and *then* its script goes and fetches
everything it needs before it can draw a row. The shell itself has been instant for a
long time — `sw.js` precaches every page — so what you were waiting for on the other
side of that tap was the fetch. On the inbox and the advocate console that fetch is a
`bd` sweep across seven workspaces, about a second, and it was paid on every tap, all
day. On a phone over the tailnet that is the whole difference between an app and a
website.

Two things fix it, and neither of them makes anything faster: they stop the same work
being done twice.

**The payload each view booted from is kept, and painted before the next request has
left.** `public/warm.js` holds one entry per endpoint in `localStorage`, and every
standing page reads it at the top of its own boot: the inbox, the board, the advocate
console, the launcher and the switches all draw the list they had last time in the
first frame and refresh underneath it. Behind that — once the view you actually asked
for is on screen — the *other* views' payloads are fetched in the background, so the
tab you tap next is warm before you tap it, and the two tabs come first in that queue
because they are the only ones a thumb can reach in one tap ([staying
warm](#filled-once-is-not-kept-warm) is what happens to those entries afterwards, and it
is a separate promise from this one). `node scripts/warm-check.mjs` measures
exactly this against a fixture whose sweep takes 900ms: a cold load takes just over a
second, and coming back to the tab draws five cards in **under a tenth of it**, with
the counter proving no request was answered during the paint.

None of it is load-bearing: a browser that refuses the storage, a full quota, a
half-written entry, one written by a build that stored a different shape — every failure
reads as a miss, and a page that cannot warm is a page that is merely as fast as it was
last week.

### And across closing the app, which is where the wait actually was

This was `sessionStorage` for its first two weeks, and the argument was good enough to
survive several changes: a tab switch is a navigation inside one tab, which is precisely
what sessionStorage survives, and letting the cache die with the app kept bead text off
the phone's disk between one evening and the next. What that was quietly buying was a
**reopen that started from nothing** — and a reopen from nothing is a cold
`/api/questions`, which is one `bd human list` per workspace, about fifteen child
processes, of which seven milliseconds is our own code. Measured off the live daemon's
slow log on 2026-08-17, before this changed: 239 over-budget `/api/questions` in under
three hours, **every one of them cold**, p50 8.3s. That is the number a reopen paid, every
single time, for a privacy property Adam looked at on 2026-08-15 and decided against —
bead text on disk between sessions is fine.

So the store is `localStorage`, and the reopen is now the same trick the tab tap already
was: the kept list paints in the first frame, and the sequence it carries turns the
refresh behind it into `/api/poll?since=<that seq>` — a catch-up on the event log rather
than a sweep. Away longer than the log holds, or the daemon restarted since (the bus is
in memory), and `/api/poll` already answers `resync: true` with the whole payload. That
path is untouched. It simply happens behind a list you can already read.

Not IndexedDB and not the service worker's cache, both of which survive a close just as
well: they are **asynchronous**, and the one thing that has to happen here is a
*synchronous* read before the first paint. An `await` in front of `warmBoot()` is a
spinner again, which is the thing being removed.

**And no TTL.** There was a fifteen-minute one, on the grounds that a stale list is more
confusing than a spinner. Adam's second decision the same day removed it, and the file's
own header had already made the argument for maintained entries: an entry the log has not
contradicted is as true as it was when it was fetched, however old, and one it *has*
contradicted is corrected by the catch-up above. Age was never the question. There is no
staleness banner either, and that is deliberate — `public/freshness.js` already draws when
anything last looked, off the stamp `/api/questions` sets, and a very old kept list is
exactly its case rather than a new one.

Two things follow from durability that did not have to be thought about before, and both
are in the code with the reason beside them:

- **The store only ever grows, so it has a bound.** A byte budget of 1.5 MB against a
  ~5 MB origin quota, evicting the oldest entry first — `at` is when an entry was last
  known true and `refresh()` restamps it for free on every wake, so the entry nothing has
  restamped in longest is the entry nothing is maintaining. **The inbox goes last of all,
  whatever its age**, and that rule is not the ordering being polite: from any other page
  the background warm writes the inbox's entry *first*, so it is the oldest thing in the
  store, and plain oldest-first would evict precisely the payload a reopen needs. A
  payload too large to ever fit is refused before the first eviction rather than after the
  last, so one enormous write fails alone instead of emptying the store on its way down.
  The old answer to a full store was `forget()` — throw the lot away — which was
  defensible when every entry was fifteen minutes old at most and is not now.
- **A durable entry outlives the build that wrote it**, which a fifteen-minute one
  essentially never did. Each carries the store's shape version and a mismatch is a miss;
  and `warmBoot()` on the inbox is wrapped, because a payload the current `adopt` does not
  like used to be a throw in the first fifty lines of the page's own IIFE with a blank
  screen behind it. It drops the entry and cold-starts instead.

The other consequence is a rule rather than a mechanism: **every moment a held payload
stops being yours now has to say so out loud**, because "it will be gone by tomorrow"
has stopped being true of anything here. The credential being refused, signing out and
revoking this device already called `warm.forget()`; switching accounts did not, and does
now — several of these payloads are narrowed server-side by which account you are, and the
whole promise of this layer is a *first frame* drawn from what is held.

Claim 7 of `scripts/warm-check.mjs` is the gate, and it is three assertions rather than
one, because a fast reopen on its own would only prove the fixture is fast: the list is up
well inside a sweep, **no** sweep was asked for while it went up, and the poll that
follows carries `since=<the kept seq>`. Under `--baseline` all three fail, which is the
old behaviour printed.

**The inbox follows the event log instead of re-asking on a clock.** `/api/poll` was
already a long-poll that parks until the daemon's sequence moves and only sweeps `bd`
when something actually did; the inbox was not using it for this and re-fetched the
whole list every 25 seconds instead. It parks on it now. An idle inbox costs one held
socket rather than a sweep across seven workspaces every twenty-five seconds, and a
bead that moves lands on the phone in the moment it moved rather than up to 25 seconds
later — faster *and* cheaper, which is unusual enough to be worth saying out loud. The
sweep was never doing anything the log could not say for free.

That needed one change on the daemon: `/api/poll` and `/api/questions` now answer with
the *same* screen. They did not use to — the poll carried the rows and the spaces and
none of the filter, the counts or the notification prompt — and that gap is exactly why
the client's answer to any event was to throw the poll away and sweep again. Both are
built by one `inboxPayload()` in `lib/server.js` so they cannot drift apart quietly,
and `test/warm.mjs` compares the two responses field by field rather than trusting
anyone to read two functions and agree they match. `/api/questions` also carries a
`seq` now — where in the log its list was true — which is what lets a page that booted
from the cache park on the poll rather than sweep to find out where it is.

Three things keep the long poll honest, and all three are fallbacks rather than
cleverness. It runs in the `human` scope only, because the poll's `questions` is the
human channel and the wider scopes are a different sweep the log does not carry. It
runs only with a sequence to start from, so a daemon that predates the field never
starts one. And every failure — a refused poll, a dropped tailnet, a restart — falls
back to the 25-second timer that was there before. The one thing that must never happen
is an inbox that has quietly stopped refreshing.

### The delta stream — every view on the event log

For a while the inbox was the only view on the log, and the other four still refreshed
by throwing their whole payload away on a wall-clock timer: ten seconds on `/admin`,
twenty on `/monitor`, sixty on `/prs`, and never at all on the chat launcher, which
simply went stale until you navigated away and came back. Two of those pulled a `bd`
sweep across every workspace behind them — `/admin` asked for `/api/work` every ten
seconds, all day, to read a single boolean off it — and every one of them was paid
whether or not anything had moved.

`public/stream.js` is that loop, lifted out of `app.js` and mounted by all five. It owns
the socket, the sequence, the abort and the visibility rule; what an event *means* stays
with the view, because only the view knows whether `type: 'merged'` is a lamp, a count or
nothing at all. Five hand-rolled long-polls with five subtly different resync behaviours
was the shape worth not growing into.

**There were six, and the sixth was missed because it is not the only script on its
page.** The [mirror pane](#the-mirror--whatever-the-phone-has-open-with-room-to-read-it)
rides `monitor.html` beside the advocates page it is a mode of, and it follows the log for
a reason of its own — a thumb moving on a phone — on a sequence of its own. A survey by
page finds five; a survey by `/api/poll?since=` finds six. It is a mount now too, and the
argument that had kept it hand-rolled is [in its own
section](#the-mirror--whatever-the-phone-has-open-with-room-to-read-it): the three rules
it looked to invert turned out to be the browser tab rather than the pane, the retry
rather than a fallback, and an optional handler. `test/stream.mjs`'s `VIEWS` list is what
keeps the count honest, and it is keyed on the script rather than the page for exactly
this reason.

**And a seventh, missed for the opposite reason: it has no page on the bar.** The
[endorsement queue](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time) is
reached from the 🗳 in the inbox's top bar or from the advocate console's `N held for
endorsement` pill, so a survey that started from the tab bar — which is what the table
above is — never listed it. It kept a 45-second full refetch for months after the timers
here were deleted, and it was the most expensive of all of them: `/api/unendorsed` lists
every workspace and then reads a bead per row for the provenance line, paid four times a
minute whether or not a single bead had been filed. It is a mount now (bc-bsgn), on the
same terms as the rest: `want=presence`, and a wake it cannot act on because you are
mid-sentence is deferred rather than dropped — the queue catches up the moment the box is
empty, which the old timer never did either way.

The thing that makes four more parked clients free is `want=presence`. The daemon sweeps
`bd` for a poll that asked for the inbox questions, and the other four views draw none of
them — so they ask to be *woken* rather than told, and then go and get their own payload,
which for three of them is an in-memory read. Without it, four parked views would have
meant four sweeps per event: the timer's bill arriving by another route.

What each of them then does with a wake is the interesting part, and it is different in
each case because what is expensive is different in each case:

| View | On a wake |
|---|---|
| **Inbox** | Adopts the questions the poll carries. It is the one view whose park does ask for them, and the payload arrives with the wake. It also keeps every *other* view's payload warm on the same wake, for the pages it is not — see [staying warm](#filled-once-is-not-kept-warm) and [the per-path table](#and-every-other-warmed-path-decided-one-at-a-time). |
| **Advocates** | Takes the advocate roster straight off the poll — `advocates.snapshot()` rides every wake — so a pause, a resume or a check-in repaints with no request at all. It goes back to `bd` only for events `bd` would answer differently, which an advocate saying it is still surveying is not. |
| **Admin** | Reads `observing` off the poll, which is the whole reason it ever touched `/api/work`, and re-asks `/api/admin` — two in-memory reads, no `bd` — when an advocate or a terminal moved. Its numbers are promises about what a press will do, so half-patching them was never an option. |
| **Board** | Re-asks `/api/prs` when a pull request actually moved. The three lamps are the daemon's own reading of GitHub, `origin/main` and the deploy journal; a client that set them from an event would be a second, worse copy of that ladder. The daemon drops its board cache as those events fire, so the first board through does the one `gh` sweep and every other open board shares it. |
| **Chat launcher** | Was the odd one out — no timer to delete, just no refresh — and now re-asks `/api/consoles` when something moved. |
| **Endorsement queue** | Re-asks `/api/unendorsed` when a bead was filed, a verdict landed on another device, an agent amended one it was asked to change, or a discussion moved — `QUEUE_EVENTS` in `public/stream.js`. Nothing is patched from the event: the rows are whole beads and what a filing did to *this* list is knowledge the daemon has and the page does not. A wake that arrives while you are mid-sentence, mid-edit or holding an armed revoke is held back and taken at the next repaint, because the alternative is a queue that is silently wrong for as long as you keep typing. |
| **Mirror** | The one view for which presence *is* news: it reads `presence` off the wake and re-reads the phone's card only when the phone moved to a different one, or when a non-presence event landed on the key it is already showing. |

Two events were added for it, both on the daemon: opening and closing an in-app terminal
now say so, because `/admin` draws a count of open terminals into the label of the button
that closes them and the ten-second timer was the only thing keeping that number true.

**What this deliberately gives up.** GitHub is outside the daemon's log, so a pull
request opened by something other than this app — an agent's `deliver.js`, a push from
another machine — is not an event and does not wake the board; the ⟳, the next
daemon-side event or arriving at the page is what brings it in. And a session claiming a
bead in a terminal nobody told the daemon about is invisible to `/monitor` for the same
reason, where the twenty-second timer used to catch it inside twenty seconds. Both were
being paid for with a sweep a minute on every open page, and in practice a running
advocate emits several events a minute, so the page it matters on is the busy one.

With the app open and nothing moving, the daemon now logs no periodic sweeps at all.

#### The last timer, and the event that deleted it

One wall-clock timer survived that sweep, on the deploy strip, and it is worth saying why
— because the reason was not "the deploy strip is special", it was a gap in the log. (The
strip was at the top of the PR board when this was written and is [a view of its
own](pull-requests.md#releases--the-view-those-queues-are-drawn-on) now; nothing about the clock moved
with it.)

The strip answers *is something being made to run, right this second?* Its own subject genuinely cannot come off an event: the steps inside a deploy
are a file being written on this Mac by a detached runner, and no event carries them, so
while something is live the strip asks `/api/deploys` every four seconds and always
will. That is not the timer that mattered. The one that mattered was the **idle** tick —
every thirty seconds, on every open board, for as long as one was open — and it existed
to answer a question nobody on that page could otherwise ask: *has a deploy started
somewhere else?* The Ship button on another device, an agent's own `POST /api/deploy`,
[the release queue shipping itself](pull-requests.md#deploying-a-repo-when-it-says-how). Deleting it
would have meant a deploy running for up to its whole duration with nothing on a second
screen saying so, which on this repo is a daemon being SIGKILLed under a phone that
thinks it is idle.

The gap was that `bus.emit({type: 'deploy'})` fired only when a deploy **settled**. The
daemon knew perfectly well when one began — every one of the five ways to start a deploy
goes through one function in `lib/server.js` — it simply never said. It says now, and
the idle tick is gone: an idle board holds a socket, asks for nothing, and switches to
its fast clock in the moment something begins shipping.

**It is the same event type for both, and the record's `status` is the difference.**
`queued` on the way in, and a settled word — `ok`, `failed`, `unconfirmed`, `lost` — on
the way out. That was the cheaper half of the choice by a long way: a second type would
have had to be added to `BOARD_EVENTS` in `public/stream.js` and to every other list of
event names that has to stay in step with it, in exchange for a fact already in the
payload. A client that knows which statuses a runner still owns tells "started" from
"settled" without a second request; one that does not goes and asks, which is what every
consumer of this event did before it existed.

**The fallback is the part to not delete later.** A board whose stream is not following
has nothing left to wake it, and a strip that has quietly stopped refreshing looks
exactly like a strip with nothing to say — the one failure the whole move onto the log
must not introduce. So the thirty-second tick is still in the file and is used whenever
`stream.following` is false: a service-worker shell cached before `stream.js` existed, a
proxy that answers `/api/poll` and keeps no log, the gap between a broken poll and its
next retry. `public/stream.js`'s `onSettle` is what tells the strip to put its clock
back, which is exactly what that callback is for.

`node test/deploystart.mjs` holds both halves: the start event out of the real
`/api/poll` at a real socket, that `lib/server.js` starts a deploy in exactly one place
so a sixth call site cannot forget to announce, and — with the real `public/releases.js`
and the real `public/stream.js` in a `vm` against a fake clock — that an idle page sets no
timeout, that a `deploy` event alone turns the fast tick on, and that a page with no
stream behind it keeps the old one.

### Filled once is not kept warm

The background fill above has a limit that took a while to show itself, because it is
invisible for the first quarter of an hour and total after it. It runs **once per
document**, and the warm layer's TTL is **fifteen minutes**. That bargain is right for a
page you pass through — the entry is there when you tap on, and gone by the time it could
have been misleading — and wrong for the one page you *sit* on. The inbox is open all
day. So for the first fifteen minutes Advocates opened instantly, and after that it was
a cold `bd` sweep across every workspace, every single time, with nothing able to put the
entry back: the once-per-document flag never goes false again while the document lives.
Which made the fix look like the bug. The tab was slow *because* it was preloaded, badly.

The entry was not wrong when it was dropped. It was *old* — and the log the inbox is
already parked on knows the difference. So the heaviest tab's payload is now
**maintained** rather than merely stored, in two halves that are separated by exactly one
question: does the delta stream carry it?

- **The advocate roster does, on every wake, whatever woke it.** `advocates.snapshot()`
  and `observing` ride every answer `/api/poll` gives, including the quiet one that timed
  out with nothing to say. So on each wake the inbox folds them into the copy it is
  holding for the advocates page, through `warm.refresh()` — which also restamps the
  entry, and *that* is the half that matters most. A park is at most 25 seconds, so a
  wake is always the freshest thing the store has seen, and a payload nothing has
  invalidated can no longer age out from under a tab you have not tapped. (Written when
  ageing out was literal: a fifteen-minute TTL dropped an unrestamped entry. That TTL is
  [gone](#and-across-closing-the-app-which-is-where-the-wait-actually-was), so the restamp
  now buys the re-ask floor and the store's eviction order instead — the same mechanism,
  answering a smaller question.)
- **Which bead each repo has claimed does not.** That is `bd`, behind no event that
  carries it, so it is re-asked — once, when `stream.workMoved()` says something happened
  that the roster does not already answer, and never otherwise. A `resync` counts, for the
  reason it counts everywhere else: it is the log admitting its own events are not the
  whole story. A `bd` sweep is floored at one a minute, so a burst of events cannot become
  a sweep each.

Read that as a bill: **an idle app still costs nothing**, which is the promise the
section above makes and this must not quietly break, and a *busy* one costs at most one
`/api/work` a minute for a tab nobody has tapped yet. That is the trade, deliberately
taken. Advocates is where you go to see what the advocates are doing while they are doing
it, and a board painted instantly from an hour-old sweep is not "already loaded", it is a
wrong screen that arrives quickly.

`stream.workMoved()` is one function rather than two on purpose. The advocates page asks
it to decide whether to sweep; the inbox asks it about the copy it holds *for* that page.
Two copies of that judgement drifting apart has an ugly failure — an inbox that thought a
claimed bead was a free repaint would hand the tab a warm payload missing exactly the row
you tapped through to look at.

`/api/work` carries a `seq` for this, the same field `/api/questions` has and for the same
reason, and it is read off the log *before* the sweep rather than after it: an event that
lands while `bd` is being asked is one the payload does not contain, and a sequence taken
afterwards would claim it does. Erring early means one refresh too many, which is the
harmless direction.

Claim 5 of `scripts/warm-check.mjs` is the gate, and it is stated in requests rather than
in seconds, because no check could sit out the fifteen-minute TTL this was written
against: the entry is filled without
being asked for, 27 idle seconds leave it with a **newer stamp and no extra request**, an
advocate pausing lands in it for nothing, a bead moving inside the floor does not become a
second sweep, and a claimed bead is re-asked exactly once. Against `--baseline` the middle
three of those fail, with `stamp 0ms newer` — which is the bug, printed.

### And every other warmed path, decided one at a time

The section above closed that hole for `/api/work` and stopped there, deliberately. The
hole itself was never about the advocates tab: once-per-document fill against a
fifteen-minute TTL is a property of `warm.js`, so **every** warmed path had it, and the
ones that were left are those you reach without a tab — `/admin` is a tab, and the board,
the chat launcher and the endorsement queue are each one tap from the inbox: a PR card, a
chat row, the 🗳. Every one of them was cold every time it was reached more than a quarter
of an hour after the inbox loaded, which on the page you leave open all day means almost
always.

What made it one decision per path rather than one rule is that the paths do not cost the
same. So the table is in `MAINTAINED` in `public/app.js`, and it separates two halves that
were previously tangled together:

**The free half is available to all of them, and it is most of the fix.** The inbox is parked
on `/api/poll`. An entry the log has *not* contradicted is exactly as true as it was when
it was fetched, however long ago that was — so `warm.refresh()` puts its clock forward for
no request at all. That alone is the difference between a warm layer that survives fifteen
minutes and one that survives an afternoon, and it is why the fix is not "poll more
often": nothing is being asked for here.

**The paid half — going and re-asking once the log says something did move — is priced per
path.**

- **`/api/admin` and `/api/consoles` are re-asked, floored at one a minute each.** Both
  are in-memory reads on the daemon: no `bd`, no process spawn, which `lib/server.js` says
  of each of them where they are answered. That is cheap enough to be worth spending on a
  screen that is otherwise blank on arrival.
- **Neither of them is *patched* from the wake, even though `/api/admin` looks patchable.**
  Most of what it draws is advocate counts, and the roster rides every wake for free — but
  the other half of the same numbers is open terminals and this device's own record of what
  it paused, and neither of those is on the poll. `public/admin.js` already refuses to
  patch one half for the reason that a button labelled from two different moments is true
  of neither, and the copy held for that page has to follow the same rule or it would come
  to disagree with the page's own fetch. The whole payload, or nothing.
- **`/api/unendorsed` gets the free half and nothing else, for the same reason as the
  board and more of it.** The endorsement queue is a `bd list` per workspace and then a
  `bd show` per row — the most expensive payload in this table — and it is a page that may
  never be opened today. A floored re-ask would put that sweep on a once-a-minute clock on
  behalf of nobody, which is the bill `/endorse` stopped paying when its own 45-second
  timer went. So it is held young for as long as the log says nothing has been filed,
  revoked, amended or asked about, and the moment one of those lands the entry keeps its
  own age and the TTL takes it. That is what makes arriving at the queue instant more than
  fifteen minutes after the inbox document loaded, which on a phone left open all day is
  every arrival — and it is why the entry is worth maintaining rather than merely
  prewarming.
- **`/api/prs` is never re-asked here at all, and that is the decision rather than the
  gap.** It is a `gh` call per repo. A floored re-ask would keep that sweep running once a
  minute, all day, on behalf of a board that may never be opened — which is precisely the
  bill the board page stopped paying when it came off its own timer. What it gets instead
  is the free half: the board stays warm for as long as the log says no pull request has
  moved, and the moment one has, the entry keeps its own age and the TTL takes it, exactly
  as it does today. The inbox does still sweep the board on its own minute — but only when
  the kind filter wants pull requests, which is when it is drawing them itself.

So "did the board move" is now asked by two pages, and it is `stream.boardMoved()`, one
function, for the same reason `stream.workMoved()` is: an inbox that thought a merge was
nothing would go on restamping a board with the wrong lamps on it, and the lamps' entire
claim is that they are true. The list that used to live in `public/prs.js` moved into
`public/stream.js`; the literal left behind in `prs.js` is the older-sibling fallback for a
service worker holding it beside a `stream.js` from before that export existed, and nothing
else.

Claim 6 of `scripts/warm-check.mjs` is the gate, in requests rather than seconds for the
same reason claim 5 is: three stamps move across a 27-second idle window for **no request
at all**, an event that moved one of them stops that entry's restamp instead of papering
over it, and then, outside the floor, `/api/admin` and `/api/consoles` are re-asked exactly
once each while `/api/prs` is not re-asked on any wake in the whole run. To measure that
last one the check sets the inbox's kind filter to `Questions` partway through, because an
inbox drawing PR cards sweeps the board on its own minute and every count would otherwise
be unattributable. Against `--baseline` three of those five lines fail — the two that pass
are the ones asserting a moved entry is left alone, which a baseline that maintains nothing
satisfies by doing nothing at all.

### The other three views reopen too — and what durability quietly cost

The store the inbox proved durable is **one store, for every view**, so the moment it
became `localStorage` the advocate monitor, the chat launcher and the PR board started
reopening from the disk as well. None of them needed a line: each has read its held
payload at the top of its own boot since long before any of this — `warmBoot()` in
`public/monitor.js` and `public/prs.js`, the read at the head of `showLauncher()` in
`public/console.js` — and what those reads had never survived was the app being closed.
Measured against a fixture whose sweep is 900ms, each of the three now paints in **under a
fifth of a second** where its cold load takes just over a second.

What did need a line is the consequence nobody had gone back for. The **background warm**
runs once per *document*, so it runs again on every reopen, and it was written when a
reopen found an empty store: fetching every path was then the only way any tab was
ever warm. With the store durable that fetch is a second copy of payloads already on
the disk — and two of them are the app's most expensive requests, `/api/prs` at a `gh`
call per repo and `/api/unendorsed` at a `bd list` per workspace with a `bd show` per row.
Measured on the live daemon (bc-1kwl.1) that is 74s and 48s: **two minutes of the Mac's
day, in the background of every single app open, for nothing on any screen.** So those two
paths are marked `holdOnly` in `VIEWS`, and the background warm fills one only when
nothing is held for it — never to replace one that is.

`/api/queues` — [the Releases view](pull-requests.md#releases--the-view-those-queues-are-drawn-on) — is
the third, and it is there for the *first* of those two bills rather than a bill of its
own. It sweeps for nothing itself; it rides the same 25-second board `/api/prs` shares. So
on a reopen that has just skipped a held `/api/prs`, it is the request that would go and
pay for the `gh`-per-repo call instead — the same two minutes, moved rather than avoided.
It is the one `holdOnly` path with no counterpart in the maintenance table below, because
the inbox holds no queue at all: it draws none, and nothing on the delta stream would let
it maintain one.

That is otherwise the same answer [the maintenance table already
gives](#and-every-other-warmed-path-decided-one-at-a-time) for the same two paths, and the
point is that it now has to be given twice: two warmers, one decision. What corrects a
held board or a held queue is unchanged and is what always corrected it — the page that
boots from one sweeps it on arrival, behind the frame it painted from the disk. A path
with nothing held is still fetched, so the first run on a new device, and the run after
the byte budget gave an entry up, are exactly as they were.

`node scripts/reopen-check.mjs` is the gate: three reopens, each against its own cold
load, with every request counted and attributed to the view that made it. Two of the
sweeps it counts are legitimate and always were — the board's own arrival, and the
monitor's **Ship** strip, which draws a number a press acts on and may not be answered
from a held payload — so the counts are per view rather than summed, or a total would hide
which one moved. Under `--baseline` three of its seven claims fail, and their numbers are
the old behaviour printed: three reopens, four expensive sweeps, nothing on any screen
that was not already on the disk.

### A repaint that leaves alone what did not change

The other half is inside one document. The inbox rebuilt its whole list with
`innerHTML` on every refresh — forty cards discarded and re-parsed because one bead
gained a comment, and with them every rendered mermaid diagram, the open ⋮ menu, the
caret in a half-typed answer and the scroll position, all of which then had to be
measured and put back by hand ([keeping your place](answering.md#keeping-your-place-in-a-long-brief)
is that machinery, and it is not going anywhere — it is what covers the cards that
*do* change).

`render()` now hands the list to `warm.paint` as keyed chunks — one per bead, plus
`@shade`, `@requests` and `@empty` for the panes that are not beads, with the `@` being
what keeps those out of a namespace where every other key is `workspace/id`. Chunks
whose HTML is identical to what is already on screen are not touched at all: not
re-parsed, not re-inserted, not re-rendered. A bead answered, a comment landed, an
advocate moved — one card is rebuilt and the rest of the list is the same DOM it was a
second ago, diagrams and caret and all. `scripts/warm-check.mjs` proves it the only way
that cannot agree with a bug in the thing it is checking: it stamps every card node
with an attribute the app knows nothing about, changes one bead, and reads back which
stamps survived. Four of five, every time; a rebuilt list loses all of them.

The decision half is `warm.plan()`, which is pure and lives in `test/warm.mjs` —
insert, replace, keep and remove over two keyed lists, including the reorder that must
be free (an answered card sinking to the bottom moves a node, it does not rebuild one)
and the one case that must give up rather than guess: a repeated key, where two chunks
claim one identity and the honest answer is the whole-list rebuild this used to do
anyway. That fallback is live in three other places too — a page loaded without
`warm.js` at all, a chunk that is not a single element, and a browser with no
`localStorage`. In every one of them the inbox is exactly the inbox it was before
this section existed.

### The shell's cache version — one note per bump rather than one line

None of the above is what makes the shell instant; `public/sw.js` is, and it precaches
every page in the app. The price of a precache is that a phone can end up holding a
*mixture*: an `app.js` from Tuesday beside a `style.css` from Thursday, both cached,
both perfectly valid, and together a screen with a button on it that nothing lays out
or nothing answers. `const CACHE = 'beadcause-vNN'` is the one guard against that.
Moving it makes `install` re-fetch the whole shell as a single all-or-nothing `addAll`
and `activate` delete every cache that is not the new one, so the phone gets one
generation of files or the coherent old one — never a mixture.

**A change owes a bump when it leaves a mixed pair that is broken rather than merely
older** — a new script calling a function its cached sibling does not have, a page whose
script is not in the cache, or a stylesheet that lays out a control the cached page draws
anyway. That judgement, and the suite that makes it on every branch, are [the cache
version a branch forgot to move](landing.md#the-cache-version-a-branch-forgot-to-move); what is
below is the other half — where the *record* of a bump lives once you have decided to
make one.

**Each version's argument is its own file in `docs/sw-cache/`,** because that argument
is the only durable record of which two files must not be mixed — a version number on
its own is unauditable a month later. Those notes lived as comment blocks above the
`const` until bc-5ghk, and the top of `sw.js` was, by some distance, this repo's most
conflict-prone region: around eight worker sessions run against it at once, every
branch that bumped appended prose to the same lines, and two changes with nothing to do
with each other came back from GitHub as `CONFLICTING` for no reason but where the
paragraphs sat. That is the same failure `scripts/test.mjs` was written to remove from
the suite list, and it has the same fix — bumping means *adding a file*, and two
branches adding different files do not conflict.

**The name is exactly `vNN.md`, with no slug, and that is load-bearing.** Two branches
that both pick `v39` then collide on one path, which git has to report as an add/add
conflict. Being told is the whole point, because the `const` will not tell you: two
branches that write it the *same* value merge clean and in silence, which lands two
changes under one cache key and a cache that never invalidates again. A descriptive
name (`v39-chat-tabs.md`) would let both of them through quietly.

**When it does conflict:** keep both notes, `git mv` yours to the next free number — and
move the version pairs named inside its own prose up with it, since that prose is the
record of what must not be mixed — then set the `const` by hand to the highest number in
the directory and re-read the line, because git may already have merged it. `node
test/swcache.mjs` is the gate: it fails if the `const` is not the highest note in the
directory, if a note's own heading disagrees with its filename, if the numbers have a
gap or a duplicate, or if a version block reappears as prose inside `sw.js`.

## Editing the app from inside the app

A change to this webapp has always started the same way: describing a screen, in words,
to a chat that cannot see it — from the phone the screen is on. The screen is right
there and is the best description of itself. **Edit mode** (bc-p49x) is the state that
lets it be used that way: turn it on, and the inbox stops being a list you answer and
becomes a surface you point at. Turning it on is `beadcause.editMode.toggle()` and nothing
else — the ✏️ that used to do it is [parked](#where-the-button-was-and-why-it-is-parked)
(bc-p49x.12).

It is built end to end. The screen holds still and every element on it traces back to the
line of source that drew it (bc-p49x.1, widened to every writer of the screen rather than
just the poll in bc-p49x.5); three gestures say what should change and land in
a reviewable list (bc-p49x.2); Save files that list as beads (bc-p49x.3); and a worker
opened on one of those beads is told what it is looking at and stops at the pull request
(bc-p49x.4). That last part is ordinary work in every respect except two: the bead it
starts from was typed with a thumb, and it is the one kind of bead in beadcause a worker
may not merge.

### The screen holds still, and says so

`render()` rebuilds the list and the reconciler under it replaces every chunk whose HTML
has changed. Both are right for a list that polls every twenty-five seconds, and both are
ruinous for a mode whose whole premise is that you are pointing at a specific element:
the thing you tapped is gone by the time the tap is handled. It is the root cause of
bc-nh19 again, arriving from the other direction.

So while edit mode is on, **the poll keeps running and the paint stops.** That
distinction is the design. Stopping the poll would leave the page holding a payload from
before the edit began and needing a cold sweep to recover; a frozen paint has the fresh
state in hand the whole time and owes exactly one repaint at the end, which is what
leaving the mode takes. `app.js` asks `beadcause.editMode.frozen()` at its two paint
entry points — `render()` and `paintList()` — and defers through the `pendingRender`
machinery it already had for a half-typed answer.

Deliberately *every* repaint, including the forced ones a filter tap makes. A forced
repaint under your thumb is the case this exists to prevent, not an exception to it. The
second gate matters for a case the first misses: `load()` paints the *can't reach the
server* panel straight through `paintList`, so a link dropping mid-gesture would
otherwise replace the list you were pointing at with an error message.

A frozen inbox and a quiet one are the same picture, so the mode says which: a fixed
banner across the top — **Edit mode — the screen is frozen** — with a **Done** beside it,
and a tint on the page. Without that, a screen that had silently stopped
updating reads as an app that has hung, and the reflex is to reload it, which is the one
action that both fixes it and throws away whatever was being pointed at.

### And the three writers that are not the poll

Gating `render()` and `paintList()` is the whole of the poll, and the poll is the only
thing on this screen that runs on its own every twenty-five seconds. It is not the only
thing that writes to it. Three paths in `public/app.js` write to the DOM on clocks of
their own and never through `render()`. Two of them need a deliberate tap in the seconds
*just before* the mode is entered — which is exactly the sequence somebody reaching for
edit mode is in the middle of — and the third needs nothing but a poll. bc-p49x.5 is where
each was decided.

**The six arm timers.** Merge, ship, dismiss, a proposal's two bulk buttons, a JIRA
cancel, and `armFirst` on the full pull request card each set a six-second `setTimeout`
that disarms and then repaints in place — through `render`, `paintPrCard`, `paintPr`,
`paintPicks` or `paintArmed`. Arm one, enter the mode, and six seconds later the card
under your thumb is rewritten; in `paintPrCard`'s case it ends in `el.replaceWith(fresh)`,
so the element the anchor named stops existing at all.

**The gate is on the four painters, not on the timers, and that is the whole reason
arming still means what it meant.** The timeout fires on time and `disarm()` runs on
time — only the pixels are late. A hot button therefore cannot be finished by a knee an
hour later, which is the entire point of the six seconds, even though it still *reads*
armed. It cannot be finished at all, in fact: in this mode `editmode.js` swallows every
tap that is not a gesture, so the stale *Tap again* is a word on a frozen photograph and
not a control. What comes back after **Done** is unarmed, which is the truth.

**The log tail.** `pollLogs` writes an agent's output straight into the open `<pre>` on
its own two-second clock, deliberately never through `render()` — a repaint would scroll
the pane back to the top every two seconds. Only the *write* is held: the fetch keeps
running and `state.logText` keeps moving, so the pane is one repaint behind rather than
stopped, and the card the exit rebuilds draws whatever the log has reached by then. A
pane that has stopped tailing does look like an agent that has stopped working — which is
why this mode has a banner across the top saying the screen is frozen, and why the
arrears are taken in full one tap later. The gate is `continue`, not `return`: one held
pane must not stop the others being read.

**The space picker.** `publishSpaces` runs inside `adopt()` on every poll and hands
`public/spacebar.js` a fresh payload; its `paint()` rebuilds the `<select>`'s options
whenever the configured repos move. That gate lives in `spacebar.js` rather than in
`app.js`, because the bar is on six pages and only that file knows when it is redrawing —
the five without edit mode get `undefined` from the optional chain and paint exactly as
they always did. So does its catch-up: a one-shot `editMode.onChange`, registered from
*inside* the freeze because this file runs ahead of every page script and cannot assume
edit mode has loaded yet, while a `frozen()` that has just answered true proves it has.

That listener is bc-ka5y.1's, and it replaced something that used to be free. The
catch-up was structural while the last statement of `render()` was `publishCounts()` —
a `space.adopt()`, which ends in `paint()` — so the one repaint that thawed the list
repainted the bar above it in the same tick. Deleting the picker's counts deleted that
call, and nothing else on the inbox reaches `spacebar.js` on a repaint, so the bar would
have come out of the mode still holding the options it went in with.

**Only the rows wait, not the whole paint (bc-ka5y.33).** The `<select>`'s options are
the one thing a rebuild can move out from under a thumb, so those are what the freeze
above covers. The bar's shown label, the control's `title` and the control's own `value`
name nothing that is not already true — `state.filter` was updated by `adopt()`, or by
the pick itself, before `paint()` ever runs — so all three are still written on every
paint, frozen or not. Without that split, a pick made *during* the freeze fell through
the same cracks the poll did: the browser moves a `<select>`'s value on the tap itself,
no code involved, so the dropdown already held the new space while `paint()`'s early
return left the bar's label and title naming the one the tap replaced, under a banner
promising the screen was held still. It stayed that way, exactly as long as the mode
did, because nothing but the next `paint()` — held by the same guard — could have said
otherwise.

**What is still allowed to move, and why none of it is a thing you can point at:** the
toast (an overlay over nothing, raised only by an act already in flight when the mode
began), the scroll-position pip, and the `.editbar` the mode draws itself. And one thing
that is not a repaint and so cannot be fixed by any gate in `app.js`: `public/update.js`
reloads the whole page when a deploy lands, which takes an unsaved pass with it, because
its `busy()` counts a caret in a box and an open dialog but does not know this mode
exists. That is bc-p49x.10.

Why this was not simply six more `isFrozen()` calls when bc-p49x.1 went in: five of the
six gates are one line and the sixth is in a different file, but each of them changes what
a control *means* under the mode, and getting the split wrong in the easy
direction — holding the timer instead of its paint, holding the log read instead of its
write — leaves a screen that needs a refetch to recover and an armed button that is still
hot an hour later. The distinction the whole freeze rests on is the same one every time:
**state keeps moving, pixels do not.**

### An element, and the line of source that drew it

`beadcause.editMode.anchorFor(el)` turns an element into a record that outlives the
document: the selector chain down to it, its class names, its visible text, the chunk key
of the card it belongs to — and where in this app's own source it is written.

That last part is possible because **the class names here are hand-written in the
template literals that emit them.** There is no build step, no CSS module and no
generated identifier, so `class="p0-title"` in `public/app.js` is the same eleven
characters that reach the DOM. The anchor walks a ladder of grep keys, most specific
first — an `id`, then a `data-act` or `data-role`, then the class attribute as written,
then the rarest single class, then the visible text — and takes the first that names
exactly one line. The search runs against the page's own scripts, fetched from the server
that served them, which is the more honest of the two possible searches: what it reads is
the source that drew the screen you are looking at, not a working tree that may have
moved on.

Two things make it more than a substring search.

**Comments come off first**, character for character, so line numbers still land. This is
not tidiness — it was a real wrong answer, found by the mechanism in itself. Every file in
this repo argues in prose that names the identifiers around it, and the paragraph at the
top of `public/editmode.js` quotes `class="p0-title"` while explaining why class names
make good grep keys. So the first version reported *two* sites for a P0 card's title: the
line that draws it, and the sentence saying that line exists. Two sites reads as
"ambiguous, refuse the edit", which is the wrong answer reached by counting an English
sentence as a place markup is emitted.

**The chain narrows what the element cannot.** `<p class="q">` is written three times in
`public/app.js` — the card's head, the card's foot and the agent card — and the element
alone cannot say which. The `.card-head` around it can rule the foot's out: a candidate
survives if the nearest ancestor that resolves to anything has one of its own hits in the
same file, above it, close enough to be the block it opened.

Where that still leaves more than one, the anchor says so and lists every candidate. An
anchor that always produced a single answer would be an anchor nobody could trust, so
there are three honest outcomes and no fourth: **one site**, **several, all named**, or
**none**.

### Retyping a bead title is editing the tracker, not the app

Half the text on this screen lives in a template literal in `public/*.js` and half of it
came out of `bd`. Retyping the first is an edit to the app. Retyping the second is an
edit to the tracker made while believing you are editing the app — and if it were filed,
an agent would go looking for a string in `public/app.js` that was never there, and might
find something near enough to change. So the anchor records which, in `text.from`:

- **data** — the trimmed text is exactly a string the page was drawing out of the payload.
  `app.js` supplies that set through `provideText`, walked generically off `state` rather
  than field by field, because a hand-kept copy of the payload's shape would go stale
  silently and in the dangerous direction.
- **source** — not that, and found verbatim in the page's own scripts or markup.
- **unknown** — neither: an interpolated string, a number, a run of text assembled from
  parts. Honest, and not editable.

**Data beats source when a string is both** — a bead titled "Refresh" is not the ⟳ button
— because that is the direction where being wrong is survivable. Calling a source string
data refuses an edit you can still make in a chat, the way you always did. Calling a
tracker string source files a rename against a file it was never in.

The set is snapshotted on the way in rather than read live, and for the same reason the
paint is frozen: the poll keeps running, so `state` moves on while the pixels do not. Five
minutes into a session a live read describes a payload three sweeps newer than the screen,
the title you are pointing at is not in it, and a bead title comes back `unknown` — not
refused, and one step from being filed. The screen and the set of strings it is drawing
are frozen together and thaw together.

### Where the button was, and why it is parked

✏️ sat at the bottom left of the inbox, mirroring ＋ across the foot of the screen: the
other thumb, the same height, and the same z-index bargain — over the list, under an open
card. It was not a fifth icon in the top bar because that bar was full at four, which was
measured rather than assumed: `scripts/topbar-check.mjs` put a fifth `.icon-btn` at 216px
of `.sheet-actions` against a 133px brand, wrapping `.topbar` to three rows at both 360
and 393 (bc-qsj6.1). That bar has room now — bc-khoe.5 emptied it into the mark's menu —
and the control still could not have gone in it, for a reason that outlives the
arithmetic: **edit mode freezes the screen**, and inside it a tap points at an element
rather than acting on it. Nothing behind a tap-to-open menu can be reached from in there,
so the way *into* the mode would have worked and the way *out* of it would not.

**bc-p49x.12 took it off the screen.** Not because any of that was wrong, but because of
what the arithmetic leaves out: a fixed 44px circle over the list, on the one screen this
app is mostly looked at, all day, for a mode most sessions never touch. A control earns
its corner by being reached; this one was not.

**Parked, not removed, and the distinction is the whole shape of the change.**
`public/editmode.js` carries no code change at all — two comments, and nothing else — and
the inbox still loads it. `wireButton` already returned early on a page with no button — the button was always the *page's*, because
where it goes is a question about that page's layout and not about the mode — so a missing
element is a path the module was written for rather than one it now tolerates. The mode is
entered, left and read through `window.beadcause.editMode`, which is what the console and
both browser checks drive it by, and `.editmode` with its badge is still in the stylesheet.
Bringing it back is one element in `public/index.html` and nothing else, and
`public/index.html` says so at the spot it used to occupy.

Two things are genuinely lost, and both were accepted rather than overlooked:

- **There is no gesture into edit mode from a phone.** A phone has a console only in the
  sense that a laptop is nearby, so in practice the mode is now reached from a laptop or
  not at all. Nothing replaces the button — a hidden long-press or a shake would be a new
  entry gesture to design, test and explain, which is a different bead from taking one
  away.
- **The unsaved-change count has nowhere to land once the mode has ended.** That badge was
  the difference between "nothing was applied yet" and "it lost my edits"; see the
  paragraph on the pass below for what is left of the guarantee. `paintCount` writes it
  only `if (btn)`, so with the button gone it simply writes nothing and the badge CSS is
  unused — no exception, and no new home for the count in this pass.

A page served without `editmode.js` at all still answers `frozen()` false and behaves
exactly as the inbox always did; that has not changed either.

### One press, and three ways to say what should change

A phone has one gesture surface and this mode needs three meanings out of it, so they are
told apart by **time** and then by **movement** — the idiom a phone already uses to pick
something up.

- **Tap — retype.** The text opens for editing in place, and what is recorded is the old
  string and the new one. The one literal edit in the whole epic, and the one that needs
  no prose. Refused, with the reason said in the banner, when the anchor calls the text
  tracker data, when it is written in more than one place in source, or when you tapped
  the box around the words rather than the words.
- **Hold — describe.** The element is picked up, and letting go without moving it asks
  for a sentence about what it should do instead. No gesture beyond saying *which*, and
  expected to be the most used of the three.
- **Hold, then drag — point.** Where you let go names another element, and what gets
  recorded is the **relationship** to it: above the title, inside this card, out of this
  row. Then the same note box, because the drag says where and only the words say what.

Pixels are deliberately never recorded. Nothing downstream could act on one — this app's
layout is a stylesheet and a template, and "56 pixels left" is not a change anybody can
make to either, where "out of the head and under the buttons" is. A drop that lands on
nothing anchored says exactly that rather than guessing.

**The hold is what keeps the list scrollable.** A drag straight from a press is the naive
implementation and it is unusable here: a thumb moving down this screen is a scroll every
other second of the day, so a mode that claimed it would make the inbox unreachable below
the fold with nothing on screen saying why. Nothing is intercepted until the hold has
fired, and by then the browser has already decided that this finger is not scrolling.
Movement before the hold releases the gesture entirely rather than fighting the scroller
for it. `scripts/editgesture-check.mjs` performs a real swipe and requires the page to
have moved.

**Nothing a gesture does may look like it saved.** A dropped element snaps back before the
note box has even opened, the box says so in as many words, retyped text is marked as
unsaved and reverts the moment the mode ends, and the change list's foot says outright
that nothing in it has changed the app. The failure being designed against is not a lost
edit: it is a person who believes the drag moved something, reopens the app, finds it
where it was, and concludes that saving is broken.

### The pass is a change list, and it is reviewable before it is anything else

All three gestures land in one list held for the pass, in the order they were made,
because the second edit is very often a qualification of the first. The banner carries a
running count that is also the way into it, each entry says what it was and what you said
about it, and any one of them can be dropped with a thumb before Save. **A point with no
note is dropped for you** — it is a finger that slipped rather than an edit, and a tracker
full of "something about this card" is worse than an empty one, so `Add` stays refused
while the box is empty.

The list outlives leaving the mode; the visuals do not. Leaving and coming straight back
is not a decision to throw a pass away, and the record of what you asked for is the only
thing here that cannot be reconstructed from the screen afterwards. What empties it is
Save.

**The ✏️ used to carry the count once the banner had gone**, and while the button is
parked (bc-p49x.12) nothing does. Leaving the mode puts the whole screen back the way the
app has it — which is the truth, and is also exactly what a save that failed would look
like. A badge on the way back in, and the same number in the button's label, was the
difference between "nothing was applied yet, and here is what you said" and "it lost my
edits". With no way back in on the screen there is nowhere to put either, so the pass is
now only readable from `beadcause.editMode.changes()` — which is where whoever entered the
mode already is. `paintCount` still writes the badge the moment a button exists, so the
guarantee comes back with the element rather than needing to be rebuilt.

`beadcause.editMode` exposes the pass as `changes()` — JSON, holding the anchor, the kind,
the note or the two strings, and for a point the element it landed against — plus
`dropChange(id)`, `clearChanges()`, `onChanges(fn)` and `save()`. **No gesture writes to
the tracker.** There is exactly one write in `public/editmode.js`, it is Save's, and a
suite asserts that the file holds exactly one API path and one `POST`: filing half a pass,
with no review and no way back, is the failure that would be hardest to undo.

### Save files the pass

Save is at the foot of the change list, which is deliberate — it is the only way to it,
so you cannot file a pass you have not looked at. It posts the whole list to
`POST /api/edits` once, and what comes back is three levels of bead:

- a **standing P0 root**, which is never closed and is not created per pass — a bead with
  no P0 ancestor is not workable at all (bc-rfnr.7), so the pass needs a container that
  already exists at the moment it is filed;
- one **P1 session bead** under it per pass, holding what was said, in order;
- one **P2 child** under that per individual change, each dispatchable on its own.

So six things nudged in one sitting is one P1 with six children, not six P0s. Both halves
of that matter and they fail opposite ways: six loose beads is six windows opened on what
was one thought, each missing the other five, and one bead with six paragraphs is one
window that has to do six unrelated things before it can be closed. The session bead is
what keeps the pass together *and* keeps each edit dispatchable.

**The session bead is an epic, and says in its own description that it is not the work.**
A *task* with children is ordinary worker dispatch, and a worker's one sanctioned ending
closes the bead it was opened on — which here would close the pass and orphan every edit
under it. An epic with ready children is a batch head instead and gets a planner. The
type is most of the protection and the sentence is the rest, because an epic with a
single ready child falls under `minBatchBeads` and is dispatched like anything else.

**A child has to be workable cold**, by an agent with no screen, hours later. So it
carries the whole anchor — the selector chain, the class names, the visible text, whether
that text was source or tracker data, and the file and line the search found — as prose
for a person and as a JSON block for a grep, plus the note or the old and new string, plus
**where in the app you were standing**: the surface, what was showing, the space and the
kind filters. That last one is not decoration. The inbox is four filters deep and the
element only exists under some of them, so "the P0 title is too quiet" is a different bead
depending on what was on screen, and an agent that opens the app to look will see whatever
narrowing it happens to load with. It is stamped per edit rather than per pass, because a
pass can cross two filters.

**Filed endorsed.** `lib/filing.js` holds an *agent's* proposal behind a tap because an
agent decided it was work; these are your own words, typed in by hand, and holding them
for your approval would be asking you to approve yourself. The one stamp that does go on
is `in-app-edit`, for the reason `agent-filed` exists: one `bd list --label in-app-edit`
finds every bead that arrived this way, which is the only way to audit the route later.

**The workspace is this checkout's own, not the one on screen.** An edit typed into this
screen is a change to *this app*, whichever tracker's beads happen to be drawn on it, so
it goes to the workspace whose sessions open in this checkout — the same answer
`lib/crash.js` takes for the daemon's own crashes, and for the same reason: filing a
remark about `public/app.js` onto `workspaces[0]` would put it on somebody else's board.

**The root is found by a marker, never by its title.** In order: the id in `edits.root` if
the config names one and it is still open, then a live epic carrying the `edit-root`
label, then one created on the spot and marked. Matching on a title is how two containers
for one job appear the day somebody renames one, and this would do it silently on every
Save.

**A failure keeps the pass, and this is the part worth being careful about.** The change
list is the only copy of what was said — the page it describes is gone with the tab, and
none of it is written anywhere else. So an entry leaves the list only against an id the
daemon has confirmed, and a `502` carries `filed[]` for exactly that: a half-filed pass
drops the two beads that exist and keeps the third to be saved again. Filing something
twice costs a duplicate bead you close in a second; losing it costs the thought. The same
rule makes a double-tapped Save file nothing twice — a second press while one is in flight
is refused, because two passes is a whole second session bead with the same edits under it.

### The worker at the far end, and the one thing it may not do

A bead filed this way is ordinary ready work: the advocate queues it, a window opens on
it, and the session gets the brief every worker gets. That brief is right about almost
everything and wrong about three things, so an in-app edit gets a section of its own
(`lib/editwork.js`), built from the record in its own description.

**The anchor is turned into a source site, in the brief, before anything reads the bead.**
The JSON block at the bottom of one of these beads is the most valuable thing on it and it
is the part an agent skims past, because it sits under a heading that looks like
provenance. So the brief lifts it out and prints it as two searches, which answer two
different questions: `text.sites` is where the *string on the screen* is written, and it
is the only thing a retype may touch, while `source.sites` is where the *element* is
drawn — found by class name, narrowed by the chain — and is where a described edit has to
be built. They are usually the same line. When they are not, it is because the element is
drawing tracker data, which is exactly the case where confusing them means editing the
tracker instead of the app. The served URL is translated to a path (`/app.js` →
`public/app.js`) for assets and left alone for pages, because `/`, `/monitor`,
`/advocates`, `/login` and `/admin` are aliases in `serveStatic` and a second copy of that
table here would be wrong the day a page is added.

**A retype and a pointed edit get different paragraphs, and that is the whole epic.** A
retype is a hand-written string in this app's own source replaced by another one; it
should come out very nearly character-exact, and an agent that improves the wording on the
way past has done something nobody asked for. Everything else is intent, implemented in
the layout system that already exists — no geometry was ever captured, `public/editmode.js`
records the relationship a drop landed in and throws the pixels away, and "56 pixels left"
is not something anybody can ask a stylesheet for. An agent handed a drag and no rule
reaches for absolute positioning, which is the one outcome the epic says outright it does
not want.

**An anchor that resolves to nothing comes back as a question.** `found: 0` and `found: 3`
are both honest reports — the element could not be traced, or the chain narrowed as far as
it could and there are still three candidates — and both are named in the brief with
`beadcause-ask --blocks <bead>` beside them. A session with no sanctioned way to stop
guesses, unattended, at three in the morning, in a repo nobody is reading.

**And it stops at the pull request.** Every other worker here hands its work to the merge
queue, which merges it through GitHub, and that is right for a bead somebody decided was
work. An in-app edit had none of
that review: it is a sentence said to a screen, and the whole of the review is you looking
at what came back — so the tap is **Merge** on its delivery card. The brief asks for
`--review` and the card says which of the four reasons it is, but neither is the
guarantee: `bin/deliver.js` refuses to auto-merge a bead carrying `in-app-edit` whether it
was asked to or not. A brief is a promise about what a command will do, and a promise a
session can forget to keep is not one — the flag going missing, or a later brief quietly
dropping the sentence, must not be able to land an unreviewed in-app edit. The hold covers
the pass and the standing root too, which carry the same label and are not things to
deliver against at all. They get a shorter section of their own for the same reason — a
planner or a batch head does open on a pass — saying what the beads under it are and that
none of them is that window's to merge.

That is the whole of it, because the merge queue is the only
[door into `main`](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue) that nobody
taps: the delivery card, the PR board's **Queue to merge** — which since bc-02ldo hands
its pull request to that same queue rather than merging beside it — and a merge made on
github.com are all already you. An in-app edit never reaches the queue at all — `bin/deliver.js` files the
card instead, whatever the space says. The pull request says why it is sitting there, and so does the bead's
thread — a green pull request open for two days with nothing on it to explain itself is
the state this whole fallback exists not to be mysterious about.

### Checking it

`node test/editmode.mjs` is in `npm test` and covers the mode, the anchor and the
source-versus-tracker rule against the real `public/app.js` — including that a P0 title
really does resolve to one line, which is a claim about this repo rather than a law.

`node test/editchanges.mjs`, also in `npm test`, is everything downstream of an anchor:
the three gestures against a hand-made document with a clock the test moves by hand, the
refusals, and the change list. It runs the real `public/editmode.js` in a vm the way its
sibling does.

`node test/editsave.mjs` is the far end: `lib/edits.js` turning a change list into that
three-level shape, against a `bd` that is a stub binary over a directory of JSON files.
Most of it is about the ways a Save goes wrong quietly — a root recreated instead of
found, a root named in the config that has since been closed, a child that says "make this
bigger" and nothing else, and a tracker that dies half way through and has to report
exactly which beads exist.

`node test/editwork.mjs` is the worker's end: which beads are recognised, the record parsed
back out of the body `lib/edits.js` wrote, and the three paragraphs the brief builds from
it — including that a retype is never told to think about layout and a drag is never told
a string is being replaced. It ends by running the real `bin/deliver.js` against a real
bare remote with `gh` and `bd` as fakes, in a space with auto-merge on and an approving
review already on the pull request, and asserting `gh pr merge` never happens. Everything
that could stop that merge is switched off, so the only thing left that can stop it is the
bead.

`node test/editfreeze.mjs`, in `npm test`, is the guard on
[the three writers that are not the poll](#and-the-three-writers-that-are-not-the-poll).
`public/app.js` is one 7000-line IIFE that needs a whole document to run, so what it
asserts is what a refactor breaks silently — and it reads the file as *code*, never as
prose: every gate is checked as the exact **first statement** of a brace-matched function
body with comment lines dropped, because every file in this repo argues in comments that
name the identifiers, and a slice-and-grep over a block is routinely satisfied by the
paragraph above the line it is guarding (bc-0i27.3). Its last case is the one worth having
in a year: it slices every `state.armedTimer` handler in the file and refuses any that
repaints through a function not on the gated list, so a seventh armed control added next
spring cannot quietly reintroduce the bug. The picker's half is behaviour rather than
shape, and is checked as behaviour in `test/spacebar.mjs`, which runs the real
`public/spacebar.js` in a vm: a poll carrying a new repo leaves the `<select>` untouched
while frozen, `state` takes it anyway, and the next `adopt()` after the thaw draws it.

`node scripts/editmode-check.mjs` is bc-p49x.1's acceptance **and bc-p49x.5's**, in a
headless Chrome the size of a phone, entered through `beadcause.editMode.toggle()` since
bc-p49x.12 parked the button — and asserting on the way past that there is indeed no ✏️
left to have pressed. Its first case is the control and is the reason the
rest means anything: with the mode **off**, a poll carrying a changed bead replaces the
very nodes the frozen case then keeps. Without it, a check that stamped every node and
found the stamps intact would pass just as happily against a page that never polled at all.

The bc-p49x.5 half arms a dismiss and opens a session log in the seconds before the mode,
then holds the screen for seven and a half seconds — past the six every armed control
gives you, and three ticks of the log's two-second clock — while a poll lands carrying a
second repo. It reads the `<pre>` by reference *and* by value, because `pre.textContent =
text` leaves the element itself alone: identity alone would not notice the write, and the
string alone would not notice a rebuild. It also asserts the log kept *reading* through
all of it, which is the half that would be lost by stopping the timer instead of its paint.
`--baseline` is what makes this more than a check agreeing with itself: served `HEAD`'s
`public/`, the four new cases go red and every older case stays green, which is also the
measurement that says bc-p49x.1's node-stamp probe could never have caught any of them —
they write text and attributes in place rather than replacing nodes.

`node scripts/editgesture-check.mjs` is bc-p49x.2's **and bc-p49x.3's** — it ends by
re-entering the mode, pressing Save with a thumb and reading what left the phone, which
is the epic's acceptance end to end: three things changed on a 393-point screen with no
keyboard and no chat, and one post carrying the anchors, the lines and the filters they
were said under. Every case in it is driven as
actual touches through `Input.dispatchTouchEvent`. Every case except *entering the mode*,
which since bc-p49x.12 is `beadcause.editMode.toggle()` because the ✏️ is parked and there
is nothing on the inbox to aim at — and a tap on a fixed 44px circle was never one of the
three gestures this check exists to prove. That is not thoroughness for its own
sake: a tap, a hold and a scroll are the same three events until you time them, Chrome is
the thing that decides which one a finger made, and what a drop lands on is a question
about where things are on a 393-point screen. A suite that fires `pointerdown` and moves
its own clock proves the logic and assumes all of that.

## Detail opens over the tab, not instead of it

The graph and the reader are linked from every view that names a bead — the inbox,
current sessions, the pull requests, the advocates and the chat session — and both used to be a full-page
navigation. Looking at what a bead blocks therefore cost you your place in the list,
your half-typed answer was behind a **✕ → inbox** you had to trust, and the back
gesture landed on whatever the browser felt like. They are not destinations. They
are detail about the thing you just tapped, so they **slide in from the right over
the current tab** and dismiss back to it.

There are three of them: `/graph?ws=…&id=…`, `/doc?p=…`, and
[`/session?pid=…`](#tap-a-session-to-see-what-it-is-actually-doing). The third is here
for a second reason on top of the first — a session is listed in four places, and until
it had an address of its own the detail behind it could only exist in whichever list had
been taught to fold it open.

`public/drawer.js` is one file loaded by both sides of it, picking its half at load:

- **On a tab**, it intercepts clicks on `/graph?`, `/doc?` and `/session?` links and
  loads the page that already exists into an iframe in the panel. The iframe is the
  whole trick — it keeps d3 out of the inbox's bundle and marked out of the graph's, and
  no page had to learn to render the other one. The anchors keep their real `href`,
  so long-press → open in new tab still works, and a pasted `/graph?ws=…`,
  `/doc?p=…` or `/session?pid=…` URL still loads the standalone page exactly as before.
  (A detail page opened on its own installs nothing: no drawer over a drawer's worth of
  the same thing.)
- **Inside the drawer**, the page stops being a page: it puts its own top bar away,
  hands its title up to the panel's header, and retargets a link from one document to
  the next instead of escaping to a new tab.

**One header, one ✕, and the ✕ means the drawer.** Both pages were built to be opened
on their own, so both carry a full top bar — a pulse dot, an `h1`, and a ✕ that meant
*close this tab* and fell back to navigating the whole app to the inbox. In a panel
that is wrong twice over: a second header stacked under the tab's own, and a way out
that throws away the thing the drawer was opened over. So the chrome moves out to the
panel, where it can mean what it says. The page's name goes with it — watched rather
than read once, because the graph renames itself every time the scope toggle moves
between one bead and the whole workspace — and a document keeps the monospace its own
bar gave it, since a path is read character by character. Everything that is not
chrome stays exactly where it was: the scope toggle, the reticle and the graph's
detail sheet are the detail you came for, and the sheet's own ✕ closes the sheet and
leaves you on the graph.

Opened as a page — a pasted URL, a long-press → new tab, a notification — none of
that applies and the top bar comes back, because out there it is the only chrome
there is. The switch is `.in-drawer` on `<html>`, set by `drawer.js` the moment it
sees it is in a frame.

**The tab underneath is never navigated and its scroll is never touched.** That is
the point of the change, and it is also why there is no scroll-restoring code
anywhere in the drawer: the inbox's own anchoring (see [Keeping your place in a long
brief](answering.md#keeping-your-place-in-a-long-brief)) keeps working behind the panel, and an
open brief is on the same paragraph when the drawer goes.

**One history entry, exactly.** The drawer pushes one, so Android's back button and
iOS's back-swipe close it and land you on the tab you were reading. Exactly one is
the fiddly part: an iframe's *initial* navigation adds no session-history entry and
every one after it does, so a drawer that re-pointed its iframe by `src` would make
back walk you through every document you had opened inside it before finally giving
you the tab. In-drawer navigation goes through `location.replace()`, and a closed
drawer drops its iframe so the next open is an initial load again — which also means
a graph left open is not still polling behind the tab you went back to.

Dismiss it with the ✕, with the backdrop, with a swipe right, or with back. The
swipe needs saying: a touch inside an iframe is never seen by the page around it, so
the drawer has a narrow transparent strip down its own left edge to start one from,
and the page in the drawer forwards its own swipes out. The graph pans, and a wide
table or code block scrolls sideways, so a swipe that starts on one of those is left
to it rather than stolen.

**Full width on a phone, inset on a wide screen** — with the tab still visible
around it, because there it reads as detail rather than as a new page. It covers the
[pill row](#getting-around--the-pill-row) while it is up, deliberately: the drawer is
one gesture deep, and the way out of it is back, not a fifth destination.

The Android shell needed one line for this. `shouldOverrideUrlLoading` fires for
subframe navigations too, so the WebView was intercepting the drawer's own iframe
load and opening `DocActivity` on top of a drawer that stayed empty behind it. It now
leaves anything that is not the main frame alone; a `/doc` link that *is* a main-frame
navigation — a notification, a deep link — still opens the native reader.

**Tab and Shift-Tab stay inside the panel while it is open, and land back on the
anchor that opened it once it closes** (bc-ywiy). `aria-modal="true"` told a screen
reader everything behind the panel was inert; nothing kept a keyboard's Tab to the
same claim, so a reader who tabbed past the ✕ used to walk straight out into a list
covered by the backdrop, with no focus ring anywhere on screen to say where the
keyboard had gone. The iframe is the one part of this a `keydown` listener cannot see
through: once Tab has carried focus into the framed page, the *next* Tab's keydown
happens in that document, not this one, and never reaches drawer.js at all — so the
forward wrap is caught by a `focusin` listener instead, which does not care how focus
escaped, only that it landed back in this document past the panel's edge, and sends
it to the ✕. Shift-Tab off the ✕ gets the better answer, because it starts on a
control this document can see coming: it reaches into the framed page's own
document — same-origin, so `contentDocument` is not a wall here — for its last
focusable control, rather than treating the iframe as one opaque stop. The same fix
landed on the epic's full-tab (`.p0-full` — see [The board is a grid, and tapping a
card opens it full-tab](inbox.md#the-board-is-a-grid-and-tapping-a-card-opens-it-full-tab))
and on [the tools-arming warning](agents.md#allow-tools--for-one-comment-and-only-that-one),
because all three claimed `aria-modal="true"` and none of them kept it true for Tab.

### Closing a subordinate view — one rule, in one place

The ✕ on a subordinate view obeys one sentence, and `public/drawer.js` is where it is
written down — the header for the prose, `beadcause.closeView()` for the code:

> **A subordinate view closes to the view it opened over, and to the inbox when there
> is not one.**

Three cases and no more. **In a drawer**, the view underneath is the tab the panel is
over, so closing is a dismissal rather than a navigation — and `history.back()`, so the
one entry the drawer spent is given back and the phone's own back button needs one
press afterwards rather than two. **In a tab this app opened** — long-press → open in
new tab, or a `target=_blank` out of a brief — the view underneath is the tab that
opened it, and `window.close()` hands it back. **Anything else** — a pasted URL, a
notification, a home-screen shortcut — has nothing underneath, and the inbox is the
main page.

That last case is deliberately *not* "wherever you came from". The standalone page is
the fallback for an address that arrived from outside the app, where the history behind
it is whatever you were doing before the app was open, and `back()` there is a promise
the ✕ cannot keep.

It reads like an obvious rule and the app had three of them, which is the bug this
replaced. `/session`'s ✕ went to `/sessions` — correct on the day it was written, and a
✕ that closed one view by *opening a different tab* from the day Advocates
[absorbed the sessions view](#getting-around--the-pill-row), since that path has served
the advocate console ever since. `/doc` and `/graph` went to `/`, each carrying its own
copy of the `window.close()`-then-navigate dance. And the drawer dismissed to whatever
was underneath, which is right, and is the only exit in the app that can leave you on
the pull request board — which is what the symptom was reported as.

None of the three was wrong enough on its own to notice. What was wrong was that there
were three: changing what closing means was three edits, and the third was always the
one forgotten, which is exactly how `/sessions` outlived the sessions view. So the
three pages now ask for the rule rather than each answering it, and `node
test/closeview.mjs` — in `npm test`, a static read of `public/*.js` — asserts that none
of them decides its own way out, that `closeView()` is defined once, that nothing
closes to `/sessions` any more, and that every page carrying such a ✕ loads
`drawer.js` (and that the service worker precaches it, since a notification on a bad
link is exactly when these pages are opened).

### Checking that it gives the tab back

`node scripts/drawer-check.mjs` drives the real `public/*.js` in headless Chrome at
phone size against fixtures served from the script, so it needs neither the daemon
nor a real bead. It reads a brief a long way down, opens the spec it links to, and
asserts the paragraph has not moved — then that the panel's ✕ closes the drawer and
not the tab, that a link inside a document retargets the drawer, that **one** back
closes it however many documents were read in there, that the same module behaves on
the sessions tab with a graph, that the panel is full width on a phone and inset with
a working backdrop on a wide screen, and that a pasted `/graph` URL still loads the
page itself.

The session detail gets the same treatment plus the two things only it can get wrong.
**One address from three lists**: it reads the `href` off the session row on
`/sessions`, off the advocate's worker row and its "Claude sessions" row on
`/advocates`, and off the mirror's — and asserts all four are the same
`/session?pid=…`. Right in one list and forgotten in the other two is exactly how this
breaks, and it is invisible from anywhere else. And **a pid whose process has gone says
it finished** rather than showing an empty transcript, which is the one state the page
has to distinguish and the one a fixture can actually stage.

It counts the chrome, too, because that is the part a screenshot flatters: exactly
one header and one ✕ inside the drawer, both the panel's, with a long filename clipped
to the one row rather than shoving the ✕ off the edge; the header saying what the page
in there says it is, and still saying it after the scope toggle moves; the graph's
detail sheet opening inside the panel and closing back to the graph rather than
closing the drawer; the page's own ✕ dismissing the drawer rather than the app if
anything ever reaches it; and both pages standing on their own — header, ✕ and no
drawer mode — when they are loaded as pages.

Standing on their own, it then taps each of those three ✕s and asserts **where it
actually lands**: the inbox, all three, which is the rule above. A path rather than a
"not `/sessions`", because the next wrong answer will be a different path — and it is
the half `test/closeview.mjs` cannot make, since a source read can only say that the
three pages call one function, not what that function does to the address bar.

`--baseline` serves the committed copies instead of the working ones, which is how
you check a failure here is a real one: whatever a change brings has to fail without
it. `--out=DIR` saves the three shots worth eyeballing, since how it *looks* is not
something a number can say. Like the other browser checks it is not in `npm test`,
because it needs Chrome; run it when you touch the drawer, the graph, the reader, or
the links into either.

## Current sessions — who is working, and on what

The inbox answers *what needs me*. It is `bd human list`, so a bead only appears if
it carries the `human` label — which means everything the sessions on the Mac are
actually doing was invisible from the phone. Nine beads claimed in sorrel five
minutes ago showed up nowhere at all.

This used to be its own page — 🤖 Sessions, at `/sessions`. It is **the advocate
console** now (📣 in the tab bar). The two were one view drawn twice: the same
`/api/work` payload, one card per repo, the same claimed beads, the same live `claude`
rows, an advocate state line on each. Everything below is on the console's cards, and
`/sessions`, `/work` and `/work.html` all serve it, because those paths are on the
phone's home screen and in the Android shell's history.

Which is also the better answer to the question. "What is running" is almost always
"what is running *in this repo*" — and on the console the sessions sit inside the repo
they are running in, under **Other work in this repo**, beside the advocate that may
have opened them and the queue they came off.

```
northwind                                   2 of 3 sessions
  54 open · 51 ready · 3 in progress · 4 for the advocate
  ▾ Working now                                        2/3
  ▸ Up next                                              4
  ▸ Thinking
  ▾ Other work in this repo                               3
      CLAIMED BEADS  Not opened by the advocate.
      ◗ shipping-service: client built without retry…   11h
        cl-1jw  jo.bloggs
      CLAUDE SESSIONS  Which is on which bead is not recorded.
      ● Northwind - metrics agent upgrade fix           11h
        rates-client-retry-4e7 · pid 90310 · idle
  surveyed 4m ago · launched 11h ago       [ Graph → ]
```

A session reaches this page through **either of two independent signals**, and the
page keeps them apart on purpose.

**A claimed bead — `status = in_progress`.** That is the one signal every session
already emits, because claiming work *is* `bd update --claim` — no hook, no
cooperation from the agent, no beadcause-specific convention. Live phase and detail
(✍️ drafting, 🔍 researching — from `status.json` and `agent:<phase>` labels) are
layered on where they exist; their absence is normal rather than a gap, because most
sessions never post one. The age beside each row is time since it was claimed, and
it is the number that tells you something is stuck. This is the half that says
**which bead**, so the id is a pill on the row and the row links into that bead in
the graph.

**A live `claude` process.** Claude Code writes one record per running session to
`~/.claude/sessions/<pid>.json` — pid, cwd, the `<project> - <task>` name the session
gave itself, and busy/idle. That is the only place a session which has *claimed
nothing* shows up at all, which is the common state at the start of a session and
precisely when you want to know it exists. Records are not removed when a session
exits, so every one is liveness-checked (`kill(pid, 0)`) before it is reported. A
directory is mapped to a workspace with the same rule the shell uses, so a worktree
files under its parent repo — see `beadsDirFor` in `lib/session.js`. Turn it off with
`claudeSessions: false`, or point it elsewhere with `claudeSessionsDir`; with no such
directory the page is just beads, as it was before.

**The two are never paired up.** Nothing on the Mac records which bead a given
process is on, so a session and a claimed bead in the same workspace are *probably*
the same work — and reporting that as fact would invent a link the machine does not
have. So the card says which case it is (*"Which of these is on which bead is not
recorded"* against *"Nothing claimed in the tracker yet"*) and lets you draw the
line. The state worth acting on is a session with nothing claimed, and that is
exactly the one a guess would have hidden.

### Tap a session to see what it is actually doing

A session row used to be a dead end. It said a name, a pid and the word "busy" — and
"busy" reads exactly the same for a session mid-thought as for one that has been sat
on a permission prompt for an hour. The pid was on screen precisely because there was
nothing better to show.

Tapping one now opens **`/session?pid=…`**: what the process record knows — its full
directory, its workspace, when it started, when it last spoke — and under that, **its
own Claude Code transcript, tailed live**. It arrives in the [detail
drawer](#detail-opens-over-the-tab-not-instead-of-it), over whichever list you tapped
from, and back puts you straight back in it.

```
  ┌ Beadcause - bc-76c Sessions tab: accordion cards      ✕ ┐
  │  WHERE      /Users/…/beadcause/.claude/worktrees/…-5f7   │
  │  WORKSPACE  beadcause                                    │
  │  PROCESS    ● pid 30342 · interactive · busy             │
  │  STARTED    Aug 8, 12:03 PM · 22m ago                    │
  │  ACTIVE     Aug 8, 12:03 PM · 22m ago                    │
  │  SESSION    a60224c4                                     │
  │  TRANSCRIPT  Its own log, as the terminal showed it.     │
  │  ┌────────────────────────────────────────────────────┐  │
  │  │ ❯ run whatever this repo calls its tests           │  │
  │  │ ✻ thinking                                         │  │
  │  │   > Bash node --check lib/transcript.js            │  │
  │  │     check=0                                        │  │
  │  └────────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────┘
```

**It is a page, not a pane, and that is the whole of what changed.** The detail used to
fold open inline under the row on `/sessions` — which meant it existed in exactly one of
the four places a session was listed. The same session is an advocate worker row and a
"Claude sessions" row on the console, a row in the *Elsewhere* card, and a row in the
mirror, and in all three of those the tap did nothing at all: inline detail can only
ever exist in the list that was taught to fold it. Now every one of those rows is a link
to the same `/session?pid=…`, so the tap means the same thing wherever your thumb landed.

That is also what made `/sessions` redundant — the fold was the only thing it had that
the console did not — which is why there are three places now rather than four, and why
`/sessions` lands on the console: a hop to `/#advocates` since bc-khoe.30.7, an alias onto
`monitor.html` before that.

The pid is the whole address, because nothing else identifies a running process — and a
URL that named a *file* instead would be a way to read anything on the Mac. The one row
that deliberately does **not** link here is an advocate worker whose window has gone: a
worker is a window we opened rather than a process we can see, and where the pid it
recorded no longer names anything running, the row keeps its link to the bead. Promising
a session that cannot be shown would be worse than the dead end it replaced.

Claude Code already writes the whole conversation to
`~/.claude/projects/<slug>/<session-id>.jsonl`, one JSON object per line, appended as
it happens — so this reads that file (`GET /api/session-log?pid=`). **Nothing is
instrumented and nothing is asked of the session**, which is the point: a session
started by hand, that beadcause has never heard of, is as visible as one the daemon
dispatched itself. It is rendered into the same line grammar as the dispatched-agent
log, server-side, so the phone only ever receives text.

Four things worth knowing:

- **Addressed by pid, never by a path.** The pid is matched against the sessions the
  page itself just reported, and the file is resolved from the record Claude Code
  wrote — so a request cannot name a file of its own choosing. A pid that has gone
  says so, because "it finished" is a different fact from "it has done nothing".
- **The tail grows until there is something to read.** One transcript line is a whole
  message, and a `tool_result` carrying a 200 kB file is ordinary, so bytes are a
  terrible proxy for lines: measured on a real session, 256 kB of recent transcript
  was ten lines, six of which rendered. It widens the window — bounded at 2 MB — until
  it has a screenful of what it will actually show.
- **It looks in every config directory.** One Mac can run two Claude Code accounts out
  of `~/.claude` and, say, `~/.claude-personal`, chosen per shell with
  `CLAUDE_CONFIG_DIR`; the daemon runs under launchd where that variable is not set.
  Honouring it alone would find only the sessions sharing the daemon's environment.
  `claudeProjectsDir` overrides the search and takes a list.
- **A transcript is not redacted.** It holds every prompt and every byte of tool output
  from that session, which for a work repo can include things you would not put in a
  chat. It travels the same token-authenticated, tailnet-only path as the rest of
  `/api/` and no further — but it is the most sensitive thing this daemon serves, and
  `claudeSessions: false` turns it off along with the rest of the session reading.

The page polls every two seconds while it is open and stops for good on the 404 —
there is no point asking again about a pid that will never come back. It follows the
tail only if you were already at the bottom, so scrolling back to read something is not
yanked away by the next line. The console behind it refreshes on its own 20-second
cycle and, because the detail is in a drawer rather than folded into that list, a
repaint there can no longer disturb what you are reading.

**That is also what let the sessions view go.** The detail had to be folded into the one
list that was taught to fold it, and that fold was the only thing `/sessions` had which
the advocate console did not. Once every row anywhere in the app reached the same
address, the two pages were the same page — see [the tab
row](#getting-around--the-pill-row).

### And you can answer it

Watching a session think and having no way to say anything to it was the last dead end
in the app. Every other conversation here is one beadcause *started* — the bead console,
the agent chat, the pty on `/term` — and so it owns a process and can write to its
stdin. This is the one already on your screen, and it belongs to a terminal window the
daemon does not own.

So there is a box under the facts, and **the transcript below it is the reply**:

```
  │  SAY SOMETHING  It lands in the session as if typed.     │
  │  ┌──────────────────────────────────────────┐  ╭────╮   │
  │  │ have you run the tests yet?              │  │ ↑  │   │
  │  └──────────────────────────────────────────┘  ╰────╯   │
  │  It is mid-turn, so the session holds this until the     │
  │  turn lands.                                             │
```

Nothing renders the answer — the pane was already tailing the file the session writes,
so the reply arrives on the next two-second poll through the channel that was there all
along. No second connection, and nothing echoed optimistically into the transcript,
because a line in that pane which is not in the file would be indistinguishable from
something the session actually said.

**The channel is `write text` into iTerm**, the same one the advocate has always used to
ask a worker whether it is still alive — it puts the words in the TUI and presses
return, exactly as if they had been typed. What is new is the *address*. The advocate
kept the iTerm session id of every window it opened, which is an exact handle and exists
for almost none of the sessions on this Mac. A session you started at the keyboard was
never opened here. But every process has a **controlling terminal**, and iTerm reports
the same value on its side, so the join is `pid → /dev/ttysNNN → the window showing it`
and it needs nothing remembered at launch. That is what makes this reach sessions that
predate the feature, including the one you are reading this in.

Three things it refuses to be vague about, because all three fail silently and you are
in another room:

- **A session that cannot be reached says why, and offers no box at all.** Not a
  disabled one: a disabled box is an invitation with the door shut, so you write the
  message anyway and find out afterwards. A session with no controlling terminal (run
  headless, or over the SDK) has no input line to type into; a session in Terminal.app,
  tmux or over ssh is running perfectly well and is simply out of reach of the one
  channel there is. Those are different sentences, and neither of them is "finished".
- **Nothing typed is lost without being told.** The box empties only once the daemon has
  said it delivered. A refusal, a window that closed between the check and the send, a
  connection that died mid-request — the words stay exactly where you typed them and the
  reason goes underneath.
- **Mid-turn is queued, and it says who is queuing it.** Claude Code takes typing while
  a turn is running and answers it when the turn lands, so the message goes straight
  out and the *session* holds it. There is deliberately no second queue on this side:
  beadcause holding words back that the session was ready to take would be a delay it
  invented.

**Two paragraphs arrive as two paragraphs.** They used to arrive as one line: `write
text` adds a return at the end of what it writes, so a second line would have submitted
as a second message — half a sentence into a running agent — and the text was closed up
before it went, warned about while you typed and confirmed after it landed. That
flattening was the whole reason Claude Code's IDE WebSocket was investigated
([`docs/ide-websocket-spike.md`](docs/ide-websocket-spike.md), on `bc-g1l`), and the
spike ended by finding the flattening was never a property of AppleScript at all — only
of a default. `write` takes a `newline` boolean, so the message goes down as a bracketed
paste with `newline no` and submits nothing, and a bare `write text ""` after it is the
one Return that sends the lot as a single turn. Two statements on the channel that was
already there, which is why nothing here speaks the WebSocket: it can put multi-line text
in a live session's box but has no message that submits one, so it would have needed the
AppleScript return anyway — a second channel bolted alongside this one, reaching only
sessions inside its declared `workspaceFolders`.

Two things about it worth knowing. `SAY_MAX` is unchanged and still real: the message
rides to `osascript` as an argument however many lines it is split over, so ARG_MAX is
still the ceiling and 8000 characters is refused for being long rather than mistaken for
a session that has gone. And on the Mac itself, a message over a few lines shows in the
composer as `[Pasted text #1 +6 lines]` rather than as the words — it submits in full,
but anyone reading that screen is reading a placeholder.

`POST /api/session-say` is token-authenticated like everything else under `/api/`, and
it is *not* refused in observe mode: `BEADCAUSE_OBSERVE` is about the daemon acting on
its own, and this is you typing — the same category as the in-app terminal and the bead
console, which a spare-port instance is booted precisely to try.

`node scripts/say-check.mjs` drives the real `public/session.js` in headless Chrome at
phone size against fixtures, and it is pointed at the promises rather than the markup:
the words surviving a refusal, a dropped connection and a repaint; the box disappearing
when a send comes back saying the session is out of reach; the reply arriving through
the transcript pane rather than through the send's own response; and, since `bc-75q2`,
the line breaks reaching the wire with nothing on the page claiming they were closed up.

**The composer keeps what you had picked out when it redraws itself, selection and all.**
It redraws on its own more often than it looks: a poll that finds the reach or the status
changed, a send starting, a send answering, and the line-break hint appearing under the box
the moment a message gains a newline. Each of those replaces the textarea — the transcript
below is a `<pre>` thousands of lines long and rebuilding the page to move a line of small
text would take the keyboard down with it on iOS — so where you were in the box is carried
across by hand. **Both ends of the selection are carried, not just the near one.** A caret
is the case where the two are equal, so carrying only `selectionStart` gave every selection
back as a caret at its left edge: you picked out the sentence you were about to type over
and the next poll left you in front of it (bc-nh19 — the same one-ended restore as
[bc-c3ve in the Mirror](#the-mirror--whatever-the-phone-has-open-with-room-to-read-it)).
The direction goes with them, because it is the end the next Shift-arrow extends from. The
check drives it rather than reading for it: it types through the real `input` listener,
selects part of what it typed backwards, flips the hint to force the repaint, and asks the
box afterwards where the selection is.

`--baseline` serves HEAD's `public/session.js` instead of the working one, which is how you
tell a real failure from a flake: the cases the branch in hand is about must fail there and
pass on the working copy, and nothing else should move. It used to fail everything, because
before this there was no box at all — that stopped being true the day the box landed.

The delivery itself is the one part no test does — `write text` into a live window would
type a fixture string into whatever session answered — so `test/session.mjs` covers the
rules around it instead: reach refusing a pid with no terminal, the length refused on the
message as typed rather than on a flattened one, and the AppleScript matching a tty as
well as an id and sending its paste with `newline no` and exactly one Return after it.

### …and then go and find it on the Mac

The dead end after that one. You could read a session and answer it, and still not know
*which of a dozen worktree windows on the desk it is* — finding it meant going through
iTerm's window list by hand, comparing paths, on the machine you had just walked over to.
So the same page has a **Bring it up** button above the box. One tap raises that
session's iTerm window over everything else and doubles it in place, twice as wide and
twice as tall, and closing the view puts it back at exactly the bounds and position it
had. It is gated on the same `reach` as the composer, from the same response, so a
session in Terminal.app or tmux says there is no window rather than offering a button
that would do nothing.

Four things about it are decisions rather than details:

- **The rectangle to go back to lives in the daemon, not the page.** `lib/focus.js`
  holds it keyed by pid, read off the window in the same `osascript` call that enlarges
  it — split into two calls, the second would read the rectangle the first had already
  enlarged and save *that*, so a second tap would leave a window nothing could restore.
  It is also why a phone that reloads mid-way finds the window as it left it, and why
  the second tap is a *restore* rather than a second enlarge.
- **It is clamped to the screen it is on.** A window doubled about its centre near an
  edge would put half of itself off the display, and the half that goes missing is as
  likely as not to be the one you drag the window by. `magnify` in `lib/iterm.js` caps
  the size at the screen and slides the result back inside it, so a window already
  filling its display simply does not move. When nothing could be measured it grows from
  its top left corner instead of its centre — not a lesser version of the same thing, but
  the recoverable direction. That case is not hypothetical: the screen probe and the
  `activate` were fired at iTerm together in the first draft, the probe lost the race and
  came back empty, and a real window grew 368px off the left of a real display. The probe
  now runs first, alone.
- **Closing the view is what puts it back, and a locked phone is not a close.** The page
  beacons a restore as it is torn down — the ✕, the back button, a closed tab. It
  deliberately does *not* act on `visibilitychange`: you tap the button, put the phone in
  your pocket and walk to the Mac, and a window that shrank at that moment would have
  undone the one thing you asked for. The ways of leaving that send nothing — a lock that
  never comes back, a discarded tab — are covered by a lease renewed by the page's own
  two-second poll, and three minutes after nothing is watching, the daemon puts the
  window back on its own.
- **Nothing is persisted, and focus is not handed back.** These rectangles live as long
  as the process does; a daemon restart forgets them and leaves the window big, which is
  the lesser evil, because a pid is reused and a rectangle read off disk after a reboot
  could move a window belonging to something else entirely. And the app that had the
  keyboard does not get it back on close: you asked for that window to be in front
  because you are about to use it.

`test/focus.mjs` covers the arithmetic and the rules over a window made of numbers — the
saved rectangle written once, a restore consuming it, a refused restore keeping the
record so the sweep can retry rather than stranding the window, and the clamp checked
against the same measured three-display fixture `test/cards.mjs` uses. The page half is
in `scripts/say-check.mjs` alongside the composer, including the one thing only a real
browser can show: that the beacon really does leave a document that is going away.

Every card has a **Graph →** into the whole workspace — which is also the answer to
"how do I see what another session just created", since the graph draws every open
issue rather than only the questions.

Two `bd` calls per workspace (`status --json` for the counts, `list
--status=in_progress --limit 0 --json` for the beads — `--limit 0` because bd's own
default is 50, and a silently truncated list here would read as the whole truth),
run in parallel across all of them:
about two seconds for six. It used to run every 20s for as long as the page was open;
it now follows [the delta stream](#the-delta-stream--every-view-on-the-event-log)
instead, so the advocate roster repaints off the poll for free and those `bd` calls run
only when something happened that they would answer differently — plus the ⟳ and a cold
boot. It also stops while the Mirror pane is the one showing, because a hidden page must
not keep sweeping every tracker on the Mac. A workspace that fails
reports its error in place rather than vanishing from the list; a missing row would
read as "nothing happening there", which is the one thing it doesn't mean.

## The mirror — whatever the phone has open, with room to read it

The phone is a good place to be **told** something and a poor place to **read** it. A
question's brief arrives a paragraph at a time, its thread is behind a tap, the bead it
depends on is a page away, and the options are three buttons stacked in a thumb's width.
The Mac has room for all of it and no way to know what you are holding.

The **Mirror** is the second pane of the advocates page — `public/mirror.js`, reached by
the chip beside **Advocates** rather than by a tab of its own, [for reasons that are about
what it is](#the-mirror-is-a-pane-not-a-tab). It follows the phone — the same card, the
same chat session, the same list — and draws the version that would not fit in a hand:

```
 Advocates │ Mirror ●

  ( iPhone · a card · just now )  ( iPad · idle · 2h ago )  ( whoever moved last )

  iPhone has a card open · 4m ago.

  northwind   cl-8f2   P1   decision
  Deploy to staging before the demo?
    …the whole brief, every section of it, as written…
  ── Thread ──────────────────────────────────────────────
  jo.bloggs    2d   the fee comparison is the actual blocker
  claude       1d   drafting · comparing both fee models
  ── 2 choices ───────────────────────────────────────────
  [ Yes, deploy tonight                                  ]
  [ Compare both models first  ↪ commissions the work    ]
  [ Answer it, or say what you want looked into…         ]
    🎤   [ Comment & ask an agent ]  [ Answer & close ]
```

Three things make that a mirror rather than a second inbox, and each one is a decision
with a cost attached: **it follows rather than chooses**, **it waits on the bus rather
than on a timer**, and **every button in it is an endpoint that already existed**.

### It follows; it does not choose

The view comes off `/api/presence`. Every client page loads `public/presence.js` and
calls `presence.report({...})` when its view changes — one shared file, because the
alternative is five slightly different debounces — and a page may call it on **every**
render, which is what most of them do: the payload is compared with the last one sent and
an identical report costs nothing. That is the property worth keeping. Publishing where
you are must never be something a page has to remember to do at exactly the right moment;
it only has to be *able* to say where it is, as often as it likes. Nothing there blocks a
repaint either — the send is debounced, fire-and-forget, and a failure is swallowed,
because the monitor going blind is not a reason for the phone to stall over a feature the
person holding it is not using.

`lib/presence.js` holds the other end, and it is the one thing in beadcause that knows
something about the **reader** rather than about the tracker: which view the phone has
open and which card is up in it. **In memory, never on disk** — a phone's whereabouts is
worth exactly as long as the daemon that serves it, a restart means every client
re-reports on its next heartbeat, and a record that outlived the process would only ever
be a lie about where someone is. It is also why nothing needs pruning on a timer: `list()`
drops what has gone stale as it reads. A report is a claim by a client, so every field is
bounded there rather than trusted — an unknown view collapses to `other`, and every string
is cut to a length that fits a line of the pane.

The chips across the top are the devices, one each, saying where they are and how long ago
they said so. The age is on the chip and not only in the header because a device keeps its
record for **fifteen minutes** after its last word (it beats every 45s while it stays put,
well inside that, so a phone left on a card overnight is not a request a minute all
night) — and a browser that was closed an hour ago must not read as one being held right
now. A screen that has gone off says `· asleep`, and the header says "the screen is off,
this is where it was left" rather than presenting a stale view as a live one. Tapping a
chip pins that device; "whoever moved last" gives the pin back, and it only appears once
there is a second device, because with one phone the two instructions are the same. With
nothing reporting at all the pane says so and says what to do about it — "No device has
said where it is. Open the inbox on the phone" — because an empty frame on a screen you
left running looks exactly like one that has broken.

The monitor loads `presence.js` too, which took some care: it is the mirror *and*, since
it absorbed [`/sessions`](#current-sessions--who-is-working-and-on-what), a view worth
mirroring. A device that followed another device would list itself, so two halves stop it
— `notMe`, which drops this browser profile from the list, and `showTab`, which reports
`view: null` while the pane is the one showing. A mirror cannot circle back on to the page
it is drawn on, and that is the same property that makes it [meaningless on a
phone](#the-mirror-is-a-pane-not-a-tab).

### The Mirror pane waits, it does not poll

A presence report that says something new wakes the parked `/api/poll`, so a card opening
in a hand is on the big screen as fast as the network allows and **nothing is polled in
between**. Each view behind it costs a `bd` call, and they are paid for on a move rather
than on a clock. Two things keep that from costing more than it saves:

- **A heartbeat that repeats the last report is stored and stays silent.** `report()`
  returns `changed`, and only a change reaches the bus — otherwise every phone would wake
  every parked long-poll twice a minute to say nothing had happened.
- **This listener asks for presence and nothing else** (`/api/poll?want=presence`). The
  presence branch of the poll explicitly does not sweep `bd`; without the flag, parking a
  second listener there would double the sweeps the daemon does per event to build a
  question list this pane throws away.

The read is keyed on the **view's identity**, not on the presence record: a heartbeat, a
`hidden` flag flipping, another device arriving — none of those change what should be on
screen, and each would otherwise cost a `bd show`. The bead underneath can move without
the phone moving at all, which presence cannot tell you, so a non-presence event on the
key being shown forces a re-read as well.

The feed runs whether or not the pane is the one showing, which is deliberate: the whole
argument for presence riding the bus is that a move is known instantly, and a mirror that
started listening when you looked at it would be a poll with extra steps. The cost is one
held socket. While the pane is hidden a move only lights the dot on the chip — nothing
repaints behind a hidden pane, so a parked read would be a held request nobody looks at —
and coming back forces one fresh read.

**That feed is [the shared one](#the-delta-stream--every-view-on-the-event-log), and was
hand-rolled for longer than it should have been.** It was left out when the other five
views were converted, on the reading that three of `stream.js`'s rules are inverted here:
the loop runs whether or not its pane is showing, it never stops, and it has no fallback
to stand down to. None of the three survived being checked against the file. The pane
above is the mirror/advocates toggle *inside* one document and `stream.js` has no opinion
about it — its rule is `document.hidden`, the browser tab, and a mirror window merely
unfocused on a second screen is `visible`, which is the entire use case. "Never stops" is
the retry, which is the default and which walks a dead daemon out to a minute rather than
re-asking it every three seconds for as long as the page is open, as this loop did. And
"no fallback" is `onSettle` being optional. So the conversion needed no new options at
all, and what it bought was that backoff, an abort when the tab hides instead of a socket
held in the dark, and a `resync` the hand-rolled loop had no concept of — the log rolling
past leaves `events` empty, which read as *nothing moved* on the one occasion the pane
could least afford it.

A chat session is the exception, because it changes while nothing moves at all — the agent
is mid-sentence. That used to be a 1.5s `setInterval` re-reading the whole session, which
made a turn arrive up to a second and a half after it was written and cost forty requests a
minute for a session nobody was talking to. It has a parked request of its own now, on the
same `/api/console/poll` [the console's own page lives on](android.md#the-chat-session--deciding-what-to-file):
it waits on that session's sequence and hands back the whole session the moment it moves,
so an idle one is one held request and a streamed turn lands as it is written. The whole
session comes back rather than a diff, which is what makes a mirror that missed half a turn
— asleep, or off the tailnet — correct on its first response instead of reconciling a
stream it never saw. Repaints are coalesced to a tenth of a second on the way in: a delta
moves the sequence per token, and this pane's composer is *inside* what a repaint rebuilds,
unlike the console page's. A generation counter stands the loop down when the phone leaves
the session, because the phone can come back to one while the old poll is still out and
that response must not paint over a newer read.

`node scripts/mirror-check.mjs` holds it to that, in headless Chrome against fixtures
served from the script: that an idle session is read **once** and then parked on, that
streamed words arrive through the park rather than through a second read, and — the case a
timer never had to think about — that the request still in flight when the phone leaves the
session neither repaints the pane nor starts another one.

**What is in the composer survives every one of those repaints, selection and all.** The
draft itself lives in the pane's own map rather than in the DOM, so the words come back by
being rebuilt — but where you were *in* them does not, and is carried across by hand.
**Both ends of the selection are carried, not just the near one.** A caret is the case
where the two are equal, so carrying only `selectionStart` quietly turned every selection
into a caret at its left edge: you picked out the sentence you were about to type over and
it was a caret in front of it by the next token — a repaint you did not ask for undoing
something you did (bc-c3ve). The direction goes with them, because it is the end the next
Shift-arrow extends from, and a backward selection restored as a forward one grows out of
the wrong side. The check drives that rather than reading for it: it types through the
real `input` listener, selects part of what it typed backwards, streams a turn, and asks
the box afterwards where the selection is.

`--baseline` serves the committed copy of `public/mirror.js` instead of the working one,
which is how you tell a real failure here from a flaky one — the cases the branch in hand
is about must fail there and pass on the working copy, and nothing else should move. It
used to fail the parking cases for everybody, because HEAD's mirror asked
`/api/console/poll` nothing at all; that stopped being true the day the parked loop
landed, and a claim like it is worth re-reading rather than inheriting.

### Taking the wheel, and handing it back

Following is the default, not the whole of it. Tapping a row in the mirrored inbox opens
that card **here**, and that is an override recorded on purpose: the phone keeps moving
underneath, and without it the page would slide out from under your own click. The header
says which of the two you are in — "iPhone has a card open · 4m ago" against "You opened
this here" — and an override keeps the device it was launched from, so the way back is one
press of **Follow the phone again**. Pinning a different device gives the wheel back too.

Composer text is held per target, so a repaint — and there are many, driven by another
device, landing at the least convenient moment by definition — cannot eat a half-typed
answer, and the caret goes back where it was after every rebuild. Which option you clicked
is remembered the same way, because it is the only thing that can say whether the answer
commissions work.

### Every button in it is an endpoint the phone already had

Answering is `POST /api/respond`, commenting is `POST /api/comment`, and talking to a chat
session is `POST /api/console/message` with `POST /api/console/close` to end it. Those are
the phone's own writes, unchanged: **this pane holds no privilege of its own and adds no
state to the daemon.** Presence is the only thing it needed that did not exist, and
presence is a read.

That is what keeps it one app rather than two over one bead. A choice clicked here fills
the composer instead of sending it, exactly as it does on the phone — a choice you may want
to qualify in a sentence has to reach the box before it reaches the thread — with the same
three rules: another choice's words replace, words of your own are appended to, and
clicking the choice you already made takes it back while the box still says what that click
put there. The button over it reads **Answer & commission** rather than **Answer & close**
for an option marked [`closes: false`](asking.md#asking-a-question), because the phone's own button
does, and one screen promising a close the other does not is worse than either wording.

Three views it deliberately does **not** draw. A terminal, a document and a session's
transcript are files and pipes on the Mac rather than rows in a tracker: the phone is not
showing a cut-down version this screen could improve on, so a second renderer here would be
one more thing to keep in step for no gain. The mirror names what the phone is looking at
and offers the same address — for a session, the very `/session?pid=…` every other list in
the app links to. The pull request board has no richer version here either, and the pane
says as much in a line rather than showing an empty frame.
