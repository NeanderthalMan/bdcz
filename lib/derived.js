/**
 * What in a checkout is generated from a source file, and whether it is now stale —
 * `bin/b7e-derived` is the argv shell; this is the mapping and the running.
 *
 * bc-dgx7.1's session audit found the same question asked five times by hand in a repo
 * that generates files from other files — "what does this repo regenerate from the file
 * I just edited, and did I keep it in step?" — answered each time with a different ad-hoc
 * `grep` or, once, not until a gate went red six edits later. `lib/affected.js` already answers the sibling question ("what
 * *tests* this file") the same way this answers "what does this file *feed*": read a small
 * declaration, match a changed path against it, run what the repo itself already runs.
 *
 * ## The declaration lives in the checkout, not in this repo
 *
 * `lib/repoviews.js` already makes this argument for a different declaration
 * (`.beadcause/views.json`): a fact about which scripts a checkout runs and which files
 * they touch is a fact about that checkout, at that revision, and it moves with the commit
 * that changes it. Hardcoding one repo's generator paths into *this* repo would mean this
 * repo needs a pull request every time that repo renames a build script, and would give
 * every other workspace nothing at all until somebody wrote a second hardcoded table for
 * each of them. `.beadcause/derived.json` (`MANIFEST_FILE`
 * below) is that declaration, one file, read the same way `views.json` is: never trusted
 * beyond "a fact this checkout asserts about itself", and its `run`/`check` commands are as
 * trusted as everything else this daemon already runs in that checkout — the gate, the
 * deploy script, the view generators.
 *
 *     {
 *       "generators": [
 *         {
 *           "id": "compendium/build.py",
 *           "run": ["python3", "compendium/build.py"],
 *           "check": ["python3", "compendium/build.py", "--check"],
 *           "sources": ["compendium/**"],
 *           "artifacts": [
 *             "compendium/web/data.js",
 *             "reference/maps/private/compendium.admin.js",
 *             "reference/maps/private/compendium.reader.js"
 *           ]
 *         }
 *       ]
 *     }
 *
 * `run` is an argv, never a shell string — same reasoning as `lib/repoviews.js`'s
 * `runGenerator`: a filename with a space in it stays a filename with a space in it, and a
 * manifest cannot smuggle `; rm -rf` through one. `check` is optional; a generator with none
 * is still matched and listed, just never reported clean or stale.
 *
 * ## Two small pieces of matching, not one big one
 *
 * `matchesSource` turns each `sources` glob into a regex once (`*` inside a path segment,
 * `**` across segments, everything else literal) and tests it against a changed,
 * repo-relative path. `findDerived` is the whole answer for one list of changed files and
 * one list of generators — pure, no filesystem, no subprocess — which is what makes it
 * testable against a handful of literal strings and, separately, testable end to end
 * against a `.beadcause/derived.json` fixture through `--dir` the same way
 * `test/affected.mjs` drives `lib/affected.js` against a fabricated tree.
 *
 * `runCheck`/`runRebuild` are the only functions that touch a subprocess, and both take an
 * explicit `root` to run in and a timeout, so a generator that hangs cannot hang this
 * command with it.
 *
 * ## Order, and mid-merge regeneration (bc-dgx7.139)
 *
 * A generator may declare `"after": ["<id>", ...]`, and one whose `sources` match another's
 * `artifacts` waits on it without saying so. `upstreamEdges` holds both, `planDerived`
 * turns "what a diff touched" into an ordered list (what is downstream, and any upstream
 * whose artifact is not on disk), and `walkPlan` runs it while skipping a step whose input
 * is known bad. `conflictedPaths`/`stageText`/`artifactOwner`/`sideSurvival` are
 * `--conflicted`: which unmerged paths are declared artifacts, what each parent had, and
 * whether each parent's own lines survived the regeneration. The last two git reads are
 * the only subprocesses here besides the generators themselves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** This repo's own root — same anchor `lib/affected.js`'s `REPO_ROOT` uses. */
export const REPO_ROOT = path.join(HERE, '..');

/** The one directory in a checkout this reads, same convention as `lib/repoviews.js`. */
export const MANIFEST_DIR = '.beadcause';
/** The manifest inside it. */
export const MANIFEST_FILE = 'derived.json';

/** How long a `run`/`check` may take before it is killed and reported as trouble. */
export const RUN_TIMEOUT_MS = 60_000;
/** How much stdout/stderr a `run`/`check` may produce. */
export const RUN_MAX_BYTES = 8 * 1024 * 1024;

