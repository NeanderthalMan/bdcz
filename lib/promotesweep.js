/**
 * The daemon carries an endorsed promotion bead by itself — one at a time, with the driver its
 * repo declared, and only where the space has said yes to unattended deploys.
 *
 * bc-y8k4.8. `openPromotions()` and `carry()` (lib/promoterun.js) were code-complete and had one
 * caller, `bin/promoterun.js`, which a person runs by hand with `--driver <path>`. Its header
 * said where the sweep goes and why it was not there yet: "seed in lib/server.js's `cycle()`,
 * beside `sweepRelease`, gated the same two ways — the endorsement hold `carry()` already
 * refuses without, and the per-space `autoShip` switch" — and it waited for a real driver.
 * lib/singledriver.js (bc-y8k4.6) is one, so this is the sweep. Everything that touches the world
 * is injected (`bd`, `cfg`, the driver loader, the deploy journal, the clock), so a suite drives
 * the whole thing with no tracker, no daemon and no network; lib/server.js only calls
 * `sweep()` from the cycle.
 *
 * ## The gates, in the order they are said out loud
 *
 * A bead that is not carried is **never silent about why**. Each reason below is logged once
 * per change, not once per sweep, because the same bead is looked at every five minutes and a
 * line that repeats is a line nobody reads.
 *
 * 1. **Endorsed** — `openPromotions` already refuses an `unendorsed` one, and `carry()`
 *    refuses it again. A `human` bead is a question waiting on a person and is left to them.
 * 2. **`autoShip` for the workspace** (`autoShipAllowed`, lib/spaces.js). A space that has not
 *    said yes to unattended deploys gets nothing carried unattended; the bead waits for
 *    `beadcause-promoterun` by hand.
 * 3. **A declared driver, per repo** — `cfg.promoteDrivers[<repo key>]`, never inferred. A
 *    repo that declares none is skipped and named. A bead spanning repos that declare
 *    *different* drivers is skipped too: `carry()` takes one driver, and whether it is a
 *    single-environment one is a property of that driver (`isSingle`), so two of them cannot
 *    be honestly mixed on one record.
 * 4. **Ready** — an `open` promotion bead that `bd ready` does not list is blocked by a
 *    dependency or a far-tracker marker, and carrying it would step over the edge that
 *    says not yet.
 * 5. **Nothing else deploying that repo**, and the deploy journal carrying no live record for
 *    this bead.
 * 6. **A run budget** — `MAX_RUNS` recorded runs and `COOLDOWN_MS` between them, read off the
 *    bead's own run comments (`parseRun`). A production deploy that fails is not retried every
 *    five minutes by a daemon nobody is watching.
 *
 * ## Never concurrent with itself, and the record is the truth
 *
 * `carry()` refuses a bead held by somebody *else* and lets its own actor straight through,
 * and the daemon's actor is the same one `bin/promoterun.js` uses. So the lease is read here
 * rather than trusted there: a bead already on the sweep's own actor is a carry that may be
 * running, and it is left alone until the claim is **stale** — older than `LEASE_MS`, or older
 * than this process, which is the case that matters. A beadcause deploy `restarts` the daemon
 * (lib/deploy.js): the carry dies mid-deploy, and the bead is left `in_progress` on the actor
 * with nothing in this new process holding it. The in-memory slot answers "is a carry running
 * *in this process*" and nothing more; everything that has to survive a restart is on disk.
 *
 * **A recovered carry does not deploy again.** The deploy journal already says what the dead
 * carry started, and deploying a second time is what would make a self-deploying promotion
 * loop for ever. So a resumed carry is handed `resuming(...)`: its `deploy` call adopts the
 * newest journal record for the bead that postdates the bead's last run comment — `ok` is
 * passed, `failed` is failed, and `unconfirmed` is passed **only** for a deploy that
 * `restarts` this daemon and only when this process started after it asked, because that is
 * what an `unconfirmed` restart deploy looks like from the far side and this process being up
 * is the whole of the evidence there is (lib/deploy.js `restartingDeploy` makes the same
 * reading). Anything else is cannot-say, which neither closes nor promotes. The `test` step
 * still runs, so a promotion is closed on its checks and never on the adoption.
 */

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { autoShipAllowed } from './spaces.js';
import { inFlight, keyOf, listDeploys } from './deploy.js';
import { singleDriver } from './singledriver.js';
import { describeLease, isLive, leasesOf } from './lease.js';
import { carry, isSingle, openPromotions, parseRun, reposOf, FAILED, PASSED, UNKNOWN } from './promoterun.js';

