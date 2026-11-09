#!/usr/bin/env node
//
// An effort's "asks you" rows are its question cards, worked through in order. bc-s31p5.
//
//   node scripts/p0askschain-check.mjs [--baseline] [--keep] [--out=<dir>]
//
// 1. **Opening the effort preloads its first two questions, and only those.** Two
//    `/api/question` calls before anything is tapped, for the first two rows in tree order.
// 2. **Tapping an "asks you" row opens its question card** — the `.card.open` sheet that
//    "Answer it" used to be one more tap away from — with no fetch of its own, since the
//    preload already has it. The bead's details do not unfold underneath.
// 3. **Answering it closes it and opens the next**, and the one after that is fetched as
//    the next opens, so there is always one in hand.
// 4. **The last answer leaves you on the tree**, with no card open and nothing written
//    beyond the answers given.
//
// Same scaffolding as scripts/p0answerpending-check.mjs: the real public/app.js in a
// headless phone-sized Chrome against fixtures served from this process, never a daemon
// or a bead. `--baseline` serves the committed app.js, where a row tap unfolds details,
// so it must fail.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toQuestion } from '../lib/decision.js';
import { aliasPage, pageAliases } from '../lib/pagealias.js';
import { CHROME, launchChrome } from './helpers/chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const VP = { width: 393, height: 852, dpr: 3 };
const TOKEN = 'p0askschain-token';
const BASELINE = process.argv.includes('--baseline');
const KEEP = process.argv.includes('--keep');
const OUT = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(CHROME)) {
  console.error(`Google Chrome not found at ${CHROME}`);
  process.exit(1);
}
for (const v of ['marked.js', 'purify.js']) {
  if (!fs.existsSync(path.join(PUBLIC, 'vendor', v))) {
    console.error(`public/vendor/${v} is missing — run \`npm run vendor\` first.`);
    process.exit(1);
  }
}

/* ---------------------------------------------------------------- fixtures */

const WS = 'alpha';
const P0 = { id: 'a-p0', title: 'Make the phone the whole interface' };
// Four questions under the effort, with an ordinary bead between the second and third so
// "next" has to mean the next *question*, not the next row.
const IDS = ['a-p0.1', 'a-p0.2', 'a-p0.4', 'a-p0.5'];
const PLAIN = 'a-p0.3';

const bead = (id, title) => ({
  id,
  title,
  issue_type: 'task',
  status: 'open',
  priority: 1,
  labels: ['human'],
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-08T10:00:00Z',
  comment_count: 0,
  dependent_count: 0,
  description: `Question ${id}: keep the standby build after a swap?`,
});

const BEADS = IDS.map((id, i) => bead(id, `Question ${i + 1} of the effort`));
const QUESTIONS = BEADS.map((b) => toQuestion(WS, b));

const row = (id, title, pending) => ({ id, title, status: 'open', parent: P0.id, depth: 1, key: `${WS}/${id}`, pending });
const board = () => ({
  owned: true,
  under: {},
  roots: [
    {
      key: `${WS}/${P0.id}`,
      workspace: WS,
      id: P0.id,
      title: P0.title,
      status: 'open',
      issue_type: 'epic',
      owners: ['adam'],
      open: 5,
      inFlight: 0,
      waitingOn: null,
      advocate: null,
      tree: [
        row(IDS[0], BEADS[0].title, true),
        row(IDS[1], BEADS[1].title, true),
        row(PLAIN, 'An ordinary bead, asking nothing', false),
        row(IDS[2], BEADS[2].title, true),
        row(IDS[3], BEADS[3].title, true),
      ],
    },
  ],
});

/* ------------------------------------------------------------------ server */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
const BASELINED = ['/app.js', '/style.css'];
const committed = (rel) => execFileSync('git', ['-C', ROOT, 'show', `HEAD:${rel}`]);
const ALIASES = pageAliases();

const writes = [];
const errors = [];
/** Which ids `/api/question` was asked for, in order. */
const asked = [];
const answered = new Set();
const real = () => writes.filter((w) => w.path !== '/api/presence');

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const json = (body, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (p === '/api/questions') {
      return json({
        // An answered question stays answered across a poll, as the tracker would have it.
        questions: QUESTIONS.filter((q) => !answered.has(q.id)),
        requests: [],
        workspaces: [WS],
        spaces: [],
        filter: { space: 'all', workspace: 'all' },
        rootboard: board(),
        summary: { sessions: 0, proposals: 0 },
        scope: 'human',
      });
    }
    if (p === '/api/question') {
      const id = url.searchParams.get('id');
      asked.push(id);
      const q = QUESTIONS.find((x) => x.id === id);
      return void setTimeout(() => json({ ...q, comments: [], gate: null }), 150);
    }
    if (req.method === 'POST' && p.startsWith('/api/')) {
      let body = '';
      req.on('data', (c) => (body += c));
      return void req.on('end', () => {
        const record = { path: p, ...JSON.parse(body || '{}') };
        (p === '/api/error' ? errors : writes).push(record);
        if (p === '/api/respond') answered.add(record.id);
        json({ ok: true });
      });
    }
    if (p.startsWith('/api/')) return json({});

    const rel = aliasPage(p, ALIASES).replace(/^\/+/, '');
    if (BASELINE && BASELINED.includes(`/${rel}`)) {
      res.writeHead(200, { 'content-type': TYPES[path.extname(rel)] });
      return res.end(committed(`public/${rel}`));
    }
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('no');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* -------------------------------------------------------------------- run */

const results = [];
const check = (name, ok, detailText) => {
  results.push({ name, ok });
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detailText ? ` — ${detailText}` : ''}`);
};

const server = await serve();
const BASE = `http://127.0.0.1:${server.address().port}`;
const { s, close } = await launchChrome('beadcause-p0askschain-');

const evalJs = async (expr) => {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw new Error(`${r.exceptionDetails.exception?.description || 'eval failed'}\n  in: ${expr.slice(0, 140)}`);
  return r.result.value;
};

const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 100; i++) {
    if (await evalJs(expr)) return true;
    await sleep(100);
  }
  return false;
};

