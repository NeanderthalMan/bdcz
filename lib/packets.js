/**
 * The artefacts other beads left under `.claude/packets/<bead>/` for a panel — what each
 * one is, how big, whether it carries alpha, and where its bytes actually are.
 *
 * bc-xl7n.178. Three delmar sessions (dv-52r.63, .64, .65) each rebuilt this list by hand
 * before compositing a P22 plate: a `for` loop of `ls` over hand-named packet dirs, an
 * inline PIL size probe the worktree guard refused, then `cat bg.png.md` to discover the
 * background was a vault sidecar and an `rclone copyto` plus a sha256 check typed from
 * memory. This is the read, done once and the same way every time — with no interpreter
 * and no shell variable, so there is nothing for that guard to refuse.
 *
 * Everything here is plain node: PNG and JPEG headers and the PNG pixel stream are read
 * with `node:zlib`, `.npy` headers are parsed as text. Alpha coverage decodes the whole
 * image, which is the one expensive thing here and is switched off with `alpha: false`.
 *
 * Nothing here writes, except `fetchSidecars`, which writes only under the directory it
 * was handed and only ever the bytes a sidecar names.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { inflateSync } from 'node:zlib';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg']);
const OTHER_IMAGE_EXT = new Set(['.webp', '.gif', '.tif', '.tiff', '.exr']);

export function defaultRepoRoot(workspace) {
  return join(homedir(), 'projects', workspace);
}

export function packetsRoot(repoRoot) {
  return join(repoRoot, '.claude', 'packets');
}

/* ------------------------------------------------------------------- headers */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_MODES = { 0: 'L', 2: 'RGB', 3: 'P', 4: 'LA', 6: 'RGBA' };
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Width, height, mode and layout of a PNG, or null when the bytes are not one. */
export function pngInfo(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  const colorType = buf[25];
  if (!PNG_MODES[colorType]) return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType,
    interlace: buf[28],
    mode: PNG_MODES[colorType],
  };
}

/** Width, height and mode of a JPEG from its first start-of-frame marker. */
export function jpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const comps = buf[i + 9];
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
        mode: comps === 1 ? 'L' : comps === 3 ? 'RGB' : comps === 4 ? 'CMYK' : `${comps}ch`,
      };
    }
    i += 2 + len;
  }
  return null;
}

/** Shape and dtype of a `.npy` from its header alone — the array is never loaded. */
export function npyInfo(buf) {
  if (buf.length < 12 || buf[0] !== 0x93 || buf.toString('latin1', 1, 6) !== 'NUMPY') return null;
  const major = buf[6];
  const headerLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
  const start = major === 1 ? 10 : 12;
  const header = buf.toString('latin1', start, start + headerLen);
  const descr = /'descr'\s*:\s*'([^']*)'/.exec(header);
  const shapeM = /'shape'\s*:\s*\(([^)]*)\)/.exec(header);
  if (!descr || !shapeM) return null;
  const shape = shapeM[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  return { dtype: descr[1].replace(/^[<>|=]/, ''), shape };
}

/* ------------------------------------------------------------- alpha coverage */

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * The fraction of pixels that are not transparent — alpha > 0 for RGBA and LA — or, for
 * a single-channel `L` image, the fraction that is not zero (a mask's white area).
 * `null` for anything it does not decode: RGB has no alpha to cover, a palette image may
 * carry its alpha in a tRNS chunk this does not read, an interlaced one is laid out in
 * passes, and only 8- and 16-bit samples are handled.
 */
export function pngCoverage(buf, info = pngInfo(buf)) {
  if (!info || info.interlace !== 0) return null;
  if (info.colorType !== 0 && info.colorType !== 4 && info.colorType !== 6) return null;
  if (info.bitDepth !== 8 && info.bitDepth !== 16) return null;
  const chunks = [];
  for (let i = 8; i + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    if (type === 'IDAT') chunks.push(buf.subarray(i + 8, i + 8 + len));
    if (type === 'IEND') break;
    i += 12 + len;
  }
  if (!chunks.length) return null;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(chunks));
  } catch {
    return null;
  }
  const bytes = info.bitDepth / 8;
  const bpp = PNG_CHANNELS[info.colorType] * bytes;
  const stride = info.width * bpp;
  if (raw.length < (stride + 1) * info.height) return null;
  let prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  // The sample that says "there is something here": the last channel of LA and RGBA,
  // the only channel of L. For 16-bit only the high byte is looked at — a sample is
  // nonzero exactly when either byte is, but the low byte of a real matte is noise.
  const probe = (info.colorType === 0 ? 0 : bpp - bytes);
  let covered = 0;
  for (let y = 0; y < info.height; y += 1) {
    const base = y * (stride + 1);
    const filter = raw[base];
    for (let x = 0; x < stride; x += 1) {
      const v = raw[base + 1 + x];
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let out;
      if (filter === 0) out = v;
      else if (filter === 1) out = v + a;
      else if (filter === 2) out = v + b;
      else if (filter === 3) out = v + ((a + b) >> 1);
      else if (filter === 4) out = v + paeth(a, b, c);
      else return null;
      cur[x] = out & 0xff;
    }
    for (let x = probe; x < stride; x += bpp) if (cur[x] !== 0) covered += 1;
    [prev, cur] = [cur, prev];
  }
  return covered / (info.width * info.height);
}

