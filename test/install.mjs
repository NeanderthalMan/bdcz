#!/usr/bin/env node
/**
 * The installer, run for real, in a fake home with fake `launchctl` — because the two
 * ways it could not be run from an agent session cancelled each other out.
 *
 *   npm test
 *   node test/install.mjs
 *
 * `scripts/install.sh` feeds `configure.js` from `/dev/tty` rather than stdin, because
 * `npm run` pipes stdin and an installer that silently skipped its own questions was
 * the original bug. But `/dev/tty` is the *controlling terminal*, not a human: in an
 * agent session it is the agent's own terminal, so the questions are asked of nobody and
 * the install hangs on the first one. The escape — `setsid`, so `/dev/tty` fails and the
 * step warns and carries on — also leaves the GUI session, so `launchctl bootstrap
 * gui/<uid>` then failed with `Bootstrap failed: 5: Input/output error`. It failed
 * *after* the bootout, with `set -e` on, which left the daemon **unloaded**: port dead,
 * readiness wait dying, and the loaded-program check, the monitor and the QRs all
 * skipped. It was recovered by hand, but the window between the two was a real outage on
 * the one path whose whole job is not to have one.
 *
 * So two things are pinned here, and the second is the one worth the machinery:
 *
 * 1. **The decision about the questions**, in all four directions: the flag, the
 *    environment variable, an inferred agent session, and `--interactive` overriding the
 *    inference. On every skipping path `configure.js` must still run — it prints what is
 *    configured — and must be handed something that is *not* a terminal, which is the
 *    whole fix. (The hang itself cannot be reproduced here: the `node` on PATH is a shim
 *    that never blocks. What is testable is the choice, and the choice is the fix.)
 *
 * 2. **A failed load never leaves nothing loaded.** Three shapes: the domain refuses
 *    every job (the setsid case) and the running service is therefore never booted out
 *    at all; the domain is fine but *this* plist is refused, and the one that was
 *    installed before is put back and loaded again; and the same with no previous plist,
 *    where there is nothing to fall back to and it has to say so rather than imply a
 *    recovery.
 *
 * Nothing here touches the real service. `HOME` is a temporary directory, and `PATH` is
 * a directory of shims — `launchctl`, `curl`, `npm`, `node`, `bd` — followed by
 * /usr/bin:/bin for the coreutils the script uses. The shims log their argv, so the
 * assertions can be about the order things happened in, which is where the bug lived:
 * the probe has to come *before* the bootout, or it is not a probe.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.join(ROOT, 'scripts', 'install.sh');
const LABEL = 'n12n.beadcause';
const UID = process.getuid();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-install-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

/* ------------------------------------------------------------------- harness */

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      ${detail}` : ''}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

/* --------------------------------------------------------------------- shims */

/**
 * The `node` the installer finds on PATH.
 *
 * It answers the five questions install.sh asks node — the version, the team tracker, the
 * monitor flag, configure.js, and the pairing QR — and records every call. For configure.js
 * it also records whether what it was handed on stdin is a terminal, which is the difference
 * between "asked a human" and "printed the current config": a skipping run must never
 * see a tty here.
 *
 * BEADCAUSE_TEST_ONBOARD_EXIT is what scripts/onboard.mjs returns, and it is switchable
 * because the installer reads it rather than ignoring it: 1 is a refusal that must stop the
 * install with the running service untouched, and 2 is a step that may work next time and
 * must not. The real script's own behaviour is test/onboard.mjs's business; what is
 * testable here is what install.sh does with the answer.
 */
const NODE_SHIM = `#!/bin/bash
log="$BEADCAUSE_TEST_LOGDIR/node.log"
if [ -t 0 ]; then stdin=tty; else stdin=notty; fi
printf '%s [stdin=%s]\\n' "$*" "$stdin" >> "$log"
case "$*" in
  *onboard.mjs*) exit "\${BEADCAUSE_TEST_ONBOARD_EXIT:-0}" ;;
  *phone-host*)  printf '%s' "\${BEADCAUSE_TEST_PHONE:-noip}"; exit 0 ;;
  *bind-host*)   printf '%s' "\${BEADCAUSE_TEST_HOST:-127.0.0.1}"; exit 0 ;;
  # The systemd unit is rendered by the real lib/service.js, so this one call is real node.
  *service-unit.mjs*) exec "$BEADCAUSE_TEST_REAL_NODE" "$@" ;;
  # So are the Claude Code allow rules (bc-eg9tj): they land in the fake HOME.
  *claude-permissions.mjs*) exec "$BEADCAUSE_TEST_REAL_NODE" "$@" ;;
esac
case "$1" in
  -p) echo "\${BEADCAUSE_TEST_NODE_MAJOR:-22}" ;;
  -e) printf '%s' "\${BEADCAUSE_TEST_MONITOR:-0}" ;;
  *)  ;;
