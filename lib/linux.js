/**
 * lib/linux.js — the container recipe and the verdict-reading behind `bin/b7e-linux`
 * (bc-dgx7.203).
 *
 * Four sessions each wanted to know whether a suite passes on Linux, and each built the
 * answer differently: a hand-made node:22-bookworm container with a different package
 * list and ~30 `docker exec` calls, a second inline recipe, a dispatched `test.yml` run
 * nobody waited out, a `gh run view` read of a refused hosted job. This is the one recipe.
 *
 * Everything that touches the outside world (`docker`, `gh`) goes through an injected
 * `run(cmd, args, opts)` so test/b7elinux.mjs can drive it without a daemon.
 */
import path from 'node:path';

export const DEFAULT_IMAGE = 'node:22-bookworm';

/**
 * What the suites shell out to, kept equal to the `Install what the suites shell out to`
 * step of the test-linux job in .github/workflows/test.yml (jq included; bookworm ships
 * jq 1.6 where ubuntu-latest ships 1.7, which the final line reports).
 */
export const PACKAGES = ['tmux', 'zsh', 'expect', 'lsof', 'jq', 'git', 'curl', 'ca-certificates'];

/** Suites that drive headless Chrome — left out of --all, as the CI Linux job does. */
export const ALL_EXCLUDE = ['test/browse.mjs'];

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (s) => String(s ?? '').replace(ANSI, '');

export function parseArgs(argv) {
  const o = { suites: [], all: false, keep: false, dir: process.cwd(), image: DEFAULT_IMAGE, tail: 40, timeout: 600, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => {
      const eq = a.indexOf('=');
      if (eq > -1) return a.slice(eq + 1);
      i += 1;
      return argv[i];
    };
    if (a === '--all') o.all = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--dir' || a.startsWith('--dir=')) o.dir = path.resolve(val() ?? '');
    else if (a === '--image' || a.startsWith('--image=')) o.image = val();
    else if (a === '--tail' || a.startsWith('--tail=')) o.tail = Number(val());
    else if (a === '--timeout' || a.startsWith('--timeout=')) o.timeout = Number(val());
    else if (a.startsWith('-')) return { error: `unknown flag ${a}` };
    else o.suites.push(a);
  }
  if (!Number.isFinite(o.tail) || o.tail < 1) return { error: '--tail wants a positive number of lines' };
  if (!Number.isFinite(o.timeout) || o.timeout < 1) return { error: '--timeout wants a positive number of seconds' };
  if (!o.help && !o.all && o.suites.length === 0) return { error: 'name suites (test/x.mjs ...) or pass --all' };
  if (o.all && o.suites.length) return { error: '--all and named suites are exclusive' };
  return o;
}

/** Is a docker runtime installed, and is its daemon answering? */
export function dockerState(run, docker) {
  const r = run(docker, ['info', '--format', '{{.ServerVersion}}'], { timeout: 20000 });
  if (r.error && r.error.code === 'ENOENT') {
    return { ok: false, reason: `no docker runtime: \`${docker}\` is not installed (looked for docker on PATH)` };
  }
  if (r.status !== 0) {
    const why = stripAnsi(r.stderr || r.stdout || '').trim().split('\n').pop() || `exit ${r.status}`;
    return { ok: false, reason: `the Docker daemon is not running (docker info: ${why})` };
  }
  return { ok: true, version: stripAnsi(r.stdout).trim() };
}

/**
 * Root-side setup, run once in a fresh container: packages, a writable /tmp, a copy of the
 * checkout without node_modules or .git, owned by `node`. Returns a script for `sh -c`.
 */
export function setupScript() {
  return [
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    'apt-get update -qq >/dev/null',
    `apt-get install -y -qq ${PACKAGES.join(' ')} >/dev/null`,
    'chmod 1777 /tmp',
    'mkdir -p /work',
    '(cd /src && tar --exclude=./node_modules --exclude=./.git --exclude=./.claude -cf - .) | tar -xf - -C /work',
    'chown -R node:node /work',
  ].join('\n');
}

