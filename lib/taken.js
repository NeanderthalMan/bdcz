/**
 * Is this command name free — in `bin/`, in the two registration files, in the docs, on
 * `origin/main`, in an open pull request, in a live worktree, and in the tracker?
 *
 * bc-dgx7.135, filed by the session audit against four sessions (bc-dgx7.67, bc-dgx7.70,
 * bc-dgx7.73, bc-dgx7.66) that each answered "is this name already taken?" by hand, each
 * from a different subset of these seven places, and the worst of the four — bc-dgx7.67 —
 * checked the most and still got it wrong: it missed the open pull request and the live
 * worktree that had already claimed the name three days earlier, shipped under it, then
 * had to supersede a bead and rename a command. Nothing in the repo could see a name being
 * minted on another branch, in an open pull request, in one of the several dozen live
 * worktrees, or named in an open bead — this is that missing seventh place.
 *
 * ## The seven claim sites, and why each one is checked the way it is
 *
 * 1. **`bin/` in the checkout being asked from** (`dir`, not `main`) — a plain file
 *    existence check. This is deliberately the *caller's* checkout, because a name a
 *    session is about to mint locally is exactly the case "is it free" has to answer
 *    before the first `Write`.
 * 2. **`package.json`'s `bin` and `package-lock.json`'s `packages[""].bin`**, checked
 *    together as one claim — `test/lockfile.mjs` is pinned first in the sweep precisely
 *    because the two are meant to always agree, so a caller does not need two answers
 *    for what is really one registration.
 * 3. **A markdown heading naming it in backticks**, in `README.md` or any `docs/*.md` —
 *    not `README.md` alone, because `readme-split-862` (this repo's own memory) moved
 *    the whole `b7e-*` command surface out of it — into `docs/b7e-tools.md`, and since
 *    bc-fmk4v into a file per tool under `docs/b7e/` — and a check that only read
 *    `README.md` would call every shipped command "free".
 * 4. **`bin/<name>` at the tip of `origin/main`** — the shared truth, not the local
 *    `main` branch, which can be ahead or behind it.
 * 5. **Every open pull request whose head branch's tip already has `bin/<name>`** — a
 *    file check on the branch's own tree (`git cat-file -e
 *    refs/remotes/origin/<branch>:bin/<name>`), not a text search over titles and
 *    bodies. A PR titled for a different reason can still be the one that first adds a
 *    name, and a PR that merely *mentions* a name in prose must not count.
 * 6. **Every live worktree (not retired) whose own working tree already has
 *    `bin/<name>`** — a filesystem check against the worktree's real directory, not
 *    against its last commit. `two-skill-beads-can-claim-the-same-b7e-name` (this
 *    repo's own memory) found 457 lines of finished, wholly *uncommitted* work sitting
 *    in exactly such a worktree, invisible to every git-log-based search; only reading
 *    the directory itself finds that.
 * 7. **Any bead, in any workspace passed in, whose title or description names it** —
 *    word-bounded so `b7e-dup` cannot cross-match `b7e-dup2`, and restricted to beads
 *    that are not closed, since a closed bead's proposal is not a live claim (see
 *    `two-skill-beads-can-claim-the-same-b7e-name`: a name proposed in a bead's body is
 *    a proposal, not a reservation, right up until something else lands on it — but
 *    while that bead is still open, it is exactly the kind of claim this exists to
 *    surface before a second session collides with it).
 *
 * Every check above `dir` and `main` runs against `main` — `mainCheckout(dir)` — so a
 * worktree's own possibly-stale view of `refs/remotes/origin/*` never decides this.
 *
 * A candidate claim is a lead, not a verdict for the caller to argue with: this only
 * says what already exists and where, the same posture `lib/dup.js` and `lib/prior.js`
 * take. It never opens a pull request, comments on a bead, or touches a worktree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { git, gitCode, mainCheckout } from './gitref.js';
import { parseWorktrees } from './tidy.js';
import { specFiles } from './docset.js';
import * as pr from './pr.js';

/** A plausible `bin/` command name — letters, digits, dot, underscore, dash. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidName(name) {
  return NAME_RE.test(String(name ?? ''));
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary match for a hyphenated name inside free text — the same shape
 * `lib/prior.js`'s `grepPattern` uses for a bead id, because `\b` in JS does not treat
 * `-` as a boundary and would let `b7e-dup` match inside `b7e-dup2` or `xb7e-dup`.
 */
