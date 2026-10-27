# Agents — what they are, what they remember, what they can see

## Who you are talking to

Commenting dispatches an agent to reply — and you choose which one. The answer box
says which, on a strip along its top edge: **Comment only → 💬 Answerer replies**. It
names the button as well as the agent, because the choice governs exactly one of the
two: a comment dispatches, and **Answer & close** spawns nobody.

The roster itself is behind the **⋯ at that strip's right-hand end** — chips for
every agent, ＋ to make one, the foundation of the one selected, and the allow-tools
checkbox. It used to be drawn in full every time a bead opened, which on a phone was
several centimetres of a control nearly every comment leaves alone, sitting between
the thread you had just read and the box you were about to type in. Folded, but not
hidden: which agent replies stays on the strip, and so does an armed tools override —
[that one is spent the moment you send](#allow-tools--for-one-comment-and-only-that-one),
so a shut panel must never leave the box looking ordinary. Choosing a chip repaints
the panel and nothing else, so it cannot eat a half-written comment. Escape closes
it and leaves the caret where it was.

The foundation of the selected agent is printed in the panel rather than left to the
name, because an agent whose brief you cannot read is a name you are guessing at.

`node scripts/agent-chooser-check.mjs` checks the fold and, more to the point, what
the fold must not hide: headless Chrome at phone size driving the real
`public/app.js` against a roster built by `lib/agents.js` and a question parsed by
`lib/decision.js`, so it never touches a bead. It asserts the thread runs into the
box with no chooser in between, that the ⋯ sits on the box's top-right corner and
says which agent replies without being opened, that the panel holds everything the
old block drew, that choosing a chip or arming tools keeps a half-typed comment and
leaves the panel open, that an armed override shows with the panel shut, and that
the trigger is labelled, `aria-expanded` flips, Escape closes it and the caret stays
in the box. `--baseline` serves `HEAD:public/app.js` and `HEAD:public/style.css`
instead of the working copy, which is how you tell a real failure from a flaky one —
baseline has no ⋯ at all, so it must fail. `--out=<dir>` writes a screenshot of the
box shut, the panel open and the armed state.

Four are built in, and they are the four shapes a comment on a decision actually
takes:

| | for |
|---|---|
| 💬 **Answerer** | do the thing the comment asks. The default, and what this used to be |
| 🔍 **Researcher** | answer from evidence in the repo — real paths, quoted lines, and the cases where the evidence contradicts the question |
| 🧨 **Critic** | argue the strongest case against whatever is being proposed, with the one condition that would change its mind |
| 📋 **Summariser** | hand back the decision still left in a thread that has gone on too long |

**＋ makes a new one from a name and a foundation** — a paragraph that goes in front
of the standard thread instructions. That is the whole definition: everything else is
shared. It is saved to `agents` in the config, so it survives restarts and can be
edited by hand later.

### Allow tools — for one comment, and only that one

An agent can be given more than the read-only allowlist, and it takes two separate
acts by design: **defining** the reach, and **using** it.

**Defining** it is a config-file edit, and only that. Give the agent a `tools`
string:

```json
"agents": [
  { "id": "critic", "tools": "Bash(bd show:*) Bash(bd comment:*) Bash(git log:*) Read Grep Glob Edit" }
]
```

An entry that names a built-in only overrides the fields it sets, so the line above
is the whole of giving the Critic edit rights — its name and foundation stay where
they are. Nothing in the app can write this string; there is no endpoint that accepts
one. A form on a lock screen is the wrong place to hand out edit rights.

**Using** it is a checkbox under the agent chips in the ⋯ panel, and it is spent by
the comment it rides on:

- **Off every time.** Arming applies to the **next reply only** and is dropped the
  moment the dispatch goes. Want tools on the comment after that? Tick it again.
  Nothing about it is persisted; restarting the daemon disarms everything.
- **A warning the first time, per agent.** The dialog names the tools verbatim —
  a warning that won't say what is being granted is theatre — and the acknowledgement
  is recorded per agent in `agentToolsAcknowledged`, because the content of the
  warning is *what this particular agent may now do*.
- **Not while it is answering.** Arming is refused with a 409 naming the bead:
  changing what a running agent may do is either meaningless or an attempt to widen
  it mid-flight.
- **Loud in the log.** Both the arming and the dispatch print the whole tools string
  to `~/Library/Logs/beadcause.log`, which is what makes an elevated run findable
  after the fact.
- **Visible with the panel shut.** An armed box says so on its strip — *⚠ with
  tools, this once* — and rings the ⋯ in the same amber, so pressing **Comment only**
  is never an elevation you had forgotten granting.

The elevated run is also told, in its prompt, that it is elevated deliberately for
one reply and should say in its comment exactly what it did with the reach.

**Tab stays inside the warning while it is up, and Escape means Cancel** (bc-ywiy).
It carries `role="dialog" aria-modal="true"` — which told a screen reader the roster
behind it was inert — but until now nothing kept a keyboard's Tab to the same claim,
so tabbing past either button walked straight back out into the panel underneath.
Focus opens on **Cancel** rather than on the button that grants the reach, so a
keyboard reader whose first press is Enter rather than a read of the warning gets the
safe outcome; closing either way — Cancel, Escape, the backdrop, or granting it — hands
the keyboard straight back to the checkbox that asked. The same fix is in
[the drawer](navigating.md#detail-opens-over-the-tab-not-instead-of-it) and the epic's full-tab, for
the same reason: all three are `aria-modal="true"` layers and none of them kept Tab
inside until bc-ywiy. `node scripts/focustrap-check.mjs` drives all three in one run,
because a Tab key is not something a string comparison can see.

### What a reply agent may do — and the four verbs it used to have by accident

The allowlist was `Bash(bd *)`, which is one pattern and four verbs too many: it
allowed `bd create`, `bd close`, `bd delete` and `bd label`. So the agent you chat
with could file beads without asking — the exact thing the [proposal
flow](advocates.md#it-will-not-create-beads) exists to prevent — and could close the very
question it was answering. It is now named subcommand by subcommand:

```
Bash(bd show:*) Bash(bd comments:*) Bash(bd comment:*) Bash(bd list:*)
Bash(bd ready:*) Bash(bd blocked:*) Bash(bd search:*) Bash(bd stats:*)
Bash(bd memories:*) Bash(bd dep tree:*) Bash(beadcause-memory:*) Read Grep Glob
WebSearch WebFetch Bash(beadcause-get:*) Bash(beadcause-browse:*)
```

Adding a verb there should feel like a decision, which is why they are listed rather
than globbed. The prompt says the same thing in words — answer, never close, never
create — but the allowlist is what makes it true. `test/lookup.mjs` asserts the list
grant by grant, so widening it fails a test named after the thing being widened.

#### The list has a file to itself, and the reason is not tidiness

It lives in `lib/toolbelt.js`, which is one array, one string derived from it, and no
imports at all. Two files need it: `lib/agents.js` exports it as part of the roster,
because what a reply agent may run is part of what a reply agent *is*, and
`lib/foundation.js` records the same list as the dispatch agent's `allowedTools`,
because an [amendment](#what-an-agent-is--and-how-it-asks-to-be-different) has to have
something to land on. Two copies of an allowlist is one copy that gets widened without
the other noticing, so there is one array and both files read it.

For a year the way they shared it was that `foundation.js` imported it from
`agents.js` — and `agents.js` imports `baseline` and `mark` back. A cycle in itself is
fine and there are four others here; what is not fine is a cycle where one side
*reads* the other's binding at module scope, because until a module's own body reaches
a `const` that `const` is in its temporal dead zone. So the graph had an entry order.
Come in through `foundation.js` and both loaded. Come in through `agents.js` and it
threw:

```
$ node -e "import('./lib/agents.js')"
ReferenceError: Cannot access 'DEFAULT_TOOL_LIST' before initialization
```

**Nothing in the running daemon was ever broken by it, and that is what made it
expensive.** Every real entry point happened to reach `foundation.js` first, so the
trap was only ever sprung by new code: adding an `import` of the roster to any module
`lib/server.js` reaches early moved `agents.js` ahead of `foundation.js` and killed the
daemon at boot, and `npm test` died at whichever suite first imported `server.js`,
naming a constant rather than a cycle. Nine test suites had quietly grown an
otherwise-unused `await import('lib/foundation.js')` at the top to force the order, the
reason was written down in none of them, and two sessions paid twenty minutes each to
work it out again (bc-u4na).

A leaf both sides import has no order to get wrong, so those nine imports are gone.
`node test/loadorder.mjs` is what keeps it that way: it imports every `lib/*.js` **in a
process of its own** — the only way to ask the question, since after the first import
the order is already decided — and fails on any module that only works second. Eighty-
five processes, eight at a time, about three seconds. It deliberately does *not* assert
that `lib/` is acyclic, because the cycles that remain are safe ones; the property worth
having is not "no cycles" but "no module that only loads second".

### Looking something up — and why it is not `Bash(curl:*)`

The last five entries are the difference between a question that turns on one
external fact getting answered and getting a comment saying it cannot be. Smallest
first:

- **`WebSearch` / `WebFetch`** — read-only by construction. An agent can pull a page
  and cite it and cannot POST anywhere. This is the grant to reach for.
- **`beadcause-get <url>`** — the bytes as served, for the content types WebFetch
  mangles on its way to prose: JSON, CSV, XML, a raw table.
- **`beadcause-browse <url>`** — a page that only exists once its JavaScript has run.
  The last resort, and rare: it costs a browser start-up, and the three above answer
  most questions. It earns its place because to *all* of them a page that assembles
  itself in the browser looks empty, and an agent cannot tell that from a page that
  genuinely says nothing.
- **`beadcause-confluence <page>`** — a page on the team's wiki, which is not a public
  URL and is behind a login every one of the four above reads as a login screen. It is
  the only one that carries a credential, so it is also the only one bounded by an
  allowlist you write yourself — see
  [reading a page in](integrations.md#reading-a-page-in--and-why-the-allowlist-is-empty-to-begin-with).

`Bash(curl:*)` was considered and refused, because the pattern does not mean what it
looks like it means: it matches `-X POST`, `-d`, `--upload-file`, and `-o` writing
anywhere on disk, and curl reads `file://` — a network grant that is quietly also an
unrestricted file read. `-X GET` alongside `-d` still sends a body, so "GET only"
cannot be a method flag either. So the allowlisted thing is a **wrapper**
(`bin/beadcause-get`, `lib/lookup.js`): the agent names a URL and cannot name a
method, a header, a body or an output file, because no code path here builds one.
It also refuses loopback and the private ranges — a laptop answers GETs on
`127.0.0.1` that it would not answer a stranger with — bounds redirects, caps the
read, and times the whole operation out.

What the wrapper cannot enforce is in the prompt instead, and it is the part that
matters for a number: **cite the source and the edition**, and say so plainly when
what you found is a *different* source from the one the question named. A fetched
value is not automatically a usable one. The same brief tells agents what they may
put in a URL, because a GET carries its query string to whoever is on the other end.

### Browsing — and why it is nobody's browser

The **live logged-in browser is not on the table**, and never was: driving Adam's
Chrome means acting as him on every site he is signed into, and the extension's
per-site permission prompt has nobody present to answer it at the hour these agents
run. So `beadcause-browse` launches its own Chrome, `--headless=new`, with a
`--user-data-dir` made by `mkdtemp` a moment earlier and deleted on the way out. No
cookies, no saved passwords, no extensions, no history, no identity — the same
capability with none of the authority.

That is one string on one line, which is exactly the problem: "reuse a warm profile,
pages load faster" is a reasonable-sounding optimisation that hands an unattended
agent every session on this machine, and it is invisible in a diff. So
`assertThrowawayProfile` in `lib/browse.js` sits between the argument and the
`spawn` and refuses anything that is not a fresh directory under the system temp
directory, and `test/browse.mjs` names the real profile paths it must refuse.

The rest is the same shape as the GET wrapper. There is no flag that runs
JavaScript, clicks, types, submits, logs in, sets a cookie or a header, or names an
output file — the agent names a URL and may say what to *wait for*, and cannot say
what to *do*. Every request **the page itself** makes is vetted too, not just the one
that was typed, because a page picks its own subresources and this laptop answers on
loopback with things it would not answer a stranger with. `--shot` takes no path: the
PNG lands in `.claude/shots/` under a generated name, because a flag that accepted
one would be an arbitrary file write with a picture in it.

Bounded in four places, since nobody is watching: a whole-operation deadline, a
character cap applied *inside the page* so a 50 MB document is never serialised
across the wire, a launch timeout, and a `finally` that kills Chrome and deletes the
profile on every path out — including the ones that throw.

The agent's reply is authored as `--actor <agent-id>`, so the thread says which one
answered, the phase chip says which one is thinking, and the reply poller still
notifies you exactly as before (anything not authored `beadcause` is an agent
talking back). A comment costs one model run: the Critic's reply on a real thread,
which read four files and quoted line numbers, was **98s and $0.85**.

## What an agent is — and how it asks to be different

An agent's definition used to be spread across four places that had nothing to do
with each other: a system prompt as a template literal in `lib/console.js`, an
allowlist as a bare string in `lib/dispatch.js`, a model buried in a config key, and
an environment derived implicitly from whichever directory the process was spawned
in. That was fine while the only reader was the code doing the spawning. It stops
working the moment an agent is allowed to *ask* to be different, because you cannot
request a change to something with no single form.

So `lib/foundation.js`: **one foundation per agent kind**, for all six of them — the chat
session, the comment answerer, the repo advocate, [the P0
advocate](advocates.md#what-a-p0-advocate-is--its-foundation-and-what-one-visit-consists-of), the merge
queue, and the worker session opened in iTerm. Read it to know what an agent may do; commit
a change to it to change what the agent is.

The line it draws is the important part. A foundation is what the agent is on **every**
run. The prompt handed to one invocation — this bead, this comment, this survey — is
what it was *asked* this time, and stays in the module that composes it. Only the
former is amendable: an agent that could rewrite the brief it was given for a task
could decide it had been asked something else.

**Two layers, and neither can clobber the other.**

- The **baseline** is in code, shipping with the release. Normal development edits it
  freely.
- **Amendments** live on `refs/beadcause/foundations` — a commit per amendment, a tree
  of `<agent>.json` overlays, the justification in the message. Written with the same
  plumbing as the session log (`lib/gitref.js`), so nothing touches the working tree
  and a human mid-edit in the same checkout never sees it.

Effective = baseline ⊕ overlay, resolved at spawn. Editing a prompt in a release
therefore cannot silently revert an approved amendment, and an approved amendment
cannot freeze a copy of a prompt development has since moved past.

Because every amendment is a commit, the history reads as what each agent was
allowed to become:

```
git log --format='%aI %s' refs/beadcause/foundations
git cat-file -p refs/beadcause/foundations:console.json
```

That is also the History tab on the agents screen — **narrowed to the agent whose tab it
is**, which it was not at first. One ref holds every agent's amendments, on purpose,
because the whole log read as one story is the interesting read; drawn unfiltered under
one agent's name it says the opposite, and the worker's History tab was a request the
*dispatch* agent had made and Adam had declined. The subject is what the filter matches,
because `<agent>: amend …` and `<agent>: decline …` are what `git log --oneline` shows,
so the screen selects on exactly what a person at a terminal would.

### What may never be amended

`id`, `protocolOwner` and `writes`. Not distrust of the approval — these are the
fields whose wrongness is invisible at approval time. "Let the chat session call `bd
create`" reads as a one-line convenience and silently deletes the review step; a
changed output contract reads as a formatting preference and breaks the parser three
turns later, in a way that looks like the agent being unhelpful. Those change by
editing the file in a release, which is a human writing code.

Amendable: `purpose`, `role`, `model`, `tools`, `allowedTools`, `env`, `timeoutMs`,
`permissionMode`, and the five **card** fields the section below adds. A request naming
anything else is **rejected, not filtered** — silently dropping half a request would apply
an amendment you did not approve.

### The loop

1. **It reflects.** After the task — answering a comment, running a survey — the agent
   is asked one question: was there something you could not do? Its own foundation is
   printed for it, along with every request of its that has already been refused.
2. **It writes a block.** Not a bead. `lib/amendment.js` parses an `amendment` block
   off the end of its output; the agent never files anything and never writes a
   foundation. Both of those are beadcause's, and that separation is the whole safety
   property.
3. **beadcause files one question.** An ordinary `human` bead, labelled `foundation`,
   carrying what it wants, what it is now, the scope, the argument, and what actually
   happened. One at a time, per agent.
4. **You answer it from your phone.** Approve, decline, or ask — commenting starts a
   thread the way any other question does.
5. **Approval is a commit**, and the agent starts its next session on the new
   definition.

```amendment
agent: dispatch
kind: prohibited
scope: reading git history in the repo I am already reading; no writes
justification: |
  The comment asked which commit introduced the bug. I can read the files but not
  the history, so I answered with a guess at the file instead of the commit.
evidence: |
  Bash(git log --oneline -20) was denied.
add:
  allowedTools:
    - Bash(git log:*)
```

**Scope is mandatory.** A request without it is thrown away before it can become a
bead. "Give me Write" is not a decision anyone can make on a phone; "give me Write
under my own directory, because X" is. So is a justification — a phrase does not
clear the bar, and a request re-arguing something already refused never reaches you
at all.

**`add`/`remove`, not a rewritten list.** A model asked to restate a thirteen-entry
allowlist in order to append one line to it will eventually drop an entry, and that
would read as an approved amendment quietly *removing* a tool nobody discussed. The
agent names the delta; beadcause computes the result against the effective
foundation, so two amendments in sequence compose instead of the second reverting the
first.

### Prohibition and omission are not symmetric

A prohibition is observable: the agent asked for a tool and was denied, and the
denial is in the transcript. beadcause **reads it off the stream** rather than taking
the agent's word for it, and puts it on the card under "what actually happened" — so
a denial the agent forgot to mention still reaches you, and an account of a denial
that never happened is catchable.

An omission is not observable at all. The agent cannot see what it was never given,
so those requests are speculative by construction. Both are allowed; `kind` says
which it is, and the justification bar is what keeps the speculative half honest.

### A "no" is remembered

Declining writes a commit too, with your words as the reason, and every future
reflection is seeded with it verbatim. Without that the same argument arrives every
session forever — reasoned to from the same starting point by an agent with no memory
of having lost it — and the one channel you read for constitutional questions fills
with arguments you have already had.

### Who answers a question about a request

The agent that made it. Commenting on an ordinary question dispatches whichever agent
you picked from the roster; commenting on an amendment request instead re-seeds the
*requesting* agent with its own foundation and its own argument, because a Critic
explaining why the chat session wants a tool is a stranger guessing at someone else's
motive. It is told, in as many words, that withdrawing the request is a better
outcome than defending it.

### Where it takes effect

Three of the four agent kinds re-seed themselves for free: dispatch, the advocate
survey and a worker session are each one `claude` process that exits, so the next
spawn reads the amended foundation and *is* the new session. The chat session is the
exception — a turn is a fresh `claude -p` resumed by session id — so an approved
amendment restarts it on a new session, keeps the conversation on screen, and says so
in the transcript.

### A channel of its own, on every surface

A request to change what an agent is arrives as an ordinary `human` bead — the
decision block, the thread, the answer-and-close path are all the machinery a question
already has, and forking that would be two of everything for no gain. What is *not*
shared is the place it lands. "Should the chat session be allowed to run `git log`" is not
a question about work: it does not compete with one for priority, it should not be
counted with them, and it must never be the row that pushes a P0 off a phone screen.

So the split happens once, server-side, in `splitChannels` — and everything downstream
is handed two lists rather than one list it has to filter correctly:

| | Questions | Foundation requests |
|---|---|---|
| **Event** | `question`, `reply` | `foundation-request`, `foundation-reply`, `amended` |
| **Route** | `/api/questions`, `/api/poll` → `questions` | the same two → `requests`, plus **`/api/foundation`** on its own |
| **ntfy** | `pushQuestion` — bead priority, 💭 | `pushFoundationRequest` — always priority 3, ⚖️, leads with the *scope* |
| **Android** | channel `answers_v1`, tray card 3 | channel `foundation_v1`, tray card 4 |
| **PWA** | the list, under the space and workspace filters | a pane above it, outside every filter, badged on ⚖️ |
| **Filter** | outside it arrives quiet — see *Spaces* | the filter does not reach this channel at all; a mute still does |
| **Terminal** | the `questions` pane | its own `foundation requests` pane, in the head |

Three things are deliberate in there:

- **`/api/foundation` exists even though the data is already in the other two.** It is
  the caller that wants the channel without the inbox — the agent scope, a badge, or
  `curl` — and it costs one `bd list --label` per workspace instead of a full sweep.
- **A request never inherits the bead's priority.** A question is urgent when the work
  is; an amendment is important and never urgent, so it is fixed at 3 and the Android
  channel is `IMPORTANCE_DEFAULT`. It arrives; it does not shout.
- **Approve and decline both fit in ntfy's three buttons**, so this is one of the few
  notifications that can genuinely be answered from the shade — but a reply *about* a
  request carries no buttons at all. The Q and A is a thread, and a notification
  cannot be one; tapping opens it where the whole argument is.

The Android channel is the part that is worth more than it looks. A channel is the
unit *you* control: you can set foundation requests to silent, or off for a fortnight,
without touching whether a question about work can reach you. A tag on a shared
channel would have looked identical in the shade and given you nothing to hold.

**Which channel a bead is in comes from its label, not from whether its block
parsed.** A malformed request still arrives in the foundation channel carrying its
error, rather than falling back into the work feed where nobody is looking for a
constitutional decision.

## The AI system registry — what each of these is for, and what it would be wrong to use it for

ISO/IEC 42001 asks, per AI system, for the intended use, the reasonably foreseeable
misuse, the populations affected, the human oversight measure, the model, and the
limitations somebody has to be told about. Beadcause had most of that already and called
it something else. An allowlist is an oversight measure. `writes: false` is an oversight
measure. A twelve-hour cooldown is an oversight measure. What was missing was the
declarative half: nowhere did anything say, in a sentence, *what an agent was for* or
*what it would be wrong to use it for*.

So five fields on every foundation — `intendedUse`, `foreseeableMisuse`, `affects`,
`oversight`, `limitations` — and the six agent kinds each carry all five. That is
`CARD_FIELDS` in `lib/foundation.js`.

**They are foundation fields rather than a register beside the code, and that is the whole
design.** A register kept next to the thing it describes is a document somebody has to
remember to update, and it stops being true on the first busy week. These sit inside the
amendment chain, so a change to what an agent is documented as is a commit on
`refs/beadcause/foundations` carrying its justification and the bead it came from —
exactly like a change to an allowlist. Intended use drifting with nothing to show for it
is the finding this exists to prevent, and a field *outside* `AMENDABLE` is a field that
can drift in a release with nothing on the ref to record it. That is why they are in the
amendable set rather than protected beside `id` and `writes`.

All five are prose, including `affects`. A list would invite `add:` — one more population
appended without re-arguing who else is on it — and the useful content here is not who but
*how*: "the colleague named as the blocker in a proposal did not take part in the
conversation that named them" is the sentence, and it does not fit in a list entry.

### An amendment that outdates a card is refused

The half that makes this evidence rather than a document. `CARD_IMPLICATIONS` is the
table, and each row is an argument rather than a pairing:

| moving this | owes a sentence in |
|---|---|
| `model` | `limitations` |
| `tools`, `allowedTools` | `intendedUse` **or** `foreseeableMisuse` |
| `permissionMode` | `oversight` |

Nearly everything a card can honestly promise about what an agent will and will not
manage is a statement about the model underneath it, so moving the model and leaving the
limitations alone asserts the two are unrelated. A tool grant is the only way an agent's
reach actually changes: either it is now doing more than the card said it was for, or
there is a new way for it to go wrong, and naming one of the two is the bar.
`permissionMode` *is* an oversight measure — it decides whether a person is in the loop
for each tool call — so a card whose oversight sentence survives a change to it is
describing a control that is no longer there.

`purpose`, `role`, `env` and `timeoutMs` are deliberately ungated. A role is prose about
how to behave that the card's own prose does not restate, and a gate on everything is a
gate people route around by writing a card sentence that says nothing.

It is checked **per moved field, not per patch**. An amendment moving `model` and
`permissionMode` at once owes both `limitations` and `oversight`; a union would let one
sentence about the model stand in for a deleted control.

**And the refusal names both halves**, because a refusal a maintainer cannot act on is a
refusal somebody eventually turns off:

```
refused: the system card does not change with it: `allowedTools` implicates
`intendedUse` or `foreseeableMisuse`. Set the named card field in the same amendment, or
narrow the request so it does not move allowedTools.
```

It is enforced in **two** places on purpose, and only one of them is the enforcement.
`foundation.validate` — the funnel every write goes through — is what actually stops it,
so no future caller of `amend` can walk past a gate that lived only in a parser. The
second is `parseAmendment`, which refuses the block at the point the *agent* is still the
audience: refused there, the agent is told in its own transcript which field it moved and
which sentence it owes, and can re-file with it. Let it through and the same refusal
arrives on your phone as a 422 while you are tapping approve. The parse refusal is
**errored and complete**, the way a request naming a protected field already is: the
scope, the justification and the delta all survive, so nothing about what the agent wanted
is dropped on the floor.

The reflection prompt an agent gets now prints its own card back to it alongside its
allowlist, and states the rule with the table filled in from `CARD_IMPLICATIONS` — one
copy of the mapping, so the prompt cannot describe a gate different from the one that
runs.

### And beadcause itself is a registered system

Not only its agents. Six kinds of agent do work; the daemon, the phone app and the loop
connecting them are the system those agents are part of, and an auditor asking "what is
this thing, and what is it for" is not asking about the worker.

It has **no `BASELINES` entry**, and that was the judgement worth writing down. A seventh
key in that map would put `beadcause` in `AGENTS` — and every reader of `AGENTS` (the
activity matcher, the chat launcher, the amendment parser, `POST /api/console`) would
then be wrong, in a way that fails as a runtime surprise rather than as an error anybody
sees. So it is a **sibling record** in `lib/systemcard.js`, resolved by the same reader:
`systemCard(id)` answers for `beadcause` and for any agent kind without the caller
knowing which it asked about, and `AGENTS` still means agent kinds afterwards.

```js
systemCard('beadcause')     // the system's own card
systemCard('worker')        // the worker's, off its baseline
await systemCards(dir)      // all seven, with approved amendments applied
registryGaps()              // empty, or the cards missing a field
```

**Beadcause's own card is not amendable, and that is stronger than amendable rather than
weaker.** An agent's card is amendable because there is an agent that could ask, and
because a field outside the chain could drift. Nothing *is* beadcause, so there is nobody
to file that request; changing what the system is for is a commit to that file, reviewed
by a person. Said out loud because "not in the chain" otherwise reads as an oversight.

What it does not carry is `tools`, `allowedTools` or a model: those are facts about a
process that runs, and beadcause is the thing that opens the processes. Its model line
says `source: 'per-agent'` and points at the six cards below it, rather than drawing a
blank — a card declining to answer the model question is worse than one that says where
the answer is. For an agent the same line is honest in the other direction: `model: null`
means nobody has said anything about *this agent* specifically and the run is routed from
the bead's complexity tier, so the card answers with the model an unrated bead lands on
and `routed: true` to say that is a default rather than a decision. `FALLBACK_MODEL` is
imported from `lib/complexity.js` and never restated — a mapping is a decision, and a
second copy of a decision goes stale silently because both copies keep rendering.

`test/systemcard.mjs` holds both properties: every registered system resolves to a card
with all five fields on it (so a seventh agent kind with no card fails there rather than
shipping as a blank row on a screen), and the gate refuses, by name, in every direction it
is meant to. All three guards were mutation-tested — delete the throw, delete the parse
refusal, blank a card field, confirm red, restore.

## What an agent remembers, and how agents tell each other things

A foundation is what an agent *is*. This is what it has *learned* — and it is the
half that used to evaporate at the end of every run. Six calls, and an agent
reaches all of them as a command:

```
beadcause-memory remember tone "evidence first, then the ask"
beadcause-memory recall tone
beadcause-memory note tests "npm test discovers test/*.mjs; scripts/test.mjs is the runner"
beadcause-memory notes tests
beadcause-memory post proposals "the graph work is blocked on a decision"
beadcause-memory read proposals --since=4
```

`remember` / `recall` are one agent's own knowledge, and it follows the agent
anywhere. `note` / `notes` are the same two verbs against **the repo the command was
run in** — knowledge about one codebase, which is worth nothing in any other. `post` /
`read` are a **blackboard**: an agent publishes what it believes and the others read
it whenever they next look. Deliberately not a mailbox and not a conversation — there
is no addressee and no delivery, because git has no notification to give. The nudge,
when something needs one, is the event bus (`lib/events.js`), which is in-memory and
un-persisted and is the exact complement of this: payload and durability here,
wake-up there.

**No call names a repo, a path or a ref, and none of them will take one** — not even
the pair whose whole subject is a repo. That is the point of the indirection: the day
this should be SQLite or a table in beads, the change is `lib/memory.js` and nothing
else. An agent handed a path would have put that path into its own memory, its habits
and its prompts. So `note` writes to wherever the process is standing, and a run from
the wrong directory is fixed by `cd`, which is checkable, rather than by an argument,
which is not.

**Who you are is not an argument either.** The daemon exports `BEADCAUSE_AGENT`
when it spawns an agent, and both halves attribute to that. An agent that could name
itself on the command line could name itself `console`, and the first time one wrote
into another's memory it would be indistinguishable from the other agent having
written it. It is the *foundation's* id, so `answerer` and `critic` — who share the
dispatch foundation — share what dispatch has learned. Memory belongs to the thing
that has a definition, which is the same boundary the amendment loop draws.

### The one agent nobody spawns

Three of the four are a `spawn` from the daemon, so `agentEnv` hands them an env
object and that is the whole of it. The worker — the agent that does every piece of
code work here — is not one of them. `launch` in `lib/session.js` writes a *command
string*, hands it to `osascript`, and iTerm types it into a **fresh login shell**:
nothing in the daemon's own environment crosses that gap, so an env object passed to
`osascript` reaches osascript and stops. The exports have to be **in the line**, which
is what `agentExports` renders — the same four decisions as `agentEnv`, written for a
shell instead of for `execve`, with `BEADCAUSE_AGENT` emitted last because a later
`export` wins exactly the way a later key in an object literal does.

**"Nothing crosses that gap" is true of the daemon and false of iTerm, and one variable
has to be taken away rather than given.** `BEADCAUSE_LAUNCHD_PROGRAM` is how a backend
that is a *grandchild* of launchd knows what launchd actually started (see
[the three-day bug](operations.md#the-router--why-you-never-restart-it)), and `launchdProgram()`
treats a non-empty value as authoritative — safely, because the router writes it on every
spawn and an inherited value therefore cannot survive into anything the router owns. But
iTerm.app was itself started downstream of the router launchd runs, so the variable sits
in the *application's* environment, and every window it opens carries it: days later, in
a different checkout, for work that has nothing to do with that router. The fresh login
shell inherits nothing from the daemon and rather a lot from the app the daemon is
talking to.

So both spawners empty it. A `beadcause` server run by hand from a worktree used to
report its own code not-reloaded and draw HOT-SWAP IS NOT LIVE over a perfectly good
install, because the worktree's router path is not the main checkout's — a true statement
about that terminal's ancestry, read as a statement about the tree under it (bc-6sst).
Empty is not the same as unset and is the point: `launchdProgram()` reads `''` as *the
spawner says nobody's launchd job*, which is exactly true of a shell in a terminal window
and of an agent the daemon spawned. Neither is a backend serving the app, which is the
only thing the variable was ever about. It is emitted *first*, unlike `BEADCAUSE_AGENT` —
this is a scrub of something inherited rather than a claim an agent must not be able to
make, so an amendment that deliberately sets it still wins. `test/memory.mjs` asserts it
through the real login shell, with the variable deliberately set on the way in, because
on a laptop where nobody's daemon is running an unscrubbed session and a scrubbed one
look identical.

It is worth saying what the missing half looked like, because it was invisible from
every direction. For one release the worker's launch read its foundation and took two
fields off it — the model and the permission mode — and applied neither the role nor
the environment. So `beadcause-memory` was not on the sessions' PATH, and had it been,
every write would have failed for want of an agent to write as. The agents doing all
the code work were the only ones that could not reach the store, and from outside that
is indistinguishable from them having nothing to say.

The role travels the same way and had the same gap. A worker's is delivered as a
**system prompt** (`--append-system-prompt-file`, the way the chat session's is) rather
than folded into the brief the way dispatch and advocate fold theirs: a work session
runs for as long as the work takes, and what it *is* has to still be in front of it on
the fortieth turn rather than buried under forty turns of a task. The memory brief is
quoted after it, from the one copy in `lib/memory.js` — which means an amendment to
`role` can change what a work session is without being able to delete the paragraph
that tells it it has a memory at all.

### `PATH` and the commands baked into a brief both name the main checkout, never a worktree

`agentExports`' `PATH` prefix above is this repo's own `bin/` — but *whose* `bin/`
mattered less until nearly every session doing code work was itself running from a
worktree under `.claude/worktrees/`. `BIN` in `lib/foundation.js` used to be computed
once, from wherever the currently-running `foundation.js` happened to have loaded
from, and the daemon almost always loads from the main checkout. The one case it does
not is exactly the dangerous one: a worker session is a **fresh login shell**, long-lived
and independent of the daemon the moment `osascript` types the command in, and the
ship/prune sweep retires a worktree the instant its branch is an ancestor of `main` —
with no regard for a live session still holding a `PATH` into it. A session that hits
this loses `beadcause-memory` off `PATH` mid-run, at the exact moment it is meant to
hand work back (bc-xl7n.61). `lib/session.js`'s `DELIVER_CMD`/`FILE_CMD`/`ASK_CMD`/
`PROPOSE_CMD`/`SUPERSEDE_CMD`/`CHECKIN_CMD`/`PLAN_CMD` — the absolute paths a brief
types out in full rather than trusting to `PATH` — had the same bug for the same
reason: they were built from `ROOT`, "wherever this process loaded from", the one time
that is wrong being the one time it matters.

So both resolve through `mainCheckout` instead: `BIN` becomes the main checkout's
`bin/`, and `lib/session.js`'s `MAIN` (not `ROOT` — `ROOT` is still right for the
`applescript` paths beside it, which this process itself runs) is the checkout a brief's
commands are built against. Both are a `git` call and so cannot resolve synchronously
at import — and both are a **top-level `await`**, not a fire-and-forget `.then()` that
corrects the module-level binding whenever the subprocess happens to finish. The first
version of this fix used `.then()` and broke `test/land.mjs`'s byte-identical-brief
assertions the same day it was written: `workPromptFor` is called more than once for
the same bead a few `await`s apart, and when a call landed before `BIN`/`MAIN` had
resolved and another after, the two produced different strings for what a worker is
told are identical briefs. A top-level `await` makes ESM's own module graph do the
waiting — nothing that imports `lib/foundation.js` or `lib/session.js` runs a line past
it until the value is final, so every caller in the process sees one answer.

### Which of the two, and the one question that decides it

**Would this still be true in a different repo?** That is the whole test, and the
brief puts it to the agent in those words. (There is a question *before* it now — is this
a belief that outlives the run at all, or a report on the run itself? — which is
[`debrief`](#the-report-a-run-leaves-behind-debrief-and-why-neither-other-store-could-hold-it)
further down. The two below are what is left once that one is answered.)

- **Yes → `remember`.** How Adam likes a thing shaped, an approach that worked
  anywhere, a dead end not worth walking again, something about how the agent itself
  goes wrong. This one follows it everywhere, so anything false elsewhere does not
  belong in it.
- **No → `note`.** How *this* codebase is put together, where its tests live and how
  they are run, the trap in one of its files, what a name means here, why the obvious
  thing was done the other way.

Neither store is an optimisation of the other, and the version with only one of them
is not the same thing minus a feature — it is a thing that quietly loses a whole
category of knowledge. For a while only the cross-repo store existed, and its brief
said, correctly for it, to write down only what is *"still true next week and in a
different repo"*. Read literally — which is how an agent reads a brief — that rules
out every fact about the code in front of it. So knowledge of how `lib/advocate.js` is
put together either followed the agent into another repo as advice that is false
there, or was never written down at all; and the second is silent. The store existed,
and the knowledge with the most obvious use for it was the knowledge the brief
excluded.

**Getting it wrong is cheap but not free**, and the brief says which way it costs: a
repo fact in `remember` is advice the agent will follow somewhere it is false, and a
general lesson in `note` is one it will never see again once it is working elsewhere.
Neither is a corruption, and both are one rewrite away.

### The moment a worker actually writes

A store an agent is *able* to use is not a store an agent uses. The worker's own ending
had two steps in it, and both were for you: a prefix on the session name — `QUEUED-`,
or `DONE-` where nothing else finishes the job — and the
`** BEAD WORK DONE **` line, each written for whoever scrolls a wall of windows hours
later. Nothing in it was for the next agent — and that ending is the last moment
anything could be, because immediately after it the done file is written, the shell
exits, iTerm closes the window, and everything that session worked out goes with it.

So the brief now carries a third step, first in the closing sequence, and it says the
two things that make it work rather than merely present:

- **It is foreshadowed up in the brief**, right after the line about running the tests,
  because a session told about this only at the end has to reconstruct the run from
  memory — and what it reconstructs is a summary of what it did, not the thing that
  surprised it. Twenty minutes lost to a trap at turn nine reads as obvious by turn
  ninety. The noticing has to happen while the surprise is in front of it; only the
  writing belongs at the end.
- **Silence is the expected answer**, in the same words the amendment channel uses for
  the same problem: the failure mode is a paragraph of *"worked on `lib/foo.js`"* filed
  every single run, at which point the store is noise and nobody opens it. The bar is
  stated as a bar — would this have saved *you* an hour if it had been there when you
  started — and the existing line holds: anything with a work item attached is a bead,
  not a note.

**The order inside the ending is not free**, and the step says so outright rather than
trusting its number. The writes are tool calls; the marker has to be the last line of
the final message with nothing after it. A session obeying "write down what you learned"
and "put the marker last" in the other order puts its marker in the middle, and a line
whose entire value is that it can be grepped for stops being findable. It is also owed
on **every** ending, including the ones that hand the work back — a run that discovered
the bead was bigger than it looked is usually the run that learned the most, and gating
this on a closed bead would lose exactly those. `test/land.mjs` asserts the position of
the foreshadow, both stores and the question between them, the "most runs should write
nothing" sentence, and that the three steps come out numbered in the order the marker
needs.

### Every agent needs a moment, and two of them did not have one

That step turned out to be the general rule rather than the worker's own arrangement.
Three days after the brief reached all four agents, the roster had one name on it, and
counting who had written what is what explains it (`bc-sgu4`).

**The read half fires everywhere, because the brief anchors it to a moment every run
has.** *"Check `recall` and `notes` first"* names a point — the start — and the agents
take it: thirteen of the thirty-four stored chat conversations open a turn with a
`beadcause-memory recall`. **The write half names what to keep and never when**, and the
agents that write are exactly the ones whose own brief supplies the when. A worker's
numbers it as a closing step, and it began writing two minutes after that step landed —
ninety-five notes and about eighty-five memories inside the first day. The comment
answerer's run is one reply and an exit, so its end is unmissable, and its first memory
landed an hour after the brief reached it. The chat session had no such moment, because
a chat does not end: you stop replying and the window closes. In three days and
twenty-eight conversations it read constantly and wrote nothing at all.

So each of the chat session's two protocols now names its own moment, and the moments
are different because the runs are. The proposal protocol hangs it on the block, which
is the only terminal act that conversation has and is the right one on the merits — by
the time it writes a proposal it knows what you asked for, what you cut and what shape
you wanted, and after the block it may never be asked again. The direct-chat protocol
hangs it on the turn where something about how that agent works gets settled. A generic
sentence in `memoryBrief` would have been false for three of the four; this is why the
moment lives in each agent's own brief and the *what* lives in the shared one.
`test/memory.mjs` asserts both paragraphs, for the reason it already asserts the brief:
a prompt paragraph is the load-bearing part of this feature and nothing else notices it
going missing.

**And the fourth agent's zero was never evidence of anything, which is worth more than
the fix.** The advocate looked like the strongest case — it is unattended, it surveys
the same repo again and again, and its brief carries an extra paragraph telling it to
`recall` before proposing and `remember` what you turned down. It has written nothing
because it has never been handed the brief: `memoryBrief` reaches it through
`surveyPrompt` alone, a survey runs only on a tick where the queue is empty of ready
beads *and* of running workers *and* of epics held by their children *and* of beads
already in an open pull request, and on this Mac that has not once happened —
`lastProposalAt` is `null` for all six advocates, and no `<workspace>_advocate.log`
exists although `agentlog.reset` is the first line of `surveyAgent`. The advocate has a
second path, `chatProtocol` — a chat on the agents screen runs as its real foundation,
so `BEADCAUSE_AGENT` is `advocate` and anything written there is the advocate's — and
the one advocate chat on disk predates the commit that put the brief in that spawn by
three hours. **Before reading anything into a silent agent, check that the code path
quoting the brief has ever run.** From outside, "told and declined" and "never told"
look identical, which is the same lesson as the roster command nobody ran, one level
further out: there the brief did not name the capability, here the brief did not arrive.

**It arrived the next day, and the measurement above is the reading of 2026-08-11 rather
than the state now.** The `architecture` advocate surveyed on 2026-08-12, so there is one
`<workspace>_advocate.log` on disk and one advocate memory in the store — and what that
one memory says is *"treat the empty-queue claim as a hypothesis"*, which is the survey
having been handed a premise it could disprove. See [the premise the survey could disprove
in one command](advocates.md#the-premise-the-survey-could-disprove-in-one-command). Nothing about the
paragraph above is wrong except its tense: a silent agent still needs its code path
checked before anything is read into the silence.

### Reading another agent, without being able to be one

```
beadcause-memory agents                       advocate
                                              console
                                              dispatch
beadcause-memory recall --of=advocate tone    evidence first, then the ask
```

The roster is not a list anybody maintains: `agents` is the memory ref's own tree,
filtered to `*.json`, so an agent kind appears the moment it remembers anything and
a list that could go stale never exists. It also means a *retired* agent's memory is
still there to read, which is the useful half of not curating it — and not curating it
is now the decision rather than the default, for the reason two sections down.

**`--of` is a second flag on purpose, and the reason is the paragraph above.**
`--agent` *is* you for the whole invocation — so `--agent=advocate recall` does not
read the advocate's memory so much as become the advocate, and a `remember` in the
same breath writes into their file. That is fine for a human debugging at a terminal
and wrong as the thing an agent is told about. So the read half got its own flag,
which names a **subject and never an author**: only the two reads — `recall` and
`notes` — accept it, and every command that writes refuses it outright rather than
treating it as identity. `remember --of=advocate …` is an error, not a write, and
`test/memory.mjs` asserts the advocate's memory is byte-identical afterwards. A read
attributes to nobody, so `--of` needs no `BEADCAUSE_AGENT` at all — which is also what
leaves it no author to borrow. The allowed set is a **list of the reads**, not a check
per command, so a verb added later is refused by default; `note` arrived after the
guard was written and inherited exactly that, which `test/memory.mjs` also asserts.

**And the read says what the note is worth.** *advocate's own conclusion, written
without your context — never a reason on its own; it can help justify one, and it
must face scrutiny.* It goes to **stderr**, so stdout stays byte-for-byte what a
plain `recall` prints and a `$( )` capture is unchanged.

**That line replaced a feature, and the swap is the interesting part.** The first
version was a privacy warning — *these are advocate's notes to itself, not published
to you* — held open as a stopgap against the real fix, which was a **curated
surface**: agents publish the subset they are willing to have read, and the rest
stays private. That fix was rejected (bc-pud4), and not on cost. **The private half
does not exist.** An agent writes every memory expecting the others to read it, which
is a sentence in `memoryBrief` rather than one more store plus a per-key flag plus an
answer to who curates — the writing agent, the foundation, or you. Curation would
have been the machinery for a distinction nobody wanted to draw. (Not to be confused
with the two stores `remember` and `note` are: those split on *where a fact is true*,
and every agent can read both.)

So the guard moved to where the risk actually is. It was never that a reader sees
something private; it is that a reader **inherits a conclusion as an instruction** —
and a privacy framing does nothing about that, because "this was not for you" and
"this is not a reason" are different claims and only the second one is true. **An
agent's memory can never *be* the reason for something.** It can contribute to
justifying one, and it faces the same scrutiny as any other citation: it may be
stale, it may be about a case unlike this one, and it was written with none of the
reader's context. The brief now says both halves — expect to be read; never your
reason — and `test/memory.mjs` asserts each of them, because a prompt sentence is the
whole mechanism and nothing else would catch it going missing.

**Which is also why the empirical plan was abandoned.** The bead's own suggestion was
to watch whether agents quote each other's memories as reasons, and decide from that.
It cannot produce evidence: `agents` has exactly one entry, `dispatch`, so there has
never been a cross-agent read to observe, and waiting for one means the brief carries
the wrong framing in the meantime. The decision is about what a note is worth, which
is answerable now.

**None of it counts until the brief says so**, which is the rule the rest of this
file keeps running into: `agents` shipped with the first version of the memory API
and no agent ever ran it, because `memoryBrief` listed four commands and not that one.
From outside, a capability nobody was told about is indistinguishable from one nobody
chose to use. So the brief now carries the roster, the read, that it *is* only a read,
and both halves of bc-pud4 — that everything you write should be written expecting to
be read, and that what you read can never be your reason for something.

**A brief that describes one store while two exist is worse than one describing
neither**, which is why the repo-local half arrived in `memoryBrief` and in
`test/memory.mjs` in the same commit as the code. An agent told about one store writes
into that one, whatever it has learned; there is no version where it declines because
the right store was not mentioned. So the brief names both pairs, gives the question
that picks between them, and says which way getting it wrong costs — and the suite
asserts each of those, because a paragraph is the load-bearing part of this feature and
nothing else would notice it going missing.

### Where a note lives: a ref in the repo it is about

A note goes on a ref in the codebase it describes, beside the foundations and the
session logs — which is where the whole idea started (`bc-goo.1`) and is what makes
"the same key in two repos is two different notes" a property of the store rather
than something anyone has to arrange:

```
refs/beadcause/agents/<agent>    one commit per write, tree = index.json + notes/<key>.json

git -C ~/projects/beadcause log refs/beadcause/agents/worker
git -C ~/projects/beadcause cat-file -p refs/beadcause/agents/worker:index.json
git -C ~/projects/beadcause cat-file -p refs/beadcause/agents/worker:notes/worktree-setup.json
```

**One blob per note, plus an index** (`bc-u1ltu.1`). The tree used to be a single
`notes.json` holding every note, and that stopped scaling without anyone deciding it
should: by 2026-09-30 the worker's store here was 1,138 notes in one 2.0 MB file. Every
`notes` listing parsed all of it to print all of it, 593 reads were exactly that listing,
and every write re-serialised and re-hashed the whole two megabytes to change one key.
Now `notes/<key>.json` holds one note in the `{ value, at }` envelope it always had, and
`index.json` holds a row per key — `summary` (the first 160 characters), `at`, `bytes`,
and `tags`/`scope` once a note carries them. A read by key opens one blob; a listing
(`beadcause-memory notes` with no key) prints the index and says how to open the rest; a
write hashes one blob and hands every other note's row to `mktree` unchanged. The
compare-and-swap is the same one. The daemon's brief still loads every body, in one
`cat-file --batch`, until `bc-u1ltu.3` makes it choose by scope from the index.

A store still in the old shape is read as it is and converted by its next write, in the
same compare-and-swap. `node scripts/notes-migrate.mjs --scan ~/projects`
converts every store up front, and refuses to commit one unless the new tree reads back
with the same keys and byte-identical notes; without `--apply` it checks and stops short
of `update-ref`. One case is a recovery rather than a read: a writer still running the
old code — a CLI call in flight at the deploy — finds no `notes.json` in a converted tree,
starts from nothing, and commits a `notes.json` holding its one note. A legacy tip whose
history has a converted commit is therefore read as that commit's notes with the legacy
file laid over them, and the next write converts the lot back.

**What `note` refuses** (`bc-u1ltu.2`). A note is one claim, with the evidence for it. The
envelope is `{ value, at, evidence, kind?, scope?, tags?, verified }`. `value` is still
the claim's field name, because every reader since `bc-goo.1` unwraps it. The index lifts
`kind`, `scope`, `tags` and `verified`. `evidence` stays in the body, because a reader
checks it after choosing a note, not before. `note` refuses four things, and each refusal
says how to fix it:

- **No `--evidence`.** A claim nobody can check is one nobody can retire.
- **More than 4 KB** (aim for 1.5 KB). On 2026-09-30 the worker's store here had a
  median note of 1,430 bytes; 492 of its 1,140 notes were over 1.5 KB and 10 were over
  4 KB.
- **A `--kind` outside** gotcha, procedure, fact or decision.
- **A new key too close to an existing one**, unless `--supersede=<old>` names it. The
  new note is then written and the old key is deleted in the same commit, and its text
  stays in the ref's history.

"Too close" (`nearKeys`) is one of three tests. The first is a typo: character distance
within a tenth of the longer key. The second is three-quarters of the key's words shared,
which catches reorderings. The third is distance within a fifth *and* more than half the
words shared. A flat edit distance of 2 found nothing in 1,140 keys, because descriptive
keys differ by words. Distance alone, though, flags a series such as `orphan-census-kilo`
against `…-echo`. Over the worker's store the three tests flag 9 pairs, and 24 in
loremia's. Every one of those pairs is the same subject filed twice.

Rewriting an existing key is never refused on these grounds, because that is how a note is
corrected. Notes written before these rules are left as they are; cleaning up that backlog
is [the curator's job](#the-weekly-curator-archive-promote-merge-split) (`bc-u1ltu.5`). After checking that a note still holds, a session runs
`note --verify <key>`, which moves `verified` and nothing else.

**Stale by evidence, and the archive** (`bc-u1ltu.4`). `staleNotes`, and
`beadcause-memory notes --stale` on the command line, list the notes the evidence says are
stale and why. There are three reasons:

- **A scope glob matches nothing at HEAD.**
- **The note cites a path that HEAD's history deleted, or a backticked `functionName` that
  appears nowhere at HEAD.** "Deleted" is deliberate. A path that was never there, such as
  an example like `public/x.js` or a file on an unmerged branch, is not evidence of
  anything.
- **No read, verify or rewrite in 30 days.**

On the worker's store here on 2026-09-30:

- The evidence reasons flag 15 notes, for example ones about the deleted `lib/underp0.js`
  and `public/history.html`.
- The 30-day rule flags 810 of 1,140 notes. The read log only started on 13 August, so how
  much of that the curator acts on is its decision, not this function's.

One implementation detail: cited names are checked against one pass over every identifier
at HEAD, about 330 ms. The obvious approach, one `git grep -F -w` over the cited names,
took 71 s and ran past the git timeout.

Stale notes move to `refs/beadcause/agents-archive/<agent>`. The pragma named
`refs/beadcause/agents/<agent>/archive`, which git cannot create, because
`refs/beadcause/agents/<agent>` is already a ref and cannot also be a directory.
`archiveNotes` moves notes, and `restoreNote` moves one back. Each move updates both refs
in one `update-ref --stdin` transaction (`commitToRefs`), so a note is never on both refs
or on neither. An archived note keeps its blob, and its archive index row records when it
went and why. It is out of every brief, listing and search. You can reach it only with
`--archived`:

- `notes --archived [<key>]` lists the archive or reads one note from it.
- `notes --search <words> --archived` searches the archive.
- `note --archive=<key> [--reason=]` and `note --restore=<key>` move a note by hand.

**Health, on the Memory tab** (`bc-u1ltu.6`). `notesHealth` computes the pragma's four
numbers for one agent's notes in one repo, and the Memory tab shows them as a card under
the notes store. The first two are marked red or green against their target:

- **Hit rate** (target 90%): reads that found what they asked for in the last 30 days.
- **Read share** (target 70%): the share of live notes read by name in that window.
- **Bytes a session start loads:** the index, against the size of the whole store.
- **Notes retired:** notes archived and superseded in the window, counted from the ref's
  own commit subjects. Promotions show as "not measured", rather than zero, until the
  curator files them.

On 2026-09-30:

| Store | Hit rate | Read share |
|---|---|---|
| Worker, this repo | 95% | 20% (233 of 1,146) |
| Worker, delmar | 97% | 53% |

The read share is the number the stale rule and the curator exist to move. The numbers
come from `memory-reads.jsonl`, so they start on 13 August, when the log started.

#### The weekly curator: archive, promote, merge, split

`lib/curator.js` (`bc-u1ltu.5`) works through the backlog the rules above leave alone. Once
a week per checkout, from the daemon's poll cycle, it does four things to every agent's
notes in that repo:

- **Archive** under the policy decided in `bc-ltgld`. A note that is stale by evidence goes
  on sight. A note that is only *unused* goes only when it is older than 60 days **and** the
  read log reaches back that far, at most 50 a run, oldest first. The second condition
  matters: the log started on 14 August, so until mid-October "nobody read it" may only mean
  "nobody was counting", and the curator holds every unused note back and says how many.
- **Promote.** A note read 25 times or more is a rule every session has to rediscover. The
  curator files a bead (label `note-promotion`) asking for that rule to become a test, a
  lint or a README section, and for the note to be archived. At most five a run, most-read
  first, and never the same note twice.
- **Merge** the largest prefix clusters (five or more keys sharing their first two words,
  such as the 24 `sw-cache-*` notes), and **split** the largest notes over the 4 KB cap.
  These need prose, so they are one headless `claude -p` per run, given at most two
  clusters and three notes. It answers in a fenced `curate` block, and the daemon checks
  every proposal against the rules `note` holds a session to: the cap, evidence and kind,
  only keys it was given, a merge that actually merges, and no collision with a live key.
  A cluster the model leaves alone is not offered again for four weeks.

**Every action is a commit.** An archive is `archiveNotes`, undone by `note --restore`.
Each merge or split is its own commit on the store's ref (`replaceNotes`), and the notes it
replaced are still in that ref's history, and named in the new note's `from`. The run itself
is a commit on `refs/beadcause/curator`, whose `state.json` is the ledger that makes the
weekly cadence and "never the same promotion twice" survive a restart.

The first dry run against this repo, on 2026-10-01, planned 25 archives across four agents,
promotions for `no-claude-md-readme-is-the-spec` (235 reads), `worktree-setup` (169),
`tests`, `test-filter-mjs-guards-every-lib-file` and
`a-new-lib-module-must-be-claimed-by-the-evidence-register`, merges of `sw-cache` (24) and
`b7e-gate` (17), and a split of the 237 KB note. To see what next week's run would do:

    node scripts/memory-curate.mjs [<repo>] [--json]

It is read-only. `advocates.memoryCurator: false` switches the sweep off, and
`advocates.memoryCuratorDays` sets the interval.

**A linked worktree shares its parent's ref store, and that is what makes this usable
here at all.** Nearly all work in this repo happens in a worktree under
`.claude/worktrees/` that is retired days later, so a note that lived *in* the worktree
would die with it. It does not: a ref outside the per-worktree namespaces lives once,
in the common `.git`, so a note written from `worktrees/foo-a3f` is there from the main
checkout and from every sibling worktree, and it is still there when that worktree is
gone. `mainCheckout` resolves which repo that is, exactly as `lib/foundation.js` does
for an amendment.

**A ref per agent, not one ref with a file per agent** — which is the opposite of the
cross-repo store, for a reason that is about who the writers are. There, they are four
agent kinds on one Mac. Here they are every session of one kind in every worktree of
one repo: a dozen `worker`s on an ordinary afternoon, none of them aware the others
exist. Splitting by agent means two *kinds* never contend at all, and a write rebuilds
its own agent's tree instead of reading every other agent's file back to avoid deleting it
with `mktree`. `test/memory.mjs` races six of them from two worktrees.

There is deliberately **no roster command for this store**. `agents` answers "which
kinds have a memory" out of the cross-repo tree; the union across both would answer
differently depending on which repo the process is standing in, and its test would
assert whatever this Mac happens to have noted. `git for-each-ref
refs/beadcause/agents/` is the answer for a human who needs the list.

### How a note reaches a session that never thought to ask

Writing is the easy half. The brief in the system prompt says to check `notes` before
you start, and that is a *pull* — it costs nothing and it works only on a session that
remembers to run a command before it has read anything, which most do not. So the work
brief also **pushes**: `openWorkSession` reads this repo's notes and `workPromptFor`
puts the likely ones in front of the session, above the paragraph about running the
tests, which is what a good half of them turn out to be about.

Both halves stay. The pull is the only thing that works for whatever the selection did
not pick, and the section says so in its own last line.

**Which notes.** Two signals, ranked in that order, in `relevantNotes`:

- **A note that names the bead**, or its parent — matched as a substring, so a note
  saying `run it for bc-rk2o.2-.5 too` is found by every child in that range. The
  precision is as good as this gets, because an agent writing `Bead: bc-u4na` at the
  end of a note is saying *this is what that bead was about* in the one vocabulary both
  sides share, and it is a real convention rather than a hoped-for one: nineteen of the
  first twenty notes in this repo's store name at least one bead. It rescues exactly
  what the second signal misses — a note about a bead's subject in words the bead
  itself never uses scores 0.9, i.e. noise.
- **A note that reads like the bead** — ten times the cosine between the two bags of
  distinctive words, above a floor of `1.6`. The tokeniser keeps `.`, `/` and `-`
  *inside* a token, because `lib/session.js` and `test/browse.mjs` are where the whole
  signal is. The floor is a gap between two populations rather than a percentile of
  one: measured across forty real beads, the noise floor sits at about 1.0 and the
  correct note scores 2.0 to 4.7. A bead about filling in timesheets tops out at 1.03
  and is handed nothing, which is the case that has to keep working — a section that is
  noise once is a section nobody reads again.

**What it costs when the pile is large, which is the part worth being honest about.**
Bodies are capped at four notes and 4500 characters and always will be; a note is taken
whole or not at all, since a trap clipped mid-sentence is a trap you cannot act on. What
is *not* capped is the line of keys underneath, so nothing in the store is ever
invisible from the brief — the session can see that `sw-cache-version-conflicts` exists
and go and read it. That line is what makes the cap honest: without it a capped section
reads as the whole store, and pushing would be strictly worse than pulling for
everything it left out. At a few hundred notes the key line is itself worth capping;
until then the ceiling that binds is the bodies.

**A repo whose store is empty gets no section**, not a heading over nothing — an agent
shown an empty section twice learns the section is furniture and stops reading it on the
day it has something in it. And a worker is handed **its own kind's notes only**;
reading another kind's is `notes --of=<agent>`, which the brief names, and whether one
should be *handed* another's unasked is `bc-pud4`.

`notesIn(dir, agent)` is the one tier-1 read that names a directory, and the daemon is
the caller it exists for: it opens sessions in four repos from one process and is
standing in none of them. Every read an *agent* can reach still resolves from
`process.cwd()`, which is the whole point of the indirection — `lib/foundation.js` draws
the same line in the same place with `effective(dir, agent)`.

#### The Epic Advocate gets the same push, and it is the kind that most needed it

Three doors now read the store and put the result in a brief: `openWorkSession` for a
worker, `openPlanSession` for the epic worker, and `openEpicAdvocateSession` for the P0
advocate (`epicAdvocatePrompt`, `lib/epicadvocate.js`). The third arrived last and had
the strongest case, because of what that agent *is*: it is re-entrant on purpose — it
takes stock of one P0, writes a sentence into the bead's notes and exits, and is opened
again days later on the same P0. Every other kind here at least has a conversation to
carry it through a run. This one has nothing between runs except what it wrote down.

What it was handed until then was `memoryBrief`, in the system prompt, which says a
memory exists and names its commands. That is not an index, and the difference is the
whole of the gap: a window on `bc-goo` ran `recall` and `notes` on 2026-08-13, and
everything it then established — which children were a deploy tap, which experiment was
instrumented but starved, why — was rebuilt from the tracker, by the fifth window in a
row to rebuild it. The store filling up made that *worse*, not better. Eighteen notes
with no index is several thousand tokens of undifferentiated dump the window has to know
to ask for and then read through, to reach the four lines that are about this P0.

**Selection is against the P0 alone, not the P0 plus its open children**, following the
epic worker's precedent rather than re-deciding it. A supervisor's subject genuinely is
the subtree, so folding the children in is the tempting move — and it is what turns the
section into noise. Twenty beads' vocabulary matches nearly everything in the store
above the floor: on a P0 whose children are about `public/sw.js`, adding their titles
pulls `sw-cache-version-conflicts` in at 4.08 where the P0 alone scores it 0.00. The
children each get this selection in their own briefs, where it is precise, and every
key the P0's brief did not pick is still on the line underneath it.

**And it is handed its own kind's notes**, `notesIn(dir, EPIC_ADVOCATE)` and not
`notesIn(dir, 'worker')` — the copy-paste that would look entirely correct while
handing this agent a different agent's memory. The section says whose it is, in the
clause that makes the notes evidence rather than instructions ("what another **P0
advocate** wrote down for its own future self"), because an Epic Advocate's store is
written by supervisors taking stock and never by somebody with the file open, and an
agent that misreads the author misreads how much weight the line carries. That is the
`who` option on `notesBrief`; it defaults to `worker`, so the other two doors say what
they always said. `test/epicadvocate.mjs` pins the identifier at the call site, because
it is the one part of this a pure-function test cannot see.

The write half — a closing "write down what you learned" step for the advocate, the way
a worker has one — is deliberately still not built. That is `bc-714o`'s deferred half,
and the order was the answer: reading first, writing second, because adding a write step
to an agent that never reads produces exactly the write-only diary this epic exists to
avoid.

**The brief chooses from the index, not the store** (`bc-u1ltu.3`). Up to this point the
brief ranked every body in the store and then listed, by key, every note it had not
quoted. For the worker here that meant 1,138 keys, and a notes section of about 53 KB in
every work brief. `notesFor` replaces that path. It reads the index, picks notes with
`pickNotes`, and opens only the blobs it picked. A note is picked for one of three reasons,
in this order:

1. it names the bead, its parent or a sibling (the `refs` field in the index);
2. one of its `scope` globs covers a path the bead names;
3. its key, summary and tags read like the bead, above the same floor as before.

Under that, the brief lists the 10 notes most read here in the last 30 days, one line each,
taken from `memory-reads.jsonl`. A final line then counts the rest and points to
`beadcause-memory notes --search <words>`, which runs a text match over key, summary and
tags. There are no embeddings; reconsider that only past about 10,000 notes. On three
real beads the section went from 53–57 KB to 3–7 KB, and the named-bead matches were
still found.

An index written before `refs` existed (version 1) is read from the bodies until the next
write rebuilds it at version 2. The b7e tools that score a path or a draft against the
whole store still use `notesIn`.

### The report a run leaves behind: `debrief`, and why neither other store could hold it

Both stores above answer one question — **would this still be true next week?** — and
that question rules out the single most valuable thing a session knows at the moment it
ends: *what happened this time*. The dead end that was not obvious. The file that turned
out to be the real one. The check that already passes, so the next run need not spend
forty minutes deriving it. Where you stopped, and why the bead is still open.

None of that is a lesson about the codebase and none of it follows an agent into another
repo, so it had nowhere to go. What it did instead is the familiar failure in its third
form: it was written as a `note` that was false a fortnight later, or — far more often —
it was not written at all, and the next session at that bead started from zero on work
somebody had already done half of.

```
beadcause-memory debrief "<what happened>"     file it against the bead you are on
beadcause-memory debriefs [<bead>]             what earlier runs at it and its siblings hit
```

**It ends up in the session archive, not in a store of its own.** `refs/beadcause/sessions/<bead>`
already keeps one tree per finished session — `meta.json`, `session.log`, sometimes
`transcript.jsonl` — and a debrief is the fourth file in exactly that tree, `memory.md`.
That was not a coincidence to be exploited afterwards: the reader shipped first (`bc-nib3.5`),
so `memory.md` was already on the `/api/session-archive` allowlist, already listed by
`/api/bead-session`, and already drawn at the top of the archived-session page, with a
fixture in `test/beadsession.mjs` asserting it round-trips. The write half landed against a
consumer that was waiting for it, which is the opposite of the usual order and is why it
needed no client change at all.

**So why a staging ref exists.** The archive commit cannot be written while the session is
running, because it records the outcome, the commits and the transcript — none of which is
known until the window is gone. But the agent has to write at the one moment it knows the
most, which is before that. `refs/beadcause/debrief/<bead>` is the few minutes in between:
`archiveSession` reads it, folds it into the tree, and deletes it. A repo whose daemon is
keeping up has none of these refs at all, and `git for-each-ref refs/beadcause/debrief` is
therefore a list of what is stuck mid-flight.

**Keyed by bead, because that is the one name both sides know.** The agent cannot key by
session — it does not know its own Claude session uuid, and asking it to find one out
would be asking it to name a path, which is the thing `lib/memory.js` refuses on every
other call. The bead is in its window title, its branch, its brief and the daemon's worker
record. So `sessionCommand` stamps `BEADCAUSE_BEAD` into the session's exports, beside
`BEADCAUSE_AGENT` and for the same reason: an agent that could pass its own bead could
file a report against somebody else's work, and afterwards that is indistinguishable from
their having written it. A window with no bead — a ship window, a rebase window — is
stamped with nothing, and `debrief` refuses there rather than guessing.

**And that refusal caught one window it should never have applied to.** The Epic Advocate is
opened, closed and re-opened on the *same bead* for weeks, and it was the one bead-shaped
door passing an agent and no bead — so tier 4 could not see the session that had the most
to say to its own successor. It was not an oversight in tier 4: that agent landed after
this store was written, and the merge took the union of the two signatures without
extending it. `openEpicAdvocateSession` now passes `bead: row.id` beside `agent`, and its
brief asks for a report as the *third* thing it leaves behind, next to the two it already
did — the waiting-on sentence, which is one line of current state for a phone, and its
notes, which are what is still true next week. What a visit actually was fitted neither,
so it was written as a belief that went stale or not written at all. One honest delay
comes with it: an advocate window has no worker record, `archiveSession` runs over those,
so what it writes stays staged until the next planner or worker session on that P0 folds
it in — the same rider the paragraph below describes for a daemon that was down, stamped
with a plainly older time. Archiving the advocate window itself is `bc-nib3.13`.

**Writes append rather than replace, and there is no key to replace by.** Two calls in one
run are two things that happened, not a correction of the first. That is the difference
from the other two stores and it falls out of what this one is: `note` and `remember` hold
a current belief, and a belief gets edited; a debrief holds an event, and an event does
not. Each entry carries who wrote it and when, which also makes the one honest failure
mode visible — if the daemon was down when a window closed there is no archive to fold the
report into, so it stays staged and rides along with the *next* run at that bead, stamped
with a time that is plainly older than the session it arrived with. The alternative was
deleting an agent's writing to keep a record tidy, which nothing here does.

**A staged report is readable while it is staged**, which for a while it was not — and the
gap fell hardest on the windows that needed the store most. Every read went through
`archivedBeads`, so a report was invisible for exactly as long as it was pending, and since
a window nobody ever archives is pending for ever, a resolver, a question window or a
crashed session wrote into a store nobody could open. The two halves disagreed out loud: the
write said `debriefed <bead>`, and `debriefs <bead>` a second later said no run had left a
report — a reader claiming the store is empty over a report that exists. `debriefBeads` in
lib/sessionlog.js is the union of the archive and the staging refs, and it is the one place
both callers take their candidate set from, because they had already drifted into the same
bug once. `readDebriefs` reads staged entries first, since staged *is* the newest run at
that bead, and marks them `staged`, which the command prints as `(pending archive)`. Being
pending is a fact about the plumbing rather than about the report, so the two render
identically and a brief quotes either without caring. `bc-864m`, found when a resolver sweep
stood down on `#363` having been told no earlier run had left a report — over one that had
named the exact conflict set and the convention for resolving it.

**Silence is the expected answer for the other two and emphatically not for this one**,
and the closing step in the work brief now says both things in two paragraphs that
contradict each other on purpose. The "most runs should write nothing" bar is correct for
`note` and `remember` — a store full of *worked on lib/session.js* is a store nobody opens
— and it is wrong here, because a debrief is not competing for room in a shared store: a
bead's archive holds one file per session, and a session that says nothing simply has
none. Left under the old sentence the new store would have inherited a bar written for a
different problem and gone unused, which is exactly the shape of `bc-sgu4`, where the chat
session read the store constantly and in three days wrote to it not once.

**What the next session is handed, and why the selection is narrower than tier 1's.**
`workPromptFor` pushes debriefs the way it pushes notes, but it picks them by the *graph*
rather than by vocabulary: this bead, its epic, and its siblings, ranked in that order,
newest run per bead, capped at three and 4000 characters. There is no cosine, and the
absence is the argument. A note is a lesson about the codebase, so the right one may be
filed nowhere near this subtree and similarity is the only way to find it. A debrief is a
report on an attempt at a bead, and its worth to another bead falls off with the graph:
the run that already fought this epic's build, or the sibling that touched the same file
yesterday, is the one to read, while a textually similar debrief from an unrelated corner
of the tracker is a story about somebody else's afternoon. The generalisable half of a run
is supposed to leave via `note` or `remember` — both of which *are* pushed by similarity —
so staying narrow here is the boundary that keeps four stores from becoming four copies of
one. `beadcause-memory debriefs <bead>` is the pull for everything else, and the section
names it, the way the notes section names its own.

The epic planner gets the same section, and is arguably the reader it serves best: the
reports its children's runs left are the only first-hand account of which parts of an epic
turned out to be entangled, which is the exact question a plan answers.

The Epic Advocate gets it too, and the same graph rule narrows it further without a line of
special-casing: a root P0 has no parent, so it has no siblings, so what arrives is the
reports of previous runs at *that P0* and nothing else. That is the right answer twice —
it is this agent's own account of its last visit, which a window that starts from the bead
every time has never had, and it cannot be swamped by twenty children's afternoons the way
its notes section would be if the same widening were tried there.

`test/debrief.mjs` covers the seam, because the store is written by one module and
consumed by another and every interesting failure is invisible from either side alone: a
session that wrote nothing must archive with **no** `memory.md` rather than an empty one
(the page says different things about those two, and the better sentence becomes unsayable
if every archive carries the name); a fourth entry in a `mktree` must not silently drop a
third; the clear must be a compare-and-swap, so a report written between the archive's read
and its delete survives instead of being thrown away by a consumer that never saw it; and
four processes appending to one bead must all land, which is the blackboard's argument
again in a store where a lost write leaves no missing key to notice it by.

**A worker writes its debrief before it delivers, not after** (`bc-u1ltu.7`). The closing
step that asks for the report sits after the delivery command, because it has to come
before the marker line. But the delivery opens a pull request, and the merge advocate's
first move on one is `beadcause-memory debriefs <bead>`. So it was reading before the
worker had written anything. Measured on 2026-09-30 over this repo's merge-advocate reads,
there were 75 misses:

- 59 were beads whose debrief exists, stamped minutes *after* the read that missed it.
- 15 were beads that never had a debrief at all.
- Only 1 had a report written before the read.

The suspected cause, `archiveSession` deleting the staging ref before the merge advocate
reads it, was not the cause: `readDebriefs` reads the staging ref as well as the archive.
In both pull-request modes the brief now asks for the debrief just ahead of the delivery
command. With no pull request nothing is waiting on the report, so that brief is unchanged.

The blackboard had the opposite problem: an instrument gap rather than a real miss. `read`
logged each bus read *before* reading and with no `hit`, so every bus row in
`memory-reads.jsonl` says `hit: null`. The same measurement counted those as sixteen reads
and zero hits, although nearly every topic read was one that exists. A bus read now logs
`hit: true` when it hands back at least one message.

### Where the rest lives: `~/.config/beadcause` is a git repo

The memory that follows an agent, and the blackboard, have no repo they belong to —
the beadcause advocate and the sorrel advocate work in different checkouts, so a store
inside either one is a store the other cannot see. So the config directory — the one
place every agent on this Mac has in common — became a repo, and both of those ride on
refs in it:

```
refs/beadcause/memory            one commit per write, tree = <agent>.json
refs/beadcause/bus/<topic>       one commit per message, tree = message.json

git -C ~/.config/beadcause log --format='%aI %s' refs/beadcause/memory
git -C ~/.config/beadcause cat-file -p refs/beadcause/memory:advocate.json
git -C ~/.config/beadcause log refs/beadcause/bus/proposals
```

Same trick in both stores, and the same one as the session logs: a ref outside
`refs/heads/*` and `refs/tags/*` has no working tree, so the daemon can commit one
while something else is rewriting `config.json` beside it — or while you are mid-edit
in the repo the note is about. **Nothing in either store is fetched or pushed.** The
config repo has no remote at all; the repo a note lives in usually does, and that is
where the refusal earns its keep, because agent-written text carries absolute paths and
whatever tool output scrolled past. A ref outside `refs/heads/*` and `refs/tags/*` is
in no default refspec, so this costs no guard beyond never naming one. Note that `git
log --all` *does* show these commits — `--all` means every ref under `refs/`, not every
branch — which is how you find them by accident, and `git log`, `git branch` and `git
status` do not.

**The `.gitignore` is written before `git init`, and that ordering is the whole
safety of it.** That directory holds `android-keystore.jks` — the release signing
key for the Android app — and its password file next to it. A `git init && git add
-A` there commits a signing key into a history that is then genuinely hard to
remove. So the ignore file lands first, *and* every commit re-checks the staged list
against a denylist and aborts rather than dropping the file quietly. An ignore rule
is one `git add -f` away from not applying; the cost of being wrong once is a
rotated key.

**A name is no protection at all for a secret written inside a file that is meant to
be committed, so the commit greps as well as reading names.** `config.json` is
snapshotted on every write on purpose — the history of the state files is half the
reason this repo exists — which makes it the one file here guaranteed to be in the
history, and Google sign-in arrived with a `clientSecret` field in it. So every
snapshot searches its staged blobs for a secret written in as a field, and for the
literal contents of every secret file in that directory; a hit aborts the commit and
leaves nothing staged. The second half is not paranoia — `consoles/` is committed and
holds whatever was typed into a chat, and a secret pasted into a chat is the most
ordinary leak there is. Only the *staged* files are searched, so this guards what is
about to go in and never re-litigates what is already there; `npm run secrets` is the
tool for that question, and [rotation](integrations.md#where-the-two-secrets-live-and-how-to-rotate-them)
is the answer to it.

**And an existing ignore file is topped up, because the pair of those rules had a
gap.** The file was written once and never looked at again, so a rule added to
`lib/commonrepo.js` afterwards only ever protected fresh installs — which stayed
harmless until the tailnet certificate arrived and put a `.key` in that directory.
The denylist did its job and the key was never committed; what it did instead was
abort **every** snapshot from then on, and a history that has quietly stopped looks
exactly like one with nothing to say. So `ensureRepo` now appends any rule the file
predates — appends, never rewrites, so a line you added by hand survives — and says
in the log which ones it added. `test/commonrepo.mjs` holds it.

**A snapshot that loses a race is fine; one that loses it forever is the same silence
again.** Two processes writing here collide on `index.lock`, one loses, and dropping
that commit is deliberate — the state file is already safe on disk and the next write
picks up both changes. A git that *died* holding a lock produces the identical log
line and never resolves: bc-xl7n.79 was a zero-byte `HEAD.lock` from 11 August, no
holder, and six days of `common repo snapshot failed` scrolling past while nothing was
committed at all. So `commit()` now tells the two apart on the failure path only. A
lock is cleared and the snapshot retried once when **both** halves hold — untouched for
over ten minutes, and open in no process, asked of `lsof` because git keeps the fd open
for a lock's whole life and the file itself records no pid. Unknown means leave it: no
`lsof`, a timeout, anything but a clean "nobody has this", and the lock stays, because
the alternative is deleting one out from under a `git commit` somebody is typing a
message into. A refusal about a secret is never retried.

**And `lsof` is found by absolute path, because asking `PATH` for it never worked here.**
That fix shipped and then cleared nothing for the next 37 hours (bc-xl7n.109). On macOS
the binary exists only at `/usr/sbin/lsof`, and the daemon's launchd `PATH` — node,
Homebrew, `/usr/local/bin`, `/usr/bin`, `/bin` — has no `/usr/sbin` in it, so every call
threw `ENOENT`, which is not `lsof`'s exit 1, so the answer was always "I could not tell"
and the fail-closed rule did the rest. An *interactive* shell does have `/usr/sbin`, which
is why every hand-run of the fix said it worked and the one place it ran said nothing at
all. So `heldBy` tries `/usr/sbin/lsof`, then `/usr/bin/lsof`, then `PATH`
(`BEADCAUSE_LSOF` overrides all three), and a genuinely missing `lsof` is now **said once
in the log** rather than being the same silence as "nobody holds it" — the whole cost of
this bug was that the two were indistinguishable. `/usr/sbin` was added to the plist in
`scripts/install.sh` too, but nothing depends on that. `test/commonrepo.mjs` poses both
halves: the clear still happens with every `lsof`-bearing directory stripped off `PATH`,
and with no `lsof` anywhere the lock survives and the complaint is printed exactly once.

### Two writers, and why it is a compare-and-swap

Every write reads the ref tip, builds its value from it, and hands that tip back to
`update-ref` as the expected old value. Git refuses if anyone landed first, and the
whole operation retries against the new tip — not just the commit, because losing
the race means the value you merged into is stale too.

The interesting case is the *first* write to a ref, where every writer reads `null`
at once and each believes it is creating it. `update-ref <ref> <new>` with the old
value left off means "overwrite whatever is there"; the empty string means "and it
must not exist". Omitting it made six concurrent posts to a new topic land as one
surviving commit with five silently lost and no error anywhere. `lib/gitref.js` now
always passes it, which also closes the same hole for foundations and session logs.

`node test/memory.mjs` races six processes onto one topic and asserts the sequence
1..6 is there exactly once — a compare-and-swap you have not raced is one you have
not tested.

### The state files get a history for free

The same repo means `config.json`, `state.json`, `advocates.json` and the consoles
are now committed after they change — which is what the `config.json.bak-20260808`
and `config.json.bak-scope` sitting in that directory were: backups made by hand at
moments somebody was nervous. `git -C ~/.config/beadcause log` answers "what did
this say before the advocate rewrote it" without anyone having remembered to ask.

Snapshots are debounced by two seconds and the reasons accumulate, because one
advocate cycle rewrites `advocates.json` three or four times in a second and those
are one event to whoever reads the history back. `status.json`, `restart.json`,
`handovers.json`, `merge-sweeps.json`, `sweep-cards.json`, `coverage.json`, `logs/`
and the check PNGs are ignored — churn, and not the thing you want a history of.
`deploys/` is not, and the difference is the point: a deploy record is something somebody
pressed Ship on, and a restart marker is one line the router overwrites on every swap
which means nothing thirty seconds later. [The trail beside it](incidents.md#and-the-trail-the-release-board-reads)
is the same argument at twenty rows: rewritten whole every time the port changes hands, so
a commit per swap would be those same rows written twenty times over. The coverage report is the same argument in a
larger size: a few hundred kilobytes rewritten whole by every [`npm run coverage`](development.md#npm-run-coverage--which-files-the-suite-never-even-loads),
true only of the commit stamped inside it, so a history of it would be one enormous diff
per run saying nothing the run did not print.

### Tier 3 — a repo one agent owns, and the experiment that is the point of it

Tiers 1 and 2 settled durability. What they did not answer is what an agent does with
a space nobody has designed. So four agents — the repo advocate, the Epic Advocate, the
worker and the reviewer (bc-36xx.23, once windows actually opened on it) — are each given
one:

```
~/.config/beadcause/agents/<workspace>/<agent>/
```

A real directory with a real working tree and a real `.git`, outside every project
checkout, **seeded with nothing at all**. No README, no schema, no example. That is
the instrument rather than an omission: what an agent reaches for when handed an
empty space is a fact about agents, and a seeded repo would only tell you it can
follow a template. `lib/agentrepo.js` provisions it and `bin/beadcause-agentrepo` is
how the agent reaches it.

```
beadcause-agentrepo path                   where it is
beadcause-agentrepo ls [<dir>]             what is in it
beadcause-agentrepo cat <file>             read one
beadcause-agentrepo write <file>           write one; content on stdin
beadcause-agentrepo rm <file>              delete one
beadcause-agentrepo git <args...>          any git command, inside it
```

**Success is not that the state was durable.** Success is the agent doing something
nobody designed for, and the bead says to evaluate it that way or the result means
nothing — which is why half of `lib/agentrepo.js` is measurement.

#### The prediction under test, and the two arms

*The agent writes on the first turn of every session and never reads back*, because
nothing prompts it to. A repo with no recall path is a write-only diary, and the
variable that decides it is not the repo — it is whether session start says "you have
a memory, and here is what is in it". The same lesson `MEMORY.md` teaches, and the
same one `beadcause-memory agents` taught above: a capability nobody was told about is
indistinguishable from one nobody chose to use.

So every survey runs one of two arms, and the comparison is the finding:

| | **`blind`** | **`index`** |
|---|---|---|
| the brief | the directory exists, and how to reach it | the same, **plus a listing of what is in it** |
| what it tests | does it write unprompted? | does being shown it make it read? |

`advocates.agentRepo` picks: `alternate` (the default) flips between the two per
workspace **and agent**, `blind`/`index` pin one for reproducing something the log showed,
and `off` withdraws the affordance and the write grant with it. `alternate` is the default
because the alternative is a switch somebody has to remember to flip, and an
experiment that depends on that produces one arm and no comparison. The key sits under
`advocates` because the advocate was the first agent to have one; all three read it.

Every invocation appends a line to `~/.config/beadcause/agents/usage.jsonl` — the
verb, the target and whether it read or wrote, never file contents. A `session` line
is written at *spawn*, so a run in which the agent ignored the repo entirely is still
a run in the denominator; that is the half the prediction turns on.

```
$ npm run agentrepo

Tier 3 — what each agent did with a repo of its own.

worker
  blind  runs 12  touched 5  read 1  wrote 5  readFirst 1  commands 34
  index  runs 11  touched 8  read 7  wrote 6  readFirst 6  commands 51

epic-advocate
  blind  runs 4  touched 0  read 0  wrote 0  readFirst 0  commands 0
  index  NO DATA — nothing has run in this arm, so nothing here is a zero.
```

`readFirst` is the number that answers it: "wrote and never read back" is `wrote`
minus `read`, and "was told what was in there and went and looked" is `readFirst`
under `index`.

#### Three subjects, never added together, and an empty arm that says so

The advocate was the only subject to begin with, and that was very nearly the end of the
experiment. A survey is the rarest thing this daemon does — one per repo per twelve hours
at best, and none at all while a proposal sits unanswered — so in four days the log held
**one** run, in one arm, and the comparison the whole thing exists for could not be
computed. bc-goo.12 put the grant on the two agents that actually run: the Epic Advocate,
which fires on every child event, and the worker, which is most of what opens a window
here at all.

Two rules fall out of that, and both are in `lib/agentrepo.js`:

- **The numbers are read per agent and never pooled across them.** A worker editing
  files for an hour, an Epic Advocate doing one turn of thinking, a repo advocate arguing
  about a queue and a reviewer reading a diff are four populations, and the worker outruns
  the rest by a wide margin — a pooled `readFirst` would report the worker's behaviour
  under all four names. `summary({agent})` narrows it and `summaryByAgent()` lays all four
  side by side. Workspaces *are* pooled inside an agent, because `alternate` flips per
  workspace and agent, so every workspace contributes to both arms in step.
- **An arm with no runs prints a sentence, not a zero.** `readFirst 0` under `index` is
  the result the prediction expects *and* what an arm that has never run says. That
  ambiguity is exactly how four empty days went unnoticed, so `report` refuses to print a
  number for an empty arm and names any agent that owns a repo and has never run at all —
  which is a thing no amount of reading the log can tell you, since a run that never
  happened leaves nothing behind.

#### The real work is permissions, not git

The console allowlist is load-bearing rather than belt-and-braces, and this is the
first time an unattended agent here has had anywhere it may write. Three things keep
that down to a sentence you can hold in your head — *this agent may write inside its
own directory, and nowhere else*:

- **One allowlist entry, and it is a command rather than a tool:**
  `Bash(beadcause-agentrepo:*)`. Neither obvious alternative is a fence. `Write`/`Edit`
  take a path specifier relative to the working directory, and this is an absolute path
  outside every checkout. `Bash(git -C <dir>:*)` looks like one and is not: `git -C a -C
  b` chains, so a prefix match on the first `-C` permits a second pointing anywhere on
  the Mac. The wrapper is the fence — every path resolves under the repo after a
  `realpath` on its deepest existing ancestor, so a symlink planted in the tree cannot
  be walked out of, and no option may precede a git subcommand, which refuses `-C`,
  `-c`, `--git-dir`, `--work-tree`, `--exec-path` and `--namespace` in one rule.
- **`ownsRepo` is PROTECTED in `lib/foundation.js`**, in both directions. An agent that
  could amend it *on* would have granted itself write access, and "somewhere of my own
  to keep notes" is exactly the request that reads as harmless on a phone. An agent that
  could amend it *off* could put the directory out of the index, out of the foundations
  screen and out of mind while its contents stayed on disk.
- **Local-only, enforced rather than intended.** No remote is configured and the wrapper
  refuses `push`, `fetch`, `remote`, `clone` and the rest; `.git` is out of bounds for
  the file verbs, because writing `.git/config` by hand is how a repo acquires a remote.
  `lib/sessionlog.js` refused to push by default because a transcript carries absolute
  paths and whatever tool output scrolled past. This inverts the authorship — *the
  agent* decides what lands here — so it can write a secret nobody anticipated into a
  repo nobody reviews. Add a remote after weeks of reading what actually accumulates,
  and know that the only shape which enforces owner-plus-owning-agent is a private repo
  per agent with a fine-grained PAT scoped to that one repository; a shared private repo
  with a ref namespace per agent is cheaper and isolates by convention alone.

The directory is `0700` and its files `0600` — narrowed rather than set, so git's
read-only `0444` objects become `0400` and not a writable `0600`.

#### One line of `.gitignore` that is load-bearing

`~/.config/beadcause` is itself a git repo whose snapshot runs `git add -A`, so
`agents/` is in its ignore file. That is not tidiness. A nested repo is skipped only
once it has a `.git` of its own, so the window between `mkdir` and `git init` — or any
tree an init failed halfway through — would put an agent's private files straight into
the shared history, silently, exactly once. `topUpIgnore` is what gets the rule onto
installs that predate it, and `test/agentrepo.mjs` asserts the outcome against `git
check-ignore` rather than against the file, because the question is what git does.

### Whether any of it is ever read — the Memory tab

Three tiers shipped before anything on a screen could answer the question they exist to
answer: **is an agent actually carrying anything between runs?** Reading it meant git
plumbing — `git for-each-ref refs/beadcause/agents`, `git log <ref> | wc -l` per agent
per repo, and a subtraction — and four minutes of that is what produced the finding the
whole epic turns on. It is an **asymmetry**: the worker has hundreds of notes about this
repo, and the advocate, which runs continuously in every workspace, had written one
memory in its lifetime and none at all here.

So the agents screen has a fifth tab, per agent, and it draws all of it:

- **Tier 1** — notes about this repo: how many keys, how many writes, when the last one
  was, and whether any of it has come back out.
- **Tier 2** — the memory that follows the agent everywhere, the same four numbers.
- **The blackboard** — how many messages this agent has collected, and from how many
  topics. A topic with messages and no reads is a thing published into silence, which is
  worth seeing, because `post`/`read` is a pull and nothing notifies.
- **Tier 3** — the per-arm numbers, `blind` against `index`, for each of the three agents
  that own a repo. Never pooled: a total of one run reads as a live experiment, and
  1-versus-0 is the shape that says the comparison cannot be computed yet. The tab says
  that in words when an arm is empty. It is one agent at a time, because that is the tab
  you are on; `npm run agentrepo` is the same numbers for all three at once, which is what
  you want when the agent you should be worried about is the one you did not think to open.

**Keys and writes are both shown because they are different facts.** A store holds one
value per key and a write overwrites, so 244 commits over 31 keys is an agent that keeps
revising what it knows, and 31 over 31 is one that writes once and never returns.

**What counts as a read, and the thing that deliberately does not.** A read is an agent
running `beadcause-memory recall`, `notes`, `read` or `debriefs` — the honest signal is
that it *chose* to look. A note quoted into a session's prompt is **not** a read: the
daemon does that unasked at every session start (`notesBrief`), so counting it would make
every session read everything and the write-only-diary prediction would be answered by
the instrument rather than by the agents. The existing "unread here" in `notesBrief` is
not a half-built version of this either — it means unread *relative to a bead*, computed
fresh each time by relevance.

**Written and read do not come from the same place, and the tab says so.** A write is a
commit on a ref and is true for the whole history; a read is a line in
`~/.config/beadcause/agents/memory-reads.jsonl` (`lib/memoryuse.js`), which only started
being written when this landed. So "no reads recorded" means nobody has opened it *since
then*, and the pane says that rather than letting a zero read as *never*.

It is a JSONL beside tier 3's usage log rather than another ref, for two reasons that are
both about not damaging what it measures: a commit per read would double the entry counts
the epic is measured by — the same `git log` that says "244 things learned" would start
saying 500 — and every session start reads, so it would put a compare-and-swap on the
hot path of opening a window. It lives under `agents/` because that directory is already
ignored by the common repo, on the grounds that what is under it is *beadcause's
measurement of the experiment* rather than anything an agent owns.

The counts on the screen are the refs themselves (`census` in `lib/memory.js`), so they
cannot drift from what `git log` says, and `test/memoryuse.mjs` asserts them against
`git log` on the same ref in the same assertion.

## What an agent can see — a picture of the running app

Almost everything in flight in this repo is visual. How the graph fits a phone,
where a card lands after its prose reflows, whether the kebab collapses, what the
chat-session pane does at 390px — and every one of those shipped from an agent that had
read the source and never seen the screen. It would write the CSS, run the tests,
and hand over a change it was in no position to have an opinion about.

```
node scripts/shot.mjs [path] [--desktop] [--full] [--wait SEL] [--settle MS]
                      [--out FILE] [--base URL] [--strict]
```

It renders a page of the running daemon to a PNG under `.claude/shots/` and prints
the path. The agent then `Read`s the PNG, which is a thing it could already do — the
missing half was never the looking, it was having something to look at.

```
$ node scripts/shot.mjs /graph?ws=beadcause --wait svg
.claude/shots/graph-ws-beadcause-20260809-150650.png
  http://127.0.0.1:4318/graph?ws=beadcause - 390x844 @3x mobile - 141 KB

what the page complained about
  http: 404 /api/presence
```

**The phone is the default**, 390×844 at 3× with touch and a mobile user agent —
the same device `phone-check.mjs` emulates, so a shot and a check describe the same
pixels. A 1280px screenshot is a picture of the one layout nobody uses, and it hides
exactly the failures worth catching. `--desktop` when the bug really is a
wide-window one.

**The token never touches the command line.** It comes from `loadConfig()` and goes
into `localStorage` through an init script that runs before any of the page's own
code, so the app finds itself already paired and never draws the setup dialog over
the thing you came to photograph. Agent shell commands get echoed into transcripts,
quoted into beads and read on a phone; a secret that reaches the screen once needs
rotating. `?t=` would have put it in the URL bar, which is to say in the screenshot.

**It waits for `load`, never for an idle network.** The app holds a WebSocket open
for live updates, so the network is never idle — an idle-wait would have timed out
on every page that rendered perfectly. `load` then a settle, and `--wait SEL` for a
page that fans out over every workspace before it has anything to draw.

**The console errors are output, not decoration.** A screenshot shows you a blank
panel. It does not show you the 401 behind it, and that is precisely the case where
a picture on its own actively misleads. `console.error`, uncaught exceptions, failed
requests and any response ≥ 400 are collected, deduped and printed under the path.
The 404 in the example above is real, and nothing else in the repo was going to
mention it.

Exit code is 1 when the page never loaded — Chrome renders its own error page in
that case and reports no error at all, so without it a shot of "this site can't be
reached" would read as a page that rendered. `--strict` widens that to any complaint
at all. Either way it still writes the PNG: a run that produces nothing sends the
agent back to guessing from source, and the error state is usually the single most
informative frame there is.

Two shots taken a week apart differ only where the app does — `prefers-color-scheme`
is pinned dark and `prefers-reduced-motion` to `reduce`, because an animation caught
mid-flight is a diff every single time.

It drives headless Chrome over the DevTools protocol on Node's global `WebSocket`,
the same way `scroll-check.mjs` and its five siblings already do, so it adds no
dependency and downloads no browser. Chrome is looked up in the usual places and
`CHROME_PATH` points it somewhere else.

`node scripts/shot-check.mjs` is what keeps it honest, because every way this breaks
is silent — a picture always arrives. Pairing stops working and it photographs the
setup dialog, which reads to an agent as "the app is broken". The error capture stops
working and a 401 behind a blank panel comes back looking fine. So: a fixture page
served from the check's own process, with its own throwaway config and a token this
file knows, shot for real by the real script. Fifteen assertions, including that the
token never reached the output and that the page itself agrees about the viewport and
the pinned media. It needs no daemon and no beads, so it can never photograph, or
leak, anything of yours. Like the other headless-Chrome checks it is not in
`npm test` — that suite stays pure Node.

**The advocate gets exactly this and nothing more.** `Bash(node scripts/shot.mjs:*)`
is in its `allowedTools` baseline — one command, not `Bash(node:*)`. The point is to
let it look, not to let it run arbitrary JavaScript, and `writes: false` would mean
very little standing next to a general `node`. Worker sessions needed no change at
all: `allowedTools` is `null` there, so the moment the script existed they could run
it. And `.claude/shots/` is gitignored, because every PNG is a picture of real
beads.

## The map — which steps are code, and which are an agent

Everything above describes one feature at a time, in the order they were built. What that
leaves unanswerable at a glance is the question anybody meeting this system asks first,
and the one you need to be able to answer before you can trust it with a Mac overnight:
**where does the code stop and an agent start?**

It is not a rhetorical distinction. A `bd ready` filter and an unattended `claude -p` sit
two lines apart in lib/advocate.js and read almost the same in prose. One is a decision
this repo makes deterministically, can be tested, and can be reviewed in a diff; the
other is a decision handed to a model with a tool allowlist and a timeout. The advocate
flow is the case in point — the eleven-filter narrowing chain is *entirely* procedural,
and an agent is spawned only at its two ends.

    node scripts/flowchart.mjs            # write docs/flowchart.html and say where
    node scripts/flowchart.mjs --list     # the flows, the agents and the counts, in the terminal
    node scripts/flowchart.mjs --check    # is the map still true of the tree?
    open /flow                            # the same map on the phone, live

Eleven flows, a hundred and twenty-odd steps, and every step is one of six kinds:

| | | |
|---|---|---|
| **procedural** | a function in this repo | same input, same output — reviewable in a diff |
| **agentic** | a Claude Code process with a foundation | what it does next is not decided here |
| **you** | a tap or a keystroke | the decisions nothing may make for you |
| **on the phone** | the PWA, the Android shell, the service worker | code, but not on this Mac |
| **off this Mac** | GitHub, JIRA, Confluence, ntfy, Slack, another laptop | can be slow, absent or wrong |
| **state** | the tracker, a git ref, a file under `~/.config/beadcause` | where a restart is survived |

Each kind has a shape as well as a colour, because a boundary you can only see on a good
screen is not one.

**One diagram, one card.** Tap a shape and it fills the detail card — beside the drawing
on a laptop, directly under it on a phone — with what that step actually does and the
modules it happens in. The first version listed all sixteen steps as cards below the
diagram, which is two documents about one subject and made the drawing a picture you
scroll past. Under the diagram there is now an index of numbered chips instead: how you
reach a step you cannot find in the drawing, small enough not to compete with it.

Selection is shown in four ways at once, and that is not decoration — the whole gesture is
tapping a small shape in a chart that scrolls. Everything else dims, the chosen shape takes
the accent as its outline and a halo, it flashes once, and its chip and card say so too. On
a phone the card is below the fold of the diagram, so the shape is often the only part of
the answer you can see.

### The agent halves are read, never written down

The seven agent kinds on that page — what each may run, whether it may write to the
tracker, its timeout, its model, and the whole of its role prompt — come out of
lib/foundation.js at render time. Nothing about an agent is restated in the model, and
that is the point rather than an economy: a diagram carrying its own copy of an
allowlist would be a second definition of an agent, which is exactly what
[lib/foundation.js exists to prevent](#what-an-agent-is--and-how-it-asks-to-be-different).

Which is also the one difference between the two places you can read this. `/flow` in the
app hands the renderer the **effective** foundations — the baselines with every amendment
you have approved on this Mac applied, and it says which fields moved. `docs/flowchart.html`
draws the **baselines**, because a file rendered from one Mac's approved amendments is not
a document about this repo.

That file is **generated and gitignored**, not committed. It takes a second to write and
it would otherwise change whenever any agent's foundation did, putting a
regenerate-and-resolve on every branch that touched lib/foundation.js for its own
reasons — and a checked-in copy has no way to say it has gone stale. `docs/architecture.html`
is the cautionary case: it is hand-written, it is good, and it still describes four agent
kinds.

### What stops it going stale, and what does not

A hand-written map goes stale; the only question is whether it says so. Every step names
the modules it happens in, and `node test/flowchart.mjs` — in `npm test` — asserts they
are still in the tree, that every edge lands on a node, that no node is orphaned, and
that every agent kind in `BASELINES` is drawn somewhere. A sixth kind added the way the
fifth was fails the suite rather than being quietly left out of the picture.

What none of that catches is a step that moved *inside* a file it still names, and it is
worth saying out loud rather than implying otherwise. Nothing short of writing the code
twice would catch it, and the second copy is always the one that rots. The map is a
judgement with a machine-checked index: the judgement is the part a person has to keep,
and the index is what stops the judgement's *references* going quietly wrong.

`node scripts/flow-check.mjs` is the browser half — that mermaid actually drew rather than
leaving its source in a `<pre>`, that a tap lands on the right card, and that the diagram
follows the colour scheme rather than being frozen light. That last one is why the model
emits a bare `class` per node and no `classDef`: mermaid writes a `classDef` out as an
inline `style`, which beats a stylesheet, and the failure only shows up on a phone in the
dark. Like every other `*-check.mjs` it needs a headless Chrome, so it is not in
`npm test`.

**It is not a pill, and `/flow` is not on the row.** By [that row's own
rule](navigating.md#getting-around--the-pill-row) a place on the navigation is a claim that a page is somewhere you go
repeatedly, and this is a page you read when you are new to the system or arguing about
it — not one you check. `/map` is the same page, because both are what somebody types.


## The conversation, both ways

*Comment only* is not a dead end — it starts a thread.

- **You → agent.** Commenting without answering labels the bead `human-replied`.
  That's the signal a session can actually find: `bd list --label=human-replied`
  shows every question waiting on an agent rather than on you. The card shows
  "⏳ you replied · waiting on an agent to pick this up".
- **And then it gets out of your way.** Commenting collapses the card and sinks it
  below everything still waiting on you, dimmed. Leaving it open in front of you
  implies there is something left for you to do with it, when the next move belongs
  to the agent. The reply landing clears the flag, so it rises back into the queue
  in its own place — priority, then age. Answering removes it outright; that was
  always true.
- **Someone actually answers.** A comment dispatches an unattended `claude -p` in
  that workspace's directory to read the thread and reply on the bead. Without it
  `human-replied` was only a *passive flag*: it waited for an agent session to come
  looking, and the session that filed the question had exited days ago. Five threads
  sat unanswered that way, one of them reading "Can anyone hear me?".
  The agent runs with a narrow allowlist — the `bd` verbs that only look,
  Read/Grep/Glob, and the [web lookups](#looking-something-up--and-why-it-is-not-bashcurl),
  so it can research and comment but not edit anything — and is told to comment with
  `--actor claude-session`, never to close the bead. One agent per bead at a time.
  Off with `autoDispatch: false`, and workspaces you marked as shared during setup
  are excluded for the same reason they push `minimal`.
- **Agent → you.** The poller watches those threads and pushes an ntfy the moment
  a comment lands from anyone other than `beadcause`, then clears the flag. Only
  questions you've replied to are watched — `bd human list` carries no comment
  count and a comment doesn't move `updated_at`, so this costs one extra `bd`
  call per watched thread per tick, and there are usually none.
- **Links in comments are live.** Comment bodies render as markdown, bare URLs
  autolink, and local paths become reader-tab links, all opening in a new tab.
  Comments from an agent are marked with an accent bar.

### Watching it work — the session log

A dispatched agent can take minutes, and until it comments there was one piece of
evidence it had picked your comment up at all: a chip saying **thinking**. For a
run that long that is indistinguishable from nothing happening — the exact failure
auto-dispatch was built to fix.

So a card with an agent on it carries a **Session log** button, and it tails what
the agent is actually doing:

```
● dispatched in /Users/you/projects/acme
● session 4f1c9a2b · claude-opus-5 · cwd /Users/you/projects/acme
  > Bash bd show ac-abc
    ○ ac-abc · Deploy to staging before the demo? [P1 · OPEN]
  > Grep stripe.*fee
Both fee models are in lib/billing.js — gross is the default…
  > Bash bd comment ac-abc --actor claude-session "…"
● done · 47s · $0.0231
```

`dispatchReply` used to buffer the run with `execFile` and throw the output away.
It now runs `claude -p … --output-format stream-json --verbose` (the CLI refuses
stream-json under `--print` without it), and every event is turned into the line a
terminal would have shown and appended to a per-bead file under
`~/.config/beadcause/logs/`. **The rendering is server-side** (`lib/agentlog.js`),
so the format lives in one place and the phone only ever receives text — the same
renderer the session archive replays with. An event type nobody has handled yet
draws nothing rather than a wall of `{"type":…}`, because the point of the pane is
that it reads like a CLI.

`GET /api/agent-log` returns the tail — capped at 64KB and 400 lines, from the
*end*, since what a run in progress is doing now is always the last thing in it —
and a `running` flag. The pane polls every two seconds while the agent is up, keeps
your scroll position unless you were already at the bottom, and stops asking the
moment `running` goes false: a finished log does not change, and an open pane must
not cost a file read every two seconds for the rest of the day. The pane itself
stays until you close it, which is why the button outlives the `human-replied`
flag that first drew it — the reply often lands while you are still reading.

It is 9.5px monospace with `white-space: pre`, scrolling sideways rather than
reflowing. The output was laid out by something counting characters at 80 columns,
and wrapping it would destroy the only alignment it has.
