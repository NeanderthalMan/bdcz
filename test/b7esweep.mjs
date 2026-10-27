#!/usr/bin/env node
/**
 * `b7e-sweep` — what a new advocate sweep still owes. lib/sweepowes.js and bin/b7e-sweep.
 *
 *     npm test
 *     node test/b7esweep.mjs
 *
 * bc-dgx7.167's acceptance, replayed:
 *
 *  1. Against this repo's own tree, nothing is owed for every sweep `tick()` reaches.
 *  2. Take one shipped sweep's line out of `WANT_OBJECT` and it names `test/wsshape.mjs`,
 *     the line to add it beside, and the call site — and **the real `test/wsshape.mjs`,
 *     run on that same edit, goes red on the same line of lib/advocate.js.** That is the
 *     claim the command exists to make, so it is checked against the suite rather than
 *     asserted beside it.
 *  3. Take a shipped sweep's clock out of `persist()` and it names lib/advocate.js and
 *     says the clock resets on restart — and says no suite would have caught it.
 *  4. A sweep shaped like bc-iaju1.4's `lapse` (a callee nobody listed, a clock restored
 *     and never written, a setting nobody documented) is reported three ways, and paying
 *     each of them clears exactly that finding.
 *
 * The finders are pure functions over text, so 4 is proved against a small fabricated
 * advocate in the real shape rather than a second checkout — the argument
 * test/b7eowes.mjs makes for the same reason. 1–3 read this repo, because a set of
 * regexes that agree with themselves is not the same claim as a set of regexes that agree
 * with lib/advocate.js.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';
import { readDocs } from '../lib/docset.js';
import {
  ADVOCATE,
  WSSHAPE,
  analyse,
  besideEntry,
  calleeAround,
  closer,
  codeOf,
  exportedFunctions,
  functionsIn,
  listEntries,
  renderFinding,
} from '../lib/sweepowes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-sweep');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7esweep-'));
process.on('exit', () => removeTreeSync(tmp));

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${String(err.message).split('\n').join('\n      ')}`);
  }
};

const kinds = (r) => r.findings.map((f) => f.kind).sort();

/* ===================================================================== *
 * the small pieces
 * ===================================================================== */

console.log('\nthe scanning helpers\n');

check('closer matches its own bracket type and ignores the others', () => {
  const s = 'f(a[1], {x})';
  assert.equal(closer(s, 1), s.length - 1);
  assert.equal(closer(s, 8), 10, 'the brace closes at its own brace');
  assert.equal(closer('{ a', 0), -1);
});

check('functionsIn finds declarations and their bodies, async or not', () => {
  const code = codeOf('async function a(x) { return 1; }\nfunction b() { if (1) { } }\nconst c = () => 1;');
  assert.deepEqual(functionsIn(code).map((f) => f.name), ['a', 'b']);
});

check('calleeAround names the innermost call and steps over grouping and keywords', () => {
  const code = codeOf('await sweepX(bd, a.workspace, { base: pick(1) });\nif (x) { audit?.noteArchive(a.workspace); }\nfor (const q of (a.workspace)) {}');
  const at = (n) => [...code.matchAll(/a\.workspace/g)][n].index;
  assert.equal(calleeAround(code, at(0)).callee, 'sweepX');
  assert.equal(calleeAround(code, at(1)).callee, 'audit?.noteArchive');
  assert.equal(calleeAround(code, at(2)), null, 'a `for (…)` is not a call');
});

check('listEntries reads a list with its line numbers and comments blanked', () => {
  const src = "// const WANT_OBJECT = ['nope'];\nconst WANT_OBJECT = [\n  // 'ghost',\n  'one',\n  'two',\n];\n";
  const l = listEntries(src, 'WANT_OBJECT');
  assert.deepEqual(l.entries, [{ name: 'one', line: 4 }, { name: 'two', line: 5 }]);
  assert.equal(listEntries(src, 'WANT_NAME'), null);
});

check('besideEntry picks the sibling that reads most like it', () => {
  const list = { entries: [{ name: 'sweepInMain', line: 3 }, { name: 'homeIn', line: 4 }, { name: 'sweepNotInMain', line: 5 }] };
  assert.equal(besideEntry(list, 'sweepLapsed').name, 'sweepNotInMain');
  assert.equal(besideEntry(list, 'zzz').name, 'sweepNotInMain', 'nothing alike: the last, so the list stays in append order');
});

