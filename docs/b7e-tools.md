# The b7e tools — the repo’s own command surface

**Each tool is documented in its own file, under [`docs/b7e/`](b7e/).** `docs/b7e/b7e-def.md`
is where `b7e-def` says what it takes and what it answers, and so on for roughly a hundred
commands. This chapter holds what is true of the family rather than of one of them.

`b7e-readme <term>` finds the section that covers something across the whole
specification, `b7e-which <question>` names the command that answers a question, and
`b7e-section` prints one section with its line span. All three read the directory, which
is why there is no index of the tools committed anywhere: **a list naming every tool is
itself a line every new tool has to append to**, and that is the thing this arrangement
exists to get rid of. `ls docs/b7e/` is the list.

### Adding one `b7e-*` tool — what it touches

Nothing anybody else is editing, which is the whole design:

| New file | What it is |
| --- | --- |
| `bin/b7e-<name>` | the command, with its `@grant` line and the paragraph arguing for that grant in its own header (`b7e-scaffold` writes the skeleton, `b7e-register` writes the registration) |
| `lib/<name>.js` | whatever it does, so the suite can call it without spawning a process |
| `test/b7e<name>.mjs` | the proof — `b7e-harness` computes the house shape rather than copying a neighbour |
| `docs/b7e/<name>.md` | the `### <what it answers> — \`b7e-<name>\`` section, which `b7e-enroll`'s check 5 asks for by that path |

Plus one line in `package.json`'s `bin` map and its mirror in `package-lock.json`, which
`b7e-register` writes and which `.gitattributes` gives `merge=union` so two branches adding
a line resolve themselves. That is the whole of it.

It was not always. Until bc-fmk4v a tool also appended its section to the end of *this*
file and its grant argument to the end of `lib/tooldecl.js`, and both were one shared
anchor: of the 48 open pull requests on 2026-09-19, **13 conflicted in `docs/b7e-tools.md`
and 7 in `lib/tooldecl.js`** — every one of them over text no other branch had an opinion
about. A conflict is a question, and these were questions nobody had asked. So the section
became a file per tool and the argument moved beside the `@grant` line it argues for.
`test/pertoolfiles.mjs` fails the repo if either anchor starts growing back.

### A new tool declares its own grant, and edits no registry

Adding one `b7e-*` tool used to mean editing three shared lists it had nothing to do with:
a line in `lib/grants.js` saying it reads rather than writes, seven in `lib/toolbelt.js`
putting it on `DEFAULT_TOOL_LIST` with the paragraph arguing for it, and a line in
`package.json`'s `bin` map mirrored again in `package-lock.json`. Four files, on top of the
three that were actually new — and every one of those lines went in at the same place in
its file.

