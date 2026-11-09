#!/usr/bin/env node
/**
 * The tmux terminal backend — open, message, describe and close agent windows in tmux.
 *
 *     npm test
 *     node test/termbackendtmux.mjs
 *
 * bc-obucr.2 put a second backend behind lib/termbackend.js so beadcause can run its agents
 * on a headless Ubuntu host. This suite holds it to the same contract the iTerm one keeps,
 * **against a real tmux** — on a private server (`tmux -L <unique name>`, started with no
 * config file), never the user's default server, and torn down at the end. Where tmux is
 * not on PATH the live half is skipped and says so; the pure half always runs.
 *
 *   - **the contract** — every required method, none of the optional capabilities (a
 *     headless host cannot focus, lay out, or leave an empty frame), registered under the
 *     name `cfg.terminalBackend` uses, and the platform default on Linux;
 *   - **the guard** — `open` refuses under the launch guard before tmux is reached;
 *   - **the round trip** — open → message → describe → close, as the advocate does it,
 *     with the bead id surviving in the window name and a long multi-line message
 *     arriving whole;
 *   - **absence is an answer** — a closed pane is `missing` / `false` / `null`, and no
 *     server at all is the same, never a rejection that would read as a refusal.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const LIB = (name) => path.join(ROOT, 'lib', name);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-tmux-'));
// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });
// The private server. Set before import too, so nothing in this process can ever address
// the default one. Short, because a socket path has a ~100-byte limit.
const SOCKET = `bct${process.pid}`;
process.env.BEADCAUSE_TMUX_SOCKET = SOCKET;
delete process.env.TMUX;
// The C locale, always — it is what a launchd/systemd daemon and the test gate run under,
// and under it tmux prints a tab and a `▶` as `_` unless told `-u`. From an interactive
// shell (LANG=en_US.UTF-8) this suite passed while every gate run of it failed (bc-tdes6).
for (const k of Object.keys(process.env)) if (k === 'LANG' || k.startsWith('LC_')) delete process.env[k];

const { BACKENDS, OPTIONAL, missingMethods, can, backendName, terminal } = await import(LIB('termbackend.js'));
const { tmuxBackend, socketArgs, sessionName, isAbsence, tmuxBlocked, parseOpened, parseDescribed, tmuxSocket } =
  await import(LIB('termbackend-tmux.js'));
const { ALLOW_LAUNCH, NO_LAUNCH } = await import(LIB('launchguard.js'));
const { namesBead } = await import(LIB('reap.js')).catch(() => ({}));

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
    console.log(`       ${String(err.stack || err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
}

const tmuxPath = (() => {
  try {
    return execFileSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
})();
const raw = (...args) => execFileSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const killServer = () => {
  try {
    raw('kill-server');
  } catch {
    /* already gone */
  }
};

const waitFor = async (fn, ms = 5000) => {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
};

console.log('\nthe tmux terminal backend\n');

/* ================================================================== 1. the contract */

await check('registered as `tmux`, with every required method', () => {
  assert.equal(BACKENDS.tmux, tmuxBackend);
  assert.equal(tmuxBackend.name, 'tmux');
  assert.deepEqual(missingMethods(tmuxBackend), []);
});

await check('and none of the optional capabilities — a headless host has no screen and no empty frames', () => {
  for (const cap of OPTIONAL) assert.equal(can(tmuxBackend, cap), false, `tmux claims ${cap}`);
});

await check('Linux with nothing configured now gets tmux; a Mac still gets iTerm; config wins either way', () => {
  assert.equal(backendName(null, { platform: 'linux' }), 'tmux');
  assert.equal(backendName(null, { platform: 'darwin' }), 'iterm');
  assert.equal(backendName({ terminalBackend: 'tmux' }, { platform: 'darwin' }), 'tmux');
  assert.equal(terminal({ terminalBackend: 'tmux' }), tmuxBackend);
});

/* ============================================================== 2. the pure pieces */

await check('the socket: env first; a name is -L, a path is -S, nothing is the default server', () => {
  assert.equal(tmuxSocket(), SOCKET);
  assert.deepEqual(socketArgs('beadcause'), ['-L', 'beadcause']);
  assert.deepEqual(socketArgs('/run/user/1000/bc.sock'), ['-S', '/run/user/1000/bc.sock']);
  assert.deepEqual(socketArgs(null), []);
});

await check('a workspace becomes a session name tmux can target — no `.` or `:`', () => {
  assert.equal(sessionName('beadcause'), 'bc-beadcause');
  assert.equal(sessionName('ada.log'), 'bc-ada_log');
  assert.equal(sessionName('a:b c'), 'bc-a_b_c');
  assert.equal(sessionName(''), 'bc-default');
});