check('exportedFunctions reads function and arrow exports, not constants or prose', () => {
  const src = "// export function ghost() {}\nexport async function sweepA() {}\nexport const sweepB = async (x) => 1;\nexport const LIMIT = 4;\n";
  assert.deepEqual(exportedFunctions(src).sort(), ['sweepA', 'sweepB']);
});

/* ===================================================================== *
 * a sweep shaped like bc-iaju1.4's `lapse`, in a fabricated advocate
 * ===================================================================== */

console.log('\na sweep that pays none of it, in a fabricated advocate\n');

const ADVOCATE_SRC = `
import { sweepInMain } from './inmain.js';
import { sweepLapsed } from './lapse.js';
export function createAdvocates(cfg) {
  const o = options(cfg);
  function record(ws, prev = {}) {
    return {
      workspace: ws,
      name: ws.name,
      lastTidyAt: prev.lastTidyAt || null,
      lastLapseAt: prev.lastLapseAt || null,
      // Not carried across a restart: the first tick looks.
      lastInMainAt: null,
    };
  }
  function persist() {
    const out = {};
    for (const [name, a] of advocates) {
      out[name] = {
        lastTidyAt: a.lastTidyAt,
      };
    }
    saveState(out);
  }
  async function tidy(a) {
    if (minsSince(a.lastTidyAt) < clampInt(o.tidyIntervalMinutes, 1, 60, 5)) return;
    a.lastTidyAt = iso();
  }
  async function flagInMain(a) {
    if (minsSince(a.lastInMainAt) < clampInt(o.inMainIntervalMinutes, 1, 60, 5)) return;
    a.lastInMainAt = iso();
    await sweepInMain(bd, a.workspace, dir, { base: configuredBase(cfg, a.name) });
  }
  async function lapse(a) {
    if (minsSince(a.lastLapseAt) < clampInt(o.lapseSweepMinutes, 1, 60, 5)) return;
    a.lastLapseAt = iso();
    await sweepLapsed(bd, a.workspace, { base: configuredBase(cfg, a.name) });
  }
  async function tickOne(a) {
    await tidy(a);
    await flagInMain(a);
    await lapse(a);
  }
  async function tick() {
    for (const a of order) await tickOne(a);
  }
}
`;

const WSSHAPE_SRC = `
const WANT_OBJECT = [
  'prs',
  'sweepInMain',
];
const WANT_NAME = [
  'beadKey',
  'configuredBase',
];
`;

const DOCS = [
  {
    file: 'docs/config.md',
    text: '| `advocates.tidyIntervalMinutes` | how often |\n| `advocates.inMainIntervalMinutes` | how often that looks |\n',
  },
];

const unpaid = analyse({ advocateSrc: ADVOCATE_SRC, wsshapeSrc: WSSHAPE_SRC, docs: DOCS });

check('the three unpaid registrations are found, and nothing else', () => {
  assert.deepEqual(kinds(unpaid), ['persist-drops', 'undocumented-setting', 'wsshape-unlisted']);
});

check('the callee is named against the suite that goes red, beside its neighbour', () => {
  const f = unpaid.findings.find((x) => x.kind === 'wsshape-unlisted');
  assert.equal(f.file, WSSHAPE);
  assert.equal(f.callee, 'sweepLapsed');
  assert.equal(f.line, 4, 'the line of the last sibling, which is where a new entry goes');
  assert.match(renderFinding(f), /^test\/wsshape\.mjs:4 {2}sweepLapsed is in neither WANT_OBJECT nor WANT_NAME.*in lapse\).*\[red: test\/wsshape\.mjs\]$/);
});

check('a clock restored and never written says it resets on restart, and that nothing fails', () => {
  const f = unpaid.findings.find((x) => x.kind === 'persist-drops');
  assert.equal(f.file, ADVOCATE);
  assert.match(f.message, /persist\(\) drops lastLapseAt/);
  assert.match(f.message, /resets on every restart/);
  assert.match(renderFinding(f), /\[silent: no suite fails\]$/);
  assert.equal(f.line, 20, 'beside the last clock persist() does write');
});

