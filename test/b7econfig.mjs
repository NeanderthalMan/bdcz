#!/usr/bin/env node
/**
 * `b7e-config` — what this install actually resolves to. bin/b7e-config and
 * lib/configreport.js.
 *
 *     npm test
 *     node test/b7econfig.mjs
 *
 * bc-dgx7.110's acceptance criteria, replayed against a made-up config dir:
 *
 * 1. `--json` names every workspace with both its `.beads` dir and its checkout
 *    root, and the two are never the same string.
 * 2. `-b <bead>` agrees with `state.json`'s answered map for a bead that has a
 *    record, and prints an explicit "no record" for one that does not.
 * 3. `BEADCAUSE_CONFIG_DIR=<tmp> b7e-config` reports the tmp dir, not
 *    `~/.config/beadcause`, and says the override is in force.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-config');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7econfig-'));
process.on('exit', () => removeTreeSync(tmp));

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * A config dir with two workspaces, each a real directory on disk so
 * `reconcileWorkspaces` keeps them (it drops a saved entry whose `dir` no longer
 * exists) — `alpha` a container-style `.beads` under `tmp/beads-root`, `beta` an
 * in-repo-shaped one directly under its own checkout, mirroring the two real
 * shapes `lib/workspaceroots.js` documents.
 */
function makeConfigDir({ answered } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'config-'));
  const alphaBeads = path.join(tmp, 'beads-root', 'alpha', '.beads');
  const betaBeads = path.join(tmp, 'checkouts', 'beta', '.beads');
  fs.mkdirSync(alphaBeads, { recursive: true });
  fs.mkdirSync(betaBeads, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify(
      {
        bdBin: '/usr/bin/true',
        actor: 'beadcause-test',
        workspaces: [
          { name: 'alpha', dir: alphaBeads },
          { name: 'beta', dir: betaBeads },
        ],
      },
      null,
      2
    )
  );
  if (answered) fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ answered }, null, 2));
  return dir;
}

const STATE_ANSWERED = {
  'alpha/al-42': { at: '2026-08-25T12:00:00Z', response: 'Ship it as the API-only option.', count: 1 },
};
const CONFIG_DIR = makeConfigDir({ answered: STATE_ANSWERED });