/* ------------------------------------------------------------------ sidecars */

/**
 * The `key: value` lines between the `---` fences of a sidecar, or null when the file is
 * not a `media-sidecar`. Values keep their text with surrounding quotes stripped; it
 * does not try to be YAML, because a sidecar is written by one script and is flat.
 */
export function parseSidecar(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    fm[kv[1]] = v;
  }
  return fm.kind === 'media-sidecar' ? fm : null;
}

/* ---------------------------------------------------------------------- walk */

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

const extOf = (name) => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
};

function describeFile(path, alpha) {
  const ext = extOf(path);
  const out = { kind: 'other', width: null, height: null, mode: null, coverage: null, bytes: statSync(path).size };
  if (IMAGE_EXT.has(ext) || OTHER_IMAGE_EXT.has(ext)) out.kind = 'image';
  else if (ext === '.npy') out.kind = 'npy';
  else if (ext === '.json') out.kind = 'json';
  if (out.kind === 'image' && IMAGE_EXT.has(ext)) {
    const buf = readFileSync(path);
    const png = pngInfo(buf);
    if (png) {
      out.width = png.width;
      out.height = png.height;
      out.mode = png.mode;
      if (alpha) out.coverage = pngCoverage(buf, png);
    } else {
      const jpg = jpegInfo(buf);
      if (jpg) Object.assign(out, jpg);
    }
  } else if (out.kind === 'npy') {
    const buf = readFileSync(path, { encoding: null }).subarray(0, 4096);
    const npy = npyInfo(buf);
    if (npy) {
      out.mode = `${npy.dtype}${JSON.stringify(npy.shape).replace(/,/g, 'x').replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')'))}`;
      if (npy.shape.length >= 2) {
        out.height = npy.shape[0];
        out.width = npy.shape[1];
      }
    }
  }
  return out;
}

/**
 * One row per file under `.claude/packets` whose name carries `key`, oldest bead dir
 * first. A vault sidecar (`<file>.md` with `kind: media-sidecar`) is reported as the file
 * it stands for, and matches when its own name does OR when a file that matches sits in
 * the same directory — the frame a panel was built from is beside the plate that carries
 * the panel's token, not named for it. The row says whether the bytes are on this disk.
 *
 * `sharesCanvas` is against the most common width×height among the rows that have one.
 */
