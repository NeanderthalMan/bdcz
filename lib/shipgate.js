/**
 * `bin/b7e-shipgate` is `b7e-affected` piped into `b7e-gate --only`, and this is the
 * decision the CLI acts on — pure, so it is tested without spawning either.
 *
 * bc-xlz32.2: `b7e-affected` (bc-khoe.40) already answers "which suites cover this diff"
 * and `b7e-gate --only` (bc-khoe.39) already takes the answer, but nothing composed them
 * by default — every session ran the whole 440-suite gate before delivering, ~20
 * worktrees at a time, which is most of the load the rest of this epic is fighting. Since
 * bc-rcrt the full suite also runs in GitHub Actions on the merge that is actually about
 * to happen, so a full *local* run is a slower, less accurate copy of a check that
 * happens regardless — the local gate can afford to narrow.
 *
 * **And since bc-xlz32.14, `b7e-gate` takes the same decision itself.** Keeping it
 * outside the gate (below) left it reaching one gate in five: of 37 whole-suite session
 * gates measured on 2026-09-22, 18 were a bare `b7e-gate` or `b7e-detach`, none was a
 * deliberate `--full`. So `affectedDecision` below is the one narrowing step both commands
 * call, a bare `b7e-gate` narrows, and a whole run is always an explicit `--full` — which
 * is also why `selectionArgsFor` never hands the gate an empty argv. The paragraph below is
 * why the split was first drawn, and it still explains why the fallback reads the way it
 * does.
 *
 * **Composed outside `b7e-gate`, on purpose.** `bin/b7e-gate`, `lib/gate.js` and
 * `scripts/test.mjs` are untouched by this file — bc-xlz32.1/.5 own those three this
 * week (a machine-wide gate semaphore), and a `--affected` flag on the gate itself would
 * collide with that work. Composing the two commands from outside also keeps
 * `b7e-affected`'s own fallback visible at the exact point the decision gets made,
 * instead of a layer down inside the gate where nobody but this file would ever read it.
 *
 * **The fallback is the whole point, not an edge case.** `b7e-affected` prints nothing on
 * stdout and exits `1` the moment any changed file matched no suite — a partial list
 * would look identical to a complete one — and an empty `--only` selection is
 * `b7e-gate`'s own definition of "everything." This module reads `b7e-affected --json`
 * instead of the plain pipe (the CLI still drives the plain contract to decide whether to
 * narrow; `--json` is only how it explains itself), and treats an empty `suites` list —
 * whether from an unmatched file or from no changed files at all — the same way the pipe
 * would: run the whole gate, and say why in the one line this hands back for
 * `beadcause-deliver --tests`.
 *
 * **A second gap, found dogfooding this on its own diff.** `b7e-affected`'s own universe
 * is deliberately wider than `b7e-gate`'s: `lib/affected.js`'s `candidateSuites` matches
 * against `npm test`'s suites *union* every browser check under `scripts/*-check.mjs`
 * (`lib/checkaudit.js`), because both are real coverage. `b7e-gate` only ever knows about
 * the first half. Left alone, a diff matched only by browser checks would still read as
 * "narrowed," hand `b7e-gate --only` a list of names it has never heard of, and land on
 * its `nothing matches --only …` refusal — a manufactured *failure* for a diff that
 * simply has no local `npm test` coverage to run. `restrictToKnownSuites` is the fix: the
 * CLI filters `b7e-affected`'s list down to `b7e-gate`'s own discovered suites before
 * `decide` ever sees it, so the record's count is exactly what will run, and a diff whose
 * only matches are browser checks reports zero *local* suites rather than failing.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverSuites } from './gate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Same convention `lib/gate.js` and `lib/affected.js` use: resolved from wherever this
 * file is actually running out of, main checkout or worktree — never a fixed path. */
export const REPO_ROOT = path.join(HERE, '..');
export const AFFECTED_BIN = path.join(REPO_ROOT, 'bin', 'b7e-affected');
export const GATE_BIN = path.join(REPO_ROOT, 'bin', 'b7e-gate');
/** `b7e-gate` started so it outlives its caller — what lib/autogate.js spawns. */
export const DETACH_BIN = path.join(REPO_ROOT, 'bin', 'b7e-detach');

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * `b7e-affected`'s own matched-suite list, restricted to suites `b7e-gate` actually knows
 * about (`known`, its discovered set) — dropping browser checks and anything else outside
 * `npm test`'s own roster. `wasMatched` says whether anything was there *before* the
 * restriction, which is what tells `decide` apart a genuinely unmatched file from a file
 * that matched real coverage, just none of it local.
 */
export function restrictToKnownSuites(suites, known) {
  const knownSet = known instanceof Set ? known : new Set(known);
  return { suites: suites.filter((s) => knownSet.has(s)), wasMatched: suites.length > 0 };
}

/**
 * The one decision this whole file exists for: narrow, run everything, or run nothing
 * locally — and the one-line record either way.
 *
 * `changedFileCount`/`suites`/`unmatchedFiles` trace back to `b7e-affected --json`'s own
 * summary line (`{summary: true, suites, unmatchedFiles}`) plus a count of how many
 * per-file objects preceded it — never re-derived here, so this can never disagree with
 * what `b7e-affected` itself found. `suites` is expected to already be restricted to
 * `b7e-gate`'s own known suites (`restrictToKnownSuites`); `browserOnly` says whether that
 * restriction is *why* it's empty — real coverage existed, just none of it local — as
 * opposed to `unmatchedFiles` saying nothing covers this file at all.
 */
