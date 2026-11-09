/**
 * Where the tokens go — every Claude Code transcript on this Mac, sorted by the kind of
 * session that opened it and added up (bc-bdjbs).
 *
 * Adam, 2026-11-07: "i wonder if the advocate is being visited too often? can i get some
 * metrics on how many tokens are used by each session, whether advocate first visit or
 * subsequent, merge conflict resolution, merge advocate, workers, etc etc? i'd like
 * aggregate metrics as well as on a per-effort basis". Nothing in beadcause recorded spend
 * per session kind, and the status line's per-turn delta is per *window*, not per kind.
 *
 * **The kind comes off the brief's first line and nothing else.** Every session the daemon
 * opens starts with a sentence only that kind of brief says — lib/claude.js `isWorkerLine`
 * relies on exactly this for the worker census — so the first human-authored user message
 * of a transcript is enough to tell an Epic Advocate from a worker from a conflict
 * resolver. Anything no pattern matches is `manual`: a window somebody opened by hand, or
 * a handoff continuing one (`handoff`, split out because those are agent-written briefs a
 * person chose to run, and they are big).
 *
 * **Usage is deduplicated by message id.** One API response is written as several
 * transcript lines (one per content block), each carrying the same `usage`; summing lines
 * counts a response two or three times. Subagent transcripts under
 * `<session>/subagents/*.jsonl` are added to their parent — they are on the bill, and a
 * session that fans out should be charged for it.
 *
 * **Raw tokens mislead, so a weighted figure sits beside them.** About 95% of the raw count
 * is cache reads, which bill at a tenth of fresh input. `weighted` is the count in
 * input-token equivalents — cache read 0.1, cache write 1.25, output 5 — the ratios the API
 * prices at, so it ranks kinds by cost without claiming a dollar figure for a model whose
 * price this file does not know.
 *
 * Everything here is pure except `scanTranscripts`, which reads files and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The order matters only where two patterns could both match; none currently do. */
export const KINDS = [
  ['epic-advocate', /^You are the Epic Advocate for \*\*([\w.-]+)\*\* in `([^`]+)`/, (m) => ({ bead: m[1], ws: m[2] })],
  ['epic-worker', /^You are the \*\*epic worker\*\* for \*\*([^/*]+)\/([\w.-]+)\*\*/, (m) => ({ ws: m[1], bead: m[2] })],
  ['worker', /^You are working (?:bead|epic) \*\*([^/*]+)\/([\w.-]+)\*\*/, (m) => ({ ws: m[1], bead: m[2] })],
  ['conflict-resolve', /^Get \*\*#(\d+)\*\* mergeable again in `([^`]+)`/, (m) => ({ pr: Number(m[1]), ws: m[2].split('/').pop() })],
  ['merge-advocate', /^You are the MergeAdvocate for \*\*([\w.-]+)\*\* in `([^`]+)`/, (m) => ({ bead: m[1], ws: m[2] })],
  ['review-advocate', /^You are the ReviewAdvocate for \*\*([\w.-]+)\*\* in `([^`]+)`/, (m) => ({ bead: m[1], ws: m[2] })],
  ['review-answer', /^You are the worker for \*\*([\w.-]+)\*\* in `([^`]+)`/, (m) => ({ bead: m[1], ws: m[2] })],
  ['filing-gate', /^You are deciding whether a bead a worker is about to file/, () => ({})],
  ['session-audit', /^# Audit \d+ finished session\(s\) in (\S+)/, (m) => ({ ws: m[1] })],
  ['handoff', /^Read handoff \*{0,2}(?:([^/*\s]+)\/)?([\w-]+(?:\.[\w-]+)*)/, (m) => ({ ws: m[1] || null, bead: m[2] })],
];

export const KIND_NAMES = [...KINDS.map(([k]) => k), 'manual'];

/** Cost ratios relative to one fresh input token. */
export const WEIGHTS = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };

export const rawOf = (r) => r.input + r.cacheWrite + r.cacheRead + r.output;
export const weightedOf = (r) =>
  r.input * WEIGHTS.input + r.cacheWrite * WEIGHTS.cacheWrite + r.cacheRead * WEIGHTS.cacheRead + r.output * WEIGHTS.output;

/** `{kind, ws, bead, pr}` from a brief's first message. */
export function classify(first) {
  const text = String(first || '');
  for (const [kind, re, pick] of KINDS) {
    const m = text.match(re);
    if (m) return { kind, ws: null, bead: null, pr: null, ...pick(m) };
  }
  return { kind: 'manual', ws: null, bead: null, pr: null };
}

/** The effort a bead belongs to: its root epic, `dv-k4n.149.2` → `dv-k4n`. */
export const rootOf = (bead) => (bead ? String(bead).split('.')[0] : null);

/**
 * A conflict brief names the PR, not the bead; the PR's title usually leads with the bead
 * (`— bc-khoe.30.18: B7e-lint …`). Only that position is read — a bead id quoted further
 * into the title is something the PR talks about, not what it is.
 */
export function beadInConflictTitle(first) {
  const m = String(first || '').match(/^Get \*\*#\d+\*\* mergeable again in `[^`]+` — ([a-z][a-z0-9]{0,5}-[a-z0-9]{3,6}(?:\.\d+)*)\b/);
  return m ? m[1] : null;
}

