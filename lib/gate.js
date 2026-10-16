/**
 * The whole suite, without bailing — one runner instead of a scratchpad script per session.
 *
 * `bin/b7e-gate` is the thin CLI shell; everything that can be gotten wrong lives here so
 * `test/gate.mjs` can drive it directly, against a fabricated tree, without spawning a
 * process that spawns processes. bc-khoe.39 names nine sessions that each hand-wrote this —
 * a 6-way `execFile` pool over `scripts/test.mjs --list`, a per-suite timeout, a tally at
 * the end — and none of the nine agreed on parallelism, timeout or whether to skip
 * `scripts/test-swap.js`. This is the one answer.
 *
 * ## Discovery is reused, not reimplemented
 *
 * `scripts/test.mjs --list --dir <root>` is the single source of truth for what a suite
 * *is* — the pinned order (`test/lockfile.mjs`, `scripts/selftest.mjs` first,
 * `scripts/test-swap.js` last) and the sorted middle both live there, and duplicating that
 * logic here would be a second place for the two lists to drift apart. Shelling out costs
 * one child process at startup and buys a discovery that can never disagree with `npm test`
 * about what a suite is.
 *
 * ## Two things `npm test` cannot do, which is the whole of this file
 *
 * **It does not stop at the first red.** Every suite in the selection runs; the exit code
 * is non-zero if any of them failed, but the other 340 still ran and are still reported.
 * That is the entire reason nine sessions wrote a runner instead of typing `npm test`.
 *
 * **It runs suites concurrently, for real.** [[parallel-runner-must-not-use-spawnsync]] is
 * the trap here: `spawnSync` blocks the one JS thread, so N "workers" built on it run
 * strictly one at a time and a serial run wears a parallel runner's clothes. This uses
 * `spawn` (async), a pool of `--jobs` workers pulling the next suite off a shared index,
 * each holding its own `TMPDIR` sandbox the way `scripts/test.mjs` and `scripts/checks.mjs`
 * both already do (bc-5isv) — so nothing here can leak the shared `$TMPDIR` twenty other
 * sessions are using, whatever concurrency it is asked to run at.
 *
 * ## Two suites cannot take the pool, and one kind wants longer alone
 *
 * `scripts/test-swap.js` drives a real blue/green swap under load and `test/slowstart.mjs`
 * fails under concurrent load and passes alone — both documented flakes under a parallel
 * runner ([[the-parallel-gate-runner-and-what-reproduces-on-main]],
 * [[slowstart-fails-under-load]]). Both are held out of the pool and run afterward, one at
 * a time. Suites that drive the *real* `bd` against shared state — every `test/*real.mjs`
 * plus `test/landcheck.mjs`, which drives a real `git`+`bd` end to end through
 * `bin/deliver.js` — get a longer per-suite timeout by default, so a loaded Mac reports a
 * slow pass rather than manufacturing a red one; `--timeout` overrides this uniformly when
 * given, because an explicit ask is a real ask.
 *
 * ## One gate per tree at a time, and two on the Mac
 *
 * A second invocation against the same root while the first is still running would double
 * the load a busy Mac is already under, so it refuses instead — a lock file under the
 * system temp directory, keyed by the resolved root, holding the running pid. A lock whose
 * pid is no longer alive is stale and is silently reclaimed, because a runner that leaves a
 * permanent lock behind after a crash is worse than the race it was trying to prevent.
 *
 * That refusal is right and too narrow: the same doubling happens just as thoroughly from
 * a different worktree, and there are ~20 of those. `acquireSlot` is the machine-wide half
 * (bc-xlz32.1) — a small FIFO semaphore that makes the third gate *wait* rather than run on
 * top of the other two, and `chooseJobs` (bc-xlz32.5) is the other side of the same budget:
 * how much of the machine one gate takes, chosen from the load rather than from a constant.
 * The per-tree refusal stays exactly as it was; two gates on one tree is a distinct bug
 * (same scratch, same run record) and this does not replace it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { NO_LAUNCH } from './launchguard.js';
import { onExit } from './teardown.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** This repo's own root — the one `scripts/test.mjs` discovery is always read from. */
export const REPO_ROOT = path.join(HERE, '..');
const TEST_RUNNER = path.join(REPO_ROOT, 'scripts', 'test.mjs');

/** Ordinary suites: five minutes is generous for anything that is not real-bd or real-git. */
export const DEFAULT_TIMEOUT_MS = 300_000;
/** The suites below get fifteen — a loaded Mac should report them slow, not report them red. */
export const SLOW_TIMEOUT_MS = 900_000;

