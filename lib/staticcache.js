/**
 * What a static file is allowed to skip sending, and what it is allowed to send smaller
 * (bc-iaju1.6).
 *
 * ## The measurement that filed this
 *
 * A cold open of the app pulls **2.24 MB**: `public/index.html` and 34 synchronous
 * scripts (1.78 MB of them — app.js alone is 623 kB) plus 414 kB of stylesheet. Every
 * byte of that went out uncompressed, and every byte of it went out *again* on the next
 * load, because `serveStatic` answered `cache-control: no-cache` with no validator on it
 * at all. `no-cache` does not mean "do not store" — it means "store it, but ask me before
 * you use it" — so a browser holding the whole shell still asked for all 36 files, and
 * with nothing to ask *with* every one of those questions was answered with a full 200
 * and the file again. The phone this app is for reaches the daemon over a tailnet, and
 * the moment it does it is the moment a notification was tapped.
 *
 * So the `no-cache` story was right and only half-built. This file is the other half:
 * a validator, so the question a browser was already asking can be answered `304` with
 * no body; and gzip, so the answer that does carry a body carries a third of one.
 *
 * ## Why the cache-control itself does not move
 *
 * The obvious cheaper change is a `max-age` on the shell, and it is the wrong one here
 * for the same reason the comment at the repo-view branch in lib/server.js gives: this
 * app deploys itself on every merge, and a phone holding last week's `app.js` because a
 * header said it could is a bug nobody can clear remotely. `no-cache` keeps the browser
 * asking every time; what changes is that asking is now nearly free. `/vendor/` keeps its
 * week-long `max-age` because those bundles are immutable by construction.
 *
 * ## The ETag is mtime-and-size, and that is a deliberate "strong-ish"
 *
 * A content hash would be exact and would cost a read of the whole file on every request
 * to produce — on `app.js`, 623 kB of I/O to answer a question whose whole point is to
 * avoid sending 623 kB. `size-mtimeMs` changes whenever a deploy rewrites a file, which
 * is the only way a file under `public/` ever changes here, and the failure mode of the
 * pathological case (a rewrite inside the same millisecond that lands on the same byte
 * count) is a phone holding a file for one more load — which is precisely what
 * public/update.js's post-deploy reload and public/sw.js's cache version already exist to
 * catch. It is emitted as a strong tag rather than `W/` because nothing here serves
 * ranges, and a weak tag would only invite a `If-Range` that cannot be honoured.
 *
 * **The gzipped body is a different entity and carries a different tag** (`…-gz`). That
 * is not pedantry: a cache in front of this daemon that stored the compressed body under
 * the identity tag would hand it, gzipped, to the next client that asked without an
 * `accept-encoding`. `vary: accept-encoding` says the same thing to anything that keys on
 * headers instead.
 */

import zlib from 'node:zlib';

/**
 * Types worth compressing.
 *
 * Matched on the *prefix* of the content type so the `; charset=utf-8` every text entry
 * in `MIME` carries does not have to be spelled here, and so a type this daemon has not
 * met yet errs towards *not* compressing. Everything left out is either already
 * compressed — png, jpeg, webp, avif, gif, wav, pdf — or small enough that the CPU is the
 * larger cost. Gzipping a PNG is reliably a few bytes *bigger* and costs a compression
 * pass to find that out.
 */
const COMPRESSIBLE = [
  'text/',
  'application/javascript',
  'application/json',
  'application/manifest+json',
  'image/svg+xml',
];

/**
 * Below this, compression is not worth the round-trip through zlib.
 *
 * A gzip member carries about 20 bytes of header and trailer, so a small file can come
 * back *larger*; and a response under a single TCP segment does not get to the client any
 * sooner for being 300 bytes rather than 600. 1 kB is the threshold nginx and every other
 * server here has settled on, for the same reason.
 */
const MIN_COMPRESS = 1024;

/**
 * The largest file that is compressed in memory rather than streamed.
 *
 * Over this, `gzipStream` is what `lib/server.js` uses instead: the body goes out chunked
 * with no `content-length`, which costs a header that a phone does not read anyway. Two
 * megabytes covers every file under `public/` with room to spare (the biggest is app.js
 * at 623 kB) and keeps an accidental 400 MB log file out of the buffer cache.
 */
const MAX_BUFFERED = 2 * 1024 * 1024;

/**
 * How many distinct compressed bodies are held.
 *
 * Keyed by path *and* ETag, so a deploy that rewrites `app.js` does not invalidate
 * anything explicitly — the new request simply misses, compresses once, and the stale
 * entry falls off the end. 64 is comfortably more than the shell's 36 files and far less
 * than anything that would matter on a Mac; the cap exists so that a crawler walking
 * `/docs/**` cannot grow it without bound.
 */
const MAX_ENTRIES = 64;

/**
 * And a ceiling on what those entries add up to.
 *
 * `MAX_ENTRIES` alone is a count, and a count is the wrong unit for a memory bound: 64
 * entries of 2 MB each is 128 MB held by a daemon that also runs the advocates. In
 * practice `public/` compresses to well under a megabyte in total, so this never binds —
 * which is exactly why it is worth having, because the day it does bind is a day
 * something unexpected is being served.
 */
const MAX_BYTES = 16 * 1024 * 1024;

/** path + etag → gzipped body. Insertion-ordered, oldest evicted first (a Map iterates in
 *  insertion order, which is the whole of the eviction policy this needs). */
const bodies = new Map();

/** What those bodies add up to, so the byte bound above can be enforced without walking
 *  the map on every store. */
