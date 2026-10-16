#!/usr/bin/env node
/**
 * Keystrokes typed while a session opens cannot change what it runs (bc-txh7w).
 *
 *     npm test
 *     node test/strayinput.mjs
 *
 * iTerm takes the keyboard whenever it opens a window, and beadcause only hands it back
 * a beat later. Anything Adam typed in that beat used to go into the new window's shell,
 * because the launch line was *typed* in with `write text`. A typed line is just more
 * input on the tty, so stray keystrokes got mixed into it and broke it.
 *
 * Now iTerm starts the window on `launchArgs` as its command, and nothing is typed. So
 * what is pinned here is the property the window depends on, run on a real pty with the
 * real argv:
 *
 * 1. **Typed input is the session's input.** Keystrokes sent the instant the shell is
 *    spawned (while its rc file is still loading) reach `claude` as lines on stdin. None
 *    of them runs as a shell command, and the launch still does exactly what it says.
 * 2. **The shell is interactive and login.** The `cd` fires the `chpwd` hook, which is
 *    what points BEADS_DIR at the right tree.
 * 3. **Every session ends its window** through its own `exit` when `claude` exits, a chat
 *    as much as a work session (bc-2uj4.16.1), and a work session's done file holds
 *    `claude`'s status. **Only a command file with no ending reaches the prompt shell**
 *    that `launchArgs` execs as a fallback, and that prompt is in the directory it ran in.
 * 4. **A startup reader cannot hang it.** oh-my-zsh asks its update question with
 *    `read -r -k 1` while `~/.zshrc` loads. With nothing typed any more, that read would
 *    block, so the command sets `DISABLE_AUTO_UPDATE=true`. There is a control run
 *    without it, which shows the read really does block. So removing the variable cannot
 *    look like a passing suite.
 * 5. **The AppleScript no longer types.** Checked against the files themselves.
 *
 * `expect` provides the pty, as it does for test/canonline.mjs: Node has no `openpty(3)`,
 * and a pipe has no input queue shared with a line discipline, so a pipe cannot show any
 * of this. `ZDOTDIR` makes a stand-in the only rc file in play, so this suite tests the
 * repo rather than this Mac's oh-my-zsh.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { launchArgs, launchCommand, sessionEnding } from '../lib/session.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, fn) => {
  try {
    fn();
    ok(name);
  } catch (e) {
    bad(name, e.message);
  }
};

// realpath, because on macOS os.tmpdir() is a symlink into /private and `$PWD` after a
// `cd` reports whichever spelling it was given, which this compares against.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-stray-')));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

/* ------------------------------------------------------------------ the stand-ins */

const dir = path.join(tmp, 'repo');
fs.mkdirSync(dir);
const spy = path.join(tmp, 'spy');
fs.mkdirSync(spy);

/**
 * `claude`, reduced to what matters here: it reads stdin until it goes quiet and reports
 * every line it got. A real `claude` is a TUI that reads the tty raw. A line reader is
 * the stricter test, because it leaves nothing unread for a shell to pick up afterwards
 * only if it really did receive it all.
 */
const claude = path.join(tmp, 'bin', 'claude');
fs.mkdirSync(path.dirname(claude));
fs.writeFileSync(
  claude,
  [
    '#!/bin/zsh -f',
    'print -r -- CLAUDE-STARTED',
    'while IFS= read -r -t 2 line; do print -r -- "CLAUDE-GOT:$line"; done',
    'print -r -- CLAUDE-DONE',
    'exit 7',
    '',
  ].join('\n'),
  { mode: 0o755 }
);

/**
 * An rc file that takes a moment to load, like the real one does, so the stray input
 * really does arrive before the shell is ready. `sleep` is then made a no-op, so the
 * send-off's five seconds of countdown cost nothing. `chpwd` records that the
 * interactive hook fired, and the prompt is one `expect` can wait for.
 *
 * `reader` adds omz's update check, reduced to the lines that matter: it asks unless
 * `DISABLE_AUTO_UPDATE` is true, and reads one key.
 */
const zdotdir = (name, { reader = false } = {}) => {
  const z = path.join(tmp, name);
  fs.mkdirSync(z);
  fs.writeFileSync(path.join(z, '.zshenv'), '');
  fs.writeFileSync(
    path.join(z, '.zshrc'),
    [
      '/bin/sleep 0.5',
      ...(reader
        ? [`[[ "$DISABLE_AUTO_UPDATE" == true ]] || { printf 'update? '; read -r -k 1 answer; print -r -- "RC-ATE:$answer"; }`]
        : []),
      'sleep() { : }',
      `chpwd() { print -r -- "$PWD" > ${shq(path.join(spy, `${name}-chpwd`))} }`,
      `PS1='READY> '`,
      '',
    ].join('\n')
  );
  return z;
};

/**
 * Open a "window": spawn `args` on a pty, type `stray` into it at once, and let it run.
 *
 * `prompt` mode waits for the prompt that should follow `claude`, asks the shell where it
 * is, then leaves. `ends` mode expects the shell to end by itself. The exit status says
 * which step it got stuck on, and the transcript is returned either way.
 */
