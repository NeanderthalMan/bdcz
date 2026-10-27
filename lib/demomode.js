import http from 'node:http';

import { verdictOf } from './candidate.js';

/**
 * DemoMode's list — bc-sj8k.2. Which pull requests can be tried on green, what each one is,
 * and which one is standing there now.
 *
 * ## Only this app's own pull requests
 *
 * A candidate is served by bin/router.js spawning `<candidate>/bin/beadcause.js` beside the
 * live backend (bc-sj8k.1). That is a beadcause backend, so the only pull requests that can
 * be put on green are beadcause's own: a sorrel pull request has no `bin/beadcause.js` in
 * it, and listing it would offer a tap that can only be refused. So the list is the one
 * board card whose checkout is the checkout this daemon runs from, and nothing else.
 *
 * ## Every open pull request, prepared or not
 *
 * The acceptance is "every open candidate appears", and a candidate does not exist on disk
 * until something prepares one — preparing is a fetch, a worktree and a vendor copy, far
 * too much to do for every pull request on the off chance. So a row is an *open pull
 * request*, and the prepared candidate is joined onto it when there is one. The tap is what
 * prepares it (lib/candidate.js's `prepareCandidate`), then asks the router to stand it up.
 *
 * Nothing here decides a verdict: the gate is lib/candidate.js's `verdictOf` over the
 * board's row, which is lib/prstage.js's ladder and GitHub's own check rollup.
 */

/** The fields a card needs, and nothing a phone has to scroll past. */
function rowOf(pr, record, green, deploys) {
  const verdict = verdictOf(pr, deploys);
  const head = String(pr.headSha || '').toLowerCase();
  const prepared = record
    ? {
        id: record.id,
        // A record for an older head is about to be replaced by the tap, so it is not this
        // pull request's candidate — the card says "not prepared", not "ready".
        current: record.headSha === head,
        servable: record.servable === true,
        unservable: record.unservable || null,
        behind: Boolean(record.behind),
        preparedAt: record.preparedAt || null,
      }
    : null;
  return {
    number: pr.number,
    title: pr.title || '',
    url: pr.url || '',
    branch: pr.branch || '',
    head: head.slice(0, 12),
    draft: Boolean(pr.draft),
    stage: verdict.stage,
    gate: verdict.gate,
    failed: verdict.failed,
    checks: verdict.total,
    beads: (pr.beads || []).map((b) => ({ id: b.id, title: b.title || '' })),
    additions: Number(pr.additions) || 0,
    deletions: Number(pr.deletions) || 0,
    files: Number(pr.files) || 0,
    createdAt: pr.createdAt || null,
    updatedAt: pr.updatedAt || null,
    candidate: prepared,
    onGreen: Boolean(green && prepared && prepared.current && green.id === prepared.id),
  };
}

/**
 * The list, in the order it is drawn.
 *
 * `card` is the board card for this app's repo (lib/prboard.js), or null when there is none.
 * `records` is `listCandidates` for the same checkout. `green` is the router's `green`
 * (null when nothing is standing, or when there is no router). `from` is the candidate id a
 * device has just come back from — `/__demo/blue` puts it on the address — and that one is
 * drawn first, because the return trip exists to land you on the thing you were just using.
 * After it, whatever is on green; after that, most recently touched first.
 */
export function demoRows({ card = null, records = [], green = null, from = '', deploys = [] } = {}) {
  const byNumber = new Map();
  for (const r of records) if (!byNumber.has(r.number)) byNumber.set(r.number, r);
  const open = (card?.prs || []).filter((p) => p.state === 'OPEN');
  const rows = open.map((p) => rowOf(p, byNumber.get(p.number) || null, green, deploys));
  const rank = (r) => (from && r.candidate?.id === from ? 0 : r.onGreen ? 1 : 2);
  return rows.sort(
    (a, b) => rank(a) - rank(b) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || b.number - a.number
  );
}

/**
 * Ask the router in front of this backend one of its control questions — the same loopback
 * and token lib/service.js's `routerHealth` uses, for the reason given there. Resolves to the
 * parsed body, or null when nothing answered as the router: under `npm run start:bare` there
 * is no router, and green does not exist without one.
 */
