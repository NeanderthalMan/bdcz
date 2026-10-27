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

/** The marker's prefix. One spelling, in one place. */
export const HAND_PREFIX = 'worked-by:';

/** `worked-by:14758`. What gets written, and what the sweep reads back. */
export const handLabel = (pid) => `${HAND_PREFIX}${Number(pid)}`;

const PID_RE = /^[1-9][0-9]{0,9}$/;

/** A positive integer pid, or 0. */
export const asPid = (raw) => (PID_RE.test(String(raw ?? '').trim()) ? Number(String(raw).trim()) : 0);

/**
 * The pid a bead is marked as worked by, or 0. Takes a `bd --json` row, or anything
 * carrying `labels`. A label whose tail is not a pid is not a marker and holds nothing.
 */
export function workedBy(issue) {
  for (const raw of issue?.labels || []) {
    const label = String(raw).trim();
    if (!label.startsWith(HAND_PREFIX)) continue;
    const pid = asPid(label.slice(HAND_PREFIX.length));
    if (pid) return pid;
  }
  return 0;
}

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
 * Why this bead may not be worked. `status: 409` and `handWorked: true`, the refusal
 * shape lib/farblock.js and lib/superseded.js use, so the advocate does not retry it.
 */
export const refusal = (id, pid) =>
  Object.assign(
    new Error(`${id || 'that bead'} may not be worked — ${HAND_PREFIX}${pid}, a live session nobody briefed, is working it`),
    { status: 409, handWorked: true, workedBy: pid }
  );

/**
 * The gate, off a row the caller already read. Refuses only while the owner is live —
 * a stale marker is the sweep's business, and refusing on it would hold the bead for a
 * process that no longer exists. `unknown` refuses: "I could not check" is not "free".
 */
export function assertNotHandWorked(issue, { ps = psArgs } = {}) {
  const pid = workedBy(issue);
  if (pid && probe(pid, { ps }) !== 'gone') throw refusal(issue?.id, pid);
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
 * Never throws. Returns `{ marked, alreadyMarked, released, replaced, refused, notes }`.
 */
export function mark(bd, id, pid, { row = null, ps = psArgs } = {}) {
  const out = { marked: false, alreadyMarked: false, released: false, replaced: 0, refused: '', notes: [] };
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

  const carried = workedBy(row);
  if (carried === owner) {
    out.alreadyMarked = true;
    out.marked = true;
    out.notes.push(`${beadId} was already marked ${handLabel(owner)} — nothing to do`);
    return out;
  }
  if (carried && probe(carried, { ps }) !== 'gone') {
    return {
      ...out,
      refused: `${beadId} is already ${handLabel(carried)}, and that session is still alive. Two sessions on one bead is for a person to sort out.`,
    };
  }

  try {
    bd(['label', 'add', beadId, handLabel(owner)]);
    out.marked = true;
  } catch (err) {
    return { ...out, refused: `could not label ${beadId} — ${said(err)}. Nothing else was written.` };
  }
  if (carried) {
    try {
      bd(['label', 'remove', beadId, handLabel(carried)]);
      out.replaced = carried;
    } catch (err) {
      out.notes.push(`the stale ${handLabel(carried)} is still on ${beadId} (${said(err)}); the sweep will take it off`);
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

/**
 * Take the marker off every bead whose owner has gone. `bd` is the async `Bd`, and
 * `bd.listHandWorked(ws)` is every live bead carrying a marker, whatever its status —
 * a hand session that claimed its bead leaves it `in_progress`, which `bd ready` never
 * returns, and a marker nothing can see is a marker nothing ever clears.
 */
export async function sweepHandSessions(bd, ws, { ps = psArgs } = {}) {
  const out = { ok: false, reason: '', checked: 0, cleared: [], skipped: [] };
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
    const pids = labels.map((l) => asPid(l.slice(HAND_PREFIX.length)));
    const states = pids.map((p) => probe(p, { ps }));
    if (states.includes('live')) continue; // the marker is doing its job
    if (states.includes('unknown')) {
      out.skipped.push({ id: row.id, why: `could not ask ps about ${labels.join(', ')}` });
      continue;
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
        `The session that marked this ${labels.join(', ')} has exited — the marker is cleared, and this is ordinary work again.`
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
