#!/usr/bin/env node
/**
 * The pane scripts that are fetched after the first paint rather than parsed at boot.
 *
 *     npm test
 *     node test/panelazy.mjs
 *
 * bc-iaju1.6. `public/index.html` carried 34 synchronous `<script src>` tags, 1.78 MB of
 * them, and seven belonged to panes the app does not land on — the ledger, Releases,
 * Config and the Advocates console's four, 426 kB together, fetched, parsed and executed
 * before the first card could draw on a phone that had just been woken by a notification.
 * public/panelazy.js injects those seven instead.
 *
 * ## What can go wrong here, and what each group below is for
 *
 * - **A pane that never loads at all.** The failure is a pill that does nothing, on a
 *   screen that is otherwise perfect, and nothing in the app says a word about it. So the
 *   list is checked against the document's own markup: every view with a pane and no tag
 *   must be on it.
 * - **Order.** `montabs.js` is the Advocates pane's one registration with the stager and
 *   the three sections register on it as they load; `releases.js` and `prs.js` take
 *   members off `prcard.js` at module scope. A dynamically-inserted script is `async` by
 *   default, so without `async = false` the 163 kB `monitor.js` can finish last and run
 *   first. That one line is the whole ordering guarantee and it is invisible in every
 *   manual test on a fast link.
 * - **Lateness.** The rule public/panestage.js set down is that a pane built on the tap
 *   that shows it is a document load wearing a different mechanism. So these must go out
 *   *after the first paint*, not *on first show* — and the show hook is only the net for
 *   a thumb that beats them.
 *
 * The real file runs in a `node:vm` against a hand-made document, the way test/panes.mjs
 * and test/panestage.mjs do. Small on purpose: this file decides `src` and nothing else,
 * so the room it is put in holds a body, a frame clock and the two questions it asks
 * public/panes.js.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n')[0]}`);
  }
}

const HTML = read('public/index.html');
const SW = read('public/sw.js');

/** The eager tags, in document order. */
const TAGS = [...HTML.matchAll(/<script src="\/([\w./-]+)"><\/script>/g)].map((m) => m[1]);

/**
 * The file under test, in a room with a body and a frame clock.
 *
 * `showing` and `onShow` are public/panes.js's two questions and are stubbed rather than
 * run, because which pane is up is that file's to decide and this one only asks. The
 * frames are *held* until `paint()` so a case can see the difference between "went out at
 * boot" and "went out after the first paint" — which is the whole of the staging.
 */