export function askRouter(cfg, pathname, { method = 'GET', timeout = 1500 } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port: cfg.port, path: pathname, method, headers: { 'x-beadcause-token': cfg.token } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.setTimeout(timeout, () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

/**
 * Stand candidate `id` up on green. Resolves `{ ok, green, error }`; `error` is a sentence
 * for the card. A bring-up is a process start and a health check, so it is given the
 * minutes the router itself gives one rather than the second and a half a state read gets.
 */
export async function standOnGreen(cfg, id, { timeout = 5 * 60 * 1000 } = {}) {
  const said = await askRouter(cfg, `/internal/router/green?id=${encodeURIComponent(id)}`, { method: 'POST', timeout });
  if (!said) return { ok: false, green: null, error: 'no router answered — green only exists behind bin/router.js' };
  return { ok: Boolean(said.ok), green: said.green || null, error: said.ok ? null : said.error || 'the router refused' };
}

/**
 * Everything behind one candidate — bc-sj8k.4. The card is the summary; this is the evidence
 * for when the summary is not enough to approve on: the beads it came from and their
 * threads, the pull request and its checks, the local gate runs on its head, the coverage
 * of the files it changes, and the sessions that did the work.
 *
 * ## Composed, never swept
 *
 * Every half of this already exists somewhere and is read from there: the board row
 * (lib/prboard.js — state and GitHub's check rollup, so no `gh` call of its own), the
 * tracker (`bd show --include-comments`), the session archive (lib/sessionlog.js), the live
 * session records (lib/claude.js), the gate-run records (lib/gaterun.js) and the coverage
 * report (lib/coverage.js). The route hands those in as `readers`, which is what lets this
 * be tested without any of them.
 *
 * ## Unknown versus none
 *
 * The acceptance is "nothing shown as unknown when it is knowable, and nothing invented
 * where it is not", so every section says *which* it is. A reader that throws comes back as
 * an error on that section alone — a tracker that would not answer must not read as a bead
 * with no thread — and an empty list means somebody looked and there was nothing.
 *
 * Two that are easy to overclaim, and are not:
 *
 * - **A gate run is matched to the branch by its file name**, which is the worktree slug —
 *   `worktree-<slug>` is the branch every session here pushes. A run is only `onHead` when
 *   the commit it recorded *is* this head; older ones are listed and marked, because "the
 *   last gate ran on the commit before" is evidence too, just not the same evidence.
 * - **The coverage report is about whatever tree last ran `npm run coverage`**, not this
 *   candidate. `onHead` says whether it is this one; when it is not, the files are still
 *   joined against it (a file nothing imports is rarely made imported by one commit), and
 *   the page says which commit it measured.
 */
export const HISTORY_LIMITS = { beads: 6, comments: 30, text: 1200, sessions: 8, runs: 5 };

/** One comment as the panel draws it, cut to a phone's patience — and said to be cut. */
function bubbleOf(c, max) {
  const text = String(c?.text ?? '');
  return {
    author: String(c?.author || ''),
    at: c?.created_at || c?.at || null,
    text: text.length > max ? `${text.slice(0, max).trimEnd()}…` : text,
    cut: text.length > max,
  };
}

/** The slug a branch's gate runs are filed under — see lib/gaterun.js's `worktreeSlug`. */
export function slugOfBranch(branch) {
  const b = String(branch || '');
  return b.startsWith('worktree-') ? b.slice('worktree-'.length) : '';
}

async function settle(fn) {
  try {
    return { value: await fn() };
  } catch (err) {
    return { error: String(err?.message || err).split('\n')[0] };
  }
}

/**
 * `row` is the board's pull request; `record` the prepared candidate for it, or null.
 * `readers` are all optional, and a missing one is a section the page says it cannot read:
 *
 * - `bead(id)` → bd's own show shape, comments included
 * - `archive(id)` → `{ sessions: [{ commit, at, subject }] }` (lib/sessionlog.js `readArchive`)
 * - `live()` → lib/claude.js `liveSessions` rows, and `namesBead(name, id)` to pick them
 * - `gateRuns(slug)` → lib/gaterun.js `readRun` summaries, newest first
 * - `changedFiles(row)` → the paths the pull request changes, or null when this machine
 *   does not have its head
 * - `coverage()` → lib/coverage.js's report, or null when none has been measured, and
 *   `coverageFor(report, paths)` → its `coverageForFiles`
 */
export async function demoHistory({ row, record = null, readers = {}, limits = HISTORY_LIMITS } = {}) {
  const head = String(row?.headSha || '').toLowerCase();
  const c = row?.checks || null;

  // Once for every bead: it is a directory read, and the beads of one pull request are few.
  const liveGot = readers.live ? await settle(() => readers.live()) : { error: 'live sessions are not readable here' };
  const named = readers.namesBead || (() => false);
  const beads = [];
  // One after another, not overlapped — lib/bd.js's `showWithComments` has the measurement:
  // two embedded-Dolt reads at once cost about what two in a row do.
  for (const b of (row?.beads || []).slice(0, limits.beads)) {
    const out = { id: b.id, title: b.title || '', status: b.status || null };
    const shown = readers.bead ? await settle(() => readers.bead(b.id)) : { error: 'the tracker is not readable here' };
    if (shown.error || !shown.value) out.threadError = shown.error || 'the tracker has no bead by that id';
    else {
      const s = shown.value;
      out.title = s.title || out.title;
      out.status = s.status || out.status;
      out.closeReason = s.close_reason || null;
      const all = Array.isArray(s.comments) ? s.comments : [];
      out.comments = all.length;
      // The newest, because a thread grows at its end and the end is where it stands.
      out.thread = all.slice(-limits.comments).map((x) => bubbleOf(x, limits.text));
    }
    const arch = readers.archive ? await settle(() => readers.archive(b.id)) : { error: 'the session archive is not readable here' };
    if (arch.error) out.sessionsError = arch.error;
    else {
      out.sessions = (arch.value?.sessions || [])
        .slice(0, limits.sessions)
        .map((x) => ({ commit: x.commit, at: x.at || null, subject: x.subject || '' }));
    }
    if (liveGot.error) out.liveError = liveGot.error;
    else {
      out.live = (liveGot.value || [])
        .filter((s) => named(s.name, b.id))
        .map((s) => ({ pid: s.pid, name: s.name, status: s.status || '', at: s.at || null }));
    }
    beads.push(out);
  }

  let gates;
  const slug = slugOfBranch(row?.branch);
  if (!slug) gates = { known: false, why: `${row?.branch || 'its branch'} is not a worktree branch, so no local gate run is filed under it` };
  else if (!readers.gateRuns) gates = { known: false, why: 'gate runs are not readable here' };
  else {
    const got = await settle(() => readers.gateRuns(slug));
    if (got.error) gates = { known: false, why: got.error };
    else {
      gates = {
        known: true,
        slug,
        runs: (got.value || []).slice(0, limits.runs).map((r) => ({
          runId: r.runId,
          status: r.status,
          running: Boolean(r.running),
          done: r.done ?? null,
          total: r.total ?? null,
          failed: (r.failed || []).slice(0, 8),
          startedAt: r.startedAt || null,
          endedAt: r.endedAt || null,
          elapsedSeconds: r.elapsedSeconds ?? null,
          sha: r.sha ? String(r.sha).slice(0, 12) : null,
          onHead: Boolean(r.sha && head && String(r.sha).toLowerCase() === head),
        })),
      };
    }
  }

  let coverage;
  const paths = readers.changedFiles ? await settle(() => readers.changedFiles(row)) : { error: 'the changed files are not readable here' };
  if (paths.error || !paths.value) {
    coverage = {
      known: false,
      why: paths.error || `this machine does not have ${head.slice(0, 12) || 'its head'} yet — trying it on green fetches it`,
    };
  } else {
    const report = readers.coverage ? await settle(() => readers.coverage()) : { error: 'the coverage report is not readable here' };
    if (report.error || !report.value) {
      coverage = { known: false, why: report.error || 'no coverage has been measured — npm run coverage writes it', changed: paths.value.length };
    } else {
      const projected = (readers.coverageFor || ((_, p) => ({ files: [], untested: [], outOfScope: p })))(report.value, paths.value);
      const commit = String(report.value.commit || '').toLowerCase();
      coverage = {
        known: true,
        onHead: Boolean(commit && commit === head),
        commit: commit ? commit.slice(0, 12) : null,
        generated: report.value.generated || null,
        changed: paths.value.length,
        untested: projected.untested || [],
        outOfScope: projected.outOfScope || [],
        files: (projected.files || []).map((f) => ({
          path: f.path,
          loaded: f.loaded ?? null,
          functions: f.functions || null,
          uncovered: (f.uncovered || []).slice(0, 8),
        })),
      };
    }
  }

  return {
    number: row?.number ?? null,
    title: row?.title || '',
    url: row?.url || '',
    state: row?.state || null,
    draft: Boolean(row?.draft),
    branch: row?.branch || '',
    base: row?.base || '',
    head: head.slice(0, 12),
    candidate: record
      ? { id: record.id, current: record.headSha === head, preparedAt: record.preparedAt || null, behind: Boolean(record.behind) }
      : null,
    checks: c
      ? {
          state: c.state || 'none',
          total: Number(c.total) || 0,
          passing: Number(c.passing) || 0,
          failing: Number(c.failing) || 0,
          pending: Number(c.pending) || 0,
          failed: Array.isArray(c.failed) ? c.failed.slice() : [],
          failedUrls: Array.isArray(c.failedUrls) ? c.failedUrls.slice() : [],
          at: c.at || null,
        }
      : null,
    gates,
    coverage,
    beads,
  };
}
