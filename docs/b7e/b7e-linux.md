### Does it pass on Linux — a verdict per suite, in one call — `b7e-linux`

`bc-dgx7.203`. Four sessions (`bc-obucr.7`, `.11`, `.12`, `.13`) each needed to know whether
a suite passes on Linux, and each built the answer differently. `bc-obucr.7` hand-built a
`node:22-bookworm` container with apt `tmux zsh expect lsof`, a `chmod 1777 /tmp`, an rsync
that excluded `node_modules` and `.git`, and `su node` — six scratchpad scripts and about
thirty `docker exec` calls, ANSI stripped with `sed` each time, and the worktree guard
refused its first `docker run` ("a value computed at runtime"). `bc-obucr.11` wrote a second
inline recipe, was refused for complexity, and hit exit 125 with the daemon down; it fell
back to `gh workflow run test.yml` and delivered "Linux half unverified". `bc-obucr.12`
dispatched the same workflow and tried `timeout 540 gh run watch` three times, always
`in_progress`. `bc-obucr.13` read `gh run view --json jobs` three times to find that the
hosted job was "refused by billing, 0 steps". Only the one that built its own harness ever
saw a Linux result — and dispatching `test.yml` also starts the full macOS roster on the
studio Mac, because `workflow_dispatch` is a whole-roster event.

```
b7e-linux test/install.mjs test/handoffdoor.mjs     one line per suite: pass / fail / skipped
b7e-linux --all                                     every test/*.mjs except test/browse.mjs
b7e-linux --dir <checkout> ...                      a checkout other than the cwd
b7e-linux --keep ...                                leave the container up; its name is printed
b7e-linux --image node:22-bookworm ...              override the image
b7e-linux --tail 40 --timeout 600 ...               failure tail lines, seconds allowed per suite
```

**What it does.** Starts one container (`node:22-bookworm`), installs the packages the
suites shell out to — `tmux zsh expect lsof jq`, the same set the `test-linux` job installs,
plus `git curl ca-certificates` — makes `/tmp` sticky-writable, copies the checkout in
without `node_modules`, `.git` or `.claude` (the checkout itself is mounted read-only, so
nothing a suite does can touch the worktree), snapshots it as a one-commit git repo for the
suites that read history, runs `npm ci`, then runs each suite as the non-root user `node`.
The last line names the image, the jq version and the package set, because bookworm ships
jq 1.6 where `ubuntu-latest` ships 1.7 and a verdict that differs only there should be
explainable from its own output.

**Verdicts.** `pass`, `fail`, or `skipped` — the last only when the suite exits 0, ran no
checks, and printed `skipped: <why>`; the reason is shown as the suite wrote it. A suite
with checks *and* a skip is a `pass` that says what it skipped. A failing suite gets the
tail of its output with ANSI stripped (`--tail`, default 40), and a suite that outruns
`--timeout` is a failure named as a timeout.

**Exit codes.** `0` green (skips are green), `1` at least one red, `2` refused, `64` bad
usage. Refused means there is no Docker runtime or its daemon is down, said in those words
— and then, because a session that cannot run Linux here still wants to know what Linux
said elsewhere, the latest hosted `test-linux` state from `gh`, including the case that
cost `bc-obucr.13` three calls: a job that finished with zero steps, printed as
`refused, 0 steps`. It reads state; it never dispatches a run.

`bin/b7e-linux` declares `@grant excluded`: it starts a container and runs arbitrary suite
code, which is not a read. `lib/linux.js` holds the recipe and the verdict reader with
`docker` and `gh` injected, so `test/b7elinux.mjs` proves the argument handling, the
verdicts, the exit codes and the hosted fallback without a daemon. `B7E_LINUX_DOCKER` names
a different docker binary (the test's fake uses it).
