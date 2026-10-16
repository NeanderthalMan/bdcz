/**
 * The Temporal worker for the merge-queue shadow — bc-x0mhc. Runs beside the daemon, not
 * inside it: the SDK's native core and its workflow bundler are not something to load into
 * the launchd process for a spike.
 *
 *   temporal server start-dev --db-filename ~/.temporal-spike/beadcause-mq.db --ip 127.0.0.1
 *   node spikes/temporal-mq/worker.mjs
 */
import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import { makeActivities, LEDGER } from './activities.mjs';

export const TASK_QUEUE = 'beadcause-mq-shadow';

export async function startWorker({ activities = makeActivities(), taskQueue = TASK_QUEUE, connection } = {}) {
  return Worker.create({
    connection: connection || (await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233' })),
    workflowsPath: fileURLToPath(new URL('./workflows.mjs', import.meta.url)),
    activities,
    taskQueue,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const worker = await startWorker();
  console.log(`[mq-shadow] worker on ${TASK_QUEUE}; ledger ${LEDGER}`);
  await worker.run();
}
