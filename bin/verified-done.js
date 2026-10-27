#!/usr/bin/env node
/**
 * Record that a bead's whole deliverable is already true, and leave the close to the advocate.
 *
 *   beadcause-verified-done -w delmar -b dv-8zav <<'EOF'
 *   pr.basePerWorkspace={delmar:main} has been in place since 2026-09-12; gh pr list shows
 *   every PR from #114 to #877 targeting main.
 *   EOF
 *
 * The fifth honest ending, for the bead with no diff: `bin/deliver.js` refuses a branch with no
 * commits, and `bd close` from a worker's own shell is refused by the auto-mode permission
 * classifier, so a worker that finds the work already done used to re-verify it and stop, window
 * after window (bc-xl7n.193). This writes the evidence as a comment and the `verified-done` label;
 * the advocate's next tick reads both and performs the close (lib/verifieddone.js has the design).
 *
 * The body piped in is not optional — it is the whole of the case for closing with nothing to
 * merge, and a label with no evidence behind it closes nothing. Prints what it did and exits
 * non-zero when nothing was written.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../lib/config.js';
import { beadRow } from '../lib/park.js';
import { mark, VERIFIED_LABEL } from '../lib/verifieddone.js';
import { bylineFor } from '../lib/byline.js';
import { cfgForWorkspace } from '../lib/accounts.js';

function arg(...names) {
  for (const n of names) {
    const i = process.argv.indexOf(n);
    if (i > -1) return process.argv[i + 1];
  }
  return undefined;
}

const cfg = loadConfig();
const wsName = arg('-w', '--workspace') || cfg.workspaces[0]?.name;
const id = arg('-b', '--bead', '--id');
const file = arg('-f', '--file');

const ws = cfg.workspaces.find((w) => w.name === wsName);
if (!ws || !id) {
  console.error('usage: beadcause-verified-done -w <workspace> -b <bead> [-f evidence.md]   (evidence on stdin)');
  console.error(`workspaces: ${cfg.workspaces.map((w) => w.name).join(', ')}`);
  process.exit(1);
}

const evidence = (file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8')).trim();

const byline = bylineFor(cfgForWorkspace(cfg, ws));
const bd = (args) =>
  execFileSync(cfg.bdBin, [...args, '--actor', byline], {
    env: { ...process.env, BEADS_DIR: ws.dir, BEADS_ACTOR: byline },
    cwd: ws.dir,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

const result = mark(bd, id, evidence, { row: evidence ? beadRow(bd, id) : null });
if (result.refused) {
  console.error(`beadcause-verified-done: ${result.refused}`);
  process.exit(1);
}
if (result.alreadyMarked) {
  console.log(result.notes[0]);
  process.exit(0);
}

console.log(`marked ${id} ${VERIFIED_LABEL}, with your evidence as a comment`);
if (result.reopened) console.log('  and set it back to open');
for (const note of result.notes) console.log(`  note: ${note}`);
console.log(`  the advocate closes ${id} on its next tick — do not run \`bd close\` yourself, the classifier refuses it.`);
