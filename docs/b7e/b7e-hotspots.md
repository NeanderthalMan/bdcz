### Which files keep conflicting, and how to restructure them — `b7e-hotspots`

```sh
b7e-hotspots                      # the repo the cwd is in, against origin/main
b7e-hotspots --dir <repo>         # another checkout
b7e-hotspots --base develop       # a different base branch
b7e-hotspots --min 2              # a lower bar than the filing threshold (4)
b7e-hotspots --json
```

`bc-8nyxa`. Every conflict resolution costs a session, and nothing remembered *where* the
conflict was — so the same file conflicted again on the next pair of branches. Replaying
one busy repo's last 400 merges showed seven files causing nearly all of them, and none
of those conflicts were real disagreements: two append-only logs, a README every branch
adds a line to, three generated one-line JSON blobs, and a check script with hard-coded
expected counts. Those are *shapes*, and a shape can be fixed once.

**How it knows.** Every resolution leaves a merge commit. Replaying that merge's two
parents through `git merge-tree --write-tree` names the paths that conflicted and where
the markers landed, whoever resolved it — a resolver, the MergeAdvocate, a worker's own
downmerge, or a human. The ledger (`~/.config/beadcause/hotspots.json`, per repo) is
incremental after the first scan, which replays the last 30 days.

**What the daemon does with it** (`lib/hotspots.js`): after a merge lands in a repo, the
merge sweep brings that repo's ledger up to date and files one bead per file that
conflicted in 4+ merges in 30 days — labelled `conflict-hotspot` plus a per-file
`hotspot:<key>`, carrying `unendorsed` unless the space auto-endorses. The bead names the
file, when and where in it the conflicts landed, the guessed shape, and the patterns that
fit it:

| Shape | Pattern |
|---|---|
| one-line generated blob | stop committing it (build where consumed), or emit one record per line, sorted |
| append-only log | fragments — one file per entry, compiled on read or at release; `merge=union` only helps local merges (GitHub ignores it) |
| registry / index | generate it from the items; or keep it sorted one-per-line; move volatile sections out |
| hard-coded expected values | derive at run time, or move to a data file keyed one-per-line |
| large module | split out the table/list the conflicts cluster in; split by concern |

No second bead while one is open. After one closes, another is filed only if the file
conflicts 4 more times *after* the close — and it names the bead that did not hold.

This command is the read-only half: it updates the ledger and prints the report. It
files nothing.
