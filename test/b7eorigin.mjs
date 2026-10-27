#!/usr/bin/env node
//
// b7e-origin — run git fetch/push/ls-remote against origin as the account that can
// actually reach it (bc-dgx7.160).
//
//   npm test
//   node test/b7eorigin.mjs
//
// Two fakes, for two different questions. A fake `gh` (lifted from test/pr.mjs's own,
// narrowed to what `lib/pr.js`'s account resolution actually calls) answers "which
// account can see this repo, and with what permission" without a network or a real
// login. A fake `git` answers a sharper question that a real local clone cannot: six
// sessions typed a working `GH_TOKEN` by hand because nothing carried the resolved
// account down to the `git` call itself, so the one thing worth proving directly is
// that the child `git` process actually receives it. Where the point is instead "does
// this tool really fetch/push/ls-remote", a real local clone with a real `origin`
// remote is used instead, the same argument test/b7ebase.mjs makes for its own suite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TOOL = path.join(ROOT, 'bin', 'b7e-origin');

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${String(detail).split('\n').join('\n      ')}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

/* --------------------------------------------------------------- the fakes */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7eorigin-'));

const GH_BIN = path.join(tmp, 'gh-bin');
const GIT_BIN = path.join(tmp, 'git-bin');
for (const d of [GH_BIN, GIT_BIN]) fs.mkdirSync(d, { recursive: true });

const GH_STATE = path.join(tmp, 'gh-state.json');
const GH_LOG = path.join(tmp, 'gh-calls.log');
const GIT_LOG = path.join(tmp, 'git-calls.log');

