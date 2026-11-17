#!/usr/bin/env node
/**
 * Link the Claude Code skills this checkout ships (skills/<name>/) into Claude Code.
 *
 *     node scripts/claude-skills.mjs              # link them
 *     node scripts/claude-skills.mjs --dry-run    # say what would change
 *     node scripts/claude-skills.mjs --replace    # move a same-named skill of your own aside first
 *     node scripts/claude-skills.mjs --uninstall  # remove only the links install made
 *
 * Run for you by `npm run install-service` and `npm run uninstall-service` (bc-eszkl).
 * Asks nothing. Re-running changes nothing. Rules: lib/claudeskills.js.
 *
 * Exit 2 when a skill could not be linked because something else is in its place;
 * install.sh warns and carries on, since a missing slash command is not an outage.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR } from '../lib/config.js';
import { installSkills, uninstallSkills, bundledSkills } from '../lib/claudeskills.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(`Link beadcause's Claude Code skills (${bundledSkills(ROOT).map((s) => `/${s.name}`).join(', ')}).

  node scripts/claude-skills.mjs              link them into $CLAUDE_CONFIG_DIR/skills and ~/.claude/skills
  node scripts/claude-skills.mjs --dry-run    print what would change
  node scripts/claude-skills.mjs --replace    move a same-named skill directory of your own aside first
  node scripts/claude-skills.mjs --uninstall  remove only the links install made`);
  process.exit(0);
}
const dryRun = argv.includes('--dry-run') || argv.includes('-n');
const say = (s) => console.log(`\x1b[1m==>\x1b[0m ${s}`);
const warn = (s) => console.error(`\x1b[33m warn\x1b[0m ${s}`);
const would = dryRun ? 'would ' : '';

if (argv.includes('--uninstall')) {
  const rows = uninstallSkills({ configDir: CONFIG_DIR, dryRun });
  if (!rows.length) say('no Claude Code skill links to remove');
  for (const r of rows) {
    if (r.action === 'removed') say(`${would}remove skill link ${r.dest}`);
    else if (r.action === 'kept') say(`kept ${r.dest} — ${r.reason}`);
  }
  process.exit(0);
}

let skipped = false;
for (const r of installSkills({ root: ROOT, configDir: CONFIG_DIR, replace: argv.includes('--replace'), dryRun })) {
  if (r.action === 'link') say(`${would}add the /${r.name} skill → ${r.dest}`);
  else if (r.action === 'repoint') say(`${would}re-point /${r.name} at this checkout (was ${r.from})`);
  else if (r.action === 'replace') say(`${would}move your ${r.dest} aside${r.movedTo ? ` to ${r.movedTo}` : ''} and link /${r.name}`);
  else if (r.action === 'skip') {
    skipped = true;
    warn(`/${r.name} not linked: ${r.dest} is ${r.reason}`);
  }
}
process.exit(skipped ? 2 : 0);
