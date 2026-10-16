/**
 * Stop the backends one suite's router spawned — and only those — bc-kafuh.
 *
 * A router killed outright (its own crash handler, a `SIGKILL` in cleanup) does not stop
 * its backends, so a suite that does that leaves one behind and tidies it up itself. Both
 * that did used to run `pkill -f <checkout>/bin/beadcause.js`, on the reasoning that the
 * absolute path "can only ever match a backend this suite started". It cannot tell suites
 * apart, though: the gate runs every suite from the *same* checkout in parallel, so the
 * path matches every backend test/routerdrain.mjs, test/outagepush.mjs and the rest have
 * open at that moment. The victim's router logs `active backend pid N exited (code 0)` —
 * code 0 is the backend's own SIGTERM shutdown — and replaces it, and a suite that was
 * holding a request open on it reads a 502 it never caused. That is the "race" bc-kafuh
 * was filed about: three failures in four full gates on a green main.
 *
 * What does tell them apart is the internal port. The router spawns every backend as
 * `node bin/beadcause.js --port <N> --standby` on a port of its own, and the backend
 * prints `internal :<N>` on its startup banner into the log this suite owns — backends
 * inherit the router's stdio — while the router logs `on :<N>` for each one it promotes.
 * So the ports named in *this* suite's router log are exactly this suite's backends.
 *
 * The one it can miss is a backend killed with its router before it printed anything. It
 * is in standby, so it polls nothing, and its orphan guard (bin/beadcause.js) exits it
 * inside a minute; that is the right price for never touching somebody else's.
 */
import { execFileSync } from 'node:child_process';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The internal ports a router log names, deduplicated. Exported for its own sake. */
export function backendPorts(logText) {
  const ports = new Set();
  for (const m of String(logText || '').matchAll(/(?:internal :| on :)(\d+)\b/g)) ports.add(m[1]);
  return [...ports];
}

/** `pkill` each backend `logText` names, matched by its own `--port` and nothing wider. */
export function stopOwnBackends(logText, backend) {
  for (const port of backendPorts(logText)) {
    try {
      execFileSync('pkill', ['-f', `${escape(backend)} --port ${port} --standby`], { stdio: 'ignore' });
    } catch {
      /* nothing to kill is the good case */
    }
  }
}
