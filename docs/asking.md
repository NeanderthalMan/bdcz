# Asking — spaces, accounts, and what a question is

## Asking a question

Anything labelled `human` shows up. **A question ends with a fenced `decision` block,
with nothing after it, and one option in it marked `recommended: true`** — that is the
rule the briefs teach and `beadcause-ask` refuses a body without it. The prose above the
block is context; the block is the ask, and it is what turns a wall of text into buttons
you can tap from a phone. Without one, the card falls back to guessing the options out of
the prose (`lib/suggest.js`) — and a guessed option *fills* the answer box rather than
sending it, because nobody wrote it on purpose.

One question per bead: two things to decide is two beads and two cards, because a card
has one answer box and no way to say which half of it an answer answers. And if what you
need is a *fact* rather than a choice — a password, a number nobody wrote down — there is
nothing to offer and inventing two options would be worse than none: `--no-options` says
so, and is the only way past the check.

The block is also what gets you diagrams, documents and links:

````markdown
Some markdown context. Tables, images, links, `code` — all of it renders.

```decision
question: Charge the platform fee on gross or on net?
options:
  - id: gross
    label: Gross — fee on the full charge
    hint: Simpler to reconcile
    response: "Gross: take the platform fee on the full charge amount."
  - id: net
    label: Net — after Stripe's cut
    response: "Net: calculate the fee after processing costs."
diagram: |
  graph LR
    Buyer --> Platform --> Seller
docs:
  - label: The spec you need to read first
    path: /Users/you/code/acme/SPEC.md
  - /Users/you/code/acme/notes.txt
links:
  - "[Stripe application fees](https://docs.stripe.com/connect/direct-charges)"
  - label: Payouts sheet
    url: https://example.com/payouts
images:
  - /Users/you/code/acme/current-flow.png
audio:
  - label: Mix A, drums forward
    path: /Users/you/code/acme/clips/mix-a.m4a
```
````

- **A choice on a shut card sends; a choice on an open card writes.** Tapped in the
  list, an option is the answer: the first tap arms it and the button says what the
  second one will do — *Tap again — answers bc-7qo* — and the second sends that
  option's `response` and closes the bead. Tapped on an open card it puts the same
  `response` in the answer box instead, where it is yours to edit, qualify or take
  back, and *Answer & close* under the box is what commits it. Two things people do
  with a multiple-choice question, and the card is in a different state for each:
  pick one and say nothing, or pick one *and say something about it*. **💬 Discuss**,
  under the choices, is the way from the first to the second. In the box, tapping a
  second choice replaces the first; tapping the one you already picked empties the box
  again; and a choice tapped after you have typed something appends to it, because
  words you wrote are never thrown away — which is also why a shut card **holding a
  draft** opens rather than sending, instead of answering over words it never showed you.
- `options[].response` is the exact text recorded as the answer — write it so a
  future agent can act on it without re-reading the question. It is what lands in the
  box, so write it as a sentence rather than as a button label.
- `recommended: true` on one option puts a ★ and a tag on its button. `recommend:
  <id or label>` beside the list is the same thing said once instead of per row,
  and wins if both are written. Only one option is ever starred: two is the block
  contradicting itself, and a card is the wrong place to discover that.
- **`closes: false` on an option that commissions work rather than settling it.**
  Answering normally closes the bead, which is right for a verdict and wrong for a
  build order: "Build both as written" is an instruction, and closing on it files
  the work as finished at the moment it is ordered. An option marked this way
  comments the answer, drops the `human` label and leaves the bead open and
  unclaimed — so it goes straight into `bd ready` and an advocate picks it up as
  work, instead of a session having to reopen it by hand and put the card back in
  your inbox. Everything else is the same, including the card leaving the inbox; the
  toast says which of the two happened. **The button under the box says so before you
  press it** — it reads *Answer & commission* while that choice is the one in the box,
  because the close is the one outcome that is not going to happen. The option's id
  rides with the answer and the server re-reads the bead to decide, so editing the
  sentence into your own words does not turn a commission back into a close.
