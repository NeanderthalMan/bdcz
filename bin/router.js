#!/usr/bin/env node
/**
 * The thing that owns port 4318, so the thing that answers it can be replaced.
 *
 * The failure: server code is read once, at startup. Edit `lib/` and the daemon
 * carries on running whatever it loaded hours ago, serving today's `public/` files
 * against yesterday's routes — which is how `/sessions` came to 404 on a page that
 * was, on disk, entirely correct. The fix everyone reaches for is "remember to
 * restart", and forgetting is the whole bug.
 *
 * So: a router on the real port supervises a backend on an internal loopback port,
 * watches the files that only take effect at startup, and when they move it brings a
 * second backend up beside the first, health-checks it, hands over, and drains the
 * old one. The phone sees one continuous server.
 *
 * Everything the phone asks for comes through here, and that is two paths and not one:
 * ordinary requests, and the HTTP upgrade the terminal rides. The second was missing
 * for a while and cost the terminal a 404 in the only configuration launchd runs — see
 * `onUpgrade`, and the README section it points at.
 *
 * Why a router at all, rather than two processes sharing the port: `reusePort` is
 * ENOTSUP on macOS under Node 22, so two processes cannot hold 4318 between them.
 * One has to own it, and it has to be the one that never needs replacing — which
 * means it must stay small and depend on almost nothing. Every `import` at the top of
 * this file is a leaf — logstamp, config, build, service, startup, tls — and none of them reaches
 * `lib/server.js`, so a syntax error in the app costs you a swap and not the port.
 * What it needs from the app proper it loads *after* `listen()`, by dynamic import, so
 * the worst a broken module can do is cost a feature: `armCrashHandlers` and
 * `notifyCertificate` are both that, and both say why at their own length.
 *
 * The one thing it cannot do is replace itself: giving up the socket to exec a new
 * router is the outage this exists to avoid. A change to its own source is reported
 * loudly and waits for `launchctl kickstart -k gui/$(id -u)/n12n.beadcause`.
 *
 * **A build that will not start is two different failures, and this used to know only
 * one of them.** A child that exits is a broken build and is condemned; a child that is
 * alive and simply has not answered yet is a busy Mac, and condemning it for that left
 * a perfectly good build unserved until somebody read a log file. The window scales, a
 * slow start is retried on the clock, and if the router ends up with nothing behind the
 * port it says so in the 503 itself and pushes it to the phone rather than only logging
 * it. See lib/startup.js for the policy, and `recover` for the retry that was missing.
 *
 *   node bin/router.js            supervise (this is what launchd runs)
 *   node bin/router.js --swap     force a swap now, even if nothing changed
 *   node bin/router.js --status   what is running, on what build, on what certificate
 *   node bin/router.js --green <candidate id>   stand a candidate up beside it (bc-sj8k.1)
 *   node bin/router.js --drop-green             take it down again
 */
// FIRST, and it has to stay first — bc-zjab.4. Importing it puts a UTC timestamp on
// every line this process writes, and it is a side effect of the import rather than a
// call below because a call below would run after every other module here had been
// evaluated, and a module can print while it is being evaluated. `--status` and `--swap`
// are excluded inside it: they are a terminal somebody is reading, not the log.
import '../lib/logstamp.js';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, reconcileBaseUrl } from '../lib/config.js';
import { buildStamp, EMPTY_STAMP, routerStamp } from '../lib/build.js';
import { hotSwapProblem, LABEL, LOADED_ENV } from '../lib/service.js';
import {
  certificate,
  certificateLine,
  closeServer,
  daysLeftOf,
  isSecure,
  startRenewal,
  tailnetServer,
  tlsEnabled,
  MIN_VERSION,
} from '../lib/tls.js';
import { tailnetLine, watchForAddress, WATCH_EVERY_MS } from '../lib/tailnet.js';
import {
  HEALTH_ATTEMPTS,
  HEALTH_BASE_MS,
  PORTLOST,
  PORT_ATTEMPTS,
  PORT_TAKEN_EXIT,
  STOPPED,
  TIMEOUT,
  deferralMs,
  exitKind,
  explain,
  healthDeadline,
  nextSlowness,
  outageRetryMs,
  poisonable,
  startupError,
} from '../lib/startup.js';
// A leaf with no imports of its own, for the same reason lib/startup.js is one: the rule
// for when an outage has earned the phone's attention is read while the port is held with
// nothing behind it, which is precisely the moment a policy that could fail to load would
// cost you the port.
import { HOLD_TICKS, speaks } from '../lib/voices.js';
// Node builtins and nothing else, so it is a leaf like the two above: the router picks a
// backend's port while it is holding the public one, and a module that could fail to
// load there would cost the port. bc-jvt0.9.
import { freePort, releasePort } from '../lib/portclaims.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(ROOT, 'bin', 'beadcause.js');

const cfg = loadConfig();

/** How often disk is compared against what the active backend is running. */
const WATCH_MS = 3000;
/**
 * Ticks a new stamp must survive before it is acted on. A downmerge or an
 * `npm install` writes many files over several seconds, and every intermediate
 * state is a stamp nobody should be swapped onto.
 */
const SETTLE_TICKS = 1;
/**
 * Long enough for a child to import the app, read config and bind — *on an idle Mac*.
 *
 * It is a starting point rather than a verdict now: lib/startup.js widens it per
 * attempt and remembers how slow this machine has been proving to be, because twenty
 * seconds turned out to be thin on a laptop running ten agent sessions. Settable for
 * one reason that is not tuning — a test needs a window it can guarantee will expire,
 * so it can drive the slow-start path without pretending to be a busy machine.
 */
const HEALTH_BASE = Number(cfg.healthTimeoutMs) > 0 ? Number(cfg.healthTimeoutMs) : HEALTH_BASE_MS;
/**
 * A parked long poll runs 55s, and a board sweep has been measured past 65s (bc-xl7n.134)
 * — so this is not "anything still open past this is not coming back", it is "anything
 * still open past this is killed anyway, and the proxy has to answer for that itself
 * rather than let it read as the daemon failing". See `retire` and the `draining` check
 * in the request handler. Overridable via `cfg.drainMs`, the same way `HEALTH_BASE` is —
 * lower it only in a test that needs the kill to be reachable on demand.
 */
const DRAIN_MS = Number(cfg.drainMs) > 0 ? Number(cfg.drainMs) : 60000;
/**
 * Marks a response as "the backend that would have answered this was killed mid-swap,
 * not broken" — bc-xl7n.134. `public/report.js` reads this header to skip filing a P0
 * over it; there is no shared module between this process and a browser script to hold
 * the literal in one place, so both sides carry it and a change here needs one there.
 */
const DRAIN_HEADER = 'x-beadcause-swap-drain';
const DRAIN_ERROR_CODE = 'swap-drain';
/** Between SIGTERM and SIGKILL for a drained backend. */
const KILL_GRACE_MS = 5000;
/** Keeps each backend's orphan guard fed, and notices a wedged one. */
const HEARTBEAT_MS = 10000;

const log = (msg) => console.log(`[router] ${msg}`);
const warn = (msg) => console.error(`[router] ${msg}`);

// ------------------------------------------------------------ talking to a backend

/** Call a loopback JSON endpoint with a deadline. Rejects on anything but 200. */
function localJson(port, pathname, { method = 'GET', timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers: { 'x-beadcause-token': cfg.token } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`${pathname} → ${res.statusCode} ${body.slice(0, 120)}`));
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`${pathname} → unparseable: ${err.message}`));
          }
        });
      }
    );
    req.setTimeout(timeout, () => req.destroy(new Error(`${pathname} timed out after ${timeout}ms`)));
    req.on('error', reject);
    req.end();
  });
}

// ------------------------------------------------------------------- the backends

/**
 * lib/crash.js once it has loaded, or null — see `armCrashHandlers`. Read by `shutdown`,
 * which runs both long before arming and long after it, and has to work either way.
 */
let crash = null;

/**
 * Every backend this router has spawned.
 *
 * `active` takes new requests. Anything in `retiring` is finishing the requests it
 * already had, and will be killed once it has none — or once DRAIN_MS says it never
 * will. Nothing else is ever routed to.
 */
let active = null;
const retiring = new Set();

let shuttingDown = false;
let swapping = false;
/**
 * A build that *died* before it was healthy. Never retried until the files move again —
 * the alternative is respawning a process with a syntax error every three seconds.
 *
 * Only ever set for a child that exited. A child that was merely slow to answer is a
 * fact about the machine and goes in `deferred` instead; see lib/startup.js.
 */
let poisoned = null;
/**
 * A build that ran out of patience, and when it will be tried again.
 *
 * `{ build, attempts, until, deferrals }`. Unlike `poisoned` this expires on its own,
 * which is the whole point: the machine that was too busy at 21:04 is not too busy at
 * 21:09, and nobody should have to notice and type anything for that to be true.
 */
let deferred = null;
/** Consecutive bring-ups of the same build that timed out. Lengthens the pause. */
let deferrals = 0;
/** How slow this machine has been proving to be. Widens the health window. */
let slowness = 0;
/** While nothing is being served: consecutive failures, and when to try again. */
let outage = null;
let outageRetries = 0;
let retryAt = 0;
let candidate = null;
let candidateTicks = 0;
/** Backs off a backend that dies immediately, so a crash loop stays legible. */
let crashBackoffMs = 0;

/**
 * The candidate standing beside the live backend — bc-sj8k.1, DemoMode's green.
 *
 * Everything above is *blue*: the one backend the port is routed to, replaced by a
 * handover whenever disk moves. Green is a second backend spawned from a candidate
 * worktree (lib/candidate.js) that is kept up **indefinitely** rather than handed over
 * to, and it is kept apart from every variable above on purpose:
 *
 * - **It is never activated.** It stays in standby for its whole life, so it runs no
 *   poller and pushes nothing — two pollers is two notifications on the phone, which is
 *   the one failure the handover in `bringUp` is ordered to prevent. It answers requests
 *   and nothing else.
 * - **Nothing about it can reach blue.** Its own port, its own flag against concurrent
 *   bring-ups (not `swapping`, so a blue swap is never refused because green is slow),
 *   its own condemned list (not `poisoned`, so a candidate that will not boot never
 *   stops the live build being retried), and `onBackendExit` hands its death to
 *   `onGreenExit` before the line that would read it as blue's.
 * - **A blue swap does not touch it.** `bringUp` only ever stands down and retires the
 *   *previous blue*; green stays on the same pid across any number of swaps. When green
 *   does go — its process died, its worktree was torn down by the candidate sweep, or it
 *   was dropped by hand — it is dropped *loudly*: a warn line naming why, and `greenLast`
 *   on the snapshot, which `--status` prints.
 *
 * One at a time. Bringing up a second candidate retires the first only once the second
 * is healthy; a second that will not start leaves the first standing.
 */
let green = null;
/** The id being brought up right now, or null. Refuses a second concurrent bring-up. */
let greenStarting = null;
/** How the last green bring-up or drop ended: `{ id, outcome, why, at }`. */
let greenLast = null;
/**
 * Candidates whose backend *exited* before it was healthy — poison, by the same rule
 * lib/startup.js applies to blue. Keyed by id, and the id carries the head commit, so a
 * push to the pull request is a new candidate and is tried afresh.
 */
const greenCondemned = new Map();

