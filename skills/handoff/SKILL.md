---
name: handoff
description: Summarize the current session's work into a durable handoff issue in beads (bd) so a fresh session can pick up exactly where this one left off, and file every open question, contradiction and out-of-scope discovery as its own `human` bead so nothing needing Adam is left in a console. Accepts an optional free-text description of what the next session should do, and tailors the whole summary toward that. Then automatically opens the handoff in a brand-new Claude Code session running in auto permission mode (suppress with `--no-open`). Use when the user says "handoff", "wrap up", "summarize this session", "I'm starting a new session", "context is full / compact soon", or asks what to carry over into a new conversation.
---

# Session handoff

This skill ships in the beadcause checkout (`skills/handoff/`), and `npm run
install-service` links it into Claude Code (bc-eszkl). Edit it there, not in
`~/.claude/skills`. `open-handoff` and `claim` beside this file are links to the
checkout's `bin/`.

Produce a **handoff** — a beads issue labelled `handoff` — that lets a brand-new
session (no memory of this conversation) resume the work without re-deriving
anything.

The reader is a competent agent who knows nothing about this session. Write for
that reader: concrete paths, exact commands, decisions already made, and the
single next action.

**Beads is the store, not a file on disk.** Handoffs used to be dated markdown
files under `.claude/handoffs/`; they are now issues in the project's beads
workspace. That buys unique IDs (no filename collisions between concurrent
sessions), a real open/closed lifecycle, `bd search` across every past handoff,
and one tracker instead of two. Do **not** also write a `.md` file — existing
files under `.claude/handoffs/` are historical, read them if referenced, don't
add to them.

## Step 0 — Read the argument (if any)

Everything after `/handoff`, minus the flags below, is Adam describing, in his
own words, **what the next session should do**. Examples:

- `/handoff now wire the exporter up to the CLI`
- `/handoff hand this to someone debugging the auth 500s`
- `/handoff pause here, pick up after the API keys arrive`

Treat that text as the **destination** and let it steer the whole document:

- It becomes the seed of `## Next action` — restate it as a concrete, startable
  instruction, adding the paths, commands, and constraints the next session will
  need that Adam's shorthand leaves implicit.
- It sets **relevance**. Include the context that serves that next step in full,
  and compress or drop threads that don't. A handoff aimed at "debug the auth
  500s" should carry every auth detail and can skip the unrelated CSS work — one
  line noting it exists is enough.
- It sets the **issue title**.
- Anything you know that makes the stated next step harder, blocked, or wrong
  goes in `## Gotchas` or `## Open questions` — **do not silently retarget the
  handoff to a different next step**. Write the handoff Adam asked for, and flag
  the problem inside it.

With **no argument**, infer the next action from the session yourself and say
plainly that you inferred it, so the next session knows it wasn't Adam's
instruction.

**Flags** (strip them out before treating the rest as the destination text):

- `--no-open` — write the handoff but do **not** launch the successor session in
  Step 5. Print the kickoff prompt instead.
- `--tab` — open the successor in a new iTerm **tab** rather than a new window.

## Step 1 — Gather facts (don't guess)

Run this in one batched Bash call.

Replace `<session-project-dir>` with the session's **primary working directory**
(the one named in the environment block of your system prompt) — not whatever
`pwd` happens to return. See the warnings below; this matters more than it looks.

```bash
cd <session-project-dir>
date "+%Y-%m-%d %H:%M %Z"
echo "BEADS_DIR: $BEADS_DIR"     # which issue graph the handoff will land in
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; echo "ROOT: $ROOT"
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 && {
  git -C "$ROOT" branch --show-current
  git -C "$ROOT" log --oneline -10
  git -C "$ROOT" status --short | head -30
  echo "(changed files total: $(git -C "$ROOT" status --short | wc -l | tr -d ' '))"
  git -C "$ROOT" diff HEAD --stat --stat-count=12 2>/dev/null
}
bd list --label=handoff --status=open --limit=10   # handoffs already live
true   # keep a non-git dir from exiting 128 and looking like a failed call
```

Four things about that block are worth knowing:

