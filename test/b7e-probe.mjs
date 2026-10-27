#!/usr/bin/env node
//
// b7e-probe — serve any repo's static web directory in headless Chrome and evaluate an
// expression against it (bc-dgx7.145).
//
//   npm test
//   node test/b7e-probe.mjs
//
// No Chrome anywhere in here, on purpose — this repo's suite deliberately does not depend
// on a browser (test/chromeprofile.mjs, test/chromeleak.mjs, test/eyeball.mjs are the
// precedents). `lib/probe.js` is written with the browser as an injected `driver`, so the
// run plan, the verdict and the HTTP serving are all driven here directly; the CDP calls
// in `bin/b7e-probe` are the one part a suite could only cover by launching the thing it
// was told not to.
//
// Three things are worth a real check rather than a unit test of the obvious kind:
//
//   1. LFS pointer resolution never touches disk. A pointer file in the served directory
//      has to come back as the real bytes from the main checkout, and the worktree's own
//      copy must be untouched afterwards — `git status` on it staying clean is the actual
//      acceptance criterion, not just "the HTTP response looked right".
//   2. `findMainCheckout` against a *real* linked worktree, the same `git worktree add`
//      idiom `test/at.mjs` and `test/blame.mjs` use for their own worktree-building
//      siblings — a fake filesystem would agree with itself about worktree semantics and
//      prove nothing.
//   3. A timeout names the CDP method it was waiting on, because that message is the
//      whole reason `withTimeout` exists rather than a bare `Promise.race`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MIME_TYPES,
  createProbeServer,
  findMainCheckout,
  globalReadyExpr,
  heartbeatInjection,
  isLfsPointer,
  parseDurationMs,
  planStates,
  runProbe,
  shapeRecord,
  slug,
  stateUrl,
  summaryLine,
  waitForGlobal,
  withTimeout,
} from '../lib/probe.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let failures = 0;
let ran = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, fn) => {
  ran += 1;
  try {
    fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};
const checkAsync = async (name, fn) => {
  ran += 1;
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-probe-test-'));
const write = (rel, body) => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
};

const get = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });

console.log('\nb7e-probe\n');

/* ------------------------------------------------------------------- LFS */

console.log('LFS pointer detection');

check('a real git-lfs pointer is recognised', () => {
  const buf = Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 4200\n');
  assert.equal(isLfsPointer(buf), true);
});

check('an ordinary text file that happens to be small is not a pointer', () => {
  assert.equal(isLfsPointer(Buffer.from('hello world\n')), false);
});

check('a large file is never mistaken for a pointer even sharing the opening bytes', () => {
  const buf = Buffer.concat([Buffer.from('version https://git-lfs.github.com/spec/v1\n'), Buffer.alloc(4000, 'x')]);
  assert.equal(isLfsPointer(buf), false);
});

check('empty and null are not pointers', () => {
  assert.equal(isLfsPointer(Buffer.alloc(0)), false);
  assert.equal(isLfsPointer(null), false);
});

/* --------------------------------------------------------- main checkout */

console.log('\nfindMainCheckout — real git worktrees, no fakes');

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

function makeRepoWithWorktree() {
  const main = path.join(tmp, 'lfsrepo');
  fs.mkdirSync(main, { recursive: true });
  git(main, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(main, 'web'), { recursive: true });
  fs.writeFileSync(path.join(main, 'web', 'asset.bin'), Buffer.alloc(4096, 7));
  fs.writeFileSync(path.join(main, 'web', 'index.html'), '<!doctype html><title>x</title>');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'first');
  const branchDir = path.join(tmp, 'lfsrepo-worktree');
  git(main, 'worktree', 'add', '-q', '-b', 'feature', branchDir);
  // The worktree's own copy is replaced with a pointer, the way a fresh LFS checkout
  // would arrive — `git lfs pull` silently no-ops in a worktree, so this is the state a
  // caller actually has, not a stand-in for it.
  fs.writeFileSync(path.join(branchDir, 'web', 'asset.bin'), 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 4096\n');
  return { main, branchDir };
}

