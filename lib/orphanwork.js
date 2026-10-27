/**
 * The worktrees holding uncommitted work that nobody ever committed.
 *
 * A worker window that dies before it commits leaves its whole diff in its worktree,
 * uncommitted, and **nothing surfaces it**. lib/tidy.js is right to leave those
 * worktrees alone — gate 4 is "no uncommitted files" — and it will leave them for ever;
 * the bead each one belonged to went back to the queue reading like unstarted work. Read
 * off a real checkout on 2026-09-19 (bc-iaju1.12): of 105 live worktrees, 31 had no
 * commits of their own, 28 of those had been untouched for a week, and 26 were dirty —
 * one with 45 modified files, one holding a whole uncommitted `lib/surface.js` and two
 * new suites. The oldest was 41 days old.
 *
 * lib/tidy.js says nothing about them, and bc-dgx7.134 (b7e-salvage) is about reading ONE
 * worktree once you already suspect it. This is the census that tells you which to suspect.
 *
 * ## What it may do about it
 *
 * **Nothing to the worktrees, ever.** This is not a deletion sweep and must not become
 * one: the whole point is that this work is worth reading, not that it is in the way. It
 * reads `git status` and `git rev-list`, and it writes one bead.
 *
 * ## What counts
 *
 * A worktree is named when **all** of these hold, each of which removes a way of being
 * wrong:
 *
 *   1. it lives under `<main checkout>/.claude/worktrees/` — never the main checkout,
 *      never the attic;
 *   2. **nobody is in it**: no live `claude` session has it as a cwd, and it is not
 *      locked to a pid that is still running. A lock whose pid is dead is precisely a
 *      dead attempt, which is the case this exists for; a lock with no pid in it (a
 *      hand-written reason) is honoured, because there is nothing to check it against;
 *   3. it has **no commits of its own** — nothing in `base..HEAD`. A branch with commits
 *      is a different finding (lib/notinmain.js) and its work at least survives on a ref;
 *   4. `git status --porcelain` is not empty, untracked files included;
 *   5. **the newest of the dirty files is older than `IDLE_DAYS`.** Measured on the dirty
 *      files themselves rather than on a walk of the tree: it is what the question is
 *      about, it costs a `stat` per file, and it cannot be fooled by a `node_modules`
 *      symlink or a build directory touched last night.
 *
 * ## One card, not one per worktree
 *
 * Twenty-six cards would be the attention load this whole review (bc-iaju1) is trying to
 * *reduce*. So it is one bead per workspace — `CARD_TITLE` — that lists them, biggest
 * first, and is found again **by its own title** rather than by a record on disk (see
 * lib/sweepcard.js, whose record outlives its cards). Three things follow from that:
 *
 *   - **still awaiting an answer and the census moved** → its description is rewritten,
 *     so it never quotes a worktree that has since been committed;
 *   - **the census is empty** → it closes itself with a note;
 *   - **answered, or being worked** → it is left alone. A live bead of that title that
 *     is not in the inbox is a session salvaging, and a second card beside it would be
 *     the same finding twice.
 *
 * And a card Adam has already closed is not re-filed for the same worktrees. Its
 * description carries `NAMES_MARK` with every name it listed; a new card is filed only
 * for worktrees that were not on the last one. Without that, "let them go" would be
 * asked again at the next sweep, for ever.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, ok, mainCheckout } from './gitref.js';
import { parseWorktrees, realPath } from './tidy.js';
import { pickBase, ownsBranch } from './notinmain.js';
import { homeIn } from './homing.js';

const HUMAN_LABEL = 'human';

/** How long the newest dirty file has to have sat there. See fact 5. */
export const IDLE_DAYS = 3;

/**
 * How many rows the card draws. The census counts all of them; the card says how many it
 * left off. On a phone the first dozen is the whole decision, and the rest are in the
 * checkout for anyone who asks.
 */
export const MAX_ROWS = 25;

/** How many worktrees `git status` is asked about at once. */
const CONCURRENCY = 6;

/**
 * Dirty files that are `stat`ed for the idle age. A worktree with more than this many
 * uncommitted paths is not idle in any interesting way — the answer is "a lot" — so the
 * newest of the first ones is a fine bound and a checkout with a runaway untracked tree
 * cannot spend the tick.
 */
const MAX_STATS = 2000;

/** The card's title. Constant on purpose: it is how the sweep finds the card again. */
export const CARD_TITLE = 'Worktrees are holding uncommitted work that no session is in';

/** Carries every worktree name the card listed, so a closed card can say what it covered. */
export const NAMES_MARK = 'beadcause:orphanwork-names';
/** Carries a fingerprint of the census, so an unchanged card is not rewritten every sweep. */
export const PRINT_MARK = 'beadcause:orphanwork';