function namesLiteral(text, name) {
  if (!text) return false;
  const re = new RegExp(`(^|[^A-Za-z0-9_.-])${escapeRegExp(name)}([^A-Za-z0-9_.-]|$)`);
  return re.test(text);
}

/** 1. `bin/<name>` in the checkout being asked from. */
function binFileClaim(dir, name) {
  const file = path.join(dir, 'bin', name);
  return fs.existsSync(file) ? { kind: 'bin', detail: `bin/${name}`, path: file } : null;
}

/** 2. `package.json`'s `bin` and `package-lock.json`'s `packages[""].bin`, as one claim. */
function registrationClaim(dir, name) {
  let inPkg = false;
  let inLock = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    inPkg = Boolean(pkg.bin && Object.prototype.hasOwnProperty.call(pkg.bin, name));
  } catch {
    /* no package.json here, or it does not parse — not a claim */
  }
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    const rootBin = lock.packages?.['']?.bin;
    inLock = Boolean(rootBin && Object.prototype.hasOwnProperty.call(rootBin, name));
  } catch {
    /* likewise */
  }
  if (!inPkg && !inLock) return null;
  const where = inPkg && inLock ? 'package.json and package-lock.json' : inPkg ? 'package.json only, package-lock.json is missing it' : 'package-lock.json only, package.json is missing it';
  return { kind: 'registration', detail: where, inPkg, inLock };
}

/**
 * 3. A `###` section naming `<name>` in backticks, anywhere in the specification —
 * `lib/docset.js`'s own `README.md` + `docs/*.md` set, and the same `^### .*\`name\``
 * shape `lib/enroll.js`'s `readmeProblem` checks a tool's own docs against, so this and
 * `b7e-enroll` never disagree about whether a command is documented.
 */
function docsClaim(dir, name) {
  const pattern = new RegExp('^### .*`' + escapeRegExp(name) + '`', 'm');
  for (const file of specFiles(dir)) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (pattern.test(lines[i])) {
        return { kind: 'docs', detail: `${file}:${i + 1} — ${lines[i].trim()}`, file, line: i + 1 };
      }
    }
  }
  return null;
}

/** 4. `bin/<name>` at the tip of `origin/main`. */
async function mainClaim(main, name) {
  const { code } = await gitCode(main, ['cat-file', '-e', `origin/main:bin/${name}`]);
  return code === 0 ? { kind: 'main', detail: `bin/${name} on origin/main` } : null;
}

/**
 * Every open pull request, fetched once and reused for every name being checked —
 * `b7e-taken` takes more than one name in a single call, and a `gh pr list` plus its
 * `available()` probe per name would multiply the one call this needs into one per name.
 */
async function openPrRows(main) {
  const avail = await pr.available();
  if (!avail.ok) return [];
  try {
    return await pr.list(main, { state: 'open', limit: 100 });
  } catch {
    return [];
  }
}

/** 5. Every open pull request (from `openPrRows`) whose head branch already has `bin/<name>`. */
async function openPrClaims(main, name, rows) {
  const claims = [];
  for (const row of rows) {
    const { code } = await gitCode(main, ['cat-file', '-e', `refs/remotes/origin/${row.branch}:bin/${name}`]);
    if (code === 0) {
      claims.push({ kind: 'pr', number: row.number, branch: row.branch, url: row.url, detail: `#${row.number} (${row.branch}) — ${row.url}` });
    }
  }
  return claims;
}

/** Every live (not retired) worktree entry, fetched once and reused for every name. */
async function liveWorktreeEntries(main) {
  const raw = await git(main, ['worktree', 'list', '--porcelain']).catch(() => '');
  const entries = parseWorktrees(raw || '');
  const liveRoot = path.resolve(main, '.claude', 'worktrees');
  const underLiveRoot = (p) => p === liveRoot || p.startsWith(liveRoot + path.sep);
  const mainResolved = path.resolve(main);
  return entries.filter((entry) => {
    const resolved = path.resolve(entry.path);
    if (resolved === mainResolved) return false; // the main checkout's own entry
    return underLiveRoot(resolved); // drop a retired one, or something else entirely
  });
}