check('the main checkout is null for a checkout that is not a linked worktree', () => {
  const main = path.join(tmp, 'solo');
  fs.mkdirSync(main, { recursive: true });
  git(main, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(main, 'f'), 'x');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'x');
  assert.equal(findMainCheckout(main), null);
});

check('a non-git directory answers null rather than throwing', () => {
  const dir = path.join(tmp, 'notgit');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(findMainCheckout(dir), null);
});

const { main: lfsMain, branchDir: lfsWorktree } = makeRepoWithWorktree();

check('a linked worktree resolves back to its main checkout', () => {
  assert.equal(fs.realpathSync(findMainCheckout(lfsWorktree)), fs.realpathSync(lfsMain));
});

/* -------------------------------------------------------------- serving */

console.log('\ncreateProbeServer — a plain static server, and LFS resolution at serve time only');

await checkAsync('serves an ordinary file from the served directory', async () => {
  const server = await createProbeServer({ root: lfsMain, serveDir: 'web' });
  try {
    const r = await get(`${server.origin}/index.html`);
    assert.equal(r.status, 200);
    assert.match(r.body.toString('utf8'), /<title>x<\/title>/);
  } finally {
    await server.close();
  }
});

await checkAsync('a missing file is a 404, not a throw', async () => {
  const server = await createProbeServer({ root: lfsMain, serveDir: 'web' });
  try {
    const r = await get(`${server.origin}/nope.js`);
    assert.equal(r.status, 404);
  } finally {
    await server.close();
  }
});

await checkAsync('a request path cannot escape the served directory', async () => {
  const server = await createProbeServer({ root: lfsMain, serveDir: 'web' });
  try {
    const r = await get(`${server.origin}/../../../etc/passwd`);
    assert.notEqual(r.status, 200);
  } finally {
    await server.close();
  }
});

await checkAsync('an LFS pointer in the worktree is answered with the main checkout\'s real bytes', async () => {
  const server = await createProbeServer({ root: lfsWorktree, serveDir: 'web' });
  try {
    const r = await get(`${server.origin}/asset.bin`);
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 4096);
    assert.ok(r.body.every((b) => b === 7), 'expected the real bytes, not the pointer text');
  } finally {
    await server.close();
  }
});

