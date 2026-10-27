/**
 * `bin/b7e-asset` — where a media file's bytes actually are: real, an unsmudged git-LFS
 * pointer, a sidecar-only reference to a media vault, or missing entirely.
 *
 * bc-dgx7.140, filed by the session audit against four delmar sessions (`dv-2uu.15`,
 * `dv-2uu.12`, a `dv-5eu` replan, `dv-5i2.120`) that each answered this question with a
 * different ad-hoc probe: a hand-built census with `md5`/`sips`/`stat`, a manual
 * `git check-attr` + `shasum` + `rclone lsf` chain, a bare `ls | wc -l` that silently
 * undercounted vault-only assets (a directory of nothing but `.md` sidecars reads as
 * empty unless something knows to look for them), and a generator that degraded with
 * only a buried warning. This is the one answer.
 *
 * The vault convention itself — a `<name>.<ext>.md` sidecar with YAML frontmatter naming
 * a `remote:`, replacing the real file — is delmar's own (`docs/MEDIA_VAULT.md`,
 * `scripts/media_vault.py`), not beadcause's; nothing here imports or shells out to that
 * script, because a `b7e-*` tool has to work against any checkout, not only the one that
 * invented the convention it recognises. The four things this reimplements from
 * `media_vault.py` on purpose, so the two never quietly disagree about what a file *is*:
 * the LFS-pointer magic-bytes check (`is_lfs_pointer`), the sidecar suffix and its
 * extension guard (`is_sidecar`), the media extension set, and the frontmatter shape.
 *
 * ## The four states, and which one wins when more than one is true
 *
 * A path can have real bytes on disk, an LFS pointer stub on disk, and a stale sidecar
 * beside it all at once — a file kept local under `media_vault.PROTECTED`, published
 * long ago, still carries its `.md`. Precedence is: real bytes beat a pointer stub beat a
 * sidecar beat nothing at all — because a caller asking "where are the bytes" wants the
 * closest true answer, and the closest true answer is whatever is actually already
 * readable on this machine right now.
 *
 * - **`bytes`** — the file exists on disk and is not an unsmudged LFS pointer stub.
 * - **`lfs-pointer`** — the file exists on disk, is `<=1024` bytes, and opens with the
 *   git-LFS pointer magic line. Real content exists somewhere (the LFS store) but this
 *   checkout has not smudged it — the exact shape a worktree with `lfs.fetchexclude=*`
 *   produces for every LFS-tracked path.
 * - **`sidecar-only`** — the file does not exist on disk, but `<path>.md` does and its
 *   frontmatter names a `remote:`. The bytes live in the vault; this checkout only holds
 *   the pointer-in-prose.
 * - **`missing`** — none of the above: no file, and no sidecar that can actually say
 *   where the bytes are (no sidecar at all, or one with no readable frontmatter, or one
 *   whose frontmatter has no `remote`). A sidecar in that last shape is "dangling" — it
 *   exists but cannot do the one job a sidecar has — and is reported as `missing` with
 *   its `sidecarPath` still filled in, not silently folded into "nothing here at all".
 *
 * `missing` is the only state `bin/b7e-asset` exits `1` for. The other three all mean
 * "this asset's bytes are accounted for, here or in the vault"; only `missing` means the
 * question the tool exists to answer went unanswered.
 *
 * ## Directory expansion is recursive, and that is the point
 *
 * `bin/b7e-plate`'s directory expansion is deliberately *not* recursive — a stray
 * subdirectory of thumbnails must never land on a montage. This tool needs the opposite:
 * `dv-5eu`'s replan hit a directory that was **entirely sidecars, no real bytes anywhere
 * in it**, and a non-recursive, extension-only listing (or a bare `ls | wc -l`) reports
 * that as empty. `resolveTargets` below walks a directory tree fully and folds in every
 * `<media>.md` sidecar's target path alongside every media file actually present, so a
 * directory of nothing but vault pointers-in-prose still reports every asset it
 * describes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Extensions this tool treats as media — the same set `media_vault.py`'s `MEDIA_EXT`
 * uses, so a file the vault convention would publish is a file this recognises. */