- **`defers: true` on an option that means *not yet, ask me again later*.** The
  other kind of non-closing answer, and the one `closes: false` used to be pressed
  into service for — wrongly, because it hands the bead to an agent. A deferral hands
  it to nobody: the answer goes on the thread, the bead stays open and unclaimed, and
  the **card is set aside**, coming back on its own when what it is waiting on has
  cleared. `defers: true` implies `closes: false` and wins over a `closes: true`
  written beside it. The button reads *Answer & set aside*, the option carries *↪ not
  yet — sets this card aside*, and the two-tap arm on a collapsed card says *Tap again
  — sets bc-7qo aside*. See [Not yet — the third thing an answer can
  mean](answering.md#not-yet--the-third-thing-an-answer-can-mean).
- `diagram` is mermaid, rendered on the phone. ` ```mermaid ` fences in the prose
  render too.
- `docs` are files on the Mac you need to read before answering. Each opens in the
  **reader** (`/doc?p=…`) as a [drawer over the card you were
  reading](navigating.md#detail-opens-over-the-tab-not-instead-of-it): markdown is rendered,
  text/log/csv shown as-is, PDFs embedded. Relative links inside a rendered markdown
  doc resolve against that doc's directory, so a spec that links its sibling files
  stays navigable — and follows into the same drawer. Servable extensions are images plus
  `.md .markdown .txt .log .csv .json .jsonl .yaml .yml .pdf` and the sounds
  `.mp3 .m4a .aac .wav .ogg .oga .opus .flac` — source files are refused, deliberately.
- **A clip is played on the card, not opened.** Each `audio` entry (a path, or a
  `label` and `path`) draws a native player under the images, and a `docs` entry whose
  file is a sound is sorted into the same list — so a listening decision has an exhibit
  without publishing the clips anywhere. Players do not fetch anything until pressed,
  and `/api/asset` answers `Range` requests, which is what lets a phone start a clip
  and seek in it. Opened straight in the reader tab (`/doc?p=…`) a sound is a player
  too.
- **A local path written inline in the prose becomes a reader link too** —
  `[the spec](/Users/you/code/acme/SPEC.md)` needs no `docs` entry. Every link in
  a brief opens in a new tab so you never navigate away mid-answer.
- `images` and `audio` may be absolute paths on the Mac — they're served through
  `/api/asset`, restricted to `config.assetRoots`.
- A block that isn't valid YAML shows the parse error on the card rather than
  silently dropping to free-text. Two spellings that are obvious and invalid are
  repaired before the card is drawn, though quoting them yourself is clearer:
  a bare markdown link (`- [x](y)` is a YAML flow sequence), and **a colon inside a
  sentence** — `response: … fetches them from gdrive4t: at build …` reads as a nested
  mapping and costs the *whole* block, question and every option with it. The repair
  runs only after the ordinary parse has failed, and only on the keys that carry
  prose (`question`, `context`, `label`, `title`, `response`, `answer`, `hint`,
  `detail`, `id`), so a block that already parses is never rewritten.
- **Write the prose as paragraphs; the hard wrap doesn't survive.** bd stores a
  description, notes, design or acceptance hard-wrapped at about 78 columns, and
  on a phone each of those lines wraps again — so anything that came out of bd
  renders with markdown's `breaks` off and reflows into real paragraphs and real
  lists. A blank line is what makes a new paragraph, there as anywhere. Comments
  are the other way round: someone typed those on a phone, meaning every newline,
  so a comment keeps the line breaks it was written with.

From an agent session, piping the body avoids shell-quoting hell:

```bash
node bin/ask.js -w acme -t "Gross or net platform fee?" -f brief.md
node bin/ask.js -w acme -t "Which auth flow?" -b ac-abc < brief.md   # -b blocks that issue
```

`-b <id>` makes the named issue depend on the question, so it stays out of
`bd ready` until you answer.

### Suggested answers — when there is no block

Most beads are not filed by anything that has heard of beadcause. A session ends,
writes its open question into `bd` as ordinary prose with the choices in a list,
and the card used to render that as paragraphs with an empty box under them — the
answer visible on screen and still needing to be typed out with a thumb.

So when a bead carries **no** `decision` block, beadcause reads the prose and
offers what it finds as chips on the top edge of the answer box:

```
Suggested — read out of the design            tap to fill the box
[ ★ Restore at promotion ]  [ Restore at startup ]
```

**A chip fills the box, exactly as a written option does on an open card** — the
chips live on the box's own top edge, so there is no shut-card half to them. Tapping a second chip
swaps your pick; tapping one after you have typed something appends, because the
words you wrote are never thrown away. Two differences from the buttons above
survive, and both come from where the words came from. A chip **lets go the moment
you edit it** — it is only ever a claim that the box says exactly what the chip
says, while an option stays lit while you qualify it. And a chip **carries no id**,
so it cannot commission work: `closes: false` is a thing an agent wrote about an
answer it wrote, and this parser is guessing.

**Write the list and it will be found.** Any of these parse, in this order:

- `**Bold label** — the rest.` as a bulleted or numbered list. The bold run
  becomes the chip; everything after it rides along in the answer.
- `Option A — …`, `Option B: …`, anywhere — list, heading or bare paragraph.
- `**(a)** …`, `(b) …`, `c) …` — a lettered or numbered run, as list items or as
  paragraphs. The letter stays on the chip and in the answer, because it is the
  word the question itself used: *I recommend (b)* stars the right one, which no
  amount of matching on labels could work out. The run has to start at `a` (or `1`)
  and have no holes in it — a pair that starts at `(c)` is a fragment of something
  quoted, not a question being asked here.
- A plain list directly under a lead-in line: *The options:*, *Choices:*,
  *Candidates:*, *Two ways forward:*.

**Say which one you would pick** with `(recommended)` in the item, or a closing
line — `RECOMMEND Restore at promotion — the swap read is cheap`, which is the
spelling the `handoff` skill already tells every session to write. A closing line
beats an inline marker, because it is the later thought. `not recommended` never
stars anything, which matters more than it sounds: it is ordinary prose, and a ★
on it would be the app recommending the thing the brief warned you off.

**It fails towards silence**, and that is deliberate — a card with no chips is
the card you have today, while chips scraped off an unrelated bullet list invite
the wrong tap. Nothing is offered for: one item, more than six, a `- [ ]`
checklist, a list inside a fenced block, two candidate lists with no question
between them to say which one is being asked, or two items that read the same.
Nor for a proposal, an amendment or a delivery — those draw their own controls,
and a second set of chips beside them would be two answers to one question
disagreeing about what the question is.

**A `decision` block is still better** and is what to write when you know the
question is going to a phone: full-width buttons above the fold rather than chips
in the box, the sentence you meant recorded as the answer rather than one lifted
out of a paragraph, and the only place `closes: false` or `defers: true` can be said.
This is the safety net under everything else.

#### Checking it

Two, because the parser and the gesture fail in different ways:

- **`node test/suggest.mjs`** — the parser, in `npm test`. Every shape it reads,
  and — the half that carries the weight — every shape it must refuse, since a
  card with no chips is the card you have today while chips scraped off the wrong
  list invite the wrong tap. Both directions of the ★, including `not
  recommended`.
- **`node scripts/suggest-check.mjs`** — the tap, in headless Chrome at phone
  size, driving the real `public/app.js`. It counts writes and fails on one: the
  claim it exists to defend is that a chip fills the box and never sends, and the
  refactor that would break that — routing a chip through the `option` handler —
  reads like tidying up a duplicate. `--baseline` serves the committed `public/`,
  where it must score 7/23: every suggestion case failing, every control passing.
  Not in `npm test` — it needs Chrome.
- **`node scripts/option-check.mjs`** — the same, for the buttons a real block
  draws. It counts writes too, and adds the three things a written option has that
  a chip does not: that the pick survives you rewriting its words, that the id
  reaches `/api/respond` when you finally press the button, and that the button
  renames itself over a commission. `--baseline` stops at the sixth check, because
  the committed build arms the first tap instead of opening the card. Not in
  `npm test` — it needs Chrome.

## Accounts — one life at a time

Beadcause reads every tracker on the Mac, which is the right thing for a notification
daemon and the wrong thing for a screen: work and everything that is not work, in one
inbox, one board and one picker. Spaces group them by *when they may interrupt you*,
which is a real question and not this one. An **account** is the level above — an email
address that owns a set of workspaces, and, inside a workspace that holds many
checkouts, a set of repos:

```json
"accounts": [
  { "email": "you@gmail.com", "label": "Personal",
    "workspaces": ["notes", "sideproject"] },
  { "email": "you@work.example", "label": "Work",
    "workspaces": ["acme"],
    "repos": { "acme": ["acme", "atrium-service"] } }
]
```

One is in force at a time, and **what it owns is the whole of what the app shows**. The
other account's questions, pull requests, chats, tickets, advocates and spaces are not
behind a filter you can widen — they are not on the screen, and the picker does not offer
them.

**The mark is the control.** It sits at the left-hand end of the top bar on every page,
wrapped in a gear; tapping it opens a menu holding that page's own actions — refresh,
foundations, open-in-Chrome — plus **Admin** and **Switch account**, which opens the
picker. The picker has a ＋ for adding one: an address, a name, and a tick per workspace.

```
┌────────────────────────────────────────────────┐
│ ●  [icon⚙]  [ beadcause      ▾ ]               │
│ ┌────────────────────────────────────────────┐ │
│ │ ⚖️   Foundations                            │ │
│ │ ⟳   Refresh                                │ │
│ │ ────────────────────────────────────────── │ │
│ │ ⏸   Admin                                  │ │
│ │ ⇄   Switch account                         │ │
│ │       you@work.example                     │ │
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

