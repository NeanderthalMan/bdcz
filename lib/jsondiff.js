/**
 * Record-by-record diff and selective rewrite for a regenerated JSON file, against a
 * git ref, with no opinion about what the records mean.
 *
 * bc-dgx7.143 (re-homed from delmar's dv-k4n.37): four delmar sessions each
 * regenerated an atlas JSON file and each wrote a one-off scratchpad script to answer
 * "what did this actually change" and, twice, "how do I keep only the parts I meant to
 * change" — a different record key, a different notion of a record, and a different
 * splice each time. This is the generalised version of all four scripts.
 *
 * **Finding "the records" without being told the shape.** A regenerated file is either
 * an array of records (`[{...}, {...}]`), or an object with one property that is an
 * array of records plus some file-level metadata beside it (`{key, title, features:
 * [...]}` — delmar's `data_alban.json`, `data_americas.json` — or `{sequences:
 * [...]}` with no metadata at all — delmar's `sequences.json`). `findCollection`
 * looks for exactly that: if several of an object's properties are arrays-of-objects,
 * the largest one wins (real files here have exactly one, so the tie-break has never
 * been exercised against real data — it exists so two candidates fail predictably
 * rather than throwing). Everything else at that level is "metadata": reported as
 * changed or not, never treated as a record.
 *
 * **Finding each record's identity.** `id`, then `name`, then `key` — the first of
 * those that is present on every record and unique across them, checked separately
 * against the ref side and the working side so a field that only exists on one side
 * is rejected rather than half-applied. Falls back to positional index (`#3`) when
 * nothing qualifies, which still finds *changed* records correctly but reads
 * additions and removals as if the whole tail had shifted — the honest limit of not
 * knowing what a record actually is.
 *
 * **What this does not do.** It diffs one level of fields per record — a field that
 * changed is reported with a short old/new, an array or object field that changed is
 * reported by size rather than recursed into. `sequences.json`'s own records nest a
 * "chapter" inside a step's HTML string (`<span class="seq-t">Ch 1 · ...</span>`)
 * with no structural field naming it — parsing that convention here would tie a
 * general library to one atlas's markup, so a changed `steps` array is reported as
 * "steps changed" and reading which step differs is `--json` or the file itself, not
 * this tool inventing a second HTML parser.
 *
 * **`--keep`/`--write` rewrites at record granularity, not below it, and by copying
 * bytes rather than regenerating them.** The first version of this module rebuilt
 * the document by `JSON.parse`-ing both sides and re-serialising the merged result —
 * and lost `"lat": 56.0` to `"lat": 56` on *every untouched record*, because neither
 * JS's number type nor `JSON.stringify` can tell "56" from "56.0" apart once parsed.
 * `parseSpans` below parses without discarding position information, so `spliceKeep`
 * never regenerates a byte it does not have to: every record `--keep` does not name,
 * and all of a file's metadata, is a literal substring copy out of the ref's own
 * text — untouched formatting, numbers, key order and all — and only the records
 * `--keep` does name are substituted, verbatim, from the working copy's own text.
 * Metadata always comes from the ref: `--keep` names records, and metadata is not one.
 */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isRecordArray = (v) => Array.isArray(v) && v.every(isPlainObject);

/**
 * The records collection inside a parsed JSON document, plus the file-level fields
 * beside it.
 *
 * `kind: 'array'` — `root` itself is the collection (`arrayKey: null`), or one of its
 * properties is (`arrayKey` names it and `metadata` is everything else at that level).
 * `kind: 'map'` — no array-of-objects property was found, so `root`'s own key/value
 * pairs are the records (delmar has no file shaped this way today; kept as the
 * fallback the module doc promises rather than a shape this bead could verify).
 */
export function findCollection(root) {
  if (isRecordArray(root)) return { kind: 'array', arrayKey: null, metadata: null, items: root };
  if (isPlainObject(root)) {
    const candidates = Object.keys(root).filter((k) => isRecordArray(root[k]));
    if (candidates.length) {
      // Stable sort: ties keep the earlier property's own position, so two
      // same-length candidates resolve the same way every run.
      const arrayKey = [...candidates].sort((a, b) => root[b].length - root[a].length)[0];
      const metadata = {};
      for (const k of Object.keys(root)) if (k !== arrayKey) metadata[k] = root[k];
      return { kind: 'array', arrayKey, metadata, items: root[arrayKey] };
    }
    return { kind: 'map', arrayKey: null, metadata: null, items: root };
  }
  return { kind: 'array', arrayKey: null, metadata: null, items: [] };
}