await check('tmux saying "not there" is absence; anything else is not', () => {
  assert.ok(isAbsence("can't find pane: %99"));
  assert.ok(isAbsence('no server running on /tmp/tmux-501/bct1'));
  assert.ok(isAbsence('error connecting to /tmp/tmux-501/bct1 (No such file or directory)'));
  assert.ok(!isAbsence('spawn tmux ENOENT'));
  assert.ok(!isAbsence('Command failed: tmux … timed out'));
});

await check('tmux missing from the host is worded for a person; other failures are not translated', () => {
  const err = tmuxBlocked('spawn tmux ENOENT');
  assert.match(err.message, /tmux is not installed/);
  assert.equal(tmuxBlocked("can't find pane: %3"), null);
  assert.equal(tmuxBackend.blocked, tmuxBlocked);
});

await check('what `open` and `describe` print is read back, and junk is nothing', () => {
  assert.deepEqual(parseOpened('%12 @7\n'), { term: '%12', window: '@7' });
  assert.deepEqual(parseOpened(''), { term: null, window: null });
  assert.deepEqual(parseDescribed('/dev/pts/3\t▶ zz-work · demo\n'), { tty: '/dev/pts/3', name: '▶ zz-work · demo' });
  assert.equal(parseDescribed(''), null);
});