function boot({ showing = 'epics' } = {}) {
  const injected = [];
  const shown = [];
  const body = {
    appendChild: (el) => {
      injected.push(el);
      return el;
    },
  };
  const frames = [];
  const timers = [];
  const ctx = {
    document: {
      body,
      createElement: () => ({ src: '', async: true, onload: null, onerror: null }),
    },
    requestAnimationFrame: (fn) => frames.push(fn),
    setTimeout: (fn) => timers.push(fn),
    console,
    Set,
    Map,
    Array,
    Object,
    Boolean,
    String,
  };
  ctx.window = ctx;
  ctx.window.beadcause = {
    panes: {
      showing: () => showing,
      onShow: (fn) => shown.push(fn),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(read('public/panelazy.js'), ctx, { filename: 'panelazy.js' });
  return {
    ctx,
    /** Every script element handed to the document, in the order it was handed over. */
    injected,
    /** Just the paths. */
    sent: () => injected.map((el) => el.src),
    /** The first frame went out, and the task after it ran. */
    paint() {
      for (const fn of frames.splice(0)) fn();
      for (const fn of timers.splice(0)) fn();
    },
    /** A pane was shown. What public/panes.js calls when the hash moves. */
    show(view) {
      for (const fn of shown) fn(view);
    },
    /** An injected script arrived and ran — what the browser fires on the element. */
    arrive(src) {
      injected.find((el) => el.src === src)?.onload?.();
    },
    /** And the other ending: it 404'd, or the phone was in a tunnel. */
    fail(src) {
      injected.find((el) => el.src === src)?.onerror?.();
    },
    api: () => ctx.window.beadcause.panelazy,
  };
}

/* ============================================================ the list itself */

console.log('\nwhich eight');

await check('the seven are gone from the document and named in the loader', () => {
  const api = boot().api();
  // Spread into this realm: the array comes back from the vm the file runs in, and
  // `node:assert/strict` compares prototypes.
  const deferred = [...api.scripts()];
  assert.deepEqual(
    deferred,
    ['/history.js', '/releases.js', '/config.js', '/montabs.js', '/monitor.js', '/mergeboard.js', '/prs.js', '/mirror.js'],
    'the deferred list is not the seven bc-iaju1.6 measured, plus mergeboard.js (bc-gjlix)'
  );
  for (const src of deferred) {
    assert.ok(!TAGS.includes(src.slice(1)), `${src} is both a tag and injected — its IIFE would run twice`);
  }
});

await check('the loader is the last tag in the document', () => {
  // Not tidiness: everything eager has to have executed by the time a line of it runs, or
  // an injected script can arrive into a half-built page and reach for a global that is
  // not there yet. `releases.js` takes four members off `prcard.js` at module scope.
  assert.equal(TAGS[TAGS.length - 1], 'panelazy.js', 'something loads after the deferred loader');
});

await check('nothing deferred is something the inbox itself needs', () => {
  // The pane the app lands on, and the files two panes share, stay eager. Deferring
  // `app.js` would be deferring the thing being waited for.
  const deferred = new Set([...boot().api().scripts()]);
  for (const eager of ['/app.js', '/prcard.js', '/spacebar.js', '/filtermenu.js', '/viewbar.js', '/panes.js', '/panestage.js']) {
    assert.ok(!deferred.has(eager), `${eager} is deferred and the first paint needs it`);
  }
});

await check('the loader is precached, or four pills are dead offline', () => {
  // It is the only file that asks for the seven, so a shell cached without it is a shell
  // with no ledger, no Releases, no Config and no Advocates console at all.
  assert.ok(SW.includes("'/panelazy.js'"), 'public/sw.js does not precache the deferred loader');
  for (const src of [...boot().api().scripts()]) {
    // The Mirror is the documented exception — it cannot mean anything without a network
    // — so it is asserted *out* rather than skipped silently.
    if (src === '/mirror.js') {
      assert.ok(!SW.includes("'/mirror.js'"), 'the Mirror is precached now — its comment in sw.js says why it must not be');
      continue;
    }
    assert.ok(SW.includes(`'${src}'`), `${src} is deferred and not precached — offline that pane never arrives`);
  }
});

await check('every pane in the document is either eager or on the list', () => {
  // The check that catches the next pane somebody adds: a new `data-pane` with a script
  // that is neither a tag nor deferred is a pill that does nothing.
  // The pane containers only. The Advocates chip row carries `data-pane` too — `mon`,
  // `prs`, `mirror` — for which of its three *sections* is up, which is montabs.js's
  // business and not a view at all.
  const views = [...HTML.matchAll(/<div class="pane" data-pane="([\w.-]+)"/g)].map((m) => m[1]);
  const api = boot().api();
  const byView = new Map([...api.panes()].map(([view, files]) => [view, [...files]]));
  for (const view of views) {
    const deferred = byView.get(view);
    const eager = TAGS.includes(`${view}.js`);
    assert.ok(deferred?.length || eager || view === 'epics', `the ${view} pane's script is neither loaded nor deferred`);
  }
});

/* ======================================================== when they go out */

console.log('\nwhen');

await check('nothing but the landed-on view goes out before the first paint', () => {
  const app = boot({ showing: 'epics' });
  assert.deepEqual(app.sent(), [], 'a pane nobody is looking at was fetched on the critical path');
  app.paint();
  assert.equal(app.sent().length, 8, 'the rest never went out at all — four pills would spin on the tap');
});

await check('landing on a deferred view fetches its script at once', () => {
  // A home-screen shortcut to `/#history`, or a notification tap that opens the ledger.
  // This is the one case where a deferred script is on the critical path and it must not
  // wait for a frame that is waiting for it.
  const app = boot({ showing: 'history' });
  assert.deepEqual(app.sent(), ['/history.js'], 'the view that was landed on waited for the paint');
});

await check('landing on Advocates fetches all four of its sections, in order', () => {
  const app = boot({ showing: 'advocates' });
  assert.deepEqual(app.sent(), ['/montabs.js', '/monitor.js', '/mergeboard.js', '/prs.js', '/mirror.js']);
});

await check('the order is preserved, and every element says so', () => {
  const app = boot();
  app.paint();
  assert.deepEqual(app.sent(), ['/history.js', '/releases.js', '/config.js', '/montabs.js', '/monitor.js', '/mergeboard.js', '/prs.js', '/mirror.js']);
  // The one line that makes the order above mean anything. A dynamically-inserted script
  // is async by default, so monitor.js — 163 kB against montabs.js's 22 kB — would run
  // whenever it arrived and the three chips would find no row to register on.
  for (const el of app.injected) assert.equal(el.async, false, `${el.src} was injected async and can overtake its dependency`);
});

await check('a script is never injected twice', () => {
  // Several of these register with the stager as they load; a second tag for a file
  // already on its way would run the same IIFE again.
  const app = boot({ showing: 'history' });
  app.paint();
  app.show('history');
  app.show('history');
  app.paint();
  const sent = app.sent();
  assert.equal(new Set(sent).size, sent.length, `something was injected twice: ${sent.join(', ')}`);
  assert.equal(sent.length, 8);
});

/* ============================================================== the safety net */

console.log('\nthe thumb that beats it');

await check('a pane shown before its script arrived fetches it on the spot', () => {
  const app = boot({ showing: 'epics' });
  app.show('advocates');
  assert.deepEqual(app.sent(), ['/montabs.js', '/monitor.js', '/mergeboard.js', '/prs.js', '/mirror.js'], 'the pane would have been shown empty');
});

await check('and a view with nothing deferred is untouched by it', () => {
  const app = boot({ showing: 'epics' });
  app.show('epics');
  app.show('somerepo.board');
  assert.deepEqual(app.sent(), [], 'a view with no deferred script injected something');
});

await check('the loader says what it has sent, in the order it sent it', () => {
  const app = boot({ showing: 'epics' });
  app.show('config');
  app.paint();
  assert.equal(app.api().sent()[0], '/config.js', 'the view that was asked for is not first');
  assert.equal(app.api().sent().length, 8);
});

/* ================================================ the handshake with the stager */

console.log('\nthe landed-on pane');

/*
  public/panestage.js's claim is that the view you land on is built *first*, and until
  bc-iaju1.6 the document guaranteed that by loading every pane script before
  DOMContentLoaded. An injected script does not block that event, so a deep link to
  `/#history` would otherwise build the inbox first and the ledger whenever its 50 kB
  turned up — the pane that was asked for built second, on the one load where it is the
  only one that matters. The stager waits, and these are the two ends of that wait.
*/

await check('a view whose script is still in flight is awaited', () => {
  const app = boot({ showing: 'history' });
  assert.equal(app.api().awaiting('history'), true, 'the stager would boot straight past it');
  // And only that view: nothing is owed for a pane that is not loading.
  assert.equal(app.api().awaiting('epics'), false, 'a view with no deferred script is claimed to be loading');
  assert.equal(app.api().awaiting('releases'), false, 'a script that has not been injected yet is not in flight');
});

await check('and stops being awaited when it arrives', () => {
  const app = boot({ showing: 'history' });
  let released = 0;
  app.api().whenSettled('history', () => { released += 1; });
  assert.equal(released, 0, 'the stager was released before the script it is waiting for');
  app.arrive('/history.js');
  assert.equal(released, 1, 'the stager is still waiting on a script that has arrived');
  assert.equal(app.api().awaiting('history'), false);
});

await check('a script that 404s releases the wait exactly as one that arrives does', () => {
  // The failure that matters: a rename leaves one pane missing, and a hold that only
  // ended on success would turn that into a page with no panes at all.
  const app = boot({ showing: 'history' });
  let released = 0;
  app.api().whenSettled('history', () => { released += 1; });
  app.fail('/history.js');
  assert.equal(released, 1, 'a missing script held the whole staged boot');
});

await check('Advocates is awaited until the last of its four has settled', () => {
  const app = boot({ showing: 'advocates' });
  let released = 0;
  app.api().whenSettled('advocates', () => { released += 1; });
  for (const src of ['/montabs.js', '/monitor.js', '/mergeboard.js', '/prs.js']) {
    app.arrive(src);
    assert.equal(released, 0, `the wait ended while something after ${src} was still coming`);
  }
  app.arrive('/mirror.js');
  assert.equal(released, 1);
});

await check('waiting on a view with nothing deferred is answered at once', () => {
  // One path for the caller rather than two. public/panestage.js asks `awaiting` first,
  // but this must not hang for anything that asks the other way round.
  const app = boot({ showing: 'epics' });
  let released = 0;
  app.api().whenSettled('epics', () => { released += 1; });
  assert.equal(released, 1, 'the stager would have waited forever for a view with no script');
});

/* ------------------------------------------------------------------- ending */

console.log(`\n${failures ? '\x1b[31m' : '\x1b[32m'}${ran - failures}/${ran} checks passed\x1b[0m\n`);
process.exit(failures ? 1 : 0);
