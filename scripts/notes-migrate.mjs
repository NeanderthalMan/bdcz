#!/usr/bin/env node
/**
 * Convert every tier-1 notes store to one blob per note plus an index (bc-u1ltu.1).
 *
 *   node scripts/notes-migrate.mjs <repo>...            dry run: build and check each tree
 *   node scripts/notes-migrate.mjs --scan <dir>...      every git checkout directly under <dir>
 *   node scripts/notes-migrate.mjs --apply <repo>...    commit the converted trees
 *
 * The first `note` after the change converts a store by itself, so this is not needed for
 * correctness. It exists so that every store is converted *and checked* at a moment somebody
 * is watching: `migrateNotes` (lib/memory.js) reads each new tree back and refuses to commit
 * unless it holds the same keys with byte-identical notes, and this prints what it found per
 * ref. A dry run does the whole of that and stops short of `update-ref`.
 *
 * Every agent under `refs/beadcause/agents/` in each repo, one compare-and-swap each, so a
 * note written by a live session while this runs is re-read and converted rather than lost.
 * Exits non-zero if any store failed its check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { migrateNotes, NOTES_PREFIX } from '../lib/memory.js';
import { git, ok, mainCheckout } from '../lib/gitref.js';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const scan = argv.includes('--scan');
const dirs = argv.filter((a) => !a.startsWith('--'));
if (!dirs.length) {
  console.error('usage: notes-migrate.mjs [--apply] [--scan] <dir>...');
  process.exit(2);
}

const candidates = scan
  ? dirs.flatMap((d) =>
      fs
        .readdirSync(d, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(d, e.name, '.git')))
        .map((e) => path.join(d, e.name))
    )
  : dirs;

let failed = 0;
const seen = new Set();
for (const dir of candidates) {
  const repo = await ok(mainCheckout(dir));
  if (!repo || seen.has(repo)) continue;
  seen.add(repo);
  const refs = ((await ok(git(repo, ['for-each-ref', '--format=%(refname)', `${NOTES_PREFIX}/`]))) || '')
    .split('\n')
    .filter(Boolean)
    .map((r) => r.slice(NOTES_PREFIX.length + 1))
    // `<agent>/archive` and anything else nested is not a store of this shape.
    .filter((a) => !a.includes('/'));
  if (!refs.length) continue;
  console.log(repo);
  for (const agent of refs) {
    try {
      const r = await migrateNotes(repo, agent, { apply });
      const what =
        r.from === 'legacy'
          ? `${r.notes} notes ${apply ? `converted → ${r.commit.slice(0, 10)}` : 'check ok (dry run)'}`
          : `already ${r.from} (${r.notes} notes)`;
      console.log(`  ${agent.padEnd(20)} ${what}`);
    } catch (err) {
      failed += 1;
      console.log(`  ${agent.padEnd(20)} FAILED — ${err.message}`);
    }
  }
}
if (!seen.size) console.log('no repos found');
process.exit(failed ? 1 : 0);
