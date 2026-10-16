### Which ref a workspace actually delivers into, before anyone reads a file — `b7e-deliverbase`

`bc-dgx7.58`, built for a workspace that does not deliver into `main`: sessions there
each worked out by hand, a different way every time, that the checkout's own branch is
not the ref beadcause delivers that workspace's work into. `b7e-base` just above answers
"is my branch current with main"; this answers the question that has to be settled
*first* — which ref "current" even means for this workspace.

```
b7e-deliverbase -w myproject                            the base, and how the checkout compares
b7e-deliverbase -w myproject --show scripts/check_a.py  cat a file as it exists at the base
b7e-deliverbase -w myproject --json                     one object on stdout, for a caller
```

**The base is resolved exactly the way a real delivery would resolve it** — `baseFor` in
`lib/prbase.js`, the same call `bin/deliver.js` makes before ever opening a pull request
— rather than a second opinion that could drift from what a delivery actually does. For
a single-repo workspace that is `pr.basePerWorkspace` (falling back to the install-wide
`pr.base`, then the literal `main`); for a multi-repo workspace it is the repo's own
default branch on GitHub, the same question a real delivery asks.

**The checkout is `resolveSessionDir`, never `ws.dir`.** `ws.dir` is the *tracker's*
directory — `~/beads/<name>/.beads` on a personal install — and matching it against a
git checkout path only coincidentally works; `resolveSessionDir` (`lib/session.js`) is
the call ~25 other places already make for "which directory is this workspace's
checkout," multi-repo case included. An earlier b7e-* command hand-rolled the `ws.dir`
match instead and got away with it only because nothing there routed a `git`/`gh` call
through the result — this one does, so it does not repeat that shortcut.

Reports one block: the base ref and its sha; the checkout's current branch and whether
it is an **ancestor** of the base (behind, or the mirror case — ahead, with the base an
ancestor of it), **equal** to it, or **diverged**, with real ahead/behind counts either
way; and — the part none of those sessions computed by hand — every top-level
path the base's tree carries that the checkout's tree does not have *at all* (a partial
overlap, some files under a shared directory name and not others, is not "absent here"
and would be noise). `--show <path>` cats a file as it exists at the base, which
succeeds exactly where a plain `Read` of the same path in the checkout fails, because
the checkout never had it.

**Refuses with exit `2` rather than guessing** in every case where the answer would
otherwise be a shrug: an unknown `-w`, `pr.enabled: false` (nothing is delivered
anywhere for this install, so there is no base to report), or a configured base that
names no `origin/<base>` and no local `<base>` at all in the checkout.

Built on the same `lib/gitref.js` primitives `b7e-base` is — `fetch`, `rev-parse`,
`rev-list`, plus `ls-tree` and `show` for the tree comparison and `--show` — so it is
read-only in the same construction sense: nothing here writes a ref, a commit or a
working-tree file, which is what put `Bash(b7e-deliverbase:*)` on `DEFAULT_TOOL_LIST` in
`lib/toolbelt.js` and `read` in `lib/grants.js` beside `b7e-base`.
