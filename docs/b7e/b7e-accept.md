### Run the invocations a bead's own acceptance criteria quote — `b7e-accept`

`bc-dgx7.93`, filed by the session audit against five sessions (`bc-dgx7.81`,
`bc-dgx7.85`, `bc-dgx7.77`, `bc-dgx7.82`, `bc-dgx7.84`) that each carried a literal
`` `b7e-already time ago` ``-style invocation from their own bead's `acceptance_criteria`
field into `Bash` by hand, one call at a time, resolving the binary a different way
every session. `bc-dgx7.81`'s session made four separate calls for the three
invocations its own criteria quote plus the no-match case; `bc-dgx7.77`'s carried an
absolute worktree path as a shell variable through roughly ten calls because it never
entered its own worktree first.

```
b7e-accept -w beadcause -b bc-dgx7.81                run every invocation the bead's
                                                      acceptance_criteria quotes
b7e-accept -w beadcause -b bc-dgx7.81 --list         resolve and report only; runs nothing
b7e-accept -w beadcause -b bc-dgx7.81 --timeout 10   a shorter per-invocation deadline
b7e-accept -w beadcause -b bc-dgx7.81 --dir <root>   another checkout entirely
```

**What counts as an invocation.** Every backtick-quoted span in a criterion sentence is
a candidate, but only one whose first token — after stripping a leading `./bin/`,
`bin/` or `node bin/` — names a file that actually exists at `<root>/bin/<name>` is
treated as one to run: the same resolution rule `bin/b7e-run` landed for `bc-dgx7.87`,
never whichever copy `PATH` would find. A quoted file path, function name or comparison
tool (`` `grep "^export function"` ``, in `bc-dgx7.81`'s own criteria) stays inert
prose, exactly like a sentence that quotes nothing runnable at all. A candidate whose
text carries an angle-bracket placeholder (`` `<tool> 108 --at <commit before X
landed>` ``, `bc-dgx7.82`'s own case) is reported **not
runnable, verbatim** — never guessed at; inventing a value for it is exactly what that
session spent five calls establishing was impossible to do honestly.

**What counts as safe to run.** `lib/tooldecl.js` (bc-wbrhi) is now the only place a
`b7e-*` tool's own `@grant` decision lives — `lib/grants.js`'s `GRANTS` map carries no
`b7e-*` entry any more. So classification here reads the resolved target file's own
`@grant` line directly, not a derived registry computed over *this* checkout: a `--dir`
pointed elsewhere is judged by its own `bin/`. Anything not declared `@grant read` —
`write`, `excluded`, undeclared, or a `bin/` file with no `b7e-` prefix at all (the
write-shaped infrastructure scripts — `deliver.js`, `file.js`, … — which declare
nothing) — is refused and never executed. That is what lets `b7e-accept` itself carry
`@grant read` and sit on `DEFAULT_TOOL_LIST`: nothing it can be pointed at can make it
write.

`lib/accept.js` is the whole decision — extraction, placeholder detection, the
read/write classification — pure and tested without spawning anything
(`test/b7eaccept.mjs` drives it against a small fixture `bin/` it fully controls, the
same arrangement `lib/tooldecl.js`'s own suite uses). `bin/b7e-accept` is the argv shell,
the one spawn per runnable invocation and the printing. One block per criterion
sentence, in the order `acceptance_criteria` writes them: the sentence itself, verbatim;
then either the resolved command line, the exit code and the first ten lines of output,
or a one-line reason it did not run.

Exit codes: `0` every runnable invocation exited `0` and nothing was refused. `1` at
least one invocation ran and exited non-zero — a real acceptance failure, not a crash.
`3` nothing failed, but at least one criterion's invocation was refused — the run
completed; some criteria could not be verified this way. `2` bad usage, or
`acceptance_criteria` is empty — a legitimate, distinct state, not "ran and found
nothing wrong." `4` `-w`/`-b` named something this checkout's tracker does not have.
