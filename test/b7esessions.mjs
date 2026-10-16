#!/usr/bin/env node
/**
 * `b7e-sessions` — every session this Mac knows about and what the last boot did to it.
 * bin/b7e-sessions over lib/sessionregister.js.
 *
 *     npm test
 *     node test/b7esessions.mjs
 *
 * bc-5to5r.3's acceptance, replayed against the real command on an isolated config
 * directory: a session record whose pid is *this suite's own* (so it is live by the only
 * test that matters, a signal 0 to the kernel), a register row from before the boot that
 * the pass never got to, a report for *this* boot with one window reopened and one skipped
 * for a retired worktree, and a transcript for one of them so the last-write column has
 * something to say. The command reads all four and writes nothing — asserted by hashing the
 * directory before and after.
 *
 * The report's boot is stamped a few hundred milliseconds off this machine's, on purpose:
 * that is the drift two processes reading `os.uptime()` actually have, and an exact
 * comparison would have made the daemon's own report invisible to this command.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-sessions');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7esessions-'));
process.on('exit', () => removeTreeSync(tmp));
const config = path.join(tmp, 'config');
const sessions = path.join(tmp, 'sessions');
const projects = path.join(tmp, 'projects');
for (const d of [config, sessions, projects]) fs.mkdirSync(d, { recursive: true });

const id = (n) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`;
const boot = Date.now() - os.uptime() * 1000;
const iso = (ms) => new Date(ms).toISOString();

fs.writeFileSync(
  path.join(config, 'config.json'),
  JSON.stringify({ token: 'x', claudeSessionsDir: sessions, claudeProjectsDir: projects, ntfy: { enabled: false } }, null, 2)
);
// Live: a record whose pid is ours.
fs.writeFileSync(
  path.join(sessions, `${process.pid}.json`),
  JSON.stringify({
    pid: process.pid,
    sessionId: id(1),
    cwd: '/r/beadcause/.claude/worktrees/session-register-k7w',
    kind: 'interactive',
    name: 'beadcause - bc-5to5r register',
    status: 'busy',
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now(),
  })
);
// And one whose pid is long gone, so the record is not a live session.
fs.writeFileSync(
  path.join(sessions, '999999.json'),
  JSON.stringify({ pid: 999999, sessionId: id(9), cwd: '/r/gone', kind: 'interactive', name: 'gone - closed' })
);
// The register: the live one, plus one from before the boot the pass never got to.
fs.writeFileSync(
  path.join(config, 'sessions.json'),
  JSON.stringify({
    polledAt: iso(Date.now() - 30_000),
    sessions: {
      [id(1)]: { cwd: '/r/beadcause/.claude/worktrees/session-register-k7w', name: 'beadcause - bc-5to5r register', kind: 'interactive', lastSeen: iso(Date.now() - 30_000) },
      [id(4)]: { cwd: '/r/ehden', name: 'EHDEN - exit-cone baseline fix', kind: 'interactive', lastSeen: iso(boot - 45_000) },
    },
  })
);
// The report for this boot, a few hundred ms off as a second process would read it.
fs.writeFileSync(
  path.join(config, 'state.json'),
  JSON.stringify({
    rebootResumedAt: iso(boot + 300),
    rebootReport: {
      boot: iso(boot + 300),
      at: iso(boot + 40_000),
      rows: [
        { sessionId: id(2), name: 'loremia - lm-p4cq species refs', dir: '/r/loremia/.claude/worktrees/species-refs-4c9', outcome: 'reopened', why: null },
        { sessionId: id(3), name: 'ada.log - job apps', dir: '/r/ada.log/.claude/worktrees/job-apps-b4e', outcome: 'skipped', why: 'its directory is gone — the worktree was retired' },
      ],
    },
    opened: {},
  })
);
// A transcript for the reopened one, written an hour ago.
const folder = path.join(projects, '-r-loremia--claude-worktrees-species-refs-4c9');
fs.mkdirSync(folder, { recursive: true });
const transcript = path.join(folder, `${id(2)}.jsonl`);
fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', cwd: '/r/loremia/.claude/worktrees/species-refs-4c9' })}\n`);
fs.utimesSync(transcript, (Date.now() - 3_600_000) / 1000, (Date.now() - 3_600_000) / 1000);

const digest = () =>
  crypto
    .createHash('sha256')
    .update(
      fs
        .readdirSync(config)
        .sort()
        .map((f) => `${f}:${fs.readFileSync(path.join(config, f))}`)
        .join('\n')
    )
    .digest('hex');

const run = (...args) =>
  spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, BEADCAUSE_CONFIG_DIR: config },
  });

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
}

console.log('bin/b7e-sessions — the table of sessions and what the boot did to them\n');

const before = digest();
const table = run();
check('it exits 0 and prints a table', () => {
  assert.equal(table.status, 0, table.stderr);
  assert.match(table.stdout, /^this Mac booted .* \(\d{4}-/m);
});
check('the header says the pass ran for this boot, and what it did', () => {
  assert.match(table.stdout, /^the reboot pass ran .*: 1 reopened, 1 skipped$/m);
  assert.match(table.stdout, /^register last polled a moment ago$/m);
});
check('the live window is live, with its bead read off its name and its worktree said short', () => {
  assert.match(table.stdout, /^beadcause - bc-5to5r register\s+beadcause ⟶ session-register-k7w\s+bc-5to5r\s+live\b/m);
});
check('the reopened window says so, with its bead and the age of its transcript', () => {
  assert.match(table.stdout, /^loremia - lm-p4cq species refs\s+loremia ⟶ species-refs-4c9\s+lm-p4cq\s+reopened\s+an hour ago$/m);
});
check('the skipped window carries the reason', () => {
  assert.match(table.stdout, /^ada\.log - job apps\s+ada\.log ⟶ job-apps-b4e\s+skipped — its directory is gone — the worktree was retired$/m);
});
check('a register row from before the boot that the pass never mentioned is waiting', () => {
  assert.match(table.stdout, /^EHDEN - exit-cone baseline fix\s+ehden\s+alive at shutdown, not yet brought back$/m);
});
check('a record whose pid is dead is not a session', () => {
  assert.ok(!table.stdout.includes('gone - closed'), table.stdout);
});
check('live rows come first, then what the pass did, then what it declined', () => {
  const order = ['bc-5to5r register', 'species refs', 'exit-cone', 'job apps'].map((s) => table.stdout.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order, table.stdout);
});
check('--json carries the same rows with the same statuses', () => {
  const r = run('--json');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const by = Object.fromEntries(out.rows.map((row) => [row.sessionId, row]));
  assert.equal(by[id(1)].status, 'live');
  assert.equal(by[id(1)].pid, process.pid);
  assert.equal(by[id(2)].status, 'reopened');
  assert.equal(by[id(2)].bead, 'lm-p4cq');
  assert.equal(by[id(3)].status, 'skipped');
  assert.match(by[id(3)].why, /worktree was retired/);
  assert.equal(by[id(4)].status, 'waiting');
  assert.ok(Number.isFinite(Date.parse(out.boot)));
  assert.equal(Date.parse(out.report.boot), boot + 300);
});
check('it writes nothing', () => {
  assert.equal(digest(), before);
});
check('--help and a bad flag', () => {
  assert.equal(run('--help').status, 0);
  const bad = run('--bogus');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown argument --bogus/);
});

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
