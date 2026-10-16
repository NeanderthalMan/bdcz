#!/usr/bin/env node
/**
 * GET /api/question for a bead that is gone is a 404 naming it — not a 500 carrying
 * bd's command line and the actor's email (bc-68ou.16, the bc-fggc shape: showWithComments
 * throws for a missing id, so a null check alone is dead).
 *
 *     node test/gonequestion.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LIB = (f) => path.join(ROOT, 'lib', f);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-gonequestion-'));
process.on('exit', () => cleanupTmp(tmp));

/* ------------------------------------------------------------------- the stub bd */

/**
 * `show` fails the way bd 1.2.1 actually fails, verbatim.
 *
 * Measured on this Mac on 2026-08-17: `bd show <missing> --json` exits **1**, writes
 * `Error fetching <id>: no issue found matching "<id>"` to stderr and a JSON error blob
 * to stdout. Both streams reach `detail` in lib/bd.js, so a stub that only wrote one of
 * them would test a message shape that never happens.
 */
const WORLD = path.join(tmp, 'world.json');
const FAKE_BD = path.join(tmp, 'bd');
fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const w = JSON.parse(fs.readFileSync(${JSON.stringify(WORLD)}, 'utf8'));
if (args[0] === 'show') {
  const issue = w[args[1]];
  if (!issue) {
    process.stderr.write('Error fetching ' + args[1] + ': no issue found matching "' + args[1] + '"\\n');
    process.stdout.write(JSON.stringify({ error: 'no issues found matching the provided IDs', schema_version: 1 }));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify([issue]));
  process.exit(0);
}
if (args[0] === 'comments') { process.stdout.write('[]'); process.exit(0); }
process.stdout.write('[]');
`,
  { mode: 0o755 }
);

fs.writeFileSync(
  WORLD,
  JSON.stringify({
    'zz-here': {
      id: 'zz-here',
      title: 'a bead that is still here',
      description: 'an ordinary question with no delivery on it',
      status: 'open',
      issue_type: 'task',
      priority: 2,
      labels: [],
    },
  })
);

/* --------------------------------------------------------------------- the daemon */

const wsDir = path.join(tmp, 'ws', '.beads');
fs.mkdirSync(wsDir, { recursive: true });

/**
 * The actor carries an address, because the leak *is* the address.
 *
 * Every assertion below that says "and nothing of bd's command line" checks for this
 * exact string, so a regression that goes back to raising bd's error verbatim fails on
 * the thing that matters rather than on a status code.
 */
const ACTOR = 'beadcause-test (nobody@example.com)';
const TOKEN = 'gonebead-token';
const cfg = {
  port: 0,
  host: '127.0.0.1',
  baseUrl: 'http://127.0.0.1',
  token: TOKEN,
  actor: ACTOR,
  bdBin: FAKE_BD,
  workspaces: [{ name: 'demo', dir: wsDir }],
  // `openSessions` must be on or POST /api/session is a 403 before it reads anything —
  // and the read is the whole of what is under test. The window still cannot come up:
  // `sessionDirs.demo` does not exist, the same guard test/endorse.mjs uses, and the
  // gone id never reaches that far anyway.
  openSessions: true,
  sessionDirs: { demo: path.join(tmp, 'no-such-checkout') },
  autoDispatch: false,
  claudeSessions: false,
  pollSeconds: 3600,
  terminal: false,
  ntfy: { enabled: false },
  advocates: { enabled: false, workspaces: [] },
};

const { createApp, listen } = await import(LIB('server.js'));
const { boundPort } = await import('./helpers/net.mjs');

const app = createApp(cfg);
const servers = listen(cfg, app.handler);
const port = await boundPort(servers);
cfg.port = port;
cfg.baseUrl = `http://127.0.0.1:${port}`;

/** `agent: false` for test/historyapi.mjs's reason: a kept-alive socket hangs `close()`. */
const ask = (method, pathname, body = null) =>
  new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method,
        agent: false,
        headers: {
          'x-beadcause-token': TOKEN,
          ...(payload === null
            ? {}
            : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (out += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(out || '{}');
          } catch {
            /* a non-JSON body is the assertion's problem */
          }
          resolve({ status: res.statusCode, json, raw: out });
        });
      }
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });

/* --------------------------------------------------------------------- harness */

let failed = 0;
const acheck = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
};

/** The one assertion both doors owe: a 404 that names the bead and leaks nothing. */
const saysOnlyTheBead = (res, id) => {
  assert.equal(res.status, 404, `expected 404, got ${res.status}: ${res.raw}`);
  const said = String(res.json?.error || '');
  assert.match(said, new RegExp(`no such bead: ${id}`), `it has to say which bead: ${said}`);
  assert.ok(!said.includes(ACTOR), `the actor's name and address must not be in the body: ${said}`);
  assert.ok(!/--actor/.test(said), `nor the flag that carries it: ${said}`);
  assert.ok(!/bd show/.test(said), `nor bd's command line: ${said}`);
  assert.ok(!/no issue found matching/.test(said), `nor bd's own wording, which says nothing to a phone: ${said}`);
};

/* --------------------------------------------------------------- GET /api/question */

await acheck('GET /api/question — a bead that is gone is a 404 naming it, not a 500 with bd’s command line', async () => {
  saysOnlyTheBead(await ask('GET', '/api/question?workspace=demo&id=zz-gone'), 'zz-gone');
});

await acheck('GET /api/question — a bead that is still there is still answered', async () => {
  const res = await ask('GET', '/api/question?workspace=demo&id=zz-here');
  assert.equal(res.status, 200, res.raw);
});

await acheck('no route in lib/server.js reads bd.showWithComments and then trusts a null', async () => {
  const src = fs.readFileSync(LIB('server.js'), 'utf8');
  const dead = [...src.matchAll(/await bd\.showWithComments\([^)]*\);\s*\n\s*if \(!issue\)/g)];
  assert.equal(dead.length, 0, `these null branches are dead: ${dead.map((m) => m[0].split('\n')[0].trim()).join(', ')}`);
});

/* --------------------------------------------------------------------- the result */

for (const s of servers) s.close();
console.log(failed ? `\n${failed} failed` : '\nall good');
process.exit(failed ? 1 : 0);
