/**
 * `b7e-premise` — does the symptom a bead describes still reproduce at a ref, checked
 * mechanically before anyone opens a worktree to find out by hand.
 *
 * bc-dgx7.70 names five sessions (dv-gr6.48, dv-3rn.5, dv-b5d.30, dv-gr6.47, dv-gr6.44)
 * that each arrived at a bead, hand-checked whether its problem still existed, and found
 * it already fixed — every one of them by re-deriving the same four kinds of check from
 * scratch: a commit's ancestry, a script's exit code, a path's existence, a literal
 * string's presence in a named file. This module is the claim extraction and the
 * checking; `bin/b7e-premise` is the argv shell around it, same split as
 * `lib/checks.js`/`bin/b7e-checks` and `lib/prior.js`/`bin/b7e-prior`.
 *
 * ## Claim extraction is conservative on purpose
 *
 * `extractClaims` reads only inline code spans (single backticks) out of a bead's text
 * and classifies each one into exactly one of four shapes — a bare or `git
 * merge-base --is-ancestor`-wrapped commit sha, a `python3 scripts/*.py`-shaped command,
 * a slash-bearing repo path, or a `grep`-shaped literal-in-file command. A span
 * recognised as none of those four is reported `UNCHECKABLE` by its own text, never
 * silently dropped and never guessed at by looser matching — the bead's own acceptance
 * criteria says exactly this ("Anything else is reported UNCHECKABLE by name rather than
 * guessed at").
 *
 * ## What HOLDS and GONE mean
 *
 * Each claim shape has one canonical, narrative-independent fact: a sha *is* an ancestor
 * of the ref, a script *exits clean* at the ref, a path *exists* at the ref, a literal
 * *is present* in its file at the ref. `HOLDS` is that fact being true today; `GONE` is
 * it being false. This file never tries to infer whether the bead's prose meant the
 * claim as a symptom ("still broken") or as an acceptance condition ("must pass") —
 * bc-dgx7.70's own bug beads mix both framings, and guessing the narrative direction is
 * exactly the kind of guess "conservative on purpose" rules out. The reader is handed
 * the fact and the evidence and draws the conclusion, the same disclaimer `lib/prior.js`
 * makes for its own results.
 *
 * ## The reconstructed exit-code rule
 *
 * bc-dgx7.70's own acceptance criteria is truncated mid-sentence in the tracker
 * ("Exit 0 when at") — the source bead itself, not a rendering artefact; `bd show
 * bc-dgx7.70 --json` reproduces the same cut. What survives intact is two concrete
 * replay requirements: against dv-gr6.48 (whose two acceptance-criteria claims — a sha
 * ancestry check and a literal-in-file check — were "both already true") this command
 * "must return exit 4"; against dv-3rn.5 it "must show the G0 selftest HOLDS-clean and
 * the G1 selftest still failing". Both are satisfiable by exactly one rule: **exit 4
 * when every checkable claim (excluding UNCHECKABLE) comes back HOLDS; exit 0
 * otherwise** — dv-gr6.48's two claims both HOLD (exit 4), dv-3rn.5's two claims split
 * HOLDS/GONE (exit 0, and G0's clean pass is exactly what "HOLDS-clean" describes). See
 * `test/b7epremise.mjs` for the fixtures that pin this reading rather than the two real
 * external beads, which this checkout cannot reach in CI.
 *
 * ## Why running a script needs a worktree, and why that costs this command its default
 * grant
 *
 * A sha's ancestry, a path's existence and a literal's presence are all plain `git`
 * plumbing reads against the target checkout — no worktree needed. Actually *running* a
 * `python3 scripts/*.py` claim needs real files on disk at the ref, so this reuses
 * `lib/checks.js`'s `makeRefWorktree`/`removeRefWorktree` (the same throwaway detached
 * `git worktree add` `--baseline` uses) rather than inventing a second copy. That is the
 * same write-shaped step `b7e-checks` and `b7e-at` declare `@grant excluded` for (see
 * `lib/tooldecl.js`), so `bin/b7e-premise` declares the same, on the same reasoning,
 * even though bc-dgx7.70's own text asks for the grant.
 *
 * ## Two more shapes, and a third source (bc-dgx7.133)
 *
 * **A bead id** (`bc-dgx7.70`, `dv-b5d.4`) is a claim that the bead is still open work.
 * `HOLDS` is open and not deferred; `GONE` is closed or deferred (the defer date is the
 * evidence). It is only recognised when its prefix belongs to a configured workspace —
 * `beadPrefixes` — because `non-blocking` is shaped like an id and is not one. The lookup is
 * async (`bd show`, against whichever workspace owns the prefix) so the caller resolves it
 * into `beads` (id → row, or null) and this module stays synchronous.
 *
 * **A branch name** (`worktree-…`, optionally `origin/`-prefixed) is resolved against the
 * ref: `HOLDS` is a branch that exists with commits the ref lacks, `GONE` is a missing
 * branch or one already wholly in the ref. Ahead/behind is the evidence. Counting is by
 * sha only — a cherry-picked branch reads as ahead; `lib/notinmain.js`'s `commitsUpstream`
 * is the async answer to that and is deliberately not pulled in here.
 *
 * **The parent's plan-group prompt** (`groupPromptFor`) is a third text source beside the
 * description and acceptance criteria: a wrong "27 ahead, 0 behind" lived only there.
 *
 * Deliberately not built: delmar's "Entry NNN" citations resolved against a numbered book
 * chapter. That is a delmar content domain; beadcause has no equivalent and a generic
 * version would be a guess.
 */