check('resolving a pointer never writes to the worktree\'s own file', () => {
  // Serving the real bytes over HTTP above must not have touched disk — the bead's own
  // text rules out exactly that (it is what left `git status` permanently dirty in an
  // earlier approach). The pointer file on disk has to be byte-for-byte what it was
  // before anything was served, not merely "still present".
  const onDisk = fs.readFileSync(path.join(lfsWorktree, 'web', 'asset.bin'), 'utf8');
  assert.match(onDisk, /^version https:\/\/git-lfs\.github\.com\/spec\/v1/);
  assert.equal(onDisk.length, 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 4096\n'.length);
});

await checkAsync('takeResolved names the pointer path once, then clears', async () => {
  const server = await createProbeServer({ root: lfsWorktree, serveDir: 'web' });
  try {
    await get(`${server.origin}/asset.bin`);
    assert.deepEqual(server.takeResolved(), ['asset.bin']);
    assert.deepEqual(server.takeResolved(), []);
  } finally {
    await server.close();
  }
});

await checkAsync('a repo with no LFS pointers at all is untouched — nothing to resolve, nothing served wrong', async () => {
  const server = await createProbeServer({ root: lfsMain, serveDir: 'web' });
  try {
    await get(`${server.origin}/asset.bin`);
    assert.deepEqual(server.takeResolved(), []);
  } finally {
    await server.close();
  }
});

await checkAsync('--baseline serves a committed ref instead of the working tree', async () => {
  const work = path.join(tmp, 'baselinerepo');
  fs.mkdirSync(path.join(work, 'site'), { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'site', 'index.html'), 'one');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'one');
  const first = git(work, 'rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(work, 'site', 'index.html'), 'two');
  const server = await createProbeServer({ root: work, serveDir: 'site', baseline: first });
  try {
    const r = await get(`${server.origin}/index.html`);
    assert.equal(r.body.toString('utf8'), 'one');
  } finally {
    await server.close();
  }
});

await checkAsync('an unknown extension still serves rather than refusing', async () => {
  const server = await createProbeServer({ root: lfsMain, serveDir: 'web' });
  try {
    fs.writeFileSync(path.join(lfsMain, 'web', 'thing.xyz'), 'hi');
    const r = await get(`${server.origin}/thing.xyz`);
    assert.equal(r.status, 200);
  } finally {
    await server.close();
    fs.rmSync(path.join(lfsMain, 'web', 'thing.xyz'), { force: true });
  }
});

check('MIME_TYPES covers the binary types the bead names', () => {
  for (const ext of ['.bin', '.png', '.mjs', '.js', '.html']) assert.ok(MIME_TYPES[ext], `missing ${ext}`);
});

/* ----------------------------------------------------------------- states */

console.log('\nplanStates / stateUrl');

check('the default is one state, the bare page with no hash', () => {
  const states = planStates({});
  assert.equal(states.length, 1);
  assert.equal(states[0].hash, '');
  assert.equal(states[0].width, DEFAULT_WIDTH);
  assert.equal(states[0].height, DEFAULT_HEIGHT);
});

check('one state per --hash, and a leading # is optional', () => {
  const states = planStates({ hashes: ['z=12&bp=12900', '#z=8'] });
  assert.deepEqual(
    states.map((s) => s.hash),
    ['z=12&bp=12900', 'z=8']
  );
});

check('a hashless state URLs to the bare origin', () => {
  assert.equal(stateUrl('http://127.0.0.1:9', { hash: '' }), 'http://127.0.0.1:9/');
});

check('a hash state URLs with the fragment attached', () => {
  assert.equal(stateUrl('http://127.0.0.1:9', { hash: 'z=12' }), 'http://127.0.0.1:9/#z=12');
});

check('slug is filesystem-safe and stable', () => {
  assert.equal(slug('#z=12&bp=12900'), 'z-12-bp-12900');
  assert.equal(slug(''), 'index');
});

/* ----------------------------------------------------------------- waiting */

console.log('\nwaitForGlobal — polling for a page global before measuring');

check('globalReadyExpr checks typeof against the given name', () => {
  assert.match(globalReadyExpr('OV_PERIOD'), /window\["OV_PERIOD"\]/);
});

await checkAsync('resolves true as soon as the global appears', async () => {
  let calls = 0;
  const evalJs = async () => {
    calls += 1;
    return calls >= 3;
  };
  const found = await waitForGlobal({ evalJs, name: 'x', timeoutMs: 10_000, intervalMs: 1, sleep: () => Promise.resolve() });
  assert.equal(found, true);
  assert.equal(calls, 3);
});

await checkAsync('gives up and answers false once the deadline actually passes', async () => {
  const evalJs = async () => false;
  let now = 0;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const found = await waitForGlobal({
      evalJs,
      name: 'x',
      timeoutMs: 100,
      intervalMs: 10,
      sleep: (ms) => {
        now += ms + 1;
        return Promise.resolve();
      },
    });
    assert.equal(found, false);
  } finally {
    Date.now = realNow;
  }
});

/* -------------------------------------------------------------- heartbeat */

console.log('\nheartbeatInjection — the setTimeout stand-in for a long-task observer');

check('defines a start/stop pair on window, not a PerformanceObserver', () => {
  const src = heartbeatInjection();
  assert.match(src, /window\.__b7eHeartbeat/);
  assert.match(src, /setInterval/);
  assert.doesNotMatch(src, /PerformanceObserver/);
});

/* ------------------------------------------------------------------- time */

console.log('\nparseDurationMs / withTimeout');

check('bare seconds, milliseconds and a bare number all parse', () => {
  assert.equal(parseDurationMs('60s', 1), 60_000);
  assert.equal(parseDurationMs('1500ms', 1), 1500);
  assert.equal(parseDurationMs('5', 1), 5000);
  assert.equal(parseDurationMs(null, 42), 42);
});

