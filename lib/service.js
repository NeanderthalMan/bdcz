/**
 * What launchd is *actually* running — as opposed to what this repo intends.
 *
 * The bug this exists for ran for three days without anyone noticing. bin/router.js
 * landed, scripts/install.sh was updated to point the LaunchAgent at it, and the
 * whole hot-swap — a router owning the port, a backend swapped under it on every
 * edit to `lib/` — was described in the README as how deploys work. Meanwhile the
 * plist in ~/Library/LaunchAgents, written weeks earlier, still named
 * `bin/beadcause.js`, and every `launchctl kickstart -k` faithfully restarted the
 * plain unsupervised server. Nothing in the program was wrong. Nothing in the
 * program was *live*, either.
 *
 * The reason it could hide is that the two halves never meet: install.sh writes the
 * plist and is run by hand, perhaps once; the deploy kickstarts a label and never
 * looks at what the label points to. A file generated months ago is not something
 * `git pull` updates, so the repo can improve indefinitely while the installed
 * service stands still.
 *
 * So this reads the plist off disk and compares it to this checkout, and callers pair
 * that with the one fact only a running process has: what launchd actually handed it.
 * Two independent facts, because they fail apart —
 *
 *   - the plist file names bin/beadcause.js  → install.sh has never been re-run since
 *     the router landed. The fix is `npm run install-service`.
 *   - the plist file names bin/router.js, but the process launchd started is the
 *     server → the file was rewritten and the job never reloaded, so launchd is still
 *     serving the arguments it bootstrapped with. Same fix, and only a bootout and
 *     bootstrap clears it — rewriting the file alone does nothing.
 *
 * It is deliberately a leaf: node builtins, and from the app only lib/startup.js, which
 * imports nothing at all. bin/router.js imports this file, and the router's whole safety
 * property is that it depends on almost nothing — see the note at the top of that file.
 *
 * The second question here is the same shape as the first, one layer in: not "is the
 * right program installed" but "is the program that *is* running actually serving
 * anything". A router holding the port with no backend behind it looks healthy to
 * launchd, answers every request, and is down. See `routerHealth`.
 */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { explain } from './startup.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The LaunchAgent label. Kept in step with scripts/install.sh and scripts/uninstall.sh. */
export const LABEL = 'n12n.beadcause';

/**
 * The systemd user unit the same service is installed as on Linux (bc-obucr.3).
 *
 * A different name from the launchd label on purpose: reverse-DNS is launchd's
 * convention and not systemd's, and `systemctl --user status beadcause` is what anyone
 * would type. lib/launchagent.js treats a restart of this unit as a restart of LABEL.
 */
export const UNIT = 'beadcause.service';

/**
 * Which service manager this machine has: `launchd` on macOS, `systemd` on Linux.
 *
 * **This module is the only place either one is named in code that runs.** Every
 * restart, every "what is loaded", every install path elsewhere asks here, so a third
 * manager is a change to this file and nothing else. `BEADCAUSE_SERVICE_MANAGER`
 * overrides the platform, which is how test/install.mjs drives the systemd half of
 * scripts/install.sh on a Mac that has no systemctl — the same variable install.sh reads.
 */
export const MANAGERS = ['launchd', 'systemd'];
export function serviceManager({ platform = process.platform, env = process.env } = {}) {
  const forced = env.BEADCAUSE_SERVICE_MANAGER;
  if (MANAGERS.includes(forced)) return forced;
  return platform === 'linux' ? 'systemd' : 'launchd';
}

/** What a person calls the installed thing, per manager — for the prose below. */
const NOUN = { launchd: 'LaunchAgent', systemd: 'systemd user unit' };
const FILE = { launchd: 'plist', systemd: 'unit file' };

/** Where install.sh writes the plist for a given home directory. */
export function plistPath(home = os.homedir(), label = LABEL) {
  return path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
}

/** Where install.sh writes the systemd user unit for a given home directory. */
export function unitPath(home = os.homedir(), unit = UNIT) {
  return path.join(home, '.config', 'systemd', 'user', unit);
}

