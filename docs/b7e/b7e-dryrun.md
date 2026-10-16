### A sweep run against the live checkout and tracker, every write recorded instead of performed — `b7e-dryrun`

`bc-dgx7.168`, filed by the session audit against four sessions (`bc-iaju1.12`, `.8`, `.4`,
`.11`) that each wrote a daemon sweep and each wanted the same proof before delivering:
*what will this do to the real tracker tonight?* None could ask, and all four wrote a
throwaway — a live `Bd` with `close` and `comment` swapped for `WOULD close …` — that no two
of them shared. The proof paid every time: `bc-iaju1.11`'s run surfaced `bc-2g8s`, the real
orphaned card the whole bead was about, and `bc-iaju1.8`'s showed a new module spawning
~1200 subprocesses ("16.2s → 0.3s, same 529 branches" is a measurement no fixture could have
produced).

```
b7e-dryrun lib/landed.js#reconcileLanded --ws beadcause
                                                       the export called once with a real Bd,
                                                       the workspace and its checkout filled
                                                       in; one WOULD line per bd write, the
                                                       return value, a tally
b7e-dryrun lib/tidy.js#sweepWorktrees --args '[{"dryRun":true}]'
                                                       no --ws: dir defaults to this checkout;
                                                       what follows the filled parameters
                                                       comes from --args, in order
b7e-dryrun lib/x.js#sweep --ws loremia --repo ~/loremia --json
                                                       the same report as one JSON object
```

**The arguments are filled by parameter name, read off the export's own source.** A
contiguous run at the front: `bd`, `ws`/`workspace`, `dir`/`repo`/`cwd`/`checkout`/`root`,
`cfg`/`config`. `reconcileLanded(bd, ws, dir, opts)` gets three, `sweepWorktrees(dir, opts)`
gets one, and the first destructured, defaulted or unrecognised parameter ends the run — the
output's header says which it filled, so a sweep whose signature does not fit says so
instead of being called wrongly. `--repo` overrides the checkout; with a `--ws` it defaults
to what the daemon would use, and a workspace shared by many repos needs `--repo`.

**Two layers, because a sweep can write through more than `bd`.**

*The tracker.* Every `bd` this repo spawns goes through `Bd.run`, so the whole guarantee is
one method overridden on an object that inherits the real `Bd` (`lib/dryrun.js#dryBd`):
a write verb is recorded and answered with an empty success, a read goes to the live
tracker. No method is named, so a `Bd` method added next month is caught with no edit here —
`test/dryrun.mjs` pins that `lib/bd.js` has exactly one spawn site, and drives every write
method through a stub binary whose log must hold no write verb afterwards. The answer is
success and not an error on purpose: a sweep stopped at its first `close` would report one
write where tonight's run makes forty. `create` answers with a synthetic `dryrun-N` id so
the comment the sweep goes on to leave on the new bead is recorded too.

*Everything else.* `git worktree remove`, `gh pr merge`, a state file under the config
directory, a POST to ntfy and a `kill` are writes through something other than `bd`, and a
wrapper that only covered `Bd` would say "0 writes" over them. They are **refused with a
thrown error** — success cannot be faked for a `git` — and printed as `REFUSED …`, and the
run ends with `INCOMPLETE: N of them … were refused, not captured — the sweep was handed an
error at each, so what it did after may differ from a real run`. That sentence is the
acceptance criterion "says so rather than pretending". The doors patched are `child_process`
(all six spawn functions, plus `promisify.custom` so a promisified `execFile` still resolves
`{stdout, stderr}`), the `fs` write functions in callback, sync and promise form, `fetch`
with a method other than `GET`/`HEAD`, and `process.kill` with any signal but `0`.

**What counts as a read is an allowlist, so the default is refusal.** `bd`'s read verbs;
`git`'s `status`, `log`, `diff`, `rev-parse`, `worktree list`, `branch --list/--merged` and
kin; `gh pr view/list/checks`, `gh api` with no method and no body field; a short list of
inspection tools (`ps`, `pgrep`, `lsof`, `ls`, `cat`, …). Anything not on it — an unknown
`git` verb, `osascript`, `node`, a shell string with a metacharacter in it — is a write,
because nothing says it is not. The price is a false refusal on a read the table lacks, and
the escape is `--allow <binary>` (repeatable), which runs that binary unguarded and says so
in the output's second line. Writes under the OS temp directory are performed, not refused: a
suite's scratch space is not the tracker.

**Installed before anything is imported, and this was learned the hard way.** The first
build imported `lib/config.js` and `lib/bd.js` ahead of the guards on the reasoning that
neither captures a spawn at load time. Something they pull in — `lib/gitref.js` — does
`promisify(execFile)` at load and kept the real one, so `reconcileLanded`'s `git fetch` and
`git merge --ff-only` **ran** while the output said everything outside `bd` was refused. The
guards now go up first, disarmed only until `loadConfig()` has made the config directory
(setup, not sweep), and `test/dryrun.mjs` checks a named ESM import of a built-in and a
promisified `execFile` made after the install.

**What it will not tell you.** A read after a write sees the world as it is now, not as the
write would have left it — a sweep that closes a bead and then lists the open ones still
sees it open, and `assertClosed` is a no-op here because its whole job is to notice the
close that did not happen. A sweep that persists state under the config directory has its
`mkdir`/`writeFile` refused; point `BEADCAUSE_CONFIG_DIR` at a copy under the temp directory
(the trick in the `dry-running-the-daemons-follow-up-against-live-state` note) to exercise
that half. Raw `http`/`net` sockets, another process's writes and anything a `worker_thread`
does are not covered, and a program that spawns `node` is refused whole rather than watched.

**Findings from the first live runs**, both read straight off the output: `sweepWorktrees`
with `{dryRun:true}` still runs `git worktree prune` before its first `dryRun` check, and
`reconcileLanded` fetches and fast-forwards the checkout as part of a "sweep" whose bead is
about closing cards.

Exit codes: `0` ran to the end, whatever it recorded; `1` the export threw (the writes it
recorded first are still printed, and only the first line of the error), or bad usage.

**Not on `DEFAULT_TOOL_LIST`**, for the `b7e-call` reason: it imports and runs whatever
export its argument names, and its guarantee is a runtime one — patched built-ins — that no
argv shape could show before the call. `bin/b7e-dryrun` declares `@grant excluded`. See
`bin/b7e-dryrun`, `lib/dryrun.js` and `test/dryrun.mjs`.
