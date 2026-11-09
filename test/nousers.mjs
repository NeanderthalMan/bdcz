#!/usr/bin/env node
/**
 * No hard-coded macOS home directory in lib/ bin/ scripts/ (bc-obucr.5).
 *
 *     node test/nousers.mjs
 *
 * A literal slash-Users-slash path is a path that only exists on Adam's Mac. A real path
 * should come from os.homedir(); a pattern that recognises a home directory must also
 * match the Linux form, so write it as `/(?:Users|home)/` (the literal is never spelled
 * out); a fixture should use a neutral root such as /srv/x.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEEDLE = '/' + 'Users' + '/';
const hits = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
    if (!e.isFile()) continue;
    let s;
    try { s = fs.readFileSync(p, 'utf8'); } catch { continue; }
    s.split('\n').forEach((l, i) => { if (l.includes(NEEDLE)) hits.push(path.relative(root, p) + ':' + (i + 1) + ': ' + l.trim().slice(0, 100)); });
  }
};
for (const d of ['lib', 'bin', 'scripts']) walk(path.join(root, d));
if (hits.length) { console.error('hard-coded macOS home paths:\n' + hits.join('\n')); process.exit(1); }
console.log('ok - no hard-coded macOS home paths in lib/ bin/ scripts/');
