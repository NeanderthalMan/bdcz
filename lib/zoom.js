/**
 * `bin/b7e-zoom` — a region of a panel, magnified, with the plate's own pixel
 * coordinates drawn on it, so a session writing `plate_fix` recipe polygons can read a
 * coordinate off the picture instead of building a crop script first.
 *
 * bc-dgx7.195, filed by the session audit (`lib/sessionaudit.js`) against five Teaser 01
 * panel rounds (dv-5eu.123/.127/.131/.132/.134) that each wrote a scratchpad zoom script
 * before the first recipe and called it again after every recipe run. They differed in
 * how they named the panel (id, path, `label=path`), in how they found its bytes
 * (worktree, `media_vault.fetch`, a hard-coded `~/.cache/delmar-media` path — and one
 * call died because a `panels/` path had already been vaulted away), and in whether
 * coordinates were drawn at all. This is the one answer.
 *
 * The compositing is Pillow, as in `lib/plate.js` (whose `nativeDimensions` this reuses
 * for the plate's full size, and whose reasons for Pillow-not-ffmpeg apply unchanged).
 * Everything that is logic — resolving a panel reference, parsing and clamping a box,
 * collecting a recipe's geometry — is plain JS tested with a fabricated tree and no
 * external tool; `python` and `sips` are injectable exactly as in `lib/plate.js`.
 *
 * THE COORDINATE FRAME is the whole point. The crop is resized NEAREST (never smoothed),
 * and plate pixel (px,py) lands on output pixel ((px-x0)*scale + floor(scale/2),
 * (py-y0)*scale + floor(scale/2)) — the middle of that pixel's enlarged block. A grid line
 * labelled N is drawn through that middle for N, so a point read off the grid and used as
 * a `mark` op lands on the same pixel it was read from. Nothing is added around the crop
 * (labels sit inside it, on a dark chip), so the mapping has no offset.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeDimensions } from './plate.js';

export { toolsAvailable } from './plate.js';

export const PANEL_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/** Where `media_vault.fetch` caches what it pulls back (`DELMAR_MEDIA_CACHE` overrides). */
export function defaultCacheDir(env = process.env) {
  return env.DELMAR_MEDIA_CACHE || path.join(os.homedir(), '.cache', 'delmar-media');
}

/** The enclosing git work tree, or `cwd` when there is none — the worktree half of "worktree → cache". */
export function repoRootOf(cwd) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return !r.error && r.status === 0 && r.stdout.trim() ? r.stdout.trim() : cwd;
}

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Sorted, absolute, real-file matches of `pattern` under `base`. */
function globFiles(pattern, base) {
  if (!fs.existsSync(base)) return [];
  return fs
    .globSync(pattern, { cwd: base })
    .map((m) => path.join(base, m))
    .filter(isFile)
    .sort();
}

/**
 * A panel reference → the file to magnify and where it was found.
 *
 *  - an existing path (as typed, then repo-root-relative) is `worktree`;
 *  - the same path under the media cache — a `media_vault` path whose bytes were vaulted
 *    away — is `cache`;
 *  - a bare panel id (`P50w_f1`, with or without an extension) is looked up as
 *    `graphic-novel/<set>/panels/<id>.<ext>` in the worktree, then in the cache. Two sets
 *    holding the same id is refused with both named, never guessed between.
 *
 * Throws, naming every place it looked, when nothing resolves.
 */
export function resolvePanel(ref, { cwd = process.cwd(), root = null, cacheDir = defaultCacheDir() } = {}) {
  const top = root || repoRootOf(cwd);
  const looked = [];

  if (ref.includes('/') || isFile(path.resolve(cwd, ref))) {
    const tries = [
      ['worktree', path.resolve(cwd, ref)],
      ['worktree', path.join(top, ref)],
      ['cache', path.join(cacheDir, ref)],
    ];
    for (const [where, p] of tries) {
      looked.push(p);
      if (isFile(p)) return { file: p, where };
    }
    if (!path.isAbsolute(ref)) {
      const hits = globFiles(`**/${ref}`, cacheDir);
      looked.push(`${cacheDir}/**/${ref}`);
      if (hits.length === 1) return { file: hits[0], where: 'cache' };
      if (hits.length > 1) {
        throw new Error(`"${ref}" matches ${hits.length} files in the cache: ${hits.join(', ')} — pass a fuller path`);
      }
    }
    throw new Error(`no panel at "${ref}" — looked in: ${looked.join(', ')}`);
  }

  const hasExt = PANEL_EXTENSIONS.includes(path.extname(ref).toLowerCase());
  const names = hasExt ? [ref] : PANEL_EXTENSIONS.map((e) => `${ref}${e}`);
  for (const [where, base] of [
    ['worktree', top],
    ['cache', cacheDir],
  ]) {
    const hits = [];
    for (const n of names) hits.push(...globFiles(`graphic-novel/*/panels/${n}`, base));
    looked.push(`${base}/graphic-novel/*/panels/${names[0]}`);
    if (hits.length === 1) return { file: hits[0], where };
    if (hits.length > 1) {
      throw new Error(`panel id "${ref}" is in ${hits.length} places in the ${where}: ${hits.join(', ')} — pass the path of the one you mean`);
    }
  }
  throw new Error(`no panel "${ref}" — looked in: ${looked.join(', ')}`);
}

