/**
 * Replay a file's past merges with a proposed change — bc-dgx7.202.
 *
 * "Would restructuring this hot file cut its conflicts?" was answered by hand in three
 * sessions (bc-xl7n.207 package-lock.json, .212 docs/config.md, .213 lib/server.js), each
 * writing its own replay script. The proposed change took a different form every time — a
 * merge driver, a row layout, an import layout — but the measurement was one thing: take
 * every merge that changed the file on BOTH sides, count conflicted sections as git merges
 * it today, count them again with the change, and list the merges that got worse.
 *
 * Two kinds of change are supported, and they combine:
 *
 * - a **transform** `(text, side) => text`, applied to the merge-base, ours and theirs copies
 *   (`side` is 'base' | 'ours' | 'theirs') before `git merge-file` merges them — "what if
 *   the file had always been laid out this way";
 * - a **driver** `name=cmd`, a merge driver command (`%O %A %B %P` as in gitattributes) run
 *   instead of the text merge — "what if the clone had this driver".
 *
 * Read-only: history comes from `git rev-list`/`git show`; every merge happens on files in
 * a temp dir, never in a worktree or the index.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const SIDES = ['base', 'ours', 'theirs'];

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}
const git = (dir, args) => run('git', args, { cwd: dir });

/** Conflicted sections in merged text: one per `<<<<<<<` marker line. */
export function countSections(text) {
  return (String(text).match(/^<{7}( |$)/gm) || []).length;
}

/** `30d` / `12h` → milliseconds, or null when it is neither. */
export function parseSince(s) {
  const m = /^(\d+)([dh])$/.exec(String(s));
  return m ? Number(m[1]) * (m[2] === 'd' ? 86400000 : 3600000) : null;
}

/** `name=cmd` → `{ name, cmd }`, or null when malformed. */
export function parseDriver(s) {
  const i = String(s || '').indexOf('=');
  return i > 0 && i < s.length - 1 ? { name: s.slice(0, i), cmd: s.slice(i + 1) } : null;
}

/**
 * Merge three texts the way git's text merge does. `{ sections, text }`; sections is 0 when
 * clean. With `driver`, the driver runs instead, on the same three temp files.
 */
