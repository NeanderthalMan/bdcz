### Serve any repo's static web directory in headless Chrome, and evaluate an expression against it — `b7e-probe`

`bc-dgx7.145`: three sessions in the delmar tracker (`dv-k4n.103`, `dv-k4n.106`,
`dv-k4n.107`) each hand-built the same rig in a scratchpad to probe `reference/maps/web` —
a static server over some directory, a headless Chrome, a probe evaluating something
against the loaded page, then a cleanup — and no two were alike. `bin/b7e-eyeball` is
close but answers a different question: it serves *this repo's own* `public/` behind this
app's alias table and measures fixed CSS geometry. This serves *any* checkout's static
directory, unaliased, and hands back whatever an arbitrary expression returns. Nothing in
it is delmar-specific — the atlas is the first caller and the source of every trap below,
not the subject.

```
b7e-probe --dir <root> --serve <subdir> (--eval <js> | --script <file>)
  --hash <fragment>      repeatable — one URL state (page + #fragment) per hash
  --width <px> --height <px>    viewport (default 1440x900)
  --wait-global <name>   poll for window[name] before evaluating
  --timeout <60s|500ms>  per-state budget on the evaluate (default 60s)
  --shot <name> --out <dir>     a screenshot per state
  --baseline <git-ref>   serve that ref's committed tree instead of the worktree
  --json
```

One JSON record per `--hash` given (default one, the bare page): the expression's return
value, console errors, failed requests, a screenshot path, and which files this navigation
served out of the main checkout rather than the worktree.

**A fresh worktree of an LFS repo has its binary assets as ~130-byte pointer files, and
`git lfs pull` silently no-ops there.** The real bytes are sitting in the main checkout
that worktree was branched from, so the server answers a request for a pointer file with
the same relative path's bytes out of there instead — in memory, per request, never
written to disk. Copying LFS content over the worktree's own files was the alternative
this rules out: it leaves `git status` showing `M` on a file nobody meant to touch, and
`bin/deliver.js` then refuses the tree over a diff that is not the caller's work.
`--git-common-dir` versus `--git-dir` is how the main checkout is found — they agree
exactly when the served directory is not a linked worktree at all, in which case there is
nothing to resolve from and a genuine pointer is served as itself.

**A statically served app 404ing on its own API routes is normal, and does not fail the
run.** `consoleErrors` and `failedRequests` are always reported, on every record, but only
a thrown or timed-out evaluate marks a state `!ok` — a route the page merely polls hiding
behind a static file server is not the bug a probe run is looking for.

**`Runtime.evaluate` with `awaitPromise: true` does not resolve until the promise
settles, so an expression awaiting a `requestAnimationFrame` that never fires — the
ordinary state of a *backgrounded* headless tab — hangs the run rather than failing it.**
`Page.bringToFront` plus `Emulation.setFocusEmulationEnabled` are sent once, right after
attaching, for exactly that: without them nothing in a headless tab's rendering loop ever
ticks. `--timeout` is the backstop for whatever still hangs — every CDP round trip in a
state's run is raced against it, and the failure names the exact method it was waiting on
(`timed out waiting on Runtime.evaluate (5000ms)`) rather than reading as a stuck process.

**A page's own top-level `const`/`let` is reachable from `Runtime.evaluate`, but a CDP
reply can arrive mid-navigation, before the page has actually set it.** `--wait-global
<name>` polls `typeof window[name] !== 'undefined'` before the real evaluate runs, rather
than a fixed sleep and a guess at how long the page takes.

**A `PerformanceObserver` for long tasks reads `0` under CDP-driven input** — nothing
about a synthetic event looks like user activity to it. `window.__b7eHeartbeat.start()` /
`.stop()` is injected into every page before its own scripts run: a plain
`setInterval` heartbeat an `--eval` expression can wrap around code it wants to check for
jank, where a tick much longer than its requested interval is the long task.

**`--baseline <git-ref>`** serves `<ref>:<serveDir>/<rel>` out of git instead of the
working tree, so a before-shot costs no `git stash` — the same bargain `b7e-eyeball`'s
boolean `--baseline` makes, generalised here to any ref rather than only `HEAD`.

There is no page-alias or SPA-shell table, on purpose: this serves whatever is actually on
disk under `<root>/<serveDir>`, because delmar's atlas and every other caller of this
tool is a plain static directory, not this app's own `public/`.

`lib/probe.js` is the library — the LFS resolution, the static server, the run plan, the
verdict — and `bin/b7e-probe` is the argv parsing, the Chrome and the printing, the same
split `b7e-eyeball` draws against `lib/eyeball.js` and for the same reason: `npm test`
here deliberately does not depend on a browser, so `runProbe` takes an injected driver and
`test/b7e-probe.mjs` drives the serving, the LFS resolution (against a real `git worktree
add`, not a fake filesystem), the waiting and the verdict without launching one.

Exit codes: `0` every state clean. `1` a state's evaluate threw or timed out — the message
names the CDP method it was waiting on. `2` refused — bad usage, or no Chrome.

`@grant excluded`, on the same reading as `b7e-eyeball`: it launches a browser, binds a
port and can read arbitrary files under `--dir`, which is the shape `lib/grants.js` calls
a write, and `dispatch` — the one agent `DEFAULT_TOOL_LIST` governs — has no page of its
own to probe either way.
