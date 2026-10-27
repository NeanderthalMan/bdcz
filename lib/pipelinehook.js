/**
 * The pipeline hook — a promotion driver that is somebody else's program.
 *
 * bc-y8k4.3. The bead asked for an Azure DevOps driver, and the survey on bc-u7syq found that
 * Northwind's pipeline is not the shape the bead assumed (ADO stops at staging; UAT and
 * production are prism-service blue/green releases). Adam's answer there: "the beadcause
 * pipeline harness should be agnostic of the company/organization/pipeline. just provide a hook
 * for invoking the external pipeline, then on northwind bead repo add one for configuring for
 * it". This is that hook. Nothing in this file knows what a pipeline, an image registry or an
 * approval gate is, and nothing anywhere in beadcause learns it from this file.
 *
 * ## Where it is declared
 *
 * By the **bead repo** — the checkout a workspace's `.beads` lives in, `path.dirname(ws.dir)` —
 * at `.beadcause/pipeline.json`, beside `views.json` and `derived.json` (lib/repoviews.js,
 * lib/derived.js): a fact about how a checkout's work is released belongs in the commit that
 * changes it, not in beadcause's config.
 *
 *     { "run": ["node", "tools/beadcause-pipeline.mjs"], "environments": 2, "timeoutMinutes": 90 }
 *
 * `run` is argv, never a shell string, resolved in the bead repo — the same rule as every other
 * `.beadcause/` file. `environments` is 2 (UAT, then production: `deployToUat`, `testInUat`,
 * `promoteToProd`, `testInProd`) or 1 (`deploy`, `test` — see lib/promoterun.js SINGLE_STEPS).
 * `timeoutMinutes` bounds one call; a UAT deploy that waits on a pipeline can be long.
 *
 * ## The protocol — one call per step, JSON both ways
 *
 * The hook is run once per step as `run... <call>` (e.g. `node tools/x.mjs deployToUat`), with
 * one JSON object on stdin:
 *
 *     { "call", "bead", "epic", "workspace", "repo", "image", "work": ["<bead id>", ...] }
 *
 * `image` is empty on the first deploy and is what that deploy named on every later step — so
 * `promoteToProd` is *handed* the image UAT tested. It answers with one JSON object on stdout
 * (the last line that parses, so a hook may log above it):
 *
 *     { "state": "passed" | "failed" | "unknown", "image": "...", "detail": "...",
 *       "checks": [{ "name": "...", "state": "...", "detail": "..." }] }
 *
 * which is exactly what an in-process driver returns, read by the same `readStep` — so a test
 * step with no checks, a deploy that names no image and a promote that comes back with a
 * different image are refused here for the same reasons they are refused for any driver.
 *
 * ## Cannot-say, never invented
 *
 * A hook that cannot be run, runs past its timeout, or exits without a JSON answer has told
 * nobody anything: every one of those is `unknown`, never `failed`. A non-zero exit *with* a
 * JSON answer is that answer — a hook is allowed to say `failed` and exit 1. A zero exit whose
 * answer says `failed` is failed; the exit code is not the verdict, the answer is.
 *
 * What the hook does — whether it deploys, only asks a human to, or requests an approval gate
 * and reports `unknown` until somebody grants it — is the hook's business and its repo's.
 * beadcause's promise is only the one lib/promoterun.js already keeps: nothing closes over a
 * step that did not say `passed` with its evidence attached.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PASSED, FAILED, UNKNOWN, STEPS, SINGLE_STEPS } from './promoterun.js';

/** The name `promoteDrivers` (and `beadcause-promoterun --driver`) gives this driver. */
export const PIPELINE = 'pipeline';

/** Where a bead repo declares its hook, relative to that repo. */
export const HOOK_FILE = path.join('.beadcause', 'pipeline.json');

const DEFAULT_TIMEOUT_MIN = 60;
const MAX_OUTPUT = 1 << 20;

const first = (err) => String(err?.message || err || '').split('\n')[0];
const text = (v) => String(v ?? '').trim();

/** The bead repo a workspace's tracker lives in — where its `.beadcause/` is. */
export const beadRepoOf = (ws) => (ws?.dir ? path.dirname(path.resolve(ws.dir)) : '');

/**
 * Read and validate a bead repo's hook declaration. Never throws: `{ hook }` or `{ why }`,
 * and a missing file is a `why` with `missing: true`, so a caller can tell "nothing declared"
 * from "declared wrong".
 */
