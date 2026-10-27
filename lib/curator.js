/**
 * The memory curator: once a week, tidy every agent's notes in a repo (bc-u1ltu.5).
 *
 * bc-u1ltu gave a note a shape (one claim, under a cap, with evidence), gave the store an
 * index, and gave `staleNotes` a way to say which notes the evidence has left behind. None
 * of that touches the backlog. On 2026-10-01 the worker's store here held 1,164 notes, with
 * thirteen key prefixes shared by five or more notes (24 `sw-cache-*`, 17 `adding-a-*`, 17
 * `b7e-gate-*`), ten notes over the 4 KB cap (one of them 237 KB), and twenty-two notes read
 * 25 times or more. A note read that often is a rule, and a rule belongs in the README, a
 * test or a lint, where it cannot be skipped. This file is the sweep that works through
 * that backlog, a little each week.
 *
 * ## Four actions, and which of them need a model
 *
 * - **Archive.** Deterministic. The policy is Adam's (bc-ltgld): a note the evidence says is
 *   stale (a scope, a path or a name that is gone at HEAD) is archived on sight. A note that
 *   is merely *unused* is archived only when it is older than `UNUSED_AGE_DAYS` **and** the
 *   read log goes back that far, at most `UNUSED_MAX` a run, oldest first. The second
 *   condition matters: the read log started on 2026-08-14, so before 2026-10-13 a note can
 *   look unused only because nobody was counting. Archiving is `archiveNotes`, which is
 *   recoverable with `note --restore`.
 * - **Promote.** Deterministic. A note read `PROMOTE_READS` times or more gets a bead asking
 *   for its rule to be moved into the repo and the note archived. At most `PROMOTE_MAX` a
 *   run, most-read first, and never the same note twice (the ledger remembers).
 * - **Merge** a prefix cluster, and **split** an oversized note. These need prose, so they
 *   are one headless `claude -p` per run, handed at most `MERGE_MAX` clusters and
 *   `SPLIT_MAX` notes. It answers in a fenced `curate` block. Every proposal is checked here
 *   against the same rules `note` holds a session to (cap, evidence, kind), and against the
 *   store as it is (no collision with a live key it was not given). What passes is written
 *   with `replaceNotes`: **one commit per merge or split**, so one action is one step to
 *   undo, and the ref's history keeps every note it replaced.
 *
 * ## Exactly once a week, from a ledger
 *
 * `refs/beadcause/curator` in the curated checkout, the same shape as lib/sessionaudit.js's
 * ledger: `run.json` is what one run did, `state.json` is what every later run asks. That
 * is when the last run was, which notes already have a promotion bead, and which clusters
 * and notes the model was shown and when. A cluster the model chose to leave alone is not
 * offered again for `LOOK_AGAIN_DAYS`, so the weekly run moves on to the next one instead
 * of asking the same question every week. A daemon restart loses nothing.
 */
import YAML from 'yaml';
import { runHeadless } from './agentrun.js';
import { fileBeads as fileBeadsDefault } from './filing.js';
import { ok, mainCheckout, writeTree, commitToRef, readRefFile } from './gitref.js';
import {
  noteAgents,
  notesStore,
  staleNotes,
  archiveNotes,
  replaceNotes,
  noteReads,
  checkNote,
  NOTE_MAX_BYTES,
  NOTE_AIM_BYTES,
  NOTE_KINDS,
} from './memory.js';
import { entries as readLog } from './memoryuse.js';
import { autoEndorseAllowed } from './spaces.js';
import { repoUnits } from './repos.js';
import { resolveSessionDir } from './session.js';

/** The ledger, in the checkout whose notes were curated. */
export const CURATOR_REF = 'refs/beadcause/curator';

