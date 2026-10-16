### A reviewer's own runnable copy of a pull request — `b7e-prtree`

`bc-dgx7.38`, filed by the session audit against three sessions that each needed to
*run* code from a pull request, not just read it, and each assembled the tree a
different way. `bc-36xx.24` built one by hand — `git archive FETCH_HEAD | tar -x` — and
it worked. `bc-zjab.12` ran the same recipe and it did not: midway through the session,
`gh pr view <n> --json headRefOid` said one sha and `git rev-parse FETCH_HEAD` said
another, because a concurrent `git fetch` from somewhere else on the Mac had overwritten
`FETCH_HEAD` between the fetch that built the tree and the archive that read it back.
`bc-36xx.9` never built a tree at all: nine separate `git show <ref>:<path>` and `git
grep <ref>` calls, hunting one file and one function at a time for what one archive
would have handed over whole.

```
b7e-prtree 622                cd "$(b7e-prtree 622)" is the whole workflow
b7e-prtree 622 --merge         GitHub's own test-merge commit, not the head
b7e-prtree --sha <sha>         an explicit sha, no `gh` call at all
b7e-prtree 622 --name mine     reuse/replace a named tree — a second call with the
                                same --name tears the first down first
b7e-prtree 622 --vendor        also runs scripts/vendor.js in the new tree
b7e-prtree 622 --json          one JSON object instead of the plain-text report
```

**The fix is not "fetch, then hurry" — it is never reading `FETCH_HEAD` at all.** Every
path through `lib/prtree.js` resolves a full 40-character sha *first*, from something
nobody else on the Mac can move (`gh pr view`'s `headRefOid` for the head, or `git
ls-remote origin refs/pull/<n>/merge` — a query, not a fetch — for GitHub's own
test-merge commit), and only fetches after: `git fetch --no-write-fetch-head origin
<sha>`, a bare, already-known sha rather than a ref name, so the fetch itself never
writes the one file that bit `bc-zjab.12`. `git archive <sha>` is then exactly as
deterministic as the sha is. Verified live against this repo's own `origin` while
building this: `refs/pull/678/merge`'s sha, genuinely absent from a fresh clone,
fetched clean with nothing on the command line but the sha itself — GitHub allows
fetching any commit it knows about this way, not only the tips of refs it advertises.

**Nothing here is ever written under the repo it reads from, `~/.config/beadcause`, or
the machine's home directory at all.** Every tree lives under
`os.tmpdir()/beadcause-prtree/<--name>`, the same `assertContained` promise
`lib/sandbox.js` makes for a throwaway `bd` tracker — checked here by `test/prtree.mjs`
running the CLI with `HOME` pointed at an empty fixture directory and asserting nothing
landed there. A second call with the same `--name` tears the first tree down and
rebuilds it fresh, unless the first call passed `--keep`, which makes a later same-name
call refuse rather than delete it — identical to `b7e-sandbox`'s own `--name` contract.

**`node_modules` is symlinked in from the reviewing checkout when it has one**, so a
suite that imports a real dependency runs without a `npm ci` inside the throwaway tree;
`--vendor` additionally runs `scripts/vendor.js` inside the new tree for browser
suites. Neither is required — a tree with neither still has everything `git archive`
put there, which is every suite that touches no dependency and no browser bundle.

Deliberately **not** on `DEFAULT_TOOL_LIST`, for the `b7e-sandbox`
argument rather than the `b7e-gate`/`b7e-blame` one: its whole job is real disk and
network activity — a `git fetch`, a `git archive`, optionally a `scripts/vendor.js` run
— even though none of it touches the tree it runs in. `dispatch`, the one agent that
list governs, answers one phone comment with one `bd comment` and has no pull request
of its own to build a runnable copy of. See `bin/b7e-prtree`, `lib/prtree.js` and
`test/prtree.mjs`.
