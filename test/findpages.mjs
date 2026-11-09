/**
 * Every page in public/ is reachable from Find, or says why it is not a place (bc-qzng7.4).
 *
 * The redesign has one bar with three destinations on it, so everything else in the app
 * is reached from Find. A page added to public/ without a Find entry is a page nobody can
 * get to except by typing its address — so this fails the build until it is either listed
 * in `PAGES` in public/find.js, or named in `NOT_A_PLACE` there with the reason it needs
 * an argument (a bead, a document, a session) that only the thing you tapped can give it.
 *
 * Modelled on test/pagepaths.mjs: the list is read out of the file the browser runs, in a
 * vm, rather than copied here.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let failures = 0;
let ran = 0;
function check(name, fn) {
  ran += 1;
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${String(err.message).split('\n')[0]}`);
  }
}

/** public/find.js, run in a room with just enough of a browser to define itself. */
function loadFind() {
  const listeners = [];
  const ctx = {
    window: {},
    localStorage: { getItem: () => '' },
    document: { addEventListener: (t, fn) => listeners.push(fn) },
    fetch: () => Promise.reject(new Error('no network')),
  };
  ctx.window.beadcause = undefined;
  vm.createContext(ctx);
  vm.runInContext(read('public/find.js').replace(/\bwindow\./g, 'window.'), ctx);
  return ctx.window.beadcause.find;
}

/** Where the server answers each page from — `serveStatic`'s rewrites, read out of lib/server.js. */
const SERVER = read('lib/server.js');
const servedAs = (file) => {
  const m = [...SERVER.matchAll(/if \(([^)]*)\) urlPath = '\/([a-z]+\.html)'/g)].find((x) => x[2] === file);
  return m ? [...m[1].matchAll(/urlPath === '([^']+)'/g)].map((x) => x[1]) : [];
};

const find = loadFind();
const pages = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html'));

console.log('\nevery page is a place in Find, or says why not');

check('the list is there to read', () => {
  assert.ok(Array.isArray(find.PAGES) && find.PAGES.length > 10, 'find.js has no PAGES');
});

check('every page in public/ is listed, or named as not a place with a reason', () => {
  const hrefs = find.PAGES.map((p) => p.href.split(/[?#]/)[0]);
  const missing = [];
  for (const file of pages) {
    const reason = find.NOT_A_PLACE[file];
    if (reason) {
      assert.ok(String(reason).length > 8, `${file} is exempted without a reason`);
      continue;
    }
    const stem = `/${file.replace(/\.html$/, '')}`;
    const aliases = [stem, `/${file}`, ...servedAs(file)];
    if (!hrefs.some((h) => aliases.includes(h))) missing.push(file);
  }
  assert.deepEqual(missing, [], `no Find entry for: ${missing.join(', ')} — add one to PAGES, or a reason to NOT_A_PLACE`);
});

check('an exemption names a page that exists', () => {
  for (const file of Object.keys(find.NOT_A_PLACE)) assert.ok(pages.includes(file), `${file} is exempted but is not in public/`);
});

check('the three destinations and Settings are the first places listed', () => {
  // JSON, because an array built inside the vm has the vm's own `Array` prototype.
  assert.equal(
    JSON.stringify(find.PAGES.slice(0, 2).map((p) => p.label)),
    JSON.stringify(['Inbox', 'Work']),
    'Find opens on something other than the destinations'
  );
  assert.ok(find.PAGES.some((p) => p.href === '/#config'), 'Settings is not in Find');
});

check('the bar loads Find on demand, and the service worker ships it', () => {
  assert.match(read('public/viewbar.js'), /tag\.src = '\/find\.js'/, 'nothing loads find.js');
  assert.match(read('public/sw.js'), /'\/find\.js'/, 'find.js is not precached');
});

console.log(`\n${failures ? `\x1b[31m${failures} of ${ran} failed\x1b[0m` : `\x1b[32mall good\x1b[0m (${ran})`}\n`);
process.exit(failures ? 1 : 0);