/** A note read this many times is a rule, and gets a bead to move it out (pragma point 6). */
export const PROMOTE_READS = 25;
/** How many promotion beads one run may file. Twenty-two at once would be a backlog. */
export const PROMOTE_MAX = 5;
/** How many notes have to share a prefix before the prefix is a cluster worth merging. */
export const CLUSTER_MIN = 5;
/** How many clusters, and how many oversized notes, one run hands the model. */
export const MERGE_MAX = 2;
export const SPLIT_MAX = 3;
/** How long a cluster or a note the model was shown waits before it is offered again. */
export const LOOK_AGAIN_DAYS = 28;
/** bc-ltgld: an unused note is archived only past this age, with the read log this old. */
export const UNUSED_AGE_DAYS = 60;
/** bc-ltgld: at most this many unused notes archived in one run, oldest first. */
export const UNUSED_MAX = 50;
/** The bodies handed to the model are clipped here. The 237 KB note is real. */
export const BODY_MAX = 16 * 1024;
/** How long a run may take before it is killed. */
export const TIMEOUT_MS = 15 * 60 * 1000;
/** The label every promotion bead carries, and the home `fileBeads` looks for. */
export const PROMOTE_LABEL = 'note-promotion';

const DAY = 86400000;

/* ------------------------------------------------------------------ the planners */

/** A key's prefix: its first two words. `sw-cache-version-conflicts` → `sw-cache`. */
export const prefixOf = (key) => String(key).split(/[-_.]+/).slice(0, 2).join('-');

/** Keys that share a prefix, `min` or more to a group, largest group first. */
export function prefixClusters(index, { min = CLUSTER_MIN } = {}) {
  const groups = new Map();
  for (const key of Object.keys(index || {})) {
    const p = prefixOf(key);
    if (!p.includes('-')) continue; // a one-word key has no prefix to share
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(key);
  }
  return [...groups]
    .filter(([, keys]) => keys.length >= min)
    .map(([prefix, keys]) => ({ prefix, keys: keys.sort() }))
    .sort((a, b) => b.keys.length - a.keys.length || a.prefix.localeCompare(b.prefix));
}

/** Notes over the cap, largest first. */
export function oversizedNotes(index, { cap = NOTE_MAX_BYTES } = {}) {
  return Object.entries(index || {})
    .filter(([, row]) => (row?.bytes || 0) > cap)
    .sort((a, b) => b[1].bytes - a[1].bytes || a[0].localeCompare(b[0]))
    .map(([key, row]) => ({ key, bytes: row.bytes }));
}

/**
 * Which of `staleNotes`' answers to archive, under bc-ltgld.
 *
 * `stale` must have been computed with `days: UNUSED_AGE_DAYS`, so that `unused` means "no
 * read, verify or rewrite in that many days". `logSince` is the oldest entry in the read
 * log. A note that is unused but not evidence-stale is archived only when the log covers the
 * whole window, because before that "nobody read it" may only mean "nobody was counting".
 * Evidence-stale notes are not counted against `max`.
 */
export function archivePlan(stale, index, { now = Date.now(), logSince = null, days = UNUSED_AGE_DAYS, max = UNUSED_MAX } = {}) {
  const out = [];
  for (const s of stale || []) {
    if (!s.evidence) continue;
    const reasons = s.reasons.filter((r) => !/^no read, verify or rewrite/.test(r));
    out.push({ key: s.key, reason: `curator: ${reasons.join('; ')}` });
  }
  const cutoff = now - days * DAY;
  const covered = Number.isFinite(logSince) && logSince <= cutoff;
  if (!covered) return { moves: out, unusedHeld: (stale || []).filter((s) => s.unused && !s.evidence).length };
  const unused = (stale || [])
    .filter((s) => s.unused && !s.evidence)
    .map((s) => ({ key: s.key, at: Date.parse(index?.[s.key]?.at || '') }))
    .filter((s) => Number.isFinite(s.at) && s.at <= cutoff)
    .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  for (const s of unused.slice(0, max)) {
    out.push({ key: s.key, reason: `curator: no read, verify or rewrite in ${days} days` });
  }
  return { moves: out, unusedHeld: Math.max(0, unused.length - max) };
}

/** The notes read `min` times or more that have no promotion bead yet, most-read first. */
export function promotionPlan(reads, index, { min = PROMOTE_READS, filed = [], max = PROMOTE_MAX } = {}) {
  const done = new Set(filed);
  return [...(reads || new Map())]
    .filter(([key, n]) => n >= min && key in (index || {}) && !done.has(key))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([key, reads]) => ({ key, reads }));
}

