#!/usr/bin/env node
/**
 * A bead that is gone is a 404 saying so — not a 500 carrying bd's command line.
 *
 *     npm test
 *     node test/gonebead.mjs
 *
 * bc-fggc, out of bc-s336. `bd show` **throws** for an id bd does not have; it does not
 * resolve null. So every door written as
 *
 *     const issue = await bd.show(ws, id);
 *     if (!issue) return json(res, 404, { error: 'not found' });
 *
 * has a null branch that can never fire, and the id that is gone falls out of the route's
 * catch-all as a 500 whose body is the whole failed command:
 *
 *     bd show zz-gone --json --actor beadcause (neo@example.com) failed in beadcause: …
 *
 * **The actor is a name and an email address**, because that is what wins over a
 * workspace `config.yaml` that pins a different one (lib/bd.js, `run`) — so the leak is
 * not an abstraction detail, it is a home address on a phone screen. `/api/pr` is where
 * it actually showed: `ensurePr` in public/app.js catches any non-200 and paints
 * `err.message` into the card's `unavailable` line, so a card that outlived its bead by
 * one poll drew it in plain sight and looked like a GitHub outage while doing it.
 *
 * `/api/handoff` was fixed in bc-s336 and pinned by test/handoffdoor.mjs; these two were
 * left because changing a door's status codes mid-ship deserves its own review. This is
 * that review, and what it pins is three things:
 *
 * 1. **Both doors answer 404 over real HTTP**, with a body that names the bead and
 *    nothing else. Asserted by driving the routes rather than by reading the source,
 *    because the fact under test is what reaches the phone.
 * 2. **The found path still works.** A 404 is easy to get right by refusing everything,
 *    so a bead that *is* there has to keep getting past the read to the answer it was
 *    always given — for `/api/pr`, "no beadpr block on this question".
 * 3. **No fourth door inherits the bug.** The dead `bd.show` + `if (!issue)` shape is
 *    scanned for across the whole of lib/server.js, because this bead exists precisely
 *    because that pattern was copied once already.
 *
 * **Nothing here opens a window**, and that is by construction rather than by luck.
 * `POST /api/session` is driven only with an id that is gone, and `loadBead` throws
 * above every line of that route that could reach iTerm — so a regression that put the
 * window first would fail this suite, not open one on whoever ran `npm test`.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-gonebead-'));
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

/* ------------------------------------------------------------------ GET /api/pr */

await acheck('GET /api/pr — a bead that is gone is a 404 naming it, not a 500 with bd’s command line', async () => {
  // This is the door the address actually reached a screen through: `ensurePr` paints
  // any non-200's message into the card's `unavailable` line, so the 500 body was drawn
  // where "could not reach GitHub" goes and read as an outage.
  saysOnlyTheBead(await ask('GET', '/api/pr?workspace=demo&id=zz-gone'), 'zz-gone');
});

await acheck('GET /api/pr — a bead that is still there gets past the read to its own answer', async () => {
  // A 404 is easy to get right by refusing everything. `zz-here` has no `beadpr` block,
  // so the route's *second* 404 is the correct one — and its different wording is the
  // proof that `loadBead` handed the issue back rather than throwing.
  const res = await ask('GET', '/api/pr?workspace=demo&id=zz-here');
  assert.equal(res.status, 404, res.raw);
  assert.match(String(res.json?.error || ''), /no beadpr block on this question/);
});

/* ------------------------------------------------------------- POST /api/session */

await acheck('POST /api/session — a bead that is gone is the same 404, and no window', async () => {
  // Safe to drive: `loadBead` throws above `endorse` and above `openSession`, so nothing
  // on this path can reach iTerm. If that ever stops being true this check fails first.
  saysOnlyTheBead(await ask('POST', '/api/session', { workspace: 'demo', id: 'zz-gone' }), 'zz-gone');
});

await acheck('POST /api/session — the guards that are cheaper than a tracker read still come first', async () => {
  // Ordering, not decoration: a body that is not a bead id must never become a command
  // line, and it must not cost a `bd` spawn to say so.
  const res = await ask('POST', '/api/session', { workspace: 'demo', id: 'not; a bead id' });
  assert.equal(res.status, 400, res.raw);
  assert.match(String(res.json?.error || ''), /not a bead id/);
});

/* -------------------------------------------------------------- and no fifth door */

await acheck('no route in lib/server.js still has the dead `bd.show` + `if (!issue)` shape', async () => {
  // The whole reason this bead exists: `/api/handoff` was written by copying
  // `/api/session` and inherited the bug with the pattern. Scanned for across the file
  // rather than asserted at three known lines, so the next door copied from these is
  // caught here instead of on a phone.
  const src = fs.readFileSync(LIB('server.js'), 'utf8');
  const dead = [...src.matchAll(/await bd\.show\([^)]*\);\s*\n\s*if \(!issue\)/g)];
  assert.equal(
    dead.length,
    0,
    `bd.show throws for a missing id, so these null branches are dead code and the id comes back a 500: ${dead
      .map((m) => m[0].split('\n')[0].trim())
      .join(', ')}`
  );
  // And the two doors this bead names read through the one place that knows bd's
  // spellings of "no such bead", the way `/api/handoff` already does.
  for (const [route, upto] of [
    ["if (p === '/api/pr' && req.method === 'GET')", '/api/pr/detail'],
    ["if (p === '/api/session' && req.method === 'POST')", "'/api/handoff'"],
  ]) {
    const from = src.indexOf(route);
    assert.ok(from > 0, `route not found: ${route}`);
    const door = src.slice(from, src.indexOf(upto, from));
    assert.match(door, /await loadBead\(bd, ws, id\)/, `${route} reads through loadBead`);
  }
});

/* --------------------------------------------------------------------- the result */

for (const s of servers) s.close();
console.log(failed ? `\n${failed} failed` : '\nall good');
process.exit(failed ? 1 : 0);