const markRe = (mark) => new RegExp(`<!--\\s*${mark}\\s+([^>]*?)\\s*-->`);

const isAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

const under = (p, root) => p === root || p.startsWith(root + path.sep);

/**
 * `git worktree list --porcelain` → `path → lock reason`, for the locked ones.
 *
 * lib/tidy.js's `parseWorktrees` keeps only that a worktree is locked and drops the
 * reason, which is where the pid is (`claude agent <id> (pid 5333 start …)`, or
 * `resolver pid 83789 #767`). Read here rather than widened there because that parser is
 * shared with the attic sweep and another branch is editing it.
 */
export function lockReasons(porcelain) {
  const out = new Map();
  let cur = null;
  for (const line of String(porcelain || '').split('\n')) {
    if (line.startsWith('worktree ')) cur = line.slice(9).trim();
    else if (cur && line.startsWith('locked')) out.set(cur, line.slice(6).trim());
  }
  return out;
}

/** The pid a lock reason names, or null — a reason with no pid in it cannot be checked. */
export function lockPid(reason) {
  const m = /\bpid\s+(\d+)\b/i.exec(String(reason || ''));
  return m ? Number(m[1]) : null;
}

/**
 * `git status --porcelain` → what is dirty, split the way a person reads it.
 *
 * `files` is every changed path, `untracked` those git has never seen. Paths in a rename
 * (`R  old -> new`) are the new one, which is the one that exists.
 */
export function readStatus(porcelain) {
  const files = [];
  let untracked = 0;
  for (const line of String(porcelain || '').split('\n')) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    let name = line.slice(3).replace(/^"|"$/g, '');
    const arrow = name.indexOf(' -> ');
    if (arrow >= 0) name = name.slice(arrow + 4);
    files.push(name);
    if (code === '??') untracked += 1;
  }
  return { files, untracked, modified: files.length - untracked };
}

/** Newest mtime among these paths under `root`, or 0 when none can be read (all deleted). */
function newestOf(root, files) {
  let newest = 0;
  for (const f of files.slice(0, MAX_STATS)) {
    try {
      newest = Math.max(newest, fs.lstatSync(path.join(root, f)).mtimeMs);
    } catch {
      /* deleted, which is a change with no mtime */
    }
  }
  return newest;
}

/** Run `fn` over `items`, `n` at a time, keeping order. Never rejects — `fn` must not throw. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/**
 * The census for one checkout. Never throws for a git that will not answer about one
 * worktree — that worktree goes in `skipped` with the reason, and the rest are counted.
 *
 * `sessions` is lib/claude.js's live list, passed in so the whole tick is decided against
 * one snapshot of what was running.
 */
