### What else was this machine doing at a moment — `b7e-moment`

`bc-dgx7.55` is the session audit's finding: three auto-filed `app-error` beads
(`bc-19vt`, `bc-y8wf`, `bc-l8ub`), three sessions, the same opening question — what was
happening on this Mac at the bead's `created_at` — and three different hand-rolled
answers, none of which the next session could reuse. `bc-19vt` read the daemon log by
hand — `grep -n "api/queues" ~/Library/Logs/beadcause.log | tail -20`, then `sed -n
<n>,<n+25>p` on a 21,878,663-byte file — and the debrief says the diagnosis it turned up
(`[cache] board: gave up its refresh slot after 150s` beside `slow GET /api/queues
150057ms cold`) "took ten minutes to find because the answer is in the daemon log rather
than anywhere in the code". `bc-y8wf` never opened the log at all, and grepped
`~/.config/beadcause/deploys` by hand instead. `bc-l8ub` did neither, and got the actual
finding — another `app-error` bead three minutes earlier, two merges either side, merges
here self-deploy — from `bd list --json` filtered by hand alongside `git log
--since/--until`.

```
b7e-moment <bead-id>                around the bead's own created_at, ±15m
b7e-moment <bead-id> --window 30m   widen or narrow the window either side
b7e-moment --at <iso>                a bare timestamp instead of a bead
b7e-moment <bead-id> --json          one object instead of the printed report
b7e-moment --at <iso> --log <path> --deploys <dir>   read fixtures instead of the real ones
```

**Five blocks, always printed, each saying explicitly when it has nothing** rather than
being omitted — the failure this replaces was never "the data wasn't there", it was that
an omitted source reads exactly like a source nobody thought to ask:

1. **The bead's own occurrence comments.** `lib/errors.js` already writes a comment
   ("**Occurrence 3** — ...", "**4 more occurrences** — ...") every time a report
   matches an existing bead's fingerprint; this reads them back off the bead's own
   thread and says plainly whether this has ever recurred.
2. **Other `app-error` beads created inside the window** — `bc-y8wf`'s `bd list --label
   app-error` step, generalised to any window instead of eyeballed against `tail`.
3. **Deploy records overlapping the window** — `lib/deploy.js`'s own journal
   (`requestedAt`/`finishedAt`), read from the real `~/.config/beadcause/deploys` or a
   fixture named with `--deploys`.
4. **`git log` on this checkout, inside the window** — via `lib/gitref.js`'s `git()`, so
   the answer to "was this a deploy window" no longer needs a separate hand-typed
   `--since/--until`.
5. **The daemon log's own lines inside the window** — streamed line by line
   (`readline` over a `createReadStream`, never a whole-file read: the log this was
   filed over is 21,878,663 bytes and only grows), with `slow`/`[cache]`/error lines
   called out the way `bc-19vt`'s hand read singled them out. A line with no leading
   stamp of its own (a continuation of a multi-line write) inherits the stamp of the
   line before it, per `lib/logstamp.js`.

`lib/moment.js` is the join and the streaming reader; `bin/b7e-moment` is the argv
parsing and the printing around it. `Bash(b7e-moment:*)` is on `DEFAULT_TOOL_LIST` in
`lib/toolbelt.js` and `read` in `lib/grants.js` — every `bd` verb it spawns (`show
--include-comments`, `list --label`) is a read, and the log/deploy/git reads never
write anything either. See `bin/b7e-moment`, `lib/moment.js` and `test/b7emoment.mjs`.