export const MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.tif', '.tiff', '.psd',
  '.mp4', '.mov', '.webm', '.mkv',
  '.wav', '.mp3', '.m4a', '.flac', '.ogg',
  '.bin',
]);

/** Extensions `sips` can read pixel dimensions for. A strict subset of MEDIA_EXTENSIONS
 * — video/audio dimensions need ffprobe, which this tool does not shell out to. */
const SIPS_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tif', '.tiff']);

export const SIDECAR_SUFFIX = '.md';

/** First bytes of a git-LFS pointer file — identical check to `media_vault.py`'s
 * `is_lfs_pointer`, including the size cap: pointers are tiny by spec, so anything
 * over 1024 bytes cannot be one no matter what its first line says. */
const LFS_POINTER_MAGIC = 'version https://git-lfs.github.com/spec/v1';

export function isMediaExt(p) {
  return MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase());
}

/** `<media>.md` where `<media>`'s own extension is a recognised media extension — a
 * bare `.md` file (a README, a note) is never mistaken for a sidecar. */
export function isSidecarPath(p) {
  if (!p.endsWith(SIDECAR_SUFFIX)) return false;
  return isMediaExt(p.slice(0, -SIDECAR_SUFFIX.length));
}

export function mediaPathForSidecar(sidecarPath) {
  return sidecarPath.slice(0, -SIDECAR_SUFFIX.length);
}

export function sidecarPathFor(mediaPath) {
  return mediaPath + SIDECAR_SUFFIX;
}

/**
 * Is this file an unsmudged git-LFS pointer stub rather than real media?
 *
 * Never throws: a path that cannot be stat'd or read is simply not a pointer as far as
 * this is concerned, and `classifyAsset` treats that the same as any other read failure.
 */
export function isLfsPointerFile(absPath) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return false;
  }
  if (!stat.isFile() || stat.size > 1024) return false;
  let fd;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(Buffer.byteLength(LFS_POINTER_MAGIC, 'utf8'));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return n === buf.length && buf.toString('utf8') === LFS_POINTER_MAGIC;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed or never opened */
      }
    }
  }
}

/** `oid`/`size` out of a pointer file's body — best-effort, `null` fields when a line is
 * not in the shape the spec gives (`oid sha256:<64 hex>`, `size <digits>`). */
export function parseLfsPointer(absPath) {
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch {
    return { oid: null, size: null };
  }
  const oid = text.match(/^oid sha256:([0-9a-f]{64})$/m)?.[1] ?? null;
  const sizeStr = text.match(/^size (\d+)$/m)?.[1];
  return { oid, size: sizeStr ? Number(sizeStr) : null };
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/**
 * The flat scalars out of a sidecar's YAML frontmatter block — `remote`, `bytes`,
 * `size`, `width`, `height`, `format`, `sha256`, whatever else the vault wrote. Only
 * top-level `key: value` lines are read; an indented continuation (`media_vault.py`'s
 * sidecars have none for the fields this cares about) is skipped rather than mis-parsed.
 * `null` when there is no frontmatter block at all — a plain paragraph, or a `.md` that
 * only happens to share a media file's stem.
 */
export function parseSidecarFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return null;
  const out = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    if (!rawLine || /^[ \t]/.test(rawLine) || rawLine.trimStart().startsWith('#')) continue;
    const idx = rawLine.indexOf(':');
    if (idx === -1) continue;
    const key = rawLine.slice(0, idx).trim();
    let value = rawLine.slice(idx + 1).trim();
    if (!key || value === '') continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else if (/^-?\d+$/.test(value)) {
      value = Number(value);
    } else if (/^-?\d*\.\d+$/.test(value)) {
      value = Number(value);
    }
    out[key] = value;
  }
  return out;
}

/** A sidecar file's frontmatter, or `null` if it cannot be read or has none. */
export function readSidecar(absSidecarPath) {
  let text;
  try {
    text = fs.readFileSync(absSidecarPath, 'utf8');
  } catch {
    return null;
  }
  return parseSidecarFrontmatter(text);
}