esac
exit 0
`;

/**
 * `launchctl`, with the two failures that matter switchable.
 *
 * BEADCAUSE_TEST_BOOTSTRAP_FAIL_ALL — every bootstrap fails, including the probe. This
 * is the shell with no GUI session, and the shape of its error is launchd's own.
 *
 * BEADCAUSE_TEST_BOOTSTRAP_FAIL_MATCH — a bootstrap fails only if the plist it is given
 * *contains* this string. Set to `bin/router.js` it refuses the newly generated plist
 * while accepting both the probe and a previous plist that named bin/beadcause.js, which
 * is the real drift this repo has already lived through.
 */
const LAUNCHCTL_SHIM = `#!/bin/bash
printf '%s\\n' "$*" >> "$BEADCAUSE_TEST_LOGDIR/launchctl.log"
case "$1" in
  bootstrap)
    if [ -n "\${BEADCAUSE_TEST_BOOTSTRAP_FAIL_ALL:-}" ]; then
      echo "Bootstrap failed: 5: Input/output error" >&2
      exit 5
    fi
    if [ -n "\${BEADCAUSE_TEST_BOOTSTRAP_FAIL_MATCH:-}" ] &&
       grep -q "\$BEADCAUSE_TEST_BOOTSTRAP_FAIL_MATCH" "$3" 2>/dev/null; then
      echo "Bootstrap failed: 5: Input/output error" >&2
      exit 5
    fi
    exit 0 ;;
  print)
    printf '\\targuments = {\\n\\t\\t/usr/bin/node\\n\\t\\t%s\\n\\t}\\n' "\${BEADCAUSE_TEST_LOADED:-}" ;;
  list) ;;
esac
exit 0
`;

/**
 * `systemctl` and `loginctl`, for the Linux half (bc-obucr.3) run on a Mac.
 *
 * BEADCAUSE_TEST_NO_USER_MANAGER — `systemctl --user` cannot reach a user manager, which
 * is what an `su` shell gets. BEADCAUSE_TEST_ENABLE_FAIL — `enable` refuses the unit.
 * BEADCAUSE_TEST_LINGER — what `loginctl show-user` reports (default no);
 * BEADCAUSE_TEST_LINGER_FAIL makes `enable-linger` fail, as it does without polkit.
 */
const SYSTEMCTL_SHIM = `#!/bin/bash
printf '%s\\n' "$*" >> "$BEADCAUSE_TEST_LOGDIR/systemctl.log"
[ -n "\${BEADCAUSE_TEST_NO_USER_MANAGER:-}" ] && { echo "Failed to connect to bus: No medium found" >&2; exit 1; }
case "$2" in
  enable) [ -n "\${BEADCAUSE_TEST_ENABLE_FAIL:-}" ] && { echo "Failed to enable unit: Unit file is masked." >&2; exit 1; } ;;
  show)   printf 'ExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node %s ; ignore_errors=no }\\n' "\${BEADCAUSE_TEST_LOADED:-}" ;;
esac
exit 0
`;

const LOGINCTL_SHIM = `#!/bin/bash
printf '%s\\n' "$*" >> "$BEADCAUSE_TEST_LOGDIR/loginctl.log"
case "$1" in
  show-user)     echo "Linger=\${BEADCAUSE_TEST_LINGER:-no}" ;;
  enable-linger) [ -n "\${BEADCAUSE_TEST_LINGER_FAIL:-}" ] && exit 1 ;;
esac
exit 0
`;

const CURL_SHIM = `#!/bin/bash
printf '%s\\n' "$*" >> "$BEADCAUSE_TEST_LOGDIR/curl.log"
[ -n "\${BEADCAUSE_TEST_CURL_FAIL:-}" ] && exit 7
echo '{"ok":true,"workspaces":["beadcause"]}'
exit 0
`;

const NOOP_SHIM = `#!/bin/bash
printf '%s\\n' "$*" >> "$BEADCAUSE_TEST_LOGDIR/$(basename "$0").log"
exit 0
`;

/**
 * `brew`, present only in a run that asks for it. It logs its argv and makes what it was
 * asked to install actually appear — a shim on PATH, an app bundle in the fake
 * Applications folder, the Tailscale binary where BEADCAUSE_TAILSCALE points — so the
 * installer's re-check afterwards finds it the way it would find the real thing.
 * BEADCAUSE_TEST_BREW_FAIL makes every call fail.
 */
const BREW_SHIM = `#!/bin/bash
printf '%s\\n' "$*" >> "$BEADCAUSE_TEST_LOGDIR/brew.log"
[ -n "\${BEADCAUSE_TEST_BREW_FAIL:-}" ] && exit 1
bin="$(dirname "$0")"
shim() { printf '#!/bin/bash\\nexit 0\\n' > "$bin/$1"; chmod +x "$bin/$1"; }
case "$*" in
  "install beads"|"upgrade beads") shim bd ;;
  "install gh") shim gh ;;
  "install jq") shim jq ;;
  "install --cask claude-code") shim claude ;;
  "install --cask iterm2") mkdir -p "$BEADCAUSE_APP_DIRS/iTerm.app" ;;
  "install --cask tailscale-app") : > "$BEADCAUSE_TAILSCALE" ;;
esac
exit 0
`;

/**
 * The apt half (bc-obucr.4), run on a Mac through BEADCAUSE_SERVICE_MANAGER=systemd.
 * `apt-get` logs its argv and makes what it installs appear beside itself; `apt-cache`
 * reports BEADCAUSE_TEST_NODE_CANDIDATE as nodejs's candidate; `sudo` accepts -n and runs
 * the rest, or refuses when BEADCAUSE_TEST_NO_SUDO is set, as a box with no passwordless
 * sudo does. `id -u` is the real user's, so a Mac run always goes through the sudo shim.
 */
const APT_GET_SHIM = `#!/bin/bash
printf '%s\\n' "$*" >> "$BEADCAUSE_TEST_LOGDIR/apt.log"
[ -n "\${BEADCAUSE_TEST_APT_FAIL:-}" ] && exit 100
bin="$(dirname "$0")"
for p in "$@"; do
  case "$p" in
    nodejs) printf '#!/bin/bash\\nexec "$BEADCAUSE_TEST_REAL_NODE" "$@"\\n' > "$bin/node"; chmod +x "$bin/node" ;;
    gh|jq|tmux|git|curl|expect|npm) printf '#!/bin/bash\\nexit 0\\n' > "$bin/$p"; chmod +x "$bin/$p" ;;
  esac