/**
 * Every place systemd loads a *user* unit from, in its own order of preference — the
 * systemd counterpart of agentPlistPaths, for a unit this repo did not write.
 */
export function userUnitPaths(home = os.homedir(), unit = UNIT) {
  return [
    unitPath(home, unit),
    path.join('/etc/systemd/user', unit),
    path.join('/usr/local/lib/systemd/user', unit),
    path.join('/usr/lib/systemd/user', unit),
  ];
}

/** The service file for this manager: the plist on macOS, the unit on Linux. */
export function servicePath({ home = os.homedir(), manager = serviceManager() } = {}) {
  return manager === 'systemd' ? unitPath(home) : plistPath(home);
}

/**
 * The argv that restarts the running service. `uid` defaults to this process's, and a
 * caller that stores the command (lib/deploy.js) passes the literal `{uid}` placeholder.
 *
 * launchd: `kickstart -k`, because kickstart without it is a no-op against a live job.
 * systemd: `restart`, which starts it too if it was stopped — the same promise.
 */
export function restartArgv({ manager = serviceManager(), uid = process.getuid?.() ?? 501 } = {}) {
  return manager === 'systemd'
    ? ['systemctl', '--user', 'restart', UNIT]
    : ['launchctl', 'kickstart', '-k', `gui/${uid}/${LABEL}`];
}

/** The same command as one line, for a log, a fix row or a 503 body. */
export function restartCommand(opts = {}) {
  return restartArgv(opts).join(' ');
}

/** The argv that asks the manager what program it actually loaded for our service. */
export function loadedArgv({ manager = serviceManager(), uid = process.getuid?.() ?? 501 } = {}) {
  return manager === 'systemd'
    ? ['systemctl', '--user', 'show', '--property=ExecStart', UNIT]
    : ['launchctl', 'print', `gui/${uid}/${LABEL}`];
}

/** Subcommands that restart what is already loaded, rather than loading it afresh. */
const LAUNCHD_RESTARTS = new Set(['kickstart', 'kill', 'stop']);
const SYSTEMD_RESTARTS = new Set(['restart', 'try-restart', 'reload-or-restart', 'kill', 'stop']);
/** `gui/501/n12n.beadcause` → `n12n.beadcause`. User domains only. */
const LAUNCHD_TARGET = /^(?:gui|user)\/\d+\/(.+)$/;

/**
 * What a restart command would restart, or null if it would not restart a user job.
 *
 * `{ manager, name }` — `name` is the launchd label or the systemd unit (with `.service`
 * added when the command left it off, as systemctl itself does). Our own unit answers
 * with LABEL as `name`, so callers comparing against LABEL need not know there are two.
 *
 * Only user jobs: `system/<label>` and a `systemctl` without `--user` are root's, and
 * this daemon has no view of why they are installed the way they are.
 */
export function restartTarget(command) {
  if (!Array.isArray(command) || !command.length) return null;
  const bin = path.basename(String(command[0]));
  const rest = command.slice(1).map(String);
  const sub = rest.find((a) => !a.startsWith('-'));
  if (bin === 'launchctl') {
    if (!LAUNCHD_RESTARTS.has(sub ?? '')) return null;
    for (const arg of rest) {
      const m = LAUNCHD_TARGET.exec(arg);
      if (m) return { manager: 'launchd', name: m[1] };
    }
    return null;
  }
  if (bin === 'systemctl') {
    if (!rest.includes('--user')) return null;
    if (!SYSTEMD_RESTARTS.has(sub ?? '')) return null;
    const unit = rest.slice(rest.indexOf(sub) + 1).find((a) => !a.startsWith('-'));
    if (!unit) return null;
    const name = /\.[a-z]+$/.test(unit) ? unit : `${unit}.service`;
    return { manager: 'systemd', name: name === UNIT ? LABEL : name };
  }
  return null;
}

/**
 * The systemd unit install.sh writes — rendered here, in JS, so the one copy of it is
 * the one test/service.mjs parses back, with no systemd anywhere near the test.
 *
 * `Restart=always` + `WantedBy=default.target` are KeepAlive + RunAtLoad. The log is
 * appended rather than journald-only so `tail -f` works the same on both platforms;
 * `append:` needs systemd 240, which every supported Ubuntu has. Survival across a
 * reboot with nobody logged in is not in the unit at all — it is `loginctl
 * enable-linger`, which install.sh runs beside it.
 */
