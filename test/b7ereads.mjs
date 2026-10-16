#!/usr/bin/env node
//
// b7e-reads — which test/*.mjs suites readFileSync a lib/ or bin/ file's source and
// assert a pattern against it, and what shape each assertion demands (bc-dgx7.114).
//
//   npm test
//   node test/b7ereads.mjs
//
// The matching and classification primitives are proved directly, against small
// hand-written snippets. readsOf is then proved against a FABRICATED fixture root (a
// throwaway lib/ + test/ pair written to a tmp dir), never against this repo's own
// suites for anything beyond a loose sanity check — a real-repo assertion pins ANOTHER
// suite's exact shape, which drifts under this suite without this branch changing (see
// the memory note a-real-repo-assertion-in-a-test-rots-between-your-run-and-ci, and
// test/b7epinned.mjs's own identical stance). The one exception is the bead's own
// founding example — test/surveybrief.mjs's readFileSync of lib/advocate.js and its
// /heldBy\w+/ scan — checked by pattern and line number, because that is the bead's own
// definition of "found it" rather than an incidental fact about another module.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-reads');

const reads = await import(path.join(ROOT, 'lib', 'reads.js'));

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, fn) => {
  try {
    fn();
    ok(name);
  } catch (err) {
    bad(name, err.message);
  }
};

/* ================================================================ 1. argNamesTarget */

console.log('\nargNamesTarget — does a readFileSync argument name this file?\n');

check('a bare basename literal, confirmed by the dir word elsewhere in the statement', () => {
  const argText = "path.join(ROOT, 'lib', 'advocate.js')";
  const stmtText = `const daemon = fs.readFileSync(${argText}, 'utf8');`;
  assert.ok(reads.argNamesTarget(argText, stmtText, 'advocate.js', 'lib'));
});

check('a combined "lib/advocate.js" literal needs no separate dir literal', () => {
  const argText = "path.join(ROOT, 'lib/advocate.js')";
  const stmtText = `const daemon = fs.readFileSync(${argText}, 'utf8');`;
  assert.ok(reads.argNamesTarget(argText, stmtText, 'advocate.js', 'lib'));
});

check('a LIB(...) helper call still yields its inner literal, wrapped or not', () => {
  const argText = "LIB('advocate.js')";
  const stmtText = `const src = fs.readFileSync(${argText}, 'utf8');`;
  assert.ok(reads.argNamesTarget(argText, stmtText, 'advocate.js', 'lib'));
});

check('a LIB directory-constant + basename pair matches by the identifier name alone', () => {
  const argText = "path.join(LIB, 'advocate.js')";
  const stmtText = `const advocate = fs.readFileSync(${argText}, 'utf8');`;
  assert.ok(reads.argNamesTarget(argText, stmtText, 'advocate.js', 'lib'));
});

check('the right basename with no directory word anywhere in the statement is refused', () => {
  const argText = "somePath('advocate.js')";
  const stmtText = `const x = fs.readFileSync(${argText}, 'utf8');`;
  assert.ok(!reads.argNamesTarget(argText, stmtText, 'advocate.js', 'lib'));
});

check('an unrelated basename does not match even with the dir word present', () => {
  const argText = "path.join(ROOT, 'lib', 'session.js')";
  const stmtText = `const src = fs.readFileSync(${argText}, 'utf8');`;
  assert.ok(!reads.argNamesTarget(argText, stmtText, 'advocate.js', 'lib'));
});

/* ================================================================ 2. declaredName */

console.log('\ndeclaredName — the nearest unclosed const/let before a call\n');

check('a plain top-level declaration is its own statement', () => {
  const codeOnly = "const daemon = fs.readFileSync(x, 'utf8');";
  const at = codeOnly.indexOf('fs.readFileSync') + 'fs.readFileSync'.length;
  assert.equal(reads.declaredName(codeOnly, at), 'daemon');
});

