/**
 * `worked-by:<pid>` — a bead a live session nobody briefed is working.
 *
 * bc-xl7n.156. The advocate decides a bead is being worked from its claim, its deps, its
 * labels and its own list of the windows it opened. A Claude session Adam opens himself
 * in a worktree is in none of those: no brief on its command line (so the brief's `ps`
 * check cannot see it), no worker record, and usually no claim. On 2026-09-13 one such
 * session was building dv-b5d.60.1 and .2 when the advocate opened a worker window on
 * them at 19:45, 20:10 and 20:35. Each window found the live builder, claimed, commented
 * and stood down; the idle sweep closed it, the hand-back took the claim off as designed
 * (every window claims as the same `bd` user, so a claim cannot say whose it is), the
 * bead was ready again and the next tick opened another. Nothing a worker window could
 * do ended the loop.
 *
 * So the fact goes on a label, the way `blocked-by:` does (lib/farblock.js), and it names
 * the one thing that can be checked against the live machine: the owning process's pid.
 *
 * 1. **A filter**, in `Bd.ready` — a marked bead is out of every queue. The pid is in the
 *    label, so there is no fixed string for `--exclude-label`; it is a row check.
 * 2. **A refusal**, in `openWorkSession` — but only while the process is alive. A marker
 *    whose owner has gone holds nothing; the sweep will take it off.
 * 3. **A sweep**, on the advocate tick — every marked bead whose process is gone has the
 *    marker removed and a comment saying so, and is ordinary work again.
 *
 * Liveness is `ps -p <pid> -o args=` and nothing cleverer: the process has to exist **and**
 * be a `claude` process. The second half is what makes a reused pid harmless — pids wrap,
 * and a marker whose number now belongs to a shell or a compiler would otherwise hold a
 * bead for as long as that stranger lives. Anything `ps` cannot answer is `unknown`, and
 * `unknown` never clears a marker: taking one off on a guess would put the bead back
 * under a session that is still working it, which is the exact failure this exists for.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The marker's prefix. One spelling, in one place. */
export const HAND_PREFIX = 'worked-by:';

const PID_RE = /^[1-9][0-9]{0,9}$/;

/** A positive integer pid, or 0. */
export const asPid = (raw) => (PID_RE.test(String(raw ?? '').trim()) ? Number(String(raw).trim()) : 0);

/**
 * **Whose machine a pid belongs to (bc-obucr.26).** A pid means nothing off the machine
 * that issued it, and since bc-obucr.21 one tracker is used from two: studio's daemon
 * serves the personal workspaces, and sessions on the laptop write to the same graph
 * over the tailnet. A bare `worked-by:<pid>` written on the laptop, read by studio's
 * sweep, is a pid studio's `ps` has never heard of — so it read as gone, the marker came
 * off, and the advocate opened a second worker on a bead a live session was building.
 * The bc-xl7n.156 loop, across machines.
 *
 * So the marker names the host: `worked-by:<pid>@<host>`. The host is the short
 * hostname, lowercased and reduced to `[a-z0-9-]`, because it is part of a label.
 * `BEADCAUSE_HOST_NAME` overrides it — for a suite, and for a box whose hostname is not
 * the name anybody would recognise.
 */
export function localHost() {
  const raw = process.env.BEADCAUSE_HOST_NAME || os.hostname() || '';
  return (
    String(raw)
      .split('.')[0]
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'host'
  );
}

/**
 * `worked-by:14758@studio`. What gets written. `host` defaults to this machine — a
 * marker is only ever written for a pid this machine can see.
 */
export const handLabel = (pid, host = localHost()) => `${HAND_PREFIX}${Number(pid)}${host ? `@${host}` : ''}`;

/**
 * One marker label read back: `{ pid, host, label }`, or `null` for a label that is not
 * one. A bare `worked-by:<pid>` — every marker written before bc-obucr.26 — has no host,
 * and is read as this machine's, which is what it was when one daemon served everything.
 */
