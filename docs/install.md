# Installing beadcause

## Install

macOS only — it runs as a launchd agent and drives iTerm2.

**You need:** [Homebrew](https://brew.sh). The installer uses it to install whatever else
is missing — Node 20+, the [`bd`](https://github.com/steveyegge/beads) CLI (upgraded if
older than **1.2.1**), `gh`, `jq`, iTerm2 and Claude Code; `--no-deps` makes it only
check. Sign `claude` in once in a terminal. Workspaces are read from `~/beads/<name>/.beads`
or wherever [`workspaceRoots`](config.md#where-trackers-live--workspaceroots-and-the-two-shapes-a-root-can-have) points.

**Phone support is off by default** — beadcause answers on `http://127.0.0.1:4318`, on this
Mac only. Turn it on later with `npm run install-service -- --phone`: that installs
[Tailscale](https://tailscale.com) (from a terminal — its installer wants an admin password),
listens on the tailnet address too, and prints the pairing QR. Sign Tailscale in on the Mac
and the phone as the same user first.

```bash
git clone <this repo> beadcause && cd beadcause
npm run install-service
```

That installs anything missing, installs dependencies, **points this Mac at the team's
tracker if there is one**, **asks you the handful of things that can't be guessed**,
generates a launchd plist for *your* home directory and node binary, starts the service,
waits for it to answer, and — with `--phone` — prints the pairing QR. It's re-runnable — run it again after
pulling. Joining a tracker somebody else already has needs one file and no questions at
all: [installing against a team's tracker](#installing-against-a-teams-tracker).

The questions, all with a safe default on Enter: **where your workspaces live** (the
directories discovery reads, `~/beads` unless you say otherwise), **what the agents should call you**
(the name every prompt, pull request body and bead note uses — guessed from your git
identity), which workspaces are **shared with
other people** (those get a contentless push and no unattended agents), where your
**code lives** (so a question can show you files from it), whether your shell
**derives `BEADS_DIR` from the working directory**, whether to use **ntfy**,
which **[Slack channel](integrations.md#slack--the-same-decision-in-a-channel)** questions should also
be posted to, whether commenting should **spawn an agent** to answer you, whether to open
the **[activity monitor](operations.md#the-monitor--what-it-is-doing-right-now)** at login, and the two
sets of credentials — **[Confluence](integrations.md#setting-it-up-without-opening-the-file)** and
**[signing in with Google](integrations.md#signing-in-with-google)**. A workspace
holding **more than one repo** is asked one more: which of the checkouts under it are
[approved](config.md#many-repos-one-workspace--the-approved-list-and-the-token-that-names-each),
printed with the service token each one declares — an install where every workspace is one
repo is asked nothing about it. Re-run them any time with `npm run configure`; nothing is
written until the last answer — not even the two credentials, which go to files of their
own — so Ctrl+C is always safe. The one exception is a machine where the first question
finds no tracker at all: the roots you just named are saved before it stops, because they
are what the run was worth and `bd bootstrap` is the next step, not another typing of the
same path.

**Nothing to answer? Say so.** `npm run install-service -- --non-interactive` (or
`SKIP_CONFIGURE=1`) prints the configuration on file and changes none of it. An agent
session or CI is assumed to mean that already — `--interactive` asks anyway. The
questions are read from `/dev/tty` rather than stdin, because `npm run` pipes stdin;
but `/dev/tty` is the *controlling terminal*, not a person, so in an agent session
they are asked of nobody and the install waits forever on the first one. Working
around that by dropping the terminal (`setsid`) leaves the GUI session too, and
`launchctl bootstrap gui/<uid>` then fails — after the bootout, so the daemon ends up
unloaded. The flag exists so neither workaround is needed.

Relatedly, a load that fails now puts back what it replaced. The installer bootstraps
a job that does nothing before it boots the real one out, so a session that cannot
load launchd jobs at all is found out while the service is still running rather than
after it has been stopped; and a plist launchd refuses is set aside as
`n12n.beadcause.plist.rejected` while the previous one is restored and loaded again.
It still exits non-zero — it just never exits with nothing running.

```bash
npm run monitor              # live view of what the daemon is doing
npm run onboard              # is this Mac pointed at the team's tracker? (--dry-run to ask)
npm run check                # the checks around the agent log — safe with the daemon up
                             # (also run inside `npm test`, as test/agentlog.mjs)
npm run secrets              # has a secret ever reached the config repo's history?
npm run scrub -- --out <dir> # a public snapshot of HEAD, scrubbed by scrub.json, then gated
                             # (--commit to commit it, --check <dir> to gate one; never pushes)
                             # (published by hand to github.com/NeanderthalMan/bdcz)
npm run agentrepo            # is the tier 3 experiment actually running, and in both arms?
npm run swap:status          # which build is answering the port, and the certificate on it
npm run uninstall-service    # remove the service (keeps your config and token)
tail -f ~/Library/Logs/beadcause.log
launchctl kickstart -k gui/$(id -u)/n12n.beadcause   # only for bin/router.js itself
```

**You do not restart it after editing `lib/`.** What launchd runs is
[the router](operations.md#the-router--why-you-never-restart-it), which swaps a fresh backend in
under the port a few seconds after the files settle.

The plist is generated, never committed: a checked-in one cannot work on a second
machine, because `node` alone moves between `/opt/homebrew/bin`, `/usr/local/bin`
and any number of nvm paths. Kill any hand-started instance before installing — a
second one can't bind the port, and it exits 1 rather than lingering, because
otherwise its poller would keep firing notifications with no listener behind them.

### Installing against a team's tracker

Everything above was written for somebody setting up their own laptop, and for the
**second** person onward almost every step of it quietly does nothing useful. This is the
half that gets a new machine to the point where [a shared tracker](operations.md#a-tracker-two-macs-share)
means anything, and it is one file plus one command.

Three things are wrong on a fresh clone, and none of them looks wrong:

- **The workspace does not exist.** `~/beads/<name>/.beads` was made once, by hand, on
  somebody else's Mac. Here, `~/beads` is readdir'd, nothing is found, `npm run configure`
  prints *No beads workspaces found* and exits 0, and the daemon comes up perfectly,
  serving an empty inbox.
- **A plain `git clone` fetches no beads.** Dolt data rides `refs/dolt/data`, which git
  does not pull, so even with the workspace in place the tracker stays empty until
  somebody runs `bd bootstrap`.
- **The questions get six different answers.** The one that matters is *which workspaces
  are shared*: it decides where an unattended agent may comment on a graph the whole team
  reads, and it must not depend on who read the question carefully.

**`team.json`, in the checkout, committed.** The shared half of the answer stops being a
question and becomes a file everybody already has a copy of; changing it is a pull request
rather than six conversations.

```json
{
  "note": "the tracker is on refs/dolt/data in the architecture repo — see #eng-tools",
  "trackers": [
    {
      "workspace": "acme",
      "remote": "git+ssh://git@github.com/acme/architecture.git"
    }
  ],
  "policy": { "sync": { "seconds": 120 } }
}
```

That is the whole file. `dir` may be given when the workspace does not live under
`~/beads/<workspace>` — Northwind's lives inside the `architecture` checkout, because that
is the repo the team already clones — and `shared` may be set to `false`, though a tracker
with a remote is by definition one somebody else reads, so it defaults to `true`. `note`
exists because JSON has none, and a file the whole team edits with nowhere to say why
accumulates changes nobody can date.

**A tracker inside a checkout is somewhere different on every Mac.** Where somebody clones
`architecture` is theirs to decide, so a fixed `dir` is right on the Mac that wrote it and
wrong on the next one. Set `"checkout": true` and `dir` becomes only the suggestion:

```json
{ "workspace": "northwind", "remote": "git+ssh://git@github.com/northwind/architecture.git",
  "checkout": true, "dir": "~/northwind.dev/architecture" }
```

Onboarding then looks for a clone of the remote's repo — by its git remotes, not its name —
at `dir`, then at `~/*/architecture` and `~/*/*/architecture`, and asks *"Where is your
clone of github.com/northwind/architecture?"* with what it found as the default. An answer
that is not a clone of that repo is asked again. The answer goes into this Mac's
[`workspaceDirs`](config.md), which is also what the daemon reads to find the workspace, so
it is asked once — unless that name is `null` there, a retired tracker, which an install
never brings back. Without a terminal, or whenever the installer would not ask its setup
questions (`--non-interactive`, `SKIP_CONFIGURE`, an agent session, CI — `--interactive`
overrides), the clone it found is the answer; `npm run onboard -- --dir northwind=<path>`
says it outright. If there is no clone at all, or what it settled on is not one and nobody
named it, the install **stops** (exit 1) rather than making `.beads` in an empty directory
beside wherever your real clone is.

**Then, on the new Mac, the whole of it:**

```bash
git clone <this repo> beadcause && cd beadcause
npm run install-service -- --non-interactive     # set it up the way the team has it
```

`--non-interactive` is the answer to "how do I get what everyone else has": the policy
comes from the committed profile, and everything it is *not* allowed to carry is guessed
per machine — your name from your git identity, a fresh token, a fresh ntfy topic. Run it
without the flag and you get the same thing plus the questions, whose defaults are now
what the team decided rather than a blank.

The installer does the tracker **before** the questions, because on a fresh Mac there is
no workspace for them to be about. For each tracker it writes `sync.remote` into
`.beads/config.yaml` — bd's own file, comments and all — and runs `bd bootstrap`, which
reads that line and clones. You can run it on its own at any time, and ask what it would
do without doing it:

```bash
npm run onboard                  # create and bootstrap what is missing
npm run onboard -- --dry-run     # print the plan and change nothing
```

**What a profile may not contain, enforced rather than documented.** `owner`, `me`, the
token, the ntfy topic, `baseUrl`, `port`, `assetRoots`, `projectRoot`, `advocates`, and
both sets of credentials. Those are already per-machine and already right, and a file that
set them would make six Macs claim to be the same person — one topic is six phones buzzing
for one question, and one `me` is [an addressee](operations.md#who-a-question-is-for--me-and-the-for-label)
that means nothing. A key not on the allowlist is a **refusal, not an ignored line**: a
setting silently dropped from a file the whole team reviewed is a policy they all believe
they have. `policy` is the same allowlist from the other end, and it has one key today —
a setting belongs there only if having it different on two machines changes how the
*shared graph* behaves, which is true of the sync interval (the collision window is only
as narrow as the slowest machine's) and not true of `autoDispatch`, whose global flag
governs your own private workspaces.

What the shared trackers *do* set, without anybody being asked, is the three protections
that used to depend on question 3: no unattended agent comments on them
(`autoDispatchExclude`), their questions push a contentless nudge rather than the text
(`ntfy.minimalWorkspaces`), and beads an agent files itself keep waiting for a tap
(`autoEndorsePerWorkspace`). All three are additive — a name you added yourself is never
removed.

**Two states are refused rather than repaired, and this is the part worth reading before
you improvise.** If a beads database already sits where the team's tracker goes — you ran
`bd init` first, or `bd-newws`, or the workspace is somebody's private one — the install
stops, at exit 1, before anything has been loaded or unloaded. It is not fixable from
there: `bd bootstrap` will not clone over a database that exists (`can't create database
beads; database exists`), so the team's history never arrives, and the first `bd dolt pull`
of the sync tick is then asked to merge two unrelated histories. That is the one outcome
[nothing retries its way out of](operations.md#a-sync-that-stopped-is-loud-and-a-conflict-is-louder): a
conflict, on every tick, until a person sorts it out. Move the local one aside and onboard
into the empty space, or give the team's tracker a `dir` of its own. The same refusal
covers a workspace already wired to a *different* remote, which nothing here rewrites.

The order is the whole thing: **bootstrap before the workspace has ever been written to.**

**An empty tracker is said out loud rather than left to look like a broken install.** The
onboarding prints the bead count it ended up with, and when that is zero it says what zero
means — the remote genuinely has none yet, or somebody pushed somewhere else. A step that
*fails* (no network, ssh locked) only warns and the install carries on, because the
daemon's own sync banner keeps saying so until it works, and `npm run onboard` picks up
where it stopped.

`BEADCAUSE_TEAM_FILE` points at a profile somewhere else, for trying one before six people
clone it. With no `team.json` at all, none of this happens: one line, exit 0, and every
solo install behaves exactly as it always did.

### Pairing a phone

1. **Both devices on the tailnet.** `tailscale status` should list them both.
2. **Scan the QR** from `npm run qr` (or `node bin/beadcause.js --url` for the same
   link as text). It carries the token, which is captured into localStorage and
   stripped from the address bar on first load. `npm run qr` prints **two** codes —
   the pairing link, then the APK with its size and build time, whenever one has
   been published; `npm run android` ends with the same install code, because a
   build ends where the install begins and nobody should thumb a tailnet name, a port
   and a path into a phone. The link is `https://<host>.<tailnet>.ts.net:4318` once
   the tailnet can issue certificates, and the Tailscale address over plain http until
   then — see [the URL you are given](operations.md#the-url-you-are-given-and-what-happens-to-a-phone-that-already-has-one).
   The http one pairs a browser and not the Android app, and `npm run qr`
   [says so on the spot](operations.md#npm-run-qr-says-when-the-link-is-a-browser-only-one) rather
   than leaving you to find out with the phone in your hand.
   Every device needs this once — a
   notification opened on an unpaired phone lands on the token prompt, or on the
   [sign-in screen](integrations.md#signing-in-with-google) if you have configured Google, which either
   way is the tell. **A phone paired before the URL moved needs it a second time**, because the
   token is stored per origin and the name is a different origin from the address.
3. **Share → Add to Home Screen**, and it installs as a standalone app. Android
   users can instead install the native app — see [The Android app](android.md#the-android-app).
4. **Push:** the Android app posts its own notifications over the tailnet and needs
   nothing else. For the PWA, install [ntfy](https://ntfy.sh) and subscribe to the
   topic printed at startup, then set `ntfy.enabled: true` in the config.

### Worth knowing before you rely on it

- **`~/.config/beadcause/config.json` is written on first run** and holds the shared
  token. Everything below is tunable there; see [Config](config.md#config--configbeadcauseconfigjson).
- **`assetRoots`** is what a question may show you — images, documents and audio clips outside it
  are refused. Setup asks for your code directory; add more later.
- **Sessions open in `~/beads/<workspace>` by default**, which always works. Setup
  asks whether your shell derives `BEADS_DIR` from the working directory; see
  [Discussing a question on the Mac](android.md#discussing-a-question-on-the-mac).
- **The trackers an advocate works get their own Dolt server**, and the rest stay on
  the embedded engine. `bd` reads a workspace four to seven times faster through a
  per-project `dolt sql-server` — measured on the real trackers, loremia's 1560 issues
  answer a `bd list` in 111ms on a server where sorrel's 398 take 526ms embedded — which
  is worth having where an agent makes thousands of those calls and not worth ~90-400MB
  of resident memory where nobody is reading. Setup asks; [`doltServer`](config.md) is
  `advocated` (the default), `all` or `off`; `npm run dolt-mode` applies it and
  `npm run dolt-mode -- --revert <workspace>` is the way back. Nothing is supervised —
  bd starts each server itself on the first call and a tracker nobody touches never
  runs one. A tracker whose `.beads/metadata.json` is committed (a team's in-repo
  graph) is refused rather than changed, because the setting names an absolute path on
  one Mac. See `lib/doltmode.js`.
- **Nothing is exposed beyond the tailnet.** The router binds `127.0.0.1` and your
  Tailscale IP, never `0.0.0.0`; the backends behind it bind loopback only.
- **The tailnet address is HTTPS**, with a real certificate for your MagicDNS name and
  a TLS 1.2 floor — once *HTTPS Certificates* is enabled for the tailnet. Until then it
  logs why, serves plain http, and keeps asking: a certificate that turns up later goes
  onto the socket it is already holding, with no restart. Loopback is plain http on
  purpose. The daemon [renews the certificate under itself](operations.md#renewing-it-before-it-expires)
  and pushes to your phone if it ever cannot, and the **Admin screen** turns it on, says
  what it will cost and hands you the new pairing code — see
  [the switch on the Admin screen](operations.md#the-switch-on-the-admin-screen) and
  [HTTPS on the tailnet name](operations.md#https-on-the-tailnet-name).
- **Two credentials, and the token is not going anywhere.** Everything that is not a
  browser uses the shared token, exactly as it always did. A browser can *also* sign in
  with Google against an allowlist of addresses, once you configure one — see
  [Signing in with Google](integrations.md#signing-in-with-google). Configure nothing and nothing
  changes.
- **Editing `lib/` needs no restart.** The router swaps a fresh backend in under the
  port a few seconds later — see [The router](operations.md#the-router--why-you-never-restart-it)
  for what it will and will not do for you.
- **`npm run check` is one suite of the gate, not a second gate.** It is one file —
  `scripts/check-agent-log.js`, the contract the
  [session log](agents.md#watching-it-work--the-session-log) rests on — kept as its own command
  because it runs against a throwaway config directory on an ephemeral port and never
  touches `bd`, so it is safe to run with the daemon up and it answers *did I break the
  pane?* in a fifth of a second. It is **also** inside `npm test`, as
  [`test/agentlog.mjs`](development.md#the-session-log-contract-is-inside-the-gate--testagentlogmjs), so
  forgetting to type it is no longer the same as not having it. The suite proper is
  `npm test`, and the browser checks it deliberately leaves out — they want a Chrome —
  are `npm run checks`, all of them, four at a time, with a list of which failed. See
  [`npm run checks`](development.md#npm-run-checks--the-browser-half-and-why-npm-test-can-still-see-it-rot),
  including the static selector audit that runs inside `npm test` and is the reason a
  removed chip no longer breaks a check in silence.