/* -------------------------------------------------------------------------- the manifest */

/**
 * `<root>/.beadcause/derived.json`, read and validated. Returns
 * `{ generators: [{ id, sources, artifacts, run, check, after }], problems: [string, ...],
 * cycles: [[id, ...], ...] }`.
 *
 * Never throws. No manifest at all is `{ generators: [], problems: [] }` — a checkout with
 * nothing generated looks exactly like one nobody has declared yet, which is the right
 * answer for both. A manifest that exists but cannot be read or parsed is reported as a
 * problem rather than silently treated as empty, the same distinction `lib/repoviews.js`
 * draws for `views.json` and `lib/affected.js`'s header calls "never a shrug": a checkout
 * that meant to declare something and got the JSON wrong should not read as "nothing here".
 *
 * A malformed *entry* (no `id`, no `sources`, no `artifacts`) is dropped and reported by
 * itself; one bad generator does not take the rest of the manifest down with it, the same
 * choice `lib/repoviews.js` makes for one bad view.
 */
export function loadManifest(root) {
  const file = path.join(root, MANIFEST_DIR, MANIFEST_FILE);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { generators: [], problems: [], cycles: [] };
    return { generators: [], cycles: [], problems: [`cannot read ${MANIFEST_DIR}/${MANIFEST_FILE} — ${err.message.split('\n')[0]}`] };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { generators: [], cycles: [], problems: [`${MANIFEST_DIR}/${MANIFEST_FILE} does not parse as JSON — ${err.message.split('\n')[0]}`] };
  }
  const list = Array.isArray(parsed?.generators) ? parsed.generators : [];
  const generators = [];
  const problems = [];
  const strArray = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : []);
  list.forEach((g, i) => {
    const where = `${MANIFEST_DIR}/${MANIFEST_FILE} generators[${i}]`;
    if (!g || typeof g !== 'object' || Array.isArray(g)) {
      problems.push(`${where} is not an object`);
      return;
    }
    const id = typeof g.id === 'string' && g.id.trim() ? g.id.trim() : null;
    if (!id) {
      problems.push(`${where} has no id`);
      return;
    }
    const sources = strArray(g.sources);
    if (!sources.length) {
      problems.push(`${where} (${id}) names no sources`);
      return;
    }
    const artifacts = strArray(g.artifacts);
    if (!artifacts.length) {
      problems.push(`${where} (${id}) names no artifacts`);
      return;
    }
    const run = strArray(g.run);
    const check = strArray(g.check);
    const after = strArray(g.after);
    generators.push({ id, sources, artifacts, run: run.length ? run : null, check: check.length ? check : null, after });
  });
  // `after` can only be checked once every id is known: a name that matches no declared
  // generator is dropped and reported rather than silently waited on forever, and so is a
  // generator naming itself.
  const ids = new Set(generators.map((g) => g.id));
  for (const g of generators) {
    const kept = [];
    for (const dep of g.after) {
      if (dep === g.id) problems.push(`${MANIFEST_DIR}/${MANIFEST_FILE} ${g.id} lists itself in after`);
      else if (!ids.has(dep)) problems.push(`${MANIFEST_DIR}/${MANIFEST_FILE} ${g.id} is after "${dep}", which no generator declares`);
      else if (!kept.includes(dep)) kept.push(dep);
    }
    g.after = kept;
  }
  const cycles = afterCycles(generators);
  for (const c of cycles) problems.push(`${MANIFEST_DIR}/${MANIFEST_FILE} after forms a loop: ${c.join(' -> ')}`);
  return { generators, problems, cycles };
}

/**
 * Every loop in the declared `after` edges, each as the ids walked round it (first id
 * repeated at the end). A loop is a manifest that asks for something impossible — "run X
 * only after Y, and Y only after X" — so it is reported as a problem and `--rebuild`
 * refuses rather than pick an order the manifest itself says is wrong.
 */
