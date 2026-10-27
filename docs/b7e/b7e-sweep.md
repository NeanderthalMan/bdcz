### What a new advocate sweep still owes, before the gate is worth starting — `b7e-sweep`

`bc-dgx7.167`, filed by the session audit against four sessions that each added a sweep to
`lib/advocate.js`'s tick — `bc-dhayi` (`lib/stalled.js`), `bc-iaju1.12` (`lib/orphanwork.js`),
`bc-iaju1.8` (`lib/branchprune.js`) and `bc-iaju1.4` (`lib/lapse.js`). Each worked out the
registration list from scratch, by asking memory one note at a time and grepping a sibling
sweep's key names, and each got a different subset: `bc-dhayi` never touched
`test/wsshape.mjs`, and `bc-iaju1.4` paid for the gap twice — `test/configtable.mjs` caught five
missing rows after the code was written, and then, after roughly ninety minutes waiting for a
gate slot, the full run came back 560/561 on `test/wsshape.mjs`, which refuses a callee that
is in neither `WANT_OBJECT` nor `WANT_NAME`. One line, one wasted gate.
[`b7e-owes`](b7e-owes.md#what-a-new-route-page-module-or-config-key-still-owes--b7e-owes)
checks four registries and none of these, and each of them goes red only in a full gate, or
does not go red at all.

```
b7e-sweep                                every function tick() reaches that is missing anything
b7e-sweep sweepLapsed                    just that one — by its own name, or the name a function calls it by
b7e-sweep lapse --module lib/lapse.js    the module too: what it exports, and whether the advocate imports and calls it
b7e-sweep --all                          also print what is deliberate rather than owed
b7e-sweep --json                         the same answer as one object
b7e-sweep --dir <checkout>               another tree (default: the git root of the directory you are in)
```

It prints one line per unpaid registration — the file, the line to add it beside, what is
missing, and the suite that goes red without it:

```
test/wsshape.mjs:193  sweepLapsed is in neither WANT_OBJECT nor WANT_NAME — add it beside 'sweepWholeEpics' … (called at lib/advocate.js:7537 in lapseBacklog)  [red: test/wsshape.mjs]
lib/advocate.js:1365  persist() drops lastLapseAt — record() restores it … so the interval clock resets on every restart  [silent: no suite fails]
docs/config.md:158  no row names `advocates.lapseSweepMinutes` — read at lib/advocate.js:…  [red: test/configtable.mjs, when the key has a default]
```

**Three reads, each of them the same reading the suite or the daemon makes, done on the text.**

- **The workspace shape.** Every `a.workspace` in the advocate has to sit in an argument list
  of a callee named in `WANT_OBJECT`, and no callee in `WANT_NAME` may be handed one — the
  scan `test/wsshape.mjs` makes, reporting *the callee that is missing from the lists* rather
  than the position of the argument that exposed it, because the fix is one string and the
  string is the callee. It reads the lists out of `test/wsshape.mjs` itself, so it cannot
  drift from them. `bd.<method>(a.name …)` and `a.workspace` inside a template literal are the
  same file's other two checks and are reported the same way. Replayed on `bc-iaju1.4`'s tree
  at `9708131bf` it finds exactly the `sweepLapsed` line the 561-suite gate did.
- **The interval clocks.** A sweep keeps `a.lastXAt`; `record()` restores it from
  `advocates.json` and `persist()` writes it, by hand, on both sides. Half of that pair is the
  failure and it is silent: **restored and never written** is a clock that reads null after
  every restart — several times a day here, because the daemon is restarted by its own
  merges — and **written and never restored** is the same loss from the other side. A clock
  with **no line in `record()` at all** is a decision nobody made. Deleting `lastTidyAt` from
  `persist()` on main is reported at `lib/advocate.js` with the sentence about the restart, and
  is marked `[silent]`, because nothing in the gate would ever have said so.
- **The settings the sweep reads.** Every `o.<key>` a function reads needs a row in the
  specification naming `advocates.<key>`. `test/configtable.mjs` goes red for a key that has a
  default; a key read with none (`o.flagX === false`) is a knob nothing documents and no suite
  notices. A row that lists several keys in one cell documents all of them.

**What is deliberately *not* owed, and why it is shown only with `--all`.** A clock that
`record()` starts at `null` and `persist()` leaves out is not debt: `record()` says why in a
sentence each time ("a daemon that has just come up is exactly when a merge it never saw is
most likely to be sitting there") and seven shipped sweeps do it. Reporting them would put
seven findings on a tree that owes nothing, and the command's whole value is that a clean
answer means clean. They are the `notes`.

**What it does not check.** That a sweep's result field (`a.inMain`, `a.farBlocked`) has a
line in `record()` and in `snapshot()`: on main `farBlocked` has no initialiser and
`notInMain` no snapshot line, both shipped, and whether that is a defect is a decision the
command has no business making. It does not run a suite, and it does not check the two
registries `b7e-owes` already covers — run both. It reads `lib/advocate.js`, so a sweep that
lives entirely in a module is judged at the call site in the advocate, which is why
`--module` also asks whether the advocate imports the module and calls what it exports.

**It reads the checkout it is run in.** The copy of a `b7e-*` command that executes is always
the main checkout's, so a root taken from the script's own path would judge main's
`lib/advocate.js` from every worktree; `--dir` overrides the git root of the current
directory.

Exit codes: `0` nothing owed, `1` something is, `2` bad usage, `4` a file it reads is missing
or the named sweep matches nothing in the advocate — never "nothing owed" for a name it did
not find.

`bin/b7e-sweep` declares `@grant read`: it reads three kinds of file and writes nothing. See
`bin/b7e-sweep`, `lib/sweepowes.js` and `test/b7esweep.mjs`.