/** Does `field` identify every element of `items` uniquely? Vacuously true if empty. */
function fieldWorksFor(items, field) {
  const seen = new Set();
  for (const el of items) {
    if (!isPlainObject(el)) return false;
    const v = el[field];
    if (typeof v !== 'string' && typeof v !== 'number') return false;
    const key = String(v);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * The one field, of `candidates` in order, that identifies every element of *both*
 * arrays uniquely — checked against each side separately so a field only one side
 * has (or only one side has duplicate-free) is rejected rather than half-applied.
 * `null` means "nothing qualifies", and the caller falls back to positional index.
 */
export function pickKeyField(oldItems, newItems, candidates = ['id', 'name', 'key']) {
  for (const f of candidates) {
    if (fieldWorksFor(oldItems, f) && fieldWorksFor(newItems, f)) return f;
  }
  return null;
}

/** `items` as `[key, value]` pairs, keyed by `field` (or positional index if null). */
export function keyedEntries(items, field) {
  return items.map((el, idx) => [field ? String(el[field]) : `#${idx}`, el]);
}

/** A record collection's entries, keyed however `findCollection`'s `kind` dictates. */
export function collectionEntries(collection, field) {
  if (collection.kind === 'map') return Object.entries(collection.items);
  return keyedEntries(collection.items, field);
}

/**
 * One `<prefix>:<n1>,<n2>..<n3>,...` selector, or a literal record key.
 *
 * A bare string (no `:`) matches a record key exactly. `prefix:range` expands to the
 * literal keys `${prefix}${n}` for every `n` the range names — `story:1..3` is
 * `story1`, `story2`, `story3`, matched only against keys that actually exist; a
 * number the range names but the collection does not have is silently no match,
 * never an error, the same as an exact selector for a key that is not there.
 */
export function selectorKeys(selector, existingKeys) {
  const m = /^([^:]+):(.+)$/.exec(selector);
  if (!m) return existingKeys.has(selector) ? [selector] : [];
  const [, prefix, rangeSpec] = m;
  const nums = new Set();
  for (const part of rangeSpec.split(',')) {
    const trimmed = part.trim();
    const range = /^(\d+)\.\.(\d+)$/.exec(trimmed);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      for (let n = lo; n <= hi; n += 1) nums.add(n);
    } else if (/^\d+$/.test(trimmed)) {
      nums.add(Number(trimmed));
    }
  }
  return [...nums].map((n) => `${prefix}${n}`).filter((k) => existingKeys.has(k));
}

/** Every key any of `selectors` names, against the keys that actually exist. */
export function expandSelectors(selectors, existingKeys) {
  const out = new Set();
  for (const sel of selectors) for (const k of selectorKeys(sel, existingKeys)) out.add(k);
  return out;
}

/** A short, single-line rendering of a value for an old->new line — never the whole thing. */
export function shortRepr(value) {
  if (value === undefined) return '∅';
  if (value === null) return 'null';
  if (typeof value === 'string') {
    const s = value.length > 40 ? `${value.slice(0, 37)}...` : value;
    return JSON.stringify(s);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  if (typeof value === 'object') {
    const n = Object.keys(value).length;
    return `{${n} key${n === 1 ? '' : 's'}}`;
  }
  return String(value);
}

/** Every top-level field that differs between two records, old/new value included. */
export function fieldDiffs(oldRec, newRec) {
  const keys = new Set([
    ...(isPlainObject(oldRec) ? Object.keys(oldRec) : []),
    ...(isPlainObject(newRec) ? Object.keys(newRec) : []),
  ]);
  const changes = [];
  for (const k of keys) {
    const before = isPlainObject(oldRec) ? oldRec[k] : undefined;
    const after = isPlainObject(newRec) ? newRec[k] : undefined;
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ field: k, before, after });
  }
  return changes;
}

/**
 * The whole record-by-record comparison: added, removed and changed keys (with
 * per-field detail for `changed`), plus which metadata fields (if any) differ.
 */
export function diffCollections(oldRoot, newRoot, { keyField } = {}) {
  const oldCollection = findCollection(oldRoot);
  const newCollection = findCollection(newRoot);
  const field =
    keyField ||
    (oldCollection.kind === 'array' && newCollection.kind === 'array'
      ? pickKeyField(oldCollection.items, newCollection.items)
      : null);

  const oldEntries = new Map(collectionEntries(oldCollection, field));
  const newEntries = new Map(collectionEntries(newCollection, field));

  const added = [];
  const removed = [];
  const changed = [];
  for (const key of new Set([...oldEntries.keys(), ...newEntries.keys()])) {
    const has1 = oldEntries.has(key);
    const has2 = newEntries.has(key);
    if (has1 && !has2) removed.push(key);
    else if (!has1 && has2) added.push(key);
    else {
      const diffs = fieldDiffs(oldEntries.get(key), newEntries.get(key));
      if (diffs.length) changed.push({ key, fields: diffs });
    }
  }
  added.sort();
  removed.sort();
  changed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const metadataChanged = [];
  const oldMeta = oldCollection.metadata || {};
  const newMeta = newCollection.metadata || {};
  if (oldCollection.metadata || newCollection.metadata) {
    for (const d of fieldDiffs(oldMeta, newMeta)) metadataChanged.push(d);
  }

  return {
    arrayKey: newCollection.arrayKey ?? oldCollection.arrayKey ?? null,
    keyField: field,
    added,
    removed,
    changed,
    metadataChanged,
    oldEntries,
    newEntries,
  };
}

