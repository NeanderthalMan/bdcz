### Every artefact other beads left for a panel — shape, alpha, and where the bytes are — `b7e-packets`

`bc-xl7n.178` is the same list rebuilt three times by hand. Three delmar sessions
(`dv-52r.63`, `dv-52r.64`, `dv-52r.65`) each needed the P22 plates earlier beads had left
under `.claude/packets/<bead>/`, and each found them a different way: a `for` loop of `ls`
over eight hand-named dirs, an inline PIL probe for the size and mode of each image that
the worktree guard refused (twice, once for a `cd` into the shared checkout and once for a
`$P` path variable), then a `cat bg.png.md` to learn that the background was a vault
sidecar, an `rclone copyto` typed from memory and a `sha256` check by hand.

```
b7e-packets -w delmar P22                          every file whose name carries P22, in every packet dir
b7e-packets -w delmar P22 --beads dv-52r.54,dv-py91r   only those packet dirs (the first path segment)
b7e-packets -w delmar P22 --fetch /tmp/p22         also pull each vault sidecar's bytes there and check its sha256
b7e-packets -w delmar P22 --no-alpha --json        skip pixel decoding; the machine-readable form
b7e-packets -w delmar P22 --dir /path/to/checkout  a checkout other than ~/projects/delmar
```

One row per file: the path under `.claude/packets`, its kind (`image`, `npy`, `json`,
`sidecar`, `other`), width×height, mode, the alpha coverage, whether it shares the
dominant canvas, and its size on disk. Sizes and modes come from the file headers. A
`.npy` is read from its header only, so a depth array is never loaded, and it reports the
array's `(rows, cols)` as height and width so it can be compared with the plate it goes
with. Alpha coverage is the one thing that decodes pixels: for `RGBA` and `LA` it is the
share of pixels with alpha above zero, and for a single-channel `L` image — which is what
a mask is — the share that is not zero, printed as `nonzero=` so a mask's white area is
not mistaken for transparency. `RGB` has no alpha and prints none; a palette or
interlaced PNG prints none rather than a guess. `--no-alpha` skips the decode, which is
about a second for a handful of 2400×1792 plates.

A file matches by **name**. A vault sidecar (`<file>.md` whose front matter says `kind:
media-sidecar`) is reported as the file it stands for and additionally matches when a file
that carries the key sits in the same directory, because the frame a plate was built from
(`bg.png`) is beside the plate that carries the panel's token (`P22_composed.png`) and is
not named for it. Its row says `sidecar`, whether the bytes are on this disk, and when they
are not, the remote, the recorded byte count and the `sha256`. `--fetch <dir>` runs `rclone
copyto` for each sidecar row into `<dir>/<its path under .claude/packets>`, then checks the
`sha256` the sidecar recorded; a file already there with the right hash is left alone, and
the destination is refused if it would land outside `<dir>`.

Without `--fetch` it only reads. `--fetch` writes and reaches the network, which is why the
command is declared `@grant excluded` rather than `read` — a grant is per file, not per
argument — and why it is not on the default tool list: a session that wants the read-only
report is granted the command, not assumed to have it. Exit code is `0` for a report (an
empty one included), `1` when a `--fetch` failed or its hash did not match, and `2` for a
bad invocation.
