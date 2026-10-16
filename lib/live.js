/**
 * Which commit is the running daemon on, and is a given sha live yet?
 *
 * bc-dgx7.164, filed by the session audit against three windows (bc-ka5y.15.19,
 * bc-rfnr.9.10, bc-42ow) that opened within minutes of each other on 2026-09-19 and each
 * had to decide whether a merged fix was actually running. Each got there differently, and
 * two of the three got partway: one curled `/api/deploys`, which wants a token, and got
 * nothing; one grepped `lib/server.js` for a build route, found only `/api/health`, and
 * concluded that "no running commit" can be read; the third read the journal, the log and
 * `git merge-base --is-ancestor` by hand and worked out "the 09-18 deploy, 22 behind main".
 * The answer was sitting in two files under the config directory the whole time. This reads
 * them.
 *
 * ## What "running" means here, and what it does not
 *
 * The daemon does not report a commit — no route says one, and bc-rfnr.9.13 is the bead for
 * giving the release check a way to prove it. So this answers the question the journal can:
 * **the newest deploy that reached the daemon, and the commit it pulled the checkout to**.
 * That is `rec.to`, the `git rev-parse HEAD` the runner took after the fast-forward
 * (scripts/deploy-runner.mjs), and it is the same fact `shippedState` in lib/release.js
 * tries to recover from timestamps — except that this compares *commits*, which is exact,
 * where that compares a merge time against a deploy's start, which is a heuristic that an
 * out-of-order merge defeats.
 *
 * Which records count as reaching the daemon is the part worth arguing:
 *
 *  - **`ok`** — the command ran and the runner lived to say so. Yes.
 *  - **`unconfirmed`** — the ordinary ending of a deploy that restarts the daemon: launchd
 *    took the runner along with it. The command ran; nobody was left to write "ok". Counts,
 *    and is labelled, because a reader deserves to know the word was never written.
 *  - **`failed`** — does **not** count, and this is the one that surprises: a deploy that
 *    fails *after* the fast-forward has already moved the checkout, so `rec.to` is the new
 *    commit and the daemon is still on the old one. Reading `to` off a failed record would
 *    say "live" about code that never restarted.
 *  - **`lost`** and the in-flight words — do not count. They are reported, as what came
 *    after the deploy that does.
 *
 * ## The one gap this cannot close
 *
 * `npm run swap` restarts the daemon and writes no deploy record; it leaves only the marker
 * `lastRestart()` reads. A swap after the last deploy runs whatever the checkout holds, which
 * is usually the deployed commit and is not guaranteed to be. So when the marker is newer than
 * the deploy, and the checkout's HEAD is not the deployed commit, the answer carries a caveat
 * naming both — rather than picking one and being wrong about the other.
 *
 * ## No network, no daemon, no token
 *
 * Everything below is a file read under the config directory or a local `git` read. In
 * particular `origin/<base>` is the ref **as this Mac last fetched it**: nothing here fetches,
 * because a command that asks "is it live" must not be the thing that changes what "behind
 * main" means, and the answer says which tip it measured against.
 */
import fs from 'node:fs';
import path from 'node:path';
import { git, gitCode, ok } from './gitref.js';

/** Records that mean "the daemon received this deploy" — see the header for `failed`. */
const REACHED = new Set(['ok', 'unconfirmed']);

/** Records of this repo, newest first. `records` is the whole journal, as `listDeploys` gives it. */
export function recordsFor(records, key, keyOf) {
  return (records || []).filter((r) => keyOf(r) === String(key));
}

/**
 * The deploy the running daemon came from: the newest record that reached it and names a
 * commit. Null when there is none — including a journal that has only failed or lost
 * deploys, which is the state where the honest answer is "cannot say".
 */
export function deployedRecord(records) {
  return (records || []).find((r) => REACHED.has(String(r.status)) && typeof r.to === 'string' && r.to) || null;
}

/**
 * What came after that deploy and did not reach the daemon, newest first — a failed or lost
 * or still-running record newer than the one `deployedRecord` chose. These are the reasons a
 * reader expected a newer commit and did not find it, so they are named rather than dropped.
 */
