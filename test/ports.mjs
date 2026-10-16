#!/usr/bin/env node
//
// Losing the race for a port is not a broken build, and no two runs are handed the same
// number.
//
//   npm test
//   node test/ports.mjs
//
// bc-dw47: a full `npm test` on a merged, green branch died at suite 27 of 85 with
// `listen EADDRINUSE ... no address could be bound — exiting`, and passed on a straight
// re-run. Nothing was wrong with the branch: one of the ~20 other sessions on this laptop
// held the port for the moment that suite reached for it. bc-szkq and bc-fh86 had already
// removed every port somebody had *typed* — the number now always comes from the kernel —
// and this is what was left underneath, in two halves.
//
// **The half that matters outside the tests.** `bin/router.js` gives each backend a port
// from `freePort()` and then spawns the process that binds it. A backend that loses that
// race exits, and a backend that *exits* was — until this bead — a broken build, poisoned
// and not retried until the files moved. The comment said why that was safe: "the next
// spawn would break identically". For this one cause the opposite is true, so a good build
// was condemned over a port, the phone went on being served by the previous one, and the
// only evidence was a line in a log. Here that failure has its own exit code
// (`PORT_TAKEN_EXIT`), its own kind (`PORTLOST`), and an immediate retry on another port.
//
// **The half inside the tests.** The suites that must name a port before the process that
// binds it exists still use `freePort()`, and the window there is not a millisecond — the
// child has to start node and read a config first. So `freePort` now claims the number it
// hands back, in a directory every run shares, and the other runs skip a claimed number.
//
// What is deliberately not here: a claim cannot stop a *stranger* taking the port, only
// another beadcause run, which is the collision this laptop actually has. And the exit
// code is checked end to end against a real `bin/beadcause.js`, because a constant two
// files agree on proves nothing about the process that has to exit with it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CLAIM_DIR, claimPort, freePort, releasePorts } from './helpers/net.mjs';
import { EXITED, PORTLOST, PORT_ATTEMPTS, PORT_TAKEN_EXIT, STOPPED, exitKind, explain, poisonable } from '../lib/startup.js';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message.split('\n').join('\n      ')}`);
  }
}

/* ------------------------------------------------------- the policy, with no I/O in it */

console.log('lib/startup.js — a taken port is not a broken build\n');

await check('a child that exited with the bind code lost its port', () => {
  assert.equal(exitKind(PORT_TAKEN_EXIT), PORTLOST);
});

await check('a child that failed on its own says so with a number', () => {
  // Non-zero, and from a child that named it: that is the only evidence there is that
  // the *build* is what went wrong. 1 is a throw at import, 2 is node's own bad-
  // invocation code, 137 is a shell reporting a SIGKILL as 128+9.
  for (const code of [1, 2, 4, 137]) assert.equal(exitKind(code), EXITED, `exit ${code}`);
});

await check('a child that was stopped is not the build — bc-r0tx', () => {
  // A signal is somebody else's doing: memory pressure, a stray `pkill node`, a runner
  // tearing a suite down. `null` is what an exit code is for one, which is why the
  // signal has to be passed and why no code at all reads the same way.
  assert.equal(exitKind(null, 'SIGKILL'), STOPPED, 'a signalled child');
  assert.equal(exitKind(null, 'SIGTERM'), STOPPED, 'a signalled child');
  assert.equal(exitKind(null), STOPPED, 'no code and no signal is still not an accusation');
  assert.equal(exitKind(undefined), STOPPED);
  // And zero is the surprising one. Nothing broken exits zero — a syntax error, a bad
  // import and a bad config are all non-zero — so a zero is a child that chose to stop.
  assert.equal(exitKind(0), STOPPED, 'a clean exit is not a broken build');
  // The one path in this repo that produces it, pinned so the reading above cannot
  // quietly stop covering the case it was written for.
  const backend = fs.readFileSync(path.join(ROOT, 'bin', 'beadcause.js'), 'utf8');
  const guard = backend.indexOf('no router contact in');
  assert.ok(guard > 0, "the orphan guard's log line has moved");
  assert.match(
    backend.slice(guard, guard + 400),
    /process\.exit\(0\)/,
    'the orphan guard no longer exits 0, so the router is reading its exit as something else'
  );
});

await check('only the build may condemn the build', () => {
  assert.equal(poisonable(EXITED), true);
  assert.equal(poisonable(PORTLOST), false, 'a lost port must never poison a build — that is the bead');
  assert.equal(poisonable(STOPPED), false, 'a build that was stopped from outside must never be condemned — bc-r0tx');
  assert.equal(poisonable('timeout'), false);
});

await check('the bind exit code is its own number, not 1', () => {
  // If this ever becomes 1 the router cannot tell the two apart again, and the failure
  // comes back silently: a poisoned build that nobody can explain.
  assert.equal(PORT_TAKEN_EXIT, 3);
  assert.ok(PORT_ATTEMPTS >= 2, 'one attempt is not a retry');
});

await check('the console says a port was lost, not that the build was slow', () => {
  const deferred = {
    build: 'b2',
    attempts: PORT_ATTEMPTS,
    until: Date.now() + 30000,
    // `kind` is what the summary reads, and `why` is what the lines read. It used to be
    // `why` for both, which worked while there were only two answers; bc-r0tx added a
    // third deferral that also carries a `why` and is not about a port at all.
    kind: PORTLOST,
    why: 'build b2 lost the race for an internal port 3 times — something else on this Mac keeps taking it.',
  };
  const serving = explain({ active: { build: 'b1', pid: 42 }, disk: 'b2', deferred });
  assert.equal(serving.code, 'retrying');
  assert.match(serving.summary, /could not get a port/);
  assert.ok(
    serving.lines.some((l) => /lost the race for an internal port/.test(l)),
    `no line about the port: ${JSON.stringify(serving.lines)}`
  );
  assert.ok(
    !serving.lines.some((l) => /ran out of patience/.test(l)),
    'this deferral was not a slow start, and saying so sends the reader after the wrong thing'
  );
  // And with nothing being served at all, the 503 surface says the same.
  const nothing = explain({ active: null, disk: 'b2', deferred, retryAt: Date.now() + 2000 });
  assert.equal(nothing.code, 'no-backend');
  assert.match(nothing.lines[0], /lost the race for an internal port/);
});

await check('the console says a build was stopped, not that it lost a port', () => {
  // The regression this guards: with the summary keyed off `why` rather than off `kind`,
  // every deferral that carried a reason claimed a port problem — so bc-r0tx's would
  // have sent whoever read it looking at port collisions for a backend the OOM killer
  // took.
  const deferred = {
    build: 'b2',
    attempts: 1,
    until: Date.now() + 30000,
    kind: STOPPED,
    why:
      'build b2 backend on :51000 stopped before it was healthy (signal SIGKILL) — something outside ' +
      'the build ended it, so the build is not condemned for it.',
  };
  const serving = explain({ active: { build: 'b1', pid: 42 }, disk: 'b2', deferred });
  assert.equal(serving.code, 'retrying');
  assert.match(serving.summary, /was stopped before it was healthy/);
  assert.ok(!/could not get a port/.test(serving.summary), 'nothing here was about a port');
  assert.ok(!/too slow to start/.test(serving.summary), 'and nothing here was slow — it started and was killed');
  assert.ok(
    serving.lines.some((l) => /signal SIGKILL/.test(l)),
    `the diagnosis has to survive into the lines: ${JSON.stringify(serving.lines)}`
  );
  // And it must not read as a condemnation on the surface that says one.
  const nothing = explain({ active: null, disk: 'b2', deferred, retryAt: Date.now() + 2000 });
  assert.equal(nothing.code, 'no-backend');
  assert.match(nothing.lines[0], /something outside the build ended it/);
});

await check('a deferral with no reason still reads as a slow start', () => {
  // The timeout wording is bc-excc's and is not changed by this bead; a deferral that
  // carries no `why` must come out exactly as it did before.
  const deferred = { build: 'b2', attempts: 2, until: Date.now() + 30000 };
  const out = explain({ active: { build: 'b1', pid: 42 }, disk: 'b2', deferred });
  assert.match(out.summary, /too slow to start/);
  assert.match(out.lines[0], /ran out of patience/);
  assert.match(out.lines[1], /with a longer window/);
});

/* ------------------------------------------------------------------ claiming a number */

console.log('\ntest/helpers/net.mjs — two runs are never handed the same port\n');

/**
 * A claim-file name no other run on this machine can be standing on.
 *
 * These are names in `CLAIM_DIR`, not numbers anything binds — but since bc-jvt0.8 that
 * directory is shared by every *account* on the machine as well as by the ~20 concurrent
 * `npm test` runs, and the checks below all assert about a claim they made themselves.
 * A typed 65000 was two hazards at once: another run of this suite doing the same thing,
 * and the kernel genuinely handing 65000 to somebody's `freePort`. Above 65535 is outside
 * the port space entirely, and the pid is what no other live process shares.
 */
let nextScratch = 100000 + process.pid * 10;
const scratchPort = () => nextScratch++;

/** Whether this run could even observe a permission being refused. Root cannot. */
const AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

/**
 * Run a snippet in a child with its own environment, and hand back what it printed.
 *
 * The two-accounts checks need `TMPDIR` to differ between the claimer and the asker, and
 * `os.tmpdir()` is read once at startup — so it has to be a separate process, not a
 * mutation of `process.env` this one would not notice.
 */
function inChild(source, env) {
  const done = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(done.status, 0, `child exited ${done.status}: ${done.stderr}`);
  return JSON.parse(done.stdout);
}

const NET_HELPER = JSON.stringify(path.join(HERE, 'helpers', 'net.mjs'));

await check('a claimed port is refused to everybody else', () => {
  const port = scratchPort();
  fs.rmSync(path.join(CLAIM_DIR, String(port)), { force: true });
  assert.equal(claimPort(port), true, 'a free number is claimable');
  assert.equal(claimPort(port), false, 'and then it is not — including by us, which is what a suite asking twice is');
  const held = fs.readFileSync(path.join(CLAIM_DIR, String(port)), 'utf8');
  assert.equal(Number(held.trim()), process.pid, 'the claim says who has it, so a stale one can be told from a live one');
});

await check('a claim left behind by a dead run is taken over', () => {
  const port = scratchPort();
  const file = path.join(CLAIM_DIR, String(port));
  fs.mkdirSync(CLAIM_DIR, { recursive: true });
  // A pid that cannot be running: pids are positive, and this is the one number that is
  // never a process. A real stale claim names a pid that has simply gone.
  fs.writeFileSync(file, '999999999\n');
  assert.equal(claimPort(port), true, 'a claim whose owner is gone must not hold a port for ever');
  assert.equal(Number(fs.readFileSync(file, 'utf8').trim()), process.pid);
});

await check('a claim that says nothing at all is not respected either', () => {
  const port = scratchPort();
  const file = path.join(CLAIM_DIR, String(port));
  fs.mkdirSync(CLAIM_DIR, { recursive: true });
  fs.writeFileSync(file, '');
  assert.equal(claimPort(port), true, 'an empty or truncated claim is a crashed write, not an owner');
});

/* ------------------------------------------------- and the same directory for every user */

// bc-jvt0.8. `os.tmpdir()` is per-*user* on macOS — launchd gives each account a private
// /var/folders/<hash>/T and `TMPDIR` is how a process learns which one is its own. So the
// two checks below simulate a second Unix account the only way one process can: by handing
// a child a different `TMPDIR`, which is the whole of what being another account does to
// this helper. Before this bead the claimer and the asker landed in two directories that
// cannot see each other, and both won the same number.

await check('a claim made by one account is visible to another on the same machine', () => {
  const port = scratchPort();
  fs.rmSync(path.join(CLAIM_DIR, String(port)), { force: true });
  assert.equal(claimPort(port), true, 'this run takes the number first');

  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-othertmp-'));
  try {
    const asked = inChild(
      `
        import { CLAIM_DIR, claimPort } from ${NET_HELPER};
        process.stdout.write(JSON.stringify({ won: claimPort(${port}), dir: CLAIM_DIR }));
      `,
      // Only `TMPDIR`, and deliberately nothing else: the claim never moves, whatever
      // `BEADCAUSE_PORT_CLAIMS` this run happens to have been given. Unsetting it here
      // instead would make the check go red on a machine that sets it, for no fault.
      { TMPDIR: elsewhere }
    );
    assert.equal(asked.dir, CLAIM_DIR, `a second account looked in ${asked.dir} — a claim root that moves with TMPDIR is bc-jvt0.8`);
    assert.equal(asked.won, false, 'a live claim was handed out twice — which is the exclusive create not being exclusive at all');
  } finally {
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

await check('and a run told to use its own claim root really does — the control', () => {
  // The mirror of the check above: if it went green because of something other than the
  // claim root — the pid, the port number, a cached module — it would go green here too,
  // and it must not. This is also the mechanism a machine without a shared /tmp would use.
  const port = scratchPort();
  fs.rmSync(path.join(CLAIM_DIR, String(port)), { force: true });
  assert.equal(claimPort(port), true, 'this run takes the number first');

  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-ownclaims-'));
  try {
    const asked = inChild(
      `
        import { CLAIM_DIR, claimPort } from ${NET_HELPER};
        process.stdout.write(JSON.stringify({ won: claimPort(${port}), dir: CLAIM_DIR }));
      `,
      { BEADCAUSE_PORT_CLAIMS: own }
    );
    assert.equal(asked.dir, own, 'BEADCAUSE_PORT_CLAIMS is what a shared runner and a suite both set to be explicit');
    assert.equal(asked.won, true, 'a separate claim root sees none of this run’s claims — which is what the check above is measuring');
  } finally {
    fs.rmSync(own, { recursive: true, force: true });
  }
});

await check('a claim is left readable by the accounts that have to read it', () => {
  const port = scratchPort();
  fs.rmSync(path.join(CLAIM_DIR, String(port)), { force: true });
  assert.equal(claimPort(port), true);
  const mode = fs.statSync(path.join(CLAIM_DIR, String(port))).mode & 0o777;
  assert.equal(mode & 0o044, 0o044, `a claim at ${mode.toString(8)} cannot be read by another account, and an unreadable claim is one that gets taken`);
  // And the directory itself, which is the other half: writable by everybody so a second
  // account can claim at all, and not sticky so the staleness backstop can unlink.
  const dirMode = fs.statSync(CLAIM_DIR).mode;
  assert.equal(dirMode & 0o022, 0o022, `the claim root at ${(dirMode & 0o7777).toString(8)} is not writable by another account`);
  assert.equal(dirMode & 0o1000, 0, 'a sticky claim root stops one account reclaiming another’s abandoned port, which is the backstop');
});

await check('a claim another account cannot read is not mistaken for an abandoned one', () => {
  const port = scratchPort();
  const file = path.join(CLAIM_DIR, String(port));
  fs.mkdirSync(CLAIM_DIR, { recursive: true });
  fs.rmSync(file, { force: true });
  // A live pid, in a file this process may not read — which is what a claim written under
  // a strict umask by another account looks like from here.
  fs.writeFileSync(file, `${process.pid}\n`);
  fs.chmodSync(file, 0o000);
  try {
    let refused = true;
    try {
      fs.readFileSync(file, 'utf8');
      refused = false;
    } catch {
      /* as expected: even the owner is refused by mode 0 */
    }
    if (!refused) {
      assert.ok(AS_ROOT, 'mode 0 was readable and this is not root — the premise of this check has changed');
      console.log('      (running as root: a permission cannot be refused, so there is nothing here to observe)');
      return;
    }
    assert.equal(claimPort(port), false, 'an unreadable claim was treated as abandoned — a live run just lost its port');
  } finally {
    fs.chmodSync(file, 0o600);
    fs.rmSync(file, { force: true });
  }
});

await check('a claim root that cannot be used does not fail the run', async () => {
  // The rule the shared directory makes worth asserting: claiming is an improvement on
  // freePort, not a precondition of it. Another account can leave the root in a state this
  // one cannot write, and a gate must not die of it — it must hand back a port unclaimed.
  const locked = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-lockedclaims-'));
  try {
    fs.chmodSync(locked, 0o500);
    if (!AS_ROOT) {
      let refused = true;
      try {
        fs.mkdirSync(path.join(locked, 'probe'));
        refused = false;
      } catch {
        /* as expected */
      }
      assert.ok(refused, 'the premise of this check has changed: an unwritable directory was written to');
    }
    const got = inChild(
      `
        import net from 'node:net';
        import { freePort } from ${NET_HELPER};
        const port = await freePort();
        const server = net.createServer();
        await new Promise((resolve, reject) => { server.on('error', reject); server.listen(port, '127.0.0.1', resolve); });
        await new Promise((resolve) => server.close(resolve));
        process.stdout.write(JSON.stringify({ port }));
      `,
      { BEADCAUSE_PORT_CLAIMS: path.join(locked, 'claims') }
    );
    assert.ok(Number.isInteger(got.port) && got.port > 0, `freePort answered ${got.port} with an unusable claim root`);
  } finally {
    fs.chmodSync(locked, 0o700);
    fs.rmSync(locked, { recursive: true, force: true });
  }
});

await check('freePort hands out distinct, bindable, claimed ports', async () => {
  const ports = await Promise.all(Array.from({ length: 40 }, () => freePort()));
  assert.equal(new Set(ports).size, ports.length, `duplicates within one process: ${ports.join(',')}`);
  for (const port of ports) {
    assert.ok(fs.existsSync(path.join(CLAIM_DIR, String(port))), `:${port} was handed out unclaimed`);
  }
  // Bindable, which is the thing the claim must not have broken: it is a note to other
  // runs, not a reservation with the kernel.
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(ports[0], '127.0.0.1', resolve);
  });
  await new Promise((resolve) => server.close(resolve));
});

await check('and never the same port as another run asking at the same moment', async () => {
  // The whole bead in one assertion. Four processes, because one process could be made to
  // agree with itself in memory and the collision that costs a session an hour is between
  // separate `npm test` runs.
  const grab = `
    import { freePort } from ${JSON.stringify(path.join(HERE, 'helpers', 'net.mjs'))};
    const ports = [];
    for (let i = 0; i < 25; i++) ports.push(await freePort());
    process.stdout.write(JSON.stringify(ports));
    // Held until every sibling has finished, so the claims overlap in time rather than
    // being released one run at a time — which is the situation being tested.
    await new Promise((r) => setTimeout(r, 1500));
  `;
  const runs = await Promise.all(
    [0, 1, 2, 3].map(
      () =>
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ['--input-type=module', '-e', grab], { cwd: ROOT });
          let out = '';
          child.stdout.setEncoding('utf8');
          child.stdout.on('data', (c) => (out += c));
          child.on('error', reject);
          child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`grabber exited ${code}: ${out}`))));
        })
    )
  );
  const all = runs.flat();
  const seen = new Set();
  const clashes = all.filter((p) => (seen.has(p) ? true : (seen.add(p), false)));
  assert.deepEqual(clashes, [], `${clashes.length} port(s) handed to two runs at once — this is exactly bc-dw47`);
});

await check('a run that ends puts its ports back', async () => {
  const grab = `
    import { freePort, CLAIM_DIR } from ${JSON.stringify(path.join(HERE, 'helpers', 'net.mjs'))};
    const ports = [await freePort(), await freePort()];
    process.stdout.write(JSON.stringify({ ports, dir: CLAIM_DIR }));
  `;
  const done = spawnSync(process.execPath, ['--input-type=module', '-e', grab], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(done.status, 0, done.stderr);
  const { ports, dir } = JSON.parse(done.stdout);
  for (const port of ports) {
    assert.ok(!fs.existsSync(path.join(dir, String(port))), `:${port} is still claimed by a process that has exited`);
  }
});

/* ------------------------------------------------- and the code the router reads it by */

console.log('\nbin/beadcause.js — a bind it cannot have says so in its exit code\n');

await check('a backend whose port is taken exits with PORT_TAKEN_EXIT', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-ports-'));
  const stubBd = path.join(dir, 'bd');
  fs.writeFileSync(stubBd, '#!/bin/sh\necho "[]"\n', { mode: 0o755 });

  // Squatted by *this* process and held for the whole attempt, so the child cannot have
  // it and the failure is the one being tested rather than a race about a race.
  const squatter = net.createServer();
  const port = await new Promise((resolve, reject) => {
    squatter.on('error', reject);
    squatter.listen(0, '127.0.0.1', () => resolve(squatter.address().port));
  });

  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify(
      {
        port,
        host: '127.0.0.1',
        baseUrl: `http://127.0.0.1:${port}`,
        token: 'ports-suite-token',
        bdBin: stubBd,
        actor: 'beadcause-test',
        openSessions: false,
        autoDispatch: false,
        claudeSessions: false,
        pollSeconds: 3600,
        ntfy: { enabled: false },
        advocates: { enabled: false, workspaces: [] },
      },
      null,
      2
    )
  );

  const env = { ...process.env, BEADCAUSE_CONFIG_DIR: dir };
  delete env.BEADCAUSE_OBSERVE;
  delete env.BEADCAUSE_READONLY;
  // `--standby`, so nothing here starts a poller: this process is expected to die at the
  // bind, and a poller that ran first would touch the tracker on its way past.
  const ran = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'beadcause.js'), '--port', String(port), '--standby'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });

  await new Promise((resolve) => squatter.close(resolve));
  await cleanupTmp(dir);

  const said = `${ran.stdout || ''}${ran.stderr || ''}`;
  assert.match(said, /EADDRINUSE/, `the log does not mention the bind at all:\n${said.slice(-2000)}`);
  assert.equal(
    ran.status,
    PORT_TAKEN_EXIT,
    `exited ${ran.status} (signal ${ran.signal}) rather than ${PORT_TAKEN_EXIT} — the router reads this number and ` +
      `nothing else, so a 1 here is a good build condemned:\n${said.slice(-2000)}`
  );
});

