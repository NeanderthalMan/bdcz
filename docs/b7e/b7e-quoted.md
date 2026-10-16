### Every file, sha, branch and count a bead quotes, against the tree it names — `b7e-quoted`

`bc-dgx7.74`: five sessions each found, by hand, that their own bead's literal examples
had gone stale between the session that wrote them and the one asked to act on them — a
quoted file renamed while resolving the very finding that produced the quote, counts
measured at a ref that had since moved, a checkout said to be on a branch it was not on,
"12 checks" where discovery found 19, and a commit blamed for a failure it never touched
(`bc-khoe.67`, twenty minutes in the wrong module).

```
b7e-quoted bc-dgx7.60                    this bead, against its own workspace's checkout
b7e-quoted bc-dgx7.60 -w otherrepo       …against another workspace's checkout instead
b7e-quoted bc-khoe.67 --ref origin/main  …at a named ref rather than the delivery base
b7e-quoted bc-dgx7.58 --json             one JSON object per row
b7e-quoted bc-dgx7.57 --strict           exit 1 if anything it quotes has rotted
```

**The direction is the whole point.** `b7e-cites` goes tree → beads: every bead id this
repo's own source quotes, joined to what the tracker now says about it. Nothing went
bead → tree, and that is the direction all five of those sessions had to walk on foot.

**Two workspaces, and they are usually the same one.** The bead is read from whichever
tracker holds it — `-w` names the *checkout* its quotes are checked against. They differ
exactly when a bead in one tracker is about another repo, which is the `bc-dgx7.60` case:
a `bc-` bead whose four claims are all about files in a different checkout. The tracker is asked in
order (the `-w` workspace, then this checkout's own, then the rest, first hit wins), so
the ordinary case is one `bd` spawn and the cross-repo case is two.

**Three of the four kinds are checked; counts are surfaced and said to be unchecked.**
Paths, commit shas and branch names are all answerable by git against a named ref. A
count is not: matching `243/50` to the census that produced it needs the pattern, the
pathspec and the ref that were in the measuring session's head, and none of that survives
into the prose. So a count is printed with its sentence, marked `unchecked`, and — where
the sentence names exactly one literal that is not itself a command line — with the
`b7e-count` call that would settle it. A row saying "I could not check this, here is how
you would" is worth having; a row that guessed would be worse than nothing, because the
whole failure this exists for is a plausible figure nobody re-measured.

**A rename git will not call a rename is still reported as one, with its score.**
`bc-dgx7.74`'s own acceptance criteria require the `bc-dgx7.60` path to come back
*renamed*; at git's default 50% similarity it does not, because the commit that moved it
rewrote most of the file, and `--name-status` reports a plain `A` and a plain `D`. A second, permissive pass over that one commit finds `R032`, and the
row says `32% similar, below git's default rename threshold` next to it, so the
difference between "git is certain" and "git thinks so" stays visible. Renames chain, up
to five hops, which is what survives a file renamed twice.

**Finding *where* a path went is not `git log --follow`.** That walks backwards from a
name that still exists; what is needed here is forwards from one that does not. The
newest commit in the ref's history that touched the path is the commit that removed it,
and that commit's own rename-detected `--name-status` says whether it was a delete or a
rename and to what. A name with no history at that ref at all is reported as `absent`
rather than `deleted`, because those are different findings — the first is usually a bead
quoting a path that belongs to another repo.

**A commit row answers the `bc-khoe.67` question, not the cheap half of it.** "Does this
sha exist" is easy and was never the problem: `e60d0b87` exists and the twenty minutes
went on it anyway. So every commit is intersected with the paths the bead itself names,
against where those paths *are* rather than the name the bead used, and a commit that
touches none of them says so in as many words. (`e60d0b87` in fact touches three of
`bc-khoe.67`'s — that bead's real finding was narrower, about assertion strings inside
`scripts/space-check.mjs`, which is a claim about file contents no path intersection can
make. The command reports what the tree says.)

**Extraction refuses rather than guesses, and only in one direction.** A missed artifact
costs a session the hand-check it was already doing; a *wrong* artifact costs it trust in
every other row. So: a slashed token that resolves in the tree is a path and one that
resolves as a ref is a branch, asked of git rather than inferred; a hex run that does not
resolve is reported only if it contains a digit, because seven letters drawn from `a-f`
is a rare but real English word; `ahead/behind` and `read/write` are dropped entirely;
and `~/…`, `https://…`, `refs/…`, `scripts/check_*.py`-style globs and the `.bin`/`.mjs` fragments
left behind by `packages[""].bin` and `test/<name>.mjs` are none of the four kinds.

Exit code `0` whether or not anything has rotted — an answer is not a failure — `1` under
`--strict` when something has, and `2` for a refusal (bad usage, an unknown workspace, a
ref that does not resolve, a bead no configured tracker has). Read-only in the same
construction sense as `b7e-count` and `b7e-cites` above: the subprocesses it spawns are
`git` reads at a fixed ref and one `bd show`. See `bin/b7e-quoted`, `lib/quoted.js` and
`test/quoted.mjs`.
