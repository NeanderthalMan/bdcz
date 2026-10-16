/**
 * Which beads a pull request is *for* — the one implementation of that question.
 *
 * This was private to lib/prboard.js, where it answers "what is this row about?" for a
 * screen. lib/landed.js then needed the identical question for a very different
 * purpose: a pull request merged on github.com closes nothing here, so something has
 * to walk the merged ones and close the beads behind them. Two implementations of
 * "which bead is this PR for" is the worst possible way to hold that, because the
 * screen would say one thing and the sweep would close another — so it lives here,
 * with the same reasoning it always had, and both import it.
 *
 * The reasoning that matters is the tiering. A delivery whose body ended "nothing was
 * done about bc-2tr / bc-es8 / bc-dmt, which this unblocks" came back linked to four
 * beads, three of which it explicitly had not touched. All four exist, so verifying
 * against the tracker cannot separate them — only *where they were written* can. That
 * mattered on a board; it matters far more now that the answer decides what gets
 * closed.
 */

/** `bc` for the beadcause workspace. Prefixes never change, so this is asked once. */
const prefixes = new Map();

export async function prefixFor(bd, ws) {
  if (prefixes.has(ws.name)) return prefixes.get(ws.name);
  let prefix = null;
  try {
    const rows = await bd.json(ws, ['list', '--limit', '1']);
    const found = String(rows?.[0]?.id || '').split('-')[0];
    // Checked rather than trusted: this string is interpolated into three regexes
    // below, and a prefix is a short word by construction. A tracker that ever
    // returned something else should produce no matches, not a pattern.
    prefix = /^[a-z0-9]{1,10}$/i.test(found) ? found : null;
  } catch {
    // A workspace whose database is mid-write has no prefix this tick. Not cached —
    // an unreadable tracker is a passing state and the next sweep should ask again.
    return null;
  }
  if (prefix) prefixes.set(ws.name, prefix);
  return prefix;
}

/** For tests, and for anything that knows a workspace's tracker was replaced. */
export const forgetPrefixes = () => prefixes.clear();

/**
 * Ids this pull request might be *for*, in tiers — and only one tier is ever used.
 *
 * A bead named in the `beadpr` block, in the title, or by the branch's own tag is a
 * bead this PR is **for**. Anything else in the body is a bead it *mentions*, and
 * mentions are used only when nothing stronger is there — which is the hand-opened PR
 * whose body says "fixes bc-x" and nothing else does.
 */
export function candidateTiers(row, prefix) {
  if (!prefix) return [];
  /**
   * A bead id, **including its dotted child suffix** — bc-68ou.10.
   *
   * Without `(?:\.\d+)*` this stopped at the first dot, so every child id written in a
   * title came back as its **parent**: `bc-68ou.6: …` resolved to `bc-68ou`, a P0 epic.
   * The `bead:` block below never had the bug — it captures `\S+` and keeps the dots — so
   * a delivery's own pull request produced *both* forms in one tier (`['bc-68ou.6',
   * 'bc-68ou']`), the right bead and the epic above it, and everything downstream took
   * them as equally strong claims.
   *
   * That was invisible for as long as nothing acted on the second one. lib/landed.js
   * escaped it only by a guard further down — `closeGate` refuses to close an epic on a
   * merge reason — and lib/release.js's `homeOf` escaped it because the parent of a child
   * and the parent of its epic are usually the same P0. What made it visible was labelling:
   * `shipped` has no such guard, so the first real sweep marked seven P0 epics as shipped
   * because one child of each had merged.
   *
   * `\d+` and not `[a-z0-9]+`, because a suffix is a number — `bc-rfnr.9.3` is real and
   * nests, so the group repeats.
   */
  const re = new RegExp(`\\b${prefix}-[a-z0-9]{2,10}(?:\\.\\d+)*\\b`, 'gi');
  const idsIn = (text) => [...String(text || '').matchAll(re)].map((m) => m[0].toLowerCase());

  const body = String(row.body || '');

  // `bead: bc-jin` inside the block lib/delivery.js writes — the one place in this
  // whole codebase where a PR states outright which bead it delivers. Its own tier,
  // above everything else: a title or branch naming a *second* bead — "bc-khoe.30.6:
  // Rewrite bc-khoe.4" is exactly this shape — is a bead that PR is *about*, not one it
  // delivers, and putting it in the same tier as the declaration handed it an equally
  // strong claim. That closed bc-khoe.4 off a documentation-only merge (bc-khoe.30.16).
  const declaredMatch = body.match(/^[ \t]*bead:[ \t]*(\S+)[ \t]*$/m)?.[1];
  const declared =
    declaredMatch && new RegExp(`^${prefix}-`, 'i').test(declaredMatch) ? [declaredMatch.toLowerCase()] : [];

  const named = new Set();
  for (const id of idsIn(row.title)) named.add(id);
  for (const id of idsIn(row.branch)) named.add(id);

  // The worktree convention: `worktree-launcher-repo-tabs-jin` ends in the bead's own
  // suffix, because that is where the tag comes from. Its own tier, below the ids that
  // were actually written out: on a branch called `some-branch` this guesses
  // `<prefix>-branch`, and a guess that fails must fall through to the body rather
  // than counting as an answer and stopping the search.
  const tail = String(row.branch || '').split('-').pop();
  const guess = tail && /^[a-z0-9]{2,10}$/i.test(tail) ? [`${prefix}-${tail}`.toLowerCase()] : [];

  // Last: the body — but only where it *claims* a bead rather than mentioning one.
  // "Fixes bc-x" is a claim; "nothing was done about bc-x, which this unblocks" is
  // not, and an open pull request on this board carried three of the second kind. So
  // this tier reads the verb, not just the id: no verb, no link, and the row says
  // "no bead named", which is the truth about a pull request nobody tied to one.
  const claim = new RegExp(
    `\\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|deliver(?:s|ed|ing)?|implement(?:s|ed)?|for|bead)\\b[:\\s]+` +
      // Same dotted suffix as `re` above, and for the same reason: "fixes bc-68ou.6" is a
      // claim on the child, and reading it as a claim on the epic is the one mistake this
      // whole file exists to avoid.
      `(?:issue\\s+)?(${prefix}-[a-z0-9]{2,10}(?:\\.\\d+)*)\\b`,
    'gi'
  );
  const claimed = [...new Set([...body.slice(0, 8000).matchAll(claim)].map((m) => m[1].toLowerCase()))].slice(0, 2);

  return [declared, [...named].slice(0, 4), guess, claimed].filter((t) => t.length);
}

