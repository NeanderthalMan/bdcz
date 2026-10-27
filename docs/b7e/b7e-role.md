### A relay role's whole operating contract, in one call — `b7e-role`

`bc-dgx7.77` names five sessions (`dv-5eu.1.1`, `dv-gr6.43`, `dv-gr6.41`, `dv-b5d.4.3`,
`dv-gr6.38`) that each opened a delmar department relay (lib/relay.js) by hand-slicing
the same three documents — `docs/STUDIO_CHARTER.md` (726 lines), `docs/APPROVAL_PIPELINE.md`
(445) and `ai-context/agents/<role>/<role>.md` — differently every time, and again at
every role change mid-run. `dv-gr6.41` `cat`'d the whole charter, blew the 42.5KB
tool-result cap, and recovered with three more `sed` calls; `dv-gr6.43`'s hand-cut slice
of `clio.md` happened to stop just short of the ruling that superseded the "Comet not
visible in northern latitudes until Day 36-42" rule it read instead — a role file four
sessions read that day, none against the correction. The same gap showed on the way out:
`beadcause-relay --next` rejected with exit 3 in four of the five sessions, each
discovering the legal handoff list from the refusal rather than being told it up front.

```
b7e-role -w delmar clio           the contract: one law, clio's own charter block, the
                                     role file in full, its output template, --next
b7e-role -w delmar clio --next    only the legal handoff targets
b7e-role -w delmar --all          the roster — every role, its department, its gate
b7e-role -w delmar clio --json    the same answer, structured
b7e-role ... --dir <root>          resolve docs and role files against <root> instead of
                                     the default — the workspace's own checkout
```

**Workspace-general, not delmar-specific.** Every path — the charter, the pipeline, a
role's own profile — comes off that workspace's `config.relays[name]` entry (`lib/relay.js`),
the same definition `beadcause-relay` and the relay brief (`lib/session.js`) already read;
`-w delmar` is only the first caller because it is the first workspace with one. The
roster (`rolesOf`) and a role's own department (`departmentOf`) are the same functions
the relay dispatch uses, so the two can never disagree about who is real.

**Finds the checkout on its own, the same way every other "which checkout is this
workspace" caller in this repo already does.** No `--dir` needed: the default is
`resolveSessionDir` (`lib/session.js`) — the pair `lib/advocate.js`, `lib/deploy.js`,
`lib/jiraingest.js`, `lib/mergesweep.js` and `lib/prboard.js` all already use, rather than
a hand-rolled path match. `cfg.workspaces[name].dir` is the *tracker's* directory
(`~/beads/delmar/.beads`), never the code checkout, and matching against it directly is
the mistake this repo's own memory warns the next `b7e-*` command off of; `resolveSessionDir`
is what actually answers "where is `delmar`'s code". Falling back to the cwd is what
keeps a relay session — which already opens there — working the same as before.

**The slicing is narrow on purpose, not a dump of either document.** `lib/rolecontract.js`
cuts exactly the role's own `####` block from the charter and the studio's one law
(`## 2. The one law`, wherever it sits) — never the ~700 lines of the charter around
them — and reads a role's declared output section out of its own file (`## Output
Format`, `## Outputs`, `## Output Location`; several role files declare none, folding
format into `Production Contract` instead, and that is reported as missing rather than
printed empty). The one thing not narrowed is the role file itself: it is printed in
full, because that is what the bead asks for and what a role change actually needs to
read before answering as it. A worked example inside a role file's own fenced code block
— clio's Output Format section is a report template that is itself written in markdown
headings — is blanked to plain text before the heading scanner runs over it, so the
example cannot be mistaken for a real section boundary and cut the template short.

**Every printed section carries its own source and line range**, so a disputed sentence
is checked against the file it came from rather than trusted — `docs/STUDIO_CHARTER.md:301-321`
beside clio's charter block, `ai-context/agents/clio/clio.md:1-164` beside the role file.
The `--next` roster is not a slice of a document, but it is still one specific,
checkable range of one specific file: it cites `lib/relay.js`'s own `rolesOf` function by
line, found by counting brace depth from the function's opening line rather than typed by
hand and left to rot the next time the function moves.

Exit codes: `0` every section resolved; `1` bad usage; `2` refused — no relay definition
for the workspace, or `--dir`/the cwd is not a directory; `3` `<role>` is not a role this
workspace's relay knows, mirroring `beadcause-relay`'s own exit code for the same fact;
`4` the role is real but something about its contract could not be found — the profile
file is not on disk, the charter has no block for it, or its file declares no output
section — everything findable is still printed, and `4` only says something is not.
`bin/b7e-role` declares `@grant read` in its own header, which is what puts
`Bash(b7e-role:*)` on `DEFAULT_TOOL_LIST` and classifies it a read in `lib/grants.js`
(bc-wbrhi derives both from that one line): it only ever reads the docs and profile a
workspace's own relay definition names, and writes nothing anywhere. See `bin/b7e-role`,
`lib/rolecontract.js` and `test/role.mjs`.
