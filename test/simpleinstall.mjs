#!/usr/bin/env node
//
// bc-p2z77: `npm run configure -- --simple` — the "simple installation with defaults".
//
//   node test/simpleinstall.mjs
//
// Two promises, each made in prose on the setup screen and in docs/install.md:
//
// 1. It needs no terminal. Every question is answered with its own default, so the
//    install can take them where nobody is there to ask — unlike a bare `configure`
//    with no TTY, which prints what is on file and changes nothing.
// 2. On a re-run it keeps every answer. The defaults are worked out by running the
//    wizard itself with an io that answers each question with the default it offers,
//    and each default is what is already configured — so choosing "simple" over a
//    customised install must leave the file's answers exactly as they were.
//
// Each run gets its own BEADCAUSE_CONFIG_DIR and a workspace root of its own, so
// nothing here reads ~/beads or touches the real config.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n     ${String(detail).slice(0, 600)}`}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-simpleinstall-'));
const cfgDir = path.join(tmp, 'config');
const beads = path.join(tmp, 'beads');
fs.mkdirSync(path.join(beads, 'alpha', '.beads'), { recursive: true });
fs.mkdirSync(path.join(beads, 'beta', '.beads'), { recursive: true });
fs.mkdirSync(cfgDir, { recursive: true });
const file = path.join(cfgDir, 'config.json');
fs.writeFileSync(file, JSON.stringify({ workspaceRoots: [beads], workspaces: [] }, null, 2));

const run = (...args) =>
  spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'configure.js'), ...args], {
    cwd: ROOT,
    env: { ...process.env, BEADCAUSE_CONFIG_DIR: cfgDir },
    input: '',
    encoding: 'utf8',
    timeout: 60_000,
  });
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));

try {
  /* ------------------------------------------------------------ no flag, no TTY */
  const before = fs.readFileSync(file, 'utf8');
  const bare = run();
  check('without --simple and without a terminal, it exits 0', bare.status === 0, bare.stderr);
  check('… and says nothing was changed', /Nothing was changed/.test(bare.stdout), bare.stdout);
  // loadConfig fills in the defaults on read; it is the *answers* that must not move.
  check('… and leaves the workspace roots as they were', JSON.stringify(read().workspaceRoots) === JSON.stringify(JSON.parse(before).workspaceRoots));

  /* ----------------------------------------------------------- --simple, no TTY */
  const first = run('--simple');
  check('--simple runs with no terminal and exits 0', first.status === 0, first.stderr || first.stdout);
  check('--simple says it saved', /Saved/.test(first.stdout), first.stdout);
  const c1 = read();
  check(
    '--simple found exactly the two workspaces under the configured root',
    (c1.workspaces || []).map((x) => x.name).sort().join() === 'alpha,beta',
    JSON.stringify(c1.workspaces)
  );
  check('a first install defaults to no shared workspaces', (c1.autoDispatchExclude || []).length === 0, JSON.stringify(c1.autoDispatchExclude));
  check('a first install defaults to no advocates', (c1.advocates?.workspaces || []).length === 0, JSON.stringify(c1.advocates));
  check('a first install defaults to ntfy off', c1.ntfy?.enabled === false, JSON.stringify(c1.ntfy));
  check('a first install defaults to Slack off', !c1.slack?.enabled, JSON.stringify(c1.slack));

  /* ------------------------------------------- --simple over a customised config */
  const custom = {
    ...c1,
    owner: 'Zed',
    autoDispatchExclude: ['beta'],
    ntfy: { ...c1.ntfy, enabled: true, minimalWorkspaces: ['beta'] },
    advocates: { ...c1.advocates, workspaces: ['alpha'], maxWorkers: 2 },
    monitor: { ...c1.monitor, enabled: true },
    autoDispatch: false,
  };
  fs.writeFileSync(file, JSON.stringify(custom, null, 2));
  const again = run('--simple');
  check('a simple re-run exits 0', again.status === 0, again.stderr || again.stdout);
  const c2 = read();
  for (const key of ['owner', 'autoDispatchExclude', 'ntfy', 'advocates', 'monitor', 'autoDispatch', 'workspaceRoots']) {
    check(`a simple re-run keeps ${key}`, JSON.stringify(c2[key]) === JSON.stringify(custom[key]), `${JSON.stringify(custom[key])} -> ${JSON.stringify(c2[key])}`);
  }

  /* ------------------------------------------------------- nothing found at all */
  fs.writeFileSync(file, JSON.stringify({ workspaceRoots: [path.join(tmp, 'nowhere')], workspaces: [] }, null, 2));
  const empty = run('--simple');
  check('--simple with no workspace found exits 0', empty.status === 0, empty.stderr);
  check('… and says none were found', /No beads workspaces found/.test(empty.stdout), empty.stdout);
} finally {
  await cleanupTmp(tmp);
}

console.log(`\n${pass}/${pass + fail} ok`);
process.exit(fail ? 1 : 0);
