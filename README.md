# Beadcause

Answer `bd human` questions from your phone — with the diagram, the images and
the links that make the decision answerable, not just a line of text and two
buttons.

A Node daemon on the Mac reads every beads workspace under `~/beads/`, serves a
mobile-first PWA over Tailscale, and pushes new questions to ntfy. Answering
comments on the bead and closes it, so whatever was blocked on the answer turns
up in `bd ready` for the next agent session.

```
agent files a `human` bead ──► beadcause polls ──► ntfy push to phone
                                                       │
                              PWA over Tailscale ◄─────┘ (tap)
                                       │
                            bd comment + bd close ──► `bd ready` unblocks
```

## Getting started

macOS only — it runs as a launchd agent and drives iTerm2. You need
[Homebrew](https://brew.sh); the installer uses it to install whatever else is missing.

```bash
git clone <this repo> beadcause && cd beadcause
npm run install-service
```

That answers on `http://127.0.0.1:4318`, on this Mac only. Phone support is off by
default — `npm run install-service -- --phone` adds Tailscale and prints the pairing QR.

Everything else about setting up — the questions the installer asks, joining a tracker
somebody else already has, the everyday commands, and why you never restart the
service after editing `lib/` — is in **[docs/install.md](docs/install.md)**.

## What it does

- **A question arrives on your phone.** An agent files a `human` bead; the daemon
  polls, pushes to ntfy, and the card shows the diagram, images and links that make
  it answerable. See [asking](docs/asking.md#asking-a-question) and [answering](docs/answering.md#answering).
- **Work is scoped to a space**, so a shared repo's questions don't land in your
  evening — [spaces](docs/asking.md#spaces--keeping-work-out-of-your-evening).
- **An agent per repo works the queue down.** Advocates find ready work, open
  sessions on it, and stop when the queue reaches zero —
  [advocates](docs/advocates.md#advocates--an-agent-per-repo-whose-job-is-the-queue-reaching-zero).
- **Work lands through a merge queue**, not a push: a branch, a pull request, an
  approval, a downmerge — [landing work](docs/landing.md#landing-work--a-branch-a-pull-request-and-a-merge-queue).
- **An error the app hits files itself** as a P0 bead rather than a log line —
  [incidents](docs/incidents.md#an-error-the-app-hits-files-itself-as-a-p0).
- **The compliance programme is the app.** Controls, evidence, the registers and the
  gap assessment are generated from the running system, not maintained beside it —
  [compliance](docs/compliance.md#the-control-corpus--six-standards-in-one-closed-vocabulary).
- **Roughly ninety `b7e-*` commands** are the surface agents use to ask this repo
  about itself — [the b7e tools](docs/b7e-tools.md).

## The documentation

This README is the summary. The specification is the documents below — seventeen chapters
plus `docs/b7e/`, a file per `b7e-*` tool (bc-fmk4v) — and
`b7e-readme <term>` finds the section that covers something without reading them.

| Document | What is in it |
| --- | --- |
| [install.md](docs/install.md) | Installing the service, the questions it asks, joining a team's tracker, the everyday commands |
| [asking.md](docs/asking.md) | What a question is, accounts, and spaces — keeping a shared repo out of your evening |
| [answering.md](docs/answering.md) | Answering a question: the reply, the close, and what unblocks |
| [agents.md](docs/agents.md) | What an agent is, what it remembers, what it can see, and which steps are code |
| [inbox.md](docs/inbox.md) | The inbox, and what a question is blocking |
| [navigating.md](docs/navigating.md) | The pill row, repo views, the mirror, current sessions, editing the app from inside it |
| [pull-requests.md](docs/pull-requests.md) | Pull requests through review, merge, push, deploy and live — and the endorsement queue |
| [incidents.md](docs/incidents.md) | An error filing itself as a P0, and the nonconformity that is not a refusal |
| [advocates.md](docs/advocates.md) | An agent per repo whose job is the queue reaching zero — dispatch, epics, relays, sessions |
| [b7e-tools.md](docs/b7e-tools.md) | The `b7e-*` command surface: how a tool declares itself, and the Skills view |
| [b7e/](docs/b7e/) | One file per `b7e-*` tool — roughly a hundred of them, each with what it takes and what it answers. `b7e-readme <term>` and `b7e-which` read the directory; there is deliberately no committed list, because a list is one more place every new tool would have to append to |
| [landing.md](docs/landing.md) | A branch, a pull request, and a merge queue |
| [compliance.md](docs/compliance.md) | The control corpus, control-to-evidence, the generated registers, and the AI policy, scope, interested parties and roles |
| [android.md](docs/android.md) | The Android app, chat sessions, the terminal, and progress |
| [operations.md](docs/operations.md) | The router, the monitor, timings, the shared cache, the tailnet, and the HTTP API |
| [integrations.md](docs/integrations.md) | Signing in with Google, Slack, Confluence, and the access register |
| [config.md](docs/config.md) | Every key in `~/.config/beadcause/config.json` |
| [development.md](docs/development.md) | `npm test`, the gate, the suites, a second instance in observer mode, and notes on `bd` |

Three notes sit alongside them: a [UX review](docs/ux-review.md), the
[IDE websocket spike](docs/ide-websocket-spike.md) and the
[Temporal merge-queue spike](docs/temporal-merge-queue-spike.md). Wireframes are in
[`design/`](design/); service-worker cache notes are in [`docs/sw-cache/`](docs/sw-cache/).