export function decide({ full = false, changedFileCount = 0, suites = [], unmatchedFiles = [], browserOnly = false } = {}) {
  if (full) {
    return { narrow: false, suites: [], selection: 'full-requested', record: 'full gate: --full requested' };
  }
  if (changedFileCount === 0) {
    return { narrow: false, suites: [], selection: 'full-fallback', record: 'full gate: no changed files to narrow against' };
  }
  if (unmatchedFiles.length) {
    const named =
      unmatchedFiles.length <= 3
        ? unmatchedFiles.join(', ')
        : `${unmatchedFiles.slice(0, 3).join(', ')}, +${unmatchedFiles.length - 3} more`;
    return { narrow: false, suites: [], selection: 'full-fallback', record: `full gate: ${named} matched no suite` };
  }
  if (browserOnly) {
    return {
      narrow: true,
      suites: [],
      skip: true,
      selection: 'affected',
      record: `affected: 0 local suites for ${plural(changedFileCount, 'changed file')} — every match is a browser check, outside npm test`,
    };
  }
  return {
    narrow: true,
    suites,
    selection: 'affected',
    record: `affected: ${plural(suites.length, 'suite')} for ${plural(changedFileCount, 'changed file')}`,
  };
}

/** The final record, with what the gate actually did folded in — the text this command
 * hands back for `beadcause-deliver --tests`. */
export function recordWithOutcome(record, gateStatus) {
  return gateStatus === 0 ? `${record}, all passed` : `${record} — gate failed, see output above`;
}

/**
 * Parses `b7e-affected --json`'s stdout (one object per changed file, then a summary
 * line) into exactly what `decide` needs. Empty stdout — the zero-changed-files case,
 * which prints nothing even in `--json` mode — comes back as a zero count and no suites,
 * which `decide` reads the same way it reads a genuine unmatched fallback: run
 * everything.
 */
export function parseAffectedJson(stdout) {
  const lines = String(stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean);
  if (!lines.length) return { changedFileCount: 0, suites: [], unmatchedFiles: [] };
  const parsed = lines.map((l) => JSON.parse(l));
  const summary = parsed[parsed.length - 1];
  return {
    changedFileCount: parsed.length - 1,
    suites: summary.suites || [],
    unmatchedFiles: summary.unmatchedFiles || [],
  };
}

/**
 * Every value `selection` can take on a run record's start line (bc-xlz32.14), so the next
 * measurement of `.claude/gate-runs` can say *why* a gate was whole instead of guessing:
 *
 * - `affected` — narrowed to what `b7e-affected` matched (the default, since bc-xlz32.14).
 * - `only` — the caller named its own `--only` list (CI's shards, a hand-picked rerun).
 * - `full-requested` — `--full`, on purpose.
 * - `full-fallback` — narrowing was tried and could not be trusted: a file matched no
 *   suite, there was no diff to narrow against, or `b7e-affected` refused.
 * - `full-ci` — CI never narrows; `merge_group` and `push: main` always run everything.
 */
export const SELECTIONS = Object.freeze(['affected', 'only', 'full-requested', 'full-fallback', 'full-ci']);

/**
 * `b7e-affected --json` over `root` (against `files`, or the diff since origin/main when
 * none are given), restricted to the suites `b7e-gate` knows, and decided. This is the
 * whole narrowing step `bin/b7e-shipgate` and `bin/b7e-gate`'s default both take, so the
 * two can never disagree about what a diff selects.
 *
 * `b7e-affected` refusing (exit 2 — not a git checkout, a bad path) is not this caller's
 * refusal: it comes back as a `full-fallback` decision with the refusal as its reason,
 * because a gate that will not run over a bookkeeping failure is the worse bug.
 * `{ refused }` carries the text for a caller that would rather stop (`b7e-shipgate` does).
 */
export function affectedDecision(root, files = [], { affectedBin = AFFECTED_BIN } = {}) {
  const res = spawnSync(process.execPath, [affectedBin, '--dir', root, '--json', ...files], { encoding: 'utf8' });
  if (res.status === 2 || res.error) {
    const refused = String(res.stderr || (res.error && res.error.message) || 'b7e-affected refused').trim();
    const first = refused.replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0];
    return { narrow: false, suites: [], selection: 'full-fallback', record: `full gate: b7e-affected refused — ${first}`, refused };
  }
  let parsed;
  try {
    parsed = parseAffectedJson(res.stdout);
  } catch {
    return { narrow: false, suites: [], selection: 'full-fallback', record: 'full gate: b7e-affected printed something unreadable' };
  }
  // b7e-affected matches against npm test's suites UNION every browser check; b7e-gate
  // only ever knows the first half. Restrict before deciding, so a diff matched only by
  // browser checks reads as zero local suites rather than a b7e-gate --only refusal.
  const { suites: knownSuites, wasMatched } = restrictToKnownSuites(parsed.suites, discoverSuites(root));
  return decide({ ...parsed, suites: knownSuites, browserOnly: wasMatched && knownSuites.length === 0 });
}

/**
 * The flags a decided selection hands `b7e-gate`, so it records the decision rather than
 * making a second one: `--only`s for a narrowed decision, `--full` for a whole one, and the
 * kind and reason either way.
 */
export function selectionArgsFor(decision) {
  return [
    ...(decision.narrow ? decision.suites.flatMap((s) => ['--only', s]) : ['--full']),
    '--selection',
    decision.selection,
    '--selection-reason',
    decision.record,
  ];
}
