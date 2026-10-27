#!/usr/bin/env node
/**
 * `b7e-packets` and `lib/packets.js` — every artefact other beads left under
 * .claude/packets for a panel: shape, alpha, and where the bytes are. bc-xl7n.178.
 *
 *   node test/packets.mjs
 *
 * The images are built here, byte by byte, with node:zlib — no fixture files and no
 * interpreter. The rclone fetch is a stub that writes chosen bytes, and the one check
 * that runs the real command puts a fake rclone first on PATH so nothing reaches a
 * network.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { removeTreeSync } from './helpers/tmp.mjs';
import { fetchSidecars, jpegInfo, npyInfo, parseSidecar, pngCoverage, pngInfo, scanPackets } from '../lib/packets.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'b7e-packets');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-packets-'));
process.on('exit', () => removeTreeSync(tmp));

let n = 0;
const ok = (name, fn) => {
  try {
    fn();
  } catch (e) {
    e.message = `${name}: ${e.message}`;
    throw e;
  }
  n += 1;
};

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};
/** pixels(x, y) -> channel bytes; filterOf(y) picks the PNG row filter so every one is exercised. */
function png(w, h, colorType, pixels, filterOf = () => 0) {
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const rows = [];
  let prev = Buffer.alloc(w * ch);
  for (let y = 0; y < h; y += 1) {
    const cur = Buffer.alloc(w * ch);
    for (let x = 0; x < w; x += 1) Buffer.from(pixels(x, y)).copy(cur, x * ch);
    const f = filterOf(y);
    const enc = Buffer.alloc(w * ch);
    for (let i = 0; i < cur.length; i += 1) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      enc[i] = (cur[i] - pred) & 0xff;
    }
    rows.push(Buffer.concat([Buffer.from([f]), enc]));
    prev = cur;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
const npy = (dtype, shape) => {
  const dict = `{'descr': '${dtype}', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  const padded = dict.padEnd(118, ' ') + '\n';
  const head = Buffer.alloc(10);
  head.write('\x93NUMPY', 0, 'latin1');
  head[6] = 1;
  head.writeUInt16LE(padded.length, 8);
  return Buffer.concat([head, Buffer.from(padded, 'latin1')]);
};
const write = (repo, rel, data) => {
  const p = path.join(repo, '.claude', 'packets', rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---- header readers
ok('png header: size and mode for every colour type', () => {
  for (const [ct, mode] of [[0, 'L'], [2, 'RGB'], [4, 'LA'], [6, 'RGBA']]) {
    const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
    const info = pngInfo(png(5, 3, ct, () => new Array(ch).fill(1)));
    assert.deepEqual([info.width, info.height, info.mode], [5, 3, mode]);
  }
  assert.equal(pngInfo(Buffer.from('not a png at all, nowhere near')), null);
});

ok('png coverage: every filter type decodes to the same answer', () => {
  // A quarter of the pixels opaque, in a pattern Sub/Up/Average/Paeth all have to undo.
  const px = (x, y) => [x * 7, y * 5, x + y, (x + y) % 4 === 0 ? 255 : 0];
  for (let f = 0; f <= 4; f += 1) {
    assert.equal(pngCoverage(png(16, 12, 6, px, () => f)), 48 / 192, `filter ${f}`);
  }
  assert.equal(pngCoverage(png(4, 4, 6, () => [9, 9, 9, 0])), 0);
  assert.equal(pngCoverage(png(4, 4, 6, () => [0, 0, 0, 1])), 1);
});

ok('png coverage: L masks count nonzero, LA counts alpha, RGB has none', () => {
  assert.equal(pngCoverage(png(10, 10, 0, (x) => [x < 3 ? 255 : 0])), 0.3);
  assert.equal(pngCoverage(png(10, 10, 4, (x) => [200, x < 5 ? 255 : 0])), 0.5);
  assert.equal(pngCoverage(png(4, 4, 2, () => [1, 2, 3])), null);
});

ok('jpeg header: size and mode from the start-of-frame marker', () => {
  const sof = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xdc, 0x0a, 0xb4, 0x03]);
  const info = jpegInfo(Buffer.concat([sof, Buffer.alloc(20)]));
  assert.deepEqual([info.width, info.height, info.mode], [2740, 732, 'RGB']);
  assert.equal(jpegInfo(Buffer.from('nope')), null);
});

ok('npy header: dtype and shape without loading the array', () => {
  assert.deepEqual(npyInfo(npy('<f4', [1792, 2400])), { dtype: 'f4', shape: [1792, 2400] });
  assert.deepEqual(npyInfo(npy('|u1', [7])).shape, [7]);
  assert.equal(npyInfo(Buffer.from('plain text')), null);
});

ok('sidecar front matter: only a media-sidecar counts', () => {
  const fm = parseSidecar('---\nkind: media-sidecar\nremote: "gd:x/y.png"\nbytes: 12\nsha256: abc\n---\n\n# y\n');
  assert.deepEqual([fm.remote, fm.bytes, fm.sha256], ['gd:x/y.png', '12', 'abc']);
  assert.equal(parseSidecar('---\nkind: notes\n---\n'), null);
  assert.equal(parseSidecar('# just a note\n'), null);
});

// ---- the scan, against a fixture repo shaped like delmar's
const repo = path.join(tmp, 'repo');
const plate = png(8, 6, 2, () => [1, 2, 3]);
const bgBytes = Buffer.from('the real background bytes');
write(repo, 'b-one/P22_stage.png', plate);
write(repo, 'b-one/P22_hole_mask.png', png(8, 6, 0, (x) => [x < 2 ? 255 : 0]));
write(repo, 'b-one/P22_stage.depth.npy', Buffer.concat([npy('<f4', [6, 8]), Buffer.alloc(8)]));
write(repo, 'b-one/P22_note.manifest.json', '{}');
write(repo, 'b-one/run.log', 'not a plate');
write(repo, 'b-one/P23_other.png', plate);
write(repo, 'b-two/frag/P22_composed.png', png(8, 6, 6, (x) => [0, 0, 0, x < 4 ? 255 : 0]));
write(repo, 'b-two/frag/P22_wide.png', png(20, 6, 2, () => [1, 1, 1]));
write(
  repo,
  'b-two/frag/bg.png.md',
  `---\nkind: media-sidecar\nfilename: bg.png\nremote: "gdrive4t:media/b-two/frag/bg.png"\nbytes: ${bgBytes.length}\nsha256: ${sha(bgBytes)}\n---\n\n# bg.png\n`,
);
write(repo, 'b-three/elsewhere/bg.png.md', '---\nkind: media-sidecar\nremote: "gd:z"\nbytes: 1\nsha256: 00\n---\n');

const scan = scanPackets(repo, 'P22');
const byPath = Object.fromEntries(scan.rows.map((r) => [r.path, r]));

ok('scan: matches by file name across every packet dir, and only those', () => {
  assert.deepEqual(Object.keys(byPath).sort(), [
    'b-one/P22_hole_mask.png',
    'b-one/P22_note.manifest.json',
    'b-one/P22_stage.depth.npy',
    'b-one/P22_stage.png',
    'b-two/frag/P22_composed.png',
    'b-two/frag/P22_wide.png',
    'b-two/frag/bg.png',
  ]);
});

ok('scan: size, mode and alpha per row', () => {
  const stage = byPath['b-one/P22_stage.png'];
  assert.deepEqual([stage.width, stage.height, stage.mode, stage.coverage], [8, 6, 'RGB', null]);
  assert.equal(byPath['b-one/P22_hole_mask.png'].mode, 'L');
  assert.equal(byPath['b-one/P22_hole_mask.png'].coverage, 0.25);
  assert.equal(byPath['b-two/frag/P22_composed.png'].mode, 'RGBA');
  assert.equal(byPath['b-two/frag/P22_composed.png'].coverage, 0.5);
  const d = byPath['b-one/P22_stage.depth.npy'];
  assert.deepEqual([d.kind, d.width, d.height], ['npy', 8, 6]);
  assert.match(d.mode, /^f4\(6.*8\)$/);
  assert.equal(byPath['b-one/P22_note.manifest.json'].kind, 'json');
});

ok('scan: dominant canvas and who shares it', () => {
  assert.equal(scan.canvas, '8x6');
  assert.equal(byPath['b-one/P22_stage.png'].sharesCanvas, true);
  assert.equal(byPath['b-two/frag/P22_wide.png'].sharesCanvas, false);
  assert.equal(byPath['b-one/P22_note.manifest.json'].sharesCanvas, null);
});

ok('scan: a sidecar beside a matching file is listed as the file it stands for, not local', () => {
  const bg = byPath['b-two/frag/bg.png'];
  assert.equal(bg.kind, 'sidecar');
  assert.equal(bg.present, false);
  assert.equal(bg.remote, 'gdrive4t:media/b-two/frag/bg.png');
  assert.equal(bg.sha256, sha(bgBytes));
  assert.equal(bg.bytes, bgBytes.length);
  assert.equal(byPath['b-three/elsewhere/bg.png'], undefined, 'a sidecar with no matching neighbour is not this panel');
});

ok('scan: --beads narrows to the named packet dirs; --no-alpha skips decoding', () => {
  const only = scanPackets(repo, 'P22', { beads: ['b-two'], alpha: false });
  assert.ok(only.rows.every((r) => r.bead === 'b-two'));
  assert.equal(only.rows.find((r) => r.mode === 'RGBA').coverage, null);
  assert.deepEqual(scanPackets(repo, 'P99').rows, []);
  assert.deepEqual(scanPackets(path.join(tmp, 'no-such-repo'), 'P22').rows, []);
});

// ---- fetch
ok('fetch: writes under the directory, checks the sha, and does not fetch twice', () => {
  const dir = path.join(tmp, 'out');
  const calls = [];
  const rclone = (remote, dest) => {
    calls.push([remote, dest]);
    fs.writeFileSync(dest, bgBytes);
  };
  const res = fetchSidecars(scan.rows, dir, { rclone });
  assert.equal(res.length, 1);
  assert.equal(res[0].status, 'ok');
  assert.equal(res[0].dest, path.join(dir, 'b-two/frag/bg.png'));
  assert.deepEqual(calls, [['gdrive4t:media/b-two/frag/bg.png', res[0].dest]]);
  assert.equal(fetchSidecars(scan.rows, dir, { rclone })[0].status, 'cached');
  assert.equal(calls.length, 1);
});

ok('fetch: wrong bytes, a failing rclone, a bad remote and a missing sha all fail loudly', () => {
  const row = { ...byPath['b-two/frag/bg.png'] };
  const dir = path.join(tmp, 'out2');
  const never = () => assert.fail('rclone ran');
  const wrong = fetchSidecars([row], dir, { rclone: (r, d) => fs.writeFileSync(d, 'other') });
  assert.equal(wrong[0].status, 'failed');
  assert.match(wrong[0].error, /sha256 mismatch/);
  const boom = fetchSidecars([row], path.join(tmp, 'out3'), {
    rclone: () => {
      throw Object.assign(new Error('x'), { stderr: 'Failed to create file system\nmore' });
    },
  });
  assert.match(boom[0].error, /fetch failed: Failed to create file system/);
  assert.match(fetchSidecars([{ ...row, remote: '--evil' }], dir, { rclone: never })[0].error, /no usable remote/);
  assert.match(fetchSidecars([{ ...row, sha256: null }], dir, { rclone: never })[0].error, /no sha256/);
  assert.match(fetchSidecars([{ ...row, path: '../../escape.png' }], dir, { rclone: never })[0].error, /escapes/);
});

// ---- the command
const fakeBin = path.join(tmp, 'fakebin');
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, 'rclone'), '#!/bin/sh\necho "Failed to create file system: no remote" >&2\nexit 1\n', { mode: 0o755 });
const run = (...args) =>
  spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });

