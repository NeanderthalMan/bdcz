#!/usr/bin/env node
/**
 * Every `bd` the daemon spawns is told not to push Dolt's signpost branch — bc-ii5zy.
 *
 *     npm test
 *     node test/doltsignpost.mjs
 *
 * `bd dolt push` force-pushes an orphan `__dolt_remote_info__` branch to the sync remote
 * unless DOLT_REMOTE_INFO_BRANCH is set **and empty**. For the architecture workspace that
 * remote is a shared team repo, and every push put a "Compare & pull request" banner
 * in front of the whole team, about ten times a day. Interactive shells carry the empty
 * value from ~/.zshenv; the daemon runs under launchd and spawns through execFile, so it
 * only ever has what `Bd.run` builds. Nothing pinned that environment before this.
 *
 * A fake `bd` prints the environment it was given, so the assertion is on what the child
 * actually received, not on the object that was meant to become it. Both directions of the
 * parent's environment are covered: the variable absent (launchd), and set to a name
 * (which would only rename the branch, not suppress it).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { Bd } = await import(path.join(HERE, '..', 'lib', 'bd.js'));

let failures = 0;
let ran = 0;
const check = async (fn, name) => {
  ran += 1;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n').slice(0, 6).join('\n      ')}`);
  }
};

console.log('\nthe Dolt signpost branch is suppressed for every bd the daemon spawns\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-doltsignpost-'));
const wsDir = path.join(tmp, '.beads');
fs.mkdirSync(wsDir);
const fakeBd = path.join(tmp, 'bd');
// JSON, so an empty value is distinguishable from a missing one.
fs.writeFileSync(
  fakeBd,
  `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ has: 'DOLT_REMOTE_INFO_BRANCH' in process.env, value: process.env.DOLT_REMOTE_INFO_BRANCH ?? null }));\n`
);
fs.chmodSync(fakeBd, 0o755);

const workspace = { name: 'demo', dir: wsDir };
const childSaw = async () => JSON.parse(await new Bd({ bin: fakeBd, actor: 'beadcause' }).run(workspace, ['dolt', 'push']));

const saved = process.env.DOLT_REMOTE_INFO_BRANCH;
try {
  await check(async () => {
    delete process.env.DOLT_REMOTE_INFO_BRANCH;
    assert.deepEqual(await childSaw(), { has: true, value: '' });
  }, 'with the variable unset in the daemon (launchd), bd still gets it, empty');

  await check(async () => {
    process.env.DOLT_REMOTE_INFO_BRANCH = 'some-branch';
    assert.deepEqual(await childSaw(), { has: true, value: '' });
  }, 'with a non-empty value in the daemon, bd gets the empty one — a name would only rename the branch');
} finally {
  if (saved === undefined) delete process.env.DOLT_REMOTE_INFO_BRANCH;
  else process.env.DOLT_REMOTE_INFO_BRANCH = saved;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures}/${ran} failed\n` : `\n${ran}/${ran} passed\n`);
process.exit(failures ? 1 : 0);
