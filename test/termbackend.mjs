#!/usr/bin/env node
/**
 * The terminal-backend seam — one interface over iTerm, with today's behaviour unchanged.
 *
 *     npm test
 *     node test/termbackend.mjs
 *
 * bc-obucr.1 moved every Apple event that opens, messages, describes or closes an agent
 * window out of lib/session.js and lib/reap.js and behind lib/termbackend.js, so that the
 * tmux backend for Ubuntu (bc-obucr.2) is one new file rather than a rewrite. What this
 * suite holds:
 *
 *   - **the selection rule** — one place, `cfg.terminalBackend`, else the platform's
 *     default when this build has it, else iTerm; a named backend that does not exist is
 *     an error, never a quiet fallback to osascript;
 *   - **the contract** — the iTerm backend has every required method and all three
 *     optional capabilities, and `missingMethods` is what a new backend is measured by;
 *   - **nothing escaped the seam** — no `osascript` call is left in the callers;
 *   - **and the backend is still safe in a suite** — its `open` and its sweep refuse under
 *     the launch guard before any Apple event, exactly as the code they came from did.
 *
 * Byte-for-byte argv is pinned where it always was (test/cards.mjs, test/resolverqueue.mjs,
 * test/launchseam.mjs), now reading lib/termbackend-iterm.js.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LIB = (name) => path.join(ROOT, 'lib', name);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-termbackend-'));
// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { REQUIRED, OPTIONAL, BACKENDS, PLATFORM_DEFAULT, can, missingMethods, backendName, terminal, sweepEmptyWindows } =
  await import(LIB('termbackend.js'));
const { itermBackend, itermBlocked, parseDescribed } = await import(LIB('termbackend-iterm.js'));
const { mayLaunch } = await import(LIB('launchguard.js'));

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
}

console.log('\nthe terminal-backend seam\n');

/* ============================================================ 1. the selection rule */

await check('a Mac with nothing configured gets iTerm', () => {
  assert.equal(backendName(null, { platform: 'darwin' }), 'iterm');
  assert.equal(backendName({}, { platform: 'darwin' }), 'iterm');
});

await check('a platform whose native backend this build lacks still gets iTerm — today’s behaviour', () => {
  // Linux names tmux, and until bc-obucr.2 registers one nothing on Linux changes.
  assert.equal(PLATFORM_DEFAULT.linux, 'tmux');
  assert.equal(backendName(null, { platform: 'linux' }), BACKENDS.tmux ? 'tmux' : 'iterm');
});

await check('once a platform’s backend exists, an unconfigured host on it gets that one', () => {
  const backends = { iterm: itermBackend, tmux: { name: 'tmux' } };
  assert.equal(backendName(null, { platform: 'linux', backends }), 'tmux');
  assert.equal(backendName(null, { platform: 'darwin', backends }), 'iterm');
});

await check('the configured name wins over the platform', () => {
  const backends = { iterm: itermBackend, tmux: { name: 'tmux' } };
  assert.equal(backendName({ terminalBackend: 'tmux' }, { platform: 'darwin', backends }), 'tmux');
  assert.equal(backendName({ terminalBackend: ' iterm ' }, { platform: 'linux', backends }), 'iterm');
});

await check('a named backend this build cannot drive is an error, not a quiet osascript', () => {
  assert.throws(() => backendName({ terminalBackend: 'kitty' }, { platform: 'darwin' }), /"kitty" is not a terminal/);
  assert.throws(() => terminal({ terminalBackend: 'kitty' }), /kitty/);
});

await check('terminal() with a cfg and with none both answer iTerm here', () => {
  assert.equal(terminal({ terminalBackend: 'iterm' }), itermBackend);
  // No config file in this suite's CONFIG_DIR: the platform rule decides.
  assert.equal(terminal().name, backendName(null));
});

/* ================================================================== 2. the contract */

await check('the iTerm backend has every required method', () => {
  assert.deepEqual(missingMethods(itermBackend), []);
  assert.equal(itermBackend.name, 'iterm');
});

await check('and every optional capability — focus, layout and the empty-window sweep', () => {
  for (const cap of OPTIONAL) assert.ok(can(itermBackend, cap), `iTerm lost ${cap}`);
});

await check('a headless backend is measured by what it lacks, and lacking the options is fine', () => {
  const headless = Object.fromEntries(REQUIRED.map((m) => [m, () => null]));
  assert.deepEqual(missingMethods(headless), []);
  for (const cap of OPTIONAL) assert.equal(can(headless, cap), false);
  assert.deepEqual(missingMethods({ open() {} }), REQUIRED.filter((m) => m !== 'open'));
});

/* ======================================================= 3. what iTerm says, unchanged */

await check('a TCC refusal is translated to the Automation checkbox, anything else is not', () => {
  const err = itermBlocked('execution error: Not authorized to send Apple events to iTerm. (-1743)');
  assert.equal(err.status, 403);
  assert.match(err.message, /Privacy & Security → Automation/);
  assert.equal(itermBlocked('some other failure'), null);
  assert.equal(itermBackend.blocked, itermBlocked);
});

await check('a tty iTerm is not showing is described exactly as before', () => {
  assert.equal(
    itermBackend.notHosting('/dev/ttys004'),
    'Its terminal (/dev/ttys004) is not an iTerm window — it may be in Terminal.app, tmux, or over ssh.'
  );
});

await check('describe reads the script’s two lines back, and `missing` as nothing', () => {
  assert.deepEqual(parseDescribed('/dev/ttys004\n▶ zz-work · demo'), { tty: '/dev/ttys004', name: '▶ zz-work · demo' });
  assert.equal(parseDescribed('missing'), null);
  assert.equal(parseDescribed(''), null);
});

/* ============================================================ 4. nothing escaped */

await check('no caller talks to osascript about a session window any more', () => {
  for (const f of ['lib/session.js', 'lib/reap.js']) {
    const code = read(f);
    assert.ok(!/['"]\/usr\/bin\/osascript['"]/.test(code), `${f} calls osascript directly again`);
    assert.ok(!/\.applescript['"]\)/.test(code), `${f} names an AppleScript again`);
  }
  assert.ok(!/closeEmptyWindows\s*[,}][^;]*from '\.\/iterm\.js'/.test(read('lib/advocate.js')), 'lib/advocate.js sweeps iTerm directly again');
});

/* ================================================== 5. still safe inside a suite */

await check('this process may not launch — the guard the backend relies on is armed', () => {
  assert.equal(mayLaunch(), false);
});

await check('the backend’s open refuses before any Apple event', () => {
  assert.throws(
    () => itermBackend.open({ cfg: {}, command: 'true', tabTitle: '▶ zz-test', workspace: 'demo' }),
    (err) => err.noLaunch === true && err.tabTitle === '▶ zz-test'
  );
});

await check('and so does the empty-window sweep, through the seam', async () => {
  const res = await sweepEmptyWindows();
  // Only iTerm has windows to sweep and a guard to refuse through. The default backend
  // off a Mac is tmux, which has no sweepEmpty, so the seam answers "nothing closed".
  if (process.platform === 'darwin') assert.equal(res.refused, true);
  assert.equal(res.closed, 0);
});

await cleanupTmp(tmp);

console.log(`\n${ran - failures}/${ran} checks passed\n`);
process.exit(failures ? 1 : 0);