/** The text of a user message, or null when it is a tool result or carries no text. */
function userText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  if (content.some((x) => x && x.type === 'tool_result')) return null;
  const t = content.filter((x) => x && x.type === 'text').map((x) => x.text || '').join(' ');
  return t || null;
}

/**
 * Sums one transcript's text. `seen` is shared across a session and its subagents so a
 * response copied into both is counted once.
 */
export function readTranscript(text, seen = new Set()) {
  const out = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, calls: 0, first: null, start: null, end: null, models: {} };
  for (const line of String(text).split('\n')) {
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // a torn last line from a session still writing
    }
    if (d.timestamp) {
      out.start = out.start || d.timestamp;
      out.end = d.timestamp;
    }
    if (d.type === 'user' && !d.isMeta && out.first === null) {
      // `<command-name>`, `<system-reminder>`, `<local-command…>`: the harness's, not a brief.
      const t = userText(d.message && d.message.content);
      if (t && !t.startsWith('<')) out.first = t;
    }
    if (d.type !== 'assistant') continue;
    const m = d.message || {};
    const u = m.usage;
    if (!u) continue;
    const key = `${m.id || ''}|${d.requestId || ''}`;
    if (key !== '|' && seen.has(key)) continue;
    seen.add(key);
    out.input += u.input_tokens || 0;
    out.cacheWrite += u.cache_creation_input_tokens || 0;
    out.cacheRead += u.cache_read_input_tokens || 0;
    out.output += u.output_tokens || 0;
    out.calls += 1;
    if (m.model) out.models[m.model] = (out.models[m.model] || 0) + 1;
  }
  return out;
}

/**
 * One row per session under `roots`, whose first line is on or after `sinceMs`. A
 * transcript last written before `sinceMs` cannot qualify, so it is skipped on its mtime
 * without being read — most of a month's history on a full disk.
 */
export function scanTranscripts(roots, { sinceMs = 0 } = {}) {
  const rows = [];
  const done = new Set();
  for (const root of roots) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const dir of dirs) {
      const full = path.join(root, dir);
      let files = [];
      try {
        files = fs.readdirSync(full).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      for (const f of files) {
        const sid = f.slice(0, -6);
        if (done.has(sid)) continue;
        done.add(sid);
        const file = path.join(full, f);
        let stat;
        try {
          stat = fs.statSync(file);
        } catch {
          continue;
        }
        if (stat.mtimeMs < sinceMs) continue;
        const seen = new Set();
        const main = readTranscript(fs.readFileSync(file, 'utf8'), seen);
        if (!main.start || Date.parse(main.start) < sinceMs) continue;
        const subDir = path.join(full, sid, 'subagents');
        let subs = [];
        try {
          subs = fs.readdirSync(subDir).filter((s) => s.endsWith('.jsonl'));
        } catch {
          /* no subagents */
        }
        const total = { ...main };
        for (const s of subs) {
          const t = readTranscript(fs.readFileSync(path.join(subDir, s), 'utf8'), seen);
          for (const k of ['input', 'cacheWrite', 'cacheRead', 'output', 'calls']) total[k] += t[k];
          for (const [mod, n] of Object.entries(t.models)) total.models[mod] = (total.models[mod] || 0) + n;
        }
        const c = classify(main.first);
        const bead = c.kind === 'conflict-resolve' ? beadInConflictTitle(main.first) : c.bead;
        const model = Object.entries(total.models).sort((a, b) => b[1] - a[1])[0];
        rows.push({
          sessionId: sid,
          project: dir,
          kind: c.kind,
          ws: c.ws,
          bead,
          pr: c.pr,
          root: rootOf(bead),
          start: main.start,
          end: main.end,
          subagents: subs.length,
          model: model ? model[0] : null,
          input: total.input,
          cacheWrite: total.cacheWrite,
          cacheRead: total.cacheRead,
          output: total.output,
          calls: total.calls,
          first: (main.first || '').slice(0, 160),
        });
      }
    }
  }
  return rows.sort((a, b) => (a.start < b.start ? -1 : 1));
}