const EXP = path.join(tmp, 'open.exp');
fs.writeFileSync(
  EXP,
  [
    'log_user 0',
    'set timeout [lindex $argv 3]',
    // `-a`, or `log_user 0` suppresses the file too.
    'log_file -a -noappend [lindex $argv 0]',
    'set zdot [lindex $argv 1]',
    'set mode [lindex $argv 2]',
    'set stray [read [open [lindex $argv 4] r]]',
    'set probe [read [open [lindex $argv 5] r]]',
    'set launch [lrange $argv 6 end]',
    'spawn -noecho env ZDOTDIR=$zdot {*}$launch',
    // At once — before the rc file has finished loading, which is the window of the bug.
    'if {$stray ne ""} { send -- $stray }',
    // Every pattern list spans lines on purpose. `expect { a {} b {} }` on one line is
    // one glob pattern, not a list, so it never matches and every step times out and
    // carries on as though it had.
    'expect {',
    '  "CLAUDE-DONE" {}',
    '  timeout { exit 3 }',
    '  eof { exit 7 }',
    '}',
    'if {$mode eq "prompt"} {',
    '  expect {',
    '    "READY> " {}',
    '    timeout { exit 4 }',
    '    eof { exit 8 }',
    '  }',
    '  send -- $probe',
    '  expect {',
    '    "BACK-42" {}',
    '    timeout { exit 5 }',
    '  }',
    '  send -- "exit\\r"',
    '}',
    // `catch`, because a shell that has already gone leaves nothing to wait on, and
    // that is the success case for a session that ends itself.
    'catch {',
    '  expect {',
    '    eof {}',
    '    timeout { exit 6 }',
    '  }',
    '}',
    '',
  ].join('\n')
);
let n = 0;
const { DISABLE_AUTO_UPDATE: _inherited, ...withoutAutoUpdate } = process.env;
const open = ({ zdot, mode, commandFile, stray = '', args = launchArgs(commandFile), timeout = 20 }) => {
  const at = (kind) => path.join(tmp, `run-${(n += 1)}-${kind}`);
  const [log, strayFile, probeFile] = [at('log'), at('stray'), at('probe')];
  fs.writeFileSync(strayFile, stray);
  fs.writeFileSync(probeFile, 'print -r -- "AT:$PWD" BACK-$((6*7))\r');
  const r = spawnSync(
    '/usr/bin/expect',
    ['-f', EXP, log, zdot, mode, String(timeout), strayFile, probeFile, ...args],
    // Without the variable the fix sets. A session this repo launched already exports
    // it, so a gate run from one would hand it to the control and the reader would
    // never ask — the control passing for the wrong reason (bc-cfqup).
    { timeout: (timeout * 4 + 10) * 1000, env: withoutAutoUpdate }
  );
  if (r.error) throw r.error;
  return { status: r.status, transcript: read(log) };
};

/** The command file a session sources: `cd`, then `claude`, then its ending. */
const commandFileFor = (name, ending) => {
  const file = path.join(tmp, `beadcause-cmd-${name}.zsh`);
  fs.writeFileSync(file, `cd ${shq(dir)} && ${shq(claude)}${ending}\n`, { mode: 0o600 });
  return file;
};

/* ------------------------------------------------------ 1-3. a chat, typed into early */

console.log('\nkeystrokes typed while a chat window opens');

const pwned = path.join(tmp, 'pwned');
const stray = `touch ${pwned}\rhalf a sentence meant for somewhere else\r`;
const chatZ = zdotdir('chat');
const chat = open({ zdot: chatZ, mode: 'ends', commandFile: commandFileFor('chat', sessionEnding(null)), stray });

check('the shell ended by itself after claude, and never reached a prompt (bc-2uj4.16.1)', () => {
  assert.equal(chat.status, 0, `expect stopped at step ${chat.status}:\n${chat.transcript.slice(-600)}`);
  assert.doesNotMatch(chat.transcript, /READY> /, 'a prompt shell was started after the exit');
});

check('none of the typed text ran as a shell command', () => {
  assert.ok(!fs.existsSync(pwned), `${pwned} exists — a stray line was run by the shell`);
  assert.doesNotMatch(chat.transcript, /command not found|parse error/, chat.transcript.slice(-600));
});

check('every typed line reached claude as input, in order', () => {
  const got = [...chat.transcript.matchAll(/^CLAUDE-GOT:(.*?)\r?$/gm)].map((m) => m[1]);
  assert.deepEqual(got, [`touch ${pwned}`, 'half a sentence meant for somewhere else'], chat.transcript.slice(-600));
});

check('claude started from the launch line as written, in the right directory', () => {
  assert.match(chat.transcript, /CLAUDE-STARTED/);
  assert.equal(read(path.join(spy, 'chat-chpwd')).trim(), dir, 'the interactive chpwd hook never fired on the cd');
});

/* ------------------------------------------ 3. the fallback prompt, for a line with no exit */

console.log('\na command file with no ending of its own');

const bareZ = zdotdir('bare');
const bare = open({ zdot: bareZ, mode: 'prompt', commandFile: commandFileFor('bare', '') });

