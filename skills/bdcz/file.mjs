#!/usr/bin/env node
/**
 * The one command behind `/bdcz` — file a bead in a beadcause workspace from any session.
 *
 *   node ~/.claude/skills/bdcz/file.mjs --title '…' [--type task] [--priority 2]
 *        [--body-file desc.md] [--label x]… [--dep discovered-from:bc-x]… [--parent bc-y]
 *        [-w beadcause] [--dry-run]
 *
 * bc-eszkl. The skill directory is a symlink into this checkout (install-service puts it
 * there, lib/claudeskills.js), and node resolves a symlinked entry point to its real path,
 * so the imports below land in this checkout's lib/ wherever the skill was called from.
 *
 * Why `Bd.create` and not a bare `bd create`, and why not `beadcause-file`:
 *
 * - **Not bare `bd`.** `BEADS_DIR` follows the caller's working directory, so a session in
 *   another repo would file into that repo's graph. `Bd.run` spawns `bd` with the
 *   workspace's own directory from config, whatever the caller's cwd. It also stamps
 *   this Mac's `owner:` label on a root (an epic or a P0), the way a bead filed from the
 *   phone gets one, so nothing personal is written into the skill.
 * - **Not `beadcause-file`.** That is the path for work *an agent* decided on: it stamps
 *   `unendorsed` and `agent-filed` and clamps the priority. `/bdcz` is the person asking,
 *   so the bead is ordinary work the moment it exists. `labels` is passed explicitly
 *   because `Bd.create` otherwise defaults it to `['human']`, which would make the bead a
 *   question addressed to you instead of work.
 *
 * Prints the new id on stdout and nothing else there. Exit 1 on a usage error, 2 when the
 * workspace is not configured, 3 when bd refused the create.
 */
import fs from 'node:fs';
import { loadConfig } from '../../lib/config.js';
import { Bd } from '../../lib/bd.js';

const TYPES = ['task', 'bug', 'feature', 'epic', 'chore'];
const USAGE = `usage: file.mjs --title <title> [--type ${TYPES.join('|')}] [--priority 0-4]
                [--body-file <path> | --description <text>] [--label <l>]...
                [--dep <type:id>]... [--parent <id>] [-w <workspace>] [--dry-run]`;

export function parseArgs(argv) {
  const out = { workspace: 'beadcause', type: 'task', priority: 2, labels: [], deps: [], body: '', parent: '', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--title' || a === '-t') out.title = val();
    else if (a === '--type') out.type = val();
    else if (a === '--priority' || a === '-p') out.priority = Number(String(val()).replace(/^P/i, ''));
    else if (a === '--body-file') out.body = fs.readFileSync(val(), 'utf8').trim();
    else if (a === '--description' || a === '-d') out.body = val();
    else if (a === '--label' || a === '-l') out.labels.push(...val().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--dep') out.deps.push(val());
    else if (a === '--parent') out.parent = val();
    else if (a === '-w' || a === '--workspace') out.workspace = val();
    else if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (out.help) return out;
  if (!out.title || !out.title.trim()) throw new Error('--title is required');
  if (!TYPES.includes(out.type)) throw new Error(`--type must be one of ${TYPES.join(', ')}`);
  if (!Number.isInteger(out.priority) || out.priority < 0 || out.priority > 4) throw new Error('--priority must be 0-4');
  return out;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`bdcz: ${e.message}\n${USAGE}`);
    process.exit(1);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const cfg = loadConfig();
  const ws = cfg.workspaces.find((w) => w.name === opts.workspace);
  if (!ws) {
    console.error(`bdcz: no workspace named "${opts.workspace}" — configured: ${cfg.workspaces.map((w) => w.name).join(', ') || 'none'}`);
    process.exit(2);
  }
  const bead = { title: opts.title.trim(), body: opts.body, type: opts.type, priority: opts.priority, labels: opts.labels, deps: opts.deps, parent: opts.parent };
  if (opts.dryRun) {
    console.error(`bdcz: would file in ${ws.name} (${ws.dir}):`);
    console.error(JSON.stringify(bead, null, 2));
    return;
  }
  const bd = new Bd({ bin: cfg.bdBin, actor: cfg.actor, sharedServer: cfg.sharedServer, me: cfg.me, accounts: cfg.accounts });
  try {
    const id = await bd.create(ws, bead);
    if (!id) throw new Error('bd returned no id');
    console.log(id);
  } catch (e) {
    console.error(`bdcz: ${e.message}`);
    process.exit(3);
  }
}

// Run only as a command, so the test can import parseArgs.
if (import.meta.url === `file://${fs.realpathSync(process.argv[1] || '')}`) await main();