import { execFileSync } from 'node:child_process';
import { makeRefWorktree, removeRefWorktree } from './checks.js';

const CODE_SPAN_RE = /`([^`\n]+)`/g;
const GIT_ANCESTOR_RE = /^git\s+merge-base\s+--is-ancestor\s+([0-9a-f]{4,40})\b/i;
const BARE_SHA_RE = /^[0-9a-f]{7,40}$/i;
const PYTHON_SCRIPT_RE = /^python3\s+(scripts\/\S+\.py(?:\s+\S+)*)$/;
const GREP_LITERAL_RE = /^grep\b.*"([^"]+)".*[ \t]([^\s"]+)\s*$/;
const BEAD_ID_RE = /^([a-z][a-z0-9]{0,9})-[a-z0-9]+(?:\.\d+)*$/i;
const BRANCH_RE = /^(?:origin\/)?worktree-[A-Za-z0-9._/-]+$/;
const REPO_PATH_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/;

const firstLine = (s) => String(s || '').trim().split('\n')[0];

/**
 * Every inline code span in `text`, classified into one of the four checkable shapes
 * or `unchecked`. Order matters — `git merge-base --is-ancestor …` is tried before the
 * bare-sha pattern, and the grep/path patterns are tried before falling through to
 * `unchecked`. Duplicates (the same span quoted twice) are collapsed to one claim.
 */
export function extractClaims(text, { beadPrefixes = [] } = {}) {
  const prefixes = new Set(beadPrefixes.map((p) => String(p).toLowerCase()));
  const claims = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(CODE_SPAN_RE)) {
    const raw = m[1].trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    let g;
    if ((g = raw.match(GIT_ANCESTOR_RE))) {
      claims.push({ shape: 'sha', raw, sha: g[1].toLowerCase() });
    } else if (BARE_SHA_RE.test(raw)) {
      claims.push({ shape: 'sha', raw, sha: raw.toLowerCase() });
    } else if ((g = raw.match(PYTHON_SCRIPT_RE))) {
      claims.push({ shape: 'script', raw, argv: g[1].split(/\s+/).filter(Boolean) });
    } else if ((g = raw.match(GREP_LITERAL_RE))) {
      claims.push({ shape: 'literal', raw, literal: g[1], file: g[2] });
    } else if ((g = raw.match(BEAD_ID_RE)) && prefixes.has(g[1].toLowerCase())) {
      claims.push({ shape: 'bead', raw, id: raw, prefix: g[1].toLowerCase() });
    } else if (BRANCH_RE.test(raw)) {
      claims.push({ shape: 'branch', raw, branch: raw });
    } else if (REPO_PATH_RE.test(raw)) {
      claims.push({ shape: 'path', raw, file: raw });
    } else {
      claims.push({ shape: 'unchecked', raw });
    }
  }
  return claims;
}

/** `HOLDS` if `claim.sha` is an ancestor of `ref` in `root`, `GONE` if not. */
export function checkShaClaim(root, claim, ref) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', claim.sha, ref], { cwd: root, stdio: 'pipe' });
    return { ...claim, verdict: 'HOLDS', detail: `${claim.sha} is an ancestor of ${ref}` };
  } catch (err) {
    if (err.status === 1) return { ...claim, verdict: 'GONE', detail: `${claim.sha} is not an ancestor of ${ref}` };
    return { ...claim, verdict: 'UNCHECKABLE', detail: `git merge-base failed: ${firstLine(err.stderr)}` };
  }
}

/** `HOLDS` if `claim.file` exists at `ref` in `root`, `GONE` if not. */
export function checkPathClaim(root, claim, ref) {
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}:${claim.file}`], { cwd: root, stdio: 'pipe' });
    return { ...claim, verdict: 'HOLDS', detail: `${claim.file} exists at ${ref}` };
  } catch {
    return { ...claim, verdict: 'GONE', detail: `${claim.file} does not exist at ${ref}` };
  }
}

