### When an artefact was produced, and what that governs it changed afterwards — `b7e-asof`

```sh
b7e-asof 'webseries/library/characters/**/*.png' \
    --against 'webseries/library/characters/*/identity.txt' \
    --against webseries/library/cutout_style.py      # every plate against its docs and the ledger
b7e-asof graphic-novel/artist-vision.json             # CHANGE_LOG entries landed after it
b7e-asof teaser.png --vault listing.txt               # add a saved `rclone lsl` reading
b7e-asof '<glob>' --against '<glob>' --check          # exit 1 when anything predates
b7e-asof '<glob>' --json
b7e-asof --dir <root> <path>                          # another tree — how it is tested
```

`bc-xl7n.153`, from loremia's `lm-2uu.23`. Three loremia sessions were asking one
question — is this generated file older than the document that governs it — and each
dated the file off a different source. `lm-2uu.15` built an mtime histogram over 87
character PNGs with `find … -exec stat`, then `git log` over the directory, then
per-file `git log --all` on individual plates, and failed all 87: every plate predated the
first `identity.txt` (2026-08-10) and Entry 086's style relock (2026-07-22). It wrote a
memory note named for the command it wished existed. `lm-5eu.10` spent a `grep` and two
`sed -n` range reads of `CHANGE_LOG.md` to learn Entry 107 landed after
`artist-vision.json` last changed. `lm-2uu.12` dated a plate off an `rclone lsf` line
instead. Three sources of truth for one date, three hand derivations, and nothing that
said when they disagreed — which in `lm-2uu.15` they did.

**One row per artefact**: its path, its produced-at, which source that came from, and —
when the readings span more than one calendar day — every reading side by side. The
sources are the file's last commit (`git`), this copy's `mtime`, a JSON `sidecar` beside
it (`<file>.json`, `<stem>.json`, or either `.meta.json`, carrying `generated_at`,
`created_at`, `timestamp` or a similar key), and a saved `vault` listing passed with
`--vault`. Every one of those is an observation that the file existed *by* some moment,
and none can be earlier than when it was made, so produced-at is **the earliest reading**
— a fresh checkout's mtime or a late commit can never pass for a generation date. A
sidecar is the one source that claims the moment directly, so it wins when present. The
vault is never listed live: that is a network call and a remote name this tool has no
business owning, so it reads a listing somebody already saved, matched by path suffix and
then by a unique basename.

**Then, per artefact, what came after it.** Every `--against` path whose last commit is
newer, with that commit's sha, date and subject (a governing file git has never seen is
dated by its mtime and says so). And every `CHANGE_LOG.md` entry dated after the
production day — the ledger defaults to `CHANGE_LOG.md` at the root when one exists,
parsed with `lib/changelog.js`'s own `entryHeadings` so template headings and `078b`-style
renumbers read exactly as delmar's `d5a-changelog` reads them; `--changelog <file>` names another,
`--no-changelog` skips it, and a root with none still runs and says no entry ledger was
found. The first five later entries print with their `Type:` line and every later
entry's number follows, because the entry that matters — a relock — is rarely the
earliest. **An entry dated the same day as production is reported as "same day, cannot
order", not dropped:** a heading carries a day and no time, and loremia's pose plates
share 2026-07-22 with Entry 086 itself, so a day comparison that quietly called that
current would pass the files the relock was written to fail.

Globs are expanded against the root, not the caller's cwd, and are the filesystem's rather
than `git ls-files`' — a generated PNG is as likely to be ignored as tracked. Quote them so
the shell leaves `**` alone. A pattern that matches nothing is an error, not an empty
report, so a typo cannot read as "nothing is stale". The root is `--dir`, else the checkout
`-w` names, else the git toplevel of the caller's cwd.

`lib/asof.js` is the date resolution, the sidecar and vault reads, and the comparison;
`bin/b7e-asof` is the argv shell and the printing. Reads only.

Exit codes: `0` ran, whatever it found. `1` with `--check`, at least one artefact predates
something. `2` bad usage. `3` a path or glob matched nothing, or a named `--changelog` or
`--vault` file does not exist. `4` `-w` named a workspace this Mac has no config for, or
there is no root (not in a git checkout, and no `--dir`).
