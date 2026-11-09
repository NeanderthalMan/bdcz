#!/usr/bin/env node
/**
 * All settings (bc-qzng7.5) — every config.json key on a page, and the one write behind it.
 *
 *     npm test
 *     node test/configkeys.mjs
 *
 * The bead's three acceptance criteria, each asserted against the real thing rather than a
 * copy of it:
 *
 * 1. **Every documented key is visible, and a test fails when one is not.** The page's
 *    list *is* docs/config.md's table (lib/configkeys.js `parseDocKeys`), so the failure
 *    this guards is a documented key the page cannot type — no default in lib/config.js,
 *    nothing in `SPECS`. `unshowable` names those, it must be empty for the real document,
 *    and it must name a key planted in a made-up one (or the check is checking nothing).
 *    Then public/config.js is run in a `node:vm` against that catalogue and every key must
 *    be a row of the page it draws.
 * 2. **Secrets never reach the browser.** A config with a value planted in every secret
 *    slot — the token, the ntfy topic, a credential inside the `jira` and `slack` blocks —
 *    is served by the real daemon (`createApp`), and none of the planted strings may be
 *    anywhere in `GET /api/config`. The write path refuses them too.
 * 3. **Changing a key in the UI and in the file give the same result.** For a spread of
 *    types, a write through `writeKey` and the same edit made by hand leave the same JSON
 *    in the file, and the running config the write changed holds what `loadConfig` reads
 *    back from the hand-edited file.
 *
 * Plus what the bead asked of the write itself: the documented clamps, the keys a browser
 * may not write, the log with who and when, and Revert.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers/net.mjs';
import { quiesce, removeTree } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LIB = (f) => path.join(ROOT, 'lib', f);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-configkeys-'));
// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });
const CONFIG = path.join(process.env.BEADCAUSE_CONFIG_DIR, 'config.json');
const LOG = path.join(process.env.BEADCAUSE_CONFIG_DIR, 'config-changes.jsonl');
const ROOTS = path.join(tmp, 'roots');
fs.mkdirSync(ROOTS, { recursive: true });

const K = await import(LIB('configkeys.js'));
const { loadConfig, configDefaults } = await import(LIB('config.js'));
const { options: advocateOptions } = await import(LIB('advocate.js'));

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
    console.log(`      ${String(err.message).split('\n')[0]}`);
  }
};

const DOC = read('docs/config.md');
const docKeys = K.parseDocKeys(DOC);
const defaults = configDefaults();
defaults.advocates = advocateOptions(defaults);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ------------------------------------------------------------ 1. every key, visible */

console.log('\nevery documented key is on the page');

await check('the document parses to the whole table — a floor, so a broken parse cannot pass as an empty one', () => {
  assert.ok(docKeys.length >= 200, `only ${docKeys.length} keys parsed out of docs/config.md`);
  for (const k of ['owner', 'port', 'host', 'advocates.maxWorkers', 'pr.mergeMethod', 'slack.answerBase', 'jira.<workspace>.enabled', 'incidents.sev4']) {
    assert.ok(docKeys.some((d) => d.key === k), `${k} is documented and was not parsed`);
  }
  assert.ok(!docKeys.some((d) => d.key === 'BEADCAUSE_CONFIG_DIR'), 'an environment variable was read as a config key');
  assert.ok(!docKeys.some((d) => d.key === 'true'), "a value row of the jira table was read as a key");
});

await check('every documented key has a type the page can draw and edit', () => {
  assert.deepEqual(K.unshowable(docKeys, { defaults, cfg: defaults }), []);
});

await check('and a documented key nothing can type is named — the check above can fail', () => {
  const planted = K.parseDocKeys(`${DOC}\n`.replace('| `owner` |', '| `bogusNewKey` | planted by test/configkeys.mjs |\n| `owner` |'));
  assert.ok(planted.some((d) => d.key === 'bogusNewKey'), 'the planted row was not parsed');
  assert.deepEqual(K.unshowable(planted, { defaults, cfg: defaults }), ['bogusNewKey']);
});