Which is why they collided. On 2026-08-26, **ten of the fourteen open pull requests touching
`lib/grants.js` were inserting at line 333**, right after the last `b7e` grant, because
there was only one place to put it. One of them landing conflicted the other nine — not by
bad luck, by construction. [`merge=union`](landing.md#most-conflicts-never-happen--four-registries-git-is-told-to-merge-both-ways)
made those conflicts resolve themselves; this makes them not happen.

A tool now says what it is once, in its own header, next to the argument for it:

```
 * @grant read                     on the list, and lib/grants.js classifies it a read
 * @grant write: <why, >=20 chars> on the list, granted to dispatch alone, and classified
                                    a write for the reason given after the colon
 * @grant excluded                 deliberately NOT on the list
```

A bare `@grant write` with no reason — or one under twenty characters — is not silently
accepted: `lib/grants.js`'s `grantProblems` requires every write grant to carry a reason and
a named holder, and `write` was, for a while, the one kind that could never satisfy that
(bc-dgx7.161) — nothing in the header had anywhere to put either one. The reason now rides
the declaration line itself, after a colon that has to sit right against the word `write` —
not just any whitespace — because this file argues about the `@grant` marker constantly in
plain prose, and a looser separator would have read one of those arguments as a second,
accidental declaration. `granted` needs no syntax of its own: a header-declared grant only
ever reaches an agent through `DEFAULT_TOOL_LIST`, which `lib/foundation.js` gives to
`dispatch` alone, so `granted: ['dispatch']` is filled in for every write declaration rather
than written out by hand.

`lib/tooldecl.js` reads `bin/` and assembles `DEFAULT_TOOL_LIST` from the hand-written half
in `lib/toolbelt.js` plus every tool that declares itself granted; `lib/grants.js` spreads
the same declarations. **Adding a tool now touches only new files** — `bin/b7e-X`,
`lib/X.js`, `test/b7eX.mjs` — and the pattern is built from the filename rather than typed,
because `Bash(b7e-window:*)` written out by hand is one more thing that can be written
wrong, and a grant that does not match its command is a grant for nothing.

**`excluded` is a decision, and that is the part that got stricter.** Twenty-nine of the
family are deliberately off the list. `b7e-enroll` has always treated that as exactly as
real as being on it — a tool is unpaid only when *neither* is true — but it used to
establish it by looking for the tool's name anywhere in the array's comments, which cannot
tell a decision from a mention. A tool named in passing inside somebody else's paragraph
read as settled. The `b7e-hunks` paragraph in `lib/tooldecl.js` says so in as many words:
it exists partly to *make* a decision that an accidental name collision had already implied.
A `@grant` line cannot be written by accident.

Two tools declare nothing — `b7e-packet` and `b7e-say` — because nobody has decided about
them. `b7e-enroll` reported both as unpaid before this and reports both after it. The
migration deliberately did not decide on their behalf.

**The argument stayed behind, and then it moved too.** bc-wbrhi left every paragraph
explaining why one of these is on the list, or why it is not, in `lib/tooldecl.js`, in the
order it was written and not one word of it rewritten — because the run argues by
cross-reference: twenty-six of the thirty-four blocks name a sibling tool and seventeen do
it positionally (*"just above"*, *"the four above"*, *"beside them"*), and cutting it up
loses the order those words point at.

The cost of keeping it whole turned out to be a conflict per tool branch. `b7e-register`
appended each new paragraph at the end of that one file, so seven of the 48 open pull
requests on 2026-09-19 were colliding there over text nobody else had an opinion about. So
bc-fmk4v moved the sixty-nine paragraphs into their tools' own headers, directly above the
`@grant` line each argues for, and answered bc-wbrhi's objection rather than ignoring it:
nothing was rewritten to paper over the cross-references, every moved paragraph opens by
saying its "above" and "below" name that file's old order, and
`git show 7c47d7d77:lib/tooldecl.js` still reads the run whole, in that order, for anybody
following one back to its referent. The reasoning is one command away; it no longer costs
every tool branch a conflict to add to it.

The one thing this costs is a blind spot worth knowing about: `lib/affected.js` narrows a
gate by reading imports, and `lib/tooldecl.js` reads the filesystem instead. Adding or
removing a tool is visible either way, because the file itself is new or gone — but editing
a `@grant` line *inside* an existing tool is not, so it selects that tool's own suite rather
than `test/tooldecl.mjs`. The full gate covers it, and the file says so in its own header.

### Whether the library is being used — the Skills view

`/skills` (or `/candidates`) is the one screen the whole programme is visible from: the
`b7e-` commands that exist, every candidate the audit agent has filed with what became of
it, and how much archive has actually been read.

**What is not measured leads, and that is the design of the page rather than a caveat at
the bottom of it.** The loop above has an uninstrumented middle: nothing anywhere records
that a skill was *called*. Four of the six numbers this view was asked for — calls per
skill and the distinct sessions making them, time to adopt, dead skills, prompt bytes
removed — are downstream of that one missing fact. A page that drew the candidate list,
the audit runs and the library, and simply had no adoption section, would not read as
incomplete; it would read as a healthy programme. So each of the four is drawn, named,
given the sentence saying why it cannot be measured, and given the bead that would measure
it (`bc-dgx7.6` for the call record, `bc-dgx7.4` for the bytes). They are `UNTRACKED` in
lib/skills.js — data rather than prose inside the page, so the screen cannot drift from the
list and a test can assert every entry names something real.

The numbers that *are* real come from three things that already exist, and this view adds
no store of its own:

- **The library** — the `b7e-*` commands in a checkout's `bin/` and in its `package.json`
  bin map, which is `skillLibrary`'s own answer and therefore exactly what the audit agent
  is deciding *candidate versus miss* against. Beadcause's own runs to nearly a hundred
  commands; where a checkout's is empty, the page says so in words rather than drawing an
  empty list.
- **The candidates** — one `bd list --label skill-candidate` per workspace, closed rows
  included, because *declined* is one of the four states and a declined bead is a closed
  one. The four are read off fields something else already writes: `superseded-by:` first,
  then a close reason starting `Revoked before endorsement`, then the `unendorsed` hold,
  and *accepted* is what is left. The order matters — a revoke deliberately leaves the hold
  on the bead, so a marker test alone would count every declined candidate as one still
  waiting.
- **The ledger** — `refs/beadcause/audits` per checkout: runs, archives read, and every
  **miss**. A miss is the one adoption number that exists today, and the page states the
  thing a proud zero would hide: against an empty library there can be no misses *by
  construction*, because a miss is a command that existed and went unused — so the page adds
  that caveat only while the library is empty.

Candidates are a fact about a beads graph and the library and the ledger are facts about a
checkout, so a forty-repo workspace answers once for its candidates and once per repo for
the rest; the payload keeps the two grains apart rather than summing them into a number
that is true of nothing.

**Nothing on the page writes.** A candidate is taken off hold in [the endorsement
queue](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time), which every waiting row
links to, and the bead itself opens in the graph — the one destination that works for a
candidate in all four states. Forcing an audit run is deliberately not a control here: it
costs minutes and real money, and a one-tap button for that on a phone is the wrong shape
however convenient it looks, which is the argument the
requirement graph makes for having no promote button of its own.

It is not a pill on the view row, for the reason `/requirements` is not one: a page you
read when you are new to the system or arguing about it, rather than one you check. It
draws the row anyway, with nothing on it current.
