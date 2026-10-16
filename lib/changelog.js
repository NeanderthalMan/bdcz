/**
 * What is left of `lib/changelog.js` in beadcause: the two readers `lib/ruled.js`'s
 * CHANGE_LOG half (`findChangeLogRulings`) still imports, plus `fieldOf`, which
 * `lib/asof.js` (`b7e-asof`) reads — and nothing else.
 *
 * The rest — the delmar `CHANGE_LOG.md` entry parser behind `b7e-changelog`, `b7e-entry`,
 * `b7e-propagated` and `b7e-retired`, the G0 ledger re-derivation, the every-branch scan —
 * moved into the delmar repo with those tools (bc-j2zwo.4): beadcause itself never needed
 * them. This stub goes when `b7e-ruled` drops its CHANGE_LOG half and `b7e-asof` stops reading entries; it is kept rather than
 * inlined so that change is a deletion and not an edit to `lib/ruled.js`.
 */

/**
 * Every `## Entry NNN[letter]` heading in a `CHANGE_LOG.md` body, in the order they
 * appear, each with its own `body` — the heading through to just before the next one
 * (or EOF), trimmed — and `fingerprint`, its `**Decision:**` field alone, whitespace-
 * collapsed. The template line inside the file's own "Entry Format" section (`## Entry
 * [NNN] — [DATE]`) never matches — `[NNN]` has no digits where this looks for them.
 */
export function entryHeadings(text) {
  if (!text) return [];
  const out = [];
  const re = /^## Entry (\d+)([A-Za-z]?)\b/gm;
  let m;
  while ((m = re.exec(text))) {
    // `digits` keeps the original zero-padded spelling ("090") for display and for the
    // duplicate key; `number` is the numeric value, for maxNumber only — the two only
    // disagree on leading zeros, and next-free must never print one.
    out.push({ number: Number(m[1]), digits: m[1], suffix: m[2] || '', index: m.index });
  }
  for (let i = 0; i < out.length; i += 1) {
    const end = i + 1 < out.length ? out[i + 1].index : text.length;
    out[i].body = text.slice(out[i].index, end).trim();
    out[i].heading = out[i].body.split('\n', 1)[0];
    out[i].fingerprint = decisionFingerprint(out[i].body);
  }
  return out;
}

/**
 * The `**Decision:**` field alone, collapsed to single spaces — what an entry is
 * *for*, with the fields that drift as work lands (`Status:`'s running re-verification
 * narrative, `Chapters affected:`'s checkboxes) left out (the full argument, "Why not
 * compare the whole entry", moved with the rest of this module to delmar's
 * tools/d5a/lib/changelog.js). Falls back to the whole body for an entry that carries no `Decision:` field at
 * all — an older or hand-written format this template does not otherwise expect.
 */
export function decisionFingerprint(body) {
  const m = /\*\*Decision:\*\*\s*([\s\S]*?)(?:\n\*\*|$)/.exec(body);
  return (m ? m[1] : body).replace(/\s+/g, ' ').trim();
}

/**
 * One `**Field:**` line's own text, e.g. `fieldOf(body, 'Type')` for `**Type:**
 * Retcon`. Single-line only, like every field this template writes except
 * `Decision:` (which gets its own multi-line-aware `decisionFingerprint` above). Kept
 * here, not moved, because `lib/asof.js` reads it (bc-xl7n.153).
 */
export function fieldOf(body, name) {
  const re = new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, 'm');
  const m = re.exec(body);
  return m ? m[1].trim() : null;
}