check('a declaration nested inside a bigger check() block is found, not the block itself', () => {
  const codeOnly = [
    "check('name', () => {",
    '  const other = 1;',
    "  const src = fs.readFileSync(x, 'utf8');",
    '  assert.ok(src);',
    '});',
  ].join('\n');
  const at = codeOnly.indexOf('fs.readFileSync') + 'fs.readFileSync'.length;
  assert.equal(reads.declaredName(codeOnly, at), 'src');
});

check('a semicolon between the declaration and the call means no declaration covers it', () => {
  const codeOnly = "const other = 1; fs.readFileSync(x, 'utf8');";
  const at = codeOnly.indexOf('fs.readFileSync') + 'fs.readFileSync'.length;
  assert.equal(reads.declaredName(codeOnly, at), null);
});

/* ================================================================ 3. shapeOf */

console.log('\nshapeOf — the four flags\n');

check('a regex with a \\w class is IDENTIFIER-FAMILY', () => {
  const shape = reads.shapeOf('code.match(/heldBy\\w+/g)', 'code', { method: 'strMatch' }, { kind: 'regex', content: 'heldBy\\w+' });
  assert.equal(shape, 'IDENTIFIER-FAMILY');
});

check('two .indexOf(...) on the same holder compared with < is IMPORT-ORDER', () => {
  const stmtText = "code.indexOf('a') < code.indexOf('b')";
  const call = { method: 'indexOf', dotIndex: stmtText.indexOf('.indexOf') };
  const shape = reads.shapeOf(stmtText, 'code', call, { kind: 'string', content: 'a' });
  assert.equal(shape, 'IMPORT-ORDER');
});

check('a literal carrying a digit is HAS-COUNT', () => {
  const shape = reads.shapeOf('assert.ok(x)', 'code', { method: 'includes' }, { kind: 'string', content: 'v2 only' });
  assert.equal(shape, 'HAS-COUNT');
});

check('a spelled-out count is HAS-COUNT too, same as lib/pinned.js\'s own list', () => {
  const shape = reads.shapeOf('assert.ok(x)', 'code', { method: 'includes' }, { kind: 'string', content: 'four honest endings' });
  assert.equal(shape, 'HAS-COUNT');
});

check('an exact literal with none of the above is WHOLE-EXPRESSION', () => {
  const shape = reads.shapeOf('assert.ok(x)', 'code', { method: 'includes' }, { kind: 'string', content: 'exact words' });
  assert.equal(shape, 'WHOLE-EXPRESSION');
});

/* ================================================================ 4. readsOf against a fixture */

console.log('\nreadsOf — against a fabricated lib/ + test/ pair\n');

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-reads-test-'));

