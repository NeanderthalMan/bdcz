### Replay a file's past merges with a proposed change — `b7e-reshape`

```sh
b7e-reshape <file> --transform ./sort.mjs        # module default-exporting (text, side) => text
b7e-reshape <file> --driver jsonmerge='node scripts/jsonmerge.mjs %O %A %B %P'
b7e-reshape <file> --transform t.mjs --since 90d --merges <sha,sha> --json
```

`bc-dgx7.202`. [`b7e-hotspot`](b7e-hotspot.md) explains why past merges conflicted but cannot
test a fix. Three sessions (`bc-xl7n.207` package-lock.json, `.212` docs/config.md, `.213`
lib/server.js) each had to answer "would this change cut the file's conflicts?" and each
wrote its own replay script; the change under test was a merge driver, a row layout and an
import layout, but the measurement was identical.

Every merge in the window (default 120 days) that changed the file on **both** sides is
merged twice from the same three copies (merge-base, first parent, second parent): as
`git merge-file` does today, and with the change — the transform applied to all three copies
(`side` is `'base'`, `'ours'` or `'theirs'`), a driver run in place of the text merge
(`%O %A %B %P`, from the repo root, as git does), or both. Output is two lines of totals —
merges, conflicted merges and conflicted sections before -> after — then a row per merge
whose count moved, **worse first**. `--json` adds each row's conflict-marker excerpt.

Nothing is written to a worktree or the index; merges happen on temp files. The first parent
is "ours", matching git's convention for a merge commit.
