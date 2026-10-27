#!/usr/bin/env node
/**
 * A fresh worktree makes itself runnable, or says exactly why it cannot — bc-th3i.
 *
 *     node test/preflight.mjs
 *
 * A worktree of this repo has neither `node_modules` nor `public/vendor`, and before
 * `lib/borrow.js` each gap surfaced as some other suite's content assertion — four full
 * runs to get past setup in design-system-z665. What is pinned here, all against
 * synthesized checkouts under `$TMPDIR` laid out the way `.claude/worktrees/<name>` is:
 *
 * - a tree that declares neither prerequisite is left alone (every runner fixture is one);
 * - a fresh worktree is repaired into the *shapes* that work: a `node_modules` symlink,
 *   and a real `public/vendor/` of seven file links — never a linked directory, which
 *   `test/gitignoreresidue.mjs` fails over (bc-0i27.25);
 * - repairing twice does nothing the second time;
 * - what cannot be borrowed is named with the command, not attempted;
 * - `scripts/test.mjs` stops before the first suite on an unrepairable tree, and repairs
 *   and runs on a repairable one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { bundlesOf, inspect, mainCheckoutOf, repair } from '../lib/borrow.js';

// The runner below takes a machine-wide gate slot; see test/testrunner.mjs for why a suite
// that spawns one opts out.
process.env.BEADCAUSE_GATE_SLOTS = '0';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

let failures = 0;
let ran = 0;
const check = (name, cond, detail) => {
  ran += 1;
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  else {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      ${detail}` : ''}`);
  }
};

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-preflight-')));
const write = (p, body) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
/** What this repo's own `scripts/vendor.js` writes — the list the preflight checks against. */
const BUNDLES = bundlesOf(ROOT);
check('bundlesOf reads the seven names out of scripts/vendor.js', BUNDLES.length === 7 && BUNDLES.includes('xterm.css'), JSON.stringify(BUNDLES));

const PKG = JSON.stringify({ name: 'x', type: 'module', dependencies: { yaml: '*' } });

/** A tree that can run `scripts/vendor.js` — the real one, which imports nothing. */
function seedTree(dir) {
  write(path.join(dir, 'package.json'), PKG);
  for (const rel of ['scripts/vendor.js']) {
    write(path.join(dir, rel), fs.readFileSync(path.join(ROOT, rel)));
  }
}

/** A main checkout with everything a worktree borrows. */
function seedMain(dir, { modules = true, vendor = true } = {}) {
  seedTree(dir);
  if (modules) write(path.join(dir, 'node_modules', 'yaml', 'package.json'), '{}');
  if (vendor) for (const to of BUNDLES) write(path.join(dir, 'public', 'vendor', to), `/* ${to} */`);
}

const worktreeOf = (main, name) => path.join(main, '.claude', 'worktrees', name);

// ── nothing declared, nothing said ───────────────────────────────────────────
{
  const bare = path.join(tmp, 'bare');
  write(path.join(bare, 'test', 'a.mjs'), '');
  check('a tree with no dependencies and no scripts/vendor.js has nothing to say', inspect(bare).length === 0, JSON.stringify(inspect(bare)));
  check('mainCheckoutOf is null outside .claude/worktrees', mainCheckoutOf(bare) === null);
}

// ── a fresh worktree is repaired into the shapes that work ───────────────────
{
  const main = path.join(tmp, 'main');
  seedMain(main);
  const wt = worktreeOf(main, 'fresh');
  seedTree(wt);
  check('mainCheckoutOf finds the checkout above .claude/worktrees', mainCheckoutOf(wt) === main, mainCheckoutOf(wt));

  const found = inspect(wt).map((p) => p.id).sort();
  check('a fresh worktree reports both gaps, each as repairable', found.join() === 'node_modules,vendor' && inspect(wt).every((p) => p.repairable), JSON.stringify(inspect(wt)));

  const { done, left } = repair(wt);
  check('repair leaves nothing outstanding', left.length === 0, JSON.stringify(left));
  check('and says what it did', done.length === 2, JSON.stringify(done));
  const nm = fs.lstatSync(path.join(wt, 'node_modules'));
  check('node_modules is a symlink to the main checkout', nm.isSymbolicLink() && fs.realpathSync(path.join(wt, 'node_modules')) === path.join(main, 'node_modules'));
  const vd = fs.lstatSync(path.join(wt, 'public', 'vendor'));
  check('public/vendor is a real directory, never a linked one (bc-0i27.25)', vd.isDirectory() && !vd.isSymbolicLink());
  const linked = BUNDLES.every((to) => {
    const p = path.join(wt, 'public', 'vendor', to);
    return fs.lstatSync(p).isSymbolicLink() && fs.readFileSync(p, 'utf8') === `/* ${to} */`;
  });
  check(`each of the ${BUNDLES.length} bundles is a link that resolves into the main checkout`, linked);

  const again = repair(wt);
  check('repairing a second time does nothing', again.done.length === 0 && again.left.length === 0, JSON.stringify(again));

  // The shape bc-0i27.25 broke: a linked directory is named, and repaired into files.
  fs.rmSync(path.join(wt, 'public', 'vendor'), { recursive: true, force: true });
  fs.symlinkSync(path.join('..', '..', '..', '..', '..', 'public', 'vendor'), path.join(wt, 'public', 'vendor'));
  check('a symlinked public/vendor is reported as its own problem', inspect(wt).some((p) => p.id === 'vendor-dir'), JSON.stringify(inspect(wt)));
  const fixed = repair(wt);
  const after = fs.lstatSync(path.join(wt, 'public', 'vendor'));
  check('and repaired into a real directory of links', fixed.left.length === 0 && after.isDirectory() && !after.isSymbolicLink(), JSON.stringify(fixed));
}