export function readHook(repoDir, { readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  if (!repoDir) return { why: 'the workspace has no directory, so there is no bead repo to read a hook from', missing: true };
  const file = path.join(repoDir, HOOK_FILE);
  let raw;
  try {
    raw = readFile(file);
  } catch (err) {
    if (err?.code === 'ENOENT') return { why: `\`${file}\` does not exist — nothing declares a pipeline hook here`, missing: true };
    return { why: `\`${file}\` could not be read — ${first(err)}` };
  }
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (err) {
    return { why: `\`${file}\` is not JSON — ${first(err)}` };
  }
  const run = Array.isArray(spec?.run) ? spec.run.map(text) : [];
  if (!run.length || run.some((a) => !a)) return { why: `\`${file}\` has no \`run\` — it must be an argv array of non-empty strings` };
  const environments = spec.environments === undefined ? 2 : Number(spec.environments);
  if (environments !== 1 && environments !== 2) return { why: `\`${file}\` says \`environments: ${spec.environments}\` — it must be 1 or 2` };
  const minutes = spec.timeoutMinutes === undefined ? DEFAULT_TIMEOUT_MIN : Number(spec.timeoutMinutes);
  if (!(minutes > 0)) return { why: `\`${file}\` says \`timeoutMinutes: ${spec.timeoutMinutes}\` — it must be a positive number` };
  return { hook: { run, environments, timeoutMs: minutes * 60000, dir: repoDir, file } };
}

/**
 * Run the hook once. Never throws: `{ code, stdout, stderr, error }` — `code` null when the
 * process never got to answer (not found, killed by the timeout).
 */
export function runHook(argv, { cwd, input, timeoutMs }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    let timedOut = false;
    const finish = (out) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ...out });
    };
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: null, stdout, stderr, error: first(err) });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    child.stdout.on('data', (d) => { if (stdout.length < MAX_OUTPUT) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < MAX_OUTPUT) stderr += d; });
    child.on('error', (err) => finish({ code: null, error: first(err) }));
    child.on('close', (code) => {
      if (timedOut) return finish({ code: null, error: `timed out after ${Math.round(timeoutMs / 1000)}s` });
      finish({ code: typeof code === 'number' ? code : null, error: typeof code === 'number' ? null : 'killed by a signal' });
    });
    // A hook that exits without reading stdin must not take this process down with EPIPE.
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

/** The hook's answer: the last stdout line that parses as a JSON object, or null. */
export function answerOf(stdout) {
  const lines = String(stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try {
      const v = JSON.parse(lines[i]);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      // Not the answer; a log line that happens to start with a brace.
    }
  }
  return null;
}

const tail = (s) => text(s).split('\n').filter(Boolean).pop() || '';

/**
 * A driver over a declared hook. `exec` is injectable so a suite drives it with no process.
 * Exports the calls its `environments` says, and `environments` itself, so lib/promoterun.js
 * records the steps that really happened.
 */
export function hookDriver(hook, { exec = runHook } = {}) {
  const steps = hook.environments === 1 ? SINGLE_STEPS : STEPS;
  const call = (name) => async (ctx = {}) => {
    const input = {
      call: name,
      bead: ctx.bead || '',
      epic: ctx.epic || '',
      workspace: ctx.workspace || '',
      repo: ctx.repo || '',
      image: ctx.image || '',
      work: (ctx.work || []).map((w) => (typeof w === 'string' ? w : w?.id)).filter(Boolean),
    };
    const got = await exec([...hook.run, name], { cwd: hook.dir, input, timeoutMs: hook.timeoutMs });
    const said = `\`${hook.run.join(' ')} ${name}\``;
    if (got.code === null) {
      return { state: UNKNOWN, detail: `${said} never answered — ${got.error || 'no reason'}` };
    }
    const answer = answerOf(got.stdout);
    if (!answer) {
      const why = tail(got.stderr) || tail(got.stdout);
      return { state: UNKNOWN, detail: `${said} exited ${got.code} with no JSON answer${why ? ` — ${why.slice(0, 200)}` : ''}` };
    }
    // The answer is the verdict, whatever the exit code; a hook may say failed and exit 1.
    // An exit 0 over an answer with no recognisable state is left to readStep, which reads
    // a missing state as unknown.
    if (got.code !== 0 && ![PASSED, FAILED, UNKNOWN].includes(text(answer.state).toLowerCase())) {
      return { ...answer, state: UNKNOWN, detail: [text(answer.detail), `exited ${got.code}`].filter(Boolean).join(' — ') };
    }
    return answer;
  };
  const driver = { environments: hook.environments, hook: hook.file };
  for (const s of steps) driver[s.call] = call(s.call);
  return driver;
}

/** Load the hook a workspace's bead repo declares, as a driver — or throw why not. */
export function pipelineDriver(ws, { read = readHook, exec } = {}) {
  const found = read(beadRepoOf(ws));
  if (found.why) throw Object.assign(new Error(found.why), { missing: !!found.missing });
  return hookDriver(found.hook, { exec });
}
