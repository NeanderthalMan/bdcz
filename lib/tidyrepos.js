import fs from 'node:fs';
import path from 'node:path';
import { expandHome, reposBlock } from './repos.js';

/**
 * The checkouts the worktree sweep tidies *beyond* the approved ones — `repos.<ws>.tidy`.
 *
 * `approved` answers "where may an unattended session work", and that is a list Adam
 * writes and nothing discovers. But the worktrees in a Northwind service checkout are
 * mostly made by *interactive* sessions, in repos nobody has approved for the queue, and
 * the sweep only ever walked `approved` — so on 2026-10-01 ~40 service checkouts held 234
 * worktrees and 111 GB, every delivered one of them squash-merged on GitHub and swept by
 * nothing. Approving all forty to get them tidied would have widened where agents may go,
 * which is a different decision made for the wrong reason.
 *
 * So tidying gets its own list — and its own module, because lib/repos.js is pinned by
 * test/repos.mjs never to read a directory, and that pin is right for it. This one is
 * allowed to discover: `"*"` means every directory
 * directly under `root` that has a `.claude/worktrees/`. The argument against discovery is
 * about handing out work; the sweep hands out nothing, and its gates (unlocked, clean, no
 * live session, merged locally or by a MERGED pull request) are what decide a removal —
 * the list only decides where it looks. Named entries work like `approved` ones. No token
 * is read: a checkout the sweep visits never needs to be named by a bead.
 *
 * Returns `[{ name, dir }]` for directories that exist; an empty array when there is no
 * block or no `tidy` key, which is every workspace but one.
 */
export function tidyDirs(cfg = {}, workspaceName = '') {
  const block = reposBlock(cfg, workspaceName);
  if (!Array.isArray(block?.tidy)) return [];
  const root = block.root ? expandHome(block.root) : null;
  const out = [];
  const seen = new Set();
  const add = (e) => {
    if (!e?.dir || seen.has(e.dir) || !fs.existsSync(e.dir)) return;
    seen.add(e.dir);
    out.push({ name: e.name, dir: e.dir });
  };
  for (const raw of block.tidy) {
    if (String(raw || '').trim() === '*') {
      if (!root || !fs.existsSync(root)) continue;
      for (const d of fs.readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const dir = path.join(root, d.name);
        if (fs.existsSync(path.join(dir, '.claude', 'worktrees'))) add({ name: d.name, dir });
      }
      continue;
    }
    const r = String(raw || '').trim();
    if (!r) continue;
    const isPath = r.startsWith('~') || r.startsWith('/') || r.startsWith('.') || r.includes('/');
    const dir = isPath ? expandHome(r) : root ? path.join(root, r) : null;
    if (dir) add({ name: path.basename(dir), dir });
  }
  return out;
}
