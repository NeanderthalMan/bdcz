#!/usr/bin/env node
/**
 * The router keeps a candidate backend standing beside the live one — bc-sj8k.1.
 *
 *     npm test
 *     node test/routergreen.mjs
 *
 * DemoMode (bc-sj8k) serves an open pull request on *green* beside the live build on
 * *blue*. This is the supervision half: `bringUpGreen` in bin/router.js spawns a second
 * backend from a candidate worktree (lib/candidate.js) and keeps it up, rather than
 * handing over and draining the way a blue swap does.
 *
 * A real router and a real blue (`bin/beadcause.js`, scratch config, `bd` stubbed), as
 * test/routerdrain.mjs has them. The candidates are not real pull requests — preparing
 * one needs GitHub — but the router reads nothing of a candidate beyond its record and
 * the `bin/beadcause.js` in its tree, so each is a record plus a stub backend that
 * answers `/internal/state`. `BEADCAUSE_CANDIDATE_ROOT` points the router at a scratch
 * git repo holding them, because a real checkout's `.claude/candidates/` is not a test's
 * to write in.
 *
 * The claims, in the bead's own words:
 *
 *   1. it refuses to spawn from a candidate lib/candidate.js reports as unservable — and
 *      from one nothing prepared — before any process exists;
 *   2. two backends run at once, from different checkouts, on different ports;
 *   3. a swap of blue does not take green with it;
 *   4. a candidate that fails to boot is condemned and says why, blue keeps serving, and
 *      the green already standing stays standing; asking for it again is refused;
 *   5. green going away — its process dying, its worktree torn down, or by hand — is a
 *      loud drop, never a silent one, and never touches blue;
 *   6. `--status` prints the green line.
 *
 * And the routing half, bc-sj8k.8:
 *
 *   7. one device flips to green by cookie while another stays on blue, on the same URL,
 *      for ordinary requests and for upgrades alike;
 *   8. `/__demo/blue` is the router's own, so it takes a device home from a candidate that
 *      has never heard of DemoMode (every stub here is one);
 *   9. a device whose candidate has gone is served blue, not an error, and its cookie is
 *      taken off.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/net.mjs';
import { removeTree, removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TOKEN = 'test-token-not-a-secret';

let failures = 0;
let ran = 0;
// Each failure again after the router log, because the gate keeps only the last ~2KB of a
// suite's output and the router log is longer than that: without the repeat, every red
// run of this suite on main read "1 of 11 failed" and never said which one (bc-kiw8u).
const failed = [];
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n').slice(0, 6).join('\n      ')}`);
    failed.push(`${name} — ${String(err.message).split('\n').slice(0, 3).join(' / ')}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One request, on a connection of its own (`agent: false`). Node 19+ pools keep-alive
 * sockets by default and the router closes an idle one after 5s; `routerStatus()` is a
 * spawnSync that blocks this loop, so under the full gate it outlasted those 5s and the
 * next request went out on a socket the router had already closed — `socket hang up`
 * on every red main run of 2026-10-05 (bc-8ktjl).
 */
function request(port, pathname, { method = 'GET', timeout = 30000, cookie = null, accept = null } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-beadcause-token': TOKEN };
    if (cookie) headers.cookie = cookie;
    if (accept) headers.accept = accept;
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers, agent: false },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    req.setTimeout(timeout, () => req.destroy(new Error(`timed out after ${timeout}ms`)));
    req.on('error', reject);
    req.end();
  });
}

async function waitFor(label, fn, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const got = await fn();
      if (got) return got;
    } catch {
      /* not yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(150);
  }
}

/**
 * An upgrade through the router; resolves with the status line the far side sent back.
 * Blue's real terminal refuses an upgrade with no token by hanging up, so a hang-up is
 * an answer here too (`status: null`), not a failure: what these checks ask is only
 * *which* backend answered.
 */
function upgrade(port, pathname, { cookie = null } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { connection: 'Upgrade', upgrade: 'websocket' };
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port, path: pathname, headers });
    req.setTimeout(10000, () => req.destroy(new Error('upgrade timed out')));
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode, headers: res.headers });
    });
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode, headers: res.headers });
    });
    req.on('error', (err) => (err.code === 'ECONNRESET' ? resolve({ status: null, headers: {} }) : reject(err)));
    req.end();
  });
}

