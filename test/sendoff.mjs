#!/usr/bin/env node
/**
 * A worker window counts itself down and goes out with a bang (bc-s12k).
 *
 *     npm test
 *     node test/sendoff.mjs
 *
 * `sessionEnding` is the tail of the command `lib/session.js` types into an iTerm
 * window: capture `claude`'s exit status, play a send-off, `exit`. Everything about it
 * is invisible from Node — `launch` hands the string to AppleScript and the next thing
 * that exists is a window on a screen — so this suite runs the string itself, in a real
 * `zsh`, and reads the results back off disk and stdout.
 *
 * The four things worth pinning, in descending order of what they cost when wrong:
 *
 * 1. **The done file still holds `claude`'s status.** The send-off is a pile of
 *    `printf`s and `sleep`s and every one of them clobbers `$?`. If the countdown ever
 *    drifts ahead of the capture, `lib/advocate.js` reads 0 for every session that ever
 *    ran, a failed worker becomes a successful one, and *nothing else in the system
 *    will notice* — that is the expensive bug this file exists for.
 * 2. **It is one line.** The command is typed, not executed: a newline anywhere in it
 *    is a command boundary, so a multi-line send-off runs its own back half immediately
 *    and the window still has `claude` in front of it.
 * 3. **The art survives the shell.** Backslashes are most of an explosion and none of
 *    them are safe inside a format string. Asserting on the rendered output is what
 *    catches a well-meant refactor into `printf '…\n'` — which passes review, and draws
 *    a different picture on every shell.
 * 4. **No tab comes back to a prompt — not even a chat's** (bc-2uj4.16.1). No done file
 *    used to mean "a window you are sitting at, so leave it at a prompt", and every ship,
 *    conflict, merge, review and chat tab ended as a bare shell nothing would ever close.
 *    The last section runs each opener's real command line in a real zsh, with `claude`
 *    stubbed, and asserts the shell never gets past it.
 *
 * `sleep` is stubbed out on PATH, so the five real seconds cost nothing here. That is
 * also the only reason it is safe to assert on the frames: they all land at once.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { sessionEnding, sessionCommand, launchArgs, resumeCommand, commandWindowLine } from '../lib/session.js';
import { effective } from '../lib/foundation.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
let ran = 0;
const ok = (name) => {
  ran += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
};
const bad = (name, detail) => {
  ran += 1;
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-sendoff-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

/* ---------------------------------------------------------- the shape of the string */

const doneFile = path.join(tmp, 'worker.done');
const ending = sessionEnding(doneFile);

if (!/\n/.test(ending)) ok('the ending is a single line — AppleScript types it, it does not run it');
else bad('the ending is a single line', 'a newline in it is a command boundary, not a character');

if (ending.startsWith(`; printf '%s' "$?" >`))
  ok('the exit status is captured first, before anything that could overwrite it');
else bad('the exit status is captured first', ending.slice(0, 60));

if (ending.trimEnd().endsWith('; exit')) ok('the ending still ends the shell');
else bad('the ending still ends the shell', ending.slice(-60));

const chat = sessionEnding(null);
if (chat.trimEnd().endsWith('; exit') && !chat.includes('"$?"'))
  ok('a session with no done file still ends its shell — it just has no status to capture');
else bad('a session with no done file still ends its shell', JSON.stringify(chat.slice(0, 60)));

/* ----------------------------------------------------------------- and it runs */

/**
 * Run the ending the way iTerm would, behind a command that failed.
 *
 * `(exit 7)` is the stand-in for `claude`: it is the smallest thing that leaves a
 * non-zero `$?`, and 7 rather than 1 so a status invented anywhere along the way cannot
 * pass for the real one. `zsh` because that is the shell in the window — this is also
 * what proves `%40s` and `\r` render there, which is not a given across shells.
 */
