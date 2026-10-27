/**
 * `lib/keep.js` — where a generated file goes so that a link to it still works tomorrow.
 *
 * bc-2pysw. Every repo here generates artifacts into gitignored directories inside a
 * worktree, and a worktree is temporary: the merge queue retires it when its pull request
 * merges (`advocates.tidyWorktrees`) and the attic is swept two days later (`expireRetired`).
 * So a generated file linked to Adam has a two-day fuse and nothing says so.
 *
 * It fired on 2026-09-17. Twenty delmar pull requests merged in one sitting and four
 * contact sheets put in front of Adam were dead links four minutes later, because the merges
 * he had approved retired the worktrees holding them at 23:20:41Z. He clicked them and got
 * "The file can't be found."
 *
 * The finding that shaped this module is that the durability mechanism ALREADY EXISTED and
 * was already right: delmar's `scripts/media_vault.py` uploads to `gdrive4t:` and leaves a
 * committed sidecar, and one of those four — the P36 hold test — had been vaulted correctly
 * by its own session and was on `main` the whole time. The other three had no sidecar and
 * nothing in the vault at all. So the bug is not a missing mechanism. It is an OPTIONAL one:
 * vaulting is a thing a session must remember, it fires about one render in four, and which
 * of Adam's renders survive is decided by whoever happened to be driving.
 *
 * A keep therefore makes THREE things, and each one exists because the other two cannot do
 * its job:
 *
 *   1. A copy under the MAIN CHECKOUT, stamped. This is what makes the file clickable — a
 *      `file://` link needs local bytes, and a beadcause card's `images:` is a local absolute
 *      path. Vault-only would mean an rclone fetch before every look, which is exactly the
 *      friction that made those renders invisible.
 *   2. A copy IN THE VAULT, when the repo has one. This is persistence: sha-verified, off this
 *      laptop, findable in six months.
 *   3. A SIDECAR beside the source, which is the only one of the three that git tracks. It is
 *      what lets `fetch()` reconstitute the bytes on any machine, and it is why the caller is
 *      told to commit it.
 *
 * The root is resolved through `git rev-parse --git-common-dir`, which inside a worktree
 * answers the MAIN checkout's `.git` rather than the worktree's own gitdir. That is the whole
 * trick, and it is why every worktree of a repo agrees on one root without being told where
 * it is.
 *
 * Nothing here touches `CONFIG_DIR` or a `refs/beadcause/*` ref, so nothing is owed in
 * `lib/evidence.js`'s register.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ENV_ROOT = 'BEADCAUSE_KEEP_ROOT';
export const KEEP_DIR = path.join('.claude', 'keep');
export const LATEST = 'latest';

/** The vault module a repo is considered to have one by. delmar is the only repo with one
 *  today; the path is a convention rather than a lookup so a second repo adopts it by
 *  putting the file there, not by editing this list. */
export const VAULT_MODULE = path.join('scripts', 'media_vault.py');

/**
 * The repository's MAIN checkout, from anywhere inside it — worktree or not.
 *
 * Returns null when this is not a git checkout, or is a bare one. That is a legitimate
 * state (a tarball, a CI scratch dir), not an error: the caller falls back.
 */
export function mainCheckout(start = process.cwd()) {
  const res = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: start, encoding: 'utf8', timeout: 10_000,
  });
  if (res.status !== 0 || !res.stdout) return null;
  const common = res.stdout.trim();
  if (!common || path.basename(common) !== '.git') return null;
  return path.dirname(common);
}

/**
 * The directory keeps live under. `$BEADCAUSE_KEEP_ROOT` wins (and is what the tests use),
 * then `<main checkout>/.claude/keep`, then `fallback`.
 *
 * `.claude/` is already gitignored in every repo here, which is the point: a keep is never
 * committed, and the main checkout is not a thing that gets retired.
 */
export function keepRoot({ start = process.cwd(), fallback = null } = {}) {
  if (process.env[ENV_ROOT]) return path.resolve(process.env[ENV_ROOT]);
  const main = mainCheckout(start);
  if (main) return path.join(main, KEEP_DIR);
  if (fallback) return path.resolve(fallback);
  return null;
}

/** `YYYYmmdd-HHMMSS`, UTC-naive local time — the same shape delmar's publish layer used. */
export function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-`
       + `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/**
 * Repoint `<nameDir>/latest` at this keep.
 *
 * A symlink where the filesystem allows one, a `latest.txt` holding the directory name where
 * it does not — the caller has to be able to say "the newest one" in a link, and a broken
 * symlink is worse than a one-line pointer.
 */
export function pointLatest(nameDir, stampDir) {
  const link = path.join(nameDir, LATEST);
  const target = path.basename(stampDir);
  try {
    if (fs.existsSync(link) || fs.lstatSync(link, { throwIfNoEntry: false })) {
      const st = fs.lstatSync(link, { throwIfNoEntry: false });
      if (st?.isDirectory() && !st.isSymbolicLink()) fs.rmSync(link, { recursive: true });
      else fs.rmSync(link, { force: true });
    }
    fs.symlinkSync(target, link);
    return link;
  } catch {
    try {
      fs.writeFileSync(`${link}.txt`, `${target}\n`);
      return `${link}.txt`;
    } catch {
      return null;
    }
  }
}

