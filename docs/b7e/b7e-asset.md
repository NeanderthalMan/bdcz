### Where a media file's bytes actually are — `b7e-asset`

`bc-dgx7.140`, filed by the session audit against four delmar sessions (`dv-2uu.15`,
`dv-2uu.12`, a `dv-5eu` replan, `dv-5i2.120`) that each answered the same question with a
different ad-hoc probe. `dv-2uu.15` hand-built a census with `md5`, `sips` and `stat` over
87 character-library files. `dv-2uu.12` ran a manual `git check-attr -a` + `shasum` +
`rclone lsf` chain, file by file, to tell a real image apart from an unsmudged LFS
pointer. The `dv-5eu` replan pointed a bare `ls | wc -l` at a directory and read back
`0` — the directory held nothing but `.md` sidecars, and nothing about `ls` knows that a
sidecar means "the real file is on the vault, not here". `dv-5i2.120` wrote a generator
that degraded to reporting nothing at all for a vault-only asset, with the reason buried
in a warning nobody read until later. Four sessions, four rigs, for one question: *are
this file's bytes here, in the LFS store, or on the vault — and if it isn't here, where*.

```
b7e-asset reference/maps/c1_02_anavarre.png          one file, classified
b7e-asset webseries/library/characters/muchi         a directory, walked recursively
b7e-asset graphic-novel/output/*.png --json          a glob, machine-readable
b7e-asset webseries/library/characters -w delmar    another checkout by workspace name
b7e-asset reference/maps/gemini/final/atlantis.png --remote   ask the vault too
b7e-asset graphic-novel/output --fetch /tmp/review   pull every non-local asset's bytes
```

**Four states, in precedence order.** `bytes` — the file is on disk and is not an
unsmudged LFS pointer stub. `lfs-pointer` — the file is on disk, `<=1024` bytes, and opens
with the git-LFS pointer magic line (`lib/asset.js`'s `isLfsPointerFile`, the identical
check `docs/MEDIA_VAULT.md`'s own `media_vault.py` uses, because a worktree created with
`lfs.fetchexclude=*` — this repo's own convention for every LFS-tracked path — checks out
a ~130-byte text stub in place of the real image, and publishing or reading one as though
it were real data is exactly the trap `media_vault.py`'s own docs call out by name).
`sidecar-only` — no file on disk, but a `<name>.<ext>.md` sidecar exists and its YAML
frontmatter names a `remote:`. `missing` — none of the above, including a sidecar that
exists but names no `remote`: a **dangling** sidecar is reported as `missing`, with its
`sidecarPath` still filled in, rather than folded into "nothing here at all" — the
distinction the acceptance criteria's own dangling-sidecar fixture exists to force.
`missing` is the only state the command exits `1` for; the other three all mean the
question was answered, one way or another.

**Directory expansion is recursive, on purpose — the opposite of `b7e-plate`'s.**
`b7e-plate`'s own directory listing is deliberately *not* recursive, so a stray
subdirectory of thumbnails never lands on a montage uninvited. This tool needs the
opposite: the `dv-5eu` replan's whole failure was a directory of nothing but sidecars
reading as empty, so `resolveTargets` walks the full tree and unions every media-extension
file it finds with the media path every sidecar it finds implies — present or not — before
classifying either. Verified against delmar's own tree rather than a synthetic stand-in:
`graphic-novel/output/` reports every `chapter1_sceneNN.png` as `sidecar-only` with none
of the real files present (the shape the `dv-5eu` replan actually hit), and
`webseries/library/characters/` reproduces `dv-2uu.15`'s **87-file** census exactly,
including which of those files are `tracked` versus `ignored` under this repo's own
"stills committed before 2026-08-05 stay tracked, later ones are gitignored" rule — a
real file with a stale sidecar still beside it (a `media_vault.PROTECTED` path, kept
local on purpose) classifies as `bytes`, not `sidecar-only`: real bytes beat a pointer
beat a sidecar beat nothing, always the closest true answer to "where are the bytes",
never the oldest one.

**`--remote` and `--fetch` are both opt-in and both go through `rclone` (and, for a
pointer, `git lfs pull`) directly** — never by shelling out to a target checkout's own
`scripts/media_vault.py`, because a `b7e-*` tool has to work against whatever checkout
names it, not only the one that invented the sidecar convention it recognises. `--remote`
asks `rclone size --json <remote>` per `sidecar-only` row and reports whether the vault
actually has it and its size there — off by default, so the common case (everything
local, no network) stays instant. `--fetch <dir>` pulls a `sidecar-only` row via `rclone
copyto` and an `lfs-pointer` row via `git lfs pull --include=<path>` against the checkout
root (the standard way to un-stub one path in a `fetchexclude` worktree) followed by a
copy of the now-real file into `<dir>` — the pointer path is the one place this touches
the checkout's own working tree, and it does so deliberately rather than silently, which
is why it needs the explicit flag. Both are exercised in `test/asset.mjs` against an
injected `rclone`/`git` rather than the real binaries, the same shape `test/plate.mjs`
uses for `sips`/Pillow — `toolsAvailable()` still gates the real CLI path so a machine
without `rclone` gets a clear refusal instead of a stack trace.

**`@grant excluded`, not `@grant read`.** A bare `b7e-asset <path>` only reads, but
`--fetch` mutates — it writes into `<dir>` and, for a pointer, smudges a file inside the
checkout itself — and `lib/tooldecl.js`'s derivation is per-file, not per-argv: a `read`
tag would put the whole tool, mutating flag included, on the auto-run allowlist. Four
existing tools (`b7e-apply`, `b7e-take`, `b7e-swbump`, `b7e-filed.js`'s `--repair`) made
the same call for the same reason before this one.

Exit codes: `0` every resolved asset is `bytes`, `lfs-pointer` or `sidecar-only`. `1` at
least one is `missing`. `2` bad usage, no target resolved to anything, an unknown `-w`
workspace, or `--remote`/`--fetch` asked for and `rclone` is not runnable here.
