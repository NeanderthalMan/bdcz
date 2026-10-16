#!/usr/bin/env node
//
// b7e-derived — given a diff, name what in the tree is generated from it, and whether
// that generated file is now stale (bc-dgx7.1's session audit, moved to this tracker as
// bc-dgx7.124).
//
//   npm test
//   node test/derived.mjs
//
// lib/derived.js does the matching, the manifest reading and the running; this drives it
// against fabricated trees carrying a fake `.beadcause/derived.json`, a fake banner and a
// fake generator, so the suite never depends on any real checkout's contents. The three
// fixture generators are shaped like a real repo's — a `**` source tree feeding several
// artifacts, a single-script log builder, a `*.sheet.md` glob feeding a directory — so a
// change to the matching rules here is the same change a real manifest would see.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-derived');

const derived = await import(path.join(ROOT, 'lib', 'derived.js'));

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

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'beadcause-derived-test-'));

/** A fresh `<tmp>/<name>/` tree holding the given files at the given repo-relative paths. */
const tree = (name, files) => {
  const dir = path.join(tmp, name);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
};

const MANIFEST_PATH = path.join('.beadcause', 'derived.json');

/**
 * The three generators the bead's own acceptance criteria names, restated as a fixture —
 * `run`/`check` are `true`/`false` rather than real Python, because what is under test is
 * the matching and the plumbing around exit codes, not any repo's real scripts.
 */
const REPO_LIKE_GENERATORS = {
  generators: [
    {
      id: 'compendium/build.py',
      run: ['true'],
      check: ['false'], // always "stale", so the CLI's stale-reporting path gets exercised
      sources: ['compendium/**'],
      artifacts: [
        'compendium/web/data.js',
        'reference/maps/private/compendium.admin.js',
        'reference/maps/private/compendium.reader.js',
      ],
    },
    {
      id: 'scripts/build_series_log.py',
      run: ['true'],
      check: ['true'], // always "clean"
      sources: ['novel/**/CHAPTER_*.md'],
      artifacts: ['novel/SERIES_CHAPTER_LOG.md'],
    },
    {
      id: 'design/characters/build_prompts.py',
      sources: ['design/characters/*.sheet.md'],
      artifacts: ['design/characters/prompts/'],
    },
  ],
};

/* ===================================================================== *
 * 1. globToRegExp / matchesSource — the three glob shapes the acceptance
 *    criteria names
 * ===================================================================== */

console.log('\nglob matching\n');

check('a trailing ** matches anything under the prefix, any depth', () => {
  const re = derived.globToRegExp('compendium/**');
  assert.ok(re.test('compendium/species/sample-entry.md'));
  assert.ok(re.test('compendium/build.py'));
  assert.ok(!re.test('novel/CHAPTER_1.md'));
});

check('**/ crosses zero or more path segments', () => {
  const re = derived.globToRegExp('novel/**/CHAPTER_*.md');
  assert.ok(re.test('novel/Volume 3/CHAPTER_12.md'), 'one directory deep');
  assert.ok(re.test('novel/CHAPTER_1.md'), 'zero directories deep');
  assert.ok(re.test('novel/Volume 3/notes/CHAPTER_1.md'), '** crosses more than one segment too');
});

check('a lone * stops at a slash', () => {
  const re = derived.globToRegExp('design/characters/*.sheet.md');
  assert.ok(re.test('design/characters/hero.sheet.md'));
  assert.ok(!re.test('design/characters/sub/hero.sheet.md'), 'a single * must not cross a directory boundary');
});

check('matchesSource checks every source glob on a generator', () => {
  const g = { sources: ['a/*.md', 'b/**'] };
  assert.ok(derived.matchesSource(g, 'a/x.md'));
  assert.ok(derived.matchesSource(g, 'b/y/z.js'));
  assert.ok(!derived.matchesSource(g, 'c/x.md'));
});

/* ===================================================================== *
 * 2. loadManifest — present, absent, malformed, partially malformed
 * ===================================================================== */

console.log('\nloadManifest\n');

check('no .beadcause/derived.json at all is empty generators, no problems', () => {
  const dir = tree('no-manifest', { 'README.md': 'hi\n' });
  const { generators, problems } = derived.loadManifest(dir);
  assert.deepEqual(generators, []);
  assert.deepEqual(problems, []);
});

