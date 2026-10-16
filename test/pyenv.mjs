#!/usr/bin/env node
/**
 * `b7e-pyenv` and `lib/pyenv.js` — which local Python env already has the packages a
 * probe needs, and what is already sitting in the Hugging Face cache. bc-dgx7.180.
 *
 *   npm test
 *   node test/pyenv.mjs
 *
 * Every python interpreter here is a fake — a tiny Node script standing in for
 * `python3`, driven by a JSON manifest sitting next to it — because this suite has to
 * be hermetic and fast, and shelling out to a real interpreter per check would be
 * neither. `bin/b7e-pyenv`'s own probe script (the `-c` argument it hands a real
 * python) is matched against by regex here, so a change to that script's shape that
 * this fake can no longer parse is itself a signal worth noticing.
 *
 * The Hugging Face cache fixtures reproduce the one real bug this bead's own testing
 * against a live Mac caught: a diffusers-format repo nests its weight files a folder
 * deep per component (`image_encoder/model.safetensors`), and a flat read of the
 * snapshot revision directory sees only the component folder name, never the weight
 * file inside it — misreading a multi-gigabyte model as "metadata only". See the
 * `nested component folder` check below.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';
import {
  defaultRepoRoot,
  pythonOf,
  REPO_LOCAL_ENV_NAMES,
  scratchpadEnvDirs,
  candidateEnvironments,
  probeInterpreter,
  probeAll,
  satisfiesAll,
  repoNameFromCacheDirName,
  formatSize,
  WEIGHT_EXTENSIONS,
  describeCacheEntry,
  hfCacheEntries,
} from '../lib/pyenv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-pyenv');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-pyenv-'));
process.on('exit', () => removeTreeSync(tmp));

/* ------------------------------------------------------------------- harness */

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 10).join('\n       ')}`);
  }
};

/* ------------------------------------------------------------------- fake python */

/** A fake `python3` that answers `--version` and the exact `-c` probe scripts
 * `lib/pyenv.js` sends, off a manifest written beside it — no real interpreter
 * involved, so the suite stays hermetic. */
function writeFakeEnv(envDir, { version = '3.12.1', modules = {}, mps = null } = {}) {
  fs.mkdirSync(path.join(envDir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(envDir, 'MANIFEST.json'), JSON.stringify({ version, modules, mps }));
  const script = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'MANIFEST.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('Python ' + manifest.version); process.exit(0); }
if (args[0] === '-c') {
  const script = args[1] || '';
  if (script.includes('torch.backends.mps')) {
    if (manifest.mps === null || manifest.mps === undefined) process.exit(1);
    console.log(manifest.mps ? 'True' : 'False');
    process.exit(0);
  }
  const m = /mod = "([^"]+)"/.exec(script);
  const mod = m && m[1];
  if (mod && Object.prototype.hasOwnProperty.call(manifest.modules, mod)) {
    console.log(manifest.modules[mod]);
    process.exit(0);
  }
  process.exit(1);
}
process.exit(1);
`;
  const py = path.join(envDir, 'bin', 'python3');
  fs.writeFileSync(py, script, { mode: 0o755 });
  return py;
}

/* ------------------------------------------------------------------- repoRoot / env discovery */

check('defaultRepoRoot builds ~/projects/<workspace>', () => {
  assert.equal(defaultRepoRoot('loremia', { homeDir: '/home/x' }), '/home/x/projects/loremia');
});

