#!/usr/bin/env node
/**
 * The Settings screen (bc-qzng7.1) — its list, its pages, and the doors to it.
 *
 *     npm test
 *     node test/settingsscreen.mjs
 *
 * The `config` pane grew from one space's settings card into the app's Settings screen: a
 * grouped list where each row opens a page of its own, addressed as `#config?p=<page>`.
 * test/spacecard.mjs already holds the This space page to `SETTINGS` row for row; this
 * suite holds the rest of what the bead promised, in a `node:vm` with the real
 * public/hashroute.js and public/config.js and no Chrome:
 *
 * 1. **Every destination opens from Settings.** The list names all seven pages, each page
 *    draws with a way back, and the pages that are documents of their own — Admin,
 *    Foundations, the terminal, the four reference pages — are rows that link to them.
 * 2. **The advocate's controls are on its page**, built off a real-shaped `/api/work`:
 *    the capacity stepper, Pause or Resume, Reclaim, Forget attempts, Turn off, and the
 *    counts.
 * 3. **The doors.** The space picker opens Settings; the Config pill and the logo menu's
 *    navigation rows are gone; every standalone page that is a Settings row links back to
 *    its page, and `/settings?p=…` hops to that page through the daemon's real hop table.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGE = read('public/config.js');
const ROUTE = read('public/hashroute.js');

const { spaceDetail } = await import(path.join(ROOT, 'lib', 'spaces.js'));
const { viewHops } = await import(path.join(ROOT, 'lib', 'pagealias.js'));

let failures = 0;
let ran = 0;
const check = async (name, fn) => {
  ran += 1;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${err.message.split('\n')[0]}`);
  }
};

/* ------------------------------------------------------------------- the room */

const detail = spaceDetail({ workspaces: [{ name: 'demo' }, { name: 'other' }], spaces: [{ name: 'Work', workspaces: ['demo', 'other'] }] }, 'Work');

/** An `/api/work` with one advocated repo and one without, in the shape monitor.js reads. */
const WORK = {
  workspaces: [
    { name: 'demo', counts: { open: 12, ready: 4, held: 2, inProgress: 1, blocked: 3 }, sessions: [{ pid: 1 }] },
    { name: 'other', counts: { open: 5, ready: 0 } },
  ],
  advocates: [
    {
      workspace: 'demo',
      limit: 3,
      ceiling: 9,
      queue: 4,
      paused: false,
      workers: [{ id: 'bc-1' }],
      givenUp: [{ id: 'bc-2', title: 'x', attempts: 3 }],
      heldByChildren: [{ id: 'bc-3' }],
    },
  ],
  roster: [
    { workspace: 'demo', can: true },
    { workspace: 'other', can: true },
  ],
  globals: { live: 1, resolvers: 0, maxWorkers: 6, ceiling: 36 },
  service: { ok: true, label: 'com.beadcause' },
  router: { ok: false, code: 'router-source', summary: 'the router is older', fix: 'npm run swap' },
};

/**
 * Draw the pane at one address and hand back what it drew. `native` puts Android's
 * bridge on the page; `account` is what public/accountbar.js would have exposed.
 */