/**
 * Every media path a set of `<path|glob|dir>` targets names, resolved against `cwd`.
 *
 * - A literal file or a glob match: itself, unless it is a sidecar path, in which case
 *   it resolves to the media path it describes (so `b7e-asset foo.png.md` and
 *   `b7e-asset foo.png` ask the same question).
 * - A directory: walked fully (recursively — see the file header), contributing every
 *   media-extension file it holds and, separately, the media path implied by every
 *   sidecar it holds, whether or not that media path exists. The two lists are merged
 *   by media path, deduplicated, so a file with a stale sidecar beside it is one entry,
 *   not two.
 * - A literal path that resolves to neither an existing file nor an existing directory,
 *   and is not a glob: kept as-is (the caller asked about a specific path; "it does not
 *   exist" is itself an answer this tool gives, not a resolution failure) unless it ends
 *   in the sidecar suffix, in which case the corresponding media path is asked about
 *   instead.
 *
 * Order is deterministic — insertion order of first mention, directories walked in
 * sorted order — so two runs against the same tree report rows in the same order.
 */
export function resolveTargets(targets, { cwd = process.cwd() } = {}) {
  const seen = new Set();
  const mediaPaths = [];
  const sidecarOf = new Map();
  const problems = [];

  const addMedia = (abs, sidecarAbs = null) => {
    if (!seen.has(abs)) {
      seen.add(abs);
      mediaPaths.push(abs);
    }
    if (sidecarAbs && !sidecarOf.has(abs)) sidecarOf.set(abs, sidecarAbs);
  };

  const walkDir = (dirAbs) => {
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      problems.push(`${dirAbs}: ${err.message}`);
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        walkDir(abs);
      } else if (entry.isFile()) {
        if (isSidecarPath(abs)) addMedia(mediaPathForSidecar(abs), abs);
        else if (isMediaExt(abs)) addMedia(abs);
      }
    }
  };

  for (const target of targets) {
    const abs = path.isAbsolute(target) ? target : path.join(cwd, target);
    if (/[*?[\]]/.test(target)) {
      const matches = fs.globSync(target, { cwd }).map((m) => path.join(cwd, m)).sort();
      if (matches.length === 0) {
        problems.push(`${target}: matched nothing`);
        continue;
      }
      for (const m of matches) {
        let st;
        try {
          st = fs.statSync(m);
        } catch {
          continue;
        }
        if (st.isDirectory()) walkDir(m);
        else if (isSidecarPath(m)) addMedia(mediaPathForSidecar(m), m);
        else addMedia(m);
      }
      continue;
    }
    let st = null;
    try {
      st = fs.statSync(abs);
    } catch {
      /* does not exist — handled below */
    }
    if (st?.isDirectory()) {
      walkDir(abs);
    } else if (isSidecarPath(abs)) {
      addMedia(mediaPathForSidecar(abs), abs);
    } else {
      addMedia(abs);
    }
  }

  return { mediaPaths, sidecarOf, problems };
}

