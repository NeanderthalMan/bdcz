import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { writeJsonAtomic } from './atomic.js';
import { git, gitCode, mainCheckout, ok } from './gitref.js';
import * as pr from './pr.js';
import { stageOf } from './prstage.js';

/**
 * A candidate — an open pull request made into something that can be served. bc-sj8k.7.
 *
 * Every other child of the DemoMode epic (bc-sj8k) presumes this noun: the router spawns a
 * green backend from one (bc-sj8k.1), the phone lists and taps them (bc-sj8k.2), approve
 * merges one (bc-sj8k.3), a ready one prompts (bc-sj8k.5), and vendoring happens as part of
 * preparing one (bc-sj8k.6). This file is the only thing that makes, names, judges and
 * removes them.
 *
 * ## Why this is not a session worktree
 *
 * lib/session.js makes worktrees for **sessions**: on a named branch, under
 * `.claude/worktrees/`, locked to a live window, and retired into the attic when the window
 * is done. A candidate has none of those properties. It outlives the session that produced
 * it, nobody edits it, and it must never be what a session's guard or the attic sweep
 * reasons about. So it lives somewhere of its own, `.claude/candidates/`, and it is
 * **detached** at the head commit rather than on the pull request's branch — which is not
 * a style choice: git refuses to check one branch out in two worktrees, and the session
 * that opened the pull request is usually still sitting on that branch.
 *
 * ## One identity
 *
 * `<repo key>.pr<number>.<12 hex of the head>` — the id the router spawns from, the card
 * draws, the approve button merges and a push notification names. The head is *in* the id
 * on purpose: what Adam tried on green is one commit, and a push to the branch is a new
 * candidate rather than the old one silently changing under his thumb. It is also why
 * approve can refuse cleanly — the id it was handed names a head the pull request no
 * longer has.
 *
 * Filename-, cookie- and URL-safe by construction (`[a-z0-9.-]`), because all three are
 * places it goes.
 *
 * ## The verdict is read, never decided
 *
 * Where the pull request has got to is `stageOf` in lib/prstage.js, and whether its gates
 * passed is the check rollup lib/pr.js already folds from GitHub — the CI that runs
 * `npm test` on every pull request. Nothing here re-runs a gate or re-derives a rung:
 * a second opinion about the same pull request is the failure lib/prstage.js exists to
 * prevent.
 *
 * ## Servable, or said not to be (bc-sj8k.6)
 *
 * A fresh worktree has no `node_modules` and no `public/vendor`. A backend spawned from one
 * like that cannot start without the first. Without the second it *does* start — it boots,
 * health-checks green — and serves a page with no marked, purify, mermaid, d3 or xterm:
 * markdown as source, a blank graph, a dead terminal. That reads as the change being
 * broken, which is worse than a candidate that refuses to come up.
 *
 * So preparing a candidate lends it the checkout's `node_modules` (a relative link, the
 * same one every session worktree carries) and then runs **the candidate's own**
 * `scripts/vendor.js` — the pull request's list of bundles, not this file's, so a pull
 * request that adds one is served with it. lib/at.js and lib/prtree.js make their trees
 * runnable the same way, for the same reason. The record carries the outcome: `servable`,
 * and when that is false, `unservable` is the sentence why. Whatever spawns a backend reads
 * it first (bc-sj8k.1) — the refusal happens before a process exists, not after a page
 * loads.
 *
 * `public/vendor` stays a real directory. The script copies into it rather than linking,
 * because a candidate is not under `.claude/worktrees/`. That is 4 MB a candidate, and a
 * candidate lives only as long as its pull request.
 *
 * ## Where it is kept
 *
 * `<checkout>/.claude/candidates/<id>/` is the worktree and `<id>.json` beside it is the
 * record. The directory listing is the registry — there is no second index to drift from
 * what is on disk — and both halves are gitignored with the rest of `.claude/`'s machine
 * state.
 */

/** Where candidates live, relative to the main checkout. */
export const CANDIDATE_DIR = path.join('.claude', 'candidates');

const SHA_RE = /^[0-9a-f]{40}$/;
const ID_RE = /^([a-z0-9-]+)\.pr(\d+)\.([0-9a-f]{12})$/;

