### Where the tokens go, by the kind of session that spent them — `b7e-tokens`

`bc-bdjbs`, from Adam's question on 2026-11-07: "i wonder if the advocate is being visited too
often? can i get some metrics on how many tokens are used by each session, whether advocate
first visit or subsequent, merge conflict resolution, merge advocate, workers, etc etc? i'd like
aggregate metrics as well as on a per-effort basis".

```
b7e-tokens                     by kind, Epic Advocate first vs repeat visits, conflict repeats per PR, per effort
b7e-tokens --since 7d          only sessions started in the last 7 days (or --since 2026-11-01)
b7e-tokens --top 30            longer per-epic and per-PR tables (default 15)
b7e-tokens --kind worker       one kind's sessions, heaviest first
b7e-tokens --json              the whole summary as one object
b7e-tokens --json --sessions   one row per session instead
```

It reads every transcript under the `projects` directories `lib/transcript.js` `projectsRoots`
knows and writes nothing. **The kind comes off the brief's first line**: the sentence each
daemon-opened session starts with, the same signal `isWorkerLine` in `lib/claude.js` uses.

| kind | first line |
|---|---|
| `epic-advocate` | `You are the Epic Advocate for **<id>** in …` |
| `epic-worker` | `You are the **epic worker** for **<ws>/<id>**` (the planner) |
| `worker` | `You are working bead/epic **<ws>/<id>**` |
| `conflict-resolve` | `Get **#<pr>** mergeable again in …` (`openConflictSession`) |
| `merge-advocate` / `review-advocate` | `You are the MergeAdvocate/ReviewAdvocate for …` |
| `review-answer` | `You are the worker for **<id>** in …: pull request` |
| `filing-gate` | `You are deciding whether a bead a worker is about to file …` |
| `session-audit` | `# Audit N finished session(s) in …` |
| `handoff` | `Read handoff …` |
| `manual` | anything else, such as a window opened by hand |

**What the numbers are:**

- Usage is counted once per API response, not once per transcript line. Claude Code writes a
  response once for each content block, so counting lines would double it.
- Subagent transcripts are added to the session that spawned them.
- **weighted** is in input-token equivalents: cache read ×0.1, cache write ×1.25, output ×5.
  Those are the API's price ratios. About 95% of the raw count is cache reads, so only the
  weighted figure ranks kinds by what they cost.
- **First visit** is the earliest Epic Advocate session for that epic *still on disk*. Claude
  Code prunes transcripts after about 30 days, so this command only ever sees that window.
- **Per effort** groups sessions under the root epic of their bead (`dv-k4n.149` → `dv-k4n`).
  A conflict session counts toward an effort only when its PR title starts with a bead id.
- **Weighted spent on repeats** is every conflict-resolution session after a PR's first one.