export function afterCycles(generators) {
  const byId = new Map(generators.map((g) => [g.id, g]));
  const state = new Map(); // id -> 'active' | 'done'
  const stack = [];
  const cycles = [];
  const visit = (id) => {
    state.set(id, 'active');
    stack.push(id);
    for (const dep of byId.get(id)?.after || []) {
      if (state.get(dep) === 'active') cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
      else if (!state.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(id, 'done');
  };
  for (const g of generators) if (!state.has(g.id)) visit(g.id);
  return cycles;
}

/* -------------------------------------------------------------------------- glob matching */

const escapeLiteral = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/**
 * A `sources` glob turned into a regex, once per pattern (cached below). Three tokens:
 * `**` crosses `/`, a lone `*` stops at it, everything else is literal. `**​/` collapses to
 * "zero or more path segments" so `novel/**​/CHAPTER_*.md` matches
 * `novel/Lorem Book 3/CHAPTER_12.md` *and* a chapter file sitting directly under `novel/`.
 */
export function globToRegExp(glob) {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i += 2;
      if (glob[i] === '/') {
        re += '(?:.*/)?';
        i += 1;
      } else {
        re += '.*';
      }
      continue;
    }
    if (c === '*') {
      re += '[^/]*';
      i += 1;
      continue;
    }
    re += escapeLiteral(c);
    i += 1;
  }
  re += '$';
  return new RegExp(re);
}

const reCache = new Map();
const compiled = (glob) => {
  if (!reCache.has(glob)) reCache.set(glob, globToRegExp(glob));
  return reCache.get(glob);
};

/** Does any of `generator.sources` match this repo-relative path? */
export function matchesSource(generator, relFile) {
  return generator.sources.some((pat) => compiled(pat).test(relFile));
}

/* ------------------------------------------------------------------------------ matching */

/**
 * The whole answer for one list of changed (repo-relative) files against one list of
 * generators: `{ results: [{ file, generators: [generator, ...] }], unmatched: [file, ...],
 * generators: [generator, ...] }`.
 *
 * `results` only carries files with at least one match; a file with none is in `unmatched`
 * instead, never silently absent from both — same "never a shrug" rule `lib/affected.js`
 * states for its own sibling question. `generators` on the return is the deduplicated set
 * actually touched, in first-seen order, which is what `--check`/`--rebuild` iterate.
 */
export function findDerived(changedFiles, generators) {
  const results = [];
  const unmatched = [];
  const touchedIds = new Set();
  const touched = [];
  for (const file of changedFiles) {
    const matches = generators.filter((g) => matchesSource(g, file));
    if (matches.length) {
      results.push({ file, generators: matches });
      for (const g of matches) {
        if (!touchedIds.has(g.id)) {
          touchedIds.add(g.id);
          touched.push(g);
        }
      }
    } else {
      unmatched.push(file);
    }
  }
  return { results, unmatched, generators: touched };
}

/* ------------------------------------------------------------------------------ ordering */

/**
 * What each generator waits on: `Map<id, Map<upstreamId, 'after' | 'feeds'>>`.
 *
 * Two kinds of edge, because a manifest states an order two ways. `after` is the explicit
 * one ("never run build_cut until build_temp_beds has succeeded"). `feeds` is the one the
 * manifest already implies without saying so: when one generator's declared artifact
 * matches another's `sources`, the second reads what the first writes — a `build_cut.py`
 * that lists `post/sound/out/mix.beds.wav` among its sources, where that file is
 * `build_temp_beds.py`'s artifact. A generator matching its own artifact (`docs/**`
 * covers `docs/web/data.js`) is not an edge.
 */
export function upstreamEdges(generators) {
  const edges = new Map(generators.map((g) => [g.id, new Map()]));
  for (const g of generators) {
    for (const dep of g.after || []) edges.get(g.id).set(dep, 'after');
    for (const h of generators) {
      if (h === g || edges.get(g.id).has(h.id)) continue;
      if (h.artifacts.some((a) => matchesSource(g, a))) edges.get(g.id).set(h.id, 'feeds');
    }
  }
  return edges;
}

/**
 * The ordered list of generators a `--check`/`--rebuild` should run, given the ones a diff
 * touched directly. Returns `{ steps: [{ generator, reason, needs }], loop: [id, ...] }`.
 *
 * Three ways onto the list, each carried as `reason` so the output can say why:
 *
 *  - `{ kind: 'changed' }` — a changed file matched its `sources` (`findDerived`).
 *  - `{ kind: 'downstream', of }` — something upstream of it is on the list, so what it
 *    reads is about to change under it. Off with `downstream: false` (`--conflicted` wants
 *    only the generators that own a conflicted file).
 *  - `{ kind: 'prerequisite', of, missing }` — something on the list waits on it and one
 *    of its artifacts is not on disk. This is the lm-5eu.27 refusal: build_cut.py's own
 *    `--check` stops dead because `TEASER_01.beds.wav` is gitignored and was never built
 *    in this checkout. An upstream generator whose artifacts are all present is left
 *    alone — its output is there to read, and rebuilding it is not what was asked.
 *
 * `needs` is the ids on the list this step waits on, which is what lets the CLI skip a
 * step whose prerequisite failed. The order is topological over both edge kinds, ties
 * broken by manifest order. If the `feeds` edges alone make a loop (two generators each
 * reading the other's output), the order falls back to `after` edges plus manifest order
 * for those generators and `loop` names them — the manifest's explicit word still holds,
 * which `afterCycles` has already refused to let loop.
 *
 * `exists(relPath)` is injected so this stays free of the filesystem.
 */