export function newerThan(records, deployed) {
  const out = [];
  for (const r of records || []) {
    if (deployed && r.id === deployed.id) break;
    if (!REACHED.has(String(r.status))) out.push(r);
  }
  return out;
}

const short = (sha) => String(sha || '').slice(0, 9);

/**
 * Resolve a user-typed commit to a full sha inside `dir`, or null if the checkout has never
 * heard of it. `rev-parse --verify <x>^{commit}` rather than a bare `rev-parse`, so a branch
 * name or a tag that points at a tree reads as "not a commit" instead of as an answer.
 */
async function resolveCommit(dir, ref) {
  const out = await ok(git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]));
  return out ? out.trim() : null;
}

/**
 * One commit, against the deployed commit and the branch it deploys from.
 *
 * `live` — an ancestor of what was deployed, so the deploy contains it.
 * `merged, not deployed` — on `origin/<base>` but not in the deploy.
 * `not on <ref>` — resolvable here but on neither; a branch tip, an unmerged PR head, or
 * something a rewrite dropped. `unknown` — this checkout has no such object, which is a
 * different sentence from "not merged" and must not be collapsed into it (the same three
 * states lib/gitref.js's `gitCode` exists to keep apart).
 */
export async function verdictFor(dir, ref, { deployedTo, remote }) {
  const sha = await resolveCommit(dir, ref);
  if (!sha) return { ref, sha: null, verdict: 'unknown', why: 'this checkout has no such commit — fetch, or check the sha' };
  if (deployedTo) {
    const inDeploy = await gitCode(dir, ['merge-base', '--is-ancestor', sha, deployedTo]);
    if (inDeploy.code === 0) return { ref, sha, verdict: 'live' };
  }
  const onMain = await gitCode(dir, ['merge-base', '--is-ancestor', sha, remote]);
  if (onMain.code === 0) return { ref, sha, verdict: 'merged, not deployed' };
  return { ref, sha, verdict: `not on ${remote}` };
}

/**
 * The whole answer, as data. `records` is this repo's journal newest-first (already filtered
 * to the key), `restart` is `lastRestart()`, `shas` the commits asked about. Nothing here
 * reads the config or the journal itself — the caller passes them in — so a suite can hand it
 * a journal and a real git repo and nothing else.
 */
export async function describeLive({ key, dir, base, records, restart = null, shas = [], checks = null }) {
  const deployed = deployedRecord(records);
  const after = newerThan(records, deployed);
  const newest = (records || [])[0] || null;
  const workdir = dir && fs.existsSync(dir) ? path.resolve(dir) : null;
  const remote = `origin/${base || deployed?.base || 'main'}`;

  const out = {
    key,
    dir: workdir,
    remote,
    checks,
    lastDeploy: newest ? summariseRecord(newest) : null,
    deployed: deployed ? { ...summariseRecord(deployed), to: deployed.to, from: deployed.from || null } : null,
    after: after.map(summariseRecord),
    restart: restart ? { at: restart.at, pid: restart.pid ?? null, build: restart.build ?? null, reason: restart.reason || '' } : null,
    remoteTip: null,
    behind: null,
    diverged: false,
    head: null,
    caveats: [],
    shas: [],
  };

  if (!workdir) {
    out.caveats.push(`the deploy's directory ${dir || '(none recorded)'} is not on this Mac, so nothing can be compared`);
    return out;
  }

  out.remoteTip = ((await ok(git(workdir, ['rev-parse', '--verify', '--quiet', `${remote}^{commit}`]))) || '').trim() || null;
  out.head = ((await ok(git(workdir, ['rev-parse', 'HEAD']))) || '').trim() || null;

  if (!out.remoteTip) out.caveats.push(`${remote} does not exist in ${workdir} — nothing to measure "behind" against`);

  if (deployed && out.remoteTip) {
    const count = ((await ok(git(workdir, ['rev-list', '--count', `${deployed.to}..${remote}`]))) || '').trim();
    out.behind = count === '' ? null : Number(count);
    // A deploy that is not an ancestor of the branch's tip means the branch was rewritten or
    // the deploy came from somewhere else; "N behind" is then only half the story.
    out.diverged = (await gitCode(workdir, ['merge-base', '--is-ancestor', deployed.to, remote])).code !== 0;
    if (out.diverged) out.caveats.push(`the deployed commit is not an ancestor of ${remote} — the branch was rewritten since, so "behind" counts only what ${remote} has that the deploy lacks`);
  }

  if (deployed && restart?.at && Date.parse(restart.at) > Date.parse(deployed.finishedAt || deployed.startedAt || deployed.requestedAt || 0)) {
    if (out.head && out.head !== deployed.to) {
      out.caveats.push(
        `the daemon restarted at ${restart.at} without a deploy record (a swap), and the checkout is at ${short(out.head)}, not the deployed ${short(deployed.to)} — it may be running either`
      );
    }
  }
  if (deployed?.status === 'unconfirmed') {
    out.caveats.push('that deploy is "unconfirmed": the restart it asked for took its own runner with it, so no record says it finished');
  }

  for (const ref of shas) out.shas.push(await verdictFor(workdir, ref, { deployedTo: deployed?.to || null, remote }));
  return out;
}