export async function mergeTexts(tmpDir, { base, ours, theirs }, { driver = null, file = 'file', cwd = tmpDir } = {}) {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'm-'));
  try {
    const O = path.join(dir, 'base');
    const A = path.join(dir, 'ours');
    const B = path.join(dir, 'theirs');
    fs.writeFileSync(O, base);
    fs.writeFileSync(A, ours);
    fs.writeFileSync(B, theirs);
    if (!driver) {
      const r = await run('git', ['merge-file', '-p', '-L', 'ours', '-L', 'base', '-L', 'theirs', A, O, B]);
      if (r.code < 0 || r.code > 127) return { sections: 0, text: '', error: r.stderr.trim() || 'merge-file failed' };
      return { sections: Math.max(countSections(r.stdout), r.code ? 1 : 0), text: r.stdout };
    }
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const cmd = driver.cmd.replace(/%O/g, q(O)).replace(/%A/g, q(A)).replace(/%B/g, q(B)).replace(/%P/g, q(file)).replace(/%L/g, '7');
    const r = await run('sh', ['-c', cmd], { cwd });
    const merged = fs.readFileSync(A, 'utf8');
    if (r.code === 0) return { sections: 0, text: merged };
    return { sections: Math.max(countSections(merged), 1), text: merged };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The merges within `sinceMs` that changed `file` on both sides: `[{ sha, p1, p2, base, at, subject }]`. */
export async function bothSidedMerges(dir, ref, file, { sinceMs, shas = null } = {}) {
  let list = shas;
  if (!list) {
    const args = ['rev-list', '--merges', '--full-history', `--since=${new Date(Date.now() - sinceMs).toISOString()}`, ref, '--', file];
    const r = await git(dir, args);
    list = r.stdout.split('\n').filter(Boolean);
  }
  const out = [];
  for (const sha of list) {
    const parents = (await git(dir, ['rev-list', '--parents', '-n', '1', sha])).stdout.trim().split(' ');
    const [, p1, p2] = parents;
    if (!p1 || !p2 || parents.length > 3) continue;
    const base = (await git(dir, ['merge-base', p1, p2])).stdout.trim();
    if (!base) continue;
    const ids = await Promise.all([base, p1, p2].map(async (c) => (await git(dir, ['rev-parse', '--verify', '--quiet', `${c}:${file}`])).stdout.trim()));
    if (ids.some((i) => !i)) continue;
    if (ids[1] === ids[0] || ids[2] === ids[0] || ids[1] === ids[2]) continue;
    const meta = (await git(dir, ['log', '-1', '--format=%ct%x09%s', sha])).stdout.trim().split('\t');
    out.push({ sha, p1, p2, base, at: new Date(Number(meta[0]) * 1000).toISOString(), subject: meta.slice(1).join('\t') });
  }
  return out;
}

async function show(dir, rev, file) {
  return (await git(dir, ['show', `${rev}:${file}`])).stdout;
}

/** The first `n` lines around the first conflict marker of some merged text. */
export function excerpt(text, n = 14) {
  const lines = String(text).split('\n');
  const i = lines.findIndex((l) => /^<{7}( |$)/.test(l));
  return i < 0 ? '' : lines.slice(i, i + n).join('\n');
}

/**
 * Replay. `opts`: `{ ref, sinceMs, shas, transform, driver }`. Returns
 * `{ file, merges, totals, rows }` — `rows` only those whose section count moved, worst first.
 */
export async function replay(dir, file, opts = {}) {
  const { ref = 'HEAD', sinceMs = 120 * 86400000, shas = null, transform = null, driver = null } = opts;
  if (!transform && !driver) throw new Error('nothing to replay: give a transform or a driver');
  const merges = await bothSidedMerges(dir, ref, file, { sinceMs, shas });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reshape-'));
  const all = [];
  try {
    for (const m of merges) {
      const raw = { base: await show(dir, m.base, file), ours: await show(dir, m.p1, file), theirs: await show(dir, m.p2, file) };
      const before = await mergeTexts(tmp, raw, { file });
      let changed = raw;
      if (transform) {
        changed = {};
        for (const s of SIDES) changed[s] = String(await transform(raw[s], s));
      }
      const after = await mergeTexts(tmp, changed, { driver, file, cwd: dir });
      all.push({ sha: m.sha, at: m.at, subject: m.subject, before: before.sections, after: after.sections, excerpt: after.sections ? excerpt(after.text) : '' });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const sum = (k) => all.reduce((n, r) => n + r[k], 0);
  const totals = {
    merges: all.length,
    conflictedBefore: all.filter((r) => r.before).length,
    conflictedAfter: all.filter((r) => r.after).length,
    sectionsBefore: sum('before'),
    sectionsAfter: sum('after'),
    better: all.filter((r) => r.after < r.before).length,
    worse: all.filter((r) => r.after > r.before).length,
  };
  const rows = all.filter((r) => r.before !== r.after).sort((a, b) => b.after - b.before - (a.after - a.before) || (a.at < b.at ? 1 : -1));
  return { file, merges: all, totals, rows };
}

/** The text report: two lines of totals, then a row per merge that moved, worse first. */
export function render(result, { since = '' } = {}) {
  const t = result.totals;
  const lines = [
    `${result.file}: ${t.merges} merge${t.merges === 1 ? '' : 's'} changed it on both sides${since ? ` in the last ${since}` : ''}`,
    `conflicted merges ${t.conflictedBefore} -> ${t.conflictedAfter}, conflicted sections ${t.sectionsBefore} -> ${t.sectionsAfter} (${t.better} better, ${t.worse} worse)`,
  ];
  for (const r of result.rows) {
    lines.push(`${r.after > r.before ? 'WORSE ' : 'better'}  ${r.sha.slice(0, 9)}  ${r.at.slice(0, 10)}  ${r.before} -> ${r.after}  ${r.subject}`);
  }
  return lines.join('\n');
}