/** `HOLDS` if `claim.literal` (tried as a regex, falling back to a literal substring) is
 * found in `claim.file` at `ref` in `root`; `GONE` if the file is missing or it is not. */
export function checkLiteralClaim(root, claim, ref) {
  let content;
  try {
    content = execFileSync('git', ['show', `${ref}:${claim.file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return { ...claim, verdict: 'GONE', detail: `${claim.file} does not exist at ${ref}` };
  }
  let found;
  try {
    found = new RegExp(claim.literal).test(content);
  } catch {
    found = content.includes(claim.literal);
  }
  return {
    ...claim,
    verdict: found ? 'HOLDS' : 'GONE',
    detail: found ? `"${claim.literal}" found in ${claim.file}` : `"${claim.literal}" not found in ${claim.file}`,
  };
}

/** `HOLDS` if the script exits 0 inside `worktreeDir`; `GONE` on any other exit; `UNCHECKABLE`
 * if it timed out or was killed — the exit status is not honest evidence either way then. */
export function checkScriptClaim(worktreeDir, claim, { timeoutMs = 300_000 } = {}) {
  try {
    execFileSync('python3', claim.argv, { cwd: worktreeDir, stdio: 'pipe', timeout: timeoutMs });
    return { ...claim, verdict: 'HOLDS', detail: `${claim.argv.join(' ')} — exit 0` };
  } catch (err) {
    if (err.signal) return { ...claim, verdict: 'UNCHECKABLE', detail: `${claim.argv.join(' ')} — killed by ${err.signal} (timeout)` };
    return { ...claim, verdict: 'GONE', detail: `${claim.argv.join(' ')} — exit ${err.status}` };
  }
}

/** `HOLDS` if the bead is still open work, `GONE` if closed or deferred. `row` is `bd show`'s
 * answer: `null`/absent means the tracker had no such bead, which is `UNCHECKABLE`. */
export function checkBeadClaim(claim, row) {
  if (!row) return { ...claim, verdict: 'UNCHECKABLE', detail: `${claim.id} could not be looked up in its tracker` };
  const status = String(row.status || '').toLowerCase();
  const until = row.defer_until || row.deferred_until || null;
  if (status === 'closed') {
    const why = firstLine(row.close_reason);
    return { ...claim, verdict: 'GONE', detail: `${claim.id} is closed${why ? ` — ${why}` : ''}` };
  }
  if (status === 'deferred' || (until && Date.parse(until) > Date.now())) {
    return { ...claim, verdict: 'GONE', detail: `${claim.id} is deferred${until ? ` until ${String(until).slice(0, 10)}` : ''}` };
  }
  return { ...claim, verdict: 'HOLDS', detail: `${claim.id} is ${status || 'open'}` };
}

const revOk = (root, rev) => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd: root, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

/** `HOLDS` if the branch exists with commits `ref` lacks; `GONE` if it is missing or has
 * nothing `ref` lacks. The evidence is the ahead/behind pair. */
export function checkBranchClaim(root, claim, ref) {
  const bare = claim.branch.replace(/^origin\//, '');
  const tip = [`refs/heads/${bare}`, `refs/remotes/origin/${bare}`].find((r) => revOk(root, r));
  if (!tip) return { ...claim, verdict: 'GONE', detail: `no branch ${claim.branch}, local or on origin` };
  try {
    const out = execFileSync('git', ['rev-list', '--left-right', '--count', `${ref}...${tip}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const [behind, ahead] = out.trim().split(/\s+/).map(Number);
    const pair = `${ahead} ahead / ${behind} behind ${ref}`;
    return ahead > 0
      ? { ...claim, verdict: 'HOLDS', detail: `${tip} is ${pair}` }
      : { ...claim, verdict: 'GONE', detail: `${tip} has nothing ${ref} lacks (${pair})` };
  } catch (err) {
    return { ...claim, verdict: 'UNCHECKABLE', detail: `git rev-list failed: ${firstLine(err.stderr)}` };
  }
}

/** The prompt of the plan group that names `beadId`, or `null`. `plan` is `lib/plan.js`'s
 * parsed plan (the epic's last `beadcause:plan` comment). */
export function groupPromptFor(plan, beadId) {
  const group = (plan?.groups || []).find((g) => (g.beads || []).includes(beadId));
  return group?.prompt ? { name: group.name, prompt: String(group.prompt) } : null;
}

/** The bead ids in `text` whose prefix is in `beadPrefixes`, minus `except` — what a caller
 * must look up before it can hand `checkPremise` its `beads` map. */
export function beadIdsIn(text, beadPrefixes, except = []) {
  return extractClaims(text, { beadPrefixes })
    .filter((c) => c.shape === 'bead' && !except.includes(c.id))
    .map((c) => c.id);
}

/**
 * Every claim in `text`, checked against `ref` in `root`. Script claims are the only
 * shape that needs a real checkout at `ref`, so a throwaway detached worktree is made
 * once, lazily, only when at least one is present, and always torn down before this
 * returns — including when a check throws.
 *
 * Returns `{ ref, results, exitCode }`. `exitCode` is `4` when every checkable claim
 * (every result whose verdict is not `UNCHECKABLE`) came back `HOLDS`, and there was at
 * least one — see the module header for why. `0` otherwise, including when nothing
 * checkable was found at all.
 */
export function checkPremise(root, text, { ref = 'origin/main', beadPrefixes = [], beads = new Map(), self = null } = {}) {
  const claims = extractClaims(text, { beadPrefixes }).filter((c) => !(c.shape === 'bead' && c.id === self));
  const needsWorktree = claims.some((c) => c.shape === 'script');
  let wt = null;
  const results = [];
  try {
    if (needsWorktree) wt = makeRefWorktree(root, ref);
    for (const claim of claims) {
      if (claim.shape === 'sha') results.push(checkShaClaim(root, claim, ref));
      else if (claim.shape === 'path') results.push(checkPathClaim(root, claim, ref));
      else if (claim.shape === 'bead') results.push(checkBeadClaim(claim, beads.get(claim.id)));
      else if (claim.shape === 'branch') results.push(checkBranchClaim(root, claim, ref));
      else if (claim.shape === 'literal') results.push(checkLiteralClaim(root, claim, ref));
      else if (claim.shape === 'script') results.push(checkScriptClaim(wt.dir, claim));
      else results.push({ ...claim, verdict: 'UNCHECKABLE', detail: 'not one of the checkable claim shapes' });
    }
  } finally {
    if (wt) removeRefWorktree(root, wt.dir, wt.scratchRoot);
  }
  const checked = results.filter((r) => r.verdict !== 'UNCHECKABLE');
  const allHold = checked.length > 0 && checked.every((r) => r.verdict === 'HOLDS');
  return { ref, results, exitCode: allHold ? 4 : 0 };
}

/** One printable line per result: `HOLDS  <shape>  <raw>  — <detail>`. */
export function describeResult(r) {
  const label = r.verdict.padEnd(11);
  return `${label} ${r.shape.padEnd(8)} \`${r.raw}\` — ${r.detail}`;
}

/** The one-line closing verdict `checkPremise`'s `exitCode` is derived from. */
export function verdictLine({ results, exitCode }) {
  const checked = results.filter((r) => r.verdict !== 'UNCHECKABLE');
  const holds = checked.filter((r) => r.verdict === 'HOLDS').length;
  const gone = checked.filter((r) => r.verdict === 'GONE').length;
  const uncheckable = results.length - checked.length;
  if (!results.length) return 'no checkable claims found in the bead\'s description or acceptance criteria';
  if (exitCode === 4) return `verdict: ${holds}/${checked.length} claim${checked.length === 1 ? '' : 's'} HOLD, nothing GONE — premise unchanged at the ref`;
  return `verdict: ${holds} HOLDS, ${gone} GONE, ${uncheckable} UNCHECKABLE — the bead's claims have moved since it was filed`;
}

/** True when `fs.existsSync` would agree there is nothing at all to check. */
export function isEmpty(outcome) {
  return !outcome || outcome.results.length === 0;
}