/**
 * Drives the real `bd` against shared state, or the real `git`+`bd` through
 * `bin/deliver.js` — both documented flakes under load, neither fixable by code here.
 * Named explicitly rather than by convention alone, because `test/landcheck.mjs` does not
 * end in `real.mjs` and a future suite doing the same thing may not either.
 */
const SLOW_NAMES = new Set(['test/landcheck.mjs']);
const SLOW_RE = /real\.mjs$/i;

/** Cannot share the pool with anything else — see the header. Always run alone, afterward. */
export const SOLO = new Set(['scripts/test-swap.js', 'test/slowstart.mjs']);

export const isSlow = (suite) => SLOW_NAMES.has(suite) || SLOW_RE.test(suite);
export const isSolo = (suite) => SOLO.has(suite);

/** `overrideMs` is what `--timeout` becomes — given or not, this is the one place that decides. */
export const timeoutMsFor = (suite, overrideMs) =>
  overrideMs != null ? Math.max(0, overrideMs) : isSlow(suite) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

/* ------------------------------------------------------------------------ discovery */

/** `scripts/test.mjs --list --dir <root>` — the one place a suite list is decided. */
export function discoverSuites(root) {
  const out = execFileSync(process.execPath, [TEST_RUNNER, '--list', '--dir', path.resolve(root)], {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

/* ---------------------------------------------------------------- --only / --skip */

/**
 * A suite path or a glob with `*` — never a regex, so a suite named `test/a.b.mjs` cannot
 * have its own dots misread. `b7e-affected` (not shipped yet) would print exact suite
 * paths, one per `--only`, and those pass straight through unchanged: a pattern with no
 * `*` compiles to an exact match.
 */
export function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export const matchesAny = (suite, patterns) => patterns.some((p) => globToRegExp(p).test(suite));

/** `only` narrows, `skip` removes — same list, applied in that order. */
export function selectSuites(all, { only = [], skip = [] } = {}) {
  let picked = only.length ? all.filter((s) => matchesAny(s, only)) : all.slice();
  if (skip.length) picked = picked.filter((s) => !matchesAny(s, skip));
  return picked;
}

/* --------------------------------------------------------------------------- lock */

/** Never inside a worktree — this is `os.tmpdir()`, keyed by the resolved root. */
function lockPathFor(root) {
  const key = crypto.createHash('sha1').update(fs.realpathSync(path.resolve(root))).digest('hex').slice(0, 16);
  return path.join(fs.realpathSync(os.tmpdir()), `beadcause-gate-${key}.lock`);
}

/** `EPERM` means the pid exists and belongs to someone else — still alive, from here. */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * The live `b7e-gate` lock on `root`, if any — `{ pid, startedAt, lockPath }`, or `null`
 * when nothing holds it (never written, or held by a pid that is no longer alive).
 * Read-only, unlike `acquireLock` below, which reuses this for the same check before
 * deciding whether to write it. `bin/b7e-gates` (bc-khoe.55) is the reason it is
 * exported: for any run that went through this lock at all, "which worktree is this pid
 * in" is this one file read, with no `lsof` involved.
 */
export function gateLockStatus(root) {
  const lockPath = lockPathFor(root);
  if (!fs.existsSync(lockPath)) return null;
  let held = null;
  try {
    held = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
  if (held && typeof held.pid === 'number' && isPidAlive(held.pid)) {
    return { pid: held.pid, startedAt: held.startedAt, lockPath };
  }
  return null;
}

/**
 * `{ ok: true, release, disarm }` on success, `{ ok: false, pid, startedAt }` if another
 * gate on this root is already running. A lock whose pid is no longer alive is stale and
 * is reclaimed rather than left to block every future run — a crash must not be a
 * permanent refusal.
 *
 * `onExit(release)` is armed **here**, in the same breath as the write above, rather than
 * left to the caller's next statement — bc-arj0.25. The old shape (`bin/b7e-gate` writing
 * the lock, returning, and only then calling `onExit(lock.release)` itself) left a real
 * gap: the file is visible to any other process's `fs.existsSync` the instant the write
 * above lands, but nothing was yet armed to release it on a signal until that later
 * statement ran — and `onExit`'s first call in a process also pays for installing the
 * actual OS signal handlers (`teardown.js`'s `wire()`), not just an array push. On a
 * quiet Mac that gap is unmeasurable; on a loaded one it is wall-clock time a fast poll
 * can land a `SIGTERM` inside, which is what `test/gate.mjs`'s signalled-run check hit
 * under a full gate. Registering the disarm-capable teardown immediately after the write
 * closes it to the width of a closure allocation and an array push — no syscall, nothing
 * left for a scheduler to preempt in between.
 */
export function acquireLock(root) {
  const lockPath = lockPathFor(root);
  const status = gateLockStatus(root);
  if (status) return { ok: false, pid: status.pid, startedAt: status.startedAt, lockPath: status.lockPath };
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      /* a teardown must never be why a run ends badly */
    }
  };
  const disarm = onExit(release);
  return { ok: true, release, disarm, lockPath };
}

/* ---------------------------------------------------------- machine-wide slots */

/**
 * How many full suite runs this Mac may carry at once — bc-xlz32.1.
 *
 * The lock above is the same argument said too narrowly: *"a second invocation against the
 * same root while the first is still running would double the load a busy Mac is already
 * under"*. It doubles it just as thoroughly from a different worktree, and with ~20 live
 * worktrees that is what happens. Measured on 2026-08-24 from `.claude/gate-runs`: a gate
 * with nothing overlapping it is a mean 9.6 min (n=16); the same run with >=1.5 concurrent
 * sibling gates is 16.7 min (n=13). Nobody gains — the machine has the same 12 cores
 * whether one gate or six are asking for them, so running six together only means all six
 * wait 74% longer for identical work, and the loaded runs are the ones that then
 * manufacture false reds.
 *
 * ## A queue, not a refusal
 *
 * A run that cannot get a slot **waits and says what it is waiting for**. Refusing would be
 * worse than the problem: a session told to go away runs `node scripts/test.mjs` instead,
 * which is exactly where the two invisible 41- and 51-minute runs came from.
 *
 * ## Tickets rather than a counter
 *
 * Every waiter writes one ticket file and never rewrites it; a ticket holds a slot when it
 * is among the `limit` oldest live tickets. Two runs starting in the same millisecond
 * cannot both read "one free" and both take it, because neither decides anything — the
 * directory listing does, and both see the same one. It is also FIFO, which a
 * check-then-write counter is not: a loser keeps its place instead of going to the back of
 * the queue on every retry, so a gate on a busy Mac cannot starve.
 *
 * A ticket whose pid is no longer alive is reclaimed by whoever notices, the way the lock
 * above already does, so a holder killed with SIGKILL frees its slot rather than wedging
 * the machine.
 *
 * ## Three runs that must never queue
 *
 * **A runner inside a gate.** `runSuite` sets `HELD_ENV` on every suite child, so a gate
 * (or an `npm test`) started by a suite is inside a budget somebody already paid for.
 * Without this a suite that drives this very CLI would wait for a slot its own parent is
 * holding, which is a deadlock with a two-hour timeout on it.
 *
 * **CI.** A GitHub runner is a machine of its own and must never queue behind this Mac.
 *
 * **Anything that opted out**, with `BEADCAUSE_GATE_SLOTS=0` — how a suite testing the
 * semaphore itself stays hermetic.
 */
export const DEFAULT_SLOTS = 2;

/** Set on every suite child: "you are already inside a gate's slot, do not take another." */
export const HELD_ENV = 'BEADCAUSE_GATE_HELD';

/**
 * Never under a per-suite `TMPDIR` sandbox. Both `scripts/test.mjs` and `runSuite` below
 * hand every suite its own `TMPDIR` and delete it afterwards, so a semaphore rooted in a
 * child's idea of the temp directory would be wiped, and shared with nobody. This is
 * always resolved in the parent, before any sandbox exists.
 *
 * Two runs share a semaphore when they share a temp directory, which on this Mac means
 * every session of this user — the same assumption the per-tree lock above has always made,
 * and the reason both live here rather than in the checkout. A run given a `TMPDIR` of its
 * own (a suite driving this, `test/gateslots.mjs`) queues only against itself, which is
 * exactly what a test of the queue wants.
 */
export function slotDir(base, lane = FULL_LANE) {
  const dir = path.join(base || fs.realpathSync(os.tmpdir()), 'beadcause-gate-slots');
  return lane === SMALL_LANE ? path.join(dir, SMALL_LANE) : dir;
}

/** `0` means "do not queue at all" — see the three cases in the header. */
export function slotLimit(env = process.env) {
  if (env[HELD_ENV]) return 0;
  if (env.CI) return 0;
  const given = env.BEADCAUSE_GATE_SLOTS;
  if (given == null || given === '') return DEFAULT_SLOTS;
  const n = Number(given);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_SLOTS;
}

/**
 * ## Two lanes, because the queue must not be size-blind — bc-xlz32.12
 *
 * One FIFO charged every gate as a full one: a gate with 11 suites and twelve seconds of
 * work queued behind two 500-suite gates and cost its session 35 minutes (2026-08-27,
 * `haptic-audition-ka5y1518`). So a gate now counts its suites **before** it asks for a
 * slot, and one selecting no more than `SMALL_GATE_SUITES` goes into a lane of its own
 * with `SMALL_SLOTS` tickets beside the two full ones. A small gate never waits for a full
 * one and a full one never waits for a small one; the full lane — the load budget
 * bc-xlz32.1 set, and what is holding this Mac together — is exactly as it was.
 *
 * Why a lane rather than no token at all: a burst of narrow gates from a dozen sessions is
 * still a dozen pools on twelve cores, and the lane is what keeps that bounded. Why 60:
 * measured over the last 400 records in `.claude/gate-runs` on 2026-09-18, gate sizes are
 * bimodal — nothing between 236 and 420 suites — and a gate of 60 suites or fewer is
 * typically well under 300 suite-seconds of work (median ~100), against ~6000 for a full
 * one. A 60-suite gate that happens to include `test/landcheck.mjs` is the worst case, and
 * it is still one suite of five minutes, not fifty.
 *
 * **Mid-size gates stay in the full lane, deliberately — bc-xlz32.14.** Of the 99 records
 * with a slot field on 2026-09-22, 22 were narrowed gates of 61-469 suites, and they
 * queued in the full lane behind whole ones: one 86-suite gate waited 64 minutes for 2 of
 * work. Raising this number was the obvious fix and it was turned down, because it moves
 * load rather than queueing. A 200-suite gate is a third to two thirds of a full gate's
 * suite-seconds, and two of them in the small lane beside two full gates is a Mac running
 * three full gates' worth — which is exactly the budget bc-xlz32.1 set `DEFAULT_SLOTS` to
 * hold. What those gates were really waiting behind was the other thing bc-xlz32.14
 * changed. 37 whole-suite *session* gates in three days, not one of them a deliberate
 * `--full`, were the full lane's traffic, and `b7e-gate` now narrows by default. A diff
 * touching only docs now selects about 26 suites, not all of them. If mid-size gates still
 * wait once that has landed, the next lever is charging a ticket by a gate's measured
 * suite-seconds rather than by a count, not a bigger count.
 *
 * Off whenever the full lane is off: `slotLimit()`'s held and CI exemptions, and
 * `BEADCAUSE_GATE_SLOTS=0`, switch off both, so nothing that must never queue starts
 * queueing in the new lane instead.
 */
export const FULL_LANE = 'full';
export const SMALL_LANE = 'small';
export const SMALL_GATE_SUITES = 60;
export const SMALL_SLOTS = 2;

/** Tickets in the small lane: `0` whenever `slotLimit(env)` is. */
export function smallSlotLimit(env = process.env) {
  if (!slotLimit(env)) return 0;
  const given = env.BEADCAUSE_GATE_SMALL_SLOTS;
  if (given == null || given === '') return SMALL_SLOTS;
  const n = Number(given);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : SMALL_SLOTS;
}

/**
 * Which lane a gate of `count` suites queues in, and how many tickets that lane has.
 * `admission` is what the run record says (bc-xlz32.11): `full` and `small` are the two
 * lanes, `off` is "no semaphore applied" — held, CI, or opted out — so a reader of
 * `.claude/gate-runs` can tell a gate that got straight in from one that was never asked.
 * An unknown size (`count` not a number: the Python arm) is charged as full.
 */
export function gateAdmission(count, env = process.env) {
  const small = Number.isFinite(count) && count <= SMALL_GATE_SUITES && smallSlotLimit(env) > 0;
  const lane = small ? SMALL_LANE : FULL_LANE;
  const limit = small ? smallSlotLimit(env) : slotLimit(env);
  return { lane, limit, admission: limit ? lane : 'off' };
}

/**
 * Every live ticket, oldest first, unlinking the ones whose holder is gone. Exported
 * because "what is this gate waiting for" is a question worth answering from outside.
 */
export function liveSlots(base, lane = FULL_LANE) {
  const dir = slotDir(base, lane);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const live = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    let ticket = null;
    try {
      ticket = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      ticket = null;
    }
    if (!ticket || typeof ticket.pid !== 'number' || !isPidAlive(ticket.pid)) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* somebody else reclaimed it first, which is the same outcome */
      }
      continue;
    }
    live.push({ ...ticket, name, file });
  }
  live.sort((a, b) => a.startedAt - b.startedAt || (a.name < b.name ? -1 : 1));
  return live;
}