await check('every key lands in a named group, in the document’s order', () => {
  const groups = K.catalogue(docKeys, { cfg: defaults, raw: {}, defaults });
  const other = groups.find((g) => g.name === K.OTHER_GROUP);
  assert.equal(other, undefined, `ungrouped: ${other?.keys.map((k) => k.key).join(', ')}`);
  assert.equal(groups[0].name, 'This machine', 'the first group is not the first key’s');
  for (const want of ['Advocates', 'Pull requests', 'Slack', 'ntfy', 'Terminal', 'JIRA and Confluence', 'Deploys and release']) {
    assert.ok(groups.some((g) => g.name === want), `no ${want} group`);
  }
});

/** Run the real public/config.js on `#config?p=all` against this catalogue. */
async function drawAll(payload) {
  const node = () => ({
    innerHTML: '', textContent: '', title: '', hidden: false, dataset: {},
    classList: { add() {}, remove() {} }, addEventListener() {}, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [],
  });
  const nodes = { space: node(), 'cfg-observing': node(), refresh: node() };
  const store = { 'beadcause.token': 'tok' };
  const window = {
    beadcause: {
      space: { filter: { space: 'all' }, matches: () => true, adopt() {}, onChange() {} },
      account: { open() {}, who: () => 'me@example.com', onChange() {}, nativeNotifications: () => false },
    },
  };
  const ctx = vm.createContext({
    window,
    document: { getElementById: (id) => nodes[id] || null, addEventListener() {}, activeElement: null },
    location: { search: '', pathname: '/', hash: '#config?p=all' },
    history: { replaceState() {} },
    localStorage: { getItem: (k) => store[k] ?? null, setItem(k, v) { store[k] = v; } },
    URLSearchParams, JSON, Date, Math, Number, console, setTimeout, clearTimeout,
    fetch: async (url) => ({ ok: true, status: 200, json: async () => (url === '/api/config' ? payload : {}) }),
  });
  vm.runInContext(read('public/hashroute.js'), ctx, { filename: 'hashroute.js' });
  vm.runInContext(read('public/config.js'), ctx, { filename: 'config.js' });
  for (let i = 0; i < 80; i += 1) await new Promise((r) => setImmediate(r));
  return nodes.space.innerHTML;
}

const SEKRET = {
  token: 'SEKRET-token-4c1d',
  topic: 'SEKRET-topic-77aa',
  jira: 'SEKRET-jira-0e9f',
  slack: 'SEKRET-slack-b2b2',
};
/** A running config with something planted in every secret slot. */
const plantedCfg = () => ({
  ...structuredClone(defaults),
  host: '127.0.0.1',
  port: 0,
  token: SEKRET.token,
  ntfy: { ...defaults.ntfy, enabled: false, topic: SEKRET.topic },
  jira: { demo: { enabled: true, email: 'me@example.com', apiToken: SEKRET.jira } },
  slack: { ...defaults.slack, botToken: SEKRET.slack },
  spaces: [{ name: 'Work', workspaces: ['demo'], autoMerge: false }],
  workspaces: [{ name: 'demo', dir: path.join(tmp, 'demo', '.beads') }],
  autoMergePerWorkspace: { demo: true },
  claudeSessions: false,
  openSessions: false,
  advocates: { ...defaults.advocates, enabled: false, workspaces: [] },
});

const pagePayload = {
  path: '/x/config.json',
  groups: K.catalogue(docKeys, { cfg: plantedCfg(), raw: {}, defaults }),
  log: [{ id: 'abc', at: new Date().toISOString(), who: 'me@example.com', key: 'autoDispatch', old: { set: false }, new: { set: true, value: false }, restart: false }],
  restartPending: ['pollSeconds'],
};
const page = await drawAll(pagePayload);

await check('the page draws a row for every documented key', () => {
  const missing = docKeys.filter((d) => !page.includes(`data-cfg-key="${esc(d.key)}"`)).map((d) => d.key);
  assert.deepEqual(missing, [], `documented and not drawn: ${missing.join(', ')}`);
});

