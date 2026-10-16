# Integrations — Google, Slack and Confluence

## Signing in with Google

There are **two** credentials, and which one a caller uses is decided by whether it can
hold a cookie. The token is the original and it is going nowhere; Google sign-in is
beside it, for the one caller that has a face.

| | credential | who uses it |
|---|---|---|
| **The shared token** | `x-beadcause-token: <token>`, or `?t=<token>` on a link | ntfy action buttons, `lib/notify.js` calling back to cancel a push, the Android app, `scripts/shot.mjs`, `bin/router.js`'s proxy hop and its `/internal/*` control plane, `npm run check`, `curl` |
| **A Google session** | a signed httpOnly cookie, from an address on the allowlist | a browser, and only a browser |

**The order is the compatibility guarantee.** The token is asked first on every single
request, and a request that has it never reaches the sign-in code at all — whether
sign-in is configured or not. Nothing in the list above can perform a redirect dance:
an action button POSTs an answer from the notification shade, the Android app is Kotlin,
`shot.mjs` drives a headless Chrome that has never signed into anything. Sign-in is
purely additive, and `test/auth.mjs` asserts that in both directions — the token working
with sign-in on, and a page with no credential still being served with sign-in off.

**It is off until it is configured, and "configured" is strict.** All three of a client
id, a secret and a non-empty allowlist, *and* something to serve an https callback from.

**`npm run configure` asks for all of it** — the last question in that script. It prints
the redirect URI to paste into the Google console rather than asking you to remember it,
takes the secret with the echo turned off and writes it to the file below at 0600, and
**says which piece is missing** if what you gave it is not enough to switch sign-in on.
That last part is why the question exists: short of all four, sign-in is off with one
line in the log at startup, and that log is not the thing anybody is looking at when a
login screen will not let them past. The same verdict is on the summary it prints at the
end (`google sign-in : NOT on — the allowlist is empty`), so re-running it in a pipe is a
way to ask what state sign-in is in. Answer `none` to the client id to turn it off again.

By hand, it is these:

```json
"auth": {
  "google": {
    "clientId": "1234-abc.apps.googleusercontent.com",
    "allowed": ["you@gmail.com"]
  }
}
```

```bash
# the secret goes in a file, never in config.json — see below for why
printf '%s' 'GOCSPX-…' > ~/.config/beadcause/google-client-secret.key
chmod 600 ~/.config/beadcause/google-client-secret.key
```

Anything less and the token stays the only credential, with the reason in the log
(`[auth] Google sign-in is off — …`). That includes having no certificate yet: Google
refuses a plain-http redirect URI, and a `Secure` cookie is dropped by the browser over
plain http — so half-configured, sign-in would be a login screen nobody could get past,
in front of the inbox that explains why. See
[HTTPS on the tailnet name](operations.md#https-on-the-tailnet-name).

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials): an
OAuth client of type **Web application**, with the redirect URI
`https://<host>.<tailnet>.ts.net:4318/auth/google/callback` — the MagicDNS name, not the
Tailscale address, because no authority signs an IP. The scopes are `openid email` and
nothing else, so the consent screen asks for an address and no more.

### What a browser sees

A navigation to any *page* with no credential is answered with `/login`, which offers
the Google button and — folded away — the pairing token, because that is still the way
in for a browser whose account is not on the allowlist. Where you were going is carried
through, so a notification opened on a locked phone lands on the card it was about.

**Only pages.** Every asset stays open: the stylesheet, `app.js`, the icon, the service
worker, the vendor bundles. None of them contains anything — every page in this app is
an empty shell that fetches its data through `/api/*`, behind the same gate as
before — and gating a service worker or a manifest breaks an installed PWA in ways that
look nothing like "please sign in".

A `?t=<token>` link still opens the page it names, which is load-bearing: that is what a
notification click is. It also leaves a `beadcause_pair` cookie behind, and that cookie
is the one non-obvious piece of this. A token lives in `localStorage`, so it is on every
`fetch` and on **no navigation at all** — without the cookie, a phone paired by QR code
would open `/?t=…` perfectly and then be bounced to the login screen the moment it
tapped the tab bar, with the token working the whole time, invisibly. The pairing cookie
says only "this browser has been paired", and it is deliberately **not** accepted for
`/api/*`: it opens documents, never data.

### The session, and how it ends