/**
 * `x0,y0,x1,y1` → four non-negative integers with `x1 > x0` and `y1 > y0`. A bad shape is
 * refused rather than repaired, as in `lib/plate.js`'s `parseCrop`.
 */
export function parseBox(spec) {
  const parts = String(spec).split(',').map(Number);
  const ok =
    parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0) && parts[2] > parts[0] && parts[3] > parts[1];
  if (!ok) throw new Error(`the box wants x0,y0,x1,y1 — four non-negative integers, x1>x0 and y1>y0 — got "${spec}"`);
  const [x0, y0, x1, y1] = parts;
  return { x0, y0, x1, y1 };
}

/** The box cut to the plate. `clamped` says whether anything was cut; an empty result throws. */
export function clampBox(box, width, height) {
  const out = {
    x0: Math.min(box.x0, width),
    y0: Math.min(box.y0, height),
    x1: Math.min(box.x1, width),
    y1: Math.min(box.y1, height),
  };
  if (out.x1 <= out.x0 || out.y1 <= out.y0) {
    throw new Error(`box ${box.x0},${box.y0},${box.x1},${box.y1} lies outside the ${width}x${height} plate`);
  }
  return { ...out, clamped: out.x0 !== box.x0 || out.y0 !== box.y0 || out.x1 !== box.x1 || out.y1 !== box.y1 };
}

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const isPointList = (l) => Array.isArray(l) && l.length > 0 && l.every(isPoint);
const isRect = (r) => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite);

/**
 * Every shape a `plate_fix` recipe's ops name, in plate coordinates, each tagged with its op
 * index and field: `polygon`/`protect` closed, `line`/`lines`/`edge` open, `box`/`source`/
 * `sample` rectangles. A field of the wrong shape is skipped and reported in `skipped`
 * rather than thrown over — a half-written recipe is exactly when this gets run.
 */
export function recipeShapes(recipe) {
  const shapes = [];
  const skipped = [];
  const ops = Array.isArray(recipe && recipe.ops) ? recipe.ops : [];
  ops.forEach((op, i) => {
    const tag = (field) => `${i}:${op.op || '?'}.${field}`;
    for (const f of ['polygon', 'protect']) {
      if (op[f] === undefined) continue;
      if (isPointList(op[f])) shapes.push({ kind: 'poly', pts: op[f], label: tag(f), op: i });
      else skipped.push(tag(f));
    }
    for (const f of ['line', 'edge']) {
      if (op[f] === undefined) continue;
      if (isPointList(op[f])) shapes.push({ kind: 'line', pts: op[f], label: tag(f), op: i });
      else skipped.push(tag(f));
    }
    if (op.lines !== undefined) {
      if (Array.isArray(op.lines) && op.lines.every(isPointList)) {
        op.lines.forEach((l, j) => shapes.push({ kind: 'line', pts: l, label: tag(`lines[${j}]`), op: i }));
      } else skipped.push(tag('lines'));
    }
    for (const f of ['box', 'source', 'sample']) {
      if (op[f] === undefined) continue;
      if (isRect(op[f])) shapes.push({ kind: 'rect', pts: op[f], label: tag(f), op: i });
      else if (f !== 'sample' || !isPoint(op[f])) skipped.push(tag(f));
    }
  });
  return { shapes, skipped };
}

/** Gridline coordinates in `[lo, hi)` — the multiples of `step`, in the plate's own frame. */
export function gridLines(lo, hi, step) {
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v < hi; v += step) out.push(v);
  return out;
}

