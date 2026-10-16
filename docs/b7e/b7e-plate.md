### One labelled montage PNG from a directory of images — `b7e-plate`

`bc-dgx7.91`: three sessions reviewing batches of stills each hand-built a rig for *what
does this whole directory actually look like* — a `sips` batch plus twelve separate
`Read`s, six full-resolution `Read`s straight off disk, three different PIL scripts —
when the answer is one sheet a session can `Read` in one call.

```
b7e-plate assets/screenshots/release-2              a directory — its own images, sorted
b7e-plate images/img_*.png title_card.png --max 12  explicit targets, capped
b7e-plate images --cols 4 --width 240               grid shape and tile size
b7e-plate images/img_003.png --crop 420,120,300,300 one enlarged region of one source
b7e-plate images --out /tmp/review/plate.png --json  a fixed path, machine-readable
```

Prints the sheet's absolute path, then one line per tile in the order it was placed,
naming the source file and its **native** dimensions — not the tile's, which is what
one session's own montage script printed by hand and what a session asking "how big is
that image really" wants. A directory target expands to its own recognised image files
(`lib/plate.js`'s `IMAGE_EXTENSIONS`), sorted by name, **not recursively** — a stray
subdirectory of thumbnails is never silently pulled onto the sheet, which is exactly the
`thumbs/` trap `test/plate.mjs` fabricates and checks for. `--max` caps at the first N in
resolved order and always names what it dropped; there is no silent truncation.

**The bead's own text named ffmpeg's `tile` filter for the compositing, and that turned
out not to work on this machine.** `ffmpeg -filters` here (homebrew, 8.1.1) has no
`drawtext` line — this build was compiled without libfreetype — so a sheet built with
`tile` alone would have no filenames on it, which is the one thing all three sessions
kept re-deriving by hand. `python3`'s Pillow, already installed on this machine and what
one of those sessions used directly three times over, does the compositing and the labelling in
ffmpeg's place; `sips` still does the one thing it is uniquely cheap at — reading a whole
batch of native dimensions in a single call (`sips -g pixelWidth -g pixelHeight -g format
<files>`), which is one process instead of N. That batch output is parsed **positionally**,
not by matching each block's header back to the path passed in: `sips` echoes `/tmp` back
as `/private/tmp` on this machine, so a string-keyed match would silently drop every file
under `/tmp`, and `sips` prints one block per file in call order regardless.

**Idempotent by construction, not by luck.** Nothing in the render job carries a
timestamp, and Pillow's default font (`ImageFont.load_default()`) is a bundled bitmap
font rather than a system one, so the labelling owes nothing to what happens to be
installed. Two calls against the same input and the same `--out` overwrite with a
byte-identical PNG — `test/plate.mjs` proves this against a real render, not just against
the manifest, whenever `sips` and `python3`+Pillow are both actually runnable on the
machine running the suite; it skips that block loudly otherwise, the same shape
`test/adoptsweepreal.mjs` uses for a missing `bd`.

**Deliberately NOT on `DEFAULT_TOOL_LIST`** (`lib/toolbelt.js`), on the same reading as
`b7e-eyeball`: shelling out to composite and write an image file is the shape
`lib/grants.js` already calls a write on the strength of "nothing about writing an image
file is a read," and it is pointless for `dispatch` regardless — no directory of stills
is ever in front of one phone comment. Its occasion is a worker session with a branch of
its own, and `worker`'s tool list is the unrestricted CLI default, so a grant would widen
nothing that agent cannot already reach.
