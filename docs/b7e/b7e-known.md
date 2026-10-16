### Say whether the memory store already holds this — `b7e-known`

`bc-xl7n.112`. Three sessions each checked, by hand, whether an insight was already on
file before writing it down — and no two of them did it the same way, which is exactly
the state of a search nothing can actually answer. `bc-xl7n.83` dumped the whole store
and grepped it (`beadcause-memory notes 2>&1 | grep -i "fail-open|rootless|withRoot|
hasRootAbove"`), got back one adjacent note, read it, decided it was a different fact,
and filed a new key. `bc-ywiy` guessed keys, twice over — `recall focus`, `recall
dispatchKeyEvent`, `notes "p0-full"`, `notes "keydown"` — five empty answers in a row
from a store that, by the end of that same run, held both a `focus` and a `keydown`
note. `bc-khoe.18` searched the wrong store entirely: `grep -rl "too complex"` over the
*personal* memory directory rather than any of beadcause's own three refs, found
nothing, and filed a fact specific to a beadcause worktree as a `remember` — the tier
that follows an agent into every other repo — rather than a `note`.

`lib/memory.js` already had the scorer for this question. `relevantNotes` ranks a
repo's notes against a *bead*, built to hand a session the ones worth reading before it
starts; nothing on the *write* side ever called it, which is why `notes <key>` and
`recall <key>` only ever answer a key the session has to guess.

```
b7e-known -w beadcause -b bc-xl7n.112 <<< 'the prose about to become a note'
b7e-known -w beadcause --file insight.md            no bead: note/remember only
b7e-known -w beadcause -b bc-xl7n.112 --json
```

**The prose comes from stdin or `--file`, never a shell argument** — the same reason
`b7e-say` exists: a backtick or `$(...)` inside a multi-line insight would otherwise be
resolved by the shell before the command ever saw it.

**Two of the three stores are checked unconditionally; the third needs `-b`, and that
omission is deliberate rather than a smaller version of the same search.**
`note`/`remember` are checked by `lib/memory.js`'s new `nearestEntries` — the same
tokenizer, the same `similarity`, the same validated floor (`RELEVANT`, 1.6) that
`relevantNotes` already proved against this repo's own store: an unrelated pair tops
out near 1.0, a real match scores 2.0–4.7. A key's own words count as part of its text
the way a note's key already does for `relevantNotes`, so a key like
`sw-cache-version-conflicts` is found even when the checked prose never quotes the
value verbatim. Tier 4 has no such search: `debriefFamily`'s own header in
`lib/memory.js` is explicit that a debrief's relevance to a bead is graph-distance —
self, parent, siblings — never vocabulary, because a report on one attempt at a bead is
not a belief that generalises the way a note or a remember does. So without `-b` there
is no honest scope to check a debrief against, and this checks none; with `-b`, it
checks the debrief entries already on file for that bead and its family, the same
family `beadcause-memory debriefs` reads.

**`-b` can be inherited rather than typed, and the two are not treated the same.** With
no `-b` on the command line, `$BEADCAUSE_BEAD` supplies one — every agent session
already has it stamped, and `whichBead()` in `bin/beadcause-memory` reads it the same
way, so a session that types no `-b` still gets the debrief scope its own `-b <bead>`
would have given it. An *explicit* `-b` naming something this tracker does not have is
a hard `4`: the caller asked for that scope and did not get it. An *inherited* one that
does not resolve — a cross-workspace call, a bead since renamed, a `bd` that would not
answer against the shared Dolt DB — is not a failure at all; it is one fewer store
checked, said on stderr, with `note`/`remember` still answered and the exit still `0`.
Neither of those two needs a bead, and this command gates nothing.

**`--agent` is checked against `agents()` — `lib/memory.js`'s own roster of who has ever
remembered anything — and a name not on it is a hard `4`, not a quiet all-clear.**
`bc-dgx7.46`: `--agent reviewAdvocate` (a typo for `review-advocate`) used to read an
empty tier 2 and tier 1 and print exactly the same "nothing on file reads like this ...
Safe to file a new key" a genuinely fresh, correctly-spelled agent gets — no way to tell
a name that is wrong from a name that is right but unused. The check is on the *name*:
a real agent with nothing relevant on file for this text still gets that same message at
exit `0`, because an empty store is a plausible state and this command still gates
nothing.

**What comes back, per hit: the store, the key (or, for a debrief, which bead and
whether it is still only staged), the score, the first line, and the exact command
that updates it in place** — `b7e-say -w <ws> -b <bead> --note <key>` or `--remember
<key>`. A debrief has no key to update; the line for one instead names `--debrief`,
because a report on a run appends rather than overwrites. `--json` carries all of that
plus each hit's whole stored `value`, so a debrief hit is no less identifiable there
than in the printed form. Nothing found prints one line saying so and exits `0`
— this answers a question, it does not gate anything, and "safe to file a new
key" is as real an answer as a hit.

**Never opens a path under the personal memory directory** bc-khoe.18 searched instead
— the only imports here are `lib/memory.js` and `lib/sessionlog.js`, neither of which
takes one, and `test/known.mjs` asserts the source names no such path.

`Bash(b7e-known:*)` is on `DEFAULT_TOOL_LIST` and `read` in
`lib/grants.js`: every path through it is `bd show` (only when `-b` is given) plus the
three memory-store reads above, nothing that writes anywhere. See `bin/b7e-known`,
`lib/memory.js`'s `nearestEntries` and `test/known.mjs`.
