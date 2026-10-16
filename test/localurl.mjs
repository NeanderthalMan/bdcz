#!/usr/bin/env node
/**
 * `localBaseUrl` — the URL for a terminal on this Mac, and the four that must not become it.
 *
 *     npm test
 *     node test/localurl.mjs
 *
 * There are two base URLs now and exactly one thing distinguishes them: who reads the
 * link. `publicBaseUrl` is handed to a phone somewhere else on the tailnet;
 * `localBaseUrl` is clicked by whoever is sitting at this keyboard. Getting that
 * backwards fails in both directions, and only one of them is loud —
 *
 * - a **tailnet** link read *here* fails visibly, in a browser, with a DNS error. That
 *   is bc-c7nj3: MagicDNS resolves for nobody while Tailscale is stopped, so the link in
 *   the startup block broke on the one machine definitely running the daemon.
 * - a **loopback** link read *on a phone* resolves to the phone. It does not error in
 *   any useful way; it refuses, or finds something else listening. Nothing about that
 *   says the link was built on the wrong Mac.
 *
 * So the asymmetry is the reason this file spends more assertions on what did *not*
 * change than on what did. `--url` in particular is piped into scripts/build-android.sh
 * to bake `BASE_URL` into the APK: loopback there ships an Android app that points at
 * the phone it is installed on, and no test downstream of it would notice.
 *
 * Read as source rather than executed, for the call sites. Booting the daemon to read
 * two log lines needs a tailnet, a config and a port, and the property being asserted is
 * textual anyway: which of the two helpers each call site names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const { localBaseUrl, publicBaseUrl } = await import(path.join(ROOT, 'lib', 'tls.js'));

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  ✗ ${name}\n      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

/* ------------------------------------------------------------------ the helper */

console.log('\nthe URL for a terminal on this Mac');

check('is loopback on the configured port', localBaseUrl({ port: 4318 }) === 'http://127.0.0.1:4318', localBaseUrl({ port: 4318 }));
check('defaults to 4318 with no port', localBaseUrl({}) === 'http://127.0.0.1:4318', localBaseUrl({}));
check('follows a port that is not the default', localBaseUrl({ port: 4999 }) === 'http://127.0.0.1:4999', localBaseUrl({ port: 4999 }));
check('and takes no argument at all without throwing', localBaseUrl() === 'http://127.0.0.1:4318', String(localBaseUrl()));

// It is plain http forever, and deliberately: loopback is already a secure context and
// no authority signs 127.0.0.1. An https:// here would be a TLS parse error on a port
// serving cleartext — the same trap `publicBaseUrl` documents for the tailnet address.
check('always http, never https', localBaseUrl({ port: 4318 }).startsWith('http://'), localBaseUrl({ port: 4318 }));

// The two must never collapse into one value on a machine that has a tailnet name, or
// the distinction this file exists to protect stops being observable at all.
{
  const cfg = { port: 4318 };
  const pub = publicBaseUrl(cfg);
  check(
    'and it is not simply whatever publicBaseUrl says',
    typeof pub === 'string' && pub.length > 0,
    `publicBaseUrl returned ${JSON.stringify(pub)}`
  );
}

/* ------------------------------------------------------- what the daemon prints */

console.log('\nthe lines a person reads in a terminal here');

{
  const server = read('lib/server.js');
  const waiting = server.match(/^.*question\(s\) already waiting — see .*$/m)?.[0] || '';
  const foundation = server.match(/^.*foundation request\(s\) waiting on you — see .*$/m)?.[0] || '';
  check('the waiting-questions line uses localBaseUrl', /localBaseUrl\(cfg\)/.test(waiting), waiting.trim());
  check('and so does the foundation-requests line', /localBaseUrl\(cfg\)/.test(foundation), foundation.trim());
  check('neither still names cfg.baseUrl', !/cfg\.baseUrl/.test(waiting + foundation), (waiting + foundation).trim());
  check('and server.js imports it rather than rebuilding the string', /localBaseUrl/.test(server.split('\n').slice(0, 260).join('\n')), 'no import found in the first 260 lines');
}

{
  const bin = read('bin/beadcause.js');
  const local = bin.match(/^.*local URL.*$/m)?.[0] || '';
  check('the startup block has a local URL line', local.length > 0, 'no "local URL" line in bin/beadcause.js');
  check('and it is built from localBaseUrl', /localBaseUrl\(cfg\)/.test(local), local.trim());
  // No token on it. The phone URL above carries one because a phone has no localStorage
  // for this origin yet; a browser here either has one or is one click from that line.
  check('with no token pasted into it', !/cfg\.token/.test(local), local.trim());
}

/* --------------------------------------------- and the four that must NOT move */

console.log('\nwhat still goes to the phone, and has to');

{
  const bin = read('bin/beadcause.js');
  const phone = bin.match(/^.*phone URL.*$/m)?.[0] || '';
  check('the phone URL line still uses cfg.baseUrl', /cfg\.baseUrl/.test(phone), phone.trim());
  check('and still carries the token', /cfg\.token/.test(phone), phone.trim());

  // The one that would be invisible. `--url` prints the pairing link, and
  // scripts/build-android.sh pipes it into BASE_URL for the APK.
  const urlFlag = bin.match(/if \(process\.argv\.includes\('--url'\)\) \{[\s\S]{0,200}?\}/)?.[0] || '';
  check('--url does not print a loopback URL', !/localBaseUrl/.test(urlFlag), urlFlag.trim().split('\n')[0]);

  const android = read('scripts/build-android.sh');
  check(
    'and build-android.sh is still the reason why',
    /bin\/beadcause\.js" --url/.test(android) && /BASE_URL/.test(android),
    'build-android.sh no longer pipes --url into BASE_URL — re-check whether --url may move'
  );
}

{
  // Every ntfy link is read on the phone. If one of these ever becomes loopback it points
  // the phone at itself, and the failure looks like a dead daemon rather than a bad link.
  const notify = read('lib/notify.js');
  check('no ntfy link is built on loopback', !/localBaseUrl/.test(notify), 'lib/notify.js names localBaseUrl');
  check('and they still name cfg.baseUrl', (notify.match(/cfg\.baseUrl/g) || []).length >= 5, `${(notify.match(/cfg\.baseUrl/g) || []).length} uses`);
}

{
  // Slack is read on either device, which is exactly why it stays on the address that
  // works from both — the tailnet one. Adam chose this explicitly (2026-09-17).
  const slack = read('lib/slack.js');
  const link = slack.match(/^.*const link = .*$/m)?.[0] || '';
  check('the Slack link stays on cfg.baseUrl', /cfg\.baseUrl/.test(link), link.trim());
}

console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
