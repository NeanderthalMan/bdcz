#!/usr/bin/env node
//
// Notes on a document, in the real reader: select → Comment / Suggest edit → tray → Send.
//
//   node scripts/docnotes-check.mjs [--shots]
//
// bc-03vg2.2's acceptance, on the browser half: select a sentence in a chapter, suggest a
// replacement, add a second note as a comment, send — and the bead gets exactly ONE
// comment holding a valid docnotes block whose quotes are verbatim from the source.
// Around that, the things a phone makes easy to get wrong:
//
//   • the selection survives the tap on the bar (the snapshot, and preventDefault);
//   • the suggest box starts as the source's own words, emphasis and all;
//   • unsent notes survive a reload;
//   • a passage that can't be anchored uniquely says so and cannot be saved;
//   • a refused send keeps the notes;
//   • with no bead in the URL, one is filed — labelled human, "Notes on <file>" — and
//     the notes go there;
//   • `ref` and `blob` in the block are what /api/asset said (X-Doc-Ref, X-Blob-Sha).
//
// Real public/doc.html, doc.js, docnotes.js and style.css in a headless Chrome the size
// of a phone, against fixtures served from this process. Nothing touches a real bead.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { CHROME, launchChrome } from './helpers/chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const VP = { width: 393, height: 852, dpr: 3 };
const TOKEN = 'docnotes-check-token';
const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = path.join(ROOT, '.claude', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(CHROME)) {
  console.error(`Google Chrome not found at ${CHROME}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(PUBLIC, 'vendor', 'purify.js'))) {
  console.error('public/vendor is missing — run `npm run vendor` first.');
  process.exit(1);
}

/* ---------------------------------------------------------------- fixtures */

const FILE = '/Users/a/loremia/drafts/CHAPTER_25.md';
const SOURCE = [
  '# Chapter 25',
  '',
  '## 3. The Sky Lit Wrong',
  '',
  'The sky lit wrong that night, and **nobody on the ridge** said a word.',
  'Mara read the [ledger](ledger.md) twice and put it down.',
  '',
  'It was quiet. It was quiet.',
  '',
].join('\n');
const BLOB = 'b'.repeat(40);
const RESOLVED = 'origin/feat/ch25';

const seen = { comments: [], creates: [], failComment: false };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const json = (body, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const body = () =>
      new Promise((resolve) => {
        let b = '';
        req.on('data', (c) => (b += c));
        req.on('end', () => resolve(JSON.parse(b || '{}')));
      });
    if (p === '/api/asset') {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'x-blob-sha': BLOB, 'x-doc-ref': RESOLVED });
      return res.end(SOURCE);
    }
    if (p === '/api/confluence') return json({ configured: false });
    if (p === '/api/workspaces') return json({ workspaces: [{ name: 'beadcause' }, { name: 'loremia' }] });
    if (p === '/api/comment') {
      return body().then((b) => {
        seen.comments.push(b);
        return seen.failComment ? json({ error: 'bd: database is locked' }, 500) : json({ ok: true, dispatched: true });
      });
    }
    if (p === '/api/bead/create') {
      return body().then((b) => {
        seen.creates.push(b);
        return json({ ok: true, id: 'lm-new1', workspace: b.workspace });
      });
    }
    if (p.startsWith('/api/')) return json({});
    const rel = p === '/doc' ? 'doc.html' : p.replace(/^\/+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return res.writeHead(404).end('no');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const evalJs = async (s, expr) => {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.exception?.description || 'eval failed'}\n  in: ${expr.slice(0, 140)}`);
  return r.result.value;
};
const waitFor = async (s, expr, tries = 60, gap = 100) => {
  for (let i = 0; i < tries; i++) {
    if (await evalJs(s, expr)) return true;
    await sleep(gap);
  }
  return false;
};

// Select the nth occurrence of `text` in the rendered document, across element
// boundaries, the way a long-press and a drag of the handles would.
const select = (s, text, nth = 0) =>
  evalJs(
    s,
    `(() => {
      const body = document.getElementById('doc');
      const nodes = [];
      const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let all = '';
      for (let n; (n = w.nextNode()); ) { nodes.push([n, all.length]); all += n.data; }
      let at = -1;
      for (let i = 0; i <= ${nth}; i++) at = all.indexOf(${JSON.stringify(text)}, at + 1);
      if (at < 0) return false;
      const end = at + ${JSON.stringify(text)}.length;
      const find = (off, isEnd) => {
        for (const [n, base] of nodes) if (off >= base && (isEnd ? off <= base + n.data.length : off < base + n.data.length)) return [n, off - base];
        return null;
      };
      const [sn, so] = find(at, false);
      const [en, eo] = find(end, true);
      const r = document.createRange();
      r.setStart(sn, so);
      r.setEnd(en, eo);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    })()`
  );