await check('a tty tmux is not showing gets its own sentence', () => {
  assert.match(tmuxBackend.notHosting('/dev/pts/9'), /\/dev\/pts\/9.*not a pane on beadcause's tmux server/);
});

/* ================================================================== 3. the guard */

await check('open asks the launch guard before anything reaches tmux', async () => {
  // This file is a suite, so the guard refuses — and it must do so synchronously, before
  // the first tmux call, or a suite could get a window out of it.
  assert.ok(!process.env[ALLOW_LAUNCH]);
  assert.throws(
    () => tmuxBackend.open({ cfg: {}, command: 'true', tabTitle: 'zz-guard · never', workspace: 'zz' }),
    (e) => e.noLaunch === true
  );
  const src = read('lib/termbackend-tmux.js');
  const body = src.slice(src.indexOf('function open('));
  assert.ok(body.indexOf('assertMayLaunch(') < body.indexOf('run('), 'the guard is not the first thing open does');
});

/* ========================================================= 4. against a real tmux */

if (!tmuxPath) {
  console.log('  skip the live round trip — tmux is not on PATH here, so there is no server to drive');
} else {
  // A private server with no config file: the user's ~/.tmux.conf must not change what this
  // suite measures, and a holder session keeps the server up between our windows.
  raw('-f', '/dev/null', 'new-session', '-d', '-s', 'holder', 'sleep 600');
  process.env[ALLOW_LAUNCH] = '1';
  delete process.env[NO_LAUNCH];
  const out = path.join(tmp, 'typed.txt');
  const title = '▶ zz-work.1 · tmux round trip';
  let opened = null;

  try {
    await check('open makes the workspace session and a window named for the bead', async () => {
      opened = await tmuxBackend.open({ cfg: {}, command: `cat > ${out}`, tabTitle: title, workspace: 'zz.ws' });
      assert.equal(opened.err, null, opened.stderr);
      assert.match(opened.term, /^%\d+$/);
      assert.match(opened.window, /^@\d+$/);
      assert.match(raw('list-sessions', '-F', '#{session_name}'), /^bc-zz_ws$/m);
    });

    await check('a second open lands in the same session, as a second window', async () => {
      const two = await tmuxBackend.open({ cfg: {}, command: 'sleep 600', tabTitle: '▶ zz-work.2 · sibling', workspace: 'zz.ws' });
      assert.equal(two.err, null, two.stderr);
      assert.notEqual(two.term, opened.term);
      assert.equal(raw('list-windows', '-t', '=bc-zz_ws', '-F', '#{window_id}').trim().split('\n').length, 2);
      assert.equal(await tmuxBackend.close(two.term), true);
    });

    await check('two opens at once for a new workspace make one session, not a collision', async () => {
      const [a, b] = await Promise.all([
        tmuxBackend.open({ cfg: {}, command: 'sleep 600', tabTitle: 'zz-a', workspace: 'zz-race' }),
        tmuxBackend.open({ cfg: {}, command: 'sleep 600', tabTitle: 'zz-b', workspace: 'zz-race' }),
      ]);
      assert.equal(a.err, null, a.stderr);
      assert.equal(b.err, null, b.stderr);
      assert.equal(raw('list-windows', '-t', '=bc-zz-race', '-F', '#{window_id}').trim().split('\n').length, 2);
      raw('kill-session', '-t', '=bc-zz-race');
    });

    await check('alive says yes, and ttys includes its terminal', async () => {
      assert.equal(await tmuxBackend.alive(opened.term), true);
      const tab = await tmuxBackend.describe(opened.term);
      const set = await tmuxBackend.ttys();
      assert.ok(set.has(tab.tty), `${tab.tty} not in ${[...set].join(', ')}`);
    });

    await check('describe reads back the tty and the title the reaper matches on', async () => {
      const tab = await tmuxBackend.describe(opened.term);
      assert.ok(tab.tty && tab.tty.startsWith('/dev/'), `tty ${tab.tty}`);
      assert.equal(tab.name, title);
      if (namesBead) assert.ok(namesBead(tab.name, 'zz-work.1'), 'the reaper would not recognise its own window');
    });

    await check('the program in the pane cannot retitle its window away from the bead id', async () => {
      // A shell prompt or a TUI retitling the window — by escape sequence (allow-rename) or
      // just by being the running command (automatic-rename) — must not cost the name.
      const t = '▶ zz-work.3 · retitle';
      const r = await tmuxBackend.open({
        cfg: {},
        command: "printf '\\033kRENAMED\\033\\\\'; sleep 600",
        tabTitle: t,
        workspace: 'zz.ws',
      });
      assert.equal(r.err, null, r.stderr);
      await new Promise((ok) => setTimeout(ok, 400));
      assert.equal((await tmuxBackend.describe(r.term)).name, t);
      assert.equal(raw('show-options', '-w', '-v', '-t', r.window, 'automatic-rename').trim(), 'off');
      assert.equal(raw('show-options', '-w', '-v', '-t', r.window, 'allow-rename').trim(), 'off');
      await tmuxBackend.close(r.term);
    });

    await check('a handle may be the pane’s tty instead of its id — the sessionReach form', async () => {
      const { tty } = await tmuxBackend.describe(opened.term);
      assert.equal(await tmuxBackend.alive(tty), true);
      assert.equal((await tmuxBackend.describe(tty)).name, title);
    });

    await check('message types the text and presses Enter — multi-line and long, arriving whole', async () => {
      // ~120 KB, far past what one tmux command line carries: this is the paste-buffer route.
      const lines = Array.from({ length: 3000 }, (_, i) => `line ${String(i).padStart(4, '0')} ${'x'.repeat(28)}`);
      const body = `first paragraph\n\n${lines.join('\n')}`;
      assert.equal(await tmuxBackend.message(opened.term, body), 'sent');
      const want = `${body}\n`;
      const got = await waitFor(() => {
        const t = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
        return t.length >= want.length ? t : '';
      }, 15000);
      assert.equal(got.length, want.length, 'not everything arrived');
      assert.equal(got, want);
      assert.equal(raw('list-buffers', '-F', '#{buffer_name}').includes('beadcause-'), false, 'a paste buffer was left behind');
    });

    await check('close kills the pane and leaves the workspace’s other windows alone', async () => {
      const keep = await tmuxBackend.open({ cfg: {}, command: 'sleep 600', tabTitle: 'zz-keep', workspace: 'zz.ws' });
      assert.equal(await tmuxBackend.close(opened.term), true);
      assert.equal(await tmuxBackend.alive(keep.term), true);
      await tmuxBackend.close(keep.term);
    });

    await check('a closed pane is an answer — missing, false, null, false — never a rejection', async () => {
      assert.equal(await tmuxBackend.alive(opened.term), false);
      assert.equal(await tmuxBackend.message(opened.term, 'hello'), 'missing');
      assert.equal(await tmuxBackend.describe(opened.term), null);
      assert.equal(await tmuxBackend.close(opened.term), false);
      assert.equal(await tmuxBackend.alive('/dev/pts/nonesuch'), false);
    });
  } finally {
    killServer();
  }

  await check('no server at all is the same absence, and an empty ttys set', async () => {
    assert.equal(await tmuxBackend.alive('%1'), false);
    assert.equal(await tmuxBackend.message('%1', 'hi'), 'missing');
    assert.equal(await tmuxBackend.describe('%1'), null);
    assert.equal(await tmuxBackend.close('%1'), false);
    assert.deepEqual([...(await tmuxBackend.ttys())], []);
  });

  delete process.env[ALLOW_LAUNCH];
}

await cleanupTmp(tmp);
console.log(`\n${ran - failures}/${ran} passed`);
process.exit(failures ? 1 : 0);
