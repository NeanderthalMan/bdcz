# Compliance — controls, evidence and the generated registers

## The control corpus — six standards in one closed vocabulary

A compliance framework is a vocabulary before it is anything else, and the failure it invites
is the same one the requirements corpus above exists to prevent: an agent asked to name a
control before the vocabulary exists **invents one**, and a fabricated `ISO42001.A.6.2.9`
sitting beside the real `ISO42001.A.6.2.8` is two nodes in the graph forever with nothing to
tell them apart. So `lib/controls.js` is a closed set, and an id that does not resolve is
refused at the door rather than stored and believed.

**The part that is not obvious is that there is one corpus and not three.** The tempting
shape — a file per standard — is how the same control gets implemented three times and
evidenced three times, because nothing in it can say that SOC 2's `CC6.1`, 27001's `A.8.3`
and half a dozen 42001 controls are *one implementation with three names*. Instead a record
carries a **framework**, an **id within it**, a **kind**, and **crosswalk edges** to its
counterparts:

| Framework | Edition | Holds | Kind | Count |
|---|---|---|---|---|
| `SOC2` | AICPA TSC 2017, with the 2022 revised points of focus | criteria — CC1–CC9, plus A1, C1, PI1 and P1–P8 | criterion | 61 |
| `ISO27001` | 27001:2022 Annex A | controls — organizational, people, physical, technological | control | 93 |
| `ISO42001` | 42001:2023 | Annex A controls — A.2 to A.10 | control | 38 |
| `ISO42001` | 42001:2023 | management-system clauses — 4 to 10 | clause | 32 |
| `ISO23894` | 23894:2023 | risk management — principles, framework, process | process | 22 |
| `ISO42005` | 42005:2025 | impact assessment — how it is run, what it covers | process | 16 |
| `ISO5338` | 5338:2023 | AI system life cycle processes | process | 31 |

293 records and 348 crosswalk edges, all of it shipped with beadcause. Unlike the
requirements corpus this one does not ride in another repo: the standard does not change per
install, so an absent corpus here is not a state to degrade into, it is a broken build. There
is no config key, no environment variable and no loader — the tables are in the file and the
indexes are built at import.

### Why the framework is inside the id

`A.5.2` is *Information security roles and responsibilities* in 27001 and *AI system impact
assessment process* in 42001. Two standards, same local id, entirely different control. A
corpus that kept the framework in a field beside a bare `A.5.2` would have one key for two
things and would resolve whichever it read last — the silent-wrong-match failure `lib/edits.js`
argues about with matching an epic by its title. So the id **is** `ISO27001.A.5.2` and
`ISO42001.A.5.2`, and there is no way to write one down without saying which standard you meant.

That is also what makes the corpus extend rather than fork, and it has now been extended
three times over: ISO/IEC 23894 risk-process ids, 42005 impact-assessment ids and 5338
life-cycle-process ids are three more tokens and three more tables, not three more modules
with their own idea of what a control is — exactly as a regulatory requirements corpus
can carry `EN`, `AS` and `CDP` in one set.

### One standard asks for two different things, and they are audited differently

ISO/IEC 42001 has two halves and only one of them is a control set. Its **management-system
clauses 4 to 10** are audited *by record*: there is a scope statement or there is not, a
management review happened or it did not, and what an auditor asks for is the document. Its
**Annex A controls** are audited *by evidence of the control operating*, over a period, on a
sample. Using one word for both is how a programme comes to hold a filing cabinet and call
it a control set — and it is the more common direction of the mistake, because Annex A is
the part that looks like work.

So `kind` is on the **record**, from a closed set of four — `criterion`, `control`, `clause`,
`process` — and a framework declares which kinds it may hold. `ISO42001` holds two, and
`ISO42001.Clause8.3` and `ISO42001.A.6.2.8` are both real ids under one token. `byKind('clause')`
is the question a gate asks when it wants the whole management system regardless of which
standard wrote it down, which no id shape can answer on its own.

The clause ids also close the last of the common-criteria gap. Clause 6.1.3 — select the
controls, compare them against Annex A, and record what was excluded and why in a Statement
of Applicability — is the requirement a certificate is actually issued against. Annex A on
its own is a reference set with nothing that decides which of it applies.

### A certifiable standard is cited by number, a guidance standard by name

`ISO42001.Clause8.3` quotes the numbering of 42001, because that numbering is load-bearing
outside this repo: a certificate, a Statement of Applicability and an audit finding all point
at a clause *number*, and an id that did not match would be wrong in the one place it is read
by somebody who is not us.

ISO/IEC 23894, 42005 and 5338 are **guidance**. Nobody is certified against them, nothing
anybody signs cites their numbering, and what they are worth here is their subject matter. So
their ids name that subject instead — `ISO23894.Process.RiskIdentification`,
`ISO42005.Impacts.Groups`, `ISO5338.Technical.ContinuousValidation` — and `certifiable: false`
on the framework says so in a field rather than in a convention somebody has to remember.

This is the paraphrase rule below applied to the *id* rather than to the text. Minting
`ISO42005.Clause6.4.3` would assert a numbering nobody in this repo can check, and a clause
number that turns out to be somebody else's clause is the same failure as an invented
control: plausible, unfalsifiable from inside, and wrong exactly where an auditor looks.
Naming the subject cannot be wrong that way, and `test/controls.mjs` enforces the split in
both directions — every id in a certifiable framework carries a digit, and no id in a
guidance one carries any.

The flag is load-bearing on the crosswalk too: **guidance may not claim a criterion.**
`ISO5338.Technical.Verification` reaches `SOC2.CC8.1` through `ISO42001.A.6.2.4`, in two hops,
because a direct edge would put a document nobody is audited against into the answer to *what
satisfies this criterion*. Guidance elaborates a requirement, a control satisfies a criterion,
and the build refuses the edge that would blur the two.

### The crosswalk runs one way, and it is on the control

Edges are declared on **controls, pointing at criteria** — never criteria at criteria. A SOC 2
criterion is satisfied by N controls and one control satisfies M criteria across frameworks,
so the fan-out lives where the implementation lives. Written the other way round, a criterion's
list would need re-syncing every time a control was added, and it would be wrong first and
noticed last.

The inverse is **computed, not stored**. `satisfiedBy()` inverts the declared edges at build
time, so there is exactly one place an edge can be written and exactly one place it can be
wrong — and the build refuses a crosswalk target that does not resolve, which makes the set
closed in both directions rather than only on the way in.

```js
crosswalk('ISO42001.A.6.2.8')   // ['SOC2.CC7.2', 'ISO27001.A.8.15'] — event logs, three names
satisfiedBy('SOC2.CC6.1')       // twelve 27001 controls and two 42001 ones, one programme
satisfiedBy('ISO42001.Clause6.1.2')  // what 23894 says a defensible risk process contains
byKind('clause')                // the management system, regardless of which standard wrote it
controlsIn(bead.description)    // ids by shape, then kept only if the corpus has them
keepControls(declared)          // { ids, dropped } — and `dropped` is said out loud
unclaimed('SOC2')               // the twelve criteria nothing claims, on purpose
```

### Twelve criteria that nothing claims, and why that is the honest answer

`unclaimed('SOC2')` is not empty and is not meant to become empty. Inventing an edge to make
the matrix look full is the one failure this whole file exists to prevent, so the gap is
pinned as an exact list in `test/controls.mjs` and has to be argued with rather than drifted
past. What is left is one reason: **`PI1.4`, `PI1.5` and ten privacy criteria** — output
delivery, stored-record integrity, consent mechanics, data-subject access and disclosure
records are ISO/IEC 27701 territory. That standard is not in this corpus, and a criterion is
better shown unclaimed than mapped to the nearest 27001 control that merely sounds similar.

It was fifteen until the 42001 clauses landed. **`CC1.2`, `CC3.3` and `CC5.2`** — board
oversight, fraud risk and technology general controls — are not Annex A controls in either
ISO standard and never will be; they are management-system clause matter, and they are
claimed now by clause 5.1 (leadership and commitment), clause 6.1.2 (the risk assessment that
has to consider misuse and override) and clause 6.1.3 (selecting the controls and saying
which were excluded). The pin names those three individually against the clause that claims
each, so "the gap shrank" can never be recorded without saying how.