/**
 * Wall-clock milliseconds, but with the sub-millisecond part kept — which is what makes the
 * queue below FIFO rather than a coin toss. `Date.now()` is a whole millisecond, and three
 * gates started in a loop (`test/gateslots.mjs`) all land inside one; ordering equal stamps
 * fell through to the random suffix in the ticket's own filename, so a gate arriving third
 * sorted first about two times in three and took a slot the two ahead of it were holding.
 * That is not only a flaky suite: it is `limit + 1` gates on the Mac at once, which is the
 * one thing the semaphore exists to stop. `performance.now()` is monotonic within a process,
 * so a later ticket is now always a larger number, and adding `timeOrigin` keeps the stamp
 * comparable across processes and readable as a real time by `waitingLine`.
 */
const hiresNow = () => performance.timeOrigin + performance.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Take one of the machine's slots, waiting until one is free.
 *
 * `{ held, release, disarm, waitedMs, ahead }` — `held: false` with no-op `release`/`disarm`
 * when the semaphore is off, so every caller can `await` this unconditionally and release
 * in a `finally` without asking whether it queued. `onWait({ ahead, waitedMs, oldest })` is
 * called on every poll while waiting, and the caller decides how loudly to say it. `lane`
 * picks which queue (`gateAdmission` above); the two never see each other's tickets.
 *
 * `abandoned`, if given, is asked before every poll and once more before a slot is taken:
 * when it says yes the ticket is withdrawn and this returns `{ held: false, abandoned: true }`
 * — the way out for a gate whose reader has gone (`ownerGone` below, bc-xl7n.165). It is
 * never asked once a slot is held, so it can end a queue position and nothing else.
 *
 * `onExit(release)` is armed right after the ticket is written, before the wait loop —
 * same reasoning as `acquireLock` above (bc-arj0.25). It also means a `SIGTERM` that
 * arrives *while still waiting* for a slot, which is exactly when a signal is likeliest
 * on a loaded Mac, now removes the ticket too, instead of only once a slot was won.
 */