/**
 * A hand-rolled JSON parser that keeps every value's `[start, end)` byte offsets
 * into the original text, alongside its decoded value — the one thing `JSON.parse`
 * throws away and `spliceKeep` needs to copy bytes instead of regenerating them.
 *
 * Returns a `Node`: `{ type: 'object', start, end, entries }` (`entries` is
 * `[{key, keyStart, valueNode}]`, in source order — `keyStart` is where the entry's
 * own `"key"` opens, so `text.slice(keyStart, valueNode.end)` is the whole `"key":
 * value` chunk), `{ type: 'array', start, end, items }` (`items` is `Node[]`), or
 * `{ type: 'scalar', start, end, value }` for a string/number/boolean/null — decoded
 * via `JSON.parse` on the exact substring, so escaping is never reimplemented here.
 */
export function parseSpans(text) {
  let i = 0;
  const len = text.length;
  const fail = (msg) => {
    throw new Error(`jsondiff: ${msg} at offset ${i}`);
  };
  const skipWs = () => {
    while (i < len && /\s/.test(text[i])) i += 1;
  };
  const parseStringSpan = () => {
    const start = i;
    if (text[i] !== '"') fail('expected a string');
    i += 1;
    while (i < len && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= len) fail('unterminated string');
    i += 1;
    return { start, end: i };
  };
  const parseValue = () => {
    skipWs();
    const start = i;
    const c = text[i];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') {
      const span = parseStringSpan();
      return { type: 'scalar', start, end: span.end, value: JSON.parse(text.slice(span.start, span.end)) };
    }
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!m) fail('expected a value');
    i += m[0].length;
    return { type: 'scalar', start, end: i, value: JSON.parse(m[0]) };
  };
  const parseObject = () => {
    const start = i;
    i += 1; // '{'
    const entries = [];
    skipWs();
    if (text[i] === '}') {
      i += 1;
      return { type: 'object', start, end: i, entries };
    }
    for (;;) {
      skipWs();
      const keyStart = i;
      const keySpan = parseStringSpan();
      const key = JSON.parse(text.slice(keySpan.start, keySpan.end));
      skipWs();
      if (text[i] !== ':') fail("expected ':'");
      i += 1;
      const valueNode = parseValue();
      entries.push({ key, keyStart, valueNode });
      skipWs();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === '}') {
        i += 1;
        return { type: 'object', start, end: i, entries };
      }
      fail("expected ',' or '}'");
    }
  };
  const parseArray = () => {
    const start = i;
    i += 1; // '['
    const items = [];
    skipWs();
    if (text[i] === ']') {
      i += 1;
      return { type: 'array', start, end: i, items };
    }
    for (;;) {
      items.push(parseValue());
      skipWs();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === ']') {
        i += 1;
        return { type: 'array', start, end: i, items };
      }
      fail("expected ',' or ']'");
    }
  };
  const root = parseValue();
  skipWs();
  if (i !== len) fail('trailing content after the JSON value');
  return root;
}

/** A `Node` tree's plain JS value — for running `findCollection`'s heuristic on it. */
function nodeValue(node) {
  if (node.type === 'scalar') return node.value;
  if (node.type === 'array') return node.items.map(nodeValue);
  const out = {};
  for (const e of node.entries) out[e.key] = nodeValue(e.valueNode);
  return out;
}

/**
 * The `Node` that holds the records, mirroring `findCollection`'s decision on the
 * plain-value tree exactly — same `arrayKey`, just carrying spans instead of values.
 */
function locateCollectionNode(root, arrayKey) {
  if (arrayKey === null) return root;
  const entry = root.entries.find((e) => e.key === arrayKey);
  return entry.valueNode;
}

/** `containerNode`'s records as `[key, node]` pairs, in source order. */
function nodeEntries(kind, containerNode, keyField) {
  if (kind === 'map') return containerNode.entries.map((e) => [e.key, e]);
  return containerNode.items.map((item, idx) => [keyField ? String(nodeValue(item)[keyField]) : `#${idx}`, item]);
}