/**
 * Which beads a pull request is for — verified against the tracker, never guessed.
 *
 * `seen` is the caller's own memo. Half a dozen PRs mentioning the same bead is normal
 * (a delivery, its follow-up, the bead that discovered both), and asking `bd` again
 * for each is the difference between a board that loads and one you wait for.
 *
 * **`live: true` forces every candidate through `bd show`** — the shape this had before
 * bc-iaju1.10, and the one a *writer* has to ask for. See `resolve` below for which
 * readers are allowed a snapshot and why this one is not.
 */
export async function beadsFor(bd, ws, prefix, row, seen, { live = false } = {}) {
  for (const tier of candidateTiers(row, prefix)) {
    const found = await resolve(bd, ws, tier, seen, live);
    // The first tier that resolves to anything wins outright. A weaker tier is only
    // ever consulted because the stronger one turned out to name nothing real.
    if (found.length) return found;
  }
  return [];
}

/**
 * The key `indexFor` parks the workspace's whole shape under, inside the caller's `seen`.
 *
 * It cannot collide with a bead's key: every other entry is `${ws.name}/${id}` where `id`
 * came out of a `<prefix>-…` regex in `candidateTiers`, so no real id can ever spell this.
 */
const INDEX_KEY = '__index__';

/**
 * This workspace's whole shape, asked once per sweep — the shared read bc-iaju1.10 is about.
 *
 * `Bd.graph` is one `bd export` per workspace, memoised for a minute and already taken at
 * the top of every poll cycle by lib/adoptsweep.js. So on the ordinary tick this costs
 * *nothing at all*: the sweep that runs before this one has already paid for it, and what
 * comes back is a Map from id to `{ id, title, status, … }` — which is, field for field,
 * what `resolve` was spawning a `bd show` per candidate to find out.
 *
 * Memoised into the caller's own `seen` rather than asked per row, for the reason the bead
 * memo below gives: a board resolves every repo's pull requests concurrently, so a settled
 * value would let a dozen rows all miss and all ask. `Bd.graph` has an in-flight map of its
 * own that would catch that, but a sweep should not depend on another module's coalescing
 * to avoid a stampede it can trivially not start.
 *
 * `null` when the tracker adapter has no `graph` — the test stubs, which hand in a bare
 * object with a `show` on it — so those keep the old path exactly.
 */
function indexFor(bd, ws, seen) {
  if (typeof bd?.graph !== 'function') return Promise.resolve(null);
  const key = `${ws.name}/${INDEX_KEY}`;
  // `.catch(() => null)` and not a throw: an export that failed means this sweep pays the
  // old price, which is the behaviour it had for its whole life. It must never mean a board
  // that does not draw.
  if (!seen.has(key)) seen.set(key, Promise.resolve(bd.graph(ws)).catch(() => null));
  return seen.get(key);
}