const stringify = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const clipText = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…[clipped: ${s.length - n} more characters]` : s);

/** The bead that asks for one note to become part of the repo. */
export function promotionBead({ agent, key, reads, entry, repo = '' }) {
  const claim = clipText(stringify(entry?.value ?? ''), 3000);
  const archive =
    agent === 'worker'
      ? `\`beadcause-memory note --archive=${key} --reason="promoted to <where>"\``
      : `archiving it (it is the ${agent} agent's note, so its own session does that with \`note --archive\`)`;
  return {
    title: `Move the ${agent} note ${key} into the repo (read ${reads} times)`,
    type: 'task',
    priority: 3,
    complexity: 'medium',
    labels: [PROMOTE_LABEL],
    description: [
      `The ${agent} agent's note \`${key}\`${repo ? ` in ${repo}` : ''} has been read ${reads} times. A note read that often is a rule that every session has to rediscover. Put the rule where nobody can miss it: a test that fails when it is broken, a lint, or a README section. Then retire the note by ${archive}.`,
      '',
      'If none of those fits, because the rule cannot be checked and does not belong in the README, say so on this bead and close it. The note stays.',
      '',
      '## The note',
      '',
      claim,
      ...(entry?.evidence ? ['', `Evidence: ${stringify(entry.evidence)}`] : []),
    ].join('\n'),
    acceptance: `The rule in \`${key}\` is enforced by a test or lint, or written in the README, and the note is archived. Or the bead says why it should stay a note.`,
    rationale: `Filed by the weekly memory curator (lib/curator.js, bc-u1ltu.5): ${reads} reads is past the promotion threshold of ${PROMOTE_READS}.`,
  };
}

/* ------------------------------------------------------------------ the model's half */

export const PROTOCOL = `## How to answer

End your answer with exactly one fenced block whose info string is \`curate\`, holding YAML:

\`\`\`curate
ops:
  - replaces: [key-one, key-two, key-three]
    notes:
      - key: the-new-key
        kind: gotcha            # one of ${NOTE_KINDS.join(', ')}
        scope: [lib/foo.js]     # optional: path globs the claim is about
        evidence: how this is known, carried from the notes it replaces
        value: |
          The claim, in plain prose.
\`\`\`

Rules the daemon enforces, and refuses an op for breaking:

- \`replaces\` names only keys you were given, all from one task, and no key twice across ops.
- Each new note's \`value\` is under ${NOTE_MAX_BYTES} bytes (aim for ${NOTE_AIM_BYTES}) and has non-empty \`evidence\`.
- A merge must leave fewer notes than it replaces.
- A new key must not be the key of a note you were not asked to replace.

If a task's notes are genuinely different claims, leave them alone and write no op for them.
An empty \`ops: []\` is a correct answer.`;

/** What the model is asked. `tasks` is `[{ id, kind: 'merge'|'split', agent, notes: { key: entry } }]`. */
export function curatePrompt(tasks, { repo = '' } = {}) {
  const parts = [
    `You are curating the notes agents keep about the ${repo || 'this'} repo. A note is one claim, kept short, with evidence. These notes break that rule, and your job is to rewrite them so they keep it, without losing anything still true.`,
    '',
    '- **merge** tasks: notes whose keys share a prefix. Many say the same thing, correct each other ("this note used to say…") or are SUPERSEDED. Fold each claim that still holds into one note, keeping the newest version of a corrected claim. Several related but distinct claims can become several notes. Keys that are genuinely unrelated can be left out of `replaces`.',
    '- **split** tasks: one note over the cap. Cut it into notes that each make one claim, or condense it to the claim if most of it is narrative. A body marked `[clipped]` is longer than what you see; keep only claims you can see.',
    '',
    'Carry the evidence across: when you merge, the new note\'s evidence names what the old notes cited. Do not invent evidence.',
    '',
  ];
  for (const t of tasks) {
    parts.push(`### Task ${t.id}: ${t.kind} (${t.agent})`, '');
    for (const [key, entry] of Object.entries(t.notes)) {
      const meta = [entry?.at && `written ${entry.at}`, entry?.kind && `kind ${entry.kind}`, entry?.evidence && `evidence: ${clipText(stringify(entry.evidence), 400)}`]
        .filter(Boolean)
        .join(' · ');
      parts.push(`#### ${key}`, meta ? `_${meta}_` : '', '', clipText(stringify(entry?.value ?? ''), BODY_MAX), '');
    }
  }
  return parts.join('\n');
}