An HMAC over `{sub, email, sid, exp}` with a key in `~/.config/beadcause/session.key` —
`httpOnly`, `SameSite=Lax`, and `Secure` whenever what is served is https. There is no
session store, and that is deliberate: the daemon is
[replaced under the port](operations.md#the-router--why-you-never-restart-it) several times an hour,
and a store in memory would sign everybody out on every swap.

`sid` is the session's own id, and it is what buys back the one thing a
store-less cookie costs: **revoking one device.** It names a row in `state.json` — a
file every backend already reads, so the list survives both a swap and a
`launchctl kickstart` — and the gate refuses a cookie whose row has been deleted. So:

- **Signed-in devices** — on `/admin`, under the sign-out line. One row per browser: a
  label off its user-agent (*iPhone · Safari*), the address, when it was first signed in
  and when it was last seen, and a **Revoke** button each. Revoking ends that session on
  its next request — on this backend and on the one replacing it — and touches nothing
  else. The phone left in a taxi costs one tap here rather than a key rotation.
- **Sign out** — the same act aimed at the browser you are holding, which is why it is
  the same list: the row is deleted, not merely the cookie cleared. That distinction was
  not academic before this — clearing a cookie is a *request* to a browser, so the value
  itself stayed good for its full thirty days anywhere it had been copied.
- **Delete `session.key`** — ends every session on every device at once, and needs no
  list to do it. It takes effect on the next backend swap or restart.
- **Rotate the token** — a separate act entirely, and it does not touch sign-in. Delete
  `token` from `config.json` and re-pair every device.

Two consequences worth knowing before they surprise you. **"Last seen" is written at
most once every five minutes per device**, because `state.json` is rewritten atomically
and snapshotted into a git repo on every write, and a browser polls every 25 seconds —
five minutes is well inside the resolution the question has. And **a session issued
before this list existed is refused**, once, because a live device the list cannot show
is exactly what the list is for. The cost is one Google sign-in per browser; the shared
token, which is every non-browser caller, is untouched.

### Whose answer it is

A session is an identity, so it is used as one: **what you say or decide from a
signed-in browser goes onto the bead under that address**, not under `beadcause`. That
is `bd`'s `--actor` (and `BEADS_ACTOR`, which it has to agree with — see `lib/bd.js`),
so it is on the comment, on the close, and in `bd show` six months later, which is the
only place the question "who decided this" ever actually gets asked.

Two rules keep it honest:

- **A caller with no session is written exactly as it always was.** An ntfy action
  button, `lib/notify.js`, the Android app, `curl` — none of them can hold a cookie and
  none of them has an identity to name, so all of them still write as `actor` from
  `config.json` — which on a machine that has set `me` names *that* machine's person,
  see [whose beadcause wrote it](operations.md#whose-beadcause-wrote-it--the-byline-on-every-daemon-write). A request carrying **both** a token and a session is a signed-in
  browser (the phone sends its pairing token on every fetch), and the session wins;
  otherwise the attribution would never once apply to the device it was built for.
- **Only what you *said or decided* gets your name.** The answer, the comment, the
  dismissal note; the beads a "yes" files — through the share target, the chat session,
  or an approved advocate proposal; and a pull request's verdict — the "changes
  requested" and "declined" notes on the work bead, and the close reason on a merge.
  What stays `beadcause` is everything that is bookkeeping rather than a sentence: the
  `human-replied` label, the reopen-and-unclaim that puts a bead back in the queue, the
  `bd dep add` behind a console create, and the daemon's own note about a create it
  refused. A byline on those would read as you having done them by hand.

**A create was the case that looked dangerous and is not.** It was held back at first
on the belief that `--actor` set a new bead's `owner` — which *is* read as whose queue
a bead belongs to, by `bd ready` and by the agents screen — so filing under your address
might have quietly moved work out of the advocate's reach. It does not: `--actor` writes
`created_by`, a byline, and `owner` comes from the git identity of the directory `bd`
runs in, untouched by the flag and by `BEADS_ACTOR`. `test/attribution.mjs` asks the
**real** `bd` binary that question — one bead filed each way, asserting the two owners
are identical and both come back from `bd ready` — because it is the fact the whole
decision rests on and a fake `bd` cannot keep it honest. That section skips itself,
loudly, where `bd` is not installed.

One thing a name cannot reach: the GitHub half of a verdict. `gh pr comment` posts as
whoever `gh` is authenticated as on this Mac, and no flag here changes that.

A merge close that `bd` refuses — a work bead still gated by a blocker — is written down
in `lib/owed.js` and retried on a later poll, minutes afterwards, with no request behind
it. So the address is stored in the owed record and the retry closes under it. Otherwise
the same tap would say your name or `beadcause` depending on nothing you did: whether the
blocker happened to have cleared by the time you tapped.

`test/attribution.mjs` holds all of it.

### Where the two secrets live, and how to rotate them

Both of them are named so that the git repo in that directory *cannot* commit them, and
that is the design rather than a habit. `~/.config/beadcause` is
[a repo](agents.md#where-the-rest-lives-configbeadcause-is-a-git-repo) that snapshots `config.json`
after every write — which is the point of it — so a secret in that file is not "on disk
in the clear", it is in a **history**, and a rotation cannot reach back into a history.

| | where it lives | rotate it by |
|---|---|---|
| **Session signing key** | `~/.config/beadcause/session.key`, generated on first use at 0600. `BEADCAUSE_SESSION_KEY` overrides it | deleting the file — every browser everywhere is signed out, and the next swap makes a new one |
| **Google client secret** | `~/.config/beadcause/google-client-secret.key`, or wherever `clientSecretFile` points, or `BEADCAUSE_GOOGLE_CLIENT_SECRET` (no copy on disk at all) | regenerating it in the [Google Cloud console](https://console.cloud.google.com/apis/credentials) and writing the new one to that file. Sign-in picks it up within 30 seconds; nobody is signed out |
| **Shared token** | `token` in `config.json`, and it is *meant* to be there — every non-browser caller needs it | deleting the field and re-pairing every device |

Both secret files end in `.key`, and the extension is doing the work: `*.key` is ignored
in that repo **and** on its `FORBIDDEN` list, so one cannot reach the history even if
somebody edits the ignore file. `*.secret` and `google-client-secret*` are on both lists
too, because an earlier version of this page suggested `google.secret`.

**There is no `clientSecret` field any more.** There was, briefly, documented as the
convenient-and-worst option — and a secret there would have been committed within seconds
of being saved. Three things replaced it, and the third is the one that makes the first
two true:

- it is not read. A secret in that field configures nothing.
- it is not merely ignored, either: **any that is still there is moved.** Every process
  that loads the config empties the field into the secret file at 0600 and writes the
  config back without it, so an install that had one keeps working and stops leaking. The
  log says where it went.
- and **the commit itself refuses.** Every snapshot greps its staged blobs, not just their
  names: a secret written into any committed file as a field, and the literal contents of
  every secret file in that directory — the second of which is what catches one pasted
  into a bead console, since `consoles/` is committed too. The commit aborts and nothing
  is left staged. That is the guard that covers the window between a hand-edit and the
  next load, and it needs nothing to have gone right first.

```bash
npm run secrets   # has one EVER been in the history? every commit, every ref
```

That last one is the question the guard cannot answer, because a guard is a promise about
the future. If it finds something, the fix is to **rotate that credential** using the
table above — not to rewrite the history. A commit cannot be honestly unmade, and the one
thing you can be certain of afterwards is that the old value no longer works.

If `clientSecretFile` points at a file *inside* `~/.config/beadcause` whose name none of
those rules match — `google-secret.txt`, say — the secret in it will be committed, and
nothing stops it, because refusing would turn a working sign-in off over a filename. What
happens instead is a line in the log every time sign-in is checked, and it names the file.

That warning is `leakWarning` in `lib/commonrepo.js`, which is the module that owns the
denylist, and the same three lines now cover the two Atlassian tokens
([`confluence.apiTokenFile`](#publishing-a-document-to-confluence) and
[`jira.<workspace>.tokenFile`](config.md#jira-per-workspace--read-only-and-one-setting)). It is
one function rather than three because the copies had already stopped agreeing: one asked
the real `FORBIDDEN` list, another a hand-written `/\.(key|secret)$/` that had never heard
of `.pem` or `google-client-secret`, so the *warning* and the *refusal* disagreed about
which files are safe — in the direction where a file the repo would abort on was reported
as a leak, and the next such pair might go the other way.

### What is checked, and what is not

`test/auth.mjs` drives the whole dance over real HTTP with Google's token endpoint
stubbed: authorize → callback → session cookie → an API call carrying only that cookie →
sign out → refused. The refusals get the same treatment, including the two that are
easiest to get wrong — an address off the allowlist (turned away, logged, and *not*
echoed back on the screen, because a login page that says which addresses exist is a
directory) and a `state` that does not match the cookie.

It signs in **twice** at the end, from two different user-agents, and revokes one: the
revoked browser is refused and the other is still working, which is the whole claim the
device list makes. `test/devices.mjs` holds the layer under that — the five-minute
throttle on "last seen", the shapes a half-written `state.json` must read as *no*
device, and the cache that re-reads the file when another backend writes it.

`node scripts/devices-check.mjs` is the screen, headless at phone size against stubbed
bodies: that a token-only install draws no card at all, that the browser reading the
page is the one marked, and that the first tap on **Revoke** sends *nothing* — the
assertion is against the stub's request log, not against the button's words, because
arming is only a safeguard if it is one on the wire.

`test/signinsetup.mjs` is the other end of the same thing: the `npm run configure`
question, driven with scripted answers. It holds two properties that would otherwise rot
quietly — that a pasted secret appears **nowhere** in the serialised config and does
appear in a file at 0600, and that every partial answer comes back naming which of the
four pieces is missing rather than a bare "off". It also pins that a cancelled run writes
no secret at all, and that typing the derived redirect URI back does not freeze it into
the config, where it would stop following the certificate.

What it does **not** check is Google itself. The `id_token`'s signature is deliberately
not verified, because it arrives from a direct TLS call from this process to Google's
token endpoint carrying the client secret — the case Google's own documentation says
verification can be skipped in. Everything that does not need a key *is* checked: the
issuer, that the token was minted for this client, that it has not expired, that the
nonce is the one we sent, and that Google says the address is verified — which is the
hole the allowlist would otherwise have, since anybody can put any address on an account
they have not proved they own.

## Slack — the same decision, in a channel

Off by default, and it stays off until you have given it a channel and a token.

A question that reaches your phone as an ntfy notification can also reach a Slack
channel as a message with a button per option. Pressing one **writes the same answer, on
the same bead, as tapping it in the app** — the beads a "yes" files, the amendment it
commits, the pull request it merges, the deploy it starts. It is not a chat feature and
it is not a copy of the inbox: it is a second delivery surface for one decision, for the
case where the conversation about the work is already in a channel and the person who
should answer is reading that rather than a phone.

```json
"slack": { "enabled": true, "channel": "C0123456789" }
```

and the bot token in `~/.config/beadcause/slack-bot.key`, the app-level token in
`slack-app.key`, both `chmod 600`. That is the whole of it.

### The two tokens, and why there are two

**The bot token** (`xoxb-…`, scopes `chat:write` and `chat:write.public` if the channel
is one the bot has not joined) is what posts and what edits. **The app-level token**
(`xapp-…`, scope `connections:write`, made under *Basic Information → App-Level Tokens*)
is what makes the buttons work — and it is not optional in the way it sounds.

Slack's ordinary interactivity wants a **Request URL**: a public HTTPS address it can
POST to when somebody presses a button. beadcause has no such address and should not
have one — it serves a tailnet name, behind Tailscale, deliberately unreachable from the
internet. So the daemon uses **Socket Mode** instead: it opens an outbound WebSocket to
Slack and interactions arrive down it. Turn Socket Mode on in the app's settings, enable
*Interactivity*, and give it the app-level token.

With the bot token alone, questions post and their buttons do nothing. That is a real
half-configured state and it looks like a broken app rather than a missing token, so the
daemon says so in its startup log rather than leaving you to find out by pressing one:

```
[beadcause] slack       C0123456789 — no app token in ~/.config/beadcause/slack-app.key, so the buttons will not answer
```

**Neither token is a field in `config.json`, and there is deliberately nowhere to put
one.** That file is committed to the git repo in `~/.config/beadcause` after every
write, so a token in it would not be "on disk in the clear" — it would be in a history
no rotation can reach back into. The `.key` names are the same construction that
protects the Google client secret and the tailnet private key: that repo both ignores
them and refuses to commit them. A `"botToken"` typed into the config by somebody
following a Slack tutorial aborts the next snapshot and says which secret it found.
`BEADCAUSE_SLACK_BOT_TOKEN` and `BEADCAUSE_SLACK_APP_TOKEN` are the other place, and
they leave no copy at all.

That construction protects the *history* and knows nothing about the filesystem, so the
one thing it cannot promise is checked at startup instead: a token file other accounts on
this Mac can read gets a line saying so, with the `chmod` that fixes it.

### Which repos reach which channel

The unit is the [space](asking.md#spaces--keeping-work-out-of-your-evening), not the repo,
because a space is already where "keep work out of my evening" is answered — and the
failure worth designing against here is not a missing message. It is a question from a
private side project turning up in a channel other people read.

| what | where | means |
|---|---|---|
| `slack.channel` | config | the default channel for every workspace |
| `slackChannel` | on a space | that space's channel — **or the key present and empty (`""`, or `null` if you are hand-editing), meaning this space never posts**, however the global is set. No key at all is the third answer: follow `slack.channel` |
| `slack.excludeWorkspaces` | config | one repo that never posts, outranking its space. The same idea as `ntfy.minimalWorkspaces` |
| `slackDetail` | on a space | `minimal` posts a nudge with a link and no question text |

A channel id (`C…`) or a DM id (`D…`), not a `#name` — the API takes ids, and a name
that has been renamed since you typed it fails at post time rather than at configure
time. Both `slackChannel` and `slackDetail` are rows on the
[space details screen](asking.md#space-details--every-setting-a-space-has-on-a-page-of-its-own), so the
per-space half of this is a thing you change from a phone rather than by opening
`config.json` on the Mac; `npm run configure` asks for the global channel and the global
detail alongside its ntfy question, which is how a fresh install finds out this exists at
all. What the resolver goes by is whether the key is *there*, so the screen's **Never**
writes `""` and its **Inherit** deletes the key — the two ways of saying nothing, kept
apart because only one of them survives the global channel changing.

Unlike ntfy, `detail` defaults to **full** on both levels. `minimal` exists because an
ntfy.sh topic is readable by anybody who guesses its name, and a Slack channel you named
in your own config is not a public relay — rounding a work space to minimal here would
put a contentless nudge in the one channel where the question belongs in full.

**A space's quiet policy applies to Slack exactly as it applies to your phone**, and by
construction rather than by a second rule that could disagree: the post happens at the
same point in the sweep as the ntfy push, *after* the quiet check, so a muted space and a
bead the inbox filter is hiding reach a channel exactly as often as they reach the phone
— never. The card still arrives in the inbox, as it always did; quiet has never meant
lost.

### What a question looks like once it has been answered

A stale message with live buttons is the failure mode of this whole idea. Answer on the
phone, and the message in the channel would otherwise sit there all week offering to
answer it again — and the second answer would be a second comment on a closed bead.

So the message is rewritten the moment the bead leaves the inbox: struck through, no
buttons, and a line saying what was answered and by whom. It settles whichever way the
question ended and wherever the ending happened — a tap on the phone, an ntfy action
button, a press in the channel, an agent closing the bead, `bd close` on the Mac. The
first three settle it in the same breath as the answer; the rest are caught by the
poller's next sweep, up to thirty seconds later.

Three endings read differently on purpose. **Answered** is an answer. **Handed back** is
an option that said `closes: false` — a commission, work ordered rather than a decision
taken. **Set aside** is a dismissal, which writes no answer at all.

### Whose answer a Slack press is

The person who pressed is named on the *Slack message* and not on the bead. The comment
lands the way every token caller's does — see [Whose answer it
is](#whose-answer-it-is) — because attributing it would need a mapping from a Slack user
to an address and a scope to read one, and that is worth doing deliberately rather than
as a side effect of this.

If bd refuses to close the bead — a blocker still open, children unfinished — the
message keeps its buttons, because the question is still a question, and the reason goes
back privately to whoever pressed.

### What it does not carry

The question channel, and nothing else. Replies from an agent, [foundation
requests](agents.md#what-an-agent-is--and-how-it-asks-to-be-different), [landings](landing.md#the-notification-with-nothing-to-answer),
deploy results and certificate warnings all have their own push on the phone and none of
them post to Slack. Each is a separate decision about what a room should carry, and a
constitutional change to an agent in particular is not a thing to nod through from a chat
window.

### Checking it

`test/slack.mjs`, against two servers it starts itself — one standing in for Slack, one
for this daemon's own `/api/respond` — so nothing reaches slack.com or the tracker. It
holds the four claims above: that unconfigured means no token is read at all, that a
space can say no as loudly as it can say where, that a pressed button sends the option's
own answer (the button carries an index, never the text, so a payload from outside this
process cannot decide what gets written on a bead), and that a settled message has no
live buttons left on it.

## Publishing a document to Confluence

Work that reaches beadcause produces durable prose. A UX review, a foundation, the
summary a worker leaves on a bead — all of it ends up either in a repo or on an issue,
and both of those are places the rest of a team does not look. Confluence is where they
look. So **any document the [reader tab](inbox.md#a-repo-that-could-not-be-read-says-so-instead-of-looking-empty)
can open can be published to a Confluence page, and published again later to the same
page**, from the same screen you were reading it on.

It is off until you configure it, and an install that has not configured it never draws
a button, never opens a credential file, and never mentions Confluence at all:

```json
"confluence": {
  "site": "https://yourteam.atlassian.net",
  "email": "you@yourteam.com",
  "space": "ENG"
}
```

```sh
# the API token goes in a file, never in config.json — same rule as the Google client
# secret, and for the same reason: that file is committed after every write
printf '%s' 'ATATT3x…' > ~/.config/beadcause/confluence.key
chmod 600 ~/.config/beadcause/confluence.key
```

An [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) is
what `email` and that file are: together they are HTTP basic auth against the Cloud REST
API, which is Atlassian's own answer for a script. `.key` is not a naming preference —
`~/.config/beadcause` [is a git repo](agents.md#where-the-rest-lives-configbeadcause-is-a-git-repo)
that snapshots itself after every write, and `*.key` is both ignored there *and* on that
file's `FORBIDDEN` list, so the token is protected by construction rather than by
somebody choosing a good name. `BEADCAUSE_CONFLUENCE_TOKEN` works too and leaves no copy
at all; `apiTokenFile` points somewhere else, and beadcause says so in the log if where
you pointed it is a file that directory would commit. A relative `apiTokenFile` resolves
*inside* `~/.config/beadcause`, so `"confluence.key"` means the obvious thing — it used
to be taken as written and resolved against whatever directory the daemon started in,
which is a token that reads correctly by hand and is missing under launchd.

The credential rule, the header and the request itself are `lib/atlassian.js`, shared
with JIRA — see [one credential rule and one
wire](config.md#one-credential-rule-and-one-wire-shared-by-jira-and-confluence). What is *not*
shared is every sentence this integration says, including the decision that a Confluence
401 reaches the phone as a 502.

### Setting it up without opening the file

The block above is what the configuration *looks* like, not how you get one.
**`npm run configure` asks for all of it**, beside the Google sign-in question at the
end, because those two are the pair that take a credential:

```
12. Publish and read Confluence pages?
   currently: off
   set up Confluence? (y/n) [n] y
   site: [none] https://yourteam.atlassian.net
   account email: [] you@yourteam.com
   space to publish into: [none] ENG
   API token:
   readable spaces: [none] ENG
   Publishing is on — into ENG.
   Reading is on for ENG and nothing else on that site.
```

Confluence was the last integration on this Mac that could only be turned on by editing
`config.json` under a running daemon, which is what [the Slack
channel](#slack--the-same-decision-in-a-channel) used to be. Four things about the block
are decisions rather than layout:

- **The token is typed with the echo off and never reaches `config.json`.** It goes to
  `~/.config/beadcause/confluence.key` at 0600, by the same route and for the same reason
  as the Google client secret — that file is committed after every write, so a credential
  in it is in a history a rotation cannot reach back into. Enter keeps the one already
  there rather than wiping it, and nothing is written at all until the last question is
  answered, so Ctrl+C halfway through really does leave every credential as it was.
- **The readable-spaces question opens at `none`, on an install that publishes into
  `ENG`.** That is the [empty allowlist](#reading-a-page-in--and-why-the-allowlist-is-empty-to-begin-with)
  said again in the one place it is easiest to lose: the obliging thing for a wizard to do
  is offer back the space you typed one question earlier, and doing that would decide
  *every unattended agent this Mac dispatches may read the company wiki* on behalf of
  somebody pressing Enter. Reading stays off, and the verdict says so as the default
  rather than as a fault — no "re-run configure to finish it" over an install that
  deliberately reads nothing.
- **`none` at the site turns off all four fields together**, and says which readable
  spaces went with them. Clearing the site alone would leave a `space` and a `readSpaces`
  behind, which both halves read as *wants Confluence* — so a deliberate off would be
  reported as a misconfiguration, at every startup, naming the site that was just deleted
  on purpose. The key file is left where it is; deleting a credential is not setup's to do.
- **The verdict is two sentences because this is two switches.** Publishing and reading
  fail separately and can disagree — a site with no space cannot publish and reads
  perfectly well — so the summary line is `publishing into ENG, reading nothing` rather
  than the word "on", which would be true of an install whose agents read nothing at all.

**Neither answer is on the [space details screen](asking.md#space-details--every-setting-a-space-has-on-a-page-of-its-own),
and that is the same decision twice.** `confluenceSpace` is not there for the reason the
next section gives, and `readSpaces` is not there for a reason of its own: it is a single
global list rather than a per-space one — see [the two edges](#reading-a-page-in--and-why-the-allowlist-is-empty-to-begin-with)
— so a row on a card that governs one space would be a control that quietly governs all of
them. `node test/confluencesetup.mjs` (part of `npm test`) drives the block with scripted
answers, and the assertion it exists for is the second bullet: the offered default, not
just the answer.

### Which spaces may publish, and to where

`confluence.space` is the default target. A [space](asking.md#spaces--keeping-work-out-of-your-evening)
may say otherwise, and it is the space rather than the workspace because "where does
this side of my life get published" is the same kind of answer as "when may it interrupt
me":

```json
"spaces": [
  { "name": "Work", "workspaces": ["acme"], "confluenceSpace": "TEAM" },
  { "name": "Evening", "workspaces": ["sideproject"], "confluenceSpace": false }
]
```

`false` is a refusal and not "inherit" — a space that has said no does not start
publishing the day a global default appears. Leave `confluence.space` unset entirely and
**nothing** publishes except the spaces that name their own, which is the way round to
configure it if most of what you read is not the team's business.

This is deliberately **not** on the [space details screen](asking.md#space-details--every-setting-a-space-has-on-a-page-of-its-own)
with the settings that are. It is the same line `name` and `workspaces` sit on the far
side of: choosing which wiki an evening's work is published to is a config-file act, not
a thing to do with a thumb, and an integration whose whole point is being deliberate
loses that the moment its target is as easy to change as the act. `confluence.space`
underneath it is a wizard answer rather than a card row for the same reason, one level
up — see [setting it up](#setting-it-up-without-opening-the-file).

### It is a button, pressed twice, under a target named in full

Open a document and the footer says exactly what would happen:

```
┌────────────────────────────────────────────────────┐
│  Confluence · ENG / The inbox, reviewed            │
│  replaces the page that is there · last published  │
│  3h ago                                            │
│                                                    │
│  [            Publish…            ]                │
└────────────────────────────────────────────────────┘
```

The first press re-reads it back as the act — **Replace ENG / The inbox, reviewed** —
and the second one does it. Nothing publishes on a poll, on a merge, or as a side effect
of anything else: there is no automatic path in the code at all, because a page on a
wiki other people read is not something a restart takes back.

**The naming is enforced, not promised.** The second press sends the space key and the
page title *as the screen drew them*, and the daemon re-derives what it would do now and
refuses with a 409 if either has moved. Edit the document's `# heading` between reading
the footer and pressing it, and you get "this would now publish … which is not what you
were shown" instead of a second page under the new name. That is the difference between
a property of the daemon and a promise the client makes.

**A re-publish updates the page, and overwrites its body.** The page id is remembered in
`state.json` under `published`, keyed by the document's own path — and unlike every
other record in that file it has no expiry, because an expired record is not a stale
fact, it is a duplicate page. If it is lost anyway (a state file restored from an older
copy, a document published from another machine) the space is still searched for a page
with that title before anything is created, so the worst case is an update to a page
beadcause did not know it owned. Overwrite rather than append because the document on
the Mac is the source of truth and the page is a copy of it; nothing is lost, since
Confluence keeps its own version history and every update carries a message saying
beadcause published it and from which file.

**The URL comes back to the bead.** Open a document from a card's document list and the
link carries the bead with it, so publishing comments the page URL onto that bead —
which is where somebody looks for "where did this end up", and beadcause's own state
file is not somewhere they can look at all. That half is best-effort on purpose: the
page exists by the time the comment is attempted, and failing the request over it would
tell your phone the publish did not happen when it did. The log says so instead.

### The edges, said out loud

- **Publishing and reading are separate switches.** Reading a page back in is the other
  half and it is
  [configured on its own](#reading-a-page-in--and-why-the-allowlist-is-empty-to-begin-with):
  an install that publishes into `ENG` reads nothing at all until it also says which
  spaces may be read. Nothing about pushing a document out implies letting an
  unattended agent pull anything back.
- **Markdown and text only.** A `.pdf` or a `.csv` opens perfectly well in the reader
  and there is nothing sensible to make a page out of, so the footer does not appear.
- **A fenced code block arrives as preformatted text**, not the Confluence code macro,
  and a mermaid block arrives as its source — Confluence has no mermaid without an app
  installed, so the honest rendering of a diagram is the text that describes it.
- **An observer instance may not press it.** Its line is acts on this Mac, and this is
  further out than that.
- **The title is the document's first `# heading`**, or its filename if it has none. It
  is also the key a lost record is recovered by, so two documents that call themselves
  the same thing are one page.

`node test/confluence.mjs` (part of `npm test`) drives all of it against a fake
Confluence on loopback that counts the pages it is asked to create — because the
assertion that matters is not "the second call was an update", it is that **nothing was
ever created twice**, including with the record deliberately thrown away.

### Reading a page in — and why the allowlist is empty to begin with

The other direction, and a separate switch: **an agent can read a Confluence page you
have named a space for, and nothing else on that site.**

Half of why a repo is the way it is never reaches the repo. The runbook, the spec the
service half-implements, the decision somebody wrote up after the incident — those live
on the wiki, and to every other grant an agent has they are a login screen. `WebFetch`
gets the sign-in page, `beadcause-get` gets a 401, and `beadcause-browse` acts as nobody
and so gets the sign-in page too. An agent cannot tell any of that from a page that says
nothing, which is the same failure [looking things up](agents.md#looking-something-up--and-why-it-is-not-bashcurl)
was built to fix, one login further in.

```json
"confluence": {
  "site": "https://yourteam.atlassian.net",
  "email": "you@yourteam.com",
  "readSpaces": ["ENG", "RUNBOOKS"]
}
```

**`readSpaces` starts empty and stays empty until you write it — including on an install
that already publishes.** That is the whole safety argument, so it is worth saying why
it is not merely cautious. The API token this uses is the *same* token that publishes,
and a token that can publish into one space can read the entire site: the HR space, the
board deck, the incident write-ups with customer names in them. So "reading is on
because Confluence is configured" would quietly mean *every unattended agent this Mac
dispatches may read the company wiki*, decided by nobody, on the day publishing was
switched on for an unrelated reason. Naming the spaces one at a time is the same move as
naming the [`bd` verbs one at a time](agents.md#what-a-reply-agent-may-do--and-the-four-verbs-it-used-to-have-by-accident) rather than taking
`Bash(bd *)`, and it is the same reason: the short version of the grant is not a smaller
version of it.

**The check is against the space the page is really in, never the one the URL claims.**
This is the part that would be wrong if it looked right. A Confluence URL is
`…/wiki/spaces/ENG/pages/777/On-call+rota`, and the `ENG` in it is decoration — the id
is what resolves, and Confluence serves the page whatever that segment says. A reader
that allowlisted on the URL would hand over any page in the site to anyone who could
retype one path segment. So the space key comes back from Confluence with the page and
is checked against `readSpaces` then; a page named by *title* is refused earlier still,
before any request at all, so asking for a page in a space you may not read does not
even tell Atlassian that somebody was interested.

    beadcause-confluence --spaces                          which spaces are readable
    beadcause-confluence https://…/pages/777/On-call+rota   by URL
    beadcause-confluence 777                                by id
    beadcause-confluence "ENG/On-call rota"                 by space and title

There is no flag to write a page, comment on one, search the site, list what a space
contains or download an attachment — no code path here builds a POST, a PUT or a search,
which is the same construction as `beadcause-get` having no way to name a method.
**Searching is the deliberate omission**: "find the page about the rota" reaches every
title in a space rather than one page somebody named, and that is the shape that turns a
narrow grant back into a wide one. A page gets named by pasting its URL, which is what a
person does anyway.

**It is fetched every time, and never cached.** A wiki page is edited by other people,
so a cached copy served as current is not a stale answer, it is a wrong fact with
nothing on it to say so. What comes back instead is the version number and the date, at
the top, above the page — because the agents are told to cite what they read, and on a
page that changes under them "the page said this, at v14, today" is a fact where "the
page says this" is a hostage:

```
# CONFLUENCE ENG/On-call rota
# https://yourteam.atlassian.net/wiki/spaces/ENG/pages/777/On-call+rota
# version 14 · updated 2026-08-01T09:00:00.000Z · read just now, never cached

## Paging
…
```

The body is markdown, converted back from Confluence's storage format — the mirror of
the conversion that publishes one. It is lossy in listed ways rather than quietly:
**a macro arrives as `[jira macro]`** rather than as its content, because a macro is a
server-side include and its content is genuinely not in the page; **layouts and columns
flatten**; **an image arrives as its filename**, since the bytes are an attachment and
this reads pages; and **a table nested inside a table cell is dropped**, because markdown
has no such thing and merging its rows into the outer table would be a silent corruption
rather than a visible gap.

The grant is `Bash(beadcause-confluence:*)`, on the reply agents and the advocate, and
it is inert on an install with no readable space — which is why it can sit on the list
unconditionally. What is *not* unconditional is the paragraph in the prompt: the agents
are told about this only when there is a space to read, because an agent told about a
capability that is switched off spends a run finding that out, and an agent never told
about one it has may as well not have it.

**Two edges worth knowing.** A [short link](https://support.atlassian.com/confluence-cloud/)
(`/wiki/x/AbCdEf`) is refused with a message saying to use the long URL — only a browser
can resolve one, and the API does not. And `readSpaces` is a single global list rather
than a per-[space](asking.md#spaces--keeping-work-out-of-your-evening) one: unlike
`confluenceSpace` for publishing, the reader is a command an agent runs in a checkout
and has no honest way to know which beadcause space it is acting for. So list only the
spaces that *every* agent this Mac dispatches may read — which is also why it is a
question in [`npm run configure`](#setting-it-up-without-opening-the-file) rather than a
row on a space's card, where a per-space control would quietly govern all of them.

`node test/confluenceread.mjs` (part of `npm test`) drives it against the same kind of
fake Confluence, and the case it exists for is the third paragraph above: a page in a
space that is not readable, behind a URL that says it is.

## The access register — every principal, human and agent, and what revokes it

Every control framework asks the same question in its own words: who can reach this, on
whose authority, and what takes it away. The pieces of an answer have been here for a
long time — a token, an allowlist, per-device sessions, a tailnet with no public
listener, a foundation per agent kind, an endorsement gate no unattended session may
cross — but they were **arrangements** rather than a stated control, and the difference
shows the moment somebody asks for the list. An arrangement is answered by reading six
files and reasoning. A control is answered by running one command:

```
beadcause-access            # the whole register, as prose
beadcause-access --json     # the same thing for a script
beadcause-access --review   # just the review line; exit 1 when it is overdue
```

`lib/access.js` is the register, `bin/access.js` prints it, `test/access.mjs` is what
stops it going quietly stale.

### An agent is not a user account, and modelling it as one is the trap

The obvious shape is a table of accounts with a row per agent, and it is wrong in a way
that would survive review by being ticked. **Nothing this daemon spawns holds a
credential of its own.** All seven agent kinds run as the single Claude subscription signed
in on this Mac; there is no per-agent secret to rotate, nothing to disable one at a time,
and a table implying otherwise describes seven accounts that do not exist.

So the register's rows are **grants, not accounts** — the thing that hands a principal
its reach, chosen because it is the thing a review can actually revoke:

| What grants it | Where it lives | What revokes it |
|---|---|---|
| A [foundation](agents.md#what-an-agent-is--and-how-it-asks-to-be-different) | `lib/foundation.js`, plus amendments on `refs/beadcause/foundations` | A commit, or an amendment — and never for a `PROTECTED` field |
| An endorsement | The bead itself | Park it, or never endorse it — an unendorsed bead is worked by nobody |
| A directory-scoped export | `~/.zshenv` | `unset`, which happens on its own the moment a session is rooted somewhere personal |
| A network position | The tailnet | Remove the device from the tailnet admin console |
| An allowlist entry | `auth.google.allowed` | Delete the line — then delete the device rows, because a live cookie outlives it |
| A device row | `state.json` | The Devices screen |
| Possession of the token | Whoever photographed the QR | Rotate it |

The fourth row is the boundary, and it is the one an auditor should be told first: there
is no public listener and [no inbound webhook](operations.md#https-on-the-tailnet-name) of any kind,
so every credential below sits behind a network position an unenrolled device cannot
take. The boundary is a register row of its own, and it carries the answer about data in
transit — [HTTPS on the MagicDNS name](operations.md#https-on-the-tailnet-name), terminated by the
router, with WireGuard underneath it either way. That last clause is the one worth having
written down: an install with no certificate yet is a normal state here, and on that day
the traffic is still encrypted and only the browser's lock is missing. The one plaintext
hop is loopback, between the router and whichever backend it last swapped to.

### Half of it is derived, and the other half refuses to be silent

The roster of agent kinds is `AGENTS` in `lib/foundation.js`, read at call time. So a
seventh kind cannot come into existence without the register having heard of it — but
what *cannot* be derived is the sentence saying what that kind reaches and what takes it
away, and a register whose answer to a new kind is silence is a register that reports
completeness on the day it stopped being complete. `AGENT_ACCESS` must therefore cover
`AGENTS` exactly, and a kind with no row **throws**: the same shape `MARKS` uses to stop
a new agent shipping as a generic 🤖.

The human half is the opposite — read from live config and live state on every call,
never copied into the module. "Who can sign in" is a fact about a file, and a second copy
of it is an answer that drifts and is believed anyway.

And nothing in the register is **keyed** by a framework id — no exported value in
`lib/access.js` contains one, and a couple of comments name a criterion only so a later
reader knows what a paragraph was for. That is a seam, not an omission: one closed control
corpus across SOC 2, ISO 27001 and 42001 is being built separately with the crosswalk
edges on the control, and an id written into the data here first would be a second
vocabulary — the "same control implemented three times" that a single corpus exists to
prevent. This file is the *evidence*; the corpus cites it, in that direction. Which
criteria it answers is said here, in prose, where nothing can join on it: identity and
authentication, authorisation against a role, removal on termination, boundary
protection, protection of data in transit, and controls over what may run.

### What an agent may run, and the one kind that has no allowlist

Every agent row also carries what that kind may *execute*, read off its foundation:
twelve allowlisted patterns for the chat session, nineteen for the dispatcher,
twenty-five and twenty-nine for the two advocates, twenty-four for the merge queue. The
allowlist names `bd`'s read-only verbs one at a time rather than `bd *`, because `bd *`
quietly included create, close, delete and label — which is the difference between an
agent that answers a question and one that can file the bead the proposal flow exists to
make you approve.

And then the worker, which **has no allowlist at all**. That is deliberate and
defensible: a session opened to do a bead needs whatever the bead needs, and its
containment is the worktree it may write to rather than a list of verbs. It is also the
single widest grant in this system, so the register says it in those words rather than
letting it render as a number like the other five, and `test/access.mjs` pins the
wording. A control document whose widest grant is the one you cannot find in it is worse
than no document.

### The credentials, and the three that are scoped by something other than a permission

`CREDENTIALS` is closed and hand-written, because there is nothing to derive it from — a
credential is a fact about a file or an environment variable. Ten of them: the API token,
the session signing key, a device session, the Google client secret, the tailnet TLS key,
both Slack tokens, the Atlassian token, the `gh` login, and the Claude subscription every
agent runs as.

Three are worth reading twice, because their scope is not enforced by a permission system
at all:

- **`JIRA_API_TOKEN` is scoped by a directory.** `~/.zshenv` exports it under work paths
  and `unset`s it everywhere else, so a session rooted in a personal repo *physically
  cannot* authenticate against the work JIRA. Nobody has to remember to remove it.
- **The `gh` login is wider than beadcause**, and is registered saying so. It is the
  credential every push, pull request and merge rides on, and it can see every repo that
  GitHub account can. **There may be more than one, and here there are two** — the account
  that writes, and a read-only second one that exists only to
  [leave the approving review](landing.md#approving-it-and-saying-on-the-page-that-an-agent-did),
  because GitHub will not accept one from the account that opened the pull request. The row
  names which calls the second identity is used for, since a register that mentioned one
  login would be describing a system that has two.
- **The API token carries no identity**, which is the fact worth registering rather than
  the fact worth hiding. There is no list of who holds it and a photographed QR is a
  grant, so its row names possession as the authority and rotation as the only revocation.

Where each one lives and how it is rotated is [in the secrets
section](#where-the-two-secrets-live-and-how-to-rotate-them); the register repeats the
path and the revocation act rather than linking, because a list you have to follow links
out of is a list nobody finishes on the day it matters.

### Joiner, mover, leaver — written down for an org of one

Every one of these paths has run zero times, and that is not a reason to leave them
undocumented. The question is whether the path exists and is followed, and "we would have
worked it out" is both the answer that fails and the answer that is *true* at the moment
it matters most — a laptop lost, a contractor finished — which is exactly when nobody is
in a state to work anything out.

A **joiner** is an allowlist line, a tailnet enrolment, and the token only if they need a
caller that is not a browser. A **mover** here is usually not a person at all: a role
change is a change to what an agent may do, which is an amendment or a commit to
`lib/foundation.js`. A **leaver** is twelve acts, and the twelfth is removing their
tailnet device.

The leaver path is where the register closes its own loop. Each step names the credential
it ends, and `test/access.mjs` asserts that **every** id in `CREDENTIALS` appears in at
least one of them. Add a credential without saying how it comes back and the suite fails
— so the way out cannot quietly go stale behind the way in, which is the usual way a
leaver checklist stops being true.

### The quarterly review, and what happens when it is late

`REVIEWS` in `lib/access.js` is append-only, and appending to it is a commit — so who
performed a review and when is the git identity on that commit, in a history nobody here
can rewrite. There is deliberately no field restating any of that; a field that can
disagree with the history is worse than no field.

Ninety days. `test/access.mjs` fails when the next one is past due, `beadcause-access`
exits 1 on the same condition, and both read the same function so they cannot drift into
two different controls. Performing a review is: run `beadcause-access`, read it, fix what
is wrong, append one entry, commit.

**One honest limit, said out loud because an auditor will find it otherwise.** The merge
queue ignores checks `main` is already failing, so once this red lands on `main` it stops
blocking other people's merges rather than halting the fleet. That is the right failure
direction — an unreviewed register must not become a deadlock nobody can commit their way
out of — but it means the teeth here are a visible red and a card, not a gate. Making it
one belongs with the rest of the enforcement gates, not with the register.