check('nonsense is NaN, not a silent fallback', () => {
  assert.ok(Number.isNaN(parseDurationMs('soon', 1)));
});

await checkAsync('a promise that settles first wins', async () => {
  const v = await withTimeout(Promise.resolve('value'), 1000, 'Runtime.evaluate');
  assert.equal(v, 'value');
});

await checkAsync('a promise that never settles times out naming the method it was waiting on', async () => {
  const never = new Promise(() => {});
  await assert.rejects(() => withTimeout(never, 10, 'Runtime.evaluate'), (e) => e.message.includes('Runtime.evaluate') && e.message.includes('10ms'));
});

/* ---------------------------------------------------------------- records */

console.log('\nshapeRecord / runProbe / summaryLine');

check('a clean evaluate is ok, with console/network problems reported but not failing it', () => {
  const r = shapeRecord(
    { hash: 'z=12', width: 1440, height: 900 },
    { value: 12, problems: [{ kind: 'console.error', text: 'boom' }, { kind: 'http', text: '404 /api/x' }], failed: null, resolvedFiles: [], shot: false }
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.consoleErrors, ['boom']);
  assert.deepEqual(r.failedRequests, ['404 /api/x']);
  assert.equal(r.value, 12);
});

check('a thrown or timed-out evaluate is the only thing that fails a record', () => {
  const r = shapeRecord({ hash: '', width: 1440, height: 900 }, { value: undefined, problems: [], failed: 'timed out waiting on Runtime.evaluate (5000ms)', resolvedFiles: [], shot: false });
  assert.equal(r.ok, false);
  assert.deepEqual(r.reasons, ['timed out waiting on Runtime.evaluate (5000ms)']);
});

check('resolvedFiles and screenshot pass through the record untouched', () => {
  const r = shapeRecord({ hash: '', width: 1440, height: 900, png: '/tmp/x.png' }, { value: 1, problems: [], failed: null, resolvedFiles: ['asset.bin'], shot: true });
  assert.deepEqual(r.resolvedFiles, ['asset.bin']);
  assert.equal(r.screenshot, '/tmp/x.png');
});

await checkAsync('runProbe drives every state through the injected driver, in order', async () => {
  const seen = [];
  const driver = {
    async shoot(state) {
      seen.push(state.hash);
      return { value: state.hash.length, problems: [], failed: null, resolvedFiles: [], shot: false };
    },
  };
  const states = planStates({ hashes: ['a', 'bb', 'ccc'] });
  const { records, ok: allOk } = await runProbe({ states, driver });
  assert.deepEqual(seen, ['a', 'bb', 'ccc']);
  assert.deepEqual(records.map((r) => r.value), [1, 2, 3]);
  assert.equal(allOk, true);
});

await checkAsync('a driver that throws produces a failed record instead of crashing the run', async () => {
  const driver = { async shoot() { throw new Error('Chrome went away'); } };
  const { records, ok: allOk } = await runProbe({ states: planStates({}), driver });
  assert.equal(allOk, false);
  assert.deepEqual(records[0].reasons, ['Chrome went away']);
});

check('summaryLine names the failed states by their hash', () => {
  const line = summaryLine([
    { ok: true, hash: 'a' },
    { ok: false, hash: 'z=12&bp=12900' },
  ]);
  assert.equal(line, '1/2 states clean, 1 failed: #z=12&bp=12900');
});

/* -------------------------------------------------------------------- bin */

console.log('\nbin/b7e-probe registration');

check('has its own @grant line, like every other Chrome-driving b7e- tool', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'b7e-probe'), 'utf8');
  assert.match(src, /@grant\s+excluded/);
});

check('registered in package.json and package-lock.json alike', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.bin['b7e-probe'], 'bin/b7e-probe');
  assert.equal(lock.packages[''].bin['b7e-probe'], 'bin/b7e-probe');
});

/* ------------------------------------------------------------------ done */

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${ran - failures}/${ran} passed`);
process.exit(failures ? 1 : 0);