done
exit 0
`;
const APT_CACHE_SHIM = `#!/bin/bash
printf 'nodejs:\\n  Installed: (none)\\n  Candidate: %s.19.1-1\\n' "\${BEADCAUSE_TEST_NODE_CANDIDATE:-18}"
`;
const SUDO_SHIM = `#!/bin/bash
printf '%s\\n' "$*" >> "$BEADCAUSE_TEST_LOGDIR/sudo.log"
[ -n "\${BEADCAUSE_TEST_NO_SUDO:-}" ] && exit 1
[ "$1" = -n ] && shift
exec "$@"
`;
const APT = { 'apt-get': APT_GET_SHIM, 'apt-cache': APT_CACHE_SHIM, sudo: SUDO_SHIM };

/**
 * A run of the installer: its own HOME, its own shim log, nothing shared.
 *
 * `brew: true` puts the brew shim on PATH. `shims` overrides a default shim's body, or
 * removes it with null — which is how a dependency is made missing. `apps` is what the
 * fake Applications folder holds.
 */
// A system PATH with no tmux on it. A host with a real /usr/bin/tmux (every Linux CI runner)
// cannot pose "tmux is not installed" by leaving a shim out, so this is a directory of
// symlinks to everything in /usr/bin and /bin except tmux. Built once, on first use.
let TMUXLESS = null;
function tmuxlessSystem() {
  if (TMUXLESS) return TMUXLESS;
  const dir = path.join(tmp, 'system-without-tmux');
  fs.mkdirSync(dir, { recursive: true });
  for (const src of ['/usr/bin', '/bin']) {
    let names = [];
    try { names = fs.readdirSync(src); } catch { continue; }
    for (const n of names) {
      if (n === 'tmux') continue;
      try { fs.symlinkSync(path.join(src, n), path.join(dir, n)); } catch { /* first one wins */ }
    }
  }
  return (TMUXLESS = dir);
}

function run(name, { args = [], env = {}, previousPlist = null, previousUnit = null, brew = false, shims = {}, apps = ['iTerm.app'], claudeSettings = null, hideTmux = false } = {}) {
  const dir = path.join(tmp, name);
  const home = path.join(dir, 'home');
  const bin = path.join(dir, 'bin');
  const logs = path.join(dir, 'logs');
  const appsDir = path.join(dir, 'apps');
  for (const d of [path.join(home, 'Library', 'LaunchAgents'), bin, logs, appsDir]) fs.mkdirSync(d, { recursive: true });
  for (const app of apps) fs.mkdirSync(path.join(appsDir, app), { recursive: true });

  const bodies = {
    node: NODE_SHIM,
    launchctl: LAUNCHCTL_SHIM,
    systemctl: SYSTEMCTL_SHIM,
    loginctl: LOGINCTL_SHIM,
    curl: CURL_SHIM,
    npm: NOOP_SHIM,
    bd: NOOP_SHIM,
    gh: NOOP_SHIM,
    claude: NOOP_SHIM,
    tailscale: NOOP_SHIM,
    ...(brew ? { brew: BREW_SHIM } : {}),
    ...shims,
  };
  for (const [file, body] of Object.entries(bodies)) {
    if (body === null) continue;
    const p = path.join(bin, file);
    fs.writeFileSync(p, body);
    fs.chmodSync(p, 0o755);
  }

  const plist = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (previousPlist) fs.writeFileSync(plist, previousPlist);
  const unit = path.join(home, '.config', 'systemd', 'user', 'beadcause.service');
  if (previousUnit) {
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, previousUnit);
  }

  const claudeSettingsPath = path.join(home, '.claude', 'settings.json');
  if (claudeSettings !== null) {
    fs.mkdirSync(path.dirname(claudeSettingsPath), { recursive: true });
    fs.writeFileSync(claudeSettingsPath, claudeSettings);
  }

  let status;
  // spawnSync rather than execFileSync, for one reason: `execFileSync` hands back stdout
  // alone on a run that *succeeds*, and every `warn` in the installer goes to stderr. So a
  // warning printed by a run that finished — the whole of what a recoverable failure looks
  // like — was invisible to an assertion, and the only reason nothing had noticed is that
  // the checks here were all about runs that died.
  const r = spawnSync('bash', [INSTALL, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // A hang is the bug this file is about, so it must fail rather than wedge `npm test`.
    timeout: 60_000,
    env: {
      // Built from nothing rather than inherited: CLAUDECODE and CI are exactly what
      // the decision under test reads, and this suite runs in both.
      HOME: home,
      TMPDIR: dir,
      PATH: hideTmux ? `${bin}:${tmuxlessSystem()}` : `${bin}:/usr/bin:/bin`,
      BEADCAUSE_TEST_LOGDIR: logs,
      BEADCAUSE_TEST_LOADED: path.join(ROOT, 'bin', 'router.js'),
      BEADCAUSE_TEST_REAL_NODE: process.execPath,
      // Every place the installer would otherwise look on the real Mac: Homebrew off PATH,
      // /Applications, and the absolute Tailscale paths. Without these a run here could
      // find — or install into — the machine it is running on.
      BEADCAUSE_BREW_SEARCH: '',
      BEADCAUSE_APP_DIRS: appsDir,
      BEADCAUSE_TAILSCALE: path.join(bin, 'tailscale'),
      // The launchd path is the default under test, so pin it: off a Mac the installer
      // would otherwise pick systemd from `uname`. A case that wants systemd passes it.
      BEADCAUSE_SERVICE_MANAGER: 'launchd',
      ...env,
    },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  status = r.error?.code === 'ETIMEDOUT' ? 'TIMED OUT' : (r.status ?? r.error?.code ?? 0);
  const read = (f) => (fs.existsSync(path.join(logs, f)) ? fs.readFileSync(path.join(logs, f), 'utf8') : '');
  return {
    status,
    out,
    plist,
    plistText: fs.existsSync(plist) ? fs.readFileSync(plist, 'utf8') : null,
    rejectedText: fs.existsSync(`${plist}.rejected`) ? fs.readFileSync(`${plist}.rejected`, 'utf8') : null,
    node: read('node.log'),
    launchctl: read('launchctl.log').trim().split('\n').filter(Boolean),
    systemctl: read('systemctl.log').trim().split('\n').filter(Boolean),
    loginctl: read('loginctl.log').trim().split('\n').filter(Boolean),
    unit,
    unitText: fs.existsSync(unit) ? fs.readFileSync(unit, 'utf8') : null,
    unitRejectedText: fs.existsSync(`${unit}.rejected`) ? fs.readFileSync(`${unit}.rejected`, 'utf8') : null,
    brew: read('brew.log').trim().split('\n').filter(Boolean),
    apt: read('apt.log').trim().split('\n').filter(Boolean),
    sudo: read('sudo.log').trim().split('\n').filter(Boolean),
    curl: read('curl.log').trim().split('\n').filter(Boolean),
    home,
    claudeSettingsPath,
    claudeSettingsText: fs.existsSync(claudeSettingsPath) ? fs.readFileSync(claudeSettingsPath, 'utf8') : null,
  };
}

/** The plist that was installed before — the pre-router one this Mac really had. */
const OLD_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/node</string><string>${ROOT}/bin/beadcause.js</string></array>
</dict></plist>
`;

