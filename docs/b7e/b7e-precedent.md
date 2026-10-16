### The sibling bead that already did this shape of change, and the patch it made — `b7e-precedent`

`bc-dgx7.64`. Four sessions each needed the same thing — what an earlier bead in their
own family had already committed, as a template to copy — and none of them had a way to
ask for it. `bc-khoe.30.22` ("delete `public/releases.html`") was the twenty-second
child of an epic whose fifteenth child had deleted `public/history.html` the identical
way a day earlier; it found that commit by `git log --oneline --all | grep -i
"khoe.30.14"` — the wrong sibling on the first guess — then ran `git show <sha> --stat`
and six separate `git diff <sha>^1 <sha> -- <file>` calls to mirror each touched file by
hand. `bc-dgx7.53` ("fix the remaining `--json` commands") tried `git show bc-dgx7.45
--stat` as though the bead id were a rev, got nothing, then fell back to `git log
--oneline --all --grep="dgx7.45"`.

```
b7e-precedent -w beadcause -b bc-khoe.30.22                       the printed report
b7e-precedent -w beadcause -b bc-khoe.30.22 --file public/history.js   one file's diff
b7e-precedent -w beadcause -b bc-dgx7.53 --root bc-dgx7           widen past the parent
b7e-precedent -w beadcause -b bc-khoe.30.22 --json                machine-readable
```

**Every commit in this repo is `<bead-id>: <title> (#<PR>)`** — the merge queue writes
it — so the search is exact rather than a substring grep that might match a prefix of
another id (`bc-khoe.30` is a prefix of `bc-khoe.30.15`) or a body mention that is not
the bead's own landing commit at all. `landingCommitsFor` anchors `git log --grep` on
`^<id>: `, the very start of the commit message, which is what keeps a parent id from
ever matching a child's commit with no separate word-boundary check needed.

**"Landed" means an ancestor of `main`, checked, not merely a commit that exists
somewhere.** This repo carries dozens of unmerged branches, and `--all` walks every ref
— so every anchored match is re-checked with `git merge-base --is-ancestor <sha>
<base>` (`pickBase` from `lib/notinmain.js`, the same fallback `b7e-prior` uses) before
it is reported. One trap hit building this: `--is-ancestor` prints nothing on success —
the whole answer is the exit code — so the check has to be a plain resolves/rejects
test; wrapping it the way most reads here wrap a `git` call (treating empty stdout as
falsy) reads a genuine yes as a no and reports every family as empty.

**One anchored commit can have two matches, and the merge commit wins.** A pre-merge
branch commit and the squash-merge of it both open with the same `<id>: ` and both end
up ancestors of `main` once merged — measured against this repo's own history, `git log
--all --grep='^bc-dgx7\.53: '` returns both `d9add0ef` (the branch commit, no PR number)
and `20a28644` (the merge, `(#710)`). Among the ancestors, whichever names a pull request
wins; a repo with no merge-queue convention at all falls back to the most recent.

**`--extended-regexp` is POSIX ERE, which has no `\s`.** The first version of the anchor
pattern used `^<id>:\\s`, which git silently matched nothing against — no error, no
warning, an empty result read exactly like an untouched family. A literal space fixed
it; `-P` would too, but needs libpcre-enabled git, which nothing else here requires.

A sibling's files, and a `--file` diff, are always `git diff <sha>^1 <sha>` — well-defined
for both an ordinary commit and the merge queue's own two-parent shape, and the exact
comparison `bc-khoe.30.22` ran six times by hand.

`Bash(b7e-precedent:*)` is on `DEFAULT_TOOL_LIST` and `read` in
`lib/grants.js`: every path through it is `bd show`, `bd export` and `git log`/`git
diff`/`git merge-base` reads, nothing that writes anywhere. See `bin/b7e-precedent`,
`lib/precedent.js` and `test/b7eprecedent.mjs`.
