# Config

## Config — `~/.config/beadcause/config.json`

| key | meaning |
|---|---|
| `owner` | what the agents call you. It goes into every agent prompt ("*<name>* is not at the keyboard", "*<name>* approves every bead before it exists"), the body of every pull request an agent opens, and the notes that land on a bead. Asked first by `npm run configure`; guessed from your git `user.name` (first word) when it has never been set |
| `actor` | the **base** of the byline every write this daemon makes carries (default `beadcause`). What lands on the bead is that string on its own, or `beadcause (carol@example.com)` once `me` says who this Mac is — an identical `beadcause` on six machines recorded which engineer did nothing at all. Display only: `--actor` is a field an agent can write anything into, and provenance is the `agent-filed` label. A signed-in browser overrides it per call with its own address. See [whose beadcause wrote it](operations.md#whose-beadcause-wrote-it--the-byline-on-every-daemon-write) |
| `me` | who this Mac's person **is**, in the tracker — the handle a question is addressed to, or a list of them for somebody who answers to two addresses (default `null`). Not the same thing as `owner`, which is what agents call you in prose. `null` means this daemon is everybody and every question rings it, which is what a one-Mac install has always done; set it only on a tracker more than one person reads, and set it per machine. See [Who a question is for](operations.md#who-a-question-is-for--me-and-the-for-label) |
| `port`, `host` | listens on `127.0.0.1` **and** the Tailscale IP only — never the LAN. The *address* is what gets bound; `baseUrl` is what gets handed out, and they differ on purpose |
| `baseUrl` | the origin every generated link is built from — the pairing QR, the APK code, every notification's click target and action button, the terminal's `wss://`. Maintained for you: `https://<host>.<tailnet>.ts.net:<port>` when there is a certificate to serve it, the Tailscale address over plain http when there is not, and moved between the two on its own. Set it to something else — a real domain, a proxy — and it is never rewritten. See [the URL you are given](operations.md#the-url-you-are-given-and-what-happens-to-a-phone-that-already-has-one) |
| `bdBin` | the `bd` binary (default: found on `PATH`). Set it only where discovery fails |
| `healthTimeoutMs` | how long `bin/router.js` waits for a *first* attempt at a backend to answer, in ms (default 20000) — a starting point, not a ceiling, since the router doubles it per attempt and remembers how slow this machine has proved to be. Lower it only in a test that needs the slow-start path reachable on demand |
| `drainMs` | how long a swap lets the backend it is replacing finish requests it already had before killing it out from under them, in ms (default 60000) — bc-xl7n.134. A parked long poll runs up to 55s and a board sweep has been measured past 65s, so raising this to outlast them is not the fix: a request DRAIN_MS forces off still open gets told to retry rather than treated as the daemon failing (see `bin/router.js`'s `retire`). Lower it only in a test that needs the kill reachable on demand |
| `tls.enabled` | HTTPS on the tailnet address with a `tailscale cert` certificate and a TLS 1.2 floor (default `true`). Loopback is never TLS whatever this says, and a tailnet without *HTTPS Certificates* enabled falls back to plain http with the reason in the log. Set from the HTTPS card on `/admin` rather than by hand — see [the switch on the Admin screen](operations.md#the-switch-on-the-admin-screen) and [HTTPS on the tailnet name](operations.md#https-on-the-tailnet-name) |
| `tls.name` | the name to get a certificate for, if not the MagicDNS name `tailscale status` reports (default `null` — ask). The protocol floor is deliberately not a setting |
| `token` | required on every `/api/*` call; regenerate by deleting the file |
| `auth.google.clientId` | the OAuth **Web application** client for this Mac (default `null` — sign-in off). All of this key, a secret and a non-empty `allowed` are needed before sign-in switches on at all — see [Signing in with Google](integrations.md#signing-in-with-google) |
| `auth.google.clientSecretFile` | where to read the client secret from. Default `null`, meaning `~/.config/beadcause/google-client-secret.key`. **There is deliberately no `clientSecret` field** — this file is committed to the git repo in that directory, so one there would be in a history a rotation cannot reach; any left over from an older version is moved into the file on load. See [rotating them](integrations.md#where-the-two-secrets-live-and-how-to-rotate-them) |
| `auth.google.allowed` | the addresses allowed in, case-insensitive. Empty — the default — means sign-in is off, because a login screen nobody can pass is worse than none |
| `auth.google.redirectUri` | the callback registered with Google. Derived from the certificate's MagicDNS name and normally left `null`; sign-in cannot switch on without one, because Google refuses a plain-http callback |
| `auth.google.sessionDays` | how long a signed-in browser stays signed in (default `30`) |
| `auth.google.enabled` | `false` turns sign-in off while leaving the rest of the block configured (default `true`) |
| `workspaceRoots` | where to look for trackers (default: `~/beads` and nothing else). A **container** root holds one workspace per subdirectory, which is what `~/beads` is; a root with its own `.beads` **is** one workspace, named after the directory it sits in, which is what a tracker living inside the repo it tracks looks like — `["~/beads", "~/northwind.dev/architecture"]`. Rediscovered on every start, so adding a root is the only edit and a workspace *created* under it later arrives on its own. Two roots reaching the same directory are one workspace; two workspaces that would share a *name* are refused with the second named in the log. Use this when the answer is "and look here too", and `workspaceDirs` below when it is one particular workspace. See [Where trackers live](#where-trackers-live--workspaceroots-and-the-two-shapes-a-root-can-have) |
| `workspaces` | auto-discovered under `workspaceRoots`, and **reconciled on every start** — entries whose directory has gone are dropped and new ones picked up, both logged. Renaming a workspace directory used to leave a stale entry that failed on every poll tick, silently hiding that whole workspace from the phone. Do not hand-edit this to add a workspace that lives elsewhere: an entry here survives only while its directory does, and one start with the checkout away drops it for good. Add a root, or use `workspaceDirs` |
| `workspaceDirs` | the workspaces the roots cannot answer for, keyed by name and empty by default — `{"northwind": "~/northwind.dev/architecture", "northwind.retired-20260812": null}`. A **directory** serves a workspace from wherever it actually lives (the checkout or the `.beads` inside it, `~` expands); **`null`** takes a name out of the list and keeps it out, which is the retired-tracker case and the one thing neither "drop what no longer exists" nor a root can say — and is what **Trackers** on `/admin` writes for you, Retire and Bring back being that key set and deleted, applied to the running daemon as well as to the file so nothing waits for a restart. Applied on every load rather than baked into `workspaces` once, so a named workspace comes back on its own when its checkout does. A name a root also turns up resolves to the one named here; a named directory that is not there is a logged warning, not a refusal. See [Where a workspace lives](operations.md#where-a-workspace-lives-when-it-is-not-under-beads) |
| `repos` | the checkouts **one workspace** may be worked in, keyed by workspace name — `{"northwind": {"root": "~/northwind.dev", "default": "architecture", "approved": ["architecture", "atrium-service"]}}`. Empty by default, and a workspace not named here costs nothing: it is one repo, as every workspace was before this existed. `approved` is a list you write and nothing discovers — a directory under `root` that is not in it resolves to nothing; `npm run configure` prints the tree with each repo's token for you to tick, which is not the same thing as approving one. Each repo's identity is the **service token** it declares in its own `config/config.yaml`, read from the checkout rather than restated here; `default` is the repo a bead carrying no token belongs to, and `tokenPath` / `tokenKey` override where the token is read from. A bead says which repo it is about by carrying that token as a `repo:<token>` label. `tidy` is a separate list of checkouts the worktree sweep visits **without** approving them for work — names under `root`, paths, or `"*"` for every directory under `root` that has a `.claude/worktrees/`; it needs no `approved` list and no service token, and the sweep's own gates (unlocked, clean, no live session, merged locally or by a MERGED pull request) still decide every removal See [Many repos, one workspace](#many-repos-one-workspace--the-approved-list-and-the-token-that-names-each) and [how a bead names one](#how-a-bead-says-which-repo-it-is-about--repotoken) |
| `edits.workspace` | which tracker a pass from [edit mode](navigating.md#save-files-the-pass) is filed into (default `null`). Null is not "none": it means the workspace whose sessions open in *this* checkout, because an edit typed into this screen is a change to this app whichever tracker's beads happen to be drawn on it. Set it only where that answer is wrong |
| `edits.root` | the standing P0 every pass lands under (default `null`). Null means found by its `edit-root` label, or created on the first Save — so an install that has configured nothing still files under a P0 that exists, without which nothing under it would be workable at all. Name one here to override that; a root named here and since **closed** is ignored rather than used |
| `requirements.corpus` | the directory holding the requirements YAML (default `null` — no corpus). A team that records acceptance criteria as requirement files in a repo of its own names that directory here, `~` allowed; its `*.yaml` files are read up to two levels deep. Null switches every requirement path off, which is every personal install — `GET /api/requirements` answers `{corpus: null}` rather than an error. The location is configured only, never derived from the repos this daemon knows about |
| `openSessions` | allow `POST /api/session` to open a Claude session on the Mac (default `true`) |
| `deploys` | what "deploy this repo" **is**, keyed per repo and empty by default — `{"beadcause": {"command": ["launchctl", "kickstart", "-k", "gui/{uid}/n12n.beadcause"], "restarts": true}}`. The one act after a merge that is never inferred: a repo with no entry is one beadcause cannot ship, said out loud, and its Ship opens a window on the Mac instead. `command` is **argv and never a shell line**, because this file is hand-edited and synced as a git repo. The key is a workspace name where the workspace is one repo and `<workspace>/<repo>` where it holds several — a bare multi-repo workspace names no checkout and is refused rather than resolved to the default one. Other keys: `restarts` (this deploy kills beadcause itself), `pull` (fast-forward first, default `true`), `rebuild` (artefacts, with `when` paths), `checks` (argv run against production by the [single-environment promotion driver](advocates.md#one-environment--the-single-environment-driver-and-why-the-collapse-is-in-the-lib), `{image}` is the commit deployed), `base`, `dir`, `launchAgent`, `graceMs`, `timeoutMs`. beadcause writes its own entry once, at startup. See [Deploying a repo](pull-requests.md#deploying-a-repo-when-it-says-how) and [why it is keyed per repo](pull-requests.md#a-deploy-is-a-fact-about-a-repo-and-a-workspace-may-be-forty-of-them) |
| `promoteDrivers` | which driver carries a repo's **promotion bead** with nobody at the keyboard, keyed per repo like `deploys` and empty by default — `{"beadcause": "single"}`. `"single"` is the [single-environment driver](advocates.md#one-environment--the-single-environment-driver-and-why-the-collapse-is-in-the-lib) (the repo's declared `deploys` entry, then its `checks`); anything else is a path to a driver module (absolute, `~/`, or relative to the beadcause checkout). Never inferred: a repo with no entry, or a bead whose repos name different drivers, is left alone and the reason is logged. The [unattended promotion sweep](advocates.md#the-daemon-carries-an-endorsed-promotion-bead-itself) only carries a bead in a workspace whose `autoShip` answer is yes. |
| `release.beads` | file a bead per merged pull request and close it when a deploy makes it live (default `true`). Only ever in a repo whose deploy beadcause can see the outcome of — a bead nothing could close is a chore invented rather than found. See [The release queue](pull-requests.md#the-release-queue--the-number-over-ship) |
| `release.seconds` | how often the queue is swept (default 300, floor 60). Slow on purpose: it is a `gh pr list` per repo when nobody has looked at the board recently, and its news keeps for five minutes |
| `release.armedSeconds` | how often the queue is swept while a settle window is open (default 30) — the expensive cadence, paid for only during the few minutes an hour a workspace is armed |
| `release.settleSeconds` | how long an [auto-ship](pull-requests.md#auto-ship--the-merge-that-does-not-wait-for-the-tap) waits before it fires, so four merges in ten minutes are one deploy (default 60) |
| `release.settleMaxSeconds` | the ceiling on that settle window, however much keeps merging (default 300) — what stops a repo merged into every fifty seconds from never deploying at all |
| `incidents.sev1`, `incidents.sev2`, `incidents.sev3`, `incidents.sev4` | what we said we would do about an error, in **minutes**, before one happened: `{ acknowledge, resolve }` per severity (defaults 15/240, 60/1440, 1440/10080, 10080/43200). Measured against bd's own `created_at`, `started_at` and `closed_at` — claiming the bead is the acknowledgement and closing it is the resolution. Setting one number leaves the rest, and neither can be set below a minute, because a zero would breach every incident at the moment it was filed. See [The severity, the clock, and the commitment](incidents.md#the-severity-the-clock-and-the-commitment-it-is-measured-against) |
| `incidents.escalateAt` | occurrences of one fingerprint before it escalates a severity level (default `10`). It can never reach `sev1`: that one means the process died, which is a fact and not a volume |
| `incidents.reviewFrom` | the severity at and above which a **resolved** incident owes a post-incident review (default `sev2`). See [The post-incident review](incidents.md#the-post-incident-review-and-the-loop-it-closes) |
| `incidents.vulnerabilityDays` | the remediation SLA for a dependency advisory, in days, by npm's own severity word (defaults critical 7, high 30, moderate 90, low 180). `info` is deliberately absent and gets no bead at all. See [Dependencies on the same clock](incidents.md#dependencies-on-the-same-clock) |
| `sessionDirs` | override where a workspace's session opens. Normally unnecessary — see Discussing a question on the Mac |
| `projectRoot` | set only if your shell derives `BEADS_DIR` from the working directory — a `chpwd` hook mapping `<projectRoot>/<repo>` to the `<repo>` workspace (default `null`). With it set, a session opens in the matching checkout and beadcause verifies a shell there really would resolve back to the same workspace |
| `fallbackWorkspace` | the workspace a shell **outside** `projectRoot` resolves to, if yours has one (default `null`) |
| `sessionPermissionMode` | `--permission-mode` for an opened session (default `auto`; `null` to omit the flag) |
| `sessionWindows.screen` | which display a workspace's window is made on: `largest` (default), `main`, or a 0-based index. Each workspace gets one window with a tab per session; see [One window per workspace](android.md#one-window-per-workspace--where-sessions-go) |
| `sessionWindows.stealFocus` | let the new tab keep the keyboard (default `false` — the keyboard is handed back to whatever app, window and tab had it) |
| `beadConsole` | allow the [chat session](android.md#the-chat-session--deciding-what-to-file) to open conversations and create beads (default `true`) |
| `consoleModel` | model for a chat-session turn (default `null` — whatever `claude` uses on its own; `"sonnet"` for a cheaper conversation) |
| `consoleTimeoutMs` | kill a chat-session turn that has been going this long (default 15 min) |
| `terminal` | allow the [in-app terminal](android.md#the-terminal--driving-a-session-from-the-phone) to open a real Claude Code session over a WebSocket (default `true`) |
| `terminalPermissionMode` | `--permission-mode` for a terminal (default `null` — inherit your settings; unlike `sessionPermissionMode`, you are sitting in front of this one) |
| `terminalIdleMinutes` | close a terminal nobody has been watching for this long (default 30; the clock only runs with no socket attached) |
| `terminalScrollbackBytes` | replayed on reconnect, so a locked screen misses nothing (default 256 kB) |
| `terminalMax` | how many terminals may be open at once (default 4) |
| `resumeAfterReboot` | reopen every Claude Code window a reboot killed, the next time the daemon starts with the machine (default `true`). What comes back is a restored transcript waiting at a prompt — `claude --resume` with no prompt behind it, so nothing runs and nothing is spent until you type. Bounded to one run per boot, to a daemon that came up *with* the boot, and to 12 windows. Also switches off the minute-by-minute register of open windows (`sessions.json`) the pass reads, and the status window it opens after a boot; see [a reboot takes every window at once](advocates.md#a-reboot-takes-every-window-at-once-and-every-conversation-comes-back) |
| `autoDispatch` | commenting spawns an unattended agent to reply (default `true`) |
| `autoDispatchExclude` | workspaces that never auto-dispatch — put shared trackers here |
| `autoDispatchTimeoutMs` | kill a dispatched agent after this long (default 10 min) |
| `autoEndorse` | beads an agent files itself arrive **endorsed** — workable, queued, launchable — instead of held for your tap (default `false`). The one policy default here that is the restrictive one, and the only one that needs a literal `true`: its worst case is an unattended session on work nobody has read. Set it **per [space](asking.md#spaces--keeping-work-out-of-your-evening)** rather than here; the P2 ceiling, `agent-filed` and the `discovered-from` edge all still go on either way |
| `autoEndorsePerWorkspace` | the same answer for **one workspace**, keyed by workspace name — `{"beadcause": true, "sorrel": false}` (default `{}`). Outranks the space, which outranks the global, and an absent name inherits. One of [six settings a space is the wrong unit for](asking.md#one-repo-may-answer-for-itself-on-the-six-settings-where-it-matters): "nobody but me reads this tracker" is true of one graph and not of the five beside it in the same space — and not of one checkout inside a workspace, which [stays the space's answer](#policy-stays-per-space-even-when-a-workspace-is-forty-repos). Set from the repo row on the [space details screen](asking.md#one-repo-may-answer-for-itself-on-the-six-settings-where-it-matters) |
| `autoMergePerWorkspace` | whether **one workspace's** workers merge their own pull requests, same shape and same precedence (default `{}`). It moves who presses merge and nothing else: a worker still waits for the checks and still refuses over a red one |
| `requireApprovalPerWorkspace` | whether **one workspace** needs an approving review first, same shape and same precedence (default `{}`). Only meaningful while its `autoMerge` is on — with that off, every delivery is already a question and answering it *is* the approval |
| `reviewRequiredPerWorkspace` | whether **one workspace's** merges wait for [an agent's review](landing.md#the-review-gate--nothing-reaches-the-merge-without-a-verdict) first, same shape and same precedence (default `{}`). A second gate in front of the queue rather than a substitute for your own: where `requireApproval` is also on, the agent's approval is necessary and not sufficient. **Leave it off in a repo where nothing is reviewing** — on, with no reviewer, is a queue that stops rather than one that waits |
| `autoShipPerWorkspace` | whether **one workspace's** merges run its declared deploy without waiting for **Ship**, same shape and same precedence (default `{}`). The setting this layer most needed: only one repo in a space of six here has a deploy this Mac can run, and saying so through the space armed the other five. An [epic may still override it in either direction](pull-requests.md#auto-ship--the-merge-that-does-not-wait-for-the-tap) |
| `trustChecksAcrossDownmergePerWorkspace` | whether **one workspace's** queue [judges a clean downmerge on the checks the branch already passed](landing.md#a-clean-downmerge-does-not-pay-for-the-gate-twice) instead of waiting for them to run again, same shape and same precedence (default `{}`, and empty here). The only one of the six that is a fact about a repo's *CI* rather than about who reads it: what makes it safe is the test job also running on the base. Ships empty on purpose — the arm it answers for only fires where GitHub enforces up-to-date branches, which no repo here does |
| `pr.enabled` | land finished work as [a pull request the worker merges](landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue) (default `true`). `false` puts every workspace back on the oldest ending — work the bead, close the bead. A workspace with no `gh` or no GitHub remote gets that ending anyway, without needing to be named |
| `pr.base` | what a PR is opened against and merged into (default `main`). In a workspace with an [approved repo list](#and-which-branch-its-pull-request-is-opened-into) this is the *fallback*, and each repo's own default branch is the answer |
| `pr.basePerWorkspace` | [the workspaces that merge somewhere else](#a-workspace-whose-integration-branch-is-not-main), keyed by name — `{ "<workspace>": "<branch>" }`; empty by default, because a workspace's branch is its own to declare. The setting for that workspace wherever `pr.base` would have been, so it still sits *underneath* a multi-repo workspace's per-repo answer and still loses to `--base`. A name that is absent, or a value that is not a branch name, falls through to `pr.base` |
| `pr.gateBaseLocally` | when the base reads red and **no local `b7e-gate` run covers that commit, the daemon takes one itself** — `b7e-detach` against a throwaway worktree checked out at the base sha (default `false`). The producer for the reading bc-3m8en wired: a green local run may already stand in for GitHub's answer about the base, and until this nothing made one, so it was a person or an unattended window — and because a run only ever covers one sha, the merge it unblocked invalidated it and the next tick filed a fresh P0 and opened a fresh window. One gate per merge *and* one session per merge. Off install-wide because it is eight to ten minutes of this Mac per base commit, and self-limiting where it is on: it fires only while the base is not green, so a repo whose Actions work never reaches it. At most one in flight, once per base sha, and the gate takes the ordinary machine-wide slot rather than jumping it |
| `pr.gateBaseLocallyPerWorkspace` | the workspaces that answer differently, keyed by name — `{ "beadcause": true }`, which is what ships, since that is the repo whose Actions minutes ran out, whose `b7e-gate` this is and whose queue was the one stopped. The setting for that workspace wherever `pr.gateBaseLocally` would have been; a name that is absent, or a value that is not a boolean, falls through |
| `pr.mergeMethod` | `merge` (default), `squash` or `rebase`. A merge commit because a squash-merged branch is never an ancestor of `main`, and the worktree cleanup will not remove a worktree that fails that test |
| `pr.autoMerge` | a delivery goes on the merge queue, which merges it once the checks report (default `true`). `false` stops it after opening the PR and makes the merge your tap, which is what every delivery used to do. A worker can choose the same for one delivery with `--review`. **A [space](asking.md#spaces--keeping-work-out-of-your-evening) overrides this either way**, so this is the default rather than the answer. Since bc-r941 the worker never merges under either setting — what this picks is which of the two things receives the pull request |
| `pr.requireApproval` | a pull request needs an `APPROVED` review before a worker may merge it (default `false`). Green but unapproved becomes a merge card saying so, rather than a merge — the setting for a repo other people work in. Per space, like `autoMerge` |
| `pr.reviewRequired` | [the merge queue holds a pull request until an agent has reviewed it](landing.md#the-review-gate--nothing-reaches-the-merge-without-a-verdict) (default `false`). Different from `pr.requireApproval` above and in series with it: that one is your own tap, this one is the ReviewAdvocate's verdict, and neither satisfies the other. The default is off because the gate *holds* — turning it on where nothing writes a verdict stops the queue on every branch at once. Per space and per workspace, like `autoMerge` |
| `pr.trustChecksAcrossDownmerge` | [a clean downmerge does not pay for the gate twice](landing.md#a-clean-downmerge-does-not-pay-for-the-gate-twice) (default `false`). On, a downmerge GitHub put in with no conflict, on a branch whose checks were already passing, merges on the same tick instead of waiting for a whole run against the base that just arrived — `MAX_DOWNMERGES` is 3, so a branch can otherwise pay three times over a diff that never changed. A conflict still gets a resolver and a branch that was not green still waits. Off by default because it takes bc-rcrt's risk deliberately: the run it skips is the one that catches two branches breaking the base together, and what makes that bearable is the same job running on the push to the base. Per space and per workspace, like `autoMerge` |
| `pr.mergeWaitMs` | how long a worker waits for its checks before handing the PR over instead (default 15 min — the suite takes about five on a runner). A PR is at its most pending the second after it is opened, so without this a repo with CI would ask you about every delivery |
| `pr.tidyMerged` | let the worktree sweep ask GitHub whether a branch's PR merged, since a squash-merge never makes it an ancestor of main (default `true`; belt beside `mergeMethod`'s braces) |
| `advocates.enabled` | the whole feature's off switch (default `true`). `false` turns every advocate off, whatever `workspaces` says, and the console draws no switch to say so — see [Which repos have one](advocates.md#which-repos-have-one-from-the-console) |
| `advocates.workspaces` | which repos get an [advocate](advocates.md#advocates--an-agent-per-repo-whose-job-is-the-queue-reaching-zero). **Empty by default**; `["*"]` for every one. Also [a switch on the console](advocates.md#which-repos-have-one-from-the-console), which writes this list and reconciles the running daemon — but not while it is `"*"`, which has no list to take a repo out of |
| `advocates.maxWorkers` | sessions one advocate may have open at once (default 1), clamped to `maxWorkersLimit` |
| `advocates.maxWorkersLimit` | the ceiling that clamps it (default 3). A larger `maxWorkers` is clamped **and logged**, never silently applied |
| `advocates.globalMaxWorkers` | across every advocate (default 20, hard ceiling 36), so six repos can't open eighteen windows. A stepper at the top of the advocates console, so this one needs no restart; a stored 10 from an older install is moved to 20 once. Since bc-29b3 it is **every unattended window on this Mac**, not only the advocates' — a [conflict resolver](pull-requests.md#and-the-mac-has-one-window-budget-not-two) comes out of the same number |
| `advocates.maxResolvers` | how many [conflict resolvers](pull-requests.md#and-the-mac-has-one-window-budget-not-two) the pull-request sweep may have open at once (default 2, hard ceiling 6). **Inside `globalMaxWorkers`, not beside it**: a resolver is the same kind of window as a worker, so the two come out of one budget and this is only the most of it a sweep may take. It was a constant nobody could turn down until bc-29b3 |
| `advocates.maxEpicAdvocates` | how many [P0 advocate](advocates.md#what-a-p0-advocate-is--its-foundation-and-what-one-visit-consists-of) windows one repo may have open at once (default 3, hard ceiling 9). **Its own budget, and deliberately not part of `maxWorkers` or `globalMaxWorkers`**: a planning window is cheap, short and does none of the work, so rationing it against coding windows made the two compete and the cheaper one lose on a busy repo. Stepping the session limit does not change this number, and the roster says so where it draws it |
| `advocates.perWorkspace` | per-repo overrides, e.g. `{"sorrel": {"maxWorkers": 2}}` |
| `advocates.minPriority` | beads above this priority aren't work (default 3 — P4 is a backlog) |
| `advocates.propose` | ask to create beads when the queue empties (default `true`; **nothing is ever created without your approval**) |
| `advocates.proposeCooldownHours` | at most one ask per repo per this many hours (default 12) |
| `advocates.maxProposals` | the most beads one survey run may propose at once, clamped to 20 (default 5) |
| `advocates.proposeTimeoutMs` | kill the survey's child process after this long (default 10 min) |
| `advocates.settleSeconds` | how long a new bead sits before a session opens on it (default 60) |
| `advocates.launchCooldownSeconds` | the floor between two launches for one advocate (default 120), counted per **workspace** however many repos its windows are spread across |
| `advocates.workerTimeoutMinutes` | how long a session may hold its slot with no ending reached before the slot is released and the bead charged an attempt (default 120) |
| `advocates.checkinMinutes` | how long a session asked to check in has to answer before its slot goes back (default 10) — long enough for a turn in flight to land and run the command, short enough that pressing Reclaim sessions is worth doing at all |
| `advocates.lapseMinutes`, `advocates.maxAttemptsPerBead` | when an unclaimed window is treated as gone, and how many times one bead may be retried |
| `advocates.goneMinutes` | how long a worker's window has to be **missing** from Claude Code's live-session list before it is finished as `gone` rather than left to `workerTimeoutMinutes` (default 3). Then the slot comes back, the claim is handed back, **no attempt is charged** and the conversation is parked so the next dispatch [brings the same agent back](advocates.md#the-window-that-disappeared--and-the-conversation-that-comes-back-into-the-next-one) instead of briefing a stranger. Minutes rather than one tick because the evidence is an *absence*: one missed read is a list being rewritten, six in a row is a fact. `0` or `false` restores the two-hour wait |
| `advocates.maxResumes` | how many times one conversation may be carried over into a new window after its own **disappeared or was closed by the idle sweep** (default 1). The first one is an accident and is repaired for free; a *resumed* window that goes the same way is a pattern, so that one is charged an attempt and the next window gets the fresh brief. It bounds both because neither has anybody waiting in the loop — a `handback` or a `delivered` park is resumed because Adam did something, and cannot run away. `0` keeps both endings and never carries a conversation over |
| `advocates.neverStartedSeconds` | how long a window is given to get past line 3 of its command before [the launch's own temp files are read as proof it never started](advocates.md#the-window-that-opened-and-never-ran-its-command) (default 45). Then the slot comes back, the files are cleaned up, the claim is handed back and **no attempt is charged** — a launch that never ran is not an attempt at the work. Seconds rather than minutes because the point is answering before `workerTimeoutMinutes`; `0` or `false` asks nothing and restores the two-hour wait |
| `advocates.batchEpicChildren` | [hand an epic's ready children to one worker as a batch](advocates.md#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window), instead of holding the epic back and letting each child take its own window on its own tick (default `true`). `false` falls back to `heldByChildren`'s suppression, which is what this did before |
| `advocates.maxBatchBeads` | how many of an epic's ready children one worker is briefed on at once (default 5) — the overflow waits rather than racing its own siblings in a second window |
| `advocates.minBatchBeads` | the floor: below this many ready children an epic is never a batch head or a planner candidate, and a childless or single-child epic is dispatched as an ordinary ready bead instead (default 2) |
| `advocates.planEpics` | [open an **epic worker** on an epic rather than working it](advocates.md#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window) (default `true`) — a window that groups the epic's beads for N child-workers, writes each group's prompt, and does none of the work itself. `false` falls all the way back to handing one worker the epic and its ready children as a batch, which is what this did before plans existed and is still the right answer if a plan ever briefs badly. An epic whose planning has failed `maxAttemptsPerBead` times falls back to that on its own |
| `advocates.filePromotions` | file a **promotion bead** when every bead an epic's plan named has closed (default `true`) — one per epic, for the release through UAT and production, and deliberately not the [release queue](pull-requests.md#the-release-queue--the-number-over-ship)'s per-merge `ship` bead. It carries `promote` and `unendorsed`, and the epic is labelled `promoted` so exactly one is ever filed. "Closed" is read off the tracker's own rows and never off the queue — an `unendorsed` or dependency-blocked bead is missing from the queue exactly as a closed one is, and a bead no row can be found for is not closed (bc-4bet.2) |
| `advocates.respectQuietHours` | a quiet space's advocate watches without launching (default `true`) |
| `advocates.reenterAdvocates` | [re-open the **Epic Advocate** when something moves under a P0 it has already been on](inbox.md#the-advocate-that-comes-back--what-re-opens-an-epic-advocate-and-what-it-costs) (default `true`) — a descendant that closed, was filed, or has stalled. Enrolment is the bead itself: an epic is enrolled once it carries the [`advocate-assigned` label](inbox.md#the-tap-is-the-assignment--what-the-epic-carries-and-what-takes-it-off) *or* the advocate's waiting-on sentence, so the 🧭 button is what starts the loop and taking both records off is what ends it. `false` leaves exactly what this did before, which is a button and an agent told every run that it would be re-opened |
| `advocates.reenterIntervalMinutes` | how often that sweep looks (default 10). It reads the same cached `bd export` the inbox's epic board is built from — which the EpicAdvocate roster already warms every tick — so it costs no tracker call of its own |
| `advocates.reenterCooldownMinutes` | the floor between two *automatic* advocate windows on one P0 (default 180), alongside one window per tick per workspace. Nothing waits on an advocate — advocacy does not gate dispatch — so being three hours late costs nothing, where a Mac full of 🧭 windows costs real money |
| `advocates.reenterStallMinutes` | how long a descendant sits `in_progress` with no window on it anywhere and no live lease elsewhere before that is a stall worth waking a supervisor for (default 60). Half of `workerTimeoutMinutes`, which releases the *slot* and never asks the question this does: the slot came back and the bead is still claimed |
| `advocates.tidyWorktrees` | retire merged, clean, unlocked worktrees after a session ends (default `true`) — moved to `.claude/worktrees-retired/`, never deleted |
| `advocates.tidyIntervalMinutes` | how often it sweeps when nothing has just finished (default 15) |
| `advocates.tidyAtticDays` | how long a retired worktree stays in `.claude/worktrees-retired/` before the same sweep removes it for good (default 2). `0` keeps the attic forever, which is what this did before — and fractional values are honoured, so a removal rule can be rehearsed at `0.01` on a real attic |
| `advocates.reconcileLanded` | close beads whose pull request was merged **on github.com** rather than from a card (default `true`). Without it such a bead stays open, stays in `bd ready`, and the advocate opens fresh sessions on work already in `main` |
| `advocates.landedIntervalMinutes` | how often that asks GitHub (default 10). It also asks *unconditionally* right before opening a session, whatever this says — being late there costs a whole session |
| `advocates.askSuperseded` | [ask about a bead a worker marked `superseded-by:` another, once that other one closes](advocates.md#the-duplicate-that-comes-ready-the-moment-its-original-lands) (default `true`). Without it a marked bead is held out of every queue with nothing left to let it out again |
| `advocates.supersededIntervalMinutes` | how often that looks (default 10). Unlike the sweep above it is never forced before a launch, because a marked bead cannot reach one |
| `advocates.clearFarBlocked` | [clear a bead marked `blocked-by:` a bead in another tracker, once that far bead closes](advocates.md#a-blocker-in-another-tracker-which-no-edge-can-ever-draw) (default `true`). Unlike the sweep above this asks nobody — a far bead closing is a fact, not a judgement — so turning it off means a cross-tracker block never comes off on its own |
| `advocates.farBlockedIntervalMinutes` | how often that looks (default 10). Runs before the survey: clearing the marker is what lets a cleared bead reach the queue in the same tick |
| `advocates.flagInMain` | [ask about an open bead naming a `worktree-*` branch that is already in `origin/main`](advocates.md#the-bead-whose-branch-is-already-in-main) (default `true`). It never closes anything — a merged branch is a fact, "so the bead is done" is your call |
| `advocates.inMainIntervalMinutes` | how often that looks (default 10). It runs before the survey, so a bead it flags is out of the queue in the same tick and no session is opened on it |
| `advocates.flagNotInMain` | [file a finding about a **closed** bead whose own `worktree-*` branch never reached `main`](advocates.md#the-bead-that-is-closed-over-a-branch-that-never-reached-main) (default `true`). The one sweep here whose failure costs the work rather than a window. It closes, reopens, merges and pushes nothing: the finding is a new bead in the inbox, because a card on a closed bead is never rendered |
| `advocates.notInMainIntervalMinutes` | how often that looks (default 60). Hourly rather than ten-minutely because it is the only sweep that reads *closed* beads — half a megabyte of `bd list` — and spends a `gh pr list` per branch git says never landed. The follow-up that re-asks about cards already filed rides the same clock, for the same reason |
| `advocates.flagFinishedEpics` | give an epic whose children have **all closed** a card instead of a worker window (default `true`). The failure it fixes is a window opened on an epic with no diff left to deliver, whose only honest ending was a hand-written card anyway — this offers the same card for free, before the window opens. Like `flagInMain` it writes the `human` label *before* the survey two lines down, so the epic is out of the queue in the same tick rather than the next one |
| `advocates.finishedEpicIntervalMinutes` | how often that looks (default 10). One `bd ready --json` per repo plus one `bd list --parent` per epic it finds. An epic finishing is not an event anything else here watches for, so ten minutes is cheap relative to how rarely the answer changes. A sweep that throws is swallowed and recorded — it is a courtesy on top of the tick and may not take the advocate's queue down with it |
| `advocates.holdOpenPrs` | [hold a bead out of the queue while an open pull request already carries its work](advocates.md#the-bead-whose-work-is-already-in-an-open-pull-request) (default `true`). It closes nothing — an open PR is not a merged one — it holds, with the number on the card. Without it a worker briefed to merge is opened beside a resolver briefed that the merge is not its to make |
| `advocates.inflightIntervalMinutes` | how often that asks GitHub (default 5, shorter than the sweeps above because a delivery that could not merge opens a pull request and hands the bead back to `bd ready` in the same minute). It also asks *unconditionally* right before opening a session |
| `advocates.holdLiveSessions` | [hold a bead out of the queue while a live session already names it](advocates.md#the-bead-somebody-is-already-sitting-in) (default `true`). The claim is not the guard the brief says it is — "request changes" drops it, a timeout drops the slot, a restart forgets the worker — and without this a second window opens into a worktree somebody is still editing. No interval: the session records are files on this laptop, so it reads on every tick and again before a launch |
| `advocates.holdClaimedFiles` | [hold a bead out of the queue while another session on this Mac is editing the files it would touch](advocates.md#the-bead-whose-files-somebody-is-already-editing) (default `true`). The same register `scripts/claim-guard.sh` asks at `PreToolUse`, read at dispatch instead — where standing down costs nothing rather than a session that has already been briefed. No new state and no interval: the map is in this process |
| `advocates.holdGuessedFiles` | whether a surface *guessed* out of the bead's prose may hold as well, or may only say so on the card (default `false`). A declared surface is a forecast somebody wrote down; a guess is the daemon having read a description, and evidence that is a resemblance errs toward doing the work twice rather than not at all — the same way the twin filter does, and the opposite of the open-pull-request one |
| `advocates.holdCollidingSurfaces` | [defer a bead to the next tick when another bead this same tick is opening declared an intersecting surface](advocates.md#the-collision-that-has-not-happened-yet--two-beads-one-tick) (default `true`). The only file collision no register can see, because at the moment it is decided neither window exists. Declared surfaces only, whatever `holdGuessedFiles` says — a hold with a guess at both ends has no evidence at either end — and deferred rather than blocked: it keeps no state between ticks and there is nothing to release |
| `advocates.holdLeases` | [hold a bead out of the queue while another Mac has claimed it — the bead itself, or anything above or below it in the subtree — and stand down when a claim above one of our own windows wins](advocates.md#the-bead-another-mac-has-claimed) (default `true`). Inert until `me` is set, which is every one-Mac install — with no handle there is no label to write and nobody to lose to. The claim is a `held:<stamp>:<handle>` label rather than the assignee, because two labels are two rows Dolt merges rather than a cell it cannot, which is what lets both machines see both claims and agree on the winner without talking |
| `advocates.leaseMinutes` | how long one of those claims is good for (default 60, restamped at half that by whichever advocate still holds the worker). Not a load knob: it is how long a bead stays parked when the Mac holding it goes to sleep, and a bead parked forever is worse than the duplicate window this prevents |
| `advocates.sessionLog` | archive each finished session to `refs/beadcause/sessions/<bead>` and note its commits (default `true`) |
| `advocates.sessionTranscripts` | also store the raw Claude Code transcript — megabytes, and it carries paths and tool output (default `false`; set per repo in `perWorkspace`) |
| `advocates.sessionAudit` | [read those archives back when a session ends](advocates.md#the-agent-a-session-ending-starts--reading-the-archive-back-for-repeated-work), looking for work agents did by hand that a command should have done, and file each repeated shape as a held candidate bead (default `true`). `false` and nothing runs — the archives are still written, and nothing ever reads more than one of them |
| `advocates.sessionAuditEvery` | how many unread archives have to pile up before a run is worth its `claude -p` (default 5). Also what makes a run's input worth reading: one session at a time can only ever show a one-off, and a finding is a repeated shape |
| `advocates.sessionAuditCooldownMinutes` | the floor between runs whatever the arrivals (default 60), so a morning that finishes nine sessions does not become nine agents |
| `advocates.sessionAuditMax` | how many archived sessions one run reads (default 12, clamped 3–40). Every one of them is marked read afterwards, whether or not it contributed to a finding |
| `advocates.sessionAuditMaxAgeMinutes` | past this age the oldest unread archive is audited whatever `sessionAuditEvery` says (default a day, clamped 60–10080) — the backstop for a checkout that finishes a few sessions and then goes quiet, so nothing ever pushes the count over the threshold |
| `advocates.sessionAuditSweepMinutes` | how often the poll cycle asks every checkout whether that backstop applies (default 30, clamped 5–1440) — not the fast poll clock, since asking costs two `git` reads per checkout and a workspace can hold forty |
| `advocates.agentRepo` | which arm of the [tier 3 experiment](agents.md#tier-3--a-repo-one-agent-owns-and-the-experiment-that-is-the-point-of-it) each run of an agent that owns a private repo gets: `alternate` (the default) flips per workspace and agent, `blind`/`index` pin one, and `off` withdraws the affordance and the write grant with it. Named under `advocates` because the advocate was the first agent to have one; the Epic Advocate and the worker read the same key. `npm run agentrepo` is what reads the result back |
| `advocates.closeFinishedSessions` | [close a work session's window once the session has finished](advocates.md#closing-the-window--a-session-that-has-finished-should-not-still-be-on-screen) — the bead closed, a pull request delivered, or the bead handed back for a decision, and never an ending the daemon merely inferred (default `true`). `false` leaves every window open, which is what it did before |
| `advocates.closeGraceSeconds` | how long an idle session gets between reaching its ending and the first signal (default 90) |
| `advocates.closeHardSeconds`, `advocates.closeGiveUpMinutes` | how long `SIGTERM` gets before `SIGKILL` (default 45), and how long the whole thing gets before it gives up and leaves the window for you (default 30 min) |
| `advocates.sweepFinishedWindows` | [also close finished windows no advocate is holding a worker for](advocates.md#the-windows-nobody-is-holding) — the ones already open when the above shipped, and any left by a daemon that was down (default `true`). Only a name starting `QUEUED-`/`DONE-`, only a closed bead; `false` leaves your own windows where you put them |
| `advocates.sweepIdleMinutes`, `advocates.sweepIntervalMinutes` | how long such a window must have been idle first (default 20), and how often the sweep looks at all (default 5) |
| `advocates.closeEmptyWindows` | [close the iTerm windows that have no tabs left in them](advocates.md#the-windows-that-are-no-longer-windows) — the blank frames iTerm sometimes leaves behind when a session's last tab goes away (default `true`). There is no session in one, so this keeps none of the guards above; `false` leaves them on the desk for you to dismiss by hand |
| `advocates.parkIdleWindows` | [park a window this daemon opened once it goes quiet](advocates.md#parking--a-window-waiting-on-you-closes-and-your-answer-brings-it-back) — write its conversation down by session id, then close it, so an answer resumes the same agent rather than briefing a new one (default `true`). This is the one sweep that closes a window whose work is not provably anywhere else, so it has its own switch; `false` leaves them open and the resume never happens. `closeFinishedSessions: false` switches it off too |
| `advocates.parkIdleMinutes` | how long quiet is long enough (default 10). Minutes rather than the 90 seconds a *finished* worker gets, because here the ending is inferred from silence rather than proved by a closed bead |
| `advocates.parkHandIdleMinutes` | the same for a window Adam opened himself: a chat, a handoff, or a conversation brought back after a reboot (default 30, floored at `parkIdleMinutes`). These used to be exempt and were never closed. Adam resumes them by session id rather than reading them in place, so they close too, after a longer quiet because he may be reading one |
| `advocates.parkWorkerIdleMinutes` | how long the sweep yields to `reconcile` over a window whose worker slot the advocate still holds (default 20, floored at `parkIdleMinutes`). `reconcile` can name the ending where this can only say "it went quiet" — but it has no clock shorter than `workerTimeoutMinutes`, so without a bound here a worker whose ending it could not classify kept its window for two hours |
| `advocates.parkStuckMinutes` | how long a status that is neither `idle` nor `busy` may stand before it is read as stale rather than as a session doing something with no name here (default 60). It used to be `wait` forever, and a record only moves when its session does: one window sat four days in `shell`, holding a worktree lock, invisible to every sweep at once. `busy` is exempt — that is the status that means mid-sentence |
| `advocates.maintenance` | [the nightly maintenance window](advocates.md#the-nightly-window--stop-dispatching-empty-the-mac-collect-the-store): stop dispatching everywhere, let the open windows finish, close whatever is left, collect every workspace's Dolt store, resume (default `false`). **Off by default because it is the one sweep here that closes a window somebody may be typing into** — everything else in this table reads something. One line turns it on |
| `advocates.maintenanceAt` | when dispatching ceases, local wall clock (default `"03:00"`). A typo switches the window off and says so, rather than firing at midnight |
| `advocates.maintenanceDrainMinutes` | how long a window that is still working gets to finish on its own before it is forced (default 45). Forty-five rather than ten because a worker that has just been asked to wrap up has a debrief to write and a branch to deliver, and a grace period shorter than doing what was asked wastes the asking |
| `advocates.maintenanceMaxMinutes` | the outer bound on the whole sequence (default 120). Past it dispatching resumes whatever state the night reached — a session that will not take a signal must not leave a fleet that never dispatches again. The collection gets the last five minutes inside this bound reserved to it, so a Mac that never empties still gets collected |
| `advocates.maintenanceForceClose` | whether the drain may escalate to a signal (default `true`). `false` makes the window ask-only: it still collects, at the reserve, over whatever is still running — which is safe, because `bd` serialises a collection against other `bd` processes rather than racing them |
| `advocates.maintenanceCollectShared` | whether a workspace with a **Dolt remote** — a tracker shared with other people — is collected too (default `false`). The reason to stay out is that `bd gc`'s *compact* phase is not skippable: against bd 1.2.1 it is advisory and changes nothing, but if a later bd makes it squash for real, a nightly job would be rewriting a remote-backed database's history every night, which is the fork `bd migrate` refuses by default and calls "silent and unrecoverable". The skip is reported, never silent. On this Mac it is exactly one workspace — `architecture` |
| `agents` | extra reply agents beyond the four built in — `{id, name, emoji, description}`, plus `tools`/`model` if you set them by hand |
| `defaultAgent` | which one answers when you haven't picked (default `answerer`) |
| `agents[].tools` | the allowlist that agent may be *armed* with, for one reply at a time. Config-file only — see [Allow tools](agents.md#allow-tools--for-one-comment-and-only-that-one) |
| `agentToolsAcknowledged` | agents whose extended-tools warning you have accepted; written when you accept it |
| `spaces` | groups of workspaces sharing a notification policy — see [Spaces](asking.md#spaces--keeping-work-out-of-your-evening) |
| `accounts` | which of your lives the app is about — the level above a space, e.g. `[{"email": "you@gmail.com", "label": "Personal", "workspaces": [...]}]` (empty by default, and empty is off: every workspace is in scope everywhere, as before). Written from the phone (`POST /api/accounts`); nothing here is discovered or reconciled like `workspaces` is. See [Accounts](asking.md#accounts--one-life-at-a-time) |
| `relays` | department relays, keyed by workspace name — a bead whose **assignee** names a role there is carried through that department's whole check chain by one window, adopting each role's profile in turn and stopping at a review packet rather than at a merge. Empty by default — beadcause ships no relay; a workspace declares its own here or, better, in its repo's `.beadcause/relays.yaml`. `{}` turns the config half off. A department is stated as its `members` and its `check` list and the order is derived — draft, check, revise, file — so no chain can disagree with the table it came from. See [A department relay](advocates.md#a-department-relay--when-the-assignee-is-a-role-rather-than-a-person) |
| `approval` | each workspace's approval pipeline, keyed by name — `labels` (`review`, `gate`, `gatePrefix`, `draft`, `revisionPrefix`), `humanOnly` (the labels no agent may close on a merge; defaults to the gate and review labels) and optional `states` wording. Empty by default, and empty is dormant: no label holds a close, no card draws a ruling. Config-only — never a repo file. See [Where the ruling is](landing.md#where-the-ruling-is--the-second-axis-beside-the-pull-request) and [the one law](answering.md#the-one-law--no-agent-closes-a-gate) |
| `claudeSessions` | `false` to stop reading `~/.claude/sessions` for the session rows on the advocate console (default on; absent directory is not an error) |
| `claudeSessionsDir` | where those per-process records live, if not `$CLAUDE_CONFIG_DIR/sessions` or `~/.claude/sessions` |
| `claudeProjectsDir` | where session transcripts live, if not the `projects` folder of every `~/.claude…` directory. Takes a list. Governed by `claudeSessions` — off there means no transcripts either |
| `assetRoots` | the only directories `/api/asset` will read images from |
| `confluence.site` | your Atlassian Cloud site, e.g. `https://yourteam.atlassian.net`. Absent, [publishing](integrations.md#publishing-a-document-to-confluence) is off and no credential is read. Asked by `npm run configure`, where `none` here turns the whole integration off — see [setting it up](integrations.md#setting-it-up-without-opening-the-file) |
| `confluence.email` | the Atlassian account the API token belongs to — the two together are basic auth. Asked by `npm run configure` |
| `confluence.space` | the Confluence space a document lands in by default. A beadcause space may name another with `confluenceSpace`, or refuse with `confluenceSpace: false`. Asked by `npm run configure`; the per-space override is not, and is a config-file answer on purpose |
| `confluence.apiTokenFile` | where the API token is read from, if not `~/.config/beadcause/confluence.key`. A relative name resolves inside that directory. **The token itself is never a config field** — this file is committed after every write |
| `confluence.readSpaces` | the space keys an unattended agent may [read a page out of](integrations.md#reading-a-page-in--and-why-the-allowlist-is-empty-to-begin-with), e.g. `["ENG"]`. **Empty by default and does not inherit `space`** — the token that publishes can read the whole site, so an install that publishes still reads nothing until this names a space. Asked by `npm run configure`, where the question opens at `none` even on an install publishing into `ENG` |
| `jira` | JIRA per workspace, keyed by workspace name — `{"northwind": {"enabled": true, "email": "you@company.com"}}`. Empty by default, which is every workspace on **auto**: on exactly when its bd already points at a site (`bd config get jira.url`), off otherwise at the cost of that one memoised spawn. `enabled: true` is on whatever bd says; `enabled: false` is off and costs nothing at all. The site URL, the address and the project keys come from that workspace's own `bd config get jira.url` / `jira.username` / `jira.projects`, so a tracker that has ever run `bd jira pull` usually needs no setting at all; `url` / `projects` here override for a workspace whose `bd` was never pointed at JIRA. **There is deliberately no token field** — see [JIRA, per workspace](#jira-per-workspace--read-only-and-one-setting) |
| `jira.<workspace>.ingest` | `false` keeps the one-epic-per-ticket filing and skips the **reading**: no `claude -p` run per ticket, no children filed under the epic (bc-6s383). On by default. Worth setting for a space that wants the tickets as cards, because an ingestion is minutes and money per ticket and a first sweep queues one for every ticket at once |
| `jira.<workspace>.tokenFile` | where that workspace's API token is read from, if not `~/.config/beadcause/jira-<workspace>.key`. A relative name resolves inside that directory. The same option `confluence.apiTokenFile` is, and it opens the same hole: point it at a name that directory does *not* refuse and the log says so on every check |
| `jiraSeconds` | how often the daemon asks JIRA what is assigned to you (default 60, floor 15) — one HTTP call per workspace with JIRA on, one memoised `bd config get jira.url` per ten minutes for a workspace on auto whose bd points at no site, and **nothing at all** for one switched off. Beside `pollSeconds` rather than inside `jira`, because that block is keyed by workspace name and a number in it would be a setting for a workspace called "seconds". See [the tickets, on a clock](#the-tickets-on-a-clock--and-a-failure-that-is-never-an-empty-list) |
| `pollSeconds` | how often the daemon *sweeps* — one `bd human list` per workspace, plus a `bd comments` per conversation you are waiting on (default 30). A cost, not a latency: `detectSeconds` is what decides how quickly a change is noticed, and this is the backstop under it |
| `staleClaimHours` | how long a claimed bead may go untouched, with no live session, process or advocate window naming it, before the daemon comments and puts it back in the queue (default 72; `0` turns the sweep off). Three days rather than hours because the cheapest wrong answer is freeing a bead somebody is still on — see [a claim this daemon never made](advocates.md#and-a-claim-this-daemon-never-made--libclaimsweepjs) |
| `detectSeconds` | how often it asks *whether anything moved*, which is a ~150-byte read per workspace and spawns nothing (default 5). Setting it equal to `pollSeconds` turns the mechanism off and restores the single-clock cycle — see [noticing in five seconds](android.md#noticing-in-five-seconds--and-not-sweeping-to-find-out) |
| `agentLogRetentionMonths` | how long an archived agent run's **body** is kept, in months (default 24). Not a free number: 24 is `RETENTION_FLOOR_MONTHS` in `lib/evidence.js`, set from the report — a Type II window is twelve months and the report is relied on for about twelve months after issuance. **Raising it is a setting; lowering it is ignored**, because a shorter period is a disk decision with a retention rule written beside it. The chained record of each run is permanent either way. See [the run that survives its own reset](development.md#the-run-that-survives-its-own-reset--libagentarchivejs-testagentarchivemjs) |
| `strayHours` | how old a stranded headless Chrome or `beadcause-*` scratch directory must be before the daemon reaps it, in hours (default 24). **The number is the whole safety margin** — a browser check another session started thirty seconds ago is indistinguishable from one abandoned thirty seconds ago. Raising it is a setting; anything under an hour is raised to an hour, and `0` switches the sweep off, which is the only way to. See [the Chromes and scratch directories nothing was clearing up](advocates.md#the-chromes-and-scratch-directories-nothing-was-clearing-up) |
| `slowRequestMs` | a request past this is named in the log with where its time went (default `1000` — the page-load budget itself, so a line means "this missed the budget" rather than "this was slower than its neighbours"). `0` turns **the log** off and nothing else: the per-route figures behind `/api/timings` are always collected. See [timing every request](operations.md#timing-every-request--which-routes-are-actually-slow) |
| `sync.enabled` | keep a shared tracker shared — `bd dolt pull` then `bd dolt push`, per workspace, on a timer (default `true`). It is on for everybody and it does nothing at all on a workspace with no Dolt remote, which is every workspace until you add one. See [A tracker two Macs share](operations.md#a-tracker-two-macs-share) |
| `sync.seconds` | how often (default 120, floor 30). **Not a performance knob** — it is the width of the window in which two machines can act on stale information, which is why it is a setting and not a constant. There is deliberately no list of *which* workspaces sync: a Dolt remote is that list |
| `compliance.subjects` | whose compliance programme this install runs: `{ "<org-id>": "<absolute path to a subject file>" }` (unset by default, which reads as `{}` — there is **no default subject**, and the key is read only if set, so `lib/config.js` carries no `compliance` default for anything to flip). A subject file is the organisation's own record — the system boundary its SOC 2 report describes, its gap assessment rows, its service commitments — kept in that organisation's repository and read by `lib/boundary.js`. With none configured, `beadcause-boundary`, `beadcause-gaps`, `beadcause-description`, `beadcause-engagement` and `beadcause-recovery` say so in one line and exit 0; a file that is missing, unreadable or fails validation is reported by name and nothing from it is used. `~/` is expanded, a relative path is read against the config directory, and the file is read once per process. See [The system boundary](compliance.md#the-system-boundary-as-data--beadcause-boundary) |
| `publication.seconds` | how often the daemon publishes what this install can say about itself (default 3600, floor 60). It does nothing at all on an install with the management system off, which is every install by default. There is deliberately **no `publication.enabled`** beside it: a cadence is a setting, and whether an install with the layer on publishes at all is not — see [Publishing on a clock nobody has to remember](development.md#publishing-on-a-clock-nobody-has-to-remember--libpublishsweepjs-testpublishsweepmjs) |
| `monitor.enabled` | generate the LaunchAgent that opens the [activity monitor](operations.md#the-monitor--what-it-is-doing-right-now) at login (default `false`; `npm run monitor` works either way) |
| `sharedServer` | leave `false` — see the note below |
| `doltServer` | which trackers get their own per-project `dolt sql-server` instead of the embedded engine: `advocated` (the default — the workspaces an advocate works), `all`, or `off`. Four to seven times the read speed where an agent is making thousands of `bd` calls (111ms against 526ms for a `bd list`, measured on the real trackers), at ~90-400MB resident each while up; bd starts them itself, so a tracker nobody reads never runs one. Applied by `npm run dolt-mode`, which `npm run install-service` runs for you — see [Worth knowing before you rely on it](install.md#worth-knowing-before-you-rely-on-it) and `lib/doltmode.js` |
| `mirrorStateToBeads` | write `agent:<phase>` state labels into beads too (off — see Progress) |
| `ntfy.enabled` | the whole ntfy channel's on/off switch (default `false` — opt in with `npm run configure` or by setting it `true`) |
| `ntfy.server` | the ntfy server to publish to (default `https://ntfy.sh`) |
| `ntfy.topic` | the topic notifications are sent to (default: a random string generated on first run — anyone who guesses it can read your notifications, which is why `minimalWorkspaces` and `detail` exist) |
| `ntfy.detail` | `full` = question + option buttons in the notification; `minimal` = contentless nudge |
| `ntfy.minimalWorkspaces` | forced to `minimal` regardless — put shared/work trackers here |
| `ntfy.actionButtons` | answer straight from the notification (default `true`). ntfy allows at most 3 action buttons |
| `questions.settleMinutes` | after a workspace rings it stays silent this long, and questions arriving inside the window go out as one ring when it lapses (default `10`, capped at `120`; `0` rings every question as it arrives). Foundation requests are never held. See lib/held.js |
| `slack.enabled` | post questions to a Slack channel with a button per option (default `false`). Off until this **and** a channel **and** a bot token all exist — see [Slack](integrations.md#slack--the-same-decision-in-a-channel) |
| `slack.channel` | the default channel, as an id (`C…`) or a DM id (`D…`), not a `#name` (default `null`). Asked by `npm run configure`. A [space](asking.md#spaces--keeping-work-out-of-your-evening) overrides it with `slackChannel`, in either direction — `""` there means that space never posts — and that override is a row on the [space details screen](asking.md#space-details--every-setting-a-space-has-on-a-page-of-its-own) |
| `slack.excludeWorkspaces` | one repo that never posts, outranking its space. The same idea as `ntfy.minimalWorkspaces` |
| `slack.detail` | `full` = question + option buttons; `minimal` = a nudge with a link. Defaults to `full`, unlike ntfy, because a channel you named is not a public relay. Per space with `slackDetail`, which is a three-state row on the [space details screen](asking.md#space-details--every-setting-a-space-has-on-a-page-of-its-own) |
| `slack.buttons`, `slack.maxButtons` | answer straight from the channel (default `true`), and how many options fit in the row (default 5; the rest stay in the app, and the message says how many) |
| `slack.botTokenFile`, `slack.appTokenFile` | where the two tokens are read from. Default `null`, meaning `~/.config/beadcause/slack-bot.key` and `slack-app.key`. **There is deliberately no `botToken` or `appToken` field** — this file is committed to the git repo in that directory, and one typed in there aborts the next snapshot |
| `slack.apiBase` | the API root (default `https://slack.com/api`). No reason to change it on a real install — it exists so a suite can point it at a server it started itself |
| `slack.answerBase` | where a pressed button sends its answer (default `null` — this daemon's own API over loopback, `http://127.0.0.1:<port>/api/respond`). Deliberately not `baseUrl`, which is the tailnet name a phone is told and changes shape the day a certificate arrives |

`host` falls back to `127.0.0.1` if Tailscale was down when the config was
written — fix the IP in the file if the phone can't connect.

### JIRA, per workspace — read-only, and one setting

Turn JIRA on for **one workspace** and the tickets assigned to you start arriving, each
as a [beadepic](inbox.md#beadepic--the-word-on-the-screen-for-a-bead-epic) of its own.
There is nothing global and nothing team-wide about it: a workspace either has a JIRA
behind it or it does not, and the setting that says so is a boolean and an address.

```json
"jira": { "northwind": { "enabled": true, "email": "you@company.com" } }
```

**Usually not even that (bc-6s383).** A workspace with no block is on **auto**: on
exactly when its bd already points at a JIRA site, because a tracker somebody has wired
to JIRA has already answered the question the switch asks. The switch has three
positions and only a literal boolean is a decision:

| `jira.<workspace>.enabled` | JIRA is | costs, per workspace |
|---|---|---|
| `true` | on, whatever bd says | a read a minute |
| absent (or anything not a boolean) | on if `url` here or `bd config get jira.url` names a site, otherwise off | one `bd` spawn per ten minutes when off |
| `false` | off | nothing at all |

Auto keys on the site alone, so a workspace whose bd points at JIRA but which has no
token file yet is *on* and in trouble, and the sentence names both the file to write and
`enabled: false` — the person reading it never asked for JIRA there. That is the right
failure: the state it replaced was a JIRA-wired tracker whose assigned tickets never
arrived and nothing anywhere said why.

Keyed by workspace name, like `sessionDirs` and `advocates.perWorkspace`. It is
deliberately **not** a field on a `workspaces` entry: that array is discovered under
[`workspaceRoots`](#where-trackers-live--workspaceroots-and-the-two-shapes-a-root-can-have) and reconciled on every start, so anything written onto it by hand
disappears at the next restart — which would present as JIRA quietly switching itself
off overnight.

**Why one setting is enough.** `bd` already holds per-workspace JIRA configuration, and
if you have ever run `bd jira pull` in that workspace it is already there:

```
bd config get jira.url       ->  https://your-company.atlassian.net
bd config get jira.projects  ->  NW
bd config get jira.username  ->  you@company.com
```

Those live in the workspace's Dolt database rather than in `.beads/config.yaml`, so
they are read by asking `bd` rather than by parsing a file. Set `url` / `projects` in
the block above only for a workspace whose `bd` has never been pointed at JIRA. One
trap is worth knowing about, because it fails in the permissive direction: **`bd config
get` prints `jira.url (not set)` on stdout and exits 0** for a key nobody has set, so a
reader that trusts the exit code turns that sentence into a hostname. `bdConfig` in
`lib/jira.js` is the one place that knows.

**The token is the one thing that cannot be reused.** `bd` resolves `jira.api_token`
from the `JIRA_API_TOKEN` environment variable, which on a machine set up the usual way
is exported per-directory by a shell function in `~/.zshenv`. That is a *shell*
mechanism, and beadcause runs under launchd — a client expecting to inherit that token
would work in every hand-test from a terminal and authenticate as nobody in the only
place it actually runs. So it goes in a file:

```
~/.config/beadcause/jira-<workspace>.key       # 0600
```

The `.key` extension is the entire protection, and it protects by construction rather
than by anybody choosing well: `~/.config/beadcause` is a git repo that snapshots after
every write, and `*.key` is both on `lib/commonrepo.js`'s `FORBIDDEN` list and in the
`.gitignore` it writes. Exactly the reasoning behind
[`google-client-secret.key`](integrations.md#where-the-two-secrets-live-and-how-to-rotate-them) — a
secret in `config.json` is not merely on disk in the clear, it is in a history that a
rotation cannot reach back into. One file per workspace, because two workspaces may be
two JIRA sites with two accounts, and a shared credential would quietly authenticate
one of them as the wrong person. `tokenFile` in the block points somewhere else — a
relative name resolves inside that directory — and pointing it at a name the repo does
*not* refuse is the one way to put a JIRA token where it will be committed, which is
why the log says so on every check.

**A first configuration goes wrong in four ways** — no site, a site that is not a URL,
no address, no credential — and each one is reported as the fix rather than as the
symptom, because a 401 and a 404 are the same stack trace and completely different
mornings. Whatever JIRA itself said about a request is appended to that, never
substituted for it: `Field 'assigne' does not exist.` is precise about the query and
says nothing about which install asked.

**Nothing in this path ever writes to JIRA.** Not as a policy anybody has to remember:
`lib/jira.js` has no function that names an HTTP method and no code path that
constructs a request body, which is the same way `lib/lookup.js` enforces "GET only"
for an agent's network grant — a caller cannot reach a write by passing a flag, because
there is no flag. Making beadcause write to JIRA would mean *adding* the capability,
which is the point at which somebody has to decide it, explicitly and with an
allowlist. `node test/jira.mjs` asserts both halves against the module's own source —
which is why the `method: 'GET'` literal stayed in `lib/jira.js` when the request itself
moved into `lib/atlassian.js`. A shared module that named the verb would have left that
assertion green and vacuous, and a read-only guarantee that has stopped guaranteeing
anything is worse than none.

### The tickets, on a clock — and a failure that is never an empty list

Switching JIRA on for a workspace is the setting above; `lib/jirapoll.js` is the thing
that then actually asks, every `jiraSeconds`, and holds the answer where the inbox, the
epic filed per ticket and the ticket view can all read it without a second call.

**One query, and it is not a parameter.**

```
assignee = "you@company.com" AND resolution = EMPTY AND statusCategory = indeterminate AND project in ("NW") ORDER BY updated DESC
```

The project clause appears only for a workspace that has projects. `resolution = EMPTY`
rather than `status != Done` because every JIRA site renames its statuses and none of
them renames the resolution field — a status-name query is one that works on your site
and silently returns nothing at the next company. **And only what is in progress**
(bc-6s383): a site need not set a resolution at all — the one this was measured against
did not, and well over half the tickets the resolution clause alone answered were
finished — and most of the rest were New, backlog, Blocked or Shelved. Each arrival
is a P1 beadepic, so the query takes only the ones being worked: `statusCategory =
indeterminate`, JIRA's fixed key for the *In Progress* bucket. A category is not a
status name — every status belongs to one of three fixed buckets that no site can rename
or add to — so the argument above still holds. A ticket that leaves the bucket for Done
is resolved as far as the resolved sweep is concerned (it reads the category too), and
its held beadepic closes; one that goes back to To Do or Blocked is left alone, and
found again by ref if it comes back. And the JQL is written in that module
rather than accepted from a caller: `search()` will issue whatever string it is given,
so the defence against beadcause growing a general JIRA query surface is that there is
nobody who can name one. Something that wants a different slice adds a named query
there, where it can be read and argued about.

**The second named query, for a site that will not search by an address.** Atlassian
Cloud hides user emails on GDPR-strict sites, and on those the query above is refused
with a 400 rather than matched against nobody — so the whole feature would read as a
permanent configuration failure on a site that is working exactly as intended. The
fallback is `assignee = currentUser()`, which asks the same question of the account the
token belongs to, and it is used **only after `/rest/api/3/myself` has confirmed that
account is the address the block names**. Without that confirmation it would quietly
answer with a different person's tickets the day somebody points the block at a
colleague, and an epic gets filed from every row this returns. It costs one extra call
once per site, and the answer is remembered.

**What a held ticket is:** key, summary, status, updated, url, assignee, and the
workspace it came from — carried to the inbox as `tickets`, each row stamped with the
space its workspace belongs to (the inbox filters on that before it looks at anything
else, and it is how a quiet space's tickets are as quiet as its questions). Deliberately
enough to draw a row without a second call, and
deliberately no description body — the ticket view fetches that when it is opened, which
is the one place it is read and the only place its size is worth paying for. The `url`
is `/browse/<key>`, not the REST URL the payload carries, which is a link that lands a
phone on a page of JSON.

**A workspace with no `jira` block costs nothing at all** — not a network call, not a
`bd` spawn, not a cache entry. Most workspaces on any machine are that workspace, so a
poller that costs "almost nothing" for one costs the size of your `~/beads`. What the
configured ones cost is bounded too: `settingsFor` is up to three `bd config get`
processes, which on a one-minute timer would be three spawns a minute forever for a URL
that changes never, so the **`bd` half** of the resolution is held for ten minutes. The
token is re-read every sweep, because writing that file is how JIRA gets switched on and
a cached "no credential" is a problem reported ten minutes after it was fixed.

**And a failure is never an empty section.** This is [the sweep
record](inbox.md#a-repo-that-could-not-be-read-says-so-instead-of-looking-empty)'s argument applied
to a third kind of read: the tracker can be perfectly readable while the token is
expired, the site has been renamed or the wifi is down. So the JIRA read gets a
`createSweep` channel of its own — the last good answer stands in for a missing one, and
the workspace is named, with JIRA's own reason, in the trouble list the inbox already
draws. A workspace that is switched *on* but not configured is trouble too, not silence,
because the alternative is a section drawing nothing while somebody waits for tickets
nobody was ever going to ask for. A workspace that is switched *off* is silent, which is
what off means. The record rides two fields: merged into `trouble`, so the banner that
exists draws it with no client change, and unmerged in `jiraTrouble`, because
`mergeTrouble` keeps one row per workspace and a Dolt lock arriving a second later would
otherwise hide an expired token behind a failure that clears itself.

**A sweep that moved emits, and a sweep that did not says nothing.** A phone parks on
`/api/poll` until the event log advances, so a ticket arriving without an event is a
ticket nobody is told about until something else happens to move — on a quiet evening,
hours. The other half of that is why it is filtered: every wake rebuilds the inbox with a
`bd` sweep across every workspace, so an event per workspace per minute would make the
cheapest thing in the system the most expensive one. What counts as moved is the set of
keys and the `updated` on each, which is a status change and not a typo in a field
nothing here draws.

`node test/jira-poll.mjs` covers the JQL, the clock, the zero-cost path, both halves of
the cache, the change signal and the failure record.

### The tickets, as a section of the inbox

The tickets assigned to you arrive as **rows in the inbox**, under a `JIRA` chip of
their own, and never mixed into the questions. Not a screen and not a tab: the inbox is
already the one list that sorts incoming work, and a sixth tab claiming a ticket queue
is somewhere you *live* would cost a fifth of the bar to say something untrue. What it
cost instead was one row in [the kinds table](inbox.md#one-list-six-kinds--and-the-two-sub-filters),
which is where a chip, a count and a place in the summary line come from for free.

A row says the ticket key, the summary, the status and when it last moved — enough to
decide whether to open it while scrolling past, which is the whole requirement — and
carries the workspace it came off, because JIRA is configured per workspace and a key
alone does not say which project you are looking at. The assignee is *not* drawn: the
query is "assigned to you", so a name on every row would be the same name on every row.
Under that line sit the three things you can say about it —
[approve, discuss and cancel](#approve-discuss-and-cancel-on-the-row--and-a-cancel-that-never-expires)
— and tapping the row itself
[opens the ticket over the tab](#the-ticket-opened-over-the-tab--and-the-way-back-from-a-cancelled-one),
which is where it gets read.

**They are rows, not beads.** Synthesised at render time and never merged into
`state.questions`, exactly as the pull requests and the chat sessions are, for the reason
that array is read by things a ticket is none of: the kind filter's counts, the epic board,
the answer path, the "N waiting" the monitor draws. A
ticket is **never** a bead here: the ticket gets [an epic of its own](#an-epic-per-ticket--filed-once-forever-and-held),
and that bead is the thing you act on, while the row stays a row. Counting the row as work
asking you something would be a number that no tap can bring down.

Two behaviours come free from being a row and are worth stating because they are what a
separate screen would have had to re-implement: a ticket obeys the **space picker** and
the **epic board's filter** like everything else in the list, and a ticket in a quiet space
is as quiet as that space's questions — quiet is per space, a workspace belongs to a
space, and the row carries the space of the workspace whose JIRA held it. The standing
asymmetry applies here too: the *kind* filter lives in `localStorage` and deliberately
does not change what rings your phone, so a hidden `JIRA` chip can still notify you.

`node test/jirarow.mjs` runs the real row renderer over a held ticket and asserts what it
draws, that the key namespace cannot collide with a bead's, that nothing writes a ticket
into `state.questions`, and — the one that matters — that the word keeping a ticket out
of the questions is in the predicate rather than only in the comment above it.

### An epic per ticket — filed once, forever, and held

A ticket that arrives gets a bead: an **epic**, at **P1**, carrying
`external_ref: jira-<KEY>`, arriving `unendorsed`. That bead is what everything else about
the ticket hangs off — the work ingested under it, the discussion, the decision to cancel
it — because a ticket has no id in any tracker and nothing about it can be answered. The
row in the inbox stays a row; the epic is the thing you can act on.

**Exactly one, forever, is the whole of this step.** The poller re-answers with the same
tickets every minute and a restart starts from nothing, so "file an epic for each ticket"
without that word means ten thousand beads by Friday. Three nets, in order, and they catch
different things:

1. **The ref.** `bd create --external-ref jira-NW-1` was already a field and already a
   flag, and it is the link in both directions — from the bead to the ticket for anybody
   reading it, and from the ticket to the bead for the sweep that has to decide. It is
   looked up **before** every create, against `bd list --all` rather than against memory,
   because the epic that was finished last month is not in any list of open work and is
   still the one epic that ticket gets.
2. **A near-verbatim title** ([lib/dupe.js](android.md#a-card-that-is-already-a-bead-says-so--and-still-files)), which catches
   the epic an older build filed before it wrote refs, and the one a second machine on a
   shared tracker filed while this one was off.
3. **A title that opens with the ticket key** — `NW-1 — …`, `NW-1: …`, `[NW-1] …`.
   That is what a person writes when they raise the bead by hand, and its summary need not
   resemble the ticket's at all, so net 2 cannot see it.

A bead caught by net 2 or 3 is **adopted, not skipped**: the ref is written onto it with
`bd update --external-ref` and a comment on the bead says so. Skipping would leave the
ticket with nothing findable by ref — which is the state those two nets exist to get *out*
of — and would re-decide itself by fuzzy title matching on every restart. Two things it
will not do: adopt a bead that already carries some *other* `external_ref`, because that is
somebody else's link, and adopt a bead that merely *mentions* the key. "Follow-up to
NW-1" is a bead about the ticket and is not the ticket's epic; net 3 is anchored to the
start of the title for exactly that reason.

**It arrives held.** `unendorsed`, which is [two layers](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time)
and only one of them is a queue filter: `openWorkSession` asks the tracker itself, so an
epic handed straight to the launcher is still refused. That refusal is the guarantee, and
it matters more here than for an agent's discovery — a JIRA site can assign you fifty
tickets in an afternoon and nobody has read any of them. `autoEndorse` is the existing
per-space switch for a space that wants these to skip the gate, and the note on the bead
says plainly which of the two happened, because a bead claiming to be waiting for a tap
over a session already running on it is the worse of the two errors.

**A ticket that stops arriving is left completely alone by *this* sweep, and that is the
decision.** The query is `assignee = "<you>" AND resolution = EMPTY`, so a ticket stops
coming back for two quite different reasons — it was reassigned to a colleague, or it was
resolved — and nothing in the filing can tell them apart. It reacts to neither. bc-uz6e put
the three answers up for the **reassigned** case (leave it, gate it by putting `unendorsed`
back on, close it with a reason) and the answer was **leave it alone: let the engineer
reassign it**; a half-finished branch is not undone by JIRA changing its mind. The
**resolved** case is [its own sweep](#a-ticket-that-is-resolved--the-epic-closed-or-left-alone-and-told),
because there the epic's own acceptance has come true. The good consequence is unchanged: a
ticket handed *back* to you finds its epic by ref and files nothing new, because the ref is
in the tracker whether or not the ticket was in the last sweep.

**A summary that is rewritten follows onto the title — while the title is still ours.**
A ticket being renamed is ordinary: a placeholder is triaged into a real title, a summary
is corrected, a component changes its name. The poller sees it within the minute and the
inbox row redraws, so an epic filed once and never touched again ends up disagreeing with
the row above it about what the same ticket is called — and the bead is the thing
everything else hangs off. bc-yc16 asked whether the epic should follow, and the answer is
**yes, under three refusals**:

1. **Only a title beadcause wrote.** That is recorded when the epic is filed and inferred
   at every authoritative read: a bead whose title is *already exactly* what would be
   written for the ticket in hand is one nobody has edited. A title that differs at that
   moment is somebody's — or belongs to a bead adopted by nets 2 and 3, which never
   carried ours — and it is never rewritten, on that tick or any later one.
2. **Only an epic nobody is working.** `open` and nothing else. A closed epic's title is
   history; an in-progress one is the name on the window of a session running right now,
   and a container that renames itself halfway through reads as a different bead.
3. **Only against the tracker.** The drift is *noticed* in memory, which is what keeps a
   quiet minute free, and then decided against a fresh `bd list --all` — because the title
   in memory is up to a minute old and a minute is long enough for somebody to have
   retitled the bead by hand.

The description is deliberately **not** rewritten. That body is the ticket as it arrived —
its status line, its assignee, the prose beside them — and a sweep that rewrote it would
eventually eat something a person had added. The title is what every list, card and queue
draws, and it is the whole of what was asked for.

One gap is left open on purpose: **a summary rewritten while the daemon was down.** The
first read after a restart then finds a bead that disagrees with JIRA and no memory of who
wrote it, which is indistinguishable from a hand edit — so it refuses, and the epic keeps
the name it had. That is the same staleness this paragraph exists to fix, accepted in the
one case where fixing it might overwrite a person. Retitle the bead to match the ticket
and the next read takes it back. A rename is logged in full, both titles, and says so in a
comment on the bead; it emits no bus event, for the reason filing does not, but it *does*
drop the endorsement queue's cache, because that screen is the one drawing the old title.

**The status line and the assignee inside the body stay frozen forever, and that is a
decision, not the gap bc-yc16 left behind.** bc-yc16 answered only the title; bc-0i27.22
is the rest of that question, and the answer is: leave the body exactly as it arrived. Not
because nobody thought to keep it live, but because it does not need to be — the row this
ticket draws (`jiraRowHtml`) and the ticket view behind it (`/api/jira/ticket`) both read
the status off the poller's own answer, refreshed on every inbox poll, so nobody reading
where a ticket stands today is reading it off the bead; the bead is not the only place, or
even the current one. The assignee is narrower still: the whole query this epic exists
because of is *assigned to you*, so for as long as the ticket keeps arriving, the name the
body would show and the name the poll is filtering on are the same fact twice over. The one
way they could diverge — the ticket reassigned to somebody else — is the case bc-uz6e
already decided: nothing here reacts to a ticket that stops arriving, the epic is left
exactly as it was, branch and all, and a frozen assignee line is that same abandonment
already chosen for the rest of the epic, not a new one. Widening `renameFor`'s "is this
still ours" test to a body a person may have appended to would cost the guarantee bc-yc16
built it to protect, for a line whose live value is already on screen somewhere better.

**Who owns it is not the JIRA assignee, and that is deliberate.** `bd` takes `owner` from
the git identity of the directory the command runs in, which for a work workspace is
already the work address. So nothing tries to force one: the assignee is recorded *on* the
bead — named in the description, reachable through the ref — and the real per-person
question is left where it belongs, with the advocate that would open the session.

**What a quiet minute costs: nothing.** Each workspace's `ref → id` map is held in memory
and a tick whose every ticket is already in it makes no `bd` call at all. The map is only
ever trusted to *skip* — the moment a ticket is missing from it the tracker is re-read and
the decision made against that, because two sessions filing at once, a bead deleted by
hand and a `bd dolt pull` bringing in the other machine's epic are all wrong in memory and
right in the tracker. A create that fails is left alone for five minutes rather than
retried on the next tick: a ticket bd will never accept would otherwise buy a full read of
the workspace every minute for as long as it exists.

**No bus event, and that is not an oversight.** Nothing on `/api/poll` changes when an epic
is filed — a held bead is out of every queue and every count — so an event would wake every
parked phone to redraw an identical inbox. What is dropped instead is the endorsement
queue's fifteen-second cache, because that screen is the one place the new epic appears and
it is fetched on its own.

`node test/jiraepic.mjs` covers the three nets, the hold and its refusal, the free path, the
backoff, where the epic lands, and every refusal the rename owes — a title edited by hand,
an adopted bead, an epic being worked, one that is closed, and a refusal that must not be
re-decided (and re-read) every minute for as long as the ticket exists. `node test/jiraepicreal.mjs` asks the **real** `bd` the
one question a fake cannot answer: that a ref written on the way in comes back out on the
way past, on create, on update, and on a bead that has since been closed. If it did not,
every sweep would look up a ticket, find nothing, and file another perfectly well-formed
epic a minute later.

### A ticket that is resolved — the epic closed, or left alone and told

The epic filed above carries one acceptance criterion: *"`<KEY>` is resolved in JIRA — the
ticket is the source of truth for that, not this bead"*. So the day somebody resolves the
ticket, that bead's stated done-condition has come true — and the bead is still open, still
`unendorsed`, still in the endorsement queue, still offered to whoever is deciding what to
work on next. For ever. Nothing noticed, because nothing was looking: the poll asks
`resolution = EMPTY`, so a resolved ticket does not come back marked resolved, it simply
**stops coming back** — exactly like one reassigned to a colleague.

bc-jrvh put four answers up and the one picked is the **cancel split**, which is not a new
policy at all. It is the line [cancel already draws](#approve-discuss-and-cancel-on-the-row--and-a-cancel-that-never-expires):

- **The epic is still unendorsed → close it**, with a reason naming the resolution. Nobody
  has read it, nothing has been worked on it, and a held bead closed with a reason is the
  honest record of something proposed and overtaken.
- **The epic has been endorsed → leave it completely alone**, and comment once that the
  ticket resolved. By then it is real work: an advocate may have opened a session on it,
  there may be children, there may be a branch. **beadcause does not undo work because JIRA
  changed its mind** — and the comment says so out loud, because a note reporting a
  resolution on a bead somebody has a branch against otherwise reads as an instruction to
  stop.

**Telling resolved from reassigned costs one `GET` per vanished ticket**, and that is the
whole of the new expense. `resolution` is not on any list of fields beadcause asks for
otherwise — every other read is of a ticket the query already guaranteed was unresolved —
so the by-key read asks for its own three. A **null** resolution means still open:
reassigned, or a site that hides the field. Nothing at all happens to those epics, and the
answer is read off the presence of the resolution object rather than off any name in it,
because *do nothing* has to be the case that is impossible to arrive at by accident. The
resolution's **name** is carried onto the close reason — `Done`, `Won't Do`, or whatever the
site renamed them to — which is also the field the day somebody wants a `Won't Do` handled
differently from a `Done`.

**Three things vanish without being resolved, and each is skipped for its own reason.** A
workspace whose JIRA read *failed* is skipped outright, because a failed read serves the
last good answer and acting on the difference either side of an outage would close an epic
for every ticket on a site that was merely unreachable. A ticket **cancelled** in beadcause
is filtered out of the sweep list and so vanishes identically — its epic was already closed,
by the tap that cancelled it. And a ticket the daemon simply never saw is not a vanishing
either: the candidates come from the filer's own `ref → id` map, which is seeded from the
tracker on the first authoritative read after a restart, so this survives a restart without
inventing a vanishing out of a poller that has only just started.

**Except that seeding only happens for a workspace with a ticket it does not already
know** (`fileFor` — a quiet tick makes no `bd` call at all), so a workspace whose tickets
*all* resolve while the daemon is down comes back up with an empty map, nothing to compare
its (also empty) live list against, and would otherwise leave those epics open forever —
bc-0i27.23. Rather than pay a full `bd list --all` per workspace per tick to catch it, this
sweep keeps its own copy of the filer's map in `state.json`, written back every tick the
filer's map is non-empty and skipped when nothing has changed — the same free-quiet-tick
shape as everywhere else in this file. On a restart with nothing live, that copy is what
the vanished-ticket check falls back to, so the epic still closes on the next tick rather
than being lost the moment the map was empty when the tickets vanished.

**Written once, and never again.** A resolved ticket stays resolved, so a sweep with no
memory would re-ask JIRA and re-comment the same epic once a minute for ever. The record is
[the same shape as a cancel](#approve-discuss-and-cancel-on-the-row--and-a-cancel-that-never-expires):
keyed `<workspace>/<KEY>` in `state.json`, written after the `bd` call rather than before it
so a lock race cannot leave a ticket marked as dealt with that never was, and pruned by
nothing on a timer. A vanished ticket that answered *still open* is backed off six hours
rather than recorded, so a colleague's ticket costs four reads a day instead of fourteen
hundred, and the day they resolve it is still noticed. At most five tickets per workspace
are asked about on any one tick, which is what keeps the first minute after a restart from
being a burst against somebody's rate limit.

**And the way back, because a resolution can be reversed.** A ticket reopened in JIRA comes
back through the poll and finds its epic by ref — a ref survives a close — so nothing new is
filed, which without something here would leave the ticket on screen with a closed bead that
nothing would ever raise again. So a returning ticket drops its record, and an epic **this
sweep closed** is reopened with a comment saying why. Only that one: a bead closed by a
person, or by a cancel, is not this sweep's to reopen.

**No bus event, and the queue cache dropped only on a close** — the same shape as the filing
above, for the same reasons. A held epic is out of every queue and every count, so closing
one changes nothing a phone is drawing and an event would wake every parked client to redraw
an identical inbox. The endorsement queue is the one screen that does change, because a held
bead is what it draws, and its fifteen-second cache would otherwise go on offering approve on
a bead that is closed. A comment on an endorsed epic changes neither, so it drops nothing.

`node test/jiraresolved.mjs` covers both halves of the split, the reassigned case that must
stay untouched, the three vanishings that are not resolutions, the record that makes it
happen once, the backoff, the cap, the way back, and the failure paths — a JIRA read that
throws must leave the ticket unrecorded and un-backed-off, because a question that could not
be asked must never look like an answer of *no*.

### Approve, discuss and cancel on the row — and a cancel that never expires


Three controls on a JIRA ticket's row, and the load-bearing property is the negative
one: **until approve is tapped, nothing may work any of it.** The epic arrives
`unendorsed` and so does everything ingested under it, which means no advocate queues
them and `openWorkSession` refuses one handed straight to it. That is the gate, and it is
the existing one rather than a new one.

**Approve and discuss are the endorsement queue, aimed at a ticket.** The queue already
holds beads behind an approval, already offers a verdict per row, and
[already lets you talk about one before deciding](pull-requests.md#talking-about-one-before-you-decide).
A JIRA epic is another unendorsed thing, so building a second approval system beside that
one is the failure this step exists to avoid. What is genuinely new is *which beads*:
approve endorses the epic **and its open children**, because an approve that took the
marker off the container alone would put a bead in the ready queue with nothing workable
under it. That is why it is `POST /api/jira/approve` taking a **ticket key** rather than
`/api/bead/endorse` taking an id the phone already has — the family is a `bd list
--parent` at the server's end, and the phone cannot assemble it. `autoEndorse` is the
existing per-space switch for a space that wants to skip the gate entirely.

**Discuss is a link, not a second conversation.** It opens the endorsement queue on this
ticket's epic with the thread already open (`/endorse?bead=<workspace>/<id>&talk=1`). A
discussion is a poll timer, an agent picker and a column of bubbles; grafting a second
copy of that onto a row you scroll past would be exactly the parallel system the
paragraph above refuses. A bead that has left the queue since the row was drawn says so
rather than dropping you into a list to hunt through.

**Cancel is a keyed local record, and the one that must not expire.** It says *this ticket
does not need a bead id*, and it lives in `state.json` beside `quiet`, `ringing` and
`answered` — with one rule that separates it from all three. Those are pruned when the
thing they are about leaves the inbox, which is right for them and a **loop** here: JIRA
goes on saying the ticket is assigned to you, so a record dropped when the row went away
is un-cancelled by the very next sweep, and the ticket comes back with a fresh epic every
minute, forever. So nothing prunes it, nothing here takes a clock, and there is
deliberately no ttl to tune. `lib/owed.js`
is the nearest existing shape and says the same about itself.

It is **keyed by the ticket** — `<workspace>/<KEY>` — and never by the bead, because the
bead may never have existed: a ticket can be cancelled in the minute between arriving and
its epic being filed, or on a machine whose `bd create` has been failing all morning.
Beadify has to find the record with nothing in hand but the ticket, which is the one
thing that is always there. The bead id is *carried* on the record, because that is what
beadify reopens; it is a field, never the key. And the way back to a cancelled ticket is
[a fold at the foot of the section](#the-ticket-opened-over-the-tab--and-the-way-back-from-a-cancelled-one),
because beadify lives on a ticket's own view and a view with no way in is a button that
does not exist.

**Both halves are filtered, and only one of them is visible.** The cancelled ticket is
dropped from the inbox payload *and* from the list the epic filer acts on. Filtering only
the rows would leave a cancel that hid a ticket while quietly filing it a fresh bead on
every restart — which reads as working right up until somebody looks at the tracker.

**What cancel does to the bead**, and the one case where it does nothing: the epic is
closed, with a reason naming the ticket, and the `unendorsed` marker is left on it exactly
as a revoke leaves it — the history of what was proposed and turned down is worth having
in three weeks. **Unless it has already been approved**, and then it is left completely
alone: by that point it is real work, possibly with a branch, and this is
[bc-uz6e's answer](#an-epic-per-ticket--filed-once-forever-and-held) applied to the other
end of the same problem. The earmark is written either way, and written *first*, because
"stop proposing this ticket" and "throw the work away" are two claims and only the first
is what cancel means. A `bd` that will not answer costs the record its bead id and nothing
else.

**Beadify reopens rather than re-files**, and that is not tidiness. The `external_ref`
survives a close, so a sweep over a beadified ticket finds the closed epic by ref and
raises nothing — which means without the reopen the ticket would come back with a dead
bead that no sweep would ever replace. The button belongs to
[the ticket view](#the-ticket-opened-over-the-tab--and-the-way-back-from-a-cancelled-one);
the act is `POST /api/jira/beadify` and it is the other half of this record.

**No request in this whole path is anything but a GET against JIRA.** The earmark is local
for that reason and not as a shortcut: no label, no transition, no comment. Making
beadcause write to JIRA would mean *adding* the capability, which is the point at which
somebody decides it explicitly and with an allowlist.

`node test/jiracancel.mjs` covers the record — keyed by the ticket, on disk, unpruned
across a ticket leaving and re-entering the inbox, both filters, and the reversal.
`node test/jiragate.mjs` covers the acts, their routes, and the row: that it
never offers a button that would be refused, and that the second tap on cancel says what
it will not take back.

### The records with no ticket left

The rule above — **nothing prunes a cancel record** — is right, and it has a cost that
took a while to show up. The fold at the foot of the ticket section is a *filter over
what the poller answered*, deliberately: a record for a ticket nobody is assigned cannot
be put back as a row anyway, and filtering is one `state.json` read for the whole list
rather than one per ticket per parked phone.

So a ticket that is cancelled and then **resolved, reassigned, or moved into a project
this workspace is no longer pointed at** stops being returned, drops out of the fold, and
its record stays on disk for ever. Nothing listed it, nothing counted it, and nothing
could drop it. Over years that is a quietly growing object in `state.json` that no screen
in the app could account for.

**The answer is to list them, not to expire them.** An absence rule would have to prove
it can never fire on a ticket that is merely missing from one sweep — a JIRA outage, a
project moved out of the configured list, a paging bug — and the whole reason this record
has no clock is that a record which expires is a ticket that comes back. Listing needs to
prove nothing: a record you can see and drop by hand cannot un-cancel a live ticket,
because a live ticket is not on the list.

`strandedCancels` in `lib/jiracancel.js` is the one list here that **walks the store**
rather than filtering the tickets, which is the only way to see something the poller never
mentions. It is still one read, and still nothing at all when there are no records. A
workspace JIRA could not be asked this minute does not appear, because `lib/jirapoll.js`
serves that workspace's last good answer rather than an empty one; a workspace switched
off, or dropped from the config, does — and that is the case it exists for.

They ride the inbox payload as `strandedCancels`, and the fold draws them under a line of
their own. **Lines rather than cards**, because there is no summary, no status and no link
to JIRA to be had — the record is all beadcause ever kept. The fold's own label counts
them (`3 cancelled — 1 with no ticket left`), which is the one number in the ticket
section allowed to name them, since unlike the live rows it is a number a tap *can* bring
down.

**And unlike every other list on this payload, it is not filtered to the account you are
in (bc-0i27.24).** [Accounts](asking.md#accounts--one-life-at-a-time) says a bead in the account
you are not in "goes quiet, and is never lost" — it is on the screen the moment you
switch. That promise depends on some account claiming the workspace, and the commonest
way a record ends up here is the opposite: the workspace was dropped from the config
entirely, which usually drops it out of every account's `workspaces` list too. There is
then no account switch that reaches it, and — unlike a question or a live ticket — this
record has no other surface to be found on. So `strandedCancels` skips `inAccount`
altogether and every account sees the list whole, the same exemption `requests` already
has for its own reason. It can afford to: each line already names the workspace it came
from, so a record for a workspace you would not otherwise see reads as *this is where it
came from*, not as another account's business on your screen.

The one control is **Drop**, `POST /api/jira/forget`, and it is not Beadify. Beadify means
*put this ticket back*: it reopens the closed epic and expects the row to return on the
next sweep, and here neither is true, so it would strand a held bead instead of a record.
Drop lifts the earmark and leaves the epic closed, which is what the history of a
cancelled ticket should look like. It is the only route in this path that does not resolve
its workspace against the config, because a workspace that has left the config is the
commonest way to strand a record and every other route would answer `400` on exactly the
records this is here to clear. And it re-asks the poller at the moment of the write: a
ticket assigned back to you since the payload was drawn is a `409` naming beadify, never a
silent un-cancel.

Records too broken to key — no workspace, or no ticket — are not on the list and need no
button. `readCancelled` drops them on read, and every write in that file saves the
normalised map back, so the first cancel or drop after one appears prunes it; a record
that matches no ticket was never suppressing one.

`node test/jiracancel.mjs` covers the list and the live-ticket guard; `node
test/jiragate.mjs` covers the drop, including the workspace that is no longer configured
and the `409`; `node test/jiraview.mjs` covers the fold.

### Reading the ticket — the children under the epic, and what the row says while it happens

An epic built from a summary and a status is enough to *find* the work and nothing like
enough to *do* it. So a minute or so after the epic lands, an agent reads the ticket's own
description and thread and proposes what it decomposes into, and those beads are created as
real children of the epic — `lib/jiraingest.js`, and the third of the three modules JIRA
arrives through.

**It is the chat session's path with a ticket where the conversation was.** Nothing here
invents a way to propose beads. `lib/console.js` already runs an agent that reads something
and answers with a fenced ` ```beads ` block; `lib/draft.js` already parses that block,
repairs its graph, breaks its cycles and orders it for creation. Both are used as they
stand, and the protocol string is *imported* from console.js rather than copied — a second
copy of it is a second thing that can drift away from the parser reading it. The agent runs
with the chat session's own foundation, which is **read-only against the tracker**: it can
`bd show`, `Read`, `Grep` and `Glob`, and it cannot create anything. beadcause creates what
it proposed.

**Nobody presses the button, and the review is one level up.** A chat session waits for
you; a ticket arrives while you are asleep, and the whole point of the epic is that the
inbox has something to tap by morning. The children therefore arrive `unendorsed`, exactly
as the epic does — and a held bead is not work: `assertEndorsed` asks the tracker itself, so
even a session handed one by hand is refused. They are beads you can read, edit,
re-prioritise and delete, and none of them is started until the approve on the row lifts the
hold. Held-and-editable is what "editable before it becomes work" means here; parking the
proposal in a queue instead would leave the row saying *still reading* until somebody
happened to open it.

**What lands on each child**, and every one of the three is owed because this does not go
through `lib/filing.js`: the `unendorsed` marker (or a note saying plainly that
auto-endorsement took it off), the `jira-ticket` label the epic also carries, so everything
one ticket produced is findable by one label, and the epic as its `parent` — which is what
makes `bd dep tree` render them and is exactly what `bin/file.js` could not have given
them. A bead filed that way gets a `discovered-from` edge, and `bd update --parent`
afterwards refuses outright: *"dependency X -> Y already exists with type discovered-from"*.
An epic decomposed through the filing seam has no children at all. Priority is clamped to
the epic's own P1 rather than to the filing floor: a child of a P1 epic may be a P1, and P0
is something you choose.

**Exactly once, asked of the epic.** The filer has `external_ref` to ask the tracker with;
a child has no ref of its own, so the question "has this ticket been read?" is asked as
"does this epic have children?" — one `bd list --parent` per ticket per daemon life, and
never again. That is deliberately the safe direction and the cost is worth stating: a run
that died half way leaves two children of the five it meant to make, and the next start
sees two children and calls it done rather than filing three more beside them. A
half-decomposed epic that says so on its row is recoverable by anyone reading it; a
duplicated one is a tracker nobody trusts.

**One at a time, and never awaited.** An ingestion is a `claude -p` that reads a ticket and
greps a repo — minutes, and real money — so `MAX_RUNNING` is 1 across every workspace, and a
morning that assigns you nine tickets reads them one after another rather than putting nine
agents on the Mac at once. The sweep *starts* runs and returns; a poll cycle that blocked on
an agent would stop the phone being answered. A ticket waiting its turn is `queued` and says
so.

**The row is step 5 of the epic, and it has three things to say** — each of them a different
next move:

| State | The row says | Because |
|---|---|---|
| `reading`, `queued` | *reading the ticket…* | There is nothing to look at yet. Tapping the row opens the ticket, which is what you read to decide. |
| `done` | the epic's id, and how many beads are under it | The id is a link into that bead's own detail view. "3 beads" you cannot open is a claim, not a result. |
| `failed` | *could not be read* — with the reason | Nothing retries it until the daemon restarts, so a stuck ingestion that looked like a slow one would never be found. |

The id appearing **is** what "the reading has finished" means, which is why the row does not
draw it earlier even though the epic has existed since the ticket arrived.

**A bus event, and only on the answer.** Unlike the epic filing one section up, this one
emits — because the row's content changes minutes after the sweep that started the run
returned, and a phone parked on `/api/poll` is woken only by the event log (`lib/events.js`).
One event per ticket that settles, which is a handful a day; an event per tick would wake
every parked client every minute to redraw an identical inbox. The endorsement queue's
fifteen-second cache is dropped in the same breath, for the reason the filer drops it.

**A failure is sticky for the life of the process.** The failures that reach here are an
agent that would not start, a JIRA read that was refused, a `bd` that would not take a
title — none of them fixed by trying again in sixty seconds, and all of them would otherwise
buy a `claude` process a minute for a ticket nobody can see is stuck. It says so on the row
instead, which is where somebody can do something about it, and a daemon restart is what
tries again.

`node test/jiraingest.mjs` covers the brief the agent is handed, the ADF walk that turns a
v3 description into text, what a child bead actually is, the once-only question and its
cost, the four failure paths, the concurrency cap, and the row — the renderer lifted out of
`public/app.js` and run for real, the way `test/jirarow.mjs` runs it.

### The ticket, opened over the tab — and the way back from a cancelled one

A row says the key, the summary, the status and when it last moved, which is exactly
enough to decide *whether to open it*. Tapping it opens the ticket itself — its
description, its thread, and the beads written under its epic — and the row that used to
be a link out to atlassian.net is a **button** now, for the two reasons
[the pull request row](pull-requests.md#tapping-one-opens-it-full-screen) became one: the reading this row
exists for happens here rather than on somebody else's site, and the whole row is one tap
target where an `<a>` inside it was a nested interactive element a phone could resolve
either way. The link out is not lost; the open view puts it back on the title, which is
where it belongs once there is a screen to leave.

**It opens over the tab, not instead of it** — the rule this whole app has
[one of](navigating.md#detail-opens-over-the-tab-not-instead-of-it), and this is one of those rather
than a new pattern. Mechanically it is `.card.open`, the same fixed full-screen sheet a
question and a pull request open into: a `.card-top` that stays, a `.card-head` saying
what this is, a `.brief` that scrolls and a pinned `.freeform` holding the buttons.
Nothing new was laid out for it, and the ✕ question does not arise — a card that collapses
back into the list *is* the view it opened over.

**It is tappable before the ingestion has finished, which is the point of it.** The
decomposition takes minutes and the ticket is what you read to decide either way, so the
view draws from what is already in hand and waits on nothing. The two halves arrive on
two clocks:

- **The bead half** — the epic's id, whether it is still held, how the reading is going —
  is on the row already and refreshes on the ordinary inbox poll. A ticket opened in the
  minute before its epic is filed says *its bead is still being filed* and then says the
  id, with nothing on this screen polling for it. That is why this is a screen rather
  than a spinner: the unknown half arrives on a clock that was already running.
- **The ticket half** — the description and the thread — is one `GET /api/jira/ticket`,
  issued after the sheet is up and once per card for the life of the tab. A description
  does not move, and a phone parked on the inbox must not be issuing a JIRA read every
  twenty-five seconds.

The one thing that could not ride the row is **which beads it decomposed into**: that is a
`bd list --parent`, the most expensive call in the app, and it has no business on a payload
every parked phone rebuilds. Behind a tap it is fine. Closed children are drawn struck
through rather than dropped, because an epic whose children were revoked is a different
picture from one with none, and it is the picture you would decide differently about.

**A JIRA that will not answer is a sentence, not an empty card.** The row's own facts, the
epic, the children and all three buttons are still true and still act; the one thing lost
is the description. The reverse holds too — a tracker that will not answer costs the
children and not the ticket. The failure that would matter is a view that refused to open
because a token expired, taking the decision with it.

**Beadify is here, and it is the only thing a cancelled ticket's view offers.** Not also
approve: the epic behind it is closed and the earmark is on, so approving would endorse a
closed bead and the very next sweep would take the ticket away again. One tap rather than
two, unlike the cancel it undoes — cancel arms because it writes
[the one record with no expiry](#approve-discuss-and-cancel-on-the-row--and-a-cancel-that-never-expires)
and a thumb in a pocket must not be able to, and an undo behind two taps is a decision you
have to make twice.

It does four things, and the fourth is this step's: the earmark comes off, the closed epic
is *reopened* rather than a second one filed, the epic filer's memory of the workspace is
dropped — and so is **the ingester's memory of this one ticket**. That last one has no
visible symptom and is the reason the sentence is here: the ingester skips any ticket it
already has an answer about, and `failed` is an answer, so a ticket cancelled while its
reading had failed would come back with the failure still in memory, saying *could not be
read* forever with nothing anywhere that would retry it. One ticket rather than the
workspace, because every other ticket in it would otherwise cost a `bd list --parent` to
find out nothing had changed.

**How you reach a cancelled ticket at all: a fold at the foot of the section.** This is the
part that made the button possible — beadify lives on a ticket's own view, and a view with
no way into it is a button that does not exist. So the cancelled tickets ride the inbox
payload in a **field of their own** and are drawn as one shut disclosure under the live
rows, saying nothing but a count.

They are emphatically **not rows**. Nothing counts them: not the JIRA chip, not the summary
line, not the kind filter, not the monitor's *N waiting*. A number on
this screen that no tap can bring down is the failure the whole ticket section is written
to avoid, and a ticket you have decided about is the clearest case of one. The fold obeys
the space and workspace pickers like everything else — a phone narrowed to one space must
not offer to put back another's ticket — and it opens itself when the card you are reading
is one of its own, because a repaint that hid the thing you were looking at would be the
fold eating the view. Only the tickets JIRA *still* says are assigned to you appear: the
list is a filter over the poller's answer rather than a walk of the records, so a cancelled
ticket since reassigned to somebody else drops out of it, and the record stays on disk for
the day it comes back.

A cancel taken from inside a ticket's own view moves the card into that fold in the same
breath, rather than a poll later. Two things need it — the view must not blink out from
under the thumb that cancelled, and the toast has promised a way back that has to exist by
the time it is read.

`node test/jiraview.mjs` covers all of it: the read (the description, the thread capped at
its newest forty with the omission counted, the two failures that are fields rather than
throws), the route, the renderer lifted out of `public/app.js` and run over fixtures the
way `test/jirarow.mjs` runs the shut row, the cancelled view's single button, the fold's
three behaviours, and the ingester forget that nothing else would notice.

### One credential rule and one wire, shared by JIRA and Confluence

The two Atlassian integrations landed within minutes of each other, independently, and
arrived at the same answers about the two things underneath both — which was the good
news. `lib/atlassian.js` is the bill (bc-jv4p). It holds exactly two things:

- **The credential convention.** Where an Atlassian API token lives, that it is written
  at 0600 and re-chmodded on a rewrite (`writeFileSync` applies `mode` only when it
  *creates* the file, so a 0644 left by an earlier hand survives), that an environment
  variable wins because it leaves no copy, and that it may never be a `config.json`
  field. Both integrations let you name the file, and both therefore let you point it at
  a name the config repo would commit — which is now one warning covering three
  credentials, the third being the Google client secret.
- **The wire.** One abortable request that turns a `fetch` rejection into something
  carrying *which* failure it was, reads the body exactly once as text, and parses it
  when it can. Confluence had no timeout at all before this, which is a publish that can
  sit on a request handler until the socket gives up.

**What it deliberately does not hold is a single sentence either integration says.** A
401 from JIRA means *check the token in this file, and that it belongs to that address*,
and it is thrown; the same 401 from Confluence becomes a **502**, because the phone that
pressed publish is signed in perfectly well and must not be bounced to a login screen.
Folding those together produces a message that is wrong for both and a status that is
wrong for one. Nor is the *shape* of the two shared: JIRA is per workspace and read-only,
Confluence is per space and writes outward, and that is the difference the two modules
exist to express.

One thing worth knowing if you touch the failure path: **the two products disagree about
how a failure is shaped.** Confluence v2 answers `errors: [{title, detail}]` — an array.
JIRA v3 answers `errorMessages: [...]` *and* an `errors` **object** keyed by field, which
is not the same `errors` at all. `saidAboutFailure` knows both, which is the whole reason
it is in one place: a reader that knew one shape would silently drop the other product's
words. `node test/atlassian.mjs` covers the rules; the two suites beside it still own
their own sentences.

### Where trackers live — `workspaceRoots`, and the two shapes a root can have

There are two settings here and they answer different questions. This one says **where
to look**, and everything under a root is found for as long as it is there.
[`workspaceDirs`](operations.md#where-a-workspace-lives-when-it-is-not-under-beads) names **one
workspace**, wherever it is, and is also the only way to say `null` — take this name out
and keep it out. Roots are read first; a name pinned there wins over anything a root
turned up under it; an excluded name is dropped however it arrived.

`~/beads/sorrel/.beads`, `~/beads/loremia/.beads`, `~/beads/ehden/.beads`. One directory
holding one subdirectory per workspace, each with a `.beads` in it — that is what
`bd init` in `~/beads/<name>` produces, what the installer tells a fresh Mac to make, and
what discovery read for as long as there was only one shape to read.

There is a second shape, and it is the one a *team* tracker has. Northwind's `cl-` graph
moved into `~/northwind.dev/architecture/.beads` on 2026-08-12, because forty service
checkouts and the issues about them should arrive in one clone: the repo the team already
has is the repo the tracker ships in. Nothing about that is exotic — it is what beads
itself recommends for a shared graph — and the root there **is** the workspace rather than
holding one.

`workspaceRoots` is the list of places to look, and it understands both:

```json
"workspaceRoots": ["~/beads", "~/northwind.dev/architecture"]
```

A root with its own `.beads` is one workspace, named after the directory it sits in
(`architecture`). A root without one is a container, and every subdirectory of it that has
a `.beads` is a workspace named after that subdirectory. The default is `["~/beads"]`
alone, so an install that has never heard of this setting discovers exactly what it
discovered before — the whole compatibility story is that one default.

**It is discovery and not a list, on purpose, and that is what makes it one edit.**
`workspaces` below it is written by the daemon on every start and reconciled against the
disk: a root added here is picked up at the next restart, a renamed directory is dropped
with a log line, and neither needs a second edit. Until this existed the only way to serve
an out-of-tree tracker was to hand-write a `workspaces` entry, which *worked* — the
reconciler keeps any saved entry whose directory exists — but worked by accident. Nothing
documented it, nothing tested it, and `npm run configure` said in as many words that the
directory was "not a workspace under ~/beads".

Two things are refused rather than guessed at:

- **Two roots reaching one directory are one workspace.** A symlinked container, or the
  same path written twice, is deduped by directory and nothing is said about it — there is
  nothing to say.
- **Two workspaces that would share a name are not.** The second one found is dropped and
  named in the log. Almost everything else in this config is keyed by workspace name —
  `sessionDirs`, `jira`, `advocates.perWorkspace`, a space's `workspaces` list — so two
  trackers called `northwind` would silently share every one of those answers, and which
  one won would depend on the order the roots were typed in.

**A container root is excluded from the repo search; a root that is a workspace is not.**
`candidateRoot` guesses where a multi-repo workspace's checkouts live, and it has always
refused to offer `~/beads`: that is the tracker's own tree, `~/beads/<workspace>` is named
after the workspace by construction, and nothing in it is a checkout anybody works in.
Every one of those sentences is false about `~/northwind.dev/architecture`, which is a
checkout somebody works in every day — so the exclusion follows the *container* roots and
leaves the in-repo ones alone.

**And a session opens in an out-of-tree workspace without pinning `sessionDirs`.** With
`projectRoot` configured, beadcause reimplements the shell's own rule to work out which
tracker a directory resolves to, and that rule named `~/beads/<repo>/.beads` outright. On
an install whose tracker is somewhere else it therefore never matched anything: no
directory mapped back to the `architecture` workspace, and every session opened on one of
its beads refused with *"a shell there would use a different issue graph"* until
`sessionDirs.architecture` was set by hand. The rule now resolves a name through
`workspaces` and keeps `~/beads/<name>/.beads` only as the guess for a name nothing knows
— and the workspace's own directory is one of the candidates checked, so the session opens
in the checkout the tracker lives in. It is still *checked* rather than assumed: where a
shell in that directory really would write to a different graph, the refusal stands, which
is the entire reason the check is there.

`npm run configure` asks this first, before anything else, because every question after it
that names a workspace — which are shared, which go in which space, which get an advocate
— is asked over the list discovery produced. It is also the only question that can be
answered on a machine with no tracker at all, which is why "no workspaces found" now comes
*after* it: the install this setting exists for used to be met with *"No beads workspaces
found under ~/beads. Create one and re-run"*, which is advice to build the wrong thing in
the wrong place.

### `{name, dir}` or `"name"` — the workspace has two shapes, and the swap is silent

A workspace is a `{name, dir}` object almost everywhere: that is what `discoverWorkspaces`
builds, what `cfg.workspaces` holds, and what every `bd.*` call takes, because `dir` is
the `BEADS_DIR` the binary is spawned with. But an *advocate record* carries it twice —
`record(ws)` in lib/advocate.js sets `workspace` to the object and `name` to the string —
and a dozen other things want only the name: lib/parked.js keys its store `<name>/<bead>`,
lib/repos.js and lib/spaces.js look the name up in a config block, and the done/check-in
files are named after it. Which of the two a call wants is decided entirely by the callee
and is invisible at the call site. `a.workspace` and `a.name` are one keystroke apart.

**Nothing throws either way, and that is the whole problem.** bc-2uj4.6 was the object
handed to lib/parked.js: `openList(opened, a.workspace)` compared an object against a
string, matched nothing, and returned `[]` on every tick for every advocate — which is
exactly what a quiet laptop looks like, so the idle sweep's loop body had never once run,
`state.parked` was `{}`, and the daemon log had no `parked …` line in its entire history.
It lived a fortnight. Worse, `beadKey` is a template literal, so it *accepted* the object
and filed seven live conversations under `[object Object]/<bead>`, where the resume path
found them again under the same wrong key. The other direction is no louder: the name
handed to `bd` leaves `workspace.dir` `undefined`, a spawn env drops an `undefined` value,
and `bd` answers *successfully* about whichever tracker the daemon's own cwd resolves to.

bc-ygwa audited every one of the advocate's sites — 47 `a.workspace` and 158
`a.name` once its comments are blanked, plus the sibling advocates and everything the two are handed to — and found no
second instance. Two things keep that true, because an audit is a fact about one afternoon
and the hazard is permanent:

- **`assertWorkspaceObject` in lib/bd.js**, at `run` — the single funnel every one of
  `Bd`'s ~40 public methods reaches, so one check makes the name-for-object swap loud
  everywhere at once, next to an `execFile` where it costs nothing measurable. It says
  which of the two shapes it got and which command it was about to run. It comes out of
  `graph` *synchronously* rather than as a rejection, deliberately: `graph` converts a
  failed `bd export` into the last good index so one bad read cannot blank the board, and
  a caller bug routed into that `catch` would be filed as a slow tracker and carried on
  from — the exact silence this is here to end.
- **`node test/wsshape.mjs`**, which reads lib/advocate.js rather than running it, because
  the other direction has no funnel to guard. Every `a.workspace` must sit in the argument
  list of a callee known to want the object; no callee known to want the name may be handed
  one; and no `a.workspace` may reach a template literal. Handing one to a function neither
  list names **fails the suite on purpose** — that red is somebody being asked which shape
  a new callee wants at the one moment the answer is cheap.

The two lists in that file are the audit, written down. Adding to them is the intended
response to its failure, not a workaround for it.

### Many repos, one workspace — the approved list, and the token that names each

Every other part of beadcause assumes a workspace **is** a repo: one tracker, one
checkout, one deploy, one advocate. That holds for `sorrel`, for `beadcause`, for
anything you cloned and pointed a `~/beads/<name>` at.

It does not hold for a company. Northwind is a GitHub org of forty-odd services sharing
a single `cl-` workspace, because only `architecture` has beads installed — it holds the
workspace's Dolt remote — and every other repo files into that same graph. So a bead
there is not about "northwind". It is about `atrium-service`, and until this block
existed there was nowhere to write that down: the bead resolved to a workspace, the
workspace resolved to one directory, and nothing that followed — the session, the
worktree, the pull request, the deploy — could be about the repo the bead was actually
about.

Each Northwind repo already names itself, in its own `config/config.yaml`:

```yaml
serviceName: atrium-service
serviceToken: as
```

That token is the repo's identity to every other service in the org, and it is what a
bead carries to say which checkout it belongs in. So the setting is a list of repos and
one default:

```json
"repos": {
  "northwind": {
    "root": "~/northwind.dev",
    "default": "architecture",
    "approved": ["architecture", "atrium-service", "bookings-service"]
  }
}
```

Keyed by workspace name, like `sessionDirs`, `advocates.perWorkspace` and
[`jira`](#jira-per-workspace--read-only-and-one-setting) — and deliberately **not** a
field on a `workspaces` entry, because that array is discovered under
[`workspaceRoots`](#where-trackers-live--workspaceroots-and-the-two-shapes-a-root-can-have)
and reconciled on every start, so anything written onto it by hand disappears at the
next restart.

**An approved list, and never discovery.** `discoverWorkspaces()` in `lib/config.js`
reads a directory and takes what is in it. That is right for `~/beads`, which is a
tracker's own private tree, and it is exactly the pattern *not* to follow here. An org
has repos nobody wants an unattended agent inside — somebody else's service, a secrets
repo, an experiment — and a directory appearing under `~/northwind.dev` because a
colleague told you to clone it must not be enough to make it workable. `approved` is a
list you write. Everything else in that tree is invisible, by construction rather than
by filtering: nothing in `lib/repos.js` reads the root directory at all, only the
entries you named. `node test/repos.mjs` asserts that against the module's own source,
because a `readdir` added later "just to be helpful" would quietly undo the whole
decision.

**The token is read from the checkout, not restated here.** One source of truth: a repo
that renames its service says so itself, in the commit that renames it, and a copy in a
JSON file on one Mac cannot go stale behind it. What that costs is that the token is a
fact about a checkout rather than a fact about the config — so it can be missing,
unreadable, or shared with another repo. All three are reported at load, in the startup
log, beside the line that says how many repos each workspace has:

```
[beadcause] repos       northwind: 5 repos, 2 unresolved, architecture by default
[repos] northwind repo "northwind-apps" declares no serviceToken in config/config.yaml — beadcause cannot tell which service it is, so no bead can name it
[repos] northwind repo "nope-service" is approved but /Users/you/northwind.dev/nope-service does not exist — clone it, or take it out of repos.northwind.approved
[repos] service token "as" is declared by 2 approved northwind repos (atrium-service, audio-service) — a bead naming it resolves to nothing, because guessing between them would open a session in the wrong checkout
```

**That last one is not hypothetical, and it is why nothing falls back.** On this Mac
today three Northwind repos declare `as`, two declare `ps`, and eight declare `xs` —
because `service-template` ships `xs` as a placeholder and a service that never changed
it keeps it. A resolver that took the first match would send a session into whichever
repo sorted first, in a checkout it was never meant to touch, hours before anybody
looked at it.

And an unresolvable token must not become the default repo either. "A bead with no
service token belongs to `architecture`" is true and useful — that is what `default` is
for. "A bead whose token I could not resolve belongs to `architecture`" is how work
aimed at one service quietly lands in the repo that holds the workspace's Dolt remote.
So the two are different answers: no token resolves to the default, and an unknown,
ambiguous or broken token resolves to **nothing**, with a sentence saying which of the
three it was.

One repo and no `default` is that repo — there is nothing to be wrong about. Several and
no `default` is no repo, and says so.

**`npm run configure` prints the tree and you tick it.** The list above was hand-edited
JSON, which is worse than it sounds, because both facts that decide an entry are invisible
from the file you are editing: whether the repo is cloned at all, and what token its own
`config/config.yaml` declares. Forty-odd directories means opening forty YAML files and
hoping — and a token typed from memory is a bead that resolves to nothing at three in the
morning. So the last question of the wizard reads the root and shows you what is there:

```
   48 directories under ~/northwind.dev, ✓ marking what is approved today:
    2 ✓ architecture                architecture
    4 ✓ atrium-service              as             ⚠ as is also declared by audio-service, rates-engine-service
   11   northwind-apps              —              declares no serviceToken in config/config.yaml
   29   service-template            xs             ⚠ xs is declared by 9 of these
   45   tmp                         —              is not a git checkout
   Numbers, ranges and names, comma-separated — "none" to approve nothing.
   approved: [architecture, atrium-service]
```

Every directory is listed, including the ones that cannot be approved usefully, because
"declares no token" and "is not a checkout at all" are more use on screen with the reason
beside them than missing from a list you are about to tick. The ⚠ is the collision — seen
*before* you approve the second repo that declares `as`, rather than in the startup log
afterwards — and once you have answered, the same sentences `repoList` would print are
echoed straight back at you, for the list you just wrote.

**Presented for approval is not applied, and the difference is the whole point.** The
answer *is* the list: nothing you do not name survives it, there is no `all`, and the
default offered is what is approved today — so holding Enter through the question cannot
approve a repo or unapprove one. Numbers and ranges (`1,4,7-9`) exist because forty names
is not something anybody types; a name that is not under the root is kept and reported,
since it is usually a repo approved but not cloned yet, and silently dropping it would
unapprove a repo by refusing to echo the default back. A *number* that is not in the list
is the one thing dropped rather than kept — it cannot be a repo name, so it is a slip, and
`"99"` in the approved list is a startup warning forever.

**It is asked only where there is something to ask.** Either `repos.<workspace>` already
exists — asked again whatever is on disk, so a tree that has moved or a repo that was
never cloned can be *fixed* rather than warned about at every start — or there is a
directory named after the workspace (`northwind` → `northwind.dev`, `northwind-repos`)
holding **two or more git checkouts**, which is offered as the root to confirm. `~/beads`
is excluded outright: `~/beads/<workspace>` is named after the workspace by construction
and is the tracker's own tree, not somewhere to open a session. An install where every
workspace is one repo — which is almost every install — is asked nothing at all, and its
config keeps no `repos` block.

The reading lives in [`lib/reposcan.js`](lib/reposcan.js) rather than in `lib/repos.js`,
and that is deliberate: the resolver's "no `readdir` in this module" assertion stays
literal, which is the cheapest possible check on the most expensive possible mistake.
`node test/reposcan.mjs` covers the other side of it — that an install with one repo per
workspace is asked nothing, that `~/beads` is never guessed, that a trailing YAML comment
never reaches a token the resolver will disagree with, that nothing unticked survives an
answer, and that the module writes nothing at all.

### How a bead says which repo it is about — `repo:<token>`

A label, and it is the same shape as
[`superseded-by:`](advocates.md#the-duplicate-that-comes-ready-the-moment-its-original-lands):

```
bd create --title "Atrium drops the last page of results" --label repo:as
bd label add cl-9f2 repo:as
bd list --label repo:as
```

A label rather than a field on the bead, because it is the only per-bead thing beads
itself will carry, sync and filter on without beadcause owning a schema — those three
commands work today, and the value rides Dolt to every other machine on the workspace.
The alternative is a line in the description that beadcause parses, and prose that has
to be parsed correctly is exactly what this whole thing exists to stop relying on.

**`resolveSessionDir` is where it becomes a directory, and it is the only place.**
Twenty-five call sites go through that one function in `lib/session.js` — the iTerm
session, the phone terminal, the chat console, the advocate, the PR board, the deploy —
so everything downstream of a bead lands in whatever it answered, and every one of them
gets the repo by passing the bead it already holds:

```js
resolveSessionDir(cfg, workspace, bead)      // the directory
resolveSessionRepo(cfg, workspace, bead)     // { dir, repo: {name, dir, token} | null }
```

The third argument is optional at every call site, and `repo` is `null` for every
workspace that has no approved list — which is `sorrel`, `loremia`, `ehden`, `beadcause`
itself and every other install of this. Those workspaces do not reach the new branch at
all: `multiRepo` is false, nothing is read from disk, and the `sessionDirs` /
`projectRoot` / `fallbackWorkspace` rules answer exactly as they did before. That is
asserted in `test/sessiondir.mjs` rather than believed, because "it still works for
Northwind" is not the claim that matters to the four workspaces that were working
already.

A caller with no bead in hand — a startup line — passes none and gets the `default` repo.
That is the right answer to a question about the workspace rather than about one bead, and
it is the same answer those callers used to get from the one directory a workspace had. A
caller asking a question of *every* checkout is a different thing again, and the advocate's
sweeps are all of them — see
[One advocate, many checkouts](#one-advocate-many-checkouts--what-spans-repos-and-what-does-not).

**The pull request board and the deploy are the other kind, and they took the default for
longer than they should have.** Neither is a question about a bead *or* about the workspace:
a board card lists one repo's pull requests, a deploy runs in one repo's checkout, and a
release queue is what one deploy of one repo would make live. Asking `resolveSessionDir`
with no bead gave all three `architecture` and nothing said so, which is a Ship button that
deploys the wrong service. They are keyed per repo instead — `beadcause`, or
`northwind/atrium-service` — and the argument is
[with the deploy](pull-requests.md#a-deploy-is-a-fact-about-a-repo-and-a-workspace-may-be-forty-of-them),
including what it costs in `gh` traffic to put forty repos on one board.

**Four ways a bead names no checkout, and all four refuse.** A token no approved repo
declares, a token two of them both declare, a bead carrying two different `repo:` labels,
and a bare `repo:` with nothing after it. Each throws a 409 with its own sentence —
`lib/server.js` already turns that into the message on whatever screen the tap came from
— and none of them becomes `architecture`. Only a bead carrying *no* `repo:` label
resolves to the default, because that is a bead that has said where it belongs. Two
labels naming the same token is one answer written twice and resolves fine.

**`sessionDirs.<workspace>` does not override this**, and that is a decision. It pins one
directory, and a workspace with several checkouts has no one directory to pin — honouring
it would send every bead in the workspace to the same repo however it was labelled, with
nothing on screen to say why. So the repo the bead named wins, and a workspace configured
both ways says so in the startup log:

```
[repos] sessionDirs.northwind pins /Users/you/northwind.dev/architecture, but northwind has an approved repo list — the repo a bead names wins, so that override no longer decides anything. Take it out, or empty repos.northwind.approved
```

**Two callers run it backwards, and they want different grains of the same answer.**
`ownWorkspace` in `lib/deploy.js` maps *this checkout* back to a workspace name, to decide
which graph the daemon files its own crashes on — a crash belongs on a tracker.
`ownRepoKey` maps it back to a **repo key**, because that is what a deploy is declared for,
and it is what writes the `deploys` entry beadcause makes for itself. Forwards, a multi-repo
workspace answers with one repo; backwards, every approved checkout **is** that workspace, so
all of them are compared. A single comparison against the default would have filed a crash
from a session running in `~/northwind.dev/atrium-service` onto whichever workspace came next
in the list — and, for the deploy, would have declared a kickstart of *this* daemon as the
deploy of forty other checkouts.

### One advocate, many checkouts — what spans repos and what does not

An advocate is one per **workspace**, and until Northwind that was also one repo. Forty
checkouts behind a single `cl-` graph splits the job in two, and the split is not
obvious from the outside: some of what an advocate does is a question about the *tracker*
and answers once, and some of it is a question about a *checkout* and has to be asked
of all of them.

**The caps stay per workspace.** `maxWorkers` counts one advocate's windows however many
repos they are spread across, `launchCooldownSeconds` is one clock for the workspace, and
`globalMaxWorkers` counts every advocate on this Mac at once. None of them becomes
per-repo, and that is a decision rather than the path of least resistance: what these
numbers ration is not checkouts, it is this laptop — iTerm windows on one screen,
`claude` processes on one CPU, and one person who has to be able to look at the lot. A
per-repo cap would turn "northwind, 1 session at a time" into *forty* sessions the moment
forty repos were approved, without anybody having typed a bigger number anywhere.

The cost of that is real and is the price: two Northwind repos move at once only up to
`maxWorkers`, so a workspace that wants two going says so by stepping its limit to 2 —
one press on the card, rather than a cap that scales with the length of a list. Within
that limit the concurrency is genuine: one tick opens as many windows as it has slots
for, in as many different checkouts as the beads name.

**Every sweep that asks a checkout asks all of them.** Four do, and each was reading one
directory when a workspace only had one:

| Sweep | What it asks a checkout | What one directory would have cost |
|---|---|---|
| open pull requests | `gh pr list --state open` — which beads are already on a branch | a bead whose PR is open in `atrium-service` looks exactly like a bead nobody has started, and gets a second window: [bc-utyr](advocates.md#the-bead-whose-work-is-already-in-an-open-pull-request) with the repo name changed |
| merged pull requests | which beads GitHub says landed | a bead stays open over work already in `main`, and the next tick spends a window proving it |
| branches in main | `git merge-base --is-ancestor` against the base | the same, one state earlier — the branch is in the `main` of the repo it was cut from, and nowhere else |
| [branches *not* in main](advocates.md#the-bead-that-is-closed-over-a-branch-that-never-reached-main) | which `worktree-*` branches a closed bead owns, and whether any of that work landed | a branch lives only in the checkout it was cut from, so one directory means every other repo's stranded work is silently not there to find — and unlike the three above, nothing else is ever going to notice it |

They are merged, not raced: the first checkout to name a bead wins, in the order the
`approved` list is written, and the repo travels with the answer so the card can say
`#115 already carries this work … — in atrium-service` rather than naming a number that
exists in all forty. **One checkout refusing is not the sweep failing.** A `gh` that times
out in one repo leaves the other thirty-nine's answers standing and says so on the card
(`1 of 3 checkouts did not answer`); only nothing answering anywhere keeps the previous
map, because an empty map holds nothing back and would hand a window to the very bead the
sweep exists to hold.

**A bead naming no checkout is held, not launched.** `resolveSessionRepo` already refuses
an unknown token, a token two approved repos both declare, and a bead labelled `repo:`
twice — but a refusal at launch time surfaces in the two worst places available: it costs
the bead one of its `maxAttemptsPerBead`, and the launch loop treats a refusal the way it
treats iTerm saying no, which is to stop opening windows for the rest of the tick. One
mislabelled bead would have held up every other repo.

So it is the fifth subtraction from `bd ready`, beside the four that were already there,
and it is the odd one out of the family: every other hold resolves itself in time — a
window closes, a pull request merges, an epic's children get done — and this one never
will. It is waiting on somebody editing a label or an approved list. The card draws it in
the P1 tone rather than the muted one for exactly that reason, and its tooltip carries
`lib/repos.js`'s own sentence, which names the fix:

```
2 naming no checkout   cl-9f2 — no approved northwind repo declares the service token "ws" — approved: architecture (architecture), atrium-service (as), bookings-service (bs)
                       cl-a11 — service token "as" is declared by 2 approved northwind repos (atrium-service, audio-service) — beadcause will not guess between them
```

A queue emptied by that filter is **not** a clear queue, and the advocate says so and
proposes nothing over it — the same rule the other four holds keep, for the same reason:
an advocate reporting "clear" and then filing new work, while the beads it cannot place
sit there unmentioned, is the loudest possible version of the bug the filter fixes.

**And the card names the repo.** Each worker row carries the checkout its window is
actually in, read off the directory the launch returned rather than off the bead's label —
so it says where the window *went*, not where it was meant to go, and a `next` row says
which checkout it would open in. The card's own numbers gain one more, `3 checkouts`,
whose tooltip is the approved list — because "northwind" on its own no longer says what
is in scope. All three are absent for every single-repo workspace, which is why there is
no chip saying `sorrel` on a sorrel row. `test/repoqueue.mjs` is the
suite; `multiRepo` being false is what keeps every other workspace from reading a label,
a directory or a `config/config.yaml` at all.

**And so does the housekeeping, for a different reason.** The four sweeps above are
questions whose wrong answer hands out an iTerm window; the three loops below are not,
which is why they were filed rather than swept up with them — bc-u53i, and bc-l853.5 for
the archive. Each wanted its own answer to what "all of them" means, and the three
answers are different.

The **session-log archive** follows the *session*, not the workspace and not a loop over
every repo. `refs/beadcause/sessions/<bead>` lives in the checkout the work happened in —
that is the whole point of storing it in refs rather than a directory, the log travels
with the commits it describes — and the worker record already knows which one, because
`dir` on it is where `openWorkSession` actually opened the window. A loop would have been
the wrong shape: there is exactly one right repo for each log and the record names it.

The **worktree sweep** is the loop, and genuinely N sweeps: `.claude/worktrees/` is per
checkout, so retiring, expiring and slimming each ask one `git worktree list` and one
attic walk per approved repo. There is nothing to merge — a worktree in one repo is not
a candidate answer to a question about another — so the card carries a row per checkout
and the summary names each one that moved:

```
🧹 architecture: retired swr-cache-8t3 · atrium-service: retired poll-stream-rk2o1 (freed 41 MB)
```

One checkout that cannot be swept is not the sweep failing, the same rule the four above
keep: it says `1 of 3 checkouts did not answer` beside what the others did, rather than
reporting a clean sweep of a repo it never looked at. Nothing about this was urgent and
that is worth being honest about — a worktree in `atrium-service` that is never retired
breaks nothing, it simply sits there, and so does the attic behind it, in thirty-nine
repos, forever. A leak rather than a bug, which is why it could wait.

The **survey agent** is the one that is deliberately *not* a loop. A survey is not a
question about a checkout the way "which pull requests are open" is — it is a question
about the tracker, *is this queue genuinely empty*, and there is one of those per
workspace however many repos hang off it. Forty surveys would be forty agents proposing
into one graph, each blind to the other thirty-nine, and `maxProposals` would stop
meaning anything. So it stays one read-only run, opened in the `default` checkout, with
every other approved repo passed to `claude` as `--add-dir` — which is not a nicety:
`claude` refuses a read outside its working directory, so without it the survey proposes
work having read `architecture` and none of the repo the queue is actually about.

The flags are half of it and the prompt is the other half, because an agent handed forty
directories and no sentence about them reads the one it is standing in. So the prompt
names them, says which one is the cwd, and asks for the `repo:` label — that last part
being the one thing the agent could not have worked out by looking, since a proposed bead
carrying no token is not refused. It **resolves**, to the default repo, silently, and
work found in `atrium-service` then reads perfectly well on the card and opens its
session in the wrong tree.

`test/repotidy.mjs` and `test/reposurvey.mjs` are the two suites, and both assert the
half that would be a regression rather than a gap: a single-repo workspace — which is
every workspace on this Mac but Northwind — produces the summary string it always
produced, with no repo prefix and no per-repo rows, and its survey pays no `--add-dir`
and gets no paragraph about checkouts it does not have.

### Every window and every card says which checkout it came up in

Resolving a bead to a directory is half of it. The other half is that the things which
*call* the resolver have to hand it the bead — and all four of them had one in hand
already and were throwing it away, because for the whole of this program's life before
Northwind there was only ever one directory a workspace could mean.

| surface | file | where the bead comes from |
|---|---|---|
| the iTerm session you tap *Discuss* on | `openSession`, `lib/session.js` | the row `POST /api/session` has just read to endorse it |
| the unattended work session an advocate opens | `openWorkSession`, `lib/session.js` | the row `assertEndorsed` re-read from the tracker |
| the terminal on your phone | `openTerminal`, `lib/terminal.js` | the seed, whose `repo:` labels are kept on the record |
| the chat session | `createConsole`, `lib/console.js` | the seed, same |
| the reply agent that answers a comment | `dispatchReply`, `lib/dispatch.js` | the row the route already fetched |

`openWorkSession` is worth reading twice. It resolves from **the row the endorsement
check just read**, not from the queue row the advocate handed it — the same reasoning
that makes `assertEndorsed` ask the tracker rather than trust its caller. That check has
already paid for a `bd show`, a caller-supplied object proves nothing about the bead, and
a `repo:` label added or corrected since the survey ran is the difference between a repo
and the wrong one. This is the only door into an hour of unattended agent, and the wrong
side of it is a checkout nobody meant it to touch.

**A record keeps the labels that decided it.** /admin replaces a terminal whose pty is
gone from its record alone, so `{id, title}` was not enough: the replacement for an
`atrium-service` terminal would have come up in `architecture`. `repoLabelsOf` keeps the
`repo:` labels and nothing else — the whole row would be a stale copy of a bead that has
moved on since, and the labels are the only part of it that decides anything.

Then they say so, on screen, because with N repos behind one workspace name "northwind"
no longer tells you where a window landed:

- **the iTerm tab** — `▶ cl-9f2 · atrium-service · Paging drops the last page`. The repo
  sits *ahead* of the bead's own title on purpose: `windowTitle` clamps at sixty
  characters and the title is what gets eaten, so a window opened in `atrium-service` has
  to still say so when the bead is called something long.
- **the terminal card and the terminal's own title bar** — `northwind · atrium-service`,
  and the phone-sized title bar is the only line on that screen that says it at all.
- **the chat card** — a second pill beside the workspace's, and the opening context tells
  the agent in words which checkout it is standing in rather than leaving it to infer one
  from `~/northwind.dev/…`.
- **the toast on the phone**, the startup log lines, and the reply agent's own log.

None of it appears for a workspace that is one repo. `repo` is `null` all the way
through — no pill, no second half to the log line, and the tab title `sorrel` had before.
That is asserted in `test/openrepo.mjs`, beside the refusals: a seed naming a token
nothing approved, or carrying two different `repo:` labels, **refuses** rather than
opening in the default repo, and it refuses before a pty or a conversation exists.

The two surfaces that are not on this list are the ship and conflict sessions
(`openShipSession`, `openConflictSession`). They are opened from a pull request rather
than from a bead, and which repo a *pull request* is in is the PR board's own question —
see the epic's next child.

### And which branch its pull request is opened into

`resolveSessionDir` answers *where* a bead is worked, and once it does, most of what
follows comes along for free — the worktree is cut in whatever directory the session
opened in, the branch is committed there, `bin/deliver.js` runs `git` and `gh` in the
same place, and the session log lands in that repo's refs because `archiveSession` walks
up from the directory it was handed. None of those had to learn anything new.

Three things did, because they are facts about a **repo** rather than about a workspace,
and the resolver only ever answered the second question.

**The base branch.** `pr.base` was one string for the whole install, and it was right for
as long as a workspace was one repo, because one repo has one base. A workspace holding
forty has forty, and no single setting can name them. So: *one repo, the setting; many
repos, the repo.* A workspace with no approved list answers `pr.base` exactly as it
always did and does not run `gh` even once — asserted in `test/prbase.mjs`, because a
network round trip per delivery in `sorrel` would be bought for a question the config had
already answered. A multi-repo workspace asks GitHub what that repo's default branch is,
and falls back to `pr.base` only when GitHub will not say: no `gh`, not authenticated, no
remote, offline. Falling back rather than refusing is deliberate — a wrong base is caught
immediately by `gh pr create`, which will not open a pull request into a branch that does
not exist, while refusing would take a whole repo out of reach every time the wifi
dropped. `--base` on `bin/deliver.js` still wins over both, which is how a session
delivering somewhere other than its repo's default branch says so.

**And it is asked of GitHub, never of the checkout** — which is the surprising half.
The cheap local answer is `git symbolic-ref refs/remotes/origin/HEAD`, and it is wrong
often enough to be dangerous: that ref is written once, by `clone`, and nothing ever
refreshes it. Every one of the forty-seven Northwind checkouts on this Mac was read, and
three of them name an `origin/HEAD` GitHub disagrees with — `northwind-api-service` and
`signals-repo` both say `origin/develop`, and `storefront-web` says
`origin/NW-5989-bootstrap-nginx`, a feature branch — while GitHub says `main` for all
three. A delivery that trusted the local ref
would open those pull requests into a branch nobody merges, silently, because a pull
request into the wrong base is a perfectly valid pull request. The answer is cached per
`owner/repo` for the life of the process, since a repo's default branch changes about
once in its life; a *null* is not cached, because it means somebody is at a keyboard
running `gh auth login`.

**Whether the repo is on GitHub at all.** `gh` being installed and authenticated says
nothing about whether *this* checkout is a repo any of your accounts can see, and in a
list of forty approved directories one of them not being is an ordinary state rather than
an error. `bin/deliver.js` asks before it pushes and refuses with the directory in the
sentence:

```
beadcause-deliver: no GitHub repo is visible from ~/northwind.dev/tools — nothing there
opens pull requests. The work is committed on worktree-thing-4f2; say so on cl-9f2 and
leave it there.
```

It used to be found out two steps later, by `git push` failing on a missing `origin` or
by `gh pr create` failing on a repo it could not resolve. Both of those name the remote
and neither names the repo, which was fine while a workspace was one checkout and the
repo was never in doubt.

**And the session log follows the session, not the workspace.** `refs/beadcause/sessions/<bead>`
is stored inside the repo the work happened in — that is the whole point of keeping it in
refs rather than in a directory, so the log travels with the commits it describes. The
advocate used to resolve one directory for the whole batch of finished sessions, which
said the same thing while a workspace was one checkout and would have written every
Northwind session's log into `architecture`: the ref would exist, in a repo whose commits
it does not describe, and the repo the work is actually in would have none. It now
archives into the directory each worker was launched in, which the worker record already
carries, so the archive follows the session rather than re-deriving where it should have
been.

**And so do the two sweeps that used to be named here as not doing it.** The
landed-reconcile asks every approved checkout whether GitHub merged a bead's pull
request, and the worktree sweep retires, expires and slims `.claude/worktrees/` in each
of them, naming the repo on the card for every entry that moved — see [what spans repos
and what does not](#one-advocate-many-checkouts--what-spans-repos-and-what-does-not) for
the shape of each and why the survey agent, the third of the family, is deliberately one
run across N repos rather than N runs.

### A workspace whose integration branch is not `main`

`pr.base` is one string for the whole install, and the rule above splits it only one
way: many repos, and each repo answers for itself. There is a second shape it did not
cover — **one** repo, so nothing about the approved-list path applies, and yet its work
does not land in `main`. Its integration branch is somewhere else, and every pull request
opened against the install-wide `pr.base` would target a branch that repo never merges
into. A pull request into the wrong
base is a perfectly valid pull request; nothing fails, the merge queue just brings the
wrong branch in and lands the work somewhere nobody is looking.

Moving the global is not available: every other workspace does merge into `main`. So the
setting is a map beside itself — `pr.basePerWorkspace`, keyed by workspace name like
`autoMergePerWorkspace` and `jira`, and shipped empty; a workspace that needs one says so
in its own config:

```json
"pr": {
  "base": "main",
  "basePerWorkspace": { "atelier": "release/next" }
}
```

**It sits underneath the repo, not over it.** A multi-repo workspace still asks GitHub
first and reaches the override only where it would have reached `pr.base` — offline, no
`gh`, no remote. That is deliberate and it is the same argument as before: one string
cannot be the right base for forty repos, and a workspace that has forty already has a
better answer per repo. In practice the two shapes never meet, because every workspace
with an integration branch of its own here is one repo. `--base` on `bin/deliver.js`
still wins over both, which is how a single delivery says it is going somewhere else
again.

**Anything in the map that is not a branch name is ignored rather than coerced.** It is a
map people hand-edit, and `{"atelier": true}` asked for nothing legible — reading it as a
branch would open pull requests against `true`. Absent falls through to `pr.base`, which
is what every workspace not named there already gets, so a config written before the key
existed answers exactly as it did. The same rule the [per-workspace
booleans](#policy-stays-per-space-even-when-a-workspace-is-forty-repos) keep, for the
same reason.

Everything reads it through `lib/prbase.js`, which is the point of having the file at
all. `baseFor` serves the callers that have a directory in hand and can therefore ask the
repo — `bin/deliver.js`, the pull-request board's per-repo rows, and the
`git merge origin/<base>` line in a worker's brief. `configuredBase(cfg, workspaceName)`
serves the rest, which resolve the *setting* and never asked GitHub in the first place:
the advocate's landed-reconcile and its two in-main sweeps and their follow-up, the
board's own merge-and-land button, and the branch a declared deploy fast-forwards to
before it runs. That last one is why this was worth doing in one pass rather than
stopping at the pull request — a workspace whose deploy fast-forwarded to `origin/main`
when its work lands elsewhere would ship a branch its work never reaches, and that failure is entirely silent. None of them
asks GitHub per repo now either; the per-repo half of *that* question is bc-lde0's and
stays where it was.

`test/prbase.mjs` covers both directions, and asserts that the shipped map is empty —
a workspace's branch is its own to declare (bc-j2zwo.3).

### Policy stays per space, even when a workspace is forty repos

Five settings decide what an unattended agent may do without you having looked at it:
whether it may answer a comment (`autoDispatch`), whether a bead it filed is workable
before you have read it (`autoEndorse`), whether it merges its own pull request
(`autoMerge`, `requireApproval`), and whether that merge deploys itself (`autoShip`). They
are answers a [space](asking.md#spaces--keeping-work-out-of-your-evening) gives, and a space is a
set of *workspaces* — which was the same thing as a set of repos until the block above
existed. Now one `autoMerge` governs forty checkouts of a company's org, and the settings
were written arguing for a setup they can no longer express: **on everywhere except the
shared repo**, which stops meaning anything the moment the shared repo and the private one
are the same workspace.

**They stay per space, and Northwind gets one answer.** Not by omission — four reasons,
and the second is the one that settles it.

One of the five does take a finer answer, and it is a different question: `autoEndorse`
has a [per-workspace override](asking.md#one-repo-may-answer-for-itself-on-the-six-settings-where-it-matters)
that outranks the space, so one workspace in a space may answer for itself. That is the
grain the second reason below is about — a graph and who reads it — and it leaves this
section's question exactly where it is: no setting here answers per checkout *inside* a
workspace, `autoEndorse` included.

**What varies between repos is not what these ask.** Every one of them asks whether an
agent may act while nobody is watching, and what makes that differ between two checkouts
is whether anybody else reads the repo. Inside an org it does not differ: all forty have
colleagues on them, and `architecture` is not the shared one among private siblings — it
is the *most* shared, because it also holds the workspace's Dolt remote.

**The trust boundary is the tracker, and there is one of it.** `autoDispatchExclude` is
per workspace because a workspace is a graph, and a graph other people read must never be
auto-answered whatever space it lands in. Every Northwind repo files into one `cl-` graph:
a bead in it is visible, editable and answerable by everyone in the org, whichever checkout
it is about. So "who else sees this, and would they mind an agent acting on it unasked" is
a fact about the workspace rather than about the directory, and a per-repo answer would be
a finer grain than the thing it is describing.

**An override could only ever loosen, and there is nowhere safe to point it.** A space set
conservatively for a shared org plus an exception for one repo is a mechanism whose only
use is letting one checkout out of the answer the shared tracker earned — and that repo's
beads are still in the shared graph, so an agent working one unasked is still acting on
work a colleague filed. A conservative-only veto beside `autoDispatchExclude` buys nothing
either, because the space is already *at* the conservative answer. A repo that genuinely
wants a looser answer than the tracker's is a repo whose work does not belong in that
tracker: take it out of `approved` and give it its own workspace, which is what every
non-Northwind repo already is.

**And it could not be set from where these get set.** The
[space details card](asking.md#space-details--every-setting-a-space-has-on-a-page-of-its-own) exists because a
policy you can only change by editing `config.json` at a keyboard stays wrong until you
are next at one. A per-repo answer would live in the `repos` block — a config-file act,
which is the failure that card ended — and making it phone-settable means forty rows of
five toggles on a 393px screen, which is not a screen. It is not a field either: every
resolver in `lib/spaces.js` takes a workspace *name*, and which repo a bead is about is a
fact about the bead, so this is an argument threaded through eight call sites rather than a
key.

What the decision does oblige is that the screen stop implying one repo per row — hence
the `12 checkouts, one answer` tag in the panel above the settings. The argument lives in
`lib/spaces.js`, above `autoDispatchAllowed`, where anybody about to add the override will
read it; `node test/spacedetails.mjs` holds both halves, including a check that the five
resolvers still take nothing finer than a workspace, so the decision has to be revisited
deliberately rather than drifted through.

### Environment

| variable | meaning |
|---|---|
| `BEADCAUSE_CONFIG_DIR` | where the config, state and tokens live (default `~/.config/beadcause`). Isolates **only those** — see [observer mode](development.md#a-second-instance--observer-mode) before booting a second instance |
| `BEADCAUSE_OBSERVE` | watch and never act: no sessions, proposals, sweeps, session logs, reply agents or pushes. `BEADCAUSE_READONLY` is the same flag |
| `BEADCAUSE_NODE` | the `node` the LaunchAgent runs (`scripts/install.sh`, `scripts/open-monitor.sh`) |
| `BEADCAUSE_BROWSER` | which browser `scripts/open-monitor.sh` opens the console in |
| `SKIP_CONFIGURE` | `scripts/install.sh` asks nothing and keeps the answers on file — the same as `--non-interactive`. `CLAUDECODE`, `AI_AGENT` and `CI` imply it, because a question asked of a terminal nobody is watching is a hang; `--interactive` asks anyway |
| `BEADCAUSE_GOOGLE_CLIENT_SECRET` | the Google OAuth client secret, taking precedence over the secret file. The one place it leaves no copy on disk — see [rotating the two secrets](integrations.md#where-the-two-secrets-live-and-how-to-rotate-them) |
| `BEADCAUSE_SESSION_KEY` | the HMAC key sessions are signed with, instead of `~/.config/beadcause/session.key`. Setting it to a new value signs everybody out |
| `BEADCAUSE_SLACK_BOT_TOKEN`, `BEADCAUSE_SLACK_APP_TOKEN` | the two Slack tokens, taking precedence over their files. The one place they leave no copy on disk — see [Slack](integrations.md#slack--the-same-decision-in-a-channel) |
| `JIRA_API_TOKEN` | a JIRA API token, taking precedence over the per-workspace `.key` file for the same reason the Google one does — it leaves no copy on disk. The daemon runs under launchd and will not have it; this is for a hand-run script or a test |
| `BEADCAUSE_TAILSCALE` | the `tailscale` binary, overriding the three macOS paths that are searched by default. Has to exist to count — a path typed wrong reads as "no tailscale" rather than failing mysteriously later. See [renewing the certificate](operations.md#renewing-it-before-it-expires) |
| `BEADCAUSE_CANDIDATE_ROOT` | the checkout whose `.claude/candidates/` `bin/router.js` stands green up from, instead of its own. For `test/routergreen.mjs`, which cannot put a fake candidate in a real checkout — see [candidates](operations.md#candidates--what-a-green-backend-will-be-spawned-from) |
| `BEADCAUSE_PORT_CLAIMS` | where `test/helpers/net.mjs` notes the ports a run has taken (default `/tmp/beadcause-ports`). One directory for every account on the machine is the point — `os.tmpdir()` is per-user on macOS, so a local gate and a CI shard under another account used to claim where neither could see the other. See [a port is not a number two runs may both pick](development.md#a-port-is-not-a-number-two-runs-may-both-pick--testhelpersnetmjs) |
| `BEADCAUSE_TEAM_FILE` | the team profile to read instead of `team.json` in the checkout. For trying a profile before six people clone it, and for the suite that drives the onboarding against a local remote — see [installing against a team's tracker](install.md#installing-against-a-teams-tracker) |

### Every state file is replaced, never overwritten

Everything beadcause remembers between restarts is a small JSON file in that
directory: `config.json`, `state.json` (what has been pushed), `status.json` (what
each agent is doing), `advocates.json`, and one file per chat session under
`consoles/`. All of them used to be written with a bare `fs.writeFileSync`, which
truncates the file to zero and *then* writes — so a crash, a `kill -9`, a full
disk or a lid closing inside that window did not cost you the last change, it cost
you the whole file.

Worse, it cost it quietly. Every reader here treats an unparseable state file as
an absent one, because that is the right thing to do the first time you run:
`loadState` returns `{ notified: [] }`, `readAll` returns `{}`. So a torn file
does not raise anything. It just means every question is unread again, every
cooldown has reset, and the chat sessions you had open are gone — and nothing in the
log says why.

`lib/atomic.js` writes to a temp file beside the target, `fsync`s it, and renames
it over the top. `rename(2)` is atomic within a filesystem, so a reader sees the
whole old file or the whole new one and there is never an instant where the name
does not resolve. The `fsync` before the rename is the half that is easy to skip:
without it the rename can reach disk ahead of the data it points at, which turns a
power cut into a correctly-named empty file — intact-looking, and therefore worse.

`npm test` proves it — `test/atomic.mjs` SIGKILLs a child that is writing in a
loop and asserts the survivor is always a whole version. Run
`node test/atomic.mjs --baseline` to watch the plain `writeFileSync` it replaced
lose the file outright; that run is what makes a pass mean anything.

The temp prompt files handed to `claude` are deliberately left alone: they are
born, read once and deleted, so a torn one is a failed spawn rather than lost
state.

That covers a file being *torn*. What it cannot cover is a file being rewritten
with something you did not want — for which the directory is now a git repo and
every one of these files is committed after it changes. See
[the state files get a history for free](agents.md#the-state-files-get-a-history-for-free).

### Privacy of the push

An ntfy.sh topic is readable by anyone who guesses its name. The topic is random,
but work questions still default to `minimal`: the notification says only that a
decision is waiting, and the content lives behind the tailnet. Self-host ntfy and
set `ntfy.detail` per taste if you'd rather have full pushes everywhere.

The click URL deliberately carries **no** token — the PWA already has one from the
setup link, and everything in a push transits the relay. The action buttons are
the exception: they must send the token as a header to authenticate the POST. So
a `full` push on a public server does place the token on ntfy.sh. It's useless
without tailnet access, but if that bothers you, either self-host ntfy or set
`ntfy.actionButtons: false` and answer by tapping through to the app.