/** The `[start, end)` span of one whole item — key included, for a map entry. */
function itemSpan(kind, entryOrItem) {
  return kind === 'map' ? { start: entryOrItem.keyStart, end: entryOrItem.valueNode.end } : entryOrItem;
}

/**
 * `--keep --write`'s rewrite: `oldText` (the ref) with every record `keepKeys` names
 * replaced by its raw text from `newText` (the working copy), and every other byte —
 * every other record, all metadata, the wrapper object if there is one — copied
 * unchanged. `keyField` must be the same field `diffCollections` decided on, so a
 * selector and a report agree on what a given key refers to.
 *
 * A `--keep` key neither side has is refused (nothing to substitute in, and nothing
 * to leave in place either). A key only the working copy has is appended after the
 * ref's own last record, using the separator text between the ref's own last two
 * records as the template for the comma and indentation between the new ones — the
 * one place this cannot simply copy a span, because the ref has no such record to
 * copy a boundary from.
 */
export function spliceKeep(oldText, newText, keepKeys, keyField) {
  const oldRoot = parseSpans(oldText);
  const newRoot = parseSpans(newText);
  const oldCollection = findCollection(nodeValue(oldRoot));
  const newCollection = findCollection(nodeValue(newRoot));
  const arrayKey = oldCollection.arrayKey ?? newCollection.arrayKey ?? null;
  const kind = oldCollection.kind;

  const oldContainer = locateCollectionNode(oldRoot, arrayKey);
  const newContainer = locateCollectionNode(newRoot, arrayKey);
  const oldSlots = nodeEntries(kind, oldContainer, keyField);
  const newByKey = new Map(nodeEntries(kind, newContainer, keyField));

  const kept = new Set(keepKeys);
  const seen = new Set(oldSlots.map(([k]) => k));
  for (const key of keepKeys) {
    if (!newByKey.has(key)) throw new Error(`--keep names "${key}", which the working copy does not have`);
  }

  const pieces = [];
  // The whitespace between the opening bracket/brace and the first record — part of
  // the ref's own formatting, and easy to lose by only ever copying the separators
  // *between* records and forgetting the one before the first and after the last.
  if (oldSlots.length) pieces.push(oldText.slice(oldContainer.start + 1, itemSpan(kind, oldSlots[0][1]).start));

  oldSlots.forEach(([key, slot], idx) => {
    if (idx > 0) {
      const prevSpan = itemSpan(kind, oldSlots[idx - 1][1]);
      const span = itemSpan(kind, slot);
      pieces.push(oldText.slice(prevSpan.end, span.start));
    }
    if (kept.has(key)) {
      const newSpan = itemSpan(kind, newByKey.get(key));
      pieces.push(newText.slice(newSpan.start, newSpan.end));
    } else {
      const span = itemSpan(kind, slot);
      pieces.push(oldText.slice(span.start, span.end));
    }
  });

  const toAppend = [...keepKeys].filter((k) => !seen.has(k));
  if (toAppend.length) {
    // The separator between the ref's own last two records, reused as the template
    // for every appended one — the honest fallback when there is no such pair is a
    // plain comma-newline, which only ever fires on a collection with 0 or 1 records.
    let template = ',\n';
    if (oldSlots.length >= 2) {
      const a = itemSpan(kind, oldSlots[oldSlots.length - 2][1]);
      const b = itemSpan(kind, oldSlots[oldSlots.length - 1][1]);
      template = oldText.slice(a.end, b.start);
    }
    for (const key of toAppend) {
      pieces.push(oldSlots.length || pieces.length ? template : '');
      const newSpan = itemSpan(kind, newByKey.get(key));
      pieces.push(newText.slice(newSpan.start, newSpan.end));
    }
  }

  // The whitespace between the last record and the closing bracket/brace — same
  // reasoning as the leading piece above. An always-empty collection (no old slots,
  // nothing appended) has no records to anchor this to; its own inner text, whatever
  // whitespace it holds, is copied as one piece instead.
  if (oldSlots.length) {
    pieces.push(oldText.slice(itemSpan(kind, oldSlots[oldSlots.length - 1][1]).end, oldContainer.end - 1));
  } else if (!toAppend.length) {
    pieces.push(oldText.slice(oldContainer.start + 1, oldContainer.end - 1));
  }

  const rebuiltContainer = oldText.slice(oldContainer.start, oldContainer.start + 1) + pieces.join('') + oldText.slice(oldContainer.end - 1, oldContainer.end);

  return oldText.slice(0, oldContainer.start) + rebuiltContainer + oldText.slice(oldContainer.end);
}