/* ------------------------------------------------ and that the router acts on the kind */

console.log('\nbin/router.js — it retries the port and condemns nothing\n');

await check('the backend spawn classifies an exit by its code, and retries a lost port', () => {
  // Read rather than driven: making a *router* lose a backend port race on demand means
  // knowing which port it is about to pick, and there is no way to know that from out
  // here. The three lines that carry the fix are asserted instead, in the order that
  // makes them the fix — the same way test/crash.mjs pins the order of its two calls.
  const src = fs.readFileSync(path.join(ROOT, 'bin', 'router.js'), 'utf8');
  // Both arguments, and that is the whole of bc-r0tx at the call site: with the code
  // alone, a signalled child arrives as `exitKind(null)` and the answer to a question
  // about `null` condemned the build. There is no way to catch that from `exitKind`'s
  // own tests, because from in there the call looks perfectly well formed.
  assert.match(
    src,
    /exitKind\(child\.exitCode,\s*child\.signalCode\)/,
    'spawnBackend is asking about the exit code without the signal beside it — a signalled child reads as a broken build'
  );
  const branch = src.indexOf('if (err.kind === PORTLOST)');
  assert.ok(branch > 0, 'attemptStart no longer has a branch for a lost port');
  assert.ok(
    // `continue`, and not `attempt++`: retrying at once on a fresh port is the fix, and
    // spending a health attempt on it would leave a genuinely slow start with none.
    /\bcontinue;/.test(src.slice(branch, branch + 900)),
    'the lost-port branch no longer retries immediately'
  );
  assert.ok(
    src.includes('if (!poisonable(err.kind)) {'),
    'the poison decision is back to asking about the error kind directly — only `exited` may condemn a build'
  );
  assert.ok(
    !/if \(err\.kind === TIMEOUT\) \{\s*\n\s*\/\/ Not poison/.test(src),
    'the old timeout-only poison guard is back, which puts a lost port back in the poison branch'
  );
});

releasePorts();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
