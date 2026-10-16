/**
 * How full is the disk, what of ours is filling it, and will a worktree or a gate fit.
 * bin/b7e-space is the command; this is the measuring, kept apart so gate admission can ask
 * the same question (`fits`) before it starts a run rather than after ENOSPC (bc-xl7n.196).
 *
 * bc-dgx7.197: three windows on 2026-10-15 (bc-dgx7.196, bc-j2zwo.20, bc-j2zwo.14) each hit
 * ENOSPC and each worked out the cause with a different list of `df` and `du` commands.
 *
 * Everything here is a read. Sizes come from `du -sk` — a native walk is an order of
 * magnitude faster than one in node over node_modules trees — behind an injectable
 * `measure`, and free space from `fs.statfsSync` behind an injectable `statfs`, which is
 * how the test pins a full disk without filling one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const GiB = 1024 ** 3;

/**
 * Bytes a thing needs free before it is started. Measured on 2026-10-15: a worktree
 * checkout is a few hundred MB and a full gate fans ~600 suites into TMPDIR, 6.1G of
 * beadcause-gate-run-* and beadcause-prfull-* in bc-j2zwo.14. Floors, not forecasts: below
 * them the failure is the ordinary outcome.
 */
export const FLOORS = { worktree: 1 * GiB, gate: 8 * GiB };

/** `worktree` | `gate` | a plain byte count → bytes, or null when it is none of those. */
export function floorFor(need) {
  if (Object.hasOwn(FLOORS, need)) return FLOORS[need];
  if (/^\d+$/.test(String(need))) return Number(need);
  return null;
}

/** Free and total bytes of the volume holding `dir`. */
export function volumeOf(dir, statfs = fs.statfsSync) {
  const s = statfs(dir);
  return { dir, free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) };
}

/** Disk usage of a path in bytes; 0 for one that is not there. */
export function duBytes(p) {
  try {
    const out = execFileSync('du', ['-sk', p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return Number(out.split(/\s/)[0]) * 1024;
  } catch (e) {
    // du exits 1 on a single unreadable file but still prints the total it reached.
    const m = String(e.stdout || '').match(/^(\d+)/);
    return m ? Number(m[1]) * 1024 : 0;
  }
}

function subdirs(dir, keep = () => true) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && keep(d.name))
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** Is this linked worktree locked? Its `.git` file points at the admin dir holding `locked`. */
export function lockState(wt) {
  try {
    const m = fs.readFileSync(path.join(wt, '.git'), 'utf8').match(/^gitdir:\s*(.+)$/m);
    if (!m) return 'unlocked';
    return fs.existsSync(path.join(m[1].trim(), 'locked')) ? 'locked' : 'unlocked';
  } catch {
    return 'unlocked';
  }
}

function group(label, dirs, measure, { lock = false, top = 5 } = {}) {
  const items = dirs.map((d) => ({ path: d, name: path.basename(d), bytes: measure(d), ...(lock ? { lock: lockState(d) } : {}) }))
    .sort((a, b) => b.bytes - a.bytes);
  return { label, count: items.length, bytes: items.reduce((n, i) => n + i.bytes, 0), largest: items.slice(0, top) };
}

/**
 * The whole answer. `root` is the main checkout, `tmp` is TMPDIR, `siblings` is the directory
 * whose children are other repos (each may carry its own .claude/worktrees).
 * Users come back largest first.
 */
export function survey({ root, tmp = os.tmpdir(), siblings = null, measure = duBytes, statfs = fs.statfsSync } = {}) {
  const volumes = [volumeOf(root, statfs)];
  if (path.resolve(tmp) !== path.resolve(root)) volumes.push(volumeOf(tmp, statfs));
  const users = [
    group('worktrees', subdirs(path.join(root, '.claude', 'worktrees')), measure, { lock: true }),
    group('worktrees-retired', subdirs(path.join(root, '.claude', 'worktrees-retired')), measure),
    group('gate-run folders', subdirs(tmp, (n) => /^beadcause-(gate-run|prfull)-/.test(n)), measure),
    group('other beadcause-* in TMPDIR', subdirs(tmp, (n) => /^beadcause-/.test(n) && !/^beadcause-(gate-run|prfull)-/.test(n)), measure),
  ];
  if (siblings) {
    const own = path.resolve(root);
    const dirs = subdirs(siblings)
      .filter((d) => path.resolve(d) !== own)
      .flatMap((d) => subdirs(path.join(d, '.claude', 'worktrees')));
    users.push(group('sibling repos\' worktrees', dirs, measure, { lock: true }));
  }
  users.sort((a, b) => b.bytes - a.bytes);
  return { volumes, users };
}

/**
 * Will `need` fit? Judged against the tightest volume that thing writes to: a worktree lands
 * in the checkout's volume, a gate run in TMPDIR's as well, so a gate takes the minimum.
 */
export function fits(answer, need) {
  const floor = floorFor(need);
  if (floor == null) return null;
  const vols = need === 'worktree' ? answer.volumes.slice(0, 1) : answer.volumes;
  const free = Math.min(...vols.map((v) => v.free));
  return { need, floor, free, ok: free >= floor };
}

export function human(n) {
  if (n >= GiB) return `${(n / GiB).toFixed(1)}G`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)}M`;
  return `${Math.round(n / 1024)}K`;
}

export function render(answer, verdict) {
  const out = [];
  for (const v of answer.volumes) {
    const pct = v.total ? Math.round(((v.total - v.free) / v.total) * 100) : 0;
    out.push(`${human(v.free)} free of ${human(v.total)} (${pct}% used)  ${v.dir}`);
  }
  out.push('');
  for (const u of answer.users) {
    out.push(`${human(u.bytes).padStart(7)}  ${u.label} (${u.count})`);
    for (const i of u.largest) out.push(`${human(i.bytes).padStart(13)}  ${i.name}${i.lock === 'locked' ? '  [locked]' : ''}`);
  }
  if (verdict) {
    out.push('');
    out.push(`${verdict.ok ? 'fits' : 'DOES NOT FIT'}: ${verdict.need} wants ${human(verdict.floor)}, ${human(verdict.free)} free`);
  }
  return out.join('\n');
}