const BLOCK_RE = /(^|\n)(?:```|~~~)[ \t]*curate[ \t]*\r?\n([\s\S]*?)(?<=^|\n)(?:```|~~~)[ \t]*(?=\r?\n|$)/;

/** The `curate` block, parsed. Never throws. */
export function extractCuration(text) {
  const m = BLOCK_RE.exec(String(text || ''));
  if (!m) return { ops: [], error: 'the agent wrote no `curate` block' };
  let doc;
  try {
    doc = YAML.parse(m[2]);
  } catch (err) {
    return { ops: [], error: `the \`curate\` block is not YAML — ${String(err.message).split('\n')[0]}` };
  }
  if (doc === null || doc === undefined || doc.ops === null || doc.ops === undefined) return { ops: [], error: null };
  if (!Array.isArray(doc.ops)) return { ops: [], error: '`ops` is not a list' };
  return { ops: doc.ops.filter((o) => o && typeof o === 'object'), error: null };
}

/**
 * The ops that may be applied, each tied to the task it came from, and a reason for every
 * one that may not. `live` is every live key per agent, `{ agent: Set }`.
 */
export function checkCuration(ops, tasks, live) {
  const byKey = new Map();
  for (const t of tasks) for (const k of Object.keys(t.notes)) byKey.set(`${t.agent}\u0000${k}`, t);
  const taken = new Set();
  const minted = new Set();
  const good = [];
  const dropped = [];
  for (const [i, op] of ops.entries()) {
    const label = `op ${i + 1}`;
    const replaces = Array.isArray(op.replaces) ? [...new Set(op.replaces.map(String))] : [];
    const notes = Array.isArray(op.notes) ? op.notes.filter((n) => n && typeof n === 'object') : [];
    if (!replaces.length || !notes.length) {
      dropped.push(`${label}: needs both \`replaces\` and \`notes\``);
      continue;
    }
    const owners = new Set(
      replaces.map((k) => {
        for (const t of tasks) if (k in t.notes) return t;
        return null;
      })
    );
    const task = owners.size === 1 ? [...owners][0] : null;
    if (!task) {
      dropped.push(`${label}: \`replaces\` names keys from no task, or from more than one`);
      continue;
    }
    if (replaces.some((k) => taken.has(`${task.agent}\u0000${k}`))) {
      dropped.push(`${label}: replaces a key another op already replaced`);
      continue;
    }
    if (task.kind === 'merge' && notes.length >= replaces.length) {
      dropped.push(`${label}: a merge of ${replaces.length} into ${notes.length} is not a merge`);
      continue;
    }
    const add = {};
    let problem = null;
    for (const n of notes) {
      const key = String(n.key ?? '');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key) || key.includes('..')) {
        problem = `"${key}" is not a key`;
        break;
      }
      if (key in add || minted.has(`${task.agent}\u0000${key}`)) {
        problem = `${key} is written twice`;
        break;
      }
      if (live[task.agent]?.has(key) && !replaces.includes(key)) {
        problem = `${key} is already a note and is not being replaced`;
        break;
      }
      try {
        checkNote(n.value, { evidence: n.evidence, kind: n.kind, scope: n.scope, tags: n.tags });
      } catch (err) {
        problem = `${key}: ${String(err.message).split(' — ')[0]}`;
        break;
      }
      add[key] = { value: n.value, evidence: n.evidence, kind: n.kind, scope: n.scope, tags: n.tags, from: replaces };
    }
    if (problem) {
      dropped.push(`${label}: ${problem}`);
      continue;
    }
    for (const k of replaces) taken.add(`${task.agent}\u0000${k}`);
    for (const k of Object.keys(add)) minted.add(`${task.agent}\u0000${k}`);
    good.push({ task: task.id, kind: task.kind, agent: task.agent, remove: replaces, add });
  }
  return { good, dropped };
}

/* ------------------------------------------------------------------ the ledger */

const emptyLedger = () => ({ version: 1, runs: 0, at: null, promoted: {}, looked: {} });

/** The ledger as it stands, or the empty one. */
export async function readLedger(dir) {
  const main = await ok(mainCheckout(dir));
  if (!main) return emptyLedger();
  const raw = await readRefFile(main, CURATOR_REF, 'state.json');
  if (!raw) return emptyLedger();
  try {
    const s = JSON.parse(raw);
    return {
      ...emptyLedger(),
      ...s,
      promoted: s.promoted && typeof s.promoted === 'object' ? s.promoted : {},
      looked: s.looked && typeof s.looked === 'object' ? s.looked : {},
    };
  } catch {
    // An unreadable state would re-file promotions. Treating it as "a run just happened"
    // costs a week. Treating it as empty costs duplicate beads, so wait the week.
    return { ...emptyLedger(), at: new Date().toISOString() };
  }
}