/** 6. Every live worktree (from `liveWorktreeEntries`) whose own working tree already has it. */
function liveWorktreeClaims(name, entries) {
  const claims = [];
  for (const entry of entries) {
    if (fs.existsSync(path.join(path.resolve(entry.path), 'bin', name))) {
      claims.push({ kind: 'worktree', branch: entry.branch || null, path: entry.path, detail: `${entry.path}${entry.branch ? ` (${entry.branch})` : ''}` });
    }
  }
  return claims;
}

/** Every workspace's beads, fetched once per workspace and reused for every name. */
export async function loadTrackerRows(bd, workspaces) {
  const byWorkspace = new Map();
  for (const ws of workspaces) byWorkspace.set(ws.name, await bd.listAll(ws));
  return byWorkspace;
}

/** 7. Every open bead (from `loadTrackerRows`) whose title or description names it. */
function trackerClaims(name, workspaces, rowsByWorkspace) {
  const claims = [];
  for (const ws of workspaces) {
    for (const row of rowsByWorkspace.get(ws.name) || []) {
      if (String(row.status || '').toLowerCase() === 'closed') continue;
      const text = `${row.title || ''}\n${row.description || ''}`;
      if (!namesLiteral(text, name)) continue;
      claims.push({ kind: 'tracker', workspace: ws.name, id: row.id, title: row.title, detail: `${ws.name}/${row.id} — ${row.title}` });
    }
  }
  return claims;
}

/**
 * Every claim on each of `names`, checked against `dir` (the checkout being asked from,
 * for the two on-disk claims) and against `mainCheckout(dir)` (for everything shared —
 * main, pull requests, worktrees). `workspaces` is optional; when given, pass each
 * workspace's rows (from `loadTrackerRows`, fetched once by the caller — see there for
 * why this takes rows rather than `bd` itself) in `trackerRowsByWorkspace`. Without
 * either, the tracker simply is not checked, the same degrade `lib/prior.js`'s
 * pull-request half takes when `gh` is unavailable.
 *
 * The pull request list and the worktree list are each fetched once here and reused for
 * every name — `checkNames(dir, ['a', 'b', 'c'])` costs one `gh pr list` and one `git
 * worktree list`, not three.
 */
export async function checkNames(dir, names, { workspaces = [], trackerRowsByWorkspace = new Map() } = {}) {
  const bad = names.filter((n) => !isValidName(n));
  if (bad.length) {
    throw new Error(`not a plausible command name: ${bad.map((n) => JSON.stringify(n)).join(', ')}`);
  }
  const main = await mainCheckout(dir);
  const [prRows, wtEntries] = await Promise.all([openPrRows(main), liveWorktreeEntries(main)]);

  const results = [];
  for (const name of names) {
    const claims = [];

    const bin = binFileClaim(dir, name);
    if (bin) claims.push(bin);

    const reg = registrationClaim(dir, name);
    if (reg) claims.push(reg);

    const docs = docsClaim(dir, name);
    if (docs) claims.push(docs);

    const onMain = await mainClaim(main, name);
    if (onMain) {
      // Already shared truth — every worktree here branched from main and inherits the
      // file trivially, so listing all of them on top of "it's on origin/main" would be
      // noise rather than a second claimant. The open-PR and live-worktree checks exist
      // for the case this bead was actually filed over: a name claimed *before* it lands.
      claims.push(onMain);
    } else {
      claims.push(...(await openPrClaims(main, name, prRows)));
      claims.push(...liveWorktreeClaims(name, wtEntries));
    }

    if (workspaces.length) claims.push(...trackerClaims(name, workspaces, trackerRowsByWorkspace));

    results.push({ name, free: claims.length === 0, claims });
  }
  return results;
}

/** `checkNames` for exactly one name. */
export async function checkName(dir, name, opts = {}) {
  const [result] = await checkNames(dir, [name], opts);
  return result;
}

/** One printed line per claim, in the fixed order above — a claim, located. */
export function describeClaim(claim) {
  switch (claim.kind) {
    case 'bin':
      return `  in bin/ here: ${claim.detail}`;
    case 'registration':
      return `  registered: ${claim.detail}`;
    case 'docs':
      return `  documented: ${claim.detail}`;
    case 'main':
      return `  on origin/main: ${claim.detail}`;
    case 'pr':
      return `  open pull request ${claim.detail}`;
    case 'worktree':
      return `  live worktree: ${claim.detail}`;
    case 'tracker':
      return `  open bead: ${claim.detail}`;
    default:
      return `  ${claim.detail || JSON.stringify(claim)}`;
  }
}