function run(args, { configDir = CONFIG_DIR, env = {} } = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: tmp,
    env: { ...process.env, HOME: tmp, BEADCAUSE_CONFIG_DIR: configDir, ...env },
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: stripAnsi(res.stdout || ''), stderr: stripAnsi(res.stderr || '') };
}

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 10).join('\n       ')}`);
  }
};

console.log('\nb7e-config\n');

check('--help prints usage and exits 0', () => {
  const { status, stdout } = run(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /usage: b7e-config/);
});

check('with no flags: config dir, bd binary, actor, and every workspace print', () => {
  const { status, stdout } = run([]);
  assert.equal(status, 0);
  assert.match(stdout, new RegExp(`config dir: ${CONFIG_DIR}`));
  assert.match(stdout, /bd binary: \/usr\/bin\/true/);
  assert.match(stdout, /actor: beadcause-test/);
  assert.match(stdout, /alpha/);
  assert.match(stdout, /beta/);
  // BEADCAUSE_CONFIG_DIR is genuinely set here (to CONFIG_DIR, the fixture) — every
  // check in this file needs that isolation from the real ~/.config/beadcause, so
  // this correctly reports an override. The no-override case is its own check below.
  assert.match(stdout, /override in force/);
});

check('--json names every workspace with .beads dir and checkout root, never the same string', () => {
  const { status, stdout } = run(['--json']);
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.workspaces.length, 2);
  for (const w of parsed.workspaces) {
    assert.ok(w.beadsDir, `${w.name} has no beadsDir`);
    assert.ok(w.checkoutRoot, `${w.name} has no checkoutRoot`);
    assert.notEqual(w.beadsDir, w.checkoutRoot);
  }
  const alpha = parsed.workspaces.find((w) => w.name === 'alpha');
  const beta = parsed.workspaces.find((w) => w.name === 'beta');
  // alpha is container-shaped (~/beads-root/alpha/.beads): the checkout is its
  // parent directory.
  assert.equal(alpha.checkoutRoot, path.dirname(alpha.beadsDir));
  // beta is in-repo-shaped (checkouts/beta/.beads): same relationship holds —
  // resolveSessionDir always answers the .beads dir's own parent absent a
  // sessionDirs/projectRoot override, which is exactly the fact this bead exists
  // to stop three sessions from re-deriving by hand.
  assert.equal(beta.checkoutRoot, path.dirname(beta.beadsDir));
});

check('--ws narrows the listing to one workspace', () => {
  const { status, stdout } = run(['--ws', 'alpha']);
  assert.equal(status, 0);
  assert.match(stdout, /alpha/);
  assert.doesNotMatch(stdout, /beta/);
});

check('--ws naming an unconfigured workspace says so, not silence', () => {
  const { status, stdout } = run(['--ws', 'nope']);
  assert.equal(status, 0);
  assert.match(stdout, /no workspace named "nope"/);
});

console.log('\nbc-dgx7.110: -b agrees with state.json\'s answered map\n');

check('-b on a bead with a record prints the response and when it was answered', () => {
  const { status, stdout } = run(['-b', 'al-42']);
  assert.equal(status, 0);
  assert.match(stdout, /alpha\/al-42: answered 2026-08-25T12:00:00Z/);
  assert.match(stdout, /Ship it as the API-only option\./);
});

check('-b --ws scopes the lookup to one exact key', () => {
  const { status, stdout } = run(['-b', 'al-42', '--ws', 'alpha']);
  assert.equal(status, 0);
  assert.match(stdout, /alpha\/al-42: answered/);
});

check('-b --ws naming the wrong workspace for a real bead reports no record, not a false match', () => {
  const { status, stdout } = run(['-b', 'al-42', '--ws', 'beta']);
  assert.equal(status, 0);
  assert.match(stdout, /no record for "al-42" in workspace beta/);
});

check('-b on a bead with no record prints "no record" explicitly, not nothing', () => {
  const { status, stdout } = run(['-b', 'nope-at-all']);
  assert.equal(status, 0);
  assert.match(stdout, /no record for "nope-at-all" in any configured workspace/);
  assert.match(stdout, /checked: alpha\/nope-at-all, beta\/nope-at-all/);
});

check('-b --json carries workspace/key/record null together for "not found"', () => {
  const { status, stdout } = run(['-b', 'nope-at-all', '--json']);
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.bead.workspace, null);
  assert.equal(parsed.bead.key, null);
  assert.equal(parsed.bead.record, null);
  assert.deepEqual(parsed.bead.checked, ['alpha/nope-at-all', 'beta/nope-at-all']);
});

check('-b --json carries the found record verbatim', () => {
  const { status, stdout } = run(['-b', 'al-42', '--json']);
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.bead.workspace, 'alpha');
  assert.equal(parsed.bead.key, 'alpha/al-42');
  assert.equal(parsed.bead.record.response, 'Ship it as the API-only option.');
  assert.equal(parsed.bead.record.count, 1);
});

console.log("\nBEADCAUSE_CONFIG_DIR override — reports the override, not the default\n");

check('BEADCAUSE_CONFIG_DIR=<tmp> reports the tmp dir and says the override is in force', () => {
  const overrideDir = fs.mkdtempSync(path.join(tmp, 'override-'));
  const { status, stdout } = run([], { configDir: overrideDir });
  assert.equal(status, 0);
  assert.match(stdout, new RegExp(`config dir: ${overrideDir}`));
  assert.match(stdout, /override in force/);
  assert.doesNotMatch(stdout, /\.config\/beadcause(?!\/)/);
});

check('an unset BEADCAUSE_CONFIG_DIR resolves under $HOME/.config/beadcause and is not reported as an override', () => {
  // `run()` always sets BEADCAUSE_CONFIG_DIR for every other check, to stay
  // isolated from whatever the real ~/.config/beadcause holds — this one instead
  // deletes it, with HOME still pointed at the tmp tree, so the default path is
  // exercised without touching the real install.
  const env = { ...process.env, HOME: tmp };
  delete env.BEADCAUSE_CONFIG_DIR;
  const res = spawnSync(process.execPath, [BIN], { encoding: 'utf8', cwd: tmp, env });
  assert.equal(res.status, 0);
  const stdout = stripAnsi(res.stdout || '');
  assert.match(stdout, new RegExp(`config dir: ${path.join(tmp, '.config', 'beadcause')}`));
  assert.doesNotMatch(stdout, /override in force/);
});

console.log(`\n${failures ? `\x1b[31m${failures} failed\x1b[0m` : '\x1b[32mall passed\x1b[0m'}\n`);
process.exit(failures ? 1 : 0);