- **The `cd` is not optional.** The Bash tool keeps one working directory across
  calls, so any earlier `cd` in the session is still in effect — `pwd` can point
  at a repo you merely visited. Without the `cd`, `ROOT` silently resolves to
  *that* repo and the handoff describes an unrelated project. Observed for real:
  a session working in `projects` resolved `ROOT` to
  `projects/delmar` because of a `cd` several calls back.
- **`BEADS_DIR` decides which project's issue graph gets the handoff**, and it is
  resolved from the working directory by `_bd_set_workspace` in `~/.zshenv` at
  *shell startup*. So the printed value reflects where the shell started, and a
  `cd` in **this same call does not change it** — filing the handoff in the same
  call as the `cd` can put a sorrel handoff into the northwind graph. That is why
  Step 2 is a **separate** Bash call: by then the shell has restarted in the new
  directory and `BEADS_DIR` is correct. Check the printed path names the right
  project before creating anything.
- **If `BEADS_DIR` is still wrong**, don't fight it with `-C` or an inline
  `BEADS_DIR=…` (a new zsh re-runs zshenv and overwrites it). Use a fresh shell
  rooted in the right place: `(cd <project-dir> && zsh -c 'bd create …')`.
- The git output is **capped on purpose**. A busy repo can emit 100+ lines of
  status, and this skill runs exactly when context is scarce. If the total line
  says more files changed than were listed, say so in the handoff rather than
  re-running the command unfiltered.

Also gather from the conversation itself, not from re-reading everything:
- Files created or edited this session (you already know these).
- Commands that were run and whether they passed or failed.
- Background processes / servers started, and on which ports.
- Anything the user explicitly decided, rejected, or corrected you on.
- **Beads issues this session touched** — created, claimed, closed, or blocked on.
  Their IDs go in the handoff so the next session inherits the work graph, not
  just the prose.

If a claim is uncertain (e.g. "tests pass"), verify it or mark it `UNVERIFIED`.
Never write a status you didn't observe.

## Step 2 — Create the handoff issue

```bash
bd create --title="Handoff — <short title>" \
          --type=task --priority=1 --labels=handoff \
          --stdin --silent <<'HANDOFF'
<the markdown body from the template below>
HANDOFF
```

- **The heredoc delimiter must be quoted (`<<'HANDOFF'`).** Handoff bodies are
  full of backticks, `$ROOT`, `$(…)` and `!`. An unquoted heredoc expands all of
  them and silently corrupts every command the next session was meant to copy.
- **In a workspace holding several repos, add `--labels=handoff,repo:<name>`.**
  That label is what decides which checkout the successor's window comes up in
  when Step 6 goes through the daemon (`resolveSessionRepo`); without it the
  workspace's default repo answers, and a handoff about `athos-service` opens a
  session sitting in `architecture`. The `cl-` workspace is the one that needs
  this — every personal workspace is a single repo and the label changes nothing.
- `--silent` prints only the new ID (e.g. `cl-4o4`). Capture it — Step 4 and the
  Step 6 launch both take it as an argument.
- `--priority=1` because a handoff is the top of the next session's queue.
- Never `--claim` it. It stays **open and unassigned-to-a-session** until someone
  picks it up; the session that resumes claims it and closes it.
- Related work issues go in the body by ID (see `## Related issues`). Only add a
  real `bd dep add` when the dependency is genuine — a handoff does not block the
  work it describes.
- **Do not `bd dolt push` a handoff.** The northwind workspace shares a Dolt
  remote with the team (`Northwind/architecture`); session handoffs are yours and
  pushing them puts noise in everyone's graph. Push only if Adam asks.

Use this body structure. Drop sections that are genuinely empty rather than
padding them with "N/A".

