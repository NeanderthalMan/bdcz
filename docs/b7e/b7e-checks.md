### A *workspace repo's* own gate scripts, all of them, with a baseline — `b7e-checks`

`b7e-gate` above runs *this* repo's own `test/*.mjs`; this runs *another* repo's gate
scripts, built for a repo whose gates are Python scripts (`bc-dgx7.57`). Sessions there
each ran the set by hand, twice per delivery, and no two the same way — a bare `for` loop
the worktree-isolation guard refuses, scratchpad shell scripts, and a
`python3 check.py . | tail -1; echo $?` that reports `tail`'s exit status, not the
check's.

```
b7e-checks -w <workspace>              every check the checkout's .beadcause/checks.json declares
b7e-checks --dir <root>                a checkout directly, no beadcause workspace needed
b7e-checks -w <workspace> --baseline <ref>   + a third column vs that ref
b7e-checks -w <workspace> --only <glob>      repeatable
b7e-checks -w <workspace> --skip <glob>      repeatable, applied after --only
b7e-checks -w <workspace> --jobs N     how many checks at once (default 4)
b7e-checks -w <workspace> --timeout <s>      per-check seconds (default 300)
b7e-checks -w <workspace> --json       one object per check, streamed
b7e-checks -w <workspace> --list       what would run, without running it
```

**The set is the checkout's own declaration, with no default.** Which scripts are a
repo's "own gate scripts" is a fact about that repo, so the repo says it, in
`.beadcause/checks.json` at the checkout root — the same convention `.beadcause/derived.json`
(`b7e-derived`) uses, and for the same reason: a gate's path and argv belong in the commit
that changes them, not in a table in beadcause. A checkout that declares nothing is refused
(exit `2`), never guessed at, and a malformed file is refused naming what is wrong with it
(bc-j2zwo.6 removed the built-in `scripts/check_*.py` convention).

```json
{
  "checks": [
    { "glob": "scripts/check_*.py", "args": ["."] },
    { "script": "scripts/status.py", "args": [".", "--json"], "name": "status (DRIFT)",
      "passWhen": { "emptyArray": "drift", "label": "DRIFT", "describe": ["gate", "id"] } }
  ]
}
```

Each entry is exactly one of `glob` (`*` within the last path segment only; every match,
sorted, named by its path) or `script` (one file, named by `name` or its path; a declared
script not on disk is a failing check, not a silent omission). Each runs as
`python3 <script> ...args` from the checkout root. A glob picks up tomorrow's new check with
no change anywhere.

**Most checks are exit-code-only; `passWhen` is for the ones that are not.** A status
report can exit 0 whatever it found — "not ready" being its normal state — so its rule is
not the exit code. `passWhen.emptyArray` names a top-level array in the script's JSON
stdout that must be empty for a pass (`label` and `describe` only shape the failure
detail, `DRIFT: <gate> <id>, …`). A non-zero exit is still a failure regardless — the
report could not be produced — and so is output that does not parse. It reads stdout
alone, never stdout and stderr interleaved, so a warning on stderr cannot break the parse.

**`-w <workspace>` resolves both the checkout and the tracker it should query.**
`resolveSessionDir` (`lib/session.js`) turns the workspace name into the repo directory,
the same resolution every session-opening path in this codebase already uses; the
workspace's own `.dir` — its `BEADS_DIR` — is passed into each check's environment, so
a check that shells out to `bd` queries that repo's own tracker rather than whatever
workspace this process happened to inherit (almost always a different one).
`--dir` skips this: a checkout named directly carries no workspace to resolve `bd`
against, so a check that shells out to `bd` is on its own.

**`--baseline <ref>` runs the same selection at a throwaway detached `git worktree`,
never the working tree**, the same `git worktree add --detach` ritual `b7e-blame`'s
`makeMainWorktree` already uses, generalised to any ref rather than pinned to
`origin/main`. Each check is matched to its baseline counterpart *by name* — a check
that did not exist at the baseline ref has nothing to be blamed on but itself — and
marked `ALREADY RED` (failed both there and here), `newly red` (passed there, or never
existed there, and fails here), or nothing at all if it currently passes — the half that
stops a session attributing an already-red selftest to its own change. The set run there
is the ref's own declaration when it has one, and this checkout's otherwise, expanded
against the ref's tree, so a ref that predates `.beadcause/checks.json` is still measured.
The exit code does not soften for a baseline match — `0` all green, `1` any
current check red, whatever a baseline column says about whose fault it is — because
"already red on main" is context for a reader, not permission to ship past it.

**One `b7e-checks`/`b7e-gate` per tree at a time.** `acquireLock` (`lib/gate.js`) is
reused as-is, keyed by the resolved root — a lock that already exists for that root
refuses rather than doubling the load, whichever of the two commands holds it.

Exit codes: `0` every check passed. `1` at least one failed. `2` refused — bad usage, no
usable `.beadcause/checks.json`, or another run already holds the lock on this root.

Not on `DEFAULT_TOOL_LIST`, for the same reason as `b7e-gate` and
`b7e-blame` just above rather than the read-only shape most of this list is: it spawns
external processes for as long as `--timeout` allows, per check, and a single staged
selftest can take over a minute — heavier than a lighter version of `Bash(npm test:*)`, not a
read anything in `lib/grants.js` already classifies as one. `dispatch`, the one agent
this list actually governs, has no more use for a battery of another repo's checks than
it does for running this one's own suite.
