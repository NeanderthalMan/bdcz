/**
 * A three-way merge of two JSON documents by structure, key by key — bc-g95u9.
 *
 * This is what `package.json` and `package-lock.json` are merged with locally, through the
 * `jsonmerge` git driver `scripts/jsonmerge.mjs` installs. They used to be `merge=union`,
 * and union is a line-level answer to a key-level question. It gets two cases wrong, and
 * both were found the same afternoon (2026-10-23, bc-np9k5), in resolutions that reported
 * clean:
 *
 * - **It undoes a deletion.** Main removed `b7e-renum` (bc-j2zwo.4); #40's branch still had
 *   the line, so "keep both sides" kept it, and test/tooldecl.mjs failed on a bin entry
 *   with no file behind it.
 * - **It interleaves two orderings into something that is not JSON.** #4's branch had
 *   re-sorted the bin map, and union stitched the two versions together line by line into
 *   a package.json nothing could parse.
 *
 * Here each side is parsed and compared against the common ancestor, one key at a time:
 * a key only one side changed takes that side's value, a deletion counts as a change, and
 * a key both sides changed to the same thing is no question at all. Objects are merged
 * recursively; arrays and scalars are atomic, because neither file has an array whose
 * elements two branches would each append to. What is left — both sides changing one key
 * to two different values — is a real conflict, and it is returned as one rather than
 * picked, so the driver can fall back to git's own text merge and leave markers for a
 * person to read.
 *
 * Key order follows ours, with keys only theirs added slotted in sorted position when the
 * object they land in is already sorted (the bin map is) and after their predecessor in
 * theirs when it is not. The output is re-serialised in the indentation ours used, so a
 * clean merge of two well-formed files is itself well-formed by construction.
 */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Structural equality over parsed JSON; `undefined` stands for "absent". */
export function same(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  return false;
}

const isSorted = (keys) => keys.length > 1 && keys.every((k, i) => i === 0 || keys[i - 1] < k);

/**
 * Order the merged object's keys: ours first, in ours' order, then each key only theirs
 * has, placed where it belongs.
 */
function order(merged, ours, theirs) {
  const result = Object.keys(ours).filter((k) => Object.hasOwn(merged, k));
  const sorted = isSorted(Object.keys(ours));
  const theirsKeys = Object.keys(theirs);
  for (const k of theirsKeys) {
    if (!Object.hasOwn(merged, k) || result.includes(k)) continue;
    let at = result.length;
    if (sorted) {
      const i = result.findIndex((r) => r > k);
      if (i > -1) at = i;
    } else {
      for (let j = theirsKeys.indexOf(k) - 1; j >= 0; j -= 1) {
        const i = result.indexOf(theirsKeys[j]);
        if (i > -1) {
          at = i + 1;
          break;
        }
      }
    }
    result.splice(at, 0, k);
  }
  for (const k of Object.keys(merged)) if (!result.includes(k)) result.push(k);
  const out = {};
  for (const k of result) out[k] = merged[k];
  return out;
}

/**
 * Merge `ours` and `theirs` against `base`, all three parsed. Returns `{ value, conflicts }`
 * where `conflicts` is the list of dotted key paths both sides changed differently; when it
 * is non-empty `value` must not be used. `base` may be `undefined` (the file is new on both
 * sides), in which case every disagreement is a conflict.
 */
export function mergeValues(base, ours, theirs, at = '') {
  if (same(ours, theirs)) return { value: ours, conflicts: [] };
  if (same(base, ours)) return { value: theirs, conflicts: [] };
  if (same(base, theirs)) return { value: ours, conflicts: [] };
  if (!isObject(ours) || !isObject(theirs)) return { value: undefined, conflicts: [at || '(root)'] };

  const b = isObject(base) ? base : {};
  const merged = {};
  const conflicts = [];
  const keys = new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(b)]);
  for (const k of keys) {
    const r = mergeValues(b[k], ours[k], theirs[k], at ? `${at}.${k}` : k);
    conflicts.push(...r.conflicts);
    if (r.value !== undefined) merged[k] = r.value;
  }
  return { value: order(merged, ours, theirs), conflicts };
}

/** The indentation a JSON text was written with: a tab, or a number of spaces (2 if unsure). */
export function indentOf(text) {
  const m = /\n([ \t]+)"/.exec(String(text));
  if (!m) return 2;
  return m[1].startsWith('\t') ? '\t' : m[1].length;
}

/**
 * Merge three JSON texts. Returns `{ ok: true, text }` for a clean merge, or `{ ok: false,
 * reason }` when a side does not parse or both sides changed the same key differently —
 * the caller's cue to fall back to a text merge with markers. An empty or missing base
 * text is a file both sides added.
 */
export function mergeJsonText(baseText, oursText, theirsText) {
  const parse = (t, who) => {
    try {
      return { v: JSON.parse(t) };
    } catch (err) {
      return { error: `${who} is not JSON — ${String(err.message || err).split('\n')[0]}` };
    }
  };
  const o = parse(oursText, 'ours');
  if (o.error) return { ok: false, reason: o.error };
  const t = parse(theirsText, 'theirs');
  if (t.error) return { ok: false, reason: t.error };
  let base;
  if (String(baseText ?? '').trim()) {
    const b = parse(baseText, 'the common ancestor');
    if (b.error) return { ok: false, reason: b.error };
    base = b.v;
  }
  const { value, conflicts } = mergeValues(base, o.v, t.v);
  if (conflicts.length) {
    return { ok: false, reason: `both sides changed ${conflicts.join(', ')}`, conflicts };
  }
  const trailing = /\n$/.test(oursText) ? '\n' : '';
  return { ok: true, text: JSON.stringify(value, null, indentOf(oursText)) + trailing };
}
