#!/usr/bin/env node
/**
 * `GET /api/sessions` and `POST /api/sessions/resume` over the real server — bc-wsgj6.
 *
 *     npm test
 *     node test/sessionsapi.mjs
 *
 * Booted through the real `createApp`, for test/routes.mjs's reason: a contract checked
 * against a fake server is green while the real one answers something else. What is
 * pinned, and why each would be a silent lie:
 *
 * 1. **The list decides `unresolved` per row, and the count agrees with the rows.** The
 *    phone's "resume N sessions" and the monitor's pane read the same payload; a count that
 *    drifted from the rows would offer a button that does something else.
 * 2. **`?workspace=` narrows, and an unknown name is a 400** — never an empty list, which is
 *    indistinguishable from a workspace with nothing set aside.
 * 3. **The resume goes through the plan and writes the report.** This process is a suite, so
 *    lib/launchguard.js refuses the window at the one line that would open it; the route
 *    must turn that into a `failed` row with the refusal in it, keep the `skipped` row for a
 *    directory that is gone, answer 200, and leave `resumeReport` in the state for the
 *    register poll's name restore to read. A route that threw instead would be a monitor
 *    key that says "could not resume" over a report that was never written.
 * 4. **Both are behind the token like everything under `/api`.**
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-sessionsapi-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });
process.on('exit', () => removeTreeSync(tmp));

let failures = 0;
const acheck = async (name, fn) => {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${String(err?.message || err).split('\n').slice(0, 4).join('\n      ')}`);
  }
};
const assert = (ok, why) => {
  if (!ok) throw new Error(why);
};

/* ------------------------------------------------------------------ the fixture */

const id = (n) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`;
const projectRoot = path.join(tmp, 'projects');
const repo = path.join(projectRoot, 'demo');
const worktree = path.join(repo, '.claude', 'worktrees', 'set-aside-k4t');
const gone = path.join(repo, '.claude', 'worktrees', 'retired-x9q'); // never created
const wsDir = path.join(tmp, 'ws');
const claudeProjects = path.join(tmp, 'claude', 'projects');
const claudeSessions = path.join(tmp, 'claude', 'sessions');
for (const d of [worktree, path.join(wsDir, '.beads'), claudeProjects, claudeSessions]) fs.mkdirSync(d, { recursive: true });

const line = (rec) => `${JSON.stringify(rec)}\n`;
const transcript = (n, cwd, title, ageMs) => {
  const folder = path.join(claudeProjects, cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${id(n)}.jsonl`);
  fs.writeFileSync(file, (title ? line({ type: 'custom-title', customTitle: title }) : '') + line({ type: 'assistant', cwd }));
  const at = (Date.now() - ageMs) / 1000;
  fs.utimesSync(file, at, at);
};
transcript(1, worktree, 'demo - set aside this morning', 3_600_000);
transcript(2, repo, 'DONE-demo - shipped', 3_600_000);
transcript(3, repo, '', 3_600_000);
transcript(4, gone, 'demo - on a retired worktree', 7_200_000);

const FAKE = path.join(tmp, 'fake-bd');
fs.writeFileSync(FAKE, '#!/usr/bin/env node\nprocess.stdout.write("[]");\n', { mode: 0o755 });

const TOKEN = 'sessionsapi-token';
const cfg = {
  port: 0,
  host: '127.0.0.1',
  baseUrl: 'http://127.0.0.1',
  token: TOKEN,
  actor: 'beadcause-test',
  bdBin: FAKE,
  projectRoot,
  workspaces: [{ name: 'demo', dir: path.join(wsDir, '.beads') }],
  claudeSessionsDir: claudeSessions,
  claudeProjectsDir: claudeProjects,
  autoDispatch: false,
  pollSeconds: 3600,
  terminal: false,
  ntfy: { enabled: false },
  advocates: { enabled: false, workspaces: [] },
};

const { createApp, listen } = await import(path.join(ROOT, 'lib', 'server.js'));
const { boundPort } = await import('./helpers/net.mjs');
const { loadState } = await import(path.join(ROOT, 'lib', 'config.js'));

const app = createApp({ ...cfg });
const servers = listen({ ...cfg }, app.handler);
const port = await boundPort(servers);

const ask = (method, p, body = null, headers = { 'x-beadcause-token': TOKEN }) =>
  new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: p,
        method,
        agent: false,
        headers: { ...headers, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) },
      },
      (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* a non-JSON body is the assertion's problem */
          }
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

console.log('\nGET /api/sessions and POST /api/sessions/resume\n');

/* --------------------------------------------------------------------- the list */