/** A repo key (`beadcause`, or `<ws>/<repo>`) folded to the id's alphabet. */
const keyPart = (key) =>
  String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'repo';

/** The one name for a candidate. See the header. */
export function candidateId({ key = '', number, headSha } = {}) {
  const n = Number(number);
  const sha = String(headSha || '').toLowerCase();
  if (!Number.isInteger(n) || n <= 0) throw new Error(`a candidate needs a pull request number, not ${number}`);
  if (!SHA_RE.test(sha)) throw new Error(`a candidate needs the full head commit, not "${headSha}"`);
  return `${keyPart(key)}.pr${n}.${sha.slice(0, 12)}`;
}

/** An id read back, or null for anything that is not one — including a path trying to be. */
export function parseCandidateId(id) {
  const m = ID_RE.exec(String(id || ''));
  return m ? { key: m[1], number: Number(m[2]), head: m[3] } : null;
}

const GATE = { passing: 'pass', failing: 'fail', pending: 'pending', none: 'none' };

/**
 * The verdict a candidate carries: where the pull request is on the ladder, and what its
 * checks said about the head. Both read, neither decided — see the header.
 *
 * `gate` is `pass`, `fail`, `pending` or `none`, and `none` is kept distinct from `pass`
 * for the reason lib/mergeadvocate.js's `gateVerdict` gives: a head nothing ran on is not
 * a head that passed.
 */
export function verdictOf(row, deploys = []) {
  const c = row?.checks || {};
  return {
    stage: stageOf(row, deploys),
    gate: GATE[c.state] || 'none',
    failed: Array.isArray(c.failed) ? c.failed.slice() : [],
    total: Number(c.total) || 0,
    at: c.at || null,
  };
}

/**
 * Whether a recorded candidate is still one, given what GitHub says of its pull request now.
 *
 * `row` is lib/pr.js's normalised pull request, or `null` for one GitHub says does not
 * exist — which is a different thing from `undefined`, "nobody could ask", and the sweep
 * never passes that here: an outage must not tear down every candidate on the Mac.
 *
 * Two kinds of stale, and only one of them ends the candidate:
 *
 * - **retire** — merged, closed, gone, or **superseded** (the head moved, so what is on
 *   green is no longer what the pull request would merge). It stops being a candidate and
 *   its worktree goes.
 * - **behind** — the base moved under it. Still a candidate: `main` moves many times a
 *   day here, and retiring on that would empty DemoMode every time anything landed. It is
 *   a flag for the screens (and for approve, which goes through the merge queue's
 *   downmerge anyway), not an ending.
 */
export function assess(record, row, { baseTip = null } = {}) {
  let retire = null;
  if (row === null) retire = 'gone';
  else if (row.state === 'MERGED') retire = 'merged';
  else if (row.state === 'CLOSED') retire = 'closed';
  else if (row.state !== 'OPEN') retire = 'gone';
  else if (String(row.headSha || '').toLowerCase() !== record.headSha) retire = 'superseded';
  const behind = !retire && !!baseTip && !!record.baseSha && baseTip !== record.baseSha;
  return { candidate: !retire, retire, behind };
}

/** What `retire` reads as in a sentence — a log line, a card. */
export const RETIRED_BECAUSE = {
  gone: 'its pull request no longer exists',
  merged: 'its pull request merged',
  closed: 'its pull request was closed without merging',
  superseded: 'a newer commit was pushed to its pull request',
  missing: 'its worktree was no longer on disk',
  orphan: 'its worktree had no record',
};

const rootOf = async (dir) => mainCheckout(dir);
const homeOf = (root) => path.join(root, CANDIDATE_DIR);
const recordPath = (root, id) => path.join(homeOf(root), `${id}.json`);
const treePath = (root, id) => path.join(homeOf(root), id);

function readRecord(file) {
  try {
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    return rec && parseCandidateId(rec.id) ? rec : null;
  } catch {
    return null;
  }
}

/**
 * Every recorded candidate in a checkout, newest first. Disk only — no git, no network —
 * so a screen can draw the list without waiting on GitHub. `present` says whether the
 * worktree is still there; the sweep is what acts on a `false`.
 */
