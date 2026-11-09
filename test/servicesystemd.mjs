#!/usr/bin/env node
/**
 * The service module's two managers — launchd and a systemd user unit (bc-obucr.3).
 *
 *   node test/servicesystemd.mjs
 *
 * Nothing here needs systemd, systemctl or launchctl: the unit is rendered and parsed
 * back as text, `systemctl show` output is a string, and every home is a directory this
 * file writes. That is the point — the Mac this runs on has no systemd, and a Linux CI
 * box has no launchd, and both halves must be green on both.
 *
 * The last block is the seam's own guarantee: no file under lib/ or bin/ builds a
 * launchctl or systemctl command except lib/service.js. Prose about `launchctl
 * kickstart` is everywhere in comments and is fine; what is pinned is code that would
 * *run* one.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  LABEL,
  UNIT,
  hotSwapProblem,
  installedService,
  launchdProgram,
  loadedArgv,
  loadedProgramFrom,
  renderSystemdUnit,
  restartArgv,
  restartCommand,
  restartTarget,
  serviceHealth,
  serviceManager,
  splitExec,
  unitExecStart,
  unitPath,
} from '../lib/service.js';
import { launchAgentProblem, restartedLabel } from '../lib/launchagent.js';
import { ownDeployDeclaration } from '../lib/deploy.js';
import { removeTreeSync } from './helpers/tmp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  else {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      ${detail}` : ''}`);
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-svcsd-'));
process.on('exit', () => removeTreeSync(tmp));

/** A fake home holding exactly the unit file a case needs. */
function homeWithUnit(name, text) {
  const home = path.join(tmp, name);
  if (text !== null) {
    fs.mkdirSync(path.dirname(unitPath(home)), { recursive: true });
    fs.writeFileSync(unitPath(home), text);
  }
  return home;
}

/* ----------------------------------------------------------- which manager */

console.log('which manager');
check('macOS is launchd', serviceManager({ platform: 'darwin', env: {} }) === 'launchd');
check('Linux is systemd', serviceManager({ platform: 'linux', env: {} }) === 'systemd');
check('the override wins over the platform', serviceManager({ platform: 'darwin', env: { BEADCAUSE_SERVICE_MANAGER: 'systemd' } }) === 'systemd');
check('a nonsense override is ignored rather than trusted', serviceManager({ platform: 'linux', env: { BEADCAUSE_SERVICE_MANAGER: 'upstart' } }) === 'systemd');

/* --------------------------------------------------------------- commands */

console.log('\nthe commands');
check(
  'launchd restart is the kickstart it always was',
  same(restartArgv({ manager: 'launchd', uid: 501 }), ['launchctl', 'kickstart', '-k', `gui/501/${LABEL}`])
);
check('systemd restart is systemctl --user restart', same(restartArgv({ manager: 'systemd' }), ['systemctl', '--user', 'restart', UNIT]));
check('the {uid} placeholder survives for the stored deploy declaration', restartArgv({ manager: 'launchd', uid: '{uid}' })[3] === `gui/{uid}/${LABEL}`);
check('restartCommand is the argv as one line', restartCommand({ manager: 'systemd' }) === `systemctl --user restart ${UNIT}`);
check('read-back asks systemd for ExecStart', same(loadedArgv({ manager: 'systemd' }), ['systemctl', '--user', 'show', '--property=ExecStart', UNIT]));

/* ------------------------------------------------- reading a restart command */

console.log('\nreading a restart command');
check('launchctl kickstart names its label', restartTarget(['launchctl', 'kickstart', '-k', `gui/501/${LABEL}`])?.name === LABEL);
check('our own systemd unit answers as LABEL', same(restartTarget(['systemctl', '--user', 'restart', UNIT]), { manager: 'systemd', name: LABEL }));
check('a unit named without .service is ours too, as systemctl reads it', restartTarget(['systemctl', '--user', 'restart', 'beadcause'])?.name === LABEL);
check('a foreign user unit keeps its name', restartTarget(['/usr/bin/systemctl', '--user', 'restart', 'other.service'])?.name === 'other.service');
check('a system unit (no --user) is none of ours', restartTarget(['systemctl', 'restart', UNIT]) === null);
check('start/enable load rather than restart, and are not judged', restartTarget(['systemctl', '--user', 'enable', UNIT]) === null);
check('fly deploy has no target', restartTarget(['fly', 'deploy']) === null);
check('lib/launchagent.js still answers through restartedLabel', restartedLabel(['systemctl', '--user', 'restart', UNIT]) === LABEL);

/* ------------------------------------------------------------ the unit file */

