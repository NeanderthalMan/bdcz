#!/usr/bin/env node
/**
 * Claim a bead for *this session* — the claim a handoff successor runs (bc-3jzrd).
 *
 *   node ~/projects/beadcause/bin/claim.js bc-x            # BEADS_DIR as this shell resolved it
 *   node ~/projects/beadcause/bin/claim.js -w delmar dv-x # a workspace from the config
 *
 * `bd update <id> --claim` cannot tell two of Adam's sessions apart — they are the same
 * actor — so two successors on one handoff both "claimed" it and both did the work. This
 * walks up to the `claude` process it was run from, claims the bead, and puts
 * `worked-by:<that pid>` on it; a second session then finds a live marker that is not its
 * own and is refused. See `claim` in lib/handsession.js.
 *
 * Exit 0: claimed (or already this session's). Exit 3: another live session has it —
 * stop, do not do the work here. Exit 1: anything else, nothing claimed.
 *
 * The actor is left exactly as this shell has it (`BEADS_ACTOR`), so the claim is the
 * session's own — the same one a bare `bd update --claim` would have written.
 */
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../lib/config.js';
import { beadRow } from '../lib/park.js';
import { claim, claudeAncestor, claudeSessions, handLabel, psRow } from '../lib/handsession.js';

const argv = process.argv.slice(2);
let wsName = '';
let id = '';
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '-w' || a === '--workspace') wsName = argv[++i] || '';
  else if (a === '-b' || a === '--bead') id = argv[++i] || '';
  else if (!a.startsWith('-') && !id) id = a;
}
if (!id) {
  console.error('usage: beadcause-claim [-w <workspace>] <bead>');
  process.exit(1);
}

const env = { ...process.env };
if (wsName) {
  const cfg = loadConfig();
  const ws = cfg.workspaces.find((w) => w.name === wsName);
  if (!ws) {
    console.error(`beadcause-claim: no workspace "${wsName}" — have ${cfg.workspaces.map((w) => w.name).join(', ')}`);
    process.exit(1);
  }
  env.BEADS_DIR = ws.dir;
}
let bdBin = 'bd';
try {
  bdBin = loadConfig().bdBin || 'bd';
} catch {
  // no config: plain `bd` on PATH, as the successor's own shell has it
}
const bd = (args) => execFileSync(bdBin, args, { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

const me = claudeAncestor(process.ppid, psRow);
if (!me) {
  console.error(`beadcause-claim: no claude process above this command, so there is no session to claim ${id} for.`);
  process.exit(1);
}

const result = claim(bd, id, me.pid, {
  row: beadRow(bd, id),
  reread: () => beadRow(bd, id),
  sessions: claudeSessions,
});

for (const n of result.notes) console.error(`  note: ${n}`);
if (result.refused) {
  console.error(`beadcause-claim: ${result.refused}`);
  process.exit(result.holder ? 3 : 1);
}
console.log(
  result.already ? `${id} is already this session's (${handLabel(me.pid)}) — claimed` : `claimed ${id} for this session (${handLabel(me.pid)})`
);
if (result.replaced.length) console.log(`  and took off the stale ${result.replaced.map(handLabel).join(', ')}`);
