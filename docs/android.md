# The phone — the Android app, chat sessions and the terminal

## The Android app

A native shell around the same PWA, in `android/`. It exists for the four things a
web page on a phone cannot do:

1. **Notifications the app posts itself** over the tailnet, with no ntfy relay in
   the middle — so nothing about a question leaves your network.
2. **A typed answer straight from the shade.** `RemoteInput` gives the notification
   a real text field; ntfy's buttons can only send a fixed string.
3. **A watcher that outlives the tab.** A foreground service, not a page the OS may
   evict at any moment.
4. **A share target.** Anything on the phone becomes a `human` bead in the same
   inbox as everything an agent asks.

Everything else — markdown, mermaid, images, the document reader, the two-tap
confirm, per-keystroke drafts, the render deferral — is the existing `public/app.js`
running in a WebView. There is deliberately no second implementation to keep in step.

### Install

```bash
npm run android:key     # once: sideload signing key in ~/.config/beadcause
npm run android         # build, and publish the APK to public/
```

Then on the phone, **open `https://<host>.<tailnet>.ts.net:4318/beadcause.apk`** and
install it — the same tailnet that carries the questions carries the app, so there's no
cable and no Play track. `npm run android -- --install` uses `adb` instead if a device
is attached. Pair by scanning the `npm run qr` code, which is the same QR the PWA uses:
the URL carries the token, and the app stores it in EncryptedSharedPreferences. The app
pairs over https only, so the tailnet needs
[*HTTPS Certificates*](operations.md#https-on-the-tailnet-name) switched on before that QR is worth
scanning.

Needs the Homebrew Android toolchain, not Android Studio:

```bash
brew install --cask android-commandlinetools
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

### What it costs you to know

- **A channel's sound and vibration are immutable once created.** Android takes them
  from the first `createNotificationChannel` and ignores every later one, forever —
  they belong to the user from that moment. Changing either means publishing a new
  channel id and deleting the old, which is why the ids carry a version suffix and why
  `RETIRED_CHANNELS` exists at all: an id that is abandoned rather than *deleted* stays in
  the settings screen as a live row, with its old sound, that nothing posts to.
  [*The five voices*](#the-five-voices-and-the-channels-that-carry-them) is the table of
  what is bound to what, and [*The five sounds*](#the-five-sounds-and-auditioning-one-before-it-is-permanent)
  is where they are heard.
- **Android renders at most 3 notification actions.** Going native does *not* lift
  ntfy's three-button cap. The budget is spent as: two option buttons plus a typed
  "Answer…", or — when a question has no options — "Answer & close" and "Comment",
  both typed. Every option is still listed in the expanded notification, and the
  rest are one tap into the app.
- **Notification actions are one tap, not two.** The in-app two-tap confirm guards
  against a pocket tap on a screen you're already looking at; the shade needs an
  unlock first, and ntfy's buttons have always been one tap.
- **The service is `specialUse`, not `dataSync`.** A `dataSync` foreground service
  is capped at six hours a day on Android 15 and would go quiet each evening.
  `specialUse` has no timeout; it needs a Play Store justification, which a
  sideloaded build never has to give. This is the concrete reason distribution and
  push transport aren't independent choices.
- **The app talks https to the MagicDNS name, and nothing else.** Cleartext is off in
  `network_security_config.xml` except to loopback and `10.0.2.2` (the emulator's route
  to the host Mac), and `Address.kt` refuses to send the token anywhere but
  `https://<host>.<tailnet>.ts.net` — *before* the first request, which is the only
  moment a refusal is worth anything. The two files are different questions: the config
  says what the socket may carry, `Address` says where a bearer credential may go, and
  the second is the stricter one. A blanket "any https" would not do — a certificate is
  something anyone can get for a domain they own. The suffix narrows that to *a*
  tailnet and honestly not to *yours*: somebody else's tailnet has `.ts.net` names too,
  and nothing on the phone has ever been told which tailnet is yours. What it rules out
  is every host that is on none of them, and the whole of cleartext.
  `test/pairhost.mjs` fails the build if the two files stop agreeing about the loopback
  exceptions.
- **So the app needs *HTTPS Certificates* on, and says so when it isn't.** With no
  certificate the Mac serves plain http on `100.x.y.z` and puts *that* in the QR — the
  [documented, deliberate fallback](operations.md#the-url-you-are-given-and-what-happens-to-a-phone-that-already-has-one)
  — and the app cannot use it. Scanning it is not a silent failure: the pairing screen
  names the address, says the Mac has no certificate yet, and points at the tailnet DNS
  page. The PWA in a browser still works over http, so this is a constraint on the APK
  and not on beadcause.
- **Samsung will kill it.** On a Galaxy, add Beadcause to Settings → Battery →
  Background usage limits → **Never sleeping apps**, or the watcher dies silently
  after a few hours.
- **The APK is 28 MB**, nearly all of it ML Kit's bundled QR model. Swapping to
  `play-services-mlkit-barcode-scanning` would cut ~20 MB at the cost of depending
  on Play Services being current.
- **Keep the signing key.** Android refuses an update signed by a different key, so
  losing `~/.config/beadcause/android-keystore.jks` means uninstall-and-re-pair.

### The five voices, and the channels that carry them

Five classes of arrival, split by **what the arrival asks of you** rather than by what
produced it, and each one is its own Android notification channel. That is where the
options live: Android's own settings screen already gives every channel a volume, a
vibration toggle, an importance and a schedule, so mute merges for a week without touching
whether a question can reach you — and no screen of beadcause's own has to be built or
maintained to offer it.

| Channel | Class | Sound | Importance | Vibration |
|---|---|---|---|---|
| `answers_v1` | A question is waiting on you | `blip.wav` | HIGH | one 20ms pulse |
| `stuck_v1` | A deploy failed, a tracker stopped syncing | `knock.wav` | HIGH | two 60ms pulses |
| `merged_v1` | A pull request merged | `land.wav` | DEFAULT | none |
| `released_v1` | A release went out | `drop.wav` | DEFAULT | none |
| `epicdone_v1` | Every bead under an epic is closed | `chime.wav` | DEFAULT | none |

Four things in there are decisions rather than settings:

- **A batch of questions sounds `answers_v1` once.** The daemon holds questions that
  arrive inside a workspace's settle window and sends them out as one ring (bc-obhx3,
  lib/held.js): the first carries `hushed: false` and alerts, the rest carry `hushed: true`
  and are filed into the same stacked card with `setOnlyAlertOnce` — an update to a card
  already showing does not alert again. A build older than this field rings per question
  exactly as before, because `optBoolean` of a missing field is false.
- **Only the two that are about *you* move the phone at all.** Good news that vibrates is
  an interruption bought with nothing, because there is nothing on those cards to act on.
- **20ms is the floor, not a preference.** A channel's `vibrationPattern` is durations
  only — there is no amplitude in it — so "smaller" can only mean "shorter", and under
  about 20ms most phones never get the motor moving enough to be felt. Going below it means
  the app firing a `PRIMITIVE_TICK` itself with channel vibration off, which is bc-ka5y.15.6
  and is deliberately declinable: an app-fired vibration stops inheriting Do Not Disturb and
  the user's own toggle, and has to honour both by hand.
- **`stuck` is the only insistent one**, and the only class that is a *state* rather than an
  arrival: a deploy that failed is still true an hour later, and nothing else is going to
  say so. Hence the double knock, the double buzz, and no timeout on the card.
- **Three channels, one card.** A landing, a release and an epic completing share the `NEWS`
  card because the shade stops being glanceable at about three cards, and have three
  channels because the pipeline is audible if they differ — four blips, then a drop, then
  eventually a chime. The card takes its voice from the arrival that caused the render, and
  is cancelled and re-posted when that voice changes, because a notification's channel is
  fixed at the moment it is posted.

**`replies_v2` and `foundation_v1` are unchanged and keep the pip with no buzz.** An agent's
reply and a constitutional request are both news you asked for; neither is a sixth voice.
`questions_v2` is *deleted* rather than left behind — its buzz went from 40ms to 20ms, so its
id had to change, and a channel that is abandoned without being deleted stays in the settings
screen with the old sound. `test/channels.mjs` is the suite that holds all of this: every
class to its sound, every retired id to the delete list, and every sound to a file that
actually ships.

### One tap from the app to those settings

The five channels above are where the options live, and that answer has one gap: nothing
in the app points at it. Finding them means leaving the app and walking Settings → Apps →
Beadcause → Notifications by hand. **Menu → Notification settings** (the gear at the top
of every page) is the fix — one tap, from `MainActivity`'s `openNotificationSettings()`
bridge method, to `Settings.ACTION_APP_NOTIFICATION_SETTINGS`.

That lands on the whole-app notification screen rather than on one channel's own. The
alternative — five deep links, `Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS` with a
hardcoded `EXTRA_CHANNEL_ID` per row — would read more like a mixer at a glance, but it
means five ids in `public/accountbar.js` that have to be kept in step with the ids in
`Notifications.kt` by hand, forever, with no test that can catch a typo except a human
tapping every row: a stale or misspelled id opens a settings screen on nothing rather than
failing loudly. The whole-app screen already lists every channel as its own tappable row,
so "one tap from the app" is satisfied by landing there, and there is nothing to keep in
sync.

The row is drawn hidden and revealed only by feature-detecting
`window.BeadcauseNative?.openNotificationSettings`, the same way **Open in Chrome** reveals
itself — a PWA running in a browser has nowhere for the tap to go, and a userAgent sniff
would draw the row for a browser merely claiming to be one. An APK built before this
shipped has no such method on its bridge, so the row stays hidden there too.

### Which arrival speaks in which voice, and what stops the loud one crying wolf

Giving one class the only insistent voice is only safe while that class cannot be wrong,
and it was. `bc-y3qk.4` counted **nineteen notifications about one workspace in one day**,
from a tracker that alternated failing and recovering nearly every tick, because the code
talked on every transition — and half of them were *good* news. A phone that knocks twice
about something that fixed itself two minutes later is a phone whose knock you train
yourself out of hearing, and then the one outage that mattered arrives in a sound that
means nothing. So `lib/voices.js` holds two halves of one argument, and `test/voices.mjs`
pins both.

**Every notification this daemon can make, assigned to exactly one class:**

| Emitter | Class | Where it goes |
|---|---|---|
| `pushQuestion`, `pushFoundationRequest`, `pushFoundationReply`, `pushReply` | 1 · answer this | native, with ntfy as the fallback for a phone that is not the app |
| `pushCertificate`, `pushNoBackend` | 2 · stuck | ntfy only — both report a failure of the very path a native card would travel |
| `pushServingAgain` | *clear* | ntfy, at the calm end |
| `landedEvent` | 3 · merged | native |
| `deployEvent` — `ok`, `unconfirmed` | 4 · released | native |
| `deployEvent` — `failed`, `lost` | 2 · stuck | native |
| `syncStuckEvent`, `syncFlappingEvent` | 2 · stuck | native |
| `deployClearEvent`, `syncClearEvent` | *clear* | native, and it posts nothing — it removes a card |
| `epicDoneEvent` | 5 · epic completed | native |

A table in code rather than a paragraph here, because the assignment is exactly the sort
of thing that goes quietly wrong: a new detection lands, picks whichever emitter looked
nearest, and inherits a sound nobody chose for it. The suite parses the exports of
`lib/notify.js` and `lib/news.js` and fails the repo for one that appears in neither the
table nor a class — and for a table row naming an emitter that has since been deleted,
which reads as coverage and is an empty promise.

**A recovery is not a sixth class.** It is `CLEAR`: the other half of a state rather than
an arrival of its own. On the phone it *removes* the card and posts nothing at all
(`Notifications.stuck` returns before `Tray.add` when `state == "clear"`, and the suite
reads that out of the Kotlin rather than assuming it); over ntfy it is priority 2. Nothing
that clears may ever reach `stuck_v1`.

**And every class-2 detection has to say what stops it flapping.** Four detections, three
shapes of damping, because what "flapping" even means differs:

| Detection | Rule | Where |
|---|---|---|
| the router serving nothing | must hold **2 consecutive attempts** | `bin/router.js` — `stillServingNothing` |
| a tracker not syncing, or flapping | 4 transitions in an hour, then silence until it holds | `lib/sync.js` — `record()` |
| a certificate expiring or absent | once per problem; a failing renewal nags on a timer | `lib/tls.js` |
| a deploy that failed or was lost | **none, deliberately** | `lib/server.js` — `settleDeploys` |

The last row is the interesting one and it has to be argued for rather than left blank: a
deploy is an arrival with an outcome, not a state that can alternate, so damping it would
swallow the second real failure of the evening. The first row is what this bead added —
the router announces an outage on the *second* consecutive failed bring-up, not the first,
because that same file is about to retry in two seconds having just logged that a slow
start is evidence about the machine rather than about the build. Announcing immediately
meant a swap that came up on its second attempt cost a knock and a "serving again" twenty
seconds later, about an app nobody could have opened in the gap. **The log is not damped**,
only the sound: the log is the record somebody reconstructs an evening from.

**`unconfirmed` moved from class 2 to class 4**, reversing what `bc-ka5y.15.1` landed. The
argument for stuck was that "we ran it and nothing outlived it to check" is not a release
you can rely on — still true, and still what the card says. What was wrong was the sound.
`sweepDeploys` writes that word only for a deploy with `restarts` set, so it is **the
ordinary ending of every deploy beadcause makes of itself**, which meant the commonest
release in this repo was also the loudest noise the phone can make, several times a day,
about a deploy that had almost certainly worked. `lib/queues.js` had already reached the
same conclusion from the other end: its `RELEASED` set is `['ok', 'unconfirmed']`, because
the running build you are reading this on came up out of one of them. Nothing is given
away by the move — the card still says "deploy unconfirmed" rather than "deployed", and a
previous failure's card is still only cleared by an `ok`.

### The stuck card survives a restart, because it is asked for rather than replayed

`stuck` is the one class that is a *state*: a tracker in conflict or a deploy that failed
is still true an hour later, and both halves say so exactly once, on the tick the state
changed (`syncStuckEvent`/`deployEvent`) — which is right for not repeating itself every
poll and wrong for the two places that state actually lives. The daemon's event log
(`lib/events.js`) keeps 256 entries and nothing more; the phone's `Tray` is documented as
living in memory only, and empties the moment the process does. So the tracker breaks, the
card appears, the phone reboots, and the card is gone while the tracker is still broken —
and nothing says so again until the word moves, which for a conflict is never, because
nothing retries its way out of one. `bc-ka5y.15.8`.

**Both halves already know the current answer without replaying anything.** `syncer.trouble()`
survives its own restart (`state.json`'s `sync` key, `bc-y3qk.7`) and `deployTrouble()` reads
the same on-disk journal `sweepDeploys`/`unannounced` already sweep every cycle — newest
settled record per repo, `failed`/`lost` counts as trouble, an `ok` or `unconfirmed` after it
*is* the clear, with no flag of its own to keep in step with `deployClearEvent`. `GET
/api/poll` carries both as `stuck: [...]`, built with the same `syncStuckEvent`/`deployEvent`
that a real transition would use, so the phone's reconciliation is not a second wire shape to
learn.

**Unconditional, unlike `questions`/`requests`.** Those cost a `bd` sweep across every
workspace and are worth skipping on a poll that timed out with nothing new on the bus; the
stuck snapshot costs an in-memory map read and a handful of small files already read every
cycle, so there is no poll worth skipping it on — and skipping it on exactly the poll where
nothing else changed is the bug this section exists to fix. That poll is precisely the one a
phone makes right after a restart: the daemon did not restart, no new transition fired, and
`questions`/`requests` are correctly `null` on it. A `stuck` field gated the same way would
have been `null` too, every time, which is why it is not.

**The phone reconciles rather than replaying.** `WatchService.reconcileStuck` diffs the
snapshot's keys against what `Tray`'s `STUCK` deck is actually showing: a key present but not
showing is posted (and knocks — correct, it is the first time *this instance* has said so,
whatever the daemon's own history of the same condition); a key showing but no longer present
is taken down; a key present on both sides is left alone. That last case is the whole of "no
second buzz for a state it was already showing" — the acceptance criterion this was filed
against — and it is why this cannot be `Tray.retain()`, the same-shaped reconciliation the bead
decks already had: `retain()` only ever sweeps the bead decks, because a `stuck/…` key is
never a bead's and would be wrongly cleared by the question list's live set on the very next
resync.

### The five sounds, and auditioning one before it is permanent

`res/raw` holds five voices — `blip.wav`, `knock.wav`, `land.wav`, `drop.wav`, `chime.wav`,
one per channel above:

| File | For | What it is |
|---|---|---|
| `blip.wav` | A question is waiting | 75ms at C6. On Decisions it comes with a 20ms buzz. |
| `knock.wav` | Work is stuck | 340ms. Two knocks at B3 — the only low sound here. |
| `land.wav` | A merge landed | 45ms at G6 — the pip, smaller. |
| `drop.wav` | A release went out | 360ms. A water drop: pitch rising, then a soft tail. |
| `chime.wav` | An epic completed | 480ms. Two notes, G5 up to C6. |

**They are generated, not dragged in.** `npm run sounds` renders all four from
`scripts/sounds.mjs` and writes them to two places at once, and `test/sounds.mjs` fails the
repo if a committed byte differs from a fresh render. That is not ceremony: four `.wav`
files in a pull request are four things nobody can review, and moving the review to the
script puts every decision where it can be argued with — the pitches are a fifth and a
fourth apart on purpose, the peaks descend on purpose, and each number has its reason
beside it. A hand-edited binary is a red suite rather than a surprise.

**Two copies, and neither is the copy.** Each generated file is written identically to
`android/app/src/main/res/raw/` — what the APK ships and what an `android.resource://` URI
points `setSound` at — and to `public/sounds/`, which is what `/sounds` plays. `test/sounds.mjs`
asserts they are byte-identical. `blip.wav` gets the second path by a straight copy rather
than a render: it is already on three live channels and cannot be re-cut, but the audition
needs it, because a reference list with a hole where the reference goes is worse than no
reference list. Duplicating ~80 kB of generated audio is the cheap side of that trade; the expensive side is auditioning one file and shipping another, and a channel's
sound is immutable after `createNotificationChannel`, so there is no second chance to notice.

**`/sounds` (or `/audition`) is the audition, and it is blind.** Four anonymous pads in a
shuffled order, a guess each, then the reveal. Play a file called `drop.wav` and you hear a
water drop whatever came out of the speaker — the label does the work the sound was supposed
to do, which is why the acceptance criterion for a notification sound is naming it without
looking. The named reference list is *below* the pads for the same reason. `blip` is on that
list but not in the blind test: it is the sound everything else is placed against, and in
the case that matters — a decision waiting on you — it arrives with a buzz, so it never has
to be told apart by ear alone.

Judge it on the phone, twice — once on a desk and once through a pocket, which is the only
place any of this is really heard. The page plays at **media** volume while a real
notification plays at notification volume on a channel with its own level, so what `/sounds`
settles is how the five compare with each other; absolute loudness is settled on the phone,
on Android's own per-channel settings screen — which since bc-ka5y.15.4 has a row for each of
them. Disagreeing with a sound now costs that one channel a new id rather than an edit to a
number, which is the price of the channels existing at all.

`node scripts/sounds-check.mjs [--out=DIR]` is the browser half — the audition driven end
to end at 360 and 393, which is where the claims a file-reading suite cannot make live: that
the stylesheet actually applied and every control is a 44px tap target, that no pad gives
its own answer away, that twenty runs are not twenty of the same order, and that every sound
the page names is served as audio. That last one is why the check exists: the first version
of the page played `/sounds/blip.wav` against a daemon that answered 404, because the
reference pip lives in `res/raw` and nothing had copied it across. The page was right, the
file list was right, and nothing had ever asked them about each other.

The page is deliberately **not** in the service worker's `SHELL`. Precaching it without its
audio would be a screen of buttons that do nothing offline, precaching the audio too is 78 kB
on every install forever, and an audition is not a thing anybody does without a signal — every
other page in that list is there because you open it *at* the bad moment, and this is the
opposite of that.

### How the phone hears about a question

`GET /api/poll?since=<seq>&wait=25` parks server-side until the poller sees a new
question or an agent reply, then returns the events *and* the current question list
in one round trip. A poll that times out with nothing to report returns
`questions: null` — deliberately, so an idle watcher never costs a `bd human list`
across five workspaces. Off the tailnet the poll just fails and backs off to one
attempt every two minutes.

`resync: true` means the caller was away longer than the server's in-memory event
log; trust `questions` over the event stream. `seq` is persisted on the phone, so a
service restart resumes rather than re-notifying — and a cold start (no `since`)
reads current state with no backlog, the same way the daemon's own poller refuses to
push the questions already waiting when it boots.

### And the four things it hears about that are not questions

Until bc-ka5y.15.1 the poll above carried exactly four kinds of event to the phone —
`question`, `reply`, `foundation-request`, `foundation-reply` — and everything *else* the
daemon had to say went out over ntfy: a merge landing (`pushLanded`), a deploy finishing
(`pushDeploy`), a tracker that stopped syncing (`pushSyncTrouble`). That meant those
arrived in **ntfy's** app, on ntfy's channel, with a sound beadcause cannot set and a card
it cannot lay out. Four more event types moved them onto the same wire as everything else:

| type | what it is | card | may a muted space silence it? |
|---|---|---|---|
| `landed` | a pull request went into `main` | news | yes |
| `released` | a deploy succeeded, or ended `unconfirmed` — [which is the ordinary ending of a restart](#which-arrival-speaks-in-which-voice-and-what-stops-the-loud-one-crying-wolf) | news | yes |
| `stuck` | a deploy failed or was lost; or a tracker is not syncing | its own | **no** |
| `epic-done` | an epic completed | news | yes |

**Four types rather than one `news` type with a `kind` field**, because a client has to be
able to file an arrival — which card, which channel, whether it expires — without asking
the server a second question. `lib/news.js` composes all four, and composes them
*whole*: `title` and `text` arrive ready to draw, for the same reason the ntfy bodies they
replace were composed on this side. The sentence explaining a deploy refused over a stale
LaunchAgent, and the one saying a stuck tracker will *not* clear on its own, are the
product of arguments that live in `lib/launchagent.js` and `lib/sync.js`, and a second copy
of them in Kotlin would be a second copy to drift.

**`stuck` is the only one that is a state rather than an arrival.** Everything else here
happened and stays happened; a failed deploy is a condition, so its card has to go away
when the condition does. Same type, same key, `state: "clear"` instead of `"stuck"` — that
is what `pushSyncedAgain` became. It is also the only class a mute may not silence, which
is the whole argument for giving it the one insistent voice: a tracker that is not syncing
is the app quietly lying to you about every other machine, and a warning that can be
arranged not to speak is not a warning. Being a state rather than an arrival is also
what makes it the one card a restart can lose while the thing it was warning about is
still true — [see below](#the-stuck-card-survives-a-restart-because-it-is-asked-for-rather-than-replayed)
for how the poll answers that without replaying the transition.

**Nothing arrives twice.** The four pushers are *deleted* from `lib/notify.js` rather than
left running beside the events — a phone that gets a native card and an ntfy push for the
same landing is worse than one that gets neither. Three pushes stayed, and each stayed for
a reason about this pipe rather than about taste: `pushCertificate` and `pushNoBackend`
report a failure of the very path a native notification would have to travel — a phone
parked on `/api/poll` cannot be told that the certificate for the name it is polling has
expired, and cannot be told anything at all by a daemon that is not answering — and
`pushServingAgain` is the other half of the second. ntfy goes through a relay that has
nothing to do with either, so it still arrives.

**In the shade they are two more cards, and they are transient by construction.** `Tray`
was capped at two (`WORK`, `FOUNDATION`) because the shade stops being glanceable at about
three, and a landing must never push a waiting question off an `InboxStyle` summary. The
answer is not three more cards but two that clean up after themselves: `NEWS` carries a
six-hour `setTimeoutAfter`, so a card of landings takes itself away rather than sitting
under a waiting question all day, and `STUCK` exists only while something actually is. The
steady state of a working morning is still `WORK` and `FOUNDATION`. Neither new card
carries a button — the only action a landed merge could offer is a revert, and a revert is
not a lock-screen gesture — and tapping either opens `/prs`, where the question a landing
actually raises (*has it reached the running build?*) lives.

**They borrowed two existing Android channels until bc-ka5y.15.4, and now have four of
their own.** A channel's sound is immutable after the first `createNotificationChannel`, so
cutting `merged`/`released`/`epicdone`/`stuck` before their sounds existed would have burned
those four ids on day one — which is why news lived on the replies channel and a blockage on
the questions channel for a day. It no longer does: see
[*The five voices*](#the-five-voices-and-the-channels-that-carry-them). The `NEWS` *card*
still holds all three sizes of good news, because the argument for one card is about the
shade and the argument for three channels is about the ear; the card takes its voice from
whichever arrival caused the render.

**`epic-done` is the only one of the four whose *moment* is not a call site**, and it gets
its own section below: nothing closes an epic on its own here, so the trigger is a diff of
the tracker rather than a hook, and it owes one suppression — see
[An epic finishing](#an-epic-finishing--a-diff-of-the-tracker-never-your-own-tap).

**One landing comes from outside the daemon.** The merge queue runs in-process and calls
the bus directly; `bin/deliver.js` is a worker's own process with no bus, and it still
records a branch that was *already merged on github.com* when the delivery started. It
posts to `POST /api/landed` — the token, not a sign-in, and it cannot choose its own event
type — the same way `bin/endorse.js` posts endorsements rather than writing them behind the
daemon's back. A refusal there is a line on stderr and nothing more: a landing is true
whether or not a phone in another room hears about it.

`test/news.mjs` covers all of it, including a real `POST /api/landed` into a real
`createApp` and the `GET /api/poll` that answers with it.

**And a fourth kind of landing announces itself minutes or hours late — bc-ka5y.15.7.**
`lib/landed.js`'s own sweep closes a bead whose pull request merged **on github.com**
itself — a phone browser, another Mac, somebody else's tap — which none of the three
above ever sees. Until this bead it did exactly that and stopped: the bead closed, the
board drew it merged, and the phone said nothing about the landing that is arguably the
one you would most want to hear about, because it is the one you did not watch happen.
`lib/advocate.js`'s `landed()` now emits the same `landedEvent` the other three do, once
per tick and once per repo's worth of closes rather than once per bead — a Mac that
reconnects after a while away can close a dozen beads in one sweep, and a dozen
identical-looking cards is not a dozen pieces of news, it is one piece of news read a
dozen times. `landedNewsEvents` in `lib/news.js` is the one place that decides, and
below three closes it is still one ordinary card each; at or above it, one summary card
naming how many and listing every pull request. Still `type: 'landed'`, deliberately —
the phone already knows how to draw and sound that card, and a sweep catching up is not
a different *kind* of arrival.

**Three of those emitters live in the poller, where `bus` is not a name.** `createApp` is
one long closure holding `bus`, `bd`, `advocates` and `syncer` as locals; `startPoller` is
a separate top-level function beside it that gets the same objects as `app.bus`, `app.bd`
and so on. So a line copied down from one to the other parses, boots, and throws
`bus is not defined` on the first deploy the daemon settles — which is bc-gdub, filed by
the daemon against itself, and it cost every settled deploy its card on the phone while
the board still drew the deploy as finished. Reading the source for `bus.emit(deployEvent`
does not catch it, because `app.bus.emit(deployEvent` contains that text; the checks in
`test/news.mjs` are pinned to the `app.` prefix for that reason, and `test/pollerbus.mjs`
is the other half — it plants a settled deploy record on disk, runs a real poller over it,
and reads the events off a real bus, then sweeps the whole of `startPoller` for any daemon
singleton named bare.

**bc-gdub.1 is the general version of that one function's guard: `lib/noundef.js`, run by
`test/noundef.mjs`.** It parses every `.js`/`.mjs` file under `lib/`, `bin/` and `scripts/`
with `acorn` and hands the AST to `eslint-scope` — the scope-resolution engine ESLint's own
`no-undef` rule runs on, not a hand-rolled approximation — and reports every identifier
reference that resolves to no binding anywhere in the file: not declared, not a parameter,
not imported, not one of this Node process's own `globalThis` properties (read at runtime
rather than hand-typed, so it can never go stale against a Node upgrade). `node --check`
only parses, and a regex over the source cannot tell `bus` from `app.bus` — this is real
scope analysis, the same as `bus.emit(...)` three thousand lines inside `createApp` and
`bus.emit(...)` inside the sibling `startPoller` where the same object is only reachable
as `app.bus`. It found a live one on its first run over this tree: `/api/pr/detail`
destructured `const { unit } = requireUnit(...)` where `requireUnit` returns `{ ws, unit
}`, and fifty lines later a `.catch` read `ws.name` — fixed alongside landing this suite.
`test/pollerbus.mjs` stays: it is the only thing here that proves the sweep actually
*runs*, which a static scope check does not attempt.

### An epic finishing — a diff of the tracker, never your own tap

`epicDoneEvent` sat in `lib/news.js` for a day with nothing calling it, and the gap was
deliberate: the *shape* of the card is a decision about layout, and the *moment* an epic
finishes is a judgement. bc-ka5y.15.2 is the judgement, and it is `lib/epicdone.js`.

**There is no call site to hook, so the trigger is a diff.** Nothing in this app closes an
epic on its own. `lib/bd.js` refuses an epic close on a merge reason — *a pull request is
no evidence about a theme* — after six epics closed that way on 2026-08-12/13 with sixty
adoptees still open, and bd cannot be taught the rule either, because it has no pre-close
hook (`bd hooks` installs git hooks and nothing else). So an epic closes because somebody
decided it had, in one of four places: a tap on this app, `bd close` typed at a terminal
here, a worker session an advocate opened, or the same on the other Mac arriving over `bd
dolt pull`. Three of those four are other processes. What all four have in common is a row
that changes, which is why the poller holds the set of epics that were **not** closed last
time it looked and announces the ones that have since become so.

**The read is free.** The sweep asks `bd.graph(workspace)` — one `bd export` per workspace,
cached for sixty seconds and shared with the inbox's epic board — so on a daemon anybody
has a phone open against this reads memory rather than the tracker. It runs on the cycle's
ordinary slow clock with no interval of its own, late in the beat, because an epic that
finished is exactly as finished a minute from now.

**The first pass over a workspace seeds and says nothing.** A daemon that has just come up
must not announce every epic that finished last month, which is `sweptReleasesAt`'s
argument. What that costs is an epic closed while the daemon was down going unannounced,
and that is the right thing to lose. The snapshot is in memory for the same reason there is
no state file here to gitignore and nothing for `lib/evidence.js` to claim.

**A tracker that would not read leaves the snapshot alone.** `bd.graph` answers an *empty
index carrying `.error`* rather than throwing, so an export that timed out reads as "every
epic has vanished" to anything that believes it — and in a diffing sweep it would also make
the next good pass see the whole tracker as newly filed. That workspace is skipped whole
and reported on stderr.

#### The suppression, and why it is `actor` rather than a list of handlers

**An epic you closed yourself, from the app in your hand, must not chime.** A notification
for your own tap is the fastest way to teach somebody that a sound means nothing, and this
is the one of the four sources above where the phone already knows — you were looking at it
when it happened.

What marks a close as yours is the `actor` on it. `actorFor(req)` in `lib/server.js` is
`sessionOf(req)?.email || null`: a signed-in browser or app session and nothing else. Every
token caller — an agent, `bin/deliver.js`, an ntfy action button, the poller itself — passes
null and always has, so `actor` already means, exactly, *a person tapped this here*. The
record is taken in **`Bd.run`**, the single funnel every `bd close` this daemon spawns goes
through, rather than at the handlers that close things: a fifth path added next month gets
the suppression without knowing `lib/epicdone.js` exists, and the failure mode of forgetting
a registration would be a chime for an epic you closed while watching the screen.

The ledger is **not** drained by the sweep that reads it, and that is the ordering trap.
The graph is cached for a minute, so the beat right after a tap routinely reads a tracker in
which the epic is still open; the transition is seen a minute later, and a ledger emptied on
first read would have forgotten by then. Entries expire on a six-hour clock instead, under a
cap, so a tap you have long forgotten cannot silence a real close of an epic that was
reopened.

**Two more closes are not milestones either.** A **superseded** epic is a duplicate being
tidied away and an **unendorsed** one is a proposal being turned down; both are dropped
here rather than in the emitter, because both are facts about the bead and `lib/news.js`
only ever sees the four fields the card is drawn from. Neither is in bc-ka5y.15.2's
acceptance — both are usually a tap and so already silent — but *usually* is not the bar
when what is at stake is whether the sound means anything.

The card itself is `epicDoneEvent`'s and unchanged: the epic's **title**, and **how many
beads closed under it**. That count is children *and* adoptees, de-duplicated across the
two, because a grouping epic keeps its work in an `Adopts:` line rather than as `bc-x.1`
and counting only children would tell you an epic of eleven adopted beads finished with
nothing under it. Closed only — an epic can be closed over a `deferred` child, and calling
a deferred bead finished would be the count inventing a fact.

`test/epicdone.mjs` covers it, including a real `Bd` against a stub `bd` binary, so the
suppression is proved through the funnel rather than by reading a line of `lib/bd.js`.

### How many beads has this tracker filed under nothing? — counted, at last

The [filing gate](landing.md#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists)
and `withoutOrphans` (the ready queue's own filter) both already know, one bead at a
time, whether anything has decided a given bead should happen. Neither counts. bc-xl7n.83
is the number that grew to **53 unnoticed** on 2026-08-17 before a P0 advocate measured it
by hand — and the four passes that followed each hand-wrote the same three-line script
over `bd export`, one of them wrongly enough to report 42 where the real answer was 11.
`lib/orphancensus.js` is that script, written once.

**And it is not the same population `withoutOrphans` sees.** That filter only ever runs
over beads that have already reached the ready queue — a bead carrying `unendorsed`,
`human`, `container` or `ship`, or one that is blocked, deferred or already in progress,
is never offered to it, so an unrooted bead in any of those states is counted by nothing
at all, for as long as it stays that way. `bc-ysqd.1` was exactly this: filed under a live
P0 that closed an hour later, carrying `unendorsed`, invisible to `withoutOrphans` and to
every log line it writes. `orphanCensus` runs over every non-closed bead in the export —
the whole population the bead is asking about, not only the slice a launcher would act on
today.

**Two traps, both paid for by an epic-advocate pass before this file existed, and both
worth stating rather than re-deriving.** A bead must be tested for root-ness itself,
before its ancestors are walked — skip that and every root in the tracker reads as
unrooted, which is how one hand-rolled census reported 42 where the honest number was 11.
And the walk has to cross a *closed* parent rather than stop there, because a root that
closed over a still-open child is precisely the shape
[the filing gate](landing.md#where-it-lands--a-bead-filed-under-nothing-is-unworkable-the-moment-it-exists)
was built to catch, and stopping at a closed bead would make that child invisible to the
one thing counting it.

**The Merge #NNN genre is unrooted on purpose, and the census has to agree.** The merge
queue files those cards with no parent at all and works them without a root above them —
that is what keeps them out of dispatch by the same mechanism this file measures, so
counting them as a defect would make the number swing on nothing but delivery traffic.
Excluded by what they *are* — the `merge-queue` label (`lib/mergebead.js`) or the
`pr-delivery` label (`lib/delivery.js`) — never by matching a title, which a card that
merely mentions "Merge" in its own title would otherwise be caught by.

**And the second exclusion, for the same reason from the other direction: a bead already
decided *against*.** A bead carrying `superseded-by:<id>` has been looked at and ruled a
duplicate of work living somewhere else, so counting it among the beads *nothing* has
decided above inflates the very number this file exists to keep honest, and spends a
`[census]` line naming resolved work. Both siblings in the family already drop it —
`strandingsIn` (`lib/rootclose.js`) and `createEpicWatch`'s
`worthSaying` — and it is the same label read, from `lib/superseded.js`, that they read.
Still counted into `unrooted`, like the merge genre: having no root above it is a true
thing to say about it. **Which is why `mergeGenre` is counted rather than inferred** —
it used to be the residual `unrooted - ordinary.length`, which is only correct while
there is exactly one exclusion, and a second one arriving would have quietly reported
every superseded bead as a merge card (bc-xl7n.132.3).

**Logged once per bead per spell of being an ordinary orphan, not once per cycle.** The
same restraint `withoutOrphans` and the adoption sweep's own refusal log already use: a
bead that stays unrooted for a week would otherwise be the same line every cycle for as
long as the daemon runs, which teaches nobody to read it. What that buys is exactly what
the bead asks for — a rise is still noticeable, because every bead that newly becomes an
ordinary orphan produces one `[census]` line the moment it does, whether the workspace
already had none or already had fifty. Unlike `lib/epicdone.js`'s watcher, there is no
quiet first pass: a restart is not a milestone that would chime falsely, and the whole
point of this file is that the count was otherwise invisible, so naming every ordinary
orphan already on the tracker the first time the daemon looks is the feature working, not
a false alarm.

**But a bead-naming line can only ever fire on a rise, so the count also gets a standing
line when it *falls*.** An orphan adopted, or a root filed above a whole subtree, leaves
no bead for `describeOrphan` to name and so produced nothing at all — which made the most
recent `[census]` line in the log a high-water mark rather than the current count, and
made reading the standing number depend on a recent rise or a recent daemon restart
(bc-xl7n.132.2). Each per-workspace census row now carries `changed`, and one
`describeCensus` line per workspace goes out whenever the orphan picture moved in either
direction — including the fall to `no ordinary orphans`, the one number the old line could
not express. **Keyed on `unrooted` and the ordinary ids, never on `nonClosed`**: the
denominator moves every time anybody files or closes anything, so keying on it would put
a line in the log on nearly every cycle of a working day, which is the same "teaches
nobody to read it" failure the once-per-spell rule above exists to avoid. A workspace
already spoken for by a bead-naming line this pass is skipped, since that line carries the
same numbers — a rise stays one line, not two.

Runs on the cycle's ordinary slow clock beside `sweepEpicsDone`, for the same reason:
`bd.graph` is one `bd export` per workspace, cached for a minute and shared with the
inbox's own board, so a pass here costs nothing a repaint was not already going to pay.

`test/orphancensus.mjs` covers it — the pure count, both traps, the merge-genre
exclusion, the watcher's own once-per-spell logging and fail-open on a workspace it could
not read, and the standing line in both directions: an adoption is a change, a moved
denominator on its own is not.

### Noticing in five seconds — and not sweeping to find out

The park above is only as quick as the daemon behind it, and for a long time the daemon
was not quick at all. Everything in the poll cycle ran on one clock — `pollSeconds`,
thirty by default — so a bead answered in another session, a `human` label an agent
added, a reply comment: all of them were up to thirty seconds old before `/api/poll`
even knew there was anything to say. The delta stream delivers promptly and always did;
what it delivers is whatever the last cycle noticed.

The obvious fix is the wrong one. That number was doing two incompatible jobs at once —
it was the detection latency **and** it was the cost ceiling, because a sweep is one
`bd human list` per workspace plus a `bd comments` per conversation you are waiting on,
five subprocesses against an embedded Dolt that around twenty agent sessions are already
fighting over. Turning it down to five would have bought the latency by paying that cost
six times over, all day, almost always to learn that nothing had moved.

So the two are split, and there are two clocks now. `pollSeconds` still governs the
sweep and is unchanged. In front of it, on `detectSeconds`, runs a much cheaper
question: **did anything write to this tracker since I last looked?** When the answer is
no — nearly every beat of an idle laptop — nothing else runs at all. When it is yes, the
sweep happens within five seconds of the write instead of within thirty.

**The signal is Dolt's own manifest**, and the reason it works is that it is a commit
pointer rather than a timestamp. Every `bd` write is a Dolt commit and every Dolt commit
rewrites `.beads/embeddeddolt/<prefix>/.dolt/noms/manifest` — about 150 bytes naming the
new root hash. Reading it is one `open`/`read`/`close` of a file the page cache is
already holding, and it spawns nothing.

**The manifest alone is only true of embedded Dolt, and the reason is that embedded Dolt
exits.** Flushing the manifest is part of a `bd` process ending, so under the embedded
engine the new commit pointer is on disk by the time the command returns. A `dolt
sql-server` never ends. It holds the store open and defers the rewrite: measured on
2026-08-17 against a server on this repo's own workspace, writing and then polling, the
manifest moved after **35.19s** and **35.51s**. A detector reading it alone therefore
answers *nothing moved* for half a minute on a server-mode workspace and the daemon drops
silently to the `pollSeconds` backstop this exists to improve on — graceful, invisible,
and a straight miss against the five-second budget.

**So the chunk journal is read beside it.** Dolt appends every write to a single file,
`<prefix>/.dolt/noms/vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv` — thirty-two `v`s, a fixed name,
not a hash — and it does so *before* it ever touches the manifest: within 0.6s of the
write in the same measurement. Both are read and joined into one mark, so an embedded
workspace keeps precisely the behaviour it had and a server-mode one gains a signal that
moves at once. There is no mode detection and no per-workspace branch, because the file
is present in every database of every workspace, and it is the join that makes one
unconditional path correct for both.

**What is read of the journal is its size** — not its bytes, which are 854MB on this
repo's workspace, and emphatically not its mtime, which is the second near-miss below
wearing a different hat: measured, ten `bd` reads under the embedded engine moved the
journal's mtime and left its size alone. A size is appended to by writes and by nothing
else, it is monotonic between collections, and the detector only ever compares against
the mark immediately before it — so it needs no history. A `bd gc` truncating the journal
reads as one change and costs one extra sweep.

Three near-misses are worth writing down, because each of them looks like it would work:

- **`.beads/last-touched` is not it.** It holds the last bead id `bd` looked at, and it
  is rewritten *by reads* — a plain `bd show` moves it. A detector on that file would
  see its own sweep as a change, sweep again, and never stop.
- **The mtime is not it either**, for the same reason from the other direction: a read
  opens the manifest, and the mtime on the enclosing `noms` directory moves with it. The
  manifest's *contents* are byte-identical across a `bd list` and differ after a single
  `bd create`, which is the whole of why this reads the file rather than stats it.
- **An `fs.watch` is not it.** Cheaper still, but it is a per-workspace descriptor on a
  directory Dolt compacts underneath you, and macOS drops FSEvents into polling mode for
  exactly this shape anyway. A 150-byte read on a timer has no failure mode left to
  reason about.

**A tracker this cannot read is not an error, and never forces a sweep.** A workspace
with no embedded Dolt, a manifest caught mid-rewrite, a `dir` the config never carried:
each of them answers *unknown*, and an unknown workspace falls back to exactly the
`pollSeconds` cadence it had before any of this existed. The failure mode of the whole
mechanism is therefore *the old behaviour*, which is the only failure mode worth having
in something that decides whether the daemon looks at all. Setting `detectSeconds` equal
to `pollSeconds` chooses that deliberately, and is why there is no boolean to turn this
off with — a boolean would be a second thing to get wrong about the same question.

**Only the questions sweep rides the fast clock.** The advocate tick, the release queue
and the tracker sync stay exactly where they were, on `pollSeconds` and on their own
slower clocks under it — they open sessions, ask GitHub and take Dolt's write lock
respectively, and none of them is what a phone is waiting on. That is the half of the
acceptance criterion that is easy to lose in a refactor: *daemon load with nothing moving
does not rise*. It is asserted rather than assumed, in `test/detect.mjs`.

**And the cycle no longer overlaps itself.** `setInterval` does not await an async
callback, so a sweep slower than its own interval gets a second one started on top of it.
At thirty seconds that was theoretical; at five it is an ordinary Tuesday, since
`bd list` over five hundred beads has been measured at 28 seconds under the load twenty
agent sessions and a full `npm test` put on this machine. A beat that finds the previous
one still running now drops itself and says so once, when the long one finally ends,
rather than queueing another five subprocesses behind the same lock that made the first
one slow.

Nothing here covers a write that is not a write to a tracker — a pull request merged on
GitHub, a deploy started on another Mac. Those were never on this clock and are not on
this one either; they are events the daemon emits when it does them, or the release
queue's own sweep when somebody else did. And an action taken *in the app* has never
waited for a cycle at all: answering, endorsing and dismissing emit onto the log
directly, and the poll that wakes on them re-reads the inbox in the same round trip.

`node test/detect.mjs` holds all of it — including, against the real `bd` binary rather
than a stub, that the mark moves on a write and does not move on a read. That is a fact
about bd and Dolt rather than about this repo, and it is the one that would silently take
the whole mechanism back to thirty seconds if it ever stopped being true.

## The chat session — deciding what to file

Everything above acts on beads that already exist. The chat session is upstream of that:
a chat where you work out *what the next bead should be*, and beadcause creates it
only once you have read the proposal and pressed the button.

**＋ on the inbox** opens one — in the repo the space picker has selected, or asking
which if the space holds more than one. Or open one **on an existing bead**, from
*Work out the next beads from this* at the foot of any card, which starts the
conversation with that bead already read. The ones you have open are rows in the inbox
([why Chat is not a tab](navigating.md#why-chat-is-not-a-tab-and--is-not-a-tab-either)); `/console`
with no id is still the launcher, with every conversation including the finished ones.

```
you: the install script never checks that iTerm2 is there before
     offering the monitor-at-login option

     ◗ Read install.sh   ◗ bd search iterm   ◗ Read configure.js

     Nothing in the tracker covers this. install.sh:29-48 checks Darwin,
     node, bd and tailscale but never iTerm2 — so configure.js still offers
     the monitor, the agent gets bootstrapped, and install.sh prints
     "monitor window opens at login" while open-monitor.sh fails inside
     launchd. Two things that would change the bead:

     1. warn and carry on, or skip the monitor agent entirely?
     2. installer only, or the "discuss on the Mac" button too?

     🧾 proposed 1 bead — review
```

It asks before it proposes, and it looks before it guesses: it can read the working
tree and the tracker, so "does something already cover this?" is answered rather than
assumed. A conversation that has not earned a proposal yet doesn't make one — an
early half-guessed set of beads costs you more to read than one more question does.

### The launcher is a tab per repo, and ＋ is what starts one

The repo row used to be the start button: tapping `sorrel` opened a new conversation
in sorrel, and underneath it every conversation from every repo sat in one pile. With
enough repos and enough sessions that pile is the thing you actually have to read, and
it never groups the way you think — the conversation you want is the third sorrel one,
three beadcause rows down.

So the row is a **tab bar**. **All** on the left, one tab per repo, each carrying how
many conversations it holds, and the list below shows only the selected repo's. The
tab you leave on is the tab you come back to (`localStorage`, beside the token), so
the launcher opens where you left it rather than making you re-pick every visit.

Which means the row no longer starts anything, and starting moves to a **＋** beside
it. On a repo tab it starts there, immediately, exactly as tapping the chip used to.
**On All it asks** — a row of repos under *Start one in*, which is the control this
screen already had, kept for the one case the tabs cannot answer. The alternative was
a disabled ＋, and All is the tab the launcher opens on: a default screen with the
primary action greyed out is a worse trade than one extra tap.

Three smaller things that follow from it:

- **Every repo gets a tab, whether or not it has ever been talked to** — the bar is
  also how you reach a repo to start in. A repo with nothing in it shows no count
  rather than a `0`, and its empty list says so and names ＋, because a blank panel
  under a tab you just selected reads as a fault.
- **A repo that only exists in the conversations still gets a tab**, so a workspace
  dropped from the config does not take its transcripts out of reach. It gets no place
  in the ＋ picker, though: it is somewhere you can read, not somewhere you can start.
- **A remembered repo that is gone falls back to All.** Otherwise the launcher opens
  on an empty screen for a filter you cannot see the name of.

The tabs borrow the inbox's `.chip` deliberately: this row *is* the inbox's workspace
filter doing the same job to a different list, and a thumb should not have to learn two
shapes for one idea.

`node scripts/launcher-check.mjs` checks it in headless Chrome at phone size, against a
fixture `/api/consoles` served by the script itself, so it never touches a daemon or a
bead. Twenty-one assertions: the tabs and their counts, that selecting one filters the
list to it, that the selection survives a reload, that ＋ POSTs the *selected* repo and
lands in the thread, that ＋ on All opens the picker and starts nothing by asking, the
empty and the removed-repo cases, and — the one that must not have changed — that
opening a conversation by id still bypasses the launcher entirely. `--baseline` serves
the committed `console.js`/`console.html`/`style.css`, where there is no All tab and no
＋ at all, so it must fail everything but that last one. `--out=<dir>` writes the three
screens, because a row of passing assertions says nothing about whether the tabs and
the ＋ fit beside each other at 393px.

### Several chats are open at once, and switching is a repaint

The page used to be about exactly one conversation. `state.console`, `state.seq`, the
draft, which proposal cards were expanded and the poll loop all described the id in
`?id=`, and opening another chat was a full page navigation — which threw away the
transcript you had just read, the place you had scrolled to in it, and anything typed
into the composer and not yet said. Coming back meant fetching the whole thing again
and starting from the bottom.

So the singular became a map: `state.chats`, one entry per conversation, and `state.id`
naming which of them is in front. Everything that used to be a field on `state` is a
field on a chat, and a tap on a row in the launcher is answered from what is already
here. Nothing is evicted — a transcript is a few kilobytes and the whole promise of
holding several open is that going back to one is *free*, not free sometimes.

Three things had to follow, and each of them is a way the feature would otherwise
half-land:

- **The URL is written on every switch**, with `pushState`. It is the only durable name
  for where you are: a reload, a bookmark and the link on a bead card all land on the
  chat it names, and the system back gesture walks back out through the ones you came
  through. The `?ws=&seed=` way in *replaces* instead, because that address creates a
  conversation every time it is visited and a back gesture must never point at it.
- **One transcript poll, for whatever is in front.** A switch aborts the old one rather
  than letting it expire — it is parked on the server for up to twenty-five seconds, and
  a chat brought forward inside that window would sit unwatched for the rest of it. The
  chats in the background are followed by `/api/consoles` instead, every fifteen seconds
  and all of them in one request: their status is all that is needed, and a parked long
  poll per open tab is how a phone's connection budget goes. Their transcripts go stale,
  which is the trade — bringing one forward starts its poll, and one response carries
  everything said since its sequence number.
- **One send queue per conversation, not one per page.** This is the one that would have
  been silent: a single queue holds words said mid-turn until the turn lands, so with
  two chats open it would deliver what you said to one into whichever happened to be in
  front when that turn ended. Each chat has its own now. The strip above the composer is
  still drawn by `public/sendqueue.js` rather than by hand — every queue attaches to the
  same `#queued` through a selector carrying its own id, which matches only while that
  chat is in front, so a background queue moving repaints nothing and bringing a chat
  forward is `repaint()` on its queue.

The launcher rows are still real links to real addresses — copy one, open it in a new
tab, and it works — and a modified click is still the browser's. Only a plain tap is
caught and answered with a repaint.

`node scripts/switch-check.mjs` holds it, in headless Chrome at phone size against a
fixture served by the script: it stamps a word on `window` and asks after every switch
whether it is still there, which is the one difference a unit test cannot see — both a
repaint and a page load end with the right transcript on screen. Seventeen assertions:
the tap opens the chat and names it in the address without leaving the document, the
second visit costs no `GET /api/console`, the scroll position and the unsent composer
text come back, the top bar stops belonging to the chat you left, exactly one long poll
is parked and it names the chat in front, the background is asked about in one request
and gets no poll of its own, and a reload still lands where the address says.
`--baseline` serves the committed copies, which navigate for every switch and so fail
eight of them — the reload is the one that must still pass, because it is the behaviour
this kept rather than the behaviour it added.

The one thing it routes the long way round is the back gesture through *chats*: the list
was the only surface you could switch from, so the history a phone built was chat, list,
chat. Two chats stacked on each other is a tap on a handle, and the handles are below.

### The handles — a tab per chat you have open

Holding several conversations open bought you nothing to move between them with. The
only switch surface was the launcher list, which is a list of *every* conversation in
the repo — so going from one chat to the next meant coming back out to it, finding the
row again among twenty, and tapping it, on a list that reorders itself every time a turn
lands somewhere else.

So there is a strip above everything: **All** on the left, then one handle per chat you
have opened, in the order you opened them. It is the short list — the four you are
actually working in, rather than the forty the repo has ever had.

```
┌──────────────────────────────────────────────────────┐
│ ● Chat session                                  🧾 3 │
├──────────────────────────────────────────────────────┤
│ ⟨All⟩ ( ◌ iTerm2 check… ✕)(💬 bd sweep timeo… 🧾2 ✕)  │→
├──────────────────────────────────────────────────────┤
```

**All is the one that cannot be closed.** It has no ✕, and it is not there for symmetry:
it is the way back *out* of a conversation, and a strip you can strand yourself in is
worse than no strip. Tapping it is the launcher exactly as it was — repo tabs, dismissed
toggle, every conversation in the selected repo, live and finished alike.

Six things follow from that, and each is a way it would otherwise half-land:

- **The ✕ on a handle is not the ✕ on a row.** They are two characters apart on one
  screen and they mean opposite things. The row's is the soft close it always was: it
  stamps `closedAt`, the conversation leaves the list until *Dismissed* gives it back.
  The handle's touches nothing on the server — it takes the handle off the strip, the
  row stays in the All list exactly as it was, and opening it again puts the handle
  back. If that one ever POSTs, a gesture meaning "I have too many tabs open" starts
  dismissing conversations, so `test/chattabs.mjs` asserts the *absence* of the request.
- **Closing the one in front falls to its neighbour**, the way every strip of tabs
  anywhere does — and it *replaces* the history entry rather than pushing one, because
  closing a tab is not somewhere you went. An older entry naming the chat you closed
  still works, and arriving there re-adds its handle.
- **The strip does not move.** It is the only thing on screen in both views, so it is a
  fixed row of the page rather than something inside either — which is why it is above
  the repo tabs and not under them, where the bead first put it. Under them it would sit
  inside the launcher, and the first tap would jump it ninety pixels up the screen,
  taking the handle out from under the thumb that pressed it. It also makes the nesting
  the honest one: All is the *whole* launcher, so the row that filters that list belongs
  inside the panel it filters rather than above the strip that selects it.
- **They survive the app being closed**, which is what makes them tabs rather than a
  session's scratch state — `localStorage`, beside the token. Only `{id, ws}` reaches
  the disk, never a title. That began as a privacy rule — [the warm
  layer](navigating.md#loaded-once-and-kept--what-a-tab-tap-actually-costs) was `sessionStorage` so that
  bead text did not sit on the phone overnight, and a chat's title is bead text — and it
  survives that layer going durable on its second reason, which was always the better one:
  a stored title is a title that can be *wrong*, and a strip drawing last week's name for a
  chat that has been renamed is worse than one drawing the repo. A handle restored tomorrow
  draws its **repo** until
  the first `/api/consoles` comes back, which is the word the bar already falls back to
  for a chat with no seed — the same word in the same place, one request early.
- **They are scoped by repo**, off the same space picker everything else on the phone
  obeys, so switching it shows that repo's chats. With one exception, and it is the
  interesting half: the chat *in front* keeps its handle whatever the filter says. The
  picker moves from another device, or from the tab bar above; the list behind narrows,
  the conversation you are reading does not, and a strip whose selected tab is not on it
  is a broken control.
- **A handle says what its chat is doing** — the spark for a running turn, the 🧾 count
  for a proposal nobody has read — because the point of holding four open is not having
  to visit them to find out. That is one request for all of them: `/api/consoles` every
  fifteen seconds, which the page was already making for the loaded chats. It now counts
  open *handles* too, or a restored strip is a row of chats nothing is watching.

A strip holding only All is a row that says nothing and costs 40px of a phone, so it is
not drawn at all until something is open. Titles are a sentence long, so a handle
truncates to twelve characters and the strip scrolls sideways with the front one kept in
view; five open chats are 860px of handles on a 393px screen, and that has to be one
line — a strip that wraps eats the transcript under it.

`node test/chattabs.mjs` runs the real `console.js` in a vm against a hand-made document
for the twenty-four behavioural halves of that, and `node scripts/tabs-check.mjs` presses
the real handles in a headless Chrome at phone size, for the halves a vm cannot see:
that the strip is the same rectangle on the list and over a conversation, that five
sentence-long titles are one scrolling line rather than four wrapped ones, that the
selected handle is scrolled into view *including its ✕*, that the composer keeps its
place, and that the spark has a **box** — `.spark` is a bare span sized in px, so a slot
that is not a flex parent renders it as nothing at all, which reads identically to a
working one in any test that only looks at HTML. `--baseline` serves the committed
copies, where there is no strip in the page, so fourteen of its twenty-two fail and the
rest pass vacuously.

### A chat with an agent says so

Two screens start conversations, and they write the same record. `/console` starts a
**chat session** — describe a thing, get a proposal. [The agents
screen](agents.md#what-an-agent-is--and-how-it-asks-to-be-different) starts a **chat with one of
the agents** — the advocate, the dispatcher, the work session — which is the same
machinery with a different foundation and no proposal expected. Both carry a workspace,
so both are in `/api/consoles`, and the repo tabs made that *more* visible rather than
less: an agent chat lands under its repo's tab as if it had been started there.

Which left a chat with the advocate sitting in *Pick up again* looking exactly like a
conversation about what to file next, with only its title to tell them apart — and a
title is the one thing on that row you can rename.

So an agent chat is marked twice:

- **The agent's own emoji in the phase slot**, where a chat session draws 💬. Free, and
  it is the first thing your eye lands on down the left edge of the list.
- **A tinted pill beside the repo**, `📣 Advocate`, and this is the one that holds. The
  phase slot is *status* as well: a running turn draws a spark there and a finished one
  a tick, and both of those take the emoji away. The pill never moves.

That spark spent months in the markup without ever being on the screen. `.spark` is a
bare span sized in px, so the slot around it has to be a flex parent or the dot lays out
as an empty inline box, and it defaults to `var(--muted)`, so even laid out it is the
same dead grey as an idle one. Both lines existed twice — `.session-row .work-phase` and
`.chat-card .work-phase`, each with a comment saying why — and `.console-row` had
neither: `.work-phase` is a flex *item* of `.work-row`, which blockifies the slot but
not its children. Nothing caught it because nothing could: every test of that row read
HTML, and the HTML carries `<span class="spark">` either way. What tells the two apart is
a browser measuring the rect, which is why `scripts/launcher-check.mjs` now has a
mid-turn conversation in its fixture and asserts three separate things about its dot —
that it is wider than 0px, that it is painted `var(--accent)` rather than `var(--muted)`,
and that `breathe` is running on it. One per way this has gone wrong.

Leaving agent chats out of the list entirely was the other option, and it is worse:
they would then be reachable only from the agent they were started with, which is a
place you go to *change* an agent, not a place you go to find a conversation you had.
The point of *Pick up again* is that it is the one list of everything you were saying.

The name and the emoji are resolved **on the server** (`withAgentNames`, lib/agents.js),
because the record only ever stored the agent's *id* — the roster is where a name lives,
a custom agent's emoji exists nowhere else, and a second fetch for the roster from the
phone would paint every agent chat as an ordinary chat session and then correct itself.
Both routes that hand the list back use it, reading it *and* closing a row: the close
returns a fresh list the phone renders directly, so an undecorated one there would
un-mark every agent chat on screen until the next reload. An id with nothing behind it
any more keeps its own name and a generic 🤖 rather than falling back to the default
agent — the conversation happened, whatever the roster says now.

**There are two rosters, and for a while the pill was reading the wrong one.** The
names and emoji above came from `roster(cfg)` in lib/agents.js — the **reply personas**,
the chip row the phone offers when you comment on a bead. The ids a conversation can
actually be *opened* with are the **agent kinds** in lib/foundation.js, because that is
what `POST /api/console` gates on: the advocate, the dispatcher, the work session. The
two lists share no ids, so every real agent chat resolved to nothing and fell down the
unknown-id path — drawn `🤖 advocate`, lower-case, with the mark of a fallback where a
name belongs. Correct behaviour over a roster it was never in, and still the one row in
the list that read as a miss (bc-rjes). Each kind now carries its own label and emoji
(`mark`, lib/foundation.js), consulted before the personas: an id that is a kind *is*
that kind, whatever a persona of the same name would like to be called, since a persona
cannot own one of these records at all. The advocate's is 📣 — [the Advocates
pill's](navigating.md#getting-around--the-pill-row) icon, because it is the same thing and the
rest of its work is on that screen. A kind added to `BASELINES` with no mark fails
`test/agentchats.mjs` rather than quietly shipping as another 🤖.

`node test/agentchats.mjs` (in `npm test`) covers the naming and both routes;
`scripts/launcher-check.mjs` covers what the row draws.

### The proposal is the review, so the review is editable

Tapping **🧾** opens the proposal: one card per bead, and that is exactly what will be
created. There is deliberately no second *are you sure?* screen after it — a
confirmation you cannot change is only a delay.

Tap a card and everything is editable in place: title, type, priority, description,
acceptance, labels, [the files it expects to
touch](#a-card-says-which-files-its-bead-expects-to-touch), and — as chips naming the other
beads in the proposal — **parent** and **blocked by**. Remove a bead, or **＋** one the conversation missed. **Create N
beads** takes two taps, the same as answering a question, because creating six beads
in a tracker off a pocket tap is not undoable in any way that matters.

Your edits go back to the agent. The next thing you say arrives with the current draft
attached, so it argues with what is on your screen rather than what it last wrote —
without that it re-proposes a title you rewrote two turns ago, which reads exactly like
being ignored. And the sheet never repaints under your hands: a turn that lands while
you are mid-sentence in a description parks its revision behind a *use its version*
button instead of taking the textarea away.

Dependencies are resolved at creation time, in order — parents and in-proposal
dependencies exist before the bead that points at them. A `dependsOn` may also name a
bead that already exists (`dependsOn: [bc-7rx]`), which is how "this waits on the one
we started from" is written; those are checked against the tracker before anything is
written, so a made-up id costs a warning rather than a half-created proposal.

### A card says which files its bead expects to touch

Under Labels there is one more field: **Files it expects to touch**. Type
`lib/orders.js, lib/retry.js` into it, or let the agent propose them — a `files:` list on a
bead in its `beads` block, read under `touches`, `paths` and `surface` as well, because the
block is generated text and the cost of an unrecognised key is a declaration that silently
is not there. The collapsed card shows `2 files` with the paths in its tooltip; the count
rather than the paths because a repo-relative path is long and five of them would push the
priority off a phone, and the one thing worth seeing at a glance is *that* this bead named a
seam. An advocate's proposal card carries the same thing as **Expects to touch**.

This is the field [the queue filter](advocates.md#the-bead-whose-files-somebody-is-already-editing)
reads, and it is the only place in beadcause anybody writes one. The moment is the point:
a proposal is the one time somebody has the whole shape of the work in their head and
nothing has been created yet, so "which files" is the same kind of claim as a title or a
dependency and costs a sentence to make. Later it is a bead somebody has to go and edit.

It is also the one field on a card that is about the **other** cards. Two beads in one
proposal naming one file are two windows that must never open together — which is a
judgement to make before pressing Create, by merging them, rather than a collision
discovered at downmerge a day later.

**Nothing is stored as a field, because `bd` has no such column.** The surface is written
*into* the created bead's description, as the `beadfiles` block
[described above](advocates.md#the-bead-whose-files-somebody-is-already-editing) — by `withSurface` in
`lib/beadfiles.js` and by nothing else, so a block written by the console and a block
written by [a plan](advocates.md#an-epic-is-planned-not-worked--and-each-group-gets-its-own-window) cannot come to be
spelled differently. It is normalised at the card and not at filing time, so `./lib/a.js`
and `lib/a.js` are one path on the screen you are correcting rather than two paths that
turn into one silently afterwards.

**A bead that declares nothing is filed exactly as it always was**, description
byte-for-byte, and dispatches exactly as every bead filed before this existed does. Nothing
about a surface can refuse a filing, warn about one, or clamp one: a bad path is dropped
and the bead is created. A declaration is a forecast written before anybody read the code,
and the P0 this belongs to is explicit that a wrong one must dispatch rather than withhold —
a field that could withhold work by being malformed would move the whole cost to the one
place it must never be.

The failure worth engineering against here is silent. A surface crosses five stages — the
YAML an agent emits, the draft the server holds, the card the phone renders and edits, the
YAML fed back to the agent next turn, and the `bd create` at the end — and a stage that
drops it looks precisely like a stage that kept it: the card says `2 files`, the bead is
filed with none, and the advocate reports nothing forever. So `node test/consolesurface.mjs`
(in `npm test`) asserts round trips rather than stages, and its last group drives
`POST /api/console/create` against a `bd` that records its argv and reads the surface back
out of the `--description` that `bd` was really spawned with.

### A label is filed exactly as it was typed — only the refs are slugged

The Labels field on a card splits on the comma and changes nothing else. Case, spaces,
`@` and — the one that matters — the **colon** all survive to `bd create --label`.

That is not a nicety, because half the labels worth typing here are structured, and each
of them is read back by splitting on a colon: `owner:<handle>` is how
[who is answerable](inbox.md#epics-assigned-to-you-and-the-tree-each-one-carries) is decided and how your P0 cards are
sorted first, `held:<stamp>:<handle>` is how [another Mac's claim](advocates.md#the-bead-another-mac-has-claimed)
is held, `superseded-by:<id>` is how a bead leaves every queue for good. Slugging one of
those does not tidy it up. It produces a lookalike that no query matches, beside the real
one, and nothing on the board says which is which.

Every bead filed from one chat on 2026-08-13 came out carrying both
`owner:neo@example.com` and `owner-neo-gmail-com` — twelve of them, twenty-three
by the time it was noticed, because `bd create --parent` hands a parent's labels down to
every child. It took *two* bugs meeting, and the second is the reason it was a pair rather
than a rename: `lib/draft.js` slugged the label on the way in, and then `Bd.create` — which
stamps this machine's owner onto any root that arrives without one — looked for the `owner:`
prefix, could not find it through the slug, and added a second label naming the same person.

What is still slugged is everything a proposal invents for itself: a `ref`, and the
`parent` and `dependsOn` that point at one. Those are identifiers with no existence
outside the card, and lowercasing them is exactly what makes *The Epic* and *the epic* the
same edge rather than two beads. `lib/draft.js` keeps `slug` for those three and
`labelList` for labels, `public/console.js` normalises the field the same way so the phone
sends what you typed, and `node test/draftlabels.mjs` (in `npm test`) pins both halves —
including the argv `bd` is actually spawned with, which is the only layer where the pair
was ever visible.

### A card may state a fact, but not one of the daemon's records

The fix above had a side effect nobody asked for: once labels stopped being slugged,
`unendorsed`, `held:<stamp>:<handle>` and `superseded-by:<id>` reached `bd create` intact
too. A card carrying `superseded-by:bc-x` files a bead that is out of every queue from the
moment it exists; one carrying `unendorsed` files work no advocate will ever pick up. Both
silently, and neither is a thing the Labels field offers you to type.

Meanwhile the sibling write — the ✎ on a bead that already exists — had run every label
through `isProtectedLabel` since the day it was written. So the two ends of one tracker
disagreed about who owns a label, and the disagreement was in nobody's head.

`lib/proposedlabels.js` is the create side of that, and the line it draws is **not** the ✎'s
list. A label is one of two things:

| | | |
|---|---|---|
| **A record of something that already happened** | refused | `unendorsed`, `agent-filed`, `held:…`, `ran:…`, `superseded-by:…`, `ship` |
| **A statement about the bead** | allowed | `owner:…`, `for:…`, `container`, and every ordinary label |

A bead being created has no history, so every label in the first row is a claim about a
past that does not exist — a lease held by a session that was never dispatched, a
[record of what a finished session was billed to](landing.md#and-what-it-actually-ran-on--the-ran-label)
before anything ran, the [endorsement hold](pull-requests.md#the-endorsement-queue--a-group-tap-or-a-row-at-a-time)
on a card you are looking at as you press the button. The second row is the opposite: who
is answerable, [whose decision it is](operations.md#who-a-question-is-for--me-and-the-for-label), whether
this is [furniture rather than work](advocates.md#a-standing-root-is-furniture-not-work). Saying one of
those on the way in saves a second act, and there is nothing yet for it to overwrite.

That last clause is the whole reason the two lists differ. `owner:` and `for:` are
protected from the ✎ because [that control](landing.md#approve-adjust-decline) posts the label set
the card is showing, and "remove what I no longer see" is how a removal is expressed there
— so a label it does not offer is destroyed by omission. A create cannot destroy anything
by omission. It goes the other way too: `held:`, `superseded-by:` and `ship` are refused
here and are not on the ✎'s list at all, because a bead that already exists may legitimately
be carrying them.

Refused labels are **dropped rather than fatal** — the bead is filed, and a warning names
the label and what it would have done. That is `lib/draft.js`'s rule, that a proposal is a
conversation's output and four good beads are not thrown away to punish one bad label; and
because a chat [stays open when a create warns](#a-chat-session-ends-when-the-beads-exist),
the sentence is read on the screen that produced it. The same guard runs on the other
proposal path — approving an advocate's block — where there is no screen to warn on, so
what was dropped is commented on the question instead.

That warning still only fires *after* you press **Create**, and until bc-xl7n.87 the Labels
field on the card showed `unendorsed` or `superseded-by:bc-x` as an ordinary value in the
meantime — the card and the bead it was about to become disagreed until the warning
appeared underneath. So `lib/draft.js` now asks `daemonOnly` the same question while it
normalises a bead — for an agent's proposal and for a phone's edit alike — and keeps the
answer as `labelIssues`, keyed by the label. `public/console.js` reads that field rather
than re-deriving the rule: it greys the label's pill with the reason as its title, and
prints the same sentence in words under the Labels field, because a `title` is a tooltip
and this screen is read on a phone. The warning after the create is unchanged — this is the
earlier notice, not a replacement for it.

`node test/proposedlabels.mjs` (in `npm test`) covers both refusals end to end, and its
last section is a static read of `isProtectedLabel` itself: add a family there without
deciding what a create should do with it, and this suite fails naming your label.
`node test/labelchip.mjs` pins the earlier notice against the same `DAEMON_ONLY` list, so
the two cannot drift apart either.

### A card that is already a bead says so — and still files

**Create** is the only write in the whole chat session, and it was the only way into
this tracker that never asked whether the thing it was about to file already existed.
Everything else asks: an advocate [flags a proposal as it writes
it](advocates.md#what-counts-as-work), approving one [checks again and
refuses](landing.md#approve-adjust-decline) a duplicate the card never mentioned, and
`beadcause-propose` checks what a session finds mid-work. `lib/dupe.js` was simply
never imported by `lib/draft.js`.

What that cost is measured rather than imagined — three epics for one history page,
filed from three chats inside 82 minutes:

| filed | epic | what it was |
|---|---|---|
| 15:14:49 | `bc-qsj6` | independently worded, P2, three children |
| 15:23:15 | `bc-nib3` | 8m26s later, P1, six children — the one that survived |
| 16:37:13 | `bc-xpwh` | word for word the same as `bc-nib3`, all six children |

The third would have been caught by comparing titles on any threshold at all. The
first would not, and it is the expensive one: it reached a finished, tested,
unmergeable branch writing the same two filenames as one of `bc-nib3`'s children.

So each card now carries **⚠︎ Possible duplicate: already open as bc-nib3 — "…"** when
its title is near-verbatim one that is open, in progress, blocked, or asked for by a
proposal still waiting on you. Same threshold and the same sentence as the proposal
card, written on the server so the two cannot drift. The whole line is a link into the
bead it names, which opens in the drawer over the conversation — looking costs neither
the chat nor the draft. It is drawn above the fold, on the collapsed card as well as
the open one, because the review sheet opens with every card collapsed and a warning
among the fields is a warning nobody reads.

**It warns; it does not refuse, and that is deliberate.** A proposal card is a
question answered by one tap, so a duplicate nobody was shown is not something that
tap consented to and the create is refused. A chat session is the opposite: you are
looking at the cards, you have edited them over several turns, and re-filing something
on purpose is a real thing to want. Nothing is disabled — the app states the fact and
leaves the decision where it belongs. What creating over a flag does leave is a line
in the daemon log naming the bead you were told about, for the morning after, when the
question is whether a duplicate was filed knowingly or by nobody noticing.

Two things it does not do, both on purpose. It never re-checks at the moment you press
the button, because that is the check that would have to *refuse* something to be
worth anything. And it asks the tracker only when a **title** moves: `findDuplicate`
reads nothing else, the phone saves the cards 700ms after you stop typing, and a sweep
per save would be a `bd` subprocess for every sentence of a description. A lookup that
fails is logged and dropped — an unflagged draft is exactly what every draft was
before this — because losing a conversation's output to a `bd list` outage would cost
far more than the warning is worth.

`node test/consoledupe.mjs` (in `npm test`) covers all of it, including the honest
negative: the `bc-qsj6`/`bc-nib3` pair is *not* caught, because catching two
independently worded epics needs their children or their acceptance compared rather
than their titles, and a green run must not read as "duplicates are impossible now".

### And the same check runs at `bd create`, whoever filed it

Every net above sits on the **proposal** path — an advocate writing one, you approving
one, a chat session drafting one — because that is where the pair they were built from
collided: `bc-j6x` and `bc-ec6`, byte-identical titles, proposed twice on one day, both
approved, both opened, one worker window wasted finding the fix already committed on
somebody else's branch.

The duplicates that kept arriving afterwards were not proposals. Three pairs, each filed
by a **worker mid-session** with a plain create, hours apart, none linked to its twin
until an advocate pass found all three by reading titles weeks later:

| the pair | what it was |
|---|---|
| `bc-297u` / `bc-syzm` | `.chip` declared twice in the stylesheet |
| `bc-767a` / `bc-giuc` | the disarm that never runs |
| `bc-zjep` / `bc-zflo` | the `/api/error` write |

A session filing mid-flight is the likeliest thing in beadcause to file a duplicate: it
is deep in one bead, it has not read the tracker, and what it just tripped over may well
be what another window tripped over this morning. Telling it to check first is the
approach that already failed — the advocate's survey prompt has said "check `bd list
--status=open` before you propose" since the beginning, and it proposed anyway. A prompt
is a request, and a request loses.

So the check now runs at **`Bd.create`** as well: the one seam every bead beadcause files
is born in, whether it came from a worker's `beadcause-file`, an approved proposal, a
chat draft, a JIRA sweep, a crash the daemon filed on itself, or an edit filed from the
app. A call site added next month is covered without knowing it exists, which is the same
argument the addressee and owner stamps beside it are made on.

**It links, it does not refuse.** That was the open question and this is the answer:
a refusal is right exactly once — at proposal approval, where the question goes back to
somebody holding the phone who can settle it — and everywhere else there is nobody to
send it back to. A worker that has just found a real bug at 02:00 must not be stopped by
a resemblance, and 0.9 title similarity is a resemblance rather than proof. So the bead
is filed, its notes gain a **Looks like a duplicate — already open as bc-297u — "…"**
paragraph, and the pair gets a `relates-to` edge, which is what makes each reachable from
the other on the graph page and in any brief.

Three details do the work:

- **The edge is drawn *by* the paragraph, not beside it.** The sentence names the twin's
  id, and [the write-time mention hook](inbox.md#every-bead-id-in-prose-is-an-edge-behind-it) already
  turns a bead id in a new bead's own words into an edge. So the record and the sentence
  explaining it arrive in one write and neither can exist without the other — no second
  `bd` call, no half-linked pair if the daemon dies in between.
- **Nothing is said twice.** A caller that already named the twin — `beadcause-file`
  writes its own sentence from a fuller read, pending proposals included — is left alone.
  This seam speaks only where nothing else did.
- **A question is not checked at all.** The sweep card, the stranded-branch finding and
  the merge card have formulaic titles by construction, each already refuses to file its
  own twin, and a resemblance paragraph on an inbox card would be noise on the one screen
  where noise costs most. Anything carrying `human` is skipped, and costs no read.

The candidates come from the workspace shape that is already cached for the epic board and
for filing a bead under a P0 (lib/homing.js), so on a running
daemon the steady-state cost is a map walk and no `bd` call at all. Held for a minute on
a timer of its own — the parent cache is dropped every time a bead is filed under a
parent, and reading titles out of that entry would have made a session filing three
discoveries pay three full reads. A bead filed inside that minute is remembered by hand,
so a batch that words the same discovery twice catches its own second bead.

And it can never fail the create. A tracker that could not be read is exactly the state
every bead was filed in before this existed; losing a discovery over a see-also would be
the wrong trade in the direction the filing seam already refuses.

`node test/createdupe.mjs` (in `npm test`) drives the real `Bd` against a fake `bd`
binary, so it sees what actually reached the command line: the paragraph, the
`bd dep relate` behind it, the caller that is not talked over, the question that is not
checked, the batch that catches itself, and the unreadable tracker that still files.

### And a sweep for what `Bd.create` never saw

`Bd.create` only ever sees a bead the moment it is filed. That leaves two things
uncaught: a pair that was already sitting on the graph, unjoined, before the check
above existed, and a bead filed by a literal `bd create` typed into a shell — `bd
hooks` is git hooks only (pre-commit, post-merge, pre-push, post-checkout,
prepare-commit-msg), there is no pre-create hook, so a session that reaches past
`beadcause-file` for a plain `bd create` is invisible to everything above.

lib/dupesweep.js is the backfill: on every poll cycle it reads the same `Bd.graph`
index `sweepAdopts` beside it already reads, and for every pair of live beads whose
titles clear `DUPE_THRESHOLD` (0.9) with no edge between them yet, draws a
`relates-to` — one `bd dep relate` per pair, nothing else. Reading the cached index
rather than a fresh `bd list` is what makes it affordable on a thirty-second clock:
the steady-state cost is a `Map` walk over data the daemon already had, and a write
only for a pair that clears the bar, which after the first pass over a workspace is
nearly always none. The first pass over this graph *is* the backfill: any pair
sitting unjoined when this landed gets the same edge a fresh duplicate would, within
one cycle rather than the hour the bead asked for.

**It links silently, the same call `Bd.create` already made.** A resemblance is not
a decision anybody has to tap through — `Bd.create`'s own answer to "refuse it, or
file it linked" was to link it and say why in the new bead's own notes, and a pair
found late is the same fact as a pair found at create time: two live beads about the
same thing that had not found each other yet. A card would cost every hand-typed `bd
create` an inbox entry nobody has to answer, on the one surface (lib/dupe.js's own
words, about the sweep card and the stranded-branch finding) where noise costs most.
Skips a `human` bead on either side for the same reason `Bd.create`'s check does — a
question's title is formulaic by construction, and the sweep card, the
stranded-branch finding and the merge card each already refuse to file their own
twin.

**Worth saying plainly: this stays at the same 0.9 bar, not a looser one.** The three
pairs in the table above are the motivating case for this file too, and only one of
them — `bc-767a` / `bc-giuc` — is still live; `bc-297u`/`bc-syzm` and `bc-zjep`/
`bc-zflo` have since closed and carry their edge already. But none of the three ever
scored above 0.65 against `titleSimilarity`: they are the same bug described from a
different angle, not a near-verbatim title, and that is a harder problem than a
word-set comparison solves — loosening the bar on a graph of several hundred long,
similarly-worded titles (this repo's own convention) would trade a sweep that misses
real pairs for one that wires unrelated beads together every cycle. So this sweep
catches what its acceptance criterion actually asks for — a near-verbatim title with
no edge — and the harder case of the same bug in different words is
[the section after next](#and-the-harder-case-the-same-job-in-different-words), not a
bug in this file.

`node test/dupesweep.mjs` (in `npm test`) covers the plan against real `bd export`
JSONL through `indexFrom` — an unjoined near-verbatim pair, a pair already linked by
any edge type, one merely sharing a few words, a closed bead, a question on either
side, a deterministic three-way tie — and the round trip against a fake `bd`: what it
writes, that the graph refreshes once per batch rather than once per write, and a
rejected write landing in the answer rather than throwing into the poll cycle.

### And the harder case: the same job in different words

The section above leaves the hard half open, and this is it. A 0.9 word-set bar catches a
bead typed twice and nothing else, which is worth having and is not what this graph
actually produces. The measurement, on beadcause itself: **twelve live beads carry
`superseded-by:`**, each one a duplicate a worker found by hand and could not close.
Scored against the bead each duplicates, with this repo's own `titleSimilarity`, they run
**0.07 to 0.64** — median 0.30, top of the range 0.64. Not one is within reach of 0.9.
Eleven of the twelve carry `agent-filed`: they came through `beadcause-file`, from a
session deep in one bead that had not read the tracker.

Lowering the bar does not work, and that was measured too, over all 45,451 live
non-`human` pairs:

| bar | flags | catches |
|---|---|---|
| `dice >= 0.50` | 11 pairs | 2 of 12 |
| `dice >= 0.40` | 45 pairs | 4 of 12 |
| `dice >= 0.35` | 100 pairs | 5 of 12 |

Eight times more noise than signal at the loosest bar that catches even five. Requiring a
shared source file alongside it halves the flags and adds no recall; structure alone is
worse, with 583 of those pairs sharing files at Jaccard ≥ 0.5 against twelve real
duplicates. **No lexical threshold separates the two populations**, because what separates
them is what the words mean.

So `lib/samejob.js` shortlists cheaply and judges semantically:

1. **The shortlist** is pure — no model, no spawn. Three signals, none decisive: a shared
   file surface (declared *and* prose, unioned, where `surfaceOf` takes one or the other),
   kinship — two beads in one epic's family, which is three of the twelve pairs — and title
   similarity at `TITLE_FLOOR` (0.25), far below the near-verbatim bar. Anything clearing
   any signal is a candidate; the top eight by combined score go on. Replayed over the
   twelve pairs at the moment the second of each was filed, the first is in that top eight
   **ten times**. The two misses are epics with generic titles naming no path at all, and
   they are named in the suite rather than buried in a ratio.
2. **The judge** is one headless `claude -p` over those eight rows, running as the chat
   session's foundation for lib/sessionaudit.js's reason — a read-only judge needs exactly
   the read-only surface every reading agent has, and a new foundation kind owes five
   registrations before it can run. It is affordable because the shortlist handed it eight
   rows and not three hundred: about 7 KB of prompt.

**This one refuses, where the create-time flag does not.** lib/dupe.js's rule is that
refusing loses work nobody can send back — true of a crash the daemon files on itself at
04:00, and not true here. A session ran `beadcause-file` and is still holding the context
that produced it, so it is told which bead covers the work, **what it wrote is committed as
a comment on that bead** rather than dropped, and `--force` files anyway in the same breath.
The observation survives the refusal; that is the whole reason a refusal is affordable.
Refused filings exit **5**, distinct from 4 — both mean "you did not get every bead you
asked for", and only one of them is worth retrying.

Every failure is a pass. A judge that cannot start, times out, answers nonsense, or names
a bead it was never shown files the bead and says so on stderr. The errors are not
symmetric and the prompt says so out loud: a wrong `none` costs one duplicate bead, which
is ordinary and gets tidied later, while a wrong name throws away a discovery a session
cannot find again.

`node test/samejob.mjs` (in `npm test`) covers the shortlist against the real corpus —
`test/fixtures/samejob-pairs.json` is those twelve pairs, real titles and descriptions,
each oriented as a create-time check would meet it — plus the exclusions (closed, `human`,
ignored), the cap, the deterministic tie order, and the verdict plumbing through an
injected runner: an invented id, `none`, unparseable YAML, no block at all and a spawn that
throws are each asserted **not** to be a refusal.


### What you just filed, one tap away

Creating leaves a **✓ Created N beads** note in the scrollback, one row per bead. That
row is the one link in beadcause you tap while still holding the thought that made the
bead, so it goes straight to the bead: `?open=1` on the graph page raises that bead's
detail sheet as soon as the graph has drawn, and the text you just wrote is on screen
without finding a node in a force layout mid-animation. Dismissing the sheet leaves you
on the graph, scoped to that bead, which is where the link used to stop.

The whole row is the target — pill *and* title in one anchor, 40px tall. The title was
the big wrapping thing beside a 40px-wide pill, and it looked tappable long before it
was. Same for the **Starting from** line at the head of a seeded chat session.

`node scripts/created-link-check.mjs` checks all of it in headless Chrome at phone
size, against fixtures rather than the daemon, and aims `elementFromPoint` at the
middle of the *title* rather than trusting the markup. `--baseline` serves the
committed `console.js`/`graph.js`/`style.css` instead: it must fail the five link and
target cases and pass the two that describe what already worked.

### A chat session ends when the beads exist

A chat session is a conversation with one purpose, and pressing **Create** achieves it. So
accepting closes it and drops you back to the list — there is nothing left to say to
a conversation whose whole subject is now three rows in the tracker, and a list where
every finished one stays open is a list you read past to find the one that isn't.

Closing is **soft**. The transcript stays on disk, the id keeps working, and saying
anything to a closed chat session reopens it — "one more thing" is a normal thought to
have five minutes later, and a dead end you can navigate to and not use is worse than
a row you close twice. The unspent draft *is* dropped, because cards left on screen
after a close are an invitation to create them twice.

- **✕ on any row** in the list closes it by hand — for the conversations that end by
  going nowhere rather than by filing anything. The ✕ and the row are siblings, not
  nested, so closing one can never also open it.
- **Closed rows sink** below the live ones, dimmed, with a `closed` pill.
- **Warnings keep it open.** A create that reports one — a parent that does not
  exist, a dependency it could not resolve — leaves you on the screen that produced
  it. Dropping to the list would take the warning away before it was read.
- **Refused mid-turn**, with a `409` that says so: a chat session that is `thinking` has an
  agent streaming into it, and a reply arriving into something the list calls
  finished is worse than closing it twice.

Both the close and the reopen appear in the scrollback as quiet divider lines. They
belong in the history, but rendering them in an assistant bubble would read as
something the agent said.

### One refused edge does not cost the rest of the batch

Creating from a chat proposal makes the beads first and wires them together afterwards,
once every id is known. A `bd dep add` can be **refused** — bd holds one edge per pair in
either direction, of any type, so a pair that already carries a `relates-to` cannot then
be given a `blocks`, and `lib/mentions.js` draws that `relates-to` for free the moment
either id appears in the other's prose.

Until bc-arj0.19 the first refusal ended the create. Filing bc-khoe, `bd dep add
bc-khoe.5 bc-45yl` was refused and the three dependencies declared after it were never
attempted. Nothing looked wrong — nine beads, the right parents, the right text — and
what was missing was structure on the beads furthest from the error, which named none of
them. That is this epic's own failure mode by a new route: a dependency declared, and
then existing only as prose in a description.

So `lib/edges.js` applies the batch, and:

- **Every declared edge is attempted.** A refusal is recorded against that edge and the
  loop carries on. Nothing is rolled back either — beads has no transaction, and
  un-writing four good edges because a fifth was impossible loses more structure than it
  saves.
- **Every failure is reported by id, as the command that would fix it** —
  `bd dep add bc-khoe.5 bc-45yl — refused: <what bd said>`, with bd's own
  `… failed in <workspace>:` prefix trimmed off because the line has already spelled the
  command. An end that resolved to nothing has no id to paste and is reported as
  `skipped — no such bead` instead.
- **The batch is summarised in one paste** — `2 of 5 declared dependencies did not land;
  the other 3 did. Paste to retry: bd dep add …; bd dep add …` — so retrying the lot,
  once whatever made them impossible has been dealt with, is one line rather than a
  reading exercise.
- **The warnings keep the chat session open**, by the rule above, so the report is read
  on the screen that produced it.
- **A create that fails part-way still wires what it did make.** The beads that exist are
  real, and the structure between them is no less true for a later card having failed to
  become a bead. The request is still a `502` naming the create that failed.

The JIRA ingest files the same shape of proposal and goes through the same module, so
the two spellings of that warning cannot drift apart. A single edge applied on purpose —
a delivery parking its bead behind a merge card, a supersede — deliberately does *not*:
there a refusal is a real error and `bd.addDep` keeps throwing it.

`test/edgebatch.mjs` (in `npm test`) holds it, and the refusing edge in it is the second
of four rather than the last, because a batch whose bad edge is last passes on the broken
code too.

### Keep typing while it is working

Both chat surfaces used to treat a running turn as a reason to shut the composer
down. The bead console disabled the box and the send button and swapped the
placeholder for `working…`, which on a phone means the keyboard drops and there is
nothing to type into; the agent chat let you type but refused to send, so what you
wrote came back into the box behind a red toast. On the CLI you can type — and queue
— the whole time an agent is working, and losing that on the phone is worse rather
than better, because a turn that spends ninety seconds reading files is ninety
seconds of a thought you have to hold in your head.

So the composer stays live for the whole turn, on both screens, and what a running
turn changes is only where the words go:

- **Sending mid-turn queues.** The message appears above the composer as its own
  dashed line, in your own words, so it reads as said-but-not-yet-delivered rather
  than as part of the conversation or as lost.
- **The queue flushes when the turn lands**, as the next turn, automatically.
- **Everything said during one turn arrives as one turn.** Two queued messages
  concatenate with a blank line between them. Firing them as two `claude -p` runs
  back to back would answer the first without knowing the second exists.
- **A queued message is editable and removable until it goes.** Tapping the line puts
  it back in the composer — above whatever is half-typed there, so taking a message
  back to fix a word cannot cost the sentence you were in the middle of. The ✕ drops
  it.
- **Nothing pushes through the server's refusal.** `sendTurn` still answers `409`
  while a console is mid-turn, and that stays the truth: this is the side that waits.
  A delivery refused in a genuine race puts the words back and retries, rather than
  reporting a red toast about a feature working as designed.

Delivering a message *into* the turn already running is deliberately not this. That
needs a persistent `--input-format stream-json` process instead of the one-shot
`claude -p --resume` per turn, and is its own piece of work.

The queue lives in the page: a reload loses what has not gone yet. Everything that
*has* gone is on the server and in the transcript, which is the line worth keeping — a
message is either visibly waiting on your screen or really sent, and never both or
neither. The half-typed text in the composer beside it used to live in the page too,
and no longer does; see [an unsent draft outlives the
page](#an-unsent-draft-outlives-the-page).

The queue itself is `public/sendqueue.js`, shared by both callers rather than written
twice — including the pending strip, which `queue.attach({ el, box })` draws and wires
back into the composer. The two screens still render a *conversation* their own way,
which is the line: a message that has not gone yet is not part of one, and two
hand-written copies of the same strip would drift. Each caller keeps its own
optimistic bubble, though, and that is deliberate too: the round trip is a process
spawn, and words that vanish for a second read as having been eaten, so the message
is drawn in the thread the moment it goes and taken back out again if the send fails.

**A queue belongs to a conversation, not to a page.** The bead console holds several
chats open at once now, so it makes one of these per chat and attaches each to the same
`#queued` through a selector carrying its own id — the strip is still drawn here, and
only the queue of the chat in front matches. That is what `repaint()` is for: every
other paint follows the queue moving, and bringing a chat forward is the one that does
not. See [several chats at
once](#several-chats-are-open-at-once-and-switching-is-a-repaint) for why a shared queue
was the failure that would have been silent.

`test/queue.mjs` (in `npm test`) covers the queue: queued mid-turn, delivered on the
turn ending, two arriving as one, a refusal that keeps the words and does not spin,
and an idle repaint that re-sends nothing. `node scripts/queue-check.mjs` covers the
half a unit test cannot see — the real `console.js` and `foundations.js` in headless
Chrome at phone size, against a fixture server that answers a mid-turn message with
the same `409` the daemon does: the textarea is enabled, the send button is tappable,
the placeholder is unchanged, the box keeps focus, and both messages land as one turn
with the fixture never once having been pushed through. `--baseline` serves the
committed copies of both files, which fail it.

### An unsent draft outlives the page

Words that were *sent* and failed have been safe since the send queue landed: they sit
above the composer in your own words, they can be tapped back into the box, and the
strip says what is happening to them. Words that never left the box had none of that.
They existed in the textarea and in `chat.say` and nowhere else, and both die with the
page — so a reload, a crash, a backgrounded tab the phone evicts, or a client that
re-mounts the page on a retry took the paragraph you were half-way through, with no
recovery and no warning that there had been anything to recover. That asymmetry was
the bug: the longer and more considered the message, the more there was to lose.

So the composer's contents are written to `localStorage` on the keystroke, per chat,
and read back when that chat is next drawn. Four things about it are the design:

- **On the keystroke, not at some later save.** The same rule the inbox's answer boxes
  follow (`setDraft` in `public/app.js`): the next thing that happens to this page may
  be that it stops existing, and a save scheduled for a moment later is a save that
  does not happen.
- **`localStorage`, not the `sessionStorage` `public/warm.js` uses.** `sessionStorage`
  is scoped to the tab, and a tab that is gone is precisely the case this exists for.
  warm.js's rule — no fetched bead prose sitting on the phone's disk overnight — is
  about somebody else's words; this is your own typing, which is the thing you would
  be angriest to lose.
- **Keyed by chat id, in one map under one key.** Two conversations can never restore
  into each other, switching between chats is unaffected, and pruning is a rewrite of
  one JSON object rather than a walk over every key in `localStorage`.
- **Sending clears it, before the queue is handed the words.** From that moment the
  words belong to the send queue, which is what puts them back in the box if the
  delivery fails; a kept draft that survived a delivery would restore *beside* the
  message it had already sent.

A draft is dropped after a fortnight, on the next read. A sentence typed that long ago
and never sent is not a draft any more — it is a surprise waiting in a chat you had
forgotten — and the stamp is also what keeps a map of drafts from becoming a hoard.

The restore runs `autoGrow`, so a four-line draft comes back four lines tall rather
than as a one-line box you have to click into to discover the rest of. Storage being
denied — private mode, a WebView with it switched off — is caught and ignored
throughout: the composer works for that visit and forgets on the next, exactly as the
chat tab strip beside it does.

`test/composerdraft.mjs` (in `npm test`) runs the real `public/console.js` in a `vm`
against a hand-made document, the way `test/chattabs.mjs` runs the same page's tab
strip: type and reload, send and reload, two chats side by side, a stale entry, a map
written by something else, and storage that refuses every write. A "reload" there is a
second boot of the same file over the same storage map, which is the right shape and
still not the real thing — so `node scripts/switch-check.mjs` closes it in a headless
Chrome at phone size: a draft typed into one chat, a real `Page.navigate` to another
and back, each conversation getting its own words back and the box restored at the
height it was left at rather than as a one-line strip. `--baseline` fails exactly those
three and passes everything above them.

### An old proposal says what became of it

A reply that proposed beads keeps its `🧾 proposed 3 beads — review` line for the life
of the transcript. The draft it pointed at does not: creating spends it, the next turn
replaces it, closing drops it. So by the time you scroll back up, that button is a
control whose target is gone — and what it used to do then was nothing, silently.

The line stays, because it is part of what the conversation said. What it *offers*
depends on what happened after it, read off the transcript rather than stored on the
message — the first thing below it that either consumed that draft or put another one
in its place:

- **✓ filed 2 beads** — it became beads. Tapping walks you down to the `✓ Created`
  note that consumed it and flashes it, because that note already lists the ids and
  each one opens the bead. It deliberately does not reopen the editor: those beads
  exist, and an editor over them is an offer to file them twice.
- **🧾 proposed 3 beads — revised since; open the current draft** — a later turn
  replaced it. Tapping opens the sheet, which is the honest thing to say about it:
  what is in there is the *newer* draft, not what this message proposed. Saying
  "review" and then showing something else is the quiet lie this replaced.
- **🧾 proposed 2 beads — draft discarded** — visibly disabled. The draft went away
  without becoming anything, which is what closing a chat session does to unspent cards.
  There is nothing to look at, and the only useful thing left to say is that.
- **🧾 proposed 1 bead — review** — the newest live proposal, unchanged. Opens the
  sheet, exactly as before.

`node scripts/console-check.mjs` holds the rule: the real `public/console.js` in a
headless Chrome at phone size, against a fixture chat session served by the script itself,
so it never talks to the daemon. It taps every proposal line in the thread and
requires the screen to answer — the sheet opens, the page moves, something lights up,
or it says why not. `--baseline` serves `HEAD:public/console.js` instead, which is how
you tell a real failure from a flaky one: baseline must fail the filed and revised
cases and the inert tap, the working copy must pass all of them.

### What a chat session costs you to know

- **The agent cannot write to the tracker.** Its allowlist is read-only `bd` plus
  Read/Grep/Glob. That is not belt-and-braces around the prompt — the review step is
  the whole promise of the feature, and an agent that could call `bd create` would
  eventually do it mid-conversation, after which beadcause would create the same beads
  again from the proposal. One writer, and it is the button you press.
- **A turn is a fresh `claude -p`, resumed by session id** — not a process parked
  across the minutes of silence in a phone conversation, where a laptop lid or a
  `launchctl kickstart` would take the conversation with it. `--session-id` on the
  first turn, `--resume` after, so Claude Code's own transcript is the durable copy and
  a chat session survives a daemon restart.
- **It starts in the workspace's session directory**, the same rule the "discuss on the
  Mac" button follows (`resolveSessionDir`), so `~/.zshenv` points `BEADS_DIR` and
  `CLAUDE_CONFIG_DIR` — which tracker, and which account is billed — at the right tree.
- **A turn that reads half a repo is not cheap.** The one in the example above was
  about $0.40. `consoleModel: "sonnet"` trades some judgement for a cheaper
  conversation; `beadConsole: false` turns the whole thing off.
- **The proposal is a fenced `beads` block** in the agent's own reply, parsed the same
  way a `decision` block is (`lib/proposal.js`). It replaces rather than appends, so a
  revision re-emits every bead — merging partial proposals would mean reconstructing
  what the agent meant from a diff it never wrote.
- **Chat sessions live in `~/.config/beadcause/consoles/`** — the directory keeps the
  old name, since it is where the records already are — and are pruned after 30 days.

## Discussing a question on the Mac

Some questions can't be answered with two taps — you want to argue with someone
first. **Discuss in a Claude session on the Mac** opens an iTerm2 window with
`claude` already reading that bead, from the phone, over the tailnet.

**Where the session starts** decides everything else, so there are two modes.

*Default.* The session opens in `~/beads/<workspace>` — the workspace's own
directory, where `bd` finds `.beads` by walking up from the cwd. Always correct,
nothing to configure. This is what you get on a fresh install.

*`projectRoot` set.* Some shells derive `BEADS_DIR` from the working directory — a
`chpwd` hook mapping `<projectRoot>/<repo>` → `~/beads/<repo>`, often carrying
`BEADS_ACTOR`, an API token and even `CLAUDE_CONFIG_DIR` (i.e. **which account gets
billed**) along with it. If yours does, set `projectRoot` and the session opens in
the matching checkout instead, picking all of that up from the shell's own startup
with nothing passed in. Set `fallbackWorkspace` to whatever a shell *outside* that
root resolves to.

In that second mode the mapping is *verified*, not assumed: beadcause recomputes
what `BEADS_DIR` a shell in the candidate directory would resolve to, and refuses to
open the session if it doesn't match the workspace the question came from. Opening a
session that quietly writes to the wrong tracker, or bills the wrong account, is
worse than not opening one.

`sessionDirs.<workspace>` overrides both modes for a single workspace.

The session opens with a short brief: which bead, how to read it (`bd show`,
`bd comments`), how to record the answer (`bd comment` + `bd close --reason`, never
the broken `bd human respond`), and an instruction not to answer on your behalf —
you opened it to talk, not to delegate. It also names itself
`<Project> - discuss <id>`.

### Permission mode

Sessions start with `claude --permission-mode auto`, set by `sessionPermissionMode`.
That default is the point of the button: you tapped it from another room, so a
session that halts on the first permission prompt and waits for a keyboard is no
use. Any of `auto`, `acceptEdits`, `manual`, `dontAsk`, `plan`, `bypassPermissions`
works; `null` launches with no flag and inherits your settings. Unrecognised values
are ignored with a warning rather than passed through — `claude` exits immediately
on a bad mode, which would look like an iTerm window that opens and instantly dies.

The mode is logged on every launch (`permission mode: auto`), because a session that
quietly came up in the wrong one is otherwise invisible until it stops to ask you
something you aren't there to answer.

Worth knowing what does and doesn't backstop this. `auto` is classifier-driven, not
carte blanche — it still refuses things. And `~/.claude/hooks/worktree-guard.sh`
denies edits in the main checkout of any repo using the `.claude/worktrees/`
workflow — so repos without one are unprotected. Check which of yours qualify. If
that gap matters, set `sessionPermissionMode: "plan"` and promote by hand.

Two notes:

- **This is the only endpoint that starts a process** rather than running `bd` with
  fixed arguments, so it is guarded harder: the workspace must be one already being
  served, the id must match a bead-id pattern before it goes anywhere near a shell,
  and the question's title is read back from `bd` rather than taken from the request
  body — a crafted body cannot put text on the command line. The prompt travels via
  a temp file the shell reads and deletes, so a multi-line markdown brief never has
  to survive being typed through AppleScript. Set `openSessions: false` to turn the
  whole thing off.
- **macOS may block the first attempt.** The daemon runs under launchd, where a TCC
  prompt might never be shown to anyone; if you get "macOS blocked beadcause from
  controlling iTerm", approve it once in System Settings → Privacy & Security →
  Automation.

### One window per workspace — where sessions go

Every session beadcause opens is a **tab**, in one iTerm window per workspace: a
beadcause window, a loremia window, and so on, each titled with its workspace. Workers,
advocates, resolvers, merges, planners and chats all go in as tabs, and a tab closes
when its session ends (bc-2uj4.16.1). If that leaves the window empty, it closes too.

Which window is which workspace's is kept by window id in the daemon's state, and
re-checked before every new tab: the window has to still be there, and one of its tabs
has to still carry the workspace in a session variable (`user.beadcauseWorkspace`),
because iTerm reuses window ids. If you close the window, or the id now belongs to a
window of your own, the next session makes a fresh one. A tab you open by hand in a
workspace's window is left alone, and does not stop beadcause using that window.

A new window is made on the display `sessionWindows.screen` names — `largest` by
default, which is the external monitor when one is plugged in and the laptop when it
isn't — at iTerm's own size. After that it is yours: beadcause never moves or resizes
it. This replaced a layout that gave every session a window of its own and dealt them
across one screen as scattered cards (bc-gi8u); its `layout`, `card` and `jitter`
settings are gone and are ignored if a config still has them.

Reaping a session that never started closes only that session's tab, never the window
around it, so its siblings keep running. The details view's focus button (bc-fwsw)
selects the session's tab as well as raising its window.

The tabs also open with a **profile of their own**, written to
`~/Library/Application Support/iTerm2/DynamicProfiles/beadcause.json` and picked up
by iTerm without a restart. It inherits from your Default profile, so session tabs
still look like your terminal, and overrides four things a session needs and a shell
does not: unlimited scrollback (the interesting part of an agent session is usually
the part that has already scrolled past), no confirmation sheet when a worker closes
its own tab, a normal window type so a full-screen Default profile can't take over a
display, and a window title that names the workspace. The file is rewritten only when
it changed — iTerm reloads every profile on each write. If it isn't loaded yet, the
tab opens on the default profile rather than failing.

#### It hands the keyboard back

Opening a window used to mean losing the sentence you were typing. iTerm brings
itself to the front and makes a new window key whether or not anybody says
`activate` — there is no background-window flag in either its AppleScript or its
Python API, and `set frontmost of <window> to true` doesn't work. So focus is
*borrowed*, not never taken: the window that had the keyboard gets it back
(`select`, after a beat long enough to beat iTerm's own activation), and so does the
tab you were on — which matters when you were typing in the very window the new tab
went into, because `create tab` makes the new tab current there. If you were
in another app entirely — the usual case, since the button that opens a session is on
a phone — that app is raised again too. Which app that was is read from `lsappinfo`
rather than System Events, because the daemon runs under launchd, where the
Automation prompt System Events needs may never be shown to anybody.

A keystroke typed in the half-second while the tab is coming up still lands in it.
What this removes is the far worse case: the tab that *keeps* focus, so the rest
of your command goes into a fresh agent's prompt. Set `sessionWindows.stealFocus:
true` for the old behaviour.

## The terminal — driving a session from the phone

That button needs you to walk to the Mac. **⌨️** in the top bar, or **Drive a session
on it from here** in a card's ⋮ menu, opens the same thing on the screen you are
already holding: the real Claude Code TUI, on a pty, over a WebSocket. Everywhere else
in beadcause you answer an agent; this is the one place you steer one.

Seeded from a card it opens on that bead with the same *talk it through, don't answer
for me* brief. Opened cold it asks which workspace, and starts there.

### It keeps running when your screen locks

This is the whole design, not a nicety. A phone that locks drops the socket within
seconds and iOS kills it the moment the tab is backgrounded — so a terminal whose
process died with its connection would lose the conversation every single time the
screen went dark, which is worse than not having one.

So the pty belongs to the daemon, not to the connection. Sockets attach and detach;
output keeps accumulating into a scrollback ring while nobody is watching; coming back
replays it into a cleared screen. Reconnecting is automatic and backs off, and the page
drops its own socket when you background the tab rather than waiting for the OS to.
What ends a terminal is quitting `claude`, pressing **⏹**, or the idle reaper — never
a dropped connection.

### And it survives the daemon, too

Restarting the daemon still kills every pty — one relaying to a registry that no longer
exists is a leak. What it no longer does is lose the *conversation*.

The terminal picks the claude session id itself, before the process exists, and passes
`--session-id` on the first start; a record per terminal lands beside the chat sessions in
`~/.config/beadcause/terminals/`, written at lifecycle boundaries only — open, resume,
exit, shutdown — never per chunk. On the next boot the registry is rebuilt from those
records and each one comes back **`resumable`**: listed on the terminal page with a ↻
and "resumable — the daemon restarted", holding no process at all. Attaching is what
starts one, with `claude --resume <id>`, and the first thing in the pane says so.

Three things about that are deliberate:

- **Nothing is spawned at boot.** A daemon that respawned four `claude` processes on
  startup would be resurrecting sessions nobody asked for, before anyone was watching.
  The phone attaching is the signal that the conversation is still wanted.
- **A session you ended stays ended.** The record stores `live` (meaning "this did not
  end") or `exited`, and only the first becomes an offer. Getting that backwards would
  reopen finished work on every restart. `shutdownTerminals()` writes each record down
  *before* it kills the pty, and a flag stops the exit handler that follows from
  overwriting it — otherwise the daemon would record, on its way out, that everything
  you had open ended at 4am.
- **The scrollback does not come back, and the pane says so.** It is up to 256 kB of raw
  pty output per terminal, it would have to be written continuously to be worth
  anything, and replaying a dead session's bytes into a freshly resumed TUI draws a
  screen that is half history and half live. `claude --resume` redraws the conversation
  itself, which is the honest version of the same thing.

If the transcript has been pruned since, `claude` says `No conversation found with
session ID: …` and exits — the terminal ends the way any other ended session does,
rather than silently starting a different conversation under the same name.

**A hot swap is a daemon restart as far as a terminal is concerned**, and it happens
every time you save a file in `lib/` rather than once a week — so the socket is closed
deliberately at the cutover, with a code the page reconnects from, rather than being cut
when the drain gives up on it. See
[the WebSocket goes through it too](operations.md#the-websocket-goes-through-it-too-and-a-swap-ends-it-on-purpose).

### The keys a phone doesn't have

Claude Code is driven by esc, ^C and shift-tab, and an Android soft keyboard offers
none of the three. The row above the keyboard is therefore the feature and not the
trim: **esc · tab · ⇧tab · ^C · arrows · ⏎**, plus **⌨** to bring the keyboard back
after a tap on one of them stole focus. They send real bytes, so ^C is a real SIGINT
handled by `claude` itself.

Rotating the phone reflows properly. The pty is resized for real — `stty` against the
slave device, which makes the kernel raise SIGWINCH in the foreground process group —
rather than the TUI being left drawn at the width it started at.

### What the terminal costs you to know

- **The pty comes from `expect`, and could not have come from `script(1)`.** There is
  no `openpty(3)` in Node's standard library, and `node-pty` is a native module
  ABI-locked to the Node the launchd plist pins. `script(1)` is the obvious substitute
  and does not work: it calls `tcgetattr()` on its own stdin before allocating
  anything and only tolerates `ENOTTY`, while a spawned child's stdin is a socket and
  gives `ENOTSUP`. Redirecting from `/dev/null` gets past that and then there is no way
  to send a keystroke, which is the entire point. `expect` is in the base system, needs
  no Homebrew and no npm, relays raw bytes both ways over ordinary pipes, and writes
  out the slave device name — which is what buys back the resize. See the long note at
  the top of `scripts/pty-relay.exp`.
- **It starts in the workspace's session directory**, by `resolveSessionDir` and
  nothing else — the same rule the "discuss on the Mac" button and the chat session
  follow, so `~/.zshenv` points `BEADS_DIR`, `BEADS_ACTOR` and `CLAUDE_CONFIG_DIR`
  (which tracker, and which account is billed) at the right tree.
- **The token rides as a WebSocket subprotocol**, `new WebSocket(url, [proto, tok])`,
  never in the URL. A browser cannot set a header on a handshake, and the query string
  is the one place a secret must not go — it is what ends up in history and in every
  log between here and there. The same token as everything else; the same tailnet.
- **Permission prompts are left on.** `terminalPermissionMode` defaults to `null` —
  inherit whatever your settings do — unlike `sessionPermissionMode`, which is `auto`
  precisely because nobody is watching. Here you are watching; the prompts are the
  point. The brief asks the agent to batch what it needs approved, because every
  prompt is a tap on a keyboard you can barely hit.
- **Idle terminals are reaped.** After `terminalIdleMinutes` (default 30) with no
  socket attached, a terminal is closed. The clock only runs while nobody is watching:
  a session you have open is never reaped for being quiet, because quiet is exactly
  what one looks like while it reads a repo. At most `terminalMax` (default 4) at once,
  and the daemon kills them all on shutdown — outliving a *socket* is the point,
  outliving the process that owns them is a leak. A resumable one (below) counts
  against the cap and ages out on the same clock.
- **Scrollback is bytes, not lines** — `terminalScrollbackBytes`, 256 kB by default —
  and it is kept as raw chunks, never decoded on the way in. A pty splits UTF-8
  sequences across chunk boundaries constantly, and decoding per chunk would put
  replacement characters in the scrollback permanently. When the ring overflows you get
  a one-off "scrollback was trimmed" toast.
- **This is a bigger escalation than `POST /api/session`** — arbitrary interaction with
  an agent rather than one fixed command — so it has its own switch: `terminal: false`.
  It is on by default, on the grounds that what gates it (tailnet plus token) already
  gates a button that starts an *unattended* agent on the same Mac.
- **`script(1)`'s limitation is gone, but `ws` is a dependency.** If the daemon starts
  without it installed the terminal switches itself off with a warning and nothing else
  is affected — an install that pulls this update and restarts before `npm install`
  loses one page, not the inbox.

## Progress: what an agent is doing right now

An agent working on a question can say so, and it shows on the card — a breathing
dot, the phase, the detail line and how long ago:

```bash
node bin/status.js -w acme -i ac-abc -p researching -m "reading the Stripe docs"
node bin/status.js -w acme -i ac-abc -p drafting    -m "comparing both fee models"
node bin/status.js -w acme -i ac-abc --clear
```

Phases: `thinking` `researching` `drafting` `building` `blocked` `waiting` `done`
— anything else is accepted and shown as-is. `POST /api/status` does the same
thing over HTTP.

Progress lives in `~/.config/beadcause/status.json`, **not** in beads. `bd
set-state` writes an event bead per change, which inflates the issue's dependent
count ("blocks 7") with churn that's obsolete seconds later. Set
`mirrorStateToBeads: true` if you want the `agent:<phase>` labels anyway — the
app reads them either way, so a session that calls `bd set-state` directly still
shows up.

Your own writes get progress too: submitting shows "Recording your answer…" while
`bd` retries through the Dolt lock, instead of a dimmed card and no explanation.
