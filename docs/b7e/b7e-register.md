### Apply those registrations instead of typing them — `b7e-register`

`bc-dgx7.75` is the other half of the bead above, found by the session audit the same
way. Five sessions (`bc-dgx7.57`, `bc-dgx7.58`, `bc-dgx7.59`, `bc-dgx7.60`,
`bc-dgx7.61`) each shipped a new `b7e-*` command, and all five ran `b7e-enroll <name>`
afterwards to check the registrations — after typing those registrations by hand first,
four different ways. On `package.json`'s `bin` map, each grepped two alphabetical
neighbours to find the insertion point ("Alphabetically, `b7e-def` comes right before
`b7e-deliverbase`" — `bc-dgx7.58`). On `package-lock.json`'s `packages[""].bin`,
`bc-dgx7.59` hand-edited it and was told the file was already claimed by `bc-dgx7.57` in
another worktree, while `bc-dgx7.60` and `bc-dgx7.61` ran `npm install
--package-lock-only` and diffed to confirm the one-line result — the same registry, two
incompatible methods, in the same hour.

`b7e-enroll` is the linter for exactly these checks and it is good. What did not exist
was the applier, so the registry knowledge lived twice: once in `b7e-enroll`'s checks and
once in each session's fingers, and the second copy was the one that went wrong. Both
halves now read `lib/enroll.js` — what the checks match is what the edits produce.

**Half of what this bead asked for was delivered by deleting the work, not automating
it.** It named four registries; `bc-wbrhi` landed the day after it was filed and removed
two of them. A tool now declares `@grant read`, `@grant write` or `@grant excluded` in
its own header, `lib/tooldecl.js` assembles `DEFAULT_TOOL_LIST` and the `lib/grants.js`
classification from those declarations, and `test/tooldecl.mjs` *fails* a hand-written
`b7e-*` line in `lib/grants.js` — so writing the two registries this command was
specified to write would now break the repo. That is the better fix, and it leaves this
command smaller than its bead describes.

```
b7e-register b7e-x --kind read --why "…"      register it, granted
b7e-register b7e-x --kind excluded --why "…"  register the decision not to
b7e-register b7e-x --kind read --why "…" -n   print the patch and write nothing
b7e-register b7e-x --kind read --why "…" --after b7e-w   place it below a named sibling
```

What it writes today is four files, three of `b7e-enroll`'s seven checks between them:

1. **`package.json`'s `bin` map** — the alphabetical insertion.
2. **`package-lock.json`'s `packages[""].bin`** — the same line, where `npm install
   --package-lock-only` would have put it.
3. **`bin/<name>`'s own header** — the `@grant` line, which is check 6 and the one edit
   that decides both derived registries at once, with `--why` as the sentence beside it.
4. **`lib/tooldecl.js`** — the paragraph arguing for that grant, appended where the other
   sixty-three live, with the `→ Bash(<name>:*)` line under it when the tool is granted.
   Nothing checks for that paragraph; every other tool has one, and for an excluded tool
   it is the only place the argument exists at all.

The one rule worth knowing is where a new key lands in a `bin` map: **alphabetically
within its own family**, a family being everything before the first dash. Not
alphabetically in the file, because neither file is — `package.json` lists the
`beadcause-*` worker tools in the order they were written and only the `b7e-*` block
after them is sorted, while the lock is sorted throughout. Reading the family is what
makes one rule right for both, and for a `b7e-*` name the lock line it produces is
exactly the one `npm install --package-lock-only` would have written.

It deliberately does not write `bin/<name>` itself (that is `b7e-scaffold`'s job), the
test, or its `###` section in the docs: a generated proof or explanation would be a
registration pretending to be work. So a run ends by printing what `b7e-enroll` still
says is owed, which after a successful register is exactly those two — that is the
acceptance criterion, and `test/b7eregister.mjs` runs it on a fabricated checkout.

Two things it refuses rather than decides. **`--kind` has no default**: whether
`dispatch` may run the command is a decision about a real capability — a command that
writes to the checkout, runs a suite, builds a worktree or runs whatever its caller names
is `excluded`, one that only reads is `read` — and `lib/tooldecl.js` carries sixty-three
worked precedents. This command is itself write-shaped and registered itself
`--kind excluded`. And **`--why` is required**, because it is what both halves of the
registration actually say.

Exit code: `0` when nothing is owed, `1` when something the applier cannot write still
is, `2` on a bad invocation. `@grant excluded`: it edits four tracked files in whatever
checkout it runs in.
