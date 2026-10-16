#!/usr/bin/env node
/**
 * What each of the two ways out of a card is allowed to write.
 *
 *     npm test
 *     node test/closepaths.mjs
 *
 * They are not the same act, and the whole history here is of them being treated as
 * one:
 *
 *   - **Answering** closes the bead, so it has to ask bd's gate first — a bead
 *     blocked by open dependencies, or an epic with open children, cannot be
 *     closed, and finding that out *after* the comment is what put the same answer
 *     on five beads two and three times over. Since bc-0823a such a gate no longer
 *     refuses the answer: it is written, `human` comes off, and the close is skipped.
 *   - **Dismissing closes nothing.** It used to, which was both a promise bd would
 *     refuse and the wrong intent: "I am not dealing with this now" is not "this is
 *     decided", and the card you most want gone — an epic with thirty open children
 *     — is the one bd will least let you close. So it writes your note if you typed
 *     one, writes *nothing at all* if you did not, and never touches the status.
 *
 * `test/closegate.mjs` proves `Bd.closeGate` answers correctly. This proves the
 * endpoints do the right thing with the answer, which is a different claim and the
 * one that kept breaking — the gate was correct the whole time `/api/dismiss` was
 * not calling it, and the browser check could not see that either, because its
 * fixture supplies the response itself.
 *
 * The real `bd` is never run: `cfg.bdBin` points at a fake that records every
 * invocation, so "wrote nothing" is checked against the argv it would have used
 * rather than against a tracker.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers/net.mjs';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (f) => path.join(HERE, '..', 'lib', f);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-closepaths-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

let failures = 0;
let ran = 0;
const ok = (name) => {
  ran += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
};
const bad = (name, detail) => {
  ran += 1;
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (fn, name) => {
  try {
    fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};
/** The same, for an assertion that has to sweep the inbox to make it. */
const checkAsync = async (fn, name) => {
  try {
    await fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};

/* -------------------------------------------------------------- the fake bd */

// Every call is appended to this file, one argv per line. `show` answers with an
// issue carrying one still-open `blocks` dependency, which is the sorrel case
// (sp-hz3.5) and exactly what bd refuses to close.
const CALLS = path.join(tmp, 'calls.log');
const FAKE = path.join(tmp, 'bd');
fs.writeFileSync(
  FAKE,
  `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify(args) + '\\n');
if (args[0] === 'show') {
  process.stdout.write(JSON.stringify([{
    id: args[1], issue_type: 'task', status: 'open', title: 'Gated', comment_count: 0,
    dependencies: [{ id: 'zz-9', status: 'open', title: 'Still open', dependency_type: 'blocks' }],
  }]));
  process.exit(0);
}
// The inbox itself. Two questions, so "the dismissed one leaves" can be told apart
// from "the sweep returned nothing".
if (args[0] === 'human' && args[1] === 'list') {
  process.stdout.write(JSON.stringify([
    { id: 'zz-1', title: 'The gated one', status: 'open', priority: 1, issue_type: 'task', labels: ['human'], description: '' },
    { id: 'zz-2', title: 'An ordinary one', status: 'open', priority: 2, issue_type: 'task', labels: ['human'], description: '' },
  ]));
  process.exit(0);
}
if (args[0] === 'comments') { process.stdout.write('[]'); process.exit(0); }
// A close here would be the bug: bd refuses this one, loudly.
if (args[0] === 'close') {
  process.stderr.write('cannot close ' + args[1] + ': blocked by open issues [zz-9] (use --force to override)');
  process.exit(1);
}
process.stdout.write('[]');
`,
  { mode: 0o755 }
);

const calls = () =>
  fs.existsSync(CALLS)
    ? fs
        .readFileSync(CALLS, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const reset = () => fs.writeFileSync(CALLS, '');
/** Did bd get told to write anything? `show`/`comments` are reads. */
const writes = () => calls().filter((a) => ['comment', 'close', 'update', 'create', 'label'].includes(a[0]));

/* ----------------------------------------------------------------- the app */

const ws = path.join(tmp, 'ws');
fs.mkdirSync(path.join(ws, '.beads'), { recursive: true });

const cfg = {
  port: 0,
  host: '127.0.0.1',
  baseUrl: 'http://127.0.0.1',
  token: 'closepaths-token',
  actor: 'beadcause-test',
  bdBin: FAKE,
  workspaces: [{ name: 'demo', dir: ws }],
  openSessions: false,
  autoDispatch: false,
  claudeSessions: false,
  pollSeconds: 3600,
  terminal: false,
  ntfy: { enabled: false },
  advocates: { enabled: false, workspaces: [] },
};

const { createApp, listen } = await import(LIB('server.js'));

const app = createApp(cfg);
const servers = listen(cfg, app.handler);
const port = await boundPort(servers);

const call = (pathname, body) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-beadcause-token': cfg.token,
        },
      },
      (res) => {
        let out = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(out || '{}') }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

