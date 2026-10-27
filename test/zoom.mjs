#!/usr/bin/env node
//
// b7e-zoom — a region of a panel, magnified, with pixel coordinates on it (bc-dgx7.195).
//
//   npm test
//   node test/zoom.mjs
//
// The same two kinds of proof as test/plate.mjs: panel resolution, box parsing and
// clamping, recipe geometry and gridline placement are exercised on a fabricated tree with
// no external tool; bin/b7e-zoom is then driven as a real subprocess against a real PNG,
// but ONLY when sips and python3+Pillow are runnable — skipped loudly otherwise. The real
// run is the acceptance criterion itself: a pixel read off a grid label is found at the
// documented output pixel.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildZoom, clampBox, gridLines, parseBox, recipeShapes, resolvePanel, toolsAvailable } from '../lib/zoom.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-zoom');

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
};

console.log('\nb7e-zoom\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-zoom-'));
const root = path.join(tmp, 'repo');
const cache = path.join(tmp, 'cache');
const put = (base, rel) => {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'bytes');
  return p;
};
const inTree = put(root, 'graphic-novel/Teaser_01/panels/P01.png');
const vaulted = put(cache, 'graphic-novel/Teaser_01/panels/P50w_f1.png');
const onlyTreeSidecar = put(root, 'graphic-novel/Teaser_01/panels/P50w_f1.png.md');
put(root, 'graphic-novel/Teaser_01/panels/P24.png');
put(root, 'graphic-novel/Teaser_03/panels/P24.png');
const opts = { cwd: root, root, cacheDir: cache };

check('a bare id resolves in the worktree', () => {
  const r = resolvePanel('P01', opts);
  assert.deepEqual(r, { file: inTree, where: 'worktree' });
});
check('an id whose bytes were vaulted away resolves in the cache, not to its sidecar', () => {
  const r = resolvePanel('P50w_f1', opts);
  assert.deepEqual(r, { file: vaulted, where: 'cache' });
  assert.notEqual(r.file, onlyTreeSidecar);
});
check('an id with its extension resolves the same', () => {
  assert.equal(resolvePanel('P01.png', opts).file, inTree);
});
check('a vault-relative path whose file is only in the cache resolves there', () => {
  assert.deepEqual(resolvePanel('graphic-novel/Teaser_01/panels/P50w_f1.png', opts), { file: vaulted, where: 'cache' });
});
check('a path relative to the cwd resolves in the worktree', () => {
  const r = resolvePanel('graphic-novel/Teaser_01/panels/P01.png', opts);
  assert.equal(r.where, 'worktree');
});
check('a tail path ("panels/x.png") is found under the cache', () => {
  assert.equal(resolvePanel('panels/P50w_f1.png', opts).file, vaulted);
});
check('an id in two sets is refused with both named', () => {
  assert.throws(() => resolvePanel('P24', opts), (e) => /2 places/.test(e.message) && /Teaser_01/.test(e.message) && /Teaser_03/.test(e.message));
});
check('a miss names where it looked', () => {
  assert.throws(() => resolvePanel('P99', opts), (e) => e.message.includes(root) && e.message.includes(cache));
});

check('parseBox takes four integers', () => {
  assert.deepEqual(parseBox('1400,1120,1600,1160'), { x0: 1400, y0: 1120, x1: 1600, y1: 1160 });
});
check('parseBox refuses a reversed, short, fractional or negative box', () => {
  for (const bad of ['10,10,5,20', '1,2,3', '1,2,3.5,9', '-1,0,5,5', 'a,b,c,d']) {
    assert.throws(() => parseBox(bad), /x0,y0,x1,y1/, bad);
  }
});
check('clampBox cuts an overhang and says so; an untouched box says not', () => {
  assert.deepEqual(clampBox({ x0: 90, y0: 0, x1: 150, y1: 10 }, 100, 50), { x0: 90, y0: 0, x1: 100, y1: 10, clamped: true });
  assert.equal(clampBox({ x0: 0, y0: 0, x1: 10, y1: 10 }, 100, 50).clamped, false);
});
check('a box wholly outside the plate is refused', () => {
  assert.throws(() => clampBox({ x0: 200, y0: 0, x1: 300, y1: 10 }, 100, 50), /outside the 100x50 plate/);
});
check('gridLines are multiples of the step in the plate frame, not the crop', () => {
  assert.deepEqual(gridLines(1403, 1431, 10), [1410, 1420, 1430]);
  assert.deepEqual(gridLines(1400, 1420, 10), [1400, 1410]);
});

check('recipeShapes collects polygons, lines, boxes, tagged by op, and reports what it skipped', () => {
  const { shapes, skipped } = recipeShapes({
    ops: [
      { op: 'heal', polygon: [[1, 2], [3, 4], [5, 6]], box: [0, 0, 9, 9] },
      { op: 'mark', lines: [[[1, 1], [2, 2]], [[3, 3], [4, 4]]] },
      { op: 'clone', line: [[0, 0], [5, 5]], width: 3 },
      { op: 'fill', polygon: 'oops' },
    ],
  });
  assert.deepEqual(shapes.map((s) => s.label), ['0:heal.polygon', '0:heal.box', '1:mark.lines[0]', '1:mark.lines[1]', '2:clone.line']);
  assert.deepEqual(skipped, ['3:fill.polygon']);
});
check('a recipe with no ops is no shapes, not an error', () => {
  assert.deepEqual(recipeShapes({}), { shapes: [], skipped: [] });
});

