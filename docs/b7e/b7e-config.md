### What this install actually resolves to — `b7e-config`

`bc-dgx7.110` is the session audit (`bc-dgx7.95`, `bc-dgx7.97`, `bc-dgx7.93`): three
sessions each needed a fact about the local beadcause install, and each hunted for it a
different way. One ran three `find`s before landing on `~/.config/beadcause/state.json`,
then three separate `python3 -c` snippets against it. One `grep`ped `lib/config.js` for
`BEADCAUSE_CONFIG_DIR`, then two more `find`s, then read the wrong field —
`workspace.dir` is the `.beads` directory, not the checkout it actually wanted, which
cost that session a filed memory note to say so. One shelled a one-off
`node -e "import('./lib/config.js')…"` for the same workspace list a third way.
`lib/config.js` already exports `CONFIG_DIR`/`CONFIG_PATH`/`STATE_PATH` and
`loadConfig()`; this is the thin shell over what was already there.

```
b7e-config                          the whole resolved install
b7e-config --ws beadcause           one workspace's row only
b7e-config -b bc-dgx7.110           what state.json's answered map records for that bead
b7e-config --ws beadcause -b bc-dgx7.110   the same, scoped to one exact key
b7e-config --json                   the machine-readable form
```

With no flags: the config dir (and whether `BEADCAUSE_CONFIG_DIR` overrode the
default — an isolated second instance reporting the wrong install's config back at you
is worse than a line nobody needed), the `bd` binary and actor, then one line per
configured workspace naming its `.beads` dir and its checkout root — never the same
string, and labelled `.beads:`/`checkout:` so the distinction that cost a session a
memory note is not something the next reader has to rediscover. The checkout root is
`lib/session.js`'s own `resolveSessionDir`, reused rather than re-derived: what this
prints is exactly what opening a session on that workspace would resolve to, refusal
included for a workspace it cannot place (a `projectRoot` mismatch, a multi-repo
workspace with no default repo).

`-b <bead>` reads `state.json`'s `answered` map — the same record `b7e-answered` reads,
keyed `workspace/id` (see `lib/answered.js`) — and prints what it says about `<bead>`.
Given `--ws`, the one exact key `<ws>/<bead>` is checked; without it, every configured
workspace's key is tried in turn and the first match wins, so `-b <bead>` alone answers
the question `bc-dgx7.95` actually asked ("does state.json know anything about this
id") without first having to know which workspace it belongs to. A bead nobody has
answered prints `no record for "<bead>"`, explicitly, naming every key it checked,
rather than printing nothing and leaving the caller to guess whether that was silence
or an answer.

Read-only: no `bd` call at all — everything here comes from `config.json`, `state.json`
and a filesystem check per workspace. `@grant read` in its own header is what puts
`Bash(b7e-config:*)` on `DEFAULT_TOOL_LIST` (`lib/tooldecl.js` derives it from there).