async function draw(hash, { work = WORK, native = false } = {}) {
  const node = () => ({
    innerHTML: '',
    textContent: '',
    title: '',
    hidden: false,
    dataset: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const nodes = { space: node(), 'cfg-observing': node(), refresh: node() };
  const store = { 'beadcause.token': 'tok' };
  const window = {
    beadcause: {
      space: { filter: { space: 'Work' }, matches: () => true, adopt() {}, onChange() {} },
      account: {
        open() {},
        who: () => 'me@example.com',
        onChange() {},
        nativeNotifications: () => native,
        openNotifications() {},
      },
    },
  };
  const ctx = vm.createContext({
    window,
    document: { getElementById: (id) => nodes[id] || null, addEventListener() {}, activeElement: null },
    location: { search: '', pathname: '/', hash },
    history: { replaceState() {} },
    localStorage: { getItem: (k) => store[k] ?? null, setItem(k, v) { store[k] = v; } },
    URLSearchParams,
    JSON,
    Date,
    Math,
    Number,
    console,
    setTimeout,
    clearTimeout,
    fetch: async (url) => {
      const body = url.startsWith('/api/space?') ? detail : url === '/api/work' ? work : {};
      return { ok: true, status: 200, json: async () => body };
    },
  });
  vm.runInContext(ROUTE, ctx, { filename: 'hashroute.js' });
  vm.runInContext(PAGE, ctx, { filename: 'config.js' });
  for (let i = 0; i < 80; i += 1) await new Promise((r) => setImmediate(r));
  return nodes.space.innerHTML;
}

const PAGES = ['space', 'advocate', 'repos', 'notifications', 'machine', 'all', 'reference'];

/* ------------------------------------------------------------------- the list */

console.log('\nthe Settings list');

const rootHtml = await draw('#config');

await check('#config is the list, and it names every page by its address', async () => {
  assert.ok(rootHtml.includes('class="settings"'), 'no list drawn at #config');
  for (const p of PAGES) assert.ok(rootHtml.includes(`href="#config?p=${p}"`), `no row opens ${p}`);
});

await check('the list says which space its first group is about', async () => {
  assert.ok(rootHtml.includes('Space · Work'), 'the space group does not name the space');
});

await check('an address naming no page is the list, not a blank pane', async () => {
  const html = await draw('#config?p=nonsense');
  assert.ok(html.includes('href="#config?p=space"'), 'an unknown page drew something other than the list');
});

/* ------------------------------------------------------------------- the pages */

console.log('\nevery page, and the way back from it');

for (const p of PAGES) {
  await check(`${p} draws with ‹ Settings back to the list`, async () => {
    const html = await draw(`#config?p=${p}`);
    assert.ok(html.includes('class="settings-back" href="#config"'), `${p} has no way back`);
    assert.ok(html.includes('class="settings-title"'), `${p} has no title`);
  });
}

await check('This machine links Admin, Foundations and the terminal, and opens the account picker', async () => {
  const html = await draw('#config?p=machine');
  for (const href of ['/admin', '/foundations', '/terminal']) assert.ok(html.includes(`href="${href}"`), `no row for ${href}`);
  assert.ok(html.includes('data-account'), 'no account row');
  assert.ok(html.includes('me@example.com'), 'the account row does not say who');
});

await check('Reference links Flow, Requirements, Skills and Sounds', async () => {
  const html = await draw('#config?p=reference');
  for (const href of ['/flow', '/requirements', '/skills', '/sounds']) assert.ok(html.includes(`href="${href}"`), `no row for ${href}`);
});

await check('Notifications opens Android’s channel settings only where the bridge can', async () => {
  assert.ok((await draw('#config?p=notifications', { native: true })).includes('data-native-notify'), 'no Android row in the app');
  assert.ok(!(await draw('#config?p=notifications')).includes('data-native-notify'), 'a browser drew a row that cannot work');
});

await check('Repos in this space draws the per-repo rows, and This space does not', async () => {
  const repos = await draw('#config?p=repos');
  assert.ok(repos.includes('class="space-repos"'), 'no repo rows on Repos');
  assert.ok(!repos.includes('<div class="space-row">'), 'the space-wide rows leaked onto Repos');
  assert.ok(!(await draw('#config?p=space')).includes('class="space-repos"'), 'the repo rows leaked onto This space');
});

/* ------------------------------------------------------------------- the advocate */

console.log('\nthe Advocate page');

const advHtml = await draw('#config?p=advocate');

await check('every control the console has for a running advocate', async () => {
  for (const want of ['data-step="ws:demo"', 'data-adv="pause"', 'data-adv="reclaim"', 'data-adv="forget"', 'data-adv="disable"']) {
    assert.ok(advHtml.includes(want), `no ${want}`);
  }
  assert.ok(advHtml.includes('Forget attempts (1)'), 'Forget attempts does not say how many');
  assert.ok(advHtml.includes(`data-step="global"`), 'no Mac-wide capacity stepper');
});

await check('its status: the counts, and launchd and the build, open when one is wrong', async () => {
  assert.ok(advHtml.includes('class="settings-counts"'), 'no counts');
  assert.ok(/<dt>held for endorsement<\/dt><dd>2<\/dd>/.test(advHtml), 'the held count is missing');
  assert.ok(/<dt>waiting on their children<\/dt><dd>1<\/dd>/.test(advHtml), 'a hold list is not counted');
  assert.ok(advHtml.includes('<details class="settings-details" open>'), 'a stale router is folded away');
});

await check('a repo with no advocate offers to turn one on', async () => {
  assert.ok(advHtml.includes('data-adv="enable" data-ws="other"'), 'no Turn on for the repo without one');
});

await check('a paused advocate offers Resume, and a switched-off one only Turn on', async () => {
  const paused = await draw('#config?p=advocate', { work: { ...WORK, advocates: [{ ...WORK.advocates[0], paused: true }] } });
  assert.ok(paused.includes('data-adv="resume"') && !paused.includes('data-adv="pause"'));
  const off = await draw('#config?p=advocate', { work: { ...WORK, advocates: [{ ...WORK.advocates[0], draining: true }] } });
  assert.ok(off.includes('data-adv="enable" data-ws="demo"'), 'a draining advocate has no way back');
  assert.ok(!off.includes('data-adv="pause"'), 'a draining advocate still offers Pause');
});

/* ------------------------------------------------------------------- the doors */

console.log('\nthe doors to Settings, and the ones that are gone');

await check('the space picker’s first row opens Settings', async () => {
  const src = read('public/spacebar.js');
  assert.ok(src.includes(`option(SETTINGS, '⚙ Settings', false)`), 'the picker has no Settings row');
  assert.ok(/sel\.value === SETTINGS[\s\S]{0,80}openSettings\(\)/.test(src), 'the row does not open anything');
});

await check('the Config pill is gone from the row', async () => {
  assert.ok(!/\{ id: 'config'/.test(read('public/viewbar.js')), 'viewbar.js still declares a Config pill');
});

await check('no navigation is left in the logo menu', async () => {
  const src = read('public/accountbar.js');
  for (const gone of ['id="account-admin"', 'id="account-switch"', 'id="account-notifications"', 'href="/admin"']) {
    assert.ok(!src.includes(gone), `accountbar.js still draws ${gone}`);
  }
  assert.ok(!read('public/index.html').includes('id="foundations-link"'), 'the ⚖️ Foundations link is back in the inbox header');
});

await check('every standalone page that is a Settings row links back to its page', async () => {
  const pages = { admin: 'machine', foundations: 'machine', term: 'machine', flow: 'reference', requirements: 'reference', skills: 'reference', sounds: 'reference' };
  for (const [file, p] of Object.entries(pages)) {
    assert.ok(read(`public/${file}.html`).includes(`href="/settings?p=${p}"`), `public/${file}.html has no way back to Settings → ${p}`);
  }
});

await check('/config and /settings still hop to the Settings pane, and carry the page with them', async () => {
  const hops = viewHops();
  for (const p of ['/config', '/settings', '/config.html']) assert.equal(hops[p]?.view, 'config', `${p} no longer hops to Settings`);
  // `viewHop` in lib/server.js keeps every query key but the token as the view's query, so
  // `/settings?p=machine` lands on `#config?p=machine`. Asserted off the source rather than
  // re-implemented: the line that would move is the one that splits `t` from the rest.
  assert.ok(/DAEMON_QUERY\.has\(k\) \? kept : filters/.test(read('lib/server.js')), 'the hop no longer carries the query');
  assert.ok(!/DAEMON_QUERY = new Set\(\[[^\]]*'p'/.test(read('lib/pagealias.js')), '`p` became a daemon key and would be dropped');
});

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n${ran} passed\n`);
process.exit(failures ? 1 : 0);
