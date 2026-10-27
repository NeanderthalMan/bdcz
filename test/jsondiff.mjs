#!/usr/bin/env node
//
// b7e-jsondiff — what a regenerated JSON file changed, record by record, against a
// ref, and keep only your records (bc-dgx7.143).
//
//   npm test
//   node test/jsondiff.mjs
//
// lib/jsondiff.js is exercised directly for the shape-detection and diff/rewrite
// logic; the CLI is driven with real git commits (spawnSync + a scratch repo), the
// same pattern test/show.mjs uses, because reading the ref side through git plumbing
// is the whole point of this tool over a hand-rolled `git show | diff`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-jsondiff');

const jsondiff = await import(path.join(ROOT, 'lib', 'jsondiff.js'));

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

/* ============================================================ lib/jsondiff.js */

console.log('\nparseSpans — a JSON parse that keeps byte offsets\n');

{
  const text = '{\n "sequences": [\n  {\n   "id": "ch1",\n   "lat": 56.0\n  }\n ]\n}';
  const root = jsondiff.parseSpans(text);
  check('parses the root object', root.type === 'object' && text.slice(root.start, root.end) === text);
  const seqEntry = root.entries.find((e) => e.key === 'sequences');
  check('finds the sequences array', seqEntry.valueNode.type === 'array' && seqEntry.valueNode.items.length === 1);
  const rec = seqEntry.valueNode.items[0];
  check('a record span reproduces its exact source text, decimal and all', text.slice(rec.start, rec.end).includes('"lat": 56.0'));
}

{
  // The bug the old parse/stringify round trip had: JSON.parse+JSON.stringify turns
  // 56.0 into 56, because JS numbers don't remember "was this written with a point".
  // parseSpans never has to re-render this value at all if the record is untouched.
  const text = '{"lat": 56.0}';
  const root = jsondiff.parseSpans(text);
  const latNode = root.entries[0].valueNode;
  check('a value untouched by any rewrite keeps its own literal text', text.slice(latNode.start, latNode.end) === '56.0');
}

{
  const bad = '{"a": }';
  assert.throws(() => jsondiff.parseSpans(bad), /jsondiff:/, 'malformed JSON is a thrown error, not a silent wrong answer');
  ok('malformed JSON throws rather than parsing something wrong');
}

console.log('\nfindCollection — the records, wherever the shape puts them\n');

{
  const c = jsondiff.findCollection([{ id: 'a' }, { id: 'b' }]);
  check('a bare array is the collection itself', c.kind === 'array' && c.arrayKey === null && c.items.length === 2);
}

{
  // sequences.json shape: one key, no metadata beside it.
  const c = jsondiff.findCollection({ sequences: [{ id: 'ch1' }, { id: 'story1' }] });
  check('a single-key wrapper is unwrapped', c.kind === 'array' && c.arrayKey === 'sequences' && c.items.length === 2);
  check('no metadata when nothing else is at that level', Object.keys(c.metadata).length === 0);
}

{
  // data_alban.json shape: metadata fields beside the records array.
  const c = jsondiff.findCollection({ key: 'alban', title: 'The Alban World', features: [{ name: 'Llanenwr' }] });
  check('the array-of-objects property is found among metadata', c.kind === 'array' && c.arrayKey === 'features');
  check('everything else becomes metadata', c.metadata.key === 'alban' && c.metadata.title === 'The Alban World');
}

{
  // No array-of-objects property anywhere — falls back to the object's own keys as records.
  const c = jsondiff.findCollection({ Llanenwr: { pop: 1500 }, Cwmrith: { pop: 900 } });
  check('a plain object with no record array falls back to a flat map', c.kind === 'map');
}