/** Append one run. `state.json` is cumulative, `run.json` is this run alone. */
export async function writeRun(dir, run, prev) {
  const main = await ok(mainCheckout(dir));
  if (!main) return null;
  const promoted = { ...prev.promoted };
  for (const p of run.promoted) promoted[`${p.agent}/${p.key}`] = p.bead;
  const cutoff = Date.parse(run.at) - LOOK_AGAIN_DAYS * DAY;
  const looked = Object.fromEntries(Object.entries(prev.looked).filter(([, at]) => Date.parse(at) >= cutoff));
  for (const id of run.looked) looked[id] = run.at;
  const state = { version: 1, runs: (prev.runs || 0) + 1, at: run.at, promoted, looked };
  const tree = await writeTree(main, [
    ['run.json', Buffer.from(JSON.stringify(run, null, 2) + '\n')],
    ['state.json', Buffer.from(JSON.stringify(state, null, 2) + '\n')],
  ]);
  const subject =
    `curate · ${run.archived.length} archived · ${run.applied.length} merged/split · ${run.promoted.length} promotion bead(s)` +
    (run.error ? ' · error' : '');
  const body = [
    subject,
    '',
    ...run.archived.map((a) => `archived ${a.agent}.${a.key}`),
    ...run.applied.map((a) => `${a.kind} ${a.agent}: ${a.remove.join(', ')} → ${Object.keys(a.add).join(', ')} (${a.commit.slice(0, 12)})`),
    ...run.promoted.map((p) => `promote ${p.agent}.${p.key} → ${p.bead}`),
    ...run.dropped.map((d) => `dropped ${d}`),
    ...(run.error ? ['', `error: ${run.error}`] : []),
  ].join('\n');
  const { commit } = await commitToRef(main, CURATOR_REF, tree, body);
  return { commit, state };
}

/* ------------------------------------------------------------------ the curator */

/** One headless run. Its final message, as a string. */
export async function runAgent({ dir, prompt, cfg = null, key = null, meta = {}, timeoutMs = TIMEOUT_MS }) {
  return runHeadless({ dir, prompt, systemText: PROTOCOL, timeoutMs, cfg, key, meta, tmpPrefix: 'beadcause-curate' });
}

/** What the config says. */
export function options(cfg) {
  const a = cfg?.advocates || {};
  const n = Number(a.memoryCuratorDays);
  return {
    enabled: a.memoryCurator !== false,
    everyMs: (Number.isFinite(n) ? Math.min(90, Math.max(1, Math.round(n))) : 7) * DAY,
  };
}

/** When the read log starts, in ms, or null when there is no log. */
export function readLogStart(log = readLog({ limit: 1 << 30 })) {
  const t = Date.parse(log[0]?.at || '');
  return Number.isFinite(t) ? t : null;
}

/**
 * The curator. `curate(dir, workspace)` runs one checkout, start to finish, and never
 * throws. `sweep()` is the poll cycle's call: every checkout of every workspace, each
 * asked whether its week is up. One run at a time across the whole daemon.
 *
 * `dryRun` plans everything and writes nothing: no archive, no agent, no bead, no ledger.
 * scripts/memory-curate.mjs is that, for a person who wants to see what next week does.
 */
