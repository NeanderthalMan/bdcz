/**
 * A workspace repo's own gate scripts — discovered by manifest, run as a batch, with an
 * optional `--baseline` comparison against a git ref. `bin/b7e-checks` is the argv
 * shell; this is the manifest, the running and the baseline diff.
 *
 * bc-dgx7.57, built for a repo whose gates are Python scripts: several sessions each
 * hand-assembled this exact loop — every gate script, one process per script, its exit
 * code read directly — because the worktree-isolation guard refuses a bare `for` loop as
 * too complex to verify, and because `python3 check.py . | tail -1; echo $?` reports
 * `tail`'s exit status, not the check's (one spelling was reporting green for red). This
 * is the one answer, plus the baseline half every one of them also needed.
 *
 * ## The set is a per-checkout declaration, with no default
 *
 * Which scripts are a repo's "own gate scripts" is a fact about that repo, so the repo
 * says it: `.beadcause/checks.json` at the checkout root — the same convention
 * `.beadcause/derived.json` (`lib/derived.js`) and `views.json` (`lib/repoviews.js`) use,
 * and for the same reason: a gate's path and argv belong in the commit that changes them,
 * not in a table here that needs a pull request to this repo every time a script is
 * renamed. A checkout with no declaration is refused (`manifestFor` returns `null`)
 * rather than guessed at — beadcause assumes no naming convention for anybody's scripts.
 *
 *     {
 *       "checks": [
 *         { "glob": "scripts/check_*.py", "args": ["."] },
 *         { "script": "scripts/status.py", "args": [".", "--json"], "name": "status (DRIFT)",
 *           "passWhen": { "emptyArray": "drift", "label": "DRIFT", "describe": ["gate", "id"] } }
 *       ]
 *     }
 *
 * `glob` expands `*` within the last path segment only, sorted, one check per match,
 * named by its path; `script` names one file, and a declared script that is not on disk
 * is a failing check rather than a silent omission. Each runs as `python3 <script>
 * ...args` from the checkout root.
 *
 * ## Most checks are exit-code-only; `passWhen` is for the ones that are not
 *
 * A status report can exit 0 whatever it found — "not ready" being its normal state — so
 * its pass/fail rule is not the exit code. `passWhen.emptyArray` names a top-level array
 * in the script's `--json`-style stdout that must be empty for a pass; `label` and
 * `describe` (keys of each element) only shape the failure detail. Every check carries
 * its own `judge(result)` for exactly this reason; `byExitCode` is the default.
 *
 * ## Why this does not import `lib/gate.js`'s `runGate`/`runSuite`
 *
 * `acquireLock` is reused as-is below — a lock keyed by the resolved root needs nothing
 * check-specific. `runGate`/`runSuite` are not reusable: they spawn `node <suite file>`
 * against *this* repo's own `test/*.mjs`, and a check here is `python3 <script> <root>
 * [flags]` against a *different* repo's tree, with its own argv shape and its own
 * pass/fail rule. This file mirrors `runGate`'s pool/timeout/streamed-onResult shape —
 * the part that generalises — rather than importing code built on an assumption that
 * does not hold here.
 *
 * ## `--baseline <ref>` reuses the `makeMainWorktree` pattern, not the function
 *
 * `lib/blame.js`'s `makeMainWorktree` is hardcoded to `origin/main`; `--baseline` takes
 * any ref, so this holds its own `git worktree add --detach` helper rather than widening
 * a function whose whole contract (`removeMainWorktree`, the one-`origin/main`-per-run
 * caching in `runBlame`) is built around that one ref never changing mid-run.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { acquireLock, selectSuites } from './gate.js';

export { acquireLock, selectSuites };

/** Five minutes — the same default `lib/gate.js` uses for an ordinary suite. A selftest
 * that stages a repo copy per case has been observed over a minute; this is generous
 * rather than tight. `--timeout` overrides it uniformly. */
