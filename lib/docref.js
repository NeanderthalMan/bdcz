/**
 * A document read at a git ref rather than from the disk — bc-03vg2.1.
 *
 * `/api/asset?p=` streams a file, so a draft that exists only on an unmerged pull
 * request's branch is readable only through its worktree's path, and that link dies the
 * moment the worktree is retired. `ref=` asks for the file as the branch has it instead:
 * the blob lives in the repo's object store for as long as the branch (or its pushed
 * copy) does, whether or not any checkout of it is still on disk.
 *
 * Three things this file has to get right, and each is the reason for a piece of it:
 *
 * 1. **Which repo, from a path that may not exist any more.** A path under
 *    `<repo>/.claude/worktrees/<name>/…` names the main repo plus the part after
 *    `<name>/` — every worktree shares the main repo's objects, and the worktree
 *    directory is exactly the thing that is gone. Any other path is walked up to the
 *    nearest ancestor that exists and holds a `.git`, because the file itself need not
 *    exist in the working tree (a chapter added on the branch and never on main).
 * 2. **Reach.** The same `assetRoots` and servable-extension checks `/api/asset`
 *    already makes, applied to the realpath of the *repo* joined with the relative path —
 *    the only part of the path that can be realpath'd when the file is not on disk.
 * 3. **Nothing unvalidated reaches git.** `ref` is a full or abbreviated object name or a
 *    ref name that passes `git check-ref-format --branch`, and a ref that starts with `-`
 *    or carries `@{`, `:` or whitespace is refused before git is asked anything. Git is
 *    run through `execFile`, never a shell, so even a string that slipped past would be
 *    one argument and not a command.
 *
 * A branch whose local ref is gone — merged elsewhere, pruned, fetched only as
 * `origin/<name>` — still resolves: `<ref>` is tried first and then `origin/<ref>`. No
 * fetch is made; a reader tab opening is not a reason to talk to GitHub.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const SHA_RE = /^[0-9a-f]{7,64}$/;
// Before git is asked: the characters a ref name can hold, and none it cannot.
// check-ref-format is the authority; this is the cheap refusal ahead of it.
const REF_CHARS = /^[A-Za-z0-9._\/-]+$/;
const WORKTREE_SEG = `${path.sep}.claude${path.sep}worktrees${path.sep}`;

const fail = (status, message) => Object.assign(new Error(message), { status });

function gitIn(cwd, args, opts = {}) {
  return run('git', args, { cwd, timeout: 15000, maxBuffer: 64 * 1024 * 1024, ...opts });
}

/** Whether `ref` may be handed to git at all. Throws a 400 when it may not. */
export async function checkRef(ref, cwd = process.cwd()) {
  const s = String(ref ?? '');
  if (!s || s.length > 255 || s.startsWith('-') || !REF_CHARS.test(s)) throw fail(400, `not a git ref: "${s.slice(0, 80)}"`);
  if (SHA_RE.test(s)) return s;
  try {
    await gitIn(cwd, ['check-ref-format', '--branch', s]);
  } catch {
    throw fail(400, `not a git ref: "${s}"`);
  }
  return s;
}

/** The git blob object name of some bytes — what `git hash-object` would print. */
export function blobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

/**
 * The repo a path belongs to, and the path relative to it.
 *
 * `{ repo, rel }` or null. `repo` is a directory that exists; `rel` uses `/` and never
 * climbs out of it.
 */
export function locate(abs) {
  const p = path.resolve(String(abs || ''));
  const at = p.indexOf(WORKTREE_SEG);
  if (at > 0) {
    const repo = p.slice(0, at);
    const rest = p.slice(at + WORKTREE_SEG.length).split(path.sep);
    // `<name>/<rel…>` — a path that stops at the worktree itself names no file.
    if (rest.length >= 2 && rest[0] && fs.existsSync(path.join(repo, '.git'))) {
      return { repo, rel: rest.slice(1).join('/') };
    }
  }
  let dir = path.dirname(p);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      const rel = path.relative(dir, p);
      if (!rel || rel.startsWith('..')) return null;
      return { repo: dir, rel: rel.split(path.sep).join('/') };
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Read `raw` (an absolute path, or `file://`) as it is at `ref`.
 *
 * `allowed(realPath)` is the caller's reach check — the same one `/api/asset` makes —
 * handed the path the file *would* have in the repo's working tree. Resolves to
 * `{ body: Buffer, blob, ref, repo, rel, path }`, where `ref` is the name that actually
 * resolved (`origin/<x>` when the local branch was gone). Throws with a `status`.
 */
export async function readAtRef(raw, ref, { allowed } = {}) {
  let p = String(raw || '');
  if (p.startsWith('file://')) p = decodeURIComponent(new URL(p).pathname);
  if (!path.isAbsolute(p)) throw fail(400, 'an absolute path is required');
  const where = locate(p);
  if (!where) throw fail(404, 'not inside a git repository');
  const repo = await fsp.realpath(where.repo);
  const would = path.join(repo, ...where.rel.split('/'));
  if (allowed && !(await allowed(would))) throw fail(403, 'path not in assetRoots');

  const name = await checkRef(ref, repo);
  const tries = SHA_RE.test(name) ? [name] : [name, `origin/${name}`];
  let commit = '';
  let used = '';
  for (const t of tries) {
    try {
      const { stdout } = await gitIn(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${t}^{commit}`]);
      commit = stdout.trim();
      used = t;
      break;
    } catch {
      // not this one — the next, or a 404 below
    }
  }
  if (!commit) throw fail(404, `no such ref in ${path.basename(repo)}: ${name}`);

  let blob = '';
  try {
    const { stdout } = await gitIn(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${commit}:${where.rel}`]);
    blob = stdout.trim();
  } catch {
    throw fail(404, `${where.rel} is not on ${used}`);
  }
  const { stdout: type } = await gitIn(repo, ['cat-file', '-t', blob]);
  if (type.trim() !== 'blob') throw fail(404, `${where.rel} is not a file on ${used}`);
  const { stdout: body } = await gitIn(repo, ['cat-file', 'blob', blob], { encoding: 'buffer' });
  return { body, blob, ref: used, commit, repo, rel: where.rel, path: would };
}
