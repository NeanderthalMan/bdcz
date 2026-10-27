#!/usr/bin/env node
//
// A card can carry audio — a listening decision has an exhibit (bc-xl7n.167).
//
//     npm test
//     node test/assetaudio.mjs
//
// The bead's cost was concrete: a P1 that asks Adam to pick between three mixes by
// listening to six clips sat unanswerable for a week because /api/asset served images and
// documents only, and the workaround made every clip link-readable on a shared drive. Four
// things have to be true for that not to happen again, and each fails in a way that looks
// like something else:
//
// 1. **Every extension the card will play, /api/asset serves — and the reverse.** The
//    sorting rule lives in lib/decision.js (`AUDIO_EXT_RE`) and the serving rule in
//    lib/server.js (`AUDIO_EXT`), in two files with no import between them. An extension in
//    only the first is a player that draws and answers 415; in only the second, a clip a
//    `docs:` entry can name and the card cannot play. Checked against a live daemon.
// 2. **A range is answered as a range.** iOS Safari will not start an <audio> whose server
//    ignores `Range`, and every platform seeks with one. So 206 with the right
//    `content-range`, the right bytes, and `accept-ranges` on the plain 200 too — the header
//    is how the browser knows to ask.
// 3. **What is not a range is not an error.** Garbage, several ranges, another unit: a
//    complete 200. Only a start past the end of the file is a 416.
// 4. **A clip reaches the card as `audio`, whichever way it was written**, and never as a
//    `docs` link to the reader tab, which cannot play it.
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
const PUBLIC = (f) => path.join(HERE, '..', 'public', f);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-assetaudio-'));
// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const { parseDecision, AUDIO_EXT_RE } = await import(LIB('decision.js'));
const { createApp, listen, parseByteRange } = await import(LIB('server.js'));

let failures = 0;
let ran = 0;
const check = (fn, label) => {
  ran += 1;
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${label}\n       ${String(err.message).split('\n').join('\n       ')}`);
  }
};
const checkAsync = async (fn, label) => {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${label}\n       ${String(err.message).split('\n').join('\n       ')}`);
  }
};

/* ------------------------------------------------------------- the range parser */

check(() => {
  assert.deepEqual(parseByteRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange('bytes=500-', 1000), { start: 500, end: 999 });
  // The Safari opener: "bytes=0-1" to learn the type and length before anything else.
  assert.deepEqual(parseByteRange('bytes=0-1', 1000), { start: 0, end: 1 });
}, 'a bounded, an open-ended and a two-byte probe range are each resolved');