await check('a row has its description, default, source and an editor of its type', () => {
  const row = (key) => {
    const at = page.indexOf(`data-cfg-key="${key}"`);
    return page.slice(at, page.indexOf('</details>', at));
  };
  const n = row('questions.settleMinutes');
  assert.ok(n.includes('type="number"') && n.includes('max="120"'), 'no clamped number editor');
  assert.ok(n.includes('<dt>Default</dt>'), 'no default');
  assert.ok(n.includes('<dt>Source</dt>'), 'no source');
  assert.ok(n.includes('settles') || n.includes('silent'), 'no description');
  assert.ok(row('pr.mergeMethod').includes('<option value="rebase"'), 'no enum editor');
  assert.ok(row('autoDispatch').includes('<option value="false"'), 'no boolean editor');
  assert.ok(row('incidents.sev2').includes('<textarea'), 'no JSON editor');
  assert.ok(row('pollSeconds').includes('↻ restart'), 'a restart key is not marked');
  assert.ok(row('terminal').includes('file only') && !row('terminal').includes('data-cfg-save'), 'a file-only key is editable');
  assert.ok(row('autoMergePerWorkspace').includes('cfg-pw'), 'the per-workspace family does not show what each repo resolves to');
  assert.ok(row('pr.autoMerge').includes('Space <b>Work</b> overrides it'), 'a space override is not named as the source');
});

await check('search, the log with Revert, and the restart offer are on the page', () => {
  assert.ok(page.includes('id="cfg-search"'), 'no search box');
  assert.ok(page.includes('data-cfg-revert="abc"'), 'a logged change has no Revert');
  assert.ok(page.includes('me@example.com'), 'the log does not say who');
  assert.ok(page.includes('data-cfg-restart'), 'no restart offered for a key waiting on one');
});

/* ------------------------------------------------------------------- 2. secrets */

console.log('\nsecrets never reach the browser');

await check('the catalogue never carries a planted secret, and says only whether one is set', () => {
  const text = JSON.stringify(pagePayload);
  for (const [slot, v] of Object.entries(SEKRET)) assert.ok(!text.includes(v), `${slot} reached the payload`);
  const token = pagePayload.groups.flatMap((g) => g.keys).find((k) => k.key === 'token');
  assert.deepEqual([token.type, token.isSet, 'value' in token], ['secret', true, false]);
  for (const v of Object.values(SEKRET)) assert.ok(!page.includes(v), 'and the page does not draw one');
});

await check('an object holding a credential is drawn read-only, so its placeholder cannot be saved back', () => {
  const jira = pagePayload.groups.flatMap((g) => g.keys).find((k) => k.key === 'jira');
  assert.equal(jira.editable, false);
  assert.equal(jira.value.demo.apiToken, '(set — hidden)');
});

await check('the log is redacted on the way out too', () => {
  const out = K.publicLog([
    { key: 'token', old: { set: true, value: SEKRET.token }, new: { set: false } },
    { key: 'jira', old: { set: true, value: { demo: { apiToken: SEKRET.jira } } }, new: { set: false } },
  ]);
  assert.ok(!JSON.stringify(out).includes('SEKRET'), 'a secret in the log file reached the browser');
});

/* --------------------------------------------- the write: clamps, refusals, the log */

console.log('\nthe write');

/**
 * A fresh config file and a running config for it. `load` makes that config the real way,
 * with `loadConfig` — about five seconds each on this Mac, because `defaults()` spawns
 * Tailscale and git and the load calls it once per merged block — so only the section that
 * is *about* what `loadConfig` reads asks for it. The others take the defaults with the
 * file laid over them, which is all a refusal or a log line needs.
 */
function fresh(raw = {}, { load = false } = {}) {
  const file = { workspaceRoots: [ROOTS], workspaces: [], ...raw };
  fs.writeFileSync(CONFIG, `${JSON.stringify(file, null, 2)}\n`);
  fs.rmSync(LOG, { force: true });
  return load ? loadConfig() : { ...structuredClone(defaults), ...structuredClone(file) };
}
const ctx = (cfg) => ({ docKeys, cfg, view: { ...cfg, advocates: advocateOptions(cfg) }, defaults, configPath: CONFIG, logPath: LOG, who: 'me@example.com' });
const refused = (op, cfg, re) => assert.throws(() => K.writeKey(op, ctx(cfg)), re);

