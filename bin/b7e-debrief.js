#!/usr/bin/env node
/**
 * `b7e-debrief` — file a debrief from a file, not an inline argument.
 *
 *   b7e-debrief <path> [--bead <id>] [--agent <id>]
 *
 * bc-xl7n.172: `beadcause-memory debrief <text...>` takes its report only as literal
 * argv text, and the harness's own worktree sandbox guard refuses a Bash call the
 * moment that text contains a word like "git" — four loremia sessions (lm-52r.24,
 * lm-gr6.166, lm-5eu.77, lm-5eu.80) each hit this independently and worked around it a
 * different way, one of them losing a real finding doing it: lm-5eu.80's surviving
 * debrief ended up "test message only" after three refused attempts, and the discovery
 * it was trying to file (a claim-guard stale-lock bug) never made it in. A plain
 * literal file path is not text computed at runtime and is not itself the word the
 * guard pattern-matches against, so a session writes its report to a file with `Write`
 * and hands this command the path instead of typing the report on the command line.
 *
 * This is a thin wrapper over the same `debrief()` in lib/memory.js that
 * `beadcause-memory debrief` already calls — same store (`refs/beadcause/debrief`),
 * same staging-then-archive lifecycle. Nothing about *how* a debrief is written
 * changes, only how its text reaches this process.
 *
 * `--bead` and `--agent` resolve exactly as `beadcause-memory debrief` resolves them —
 * `$BEADCAUSE_BEAD`/`$BEADCAUSE_AGENT` first, stamped by whatever opened the session —
 * because an agent that could name either on the command line could misattribute a
 * report as easily as it could mistype one, and a human at a terminal is the one
 * caller who has neither and needs the flag.
 *
 * @grant write: appends one entry to refs/beadcause/debrief/<bead>, the same tier-4 store beadcause-memory debrief already writes
 */
import fs from 'node:fs';

import { debrief } from '../lib/memory.js';

const argv = process.argv.slice(2);

function fail(msg, code = 2) {
  console.error(`b7e-debrief: ${msg}`);
  process.exit(code);
}

const USAGE = `usage: b7e-debrief <path> [--bead <id>] [--agent <id>]

Files a report on the run you are in — the same store \`beadcause-memory debrief\`
writes, read from a file instead of an argv string, so a report containing a word the
worktree sandbox guard pattern-matches (e.g. "git") is never typed on the command line
at all.

  <path>          a markdown file to read the report from (repo- or worktree-relative)
  --bead <id>     which bead this is about (default: $BEADCAUSE_BEAD)
  --agent <id>    who is filing it (default: $BEADCAUSE_AGENT)`;

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

// A flag consumes the token after it unconditionally, so a value that happens to start
// with "-" (an odd path, an id) is still taken rather than mistaken for a flag of its
// own — the same trade the plain positional walk below makes for the path itself.
const FLAGS_WITH_VALUE = ['--bead', '--agent'];
const values = {};
const positionals = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const eq = FLAGS_WITH_VALUE.find((f) => a.startsWith(`${f}=`));
  if (eq) {
    values[eq] = a.slice(eq.length + 1);
    continue;
  }
  if (FLAGS_WITH_VALUE.includes(a)) {
    const next = argv[i + 1];
    if (next === undefined) fail(`${a} needs a value`);
    values[a] = next;
    i += 1;
    continue;
  }
  if (a.startsWith('-')) fail(`unknown flag "${a}"\n${USAGE}`);
  positionals.push(a);
}

if (positionals.length === 0) fail(`no path given\n${USAGE}`);
if (positionals.length > 1) fail(`expected exactly one path, got ${positionals.length}: ${positionals.join(', ')}\n${USAGE}`);
const [filePath] = positionals;

const bead = values['--bead'] || process.env.BEADCAUSE_BEAD || '';
if (!bead) {
  fail(
    'no bead — a debrief is filed against the work it is about, and this shell is not in a session; ' +
      'set BEADCAUSE_BEAD or pass --bead <id>. For something that outlives this run, use beadcause-memory note or remember instead'
  );
}

const agent = values['--agent'] || process.env.BEADCAUSE_AGENT || '';
if (!agent) fail('no agent — set BEADCAUSE_AGENT or pass --agent <id>');

let raw;
try {
  raw = fs.readFileSync(filePath, 'utf8');
} catch (err) {
  fail(`could not read ${filePath}: ${String(err?.message || err).split('\n')[0]}`);
}
const text = raw.trim();
if (!text) fail(`${filePath} is empty — a debrief with nothing in it is not a debrief`);

try {
  const r = await debrief(agent, bead, text);
  console.log(`debriefed ${r.bead} (${r.entries} this run) in ${r.repo} — ${Buffer.byteLength(raw, 'utf8')} bytes from ${filePath}`);
} catch (err) {
  fail(String(err?.message || err).split('\n')[0], 1);
}
