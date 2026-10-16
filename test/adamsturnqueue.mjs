/**
 * The advocate opens no window on a bead lib/turn.js marks Adam's — bc-dgx7.194.
 *
 * bc-dgx7.193 shipped `turn()` and left the advocate out of it: eight sessions had opened
 * on a bead whose next move was Adam's and ended with a comment and no commits. The filter
 * is `withoutAdamsTurn`; it honours the two rules a `bd ready` row can answer (the `human`
 * label and an assignee of Adam) and holds the bead *visibly*, as `heldByAdam`, so a queue
 * emptied by it does not read as an idle advocate.
 *
 *     node test/adamsturnqueue.mjs
 *
 * Harness copied from test/owedqueue.mjs: `open` is injected, so no iTerm, no `bd`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp, quiesce, removeTree } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-adamsturn-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const SESSIONS = path.join(tmp, 'claude-sessions');
const REPO = path.join(tmp, 'projects', 'alpha');
fs.mkdirSync(SESSIONS, { recursive: true });
fs.mkdirSync(REPO, { recursive: true });

const { createAdvocates } = await import(LIB('advocate.js'));

/* ------------------------------------------------------------------ fixtures */

const OLD = '2020-01-01T00:00:00Z';
const bead = (id, title, over = {}) => ({
  id,
  title,
  priority: 2,
  issue_type: 'task',
  created_at: OLD,
  ...over,
});

/** One tick over a tracker that says what the case needs it to. */
async function tick({ ready = [], overrides = {}, psLines = async () => [] } = {}) {
  const dir = process.env.BEADCAUSE_CONFIG_DIR;
  // A clean slate per case; `quiesce` + `removeTree` per test/tmpadoption.mjs (bc-9d37.9).
  await quiesce();
  for (const f of fs.readdirSync(dir)) await removeTree(path.join(dir, f));

  const cfg = {
    projectRoot: path.join(tmp, 'projects'),
    fallbackWorkspace: 'other',
    claudeSessionsDir: SESSIONS,
    spaces: [],
    workspaces: [{ name: 'alpha', dir: path.join(os.homedir(), 'beads', 'alpha', '.beads') }],
    advocates: {
      enabled: true,
      workspaces: '*',
      maxWorkers: 3,
      settleSeconds: 0,
      launchCooldownSeconds: 0,
      propose: false,
      sessionLog: false,
      tidyWorktrees: false,
      respectQuietHours: false,
      ...overrides,
    },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2));

  const opened = [];
  const bd = {
    ready: async () => ready,
    listLabel: async () => [],
    show: async (_ws, id) => ({ id, status: 'in_progress' }),
    children: async () => [],
    listStatus: async () => [],
  };

  const advocates = createAdvocates(cfg, {
    bd,
    bus: { emit() {} },
    open: async (_cfg, _ws, b) => {
      opened.push(b.id);
      return { dir: REPO, mode: 'test', term: null };
    },
    psLines,
  });
  await advocates.tick();
  return { opened, card: advocates.snapshot().find((a) => a.workspace === 'alpha') };
}

const heldIds = (card) => card.heldByAdam.map((h) => h.id);
const whyFor = (card, id) => (card.heldByAdam.find((h) => h.id === id) || {}).why || '';

/* ------------------------------------------------------------------- harness */

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err && err.message ? err.message : String(err)).split('\n').join('\n       ')}`);
  }
}

/* ------------------------------------------------------------------ the cases */

await check('a bead assigned to Adam gets no window and is shown as held', async () => {
  const { opened, card } = await tick({ ready: [bead('x-1', 'Adam holds this', { assignee: 'adam' })] });
  assert.deepEqual(opened, []);
  assert.deepEqual(heldIds(card), ['x-1']);
  assert.match(whyFor(card, 'x-1'), /Adam's move/, `got: ${whyFor(card, 'x-1')}`);
});

await check('a bead labelled human gets no window', async () => {
  const { opened, card } = await tick({ ready: [bead('x-1', 'Handed back', { labels: ['human'] })] });
  assert.deepEqual(opened, []);
  assert.deepEqual(heldIds(card), ['x-1']);
});

await check('an adam bead is held while the rest of the queue is worked', async () => {
  const { opened, card } = await tick({
    ready: [
      bead('x-1', 'Adam holds this', { assignee: 'adam' }),
      bead('x-2', 'Ordinary work', { created_at: '2020-06-01T00:00:00Z' }),
    ],
  });
  assert.deepEqual(opened, ['x-2']);
  assert.deepEqual(heldIds(card), ['x-1']);
  assert.equal(card.queue, 1);
});

await check('an email assignee is a worker claim, not Adam', async () => {
  const { opened, card } = await tick({
    ready: [bead('x-1', 'Claimed by a worker', { assignee: 'neo@example.com' })],
  });
  assert.deepEqual(opened, ['x-1']);
  assert.deepEqual(heldIds(card), []);
});

await check('a Read card is not held on a row that carries no comments', async () => {
  const { opened, card } = await tick({ ready: [bead('x-1', 'Read: the design doc')] });
  assert.deepEqual(opened, ['x-1'], 'the docnotes rule needs comments this survey does not have');
  assert.deepEqual(heldIds(card), []);
});

await check('ordinary work is untouched', async () => {
  const { opened, card } = await tick({ ready: [bead('x-1', 'Nothing special')] });
  assert.deepEqual(opened, ['x-1']);
  assert.deepEqual(heldIds(card), []);
});

/* --------------------------------------------------------------------- report */

console.log(`\n${failures ? `${failures} of ${ran} checks failed` : `all ${ran} checks passed`}`);
try {
  await cleanupTmp(tmp);
} catch {
  /* a temp directory that will not go is not a failure of the thing under test */
}
process.exit(failures ? 1 : 0);
