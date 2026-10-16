/**
 * The shadow driver — bc-x0mhc. Watches the live merge queue and turns what it sees into
 * workflow starts and signals. It never writes to the tracker or GitHub.
 *
 * In a real version these signals come from the places that already know: the reviewer's
 * session when it writes its verdict, the phone tap when Adam answers a card, GitHub's
 * webhook when a check finishes. Here one poller stands in for all of them, which is why
 * it has to diff what it saw last time — the one piece of hand-rolled state the shadow
 * keeps outside Temporal.
 *
 *   node spikes/temporal-mq/shadow.mjs            # poll every 60s
 *   node spikes/temporal-mq/shadow.mjs --once     # one pass
 *   node spikes/temporal-mq/shadow.mjs --only bc-abc
 *   node spikes/temporal-mq/shadow.mjs --max 12   # follow at most 12 merge-beads
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, Connection } from '@temporalio/client';
import { listQueue, showBead } from './observe.mjs';
import { queueState, reviewState, MERGE_LABEL } from '../../lib/mergebead.js';
import { TASK_QUEUE } from './worker.mjs';

const STATE = process.env.SPIKE_DRIVER_STATE || path.join(os.homedir(), '.temporal-spike', 'driver.json');
const INTERVAL_MS = Number(process.env.SPIKE_INTERVAL_MS || 60000);

/** What the driver compares between passes. Pure, so the test can pin it. */
export function summarize(issue) {
  const labels = issue.labels || [];
  const q = queueState(issue);
  const r = reviewState(issue);
  return {
    status: issue.status,
    queued: labels.includes(MERGE_LABEL),
    carded: labels.includes('human') && !labels.includes(MERGE_LABEL),
    approved: !!q.approved,
    attempts: q.attempts || 0,
    refused: q.refused || null,
    verdict: r?.verdict || null,
    round: r?.round || 0,
    closeReason: issue.close_reason || '',
  };
}

/** Which signals a change from `was` to `now` should send. Pure. */
export function signalsFor(was, now) {
  if (!was) return [{ name: 'start' }];
  if (JSON.stringify(was) === JSON.stringify(now)) return [];
  const out = [];
  if (now.status === 'closed') return [{ name: 'liveOutcome', arg: { how: 'bead-closed', reason: now.closeReason } }];
  if (now.verdict !== was.verdict || now.round !== was.round) out.push({ name: 'reviewVerdict', arg: { verdict: now.verdict, round: now.round } });
  if (was.carded && (now.queued || (now.approved && !was.approved))) out.push({ name: 'humanAnswer', arg: { answer: 'merge' } });
  out.push({ name: 'poke' });
  return out;
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return {};
  }
}

export async function pass(client, seen, { only = null, max = Infinity, log = console.log } = {}) {
  const ids = new Set(Object.keys(seen).filter((id) => !only || id === only));
  // A cap on how many the shadow follows, so it does not double the daemon's `gh` traffic.
  for (const id of only ? [only] : await listQueue()) if (!ids.has(id) && ids.size < max) ids.add(id);
  for (const id of ids) {
    let now;
    try {
      now = summarize(await showBead(id));
    } catch (err) {
      log(`[mq-shadow] ${id}: cannot read (${String(err.message).split('\n')[0]})`);
      continue;
    }
    const workflowId = `mq-${id}`;
    for (const sig of signalsFor(seen[id], now)) {
      try {
        if (sig.name === 'start') {
          if (now.status === 'closed') break;
          await client.workflow.signalWithStart('prJourney', {
            workflowId,
            taskQueue: TASK_QUEUE,
            args: [{ beadId: id }],
            signal: 'poke',
          });
          log(`[mq-shadow] ${id}: shadowing`);
        } else {
          await client.workflow.getHandle(workflowId).signal(sig.name, sig.arg);
          if (sig.name !== 'poke') log(`[mq-shadow] ${id}: ${sig.name} ${JSON.stringify(sig.arg || {})}`);
        }
      } catch (err) {
        // A workflow that already finished is not an error for the shadow.
        if (!/not found|already completed/i.test(String(err.message))) log(`[mq-shadow] ${id}: ${sig.name} failed: ${err.message}`);
      }
    }
    if (now.status === 'closed') delete seen[id];
    else seen[id] = now;
  }
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(seen, null, 2));
  return seen;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const client = new Client({ connection: await Connection.connect({ address: process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233' }) });
  const max = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : Infinity;
  const seen = load();
  do {
    await pass(client, seen, { only, max });
    if (args.includes('--once')) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  } while (true);
  process.exit(0);
}