/** As the non-root user: a git identity and snapshot (landedcheck reads history), then npm ci. */
export function prepareScript() {
  return [
    'set -e',
    'cd /work',
    'git config --global user.name "b7e-linux"',
    'git config --global user.email "b7e-linux@beadcause.invalid"',
    'git config --global init.defaultBranch main',
    'git init -q . && git add -A >/dev/null 2>&1 && git commit -qm snapshot >/dev/null 2>&1 || true',
    'mkdir -p "$HOME/beads/ci/.beads"',
    'npm ci --no-audit --no-fund --loglevel=error',
  ].join('\n');
}

/** `docker run` argv for the long-lived container; the checkout is mounted read-only. */
export function runArgs(name, image, dir) {
  return ['run', '-d', '--name', name, '-v', `${dir}:/src:ro`, image, 'sleep', 'infinity'];
}

/** `docker exec` argv for one suite, as the non-root user. */
export function execArgs(name, suite) {
  return ['exec', '-u', 'node', '-w', '/work', '-e', 'CI=true', '-e', 'HOME=/home/node', name, 'node', suite];
}

/** Read one suite's verdict out of its exit status and output. */
export function verdict(suite, r, tail = 40) {
  const out = stripAnsi(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  const lines = out.split('\n');
  const skips = lines.map((l) => l.trim()).filter((l) => /\bskipped:/.test(l));
  const timedOut = r.error && r.error.code === 'ETIMEDOUT';
  if (timedOut || r.status !== 0) {
    return {
      suite,
      status: 'fail',
      detail: timedOut ? 'timed out' : `exit ${r.status}`,
      tail: lines.filter((l) => l.trim() !== '').slice(-tail).join('\n'),
    };
  }
  const passes = lines.filter((l) => /✓/.test(l)).length;
  if (skips.length && passes === 0) return { suite, status: 'skipped', detail: skips[0].replace(/^.*?skipped:\s*/, '') };
  return { suite, status: 'pass', detail: skips.length ? `${skips.length} skipped: ${skips[0].replace(/^.*?skipped:\s*/, '')}` : '' };
}

/** The roster for --all: every test/*.mjs with a directory listing from the checkout. */
export function allSuites(listing) {
  return listing
    .filter((f) => /^test\/[^/]+\.mjs$/.test(f))
    .filter((f) => !ALL_EXCLUDE.includes(f))
    .sort();
}

/**
 * What GitHub last said about the hosted Linux job, for when Docker is not an option.
 * "refused, 0 steps" is a job billing turned away before a runner was allocated.
 */
export function hostedState(run) {
  const list = run('gh', ['run', 'list', '--workflow=test.yml', '--limit', '15', '--json', 'databaseId,status,conclusion,headBranch,createdAt'], { timeout: 30000 });
  if (list.status !== 0) return 'hosted test-linux: could not ask GitHub (gh run list failed)';
  let runs;
  try { runs = JSON.parse(list.stdout); } catch { return 'hosted test-linux: gh returned unreadable output'; }
  for (const r of runs) {
    const v = run('gh', ['run', 'view', String(r.databaseId), '--json', 'jobs'], { timeout: 30000 });
    if (v.status !== 0) continue;
    let jobs;
    try { jobs = JSON.parse(v.stdout).jobs ?? []; } catch { continue; }
    const job = jobs.find((j) => j.name === 'test-linux');
    if (!job) continue;
    const steps = (job.steps ?? []).length;
    const state = job.status !== 'completed'
      ? job.status
      : steps === 0 && job.conclusion !== 'success' ? 'refused, 0 steps' : job.conclusion;
    return `hosted test-linux: run ${r.databaseId} on ${r.headBranch} (${r.createdAt}) — ${state}`;
  }
  return 'hosted test-linux: no recent test.yml run has a test-linux job';
}
