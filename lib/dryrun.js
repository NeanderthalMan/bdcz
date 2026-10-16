/**
 * Run a sweep against the live checkout and tracker with every write recorded instead of
 * performed (bc-dgx7.168 — bin/b7e-dryrun).
 *
 * Four sessions (bc-iaju1.12, .8, .4, .11) each wanted "what will this do to the real
 * tracker tonight?" before delivering a daemon sweep, none could ask, and all four wrote a
 * throwaway that no two of them shared. This is the recording layer those throwaways were
 * each a private copy of, kept here so a test can import the same wrapper instead of a
 * thirty-first `fakeBd`.
 *
 * TWO LAYERS, because a sweep can write through more than `bd`:
 *
 *   1. `dryBd` — the tracker. Every `bd` this repo spawns goes through `Bd.run` (lib/bd.js
 *      says so in its own header), so the whole tracker guarantee is ONE method overridden
 *      on an object that inherits the real Bd: a write verb is recorded and answered with an
 *      empty success, a read goes to the live tracker. Nothing here names `close` or
 *      `comment` — a `Bd` method added next month reaches `run` too and is caught with no
 *      edit here. It is answered with success rather than refused with an error on purpose:
 *      a sweep that stopped at its first `close` would report one write where tonight's run
 *      makes forty.
 *
 *   2. `installGuards` — everything else. A sweep that runs `git worktree remove`, `gh pr
 *      merge`, writes a state file under the config dir, POSTs to ntfy or kills a process is
 *      writing through something other than bd, and a dry run that only wrapped `Bd` would
 *      say "0 writes" over it. Those are recorded and REFUSED WITH A THROWN ERROR, and the
 *      run says outright that they were refused rather than captured — success cannot be
 *      faked for a `git` the way it can for a `bd`, and the honest report is "the sweep saw
 *      an error here that tonight's run would not".
 *
 * A command that cannot be shown to be a read is treated as a write. That is the whole
 * safety argument: the table below is an allowlist of READS, so a verb nobody thought of is
 * refused, never run. The cost is a false refusal on a read the table lacks, which is why
 * `--allow <binary>` exists and why a refusal is printed loudly.
 *
 * This module imports only node built-ins, deliberately: bin/b7e-dryrun installs the guards
 * BEFORE it imports anything else, so that every later module sees the patched functions,
 * including a `import { execFile } from 'node:child_process'` captured at load time.
 */
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

/* ---------------------------------------------------------------------- the recorder */

/**
 * What a run intended to do. `captured` is the distinction that matters: a bd write the
 * sweep was told succeeded (so it carried on as it would have) versus a write through
 * something else that the sweep was given an error for.
 */
export function createRecorder() {
  const writes = [];
  return {
    writes,
    write(entry) {
      writes.push({ captured: false, ...entry });
    },
    /** Counts by verb, and how many were refused rather than captured. */
    tally() {
      const byVerb = {};
      let outside = 0;
      for (const w of writes) {
        const key = w.kind === 'bd' ? w.verb : `${w.kind} ${w.verb}`.trim();
        byVerb[key] = (byVerb[key] || 0) + 1;
        if (!w.captured) outside += 1;
      }
      return { total: writes.length, byVerb, outside };
    },
  };
}

/** `WOULD close bc-2g8s --reason "…"` — one line per intended write, in order. */
export function renderWrite(w) {
  return w.captured ? `WOULD ${w.text}` : `REFUSED ${w.text}   (not a bd write: not performed, and the sweep was handed an error)`;
}

const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : JSON.stringify(s));

/* ------------------------------------------------------------------------ bd, by argv */

// The verbs that only read. The default for a verb not named here is WRITE — see the header.
// Sourced from every argv lib/bd.js builds plus bd's own read commands; test/dryrun.mjs
// pins that each argv shape Bd emits classifies the way its method does.
const BD_READ_VERBS = new Set([
  'show', 'list', 'ready', 'search', 'status', 'stats', 'blocked', 'count', 'export', 'graph',
  'comments', 'children', 'query', 'stale', 'orphans', 'history', 'version', 'where', 'info',
  'find-duplicates', 'memories', 'diff',
]);
// verb → the sub-verbs that read; anything else under it writes.
const BD_READ_SUBVERBS = {
  dep: new Set(['list', 'tree', 'cycles']),
  label: new Set(['list', 'list-all']),
  human: new Set(['list']),
  dolt: new Set(['show', 'status', 'remote list']),
  config: new Set(['get', 'list']),
  epic: new Set(['status']),
};

