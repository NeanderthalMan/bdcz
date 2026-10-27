/**
 * Serve any repo's static web directory to a headless Chrome, and evaluate an expression
 * against it.
 *
 * `bin/b7e-probe` is the thin CLI shell — argv, the Chrome, the printing — and everything
 * that can be gotten wrong lives here so `test/b7e-probe.mjs` can drive it with no Chrome
 * at all, the same split `lib/eyeball.js` draws for `bin/b7e-eyeball`.
 *
 * ## Why this is a command and not a paragraph in a debrief
 *
 * Three sessions in the delmar tracker (dv-k4n.103, dv-k4n.106, dv-k4n.107) each
 * hand-built the same rig in a scratchpad — a static server over some directory, a
 * headless Chrome, a probe that evaluates something against the loaded page, then a
 * cleanup — and no two were alike. `lib/eyeball.js` is close but answers a different
 * question: it serves *this repo's own* `public/` behind its app's alias table and
 * measures CSS selectors against a page or a generated fixture. This serves *any*
 * checkout's static directory, unaliased, and evaluates an arbitrary expression instead
 * of a fixed measurement. Nothing here is delmar-specific — delmar's atlas is the first
 * caller and the source of every trap below, not the subject (bc-dgx7.145).
 *
 * ## The LFS trap, and why resolution happens at serve time, not on disk
 *
 * A fresh worktree of an LFS repo has its binary assets as ~130-byte pointer files, and
 * `git lfs pull` silently no-ops there. The pointer's *real* bytes are sitting one path
 * over, in the main checkout that worktree was branched from — so `createProbeServer`
 * answers a request for a pointer file by serving the same relative path out of the main
 * checkout instead, in memory, and records which paths it did that for. It never writes
 * anything into the worktree: overwriting the pointer file on disk is the one thing the
 * bead's own text rules out, because it leaves `git status` showing `M` on a file nobody
 * meant to touch, and `bin/deliver.js` then refuses the tree over a diff that is not the
 * caller's work.
 *
 * ## Why a timeout names the CDP method
 *
 * `Runtime.evaluate` with `awaitPromise: true` does not resolve until the promise
 * settles — so an expression that awaits a promise nothing ever resolves (a
 * `requestAnimationFrame` in a backgrounded tab, an event that never fires) hangs the
 * whole run rather than failing it. `withTimeout` below is what turns that into an `exit
 * 1` naming the call it was waiting on, rather than a session that looks hung and is
 * actually just parked on a CDP round trip.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

/** Both the phone-scale and the desktop-scale default, because callers rarely say. */
export const DEFAULT_WIDTH = 1440;
export const DEFAULT_HEIGHT = 900;