/* ------------------------------------------------- 1. asking, and not asking */

console.log('the questions');

{
  const r = run('flag', { args: ['--non-interactive'] });
  check('--non-interactive finishes', r.status === 0, `exit ${r.status}\n${r.out}`);
  check('and says why it did not ask', /not asking the setup questions \(--non-interactive\)/.test(r.out), r.out);
  check('configure.js still runs, so the current config is printed', /configure\.js/.test(r.node), r.node);
  check(
    'and is handed something that is not a terminal — the whole fix',
    /configure\.js.*\[stdin=notty\]/.test(r.node),
    r.node
  );
}

{
  const r = run('env', { env: { SKIP_CONFIGURE: '1' } });
  check('SKIP_CONFIGURE=1 does the same', r.status === 0, `exit ${r.status}\n${r.out}`);
  check('and names the variable rather than a flag', /SKIP_CONFIGURE=1/.test(r.out), r.out);
  check('still not a terminal', /configure\.js.*\[stdin=notty\]/.test(r.node), r.node);
}

{
  const r = run('agent', { env: { CLAUDECODE: '1' } });
  check('an agent session needs no flag at all', r.status === 0, `exit ${r.status}\n${r.out}`);
  check('and is told it looks like one', /agent session/.test(r.out), r.out);
  check('not a terminal there either', /configure\.js.*\[stdin=notty\]/.test(r.node), r.node);
}

{
  const r = run('forced', { args: ['--interactive'], env: { CLAUDECODE: '1' } });
  check('--interactive overrides the inference', r.status === 0, `exit ${r.status}\n${r.out}`);
  check('and does not claim to have skipped anything', !/not asking the setup questions/.test(r.out), r.out);
}

{
  const r = run('plain');
  check('a plain run asks, as it always did', !/not asking the setup questions/.test(r.out), r.out);
}

{
  const r = run('bogus', { args: ['--wat'] });
  check('an unknown option is refused rather than ignored', r.status === 1, `exit ${r.status}`);
  check('and the usage is printed with it', /--non-interactive/.test(r.out), r.out);
}

/* -------------------------------------------- 1b. the team's tracker, and its answer */

/**
 * The step a second engineer's install was missing, and what the installer does with its
 * three exit codes. The tracker has to exist *before* the questions: on a fresh Mac there
 * is no workspace at all, so `configure.js` would print "No beads workspaces found" and
 * exit, and the daemon would come up serving an empty inbox with nothing wrong with it.
 */
console.log("\nthe team's tracker");

{
  const r = run('tracker-order', { args: ['-n'] });
  const onboard = r.node.indexOf('onboard.mjs');
  const configure = r.node.indexOf('configure.js');
  check('the onboarding runs', onboard >= 0, r.node);
  check('before the questions are asked about it', onboard >= 0 && onboard < configure, r.node);
  check('and a solo install is unaffected by it', r.status === 0, `exit ${r.status}\n${r.out}`);
}

{
  const r = run('tracker-refused', { args: ['-n'], env: { BEADCAUSE_TEST_ONBOARD_EXIT: '1' } });
  check('a refusal stops the install', r.status !== 0, `exit ${r.status}\n${r.out}`);
  check('and says a decision is needed', /needs a decision/.test(r.out), r.out);
  // The reason the step sits this early: nothing has been booted out yet, so what was
  // loaded is still loaded and still running. Same argument as the bootstrap probe.
  check(
    'with the running service never booted out',
    !r.launchctl.some((l) => l.startsWith('bootout')),
    r.launchctl.join('\n')
  );
  check('and no plist written', r.plistText === null, String(r.plistText).slice(0, 120));
}

