---
name: bdcz
description: File a bead in the beadcause tracker (bc-) from any session, in any repo, straight from Adam's words. Use when Adam types "/bdcz <anything>" — the text after the command is what the bead is about. Adam asked for it himself, so it is filed as ordinary, endorsed work, not as an agent-filed `unendorsed` bead.
---

# /bdcz — file a beadcause bead

`/bdcz <anything>` turns the text into **one bead in the beadcause workspace**, whatever
directory this session is in.

This skill ships in the beadcause checkout (`skills/bdcz/`), and `npm run install-service`
links it into Claude Code (bc-eszkl). Edit it there, not in `~/.claude/skills`.

## The one command

```bash
node ~/.claude/skills/bdcz/file.mjs --title '<title>' --type <type> --priority <n> \
  --body-file <scratchpad>/bdcz-desc.md \
  [--label <label>] [--dep discovered-from:bc-x] [--parent bc-y] [-w <workspace>]
```

Use the path to `file.mjs` in this skill's base directory, as shown when the skill loads.
It is a symlink into the beadcause checkout, so run it with `node` as shown.

What it does for you, so the skill doesn't have to:

- **Picks the workspace from beadcause's config**, not from the shell's working
  directory, so a session in sorrel or a Northwind repo still files into `bc-`.
  `-w` files somewhere else.
- **Adds this Mac's `owner:` label to a root**: an epic, or any P0. Beadcause reads
  ownership from that label, and a root without one gets no advocate. Don't add it yourself.
- **Never adds `unendorsed` or `agent-filed`.** Those mark work an agent decided on
  (`beadcause-file`). Here Adam asked, so the bead is ready work as soon as it's filed.
- **Flags a likely duplicate** on stderr and links the two beads instead of refusing.

It prints the new id on stdout. Exit 2 means the workspace isn't configured; exit 3 means
bd refused the create (the message says why).

## What to do

1. **Read the argument.** That's the whole spec. If it is empty, ask what the bead is about
   and stop.
2. **Shape it, don't expand it.**
   - **Title:** one plain sentence that states the problem or the outcome, in the style of
     existing bc- titles (`The beadcause advocate has opened no session while work waits in
     its queue`). Keep Adam's wording where it works.
   - **Description:** what Adam said, plus whatever this session's context makes obvious
     (the file, error or bead being discussed). Don't invent requirements, acceptance
     criteria or a plan he didn't ask for. If his text is the whole story, the description
     is just his text.
   - **Type:** `bug` if something is broken, `feature` for new behaviour, `epic` only if he
     says so, otherwise `task`.
   - **Priority:** 2 unless his words say otherwise ("urgent"/"P0" → 0, "someday" → 3 or 4).
   - **Edges:** if this session is clearly working on another bc- bead and this came out of
     it, pass `--dep discovered-from:<that id>`. If he names a parent, pass `--parent`.
3. **Write the description to a file** in the scratchpad with the Write tool, and pass it
   with `--body-file`. That keeps backticks and quotes away from the shell, where a
   backtick inside double quotes gets run as a command.
4. **Run the command once.** Single-quote the title; write a `'` inside it as `'\''`.
5. **Report** in one or two lines: the new id, title, type and priority, plus any duplicate
   it flagged. Then stop. Don't claim it, start the work or open a session. An advocate
   picks up ready work by itself.

## Don't

- Don't refuse because a similar bead exists. File it and name the look-alike.
- Don't file more than one bead unless his text clearly lists several. If it does, run the
  command once per bead and report every id.
- Don't fall back to a bare `bd create` if the command fails. Report the error instead,
  because a bare `bd create` files into whatever workspace this directory resolves to.