console.log('\nclose paths\n');

/* ------------------------------------------------------------------ answer */

// bc-0823a: a gate about the bead's unfinished work no longer refuses the *answer*. It
// used to be a 409 with nothing written, which left the card with no answer button and
// sitting in the inbox for good. Now the answer lands, the question leaves the inbox,
// and the bead is left open — still never a close, which bd would refuse.
reset();
const answered = await call('/api/respond', { workspace: 'demo', id: 'zz-1', response: 'Do your best' });
check(() => assert.equal(answered.status, 200, JSON.stringify(answered.json)), '/api/respond answers a bead bd will not close');
check(() => assert.equal(answered.json.closed, false), 'and says it did not close it');
check(() => assert.equal(answered.json.keptOpen, 'blocked by zz-9'), 'naming what it is waiting on');
check(
  () =>
    assert.deepEqual(
      writes().map((a) => a.slice(0, 2)),
      [
        ['comment', 'zz-1'],
        ['label', 'remove'],
      ],
      `bd was told to: ${JSON.stringify(writes())}`
    ),
  'writing the answer and taking `human` off — no close, no status or assignee write'
);
check(
  () => assert.match(writes()[0][2], /^Do your best\n\nAnswered and left open — zz-1 cannot close yet \(blocked by zz-9\)/),
  'and the thread says why the bead is still open'
);

// bc-xl7n.190: "the bead closes when that clears" has to be a promise something keeps.
// The answer owes the close, and while the gate stands the retry leaves it alone.
const { readOwed, sweepOwed } = await import(LIB('owed.js'));
check(() => {
  const rec = readOwed()['demo/zz-1'];
  assert.ok(rec, `nothing owed: ${JSON.stringify(readOwed())}`);
  assert.equal(rec.reason, 'Answered via Beadcause');
  assert.equal(rec.why, 'blocked by zz-9');
}, 'and owes the close, with the reason an answer closes with');
reset();
{
  const [r] = await sweepOwed(app.bd, cfg.workspaces);
  check(() => assert.equal(r?.status, 'blocked', JSON.stringify(r)), 'the retry leaves it alone while the gate stands');
  check(() => assert.ok(!writes().some((a) => a[0] === 'close'), JSON.stringify(writes())), 'without even attempting the close');
}

/* ----------------------------------------------------------------- dismiss */

// The bead you most want off the screen is the one bd will least let you close. It
// succeeds anyway now, because it is not a close.
reset();
const binned = await call('/api/dismiss', { workspace: 'demo', id: 'zz-1' });
check(() => assert.equal(binned.status, 200), 'dismissing a gated bead succeeds — it is not a close');
check(() => assert.equal(binned.json.closed, false), 'and says so: nothing was closed');
check(
  // The fixture is a blocked bead; `closegate.mjs` covers the epic wording. What is
  // asserted here is that the condition reaches the phone at all — the toast says
  // when the card comes back, and a dismissal that could not say would read as gone.
  () => assert.match(String(binned.json.until || ''), /blocked by zz-9/),
  'naming what it is waiting on, so the toast can say when it comes back'
);
check(
  () => assert.deepEqual(writes(), [], `bd was told to: ${JSON.stringify(writes())}`),
  'a wordless dismissal writes NOTHING to bd — no comment, and above all no close'
);

