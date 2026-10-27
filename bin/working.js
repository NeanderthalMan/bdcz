#!/usr/bin/env node
/**
 * Say that a live session nobody briefed is working a bead, so no advocate opens a
 * worker window onto it.
 *
 *   beadcause-working -w beadcause -b bc-x              # from inside the session doing the work
 *   beadcause-working -w beadcause -b bc-x --pid 14758  # from a worker window that found it
 *   beadcause-working -w beadcause -b bc-x --release    # done early; let the queue have it back
 *
 * Writes the `worked-by:<pid>` label. `Bd.ready` keeps a marked bead out of every queue,
 * `openWorkSession` refuses it while that pid is a live `claude` process, and the advocate's
 * own sweep takes the marker off — no tap — once the process has exited. See
 * lib/handsession.js (bc-xl7n.156).
 *
 * With no `--pid` it walks up from itself to the nearest `claude` process and marks that
 * one — the session you are typing in. A worker window may not do that: the session it
 * would name is itself, which the idle sweep closes within minutes, and the loop this
 * exists to end would start again. A worker that found somebody else's session passes
 * that session's pid.
 *
 * `-m` adds a sentence to the comment. Prints what it did; exits non-zero only when
 * nothing was written.
 */
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../lib/config.js';
import { beadRow } from '../lib/park.js';
import { mark, handLabel, claudeAncestor, psRow, isBriefedArgs, asPid, HAND_PREFIX } from '../lib/handsession.js';
import { bylineFor } from '../lib/byline.js';

function arg(...names) {
  for (const n of names) {
    const i = process.argv.indexOf(n);
    if (i > -1) return process.argv[i + 1];
  }
  return undefined;
}
const flag = (n) => process.argv.includes(n);

const cfg = loadConfig();
const wsName = arg('-w', '--workspace') || cfg.workspaces[0]?.name;
const id = arg('-b', '--bead', '--id');
const pidArg = arg('--pid');
const note = String(arg('-m', '--message') || '').trim();
const release = flag('--release');

const ws = cfg.workspaces.find((w) => w.name === wsName);
if (!ws || !id) {
  console.error('usage: beadcause-working -w <workspace> -b <bead> [--pid <claude pid>] [-m "why"] [--release]');
  console.error(`workspaces: ${cfg.workspaces.map((w) => w.name).join(', ')}`);
  process.exit(1);
}

const byline = bylineFor(cfg);
const bd = (args) =>
  execFileSync(cfg.bdBin, [...args, '--actor', byline], {
    env: { ...process.env, BEADS_DIR: ws.dir, BEADS_ACTOR: byline },
    cwd: ws.dir,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

const row = beadRow(bd, id);

if (release) {
  const labels = (row?.labels || []).map(String).filter((l) => l.startsWith(HAND_PREFIX));
  if (!row || !labels.length) {
    console.log(`${id} carries no ${HAND_PREFIX} marker — nothing to do`);
    process.exit(0);
  }
  for (const label of labels) bd(['label', 'remove', id, label]);
  try {
    bd(['comment', id, `Released ${labels.join(', ')} by hand${note ? ` — ${note}` : ''}. This is ordinary work again.`]);
  } catch {
    // the label is what mattered
  }
  console.log(`released ${id} (${labels.join(', ')}) — it is back in the queue`);
  process.exit(0);
}

let pid = asPid(pidArg);
if (pidArg !== undefined && !pid) {
  console.error(`beadcause-working: ${pidArg} is not a pid — nothing was written`);
  process.exit(1);
}
if (!pid) {
  const me = claudeAncestor(process.ppid, psRow);
  if (!me) {
    console.error('beadcause-working: no claude process above this command, so there is nothing to mark. Pass --pid.');
    process.exit(1);
  }
  if (isBriefedArgs(me.args)) {
    console.error(
      `beadcause-working: this is a briefed worker window (pid ${me.pid}), and marking itself would hold ${id} only ` +
        `until the idle sweep closes it. Pass --pid with the pid of the session that is actually doing the work.`
    );
    process.exit(1);
  }
  pid = me.pid;
}

const result = mark(bd, id, pid, { row });
if (result.refused) {
  console.error(`beadcause-working: ${result.refused}`);
  process.exit(1);
}
if (result.alreadyMarked) {
  console.log(result.notes[0]);
  process.exit(0);
}

try {
  bd([
    'comment',
    id,
    `Being worked by a session nobody briefed — ${handLabel(pid)}. No advocate will open a window on it while that ` +
      `process lives; the marker comes off on its own once it exits.${note ? ` ${note}` : ''}`,
  ]);
} catch (err) {
  console.error(`beadcause-working: ${id} is marked, but the comment did not land (${String(err?.message || err).split('\n')[0]}).`);
}

console.log(`marked ${id} ${handLabel(pid)}`);
if (result.replaced) console.log(`  and took off the stale ${handLabel(result.replaced)}`);
if (result.released) console.log('  and released the claim — the marker is what holds it now');
for (const n of result.notes) console.log(`  note: ${n}`);