function defaultSips(files) {
  return spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', ...files], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

const SIPS_PROP_RE = /^\s{2}(\w+):\s*(.+)$/;

/** `sips`'s batch header-plus-props output, parsed positionally (see `lib/plate.js` for
 * why: `sips` echoes back `/tmp` as `/private/tmp`, so matching a header to a path is
 * unreliable, and `sips` prints one block per file in call order regardless). */
function parseSipsBatch(output) {
  const blocks = [];
  let current = null;
  for (const rawLine of output.split('\n')) {
    if (!rawLine) continue;
    if (!rawLine.startsWith(' ')) {
      current = { props: {} };
      blocks.push(current);
      continue;
    }
    const m = rawLine.match(SIPS_PROP_RE);
    if (m && current) {
      const [, key, value] = m;
      if (key === 'pixelWidth' || key === 'pixelHeight') current.props[key] = Number(value);
      else if (key === 'format') current.props.format = value;
    }
  }
  return blocks;
}

/** Native `{width, height, format}` for each of `files`, one `sips` call for the whole
 * batch. Files `sips` cannot read (not actually an image, `sips` unavailable) are simply
 * absent from the returned map rather than throwing — a census keeps going without
 * dimensions for the file that broke it. */
export function nativeDimensions(files, { sips = defaultSips } = {}) {
  const out = new Map();
  if (files.length === 0) return out;
  let result;
  try {
    result = sips(files);
  } catch {
    return out;
  }
  if (result.error || result.status !== 0) return out;
  const blocks = parseSipsBatch(result.stdout || '');
  files.forEach((f, i) => {
    const props = blocks[i]?.props;
    if (props?.pixelWidth && props?.pixelHeight) {
      out.set(f, { width: props.pixelWidth, height: props.pixelHeight, format: props.format ?? null });
    }
  });
  return out;
}

function defaultGit(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

/**
 * `tracked` / `untracked` / `ignored`, or `null` when `absPath` is not inside a git
 * working tree at all — a plain fixture directory built for a test, say. Two calls
 * (`ls-files`, then `check-ignore` only if the first said "no") rather than one
 * `status --porcelain`, because `status` only reports a path that actually exists, and
 * this is asked about `sidecar-only` and `missing` paths too.
 */
export function gitStatusFor(absPath, { git = defaultGit } = {}) {
  const dir = fs.existsSync(absPath) && fs.statSync(absPath).isDirectory() ? absPath : path.dirname(absPath);
  const rel = path.basename(absPath);
  const lsFiles = git(['ls-files', '--error-unmatch', '--', rel], dir);
  if (lsFiles.error || lsFiles.status === null) return null;
  if (lsFiles.status === 0) return 'tracked';
  if (/not a git repository/i.test(lsFiles.stderr || '')) return null;
  const ignore = git(['check-ignore', '-q', '--', rel], dir);
  if (ignore.error || ignore.status === null) return null;
  return ignore.status === 0 ? 'ignored' : 'untracked';
}

/**
 * The one classification a path resolves to — see the file header for the precedence
 * and what each state means. `root` is only used to compute the reported `path` as
 * relative; every other input is an absolute path.
 */
export function classifyAsset(mediaPathAbs, { root, sidecarPathAbs = null, tools = {} } = {}) {
  const rel = path.relative(root, mediaPathAbs);
  const sidecarAbs = sidecarPathAbs || sidecarPathFor(mediaPathAbs);
  const hasSidecar = fs.existsSync(sidecarAbs);
  const gitStatus = gitStatusFor(mediaPathAbs, tools);

  let exists = false;
  let statResult = null;
  try {
    statResult = fs.statSync(mediaPathAbs);
    exists = statResult.isFile();
  } catch {
    exists = false;
  }

  const base = {
    path: rel,
    sidecarPath: hasSidecar ? path.relative(root, sidecarAbs) : null,
    gitStatus,
  };

  if (exists && isLfsPointerFile(mediaPathAbs)) {
    const pointer = parseLfsPointer(mediaPathAbs);
    return {
      ...base,
      state: 'lfs-pointer',
      size: pointer.size,
      width: null,
      height: null,
      format: null,
      remote: hasSidecar ? readSidecar(sidecarAbs)?.remote ?? null : null,
      oid: pointer.oid,
    };
  }

  if (exists) {
    const ext = path.extname(mediaPathAbs).toLowerCase();
    let dims = null;
    if (SIPS_EXTENSIONS.has(ext)) dims = nativeDimensions([mediaPathAbs], tools).get(mediaPathAbs) ?? null;
    return {
      ...base,
      state: 'bytes',
      size: statResult.size,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      format: dims?.format ?? null,
      remote: hasSidecar ? readSidecar(sidecarAbs)?.remote ?? null : null,
    };
  }

  if (hasSidecar) {
    const front = readSidecar(sidecarAbs);
    if (front?.remote) {
      return {
        ...base,
        state: 'sidecar-only',
        size: typeof front.bytes === 'number' ? front.bytes : null,
        width: typeof front.width === 'number' ? front.width : null,
        height: typeof front.height === 'number' ? front.height : null,
        format: front.format ?? null,
        remote: front.remote,
      };
    }
    // A sidecar that exists but names no remote — dangling. Reported as `missing`
    // (see file header) with `sidecarPath` still set, so the report says *why* it is
    // missing rather than folding it into "nothing here at all".
    return { ...base, state: 'missing', size: null, width: null, height: null, format: null, remote: null };
  }

  return { ...base, state: 'missing', size: null, width: null, height: null, format: null, remote: null };
}

/** The whole command, minus argv parsing and printing: resolve targets, classify each,
 * report what the resolution itself could not place. */
export function buildReport(targets, { root = process.cwd(), tools = {} } = {}) {
  const { mediaPaths, sidecarOf, problems } = resolveTargets(targets, { cwd: root });
  const rows = mediaPaths.map((abs) =>
    classifyAsset(abs, { root, sidecarPathAbs: sidecarOf.get(abs) ?? null, tools })
  );
  return { rows, problems };
}

/** rclone's own size report for one remote object, `{present, size}` — `present: false`
 * distinguishes "the vault genuinely does not have this" from "rclone could not be run
 * at all", which the caller reports differently. */
export function remoteInfo(remote, { rclone = defaultRclone } = {}) {
  let result;
  try {
    result = rclone(['size', '--json', remote]);
  } catch (err) {
    return { present: false, size: null, error: err.message };
  }
  if (result.error) return { present: false, size: null, error: result.error.message };
  if (result.status !== 0) return { present: false, size: null };
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed.count > 0) return { present: true, size: parsed.bytes };
    return { present: false, size: null };
  } catch {
    return { present: false, size: null };
  }
}