check('a setting read and never documented is named at the docs row to go beside', () => {
  const f = unpaid.findings.find((x) => x.kind === 'undocumented-setting');
  assert.equal(f.key, 'lapseSweepMinutes');
  assert.equal(f.file, 'docs/config.md');
  assert.equal(f.line, 2);
  assert.match(f.message, /beside `advocates\.inMainIntervalMinutes`/);
});

check('a clock record() starts at null and persist() leaves out is a decision, not a debt', () => {
  assert.equal(unpaid.notes.length, 1);
  assert.match(unpaid.notes[0].message, /lastInMainAt starts at null/);
  assert.ok(!unpaid.findings.some((f) => /lastInMainAt/.test(f.message)));
});

check('paying each one clears exactly that one', () => {
  const paidList = analyse({ advocateSrc: ADVOCATE_SRC, wsshapeSrc: WSSHAPE_SRC.replace("'sweepInMain',", "'sweepInMain',\n  'sweepLapsed',"), docs: DOCS });
  assert.deepEqual(kinds(paidList), ['persist-drops', 'undocumented-setting']);
  const paidClock = analyse({ advocateSrc: ADVOCATE_SRC.replace('lastTidyAt: a.lastTidyAt,', 'lastTidyAt: a.lastTidyAt,\n        lastLapseAt: a.lastLapseAt,'), wsshapeSrc: WSSHAPE_SRC, docs: DOCS });
  assert.deepEqual(kinds(paidClock), ['undocumented-setting', 'wsshape-unlisted']);
  const paidDoc = analyse({ advocateSrc: ADVOCATE_SRC, wsshapeSrc: WSSHAPE_SRC, docs: [{ file: 'docs/config.md', text: `${DOCS[0].text}| \`advocates.lapseSweepMinutes\` | x |\n` }] });
  assert.deepEqual(kinds(paidDoc), ['persist-drops', 'wsshape-unlisted']);
});

check('a shared row that lists two keys documents both', () => {
  const r = analyse({
    advocateSrc: ADVOCATE_SRC,
    wsshapeSrc: WSSHAPE_SRC,
    docs: [{ file: 'docs/config.md', text: '| `advocates.tidyIntervalMinutes`, `advocates.inMainIntervalMinutes`, `advocates.lapseSweepMinutes` | x |\n' }],
  });
  assert.ok(!r.findings.some((f) => f.kind === 'undocumented-setting'));
});

check('naming the sweep narrows the answer to it, by its own name or its callee', () => {
  assert.deepEqual(kinds(analyse({ advocateSrc: ADVOCATE_SRC, wsshapeSrc: WSSHAPE_SRC, docs: DOCS, sweep: 'lapse' })), ['persist-drops', 'undocumented-setting', 'wsshape-unlisted']);
  assert.deepEqual(kinds(analyse({ advocateSrc: ADVOCATE_SRC, wsshapeSrc: WSSHAPE_SRC, docs: DOCS, sweep: 'sweepLapsed' })), ['persist-drops', 'undocumented-setting', 'wsshape-unlisted']);
  const other = analyse({ advocateSrc: ADVOCATE_SRC, wsshapeSrc: WSSHAPE_SRC, docs: DOCS, sweep: 'tidy' });
  assert.deepEqual(other.findings, [], 'the sweep that pays everything owes nothing, whatever its neighbour owes');
});

check('a name nothing in the advocate uses is unknown, not "nothing owed"', () => {
  const r = analyse({ advocateSrc: ADVOCATE_SRC, wsshapeSrc: WSSHAPE_SRC, docs: DOCS, sweep: 'sweepNothing' });
  assert.equal(r.unknown, true);
});

check('the object handed to a callee that wants the name is the other direction, and is named', () => {
  const src = ADVOCATE_SRC.replace('configuredBase(cfg, a.name) });\n  }\n  async function lapse', 'configuredBase(cfg, a.workspace) });\n  }\n  async function lapse');
  const r = analyse({ advocateSrc: src, wsshapeSrc: WSSHAPE_SRC, docs: DOCS });
  const w = r.findings.filter((f) => f.kind === 'wrong-shape');
  assert.equal(w.length, 1);
  assert.equal(w[0].file, ADVOCATE);
  assert.equal(w[0].callee, 'configuredBase');
  assert.match(w[0].message, /wants the name/);
  // …and it is not also reported as an unlisted callee.
  assert.equal(r.findings.filter((f) => f.kind === 'wsshape-unlisted' && f.callee === 'configuredBase').length, 0);
});

