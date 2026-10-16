### One call for the bead, its family, its thread and what earlier runs left — `b7e-orient`

`bc-zjab.9`, filed by the same session audit as `b7e-call` above, against nine sessions
that each opened by hand-assembling the same four questions in a different order. Nine of
twelve spent a Bash call looking for a repo `CLAUDE.md` that does not exist, four of nine
never ran `bd comments` at all, and five never asked `beadcause-memory debriefs` — one of
them found out by hand, with five separate calls, that a previous attempt had already
written the entire change.

```
b7e-orient -w beadcause -b bc-zjab.9          the printed report
b7e-orient -w beadcause -b bc-zjab.9 --json    the same facts, machine-readable
```

One block, in the order a session actually needs it: the CLAUDE.md line, unconditionally
and first; the bead itself (status, priority, labels, assignee, acceptance); its comment
thread; its tracker parent and every sibling, each with status and holder; the epic plan
group that names this bead, if one does; and the debriefs any earlier run at this bead or
its family left.

**Three or four `bd` spawns, not one per bead.** The bead and its thread are one spawn
(`Bd.showWithComments`). The family — parent epic *and* every sibling, each with status and
holder — is a second: one `bd export` (`Bd.graph`, already cached a minute), parsed with
`lib/ancestry.js`'s `childrenFrom`. That is deliberate rather than `Bd.children`, which
narrows every row to id/title/status/type/priority and drops `assignee` — the raw export
row still carries it. The plan group is a third: `bd comments` on the tracker parent,
parsed with `lib/plan.js`'s `planFrom`, looking for a group naming this bead.

**The plan is not always on the tracker parent, and this bead is the reason.** `bc-zjab.9`
was filed by `lib/sessionaudit.js` with `homeLabel` routing (see "Filing a bead under a
parent" above), so its tracker parent is `bc-dgx7` — but the plan that actually names it
lives on `bc-zjab`, its `discovered-from` ancestor's own parent and its id's own dotted
prefix. So when the parent's comments carry no matching group and the bead's id has a
dotted prefix of its own, that prefix is tried too — a fourth spawn, and only then.
Debriefs cost no `bd` spawn at all: tier 4 lives in git refs beside the code checkout
(`lib/sessionlog.js`), read with `lib/memory.js`'s `debriefFamily`/`debriefBrief` — the same
selection the daemon's own worker brief already uses.

**`ws.dir` is never used for the CLAUDE.md check or the debrief read**, because it is the
*tracker's* directory (`~/beads/<name>/.beads` for a personal workspace) and never a git
checkout. `lib/session.js`'s `resolveSessionDir` is what both actually use — the same
answer `lib/foundation.js` computes for every worker session this daemon opens.

**`debriefFamily` narrows a bead with no tracker parent to itself alone** — a root epic, or
one this workspace never gave a home. `b7e-orient` says so plainly (`this bead has no
tracker parent, so only ITS OWN prior runs are covered here`) rather than let an empty
section read as "nobody has ever worked this family".

`Bash(b7e-orient:*)` is on `DEFAULT_TOOL_LIST` and `read` in
`lib/grants.js`, next to the other read-only surveys above: every path through it spawns
`bd show`, `bd export` or `bd comments` and nothing else. See `bin/b7e-orient` and
`test/b7eorient.mjs`.