// Extensionless, so node runs it as CommonJS whatever this package's "type" says — same
// reason test/pr.mjs's own fake does it this way.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.GH_FAKE_STATE, 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync(state.log, JSON.stringify({ args, token: process.env.GH_TOKEN || null }) + '\\n');
const out = (s) => { process.stdout.write(s); process.exit(0); };
const fail = (msg) => { process.stderr.write(msg + '\\nUsage: gh <command> <subcommand> [flags]\\n'); process.exit(1); };
const a = args[0], b = args[1], rest = args.slice(2);
if (a === 'auth' && b === 'status') {
  if (!state.auth || !state.auth.ok) fail((state.auth && state.auth.stderr) || 'You are not logged into any GitHub hosts.');
  const accts = state.auth.accounts || [];
  const lines = ['github.com'];
  for (const acc of accts) {
    lines.push('  \\u2713 Logged in to github.com account ' + acc.user + ' (keyring)');
    lines.push('  - Active account: ' + (acc.active ? 'true' : 'false'));
  }
  out(lines.join('\\n') + '\\n');
}
if (a === 'auth' && b === 'token') {
  const user = rest[rest.indexOf('--user') + 1];
  const token = (state.tokens || {})[user];
  if (!token) fail('no oauth token found for ' + user);
  out(token + '\\n');
}
if (a === 'repo' && b === 'view') {
  if (state.repoByToken) {
    const seen = state.repoByToken[process.env.GH_TOKEN || ''];
    if (!seen) fail("GraphQL: Could not resolve to a Repository with the name 'them/private'. (repository)");
    out(JSON.stringify(seen));
  }
  if (!state.repo) fail('none of the git remotes configured for this repository point to a known GitHub host');
  out(JSON.stringify(state.repo));
}
fail('unknown gh invocation: ' + args.join(' '));
`;
fs.writeFileSync(path.join(GH_BIN, 'gh'), FAKE_GH, { mode: 0o755 });

// A fake `git` that only ever has to answer the three subcommands b7e-origin itself is
// willing to run — it exists purely to make GH_TOKEN visible to an assertion, which no
// real local clone (no credential helper is ever consulted for a filesystem remote) can.
const FAKE_GIT = `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.GIT_FAKE_LOG, JSON.stringify({ args: process.argv.slice(2), token: process.env.GH_TOKEN || null }) + '\\n');
const sub = process.argv[2];
if (sub === 'fetch') { process.stdout.write('From origin\\n'); process.exit(0); }
if (sub === 'push') { process.stdout.write('To origin\\n * [new branch] x -> x\\n'); process.exit(0); }
if (sub === 'ls-remote') { process.stdout.write('abc123\\trefs/heads/main\\n'); process.exit(0); }
process.stderr.write('fake git: unexpected subcommand ' + sub + '\\n');
process.exit(1);
`;
fs.writeFileSync(path.join(GIT_BIN, 'git'), FAKE_GIT, { mode: 0o755 });

const world = (s = {}) => fs.writeFileSync(GH_STATE, JSON.stringify({ log: GH_LOG, auth: { ok: true }, ...s }, null, 2));
const resetLogs = () => {
  fs.writeFileSync(GH_LOG, '');
  fs.writeFileSync(GIT_LOG, '');
};
const ghCalls = () =>
  fs
    .readFileSync(GH_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const gitCalls = () =>
  fs
    .readFileSync(GIT_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

/** Spawn the real tool, with the fake `gh` always on PATH and the fake `git` optional. */
function runTool(cwd, args, { fakeGit = false } = {}) {
  const dirs = fakeGit ? [GIT_BIN, GH_BIN] : [GH_BIN];
  const PATH = `${dirs.join(path.delimiter)}${path.delimiter}${process.env.PATH}`;
  return spawnSync(process.execPath, [TOOL, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH, GH_FAKE_STATE: GH_STATE, GIT_FAKE_LOG: GIT_LOG },
  });
}

/* -------------------------------------------------------------- real clone */

/** git with an identity of its own, so this never depends on the machine's. */
const realGit = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

function makeOrigin(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  realGit(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'one\n');
  realGit(dir, 'add', '-A');
  realGit(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

function cloneWork(origin, name) {
  const dir = path.join(tmp, name);
  realGit(tmp, 'clone', '-q', origin, dir);
  return dir;
}

/* ==================================================== 1. ambient can write */

console.log('\nambient account already write-capable: real fetch/push/ls-remote run\n');

{
  world({ auth: { ok: true, accounts: [{ user: 'solo', active: true }] }, repo: { nameWithOwner: 'acme/widgets', viewerPermission: 'WRITE' } });
  resetLogs();

  const origin = makeOrigin('origin1');
  const work = cloneWork(origin, 'work1');
  realGit(work, 'checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(work, 'g.txt'), 'two\n');
  realGit(work, 'add', '-A');
  realGit(work, 'commit', '-q', '-m', 'a real commit');

  const which = runTool(work, ['--which']);
  check('--which exits 0', which.status === 0, `status ${which.status}\n${which.stdout}${which.stderr}`);
  check('--which names the repo and the account', /acme\/widgets via solo/.test(which.stdout), which.stdout);

  const push = runTool(work, ['push', 'origin', 'feature']);
  check('a real push exits 0', push.status === 0, `status ${push.status}\n${push.stdout}${push.stderr}`);

  const fetch = runTool(work, ['fetch', 'origin', 'main']);
  check('a real fetch exits 0', fetch.status === 0, `status ${fetch.status}\n${fetch.stdout}${fetch.stderr}`);

  const lsRemote = runTool(work, ['ls-remote', 'origin', 'refs/heads/feature']);
  check('ls-remote sees the branch it just pushed', lsRemote.status === 0 && /refs\/heads\/feature/.test(lsRemote.stdout), lsRemote.stdout);

  // Proves it against the origin clone itself, not just against the tool's exit code.
  const branches = realGit(origin, 'branch', '--list', 'feature');
  check('the push actually landed on origin', /feature/.test(branches), branches);
}

/* =============================================== 2. named account can write */

console.log('\nambient cannot see it; a second logged-in account can — GH_TOKEN follows it\n');

{
  world({
    auth: { ok: true, accounts: [{ user: 'mordam', active: true }, { user: 'NeanderthalMan', active: false }] },
    tokens: { NeanderthalMan: 'tok-neanderthalman' },
    repoByToken: { '': null, 'tok-neanderthalman': { nameWithOwner: 'NeanderthalMan/beadcause', viewerPermission: 'WRITE' } },
  });
  resetLogs();

  const cwd = fs.mkdtempSync(path.join(tmp, 'anywhere-'));

  const which = runTool(cwd, ['--which']);
  check('--which resolves past the ambient account to the one that can write', which.status === 0, `${which.stdout}${which.stderr}`);
  check('--which names NeanderthalMan, not mordam', /NeanderthalMan\/beadcause via NeanderthalMan/.test(which.stdout), which.stdout);

  resetLogs();
  const fetch = runTool(cwd, ['fetch', 'origin', 'main'], { fakeGit: true });
  check('fetch exits 0 once an account is resolved', fetch.status === 0, `status ${fetch.status}\n${fetch.stdout}${fetch.stderr}`);
  const calls = gitCalls();
  check('exactly one git call was made', calls.length === 1, JSON.stringify(calls));
  check(
    'and it carried NeanderthalMan\'s token, never mordam\'s (empty) ambient one',
    calls[0]?.token === 'tok-neanderthalman',
    JSON.stringify(calls)
  );

  resetLogs();
  const push = runTool(cwd, ['push', '--set-upstream', 'origin', 'x:x'], { fakeGit: true });
  check('push exits 0 too', push.status === 0, `status ${push.status}\n${push.stdout}${push.stderr}`);
  check('the push also carried the resolved token', gitCalls()[0]?.token === 'tok-neanderthalman', JSON.stringify(gitCalls()));
}

/* ==================================================== 3. nobody can see it */

console.log('\nno logged-in account can see the repo: named, exit 3, git never runs\n');

{
  world({
    auth: { ok: true, accounts: [{ user: 'mordam', active: true }, { user: 'someoneelse', active: false }] },
    tokens: { someoneelse: 'tok-someoneelse' },
    repoByToken: {}, // every token, including '', fails seenBy
  });
  resetLogs();

  const cwd = fs.mkdtempSync(path.join(tmp, 'nobody-'));

  const which = runTool(cwd, ['--which'], { fakeGit: true });
  check('--which exits 3', which.status === 3, `status ${which.status}\n${which.stdout}${which.stderr}`);
  check('names both accounts it tried', /mordam/.test(which.stderr) && /someoneelse/.test(which.stderr), which.stderr);
  check('never prints a bare "Repository not found"', !/Repository not found/i.test(which.stderr), which.stderr);

  resetLogs();
  const fetch = runTool(cwd, ['fetch', 'origin', 'main'], { fakeGit: true });
  check('fetch also exits 3 rather than trying and failing', fetch.status === 3, `status ${fetch.status}\n${fetch.stderr}`);
  check('git was never invoked at all', gitCalls().length === 0, JSON.stringify(gitCalls()));
}

/* ============================================================ 4. bad usage */

console.log('\nbad usage is refused before anything is resolved\n');

{
  world({ auth: { ok: true, accounts: [{ user: 'solo', active: true }] }, repo: { nameWithOwner: 'acme/widgets', viewerPermission: 'WRITE' } });
  resetLogs();
  const cwd = fs.mkdtempSync(path.join(tmp, 'badusage-'));

  const noArgs = runTool(cwd, []);
  check('no arguments at all exits 2', noArgs.status === 2, `status ${noArgs.status}`);

  const badSub = runTool(cwd, ['clone', 'origin', 'x']);
  check('an unsupported subcommand exits 2', badSub.status === 2, `status ${badSub.status}\n${badSub.stderr}`);
  check('and says which ones are supported', /fetch, push, ls-remote/.test(badSub.stderr), badSub.stderr);
  check('never even asked gh', ghCalls().length === 0, JSON.stringify(ghCalls()));

  const help = runTool(cwd, ['--help']);
  check('--help exits 0', help.status === 0, `status ${help.status}`);
  check('and prints usage', /b7e-origin/.test(help.stdout), help.stdout);
}

/* ============================================================== 5. --dir */

console.log('\n--dir names a checkout other than the current directory\n');

{
  world({ auth: { ok: true, accounts: [{ user: 'solo', active: true }] }, repo: { nameWithOwner: 'acme/widgets', viewerPermission: 'WRITE' } });
  resetLogs();

  const origin = makeOrigin('origin5');
  const work = cloneWork(origin, 'work5');
  const elsewhere = fs.mkdtempSync(path.join(tmp, 'elsewhere-'));

  const which = runTool(elsewhere, ['--which', '--dir', work]);
  check('--dir resolves against the named checkout, not cwd', which.status === 0, `${which.stdout}${which.stderr}`);
}

/* ---------------------------------------------------------------- verdict */

await cleanupTmp(tmp);
console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m\n` : '\n\x1b[32mall checks passed\x1b[0m\n');
process.exit(failures ? 1 : 0);