const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(p * (s.length - 1))];
};

function totals(rows) {
  return {
    sessions: rows.length,
    raw: sum(rows, rawOf),
    weighted: sum(rows, weightedOf),
    cacheRead: sum(rows, (r) => r.cacheRead),
    cacheWrite: sum(rows, (r) => r.cacheWrite),
    input: sum(rows, (r) => r.input),
    output: sum(rows, (r) => r.output),
    calls: sum(rows, (r) => r.calls),
    medianWeighted: median(rows.map(weightedOf)),
    p90Weighted: pct(rows.map(weightedOf), 0.9),
  };
}

const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

/**
 * Everything the command prints, as data. Rows are expected in start order (as
 * `scanTranscripts` returns them) — "first visit" is the earliest Epic Advocate session *in
 * the rows given*, which on a pruned transcript store is the earliest one still on disk.
 */
export function summarize(rows) {
  const all = totals(rows);
  const byKind = [...groupBy(rows, (r) => r.kind)]
    .map(([kind, rs]) => ({ kind, ...totals(rs), share: all.weighted ? totals(rs).weighted / all.weighted : 0 }))
    .sort((a, b) => b.weighted - a.weighted);

  // Epic Advocate: first visit vs repeat, and how often each epic is visited.
  const adv = rows.filter((r) => r.kind === 'epic-advocate');
  const visited = new Set();
  const firstVisits = [];
  const repeatVisits = [];
  for (const r of adv) {
    (visited.has(r.bead) ? repeatVisits : firstVisits).push(r);
    visited.add(r.bead);
  }
  const epics = [...groupBy(adv, (r) => r.bead)]
    .map(([bead, rs]) => {
      const ts = rs.map((r) => Date.parse(r.start));
      const gaps = ts.slice(1).map((t, i) => (t - ts[i]) / 60000);
      const days = Math.max(1, (ts[ts.length - 1] - ts[0]) / 86400000);
      return {
        bead,
        ws: rs[0].ws,
        visits: rs.length,
        perDay: rs.length / days,
        medianGapMin: median(gaps),
        minGapMin: gaps.length ? Math.min(...gaps) : null,
        weighted: sum(rs, weightedOf),
        raw: sum(rs, rawOf),
      };
    })
    .sort((a, b) => b.visits - a.visits);

  // Conflict resolution: how many times each PR was resolved.
  const prs = [...groupBy(rows.filter((r) => r.kind === 'conflict-resolve'), (r) => `${r.ws}#${r.pr}`)]
    .map(([key, rs]) => ({
      ws: rs[0].ws,
      pr: rs[0].pr,
      bead: rs[0].bead,
      sessions: rs.length,
      weighted: sum(rs, weightedOf),
      raw: sum(rs, rawOf),
      title: rs[0].first.replace(/^Get \*\*#\d+\*\* mergeable again in `[^`]+` — /, '').split('\n')[0].slice(0, 70),
    }))
    .sort((a, b) => b.sessions - a.sessions || b.weighted - a.weighted);

  // Per effort: every session tied to a root bead, split by kind.
  const efforts = [...groupBy(rows.filter((r) => r.kind !== 'filing-gate'), (r) => r.root)]
    .map(([root, rs]) => {
      const kinds = {};
      for (const [k, ks] of groupBy(rs, (r) => r.kind)) kinds[k] = { sessions: ks.length, weighted: sum(ks, weightedOf), raw: sum(ks, rawOf) };
      const w = sum(rs, weightedOf);
      return { root, sessions: rs.length, weighted: w, raw: sum(rs, rawOf), kinds, advocateShare: w ? (kinds['epic-advocate']?.weighted || 0) / w : 0 };
    })
    .sort((a, b) => b.weighted - a.weighted);

  return {
    from: rows.length ? rows[0].start : null,
    to: rows.length ? rows[rows.length - 1].start : null,
    all,
    byKind,
    advocate: { first: totals(firstVisits), repeat: totals(repeatVisits), epics },
    conflicts: {
      sessions: sum(prs, (p) => p.sessions),
      prs: prs.length,
      repeated: prs.filter((p) => p.sessions > 1).length,
      over5: prs.filter((p) => p.sessions > 5).length,
      repeatWeighted: sum(prs, (p) => (p.sessions > 1 ? p.weighted * (1 - 1 / p.sessions) : 0)),
      byPr: prs,
    },
    efforts,
  };
}

/** `12.3M`, `450k`, `87`. */
export function fmt(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n));
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