check('a well-formed manifest round-trips exactly', () => {
  const dir = tree('good-manifest', { [MANIFEST_PATH]: JSON.stringify(REPO_LIKE_GENERATORS) });
  const { generators, problems } = derived.loadManifest(dir);
  assert.deepEqual(problems, []);
  assert.equal(generators.length, 3);
  assert.equal(generators[0].id, 'compendium/build.py');
  assert.deepEqual(generators[0].run, ['true']);
  assert.deepEqual(generators[0].check, ['false']);
  assert.equal(generators[2].run, null, 'a generator with no run command in the manifest gets null, not []');
});

check('unparseable JSON is a problem, not a silent empty list', () => {
  const dir = tree('bad-json', { [MANIFEST_PATH]: '{ not json' });
  const { generators, problems } = derived.loadManifest(dir);
  assert.deepEqual(generators, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not parse as JSON/);
});

check('one malformed generator entry is dropped and reported; the rest still load', () => {
  const dir = tree('one-bad-entry', {
    [MANIFEST_PATH]: JSON.stringify({
      generators: [
        { id: 'ok/gen.py', sources: ['ok/**'], artifacts: ['ok/out.js'] },
        { sources: ['no-id/**'], artifacts: ['x.js'] }, // no id
        { id: 'no-sources/gen.py', artifacts: ['y.js'] }, // no sources
        { id: 'no-artifacts/gen.py', sources: ['z/**'] }, // no artifacts
      ],
    }),
  });
  const { generators, problems } = derived.loadManifest(dir);
  assert.equal(generators.length, 1);
  assert.equal(generators[0].id, 'ok/gen.py');
  assert.equal(problems.length, 3);
  assert.ok(problems.some((p) => /has no id/.test(p)));
  assert.ok(problems.some((p) => /no-sources\/gen\.py\) names no sources/.test(p)));
  assert.ok(problems.some((p) => /no-artifacts\/gen\.py\) names no artifacts/.test(p)));
});

/* ===================================================================== *
 * 3. findDerived — matched, unmatched, multiple artifacts, dedup
 * ===================================================================== */

console.log('\nfindDerived\n');

{
  const { generators } = REPO_LIKE_GENERATORS;

  check('a source file reports every artifact its generator declares', () => {
    const { results, unmatched } = derived.findDerived(['compendium/species/sample-entry.md'], generators);
    assert.deepEqual(unmatched, []);
    assert.equal(results.length, 1);
    assert.equal(results[0].generators.length, 1);
    assert.deepEqual(results[0].generators[0].artifacts, [
      'compendium/web/data.js',
      'reference/maps/private/compendium.admin.js',
      'reference/maps/private/compendium.reader.js',
    ]);
  });

  check('a chapter file reports SERIES_CHAPTER_LOG.md via build_series_log.py', () => {
    const { results } = derived.findDerived(['novel/Volume 3/CHAPTER_12.md'], generators);
    assert.equal(results.length, 1);
    assert.equal(results[0].generators[0].id, 'scripts/build_series_log.py');
    assert.deepEqual(results[0].generators[0].artifacts, ['novel/SERIES_CHAPTER_LOG.md']);
  });

  check('a character sheet reports the prompts directory', () => {
    const { results } = derived.findDerived(['design/characters/hero.sheet.md'], generators);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].generators[0].artifacts, ['design/characters/prompts/']);
  });

  check('a file with no generator is reported unmatched, never silently dropped', () => {
    const { results, unmatched } = derived.findDerived(['README.md'], generators);
    assert.deepEqual(results, []);
    assert.deepEqual(unmatched, ['README.md']);
  });

  check('a mix of matched and unmatched files: each accounted for exactly once', () => {
    const { results, unmatched } = derived.findDerived(['compendium/species/sample-entry.md', 'README.md'], generators);
    assert.equal(results.length, 1);
    assert.deepEqual(unmatched, ['README.md']);
  });

  check('the touched-generators summary is deduplicated, first-seen order', () => {
    const { generators: touched } = derived.findDerived(
      ['compendium/a.md', 'compendium/b.md', 'novel/CHAPTER_1.md'],
      generators,
    );
    assert.deepEqual(
      touched.map((g) => g.id),
      ['compendium/build.py', 'scripts/build_series_log.py'],
    );
  });
}

/* ===================================================================== *
 * 4. runCheck / runRebuild — exit codes, declared vs. undeclared commands
 * ===================================================================== */

