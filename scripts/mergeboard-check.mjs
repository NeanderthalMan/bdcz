#!/usr/bin/env node
// The PRs chip's two subtabs in a real Chrome: Open PRs and Merge queue (bc-gjlix).
//
//     node scripts/mergeboard-check.mjs [--out=<dir>]
//
// Not in npm test, like every scripts/*-check.mjs: it needs Chrome. It serves public/
// with a fixture /api/prs and /api/queues and checks what only a browser can show:
//
//   - the switch swaps exactly one list, and the choice survives a reload;
//   - the queue is drawn in the order the queue tries it (by `position`), under a base
//     line that says the base is red and names the hold bead;
//   - the board asks for nothing while the queue subtab is up, and the queue asks for
//     nothing while the board is up. Each wake of the board is a `gh` sweep per repo, so
//     a board that kept polling behind the other subtab would cost money for no screen.
//
// `--out=<dir>` writes a screenshot of the queue in both colour schemes.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME, launchChrome } from './helpers/chrome.mjs';
import { aliasPage, hopLocation, pageAliases, viewHops } from '../lib/pagealias.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const ALIASES = pageAliases();
/* The paths that are a 302 to a pane of the shell, read out of lib/server.js (bc-l75v7). */
const HOPS = viewHops();
const VP = { width: 393, height: 852, dpr: 3 };
const outDir = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(CHROME)) {
  console.error(`Google Chrome not found at ${CHROME}`);
  process.exit(1);
}

/* ---------------------------------------------------------------- the fixture */

const BOARD = {
  at: new Date().toISOString(),
  repos: [{ key: 'demo', workspace: 'demo', repo: 'o/demo', base: 'main', prs: [] }],
};

const entry = (mergeBead, number, position, stage, extra = {}) => ({
  kind: 'merge',
  workspace: 'demo',
  key: 'demo',
  bead: `${mergeBead}-work`,
  mergeBead,
  number,
  url: `https://github.com/o/demo/pull/${number}`,
  title: `Pull request ${number}`,
  branch: `b${number}`,
  base: 'main',
  stage,
  stageLabel: stage === 'held' ? 'Held — the base is red' : 'Queued for merge',
  note: '',
  attempts: 0,
  downmerges: 0,
  attemptsLeft: 3,
  refused: stage === 'held' ? 'main is red (test, shard 0) — bc-hold1 is on it' : null,
  position,
  queueLength: 3,
  ...extra,
});

const QUEUES = {
  at: new Date().toISOString(),
  // Deliberately out of position order: the page sorts, the payload does not promise to.
  repos: [
    {
      key: 'demo',
      workspace: 'demo',
      repo: 'o/demo',
      base: 'main',
      merge: [entry('bc-c', 105, 3, 'held'), entry('bc-a', 120, 1, 'held'), entry('bc-b', 90, 2, 'held')],
      release: [],
    },
  ],
  orphans: [],
  counts: { merge: 3, release: 0 },
  errors: [],
  bases: [
    {
      workspace: 'demo',
      key: 'demo',
      base: 'main',
      state: 'red',
      source: 'github',
      holdBead: 'bc-hold1',
      failed: ['test (shard 0)'],
      summary: 'Held — main is red (test (shard 0)), on bc-hold1.',
      at: new Date().toISOString(),
    },
  ],
};

/* ------------------------------------------------------------------- the server */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/** How many times each API path was asked for. */
const asked = new Map();