console.log('\nthe unit file');
const node = '/usr/bin/node';
const log = '/home/ada/.local/state/beadcause/beadcause.log';
const unit = renderSystemdUnit({ node, root: '/srv/beadcause', log });
check('it runs the router, not the server', /ExecStart=\/usr\/bin\/node \/srv\/beadcause\/bin\/router\.js/.test(unit), unit);
check('it restarts forever, like KeepAlive', /^Restart=always$/m.test(unit));
check('it starts at boot, like RunAtLoad', /^WantedBy=default\.target$/m.test(unit));
check('it logs to the file, appended', unit.includes(`StandardOutput=append:${log}`) && unit.includes(`StandardError=append:${log}`));
check('its PATH starts with the node it was installed with', /Environment=PATH=\/usr\/bin:/.test(unit), unit);
check('it parses back to the argv it was given', same(unitExecStart(unit), [node, '/srv/beadcause/bin/router.js']), JSON.stringify(unitExecStart(unit)));

const spaced = renderSystemdUnit({ node: '/opt/my node/bin/node', root: '/home/a b/beadcause', log });
check(
  'a path with a space is quoted, and still parses back whole',
  same(unitExecStart(spaced), ['/opt/my node/bin/node', '/home/a b/beadcause/bin/router.js']),
  JSON.stringify(unitExecStart(spaced))
);
check('renderSystemdUnit refuses to guess the node or the log', (() => { try { renderSystemdUnit({ root: '/x' }); return false; } catch { return true; } })());

check('splitExec drops systemd prefixes', same(splitExec('-/usr/bin/node /x/bin/router.js'), ['/usr/bin/node', '/x/bin/router.js']));
check('splitExec refuses an unterminated quote', splitExec('"/usr/bin/node /x') === null);
check(
  'the last ExecStart in [Service] wins, and other sections are ignored',
  same(unitExecStart('[Unit]\nExecStart=/nope\n[Service]\nExecStart=/a a.js\nExecStart=/b b.js\n'), ['/b', 'b.js'])
);
check('a unit with no ExecStart is not understood', unitExecStart('[Service]\nRestart=always\n') === null);

/* ------------------------------------------------- what systemd says it loaded */

console.log('\nwhat systemd says it loaded');
const shown = 'ExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node /srv/beadcause/bin/router.js ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }';
check('systemctl show is read for the program', loadedProgramFrom(shown, 'systemd') === '/srv/beadcause/bin/router.js');
check('launchctl print is read as before', loadedProgramFrom('\targuments = {\n\t\t/usr/bin/node\n\t\t/x/bin/router.js\n\t}', 'launchd') === '/x/bin/router.js');
check('nothing printed is nothing loaded', loadedProgramFrom('', 'systemd') === null);

/* -------------------------------------------- the hot-swap verdict on systemd */

console.log('\nthe hot-swap verdict, on systemd');
const want = path.join(ROOT, 'bin', 'router.js');
{
  const home = homeWithUnit('good', renderSystemdUnit({ node, root: ROOT, log }));
  const svc = installedService({ home, manager: 'systemd' });
  check('the installed unit is found where install.sh writes it', svc.exists && svc.path === unitPath(home), JSON.stringify(svc));
  check('and its program is the router', svc.program === want, svc.program);
  check('a good unit is no problem', hotSwapProblem({ root: ROOT, home, manager: 'systemd' }) === null);
  const health = serviceHealth({ root: ROOT, home, manager: 'systemd', loadedProgram: null });
  check('and the health line says systemd runs it', health.ok && /^systemd runs bin\/router\.js/.test(health.summary), health.summary);
}
{
  const home = homeWithUnit('none', null);
  const p = hotSwapProblem({ root: ROOT, home, manager: 'systemd' });
  check('no unit is not-installed, and says unit rather than LaunchAgent', p?.code === 'not-installed' && /systemd user unit/.test(p.summary), p?.summary);
}
{
  const home = homeWithUnit('server', renderSystemdUnit({ node, root: ROOT, log }).replace('bin/router.js', 'bin/beadcause.js'));
  const p = hotSwapProblem({ root: ROOT, home, manager: 'systemd' });
  check('a unit naming the server is the same bug on Linux', p?.code === 'runs-the-server' && /^systemd runs/.test(p.lines[0]), JSON.stringify(p?.lines));
}
{
  const home = homeWithUnit('stale', renderSystemdUnit({ node, root: ROOT, log }));
  const p = hotSwapProblem({ root: ROOT, home, manager: 'systemd', loadedProgram: path.join(ROOT, 'bin', 'beadcause.js') });
  check('a unit rewritten but never reloaded is not-reloaded', p?.code === 'not-reloaded' && /unit file/.test(p.lines.join(' ')), JSON.stringify(p?.lines));
}
{
  const home = homeWithUnit('garbled', '[Service]\nRestart=always\n');
  check('a unit with no ExecStart is unreadable, not absent', hotSwapProblem({ root: ROOT, home, manager: 'systemd' })?.code === 'unreadable');
}

