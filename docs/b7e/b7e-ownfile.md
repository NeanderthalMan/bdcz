### Move a pre-split branch's text into the tool's own files — `b7e-ownfile`

`bc-dgx7.189` is the same chore found by the session audit in four revives
(`bc-dgx7.43`, `bc-7qo.24`, `bc-dgx7.85`, `bc-dgx7.44`). Since `bc-fmk4v` a `b7e-*` tool's
`###` section lives in `docs/b7e/<name>.md` and the paragraph arguing for its grant sits
above the `@grant` line in `bin/<name>`. About 22 pull requests (#14-38) were written
before that: the section is in `README.md`, `docs/advocates.md` or `docs/b7e-tools.md`
and the paragraph is at the end of `lib/tooldecl.js`. Each revive ran `git merge
origin/main`, took main's side of the shared files, and then moved the tool's own text
by hand — `sed -n 21674,21722p`, `awk`, a `sed -i '' '80,$d'` that was refused twice by
the worktree guard for the `diff --git` it contained, and a hand-rewritten anchor. Four
methods for one mechanical move.

```
b7e-ownfile b7e-x                 move it; old text from HEAD, or HEAD^1 when HEAD is a merge
b7e-ownfile b7e-x --from <ref>    take the old text from that ref
b7e-ownfile b7e-x --dry-run       print the patch, write nothing
```

Run it inside the worktree after taking main's side. It prints one line per edit:

- **The section.** The first `### … \`b7e-x\`` section found at the ref in `README.md` or
  any `docs/*.md` goes to `docs/b7e/b7e-x.md` byte-for-byte, running to the next heading
  of the same or a shallower level (headings inside code fences are not headings). Links
  are re-pointed so each still lands where it did: a bare `#anchor` is rewritten to the
  file that owns that heading now, and a relative path is re-expressed from the new
  location. An anchor that exists nowhere is reported and left as written.
- **The leftovers.** A copy of the section still in a shared document — `bc-iaju1.1`'s
  stale move into `docs/b7e-tools.md` is the usual one — is cut out, with the blank
  line that separated it.
- **The paragraph.** The `//` comment blocks `lib/tooldecl.js` carried for the tool at
  the ref and the current one does not go into the header of `bin/b7e-x` directly above
  `@grant`, re-wrapped as a docblock. The generated `→ Bash(b7e-x:*)` line under a
  granted one is dropped: the `@grant` line says that now.

It ends with the same checks `b7e-enroll` runs and exits 1 if something is still owed.
Re-running is safe — a destination that already has its section and a header that
already has the paragraph are left alone.

**What it does not do.** It does not take main's side for you (that is the merge), and it
will not guess a `@grant` kind: a tool whose header has no `@grant` line gets its section
moved and the paragraph reported as not placed. It moves one tool per call.

**Replayed on a real revive.** Run against `#24`'s head before `bc-dgx7.43` re-homed it,
it reproduced the `docs/b7e/b7e-peek.md` that session wrote by hand with no diff.

`b7e-ownfile` is deliberately `@grant excluded`: it rewrites tracked files in the checkout
it runs in, which is the argument `b7e-register` is excluded under, and dispatch never
revives an old branch. The suite is `test/ownfile.mjs`; the logic is `lib/ownfile.js`.
