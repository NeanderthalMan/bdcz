### Read a pull request's files at its head, without a ref a sibling session can clobber — `b7e-head`

`bc-dgx7.37`. Three sessions each read a pull request's files by hand, and two of the
three ways were silently wrong. `bc-36xx.9` ran `git fetch -q origin <branch>` and read
`FETCH_HEAD` fourteen times — the *branch*, not the pull request's head, so a resolver
pushing mid-review moves the answer under it. `bc-zjab.12` fetched the branch the same
way, then built a review sandbox from `FETCH_HEAD` with `git archive`; a concurrent
session in the same shared checkout overwrote `FETCH_HEAD` in between, and the sandbox
it reviewed — and ran a suite against — was `main`, not the pull request. It found out
by accident, from a later `gh pr view --json headRefOid` that disagreed with `git
rev-parse FETCH_HEAD`, and had to tear the sandbox down and rebuild it from the explicit
sha. `bc-36xx.22` got the tree right (`git fetch origin pull/<n>/head:pr<n>-review
--force`) but left a branch every other session in the checkout saw in `git branch` for
as long as the review ran.

```
b7e-head 617 --file lib/reviewsync.js                       that file's bytes, and nothing else on stdout
b7e-head 617 --grep "resolveThread|reviewThreads" -- lib bin  git grep over the head tree
b7e-head 617 --list                                          changed paths with +/- counts
b7e-head 617 --list --json                                   the same facts, machine-readable
b7e-head 617 --tree                                          materialise the head under os.tmpdir(), print its path
```

**Beside `b7e-prtree` and `b7e-show`, which landed first.** `b7e-prtree` builds a whole
runnable copy of a pull request on disk; `b7e-show` reads a path at a ref the checkout
already has. `b7e-head` is the step between them: one file, one grep or the changed-file
list, asked by pull-request number, with no tree extracted and no ref to have fetched
first. `--tree` overlaps `b7e-prtree` and is kept for the reviewer who started with
`--list` and wants the same pinned head on disk.

**The head is resolved from `gh pr view --json headRefOid` and never from a branch
name**, so a push mid-review cannot move the answer — `lib/pr.js`'s `headOf` is the one
call, and `files` (GitHub's own diff, already computed to render the pull request's
"Files changed" tab) rides along on it for free, which is `--list`'s whole answer with
no `git diff` and no base commit to have fetched first.

**Every other mode fetches exactly one commit, and writes no ref at all.** `git fetch
--no-write-fetch-head origin <sha>` pulls the head commit's objects into the checkout's
object store without touching `FETCH_HEAD` or any branch — the fix for both wrong
mechanisms above at once. Two of these racing on the same shared checkout, for two
different pull requests, never collide: neither writes anywhere the other could read a
stale answer from. Verified live against this repo: `git rev-parse FETCH_HEAD` and `git
branch --list` are byte-identical before and after a run.

**`--file`/`--grep`/`--tree` are `readRefFile`/`git grep`/`git archive` handed a sha
instead of a ref** — all three already took any commit-ish, because `lib/gitref.js`
wrote them for a payload ref rather than a branch, so there was nothing new to build for
the reads themselves. `--tree` is the `review-sandbox-by-git-archive` note — "`git
archive <headSha> | tar -x -C $S` then `ln -s <repo>/node_modules $S/node_modules`" —
finally a program instead of a third retyping of the same three sessions' prose: keyed
by head oid under `os.tmpdir()`, so a repeat call for a pull request nothing has moved
on reuses the directory instead of re-extracting it.

**The head oid, base oid and branch name print to stderr on every mode** — the exact
question `bc-zjab.12` got wrong — so `--file`'s stdout carries nothing but the file's
own bytes.

**Deliberately not on `DEFAULT_TOOL_LIST`, unlike `b7e-prior` just above.** It looks
read-only and every write it makes is a bead write of zero — but `--file`/`--grep`/
`--tree` each shell out to `git fetch`, which `lib/grants.js` already classifies `write`,
scope `repo`, granted to `merge-advocate` alone: "the only entry here whose effect is
entirely inside `.git`, and it is classified honestly rather than waved through." A
narrower, sha-only, no-ref-write fetch is still a fetch. Its occasion is also not
`dispatch`'s — the one agent `DEFAULT_TOOL_LIST` actually governs — but a *worker*
session's: the three sessions above were all workers reading a pull request by hand, and
`worker`'s `allowedTools` is already `null` (unrestricted), so a grant here would widen
nothing a worker cannot already reach. Whether `review-advocate` — whose own allowlist
deliberately carries no `git fetch` at all — should ever be handed this command is a
separate decision this bead does not make. See the grant argument in `bin/b7e-head`'s own header,
`lib/head.js` and `test/b7ehead.mjs`.
