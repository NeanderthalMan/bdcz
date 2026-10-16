### Which of these commands answers this question — `b7e-which`

`bc-dgx7.65`, filed by the session audit against five sessions (`bc-9ntye.6`,
`bc-19vt.1`, `bc-dgx7.52`, `bc-dgx7.53`, `bc-9ntye.3`) that each needed one of the
thirty-odd `b7e-*` commands and went looking for it a different way — `ls bin/ | grep
-i "gate\|parallel"`, a memory lookup, opening files cold to learn what one did — and
three came away with a name and no idea what it answered. Every command already carries
the answer: its own docblock opens with the question it exists to answer,
`lib/toolbelt.js` carries a prose comment beside its `DEFAULT_TOOL_LIST` entry (or says
why there is none), and `README.md` has a `### ` section naming it. Three registries,
and nothing before this read any of them to answer "which one do I want."

```
b7e-which                       the whole index, all commands, sorted by name
b7e-which "run the whole suite" ranked matches — b7e-gate above b7e-gates
b7e-which flaky                 a bare word works the same way as a phrase
b7e-which --json                one JSON object per line instead of the printed report
b7e-which --dir <root>          another tree's bin/, README.md and lib/toolbelt.js —
                                 this is how it is tested
```

**Candidates are read off `bin/` itself**, the same union `b7e-enroll`'s own
`candidateNames` already uses (`package.json`'s `bin` map, plus any stray `b7e-*` file
under `bin/` that map does not point to yet) — so a command added in a branch and not
yet registered anywhere else still shows up here, which is the whole point of the
bead's own acceptance criteria: the index needs no edit of its own when a new command
lands.

**The question is the docblock's opening paragraph**, not just its first physical
line — most of the family wraps its intro across two source lines and stopping at the
first newline would hand back half a sentence. The paragraph ends at the first blank
comment line, or at the first usage-example line for a docblock with none. A
backtick-quoted `` `name` — `` prefix, where a docblock opens with one, is stripped;
roughly a fifth of the family does not open that way at all and its question is just
the paragraph as written. A docblock with nothing readable before its first blank line
or usage example is `malformed: true`, `question: null` — left out of ranked search
results, since there is nothing to score it against, but still listed in the bare
index, because "this command has no question to read" is itself worth being able to
see rather than something silently hidden.

**Ranking is plain word-overlap**, deliberately not fuzzy or stemmed: a query is
lowercased, split on words and stripped of a short stopword list, and each surviving
token is looked for as a whole word — in the name (split on `-`), then the question,
then the usage lines, then the rest of the docblock, the best tier per token summed.
Exact matching is what keeps a plural or a different inflection from scoring —
`b7e-gates`'s "gate runners" does not answer "the whole suite" just because "runners"
contains "run" as a substring, which is what keeps `b7e-gate` ranked above `b7e-gates`
for that query.

Exit codes: `0` always, whatever it found — a query matching nothing prints "nothing
matches" rather than failing, because no match is an ordinary answer, not a bad one;
`2` refused — bad usage, more than one positional argument, or `--dir` names something
with no `bin/` or `package.json` of its own. Read-only by construction in the same
sense `b7e-def`/`b7e-enroll` are: every path through it is a
`readFileSync`/`readdirSync` over `bin/`, `README.md` and `lib/toolbelt.js`, and it
never spawns a process or touches `bd`.
