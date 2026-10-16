#!/usr/bin/env node
/**
 * What a static file is allowed to skip sending, and what it is allowed to send smaller.
 *
 *     npm test
 *     node test/staticcache.mjs
 *
 * bc-iaju1.6 measured a cold open of this app at 2.24 MB across 36 files, and a *warm*
 * open at the same 2.24 MB — because `serveStatic` answered `cache-control: no-cache`
 * with no validator on it, so every revalidation a browser politely made was answered
 * with a full 200 and the file again. There was no `zlib` anywhere in lib/server.js
 * either, so none of it was compressed on the way out.
 *
 * The two things this holds, and each of them has a way of regressing silently:
 *
 * - **The 304 path.** A validator that is *present* but never matched is invisible — the
 *   app works perfectly and is exactly as slow as it was. So the cases here send back the
 *   tag the server just handed out and insist on a 304 with an empty body, rather than
 *   merely asserting the header exists.
 * - **The gzip path, and the entity it is a different entity from.** The compressed body
 *   carries its own ETag (`…-gz`) so that a cache in front of this daemon cannot hand a
 *   gzipped body to a client that never asked for one; `vary: accept-encoding` says the
 *   same thing to anything keying on headers. Both are checked, because both are exactly
 *   the sort of header that gets tidied away by somebody consolidating a `writeHead`.
 *
 * And the load-bearing negative: **`cache-control` must stay `no-cache`** on everything
 * that is not `/vendor/`. This daemon redeploys itself on every merge; a `max-age` on the
 * shell is a phone holding last week's app.js with no way to clear it remotely. The whole
 * bc-iaju1.6 change is "keep asking, make asking free", and a later branch reaching for
 * the cheaper `max-age` is the thing this case exists to stop.
 *
 * Static serving only, so no `bd`, no advocates and no poller: `createApp` is handed a
 * config with all of that off, the same way test/pagepaths.mjs does.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers/net.mjs';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (f) => path.join(HERE, '..', 'lib', f);
const PUBLIC = path.join(HERE, '..', 'public');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-staticcache-'));
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

let failures = 0;
let ran = 0;
const ok = (name) => {
  ran += 1;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
};
const bad = (name, detail) => {
  ran += 1;
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const is = (name, got, want) => (got === want ? ok(name) : bad(name, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`));

/* ------------------------------------------------------------- the pure half */

const sc = await import(LIB('staticcache.js'));

console.log('\nlib/staticcache.js');

is('text/* is compressible', sc.compressible('text/javascript; charset=utf-8'), true);
is('svg is compressible', sc.compressible('image/svg+xml'), true);
is('json is compressible', sc.compressible('application/json; charset=utf-8'), true);
// The whole reason the list is a list of prefixes and not "everything that is not an
// image": a png gzips *larger*, and finding that out costs a compression pass.
is('png is not', sc.compressible('image/png'), false);
is('wav is not', sc.compressible('audio/wav'), false);
is('an unknown type is not', sc.compressible('application/octet-stream'), false);

const accepts = (h) => sc.acceptsGzip({ headers: { 'accept-encoding': h } });
is('gzip offered', accepts('gzip, deflate, br'), true);
is('nothing offered', accepts(''), false);
is('no header at all', sc.acceptsGzip({ headers: {} }), false);
// The one refusal the grammar has, and the one this must not read as an offer.
is('gzip;q=0 is a refusal', accepts('gzip;q=0'), false);
is('gzip; q=0.0 is a refusal', accepts('br, gzip; q=0.0'), false);
is('gzip;q=0.5 is not', accepts('gzip;q=0.5'), true);

