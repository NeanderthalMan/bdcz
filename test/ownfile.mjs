#!/usr/bin/env node
//
// b7e-ownfile — move a pre-split tool branch's own text into the tool's own files (bc-dgx7.189).
//
//   npm test
//   node test/ownfile.mjs
//
// The pure functions are proved on strings; then the whole command is run for real on a
// fabricated git repo shaped like a revive: commit 1 is the branch (section in README.md,
// paragraph at the end of lib/tooldecl.js), commit 2 is main's side taken over it (neither
// there, and the heading the section linked to has moved to another document). That is the
// bead's acceptance criterion run on a fixture: the section lands byte-for-byte in
// docs/b7e/<name>.md, links rewritten; the paragraph lands directly above @grant; the
// leftover copy in docs/b7e-tools.md is gone; a second run changes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';
import { commentBlocks, cutLines, grantParagraph, placeParagraph, rewriteLinks, sectionsFor } from '../lib/ownfile.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-ownfile');

let failures = 0;
let ran = 0;
const check = (name, fn) => {
  ran += 1;
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
};

console.log('\nb7e-ownfile — a pre-split branch\'s text goes to the tool\'s own files\n');

const DOC = [
  '# Chapter',
  '',
  '### Something else',
  '',
  'prose',
  '',
  '### What that other worktree is adding — `b7e-peek`',
  '',
  'Body, see [the anchor](#something-else) and [tools](b7e-tools.md#family).',
  '',
  '```',
  '### not a heading',
  '```',
  '',
  '#### a sub-section',
  '',
  'more',
  '',
  '### Next — `b7e-other`',
  '',
  'tail',
].join('\n');

check('sectionsFor finds the section, keeps its sub-sections and ignores fenced headings', () => {
  const [s] = sectionsFor(DOC, 'b7e-peek');
  assert.equal(s.text.split('\n')[0], '### What that other worktree is adding — `b7e-peek`');
  assert.ok(s.text.includes('#### a sub-section'));
  assert.ok(s.text.includes('### not a heading'));
  assert.ok(!s.text.includes('b7e-other'));
  assert.ok(!s.text.endsWith('\n'));
  assert.equal(sectionsFor(DOC, 'b7e-pee').length, 0);
});

check('cutLines removes a section and leaves one blank line between its neighbours', () => {
  const [s] = sectionsFor(DOC, 'b7e-peek');
  const out = cutLines(DOC, s.start, s.end);
  assert.ok(out.includes('prose\n\n### Next — `b7e-other`'));
  assert.ok(!out.includes('b7e-peek'));
});

check('rewriteLinks re-points a bare anchor and a relative path from the new home', () => {
  const r = rewriteLinks('see [a](#elsewhere) [b](../README.md#x) [c](#mine) [d](https://x.y/z#q)\n### Mine\n', {
    fromFile: 'docs/advocates.md',
    toFile: 'docs/b7e/b7e-peek.md',
    where: (s) => (s === 'elsewhere' ? 'docs/advocates.md' : null),
  });
  assert.ok(r.text.includes('[a](../advocates.md#elsewhere)'));
  assert.ok(r.text.includes('[b](../../README.md#x)'));
  assert.ok(r.text.includes('[c](#mine)'));
  assert.ok(r.text.includes('[d](https://x.y/z#q)'));
  assert.equal(r.rewritten, 2);
});

check('rewriteLinks reports an anchor it cannot find and leaves it as written', () => {
  const r = rewriteLinks('[a](#gone)', { fromFile: 'README.md', toFile: 'docs/b7e/b7e-x.md', where: () => null });
  assert.equal(r.text, '[a](#gone)');
  assert.deepEqual(r.unresolved, ['#gone']);
});

const OLD_DECL = [
  '  // Read-only by construction.',
  '  //   → Bash(b7e-def:*) — declared',
  '',
  '  // b7e-peek is deliberately NOT on this list. It reads a sibling worktree',
  '  // and says what it found.',
  '  //   → Bash(b7e-peek:*) — declared `@grant read` in bin/b7e-peek',
  '',
].join('\n');
const NEW_DECL = '  // Read-only by construction.\n  //   → Bash(b7e-def:*) — declared\n';

check('grantParagraph takes the comment block naming the tool and drops the arrow line', () => {
  assert.equal(
    grantParagraph(OLD_DECL, NEW_DECL, 'b7e-peek'),
    'b7e-peek is deliberately NOT on this list. It reads a sibling worktree\nand says what it found.'
  );
  assert.equal(grantParagraph(OLD_DECL, NEW_DECL, 'b7e-pee'), '');
  assert.equal(commentBlocks(OLD_DECL).length, 2);
});

const HEADER = '#!/usr/bin/env node\n/**\n * `b7e-peek` — look.\n *\n * @grant excluded\n */\nimport x from "y";\n';