let held = 0;

/** Is this content type worth gzipping? */
export function compressible(type) {
  const t = String(type || '').toLowerCase();
  return COMPRESSIBLE.some((p) => t.startsWith(p));
}

/**
 * Did the client say it takes gzip?
 *
 * Deliberately a substring match rather than a q-value parser. The only way to *refuse*
 * gzip in the header's grammar is `gzip;q=0`, which no browser sends and which is the one
 * case worth spelling out; everything else that mentions gzip at all takes it. A full
 * parse of `accept-encoding` here would be more code than the whole of the rest of this
 * file for no case that occurs.
 */
export function acceptsGzip(req) {
  const h = String(req?.headers?.['accept-encoding'] || '').toLowerCase();
  if (!h.includes('gzip')) return false;
  // `gzip;q=0` — and `gzip; q=0`, and `gzip;q=0.0`. A zero q is a refusal.
  return !/gzip\s*;\s*q\s*=\s*0(\.0+)?(\s*(,|$))/.test(h);
}

/**
 * The validator for a file, from what `fs.stat` already read.
 *
 * `variant` is `'gz'` for the compressed body, which is a different entity and must not
 * share a tag with the identity one — see the header.
 */
export function etagFor(stat, variant = '') {
  const size = Number(stat.size).toString(16);
  const mtime = Math.floor(Number(stat.mtimeMs)).toString(16);
  return `"${size}-${mtime}${variant ? `-${variant}` : ''}"`;
}

/**
 * Does the request already hold this entity?
 *
 * `if-none-match` first and alone where it is present, which is what RFC 9110 asks for:
 * a client that sent both has told you its tag is the better question. `*` matches
 * anything that exists, which for a file that just stat'd is always.
 *
 * The comparison is weak (`W/` stripped from both sides) because that is the comparison
 * `if-none-match` is defined to use — a client that was handed a weak tag by some proxy
 * in between must still be able to revalidate against it.
 */
export function notModified(req, etag, lastModified) {
  const inm = req?.headers?.['if-none-match'];
  if (inm) {
    const want = String(etag).replace(/^W\//, '');
    return String(inm)
      .split(',')
      .map((s) => s.trim().replace(/^W\//, ''))
      .some((t) => t === '*' || t === want);
  }
  // Only when there is no tag at all. `if-modified-since` has one-second resolution, so
  // a file rewritten twice inside the same second and asked for in between would answer
  // 304 over a body that really had changed — which is why the tag is asked first and
  // this is the fallback for a client (or a `curl -z`) that has nothing else.
  const ims = req?.headers?.['if-modified-since'];
  if (ims && lastModified) {
    const asked = Date.parse(ims);
    const have = Date.parse(lastModified);
    if (Number.isFinite(asked) && Number.isFinite(have)) return have <= asked;
  }
  return false;
}

/** The `last-modified` header for a stat, in the one format HTTP accepts. */
export function lastModifiedOf(stat) {
  return new Date(Number(stat.mtimeMs)).toUTCString();
}

/**
 * The whole of the question `lib/server.js` asks: does this response go out gzipped?
 *
 * One call rather than three, so the size threshold lives beside the constant that sets
 * it and there is one place to read when the answer surprises somebody.
 */
export function shouldGzip(req, type, stat) {
  return compressible(type) && acceptsGzip(req) && Number(stat?.size) >= MIN_COMPRESS;
}

/** Is this file small enough to compress into memory rather than stream? */
export function bufferable(stat) {
  return Number(stat.size) <= MAX_BUFFERED;
}

/**
 * The gzipped body for a file, compressed once and kept.
 *
 * `read` is handed in rather than imported so that the caller keeps its own file access —
 * `lib/server.js` has already resolved and stat'd the path by the time it gets here, and
 * a second opinion about which file this is would be a second place for a traversal check
 * to be missing.
 *
 * Level 6 is zlib's default and the right one: level 9 buys about 1% on this app's
 * scripts for roughly three times the CPU, paid on a Mac that is also running the
 * advocates.
 */
export async function gzipped(key, etag, read) {
  const id = `${key}\u0000${etag}`;
  const hit = bodies.get(id);
  if (hit) return hit;
  const body = await new Promise((resolve, reject) => {
    read().then((raw) => {
      zlib.gzip(raw, { level: zlib.constants.Z_DEFAULT_COMPRESSION }, (err, out) => (err ? reject(err) : resolve(out)));
    }, reject);
  });
  bodies.set(id, body);
  held += body.length;
  // Oldest first, until both bounds are satisfied. A Map's iterator is insertion order, so
  // this is an LRU by arrival rather than by use — which, for a set of files that are all
  // requested together on one page load, is the same thing.
  while (bodies.size > MAX_ENTRIES || held > MAX_BYTES) {
    const oldest = bodies.keys().next().value;
    if (oldest === undefined || oldest === id) break;
    held -= bodies.get(oldest).length;
    bodies.delete(oldest);
  }
  return body;
}

/** A streaming gzip, for a file too large to hold. */
export function gzipStream() {
  return zlib.createGzip({ level: zlib.constants.Z_DEFAULT_COMPRESSION });
}

/** Everything held, dropped. For the suites, which write a file, read it, rewrite it in
 *  the same test and must not be answered out of a buffer keyed on a path they reused. */
export function forget() {
  bodies.clear();
  held = 0;
}

/** How many compressed bodies are held. The suites assert on this; nothing else reads it. */
export function heldCount() {
  return bodies.size;
}