function summariseRecord(r) {
  return {
    id: r.id,
    status: r.status,
    requestedAt: r.requestedAt || null,
    finishedAt: r.finishedAt || null,
    to: r.to || null,
    error: r.error || null,
    reason: r.reason || '',
    bead: r.bead || null,
  };
}

/**
 * The printed block. One line per fact, the label padded so a reader's eye can run down it,
 * and nothing that a caller would have to parse — `--json` is for that.
 */
export function renderLive(a) {
  const rows = [];
  const put = (label, text) => rows.push([label, text]);
  put('repo', `${a.key}${a.dir ? `  (${a.dir})` : ''}`);
  if (a.lastDeploy) {
    const l = a.lastDeploy;
    put('last deploy', `${l.id}  ${l.status}  requested ${l.requestedAt}${l.error ? `  — ${l.error}` : ''}`);
  } else {
    put('last deploy', 'none on record');
  }
  if (a.deployed) {
    put('deployed', `${short(a.deployed.to)}  (${a.deployed.id}, ${a.deployed.status}${a.deployed.from ? `, from ${short(a.deployed.from)}` : ''})`);
  } else {
    put('deployed', 'no deploy record that reached the daemon names a commit — cannot say what is running');
  }
  for (const r of a.after) put('since', `${r.id}  ${r.status}  ${r.error || r.reason || ''}`.trimEnd());
  if (a.restart) {
    const detail = [a.restart.reason, a.restart.build ? `build ${a.restart.build}` : ''].filter(Boolean).join(', ');
    put('restarted', `${a.restart.at}${detail ? `  (${detail})` : ''}`);
  } else {
    put('restarted', 'no restart marker');
  }
  if (a.behind !== null) {
    put('behind', `${a.behind} commit${a.behind === 1 ? '' : 's'} behind ${a.remote} (${short(a.remoteTip)}, as last fetched)`);
  } else if (a.remoteTip) {
    put('behind', `cannot say — ${a.remote} is at ${short(a.remoteTip)}`);
  }
  if (a.checks !== null) put('checks', a.checks === 0 ? 'none declared' : `${a.checks} declared`);
  const width = Math.max(...rows.map(([l]) => l.length));
  const lines = rows.map(([l, t]) => `${l.padEnd(width)}  ${t}`);
  // The commits asked about align among themselves: a full sha as a label would otherwise
  // stretch every fact above it out to forty columns.
  const asked = a.shas.map((s) => [s.ref, s.why ? `${s.verdict} — ${s.why}` : s.verdict]);
  const askedWidth = Math.max(0, ...asked.map(([r]) => r.length));
  for (const [r, v] of asked) lines.push(`${r.padEnd(askedWidth)}  ${v}`);
  for (const c of a.caveats) lines.push(`note: ${c}`);
  return lines.join('\n');
}
