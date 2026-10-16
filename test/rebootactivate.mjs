#!/usr/bin/env node
/**
 * The reboot resume runs when a standby is promoted — bc-5to5r.1 — and the session
 * register starts and stops with the poller.
 *
 *     npm test
 *     node test/rebootactivate.mjs
 *
 * **The failure this pins.** bin/beadcause.js ran `resumeAfterReboot` only when the
 * process did *not* start with `--standby`. Under bin/router.js every backend starts as a
 * standby and is promoted through `/internal/activate`, which restarted the poller, the
 * terminals, the reaper and Slack and never the reboot resume. So in production bc-5to5r
 * was dead code: zero `[reboot]` lines in `~/Library/Logs/beadcause.log`, ever, across a
 * fortnight of boots. test/rebootresume.mjs could not see it, because it calls the function
 * and the function was fine; the bug was in who called it.
 *
 * So this drives the real thing: a real `bin/beadcause.js --port <N> --standby` on an
 * isolated config directory, promoted the way the router promotes it, and watched for the
 * two facts the bug hid — the `[reboot]` line in its output and `rebootResumedAt` in its
 * state file. Then promoted again, to see that one process runs it once. Then stood down,
 * to see the register poll stop.
 *
 * What it cannot assert is that a window opens. The pass on this machine is either late
 * (an uptime of hours: "noted, and nothing resumed") or fresh with nothing to find (an empty
 * transcripts directory: "no conversation was open"), and either way exactly one `[reboot]`
 * line comes out and nothing is opened — which is also what `BEADCAUSE_NO_LAUNCH` would
 * have guaranteed. The decision itself is test/rebootresume.mjs's; this is the wiring.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/net.mjs';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BACKEND = path.join(ROOT, 'bin', 'beadcause.js');
const TOKEN = 'test-token-not-a-secret';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-rebootactivate-'));
const stubBd = path.join(dir, 'bd');
fs.writeFileSync(stubBd, '#!/bin/sh\necho "[]"\n', { mode: 0o755 });
for (const sub of ['projects', 'sessions']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
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
      openSessions: false,
      autoDispatch: false,
      // Pointed at empty directories of this suite's own, not at this Mac's: the pass must
      // find nothing to bring back, and the register must see no windows.
      claudeProjectsDir: path.join(dir, 'projects'),
      claudeSessionsDir: path.join(dir, 'sessions'),
      pollSeconds: 3600,
      ntfy: { enabled: false },
      advocates: { enabled: false, workspaces: [] },
    },
    null,
    2
  )
);

const env = {
  ...process.env,
  BEADCAUSE_CONFIG_DIR: dir,
  // Belt and braces: the pass should have nothing to open, and if it ever did, this is a
  // suite. scripts/test.mjs sets it for every child; `node test/rebootactivate.mjs` by hand
  // does not, and the backend's own argv[1] is bin/, not test/.
  BEADCAUSE_NO_LAUNCH: '1',
  // Fast, so stopping can be seen. See the knob's note in bin/beadcause.js.
  BEADCAUSE_REGISTER_POLL_MS: '150',
};

const backendPort = await freePort();
let out = '';
const child = spawn(process.execPath, [BACKEND, '--port', String(backendPort), '--standby'], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => (out += c));
child.stderr.on('data', (c) => (out += c));
const gone = new Promise((resolve) => child.on('exit', resolve));

function call(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: backendPort, path: pathname, method, headers: { 'x-beadcause-token': TOKEN } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.setTimeout(5000, () => req.destroy(new Error('timed out')));
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
    if (child.exitCode !== null) throw new Error(`the backend exited (${child.exitCode}) while waiting for ${label}:\n${out}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}:\n${out}`);
    await sleep(50);
  }
}

const rebootLines = () => out.split('\n').filter((l) => l.includes('[reboot]'));
const statePath = path.join(dir, 'state.json');
const registerPath = path.join(dir, 'sessions.json');
const state = () => {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return {};
  }
};
const polledAt = () => {
  try {
    return JSON.parse(fs.readFileSync(registerPath, 'utf8')).polledAt || null;
  } catch {
    return null;
  }
};

try {
  console.log('bin/beadcause.js — the reboot resume runs at promotion, once, and the register polls while active\n');

  await waitFor('the standby to answer', async () => (await call('/internal/state')).status === 200, 30000);
  // Give a wrongly-wired startup time to have done it anyway.
  await sleep(400);
  check('a standby runs no reboot resume', rebootLines().length === 0, rebootLines().join('\n'));
  check('and stamps no boot', state().rebootResumedAt === undefined, JSON.stringify(state()));
  check('and polls no register', polledAt() === null, String(polledAt()));

  const promoted = await call('/internal/activate', 'POST');
  check('promotion is acknowledged', promoted.status === 200 && JSON.parse(promoted.body).role === 'active', promoted.body);

  await waitFor('the [reboot] line after promotion', () => rebootLines().length >= 1, 15000);
  check('the promoted backend ran the reboot resume', rebootLines().length === 1, rebootLines().join('\n'));
  check(
    'it either found a fresh boot with nothing open, or declined a late start — and said which',
    /noted, and nothing resumed|no conversation was open/.test(rebootLines()[0]),
    rebootLines()[0]
  );
  await waitFor('the boot stamp', () => typeof state().rebootResumedAt === 'string', 5000);
  const stamp = state().rebootResumedAt;
  check('and stamped the boot in the state file', Number.isFinite(Date.parse(stamp)), String(stamp));
  check(
    'the stamp is this machine\'s boot, not the clock',
    Math.abs(Date.parse(stamp) - (Date.now() - os.uptime() * 1000)) < 60_000,
    `${stamp} vs uptime ${os.uptime()}s`
  );
  check('nothing opened a window', !/brought back|status window/.test(out), out);

  const first = await waitFor('the register poll', () => polledAt(), 5000);
  check('the register is polled once active', Boolean(first), String(first));
  await waitFor('a second poll', () => polledAt() !== first, 5000);
  check('and keeps being polled', polledAt() !== first);

  const again = await call('/internal/activate', 'POST');
  check('a second promotion is acknowledged', again.status === 200, again.body);
  await sleep(500);
  check('and runs the reboot resume no second time', rebootLines().length === 1, rebootLines().join('\n'));

  const down = await call('/internal/standby', 'POST');
  check('standing down is acknowledged', down.status === 200 && JSON.parse(down.body).role === 'standby', down.body);
  await sleep(400);
  const atStandDown = polledAt();
  await sleep(600);
  check('the register poll stops with the poller', polledAt() === atStandDown, `${atStandDown} → ${polledAt()}`);

  const back = await call('/internal/activate', 'POST');
  check('promoted again, the register poll resumes', back.status === 200);
  await waitFor('a poll after re-promotion', () => polledAt() !== atStandDown, 5000);
  check('and the reboot resume still ran only once in this process', rebootLines().length === 1, rebootLines().join('\n'));
} catch (err) {
  failures++;
  console.log(`FAIL  ${err.message}`);
} finally {
  child.kill('SIGKILL');
  await gone;
  removeTreeSync(dir);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
