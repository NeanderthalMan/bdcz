/**
 * The activities a merge-queue workflow calls — bc-x0mhc.
 *
 * `observe` is real and read-only (see observe.mjs). Every activity that would change
 * something — downmerge, open a window, raise a card, merge, close beads — is a
 * **recorder**: it writes what it would have done to a JSONL ledger and returns. None of
 * them has a code path to GitHub or the tracker.
 *
 * Each recorder is idempotent on a key the workflow chooses (workflow id + a sequence
 * number carried in workflow state), and checks the ledger for that key before writing.
 * That is the "did it already happen?" check a real version needs before opening an iTerm
 * window, because Temporal retries an activity whose completion it never heard about — the
 * worker can die after the window opened and before the result was reported.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Context } from '@temporalio/activity';
import { observeBead } from './observe.mjs';

export const LEDGER = process.env.SPIKE_LEDGER || path.join(os.homedir(), '.temporal-spike', 'shadow.jsonl');

function seen(key, file) {
  if (!fs.existsSync(file)) return false;
  // A linear scan is fine at spike volume; a real version keys a table.
  return fs.readFileSync(file, 'utf8').split('\n').some((line) => line.includes(`"key":${JSON.stringify(key)}`));
}

export function makeActivities({ ledger = LEDGER, observe = observeBead, failFirst = new Set() } = {}) {
  fs.mkdirSync(path.dirname(ledger), { recursive: true });

  const record = (kind) => async ({ key, beadId, pr, why = '', live = null }) => {
    const info = Context.current().info;
    // Test hook: fail the first attempt AFTER the side effect, which is exactly the
    // window-opened-but-result-lost case the key exists for.
    const already = seen(key, ledger);
    if (!already) {
      fs.appendFileSync(
        ledger,
        JSON.stringify({ key, at: new Date().toISOString(), would: kind, beadId, pr, why, live, attempt: info.attempt, workflowId: info.workflowExecution.workflowId }) + '\n'
      );
    }
    if (failFirst.has(kind) && info.attempt === 1) throw new Error(`injected failure after ${kind}`);
    return { recorded: !already };
  };

  return {
    observe: ({ beadId }) => observe(beadId),
    note: record('note'),
    downmerge: record('downmerge'),
    openResolver: record('open-resolver'),
    openReviewer: record('open-reviewer'),
    openAnswer: record('open-answer'),
    raiseCard: record('raise-card'),
    merge: record('merge'),
    closeBeads: record('close-beads'),
    agreement: record('agreement'),
  };
}
