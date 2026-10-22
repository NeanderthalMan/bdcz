#!/usr/bin/env node
/**
 * `b7e-cards` — which of the cards a round bead is waiting on moved since the last round,
 * and what they now say.
 *
 *     b7e-cards -w delmar -b dv-5eu.186
 *     b7e-cards -w delmar -b dv-5eu.186 --since 2026-10-18T12:00:00Z
 *     b7e-cards -w delmar -b dv-5eu.186 --ids dv-a,dv-b --json
 *
 * bc-xl7n.202: seven sessions each hand-wrote a different loop over a "Cards to act on if
 * answered:" list; two printed no comments, so a comment left on a still-open card was
 * missed. The reading is in lib/cards.js — argv and printing here.
 *
 * Exit codes: `0` ran, whatever the verdicts; `2` bad usage; `4` unknown workspace or
 * bead; `1` the tracker could not be read (a lock, a timeout) — kept apart from `4`
 * so a transient failure is never reported as "not found" (bc-dgx7.109).
 *
 * Read-only: `bd show` for the round bead and its predecessor, `bd show --include-comments`
 * per card, plus state.json's `answered` map. Never a write.
 *
 * @grant read
 */
import { loadConfig, loadState } from '../lib/config.js';
import { Bd } from '../lib/bd.js';
import { cardsReport, isAgentAuthor } from '../lib/cards.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const value = (...names) => {
  for (const f of names) {
    const inline = argv.find((a) => a.startsWith(`${f}=`));
    if (inline) return inline.slice(f.length + 1);
    const at = argv.indexOf(f);
    if (at > -1) return argv[at + 1];
  }
  return undefined;
};

const USAGE = `usage: b7e-cards -w <workspace> -b <round-bead> [--since <iso|last-round>] [--ids <id,...>] [--json]

One line per card the round bead is waiting on: id, status, title, updated_at, and MOVED
when it changed since --since — a new comment counts, so a card still open but commented on
is MOVED. Each MOVED card then shows its newest non-agent comment and any chosen decision
option. Ends with "N answered, M moved, K untouched".

  -w, --workspace <name>   which tracker (required)
  -b, --bead <id>          the round bead (required)
  --since <iso|last-round> the cut-off; default last-round = the close time of the bead this
                            one is the remainder of, or was discovered-from
  --ids <id,...>           the cards, instead of reading them off the bead's description
                            ("Cards to act on" / "Read … first" lines) and blocking deps
  --json                   machine-readable`;

if (has('--help') || has('-h')) {
  console.log(USAGE);
  process.exit(0);
}

function fail(msg, code = 2) {
  console.error(`b7e-cards: ${msg}`);
  process.exit(code);
}

const wsName = value('-w', '--workspace');
const beadId = value('-b', '--bead');
if (!wsName) fail(`-w/--workspace is required\n${USAGE}`);
if (!beadId) fail(`-b/--bead is required\n${USAGE}`);
const ids = (value('--ids') || '').split(',').map((s) => s.trim()).filter(Boolean);

const cfg = loadConfig();
const ws = cfg.workspaces.find((w) => w.name === wsName);
if (!ws) fail(`no workspace named "${wsName}"\nconfigured workspaces: ${cfg.workspaces.map((w) => w.name).join(', ') || 'none'}`, 4);

const bd = new Bd({ bin: cfg.bdBin, actor: cfg.actor, sharedServer: cfg.sharedServer, me: cfg.me, accounts: cfg.accounts });
let report;
try {
  report = await cardsReport(bd, ws, beadId, {
    since: value('--since'),
    ids,
    answered: loadState().answered || {},
    isAgent: isAgentAuthor(cfg.actor),
  });
} catch (err) {
  const msg = String(err?.message || err).split('\n')[0];
  if (/^--since/.test(msg)) fail(msg);
  if (/no issues? found/i.test(msg)) fail(`${ws.name} has no bead ${beadId}: ${msg}`, 4);
  fail(`${ws.name} could not be read for ${beadId} — a tracker failure (lock/timeout?), not "not found": ${msg}`, 1);
}
if (report.missing) fail(`${ws.name} has no bead ${beadId}`, 4);

if (has('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const amber = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const clip = (s, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

console.log(`b7e-cards ${beadId} · ${ws.name} · since ${report.since.at || 'unknown'}${report.since.from ? ` (${report.since.from})` : ''}`);
if (report.since.note) console.log(amber(`  ${report.since.note} — nothing below can be judged MOVED`));
console.log('');
for (const c of report.cards) {
  if (c.error) {
    console.log(red(`${c.id}  ${c.missing ? 'not found' : 'tracker error, not a verdict'}: ${c.error}`));
    continue;
  }
  console.log(`${c.id}  ${c.status}  ${c.title}  ${dim(c.updatedAt || '')}${c.moved ? `  ${amber('MOVED')}` : ''}`);
  if (!c.moved) continue;
  if (c.chosenOption) console.log(`    chose: ${c.chosenOption.label} [${c.chosenOption.id}]`);
  const h = c.newestHumanComment;
  if (h) console.log(`    ${c.humanCommentIsNew ? '' : dim('(older) ')}${h.author || '?'} ${dim(h.at || '')}: ${clip(h.text)}`);
  else if (c.newestComment) console.log(`    newest comment is an agent's — ${c.newestComment.author || '?'} ${dim(c.newestComment.at || '')}`);
}
const s = report.summary;
console.log(`\n${s.answered} answered, ${s.moved} moved, ${s.untouched} untouched${s.unread ? red(`, ${s.unread} unread`) : ''}`);
