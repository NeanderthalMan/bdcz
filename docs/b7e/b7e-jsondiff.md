
### What a regenerated JSON file changed, record by record, against a ref — `b7e-jsondiff`

`bc-dgx7.143`, re-homed from delmar's `dv-k4n.37`: four delmar sessions each
regenerated an atlas JSON file (`reference/maps/web/sequences.json` or a `data_*.json`)
and each wrote its own scratchpad comparison against the committed copy — a different
record key and a different splice script every time, one of them (`dv-k4n.22`) refused
twice by the worktree guard for piping `git show` into a hand-rolled diff ("too complex
to verify"). This reads the ref side through `lib/gitref.js`'s `readRefFile`, so there is
no git pipe to refuse, and finds "what a record is" itself rather than being told:

```
b7e-jsondiff reference/maps/web/sequences.json
b7e-jsondiff data_alban.json --ref HEAD~3 --only 'story:1..3'
b7e-jsondiff data_alban.json --keep 'Llanenwr' 'Cwmrith' --write
b7e-jsondiff sequences.json --json
```

**Finding the records without being told the shape.** A regenerated file is either an
array of records, or an object with one property that is an array of records plus some
file-level metadata beside it — delmar's `sequences.json` is `{sequences: [...]}` with
no metadata at all, and `data_alban.json`/`data_americas.json` are `{key, title, image,
bounds, features: [...]}`, the same shape with metadata beside the array. `lib/jsondiff
.js`'s `findCollection` looks for exactly that: whichever of an object's own properties
is an array of objects is the collection, the largest one if more than one candidate
exists (real files here have exactly one, so the tie-break has never been exercised
against real data). Everything else at that level is metadata, reported as changed or
not, never treated as a record. Falls back to the object's own keys as the records when
no such array exists at all — a shape neither real file uses today, kept because a file
this narrow a heuristic cannot see should fail predictably rather than throw.

**Finding each record's identity.** `id`, then `name`, then `key` — the first field
present on every record and unique across them, checked against the ref side and the
working side separately so a field only one side has (or only one side has duplicate-
free) is rejected rather than half-applied. Falls back to positional index when nothing
qualifies, which still finds *changed* records correctly but reads an addition or
removal as if the whole tail had shifted.

**What this deliberately does not do.** It diffs one level of fields per record — a
changed field is reported with a short old/new, and a changed array or object field is
reported by size rather than recursed into. `sequences.json`'s own records nest a
"chapter" inside a step's HTML string (`<span class="seq-t">Ch 1 · ...</span>`) with no
structural field naming it; parsing that convention here would tie a general library to
one atlas's markup, so a changed `steps` array is reported as "steps changed" and reading
which step differs is `--json` or the file itself, not this tool inventing a second HTML
parser.

**`--only <selector>...` is the drift signal, not a filter** — every record is still
reported, and `--only` decides only the exit code: `0` when every change falls inside
what it names, `1` when something changed outside it. A selector is a literal record key,
or `<prefix>:<range>` (`story:1..3` is `story1`, `story2`, `story3`) expanding only
against keys that actually exist — a number the range names but the collection does not
have is silently no match, the same as a literal selector for an absent key.

**`--keep <selector>... --write` rewrites by copying bytes, never by regenerating them.**
The first version of this tool rebuilt the document by `JSON.parse`-ing both sides and
re-serialising the merged result, and lost `"lat": 56.0` to `"lat": 56` on *every
untouched record* in `sequences.json` — neither JS's number type nor `JSON.stringify` can
tell "56" from "56.0" apart once parsed, and this is not a corner case: delmar's own
coordinate data is full of whole-number floats written with a trailing `.0`. `lib/jsondiff
.js`'s `parseSpans` is a hand-rolled JSON parser that keeps every value's byte offsets
into the source text instead of discarding them, so `spliceKeep` never regenerates a byte
it does not have to: every record `--keep` does not name, and all of a file's metadata,
is copied verbatim out of the ref's own text, and only the records `--keep` does name are
substituted, verbatim, from the working copy's text. Verified byte-for-byte against
delmar's actual `sequences.json` and `data_alban.json` (one pretty-printed at one space
per indent level, one compact with Python's default `", "`/`": "` spacing) in a scratch
repo — a `--keep` naming nothing that changed reproduces the ref exactly, not merely an
equivalent re-serialisation of it. A `--keep` key the working copy added and the ref
never had is appended after the ref's own last record, using the separator between the
ref's own last two records as the template for the new one's comma and indentation.
Metadata is always the ref's: `--keep` names records, and metadata is not one.

Exit codes: `0` nothing changed outside `--only` (or, with `--keep --write`, the rewrite
succeeded). `1` something changed outside `--only`. `2` bad usage. `3` the path could not
be read at one side or the other, or is not valid JSON.
