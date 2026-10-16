#!/usr/bin/env node
/**
 * Recovery testing (SOC 2 A1.3) as a command — where the restore log stands, and the bead
 * that owns the next restore.
 *
 *   beadcause-recovery [org]            one line overall, then one per in-scope component
 *   beadcause-recovery [org] --bead     the `bd create --due` line for the next restore test
 *   beadcause-recovery [org] --json     the payload rather than the rendering
 *
 * The log is the configured compliance subject's (`recovery` in the file
 * `compliance.subjects` names) — see `lib/recovery.js`. With no subject configured this says
 * so in one line and exits 0; a log that fails its checks is refused with every problem
 * named, exit 1.
 *
 * `--strict` exits 1 when the state is red — never run, last restore failed, or overdue —
 * so a readiness check can gate on it. That is the "fails when it has not run" the bead
 * asked for (bc-4r10.11): a subject with no restore logged is red, not empty.
 */
import { commandSubject, organisations } from '../lib/boundary.js';
import { line, recurringBead, registerProblems, status } from '../lib/recovery.js';

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const positional = argv.filter((a) => !a.startsWith('-'));

const USAGE = [
  'beadcause-recovery [org]           where the restore log stands, overall and per component',
  '',
  '  --bead     the bd create line for the bead that owns the next restore',
  '  --json     the payload rather than the rendering',
  '  --strict   exit 1 when no restore has run, the last one failed, or one is overdue',
  '',
  `  organisations with a subject loaded (compliance.subjects): ${organisations().join(', ') || '(none)'}`,
];

if (has('--help') || has('-h')) {
  console.log(USAGE.join('\n'));
  process.exit(0);
}

const picked = commandSubject('beadcause-recovery', positional[0] || null);
if (!picked.org) process.exit(picked.exit);
const org = picked.org;

const refused = registerProblems(org);
if (refused.length) {
  console.error(`beadcause-recovery: the restore log in ${org}'s subject does not pass —`);
  for (const p of refused) console.error(`  ${p}`);
  process.exit(1);
}

const s = status(org);
const bead = recurringBead(org, s);
const exit = has('--strict') && s.red ? 1 : 0;

if (has('--json')) {
  console.log(JSON.stringify({ org, ...s, bead }, null, 2));
  process.exit(exit);
}

/** Single quotes for a shell, so the printed line can be pasted as it stands. */
const quote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

if (has('--bead')) {
  console.log(
    `bd create --type task --title ${quote(bead.title)} --due ${bead.due} --description ${quote(bead.description)}`
  );
  process.exit(exit);
}

console.log(`${org}: ${s.state.toUpperCase()} — ${line(s)}`);
for (const c of s.components) {
  const when = c.last ? `last restored ${c.last}` : 'never restored';
  const failed = c.failed ? `, failed ${c.failed}` : '';
  const due = c.due ? `, due ${c.due}` : '';
  console.log(`  ${c.state.padEnd(11)} ${c.id} — ${when}${failed}${due}`);
}
process.exit(exit);
