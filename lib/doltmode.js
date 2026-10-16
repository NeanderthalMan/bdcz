/**
 * Which Dolt engine each tracker runs on, and the one setting that decides it.
 *
 * `bd` has two engines and picks between them per workspace, from `dolt_mode` in that
 * workspace's own `.beads/metadata.json`:
 *
 *   embedded      an in-process Dolt, opened and closed around every `bd` call
 *   server        a per-project `dolt sql-server`, started by bd itself on first use
 *
 * Embedded is the default `bd init` writes, it is single-writer, and it is slow. Measured
 * 2026-09-15 on a scratch workspace holding one bead, eight `bd list --json` calls per
 * round, alternating so that neither mode got the warm cache to itself:
 *
 *   server    93 ms/call, 98 ms/call
 *   embedded  701 ms/call, 723 ms/call
 *
 * And again on 2026-09-16 against two real trackers, which is the better evidence
 * because the graphs are real sizes and the load is a real Mac's:
 *
 *   loremia   1560 issues, server    111 ms/call
 *   sorrel     398 issues, embedded  526 ms/call
 *
 * Between four and seven times, and the real-workspace pair understates it — the server
 * is carrying four times the data and still answering in a fifth of the time. Paid on
 * every `bd` call an advocate's worker makes, all day. That is the whole reason this file
 * exists, and the reason the default below is on.
 *
 * **Measure against a tracker that has beads in it.** An empty workspace answers in
 * ~115ms on *either* engine, because what is being timed is process startup and not the
 * store — ehden, at 0 issues, read as fast embedded as loremia did on a server and made
 * the whole effect look imaginary for about a minute.
 *
 * ## This is not a launchd job, and the distinction is the first thing to get right
 *
 * The obvious reading of "always run a server" is a second `launchd` plist beside the
 * daemon's. It would not work. `bd` does not look for a server that happens to be
 * running; it reads `dolt_mode` and, in server mode, starts and reuses one of its own.
 * A server launchd started that no workspace's metadata points at gets no traffic, and
 * Dolt locks a data directory, so it would also stop bd from starting the one it wants.
 * The mode lives in the workspace. So does this.
 *
 * It follows that nothing here has to stay running, which is what makes lazy start the
 * right shape: a workspace nobody touches never starts a server at all.
 *
 * ## Three things the applier has to honour, each learned the hard way
 *
 * 1. **`dolt_data_dir` is load-bearing.** Writing `dolt_mode: "server"` on its own points
 *    the server at `.beads/dolt`, which is *not* where the embedded engine kept anything:
 *    that is `.beads/embeddeddolt`. Measured — the server comes up clean, `bd create`
 *    prints bootstrap advice, and `bd list` reports an empty tracker. The beads are
 *    fine and on disk, and every symptom says they are gone. So the flip pins
 *    `dolt_data_dir` to the embedded directory, which is exactly what the beadcause
 *    workspace's own metadata has carried since it was flipped by hand on 2026-08-17.
 * 2. **A running server holds the data directory, so flipping *back* is not just a
 *    write.** Rewrite the metadata to `embedded` underneath a live server and every
 *    embedded caller blocks on the lock instead of failing — measured as `bd list`
 *    hanging past two minutes, with nothing in the output to say why. `revertToEmbedded`
 *    below stops the server first, and `applyPlan` never goes that direction on its own.
 * 3. **`bd dolt start` refuses in embedded mode** ("not supported in embedded mode"), so
 *    the metadata write is the only door in. There is no bd command that flips this.
 *
 * ## What it will not touch
 *
 * A workspace whose `.beads/metadata.json` is **tracked by git** is refused, and that is
 * not a stylistic objection. Northwind's `cl-` graph lives inside the `architecture`
 * repo the whole team clones, and `metadata.json` is one of the four things committed
 * there. `dolt_data_dir` is an absolute path on one Mac, so committing this choice would
 * point six other engineers' `bd` at `/Users/you/...` and break every one of
 * them. An in-repo tracker can still be moved — by a person, who can then decide what to
 * commit — and `--force` says so out loud.
 *
 * Also left alone: a workspace already in server mode with its data directory pinned
 * (nothing to do), one with a `dolt_data_dir` somebody else chose (their answer wins),
 * and one with no `embeddeddolt` directory to point at (nothing to preserve, and a
 * guess here is the failure in note 1).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** What `doltServer` may say. Anything else falls back to the default. */
