### Show a bead from any tracker by its id, from whatever directory you are in — `b7e-xbead`

`bc-dgx7.192`, filed from `lm-b5d.83`. Eight loremia sessions (`lm-vary`, `lm-reckon`,
`lm-pxdf`, `lm-shot`, `lm-body`, `lm-names`, `lm-words`, `lm-chkpt`) each waited on
`beadcause/bc-irzp7` and had to read it from a loremia directory, where `bd` only looks in
the lm tracker. The hand-rolled lookup, `cd ~ && zsh -c 'bd show …'`, chose the tracker
before the inner `cd` ran and answered a false "no issue found matching" — three of four
attempts started outside beadcause failed that way.

```
b7e-xbead bc-irzp7                       found by its prefix, in whichever tracker owns bc-
b7e-xbead beadcause/bc-irzp7 lm-vary     workspace-qualified, several at once
b7e-xbead bc-irzp7 --comments            include the whole thread
b7e-xbead lm-vary --json                 the same fields as records
```

Per id, in a fixed order: the tracker it was found in, status, title, assignee, open
children, open blockers (open `blocks` edges, plus a `blocked-by:<workspace>/<id>` marker,
which is the same fact held where no edge can reach), and the last comment's date and
author. The tracker comes from the id's prefix — each workspace's `dolt_database` in its
`.beads/metadata.json`, the same map `lib/newspace.js` uses — and `Bd` sets `BEADS_DIR`
itself, so the directory you run it from decides nothing.

**It never answers a silent "not found".** Exit `0` means every id was found, `2` bad
usage, `3` a prefix matches no tracker (the message names the prefix and the ones that do
exist; this outranks the others), `4` a known tracker has no such id (the message says
which tracker and directory were searched), `5` a tracker could not be read, which is not
the same answer as "no such bead".

`bin/b7e-xbead` declares `@grant read`: one `bd show` and one `bd list` per tracker, never
a write. See `bin/b7e-xbead`, `lib/xbead.js` and `test/xbead.mjs`.