/** The `name=value` half of a set-cookie line, the way a browser would send it back. */
const demoCookieOf = (res) => {
  const line = [].concat(res.headers['set-cookie'] || []).find((c) => c.startsWith('beadcause_demo='));
  return line ? line.split(';')[0] : null;
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/* ------------------------------------------------------------------- the candidates */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-routergreen-'));
const repo = path.join(dir, 'repo');
fs.mkdirSync(repo);
// lib/candidate.js finds its home through `git rev-parse --git-common-dir`.
const init = spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
const home = path.join(repo, '.claude', 'candidates');
fs.mkdirSync(home, { recursive: true });

const GOOD = 'routertest.pr1.aaaaaaaaaaaa';
const BROKEN = 'routertest.pr2.bbbbbbbbbbbb';
const UNSERVABLE = 'routertest.pr3.cccccccccccc';
const NEVER = 'routertest.pr9.999999999999';

/** A stub backend: the only thing a router asks of one is `/internal/state`. */
const stubBackend = (id) => `const http = require('node:http');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.url.startsWith('/internal/state')) return res.end(JSON.stringify({ build: 'stub-${id.slice(-4)}', role: 'standby', reaping: false }));
  res.end(JSON.stringify({ green: ${JSON.stringify(id)}, cwd: process.cwd() }));
}).on('upgrade', (req, socket) => {
  socket.end('HTTP/1.1 418 I am green\\r\\nx-green: ${id}\\r\\ncontent-length: 0\\r\\n\\r\\n');
}).listen(port, '127.0.0.1');
`;
const brokenBackend = `console.error('this candidate has a syntax error, as far as anyone can tell'); process.exit(1);\n`;

function candidate(id, { source, servable = true, unservable = null } = {}) {
  const tree = path.join(home, id);
  if (source) {
    fs.mkdirSync(path.join(tree, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'bin', 'beadcause.js'), source);
  } else {
    fs.mkdirSync(tree, { recursive: true });
  }
  const number = Number(/\.pr(\d+)\./.exec(id)[1]);
  fs.writeFileSync(
    path.join(home, `${id}.json`),
    JSON.stringify({ id, key: 'routertest', number, title: `pull request ${number}`, dir: tree, servable, unservable, preparedAt: new Date().toISOString() })
  );
  return tree;
}

candidate(GOOD, { source: stubBackend(GOOD) });
candidate(BROKEN, { source: brokenBackend });
candidate(UNSERVABLE, { servable: false, unservable: 'only 5 of its 7 browser bundles could be put in public/vendor' });

/* ------------------------------------------------------------------- a real router */

const stubBd = path.join(dir, 'bd');
fs.writeFileSync(stubBd, '#!/bin/sh\necho "[]"\n', { mode: 0o755 });

const port = await freePort();
fs.writeFileSync(
  path.join(dir, 'config.json'),
  JSON.stringify(
    {
      port,
      host: '127.0.0.1',
      baseUrl: `http://127.0.0.1:${port}`,
      token: TOKEN,
      bdBin: stubBd,
      actor: 'beadcause-test',
      healthTimeoutMs: 60000,
      drainMs: 400,
      openSessions: false,
      autoDispatch: false,
      claudeSessions: false,
      pollSeconds: 3600,
      ntfy: { enabled: false },
      advocates: { enabled: false, workspaces: [] },
    },
    null,
    2
  )
);

const env = { ...process.env, BEADCAUSE_CONFIG_DIR: dir, BEADCAUSE_CANDIDATE_ROOT: repo };
delete env.BEADCAUSE_OBSERVE;
delete env.BEADCAUSE_READONLY;

const routerLog = [];
const router = spawn(process.execPath, [path.join(ROOT, 'bin', 'router.js')], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [router.stdout, router.stderr]) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    for (const line of chunk.split('\n')) if (line.trim()) routerLog.push(line);
  });
}

const greenPids = new Set();
let tornDown = false;
async function teardown() {
  if (tornDown) return;
  tornDown = true;
  if (router.exitCode === null && !router.signalCode) {
    const gone = new Promise((resolve) => router.once('exit', resolve));
    router.kill('SIGTERM');
    const hard = setTimeout(() => router.kill('SIGKILL'), 5000);
    await gone;
    clearTimeout(hard);
  }
  // The router SIGTERMs its backends on the way out; a stub that somehow outlived it
  // would hold a port for ever, so make sure.
  await sleep(300);
  for (const pid of greenPids) if (alive(pid)) process.kill(pid, 'SIGKILL');
  await removeTree(dir);
}
process.on('exit', () => {
  if (tornDown) return;
  if (router.exitCode === null && !router.signalCode) router.kill('SIGKILL');
  for (const pid of greenPids) if (alive(pid)) process.kill(pid, 'SIGKILL');
  removeTreeSync(dir);
});
process.on('SIGINT', () => process.exit(130));

