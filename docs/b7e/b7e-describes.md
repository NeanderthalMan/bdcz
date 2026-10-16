### Which paragraphs of the specification describe the code I just changed — `b7e-describes`

A change that alters what the code does owes the specification a matching edit, and finding
the sentences the change made false is the part nobody could ask for. `b7e-readme` answers
"where does this term live?" for a term you already have; the question in front of a session
that has just edited `lib/redbase.js` is "who has written about *this*?", and the only way to
put it was to guess a phrase and grep. Five sessions did (`bc-xl7n.162`, `bc-sj8k.1`,
`bc-rfnr.9.13`, `bc-sj8k.6`, `bc-y8k4.8`) and no two guessed alike: one ran a grep for
`lifts by itself\|green again\|mid-run\|in flight`, one searched a deliberately misspelt stem
(`andidate`) because it did not know whether the prose said *Candidate* or *candidates*, one
had its glob refused by the shell and retried against explicit roots. Each then read around
the hit with `sed -n`. That is three to ten calls to locate one paragraph, and the paragraph
that mattered was sometimes the one that never contained the phrase.

```
b7e-describes                           the diff since origin/main, plus anything uncommitted
b7e-describes lib/redbase.js            just this file
b7e-describes lib/redbase.js baseVerdict   narrowed to one top-level definition of it
b7e-describes --json                    the same answer as one object
b7e-describes --near 0                  drop the neighbours (default 10 per section)
b7e-describes --dir <root>              another tree's diff and specification
```

**What it starts from is the diff, and every name is a literal the diff put on the table.**
A changed file contributes its path — written in full or as the bare `redbase.js` prose so
often uses — or, for an extensionless `bin/` script, the command as it is typed, and every
alias `package.json` gives it. A changed code file also contributes each top-level
definition whose body the diff touched, read on the new side for what was edited and on the
**old** side for what was removed: a deleted function is the paragraph most certain to be
false. The changed lines contribute the `/api/…` routes (cut before a `:param`),
`BEADCAUSE_*` variables and `cfg.a.b` config keys they mention; a route in a comment is
ignored, since a comment describing a route does not register one.

**Plain English is not a name.** A function called `slug` would match every sentence that
uses the word, so a lowercase-only name matches only when the prose marks it as code
(`` `slug` ``, `` `slug()` ``); `baseVerdict` or `MAX_ATTEMPTS` is not a word anyone wrote by
accident and matches bare. A file's own plain-word locals (`cwd`, `root`) are never names at
all.

**One block per hit, and a hit is a paragraph, list item, table row, heading or code line**
— a bullet whole, a paragraph as the sentence that names the thing. Each carries
`file:line`, the innermost heading it sits under with that heading's anchor slug, the names
that matched and the text. Order is document order, `README.md` first and then each chapter
by line.

**The paragraph that is false without naming anything.** The `bc-xl7n.162` fix changed
`baseVerdict`. The prose that names it is one clause at `docs/landing.md`, and the bullet the
fix actually contradicted — "**And it lifts by itself.**", thirty lines up in the same
section — mentions neither the file nor the function. No literal in the diff finds it, and a
search that could would have to read the sentence. So every section holding a hit also lists
its nearest paragraphs that name nothing, one line each, nearest first, labelled
*neighbours* — not matches. It is a cue, not a finding: it puts the false bullet on the
screen next to the paragraph that named the code, which is where the reading was going to
happen anyway.

**A heading that leaves a document takes its links with it.** `bc-y8k4.8` rewrote a heading
and found its inbound anchors by hand, and `test/anchors.mjs` would otherwise have been the
first to notice. So each changed document is compared with its merge base: a heading whose
slug no longer exists is reported with the heading that replaced it (when removals and
additions pair up one for one) and every inline link still pointing at its old anchor — a
bare fragment or a `chapter.md` one — from any document in the set. A link inside fenced
code is not a link.

**A module no document mentions prints nothing and exits 0**, and every path through the
command is a read: the only subprocess is `git` (`merge-base`, `diff`, `show`, `ls-files`,
`rev-parse`) and nothing is written. Run from a worktree it reads that worktree's own
uncommitted edits, not the main checkout's.

**What it does not do.** Definitions are found by matching lines at column 0, as `b7e-def`
does, not by parsing JavaScript, so a template literal with an unindented `function` inside
it can end a definition early. A config key is seen only where the code spells it
`cfg.a.b`, `config.a.b` or `options.a.b`. And it finds prose that *names* the change; the
prose that merely became untrue by implication is what the neighbours are there to surface.

Exit codes: `0` an answer, including "nothing describes this". `2` refused — a file that
exists nowhere, an export the file does not define, a bad flag, or not a git repository.

`bin/b7e-describes` declares `@grant read`. See `bin/b7e-describes`, `lib/describes.js` and
`test/b7edescribes.mjs`.