export function renderSystemdUnit({ node, root = ROOT, log, envPath }) {
  if (!node || !log) throw new Error('renderSystemdUnit needs node and log');
  const pathLine = envPath || `${path.dirname(node)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  return [
    '# Generated by scripts/install.sh. Re-run it rather than editing by hand.',
    '[Unit]',
    'Description=beadcause — the bead advocate daemon',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    // The router, not the server: it owns the port and swaps backends under it.
    `ExecStart=${quoteExec(node)} ${quoteExec(path.join(root, 'bin', 'router.js'))}`,
    `WorkingDirectory=${quoteExec(root)}`,
    'Restart=always',
    'RestartSec=2',
    // A router stop is a drain; give it the same room launchd's SIGTERM does.
    'TimeoutStopSec=30',
    `Environment=${quoteExec(`PATH=${pathLine}`)}`,
    `StandardOutput=append:${log}`,
    `StandardError=append:${log}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/** systemd's quoting: a word with space, quote or backslash goes in double quotes. */
function quoteExec(word) {
  const s = String(word);
  return /[\s"'\\]/.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
}

/**
 * Split an ExecStart= value into argv the way systemd does: whitespace separates,
 * double or single quotes group, a backslash escapes. The leading `@`, `-`, `:`, `+`
 * and `!` prefixes systemd allows are dropped — they change how it runs, not what.
 */
export function splitExec(value) {
  const out = [];
  let cur = null;
  let quote = null;
  const s = String(value).trim().replace(/^[@\-:+!]+/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      cur = (cur ?? '') + s[++i];
    } else if (quote) {
      if (c === quote) quote = null;
      else cur = (cur ?? '') + c;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur = cur ?? '';
    } else if (/\s/.test(c)) {
      if (cur !== null) out.push(cur);
      cur = null;
    } else {
      cur = (cur ?? '') + c;
    }
  }
  if (quote) return null; // An unterminated quote is a file we did not understand.
  if (cur !== null) out.push(cur);
  return out.length ? out : null;
}

/**
 * The ExecStart argv out of a unit file, or null — the systemd counterpart of
 * programArguments. Only the `[Service]` section, and the last ExecStart= in it wins
 * (an empty one resets the list, which is how drop-ins override it).
 */
export function unitExecStart(text) {
  let section = null;
  let found = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      section = head[1];
      continue;
    }
    if (section !== 'Service') continue;
    const m = /^ExecStart\s*=\s*(.*)$/.exec(line);
    if (m) found = m[1] ? splitExec(m[1]) : null;
  }
  return found;
}

/**
 * What the manager reports it loaded, from the output of loadedArgv() — the program
 * (`…/bin/<name>.js`) or null. launchd prints `arguments = { … }`; systemd prints
 * `ExecStart={ path=… ; argv[]=/usr/bin/node /x/bin/router.js ; … }`. Both are read
 * for the first `/bin/*.js`, which is what install.sh's read-back always compared.
 */