const tap = (s, sel) => evalJs(s, `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
const visible = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; })()`;

let shotN = 0;
async function shot(s, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const r = await s.send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(SHOT_DIR, `docnotes-${String(++shotN).padStart(2, '0')}-${name}.png`);
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  console.log(`    · ${out}`);
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
};
const parseBlock = (text) => {
  const m = /```docnotes\n([\s\S]*?)\n```/.exec(String(text || ''));
  return m ? YAML.parse(m[1]) : null;
};

const server = await serve();
const BASE = `http://127.0.0.1:${server.address().port}`;
const { s, close } = await launchChrome('beadcause-docnotes-');

try {
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('Emulation.setDeviceMetricsOverride', {
    width: VP.width, height: VP.height, deviceScaleFactor: VP.dpr, mobile: true, screenWidth: VP.width, screenHeight: VP.height,
  });
  await s.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const open = async (query) => {
    await s.send('Page.navigate', { url: `${BASE}/doc?${query}` });
    await waitFor(s, `document.readyState === 'complete'`);
    await evalJs(s, `localStorage.setItem('beadcause.token', ${JSON.stringify(TOKEN)}), true`);
    await s.send('Page.reload');
    await sleep(150);
    if (!(await waitFor(s, `!!document.querySelector('#doc h2')`))) throw new Error('the document never rendered');
  };
  const WITH_BEAD = `p=${encodeURIComponent(FILE)}&ref=feat%2Fch25&ws=loremia&bead=lm-42`;
  await open(WITH_BEAD);
  await evalJs(s, `localStorage.clear(), localStorage.setItem('beadcause.token', ${JSON.stringify(TOKEN)}), true`);

  console.log('\nselect and suggest');
  await select(s, 'nobody on the ridge said');
  check('a selection brings up the bar', await waitFor(s, visible('.dn-bar')));
  await shot(s, 'bar');
  // Collapse first, as a real tap on a phone may — the snapshot has to carry it.
  check('Suggest edit opens the sheet', await tap(s, '.dn-bar [data-kind="suggest"]') && (await waitFor(s, visible('.dn-sheet'))));
  const pre = await evalJs(s, `document.querySelector('.dn-sheet .dn-text')?.value`);
  check('prefilled with the source, emphasis and all', pre === '**nobody on the ridge** said', JSON.stringify(pre));
  await shot(s, 'suggest-sheet');
  await evalJs(s, `document.querySelector('.dn-sheet .dn-text').value = 'everyone said', document.querySelector('.dn-sheet .dn-why').value = 'the ridge was full', true`);
  await tap(s, '.dn-sheet .dn-save');
  check('saved into the tray', await waitFor(s, `(document.querySelector('.dn-count')?.textContent || '') === '1 note'`));

  console.log('\na comment, and a reload');
  await select(s, 'Mara read the ledger');
  await waitFor(s, visible('.dn-bar'));
  await tap(s, '.dn-bar [data-kind="comment"]');
  await waitFor(s, visible('.dn-sheet'));
  check('a comment starts empty', (await evalJs(s, `document.querySelector('.dn-sheet .dn-text').value`)) === '');
  await tap(s, '.dn-sheet .dn-save');
  check('an empty comment is not saved', await evalJs(s, `!document.querySelector('.dn-sheet').hidden`));
  await evalJs(s, `document.querySelector('.dn-sheet .dn-text').value = 'Which ledger — the "old" one?', true`);
  await tap(s, '.dn-sheet .dn-save');
  check('two notes', await waitFor(s, `(document.querySelector('.dn-count')?.textContent || '') === '2 notes'`));
  await shot(s, 'tray');
  await s.send('Page.reload');
  await waitFor(s, `!!document.querySelector('#doc h2')`);
  check('unsent notes survive a reload', await waitFor(s, `(document.querySelector('.dn-count')?.textContent || '') === '2 notes'`));

  console.log('\nsomething that cannot be anchored');
  // The same sentence twice with nothing to tell the copies apart. On the page the text
  // either side does differ, so this asks the layer directly with no context.
  check(
    'the same sentence twice, with no context, is refused',
    (await evalJs(s, `window.beadcause.docnotes.anchor(window.beadcauseDoc.source, 'It was quiet.', {}).ok`)) === false
  );
  // The second copy selected on the page: its surroundings pick it, so no refusal.
  await select(s, 'It was quiet.', 1);
  await evalJs(s, `window.beadcause.docnotes.open('comment'), true`);
  await waitFor(s, visible('.dn-sheet'));
  const refusal = await evalJs(s, `({ err: document.querySelector('.dn-sheet .dn-err')?.textContent || '', disabled: document.querySelector('.dn-sheet .dn-save')?.disabled })`);
  check('on the page, the second copy is told apart by its surroundings', !refusal.err && refusal.disabled === false, JSON.stringify(refusal));
  await tap(s, '.dn-sheet .dn-cancel');
  // A passage the source cannot supply: the page's text changed under the layer.
  await evalJs(s, `document.querySelector('#doc p').append(document.createTextNode(' Added by nobody.')), true`);
  await select(s, 'Added by nobody.');
  await evalJs(s, `window.beadcause.docnotes.open('suggest'), true`);
  await waitFor(s, visible('.dn-sheet'));
  const bad = await evalJs(s, `({ err: document.querySelector('.dn-sheet .dn-err')?.textContent || '', disabled: document.querySelector('.dn-sheet .dn-save')?.disabled })`);
  check('text not in the source says so, and cannot be saved', /can't be found/.test(bad.err) && bad.disabled === true, JSON.stringify(bad));
  await shot(s, 'refusal');
  await tap(s, '.dn-sheet .dn-cancel');

  console.log('\nsend');
  seen.failComment = true;
  await tap(s, '.dn-send');
  await waitFor(s, `/Not sent/.test(document.querySelector('.dn-tray')?.textContent || '')`);
  check('a refused send says so and keeps the notes', (await evalJs(s, `document.querySelector('.dn-count')?.textContent`)) === '2 notes');
  seen.failComment = false;
  seen.comments.length = 0;
  await tap(s, '.dn-send');
  check('a send says where it went', await waitFor(s, `/Sent 2 notes to lm-42/.test(document.querySelector('.dn-tray')?.textContent || '')`));
  await shot(s, 'sent');
  check('exactly one comment for the batch', seen.comments.length === 1, String(seen.comments.length));
  const c = seen.comments[0] || {};
  check('on the bead from the URL', c.workspace === 'loremia' && c.id === 'lm-42', JSON.stringify({ w: c.workspace, id: c.id }));
  const doc = parseBlock(c.text);
  check('its body is a docnotes block that parses', Boolean(doc), c.text);
  check('file, the ref that resolved, and the blob', doc?.file === FILE && doc?.ref === RESOLVED && doc?.blob === BLOB, JSON.stringify(doc && { file: doc.file, ref: doc.ref, blob: doc.blob }));
  check('two notes, in order', doc?.notes?.map((n) => n.kind).join(',') === 'suggest,comment');
  check('every quote is verbatim from the source', (doc?.notes || []).every((n) => SOURCE.includes(n.before + n.quote + n.after)));
  check('the suggestion carries its replacement and reason', doc?.notes?.[0]?.replacement === 'everyone said' && doc?.notes?.[0]?.note === 'the ridge was full');
  check('the comment carries its text', doc?.notes?.[1]?.note === 'Which ledger — the "old" one?');
  check('section and line', doc?.notes?.[0]?.section === '## 3. The Sky Lit Wrong' && doc?.notes?.[0]?.line === 5 && doc?.notes?.[1]?.line === 6);
  check('and the tray is empty after', !(await evalJs(s, `!!document.querySelector('.dn-count')`)));

  console.log('\nno bead in the URL');
  await open(`p=${encodeURIComponent(FILE)}`);
  await select(s, 'The sky lit wrong');
  await waitFor(s, visible('.dn-bar'));
  await tap(s, '.dn-bar [data-kind="comment"]');
  await waitFor(s, visible('.dn-sheet'));
  await evalJs(s, `document.querySelector('.dn-sheet .dn-text').value = 'Good opening.', true`);
  await tap(s, '.dn-sheet .dn-save');
  seen.comments.length = 0;
  await tap(s, '.dn-send');
  check('it offers to file a bead', await waitFor(s, `/No bead to send these to/.test(document.querySelector('.dn-sheet')?.textContent || '')`));
  check('in the workspace the path names', (await evalJs(s, `document.querySelector('.dn-ws')?.value`)) === 'loremia');
  await shot(s, 'file-a-bead');
  await tap(s, '.dn-sheet .dn-save');
  await waitFor(s, `/Sent 1 note to lm-new1/.test(document.querySelector('.dn-tray')?.textContent || '')`);
  const made = seen.creates[0] || {};
  check('filed as "Notes on <file>", labelled human', made.title === 'Notes on CHAPTER_25.md' && made.workspace === 'loremia' && made.labels?.includes('human'), JSON.stringify(made));
  check('and the notes went to it, once', seen.comments.length === 1 && seen.comments[0].id === 'lm-new1' && parseBlock(seen.comments[0].text)?.notes?.length === 1);
} finally {
  await close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