check('bd calls on the name, and the object in a template literal, are found', () => {
  const src = ADVOCATE_SRC.replace('a.lastLapseAt = iso();', 'a.lastLapseAt = iso();\n    await bd.show(a.name, id);\n    log(`${a.workspace}`);');
  const r = analyse({ advocateSrc: src, wsshapeSrc: WSSHAPE_SRC, docs: DOCS });
  assert.equal(r.findings.filter((f) => f.kind === 'wrong-shape').length, 2);
});

check('a clock written and never restored is the same loss from the other side', () => {
  const src = ADVOCATE_SRC.replace("lastTidyAt: prev.lastTidyAt || null,", 'lastTidyAt: null,');
  const r = analyse({ advocateSrc: src, wsshapeSrc: WSSHAPE_SRC, docs: DOCS });
  const f = r.findings.find((x) => x.kind === 'record-forgets');
  assert.ok(f, 'found');
  assert.match(f.message, /never restores lastTidyAt/);
});

check('a clock with no line in record() at all is a decision nobody made', () => {
  const src = ADVOCATE_SRC.replace('      lastLapseAt: prev.lastLapseAt || null,\n', '');
  const r = analyse({ advocateSrc: src, wsshapeSrc: WSSHAPE_SRC, docs: DOCS });
  const f = r.findings.find((x) => x.kind === 'no-record-line');
  assert.ok(f);
  assert.match(f.message, /decide whether it survives a restart/);
});

check('a callback that names its own parameter o is reading a row, not a setting', () => {
  const src = ADVOCATE_SRC.replace('a.lastLapseAt = iso();', 'a.lastLapseAt = iso();\n    const n = rows.filter((o) => o.id !== x && o.rowOnly).length;\n    const m = o.readHere;');
  const keys = analyse({ advocateSrc: src, wsshapeSrc: WSSHAPE_SRC, docs: DOCS }).findings.filter((f) => f.kind === 'undocumented-setting').map((f) => f.key);
  assert.ok(!keys.includes('id') && !keys.includes('rowOnly'), keys.join(','));
  assert.ok(keys.includes('readHere'), 'an o outside the callback is still the options');
});

check('a tree it cannot read is reported as unreadable, never as clean', () => {
  const r = analyse({ advocateSrc: 'function tick() {}', wsshapeSrc: 'nothing here', docs: [] });
  assert.ok(r.findings.some((f) => f.kind === 'unreadable' && /WANT_OBJECT/.test(f.message)));
  assert.ok(r.findings.some((f) => f.kind === 'unreadable' && /record\(\)/.test(f.message)));
});

check('--module: a module the advocate never imports is not a sweep the tick reaches', () => {
  const r = analyse({ advocateSrc: ADVOCATE_SRC, wsshapeSrc: WSSHAPE_SRC, docs: DOCS, module: { rel: 'lib/stalled.js', text: 'export async function sweepStalled() {}' } });
  assert.ok(r.findings.some((f) => f.kind === 'not-wired' && /does not import \.\/stalled\.js/.test(f.message)));
  const wired = analyse({ advocateSrc: ADVOCATE_SRC, wsshapeSrc: WSSHAPE_SRC, docs: DOCS, module: { rel: 'lib/lapse.js', text: 'export async function sweepLapsed() {}' } });
  assert.ok(!wired.findings.some((f) => f.kind === 'not-wired'));
  assert.ok(wired.findings.some((f) => f.kind === 'wsshape-unlisted'), 'and the module\'s own callee is what gets checked');
  const dead = analyse({ advocateSrc: ADVOCATE_SRC, wsshapeSrc: WSSHAPE_SRC, docs: DOCS, module: { rel: 'lib/inmain.js', text: 'export async function neverCalled() {}\nexport const alsoNever = () => 1;' } });
  assert.ok(dead.findings.some((f) => f.kind === 'not-wired' && /never calls/.test(f.message)));
});

/* ===================================================================== *
 * this repo's own tree
 * ===================================================================== */

console.log("\nthis repo's own advocate\n");

