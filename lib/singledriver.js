/**
 * The single-environment promotion driver — the deploy a repo already declares, carried once.
 *
 * bc-y8k4.6. `carry()` in lib/promoterun.js was code-complete and could carry nothing, because
 * `beadcause-promoterun` refuses without `--driver` and no driver existed. This is the first,
 * for the repos that have one environment: beadcause restarts under launchd, sorrel runs
 * `fly deploy`, and in both the thing that deploys *is* production. There is no UAT to deploy
 * to and no separate promote, so this driver says `environments: 1` and exports the two calls
 * that are real — `deploy` and `test` — and lib/promoterun.js records exactly those two steps,
 * both in production, under names that say there was nothing else. Why the collapse lives in
 * the lib and not here is on bc-y8k4.6: the step labels on the record are the lib's, and a
 * four-call driver for one environment can only print "UAT deploy — passed" over a production
 * deploy, then either repeat the same checks as a second production verification that never
 * separately happened or leave the bead cannot-say forever.
 *
 *   beadcause-promoterun -w beadcause -b <promotion bead> --driver lib/singledriver.js
 *
 * ## The deploy is lib/deploy.js's, never this file's
 *
 * `deploy` looks the repo up in `cfg.deploys` through `deployFor` and runs it through
 * `startDeploy` — the same declaration, the same runner, the same durable record the Ship
 * button and the release queue use. Nothing here names `launchctl` or `fly`; a repo with no
 * declaration is a thrown refusal, which `carry()` reads as cannot-say, because nothing was
 * deployed and "failed" would be as much an invention as "passed".
 *
 * **It waits on the record on disk, not on the child.** `startDeploy` spawns a detached runner
 * and returns at once, because a `launchctl kickstart -k` of beadcause SIGKILLs the process
 * that asked for it. So this polls `showDeploy(id)` until the record leaves the four live
 * states, and reads the outcome off it: `ok` is passed, `failed` is failed, and `unconfirmed`,
 * `lost` or a record still live at the deadline are cannot-say — lib/deploy.js's own rule that
 * silence is never success, carried through unchanged.
 *
 * One consequence to know before running this from anywhere but a terminal: a beadcause
 * deploy restarts the daemon, and a caller *inside* the daemon dies with it. From
 * `beadcause-promoterun` in a shell the runner is not in the LaunchAgent's job and survives to
 * write `ok`; an unattended sweep in the daemon (bc-y8k4.8) would not, and has to hand the
 * wait to something that outlives the restart.
 *
 * **The image is the commit.** A git deploy has no digest; what it deployed is the commit the
 * runner fast-forwarded the checkout to — the record's `to`. A deploy that settled `ok` with
 * no `to` (a repo declared `pull: false`) names no image, and `readStep` makes that cannot-say
 * rather than let a promotion close over something it cannot name.
 *
 * ## The checks are declared too
 *
 * `test` runs `cfg.deploys[<key>].checks` — argv, like `command`, with `{image}` expanded to
 * the commit just deployed — in the checkout, one at a time, each named on the record. Exit 0
 * is passed, any other exit is failed, and a check that could not be run at all (not found,
 * timed out) is cannot-say. A repo that declares **no** checks gets a test step that says so
 * and is cannot-say: a deploy that went green says nothing about whether this release is the
 * one running, which is bc-y8k4's whole argument, and this driver will not make it on a repo's
 * behalf.
 *
 * Everything that touches the world is injectable (`start`, `show`, `exec`, `sleep`, `now`,
 * `cfg`), so test/singledriver.mjs drives the whole thing against a fake declaration with no
 * network, no runner and no restart.
 */

import { execFile } from 'node:child_process';
import { loadConfig } from './config.js';
import { deployFor, inFlight, showDeploy, startDeploy } from './deploy.js';
import { FAILED, PASSED, UNKNOWN } from './promoterun.js';

const first = (err) => String(err?.message || err || '').split('\n')[0];
const tail = (out) => String(out || '').trim().split('\n').filter(Boolean).pop() || '';

/** How often the record is re-read while a deploy is in flight. */
const POLL_MS = 2000;

/**
 * How much longer than the runner's own step timeout the wait lasts before giving up.
 *
 * The runner times out each step itself and writes `failed`, so the deadline here is only
 * for a runner that never writes again — killed, or never started — and is past the point
 * where the runner would have said something if it could.
 */
const SLACK_MS = 120000;

/**
 * Which `cfg.deploys` key a promotion bead's repo is declared under — or null.
 *
 * The Repos line on a promotion bead names the repo as the plan did: the bare name. For a
 * workspace that is one repo that *is* the key; for a multi-repo workspace lib/repos.js keys
 * it `<workspace>/<repo>`. Both are tried, the bare name first, and a declaration that
 * `deployFor` refuses outright (a broken one) is a throw — surfaced, never skipped past.
 */
