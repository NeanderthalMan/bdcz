/**
 * `lib/pyenv.js` — every Python interpreter a repo's session might already have set up,
 * what each one has installed, and what is sitting in the shared Hugging Face cache.
 *
 * bc-dgx7.180: five loremia sessions (lm-52r.55, lm-52r.61, lm-52r.56, lm-52r.57,
 * lm-52r.62) each rediscovered this by hand, a different way every time — testing
 * `python3 -c "import torch"`, listing `~/.venvs`, globbing scratchpad venvs that had
 * already vanished with the session that built them, `du -sh`-ing the Hugging Face
 * cache directory by directory. Two of them built a venv in a scratchpad that the next
 * session could not find, because nothing records where a working one already is. This
 * module is the read: which interpreters exist, what each already has, and what model
 * weight is already on disk — so a session asks once instead of rediscovering it.
 *
 * Split from `bin/b7e-pyenv`, which is the argv parsing and the printing; everything
 * here is disk reads and short-lived subprocesses a test can drive without spawning the
 * command itself.
 *
 * Nothing here writes anything and nothing here touches `CONFIG_DIR` or a
 * `refs/beadcause/*` ref, so it owes no entry in `lib/evidence.js`'s register.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

/** `~/projects/<workspace>` — the one-repo-per-workspace convention every
 * other b7e-* tool that assumes "this Mac" already uses (see `lib/sheet.js`'s
 * `defaultSorrelRoot`). Not resolved through `lib/repos.js`: that module answers "which
 * of many approved checkouts", and every workspace this command is asked about is the
 * ordinary single-repo case that resolver never had to name. */
export function defaultRepoRoot(workspaceName, { homeDir = os.homedir() } = {}) {
  return path.join(homeDir, 'projects', String(workspaceName || '').trim());
}

/** Repo-local virtualenv directory names this repo's own sessions have actually built,
 * named in the bead's own session evidence: `.venv` (the generic default), `.pwenv` and
 * `.ltxenv` (lm-52r.56/lm-52r.55's own names), plus the two spellings `uv`/`python -m
 * venv` both produce (`venv`, `env`). */
export const REPO_LOCAL_ENV_NAMES = ['.venv', '.pwenv', '.ltxenv', 'venv', 'env'];

const PYTHON_NAMES = ['bin/python3', 'bin/python'];

/** The python executable inside an env root, or `null` if there is none — an env root
 * is a directory with a `bin/python` or `bin/python3` in it, whichever a builder chose. */