const advocateSrc = fs.readFileSync(path.join(ROOT, ADVOCATE), 'utf8');
const wsshapeSrc = fs.readFileSync(path.join(ROOT, WSSHAPE), 'utf8');
const docs = readDocs(ROOT);

check('every function tick() reaches owes nothing, and the scan reached a real number of them', () => {
  const r = analyse({ advocateSrc, wsshapeSrc, docs });
  assert.deepEqual(r.findings.map(renderFinding), []);
  assert.ok(r.reached.length >= 20, `expected the ~32 functions tick() reaches, found ${r.reached.length}`);
  for (const name of ['tidy', 'flagInMain', 'flagNotInMain', 'inflight', 'landed', 'clearFarBlocked']) {
    assert.ok(r.reached.includes(name), `${name} is reached from tick()`);
  }
});

check('the deliberate null-at-boot clocks are notes, and there are enough of them to mean it', () => {
  const r = analyse({ advocateSrc, wsshapeSrc, docs });
  const names = r.notes.map((n) => n.message.split(' ')[0]);
  for (const c of ['lastLandedAt', 'lastSupersededAt', 'lastFarBlockedAt', 'lastFinishedEpicAt', 'lastInMainAt', 'lastNotInMainAt', 'lastInflightAt']) {
    assert.ok(names.includes(c), `${c} is a decision record() carries`);
  }
});

// The advocate's own edits, made to the text rather than the file.
const without = (src, line) => {
  assert.ok(src.includes(line), `fixture drifted: ${JSON.stringify(line)} is no longer in the source`);
  return src.replace(line, '');
};

check("taking a shipped sweep out of WANT_OBJECT names test/wsshape.mjs, the line, and the call site", () => {
  const edited = without(wsshapeSrc, "  'sweepInMain',\n");
  const r = analyse({ advocateSrc, wsshapeSrc: edited, docs });
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.file, WSSHAPE);
  assert.equal(f.callee, 'sweepInMain');
  assert.equal(f.fn, 'flagInMain');
  assert.match(f.message, /called at lib\/advocate\.js:\d+ in flagInMain/);
  assert.ok(f.line > 0);
});

check("taking a shipped clock out of persist() names lib/advocate.js and says it resets on restart", () => {
  const edited = without(advocateSrc, '        lastTidyAt: a.lastTidyAt,\n');
  const r = analyse({ advocateSrc: edited, wsshapeSrc, docs });
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.file, ADVOCATE);
  assert.equal(f.kind, 'persist-drops');
  assert.match(f.message, /resets on every restart/);
  assert.ok(f.fns.includes('tidy'), `attributed to the sweep that keeps the clock: ${f.fns}`);
  assert.deepEqual(analyse({ advocateSrc: edited, wsshapeSrc, docs, sweep: 'tidy' }).findings.length, 1);
  assert.deepEqual(analyse({ advocateSrc: edited, wsshapeSrc, docs, sweep: 'flagInMain' }).findings, []);
});

/**
 * The claim that makes the first of those worth having: the suite really does go red on
 * that edit, on the line this reports. A copy of test/wsshape.mjs is edited and run from a
 * scratch tree whose lib/ and bin/ are this repo's own.
 */
check('the real test/wsshape.mjs goes red on the same edit, at the call site this names', () => {
  const cross = path.join(tmp, 'cross');
  fs.mkdirSync(path.join(cross, 'test'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'lib'), path.join(cross, 'lib'));
  fs.symlinkSync(path.join(ROOT, 'bin'), path.join(cross, 'bin'));
  fs.symlinkSync(path.join(ROOT, 'test', 'helpers'), path.join(cross, 'test', 'helpers'));
  const run = () => spawnSync(process.execPath, [path.join(cross, 'test', 'wsshape.mjs')], { encoding: 'utf8', cwd: cross });

  fs.writeFileSync(path.join(cross, 'test', 'wsshape.mjs'), wsshapeSrc);
  const clean = run();
  assert.equal(clean.status, 0, `unedited copy should be green:\n${clean.stdout}${clean.stderr}`);

  const edited = without(wsshapeSrc, "  'sweepInMain',\n");
  fs.writeFileSync(path.join(cross, 'test', 'wsshape.mjs'), edited);
  const red = run();
  assert.notEqual(red.status, 0, 'the edited copy must fail');
  const said = `${red.stdout}${red.stderr}`.match(/lib\/advocate\.js:(\d+) — .*sweepInMain\(/);
  assert.ok(said, `wsshape names a sweepInMain call site:\n${red.stdout}${red.stderr}`);

  const ours = analyse({ advocateSrc, wsshapeSrc: edited, docs }).findings[0];
  assert.match(ours.message, new RegExp(`lib/advocate\\.js:${said[1]}\\b`), 'and it is the very line this command names');
});

/* ===================================================================== *
 * the command
 * ===================================================================== */

console.log('\nthe command\n');

const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd: ROOT, ...opts });

