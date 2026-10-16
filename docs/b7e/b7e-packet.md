### The approval packet as one call — ask, label, and record the ward step — `b7e-packet`

`bc-dgx7.80` names five sessions (`lm-gr6.38`, `lm-gr6.41`, `lm-gr6.43`, `lm-b5d.4.3`,
`lm-5eu.1.1`) that each ended a Story-chain relay with the same five hand-typed calls, in
the same order, and the same one failed every time: `ask.js` to file the question, two
separate `bd label add` calls (`needs-approval`, then `human`), `relaystep --role ward
--step file --next adam`, rejected because the relay vocabulary is role names and `adam`
is not one, then a retry with some other role standing in for him (`vox`, `aria`,
`script` — a different guess each time). Two labels applied one write apart leave a
window where the bead carries only one, invisible to whatever desk query selects on both
at once; and the rejection was never a typo — five sessions independently reasoned the
packet goes to Adam, because it does, and retyping `--next` with a different role each
time never fixed the actual mismatch.

```
b7e-packet -w <workspace> -b <bead> -t <question>  [-f packet.md] [--artifact <url>]
                                                    [--from <role>] [--no-options]
```

The body is `-f <path>` or stdin, exactly like `bin/ask.js`, and is held to the same
rule: it must end with a `decision` block (`lib/decision.js`) or the command refuses
before anything is written, naming the fix and the one legitimate way past it
(`--no-options`, for a packet that is a plain go/no-go). What it does past that gate:

1. **Files the question with every packet label in the one `bd create`** —
   `lib/relay.js`'s `packetFor`: `human`, behind the workspace's approval review label
   where it declares a pipeline,
   plus the addressee label `bin/ask.js` also stamps — so there is no write between them
   for a query to catch the bead carrying only one.
2. **Parks `-b` behind the new question** (`lib/park.js`), with the same
   fallback-to-`human` behaviour `bin/ask.js --blocks` has when the edge itself cannot be
   written.
3. **Records the filer's step on `-b`'s own relay trail** (`lib/relayjournal.js`) — role
   `--from`, or the relay's declared `filer` when neither is given;
   step `file`; **no `--next`, ever** — that is the fix, not a caught rejection: the
   command never builds the argument that was getting refused. Skipped, silently, on a
   workspace with no relay and no `--from`: there is no trail to write a role onto, the
   same rule `bin/relaystep.js` follows. `--from` is checked against the workspace's own
   roles first, and an unknown one is refused (exit `3`) before the create, the same as
   an unknown `-b` or a body with no `decision` tail.
4. **Prints the packet id, the labels it now carries, and the relay line** (or that none
   was recorded) **— then, only when `--artifact` was not given, the Rule 1 verdict** on
   whether a repo path written from here would reach a phone (`lib/reachable.js`).
   `lm-5eu.1.1`, `lm-gr6.41` and `lm-gr6.43` each re-derived that by hand — the main
   checkout sits on a branch that is not trunk — and published an Artifact instead; this
   is that derivation, made once rather than re-argued per session. It reads the local
   `origin/HEAD` symbolic ref first, so no network call and no dependency on GitHub
   knowing the repo, falling back to a local `main` or `master`; a checkout it cannot
   read at all, or one with neither, answers `null` rather than a guessed `false`. Pass
   `--artifact <url>` once you already have one — reachable by construction, nothing left
   to verify — and the url is echoed back in its place.

Exit codes: `1` usage, an unknown workspace, a body with no `decision` tail, or `-b`
naming a bead this workspace does not have — all refused before the create, so nothing is
on Adam's phone yet. `3` an unknown `--from` role, refused the same way. `0` otherwise:
the packet exists past that point, so a failed park or a failed relay write is reported
on stderr and the command still exits `0`, the same rule `bin/ask.js` follows and for the
same reason — a caller told the whole thing failed, over a question already on a phone,
either asks nothing or asks twice.

**Not on `DEFAULT_TOOL_LIST`, and no `lib/grants.js` entry either.**
Unlike `b7e-def`/`b7e-show`'s read-only lookups, this is a tracker write — it files a
bead, labels it, adds a dependency edge and appends to another bead's notes — and the one
agent `DEFAULT_TOOL_LIST` actually reaches, `dispatch`, has no relay to be filing on
behalf of and no delivery of its own to gate. A worker session, which is what actually
ends a Story-chain relay, already carries an unrestricted allowlist and needs no grant to
run it — the same call `b7e-say`'s own section makes. See `bin/b7e-packet`, `lib/relay.js`,
`lib/relayjournal.js`, `lib/reachable.js` and `test/b7e-packet.mjs`/`test/reachable.mjs`.
