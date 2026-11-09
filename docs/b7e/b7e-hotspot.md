### Why each of a hot file's merges conflicted — `b7e-hotspot`

```sh
b7e-hotspot <file>                      # the file's conflicted merges, last 30 days
b7e-hotspot <file> --since 90d          # a longer window (Nd or Nh)
b7e-hotspot <file> --merges <sha,sha>   # exactly these merges, whether the ledger has them or not
b7e-hotspot <file> --dir <repo> --base main --json
```

`bc-dgx7.201`. [`b7e-hotspots`](b7e-hotspots.md) ranks the files that keep conflicting and
each hotspot bead then asks the same question: does this file need restructuring, or did
something else make the merges conflict? Five sessions (`bc-xl7n.207`, `.209`, `.210`,
`.211`, `.212`) each wrote a one-off script to find out, each tested a different idea, and
four of them closed with no code because there was nothing to restructure — the merges
were branches cut before the file was rewritten, or a merge driver `.gitattributes` named
that the clone never installed.

One row per conflicted merge: sha, date, subject, each parent's line count (and the
merge-base's), and **one cause**, tried in this order:

| Cause | Meaning | Fix lives in |
|---|---|---|
| `driver-not-installed` | `.gitattributes` named a custom merge driver for the file, git's plain text merge of the two parents conflicts, and the same merge *with* the driver is clean | installing the driver — not the file |
| `stale-branch` | the base had a whole-file rewrite (one commit growing or shrinking it over 5x) that one parent has and the other was cut before; the rewrite commit and its bead are named | nothing: the branch was old |
| `rewrite-collision` | one parent's copy is over 5x larger or smaller than the merge-base's — that branch rewrote the file while the other side edited it | sequencing the rewrite |
| `real` | none of the above: two sides edited neighbouring lines | **restructuring the file** — the only cause this removes |
| `clean-on-rerun` | git merges these parents cleanly now, so whatever conflicted was resolved differently | nothing to explain |

Only `real` argues for a restructure bead. A tally closes the report.

**Uninstalled is emulated, not assumed.** A clone that has since run
`scripts/jsonmerge.mjs --install` would merge `package-lock.json` cleanly today and hide
that it did not at the time. So the text-merge rerun swaps the driver for plain
`git merge-file`, which is exactly what git does with a driver name it has no definition
for. A driver is re-run only when the clone has it configured or the repo ships
`scripts/<name>.mjs`. For the same reason the conflict ledger can lack a file's
driver-fixed merges on a machine that has the driver: pass them with `--merges`.

A rewrite needs both sides over 40 lines and a 5x change; a file's creation or a small
file's growth is not one. Bead ids come from the rewrite commit's subject (a leading
`bc-xxxx:`, or an id carrying a digit), never from branch words like `dolt-server`.