/**
 * Ask the tracker about one tier's ids, memoised across the whole sweep.
 *
 * **Where the answer comes from, and who is allowed a stale one — bc-iaju1.10.**
 *
 * This function was the single most expensive thing the daemon did. Traced over a real
 * poll cycle on this Mac, `bd show <id> --json` from here was **145 of 334** `bd` spawns
 * and **326 of 446 seconds** of `bd` wall time — 73% of the whole subprocess bill — split
 * between lib/prboard.js (the board, one resolve per pull request per sweep) and
 * lib/inflight.js (every advocate, every tick, re-resolving the same open pull requests
 * with a fresh `seen` each time). Every one of those was a fresh `bd` process against a
 * single-writer embedded Dolt, so they did not merely cost their own time, they queued
 * behind each other: the average was 2.2 seconds for a read that answers in ~90ms idle.
 *
 * The index has all of it. `bd export` carries every issue the tracker has, **closed ones
 * included** (2,315 of 2,728 rows in the beadcause workspace are closed), and
 * `indexFrom` keeps `id`, `title` and `status` — exactly the three fields this returns.
 *
 * **A hit is trusted; a miss still spawns.** That asymmetry is the whole safety argument
 * and it is deliberate. The index is up to sixty seconds old, so the one thing it can get
 * wrong in the *negative* direction is a bead created inside that minute — and answering
 * "no such bead" for one would drop a tier and let a weaker tier win, which is the class of
 * mistake this entire file exists to avoid. So a candidate the index does not know is asked
 * about exactly as it always was. The cost of that is one spawn per bogus candidate (a
 * `guess` tier built off a branch tail that is not a bead), which is the rare case: almost
 * every id reaching here was written into a PR title by lib/delivery.js and is real.
 *
 * **What a hit can still get wrong is `status`, and that is why `live` exists.**
 * Identity — does `bc-x` exist, and what is it called — does not change; a bead closed
 * thirty seconds ago is still the same bead. `status` does change, and there is exactly one
 * caller that turns it into a write: lib/landed.js skips a candidate whose status is
 * `closed` and otherwise closes it on the merge. A minute-stale `open` there would send it
 * to `closeGate` for a bead already closed, and a minute-stale `closed` would silently skip
 * a close it owed. Both are recoverable, and neither is a risk worth taking for a sweep that
 * did not show up in the trace at all — so lib/landed.js passes `live: true` and keeps its
 * own spawns.
 *
 * The readers that are allowed to be stale, and why:
 *   - **lib/prboard.js** draws a screen. `beads[]` there is a row's deep-link, its chip and
 *     the id lib/autoship.js matches an epic against; nothing on that path writes off the
 *     `status` field, and the board's own cache already hands the phone a reading tens of
 *     seconds old by design.
 *   - **lib/inflight.js** holds a bead back from an advocate because an open pull request is
 *     already carrying it. It reads `bead.id` and nothing else, so only the *negative*
 *     direction could hurt it — and the fallback above is what closes that.
 *
 * **One writer reads this second-hand and it was checked rather than assumed.**
 * lib/release.js's `markShipped` takes `row.beads` off a board row — deliberately, because
 * a second resolver is what this file's header refuses — and turns it into a `shipped`
 * label on each id. That is a write off a snapshot, and it is sound for the same narrow
 * reason lib/inflight.js is: it reads `id` and never `status`, and an id is not a fact a
 * minute changes. The one thing a snapshot could hand it that the tracker would not is a
 * bead **deleted** in the last minute, where the label write fails against a bead that is
 * gone and the sweep reports it. Anything in that file that ever starts branching on
 * `status` needs `live: true`, exactly as lib/landed.js does.
 */
async function resolve(bd, ws, ids, seen, live = false) {
  // Asked once, before the loop, rather than per id: a tier is up to four ids and they all
  // want the same index. `live` never asks at all — see the note above.
  const index = live ? null : await indexFor(bd, ws, seen);
  const rows = index?.beads || null;
  const out = [];
  for (const id of ids) {
    const row = rows?.get(id);
    if (row) {
      // The three fields `bd show` was spawned for, rebuilt rather than passed through, so a
      // caller can never reach into the shared index and mutate it — `Bd.graph` hands every
      // reader the same object for a minute.
      out.push({ id: row.id, title: row.title || '', status: row.status || '' });
      continue;
    }
    const key = `${ws.name}/${id}`;
    // The *promise* is memoised, not the answer. Every repo's pull requests are
    // resolved concurrently, so two rows naming the same bead reach this within a
    // tick of each other — caching the settled value would let both miss and both
    // ask, which is the case the memo exists for.
    if (!seen.has(key)) {
      seen.set(
        key,
        bd
          .show(ws, id)
          .then((b) => (b ? { id: b.id, title: b.title || '', status: b.status || '' } : null))
          .catch(() => null)
      );
    }
    const bead = await seen.get(key);
    if (bead) out.push(bead);
  }
  return out;
}