await check('the documented clamps are refused, not silently clamped', () => {
  const cfg = fresh({ advocates: { maxWorkersLimit: 3 } });
  refused({ key: 'advocates.globalMaxWorkers', value: 37 }, cfg, /at most 36/);
  refused({ key: 'questions.settleMinutes', value: 121 }, cfg, /at most 120/);
  refused({ key: 'release.seconds', value: 59 }, cfg, /at least 60/);
  refused({ key: 'advocates.maxWorkers', value: 4 }, cfg, /at most 3 \(advocates.maxWorkersLimit\)/);
  refused({ key: 'pollSeconds', value: 2.5 }, cfg, /whole number/);
  refused({ key: 'pr.mergeMethod', value: 'yolo' }, cfg, /one of merge, squash, rebase/);
  refused({ key: 'autoDispatch', value: 'false' }, cfg, /true or false/);
  refused({ key: 'incidents.sev2', value: { acknowledge: 0 } }, cfg, /at least 1/);
  refused({ key: 'strayHours', value: 0.5 }, cfg, /at least an hour/);
  assert.equal(fs.existsSync(LOG), false, 'a refused write was logged');
});

await check('secrets, sign-in, commands and the off switches are not written from here', () => {
  const cfg = fresh();
  for (const key of ['token', 'ntfy.topic', 'auth.google.allowed', 'slack.botTokenFile', 'deploys', 'bdBin', 'terminal', 'openSessions', 'sessionPermissionMode', 'jira.<workspace>.ingest']) {
    refused({ key, value: 'x' }, cfg, /not changed from here/);
  }
  refused({ key: 'jira', value: { demo: { apiToken: 'x' } } }, cfg, /credential/);
  refused({ key: 'noSuchKey', value: 1 }, cfg, /not a documented key/);
});

await check('every write is logged — who, when, old and new — and Revert puts the old back', () => {
  const cfg = fresh();
  const a = K.writeKey({ key: 'autoDispatch', value: false }, ctx(cfg));
  assert.equal(a.changed, true);
  const [line] = K.readLog(LOG);
  assert.equal(line.who, 'me@example.com');
  assert.ok(Date.parse(line.at) > 0, 'no time');
  assert.deepEqual([line.old, line.new], [{ set: false }, { set: true, value: false }]);
  assert.equal(cfg.autoDispatch, false, 'the running config did not change');

  const b = K.writeKey({ revert: line.id }, ctx(cfg));
  assert.equal(b.entry.revertOf, line.id);
  assert.equal('autoDispatch' in JSON.parse(fs.readFileSync(CONFIG, 'utf8')), false, 'the revert did not take the key back out');
  assert.equal(cfg.autoDispatch, true, 'the running config did not go back to the default');
  assert.equal(K.readLog(LOG).length, 2, 'the revert is not a line of its own');
});

await check('a key that waits for a restart says so', () => {
  const cfg = fresh();
  assert.equal(K.writeKey({ key: 'pollSeconds', value: 45 }, ctx(cfg)).restart, true);
  assert.equal(K.writeKey({ key: 'autoDispatchTimeoutMs', value: 60000 }, ctx(cfg)).restart, false);
});

/* ------------------------------------------------------- 3. the UI and the file agree */

console.log('\nchanging a key here and in the file give the same result');

const get = (o, key) => K.getPath(o, key);
const CASES = [
  ['a top-level boolean', 'autoDispatch', false],
  ['a nested number', 'advocates.maxWorkers', 2],
  ['an enum', 'pr.mergeMethod', 'rebase'],
  ['a JSON object', 'incidents.sev2', { acknowledge: 30, resolve: 600 }],
  ['a JSON array', 'autoDispatchExclude', ['northwind']],
  ['a nullable string', 'consoleModel', 'sonnet'],
  ['a per-workspace map', 'autoShipPerWorkspace', { demo: true }],
];
const BASE = { advocates: { maxWorkersLimit: 3 }, ntfy: { server: 'https://ntfy.example' } };

/*
  Every case at once, in one file each way: the page's writes (and one Reset) against a
  config `loadConfig` made, and the same edits typed into a copy of the file, loaded the
  same way. Two loads rather than two per case — see `fresh`.
*/
const ui = fresh({ ...BASE, slowRequestMs: 250 }, { load: true });
for (const [, key, value] of CASES) K.writeKey({ key, value }, ctx(ui));
K.writeKey({ key: 'slowRequestMs', reset: true }, ctx(ui));
const fromUi = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

