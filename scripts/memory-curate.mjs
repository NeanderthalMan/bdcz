#!/usr/bin/env node
/**
 * What the weekly memory curator would do to a repo's notes, without doing it (bc-u1ltu.5).
 *
 *   node scripts/memory-curate.mjs <repo>          the plan: archive, promote, merge, split
 *   node scripts/memory-curate.mjs --json <repo>   the same, as JSON
 *
 * Read-only: `createCurator().curate(..., { dryRun: true })` plans everything from the store,
 * `staleNotes` and the read log, then stops before the first write. The daemon's poll cycle
 * is what runs it for real, once a week per checkout (lib/curator.js).
 */
import { createCurator } from '../lib/curator.js';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const dir = argv.find((a) => !a.startsWith('--')) || process.cwd();

const out = await createCurator({ log: () => {}, warn: console.error }).curate(dir, null, { dryRun: true });
if (out.error || !out.plan) {
  console.error(out.error || out.why);
  process.exit(1);
}
if (asJson) {
  console.log(JSON.stringify({ ...out.plan, unusedHeld: out.unusedHeld }, null, 2));
  process.exit(0);
}
const p = out.plan;
console.log(`archive ${p.archive.length}${out.unusedHeld ? ` (${out.unusedHeld} unused note(s) held back by bc-ltgld)` : ''}`);
for (const a of p.archive) console.log(`  ${a.agent}.${a.key} — ${a.reason}`);
console.log(`promote ${p.promote.length}`);
for (const a of p.promote) console.log(`  ${a.agent}.${a.key} — ${a.reads} reads`);
console.log(`merge ${p.merge.length}`);
for (const t of p.merge) console.log(`  ${t.id} — ${t.keys.length} notes`);
console.log(`split ${p.split.length}`);
for (const t of p.split) console.log(`  ${t.id}`);
