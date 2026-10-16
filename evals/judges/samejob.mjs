/**
 * Does `--json-schema` make the duplicate judge better, or only tidier? — bc-unwit.
 *
 * lib/samejob.js's judge used to answer in a fenced `samejob` block; bc-unwit gave it a
 * `--json-schema` whose `duplicate` is an enum of the shortlisted ids plus null. The first
 * live try of that (12 runs) said the schema found 3/4 real duplicates where the block found
 * 0/4 — and was worthless as evidence, for four reasons this file exists to remove:
 *
 * 1. **The judge could see the answer.** It had read-only `bd` and the checkout, and every
 *    covering bead in test/fixtures/samejob-pairs.json is closed or superseded on today's
 *    graph, with the fix already in the code. All four block "misses" said exactly that.
 *    Rewinding the graph is not available: `~/.zshenv` re-derives BEADS_DIR from `$PWD` in
 *    every zsh the judge's Bash opens, so an exported snapshot path lasts one command. So
 *    here the judge is **prompt-only** — every built-in tool off, `--tools ''`, which leaves
 *    `StructuredOutput` and nothing else (measured). It judges the shortlist it is shown,
 *    which is the part a change of answer format could possibly affect.
 * 2. **Four positives.** Here: every pair in the corpus the shortlist reaches (ten of
 *    twelve), and eight hard negatives — the same filing with its covering bead taken
 *    out, so what is left is the corpus's own same-area beads, the ones a judge is tempted
 *    by. `--live N` adds N more negatives shortlisted from the live graph; those are marked
 *    unverified, because the live graph may hold a duplicate nobody has found yet.
 * 3. **One run each.** The judge is not deterministic. `--reps` (default 3) per case per arm,
 *    and the report says how often a case's reps agreed.
 * 4. **Two changes tested as one.** Three arms, so the format and the enum separate:
 *
 *        fenced        the block, as it was
 *        schema-free   --json-schema, `duplicate` any string or null
 *        schema-enum   --json-schema, `duplicate` one of the shown ids or null (what ships)
 *
 * ## How it is scored, and why in this order
 *
 * lib/samejob.js's own asymmetry: a wrong name refuses a filing and throws away a discovery,
 * a wrong `none` costs one duplicate bead that gets tidied. So **wrong names** (a named bead
 * on a negative, or the wrong bead on a positive) come first, **found** second, and
 * **unparsed** (the answer had no readable verdict at all) third. `run()` fails when
 * schema-enum names wrongly more often than fenced, or finds fewer.
 *
 *     node evals/judges/samejob.mjs --pilot            # 3 cases x 3 arms x 1 rep, prints the cost
 *     node evals/judges/samejob.mjs                     # the whole study
 *     node evals/judges/samejob.mjs --reps 1 --live 10 --out /tmp/samejob.jsonl
 *
 * Every run is appended to `--out` as it finishes, so a study stopped halfway is not lost.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EvalFailure } from '../helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const { sameJob, shortlist, verdictDoc } = await import(path.join(ROOT, 'lib', 'samejob.js'));
const { default: YAML } = await import('yaml');
const { runHeadless } = await import(path.join(ROOT, 'lib', 'agentrun.js'));

export const meta = {
  tag: 'slow',
  title: 'the --json-schema duplicate judge names no more wrong beads than the fenced one, and finds as many',
  cost: 'default: 3 cases x 3 arms x 1 rep = 9 judge runs; the full study is ~180 — run it directly, see --pilot',
};

export const ARMS = ['fenced', 'schema-free', 'schema-enum'];

/** samejob's own TIMEOUT_MS plus a minute: past this the run is recorded as timed out. */
const RUN_DEADLINE_MS = 3 * 60 * 1000;

const BLOCK_RE = /```samejob\s*\n([\s\S]*?)```/;

const asRow = (b) => ({ id: b.id, title: b.title, status: 'open', labels: [], description: b.description || '' });

/* ------------------------------------------------------------------------- the cases */

/**
 * Positives and their hard negatives, from the corpus test/samejob.mjs already keeps.
 *
 * **`also`: the other right answers.** The corpus records one covering bead per filing, and
 * that is not always the only one. bc-beleq and bc-mrm77 are two auto-filed red-main cards
 * with the *same title*, "`main` is red in beadcause — the merge queue is holding", and the
 * first full study scored every arm, every rep, as naming the wrong bead on both of bc-beleq's
 * cases — for picking the byte-identical twin. A bead elsewhere in the corpus with the
 * filing's exact title is the one duplicate nobody can argue with, so naming it is correct
 * on the positive *and* on the negative, which only took the recorded cover out.
 */