{
  const r = run('tracker-failed', { args: ['-n'], env: { BEADCAUSE_TEST_ONBOARD_EXIT: '2' } });
  check('a step that may work next time only warns', r.status === 0, `exit ${r.status}\n${r.out}`);
  check('and says so, with the code', /not set up yet.*exit 2/.test(r.out), r.out);
  check('the daemon is still installed', r.launchctl.some((l) => l.includes(`${LABEL}.plist`)), r.launchctl.join('\n'));
}

/* ------------------------------------- 1b'. Claude Code allow rules for bd (bc-eg9tj) */

console.log('\nClaude Code allow rules');

{
  const mine = { statusLine: { type: 'command', command: 'x.sh' }, permissions: { allow: ['Bash(ls)'] } };
  const r = run('claude-perms', { args: ['-n'], claudeSettings: JSON.stringify(mine) });
  const merged = r.claudeSettingsText ? JSON.parse(r.claudeSettingsText) : {};
  check('the install finishes', r.status === 0, `exit ${r.status}\n${r.out}`);
  check(
    'bd create and bd comments add are allowed in ~/.claude/settings.json',
    ['Bash(bd create:*)', 'Bash(bd comments add:*)'].every((x) => merged.permissions?.allow?.includes(x)),
    r.claudeSettingsText ?? '(no file)'
  );
  check(
    'and what was there already is kept',
    merged.statusLine?.command === 'x.sh' && merged.permissions?.allow?.[0] === 'Bash(ls)',
    r.claudeSettingsText ?? '(no file)'
  );
}

{
  const r = run('claude-perms-broken', { args: ['-n'], claudeSettings: '{ broken' });
  check('a broken settings.json only warns', r.status === 0, `exit ${r.status}\n${r.out}`);
  check('and says so', /allow rules for bd were not all written/.test(r.out), r.out);
  check('and is left as it was', r.claudeSettingsText === '{ broken', r.claudeSettingsText ?? '(gone)');
}

/* ------------------------------------------------- 1c. installing what is missing */

console.log('\ninstalling what is missing');

{
  const r = run('deps-fresh', { args: ['-n'], brew: true, shims: { bd: null, gh: null, claude: null, tailscale: null }, apps: [] });
  check('a Mac with nothing on it still installs', r.status === 0, `exit ${r.status}\n${r.out}`);
  check('beads is installed with brew', r.brew.includes('install beads'), r.brew.join('\n'));
  check('and so are gh, iTerm2 and Claude Code', ['install gh', 'install --cask iterm2', 'install --cask claude-code'].every((l) => r.brew.includes(l)), r.brew.join('\n'));
  check('the bd it installed is the one the service is loaded with', r.launchctl.some((l) => l.includes(`${LABEL}.plist`)), r.launchctl.join('\n'));
  check('Tailscale is not part of the default install', !r.brew.some((l) => l.includes('tailscale')), r.brew.join('\n'));
  check('and nothing complains that it is missing', !/Tailscale not found/.test(r.out), r.out);
}

/* ------------------------------------------------------------- 1d. the phone */

console.log('\nthe phone');

{
  const r = run('loopback', { args: ['-n'] });
  check('without --phone it answers on loopback and says so', /127\.0\.0\.1:4318, on this Mac only/.test(r.out), r.out);
  check('and says how to turn the phone on later', /install-service -- --phone/.test(r.out), r.out);
  check('no pairing QR for an address the phone cannot reach', !/--qr/.test(r.node), r.node);
  check('and the tailnet address is never written', !/phone-host/.test(r.node), r.node);
}

{
  const r = run('phone-tailscale', { args: ['--phone', '--interactive'], brew: true, shims: { tailscale: null } });
  check('--phone installs Tailscale with somebody there', r.brew.includes('install --cask tailscale-app'), r.brew.join('\n'));
  check('and they are told to sign it in', /sign in/.test(r.out), r.out);
}

{
  const r = run('phone-unattended', { args: ['--phone', '-n'], brew: true, shims: { tailscale: null } });
  check('--phone with nobody to type the admin password does not try', !r.brew.some((l) => l.includes('tailscale')), r.brew.join('\n'));
  check('and names the command instead', /brew install --cask tailscale-app/.test(r.out), r.out);
}

{
  const r = run('phone-noip', { args: ['--phone', '-n'] });
  check('--phone before Tailscale is signed in says to sign in and re-run', /sign in, then re-run with --phone/.test(r.out), r.out);
  check('and still finishes', r.status === 0, `exit ${r.status}\n${r.out}`);
}

{
  const r = run('phone-on', {
    args: ['--phone', '-n'],
    env: { BEADCAUSE_TEST_PHONE: 'set 100.64.0.7', BEADCAUSE_TEST_HOST: '100.64.0.7' },
  });
  check('--phone writes the tailnet address', /phone-host/.test(r.node) && /listening on 100\.64\.0\.7/.test(r.out), `${r.node}\n${r.out}`);
  check('before the service is loaded, so it starts listening there', r.node.indexOf('phone-host') < r.node.indexOf('bind-host'), r.node);
  check('and prints the pairing QR', /--qr/.test(r.node), r.node);
}

{
  const r = run('deps-present', { args: ['-n'], brew: true });
  check('nothing already there is installed or upgraded', r.brew.length === 0, r.brew.join('\n'));
}