/** How old a claim by the sweep's own actor may be before it is read as a dead carry. */
export const LEASE_MS = 30 * 60 * 1000;
/** The gap between two runs of one bead — a failed production deploy is not retried at once. */
export const COOLDOWN_MS = 30 * 60 * 1000;
/** Recorded runs after which the bead is left to a person. */
export const MAX_RUNS = 3;
/** The name `promoteDrivers` may give instead of a path: lib/singledriver.js, built on the live config. */
export const SINGLE = 'single';

const text = (v) => String(v ?? '').trim();
const first = (err) => String(err?.message || err || '').split('\n')[0];
const labelsOf = (row) => (row?.labels || []).map((l) => text(l));
const minutes = (ms) => `${Math.max(1, Math.round(ms / 60000))} minute${Math.round(ms / 60000) === 1 ? '' : 's'}`;

/**
 * Which driver a promotion bead's repos declare — `{ spec }`, or `{ why }` when nothing may
 * be guessed. A repo is looked up by its bare name and then as `<workspace>/<repo>`, the two
 * spellings lib/deploy.js keys a repo under.
 */
export function driverSpecFor(cfg, workspaceName, row) {
  const repos = reposOf(row);
  if (!repos.length) return { why: 'it names no repo, so there is no driver to look up' };
  const declared = cfg?.promoteDrivers && typeof cfg.promoteDrivers === 'object' ? cfg.promoteDrivers : {};
  const specs = new Map();
  for (const repo of repos) {
    // A name is a string. Anything else in the file is a hand-edit gone wrong, not a driver.
    const spec = [repo, `${workspaceName}/${repo}`].map((k) => (typeof declared[k] === 'string' ? text(declared[k]) : '')).find(Boolean);
    if (!spec) return { why: `no driver is declared for \`${repo}\` — add one under \`promoteDrivers\` in the config, and nothing here will guess at it` };
    specs.set(repo, spec);
  }
  const distinct = [...new Set(specs.values())];
  if (distinct.length > 1) {
    return { why: `its repos declare different drivers (${[...specs].map(([r, s]) => `\`${r}\` ${s}`).join(', ')}), and one bead is carried with one` };
  }
  return { spec: distinct[0] };
}

/**
 * Load a driver by the name a config gave. `single` is lib/singledriver.js built on the
 * daemon's own config; anything else is a module path — absolute, `~/`, or relative to this
 * checkout, never to whatever directory the daemon happened to start in — whose default (or
 * `driver`, or the module itself) exports the calls, the same three readings
 * `bin/promoterun.js` allows.
 */
export async function loadDriver(spec, { cfg, root, importer = (url) => import(url) } = {}) {
  if (spec === SINGLE) return singleDriver({ cfg });
  const home = spec.startsWith('~/') ? path.join(os.homedir(), spec.slice(2)) : spec;
  const file = path.isAbsolute(home) ? home : path.resolve(root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), home);
  const mod = await importer(pathToFileURL(file).href);
  return mod.driver || mod.default || mod;
}

/** The recorded runs on a bead — `[{ at }]` oldest first, off the comments and nothing else. */
export function runsOf(comments) {
  const runs = [];
  for (const c of comments || []) {
    const ledger = parseRun(c?.text ?? c?.body ?? c?.comment ?? '');
    if (ledger) runs.push({ at: Date.parse(ledger.at || '') || 0 });
  }
  return runs;
}

/**
 * A single-environment driver whose `deploy` adopts what a dead carry already started.
 *
 * `records` is the deploy journal, `since` the time of the bead's last run comment (a record
 * older than that was reported by a carry that finished and is somebody else's history), and
 * `bootedAt` when this process started. See the header for what each status means here.
 */
export function resuming(driver, { records, since = 0, bootedAt = 0 }) {
  const mine = (ctx) =>
    records()
      .filter((r) => r?.bead === ctx.bead && Date.parse(r.requestedAt || '') > since)
      .filter((r) => [r.repo, keyOf(r)].some((k) => k && (k === ctx.repo || k === `${ctx.workspace}/${ctx.repo}`)))
      .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))[0] || null;

  return {
    ...driver,
    environments: 1,
    deploy(ctx) {
      const rec = mine(ctx);
      if (!rec) return driver.deploy(ctx);
      const where = `deploy ${rec.id} of \`${keyOf(rec)}\`, started by a carry that stopped before it could report`;
      if (rec.status === 'ok') return { state: PASSED, image: rec.to || '', detail: `${where} — it settled \`ok\`, so it was adopted rather than run again` };
      if (rec.status === 'failed') return { state: FAILED, detail: `${where} — it failed: ${first(rec.error) || 'no reason recorded'}` };
      const requested = Date.parse(rec.requestedAt || '');
      if (rec.status === 'unconfirmed' && rec.restarts && bootedAt > requested) {
        return {
          state: PASSED,
          image: rec.to || '',
          detail: `${where} — it restarts the daemon, and this is the daemon that came up after it, so it was adopted rather than run again`,
        };
      }
      return { state: UNKNOWN, detail: `${where} — it ended \`${rec.status}\`, which says nothing about whether it landed` };
    },
    test: (ctx) => driver.test(ctx),
  };
}

