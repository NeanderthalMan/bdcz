/**
 * Replay every running shadow workflow's real history against the workflow code on disk —
 * bc-x0mhc. A non-determinism error here is a deploy that would wedge those workflows, so
 * this is the check to run before restarting the worker on changed workflow code.
 *
 *   node spikes/temporal-mq/replay.mjs
 */
import { fileURLToPath } from 'node:url';
import { Client, Connection } from '@temporalio/client';
import { Worker } from '@temporalio/worker';

const client = new Client({ connection: await Connection.connect({ address: process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233' }) });
const workflowsPath = process.env.SPIKE_WORKFLOWS || fileURLToPath(new URL('./workflows.mjs', import.meta.url));

const histories = client.workflow.list({ query: 'WorkflowType="prJourney" AND ExecutionStatus="Running"' }).intoHistories();
let ok = 0;
let bad = 0;
for await (const result of Worker.runReplayHistories({ workflowsPath }, histories)) {
  if (result.error) {
    bad++;
    console.log(`FAIL ${result.workflowId}: ${result.error.message.split('\n')[0]}`);
  } else ok++;
}
console.log(`${ok} replayed clean, ${bad} diverged`);
process.exit(bad ? 1 : 0);
