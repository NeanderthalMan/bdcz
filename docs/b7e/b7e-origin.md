### `git fetch`/`push`/`ls-remote` against `origin`, as the account that can actually reach it — `b7e-origin`

`bc-dgx7.160` names six sessions (`bc-arj0.25`, `bc-dgx7.131`, `bc-dgx7.134`,
`bc-nc6o.12`, `bc-xlz32.11`, `bc-xlz32.12`) that each hit the same wall by hand: the
Mac's *active* `gh` account is not always the one that can see this checkout's `origin`,
and a plain `git fetch`/`git push` authenticates as whichever account `gh`'s own
credential helper calls active, not as whatever `lib/pr.js` would have resolved for its
own calls against the same repo. Five different workarounds and one misdiagnosis came
out of that gap — a hand-built Basic auth header, an inline `credential.helper`
override, a token written to `/tmp` and read back, `GH_TOKEN=$(gh auth token --user
X)` typed before the real command, and a session that gave up and read stale refs
instead — and `bc-arj0.25` concluded `origin` itself was broken and filed a dependency
over what was actually a missing `GH_TOKEN`.

```
b7e-origin fetch origin main                              plain git fetch, correctly authenticated
b7e-origin push --set-upstream origin my-branch:my-branch  plain git push, same account
b7e-origin ls-remote origin refs/heads/main                plain git ls-remote, same account
b7e-origin fetch origin main --dir /path/to/other/checkout  another checkout, not cwd
b7e-origin --which                                          which account would be used, and stop
```

**It is the missing half of a resolution `lib/pr.js` already had.** `resolve()` there
already picks the write-capable account for a checkout's own `gh` calls — write-capable
first, any account that can merely see the repo as the fallback — and caches it per
directory. This exports that same answer two ways: `originAccount(dir)` for a caller
that wants to know *who*, and `gitEnvIn(dir)` for a caller that wants the environment
`git` itself should run under (`GH_TOKEN` set to that account's token, or `undefined` for
the ordinary single-login Mac where the ambient account already is the right one).
`bin/b7e-origin` is the command line onto both; `bin/deliver.js`'s own `fetch` and `push`
call `gitEnvIn` directly, so a delivery needs no workaround typed by hand either — only
those two call sites, never the purely local `rev-parse`/`status`/`diff`/`rev-list` calls
around them, which have no remote to misauthenticate against in the first place.

**Everything else about the git command is passed through untouched.** `fetch`, `push`
and `ls-remote` are the only three subcommands this will run — anything else is refused
before any account is even resolved — and every argument after the subcommand is handed
to `git` exactly as typed, so a flag `git fetch`/`git push`/`git ls-remote` accepts works
here unchanged. `--dir` names a checkout other than the current directory and is the one
flag this strips before the rest reaches `git`.

**No account able to see the repo is a sentence, not a stack trace.** When every account
`gh auth status` lists — the ambient one and every other login — comes up empty against
`origin`, this says so in one line naming every account it tried, rather than letting
`git`/`gh` surface a bare "Repository not found" that reads as the repo being gone
instead of nobody here being able to see it. `--which` answers the same question without
running anything, for a session that wants to check before it tries.

Excluded from `DEFAULT_TOOL_LIST` — `git push` is already the widest single grant in
`lib/grants.js`'s roster, held by the merge queue alone, and `dispatch`, the one agent
that list governs, has no branch of its own to push. The worker sessions this actually
serves already carry the unrestricted CLI default and need no grant to reach it — the
same reasoning `b7e-write` and `b7e-recard` are withheld under.

Exit codes: whatever `git` itself exits with, once an account has been resolved. `2` bad
usage — no subcommand, an unrecognised one, or `--help`. `3` no logged-in account can see
`origin` at all.