export async function acquireSlot({
  base,
  limit = slotLimit(),
  pid = process.pid,
  root = '',
  onWait,
  pollMs = 1000,
  now = hiresNow,
  lane = FULL_LANE,
  abandoned,
} = {}) {
  if (!limit) return { held: false, release: () => {}, disarm: () => {}, waitedMs: 0, ahead: 0 };
  const dir = slotDir(base, lane);
  fs.mkdirSync(dir, { recursive: true });
  const startedAt = now();
  const ticket = JSON.stringify({ pid, startedAt, root });
  const file = path.join(dir, `${startedAt}-${pid}-${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(file, ticket);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* a teardown must never be why a run ends badly */
    }
  };
  const disarm = onExit(release);
  for (;;) {
    if (abandoned?.()) {
      disarm();
      release();
      return { held: false, abandoned: true, release, disarm, waitedMs: now() - startedAt, ahead: 0 };
    }
    const live = liveSlots(base, lane);
    const at = live.findIndex((t) => t.file === file);
    if (at === -1) {
      // Reclaimed by somebody who read it mid-write, or removed under us. Write it again
      // with the *original* `startedAt`, so losing the file does not lose our place.
      fs.writeFileSync(file, ticket);
      await sleep(pollMs);
      continue;
    }
    if (at < limit) return { held: true, release, disarm, waitedMs: now() - startedAt, ahead: at };
    onWait?.({ ahead: at, waitedMs: now() - startedAt, oldest: live[0] });
    await sleep(pollMs);
  }
}

/** "2 gates ahead of you, oldest started 4m ago" — one line, said while waiting. */
export function waitingLine({ ahead, oldest }, now = Date.now()) {
  const gates = `${ahead} gate${ahead === 1 ? '' : 's'} ahead of you`;
  if (!oldest?.startedAt) return `${gates} — waiting rather than doubling the load`;
  const mins = Math.max(0, Math.round((now - oldest.startedAt) / 60_000));
  const since = mins < 1 ? 'less than a minute ago' : `${mins}m ago`;
  return `${gates}, oldest started ${since} — waiting rather than doubling the load`;
}

/* ------------------------------------------------------- a queue nobody is waiting in */

/**
 * ## Whose result is this — bc-xl7n.165
 *
 * Everything above reclaims a holder whose *pid* is dead, and that is the wrong question
 * for one case: a gate whose session died and whose own process did not. It is alive, so
 * its ticket and its per-tree lock are honoured, and it sits in the queue — or takes a slot
 * and runs a whole gate — for a result nothing will ever read. Measured 2026-09-20: pid
 * 89475, reparented to 1 with no child suite, ahead of every gate behind it for the best
 * part of an hour. Liveness of the holder is not liveness of the work.
 *
 * **Not `ppid === 1`, which is what the bead first proposed.** `b7e-detach` starts a gate
 * with `setsid(2)` and lets go of it, so every gate it starts has `ppid` 1 *by design* —
 * measured the same afternoon on pid 70952, a healthy run mid-suite for a live session. A
 * rule that treated that as stale would evict every detached gate on the Mac, which is
 * exactly the population `b7e-detach` exists to make normal.
 *
 * The question that does separate them is who asked. A gate started from a Claude Code
 * session has one — the nearest `claude` process above it — and a gate started any other
 * way (a shell in iTerm, launchd, CI) has none and is never touched: **no owner means no
 * opinion.** `findOwner` resolves it once, at the start, from the process table, and
 * `BEADCAUSE_GATE_OWNER` carries it across a `setsid` (`b7e-detach`, `b7e-shipgate`) that
 * would otherwise cut the chain. The start time goes with the pid so a recycled pid is not
 * mistaken for the session that had it.
 *
 * **Only a queued gate is withdrawn.** A gate that already holds a slot has a run record in
 * `.claude/gate-runs` that outlives whoever started it — `b7e-watch` reads it from any
 * later session — so a run in progress is left to finish, and its owner going away costs a
 * bounded run rather than a slot for ever. A queued gate has produced nothing and holds
 * only a place in line, which is what `acquireSlot`'s `abandoned` gives up.
 */
export const OWNER_ENV = 'BEADCAUSE_GATE_OWNER';

/**
 * By absolute path, not by name: the daemon's `PATH` has no `/usr/sbin` and this must not
 * depend on what a caller's does (the `lsof` trap, bc-xl7n.109), and a system binary named
 * by its path is the operating system rather than a supplier — the structural exemption in
 * `lib/suppliers.js` — where `ps` by name would want a register entry of its own.
 */
const PS = '/bin/ps';

/** `ps -o lstart=` for one pid — `null` when there is no such process. */
export function processStart(pid) {
  try {
    const out = execFileSync(PS, ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Every process as `{ pid, ppid, comm }`. `comm` can hold spaces (an `.app` path), so it is the rest of the line. */
export function processTable() {
  const out = execFileSync(PS, ['-Ao', 'pid=,ppid=,comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const rows = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), comm: m[3] });
  }
  return rows;
}

/** The nearest ancestor of `from` that is a `claude` session, or `null` — depth-limited so a cycle cannot spin. */
export function claudeAncestor(from, table) {
  const byPid = new Map(table.map((r) => [r.pid, r]));
  let at = byPid.get(from);
  for (let depth = 0; at && depth < 40; depth++) {
    if (path.basename(at.comm) === 'claude') return at.pid;
    if (at.ppid <= 1) return null;
    at = byPid.get(at.ppid);
  }
  return null;
}

/**
 * `{ pid, start }` of the session this gate answers to, or `null` for none. `env` wins when
 * it names a pid (an explicit ask from whatever started this, `0` meaning "no owner"), else
 * the chain above `from` is read. Never throws: a process table that cannot be read is an
 * owner nobody can name, which is `null` — a gate refusing to run over bookkeeping would be
 * a worse bug than the orphan.
 */
export function findOwner({ env = process.env, from = process.ppid, table, start = processStart } = {}) {
  let pid = null;
  const given = env[OWNER_ENV];
  if (given != null && given !== '') {
    const n = Number(given);
    if (!Number.isInteger(n) || n < 0) return null;
    pid = n || null;
  } else {
    try {
      pid = claudeAncestor(from, typeof table === 'function' ? table() : (table ?? processTable()));
    } catch {
      pid = null;
    }
  }
  return pid ? { pid, start: start(pid) } : null;
}

/** Is the session still there? No owner is "yes" — see the header. A pid that is now some other process is "no". */
export function ownerAlive(owner, { start = processStart } = {}) {
  if (!owner) return true;
  const now = start(owner.pid);
  return now != null && now === owner.start;
}

/**
 * The `abandoned` for `acquireSlot`: has the owner gone? Asked at most every `everyMs`, because
 * it is a `ps`, and a "yes" is remembered — a session does not come back. `everyMs` counts
 * from the first ask, which is immediate, so a gate whose owner died before it queued at all
 * is caught on its first poll.
 */
export function ownerGone(owner, { everyMs = 10_000, alive = ownerAlive, clock = Date.now } = {}) {
  if (!owner) return () => false;
  let checkedAt = -Infinity;
  let gone = false;
  return () => {
    if (gone) return true;
    const t = clock();
    if (t - checkedAt < everyMs) return false;
    checkedAt = t;
    gone = !alive(owner);
    return gone;
  };
}

/* ------------------------------------------------------------------- how many jobs */

/**
 * How many suites to run at once, from what the machine is actually doing — bc-xlz32.5.
 *
 * A constant 6 is wrong in both directions on this Mac. **Too few when it is quiet:** the
 * longest single suite is `test/landcheck.mjs` at 307s against ~50 min of total suite work,
 * so a pool does not begin waiting on a straggler until roughly 15 jobs — at 6 on an idle
 * 12-core Mac half the machine sits unused. **Too many when it is not:** six sessions each
 * asking for 6 is 36 concurrent suites on 12 cores, which is the load-99 measurement in
 * bc-xlz32, and where the false reds come from.
 *
 * `cores - loadavg1` is what is actually free right now; the floor of 2 keeps a gate moving
 * on a machine that is already hopeless, and the ceiling of `cores - 2` leaves the Mac
 * enough to stay usable for whoever is sitting at it. Sampled once at start rather than
 * tracked, because a pool that resized itself mid-run would make two runs of the same suite
 * incomparable, and the numbers this was measured from are per-run.
 */
export function chooseJobs({ cores = os.availableParallelism(), load = os.loadavg()[0] } = {}) {
  const ceiling = Math.max(2, cores - 2);
  const free = Math.floor(cores - load);
  return Math.max(2, Math.min(ceiling, free));
}

/** The opening line's explanation, so a slow gate can be accounted for afterwards. */
export function jobsLine({ jobs, cores, load, explicit }) {
  if (explicit) return `${jobs} suites at once, as asked`;
  return `${jobs} suites at once — ${cores} cores, load ${load.toFixed(1)}`;
}

/* ------------------------------------------------------------------------ running */

const rmQuietly = (dir) => {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* left for the stray sweep, same as scripts/test.mjs and scripts/checks.mjs */
  }
};

/**
 * One suite, one child, its own `TMPDIR` sandbox — kept if it failed, removed if it did not.
 * `live`, if given a Set, gets the child added and removed so a caller can end every
 * in-flight child on its own exit (see `runGate`'s `signalAbort` wiring). `env`, if given,
 * is merged in *underneath* the safety envs below (`NO_LAUNCH`, `HELD_ENV`, `TMPDIR`) — a
 * caller can parameterise a run (`bin/b7e-flake`'s `--env`) but can never use it to turn
 * off the launch guard or hand two runs the same scratch directory.
 */
/**
 * Signal a suite and every process it started. A suite is spawned `detached`, which makes
 * it a process-group leader, so `-pid` is the whole tree: the router a router suite
 * starts, and the standby backend that router starts, die with it instead of being
 * reparented to init when only the suite's own pid is killed (bc-xl7n.195). Falls back to
 * the single pid when the group is already gone.
 */
export function killSuite(child, signal) {
  try {
    process.kill(-child.pid, signal);
    return;
  } catch {
    /* no such group — fall through to the pid */
  }
  try {
    child.kill(signal);
  } catch {
    /* already gone */
  }
}

export function runSuite(root, suite, { timeoutMs = DEFAULT_TIMEOUT_MS, sandboxRoot, live, env } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const base = sandboxRoot || fs.realpathSync(os.tmpdir());
    const sandbox = fs.mkdtempSync(path.join(base, `${path.basename(suite).replace(/\W+/g, '-')}-`));
    let child;
    try {
      child = spawn(process.execPath, [path.join(root, suite)], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group, so a cap kill reaches everything the suite started and not
        // just the suite (bc-xl7n.195): killing the pid alone left a router suite's standby
        // backend reparented to init, alive for days. See `killSuite`.
        detached: true,
        // Layer 2 of the launch guard — see scripts/test.mjs, which sets the same thing for
        // the same reason: a suite that starts a real daemon must never open a real window.
        // `HELD_ENV` is the machine-wide semaphore's: this run already holds a slot, so a
        // suite that starts a runner of its own is inside that slot rather than queueing
        // behind it — which would be a deadlock, since the thing it waits for is its parent.
        env: { ...process.env, ...env, [NO_LAUNCH]: '1', [HELD_ENV]: '1', TMPDIR: sandbox },
      });
    } catch (err) {
      rmQuietly(sandbox);
      resolve({
        suite,
        status: 'FAIL',
        code: null,
        signal: null,
        timedOut: false,
        ms: Date.now() - started,
        out: `could not start — ${err.message}\n`,
      });
      return;
    }
    live?.add(child);
    let out = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killSuite(child, 'SIGTERM');
          setTimeout(() => killSuite(child, 'SIGKILL'), 5000).unref();
        }, timeoutMs)
      : null;
    child.on('error', (err) => {
      live?.delete(child);
      if (timer) clearTimeout(timer);
      rmQuietly(sandbox);
      resolve({
        suite,
        status: 'FAIL',
        code: null,
        signal: null,
        timedOut: false,
        ms: Date.now() - started,
        out: `${out}could not start — ${err.message}\n`,
      });
    });
    child.on('close', (code, signal) => {
      live?.delete(child);
      if (timer) clearTimeout(timer);
      if (timedOut) out += `\ntimed out after ${(timeoutMs / 1000).toFixed(0)}s — killed\n`;
      const ok = !timedOut && !signal && code === 0;
      const status = timedOut ? 'TIMEOUT' : ok ? 'ok' : 'FAIL';
      if (ok) rmQuietly(sandbox);
      resolve({ suite, status, code, signal, timedOut, ms: Date.now() - started, out, scratch: ok ? null : sandbox });
    });
  });
}

/**
 * The whole gate: discover (or take a given list), filter, split solo from concurrent, run
 * the concurrent pool at `jobs` workers, then the solo suites one at a time, streaming each
 * result through `onResult` as it finishes. Returns `{ results, passed, failed, total, ok }`.
 *
 * `suites`, if given, replaces discovery — this is how a test drives a small fabricated
 * list without shelling out to `scripts/test.mjs` twice.
 *
 * `jobs` keeps a fixed fallback rather than calling `chooseJobs` itself: the CLI decides
 * the real number (from the load, or from `--jobs`) and always passes one, and a library
 * default that moved with the load average would make a suite asserting on concurrency
 * pass or fail depending on what else was running.
 */
export async function runGate(
  root,
  { only = [], skip = [], jobs = 6, timeoutOverrideMs = null, onResult, signalAbort, suites } = {},
) {
  const all = suites || discoverSuites(root);
  const selected = selectSuites(all, { only, skip });
  const total = selected.length;
  const results = [];
  let done = 0;

  const sandboxRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-gate-run-'));
  const live = new Set();
  let off = null;
  if (signalAbort) {
    off = signalAbort(() => {
      for (const child of live) {
        killSuite(child, 'SIGTERM');
      }
    });
  }

  const record = async (suite) => {
    const timeoutMs = timeoutMsFor(suite, timeoutOverrideMs);
    const r = await runSuite(root, suite, { timeoutMs, sandboxRoot, live });
    done += 1;
    results.push(r);
    onResult?.(r, done, total);
    return r;
  };

  const concurrent = selected.filter((s) => !isSolo(s));
  const solo = selected.filter((s) => isSolo(s));

  let next = 0;
  const worker = async () => {
    while (next < concurrent.length) {
      const suite = concurrent[next++];
      await record(suite);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, concurrent.length || 1)) }, worker));

  for (const suite of solo) await record(suite);

  off?.();
  rmQuietly(sandboxRoot);

  const failed = results.filter((r) => r.status !== 'ok');
  const passed = results.length - failed.length;
  return { results, passed, failed, total, ok: failed.length === 0 };
}

/* ---------------------------------------------------------------------- reporting */

/** The one-line tally: `all N suites passed`, or `P/T passed, F failed: a, b, c`. */
export function summaryLine({ passed, total, failed }) {
  if (!failed.length) return `all ${total} suite${total === 1 ? '' : 's'} passed`;
  return `${passed}/${total} passed, ${failed.length} failed: ${failed.map((f) => f.suite).join(', ')}`;
}

/** `--json`: one object per finished suite, the same fields a human line is built from. */
export function toJsonRecord(result, done, total) {
  return {
    index: done,
    total,
    suite: result.suite,
    status: result.status,
    code: result.code,
    signal: result.signal,
    seconds: Number((result.ms / 1000).toFixed(1)),
  };
}