{
  const c = jsondiff.findCollection({ small: [{ id: 1 }], big: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  check('with two array-of-object candidates, the larger one wins', c.arrayKey === 'big');
}

console.log('\npickKeyField / selectorKeys\n');

{
  const oldItems = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
  const newItems = [{ id: 'a', v: 9 }, { id: 'c', v: 3 }];
  check('id wins when unique on both sides', jsondiff.pickKeyField(oldItems, newItems) === 'id');
}

{
  const oldItems = [{ id: 'a' }, { id: 'a' }]; // duplicate id
  const newItems = [{ id: 'a' }, { id: 'b' }];
  check('a field with a duplicate on either side is rejected', jsondiff.pickKeyField(oldItems, newItems, ['id']) === null);
}

{
  const oldItems = [{ name: 'x' }];
  const newItems = [{ name: 'y' }];
  check('falls through to name when id is absent', jsondiff.pickKeyField(oldItems, newItems) === 'name');
}

{
  const existing = new Set(['ch1', 'story1', 'story2', 'story4', 'story5', 'story6']);
  check('a literal selector matches its own key only', jsondiff.selectorKeys('ch1', existing).join(',') === 'ch1');
  check(
    'a prefix:range selector expands only to keys that exist',
    jsondiff.selectorKeys('story:1..3', existing).sort().join(',') === 'story1,story2',
    `story3 does not exist and must not appear`
  );
  check('a comma list of ranges/numbers combines', jsondiff.selectorKeys('story:4,6', existing).sort().join(',') === 'story4,story6');
  check('a selector with no matches is empty, not an error', jsondiff.selectorKeys('nope:9..9', existing).length === 0);
}

console.log('\ndiffCollections — added / removed / changed / metadata\n');

{
  const before = { sequences: [{ id: 'ch1', label: 'A', steps: [1, 2] }, { id: 'story1', label: 'B' }] };
  const after = { sequences: [{ id: 'ch1', label: 'A2', steps: [1, 2, 3] }, { id: 'story4', label: 'D' }] };
  const d = jsondiff.diffCollections(before, after);
  check('detects the removed record', d.removed.join(',') === 'story1');
  check('detects the added record', d.added.join(',') === 'story4');
  check('detects the changed record', d.changed.length === 1 && d.changed[0].key === 'ch1');
  const fields = d.changed[0].fields.map((f) => f.field).sort();
  check('reports every field that actually changed', fields.join(',') === 'label,steps');
  check('auto-picked id as the key field', d.keyField === 'id');
}

{
  const before = { key: 'alban', title: 'old title', features: [{ name: 'A', pop: 1 }] };
  const after = { key: 'alban', title: 'new title', features: [{ name: 'A', pop: 1 }] };
  const d = jsondiff.diffCollections(before, after);
  check('an unchanged record collection reports no record changes', d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0);
  check('a metadata field change is reported separately', d.metadataChanged.length === 1 && d.metadataChanged[0].field === 'title');
}

{
  const same = { sequences: [{ id: 'ch1', label: 'A' }] };
  const d = jsondiff.diffCollections(same, JSON.parse(JSON.stringify(same)));
  check('nothing changed reports nothing changed', !d.added.length && !d.removed.length && !d.changed.length && !d.metadataChanged.length);
}

console.log('\nspliceKeep — rewriting the ref\'s own bytes, patched with the working copy\'s records\n');

{
  const before = '{"key": "alban", "title": "T", "features": [{"name": "A", "pop": 1}, {"name": "B", "pop": 2}]}';
  const after = '{"key": "alban", "title": "T-changed", "features": [{"name": "A", "pop": 9}, {"name": "B", "pop": 2}, {"name": "C", "pop": 3}]}';
  const rebuilt = jsondiff.spliceKeep(before, after, new Set(['A', 'C']), 'name');
  const parsed = JSON.parse(rebuilt);
  check('a kept record comes from the working copy', parsed.features.find((f) => f.name === 'A').pop === 9);
  check('an unmentioned record stays as the ref had it', parsed.features.find((f) => f.name === 'B').pop === 2);
  check('a record the ref never had, but --keep names, is appended', !!parsed.features.find((f) => f.name === 'C'));
  check('metadata always comes from the ref, never the working copy', parsed.title === 'T');
  check('the ref\'s own key order is preserved (features still last)', Object.keys(parsed).join(',') === 'key,title,features');
  check('untouched bytes are copied literally, not regenerated (compact spacing intact)', rebuilt.includes('{"name": "B", "pop": 2}'));
}

{
  // The exact regression the old parse/stringify design hit: a float with no
  // fractional digits, in a record that --keep never names, must not lose its ".0".
  const before = '{\n "sequences": [\n  {\n   "id": "ch1",\n   "lat": 56.0\n  },\n  {\n   "id": "story1",\n   "lat": 12.0\n  }\n ]\n}';
  const after = before.replace('"id": "ch1",\n   "lat": 56.0', '"id": "ch1",\n   "lat": 57.0');
  const rebuilt = jsondiff.spliceKeep(before, after, new Set(['ch1']), 'id');
  check('the kept record\'s change survives', rebuilt.includes('"lat": 57.0'));
  check('the untouched record\'s float keeps its trailing zero', rebuilt.includes('"lat": 12.0'));
  check('nothing outside the swapped record moved a single byte', rebuilt === before.replace('56.0', '57.0'));
}

{
  const before = '{"sequences": [{"id": "ch1", "v": 1}, {"id": "story1", "v": 2}]}';
  const after = '{"sequences": [{"id": "ch1", "v": 9}, {"id": "story1", "v": 8}]}';
  const rebuilt = JSON.parse(jsondiff.spliceKeep(before, after, new Set(['ch1']), 'id'));
  check('a single-key wrapper round-trips through the same key', rebuilt.sequences.find((s) => s.id === 'ch1').v === 9);
  check('the record not kept is untouched', rebuilt.sequences.find((s) => s.id === 'story1').v === 2);
}

{
  assert.throws(
    () => jsondiff.spliceKeep('{"features": [{"name": "A"}]}', '{"features": [{"name": "A"}]}', new Set(['ghost']), 'name'),
    /working copy does not have/,
    'a --keep name absent from both sides is an error, not a silent no-op'
  );
  ok('--keep naming a record neither side has throws rather than silently succeeding');
}

/* ==================================================================== CLI (real git) */

console.log('\nb7e-jsondiff (CLI) — against a real repo, real commits\n');

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-jsondiff-test-'));
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  });

