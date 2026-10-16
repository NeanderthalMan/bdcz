### Wait for a call the harness already backgrounded — `b7e-await`

`bc-dgx7.99` is the opposite end of `b7e-bound`, just above: that one puts a deadline on
a *foreground* run because this Mac has no `timeout` binary; this collects a task the
harness has *already* moved to the background and hands back its real exit status. Six
sessions (`lm-b5d.24`, `lm-b5d.26`, `lm-3rn.2`, `lm-gr6.36`, `lm-nsy.6`, `lm-k4n.5`) each
invented a different wait for one: `until [ -s …/tasks/<id>.output ]; do sleep 5; done`
after a bare `cat` returned `---still running?---`; repeated blind `cat` polls, several
reading a half-written file as a finished one; a `while [ "$(grep -c …)" -lt 57 ]; do :;
done` busy-wait that spun at full CPU and died at exit 143 after five minutes, followed by
`setsid` (which does not exist on this Mac) and a `pkill -f`; a line count checked against
a guessed total of 18. Emptiness is not completion and a line count is not completion —
the thing that actually means "done" is the task's real exit status, and none of those six
polls could see it, because none of them knew where it was written down.

```
b7e-await <task-id>                    block until it exits, print output, exit with
                                        the SAME code the task exited with
b7e-await <task-id> --timeout <secs>   give up after that long instead: print whatever
                                        output exists so far, exit 124
b7e-await <task-id> --tail <n>         print only the last n lines of the output
```

**Where it is written down** — worked out by driving a real `run_in_background` call and
reading what came back, not from any doc: the harness backs a backgrounded task with a
file at

```
/private/tmp/claude-<uid>/<cwd, every non-alnum char turned into `-`>/<session id>/tasks/<task-id>.output
```

which fills with the task's combined stdout+stderr as it runs and, the moment the task
exits, gets one line appended: `[exited with code N]`. If something else stopped it first
— the harness itself, at session end or on a `TaskStop` — the file ends `[killed]` instead,
with no code at all, and `b7e-await` exits `125` for that case rather than guessing at a
code that was never written. `<uid>` and `<session id>` are `os.userInfo().uid` and
`$CLAUDE_CODE_SESSION_ID`, no discovery needed; `<cwd>` is the caller's cwd **at the
moment the background call was made**, which is not necessarily this process's cwd right
now — a session that calls `EnterWorktree` between backgrounding a task and awaiting it
has a different cwd than when the task started. So the search tries this process's own
cwd first and, if that slug has no matching file, falls back across every sibling slug
under the same uid that has this exact session id under it. `--dir <path>` skips all of
that and looks for `<task-id>.output` directly under `<path>` — the escape hatch for a
caller that already has the path (the backgrounding call prints it), and how `test/b7eawait.mjs`
drives the discovery and fallback logic itself against a throwaway fixture tree instead of
the real `/private/tmp/claude-<uid>`.

Polls every 300ms, reading only the last 256 bytes of the file rather than the whole
thing, so a long-running gate log growing under it costs nothing per poll; measured by
hand at 1-2% CPU while blocked. With no `--timeout`, a task id that never turns up at all
still gives up after a 2-second grace rather than hanging forever on a typo — completion
itself is still unbounded, the grace only covers "does this file exist yet".

Exit codes: the task's own code if it exited on its own, normalised into 0-255 the same
way `process.exit` always does; `124` on `--timeout` (coreutils' own `timeout` uses the
same number, and so does `b7e-bound` above); `125` for `[killed]`; `127` if no task by
that id ever turns up.

The file is `bin/b7e-await`, no `.js`, same reasoning as `b7e-bound` just above. **On
`DEFAULT_TOOL_LIST`**, unlike `b7e-bound`: its argv is a task id plus three flags, none of
which name a command to run or a path to write, so there is nothing here for the
"reaches a write" check to be blind to.