const RENDER_SCRIPT = `
import sys, json
from PIL import Image, ImageDraw, ImageFont

job = json.load(sys.stdin)
font = ImageFont.load_default()
COLOURS = [(255, 64, 64), (64, 200, 255), (255, 200, 0), (120, 255, 120), (255, 120, 255), (255, 150, 60)]


def chip(draw, xy, text, fg=(255, 255, 255)):
    bb = draw.textbbox(xy, text, font=font)
    draw.rectangle((bb[0] - 1, bb[1] - 1, bb[2] + 1, bb[3] + 1), fill=(0, 0, 0))
    draw.text(xy, text, fill=fg, font=font)


def panel(p):
    b = p['box']
    s = p['scale']
    im = Image.open(p['path']).convert('RGB').crop((b['x0'], b['y0'], b['x1'], b['y1']))
    im = im.resize((im.width * s, im.height * s), Image.NEAREST)
    d = ImageDraw.Draw(im)
    h = s // 2

    def X(x):
        return (x - b['x0']) * s + h

    def Y(y):
        return (y - b['y0']) * s + h

    step = p.get('grid')
    if step:
        gap = max(1, -(-32 // (step * s)))
        for v in p['gridX']:
            d.line((X(v), 0, X(v), im.height), fill=(0, 255, 255), width=1)
            if (v // step) % gap == 0:
                chip(d, (X(v) + 2, 1), str(v), (0, 255, 255))
        for v in p['gridY']:
            d.line((0, Y(v), im.width, Y(v)), fill=(255, 0, 255), width=1)
            if (v // step) % gap == 0:
                chip(d, (1, Y(v) + 2), str(v), (255, 0, 255))

    for sh in p.get('shapes', []):
        col = COLOURS[sh['op'] % len(COLOURS)]
        pts = sh['pts']
        if sh['kind'] == 'rect':
            x0, y0, x1, y1 = pts
            d.rectangle((X(x0) - h, Y(y0) - h, X(x1) - h, Y(y1) - h), outline=col)
            at = (X(x0) - h + 2, Y(y0) - h + 2)
        else:
            xy = [(X(x), Y(y)) for x, y in pts]
            if sh['kind'] == 'poly' and len(xy) > 1:
                xy = xy + [xy[0]]
            d.line(xy, fill=col, width=1)
            for q in xy:
                d.ellipse((q[0] - 2, q[1] - 2, q[0] + 2, q[1] + 2), outline=col)
            at = (xy[0][0] + 4, xy[0][1] + 4)
        chip(d, at, sh['label'], col)

    if p.get('caption'):
        chip(d, (2, im.height - 12), p['caption'])
    return im


ims = [panel(p) for p in job['panels']]
if len(ims) == 1:
    out = ims[0]
else:
    gap = 8
    out = Image.new('RGB', (sum(i.width for i in ims) + gap * (len(ims) - 1), max(i.height for i in ims)), (24, 24, 24))
    x = 0
    for i in ims:
        out.paste(i, (x, 0))
        x += i.width + gap
out.save(job['out'])
print(json.dumps({'width': out.width, 'height': out.height}))
`;

function defaultPython(job) {
  return spawnSync('python3', ['-c', RENDER_SCRIPT], {
    input: JSON.stringify(job),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

function render(job, { python = defaultPython } = {}) {
  const { status, stdout, stderr, error } = python(job);
  if (error) throw new Error(`python3 is not runnable: ${error.message}`);
  if (status !== 0) throw new Error(`zoom render failed: ${stderr || stdout}`);
  return JSON.parse(stdout.trim().split('\n').pop());
}

function defaultOutPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'b7e-zoom-')), 'zoom.png');
}

/**
 * The whole command minus argv and printing. `panel` is an id or path, `box` the
 * `x0,y0,x1,y1` string; `scale` defaults to 3; `grid` is the step in plate pixels (0/unset
 * draws none); `recipe` a path to a `plate_fix` JSON; `vs` a second panel cut with the
 * same box and grid and set beside the first. Returns the manifest.
 */
export function buildZoom(opts, tools = {}) {
  const { panel, box: boxSpec, scale = 3, grid = 0, recipe = null, vs = null, out = null, cwd = process.cwd() } = opts;
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`--scale wants a whole number of at least 1, got ${scale}`);
  if (grid && (!Number.isInteger(grid) || grid < 1)) throw new Error(`--grid wants a whole number of pixels, got ${grid}`);

  const wanted = parseBox(boxSpec);
  const resolveOpts = { cwd, root: opts.root || null, cacheDir: opts.cacheDir || defaultCacheDir() };

  let shapes = [];
  let skipped = [];
  if (recipe) {
    const rp = path.resolve(cwd, recipe);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(rp, 'utf8'));
    } catch (err) {
      throw new Error(`--recipe ${recipe}: ${err.message}`);
    }
    ({ shapes, skipped } = recipeShapes(parsed));
  }

  const cut = (ref, withShapes) => {
    const found = resolvePanel(ref, resolveOpts);
    const dims = nativeDimensions([found.file], tools).get(found.file);
    const box = clampBox(wanted, dims.width, dims.height);
    const entry = {
      path: found.file,
      box: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
      scale,
      caption: path.basename(found.file),
      shapes: withShapes ? shapes : [],
    };
    if (grid) {
      entry.grid = grid;
      entry.gridX = gridLines(box.x0, box.x1, grid);
      entry.gridY = gridLines(box.y0, box.y1, grid);
    }
    return {
      entry,
      info: { panel: ref, file: found.file, foundIn: found.where, width: dims.width, height: dims.height, box: entry.box, clamped: box.clamped },
    };
  };

  const main = cut(panel, true);
  const other = vs ? cut(vs, false) : null;
  const outPath = out ? path.resolve(cwd, out) : defaultOutPath();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const rendered = render({ panels: [main.entry, ...(other ? [other.entry] : [])], out: outPath }, tools);

  return {
    outPath,
    scale,
    grid: grid || 0,
    ...main.info,
    vs: other && other.info,
    renderedWidth: rendered.width,
    renderedHeight: rendered.height,
    mapping: `plate pixel (x,y) -> output pixel ((x-${main.info.box.x0})*${scale}+${Math.floor(scale / 2)}, (y-${main.info.box.y0})*${scale}+${Math.floor(scale / 2)})`,
    shapes: shapes.length,
    skipped,
  };
}