export function pythonOf(envDir) {
  for (const rel of PYTHON_NAMES) {
    const p = path.join(envDir, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Every directory under `dir` whose name ends in "env" (case-folded) — the shape both
 * `~/.local/share/<repo>/ldenv` and a hand-built `falvenv` share, and the shape
 * `lm-52r.55` moved a scratchpad env INTO on purpose because a repo checkout's own venvs
 * are not gitignored there. `[]` for a directory that does not exist or is not readable. */
function envLikeChildDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && /env$/i.test(e.name))
      .map((e) => path.join(dir, e.name))
      .filter((p) => {
        try {
          return fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

/** Scratchpad venvs that outlived the session that built them — `lm-52r.61` found none
 * this way and built a fresh one; a later session should not repeat the search by hand.
 * Every Claude Code scratchpad on this Mac lives under
 * `/private/tmp/claude-<uid>/<cwd-slug>/<session-id>/scratchpad/`, so a survivor is any
 * scratchpad-relative env dir holding a `bin/python` or `bin/python3`. Bounded by
 * `maxAgeDays` (default 30) so a years-old orphaned scratchpad is not offered as
 * though it were live. */
export function scratchpadEnvDirs({ scratchpadRoot = '/private/tmp', maxAgeDays = 30 } = {}) {
  const out = [];
  let uidDirs;
  try {
    uidDirs = fs.readdirSync(scratchpadRoot).filter((n) => n.startsWith('claude-'));
  } catch {
    return out;
  }
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const uidDir of uidDirs) {
    const sessionsRoot = path.join(scratchpadRoot, uidDir);
    let cwdSlugs;
    try {
      cwdSlugs = fs.readdirSync(sessionsRoot);
    } catch {
      continue;
    }
    for (const cwdSlug of cwdSlugs) {
      let sessionIds;
      const cwdDir = path.join(sessionsRoot, cwdSlug);
      try {
        sessionIds = fs.readdirSync(cwdDir);
      } catch {
        continue;
      }
      for (const sessionId of sessionIds) {
        const scratchpadDir = path.join(cwdDir, sessionId, 'scratchpad');
        for (const envDir of envLikeChildDirs(scratchpadDir)) {
          let mtimeMs;
          try {
            mtimeMs = fs.statSync(envDir).mtimeMs;
          } catch {
            continue;
          }
          if (mtimeMs >= cutoff) out.push(envDir);
        }
      }
    }
  }
  return out.sort();
}

/** `which python3` on PATH, or `null`. The one interpreter this never has to guess a
 * location for. */
export function systemPython3() {
  try {
    const out = execFileSync('which', ['python3'], { encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Every candidate env root worth probing for one workspace, deduplicated, in the order
 * a session would actually want to try them: the repo's own venvs first (the ones this
 * checkout's own tooling would use), then the durable per-repo share directory (what
 * `lm-52r.55` moved into on purpose, so it survives), then whatever scratchpad venv is
 * still on disk (the least durable, so tried last).
 *
 * Returns `{ system: <path-or-null>, envs: [envRoot, ...] }` — `system` is python3 on
 * PATH, kept separate because it has no env root of its own to name.
 */
export function candidateEnvironments(workspaceName, { homeDir = os.homedir(), repoRoot, scratchpadRoot } = {}) {
  const root = repoRoot || defaultRepoRoot(workspaceName, { homeDir });
  const envs = [];
  for (const name of REPO_LOCAL_ENV_NAMES) {
    const p = path.join(root, name);
    if (pythonOf(p)) envs.push(p);
  }
  const shareDir = path.join(homeDir, '.local', 'share', String(workspaceName || '').trim());
  for (const p of envLikeChildDirs(shareDir)) {
    if (pythonOf(p) && !envs.includes(p)) envs.push(p);
  }
  for (const p of scratchpadEnvDirs(scratchpadRoot ? { scratchpadRoot } : {})) {
    if (pythonOf(p) && !envs.includes(p)) envs.push(p);
  }
  return { system: systemPython3(), envs };
}

const PROBE_TIMEOUT_MS = 15_000;

/** One module's version as that interpreter sees it, or `null` if it is missing. Uses
 * `importlib.metadata` rather than trusting a module's own `__version__` (some packages
 * — `fal_client` among them — don't set one), falling back to `__version__` for anything
 * `importlib.metadata` can't resolve (a module that is not also its own distribution
 * name, which does not arise for the packages this command is asked about but is
 * cheap to guard). */
function moduleVersion(pythonPath, mod) {
  const top = mod.split('.')[0];
  const script = [
    'import sys',
    `mod = ${JSON.stringify(mod)}`,
    `top = ${JSON.stringify(top)}`,
    'try:',
    '    __import__(mod)',
    'except Exception:',
    '    sys.exit(1)',
    'v = None',
    'try:',
    '    import importlib.metadata as im',
    '    v = im.version(top)',
    'except Exception:',
    '    v = None',
    'if v is None:',
    '    v = getattr(sys.modules[mod], "__version__", None)',
    'print(v if v is not None else "unknown")',
  ].join('\n');
  const res = spawnSync(pythonPath, ['-c', script], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  if (res.status !== 0) return null;
  return String(res.stdout || '').trim() || 'unknown';
}

/** Whether this interpreter's torch sees Apple's Metal backend — `null` when torch is
 * missing or the check itself fails, never thrown. */
function mpsAvailable(pythonPath) {
  const res = spawnSync(pythonPath, ['-c', 'import torch;print(bool(torch.backends.mps.is_available()))'], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
  });
  if (res.status !== 0) return null;
  return String(res.stdout || '').trim() === 'True';
}

/**
 * One interpreter, probed: its own version, one entry per requested module (a version
 * string or `null` for "missing"), and whether it sees MPS — only asked when `torch` was
 * itself requested and found, since asking a torch-less interpreter about MPS is not a
 * question that means anything.
 */
export function probeInterpreter(pythonPath, needs = []) {
  const versionRes = spawnSync(pythonPath, ['--version'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  const version =
    versionRes.status === 0
      ? String(versionRes.stdout || versionRes.stderr || '').trim().replace(/^Python\s+/, '')
      : null;
  const modules = {};
  for (const mod of needs) modules[mod] = version === null ? null : moduleVersion(pythonPath, mod);
  const mps = needs.includes('torch') && modules.torch ? mpsAvailable(pythonPath) : null;
  return { path: pythonPath, version, modules, mps };
}

/** Every candidate interpreter for a workspace, each probed against `needs`. `label` is
 * what a report names the row — `"system python3"` for the PATH one, the env root
 * otherwise, so a reader never has to reverse-engineer which is which. */
export function probeAll(workspaceName, needs = [], opts = {}) {
  const { system, envs } = candidateEnvironments(workspaceName, opts);
  const rows = [];
  if (system) rows.push({ label: 'system python3', ...probeInterpreter(system, needs) });
  for (const envDir of envs) {
    const py = pythonOf(envDir);
    if (py) rows.push({ label: envDir, ...probeInterpreter(py, needs) });
  }
  return rows;
}

/** The row (if any) whose every requested module resolved — `null`, never a row, when
 * `needs` names nothing there is no requirement to satisfy. */
export function satisfiesAll(rows, needs = []) {
  if (!needs.length) return null;
  return rows.find((r) => needs.every((m) => r.modules[m])) || null;
}

/* ------------------------------------------------------------ Hugging Face cache */

export const DEFAULT_HF_HUB_DIR = (homeDir = os.homedir()) => path.join(homeDir, '.cache', 'huggingface', 'hub');

/** Cache dir name (`models--org--repo`, `datasets--repo`) → the ordinary `org/repo` (or
 * bare `repo`) spelling everything else on this Mac uses to refer to the same model. */
export function repoNameFromCacheDirName(dirName) {
  const m = /^(models|datasets)--(.+)$/.exec(dirName);
  if (!m) return null;
  return { kind: m[1], name: m[2].split('--').join('/') };
}

/** `1.5G`, `3.4G`, `842M` — `du -sh`'s own style, base-1024, one decimal, because that
 * is the number every session in this bead's own evidence already wrote down by hand. */
export function formatSize(bytes) {
  const units = ['B', 'K', 'M', 'G', 'T'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : 1;
  return `${n.toFixed(digits)}${units[i]}`;
}

/** Weight-file extensions — a cache entry counts as having a real model on disk only if
 * one of these actually landed, not just the config/tokenizer/README files a partial or
 * metadata-only pull leaves behind. */
export const WEIGHT_EXTENSIONS = ['.safetensors', '.bin', '.ckpt', '.pt', '.pth', '.onnx', '.gguf', '.msgpack', '.h5'];

/** Below this many real bytes on disk, an entry reads as metadata rather than a model —
 * a downloaded `config.json`/`tokenizer.json`/README is a few KB; every weight format
 * this command knows about is orders of magnitude larger, so there is no real model this
 * threshold could misclassify. */
const METADATA_ONLY_BYTES = 1_000_000;

/** Real bytes on disk for one cache entry. The Hugging Face hub cache layout is
 * `blobs/<hash>` (the actual content) with `snapshots/<rev>/<filename>` symlinking to
 * it — so the blobs directory alone is the entry's real size, and summing it directly
 * is both correct and much cheaper than walking snapshot symlinks and deduplicating by
 * inode. Falls back to a plain recursive real-file sum for anything that does not use
 * that layout (a manually-populated cache, or a test fixture that skips it). */
function entrySizeBytes(entryDir) {
  const blobsDir = path.join(entryDir, 'blobs');
  if (fs.existsSync(blobsDir)) return sumFileSizes(blobsDir);
  return sumFileSizes(entryDir);
}

function sumFileSizes(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      total += sumFileSizes(p);
    } else {
      try {
        total += fs.statSync(p).size;
      } catch {
        // gone between readdir and stat — not this call's problem
      }
    }
  }
  return total;
}

/** Every filename a snapshot names, walked all the way down — read off `snapshots/*`,
 * the human-readable layer, rather than off `blobs/` (whose files are named by hash and
 * carry no extension). Recursive because a diffusers-format repo nests its weight
 * files a folder deep per component (`unet/diffusion_pytorch_model.safetensors`,
 * `image_encoder/model.safetensors`) — a flat read of the revision directory sees only
 * the component folder names and never the weight files inside them. Used only to
 * decide whether a weight file is *among* what was pulled; `entrySizeBytes` above is
 * still what answers how big. */
function snapshotFilenames(entryDir) {
  const snapshotsDir = path.join(entryDir, 'snapshots');
  const names = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else names.add(e.name);
    }
  };
  let revs;
  try {
    revs = fs.readdirSync(snapshotsDir);
  } catch {
    return names;
  }
  for (const rev of revs) walk(path.join(snapshotsDir, rev));
  return names;
}

/**
 * One Hugging Face cache entry, sized and classified.
 *
 * `sizeBytes` is the real bytes on disk. `metadataOnly` is true when nothing that looks
 * like a weight file is on disk yet (a config/tokenizer-only pull, `lm-52r.57`'s
 * Depth-Anything-V2-Base finding) — checked by name against `WEIGHT_EXTENSIONS` first,
 * and by the size floor as a fallback for a cache whose snapshot symlinks are gone
 * (a `--dir`-pointed fixture, or a cache pruned by something other than this tool).
 */
export function describeCacheEntry(entryDir) {
  const dirName = path.basename(entryDir);
  const parsed = repoNameFromCacheDirName(dirName);
  if (!parsed) return null;
  const sizeBytes = entrySizeBytes(entryDir);
  const filenames = snapshotFilenames(entryDir);
  const namedWeight = [...filenames].some((f) => WEIGHT_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)));
  const metadataOnly = filenames.size ? !namedWeight : sizeBytes < METADATA_ONLY_BYTES;
  return { ...parsed, dir: entryDir, sizeBytes, metadataOnly, sizeLabel: metadataOnly ? 'metadata only' : formatSize(sizeBytes) };
}

/** Every entry in the Hugging Face hub cache, optionally narrowed to those whose
 * `org/repo` name matches `modelGlob` (a plain substring match — the bead's own
 * `--model <hf-repo-glob>` is a filter a session types from memory, not a real glob
 * engine to get exactly right). Sorted by size, largest first, because that is the
 * order a session asking "what's already on disk" actually wants to read it in. */
export function hfCacheEntries({ homeDir = os.homedir(), hubDir, modelGlob } = {}) {
  const dir = hubDir || DEFAULT_HF_HUB_DIR(homeDir);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const wanted = modelGlob ? String(modelGlob).toLowerCase() : null;
  const out = [];
  for (const name of names) {
    const entry = describeCacheEntry(path.join(dir, name));
    if (!entry) continue;
    if (wanted && !entry.name.toLowerCase().includes(wanted)) continue;
    out.push(entry);
  }
  out.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return out;
}
