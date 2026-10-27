### Put a file where a link to it survives the worktree being retired — `b7e-keep`

`bc-2pysw`. Every repo here generates artifacts into gitignored directories inside a
worktree, and a worktree is temporary: the merge queue retires it when its pull request
merges (`advocates.tidyWorktrees`) and the attic is swept two days later (`expireRetired`).
So a generated file linked to Adam has a two-day fuse, and nothing says so.

It fired on 2026-09-17. Twenty delmar pull requests merged in one sitting and four contact
sheets that had just been put in front of Adam were dead links four minutes later, because
the merges he had approved retired `p36-hide-hold-5eu67`, `props-detail-b5d632` and
`agent-aa1dade2faf5446b2` at 23:20:41Z. He clicked them and got *"The file can't be found."*
It is also the mechanism behind the larger complaint the same day — that there was no
visible evidence delmar's visual line was improving. It was; the evidence kept evaporating.

**The finding that shaped the command is that the durability mechanism already existed and
was already right.** delmar's `scripts/media_vault.py` uploads to `gdrive4t:` and leaves a
committed sidecar, and one of those four — the P36 hold test — had been vaulted correctly by
its own session and was on `main` the whole time; that link died because the caller linked
the worktree copy, not because the render was lost. The other three had no sidecar and
nothing in the vault at all. So this is not a missing mechanism. It is an **optional** one:
vaulting is a thing a session must remember, it fires about one render in four, and which of
Adam's renders survive is decided by whoever happened to be driving.

```
b7e-keep <path> [<path> ...]        keep these; print every path it made
b7e-keep <path> --as <name>         group the keep under a name (a sequence id, a bead id)
b7e-keep <path> --no-vault          copy locally only — no upload, no sidecar
b7e-keep --where [<name>]           the keep root, or the newest keep under that name
b7e-keep --list <name>              every stamped keep under that name, oldest first
```

**A keep makes three things, and each exists because the other two cannot do its job.**

1. **The kept copy**, under the main checkout at `.claude/keep/<name>/<YYYYmmdd-HHMMSS>/`,
   with `latest` repointed. This is what makes the file *clickable*: a `file://` link needs
   local bytes, and a card's `images:` is a local absolute path. Vault-only would mean an
   rclone fetch before every look — the exact friction that made those renders invisible.
2. **The vault copy**, uploaded and sha-verified, when the repo has `scripts/media_vault.py`.
   This is persistence: off this laptop, and findable in six months.
3. **The sidecar**, written beside the **source**, and the only part of a keep that git
   tracks. The command prints it under *"Commit these"* because nothing else records where
   the bytes went, and an uncommitted sidecar is a keep that only this machine knows about.

**The root is the main checkout, resolved through `git rev-parse --git-common-dir`** — which
inside a worktree answers the main checkout's `.git` rather than the worktree's own gitdir.
That is the whole trick, and it is why every worktree of a repo agrees on one root without
being told where it is. `.claude/` is already gitignored everywhere here, so a keep is never
committed and never retired. `$BEADCAUSE_KEEP_ROOT` overrides it, which is what the tests
use.

**Keeps are stamped, and that is deliberate rather than tidy.** A link sent on Tuesday still
shows Tuesday's file while `latest` shows today's — two things a reader wants and cannot
otherwise have at once. It also means two worktrees keeping the same sequence sit side by
side instead of one shadowing the other.

**It never throws.** A keep is filing, not work: a render that already succeeded must not be
failed by the bookkeeping that follows it, so a missing file, an unwritable root or a vault
that refused all come back under `errors` with the good files still kept. The one thing it
does *not* soften is an LFS pointer — `media_vault.publish` refuses those loudly, because
uploading a 130-byte stub as though it were the image is precisely what that guard is for,
and the refusal is carried back rather than swallowed.

Exit code is `0` when everything asked for was kept, `1` when nothing was, `2` for bad usage.

It writes bytes and uploads to a remote, so it is `@grant excluded` for the same reason
`b7e-plate` is: that is a write however you count it, and it is pointless for `dispatch`
besides — a keep's occasion is a worker session that has just rendered something and already
holds the unrestricted CLI default. Nothing is ever kept in answer to a phone comment.