const shot = async (name) => {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, `p0askschain-${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`    → ${file}`);
};

const OPEN_KEY = `document.querySelector('.card.open')?.dataset.key || null`;
const openIs = (id) => `(${OPEN_KEY}) === ${JSON.stringify(`${WS}/${id}`)}`;

/** Type an answer into the open card and send it, the way a thumb would. */
const ANSWER_OPEN = (text) => `(() => {
  const card = document.querySelector('.card.open');
  const box = card?.querySelector('[data-role="answer"]');
  const send = card?.querySelector('.primary[data-act="answer"]');
  if (!box || !send) return false;
  box.value = ${JSON.stringify(text)};
  box.dispatchEvent(new Event('input', { bubbles: true }));
  send.click();
  return true;
})()`;

try {
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: VP.width, height: VP.height, deviceScaleFactor: VP.dpr,
    mobile: true, screenWidth: VP.width, screenHeight: VP.height,
  });
  await s.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  console.log(`\n${BASELINE ? 'BASELINE (HEAD)' : 'working copy'} · ${VP.width}x${VP.height} · ${BASE}\n`);

  await s.send('Page.navigate', { url: `${BASE}/?t=${TOKEN}&kind=epics` });
  await waitFor(`document.querySelector('.p0-card') !== null`, 15000);
  await evalJs(`document.querySelector('.p0-card .p0-tap').click()`);
  await waitFor(`document.querySelectorAll('.p0-full .p0-row').length >= 5`, 4000);
  await sleep(600);
  await shot('effort');

  /* ---- 1. the first two are preloaded, and only those ---- */
  check(
    'opening the effort preloads the first two questions, in tree order',
    JSON.stringify(asked) === JSON.stringify(IDS.slice(0, 2)),
    JSON.stringify(asked)
  );

  /* ---- 2. the row is the card ---- */
  const before = asked.length;
  await evalJs(`document.querySelector('[data-p0bead="${WS}/${IDS[0]}"]').click()`);
  await waitFor(openIs(IDS[0]), 3000);
  await sleep(300);
  await shot('first-open');
  check('tapping an "asks you" row opens its question card', await evalJs(openIs(IDS[0])), String(await evalJs(OPEN_KEY)));
  check(
    'and the bead details do not unfold under the row instead',
    (await evalJs(`document.querySelector('.p0-bead') === null`)) === true
  );
  check(
    'and it needed no fetch of its own — the preload had it',
    !asked.slice(before).includes(IDS[0]),
    JSON.stringify(asked.slice(before))
  );

  /* ---- 3. answering opens the next, and fetches the one after ---- */
  check('the card can be answered', await evalJs(ANSWER_OPEN('Keep it.')));
  await waitFor(openIs(IDS[1]), 3000);
  await sleep(500);
  await shot('second-open');
  check('answering it opens the next question', await evalJs(openIs(IDS[1])), String(await evalJs(OPEN_KEY)));
  check(
    'and the one after it is fetched, skipping the bead that asks nothing',
    asked.includes(IDS[2]) && !asked.includes(PLAIN),
    JSON.stringify(asked)
  );

  await evalJs(ANSWER_OPEN('Drop it.'));
  await waitFor(openIs(IDS[2]), 3000);
  await sleep(500);
  check('and the next, past the ordinary bead', await evalJs(openIs(IDS[2])), String(await evalJs(OPEN_KEY)));
  check('with the last one now fetched ahead', asked.includes(IDS[3]), JSON.stringify(asked));

  await evalJs(ANSWER_OPEN('Keep it.'));
  await waitFor(openIs(IDS[3]), 3000);
  await sleep(300);
  check('and the last', await evalJs(openIs(IDS[3])), String(await evalJs(OPEN_KEY)));

  /* ---- 4. the last answer leaves you on the tree ---- */
  await evalJs(ANSWER_OPEN('Drop it.'));
  await sleep(800);
  await shot('done');
  check('answering the last one leaves no card open', (await evalJs(OPEN_KEY)) === null, String(await evalJs(OPEN_KEY)));
  check('and the effort is still up underneath', await evalJs(`document.querySelector('.p0-full') !== null`));
  await waitFor(`false`, 600);
  const responds = real().filter((w) => w.path === '/api/respond').map((w) => w.id);
  check('four answers written, one per question, in order', JSON.stringify(responds) === JSON.stringify(IDS), JSON.stringify(responds));
  check('and nothing else written', real().length === 4, JSON.stringify(real().map((w) => w.path)));
  check('each question fetched once', new Set(asked).size === asked.length, JSON.stringify(asked));
  check('and the page reported no errors', errors.length === 0, JSON.stringify(errors).slice(0, 300));
} finally {
  if (!KEEP) close();
  server.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed\n`);
process.exit(bad.length ? 1 : 0);
