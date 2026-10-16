### Search this repo's own files, with the roots and exclusions already decided — `b7e-grep`

`bc-4r10.21` is the session audit agent naming the same shape a sixth time: `bc-4r10.9`
(importers of `incident.js`/`vulnscan.js`), `bc-eqn1.2` (importers of `controls.js`),
`bc-4r10.1` (twice — "does anything on main reference `controls.js`"), `bc-ka5y.15.5`
(the seven `*Event` exports of `lib/news.js`), `bc-7wwbb` (`p0board`) and `bc-4r10.4`
(`gap`) each hand-wrote `grep -rn <pat> --include=*.js --include=*.mjs ...` by hand and
each got `(eval):1: no matches found: --include=*.js` — zsh glob-expands the unquoted
`--include=*.js` before `grep` ever runs, finds no file by that literal name, and kills
the whole command line with nothing on stdout to explain why. The six retries diverged
from there — one quoted the includes, one dropped them and listed `lib bin test scripts
android` by hand, one added an `--exclude-dir` chain, one switched to `--exclude=` on
filenames — and the root set was guessed differently every time: `bc-eqn1.2`'s quoted
retry ran from bare `.` and picked up `.claude/worktrees/epic-done-ka5y152/test/
servicescope.mjs`, a *live sibling worktree's own copy* of the files it meant to search,
which it then had to notice and discount by eye.

```
b7e-grep <pattern> [<pattern> ...]      OR'd together, ERE by default
b7e-grep <pattern> --in lib,test         only those roots
b7e-grep <pattern> --files               matching file paths only, like grep -l
b7e-grep <pattern> --count               a per-file count and a total, no lines
b7e-grep <pattern> --fixed               a literal string, not a regex
b7e-grep <pattern> -i                    case-insensitive
b7e-grep <pattern> --dir <root>          another tree — this is how it is tested
```

**Why this never hits the bug at all, rather than working around it better.** This never
shells out to a system `grep` and never builds a command line for a shell to reparse — it
walks the tree with `fs` and matches with a JS `RegExp` (`lib/repogrep.js`). So there is no
`--include`/`--exclude` flag here for an unquoted glob to break in the first place — `--in`
takes a fixed, closed set of names (`lib`, `bin`, `test`, `scripts`, `public`, `android`,
`readme`), never a pattern. Multiple patterns are matched as alternatives (OR), so a
caller never has to hand-build `(a|b|c)` or worry about one pattern's own `|` colliding
with another's.

**The roots and exclusions are fixed, not guessed per call.** With no `--in`, all seven are
searched; nothing under `node_modules`, `.git`, `.claude/`, `public/vendor`, `.coverage`,
`dist`, android's own `.gradle`/`build` output (the same three `.gitignore` already
excludes `android/` for) or the packaged `.apk`/`.apk.json` is ever walked into — so a
sibling worktree nested under `.claude/worktrees/` can never leak into a result the way it
did for `bc-eqn1.2`, and there is nothing left to discount by eye.

**Which tree "this repo" means is resolved from `cwd`, not from where the script happens
to live on disk.** `bin/` of the *main checkout* is on every agent's `PATH`
(`lib/foundation.js`), so the file that actually runs is always the main checkout's copy of
`bin/b7e-grep` — but `git rev-parse --show-toplevel` is run against the process's own
`cwd`, which is wherever the caller actually is. A session working inside
`.claude/worktrees/<name>` gets that worktree's own files, uncommitted edits included,
never the main checkout's regardless of which copy of the script executed.

Output is grouped by file: a `path (N matches)` header, then `path:line: text` for each
hit, then a total across every file. `--files` and `--count` narrow that the way `grep -l`
and `grep -c` do. A binary file (a NUL byte in its first 8000 bytes, the same heuristic
`grep` itself uses) is skipped rather than dumped as mojibake.

**On the shell footgun this replaces, and the one it cannot.** `--in`'s closed set of names
means a flag value can never be an unquoted glob here — that specific bug is gone by
construction. A *search pattern* that itself contains a literal `*`, `?`, `[` or `{` is a
different, unavoidable hazard: zsh glob-expands any unquoted word containing one before
any program — this one included — ever starts, and no CLI can requote an argument the
shell has already consumed. An ordinary pattern (an identifier, a path, a bead id — none
of the six sessions above needed a literal wildcard) never runs into this either way.

Exit codes: `0` at least one match, `1` none, `2` bad usage — an unrecognised flag, an
unknown `--in` root, or (without `--fixed`) a pattern that is not a valid regex.

**On the read-only surface**, the same `b7e-def`/`b7e-owes`/`b7e-affected` shape: it never
spawns a daemon, binds a port or runs a suite, only reads this repo's own source and prints
what it found. It says so itself — `@grant read` in `bin/b7e-grep`'s own header, which is
where `lib/tooldecl.js` reads it from since bc-wbrhi, so neither `lib/toolbelt.js` nor
`lib/grants.js` is edited to add it.
