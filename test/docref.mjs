#!/usr/bin/env node
/**
 * `/api/asset?ref=` — a document read at a git ref, so a draft on an unmerged pull
 * request stays readable after its worktree is gone (bc-03vg2.1, lib/docref.js).
 *
 *     npm test
 *     node test/docref.mjs
 *
 * On a throwaway repo with a branch, a worktree of that branch that is then removed, and
 * a remote-tracking ref with no local branch behind it:
 *
 * 1. **The worktree path still reads after the worktree is deleted** — and so does the
 *    main checkout's path for a file that exists only on the branch. That is the
 *    acceptance line, and the reason the file exists.
 * 2. **`X-Blob-Sha` is the real blob**, the one `git rev-parse <ref>:<path>` names, and
 *    the plain disk read carries one too, equal to `git hash-object`.
 * 3. **`origin/<ref>` is the fallback** when the local branch is gone, and `X-Doc-Ref`
 *    says which one resolved.
 * 4. **A bad ref is a 400, not a shell error** — option-shaped, range-shaped, reflog-
 *    shaped, with a space or a semicolon in it. An unknown ref and a file that is not on
 *    the ref are 404s.
 * 5. **The reach is unchanged**: outside `assetRoots` is a 403, a type the plain route
 *    refuses is a 415, with or without `ref=`.
 * 6. **The reader carries the ref** onto images and sibling links, and does not offer a
 *    Confluence publish of a text it would read from the disk instead.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

let failures = 0;
const check = (what, ok, detail = '') => {
  console.log(`${ok ? '  \x1b[32m✓\x1b[0m' : '  \x1b[31m✗\x1b[0m'} ${what}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
};
const section = (s) => console.log(`\n${s}`);

// realpath'd: on macOS the temp dir is a /var symlink into /private/var, and assetRoots
// is compared against realpaths.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-docref-')));
// Before lib/ is imported: the server reads and writes its state under here.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });
const repo = path.join(tmp, 'repo');
const other = path.join(tmp, 'other');
const G = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

fs.mkdirSync(repo, { recursive: true });
G(repo, 'init', '-q', '-b', 'main');
fs.writeFileSync(path.join(repo, 'README.md'), '# main\n');
G(repo, 'add', '-A');
G(repo, 'commit', '-q', '-m', 'main');

G(repo, 'checkout', '-q', '-b', 'feat/draft');
fs.mkdirSync(path.join(repo, 'drafts'));
const CHAPTER = '# Chapter 25\n\n## 3. The Sky Lit Wrong\n\nThe sky lit wrong that night.\n\n![map](map.png)\n';
fs.writeFileSync(path.join(repo, 'drafts', 'CHAPTER_25.md'), CHAPTER);
fs.writeFileSync(path.join(repo, 'drafts', 'run.sh'), 'echo hi\n');
G(repo, 'add', '-A');
G(repo, 'commit', '-q', '-m', 'draft');
const draftSha = G(repo, 'rev-parse', 'HEAD');
const blob = G(repo, 'rev-parse', 'HEAD:drafts/CHAPTER_25.md');
G(repo, 'checkout', '-q', 'main');

// A pushed branch whose local ref is gone: only refs/remotes/origin/<name> remains.
G(repo, 'update-ref', 'refs/remotes/origin/pushed', draftSha);

// A worktree of the branch, the way sessions make them — and then retired.
const wt = path.join(repo, '.claude', 'worktrees', 'wt');
G(repo, 'worktree', 'add', '-q', '-b', 'worktree-wt', wt, 'feat/draft');
check('the worktree exists before it is removed', fs.existsSync(path.join(wt, 'drafts', 'CHAPTER_25.md')));
G(repo, 'worktree', 'remove', '--force', wt);
check('and is gone after', !fs.existsSync(wt));

fs.mkdirSync(other);
G(other, 'init', '-q', '-b', 'main');
fs.writeFileSync(path.join(other, 'x.md'), 'x\n');
G(other, 'add', '-A');
G(other, 'commit', '-q', '-m', 'x');

section('lib/docref.js, directly');
{
  const { locate, checkRef, blobSha } = await import(LIB('docref.js'));
  const a = locate(path.join(wt, 'drafts', 'CHAPTER_25.md'));
  check('a retired worktree path maps to the main repo', a?.repo === repo && a?.rel === 'drafts/CHAPTER_25.md', JSON.stringify(a));
  const b = locate(path.join(repo, 'drafts', 'nothere', 'deep.md'));
  check('a path that does not exist on disk still finds its repo', b?.repo === repo && b?.rel === 'drafts/nothere/deep.md', JSON.stringify(b));
  check('a path outside any repo is null', locate(path.join(os.tmpdir(), 'no-repo-here-xyz', 'a.md')) === null);
  check('blobSha is git hash-object', blobSha(Buffer.from(CHAPTER)) === blob);
  for (const bad of ['--upload-pack=x', '-x', 'a..b', 'HEAD@{1}', 'a b', 'x;rm -rf', 'main:README.md', 'a^', '']) {
    let status = 0;
    try {
      await checkRef(bad, repo);
    } catch (err) {
      status = err.status;
    }
    check(`"${bad}" is refused with a 400`, status === 400, `got ${status}`);
  }
  check('a branch name passes', (await checkRef('feat/draft', repo)) === 'feat/draft');
  check('a short sha passes', (await checkRef(draftSha.slice(0, 9), repo)) === draftSha.slice(0, 9));
}

section('through the real server');
{
  const { createApp, listen } = await import(LIB('server.js'));
  const { boundPort } = await import('./helpers/net.mjs');
  const cfg = {
    port: 0,
    host: '127.0.0.1',
    token: 'test-token',
    workspaces: [],
    spaces: [],
    assetRoots: [repo],
    claudeSessions: false,
    advocates: { enabled: false, workspaces: [] },
    ntfy: {},
  };
  const app = createApp(cfg);
  const servers = listen(cfg, app.handler);
  const port = await boundPort(servers);
  const get = (p, ref) =>
    fetch(`http://127.0.0.1:${port}/api/asset?p=${encodeURIComponent(p)}${ref == null ? '' : `&ref=${encodeURIComponent(ref)}`}`, {
      headers: { 'x-beadcause-token': cfg.token },
    });
  try {
    let res = await get(path.join(wt, 'drafts', 'CHAPTER_25.md'), 'feat/draft');
    let text = await res.text();
    check('the retired worktree path reads at its branch', res.status === 200 && text === CHAPTER, `${res.status} ${text.slice(0, 120)}`);
    check('X-Blob-Sha is the blob git names', res.headers.get('x-blob-sha') === blob, res.headers.get('x-blob-sha'));
    check('X-Doc-Ref is the ref asked for', res.headers.get('x-doc-ref') === 'feat/draft');
    check('as markdown', /text\/markdown/.test(res.headers.get('content-type') || ''));

    res = await get(path.join(repo, 'drafts', 'CHAPTER_25.md'), 'feat/draft');
    check('the main checkout path reads a file that is only on the branch', res.status === 200 && (await res.text()) === CHAPTER);

    res = await get(path.join(repo, 'drafts', 'CHAPTER_25.md'), 'pushed');
    await res.arrayBuffer();
    check('a branch with no local ref falls back to origin/<ref>', res.status === 200 && res.headers.get('x-doc-ref') === 'origin/pushed', `${res.status} ${res.headers.get('x-doc-ref')}`);

    res = await get(path.join(repo, 'drafts', 'CHAPTER_25.md'), draftSha.slice(0, 10));
    check('a short sha reads', res.status === 200 && (await res.text()) === CHAPTER);

    for (const bad of ['--output=/tmp/x', 'a..b', 'x;touch pwn', 'HEAD@{1}']) {
      res = await get(path.join(repo, 'drafts', 'CHAPTER_25.md'), bad);
      const body = await res.json().catch(() => ({}));
      check(`ref "${bad}" is a 400 with a sentence`, res.status === 400 && /not a git ref/.test(body.error || ''), `${res.status} ${JSON.stringify(body)}`);
    }

    res = await get(path.join(repo, 'drafts', 'CHAPTER_25.md'), 'no-such-branch');
    await res.arrayBuffer();
    check('an unknown ref is a 404', res.status === 404);

    res = await get(path.join(repo, 'drafts', 'CHAPTER_99.md'), 'feat/draft');
    await res.arrayBuffer();
    check('a file not on the ref is a 404', res.status === 404);

    res = await get(path.join(repo, 'drafts', 'run.sh'), 'feat/draft');
    await res.arrayBuffer();
    check('a type the plain route refuses is refused at a ref too (415)', res.status === 415, String(res.status));

    res = await get(path.join(other, 'x.md'), 'main');
    await res.arrayBuffer();
    check('a repo outside assetRoots is a 403 at a ref', res.status === 403, String(res.status));

    res = await get(path.join(repo, '..', 'other', 'x.md'), 'main');
    await res.arrayBuffer();
    check('and climbing out with .. is the same 403', res.status === 403, String(res.status));

    res = await get(path.join(repo, 'README.md'));
    const disk = await res.text();
    check('the plain disk read is unchanged', res.status === 200 && disk === '# main\n');
    check('and names its blob too', res.headers.get('x-blob-sha') === G(repo, 'hash-object', 'README.md'), res.headers.get('x-blob-sha'));
  } finally {
    for (const s of servers) s.close();
  }
}

section('the reader carries the ref');
{
  const src = fs.readFileSync(path.join(HERE, '..', 'public', 'doc.js'), 'utf8');
  check('assetUrl carries ref=', /const assetUrl = \(p\) => `\/api\/asset\?p=\$\{encodeURIComponent\(p\)\}\$\{refQ\}/.test(src));
  check('sibling links carry the ref and the bead', /a\.href = `\/doc\?p=\$\{encodeURIComponent\(abs\)\}\$\{carry\}`/.test(src));
  check('no Confluence publish of a branch copy', /if \(ref\) return;/.test(src));
  check('the blob and resolved ref are kept for the notes layer', /x-blob-sha/.test(src) && /x-doc-ref/.test(src));
}

cleanupTmp(tmp);
if (failures) {
  console.log(`\n\x1b[31m${failures} failed\x1b[0m`);
  process.exit(1);
}
console.log('\n\x1b[32mall passed\x1b[0m');