check('it is executable, extensionless, and declares its own grant', () => {
  assert.ok(fs.statSync(BIN).mode & 0o100, 'chmod +x');
  const head = fs.readFileSync(BIN, 'utf8').split('\n');
  assert.equal(head[0], '#!/usr/bin/env node');
  assert.ok(head.slice(0, 60).some((l) => /^\s*\*\s*@grant read\s*$/.test(l)), '@grant read in the header');
});

check('against this tree: exit 0 and one line saying so', () => {
  const r = run([]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^nothing owed across the \d+ functions tick\(\) reaches/);
});

/** A scratch checkout holding just what the command reads, with `lapse` bolted on. */
function fixtureRoot(name, { advocate, wsshape }) {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'advocate.js'), advocate);
  fs.writeFileSync(path.join(root, 'test', 'wsshape.mjs'), wsshape);
  fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n');
  fs.writeFileSync(path.join(root, 'docs', 'config.md'), DOCS[0].text);
  return root;
}

const fx = fixtureRoot('owes', { advocate: ADVOCATE_SRC, wsshape: WSSHAPE_SRC });
fs.writeFileSync(path.join(fx, 'lib', 'lapse.js'), 'export async function sweepLapsed() {}\n');

check('owing something: one line each, exit 1, with --dir', () => {
  const r = run(['--dir', fx]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const lines = r.stdout.trim().split('\n').filter((l) => l && !l.startsWith('\n'));
  assert.equal(lines.filter((l) => /\[(red|silent)/.test(l)).length, 3);
  assert.match(r.stdout, /test\/wsshape\.mjs:4 {2}sweepLapsed is in neither/);
  assert.match(r.stdout, /3 owed across/);
});

check('a named sweep and its module: narrowed, wired, and --all shows what is deliberate', () => {
  const r = run(['lapse', '--module', 'lib/lapse.js', '--dir', fx, '--all']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /3 owed for lapse, sweepLapsed/);
  assert.ok(!/not import/.test(r.stdout), 'lib/lapse.js is imported by the fixture advocate');
  const clean = run(['tidy', '--dir', fx, '--all']);
  assert.equal(clean.status, 0);
});

check('--json is one parseable object with the same findings', () => {
  const r = run(['--json', '--dir', fx]);
  assert.equal(r.status, 1);
  const o = JSON.parse(r.stdout);
  assert.equal(o.owed.length, 3);
  assert.ok(Array.isArray(o.deliberate) && Array.isArray(o.reached));
});

check('exit codes: 2 for usage, 4 for a missing file, an unknown sweep and a missing module', () => {
  assert.equal(run(['--nope']).status, 2);
  assert.equal(run(['a', 'b']).status, 2);
  assert.equal(run(['--module']).status, 2);
  assert.equal(run(['--dir', path.join(tmp, 'absent')]).status, 4);
  const unknown = run(['sweepNothing', '--dir', fx]);
  assert.equal(unknown.status, 4);
  assert.match(unknown.stderr, /nothing in lib\/advocate\.js is named or calls "sweepNothing"/);
  assert.equal(run(['--module', 'lib/none.js', '--dir', fx]).status, 4);
  assert.equal(run(['--module', '../outside.js', '--dir', fx]).status, 2);
});

check('it reads the checkout it is run in, not the one it lives in', () => {
  // The copy of a b7e-* command that runs is always main's, so a root taken from the
  // script's own path would judge main's advocate from every worktree.
  const repo = fixtureRoot('owes-git', { advocate: ADVOCATE_SRC, wsshape: WSSHAPE_SRC });
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  const r = run([], { cwd: repo });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /3 owed across/);
});

check('--help says what it reads and exits 0', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /WANT_OBJECT\/WANT_NAME/);
});

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
