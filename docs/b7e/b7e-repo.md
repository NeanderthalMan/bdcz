### What another workspace's checkout actually looks like — `b7e-repo`

`bc-dgx7.113`, the session audit's finding against three sessions that each built a
command aimed at a *different* repo in the constellation and each rediscovered that
repo's shape from scratch, by hand. `bc-dgx7.16` (`b7e-where`, targeting sorrel) ran `ls`
three directories deep to find `webapp/pages`/`webapp/static`, then compared
`git ls-files | wc -l` against a raw `find` to decide what its own file walk should
enumerate. `bc-dgx7.15` (`b7e-model`, same target, same hour, no shared context)
separately hand-found `.venv/bin/python3` by listing `.venv/bin` and read
`requirements.txt` to confirm it. `bc-dgx7.97` (`b7e-take`, targeting delmar) `ls -la`'d
`.claude/agents/` — six files, the wrong roster — before finding `ai-context/agents/` —
nineteen, the right one — by grepping for a role name it already knew and narrowing with
`xargs dirname | sort -u`. This is the command that would have answered all three in one
call.

```
b7e-repo -w sorrel                names ~/projects/sorrel, grouped and profiled
b7e-repo -w sorrel --json         the same, as one JSON object
b7e-repo --dir <root>             a tree given by path, for a repo with no workspace
b7e-repo -w sorrel --run          only the "how do I execute against it" half
```

**Nothing here is a new grouping.** The source/docs/tests/served-markup split is
`lib/where.js`'s own `classifySurface` and `listFiles`, imported rather than
reimplemented — the same `git ls-files -z --cached --others --exclude-standard` walk that
already honours whatever `.gitignore` a target repo carries, with no exclusion list of
this repo's own to keep in sync. What this command adds is grouping *every* file rather
than only ones matching a search term, plus, per surface, the directories that actually
hold them — each file is credited to its first two path segments, so nineteen
`ai-context/agents/<role>/` leaves roll up into one `ai-context/agents` entry instead of
each individually ranking too low to appear, which is exactly the roster `bc-dgx7.97`
found only by grepping for a name it already knew.

**The workspace → checkout resolution is `resolveSessionDir`, not a second hand-rolled
path match.** A workspace's `cfg.workspaces[i].dir` is the `.beads` *tracker* directory,
never the git checkout, and `path.dirname(ws.dir)` only happens to be the checkout in the
common one-repo-per-workspace case — a workspace configured with `sessionDirs` or
`projectRoot` can answer differently. `resolveSessionDir` (`lib/session.js`) already
carries that logic, tested, at some two dozen other call sites; this is the next one
rather than a new guess. A workspace name this install cannot map to any checkout throws
from there with a sentence naming the workspace, and an unconfigured name entirely is
refused here with both the workspaces that are configured and the roots that were
searched for one — "no checkout on this Mac" can never again print an empty tree instead
of a refusal.

**The interpreter fact prefers `python3` over `python`, deliberately not
`lib/pygate.js`'s `findInterpreter`.** That function's own test pins, by name, "root's
own `.venv/bin/python` wins outright" — the right preference for its one caller
(`b7e-gate` only needs *an* interpreter to spawn), but not for a tool whose whole job is
reporting the fact precisely. `python3` is checked first here instead, in a function of
its own rather than a flag threaded onto a merged one.

**`--dir` is the escape hatch its sibling commands already carry** — `b7e-where`,
`b7e-ws`, `b7e-derived`, `b7e-section` — for a target with no beadcause workspace at all,
and for testing: this is how `test/b7erepo.mjs` drives it, against a disposable fixture
tree rather than a real checkout on the machine running the suite. **`--run`** prints only
the runnable facts (right now: the interpreter, if any), skipping the tree walk entirely,
for a caller that already knows the shape and only needs to know what to spawn.

`lib/repolayout.js` is the grouping, the top-directory ranking and the interpreter check,
pure; `bin/b7e-repo` is the argv, the workspace resolution and the printing around it.

**On `DEFAULT_TOOL_LIST`: yes.** `@grant read` — like `b7e-where`, `b7e-ws` and
`b7e-derived`'s plain-listing mode, this only ever reads a tree and a tracker; nothing it
does can write to either.
