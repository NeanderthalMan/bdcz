### Land a relay reviewer subagent's report in the repo verbatim, or say it died — `b7e-report`

`bc-dgx7.148`, filed by the session audit against five loremia sessions (`lm-nsy.12`,
`.14`, `.17`, `.21`, `.23`) that each answered "did the reviewer finish, and what exactly
did it say" a different way for the same relay shape — all five launched `clio` and
`muse` as async `Agent` calls, and those subagents have no `Write` tool, so the drafting
session had to put each report into the repo itself. `lm-nsy.23` wrote a one-off
`scratchpad/extract_report.py`; `lm-nsy.17` used an inline `python3 - <<EOF` heredoc once
per report; `lm-nsy.14` and `lm-nsy.21` just retyped both reports with `Write`, one of
them regenerating a multi-thousand-word critique as output instead of copying it; and in
`lm-nsy.12` a checker subagent died on a 429 mid-run, which the session found out about
only later, hand-wrote the other role's report, and ran the dead one inline instead —
which its own debrief says makes that check not independent of the fix it was reviewing.

```
b7e-report <agent-id> --role <role>                  print the report to stdout
b7e-report <agent-id> --role <role> --to <path>       write it there instead
b7e-report <agent-id> --role <role> --wait            block until the subagent finishes
b7e-report <agent-id> --role <role> --timeout <secs>  give up after that long (implies --wait)

<role> is any role a relay declares — this checkout's .beadcause/relays.yaml, or the config's relays
```

**Not the same shape as `b7e-await`, even though both resolve a backgrounded task by id.**
`b7e-await` (just above) hands back a *backgrounded `Bash` call's* raw stdout+stderr, with
a bash-style `[exited with code N]` trailer the harness appends the moment it exits. A
backgrounded `Agent` (subagent) call gets none of that — its `<task-id>.output` is the
session's own JSONL transcript, one event per line, and the report is a single `text`
content block inside one `assistant` event, not the whole file. `lib/relayreport.js` has
the read: a normal finish ends on an `attachment` with `hookName: "SubagentStop"`; a died
run (most often a rate limit) ends on an `assistant` event carrying `isApiErrorMessage:
true`, `apiErrorStatus: <code>` and `error: "<name>"` at the **top level**, sitting beside
`message` rather than inside it — both found by inspecting real relay transcripts, since
neither shape is written down anywhere else. The report itself is matched by heading —
`# Editor's Continuity Report — ...`, `## Critic's Notes: ...`, `# Critic's Re-check — ...`
were all seen in real reports, so the match is "some number of `#`, then the role name as
a whole word", not a fixed string or a fixed heading depth. A transient API hiccup the
subagent recovers from does not shadow the eventual report — "found the matching text" is
checked before "saw an error line", so recovery beats an earlier stumble.

**The session/cwd-slug resolution is shared with `b7e-await`, not duplicated.**
`lib/taskfile.js`'s `resolveTaskFile` is the exact function `b7e-await` used inline before
this bead factored it out: try this process's own cwd first, then fall back across every
sibling cwd-slug under the same uid carrying the same `$CLAUDE_CODE_SESSION_ID` — the same
answer to the same problem, "a worktree entered after the task was backgrounded has a
different cwd than the task started under", that `b7e-await`'s own header already argued
for. `--dir <path>` is the same escape hatch, for the same reason: a caller that already
has the path, and how the tests drive discovery without a real backgrounded task.

**`--wait` and `--timeout` are two flags because the ordinary case does not wait at all.**
Unlike `b7e-await`, which exists specifically to block, the ordinary call here is "the
subagent already finished, hand me its report" — ordinary single read, no polling, so
`b7e-report <id> --role <role>` with neither flag reads once and, if nothing has landed
yet, exits immediately rather than hanging. `--wait` is for a caller that is not sure yet
and is willing to poll; `--timeout <secs>` bounds that poll and implies it even without
`--wait`, the same shape `b7e-await` gives `--timeout` on its own.

Exit codes: `0` found the matching report — printed or written. `2` bad usage. `124`
still running (including "no task by that id has even turned up yet") and `--timeout`
ran out, or nothing was found with no wait requested at all — a zero-length wait is
still a timeout. `125` the subagent's run ended in an API error before it ever produced a
matching report — the reason is on stderr and nothing is written. `126` the subagent
finished (`SubagentStop` was seen) but nothing in its transcript matched the expected
heading — wrong role, or it answered some other way.

`bin/b7e-report`, extensionless, same reasoning as `b7e-await`. **Not on
`DEFAULT_TOOL_LIST`** — `@grant excluded`, not `@grant read`, because unlike `b7e-await`'s
argv this one's `--to <path>` names a real path it writes to. `write` is a real option in
`lib/tooldecl.js`'s `KINDS` and reads like the right one, but it turns out to be currently
unusable by any `@grant` header: `lib/grants.js`'s `grantProblems` requires a `why` and a
`granted` allowlist on every non-`read` entry, and the `{ kind }`-only shape a header
declaration produces has nowhere to carry either, while hand-writing that metadata into
`lib/grants.js` for a name also declared in `bin/` is exactly the collision
`test/tooldecl.mjs` refuses. `excluded` is the same choice every other tool in this family
that writes has made (`b7e-apply`, `b7e-take`, `b7e-swbump`, `b7e-fresh`, `b7e-asset`) —
off the default surface, reachable by a worker session's already-unrestricted Bash.
