#!/usr/bin/env node
/**
 * The skills this checkout ships, and the installer that links them (bc-eszkl).
 *
 *   node test/claudeskills.mjs
 *
 * Pins: every bundled skill is linked into each real skills folder once; a re-run does
 * nothing; a skill of the user's own is never touched without --replace, and --replace
 * moves it aside rather than deleting it; uninstall takes back only its own links; the
 * /bdcz script parses what the skill tells an agent to pass and never files unendorsed;
 * and the scripts a skill calls through its link still find the checkout.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundledSkills, skillsTargets, installSkills, uninstallSkills, readLedger } from '../lib/claudeskills.js';
import { parseArgs } from '../skills/bdcz/file.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-claudeskills-')));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
let failures = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message.split('\n').join('\n      ')}`);
  }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(v, msg) {
  if (!v) throw new Error(msg);
}
function scratch() {
  n += 1;
  const home = path.join(tmp, `h${n}`);
  const configDir = path.join(home, '.config', 'beadcause');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return { home, configDir, env: {} };
}

console.log('claude skills');

t('bdcz and handoff are bundled', () => {
  const names = bundledSkills(ROOT).map((s) => s.name);
  ok(names.includes('bdcz') && names.includes('handoff'), `bundled: ${names.join(', ')}`);
});

t('a skills folder reached through a link is one target, not two', () => {
  const s = scratch();
  const alt = path.join(s.home, '.claude-personal');
  fs.mkdirSync(alt);
  fs.mkdirSync(path.join(s.home, '.claude', 'skills'));
  fs.symlinkSync(path.join(s.home, '.claude', 'skills'), path.join(alt, 'skills'));
  eq(skillsTargets({ env: { CLAUDE_CONFIG_DIR: alt }, home: s.home }).length, 1, 'targets');
});

t('install links every skill, and a re-run changes nothing', () => {
  const s = scratch();
  const rows = installSkills({ root: ROOT, ...s });
  ok(rows.every((r) => r.action === 'link'), JSON.stringify(rows));
  const dest = path.join(s.home, '.claude', 'skills', 'bdcz');
  eq(fs.readlinkSync(dest), path.join(ROOT, 'skills', 'bdcz'), 'link target');
  ok(fs.existsSync(path.join(dest, 'SKILL.md')), 'SKILL.md readable through the link');
  ok(installSkills({ root: ROOT, ...s }).every((r) => r.action === 'ok'), 're-run was not a no-op');
});

t('a skill directory of your own is left alone, and --replace moves it aside', () => {
  const s = scratch();
  const mine = path.join(s.home, '.claude', 'skills', 'handoff');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'SKILL.md'), 'mine');
  const row = installSkills({ root: ROOT, ...s }).find((r) => r.name === 'handoff');
  eq(row.action, 'skip', 'action');
  eq(fs.readFileSync(path.join(mine, 'SKILL.md'), 'utf8'), 'mine', 'own skill untouched');
  const again = installSkills({ root: ROOT, ...s, replace: true }).find((r) => r.name === 'handoff');
  eq(again.action, 'replace', 'action with replace');
  eq(fs.readFileSync(path.join(again.movedTo, 'SKILL.md'), 'utf8'), 'mine', 'own skill kept aside');
  ok(fs.lstatSync(mine).isSymbolicLink(), 'now linked');
});

t('a link pointing somewhere foreign is skipped', () => {
  const s = scratch();
  const elsewhere = path.join(s.home, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.mkdirSync(path.join(s.home, '.claude', 'skills'));
  fs.symlinkSync(elsewhere, path.join(s.home, '.claude', 'skills', 'bdcz'));
  eq(installSkills({ root: ROOT, ...s }).find((r) => r.name === 'bdcz').action, 'skip', 'action');
});

t('dry run writes nothing', () => {
  const s = scratch();
  installSkills({ root: ROOT, ...s, dryRun: true });
  ok(!fs.existsSync(path.join(s.home, '.claude', 'skills', 'bdcz')), 'link made on a dry run');
  eq(readLedger(s.configDir).links.length, 0, 'ledger');
});

t('uninstall removes its own links and keeps a re-pointed one', () => {
  const s = scratch();
  installSkills({ root: ROOT, ...s });
  const handoff = path.join(s.home, '.claude', 'skills', 'handoff');
  fs.unlinkSync(handoff);
  fs.symlinkSync(s.home, handoff);
  const rows = uninstallSkills({ configDir: s.configDir });
  eq(rows.find((r) => r.dest.endsWith('bdcz')).action, 'removed', 'bdcz');
  eq(rows.find((r) => r.dest.endsWith('handoff')).action, 'kept', 'handoff');
  ok(!fs.existsSync(path.join(s.home, '.claude', 'skills', 'bdcz')), 'bdcz link still there');
  ok(fs.lstatSync(handoff).isSymbolicLink(), 're-pointed link was removed');
});

t('bdcz parses what the skill passes, with no labels of its own', () => {
  const o = parseArgs(['--title', 'A thing', '--type', 'bug', '--priority', 'P0', '--label', 'a,b', '--dep', 'discovered-from:bc-x']);
  eq([o.title, o.type, o.priority, o.labels, o.deps, o.workspace], ['A thing', 'bug', 0, ['a', 'b'], ['discovered-from:bc-x'], 'beadcause'], 'parsed');
  eq(parseArgs(['--title', 'x']).labels, [], 'default labels — not ["human"], never unendorsed');
  for (const bad of [[], ['--title', 'x', '--type', 'nope'], ['--title', 'x', '--priority', '7']]) {
    let threw = false;
    try {
      parseArgs(bad);
    } catch {
      threw = true;
    }
    ok(threw, `accepted ${JSON.stringify(bad)}`);
  }
});

t('bdcz runs through the skill link and reaches lib/', () => {
  const s = scratch();
  installSkills({ root: ROOT, ...s });
  const out = execFileSync(process.execPath, [path.join(s.home, '.claude', 'skills', 'bdcz', 'file.mjs'), '--help'], { encoding: 'utf8' });
  ok(out.includes('--title'), out);
});

t('open-handoff, through the skill link, names the checkout\'s claim.js', () => {
  const s = scratch();
  installSkills({ root: ROOT, ...s });
  const out = execFileSync(
    path.join(s.home, '.claude', 'skills', 'handoff', 'open-handoff'),
    ['bc-test', '--dry-run', '--no-daemon', '-d', s.home],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  ok(out.includes(path.join(fs.realpathSync(ROOT), 'bin', 'claim.js')), out);
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
