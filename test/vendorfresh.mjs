#!/usr/bin/env node
//
// scripts/vendor.js stamps what it copies as freshly accessed (bc-xl7n.184): macOS's tmp
// cleanup deletes files not accessed for 3 days, and an APFS clone keeps the source's old
// atime, so a gate tree that waited past 03:35 lost public/vendor.
//
//   node test/vendorfresh.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? '\x1b[32m✓' : '\x1b[31m✗'}\x1b[0m ${name}${cond ? '' : ` ${detail}`}`);
};

// A standalone tree (not under .claude/worktrees, so nothing is borrowed) whose
// node_modules files are a month old.
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'vendorfresh-'));
try {
  fs.mkdirSync(path.join(tmp, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'vendor.js'), path.join(tmp, 'scripts', 'vendor.js'));
  const old = new Date(Date.now() - 30 * 86400000);
  const files = [
    'marked/lib/marked.umd.js', 'dompurify/dist/purify.min.js', 'mermaid/dist/mermaid.min.js',
    'd3/dist/d3.min.js', '@xterm/xterm/lib/xterm.js', '@xterm/xterm/css/xterm.css',
    '@xterm/addon-fit/lib/addon-fit.js',
  ];
  for (const f of files) {
    const p = path.join(tmp, 'node_modules', f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
    fs.utimesSync(p, old, old);
  }
  execFileSync(process.execPath, [path.join(tmp, 'scripts', 'vendor.js')], { cwd: tmp, stdio: 'pipe' });
  const dir = path.join(tmp, 'public', 'vendor');
  const names = fs.readdirSync(dir);
  check('all seven bundles were copied', names.length === 7, String(names));
  const cutoff = Date.now() - 3 * 86400000;
  const stale = names.filter((n) => {
    const st = fs.statSync(path.join(dir, n));
    return st.atimeMs < cutoff || st.mtimeMs < cutoff;
  });
  check('none carries an access time old enough for the 3-day tmp sweep', stale.length === 0, stale.join(','));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
