### What a page actually looks like, in numbers — `b7e-eyeball`

`bc-khoe.45` is [the audit agent](../advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work)
on its widest evidence yet, and the only finding so far to arrive from two trackers at
once: **six** sessions each hand-built the same rig in a scratchpad to answer *what does
this actually look like at 393px, in numbers*, and no two built the same one. Three here —
`bc-khoe.26` wrote a fixture server over `public/` plus a hand-written page mounting the
real `filtermenu.js`; `bc-mtdb` wrote one that printed
`{brandKids, observing:{w,h,x}}` at 360 and a PNG it then read; `bc-dgx7.5` wrote a
dark × light × full × empty sweep asserting "nothing runs past 393px", then patched it three
times with `python3` as the CSS moved under it. Three more in sorrel, filed separately as
`sp-6bt.10` and folded into `bc-khoe.45` on 2026-08-22 because they are the same command
under another name: `sp-6bt.2`, `sp-jb1` and `sp-auj` each wrote two or three of
`shot.py` / `measure.py` / `overflow_check.py`.

Three memory notes record three competing recipes for the one job, which is the tell.
`scripts/shot.mjs` could not be used by any of the six: it photographs the **running
daemon**, so it cannot show a page fed synthetic state, and it cannot mount a module on a
fixture at all.

```
b7e-eyeball <path>...          one or more pages of the working tree
b7e-eyeball --mount <module>   a public/ module on a generated fixture instead
  --width 360,393              repeatable or comma-separated (default both)
  --theme dark,light           repeatable or comma-separated (default both)
  --payload <file.json>        repeatable — the API state, and/or the data a fixture mounts
  --measure <sel,sel>          repeatable — the nodes to report
  --call <js>                  runs after --mount, with mount/payload/mod/mods in scope
  --html <file>                markup to put inside the fixture mount
  --wait <sel> --settle <ms>   what to wait for before measuring
  --out <dir>                  where the PNGs go (default .claude/shots)
  --baseline                   serve public/ from HEAD — the before-shot, no git stash
  --strict --json --dir <root>
```

One PNG per (page × width × theme × payload) under `--out`, and per cell: every
`--measure` selector's rect, colour, background, child count, rendered line count and
whether it is clipped; the document's scroll width against the viewport; and the elements
whose right edge is past it. Console errors, page exceptions and any response `>= 400` are
printed under the PNG path, the way `scripts/shot.mjs` already does — a screenshot shows
you a blank panel and not the 401 behind it, which is exactly when a picture on its own
misleads.

**Four traps are closed by construction, and each of them cost one of the six real time.**

*The harness writes the document, so the charset trap cannot come back.* `bc-khoe.26`'s
fixture had no `<meta charset="utf-8">`, its caret rendered as mojibake, and its debrief
says outright "you will chase a bug that is not there".

*The mount is given an explicit width, because `min-width: auto` silently invalidates every
height taken off it.* `Emulation.setDeviceMetricsOverride` sets the *viewport*;
`document.documentElement.scrollWidth` then reports 393 quite happily while a flex item
underneath resolves `min-width: auto` to its own min-content and lays out at 517. `bc-henk`
paid a whole round of "86px a card" that was really 107px for that. Every record prints the
mount's measured width beside the viewport, so the two can be *seen* to agree rather than
assumed to.

*Overflow is two questions and `scrollWidth` answers one of them.* An ancestor with
`overflow-x: hidden` takes the offender out of the document's width while it is still being
cut off the side of the phone — the shape `bc-8l74` found a fourth button already clipped
off the advocate card by. So a run reports both: the scroll width, **and** a walk for
elements past the edge. `overflow-x: auto`/`scroll` exempts one (a filter row is allowed to
be wider than the phone); `hidden` and `clip` deliberately do not.

*The port is never a number.* `sp-jb1` started its server on a fixed 8099, spent four calls
measuring **another session's worktree** on the same port, and found out only from an
`[Errno 48]` in its own log — the same failure `scripts/helpers/chrome.mjs` exists to have
fixed for Chrome's debugging port, one layer up. `listen(0)`: the kernel picks, nothing
collides, and the port that was used is on every record.

**A payload is one file doing two jobs, with no reserved key.** The whole JSON file reaches
a fixture document as `payload` — the synthetic groups a module is mounted on. Separately,
any top-level key starting with `/` is served at that path — the API response a real page is
fed. Two payloads and one width is `bc-dgx7.5`'s four-state sweep in one call. Everything
else under `/api/*` answers `{}` rather than 404, because a 404 on a route a page merely
polls hides the top bar and reads as the feature being broken.

What it serves is the **working tree**, behind the app's own alias *and hop* tables, derived
from `lib/server.js` by `lib/pagealias.js` rather than copied. Both halves are needed: a
path that is now a view of the shell — `/monitor` since `bc-khoe.4` — is neither a file nor
an alias, and serving it as a 404 hands Chrome its own error page, which carries no viewport
meta, so `innerWidth` comes back 980 on a 360px run and every number in the record is about
a page nobody asked for. That is not hypothetical: it is what the first real run of this
command did, and it is a suite now.

There is no credential anywhere in it. The fixture server is not the daemon, so the pairing
token is a fixed fake string — `scripts/shot.mjs` has to mask a real one out of its own
output (`bc-sqab`) and this has nothing to mask.

Exit codes: `0` every cell clean; `1` a cell overflowed, never loaded, threw inside its
fixture, or had a `--measure` selector match nothing (`--strict` adds console and network
problems); `2` refused — bad usage, or no Chrome.

`lib/eyeball.js` is the library and `bin/b7e-eyeball` is the argv parsing, the Chrome and
the printing. The line between them is drawn where the testable part stops: `npm test` here
deliberately does not depend on a browser, so `runEyeball` takes an injected driver and
`test/eyeball.mjs` drives the whole of it — plan, generated document, fixture server,
verdict, PNGs — with a fake one.

Not on `DEFAULT_TOOL_LIST`, on the same reading as `b7e-gate`: it
launches a browser, binds a port and writes files, which is the shape `lib/grants.js`
already calls a write. It would also be pointless there — `dispatch`, the one agent that
list governs, answers a phone comment with one `bd comment` and has no page of its own to
look at, while `worker`, whose occasion this is, runs on the unrestricted CLI default
already.