ok('command: prints the report, --json parses, exit codes', () => {
  const r = run('-w', 'anything', 'P22', '--dir', repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dominant canvas: 8x6/);
  assert.match(r.stdout, /b-two\/frag\/bg\.png\s+sidecar.*NOT local: gdrive4t:media\/b-two\/frag\/bg\.png.*sha256=/);
  assert.match(r.stdout, /P22_hole_mask\.png\s+image\s+8x6 L nonzero=25\.0%/);
  assert.equal(JSON.parse(run('-w', 'x', 'P22', '--dir', repo, '--json').stdout).rows.length, 7);
  assert.equal(run('-w', 'x', '--dir', repo).status, 2, 'no key');
  assert.equal(run('P22', '--dir', repo).status, 2, 'no workspace');
  assert.equal(run('-w', 'x', 'P22', '--bogus').status, 2);
  assert.ok(run('-w', 'x', 'P99', '--dir', repo).stdout.includes('(none found)'));
});

ok('command: --fetch that cannot fetch exits 1 and says why', () => {
  const r = run('-w', 'x', 'P22', '--dir', repo, '--fetch', path.join(tmp, 'cmdout'));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /bg\.png\s+failed\s+fetch failed: Failed to create file system/);
});

console.log(`packets: ${n} checks passed`);