function defaultRclone(args) {
  return spawnSync('rclone', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
}

/** Whether `rclone` and `git-lfs` are actually runnable here — the same shape
 * `lib/plate.js`'s `toolsAvailable` uses for `sips`/Pillow. */
export function toolsAvailable() {
  const rcloneCheck = spawnSync('rclone', ['version'], { encoding: 'utf8' });
  const lfsCheck = spawnSync('git-lfs', ['version'], { encoding: 'utf8' });
  return { rclone: !rcloneCheck.error, gitLfs: !lfsCheck.error };
}

/**
 * Pull a `sidecar-only` or `lfs-pointer` row's real bytes into `fetchDir`, mirroring the
 * asset's own path relative to `root` so a downstream tool (`b7e-plate`) sees the same
 * directory shape it would in a fully-materialised checkout.
 *
 * `sidecar-only`: `rclone copyto <remote> <fetchDir>/<rel>`.
 * `lfs-pointer`: `git lfs pull --include=<rel>` against `root` (the standard way to
 * smudge one path in a worktree created with `lfs.fetchexclude=*`), then the now-real
 * file at `root/<rel>` is copied into `fetchDir` — `root` itself is never left dirtier
 * than a normal `git lfs pull` would leave it, but the working tree there does change,
 * which is why this is behind an explicit flag rather than something `--remote` does on
 * its own.
 *
 * Rows already in state `bytes` are skipped (nothing to fetch) and reported as such
 * rather than silently omitted.
 */
export function fetchAsset(row, { root, fetchDir, rclone = defaultRclone, git = defaultGit } = {}) {
  if (row.state === 'bytes') return { ...row, fetched: false, reason: 'already local' };
  if (row.state === 'missing') return { ...row, fetched: false, reason: 'nothing to fetch' };

  const dest = path.join(fetchDir, row.path);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (row.state === 'sidecar-only') {
    const result = rclone(['copyto', row.remote, dest]);
    if (result.error || result.status !== 0) {
      return { ...row, fetched: false, reason: `rclone copyto failed: ${result.stderr || result.error?.message || 'unknown error'}` };
    }
    return { ...row, fetched: true, fetchedTo: dest };
  }

  // lfs-pointer
  const pullResult = git(['lfs', 'pull', `--include=${row.path}`], root);
  if (pullResult.error || pullResult.status !== 0) {
    return { ...row, fetched: false, reason: `git lfs pull failed: ${pullResult.stderr || pullResult.error?.message || 'unknown error'}` };
  }
  const smudged = path.join(root, row.path);
  if (isLfsPointerFile(smudged)) {
    return { ...row, fetched: false, reason: 'git lfs pull ran but the file is still a pointer stub' };
  }
  try {
    fs.copyFileSync(smudged, dest);
  } catch (err) {
    return { ...row, fetched: false, reason: `copy after smudge failed: ${err.message}` };
  }
  return { ...row, fetched: true, fetchedTo: dest };
}
