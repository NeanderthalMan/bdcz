### Read a file as it is at another ref, without inventing a redirect — `b7e-show`

`bc-dgx7.72` names four sessions (`lm-3rn.12`, `lm-gr6.50`, `lm-gr6.48`, `lm-3rn`) that
each needed the other side of a branch — `Read` and `Grep` take a path, never a ref — and
each invented the materialising step by hand, differently. `lm-3rn.12` ran `git show
worktree-canon-audit-apply-b7e:reference/GEOGRAPHY_SUMMARY_TABLES.md > /tmp/branch_geo.md`,
got nothing back — the very next `ls` shows an empty directory — and only on retry used a
real scratch directory. `lm-gr6.50` tried a redirect plus a `diff <(git show …) …`, was
refused as too complex, and fell back to `git diff main -- <path>`. `lm-gr6.48` and
`lm-3rn` piped `git show origin/main:CHANGE_LOG.md` into `grep` from the main checkout, and
`lm-3rn` then looped that over four stranded branches. The failure mode that matters:
`lm-3rn.12`'s first attempt — a redirect that writes nothing because its target directory
does not exist — looks identical to a `grep` that legitimately finds nothing. A command
that refuses a path absent at the ref, instead of leaving an empty file, is the difference.

```
b7e-show <ref> <path>...                one openable copy per path, or exit 1 naming
                                         whichever ones the ref does not have
b7e-show <ref> <path>... --dir <root>   <ref>/<path> resolve against <root>'s repo, not
                                         the cwd's
b7e-show <ref> <path>... --diff         a unified diff of each path, ref vs. working tree
b7e-show <ref> <path>... --json         {hits, misses} instead of the printed report
```

`<ref>` is a single revision — a sha, a branch, a tag, `HEAD~3` — resolved with `git
rev-parse --verify`, never `b7e-at`'s wider `main...other` merge-base syntax: this reads
one file at one revision, not a set of commits. Presence is read from `git show`'s own
exit code, one call per path, never from whether a write landed — so a path absent at the
ref is named on stderr and nothing is written for it, and a `<ref>` that does not resolve
at all is caught before anything is built, leaving no scratch directory behind either. A
present path is materialised as a `Buffer`, never a string — `git show <ref>:<path>` read
with `utf8` would corrupt exactly the binary content `public/vendor`'s own bundles are —
under a fresh directory below `os.tmpdir()`, built lazily so a call where every path is
absent leaves nothing on disk at all. `--diff` skips materialising anything and prints
`git diff <ref> -- <path>...` directly. See `lib/show.js`.

Exit codes: `0` every path existed at `ref`; `1` at least one did not; `2` refused — bad
usage, `<ref>` does not resolve, or `--dir`/the cwd is not inside a git repository.

Read-only in the same construction sense as `b7e-def`/`b7e-which`: it only
ever reads a blob out of git's own object store and writes the copy under `os.tmpdir()`,
never inside this repo's own tree and never touching `bd`, so it is on `DEFAULT_TOOL_LIST`
in `lib/toolbelt.js`.