const stat = { size: 4096, mtimeMs: 1_700_000_000_123 };
is('the tag is size-and-mtime', sc.etagFor(stat), '"1000-18bcfe5687b"');
is('the gzipped body is a different entity', sc.etagFor(stat, 'gz'), '"1000-18bcfe5687b-gz"');
if (sc.etagFor(stat) !== sc.etagFor({ size: 4097, mtimeMs: 1_700_000_000_123 })) ok('a byte more is a different tag');
else bad('a byte more is a different tag');
if (sc.etagFor(stat) !== sc.etagFor({ size: 4096, mtimeMs: 1_700_000_000_124 })) ok('a millisecond later is a different tag');
else bad('a millisecond later is a different tag');

const tag = sc.etagFor(stat);
const lm = sc.lastModifiedOf(stat);
is('the same tag is not modified', sc.notModified({ headers: { 'if-none-match': tag } }, tag, lm), true);
is('a different tag is', sc.notModified({ headers: { 'if-none-match': '"nope"' } }, tag, lm), false);
is('* matches anything that exists', sc.notModified({ headers: { 'if-none-match': '*' } }, tag, lm), true);
is('one of several matches', sc.notModified({ headers: { 'if-none-match': `"a", ${tag}, "b"` } }, tag, lm), true);
// A proxy may weaken a tag on the way past; `if-none-match` is defined to compare weakly.
is('a weakened tag still matches', sc.notModified({ headers: { 'if-none-match': `W/${tag}` } }, tag, lm), true);
is('if-modified-since alone answers', sc.notModified({ headers: { 'if-modified-since': lm } }, tag, lm), true);
// And only alone: a tag that disagrees wins over a date that agrees, because the tag is
// the better question and the client sent both on purpose.
is(
  'a tag that disagrees beats a date that agrees',
  sc.notModified({ headers: { 'if-none-match': '"nope"', 'if-modified-since': lm } }, tag, lm),
  false
);
is('nothing asked, nothing skipped', sc.notModified({ headers: {} }, tag, lm), false);

is('shouldGzip on a script', sc.shouldGzip({ headers: { 'accept-encoding': 'gzip' } }, 'text/javascript', { size: 5000 }), true);
// Under a kilobyte a gzip member's own header and trailer can make the answer bigger,
// and nothing arrives sooner for being 300 bytes rather than 600.
is('not a tiny one', sc.shouldGzip({ headers: { 'accept-encoding': 'gzip' } }, 'text/javascript', { size: 200 }), false);
is('not a png', sc.shouldGzip({ headers: { 'accept-encoding': 'gzip' } }, 'image/png', { size: 50000 }), false);
is('not without the header', sc.shouldGzip({ headers: {} }, 'text/javascript', { size: 5000 }), false);

/* Compressed once and kept, keyed by path *and* tag — so a deploy that rewrites a file
   misses the buffer by virtue of the tag having moved, with nothing having to invalidate
   anything. The count is the only way to see that from outside. */
sc.forget();
const read = () => Promise.resolve(Buffer.from('x'.repeat(4096)));
await sc.gzipped('/tmp/thing.js', '"a"', read);
await sc.gzipped('/tmp/thing.js', '"a"', read);
is('one body held for two asks of the same tag', sc.heldCount(), 1);
await sc.gzipped('/tmp/thing.js', '"b"', read);
is('a moved tag is a second entry', sc.heldCount(), 2);
sc.forget();
is('and forget empties it', sc.heldCount(), 0);

/* ------------------------------------------------------------------- the app */

const ws = path.join(tmp, 'ws');
fs.mkdirSync(path.join(ws, '.beads'), { recursive: true });

const cfg = {
  port: 0,
  host: '127.0.0.1',
  baseUrl: 'http://127.0.0.1',
  token: 'staticcache-token',
  actor: 'beadcause-test',
  workspaces: [{ name: 'demo', dir: ws }],
  openSessions: false,
  autoDispatch: false,
  claudeSessions: false,
  pollSeconds: 3600,
  terminal: false,
  ntfy: { enabled: false },
  advocates: { enabled: false, workspaces: [] },
};

const { createApp, listen } = await import(LIB('server.js'));
const app = createApp(cfg);
const servers = listen(cfg, app.handler);
const port = await boundPort(servers);