export function corpusCases(pairs, dirs = [ROOT]) {
  const out = [];
  const norm = (s) => String(s || '').trim().toLowerCase();
  for (const { filed, covers } of pairs) {
    const others = pairs.flatMap((p) => [p.filed, p.covers]).filter((b) => b.id !== filed.id);
    const also = [...new Set(others.filter((b) => b.id !== covers.id && norm(b.title) === norm(filed.title)).map((b) => b.id))];
    const pos = others.map(asRow);
    if (!shortlist(filed, pos, { dirs }).some((r) => r.id === covers.id)) continue;
    out.push({ name: `${filed.id}+`, candidate: filed, rows: pos, want: covers.id, also, verified: true });
    const neg = others.filter((b) => b.id !== covers.id).map(asRow);
    if (shortlist(filed, neg, { dirs }).length) {
      out.push({ name: `${filed.id}-`, candidate: filed, rows: neg, want: null, also, verified: true });
    }
  }
  return out;
}

/**
 * One run's outcome against its case: the scoring, kept apart from the running so a study
 * already paid for can be scored again when the case definitions improve (`--rescore`).
 */
export function score(r, c) {
  const also = new Set(c?.also || []);
  const answered = !r.timedOut && !r.unparsed;
  const right = r.got === c.want || (r.got !== null && also.has(r.got));
  return {
    ...r,
    want: c.want,
    also: [...also],
    correct: answered && right,
    wrongName: r.got !== null && !right,
    found: c.want !== null && r.got !== null && right,
  };
}

/**
 * Negatives from the live graph: open beads, each judged against the rest.
 *
 * Every bead that has ever been involved in a `superseded-by:` is left out on both sides,
 * so a known pair can never be scored as a wrong name. Sorted by id rather than sampled, so
 * two runs on one day pick the same cases.
 */