export function deployKey(cfg, { repo = '', workspace = '' } = {}) {
  const tried = [repo, workspace && repo && !repo.includes('/') ? `${workspace}/${repo}` : ''].filter(Boolean);
  let problem = null;
  for (const key of [...new Set(tried)]) {
    try {
      if (deployFor(cfg, key)) return key;
    } catch (err) {
      problem = problem || err;
    }
  }
  if (problem) throw problem;
  return null;
}

/** Run one declared check. Never throws: `{ code, output, error }`. */
export function runCheck(command, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    execFile(command[0], command.slice(1), { cwd, timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const output = `${stdout || ''}${stderr || ''}`;
      if (!err) return resolve({ code: 0, output, error: null });
      // A number is the check's own answer. Anything else — not found, killed by the
      // timeout — is a check that never got to answer.
      if (typeof err.code === 'number' && !err.killed) return resolve({ code: err.code, output, error: null });
      resolve({ code: null, output, error: err.killed ? `timed out after ${timeoutMs}ms` : first(err) });
    });
  });
}

/**
 * A driver over `cfg.deploys`, with every side effect injectable.
 *
 * `cfg` may be a value or omitted; omitted, it is read on the first call rather than at
 * construction, so importing this module never reads anybody's config.
 */
export function singleDriver({
  cfg = null,
  start = startDeploy,
  show = showDeploy,
  exec = runCheck,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  pollMs = POLL_MS,
} = {}) {
  let loaded = cfg;
  const config = () => (loaded ||= loadConfig());

  const planOf = (ctx) => {
    const c = config();
    const key = deployKey(c, ctx);
    if (!key) throw new Error(`no deploy is declared for \`${ctx.repo}\` — add one under \`deploys\` in the config, and nothing here will guess at it`);
    return { key, plan: deployFor(c, key) };
  };

  async function deploy(ctx) {
    const { key, plan } = planOf(ctx);
    const rec = start(config(), key, { bead: ctx.bead || null, reason: `promotion ${ctx.bead || ''} of ${ctx.epic || ''}`.trim() });
    const deadline = now() + plan.graceMs + plan.timeoutMs * (1 + plan.rebuild.length + 1) + SLACK_MS;

    let seen = rec;
    for (;;) {
      const read = show(rec.id);
      if (read) seen = read;
      if (read && !inFlight(read)) break;
      if (now() >= deadline) {
        return { state: UNKNOWN, detail: `deploy ${rec.id} was still \`${seen.status}\` when the wait ran out, so whether it landed is unknown` };
      }
      await sleep(pollMs);
    }

    const where = `deploy ${seen.id} of \`${key}\``;
    if (seen.status === 'ok') {
      const moved = seen.from && seen.to && seen.from !== seen.to ? ` (${seen.from.slice(0, 8)} → ${seen.to.slice(0, 8)})` : seen.to ? ' (already at that commit)' : '';
      return { state: PASSED, image: seen.to || '', detail: `${where} ran \`${plan.command[0]}\`${moved}` };
    }
    if (seen.status === 'failed') return { state: FAILED, detail: `${where} failed — ${first(seen.error) || 'no reason recorded'}` };
    // `unconfirmed`, `lost`, and anything this file does not know: nobody can say.
    return { state: UNKNOWN, detail: `${where} ended \`${seen.status}\`${seen.error ? ` — ${first(seen.error)}` : ''}` };
  }

  async function test(ctx) {
    const { key, plan } = planOf(ctx);
    if (!plan.checks.length) {
      return {
        state: UNKNOWN,
        detail: `\`deploys["${key}"].checks\` declares nothing, so nothing was run against production — a green deploy alone does not show this release is the one running`,
      };
    }
    const checks = [];
    for (const c of plan.checks) {
      const command = c.command.map((a) => a.replaceAll('{image}', ctx.image || ''));
      const got = await exec(command, { cwd: plan.dir, timeoutMs: c.timeoutMs });
      if (got.code === 0) checks.push({ name: c.label, state: PASSED, detail: '' });
      else if (got.code === null) checks.push({ name: c.label, state: UNKNOWN, detail: got.error || 'could not be run' });
      else checks.push({ name: c.label, state: FAILED, detail: `exit ${got.code}${tail(got.output) ? ` — ${tail(got.output).slice(0, 200)}` : ''}` });
    }
    // The summary is the checks' own, and `readStep` would overrule a kinder one anyway.
    const state = checks.some((c) => c.state === FAILED) ? FAILED : checks.every((c) => c.state === PASSED) ? PASSED : UNKNOWN;
    return { state, checks, detail: `against \`${ctx.image || 'no image'}\` in \`${key}\`` };
  }

  return { environments: 1, deploy, test };
}

/**
 * The driver `beadcause-promoterun --driver lib/singledriver.js` loads — and the shape a
 * config path can name (bc-y8k4.8). Built on first use, so importing it reads no config.
 */
let lazy = null;
const real = () => (lazy ||= singleDriver());
export default {
  environments: 1,
  deploy: (ctx) => real().deploy(ctx),
  test: (ctx) => real().test(ctx),
};
