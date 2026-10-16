### The `--index`-th of `--total` shards, one suite per line — `b7e-shard`

```
b7e-shard --index i --total N          this shard's suites, one per line
b7e-shard --index i --total N --dir <root>
```

`.github/workflows/test.yml` is the caller (bc-xlz32.4): each of its four `shard` matrix
legs runs this to get its slice, then feeds it straight to `bin/b7e-gate --only`. It adds
no second discovery of what a suite *is* — `lib/gate.js`'s `discoverSuites()`, which
already shells `scripts/test.mjs --list`, is reused as-is — this file only slices the list
that comes back, in `lib/shard.js`, and prints the result.

**Stride, not a contiguous block.** `suites[i]` goes to shard `i % total`, because the
suite list is not uniform cost: the pinned suites front and back, the nine `*real.mjs`
suites and `test/landcheck.mjs` all run far longer than the alphabetical middle, and a
contiguous slice would put however many of those sort together into whichever one shard
covers that stretch — the slowest shard would set the ceiling for all of them, which is
the whole thing sharding exists to avoid. Stride spreads them out without needing to know
in advance which suites are expensive. `test/shard.mjs` asserts the invariant this exists
for: `total` shards, unioned, reproduce the input exactly — nothing dropped (a coverage
hole CI would never notice, since the run still goes green) and nothing duplicated
(wasted runner minutes, and a stateful suite raced against itself would flake with no
local repro) — for a synthetic list, for every shard count the workflow actually uses,
and against this repo's own suite list live.

**Deliberately not on `DEFAULT_TOOL_LIST`.** It is read-only by
construction, the same shape as `b7e-affected` just below — but unlike `b7e-affected`,
which answers "what does my diff touch" for whoever is looking at one, `b7e-shard`
answers a question that only exists because of how CI happens to be sliced this week.
The one real use for a session — "why did shard 2 go red" — is answered faster by reading
that shard's own log than by re-deriving which suites it held, so the grant would sit
here unused the same way `b7e-worktree`'s does above.
