#!/usr/bin/env node
/**
 * Is the daemon answering on this Mac serving the commit a promotion just deployed?
 *
 *     node scripts/serving.mjs <commit>
 *
 * The check beadcause declares for its own deploy (`servingCheck` in lib/deploy.js), run by
 * the single-environment driver with `{image}` filled in. Without it a beadcause promotion
 * ends cannot-say, because a green `launchctl kickstart` says nothing about which commit
 * came back up — bc-rfnr.9.13.
 *
 * It **waits**, because it runs straight after the restart it is checking: the router is
 * refusing connections, or answering while the backend behind it is still coming up, for
 * some seconds. It polls `/api/health` on loopback until `commit` matches or the deadline
 * passes.
 *
 *   exit 0  the daemon reported the commit that was asked for
 *   exit 1  it never did — not answering, answering without a commit, or answering as a
 *           different one. All three are the same finding: the release that went out is not
 *           demonstrably the one running.
 *   exit 2  no commit was given (or `{image}` reached here unexpanded), so nothing was asked
 *
 * `/api/health`'s `commit` is HEAD of the checkout at the moment the backend booted, not the
 * router's build id (a bundle hash that does not move when only a comment does) and not the
 * deploy record's `to` (what the runner fast-forwarded to, which is the very thing being
 * checked against). See `headCommit` in lib/deploy.js.
 */
import { pathToFileURL } from 'node:url';

export const DEADLINE_MS = 60000;
const EVERY_MS = 1000;
const ASK_MS = 3000;

/** Do two commit ids name the same one? Full ids, or one an abbreviation of the other (7+). */
export function sameCommit(a, b) {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(x) || !/^[0-9a-f]{7,64}$/.test(y)) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/**
 * Poll until the daemon reports `want`. Never throws: `{ ok, detail }`.
 *
 * Every side effect is a parameter so test/serving.mjs can drive it with a fake clock.
 */
export async function waitForCommit(base, want, { get = ask, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, deadlineMs = DEADLINE_MS } = {}) {
  const stop = now() + deadlineMs;
  let last = 'the daemon did not answer';
  for (;;) {
    const got = await get(`${base}/api/health`);
    if (got.error) last = `the daemon did not answer (${got.error})`;
    else if (!got.commit) last = 'the daemon answered without reporting a commit — it is running code from before /api/health carried one';
    else if (sameCommit(got.commit, want)) return { ok: true, detail: `the daemon is serving ${got.commit}` };
    else last = `the daemon is serving ${got.commit}, not ${want}`;
    if (now() >= stop) return { ok: false, detail: last };
    await sleep(EVERY_MS);
  }
}

/** One read of a health URL: `{ commit }` or `{ error }`. */
async function ask(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ASK_MS) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    return { commit: typeof body?.commit === 'string' ? body.commit : null };
  } catch (err) {
    return { error: String(err?.cause?.code || err?.message || err).split('\n')[0] };
  }
}

async function main(argv) {
  const want = argv[0] || '';
  if (!sameCommit(want, want)) {
    console.error(`serving: needs the commit to look for as its one argument, got ${JSON.stringify(want)}`);
    return 2;
  }
  // Loaded here and not at the top, so the pure half above imports nothing.
  const { loadConfig } = await import('../lib/config.js');
  const { localBaseUrl } = await import('../lib/tls.js');
  const { ok, detail } = await waitForCommit(localBaseUrl(loadConfig()), want);
  (ok ? console.log : console.error)(`serving: ${detail}`);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