/** `60s` unless a caller has reason to wait longer on a page they know is slow. */
export const DEFAULT_TIMEOUT_MS = 60_000;

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.mp4': 'video/mp4',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** A filename fragment that survives a shell, a finder and a `Read` — same rule as eyeball's. */
export const slug = (s) =>
  String(s)
    .replace(/^#/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'index';

/* --------------------------------------------------------------------- LFS */

const LFS_SIGNATURE = 'version https://git-lfs.github.com/spec/v1';

/**
 * A git-lfs pointer file is always small text starting with this exact line — the real
 * asset is never mistaken for one because a real PNG or `.bin` this size does not start
 * with an ASCII "version " line, and a pointer this large does not exist.
 */
export function isLfsPointer(buf) {
  if (!buf || buf.length === 0 || buf.length > 1024) return false;
  const text = buf.toString('utf8', 0, Math.min(buf.length, LFS_SIGNATURE.length));
  return text === LFS_SIGNATURE;
}

/**
 * The main checkout a linked worktree was branched from, or `null` when `dir` already is
 * one (nothing to resolve from) or is not a git checkout at all.
 *
 * `--git-common-dir` is shared by every worktree of one repo; `--git-dir` is this one's
 * own. They differ only for a linked worktree, and the main checkout's working tree is
 * the common dir's own parent — never derived from `git worktree list`'s ordering, which
 * is a UI convenience with no defined stability.
 */
export function findMainCheckout(dir) {
  try {
    // `execFileSync` inherits stderr by default, so a directory that is not a git repo at
    // all would otherwise print git's own "fatal: not a git repository" past this
    // function's own `null` — piped and dropped rather than left to leak.
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const own = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-dir'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (common === own) return null;
    return path.dirname(common);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ serving */

/**
 * `<root>/<serveDir>` over HTTP, on a port the kernel picked, with no alias table — this
 * is a plain static server for a directory that is not necessarily this repo's own.
 *
 * `baseline`, when given, serves `<ref>:<serveDir>/<rel>` out of git instead of the
 * working tree, so a caller can compare a checked-in state against the one on disk
 * without a `git stash`.
 *
 * `takeResolved()` drains the list of paths this server served out of the main checkout
 * rather than the worktree since the last call — one call per navigation is how a probe
 * record says which files were LFS pointers here.
 */
export async function createProbeServer({ root, serveDir, baseline = null }) {
  const servedRoot = path.resolve(root, serveDir);
  if (!fs.existsSync(servedRoot)) throw new Error(`${servedRoot} does not exist`);
  const mainRoot = baseline ? null : findMainCheckout(root);
  const mainServedRoot = mainRoot ? path.resolve(mainRoot, serveDir) : null;
  let resolved = [];

  const committed = (rel) => {
    try {
      return execFileSync('git', ['show', `${baseline}:${path.posix.join(serveDir, rel).replace(/\\/g, '/')}`], {
        cwd: root,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(servedRoot, rel);
    if (file !== servedRoot && !file.startsWith(servedRoot + path.sep)) {
      res.writeHead(403).end('no');
      return;
    }

    let body = null;
    if (baseline) {
      body = committed(rel);
    } else {
      try {
        body = fs.readFileSync(file);
      } catch {
        body = null;
      }
      if (body && isLfsPointer(body) && mainServedRoot) {
        const altFile = path.join(mainServedRoot, rel);
        try {
          const alt = fs.readFileSync(altFile);
          if (!isLfsPointer(alt)) {
            body = alt;
            resolved.push(rel);
          }
        } catch {
          /* the main checkout does not have it either — serve the pointer, unresolved */
        }
      }
    }

    if (body == null) {
      res.writeHead(404).end('no');
      return;
    }
    const type = MIME_TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    mainRoot,
    /** Paths served out of the main checkout since the last call, then cleared. */
    takeResolved() {
      const out = resolved;
      resolved = [];
      return out;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/* --------------------------------------------------------------- URL states */

/** One state per `--hash`, defaulting to the bare page — `#` is optional on the way in. */
export function planStates({ hashes = [''], width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, outDir = null, name = 'probe' } = {}) {
  const list = hashes.length ? hashes : [''];
  return list.map((raw) => {
    const hash = raw ? raw.replace(/^#/, '') : '';
    const png = outDir ? path.join(outDir, `${name}-${slug(hash)}-${width}x${height}.png`) : null;
    return { hash, width, height, png, label: hash ? `#${hash}` : '(no hash)' };
  });
}

/** The address a state is navigated to. */
export function stateUrl(origin, state) {
  return state.hash ? `${origin}/#${state.hash}` : `${origin}/`;
}

/* ------------------------------------------------------------------ waiting */

/** The poll expression `waitForGlobal` sends — exported so a caller can inline it too. */
export function globalReadyExpr(name) {
  return `(() => typeof window[${JSON.stringify(name)}] !== 'undefined')()`;
}

/**
 * Poll `evalJs` until `window[name]` exists or `timeoutMs` runs out.
 *
 * A statically served app's own top-level `const`/`let` is reachable from
 * `Runtime.evaluate` (they land on `window` the same as a `var` would once the module
 * finishes), but a CDP reply can arrive before the page has actually finished setting it —
 * this is the wait a caller reaches for instead of a fixed sleep and a guess.
 */
export async function waitForGlobal({ evalJs, name, timeoutMs = 15_000, intervalMs = 250, sleep = defaultSleep }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await evalJs(globalReadyExpr(name))) return true;
    if (Date.now() > deadline) return false;
    await sleep(intervalMs);
  }
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* -------------------------------------------------------------- long tasks */

/**
 * A `PerformanceObserver` for long tasks reads `0` under CDP-driven input — nothing about
 * a synthetic `Input.dispatchKeyEvent` or a `Runtime.evaluate` looks like user activity to
 * it. This is offered instead: a plain `setInterval` heartbeat an `--eval` expression can
 * start and stop around the code it wants to check for jank. A tick that took much longer
 * than its requested interval is the long task; there is no `Performance` API involved to
 * silently disagree with CDP again.
 *
 * Returned as source text because it has to be injected before the page's own scripts run
 * (`Page.addScriptToEvaluateOnNewDocument`), not called from Node.
 */
export function heartbeatInjection() {
  return `window.__b7eHeartbeat = (() => {
  let ticks = [];
  let timer = null;
  let last = 0;
  return {
    start(intervalMs) {
      const ms = intervalMs || 50;
      ticks = [];
      last = performance.now();
      timer = setInterval(() => {
        const now = performance.now();
        ticks.push(now - last);
        last = now;
      }, ms);
    },
    stop() {
      clearInterval(timer);
      return ticks.slice();
    },
  };
})();`;
}

/* -------------------------------------------------------------------- time */

/** `60s` / `1500ms` / `1500` (bare milliseconds) — never a guess at which unit a bare number meant without one. */
export function parseDurationMs(input, fallback) {
  if (input == null) return fallback;
  const m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(String(input).trim());
  if (!m) return NaN;
  const n = Number(m[1]);
  return m[2] === 'ms' ? n : n * 1000;
}

/**
 * Race a promise against a deadline, naming the CDP method it was waiting on when it
 * loses — the whole reason a timeout here is answerable rather than just a hang. Fires
 * even if `promise` never rejects or resolves: a `Runtime.evaluate` awaiting a promise
 * nothing ever settles is the motivating case, not an edge one.
 */
export function withTimeout(promise, ms, method) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting on ${method} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* ------------------------------------------------------------------ records */

/**
 * One state's record: the expression's return value, console errors, failed requests, the
 * screenshot path if one was taken, and which files this navigation served out of the
 * main checkout rather than the worktree.
 *
 * Only a thrown or timed-out evaluate fails a record — a statically served app 404ing on
 * its own API routes is normal, per the bead this ships for, so `consoleErrors` and
 * `failedRequests` are always reported and never on their own the reason `ok` is false.
 */
export function shapeRecord(state, raw) {
  const problems = (raw && raw.problems) || [];
  const failed = (raw && raw.failed) || null;
  const reasons = [];
  if (failed) reasons.push(failed);
  return {
    hash: state.hash,
    width: state.width,
    height: state.height,
    value: raw ? raw.value : undefined,
    consoleErrors: problems.filter((p) => p.kind === 'console.error' || p.kind === 'pageerror').map((p) => p.text),
    failedRequests: problems.filter((p) => p.kind === 'request failed' || p.kind === 'http').map((p) => p.text),
    resolvedFiles: (raw && raw.resolvedFiles) || [],
    screenshot: raw && raw.shot ? state.png : null,
    ok: reasons.length === 0,
    reasons,
  };
}

/**
 * Every state, in order, through an injected driver — `bin/b7e-probe` builds the real one
 * over `scripts/helpers/chrome.mjs`; `test/b7e-probe.mjs` passes a fake and asserts the
 * orchestration and the verdict with no Chrome anywhere near `npm test`.
 */
export async function runProbe({ states, driver, onState = null }) {
  const records = [];
  for (const state of states) {
    let raw;
    try {
      raw = await driver.shoot(state);
    } catch (err) {
      raw = { value: undefined, problems: [], failed: err.message, resolvedFiles: [], shot: false };
    }
    const record = shapeRecord(state, raw);
    records.push(record);
    if (onState) onState(record);
  }
  return { records, ok: records.every((r) => r.ok) };
}

/** `3/3 states clean` / `2/3 states clean, 1 failed: #z=12&bp=12900`. */
export function summaryLine(records) {
  const bad = records.filter((r) => !r.ok);
  const head = `${records.length - bad.length}/${records.length} states clean`;
  return bad.length ? `${head}, ${bad.length} failed: ${bad.map((r) => (r.hash ? `#${r.hash}` : '(no hash)')).join(', ')}` : head;
}