```markdown
# Handoff — <short title>
**Written:** YYYY-MM-DD HH:MM ZZZ · **Dir:** /abs/path · **Branch:** <branch or "not a git repo">

## Goal
One or two sentences: what we are trying to accomplish overall.

## Where things stand
Bullets. What is DONE and verified, what is IN PROGRESS, what is BROKEN.
Mark anything unconfirmed as UNVERIFIED explicitly.

## Next action
> **Adam's instruction:** "<the argument, verbatim>"   ← omit this line if no
> argument was given; instead write "(inferred from the session, not specified
> by Adam)".

The single most immediate thing to do, specific enough to start on without
asking questions — Adam's instruction expanded with the concrete paths,
commands, and constraints it assumes. Then any queued follow-ups, in order.

## Related issues
- `cl-abc` — <title> — open/in_progress/closed this session, and what's left on it.
(Omit if the session touched no beads issues.)

## Key files
- `path/to/file.ts:120` — what it is / what changed and why
(Only files that matter for resuming. Not an exhaustive diff.)

## Decisions made
- <decision> — because <reason>. (Includes things the user rejected, so the
  next session doesn't re-propose them.)

## Open questions for Adam
Bead IDs only — each question was filed as its own `human` bead in Step 3.
One line each: `- cl-abc — <the question in a phrase> (blocks cl-xyz)`.
Do NOT restate the question or the analysis here; the bead is where it gets
answered. Omit the section if none were filed.

## Environment / how to run
Commands to start servers, run tests, etc. Note anything currently running and
on which port, and whether it will still be running in the new session.

## Gotchas
Traps discovered the hard way — flaky steps, misleading errors, dead ends
already explored so they don't get re-explored.
```

## Step 3 — File every open question as its own `human` bead

**A question printed to a console is a question Adam never sees.** He runs many
sessions at once and does not read their terminals; the whole point of this step
is that a session can end — self-close — without anyone coming along to scrape
its scrollback for what it needed answered.

So: **anything you would otherwise have written only into `## Open questions for
Adam`, or reported only in your closing message, becomes a bead.** That covers
all three shapes:

- **Questions** — a fork you couldn't resolve from the code, the docs, or
  sensible defaults.
- **Contradictions** — two sources of truth that disagree (two files, a file and
  a bead, canon and a draft). These are the highest-value ones and the easiest to
  lose; a contradiction nobody files gets rediscovered by four future sessions.
- **Discoveries** — real work found mid-task that is out of the current scope.

**This overrides the "propose, don't create" convention.** Adam's standing rule
elsewhere is that beads are *proposed* as ready-to-run `bd create` commands for
him to accept. He lifted that for this case specifically (2026-08-10): **create
these outright.** A proposal printed to a console has exactly the problem this
step exists to fix. Everything else — work beads, epics, refactors — still gets
proposed, not created.

### One bead per question. Never a bundle.

A single "open questions from session X" bead cannot be answered from a phone,
cannot be closed until the last one is settled, and cannot block the specific
work each question actually blocks. Split them.

### The shape (this is the "decision block")

```bash
bd create --type=decision --priority=1 --assignee=adam \
          --labels=human,author-decision \
          --title="<the question itself, with the options in it>" \
          --description="<the contradiction: what disagrees, in which files, with line refs and the exact conflicting values. How it surfaced.>" \
          --design="<the options as a bulleted list, one per option, each led with a **bold label**. Close with RECOMMEND <label> — and the reason.>" \
          --acceptance="<what 'answered' concretely means: which files get reconciled, which log entry gets flipped, what unblocks>" \
          --silent
```

- **`--title` is the question**, not a topic. `"Athira's age: ~450, or 230, or
  500, or 74,000?"` beats `"Athira age discrepancy"` — the first can be answered
  from a lock screen, the second requires opening it.
- **`--design` is a bulleted list, one bullet per option, each starting with a
  `**bold label**` — then an em dash and what that option costs.** The formatting
  is not decoration. Adam answers these from a phone, and beadcause reads exactly
  this shape out of the prose to draw tappable chips above the answer box; a
  paragraph that merely discusses the options reaches him as a wall of text with
  an empty box under it, and he types the answer out with a thumb. Keep each bold
  label short enough to sit on a chip — a few words, not a sentence.

  ```
  - **Keep both columns** — backfill nightly, drop the old one next quarter.
    Slow, and reversible at any point.
  - **Drop it now** — one migration, ten minutes of write downtime, no way back.

  RECOMMEND Keep both columns — the downtime is cheap but the irreversibility is
  not, and nothing downstream needs the column gone this month.
  ```

