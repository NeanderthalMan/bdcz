### Whose move is this bead — an agent's or Adam's — in one call — `b7e-turn`

`bc-dgx7.193`, filed from eight loremia sessions (`lm-s1etp`, `lm-bisnf`, `lm-0h1k5`,
`lm-ixtlh`, `lm-dbaoa`, `lm-f6bd.6`, `.8`, `.9`). Each was opened on a bead whose next move
was Adam's and worked that out by hand — a different set of `bd comments`, `git merge-base`
and `grep` checks every time — before stopping with a comment, a `human` label and no commit.

```
b7e-turn -w loremia -b lm-dbaoa              one verdict line
b7e-turn -w loremia -b lm-dbaoa --siblings   and the siblings under the same parent
b7e-turn -w loremia -b lm-dbaoa --json       the same, as a record
```

The verdict is `agent` or `adam` plus the **one rule that decided it**, taken in this order:
the bead already carries `human`; its assignee is `adam` (the bare name — a claim stamps the
git identity, an email, on every bead a worker takes, so that does not count); it is a
`decision` whose block has no recorded answer (`lib/beadanswer.js` decides "answered"); it is
a Read card (title `Read: …` or label `read`) with no `docnotes` comment on its thread.
Anything else is `agent`; a closed bead is `agent` with rule `closed`. The newest comment
that counts as Adam's input (a `docnotes` comment or one he wrote) is printed beneath.
`--siblings` flags the ones that are Adam's but carry no `human` label.

Exit `0` answered whatever the verdict, `2` bad usage, `3` unknown workspace, `4` no such
bead, `1` the tracker could not be read. `@grant read`: reads only. The rules live in
`lib/turn.js` so the advocate can call the same function; that wiring is a separate bead.
See `bin/b7e-turn`, `lib/turn.js` and `test/turn.mjs`.