await acheck('every workspace: one row per transcript with a directory, unresolved decided on each', async () => {
  const { status, json } = await ask('GET', '/api/sessions');
  assert(status === 200, `HTTP ${status}: ${JSON.stringify(json)}`);
  assert(json.workspace === null, 'no workspace was asked for');
  const by = Object.fromEntries(json.rows.map((r) => [r.sessionId, r]));
  assert(by[id(1)]?.unresolved === true, `the set-aside session is not unresolved: ${JSON.stringify(by[id(1)])}`);
  assert(by[id(1)].workspace === 'demo', `its workspace is ${by[id(1)].workspace}, not demo`);
  assert(by[id(1)].status === 'closed', `its status is ${by[id(1)].status}`);
  assert(by[id(1)].name === 'demo - set aside this morning', `its name is ${by[id(1)].name}`);
  assert(by[id(2)]?.unresolved === false, 'a DONE- window is resolved');
  assert(by[id(3)]?.unresolved === false, 'an unnamed transcript is not work set aside');
  assert(by[id(4)]?.unresolved === true, 'a retired worktree is still unresolved — the plan is what refuses it');
  assert(json.unresolved === json.rows.filter((r) => r.unresolved).length, 'the count disagrees with the rows');
  assert(json.unresolved === 2, `expected 2 unresolved, got ${json.unresolved}`);
  assert(typeof json.boot === 'string', 'the boot is stamped');
});

await acheck('?workspace= narrows to that workspace; an unknown one is a 400', async () => {
  const demo = await ask('GET', '/api/sessions?workspace=demo');
  assert(demo.status === 200, `HTTP ${demo.status}`);
  assert(demo.json.workspace === 'demo');
  assert(demo.json.rows.length === 4 && demo.json.rows.every((r) => r.workspace === 'demo'), JSON.stringify(demo.json.rows));
  const nope = await ask('GET', '/api/sessions?workspace=nope');
  assert(nope.status === 400, `an unknown workspace answered ${nope.status}`);
  assert(/unknown workspace/.test(nope.json?.error || ''), nope.text);
});

await acheck('both routes are behind the token', async () => {
  assert((await ask('GET', '/api/sessions', null, {})).status === 401, 'the list answered without a token');
  assert((await ask('POST', '/api/sessions/resume', { workspace: 'demo' }, {})).status === 401, 'the resume answered without a token');
});

/* ------------------------------------------------------------------- the resume */

await acheck('resume: plans both unresolved rows, reports the gone directory as skipped and the refused window as failed, and writes the report', async () => {
  const { status, json } = await ask('POST', '/api/sessions/resume', { workspace: 'demo' });
  assert(status === 200, `HTTP ${status}: ${JSON.stringify(json)}`);
  assert(json.ok === true && json.workspace === 'demo', JSON.stringify(json));
  assert(json.opened.length === 0, `a suite opened a window: ${JSON.stringify(json.opened)}`);
  assert(json.skipped.length === 1 && json.skipped[0].sessionId === id(4), JSON.stringify(json.skipped));
  assert(/directory is gone/.test(json.skipped[0].why), json.skipped[0].why);
  assert(json.failed.length === 1 && json.failed[0].sessionId === id(1), JSON.stringify(json.failed));
  assert(json.failed[0].why && json.failed[0].why.length > 0, 'the refusal is not named');
  const report = loadState().resumeReport;
  assert(report && report.workspace === 'demo', `no resume report in the state: ${JSON.stringify(report)}`);
  const outcomes = Object.fromEntries(report.rows.map((r) => [r.sessionId, r.outcome]));
  assert(outcomes[id(1)] === 'failed' && outcomes[id(4)] === 'skipped', JSON.stringify(report.rows));
  assert(report.rows.every((r) => r.source === 'resume'), 'the rows are marked as a resume');
});

await acheck('and the list now shows what the resume decided, still unresolved', async () => {
  const { json } = await ask('GET', '/api/sessions?workspace=demo');
  const by = Object.fromEntries(json.rows.map((r) => [r.sessionId, r]));
  assert(by[id(1)].status === 'failed', `the refused window reads ${by[id(1)].status}`);
  assert(by[id(4)].status === 'skipped', `the gone one reads ${by[id(4)].status}`);
  assert(by[id(1)].unresolved && by[id(4)].unresolved, 'neither came back, so both are still set aside');
  assert(typeof by[id(1)].decidedAt === 'string', 'the decision is stamped');
});

await acheck('resume: an unknown workspace is a 400 and a missing one too', async () => {
  const nope = await ask('POST', '/api/sessions/resume', { workspace: 'nope' });
  assert(nope.status === 400, `HTTP ${nope.status}`);
  const none = await ask('POST', '/api/sessions/resume', {});
  assert(none.status === 400, `HTTP ${none.status}`);
});

/* ------------------------------------------------------------------- teardown */

for (const s of servers) s.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