Every common criterion is now claimed by at least one ISO control or clause, and that is
asserted rather than asserted-about. What that adds up to across all three standards at once
is [the crosswalk matrix](#the-crosswalk-matrix-generated--beadcause-crosswalk), which is
generated from these edges rather than kept beside them.

### The text is a paraphrase, and the standard is the authority

Every definition in the corpus is plain language for *what conformity looks like in this
system*: derived, on the SOC 2 side, from the 2022 revised points of focus rather than
invented, and on the ISO side from the control's stated purpose. None of it is normative text
and none of it is quoted — an auditor reads the standard. The corpus exists to join a bead to
a control and a control to its counterparts; it is not a copy of six copyrighted documents
and must never grow into one, which `test/controls.mjs` enforces by failing any definition
that has swollen into a block quote.


## Control to evidence — `refs/beadcause/controls`

The corpus above is a vocabulary. On its own it says which controls exist and which of them
are the same control under three names; it says nothing about whether any of them has ever
*happened here*. That gap is the whole of a compliance programme's failure mode: a policy
document describes a control, an auditor asks for evidence that it operated, and the answer
has to be produced afterwards from memory and a search of Slack.

So a bead **declares the control it exercises**, and a merge is what promotes that claim
from forecast to proof. The requirements graph
[above](advocates.md#which-requirement-a-change-was-for--refsbeadcauserequirements) is the model and
the three pieces are the same three:

| | Requirements | Controls |
|---|---|---|
| what a bead says | `lib/beadreqs.js` — ids **and candidates** | `lib/beadcontrols.js` — ids only |
| what a merge writes | `requirements:` on `refs/notes/beadcause` | `controls:` on the same note |
| the lookup | `refs/beadcause/requirements/<token>` | `refs/beadcause/controls/<framework>` |
| the denominator | `lib/reqcoverage.js`, and it may be absent | `lib/controlcoverage.js`, and it never is |

**There is no candidate list, and that is the one structural difference.** A requirement
usually does not exist yet when a bead is filed, so that block has to be able to hold a
proposal without letting it pass for a fact. A control cannot be proposed: `SOC2.CC6.1` is
published by the AICPA, the corpus ships with beadcause rather than being loaded from a
checkout that may be absent, and a "candidate control" would be an invented control with a
queue behind it. An id that does not resolve is dropped on read and **named** in `dropped`,
because an agent that is not told writes the same invented id every run and from outside
that is indistinguishable from the feature not working.

```bash
beadcause-controls declare beadcause bc-x SOC2.CC6.1 ISO27001.A.8.3   # the forecast
beadcause-controls show SOC2.CC6.1        # the record, both crosswalks, and every commit
beadcause-controls files lib/auth.js      # the reverse lookup
beadcause-controls coverage [--months=N]  # what is unevidenced, forecast-only, or stale
beadcause-controls rebuild <repo>         # the repair, and the proof
```

### Forecast and proof are the same edge with a different word on it

`declared` is a bead saying beforehand what it will exercise. `observed-from-diff` is a
merge having done it. `human-confirmed` is somebody having looked. Nothing anywhere adds
the first to the other two, and the summary line leads with the number that is actually
worth something:

```
9 of 192 controls are proved by a merge (5%) · 3 forecast and not yet proved · 180 with no
evidence at all · 2 whose newest proof is older than 12 months
```

A programme that counted intentions as evidence would read as complete on the morning of
the audit and have nothing to show for any of it. That is why `lib/controlindex.js` keeps
provenance per edge and only ever lets it get **stronger** on re-record: a merge proving
what a bead forecast is new evidence, and the forecast arriving afterwards is not.

**The write happens without anyone remembering to.** `notePending` in `lib/advocate.js` is
the one place in the system that holds a merge commit and a bead at the same moment;
`lib/controllanding.js` hangs off it, next to the requirements half. A bead that claims no
control takes none of it and its landing note is byte-for-byte the note it always was.

### Dated by the commit, not by the clock

An edge's `at` is the **committer date of the merge**, which is a smaller decision than it
looks and the one that makes the review period mean anything. A note carries no date, so a
`rebuild` that stamped "now" would mark all 192 controls freshly evidenced on the day
somebody ran a repair — indistinguishable from good news, and the one failure a staleness
report cannot survive. Taking it from the commit also dates a landing noted late (the sweep
retries until the merge commit is found, which can be hours) when it merged rather than
when the daemon noticed. `test/controlindex.mjs` wipes the store, rebuilds from the notes,
and asserts the clock came back with the same values.

### What the internal-audit instrument actually asks

`GET /api/controls` — and `beadcause-controls coverage`, which is the same four questions
in a terminal. Each answer is a **list with names in it** rather than a count, because
"137 unevidenced" is a statistic and `SOC2.CC6.1` is a task:

- **`unevidenced`** — every control with no edge at all;
- **`forecastOnly`** — a bead said it would, no merge has shown it did;
- **`stale`** — proved, but the newest proof is older than the review period;
- **`orphans`** — edges recorded against ids the corpus no longer has, which is the only
  visible symptom of a control being renamed out from under its evidence.

The four are disjoint **by construction** rather than by care, and that is worth a
sentence. `lib/controlcoverage.js` computes one row per control with a single `state` on
it — `controls[]` in the payload — and the four lists are that register filtered. A control
cannot appear in two of them, and a count cannot disagree with its own list, which is the
specific way a compliance report stops being believed. `test/controlcoverage.mjs` checks
the register against the findings rather than the findings against each other.

**The review period is one number and guidance has none.** `REVIEW_MONTHS` is twelve — the
outside of what "operated throughout the period" means for a Type II observation window or
an ISO surveillance year — and `?months=` measures a report over a shorter one. A period per
record would be 192 numbers nobody chose, copied down a column. What actually decides it is
already on the framework: ISO/IEC 23894, 42005 and 5338 are `certifiable: false`, nobody is
certified against them, and a staleness finding on one would be a finding against a document
that makes no claim.

**Unlike `/api/requirements`, this route has no `{ corpus: null }` state.** That corpus
lives in a checkout most Macs do not have, so its absence is a state to report; this one
ships with beadcause and is built at import, so an unreadable control corpus is a failed
build rather than a payload. The route can therefore always state a denominator — which is
exactly what makes "180 controls have no evidence" a sentence anybody can act on rather
than a shrug.

**It is a hint and never a gate.** No dispatch, hold or edit path consults the index, and
that is asserted at the import boundary in `test/controlindex.mjs` for the reason
`test/requirements.mjs` asserts it of the other one: coverage here is partial by
construction, so a graph that could withhold work would withhold it because nobody had
written a block, which is not a compliance failure and is certainly not a reason to hold a
bead.

## Change management, evidenced — `beadcause-changes`

SOC 2 CC8.1 asks that changes to infrastructure, data, software and procedures are
authorised, designed, developed, configured, documented, tested, approved and implemented
to meet objectives. ISO/IEC 27001:2022 A.8.32 asks the same thing in fewer words. It is
the criterion a first-time service organisation most often fails, and the reason is always
the same: the answer is a convention rather than a control. A ticket template and a code
review culture cannot be tested — they can only be evidenced by a person assembling
screenshots for each sampled change, the week before fieldwork, out of four systems that
were never asked to agree with each other, and what those screenshots show is what the
convention *usually* produced.

Here the answer is a gate, and every part of it already leaves a record:

- an unattended session **cannot be opened on a bead nobody endorsed** — `assertEndorsed`
  in lib/endorse.js is a refusal at the launcher and not merely a filter on a queue, so a
  change has an authorisation or it has no session at all;
- the session is archived against the bead on `refs/beadcause/sessions/<bead>`, with the
  agent, the model, the branch and the commits it made;
- **the worker does not merge its own branch.** It files a merge bead carrying what it
  ran, and its own bead is made to depend on that one, so the approval is a different
  agent looking at the whole board — see [Landing work](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue);
- the merge writes `beadcause: landed <workspace>/<bead>` onto the merge commit, on
  `refs/notes/beadcause`, where it is anchored to an immutable object;
- and the deploy closes a ship bead against the pull request number, or — since auto-ship
  — records it in the release ledger.

**None of that was built for an auditor**, which is exactly what makes it evidence rather
than a claim. The command only reads it:

```bash
beadcause-changes sample --from 2026-04-01 --to 2026-07-01 --size 25 --seed 7
beadcause-changes all --from 2026-04-01 --to 2026-07-01     # the period, not a sample
beadcause-changes summary --from "3 months ago"             # one line, for a log
```

Out comes a document with one row per sampled change and, for each, six columns saying
where the authorisation, the design, the development, the test, the approval and the
deployment record actually are — with the bead id, the merge bead id and the ledger
timestamp, so any cell can be opened rather than believed. Six columns and not eight,
because two of CC8.1's verbs have no separate record here and inventing one would be worse
than saying so: *configured* is the same act as developed in a repository where
configuration is files in the diff, and *implemented* is the commit the row is keyed on,
so a column for it would tick by construction and teach a reader nothing.

**The seed is what makes it their sample rather than ours.** Selection is a pure function
of the seed and the commit hash — a hash, sorted, sliced, no clock and no randomness — so
the auditor picks the seed, nothing here can steer which changes come out, and the same
window with the same seed returns the same 25 rows on any machine next year. `Math.random`
would have made the artefact worthless in the only way that matters: a second run
disagreeing with the one already in the audit file. `test/changesample.mjs` pins the hash
to a literal for that reason, so changing it fails loudly rather than quietly re-selecting.

**Three states, and the middle one is the point.** `✓` a record exists and says so; `✗`
the record that would say so does not exist, which is a **finding**; `?` nothing here could
ask. They are never folded together. A `?` reported as a tick is a lie and reported as a
finding is noise that trains a reader to ignore the findings, and the first version of the
totals counted a row with no findings as a row with a complete record — which made a run
against a checkout with no tracker report 47 of 47 changes clean, the most confident
possible way of saying nothing at all. Clean now means every column evidenced, and the rows
that are neither clean nor a finding are counted and named.

**Nothing is dropped, and the strays are the interesting part.** A commit that reached
`main` outside a pull request is not a change this can shape into a row — no pull request
means no approval covering it individually — so it goes in its own list at the foot of the
report rather than out of the population. A tool that quietly counted only the rows it
could answer for would understate the denominator by precisely the changes that skipped the
process, which is the population an auditor came to find.

The first run over this repository says three true things worth stating out loud, and it is
a better advertisement for the tool than a page of ticks would be. The merge queue is
**new** — the pull requests before #314 have no merge bead, so `approved` is a finding on
almost every historical change and the control has an effective date rather than a history.
The release ledger **prunes at 45 days**, where a Type II observation window is three months
at the short end, so a sample taken at the end of one asks it about deployments it has
already forgotten; the report says so where it would otherwise read as changes that never
shipped, and keeping evidence past the observation window is its own bead (bc-4r10.7). And the strays are real:
the older workflow merged locally and pushed, so those commits are in `main` with no pull
request behind them.

It names no control id yet. The closed control corpus — SOC 2 CC, ISO/IEC 27001 Annex A and
ISO/IEC 42001 in one vocabulary, with the crosswalk edges that make CC8.1, A.8.32 and their
42001 counterparts one implementation with three names — is being built separately, and an
id minted here before that corpus exists is exactly the fabricated-control problem the
corpus is closed to prevent. What the report carries instead is the mapping from each column
to the CC8.1 verbs it answers, in the output where an auditor can argue with it, ready for
the corpus to point at.

## The system boundary, as data — `beadcause-boundary`

A SOC 2 report is not about an organisation. It is about a **system** — infrastructure,
software, people, procedures and data — inside a stated boundary, described to named
**user entities**. Everything downstream is scoped by it: which criteria are worth
electing, which controls are tested, which population a sample is drawn from. An argued
boundary is the cheapest lever in the whole programme, and it is the one most often
written as a paragraph in a document that nothing can read.

So it is a record, validated and read by `lib/boundary.js`. The scope statement [the
election](#what-you-elected-to-be-held-to--libelectionjs) declares is *computed* from it
rather than typed beside it:

    beadcause-boundary show          the whole record
    beadcause-boundary carved        what is carved out, and what each still bears on
    beadcause-boundary entities      the named user entities
    beadcause-boundary gaps          what is not enumerated, and where the rest is held
    beadcause-boundary declare       the projection `declare` takes

### The subject is supplied, not compiled in

Which system is described, for which service organisation and to which user entities is the
organisation's own record — its customers, its product, its contracts. Beadcause holds the
engines; the record is a **subject file** the organisation keeps in its own repository, and
an install names it in config:

    "compliance": { "subjects": { "<org-id>": "/absolute/path/to/subject.json" } }

A subject file is JSON with five fields: `organisation` (the id it is configured under, and
the two must agree), `boundary` (the record this section describes), and the three sections the
joining modules read — `assessment` (`rows`, `notElected`, `decidedBy`) for [the gap
assessment](#the-gap-assessment-computed--beadcause-gaps), `commitments` for
[`lib/commitments.js`](development.md#service-commitments-owed-until-somebody-reads-the-agreement--libcommitmentsjs-testcommitmentsmjs),
and `recovery` for [the restore log](#recovery-testing-a-log-that-goes-red--beadcause-recovery).
An unknown field is a refusal, so a typo is not a section silently read as absent.

**There is no default subject.** An install that configures none has no boundary, no
assessment and no commitments, and `beadcause-boundary`, `beadcause-gaps`,
`beadcause-description` and `beadcause-engagement` each say so in one line naming the key and
exit 0. A file that is missing, not JSON, keyed to a different organisation or fails
validation is left out of the map and **named** — every problem printed, exit 1 — never read
as "nothing is carved out" and never a stack trace. One broken subject does not take a sound
one down with it.

The loaded subjects are a map keyed by organisation id rather than a single record, even on
an install with one entry, for the reason `lib/organisation.js` gives at length: a singleton
is a migration waiting for the second tenant, over the one record whose whole value is that
it has not changed silently. A boundary may mark itself `first`, and two subjects both
claiming it is said. With two loaded, the commands take `--org` (or the `[org]` positional)
rather than guessing.

### Out of the boundary is not out of the audit

This is the distinction the file exists to make impossible to lose. Beadcause opens the
agent sessions that change the repositories the in-scope system is built from, which puts
it in the change-management path whether or not it is part of what is *described* to a
user entity. A carve-out is a statement about the system description and carries no
implication at all about whether an auditor testing CC8.1 will want records out of the
carved-out thing.

So a carved-out component may name what it still `bearsOn`, and a subject that carves
beadcause out names change management. The agent kinds are carved out individually rather
than as one row saying
"beadcause agents", because *what non-human identity can change an in-scope repository* is
a question asked per identity, and a single row answers it for none of them.

### A census is a field, because the alternative is a blank that reads as an answer

This is the part worth arguing with. Almost nothing about a described system's internals is
knowable from beadcause — the repositories, hosts, data stores and egress destinations
inside the boundary are enumerated wherever the organisation keeps its architecture, not
here. The two tempting shapes are both wrong. An empty list reads as
*there are none*. An absent field reads as *not applicable*. Neither is true, and both
validate perfectly against any schema that only checks types.

So every kind of thing a boundary can contain carries a **census** — `enumerated` or
`partial` — and a partial one must name where the authoritative enumeration is `held`. An
empty subservice list under a partial census says *nobody has surveyed the processors
yet*, which is a finding somebody can act on; the same empty list with no census says
*there are none*, which is false and unfalsifiable at the same time.

    $ beadcause-boundary gaps
    What Acme's boundary does not yet know
      repo — 0 recorded, the rest held in the Acme architecture notes
      …
      subservice — 0 recorded, the rest held in the Acme architecture notes
          The subservice list has not been surveyed.

(`Acme` is the synthetic subject the suites load — `test/helpers/subject.mjs`.) `--strict`
exits 1 when there is at least one gap, so a check can gate on it once the enumeration is
expected to be complete. On a first boundary it is not, and the gaps are the honest state of
the record rather than a to-do somebody forgot to delete.

**The carve-outs are enumerated even though the inside is not**, and that asymmetry is
real rather than convenient. Carving something out is a decision the subject can make in
full — everything beadcause is, is knowable from beadcause. Enumerating what is
inside is a survey of somebody else's estate. A census answers for the inside list only,
and `CARVE_OUTS_ARE_ENUMERATED` says so in one place rather than leaving it to be inferred
from a field that does not exist.

### A carve-out owes a CUEC, or a control has vanished

Subservice organisations get a **carve-out** or **inclusive** decision each, and neither
is a default. A carve-out leaves that organisation's controls out of the description and
shifts the reliance onto the user entity — so `boundaryProblems` refuses a carve-out with
no complementary user entity control against it. That is the failure mode worth catching
in code: a control that exists in nobody's report because one document assumed the other
covered it. Inclusive drags the subservice organisation's own controls into the test
population, which is a much larger promise, which is why it is never the quiet one.

`cuecs()` flattens them across every carved-out organisation, because the flat list is
what a user entity is actually handed and reading it out of a per-organisation structure
by hand is how one goes missing.

### What it deliberately does not do

**There is no third disposition.** A component is `inside` or `carved-out`. A thing nobody
has decided about is not a component with an `unknown` state — it is a thing not yet in
the list, and the census is what says so. Adding `unknown` makes the census redundant and
then wrong, because a survey that is complete except for the undecided ones reads as
complete.

**It writes nothing, and reads only the config file and the subject files it names** —
once per process, lazily, straight from the file rather than through `loadConfig()`, which
would write a fresh config on a machine that has none. No git, no tracker, no network. A
boundary that fails validation is left out and said rather than thrown on at import, which
is what it did when the record shipped compiled in: a file somebody else maintains is not a
build, and what matters is that a broken one never answers "nothing is carved out" on the
machine enforcing against it.

**It does not decide what is inside for you.** It cannot; nothing can, from here. The one
thing it can check is whether the record admits what it does not know, and that is what
`test/boundary.mjs` spends most of its checks on.

## The system description, generated — `beadcause-description`

Section 3 of a SOC 2 report is management's description of the system, and it has to meet
the description criteria in **DC section 200**: the services provided, the principal
service commitments and system requirements, the components — infrastructure, software,
people, procedures, data — the relevant aspects of the control environment, risk
assessment, monitoring and communication, the applicable criteria and the controls meeting
them, the complementary user entity controls, the subservice organisations and the method
applied to each, the criteria that are not relevant and why, and the changes and incidents
in the period.

Written by hand it drifts from reality within a quarter, and the drift is exactly what the
auditor tests: the description says four environments and there are six, it names a
processor replaced in March, it lists a policy nobody approved. So it is generated, in
`lib/systemdescription.js`, from records this release already ships — and **the diff
between two periods' descriptions is itself a reviewable artefact**, which is the second
reason and the reason nothing in the output stamps the moment it ran. A generation
timestamp in the body would make every diff non-empty and throw away the whole point.

    beadcause-description show         the whole description, as markdown
    beadcause-description sections     one line per section, and what state it is in
    beadcause-description holes        everything the description admits it does not know
    beadcause-description criteria     the criteria in scope, and what claims to meet each
    beadcause-description assertion    the management assertion draft, unsigned

### Three registers meet here, and nothing else does

Every section is computed from one of three leaves: [the boundary](#the-system-boundary-as-data--beadcause-boundary)
for what is inside, what is carved out and who the user entities are; [the control
corpus](#the-control-corpus--six-standards-in-one-closed-vocabulary) for the
criteria, their definitions and the crosswalk to the 27001 and 42001 controls that are the
same implementation under another name; and [the policy set](development.md#fifteen-policies-each-with-an-owner-and-a-date-it-expires--libpoliciesjs-testpoliciesmjs)
for the procedures component and for what claims to be the documented answer to each
criterion. None of the three imports its neighbours — `lib/policies.js` takes the corpus as
a *parameter* for exactly that reason — and a description is the one artefact that needs
all three at once, which is why the joining lives in a file of its own.

**What it refuses to reach for is the sharper half.** Beadcause carries an incident
register, an access register, a supplier register and a change sample, and wiring any of
them in would be the mistake `lib/boundary.js` exists to make impossible: beadcause is
carved out of this boundary, so a daemon crash is not an incident in the described system.
Out of the boundary is not out of the audit — CC8.1 is still tested against beadcause — but
the *description* is about what a user entity reaches. `test/systemdescription.mjs` reads
the module's own import list and fails the repo if one of them appears, because that
argument cannot be held by a paragraph. The policy set is the exception, and only because
`heldBy()` says the policies are the service organisation's — the loaded subject's — rather
than this daemon's.

### A section that cannot be written says so

The tempting shape is a template with blanks, and a blank in a description reads as an
assertion that there is nothing to say. So every section carries a state, computed and
never declared — `generated`, `partial`, or `unavailable` with the kind of source that
holds the answer named beside it.

    $ beadcause-description sections
    Acme — Widget Cloud
      generated    services          2 entries
      unavailable  commitments       0 entries
      partial      infrastructure    0 entries  2 holes
      …
      unavailable  environment       0 entries
      partial      criteria         38 entries  1 hole
      unavailable  incidents         0 entries

    Acme · Widget Cloud · no period stated · 38 criteria (presumed) ·
    1 generated, 9 partial, 4 unavailable · 10 holes

`holes` is the one worth running: it flattens every gap the records admit to into an errand
list, each with where the answer is held. Most of them are the boundary's partial censuses
arriving one layer up — the census argument is what makes an empty section mean *there are
none* in one record and *nobody has looked* in another, and the description inherits the
distinction rather than flattening it back out. `--strict` exits 1 while anything is
outstanding, so a readiness review can gate on it.

Four sections have no source in this release at all — commitments, the control-environment
narrative, changes and incidents — and they get a **seam** rather than a permanent red, for
the reason `lib/boundary.js` gives about its CUEC gap: a gate nobody can ever pass is a gate
somebody deletes. A caller may hand in a record for those four, held to the same bar as
everything else, where every entry names where the fact is written down. It is deliberately
not reachable from the command line: a flag would put a hand-written section one step away,
which is the thing the whole file refuses. One of the four now has a register behind the
seam — [`lib/commitments.js`](development.md#service-commitments-owed-until-somebody-reads-the-agreement--libcommitmentsjs-testcommitmentsmjs),
which `bin/description.js` supplies from the subject's `commitments` — and while every
category there is owed, the section still prints `unavailable` until somebody reads the
actual agreements.

**No criterion is described twice.** The control-environment section is the description of
CC1 to CC5, and those are common criteria, so they are already stated in full — with their
definitions and what claims to be the documented answer — under the criteria section.
Giving that section its own copy printed the same seventeen definitions on consecutive
pages, so it names the other one instead. What it is genuinely missing is the narrative: how
the organisation actually communicates its objectives, assesses its risks and evaluates its
own internal control, which is a thing somebody writes down rather than a thing a register
holds.

### The generator produces the draft; a person signs it

A management assertion is a signed statement, so it is a human act. `assertion` always
hands back `signed: false` and there is no argument that makes it true — a generator that
could emit a signed assertion is a generator that can forge one. What it does emit is the
draft, with everything standing between it and a signature printed underneath:

    > **This draft may not be signed yet.**
    > - 4 sections cannot be written from any record in this release (commitments,
    >   environment, changes, incidents) — the first thing management asserts is that the
    >   description meets the description criteria, and a description with a section nobody
    >   can write does not
    > - the criteria in scope are presumed from the policy set rather than elected
    > - the record admits to 10 holes across 9 sections

The operating-effectiveness statement appears only over a period and never at a date, which
is the whole difference between a Type I and a Type II report and is a rule here rather than
a formatting choice (`bc-j0o3` owns the decision). The criteria in scope come from the
install's own [election](#what-you-elected-to-be-held-to--libelectionjs) when it has one,
and from the categories the policy set is already written against when it does not — in
which case the document says `presumed` on its face, because a presumption said out loud is
a different artefact from a default nobody noticed.

## The gap assessment, computed — `beadcause-gaps`

Before an auditor is engaged, every elected criterion needs an honest state: **met** — a
control exists and produces evidence; **partial** — one of the two; **absent** — neither. A
readiness assessment sold by a firm is that exercise with an invoice attached, and doing it
first makes the engagement cheap or unnecessary.

`lib/gapassessment.js` is the engine for it; the rows are the loaded subject's
(`assessment.rows` in the [subject file](#the-subject-is-supplied-not-compiled-in)), one per
criterion in the elected categories — thirty-eight of them for CC, A and C. It is the
first module in this programme that is a **join** rather than a register: it imports [the
boundary](#the-system-boundary-as-data--beadcause-boundary), [the control
corpus](#the-control-corpus--six-standards-in-one-closed-vocabulary) and [the policy
set](development.md#fifteen-policies-each-with-an-owner-and-a-date-it-expires--libpoliciesjs-testpoliciesmjs)
exactly as [the description](#the-system-description-generated--beadcause-description)
does, and for the same reason — the three leaves deliberately do not import each other, so
anything that needs two of them is a file of its own.

    beadcause-gaps show              every elected criterion, by category
    beadcause-gaps owners            what each owning function is carrying
    beadcause-gaps criterion <id>    one criterion in full, with what claims it
    beadcause-gaps declined          the categories considered and left out
    beadcause-gaps beads             the one-bead-per-criterion payload, for beadcause-file

### A state nobody typed is a state that cannot go stale

No record carries a state — a subject row that types `state`, `confidence` or `claims` is
refused. It carries two halves — a `control` sentence and an `evidence` sentence, either of
which may be `null` — and the word is derived from them.

That is not tidiness. A hand-written state is the field that goes green first and stays
green: somebody writes `met` in a planning meeting, the control is descoped a month later,
and the row still says met because nothing about deleting a control touches a string
somewhere else. Deriving it means **`met` cannot be written without naming both halves**,
and removing either one moves the state on its own — which `test/gapassessment.mjs` proves
by taking the control off a met fixture and watching it fall to partial with no other edit.
It is the argument [the policy set](development.md#fifteen-policies-each-with-an-owner-and-a-date-it-expires--libpoliciesjs-testpoliciesmjs)
makes about a review date, applied to the other field auditors read first.

The two halves are also the only place a judgement lives. Everything else on a row is
asked of a neighbour at the moment of asking: **which control ids claim to satisfy a
criterion** comes from the corpus's `satisfiedBy()`, because `bc-4r10.1` settled that a
crosswalk edge has exactly one home, and **which policy is the documented answer** comes
from `policiesFor()`. A second copy of either, written here for reference, is how a
criterion comes to cite a control that stopped covering it a year ago — so the suite fails
the repository for any ISO control id appearing anywhere in the module.

### Absent has two meanings, and only one of them is a finding

"We looked and there is no control" and "nobody has enumerated the population this would be
tested against" are both absences. Only the first is a finding; the second is an
instruction to go and survey something. A gap assessment that renders them the same hands a
remediation plan to the wrong people, and thirty-seven identical `absent` rows tell nobody
where to start.

So every row names the [census kinds](#a-census-is-a-field-because-the-alternative-is-a-blank-that-reads-as-an-answer)
its criterion is tested against, and the confidence is read out of the boundary rather than
written down: any kind the boundary records as `partial` makes the row **provisional**, and
a row tested against documents and management rather than an enumerated estate is
**assessed**. On a first boundary most censuses are partial, so a large share of rows are
provisional — and because it is derived, **surveying the estate upgrades them with no edit
to the rows**, and letting a census lapse downgrades them the same way. The suite checks
both directions.

The same rule bites in the other direction: a row claiming `met` against a population
nobody has enumerated is refused outright. You cannot have tested a control over a list
that does not exist.

### No criterion silently absent, and no category silently unconsidered

The failure the bead is named for. A criterion with no control is a row that says so and
somebody reads it; a criterion missing from the list is invisible, and the report is
written without it. A hand-kept list cannot refuse that — it agrees with itself by
construction and is silent about exactly the thing that went missing.

So the list is not hand-kept. The corpus enumerates, and a subject's rows are required to
hold exactly one record per elected criterion, none for an unelected one, and no duplicates.
Every command that reads the assessment runs the check first and refuses to render a
register that fails it — naming each problem, exit 1 — so a criterion added to
`lib/controls.js` and not assessed in a subject is a refusal naming the criterion rather
than a blank in a report.

Election has the same hole one level up: a category nobody mentions and a category somebody
declined look identical in a register that lists only what is in scope. The subject's
`assessment.notElected` records the categories that were left out — each with a
`disposition` of `deferred` or `declined`, the `decision` that left it out and why — and a
category that is neither elected nor recorded as declined is refused, as is one that is
both. `beadcause-gaps declined` is the verb nobody thinks to run and the one that answers
"why is there nothing about privacy in here".

### Zero met is a legitimate finding, and a comfortable number is not

A first assessment is usually almost entirely absent, and that is what a readiness call
would charge to say. The synthetic subject the suites load reads

    Acme · Widget Cloud · 38 elected criteria · 0 met, 1 partial, 37 absent · 20 provisional

and its one partial row is the shape worth recognising: **CC8.1, change management, as
evidence without a control.** Beadcause holds a per-change record for the repositories it
drives, which a subject that carves it out names as precisely why the daemon is [carved out
of the description and still inside the audit](#out-of-the-boundary-is-not-out-of-the-audit);
if nothing describes or approves how a change reaches the organisation's production, there
is no control to test. Beadcause's endorsement gate and merge queue govern how source
changes are authored, which is one input to CC8.1 and none of CC6 — and writing a
comfortable number anyway would produce a register that passes every check and is false in
the only way that matters.

### One bead per criterion, emitted rather than typed

`beadcause-gaps beads` renders the whole assessment as the filing payload `beadcause-file`
takes — a bead per criterion, carrying its state, its owner, the control ids that claim it,
what would be sampled and where the answer is held:

    beadcause-gaps beads | beadcause-file -w beadcause --from bc-4r10.4

It emits rather than files, and that is the point. Thirty-eight beads typed once and never
regenerated drift from the register within a quarter, and a criterion quietly dropped from
the tracker is the exact failure the register exists to refuse — the register cannot lose
one, because the corpus enumerates it. So the decomposition is one command away and derived
from the assessment rather than beside it, and regenerating it after a state moves is the
same command again.

## Recovery testing, a log that goes red — `beadcause-recovery`

SOC 2 A1.3 asks that recovery plan procedures are *tested*, and it is the availability
criterion first reports most often take an exception on: there are backups, there is a
continuity plan, and nothing has ever been restored. A backup that has never been restored is
a control with no evidence. What an auditor samples is a restore performed on a date, by
somebody, from a named backup, with a transcript — so that is what `lib/recovery.js` keeps,
in the subject's `recovery` section, and it computes the one thing that matters about it:
when the next restore is due, and whether it is already late.

    beadcause-recovery [org]            overall state, then one line per in-scope component
    beadcause-recovery [org] --bead     the `bd create --due` line for the next restore test
    beadcause-recovery [org] --strict   exit 1 when it is red

    "recovery": {
      "ownerRole": "operations lead",
      "intervalMonths": 12,
      "tests": [
        { "date": "2026-10-01", "restored": ["orders-db"], "from": "the nightly snapshot of 2026-09-30",
          "by": "J. Smith", "transcript": "OPS-412", "outcome": "restored" }
      ]
    }

**Never run is red.** A subject with no `recovery` section, or an empty `tests` list, is
`never` — the same red as `overdue`, because "has not run" and "has not run lately" are the
same finding. The other red is `failed`: a failed restore stays in the log (it is the most
useful entry there is), must say in `changed` what the plan changed, and does not count
towards the due date — the component stays red until a later restore of it succeeds.

**Every restorable component is held to the interval separately.** Each `datastore` and
`host` the boundary puts inside is its own row, and the overall state is the worst of them,
so restoring the easy store every year does not cover the hard one. A restore may only name
components the boundary puts inside: a restore of something the report does not cover is
evidence about nothing. `intervalMonths` is capped at 12, the longest gap an auditor will
accept across a period.

**The recurring bead is printed, not filed.** `--bead` prints the `bd create --due` line for
the organisation's own tracker, dated today when the test is already owed and at the earliest
due date otherwise. The subject's tracker is not beadcause's, so beadcause does not write to
it; what it does is make the obligation one paste away from the queue people work from.

**Confidentiality has no register of its own here, deliberately.** C1.1 and C1.2 are
answered by the classification, retention and disposal rules `lib/datastores.js` and
`lib/evidence.js` already hold; the corpus now carries `ISO27001.A.8.10` (information
deletion) to `SOC2.C1.2` and `ISO27001.A.8.13` (backup, "regularly tested") to `SOC2.A1.3`,
which were the two missing edges.

## The auditor engagement, dated by readiness — `beadcause-engagement`

SOC 2 has no accredited body and no certificate. The report is signed by a licensed CPA
firm subject to AICPA peer review, so **which firm** is a commercial decision with a
technical half, and **when the period starts** is the decision that quietly decides whether
the report comes back clean.

`lib/engagement.js` holds both, and holds them the way the rest of this layer holds
everything: the judgements are data, and every state read off them is derived at the moment
of asking. It is the second module above the leaves rather than beside them — it asks [the
gap assessment](#the-gap-assessment-computed--beadcause-gaps) for readiness instead of
re-deriving it from the corpus, because a second opinion about whether a criterion is met is
exactly the second copy this layer exists to refuse.

    beadcause-engagement show                  the sequence, the dates and the letter
    beadcause-engagement dates                 the Type I as-of and the window open date
    beadcause-engagement letter                the four terms, and which of them resolve
    beadcause-engagement firms                 the classes, the questions, what a quote must cover
    beadcause-engagement bridge <end> <asked>  the bridge state between two dates

### `dates` never prints a date, and that is the verb

`bc-j0o3` was answered: **Type I now, with the Type II observation window opening the same
day.** The Type I is largely a by-product of preparing for the Type II, so having both costs
little, and starting the clock early is the only lever that shortens a timeline otherwise
made of elapsed time.

The rule that answer creates is the one that gets broken. The window opens when the controls
demonstrably **operate** — not when a report is wanted. Opened earlier it does not shorten
anything; it produces a report containing exceptions, which is commercially worse than a
later clean one. So a stored `windowOpensOn: '2026-09-01'` is not a plan. It is a bet that
thirty-eight criteria will be met by a date chosen before anybody looked, and the bet is
settled by an auditor rather than by whoever typed it.

There is therefore no date field, and `test/engagement.mjs` fails the repository for a date
literal appearing anywhere in the module's code. What the command prints instead is whether
a date **may** be set, and what is holding it:

    Type I as-of         not settable
    Type II window opens not settable

    Type I — operating gate: shut, 38 holding

Two gates, both read off the gap assessment. **design** is what a Type I opines on: every
elected criterion has a described control, whether or not it has yet produced anything to
sample. **operating** is what a window needs: every criterion is `met` — control *and*
evidence — **and** `assessed` rather than
[provisional](#absent-has-two-meanings-and-only-one-of-them-is-a-finding), because a control
cannot have been tested over a population nobody has enumerated. That second half is the one
people leave out, and it is why the operating gate can be shut on a register whose every row
says met. The suite drives both directions on fixtures: taking the evidence off one row
shuts the operating gate and leaves the design gate open, and a met row against an
unsurveyed estate holds the window shut on its own.

Because `bc-j0o3` put both dates on one day, the **design gate can never be the binding
one** — `met` cannot hold without a described control, so the operating gate is strictly the
stricter of the two. That falls out of the recorded answer rather than being written beside
it.

### The letter names four things, and two of them cannot be filled in yet

An engagement letter has to name the elected criteria, the description criteria, the period
and the subservice method. Each resolves from a neighbour rather than being restated, and
`beadcause-engagement letter` gets two answers and two refusals:

- **the elected criteria** resolve, out of the gap assessment, which takes them from [the
  policy set](development.md#fifteen-policies-each-with-an-owner-and-a-date-it-expires--libpoliciesjs-testpoliciesmjs)
  — one home, so the letter and the assessment cannot disagree about what the opinion covers;
- **the description criteria** resolve, out of [the generated
  description](#the-system-description-generated--beadcause-description)'s fourteen DC
  section 200 sections;
- **the period** does not, because the gates are shut;
- **the subservice method** does not, and this is the one worth reading twice.

The boundary's subservice list is empty under a **partial**
[census](#a-census-is-a-field-because-the-alternative-is-a-blank-that-reads-as-an-answer),
which says *nobody has surveyed the processors* rather than *there are none*. A method is a
decision per subservice organisation, and there is no list to decide over. A letter naming
`carve-out` today would assert a decision about organisations nobody has enumerated — and
[each carve-out owes a CUEC](#a-carve-out-owes-a-cuec-or-a-control-has-vanished) the user
entities have to act on. Enumerate the census and the same code says *there are none*, which
is the opposite instruction; the suite checks both sentences.

### An emptiness that says which emptiness it is

No firm has been asked. `QUOTES` is empty and `ENGAGED` is `null`, and `selection()` reports
**unsolicited** rather than leaving a blank that reads the same as a search that failed —
the same absence [the gap assessment refuses one level
down](#no-criterion-silently-absent-and-no-category-silently-unconsidered).

`beadcause-engagement firms` prints what the choice is between rather than who to call,
because the class is what moves the numbers and the roster inside a class turns over faster
than this file will: an **audit-tech platform** bundles the firm with the evidence tooling
and is fastest, a **boutique security-assurance firm** is read as more credible by the buyers
who read the report rather than its cover page, and a **general accounting firm** with a
small assurance practice is cheapest and least persuasive. The bundle is flagged, because it
answers the tooling question and the firm question at once — which is convenient, and is how
a firm comes to be chosen by a tooling decision nobody framed that way.

Two questions separate them, and the list is two long and closed: *how do you test a control
whose evidence is a git ref rather than a screenshot*, and *have you signed a report for a
service organisation where most privileged actors are automated rather than human*. A
question every firm answers the same way discriminates nothing and makes a comparison table
look thorough while comparing nothing. The answers to these two predict how much of the
observation window is spent explaining the system rather than being tested against it, which
is the cost nobody quotes.

A quote is comparable only when it covers **both** reports. `bc-j0o3` chose a sequencing, so
a Type-II-only quote prices a different plan, and comparing it to a quote for both is how the
cheapest number wins an argument it was not in. Two are the minimum; one quote is a price
with nothing to compare it to.

### A bridge letter is two dates and a limit

A report covers a period; a customer asks for it later. The gap between period end and the
request is what a bridge letter covers, and the state is computed from those two dates alone
— `covered` when the request falls inside the period, `bridge` within three months of period
end, and **`stale`** past it. Stale is not a longer bridge. It is a different purchase: what
the buyer wants is a current report, and a firm asked for a six-month bridge says so after
the invoice.

### The non-goal is checked rather than asserted

`bc-4r10.13` carries an explicit non-goal — do not buy evidence-collection tooling before
`bc-4r10.1` and `bc-4r10.5` exist. The pitch for those platforms is that they collect
evidence you do not otherwise have, and the premise of this programme is that the evidence is
a by-product of work that is already gated; buying first is paying a subscription to
re-photograph a git ref. Both are readable from here rather than taken on trust: the corpus
is present when the elected criteria enumerate, and `bc-4r10.5` landed when CC8.1 carries
evidence in the assessment. A comment saying they landed would still say so after somebody
deleted one.

Which leaves the purchase itself, and it inherits the missing date. `bc-4r10.17` answered
*buy a compliance platform two to three months before the window opens*, so the purchase
window is derived from a date that does not exist — and `beadcause-engagement dates` says
exactly that, rather than naming a quarter. That is the point of the whole module in one
line: **no purchase window, because the observation window has no date.**

## The crosswalk matrix, generated — `beadcause-crosswalk`

The programme's premise is that a SOC 2 report, an ISO/IEC 27001 certificate and an
ISO/IEC 42001 certificate describe **one implemented system** rather than three, and that a
fourth standard therefore costs a fraction of the third. That is either true of the corpus
or it is marketing, and the difference is a matrix somebody can read.

`lib/crosswalkreport.js` is that matrix, and **nothing in it is written down**. [The
corpus](#the-control-corpus--six-standards-in-one-closed-vocabulary) already holds every
obligation and every crosswalk edge; a matrix typed out beside it would be a second copy of
the edges, wrong within a quarter and wrong exactly where a buyer looks. Every cell is an
edge asked of the corpus on the call, the suite fails the repository for any control id
appearing in the module at all, and the numbers below are computed each time they are
printed. It is the third [join](#the-gap-assessment-computed--beadcause-gaps) in this
programme rather than a fourth register — the compliance leaves deliberately do not import
each other, so it takes the corpus and [the policy
set](development.md#fifteen-policies-each-with-an-owner-and-a-date-it-expires--libpoliciesjs-testpoliciesmjs)
and reaches for nothing else.

    beadcause-crosswalk matrix          every obligation and what claims to satisfy it
    beadcause-crosswalk shared [n]      controls answering n standards at once (default 3)
    beadcause-crosswalk uncovered       in-scope obligations nothing claims — the check
    beadcause-crosswalk undecided       obligations waiting on a statement of applicability
    beadcause-crosswalk control <id>    one record, both directions, and its indirect reach
    beadcause-crosswalk csv             the dense grid, for a spreadsheet

### Twenty-nine controls answer all three standards at once

    acme · 224 obligations across 3 certifiable standards · 348 crosswalk edges · 29 answer all 3 at once · 14 in scope and unclaimed · 131 awaiting a statement of applicability

Twenty-nine is the number the premise rests on, and `beadcause-crosswalk shared` is it as a
list. A row's **span** is how many certifiable standards it touches at once — its own, plus
every standard its edges reach — so a row of span three is one implementation with three
names: write the control once, evidence it once, and three auditors are answered. A hundred
and thirty-six records reach exactly two and sixty-seven reach one, and that histogram is the
duplicated-work map the programme plans against.

Span counts certifiable standards only. ISO/IEC 23894, 42005 and 5338 are guidance — nobody
is certified against them, nothing anybody signs cites them — so a guidance row that
elaborates one Annex A control has reached one standard, not two, however many documents
were consulted. They are rows, because a life-cycle process that elaborates a control is
real reuse; they are never columns, because a report that gave a reading list a column would
be presenting it as a conformance claim.

### The matrix has a direction, and the tempting error is to forget it

Crosswalk edges run from controls **to** criteria and never the other way, because a
criterion is satisfied by many controls and keeping the list on the criterion is how it goes
stale. The consequence for a report is that inbound and outbound are different questions and
only one of them is coverage:

- *What claims to satisfy this?* — inbound, and this is coverage. An obligation with no
  inbound edge is one nothing in the corpus answers.
- *What does this claim to satisfy?* — outbound. Almost every control has one and almost
  nothing points back at it.

Counting outbound as coverage would report the whole of both ISO Annex A sets as covered
while saying nothing at all, and every sum in the report would still add up. So both numbers
are on every column, only the first is called `covered`, and the suite pins a column with
outbound edges and no inbound — the exact record the mistake would turn green.

### An empty column is not always a gap, and the difference is applicability

"Nothing claims this" is a finding only where the obligation is one this organisation
actually carries, and there are three answers rather than one — each read from somewhere
rather than decided in the report:

- **elected or declined** — a Trust Services criterion is in scope if its category was
  elected, which is `lib/policies.js`'s answer and `bc-yfgo`'s decision. Twenty-three
  criteria are declined, twelve of them have no inbound edge, and none of those twelve is a
  gap: they are ISO/IEC 27701 territory in categories nobody elected.
- **mandatory** — a management-system clause. Nobody may exclude one, so an empty clause
  column is a real finding.
- **undecided** — an Annex A control. Whether it applies is what a Statement of
  Applicability decides, and there is not one yet — `bc-eqn1.14`. A hundred and thirty-one
  controls are waiting on it.

So `uncovered` is *in-scope obligations nothing claims*, deliberately narrower than "every
empty column". Padding it with a hundred and thirty-one controls that may be excluded on the
day somebody writes the statement would bury the fourteen that genuinely are gaps, and
calling them covered would be worse — so `beadcause-crosswalk undecided` counts them out
loud instead, which is what makes the narrowing visible rather than quiet. The day the
statement of applicability lands, this reads it rather than guessing.

### Every elected criterion is claimed, and every gap is the management system

    14 obligations are in scope and nothing in the corpus claims them

Not one of the thirty-eight elected criteria is unclaimed. All fourteen gaps are ISO/IEC
42001 management-system clauses — scope, the AI policy, competence, awareness, operational
planning, risk treatment, the internal audit programme, management review, corrective
action — and that is the honest finding rather than a hole in the report: **the management
system is work no other standard's control does for you.** A crosswalk cannot make clause 7.2
cheaper, because nothing in 27001's Annex A or SOC 2's criteria is clause 7.2 under another
name. Everything a matrix *can* make cheaper, it already has.

`--strict` exits 1 when anything in scope is unclaimed, so a check can gate on it, and
`--framework SOC2 --strict` passes today while the unnarrowed form does not.

### The grid lives in the spreadsheet, because a terminal cannot draw it

`matrix` reads down the columns and `shared` reads along the rows, and that is the whole
difference between them: *is this obligation covered* is a column and *does this control earn
its keep three times over* is a row. Drawn as an actual grid in a terminal it answers
neither — two hundred and twenty-four columns is not a thing anybody reads — so
`beadcause-crosswalk csv` is where the grid lives, with a second header line carrying each
column's applicability so a blank column can be read without a legend. It is the same
computation as the other verbs rather than a second rendering of the same idea, which is what
stops the readable artefact and the shareable one disagreeing, and the suite round-trips
every cross in the sheet back to a declared edge.

`beadcause-crosswalk control <id>` is the single-record view, and it prints three things
apart from each other on purpose: what claims this, what this claims, and what it reaches
*indirectly*. Guidance may not claim a criterion directly — the corpus refuses the edge, so
a life-cycle process reaches a criterion in two hops through the control that implements it —
and that route is worth being able to ask for. But a cell is a claim somebody would defend to
an auditor and a transitive reach is an argument about why work is not duplicated. Rendering
them the same is how a matrix comes to assert something nobody meant, so `reach()` is a
separate function and the label says what it is.

## What you elected to be held to — `lib/election.js`

Beadcause **records** unconditionally. Sessions are archived against their bead, merges
carry notes, configuration changes land as commits, and the control vocabulary ships
compiled into the release. None of that asks permission and none of it can be switched
off, because a record that can be turned off is not a record.

**Enforcement is the other half, and it is the half that can say no.** A gate that refuses
a merge, holds a session shut or fails a deploy is not a record — it is a cost, and it is a
cost most installs should never pay. Most beadcause installs have no architecture checkout,
no JIRA, no auditor and no interest in an attestation. A compliance layer that warns, logs
or blocks on those installs makes the platform worse for every person who is not pursuing
one.

So enforcement is **scoped**, and the scope is two things: a **declared boundary** — who is
being held to this, and what is inside it — and a set of **elected criteria**, named in the
closed vocabulary the corpus mints. An install that has declared no boundary and elected
nothing has nothing in scope. No gate can fire, nothing is warned about, and the layer is
invisible without ever having been turned off.

### Why a scope and not a flag, which is the whole of the design

The obvious shape is a switch: `compliance.enabled` in `config.json`, false by default.
It fails in both positions.

**Off by default is where the audit dies.** A gate that can be disabled by editing a file
is not a control. An auditor asking *how do you know these operated throughout the
observation window* is told the answer was a config key, and the Type II evidence is worth
nothing — not because anybody flipped it, but because nothing in the record could
distinguish a quarter in which nobody did from a quarter in which somebody did.

**On by default is where the platform dies.** Every personal install — a side project, a hobby app,
a notes repo — starts refusing merges for a management system nobody asked for, and the fix
everyone reaches for is precisely the switch that made the first problem.

A scope has neither position, because it has no default. The empty election is the empty
set, and it is empty because nothing has been added to it rather than because something is
off. There is no `enabled`, no environment variable and no key in `config.json` — and that
is asserted rather than promised: `test/election.mjs` reads `lib/election.js` and fails the
repo for `process.env` or a config import, and reads `lib/config.js` and fails it for a key
named `election`, `boundary`, `criteria`, `compliance` or `enforce*`.

What a gate gets is `null`, not `false`, and the distinction is the whole of *sees
nothing*. A gate handed `false` has been told something, and sooner or later says so on a
screen; a gate handed `null` has been told nothing and returns early, which is the
beadcause that has always been there:

    const verdict = inScope(await current(), 'SOC2.CC8.1');
    if (!verdict) return null;   // nothing is claimed here; behave as beadcause always did

When it *is* in scope, the verdict carries the boundary and the moment the criterion was
elected — because a refusal owes the person in front of it both *who says so* and *since
when*, and a gate that has to go back for them later is a gate that ends up saying only
"not permitted".

### Electing is a transition, not a setting

Every change is a chained commit on `refs/beadcause/election` in `~/.config/beadcause`,
with the actor, the bead and the justification in the message — the same shape
`refs/beadcause/foundations` uses for what an agent is permitted to be, for the same
reason. There is no file to edit and no state to set, so `git log` is the history of what
this organisation has claimed to be held to and *when it started claiming it*, which is the
question a Type II report is actually asking:

    git -C ~/.config/beadcause log --format='%aI %s' refs/beadcause/election
    git -C ~/.config/beadcause cat-file -p refs/beadcause/election:election.json

Four actions, and the order matters. `declare` comes first and nothing can be elected
before it: criteria with no boundary are a list with nothing to be true *of*, and it is
exactly the half-state where a gate could read as armed while nobody has said what it is
armed around. `elect` adds criteria and is idempotent — electing what is already elected
writes no commit, because a no-op transition is a line an auditor has to read and rule out.
`revoke` takes one criterion back out, so an organisation that changed its mind about the
privacy category does not have to withdraw its whole boundary and re-declare it, which
would read in the history as having stopped claiming everything for as long as the two
commits are apart. And `withdraw` stops the claim entirely.

### Withdrawing does not restore innocence, and that is the point

From a gate's point of view, an install that has withdrawn is byte for byte the install
that never elected anything. That is the promise, and it is kept — `test/election.mjs`
compares every predicate against the empty election and requires them equal, because a
promise that only holds on a virgin machine is not the promise. An absent ref and a state
whose lists are empty are two different code paths, and only one of them is the one a real
install ends up on.

What withdrawing is *not* is invisible. The transitions stay in the state, the commits stay
on the ref, and the justification is required — the only one of the four where it is, since
withdrawing is the transition an auditor reads first and *(no justification recorded)*
against it is a sentence nobody can do anything with. So a quarter with nobody in scope
reads as a gap somebody recorded, rather than as a quiet quarter. A window nobody can
account for is a finding; a window with an accounted-for gap is a scope note, and making
the second one cheap is the only way to stop people reaching for the first.

The class is registered as `election-history` in `lib/evidence.js`, kept permanently, and
this is where permanence does the most work: the whole claim is that an install cannot
quietly stop being in scope, and a prunable history is exactly how it would.

### What it deliberately does not do

**It does not import the control corpus.** It would be one line to reject an id the corpus
does not contain, and it is not done. An election is a record of what was elected *then*;
the corpus is a table that ships with the release. Joining them at read time means a
criterion retired or renamed in a later release silently changes what an organisation is on
record as having elected — the flippable switch wearing different clothes. So an id is
checked here for **shape**, with the framework token as part of it, because `ISO27001.A.5.2`
and `ISO42001.A.5.2` are different controls and a stored bare `A.5.2` would be a record
whose meaning depended on who read it. Resolving a shape to a record belongs to whatever is
showing it to somebody: the surface that offers a list to elect *from* should read the
corpus and offer only what is in it, which is a check at the point of choosing rather than
a filter on the record afterwards.

**It does not fail closed on its own account.** A machine with no common repo, no git or an
unparseable state reads back as having elected nothing. That is the safe direction and it
is not the obvious one — the tempting alternative is to keep enforcing whatever was last
known — but an install that cannot read its own election must not be an install that starts
enforcing a guess.

## Publishing the chain — `lib/publication.js` and `lib/witness.js`

A local record cannot anchor itself. `verifyRef` in `lib/evidence.js` will tell you that an
evidence ref is linear, that every parent it names is in the walk, and that it goes back to
a single root — and a history rewritten wholesale passes all three. Intactness proves that
what you are holding **is a chain**, not that it is **the chain that was there in March**.
The only thing that can tell those apart is a head somebody wrote down beforehand, somewhere
the rewrite cannot reach, and beadcause administers every "somewhere" it has.

So the instance publishes its heads to a control-daemon it does not run, and the arrangement
is the point: **the local record is authoritative and the remote one corroborates.** Neither
is trusted to check itself. A local history that diverges from a published head is a
discrepancy no matter which one moved, and finding out which is a question for whoever holds
both.

Four files, splitting where the trust does. `lib/publishable.js` is the closed vocabulary of
what may leave the Mac — hashes, chain heads, transitions, criterion states, and never a
record's contents. `lib/publication.js` is the instance: it keeps the chain and publishes it.
`lib/witness.js` is the far end: it stores, refuses, attests, and compares. `lib/continuity.js`
is what any of it entitles somebody to *claim* about a period, and it is the one that refuses
to let an outage read as a clean window.

### Append-only, stated twice, because it can fail twice

The chain is commits on `refs/beadcause/publications` in `~/.config/beadcause`, one record
per commit, written with the same compare-and-swap every other evidence ref uses. `git log`
reads it without any of this code:

    git -C ~/.config/beadcause log --format='%aI %s' refs/beadcause/publications
    git -C ~/.config/beadcause cat-file -p refs/beadcause/publications:record.json

That gets you git's answer — linear, intact, one root. Every record **also** names the
digest of the record before it, inside the payload that is published, and `linkProblems`
walks those digests independently. The two catch different things: a grafted history fails
the first, a record swapped in place fails the second, and a chain that has been rewritten
end to end fails neither. `verifyChain` asks both and reports them separately rather than as
one boolean, plus a third question that is cheaper than both — a commit on this ref carrying
no readable record is a commit somebody made by hand.

`test/publication.mjs` rewinds the ref and appends a different record on top, then asserts
that every local check still passes. That is the whole argument for the service in one
check: the chain is sound, and sound is the wrong question.

`recordChainHead` is the bridge the other way. It runs `verifyRef` over an evidence ref and
appends what it saw — the ref, its tip, its length and the two soundness answers — which is
the caller `verifyRef` has been waiting for: it reports `anchored` as null for everything
today because nothing records a head to check against. The narrowing is `chainHeadFields`, a
projection rather than a pass-through, because the verifier's result grows as that file
grows and `why` is prose. A ref with no commits is refused rather than published as a head
of nothing.

**A head is published under a posture, or it is a number with a timestamp on it.** The head
is what an anchor witnesses, and an auditor holding an anchored head from a deployment that
attested nothing can say the head existed by then — and nothing whatever about whether the
thing that produced it could have rewritten the store underneath. `recordAttestedHead`
writes the two together, **in that order and at one instant**: a posture record says nothing
about the time before it was taken, so a head written first sits in the run-up gap and is
unbacked no matter what follows it, and two reads of the clock either side of a git commit
are not the same number.

`recordPosture` is what it calls first, and it writes **only when the chain has stopped
saying what this deployment can back up**. That is a question about the judgement rather
than about the six fields, and the difference is the case a field comparison misses: an
anchor that goes stale changes nothing at all about a posture, and `unbacked` judges a
posture at the instant its own record was written, so one January record with anchoring in
it would otherwise render the rest of the year as the January it was true for. The crossing
appends exactly once — the moment the fresh record is on the chain, the posture in force is
judged at its own new instant, the two agree again, and a daemon publishing hourly goes back
to writing nothing. And there is deliberately no parameter anywhere on that path that
*states* a posture value: `test/publication.mjs` reads the signature and fails the repo if
one appears, which is the rule `test/posture.mjs` keeps over `observe`, kept a second time
at the door into the chain.

### Continuously, not on a schedule

A Type II window is only as good as its densest gap. A daily push means every day is a day
of unwitnessed history, and nothing done afterwards recovers it — so `publish` is written to
be called often and to cost nothing when there is nothing to do.

It **asks rather than remembers**. A local high-water mark would be one number to be wrong,
and it would be wrong in the direction that hurts: an instance that believes it published up
to seq 40 skips 40 forever if the far end never had it. The service is the authority on what
the service received, so every publication begins by asking where it got to — which means
every publication is also a divergence check, run continuously, instead of a reconciliation
somebody remembers to do quarterly.

Transport is not in the module. `publish` takes a `head` to ask and a `deliver` to send
with, so the same loop drives an HTTP client, a queue or a test's in-process ledger, and
there is no code path in the daemon that a service outage can throw through. **Unreachable
is not a failure**: it comes back as `offline` with what was sent and what is still queued,
and it is not divergence. Whether an unpublished period may be *claimed* is a different
question, and the answer is no.

### Both directions, and they are not the same event

`compare` takes the local chain and the published head and reaches one verdict:

| Verdict | Divergent | What it means |
|---|---|---|
| `nothing` | no | Nothing recorded and nothing published. |
| `unwitnessed` | no | Records waiting, and the far end has never heard from this instance. |
| `agreed` | no | Both sides hold the same record at the same sequence number. |
| `ahead` | no | The local chain runs past the published head — the ordinary shut laptop. |
| `behind` | **yes** | The service holds sequence numbers this instance never reached. |
| `forked` | **yes** | Both sides hold a record at the same sequence number and they differ. |
| `truncated` | **yes** | The local chain now starts after a record the service holds. |
| `foreign` | **yes** | The service answered for another instance. |
| `orphan` | **yes** | The service holds a chain and there is no local chain at all. |
| `broken` | **yes** | The local chain does not link up, so there is nothing to compare with. |
| `unreadable` | **yes** | The service answered with something that is not a published head. |

A divergent verdict carries an empty `unpublished` list, and that is deliberate: publishing
onto a service that already disagrees buries the disagreement under records that link onto
it, and the discrepancy this whole arrangement exists to surface ends up in the middle of a
chain nobody re-walks.

### The service is a witness, and it cannot author

The far end records what it was told and when it was told it. What it attests is not *this
claim is true* — it has no way to know that — but *I was told this, at this time*: the
instance, the sequence number, the digest of the record, and the moment it arrived, stamped
from the service's own clock rather than the record's, because the two differing is itself a
fact worth holding.

That it cannot originate a claim is a property of the file rather than a promise about the
deployment. `lib/witness.js` does not import `record`, `next` or `genesis` — the three
functions in `lib/publishable.js` that mint a record — and `test/publication.mjs` reads the
source and fails the repo if it ever does. A forged claim would have to be written into that
file first, as a diff somebody signed off on, rather than assembled at runtime out of what
the service happens to hold.

The guarantee is structural rather than cryptographic, and the difference is worth being
plain about. An operator with write access to the service's storage can still put a row in
it. What they cannot do is make the Mac agree: the row shows up as `behind` or `forked` the
next time anything compares the two, which is on the next publication. Signing a record to
its instance strengthens that; it does not replace it, because a signature proves who wrote
a record and only a comparison proves the two sides hold the same history.

Three refusals hold the ledger to the same rule. A record that does not link onto what is
held is refused rather than stored beside it. A sequence number is used once — re-using one
is a rewrite, not a publication. And a replay re-issues the **original** receipt with its
original time, because sending an old record again must not manufacture a fresh attestation
for it; that is the closest thing to authorship reachable from outside.

The class is registered as `publication-chain` in `lib/evidence.js` and kept permanently.
Here permanence is arithmetic rather than policy: removing one record from the middle breaks
every link after it, so the disposal unit is the whole ref, and dropping it forfeits every
continuity claim the instance has ever made.

### Offline is ordinary, and an unpublished period is not a clean one

Two rules that point in opposite directions, and beadcause is worse without either.

**Fail open for work.** A daemon with no route to the service keeps doing everything it does
today: sessions open, merges land, questions arrive. Nothing waits on a server being up, and
no gate fires because one is unreachable. `publishQuietly` is the door a daemon path calls —
it answers with an outcome for every way a transport can fail, including the one a `try`
does not cover. A connection that is *refused* comes back in milliseconds; a connection that
is **accepted and then silent** hangs for as long as the operating system's keepalive allows,
which on a laptop that changed networks is minutes, and a tick awaiting that has blocked on
the service just as completely as one that crashed on it. So the deadline lives in the
module rather than in the transport: a timeout is a policy about *work*, not about HTTP, and
a policy every call site has to remember to apply is a policy one of them will not.

**Fail closed for claims.** A period that was never published is not evidence that nothing
happened — it is an absence of evidence, and `lib/continuity.js` reports it as `unverified`
rather than compliant. An auditor reading a clean window that was actually an outage is the
failure the whole file exists to prevent.

Chaining does not answer this, and the difference is the point. `linkProblems` proves a run
of records is one unbroken chain — and an instance that published nothing for a fortnight has
a perfectly linked chain straight *across* the fortnight, because the record either side of a
gap links onto the one before it whatever happened in between. Chaining is an argument about
**order**; continuity is an argument about **time**, and the only thing on this Mac carrying
an argument about time that the Mac cannot make by itself is a receipt, stamped by the
witness's own clock.

So coverage is measured in receipts, never in records. A record's `at` is written by the very
machine whose history is in question: one stamped 03:00 and witnessed at 09:00 proves nothing
about 03:00 that could not have been assembled at 08:59.

**The bracket rule.** An interval is verified when it is bracketed by two witnessed instants
no further apart than `tolerance` — one hour by default, two orders of magnitude looser than
the 30-second `pollSeconds` it governs, so an interval only goes unverified when publication
genuinely stopped rather than when a tick ran late. Not "a receipt covers the hour after it"
and not "the hour before it": either buys time from a single point, and a single point is
exactly what a machine can manufacture. Two points close together are what bound how long
anything could have sat unwitnessed and therefore alterable.

Where consecutive witnesses are further apart than the tolerance, the **whole** interval
between them goes unverified rather than only the excess — something recorded a minute into a
six-hour silence waited six hours to be seen. Nothing before the first witnessed instant is
ever verified, because a report that vouched backwards would vouch for time in which the
install did not exist. The trailing edge is the single concession: from the last witness to
the end of the window is verified if it is within the tolerance, with the end of the window
standing in for the bracket the next publication will supply.

**The gap renders as a gap, with its duration and its reason.** An outage and a silence read
identically in the published record and are entirely different events, so the report uses the
local chain to say which: records stamped inside the interval mean the instance kept working
and could not publish; no records inside it mean nothing was recorded either.

    8h unverified: no publication was witnessed across it, and the instance kept
    working — 7 record(s) are stamped inside it and were witnessed only afterwards

**Reconnecting republishes the queue without loss, and does not heal the gap.** Every record
that piled up behind an outage lands, in order, the moment the service is reachable — the
queue is the chain on disk, so nothing is held in memory and nothing is lost to a restart.
The eight hours in which nobody was watching stay eight hours in which nobody was watching,
because the receipts that arrived at 18:00 are stamped 18:00. `test/continuity.mjs` asserts
exactly that, and it is the check a future change reading `at` instead of `received` would
quietly reverse with every other check still passing.

`claimProblems` is the refusal, in the same shape `lib/operator.js` uses: a claim is refused
by a function that says what is missing rather than permitted by a flag somebody set. There
is no argument for how much of a window may be unverified, because there is no honest one —
99% coverage with a six-hour hole in March is a window with a six-hour hole in March.

`lib/continuity.js` is a leaf on `lib/publishable.js`, like `lib/witness.js` and for the same
reason: the report is asked for at both ends, by the instance about itself and by the service
about an instance it holds, and a module that reaches for `~/.config/beadcause` on import
cannot run on the far end. It takes a window rather than reading the clock, because a
continuity report that cannot be run twice with the same answer is not evidence of anything.

## The AIMS on paper — `lib/aims.js`, `test/aims.mjs`

Everything the compliance layer builds is a record *of* something, and the something has to
already say what it is. An evidence register records that a control operated; a control
operates against a policy; a policy is issued by an organisation with a name, under a scope
with an edge, by somebody who is accountable for it. Beadcause had the records first and the
paper not at all — which is the ordinary order for software and exactly backwards for an
audit. An auditor opening at the
[evidence register](development.md#nothing-is-kept-without-saying-for-how-long--libevidencejs-testevidencemjs)
asks what it is evidence *for*, and until this file existed the honest answer was "a
management system nobody had written down".

**The organisation is `Adam Morgan, trading as Neo`, a sole trader**, and that was not
a decision a session could make: the entity named in the scope statement is the one an
accredited body audits and the one printed on the certificate. It was asked as `bc-jlpj` and
answered on 2026-08-16. Top management is Adam Morgan, because a sole trader is its own top
management and there is no board to appoint one. What is *not* recorded yet is the
registration behind the name — the jurisdiction, the registration number, the registered
address — so `ORGANISATION` carries a stated gap naming the bead that will fill it, in the
same shape the [supplier register](development.md#every-third-party-is-named-and-a-sweep-fails-on-one-that-is-not--libsuppliersjs-testsuppliersmjs)
uses for a supplier's terms. A jurisdiction invented to fill a field reads exactly like a
jurisdiction somebody checked.

#### Why the policy is a data structure and not a PDF

The answer chosen for this whole programme is **enforce-then-record**, and it makes a demand
of the AI policy that a normal AI policy does not survive. The enforcement gates read clauses
from here and turn them into refusals. A gate cannot refuse something for violating "we are
committed to the responsible use of artificial intelligence". It *can* refuse something for
violating "no session opens on a bead nobody endorsed", because that names a condition a
function can evaluate.

So every clause carries a sentence naming what is testable about it, and an enforcement state
that is one of three:

- **Enforced** — something in this repo refuses the non-conformant case *today*, and the
  clause names the files that do it. The check fails the repo if one of those files is no
  longer there, because a policy citing a gate that has been deleted is worse than a policy
  with no gate at all: it reads as covered.
- **Planned** — the clause is real, the gate is not written yet, and the clause names the bead
  that writes it. A planned clause must name a bead and must say what holds the line
  meanwhile, so the gap cannot rot quietly into an assumption.
- **Organisational** — nothing can test it, and the policy says so in those words. Whether a
  person *understood* what they approved is not mechanically checkable and never will be.
  Writing it as though it were is the exact dishonesty an auditor is trained to find, so an
  organisational clause carries no testable sentence at all and the check refuses one that
  pretends to.

**That third state is what makes the other two mean anything.** A policy in which every clause
claims enforcement is a policy nobody checked.

The four documents below are sections of this file, controlled by
[`lib/documents.js`](development.md#every-document-has-an-owner-and-a-review-date--libdocumentsjs-testdocumentsmjs)
in the same register that already controls the specification, the supplier register and the
evidence register — because a policy nobody reads is not a control, and this is where a
person reads. The obvious failure of splitting a document from its machine-readable form is
drift: a clause added in code that the policy never mentions, or a clause struck from the
policy that a gate still enforces. Each document declares the ids it must contain and the
section has to contain every one of them, so a drift fails on the diff that caused it rather
than a year later.

**None of the four is signed, and that is deliberate.** A session can draft a policy in an
evening; it cannot commit an organisation to one. Each carries its named approver and a
signature line and is registered as `awaitingApproval`, which the register reports as a
warning every time anybody asks and never as a build failure — failing would turn the repo
red on a state only a signature can clear, and the fix an unattended session would reach for
is precisely the fabricated approval.

One thing this file is emphatically not: an ownership vocabulary. `lib/owner.js` answers whose
install this is and `lib/ownership.js` answers whose bead this is. Neither is an AIMS role,
neither is touched here, and `NOT_AIMS_ROLES` names both so the next person looking for a
roles table does not find three of them. Keeping them apart is also what makes it possible to
later *check* a bead's owner against the roles table, which is impossible while they are the
same list.

#### The AI policy

> Beadcause AI policy, version 0.1.0-draft. Issued by Adam Morgan as top management, for
> **Adam Morgan, trading as Neo**. **Draft — not yet signed.**

Beadcause runs autonomous agent sessions that read, write and merge code on machines and in
repositories that belong to people. This policy states what those agents may and may not do,
in terms specific enough that the system itself can refuse the things it forbids. It is the
standing instruction to every agent this system runs. Where a commitment in it can be enforced
by a gate it is enforced by a gate rather than described; where it cannot, this document says
so.

**AIP-1 — No unattended agent session opens on work a person has not endorsed.**
*Enforced*, by `lib/endorse.js` and `lib/advocate.js`. A bead carrying the `unendorsed` label
is refused by the endorsement hold before any window is opened, and the refusal is written on
the bead rather than shown as a window that quietly does not appear. Two layers on purpose:
the marker is filtered out of every queue, and the launcher refuses a held bead handed
straight to it. The filter is what makes the refusal rare; the refusal is what makes it true.

**AIP-2 — No agent widens what an agent is permitted to do.**
*Enforced*, by `lib/foundation.js` and `lib/impact.js`. An amendment to a protected field of an
agent foundation — its identity, its protocol owner, what it may write, which repository it
owns — is refused whoever asks, and the refusal is recorded with its reason. And since
`bc-eqn1.6`, with the management system on, an amendment that widens an agent even in an
*amendable* field — a tool, an allowlist entry, a less supervised permission mode — is refused
unless a current impact assessment covers the widened form. Every assessment is a draft until
the approver signs it, so today every widening is refused and every narrowing passes.

**AIP-3 — Nothing leaves this machine to a third party the supplier register does not name.**
*Enforced*, by `lib/suppliers.js`. A sweep of `lib/` and `bin/` for outbound hosts and for the
commands actually executed fails the repo on one no supplier entry claims, so a new
integration cannot ship without its entry. The clause that catches the largest egress in the
system is the command half rather than the host half: every agent is a subprocess, and a sweep
for URLs alone reports a clean tree while prompts leave the Mac.

**AIP-4 — Every standing claim this system makes about itself has an owner and a date it goes
stale.**
*Enforced*, by `lib/documents.js`. Every controlled document carries an owner, a version, an
approval and a review period, and the repo fails when one is past its review date — warning
for a month first, and naming the owner in the failure. This is the clause that will one day
turn the build red with no diff behind it. That is the control operating, and moving the date
without doing the review is the single way to make the register lie.

**AIP-5 — Nothing is kept without saying for how long, and nothing is deleted without saying
who could.**
*Enforced*, by `lib/evidence.js`. Every module that writes durable state is claimed by an
evidence class stating its retention, its disposal and who can alter it, or is exempted by
name with a reason; an unclaimed writer fails the repo. The enforcement runs in the direction
that catches a new writer, and a claim naming a file that no longer writes anything is caught
by the same check.

**AIP-6 — No AI system in this register operates without a current impact assessment.**
*Planned*, by `bc-eqn1.8`, in `lib/impact.js` and `lib/dispatch.js`. Opening a session on an
agent kind whose impact assessment is missing or expired will be refused, with the refusal kept
as evidence. The record this reads exists since `bc-eqn1.6` — an assessment per AI system,
with a template, an approver and an expiry — and so does the half a repo check can enforce: a
new agent kind that ships without a current assessment fails the build. What is owed is the
session-open half. Until it lands, the existing agent kinds run on draft assessments, and nobody
should read that as equivalent.

**AIP-7 — No change reaches a default branch without naming what it was for.**
*Planned*, by `bc-eqn1.8`, in `lib/mergequeue.js` and `lib/delivery.js`. A merge carrying no
bead and no control or requirement claim of any kind will be refused by the queue rather than
landed with an empty record. Every merge today already carries a bead, because the only path
to one is a delivery that parks the work bead behind a merge bead; what is missing is the
refusal of the case that does not.

**AIP-8 — A change to which model an agent runs on is not invisible.**
*Planned*, by `bc-eqn1.8`, in `lib/modelcard.js` and `lib/mergequeue.js`. A change to the model
tier an agent kind runs on will not land unless the system card recording what that agent is
changes in the same diff. The model an agent actually ran on is already recorded per session;
what is not yet refused is a change to what it will run on *next* time, made without the card
that describes the system moving with it.

**AIP-9 — The process that writes a change is never the process that merges it.**
*Planned*, by `bc-eqn1.8`, in `lib/mergequeue.js` and `lib/mergeadvocate.js`. A worker session
pushes a branch and opens a pull request, and stops; the merge is performed by a separate
process in the daemon that can see every open branch at once. This is how the system is
arranged today and it is stated in every worker brief, but it is a convention rather than a
refusal — nothing physically stops a session merging its own branch, and saying so is the
point.

**AIP-10 — Whoever approves an AI system impact assessment understands what they are
approving.**
*Organisational.* Nothing can test this and this policy will not pretend otherwise. What
`bc-eqn1.16` makes checkable is the record that a competence review happened and when — a
different and much weaker claim, and the difference between the two is exactly what an
organisational clause is for.

> **This policy is a draft and carries no signature.** It is issued for signature by Adam
> Morgan, as top management, and `bc-nft5` is the question that asks for it. Until it is
> signed, every register that names it says so.
>
> `Signed ____________________  Adam Morgan, for Adam Morgan trading as Neo, as top management.  Date __________`

#### Scope of the AI management system

> Clause 4.3. Version 0.1.0-draft, awaiting Adam Morgan's signature as top management.

The AI management system of **Adam Morgan, trading as Neo** covers the design,
development, operation and provision of Beadcause: the decision inbox and the daemon behind
it, the autonomous agent sessions it opens against repositories on machines the organisation
operates, the tracker those sessions read and write, and the compliance layer that evidences
all of it.

**Inside the boundary.**

- **The daemon and its surfaces** — the server, the phone inbox, the terminal and the chat
  session; everything a person touches to direct the system.
- **The agent sessions** — every agent kind the system can open: the advocate that decides what
  is ready, the worker that does it, the epic planner, the chat session, the resolver and the
  merge advocate. Each is an AI system in its own right and each has an owner in the roles
  table below.
- **The repositories on this Mac** — the checkouts and worktrees an agent reads, writes and
  merges into, and the trackers beside them.
- **The compliance layer itself** — the control corpus, the registers, the enforcement gates
  and the evidence they write. It is inside the boundary of the audits it serves, and being
  outside it would make the evidence worth nothing.
- **The machine the daemon runs on** — the Mac itself, its account security and its local
  storage. Every record this system keeps begins there.

**Outside it, and why.** An exclusion with no reason is a boundary drawn where the evidence ran
out, so each says both why it is outside and what is still true about the risk once it is —
the same discipline a carve-out owes a complementary control.

- **The model and its training.** The organisation does not develop, train, fine-tune or host a
  model; every agent is a subprocess of a supplier's tool, and the model's behaviour is a
  property of that supplier's system rather than this one. *Residual:* the model is the largest
  single risk in the system and being out of scope does not put it out of the audit. It is
  carried as a supplier with the shortest review period in the register, and every clause about
  what an agent may do is a control over the model's *effects* rather than over the model.
- **Repositories this organisation does not own.** An agent may open a pull request into a
  repository whose owner runs their own review, their own branch protection and their own
  management system, and this AIMS cannot claim controls it does not operate. *Residual:* a
  complementary control — the repository owner reviews and merges. The obligation on this side
  is that every change is attributable to a bead and a session, which is what makes their
  review possible at all.
- **The third parties in the supplier register.** What GitHub, Atlassian, Slack, ntfy, Google
  and Tailscale do internally is theirs; the organisation operates none of it and can evidence
  none of it. *Residual:* what is sent to each, why and under what terms is squarely in scope
  and is the supplier register's whole subject, with the terms in force recorded as a stated
  gap rather than as a claim.
- **Installs that have elected nothing.** Beadcause runs on machines with no architecture
  checkout, no corpus and no interest in an attestation, and
  [enforcement is scoped to what an install has elected](compliance.md#what-you-elected-to-be-held-to--libelectionjs),
  so those installs run no gates at all. *Residual:* the design and development of the software
  is in scope for every install, because it is one artefact. What is out of scope is the
  *operation* of a management system on an install that never declared one — and the election
  history is a chained record, so which is which is answerable for any past date.

This scope is reviewed with any change to what an agent may do, and at least annually.

#### Interested parties and what they need

> Clauses 4.1 and 4.2. Version 0.1.0-draft, awaiting Adam Morgan's signature as top management.

**The context this system sits in**, internal first, because the internal issues are the ones
that decide what the management system has to be:

- One person operates the system, owns every role in it, and approves their own work. There is
  no segregation of duties and no amount of process will create one.
- Most of the code is written by the system's own agents, so the thing being audited and the
  thing doing the auditing are the same artefact.
- The specification, the tracker and the product are one repository, which makes evidence cheap
  and makes a mistake in the record indistinguishable from a mistake in the code.
- Attention is the scarce resource, not compute: a control that asks the operator a question
  they do not have time to answer is a control that gets routed around.

Externally: the system depends on a single model supplier whose terms, retention and
capabilities can change without notice and without a version number; agents write into
repositories other people own, so the consequences of a defect land on somebody who never ran
this software; an autonomous merge can reach a deployed service, which means a failure has an
audience beyond the operator; and the audience for the certificate is a customer or an
accredited body who will read the evidence rather than the intentions.

**The parties, what they need, and how the system answers it.**

- **The operator** needs to know what every agent is doing right now and to be able to stop it,
  to be asked rather than guessed at when a decision is theirs, and not to be asked about
  anything the system could have decided itself. Answered by the inbox, the session windows and
  the terminal; by the endorsement hold; and by the decision card that turns a question into two
  taps on a phone.
- **Owners of repositories agents write into** need every change attributable to a bead, a
  session and a model, nothing merged they could not have reviewed, and a way to tell an
  agent's work from a person's. Answered by a branch and a pull request per bead, the session
  archive against that bead, and the byline saying which agent wrote it and what it ran on.
- **Reviewers of a pull request an agent opened** need to know an agent wrote it, which one and
  what it was asked to do, and a description that is true of the diff rather than of the
  intention. Answered by the delivery writing the brief, the tests and the risks into the pull
  request body, with the diffstat carried beside it so the two can be compared.
- **People named in a bead, a commit or a file an agent reads** need their name, their words and
  their email address not to be sent somewhere nobody recorded, and a way to find out where it
  went. Answered by the supplier register stating what is sent to each third party, the
  publishable vocabulary deciding what may leave the Mac at all, and the evidence register
  stating how long each record is kept.
- **Users of a service an autonomous merge deployed** need a bad deploy to be visible and
  revertible, and not to be the first to notice. Answered by a merge deploying through a settle
  window with the ship bead closing on the evidence that it went out, and by a poisoned build
  being refused rather than served.
- **An auditor or certification body** needs evidence that a control operated across a window
  rather than a description of it, the ability to sample a change and follow it to its record,
  and a scope with an edge and exclusions with reasons. Answered by the evidence register, the
  control corpus, the refusals kept as records, and this document set.
- **Whoever maintains or acquires the system next** needs the reason a thing was built the way
  it was and not only what it does, and a document set that is current rather than one that was
  current once. Answered by a specification that argues for everything it documents, and by
  every standing document carrying a review date that fails the build when it passes.

**Suppliers are interested parties too, and are deliberately not listed again here.** They are
enumerated once, in the
[supplier register](development.md#every-third-party-is-named-and-a-sweep-fails-on-one-that-is-not--libsuppliersjs-testsuppliersmjs),
and `parties()` folds them into this one. A register that re-derived them would be a second
list of the same seven organisations, drifting from the one the egress sweep actually
enforces — so the check refuses a hand-written party whose id belongs to a supplier.

#### Roles, and who may approve what

> Clause 5.3 and Annex A.3. Version 0.1.0-draft, awaiting Adam Morgan's signature as top
> management.

- **Top management** — Adam Morgan. Accountable for the AI management system as a whole: that it
  exists, that it is resourced, and that it is reviewed. Issues the AI policy and owns the scope
  statement. May approve: the AI policy, the AIMS scope, an agent protocol amendment, an
  incident closure.
- **AIMS manager** — Adam Morgan. Accountable for operating the management system day to day:
  keeping the registers current, clearing the reviews the repo fails on, and running the
  internal audit programme. May approve: a controlled document, a supplier.
- **AI system owner** — Adam Morgan. Accountable for each AI system in the register, one per
  agent kind: answerable for what that agent does, what it may write, and the model tier it runs
  on. May approve: an agent protocol amendment.
- **Impact assessment approver** — Adam Morgan. Accountable for deciding whether an AI system
  impact assessment is adequate, and whether a widened agent may proceed on the strength of it.
  May approve: an impact assessment.
- **Incident owner** — Adam Morgan. Accountable for an incident from the moment it is raised to
  the moment its corrective action is shown to have worked, including the review that follows
  it. May approve: an incident closure.

**Five roles and one holder, which is the first thing an auditor will raise.** The answer is
written here before they ask, because the alternative — inventing four more people — is fraud
and the alternative to *that* is pretending nobody noticed. There is no segregation of duties:
the operator writes the policy, approves it, owns the systems it governs and closes the
incidents they cause. What compensates is that the approvals which matter are enforced by code
rather than by the approver's memory, and that every refusal, election and amendment is an
append-only record the operator cannot quietly rewrite. What would change the day a second
person arrives is which roles move first: the impact assessment approver and the incident
owner, in that order, because those are the two approvals where an independent reader is worth
the most.

The list of approvals is closed, and the check refuses a table in which some kind of approval
exists that no role may give — an approval nobody can give is a decision that cannot be made,
which is a deadlock hiding inside a governance document.

## Impact assessments, per AI system — `lib/impact.js`, `test/impact.mjs`

ISO/IEC 42001 Clause 6.1.4 and Annex A.5 ask, for every AI system, who is affected, how, what
could go wrong for them and what is done about it — for individuals, for groups and for
society — and ISO/IEC 42005 says how to run that as a process. Here the AI systems are the
system card register's: beadcause itself and one per agent kind. Each has exactly one
assessment, and the parties it names are the interested parties above, cited by id, so a party
struck from that register fails every assessment that cited it.

### A record with a template, an approver and an expiry

An assessment answers the same six questions every time — deployment context, benefits,
impacts, residual risk, what triggers a reassessment, and which capability grants beyond the
shipped form it has also considered — and the check fails one that leaves a question
unanswered, or that assesses no societal impact, or no impact on individuals or groups.

Who may approve one is the roles table's answer and no one else's: the approval names a role,
the check asks the roles table whether that role may approve an impact assessment and whether
the named person holds it. An approval stands for at most twelve months, the repo warns a
month before it ends, and an expired one fails the build. An approval also carries a digest of
everything it approved, so an assessment edited after approval — a harm softened, a grant added
to what it covers — fails until it is approved again or honestly returned to draft. That is
42005's reassessment trigger as a check: a change to the system triggers a fresh assessment
rather than an annotation on the old one.

The record lives in code rather than on a chained ref, because an assessment is a document a
person reads and approves, not a fact the running system writes. A change to one is a diff on
a branch, reviewed before it merges.

**Every assessment is a draft today**, seeded by the session that built the register and
awaiting the impact assessment approver. A draft is never current. The cost of that is stated
rather than hidden: with the management system on, every widening amendment is refused until an
assessment covering it is approved. Treating a draft as approved would be the fabricated record
this programme exists to prevent.

### The two refusals that read it

**A widening amendment.** An amendment that widens what an agent may do is refused unless a
current assessment covers the form it would leave the agent in. Widening is measured on three
fields: `tools` (which tools exist at all), `allowedTools` (which run without a person
approving each call) and `permissionMode` (whether a person is in the loop). Adding is widening
and removing is not, so a narrowing amendment passes with no assessment anywhere. The comparison
fails closed: an allowlist entry is matched exactly, so `Bash` is never covered by
`Bash(git log:*)`, and a permission mode the gate does not rank counts as the widest. The model
is not a widening — it does not change what an agent may do, and the system card gate already
owns it.

An assessment covers its agent's shipped form plus whatever it names in `alsoCovers`. So the
way to grant a wider tool is to assess it first: name the grant, have the assessment approved,
and the amendment then passes.

**A new agent kind.** The set of agent kinds is closed and changes by a commit, so this gate is
a repo check: an AI system with no assessment fails the build, and a system added after the gate
landed fails unless its assessment is approved and current. The eight systems that existed
before it are named, and the test pins that list so it can shrink and never grow.

### The refusal is the evidence

A refused amendment writes nothing to what the agent is and two things about the refusal: a
`refused` entry on the foundations ref beside the amendments, naming the gate and the control
(`ISO42001.Clause6.1.4`), and — when the amendment came from an answered question — a refusal
comment on that bead in the shape `lib/capa.js` defines, with the `gate-refused` label. The
question stays open, because an approval that changed nothing must not close over one.

All of it is inert while the management system is off: no module is loaded and nothing is read,
and an amendment behaves exactly as it did before this gate existed.

### What it does not do

A release that widens an agent's baseline is a reviewed commit, not an amendment, and this gate
does not see it. Refusing a *session* on an agent kind whose assessment is missing or expired is
the other half of AIP-6 and belongs to `bc-eqn1.8`, which reads this register. And whether the
approver understood what they approved is AIP-10, which no check can test.