The address was the control until bc-khoe.5, as a chip at the *other* end of that bar,
and the argument for it was good: a chip saying "Personal" needs a second surface to say
which identity it files as, where the email is both at once. What moved it was the row
rather than the argument. The space picker had a full-width row of its own under a first
row that was already full, so every standing view carried two rows of sticky chrome, and
the chip's width is what paid for bringing the picker up beside the mark. The address did
not go anywhere — it is the second line of **Switch account**, which is the row that
changes it, so the two things you ever want it for are now the same tap target. See
[the top bar](inbox.md#the-top-bar-says-who-is-asking-not-what-the-app-is-called).

**Nothing is on until there are two.** An install with no `accounts` behaves exactly as
it did before they existed — every predicate answers "in scope", and the menu simply
draws `me` under **Switch account**. One account owns everything unless it says
otherwise, so the *first* one changes nothing but that line. Adding a second is what separates anything —
and adding it through the picker writes both: the account you typed, and the one it
implies, owning every workspace you did not give away. A config with one account and
eight unclaimed repos is not a state the ＋ can leave you in, because those repos would
be visible from nowhere.

**It is a view scope and not a credential**, deliberately. Switching is one tap with no
sign-in, and the pairing token still reaches everything — it has to, because an ntfy
action button, the Android app and `bin/router.js` all call this daemon with no browser
anywhere in them. What an account changes is what a *screen* is handed. If you want a
real boundary, that is Google sign-in and per-device revocation, which is a different
mechanism and lives in [Signing in with Google](integrations.md#signing-in-with-google).

**Which account you are in is stored on the server**, in `state.json`, beside the inbox
filter and for the same two reasons: the push path reads it from inside the poll with no
client in the loop, and one person with a phone and a laptop should not have two devices
disagreeing about which life they are in. Switching on the laptop switches the phone.

**A bead in the account you are not in goes quiet, and is never lost.** It is still
swept, still filed, still counted, and it is on the screen the second you switch — the
same contract a narrowed filter and a muted space already have. The log says which kind
of quiet it was, because the lever is different for each:

```
[beadcause] acme/cl-9x2 arrived quietly (outside Personal (you@gmail.com))
```

**And filing follows the account.** The address in the bar is the handle a bead you file
is stamped with — its owner label on a root, its addressee, the byline on a comment, the
handle a claim leases with. Before accounts, that was whichever address `me` happened to
list first, forever. Both addresses stay yours, so a question another machine addresses
to your other one still arrives here as yours; only what a *new* write is signed with
moves. See `accountHandles` in `lib/accounts.js`.

**The admin screen is deliberately not narrowed**, the same way it has no space picker:
it acts on the daemon rather than on a repo, and a page whose buttons reach every
workspace must not draw a chip implying otherwise. The chip is there — it is how you
switch from that page — but nothing on the page below it is filtered.

Which is exactly why **Trackers** lives there — the list of every workspace this Mac
reads, and the Retire button that takes one out of the space picker for good. Reaching
every workspace at once is what that control needs, and the page that cannot narrow is
the only page that can honestly offer it. See
[`workspaceDirs`](operations.md#where-a-workspace-lives-when-it-is-not-under-beads).

## Spaces — keeping work out of your evening

Workspaces can be grouped into **spaces**, and a space is defined by *when it may
interrupt you*:

```json
"spaces": [
  { "name": "Personal", "workspaces": ["notes", "sideproject"] },
  { "name": "Work", "workspaces": ["acme"],
    "quietHours": { "from": "18:00", "to": "09:00" },
    "quietDays": ["sat", "sun"],
    "ntfyDetail": "minimal",
    "autoDispatch": false,
    "autoEndorse": false,
    "autoMerge": false,
    "requireApproval": true }
]
```

A space is then one of the things you can pick in the **space picker** at the top of
every screen — see below.

**And it narrows the notifications, not just the view.** The filter is stored on the
server rather than per device, so the poller reads the same value the list is drawn
from: a bead outside what you are filtered to arrives without a push. It still files,
still counts, and turns up the moment you widen the filter — the same contract a
muted space gets, for the same reason. A filter that was only a view meant narrowing
to one workspace and still being buzzed about every other one. The log says which of
the two kinds of quiet it was, because one ends on a clock and the other ends when
you press **All**:

```
[beadcause] notes/nt-4kd arrived quietly (outside the inbox filter: Work / acme)
[beadcause] acme/cl-9x2 arrived quietly (Work is muted right now)
```

**And a workspace rings once for a batch, not once per question.** After a workspace
rings, it stays silent for a *settle window* — `questions.settleMinutes`, ten by default
— and anything that arrives inside the window is *held*: it files, it counts, the inbox
shows it, and the log says so. When the window lapses, everything held for that workspace
goes out as one ring: one ntfy push listing them, and on the Android app one buzz with the
rest filed silently into the same stacked card. A lone question in a quiet period still
rings on the tick it arrives, buttons and all, because the window only opens *after* a
ring — so a first question is never late and a second is never more than one window
late. This is the rule that turned a day of thirty separate buzzes about one repo into a
handful (bc-obhx3, lib/held.js). A batch carries no action buttons: a button on a single
question answers and closes a bead from the lock screen, and three buttons over five
questions would be a thumb answering one with another's label. Foundation requests are
never batched. `0` turns it off.

```
[beadcause] example-app/ex-x7 arrived — held, example-app rang 3 min ago; it rings again in 7 min
[beadcause] pushed 4 questions in example-app as one ring — ex-x7, ex-m2, ex-k9, ex-p1
```

There is a third, one level up: a bead in the account you are not in — see
[Accounts](#accounts--one-life-at-a-time). It is tested *before* the filter, because
widening the filter cannot reach it; the picker does not offer the other account's repos
at all, so calling it "filtered" would send you to press a button that cannot bring it
back.

**One channel is exempt: a foundation request is never quietened by the filter.** The
filter's two levels are space and workspace, and both answer "which of my lives is this
about" — a question an agent asking to change what it *is* has no answer to. The inbox
draws that channel above the list and outside every filter on it, so honouring the
filter in the push meant a request sitting visible on the screen and silent on the
phone, with no widening left that would bring it back. A mute still quietens it: that
one is about whether anything may reach you right now, and an amendment has been
waiting for a session anyway.

### And the card says it too

A log line on the Mac is the wrong surface for a fact you need on a phone. So the two
kinds of quiet are written down at the arrival and drawn on the card itself, under the
pills and above the question:

```
┌──────────────────────────────────────────────┐
│  SORREL   sp-4kd   P2                 3h ago │
│  🔇 Arrived quietly 3h ago · hidden by the   │
│     inbox filter — Work / acme               │
│  Which way should the picker fall back?      │
└──────────────────────────────────────────────┘
```

Three properties, and each of them is the reason for a design decision in
`lib/hushed.js`:

- **It is recorded, not recomputed.** Asking `quietReasonFor` again at render time
  answers a different question — *would this bead be quiet now* — and for the filtered
  half the answer is always no, because you can only be looking at the card if the
  filter is wide enough to show it. For the muted half it would change its mind at
  09:00 having changed nothing. So the poller writes `{ reason, at, space, filter }`
  under `quiet` in `state.json`, keyed `workspace/id`, and that is what the card reads.
- **It leads with *when*.** Widen the filter and everything it was hiding appears at
  once, ordered by priority, indistinguishable from four questions that landed while
  you were reaching for the chip. "Arrived quietly 3h ago" is what says otherwise.
- **The filter is quoted as it stood.** By the time you read the line the filter has
  moved — that is the point of having widened it — so a live read would name the filter
  that is showing you the card rather than the one that hid it.

A bead that rang carries nothing at all: `arrivedQuiet` is null, the card is exactly
what it always was, and a record whose `reason` this version cannot name reads as no
record rather than as an unexplained "this was quiet". The record is pruned when the
bead leaves the inbox, like `ringing` and unlike `answered` — it exists only to draw a
card that is on screen. Replies are deliberately not recorded: a reply is quiet on the
same terms as the bead it is on, but this line says *how this card got here*, and a
quiet reply onto a card you were already shown loudly is not that.

The line reads whatever `quietReasonFor` answered, which is what keeps it honest about
the exemption above without knowing it exists: a foundation request can only ever say
*was muted*, because the filter is not allowed to have been the reason.

`node test/quietcard.mjs` (part of `npm test`) covers it, and the check that earns the
suite is the last one: it narrows the filter, lets a bead arrive quietly under it,
widens the filter, and asserts the card still says it was hidden by `Work` — which is
the assertion that fails the moment somebody replaces the record with a live read.

### One space at a time — the picker in the top bar

Beadcause reads every workspace under `~/beads/`, which in practice is every repo you
have. That is right for a notification daemon and wrong for a screen: six repos of
questions, advocates, pull requests and chats interleaved by priority is a list where
the thing you are doing this hour sits three rows below something you will not touch
for a month, and no sorting fixes it, because every one of those rows is legitimately
live.

So there is **one dropdown, in the top bar of every standing view**, and what it
selects is what the whole app is about:

```
┌──────────────────────────────────────────────┐
│  ●  ▣⚙   [ beadcause             ▾ ]         │
└──────────────────────────────────────────────┘
     Personal ─┬─ Personal — all
               ├─   beadcause
               ├─   sorrel
               └─   loremia
     Northwind ─── Northwind — all
                   northwind
     All spaces
```

**It is on the mark's row, and it is narrow.** It had a full-width row of its own until
bc-khoe.5 — the first row was full at four icon buttons, so 43px of every screen went on
a second row of chrome. Those buttons are rows in the mark's menu now, so the picker came
up beside it, and it pays for the fit with its *label*: the control is capped at 130px and
a name that does not fit is ellipsised. Only the bar. Every row in the dropdown is the
whole name, because the list is what you are choosing *from* and two repos sharing their
first nine characters would be one row printed twice.

The cut is affordable for the same reason the row was not: what the picker has to say is
*where you are*, and `northwind-pl…` still says it while `beadcause` — nine characters, the
common case — is not cut at all. `scripts/topbar-check.mjs` measures both halves and
fails the repo if the bar ever needs a second row again.

**The control is the `<select>` itself, and that is a correctness decision as much as a
visual one.** It was three boxes until bc-ka5y.34: a span holding the cut-down label, the
caret, and the select laid over both of them invisibly, because a native select draws its
selected option whole and `northwind-platform` on that row is a bar with nothing left on
it. The span was a *second* reading of the selection, written by a repaint — and the value
under it is moved by the browser, on the pick itself and on a form restore after a back
navigation. Two readings and one writer is a control that can contradict itself, and it
did: the bar said one repo while the dropdown held another, until the page was reloaded
(bc-ka5y.32). There is one reading now and the browser keeps it in step, so the bug is not
fixed a second time, it is unavailable.

The width constraint moved into the stylesheet rather than going away: `max-width: 130px`
with `overflow: hidden` and `text-overflow: ellipsis` on `.spacepick select`, so the cut is
made by the layout at whatever the font actually measures rather than by a character count
in a script — and the option list is untouched. The cap has to be a number rather than a
percentage, because **a select is sized by its widest option and not by its selected one**:
left to grow, having `northwind-platform` somewhere in the list makes it a 170px box on a
day you are looking at `ehden`. 130px is what the twelve characters it replaced measured
at, so the row's arithmetic is the one bc-khoe.5 spent.

**A title beside it has to name the page and not the space, which is the whole of what
the picker being there costs.** `/monitor` was *the details of the selected space*, so a
heading reading `Space` sat immediately left of a control reading `Personal` — the noun
and its instance, twice, on the row where a 360px phone has the least to spare. That
heading was dropped outright (bc-mtdb), leaving the mark, the picker and the page's own
tally. It is back as one word the picker never says: bc-khoe.10 moved the settings to
`/config`, so what is left on that page is the advocates and their sessions, and the
heading reads `Advocates` — the same word as the pill that opens it. The other standing
views never had the problem — Ledger, Endorse, Requirements and Config name the *page*,
which is not what the picker says, so nothing on them is doubled.

Pick `beadcause` and it is beadcause's questions in the inbox, beadcause's advocate on
the advocate console, beadcause's pull requests on the board, beadcause's chats in the
launcher and beadcause's agents on the foundations screen. Nothing else, anywhere. A
border in the accent colour is on the picker whenever something is being kept off the
screen, because an app that looks identical showing you everything and showing you one
sixth of it is an app you eventually stop trusting.

**Both levels are offered, because both are things you mean.** "Northwind, all of it"
is a workday; "beadcause" is an hour. Each space's repos are listed under it, so the
dropdown reads as the hierarchy it is, and a workspace in no configured space appears
under `Other` — the same synthetic name the space row always used for it. Every
configured repo gets a row whether or not anything is waiting in it: the picker is how
you *reach* a quiet repo, and a list of only the noisy ones is one you cannot use to
change the subject.

**This replaced four separate controls.** The inbox had a space chip row and a
workspace chip row; the chat launcher had its own repo tab bar with its own
localStorage key; the foundations screen had a 📁 button that cycled workspaces; the PR
board and the advocate console had nothing at all and showed you everything. Four
states for one intention, so switching context meant setting the same thing in four
places and still having two screens ignore you. Two of those controls survive as
*faces* of the picker rather than copies of it — the launcher's repo tabs and the
foundations 📁 write the same server-owned filter, so a tap on either moves the bar
above it and every other page with it.

**The selection is the server's, and it is the same value that decides whether your
phone rings** (`POST /api/filter`, stored in `state.json`) — which is exactly what the
section above describes, and it has not changed: a bead outside the selection arrives
without a push, still files, still counts, and comes back the moment you widen. Two
consequences worth knowing:

- **Narrowing on the laptop narrows the phone.** One person with two devices should not
  have them disagreeing about what they are working on.
- **`All spaces` is still the default, and nothing narrows it for you.** A picker that
  defaulted to one repo would silence five others for somebody who had never touched
  it, and a question you were never told about is the failure this app exists to
  prevent. Narrowing is a decision you make.

The admin page deliberately has no picker: it is the one screen that acts on every repo
at once, and a control it ignored would be a lie about what its buttons do.

`GET /api/spaces` is what the four pages that never sweep the tracker draw the picker
from — the spaces, the configured workspaces and the stored filter. It costs no `bd`
call at all: the spaces are cached off the last sweep, so a control drawn on every page
load cannot become a `bd human list` across every workspace on every page load. A page
that *does* sweep feeds the bar from its own payload instead; `adopt()` records what a
page has published and the `/api/spaces` reply is adopted **weakly**, field by field,
yielding to anything a page already said — because that fetch is sent before the page's
script runs and its reply lands after.

**The picker draws no numbers, and that is the fix rather than the omission.** It used
to carry three: a pill beside it, a `· N` tail on every repo row, and a total on each
space. They read as a small thing and were not — the inbox printed "Nothing live" with a
non-zero count in the bar directly above it, because a count had two sources and no rule
about which won. The rules that settled that argument (one `counts` map, the drawing
page owns it, count what `render()` drew) worked, and were still a standing obligation
on every page that had a list: keep a second copy of your own list's size in step with
it, on every tap that fetches nothing, for ever. bc-ka5y.1 took the numbers out instead,
along with the `counts` map, the `⚠` that marked a sum taken over a sweep with a hole in
it, and the `counts` and `waiting` fields on `/api/spaces`. What the picker says now is
*where you are*, which is a question about the config and cannot drift from anything.

The check that earns the suite is still the one nobody can do by reading: the client's
`matches()` and the server's `matchesFilter()` are run against each other over every
combination of filter and workspace, because those two disagreeing in the direction
"rings but is not shown" is a question you were told about and cannot find.

#### The tap that used to undo itself

Picking a repo wrote it to the server and then, sometimes, the picker snapped back to
what was there before and every list under it re-filtered to the old repo. Intermittent,
never on the tap you were watching for it, and it needed a specific ordering: a poll that
was **already out when you tapped**.

The guard that existed covers the payload that lands *during* the write. Every page skips
adopting a filter while `space.writing()` is true, because that payload was assembled
before the tap. What it cannot see is the poll that went out before the tap and is
answered *after* the POST has resolved — `writing()` is false again by then, the payload
carries the pre-tap filter, and adopting it is a repaint of the bar plus a notification to
every page to go back where it was. The write succeeded; the screen said otherwise.

The fix is one note in `public/spacebar.js` rather than a change at five call sites. A
pick remembers the value it replaced, and while that note stands an adopted filter equal
to *that exact value* is refused, because nothing but a payload older than the tap can be
carrying it. Everything else clears the note as it arrives: our own value echoed back (the
server has caught up), a third value (somebody moved it after the tap, which is newer than
the tap), a failed write (nothing landed, so there is nothing to defend), or the bound
passing. In practice the note is gone on the first poll after the write, and the bound is
only a backstop.

The cost is real and is stated rather than dodged: a deliberate switch **back** to the
value you just replaced, made on the laptop inside that window, is ignored on the phone
until the note clears. That is the trade against the alternative — a generation counter
stamped on every fetch, which is correct in every ordering and costs a change at every
page that polls, including the ones written next year. `PENDING_MS` bounds the wrong
answer at 30 seconds; a missed call site would not have been bounded at all.

One ordering is still open and is named in the source rather than hidden: tapping straight
back to where you started — A, then B, then A — makes a payload carrying A
indistinguishable from the echo of the second write, so the note clears and a payload
still carrying B can land. It needs two taps and two polls inside about a second, and the
only way to close it is a note that never clears on an echo, which would charge every
cross-device change the full 30 seconds instead of one poll.

Refusing a filter is not the same as ignoring it. The page that handed it over has very
likely already mirrored it into its own state — `public/app.js` keeps `state.space` for a
dozen readers — so the refusal notifies with what is *actually* selected, and the mirror
is corrected in the same tick. Without that the bar would be right and the list beneath it
wrong, which is a worse bug than the one being fixed. `test/spacebar.mjs` covers both
orderings, the echo, the bound and the failed write against the real file in a vm.

#### The label that kept the old space

Reported from the phone: change the space and the label immediately left of the `▾` goes
on naming the last one, and stays wrong until the page is reloaded.

One selection is drawn **four** times over — the span the bar fills, the `<select>`'s
value, its `title`, and whatever the page under the bar filtered itself to — and only
three of those were ever written by a line of code. The value rode along inside the
markup, as a `selected` attribute on one of the rows `paint()` builds, and the rebuild
that carries it is guarded: rows identical to the ones last written are not assigned
again, because rebuilding a `<select>` under an open native dropdown, on a phone, is a
wheel that shuts itself.

That guard is right and the coupling was wrong, because this control is not only written
to. **A browser moves a `<select>`'s value with no code involved** — on the pick itself,
and again when a form is restored after a back navigation. So a value that moved without a
`change` reaching `public/spacebar.js` was never put back by anything: not by the next
payload, and not even by one that rebuilt every row, since identical rows are exactly the
case the guard skips. The label said one repo, the dropdown held another, and only a reload
settled it.

The selection is said to the control now — one assignment, and only when the two
disagree, which is the same shape as the label and the title beside it and for the same
reason: agreeing is the normal case.

**Which needs the selection to have a row at all.** The filter outlives the config it was
picked under — it sits in `state.json` across restarts and reconfigurations — so a space
renamed in the config file, or a repo retired from `/admin`, leaves the picker pinned to a
name the next payload does not carry. A `<select>` whose value matches no option shows its
*first*, so the bar read **All spaces** over a list that was still narrowed to the repo the
label named: the control contradicting itself about the one thing it is for. bc-qid8b drew
the `Other — all` row for exactly this reason, and `Other` was never the only name the
list can lose, so a pin nothing else offers gets a row of its own reading `sideproject — gone`.
It says so rather than quietly widening: `matches()` and the server's `matchesFilter()` are
both still answering for that pin, so a row reading plainly `sideproject` would be a second lie
— and widening the filter is not this file's decision to make. The daemon reconciles a
stale pin on the way out (`reconcileFilter`), and the inbox reconciles its own mirror on its
next payload; until one of them does, this is where you can see why the list is empty and
pick your way out of it.

The half that matters is the half `node:vm` cannot hold: test/spacebar.mjs's `<select>` is
an object whose value is whatever the check last assigned, so it agrees by construction.
`scripts/space-check.mjs` asserts the whole of it in a real browser, on a real pick — the
label, the value, the title and the card all naming one space, in the same turn and again
after the page has handed the picker its next payload.

#### The row it cost, and why it no longer costs one

The picker had a full-width row of its own until bc-khoe.5, so six pages carried two rows
of pinned chrome where they had carried one. On a phone that is worth arguing about, so it
was measured instead: at 360×640 the row was **43px** — a 31px control and the bar's 12px
gap — taking the bar from 61px to 104px and the bar plus the navigation from 116px to
159px, 18% of the screen to **25%**. (The navigation was a 54px bar along the bottom when
those numbers were taken; bc-khoe.1 replaced it with the 53px
[pill row](navigating.md#getting-around--the-pill-row) under the top bar, so the totals below are a
pixel smaller than they read. The argument is the same one either way.)

It kept that row for a year of decisions, and the reason was arithmetic rather than taste:
the first row was full. Three ways round it were tried against the real pages and all three
broke something. **Collapsing onto the first row where it fits** (`flex: 1 1 <basis>`,
letting wrapping decide) made the picker a full-width control on some tabs and a narrow or
missing one on others, which is the four-controls-in-one-coat the picker replaced — and a
control that moves on one page in six is a control you stop looking for. **Hiding it on
scroll down** means a fixed, translated header on six pages, because a sticky bar that
shrinks mid-scroll moves every card up 43px under your thumb, and the row is back the
moment you scroll up, which is when you were reading it. **Folding it into the mark** paid
with the picker's whole job: the repo name is exactly what does not fit, so what is left is
a control whose current value is invisible.

What bc-khoe.5 did is none of those. It **emptied the first row** rather than trying to fit
the picker past what was on it. The loose icon buttons — up to four of them, 128px at
360px — are rows in the mark's menu; the account chip's address is a line inside that menu;
and what is left up there is a 26px mark in a gear. The picker moved up beside it, and the
one thing it gives up is *width*: the control is capped at 130px and a longer name is
ellipsised inside it, while every row in the dropdown stays whole.

That is the trade the old arithmetic refused, and the reason it is affordable now is that
the value is still on screen. `beadcause` — nine characters, and the common case — is not
cut at all; `northwind-pl…` still says which one; and the accent border says something is
being kept off the screen either way. Measured after: the bar is **one line on every page
at both widths**, and the bar plus the pill row is **108px** against the 159px the two of
them replaced. The narrowest margin left on the row is **20px**, on `/foundations`. That
number used to read 31px, and the 11px is not room bc-ka5y.34 spent: a select is sized by
its widest option, so the picker is at its cap on every page rather than only on the pages
where a long repo happens to be selected, and 20px is what the old worst case always was.

The one cost worth naming separately is **refresh**. It was the last icon left loose in the
bar, deliberately, because it is the most-pressed control in the app and the least worth two
taps. It went into the menu with the rest, because a single icon floating between the mark
and the picker is the shape being got rid of, and it is two taps now.

`node scripts/topbar-check.mjs [--out=DIR]` is what stops this being decided once and
forgotten — and it is where those numbers come from. Two widths, every page with a picker:
the bar is **exactly one line**, the picker is on it and sharing it, the control is inside
its **130px** cap, the two declarations that do the cutting are still in force on it
(`max-width`, and a `text-overflow: ellipsis` that an overflow of `hidden` or `clip` makes
apply), a name that fits is drawn whole, the control's `title` is the whole name, every row
in the dropdown is a whole name, and the bar plus the pill row stays inside a **170px**
budget.

Then it picks, through the control itself, the **longest** workspace in the fixture — the
bar is still one line, the box is still 130px, the name is ellipsised inside it rather than
the box widened, the row and the title are still whole, and the narrowed accent is on the
control — and then the **shortest**, with the long one still in the list, which is the state
an uncapped select is over budget in while looking perfectly fine on screen. It tabs to the
picker with a real key press and reads the focus ring off it, because `:focus-visible` is a
heuristic about how the focus arrived and a scripted `.focus()` does not match it. The
fixture carries one deliberately over-length repo name throughout: every real workspace on
this Mac is nine or ten characters, so a fixture built from them would never once exercise
the cap.

It also prints, per page, how much of the row is left once the brand has taken its share,
and says so when any page is inside 24px of it. That is the same arithmetic bc-hne3 turned
on, pointed the other way: what would push the picker back off the row is a page growing
its *title*, and that is the half nobody measures on purpose.

The fifth thing it asserts is not about the bar at all, and it is there because measuring
the bar is what found it: **the page has to fit the screen**. Every number above is a
width compared against 360 or 393, and if anything on the page lays out wider than the
body then the browser has shrink-fitted the whole document and none of those numbers is
in the same unit as the screen any more. `/monitor` was 376px at 360 — `nav#mon-tabs`
carried `margin: -18px -16px 14px`, which on the agents' page cancels `.launcher`'s
`18px 16px` padding but here has an unpadded `<body>` to cancel and so simply pushed the
strip past both edges. The symptom was not a scrollbar. It was the advocate console drawn
at **96%**, draggable sideways by 16px, with the strip's first chip starting 2px off the
left of the screen and the bottom bar's last label cut in half — which reads as a
font being slightly wrong rather than as a layout bug, and sat there unnoticed until a
check printed the number (bc-3ui6).

The sixth is that **the chrome does not move when you scroll**, and it used to be a
narrower question. The bar was `position: sticky` at z-index 20, so a second sticky box
pinning at `top: 0` pinned itself behind it and was gone from the first scroll onwards —
`/monitor`'s Advocates/PRs/Mirror strip did exactly that, carrying the whole cost of being
sticky for none of the benefit (bc-ugd4). The fix at the time was to offset it by
`var(--topbar-h)`, a number `public/montabs.js` published off a `ResizeObserver` on the
bar, because the bar's height is a fact about the payload: 104px with the picker's row and
61px without it.

[The app shell](navigating.md#every-page-is-an-app-shell-not-a-document) removed the question rather
than the number. Nothing is sticky any more — the bar and the pill row are rows of a flex
column above the one element that scrolls — so the check now appends a spacer *inside that
element*, scrolls it, and requires both rows to be in exactly the same place afterwards and
the document not to have moved at all. A box still pinning itself to the window is reported
as its own failure, because that is how the old bug gets back in. `/monitor` is measured a
second time with one workspace, in the shorter bar, because the two heights are still the
two states this ships in and the pill row has to sit against the bar in both.

### ＋ Add a bead-space — the last row of the picker

Everything else about a tracker can be done from a phone: mute it, set its quiet hours,
decide whether an agent may answer a comment in it unasked, retire it when the project is
over. The one thing that could not was **having** one. A new repo meant opening
`~/.config/beadcause/config.json` in an editor, writing a `workspaceDirs` entry, and
restarting the backend — on the Mac, which is the single device this app exists so you do
not need.

So the picker has a last row, under every group, and it is the only row in it that is not a
place to go. It opens a dialog (`public/addspace.js`) that takes **a path on the Mac** or **a
git URL**, and a `Clone to` field prefilled with `<projectRoot>/<repo>` — editable, because a
repo that belongs somewhere else should cost a line of typing rather than a config edit.

**Three words, because two of them used to be one word.** `space` and `workspace` are a
syllable apart, mean nothing like each other, and on a four-inch screen that is not a
distinction anybody makes correctly. Everywhere a person reads:

| word | what it is | in the config |
|---|---|---|
| **group** | "Personal", "Northwind" — a name, a list, quiet hours, and the answer to *when may this reach me* | `spaces` |
| **bead-space** | one tracker: one `.beads`, one Dolt database, one id prefix (`bc-`, `sp-`) | `workspaces` |
| **bead-repo** | a checkout attached to a bead-space — forty Northwind services filing into one `cl-` graph | `repos.<ws>.approved` |

The config keys and every identifier under `lib/` still say the old words, deliberately:
renaming a key is a migration and renaming an identifier is a sweep of forty files, and
neither belongs in the same diff as a new button. That is bc-35qub.

**It asks after it looks, never before.** A directory either has a `.beads` or it does not,
and that is not a question to put to a person — they mostly do not know, and the directory
always does. So the first round resolves or clones, inspects, and finishes on the spot in
the common case. Only when there is no tracker does it come back with the one question that
cannot be looked up: a graph of its own, or beads filed into a bead-space that already
exists — with the list to choose from. The second round always arrives as a **path**, never
the URL again, because by then the clone has happened and re-sending the URL would make the
server decide whether the directory it finds is the one it just made or somebody else's
checkout of the same name.

**The refusals are the feature**, and they live in `lib/newspace.js` where the suite can
reach them without a server:

- **a relative path**, refused on the raw text and not after `expandHome` — that function
  ends in `path.resolve`, so a check made after it can never fail, and `projects/example-app`
  would come back as `/projects/example-app` resolved against the daemon's working directory,
  which under launchd is `/`;
- **a clone onto something**, refused before `git` is spawned at all;
- **a name already served**, because the name is the key for `sessionDirs`, `jira`,
  `advocates.perWorkspace` and every group's list, so two trackers sharing one would
  silently share all of them — and **a name you retired**, refused with the word *Restore*
  in it rather than added a second time over the top of the retirement;
- **a prefix another tracker already mints**, because every screen in this app addresses
  beads by id and two graphs both minting `bc-` makes an id ambiguous;
- and the expensive one: **a clone carrying `refs/dolt/data`**, which is a team tracker
  nobody has bootstrapped yet. `bd bootstrap` will not clone over a database that exists,
  so a `bd init` there means the team's history can never arrive and every later
  `bd dolt pull` meets two unrelated histories — the one outcome `lib/sync.js` says never
  retries its way out, and the reason the install order is *bootstrap before the workspace
  has ever been written to*. The choice is withheld rather than drawn and then refused, and
  the sentence says `npm run onboard`.

**Every add and every link ends by asking which of its epics are yours** (bc-9i62w). The
epic board and the Epic Advocate are both keyed off the `owner:` label, so a tracker whose
epics nobody owns is one the app can show you and do nothing with. The moment it arrives is
the one moment all of its epics are new to you at once, so that is when the dialog asks.
It lists the bead-space's open epics and P0s (for a bead-repo, the ones in the bead-space
it was attached to), and each row has two boxes:

- **Mine** puts your `owner:` label on it;
- **Advocate** also opens an Epic Advocate on it now, and ticks Mine with it, because an
  advocate answers to its owner.

**None of them is the default and a real answer.** Nothing is ticked, and the button says
*None of them* until something is. What is already true is drawn ticked and fixed. An epic
an advocate would be refused on (unendorsed, superseded, paused) says why rather than
offering a box that fails. Opening an advocate means a window, not just the label:
`lib/reenter.js` treats an enrolled epic it has never seen as a silent first sight, so a
label alone would wait for a child to move before anything looked at the epic. A tracker
with no epics yet, and a Mac with no `me`, say so and close rather than asking.

**A tracker it makes goes in the container root and never in the checkout.** This is
`bd-newws` as a function, and the two things it does that a bare `bd init` does not are the
whole reason it is not a bare `bd init`: `--skip-agents`, because `bd init` writes
`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/` and `.codex/` into the current directory
and inside a checkout that overwrites the repo's own instructions; and running from the
tracker directory with `BEADS_DIR` set, so those files could not land in a checkout even if
the flag stopped working.

**Nothing is rolled back on a cancel.** If a clone has happened, the directory stays and the
message says where it is. Something was fetched from a network onto a disk, and deleting a
tree to tidy up a dialog is not a thing a daemon should do behind a dismissed sheet.

**It writes in all three places, in the order Retire already established** — the pin (or
deliberately no pin: a tracker a root already reaches is left unpinned, because pinning one
freezes it so that renaming its directory drops the bead-space instead of moving it),
`cfg.workspaces` for what this tick serves, and the live `workspaces` Map for the routes
that resolve one repo by name. So a bead-space added from a phone is being swept before the
dialog closes, and no restart is owed.

**And the bar draws where it used to hide.** The picker hid itself below two workspaces —
one repo and one space is nothing to pick between. It is a choice now, and the install with
one tracker, or with none, is precisely the one that needs the row.

### Space details — every setting a space has, on a page of its own

Every setting a space has is one you used to change by opening `~/.config/beadcause/config.json`
in an editor, on the Mac, with the daemon running. That was fine while a space was two
lines of quiet hours written once. It stopped being fine when a space became the unit
that decides whether an unattended agent may answer a comment (`autoDispatch`), whether a
bead an agent filed may be worked before you have read it (`autoEndorse`), whether a
a delivery is merged without asking you (`autoMerge`, `requireApproval`),
and whether that merge then deploys itself (`autoShip`) — because the moment you know one
of those is set wrong is the moment you are looking at what it did, on a phone, at the
weekend.

So a space's settings are **`/config`**, a standing view with a pill of its own — the
ninth on the row, and the rightmost, because it is the one you reach least often:

```
┌──────────────────────────────────────────────┐
│  ●  ▣⚙   [ Personal    ▾ ]  Config      ⟳    │
├──────────────────────────────────────────────┤
│ …       📣 Advocates  🚀 Releases  🎛 Config │
├──────────────────────────────────────────────┤
│  Personal                    may reach you   │
│  ▾ SETTINGS                                  │
│      Muted                             off   │
│      Quiet hours              18:00 → 09:00  │
│      Quiet days                     sat, sun │
│      Push detail             inherited · full│
│      Slack channel                C0123456789│
│      Slack detail            inherited · full│
│      Agents may answer unasked          off  │
│      Beads agents file arrive endorsed   on  │
│      Workers merge their own PRs         on  │
│      An approving review first  inherited·off│
│      Merges ship themselves              on  │
│  ▾ WHAT EACH REPO RESOLVES TO            3   │
│      beadcause  full push · files endorsed…  │
│      Beads agents file here  On Off Inh(off) │
└──────────────────────────────────────────────┘
```

**It took two moves to get here and the second is the one that matters.** The card was
drawn *above* the advocate cards for a year, on the argument that `/monitor` is the
details of a space and this is what a space *is* — and what that meant in practice is
that the pane you open to see what is running this minute opened on eleven switches and a
row per repo, with the first advocate below the fold of a phone. bc-me2b moved it to a
**Config** chip on that page's own row, which fixed the fold. bc-khoe.10 took it off the
page: a chip fixed *where on the console* the settings were and left standing the reason
they should not be on the console at all, which is that "what this space is" and "what
this space is doing" are two questions, and the second is a screen you watch while the
first is a screen you visit. The pill row is how everything else in this app is reached,
and this is now reached the same way. `spaceHtml` still has not changed; only which
document draws it has, twice.

**It is the cheapest standing view in the app.** `/api/space` is a read of the config
object the daemon is already holding — no `bd`, no `gh`, no disk — where the console's own
payload is two `bd` calls per workspace and the board's is a `gh` call per repo. So this
page fetches one thing, once, and again when the picker moves; it parks no `/api/poll` and
runs no clock (`public/history.js`'s reason: its one request carries the picker's
selection, so there is no constant path for `public/warm.js` to fill and nothing a wake
could say that the ⟳ does not). Which also means somebody who opened the app to change a
setting no longer sweeps every tracker on the Mac on the way.

Nothing the console already did has gone: the advocates and their pause, reclaim and
limit controls, the sessions view it absorbed (`/sessions`, `/work` and `/work.html`
still serve it), the proposal cards, the launchd and router health lines, [the mirror
pane](navigating.md#the-mirror--whatever-the-phone-has-open-with-room-to-read-it). What it has instead
is an advocate as the first thing under the health lines, which is what somebody opening
it came for — and its heading says **Advocates** again rather than **Space**, because the
one part of it that was a space's details is elsewhere.

**And it shows the repo you picked.** The picker has two levels (`Personal`, and
`beadcause` inside it) and this card only ever read the coarse one: pinning to `beadcause`
still drew every repo of Personal in *What each repo resolves to*, which reads as the
console answering a question about somebody else's config. The panel now draws the pinned
repo alone, and the heading says so — *What beadcause resolves to*. The settings above it
stay the whole space's, because they are: pinning the picker to one repo does not make
`quietHours` a property of that repo, and a card that redrew them as if it had would be
promising a narrowing the config cannot express. What narrows is the panel that is
per-repo already.

**Four shapes of control, and the shape is the shape of the answer.** `Muted` is
two-state, because there is no global mute behind it and a third button would be a
lie. Quiet hours and quiet days are a pair of clocks and a row of days, each clearable,
because "no quiet hours" is a state you have to be able to get back to. The seven with a
global default behind them — push detail, Slack detail, agents-may-answer,
filings-arrive-endorsed, auto-merge, approval-first, ships-itself — are **three**-state:
On, Off, and *Inherit*, which names what it currently resolves to. That third button is
not a nicety: `prPolicyFor` is explicit
that a space may override the global in *either* direction, so "off" and "following a
default that is currently off" are different answers, and only one of them survives the
default changing.

**The Slack channel is the fourth shape, and the only one you type.** A channel id is
free text rather than a choice, so the row is a field and three buttons: **Set** sends
what you typed, **Never** stores an empty string — this space stays out of Slack however
`slack.channel` is set — and **Inherit** deletes the key. Never and Inherit look
identical on the day you press them and come apart the day the global channel changes,
which is why both are there and why a blank field with *Set* pressed is refused rather
than guessed at. What you have typed is held in the page's own state until the press,
because this page repaints off a stream event rather than off your thumb and a
half-typed channel id living in the DOM would be taken away by a poll nobody asked
for.

**"What each repo resolves to" is the panel that stops the screen lying.** The space is
not the last word on three of these settings: `ntfy.minimalWorkspaces`,
`slack.excludeWorkspaces` and `autoDispatchExclude` are per-repo lists that outrank it,
so a space set to `full` can contain one repo that pushes minimally. The panel runs every
workspace in the space through the same resolvers the daemon itself uses and prints the
answers, because a screen showing only the space's own setting would be quietly wrong
about exactly the repo somebody had singled out — and wrong in the direction of promising
more detail on your phone than you are going to get.

**And the rows in that panel are controls.** Four settings are ones a space is the wrong
unit for — see
[One repo may answer for itself](#one-repo-may-answer-for-itself-on-the-six-settings-where-it-matters)
— so each repo carries four rows of three buttons under its tags: On, Off, and *Inherit*,
which names what the space resolves to. Whether its agents' filings arrive endorsed,
whether its workers merge their own pull requests, whether an approving review has to come
first, and whether the merge then ships itself. They went here rather than into four more
rows above because this is the line that already stated those answers for that repo and
had nothing to press. The tags stay beside them and are not made redundant by them: a tag
is the *resolved* answer, and the lit button says which of the three levels gave it.

**And a row in it is a workspace, which stopped being the same thing as a repo.** A
workspace with an [approved list of checkouts](config.md#many-repos-one-workspace--the-approved-list-and-the-token-that-names-each)
is forty repos of one org, so its row carries `12 checkouts, one answer` — because the
settings above it really are one answer for all of them
([why](config.md#policy-stays-per-space-even-when-a-workspace-is-forty-repos)), and a panel
counting that row as one repo understated the reach of every control on the card by the
size of the org. Only the checkouts that *resolved* are counted: one declaring no service
token can hold no bead, and `no checkout resolved` is its own state rather than a silence.

**A press changes the running daemon, not just the file.** `POST /api/space` patches
the space object inside the live `cfg` — the same object every push decision reads
through `quietReasonFor`, every delivery through `prPolicyFor`, every reply agent
through `autoDispatchAllowed` — and then writes `config.json` so it survives a restart.
Both halves, in that order. Sending one field per press rather than the whole object is
what stops a phone and a laptop, each a poll behind the other, putting back settings
neither of them touched.

**What it will not edit is a space's `name` or its `workspaces`.** Moving a repo
between spaces decides which questions are allowed to reach you at all; that stays a
config-file act, and the endpoint refuses those fields rather than dropping them
quietly. It refuses anything it does not understand, in fact, with the reason — a
setting silently ignored is precisely the failure this screen exists to end.

**And the ⚙ in the top bar goes to Admin** — pause everything, the in-app terminals,
sign out. It is a second way in from the one page whose per-space settings sit beside
it, not a replacement for the Admin tab: the two answer different questions, and
"stop everything" should still be a page you arrive at deliberately.

An observer instance may read all of this and press none of it, the same guard
`POST /api/admin` has and for the same reason: its `cfg` is the real daemon's config
file, so a write from here would change what the *other* process does at its next
restart while doing nothing at all about what it is doing now.

`node test/spacedetails.mjs` (part of `npm test`) holds the contract — that `null` and
`false` stay different answers, that a patch touches only what it names, that `name`
and `workspaces` are refused rather than dropped, that a write lands in the live `cfg`
*and* in `config.json`, and that the per-repo panel resolves through the lists which
outrank the space. `node scripts/space-check.mjs` is the other half and wants Chrome on
the machine: the real `public/monitor.js` in a phone-sized headless browser over a real
`bin/beadcause.js`, pressing the buttons and reading the config file back after each
one. It asks for a row per setting against `SETTINGS` in `lib/spaces.js` rather than
against a number, and reads each row's key off the control in it rather than off its
heading: a count in a check is a number that has to be moved every time a setting is
added, and the one there went stale the moment `autoShip` landed — greeting the next
person who ran it with a red they had to spend time proving was not theirs (bc-qda7).
`--shot <file.png>` writes a picture of the card with both panels open, which is the one
thing a list of ticks cannot tell you — whether a row per setting on a 393px screen
reads as a card or as a wall.

**And `node test/spacecard.mjs` asks the row-per-setting question without Chrome**, so
`npm test` catches it too. That check living only in the browser half was the reason the
staleness above went unnoticed for as long as it did: a check that wants Chrome is not in
`npm test`, so it is run by hand exactly when somebody has already touched the card —
which is precisely the case where nothing was forgotten. Adding a key to `SETTINGS` and
forgetting the row stayed green everywhere that runs automatically. This suite runs the
real `public/monitor.js` in a `node:vm` against a `/api/space` payload built by the real
`spaceDetail` — not a fixture typed out by hand, which would be free to be right about a
shape the endpoint does not serve — and reads each drawn row's key off its control by the
same three rules `space-check` uses, naming a setting with no row, a row writing a key the
server would refuse, and a row whose control this reader cannot read at all. It asserts
the same rows are drawn for a space that has set everything and for one that has set
nothing, because the fresh install is where a missing row is least visible: every control
is on Inherit and there is nothing on the card to look wrong. What is left to the browser
check is what a string cannot answer — that a press reaches `config.json`, and how the
card reads on a phone.

### And it does not tidy up the noise it already made

Narrowing the filter silences what comes *next*, and says nothing at all about the
notifications already sitting unread on the phone for the beads it has just hidden.
**Those stay unread, silently, until the filter is widened again.** Nothing asks about
them and nothing clears them.

That is a decision, not an omission. The inbox used to draw a pane when a filter change
excluded beads that were currently ringing — *3 unread notifications for beads this
filter hides*, with **Clear them** and **Leave them** — and bc-ka5y.1 deleted the whole
feature: the pane, the `dismissAsk` field on `/api/questions` and `/api/filter`, the
`POST /api/notifications/dismiss` endpoint behind it, and the `shadeSeen` /
`ringingDeclined` bookkeeping that existed only to stop it asking twice. What it bought
was never worth a standing pane above the list and a second write path to get wrong: the
beads it was about were open, unanswered and one widening away the whole time.

What survives is the `ringing` map itself — keyed `workspace/id`, one entry per bead
whose notification this daemon actually caused — because that is what lets a bead
leaving the inbox take its row in the tray with it. `node test/ringing.mjs` (part of
`npm test`) covers it, including the real poller, because the one line that records that
a bead rang is the easiest thing here to lose in a merge and the hardest to notice.
It also asserts the absence of all three of the things above, so none of them comes back
by accident.

**The honest limit, and the reason the pane could never have been much use anyway: an
ntfy notification already delivered cannot be recalled.** ntfy is a one-way relay and
the server has no handle on a message it has published. The only tray anything here can
act on is the Android shell's own, because that shell holds a live connection and
cancels on an event — so on an install where ntfy is the only surface there was nothing
to offer in the first place.

There is deliberately no in-app unread marker either. The badge counts beads that are
**open**, and a count that dropped would be claiming a decision nobody made.

**A quiet space is quiet, not hidden.** Its questions still arrive, still appear in
the list, still count towards the badge — they just don't light up your phone, and
the chip shows 🔕 so the silence is legible rather than looking like a fault. That
asymmetry is deliberate: an unwanted buzz is annoying, a question you never saw is a
real failure.

`muted: true` silences a space regardless of the clock. `quietHours` may cross
midnight (`18:00` → `09:00` is the normal case) and is evaluated in local time,
because "after six" means your evening. A malformed time disables the rule rather
than muting the space forever. `ntfyDetail` and `autoDispatch` set at space level
keep applying as you add workspaces to that space — which is exactly the drift that
otherwise leaks a work question onto a public relay. `slackChannel` and `slackDetail`
are the same answer for [the other delivery surface](integrations.md#slack--the-same-decision-in-a-channel),
and for the same reason.

**A space also decides who merges.** `autoMerge` and `requireApproval` are given here for
a group of repos, the way the two above are, and they are the two halves of
[landing work](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue) — but
unlike the two above, one repo inside the space
[may answer for itself](#one-repo-may-answer-for-itself-on-the-six-settings-where-it-matters):

| on a space | what it does |
|---|---|
| `"autoMerge": false` | workers there stop after opening the pull request, and the merge is your tap |
| `"autoMerge": true` | they land their own work, even where the global `pr.autoMerge` says off |
| `"requireApproval": true` | they land their own work *unless* the pull request has no approving review — a green, unapproved one becomes a card that says so |

The global `pr.*` is the **default** here, not a veto, and that is a deliberate
difference from `autoDispatch` — where `false` is a safety switch no space may argue
its way out of. Both of these are ordinary policy, and only a default a space can
override in either direction expresses the two setups that motivated it: on everywhere
except the shared repo, and off everywhere except the side project. A space that says
nothing inherits, and a config with no spaces at all behaves exactly as it always did.

**And a space decides whether the endorsement tap is a review or a formality.**
`autoEndorse: true` files the beads agents discover in that space *without* the
[`unendorsed` hold](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time): they are
ready work the moment they exist, an advocate queues them on its next tick, and you read
them afterwards instead of before. The case for it is the repo where the only reader of
the tracker is the person who would have pressed Endorse — there the tap is not a review,
it is a delay with a notification attached.

It is the one setting here that is **off unless you ask for it in as many words**
(`cfg.autoEndorse === true`, not `!== false`), because it is the only one whose worst case
is an unattended session on work nobody has read. Everything else on the bead is
unchanged: the P2 ceiling still applies, `agent-filed` still goes on, the
`discovered-from` edge still points back at the work that found it, and the bead's own
notes say plainly that nobody read it before it became workable. With the hold gone that
provenance is the whole of the audit, so it is not optional — `bd list --label
agent-filed` is how you see what arrived while you were asleep.

| on a space | what it does |
|---|---|
| `"autoEndorse": true` | discoveries filed there are ready work immediately, even where the global says no |
| `"autoEndorse": false` | they are held for your tap, even where the global says yes |
| unset | follows the global `autoEndorse`, which is `false` unless you changed it |

### One repo may answer for itself, on the six settings where it matters

Most of a space groups cleanly. "Don't buzz me about work at the weekend" and "post this
lot to that channel" are properties of a *set* of repos, and a space is that set — which
is why the settings above are, as `lib/spaces.js` puts it, ones you give once for a group
of repos rather than per repo.

Five of them are not like that, and the shape of a real config is what showed it. There
are two spaces here: **Personal**, holding `beadcause`, `loremia`, `ehden`, `sorrel` and
two more, and **Northwind**, holding one.

The hold was the first. The reason to stop holding in `beadcause` — I am the only reader
of that tracker, so the tap is not a review, it is a delay with a notification attached —
is a fact about *that tracker*. It is not true of the five repos sitting beside it, and
none of them moved. With the space as the finest thing that could answer, saying yes to
one meant saying yes to six.

The other four are the same argument applied to the sentence that costs more: **does
finished work land and go live without a tap.** `beadcause` is the one repo in that space
with a deploy this Mac can actually run, the one whose whole suite runs on GitHub against
every pull request, and the one nobody else reads — so it is the one where a worker
should merge its own work and the merge should ship itself. Saying that through the space
armed `loremia`, `ehden` and `sorrel` at the same time, which nobody had asked for.

The fourth of those is the newest and the sharpest example of why the grain matters:
`trustChecksAcrossDownmerge` turns on the queue [not waiting for a re-run after a clean
downmerge](landing.md#a-clean-downmerge-does-not-pay-for-the-gate-twice),
and whether that is safe is a fact about *one repo's CI* — specifically whether its test
job also runs on the base, so a bad pairing is caught there instead. It is also, as that
section explains, a setting **no repo here has on**: the arm it answers for only fires
where GitHub enforces up-to-date branches, which is a rule `NeanderthalMan/beadcause` does not
have. It is per-repo because the question is per-repo, not because anything is using it.

**One workspace, though, never one checkout inside one.** The overrides are keyed by
workspace, and a workspace is a beads graph — which is exactly the grain
[policy answers vary at](config.md#policy-stays-per-space-even-when-a-workspace-is-forty-repos):
who else reads this graph, and would they mind an agent working it unasked. So `northwind`
may answer for itself here like any other workspace, and still gives one answer for all
forty of its checkouts; nothing on this page lets one of them out of it.

So six settings have a per-workspace override, and each **outranks the space**, exactly
the way `ntfy.minimalWorkspaces` and `slack.excludeWorkspaces` already outrank it for
notification detail:

```json
"autoEndorsePerWorkspace":    { "beadcause": true, "sorrel": false },
"autoMergePerWorkspace":      { "beadcause": true },
"requireApprovalPerWorkspace": {},
"reviewRequiredPerWorkspace":  {},
"autoShipPerWorkspace":       { "beadcause": true },
"trustChecksAcrossDownmergePerWorkspace": {}
```

| for one workspace | `true` | `false` | absent |
|---|---|---|---|
| `autoEndorse` | its agents' discoveries are ready work immediately | they are held for your tap | follows the space, then the global |
| `autoMerge` | a delivery goes on the merge queue | every delivery hands you the pull request | ” |
| `requireApproval` | green checks are not enough — it needs an approving review | green checks are enough | ” |
| `reviewRequired` | nothing merges until [an agent has read the diff](landing.md#the-review-gate--nothing-reaches-the-merge-without-a-verdict) | the queue merges without anything reading it | ” |
| `autoShip` | its merges run its declared deploy without waiting for **Ship** | merges wait for the button | ” |
| `trustChecksAcrossDownmerge` | an already-passing pull request merges on the tick a clean downmerge goes in | every downmerge waits for the whole gate to run again | ” |

A boolean per repo rather than a list of names, because both directions have to be
sayable: a repo held inside a space that endorses is the same kind of exception as the
other way round, and a list can only ever say one of them. Keyed by workspace name like
`jira` and `advocates.perWorkspace`, and deliberately not a field on a `workspaces` entry
— that array is rediscovered under [`workspaceRoots`](config.md#where-trackers-live--workspaceroots-and-the-two-shapes-a-root-can-have) on every start, so anything written
onto it by hand is gone at the next restart.

**None of `autoMerge`, `requireApproval` or `autoShip` loosens a gate**, which is worth
being exact about, because "the worker ships its own work" and "the worker ships work
nobody checked" are one word apart. `autoMerge` decides who presses merge, never what
merge means: `bin/deliver.js` still waits for the pull request's checks, still refuses
over a red one or one that never reported, and still falls back to the question with the
reason written on it. `autoShip` only ever reaches a merge that is already on
`origin/main`, and the only ways to get there are that gated merge or your own thumb.
What these move is the tap, not the test.

**`trustChecksAcrossDownmerge` is the one that does move a test, and it is on this list
for that reason rather than in spite of it.** It does not skip the gate — the branch it
merges is one that already passed, and a branch that is anything but green takes the old
path and waits. What it declines to pay for is the *re-run* against the base that just
arrived, which is the run that would catch two branches breaking the base together. That
catch does not disappear; it moves to the push on the base, where the same job runs and
[a red base holds the whole queue](landing.md#when-main-itself-is-red--the-queue-holds-and-something-is-put-on-the-fix).
Whether that is a good trade is a fact about one repo's CI, which is exactly why it is a
per-repo answer and why it is off unless a repo says otherwise.

**Set them from the repo row**, on the space details card at
[`/monitor`](#space-details--every-setting-a-space-has-on-a-page-of-its-own): each row under
*What each repo resolves to* already stated the answers for that repo and had nothing to
press, so the buttons went where the answers were — four rows of three. On / Off /
**Inherit**, and Inherit names what it resolves to through the space — `Inherit (on)`
inside an endorsing space — so the button never promises the opposite of what pressing it
does. Repos in no space at all have no card, because `Other` is a group the picker offers
rather than a space; the overrides still work for them, from the config file.

Resolution is one path — `workspaceAnswer` in `lib/spaces.js`, which
`autoEndorseAllowed`, `prPolicyFor` and `autoShipAllowed` are now three names for — and
every caller goes through it: the card, `bin/file.js`, `bin/deliver.js`, the release queue
and the brief `lib/session.js` writes for a worker. Anything that is not a real boolean at
a level is not an override and falls through to the next one, so a hand-typed `"true"`
inherits rather than dropping a safety property. And a config from before this existed
answers exactly as it did: the maps are absent, so both remaining levels are the two that
were always there.

`npm run configure` walks you through it. Run it **in a terminal** — it needs one to
ask questions. Anywhere else (a pipe, CI, an agent shell) it prints the current
configuration and changes nothing, which also makes it a quick way to see what is
set.
