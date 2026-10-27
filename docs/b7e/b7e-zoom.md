### A region of a panel, magnified, with pixel coordinates on it — `b7e-zoom`

`bc-dgx7.195`: five Teaser 01 panel rounds (dv-5eu.123/.127/.131/.132/.134) each wrote a
scratchpad zoom script before their first `plate_fix` recipe and called it again after
every recipe run, to read pixel coordinates off a plate for `fixes/*.json` polygons and to
check placement at 2–3×. They disagreed on how to name the panel (id, path, `label=path`),
on how to find its bytes (worktree, `media_vault.fetch`, a hard-coded cache path — one call
died because a `panels/` path had already been vaulted away), and on whether coordinates
were drawn at all.

```
b7e-zoom P50w_f1 1400,1120,1600,1160 --grid 10      the region, 3x, gridlines labelled in plate pixels
b7e-zoom P25r 1850,720,2300,1100 --scale 2 --recipe fixes/P25t.json
                                                     the recipe's polygons drawn on the crop
b7e-zoom P50v_f1 400,600,900,900 --vs P50v_f2       the same box of another panel, beside it
b7e-zoom graphic-novel/Teaser_01/panels/P50v_f1.png 0,0,800,600 --json
```

**Where the bytes are.** A panel id is looked up as `graphic-novel/<set>/panels/<id>.png`
(then `.jpg`, `.jpeg`, `.webp`) in the worktree first and in the `media_vault` cache
(`~/.cache/delmar-media`, or `$DELMAR_MEDIA_CACHE`) second; a path is tried as typed,
then from the repo root, then under the cache, which is what makes a vaulted path work.
The report says which one answered. An id present in two sets is refused with both named,
not guessed between, and a miss lists every place looked.

**The coordinate frame is the plate's, with no offset.** The crop is enlarged
nearest-neighbour, so no pixel is smoothed into its neighbour, and plate pixel `(x,y)`
lands on output pixel `((x-x0)*scale + scale/2, (y-y0)*scale + scale/2)` — printed on every
run. Gridlines sit on multiples of `--grid` in the plate's own pixels, not the crop's, and
are drawn through that same pixel centre; labels sit inside the picture on a dark chip
rather than in a margin, so a coordinate read off a grid line is the coordinate for a
`mark` op and lands on the pixel it was read from. A box that overhangs the plate is cut
to it and the report says so; a box wholly outside is refused.

**`--recipe`** draws every `polygon` and `protect` (closed), `line`/`lines`/`edge` (open)
and `box`/`source`/`sample` (rectangle) in a `plate_fix` recipe, each tagged
`<op index>:<op>.<field>` and coloured by op. A malformed field is named in the report and
skipped, since a half-written recipe is when this gets run. `plate_fix.py --debug` draws
only a recipe's masks on the whole plate; this is the zoomed, gridded view. Recipe
coordinates are those of the input plate, so a recipe whose earlier ops reframe it (`crop`,
`bleed`, `scale`, always last) is still drawn in the input frame.

Compositing is Pillow and the plate size comes from `sips`, as in `b7e-plate`. Not on
`DEFAULT_TOOL_LIST`, for the same reason: it writes an image file, and a worker session's
tool list is already the unrestricted CLI default.