function fixture(files) {
  const root = fs.mkdtempSync(path.join(tmp, 'root-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

const LIB_SRC = `
export function createThing() {
  const record = { heldByPr: [], heldByRoot: [] };
  return record;
}
`;

const TEST_SRC = `
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve('.');
const daemon = fs.readFileSync(path.join(ROOT, 'lib/thing.js'), 'utf8');
const code = daemon.replace(/\\/\\/.*$/gm, '');

check('every heldBy* field is covered', () => {
  const fields = [...new Set(code.match(/heldBy\\w+/g) || [])].sort();
  assert.ok(fields.length >= 2);
});
`;

const root = fixture({
  'lib/thing.js': LIB_SRC,
  'test/fixture.mjs': TEST_SRC,
});

check('the suite that readFileSyncs the module is found, with the read line and the finding', () => {
  const suites = reads.readsOf(root, 'lib/thing.js', {});
  assert.equal(suites.length, 1);
  assert.equal(suites[0].file, 'fixture.mjs');
  assert.equal(suites[0].reads.length, 1);
  assert.equal(suites[0].reads[0].local, 'daemon');
  assert.equal(suites[0].findings.length, 1);
  assert.equal(suites[0].findings[0].raw, '/heldBy\\w+/g');
  assert.equal(suites[0].findings[0].shape, 'IDENTIFIER-FAMILY');
});

check('a name narrows to only the patterns it would actually trip', () => {
  const trips = reads.readsOf(root, 'lib/thing.js', { name: 'heldByWorker' });
  assert.equal(trips[0].findings.length, 1, 'heldByWorker matches /heldBy\\w+/');
  const noTrip = reads.readsOf(root, 'lib/thing.js', { name: 'somethingElse' });
  assert.equal(noTrip[0].findings.length, 0, 'a name the pattern would never match trips nothing');
  assert.equal(noTrip[0].reads.length, 1, 'the file still reads the module — only the findings narrowed');
});

check('a file nothing readFileSyncs as text yields no suites', () => {
  const quietRoot = fixture({
    'lib/quiet.js': 'export function x() { return "y"; }\n',
    'test/unrelated.mjs': "import assert from 'node:assert';\nassert.ok(true);\n",
  });
  assert.deepEqual(reads.readsOf(quietRoot, 'lib/quiet.js', {}), []);
});

check('an import of the same basename is not mistaken for a readFileSync', () => {
  const importRoot = fixture({
    'lib/imported.js': 'export function x() { return "y"; }\n',
    'test/importer.mjs': "import { x } from '../lib/imported.js';\nx();\n",
  });
  assert.deepEqual(reads.readsOf(importRoot, 'lib/imported.js', {}), []);
});

/* ================================================================ 5. the CLI */

console.log('\nbin/b7e-reads — argv, exit codes, --json\n');

check('--help exits 0 and prints usage', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /b7e-reads/);
});

check('a file nobody reads as text prints nothing and exits 0', () => {
  const quietRoot = fixture({
    'lib/quiet2.js': 'export function x() { return "y"; }\n',
    'test/unrelated.mjs': "import assert from 'node:assert';\nassert.ok(true);\n",
  });
  const r = spawnSync(process.execPath, [BIN, '--dir', quietRoot, 'lib/quiet2.js'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, '');
});

check('a path with no file there exits 2', () => {
  const r = spawnSync(process.execPath, [BIN, '--dir', root, 'lib/does-not-exist.js'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no file at/);
});

check('the fixture module prints its finding, shape and all', () => {
  const r = spawnSync(process.execPath, [BIN, '--dir', root, 'lib/thing.js'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /fixture\.mjs/);
  assert.match(r.stdout, /heldBy\\w\+/);
  assert.match(r.stdout, /IDENTIFIER-FAMILY/);
});

check('--json prints one parseable object grouped by suite', () => {
  const r = spawnSync(process.execPath, [BIN, '--dir', root, 'lib/thing.js', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const obj = JSON.parse(r.stdout);
  assert.equal(obj.file, 'lib/thing.js');
  assert.equal(obj.suites.length, 1);
  assert.equal(obj.suites[0].file, 'fixture.mjs');
});

/* ================================================================ 6. the bead's own founding example */

console.log("\nthe bead's own founding example, still true on this repo today\n");

check('b7e-reads lib/advocate.js heldByWorker names test/surveybrief.mjs, line 47 and line 153, IDENTIFIER-FAMILY', () => {
  const suites = reads.readsOf(ROOT, 'lib/advocate.js', { name: 'heldByWorker' });
  const suite = suites.find((s) => s.file === 'surveybrief.mjs');
  assert.ok(suite, 'test/surveybrief.mjs should be found reading lib/advocate.js as text');
  assert.ok(
    suite.reads.some((r) => r.line === 47),
    'the readFileSync at line 47 should be reported',
  );
  const f = suite.findings.find((x) => x.raw === '/heldBy\\w+/g');
  assert.ok(f, 'the /heldBy\\w+/g scan should be found');
  assert.equal(f.line, 153);
  assert.equal(f.shape, 'IDENTIFIER-FAMILY');
});

check('lib/where.js — a module no suite reads as text — yields nothing', () => {
  assert.deepEqual(reads.readsOf(ROOT, 'lib/where.js', {}), []);
});

/* ------------------------------------------------------------------------- verdict */

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) {
  console.log(`\n${failures} failing\n`);
  process.exit(1);
} else {
  console.log('\nall checks passed\n');
}