function serve() {
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const json = (b) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    if (p.startsWith('/api/')) asked.set(p, (asked.get(p) || 0) + 1);
    if (p === '/api/prs') return json(BOARD);
    if (p === '/api/queues') return json(QUEUES);
    if (p.startsWith('/api/')) return json({});
    // `/prs` is a hop to the shell's PRs chip, as on the daemon; public/monitor.html, which
    // this used to serve, is deleted (bc-l75v7).
    const hop = hopLocation(p, new URL(req.url, 'http://x').search, HOPS);
    if (hop) {
      res.writeHead(302, { location: hop });
      return res.end();
    }
    const rel = aliasPage(p, ALIASES);
    const file = path.join(PUBLIC, rel === '/' ? 'index.html' : rel.replace(/^\/+/, ''));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('no');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const server = await serve();
const BASE = `http://127.0.0.1:${server.address().port}`;
const chrome = await launchChrome('beadcause-mergeboard-');
const { s } = chrome;

const evalJs = async (expr) => {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};

let failures = 0;
const ok = (pass, msg) => {
  if (!pass) failures++;
  console.log(`  ${pass ? '✓' : '✗'} ${msg}`);
};

const SHOWN = `['prs-open', 'prs-queue'].filter((id) => !document.getElementById(id).hidden).join(',')`;
const tap = (sub) => evalJs(`document.querySelector('#prs-tabs [data-sub="${sub}"]').click()`);

try {
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('Emulation.setDeviceMetricsOverride', { width: VP.width, height: VP.height, deviceScaleFactor: VP.dpr, mobile: true });

  await s.send('Page.navigate', { url: `${BASE}/prs` });
  await sleep(900);
  await evalJs(`localStorage.setItem('beadcause.token', 'x'); localStorage.setItem('beadcause.mon.tab', 'prs'); localStorage.removeItem('beadcause.prs.sub')`);
  await s.send('Page.navigate', { url: `${BASE}/prs` });
  await sleep(1500);

  console.log('\nthe switch');
  ok((await evalJs(SHOWN)) === 'prs-open', `Open PRs is the default — ${await evalJs(SHOWN)}`);
  // Not a request count: public/warm.js prewarms `/api/queues` for Releases once the board
  // has loaded, which is the same path. What must not happen is this list drawing itself.
  ok(
    (await evalJs(`document.querySelectorAll('#prs-queue .mq-row, #prs-queue .mq-repo').length`)) === 0,
    'and the queue list has not drawn itself behind it'
  );
  ok(
    (await evalJs(`document.getElementById('prs-queue-count').textContent`)) === '',
    'the count stays empty until the queue has been read'
  );

  const prsBefore = asked.get('/api/prs') || 0;
  await tap('queue');
  await sleep(600);
  ok((await evalJs(SHOWN)) === 'prs-queue', `the Merge queue subtab swaps exactly one list — ${await evalJs(SHOWN)}`);
  ok((asked.get('/api/queues') || 0) >= 1, 'and reads the queue');
  ok((asked.get('/api/prs') || 0) === prsBefore, 'while the board asks for nothing');
  ok(
    (await evalJs(`document.querySelector('#prs-tabs [data-sub="queue"]').getAttribute('aria-pressed')`)) === 'true',
    'and the switch says which one is up'
  );

  console.log('\nthe queue');
  const order = await evalJs(`[...document.querySelectorAll('#prs-queue .mq-row .mq-pos')].map((e) => e.textContent.trim()).join(',')`);
  ok(order === '1,2,3', `entries are drawn in the order the queue tries them — ${order}`);
  const first = await evalJs(`document.querySelector('#prs-queue .mq-row .mq-title')?.textContent.trim() || ''`);
  ok(/#120/.test(first), `position 1 is the lowest bead id, not the highest PR number — "${first}"`);
  const base = await evalJs(`document.querySelector('#prs-queue .mq-base')?.textContent.trim() || ''`);
  ok(/main is red/.test(base) && /bc-hold1/.test(base), `the base line says why everything is waiting — "${base}"`);
  ok(/GitHub/.test(base), 'and which source answered');
  ok(
    (await evalJs(`document.querySelector('#prs-queue .mq-base').classList.contains('red')`)) === true,
    'and is drawn red'
  );
  ok((await evalJs(`document.getElementById('prs-queue-count').textContent`)) === '3', 'the subtab carries the count');

  console.log('\nremembered');
  await s.send('Page.navigate', { url: `${BASE}/prs` });
  await sleep(1500);
  ok((await evalJs(SHOWN)) === 'prs-queue', 'a reload comes back to the queue');

  const queuesBefore = asked.get('/api/queues') || 0;
  await tap('open');
  await sleep(600);
  ok((await evalJs(SHOWN)) === 'prs-open', 'and Open PRs swaps back');
  ok(
    (await evalJs(`document.querySelector('#prs-open .board-foot, #prs-open .empty, #prs-open .board-build') !== null`)) === true,
    'with the board drawn in it'
  );
  ok((asked.get('/api/queues') || 0) === queuesBefore, 'and the queue stops asking');

  if (outDir) {
    await tap('queue');
    await sleep(500);
    fs.mkdirSync(outDir, { recursive: true });
    for (const scheme of ['dark', 'light']) {
      await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await sleep(300);
      const shot = await s.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, `mergeboard-${scheme}.png`), Buffer.from(shot.data, 'base64'));
    }
    console.log(`\n  screenshots in ${outDir}`);
  }
} finally {
  chrome.close();
  server.close();
}

console.log(`\n${failures ? `${failures} failed` : 'all passed'}`);
process.exit(failures ? 1 : 0);