export function liveCases(n, dirs = [ROOT]) {
  if (!n) return [];
  const raw = execFileSync('bd', ['list', '--status=open,in_progress,blocked', '--limit', '0', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const rows = JSON.parse(raw).filter((r) => !(r.labels || []).includes('human'));
  const tainted = new Set();
  for (const r of rows) {
    for (const l of r.labels || []) {
      if (l.startsWith('superseded-by:')) {
        tainted.add(r.id);
        tainted.add(l.slice('superseded-by:'.length));
      }
    }
  }
  const pool = rows.filter((r) => !tainted.has(r.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const out = [];
  for (const cand of pool) {
    if (out.length >= n) break;
    const rest = pool.filter((r) => r.id !== cand.id);
    if (!shortlist(cand, rest, { dirs }).length) continue;
    out.push({ name: `${cand.id}~`, candidate: cand, rows: rest, want: null, verified: false });
  }
  return out;
}

/* --------------------------------------------------------------------- one judge run */

/**
 * `runHeadless`'s spawn, with the judge's tools taken away and its bill read off the stream.
 *
 * Rewriting the command rather than adding a knob to lib/: the prompt-only judge is a
 * measuring instrument, not a mode production should grow. The rewrite is checked — a
 * command it could not rewrite is a throw, not a judge that quietly kept its tools.
 */
function tappedSpawn(tap) {
  return (cmd, args, opts) => {
    const command = String(args[1]);
    const stripped = command.includes('--tools ')
      ? command.replace(/--tools '[^']*'/, "--tools ''")
      : command.replace('--strict-mcp-config ', "--strict-mcp-config --tools '' ");
    if (!/--tools ''/.test(stripped)) throw new Error('evals/judges/samejob: could not take the tools away');
    const child = spawn(cmd, [args[0], stripped, ...args.slice(2)], opts);
    // The eval's own deadline. runHeadless's is the foundation's fifteen minutes, not
    // samejob's two (bc-fjcb7), and a run that hangs before its first response — seen in
    // the pilot — would otherwise hold a pool slot for all fifteen.
    const deadline = setTimeout(() => {
      tap.timedOut = true;
      child.kill('SIGTERM');
    }, RUN_DEADLINE_MS);
    child.on('close', () => clearTimeout(deadline));
    let pending = '';
    child.stdout.on('data', (chunk) => {
      pending += String(chunk);
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'result') {
            tap.cost = Number(ev.total_cost_usd ?? 0);
            tap.turns = ev.num_turns ?? null;
            tap.structured = ev.structured_output != null;
          }
        } catch {}
      }
    });
    return child;
  };
}

/**
 * Would the parser before bc-unwit have kept this verdict?
 *
 * It read the block with `YAML.parse` and nothing else, and a `why` with ": " in it throws
 * there — a silent `none`. Recorded so the fenced arm can be scored both ways: as it ran in
 * production until now, and with the line reader that replaced it.
 */
function yamlOnly(raw) {
  const m = BLOCK_RE.exec(String(raw || ''));
  if (!m) return false;
  try {
    const doc = YAML.parse(m[1]);
    return !!doc && typeof doc === 'object';
  } catch {
    return false;
  }
}

export async function judgeOnce(c, arm) {
  const tap = { cost: 0, turns: null, structured: false, timedOut: false };
  let raw = '';
  const warns = [];
  const t0 = Date.now();
  const verdict = await sameJob(c.candidate, c.rows, {
    dirs: [ROOT],
    dir: ROOT,
    structured: arm !== 'fenced',
    onWarn: (m) => warns.push(m),
    runImpl: async (opts) => {
      const o = { ...opts, spawnImpl: tappedSpawn(tap) };
      if (arm === 'schema-free') {
        o.jsonSchema = {
          ...opts.jsonSchema,
          properties: { ...opts.jsonSchema.properties, duplicate: { type: ['string', 'null'], description: opts.jsonSchema.properties.duplicate.description } },
        };
      }
      raw = await runHeadless(o);
      return raw;
    },
  });
  // A run the deadline killed answered nothing, whatever `none` it defaulted to — so it is
  // never correct, even on a negative where `none` is the right answer.
  const got = tap.timedOut ? null : verdict.duplicate;
  const answered = !tap.timedOut && verdictDoc(raw) !== null;
  return score({
    case: c.name,
    arm,
    got,
    verified: c.verified,
    shown: verdict.rows.map((r) => r.id),
    unparsed: !tap.timedOut && !answered,
    // Only meaningful on the fenced arm: a named bead the old YAML-only reader would have
    // turned into `none`.
    oldParserDropped: arm === 'fenced' && got !== null && !yamlOnly(raw),
    timedOut: tap.timedOut,
    raw,
    structured: tap.structured,
    why: verdict.why,
    costUsd: tap.cost,
    turns: tap.turns,
    ms: Date.now() - t0,
    warns,
  }, c);
}

/* --------------------------------------------------------------------------- the study */

async function pool(tasks, width) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, worker));
  return results;
}

export function summarise(runs) {
  const by = {};
  for (const arm of ARMS) {
    const rs = runs.filter((r) => r.arm === arm);
    if (!rs.length) continue;
    const pos = rs.filter((r) => r.want !== null);
    const neg = rs.filter((r) => r.want === null);
    // Agreement: of the cases run more than once, how many gave one answer every time.
    const perCase = new Map();
    for (const r of rs) perCase.set(r.case, [...(perCase.get(r.case) || []), r.got]);
    const multi = [...perCase.values()].filter((g) => g.length > 1);
    by[arm] = {
      runs: rs.length,
      wrongNames: rs.filter((r) => r.wrongName).length,
      wrongNamesVerified: rs.filter((r) => r.wrongName && r.verified).length,
      found: `${pos.filter((r) => r.found).length}/${pos.length}`,
      foundN: pos.filter((r) => r.found).length,
      negativesClean: `${neg.filter((r) => r.correct).length}/${neg.length}`,
      unparsed: rs.filter((r) => r.unparsed).length,
      timedOut: rs.filter((r) => r.timedOut).length,
      oldParserDropped: rs.filter((r) => r.oldParserDropped).length,
      agreement: multi.length ? `${multi.filter((g) => new Set(g).size === 1).length}/${multi.length}` : 'n/a',
      costUsd: +rs.reduce((s, r) => s + r.costUsd, 0).toFixed(4),
      avgMs: Math.round(rs.reduce((s, r) => s + r.ms, 0) / rs.length),
    };
  }
  return by;
}

