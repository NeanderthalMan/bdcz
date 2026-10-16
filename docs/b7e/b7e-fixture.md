### A disposable git tree with a history and a suite, to point `--dir` at — `b7e-fixture`

`bc-dgx7.41`, filed by the session audit against five sessions (`bc-68ou.14`,
`bc-khoe.30.17`, `bc-khoe.30.18`, `bc-4r10.22`, `bc-68ou.15`) that each needed a git repo
that is not this one, to point some other `b7e-*` command's `--dir` at, and each built it
by hand a different way. `bc-68ou.14` wrote four scratchpad scripts to get one fixture,
because `b7e-counterproof` mutates the tree it is given and the fixture had to be
regenerated between every run — the one real bug that session found (no `onExit` armed
for a file restore) surfaced only after it had written a *fifth* script to drive a
signal at it. `bc-khoe.30.17` and `bc-khoe.30.18` each built theirs by hand into
`/tmp` — the second one three times over, with `node -e`, then `printf`, then a
`python3 -` heredoc — and roughly eight turns of `bc-khoe.30.17`'s went to proving a
lock worked, all of it fixture timing. `bc-4r10.22` built a fixture root plus a
hand-written fake `bd` inline in its own test file, then had to rewrite its own
teardowns because a house rule about scratch trees applied to them and nothing told it
so. `bc-68ou.15` built branches against a bare remote with a one-off `pushedBranch(...)`
helper, then spent two more turns fixing line numbers an assertion had counted
separately from the file contents it described.

```
b7e-fixture --name cp-smoke \
  --file lib/foo.js="module.exports = () => 1;" \
  --file test/foo.mjs="import assert from 'node:assert/strict'; assert.equal(1, 1);" \
  --commit "initial" \
  --file lib/foo.js="module.exports = () => 2;"
  # prints one path on stdout:
  #   /tmp/beadcause-fixture/cp-smoke/repo
  # a git repo with lib/foo.js and test/foo.mjs committed, and lib/foo.js's second
  # write left uncommitted on top — exactly bc-68ou.14's cp-smoke fixture

DIR=$(b7e-fixture --name cp-smoke ...)
b7e-counterproof --dir "$DIR" ...
```

Every tree lives under `os.tmpdir()/beadcause-fixture/<--name>` — never in this repo,
never under a real workspace. **A second call with the same `--name` tears the first
down and rebuilds it fresh** — the regeneration `bc-68ou.14` did by hand between every
run — **unless the first call passed `--keep`**, which makes a later same-name call
refuse rather than silently delete it, the same contract `b7e-sandbox` below already
has. Every commit carries this command's own identity
(`b7e-fixture <b7e-fixture@localhost>`) rather than the machine's ambient one — pinned as
both `-c user.name`/`user.email` *and* `GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME`/etc,
because the environment variables outrank `-c` and a caller (or its shell) that exports
them is exactly what "ambient" means here. The tree always gets a bare remote alongside
it too (registered as `origin`, printed as `remote` in `--json`) — ready for whatever
wants to push a branch at it, without the second hand-rolled bare repo `bc-68ou.15`
needed.

`--file <path>=<literal|@file|->` is repeatable and applied in argument order: the value
after `=` is a literal string, or `@<path>` reads the content from that file, or a bare
`-` reads it from stdin. A path under `test/` ending in `.mjs` is collected as a "suite
path" in `--json` output. `--commit "<message>"` stages everything written since the
tree was created (or since the last `--commit`) and commits it, then starts the next —
**anything written *after* the last `--commit` is left uncommitted on purpose**, which
is what makes "a commit, and an uncommitted fix on top" one call rather than a
regenerate-and-mutate script. `--json` prints `dir`, `commits` (`{ sha, message }`, in
order), `branches`, `remote` and `suites` instead of the bare path, so a later `--at
<sha>` or `--only <suite>` argument to whatever this fixture is built for can be quoted
from here rather than derived by hand the way `bc-68ou.15` derived its line numbers.

Deliberately **not** on `DEFAULT_TOOL_LIST` — same precedent as
`b7e-sandbox` just below, which needs no entry either: `dispatch`, the one agent that
list governs, answers one comment and exits, and has no more occasion to build a
throwaway git tree than it does to build a throwaway tracker. See `bin/b7e-fixture`,
`lib/fixture.js` and `test/fixture.mjs`.
