### Which commit the running daemon was deployed from, and whether a given sha is live yet — `b7e-live`

`bc-dgx7.164`, filed by the session audit against three windows (`bc-ka5y.15.19`,
`bc-rfnr.9.10`, `bc-42ow`) that opened within minutes of each other on 2026-09-19 and each
had to decide whether a merged fix was actually running. One curled `/api/deploys`, which
wants a token, and got nothing. One grepped `lib/server.js` for a build route, found only
`/api/health`, and concluded that a running commit cannot be read. The third read the
newest deploy record, its log and `git merge-base --is-ancestor` by hand and worked out
"the 09-18 deploy, 22 behind main" — which is why the planner had opened at all. The answer
was in two files under the config directory the whole time.

```
b7e-live                                 what is running, when it restarted, how far behind main
b7e-live --sha f72378b7                  and whether that commit is in what is running
b7e-live --sha f72378b7 0fdc2485         one verdict per commit (or repeat --sha)
b7e-live --repo acme/example-service     another repo's deploy key
b7e-live --json                          the same answer as one object
```

The block it prints is the last deploy record (id, status, when), **the commit the running
daemon came from**, anything that came after that and did not reach the daemon, the last
restart, the number of commits between that commit and `origin/<base>`, whether the deploy
declares any `checks`, and a verdict per `--sha`: **`live`** (an ancestor of the deployed
commit), **`merged, not deployed`** (on `origin/<base>` and not in the deploy), **`not on
origin/<base>`** (a side branch, an unmerged pull request's head), or **`unknown`** (this
checkout has never heard of the commit — a different sentence from "not merged", and never
collapsed into it).

**"Running" is the newest deploy that reached the daemon, not something the daemon says.** No
route reports a commit; `bc-rfnr.9.13` is the bead that gives the release check one. So this
answers what the journal can: `to`, the `git rev-parse HEAD` the runner took after its
fast-forward. `ok` and `unconfirmed` count — `unconfirmed` is the ordinary ending of a
deploy that restarts the daemon, which takes its own runner with it, and the answer says the
word was never written. **`failed` does not count**, and it is the one that surprises: a
deploy that fails after the fast-forward has moved the checkout, so its `to` is the new
commit while the daemon is still on the old one. Reading `to` off a failed record would call
code live that never restarted; it is listed as `since` instead. `lost` and in-flight records
are listed the same way.

**Commits, not clocks.** `lib/release.js`'s `shippedState` decides "is this merge live" by
comparing a merge time against a deploy's start, which an out-of-order merge defeats. This
compares ancestry, which is exact, and needs the commit to be one this checkout has.

**No token, no daemon, no fetch.** It reads `<config dir>/deploys/*.json`, `restart.json`
and local `git`. `origin/<base>` is the ref as this Mac last fetched it — the answer prints
that tip — because a command that asks "is it live" must not be the thing that changes what
"behind main" means. Run `git fetch` first when the answer has to include this minute's
merges.

**The gap it cannot close, and says so.** `npm run swap` restarts the daemon and writes no
deploy record, only the restart marker. When the marker is newer than the deploy and the
checkout's `HEAD` is not the deployed commit, the answer carries a note naming both instead
of picking one.

Exit codes: `0` answered and every `--sha` asked about is live (or none was asked). `3`
answered and at least one is not — the printed block says which, so a caller sees what a `0`
never needed to show. `2` bad usage. `4` no such repo key, or none could be chosen (two
declared keys and a checkout that matches neither; pass `--repo`). `5` a `--sha` cannot be
judged at all — no deploy record names a commit, or its checkout is not on this Mac — which
is deliberately not `3`: "we cannot say" is not "no".

`bin/b7e-live` declares `@grant read`: it writes nothing and every git call is `rev-parse`,
`merge-base` or `rev-list`. See `bin/b7e-live`, `lib/live.js` and `test/b7elive.mjs`.