/** Where `latest` points for this name, as an absolute directory, or null. */
export function readLatest(name, { root = null, start = process.cwd() } = {}) {
  const base = root || keepRoot({ start });
  if (!base) return null;
  const nameDir = path.join(base, name);
  const link = path.join(nameDir, LATEST);
  const st = fs.lstatSync(link, { throwIfNoEntry: false });
  if (st) return fs.realpathSync(link);
  const txt = `${link}.txt`;
  if (fs.existsSync(txt)) {
    const n = fs.readFileSync(txt, 'utf8').trim();
    if (n) return path.join(nameDir, n);
  }
  return null;
}

/** Every stamped keep under this name, oldest first — the history a link can pin to. */
export function keeps(name, { root = null, start = process.cwd() } = {}) {
  const base = root || keepRoot({ start });
  if (!base) return [];
  const nameDir = path.join(base, name);
  if (!fs.existsSync(nameDir)) return [];
  return fs.readdirSync(nameDir).sort()
    .filter((n) => n !== LATEST && n !== `${LATEST}.txt`)
    .map((n) => path.join(nameDir, n))
    .filter((p) => {
      const st = fs.lstatSync(p, { throwIfNoEntry: false });
      return st && st.isDirectory() && !st.isSymbolicLink();
    });
}

/** Does this repo have a media vault to publish into? Returns its absolute path, or null. */
export function vaultModule(start = process.cwd()) {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: start, encoding: 'utf8', timeout: 10_000,
  });
  if (res.status !== 0 || !res.stdout) return null;
  const top = res.stdout.trim();
  const mod = path.join(top, VAULT_MODULE);
  return fs.existsSync(mod) ? mod : null;
}

/**
 * Publish one file into the repo's media vault and write its sidecar.
 *
 * `keep_local=True` is not optional and not a preference: `publish()`'s default DELETES the
 * local file once it is uploaded, which would leave exactly the half of a keep that cannot be
 * clicked. The sidecar is written beside the SOURCE, not beside the kept copy, because the
 * sidecar is the only part of a keep that git tracks and it has to land somewhere the caller
 * can commit it.
 *
 * An LFS pointer is refused by `media_vault.publish` itself, loudly. That refusal is carried
 * back rather than swallowed — publishing a 130-byte stub as though it were the image is the
 * failure the guard exists for.
 */
export function vaultPublish(file, { module: mod = null, python = 'python3' } = {}) {
  const modPath = mod || vaultModule(path.dirname(file));
  if (!modPath) return { ok: false, skipped: 'no media vault in this repo' };
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(path.dirname(modPath))})`,
    'import media_vault as mv',
    'try:',
    `    sc = mv.publish(${JSON.stringify(file)}, keep_local=True, generator="b7e-keep")`,
    '    front = mv.read_sidecar(sc)',
    '    print(json.dumps({"ok": True, "sidecar": str(sc), "remote": front.get("remote"),'
      + ' "sha256": front.get("sha256"), "bytes": front.get("bytes")}))',
    'except Exception as exc:',
    '    print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))',
  ].join('\n');
  const res = spawnSync(python, ['-c', script], {
    cwd: path.dirname(modPath), encoding: 'utf8', timeout: 1_800_000,
  });
  if (res.status !== 0) {
    return { ok: false, error: (res.stderr || res.stdout || 'vault call failed').trim().slice(-800) };
  }
  try {
    return JSON.parse(res.stdout.trim().split('\n').pop());
  } catch {
    return { ok: false, error: `unreadable vault output: ${res.stdout.trim().slice(-300)}` };
  }
}

/**
 * Keep these files: copy them out of the worktree, vault them, and report every path.
 *
 * Never throws. A keep is filing, not work — a render that already succeeded must not be
 * failed by the bookkeeping that follows it, so problems come back under `errors`.
 */
export function keep(files, {
  as = null, root = null, start = process.cwd(), now = new Date(),
  vault = true, python = 'python3',
} = {}) {
  const present = (files || []).map((f) => path.resolve(f)).filter((f) => {
    const st = fs.statSync(f, { throwIfNoEntry: false });
    return st && st.isFile();
  });
  const missing = (files || []).filter((f) => {
    const st = fs.statSync(path.resolve(f), { throwIfNoEntry: false });
    return !(st && st.isFile());
  });
  const errors = missing.map((f) => `no such file: ${f}`);
  if (!present.length) return { ok: false, dir: null, files: [], errors: errors.length ? errors : ['nothing to keep'] };

  const base = root || keepRoot({ start });
  if (!base) return { ok: false, dir: null, files: [], errors: [...errors, 'no keep root: not a git checkout, and no ' + ENV_ROOT] };

  const name = as || path.basename(path.dirname(present[0])) || 'keep';
  const nameDir = path.join(base, name);
  const stampDir = path.join(nameDir, stamp(now));
  const out = { ok: true, name, dir: stampDir, files: [], vault: [], errors };
  try {
    fs.mkdirSync(stampDir, { recursive: true });
  } catch (exc) {
    return { ok: false, dir: stampDir, files: [], errors: [...errors, `could not create ${stampDir}: ${exc.message}`] };
  }

  for (const src of present) {
    const dest = path.join(stampDir, path.basename(src));
    try {
      fs.copyFileSync(src, dest);
      out.files.push({ source: src, kept: dest });
    } catch (exc) {
      out.errors.push(`${src}: ${exc.message}`);
      continue;
    }
    if (vault) {
      const v = vaultPublish(src, { python });
      out.vault.push({ source: src, ...v });
      if (v.ok === false && v.error) out.errors.push(`vault ${path.basename(src)}: ${v.error}`);
    }
  }

  out[LATEST] = pointLatest(nameDir, stampDir);
  out.ok = out.files.length > 0;
  return out;
}