console.log('\nrunCheck / runRebuild\n');

{
  const dir = tree('run-check', { '.keep': '' });
  const clean = { id: 'clean-gen', check: ['true'], run: ['true'] };
  const stale = { id: 'stale-gen', check: ['false'], run: null };
  const undeclared = { id: 'undeclared-gen', check: null, run: null };

  check('an exit-0 check is clean', () => {
    assert.equal(derived.runCheck(dir, clean).status, 'clean');
  });
  check('a nonzero-exit check is stale', () => {
    assert.equal(derived.runCheck(dir, stale).status, 'stale');
  });
  check('no declared check command is its own status, not "clean"', () => {
    assert.equal(derived.runCheck(dir, undeclared).status, 'no-check');
  });
  check('an exit-0 run is "ran"', () => {
    assert.equal(derived.runRebuild(dir, clean).status, 'ran');
  });
  check('no declared run command is its own status', () => {
    assert.equal(derived.runRebuild(dir, undeclared).status, 'no-run');
  });
}

/* ===================================================================== *
 * 5. the CLI — argv, exit codes, --check / --rebuild
 * ===================================================================== */

console.log('\nthe CLI\n');

{
  const dir = tree('cli', { [MANIFEST_PATH]: JSON.stringify(REPO_LIKE_GENERATORS) });

  check('a matched source file prints its artifacts and exits 0', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, 'compendium/species/sample-entry.md'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const lines = run.stdout.trim().split('\n');
    assert.equal(lines.length, 3, 'one line per artifact, three artifacts declared');
    assert.ok(lines[0].startsWith('compendium/web/data.js\t'));
  });

  check('a file with no generator: reported on stderr, exit 1', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, 'README.md'], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.equal(run.stdout, '');
    assert.match(run.stderr, /README\.md/);
  });

  check('--check runs each generator\'s own check and reports stale exactly when it exits nonzero', () => {
    const run = spawnSync(
      process.execPath,
      [BIN, '--dir', dir, '--check', 'compendium/species/sample-entry.md', 'novel/CHAPTER_1.md'],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 1, 'compendium/build.py\'s check always fails in this fixture');
    assert.match(run.stdout, /compendium\/web\/data\.js.*stale/);
    assert.match(run.stdout, /novel\/SERIES_CHAPTER_LOG\.md.*clean/);
  });

  check('--check on only the clean generator exits 0', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--check', 'novel/CHAPTER_1.md'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /clean/);
  });

  check('--rebuild runs the declared run command and reports a generator with none', () => {
    const run = spawnSync(
      process.execPath,
      [BIN, '--dir', dir, '--rebuild', 'design/characters/hero.sheet.md'],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0);
    assert.match(run.stdout, /no run command declared/);
  });

  check('--check and --rebuild together are refused with exit 2', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--check', '--rebuild'], { encoding: 'utf8' });
    assert.equal(run.status, 2);
  });

  check('neither -w nor --dir is refused with exit 2', () => {
    const run = spawnSync(process.execPath, [BIN, 'compendium/x.md'], { encoding: 'utf8' });
    assert.equal(run.status, 2);
  });

  check('an unrecognised flag is refused with exit 2', () => {
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--nope'], { encoding: 'utf8' });
    assert.equal(run.status, 2);
  });

  check('an unknown -w workspace is refused with exit 2', () => {
    const run = spawnSync(process.execPath, [BIN, '-w', 'no-such-workspace-b7ederived-test'], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /no workspace named/);
  });

  check('a checkout with no manifest at all reports so and exits 0', () => {
    const empty = tree('cli-no-manifest', { 'README.md': 'hi\n' });
    const run = spawnSync(process.execPath, [BIN, '--dir', empty, 'README.md'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.match(run.stderr, /no generators declared/);
  });

  check('a manifest that does not parse is refused with exit 2', () => {
    const broken = tree('cli-broken-manifest', { [MANIFEST_PATH]: '{ nope' });
    const run = spawnSync(process.execPath, [BIN, '--dir', broken, 'README.md'], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /does not parse as JSON/);
  });
}

/* ===================================================================== *
 * 6. ordering — "after", the implied feeds edge, and what gets pulled in
 *    (bc-dgx7.139)
 * ===================================================================== */

console.log('\nordering\n');

/**
 * a real repo's post/ chain as a fixture: three builders each write a gitignored file the
 * cut reads, and the cut says so both ways — its `sources` list those files (the implied
 * edge) and, for the slug reel, an explicit `after` too.
 */
const g = (id, extra = {}) => ({ id, sources: [`${id}.src`], artifacts: [`out/${id}.out`], run: null, check: null, after: [], ...extra });
const POST_CHAIN = [
  g('clock', { artifacts: ['docs/picturelock.md'] }),
  g('scratch'),
  g('beds'),
  g('slugreel'),
  g('cut', { sources: ['cut.src', 'docs/picturelock.md', 'out/scratch.out', 'out/beds.out'], after: ['slugreel'] }),
  g('captions'),
];
const ids = (plan) => plan.steps.map((s) => s.generator.id);
const byName = (name) => POST_CHAIN.find((x) => x.id === name);

check('an artifact matching another generator\'s sources is a feeds edge; after is its own kind', () => {
  const edges = derived.upstreamEdges(POST_CHAIN);
  assert.deepEqual(Object.fromEntries(edges.get('cut')), { slugreel: 'after', clock: 'feeds', scratch: 'feeds', beds: 'feeds' });
  assert.equal(edges.get('clock').size, 0);
});

check('a generator whose own artifact matches its own sources is not waiting on itself', () => {
  const self = [g('compendium', { sources: ['compendium/**'], artifacts: ['compendium/web/data.js'] })];
  assert.equal(derived.upstreamEdges(self).get('compendium').size, 0);
});

check('a changed upstream pulls in what reads it, and runs first', () => {
  const plan = derived.planDerived([byName('clock')], POST_CHAIN);
  assert.deepEqual(ids(plan), ['clock', 'cut']);
  assert.deepEqual(plan.steps[1].reason, { kind: 'downstream', of: 'clock' });
  assert.deepEqual(plan.steps[1].needs, ['clock']);
});

check('downstream: false keeps the list to what was touched', () => {
  assert.deepEqual(ids(derived.planDerived([byName('clock')], POST_CHAIN, { downstream: false })), ['clock']);
});

check('an upstream whose artifacts are all on disk is left alone', () => {
  const plan = derived.planDerived([byName('cut')], POST_CHAIN, { exists: () => true });
  assert.deepEqual(ids(plan), ['cut']);
  assert.deepEqual(plan.steps[0].needs, []);
});

check('an upstream with a missing artifact is pulled in ahead of the step that reads it (lm-5eu.27)', () => {
  const missing = new Set(['out/beds.out', 'out/slugreel.out']);
  const plan = derived.planDerived([byName('cut')], POST_CHAIN, { exists: (p) => !missing.has(p) });
  assert.deepEqual(ids(plan), ['beds', 'slugreel', 'cut'], 'manifest order among the prerequisites, the cut last');
  assert.deepEqual(plan.steps[0].reason, { kind: 'prerequisite', of: 'cut', missing: 'out/beds.out' });
  assert.deepEqual(plan.steps[2].needs.sort(), ['beds', 'slugreel']);
});

check('an explicit after is honoured even when the manifest lists the later generator first', () => {
  const gens = [g('d', { after: ['a'] }), g('a')];
  const plan = derived.planDerived(gens, gens);
  assert.deepEqual(ids(plan), ['a', 'd']);
});

check('two generators feeding each other fall back to after + manifest order, and say so', () => {
  const gens = [g('x', { sources: ['out/y.out'] }), g('y', { sources: ['out/x.out'] })];
  const plan = derived.planDerived(gens, gens);
  assert.deepEqual(ids(plan), ['x', 'y']);
  assert.deepEqual(plan.loop, ['x', 'y']);
  assert.deepEqual(plan.steps[0].needs, [], 'a loop edge must not make a step wait on something that runs after it');
});

check('walkPlan skips a step whose prerequisite failed, and never calls it', () => {
  const gens = [g('a'), g('b', { after: ['a'] }), g('c')];
  const called = [];
  const res = derived.walkPlan(derived.planDerived(gens, gens).steps, (x) => {
    called.push(x.id);
    return { status: x.id === 'a' ? 'failed' : 'ran', detail: '' };
  }, { blocking: new Set(['failed', 'skipped']) });
  assert.deepEqual(called, ['a', 'c']);
  assert.equal(res.get('b').status, 'skipped');
  assert.match(res.get('b').detail, /waits on a/);
});

check('after naming an unknown id or itself is dropped and reported', () => {
  const dir = tree('after-bad', {
    [MANIFEST_PATH]: JSON.stringify({
      generators: [
        { id: 'a', sources: ['a'], artifacts: ['a.out'], after: ['a', 'nope'] },
        { id: 'b', sources: ['b'], artifacts: ['b.out'], after: ['a', 'a'] },
      ],
    }),
  });
  const { generators, problems, cycles } = derived.loadManifest(dir);
  assert.deepEqual(generators[0].after, []);
  assert.deepEqual(generators[1].after, ['a']);
  assert.equal(problems.length, 2);
  assert.deepEqual(cycles, []);
});

check('an after loop is a problem, and named', () => {
  const dir = tree('after-loop', {
    [MANIFEST_PATH]: JSON.stringify({
      generators: [
        { id: 'a', sources: ['a'], artifacts: ['a.out'], after: ['b'] },
        { id: 'b', sources: ['b'], artifacts: ['b.out'], after: ['a'] },
      ],
    }),
  });
  const { problems, cycles } = derived.loadManifest(dir);
  assert.deepEqual(cycles, [['a', 'b', 'a']]);
  assert.match(problems.join('\n'), /after forms a loop: a -> b -> a/);
});

/* ===================================================================== *
 * 7. the CLI — ordered --rebuild, --plan, and refusals
 * ===================================================================== */

console.log('\nthe CLI, in order\n');

{
  // Each generator appends its id to order.log, so the log *is* the order it ran in.
  const logger = (id) => [process.execPath, '-e', `require('fs').appendFileSync('order.log', ${JSON.stringify(id + '\n')})`];
  const failer = [process.execPath, '-e', 'process.exit(3)'];
  const manifest = (gens) => ({ [MANIFEST_PATH]: JSON.stringify({ generators: gens }) });
  const chain = [
    { id: 'cut', run: logger('cut'), sources: ['cut.src', 'out/beds.out'], artifacts: ['out/cut.out'], after: ['slugreel'] },
    { id: 'beds', run: logger('beds'), sources: ['beds.src'], artifacts: ['out/beds.out'] },
    { id: 'slugreel', run: logger('slugreel'), sources: ['slug.src'], artifacts: ['out/slug.out'] },
  ];

  check('--rebuild runs prerequisites before the generator that waits on them, whatever the manifest order', () => {
    const dir = tree('cli-order', manifest(chain));
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--rebuild', 'cut.src'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'order.log'), 'utf8').trim().split('\n'), ['beds', 'slugreel', 'cut']);
    assert.match(run.stdout, /out\/beds\.out\tbeds\tbefore cut — out\/beds\.out is not there\tran/);
  });

  check('--rebuild of a changed upstream reruns what reads it, after it', () => {
    const dir = tree('cli-downstream', { ...manifest(chain), 'out/slug.out': 'x', 'out/beds.out': 'x' });
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--rebuild', 'beds.src'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'order.log'), 'utf8').trim().split('\n'), ['beds', 'cut']);
    assert.match(run.stdout, /out\/cut\.out\tcut\tvia beds\tran/);
  });

  check('a failed prerequisite skips what waits on it and exits 1', () => {
    const broken = chain.map((x) => (x.id === 'slugreel' ? { ...x, run: failer } : x));
    const dir = tree('cli-skip', manifest(broken));
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--rebuild', 'cut.src'], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'order.log'), 'utf8').trim().split('\n'), ['beds'], 'cut never ran');
    assert.match(run.stdout, /out\/cut\.out\tcut\tcut\.src\t.*skipped.* — waits on slugreel/);
  });

  check('--check reports a missing prerequisite instead of running a check that would refuse', () => {
    const checked = chain.map((x) => ({ ...x, check: logger(`check:${x.id}`) }));
    const dir = tree('cli-check-missing', { ...manifest(checked), 'out/slug.out': 'x' });
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--check', 'cut.src'], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /out\/beds\.out\tbeds\t.*missing.* — --rebuild runs beds first/);
    assert.match(run.stdout, /out\/cut\.out\tcut\t.*skipped/);
    assert.equal(fs.existsSync(path.join(dir, 'order.log')), false, 'no check ran at all');
  });

  check('--plan prints the order and the reasons and runs nothing', () => {
    const dir = tree('cli-plan', manifest(chain));
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--plan', 'cut.src'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const rows = run.stdout.trim().split('\n').map((l) => l.split('\t'));
    assert.deepEqual(rows.map((r) => r[1]), ['beds', 'slugreel', 'cut']);
    assert.equal(rows[2][3], 'after slugreel, beds');
    assert.equal(fs.existsSync(path.join(dir, 'order.log')), false);
  });

  check('plain listing names what is downstream of a changed file too', () => {
    const dir = tree('cli-list-downstream', { ...manifest(chain), 'out/slug.out': 'x', 'out/beds.out': 'x' });
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, 'beds.src'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^out\/cut\.out\t.*\tvia beds$/m);
  });

  check('an after loop refuses --rebuild with exit 2 and runs nothing', () => {
    const looped = chain.map((x) => (x.id === 'slugreel' ? { ...x, after: ['cut'] } : x));
    const dir = tree('cli-loop', manifest(looped));
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--rebuild', 'cut.src'], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /loop/);
    assert.equal(fs.existsSync(path.join(dir, 'order.log')), false);
  });

  check('two modes together are refused with exit 2', () => {
    const dir = tree('cli-two-modes', manifest(chain));
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--plan', '--conflicted'], { encoding: 'utf8' });
    assert.equal(run.status, 2);
  });
}

