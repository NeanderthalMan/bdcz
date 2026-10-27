/*
  The panes' own scripts, fetched after the first paint rather than parsed at boot
  (bc-iaju1.6).

  ## What this is for

  `public/index.html` is one document with a pane per view (public/panes.js) and a staged
  boot that fills them (public/panestage.js). It was also 34 synchronous `<script src>`
  tags, 1.78 MB of them, every one of which had to be fetched, parsed and executed before
  the browser could draw anything at all — and **seven of them belong to panes the app
  does not land on**. The ledger, Releases, Config and the Advocates console's four are
  426 kB of that, a fifth of the page's JavaScript, parsed on every open of an app that
  opens on the inbox.

  That is the second of white a phone sits through when a notification is tapped. So those
  seven are injected instead: not on the tap that shows their pane, but as soon as the
  first frame is out.

  ## "After the first paint", not "on first show" — and the difference matters

  The obvious shape is lazy-on-show, and public/panestage.js's own header has already
  argued against it in the same words this file would need: *"A pane built on the tap that
  shows it is a document load wearing a different mechanism — the second of white this
  epic exists to remove."* A pill that spins when it is pressed is exactly what one
  document was supposed to end.

  So this keeps that promise and moves only the *cost*: the landed-on view's script goes
  out immediately, the rest go out after the first paint, and by the time a thumb has
  moved they are there. `onShow` is the safety net for the tap that beats them — the same
  net, hung in the same place, as the one panestage.js hangs for a build that beats a
  show.

  ## Why the injected scripts cannot run too early

  Every one of the seven reaches for something an eager script defines: `releases.js`
  takes four members off `prcard.js` at module scope, `monitor.js` registers a repaint on
  `spacebar.js` and draws its folds with the vendored markdown pair, `montabs.js` has to
  run before the three sections that register on it.

  Two things keep that true, and both are load-bearing:

  - **This file's own tag is the last one in the document.** Everything eager has
    therefore executed by the time a line here runs, so an injected script can execute the
    instant it arrives without finding a half-built page.
  - **`async = false` on each injected element.** A dynamically-inserted script is async
    by default, which would let `monitor.js` — 163 kB — finish after `montabs.js` and run
    before it, leaving three chips with nothing registered on them. Setting it false puts
    them in the browser's in-order list instead, so they execute in the order they were
    injected however they arrive off the wire. That is the whole of the ordering
    guarantee, and it is one line.

  ## What it does not do

  **No `import()`.** Every file here is an IIFE that hangs itself off `window.beadcause`,
  loaded by a `<script src>`; a module has its own scope and its own `this`, and half of
  these would silently stop registering. Injecting the same tag the document used to carry
  is the change that keeps the seven files themselves untouched.

  **It does not decide when a pane is built.** That is panestage.js's, off the hash, and
  nothing here should grow an opinion about it: a script that loads calls `register`, and
  `register` after the staged boot builds at once. This file's whole job is `src`.
*/
(() => {
  'use strict';

  /**
   * Which view each deferred script belongs to, in the order they must execute.
   *
   * The order *within* a group is the order the tags were in, and for the Advocates four
   * it is not a style point: `montabs.js` is the pane's one registration with the stager
   * and the three sections each register on it as they load.
   *
   * Everything not here stays eager, and the three reasons are worth naming because they
   * are what makes this list the right length:
   *
   * - **The inbox's own** (`app.js`, `inboxfilter.js`, `editmode.js`, `absorb.js`…) is the
   *   pane the app lands on. Deferring it would be deferring the thing being waited for.
   * - **The shared files the deferred seven reach for** — `prcard.js`, `spacebar.js`,
   *   `filtermenu.js`, the vendored markdown pair — because they are the inbox's too, and
   *   a file two panes share is not a pane's file.
   * - **The chrome** (`viewbar.js`, `accountbar.js`, `freshness.js`, `panes.js`,
   *   `panestage.js`, `hashroute.js`) draws on every frame of every view, including the
   *   first.
   */
  const PANES = [
    ['history', ['/history.js']],
    ['releases', ['/releases.js']],
    ['config', ['/config.js']],
    ['advocates', ['/montabs.js', '/monitor.js', '/mergeboard.js', '/prs.js', '/mirror.js']],
  ];

  /** Scripts already injected. Injection, not execution — a second tag for a file already
   *  on its way would run the same IIFE twice, and several of these register on load. */
  const sent = new Set();

  /** Scripts injected and not yet settled — arrived, 404'd or otherwise finished. */
  const inflight = new Set();

  /** What is waiting to be told a view's scripts have all settled. See `whenSettled`. */
  const waiting = [];

  /**
   * One injected script has finished, one way or another.
   *
   * Success and failure are the same event here on purpose. Everything waiting on this is
   * waiting in order to *stop* waiting — public/panestage.js holds its staged boot for the
   * landed-on pane — and a file that 404s must release that hold exactly as one that
   * arrives does, or a rename turns a missing pane into a page with no panes at all.
   */
  function settled(src) {
    inflight.delete(src);
    for (const entry of waiting.splice(0)) {
      if (entry.files.some((f) => inflight.has(f))) waiting.push(entry);
      else entry.done();
    }
  }

  function inject(src) {
    if (sent.has(src)) return;
    sent.add(src);
    inflight.add(src);
    const el = document.createElement('script');
    el.src = src;
    // See the header. Without this the seven race each other.
    el.async = false;
    // Not error *handling* — a script that 404s is a pane that does not build, which
    // public/report.js and public/sw.js already have their own account of, and a third
    // opinion here would be one too many. It is only the release: see `settled`.
    el.onload = () => settled(src);
    el.onerror = () => settled(src);
    document.body.appendChild(el);
  }

  /** One view's scripts, in order. A view with none is every other view in the app. */
  function filesFor(view) {
    for (const [id, files] of PANES) if (id === view) return files;
    return [];
  }

  function load(view) {
    filesFor(view).forEach(inject);
  }

  /** All of them, in the declared order. */
  function loadAll() {
    for (const [, files] of PANES) files.forEach(inject);
  }

  /** The same "when the screen has something on it" panestage.js uses, and the same
   *  fallback for a context with no frame clock. */
  function afterPaint(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fn, 0));
    else setTimeout(fn, 0);
  }

  /*
    The landed-on view first, and that is the one case where a deferred script is on the
    critical path: a home-screen shortcut to `/#history`, or a notification tap that opens
    the ledger, must not be slower than it was. Asked of public/panes.js rather than of the
    hash directly, so an unrecognised hash falls to Home here exactly as it does there.
  */
  const showing = window.beadcause?.panes?.showing?.();
  if (showing) load(showing);

  // Then the rest, once the first frame is out. One call rather than a task each: these
  // are downloads, not builders — panestage.js is what spaces the *building* out, and it
  // already does.
  afterPaint(loadAll);

  /*
    And the safety net: a pane shown before its script arrived — a very fast thumb, or a
    `hashchange` while the first frame is still out. `inject` is a no-op for anything
    already sent, so an ordinary switch between panes costs a set lookup.

    Deliberately the same hook panestage.js uses rather than a hash listener of its own:
    which pane is up is one question and it already has one answer.
  */
  window.beadcause?.panes?.onShow?.((view) => load(view));

  window.beadcause = window.beadcause || {};
  /** What is deferred and what has gone out. For the suites, and for a console at 3am. */
  window.beadcause.panelazy = {
    /** `[view, [src…]]`, in execution order. */
    panes: () => PANES.map(([view, files]) => [view, [...files]]),
    /** Every deferred path, flat. */
    scripts: () => PANES.flatMap(([, files]) => files),
    /** What has been injected so far, in the order it went. */
    sent: () => [...sent],
    /** Send a view's scripts now. The safety net calls this; so can anything else. */
    load,
    /**
     * Is this view's script on its way but not here yet?
     *
     * public/panestage.js asks before its staged boot, because the landed-on pane must be
     * the first one built and an injected script does not block `DOMContentLoaded`. A
     * view with nothing deferred answers false, which is every view but these four.
     */
    awaiting: (view) => filesFor(view).some((src) => inflight.has(src)),
    /**
     * Call back when this view's scripts have all settled — arrived or failed.
     *
     * Called at once when there is nothing to wait for, so the caller has one path rather
     * than two. There is deliberately **no timeout in here**: the `onerror` above fires
     * for a 404 and a network failure alike, so every injected script settles, and a
     * timeout would only be a second answer to a question that already has one.
     */
    whenSettled(view, done) {
      const files = filesFor(view);
      if (!files.some((src) => inflight.has(src))) return done();
      return waiting.push({ files, done });
    },
  };
})();