check('placeParagraph puts it directly above @grant, once', () => {
  const r = placeParagraph(HEADER, 'b7e-peek is deliberately NOT on this list.\nSecond line.');
  assert.ok(r.src.includes(' *\n * b7e-peek is deliberately NOT on this list.\n * Second line.\n *\n * @grant excluded'));
  assert.equal(placeParagraph(r.src, 'b7e-peek is deliberately NOT on this list.\nSecond line.').skipped, 'already in the header');
  assert.match(placeParagraph('/** x */\n', 'p').skipped, /no @grant/);
});

/* ------------------------------------------------------------- the whole command */

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

const SECTION = [
  '### What that other worktree is adding — `b7e-peek`',
  '',
  'Body, see [the family](#a-family-heading) and [the readme](README.md#top).',
  '',
  '```',
  '$ b7e-peek x',
  '```',
].join('\n');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ownfile-'));
try {
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  // commit 1: the branch, pre-split
  put(root, 'README.md', `# Top\n\n## A family heading\n\nintro\n\n${SECTION}\n\n## After\n\nend\n`);
  put(root, 'docs/b7e-tools.md', `# Tools\n\nprose\n\n${SECTION}\n\n### Other — \`b7e-zzz\`\n\nz\n`);
  put(root, 'lib/tooldecl.js', OLD_DECL);
  put(root, 'bin/b7e-peek', HEADER);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'branch');
  // commit 2: main's side taken — the section and paragraph gone, the family heading moved,
  // and docs/b7e-tools.md still holding the stale copy.
  put(root, 'README.md', '# Top\n\nsummary\n\n## After\n\nend\n');
  put(root, 'docs/chapter.md', '# Chapter\n\n## A family heading\n\nintro\n');
  put(root, 'docs/b7e-tools.md', `# Tools\n\nprose\n\n${SECTION}\n\n### Other — \`b7e-zzz\`\n\nz\n`);
  put(root, 'lib/tooldecl.js', NEW_DECL);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'main side');

  const run = (...a) => spawnSync(process.execPath, [BIN, 'b7e-peek', '--dir', root, ...a], { encoding: 'utf8' });

  check('--dry-run prints the plan and writes nothing', () => {
    const r = run('--from', 'HEAD~1', '--dry-run');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /section '### What that other worktree is adding — `b7e-peek`' \(7 lines\) from README\.md:7-13 -> docs\/b7e\/b7e-peek\.md/);
    assert.equal(fs.existsSync(path.join(root, 'docs/b7e/b7e-peek.md')), false);
    assert.equal(git(root, 'status', '--short'), '');
  });

  const r = run('--from', 'HEAD~1');
  check('a real run moves the section byte-for-byte, with its links re-pointed', () => {
    const doc = fs.readFileSync(path.join(root, 'docs/b7e/b7e-peek.md'), 'utf8');
    const want = SECTION.replace('(#a-family-heading)', '(../chapter.md#a-family-heading)').replace('(README.md#top)', '(../../README.md#top)');
    assert.equal(doc, `${want}\n`);
    assert.match(r.stdout, /links rewritten: 2/);
  });
  check('the stale copy in the shared chapter is removed, its neighbour kept', () => {
    const tools = fs.readFileSync(path.join(root, 'docs/b7e-tools.md'), 'utf8');
    assert.ok(!tools.includes('b7e-peek'));
    assert.equal(tools, '# Tools\n\nprose\n\n### Other — `b7e-zzz`\n\nz\n');
    assert.match(r.stdout, /stale copy \(7 lines\) removed from docs\/b7e-tools\.md:5-11/);
  });
  check('the grant paragraph sits directly above the @grant line', () => {
    const bin = fs.readFileSync(path.join(root, 'bin/b7e-peek'), 'utf8');
    assert.ok(bin.includes(' *\n * b7e-peek is deliberately NOT on this list. It reads a sibling worktree\n * and says what it found.\n *\n * @grant excluded'));
    assert.match(r.stdout, /grant paragraph \(2 lines\) from lib\/tooldecl\.js -> bin\/b7e-peek header above @grant/);
  });
  check('a second run changes nothing', () => {
    const before = git(root, 'diff');
    const again = run('--from', 'HEAD~1');
    assert.equal(git(root, 'diff'), before);
    assert.match(again.stdout, /already has its section/);
    assert.match(again.stdout, /already in the header/);
  });
  check('a tool with no bin file is refused rather than half-moved', () => {
    const x = spawnSync(process.execPath, [BIN, 'b7e-nope', '--dir', root], { encoding: 'utf8' });
    assert.equal(x.status, 2);
    assert.match(x.stderr, /bin\/b7e-nope is not in this checkout/);
  });
} finally {
  cleanupTmp(root);
}

console.log(failures ? `\n\x1b[31m${failures} of ${ran} failed\x1b[0m\n` : `\n${ran} passed\n`);
process.exit(failures ? 1 : 0);