export function loadedProgramFrom(output, manager = serviceManager()) {
  const text = String(output || '');
  const scope = manager === 'systemd' ? (/argv\[\]=([^;]*)/.exec(text)?.[1] ?? '') : text;
  return /[^\s"']+\/bin\/[A-Za-z0-9._-]+\.js/.exec(scope)?.[0] ?? null;
}

/**
 * Every place a *user* LaunchAgent's plist is allowed to live, in the order launchd
 * itself prefers them.
 *
 * Only for labels this repo did not write. Our own is `plistPath()` and nothing else —
 * install.sh puts it in `~/Library/LaunchAgents` and looking anywhere else for it would
 * let a stray copy elsewhere answer for the one that is actually installed. A foreign
 * label is the opposite case: we are asking "what would launchd restart here", and it
 * would have loaded the job from whichever of these it found.
 */
export function agentPlistPaths(home = os.homedir(), label = LABEL) {
  return [
    plistPath(home, label),
    path.join('/Library/LaunchAgents', `${label}.plist`),
    path.join('/System/Library/LaunchAgents', `${label}.plist`),
  ];
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const unescapeXml = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (m, name) =>
    name.startsWith('#') ? String.fromCharCode(Number(name.slice(1))) : ENTITIES[name]
  );

/**
 * The `ProgramArguments` array out of an XML plist, or null.
 *
 * A hand-rolled scan rather than a parser because the only plist this ever reads is
 * one install.sh generated a few lines of heredoc above, and pulling in an XML
 * dependency for it would put weight on the one module that must stay weightless.
 * Anything it cannot make sense of returns null and is reported as unreadable —
 * a wrong *guess* here would accuse a correct install of being broken, which is
 * worse than admitting the file was not understood.
 */
export function programArguments(xml) {
  const key = xml.indexOf('<key>ProgramArguments</key>');
  if (key < 0) return null;
  const open = xml.indexOf('<array>', key);
  if (open < 0) return null;
  const close = xml.indexOf('</array>', open);
  if (close < 0) return null;
  const out = [];
  const re = /<string>([\s\S]*?)<\/string>/g;
  let m;
  const body = xml.slice(open + '<array>'.length, close);
  while ((m = re.exec(body))) out.push(unescapeXml(m[1]));
  return out.length ? out : null;
}

/**
 * The installed LaunchAgent, as a fact rather than a judgement.
 *
 * `exists: false` is an ordinary answer — a checkout that has never been installed as
 * a service is not misconfigured, it is just a checkout — so this reports and leaves
 * the verdict to hotSwapProblem().
 *
 * `label` and `paths` exist for lib/launchagent.js, which asks the same question about
 * a label this repo did not write — the parse is identical and the search is not, so
 * the caller supplies the candidates and the default stays exactly what it always was:
 * our own label, in our own directory, and nowhere else.
 */
export function installedService({ home = os.homedir(), label = LABEL, paths = null, manager = serviceManager() } = {}) {
  const own = manager === 'systemd' && label === LABEL ? unitPath(home) : plistPath(home, label);
  const candidates = paths?.length ? paths : [own];
  let file = candidates[0];
  let xml;
  for (const candidate of candidates) {
    try {
      xml = fs.readFileSync(candidate, 'utf8');
      file = candidate;
      break;
    } catch {
      /* not here; launchd would have looked in the next one too */
    }
  }
  if (xml === undefined) {
    return { path: file, exists: false, argv: null, program: null, unreadable: false };
  }
  // A systemd unit, told apart by its name rather than by the manager: lib/launchagent.js
  // hands this foreign paths of either kind.
  if (file.endsWith('.service')) {
    const argv = unitExecStart(xml);
    if (!argv) return { path: file, exists: true, argv: null, program: null, unreadable: true };
    const program = argv.filter((a) => a.endsWith('.js')).pop() || argv[argv.length - 1];
    return { path: file, exists: true, argv, program, unreadable: false };
  }
  // A binary plist is legal and launchctl reads it happily; this does not, and says
  // so rather than pretending the ProgramArguments were absent.
  if (xml.startsWith('bplist00')) return { path: file, exists: true, argv: null, program: null, unreadable: true };
  const argv = programArguments(xml);
  if (!argv) return { path: file, exists: true, argv: null, program: null, unreadable: true };
  // The program is the last .js in argv, not argv[1]: the plist runs node with an
  // absolute path, and a future one might carry an interpreter flag between them.
  const program = argv.filter((a) => a.endsWith('.js')).pop() || argv[argv.length - 1];
  return { path: file, exists: true, argv, program, unreadable: false };
}

/**
 * Is the hot-swap actually installed? `null` when it is; a problem when it is not.
 *
 * `loadedProgram` is what launchd handed the calling process — `process.argv[1]` in a
 * daemon whose parent is pid 1 — and is the only way to catch a plist that is correct
 * on disk but was never reloaded. Callers with no such knowledge pass nothing, and get
 * the disk half of the answer, which is the half that was wrong here.
 *
 * Every problem carries `lines`: what is wrong, then the one command that fixes it.
 * A diagnosis nobody can act on is a diagnosis nobody reads.
 *
 * It also carries that remedy *twice over*, as two fields beside the prose: `fix`, the
 * action in a phrase, and `fixCommand`, the command that performs it or null when there
 * is none. The prose is for a log, where a paragraph is what you want; the fields are
 * for a screen, which can put the command on its own line under a heading that says
 * what it is — and for a push notification, which gets 300 characters and must not
 * spend them on the half of the sentence before the colon.
 */
export function hotSwapProblem({ root = ROOT, home = os.homedir(), loadedProgram = null, manager = serviceManager() } = {}) {
  const want = path.join(root, 'bin', 'router.js');
  const server = path.join(root, 'bin', 'beadcause.js');
  const svc = installedService({ home, manager });
  // The prose names the manager this machine has; on macOS every word is what it was.
  const noun = NOUN[manager];
  const file = FILE[manager];
  const mgr = manager;
  const fix = 'npm run install-service';

  if (!svc.exists) {
    return {
      code: 'not-installed',
      summary: `no ${noun} at ${svc.path} — beadcause is not installed as a service`,
      lines: [`no ${noun} at ${svc.path}.`, `install it: ${fix}`],
      fix: 'install the service from this checkout',
      fixCommand: fix,
      installed: svc,
    };
  }

  if (svc.unreadable) {
    return {
      code: 'unreadable',
      summary: `could not read ProgramArguments out of ${svc.path}`,
      lines: [`${svc.path} is installed but its ProgramArguments could not be read.`, `rewrite it: ${fix}`],
      fix: `rewrite the ${file} from this checkout`,
      fixCommand: fix,
      installed: svc,
    };
  }

  if (svc.program !== want) {
    const isOwnServer = svc.program === server;
    return {
      code: isOwnServer ? 'runs-the-server' : 'foreign-program',
      summary: isOwnServer
        ? 'the installed service runs bin/beadcause.js directly — there is no router, so no hot-swap'
        : `the installed service runs ${svc.program}, which is not this checkout's bin/router.js`,
      lines: isOwnServer
        ? [
            `${mgr} runs bin/beadcause.js directly, not bin/router.js.`,
            'so nothing supervises the port: an edit to lib/ is NOT picked up, and every',
            'kickstart restarts the plain server. The hot-swap is installed in the repo',
            `and not in ${mgr}.`,
            `fix it: ${fix}`,
          ]
        : [
            `${mgr} runs ${svc.program}.`,
            `this checkout is ${root}, whose router is ${want}.`,
            `if this is the checkout that should be serving: ${fix}`,
          ],
      fix: isOwnServer
        ? `reinstall the service so ${mgr} runs bin/router.js`
        : 'reinstall the service from this checkout, if this is the one that should be serving',
      fixCommand: fix,
      installed: svc,
    };
  }

  if (loadedProgram && path.resolve(loadedProgram) !== want) {
    return {
      code: 'not-reloaded',
      summary: `${svc.path} names bin/router.js, but ${mgr} started ${loadedProgram}`,
      lines: [
        `${svc.path} names bin/router.js, but the job ${mgr} actually started is`,
        `${loadedProgram}.`,
        `the file was rewritten and the job never reloaded — ${mgr} keeps the arguments it`,
        `${mgr === 'systemd' ? 'loaded' : 'bootstrapped'} with, so rewriting the ${file} alone changes nothing.`,
        `reload it: ${fix}  (it boots the job out and back in)`,
      ],
      fix: `${mgr === 'systemd' ? 'reload and restart the unit' : 'boot the job out and back in'} — rewriting the ${file} alone changes nothing`,
      fixCommand: fix,
      installed: svc,
    };
  }

  return null;
}

/**
 * The problem as a banner, in the shape lib's other loud warnings use.
 *
 * Framed rather than merely printed because of where it lands: launchd's log, in
 * among startup lines that all look alike, read by someone scrolling for something
 * else. The one that mattered here would have been the first thing on the screen.
 */
export function problemBanner(problem, prefix = '[beadcause]') {
  const rule = `${prefix} ${'─'.repeat(57)}`;
  return [
    rule,
    `${prefix} HOT-SWAP IS NOT LIVE — ${problem.code}`,
    ...problem.lines.map((l) => `${prefix}   ${l}`),
    rule,
  ];
}

/** The env var a router hands its backends, so a grandchild of launchd knows too. */
export const LOADED_ENV = 'BEADCAUSE_LAUNCHD_PROGRAM';

/**
 * What launchd actually handed the running job — from inside a process that may be
 * one hop further down than the one launchd started.
 *
 * `process.argv[1]` is the answer only for a process launchd started itself, which is
 * `process.ppid === 1`: that is how a LaunchAgent's child arrives and how nothing a
 * person types does. A router-spawned backend is a *grandchild*, sees `bin/beadcause.js`
 * in its own argv, and would read that as "launchd started the plain server" — accusing
 * a perfectly good install of never having been reloaded. So the router passes down what
 * it was handed in `LOADED_ENV`, and that always wins.
 *
 * The router writes the variable on every spawn, empty when it was not launchd that
 * started it, so an inherited value from some outer shell can never be mistaken for a
 * fact about this job. Empty and absent both mean the same thing: we do not know, and
 * callers get the disk half of the answer only.
 */
export function launchdProgram({ env = process.env, argv = process.argv, ppid = process.ppid } = {}) {
  const passed = env[LOADED_ENV];
  if (passed) return passed;
  if (passed === '') return null; // Written and empty: the router says nobody's launchd job.
  if (ppid === 1) return argv[1] || null;
  // systemd sets MANAGERPID to the manager that started the unit — `systemd --user`,
  // never pid 1 — so a direct child of it is the same fact a ppid of 1 is under launchd.
  if (env.MANAGERPID && String(ppid) === String(env.MANAGERPID)) return argv[1] || null;
  return null;
}

/**
 * The whole verdict as something a screen can draw — including "it is fine".
 *
 * hotSwapProblem() returns null when there is nothing wrong, which is the right shape
 * for a banner (a warning nobody needs is noise) and the wrong shape for a health line.
 * The console asks a different question: *what is launchd running?* — and it has to
 * answer that on a good day too, because the three days this bug survived were three
 * days of every surface Adam looks at saying nothing at all. A line that only appears
 * when something is wrong is a line you cannot trust the absence of.
 *
 * So: always `program`, always `plist`, and `ok: false` with the same `lines` the log
 * banner carries when it matters. `label` is what fits a phone — `bin/router.js` when
 * the program is inside this checkout, the absolute path when it is somebody else's,
 * because *whose* router it is is the entire content of that case.
 */
export function serviceHealth({ root = ROOT, home = os.homedir(), loadedProgram = launchdProgram(), manager = serviceManager() } = {}) {
  const want = path.join(root, 'bin', 'router.js');
  const svc = installedService({ home, manager });
  const problem = hotSwapProblem({ root, home, loadedProgram, manager });
  // What launchd started beats what the file says, when they differ: the running job is
  // the one answering the port. Only `not-reloaded` can tell them apart, and it is the
  // case where reading the file alone gives the reassuring answer.
  const running = problem?.code === 'not-reloaded' ? loadedProgram : svc.program;
  const short = (p) => {
    if (!p) return null;
    const rel = path.relative(root, p);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p;
  };
  // `lines` are hard-wrapped for a log, where the width is fixed and the prefix is
  // per-line. A screen re-wraps for itself, and those breaks land mid-sentence on a
  // phone — so the same words are also offered as one paragraph, with the last line
  // held back: it is always the fix, and the fix is worth its own row.
  const lines = problem?.lines || [];
  const fix = problem ? 'npm run install-service' : null;
  const last = lines[lines.length - 1] || '';
  const cut = fix ? last.indexOf(fix) : -1;
  return {
    ok: !problem,
    code: problem?.code || 'live',
    summary: problem?.summary || `${manager} runs ${short(want)} — the hot-swap is live`,
    manager,
    lines,
    detail: (cut >= 0 ? lines.slice(0, -1) : lines).join(' '),
    fix,
    // The fix line split around the command, because the words either side of it are
    // not decoration: `foreign-program` makes it conditional ("if this is the checkout
    // that should be serving"), and `not-reloaded` says what it does after it
    // ("it boots the job out and back in"). A bare command would drop both.
    fixBefore: cut >= 0 ? last.slice(0, cut).trim() : '',
    fixAfter: cut >= 0 ? last.slice(cut + fix.length).trim() : '',
    plist: svc.path,
    installed: svc.exists,
    // Absolute, then the form worth putting on a 360px screen. Both, because a
    // foreign checkout is only recognisable by its path.
    program: running,
    label: short(running),
    want,
    wantLabel: short(want),
    // Null on a hand-run daemon, and that is a distinction worth sending: it is the
    // difference between "the job is right" and "nobody asked the job".
    loadedProgram: loadedProgram || null,
  };
}

/**
 * What the router in front of this backend is doing — asked, not assumed.
 *
 * `serviceHealth` above answers "which program did launchd start"; this answers the
 * question underneath it, which bc-excc is about: *is that program serving anything*.
 * A router that condemned a build and has no backend behind it holds the port, answers
 * every request with a 503, and looks perfectly alive to launchd.
 *
 * Which is also the honest limit of this call, and it is written on the tin: the console
 * can only ever show the *degraded* states — serving a stale build because the newer one
 * died, or because it was too slow and is being retried. A total outage is not visible
 * here by construction, because nothing is; that case is answered by the two surfaces
 * the router owns itself, the 503 body and the ntfy push, both in bin/router.js.
 *
 * Loopback and the shared token, which is what the router's control plane requires. It
 * is the same port this process is already being proxied through, so there is no new
 * address and no new secret. `null` for anything unexpected: under `npm run start:bare`
 * there is no router at all, and a page that invented a verdict out of a connection
 * error would be worse than one that says nothing.
 */
export async function routerHealth(cfg, { timeout = 1500 } = {}) {
  const snap = await new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: cfg.port,
        path: '/internal/router/state',
        headers: { 'x-beadcause-token': cfg.token },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            const parsed = JSON.parse(body);
            // Nothing else answers this path, but `router` is what proves who replied.
            resolve(parsed && parsed.router ? parsed : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.setTimeout(timeout, () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
  if (!snap) return null;

  const verdict = explain(snap) || {};
  return {
    ok: Boolean(verdict.ok),
    code: verdict.code || 'unknown',
    summary: verdict.summary || '',
    // One paragraph rather than the log's hard-wrapped lines, and the fix held back for
    // its own row — the same split serviceHealth makes, for the same phone.
    detail: (verdict.lines || []).filter((l) => !verdict.fix || !l.includes(verdict.fix)).join(' '),
    fix: verdict.fix || null,
    serving: Boolean(snap.serving),
    // What is on the router's socket, straight through — the one TLS fact a backend
    // cannot work out for itself, because it binds loopback and speaks plain HTTP by
    // design. `undefined` from a router older than this field, which reads as "could
    // not say" rather than "no certificate"; see lib/tlsswitch.js on why those two
    // must not be confused.
    certificate: snap.certificate === undefined ? undefined : snap.certificate || null,
    build: snap.active?.build || null,
    disk: snap.disk,
    // Whether the router itself is older than its own source — the one degraded state
    // here that is about the process in front of the backends rather than about them,
    // and the one that does not clear itself. Sent as a flag as well as riding the
    // verdict because the verdict reports the most urgent thing only: a router that is
    // stale *and* has a poisoned build behind it says `poisoned`, and this stays true
    // underneath it. `false` from a router too old to carry the field, which is the
    // safe direction — it reads as "nothing to say" rather than inventing a problem.
    sourceChanged: Boolean(snap.router?.sourceChanged),
    pid: snap.active?.pid || null,
    // Why a swap has not happened, in the two words that are not interchangeable.
    poisoned: snap.poisoned || null,
    deferred: snap.deferred || null,
  };
}