/** Drop the flags `Bd.run` adds to every call, so the line reads as the intent. */
function bdSignificant(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--actor') {
      i += 1;
      continue;
    }
    if (argv[i] === '--json') continue;
    out.push(String(argv[i]));
  }
  return out;
}

/** Whether a `bd` argv reads, and how to say it. Unknown → a write. */
export function classifyBd(argv) {
  const args = bdSignificant(argv || []);
  const verb = args[0] || '';
  const sub = args[1] || '';
  let read = BD_READ_VERBS.has(verb);
  if (!read && BD_READ_SUBVERBS[verb]) {
    const two = `${sub} ${args[2] || ''}`.trim();
    read = BD_READ_SUBVERBS[verb].has(sub) || BD_READ_SUBVERBS[verb].has(two);
  }
  // `bd comments add` is the one read verb with a write under it.
  if (verb === 'comments' && sub === 'add') read = false;
  // `graph --html` prints a page; it is still a read of the tracker.
  return { tool: 'bd', write: !read, verb: verb === 'dep' || verb === 'label' || verb === 'dolt' ? `${verb} ${sub}`.trim() : verb, text: args.map(quote).join(' ') };
}

/** What a stubbed bd write answers with. Only `create` is parsed by anything downstream. */
let created = 0;
function stubAnswer(argv) {
  const args = bdSignificant(argv);
  if (args[0] === 'create') {
    created += 1;
    return JSON.stringify({ id: `dryrun-${created}` });
  }
  return '';
}

/**
 * A `Bd` whose reads are the real thing and whose writes are recorded.
 *
 * `Object.create(bd)` and not a wrapper object, so `this` inside every inherited method is
 * the dry one: `respond` calls `this.answerOnce` and `this.closeAnswered`, and a wrapper
 * whose methods were bound to the real Bd would let them straight through.
 *
 * `assertClosed` is overridden because it is the one method whose whole job is to check
 * that a write happened — against a tracker that was never written it would throw "the
 * close did not happen" after every recorded close and turn the whole run into errors.
 */
export function dryBd(bd, rec) {
  const dry = Object.create(bd);
  dry.run = function run(workspace, rawArgs, opts) {
    const c = classifyBd(rawArgs);
    if (!c.write) return bd.run.call(bd, workspace, rawArgs, opts);
    rec.write({ kind: 'bd', verb: c.verb, text: c.text, captured: true, workspace: workspace?.name || null });
    return Promise.resolve(stubAnswer(rawArgs));
  };
  dry.assertClosed = async function assertClosed() {};
  return dry;
}

/* ------------------------------------------------------------- other commands, by argv */

// Read-only tools. Deliberately short: everything else is refused unless named by --allow.
const READ_TOOLS = new Set([
  'ps', 'pgrep', 'lsof', 'uname', 'sw_vers', 'date', 'hostname', 'whoami', 'id', 'pwd', 'ls',
  'cat', 'head', 'tail', 'wc', 'stat', 'df', 'du', 'which', 'whereis', 'grep', 'egrep', 'fgrep',
  'sort', 'uniq', 'file', 'readlink', 'realpath', 'basename', 'dirname', 'uptime', 'vm_stat',
  'test', 'echo', 'printf',
]);

const GIT_READ = new Set([
  'status', 'log', 'rev-parse', 'diff', 'show', 'rev-list', 'merge-base', 'cat-file', 'ls-files',
  'ls-tree', 'for-each-ref', 'show-ref', 'describe', 'blame', 'grep', 'shortlog', 'name-rev',
  'diff-tree', 'diff-index', 'diff-files', 'count-objects', 'cherry', 'whatchanged', 'version',
  'check-ignore', 'var', 'ls-remote', 'merge-tree', 'range-diff', 'verify-commit', 'help',
]);