function makeRepo(name, { atlas = 'pretty' } = {}) {
  const work = path.join(tmp, name);
  fs.mkdirSync(work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  const file = path.join(work, 'atlas.json');
  const before =
    atlas === 'pretty'
      ? '{\n "sequences": [\n  {\n   "id": "ch1",\n   "label": "A"\n  },\n  {\n   "id": "story1",\n   "label": "B"\n  }\n ]\n}'
      : '{"key": "alban", "title": "T", "features": [{"name": "A", "pop": 1}, {"name": "B", "pop": 2}]}';
  fs.writeFileSync(file, before);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'first');
  const head = git(work, 'rev-parse', 'HEAD').trim();
  return { work, file, head, before };
}

{
  const { work, file } = makeRepo('cli-noop');
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work], { encoding: 'utf8' });
  check('no working-copy edit exits 0', r.status === 0, r.stdout + r.stderr);
  check('and says nothing changed', r.stdout.includes('nothing changed'));
}

{
  const { work, file } = makeRepo('cli-changed');
  const after = fs
    .readFileSync(file, 'utf8')
    .replace('"label": "A"', '"label": "A2"')
    .replace('"id": "story1",\n   "label": "B"', '"id": "story4",\n   "label": "D"');
  fs.writeFileSync(file, after);
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work], { encoding: 'utf8' });
  check('a real drift exits 1', r.status === 1, r.stdout + r.stderr);
  check('reports the changed record', r.stdout.includes('~ ch1'));
  check('reports the added record', r.stdout.includes('+ story4'));
  check('reports the removed record', r.stdout.includes('- story1'));
}

{
  const { work, file } = makeRepo('cli-only');
  const after = fs.readFileSync(file, 'utf8').replace('"label": "A"', '"label": "A2"');
  fs.writeFileSync(file, after);
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work, '--only', 'ch1'], { encoding: 'utf8' });
  check('a change --only allows exits 0', r.status === 0, r.stdout + r.stderr);
  check('but the change is still reported', r.stdout.includes('~ ch1'));
}

{
  const { work, file } = makeRepo('cli-only-miss');
  const after = fs.readFileSync(file, 'utf8').replace('"label": "A"', '"label": "A2"');
  fs.writeFileSync(file, after);
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work, '--only', 'story1'], { encoding: 'utf8' });
  check('a change --only does not name still exits 1', r.status === 1, r.stdout + r.stderr);
}

