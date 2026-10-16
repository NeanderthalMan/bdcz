### Before adding an import — is it exported, already here, colliding, or a cycle — `b7e-import`

`bc-ka5y.30` is the session audit: four beads (`bc-ka5y.15.8`, `bc-ka5y.15.7`, `bc-xl7n.93`,
`bc-36xx.18`) each edited an import block and answered the same five questions by hand, in
a different order, with a different tool, and different failures. `bc-ka5y.15.7` ran four
greps for `landedNewsEvents` and answered nothing until the fifth. `bc-xl7n.93` moved
`clearAbandonedLocks` and `STALE_LOCK_MS` out of `lib/commonrepo.js` and had to disprove
twelve `grep -rln` hits on `heldBy`/`held` by hand — every one a substring match, none of
them the identifier actually being moved. `bc-36xx.18` checked a name collision with
`node -e "import(...).then(...).catch(...)"` and two unrelated `SEVERITIES` exports that
took opening both files to clear.

```
b7e-import <symbol> --into <file>                  where <symbol> exports from, is it
                                                     already imported, where a new import
                                                     would land, any collision, any cycle
b7e-import <symbol> --into <file> --from <module>   disambiguate when <symbol> is exported
                                                     from more than one place
b7e-import --removing <symbol>... --into <file>     the other half: what dies in <file> if
                                                     these leave it, and who elsewhere
                                                     still references them
b7e-import --dir <root>                             "this tree" is <root>
b7e-import --json                                   one object instead of the printed report
```

**By identifier, not by text.** `lib/imports.js` reuses `lib/noundef.js`'s own
`scanFiles`/`SCAN_DIRS` and its acorn/`eslint-scope` pipeline rather than walking the tree
a second way with a regex. That is what makes the `heldBy`/`held` false positive
structurally impossible rather than merely avoided by a tighter pattern: `eslint-scope`
reports a *reference*, at a location, never a substring — `obj.heldBy` and the word `held`
are different `Identifier` nodes, full stop.

**Adding.** Answers, in one call: every file under `lib/`, `bin/` and `scripts/` that
exports `<symbol>` (named, default, or a re-export, each with its own line — a name
exported from two places is returned as two rows, never narrowed to a first guess); whether
`<file>` already imports it, and under what local name; the line a fresh `import` would be
appended at — one past the last existing import, because this repo's own import blocks are
not alphabetised (`lib/advocate.js`'s ~90 lines are in the order they arrived, not sorted),
so "where it belongs" is answered the way this tree actually answers it; whether the name
already names something else at `<file>`'s top level — a local `const`/`function`/`class`,
or an import of the same name from a *different* module than the one resolved above; and
whether adding the import would close a cycle — `<module>` already (transitively) importing
`<file>`, proven by walking relative imports the same way `lib/noundef.js`'s own scope walk
does, not asked of Node's module loader.

**Removing — the other half.** `--removing <symbol>...` takes names already declared at
`<file>`'s top level and reports what becomes dead if they leave: an import or a local
`const`/`function`/`class`, not itself among `<symbol>...`, every one of whose real
references sits inside the declarations being removed — the `fs`/`path` imports in
`bc-xl7n.93`'s own example, unused by anything left behind once `clearAbandonedLocks` and
`STALE_LOCK_MS` are gone. A binding with no references *before* the removal is not
reported; that is a pre-existing dead end, not one this removal causes. Alongside that,
every other file under `lib/`, `bin/`, `scripts/` and `test/` whose AST still contains an
`Identifier` named after one of `<symbol>...` — the cross-file check `bc-xl7n.93` did with
`grep -rln` and twelve false hits to disprove; a name declared in `--removing` but not
actually found at `<file>`'s top level is reported `missing` rather than silently answered
as "nothing depends on it".

Exit codes: `0` clean — nothing found that needs attention. `1` something does: the name is
exported from more than one place and `--from` was not given, a local binding already uses
the name, adding the import would close a cycle, the symbol is not exported anywhere in
this tree, or (removing) a name is not actually declared in `--into`, or something else in
the tree still references it. `2` refused — bad usage.

Read-only in exactly the same construction as `b7e-def` above: it only ever reads
`lib/`, `bin/` and `scripts/` off disk and prints what it finds — no `bd`, no `git`, no
subprocess. `Bash(b7e-import:*)` is on `DEFAULT_TOOL_LIST` beside
`b7e-def`, and `lib/grants.js` classifies it `read`.