// The note is the one mark a dismissal leaves, and it is a comment, never a close.
reset();
const withNote = await call('/api/dismiss', { workspace: 'demo', id: 'zz-1', reason: 'Not until the children land' });
check(() => assert.equal(withNote.status, 200), 'a dismissal carrying a note succeeds too');
check(
  () => assert.deepEqual(writes().map((a) => a[0]), ['comment'], `bd was told to: ${JSON.stringify(writes())}`),
  'and writes the note as a comment — one write, and it is not a close'
);
check(
  () => assert.equal(writes()[0][2], 'Not until the children land'),
  'verbatim, with no "Dismissed via Beadcause" wrapper around it'
);

/* -------------------------------------------------- and the card actually goes */

const seen = async () => (await app.allQuestions()).map((r) => r.id);

await checkAsync(async () => {
  const ids = await seen();
  assert.ok(!ids.includes('zz-1'), `still in the inbox: ${ids.join(',')}`);
  assert.ok(ids.includes('zz-2'), `took the wrong one out: ${ids.join(',')}`);
}, 'the dismissed card leaves the inbox, and only that one');

// The gate it was waiting on clears — every child closed — and it comes back. This
// is the whole promise: setting aside is not losing, and a card that never returned
// would be the silent loss this app exists to prevent.
fs.writeFileSync(
  FAKE,
  fs.readFileSync(FAKE, 'utf8').replace(
    "dependencies: [{ id: 'zz-9', status: 'open', title: 'Still open', dependency_type: 'blocks' }],",
    'dependencies: [],'
  ),
  { mode: 0o755 }
);
await checkAsync(async () => {
  const ids = await seen();
  assert.ok(ids.includes('zz-1'), `did not come back: ${ids.join(',')}`);
}, 'and comes back when what it was waiting on clears');

// And the other half of bc-xl7n.190: with the gate clear, the owed close is made — the
// answer carried out, not asked again — and it stops being owed.
fs.writeFileSync(
  FAKE,
  fs
    .readFileSync(FAKE, 'utf8')
    // bd now takes the close, and a `show` afterwards has to say so — Bd.close reads the
    // row back and treats "exited 0, still open" as a close that did not happen.
    .replace(
      "process.stderr.write('cannot close ' + args[1] + ': blocked by open issues [zz-9] (use --force to override)');\n  process.exit(1);",
      `fs.writeFileSync(${JSON.stringify(path.join(tmp, 'closed'))}, '');\n  process.exit(0);`
    )
    .replace("status: 'open', title: 'Gated'", `status: fs.existsSync(${JSON.stringify(path.join(tmp, 'closed'))}) ? 'closed' : 'open', title: 'Gated'`),
  { mode: 0o755 }
);
reset();
{
  const [r] = await sweepOwed(app.bd, cfg.workspaces);
  check(() => assert.equal(r?.status, 'closed', JSON.stringify(r)), 'once the gate clears, the retry closes the answered bead');
  check(() => {
    const close = writes().find((a) => a[0] === 'close');
    assert.ok(close, `no close: ${JSON.stringify(writes())}`);
    assert.equal(close[1], 'zz-1');
    assert.ok(close.includes('Answered via Beadcause'), JSON.stringify(close));
  }, 'closing zz-1 with the answer as its reason');
  check(() => assert.ok(!writes().some((a) => a[0] === 'label' && a.includes('human')), JSON.stringify(writes())), 'and puts no card back in the inbox');
  check(() => assert.equal(readOwed()['demo/zz-1'], undefined), 'and owes nothing afterwards');
}

for (const s of servers || []) s.close?.();
await cleanupTmp(tmp);

console.log(failures ? `\n${failures}/${ran} failed\n` : `\n${ran}/${ran} passed\n`);
process.exit(failures ? 1 : 0);