- **`--design` must end in a `RECOMMEND <label>`,** naming one of the bold labels
  verbatim so it can be matched back to its option and starred. Adam is choosing,
  but he should be choosing between a recommendation and an alternative, not
  doing your analysis again. Say which way you'd go and why, in one or two
  sentences. Write `not recommended` on an option you are warning against — that
  is understood and will never be starred.
- **Two options minimum, six maximum**, with no two reading the same. Below two
  there is nothing to choose between; above six it is a document, not a question,
  and either way the chips are dropped and he is back to typing.
- **`--labels=human`** is what puts it in the phone queue (`bd list -l human`).
  `author-decision` marks it as genuinely blocked on him rather than on an agent.
  Add the project's own topic labels too.
- **`--priority=1`** if it blocks the next action; `2` otherwise.
- **`--parent=<epic>`** where the project uses epics, so it doesn't float loose.

### Wire the block into the graph

If a question blocks work, say so in the graph — don't rely on a future session
reading the handoff prose and choosing to stop:

```bash
bd dep add <blocked-work-id> <question-id>
```

That way the blocked work stops being `bd ready`, and the next session picks up
something else instead of guessing at Adam's intent. **A guess costs more than
the wait** — that is the entire reason this step exists.

### Then reference them, don't restate them

`## Open questions for Adam` in the handoff body becomes a **list of bead IDs
with one-line summaries**, not the questions themselves. The bead is where the
question lives and where it gets answered; the handoff just points at it. If you
find yourself writing the full contradiction into the handoff body, you have
skipped this step.

### If there are none

Skip the step and say so in your closing message — "no open questions filed" is
information, and its absence is indistinguishable from having forgotten.

## Step 4 — Retire the handoff this session consumed

Writing a new handoff means the previous one has been **used** — the session that
just ended is the one that consumed it. Close it so `bd list --label=handoff
--status=open` shows only live threads:

```bash
bd supersede <old-handoff-id> --with=<new-handoff-id>   # closes old, links to new
```

- Only retire the handoff **this session actually resumed from**. Several
  sessions share one workspace, and `bd list --label=handoff --status=open` will
  show siblings' live handoffs — those are not yours to close. If in doubt, leave
  it open and say so in your closing message so Adam knows two threads are live.
- If this session started fresh (no handoff consumed), skip this step entirely.
- **Close, never delete.** Adam's call (2026-07-26, carried over from the old
  archive rule) — superseded handoffs stay readable and searchable via
  `bd list --label=handoff --all` and `bd search`.

## Step 5 — Persist what outlives the task

Durable facts (project constraints, user preferences, corrections, external
resources) belong in the auto-memory at
`~/.claude/projects/<project-slug>/memory/`, not only in the handoff — handoffs
are snapshots, memory is standing context. Follow the memory rules in
`~/.claude/CLAUDE.md`: one fact per file, frontmatter, plus a one-line pointer
in `MEMORY.md`. Update an existing memory file rather than duplicating it.

`bd remember` is **not** a substitute here — it is for issue-scoped working
notes. The memory directory stays the source of truth for who Adam is and how he
wants work done.

Skip this for anything that only matters to finishing the current task.

## Step 6 — Open the handoff in a new session

The handoff is delivered by **starting the successor session**, not by leaving a
prompt for Adam to paste. Run, with the real ID and **the main checkout** — which
is *not* `<session-project-dir>` when this session is working in a worktree:

```bash
cd <session-project-dir>                        # the same directory as Step 1
MAIN="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
MAIN="$(dirname "${MAIN:-$PWD/.git}")"          # outside a repo this is just $PWD
~/.claude/skills/handoff/open-handoff <handoff-id> -d "$MAIN"
```

**Pass the main checkout, never this session's worktree** (bc-tstol). `--git-common-dir`
is `<main-checkout>/.git` from anywhere in the repo, worktrees included, so those two
lines are right in both cases; a worktree is detectable because `--git-dir` differs from
it. The `cd` is there for the same reason it is in Step 1 — the Bash tool carries one
working directory across calls, and `git rev-parse` answers about wherever it left off.

