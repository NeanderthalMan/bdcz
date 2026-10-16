### The inside of an existing suite — `b7e-suitemap`

`bc-dgx7.85` is the session audit: five sessions (`bc-4jkjv`, `bc-3wf1r`, `bc-jjdar.2`,
`bc-mwhkg.2`, `bc-jjdar.1`) each added a check to a suite that already existed, and each
began by reading several hundred lines of it to learn the same three things — what the
fixture/loader helper is called, what the suite imports from the module under test, and
which named check to anchor the new one after — a different reading strategy each time.
`bc-mwhkg.2` read `test/homing.mjs` (532 lines) in three `sed` slices and then still
needed a `grep` for the exact anchor strings; `bc-jjdar.2` did `wc -l` on
`test/reporter.mjs` and then four separate `Read`s at guessed line numbers to find
`load`, `fire` and the acceptance-criteria section. `b7e-affected` already names which
suite covers a file, and `b7e-harness` prints the house shape for a brand-new one;
neither says anything about the inside of a suite that already exists, which is where
four of the five changes had to land.

```
b7e-suitemap test/apperrors.mjs        the suite, by path
b7e-suitemap --for lib/errors.js       resolve the suite through lib/affected.js first
b7e-suitemap test/apperrors.mjs --json machine-readable
b7e-suitemap --dir <root> ...          another tree — this is how it is tested
```

Three things come back, over an acorn parse of the one suite named — a real parse, the
same reason `lib/already.js` and `lib/imports.js` parse rather than grep, because a name
is a binding and a call is a call, not a string a regex might also find inside a comment.

**Imports** — every `import … from './x.js'` and every `await import(LIB('x.js'))` /
`require(PUBLIC('x.js'))`, resolved to a repo-relative path the same way
`lib/affected.js`'s `parseImports` resolves the helper-call convention — plus the one
shape neither that nor a plain import graph covers: a suite that loads the module under
test as *text* and runs it in a `vm` rather than importing it. `test/reporter.mjs` never
imports `public/report.js`; it does `fs.readFileSync(PUBLIC('report.js'), 'utf8')` and
runs the result in a hand-built `window`. That is reported as a `vm-source` import of
`public/report.js`, because it is exactly as load-bearing as an `import` for someone
about to change what that file exports.

**Helpers** — every other top-level declaration: the loader, the fixture builder, the
reset, with its signature and line. A loader that builds a `vm` context and returns an
object is expanded one level — the keys of its `return` — because the thing a caller
actually needs is often a property of what the loader hands back rather than a sibling
declaration next to it: `test/reporter.mjs`'s `load` returns `{ window, ctx, calls,
reports, fire, report }`, and `fire` is not declared anywhere else in the file.
`LIB`/`PUBLIC`-shaped path helpers are filtered out, the same helper-call convention
`lib/affected.js` reads for its own dynamic-import resolution — they are structural, not
a fixture a new check would call.

**Checks** — every call to this suite's own `check`/`ok`/`bad`/`fail`/`pass` binding
(whichever of those five it actually declares — the same five `HARNESS_MEMBER` in
`lib/harness.js` names), with a literal string title, in source order, grouped under the
nearest `/* --- section --- */`-style divider above it — the convention `test/homing.mjs`
and three hundred other suites already write in, just never printed back. What this
deliberately does not do: follow a per-file convenience wrapper (a suite's own
`is(name, got, want)` that calls `ok`/`bad` internally) back to the titles it passes
through — the alternative is chasing an unbounded per-file naming scheme, and the five
sessions this replaces all hit suites using the five-name convention, not a home-grown
one.

**`--for` resolves through `lib/affected.js`, then overrides its ranking with a more
precise read.** `findAffected` narrows the field to suites that match the target file at
all — but a dozen suites that walk every `public/*.js` file for an unrelated convention
check all "read its source text" just as much as the one suite actually written for it,
and `lib/affected.js`'s own text scan cannot see the `PUBLIC('report.js')` helper-call
convention at all (the literal it looks for is split across two calls) — so
`test/reporter.mjs` reaches its candidate list only as a directory-walker, the weakest of
its five reasons. `b7e-suitemap` parses every candidate suite with the same `mapSuite`
it uses for display, and an actual `vm-source`/`dynamic`/`static` import of the target
found that way overrides `lib/affected.js`'s text-based ranking outright. Only when no
candidate imports it directly does reason strength decide, broken by whether the
suite's own name is built from the target's before falling back to alphabetical.

Exit codes: `0` printed the map. `2` refused — bad usage (a suite path and `--for`
together, neither, or an unrecognised flag). `4` the named suite does not exist or does
not parse, or `--for` named a file nothing covers.

Read-only in the same construction sense as `b7e-already`/`b7e-answered` above: it
parses one file with acorn and writes to stdout, never spawning a process or touching
`bd`. Its header carries `@grant read`, which is what puts `Bash(b7e-suitemap:*)` on
`DEFAULT_TOOL_LIST` and classifies it `read` — `lib/tooldecl.js` derives both from `bin/`.
See `bin/b7e-suitemap`, `lib/suitemap.js` and `test/suitemap.mjs`.