export function createCurator({
  cfg = {},
  bd = null,
  run = runAgent,
  file = fileBeadsDefault,
  now = () => Date.now(),
  logStart = () => readLogStart(),
  onSettled = null,
  log = console.log,
  warn = console.error,
} = {}) {
  let running = false;

  async function curate(dir, workspace, { force = false, dryRun = false } = {}) {
    const ws = workspace?.name || String(workspace || '');
    const at = new Date(now()).toISOString();
    const out = { dir: dir || null, workspace: ws, ran: false, why: '', at, archived: [], unusedHeld: 0, applied: [], promoted: [], looked: [], dropped: [], plan: null, error: null };
    if (!dir) return { ...out, why: 'no checkout to curate' };
    if (running) return { ...out, why: 'a curation is already running' };
    running = true;
    try {
      const o = options(cfg);
      if (!o.enabled && !force && !dryRun) return { ...out, why: 'the memory curator is switched off' };
      const ledger = await readLedger(dir);
      const last = Date.parse(ledger.at || '');
      if (!force && !dryRun && Number.isFinite(last) && now() - last < o.everyMs) {
        return { ...out, why: `the last curation was ${Math.round((now() - last) / DAY)} day(s) ago` };
      }
      const repo = await mainCheckout(dir);
      const agents = await noteAgents(repo);
      if (!agents.length) return { ...out, why: 'no agent keeps notes in this checkout' };
      const since = logStart();
      const lookedRecently = (id) => Date.parse(ledger.looked[id] || '') >= now() - LOOK_AGAIN_DAYS * DAY;

      // 1. Archive, so nothing below merges or promotes a note the evidence has retired.
      let unusedBudget = UNUSED_MAX;
      const plan = { archive: [], promote: [], merge: [], split: [] };
      for (const agent of agents) {
        const { index } = await notesStore(repo, agent);
        const stale = await staleNotes(repo, agent, { now: now(), days: UNUSED_AGE_DAYS });
        const { moves, unusedHeld } = archivePlan(stale, index, { now: now(), logSince: since, max: unusedBudget });
        unusedBudget -= moves.filter((m) => /no read, verify/.test(m.reason)).length;
        out.unusedHeld += unusedHeld;
        if (moves.length) plan.archive.push({ agent, moves });
      }
      if (!dryRun) {
        for (const { agent, moves } of plan.archive) {
          const r = await archiveNotes(repo, agent, moves);
          for (const key of r.archived) out.archived.push({ agent, key, reason: moves.find((m) => m.key === key)?.reason || '' });
        }
      }

      // 2. Promotions, and 3. the model's tasks, from the store as it now stands.
      // Candidates from every agent first, ranked together, so the caps go to the most-read
      // notes and the largest clusters rather than to whichever agent sorts first.
      const live = {};
      const promoted = new Set(Object.keys(ledger.promoted));
      const promote = [];
      const merge = [];
      const split = [];
      for (const agent of agents) {
        const { index, bodies } = await notesStore(repo, agent);
        const gone = dryRun ? new Set((plan.archive.find((p) => p.agent === agent)?.moves || []).map((m) => m.key)) : new Set();
        for (const k of gone) delete index[k];
        live[agent] = new Set(Object.keys(index));
        const reads = noteReads(repo, agent, { days: 3650, now: now() });
        const filed = [...promoted].filter((id) => id.startsWith(`${agent}/`)).map((id) => id.slice(agent.length + 1));
        for (const p of promotionPlan(reads, index, { filed, max: Infinity })) promote.push({ agent, ...p, entry: bodies[p.key] });
        for (const c of prefixClusters(index)) {
          const id = `merge:${agent}/${c.prefix}`;
          if (!lookedRecently(id)) merge.push({ id, kind: 'merge', agent, notes: Object.fromEntries(c.keys.map((k) => [k, bodies[k]])) });
        }
        for (const s of oversizedNotes(index)) {
          const id = `split:${agent}/${s.key}`;
          if (!lookedRecently(id)) split.push({ id, kind: 'split', agent, bytes: s.bytes, notes: { [s.key]: bodies[s.key] } });
        }
      }
      const size = (t) => Object.keys(t.notes).length;
      plan.promote = promote.sort((a, b) => b.reads - a.reads || a.key.localeCompare(b.key)).slice(0, PROMOTE_MAX);
      plan.merge = merge.sort((a, b) => size(b) - size(a) || a.id.localeCompare(b.id)).slice(0, MERGE_MAX);
      plan.split = split.sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id)).slice(0, SPLIT_MAX);
      const tasks = [...plan.merge, ...plan.split];
      out.plan = {
        archive: plan.archive.flatMap((p) => p.moves.map((m) => ({ agent: p.agent, ...m }))),
        promote: plan.promote.map(({ agent, key, reads }) => ({ agent, key, reads })),
        merge: plan.merge.map((t) => ({ id: t.id, keys: Object.keys(t.notes) })),
        split: plan.split.map((t) => ({ id: t.id, keys: Object.keys(t.notes) })),
      };
      if (dryRun) return { ...out, why: 'dry run' };

      if (plan.promote.length && bd && workspace) {
        const beads = plan.promote.map((p) => promotionBead({ ...p, repo: repo.split('/').pop() }));
        const res = await file(bd, workspace, beads, {
          homeLabel: PROMOTE_LABEL,
          endorsed: autoEndorseAllowed(cfg, ws),
          onWarn: (m) => warn(`[curate] ${ws}: ${m}`),
        });
        const byTitle = new Map(beads.map((b, i) => [b.title, plan.promote[i]]));
        for (const row of res.filed) {
          const p = byTitle.get(row.title);
          if (p) out.promoted.push({ agent: p.agent, key: p.key, reads: p.reads, bead: row.id });
        }
        for (const f of res.failed) out.dropped.push(`could not file "${f.title}" — ${f.error}`);
      } else if (plan.promote.length) {
        out.dropped.push(`${plan.promote.length} promotion(s) found with no tracker to file them into`);
      }

      if (tasks.length) {
        out.looked = tasks.map((t) => t.id);
        let answer = '';
        try {
          answer = await run({
            dir: repo,
            prompt: curatePrompt(tasks, { repo: repo.split('/').pop() }),
            cfg,
            key: `${ws}/curate-${repo.split('/').pop()}`,
            meta: { workspace: ws, bead: null, agent: 'memory-curator', endorsed: true, endorsementNote: 'the curator tidies agent notes, not work opened on a bead' },
          });
        } catch (err) {
          out.error = String(err?.message || err).split('\n')[0];
        }
        if (!out.error) {
          const { ops, error } = extractCuration(answer);
          out.error = error;
          const { good, dropped } = checkCuration(ops, tasks, live);
          out.dropped.push(...dropped);
          for (const op of good) {
            try {
              const r = await replaceNotes(repo, op.agent, {
                remove: op.remove,
                add: op.add,
                message: `curate ${op.agent}: ${op.kind} ${op.remove.join(', ').slice(0, 60)} → ${Object.keys(op.add).join(', ').slice(0, 60)}`,
              });
              out.applied.push({ ...op, commit: r.commit });
            } catch (err) {
              out.dropped.push(`${op.task}: ${String(err?.message || err).split('\n')[0]}`);
            }
          }
        }
      }

      out.ran = true;
      try {
        const written = await writeRun(dir, out, ledger);
        if (written) out.record = written.commit;
      } catch (err) {
        out.error = `${out.error ? `${out.error}; ` : ''}the run could not be recorded — ${String(err?.message || err).split('\n')[0]}`;
      }
      log(
        `[curate] ${ws}: ${out.archived.length} archived, ${out.applied.length} merged/split, ${out.promoted.length} promotion bead(s)` +
          (out.error ? ` (${out.error})` : '')
      );
      return out;
    } catch (err) {
      out.error = String(err?.message || err).split('\n')[0];
      warn(`[curate] ${ws}: the curation failed — ${out.error}`);
      return out;
    } finally {
      running = false;
      if (out.ran && onSettled) {
        try {
          onSettled(out);
        } catch (err) {
          warn(`[curate] the settle callback threw — ${String(err?.message || err).split('\n')[0]}`);
        }
      }
    }
  }

  /**
   * The poll cycle's look. Never awaited past the dispatch: a run that starts is a
   * `claude -p` that can take `TIMEOUT_MS`. `running` is checked before the first `await`
   * in `curate`, so every checkout's call but the first is a cheap refusal. A checkout
   * whose week is not up costs one `cat-file`.
   */
  let sweptAt = 0;
  function sweep() {
    if (!options(cfg).enabled || running) return;
    if (now() - sweptAt < 60 * 60 * 1000) return;
    sweptAt = now();
    for (const ws of cfg.workspaces || []) {
      for (const unit of repoUnits(cfg, ws.name)) {
        let dir = null;
        try {
          dir = unit.repo ? unit.repo.dir : resolveSessionDir(cfg, ws);
        } catch {
          continue;
        }
        if (!dir) continue;
        curate(dir, ws).catch((err) => warn(`[curate] the curation failed — ${String(err?.message || err).split('\n')[0]}`));
      }
    }
  }

  return { curate, sweep, running: () => running };
}