Step 1's `cd <session-project-dir>` does **not** change — it is load-bearing for
`BEADS_DIR` and `ROOT`, and the worktree is the right place to gather facts from. Only
`-d` moves, and it moves nothing else: `~/projects/<repo>/.claude/worktrees/x`
and `~/projects/<repo>` strip to the same `<repo>`, so the workspace this
handoff is filed in is byte-identical either way. What changes is where the *successor*
comes up — and it must come up in the checkout, where the worktree guard makes it claim a
fresh worktree of its own.

On 2026-08-30 this step handed `-d` a worktree, the fallback made it the `cd`, and the
successor came up **inside a different, still-live session's locked worktree**. From the
inside that looks exactly like a session that has already claimed one, so it never called
`EnterWorktree`; the two of them then committed to one branch out of one index.

That script has **two paths, and it picks between them itself.** You still run the
one command either way.

**1. The local beadcause daemon, when one answers.** It reads `port` and `token`
from `~/.config/beadcause/config.json`, probes
`http://127.0.0.1:<port>/api/health` (2s, plain HTTP — `tls.enabled` is true but
what answers on loopback is HTTP, and an `https://` probe returns nothing), and
POSTs `{"workspace":"<ws>","id":"<id>"}` to **`/api/handoff`** when that health
payload lists the handoff's workspace. The daemon opens the successor itself, so
the window lands in its session list, on the console, and under its "never two
sessions on one bead" guard. The workspace is derived from the project dir by the
same rule as `_bd_set_workspace` (`~/projects/<repo>/…` → `<repo>`,
anything else → `architecture`); `-w <workspace>` overrides it.

**On the daemon path `-d` chooses the workspace, not the window's directory.**
The daemon resolves that itself, from the workspace's checkout and the bead's
`repo:` label (Step 2) — so a successor opened from a worktree comes up in the
main checkout, which is right: it should claim a fresh worktree of its own, not
inherit the predecessor's, live or dead. Since bc-tstol **the fallback agrees**:
before it emits the `cd`, it resolves a worktree path to the checkout it belongs
to and prints one line saying it redirected. So passing a worktree is no longer a
trap on either path — but pass the checkout anyway, per the command above, rather
than relying on a backstop.

**Why `/api/handoff` and not one of the other two doors** (bc-ol4d, answered
2026-08-14 — do not re-litigate it):

- `POST /api/bead/advocate` **409s on every handoff there has ever been.**
  `wantsAdvocate` needs a P0 carrying an `owner:` label; Step 2 files handoffs
  `--type=task --priority=1` and never claims them, on purpose.
- `POST /api/session` would take it and **brief it wrong**, which is worse. Its
  prompt says *"don't answer it on my behalf … we'll decide together"* and ends by
  telling the session to `bd close <id> --reason "Answered in a Claude session"`.
  A successor briefed that way discusses the handoff and marks it answered instead
  of doing the work — a failure that reads as success from every screen.

**2. The iTerm fallback**, which is what runs when no daemon answers. A new iTerm
window, `cd` into the checkout (so `_bd_set_workspace` resolves the right
`BEADS_DIR` for that graph — the same trap as Step 1), then:

```
claude -n "handoff <id>" --permission-mode auto "<kickoff prompt>"
```

**Every daemon refusal falls through to path 2 and says so on one line** — no
daemon, workspace not served, `403` (this instance is `OBSERVING` another Mac, or
`openSessions` is off), `409` because the bead has no `handoff` label, `400`
(unparseable id). A handoff that silently opens nothing is the failure the whole
arrangement exists to avoid.

**Two answers are not refusals and do not fall through** (bc-t5inx — on
2026-10-31 a 44 s daemon launch against a 20 s client limit gave dv-q52fe and
dv-pa8h5 two successors each):

- **A timeout.** The daemon has the request and is still launching. The script
  waits up to `OPEN_HANDOFF_TIMEOUT` (default 90 s), asks once more — the daemon
  marks the handoff "opening" before it launches, so that is a quick `409` — and
  if the daemon still does not answer it opens **nothing**, prints the kickoff,
  and exits **4**. Do not open a window yourself on exit 4; tell Adam the daemon
  may still be bringing it up and give him the kickoff block below.
- **A `409` with `already: true`** — a session is open or opening on that
  handoff. That is the one-successor guard working; exit 0, nothing more to do.

