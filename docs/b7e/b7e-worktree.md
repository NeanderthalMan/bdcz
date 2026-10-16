### One command makes a fresh worktree runnable — `b7e-worktree`

`bc-khoe.41` is the audit's own genre of finding, and the biggest roster of the lot: ten
sessions (`bc-khoe.23`, `bc-b4fs.1`, `bc-khoe.27.1`, `bc-36xx.6`, `bc-5k22`, `bc-xl7n.74`,
`bc-xl7n.79`, `bc-xl7n.71`, `bc-1kwl.22`, `bc-j52g`) each did the same three things by hand
right after `EnterWorktree` — a worktree it creates has no `node_modules` and no
`public/vendor`, and may be branched from an `origin/main` behind local `main` — in seven
different spellings. Two of them skipped `node scripts/vendor.js` and paid for it later in
the same sweep with a red `test/pagealias.mjs` they then had to explain.

```
b7e-worktree            symlink node_modules, build public/vendor, report git position
b7e-worktree --check    report only — change nothing
```

Three things, every run, idempotently. It **symlinks `node_modules`** to the main
checkout's if nothing is linked there yet — never installs one of its own (bc-mf9s: a real
copy works, costs ~160 MB, and is carried into the attic at retirement without ever being
mentioned again) — and leaves an already-real directory alone with the same advice
`scripts/vendor.js`'s own `borrowAdvice` gives rather than deleting somebody's install. It
**calls `scripts/vendor.js`**, from the worktree's own tracked copy and unmodified, to do
the equivalent borrow for the seven `public/vendor` bundles (bc-oqu7: links, never copies;
bc-slxm, bc-0i27.25: a real directory holding seven links, never one symlinked directory
itself). And it **reports `HEAD` beside local `main` and `origin/main`**, naming the case
explicitly when this worktree is behind local `main` — the one `git reset --hard main` has
to fix by hand, which this command deliberately never runs itself: rewriting a worktree's
history out from under whoever is about to start editing it is a bigger claim than "make it
runnable".

It refuses (exit `2`) outside a `.claude/worktrees/<name>` checkout — this exists to set up
a fresh worktree, never to touch the main checkout — and exits `1`, after linking and
building regardless, when the worktree turns out to be behind main.

Not on `DEFAULT_TOOL_LIST`, for the same reason as `b7e-say` and
`b7e-gate`: its whole occasion is a worktree `EnterWorktree` just made, which only a
`worker` session ever does, and `worker`'s `allowedTools` is `null` — unrestricted
already, so a grant here would widen nothing it can reach. `dispatch`, the one agent
`DEFAULT_TOOL_LIST` actually governs, has no branch of its own (`ownsRepo: false`) and
never creates a worktree to run this in.