export async function listCandidates(dir) {
  const root = await rootOf(dir);
  const home = homeOf(root);
  let names = [];
  try {
    names = fs.readdirSync(home);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json') && parseCandidateId(n.slice(0, -5)))
    .map((n) => readRecord(path.join(home, n)))
    .filter(Boolean)
    .map((rec) => ({ ...rec, present: fs.existsSync(treePath(root, rec.id)) }))
    .sort((a, b) => String(b.preparedAt).localeCompare(String(a.preparedAt)));
}

/** One candidate by id, or null. */
export async function findCandidate(dir, id) {
  if (!parseCandidateId(id)) return null;
  return (await listCandidates(dir)).find((c) => c.id === id) || null;
}

/**
 * Remove a candidate: its worktree and its record, in that order, so a failure halfway
 * leaves a record the next sweep can still find rather than a worktree nothing names.
 * Idempotent — tearing down what is already gone is a no-op, not an error.
 */
export async function teardownCandidate(dir, id) {
  if (!parseCandidateId(id)) throw new Error(`not a candidate id: "${id}"`);
  const root = await rootOf(dir);
  const tree = treePath(root, id);
  if (fs.existsSync(tree)) {
    // `--force` for the reason lib/tidy.js gives: a worktree carrying untracked files —
    // vendored assets, a build — is refused without it, forever.
    const removed = await gitCode(root, ['worktree', 'remove', '--force', tree]);
    if (removed.code !== 0) fs.rmSync(tree, { recursive: true, force: true });
  }
  await ok(git(root, ['worktree', 'prune']));
  fs.rmSync(recordPath(root, id), { force: true });
}

const run = promisify(execFile);

/** What `scripts/vendor.js` prints on stdout: `[vendor] 7/7 browser bundles in public/vendor`. */
const VENDOR_COUNT_RE = /\[vendor\] (\d+)\/(\d+) browser bundles/;

const unservable = (why) => ({ servable: false, unservable: why, bundles: null });

/**
 * Make a candidate's tree able to serve its own frontend: `node_modules` lent from `root`,
 * then the tree's own `scripts/vendor.js`. Never throws — it answers `{ servable,
 * unservable, bundles }`, and `unservable` is a sentence for a card or a log line.
 *
 * Judged by the script's own count rather than by a list kept here, so a pull request that
 * adds or drops a bundle is measured against itself. A count this cannot find is
 * unservable, not assumed fine: the failure this exists to catch is the quiet one.
 */
export async function vendorCandidate(tree, root) {
  const lent = path.join(root, 'node_modules');
  const nm = path.join(tree, 'node_modules');
  if (!fs.existsSync(lent)) return unservable(`${root} has no node_modules to lend it`);
  let present = null;
  try {
    present = fs.lstatSync(nm);
  } catch {
    /* the usual case: a fresh tree has none */
  }
  // Relative, as a session worktree's is: `.claude/candidates/<id>` is the same three levels
  // down as `.claude/worktrees/<name>`. A real directory already there is left alone; a
  // dangling link is replaced.
  if (present?.isSymbolicLink() && !fs.existsSync(nm)) {
    fs.rmSync(nm, { force: true });
    present = null;
  }
  if (!present) fs.symlinkSync(path.relative(tree, lent), nm);

  const script = path.join(tree, 'scripts', 'vendor.js');
  if (!fs.existsSync(script)) return unservable('its head has no scripts/vendor.js, so nothing can put its browser bundles in place');
  let stdout = '';
  try {
    ({ stdout } = await run(process.execPath, [script], { cwd: tree, timeout: 120000, maxBuffer: 1 << 20 }));
  } catch (err) {
    const said = String(err?.stderr || err?.message || err).trim().split('\n').pop();
    return unservable(`its scripts/vendor.js failed: ${said}`);
  }
  const m = VENDOR_COUNT_RE.exec(stdout);
  if (!m) return unservable('its scripts/vendor.js ran but never said how many browser bundles it put in place');
  const [have, want] = [Number(m[1]), Number(m[2])];
  if (have < want) return unservable(`only ${have} of its ${want} browser bundles could be put in public/vendor`);
  return { servable: true, unservable: null, bundles: `${have}/${want}` };
}

/**
 * Why a backend must not be spawned from this candidate, as a sentence — or null when it
 * may. bc-sj8k.1: bin/router.js asks this before a green process exists, so the refusal
 * is a line on the phone rather than a page that boots with no bundles.
 *
 * `record` is what `findCandidate` handed back (null for an id nothing prepared). Pure:
 * it reads the record and the one file the spawn would run, nothing else.
 */
export function greenRefusal(record, id) {
  if (!parseCandidateId(id)) return `"${id}" is not a candidate id`;
  if (!record) return `no candidate ${id} is prepared on this Mac`;
  if (!record.present || !record.dir || !fs.existsSync(record.dir)) return `candidate ${id} has no worktree on disk`;
  if (record.servable !== true) {
    return `candidate ${id} is unservable — ${record.unservable || 'it was never vendored, so it would serve a page with no browser bundles'}`;
  }
  if (!fs.existsSync(path.join(record.dir, 'bin', 'beadcause.js'))) {
    return `candidate ${id} has no bin/beadcause.js, so there is no backend in it to start`;
  }
  return null;
}

/** The commit a worktree has checked out, or null. */
const headOf = async (tree) => (await ok(git(tree, ['rev-parse', 'HEAD'])))?.trim() || null;

/**
 * Make an open pull request a candidate, or hand back the one it already is.
 *
 * `key` is the repo key the record and id carry (see lib/repos.js). `view` is lib/pr.js's
 * `view`, injectable so a suite can drive this without GitHub. `deploys` feeds `stageOf`
 * exactly as it does on the board.
 *
 * Throws, with a sentence, for anything that is not an open pull request with a full head
 * sha whose commit can be fetched — a candidate that cannot be served is worse than none,
 * because it reads as the change being broken.
 *
 * A tree that was made but could not be vendored is *not* thrown: it is recorded with
 * `servable: false` and the reason, so the phone can say why and the router can refuse it
 * before spawning. Asking again retries the vendoring; a reused tree that was already
 * servable is not vendored twice.
 */
export async function prepareCandidate(
  dir,
  { number, key = '', view = pr.view, deploys = [], now = () => new Date() } = {}
) {
  const root = await rootOf(dir);
  const row = await view(root, number);
  if (!row) throw new Error(`#${number}: GitHub has no such pull request`);
  if (row.state !== 'OPEN') throw new Error(`#${number} is ${String(row.state).toLowerCase()}, so it is not a candidate`);
  const headSha = String(row.headSha || '').toLowerCase();
  const id = candidateId({ key, number: row.number || number, headSha });
  const tree = treePath(root, id);

  // Any earlier head of the same pull request is superseded by this one — retired here
  // rather than left for the sweep, so two heads of one pull request never stand at once.
  const prefix = id.slice(0, id.lastIndexOf('.') + 1);
  for (const old of await listCandidates(root)) {
    if (old.id !== id && old.id.startsWith(prefix)) await teardownCandidate(root, old.id);
  }

  const existing = readRecord(recordPath(root, id));
  const reused = !!existing && fs.existsSync(tree) && (await headOf(tree)) === headSha;

  let baseSha = existing?.baseSha || null;
  if (!reused) {
    if (fs.existsSync(tree) || existing) await teardownCandidate(root, id);
    // `refs/pull/<n>/head` rather than the branch name: it is GitHub's own ref for the
    // head, so it works for a fork's pull request too, and it is fetched without storing
    // a ref or touching FETCH_HEAD — the main checkout is shared by every session here.
    // Fetches ride on the account lib/pr.js resolved, not whoever gh has active (bc-xl7n.169).
    const env = await pr.gitEnvIn(root).catch(() => undefined);
    await git(root, ['fetch', '--quiet', '--no-write-fetch-head', 'origin', `refs/pull/${row.number || number}/head`], {
      timeout: 120000,
      env,
    });
    if ((await gitCode(root, ['cat-file', '-e', `${headSha}^{commit}`])).code !== 0) {
      throw new Error(
        `#${number}: fetched its head from origin but ${headSha.slice(0, 12)} is not in it — ` +
          `a push probably landed between asking GitHub and fetching; try again`
      );
    }
    if (row.base) {
      // Updates `origin/<base>` by the remote's own refspec, which is what the sweep later
      // compares against to say "behind". A failure is not fatal: behind is a flag.
      await ok(git(root, ['fetch', '--quiet', '--no-write-fetch-head', 'origin', row.base], { timeout: 120000, env }));
      baseSha = (await ok(git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${row.base}`])))?.trim() || null;
    }
    fs.mkdirSync(homeOf(root), { recursive: true });
    await git(root, ['worktree', 'add', '--detach', '--quiet', tree, headSha]);
  }
  const served =
    reused && existing.servable === true
      ? { servable: true, unservable: null, bundles: existing.bundles || null }
      : await vendorCandidate(tree, root);

  const record = {
    id,
    key: String(key || ''),
    number: row.number || Number(number),
    url: row.url || '',
    title: row.title || '',
    branch: row.branch || '',
    base: row.base || '',
    headSha,
    baseSha,
    dir: tree,
    ...served,
    preparedAt: reused ? existing.preparedAt : now().toISOString(),
    checkedAt: now().toISOString(),
    verdict: verdictOf(row, deploys),
  };
  writeJsonAtomic(recordPath(root, id), record, { mode: 0o644 });
  return { candidate: { ...record, present: true }, reused };
}

/**
 * Ask GitHub about every candidate in a checkout, retire the ones that stopped being
 * candidates, and refresh the verdict on the rest. This is what makes "a merged pull
 * request stops being a candidate" true without anybody asking — the daemon runs it on
 * its slow clock (see lib/server.js).
 *
 * Also collects both halves of a crash: a worktree directory with no record (`orphan`)
 * and a record whose worktree has gone (`missing`). No candidate worktree survives its
 * candidate, and no record outlives its worktree.
 *
 * A pull request GitHub could not be asked about is **kept**, untouched: an outage is
 * not evidence of a merge.
 */
export async function sweepCandidates(dir, { view = pr.view, deploys = [], now = () => new Date() } = {}) {
  const root = await rootOf(dir);
  const home = homeOf(root);
  const out = { kept: [], retired: [], unknown: [] };
  if (!fs.existsSync(home)) return out;

  const records = await listCandidates(root);
  const named = new Set(records.map((r) => r.id));
  for (const name of fs.readdirSync(home)) {
    if (name.endsWith('.json') || named.has(name)) continue;
    if (!fs.statSync(path.join(home, name)).isDirectory()) continue;
    if (parseCandidateId(name)) {
      await teardownCandidate(root, name);
    } else {
      // Not a name this file makes, so not a registered worktree of ours either; remove
      // the directory and let prune drop any admin entry pointing at it.
      fs.rmSync(path.join(home, name), { recursive: true, force: true });
      await ok(git(root, ['worktree', 'prune']));
    }
    out.retired.push({ id: name, reason: 'orphan' });
  }

  for (const rec of records) {
    if (!rec.present) {
      await teardownCandidate(root, rec.id);
      out.retired.push({ id: rec.id, number: rec.number, reason: 'missing' });
      continue;
    }
    let row;
    try {
      row = await view(root, rec.number);
    } catch (err) {
      if (pr.NO_SUCH_PR_RE.test(String(err?.message || ''))) row = null;
      else {
        out.unknown.push({ id: rec.id, number: rec.number, reason: String(err?.message || err) });
        continue;
      }
    }
    const baseTip = rec.base
      ? (await ok(git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${rec.base}`])))?.trim() || null
      : null;
    const verdict = assess(rec, row, { baseTip });
    if (verdict.retire) {
      await teardownCandidate(root, rec.id);
      out.retired.push({ id: rec.id, number: rec.number, reason: verdict.retire });
      continue;
    }
    const { present, ...kept } = rec;
    const next = { ...kept, behind: verdict.behind, checkedAt: now().toISOString(), verdict: verdictOf(row, deploys) };
    writeJsonAtomic(recordPath(root, rec.id), next, { mode: 0o644 });
    out.kept.push({ ...next, present });
  }
  return out;
}