export const DEFAULT_TIMEOUT_MS = 300_000;

/* ------------------------------------------------------------------------ manifests */

export const MANIFEST_DIR = '.beadcause';
export const MANIFEST_FILE = 'checks.json';

/** The default judge: the process's own exit code, nothing else. */
export function byExitCode(r) {
  if (r.timedOut) return { ok: false, detail: 'timed out' };
  if (r.signal) return { ok: false, detail: `killed by ${r.signal}` };
  return { ok: r.code === 0, detail: lastLine(r.out) };
}

const lastLine = (out) =>
  String(out || '')
    .trim()
    .split('\n')
    .slice(-1)[0] || '';

/**
 * A judge for a script that reports rather than fails: exit 0 and an empty top-level
 * `field` array in its JSON stdout is a pass. A non-zero exit means it could not even
 * produce a report, which is a failure regardless of what the array says; unparseable
 * output on exit 0 is a failure too, never a silent pass.
 *
 * Parses `r.stdout` — never `r.out`, which is stdout and stderr combined for display,
 * the same way `lib/gate.js`'s `runSuite` combines them for its own `out`. A warning
 * landing on stderr, interleaved into that combined buffer at whatever moment its `data`
 * event fired, would otherwise be enough to break `JSON.parse` on a check that ran cleanly.
 */
export function emptyArrayJudge({ emptyArray, label, describe } = {}) {
  const field = String(emptyArray);
  const tag = label || field;
  const keys = Array.isArray(describe) ? describe.filter((k) => typeof k === 'string') : [];
  const show = (item) => {
    if (item && typeof item === 'object') {
      if (keys.length) return keys.map((k) => item[k]).filter((v) => v != null).join(' ');
      return JSON.stringify(item);
    }
    return String(item);
  };
  return (r) => {
    if (r.timedOut) return { ok: false, detail: 'timed out' };
    if (r.signal) return { ok: false, detail: `killed by ${r.signal}` };
    if (r.code !== 0) return { ok: false, detail: lastLine(r.out) || `exit ${r.code}` };
    let payload;
    try {
      payload = JSON.parse(r.stdout);
    } catch {
      return { ok: false, detail: 'exit 0 but its JSON output did not parse' };
    }
    const items = Array.isArray(payload?.[field]) ? payload[field] : [];
    if (items.length) return { ok: false, detail: `${tag}: ${items.map(show).join(', ')}` };
    return { ok: true, detail: `no ${tag}` };
  };
}

