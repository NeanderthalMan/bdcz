#!/usr/bin/env node
/**
 * A tracker too slow to read is an answer on the graph, not a 500.
 *
 *     npm test
 *     node test/graphslowtracker.mjs
 *
 * bc-h4y6d — the same shape as bc-4jkjv (test/prslowtracker.mjs), on `/api/graph`. When
 * one workspace's Dolt cannot be read, every `bd` call against it spends the full
 * `BD_TIMEOUT` and is killed:
 *
 *     11:39:12.427Z  bd graph --html lm-gr6 … timed out in loremia: still running after 120s
 *     11:39:12.427Z  slow GET /api/graph 120045ms cold
 *     11:39:13.094Z  error created beadcause/bc-h4y6d — api/graph — GET /api/graph failed — HTTP 500
 *
 * public/report.js files a sev2 P0 for any status `>= 500`, so the route answers 200
 * with an empty graph and a sentence in `unavailable` instead, and public/graph.js
 * draws that sentence rather than "Nothing open here".
 *
 * Driven over real HTTP against `createApp`, for both forms of the route: `?id=` (a
 * direct `bd graph --html <id>`, which is the one that timed out) and the whole
 * workspace (through lib/graph.js's cached `workspaceGraph`, cold here). A `bd` that
 * failed for any other reason must still not become a 200.
 *
 * No tracker, and nothing here opens a window.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers/net.mjs';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (f) => path.join(HERE, '..', 'lib', f);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-graphslow-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

let failures = 0;
let ran = 0;
const check = (fn, name) => {
  ran += 1;
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${err.message}`);
  }
};

const ws = path.join(tmp, 'ws');
fs.mkdirSync(path.join(ws, '.beads'), { recursive: true });

// Never spawned on the route path — `graphHtml` is substituted below. It has to exist
// because `Bd` is constructed with it at `createApp` time.
const FAKE = path.join(tmp, 'bd');
fs.writeFileSync(FAKE, "#!/usr/bin/env node\nprocess.stdout.write('[]');\n", { mode: 0o755 });

const cfg = {
  port: 0,
  host: '127.0.0.1',
  baseUrl: 'http://127.0.0.1',
  token: 'graphslow-token',
  actor: 'beadcause-test',
  bdBin: FAKE,
  workspaces: [{ name: 'demo', dir: ws }],
  openSessions: false,
  autoDispatch: false,
  claudeSessions: false,
  pollSeconds: 3600,
  terminal: false,
  ntfy: { enabled: false },
  advocates: { enabled: false, workspaces: [] },
};

const { createApp, listen } = await import(LIB('server.js'));

const app = createApp(cfg);
const servers = listen(cfg, app.handler);
const port = await boundPort(servers);

const get = (pathname) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method: 'GET', headers: { 'x-beadcause-token': cfg.token } },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode, body: out, json: JSON.parse(out || '{}') }));
      }
    );
    req.on('error', reject);
    req.end();
  });

// The error `lib/bd.js` builds for a child it killed itself — command line, actor,
// email address and all. test/prslowtracker.mjs pins that `timedOut` is really set.
const TIMEOUT_MESSAGE =
  'bd graph --html bc-demo1 --actor beadcause (someone@example.com) timed out in demo: ' +
  'still running after 120s, killed rather than broken';

app.bd.listStatus = async () => [];

for (const [label, pathname] of [
  ['one bead', '/api/graph?workspace=demo&id=bc-demo1'],
  ['the whole workspace', '/api/graph?workspace=demo&refresh=1'],
]) {
  console.log(`\n${label}, against a tracker that did not answer\n`);
  app.bd.graphHtml = async () => {
    throw Object.assign(new Error(TIMEOUT_MESSAGE), { timedOut: true });
  };
  const slow = await get(pathname);
  check(() => assert.equal(slow.status, 200), 'answers 200 rather than a 500 the page would file a P0 for');
  check(
    () => assert.deepEqual([slow.json.nodes, slow.json.links], [[], []]),
    'with an empty graph, so an older cached graph.js still reads it without throwing'
  );
  check(
    () =>
      assert.ok(
        /did not answer in time/.test(String(slow.json.unavailable || '')) && /\bdemo\b/.test(slow.json.unavailable),
        `unavailable was ${JSON.stringify(slow.json.unavailable)}`
      ),
    'and a sentence in `unavailable` naming the slow workspace'
  );
  for (const leak of ['bd ', '--html', '@', 'killed rather than broken']) {
    check(
      () => assert.ok(!slow.body.includes(leak), `the body carried ${JSON.stringify(leak)}: ${slow.body.slice(0, 200)}`),
      `and none of bd's own message reaches the page — no ${JSON.stringify(leak)}`
    );
  }

  console.log(`\n${label}, against a tracker that answered and failed\n`);
  app.bd.graphHtml = async () => {
    throw new Error('bd graph --html bc-demo1 failed in demo: something else went wrong');
  };
  const broken = await get(pathname);
  check(
    () => assert.notEqual(broken.status, 200, `answered 200 with ${broken.body.slice(0, 160)}`),
    'a failure that is not a timeout is not swallowed into the same 200'
  );
}

console.log('\nthe page\n');

const page = fs.readFileSync(path.join(HERE, '..', 'public', 'graph.js'), 'utf8');
check(
  () => {
    const u = page.indexOf('if (data.unavailable) return fail(data.unavailable)');
    const empty = page.indexOf('if (!data.nodes.length)');
    assert.ok(u > 0 && empty > u, 'draw() does not check `unavailable` before the empty-graph branch');
  },
  'draw() paints `unavailable` before it can say "Nothing open here"'
);

for (const s of servers) s.close();
cleanupTmp(tmp);

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n\x1b[32mall ${ran} ok\x1b[0m\n`);
process.exit(failures ? 1 : 0);
