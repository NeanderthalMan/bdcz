### Say which headless Chromes this repo's checks left behind — `b7e-chrome`

The daemon's own sweep above runs on an hourly clock, which is exactly wrong for the
moment a session actually wants an answer: right after a browser check was killed, or
interrupted, or just finished looking slower than it should have. Before this, that
moment was a hand audit, and three sessions each ran one, three different ways (bc-ka5y.15.13)
— and none of them could actually answer "is this Chrome mine?" `pgrep -fl headless`
matched the calling agent's own `claude` process as readily as a Chrome; a pid read a
beat too late was one that had already exited; and a pattern narrowed to `Google
Chrome.*--headless` still could not tell a stray this repo made from a check another
session had legitimately running. `b7e-chrome` is `lib/strays.js`'s own three guards —
the profile, not the process name; the age floor; never a directory a live Chrome is on
— as one command, so nobody derives them by hand again:

    b7e-chrome                             list every one, at any age
    b7e-chrome --reap                      end the ones at least an hour old
    b7e-chrome --reap --older-than <mins>  end everything at least that old instead

Listing takes no age filter at all — the report itself is most of the value, and a check
that died thirty seconds ago is exactly as interesting as one still running from
yesterday. Each line names the pid, its age, the `beadcause-*` directory it belongs to,
and whether that profile is still on disk. That third column is two names when a profile
is nested, `run/profile`, because `scripts/checks.mjs` gives every check of one run a
`TMPDIR` inside a single `beadcause-checkrun-XXXXXX` — the top-level directory names the
run and would print identically for all of them, while the profile's own name is what
`launchChrome`'s prefix exists to carry, and so is what says which check left it.

`--reap` is the one place this can go wrong, so it defaults to `FLOOR_HOURS` — the same
hour the daemon's own sweep will never go under, Adam's ruling on this bead: "a check
another session started thirty seconds ago is indistinguishable from a check that was
abandoned thirty seconds ago." `--older-than <mins>` is the one way past that floor, for
the case the ruling does not cover — an agent reaping the Chrome its own check just
leaked, seconds ago rather than an hour. **Read the age column before passing it.**
Getting this wrong is not a shrug: killing a live Chrome out from under a running check
is the exact incident this file exists around — macOS counts a headless instance as a
running `com.google.Chrome`, so once one is orphaned, opening Chrome.app only
*activates* it, with no window and Cmd-Q apparently ignored.

The third guard is `--reap`'s, as much as it is the daemon's: **a top-level directory a
live Chrome is still on is never removed**, whatever the age of whatever else was under
it. That is not the same question as which processes to signal, because one
`beadcause-checkrun-XXXXXX` holds every check of a run — so the likeliest use of
`--older-than` there is, an agent ending the Chrome its own check just leaked, is
precisely the case where a sibling check is still live in the same directory. The
Chromes still on the process table after the reap are what say which directories those
are, and they are held back from the removal pass whether they were too young to target
or refused the signal outright.

Deliberately narrow: it ends Chromes and the profile each one owned, and nothing else —
the general scratch-directory sweep in the table above is the daemon's job, on its own
clock, and this does not reach for it. `test/b7echrome.mjs` never touches the real
machine: `bin/b7e-chrome` reads `$TMPDIR` through `lib/strays.js`'s own `tmpRoot()`, so
spawning it with `TMPDIR` pointed at a sandbox this run made is enough to make every
other Chrome on the Mac — including a legitimate one thirty other worktrees might be
running — invisible to it, and a stand-in script whose own name contains "chrom" stands
in for the real browser, the same shape test/chromeprofile.mjs and test/chromeleak.mjs
already use.