export const DOLT_SERVER_POLICIES = ['advocated', 'all', 'off'];

export const DEFAULT_DOLT_SERVER_POLICY = 'advocated';

/**
 * The policy, normalised.
 *
 * An unreadable value reads as the default rather than as `off`: a typo in the config
 * should leave the install doing the useful thing, and the alternative is a setting that
 * silently stops working when somebody writes `"advocates"`.
 */
export function doltServerPolicy(cfg = {}) {
  const raw = typeof cfg.doltServer === 'string' ? cfg.doltServer.trim().toLowerCase() : '';
  return DOLT_SERVER_POLICIES.includes(raw) ? raw : DEFAULT_DOLT_SERVER_POLICY;
}

/**
 * Should this workspace be on a server?
 *
 * `advocated` is the default because a server is not free — about 87MB resident on a
 * fresh workspace, and 398MB on beadcause's own, measured 2026-09-15 — and the daemon
 * polls every tracker it serves, so a workspace in server mode has one resident from the
 * first poll onwards whether or not anybody is working in it. Eleven workspaces would be
 * something over a gigabyte held to make a queue nobody is reading answer faster. The
 * advocated ones are precisely the ones an agent hammers.
 */
export function shouldServe(cfg, name) {
  const policy = doltServerPolicy(cfg);
  if (policy === 'off') return false;
  if (policy === 'all') return true;
  const advocated = cfg?.advocates?.workspaces || [];
  return advocated.includes('*') || advocated.includes(name);
}

/**
 * Both shapes of "where the workspace is", because this repo hands over both.
 *
 * `discoverWorkspaces()` in lib/workspaceroots.js returns `dir` as the **`.beads`
 * directory itself** — `~/beads/sorrel/.beads` — while lib/team.js calls its `dir` the
 * directory *above* it and joins `.beads` on at every use. Neither is wrong and neither
 * is going to change, so the two accessors below take either and answer correctly. The
 * first draft of this file assumed the team.js shape, and every real workspace came back
 * "no metadata.json" from a plan that had just read a directory full of them.
 */
export const beadsDir = (dir) => (path.basename(dir) === '.beads' ? dir : path.join(dir, '.beads'));
/** Where `bd` should be run from — the checkout, not its `.beads`. */
export const workspaceRoot = (dir) => (path.basename(dir) === '.beads' ? path.dirname(dir) : dir);
export const metadataPath = (dir) => path.join(beadsDir(dir), 'metadata.json');
export const embeddedPath = (dir) => path.join(beadsDir(dir), 'embeddeddolt');
export const serverDefaultPath = (dir) => path.join(beadsDir(dir), 'dolt');

const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Empty, or not there at all — the two states in which `.beads/dolt` holds nothing. */
const holdsNothing = (p) => {
  try {
    return fs.readdirSync(p).length === 0;
  } catch {
    return true;
  }
};

/**
 * Is this workspace's metadata under git control?
 *
 * Asked with `ls-files --error-unmatch`, which is the only question that distinguishes
 * *tracked* from *present in a repo*: a workspace under `~/beads` may well sit inside
 * some enclosing checkout without anybody having committed its metadata, and that one is
 * safe to change. A machine with no `git` answers "no", which is the same answer it would
 * give for a directory that is not a repository.
 */