/** `*` within one path segment, nothing fancier — the whole grammar `glob` accepts. */
function segmentRegex(seg) {
  return new RegExp(`^${seg.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
}

function expandGlob(root, glob) {
  const rel = glob.replace(/^\.\//, '');
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel);
  if (dir.includes('*')) return { matches: [], problem: `glob "${glob}" may only use * in its last path segment` };
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return { matches: [] };
  const re = segmentRegex(base);
  const matches = fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile() && re.test(e.name))
    .map((e) => (dir === '.' ? e.name : `${dir}/${e.name}`))
    .sort();
  return { matches };
}

/**
 * `.beadcause/checks.json` at `root`, validated. `{ declared: false }` when there is no
 * file at all — the one state `manifestFor` turns into `null`. A file that is there but
 * unreadable, unparseable or malformed is `declared: true` with `problems`, so a caller
 * can say what is wrong with it rather than claim it is missing.
 */
export function loadChecksManifest(root) {
  const file = path.join(root, MANIFEST_DIR, MANIFEST_FILE);
  const where = `${MANIFEST_DIR}/${MANIFEST_FILE}`;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { declared: false, entries: [], problems: [] };
    return { declared: true, entries: [], problems: [`cannot read ${where} — ${err.message.split('\n')[0]}`] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { declared: true, entries: [], problems: [`${where} does not parse as JSON — ${err.message.split('\n')[0]}`] };
  }
  const list = Array.isArray(parsed?.checks) ? parsed.checks : null;
  if (!list) return { declared: true, entries: [], problems: [`${where} has no "checks" array`] };
  const entries = [];
  const problems = [];
  list.forEach((c, i) => {
    const at = `${where} checks[${i}]`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return void problems.push(`${at} is not an object`);
    const glob = typeof c.glob === 'string' && c.glob.trim() ? c.glob.trim() : null;
    const script = typeof c.script === 'string' && c.script.trim() ? c.script.trim().replace(/^\.\//, '') : null;
    if (!glob === !script) return void problems.push(`${at} needs exactly one of "glob" or "script"`);
    if (c.args !== undefined && !(Array.isArray(c.args) && c.args.every((a) => typeof a === 'string'))) {
      return void problems.push(`${at} "args" must be an array of strings`);
    }
    let judge = byExitCode;
    if (c.passWhen !== undefined) {
      if (!c.passWhen || typeof c.passWhen.emptyArray !== 'string' || !c.passWhen.emptyArray) {
        return void problems.push(`${at} "passWhen" must name an "emptyArray" field`);
      }
      judge = emptyArrayJudge(c.passWhen);
    }
    entries.push({ glob, script, args: c.args || [], name: typeof c.name === 'string' && c.name ? c.name : null, judge });
  });
  return { declared: true, entries, problems };
}

/** The checks one validated declaration expands to at `root`. */
function expandEntries(root, entries) {
  const checks = [];
  for (const e of entries) {
    if (e.glob) {
      for (const rel of expandGlob(root, e.glob).matches) {
        checks.push({ name: rel, argv: [rel, ...e.args], judge: e.judge });
      }
    } else {
      const present = fs.existsSync(path.join(root, e.script));
      checks.push({
        name: e.name || e.script,
        argv: [e.script, ...e.args],
        judge: present ? e.judge : () => ({ ok: false, detail: `declared in ${MANIFEST_DIR}/${MANIFEST_FILE} but not on disk` }),
        missing: !present,
      });
    }
  }
  return checks;
}

/**
 * The manifest for `root` — `{ name, file, problems, discover(dir) }` — or `null` when
 * the checkout declares none. `discover` takes a directory so a baseline worktree can be
 * expanded against *this* declaration when the ref predates the file (the declaration
 * says which scripts; the tree at the ref says which of them exist there).
 */
export function manifestFor(root) {
  const loaded = loadChecksManifest(root);
  if (!loaded.declared) return null;
  return {
    name: `${MANIFEST_DIR}/${MANIFEST_FILE}`,
    file: path.join(root, MANIFEST_DIR, MANIFEST_FILE),
    problems: loaded.problems,
    discover: (dir = root) => expandEntries(dir, loaded.entries),
  };
}

/** What `manifestFor(root).discover(root)` returns, or `[]` if the checkout declares none. */
export function discoverChecks(root) {
  const manifest = manifestFor(root);
  return manifest ? manifest.discover(root) : [];
}

/* -------------------------------------------------------------------------- running */

/**
 * One check, one `python3` child. `env`, if given, is merged over `process.env` — this
 * is how a caller running against another workspace overrides `BEADS_DIR` to the target
 * repo's own tracker rather than whatever this process inherited (its own workspace,
 * almost always a different tracker) — a check that shells out to `bd` would otherwise
 * silently query the wrong graph.
 */
export function runCheck(root, check, { timeoutMs = DEFAULT_TIMEOUT_MS, env } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = spawn('python3', check.argv, {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(env || {}) },
      });
    } catch (err) {
      resolve({
        name: check.name,
        ok: false,
        code: null,
        signal: null,
        timedOut: false,
        ms: Date.now() - started,
        out: `could not start — ${err.message}\n`,
        detail: `could not start — ${err.message}`,
      });
      return;
    }
    let out = '';
    let stdout = '';
    let timedOut = false;
    child.stdout.on('data', (d) => {
      out += d;
      stdout += d;
    });
    child.stderr.on('data', (d) => (out += d));
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5000).unref();
        }, timeoutMs)
      : null;
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        name: check.name,
        ok: false,
        code: null,
        signal: null,
        timedOut: false,
        ms: Date.now() - started,
        out: `${out}could not start — ${err.message}\n`,
        detail: `could not start — ${err.message}`,
      });
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) out += `\ntimed out after ${(timeoutMs / 1000).toFixed(0)}s — killed\n`;
      const r = { suite: check.name, code, signal, timedOut, ms: Date.now() - started, out, stdout };
      const verdict = (check.judge || byExitCode)(r);
      resolve({ name: check.name, code, signal, timedOut, ms: r.ms, out, ok: !!verdict.ok, detail: verdict.detail });
    });
  });
}

/**
 * Every check in `checks`, `jobs` at a time, streaming each result through `onResult` as
 * it finishes — the same shape `runGate` reports in, so `bin/b7e-checks` can borrow its
 * printing style. Returns `{ results, passed, failed, total, ok }`.
 */
export async function runChecks(root, checks, { jobs = 4, timeoutMs = DEFAULT_TIMEOUT_MS, onResult, env } = {}) {
  const total = checks.length;
  const results = [];
  let done = 0;
  let next = 0;

  const worker = async () => {
    while (next < checks.length) {
      const check = checks[next++];
      const r = await runCheck(root, check, { timeoutMs, env });
      done += 1;
      results.push(r);
      onResult?.(r, done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, checks.length || 1)) }, worker));

  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;
  return { results, passed, failed, total, ok: failed.length === 0 };
}

/* ------------------------------------------------------------------------- baseline */

/**
 * A throwaway detached `git worktree` at `ref`, `node_modules` never involved (these
 * are `python3` checks, not `node` suites). `root` must be a checkout with `ref`
 * resolvable from it. Caller owns teardown via `removeRefWorktree`.
 */
export function makeRefWorktree(root, ref) {
  const scratchRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-checks-'));
  const dir = path.join(scratchRoot, 'ref');
  execFileSync('git', ['worktree', 'add', '--detach', '-q', dir, ref], { cwd: root, stdio: 'pipe' });
  return { dir, scratchRoot };
}

/** Removes a worktree made by `makeRefWorktree`, best-effort and always. */
export function removeRefWorktree(root, dir, scratchRoot) {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: root, stdio: 'pipe' });
  } catch {
    /* best effort — prune and the scratch rm below are what actually guarantee cleanup */
  }
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: root, stdio: 'pipe' });
  } catch {
    /* nothing more to do about a prune that itself fails */
  }
  if (scratchRoot) fs.rmSync(scratchRoot, { recursive: true, force: true });
}

/**
 * Classify each of `current`'s results against a baseline run — `already-red` (failed on
 * both), `newly-red` (passed at the baseline, or did not exist there, and fails now),
 * `green` (passes now, whatever the baseline said). Matched by check **name**, the same
 * "compare by name, not by pass/fail bit" rule `lib/blame.js` uses, because a check that
 * did not exist at the baseline ref has nothing to be blamed on but itself.
 */
export function classifyAgainstBaseline(current, baseline) {
  const baselineByName = new Map(baseline.map((r) => [r.name, r]));
  return current.map((r) => {
    if (r.ok) return { ...r, baseline: 'green' };
    const at = baselineByName.get(r.name);
    return { ...r, baseline: at && !at.ok ? 'already-red' : 'newly-red' };
  });
}

/* --------------------------------------------------------------------- reporting */

/** The one-line tally, matching `lib/gate.js`'s `summaryLine` shape. */
export function summaryLine({ passed, total, failed }) {
  if (!failed.length) return `all ${total} check${total === 1 ? '' : 's'} passed`;
  return `${passed}/${total} passed, ${failed.length} failed: ${failed.map((f) => f.name).join(', ')}`;
}
