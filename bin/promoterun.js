#!/usr/bin/env node
/**
 * `beadcause-promoterun` — carry one promotion bead, by hand, against a real driver.
 *
 * bc-7qo.14. `lib/promoterun.js` landed `carry()` and `openPromotions()` under bc-y8k4.2,
 * and until this file the only caller anywhere in the repo was test/promoterun.mjs, against
 * a fake. This is the caller: the one-at-a-time, human-triggered shape the bead itself asks
 * for first, which suits a first production promotion far better than an unattended sweep
 * would.
 *
 *   beadcause-promoterun -w beadcause -b bc-9d37.10 --driver lib/singledriver.js
 *   beadcause-promoterun -w beadcause -b bc-9d37.10 --driver lib/singledriver.js --json
 *
 * ## Why `--driver` is a path and not a name
 *
 * `carry()` is written against a **driver interface** — four calls, `deployToUat`,
 * `testInUat`, `promoteToProd`, `testInProd`, or for a repo with one environment the two it
 * really has, `deploy` and `test` beside `environments: 1` — precisely so this file does not
 * need to know what a pipeline is. The repo ships one driver: **`lib/singledriver.js`**
 * (bc-y8k4.6), which runs the deploy a repo declares in `cfg.deploys` and the checks it
 * declares beside it, for beadcause, sorrel and anything else whose only deploy is
 * production. For anything else — UAT then production, through a pipeline beadcause knows
 * nothing about — `--driver pipeline` runs the hook the workspace's bead repo declares in
 * `.beadcause/pipeline.json` (lib/pipelinehook.js, bc-y8k4.3): an external program, one call
 * per step, JSON both ways. Which driver fits is a fact about the repo, not something this
 * file can see, so there is no default: `--driver` takes `pipeline` or a path to a module
 * that exports the calls (as its default export or as named exports), dynamically imported.
 *
 * ## What this does not do
 *
 * It does not sweep — the daemon does (bc-y8k4.8, lib/promotesweep.js), for a workspace whose
 * `autoShip` answer is yes and a repo that declares a driver under `promoteDrivers`. This is
 * still the way to carry a bead where either is missing, to carry one the sweep has given up on
 * (three recorded runs, none closed), and to carry a beadcause promotion from a shell that
 * outlives the deploy's restart.
 *
 * Exit codes: 1 usage, 2 the driver module would not load or is missing a call, 3 `carry`
 * refused before touching production (not a promotion bead, already closed, unendorsed, held
 * by somebody else, an epic or repo list that cannot be derived, a tracker that would not
 * answer), 4 it ran but did not close (still owed, cannot-say, or failed — see the printed
 * record for which), 0 every repo it names is promoted and verified.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { Bd } from '../lib/bd.js';
import { carry, record } from '../lib/promoterun.js';
import { PIPELINE, pipelineDriver } from '../lib/pipelinehook.js';

function arg(...names) {
  for (const n of names) {
    const i = process.argv.indexOf(n);
    if (i > -1) return process.argv[i + 1];
  }
  return undefined;
}
const has = (n) => process.argv.includes(n);
const warn = (msg) => console.error(`beadcause-promoterun: ${msg}`);

const cfg = loadConfig();
const wsName = arg('--workspace', '-w');
const bead = arg('--bead', '-b');
const driverArg = arg('--driver', '-d');
const json = has('--json');

const ws = cfg.workspaces.find((w) => w.name === wsName);
if (!ws || !bead || !driverArg || has('--help') || has('-h')) {
  console.error('usage: beadcause-promoterun -w <workspace> -b <promotion bead> --driver <path/to/driver.mjs> [--json]');
  console.error('  the driver module must export deployToUat, testInUat, promoteToProd and testInProd —');
  console.error('  or, for one environment, environments: 1 with deploy and test — as its default export');
  console.error('  or as named exports. lib/singledriver.js is the one-environment driver: it runs the');
  console.error('  deploy and the checks declared under deploys.<repo> in the config. `--driver pipeline`');
  console.error('  runs the hook the workspace\'s bead repo declares in .beadcause/pipeline.json');
  console.error('  (lib/pipelinehook.js) — an external program, one call per step, JSON both ways.');
  console.error(`workspaces: ${cfg.workspaces.map((w) => w.name).join(', ')}`);
  process.exit(1);
}

// Relative to where it was typed first, and to this checkout second — so the driver the repo
// ships is `--driver lib/singledriver.js` from anywhere, and a config naming it per repo
// (bc-y8k4.8) does not depend on the directory a sweep happens to run in.
let driver;
if (driverArg === PIPELINE) {
  // The workspace's own bead repo says what its pipeline is (bc-y8k4.3); beadcause does not.
  try {
    driver = pipelineDriver(ws);
  } catch (err) {
    warn(`no pipeline hook for ${ws.name} — ${err.message.split('\n')[0]}`);
    process.exit(2);
  }
} else {
  const here = path.resolve(process.cwd(), driverArg);
  const driverPath = fs.existsSync(here) ? here : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', driverArg);

  let driverMod;
  try {
    driverMod = await import(driverPath);
  } catch (err) {
    warn(`could not load driver ${driverArg} — ${err.message.split('\n')[0]}`);
    process.exit(2);
  }
  driver = driverMod.driver || driverMod.default || driverMod;
}

// The same three the daemon builds a `Bd` with, so a workspace on a Dolt server is reached
// the same way from this pipe as from the daemon itself. See bin/promotework.js.
const bd = new Bd({ bin: cfg.bdBin, actor: cfg.actor, sharedServer: cfg.sharedServer, me: cfg.me, accounts: cfg.accounts });

const run = await carry(bd, ws, bead, driver, { actor: cfg.actor });

if (run.refused) {
  warn(run.refused);
  process.exit(run.refused.startsWith('this driver cannot carry') ? 2 : 3);
}

if (json) {
  console.log(JSON.stringify(run, null, 2));
} else {
  console.log(record(run));
}
process.exit(run.closed ? 0 : 4);
