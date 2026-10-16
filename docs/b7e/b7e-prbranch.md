### Which copy of this pull request's branch is newest — `b7e-prbranch`

`bc-dgx7.188`. Five sessions on 2026-10-04 (`bc-4r10.19`, `bc-khoe.47`, `bc-4r10.21`,
`bc-ka5y.22`, `bc-uxrix`) each revived an existing pull request, and each had to work out
where the newest copy of its branch was before merging `origin/main` into it — each a
different way, and two got it wrong first. `bc-4r10.19` merged main into a worktree that was
251 commits behind `origin/<branch>`, hit a conflict, and only then ran `rev-list`
(`git merge --abort`, `--ff-only`, merge again). `bc-khoe.47` resolved a README conflict and
ran the gate before `deliver.js` failed at the push: the pushed branch held a re-home commit
its tree never had. The opposite trap is in the August debriefs: crashed resolvers left 87 and
300 commits of merges on disk that were never pushed, so GitHub's `CONFLICTING` described a
conflict already solved locally.

```
b7e-prbranch -w beadcause 38              a pull request number
b7e-prbranch -w beadcause -b bc-khoe.47   or a bead, resolved to its pull request
b7e-prbranch -w beadcause 38 --json       the same facts, machine-readable
b7e-prbranch -w beadcause 38 --no-fetch   offline; origin may be stale
```

**One line per copy of the branch**: what GitHub says the PR head is, `origin/<branch>` after
a fetch, the local branch if no worktree holds it, and every worktree with it checked out.
Each shows its sha, how far behind the newest it is, dirty or clean, whether `MERGE_HEAD` is
present, and its lock — pid live or dead, by `lib/salvage.js`'s `lockPidOf` and the rule
`~/.claude/hooks/worktree-guard.sh` uses. A bead id resolves to its pull request as
`b7e-prior` does: the most recent open one, else the most recent of any state.

**The newest copy is the one that contains all the others**, by `merge-base --is-ancestor`.
If none does, the branch has **diverged**: the command says so, suggests nothing, and exits
`1` — picking either side throws the other's commits away, which is exactly what the two
revives that went wrong did. A PR head GitHub moved after the fetch may not be in this
repo's objects; it is shown as absent rather than guessed at.

**Then a dry-run merge of `origin/main` into the newest copy**, through `git merge-tree
--write-tree --name-only` — the real merge machinery with no worktree and no index — so the
conflicting files are the files a real merge would conflict on, listed before anybody
commits to resolving them. It writes nothing but objects.

**The commands that follow are printed, never run, and always `git -C <absolute path>`**
(`merge --ff-only` for each clean worktree that is behind, `push origin HEAD:<branch>` when
the newest copy is unpushed, then `merge origin/main`), because the worktree guard refuses a
bare `reset`, `merge` or `push` whose cwd could be the wrong checkout. A worktree that is
mid-merge or dirty is left alone with a comment saying why. The one write the command makes
is `git fetch` into `refs/remotes/`.

Exit `0` one copy is newest; `1` diverged; `2` bad usage; `4` the workspace, bead or pull
request is not there. `lib/prbranch.js`; `test/b7eprbranch.mjs` replays the four cases from
the bead — behind, ahead with unpushed work and a dead-pid lock, clean, diverged — against a
real repo with a real bare origin.