/**
 * Build the sweep. `sweep()` looks at every workspace once and starts at most **one** carry in
 * the background — it never waits for it, because a deploy takes minutes and the cycle it is
 * called from has other sweeps to run. `idle()` resolves when nothing is in flight, which is
 * what a suite awaits.
 */
// `tracker` and not `bd`: lib/server.js builds this inside startPoller, where test/pollerbus.mjs
// refuses a bare `bd` even as an object key — the daemon's own is only ever `app.bd`.
export function createPromotionSweep({
  tracker: bd,
  cfg,
  workspaces = () => cfg.workspaces || [],
  allowed = autoShipAllowed,
  load = (spec) => loadDriver(spec, { cfg }),
  run = carry,
  deploys = () => listDeploys({ limit: 200 }),
  observing = () => false,
  log = () => {},
  emit = () => {},
  now = () => Date.now(),
  bootedAt = Date.now() - process.uptime() * 1000,
} = {}) {
  let current = null;
  const said = new Map();
  const tried = new Map();

  const say = (key, line) => {
    if (said.get(key) === line) return;
    said.set(key, line);
    log(line);
  };

  const carryOne = async (ws, row, spec, { since, resume }) => {
    const id = row.id;
    const key = `${ws.name}/${id}`;
    emit({ type: 'promotion', key, workspace: ws.name, id, state: 'carrying' });
    log(`${key}: carrying — driver ${spec}${resume ? ', resuming a carry that stopped before it reported' : ''}`);
    let out;
    try {
      let driver = await load(spec);
      if (resume && isSingle(driver)) driver = resuming(driver, { records: deploys, since, bootedAt });
      out = await run(bd, ws, id, driver, { actor: cfg.actor });
    } catch (err) {
      out = { refused: `the driver would not load — ${first(err)}` };
    }
    if (out.refused) {
      // Nothing was claimed and nothing was written, so this is not a run and costs no budget —
      // and it repeats only when the reason changes.
      say(key, `${key}: not carried — ${out.refused}`);
    } else {
      tried.set(id, now());
      said.delete(key);
      const how = out.closed ? 'closed, verified in production' : out.handedBack ? 'handed back — not verified' : 'run, and left claimed';
      log(`${key}: ${how} (${out.state})${(out.warn || []).length ? ` — ${out.warn.join('; ')}` : ''}`);
    }
    emit({ type: 'promotion', key, workspace: ws.name, id, state: out.refused ? 'refused' : out.closed ? 'closed' : 'settled' });
  };

  /** Why this bead is not being carried now, or `{ spec, since, resume }` when it is. */
  const decide = async (ws, row, readyIds) => {
    const id = row.id;
    if (labelsOf(row).includes('human')) return { why: 'it is a question waiting on a person' };
    if (!allowed(cfg, ws.name)) {
      return { why: `autoShip is off for \`${ws.name}\`, so nothing is carried unattended — carry it by hand with \`beadcause-promoterun -w ${ws.name} -b ${id} --driver <driver>\`` };
    }
    const found = driverSpecFor(cfg, ws.name, row);
    if (found.why) return { why: found.why };

    const actor = text(cfg.actor);
    if (!actor) return { why: 'the daemon has no actor name, so it cannot tell its own claim from anybody else\'s' };

    // The journal first: whatever the tracker says, a live deploy for this bead is a carry.
    const live = deploys().filter((r) => inFlight(r));
    const mine = live.find((r) => r.bead === id);
    if (mine) return { why: `deploy ${mine.id} for it is still running` };
    for (const repo of reposOf(row)) {
      const other = live.find((r) => [keyOf(r), r.repo].includes(repo) || keyOf(r) === `${ws.name}/${repo}`);
      if (other) return { why: `deploy ${other.id} of \`${keyOf(other)}\` is already running` };
    }

    // A `held:` lease is the other claim on a bead — an advocate window on this Mac, or another
    // Mac's daemon under the federated shape (lib/lease.js). A live one is somebody at work.
    const at = new Date(now());
    const lease = leasesOf(row.labels).find((l) => isLive(l, { now: at }));
    if (lease) return { why: describeLease(lease, { now: at }) };

    const holder = text(row.assignee);
    let resume = false;
    if (holder && holder !== actor) return { why: `it is held by ${holder}` };
    if (holder) {
      const claimed = Date.parse(row.updated_at || row.updatedAt || '');
      if (!Number.isFinite(claimed)) return { why: 'it is claimed and the claim carries no time, so it cannot be told from a live one' };
      const stale = claimed < bootedAt || now() - claimed > LEASE_MS;
      if (!stale) return { why: `it was claimed ${minutes(now() - claimed)} ago by a carry that may still be running` };
      resume = true;
    } else if (text(row.status).toLowerCase() !== 'in_progress' && !readyIds.has(id)) {
      return { why: 'it is not ready — a dependency or a far-tracker marker says not yet' };
    }

    let runs;
    try {
      runs = runsOf(await bd.comments(ws, id));
    } catch (err) {
      return { why: `could not read its run history — ${first(err)}` };
    }
    const since = runs.reduce((t, r) => Math.max(t, r.at), 0);
    if (!resume) {
      if (runs.length >= MAX_RUNS) {
        return { why: `${runs.length} runs are recorded on it and none closed it — read the last one, then carry it by hand` };
      }
      const last = Math.max(since, tried.get(id) || 0);
      if (last && now() - last < COOLDOWN_MS) return { why: `it was last run ${minutes(now() - last)} ago — trying again after ${minutes(COOLDOWN_MS)}` };
    }
    return { spec: found.spec, since, resume };
  };

  async function sweep() {
    const out = { started: null, skipped: [] };
    if (observing()) return out;
    for (const ws of workspaces()) {
      let rows;
      try {
        rows = await openPromotions(bd, ws);
      } catch (err) {
        say(`${ws.name}/`, `${ws.name}: could not list promotion beads — ${first(err)}`);
        continue;
      }
      if (!rows.length) continue;

      let readyIds = null;
      for (const row of rows) {
        const key = `${ws.name}/${row.id}`;
        if (current) {
          if (current.id === row.id) continue;
          out.skipped.push({ workspace: ws.name, bead: row.id, why: `another promotion (${current.id}) is being carried` });
          continue;
        }
        if (readyIds === null) {
          try {
            readyIds = new Set(((await bd.ready(ws)) || []).map((r) => r.id));
          } catch (err) {
            say(`${ws.name}/`, `${ws.name}: could not read what is ready, so nothing is started there — ${first(err)}`);
            readyIds = new Set();
          }
        }
        const verdict = await decide(ws, row, readyIds);
        if (verdict.why) {
          out.skipped.push({ workspace: ws.name, bead: row.id, why: verdict.why });
          say(key, `${key}: left alone — ${verdict.why}`);
          continue;
        }
        const promise = carryOne(ws, row, verdict.spec, verdict)
          .catch((err) => log(`${key}: the carry failed outright — ${first(err)}`))
          .finally(() => {
            if (current?.promise === promise) current = null;
          });
        current = { id: row.id, workspace: ws.name, promise };
        out.started = { workspace: ws.name, bead: row.id, resume: verdict.resume };
      }
    }
    return out;
  }

  return { sweep, idle: async () => { while (current) await current.promise; }, get busy() { return current ? current.id : null; } };
}
