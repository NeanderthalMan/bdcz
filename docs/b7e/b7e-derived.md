### What in this tree is generated from the file I just touched, and is it stale — `b7e-derived`

`bc-dgx7.1`'s session audit, built for a repo that generates files from other files:
sessions each asked "what else in this tree is derived from what I just edited?" a
different way every time, or not at all until a gate went red over a number a generated
file pins.

```
b7e-derived -w myproject                                  the diff since origin/main, plus anything uncommitted
b7e-derived -w myproject docs/entries/sample-entry.md     one or more specific files instead
b7e-derived -w myproject --check                          run each generator's own --check mode, report staleness
b7e-derived -w myproject --rebuild                        run the generators whose sources actually changed
b7e-derived -w myproject --plan                           the order --check/--rebuild would run, and why each is on it
b7e-derived -w myproject --conflicted                     mid-merge: regenerate every conflicted declared artifact
b7e-derived --dir <root>                                  another tree — this is how it is tested
```

**The map lives in the checkout, not in this repo.** `lib/repoviews.js` already makes this
argument for `.beadcause/views.json`: a generator's path and the source globs that feed it
are a fact about *that* checkout at *that* revision, and belong in the commit that changes
them — not in a table here that would need a pull request to beadcause every time a repo
renames a script, and that would give every other workspace nothing until somebody wrote
a second one. So a checkout declares its own `.beadcause/derived.json`:

```json
{
  "generators": [
    {
      "id": "docs/build.py",
      "run": ["python3", "docs/build.py"],
      "check": ["python3", "docs/build.py", "--check"],
      "sources": ["docs/**"],
      "artifacts": ["docs/web/data.js", "reference/private/docs.admin.js"]
    }
  ]
}
```

`run`/`check` are an argv, never a shell string — same reasoning `lib/repoviews.js`'s
`runGenerator` gives for `views.json`'s own `data.run`: a filename with a space in it stays
a filename with a space in it, and a manifest cannot smuggle `; rm -rf` through one.
`sources` is matched with a small hand-rolled glob (`*` stops at a `/`, `**` crosses it,
everything else literal) rather than a dependency, because the shapes real generators
need — `docs/**`, `text/**/CHAPTER_*.md`, `design/*.sheet.md` — do not need more than
that.

**Never a shrug**, the same rule `lib/affected.js` states for its sibling question ("what
*tests* this file" rather than "what does this file *feed*"): a changed file matching no
generator's `sources` is reported on stderr under its own heading, not silently absent, so
"no generators cover this diff" can never be confused with "nobody looked."

**`--check` runs the generator's own check mode rather than re-deriving staleness.** The
repo's own convention (`build_series_log.py . --check`) already answers "is this stale"
without writing anything; this shells out to exactly that argv and reads its exit code —
`0` clean, anything else stale, with the last few lines of output as why. **`--rebuild`
is the one thing here that writes** to the checkout, which is why the file carries
`@grant excluded` rather than `read`: unlike plain listing and `--check`, it is not safe to
hand an unattended agent by default.

**Order (`bc-dgx7.139`).** Generators are not independent. A media chain is the case
that forced this: three builders each write a gitignored WAV or MP4 that `build_cut.py`
reads, and `build_cut.py --check` refuses outright if one of them was never built.
`--check` and `--rebuild` now run a plan (`--plan` prints it and runs nothing) built from
two kinds of edge:

- **`"after": ["<id>", ...]`** on a manifest entry, the explicit one: never run this until
  those have succeeded. An id no generator declares, or the entry's own id, is dropped
  and reported. A loop of `after` edges is a problem, and every ordered mode refuses
  (exit `2`) rather than pick an order the manifest itself calls impossible.
- **The implied one**: a generator whose `sources` match another's declared `artifacts`
  reads what that one writes. `build_cut.py` lists `mix.beds.wav` among its sources,
  so it waits on `build_temp_beds.py` without the manifest having to say so twice. A
  generator matching its own artifact (`docs/**` covers `docs/web/data.js`)
  does not wait on itself. If these edges alone loop, that stretch falls back to `after`
  plus manifest order, and stderr says so.

A generator joins the plan three ways, and the third column says which: a changed file
matched its sources; it is **`via`** a generator already on the plan (what it reads is
about to change); or it runs **`before`** one on the plan because one of its artifacts is
not on disk at all. An upstream generator whose artifacts are all there is left alone.
Under `--rebuild` a step whose prerequisite failed is **`skipped`** and never run. Under
`--check` a missing prerequisite is reported **`missing`** rather than checked (nothing is
built yet to check), and what waits on it is `skipped`. Both count as trouble (exit `1`).

**`--conflicted` (`bc-dgx7.139`).** Mid-merge, a generated file that conflicts should not
be resolved hunk by hunk: re-run its generator over the merged sources instead.
One session did this by hand for a generated bundle, then grepped for leftover markers
and for one literal from each parent. This mode does all of it. It lists
git's unmerged paths, maps each one that is a declared artifact to its generator (an
artifact ending in `/` owns everything under it), reads base/ours/theirs out of the index
*before* anything runs, and rebuilds in plan order. Then, for each file, it reports the
markers left and **each parent's own lines kept**: `ours 2/2 theirs 1/2`. A side's own
lines are the ones it added that neither the base nor the other parent has, because a
line both sides share proves nothing about either. A side that kept none of its own lines
is a failure. A conflicted path no generator declares is listed on stderr to resolve by
hand, and if one of those is a *source* of a generator that is about to run and still has
markers, that generator is `blocked` instead of run over a half-merged input. **Nothing is
staged.** `git add` is still yours, once you have looked at the result.

**On `DEFAULT_TOOL_LIST`: no.** `@grant excluded`, same shape as `b7e-rebaseline`'s
`--write` — the binary can write to a checkout it was not asked to write to, so it is not
on the list an agent gets without being asked for it specifically.