export async function study({ cases, reps = 3, arms = ARMS, width = 3, out = null, log = console.log } = {}) {
  const tasks = [];
  for (let rep = 0; rep < reps; rep++) {
    for (const c of cases) for (const arm of arms) tasks.push(() => judgeOnce(c, arm).then((r) => ({ ...r, rep })));
  }
  log(`samejob judge study: ${cases.length} cases x ${arms.length} arms x ${reps} reps = ${tasks.length} runs, ${width} at a time`);
  const runs = await pool(
    tasks.map((t) => async () => {
      const r = await t();
      if (out) fs.appendFileSync(out, `${JSON.stringify(r)}\n`);
      log(`  ${r.correct ? 'ok  ' : r.wrongName ? 'NAME' : 'miss'}  ${r.arm.padEnd(11)} ${r.case.padEnd(14)} want ${r.want ?? 'none'} got ${r.got ?? 'none'}  $${r.costUsd.toFixed(3)} ${Math.round(r.ms / 1000)}s`);
      return r;
    }),
    width,
  );
  return { runs, summary: summarise(runs) };
}

/** The gate: schema-enum names no more wrong beads than fenced, and finds at least as many. */
export function verdictOf(summary) {
  const f = summary.fenced;
  const e = summary['schema-enum'];
  if (!f || !e) return { pass: false, why: 'needs both the fenced and schema-enum arms' };
  if (e.wrongNamesVerified > f.wrongNamesVerified) {
    return { pass: false, why: `schema-enum named ${e.wrongNamesVerified} wrong beads on verified cases, fenced ${f.wrongNamesVerified}` };
  }
  if (e.foundN < f.foundN) return { pass: false, why: `schema-enum found ${e.found}, fenced ${f.found}` };
  return { pass: true, why: `wrong names ${e.wrongNamesVerified} vs ${f.wrongNamesVerified}, found ${e.found} vs ${f.found}` };
}

const loadPairs = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'samejob-pairs.json'), 'utf8'));

/** The harness's entry: the pilot, so `--tag slow` costs nine runs and not a hundred and eighty. */
// `--model` is not honoured: the judge runs on whatever the foundation says, as in production.
export async function run() {
  const cases = pilotCases(corpusCases(loadPairs()));
  const { summary } = await study({ cases, reps: 1, log: () => {} });
  const v = verdictOf(summary);
  if (!v.pass) throw new EvalFailure(`${v.why}\n${JSON.stringify(summary, null, 2)}`);
  return v.why;
}

/** Two positives and a negative — enough to see the bill and whether each arm answers at all. */
const pilotCases = (cases) => [...cases.filter((c) => c.want).slice(0, 2), ...cases.filter((c) => !c.want).slice(0, 1)];

/* ------------------------------------------------------------------------------ CLI */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = argv.indexOf(name);
    return i === -1 ? dflt : argv[i + 1];
  };
  const pilot = argv.includes('--pilot');
  const reps = Number(opt('--reps', pilot ? 1 : 3));
  const live = Number(opt('--live', 0));
  const width = Number(opt('--width', 3));
  const out = opt('--out', path.join(os.tmpdir(), `samejob-study-${Date.now()}.jsonl`));

  let cases = corpusCases(loadPairs());
  if (pilot) cases = pilotCases(cases);
  else if (!argv.includes('--rescore')) cases = [...cases, ...liveCases(live)];

  // --rescore <file>: score a study already run against today's case definitions — no
  // model, no bill. A run whose case no longer exists (a live negative) keeps its old score.
  const rescore = opt('--rescore', null);
  let summary;
  if (rescore) {
    const byName = new Map(cases.map((c) => [c.name, c]));
    const runs = fs
      .readFileSync(rescore, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((r) => (byName.has(r.case) ? score(r, byName.get(r.case)) : r));
    summary = summarise(runs);
  } else {
    ({ summary } = await study({ cases, reps, width, out }));
  }
  console.log('\nper arm:');
  console.table(summary);
  const v = verdictOf(summary);
  console.log(`\n${v.pass ? 'PASS' : 'FAIL'} — ${v.why}`);
  const total = Object.values(summary).reduce((s, a) => s + a.costUsd, 0);
  const n = Object.values(summary).reduce((s, a) => s + a.runs, 0);
  console.log(`spent $${total.toFixed(2)} over ${n} runs ($${(total / n).toFixed(3)} a run); every run is in ${rescore || out}`);
  process.exit(v.pass ? 0 : 1);
}
