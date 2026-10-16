/**
 * The pure half of `bin/b7e-config`: what a workspace resolves to, and what
 * `state.json`'s `answered` map records about a bead. Argv and printing stay in the
 * bin; this is the reading, so a test can drive it against a made-up `cfg`/`state`
 * with no filesystem or `bd` in the way.
 *
 * bc-dgx7.110 — three sessions each built their own one-off reader for a fact already
 * sitting behind `lib/config.js`'s exports. `workspaceRows` is nothing more than
 * `cfg.workspaces` (name, `.beads` dir) joined with the checkout root
 * `lib/session.js`'s `resolveSessionDir` already computes for opening a window there —
 * reused rather than re-derived, so this reports exactly what a session would actually
 * open in, including the same refusal a multi-repo or `projectRoot`-mismatched
 * workspace would give.
 */
import { resolveSessionDir } from './session.js';
import { answeredBefore } from './answered.js';

/**
 * Every configured workspace, with both directories a session cares about and never
 * the same string: `beadsDir` is `cfg.workspaces[].dir` (always ends in `.beads`),
 * `checkoutRoot` is what `resolveSessionDir` resolves that workspace to, or `null`
 * with `checkoutError` set to the refusal's own message — a workspace whose checkout
 * cannot be resolved is a real, reportable fact, not a reason to crash the listing.
 */
export function workspaceRows(cfg) {
  return (cfg.workspaces || []).map((w) => {
    let checkoutRoot = null;
    let checkoutError = null;
    try {
      checkoutRoot = resolveSessionDir(cfg, w);
    } catch (err) {
      checkoutError = String(err?.message || err);
    }
    return { name: w.name, beadsDir: w.dir, checkoutRoot, checkoutError };
  });
}

/**
 * What `state.json`'s `answered` map says about `beadId`, keyed `workspace/id` like
 * every other record there (see lib/answered.js).
 *
 * `wsName` given: the one key `${wsName}/${beadId}` is checked, whether or not that
 * name is a workspace this install currently has configured — the record is a fact
 * about a past write, not about today's config. `wsName` omitted: every configured
 * workspace's key is tried in turn and the first match wins; `checked` always lists
 * every key that was tried, so "no record" can say where it looked.
 *
 * Returns `{ workspace, key, record, checked }` — `workspace`/`key`/`record` are
 * `null` together for "no record found".
 */
export function answerFor(cfg, state, beadId, wsName = null) {
  const answered = state?.answered || {};
  const names = wsName ? [wsName] : (cfg.workspaces || []).map((w) => w.name);
  const checked = [];
  for (const name of names) {
    const key = `${name}/${beadId}`;
    checked.push(key);
    const record = answeredBefore(answered, key);
    if (record) return { workspace: name, key, record, checked };
  }
  return { workspace: null, key: null, record: null, checked };
}