export function metadataIsTracked(dir, { run = spawnSync } = {}) {
  const r = run('git', ['-C', beadsDir(dir), 'ls-files', '--error-unmatch', 'metadata.json'], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

/**
 * Everything on disk for one workspace, with no opinion about it.
 *
 * `mode` is what bd would use — absent means embedded, because that is bd's own default
 * and a metadata file written before `dolt_mode` existed must keep reading as what it has
 * always been.
 */
export function inspect(dir, { run = spawnSync } = {}) {
  const file = metadataPath(dir);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { dir, file, exists: false, mode: null, dataDir: null };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { dir, file, exists: true, unreadable: err.message.split('\n')[0], mode: null, dataDir: null };
  }
  return {
    dir,
    file,
    exists: true,
    json,
    raw,
    mode: json.dolt_mode === 'server' ? 'server' : 'embedded',
    dataDir: typeof json.dolt_data_dir === 'string' && json.dolt_data_dir ? json.dolt_data_dir : null,
    embedded: embeddedPath(dir),
    hasEmbedded: isDir(embeddedPath(dir)),
    serverDefaultEmpty: holdsNothing(serverDefaultPath(dir)),
    tracked: metadataIsTracked(dir, { run }),
  };
}

/**
 * What should happen to one workspace, and why — as a sentence, because every one of
 * these is printed.
 *
 * `action` is one of:
 *   'none'    already right, or deliberately not ours to change
 *   'serve'   flip embedded → server, pinning the data directory
 *   'pin'     already server but pointed at nothing; pin it before it reads empty
 * and a `refusal` is set when the state needs a person rather than a default.
 */
export function planWorkspace(cfg, ws, { run = spawnSync, force = false } = {}) {
  const name = ws.name;
  const dir = ws.dir;
  const seen = inspect(dir, { run });
  const base = { name, dir, mode: seen.mode, action: 'none', refusal: null, what: '' };

  if (!seen.exists) return { ...base, what: 'no metadata.json — not a bd workspace this understands' };
  if (seen.unreadable) return { ...base, refusal: `${name}: metadata.json will not parse — ${seen.unreadable}` };

  const wanted = shouldServe(cfg, name);

  if (seen.mode === 'server') {
    if (seen.dataDir) return { ...base, what: 'already on a server' };
    // Server mode with nothing pinned is the broken middle: bd is about to serve
    // `.beads/dolt`, and the beads are in `.beads/embeddeddolt`. Repaired whatever the
    // policy says, because leaving it is leaving a tracker that reads as empty.
    if (!seen.hasEmbedded) return { ...base, what: 'on a server, with no embedded directory to pin' };
    if (!seen.serverDefaultEmpty) {
      return {
        ...base,
        refusal:
          `${name}: on a server with no dolt_data_dir, and .beads/dolt already holds data. ` +
          `Pinning it at .beads/embeddeddolt now would swap which database is live, so this ` +
          `one needs a person to say which of the two is the real tracker.`,
      };
    }
    return {
      ...base,
      action: 'pin',
      what: 'pin dolt_data_dir at .beads/embeddeddolt — on a server, pointed at nothing, and reading empty',
    };
  }

  if (!wanted) return { ...base, what: 'embedded (no advocate)' };
  if (!seen.hasEmbedded) return { ...base, what: 'embedded, with no embeddeddolt directory yet — left alone' };
  if (seen.tracked && !force) {
    return {
      ...base,
      refusal:
        `${name}: .beads/metadata.json is tracked by git, and dolt_data_dir is an absolute ` +
        `path on this Mac — committing it would point every other clone at a directory that ` +
        `is not there. Move this one by hand, or re-run with --force if the file is yours alone.`,
    };
  }

  return {
    ...base,
    action: 'serve',
    what: 'embedded → server, data dir pinned at .beads/embeddeddolt',
  };
}

/** Every workspace, in the order they were given. */
export function planDoltModes(cfg, workspaces, opts = {}) {
  return workspaces.map((ws) => planWorkspace(cfg, ws, opts));
}

/** A `bd`, never through a shell — `~/.zshenv` rewrites BEADS_DIR from the cwd. */
function bd(args, { dir, run = spawnSync, timeout = 120_000 } = {}) {
  const root = workspaceRoot(dir);
  const r = run('bd', args, {
    cwd: fs.existsSync(root) ? root : undefined,
    env: { ...process.env, BEADS_DIR: beadsDir(dir) },
    encoding: 'utf8',
    timeout,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', failed: r.status !== 0 };
}

/** How many beads bd can see right now, or null when it could not say. */
export function beadCount(dir, { run = spawnSync } = {}) {
  const r = bd(['stats', '--json'], { dir, run });
  if (r.failed) return null;
  try {
    const total = JSON.parse(r.stdout)?.summary?.total_issues;
    return typeof total === 'number' ? total : null;
  } catch {
    return null;
  }
}

/** Write metadata.json with one key changed, atomically, keeping the rest exactly as it was. */
function writeMetadata(file, mutate) {
  const before = fs.readFileSync(file, 'utf8');
  const json = JSON.parse(before);
  mutate(json);
  const tmp = `${file}.beadcause.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return before;
}

/**
 * Do it — and prove it, which is the part that matters.
 *
 * The bead count is read before the write and again after, and a tracker that had beads
 * and now has none is **rolled straight back**. That is note 1 in the header turned into
 * a guard: it is the one failure this change can cause, it looks exactly like data loss,
 * and it is cheap to detect because bd will happily answer the question either way.
 *
 * A count of `null` — bd could not be run, or said something unparseable — is not treated
 * as zero. "I could not ask" and "the answer is none" have to stay different here, or a
 * machine without `bd` on its PATH would roll back a perfectly good flip.
 */
export function applyPlan(entry, { run = spawnSync } = {}) {
  if (entry.action !== 'serve' && entry.action !== 'pin') return null;
  const dir = entry.dir;
  const file = metadataPath(dir);
  const before = entry.action === 'serve' ? beadCount(dir, { run }) : null;

  let original;
  try {
    original = writeMetadata(file, (json) => {
      json.dolt_mode = 'server';
      if (!json.dolt_data_dir) json.dolt_data_dir = embeddedPath(dir);
      if (!json.dolt_server_host) json.dolt_server_host = '127.0.0.1';
    });
  } catch (err) {
    return `${entry.name}: could not write metadata.json — ${err.message.split('\n')[0]}`;
  }

  const after = beadCount(dir, { run });
  if (before !== null && before > 0 && after === 0) {
    try {
      fs.writeFileSync(file, original);
    } catch {
      /* the sentence below is worth more than this failure */
    }
    bd(['dolt', 'stop'], { dir, run });
    return (
      `${entry.name}: the server came up on an empty database — ${before} beads before, none after — ` +
      `so the metadata has been put back exactly as it was and the tracker is embedded again. ` +
      `Nothing was lost; the server was pointed somewhere other than .beads/embeddeddolt.`
    );
  }
  return null;
}

/**
 * The way back, and it is deliberately only ever asked for by hand.
 *
 * Stopping the server first is not tidiness: a live server holds the data directory, and
 * an embedded caller meeting that lock waits rather than fails (note 2 in the header).
 * So the order is stop, then write — and if the stop fails, nothing is written at all,
 * because a workspace wedged behind a lock is worse than one still on a server.
 */
export function revertToEmbedded(dir, { run = spawnSync, name = path.basename(workspaceRoot(dir)) } = {}) {
  const seen = inspect(dir, { run });
  if (!seen.exists) return `${name}: no metadata.json`;
  if (seen.mode !== 'server') return null;
  const stopped = bd(['dolt', 'stop'], { dir, run });
  if (stopped.failed && !/not running|no server/i.test(`${stopped.stdout}${stopped.stderr}`)) {
    return `${name}: the Dolt server would not stop, so the mode was left alone — ${(stopped.stderr || '').trim().split('\n')[0]}`;
  }
  try {
    writeMetadata(seen.file, (json) => {
      json.dolt_mode = 'embedded';
      // The pin goes with the mode. Left behind, it is a path to a directory the embedded
      // engine would then be told to treat as its own, which is the same confusion in
      // reverse.
      if (json.dolt_data_dir === embeddedPath(dir)) delete json.dolt_data_dir;
    });
  } catch (err) {
    return `${name}: could not write metadata.json — ${err.message.split('\n')[0]}`;
  }
  return null;
}