check('pythonOf finds bin/python3 over bin/python, and null when neither exists', () => {
  const empty = path.join(tmp, 'no-python-env');
  fs.mkdirSync(empty, { recursive: true });
  assert.equal(pythonOf(empty), null);

  const withPython = path.join(tmp, 'python-only-env');
  fs.mkdirSync(path.join(withPython, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(withPython, 'bin', 'python'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(pythonOf(withPython), path.join(withPython, 'bin', 'python'));

  const withPython3 = path.join(tmp, 'python3-env');
  fs.mkdirSync(path.join(withPython3, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(withPython3, 'bin', 'python3'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(pythonOf(withPython3), path.join(withPython3, 'bin', 'python3'));
});

check('REPO_LOCAL_ENV_NAMES names every env directory this bead\'s own sessions actually built', () => {
  for (const name of ['.venv', '.pwenv', '.ltxenv', 'venv', 'env']) {
    assert.ok(REPO_LOCAL_ENV_NAMES.includes(name), `missing ${name}`);
  }
});

check('scratchpadEnvDirs finds a bin/python under a nested scratchpad, ignores one past maxAgeDays', () => {
  const scratchpadRoot = path.join(tmp, 'scratch-root');
  const liveDir = path.join(scratchpadRoot, 'claude-501', 'cwd-slug', 'session-a', 'scratchpad', 'ldenv');
  writeFakeEnv(liveDir, {});
  const staleDir = path.join(scratchpadRoot, 'claude-501', 'cwd-slug', 'session-b', 'scratchpad', 'oldenv');
  writeFakeEnv(staleDir, {});
  const oldTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  fs.utimesSync(staleDir, oldTime, oldTime);

  const found = scratchpadEnvDirs({ scratchpadRoot, maxAgeDays: 30 });
  assert.ok(found.includes(liveDir), 'live scratchpad env not found');
  assert.ok(!found.includes(staleDir), 'stale scratchpad env should have been excluded');
});

check('candidateEnvironments orders repo-local envs, then the share dir, then scratchpad, deduped', () => {
  const repoRoot = path.join(tmp, 'repo-a');
  const homeDir = path.join(tmp, 'home-a');
  const scratchpadRoot = path.join(tmp, 'scratch-a');

  const venv = path.join(repoRoot, '.venv');
  writeFakeEnv(venv, {});
  const shareEnv = path.join(homeDir, '.local', 'share', 'repo-a', 'ldenv');
  writeFakeEnv(shareEnv, {});
  const scratchEnv = path.join(scratchpadRoot, 'claude-501', 'cwd', 'sess', 'scratchpad', 'qenv');
  writeFakeEnv(scratchEnv, {});
  // an empty dir with no python inside must never be offered as a candidate
  fs.mkdirSync(path.join(repoRoot, '.pwenv'), { recursive: true });

  const { envs } = candidateEnvironments('repo-a', { homeDir, repoRoot, scratchpadRoot });
  assert.deepEqual(envs, [venv, shareEnv, scratchEnv]);
});

/* ------------------------------------------------------------------- probing */

check('probeInterpreter reports each requested module\'s version or null for missing', () => {
  const envDir = path.join(tmp, 'probe-env-a');
  const py = writeFakeEnv(envDir, { version: '3.12.7', modules: { torch: '2.14.0', diffusers: '0.40.0' } });
  const row = probeInterpreter(py, ['torch', 'diffusers', 'fal_client']);
  assert.equal(row.path, py);
  assert.equal(row.version, '3.12.7');
  assert.equal(row.modules.torch, '2.14.0');
  assert.equal(row.modules.diffusers, '0.40.0');
  assert.equal(row.modules.fal_client, null);
});

check('probeInterpreter only asks about MPS when torch was requested and found', () => {
  const withTorch = writeFakeEnv(path.join(tmp, 'probe-mps-yes'), { modules: { torch: '2.1.0' }, mps: true });
  assert.equal(probeInterpreter(withTorch, ['torch']).mps, true);

  const noTorchRequested = writeFakeEnv(path.join(tmp, 'probe-mps-no-ask'), { modules: { torch: '2.1.0' }, mps: true });
  assert.equal(probeInterpreter(noTorchRequested, ['diffusers']).mps, null);

  const torchMissing = writeFakeEnv(path.join(tmp, 'probe-mps-missing'), { modules: {}, mps: true });
  assert.equal(probeInterpreter(torchMissing, ['torch']).mps, null);
});

check('probeAll labels the winner by env root, and satisfiesAll finds the one row with everything', () => {
  const repoRoot = path.join(tmp, 'repo-b');
  const homeDir = path.join(tmp, 'home-b');
  writeFakeEnv(path.join(repoRoot, '.venv'), { modules: {} });
  const ldenv = path.join(homeDir, '.local', 'share', 'repo-b', 'ldenv');
  writeFakeEnv(ldenv, { modules: { torch: '2.14.0', diffusers: '0.40.0', transformers: '5.17.0' } });

  const rows = probeAll('repo-b', ['torch', 'diffusers', 'transformers'], { homeDir, repoRoot, scratchpadRoot: path.join(tmp, 'no-scratch-b') });
  const labels = rows.map((r) => r.label);
  assert.ok(labels.includes(path.join(repoRoot, '.venv')));
  assert.ok(labels.includes(ldenv));

  const winner = satisfiesAll(rows, ['torch', 'diffusers', 'transformers']);
  assert.equal(winner.label, ldenv);
});

check('satisfiesAll answers null both when nothing was asked for and when nothing qualifies', () => {
  const rows = [{ label: 'a', modules: { torch: null } }];
  assert.equal(satisfiesAll(rows, []), null);
  assert.equal(satisfiesAll(rows, ['torch']), null);
});

/* ------------------------------------------------------------------- Hugging Face cache */

check('repoNameFromCacheDirName reads models--org--repo and datasets--repo, and refuses anything else', () => {
  assert.deepEqual(repoNameFromCacheDirName('models--h94--IP-Adapter'), { kind: 'models', name: 'h94/IP-Adapter' });
  assert.deepEqual(repoNameFromCacheDirName('datasets--squad'), { kind: 'datasets', name: 'squad' });
  assert.equal(repoNameFromCacheDirName('version.txt'), null);
});

check('formatSize matches du -sh\'s own style', () => {
  assert.equal(formatSize(0), '0B');
  assert.equal(formatSize(1023), '1023B');
  assert.equal(formatSize(1024), '1.0K');
  assert.equal(formatSize(3_400_000_000), '3.2G');
  assert.equal(formatSize(1024 * 1024 * 1024 * 3.4), '3.4G');
});

/** A real Hugging Face hub cache entry has its content in `blobs/`, with `snapshots/`
 * holding symlinks to it — mirrors what this bead's own real-Mac testing found. */
function writeBlobEntry(entryDir, filesInSnapshot) {
  const rev = 'deadbeef';
  const blobsDir = path.join(entryDir, 'blobs');
  const snapshotDir = path.join(entryDir, 'snapshots', rev);
  fs.mkdirSync(blobsDir, { recursive: true });
  for (const [relPath, content] of Object.entries(filesInSnapshot)) {
    const blobName = `blob-${relPath.replace(/[/\\]/g, '_')}`;
    fs.writeFileSync(path.join(blobsDir, blobName), content);
    const target = path.join(snapshotDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(path.join(blobsDir, blobName), target);
  }
}

check('describeCacheEntry: a config-only entry is metadata only', () => {
  const entryDir = path.join(tmp, 'hub-a', 'models--org--config-only');
  writeBlobEntry(entryDir, { 'config.json': '{}' });
  const entry = describeCacheEntry(entryDir);
  assert.equal(entry.name, 'org/config-only');
  assert.equal(entry.metadataOnly, true);
  assert.equal(entry.sizeLabel, 'metadata only');
});

check('describeCacheEntry: a weight file nested a folder deep is still found (the real bug this bead caught)', () => {
  const entryDir = path.join(tmp, 'hub-a', 'models--org--nested-weights');
  const bigWeight = Buffer.alloc(2 * 1024 * 1024, 1); // 2M, comfortably past the metadata-only floor
  writeBlobEntry(entryDir, {
    'config.json': '{}',
    'image_encoder/config.json': '{}',
    'image_encoder/model.safetensors': bigWeight,
  });
  const entry = describeCacheEntry(entryDir);
  assert.equal(entry.metadataOnly, false, 'a weight file one folder deep must not read as metadata-only');
  assert.equal(entry.sizeLabel, '2.0M');
});

check('describeCacheEntry: extension list actually matches every WEIGHT_EXTENSIONS entry', () => {
  for (const ext of WEIGHT_EXTENSIONS) {
    const entryDir = path.join(tmp, 'hub-ext', `models--org--x${ext.replace('.', '')}`);
    writeBlobEntry(entryDir, { [`model${ext}`]: Buffer.alloc(2_000_000, 1) });
    const entry = describeCacheEntry(entryDir);
    assert.equal(entry.metadataOnly, false, `${ext} was not recognized as a weight extension`);
  }
});

check('hfCacheEntries filters by --model substring, case-insensitively, and sorts largest first', () => {
  const hubDir = path.join(tmp, 'hub-b');
  writeBlobEntry(path.join(hubDir, 'models--h94--IP-Adapter'), { 'model.safetensors': Buffer.alloc(3_000_000, 1) });
  writeBlobEntry(path.join(hubDir, 'models--depth-anything--Depth-Anything-V2-Base'), { 'config.json': '{}' });
  writeBlobEntry(path.join(hubDir, 'models--stabilityai--stable-diffusion-xl-base-1.0'), {
    'unet/model.safetensors': Buffer.alloc(6_000_000, 1),
  });

  const all = hfCacheEntries({ hubDir });
  assert.equal(all.length, 3);
  assert.equal(all[0].name, 'stabilityai/stable-diffusion-xl-base-1.0');
  assert.equal(all[1].name, 'h94/IP-Adapter');
  assert.equal(all[2].name, 'depth-anything/Depth-Anything-V2-Base');
  assert.equal(all[2].metadataOnly, true);

  const filtered = hfCacheEntries({ hubDir, modelGlob: 'ip-adapter' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, 'h94/IP-Adapter');
});

check('hfCacheEntries answers [] for a cache directory that does not exist, rather than throwing', () => {
  assert.deepEqual(hfCacheEntries({ hubDir: path.join(tmp, 'does-not-exist') }), []);
});

/* ------------------------------------------------------------------- CLI */

check('bin/b7e-pyenv --help exits 0 without touching a workspace', () => {
  const res = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /usage: b7e-pyenv/);
});

check('bin/b7e-pyenv refuses a bad invocation with exit code 2', () => {
  const res = spawnSync(process.execPath, [BIN], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /-w\/--workspace is required/);
});

check('bin/b7e-pyenv --json against a --dir fixture names the interpreter satisfying --need, and reports the cache', () => {
  const repoRoot = path.join(tmp, 'cli-repo');
  writeFakeEnv(path.join(repoRoot, '.venv'), { version: '3.12.1', modules: { torch: '2.0.0' } });
  const res = spawnSync(process.execPath, [BIN, '-w', 'anything-not-configured', '--dir', repoRoot, '--need', 'torch', '--json'], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.satisfiesAll, path.join(repoRoot, '.venv'));
  assert.ok(Array.isArray(parsed.cache));
});

/* ------------------------------------------------------------------- registration */

check('bin/b7e-pyenv declares @grant read, and lib/tooldecl.js picks it up with no hand-edit owed', () => {
  const header = fs.readFileSync(BIN, 'utf8');
  assert.match(header, /@grant read/);
});

check('bin/b7e-pyenv is extensionless and executable, so it resolves on PATH the way every other b7e-* command does', () => {
  const st = fs.statSync(BIN);
  assert.equal(st.mode & 0o111, 0o111);
  assert.equal(path.extname(BIN), '');
});

process.exit(failures ? 1 : 0);