/**
 * A raw request, with the body kept as bytes.
 *
 * `http.request` rather than `fetch`, and that is the whole reason it is here: undici
 * sends `accept-encoding` of its own and gunzips the answer before anything can look at
 * it, which would make every case below pass whatever the server did. This sends exactly
 * the headers it is given and hands back exactly what came off the socket.
 */
const raw = (pathname, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method: 'GET', headers: { 'x-beadcause-token': cfg.token, ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.end();
  });

console.log('\nvalidators');

const plain = await raw('/app.js');
is('a script is served', plain.status, 200);
if (plain.headers.etag) ok(`it carries an ETag (${plain.headers.etag})`);
else bad('it carries an ETag', 'no etag header at all — every revalidation is a full 200 again');
if (plain.headers['last-modified']) ok('and a last-modified');
else bad('and a last-modified');
is('and varies on the encoding', plain.headers.vary, 'accept-encoding');
// The load-bearing negative. See the header.
is('and is still no-cache', plain.headers['cache-control'], 'no-cache');
is('uncompressed when nothing asked for it', plain.headers['content-encoding'], undefined);
is('with the file length on it', Number(plain.headers['content-length']), fs.statSync(path.join(PUBLIC, 'app.js')).size);

const again = await raw('/app.js', { 'if-none-match': plain.headers.etag });
is('the same tag comes back 304', again.status, 304);
is('with no body at all', again.body.length, 0);
is('and no content-length to wait for', again.headers['content-length'], undefined);
is('the tag is repeated on the 304', again.headers.etag, plain.headers.etag);
is('so is the cache-control', again.headers['cache-control'], 'no-cache');

const stale = await raw('/app.js', { 'if-none-match': '"something-else"' });
is('a tag that does not match is a 200', stale.status, 200);
if (stale.body.length > 0) ok('with the file on it');
else bad('with the file on it');

const dated = await raw('/app.js', { 'if-modified-since': plain.headers['last-modified'] });
is('a date alone is answered too', dated.status, 304);

/*
  The index page, because it is the one request in this app that is *gated* — and a 304 is
  a response with no body, which is exactly the shape a gate can be forgotten inside. With
  sign-in off (as here) it is served like anything else; the case is here so that a branch
  turning sign-in on has something that says the document still went through `hopGate`
  rather than being answered out of a validator ahead of it.
*/
const index = await raw('/');
is('the shell is served', index.status, 200);
const index304 = await raw('/', { 'if-none-match': index.headers.etag });
is('and revalidates to a 304', index304.status, 304);

/* Vendor bundles are immutable and keep their week — and get a validator anyway, because
   the two are not alternatives: a bundle whose max-age has aged out should revalidate
   rather than be downloaded again. */
const vendor = await raw('/vendor/marked.js');
is('a vendor bundle keeps its max-age', vendor.headers['cache-control'], 'public, max-age=604800');
if (vendor.headers.etag) ok('and has a validator as well');
else bad('and has a validator as well');
is('which revalidates', (await raw('/vendor/marked.js', { 'if-none-match': vendor.headers.etag })).status, 304);

console.log('\ncompression');

const gz = await raw('/app.js', { 'accept-encoding': 'gzip, deflate, br' });
is('gzip is used when offered', gz.headers['content-encoding'], 'gzip');
is('and still no-cache', gz.headers['cache-control'], 'no-cache');
const unzipped = zlib.gunzipSync(gz.body);
is('the body gunzips to the file', unzipped.length, fs.statSync(path.join(PUBLIC, 'app.js')).size);
is('byte for byte', unzipped.equals(fs.readFileSync(path.join(PUBLIC, 'app.js'))), true);
if (gz.body.length < unzipped.length / 2) ok(`and is worth doing (${unzipped.length} → ${gz.body.length})`);
else bad('and is worth doing', `${unzipped.length} → ${gz.body.length}`);
is('with the compressed length on it', Number(gz.headers['content-length']), gz.body.length);