const hand = structuredClone({ workspaceRoots: [ROOTS], workspaces: [], ...BASE });
for (const [, key, value] of CASES) {
  const segs = key.split('.');
  let cur = hand;
  for (const s of segs.slice(0, -1)) cur = cur[s] ||= {};
  cur[segs.at(-1)] = structuredClone(value);
}
fs.writeFileSync(CONFIG, `${JSON.stringify(hand, null, 2)}\n`);
const fromFile = loadConfig();

for (const [what, key] of CASES) {
  await check(`${what} (${key})`, () => {
    assert.deepEqual(get(fromUi, key), get(hand, key), 'the file a write leaves is not the file a hand edit leaves');
    assert.deepEqual(get(ui, key), get(fromFile, key), 'the running config differs from what the file loads as');
  });
}

await check('and nothing else moved: the page’s writes leave exactly the hand-edited file', () => {
  assert.deepEqual(fromUi, hand);
});

await check('Reset to default is deleting the key by hand', () => {
  assert.equal('slowRequestMs' in fromUi, false, 'the key is still in the file');
  assert.equal(ui.slowRequestMs, fromFile.slowRequestMs, 'the running config is not the default the file loads as');
});

/* ------------------------------------------------------------ the daemon's route */

console.log('\nthe daemon’s one endpoint');

const { createApp, listen } = await import(LIB('server.js'));
fs.writeFileSync(CONFIG, `${JSON.stringify({ workspaceRoots: [ROOTS], workspaces: [] }, null, 2)}\n`);
fs.rmSync(LOG, { force: true });
const cfg = plantedCfg();
const servers = listen(cfg, createApp(cfg).handler);
const port = await boundPort(servers);
const call = async (method, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/config`, {
    method,
    headers: { 'x-beadcause-token': SEKRET.token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
};

try {
  await check('GET /api/config serves every documented key and no planted secret', async () => {
    const { status, text } = await call('GET');
    assert.equal(status, 200, text.slice(0, 200));
    for (const [slot, v] of Object.entries(SEKRET)) assert.ok(!text.includes(v), `${slot} reached the browser`);
    const body = JSON.parse(text);
    const keys = body.groups.flatMap((g) => g.keys.map((k) => k.key));
    assert.deepEqual(docKeys.map((d) => d.key).filter((k) => !keys.includes(k)), []);
  });

  await check('POST /api/config writes one key to the file and to the running daemon, and logs it', async () => {
    const { status, text } = await call('POST', { key: 'autoDispatchTimeoutMs', value: 120000 });
    assert.equal(status, 200, text);
    assert.equal(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).autoDispatchTimeoutMs, 120000);
    assert.equal(cfg.autoDispatchTimeoutMs, 120000);
    const log = JSON.parse((await call('GET')).text).log;
    assert.equal(log[0].key, 'autoDispatchTimeoutMs');
  });

  await check('and refuses a secret, with the reason, leaving the file alone', async () => {
    const before = fs.readFileSync(CONFIG, 'utf8');
    const { status, text } = await call('POST', { key: 'token', value: 'new' });
    assert.equal(status, 400);
    assert.match(JSON.parse(text).error, /not changed from here/);
    assert.equal(fs.readFileSync(CONFIG, 'utf8'), before);
  });

  await check('the restart is the service manager’s restart, sent after the reply, and refused on an observer', () => {
    const src = read('lib/server.js');
    const at = src.indexOf("p === '/api/config' && req.method === 'POST'");
    const block = src.slice(at, at + 3000);
    assert.ok(/if \(OBSERVING\) return json\(res, 403/.test(block.slice(0, 200)), 'an observer may write config');
    assert.ok(/restartArgv\(\)/.test(block) && /json\(res, 202/.test(block), 'the restart is not restartArgv, answered first');
  });
} finally {
  for (const s of servers) s.close();
}

/* ---------------------------------------------------------------------- the docs */

console.log('\nthe docs');

await check('docs/config.md and docs/navigating.md describe the page and its endpoint', () => {
  assert.ok(/All settings/.test(DOC) && /\/api\/config/.test(DOC), 'docs/config.md does not describe All settings');
  assert.ok(/All settings/.test(read('docs/navigating.md')), 'docs/navigating.md does not mention All settings');
});

await quiesce();
await removeTree(tmp);
console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n${ran} passed\n`);
process.exit(failures ? 1 : 0);
