/*
  One row of pills, across the top of every page (bc-khoe.1).

  ## What it replaced, and why two bars could not stay

  There were two of these, drawn alike and meaning different things. `public/tabbar.js`
  was a bar along the *bottom* of five pages that moved between **pages**; the chip row
  on /monitor (`public/montabs.js`) swaps a **pane**. A phone showed both at once, one at
  each end of the screen, and the only way to know which one a given control was on was
  to have learned it. On top of them the inbox has a third axis of the same kind inside
  its filter panel — the ten kinds in `public/inboxfilter.js`, which are categories doing
  a view pill's job. bc-khoe.2 amalgamated those ten to six and promoted them here.

  All of that collapses into this row. The bottom bar is deleted outright: the epic's
  claim is that Home *is* the app and everything else is one tap from it, and a second
  bar at the other end of the screen is the shape you get when that is not true.

  ## Why the top, and why it scrolls sideways

  The bottom is where a thumb is, which is the argument the bar was built on — and it is
  also the edge iOS puts the home indicator and the URL bar on, which is why the bar
  spent its life drifting (bc-7utr). The row is a row of the app shell now (see the shell
  note at the top of public/style.css): `body` is one viewport tall and clipped, the top
  bar and this row are flex rows above the one element that scrolls, so nothing here is
  laid out against a viewport that moves, because no viewport moves.

  It **scrolls horizontally and never wraps**. There are nine pills today — the six
  kinds bc-khoe.2 promoted out of the inbox's filter panel, the advocate console, the
  Releases view bc-khoe.7 moved the deploy strip onto, and the selected space's own
  settings (bc-khoe.10). Both of the two this paragraph used to promise have landed, so
  nine is the count rather than the forecast. bc-khoe.4 adds none, which is a change: it
  used to promise two, and bc-khoe.30.6 ruled the other way for the reasons under *The
  Mirror* below. A row that wraps to two lines on a 360px phone is
  the exact thing this epic exists to stop — it spends a second row of a screen that is
  mostly chrome already. So the row takes the width it needs and the current pill is
  scrolled into view on load, which is the one moment the offset can be wrong without
  anybody having touched it.

  ## A pill is a link only when there is somewhere to go

  There is one rule under all three shapes below and it is the whole of this section:
  **an `<a>` is for a document this page has not got.** A link to something already on
  screen throws the list, the conversation and your scroll position away to rebuild the
  same screen, and every exception here is that sentence applied to a different way of
  already having it.

  * **The current pill is a `<span>`** with `aria-current="page"` and no href. You are
    there. `aria-current` says so to a reader that cannot see the accent and the filled
    pill says it to one that can, and neither is colour on its own.
  * **A view whose pane is in this document is a `<button>`** (bc-khoe.30.3). Since the
    shell landed, `/` holds one `[data-pane]` container per view and moving between them
    is a `display: none` swapped for a `display: flex` — see public/panes.js. So the pill
    writes the hash and the panes answer it, and no second document is asked for. The row
    finds out by asking `panes.has(...)`; on the nine pages that have no panes the
    answer is no and the pill is the link it always was.
  * **A kind pill is a `<button>` wherever Home is reachable without a load**
    (bc-khoe.2). Five of the six kinds *are* Home under a different narrowing, so a link
    would be a full document load — a refetch of every workspace, a rebuild of forty
    cards, an open card thrown away — to change which rows of a list already in hand get
    drawn. On the shell that holds from every pane, not just from Home: tapping `PRs`
    while the Ledger is up carries `data-view` as well as `data-kind`, so the tap switches
    pane and narrows in one go. On a page that is not the shell it is an
    `<a href="/?kind=…">` that goes there and arrives narrowed; `?kind=` is read once, at
    load, by public/inboxfilter.js.

  ## Which one is lit: the hash decides the view, the filter decides within Home

  The hash names one of three views and public/panes.js shows it; that view's pill is the
  lit one, and this file asks rather than deriving it — `panes.showing()` on the shell,
  and `viewOfPath` on the nine pages that are still documents, which is the same answer
  read off the other half of the URL.

  Home is where it stops being a fact about the URL, and that is not a wrinkle in the
  grammar but a difference in kind. Five pills share Home's one address *and* its one
  (empty) hash, because they are not places — they are narrowings of a list already in
  hand, and a narrowing is not something the back button should walk. So within Home the
  *filter* is the answer, pushed in through `mark()` by inboxfilter.js's `paint`. Pushed
  rather than pulled because this file is on ten pages and that one is on Home alone:
  a row that read the selection itself would have to know the storage key, which is a
  second place that knows what a kind is — the exact thing bc-khoe.2 exists to remove.

  `mark()` records the narrowing wherever it is called from and only repaints when Home
  is the pane on screen. That is what keeps the pill you last chose waiting for you when
  you come back to Home from another pane — the inbox goes on repainting while hidden,
  and a `mark` refused outright would leave the row lighting last week's answer.

  ## The four counts, and the objection they had to answer

  **Four of the nine carry a number, and only on Home.** My Epics, Questions, PRs and
  Chats each say how many rows tapping them would leave you with; All Beads, Ledger and
  Advocates say nothing. This is the deliberate reversal of what this header used to
  say — *"no counts and no badges, on any of them"* — and the objection it was written
  against is real and still stands as written: a badge is only ever live on the one page
  whose poll happens to fetch it, and stale on the other nine. The bar's own count (the
  proposals waiting, hung off Advocates) was exactly that, and deleting it was right.

  What answers the objection is *where* the number is drawn rather than what it counts.
  It is drawn on **Home alone**, where the data is not fetched for the badge at all — the
  list under the row has already been fetched, narrowed by the space picker and counted
  per kind by `surveyKinds` in public/app.js, because the filter panel needed those
  numbers before the row did. So the badge is a second reading of a number this page is
  already holding, refreshed by the same 25-second poll that redraws the list beneath it,
  and there is no page on which it can be stale because there is no other page on which
  it is drawn. Off Home the pills are plain links with nothing on them, exactly as they
  were.

  **"Home" now means the shell, not the pane** (bc-yjekg). Since Ledger, Advocates,
  Releases and Config became panes of the same document (bc-khoe.30), Home's list keeps
  being polled and counted behind them, so the number is as live there as it is on Home —
  the argument above, unchanged, reaches every pane. Hiding it off the Home pane is what
  made every pill change width as you moved between panes, so a thumb aimed at All Beads
  landed on Advocates. Pages outside the shell still draw no count: they hold no list.

  The three without a number are three different reasons, and none is an omission. **All
  Beads** is every live bead in the tracker: an unbounded number, and one that says
  nothing you would act on. **Ledger** and **Advocates** are pages of their own with
  their own polls — a count for either is the stale badge the paragraph above refuses,
  and it would be stale on the one screen it appears on. (All Beads and Ledger are one
  **Beads** pill since bc-yjekg.3 — see `PILLS` — and it carries no count for both
  reasons at once.)

  Zero is drawn as `0` rather than by hiding the badge. A badge that appears when the
  first poll lands would change the pill's width under a thumb already on its way to it.

  ## What is not a pill

  **Admin.** It had the rightmost tab and it loses it here: it is the screen you least
  want to hit by accident. bc-khoe.5 landed while this branch was parked and put it where
  it belongs — a row in the menu the top bar's gear-wrapped mark opens
  (`account-admin` in public/accountbar.js), drawn on every page rather than on the one
  that happened to have a ⚙. So it is reachable from everywhere and is on no row, which is
  what it was always supposed to be; /admin itself draws this row with nothing on it
  current. monitor.html's own ⚙ stays, because accountbar.js hoists it into that menu
  rather than duplicating it.

  **A create.** bc-l8jp.5 took the chat session off the bottom bar because it was the one
  entry that was also the way to *make* something, and a row drawn identically on every
  page cannot hold a create. That has not moved: `Chats` is a pill now, but it is the
  pill for the conversations you already have open, and starting one is still the ＋ on
  Home. A pill goes somewhere; it does not do anything.

  **The endorsement queue, `/flow` and `/requirements`.** All three draw the row — they
  were among the eight pages the bottom bar was the only way off — and none of them is on
  it. The queue's absence is a recorded decision (bc-j0zl, "never a sixth tab") and
  bc-khoe.2 honoured it: a bead held for endorsement is a thing waiting on a word from
  you, so it is a row under `Questions` rather than a pill of its own. The other two are
  pages you read when you are new to the system or arguing about it, not pages you check.
  A page can be reachable, load-bearing, and not a view.

  **The Mirror.** A mode of /monitor rather than a view — it follows *another* device and
  drops its own, so it is meaningless on the phone a pill is tapped from. That was
  re-decided by bc-khoe.30.6, together with the chip row it lives on, and it came out the
  same way twice: the Mirror is the one surface here that is *about* another device, so a
  pill for it on this one would be a view of nothing. It stays a mode, and the chips stay
  the row that switches modes — inside the Advocates pane once bc-khoe.4 folds the console
  into it.

  **The pull request board.** `/prs` had a pill of its own until bc-khoe.2 needed the
  word for the kind, and the three paths that serve it are on the Advocates pill now —
  they resolve to monitor.html with its board chip up, so the pill that lights there is
  the pill that points at that page. The board is two taps rather than one, and it stays
  two: bc-khoe.30.6 re-decided this with the rest of the chip row and left it a mode of
  the console. A second pill labelled **PRs** beside the kind pill already called **PRs**
  is the confusion this paragraph exists to record, and the row is going to nine without
  it.

  It is built here rather than pasted into eight <head>-alike blocks of HTML because
  there is no templating in this app, and a row that says different things on different
  pages is worse than no row. One list, one place to add a pill.

  ## What is behind ⋯ (bc-yjekg.1)

  By October the row was thirteen pills and four kinds of thing: Home's narrowings, the
  panes, the tools a repo declared about itself (Studio, Briefs, …) and the operations
  (Advocates, Releases, Config). A sideways scroll that long is a row you read by
  flicking, and the pills you check daily were the ones you flicked past. So the row keeps
  the narrowings and the Beads pane, and every pill flagged `more` — the three operations
  and every repo view `add` appends — is a row of a menu the trailing **⋯** opens instead:
  seven pills, which a 390px phone very nearly shows without a flick.

  The menu rows are drawn by the same `draw()` as the pills and carry the same `data-`
  attributes, so a tap in the menu is decided by the same code as one on the row. When
  the view on screen is one of them the ⋯ itself is lit, so the row never says you are
  nowhere, and the menu row for it is the `<span aria-current>` the pill would have been.

  ## Why the class is `.viewbar` and not `.pillrow`

  Because `.pill` was taken, twice over. It is this app's uppercase metadata badge — the
  P0, the type, the bead id on a card — with about twenty modifiers hanging off it, and
  `.pill-row` is already the flex-wrapping row those badges sit in. A row of navigation
  called `.pillrow` full of `.pill`s would have restyled every badge in the app and left
  two classes a hyphen apart meaning unrelated things. `.viewbar` / `.viewpill` collides
  with nothing, and the epic's own word for these — *view* pills — is the half that was
  free.
*/
(() => {
  /*
    The row, as of bc-khoe.2: the six kinds Home carries, plus the advocate console.

    Five of the six are **Home under a different narrowing** — they are the kinds table
    in public/inboxfilter.js, promoted out of a collapsed filter panel and onto the one
    row of chrome this app has. `Ledger` is the sixth and has an address of its own, which
    is why it is the only kind here carrying an `href` at all: the other five get theirs
    from `hrefOf`, and only off Home. It was a page and nothing but a page when that was
    written; since bc-khoe.30.5 it is *also* a pane of the shell, and the `href` is what
    the nine documents that have no panes still follow.

    `kind` is the id of the row in that table, and the two lists are held to the same six
    ids, labels and icons by test/inboxkinds.mjs — this file is loaded on ten pages
    and inboxfilter.js on one, so the row cannot read the table at paint time and a copy
    is the only shape available. A checked copy is not a second place that knows; an
    unchecked one is. What is deliberately *not* copied is the URL: the table knows what
    a kind is and this file knows where its pill goes, so there is no href written down
    twice for the check to have to catch.

    `count` is the fourth field and the only one that is about a *number* rather than
    about where a pill goes: it marks the four that carry one on Home. It is a flag here
    and not a count, because this file never counts anything — `counts()` at the foot is
    pushed the map by inboxfilter.js's `paint`, the same way `mark()` is pushed the lit
    pill and for the same reason. A pill with no flag is not sent a number and has no
    badge node at all, which is what makes "All Beads, Ledger and Advocates carry none"
    a property of this list rather than of whatever happens to be in the map.

    What is **not** here any more, since bc-khoe.30.2, is `paths` — every URL that *is* a
    given view. The server maps several onto one page (/monitor answers to nine of them
    now) and the phone's home screen still holds the old ones, so a pill has to recognise
    all of them or the row shows nothing as current on a page you are plainly looking at.
    That is the same question as "what does this hash mean", asked of the other half of
    the URL, and public/hashroute.js is where it is answered now — `viewOfPath` below.
    Four of these pills are views and it holds their addresses; the four that are only
    ever Home have none, because there the filter decides which is lit rather than the
    path. Config is the ninth and is neither: it is a page with a pill and no view, so
    nothing is current while you are on it — see its own comment below. See `serveStatic`
    in lib/server.js, and test/pagepaths.mjs, which reads that table from hashroute.js.
  */
  const PILLS = [
    // Home with nothing narrowed. First because it is where you land, and because every
    // pill to its right is a narrowing of it rather than a different place.
    { id: 'home', kind: 'home', icon: '🏠', label: 'Home', count: true },
    // The P0 board and the work under it (bc-rfnr.9). Second rather than first since
    // bc-fwp2c: it was the landing pill for as long as the board was drawn on the screen
    // you land on, and the badge is what separated them — a place can only ever count the
    // sum of every kind, which is not a number the word "Epics" can carry.
    { id: 'epics', kind: 'epics', icon: '🎯', label: 'My Efforts', count: true },
    // Questions, PRs, Chats: what is arriving, in the order it tends to need answering.
    { id: 'question', kind: 'question', icon: '❓', label: 'Questions', count: true },
    { id: 'pr', kind: 'pr', icon: '🚢', label: 'PRs', count: true },
    { id: 'session', kind: 'session', icon: '💬', label: 'Chats', count: true },
    // Every bead, one pill (bc-yjekg.3). It was two — `Ledger`, the record of every bead
    // the space has had (the `history` pane), and `All Beads`, Home narrowed to the live
    // ones (the `bead` kind) — and the two answered one question from two ends. They are
    // one pill with an **Open / Closed / All** toggle under it now: Open is what All Beads
    // was, Home narrowed to `bead`, widening the scope to reach it exactly as before
    // (bc-khoe.25); Closed is the ledger narrowed to `status=closed`; All is the ledger
    // unnarrowed. Nothing addressable moved: `#history`, `/history`, `?kind=bead` and a
    // stored `bead` selection all still land here, with the toggle on the side they name.
    //
    // `views` and `kinds` are what make that true: the view ids and the narrowings this
    // one pill is lit for, read by `pillOf`. Which side a tap lands on is the toggle you
    // last chose, remembered on this device — see `beadsMode`.
    { id: 'beads', icon: '🧿', label: 'Beads', views: ['history'], kinds: ['bead'] },
    // Not a kind, and the one pill on this row that is neither Home nor a record. It
    // also carries the pull request board's three paths, which used to be a `PRs` pill
    // of their own: /prs, /pulls and /prs.html all serve monitor.html with its board
    // chip up (see `serveStatic`), so the pill that is current there is the pill that
    // points at that page — and the `PRs` label now belongs to the kind above, which is
    // the pull requests *in Home*. bc-khoe.30.6 re-decided it and the answer did not
    // move: the board stays a chip inside the console, so two taps reach it and this pill
    // keeps its three extra paths. bc-khoe.4 folds that console into the shell's
    // Advocates pane, at which point this pill stops being an `<a>` and starts being a
    // `data-pane` like the rest — the same pill, one fewer document load.
    { id: 'advocates', href: '/monitor', icon: '📣', label: 'Advocates', more: true },
    // Where everything in flight actually is (bc-khoe.7). Immediately after the pill that
    // carries the board, because the two are read one after the other: the board
    // is where you decide something may land, and this is where you watch it do so. It is a
    // view rather than a fifth pane of /monitor for the reason the deploy strip left the
    // board at all — a deploy in flight is not a fact about a pull request, it is the rung
    // after it, and a screen about pull requests was the wrong place to be told. Its three
    // addresses — /releases, /deploys, /releases.html — are in public/hashroute.js with
    // every other view's, since bc-khoe.30.2; this row asks rather than knows.
    { id: 'releases', href: '/releases', icon: '🚀', label: 'Releases', more: true },
    // Last, and last on purpose: it is the one pill here you reach about once a month.
    // Past Releases, which asked only to sit beside the board it follows and is happy
    // anywhere right of it; this one asked for the end of the row specifically.
    // The selected space's own settings (bc-khoe.10) — muted, quiet hours, who may
    // endorse, what merges itself — which were a card at the top of the console and then
    // a chip on it. A row you scroll sideways spends its rightmost place on what you
    // want least often, and this is it.
    // Knobs rather than a gear: the gear in this app is Admin — the machine's own screen,
    // in the mark's menu — and two settings screens behind one glyph is the confusion the
    // menu was built to end.
    // Its three addresses are in public/hashroute.js's `VIEWS` with every other view's,
    // and that row is newer than this pill: bc-khoe.10 shipped the pill while the paths
    // still lived in this file, bc-khoe.30.2 moved the table out, and Config was not in
    // it — so for four days the row marked **nothing** current on the one screen this
    // pill reaches, and the pill was a live `<a href="/config">` on /config itself.
    // bc-khoe.50 put it in the table. Nothing here changed to make that work, which is
    // the point of asking rather than knowing.
    //
    // Its pane in index.html was `data-pending` until bc-khoe.60 filled it — the same
    // two-step History, Advocates and Releases each went through, and nothing here
    // changed to make that work either: `panes?.has` answers yes on the shell now, and
    // this pill draws as the row's control rather than this `<a>` the moment it does.
    { id: 'config', href: '/config', icon: '🎛', label: 'Config', more: true },
  ];

  /**
   * The grammar — still a hard failure when it is missing, but one that says which file
   * is missing (bc-l8ub).
   *
   * Failing rather than degrading is the decision, and it is the one argued two
   * paragraphs below: every page needs `route`, so a page without it cannot say where it
   * is, and a row that quietly marks nothing current is worse than no row. What bc-l8ub
   * cost was that the loudness said nothing useful.
   *
   * Both shapes of the absence are one message here, because which of the two you get is
   * an accident of the page. `window.beadcause` is created by whichever of
   * public/hashroute.js, public/presence.js and public/stream.js runs first — so on
   * /console, /monitor, /endorse, /config, /admin and the shell, where one of
   * the other two is above this file, a `/hashroute.js` that did not arrive leaves the
   * namespace behind and only `route` missing: `Cannot read properties of undefined
   * (reading 'viewOfPath')`, thrown on a line of this file that does not mention
   * hashroute.js at all. On /flow, /skills, /sounds and /requirements, which load
   * neither, the same cause reads `(reading 'route')` instead. One bug, two
   * fingerprints, neither naming the file.
   *
   * It arrives over the network, so "did not arrive" is an ordinary event rather than a
   * programming mistake — a deploy swapping the backend under a page that is still
   * fetching its scripts is exactly what bc-l8ub was, and public/sw.js answers that one
   * out of the cache now. This message is for the next cause, whatever that turns out
   * to be.
   */
  const route = window.beadcause?.route;
  if (!route) throw new Error('viewbar.js: window.beadcause.route is missing — /hashroute.js did not load');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  /**
   * Which view this document is, or null for one of the five pages that is on no pill.
   *
   * Asked of public/hashroute.js rather than matched against a table here, because the
   * table it would be matched against is the same one that says what `#advocates` means
   * — nine addresses and one hash, all naming the advocate console — and two copies of
   * that is how a phone's `/work.html` shortcut ends up on a row with nothing current.
   */
  const view = route.viewOfPath(location.pathname);

  /**
   * The panes of this document, on the one page that has any (bc-khoe.30.3).
   *
   * A default here where `route` above throws, and the difference is which absence is a
   * bug. Both are read with `?.` — that part is only about not crashing on the *shape* of
   * the namespace — and then they part company: every page needs the grammar, so a
   * missing `route` is a page that cannot say where it is and should fail loudly, which
   * is why there is a `throw` under it (bc-l8ub). Panes are a fact about the shell alone
   * — this row is drawn on ten pages and nine of them have nothing to show and hide —
   * so a missing `panes` is the ordinary case, and every question below is asked with
   * that answer as its default. See public/panes.js.
   */
  const panes = window.beadcause?.panes || null;

  /**
   * Which view this row is over *right now*.
   *
   * On the shell that changes without the document changing, which is the whole of
   * bc-khoe.30: the pane is swapped, `onShow` fires, and the row redraws against the new
   * answer. Everywhere else it is the address, decided once at load and never again.
   */
  const here = () => panes?.showing() || view;

  /** Is the row over Home this second? Five of the nine pills act rather than link. */
  const onHome = () => here() === route.HOME;

  /** Can this row reach Home without asking for a document? True on every pane of the
   *  shell, and on Home itself wherever it is the whole page. */
  const homeIsHere = () => onHome() || !!panes?.has(route.HOME);

  /** A kind pill's URL from anywhere else. `?kind=` is read once, at load, by
   *  inboxfilter.js — the service worker matches with `ignoreSearch`, so a query on the
   *  shell's own path still resolves to the precached document offline. */
  const hrefOf = (p) => p.href || `/?kind=${encodeURIComponent(p.kind)}`;

  const nav = document.createElement('nav');
  nav.className = 'viewbar';
  nav.setAttribute('aria-label', 'Views');

  /**
   * The menu the trailing ⋯ opens (bc-yjekg.1): every pill flagged `more`, and every repo
   * view. Its own element beside the row rather than inside it, because the row scrolls
   * sideways and so clips on both axes — a menu hung inside it would be cut to the row's
   * 52px. Drawn in the account menu's rows (public/accountbar.js) because it is the same
   * kind of thing: a short list of places, opened from one chip, shut by a tap anywhere
   * else.
   */
  const menu = document.createElement('div');
  menu.className = 'accountmenu viewmenu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'More views');
  menu.hidden = true;

  /**
   * Which of Home's pills the filter last chose.
   *
   * Recorded whether or not Home is on screen — see `mark()` — because on the shell the
   * inbox goes on repainting behind a pane you have switched to, and the narrowing you
   * left it on is the one that should be lit when you come back. `home` until something
   * says otherwise, which is what an unnarrowed Home is.
   *
   * **Not `route.HOME`, which it was until bc-fwp2c.** That constant is the *page* — the
   * view id `/` resolves to, still `epics` because the epic board is what that document
   * has always been called, and still what a kind pill tapped from another pane switches
   * to (see `pane` in `draw`). Which of Home's pills is lit is a different fact, and the
   * two were the same string only for as long as the pill you land on and the pill the
   * board draws on were one pill. Seeding this from the page id lit `My Epics` on an
   * unnarrowed Home, over a list Home was drawing and My Epics no longer does.
   */
  let narrowed = 'home';

  /**
   * Which pill is lit. Two answers, and which one applies is a fact about the hash.
   *
   * Away from Home it is the view showing — the pane on the shell, the address on the
   * nine pages that are still documents, both of them read through `here()`. On Home
   * five pills share one address *and* one empty hash, so neither can tell them apart and
   * the filter is the answer instead.
   */
  const lit = () => pillOf(onHome() ? narrowed : here() || '');

  /**
   * The pill that draws a view or a narrowing: its own, or the one that took it in.
   *
   * Since bc-yjekg.3 two ids that used to be pills of their own — the `history` view and
   * the `bead` narrowing — are both the Beads pill, so an address, a hash or a stored
   * selection naming either still lights *something*. An id no pill claims comes back as
   * itself, which is what it always was.
   */
  function pillOf(id) {
    const p = PILLS.find((q) => q.id === id || q.views?.includes(id) || q.kinds?.includes(id));
    return p ? p.id : id || '';
  }

  /* ---------------------------------------------------- the Beads pane's toggle */

  /** The three sides of the Beads pill and their words, in the order the toggle draws
   *  them. A map rather than a list of `{ id }`s, because the tests that read `PILLS` out
   *  of this file match `id: '…'` at the start of a line, and these are not pills. */
  const SIDES = { open: 'Open', closed: 'Closed', all: 'All' };
  const isSide = (v) => Object.prototype.hasOwnProperty.call(SIDES, v);
  const SIDE_KEY = 'beadcause.beadsSide';

  /**
   * Which side the Beads pill lands on when tapped from somewhere else: the one you last
   * chose on the toggle, on this device. A convenience and nothing more — a private
   * window, a cleared site or a storage that throws is `open`, which is what All Beads
   * always was.
   */
  let beadsSide = (() => {
    try {
      const v = localStorage.getItem(SIDE_KEY);
      return isSide(v) ? v : 'open';
    } catch {
      return 'open';
    }
  })();
  const rememberSide = (side) => {
    beadsSide = side;
    try {
      localStorage.setItem(SIDE_KEY, side);
    } catch {
      /* Remembered for this page only — see above. */
    }
  };

  /** The ledger's status filter as the address holds it, for before history.js has built. */
  function statusInHash() {
    const q = route.queryFor?.('history', location.hash) || '';
    const m = /(?:^|&)status=([^&]*)/.exec(q);
    if (!m) return [];
    let raw = m[1];
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* Taken as written. */
    }
    return raw.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  }

  /**
   * Which side is on screen, read off what is actually there rather than off storage: Home
   * is Open, and the ledger is Closed when its status filter is exactly `closed` and All
   * otherwise. So a `#history?status=closed` from an old link arrives with Closed pressed,
   * and a bare `#history` with All — which is what the Ledger pill always showed.
   */
  function shownSide() {
    if (here() !== 'history') return 'open';
    const st = window.beadcause?.ledger?.status?.() ?? statusInHash();
    return st.length === 1 && st[0] === 'closed' ? 'closed' : 'all';
  }

  /**
   * Go to one side of the Beads pane, and remember it.
   *
   * Open is a kind tap — Home first, then the narrowing, through the same `pick` every
   * kind pill uses, which is what keeps bc-khoe.25's widen-without-storing intact. The
   * other two are the ledger with its status set: through public/history.js once it is
   * built, so the three filters you left it on stay put, and through the hash before it
   * is, because `readUrl` there is what reads the hash as the pane is built.
   */
  function beadsGo(side) {
    if (!isSide(side)) return;
    rememberSide(side);
    if (side === 'open') {
      if (!onHome()) panes?.go(route.HOME);
      window.beadcause?.inboxFilter?.pick?.('bead');
      paintToggle();
      return;
    }
    const status = side === 'closed' ? ['closed'] : [];
    const ledger = window.beadcause?.ledger;
    if (ledger) {
      const now = ledger.status();
      if (now.length !== status.length || now.some((v, i) => v !== status[i])) ledger.setStatus(status);
      if (here() !== 'history') panes?.go('history');
    } else {
      panes?.go('history', status.length ? 'status=closed' : '');
    }
    paintToggle();
  }

  /** The toggle's hosts: one at the top of Home, one at the top of the ledger. */
  const toggleHosts = () => [...(document.querySelectorAll?.('[data-beads-toggle]') || [])];

  /**
   * Draw the toggle into whichever of its hosts is on screen. Hidden whenever the Beads
   * pill is not the lit one — on Home under any other narrowing it would be a control
   * for a list you are not looking at.
   */
  function paintToggle() {
    const show = lit() === 'beads';
    const side = show ? shownSide() : '';
    for (const host of toggleHosts()) {
      host.hidden = !show;
      if (!show) continue;
      host.innerHTML = Object.entries(SIDES)
        .map(
          ([id, label]) =>
            `<button type="button" class="beadstoggle-opt" data-beads="${id}" aria-pressed="${id === side}">${esc(label)}</button>`
        )
        .join('');
    }
  }
  for (const host of toggleHosts()) {
    host.addEventListener('click', (e) => {
      const btn = e.target.closest?.('button[data-beads]');
      if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
      e.preventDefault();
      beadsGo(btn.dataset.beads);
    });
  }
  /* A status chip tapped in the ledger's own filter bar moves the toggle too. */
  if (typeof addEventListener === 'function') addEventListener('beadcause:ledger', () => paintToggle());

  /**
   * Where a pill's tap goes: the view it shows, the kind it narrows Home to, and the
   * address it is off the shell. For every pill but one that is just the pill; for Beads
   * it is whichever side you last chose.
   */
  function aim(p) {
    if (!p.kinds) return { view: p.id, kind: p.href ? null : p.kind || null, href: hrefOf(p) };
    if (beadsSide === 'open') return { view: null, kind: 'bead', href: '/?kind=bead' };
    return { view: 'history', kind: null, href: beadsSide === 'closed' ? '/#history?status=closed' : '/#history', side: beadsSide };
  }

  /**
   * What each counted pill's badge says right now, as text, keyed by pill id.
   *
   * One store rather than two, and it is deliberately the *rendered string* rather than
   * the number: `draw()` reads it when it rebuilds the row and `counts()` writes it when
   * a poll lands, so the badge a rebuild puts back is the badge that was there. Holding
   * numbers instead would mean formatting in two places, and the two drifting is a badge
   * that changes what it says every time the lit pill moves.
   *
   * `'0'` from the first paint, before any poll has answered — see the header. A badge
   * that arrives later is a pill that changes width under a thumb already moving to it.
   */
  const shown = Object.fromEntries(PILLS.filter((p) => p.count).map((p) => [p.id, '0']));

  /**
   * Draw the row.
   *
   * Three shapes of pill, and the difference between them is what a tap should do — the
   * argument for each is in the doc comment above. Two `data-` attributes carry the two
   * things a tap can ask for and a pill may carry **both**: `data-pane` is the view to
   * show and `data-kind` is the narrowing to move to within Home. `My Epics` tapped from
   * the Ledger pane is exactly that pair, and so is every other kind pill tapped from a
   * pane that is not Home — switch, then narrow, in one tap and no document load.
   *
   * `showable` is `false` for the pane already up, so the pill for the pane you are on —
   * when it is not also the lit one, which happens on Home whenever a kind is selected —
   * does not rewrite a hash that is already right.
   */
  function draw() {
    const cur = lit();
    const home = onHome();
    // The badges, wherever Home is a pane and not only on it (bc-yjekg): the inbox keeps
    // repainting behind the other panes, so its counts are still true there — and a row
    // whose badges came and went with the pane changed every pill's width, so a tap
    // landed on the wrong one. Separate from `home`, which is where a kind tap has to go.
    const counted = homeIsHere();
    /* One pill's markup, in the row or as a row of the ⋯ menu. The same three shapes and
       the same `data-` attributes either way, so a tap in the menu is decided by exactly
       the code that decides one on the row; only the class and the menu role differ. */
    const one = (p, inMenu) => {
      const on = p.id === cur;
      const a = aim(p);
      const showable = !on && !!a.view && !!panes?.has(a.view) && a.view !== here();
      const narrows = !on && !!a.kind && homeIsHere();
      const act = showable || narrows;
      /* Where the tap has to land first. The pane for a view pill; Home for a kind pill
         tapped from anywhere else, because a narrowing of a list means nothing until the
         list is the one on screen. Empty when the pane is already right. */
      const pane = showable ? a.view : narrows && !home ? route.HOME : '';
      const tag = on ? 'span' : act ? 'button' : 'a';
      /* `data-beads` on the Beads pill when it is going to the ledger: the status has to
         be set as well as the pane switched, which is `beadsGo` and not a bare `go`. */
      const attrs = on
        ? 'aria-current="page"'
        : act
          ? `type="button"${pane ? ` data-pane="${esc(pane)}"` : ''}${narrows ? ` data-kind="${esc(a.kind)}"` : ''}` +
            (showable && a.side ? ` data-beads="${esc(a.side)}"` : '')
          : `href="${esc(a.href)}"`;
      /* The badge, on the four that carry one, on every pane of the shell. Not `aria-hidden`: it is
         the one part of a pill that is information rather than decoration, and a reader
         that cannot see it hears "Questions 4", which is what the pill says. */
      const badge =
        counted && p.count
          ? `<span class="viewpill-count" data-count="${esc(p.id)}">${esc(shown[p.id])}</span>`
          : '';
      /* `data-pill` and not `data-view`: the chips on /monitor already carry a `data-view`
         and it means something else there — what public/presence.js should say this device
         is looking at — so one name for two things across two rows of chrome is exactly
         what this change exists to stop. `data-pane` above is the shell's own word for a
         container in public/index.html, which is the thing this attribute names. */
      if (inMenu) {
        return `<${tag} class="viewmenu-row accountmenu-row" role="menuitem" data-pill="${esc(p.id)}" ${attrs}>` +
          `<span class="accountmenu-glyph" aria-hidden="true">${p.icon}</span>` +
          `<span class="accountmenu-label">${esc(p.label)}</span>` +
          badge +
          `</${tag}>`;
      }
      return `<${tag} class="viewpill" data-pill="${esc(p.id)}" ${attrs}>` +
        `<span class="viewpill-icon" aria-hidden="true">${p.icon}</span>` +
        `<span class="viewpill-label">${esc(p.label)}</span>` +
        badge +
        `</${tag}>`;
    };
    const row = PILLS.filter((p) => !p.more);
    const tucked = PILLS.filter((p) => p.more);
    /* The ⋯ pill, last. Lit — the accent fill and `aria-current` — when the view on
       screen is one of the pills behind it, so the row still says where you are when
       where you are is not on it. Always a button, because it always opens the menu:
       even lit, the menu is how you get to the other views behind it. */
    const deep = tucked.some((p) => p.id === cur);
    const more = tucked.length
      ? `<button type="button" class="viewpill viewpill-more" data-more="1" aria-haspopup="menu"` +
        ` aria-expanded="${!menu.hidden}" aria-label="More views"${deep ? ' aria-current="page"' : ''}>` +
        `<span class="viewpill-icon" aria-hidden="true">⋯</span></button>`
      : '';
    nav.innerHTML = row.map((p) => one(p, false)).join('') + more;
    /* Two groups: what this app does (the advocates, the releases, the space's settings)
       and the views a repo declared about itself, which `add` flags as `repo`. */
    const ops = tucked.filter((p) => !p.repo);
    const tools = tucked.filter((p) => p.repo);
    menu.innerHTML =
      (ops.length ? `<div class="viewmenu-head">Operations</div>${ops.map((p) => one(p, true)).join('')}` : '') +
      (tools.length ? `<div class="viewmenu-head">Repo tools</div>${tools.map((p) => one(p, true)).join('')}` : '');
    paintToggle();
  }

  /* ------------------------------------------------------------ the ⋯ menu */

  /** Is the page held still by edit mode? The account menu's own rule — see accountbar.js. */
  const frozen = () => Boolean(window.beadcause?.editMode?.frozen?.());

  function setMenu(open) {
    menu.hidden = !open;
    const btn = nav.querySelector?.('.viewpill-more');
    btn?.setAttribute?.('aria-expanded', String(open));
    if (!open) return;
    /* Under the row and against the right-hand edge, where the ⋯ is once the row is
       scrolled to it. Measured on each open rather than once: the top bar thins out in
       landscape, and the row can be anywhere by then. */
    const r = nav.getBoundingClientRect?.();
    if (r) menu.style.top = `${Math.round(r.bottom + 6)}px`;
  }

  draw();

  /* One listener on the row rather than one per pill, because `draw()` replaces every
     node in it each time the lit pill moves and per-node handlers would have to be
     rebound on each. A button with no filter file behind it does nothing rather than
     throwing — the same fallback every other caller of this API takes. */
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest?.('button.viewpill');
    if (!btn) return;
    e.preventDefault();
    if (btn.dataset.more) {
      e.stopPropagation?.();
      if (!frozen()) setMenu(menu.hidden);
      return;
    }
    act(btn);
  });

  /** What a tapped pill asks for, on the row or in the menu. */
  function act(btn) {
    /* The pane first and the narrowing second, and the order is the point: a kind pill
       tapped from another pane carries both, and picking the kind before Home is the pane
       on screen would narrow a list nobody is looking at and then paint over it. */
    if (btn.dataset.beads) return beadsGo(btn.dataset.beads);
    if (btn.dataset.pane) panes?.go(btn.dataset.pane);
    if (btn.dataset.kind) window.beadcause?.inboxFilter?.pick?.(btn.dataset.kind);
  }

  /* A row of the menu shuts it as well as going there. A link row shuts it too, so the
     menu is not still open on the page you come back to. */
  menu.addEventListener('click', (e) => {
    const item = e.target.closest?.('.viewmenu-row');
    if (!item) return;
    setMenu(false);
    if (item.tagName !== 'BUTTON') return;
    e.preventDefault();
    act(item);
  });
  /* A tap anywhere else shuts it, on the document rather than a backdrop — the account
     menu's trade, for the same reason: a backdrop would eat the first tap of whatever you
     were actually reaching for. */
  document.addEventListener?.('click', (e) => {
    if (menu.hidden || frozen()) return;
    if (menu.contains?.(e.target) || e.target?.closest?.('.viewpill-more')) return;
    setMenu(false);
  });
  document.addEventListener?.('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) setMenu(false);
  });

  /* Second row of the shell, under the top bar — not appended to the end of <body> the
     way the bottom bar was. Every page that draws this row draws a `.topbar`; the
     fallback is for one that somehow does not, where the top of the page is still the
     right place and a row lost off the bottom would be a page with no way out. */
  const bar = document.querySelector('.topbar');
  if (bar) bar.after(nav);
  else document.body.prepend(nav);
  nav.after(menu);

  /**
   * Put the current pill on screen.
   *
   * The row is wider than a phone as soon as there are more than about five pills, and
   * `scrollLeft` starts at 0 — so the pill that says where you are is the one most
   * likely to be off the right-hand edge, on the one screen where it matters most. Done
   * by arithmetic on the two rectangles rather than with `scrollIntoView`, which is
   * allowed to scroll every ancestor as well: the shell's scroller is one of those, and
   * a navigation that quietly scrolled the list under it would be a bug nobody could
   * name.
   *
   * Twice, because the first call runs before the webfont has settled and the second
   * catches the reflow. Both are cheap and neither animates: this is where the row
   * *starts*, not a movement anybody should see.
   */
  const reveal = () => {
    const cur = nav.querySelector('[aria-current="page"]');
    if (!cur) return;
    const c = cur.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    if (!n.width) return;
    nav.scrollLeft += c.left - n.left - (n.width - c.width) / 2;
  };
  reveal();
  addEventListener('load', reveal, { once: true });

  /* The pane moved under the row, so the row is over a different view than it was — a
     different pill is lit and a different set of them are links. Registered rather than
     polled, and a no-op on the nine pages that have no panes to move. */
  panes?.onShow(() => {
    setMenu(false);
    draw();
    reveal();
  });

  /**
   * Append a pill for a view a **repo** declared about itself.
   *
   * The nine above are what this app is, and they are argued for one at a time in the
   * block comments beside them — position included, because position is the argument. A
   * repo view has no such argument available to it here: this file cannot know whether
   * loremia's studio board is read more often than the ledger. So every one of them goes
   * to the **end of the list** — since bc-yjekg.1 the ⋯ menu, under "Repo tools" after Config — in the order `/api/views` answered — which is
   * the order of the configured workspaces, so it is stable across restarts.
   *
   * That is not a placeholder for a better rule. The row scrolls sideways and the current
   * pill is scrolled into view on load, so "at the end" costs a repo view nothing it would
   * gain from being third; and the alternative — a `position` field in the manifest — is a
   * repo asserting a claim about a row it shares with every other repo, which is the one
   * thing a plug-in must not get to do.
   *
   * Redraws, because the row is already on screen by the time `/api/views` answers. It is
   * the same `draw()` the pane switch calls, so the lit pill and the three shapes are
   * decided exactly as they always are and nothing here is a second opinion about them.
   */
  function add(pill) {
    const id = String(pill?.id || '');
    if (!id || PILLS.some((p) => p.id === id || p.views?.includes(id) || p.kinds?.includes(id))) return false;
    PILLS.push({
      id,
      icon: String(pill?.icon || '🧩'),
      label: String(pill?.label || id),
      // The address for the nine pages that have no panes, and for a home-screen
      // shortcut. `hrefOf` reads it; on the shell `panes.has(id)` is true and the pill is
      // a button before the href is ever consulted.
      // Defaulted to the view's own hash on Home rather than left empty, because `hrefOf`
      // falls back to `/?kind=<id>` for a pill with no href — right for the five that *are*
      // narrowings of Home, and a link to nothing for one that is not. A caller that gives
      // no address gets the one address that is always true.
      href: String(pill?.href || `/${route.hashFor(id) || ''}`),
      repo: true,
      more: true,
    });
    draw();
    reveal();
    return true;
  }

  window.beadcause = window.beadcause || {};
  window.beadcause.views = {
    /** The row's own list, for anything that has to agree with it. */
    pills: PILLS,
    /** Append a pill for a repo's own view, at the end of the row. See `add` above. */
    add,
    /** Which pill is lit right now. */
    lit,
    /**
     * Light a different pill, from the filter that actually knows.
     *
     * A no-op for an id the row does not draw: the row is on ten pages and only one of
     * them has a filter behind it, so this has to be safe to call into thin air. Redraws
     * only when the answer moved — the inbox repaints every 25 seconds and `paint` rides
     * along with it, and rebuilding seven nodes on a timer would drop the focus ring off
     * a pill somebody is tabbing through.
     *
     * The narrowing is **recorded from anywhere and only painted over Home**. It used to
     * be refused outright off Home, which was the same thing while Home was a whole
     * document; on the shell the inbox repaints behind a pane you have switched away
     * from, and a refusal there would leave the row lighting the pill you chose two
     * switches ago the moment you came back.
     */
    mark(id) {
      if (narrowed === id || !PILLS.some((p) => p.id === id || p.kinds?.includes(id))) return;
      narrowed = id;
      if (!onHome()) return;
      draw();
      reveal();
    },
    /**
     * The four numbers, from the page that already has them.
     *
     * `map` is kind id → how many rows that kind would leave you with, which is exactly
     * what `surveyKinds` in public/app.js hands the filter — counted before the kind
     * filter and after the space picker, so it is what *picking* the pill gets you and
     * not what you are already looking at. Only the ids flagged `count` in `PILLS` are
     * read out of it; the rest of the map is somebody else's business, and a kind the
     * row draws no badge for cannot grow one by appearing in it.
     *
     * A no-op off Home, like `mark()`, and for the same reason: this file is on ten
     * pages and the one that counts is on Home alone.
     *
     * **In place, never through `draw()`.** The inbox repaints every 25 seconds and this
     * rides along with it — rebuilding seven nodes on that timer would drop the focus
     * ring off a pill somebody is tabbing through, which is the whole reason `mark()`
     * redraws only when the answer moved. A number is text, and text can be replaced
     * without replacing the element holding it. The row is not re-`reveal()`ed either:
     * a digit's worth of width is not a navigation, and scrolling the row under a thumb
     * because a poll landed would be a worse bug than the pixels it corrects.
     */
    counts(map) {
      if (!homeIsHere() || !map || typeof map !== 'object') return;
      for (const p of PILLS) {
        if (!p.count) continue;
        const n = Number(map[p.id]);
        const next = String(Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
        if (shown[p.id] === next) continue;
        shown[p.id] = next;
        const el = nav.querySelector(`.viewpill-count[data-count="${p.id}"]`) || menu.querySelector?.(`.viewpill-count[data-count="${p.id}"]`);
        if (el) el.textContent = next;
      }
    },
  };
})();
