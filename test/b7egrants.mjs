#!/usr/bin/env node
//
// b7e-grants — is this command granted to dispatch or withheld, and which paragraph
// decided it (bc-dgx7.111).
//
//   npm test
//   node test/b7egrants.mjs
//
// Two halves. First, lib/grantsmap.js's pieces (the excluded-paragraph reader, and
// grantVerdict's three-way read) driven against a fabricated fixture tree — small,
// deterministic, and immune to the real bin/ growing or lib/tooldecl.js's prose being
// reworded out from under this suite. Second, the real command, spawned, against this
// repo's own bin/ and lib/tooldecl.js — a real-repo assertion, per memory note
// a-real-repo-assertion-in-a-test-rots-between-your-run-and-ci, so it checks shape
// ("has a reason", "the file:line is real") rather than exact prose.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-grants');

const { excludedParagraphs, grantVerdict, allVerdicts, grantLineNumber } = await import(path.join(ROOT, 'lib', 'grantsmap.js'));

let failures = 0;
let ran = 0;
function check(name, fn) {
  ran += 1;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err && err.message ? err.message : String(err)).split('\n').join('\n       ')}`);
  }
}

console.log('\nb7e-grants\n');

/* ---------------------------------------------------------------- grantLineNumber */

console.log('grantLineNumber');

check('finds the line, 1-based, of a comment-shaped @grant', () => {
  const src = '#!/usr/bin/env node\n/**\n * Does a thing.\n *\n * @grant read\n */\n';
  assert.equal(grantLineNumber(src), 5);
});

check('a @grant written mid-sentence is not the line', () => {
  const src = '/**\n * this is what `@grant read` looks like.\n *\n * @grant write\n */\n';
  assert.equal(grantLineNumber(src), 4);
});

check('a `@grant write: <why>` line, reason on the same line, is the line', () => {
  const src = '/**\n * Writes.\n *\n * @grant write: it can rewrite the queue file\n */\n';
  assert.equal(grantLineNumber(src), 4);
});

check('no @grant line at all is null', () => {
  assert.equal(grantLineNumber('#!/usr/bin/env node\nconsole.log(1);\n'), null);
});

/* ---------------------------------------------------------------- excludedParagraphs */

console.log('\nexcludedParagraphs');

check('finds a single-command paragraph, keyed by name, with its line and text', () => {
  const text =
    '/**\n' +
    '  // b7e-foo (bc-1) is deliberately NOT on this list, because it writes to the tree.\n' +
    '  //   → Bash(b7e-bar:*) — declared `@grant read` in bin/b7e-bar\n' +
    ' */\n';
  const p = excludedParagraphs(text);
  assert.ok(p['b7e-foo'], 'expected a paragraph for b7e-foo');
  assert.equal(p['b7e-foo'].line, 2);
  assert.match(p['b7e-foo'].text, /writes to the tree/);
  assert.equal(p['b7e-bar'], undefined, 'a granted arrow line is not an excluded paragraph');
});

check('a two-name paragraph ("X and Y are ... deliberately NOT") is keyed under both', () => {
  const text = '/**\n  // b7e-a (bc-1) and b7e-b (bc-2) are also deliberately NOT on this list, for one reason.\n */\n';
  const p = excludedParagraphs(text);
  assert.ok(p['b7e-a'] && p['b7e-b'], 'expected both names to have a paragraph');
  assert.equal(p['b7e-a'].text, p['b7e-b'].text, 'the two share one paragraph');
});

check('a phrase split across a line wrap is still found (the real b7e-sandbox/b7e-fixture shape)', () => {
  const text =
    '/**\n' +
    '  // b7e-a (bc-1) is also deliberately NOT on\n' +
    '  // this list, but for a reason that continues here.\n' +
    ' */\n';
  const p = excludedParagraphs(text);
  assert.ok(p['b7e-a'], 'expected the wrapped phrase to still be found');
  assert.match(p['b7e-a'].text, /reason that continues/);
});

check('a paragraph does not swallow the next one — it stops at the next header or arrow', () => {
  const text =
    '/**\n' +
    '  // b7e-a (bc-1) is deliberately NOT on this list, short reason here.\n' +
    '  // b7e-b (bc-2) is deliberately NOT on this list, a completely different reason.\n' +
    ' */\n';
  const p = excludedParagraphs(text);
  assert.match(p['b7e-a'].text, /short reason here/);
  assert.doesNotMatch(p['b7e-a'].text, /completely different/, 'b7e-a paragraph must not run into b7e-b\'s');
});

check('a bare mention inside a DIFFERENT command\'s reason is not a paragraph of its own', () => {
  // The exact trap lib/tooldecl.js's own history warns about: naming a sibling
  // positionally ("for the b7e-x reason") must not read as b7e-x's own decision.
  const text = '/**\n  // b7e-a (bc-1) is deliberately NOT on this list, for the b7e-mentioned reason exactly.\n */\n';
  const p = excludedParagraphs(text);
  assert.equal(p['b7e-mentioned'], undefined, 'a positional mention is not a decision about it');
});

check('a tool header\'s own block comment, DEFAULT_TOOL_LIST wording, stops at the paragraph break', () => {
  // The shape bc-fmk4v moved every argument into: the tool's own header, above @grant.
  const text =
    '/**\n' +
    ' * Does a thing.\n' +
    ' *\n' +
    ' * b7e-a is deliberately NOT on DEFAULT_TOOL_LIST. It writes to\n' +
    ' * the checkout.\n' +
    ' *\n' +
    ' * An unrelated paragraph after it.\n';
  const p = excludedParagraphs(text);
  assert.ok(p['b7e-a'], 'expected a paragraph for b7e-a');
  assert.equal(p['b7e-a'].line, 4);
  assert.match(p['b7e-a'].text, /writes to the checkout/);
  assert.doesNotMatch(p['b7e-a'].text, /unrelated/, 'a paragraph ends at a blank comment line');
});

/* ---------------------------------------------------------------- grantVerdict, on a fixture */

console.log('\ngrantVerdict, against a fabricated tree');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-grants-'));
const write = (rel, text) => {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  fs.chmodSync(abs, 0o755);
};

write('bin/b7e-granted', "#!/usr/bin/env node\n/**\n * Reads a thing.\n *\n * @grant read\n */\nconsole.log('ok');\n");
write(
  'bin/b7e-withheld',
  "#!/usr/bin/env node\n/**\n * Writes a thing.\n *\n" +
    ' * b7e-withheld (bc-1) is deliberately NOT on DEFAULT_TOOL_LIST, because it writes to the checkout.\n' +
    " *\n * @grant excluded\n */\nconsole.log('ok');\n"
);
write(
  'bin/b7e-withheld-no-reason',
  "#!/usr/bin/env node\n/**\n * Also writes a thing, but nobody wrote up why.\n *\n * @grant excluded\n */\nconsole.log('ok');\n"
);
write('bin/b7e-undecided', "#!/usr/bin/env node\nconsole.log('ok');\n");
write(
  'lib/tooldecl.js',
  '/**\n' +
    // Where the arguments lived before bc-fmk4v: no longer read as anyone's reason.
    '  // b7e-withheld-no-reason (bc-2) is deliberately NOT on this list, an old paragraph.\n' +
    '  //   → Bash(b7e-granted:*) — declared `@grant read` in bin/b7e-granted\n' +
    '  // Elsewhere this mentions b7e-undecided in passing, which decides nothing about it.\n' +
    ' */\n'
);
write(
  'package.json',
  JSON.stringify({
    name: 'fixture',
    version: '0.0.0',
    bin: {
      'b7e-granted': 'bin/b7e-granted',
      'b7e-withheld': 'bin/b7e-withheld',
      'b7e-withheld-no-reason': 'bin/b7e-withheld-no-reason',
      'b7e-undecided': 'bin/b7e-undecided',
    },
  })
);

check('a granted command reports its own @grant line as decidedAt, and nothing else', () => {
  const v = grantVerdict(tmp, 'b7e-granted');
  assert.equal(v.status, 'granted');
  assert.equal(v.kind, 'read');
  assert.deepEqual(v.decidedAt, { file: 'bin/b7e-granted', line: 5 });
});

check('a withheld command with a recorded paragraph carries the file:line and the reason text', () => {
  const v = grantVerdict(tmp, 'b7e-withheld');
  assert.equal(v.status, 'withheld');
  assert.equal(v.kind, 'excluded');
  assert.deepEqual(v.decidedAt, { file: 'bin/b7e-withheld', line: 7 });
  assert.equal(v.reason.file, 'bin/b7e-withheld');
  assert.equal(v.reason.line, 5);
  assert.match(v.reason.text, /writes to the checkout/);
});

check('a withheld command with NO paragraph in its own header says so honestly — lib/tooldecl.js is not read for it', () => {
  const v = grantVerdict(tmp, 'b7e-withheld-no-reason');
  assert.equal(v.status, 'withheld');
  assert.equal(v.reason, null);
});

check('a header arguing the exclusion without opening on the name still gives its reason (the b7e-landed shape)', () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-grants-unnamed-'));
  try {
    fs.mkdirSync(path.join(other, 'bin'));
    fs.writeFileSync(
      path.join(other, 'bin', 'b7e-unnamed'),
      "#!/usr/bin/env node\n/**\n * Does a thing.\n *\n * Deliberately NOT on `DEFAULT_TOOL_LIST`, because it\n * pushes a branch.\n *\n * @grant excluded\n */\n"
    );
    const v = grantVerdict(other, 'b7e-unnamed');
    assert.equal(v.status, 'withheld');
    assert.equal(v.reason.file, 'bin/b7e-unnamed');
    assert.equal(v.reason.line, 5);
    assert.match(v.reason.text, /pushes a branch/);
    assert.doesNotMatch(v.reason.text, /Does a thing/, 'only the arguing paragraph, not the whole header');
  } finally {
    fs.rmSync(other, { recursive: true, force: true });
  }
});

check('an undecided command has no decidedAt, and a bare mention is reported separately, never as a decision', () => {
  const v = grantVerdict(tmp, 'b7e-undecided');
  assert.equal(v.status, 'undecided');
  assert.equal(v.kind, null);
  assert.equal(v.decidedAt, null);
  assert.ok(v.mention, 'expected the passing mention to be surfaced');
  assert.equal(v.mention.file, 'lib/tooldecl.js');
});

check('allVerdicts covers every candidate name, granted and withheld and undecided alike', () => {
  const rows = allVerdicts(tmp);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r.status]));
  assert.deepEqual(byName, {
    'b7e-granted': 'granted',
    'b7e-undecided': 'undecided',
    'b7e-withheld': 'withheld',
    'b7e-withheld-no-reason': 'withheld',
  });
});

/* --------------------------------------------------------------------------- the CLI */

console.log('\nthe real command, spawned against the fixture');

const run = (args, cwd = ROOT) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

check('bare, against the fixture, lists all four with their verdicts', () => {
  const r = run(['--dir', tmp]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /4 b7e-\* commands/);
  assert.match(r.stdout, /b7e-granted[\s\S]*granted/);
  assert.match(r.stdout, /b7e-withheld[\s\S]*withheld/);
});

check('--json prints one parseable verdict per command', () => {
  const r = run(['--dir', tmp, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 4);
  const withheld = rows.find((x) => x.name === 'b7e-withheld');
  assert.equal(withheld.status, 'withheld');
  assert.match(withheld.reason.text, /writes to the checkout/);
});

check('--undecided narrows to only the undecided rows', () => {
  const r = run(['--dir', tmp, '--undecided', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => x.name), ['b7e-undecided']);
});

check('a named command prints just that one', () => {
  const r = run(['b7e-granted', '--dir', tmp]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 b7e-\* command\b/);
  assert.match(r.stdout, /b7e-granted/);
  assert.doesNotMatch(r.stdout, /b7e-withheld\b/);
});

check('an unknown name is refused rather than silently reported as undecided', () => {
  const r = run(['b7e-nope', '--dir', tmp]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not a b7e-\* command/);
});

check('--dir pointing at something with no bin/ or package.json is refused', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-grants-empty-'));
  const r = run(['--dir', empty]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /does not look like/);
  fs.rmSync(empty, { recursive: true, force: true });
});

check('--help exits 0 and prints usage without running anything', () => {
  const r = run(['--help', '--dir', tmp]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage: b7e-grants/);
});

check('an unrecognised flag is refused', () => {
  const r = run(['--nope', '--dir', tmp]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unrecognised flag/);
});

await cleanupTmp(tmp);

/* ---------------------------------------------------- the real repo, this bead's own examples */

console.log("\nthe real command, spawned against this repo's own bin/ and lib/tooldecl.js");

check('every real b7e-* command gets a verdict, and every withheld one has a real file:line', () => {
  const r = run(['--json']);
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(rows.length > 40, `expected well over 40 commands, found ${rows.length}`);
  for (const row of rows) {
    if (row.status === 'granted' || row.status === 'withheld') {
      assert.ok(row.decidedAt, `${row.name}: ${row.status} but no decidedAt`);
      const abs = path.join(ROOT, row.decidedAt.file);
      const src = fs.readFileSync(abs, 'utf8');
      const line = src.split('\n')[row.decidedAt.line - 1];
      assert.match(line, /@grant/, `${row.name}: decidedAt ${row.decidedAt.file}:${row.decidedAt.line} is not the @grant line`);
    }
  }
});

check('every real withheld command has a reason in its own header (test/pertoolfiles.mjs requires one)', () => {
  const r = run(['--json']);
  assert.equal(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  const unsaid = rows.filter((x) => x.status === 'withheld' && !(x.reason && x.reason.file === x.decidedAt.file));
  assert.deepEqual(unsaid.map((x) => x.name), []);
});

check('b7e-gate is withheld, with a reason quoting its own spawn-a-suite argument', () => {
  const r = run(['b7e-gate', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const row = JSON.parse(r.stdout.trim());
  assert.equal(row.status, 'withheld');
  assert.ok(row.reason, 'expected b7e-gate to have a recorded reason');
  assert.match(row.reason.text, /npm test/);
});

check('b7e-def is granted, read', () => {
  const r = run(['b7e-def', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const row = JSON.parse(r.stdout.trim());
  assert.equal(row.status, 'granted');
  assert.equal(row.kind, 'read');
});

check('a command mentioned only inside a sibling\'s reason (not its own paragraph) is undecided, not withheld', () => {
  // b7e-say is named only in lib/tooldecl.js's opening docstring ("nobody has decided about
  // them"), never given its own "is deliberately NOT on this list" paragraph — the mention
  // must not be read as a decision, which is the whole point of this bead.
  const r = run(['b7e-say', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const row = JSON.parse(r.stdout.trim());
  assert.equal(row.status, 'undecided');
});

check('b7e-grants is granted on its own list — it only ever reads bin/, lib/tooldecl.js and package.json', () => {
  const r = run(['b7e-grants', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const row = JSON.parse(r.stdout.trim());
  assert.equal(row.status, 'granted', 'b7e-grants should be granted — see the @grant line in its own header');
});

/* --------------------------------------------------------------------------- done */

console.log(`\n${ran - failures}/${ran} passed`);
process.exit(failures ? 1 : 0);
