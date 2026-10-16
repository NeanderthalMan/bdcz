### Take a bead a studio role is holding — `b7e-take`

`bc-dgx7.97`, built for a workspace whose beads are routed to named roles: `bd update <id>
--claim` refuses whenever a bead already carries an assignee, and when that assignee is a
role the bead was only *routed* to rather than a live session, sessions each spent three
round trips — refusal, memory note, the guarded write that works — before reading a line
of the repo.

```
b7e-take -w <workspace> -b <bead>              take it, or claim it plainly if unheld
b7e-take -w <workspace> -b <bead> --dry-run    decide and report; write nothing
b7e-take -w <workspace> -b <bead> --release    give it back to the role it came from
b7e-take -w <workspace> -b <bead> --json       the machine-readable form
```

`lib/bd.js`'s new `CLAIM_ROLE_GUARD_RE` / `claimedBy` name who a `--claim` refusal
says holds a bead — a third wording next to `CLAIM_GUARD_RE` and `REASSIGN_GUARD_RE`,
placed beside them as the bead asked. What bd's own wording cannot say is whether
taking the bead over is *safe*: a role and a real live session refuse in exactly the
same words. `lib/take.js` answers that by reading the calling checkout's own role
roster instead of guessing — every role the checkout's relay definition declares
(`.beadcause/relays.yaml`, else the config's `relays` entry), plus every directory
under the folder that definition's `profile` template keeps one per role in. No
beadcause convention names that folder; the definition does. A holder outside that roster — a real person, or a live window actually
working the bead — is refused by name, never taken on a hunch; a workspace that names
no relay reads back an empty roster and refuses every held bead, the conservative
default rather than a silent guess.

The take itself is atomic: `Bd.casAssign` (`lib/bd.js`) is `bd update <id>
--if-assignee <role> --assignee <actor> --status in_progress --add-label
taken-from:<role>` in one call, so the write only lands if the role was still the
assignee the instant it ran. That label is what `--release` reads back to hand the
bead to the same role it came from, and it is removed on release. A stale guard (bd
1.2.1's own exit 13, "precondition guard did not match") means somebody else won the
race between the read and the write — reported rather than retried, since retrying
would recompare the same expected value against the same now-wrong assignee and lose
the same way again.

**Not on `DEFAULT_TOOL_LIST`, despite the bead's own wiring checklist saying it
should be.** That checklist line is right for a read-only lookup (`b7e-def`)
and wrong for this one, for the same reason its closest sibling in
shape, `b7e-handback`, is not on it either: a reassign is a tracker *write*,
`DEFAULT_TOOL_LIST` is the read-only surface a constrained reply agent gets
(`lib/toolbelt.js`'s own docstring: "the read-only surface every reply agent gets"),
and the worker session this actually serves already has the Bash access to run it —
the same way it already runs `bd update --claim` itself, by the name it resolves to
on `PATH`. Adding it would hand a write to a reply agent the checklist was never
written with in mind.

`test/b7etake.mjs` drives all three of `lib/bd.js`'s claim-refusal wordings from a
fake `bd`: the new one (taking over a role-held bead), and the two existing ones
(`CLAIM_GUARD_RE`, `REASSIGN_GUARD_RE`) checked to prove the new pattern never
misreads either of them. Also covers the role roster read from a fixture relay
definition and its `staff/` folder, an unrecognised holder refused by name, `--release`,
`--dry-run`, and the CAS race. See `bin/b7e-take`, `lib/take.js`.
