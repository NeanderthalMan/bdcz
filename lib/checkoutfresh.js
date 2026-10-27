/**
 * Keeping every configured repo's *main checkout* current — the half of bc-xl7n.177
 * that is genuinely beadcause's to fix, not a delmar one.
 *
 * `check_ask_reachable.py` (a delmar gate) and `/api/asset` (`lib/server.js`) both
 * resolve a card's declared `docs:`/`images:` path against a repo's main checkout on
 * disk, and nothing had ever refreshed that checkout except a *deploy*'s own pull
 * (`lib/deploy.js`, `scripts/deploy-runner.mjs`) — which exists only for the handful of
 * repos that declare `cfg.deploys[<name>]`. Every other workspace's checkout is
 * whatever it was the day somebody last `git pull`ed it by hand: on 2026-09-26 the
 * delmar checkout was measured ~11 days and ~118 PRs behind `origin/main`, and a file
 * merged in that gap is unreachable from a card — not until the next merge, but
 * indefinitely — even though every property `check_ask_reachable.py` checks (absolute
 * path, under an assetRoot, servable extension) passes: the path is *correct*, the file
 * just is not there yet.
 *
 * **This is deliberately generic — no delmar in it anywhere.** A workspace with a
 * `deploys` entry is *skipped*, not doubly-freshened: that repo's checkout is already
 * kept current by its own deploy pull, on its own clock, and beadcause's own checkout
 * is exactly such a repo — a periodic fast-forward running *underneath* its own live
 * process, out of step with a build or a restart, is precisely the half-applied state a
 * deploy's atomic pull+rebuild+restart exists to avoid. Everything without a declared
 * deploy — delmar among them, and every future repo like it — gets swept the same way.
 *
 * **Fast-forward only, and only of a clean tree already on trunk**, the same rule
 * `scripts/deploy-runner.mjs` already enforces for a deploy's own pull: several
 * sessions may have this checkout open in an editor, and a sweep that rewrote history
 * under one would be a much worse failure than the staleness it exists to fix. Off
 * trunk, dirty, no `origin`, or a merge that cannot fast-forward are all `skipped`, not
 * errors — the checkout is left exactly as it was and the next tick tries again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { currentBranch, trunkBranch } from './reachable.js';
import { resolveSessionDir } from './session.js';

function git(dir, args, { timeoutMs = 30000 } = {}) {
  try {
    return { ok: true, out: execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs }).trim() };
  } catch (err) {
    // `err.stderr` is a Buffer|string set by execFileSync on a non-zero exit or a kill;
    // absent entirely for a spawn failure (bad binary), where `err.message` is the story.
    const stderr = err?.stderr ? String(err.stderr).trim() : '';
    return { ok: false, out: '', error: stderr || err.message };
  }
}

/**
 * Fast-forward one checkout to its trunk, if — and only if — doing so is unambiguously
 * safe. Never throws; every outcome is `{ skipped: true, reason }` or
 * `{ skipped: false, branch, from, to, changed }`.
 */
export function freshenCheckout(dir, opts = {}) {
  if (!dir || !fs.existsSync(path.join(dir, '.git'))) {
    return { skipped: true, reason: `${dir} is not a git checkout` };
  }

  const branch = currentBranch(dir);
  if (!branch) return { skipped: true, reason: `${dir}: could not read the checked-out branch` };
  const trunk = trunkBranch(dir);
  if (!trunk) return { skipped: true, reason: `${dir}: could not tell this checkout's trunk branch` };
  if (branch !== trunk) {
    return { skipped: true, reason: `${dir} is on \`${branch}\`, not \`${trunk}\` — leaving it alone` };
  }

  const dirty = git(dir, ['status', '--porcelain', '--untracked-files=no'], opts);
  if (!dirty.ok) return { skipped: true, reason: `${dir}: could not read its working tree state — ${dirty.error}` };
  if (dirty.out) return { skipped: true, reason: `${dir} has uncommitted work on \`${trunk}\` — leaving it alone` };

  const before = git(dir, ['rev-parse', 'HEAD'], opts);
  if (!before.ok) return { skipped: true, reason: `${dir}: could not read HEAD — ${before.error}` };

  const fetched = git(dir, ['fetch', '--quiet', 'origin', trunk], opts);
  if (!fetched.ok) return { skipped: true, reason: `${dir}: could not fetch origin/${trunk} — ${fetched.error}` };

  const merged = git(dir, ['merge', '--ff-only', `origin/${trunk}`], opts);
  if (!merged.ok) return { skipped: true, reason: `${dir}: origin/${trunk} could not fast-forward — ${merged.error}` };

  const after = git(dir, ['rev-parse', 'HEAD'], opts);
  const from = before.out;
  const to = after.ok ? after.out : from;
  return { skipped: false, branch: trunk, from, to, changed: from !== to };
}

/**
 * Whether `workspace` already has its checkout kept current some other way, and so is
 * deliberately left out of this sweep.
 *
 * A **plain** deploy key (`cfg.deploys[<name>]`) is the only shape checked, on purpose:
 * a multi-repo workspace's per-repo key (`<workspace>/<repo>`, see `lib/repos.js`) is
 * for a *service* checkout this sweep never resolves to anyway (`resolveSessionDir`
 * with no bead answers the workspace's *default* repo), so there is nothing here for
 * that key to exclude.
 */
export function hasOwnDeploy(cfg, name) {
  return Boolean(cfg?.deploys?.[name]);
}

/**
 * Every configured workspace's main checkout, fast-forwarded where it is safe to.
 *
 * One entry per workspace in the result, always — `skipped` (with why) or the fresh
 * state — so a caller logging this can say what happened to every one of them, not
 * only the ones that moved. A resolution failure (`resolveSessionDir` throws for a
 * workspace with no directory beadcause can map back to it) is caught per workspace,
 * the same way `deployable` in `lib/deploy.js` catches a broken declaration: the other
 * thirty-nine workspaces' sweeps are unaffected by one's misconfiguration.
 *
 * Two workspaces that resolve to the *same* checkout — a multi-repo workspace and its
 * own default repo named separately, say — are only ever fast-forwarded once per call;
 * the second is reported `skipped` rather than run again.
 */
export function freshenAllCheckouts(cfg, workspaces = cfg?.workspaces || [], opts = {}) {
  const seen = new Set();
  const results = [];
  for (const ws of workspaces || []) {
    const name = ws?.name || '';
    if (hasOwnDeploy(cfg, name)) {
      results.push({ workspace: name, skipped: true, reason: 'has its own deploy pull — left to that' });
      continue;
    }
    let dir;
    try {
      dir = resolveSessionDir(cfg, ws);
    } catch (err) {
      results.push({ workspace: name, skipped: true, reason: `could not resolve a checkout — ${err.message}` });
      continue;
    }
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) {
      results.push({ workspace: name, dir: resolved, skipped: true, reason: 'same checkout as another workspace already swept this tick' });
      continue;
    }
    seen.add(resolved);
    results.push({ workspace: name, dir: resolved, ...freshenCheckout(resolved, opts) });
  }
  return results;
}

/**
 * How often the sweep runs, in ms — the same shape as `jiraEveryMs`. Fifteen minutes
 * by default: a `git fetch` per eligible workspace is cheap but not free, and nothing
 * about a phone card needs its target file to appear within seconds of the merge that
 * created it. Floor of one minute so a test, or a config typo, cannot busy-loop `git`
 * across every workspace.
 */
export const checkoutRefreshEveryMs = (cfg) => Math.max(1, Number(cfg?.checkoutRefreshMinutes) || 15) * 60 * 1000;
