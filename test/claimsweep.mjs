#!/usr/bin/env node
/**
 * A claim whose holder is gone goes back in the queue — and every other claim does not.
 *
 *     npm test
 *     node test/claimsweep.mjs
 *
 * bc-iaju1.3. `sweepStaleClaims` (lib/claimsweep.js) is driven here with a fake `bd`, the
 * way test/dupesweep.mjs drives `sweepDuplicates`: a write for what clears the bar, a row
 * in the answer rather than a throw for one `bd` rejects. The live-session and live-process
 * reads are the ones lib/advocate.js uses for the same question, so both are exercised —
 * `claudeSessions: false` switches the first off, and `ps` is injected for the second.
 *
 * The four refusals are the point of the file. Freeing a bead somebody is still on is the
 * expensive mistake (a second window on live work), so every guard gets its own check.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { sweepStaleClaims, KEEP_LABELS } = await import(path.join(HERE, '..', 'lib', 'claimsweep.js'));

let failures = 0;
let ran = 0;
const check = async (name, fn) => {
  ran += 1;
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n').slice(0, 5).join('\n      ')}`);
  }
};

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-19T12:00:00Z');
const ago = (hours) => new Date(NOW - hours * HOUR).toISOString();

/** A `bd` that records what it was told to do, and can be asked to refuse one write. */
const fakeBd = (rows, { refuse = null } = {}) => {
  const calls = [];
  return {
    calls,
    async listStatus(workspace, status) {
      calls.push(['listStatus', workspace, status]);
      return rows;
    },
    async comment(workspace, id) {
      calls.push(['comment', workspace, id]);
    },
    async reopenAbandoned(workspace, id) {
      calls.push(['reopenAbandoned', workspace, id]);
      if (refuse === id) throw new Error('bd: refused — the claim is held by another actor');
    },
  };
};

const bead = (id, over = {}) => ({ id, status: 'in_progress', labels: [], updated_at: ago(200), ...over });
/** No session records at all, and no `ps` output — nothing alive anywhere. */
const QUIET = { cfg: { claudeSessions: false }, ps: async () => '', now: NOW };
const freed = (out) => out.released.map((r) => r.id);
const why = (out, id) => out.kept.find((k) => k.id === id)?.why;

console.log('\na claim nobody is holding\n');

await check('a bead claimed and silent past the limit is commented and reopened', async () => {
  const bd = fakeBd([bead('bc-old')]);
  const out = await sweepStaleClaims(bd, ['demo'], QUIET);
  assert.deepEqual(freed(out), ['bc-old']);
  assert.deepEqual(
    bd.calls.map((c) => c[0]),
    ['listStatus', 'comment', 'reopenAbandoned'],
    'the note goes on before the claim comes off — a bead freed with no explanation is the thing this fixes'
  );
  assert.equal(out.released[0].idleHours, 200);
});

await check('several workspaces are each asked for their own in-progress beads', async () => {
  const bd = fakeBd([bead('bc-old')]);
  await sweepStaleClaims(bd, ['one', 'two'], QUIET);
  assert.deepEqual(
    bd.calls.filter((c) => c[0] === 'listStatus').map((c) => c[1]),
    ['one', 'two']
  );
});

console.log('\nand every claim that is not abandoned\n');

await check('a bead touched inside the limit is left alone', async () => {
  const bd = fakeBd([bead('bc-warm', { updated_at: ago(2) })]);
  const out = await sweepStaleClaims(bd, ['demo'], QUIET);
  assert.deepEqual(freed(out), []);
  assert.equal(why(out, 'bc-warm'), 'touched recently');
});

for (const label of KEEP_LABELS) {
  await check(`a bead labelled \`${label}\` is left alone however old — it is waiting on a merge, not on a session`, async () => {
    const bd = fakeBd([bead('bc-done', { labels: [label], updated_at: ago(900) })]);
    const out = await sweepStaleClaims(bd, ['demo'], QUIET);
    assert.deepEqual(freed(out), []);
  });
}

await check('a bead an advocate window holds is left alone', async () => {
  const bd = fakeBd([bead('bc-live')]);
  const out = await sweepStaleClaims(bd, ['demo'], { ...QUIET, held: new Set(['bc-live']) });
  assert.deepEqual(freed(out), []);
  assert.equal(why(out, 'bc-live'), 'an advocate window holds it');
});

await check('a bead a live process names on its argv is left alone — a session mid-suite has not renamed itself yet', async () => {
  const bd = fakeBd([bead('bc-busy')]);
  const ps = async () => `  ${process.pid} claude You are working bead **demo/bc-busy** — go\n`;
  const out = await sweepStaleClaims(bd, ['demo'], { ...QUIET, ps });
  assert.deepEqual(freed(out), []);
  assert.equal(why(out, 'bc-busy'), 'a live process names it');
});

await check('a bare id in some other command line is not a match — the argv check is workspace-qualified', async () => {
  const bd = fakeBd([bead('bc-busy')]);
  const ps = async () => `  ${process.pid} vim notes-about-bc-busy.md\n`;
  const out = await sweepStaleClaims(bd, ['demo'], { ...QUIET, ps });
  assert.deepEqual(freed(out), ['bc-busy']);
});

await check('a workspace given as a { name, dir } object still matches a live argv — cfg.workspaces holds objects, not strings', async () => {
  const bd = fakeBd([bead('bc-busy')]);
  const ps = async () => `  ${process.pid} claude You are working bead **demo/bc-busy** — go\n`;
  const out = await sweepStaleClaims(bd, [{ name: 'demo', dir: '/tmp/demo' }], { ...QUIET, ps });
  assert.deepEqual(freed(out), [], 'the qualified match has to survive a workspace object');
  assert.equal(why(out, 'bc-busy'), 'a live process names it');
});

console.log('\nand it never costs the caller an exception\n');

await check('a tracker that refuses the reopen leaves the bead claimed and sweeps on', async () => {
  const bd = fakeBd([bead('bc-a'), bead('bc-b')], { refuse: 'bc-a' });
  const lines = [];
  const out = await sweepStaleClaims(bd, ['demo'], { ...QUIET, onLog: (l) => lines.push(l) });
  assert.deepEqual(freed(out), ['bc-b'], 'the refusal must not stop the bead behind it');
  assert.ok(lines.some((l) => l.includes('bc-a') && l.includes('still claimed')), lines.join('\n'));
});

await check('a tracker that will not list is logged, not thrown', async () => {
  const bd = {
    async listStatus() {
      throw new Error('bd: database is locked');
    },
  };
  const lines = [];
  const out = await sweepStaleClaims(bd, ['demo'], { ...QUIET, onLog: (l) => lines.push(l) });
  assert.deepEqual(out.released, []);
  assert.ok(lines.some((l) => l.includes('could not list')), lines.join('\n'));
});

await check('hours: 0 turns the whole sweep off without reading anything', async () => {
  const bd = fakeBd([bead('bc-old')]);
  const out = await sweepStaleClaims(bd, ['demo'], { ...QUIET, hours: 0 });
  assert.deepEqual(out.released, []);
  assert.deepEqual(bd.calls, []);
});

console.log(failures ? `\n${failures}/${ran} failed\n` : `\n${ran}/${ran} passed\n`);
process.exit(failures ? 1 : 0);