check(() => {
  // `-500` is the last five hundred bytes. Read as "0 to 500" it would serve the wrong
  // half of every clip whose index is at the end (an .m4a with the moov box last).
  assert.deepEqual(parseByteRange('bytes=-500', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-5000', 1000), { start: 0, end: 999 });
}, 'a suffix range counts from the end, and is clamped to the file');

check(() => {
  assert.deepEqual(parseByteRange('bytes=900-5000', 1000), { start: 900, end: 999 });
}, 'an end past the file is clamped, not refused');

check(() => {
  assert.deepEqual(parseByteRange('bytes=1000-', 1000), { unsatisfiable: true });
  assert.deepEqual(parseByteRange('bytes=5000-6000', 1000), { unsatisfiable: true });
  assert.deepEqual(parseByteRange('bytes=-0', 1000), { unsatisfiable: true });
  assert.deepEqual(parseByteRange('bytes=0-', 0), { unsatisfiable: true });
}, 'a start at or past the end is the one unsatisfiable case');

check(() => {
  for (const header of [undefined, '', 'bytes=', 'bytes=-', 'items=0-5', 'bytes=0-5,10-20', 'bytes=abc-def', 'bytes=9-3']) {
    assert.equal(parseByteRange(header, 1000), null, `${JSON.stringify(header)} is ignored, not answered`);
  }
}, 'no header, another unit, several ranges, text that is not a range and an inverted range are all "send the whole file"');

/* ------------------------------------------------- what a card writes → what it draws */

const block = (yaml) => parseDecision('Context.\n\n```decision\nquestion: Which mix?\n' + yaml + '```\n').decision;

check(() => {
  const d = block(
    'audio:\n  - label: Mix A, drums forward\n    path: /clips/a.m4a\n  - /clips/b.mp3\noptions:\n  - id: a\n    label: A\n'
  );
  assert.deepEqual(d.audio, [
    { label: 'Mix A, drums forward', path: '/clips/a.m4a' },
    { label: 'b.mp3', path: '/clips/b.mp3' },
  ]);
  assert.deepEqual(d.docs, []);
}, 'an `audio:` list keeps its labels, and a bare path is labelled by its file name');

check(() => {
  const d = block('docs:\n  - /notes/spec.md\n  - label: The loud one\n    path: /clips/loud.wav\n');
  assert.deepEqual(d.docs.map((x) => x.path), ['/notes/spec.md'], 'the document stays a reader-tab link');
  assert.deepEqual(d.audio, [{ label: 'The loud one', path: '/clips/loud.wav' }], 'the clip becomes a player');
}, 'a clip named under `docs:` is sorted out of it into the players');

check(() => {
  const d = block('docs:\n  - /notes/spec.md\n');
  assert.deepEqual(d.audio, []);
}, 'a card with no clips has an empty list, not a missing key');

check(() => {
  assert.ok(AUDIO_EXT_RE.test('/x/Mix.M4A'), 'case-insensitive, because a phone names its recordings in capitals');
  assert.ok(!AUDIO_EXT_RE.test('/x/mix.m4a.txt'));
  assert.ok(!AUDIO_EXT_RE.test('/x/notes.md'));
}, 'the sorting rule matches by the end of the name and not by a word in the middle of it');

check(() => {
  const app = fs.readFileSync(PUBLIC('app.js'), 'utf8');
  assert.match(app, /d\?\.audio\?\.length/, 'the card reads the list the parser now produces');
  assert.match(app, /<audio controls preload="none"/, 'and draws a native player that fetches nothing until pressed');
}, 'the card draws what the parser hands it');

/* ------------------------------------------------------------- the live daemon */

const assets = path.join(fs.realpathSync(tmp), 'assets');
fs.mkdirSync(assets, { recursive: true });

// 256 distinct bytes, so a served slice can be compared to exactly the slice it should be.
const BYTES = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
const clip = (name) => {
  const p = path.join(assets, name);
  fs.writeFileSync(p, BYTES);
  return p;
};

const cfg = {
  port: 0,
  host: '127.0.0.1',
  baseUrl: 'http://127.0.0.1',
  token: 'assetaudio-test-token',
  actor: 'beadcause-test',
  me: ['you@gmail.com'],
  workspaces: [{ name: 'beadcause', dir: path.join(tmp, 'beadcause', '.beads') }],
  assetRoots: [assets],
  openSessions: false,
  autoDispatch: false,
  claudeSessions: false,
  pollSeconds: 3600,
  terminal: false,
  ntfy: { enabled: false },
  advocates: { enabled: false, workspaces: [] },
};

const app = createApp(cfg);
const servers = listen(cfg, app.handler);
const port = await boundPort(servers);

const get = (file, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: `/api/asset?p=${encodeURIComponent(file)}`,
        headers: { 'x-beadcause-token': cfg.token, ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.end();
  });

const EXPECTED_TYPE = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
};

await checkAsync(async () => {
  for (const [ext, type] of Object.entries(EXPECTED_TYPE)) {
    const res = await get(clip(`clip.${ext}`));
    assert.equal(res.status, 200, `.${ext} is served`);
    assert.equal(res.headers['content-type'], type, `.${ext} carries the type a phone's <audio> accepts`);
    assert.deepEqual(res.body, BYTES);
  }
}, '/api/asset serves every audio type with a real content type, where it answered 415 before');

await checkAsync(async () => {
  // Both directions of "the two lists agree": anything the card would sort into a player is
  // served, and nothing served as sound is missing from the sorter.
  const probe = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'wma', 'aiff', 'mid', 'mp4', 'webm'];
  for (const ext of probe) {
    const res = await get(clip(`probe.${ext}`));
    const playable = AUDIO_EXT_RE.test(`probe.${ext}`);
    assert.equal(res.status === 200, playable, `.${ext}: served=${res.status === 200} but the card ${playable ? 'plays' : 'does not play'} it`);
    if (!playable) assert.equal(res.status, 415, `.${ext} is refused as an unsupported type`);
  }
}, 'what the card sorts into a player and what /api/asset serves are the same set');

await checkAsync(async () => {
  const plain = await get(clip('range.mp3'));
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['accept-ranges'], 'bytes', 'the plain 200 says ranges are welcome, which is how the browser knows to ask');
  assert.equal(plain.headers['content-length'], '256');

  const part = await get(clip('range.mp3'), { range: 'bytes=10-19' });
  assert.equal(part.status, 206);
  assert.equal(part.headers['content-range'], 'bytes 10-19/256');
  assert.equal(part.headers['content-length'], '10');
  assert.deepEqual(part.body, BYTES.subarray(10, 20));

  const tail = await get(clip('range.mp3'), { range: 'bytes=-16' });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers['content-range'], 'bytes 240-255/256');
  assert.deepEqual(tail.body, BYTES.subarray(240));

  const open = await get(clip('range.mp3'), { range: 'bytes=250-' });
  assert.equal(open.headers['content-range'], 'bytes 250-255/256');
  assert.deepEqual(open.body, BYTES.subarray(250));
}, 'a range request is answered 206 with the bytes it asked for and a content-range that says so');

await checkAsync(async () => {
  const past = await get(clip('range.mp3'), { range: 'bytes=256-' });
  assert.equal(past.status, 416);
  assert.equal(past.headers['content-range'], 'bytes */256');

  for (const range of ['bytes=0-5,10-20', 'lines=1-2', 'bytes=nonsense']) {
    const res = await get(clip('range.mp3'), { range });
    assert.equal(res.status, 200, `${range} is ignored`);
    assert.deepEqual(res.body, BYTES);
  }
}, 'past the end is a 416; a range that is not understood is a complete 200');

await checkAsync(async () => {
  // Range is on the route, not on the audio: an image opened on a phone is served the same
  // way, and the existing types must not have moved.
  fs.writeFileSync(path.join(assets, 'pic.png'), BYTES);
  const res = await get(path.join(assets, 'pic.png'));
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.deepEqual(res.body, BYTES);
}, 'an image is served as it was');

await checkAsync(async () => {
  const outside = path.join(tmp, 'outside.mp3');
  fs.writeFileSync(outside, BYTES);
  const res = await get(outside);
  assert.equal(res.status, 403, 'a clip outside assetRoots is refused like any other file');
}, 'audio is no way around the allow-list');

servers.forEach((s) => s.close());
app.stop?.();

cleanupTmp(tmp);

console.log(`\n${failures ? `${failures}/${ran} failed` : `${ran} checks passed`}`);
process.exit(failures ? 1 : 0);
