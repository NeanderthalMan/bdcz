### A named section of a document, with its line span, instead of grep-then-guess-a-range — `b7e-section`

`bc-dgx7.108` names seven sessions (`lm-5i2.52`, `lm-5i2.46`, `lm-5i2.45`, `lm-5i2.90`,
`lm-5eu.1.9`, `lm-3rn.12`, `lm-b5d.33`) that each located one section of a governing
document by hand, no two the same way. `lm-3rn.12` spent seven calls landing on two
sections of an audit document: a `grep -n` for candidate heading lines, a `Read`, a second
narrower `grep`, another `Read`, a `sed -n '590,630p'` guessed range, a third `grep`, then
two more `Read`s. `lm-5i2.52` needed four calls on `docs/MYSTERY_BIBLE.md`, three of them
failed guesses at how the file writes its laws (`grep -n "^## LAW\|^### LAW\|^\*\*LAW"`,
then `"LAW #"`, then a bare `-i "law"`) before it found that the laws are not ATX headings
at all — each is a bolded label line, `**LAW #6: ...**`. `lm-b5d.33` did the same dance to
a Python function: `grep -n "def check_sequence" -A 60 …` that returned nothing because the
function was in a different file than guessed, then a repo-wide `grep -rn` to find it, then
a `sed -n '1,200p'` on the whole file to get the one function inside it. `bin/b7e-def`
answers "where is this defined" for this repo's own `.js`/`.mjs`/`.cjs` sources, but a
workspace repo's governing documents *are* its source, and nothing answered this there.

```
b7e-section <path> <heading-or-name>       the section whose heading/name matches
b7e-section <path> --toc                   every heading: depth, span, line count, text
b7e-section <path> <name> --at <ref>       the file as it was at <ref>, not the working tree
b7e-section <path> <name> --json           machine-readable
b7e-section --dir <root> <path> <name>     <path> resolved under another tree, not cwd
```

**Two heading flavours, chosen by the document's own shape.** A Markdown file
(`.md`/`.markdown`/`.mdx`) is read as ATX headings (`#{1,6} `) first — the same fence-aware
parse `lib/readme.js` already does for this repo's own specification, reused rather than
rewritten. Only when a Markdown document has **no** ATX heading at all does this fall back
to treating every line that opens with a bolded label (`**LAW #6: ...**`) as a flat
section of its own — exactly the shape `lm-5i2.52` lost three calls to. Anything that is
not Markdown is read as code: a `def`/`function`/`class` line names a section, and its own
indentation stands in for heading depth, so a method nested inside a class ends at its next
sibling method or at the class's own dedent, the same rule that ends an outer Markdown
section at the next heading of the same or shallower level.

**Matching is exact first, substring second, and either tier can be ambiguous.**
`subject_screen_height` matches that one function by its exact name; `'LAW #6'` matches
`**LAW #6: Do not delete a scene others are using**`, which is not an exact match against
anything, only a substring one. A heading occurring twice — the same title in two places —
is not resolved to "the first one": it exits `1` and lists every span that matched, because
picking one silently would be answering a question that was never asked. A name that
matches nothing exits `1` naming the nearest headings by edit distance, rather than a bare
"not found", the same courtesy `b7e-def` gives a misspelled symbol.

**The answer is the section itself, not just its coordinates.** The one header line —
`<path>:<start>-<end>  <the heading as written>` — is followed by the section's body
verbatim, ending the line before the next heading of the same or shallower depth begins
(or end of file). That is the difference from `b7e-readme`, which only ever reports where
something is: the six sessions above were not looking for a line range to remember, they
were looking to read the section, and this returns it in the same call.

**`--toc`** lists every heading instead of matching one — depth, span, line count, then
the heading text — so a caller can see the whole shape of an unfamiliar document and pick
a section without a `Read` first. **`--at <ref>`** reads the file as `git show <ref>:<path>`
sees it rather than the working tree, which is what `lm-3rn.12`'s audit case actually
needed: by the time anyone re-reads what an audit found, some of it has already been
fixed, and the finding only exists at the commit before the fix. **`--dir <root>`** resolves
`<path>` (and, with `--at`, the git repository) under another tree — this is how the tool
is tested, the same escape hatch `b7e-readme` uses.

`lib/section.js` is the parsing, the two heading flavours, the matching tiers and the span
arithmetic — the last of which is `lib/readme.js`'s own `rangeFor`, reused as written
rather than reimplemented, because it only ever needs a `.level` and a `.line` and neither
heading flavour here changes that shape. `bin/b7e-section` is the argv shell.

Exit codes: `0` exactly one section matched, or `--toc` found at least one heading. `1` a
real, non-error answer that names no section — nothing matched, or more than one did at
the tier that found anything at all. `2` bad usage. `3` the file could not be read: a bad
path, or (with `--at`) a ref that does not resolve, or a path that did not exist at it.