export function planDerived(touched, generators, { exists = () => true, downstream = true } = {}) {
  const edges = upstreamEdges(generators);
  const index = new Map(generators.map((g, i) => [g.id, i]));
  const byId = new Map(generators.map((g) => [g.id, g]));
  const reasons = new Map();
  for (const g of touched) if (byId.has(g.id)) reasons.set(g.id, { kind: 'changed' });

  let grew = true;
  while (grew) {
    grew = false;
    if (downstream) {
      for (const g of generators) {
        if (reasons.has(g.id)) continue;
        const up = [...edges.get(g.id).keys()].find((u) => reasons.has(u));
        if (up) {
          reasons.set(g.id, { kind: 'downstream', of: up });
          grew = true;
        }
      }
    }
    for (const id of [...reasons.keys()]) {
      for (const up of edges.get(id).keys()) {
        if (reasons.has(up)) continue;
        const missing = byId.get(up).artifacts.find((a) => !exists(a));
        if (missing) {
          reasons.set(up, { kind: 'prerequisite', of: id, missing });
          grew = true;
        }
      }
    }
  }

  const onList = [...reasons.keys()];
  const order = (useFeeds) => {
    const waits = new Map(
      onList.map((id) => [id, new Set([...edges.get(id)].filter(([u, kind]) => reasons.has(u) && (useFeeds || kind === 'after')).map(([u]) => u))]),
    );
    const done = [];
    const left = new Set(onList);
    while (left.size) {
      const ready = [...left].filter((id) => [...waits.get(id)].every((u) => !left.has(u))).sort((a, b) => index.get(a) - index.get(b));
      if (!ready.length) return { done, stuck: [...left].sort((a, b) => index.get(a) - index.get(b)) };
      left.delete(ready[0]);
      done.push(ready[0]);
    }
    return { done, stuck: [] };
  };
  let { done, stuck } = order(true);
  let loop = [];
  if (stuck.length) {
    loop = stuck;
    ({ done } = order(false));
  }
  const steps = done.map((id) => ({
    generator: byId.get(id),
    reason: reasons.get(id),
    needs: [...edges.get(id).keys()].filter((u) => reasons.has(u) && !(loop.includes(u) && loop.includes(id) && edges.get(id).get(u) === 'feeds')),
  }));
  return { steps, loop };
}

/**
 * Walk a plan, calling `act(generator)` for each step unless a step it needs came back in
 * one of the `blocking` statuses — then it is `{ status: 'skipped', detail }` instead and
 * `act` never runs, because its input is known bad. Returns `Map<id, { status, detail }>`.
 * `preset` lets a caller decide a step's result without running it (`--check` on a
 * prerequisite whose artifact is missing: there is nothing to check yet).
 */
export function walkPlan(steps, act, { blocking, preset = () => null } = {}) {
  const results = new Map();
  for (const { generator, needs } of steps) {
    const bad = needs.filter((u) => blocking.has(results.get(u)?.status));
    if (bad.length) {
      results.set(generator.id, { status: 'skipped', detail: `waits on ${bad.join(', ')}, which did not succeed` });
      continue;
    }
    results.set(generator.id, preset(generator) || act(generator));
  }
  return results;
}

/* ---------------------------------------------------------------------------- conflicts */

const MARKER = /^(?:<{7}|>{7})(?: |$)/;

/** How many `<<<<<<<` / `>>>>>>>` lines are left in a file's text. */
export function conflictMarkers(text) {
  return String(text || '').split('\n').filter((l) => MARKER.test(l)).length;
}

/**
 * The generator that owns a path as a declared artifact — an exact match, or an artifact
 * ending in `/` that the path sits under (`design/prompts/`). `null`
 * when nothing declares it.
 */
