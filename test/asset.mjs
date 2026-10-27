#!/usr/bin/env node
//
// b7e-asset — where a media file's bytes actually are (bc-dgx7.140).
//
//   npm test
//   node test/asset.mjs
//
// Every piece of logic in lib/asset.js is exercised directly against fabricated fixture
// trees — no rclone, no git-lfs, no network, matching the acceptance criteria's own "no
// network access" requirement. bin/b7e-asset is then driven as a real subprocess over
// the same four-state fixture, the shape test/plate.mjs uses for its own bin/ smoke test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MEDIA_EXTENSIONS,
  SIDECAR_SUFFIX,
  isMediaExt,
  isSidecarPath,
  mediaPathForSidecar,
  sidecarPathFor,
  isLfsPointerFile,
  parseLfsPointer,
  parseSidecarFrontmatter,
  readSidecar,
  resolveTargets,
  gitStatusFor,
  classifyAsset,
  buildReport,
  remoteInfo,
  fetchAsset,
} from '../lib/asset.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-asset');

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 8).join('\n       ')}`);
  }
};

console.log('\nb7e-asset\n');

/* ============================================================== path helpers */

check('isMediaExt / isSidecarPath know the recognised shapes', () => {
  assert.equal(isMediaExt('a.png'), true);
  assert.equal(isMediaExt('a.PNG'), true);
  assert.equal(isMediaExt('a.txt'), false);
  assert.ok(MEDIA_EXTENSIONS.has('.mp4'));
  assert.equal(SIDECAR_SUFFIX, '.md');
  assert.equal(isSidecarPath('a.png.md'), true);
  assert.equal(isSidecarPath('a.PNG.MD'.toLowerCase()), true);
  assert.equal(isSidecarPath('README.md'), false, 'a bare .md with no media stem is not a sidecar');
  assert.equal(isSidecarPath('UNUSABLE.md'), false, 'stripped stem has no extension at all');
  assert.equal(mediaPathForSidecar('dir/a.png.md'), 'dir/a.png');
  assert.equal(sidecarPathFor('dir/a.png'), 'dir/a.png.md');
});

/* ============================================================== lfs pointer detection */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-asset-'));

check('isLfsPointerFile recognises the real magic and rejects everything else', () => {
  const pointer = path.join(tmp, 'p.png');
  fs.writeFileSync(
    pointer,
    'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\nsize 12345\n'
  );
  assert.equal(isLfsPointerFile(pointer), true);

  const real = path.join(tmp, 'r.png');
  fs.writeFileSync(real, 'some real bytes, not a pointer at all');
  assert.equal(isLfsPointerFile(real), false);

  const missing = path.join(tmp, 'nope.png');
  assert.equal(isLfsPointerFile(missing), false, 'a nonexistent file is not a pointer');

  const big = path.join(tmp, 'big.png');
  fs.writeFileSync(big, 'version https://git-lfs.github.com/spec/v1\n' + 'x'.repeat(2000));
  assert.equal(isLfsPointerFile(big), false, 'pointers are tiny by spec — over 1024 bytes disqualifies it');

  const { oid, size } = parseLfsPointer(pointer);
  assert.equal(oid, 'a'.repeat(64));
  assert.equal(size, 12345);
});

/* ============================================================== sidecar frontmatter */

check('parseSidecarFrontmatter reads the media_vault.py sidecar shape', () => {
  const text = [
    '---',
    'kind: media-sidecar',
    'filename: base.png',
    'remote: "gdrive4t:delmar-media/webseries/library/characters/muchi/base.png"',
    'bytes: 3847221',
    'width: 2816',
    'height: 1536',
    'format: PNG',
    '---',
    '',
    '# base.png',
    '',
    'The file itself is **not in this repository**.',
  ].join('\n');
  const front = parseSidecarFrontmatter(text);
  assert.equal(front.remote, 'gdrive4t:delmar-media/webseries/library/characters/muchi/base.png');
  assert.equal(front.bytes, 3847221);
  assert.equal(front.width, 2816);
  assert.equal(front.height, 1536);
  assert.equal(front.format, 'PNG');
});

check('parseSidecarFrontmatter returns null with no frontmatter block, and a dangling sidecar has no remote', () => {
  assert.equal(parseSidecarFrontmatter('just a paragraph, no frontmatter'), null);
  const dangling = parseSidecarFrontmatter(['---', 'kind: media-sidecar', 'filename: x.png', '---', ''].join('\n'));
  assert.ok(dangling && !('remote' in dangling));
});

check('readSidecar reads a real file and is null for a missing one', () => {
  const sidecar = path.join(tmp, 'a.png.md');
  fs.writeFileSync(sidecar, '---\nremote: "gdrive4t:x"\n---\n');
  assert.equal(readSidecar(sidecar).remote, 'gdrive4t:x');
  assert.equal(readSidecar(path.join(tmp, 'nope.png.md')), null);
});

/* ============================================================== resolveTargets — the four-state fixture */

const fixture = path.join(tmp, 'fixture');
fs.mkdirSync(fixture);
fs.writeFileSync(path.join(fixture, 'real.png'), 'real bytes, not a pointer, not empty');
fs.writeFileSync(
  path.join(fixture, 'pointer.png'),
  'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'b'.repeat(64) + '\nsize 500\n'
);
fs.writeFileSync(
  path.join(fixture, 'sidecar.png.md'),
  ['---', 'remote: "gdrive4t:delmar-media/fixture/sidecar.png"', 'bytes: 42', '---', ''].join('\n')
);
fs.writeFileSync(path.join(fixture, 'dangling.png.md'), ['---', 'kind: media-sidecar', '---', ''].join('\n'));
// A non-media, non-sidecar neighbour must never surface as a row.
fs.writeFileSync(path.join(fixture, 'notes.txt'), 'irrelevant');
fs.writeFileSync(path.join(fixture, 'UNUSABLE.md'), 'not a sidecar — stripped stem has no media extension');

check('resolveTargets recursively unions real media files with sidecar-implied paths', () => {
  const { mediaPaths, sidecarOf, problems } = resolveTargets([fixture], { cwd: tmp });
  const names = mediaPaths.map((p) => path.basename(p)).sort();
  assert.deepEqual(names, ['dangling.png', 'pointer.png', 'real.png', 'sidecar.png']);
  assert.equal(problems.length, 0);
  assert.ok(sidecarOf.get(path.join(fixture, 'sidecar.png')).endsWith('sidecar.png.md'));
  assert.ok(sidecarOf.get(path.join(fixture, 'dangling.png')).endsWith('dangling.png.md'));
  assert.equal(sidecarOf.get(path.join(fixture, 'real.png')), undefined);
});

check('resolveTargets on a directory that is entirely sidecars still reports every one (dv-5eu\'s replan)', () => {
  const allSidecars = path.join(tmp, 'all-sidecars');
  fs.mkdirSync(allSidecars);
  for (const n of ['a', 'b', 'c']) {
    fs.writeFileSync(path.join(allSidecars, `${n}.png.md`), '---\nremote: "gdrive4t:x"\n---\n');
  }
  const { mediaPaths } = resolveTargets([allSidecars], { cwd: tmp });
  assert.equal(mediaPaths.length, 3, 'a directory of nothing but sidecars must not read as empty');
});

check('resolveTargets walks recursively, unlike b7e-plate\'s directory expansion', () => {
  const nested = path.join(tmp, 'nested');
  fs.mkdirSync(path.join(nested, 'sub', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(nested, 'top.png'), 'x');
  fs.writeFileSync(path.join(nested, 'sub', 'mid.png'), 'x');
  fs.writeFileSync(path.join(nested, 'sub', 'deeper', 'low.png'), 'x');
  const { mediaPaths } = resolveTargets([nested], { cwd: tmp });
  assert.equal(mediaPaths.length, 3);
});

check('resolveTargets accepts a literal sidecar path directly, resolving to the media path', () => {
  const { mediaPaths } = resolveTargets([path.join(fixture, 'sidecar.png.md')], { cwd: tmp });
  assert.equal(mediaPaths.length, 1);
  assert.equal(mediaPaths[0], path.join(fixture, 'sidecar.png'));
});

check('resolveTargets reports an unmatched glob as a problem, not a silent empty result', () => {
  const { mediaPaths, problems } = resolveTargets([path.join(fixture, '*.nope')], { cwd: tmp });
  assert.equal(mediaPaths.length, 0);
  assert.match(problems[0], /matched nothing/);
});

/* ============================================================== classifyAsset — the four states + precedence */

check('classifyAsset: bytes, lfs-pointer, sidecar-only and missing/dangling classify correctly', () => {
  const real = classifyAsset(path.join(fixture, 'real.png'), { root: tmp });
  assert.equal(real.state, 'bytes');
  assert.equal(real.size, 'real bytes, not a pointer, not empty'.length);

  const pointer = classifyAsset(path.join(fixture, 'pointer.png'), { root: tmp });
  assert.equal(pointer.state, 'lfs-pointer');
  assert.equal(pointer.size, 500);
  assert.equal(pointer.oid, 'b'.repeat(64));

  const sidecar = classifyAsset(path.join(fixture, 'sidecar.png'), {
    root: tmp,
    sidecarPathAbs: path.join(fixture, 'sidecar.png.md'),
  });
  assert.equal(sidecar.state, 'sidecar-only');
  assert.equal(sidecar.remote, 'gdrive4t:delmar-media/fixture/sidecar.png');
  assert.equal(sidecar.size, 42);

  const dangling = classifyAsset(path.join(fixture, 'dangling.png'), {
    root: tmp,
    sidecarPathAbs: path.join(fixture, 'dangling.png.md'),
  });
  assert.equal(dangling.state, 'missing', 'a sidecar with no remote is dangling, reported as missing');
  assert.ok(dangling.sidecarPath, 'the dangling sidecar path is still reported, not folded into a blank "nothing"');

  const nothing = classifyAsset(path.join(fixture, 'never-existed.png'), { root: tmp });
  assert.equal(nothing.state, 'missing');
  assert.equal(nothing.sidecarPath, null);
});

check('classifyAsset: real bytes win over a stale sidecar sitting right beside them', () => {
  const both = path.join(tmp, 'kept-local.png');
  fs.writeFileSync(both, 'real, published, and still kept on disk');
  fs.writeFileSync(both + '.md', '---\nremote: "gdrive4t:x"\n---\n');
  const row = classifyAsset(both, { root: tmp });
  assert.equal(row.state, 'bytes');
  assert.ok(row.sidecarPath, 'the sidecar is still reported for context');
  assert.equal(row.remote, 'gdrive4t:x', 'the remote it names is surfaced even though bytes are already local');
});

check('buildReport is resolveTargets + classifyAsset over a whole directory in one call', () => {
  const { rows, problems } = buildReport([fixture], { root: tmp });
  const byState = {};
  for (const r of rows) byState[r.state] = (byState[r.state] || 0) + 1;
  assert.deepEqual(byState, { bytes: 1, 'lfs-pointer': 1, 'sidecar-only': 1, missing: 1 });
  assert.equal(problems.length, 0);
});

/* ============================================================== git status, with a real repo */

check('gitStatusFor tells tracked / untracked / ignored apart, and null outside any repo', () => {
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.png\n');
  fs.writeFileSync(path.join(repo, 'tracked.png'), 'x');
  fs.writeFileSync(path.join(repo, 'untracked.png'), 'x');
  fs.writeFileSync(path.join(repo, 'ignored.png'), 'x');
  spawnSync('git', ['add', 'tracked.png', '.gitignore'], { cwd: repo });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: repo });

  assert.equal(gitStatusFor(path.join(repo, 'tracked.png')), 'tracked');
  assert.equal(gitStatusFor(path.join(repo, 'untracked.png')), 'untracked');
  assert.equal(gitStatusFor(path.join(repo, 'ignored.png')), 'ignored');
  assert.equal(gitStatusFor(path.join(repo, 'never-existed.png')), 'untracked', 'a nonexistent, non-ignored path is untracked');
  assert.equal(gitStatusFor(path.join(tmp, 'not-a-repo-path.png')), null, 'outside any git repo entirely');
});

/* ============================================================== --remote / --fetch, injected tools */

check('remoteInfo reports present + size from an injected rclone, and absent on count 0', () => {
  const present = remoteInfo('gdrive4t:x', {
    rclone: () => ({ status: 0, stdout: JSON.stringify({ count: 1, bytes: 12345 }), error: null }),
  });
  assert.deepEqual(present, { present: true, size: 12345 });

  const absent = remoteInfo('gdrive4t:missing', {
    rclone: () => ({ status: 0, stdout: JSON.stringify({ count: 0, bytes: 0 }), error: null }),
  });
  assert.deepEqual(absent, { present: false, size: null });

  const broken = remoteInfo('gdrive4t:x', { rclone: () => ({ status: 1, stdout: '', error: null }) });
  assert.equal(broken.present, false);
});

check('fetchAsset copies a sidecar-only asset via an injected rclone, mirroring its relative path', () => {
  const fetchDir = path.join(tmp, 'fetch-out-1');
  const row = classifyAsset(path.join(fixture, 'sidecar.png'), {
    root: tmp,
    sidecarPathAbs: path.join(fixture, 'sidecar.png.md'),
  });
  let sawArgs = null;
  const result = fetchAsset(row, {
    root: tmp,
    fetchDir,
    rclone: (args) => {
      sawArgs = args;
      fs.mkdirSync(path.dirname(args[2]), { recursive: true });
      fs.writeFileSync(args[2], 'fetched bytes');
      return { status: 0, stdout: '', error: null };
    },
  });
  assert.equal(result.fetched, true);
  assert.equal(sawArgs[0], 'copyto');
  assert.equal(sawArgs[1], row.remote);
  assert.equal(fs.readFileSync(result.fetchedTo, 'utf8'), 'fetched bytes');
  assert.equal(path.relative(fetchDir, result.fetchedTo), row.path);
});

check('fetchAsset smudges an lfs-pointer via injected git-lfs, then copies the result out', () => {
  const lfsRoot = path.join(tmp, 'lfs-root');
  fs.mkdirSync(lfsRoot);
  const rel = 'pointer.png';
  fs.writeFileSync(
    path.join(lfsRoot, rel),
    'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'c'.repeat(64) + '\nsize 9\n'
  );
  const row = classifyAsset(path.join(lfsRoot, rel), { root: lfsRoot });
  assert.equal(row.state, 'lfs-pointer');

  const fetchDir = path.join(tmp, 'fetch-out-2');
  const result = fetchAsset(row, {
    root: lfsRoot,
    fetchDir,
    git: (args, cwd) => {
      assert.equal(args[0], 'lfs');
      assert.equal(args[1], 'pull');
      assert.equal(cwd, lfsRoot);
      // Simulate the smudge: overwrite the pointer stub with real bytes in root.
      fs.writeFileSync(path.join(lfsRoot, rel), 'real smudged bytes');
      return { status: 0, stdout: '', error: null };
    },
  });
  assert.equal(result.fetched, true);
  assert.equal(fs.readFileSync(result.fetchedTo, 'utf8'), 'real smudged bytes');
});

check('fetchAsset reports a failed smudge (still a pointer afterwards) rather than copying the stub', () => {
  const lfsRoot = path.join(tmp, 'lfs-root-2');
  fs.mkdirSync(lfsRoot);
  fs.writeFileSync(
    path.join(lfsRoot, 'p.png'),
    'version https://git-lfs.github.com/spec/v1\noid sha256:' + 'd'.repeat(64) + '\nsize 9\n'
  );
  const row = classifyAsset(path.join(lfsRoot, 'p.png'), { root: lfsRoot });
  const result = fetchAsset(row, {
    root: lfsRoot,
    fetchDir: path.join(tmp, 'fetch-out-3'),
    git: () => ({ status: 0, stdout: '', error: null }), // "succeeds" but never actually smudges
  });
  assert.equal(result.fetched, false);
  assert.match(result.reason, /still a pointer/);
});

check('fetchAsset skips bytes and missing rows, saying why', () => {
  const bytesRow = classifyAsset(path.join(fixture, 'real.png'), { root: tmp });
  const bytesResult = fetchAsset(bytesRow, { root: tmp, fetchDir: path.join(tmp, 'fetch-out-4') });
  assert.equal(bytesResult.fetched, false);
  assert.match(bytesResult.reason, /already local/);

  const missingRow = classifyAsset(path.join(fixture, 'never-existed.png'), { root: tmp });
  const missingResult = fetchAsset(missingRow, { root: tmp, fetchDir: path.join(tmp, 'fetch-out-4') });
  assert.equal(missingResult.fetched, false);
  assert.match(missingResult.reason, /nothing to fetch/);
});

/* ============================================================== bin/b7e-asset — real subprocess */

function run(args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

check('bin/b7e-asset: --help exits 0 and needs no target', () => {
  const { status, stdout } = run(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /usage: b7e-asset/);
});

check('bin/b7e-asset: no targets refuses with exit 2', () => {
  const { status, stderr } = run([]);
  assert.equal(status, 2);
  assert.match(stderr, /needs at least one/);
});

check('bin/b7e-asset: classifies the four-state fixture, exits 1 only for the dangling one, alone', () => {
  const { status, stdout } = run([path.join(fixture, 'dangling.png'), '--dir', tmp]);
  assert.equal(status, 1);
  assert.match(stdout, /missing/);

  for (const [name, wantState] of [
    ['real.png', 'bytes'],
    ['pointer.png', 'lfs-pointer'],
    ['sidecar.png', 'sidecar-only'],
  ]) {
    const r = run([path.join(fixture, name), '--dir', tmp]);
    assert.equal(r.status, 0, `${name}: ${r.stdout}`);
    assert.match(r.stdout, new RegExp(wantState.replace('-', '\\-')));
  }
});

check('bin/b7e-asset: the whole fixture directory in one call exits 1 (one missing among four)', () => {
  const { status, stdout } = run([fixture, '--dir', tmp, '--json']);
  assert.equal(status, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.rows.length, 4);
  assert.equal(parsed.rows.filter((r) => r.state === 'missing').length, 1);
});

check('bin/b7e-asset: --dir and -w together are refused', () => {
  const { status, stderr } = run(['x', '--dir', tmp, '-w', 'nope']);
  assert.equal(status, 2);
  assert.match(stderr, /mutually exclusive/);
});

check('bin/b7e-asset: an unknown workspace name is refused with exit 2', () => {
  const { status, stderr } = run(['x', '-w', 'definitely-not-a-configured-workspace']);
  assert.equal(status, 2);
  assert.match(stderr, /no workspace named/);
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exitCode = failures ? 1 : 0;
