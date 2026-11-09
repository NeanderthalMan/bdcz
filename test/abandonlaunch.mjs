#!/usr/bin/env node
/**
 * A launch whose `osascript` timed out must not leave a tab behind (bc-0urr6).
 *
 *     npm test
 *     node test/abandonlaunch.mjs
 *
 * iTerm under load can create a tab after the 20-second `osascript` timeout has already
 * killed the call. The openers used to delete the command file on any failure, so the
 * late tab's shell printed `zsh:source:1: no such file or directory: …beadcause-cmd-….zsh`
 * and fell through to `exec /bin/zsh -il`: a bare prompt nothing would ever close.
 *
 * `abandonLaunchFiles` now rewrites the command file on a timeout. These checks pin that
 * behaviour: the rewritten file, sourced the way a late tab sources it, runs none of the
 * real command, removes itself and ends the shell before the prompt shell. A refusal
 * still deletes everything. The last check makes sure every opener goes through the
 * helper and none of them deletes its command file directly.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { abandonLaunchFiles, launchTimedOut, launchArgs } from '../lib/session.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
let ran = 0;
const check = (name, cond, detail) => {
  ran += 1;
  if (cond) return console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abandonlaunch-'));
const timeout = Object.assign(new Error('Command failed: /usr/bin/osascript …'), { killed: true, signal: 'SIGTERM' });
const refused = Object.assign(new Error('Command failed: execution error: Not authorised (-1743)'), { code: 1 });

console.log('abandonLaunchFiles — what a failed launch leaves on disk');

check('a killed osascript reads as a timeout', launchTimedOut(timeout));
check('a refusal does not', !launchTimedOut(refused));
check('nor does no error at all', !launchTimedOut(null));

const files = (tag) => {
  const f = {
    prompt: path.join(tmp, `beadcause-${tag}.md`),
    system: path.join(tmp, `beadcause-sys-${tag}.md`),
    command: path.join(tmp, `beadcause-cmd-${tag}.zsh`),
  };
  fs.writeFileSync(f.prompt, 'the brief');
  fs.writeFileSync(f.system, 'the role');
  fs.writeFileSync(f.command, 'echo RAN-THE-REAL-COMMAND; exit\n');
  return f;
};

const t = files('timeout');
abandonLaunchFiles(timeout, t);
check('on a timeout the prompt and system files go', !fs.existsSync(t.prompt) && !fs.existsSync(t.system));
check('but the command file stays, for a tab that may still be coming', fs.existsSync(t.command));
check(
  'and it no longer holds the real command',
  fs.existsSync(t.command) && !fs.readFileSync(t.command, 'utf8').includes('RAN-THE-REAL-COMMAND')
);

// Source it the way a late tab would: `launchArgs`'s own script, in a login zsh, with a
// sentinel in place of the prompt shell it `exec`s afterwards. Reaching the sentinel is
// exactly "this tab came back to a prompt".
const PROMPT_SHELL = 'exec /bin/zsh -il';
const script = launchArgs(t.command).at(-1);
const got = spawnSync('/bin/zsh', ['-lc', `${script.slice(0, -PROMPT_SHELL.length)}echo STILL-AT-A-PROMPT`], {
  encoding: 'utf8',
  timeout: 60000,
});
const out = `${got.stdout || ''}${got.stderr || ''}`;
check('a late tab runs none of the real command', !out.includes('RAN-THE-REAL-COMMAND'), out.slice(0, 200));
check('it says nothing about a missing file', !/no such file/.test(out), out.slice(0, 200));
check('its shell exits, so iTerm closes the tab', !out.includes('STILL-AT-A-PROMPT'), out.slice(0, 200));
check('and the command file takes itself away', !fs.existsSync(t.command));

const r = files('refused');
abandonLaunchFiles(refused, r);
check(
  'a refusal still deletes all three',
  !fs.existsSync(r.prompt) && !fs.existsSync(r.system) && !fs.existsSync(r.command)
);

const c = files('commandonly');
abandonLaunchFiles(timeout, { command: c.command });
check('an opener with only a command file gets the same rewrite', fs.existsSync(c.command) && !fs.readFileSync(c.command, 'utf8').includes('RAN-THE-REAL-COMMAND'));

// Every opener's failure path goes through the helper. A `fs.rmSync(commandFile` left in
// any of them is the old behaviour coming back.
const src = fs.readFileSync(path.join(HERE, '..', 'lib', 'session.js'), 'utf8');
const openers = ['\nasync function launch(', '\nexport async function openResumedWindow(', '\nexport async function openCommandWindow('];
for (const head of openers) {
  const start = src.indexOf(head);
  const end = src.indexOf('\nexport ', start + head.length);
  const body = start < 0 ? '' : src.slice(start, end < 0 ? undefined : end);
  const name = head.replace(/^\n(export )?async function |\($/g, '');
  check(`${name} cleans up through abandonLaunchFiles`, /abandonLaunchFiles\(err,/.test(body), start < 0 ? 'opener not found' : '');
  check(`${name} never deletes its command file directly`, body && !/rmSync\(\s*commandFile/.test(body) && !/\[promptFile, systemFile, commandFile\]\)\s*fs\.rmSync/.test(body));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${ran - failures}/${ran} passed`);
process.exit(failures ? 1 : 0);
