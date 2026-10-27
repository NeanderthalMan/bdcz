### Every place a sibling name is registered, and whether the new one is too — `b7e-enum`

`bc-dgx7.153` is the session audit agent finding the same question answered by hand four
times in one repo, none the same way. Four sessions (`dv-5eu.1.16`, `.17`, `.18`, `.20`)
each renamed or added a sibling to a closed set of registered kinds — `hide_shelter`,
`torch`, `atlatl`, a load form — and each rediscovered the same shape of survey: grep for
the old name, `sed` slices of the files it turned up, then a *second* grep for whatever
the first one missed. `dv-5eu.1.18`'s second grep failed twice on a zsh quoting mistake
before it found anything; `dv-5eu.1.20` only found a silently dropped registration on a
*third* pass, after the first two both read as "done."

```
b7e-enum <sibling>                    every registration site of <sibling>
b7e-enum <sibling> --new <name>       the above, plus present/missing of <name> at each site
b7e-enum <sibling> --dir <path>       another checkout, not this repo
b7e-enum <sibling> --ref <ref>        the tree as git saw it at <ref>, not the working tree
b7e-enum <sibling> --json             machine-readable
```

**One pass, not a grep-then-guess loop.** For every quoted occurrence of `<sibling>` in a
source tree, this classifies what kind of registration it is — a tuple/list/set member, a
dict key (or, printed separately, a dict *value*), an `==`/`===` comparison, or an
`in (...)`/`in {...}` branch — and names what it belongs to: the constant it hangs off
(`SET_TYPES = (...)`), the call it is an argument to, or, for a branch with no bracket of
its own, the nearest enclosing `def`. With `--new`, each site also says present or missing
for the new name, checked *at that site* rather than anywhere in the file: a bracketed
site asks whether the new name shares the exact same bracket, and a branch site asks
whether the new name has its own match under the same enclosing `def` — so a call can
answer "missing" at nine sites and "present" at the tenth without anyone re-reading the
diff to see which nine.

**Deliberately generic, not delmar-specific**, per the standing rule that this repo must
not know about a downstream project's shape (see `docs/b7e-tools.md`'s own history and the
memory note the bead cites). The acceptance criteria driving this tool happen to be written
against a Python pipeline, so the construct classification favours Python's tuple/list/set/
dict literals and `def`-scoped branches, but nothing in `lib/enum.js` reads a delmar path
or a delmar name; `--dir` (or `--ref`, read via `git ls-tree`/`git show` instead of the
working tree) points it at any checkout, including this one.

**What this does not parse.** A single character scan tracks string state, comment state
and bracket nesting — not a real parser for any of the languages it runs against, the same
tradeoff `b7e-def`'s own header documents for this repo's own sources. A single-line `#` or
`//` comment is invisible to it, matched as neither a registration site nor a prose
mention. The nearest-enclosing-`def` fallback used for a bracket-less branch is Python-only
by construction — indentation is what makes it possible to find without a real parser — so
the same shape in a JS/Go/Ruby file gets an empty enclosing name rather than a guess.
**Prose mentions are reported separately, never mixed into the registration sites**: a
README/`.md`/`.rst`/`.txt` file is scanned whole, word-boundary rather than exact-token, and
a triple-quoted Python docstring inside a code file is scanned the same way for its own
interior — both land in their own section of the output, under `prose mentions`.

`lib/enum.js` is the scan, the classification and the `--new` presence check; `bin/b7e-enum`
is the argv shell around it, the same split `b7e-siblings` and `b7e-section` use.

Exit codes: `0` every registration site found, and — with `--new` — every one of them
already has the new name too. `1` a real, non-error answer with something still missing: no
site found at all, or (`--new`) at least one site missing the new name. `2` bad usage. `3`
`--dir` does not exist, or `--ref` does not resolve.
