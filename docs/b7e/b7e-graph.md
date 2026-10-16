### The workspace's beads and comments as one local snapshot you can actually query — `b7e-graph`

`bc-dgx7.98`: sessions each hand-rolled `bd list --status=all --json | python3 -c ...` for
the same kind of question, and one, needing titles, states and comments for 57 beads,
watched its `bd show`/`bd comments` loop run past five minutes (48 concurrent `bd`
processes) before giving up on `bd` for a raw `dolt sql -q` and a hand-written formatter.
That escape hatch, invented under duress, is this command.

```
b7e-graph -w myproject --title-match "Entry 107" --with-comments
b7e-graph -w myproject --assignee someone@example.com --status open,in_progress
b7e-graph -w myproject --label burrow --json
b7e-graph --parent mp-b5d.49                     # ambient workspace, from $BEADS_DIR
```

**What this is not: a claim that `bd list` lacks filters.** By the time this landed, `bd
list` had grown `--title-contains`, `--assignee`, `--label`, `--status` and `--parent`
natively, and `bd show <id1,id2,...> --include-comments` streams full comment bodies for
a whole list of ids in one call. **The problem was never the missing flags — it is that
every one of those still goes through `bd`'s own Dolt access layer**, and that is exactly
what fell over in that session: a raw `dolt sql -q` against the same database, from the
same shell, at the same moment, answered in under a second while `bd` itself hung for
minutes. A `dolt sql` CLI read never takes whatever lock `bd`'s own query path contends
on. `lib/beadsnapshot.js` reads `issues`, `labels`, `comments` and the one `parent-child`
edge per bead straight off each workspace's `embeddeddolt/<prefix>` directory — an
unconditional `select` over each whole table, never a `WHERE` built from a caller's
filter value, so there is nothing to escape because nothing a caller types ever reaches
SQL. All filtering (`--title-match`, `--assignee`, `--label`, `--status`, `--parent`,
`--closed-reason`) happens afterward, over the plain JS array.

**"Identical to `bd list --status=all --json`" is scoped, on purpose.** `bd list --json`
also computes `dependency_count`/`dependent_count`, a full `dependencies[]` array, and
lease bookkeeping (`started_at`, `lease_expires_at`, `heartbeat_at`, joined from a
separate `leases` table) — none of that is reproduced here. What this returns, verified
field-for-field against a real `bd`+`dolt` fixture in `test/beadsnapshot.mjs`: every
column `issues` itself carries, `priority` as a number rather than a string, `labels`
(sorted), `parent` (the one `parent-child` edge naming this bead as the child, or
`null`), `comment_count`, and `comments[]` — printed only when `--with-comments` is
given, though they are always read, since fetching them is the same one pass over the
`comments` table either way.

**The cache is a disposable read cache, not durable state, so it lives under
`os.tmpdir()` and nowhere near `~/.config/beadcause`.** Landing it under `CONFIG_DIR`
would mean an evidence-register entry, a retention decision, and a commonrepo gitignore
line for a file whose entire purpose is to vanish and be rebuilt from a `dolt sql` read
that takes well under a second. It is keyed by the resolved absolute path of the
workspace's `.beads` directory, so two workspaces never collide and losing it (a reboot,
a cleared `/tmp`) costs nothing but one rebuild. Two independent checks decide whether a
cached read is served: `--max-age <mins>` (default 5) and Dolt's own manifest+journal
change signal (`trackerMark`, reused from `lib/detect.js` rather than reinvented) — a
workspace nobody has written to in an hour answers from cache regardless of `--max-age`,
and one `bd` write elsewhere invalidates it immediately regardless of `--max-age`.
`--refresh` ignores the cache outright.

`-w` resolves a name against beadcause's own registered workspaces, the same convention
`b7e-census` uses; with no `-w`, it falls back to `$BEADS_DIR`, the workspace the calling
shell is already scoped to (`_bd_set_workspace` in `~/.zshenv` sets this per-cwd, so a
plain `b7e-graph <predicate>` from inside a project just works).

**Never a write.** Every `dolt` invocation this makes is `dolt sql -r json -q <select>`;
`test/beadsnapshot.mjs` asserts this directly, over every call the cache path makes, not
just by description.