const state = async () => JSON.parse((await request(port, `/internal/router/state?t=${TOKEN}`, { timeout: 5000 })).body);
/**
 * `bin/router.js --status`, run the way somebody at a terminal runs it. It is a cold node
 * start that loads the router's whole import graph, which is about a second here and was
 * enough to blow a 15s cap with the full gate running beside it (bc-kiw8u). `why` is
 * what an assertion on it should say: how it ended, how long it took, and what it printed.
 */
function routerStatus() {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'router.js'), '--status'], { env, encoding: 'utf8', timeout: 60000 });
  const how = r.error ? r.error.message : r.signal ? `killed by ${r.signal}` : `exit ${r.status}`;
  const why = `--status: ${how} after ${Date.now() - started}ms\nstdout: ${r.stdout || '(none)'}\nstderr: ${r.stderr || '(none)'}`;
  return { status: r.status, stdout: r.stdout || '', why };
}

const askGreen = async (id) =>
  JSON.parse((await request(port, `/internal/router/green?id=${encodeURIComponent(id)}&t=${TOKEN}`, { method: 'POST' })).body);

try {
  await waitFor('a first backend to come up', async () => (await state()).active, 90000);
  const bluePid = (await state()).active.pid;

  await check('an unservable candidate is refused before any process exists, with its reason', async () => {
    const r = await askGreen(UNSERVABLE);
    assert.equal(r.ok, false);
    assert.match(r.error, /unservable — only 5 of its 7 browser bundles/);
    const s = await state();
    assert.equal(s.green, null);
    assert.equal(s.greenLast.outcome, 'refused');
    assert.equal(s.active.pid, bluePid, 'a refusal touched blue');
    assert.ok(!routerLog.some((l) => l.includes(`${UNSERVABLE} (green)`)), 'something was spawned for it');
  });

  await check('a candidate nothing prepared is refused too', async () => {
    const r = await askGreen(NEVER);
    assert.equal(r.ok, false);
    assert.match(r.error, /no candidate .* is prepared/);
    const bad = await askGreen('../../etc');
    assert.equal(bad.ok, false);
    assert.match(bad.error, /is not a candidate id/);
  });

  let greenPid;
  await check('two backends run at once, from different checkouts, on different ports', async () => {
    const r = await askGreen(GOOD);
    assert.equal(r.ok, true, `green did not come up: ${r.error}`);
    greenPid = r.green.pid;
    greenPids.add(greenPid);
    const s = await state();
    assert.equal(s.green.id, GOOD);
    assert.equal(s.green.number, 1);
    assert.notEqual(s.green.pid, s.active.pid);
    assert.notEqual(s.green.port, s.active.port);
    assert.equal(s.active.pid, bluePid, 'bringing up green replaced blue');
    // Green answers on its own port, from its own tree.
    const direct = JSON.parse((await request(s.green.port, '/anything')).body);
    assert.equal(direct.green, GOOD);
    assert.equal(fs.realpathSync(direct.cwd), fs.realpathSync(path.join(home, GOOD)));
    // Asking again for the one already standing is a no-op, not a second process.
    const again = await askGreen(GOOD);
    assert.equal(again.green.pid, greenPid);
  });

  let onGreen;
  await check('one device flips to green by cookie while another stays on blue, on the same URL', async () => {
    const before = await request(port, '/api/health');
    assert.equal(before.headers['x-beadcause-env'], 'blue');

    const flip = await request(port, `/__demo/green?id=${encodeURIComponent(GOOD)}`);
    assert.equal(flip.status, 303);
    assert.equal(flip.headers.location, '/');
    onGreen = demoCookieOf(flip);
    assert.equal(onGreen, `beadcause_demo=${encodeURIComponent(GOOD)}`);
    assert.match(flip.headers['set-cookie'].join('\n'), /HttpOnly; SameSite=Lax; Max-Age=\d+/);

    // The flipped device, alongside an ordinary session cookie of its own.
    const mine = await request(port, '/api/health', { cookie: `beadcause_session=x; ${onGreen}` });
    assert.equal(mine.headers['x-beadcause-env'], 'green');
    assert.equal(mine.headers['x-beadcause-candidate'], GOOD);
    assert.equal(mine.headers['x-beadcause-pid'], String(greenPid));
    assert.equal(JSON.parse(mine.body).green, GOOD);

    // Another device, same URL, no cookie: still blue.
    const theirs = await request(port, '/api/health');
    assert.equal(theirs.headers['x-beadcause-env'], 'blue');
    assert.equal(theirs.headers['x-beadcause-pid'], String((await state()).active.pid));

    // A terminal opened from the flipped device is green's terminal.
    const up = await upgrade(port, '/ws/terminal', { cookie: onGreen });
    assert.equal(up.status, 418);
    assert.equal(up.headers['x-green'], GOOD);
    const blueUp = await upgrade(port, '/ws/terminal');
    assert.notEqual(blueUp.status, 418, 'an upgrade with no cookie reached green');

    // Asking for a candidate that is not standing is refused, and sets nothing.
    const wrong = await request(port, `/__demo/green?id=${encodeURIComponent(NEVER)}`);
    assert.equal(wrong.status, 409);
    assert.match(JSON.parse(wrong.body).error, /is not on green — .* is/);
    assert.equal(demoCookieOf(wrong), null);
  });

  await check('/__demo/blue is the router\'s own, and takes a device home from a candidate that never heard of it', async () => {
    // The stub on green answers every path with its own JSON. If this reached it, the body
    // would say so and no cookie would be cleared.
    const home = await request(port, '/__demo/blue', { cookie: onGreen });
    assert.equal(home.status, 303);
    // To DemoMode's list, with the candidate it came back from named so the list puts it
    // first (bc-sj8k.2) — the return trip lands on the page that sent it, not the inbox.
    assert.equal(home.headers.location, `/demo?from=${GOOD}`);
    assert.equal(home.headers['x-beadcause-env'], 'blue');
    assert.equal(demoCookieOf(home), 'beadcause_demo=');
    assert.match([].concat(home.headers['set-cookie']).join('\n'), /Max-Age=0/);
    assert.ok(!home.body.includes(GOOD), 'the escape was proxied to green');
    // The device's next request, cookie gone, is blue.
    const next = await request(port, '/api/health');
    assert.equal(next.headers['x-beadcause-env'], 'blue');
    // With no cookie it is still the way to the list; a cookie that is not an id's shape
    // is not echoed onto the address.
    assert.equal((await request(port, '/__demo/blue')).headers.location, '/demo');
    const odd = await request(port, '/__demo/blue', { cookie: 'beadcause_demo=%2F%2Fevil.example%3Fx' });
    assert.equal(odd.headers.location, '/demo');
    // An upgrade cannot be the hole in the router's own namespace either.
    assert.equal((await upgrade(port, '/__demo/blue', { cookie: onGreen })).status, 404);
  });

  await check('a swap of blue does not take green with it', async () => {
    const swap = JSON.parse((await request(port, `/internal/router/swap?t=${TOKEN}`, { method: 'POST' })).body);
    assert.equal(swap.ok, true, `swap failed: ${swap.error}`);
    assert.notEqual(swap.active.pid, bluePid, 'the swap did not change blue');
    await sleep(800); // past drainMs, so the old blue has actually been stopped
    const s = await state();
    assert.equal(s.green?.pid, greenPid, 'green was not the same process after the swap');
    assert.ok(alive(greenPid), 'green was killed by the swap');
    assert.ok(!alive(bluePid) || s.retiring.some((b) => b.pid === bluePid), 'the old blue was neither stopped nor draining');
  });

  await check('a candidate that will not boot is condemned, blue keeps serving, and green stays standing', async () => {
    const blueNow = (await state()).active.pid;
    const r = await askGreen(BROKEN);
    assert.equal(r.ok, false);
    assert.match(r.error, /exited before it was healthy \(code 1\)/);
    const s = await state();
    assert.equal(s.greenLast.id, BROKEN);
    assert.equal(s.greenLast.outcome, 'condemned');
    assert.deepEqual(s.greenCondemned, [BROKEN]);
    assert.equal(s.active.pid, blueNow, 'a broken candidate took blue down');
    assert.equal(s.poisoned, null, 'a broken candidate poisoned blue');
    assert.equal(s.green?.pid, greenPid, 'the green already standing was dropped for a candidate that never came up');
    assert.ok(routerLog.some((l) => l.includes(`green: candidate ${BROKEN} is condemned`)));

    const again = await askGreen(BROKEN);
    assert.equal(again.ok, false);
    assert.match(again.error, /was condemned/);
  });

  await check('green dying on its own is a loud drop, and blue is untouched', async () => {
    const blueNow = (await state()).active.pid;
    process.kill(greenPid, 'SIGKILL');
    const s = await waitFor('green to be dropped', async () => {
      const st = await state();
      return st.green === null && st.greenLast?.outcome === 'dropped' ? st : null;
    }, 20000);
    assert.match(s.greenLast.why, /exited \(SIGKILL\)/);
    assert.equal(s.active.pid, blueNow, 'green dying replaced blue');
    assert.ok(routerLog.some((l) => l.includes(`green: DROPPED candidate ${GOOD} (pid ${greenPid})`)));
  });

  await check('a browser navigation to a flip gets the shell-refresh interstitial, with the cookie set, not a bare 303', async () => {
    const r = await request(port, '/__demo/blue', { accept: 'text/html', cookie: onGreen });
    assert.equal(r.status, 200);
    assert.equal(demoCookieOf(r), 'beadcause_demo=');
    assert.equal(r.headers['x-beadcause-env'], 'blue');
    assert.match(r.body, /beadcause:sw-refresh/);
    // And it lands where the 303 would have: blue's way home is DemoMode's list (bc-sj8k.2).
    assert.ok(r.body.includes(`location.replace("/demo?from=${GOOD}")`), r.body);
    assert.ok(r.body.includes(`url=/demo?from=${GOOD}"`), r.body);
  });

  await check('a device whose candidate has gone is served blue, not an error, and its cookie comes off', async () => {
    const r = await request(port, '/api/health', { cookie: onGreen });
    assert.equal(r.status, 200, `a device on a dead candidate got ${r.status}: ${r.body.slice(0, 200)}`);
    assert.equal(r.headers['x-beadcause-env'], 'blue');
    assert.equal(r.headers['x-beadcause-pid'], String((await state()).active.pid));
    assert.equal(demoCookieOf(r), 'beadcause_demo=');
    // So does its terminal: blue's, not a refusal.
    assert.notEqual((await upgrade(port, '/ws/terminal', { cookie: onGreen })).status, 418);
    // And the way onto it now says why not, in HTML for a phone.
    const flip = await request(port, `/__demo/green?id=${encodeURIComponent(GOOD)}`, { accept: 'text/html' });
    assert.equal(flip.status, 409);
    assert.match(flip.body, /nothing is standing there/);
    assert.match(flip.body, /href="\/"/);
  });

  await check('a green whose worktree is torn down is dropped on the next heartbeat', async () => {
    const r = await askGreen(GOOD);
    assert.equal(r.ok, true, `green did not come back: ${r.error}`);
    greenPids.add(r.green.pid);
    fs.rmSync(path.join(home, GOOD), { recursive: true, force: true });
    const s = await waitFor('the heartbeat to notice', async () => {
      const st = await state();
      return st.green === null ? st : null;
    }, 45000);
    assert.equal(s.greenLast.outcome, 'dropped');
    assert.match(s.greenLast.why, /was torn down/);
    await waitFor('its process to be stopped', async () => !alive(r.green.pid), 20000);
  });

  await check('dropping by hand, and --status says what is on green', async () => {
    candidate(GOOD, { source: stubBackend(GOOD) });
    const r = await askGreen(GOOD);
    assert.equal(r.ok, true, `green did not come back: ${r.error}`);
    greenPids.add(r.green.pid);

    const status = routerStatus();
    assert.equal(status.status, 0, status.why);
    assert.match(status.stdout, new RegExp(`^green    ${GOOD.replace(/\./g, '\\.')} — pid ${r.green.pid} `, 'm'));

    const drop = JSON.parse((await request(port, `/internal/router/green/drop?t=${TOKEN}`, { method: 'POST' })).body);
    assert.equal(drop.dropped, GOOD);
    const s = await state();
    assert.equal(s.green, null);
    assert.equal(s.greenLast.why, 'dropped by hand');
    await waitFor('the dropped green to be stopped', async () => !alive(r.green.pid), 20000);

    const after = routerStatus();
    assert.match(after.stdout, /^green    \(none\) — .* dropped: dropped by hand$/m, after.why);
  });
} catch (err) {
  failures += 1;
  console.log(`\n  \x1b[31mthe run itself\x1b[0m\n      ${err.stack || err.message}`);
  failed.push(`the run itself — ${String(err.message).split('\n')[0]}`);
} finally {
  await teardown();
}

if (failures) {
  console.log('\n--- router log ---');
  for (const line of routerLog) console.log(`  ${line}`);
  console.log('\n--- failed ---');
  for (const line of failed) console.log(`  ${line}`);
}
console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n\x1b[32mall ${ran} checks passed\x1b[0m\n`);
process.exit(failures ? 1 : 0);
