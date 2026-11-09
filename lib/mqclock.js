/**
 * The merge queue's clock — one per workspace, none of them awaited — bc-7vvgj.
 *
 * The queue used to be one step of the poller's slow-clock chain: every workspace in
 * series, awaited, ahead of an advocate tick measured at sixteen minutes on 2026-11-07.
 * A thirty-second queue ran every twenty minutes, and a tracker that hung for two minutes
 * (architecture's, at 19:45:55Z) held up every workspace after it in the loop. delmar's
 * #1308 — a P0 — was approved at 18:58Z and first looked at at 19:46Z.
 *
 * This is the scheduler that replaces the loop, and only the scheduler: what one pass
 * *does* is still `runMergeQueueFor` in lib/server.js, unchanged, so everything a pass
 * guaranteed inside a workspace — bead-id order, one merge per base, downmerge before
 * merge, one holds memo per pass — it still guarantees. What changed is who waits on
 * whom, and the answer is now: nobody waits on anybody.
 *
 * - **Its own due time and its own in-flight flag per workspace.** `beat()` returns at
 *   once and never awaits a pass, so a hung workspace delays only itself and the poller's
 *   cycle delays none of them.
 * - **A pass that moved something is followed at once** — due on the very next beat
 *   rather than a full interval later. A merge moves the base under everything else
 *   queued on it, and a downmerge is the step before a merge; waiting an interval to act
 *   on either is the lag this exists to remove, only smaller. A quiet pass answers
 *   neither, so this cannot spin.
 * - **At most `cap` passes at once.** Each pass is `gh` calls and `bd` writes, and sixteen
 *   started on one beat is the rate-limit and Dolt-lock contention the serial loop never
 *   had to think about. A workspace that finds the cap full is still due, and a later beat
 *   takes it; the starting point rotates so the same few cannot keep the slots.
 * - **It says how long a pass took** when it was slow or moved something, and once a
 *   minute while one is still running — so the next workspace that hangs is named in the
 *   log rather than inferred from a gap in it.
 *
 * Kept free of the daemon on purpose, so test/mqclock.mjs can run it against a fake pass
 * and a fake clock.
 */

/**
 * @param {object} o
 * @param {() => Array<{name: string}>} o.workspaces  read on every beat: config can change
 * @param {(ws: object) => Promise<{merged?: string[], updated?: string[]}>} o.run  one pass
 * @param {number} [o.everyMs=30000]  the ordinary interval between one workspace's passes
 * @param {number} [o.cap=4]  passes in flight at once, across every workspace
 * @param {number} [o.slowMs=20000]  a pass at least this long is logged with its timing
 * @param {number} [o.warnMs=60000]  how often a still-running pass is reported
 * @param {(line: string) => void} [o.log]
 * @param {(ws: object, out: object) => void} [o.onMerged]  after a pass that merged
 * @param {(ws: object, err: Error) => void} [o.onError]
 * @param {() => number} [o.now]
 */
export function createMergeQueueClock({
  workspaces,
  run,
  everyMs = 30_000,
  cap = 4,
  slowMs = 20_000,
  warnMs = 60_000,
  log = (line) => console.log(line),
  onMerged = () => {},
  onError = () => {},
  now = () => Date.now(),
}) {
  const due = new Map();
  const running = new Map();
  let turn = 0;

  const start = (ws, at) => {
    running.set(ws.name, { at, warned: at });
    due.set(ws.name, at + everyMs);
    const done = Promise.resolve()
      .then(() => run(ws))
      .then((out) => {
        const ms = now() - at;
        const moved = (out?.merged?.length || 0) + (out?.updated?.length || 0) > 0;
        if (moved) due.set(ws.name, 0);
        if (out?.merged?.length) onMerged(ws, out);
        if (moved || ms >= slowMs) {
          log(`[merge-queue] ${ws.name}: pass took ${(ms / 1000).toFixed(1)}s${moved ? ' — going again now' : ''}`);
        }
      })
      .catch((err) => {
        log(`[merge-queue] ${ws.name}: pass failed — ${String(err?.message || err).split('\n')[0]}`);
        onError(ws, err);
      })
      .finally(() => {
        running.delete(ws.name);
      });
    return done;
  };

  /**
   * Start every pass that is due and fits under the cap; answer the promises of the
   * passes it started, which the poller ignores and a test awaits.
   */
  const beat = () => {
    const all = workspaces() || [];
    const started = [];
    if (!all.length) return started;
    const t = now();
    for (const [name, r] of running) {
      if (t - r.warned >= warnMs) {
        r.warned = t;
        log(`[merge-queue] ${name}: pass still running after ${Math.round((t - r.at) / 1000)}s — only this workspace is waiting on it`);
      }
    }
    turn = (turn + 1) % all.length;
    const order = [...all.slice(turn), ...all.slice(0, turn)];
    for (const ws of order) {
      if (running.size >= cap) break;
      if (running.has(ws.name)) continue;
      if (t < (due.get(ws.name) || 0)) continue;
      started.push(start(ws, t));
    }
    return started;
  };

  return { beat, running: () => [...running.keys()], dueAt: (name) => due.get(name) || 0 };
}