check('buildZoom hands the renderer clamped boxes, gridlines and the recipe shapes', () => {
  const recipe = path.join(tmp, 'r.json');
  fs.writeFileSync(recipe, JSON.stringify({ ops: [{ op: 'heal', polygon: [[1, 1], [2, 2], [3, 1]] }] }));
  let job;
  const tools = {
    sips: (files) => ({ status: 0, stdout: files.map((f) => `${f}\n  pixelWidth: 100\n  pixelHeight: 50\n  format: png\n`).join('') }),
    python: (j) => {
      job = j;
      return { status: 0, stdout: '{"width": 300, "height": 90}' };
    },
  };
  const m = buildZoom({ panel: 'P01', box: '85,5,120,35', scale: 3, grid: 10, recipe, vs: 'P50w_f1', out: path.join(tmp, 'o.png'), ...opts }, tools);
  assert.equal(m.clamped, true);
  assert.deepEqual(m.box, { x0: 85, y0: 5, x1: 100, y1: 35 });
  assert.equal(m.foundIn, 'worktree');
  assert.equal(m.vs.foundIn, 'cache');
  assert.equal(job.panels.length, 2);
  assert.deepEqual(job.panels[0].gridX, [90]);
  assert.deepEqual(job.panels[0].gridY, [10, 20, 30]);
  assert.equal(job.panels[0].shapes.length, 1);
  assert.equal(job.panels[1].shapes.length, 0);
  assert.match(m.mapping, /\(x-85\)\*3\+1/);
});
check('a bad scale or grid is refused', () => {
  assert.throws(() => buildZoom({ panel: 'P01', box: '0,0,5,5', scale: 0, ...opts }), /--scale/);
  assert.throws(() => buildZoom({ panel: 'P01', box: '0,0,5,5', grid: 2.5, ...opts }), /--grid/);
});

/* ===================================================== the real render, if it can */

const avail = toolsAvailable();
if (!avail.sips || !avail.pil) {
  console.log('\n  SKIP the real render: needs sips and python3+Pillow, not both runnable here\n');
} else {
  console.log('\nthe real thing\n');
  // A 120x80 plate, light grey, with one pure-red pixel at plate (1405, 1123) — so the
  // plate is placed at an offset by cropping its own coordinates: we build a plate big
  // enough to hold that pixel instead (1700x1300) and keep it mostly empty.
  const panels = path.join(tmp, 'real', 'graphic-novel', 'Teaser_01', 'panels');
  fs.mkdirSync(panels, { recursive: true });
  const png = path.join(panels, 'P50w_f1.png');
  const mk = spawnSync(
    'python3',
    ['-c', 'import sys\nfrom PIL import Image\nim = Image.new("RGB", (1700, 1300), (200, 200, 200))\nim.putpixel((1416, 1124), (255, 0, 0))\nim.save(sys.argv[1])', png],
    { encoding: 'utf8' }
  );
  assert.equal(mk.status, 0, mk.stderr);
  const outPng = path.join(tmp, 'real', 'zoom.png');
  const run = spawnSync(BIN, ['P50w_f1', '1400,1120,1420,1130', '--grid', '10', '--scale', '4', '--out', outPng, '--json'], {
    cwd: path.join(tmp, 'real'),
    encoding: 'utf8',
    env: { ...process.env, DELMAR_MEDIA_CACHE: path.join(tmp, 'nowhere') },
  });
  check('b7e-zoom exits 0 and reports the plate size, source and clamped box', () => {
    assert.equal(run.status, 0, run.stderr);
    const m = JSON.parse(run.stdout);
    assert.equal(m.width, 1700);
    assert.equal(m.height, 1300);
    assert.equal(m.foundIn, 'worktree');
    assert.equal(m.renderedWidth, 80);
    assert.equal(m.renderedHeight, 40);
    assert.equal(m.clamped, false);
  });
  const probe = (x, y) => {
    const r = spawnSync('python3', ['-c', 'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert("RGB")\nprint(*im.getpixel((int(sys.argv[2]), int(sys.argv[3]))))', outPng, String(x), String(y)], { encoding: 'utf8' });
    return r.stdout.trim().split(' ').map(Number);
  };
  // Chosen clear of the label chips (top and left edges, caption bottom-left) and of the
  // gridlines at 1410 / 1120 / 1130, which would otherwise paint over it.
  check('the red plate pixel (1416,1124) lands at ((1416-1400)*4+2, (1124-1120)*4+2) = (66,18)', () => {
    assert.deepEqual(probe(66, 18), [255, 0, 0]);
    assert.deepEqual(probe(66 + 4, 18), [200, 200, 200], 'the next plate pixel right is plate grey');
    assert.deepEqual(probe(66 - 2, 18 - 2), [255, 0, 0], 'the whole 4x4 block is the one pixel, not smoothed');
  });
  check('the gridline labelled 1410 is drawn through the middle of plate pixel 1410', () => {
    assert.deepEqual(probe((1410 - 1400) * 4 + 2, 25), [0, 255, 255]);
  });
  check('the gridline labelled 1120 is drawn through the middle of plate row 1120', () => {
    assert.deepEqual(probe(60, (1120 - 1120) * 4 + 2), [255, 0, 255]);
  });
  check('an id that is nowhere exits 2 naming the places looked', () => {
    const bad = spawnSync(BIN, ['P99', '0,0,10,10'], { cwd: path.join(tmp, 'real'), encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /no panel "P99"/);
  });
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