// The different-entity rule. A shared cache that stored this body under the identity tag
// would hand it, gzipped, to a client that asked for no encoding at all.
if (gz.headers.etag !== plain.headers.etag) ok('the gzipped body has a tag of its own');
else bad('the gzipped body has a tag of its own', `both are ${gz.headers.etag}`);
if (String(gz.headers.etag).includes('-gz')) ok('and says which it is');
else bad('and says which it is', String(gz.headers.etag));

const gz304 = await raw('/app.js', { 'accept-encoding': 'gzip', 'if-none-match': gz.headers.etag });
is('the compressed entity revalidates too', gz304.status, 304);
is('with no body', gz304.body.length, 0);

// And the two do not revalidate onto each other, which is the failure a single shared tag
// would produce: an identity client handed a 304 over a body it had never been sent.
is('an identity client cannot 304 onto the gzipped tag', (await raw('/app.js', { 'if-none-match': gz.headers.etag })).status, 200);
is(
  'nor a gzip client onto the identity one',
  (await raw('/app.js', { 'accept-encoding': 'gzip', 'if-none-match': plain.headers.etag })).status,
  200
);

const refused = await raw('/app.js', { 'accept-encoding': 'gzip;q=0' });
is('a q=0 refusal is honoured', refused.headers['content-encoding'], undefined);

const png = await raw('/icon-512.png', { 'accept-encoding': 'gzip' });
is('an image is not compressed', png.headers['content-encoding'], undefined);
is('but still has a validator', typeof png.headers.etag, 'string');
is('and revalidates', (await raw('/icon-512.png', { 'if-none-match': png.headers.etag })).status, 304);

const css = await raw('/style.css', { 'accept-encoding': 'gzip' });
is('the stylesheet is compressed', css.headers['content-encoding'], 'gzip');
is('and gunzips whole', zlib.gunzipSync(css.body).length, fs.statSync(path.join(PUBLIC, 'style.css')).size);

/*
  The whole point, in one number.

  Not a threshold anybody has to maintain — it is measured against the files on disk, so
  it moves with them — but it is the assertion that would fail if a later branch made the
  gzip conditional on something it should not be. bc-iaju1.6 measured the shell's 36 files
  at 2.24 MB uncompressed and 727 kB gzipped; anything over half is the compression having
  quietly stopped happening for most of them.
*/
const shell = ['/index.html', '/style.css', '/app.js', '/monitor.js', '/editmode.js', '/inboxfilter.js'];
let rawBytes = 0;
let sentBytes = 0;
for (const f of shell) {
  const one = await raw(f, { 'accept-encoding': 'gzip' });
  rawBytes += fs.statSync(path.join(PUBLIC, f === '/' ? 'index.html' : f.slice(1))).size;
  sentBytes += one.body.length;
}
if (sentBytes < rawBytes / 2) ok(`the shell's six biggest files ship at ${(sentBytes / 1024) | 0} kB of ${(rawBytes / 1024) | 0} kB`);
else bad("the shell's six biggest files are compressed", `${rawBytes} → ${sentBytes}`);

/* And a second load of all six costs no body at all, which is the 304 half of the same
   claim. This is the measurement that filed the bead: it used to cost all 2.24 MB again. */
let revalidated = 0;
for (const f of shell) {
  const first = await raw(f, { 'accept-encoding': 'gzip' });
  const second = await raw(f, { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
  if (second.status === 304 && second.body.length === 0) revalidated += 1;
}
is('a warm load of them sends no bodies', revalidated, shell.length);

/* ------------------------------------------------------------------- ending */

for (const s of servers) s.close();
await cleanupTmp(tmp);

console.log(`\n${failures ? '\x1b[31m' : '\x1b[32m'}${ran - failures}/${ran} checks passed\x1b[0m\n`);
process.exit(failures ? 1 : 0);