{
  const old = `#!/bin/bash
[ "$1" = --version ] && echo "bd version 1.1.0 (Homebrew)"
exit 0
`;
  const r = run('deps-oldbd', { args: ['-n'], brew: true, shims: { bd: old } });
  check(`a bd older than 1.2.1 is upgraded`, r.brew.includes('upgrade beads'), r.brew.join('\n'));
}

// Compared number by number, not as text: 1.10.0 is newer than 1.2.1 though it sorts before it.
for (const version of ['1.2.1', '1.10.0']) {
  const bd = `#!/bin/bash
[ "$1" = --version ] && echo "bd version ${version} (Homebrew)"
exit 0
`;
  const r = run(`deps-bd-${version}`, { args: ['-n'], brew: true, shims: { bd } });
  check(`bd ${version} is left alone`, !r.brew.includes('upgrade beads'), r.brew.join('\n'));
}

{
  const r = run('deps-brew-fails', { args: ['-n'], brew: true, apps: [], env: { BEADCAUSE_TEST_BREW_FAIL: '1' } });
  check('a failed optional install does not stop the install', r.status === 0, `exit ${r.status}\n${r.out}`);
  check('and says what failed', /brew install --cask iterm2 failed/.test(r.out), r.out);
}

{
  const r = run('deps-off', { args: ['-n', '--no-deps'], brew: true, shims: { bd: null } });
  check('--no-deps never runs brew', r.brew.length === 0, r.brew.join('\n'));
  check('and a missing bd is still fatal', r.status === 1 && /not on your PATH/.test(r.out), `exit ${r.status}\n${r.out}`);
}

{
  const r = run('deps-nobrew', { args: ['-n'], shims: { bd: null } });
  check('without Homebrew a missing bd is fatal', r.status === 1, `exit ${r.status}\n${r.out}`);
  check('and it says where Homebrew comes from', /brew\.sh/.test(r.out), r.out);
}

/* ------------------------------------------------------ 2. loading, and not */

console.log('\nloading the service');

{
  const r = run('load', { args: ['-n'] });
  const probe = r.launchctl.findIndex((l) => l.startsWith('bootstrap') && l.includes('bootstrap-probe'));
  const bootout = r.launchctl.findIndex((l) => l === `bootout gui/${UID}/${LABEL}`);
  const boot = r.launchctl.findIndex((l) => l.startsWith(`bootstrap gui/${UID} `) && l.includes(`${LABEL}.plist`));
  check('it bootstraps a throwaway job before touching the real one', probe >= 0 && probe < bootout, r.launchctl.join('\n'));
  check('unloads the probe again', r.launchctl.some((l) => l.includes(`bootout gui/${UID}/${LABEL}.bootstrap-probe`)), r.launchctl.join('\n'));
  check('then boots the service out and back in, in that order', bootout >= 0 && boot > bootout, r.launchctl.join('\n'));
  check('and kickstarts it', r.launchctl.includes(`kickstart -k gui/${UID}/${LABEL}`), r.launchctl.join('\n'));
  check('the plist names bin/router.js in this checkout', r.plistText?.includes(`${ROOT}/bin/router.js`), String(r.plistText).slice(0, 200));
  check('nothing was rejected', r.rejectedText === null);
  check('and the whole thing exits 0', r.status === 0, `exit ${r.status}\n${r.out}`);
}