const stub = path.join(tmp, 'bin');
fs.mkdirSync(stub);
fs.writeFileSync(path.join(stub, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

const run = spawnSync('/bin/zsh', ['-c', `(exit 7)${ending}`], {
  encoding: 'utf8',
  env: { ...process.env, PATH: `${stub}:${process.env.PATH}` },
  timeout: 30000,
});

if (run.error) bad('the ending runs in zsh at all', String(run.error));
else ok('the ending runs in zsh at all');

const wrote = fs.existsSync(doneFile) ? fs.readFileSync(doneFile, 'utf8') : null;
if (wrote === '7') ok("the done file holds claude's status, not the send-off's");
else bad("the done file holds claude's status, not the send-off's", `it holds ${JSON.stringify(wrote)}`);

const out = run.stdout || '';

const counted = ['( 3 )', '( 2 )', '( 1 )'].filter((frame) => out.includes(frame));
if (counted.length === 3) ok('it counts 3, 2, 1');
else bad('it counts 3, 2, 1', `only ${counted.join(', ') || 'nothing'} was printed`);

if (out.includes('B O O M')) ok('it goes out with a bang');
else bad('it goes out with a bang', 'no explosion on stdout');

/**
 * The one assertion a format-string refactor cannot survive. Both of these lines are
 * drawn with backslashes, and `\ ` and `\(` are exactly the undefined escapes that a
 * `printf '…\n'` would be free to eat.
 */
const drawn = ['   ---  *   B O O M   *  ---', '            \\(^_^)/   all done'].filter((line) =>
  out.split('\n').includes(line)
);
if (drawn.length === 2) ok('the art lands byte for byte — backslashes and all');
else bad('the art lands byte for byte', `${drawn.length} of 2 lines matched; got:\n${out.replace(/\r/g, '⏎')}`);

/* --------------------------------------------------------- and nothing else grew one */

/**
 * The send-off hangs off the done file, which is the same condition as `exit`. Nothing
 * should ever come to depend on it separately — a window that is not closing has
 * nothing to count down to — so `launch` must build its ending from this one function
 * and not assemble a second one inline.
 */
const source = fs.readFileSync(path.join(HERE, '..', 'lib', 'session.js'), 'utf8');
const inlineEndings = source.match(/const ending = (?!sessionEnding\()/g) || [];
if (!inlineEndings.length) ok('launch takes its ending from sessionEnding and builds no second one');
else bad('launch takes its ending from sessionEnding', `${inlineEndings.length} inline ending(s) in lib/session.js`);

/* ------------------------------------------- every opener's tab ends its shell */

/**
 * Every door that opens an iTerm tab, and what it hands `launch` (bc-2uj4.16.1).
 *
 * The table is the audit, and the static check under it is what keeps it one: it reads
 * every exported `open…` function (plus `resumeWorkSession`) out of lib/session.js and
 * fails on any the table does not name, so a new door cannot arrive without being run
 * here. `done` is whether that opener passes a done file — the three that do are the
 * three the daemon waits on; the rest never did, and those are the tabs that used to
 * sit at a prompt forever.
 *
 * `command` is the one door that is *meant* to come back to a prompt (bc-5to5r.3): the
 * status window after a boot runs `b7e-sessions` and stays, because a report that closed
 * the moment it had printed would be read by nobody. It is in the audit so the exception
 * is asserted rather than assumed — the loop below checks the opposite property for it.
 */
const OPENERS = {
  openSession: { agent: 'worker', done: false },
  openHandoffSession: { agent: 'worker', done: false },
  openShipSession: { agent: 'worker', done: false },
  openConflictSession: { agent: 'worker', done: false },
  openMergeAdvocateSession: { agent: 'merge-advocate', done: false },
  openReviewAnswerSession: { agent: 'worker', done: false },
  openReviewAdvocateSession: { agent: 'review-advocate', done: false },
  openWorkSession: { agent: 'worker', done: true },
  resumeWorkSession: { agent: 'worker', done: true, resume: true },
  openPlanSession: { agent: 'worker', done: true },
  openEpicAdvocateSession: { agent: 'epic-advocate', done: true },
  openResumedWindow: { resumed: true },
  openCommandWindow: { command: true },
};

const bodies = new Map();
const heads = [...source.matchAll(/^export (?:async )?function (open\w*|resumeWorkSession)\s*\(/gm)];
// A body ends at the first closing brace in column 0 — this file's style for a top-level
// function — so one opener's slice cannot run on into `launch` below it.
for (const m of heads) {
  const rest = source.slice(m.index);
  bodies.set(m[1], rest.slice(0, rest.indexOf('\n}\n') + 2));
}

const unaudited = [...bodies.keys()].filter((name) => !(name in OPENERS));
if (!unaudited.length) ok(`all ${bodies.size} openers in lib/session.js are in this audit`);
else bad('every opener in lib/session.js is in this audit', `not covered: ${unaudited.join(', ')}`);

const missing = Object.keys(OPENERS).filter((name) => !bodies.has(name));
if (!missing.length) ok('and every opener in the audit still exists');
else bad('every opener in the audit still exists', `gone: ${missing.join(', ')}`);

/**
 * Each opener has exactly one way to a tab: `launch`, whose line is `sessionCommand`,
 * whose tail is `sessionEnding` — or, for the reboot window, `resumeCommand`. An opener
 * that called `osascript` itself would bypass all of that, so that is what is checked;
 * the reboot window is the one that does, and it must hand it `resumeCommand`'s line.
 */
for (const [name, body] of bodies) {
  const resumed = OPENERS[name]?.resumed;
  const command = OPENERS[name]?.command;
  const via = resumed ? 'resumeCommand' : command ? 'commandWindowLine' : 'launch';
  const fine = resumed
    ? /resumeCommand\(/.test(body)
    : command
      ? /commandWindowLine\(/.test(body) && !body.includes('osascript')
      : /\blaunch\(/.test(body) && !body.includes('osascript');
  if (fine) ok(`${name} reaches its tab through ${via}`);
  else bad(`${name} reaches its tab through the shared ending`, 'it builds its own line');
}

const bin = path.join(tmp, 'openers-bin');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nprintf "%s " "$@" > "$SPY"\nexit 0\n', { mode: 0o755 });
const dir = path.join(tmp, 'repo');
fs.mkdirSync(dir);

/**
 * Run one opener's line the way the tab would: `launchArgs`'s own script, in a login zsh,
 * with a sentinel in place of the prompt shell it `exec`s afterwards. `exit` inside a
 * sourced file ends the shell that sourced it, so reaching the sentinel is exactly "this
 * tab came back to a prompt".
 */
const PROMPT_SHELL = 'exec /bin/zsh -il';
for (const [name, spec] of Object.entries(OPENERS)) {
  const spy = path.join(tmp, `${name}.argv`);
  const commandFile = path.join(tmp, `beadcause-cmd-${name}.zsh`);
  let line;
  if (spec.command) {
    // The one tab that must come back to a prompt: the report prints, the command file
    // goes, and the shell stays — the opposite of every row below.
    line = commandWindowLine('echo PRINTED-THE-REPORT', commandFile);
    fs.writeFileSync(commandFile, `${line}\n`);
    const script = launchArgs(commandFile).at(-1);
    const got = spawnSync('/bin/zsh', ['-lc', `${script.slice(0, -PROMPT_SHELL.length)}echo STILL-AT-A-PROMPT`], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      timeout: 60000,
    });
    const out = got.stdout || '';
    if (out.includes('PRINTED-THE-REPORT') && out.includes('STILL-AT-A-PROMPT') && !fs.existsSync(commandFile))
      ok(`${name}: the report printed, the command file went, and the shell stayed at a prompt — on purpose`);
    else
      bad(
        `${name}: prints and stays`,
        !out.includes('PRINTED-THE-REPORT')
          ? `the command never ran: ${(got.stderr || '').slice(0, 200)}`
          : !out.includes('STILL-AT-A-PROMPT')
            ? 'the shell exited — a status window nobody can read'
            : `${commandFile} was left behind`
      );
    continue;
  }
  if (spec.resumed) {
    line = resumeCommand(dir, '5fe356fe-8fb6-43e6-8abc-9ba9febe37c7', commandFile);
  } else {
    const promptFile = path.join(tmp, `${name}.prompt`);
    const systemFile = path.join(tmp, `${name}.system`);
    fs.writeFileSync(promptFile, 'the brief');
    fs.writeFileSync(systemFile, 'the role');
    line = sessionCommand(await effective(dir, spec.agent), {
      dir,
      promptFile,
      systemFile,
      mode: 'auto',
      doneFile: spec.done ? path.join(tmp, `${name}.done`) : null,
      commandFile,
      sessionId: spec.resume ? '5fe356fe-8fb6-43e6-8abc-9ba9febe37c7' : null,
      resume: Boolean(spec.resume),
    });
  }
  fs.writeFileSync(commandFile, `${line}\n`);
  const script = launchArgs(commandFile).at(-1);
  if (!script.endsWith(PROMPT_SHELL)) {
    bad(`${name}: the tab's script ends in the prompt shell this stands in for`, script);
    continue;
  }
  const got = spawnSync('/bin/zsh', ['-lc', `${script.slice(0, -PROMPT_SHELL.length)}echo STILL-AT-A-PROMPT`], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPY: spy },
    timeout: 60000,
  });
  const ranClaude = fs.existsSync(spy);
  const back = (got.stdout || '').includes('STILL-AT-A-PROMPT');
  if (ranClaude && !back && !fs.existsSync(commandFile)) ok(`${name}: claude ran, then the shell exited — no prompt left behind`);
  else
    bad(
      `${name}: the shell exits after claude`,
      !ranClaude
        ? `claude never ran: ${(got.stderr || '').slice(0, 200)}`
        : back
          ? 'the shell came back to a prompt'
          : `${commandFile} was left behind`
    );
}

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n\x1b[32mall ${ran} checks passed\x1b[0m\n`);
process.exit(failures ? 1 : 0);