/** The first real verb of a `git` argv, past the global options that take a value. */
function gitVerbAt(args) {
  for (let i = 0; i < args.length; i += 1) {
    const a = String(args[i]);
    if (a === '-C' || a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '--namespace') {
      i += 1;
      continue;
    }
    if (a.startsWith('-')) continue;
    return i;
  }
  return -1;
}

function gitReads(args) {
  const at = gitVerbAt(args);
  if (at < 0) return { verb: '', read: true };
  const verb = String(args[at]);
  const rest = args.slice(at + 1).map(String);
  if (GIT_READ.has(verb)) return { verb, read: true };
  const flags = new Set(rest.filter((a) => a.startsWith('-')));
  const bare = rest.filter((a) => !a.startsWith('-'));
  const any = (...names) => names.some((n) => flags.has(n));
  switch (verb) {
    case 'branch':
      // `git branch` and `git branch --list/-a/-r/--merged/...` read; `-d`, `-m`, `<name>` write.
      return { verb, read: any('--list', '-l', '-a', '-r', '-v', '-vv', '--merged', '--no-merged', '--contains', '--no-contains', '--show-current', '--points-at') || (!rest.length) };
    case 'tag':
      return { verb, read: any('--list', '-l', '--contains', '--points-at', '--merged') || !rest.length };
    case 'worktree':
      return { verb, read: bare[0] === 'list' };
    case 'remote':
      return { verb, read: !bare.length || bare[0] === 'show' || bare[0] === 'get-url' };
    case 'config':
      return { verb, read: any('--get', '--get-all', '--get-regexp', '--list', '-l', '--get-urlmatch') };
    case 'stash':
      return { verb, read: bare[0] === 'list' || bare[0] === 'show' };
    case 'symbolic-ref':
      return { verb, read: bare.length <= 1 && !any('-d', '--delete') };
    case 'reflog':
      return { verb, read: !bare.length || bare[0] === 'show' };
    case 'submodule':
      return { verb, read: bare[0] === 'status' };
    default:
      return { verb, read: false };
  }
}

const GH_READ = {
  pr: new Set(['view', 'list', 'checks', 'status', 'diff']),
  issue: new Set(['view', 'list', 'status']),
  run: new Set(['list', 'view']),
  repo: new Set(['view', 'list']),
  auth: new Set(['status', 'token']),
  release: new Set(['view', 'list']),
  search: null, // every `gh search` reads
  workflow: new Set(['list', 'view']),
  label: new Set(['list']),
};

function ghReads(args) {
  const a = args.map(String);
  const group = a.find((x) => !x.startsWith('-')) || '';
  const at = a.indexOf(group);
  const verb = a.slice(at + 1).find((x) => !x.startsWith('-')) || '';
  if (group === 'api') {
    const method = a.findIndex((x) => x === '-X' || x === '--method');
    const verbOk = method < 0 || /^(GET|HEAD)$/i.test(a[method + 1] || '');
    // Any body field turns a `gh api` call into a POST.
    const body = a.some((x) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(x));
    return { verb: 'api', read: verbOk && !body };
  }
  if (group === 'search') return { verb: 'search', read: true };
  const readSet = GH_READ[group];
  return { verb: `${group} ${verb}`.trim(), read: Boolean(readSet && readSet.has(verb)) };
}

/**
 * Whether a subprocess is a read. `bd` is judged by its argv, `git` and `gh` by verb, a
 * short list of inspection tools always, and anything else is a write because nothing says
 * it is not. `shell` means the command line went through a shell, which cannot be read.
 */
