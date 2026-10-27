### Who holds a bead's lease, and is it still live — `b7e-held`

`bc-dgx7.198`: three sessions (`bc-x79kq.2`, `bc-x79kq.3`, `bc-rcrt`) each grepped `lib/` for
`held:` to learn what the label on their own bead meant, and one then grepped the daemon log
for the advocate's "released" line to learn whose lease it had been. `lib/lease.js` already
answered it; no command called it.

```
b7e-held -w <workspace> -b <bead>           one line per held: label, then the verdict
b7e-held -w <workspace> -b <bead> --json    the machine-readable form
```

Each `held:<stamp>:<handle>` label prints its handle, stamp, age in minutes, `live` or
`expired` against `advocates.leaseMinutes` (default 60), `yours` when the handle is this
Mac's (`me`), and `holder` for the one live claim that wins (earliest stamp). The last line
is `describeLease`'s words: `nobody holds it`, or `<handle>'s Mac claimed it 4m ago`.

A bead with no `held:` label prints `nobody holds it` and exits `0`. A Mac with no `me` set
has no handle, so nothing is ever `yours` and there is no "lost" or "won" — the same
single-person guarantee `lib/lease.js` makes. Exit codes: `0` ran, `2` bad usage, `4`
unknown workspace or bead, `1` tracker failure.

Read-only: one `bd show`. `Bash(b7e-held:*)` is on `DEFAULT_TOOL_LIST` from the tool's own
`@grant read`.