export function artifactOwner(relPath, generators) {
  return generators.find((g) => g.artifacts.some((a) => a === relPath || (a.endsWith('/') && relPath.startsWith(a)))) || null;
}

/**
 * Did each parent's side of a conflicted file survive into what it was regenerated to?
 *
 * This is lm-5i2.107's manual proof — grep the regenerated compendium bundle for one
 * literal from each parent — made mechanical. A side's *own* lines are the ones it added
 * that neither the merge base nor the other parent has; those are the only lines that
 * prove *that* side made it in, since a line both sides share proves nothing about either.
 * Lines shorter than four characters (`}`, `],`) are ignored: they are in everything.
 *
 * Returns `{ ours: { own, kept, sample }, theirs: { own, kept, sample } }` — `sample` is
 * one own line that did not survive, for the report. A side with no own lines passes
 * vacuously: it changed nothing of its own that could have been lost.
 */
export function sideSurvival(base, ours, theirs, merged) {
  const lines = (t) => new Set(String(t || '').split('\n').map((l) => l.trim()).filter((l) => l.length >= 4 && !MARKER.test(l) && l !== '======='));
  const [b, o, t, m] = [base, ours, theirs, merged].map(lines);
  const side = (mine, other) => {
    const own = [...mine].filter((l) => !b.has(l) && !other.has(l));
    const lost = own.filter((l) => !m.has(l));
    return { own: own.length, kept: own.length - lost.length, sample: lost[0] || null };
  };
  return { ours: side(o, t), theirs: side(t, o) };
}

/* ------------------------------------------------------------------------------ running */

/** Spawn one argv in `root`. Returns `{ ok, code, tail }` — never throws. */
function runArgv(root, argv, timeoutMs) {
  const [cmd, ...args] = argv;
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: RUN_MAX_BYTES,
      encoding: 'utf8',
      // Never a shell — see the header note above and lib/repoviews.js's own comment on
      // `runGenerator`: an argv is what makes a filename with a space in it stay one.
      shell: false,
    });
    return { ok: true, code: 0, tail: String(stdout || '').trim().split('\n').slice(-3).join(' ').slice(0, 400) };
  } catch (err) {
    const stderrTail = String(err.stderr || '').trim().split('\n').slice(-3).join(' ').slice(0, 400);
    const why = err.signal === 'SIGTERM' && err.killed ? `timed out after ${timeoutMs / 1000}s` : err.message.split('\n')[0];
    return { ok: false, code: typeof err.status === 'number' ? err.status : null, tail: stderrTail || why };
  }
}

/**
 * Run a generator's own `check` argv in `root`. `{ status: 'clean' | 'stale' | 'no-check',
 * detail }`. Convention (`build_series_log.py . --check` and siblings): exit `0` is clean,
 * any other exit is stale, and the last few lines of output are why.
 */
export function runCheck(root, generator, timeoutMs = RUN_TIMEOUT_MS) {
  if (!generator.check) return { status: 'no-check', detail: `${generator.id} declares no check command` };
  const { ok, tail } = runArgv(root, generator.check, timeoutMs);
  return { status: ok ? 'clean' : 'stale', detail: tail };
}

/**
 * Run a generator's own `run` argv in `root` — this is the one thing in this file that
 * writes to the checkout. `{ status: 'ran' | 'no-run' | 'failed', detail }`.
 */
export function runRebuild(root, generator, timeoutMs = RUN_TIMEOUT_MS) {
  if (!generator.run) return { status: 'no-run', detail: `${generator.id} declares no run command` };
  const { ok, tail } = runArgv(root, generator.run, timeoutMs);
  return { status: ok ? 'ran' : 'failed', detail: tail };
}

/**
 * Every path git currently holds as unmerged in `root` — `git diff --diff-filter=U`, the
 * same list `git status` prints under "both modified". `null` when `root` is not a git
 * checkout or git fails, so the caller can refuse rather than read that as "no conflicts".
 */
export function conflictedPaths(root) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=U', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [...new Set(out.split('\0').filter(Boolean))];
  } catch {
    return null;
  }
}

/**
 * One side of an unmerged path, read from the index: stage `1` is the merge base, `2` is
 * ours, `3` is theirs. `''` when that stage does not exist — an add/add conflict has no
 * base, and a side that deleted the file has no stage of its own.
 */
export function stageText(root, stage, relPath) {
  try {
    return execFileSync('git', ['show', `:${stage}:${relPath}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: RUN_MAX_BYTES,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}