export async function censusOrphanWork(
  dir,
  { sessions = [], now = Date.now(), idleDays = IDLE_DAYS, base = 'main', isLive = isAlive } = {}
) {
  const out = { ok: false, reason: '', main: '', found: [], skipped: [], scanned: 0 };
  let main;
  try {
    main = await mainCheckout(dir);
  } catch (err) {
    out.reason = `${dir} is not a git checkout — ${String(err.message || err).split('\n')[0]}`;
    return out;
  }
  out.main = main;

  const baseRef = await pickBase(main, base);
  if (!baseRef) {
    out.reason = `neither origin/${base} nor ${base} is a ref in ${main}`;
    return out;
  }

  const porcelain = await ok(git(main, ['worktree', 'list', '--porcelain']));
  if (porcelain === null) {
    out.reason = `git worktree list failed in ${main}`;
    return out;
  }
  out.ok = true;

  const wtRoot = realPath(path.join(main, '.claude', 'worktrees'));
  const locks = lockReasons(porcelain);
  const candidates = [];
  for (const wt of parseWorktrees(porcelain)) {
    if (!under(realPath(wt.path), wtRoot) || realPath(wt.path) === wtRoot) continue; // main, the attic, or outside
    out.scanned += 1;
    const name = path.basename(wt.path);

    if (locks.has(wt.path)) {
      const pid = lockPid(locks.get(wt.path));
      // A lock whose pid is running is somebody's claim. One whose pid is gone is the
      // dead attempt this is looking for. One with no pid at all cannot be told apart
      // from a claim, so it is honoured — the direction that leaves work alone.
      if (pid === null || isLive(pid)) {
        out.skipped.push({ name, why: pid === null ? 'locked, with no pid to check' : `locked to pid ${pid}, which is running`, quiet: true });
        continue;
      }
    }
    const inIt = sessions.find((s) => s.cwd && under(realPath(s.cwd), realPath(wt.path)));
    if (inIt) {
      out.skipped.push({ name, why: `a session is working in it (pid ${inIt.pid})`, quiet: true });
      continue;
    }
    candidates.push({ wt, name });
  }

  const rows = await pool(candidates, CONCURRENCY, async ({ wt, name }) => {
    // Commits first: it is the cheaper of the two and the far commoner reason to be
    // silent, since most worktrees that have done anything have committed it.
    const count = await ok(git(wt.path, ['rev-list', '--count', `${baseRef.ref}..HEAD`]));
    if (count === null) return { skip: { name, why: 'git could not count its commits' } };
    if (Number(String(count).trim()) > 0) return { skip: { name, why: 'has commits of its own', quiet: true } };

    const status = await ok(git(wt.path, ['status', '--porcelain', '--untracked-files=all']));
    if (status === null) return { skip: { name, why: 'git could not read its status' } };
    const dirty = readStatus(status);
    if (!dirty.files.length) return { skip: { name, why: 'clean', quiet: true } };

    let newest = newestOf(wt.path, dirty.files);
    // Every dirty file was deleted, so there is no mtime to read. The directory's own is
    // the least-wrong stand-in: it moves when a file is removed from it.
    if (!newest) {
      try {
        newest = fs.statSync(wt.path).mtimeMs;
      } catch {
        return { skip: { name, why: 'cannot read it' } };
      }
    }
    const idle = (now - newest) / 86400000;
    if (idle < idleDays) {
      return { skip: { name, why: `its newest uncommitted file is ${idle < 1 ? 'under a day' : `${Math.floor(idle)}d`} old`, quiet: true } };
    }
    return {
      found: {
        name,
        path: wt.path,
        branch: wt.branch || `worktree-${name}`,
        files: dirty.files.length,
        modified: dirty.modified,
        untracked: dirty.untracked,
        idleDays: Math.floor(idle),
        sample: dirty.files.slice(0, 3),
      },
    };
  });

  for (const r of rows) {
    if (r.skip) out.skipped.push(r.skip);
    else if (r.found) out.found.push(r.found);
  }
  // The biggest diff first: it is the most that could be lost, and it is the one a person
  // reading the top of the card should meet before they decide anything.
  out.found.sort((a, b) => b.files - a.files || b.idleDays - a.idleDays || a.name.localeCompare(b.name));
  return out;
}