// ── what cannot be borrowed is named, never attempted ────────────────────────
{
  const main = path.join(tmp, 'main-bare');
  seedMain(main, { modules: false });
  const wt = worktreeOf(main, 'stranded');
  seedTree(wt);
  const nm = inspect(wt).find((p) => p.id === 'node_modules');
  check('with nothing to borrow, node_modules is not repairable', nm && !nm.repairable, JSON.stringify(nm));
  check('and the fix it names is an install in the main checkout', nm && /npm install --prefix/.test(nm.fix), nm?.fix);
  repair(wt);
  check('and repair leaves node_modules absent rather than dangling', !fs.existsSync(path.join(wt, 'node_modules')) && (() => {
    try {
      fs.lstatSync(path.join(wt, 'node_modules'));
      return false;
    } catch {
      return true;
    }
  })());

  const own = worktreeOf(path.join(tmp, 'main'), 'own-tree');
  seedTree(own);
  fs.mkdirSync(path.join(own, 'node_modules', 'other'), { recursive: true });
  const real = inspect(own).find((p) => p.id === 'node_modules');
  check('an incomplete real node_modules is never replaced on its own', real && !real.repairable, JSON.stringify(real));
}

// ── the front door and the runner ────────────────────────────────────────────
{
  const main = path.join(tmp, 'main-run');
  seedMain(main);
  const wt = worktreeOf(main, 'run');
  seedTree(wt);
  const pre = path.join(ROOT, 'scripts', 'preflight.mjs');
  const checkOnly = spawnSync(process.execPath, [pre, '--dir', wt, '--check'], { encoding: 'utf8' });
  check('preflight --check on a fresh worktree exits 1 and names both gaps', checkOnly.status === 1 && /node_modules/.test(checkOnly.stdout) && /public\/vendor/.test(checkOnly.stdout), checkOnly.stdout + checkOnly.stderr);
  check('and changes nothing', !fs.existsSync(path.join(wt, 'node_modules')));

  write(path.join(wt, 'test', 'ok.mjs'), "import fs from 'node:fs';\nfs.writeFileSync(new URL('./ok.ran', import.meta.url), '');\n");
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test.mjs'), '--dir', wt], { encoding: 'utf8' });
  check('scripts/test.mjs repairs a fresh worktree and then runs its suites', run.status === 0 && fs.existsSync(path.join(wt, 'test', 'ok.ran')) && /\[preflight\]/.test(run.stdout), run.stdout + run.stderr);

  const stuckMain = path.join(tmp, 'main-stuck');
  seedMain(stuckMain, { modules: false });
  const stuck = worktreeOf(stuckMain, 'stuck');
  seedTree(stuck);
  write(path.join(stuck, 'test', 'ok.mjs'), "import fs from 'node:fs';\nfs.writeFileSync(new URL('./ok.ran', import.meta.url), '');\n");
  const refused = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test.mjs'), '--dir', stuck], { encoding: 'utf8' });
  check('on a tree it cannot repair, scripts/test.mjs exits 1 before the first suite', refused.status === 1 && !fs.existsSync(path.join(stuck, 'test', 'ok.ran')) && /npm install/.test(refused.stdout), refused.stdout + refused.stderr);

  const list = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test.mjs'), '--dir', stuck, '--list'], { encoding: 'utf8' });
  check('--list still changes nothing and refuses nothing', list.status === 0 && !/preflight/.test(list.stdout), list.stdout + list.stderr);
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n\x1b[32mall ${ran} checks passed\x1b[0m\n`);
process.exit(failures ? 1 : 0);
