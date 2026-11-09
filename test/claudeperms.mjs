#!/usr/bin/env node
/**
 * The Claude Code allow rules install.sh merges in for `bd` (bc-eg9tj), in scratch homes.
 *
 *   npm test
 *   node test/claudeperms.mjs
 *
 * Pinned: a fresh file gets the rules; unrelated keys (hooks, statusLine, env, a deny
 * list, an allow rule of the user's) survive; a re-run adds nothing; uninstall gives back
 * the file it started from and keeps a rule the user already had; a symlinked
 * settings.json stays a symlink and the two dirs it joins are written once; a broken file
 * is refused and left byte-for-byte; and the gated verbs are never in the list.
 *
 * Never touches the real ~/.claude: every run gets its own HOME, CLAUDE_CONFIG_DIR and
 * BEADCAUSE_CONFIG_DIR.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BD_ALLOW_RULES,
  BD_NEVER_ALLOW,
  addRules,
  installRules,
  removeRules,
  settingsTargets,
  uninstallRules,
} from '../lib/claudeperms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-claudeperms-'));
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
function scratch() {
  n += 1;
  const home = path.join(tmp, `h${n}`);
  const configDir = path.join(home, '.config', 'beadcause');
  fs.mkdirSync(home, { recursive: true });
  return { home, configDir, env: {} };
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const RICH = {
  statusLine: { type: 'command', command: '~/.claude/statusline-cost.sh' },
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'bd prime --hook-json' }] }] },
  env: { FOO: '1' },
  permissions: { allow: ['Bash(git status)', 'Bash(bd show:*)'], deny: ['Bash(rm -rf:*)'] },
};

console.log('claude permissions (bc-eg9tj)');

t('the gated verbs are never pre-approved', () => {
  for (const rule of BD_ALLOW_RULES) {
    for (const verb of BD_NEVER_ALLOW) {
      assert.ok(!rule.startsWith(`Bash(${verb}`), `${rule} pre-approves ${verb}`);
    }
  }
  assert.ok(BD_ALLOW_RULES.includes('Bash(bd create:*)'));
  assert.ok(BD_ALLOW_RULES.includes('Bash(bd comments add:*)'));
});

t('addRules appends, dedupes, and keeps every other key', () => {
  const { settings, added } = addRules(RICH);
  assert.deepEqual(settings.statusLine, RICH.statusLine);
  assert.deepEqual(settings.hooks, RICH.hooks);
  assert.deepEqual(settings.env, RICH.env);
  assert.deepEqual(settings.permissions.deny, RICH.permissions.deny);
  assert.deepEqual(settings.permissions.allow.slice(0, 2), RICH.permissions.allow);
  assert.ok(!added.includes('Bash(bd show:*)'), 'a rule already there is not added again');
  assert.equal(added.length, BD_ALLOW_RULES.length - 1);
  assert.equal(new Set(settings.permissions.allow).size, settings.permissions.allow.length);
  assert.deepEqual(RICH.permissions.allow, ['Bash(git status)', 'Bash(bd show:*)'], 'input not mutated');
});

t('removeRules on what addRules added gives back the original', () => {
  for (const start of [{}, { model: 'opus' }, RICH]) {
    const { settings, added } = addRules(start);
    assert.deepEqual(removeRules(settings, added).settings, start);
  }
});

t('a fresh home: ~/.claude/settings.json is created with the rules', () => {
  const s = scratch();
  const [r] = installRules(s);
  const file = path.join(s.home, '.claude', 'settings.json');
  assert.equal(r.real, file);
  assert.deepEqual(readJson(file).permissions.allow, [...BD_ALLOW_RULES]);
});

t('unrelated keys survive, a re-run is a no-op, uninstall reverts', () => {
  const s = scratch();
  const file = path.join(s.home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(RICH, null, 2));
  installRules(s);
  const once = fs.readFileSync(file, 'utf8');
  const [again] = installRules(s);
  assert.deepEqual(again.added, []);
  assert.equal(fs.readFileSync(file, 'utf8'), once, 'second install changed the file');
  const merged = JSON.parse(once);
  assert.deepEqual(merged.hooks, RICH.hooks);
  assert.deepEqual(merged.statusLine, RICH.statusLine);
  uninstallRules(s);
  assert.deepEqual(readJson(file), RICH, 'uninstall did not give back the original');
  assert.ok(readJson(file).permissions.allow.includes('Bash(bd show:*)'), "the user's own bd rule was kept");
  assert.ok(!fs.existsSync(path.join(s.configDir, 'claude-permissions.json')), 'ledger left behind');
});

t('a symlinked settings.json stays a symlink, and both dirs are written once', () => {
  const s = scratch();
  const main = path.join(s.home, '.claude', 'settings.json');
  const other = path.join(s.home, '.claude-personal');
  fs.mkdirSync(path.dirname(main));
  fs.mkdirSync(other);
  fs.writeFileSync(main, JSON.stringify({ env: { A: 'b' } }));
  fs.symlinkSync(main, path.join(other, 'settings.json'));
  s.env = { CLAUDE_CONFIG_DIR: other };
  const targets = settingsTargets(s);
  assert.equal(targets.length, 1, `expected one real file, got ${JSON.stringify(targets)}`);
  installRules(s);
  assert.ok(fs.lstatSync(path.join(other, 'settings.json')).isSymbolicLink(), 'the link was replaced');
  assert.equal(readJson(main).permissions.allow.length, BD_ALLOW_RULES.length);
  assert.deepEqual(readJson(main).env, { A: 'b' });
});

t('two separate config dirs are both written', () => {
  const s = scratch();
  const other = path.join(s.home, '.claude-work');
  fs.mkdirSync(path.join(s.home, '.claude'));
  fs.mkdirSync(other);
  s.env = { CLAUDE_CONFIG_DIR: other };
  const results = installRules(s);
  assert.equal(results.length, 2);
  for (const dir of [other, path.join(s.home, '.claude')]) {
    assert.equal(readJson(path.join(dir, 'settings.json')).permissions.allow.length, BD_ALLOW_RULES.length);
  }
  uninstallRules(s);
  for (const dir of [other, path.join(s.home, '.claude')]) {
    assert.deepEqual(readJson(path.join(dir, 'settings.json')), {});
  }
});

t('a broken settings.json is refused and left byte-for-byte', () => {
  const s = scratch();
  const file = path.join(s.home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, '{ "hooks": ');
  const [r] = installRules(s);
  assert.ok(r.error, 'no error reported');
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "hooks": ');
});

t('the script: installs, is quiet on re-run, uninstalls, exits 2 on a broken file', () => {
  const s = scratch();
  const env = {
    ...process.env,
    HOME: s.home,
    BEADCAUSE_CONFIG_DIR: s.configDir,
    CLAUDE_CONFIG_DIR: '',
  };
  delete env.CLAUDE_CONFIG_DIR;
  const run = (...args) =>
    spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'claude-permissions.mjs'), ...args], {
      env,
      encoding: 'utf8',
    });
  const file = path.join(s.home, '.claude', 'settings.json');
  let r = run('--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(file), 'dry run wrote');
  r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /allow 10 bd command/);
  r = run();
  assert.match(r.stdout, /already allowed/);
  r = run('--uninstall');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readJson(file), {});
  fs.writeFileSync(file, 'nope');
  r = run();
  assert.equal(r.status, 2);
  assert.equal(fs.readFileSync(file, 'utf8'), 'nope');
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
