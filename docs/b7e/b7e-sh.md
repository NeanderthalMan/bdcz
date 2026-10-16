### A multi-step shell script in one call — `b7e-sh`

`bc-ka5y.29` is the session audit naming the same workaround in six sessions: a
worktree-isolated session's own Bash approval refuses a `for` loop, a `sed -i` run
issued more than once, a multi-line `set -e; …` block, or a `git -C` into another
checkout, all as "too complex to verify that it stays inside the worktree" — thirty-one
refusals across the archives, for work every one of those sessions was cleared to do.
`bc-ka5y.19` split a thirteen-line `sed` conversion into thirteen single-line calls;
`bc-ka5y.22` and `bc-1kwl.30` each wrote the same disposable `run.sh`-into-`zsh` wrapper
into a scratchpad, neither knowing the other had; `bc-7qo.14` split one `mktemp`+`mkdir`
+`mkdir` line into three calls and pasted the resulting absolute path into every command
after; `bc-36xx.18` ran eleven suites as eleven calls instead of a loop.

```
b7e-sh script.sh                                the whole script, checked then run
b7e-sh script.sh --allow /tmp/some-tracker       a mktemp dir or the scratchpad, named
b7e-sh -c 'for f in a b c; do echo "$f"; done'    a command string, not a file
b7e-sh script.sh --dry                           verify only, run nothing
b7e-sh script.sh --cwd /some/other/worktree       default cwd is where this is run from
```

**The refusal was never "this is unsafe" — it was "this Bash call is too complex to
check".** The fix is not a wider Bash allowance; it is moving the complexity into a
*file*, which `Write` already allows without complaint, and keeping the Bash call itself
to one short, plain invocation of this command. That only holds if what runs the file is
actually held to the bound the refusal was protecting, so `lib/shguard.js` reads the
whole script before a single line of it runs and refuses anything that would touch
outside `--cwd` or a named `--allow` root — **in every spelling of a path, not just the
one the shapes are usually written in**. `bc-ka5y.29`'s evidence names three (an absolute
path, a `git -C` into the shared checkout, a `cd` that walks out), but a worktree here
lives at `<repo>/.claude/worktrees/<name>`, so `../../../lib/server.js` is that same
shared checkout by another name; so is a redirection target attached to its operator
(`>/etc/x`, which is one token, not two), and so is a path riding on an option
(`--git-dir=/repo/other/.git`), and so is one built out of a variable (`"$HOME/.ssh"`).
Each of those is resolved and checked, and a refusal by one spelling and a pass by
another would make the guarantee worth nothing.

Two things keep that from being a `/`-shaped regex that refuses honest work:

- **A program text is not a filename.** `sed -i '' '/^debug/d' f.txt`, `awk '/^foo/
  {print}'` and `grep '/api/v1'` all hand a leading `/` to a command whose first operand
  is an expression — and refusing those refuses `bc-ka5y.19`'s `sed` loop, the case this
  command exists for. `EXPRESSION_COMMANDS` names that handful of commands and where the
  expression sits. The exemption is one *quoted* operand and no wider: it lapses when a
  `-e`/`-f` says the operands are files, an unquoted `/etc/passwd` in the same position is
  a path again, and every other token on the line — redirection targets included — is
  checked as usual.
- **Two spellings of one directory are one directory.** macOS puts `/tmp` behind a symlink
  to `/private/tmp`, and the two things `--allow` exists for are exactly the two most
  likely to disagree about it: `mktemp -d` prints `/var/folders/…` and a session
  scratchpad is `/private/tmp/claude-501/…`. Containment is tried textually first and then
  with both sides run through `realpath`, which only ever widens what is allowed — a root
  or target that does not exist yet (the `mkdir -p` case) falls back to the textual answer.

It is a heuristic over the script's *text*, not a sandbox — it does not stop a script from
doing something destructive *inside* the roots it is given, and a target built from a shell
variable (`cd "$SOME_VAR"`, `"$dir/f"`) cannot be resolved ahead of time, so it is refused
too, on the same "cannot verify where it goes" reasoning, rather than waved through as a
false negative. Nothing is auto-allowed beyond the roots given and a handful of special
files (`/dev/null` and its siblings) — a `mktemp` directory needs its own `--allow`,
exactly as the acceptance criteria asks for, because a session's scratch directory changes
every run and this cannot guess it. `--allow` and `--cwd` require a value that is not
itself an option, and an unknown flag is refused rather than taken for the script path,
because `--allow --dry` silently *running* the script is the one failure this command
cannot have.

A refusal names the line and the path that leaves the roots, not just an exit code:

```
b7e-sh: refused — line 2: git -C leaves the allowed roots (/Users/…/beadcause)
  git -C /Users/…/beadcause status
```

`b7e-sh` is deliberately **not** on `lib/toolbelt.js`'s `DEFAULT_TOOL_LIST`, for the
`b7e-call` reason rather than any read-only one: it hands whatever script or `-c` string
it is given to `bash`, so there is no fixed argv shape to point at as "this is a read" —
the whole point of the command is that it reaches whatever the caller points it at.
`dispatch`, the one agent that list governs, has no branch and no oversight loop past its
own single `bd comment`; granting this there would let a one-shot comment-answerer run an
arbitrary shell script against a tree it does not own. See `bin/b7e-sh`, `lib/shguard.js`
and `test/b7esh.mjs`.