export function parseMarker(raw) {
  const label = String(raw ?? '').trim();
  if (!label.startsWith(HAND_PREFIX)) return null;
  const m = /^([^@]+)(?:@([a-z0-9-]+))?$/.exec(label.slice(HAND_PREFIX.length));
  if (!m) return null;
  const pid = asPid(m[1]);
  return pid ? { pid, host: m[2] || '', label } : null;
}

/** Is this marker's pid one this machine's `ps` can answer for? */
export const isLocalMarker = (marker, here = localHost()) => !marker?.host || marker.host === here;

/** Every marker a bead carries, in label order, one per label. */
export function markers(issue) {
  const out = [];
  for (const raw of issue?.labels || []) {
    const m = parseMarker(raw);
    if (m && !out.some((o) => o.label === m.label)) out.push(m);
  }
  return out;
}

/** The first marker a bead carries, or `null`. */
export const firstMarker = (issue) => markers(issue)[0] || null;

/**
 * The pid a bead is marked as worked by, or 0. Takes a `bd --json` row, or anything
 * carrying `labels`. A label whose tail is not a pid is not a marker and holds nothing.
 * The pid alone says nothing about whose machine it is on — `firstMarker` does.
 */
export const workedBy = (issue) => firstMarker(issue)?.pid || 0;

/** Is this marker the session `pid` on this machine? */
const isOwn = (marker, pid, here) => marker.pid === pid && isLocalMarker(marker, here);

/** Does this bead carry the marker at all? What `Bd.ready`'s filter reads. */
export const isHandWorked = (issue) => Boolean(workedBy(issue));

/** Is this argv a Claude Code process? The first word's basename is `claude`. */
export const isClaudeArgs = (args) => /^(?:\S*\/)?claude(?:\s|$)/.test(String(args || '').trim());