export function scanPackets(repoRoot, key, opts = {}) {
  const root = packetsRoot(repoRoot);
  const alpha = opts.alpha !== false;
  const want = opts.beads && opts.beads.length ? new Set(opts.beads) : null;
  const needle = String(key || '').toLowerCase();
  const files = [];
  for (const p of walk(root)) {
    const rel = relative(root, p).split(sep);
    if (want && !want.has(rel[0])) continue;
    files.push({ path: p, rel: rel.join('/'), name: basename(p) });
  }
  const hit = (n) => n.toLowerCase().includes(needle);
  const hitDirs = new Set(files.filter((f) => hit(f.name)).map((f) => dirname(f.path)));

  const sidecars = new Map(); // target path -> frontmatter
  for (const f of files) {
    if (extOf(f.name) !== '.md') continue;
    let fm = null;
    try {
      fm = parseSidecar(readFileSync(f.path, 'utf8'));
    } catch {
      /* unreadable is not a sidecar */
    }
    if (fm) sidecars.set(f.path.slice(0, -3), { fm, sidecarPath: f.path });
  }

  const rows = [];
  for (const f of files) {
    const sc = sidecars.get(f.path);
    const isSidecarFile = extOf(f.name) === '.md' && sidecars.has(f.path.slice(0, -3));
    if (isSidecarFile) continue; // reported as its target below
    if (!sc && !hit(f.name)) continue;
    if (sc && !hit(f.name) && !hitDirs.has(dirname(f.path))) continue;
    rows.push(buildRow(root, f.path, sc, alpha));
  }
  for (const [target, sc] of sidecars) {
    if (files.some((f) => f.path === target)) continue; // fetched already; handled above
    const name = basename(target);
    const dir = dirname(target);
    if (!hit(name) && !hitDirs.has(dir)) continue;
    rows.push(buildRow(root, target, sc, alpha));
  }
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const tally = new Map();
  for (const r of rows) {
    if (r.width == null) continue;
    const k = `${r.width}x${r.height}`;
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  let dominant = null;
  for (const [k, n] of tally) if (!dominant || n > tally.get(dominant)) dominant = k;
  for (const r of rows) r.sharesCanvas = r.width == null || !dominant ? null : `${r.width}x${r.height}` === dominant;
  return { root, key, canvas: dominant, rows };
}

function buildRow(root, path, sc, alpha) {
  const rel = relative(root, path).split(sep).join('/');
  const present = existsSync(path);
  const row = {
    bead: rel.split('/')[0],
    path: rel,
    kind: sc ? 'sidecar' : 'other',
    width: null,
    height: null,
    mode: null,
    coverage: null,
    present,
    bytes: null,
  };
  if (present) Object.assign(row, describeFile(path, alpha), sc ? { kind: 'sidecar' } : {});
  if (sc) {
    row.remote = sc.fm.remote || null;
    row.sidecarBytes = sc.fm.bytes ? Number(sc.fm.bytes) : null;
    row.sha256 = sc.fm.sha256 || null;
    if (!present) row.bytes = row.sidecarBytes;
  }
  return row;
}

/* -------------------------------------------------------------------- fetch */

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const REMOTE_RE = /^[A-Za-z0-9_][\w.-]*:[^\s-].*$/;

/** The one place a network fetch happens: `rclone copyto <remote> <dest>`. */
export function rcloneCopyto(remote, dest) {
  execFileSync('rclone', ['copyto', remote, dest], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Pull each sidecar row's bytes to `<dir>/<path under .claude/packets>` and check the
 * sha256 the sidecar recorded. A file already there with the right sha is left alone.
 * Returns one result per sidecar row: `{ path, dest, status, sha256?, error? }` where
 * `status` is `ok`, `cached`, or `failed`.
 */
export function fetchSidecars(rows, dir, opts = {}) {
  const run = opts.rclone || rcloneCopyto;
  const base = resolve(dir);
  const out = [];
  for (const r of rows) {
    if (r.kind !== 'sidecar') continue;
    const dest = resolve(base, r.path);
    const res = { path: r.path, dest, status: 'failed' };
    out.push(res);
    if (!dest.startsWith(base + sep)) {
      res.error = 'destination escapes --fetch directory';
      continue;
    }
    if (!r.remote || !REMOTE_RE.test(r.remote)) {
      res.error = `sidecar names no usable remote (${r.remote || 'none'})`;
      continue;
    }
    if (!r.sha256) {
      res.error = 'sidecar records no sha256 to check the bytes against';
      continue;
    }
    if (existsSync(dest) && sha256File(dest) === r.sha256) {
      res.status = 'cached';
      res.sha256 = r.sha256;
      continue;
    }
    try {
      mkdirSync(dirname(dest), { recursive: true });
      run(r.remote, dest);
    } catch (e) {
      res.error = `fetch failed: ${String(e.stderr || e.message || e).trim().split('\n')[0]}`;
      continue;
    }
    if (!existsSync(dest)) {
      res.error = 'fetch reported success but wrote nothing';
      continue;
    }
    res.sha256 = sha256File(dest);
    if (res.sha256 !== r.sha256) {
      res.error = `sha256 mismatch: sidecar says ${r.sha256}, fetched ${res.sha256}`;
      continue;
    }
    res.status = 'ok';
    if (opts.describe !== false) Object.assign(res, { info: describeFile(dest, opts.alpha !== false) });
  }
  return out;
}

/* --------------------------------------------------------------------- print */

const human = (n) =>
  n == null ? '?' : n >= 1048576 ? `${(n / 1048576).toFixed(1)}M` : n >= 1024 ? `${(n / 1024).toFixed(0)}K` : `${n}B`;

export function formatRow(r) {
  const size = r.width != null ? `${r.width}x${r.height}` : '-';
  const cov = r.coverage != null ? ` ${r.mode === 'L' ? 'nonzero' : 'alpha'}=${(r.coverage * 100).toFixed(1)}%` : '';
  const canvas = r.sharesCanvas == null ? '' : r.sharesCanvas ? ' canvas=yes' : ' canvas=NO';
  const where =
    r.kind === 'sidecar'
      ? r.present
        ? ' [sidecar; bytes on disk]'
        : ` [sidecar; NOT local: ${r.remote || 'no remote'} ${human(r.sidecarBytes)} sha256=${r.sha256 || '?'}]`
      : '';
  return `  ${r.path}  ${r.kind}  ${size}${r.mode ? ` ${r.mode}` : ''}${cov}${canvas}  ${human(r.bytes)}${where}`;
}
