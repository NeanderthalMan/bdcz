### Where in README.md something belongs — `b7e-readme`

`bc-khoe.46` is the session audit agent naming the same shape a sixth time: six sessions
(`bc-b4fs.1`, `bc-ka5y.15.1`, `bc-dgx7.5`, `bc-y8k4.2`, `bc-xl7n.55`, `bc-mtdb`) each
hand-wrote four to ten greps against a file that is now over 24,700 lines, in a different
dialect every time, to answer the same three questions: which section, what line range,
what anchor slug. `bc-ka5y.15.1` lost a whole call to shell quoting (`(eval):1: no such
file or directory: /api/poll`) before landing on `awk -F: '$1>19290 && $1<19430'`.
`test/anchors.mjs` already validates the slug this produces; nothing before this found the
place to put it.

```
b7e-readme <term> [<term> ...]      the smallest section mentioning all terms
b7e-readme --for <path>             same, with a literal path as the one term
b7e-readme --anchor <slug>          reverse lookup: the heading that slug names
b7e-readme <term>... --sketch       only match inside a fenced ASCII sketch
b7e-readme <term>... --json         machine-readable
b7e-readme <term>... --dir <root>   another tree's README.md — this is how it is tested
```

**One term finds every section that mentions it — one row per distinct heading, in
document order**, which is what `--for <path>` is: a file or route name treated as the
one term. Multiple occurrences under the same heading collapse into a single row, so the
output is sections to consider editing, not a raw grep with duplicates.

**Two or more terms find the smallest heading whose whole subtree contains every one of
them — a lowest-common-ancestor search, not "the first heading that matches anything".**
That is the part a hand-rolled grep cannot do at all: `bind` is in the router's own
opening paragraphs (`a backend that binds in ~2s did not answer`) and `tailnet` is two
subsections further down (`whether the socket arrived over loopback from the router or
straight off the tailnet`) — no single line, and no single heading's own body, has both,
but `## The router — why you never restart it` is the smallest heading whose subtree does,
and that is the section a change touching both ideas belongs in. The document's own title
(`# Beadcause`, level 1) is never offered as that answer even when it technically
qualifies — "the whole README" is not a useful section to be pointed at. When no heading
at all contains every term, this falls back to reporting the nearest section per term
instead of insisting nothing was found: a set of terms that never shares a section is
still real information, and it says so before listing them.

**Every hit is flagged by what it fell inside**, because a fenced ASCII sketch, an `/api/`
table row and ordinary prose are edited three different ways. `--for /api/poll` finds the
HTTP API reference among its sections and marks that one `table`; ordinary text elsewhere
comes back `prose`. `--sketch` restricts matching itself to lines inside a fenced block
that carries a box-drawing, arrow or pictograph character (`│ ● ▾ ⚙ ⟳` and the like) — the
plain, language-tagged shell fences this file also uses do not count, so a term that only
shows up in a shell snippet finds nothing under `--sketch` even if it is right there on
the page.

Like `b7e-def`, `b7e-owes` and `b7e-affected` this is read-only by construction — it reads
`README.md` once per call and prints where things are — which is what put
`Bash(b7e-readme:*)` straight on `DEFAULT_TOOL_LIST` and `read` in
`lib/grants.js` beside the other three. `lib/readme.js` does the parsing and the matching;
`bin/b7e-readme` is the argv shell around it, and it is also where `test/anchors.mjs`'s own
slug function now lives — the two used to keep separate copies of GitHub's heading-slug
rule, which is exactly the kind of drift a repo this size cannot afford between a checker
and the tool that is supposed to get the answer right the first time.