{
  // The setsid case: the domain will not take any job at all.
  const r = run('nogui', { args: ['-n'], env: { BEADCAUSE_TEST_BOOTSTRAP_FAIL_ALL: '1' }, previousPlist: OLD_PLIST });
  check('a domain that refuses everything is a failure', r.status === 1, `exit ${r.status}\n${r.out}`);
  check(
    'and the running service is never booted out — this is the outage that happened',
    !r.launchctl.includes(`bootout gui/${UID}/${LABEL}`),
    r.launchctl.join('\n')
  );
  check('it says the GUI session is the problem, not the plist', /GUI session|gui\//.test(r.out), r.out);
  check('names the state it left behind: rewritten, never reloaded', /never reloaded/.test(r.out), r.out);
  check('reports that what is loaded is still answering', /still up and answering/.test(r.out), r.out);
  check(
    'and hands over the three commands that finish it',
    /launchctl bootout gui\//.test(r.out) && /launchctl bootstrap gui\//.test(r.out) && /launchctl kickstart -k gui\//.test(r.out),
    r.out
  );
}

{
  // The domain is fine; this plist is not. The label is already booted out by then, so
  // the only acceptable end state is the previous one loaded again.
  const r = run('rejected', {
    args: ['-n'],
    env: { BEADCAUSE_TEST_BOOTSTRAP_FAIL_MATCH: 'bin/router.js' },
    previousPlist: OLD_PLIST,
  });
  check('a refused plist is a failure', r.status === 1, `exit ${r.status}\n${r.out}`);
  check('the plist that was installed before is back on disk', r.plistText === OLD_PLIST, String(r.plistText).slice(0, 200));
  check('and it was loaded again, so the service is up', r.launchctl.filter((l) => l.startsWith(`bootstrap gui/${UID} `)).length >= 2, r.launchctl.join('\n'));
  check('restarted too, rather than left loaded but stopped', r.launchctl.includes(`kickstart -k gui/${UID}/${LABEL}`), r.launchctl.join('\n'));
  check('the rejected one is kept for comparison', r.rejectedText?.includes(`${ROOT}/bin/router.js`), String(r.rejectedText).slice(0, 200));
  check('and it says what it put back', /back in place and loaded again/.test(r.out), r.out);
}

{
  // First install, and the generated plist is refused: there is no previous one, and
  // pretending otherwise would be the one thing worse than the failure.
  const r = run('nofallback', { args: ['-n'], env: { BEADCAUSE_TEST_BOOTSTRAP_FAIL_MATCH: 'bin/router.js' } });
  check('a first install that is refused fails', r.status === 1, `exit ${r.status}\n${r.out}`);
  check('says there is nothing to fall back to', /nothing to fall back to/.test(r.out), r.out);
  check('does not claim a recovery it did not do', !/back in place and loaded again/.test(r.out), r.out);
  check('and still keeps the rejected plist', r.rejectedText !== null);
}

/* ------------------------------------------- 3. Linux: the systemd user unit */

console.log('\nthe systemd user unit');

const SYSTEMD = { BEADCAUSE_SERVICE_MANAGER: 'systemd' };

{
  const r = run('sd-load', { args: ['-n'], env: SYSTEMD });
  const idx = (pred) => r.systemctl.findIndex(pred);
  const probe = idx((l) => l === '--user show-environment');
  const reload = idx((l) => l === '--user daemon-reload');
  const enable = idx((l) => l === '--user enable beadcause.service');
  const restart = idx((l) => l === '--user restart beadcause.service');
  check('it installs and exits 0', r.status === 0, `exit ${r.status}\n${r.out}`);
  check('it asks for the user manager before anything else', probe === 0, r.systemctl.join('\n'));
  check('then reloads, enables and restarts, in that order', reload > probe && enable > reload && restart > enable, r.systemctl.join('\n'));
  check('the unit names bin/router.js in this checkout', r.unitText?.includes(`${ROOT}/bin/router.js`), String(r.unitText).slice(0, 300));
  check('and logs under ~/.local/state, not ~/Library', /StandardOutput=append:.*\/\.local\/state\/beadcause\/beadcause\.log/.test(r.unitText || ''), r.unitText);
  check('lingering is turned on, so it survives a reboot', r.loginctl.some((l) => l.startsWith('enable-linger')), r.loginctl.join('\n'));
  check('launchctl is never run', r.launchctl.length === 0, r.launchctl.join('\n'));
  check('no plist is written', r.plistText === null);
  check('what systemd loaded is read back from systemd', /systemd is running bin\/router\.js/.test(r.out), r.out);
  check('the restart hint is systemctl', /systemctl --user restart beadcause\.service/.test(r.out), r.out);
}

{
  const r = run('sd-linger-on', { args: ['-n'], env: { ...SYSTEMD, BEADCAUSE_TEST_LINGER: 'yes' } });
  check('lingering already on is left alone', !r.loginctl.some((l) => l.startsWith('enable-linger')) && /already on/.test(r.out), r.out);
}

{
  const r = run('sd-linger-fail', { args: ['-n'], env: { ...SYSTEMD, BEADCAUSE_TEST_LINGER_FAIL: '1' } });
  check('lingering refused only warns', r.status === 0, `exit ${r.status}\n${r.out}`);
  check('and names the one root command', /sudo loginctl enable-linger/.test(r.out), r.out);
}

{
  const r = run('sd-nomanager', { args: ['-n'], env: { ...SYSTEMD, BEADCAUSE_TEST_NO_USER_MANAGER: '1' }, previousUnit: '[Service]\nExecStart=/old\n' });
  check('no user manager is a failure', r.status === 1, `exit ${r.status}\n${r.out}`);
  check('and nothing was stopped, enabled or rewritten', r.systemctl.length === 1 && r.unitText === '[Service]\nExecStart=/old\n', `${r.systemctl.join('\n')}\n${r.unitText}`);
  check('it says a direct login is what is needed', /ssh works, su does not/.test(r.out), r.out);
}

{
  const old = '[Service]\nExecStart=/usr/bin/node /old/bin/router.js\n';
  const r = run('sd-rejected', { args: ['-n'], env: { ...SYSTEMD, BEADCAUSE_TEST_ENABLE_FAIL: '1' }, previousUnit: old });
  check('a refused unit is a failure', r.status === 1, `exit ${r.status}\n${r.out}`);
  check('the previous unit is back on disk', r.unitText === old, String(r.unitText));
  check('the rejected one is kept for comparison', r.unitRejectedText?.includes(`${ROOT}/bin/router.js`), String(r.unitRejectedText).slice(0, 200));
  check('and it is never restarted', !r.systemctl.includes('--user restart beadcause.service'), r.systemctl.join('\n'));
}

{
  const r = run('sd-monitor', { args: ['-n'], env: { ...SYSTEMD, BEADCAUSE_TEST_MONITOR: '1' } });
  check('the console-at-login agent is macOS-only, and says so', /macOS-only/.test(r.out) && r.launchctl.length === 0, r.out);
}

/* ------------------------------------------------- Linux without Homebrew (bc-obucr.4) */

console.log('apt');

// The four cases below that pose "tmux is not installed" pass hideTmux, so a host tmux
// (every Linux CI runner) is off their PATH instead of making them skip.

{
  const r = run('apt-fresh', { args: ['-n'], env: { ...SYSTEMD, BEADCAUSE_TEST_NODE_CANDIDATE: '22' }, shims: { ...APT, gh: null }, hideTmux: true });
  check('apt installs what is missing', r.apt.includes('install -y gh'), r.apt.join('\n'));
  check('tmux is required in place of iTerm2', r.apt.includes('install -y tmux') && !/iTerm/.test(r.out) && r.brew.length === 0, `${r.apt.join('\n')}\n${r.out}`);
  check('through sudo -n, not a prompt', r.sudo.some((l) => l.startsWith('-n ')), r.sudo.join('\n'));
  check('and the run finishes', r.status === 0, `exit ${r.status}\n${r.out}`);
}

{
  const r = run('apt-present', { args: ['-n'], env: SYSTEMD, shims: { ...APT, gh: NOOP_SHIM, jq: NOOP_SHIM, tmux: NOOP_SHIM, git: NOOP_SHIM, curl: CURL_SHIM, expect: NOOP_SHIM } });
  check('nothing already there is installed', r.apt.length === 0, r.apt.join('\n'));
}

{
  const r = run('apt-nosudo', { args: ['-n'], env: { ...SYSTEMD, BEADCAUSE_TEST_NO_SUDO: '1' }, shims: { ...APT, tmux: null }, hideTmux: true });
  check('without passwordless sudo it warns and goes on', r.status === 0 && r.apt.length === 0, `exit ${r.status}\n${r.out}`);
  check('and names the command to run', /sudo apt-get install -y tmux/.test(r.out), r.out);
}

{
  const r = run('apt-fails', { args: ['-n'], env: { ...SYSTEMD, BEADCAUSE_TEST_APT_FAIL: '1' }, shims: { ...APT, tmux: null }, hideTmux: true });
  check('a failed apt-get is a warning, never fatal', r.status === 0 && /apt-get install -y tmux failed/.test(r.out), `exit ${r.status}\n${r.out}`);
}

{
  const r = run('apt-off', { args: ['-n', '--no-deps'], env: SYSTEMD, shims: { ...APT, tmux: null, gh: null }, hideTmux: true });
  check('--no-deps never runs apt', r.apt.length === 0 && r.sudo.length === 0, r.apt.join('\n'));
  check('but still names what is missing', /tmux not found/.test(r.out), r.out);
}

{
  const r = run('apt-node-old', { args: ['-n'], env: { ...SYSTEMD, BEADCAUSE_TEST_NODE_CANDIDATE: '18' }, shims: { ...APT, node: null } });
  check('a node apt cannot supply at 20+ is fatal', r.status === 1 && !r.apt.includes('install -y nodejs npm'), `exit ${r.status}\n${r.apt.join('\n')}`);
  check('and it names NodeSource', /NodeSource/.test(r.out), r.out);
}

{
  const r = run('apt-node-new', { args: ['-n'], env: { ...SYSTEMD, BEADCAUSE_TEST_NODE_CANDIDATE: '22' }, shims: { ...APT, node: null } });
  check('a node apt can supply at 20+ is installed', r.apt.includes('install -y nodejs npm'), r.apt.join('\n'));
}

{
  // bd comes from the release tarball: fixtures stand in for GitHub.
  const fx = path.join(tmp, 'bd-fixtures');
  fs.mkdirSync(fx, { recursive: true });
  fs.writeFileSync(path.join(fx, 'bd'), '#!/bin/bash\necho "bd version 9.9.9"\n');
  fs.chmodSync(path.join(fx, 'bd'), 0o755);
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const asset = `beads_9.9.9_linux_${arch}.tar.gz`;
  spawnSync('tar', ['-czf', path.join(fx, asset), '-C', fx, 'bd']);
  const sum = createHash('sha256').update(fs.readFileSync(path.join(fx, asset))).digest('hex');
  fs.writeFileSync(path.join(fx, 'checksums.txt'), `${sum}  ${asset}\n`);
  const curl = `#!/bin/bash
printf '%s\\n' "$*" >> "$BEADCAUSE_TEST_LOGDIR/curl.log"
out=""; prev=""
for a in "$@"; do [ "$prev" = -o ] && out="$a"; prev="$a"; url="$a"; done
if [ -n "$out" ]; then cp "$BEADCAUSE_TEST_FIXTURES/$(basename "$url")" "$out" 2>/dev/null || exit 22; exit 0; fi
case "$url" in *releases/latest) echo '{"tag_name": "v9.9.9"}' ;; *) echo '{"ok":true,"workspaces":["beadcause"]}' ;; esac
`;
  const uname = '#!/bin/bash\n[ "$1" = -m ] && echo "$BEADCAUSE_TEST_ARCH" || exec /usr/bin/uname "$@"\n';
  const env = { ...SYSTEMD, BEADCAUSE_TEST_FIXTURES: fx, BEADCAUSE_TEST_ARCH: arch === 'arm64' ? 'aarch64' : 'x86_64' };
  const r = run('apt-bd', { args: ['-n'], env, shims: { ...APT, bd: null, curl, uname } });
  check('bd is downloaded from the release, not through a piped script', r.curl.some((l) => l.includes(`/v9.9.9/${asset}`)), r.curl.join('\n'));
  check('and installed under ~/.local/bin', fs.existsSync(path.join(r.home, '.local', 'bin', 'bd')), r.out);
  check('the run finishes with it', r.status === 0, `exit ${r.status}\n${r.out}`);

  fs.writeFileSync(path.join(fx, 'checksums.txt'), `${'0'.repeat(64)}  ${asset}\n`);
  const bad = run('apt-bd-badsum', { args: ['-n'], env, shims: { ...APT, bd: null, curl, uname } });
  check('a checksum that does not match installs nothing', bad.status === 1 && !fs.existsSync(path.join(bad.home, '.local', 'bin', 'bd')) && /checksum/.test(bad.out), `exit ${bad.status}\n${bad.out}`);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
