### One field of a bead, raw, and the readback that proves a write landed — `b7e-field`

`bc-dgx7.26`, filed by the session audit against five sessions that each needed the
exact bytes of one field of one bead and each wrote its own extractor, none of them the
same one: a `node -e` piped from `bd show --json`, a different `node -e` for a different
field, four separate `python3 -c` snippets in one session, five in another (one of which
dumped `design` to a scratch file and reported its length by hand), a scratchpad
`extract.py` that got refused by the classifier and was redone inline. Two of the five
could not use `bd show` at all without a detour — it emitted 37.8 KB and 83.8 KB, both
persisted to a tool-result file that then had to be read back and grepped before the
session could see the one field it wanted. The other half of the same shape is
*verifying a write landed* — `byte-identical: True 4147`, `before 6178 after 5772` — the
same question asked three ways, none of them reusable.

```
b7e-field -w beadcause -b bc-xyz notes                     the notes body, raw
b7e-field -w beadcause -b bc-xyz description acceptance    two fields, each under a
                                                             ── <field> rule
b7e-field -w beadcause -b bc-xyz --all                      every field with a value
b7e-field -w beadcause -b bc-xyz notes --len                notes 453             (bytes,
                                                             not the body)
b7e-field -w beadcause -b bc-xyz notes --verify expect.txt  nothing + exit 0 if identical,
                                                             a unified diff + exit 1 if not
```

A field name is one of a fixed set — `description`, `design`, `notes`, `acceptance`,
`labels`, `status`, `assignee`, `priority`, `title` — never a raw `bd --json` key, so
`acceptance` (not `acceptance_criteria`) is what a caller types. `labels` prints one
label per line; every other field prints exactly what `bd show --json` holds for it,
with no added or stripped newline in single-field mode — the byte-for-byte case the
bead's own acceptance criteria names. An unset field prints empty rather than being
refused; a field name that is not one of the nine is refused, naming the ones that are.

**`--verify <file>` is the write-landed half.** It reads the one named field, compares
it against `<file>` byte for byte, and either prints nothing and exits `0`, or prints a
unified diff and exits `1` — `git diff --no-index` against a scratch copy of the live
field, the same trick `lib/show.js` uses for a ref, applied here to two arbitrary files
rather than a ref and a working tree. It needs exactly one field: combined with `--all`
or with more than one field name, or with `--len`, it is refused rather than guessing
which field to compare.

Exit codes: `0` printed, or `--verify` found no difference. `1` `--verify` found a
difference. `2` refused — bad usage, an unrecognised field name, an unconfigured
workspace, or the bead does not exist. `Bash(b7e-field:*)` is on `DEFAULT_TOOL_LIST`,
declared `@grant read` in the command's own header: the only `bd` verb it ever spawns is
`show`. See `bin/b7e-field` and `test/b7efield.mjs`.