/** The bead whose tag a worktree's name ends in, when exactly one bead does. */
export function beadFor(name, beads) {
  const branch = `worktree-${name}`;
  const hit = (beads || []).filter((b) => b?.id && ownsBranch(b.id, branch));
  return hit.length === 1 ? hit[0] : null;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A stable fingerprint of what the card says, so an unchanged census does not rewrite it. */
export function fingerprint(rows) {
  const s = rows.map((r) => `${r.repo || ''}/${r.name}:${r.files}`).sort().join('|');
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

const stripMd = (s) => String(s || '').replace(/[*_`\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/** One line of the card. */
export function rowLine(r) {
  const where = r.repo ? `${r.repo}: ` : '';
  const split = r.untracked && r.modified ? `${r.modified} modified, ${r.untracked} new` : r.untracked ? 'all new' : 'all modified';
  const bead = r.bead ? ` — ${r.bead.id}${r.bead.title ? ` “${stripMd(r.bead.title).slice(0, 70)}”` : ''}${r.bead.status ? ` (${r.bead.status})` : ''}` : '';
  const sample = r.sample?.length ? ` · ${r.sample.map((f) => `\`${f}\``).join(', ')}${r.files > r.sample.length ? ', …' : ''}` : '';
  return `- ${where}\`${r.name}\` — **${plural(r.files, 'file')}** (${split}), idle ${r.idleDays}d${bead}${sample}`;
}

/**
 * The card. The question is last and it is the whole of the ask — see lib/decision.js;
 * everything above it is context for a person reading on a phone.
 */
export function orphanCard(rows, { idleDays = IDLE_DAYS, max = MAX_ROWS, checkouts = [] } = {}) {
  const n = rows.length;
  const files = rows.reduce((t, r) => t + r.files, 0);
  const shown = rows.slice(0, max);
  const more = n - shown.length;
  const names = rows.map((r) => (r.repo ? `${r.repo}/${r.name}` : r.name)).sort().join(',');
  const where = checkouts.length
    ? `They live under ${checkouts.map((c) => `\`${c}/.claude/worktrees/\``).join(' and ')}.`
    : 'They live under `.claude/worktrees/`.';

  return `## ${plural(n, 'worktree')} hold ${plural(files, 'uncommitted file')} that no session is in

Each of these has **no commits of its own**, has files that were never committed, has had
nothing touched for **${idleDays} days or more**, and has no live session or live lock on
it. That is what a worker window that died before it committed looks like: its whole diff
is sitting here, and the bead it belonged to went back to the queue reading like work
nobody had started. ${where}

${shown.map(rowLine).join('\n')}${more > 0 ? `\n- …and ${plural(more, 'more')}, smaller, not listed` : ''}

**Nothing has been deleted, moved or committed** by the sweep that found these, and it
cannot do any of those — lib/tidy.js will keep refusing to retire them for as long as they
are dirty, which is what makes this list the only place they show up. It looks again every
few hours and rewrites this card as they are dealt with; it closes it when none are left.

**Salvage** leaves this open as ordinary work: a session reads each diff (\`git -C <worktree>
diff\`), commits what is worth keeping to its branch and delivers it, and
says on the bead what it dropped. **Let them go** closes this; the worktrees stay exactly as
they are and this will not be asked again about these — only about a worktree that is not
on this list.

<!-- ${PRINT_MARK} ${fingerprint(rows)} -->
<!-- ${NAMES_MARK} ${names} -->

\`\`\`decision
question: "${plural(n, 'worktree')} hold ${plural(files, 'uncommitted file')} nobody committed. Salvage them?"
options:
  - id: salvage
    label: Salvage — read each diff and land what is worth keeping
    response: "Salvaging: a session should read each listed worktree's uncommitted diff, commit and deliver what is worth keeping, and say on the bead what it dropped."
    hint: Keeps this open as ordinary work
    closes: false
    recommended: true
  - id: let-go
    label: Let them go — none of it is worth keeping
    response: "Let go: the uncommitted work in these worktrees is abandoned. Nothing is deleted, and they are not to be raised again."
    hint: Closes this; deletes nothing
\`\`\`
`;
}

/** Every name a card's description said it covered. */
export function namesOn(description) {
  const m = markRe(NAMES_MARK).exec(String(description || ''));
  return new Set(m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []);
}

/** The fingerprint a card's description carries, or ''. */
export function printOn(description) {
  const m = markRe(PRINT_MARK).exec(String(description || ''));
  return m ? m[1].trim() : '';
}

const rowKey = (r) => (r.repo ? `${r.repo}/${r.name}` : r.name);

/**
 * Sweep one workspace: census every checkout, then file, rewrite or close the one card.
 *
 * `repos` is `[{ dir, name }]` — `name` null for a workspace with a single checkout.
 * Returns what it did and never throws for one checkout that cannot answer; a tracker
 * that will not answer stops the write half and says so in `reason`.
 */
export async function sweepOrphanWork(
  bd,
  ws,
  repos,
  { sessions = [], now = Date.now(), idleDays = IDLE_DAYS, base = 'main', isLive = isAlive, maxRows = MAX_ROWS } = {}
) {
  const out = { ok: false, reason: '', scanned: 0, found: 0, files: 0, filed: null, refreshed: null, closed: null, held: '', failed: [] };

  const rows = [];
  const checkouts = [];
  for (const repo of repos) {
    let c;
    try {
      c = await censusOrphanWork(repo.dir, { sessions, now, idleDays, base, isLive });
    } catch (err) {
      out.failed.push(`${repo.name ? `${repo.name}: ` : ''}${String(err.message || err).split('\n')[0]}`);
      continue;
    }
    if (!c.ok) {
      if (c.reason) out.failed.push(`${repo.name ? `${repo.name}: ` : ''}${c.reason}`);
      continue;
    }
    out.ok = true;
    out.scanned += c.scanned;
    if (c.found.length) checkouts.push(c.main);
    for (const f of c.found) rows.push({ ...f, repo: repo.name || '' });
  }
  if (!out.ok) {
    out.reason = out.failed[0] || 'no checkout to look at';
    return out;
  }
  rows.sort((a, b) => b.files - a.files || b.idleDays - a.idleDays || rowKey(a).localeCompare(rowKey(b)));
  out.found = rows.length;
  out.files = rows.reduce((t, r) => t + r.files, 0);
  out.rows = rows;

  // The card is found by its title, over the inbox first: that is the only place a card
  // still waiting for an answer can be, and it is one `bd human list` for the workspace.
  let waiting;
  try {
    waiting = (await bd.listHuman(ws)).find((c) => c?.title === CARD_TITLE) || null;
  } catch (err) {
    out.ok = false;
    out.reason = `could not read the inbox — ${String(err.message || err).split('\n')[0]}`;
    return out;
  }

  if (waiting) {
    if (!rows.length) {
      try {
        await bd.close(
          ws,
          waiting.id,
          'Every worktree this listed has been committed, moved or removed — nothing is left holding uncommitted work no session is in.'
        );
        out.closed = waiting.id;
      } catch (err) {
        out.failed.push(`could not close ${waiting.id} — ${String(err.message || err).split('\n')[0]}`);
      }
      return out;
    }
    let body = '';
    try {
      body = String((await bd.show(ws, waiting.id))?.description || '');
    } catch (err) {
      out.failed.push(`could not read ${waiting.id} — ${String(err.message || err).split('\n')[0]}`);
      return out;
    }
    // Before the bead lookup, which is a `bd list --all` and is the dearest thing here:
    // the fingerprint is over names and counts, which are already in hand.
    if (printOn(body) === fingerprint(rows)) return out; // nothing moved
    const next = orphanCard(await beadsFor(bd, ws, rows), { idleDays, max: maxRows, checkouts });
    try {
      await bd.update(ws, waiting.id, { description: next });
      out.refreshed = waiting.id;
    } catch (err) {
      out.failed.push(`could not rewrite ${waiting.id} — ${String(err.message || err).split('\n')[0]}`);
    }
    return out;
  }

  if (!rows.length) return out;

  // A live bead of this title that is not in the inbox is one somebody answered "salvage"
  // to and a session is working. Filing a second beside it would be the same finding twice.
  let live = [];
  try {
    live = await bd.listLive(ws);
  } catch (err) {
    out.ok = false;
    out.reason = `could not read the tracker — ${String(err.message || err).split('\n')[0]}`;
    return out;
  }
  const inFlight = live.find((b) => b?.title === CARD_TITLE);
  if (inFlight) {
    out.held = `${inFlight.id} is already being worked`;
    return out;
  }

  // And a card Adam already closed covers the worktrees it listed. Only what it did not
  // list is news. Read once, and only here — this is the path that is about to file.
  let covered = new Set();
  try {
    const closed = (await bd.listStatus(ws, 'closed')).filter((b) => b?.title === CARD_TITLE);
    closed.sort((a, b) => String(b.closed_at || b.updated_at || '').localeCompare(String(a.closed_at || a.updated_at || '')));
    if (closed[0]) covered = namesOn((await bd.show(ws, closed[0].id))?.description);
  } catch (err) {
    // Not knowing what was covered means filing for all of them, which is the wrong
    // direction to guess in: a card asked twice is worse than one asked an hour late.
    out.ok = false;
    out.reason = `could not read the closed cards — ${String(err.message || err).split('\n')[0]}`;
    return out;
  }
  const fresh = rows.filter((r) => !covered.has(rowKey(r)));
  if (!fresh.length) {
    out.held = `all ${plural(rows.length, 'worktree')} were on a card that has been answered`;
    return out;
  }

  const beads = await beadsFor(bd, ws, rows);
  const { parent } = await homeIn(bd, ws, {});
  try {
    out.filed = await bd.create(ws, {
      title: CARD_TITLE,
      body: orphanCard(beads, { idleDays, max: maxRows, checkouts }),
      priority: 2,
      type: 'task',
      labels: [HUMAN_LABEL],
      deps: [],
      parent,
    });
  } catch (err) {
    out.failed.push(`could not file the card — ${String(err.message || err).split('\n')[0]}`);
  }
  return out;
}

/** The rows with the bead each worktree's name encodes, best effort — a card without it is still a card. */
async function beadsFor(bd, ws, rows) {
  let beads = [];
  try {
    beads = await bd.listAll(ws);
  } catch {
    return rows;
  }
  return rows.map((r) => {
    const b = beadFor(r.name, beads);
    return b ? { ...r, bead: { id: b.id, title: b.title || '', status: b.status || '' } } : r;
  });
}

/** One line for the daemon log; '' when there is nothing worth a line. */
export function describeOrphanWork(r) {
  if (!r) return '';
  if (!r.ok) return r.reason ? `orphaned-work census skipped — ${r.reason}` : '';
  const parts = [];
  if (r.filed) parts.push(`filed ${r.filed} for ${plural(r.found, 'worktree')} holding ${plural(r.files, 'uncommitted file')}`);
  if (r.refreshed) parts.push(`rewrote ${r.refreshed} — ${plural(r.found, 'worktree')} now`);
  if (r.closed) parts.push(`closed ${r.closed} — none left`);
  for (const f of r.failed || []) parts.push(f);
  return parts.length ? `orphaned work: ${parts.join('; ')}` : '';
}