- `--permission-mode auto` is the automode Adam wants — the successor starts
  working immediately instead of waiting on a paste and a permission prompt. The
  daemon path uses its own `sessionPermissionMode`, which is the same automode.
- The kickoff prompt lives **inside the script** on the fallback path and in
  `handoffPromptFor` (beadcause `lib/session.js`) on the daemon path. **They say
  the same four things and must keep doing so** — read the description with
  `bd show <id> --json | jq -r '.[0].description'`, claim it **for the session**
  with `node <beadcause checkout>/bin/claim.js <id>` (exit 3 = another
  live session already has it: stop), continue from `## Next action`, verify
  anything marked UNVERIFIED. Never a bare `bd update <id> --claim` in a kickoff:
  every one of Adam's sessions is the same actor, so two successors both win it
  (bc-3jzrd — that is how dv-q52fe was built twice). Which path
  opened the successor must not change what the successor does. If you edit one,
  edit the other; `test/handoffdoor.mjs` in beadcause pins the daemon's half.
- Pass `--tab` (from `/handoff --tab`) to open an iTerm tab instead of a window.
  It only affects the fallback — the daemon always opens a window.
- `--dry-run` prints **which path it would take** and the command it would run,
  without opening or POSTing anything — use it if you need to show Adam what will
  happen first. `--no-daemon` forces the fallback.
- The new session inherits nothing from this one but the handoff. If the handoff
  is thin, the successor is stuck; that is the real reason Steps 1–2 insist on
  concrete paths and commands.
- If Step 3 filed a question that **blocks the next action**, say so in the
  handoff body and do not launch into work that is waiting on Adam. Neither door
  accepts caller text, so the body is the only thing the successor reads — the
  kickoff cannot carry a caveat for you.

**Skip this step entirely when `--no-open` was passed.** Also skip it — and say
why — if the script exits non-zero (no `claude` on PATH, bad dir, AppleScript
refused, or 4: the daemon timed out twice and may still be opening it; a daemon
refusal is not one of these, it falls back). Do not retry it in a loop — least of
all on 4, where a retry is the second successor.

Whether or not it launched, print the kickoff block so Adam can start the
session himself with the real ID substituted:

```
Read handoff cl-xxx — run:
bd show cl-xxx --json | jq -r '.[0].description'
then `node ~/.claude/skills/handoff/claim cl-xxx` — if it exits 3,
another session already has it: stop — and continue from "Next action".
```

**Use the `--json | jq` form, not bare `bd show`.** Bare `bd show` pretty-prints
the description: it strips backticks, unwraps fenced code blocks, and hard-wraps
at ~76 columns, which mangles long paths and makes commands unsafe to copy. The
JSON field is the byte-exact markdown you wrote.

If the ID is ever lost, handoffs are findable with
`bd list --label=handoff --status=open` or `bd search "<topic>"`.

Then end the response with the `🔗 Access` footer (per `~/.claude/CLAUDE.md`)
giving the handoff issue ID, whether a session was opened for it and in which
window/tab, the command to read it, plus any local server involved.

## Rules

- **Facts over narrative.** No "we explored various approaches" — say which
  approach won and why the others were dropped.
- **No fabricated status.** Test results, deploy state, and "it works" claims
  must be observed this session or marked UNVERIFIED.
- **Aim for one screen** of substance. Long enough that nothing has to be
  rediscovered, short enough to actually be read.
- **Don't re-read the codebase** to write this. It summarizes the session; if
  something is missing from your context, say so rather than inventing it.
- **The argument wins.** If Adam named a next step, that is the next step, even
  if you'd have chosen differently. Object inside the document, not by quietly
  writing a different handoff.
- **Write the issue before opening the session.** The launch is the last thing
  that happens; a successor opened against an ID that doesn't exist yet is worse
  than no successor. If anything in Steps 1–5 failed, fix it or report it — don't
  launch on top of it.
- **Nothing Adam needs to act on may exist only in the console.** A question, a
  contradiction, or a discovery that lives only in your closing message is lost
  the moment the window scrolls — he does not read session terminals. If it needs
  him, it is a bead (Step 3). The closing message is a courtesy summary of beads
  that already exist, never the delivery mechanism.