/**
 * Start a backend on a fresh internal port, in standby, and wait for it to answer.
 *
 * Always standby, even the very first one: "healthy, then activate" is one code
 * path, and it is the only ordering in which a poller cannot start inside a process
 * that then fails to bind.
 *
 * Fails in one of three ways and the differences are the whole of bc-excc and bc-dw47: a
 * child that *exited* is a broken build (`EXITED`), a child that is alive and has not
 * answered inside `deadlineMs` is a busy machine (`TIMEOUT`), and a child that exited
 * with `PORT_TAKEN_EXIT` lost the port between `freePort` choosing it and the bind
 * (`PORTLOST`) — which is the one failure a plain retry cures, because the retry gets a
 * different port. The caller treats them nothing alike — see `attemptStart`.
 */
async function spawnBackend(deadlineMs, { entry = BACKEND, cwd = ROOT } = {}) {
  const port = await freePort();
  // `entry` and `cwd` are this checkout's own except for a green backend, which runs the
  // candidate's `bin/beadcause.js` from the candidate's tree — see `bringUpGreen`.
  const child = spawn(process.execPath, [entry, '--port', String(port), '--standby'], {
    cwd,
    // Inherited, so a backend's own logging lands in the same launchd log file as
    // the router's. Two log files for one service is a bad trade.
    stdio: 'inherit',
    env: {
      ...process.env,
      // The one fact only a launchd-started process has, handed down one hop.
      //
      // A backend is a *grandchild* of launchd: its own `process.argv[1]` is
      // bin/beadcause.js and its parent is this router, so on its own it would read a
      // correct install as "launchd started the plain server" and put a false alarm on
      // the console. This router is the process launchd actually started, so it is the
      // only one that can say. Always written, and empty when this router was not
      // started by launchd — an inherited value from an outer shell must never be able
      // to pass itself off as a fact about this job. See launchdProgram in lib/service.js.
      [LOADED_ENV]: process.ppid === 1 ? process.argv[1] : '',
    },
  });

  // `freePort` claimed `port` on the way out (lib/portclaims.js), and the claim is held for
  // exactly the interval it protects: from the probe until the kernel takes over, which is
  // the child's first answer below — a child that can answer is bound — or until the child
  // is gone. bc-jvt0.9: this process picked a backend's port for years and wrote no note,
  // so a suite's `freePort` could be handed the number between the probe and the bind, and
  // this process's probe could take one a suite had claimed. Released here and not left to
  // `exit`, because a router lives for weeks and starts a backend per release. `error` as
  // well as `exit`, because a child that could not be spawned emits only the first.
  const unclaim = () => releasePort(port);
  child.once('exit', unclaim);
  child.once('error', unclaim);

  const be = {
    port,
    child,
    pid: child.pid,
    build: null,
    startedAt: Date.now(),
    // When it first answered on its own port — the health check passing, which is a
    // different moment from the spawn by anything between a second and the whole width of
    // the window. Both are rungs of the release ladder (bc-khoe.8), and this is the only
    // process that ever sees either.
    healthyAt: null,
    role: 'starting',
    reaping: null,
    inflight: 0,
    // Client sockets that have been upgraded through this backend — terminals, in
    // practice. Counted in `inflight` like any request, but unlike a request they
    // never end on their own, so `retire` has to say something to them.
    upgrades: new Set(),
  };
  child.on('exit', (code, signal) => onBackendExit(be, code, signal));
  // A child that could not be spawned at all emits `error` and nothing else, and an
  // `error` with no listener is thrown — out of this router, which is the one process
  // holding the port. So a missing node binary or an unreadable checkout (spawn reports
  // a missing `cwd` as ENOENT on the *command*) took the whole daemon down instead of
  // failing one start. bc-ek0fx. Kept here and read by the loop below, because the
  // exit code it leaves behind (-2) is indistinguishable from a build that crashed.
  let spawnError = null;
  child.on('error', (err) => {
    spawnError = err;
  });

  const deadline = Date.now() + deadlineMs;
  for (;;) {
    if (spawnError) {
      // `STOPPED`, not `EXITED`: no line of the build ever ran, so there is nothing to
      // condemn. It is deferred and tried again, which is what cures a checkout that
      // was unreadable for three seconds.
      throw startupError(STOPPED, `backend on :${port} could not be started — ${spawnError.message}`);
    }
    if (child.exitCode !== null || child.signalCode) {
      // Both halves, and the signal is not optional: a signalled child has no exit code
      // at all, so `exitKind(child.exitCode)` was asking a question about `null` — and
      // answering `EXITED`, which condemned the build. A backend nobody in here killed
      // is a fact about this Mac, not about the code it was running. bc-r0tx.
      const kind = exitKind(child.exitCode, child.signalCode);
      const why =
        kind === PORTLOST
          ? 'could not bind it — something else took it first'
          : kind === STOPPED
            ? 'stopped before it was healthy'
            : 'exited before it was healthy';
      // The code, always, and it is not decoration: `exited before it was healthy` is the
      // sentence that condemns a build, and which exit produced it is the whole of what
      // anybody reading the log afterwards needs to know. A signalled child says so
      // instead — `signal SIGKILL` is a very different diagnosis from `code 1`, and both
      // of them arrived here as the same six words until bc-dw47.
      const how = child.signalCode ? `signal ${child.signalCode}` : `code ${child.exitCode}`;
      throw startupError(kind, `backend on :${port} ${why} (${how})`);
    }
    try {
      const state = await localJson(port, '/internal/state', { timeout: 2000 });
      be.healthyAt = Date.now();
      be.build = state.build;
      be.role = state.role;
      be.reaping = state.reaping;
      unclaim();
      return be;
    } catch (err) {
      if (Date.now() > deadline) {
        child.kill('SIGKILL');
        throw startupError(
          TIMEOUT,
          `backend on :${port} was still starting after ${Math.round(deadlineMs / 1000)}s — ${err.message}`
        );
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * Spawn until one answers, or until patience runs out — with a longer window each time.
 *
 * A child that exits gets no second chance here: it is a broken build and the next
 * spawn would break identically. A child that ran out of time gets one more, with twice
 * the window, because a *wedged* child is the only other thing a timeout can mean and a
 * fresh process is the only cure for that one. Beyond that the answer is not "again,
 * harder" but "later, wider", which is what `slowness` carries out of here.
 *
 * The exception, and bc-dw47's whole point, is a child that exited because its port had
 * been taken. "The next spawn would break identically" is exactly what is false about
 * that one — the next spawn asks the kernel for another port — so it is retried at once,
 * up to `PORT_ATTEMPTS` times, and it costs neither a health attempt nor a mark on
 * `slowness`: the machine was not slow and the build was never in question.
 *
 * A `STOPPED` child leaves here immediately too, and deliberately without a retry of its
 * own. It is not condemned — that is bc-r0tx, and it happens in `bringUp` — but neither
 * is spinning the cure: whatever ended it (memory pressure, a stray kill, its own orphan
 * guard firing inside a health window wider than a minute) would still be true a
 * millisecond later. The deferral is the right length of wait, and when nothing at all
 * is being served `outageRetryMs` already makes that two seconds. It costs no `slowness`
 * either: the child was not slow, it was stopped.
 */
async function attemptStart(build, where) {
  let last = null;
  let lost = 0;
  let attempt = 0;
  while (attempt < HEALTH_ATTEMPTS) {
    const ms = healthDeadline(attempt, slowness, HEALTH_BASE);
    try {
      const be = await spawnBackend(ms, where);
      const was = slowness;
      slowness = nextSlowness(slowness, { timedOut: false, attempt });
      if (attempt > 0 || was !== slowness) {
        log(`build ${build} answered on attempt ${attempt + 1} within ${Math.round(ms / 1000)}s`);
      }
      return be;
    } catch (err) {
      last = err;
      if (err.kind === PORTLOST) {
        // Not `attempt++`: this says nothing about the build or the window, and spending
        // the second health attempt on it would leave a genuinely slow start with none.
        if (++lost >= PORT_ATTEMPTS) throw err;
        warn(
          `build ${build} lost its internal port (${lost}/${PORT_ATTEMPTS}) — ` +
            'another process on this Mac took it first. Trying again now, on another one.'
        );
        continue;
      }
      if (err.kind !== TIMEOUT) throw err;
      warn(
        `build ${build} was still starting after ${Math.round(ms / 1000)}s ` +
          `(attempt ${attempt + 1}/${HEALTH_ATTEMPTS}) — a slow machine says nothing about the build`
      );
      attempt++;
    }
  }
  slowness = nextSlowness(slowness, { timedOut: true });
  throw last;
}

/** SIGTERM, then SIGKILL if it is still there. */
function stop(be) {
  retiring.delete(be);
  if (be.child.exitCode !== null || be.child.signalCode) return;
  be.child.kill('SIGTERM');
  setTimeout(() => {
    if (be.child.exitCode === null && !be.child.signalCode) {
      warn(`backend pid ${be.pid} ignored SIGTERM — killing`);
      be.child.kill('SIGKILL');
    }
  }, KILL_GRACE_MS).unref();
}

/**
 * Ask a superseded backend to let go of its terminal sockets.
 *
 * **What a swap does to an attached terminal, decided.** The pty is a child of the
 * backend, so it cannot outlive one — there is no version of this where the terminal
 * survives a swap, only versions where it ends well or badly. Left alone, an attached
 * socket keeps `inflight` above zero for the whole of DRAIN_MS: a phone spends a
 * minute typing into a process that is already condemned, then loses it mid-keystroke
 * with 1006, which is indistinguishable from a tunnel. So the outgoing backend is
 * asked to close them itself, with a real close frame carrying 1012 (Service
 * Restart); the phone reconnects within a second onto the *new* backend, where the
 * record has come back `resumable`, and `claude --resume` puts the conversation back.
 *
 * Only asked when this router has actually proxied an upgrade to it: on the swap that
 * lands this change the outgoing backend has no such control path, and a 404 warning
 * about a socket nobody had open would be noise. Failure is survivable either way —
 * the drain falls back to DRAIN_MS and then SIGTERM, exactly as it did before.
 */
function release(be) {
  if (!be.upgrades.size) return;
  const n = be.upgrades.size;
  localJson(be.port, '/internal/release', { method: 'POST' })
    .then((r) => log(`pid ${be.pid} released ${r?.closed ?? n} terminal socket(s) — the phone reconnects onto the new backend`))
    .catch((err) => warn(`pid ${be.pid} would not release its ${n} terminal socket(s) (${err.message}) — draining them out`));
}

/**
 * Let a superseded backend finish what it already had, then end it.
 *
 * It is in standby by this point, so it polls nothing and notifies nobody; all it
 * still owns is a handful of open sockets, one of which may be a phone parked on a
 * 55-second long poll. Killing it under that is the difference between a seamless
 * swap and the phone deciding it is offline.
 */
function retire(be) {
  be.role = 'draining';
  retiring.add(be);
  release(be);
  const started = Date.now();
  const timer = setInterval(() => {
    const drained = be.inflight === 0;
    const expired = Date.now() - started > DRAIN_MS;
    if (!drained && !expired) return;
    clearInterval(timer);
    const stubborn = expired && !drained ? ` — ${be.inflight} request(s) still open after ${DRAIN_MS / 1000}s` : '';
    log(`retired pid ${be.pid} (build ${be.build})${stubborn}`);
    stop(be);
  }, 500);
  timer.unref();
}

/**
 * Write down that the port has just changed hands — twice, into two files, on purpose.
 *
 * **The marker (bc-kttd).** `lib/deploy.js` holds `POST /api/error` off across a deploy by
 * reading the deploy journal, and a swap writes nothing into it — so a hand-run `npm run
 * swap`, and every automatic one this file does when `lib/` moves, produced exactly the
 * storm that mechanism exists to stop: a handful of failures that happened a moment before
 * the new backend became healthy, described to it afterwards, each one a P0 in front of the
 * advocate. `markRestart` leaves the one fact that costs, and lib/deploy.js explains at
 * length why it is a file of its own rather than a fake deploy.
 *
 * **The trail (bc-khoe.8).** The marker answers "was there a handover in the last thirty
 * seconds" and nothing else — it overwrites itself, deliberately. The release board asks a
 * different question: *which* handover carried release 42, and when did each of its three
 * stages happen. So the same moment is also appended to a short trail, with the spawn and
 * the health check that preceded it and the deploy it belongs to, and lib/queues.js draws
 * *deployed to green*, *green verification* and *swapping to blue* off that instead of
 * marking them untracked. Which deploy it belongs to is the journal's question, not this
 * file's — `restartingDeploy` answers it, and null is the ordinary answer, because a swap
 * this router did on its own belongs to no deploy at all.
 *
 * **Lazily imported and never fatal**, for the reason at the top of this file and the
 * reason `armCrashHandlers` gives at more length: lib/deploy.js reaches lib/session.js
 * and so an import cycle, and none of that may stand between this process and the port.
 * By the time this is first called that module is already in the cache — `armCrashHandlers`
 * awaits it before the first `bringUp` — so the write lands on the next microtask, well
 * ahead of any phone noticing it was ever gone.
 *
 * **At the handover, not at the spawn.** A build that is merely slow is started, timed
 * out and retried while the old backend serves perfectly; marking those would hush a
 * daemon that never moved. Only the assignment to `active` is the service changing hands.
 */
function noteRestart(be, reason) {
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
  import('../lib/deploy.js')
    .then(async ({ markRestart, restartingDeploy }) => {
      markRestart({ build: be.build, pid: be.pid, reason });
      // The trail second, after the marker has already landed, imported separately and
      // caught separately. Two failures with two different costs: a marker that did not
      // land is a screen full of P0s, and a trail that did not land is three rungs of a
      // release card reading "not tracked". They must not be able to take each other down,
      // and they must not be reported in each other's words.
      try {
        const { recordHandover } = await import('../lib/handover.js');
        recordHandover({
          build: be.build,
          pid: be.pid,
          port: be.port,
          spawnedAt: iso(be.startedAt),
          healthyAt: iso(be.healthyAt),
          reason,
          deploy: restartingDeploy()?.id || null,
        });
      } catch (err) {
        warn(`could not record the handover trail (${err.message}) — this swap's three stages will read as untracked`);
      }
    })
    .catch((err) => warn(`could not record the handover (${err.message}) — the reconnect after this swap may file beads`));
}

/**
 * A backend went away on its own: a crash, an OOM, or its own orphan guard.
 *
 * Only the active one is worth reacting to — a draining backend exiting is the
 * whole point of draining.
 */
function onBackendExit(be, code, signal) {
  retiring.delete(be);
  if (shuttingDown) return;
  // Green first, and before the `active` test below could ever see it: a candidate dying
  // is news about the candidate, never a reason to replace the live backend.
  if (be === green) return onGreenExit(be, code, signal);
  if (be !== active) return;

  const lived = Date.now() - be.startedAt;
  warn(`active backend pid ${be.pid} exited (${signal || `code ${code}`}) after ${Math.round(lived / 1000)}s — replacing it`);
  active = null;
  // Anything that dies inside ten seconds is failing at startup, not at runtime.
  // Backing off keeps a crash loop readable instead of a wall of noise.
  crashBackoffMs = lived < 10000 ? Math.min((crashBackoffMs || 500) * 2, 30000) : 0;
  setTimeout(() => {
    // A build already declared poison is exactly the build to try again here: with
    // no backend at all nothing is being served, and a 502 that might recover beats
    // a 503 that certainly will not. The same goes for one waiting out a deferral —
    // the pause exists to protect a working backend, and there is no longer one.
    poisoned = null;
    deferred = null;
    bringUp('replacing a backend that exited').catch((err) => warn(`replacement failed — ${err.message}`));
  }, crashBackoffMs).unref();
}

/** Spawn, health-check, hand over. The only place `active` is ever assigned. */
async function bringUp(reason) {
  if (swapping) throw new Error('a swap is already in flight');
  swapping = true;
  const attempted = buildStamp();
  try {
    const next = await attemptStart(attempted);

    // Stand the old one down BEFORE promoting the new one. Two live pollers would
    // both see a new question and both push it, and a duplicate notification on a
    // phone is the one failure this design must never produce. The gap between the
    // two calls is a few milliseconds in which nothing polls, which costs nothing:
    // the next tick picks up whatever appeared.
    if (active) {
      try {
        const down = await localJson(active.port, '/internal/standby', { method: 'POST' });
        if (down && 'reaping' in down) active.reaping = down.reaping;
      } catch (err) {
        // Unreachable means it is not polling either, which is all we needed.
        warn(`old backend pid ${active.pid} would not stand down (${err.message}) — continuing`);
      }
    }

    // Take the role and the reaper flag from the promotion's own reply rather than
    // waiting up to WATCH_MS for the next poll to notice. `--status` and the swap
    // test both read this immediately after a swap, and a stale `reaping: false`
    // there reads as "nobody is sweeping terminals" when one just started.
    const promoted = await localJson(next.port, '/internal/activate', { method: 'POST' });
    next.role = promoted?.role ?? 'active';
    if (promoted && 'reaping' in promoted) next.reaping = promoted.reaping;

    const previous = active;
    active = next;
    // Before the log line and before the old one is retired: from here the phone is
    // talking to a process that was not there a moment ago, and the reconnect it is
    // about to make must not be a dozen beads. See `noteRestart`.
    noteRestart(next, reason);
    poisoned = null;
    deferred = null;
    deferrals = 0;
    outageRetries = 0;
    retryAt = 0;
    crashBackoffMs = 0;
    log(`serving build ${next.build} from pid ${next.pid} on :${next.port} — ${reason}`);
    if (previous) retire(previous);
    recovered();
    return next;
  } catch (err) {
    // Remember the build we tried, not the one on disk now: if the files moved
    // again while we were failing, that newer build deserves its own attempt.
    if (!poisonable(err.kind)) {
      // Not poison. The child was alive and unhurried, or it never got the port it was
      // given, or something outside it ended it — every one of those is a sentence about
      // this Mac, and condemning a build for it is how a good build stopped being served
      // for as long as it took somebody to read a log file. Deferred instead: tried
      // again on its own, with a window that has already been widened by `slowness`.
      // Counted per build: a newer build has earned a fresh, short pause rather than
      // inheriting the one the previous build's failures had grown to.
      deferrals = deferred?.build === attempted ? deferrals + 1 : 1;
      const wait = deferralMs(deferrals);
      const lostPort = err.kind === PORTLOST;
      const stopped = err.kind === STOPPED;
      // Carried on the snapshot rather than left to be inferred from `attempts`: every
      // surface that reads a deferral says "too slow to answer", and a deferral for a
      // taken port would be four screens of a diagnosis that is simply not this one.
      // `kind` rides along with it because `why` alone cannot separate three readings —
      // see the `clause` in `explain`.
      const why = lostPort
        ? `build ${attempted} lost the race for an internal port ${PORT_ATTEMPTS} times — ` +
          'something else on this Mac keeps taking it. Nothing is wrong with the build.'
        : stopped
          ? // The `(code 0)` or `(signal …)` is inside `err.message` and is the whole
            // diagnosis, so it is quoted rather than paraphrased: `signal SIGKILL` is
            // memory pressure or a stray kill, and `code 0` is the backend's own orphan
            // guard firing inside a health window wider than its minute.
            `build ${attempted} ${err.message} — something outside the build ended it, ` +
            'so the build is not condemned for it.'
          : null;
      deferred = {
        build: attempted,
        attempts: lostPort ? PORT_ATTEMPTS : stopped ? 1 : HEALTH_ATTEMPTS,
        until: Date.now() + wait,
        deferrals,
        kind: err.kind,
        why,
      };
      if (why) {
        warn(`${why} Retrying in ${Math.round(wait / 1000)}s.`);
      } else {
        warn(
          `build ${attempted} would not start in time — retrying in ${Math.round(wait / 1000)}s ` +
            `with a longer window. The build is not condemned: ${HEALTH_ATTEMPTS} slow starts are ` +
            'evidence about the machine, not about the code.'
        );
      }
    } else {
      poisoned = attempted;
      deferred = null;
      deferrals = 0;
      warn(`could not bring up build ${attempted} — ${err.message}`);
    }
    if (active) warn(`still serving build ${active.build} from pid ${active.pid}`);
    else stillServingNothing(attempted, err);
    throw err;
  } finally {
    swapping = false;
  }
}

// ---------------------------------------------------------------- green (DemoMode)

/**
 * Where candidates are read from: this checkout's own, which is what launchd runs.
 * `BEADCAUSE_CANDIDATE_ROOT` exists for test/routergreen.mjs alone, which cannot put a
 * fake candidate in a real checkout's `.claude/candidates/`.
 */
const CANDIDATE_ROOT = process.env.BEADCAUSE_CANDIDATE_ROOT || ROOT;

const greenOutcome = (id, outcome, why) => {
  greenLast = { id, outcome, why: why || null, at: new Date().toISOString() };
  return greenLast;
};

/**
 * The candidate's record and whether it may be served, without importing it at the top.
 *
 * lib/candidate.js reaches lib/pr.js and lib/prstage.js — app, not leaves — so it is
 * loaded here, lazily, for the reason at the top of this file: a broken one costs green,
 * never the port. A load failure is a refusal like any other.
 */
async function greenRecord(id) {
  try {
    const { findCandidate, greenRefusal } = await import('../lib/candidate.js');
    const record = await findCandidate(CANDIDATE_ROOT, id).catch(() => null);
    return { record, refusal: greenRefusal(record, id) };
  } catch (err) {
    return { record: null, refusal: `lib/candidate.js would not load (${err.message}), so no candidate can be read` };
  }
}

/**
 * Stand candidate `id` up on green, beside blue, and keep it there.
 *
 * The same startup policy blue gets — `attemptStart`, the widening window, `slowness` —
 * and the same reading of how it failed: a child that *exited* is condemned and said
 * so; one that was merely slow, lost its port or was stopped from outside is not, and
 * can be asked for again. Refused before any process exists when lib/candidate.js says
 * the tree is unservable (bc-sj8k.6).
 *
 * Nothing on any path here assigns `active` or reads `swapping`. See `green`.
 */
async function bringUpGreen(id) {
  if (greenStarting) throw new Error(`green is already bringing up ${greenStarting}`);
  if (green && green.id === id) return green;
  if (greenCondemned.has(id)) {
    const why = `candidate ${id} was condemned — ${greenCondemned.get(id)}. A push to its pull request is a new candidate`;
    greenOutcome(id, 'refused', why);
    warn(`green: refused — ${why}`);
    throw new Error(why);
  }
  greenStarting = id;
  try {
    const { record, refusal } = await greenRecord(id);
    if (refusal) {
      greenOutcome(id, 'refused', refusal);
      warn(`green: refused — ${refusal}`);
      throw new Error(refusal);
    }
    const label = `${id} (green)`;
    let be;
    try {
      be = await attemptStart(label, { entry: path.join(record.dir, 'bin', 'beadcause.js'), cwd: record.dir });
    } catch (err) {
      const condemned = poisonable(err.kind);
      if (condemned) greenCondemned.set(id, err.message);
      greenOutcome(id, condemned ? 'condemned' : 'failed', err.message);
      warn(
        `green: candidate ${id} ${condemned ? 'is condemned — it will not start' : 'did not come up'} (${err.message}). ` +
          (active ? `Blue is untouched, still serving build ${active.build} from pid ${active.pid}.` : 'Blue is not serving either.') +
          (green ? ` ${green.id} is still standing on green.` : '')
      );
      throw err;
    }
    be.id = id;
    be.dir = record.dir;
    be.number = record.number;
    be.title = record.title || '';
    const previous = green;
    green = be;
    greenOutcome(id, 'serving', null);
    log(
      `green: candidate ${id} standing on :${be.port} from pid ${be.pid} (build ${be.build}) ` +
        `beside blue ${active ? `build ${active.build}` : '(nothing)'}`
    );
    if (previous) {
      log(`green: ${previous.id} replaced by ${id} — one candidate at a time`);
      retire(previous);
    }
    return be;
  } finally {
    greenStarting = null;
  }
}

/**
 * Take green down, saying why — the "dropped loudly" half of bc-sj8k.1. Drained like any
 * retired backend, so a request already on it finishes. Null when nothing was standing.
 */
function dropGreen(why) {
  const be = green;
  if (!be) return null;
  green = null;
  greenOutcome(be.id, 'dropped', why);
  warn(`green: DROPPED candidate ${be.id} (pid ${be.pid}) — ${why}`);
  retire(be);
  return be.id;
}

/** Green's process went away on its own. Not replaced: a candidate that dies is the news. */
function onGreenExit(be, code, signal) {
  green = null;
  const lived = Math.round((Date.now() - be.startedAt) / 1000);
  const why = `its backend exited (${signal || `code ${code}`}) after ${lived}s; blue is untouched`;
  greenOutcome(be.id, 'dropped', why);
  warn(`green: DROPPED candidate ${be.id} (pid ${be.pid}) — ${why}`);
}

// ------------------------------------------------------- which device is on green

/**
 * The cookie that puts one device on green — bc-sj8k.8.
 *
 * Its value is the *candidate id*, not just "green". A device is on green only while
 * the candidate it flipped to is the one standing there. When that candidate is dropped,
 * dies, is torn down, or is replaced by the next pull request, the device lands on blue,
 * never on an error and never on a different candidate it did not ask for.
 *
 * It is a cookie, rather than a second port or a hostname, so it is the same URL and the
 * same sign-in. The app's own session cookie rides alongside it untouched. Every other
 * device stays on blue because the choice lives in this browser alone.
 */
const DEMO_COOKIE = 'beadcause_demo';
/** A week. Long enough to survive a PWA that drops session cookies, and a stale one self-clears anyway. */
const DEMO_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

/** The candidate id this request's device asked to be on, or null. */
function demoWanted(req) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== DEMO_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

function demoCookie(req, id) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (req.socket.encrypted) attrs.push('Secure');
  return id
    ? `${DEMO_COOKIE}=${encodeURIComponent(id)}; ${attrs.join('; ')}; Max-Age=${DEMO_COOKIE_MAX_AGE}`
    : `${DEMO_COOKIE}=; ${attrs.join('; ')}; Max-Age=0`;
}

/**
 * Which backend serves this request, and whether its device's cookie has gone stale.
 *
 * `clear` is set for a cookie naming a candidate that is not on green and is not the one
 * being brought up. The response then takes the cookie off, so the device is plainly on
 * blue again rather than silently re-joining a candidate of the same id later. A bring-up
 * of the very candidate the cookie names is left alone. That is a device that flipped a
 * moment early, and it will be on green the moment green answers.
 */
function routeOf(req) {
  const wanted = demoWanted(req);
  if (!wanted) return { target: active, env: 'blue', clear: false };
  if (green && green.id === wanted) return { target: green, env: 'green', clear: false };
  return { target: active, env: 'blue', clear: wanted !== greenStarting };
}

/**
 * `/__demo/…`, served by the router itself and never proxied.
 *
 * `/__demo/blue` is the way home, and it is the reason it lives here and not in the app.
 * A candidate branched before DemoMode existed has no route for it. If the escape were
 * the app's, a flip to green on such a build would strand the phone there, because every
 * request it made would reach a backend that has never heard of the escape. Here it
 * answers the same whatever is behind the port, including nothing at all.
 *
 * `/__demo/green?id=<candidate>` is the other direction, refused unless that candidate
 * is the one standing on green. With no id it means whatever is on green now. Both
 * answer a 303, so a plain link or a form is enough to flip a device: green to `/`, the
 * candidate's own app, and blue to `/demo?from=<the candidate>`, DemoMode's list with the
 * one you were just using at the top (bc-sj8k.2).
 */
/**
 * What a browser is answered with on a flip (bc-sj8k.9).
 *
 * public/sw.js serves the shell's scripts from ONE cache keyed by URL alone, and blue and
 * green share every URL. A flip by a bare 303 therefore pairs the new side's index.html
 * with the old side's cached scripts for a load, and the revalidation behind that answer
 * then writes the new side's scripts over what the old side will be served on the way
 * back. `Clear-Site-Data: "cache"` is not the cure: it empties the HTTP cache, not the
 * Cache API, and `"storage"` would unregister the worker and take the device's
 * localStorage with it.
 *
 * So this page does what public/update.js does before a reload: asks the worker to
 * re-fetch the whole shell (`beadcause:sw-refresh`, one all-or-nothing `addAll`), and only
 * then navigates. The cookie is already set by this very response, so that fetch is made
 * from the side the device is now on. No worker, or no answer in 4s, just navigates;
 * `<noscript>` refreshes. A non-HTML caller still gets the plain 303.
 */
function flipPage(env, to = '/') {
  // `to` is router-built (`/` or `/demo?from=<id alphabet>`), but it is still escaped for
  // both places it lands: an HTML attribute and a JS string.
  const attr = String(to).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
  const js = JSON.stringify(String(to)).replace(/</g, '\\u003c');
  return (
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Beadcause — switching to ${env}</title><p>Switching to ${env}…</p>` +
    `<noscript><meta http-equiv="refresh" content="0;url=${attr}"></noscript>` +
    `<script>(function(){var go=function(){location.replace(${js})},sw=navigator.serviceWorker;` +
    `if(!sw||!sw.controller)return go();var t=setTimeout(go,4000);` +
    `sw.addEventListener('message',function(e){if(e.data&&e.data.type==='beadcause:sw-refresh'){clearTimeout(t);go()}});` +
    `sw.startMessages&&sw.startMessages();sw.controller.postMessage({type:'beadcause:sw-refresh'})})()</script>`
  );
}

function demo(req, res, url) {
  const home = (cookie, env, location = '/') => {
    // A browser navigation gets the interstitial, so the service worker's one shared shell
    // cache is re-fetched from the side the device is now on before the first load.
    if (/text\/html/.test(String(req.headers.accept || ''))) {
      res.writeHead(200, {
        'set-cookie': cookie,
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
        'x-beadcause-env': env,
      });
      return res.end(flipPage(env, location));
    }
    res.writeHead(303, {
      location,
      'set-cookie': cookie,
      'cache-control': 'no-store',
      'content-type': 'application/json',
      'x-beadcause-env': env,
    });
    res.end(JSON.stringify({ on: env }));
  };
  if (url.pathname === '/__demo/blue') {
    // Home to DemoMode's list rather than to the inbox, with the candidate the device was
    // just on named so the list can put it first (bc-sj8k.2). Only an id's own alphabet
    // goes on the address — the cookie is the device's to write, not ours to echo.
    const was = demoWanted(req);
    const from = was && /^[a-z0-9.-]+$/.test(was) ? `?from=${was}` : '';
    return home(demoCookie(req, null), 'blue', `/demo${from}`);
  }
  if (url.pathname === '/__demo/green') {
    const id = url.searchParams.get('id') || green?.id || '';
    if (green && green.id === id) return home(demoCookie(req, id), 'green');
    const why = green
      ? `candidate ${id} is not on green — ${green.id} is`
      : id
        ? `candidate ${id} is not on green — nothing is standing there`
        : 'nothing is standing on green';
    if (!/text\/html/.test(String(req.headers.accept || ''))) return json(res, 409, { error: why, on: 'blue' });
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    res.writeHead(409, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>Beadcause — not on green</title><p>${esc(why)}.</p><p><a href="/">Back to the app</a></p>`
    );
  }
  return json(res, 404, { error: 'no such demo route' });
}

// -------------------------------------------------- nothing is being served at all

/**
 * The state this bead is named for: the port is held, and there is nothing behind it.
 *
 * Everything the router does about a failed swap assumes there is an old backend still
 * answering, and when there is, a log line is a fair place for the news. When there is
 * not, the same log line is the *only* evidence that the app is down — launchd sees a
 * healthy process, the port answers, and the phone gets a 503 with no explanation in it.
 * That is precisely the shape of failure bc-4irq was filed about, one layer down.
 *
 * So an outage gets three surfaces instead of one: the log, the 503 itself (see
 * `unavailable`), and a push, which is the only one that reaches somebody who is not
 * looking. Announced once — a retry loop that pushes every two seconds is a phone you
 * turn off — and again when it comes back, because an alert you are never told is over
 * is an alert you learn to ignore.
 *
 * **The push waits for the second consecutive failure; the log does not.** An outage is
 * class 2 (bc-ka5y.15), which is the one voice on the phone allowed to insist, and this
 * function is called from the failure path of a bring-up that *this same file* is about to
 * retry in two seconds — having just written a log line saying a slow start is evidence
 * about the machine and not about the build. Pushing on the first failure therefore meant
 * a swap that came up on its second attempt cost a knock and a "serving again" twenty
 * seconds later, about an app nobody could have opened in the gap. `speaks` in
 * lib/voices.js is the rule and [HOLD_TICKS] is the count; the whole argument for damping
 * class 2 at all is over there. The log keeps saying it every time, because the log is
 * the record somebody reconstructs an evening from and the damping is about a sound.
 */
function stillServingNothing(build, err) {
  const first = !outage;
  outage = outage || { since: Date.now(), build, reason: err?.message || String(err), announced: false, ticks: 0 };
  outage.build = build;
  outage.reason = err?.message || String(err);
  outage.ticks += 1;
  if (first) warn('NOTHING IS BEING SERVED — the router holds the port and every request is a 503');
  if (!speaks({ ticks: outage.ticks, spoken: outage.announced })) {
    if (!outage.announced && outage.ticks < HOLD_TICKS) {
      log(`not telling the phone yet — an outage speaks once it has survived ${HOLD_TICKS} attempts, and this is ${outage.ticks}`);
    }
    return;
  }
  outage.announced = true;
  // Lazily, and never fatally: lib/notify.js is not a leaf, and an outage caused by a
  // broken lib/ is exactly the case where importing it throws. See notifyCertificate.
  import('../lib/notify.js')
    .then(({ pushNoBackend }) => pushNoBackend(cfg, { ...snapshot(), verdict: explain(snapshot()) }))
    .then((r) => (r?.skipped ? undefined : log('pushed the outage to the phone')))
    .catch((e) => warn(`could not push the outage (${e.message}) — the log is the only surface left`));
}

/**
 * The other half of the promise above: say when it is over.
 *
 * Never damped, and never in the stuck voice. A recovery has already waited — it cannot
 * arrive before the warning it cancels, because `announced` gates it — and it is `CLEAR`
 * in lib/voices.js rather than one of the five: a warning that has stopped being true is
 * not an arrival, and a phone that knocks twice to tell you something is fine is a phone
 * you silence. Hence `pushServingAgain` at priority 2 rather than anything louder.
 */
function recovered() {
  if (!outage) return;
  const down = Math.round((Date.now() - outage.since) / 1000);
  const announced = outage.announced;
  outage = null;
  log(`serving again after ${down}s with nothing behind the port`);
  if (!announced) return;
  import('../lib/notify.js')
    .then(({ pushServingAgain }) => pushServingAgain(cfg, { seconds: down, build: active?.build || null }))
    .catch((e) => warn(`could not push the recovery — ${e.message}`));
}

// ------------------------------------------------------------------ watching disk

/**
 * Compare disk against what is actually running, and swap when they part.
 *
 * The comparison is against the *backend's* stamp, taken inside the backend at its
 * own startup — not against one the router took when it spawned it. That is the
 * difference between "the files changed since I last looked" and "this process is
 * running something other than what is on disk", and only the second one is the bug.
 */
function watchDisk() {
  setInterval(() => {
    if (shuttingDown || swapping) return;
    if (!active) return recover();

    const disk = buildStamp();
    // Not a build: no file under lib/ or bin/ could be listed, so the checkout itself is
    // unreadable or gone for the moment. Swapping onto it is what spawned a backend into
    // a missing directory and brought the router down (bc-ek0fx).
    if (disk === EMPTY_STAMP) return;
    if (disk === active.build) {
      candidate = null;
      candidateTicks = 0;
      return;
    }
    if (disk === poisoned) return;
    // A build waiting out a deferral, and the pause has not run out yet. Cleared
    // rather than honoured when the files have moved on — a newer build has earned
    // its own attempt, and the one being waited on is no longer the question.
    if (deferred) {
      if (deferred.build !== disk) deferred = null;
      else if (Date.now() < deferred.until) return;
    }

    if (disk !== candidate) {
      candidate = disk;
      candidateTicks = 0;
      return;
    }
    if (++candidateTicks < SETTLE_TICKS) return;

    candidate = null;
    candidateTicks = 0;
    bringUp(`disk moved ${active.build} → ${disk}`).catch(() => {});
  }, WATCH_MS).unref();
}

/**
 * Nothing is active. Try again — whatever the state of the build on disk says.
 *
 * This branch did not exist, and its absence is half of why the daemon stayed 503:
 * `watchDisk` returned early on `!active`, so a router whose *first* backend failed sat
 * there watching a disk it had decided not to act on, for as long as the machine was up.
 * The comment at the bottom of this file promised "the next edit gets retried" and no
 * code anywhere kept that promise. `onBackendExit` covers the one case that did recover
 * — a backend that had been running and died — and covers nothing that never ran.
 *
 * Poison and deferral are both ignored here on purpose, exactly as they are there:
 * condemning a build, or making it wait its turn, only makes sense while a working one
 * is still answering. With nothing behind the port the worst outcome of trying a
 * condemned build again is the 503 we already have — so neither is cleared, because
 * both are still the best account of *why* there is nothing to serve, and that account
 * is what the 503 body and the console health line are made of.
 */
function recover() {
  const now = Date.now();
  if (now < retryAt) return;
  outageRetries++;
  retryAt = now + outageRetryMs(outageRetries);
  bringUp('nothing is being served — trying again').catch(() => {});
}

/**
 * The router's own source, watched separately and only ever reported.
 *
 * See the note at the top: replacing itself means giving up the port, which is the
 * outage this exists to avoid. Said once, not every three seconds.
 */
function watchSelf() {
  let told = false;
  setInterval(() => {
    if (told || routerStamp() === routerBuildAtStart) return;
    told = true;
    warn("the router's own source changed — it cannot replace itself while holding the port.");
    warn(`restart it: ${RESTART_COMMAND}`);
  }, WATCH_MS).unref();
}

/** Keeps every backend's orphan guard fed, and notices one that has stopped answering. */
function heartbeat() {
  setInterval(() => {
    if (shuttingDown) return;
    // A green whose worktree is gone is running files that no longer exist — the candidate
    // sweep retires a merged, closed or pushed-past pull request by removing its tree.
    if (green && !fs.existsSync(green.dir)) dropGreen(`its worktree ${green.dir} was torn down`);
    for (const be of [active, green, ...retiring].filter(Boolean)) {
      localJson(be.port, '/internal/state', { timeout: 4000 })
        .then((state) => {
          be.role = state.role;
          be.build = state.build;
          be.reaping = state.reaping;
        })
        .catch((err) => {
          if (be === active) warn(`active backend pid ${be.pid} is not answering — ${err.message}`);
          else if (be === green) warn(`green backend pid ${be.pid} (${be.id}) is not answering — ${err.message}`);
        });
    }
  }, HEARTBEAT_MS).unref();
}

// -------------------------------------------------------------------- the proxy

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function forwardable(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  return out;
}

/**
 * The same headers, with the two hop-by-hop ones an upgrade cannot do without.
 *
 * `connection` and `upgrade` are hop-by-hop precisely because they describe *this*
 * hop, and a proxy that means to open the next hop as a tunnel has to state them
 * again rather than pass them through. Stripping them is what made the terminal 404:
 * `GET /ws/terminal` arrived at the backend as an ordinary request, missed the
 * `upgrade` listener entirely, and was answered by the app's own 404.
 *
 * `sec-websocket-*` is not hop-by-hop and was never dropped — including the
 * subprotocol, which is where the token travels. See lib/termsocket.js.
 */
function upgradeHeaders(req) {
  return { ...forwardable(req.headers), connection: 'Upgrade', upgrade: req.headers.upgrade };
}

/**
 * A fresh loopback socket per proxied request, deliberately.
 *
 * Pooling them would save a handshake that costs nothing over loopback, and buy a
 * race in exchange: Node closes an idle keep-alive connection after five seconds,
 * and a pooled socket picked at the same instant the backend is closing it comes
 * back as ECONNRESET — a 502 on the phone, arriving from a server that is perfectly
 * healthy. One phone's traffic is not worth defending that.
 */
const agent = new http.Agent({ keepAlive: false, maxSockets: Infinity });

function json(res, code, obj, headers) {
  if (res.headersSent) return res.destroy();
  res.writeHead(code, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

const isLocal = (req) => {
  const a = req.socket.remoteAddress;
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
};

function describe(be) {
  if (!be) return null;
  return {
    pid: be.pid,
    port: be.port,
    build: be.build,
    role: be.role,
    // Whether this backend is sweeping terminals. Exactly one should be, ever.
    reaping: be.reaping,
    inflight: be.inflight,
    // Of which this many are upgraded sockets — terminals. Reported separately
    // because they are the part of `inflight` that will not fall on its own.
    upgrades: be.upgrades.size,
    upSeconds: Math.round((Date.now() - be.startedAt) / 1000),
  };
}

/** `describe`, plus what makes green a candidate rather than a build. */
function describeGreen(be) {
  if (!be) return null;
  return { ...describe(be), id: be.id, number: be.number ?? null, title: be.title || '', dir: be.dir };
}

function snapshot() {
  const disk = buildStamp();
  return {
    router: {
      pid: process.pid,
      port: cfg.port,
      build: routerBuildAtStart,
      sourceChanged: routerStamp() !== routerBuildAtStart,
      // The fix for that, since only this process can name it — the uid is its own and
      // the label is the one it was installed under. Carried on every snapshot rather
      // than only when it is needed, because a field that appears and disappears is one
      // a reader has to test twice; see `explain`, which uses it as the verdict's `fix`.
      restart: RESTART_COMMAND,
    },
    disk,
    stale: Boolean(active && active.build !== disk),
    swapping,
    // A build that died at startup, and will not be tried again until the files move.
    poisoned,
    // A build that was only slow, and will be tried again by the clock. The two are
    // reported separately because reading one as the other is the whole of bc-excc.
    deferred: deferred ? { ...deferred } : null,
    // Whether anything at all is behind the port. `active: null` says the same thing,
    // but a boolean named for the question is what a health line reads.
    serving: Boolean(active),
    outage: outage ? { since: new Date(outage.since).toISOString(), seconds: Math.round((Date.now() - outage.since) / 1000), build: outage.build, reason: outage.reason } : null,
    // When the next attempt is due while nothing is being served. 0 means "next tick".
    retryAt: active ? 0 : retryAt,
    // How much the health window has been widened by what this machine has shown us.
    slowness,
    // What is on the *socket*, which is the one fact about TLS no other process can
    // work out: the setting on disk and the certificate in `~/.config/beadcause/tls`
    // both say what a listener would bind if one were created now, and this says what
    // the listener that exists actually did. The admin screen's "restart to serve it"
    // is exactly the difference between the two — see lib/tlsswitch.js.
    certificate: certificateOnSocket(),
    active: describe(active),
    retiring: [...retiring].map(describe),
    // DemoMode's second backend — bc-sj8k.1. `green` is what is standing now, `greenLast`
    // how the last bring-up or drop ended (`serving`, `refused`, `condemned`, `failed`,
    // `dropped`), which is where a green that went away says why.
    green: describeGreen(green),
    greenStarting,
    greenLast: greenLast ? { ...greenLast } : null,
    greenCondemned: [...greenCondemned.keys()],
  };
}

/**
 * The certificate this router is serving, or null when it is serving plain HTTP.
 *
 * Read off `tlsMaterial`, which `tailnetServer` hangs on the server, `renewOnce` replaces
 * and `acquireOnce` fills in — so both a certificate swapped without a restart and a
 * first one adopted without a restart are reflected here the moment they happen, rather
 * than reporting whatever was true at boot. Null while a provisional listener is still
 * waiting for one, because "serving plain HTTP" is exactly what that is.
 *
 * `checkedAt` comes off the same server object, stamped by the renewal loop on every
 * tick — so a readout can say whether the loop is still running rather than only what
 * the calendar says. A certificate with two months left and a check from six weeks ago
 * is a dead loop, and those two facts are only distinguishable together.
 */
function certificateOnSocket() {
  const server = (servers || []).filter(isSecure).find((s) => s.tlsMaterial);
  const material = server?.tlsMaterial;
  if (!material) return null;
  const left = daysLeftOf(material.cert);
  return {
    name: material.name,
    daysLeft: left === null ? null : Math.round(left * 10) / 10,
    checkedAt: server.tlsCheckedAt || null,
  };
}

/**
 * The router's own control plane, on the real port but loopback-and-token only.
 *
 * Note what is NOT here: any way to reach a *backend's* `/internal/`. A backend
 * accepts control calls from loopback, and every proxied request reaches it from
 * loopback because the router is what connects — so forwarding those would hand
 * anyone on the tailnet holding the token the ability to stop the poller.
 */
async function control(req, res, url) {
  if (!isLocal(req) || (req.headers['x-beadcause-token'] || url.searchParams.get('t')) !== cfg.token) {
    return json(res, 403, { error: 'internal' });
  }

  if (url.pathname === '/internal/router/state') return json(res, 200, snapshot());

  if (url.pathname === '/internal/router/swap') {
    try {
      const next = await bringUp('asked for by hand');
      return json(res, 200, { ok: true, active: describe(next) });
    } catch (err) {
      // 200 with ok:false: the router is fine, the build was not, and --swap wants
      // to print the reason rather than an HTTP status.
      return json(res, 200, { ok: false, error: err.message, active: describe(active) });
    }
  }

  if (url.pathname === '/internal/router/green' && req.method === 'POST') {
    const id = url.searchParams.get('id') || '';
    try {
      const be = await bringUpGreen(id);
      return json(res, 200, { ok: true, green: describeGreen(be), active: describe(active) });
    } catch (err) {
      // 200 with ok:false, as `swap` does: the router is fine, the candidate was not.
      return json(res, 200, { ok: false, error: err.message, green: describeGreen(green), active: describe(active) });
    }
  }

  if (url.pathname === '/internal/router/green/drop' && req.method === 'POST') {
    return json(res, 200, { ok: true, dropped: dropGreen('dropped by hand') });
  }

  return json(res, 404, { error: 'no such control' });
}

/**
 * The 503 that used to say `no backend is running — check the log`.
 *
 * Which log, on which machine, saying what? That sentence is the app being down, on the
 * one screen that is definitely being looked at — the phone, held by somebody who just
 * tapped a notification — and it spent all of it telling them to go and read a file
 * they cannot reach. Everything the router knows about why is available right here, so
 * it is said right here: which build, whether it died or was merely slow, and when the
 * next attempt is. In HTML for a browser, because that is what a phone is showing.
 *
 * Deliberately hand-rolled and tiny: this path is reached precisely when `lib/` may be
 * unloadable, so it cannot read a template off disk or import anything to render one.
 */
function unavailable(req, res) {
  const snap = snapshot();
  const verdict = explain(snap) || { summary: 'no backend is running', lines: [], code: 'no-backend' };
  const wantsHtml = /text\/html/.test(String(req.headers.accept || ''));
  if (!wantsHtml) {
    return json(res, 503, {
      error: 'no backend is running',
      code: verdict.code,
      summary: verdict.summary,
      detail: verdict.lines,
      disk: snap.disk,
      poisoned: snap.poisoned,
      deferred: snap.deferred,
      outage: snap.outage,
      retryAt: snap.retryAt || null,
    });
  }
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const body = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Beadcause — nothing is being served</title>
<style>
 :root{color-scheme:dark light}
 body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:2rem 1.25rem;max-width:34rem}
 h1{font-size:1.15rem;margin:0 0 .75rem}
 p{margin:.5rem 0;opacity:.85}
 code{font:14px/1.4 ui-monospace,Menlo,monospace;background:rgba(127,127,127,.18);padding:.15rem .35rem;border-radius:4px;user-select:all}
 .dim{opacity:.6;font-size:.85rem}
</style>
<h1>⚠ The router is holding the port and serving nothing</h1>
${verdict.lines.map((l) => `<p>${esc(l)}</p>`).join('\n')}
<p class="dim">${esc(snap.outage ? `down for ${snap.outage.seconds}s · ` : '')}disk build ${esc(snap.disk)} · router pid ${snap.router.pid}</p>
<p class="dim">This page refreshes itself; it will become the app again the moment a backend answers.</p>
<script>setTimeout(function(){location.reload()},5000)</script>`;
  if (res.headersSent) return res.destroy();
  res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5' });
  res.end(body);
}

const handler = (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/internal/')) return control(req, res, url);
  if (url.pathname.startsWith('/__demo/')) return demo(req, res, url);

  // A device on green is served by green even when blue is down, so this is decided
  // before the 503 rather than after it. See `routeOf`.
  const { target, env, clear } = routeOf(req);
  if (!target) return unavailable(req, res);

  target.inflight++;
  let counted = true;
  const done = () => {
    if (!counted) return;
    counted = false;
    target.inflight--;
  };
  res.on('close', done);

  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: target.port,
      method: req.method,
      path: req.url,
      headers: forwardable(req.headers),
      agent,
    },
    (up) => {
      // Which process actually answered, on every response. `curl -sI` against the
      // real port is then enough to tell a stale daemon from a fresh one, which is
      // the question that started all of this.
      const headers = {
        ...forwardable(up.headers),
        'x-beadcause-build': target.build || 'unknown',
        'x-beadcause-pid': String(target.pid),
        // Which side answered, so a page can say "you are on green" without asking.
        'x-beadcause-env': env,
      };
      if (env === 'green') headers['x-beadcause-candidate'] = target.id;
      if (clear) headers['set-cookie'] = [].concat(up.headers['set-cookie'] || [], demoCookie(req, null));
      res.writeHead(up.statusCode, headers);
      up.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    done();
    // The backend this request was talking to was already superseded and DRAIN_MS ran
    // out on it — see `retire`. `role` only reaches 'draining' there, and only a
    // request still open when that happens can land here: a cleanly drained backend has
    // nothing left with a socket to error. So this is not the daemon failing — a new
    // backend has been serving for a while already — and answering the ordinary 502
    // is what filed a P0 about a working daemon (bc-xl7n.134). `x-beadcause-build`
    // cannot carry this instead, the way a real response does: the upstream never sent
    // headers, so there is nothing on this response to attribute to a build.
    //
    // A green that went away under a request is the same case for the same reason
    // (bc-sj8k.8): the retry lands on blue, because `routeOf` no longer finds the
    // candidate its cookie names, and a 502 here would be a P0 about a candidate.
    const greenGone = env === 'green' && green !== target;
    if ((target.role === 'draining' || greenGone) && !res.headersSent) {
      warn(`proxy to pid ${target.pid} failed during drain — ${err.message} — telling the phone to retry`);
      return json(
        res,
        503,
        { error: 'backend was retired mid-handover — retry', code: DRAIN_ERROR_CODE },
        { 'retry-after': '1', [DRAIN_HEADER]: '1' }
      );
    }
    warn(`proxy to pid ${target.pid} failed — ${err.message}`);
    json(res, 502, { error: 'backend unreachable' });
  });
  // No timeout, on purpose: /api/poll parks for up to 55 seconds by design, and a
  // proxy that gave up at 30 would turn the phone's normal idle state into an error.
  req.on('error', () => upstream.destroy());
  req.pipe(upstream);
};

/**
 * Refuse an upgrade before there is a socket to speak WebSocket on.
 *
 * Plain HTTP, for the reason lib/termsocket.js gives about its own refusals: a
 * browser reports a failed handshake with a status far more usefully than it reports
 * a socket that opens and closes with a code, and 1006 is also what a phone going
 * through a tunnel produces.
 */
function denyUpgrade(socket, code, message) {
  if (!socket.destroyed) socket.write(`HTTP/1.1 ${code} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** An HTTP message head, rebuilt from a parsed response. */
function headOf(res) {
  const lines = [`HTTP/1.1 ${res.statusCode} ${res.statusMessage || ''}`.trimEnd()];
  for (const [k, v] of Object.entries(res.headers)) {
    if (Array.isArray(v)) for (const one of v) lines.push(`${k}: ${one}`);
    else lines.push(`${k}: ${v}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/**
 * The other half of the proxy: an HTTP upgrade, tunnelled to the active backend.
 *
 * With an `upgrade` listener, Node routes an upgrade request here and never to
 * `handler`. Without one it does the opposite — the request goes to `handler` like any
 * other — which is why the symptom was a *404* rather than a dead socket: the router
 * proxied `GET /ws/terminal` as an ordinary request, with `upgrade` and `connection`
 * stripped as hop-by-hop, so the backend's own upgrade listener never saw it and
 * `app.handler` answered the only thing it could. Both halves are the bug: a listener
 * that forwarded `forwardable(req.headers)` would produce the same 404 one hop later.
 *
 * The response is one of two things and both are relayed rather than interpreted.
 * A 101 becomes two pipes and nothing else — the router never looks at a WebSocket
 * frame, so nothing here can be confused by one, and the token subprotocol is checked
 * by the backend exactly as it is under `npm run start:bare`. Anything else is the
 * backend refusing the upgrade (401 for a bad token, 404 for a path that is not the
 * terminal), and it is written out verbatim, because a proxy that turned a 401 into a
 * dropped socket would cost the client the one useful sentence in the exchange.
 */
const onUpgrade = (req, socket, head) => {
  socket.on('error', () => socket.destroy());

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return denyUpgrade(socket, 400, 'Bad Request');
  }
  // The control plane is request/response only, and a backend's `/internal/` is not
  // reachable through here by design — see `control`. An upgrade must not be the
  // hole in either.
  if (url.pathname.startsWith('/internal/') || url.pathname.startsWith('/__demo/')) {
    return denyUpgrade(socket, 404, 'Not Found');
  }
  // The same choice `handler` makes, so a terminal opened on green is green's terminal.
  // A stale cookie is not cleared here: an upgrade response is relayed verbatim, and the
  // next ordinary request does it.
  const { target } = routeOf(req);
  if (!target) return denyUpgrade(socket, 503, 'Service Unavailable');

  target.inflight++;
  target.upgrades.add(socket);
  let counted = true;
  /** The loopback half, once there is one. Held so the client going away can end it. */
  let tunnel = null;
  const done = () => {
    if (!counted) return;
    counted = false;
    target.inflight--;
    target.upgrades.delete(socket);
  };
  const upstream = http.request({
    host: '127.0.0.1',
    port: target.port,
    method: req.method,
    path: req.url,
    headers: upgradeHeaders(req),
    // Not the shared agent: an upgraded socket is taken out of HTTP entirely, and
    // handing it back to a pool that expects to manage it is how a tunnel ends up
    // reused for a request.
    agent: false,
  });

  // One close handler for the client end, and it ends everything. The client can go
  // away *during* the handshake — a phone that locks mid-connect — and the loopback
  // request left behind would keep the backend's own WebSocket alive with nobody on
  // the other side of it, which is a socket the drain would then wait on forever.
  socket.on('close', () => {
    done();
    upstream.destroy();
    tunnel?.destroy();
  });

  upstream.on('upgrade', (up, upSocket, upHead) => {
    tunnel = upSocket;
    upSocket.on('error', () => upSocket.destroy());
    socket.write(headOf(up));
    // Bytes each side had already sent past its own head. The backend's `ws` writes
    // its first frames immediately after the 101, so `upHead` is routinely non-empty
    // and dropping it would eat the `hello` message the terminal page waits for.
    if (upHead?.length) socket.write(upHead);
    if (head?.length) upSocket.write(head);
    socket.pipe(upSocket);
    upSocket.pipe(socket);
    // The backend going away ends the client too — which is what turns a released
    // socket, or a killed backend, into a reconnect rather than a page waiting on a
    // tunnel with nothing behind it. The other direction is the close handler above.
    upSocket.on('close', () => socket.destroy());
  });

  // The backend answered rather than upgrading — its own refusal, relayed intact.
  upstream.on('response', (up) => {
    socket.write(headOf(up));
    up.on('data', (chunk) => socket.write(chunk));
    up.on('end', () => socket.end());
    up.on('error', () => socket.destroy());
  });

  upstream.on('error', (err) => {
    warn(`upgrade to pid ${target.pid} failed — ${err.message}`);
    denyUpgrade(socket, 502, 'Bad Gateway');
  });

  req.on('error', () => upstream.destroy());
  // A WebSocket handshake is a GET with no body, and `head` — anything the client
  // sent past its own request head — is written to the tunnel above rather than into
  // this request, where it would arrive before the 101 as a body nobody asked for.
  upstream.end();
};

// ----------------------------------------------------------------------- listening

/**
 * Bind loopback and the tailnet address — the same pair `lib/server.js` binds, and
 * deliberately re-implemented here rather than imported. The router has to be able
 * to come up when `lib/server.js` is broken; that is most of the point of it.
 *
 * **TLS terminates here in the installed configuration**, because here is what owns
 * the port: the backends behind this bind loopback only, so a certificate on their
 * sockets would guard the one hop that never leaves the machine and leave the phone on
 * plain http. lib/tls.js is a leaf — node builtins and lib/config.js — which keeps the
 * rule this file lives by: it depends on almost nothing, so almost nothing can stop it
 * coming up. The proxy hop to the backend stays plain `http://127.0.0.1`.
 *
 * A tailnet address with TLS *wanted* is bound the same way whether or not a certificate
 * could be fetched — `tailnetServer` says why. With one, that is an HTTPS server behind
 * the sniffing front. Without, it is plain HTTP behind the same front, and `startRenewal`
 * keeps asking until there is one; either way the port is bound once and never again.
 *
 * **Except when the address is not on this Mac yet.** A tailnet address that fails with
 * `EADDRNOTAVAIL` is deferred rather than lost — see `deferTailnet` and lib/tailnet.js.
 */
function bindHost(host, { onBound, onError }) {
  const onTailnet = host !== '127.0.0.1';
  // Asked per address rather than once per `listen`, because a deferred tailnet address
  // binds minutes later: by then `startRenewal` may have fetched the very certificate
  // this socket should come up carrying, and a `material` captured at startup would put
  // it on plain http until the next restart. Loopback never asks — it is never TLS.
  const material = onTailnet ? certificate(cfg) : null;
  // Wanting a certificate is not the same as having one, and the difference is the whole
  // of what that bead was about: a fetch that failed used to mean plain http with nothing
  // watching. `tls.enabled: false` is the one case where it is not wanted at all.
  const wanted = onTailnet && tlsEnabled(cfg);

  const { server, front, plain } =
    wanted ? tailnetServer(material, handler) : { server: http.createServer(handler), front: null, plain: null };
  // The terminal rides the upgrade path, and a server with no `upgrade` listener
  // quietly treats one as an ordinary request — which is how the terminal came to
  // 404. In the installed configuration this is the only listener there is: the
  // backends bind loopback, so the one lib/termsocket.js attaches to *their* servers
  // can never be reached from the tailnet. Both handles get it, because which of them
  // the front is routing to changes the moment a certificate is adopted.
  for (const s of [server, plain].filter(Boolean)) s.on('upgrade', onUpgrade);
  // The front owns the port when there is one: it binds, it fails, it closes.
  const listener = front || server;
  listener.on('error', (err) => {
    warn(`listen ${host}:${cfg.port} — ${err.message}`);
    onError(err);
  });
  listener.listen(cfg.port, host, () => {
    onBound();
    if (material && onTailnet) log(`listening on https://${material.name}:${cfg.port} (${host}, ${MIN_VERSION} floor)`);
    else if (plain) log(`listening on http://${host}:${cfg.port} — no certificate yet; this socket becomes https without a restart`);
    else log(`listening on http://${host}:${cfg.port}`);
  });
  // The request-serving servers, not the front — those are what carry the certificate a
  // renewal has to replace, and each knows the front as `.front` for closing. One
  // object per host, except a tailnet address still waiting for a certificate, which
  // hands back the plain server it is answering with as well.
  return [server, plain].filter(Boolean);
}

/**
 * What to do when the deferred address turns up. Assigned after `startRenewal`, because
 * binding the address is only half of what has to happen then — the certificate loop
 * snapshots the sockets it was given and has to be re-armed around the new one.
 *
 * Which means the watcher can beat it: `listen()` runs first, and everything between it
 * and the assignment — `armCrashHandlers`, a `reconcileBaseUrl` that writes a file — is
 * ordinary startup that can outlast a 5s tick on a loaded Mac. So the arrival is
 * *remembered* rather than dropped, and `armLateBind` runs it if it already happened.
 * Getting this wrong would be the original bug with extra steps: an address that came
 * back, a daemon that noticed, and still nothing bound.
 */
let bindTailnetLate = null;
let tailnetArrived = false;

const armLateBind = (fn) => {
  bindTailnetLate = fn;
  if (!tailnetArrived) return;
  tailnetArrived = false;
  fn();
};

/** Whether a deferral is already outstanding, so two failures start one watcher. */
let tailnetDeferred = false;

/**
 * The tailnet address is not on this Mac. Say so in a sentence that names the cause and
 * the cure, then wait for it rather than giving up on it.
 *
 * This is the whole of bc-b4fs. The old code logged `EADDRNOTAVAIL`, saw that loopback
 * had bound, and carried on: a daemon that reported itself healthy while the phone could
 * not reach it at all, curable only by noticing and running `launchctl kickstart` after
 * starting Tailscale. Neither half of that is acceptable — the log has to say it, and
 * the daemon has to fix itself once Tailscale is up, because the common way in is
 * launchd starting this at login a few seconds before Tailscale finishes connecting.
 */
function deferTailnet() {
  if (tailnetDeferred) return;
  tailnetDeferred = true;
  warn(`tailnet ${tailnetLine(cfg.host)}`);
  watchForAddress(cfg.host, () => {
    tailnetDeferred = false;
    log(`tailnet ${cfg.host} is on this Mac now — binding it without a restart`);
    if (bindTailnetLate) bindTailnetLate();
    else tailnetArrived = true;
  });
}

function listen() {
  const hosts = ['127.0.0.1'];
  if (cfg.host && cfg.host !== '127.0.0.1') hosts.push(cfg.host);

  let bound = 0;
  let failed = 0;
  return hosts.flatMap((host) =>
    bindHost(host, {
      onBound: () => {
        bound++;
      },
      onError: (err) => {
        // Counted whatever the cause, because the exit below turns on `bound === 0` —
        // nothing being served — and a deferred tailnet address plus a loopback the
        // port was taken from is still nothing being served.
        failed++;
        // The same code lib/server.js uses, and for the same reason it uses it: a router
        // that could not have the port is a different event from a router that is broken,
        // and a parent — a suite, in practice, since launchd reads no code at all — can
        // only tell them apart if the number says so.
        if (failed === hosts.length && bound === 0) {
          warn('no address could be bound — exiting');
          process.exit(PORT_TAKEN_EXIT);
        }
        // Not a port that was taken: an address that is not here. Nothing to exit over
        // — loopback is serving — and everything to wait for.
        if (host !== '127.0.0.1' && err.code === 'EADDRNOTAVAIL') deferTailnet();
      },
    })
  );
}

/**
 * A certificate warning that reaches the phone, without the router importing the app.
 *
 * lib/notify.js is not a leaf — spaces, foundation, the answered ledger — and this file
 * holds the port, so it imports leaves only and nothing that could stop it starting.
 * Loading it lazily, at most once a day, in a path that already has its log line
 * written, keeps both halves: the push happens, and a broken lib/ still cannot cost you
 * port 4318.
 */
const notifyCertificate = async (state) => {
  const { pushCertificate } = await import('../lib/notify.js');
  return pushCertificate(cfg, state);
};

// ---------------------------------------------------------------- the CLI modes

/**
 * Ask the running router something, and exit if there isn't one.
 *
 * "No router answering" used to be the whole message, and it is the least useful
 * half of the answer: something *was* answering on 4318 for three days — the plain
 * server, which has no control plane — and a bare connection refused reads as "the
 * daemon is down" rather than "the daemon is the wrong program". So a failure asks
 * the installed LaunchAgent what it runs, and reports that instead when it is the
 * reason. `npm run swap:status` is the line install.sh prints on its way out, so this
 * is where somebody following the installer's own advice ends up.
 */
async function askRunningRouter(pathname, method) {
  try {
    // Generous: --swap waits out a whole spawn and health check.
    return await localJson(cfg.port, pathname, { method, timeout: 45000 });
  } catch (err) {
    console.error(`no router answering on 127.0.0.1:${cfg.port} — ${err.message}`);
    const problem = hotSwapProblem({ root: ROOT });
    if (problem) {
      console.error('');
      for (const line of problem.lines) console.error(`  ${line}`);
    }
    return process.exit(1);
  }
}

if (process.argv.includes('--status')) {
  const s = await askRunningRouter('/internal/router/state', 'GET');
  const line = (be) =>
    be
      ? `pid ${be.pid} :${be.port} build ${be.build} ${be.role} inflight ${be.inflight}${
          be.upgrades ? ` (${be.upgrades} terminal socket${be.upgrades === 1 ? '' : 's'})` : ''
        } up ${be.upSeconds}s`
      : '(none)';
  console.log(`router   pid ${s.router.pid} on :${s.router.port}${s.router.sourceChanged ? '  ⚠ source changed — restart it' : ''}`);
  console.log(`active   ${line(s.active)}`);
  for (const be of s.retiring) console.log(`draining ${line(be)}`);
  // Green, when this router knows about it at all — an older router has no such field.
  if (s.green) console.log(`green    ${s.green.id} — ${line(s.green)}`);
  else if (s.greenLast && s.greenLast.outcome !== 'serving') {
    console.log(`green    (none) — ${s.greenLast.id} ${s.greenLast.outcome}: ${s.greenLast.why}`);
  }
  console.log(`disk     ${s.disk}${s.stale ? '  ⚠ STALE — a swap is due' : '  (matches what is running)'}`);
  // TLS on a line, next to the build, because this is the one command anybody runs to
  // ask what the daemon is doing — and until now the certificate was only ever visible
  // in launchd's log or in the push that arrives once it is nearly too late.
  console.log(`cert     ${certificateLine(s.certificate).text}`);
  if (s.poisoned) console.log(`poisoned ${s.poisoned} — this build died at startup; not retried until the files change`);
  if (s.deferred) {
    const left = Math.max(0, Math.round((s.deferred.until - Date.now()) / 1000));
    console.log(`slow     ${s.deferred.build} — too slow to start ${s.deferred.attempts}×; retrying in ~${left}s with a longer window`);
  }
  // The verdict in the same words the phone and the console get it in, and the only
  // line that is worth reading first when it is there.
  const verdict = explain(s);
  if (verdict && !verdict.ok) {
    console.log('');
    console.log(`⚠ ${verdict.summary}`);
    for (const l of verdict.lines) console.log(`  ${l}`);
  }
  process.exit(0);
}

if (process.argv.includes('--green')) {
  const id = process.argv[process.argv.indexOf('--green') + 1] || '';
  const s = await askRunningRouter(`/internal/router/green?id=${encodeURIComponent(id)}`, 'POST');
  if (s.ok) console.log(`green — candidate ${s.green.id} standing on :${s.green.port} from pid ${s.green.pid}`);
  else console.error(`green refused — ${s.error}`);
  process.exit(s.ok ? 0 : 1);
}

if (process.argv.includes('--drop-green')) {
  const s = await askRunningRouter('/internal/router/green/drop', 'POST');
  console.log(s.dropped ? `dropped ${s.dropped} from green` : 'nothing was standing on green');
  process.exit(0);
}

if (process.argv.includes('--swap')) {
  const s = await askRunningRouter('/internal/router/swap', 'POST');
  if (s.ok) console.log(`swapped — now serving build ${s.active.build} from pid ${s.active.pid}`);
  else console.error(`swap failed — ${s.error}`);
  process.exit(s.ok ? 0 : 1);
}

// ------------------------------------------------------------------- supervise

/**
 * How long the router gives filing before it stops waiting and exits — half what the
 * backend allows itself, and the difference is the port.
 *
 * `FILE_TIMEOUT_MS` bounds a *dying backend* held open, which costs nothing at all: the
 * router replaces it, and the phone is talking to the router either way. Here the process
 * being held open is the one launchd restarts, so the window is time added to the recovery
 * of the only socket a phone can reach. It is not an outage — an `uncaughtException` does
 * not close the server, so 4318 stays bound and proxying for the whole window, and that is
 * exactly the problem with being generous with it: what is answering is a router whose
 * invariants have just been shown to be wrong.
 *
 * Five seconds, then, rather than one: a `bd create` that hits a lock retry takes a couple
 * of seconds and this crash is the single most worth having a bead for, so a window too
 * short to file in would defeat the whole change. A filing that does not land in five
 * seconds says so in the log and the router goes down on time.
 */
const CRASH_FILE_TIMEOUT_MS = 5000;

/**
 * Arm lib/crash.js — **after `listen()`, by dynamic import, and never at the top of this
 * file.**
 *
 * The rule this process lives by is that almost nothing can stop it coming up, and a
 * static `import` of lib/crash.js would have quietly spent it: crash → errors → filing →
 * proposal → endorse is five modules of app, and a syntax error in any of them would cost
 * port 4318 rather than a swap. lib/deploy.js is worse — it reaches lib/session.js, and so
 * lib/foundation.js and lib/agents.js, which are a live import cycle whose evaluation
 * order decides whether the pair loads at all (bc-u4na). Importing it *here* inverts the
 * failure: the port is already bound, the worst case is a router that serves normally and
 * says in the log that its crashes are only a log line, and that is strictly what it did
 * before this existed. `notifyCertificate` below loads lib/notify.js lazily for the same
 * reason and says so at more length.
 *
 * The workspace is this checkout's own, exactly as bin/beadcause.js picks it and for the
 * same reason: a beadcause bug belongs on the beadcause graph, and `cfg.workspaces[0]` is
 * very often somebody's JIRA. `where` is a function because what the router is serving
 * moves — the bead should say which build was up when it died, not which one was up when
 * it started.
 *
 * No `bus`: the event bus belongs to the backend, in another process, and a bead filed
 * here reaches a parked phone on its next poll instead. That is a few seconds later, and
 * the router is on its way out anyway — the poll is about to be reconnected regardless.
 */
async function armCrashHandlers() {
  try {
    const [c, { ownWorkspace }, { Bd }] = await Promise.all([
      import('../lib/crash.js'),
      import('../lib/deploy.js'),
      import('../lib/bd.js'),
    ]);
    const ws = cfg.workspaces.find((w) => w.name === ownWorkspace(cfg)) || cfg.workspaces[0];
    if (!ws) return warn('no beads workspace to file this router’s own crashes on — they stay log lines');
    c.installCrashHandlers(cfg, {
      bd: new Bd({ bin: cfg.bdBin, actor: cfg.actor, sharedServer: cfg.sharedServer, me: cfg.me, accounts: cfg.accounts }),
      workspace: ws,
      timeoutMs: CRASH_FILE_TIMEOUT_MS,
      where: () =>
        `the beadcause router — pid ${process.pid} on :${cfg.port}, build ${routerBuildAtStart}, serving ${
          active ? `build ${active.build} from pid ${active.pid}` : 'nothing yet'
        }`,
    });
    crash = c;
    // Said out loud, because the alternative is silence in both directions: this is the
    // only line that distinguishes "a crash here is a bead now" from the arming having
    // failed on a machine where nobody reads the warning either. It also names the graph,
    // which is the part that is worth checking when a bead turns up on the wrong one.
    log(`own crashes file on ${ws.name}, with ${CRASH_FILE_TIMEOUT_MS}ms to do it`);
    // Armed after the signal already arrived: a SIGTERM during those imports would have
    // run `shutdown` with `crash` still null, so nothing told lib/crash.js we are going
    // down and the teardown's own rejections would file. Say it now instead.
    if (shuttingDown) c.beginShutdown();
  } catch (err) {
    // Deliberately not fatal. See the header: the port is the thing being protected here,
    // and a router that cannot file its crashes is the router we have had all along.
    warn(`could not arm the crash handlers — this router’s crashes stay log lines: ${err?.message || err}`);
  }
}

const routerBuildAtStart = routerStamp();

/**
 * The one command that clears a stale router, written once and read in three places.
 *
 * The log line `watchSelf` prints, the verdict `explain` builds, and — through that
 * verdict — the health line on the advocate console. It is built here rather than in
 * lib/startup.js because that module imports nothing on purpose (a policy that could
 * fail to load is a policy that costs the port), so the uid and the LaunchAgent label
 * are this program's to know; the snapshot carries it out to the rest.
 *
 * `-k` because the job is running: kickstart without it is a no-op against a live
 * label, which is the failure mode of a fix line that looks right and does nothing.
 */
const RESTART_COMMAND = `launchctl kickstart -k gui/${process.getuid()}/${LABEL}`;

/**
 * Put the port down and stop the backends, once.
 *
 * Declared above the socket it closes because it has to be *registered* the moment the
 * socket exists — see the two `process.on` calls below `listen()`. Nothing can call it
 * before then, so `servers` is always initialised by the time this body runs.
 */
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  // Before anything is closed. A teardown makes things in flight reject, and the router
  // tears down on every `launchctl kickstart` — so without this every restart would file a
  // P0 about a router doing exactly as it was told. `crash` is null until `armCrashHandlers`
  // has finished, which is why that function checks `shuttingDown` on its way out.
  crash?.beginShutdown();
  log('shutting down — stopping backends');
  for (const be of [active, green, ...retiring].filter(Boolean)) stop(be);
  // `closeServer`, because `listen()` now hands back the request server: on the tailnet
  // address the port is held by the `net.Server` in front of it, and closing the HTTPS
  // server alone would leave 4318 bound by a process on its way out.
  servers.forEach(closeServer);
  // Give SIGTERM a moment to land on the children before the router's own exit
  // orphans them. Their own guard would catch it a minute later; this is tidier.
  setTimeout(() => process.exit(0), 300).unref();
};

const servers = listen();
// Armed here, on the line after the port is held, and not at the end of this file where
// they used to be. `launchctl kickstart -k` is a SIGTERM, and until these are registered
// node's default disposition is what answers one: the process is killed where it stands,
// `shutdown` never runs, the backends are orphaned to their own minute-long guard and the
// port goes without being closed. That window used to cover everything below — arming the
// crash handlers, fetching a certificate, and the whole first bring-up, which is seconds
// on a cold start and exactly the seconds a restart-loop lands in. `shutdown` is written
// to be safe this early: `active` and `retiring` are simply empty, and `crash` is null
// until `armCrashHandlers` has finished, which is what its optional call and the
// `if (shuttingDown)` on that function's way out are between them for.
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// In the installed configuration this process is what terminates TLS, so it is also
// what may have just fetched the first certificate — and therefore what has to move
// `baseUrl` onto the name. Its backends bind loopback and deliberately do not. Before
// the renewal loop, because this is about the certificate `listen()` has already got
// and that one is about the next one.
reconcileBaseUrl(cfg, { persist: true });
// From here on a crash in *this* process is a bead rather than only a log line — bc-ega4,
// which is bc-p38c.4 finished. The backend got that first and it was the smaller half: a
// backend that dies is replaced by the router within seconds and the phone never notices,
// so its crashes are the survivable ones. This process is the one holding the certificate
// on the real port, and its crash takes the whole service down until launchd notices — so
// it was the crash most worth a bead and the one that had none.
await armCrashHandlers();
// The router is what holds the certificate on the real port, so the router is what has
// to keep it alive — a 90-day certificate outlives no restart this process ever gets —
// and what has to *get* one when `listen()` came up without: `onAcquired` is the same
// call as the one above, made again at the moment the socket stops being plain http, so
// the URL a phone is handed follows the certificate rather than waiting for a restart.
let renewal = startRenewal(cfg, servers, {
  notify: notifyCertificate,
  onAcquired: () => reconcileBaseUrl(cfg, { persist: true }),
  log,
  warn,
});
// And the other half of `deferTailnet`: bind the address now that it is here, and put
// the renewal loop back around the sockets — `startRenewal` filters the array it is
// handed *once*, at call time, and returns null when none of them are TLS. A router
// that came up loopback-only therefore has no renewal at all, so the late bind is the
// first moment there is anything to renew. Clearing the old timer first keeps that
// idempotent if Tailscale goes down and comes back more than once.
armLateBind(() => {
  let late = null;
  late = bindHost(cfg.host, {
    // On the bind actually succeeding, and not a moment before it — mirroring the fix
    // lib/server.js got in bc-b4fs.1. Pushed into the same array `shutdown` closes and
    // `startRenewal` reads, so the late socket is closed on SIGTERM like any other, and
    // an address that flaps does not leave a dead pair in that array on every attempt.
    onBound: () => {
      servers.push(...late);
      if (renewal) clearInterval(renewal);
      renewal = startRenewal(cfg, servers, {
        notify: notifyCertificate,
        onAcquired: () => reconcileBaseUrl(cfg, { persist: true }),
        log,
        warn,
      });
      // The URL a phone is handed names the address, not the certificate, until there
      // is one — so it moves when the address does.
      reconcileBaseUrl(cfg, { persist: true });
    },
    // Nothing to exit over here whatever happens: loopback is already serving, and an
    // address that has gone away again is simply deferred a second time.
    onError: (err) => {
      late?.forEach(closeServer);
      if (err.code !== 'EADDRNOTAVAIL') return;
      // After a wait, and never straight away. `watchForAddress` fires immediately for
      // an address the interface list already claims — and the list claiming one the
      // kernel then refuses to bind is precisely the state this branch is in, so
      // re-arming synchronously is a hot loop rather than a retry: defer, fire, fail,
      // defer, as fast as the event loop will go, for as long as the two disagree. One
      // interval of quiet makes it a retry again.
      setTimeout(deferTailnet, WATCH_EVERY_MS).unref?.();
    },
  });
});
log(`supervising ${BACKEND}`);
await bringUp('first start').catch((err) => {
  // Keep the port. A router that exited here would be restarted by launchd into the
  // same failure with nothing listening in between; holding the socket and answering
  // 503 at least says what is wrong — and `recover`, on the watch tick below, is what
  // makes the second half of that sentence true. It did not used to be: `watchDisk`
  // returned early with no active backend, so a first start that failed was final.
  warn(`nothing is being served yet — ${err.message}`);
});
watchDisk();
watchSelf();
heartbeat();