/* ===================================================================== *
 * 8. conflicts — the pure half
 * ===================================================================== */

console.log('\nconflicts\n');

check('conflictMarkers counts the opening and closing lines, not prose that mentions them', () => {
  assert.equal(derived.conflictMarkers('a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> theirs\n'), 2);
  assert.equal(derived.conflictMarkers('the <<<<<<< marker, in prose\n'), 0);
});

check('artifactOwner matches exactly, or under an artifact that ends in a slash', () => {
  const gens = [g('a', { artifacts: ['out/a.js'] }), g('p', { artifacts: ['prompts/'] })];
  assert.equal(derived.artifactOwner('out/a.js', gens).id, 'a');
  assert.equal(derived.artifactOwner('prompts/KESS.txt', gens).id, 'p');
  assert.equal(derived.artifactOwner('out/a.js.map', gens), null);
});

check('sideSurvival counts only each side\'s own lines, and passes a side that added none', () => {
  const base = 'header line\nshared entry\n';
  const ours = 'header line\nshared entry\nours added this\n';
  const theirs = 'header line\nshared entry\ntheirs added this\n';
  const both = derived.sideSurvival(base, ours, theirs, 'header line\nshared entry\nours added this\ntheirs added this\n');
  assert.deepEqual([both.ours.kept, both.ours.own, both.theirs.kept, both.theirs.own], [1, 1, 1, 1]);
  const lost = derived.sideSurvival(base, ours, theirs, ours);
  assert.equal(lost.theirs.kept, 0);
  assert.equal(lost.theirs.sample, 'theirs added this');
  assert.equal(derived.sideSurvival(base, base, theirs, theirs).ours.own, 0);
});