/** The human-readable report. `top` caps the per-epic and per-PR tables. */
export function render(s, { top = 15 } = {}) {
  const out = [];
  if (!s.all.sessions) return 'no transcripts in that window';
  out.push(`${s.all.sessions} sessions, ${s.from.slice(0, 10)} → ${s.to.slice(0, 10)}`);
  out.push(`raw ${fmt(s.all.raw)} tokens · weighted ${fmt(s.all.weighted)} (input-equivalent: cache read ×0.1, cache write ×1.25, output ×5)`);
  out.push('');
  out.push(pad('kind', 18) + lpad('sessions', 9) + lpad('raw', 9) + lpad('weighted', 10) + lpad('share', 7) + lpad('per sess', 10) + lpad('median', 9) + lpad('p90', 9) + lpad('calls/s', 9));
  for (const k of s.byKind) {
    out.push(
      pad(k.kind, 18) +
        lpad(k.sessions, 9) +
        lpad(fmt(k.raw), 9) +
        lpad(fmt(k.weighted), 10) +
        lpad(`${(100 * k.share).toFixed(1)}%`, 7) +
        lpad(fmt(k.weighted / k.sessions), 10) +
        lpad(fmt(k.medianWeighted), 9) +
        lpad(fmt(k.p90Weighted), 9) +
        lpad(Math.round(k.calls / k.sessions), 9)
    );
  }

  const a = s.advocate;
  if (a.first.sessions + a.repeat.sessions) {
    out.push('', 'Epic Advocate visits (weighted)');
    out.push(`  first visit   ${lpad(a.first.sessions, 4)} sessions  ${lpad(fmt(a.first.weighted), 7)}  median ${fmt(a.first.medianWeighted)}`);
    out.push(`  repeat visit  ${lpad(a.repeat.sessions, 4)} sessions  ${lpad(fmt(a.repeat.weighted), 7)}  median ${fmt(a.repeat.medianWeighted)}`);
    out.push('  ("first" = first one still on disk; Claude Code prunes transcripts after ~30 days)');
    out.push('  ' + pad('epic', 13) + lpad('visits', 7) + lpad('/day', 6) + lpad('median gap', 12) + lpad('min gap', 9) + lpad('weighted', 10));
    for (const e of a.epics.slice(0, top)) {
      const g = (m) => (m == null ? '-' : m >= 120 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);
      out.push('  ' + pad(e.bead, 13) + lpad(e.visits, 7) + lpad(e.perDay.toFixed(1), 6) + lpad(g(e.medianGapMin), 12) + lpad(g(e.minGapMin), 9) + lpad(fmt(e.weighted), 10));
    }
  }

  const c = s.conflicts;
  if (c.sessions) {
    out.push('', `Conflict resolution: ${c.sessions} sessions over ${c.prs} PRs · ${c.repeated} PRs resolved more than once · ${c.over5} more than five times`);
    out.push(`  weighted spent on repeats (every session after a PR's first): ${fmt(c.repeatWeighted)}`);
    for (const p of c.byPr.slice(0, top)) {
      if (p.sessions < 2) break;
      out.push(`  ${pad(`${p.ws}#${p.pr}`, 16)}${lpad(p.sessions, 4)}×  ${lpad(fmt(p.weighted), 7)}  ${p.title}`);
    }
  }

  if (s.efforts.length) {
    const cols = ['epic-advocate', 'epic-worker', 'worker', 'conflict-resolve', 'merge-advocate', 'review-advocate', 'handoff'];
    const short = { 'epic-advocate': 'advocate', 'epic-worker': 'planner', worker: 'workers', 'conflict-resolve': 'conflicts', 'merge-advocate': 'merge', 'review-advocate': 'review', handoff: 'handoff' };
    out.push('', 'Per effort (root bead), weighted — sessions/tokens');
    out.push('  ' + pad('root', 12) + cols.map((k) => lpad(short[k], 13)).join('') + lpad('total', 9) + lpad('adv %', 7));
    for (const e of s.efforts.slice(0, top)) {
      const cell = (k) => (e.kinds[k] ? `${e.kinds[k].sessions}/${fmt(e.kinds[k].weighted)}` : '-');
      out.push('  ' + pad(e.root, 12) + cols.map((k) => lpad(cell(k), 13)).join('') + lpad(fmt(e.weighted), 9) + lpad(`${(100 * e.advocateShare).toFixed(1)}%`, 7));
    }
  }
  return out.join('\n');
}
