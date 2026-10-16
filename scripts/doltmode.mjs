#!/usr/bin/env node
/**
 * Put the workspaces that need one on a per-project Dolt server.
 *
 *     npm run dolt-mode                  # do it
 *     npm run dolt-mode -- --dry-run     # print the plan and change nothing
 *     npm run dolt-mode -- --all         # every workspace, ignoring the policy
 *     npm run dolt-mode -- --revert <ws> # put one back on the embedded engine
 *
 * Run for you by `npm run install-service`, after the questions — it reads
 * `advocates.workspaces`, so it has to come after the answer that sets it.
 *
 * Re-runnable and boring on a machine that is already set up: a workspace already in
 * server mode is one line of output and no writes. Everything it will and will not touch
 * is argued in lib/doltmode.js; this file is the part that prints.
 *
 * Exit 1 means something was refused and needs a person. Exit 2 means a step failed —
 * including the rollback case, where a flip made a tracker read as empty and was undone.
 * Both leave a machine that works; neither is a reason to stop an install, so install.sh
 * warns and carries on.
 */
import { loadConfig } from '../lib/config.js';
import { discoverWorkspaces } from '../lib/workspaceroots.js';
import {
  applyPlan,
  doltServerPolicy,
  planDoltModes,
  revertToEmbedded,
} from '../lib/doltmode.js';

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const say = (s) => console.log(`${bold('==>')} ${s}`);
const warn = (s) => console.error(`\x1b[33m warn\x1b[0m ${s}`);
const no = (s) => console.error(`\x1b[31mrefused\x1b[0m ${s}`);

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(`Put the workspaces that need one on a per-project Dolt server.

  npm run dolt-mode                  apply the doltServer policy
  npm run dolt-mode -- <ws> [<ws>…]  only these workspaces, and serve them whatever
                                     the policy says about the rest
  npm run dolt-mode -- --dry-run     print the plan and change nothing
  npm run dolt-mode -- --all         every workspace, whatever the policy says
  npm run dolt-mode -- --force       also change a tracker whose metadata.json is in git
  npm run dolt-mode -- --revert <ws> stop that workspace's server and go back to embedded

The policy lives in ~/.config/beadcause/config.json as "doltServer": one of
"advocated" (the default), "all" or "off".`);
  process.exit(0);
}

const dryRun = argv.includes('--dry-run') || argv.includes('-n');
const force = argv.includes('--force');
const everything = argv.includes('--all');
const revertAt = argv.indexOf('--revert');
const revertName = revertAt === -1 ? null : argv[revertAt + 1];

/**
 * Named workspaces, the apply-side twin of `--revert <ws>`.
 *
 * Naming one means "serve this one", not "apply the policy and filter it down" — the
 * whole reason to type a name is that the policy does not already cover it, or that
 * today is not the day to touch the other four. The refusals still apply: a named
 * workspace whose metadata is committed is still refused, because `--force` is the
 * answer to that question and naming a workspace is not.
 *
 * `--revert`'s value is skipped rather than parsed twice — `-- --revert loremia` names
 * no workspace to serve. The guard on `revertAt` being -1 is not decoration: without it
 * `revertAt + 1` is 0, and the first workspace anybody named was silently dropped.
 */
const named = argv.filter((a, i) => !a.startsWith('-') && !(revertAt !== -1 && i === revertAt + 1));

const cfg = loadConfig();
const workspaces = discoverWorkspaces(cfg);

/* ------------------------------------------------------------------ --revert */

if (revertAt !== -1) {
  if (!revertName) {
    no('--revert needs the name of a workspace.');
    process.exit(1);
  }
  const ws = workspaces.find((w) => w.name === revertName);
  if (!ws) {
    no(`no workspace called "${revertName}" — this install serves ${workspaces.map((w) => w.name).join(', ') || 'none'}.`);
    process.exit(1);
  }
  if (dryRun) {
    say(`would stop ${revertName}'s Dolt server and put its metadata back to embedded.`);
    process.exit(0);
  }
  const problem = revertToEmbedded(ws.dir, { name: ws.name });
  if (problem) {
    warn(problem);
    process.exit(2);
  }
  say(`${revertName} is back on the embedded engine.`);
  process.exit(0);
}

/* ------------------------------------------------------------------- the plan */

// A name that matches nothing is a refusal rather than a quiet no-op: "I typed the
// workspace and it said nothing changed" is indistinguishable from a typo.
const unknown = named.filter((n) => !workspaces.some((w) => w.name === n));
if (unknown.length) {
  no(`no workspace called ${unknown.map((n) => `"${n}"`).join(', ')} — this install serves ${workspaces.map((w) => w.name).join(', ') || 'none'}.`);
  process.exit(1);
}

const policy = named.length || everything ? 'all' : doltServerPolicy(cfg);
const subjects = named.length ? workspaces.filter((w) => named.includes(w.name)) : workspaces;
say(
  named.length
    ? `${bold('Dolt engine')} ${dim(`(${named.join(', ')} — named, so the policy does not apply)`)}`
    : `${bold('Dolt engine')} ${dim(`(doltServer: "${policy}")`)}`
);

if (policy === 'off' && !everything) {
  console.log(dim('  left alone — no workspace\'s mode is managed by this install.'));
  process.exit(0);
}
if (!subjects.length) {
  console.log(dim('  no workspaces found, so there is nothing to put on a server.'));
  process.exit(0);
}

const plans = planDoltModes({ ...cfg, doltServer: policy }, subjects, { force });

let refused = 0;
let failed = 0;
let changed = 0;

for (const plan of plans) {
  if (plan.refusal) {
    refused += 1;
    no(plan.refusal);
    continue;
  }
  if (plan.action === 'none') {
    console.log(dim(`  ${plan.name.padEnd(20)} ${plan.what}`));
    continue;
  }
  console.log(`  ${plan.name.padEnd(20)} ${dryRun ? dim('would: ') : ''}${plan.what}`);
  if (dryRun) continue;

  const problem = applyPlan(plan);
  if (problem) {
    failed += 1;
    warn(problem);
    continue;
  }
  changed += 1;
}

/* ------------------------------------------------------------------ the tally */

if (dryRun) {
  console.log(dim(`\n  ${plans.filter((p) => p.action !== 'none' && !p.refusal).length} would change. Nothing was written.`));
  process.exit(0);
}

if (changed) {
  console.log(
    dim(
      `\n  ${changed} workspace(s) moved to a per-project server. bd starts each one on its\n` +
        `  first call, so nothing is running yet for a tracker nobody is reading — and\n` +
        `  \`npm run dolt-mode -- --revert <ws>\` is the way back.`
    )
  );
}
if (refused) warn(`${refused} workspace(s) were left exactly as they were — see above.`);
if (failed) warn(`${failed} workspace(s) did not change; re-running is safe.`);

process.exit(refused ? 1 : failed ? 2 : 0);