/* ===================================================================== *
 * 9. --conflicted against a real merge — lm-5i2.107 reproduced
 * ===================================================================== */

console.log('\n--conflicted, against a real merge\n');

{
  // compendium/build.py's shape: every entry file is concatenated into one bundle, so two
  // branches adding different entries never conflict in the sources and always conflict
  // in the bundle — exactly what lm-5i2.107 resolved by hand.
  const GEN = [
    "const fs = require('fs');",
    "const names = fs.readdirSync('entries').filter((n) => n.endsWith('.md')).sort();",
    "const body = names.map((n) => `// ${n}\\n` + fs.readFileSync('entries/' + n, 'utf8')).join('');",
    "fs.mkdirSync('web', { recursive: true });",
    "fs.writeFileSync('web/data.js', body);",
  ].join('\n');
  // A generator that ignores theirs: keeps only the working copy's first half. Stands in
  // for a build that silently drops a side, which the survival check must catch.
  const LOSSY = [
    "const fs = require('fs');",
    "const t = fs.readFileSync('web/data.js', 'utf8').split('\\n');",
    "const out = []; let skip = false;",
    "for (const l of t) { if (l.startsWith('<<<<<<<')) continue; if (l.startsWith('=======')) { skip = true; continue; } if (l.startsWith('>>>>>>>')) { skip = false; continue; } if (!skip) out.push(l); }",
    "fs.writeFileSync('web/data.js', out.join('\\n'));",
  ].join('\n');

  const repo = (name, gen) => {
    const dir = tree(name, {
      [MANIFEST_PATH]: JSON.stringify({
        generators: [{ id: 'build', run: [process.execPath, 'build.cjs'], sources: ['entries/**'], artifacts: ['web/data.js'] }],
      }),
      'build.cjs': GEN,
      'entries/dolor.md': 'Dolor Vanes, of the river towns\n',
      'notes.md': 'shared notes\n',
    });
    const git = (...args) =>
      spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
        cwd: dir,
        encoding: 'utf8',
      });
    const build = () => spawnSync(process.execPath, ['build.cjs'], { cwd: dir });
    git('init', '-q', '-b', 'main');
    build();
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'theirs');
    fs.writeFileSync(path.join(dir, 'entries/kess.md'), 'Kess, the ferrywoman who keeps the tally\n');
    build();
    git('add', '-A');
    git('commit', '-qm', 'theirs adds kess');
    git('checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'entries/omak.md'), 'Omak, who reads the flood marks\n');
    build();
    git('add', '-A');
    git('commit', '-qm', 'ours adds omak');
    const merge = git('merge', 'theirs');
    fs.writeFileSync(path.join(dir, 'build.cjs'), gen);
    return { dir, merge, git };
  };

  check('the fixture really is mid-merge with the bundle conflicted and the sources clean', () => {
    const { dir, merge } = repo('conflict-fixture', GEN);
    assert.notEqual(merge.status, 0, 'the merge must stop on a conflict');
    assert.deepEqual(derived.conflictedPaths(dir), ['web/data.js']);
    assert.ok(derived.conflictMarkers(fs.readFileSync(path.join(dir, 'web/data.js'), 'utf8')) >= 2);
  });

  check('--conflicted regenerates the bundle, leaves no markers, and finds both parents in it', () => {
    const { dir, git } = repo('conflict-good', GEN);
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--conflicted'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.match(run.stdout, /^web\/data\.js\tbuild\tran\t0 markers\tours \d+\/\d+ theirs \d+\/\d+$/m);
    const text = fs.readFileSync(path.join(dir, 'web/data.js'), 'utf8');
    assert.match(text, /Omak/);
    assert.match(text, /Kess/);
    assert.match(run.stderr, /nothing is staged/);
    assert.deepEqual(derived.conflictedPaths(dir), ['web/data.js'], 'still unmerged in the index — git add is the caller\'s');
    git('merge', '--abort');
  });

  check('a regeneration that drops a parent\'s side is caught and exits 1', () => {
    const { dir } = repo('conflict-lossy', LOSSY);
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--conflicted'], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stdout, /theirs 0\/\d+.*lost: .*kess/i);
  });

  check('a conflicted path no generator declares is listed for resolving by hand', () => {
    const { dir, git } = repo('conflict-byhand', GEN);
    git('merge', '--abort');
    // Both sides edit the same line of a hand-written file too.
    git('checkout', '-q', 'theirs');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'theirs notes\n');
    git('commit', '-qam', 'theirs notes');
    git('checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'our notes\n');
    git('commit', '-qam', 'our notes');
    git('merge', 'theirs');
    const run = spawnSync(process.execPath, [BIN, '--dir', dir, '--conflicted'], { encoding: 'utf8' });
    assert.equal(run.status, 1, 'notes.md still has markers, so the merge is not done');
    assert.match(run.stderr, /resolve these by hand:[\s\S]*notes\.md \(2 markers left\)/);
    assert.match(run.stdout, /web\/data\.js\tbuild\tran\t0 markers/);
  });

  check('--conflicted with nothing conflicted exits 0; outside git it refuses with exit 2', () => {
    const { dir, git } = repo('conflict-none', GEN);
    git('merge', '--abort');
    const clean = spawnSync(process.execPath, [BIN, '--dir', dir, '--conflicted'], { encoding: 'utf8' });
    assert.equal(clean.status, 0);
    assert.match(clean.stderr, /no conflicted paths/);
    const bare = tree('conflict-nogit', { [MANIFEST_PATH]: JSON.stringify(REPO_LIKE_GENERATORS) });
    const run = spawnSync(process.execPath, [BIN, '--dir', bare, '--conflicted'], { encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: tmp } });
    assert.equal(run.status, 2, run.stderr);
  });
}

/* --------------------------------------------------------------------- */

removeTreeSync(tmp);

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall derived checks passed\n');
process.exit(failures ? 1 : 0);