/* ------------------------------------------------ the launchd half is unchanged */

console.log('\nthe launchd half is unchanged');
{
  const home = path.join(tmp, 'mac-none');
  const p = hotSwapProblem({ root: ROOT, home, manager: 'launchd' });
  check('no plist still says LaunchAgent', p?.code === 'not-installed' && /^no LaunchAgent at /.test(p.summary), p?.summary);
}

/* --------------------------------------------------- who started this process */

console.log('\nwho started this process');
check(
  'a direct child of the systemd user manager knows what it was handed',
  launchdProgram({ env: { MANAGERPID: '812' }, argv: ['/usr/bin/node', '/x/bin/router.js'], ppid: 812 }) === '/x/bin/router.js'
);
check(
  'a grandchild with an inherited MANAGERPID does not',
  launchdProgram({ env: { MANAGERPID: '812' }, argv: ['/usr/bin/node', '/x/bin/router.js'], ppid: 4000 }) === null
);

/* ------------------------------------------------------- deploys and refusals */

console.log('\ndeploys');
{
  const home = homeWithUnit('deploy-good', renderSystemdUnit({ node, root: ROOT, log }));
  check(
    'a systemctl restart of our unit, installed right, is not refused',
    launchAgentProblem({ command: ['systemctl', '--user', 'restart', UNIT], dir: ROOT, home }) === null
  );
}
{
  const home = homeWithUnit('deploy-server', renderSystemdUnit({ node, root: ROOT, log }).replace('bin/router.js', 'bin/beadcause.js'));
  const p = launchAgentProblem({ command: ['systemctl', '--user', 'restart', UNIT], dir: ROOT, home });
  check('one whose unit names the server is refused, as on macOS', p?.code === 'runs-the-server' && /systemd user unit is not in step/.test(p.message), p?.message);
}
{
  const home = homeWithUnit('deploy-foreign', null);
  const p = launchAgentProblem({ command: ['systemctl', '--user', 'restart', 'other.service'], dir: ROOT, home });
  check('a foreign unit with no file anywhere is not-installed', p?.code === 'not-installed' && /unit file/.test(p.message), p?.message);
}
{
  // ownDeployDeclaration only declares a command on a correctly installed machine; the
  // command it declares is the manager's restart, with {uid} left for expand().
  const prev = process.env.BEADCAUSE_SERVICE_MANAGER;
  process.env.BEADCAUSE_SERVICE_MANAGER = 'systemd';
  try {
    const home = homeWithUnit('own-deploy', renderSystemdUnit({ node, root: ROOT, log }));
    const d = ownDeployDeclaration({ root: ROOT, home });
    check('on systemd the own deploy restarts the unit', same(d?.command, ['systemctl', '--user', 'restart', UNIT]), JSON.stringify(d));
  } finally {
    if (prev === undefined) delete process.env.BEADCAUSE_SERVICE_MANAGER;
    else process.env.BEADCAUSE_SERVICE_MANAGER = prev;
  }
}

/* --------------------------------------------- the CLI install.sh renders with */

console.log('\nscripts/service-unit.mjs');
{
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'service-unit.mjs'), '--node', node, '--root', ROOT, '--log', log], { encoding: 'utf8' });
  check('prints the same unit lib/service.js renders', r.status === 0 && r.stdout === renderSystemdUnit({ node, root: ROOT, log }), r.stderr);
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'service-unit.mjs'), '--root', ROOT], { encoding: 'utf8' });
  check('and exits non-zero without --node and --log', bad.status === 1 && /needs node and log/.test(bad.stderr), bad.stderr);
}

/* ------------------------------------------------------------------ the seam */

console.log('\nthe seam');
{
  // Code that would *run* a manager: launchctl/systemctl as a quoted word (an argv
  // element, a comparison) or opening a template literal that interpolates. Comments
  // name `launchctl kickstart -k gui/$(id -u)/…` constantly and are not matched: their
  // backticks never hold a `${`.
  const RUNS = /(['"])(launchctl|systemctl)\1|`(launchctl|systemctl) [^`]*\$\{/;
  const offenders = [];
  for (const dir of ['lib', 'bin']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = `${dir}/${f}`;
      const full = path.join(ROOT, rel);
      if (!fs.statSync(full).isFile() || rel === 'lib/service.js') continue;
      if (!/\.(m?js)$/.test(f) && !fs.readFileSync(full, 'utf8').startsWith('#!/usr/bin/env node')) continue;
      fs.readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\*|\/\/)/.test(line)) return;
          if (RUNS.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
  }
  check('no launchctl or systemctl command is built outside lib/service.js', offenders.length === 0, offenders.join('\n      '));
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