/** `ps -p <pid> -o args=` — the argv, or `null` when there is no such process. Throws on anything else. */
export function psArgs(pid) {
  try {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (err) {
    // ps exits 1 with nothing on stdout for a pid that does not exist. Anything else —
    // no ps, a signal — is a question it could not answer, not an answer.
    if (err?.status === 1 && !String(err?.stdout || '').trim()) return null;
    throw err;
  }
}

/**
 * `live`, `gone` or `unknown` for one pid. `ps` is injectable, `(pid) => argv | null`,
 * so a suite never has to find a real process to point at.
 */
export function probe(pid, { ps = psArgs } = {}) {
  if (!asPid(pid)) return 'gone';
  let args;
  try {
    args = ps(pid);
  } catch {
    return 'unknown';
  }
  if (args == null || args === '') return 'gone';
  return isClaudeArgs(args) ? 'live' : 'gone';
}

/**
 * `probe` for a marker, which may name another machine's pid. That answer is `remote`:
 * this `ps` cannot say, so it is held exactly as `unknown` is — everything that holds a
 * bead tests `!== 'gone'` — and only the sweep treats it differently (see
 * `sweepHandSessions`).
 */
export function probeMarker(marker, { ps = psArgs, here = localHost() } = {}) {
  if (!marker?.pid) return 'gone';
  if (!isLocalMarker(marker, here)) return 'remote';
  return probe(marker.pid, { ps });
}

/**
 * Why this bead may not be worked. `status: 409` and `handWorked: true`, the refusal
 * shape lib/farblock.js and lib/superseded.js use, so the advocate does not retry it.
 */
export const refusal = (id, pid, label = `${HAND_PREFIX}${pid}`) =>
  Object.assign(new Error(`${id || 'that bead'} may not be worked — ${label}, a live session nobody briefed, is working it`), {
    status: 409,
    handWorked: true,
    workedBy: pid,
  });

/**
 * The gate, off a row the caller already read. Refuses only while the owner is live —
 * a stale marker is the sweep's business, and refusing on it would hold the bead for a
 * process that no longer exists. `unknown` refuses: "I could not check" is not "free".
 * Neither is `remote`: a session on another machine is one this machine cannot see.
 */
export function assertNotHandWorked(issue, { ps = psArgs, here = localHost() } = {}) {
  for (const m of markers(issue)) {
    if (probeMarker(m, { ps, here }) !== 'gone') throw refusal(issue?.id, m.pid, m.label);
  }
  return issue;
}

/**
 * Walk up from `start` to the nearest `claude` process — the session a command was run
 * from. `table` is `(pid) => { ppid, args } | null`. Returns `{ pid, args }` or `null`.
 */
export function claudeAncestor(start, table) {
  let pid = asPid(start);
  for (let hops = 0; pid && pid !== 1 && hops < 32; hops += 1) {
    const row = table(pid);
    if (!row) return null;
    if (isClaudeArgs(row.args)) return { pid, args: row.args };
    pid = asPid(row.ppid);
  }
  return null;
}

/** The real table for `claudeAncestor`: one `ps` per hop. */
export function psRow(pid) {
  try {
    const out = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid=,args='], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
    const m = /^(\d+)\s+([\s\S]*)$/.exec(out);
    return m ? { ppid: Number(m[1]), args: m[2] } : null;
  } catch {
    return null;
  }
}

/** A worker window's argv carries its brief; a hand-opened session's does not. */
export const isBriefedArgs = (args) => /You are working bead \*\*/.test(String(args || ''));

/** The first line of whatever `bd` said. */
const said = (err) => {
  const captured = String(err?.stderr || '').trim() || String(err?.stdout || '').trim();
  const line = (captured || String(err?.message ?? err ?? '')).split('\n').filter(Boolean)[0] || '';
  return /^Command failed:/.test(line.trim()) ? 'bd refused it and said why on the line above' : line.trim();
};

/**
 * Put the marker on. `bd` is synchronous, `(argv) => stdout`, as in lib/farblock.js.
 *
 * **Label first, then status and assignee.** The label is the guarantee, so a failure
 * afterwards leaves a bead that is held. The status write is not housekeeping either: a
 * worker window that found the builder has usually *claimed* the bead, and the idle sweep's
 * hand-back will take that claim off anyway — doing it here, deliberately, means the only
 * thing holding the bead is the one hold that can tell whose it is.
 *
 * A marker already naming a *different* live pid is refused rather than replaced: two
 * sessions each thinking the bead is theirs is a conflict for a person, not for this.
 * One naming a gone pid is replaced — that is a stale marker the sweep had not reached.
 *
 * A marker naming **another machine's** session is refused too, as a live one is: this
 * machine cannot tell whether it has exited.
 *
 * Never throws. Returns `{ marked, alreadyMarked, released, replaced, refused, notes }`;
 * `replaced` is the stale marker's label, or `''`.
 */
export function mark(bd, id, pid, { row = null, ps = psArgs, here = localHost() } = {}) {
  const out = { marked: false, alreadyMarked: false, released: false, replaced: '', refused: '', notes: [] };
  const beadId = String(id || '').trim();
  const owner = asPid(pid);
  if (!beadId) return { ...out, refused: 'no bead was named' };
  if (!owner) return { ...out, refused: `${pid ?? 'that'} is not a pid` };
  if (!row) return { ...out, refused: `no bead ${beadId} here — nothing was written` };
  if (String(row.status || '').toLowerCase() === 'closed') {
    return { ...out, refused: `${beadId} is already closed, so there is nothing to hold` };
  }
  const state = probe(owner, { ps });
  if (state !== 'live') {
    return {
      ...out,
      refused:
        state === 'gone'
          ? `pid ${owner} is not a live claude process, and a marker naming one would hold ${beadId} for nobody`
          : `could not ask ps about pid ${owner}, so nothing was written`,
    };
  }

  const carried = firstMarker(row);
  if (carried && isOwn(carried, owner, here)) {
    out.alreadyMarked = true;
    out.marked = true;
    out.notes.push(`${beadId} was already marked ${carried.label} — nothing to do`);
    return out;
  }
  if (carried) {
    const state = probeMarker(carried, { ps, here });
    if (state !== 'gone') {
      return {
        ...out,
        refused:
          state === 'remote'
            ? `${beadId} is already ${carried.label}, a session on ${carried.host} — this machine cannot tell whether it is still alive. Two sessions on one bead is for a person to sort out.`
            : `${beadId} is already ${carried.label}, and that session is still alive. Two sessions on one bead is for a person to sort out.`,
      };
    }
  }

  try {
    bd(['label', 'add', beadId, handLabel(owner, here)]);
    out.marked = true;
  } catch (err) {
    return { ...out, refused: `could not label ${beadId} — ${said(err)}. Nothing else was written.` };
  }
  if (carried) {
    try {
      bd(['label', 'remove', beadId, carried.label]);
      out.replaced = carried.label;
    } catch (err) {
      out.notes.push(`the stale ${carried.label} is still on ${beadId} (${said(err)}); the sweep will take it off`);
    }
  }
  if (String(row.status || '').toLowerCase() === 'in_progress' || String(row.assignee || '').trim()) {
    try {
      // `--force`: the claim is the same `bd` user's, but bd 1.2.1 still refuses an
      // assignee write over a live in_progress claim from any other actor string.
      bd(['update', beadId, '--status=open', '--assignee', '', '--force']);
      out.released = true;
    } catch (err) {
      out.notes.push(
        `${beadId} is still claimed (${said(err)}). The marker holds it either way, but the sweep only reads beads it can see.`
      );
    }
  }
  return out;
}

/** Every pid a bead's markers name, in label order, whatever machine. `workedBy` is the first. */
export function markerPids(issue) {
  const out = [];
  for (const m of markers(issue)) if (!out.includes(m.pid)) out.push(m.pid);
  return out;
}

/**
 * The race's tie-break, the same on every machine: lower pid first, then the label, so
 * two sessions on two machines with the same pid still order one way on both sides.
 */
const before = (a, b) => (a.pid !== b.pid ? a.pid < b.pid : a.label < b.label);

/**
 * Claim a bead *for one session*, not for an actor (bc-3jzrd).
 *
 * `bd update <id> --claim` is keyed on the actor, and every session Adam runs is the same
 * actor — so on 2026-10-31 both dv-q52fe successors claimed it, both claims succeeded,
 * and both did the whole job. This is the claim the handoff briefs run instead.
 *
 * It is `mark` without the release: a handoff stays `in_progress` *and* carries
 * `worked-by:<pid>`, because `bd list --label=handoff --status=open` is how a session
 * finds handoffs nobody has taken, and a released one would read as free. The marker is
 * what names the session; the claim is what everything that reads status still sees.
 *
 * - Another **live** marker refuses, naming its pid. `unknown` refuses too.
 * - A gone one is replaced — the session that wrote it exited, so a resumed or new
 *   successor takes over, which is the whole point of a handoff.
 * - `in_progress` with **no** marker is a claim made the old way, which cannot say whose
 *   it is. Then `sessions()` (`[{ pid, name }]`, live Claude sessions) is asked: another
 *   live session named after the bead refuses; nothing found lets the claim through.
 * - Two sessions writing in the same instant both see each other on the re-read. The
 *   **lower pid keeps it** and the other takes its marker back off and refuses — both
 *   sides apply the same rule, so exactly one wins without them talking.
 *
 * `bd` is synchronous, `(argv) => stdout`. `reread` is `() => row`, re-reading the bead.
 * - A marker naming **another machine** (bc-obucr.26) refuses as a live one does: this
 *   machine's `ps` cannot say whether it has exited.
 *
 * Never throws. Returns `{ claimed, already, holder, refused, replaced, notes }`;
 * `replaced` is the labels of the stale markers taken off.
 */
export function claim(
  bd,
  id,
  pid,
  { row = null, reread = null, ps = psArgs, here = localHost(), sessions = () => [], namesBead = defaultNamesBead } = {}
) {
  const out = { claimed: false, already: false, holder: 0, refused: '', replaced: [], notes: [] };
  const beadId = String(id || '').trim();
  const owner = asPid(pid);
  if (!beadId) return { ...out, refused: 'no bead was named' };
  if (!owner) return { ...out, refused: `${pid ?? 'that'} is not a pid` };
  if (!row) return { ...out, refused: `no bead ${beadId} here — nothing was written` };
  if (String(row.status || '').toLowerCase() === 'closed') return { ...out, refused: `${beadId} is already closed` };
  if (probe(owner, { ps }) !== 'live') {
    return { ...out, refused: `pid ${owner} is not a live claude process, so there is no session to claim ${beadId} for` };
  }

  const busy = (heldBy, how) => ({
    ...out,
    holder: heldBy,
    refused: `${beadId} is already being worked by ${how} — a live session. Do not work it here too; stop, and tell Adam.`,
  });

  const mine = { pid: owner, host: here, label: handLabel(owner, here) };
  const carried = markers(row);
  const stale = [];
  for (const other of carried) {
    if (isOwn(other, owner, here)) continue;
    const state = probeMarker(other, { ps, here });
    if (state === 'remote') return busy(other.pid, `${other.label}, on ${other.host}`);
    if (state !== 'gone') return busy(other.pid, other.label);
    stale.push(other);
  }

  if (!carried.length && String(row.status || '').toLowerCase() === 'in_progress') {
    let live = [];
    try {
      live = (sessions() || []).filter((s) => asPid(s?.pid) && asPid(s.pid) !== owner && namesBead(s.name, beadId));
    } catch {
      live = [];
    }
    const other = live.find((s) => probe(s.pid, { ps }) !== 'gone');
    if (other) return busy(asPid(other.pid), `pid ${asPid(other.pid)} ("${other.name}")`);
    out.notes.push(`${beadId} was claimed the old way, by no session that is still alive — taking it over`);
  }

  const own = carried.find((m) => isOwn(m, owner, here));
  if (own) {
    out.already = true;
    mine.label = own.label;
  } else {
    try {
      bd(['label', 'add', beadId, mine.label]);
    } catch (err) {
      return { ...out, refused: `could not label ${beadId} — ${said(err)}. Nothing else was written.` };
    }
  }

  // The race: another session that read the bead before either of us wrote.
  if (reread) {
    let now = null;
    try {
      now = reread();
    } catch {
      now = null;
    }
    const rivals = markers(now).filter(
      (m) => !isOwn(m, owner, here) && !stale.some((s) => s.label === m.label) && probeMarker(m, { ps, here }) !== 'gone'
    );
    const winner = rivals.reduce((best, m) => (before(m, best) ? m : best), mine);
    if (winner !== mine) {
      try {
        bd(['label', 'remove', beadId, mine.label]);
      } catch (err) {
        out.notes.push(`and could not take ${mine.label} back off (${said(err)}); the sweep will once this session exits`);
      }
      return { ...busy(winner.pid, `${winner.label}, which claimed it in the same moment`), notes: out.notes };
    }
  }

  for (const gone of stale) {
    try {
      bd(['label', 'remove', beadId, gone.label]);
      out.replaced.push(gone.label);
    } catch (err) {
      out.notes.push(`the stale ${gone.label} is still on ${beadId} (${said(err)}); the sweep will take it off`);
    }
  }

  try {
    bd(['update', beadId, '--claim']);
  } catch (err) {
    // bd said no — another actor's claim. The marker would then hold a bead we do not
    // own, so it comes back off and the refusal is bd's own.
    try {
      if (!out.already) bd(['label', 'remove', beadId, mine.label]);
    } catch {
      // the sweep clears it once this session exits
    }
    return { ...out, refused: `bd would not claim ${beadId}: ${said(err)}` };
  }
  return { ...out, claimed: true, holder: owner };
}

/** `namesBead` from lib/reap.js, restated so this module keeps no import on the reaper. */
function defaultNamesBead(name, id) {
  if (!name || !id) return false;
  const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w.-])${escaped}(?![\\w.-])`).test(String(name));
}

/**
 * The live Claude sessions on this machine, `[{ pid, name }]`, off the harness's own
 * registry `~/.claude/sessions/<pid>.json`. Liveness is the caller's `probe`; this only
 * reads. `dir` is injectable for tests.
 */
export function claudeSessions(dir = path.join(os.homedir(), '.claude', 'sessions')) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    return [];
  }
  const out = [];
  for (const f of names) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (asPid(rec?.pid)) out.push({ pid: asPid(rec.pid), name: String(rec.name || '') });
    } catch {
      // a record being rewritten mid-read; the next claim sees it
    }
  }
  return out;
}

/**
 * Take the marker off every bead whose owner has gone. `bd` is the async `Bd`, and
 * `bd.listHandWorked(ws)` is every live bead carrying a marker, whatever its status —
 * a hand session that claimed its bead leaves it `in_progress`, which `bd ready` never
 * returns, and a marker nothing can see is a marker nothing ever clears.
 *
 * **A marker from another machine** (bc-obucr.26) is not this `ps`'s to judge, and the
 * machine that wrote it is not sweeping this workspace — studio's daemon serves it, the
 * laptop's does not. So it holds, quietly (`remote`, not `skipped`, which the advocate
 * logs every pass), until the bead has gone `remoteTtlMs` without an update. Then it is
 * read as abandoned and cleared like a gone one. A session still building a bead touches
 * it — a comment, a status, a label — well inside a day; one that has not in a day is
 * not one an advocate's second window would be racing.
 */
export const REMOTE_MARKER_TTL_MS = 24 * 60 * 60 * 1000;

export async function sweepHandSessions(
  bd,
  ws,
  { ps = psArgs, here = localHost(), remoteTtlMs = REMOTE_MARKER_TTL_MS, now = Date.now() } = {}
) {
  const out = { ok: false, reason: '', checked: 0, cleared: [], skipped: [], remote: [] };
  let rows;
  try {
    rows = await bd.listHandWorked(ws);
  } catch (err) {
    out.reason = `could not read the marked beads — ${String(err.message || err).split('\n')[0]}`;
    return out;
  }
  out.ok = true;
  for (const row of rows || []) {
    const labels = (row.labels || []).map((l) => String(l).trim()).filter((l) => l.startsWith(HAND_PREFIX));
    if (!labels.length) continue;
    out.checked += 1;
    // A label that does not parse is not a marker and holds nothing — read as gone.
    const parsed = labels.map((l) => parseMarker(l));
    const pids = parsed.map((m) => m?.pid || 0);
    const states = parsed.map((m) => (m ? probeMarker(m, { ps, here }) : 'gone'));
    if (states.includes('live')) continue; // the marker is doing its job
    if (states.includes('unknown')) {
      out.skipped.push({ id: row.id, why: `could not ask ps about ${labels.join(', ')}` });
      continue;
    }
    let abandoned = false;
    if (states.includes('remote')) {
      const touched = Date.parse(row.updated_at || '');
      const quiet = Number.isFinite(touched) ? now - touched : Infinity;
      if (!(quiet >= remoteTtlMs)) {
        out.remote.push({ id: row.id, labels });
        continue;
      }
      abandoned = true;
    }
    let removed = 0;
    for (const label of labels) {
      try {
        await bd.removeLabel(ws, row.id, label);
        removed += 1;
      } catch (err) {
        out.skipped.push({ id: row.id, why: `could not clear ${label} — ${String(err.message || err).split('\n')[0]}` });
      }
    }
    if (removed !== labels.length) continue;
    try {
      await bd.comment(
        ws,
        row.id,
        abandoned
          ? `Marked ${labels.join(', ')} by a session on another machine, and untouched for ${Math.round(remoteTtlMs / 3600000)}h — ` +
              'read as abandoned, the marker is cleared, and this is ordinary work again.'
          : `The session that marked this ${labels.join(', ')} has exited — the marker is cleared, and this is ordinary work again.`
      );
    } catch {
      // The label is what put it back in the queue; a lost comment costs context only.
    }
    out.cleared.push({ id: row.id, title: row.title || '', pids: pids.filter(Boolean) });
  }
  return out;
}

/** One line for the log. Empty when there is nothing to say. */
export function describeHandSessions(result) {
  if (!result.ok) return result.reason ? `hand-session sweep skipped — ${result.reason}` : '';
  if (!result.cleared.length) return '';
  const named = result.cleared.map((c) => `${c.id} (pid ${c.pids.join(', ')})`).join(', ');
  return `cleared ${result.cleared.length} hand-session marker${result.cleared.length === 1 ? '' : 's'} — ${named}`;
}
