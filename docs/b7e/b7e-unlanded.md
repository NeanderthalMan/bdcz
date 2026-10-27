### Where does this exist, if it is not on `main` yet — `b7e-unlanded`

`bc-68ou.15`. Four sessions each needed to read a symbol, a file or a hunk out of a
branch or pull request nobody had merged, and each built the read by hand.
`bc-khoe.30.14` needed `public/releases.js`, which does not exist on `main` — `ls
public/releases*` said "no matches found" — so it set `B=origin/worktree-releases-view-
khoe7` and ran six-plus `git show` calls, one of them `git show "${B}:test/panes.mjs"`,
which failed with `fatal: ambiguous argument 'worktree-releases-view-khoe7est/panes.mjs'`
— the shell glued the variable and the path together with the colon lost between them,
and the read had to be redone. `bc-khoe.4` needed `viewHop`, which lived only on PR #520:
`grep -n "viewHop" lib/*.js public/*.js test/*.mjs` found nothing, then `git grep -n
"viewHop" origin/main` (still nothing, same reason), then `gh pr diff 520 --name-only`,
then a full `gh pr diff 520` piped through `grep`, then `sed -n '700,760p'` to read the
function out of a diff by line offset. `bc-fh0sz` had to decide whether `lib/shutdown.js`
still existed anywhere; PR #488 had squashed it into a single file, so `git log
--diff-filter=A`, `git diff --name-only`, `gh pr view` and `gh api .../files` were all
needed before "gone" was safe to write down.

```
b7e-unlanded viewHop                          every place the symbol exists
b7e-unlanded viewHop lib/pagealias.js         scoped to one path
b7e-unlanded public/releases.js               the whole file, wherever it is
b7e-unlanded public/releases.js --diff        that place's change vs. main instead
b7e-unlanded lib/server.js --branch <ref>     pin the place — skip the search
b7e-unlanded lib/server.js --pr 520           pin it by PR number instead
```

**This is not `b7e-prior` or `b7e-siblings`.** Neither of those hands back text — they
say *whether* work exists (a branch, a commit, a pull request) and leave reading it to
the caller. Every session this bead is named for already knew which branch or pull
request mattered; this is what they needed once they got there. One block per place
found: `main`, or a branch with its pull request number, state, merge state and tip
commit, followed by the matching lines (a symbol) or the whole file (a path). A query
found nowhere at all — `bc-fh0sz`'s `lib/shutdown.js` shape — prints `nowhere`, in so
many words, never an empty diff a caller could mistake for "found, but no differences".

**`main` short-circuits the search, and this is load-bearing rather than an
optimisation.** The question this bead names is "if it is not on `main` yet" — once a
symbol or a path *is* on `main`, that is where it exists, and this repo carries around
350 `worktree-*` branches; once something has landed, every branch cut afterwards
inherits it in its tree too. An unconditional sweep turns "found on main" into a report
naming three hundred branches that changed nothing about it, each paying for its own `gh
pr list` — an early cut of this took over two minutes on `viewHop`, already landed by the
time it was tested, for exactly that reason. So a hit on `main` returns immediately;
`--all` overrides it for the caller who genuinely wants to know whether some branch also
carries an *unlanded* change on top of what already merged.

**`ref:path` is never built by string interpolation into a shell**, which is the fix the
acceptance criteria ask for by name. The `${B}:test/panes.mjs` bug above was a *shell*
gluing a variable and a literal colon together wrong; nothing here runs through a shell
at all. `git()` (`lib/gitref.js`) calls `execFile` with an argv array, and the one place a
colon is needed (`git cat-file -p <ref>:<path>`) is built with a plain JS template string
and handed to `execFile` as a single array element — there is no shell in between to glue
it wrong a second time.

`Bash(b7e-unlanded:*)` is on `DEFAULT_TOOL_LIST` and `read` in `lib/grants.js`, both
from the `@grant read` line in its own header: every path through it is `git`/`gh` reads
(`git grep`, `git cat-file`, `git diff`, `gh pr list`/`gh pr view`), nothing that ever
touches a working tree or a branch of its own. See `bin/b7e-unlanded`, `lib/unlanded.js`
and `test/b7eunlanded.mjs`.
