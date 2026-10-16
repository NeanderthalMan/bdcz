### Read another workspace's tracker by name — `b7e-ws`

`bc-bmry.10`: sessions working one repo's bug that needed to read another workspace's
graph each hand-rolled `cd ~/beads/<other> && zsh -c 'bd show …'`, and each broke a
different way — the wrong directory resolves the wrong graph, and `bd` answers "not
found" rather than "wrong workspace".

```
b7e-ws -w myproject show mp-vry          what bd would have printed, from any cwd
b7e-ws -w myproject comments mp-vry
b7e-ws -w myproject list --status=open
b7e-ws -w myproject ready
b7e-ws -w myproject search "some phrase"
b7e-ws -w myproject show mp-vry --json   bd's own rows, unformatted
```

**Nothing here is a new lookup.** The workspace name → `.beads` directory mapping is
`discoverWorkspaces`/`namedWorkspaces` in `lib/workspaceroots.js`, surfaced as
`cfg.workspaces` by `lib/config.js`, and `Bd.run` (`lib/bd.js`) already spawns `bd` with
`BEADS_DIR` and `cwd` set to that directory directly. Those sessions were
hand-simulating, badly, a lookup the daemon already does for free — this is that lookup,
on the command line, with no `cd` and no nested shell, so the caller's own cwd (worktree
or otherwise) never enters into it. An unconfigured workspace name is refused with the
list of workspaces that are, so "not found" can never again mean "wrong graph."

**Only five verbs are forwarded** — `show`, `comments`, `list`, `ready`, `search` — and
anything else (`create`, `update`, `close`, `claim`, `label`, `dep`, …) is refused before
a workspace is even resolved. That is what makes this read-only *by construction*, the
same shape as `b7e-def`/`b7e-owes`/`b7e-affected`/`b7e-readme`, and what earns it a place
on `DEFAULT_TOOL_LIST` alongside them — this is a lookup, not a
second door into `bd`.