check('it reaches the prompt shell launchArgs execs after it', () => {
  assert.equal(bare.status, 0, `expect stopped at step ${bare.status}:\n${bare.transcript.slice(-600)}`);
});

check('and that prompt is in the directory the line cd-ed into', () => {
  assert.match(bare.transcript, new RegExp(`AT:${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+BACK-42`), bare.transcript.slice(-600));
});

/* -------------------------------------------------------- 3. a work session still ends */

console.log('\na work session, typed into early');

const done = path.join(tmp, 'done');
const workZ = zdotdir('work');
const work = open({ zdot: workZ, mode: 'ends', commandFile: commandFileFor('work', sessionEnding(done)), stray });

check('the shell ended by itself, and never reached a prompt', () => {
  assert.equal(work.status, 0, `expect stopped at step ${work.status}:\n${work.transcript.slice(-600)}`);
  assert.doesNotMatch(work.transcript, /READY> /, 'a prompt shell was started after the exit');
});

check("the done file holds claude's status", () => {
  assert.equal(read(done), '7');
});

check('and the typed text went to claude there too', () => {
  assert.ok(!fs.existsSync(pwned), `${pwned} exists`);
  assert.match(work.transcript, /CLAUDE-GOT:half a sentence/);
});

/* ------------------------------------------------------- 4. a reader cannot hang it */

console.log('\nan rc file that reads the tty at startup, with nothing typed');

const readerZ = zdotdir('reader', { reader: true });
const quiet = open({ zdot: readerZ, mode: 'ends', commandFile: commandFileFor('reader', sessionEnding(null)) });

check('with DISABLE_AUTO_UPDATE the reader never asks, and the session starts', () => {
  assert.equal(quiet.status, 0, `expect stopped at step ${quiet.status}:\n${quiet.transcript.slice(-600)}`);
  assert.doesNotMatch(quiet.transcript, /RC-ATE/);
});

const control = open({
  zdot: readerZ,
  mode: 'ends',
  commandFile: commandFileFor('control', sessionEnding(null)),
  // The same launch without the env prefix: the question gets asked.
  args: launchArgs(commandFileFor('control', sessionEnding(null))).slice(2),
  timeout: 4,
});

check('control: without it, the read blocks and claude never starts', () => {
  assert.equal(control.status, 3, `expected to be stuck before claude, got step ${control.status}`);
  assert.doesNotMatch(control.transcript, /CLAUDE-STARTED/, control.transcript.slice(-400));
  assert.match(control.transcript, /update\? /);
});

/* ------------------------------------------------------------------- the strings */

console.log('\nwhat iTerm is handed');

check('launchCommand is launchArgs, with only the script quoted', () => {
  const file = '/var/folders/ab/xyz/T/beadcause-cmd-0123456789ab.zsh';
  assert.equal(
    launchCommand(file),
    `/usr/bin/env DISABLE_AUTO_UPDATE=true /bin/zsh -lic 'source ${file}; exec /bin/zsh -il'`
  );
  // iTerm splits it the way a shell would. zsh's own splitting stands in for that.
  const split = spawnSync('/bin/zsh', ['-fc', `print -rl -- \${(Q)\${(z)1}}`, 'zsh', launchCommand(file)], {
    encoding: 'utf8',
  });
  assert.deepEqual(split.stdout.trimEnd().split('\n'), launchArgs(file));
});

check('a path that would need quoting is refused, not quoted', () => {
  for (const bad_ of ["/tmp/it's.zsh", '/tmp/a b.zsh', '/tmp/$(x).zsh', 'relative.zsh', '']) {
    assert.throws(() => launchArgs(bad_), /cannot be handed to iTerm/, bad_);
  }
});

/* ----------------------------------------------------------- 5. nothing types any more */

console.log('\nthe session-open path');

const applescript = fs.readFileSync(path.join(ROOT, 'scripts', 'open-session.applescript'), 'utf8');
const session = fs.readFileSync(path.join(ROOT, 'lib', 'session.js'), 'utf8');

check('open-session.applescript has no write text statement', () => {
  const code = applescript.replace(/--.*$/gm, '');
  assert.doesNotMatch(code, /write text/);
});

check('all four of its create calls start the tab on the command', () => {
  // A tab in the workspace's window, or a new window when there is none (bc-2uj4.16.2).
  // Either way iTerm starts the session on the command, never on a shell to type into.
  assert.match(applescript, /create window with profile theProfile command theCommand/);
  assert.match(applescript, /create window with default profile command theCommand/);
  assert.match(applescript, /create tab with profile theProfile command theCommand/);
  assert.match(applescript, /create tab with default profile command theCommand/);
});

check('both launchers hand it launchCommand', () => {
  assert.match(session, /const command = launchCommand\(commandFile\)/);
  assert.match(session, /openTab\(cfg, command, tabTitle, workspace\)/);
  assert.match(session, /openTab\(cfg, launchCommand\(commandFile\), tabTitle, workspace\)/);
  assert.match(session, /\[SCRIPT, command, tabTitle,/, 'the one AppleScript call passes the command it was handed');
});

console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m` : '\n\x1b[32mall good\x1b[0m');
process.exit(failures ? 1 : 0);