{
  const { work, file, before } = makeRepo('cli-write-pretty');
  const after = before
    .replace('"label": "A"', '"label": "A2"')
    .replace('"id": "story1",\n   "label": "B"', '"id": "story1",\n   "label": "B2"');
  fs.writeFileSync(file, after);
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work, '--keep', 'ch1', '--write'], { encoding: 'utf8' });
  check('--write exits 0', r.status === 0, r.stdout + r.stderr);
  const rewritten = fs.readFileSync(file, 'utf8');
  check('the kept record\'s change survives', rewritten.includes('"label": "A2"'));
  check('the not-kept record is rolled back to the ref', rewritten.includes('"label": "B"') && !rewritten.includes('"label": "B2"'));
  check('the rewrite matches the ref\'s own pretty formatting exactly where nothing changed', rewritten.startsWith('{\n "sequences": [\n  {\n   "id": "ch1",'));
}

{
  const { work, file } = makeRepo('cli-write-compact', { atlas: 'compact' });
  const after = fs
    .readFileSync(file, 'utf8')
    .replace('"pop": 1', '"pop": 99')
    .replace('"pop": 2', '"pop": 88');
  fs.writeFileSync(file, after);
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work, '--keep', 'A', '--write'], { encoding: 'utf8' });
  check('--write on a compact file exits 0', r.status === 0, r.stdout + r.stderr);
  const rewritten = fs.readFileSync(file, 'utf8');
  check('kept record change survives', rewritten.includes('"pop": 99'));
  check('unmentioned record rolled back, compact spacing intact', rewritten.includes('{"name": "B", "pop": 2}'));
}

{
  const { work } = makeRepo('cli-keep-no-write');
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work, '--keep', 'ch1'], { encoding: 'utf8' });
  check('--keep without --write is refused (exit 2)', r.status === 2);
}

{
  const { work } = makeRepo('cli-write-no-keep');
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work, '--write'], { encoding: 'utf8' });
  check('--write without --keep is refused (exit 2)', r.status === 2);
}

{
  const { work } = makeRepo('cli-json-mode');
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(r.stdout);
  check('--json prints a parseable object', Array.isArray(parsed.added) && Array.isArray(parsed.changed));
}

{
  const { work } = makeRepo('cli-bad-ref');
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work, '--ref', 'not-a-real-ref'], { encoding: 'utf8' });
  check('a ref with no such path exits 3', r.status === 3, r.stdout + r.stderr);
}

{
  // Regression: `--dir` resolved with `path.resolve` alone, then compared against
  // `git rev-parse --show-toplevel` (which always resolves symlinks), read every
  // path under macOS's own `/tmp` (itself a symlink to `/private/tmp`) as "outside"
  // the repo it was plainly inside — found while checking this tool against
  // delmar's real files, only reachable by name because `tmp` above is already
  // realpath'd and would never have hit it.
  const { work, file } = makeRepo('cli-symlinked-dir');
  const link = path.join(fs.realpathSync(os.tmpdir()), `jsondiff-symlink-${process.pid}`);
  fs.symlinkSync(work, link);
  try {
    const r = spawnSync('node', [BIN, 'atlas.json', '--dir', link], { encoding: 'utf8' });
    check('a --dir reached through a symlink is not read as outside the repo', r.status === 0, r.stdout + r.stderr);
  } finally {
    fs.unlinkSync(link);
  }
}

{
  const work = fs.mkdtempSync(path.join(tmp, 'not-json-'));
  git(work, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(work, 'atlas.json'), 'not json at all');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'bad json');
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', work], { encoding: 'utf8' });
  check('invalid JSON at the ref exits 3', r.status === 3, r.stdout + r.stderr);
}

{
  const notARepo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-jsondiff-norepo-'));
  const r = spawnSync('node', [BIN, 'atlas.json', '--dir', notARepo], { encoding: 'utf8' });
  check('run against a directory that is not a git repository refuses (exit 2)', r.status === 2);
}

{
  const r = spawnSync('node', [BIN, '--help'], { encoding: 'utf8' });
  check('--help exits 0 and prints usage', r.status === 0 && r.stdout.includes('b7e-jsondiff'));
}

{
  const r = spawnSync('node', [BIN], { encoding: 'utf8' });
  check('no path at all is refused (exit 2)', r.status === 2);
}

console.log(`\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
