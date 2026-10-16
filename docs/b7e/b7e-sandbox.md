### A disposable beadcause install and tracker — `b7e-sandbox`

`bc-zjab.6`, filed by the session audit against four sessions that each needed a `bd`
workspace that was not the live one, and each built a different half of it by hand.
`bc-zjab.1` grepped `lib/config.js` for the shape of `bdBin`/`sessionDirs`/`workspaces`,
then wrote a `config.json`, a fake `bd` script and a fixture checkout to drive
`bin/plan.js` end to end. `bc-y3qk.1` ran `bd init` into a scratch `BEADS_DIR` to learn
what `bd` 1.2.1 actually writes on `--claim`. `bc-bmry.4` had no sandbox at all for the
command it had just written, and ran it **twice against the live tracker, on its own
bead** — clearing up afterward with `bd update --notes ""`, which bd warned had replaced
existing notes. `bc-bmry.3` guessed a `defaults()` export from `lib/config.js` that does
not exist and paid a grep to learn it is module-private.

```
b7e-sandbox --workspace alpha --seed plan-fixture.yaml
  # prints the sandbox dir, then the one env prefix to paste in front of any command:
  BEADCAUSE_CONFIG_DIR=/tmp/beadcause-sandbox/default/config \
  BEADS_DIR=/tmp/beadcause-sandbox/default/workspaces/alpha/.beads

BEADCAUSE_CONFIG_DIR=… BEADS_DIR=… node bin/plan.js -w alpha -b zz-1 -f plan.yaml
  # runs to completion against the seeded tracker — nothing above ever touched
  # ~/.config/beadcause or ~/beads
```

`--bd fake` (the default) writes a small stand-in `bd` backed by one JSON file per
workspace — enough of `show`, `list --parent`, `comment`, `label add`/`remove`, `update`,
`dep add`/`relate`/`list`, `create` and `export` to run `bin/plan.js`'s whole flow, and
nothing more: an unsupported verb exits 1 rather than guessing, which is the same
tolerance `lib/bd.js` already has for `export` failing (`bd.graph`'s fallback) or `dep
list` failing (`relateMentions`'s own `.catch`). `--bd real` runs an actual `bd init
--skip-agents` workspace instead, seeded through the real binary — the mode to reach for
when a claim is about what `bd` itself does rather than about the argv beadcause sends
it, same reasoning as `test/closegatereal.mjs`.

**Everything lives under `os.tmpdir()/beadcause-sandbox/<--name>`, never under
`~/.config/beadcause` or `~/beads`.** `lib/sandbox.js` imports `CONFIG_DIR` from
`lib/config.js` for exactly one reason — to assert every path it is about to write is
*not* under it and not under `os.homedir()` — which is also why it needs a `lib/evidence.js`
exemption rather than a register entry: nothing here is a record of anything, it is a
fixture a session throws away. `test/sandbox.mjs` proves the promise from outside the
process, too: it runs the command with `HOME` pointed at an empty fixture directory and
asserts nothing at all landed there.

**A second call with the same `--name` tears the first sandbox down and rebuilds it
fresh — unless the first call passed `--keep`, which makes a later same-name call refuse
rather than delete it.** `--seed <file.yaml>` pre-populates the tracker(s): a flat
`beads:` list for the sole workspace, or `workspaces: { <name>: { beads: [...] } }` for
more than one. Each seed bead may carry a `ref:` — a name local to the seed file, never
written anywhere — so a later bead's `parent:` can name an earlier one before either has
a real id; both `--bd` modes hand back the *real* assigned ids, dotted the way every bead
in this tracker already is (`zz-1`, `zz-1.1`, …) in fake mode, and `bd`'s own scheme in
real mode.

Deliberately **not** on `DEFAULT_TOOL_LIST`: that list is the
read-mostly allowlist the one-shot `dispatch` reply agent gets (see `b7e-worktree` and
`b7e-gate` above for the same argument), and `dispatch` answers one comment and exits —
it has no more occasion to build a throwaway tracker than it does to enter a worktree.
See `bin/b7e-sandbox`, `lib/sandbox.js` and `test/sandbox.mjs`.