export function classifyCommand(file, args = [], { shell = false } = {}) {
  const tool = path.basename(String(file || ''));
  const argv = (args || []).map(String);
  if (shell) {
    return { tool: 'sh', write: true, verb: '', text: [file, ...argv].map(String).join(' ') };
  }
  const text = [tool, ...argv].map(quote).join(' ');
  if (tool === 'bd') return classifyBd(argv);
  if (tool === 'git') {
    const g = gitReads(argv);
    return { tool, write: !g.read, verb: g.verb, text };
  }
  if (tool === 'gh') {
    const g = ghReads(argv);
    return { tool, write: !g.read, verb: g.verb, text };
  }
  const isFindWrite = tool === 'find' && argv.some((a) => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(a));
  const isSedWrite = tool === 'sed' && argv.some((a) => a === '-i' || a.startsWith('-i'));
  if (READ_TOOLS.has(tool) || (tool === 'find' && !isFindWrite) || (tool === 'sed' && !isSedWrite) || tool === 'awk') {
    return { tool, write: false, verb: tool, text };
  }
  return { tool, write: true, verb: tool, text };
}

/** A shell string with no metacharacter in it is one command, which can be classified. */
export function splitSimpleShell(command) {
  const s = String(command || '').trim();
  if (!s || /[;&|<>$`()\\\n"'*?{}]/.test(s)) return null;
  const parts = s.split(/\s+/);
  return { file: parts[0], args: parts.slice(1) };
}

/* ------------------------------------------------------------------------- the guards */

export class DryRunRefusal extends Error {
  constructor(text) {
    super(`b7e-dryrun refused ${text} — it is a write outside bd, so it was recorded and not performed`);
    this.code = 'EDRYRUN';
  }
}

const FS_WRITE = [
  'writeFile', 'appendFile', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile', 'cp', 'mkdir',
  'symlink', 'link', 'truncate', 'chmod', 'chown', 'lchown', 'lchmod', 'utimes', 'lutimes',
  'createWriteStream', 'mkdtemp',
];
// Second path arguments to check as well (a rename out of the tmp dir is not a tmp write).
const FS_TWO_PATHS = new Set(['rename', 'copyFile', 'cp', 'symlink', 'link']);

const pathOf = (p) => {
  if (p == null) return null;
  if (p instanceof URL) return p.protocol === 'file:' ? decodeURIComponent(p.pathname) : null;
  if (Buffer.isBuffer(p)) return p.toString();
  return typeof p === 'string' ? p : null;
};

/**
 * Patch every write door a sweep can reach that is not `bd`, and return the function that
 * puts them all back. Idempotent per call: `uninstall()` restores exactly what this call
 * replaced, so a suite can install, drive something and leave the process as it found it.
 *
 * `allow` names binaries that run unguarded — the escape hatch for a read the table lacks.
 * Paths under the OS tmp dir are not refused for the filesystem guards: a suite's scratch
 * space is not the tracker, and a dry run pointed at `BEADCAUSE_CONFIG_DIR=/tmp/…` is how a
 * sweep's state file is exercised without refusing it.
 */
export function installGuards(rec, { allow = [], tmp = [os.tmpdir()], armed: startArmed = true } = {}) {
  let armed = startArmed;
  const restores = [];
  const patch = (obj, key, value) => {
    const original = obj[key];
    obj[key] = value;
    restores.push(() => {
      obj[key] = original;
    });
    return original;
  };
  const realTmp = tmp.flatMap((t) => {
    try {
      return [path.resolve(t), fs.realpathSync(t)];
    } catch {
      return [path.resolve(t)];
    }
  });
  const inTmp = (p) => {
    const s = pathOf(p);
    if (s == null) return false;
    const abs = path.resolve(s);
    return realTmp.some((t) => abs === t || abs.startsWith(t + path.sep));
  };
  const allowed = new Set(allow);

  const refuse = (kind, verb, text) => {
    rec.write({ kind, verb, text, captured: false });
    throw new DryRunRefusal(text);
  };
  // For a door that hands back a promise: `fs.promises.rm(x).catch(() => {})` must find the
  // refusal on the promise, where a synchronous throw would have escaped the `.catch`.
  const refuseAsync = (kind, verb, text) => {
    try {
      refuse(kind, verb, text);
    } catch (err) {
      return Promise.reject(err);
    }
  };

  /* --------------------------------------------------------------- child_process */

  const judge = (file, args, opts, viaShell, refuseWith = refuse) => {
    if (!armed) return undefined;
    let f = file;
    let a = args;
    let shell = Boolean(opts && opts.shell) || viaShell;
    if (viaShell) {
      const one = splitSimpleShell(file);
      if (one) {
        f = one.file;
        a = one.args;
        shell = false;
      }
    }
    if (allowed.has(path.basename(String(f)))) return;
    const c = classifyCommand(f, a, { shell });
    if (c.write) return refuseWith(c.tool === 'sh' ? 'exec' : c.tool, c.verb, c.text);
    return undefined;
  };
  const splitArgs = (args) => {
    const arr = Array.isArray(args[1]) ? args[1] : [];
    const opts = args[Array.isArray(args[1]) ? 2 : 1];
    return { arr, opts: opts && typeof opts === 'object' ? opts : {} };
  };
  for (const name of ['execFile', 'execFileSync', 'spawn', 'spawnSync']) {
    const orig = cp[name];
    const wrapped = function (...args) {
      const { arr, opts } = splitArgs(args);
      judge(args[0], arr, opts, false);
      return orig.apply(this, args);
    };
    const custom = orig[promisify.custom];
    if (custom) {
      wrapped[promisify.custom] = function (...args) {
        const { arr, opts } = splitArgs(args);
        const refused = judge(args[0], arr, opts, false, refuseAsync);
        return refused || custom.apply(this, args);
      };
    }
    patch(cp, name, wrapped);
  }
  for (const name of ['exec', 'execSync']) {
    const orig = cp[name];
    const wrapped = function (...args) {
      judge(args[0], [], typeof args[1] === 'object' ? args[1] : {}, true);
      return orig.apply(this, args);
    };
    const custom = orig[promisify.custom];
    if (custom) {
      wrapped[promisify.custom] = function (...args) {
        const refused = judge(args[0], [], typeof args[1] === 'object' ? args[1] : {}, true, refuseAsync);
        return refused || custom.apply(this, args);
      };
    }
    patch(cp, name, wrapped);
  }
  // A fork runs another program of this repo's, whose writes nothing here can see.
  const realFork = cp.fork;
  patch(cp, 'fork', function (...args) {
    if (!armed) return realFork.apply(this, args);
    return refuse('exec', 'fork', `node ${quote(String(args[0]))}`);
  });

  /* -------------------------------------------------------------------------- fs */

  const fsHolders = [
    [fs, ''],
    [fs, 'Sync'],
    [fs.promises, ''],
  ];
  const guardFs = (name, orig, refuseWith) =>
    function (...args) {
      if (!armed) return orig.apply(this, args);
      const targets = [pathOf(args[0])];
      if (FS_TWO_PATHS.has(name)) targets.push(pathOf(args[1]));
      const inside = targets.filter((t) => t != null).every((t) => inTmp(t));
      if (!inside) return refuseWith('fs', name, `${name} ${quote(targets.filter(Boolean).join(' → ') || '?')}`);
      return orig.apply(this, args);
    };
  for (const name of FS_WRITE) {
    for (const [holder, suffix] of fsHolders) {
      const key = `${name}${suffix}`;
      if (typeof holder[key] === 'function') patch(holder, key, guardFs(name, holder[key], holder === fs.promises ? refuseAsync : refuse));
    }
  }
  // `open` writes when its flags say so — a lock file is `wx`.
  const readsFlag = (flags) => flags == null || flags === 'r' || flags === 'rs' || flags === 'sr' || flags === fs.constants.O_RDONLY;
  const guardOpen = (orig, refuseWith) =>
    function (...args) {
      const flags = typeof args[1] === 'function' ? undefined : args[1];
      if (armed && !readsFlag(flags) && !inTmp(args[0])) {
        return refuseWith('fs', 'open', `open ${quote(pathOf(args[0]) || '?')} (flags ${String(flags)})`);
      }
      return orig.apply(this, args);
    };
  for (const [holder, suffix] of fsHolders) {
    const key = `open${suffix}`;
    if (typeof holder[key] === 'function') patch(holder, key, guardOpen(holder[key], holder === fs.promises ? refuseAsync : refuse));
  }

  /* ------------------------------------------------------- network and processes */

  if (typeof globalThis.fetch === 'function') {
    const realFetch = globalThis.fetch;
    patch(globalThis, 'fetch', function (input, init = {}) {
      const method = String(init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      if (armed && method !== 'GET' && method !== 'HEAD') {
        const url = typeof input === 'string' ? input : input?.url || String(input);
        return refuseAsync('fetch', method, `${method} ${url}`);
      }
      return realFetch.call(this, input, init);
    });
  }
  const realKill = process.kill;
  patch(process, 'kill', function (pid, signal) {
    // Signal 0 is the liveness probe every "is that window still there" check uses. A bare
    // `kill(pid)` is SIGTERM, not a probe.
    if (!armed || signal === 0) return realKill.call(process, pid, signal);
    return refuse('process', 'kill', `kill -${String(signal)} ${pid}`);
  });

  // ESM named imports of a built-in are live bindings only once synced.
  syncBuiltinESMExports();
  const uninstall = function uninstall() {
    while (restores.length) restores.pop()();
    syncBuiltinESMExports();
  };
  // Installed disarmed, armed once the tool's own setup (loadConfig makes the config dir) is
  // done and only the sweep is left to run. Everything is imported UNDER the patch either way,
  // which is the point: a module loaded before it would keep the real execFile.
  uninstall.arm = () => {
    armed = true;
  };
  uninstall.disarm = () => {
    armed = false;
  };
  return uninstall;
}

/* ------------------------------------------------------------- calling the export */

// Parameter names a sweep's leading arguments are recognised by. Only a contiguous run at
// the front is filled, so `sweep(bd, ws, opts)` gets two and `sweepWorktrees(dir, opts)`
// gets one, and everything after that comes from `--args`, in order.
const INJECT = {
  bd: 'bd',
  ws: 'ws',
  workspace: 'ws',
  dir: 'dir',
  repo: 'dir',
  cwd: 'dir',
  checkout: 'dir',
  root: 'dir',
  cfg: 'cfg',
  config: 'cfg',
};

/**
 * The leading parameter names of a function that this tool can fill, read off its source.
 * A destructured or defaulted parameter ends the run: `reconcileLanded(bd, ws, dir, {…})`
 * yields `['bd', 'ws', 'dir']`.
 */
export function injectableParams(fn) {
  const src = Function.prototype.toString.call(fn);
  const open = src.indexOf('(');
  if (open < 0 || /^\s*(async\s*)?[\w$]+\s*=>/.test(src)) return [];
  const names = [];
  let i = open + 1;
  const skip = () => {
    for (;;) {
      while (/\s/.test(src[i] || '')) i += 1;
      if (src.startsWith('//', i)) i = src.indexOf('\n', i) < 0 ? src.length : src.indexOf('\n', i);
      else if (src.startsWith('/*', i)) i = src.indexOf('*/', i) < 0 ? src.length : src.indexOf('*/', i) + 2;
      else return;
    }
  };
  for (;;) {
    skip();
    const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (!m) break;
    i += m[0].length;
    skip();
    if (src[i] !== ',' && src[i] !== ')') break; // a default (`x = 1`) — not ours
    if (!INJECT[m[0]]) break;
    names.push(INJECT[m[0]]);
    if (src[i] === ')') break;
    i += 1;
  }
  return names;
}

/** Fill the leading parameters by name, then append what `--args` supplied. */
export function buildCall(fn, { bd, ws, dir, cfg, args = [] }) {
  const have = { bd, ws, dir, cfg };
  const lead = injectableParams(fn);
  const missing = lead.filter((k) => have[k] === undefined || have[k] === null);
  return { args: [...lead.map((k) => have[k]), ...args], lead, missing };
}

/** A return value as text: strings verbatim, anything else inspected. */
export function serialise(value) {
  try {
    return JSON.stringify(value, (k, v) => {
      if (typeof v === 'bigint') return String(v);
      if (v instanceof Error) return { error: v.message };
      if (v instanceof Map) return Object.fromEntries(v);
      if (v instanceof Set) return [...v];
      return v;
    });
  } catch {
    return String(value);
  }
}
