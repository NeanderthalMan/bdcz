#!/usr/bin/env node
/**
 * Pre-approve the `bd` commands agent sessions run, in Claude Code's user settings.
 *
 *     node scripts/claude-permissions.mjs              # merge the rules in
 *     node scripts/claude-permissions.mjs --dry-run    # say what would change
 *     node scripts/claude-permissions.mjs --uninstall  # take back what install added
 *
 * Run for you by `npm run install-service` and `npm run uninstall-service`. Asks nothing,
 * so it is safe with nobody at the terminal. Re-running adds nothing. What it allows, what
 * it leaves gated, and why it writes through symlinks: lib/claudeperms.js.
 *
 * Exit 2 when a settings file could not be read or written (it is left exactly as it
 * was); install.sh warns and carries on, because a prompt is an annoyance, not an outage.
 */
import { CONFIG_DIR } from '../lib/config.js';
import { BD_ALLOW_RULES, installRules, uninstallRules } from '../lib/claudeperms.js';

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(`Pre-approve the bd commands agent sessions run, in Claude Code's settings.

  node scripts/claude-permissions.mjs              merge the allow rules in
  node scripts/claude-permissions.mjs --dry-run    print what would change
  node scripts/claude-permissions.mjs --uninstall  remove only the rules install added

Writes $CLAUDE_CONFIG_DIR/settings.json and ~/.claude/settings.json (whichever exist),
through symlinks. Rules:
${BD_ALLOW_RULES.map((r) => `  ${r}`).join('\n')}`);
  process.exit(0);
}
const dryRun = argv.includes('--dry-run') || argv.includes('-n');
const say = (s) => console.log(`\x1b[1m==>\x1b[0m ${s}`);
const warn = (s) => console.error(`\x1b[33m warn\x1b[0m ${s}`);
const would = dryRun ? 'would ' : '';

let failed = false;
if (argv.includes('--uninstall')) {
  const results = uninstallRules({ configDir: CONFIG_DIR, dryRun });
  if (!results.length) say('no Claude Code allow rules to remove');
  for (const r of results) {
    if (r.error) {
      failed = true;
      warn(`left ${r.real} alone: ${r.error}`);
    } else {
      say(`${would}remove ${r.removed.length} bd allow rule(s) from ${r.real}`);
    }
  }
} else {
  for (const r of installRules({ configDir: CONFIG_DIR, dryRun })) {
    const where = r.path === r.real ? r.real : `${r.path} → ${r.real}`;
    if (r.error) {
      failed = true;
      warn(`left ${where} alone: ${r.error}`);
    } else if (r.added.length) {
      say(`${would}allow ${r.added.length} bd command(s) in ${where}`);
    } else {
      say(`bd commands already allowed in ${where}`);
    }
  }
}
process.exit(failed ? 2 : 0);
