#!/usr/bin/env node
//
// b7e-exhibit — put the exhibit on a card, with each path checked the way the phone will
// read it (bc-dgx7.166). A session audit found four sessions — dv-gr6.131, dv-gr6.36,
// dv-gr6.13, dv-5eu.70 — each linking a draft on a card by hand, four different ways, two of
// them reaching opposite conclusions about the same unmerged path.
//
//   npm test
//   node test/b7eexhibit.mjs
//
// Two halves. The first drives lib/exhibit.js against a real git repository and a real
// linked worktree built in a temp dir, because "exists in the main checkout now" and "is
// committed on this branch" are facts about git, and a fake of them would only test the
// fake. The second drives bin/b7e-exhibit as a subprocess against a stateful stub `bd`, the
// shape test/b7erecard.mjs uses, so the command's own readback is a real readback.
//
// What this suite exists to pin:
//   - a path under the worktree is written in the MAIN-CHECKOUT form, and the verdict says
//     which side of the merge it is on (live / after-merge) — the distinction dv-gr6.131 and
//     dv-gr6.36 resolved in opposite directions;
//   - a URL, an unservable extension and a relative path are each refused BEFORE any write,
//     with a distinct exit code — and "before any write" is asserted as zero `bd` calls;
//   - running the same call twice leaves the card byte-identical;
//   - --check reproduces the gates' findings and writes nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';
import { parseDecision, toQuestion } from '../lib/decision.js';
import {
  IMAGE_EXT,
  DOC_EXT,
  absoluteOf,
  auditCard,
  factsOf,
  insertUnder,
  judgePath,
  locate,
  makeContext,
  citedPaths,
  planExhibit,
  refusalFor,
  verdictOf,
} from '../lib/exhibit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'b7e-exhibit');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7eexhibit-')));
process.on('exit', () => removeTreeSync(tmp));

/* ------------------------------------------------------------------------- harness */

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(err.message).split('\n').slice(0, 14).join('\n       ')}`);
  }
};

/* ------------------------------------------------------- a real repo and a worktree */

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const put = (root, rel, text = 'x\n') => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

const MAIN = path.join(tmp, 'repo');
const WT = path.join(tmp, 'repo', '.claude', 'worktrees', 'feat');
const ELSEWHERE = path.join(tmp, 'elsewhere');
fs.mkdirSync(MAIN, { recursive: true });
git(MAIN, 'init', '-q', '-b', 'main');
put(MAIN, '.gitignore', '.claude/\ngen/\n');
put(MAIN, 'docs/landed.md', '# landed\n');
put(MAIN, 'docs/My Notes.md', '# spaces\n');
put(MAIN, 'art/lfs.png', 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n');
git(MAIN, 'add', '-A');
git(MAIN, 'commit', '-q', '-m', 'main');
git(MAIN, 'worktree', 'add', '-q', '-b', 'feat', WT);

// On the branch: committed, so after-merge.
put(WT, 'docs/branch-only.md', '# on the branch\n');
put(WT, 'ai/audits/AUDIT.md', '# audit\n');
put(WT, 'art/branch-lfs.png', 'version https://git-lfs.github.com/spec/v1\noid sha256:def\nsize 9\n');
put(WT, 'media/render.png.md', '---\nsidecar: true\n---\n');
git(WT, 'add', '-A');
git(WT, 'commit', '-q', '-m', 'branch work');
// In the worktree only: uncommitted, and gitignored.
put(WT, 'docs/wip.md', '# not committed\n');
put(WT, 'gen/render.png', 'png');
// Outside every checkout, under and not under the asset root.
put(ELSEWHERE, 'vault/notes.md', '# elsewhere\n');
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-b7eexhibit-out-'));
process.on('exit', () => removeTreeSync(OUTSIDE));
put(OUTSIDE, 'stray.md', '# stray\n');

const ctx = makeContext({ dir: WT, assetRoots: [tmp] });
const inMain = (rel) => path.join(MAIN, rel);
const inWt = (rel) => path.join(WT, rel);

console.log('\nb7e-exhibit — the context');

check('the context reads the main checkout and this branch, and the trunk as the base', () => {
  assert.equal(ctx.main, MAIN);
  assert.equal(ctx.here, WT);
  assert.equal(ctx.base, 'main');
});

check('outside a git checkout there is no main and no branch, and the base is empty', () => {
  const bare = makeContext({ dir: OUTSIDE });
  assert.equal(bare.main, null);
  assert.equal(bare.here, null);
  assert.equal(bare.base, '');
});

/* -------------------------------------------------------------- the string refusals */

console.log('\nb7e-exhibit — what is refused from the string alone');

check('a URL is refused as `url`, an artifact URL and a GitHub PR alike', () => {
  for (const u of ['https://claude.ai/artifact/abc', 'http://github.com/x/y/pull/3']) {
    assert.equal(refusalFor('docs', u).code, 'url', u);
  }
});

check('a beadcause route is refused as `route` — docUrl would wrap it as /doc?p=<route>', () => {
  for (const r of ['/v/delmar/briefs?b=x', '/doc?p=/a.md', '/api/asset?p=/a.png']) {
    assert.equal(refusalFor('docs', r).code, 'route', r);
  }
});

check('a relative path is refused as `relative`', () => {
  assert.equal(refusalFor('docs', 'ai-context/audits/X.md').code, 'relative');
  assert.equal(refusalFor('docs', './X.md').code, 'relative');
});

check('an extension /api/asset will not serve is refused as `unservable`, with the extension named', () => {
  const r = refusalFor('docs', '/abs/swatch.py');
  assert.equal(r.code, 'unservable');
  assert.match(r.why, /\.py/);
  assert.equal(refusalFor('docs', '/abs/Makefile').code, 'unservable');
});

check('a document under --image is refused as `not-an-image`; an image under docs is fine', () => {
  assert.equal(refusalFor('images', '/abs/X.md').code, 'not-an-image');
  assert.equal(refusalFor('docs', '/abs/X.png'), null);
});

check('a bare %-escape is refused as `encoded`, but a file:// URL is decoded and accepted', () => {
  assert.equal(refusalFor('docs', '/abs/My%20Notes.md').code, 'encoded');
  assert.equal(refusalFor('docs', 'file:///abs/My%20Notes.md'), null);
  assert.equal(absoluteOf('file:///abs/My%20Notes.md'), '/abs/My Notes.md');
});

check('a path with a real space in it is fine — no regex parses docs:', () => {
  assert.equal(refusalFor('docs', '/abs/novel/Delmar Book 3/CH1.md'), null);
});

check('an empty string is refused as `empty`', () => {
  assert.equal(refusalFor('docs', '   ').code, 'empty');
});

/* --------------------------------------------------------------------- the verdicts */

console.log('\nb7e-exhibit — the verdict per path');

const verdict = (kind, p) => judgePath(kind, p, ctx);

check('a file that is in the main checkout is `live`', () => {
  const j = verdict('docs', inMain('docs/landed.md'));
  assert.equal(j.verdict, 'live');
  assert.equal(j.ok, true);
  assert.equal(j.canonical, inMain('docs/landed.md'));
});

check('a path under this branch\'s worktree is written in the main-checkout form', () => {
  const j = verdict('docs', inWt('docs/landed.md'));
  assert.equal(j.canonical, inMain('docs/landed.md'));
  assert.equal(j.via, 'this branch');
});

check('a file committed on this branch and not in main is `after-merge`, from either spelling', () => {
  for (const p of [inWt('docs/branch-only.md'), inMain('docs/branch-only.md')]) {
    const j = verdict('docs', p);
    assert.equal(j.verdict, 'after-merge', p);
    assert.equal(j.ok, true);
    assert.equal(j.canonical, inMain('docs/branch-only.md'), 'always the form that will exist once merged');
    assert.equal(j.facts.atHead, true);
    assert.equal(j.facts.inMain, false);
  }
});

check('a file on disk in the worktree that is not committed is `uncommitted`, and not ok', () => {
  const j = verdict('docs', inWt('docs/wip.md'));
  assert.equal(j.verdict, 'uncommitted');
  assert.equal(j.ok, false);
  assert.match(j.why, /commit it/);
});

check('a gitignored render is `gitignored` — no merge will carry it to the checkout', () => {
  const j = verdict('images', inWt('gen/render.png'));
  assert.equal(j.verdict, 'gitignored');
  assert.equal(j.ok, false);
});

check('an LFS pointer is `stub` whether it is in main or only committed on the branch', () => {
  assert.equal(verdict('images', inMain('art/lfs.png')).verdict, 'stub');
  const onBranch = verdict('images', inWt('art/branch-lfs.png'));
  assert.equal(onBranch.verdict, 'stub');
  assert.match(onBranch.why, /pointer/);
});

check('a sidecar with no bytes beside it is `stub`', () => {
  const j = verdict('images', inWt('media/render.png'));
  assert.equal(j.verdict, 'stub');
  assert.match(j.why, /sidecar/);
});

check('a path that is nowhere is `missing`', () => {
  const j = verdict('docs', inWt('docs/never-written.md'));
  assert.equal(j.verdict, 'missing');
  assert.equal(j.ok, false);
});

check('a file outside the repo and under an asset root is `live`; outside every root it is `outside-roots`', () => {
  assert.equal(verdict('docs', path.join(ELSEWHERE, 'vault/notes.md')).verdict, 'live');
  assert.equal(verdict('docs', path.join(ELSEWHERE, 'vault/notes.md')).canonical, path.join(ELSEWHERE, 'vault/notes.md'));
  const out = verdict('docs', path.join(OUTSIDE, 'stray.md'));
  assert.equal(out.verdict, 'outside-roots');
  assert.equal(out.ok, false);
  assert.match(out.why, /403/);
});

check('a path with a space in it is judged as itself', () => {
  assert.equal(verdict('docs', inMain('docs/My Notes.md')).verdict, 'live');
});

check('a path under another worktree of the same repo is translated too, and says whose it was', () => {
  const l = locate(path.join(MAIN, '.claude', 'worktrees', 'other', 'docs', 'landed.md'), ctx);
  assert.equal(l.via, 'other');
  assert.equal(l.canonical, inMain('docs/landed.md'));
});

check('a path on the base ref that the main checkout has not advanced to is `after-merge`', () => {
  // The synthetic half: building this in git means parking the main checkout on a second
  // branch, and the rule under test is the order of the verdict, not git.
  const v = verdictOf({ inRoots: true, inMain: false, atHead: false, onBase: true, pointer: false, sidecar: false, ignored: false, onDisk: false }, { base: 'main' });
  assert.equal(v.verdict, 'after-merge');
  assert.match(v.why, /main/);
});

check('--at names the ref that counts as landed', () => {
  git(MAIN, 'branch', 'side', 'feat');
  const at = makeContext({ dir: WT, at: 'side', assetRoots: [tmp] });
  assert.equal(at.base, 'side');
  const f = factsOf(locate(inWt('docs/branch-only.md'), at), at);
  assert.equal(f.onBase, true, 'the file is on the ref that was named, though not on main');
  git(MAIN, 'branch', '-q', '-D', 'side');
});

check('a run from the main checkout itself has no worktree to translate and still tells live from missing', () => {
  const m = makeContext({ dir: MAIN, assetRoots: [tmp] });
  assert.equal(judgePath('docs', inMain('docs/landed.md'), m).verdict, 'live');
  assert.equal(judgePath('docs', inMain('docs/branch-only.md'), m).verdict, 'missing', 'main HEAD does not have it');
});

/* -------------------------------------------------------------------- the edit itself */

console.log('\nb7e-exhibit — editing the block');

const BLOCK = (extra = '') =>
  [
    '```decision',
    'question: Ship the palette?',
    extra,
    'options:',
    '  - id: ship',
    '    label: Ship it',
    '    response: "Ship the palette."',
    '    recommended: true',
    '  - id: hold',
    '    label: Hold it',
    '    response: "Hold the palette."',
    '```',
  ]
    .filter((l) => l !== '')
    .join('\n');

const bead = (over = {}) => ({ id: 'x-1', title: 'Palette', description: `Prose above.\n\n${BLOCK()}`, design: '', notes: '', labels: ['human'], ...over });
const ADD = { docs: [{ label: 'the audit', path: '/abs/AUDIT.md' }], images: ['/abs/swatch.png'], links: [{ label: 'PR #268', url: 'https://github.com/x/y/pull/268' }] };

check('a block with no exhibit keys gets docs, images and links appended, and parses back', () => {
  const plan = planExhibit(bead(), ADD);
  assert.equal(plan.mode, 'block');
  assert.equal(plan.field, 'description');
  const d = parseDecision(plan.after).decision;
  assert.deepEqual(d.docs, [{ label: 'the audit', path: '/abs/AUDIT.md' }]);
  assert.deepEqual(d.images, ['/abs/swatch.png']);
  assert.deepEqual(d.links, [{ label: 'PR #268', url: 'https://github.com/x/y/pull/268' }]);
  assert.equal(d.question, 'Ship the palette?', 'the question is untouched');
  assert.equal(d.options.length, 2);
});

check('everything outside the added lines comes back byte for byte', () => {
  const before = bead();
  const plan = planExhibit(before, ADD);
  const kept = plan.after.split('\n').filter((l) => before.description.split('\n').includes(l));
  assert.deepEqual(kept, before.description.split('\n'), 'every original line, in order');
  assert.ok(plan.after.startsWith('Prose above.\n\n```decision\nquestion: Ship the palette?\noptions:'));
});

check('an existing docs: list is extended in its own indent, and its comment is kept', () => {
  const b = bead({ description: `Prose.\n\n${BLOCK('docs:      # files on the Mac\n    - label: The draft\n      path: /abs/DRAFT.md')}` });
  const plan = planExhibit(b, { docs: [{ label: 'the audit', path: '/abs/AUDIT.md' }] });
  assert.match(plan.after, /docs: {6}# files on the Mac\n {4}- label: The draft\n {6}path: \/abs\/DRAFT\.md\n {4}- label: the audit\n {6}path: \/abs\/AUDIT\.md\noptions:/);
  assert.deepEqual(parseDecision(plan.after).decision.docs.map((d) => d.path), ['/abs/DRAFT.md', '/abs/AUDIT.md']);
});

check('a block in `design` is edited in place, not shadowed by a copy in another field', () => {
  const b = bead({ description: 'Just prose.', design: BLOCK() });
  const plan = planExhibit(b, ADD);
  assert.equal(plan.field, 'design');
  const after = { ...b, design: plan.after };
  assert.equal(toQuestion('ws', after).decision.docs.length, 1, 'the phone draws the block that was edited');
});

check('a label with a colon and a long path are written on one line, and read back whole', () => {
  const long = `/abs/${'deep/'.repeat(30)}FILE.md`;
  const plan = planExhibit(bead(), { docs: [{ label: 'Audit: the palette, section 2 — draft', path: long }] });
  assert.ok(!/\n\s{4,}[^\s-][^\n]*\n\s{4,}/.test(plan.after.split('options:')[0].split('docs:')[1]), 'not folded');
  const d = parseDecision(plan.after).decision.docs[0];
  assert.equal(d.path, long);
  assert.equal(d.label, 'Audit: the palette, section 2 — draft');
});

check('a path with a space is written plain and read back the same', () => {
  const p = '/abs/novel/Delmar Book 3/CH1.md';
  const plan = planExhibit(bead(), { docs: [{ label: 'CH1', path: p }] });
  assert.equal(parseDecision(plan.after).decision.docs[0].path, p);
});

check('a second plan over the result is null — the card is already carrying all of it', () => {
  const first = planExhibit(bead(), ADD);
  assert.equal(planExhibit(bead({ description: first.after }), ADD), null);
});

check('only what is new is added, and the same path under docs and images is one exhibit', () => {
  const first = planExhibit(bead(), { docs: [{ label: 'a', path: '/abs/A.md' }] });
  const second = planExhibit(bead({ description: first.after }), { docs: [{ label: 'a', path: '/abs/A.md' }, { label: 'b', path: '/abs/B.md' }] });
  assert.equal(second.count, 1);
  assert.deepEqual(parseDecision(second.after).decision.docs.map((d) => d.path), ['/abs/A.md', '/abs/B.md']);
});

check('docs: written inline cannot be extended, and says so with a code', () => {
  const b = bead({ description: BLOCK('docs: [/abs/A.md]') });
  assert.throws(() => planExhibit(b, ADD), (e) => e.code === 'inline' && /inline/.test(e.message));
});

check('a card with no decision block gets an **Up for review** list on its description', () => {
  const b = bead({ description: 'A plain card asking about a draft.' });
  const plan = planExhibit(b, ADD);
  assert.equal(plan.mode, 'section');
  assert.equal(plan.field, 'description');
  assert.match(plan.after, /^A plain card asking about a draft\.\n\n\*\*Up for review\*\*\n\n- \[the audit\]\(\/abs\/AUDIT\.md\)\n- \[swatch\.png\]\(\/abs\/swatch\.png\)\n- \[PR #268\]\(https:\/\/github\.com\/x\/y\/pull\/268\)$/);
  assert.equal(planExhibit(bead({ description: plan.after }), ADD), null, 'and it is idempotent');
});

check('a prose link to a path with a space is written as file:// with %20 — the one spelling that survives', () => {
  const plan = planExhibit(bead({ description: 'Plain.' }), { docs: [{ label: 'CH1', path: '/abs/Delmar Book 3/CH1.md' }] });
  assert.match(plan.after, /\]\(file:\/\/\/abs\/Delmar%20Book%203\/CH1\.md\)/);
});

check('an existing **Up for review** section is extended rather than repeated', () => {
  const first = planExhibit(bead({ description: 'Plain.' }), { docs: [{ label: 'a', path: '/abs/A.md' }] });
  const second = planExhibit(bead({ description: first.after }), { docs: [{ label: 'b', path: '/abs/B.md' }] });
  assert.equal(second.after.match(/\*\*Up for review\*\*/g).length, 1);
  assert.match(second.after, /\[a\]\(\/abs\/A\.md\)\n- \[b\]\(\/abs\/B\.md\)$/);
});

check('insertUnder leaves the text alone when there is nothing to add', () => {
  assert.equal(insertUnder('question: x\n', 'docs', []), 'question: x\n');
});

/* ------------------------------------------------------------------- the card audit */

console.log('\nb7e-exhibit — auditing what a card already links');

const audit = (b) => auditCard(b, ctx);
const rowsOf = (b) => audit(b).rows.map((r) => [r.kind, r.verdict]);

check('an artifact URL in docs: is `url`, and a beadcause route is `route` — the two dead links the sweep found', () => {
  const b = bead({ description: BLOCK('docs:\n  - label: art\n    path: https://claude.ai/artifact/x\n  - label: brief\n    path: /v/delmar/briefs?b=x') });
  assert.deepEqual(rowsOf(b), [['docs', 'url'], ['docs', 'route']]);
  assert.equal(audit(b).ok, false);
});

check('a relative path, an unservable one and a missing one each get their own verdict', () => {
  const b = bead({ description: BLOCK(`docs:\n  - label: a\n    path: novel/CH1.md\n  - label: b\n    path: ${inMain('docs/x.py')}\n  - label: c\n    path: ${inMain('docs/gone.md')}`) });
  assert.deepEqual(rowsOf(b), [['docs', 'relative'], ['docs', 'unservable'], ['docs', 'missing']]);
});

check('a path into a worktree is `worktree` and names the main-checkout form to use instead', () => {
  const b = bead({ description: BLOCK(`docs:\n  - label: a\n    path: ${inWt('docs/branch-only.md')}`) });
  const [row] = audit(b).rows;
  assert.equal(row.verdict, 'worktree');
  assert.equal(row.ok, false);
  assert.ok(row.why.includes(inMain('docs/branch-only.md')), row.why);
});

check('the main-checkout form of an unmerged path is `after-merge` and passes the audit', () => {
  const b = bead({ description: BLOCK(`docs:\n  - label: a\n    path: ${inMain('docs/branch-only.md')}`) });
  assert.deepEqual(rowsOf(b), [['docs', 'after-merge']]);
  assert.equal(audit(b).ok, true);
});

check('a live doc, a live image and a URL link are all fine', () => {
  const b = bead({ description: BLOCK(`docs:\n  - label: a\n    path: ${inMain('docs/landed.md')}\nimages:\n  - ${path.join(ELSEWHERE, 'vault/notes.md')}\nlinks:\n  - label: pr\n    url: https://github.com/x/y/pull/1`) });
  const a = audit(b);
  assert.equal(a.ok, false, 'the second is a .md under images:');
  assert.deepEqual(a.rows.map((r) => r.verdict), ['live', 'not-an-image', 'link']);
});

check('a markdown link in prose is judged like a docs entry; one with a space in the path is `spaced-link`', () => {
  const b = bead({ description: `See [the draft](${inMain('docs/landed.md')}) and [the other](/abs/Book 3/CH1.md).\n\n${BLOCK()}` });
  assert.deepEqual(rowsOf(b), [['prose', 'live'], ['prose-spaced', 'spaced-link']]);
});

check('a needs-approval card that links nothing is `unlinked`', () => {
  const a = audit(bead({ description: 'Approve it?', labels: ['human', 'needs-approval'] }));
  assert.deepEqual(a.rows.map((r) => r.verdict), ['unlinked']);
  assert.equal(a.ok, false);
});

check('a card that names a file that is in the main checkout and links nothing is `dead-path`; one naming a file that is not is only a warning', () => {
  const named = audit(bead({ description: 'The audit is at docs/landed.md — please read it.' }));
  assert.deepEqual(named.rows.map((r) => r.verdict), ['dead-path']);
  const cited = audit(bead({ description: 'It is drafted in docs/not-there.md.' }));
  assert.deepEqual(cited.rows, []);
  assert.equal(cited.ok, true);
  assert.match(cited.warnings[0], /docs\/not-there\.md/);
});

check('an absolute path named in prose, spaces and all, is `dead-path` when the file is in the main checkout', () => {
  const b = bead({ description: `The audit is at ${inMain('docs/My Notes.md')} — please read it.` });
  // tmp is not under /Users, so the absolute-path reading is exercised through citedPaths.
  assert.deepEqual(citedPaths('at /Users/a/Delmar Book 1/CH 17.summary.md, then ~/n/y.png.'), ['/Users/a/Delmar Book 1/CH 17.summary.md', path.join(os.homedir(), 'n/y.png')]);
  assert.deepEqual(audit(b).rows, [], 'a /var path is not a Users path — only the shape is claimed');
});

check('linking one file does not link another the prose also names — the finding is per file', () => {
  const b = bead({ description: `Read docs/landed.md and docs/My Notes.md.\n\n${BLOCK(`docs:\n  - label: a\n    path: ${inMain('docs/landed.md')}`)}` });
  const a = audit(b);
  assert.deepEqual(a.rows.map((r) => [r.verdict, r.raw === inMain('docs/landed.md') ? 'docs' : r.raw]), [['live', 'docs']]);
});

check('a spaced markdown link is one finding, not two', () => {
  const b = bead({ description: 'See [the draft](/Users/x/Book 3/CH1.md).' });
  assert.deepEqual(audit(b).rows.map((r) => r.verdict), ['spaced-link']);
});

check('a question with nothing to show and nothing named is not a finding — plenty of questions are pure invention', () => {
  const a = audit(bead({ description: 'Which animals does she see from the terrace?' }));
  assert.deepEqual(a.rows, []);
  assert.deepEqual(a.warnings, []);
  assert.equal(a.ok, true);
});

check('a block that is not valid YAML is reported rather than silently read as empty', () => {
  const a = audit(bead({ description: '```decision\nquestion: [unclosed\n```' }));
  assert.match(a.warnings.join(' '), /not valid YAML/);
});

/* -------------------------------------------------- the mirror of what the daemon serves */

console.log('\nb7e-exhibit — the servable lists');

check('IMAGE_EXT and DOC_EXT are the lists lib/server.js serves, exactly', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'server.js'), 'utf8');
  const listOf = (name) => {
    const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\];`));
    assert.ok(m, `${name} not found in lib/server.js`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };
  assert.deepEqual(IMAGE_EXT, listOf('IMAGE_EXT'));
  assert.deepEqual(DOC_EXT, listOf('DOC_EXT'));
});

/* -------------------------------------------------------- the command, as a subprocess */

console.log('\nb7e-exhibit — the command');

const FAKE_BD = path.join(tmp, 'bd');
const CALLS = path.join(tmp, 'calls.jsonl');

fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dir = process.env.BEADS_DIR;
const world = path.join(dir, 'world.json');
const raw = process.argv.slice(2);
const args = [];
for (let i = 0; i < raw.length; i += 1) {
  if (raw[i] === '--actor') { i += 1; continue; }
  args.push(raw[i]);
}
fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify({ args, dir }) + '\\n');
const read = () => JSON.parse(fs.readFileSync(world, 'utf8'));
const write = (w) => fs.writeFileSync(world, JSON.stringify(w, null, 2));
const die = (m) => { process.stderr.write(m + '\\n'); process.exit(1); };
const verb = args[0];
const rest = args.slice(1);

if (verb === 'show') {
  const w = read();
  const ids = rest.filter((a) => a !== '--json');
  const rows = [];
  for (const id of ids) {
    const issue = w.issues[id];
    if (!issue) die('Error fetching ' + id + ': no issue found matching "' + id + '"');
    rows.push({ ...issue });
  }
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}

if (verb === 'list') {
  const w = read();
  // bd list rows carry neither design nor notes — the reason a sweep has to show each card.
  const rows = Object.values(w.issues).filter((i) => i.status === 'open').map(({ design, notes, ...rest }) => rest);
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}

if (verb === 'update') {
  const w = read();
  const id = rest[0];
  if (!w.issues[id]) die('no issue found matching "' + id + '"');
  const FIELD = { '--description': 'description', '--design': 'design', '--notes': 'notes' };
  for (let i = 1; i < rest.length; i += 1) {
    const f = FIELD[rest[i]];
    if (!f) die('stub bd: unexpected update flag "' + rest[i] + '"');
    if (!w.refuseWrites) w.issues[id][f] = rest[i + 1];
    i += 1;
  }
  write(w);
  process.exit(0);
}

if (verb === 'dep') { process.stdout.write('[]'); process.exit(0); }

die('stub bd: unexpected verb "' + verb + '"');
`,
  { mode: 0o755 }
);

const issue = (id, over = {}) => ({
  id,
  title: `Card ${id}`,
  description: `Prose above the question.\n\n${BLOCK()}`,
  design: '',
  notes: '',
  status: 'open',
  issue_type: 'task',
  priority: 1,
  labels: ['human'],
  acceptance_criteria: '',
  dependencies: [],
  ...over,
});

let wsSeq = 0;
function freshWs(issues) {
  wsSeq += 1;
  const name = `exhibit-ws-${wsSeq}`;
  const dir = path.join(tmp, 'beads', name);
  fs.mkdirSync(dir, { recursive: true });
  const world = { refuseWrites: false, issues: Object.fromEntries(issues.map((i) => [i.id, i])) };
  fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify(world, null, 2));
  const configDir = path.join(tmp, 'config', name);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ bdBin: FAKE_BD, actor: 'beadcause-test', assetRoots: [tmp], workspaces: [{ name, dir }] }, null, 2)
  );
  return { name, dir, configDir };
}
const worldOf = (ws) => JSON.parse(fs.readFileSync(path.join(ws.dir, 'world.json'), 'utf8'));
const setWorld = (ws, fn) => {
  const w = worldOf(ws);
  fn(w);
  fs.writeFileSync(path.join(ws.dir, 'world.json'), JSON.stringify(w, null, 2));
};

function run(ws, args, { cwd = WT } = {}) {
  const res = spawnSync(process.execPath, [BIN, '-w', ws.name, ...args], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, HOME: tmp, BEADCAUSE_CONFIG_DIR: ws.configDir },
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}
const calls = () => (fs.existsSync(CALLS) ? fs.readFileSync(CALLS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).args) : []);
const writesSoFar = () => calls().filter((a) => a[0] === 'update').length;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

check('a URL, an unservable extension and a relative path are refused with 3, 4 and 5 — before a single bd call', () => {
  const ws = freshWs([issue('e-1')]);
  const before = calls().length;
  const url = run(ws, ['-b', 'e-1', '--doc', 'https://claude.ai/artifact/abc']);
  const py = run(ws, ['-b', 'e-1', '--doc', inMain('docs/swatch.py')]);
  const rel = run(ws, ['-b', 'e-1', '--doc', 'ai-context/audits/X.md']);
  assert.equal(url.status, 3, url.stderr);
  assert.equal(py.status, 4, py.stderr);
  assert.equal(rel.status, 5, rel.stderr);
  assert.match(url.stderr, /URL/);
  assert.match(py.stderr, /\.py/);
  assert.match(rel.stderr, /relative/);
  assert.equal(calls().length, before, 'no tracker call at all — the refusal is before any read or write');
  assert.equal(worldOf(ws).issues['e-1'].description, issue('e-1').description);
});

check('a path that can never open (missing, uncommitted, gitignored, stub) is refused with 6 and writes nothing', () => {
  const ws = freshWs([issue('e-1')]);
  const start = writesSoFar();
  for (const p of [inWt('docs/never.md'), inWt('docs/wip.md'), inWt('gen/render.png'), inWt('art/branch-lfs.png')]) {
    const flag = p.endsWith('.png') ? '--image' : '--doc';
    const r = run(ws, ['-b', 'e-1', flag, p]);
    assert.equal(r.status, 6, `${p}\n${r.stdout}${r.stderr}`);
  }
  assert.equal(writesSoFar(), start);
  assert.equal(worldOf(ws).issues['e-1'].description, issue('e-1').description);
});

check('one bad path among good ones refuses the lot — a half-written card is worse than none', () => {
  const ws = freshWs([issue('e-1')]);
  const r = run(ws, ['-b', 'e-1', '--doc', inWt('docs/branch-only.md'), '--doc', inWt('docs/never.md')]);
  assert.equal(r.status, 6);
  assert.equal(worldOf(ws).issues['e-1'].description, issue('e-1').description);
});

check('an unmerged path from the worktree is written as the main-checkout form and reported after-merge', () => {
  const ws = freshWs([issue('e-1')]);
  const r = run(ws, ['-b', 'e-1', '--doc', inWt('ai/audits/AUDIT.md'), '--label', 'the audit behind this card']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = strip(r.stdout);
  assert.match(out, /after-merge/);
  assert.ok(out.includes(`${inWt('ai/audits/AUDIT.md')}  →  ${inMain('ai/audits/AUDIT.md')}`), out);
  assert.match(out, /will say missing until this branch merges/);
  const desc = worldOf(ws).issues['e-1'].description;
  assert.ok(!desc.includes('.claude/worktrees'), 'no worktree path ever reaches the card');
  const d = parseDecision(desc).decision;
  assert.deepEqual(d.docs, [{ label: 'the audit behind this card', path: inMain('ai/audits/AUDIT.md') }]);
  assert.match(out, /readback: 1 entry on e-1, in description/);
});

check('running the same call twice leaves the card byte-identical, with no second write', () => {
  const ws = freshWs([issue('e-1')]);
  const args = ['-b', 'e-1', '--doc', inWt('ai/audits/AUDIT.md'), '--doc', inMain('docs/landed.md'), '--link', 'PR #268=https://github.com/x/y/pull/268'];
  const first = run(ws, args);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const after = JSON.stringify(worldOf(ws).issues['e-1']);
  const start = writesSoFar();
  const second = run(ws, args);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(JSON.stringify(worldOf(ws).issues['e-1']), after);
  assert.equal(writesSoFar(), start, 'no update was issued the second time');
  assert.match(strip(second.stdout), /nothing to write/);
});

check('an image and a link go on the card too, and live is reported for what is already in main', () => {
  const ws = freshWs([issue('e-1')]);
  const r = run(ws, ['-b', 'e-1', '--image', inMain('docs/landed.md'.replace('.md', '.png')) + '']);
  assert.equal(r.status, 6, 'an image that is not there is refused, not guessed at');
  put(MAIN, 'art/swatch.png', 'png');
  const ok = run(ws, ['-b', 'e-1', '--image', inMain('art/swatch.png'), '--link', 'the PR=https://github.com/x/y/pull/9']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(strip(ok.stdout), /live/);
  const d = parseDecision(worldOf(ws).issues['e-1'].description).decision;
  assert.deepEqual(d.images, [inMain('art/swatch.png')]);
  assert.deepEqual(d.links, [{ label: 'the PR', url: 'https://github.com/x/y/pull/9' }]);
  fs.rmSync(inMain('art/swatch.png'));
});

check('a card with no decision block gets an **Up for review** section', () => {
  const ws = freshWs([issue('e-1', { description: 'A plain card.' })]);
  const r = run(ws, ['-b', 'e-1', '--doc', inWt('docs/branch-only.md')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(worldOf(ws).issues['e-1'].description, `A plain card.\n\n**Up for review**\n\n- [branch-only.md](${inMain('docs/branch-only.md')})`);
  assert.match(strip(r.stdout), /under \*\*Up for review\*\*/);
});

check('a block in `design` is edited where it is, and the description is left alone', () => {
  const ws = freshWs([issue('e-1', { description: 'Prose only.', design: BLOCK() })]);
  const r = run(ws, ['-b', 'e-1', '--doc', inWt('docs/branch-only.md')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const got = worldOf(ws).issues['e-1'];
  assert.equal(got.description, 'Prose only.');
  assert.equal(parseDecision(got.design).decision.docs.length, 1);
  assert.match(strip(r.stdout), /in design/);
});

check('docs: written inline cannot be edited in place — exit 8, and nothing is written', () => {
  const ws = freshWs([issue('e-1', { description: BLOCK('docs: [/abs/A.md]') })]);
  const start = writesSoFar();
  const r = run(ws, ['-b', 'e-1', '--doc', inWt('docs/branch-only.md')]);
  assert.equal(r.status, 8, r.stdout + r.stderr);
  assert.equal(writesSoFar(), start);
});

check('a write that silently does not land is caught by the readback, exit 7', () => {
  const ws = freshWs([issue('e-1')]);
  setWorld(ws, (w) => { w.refuseWrites = true; });
  const r = run(ws, ['-b', 'e-1', '--doc', inWt('docs/branch-only.md')]);
  assert.equal(r.status, 7, r.stdout + r.stderr);
  assert.match(strip(r.stdout), /the readback disagrees/);
});

check('--dry-run and --json write nothing and print the verdicts', () => {
  const ws = freshWs([issue('e-1')]);
  const start = writesSoFar();
  const r = run(ws, ['-b', 'e-1', '--doc', inWt('docs/branch-only.md'), '--dry-run', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.dryRun, true);
  assert.equal(j.written, false);
  assert.deepEqual(j.paths, [{ path: inMain('docs/branch-only.md'), verdict: 'after-merge' }]);
  assert.equal(writesSoFar(), start);
});

check('an unknown workspace or bead is exit 1, and usage mistakes are exit 1 before any tracker call', () => {
  const ws = freshWs([issue('e-1')]);
  assert.equal(run({ ...ws, name: 'nope' }, ['-b', 'e-1', '--doc', inWt('docs/branch-only.md')]).status, 1);
  assert.equal(run(ws, ['-b', 'no-such', '--doc', inWt('docs/branch-only.md')]).status, 1);
  assert.equal(run(ws, ['--doc', inWt('docs/branch-only.md')]).status, 1, 'no -b');
  assert.equal(run(ws, ['-b', 'e-1']).status, 1, 'nothing to put on the card');
  assert.equal(run(ws, ['-b', 'e-1', '--check', '--doc', inWt('docs/branch-only.md')]).status, 1, '--check takes no exhibits');
  assert.equal(run(ws, ['-b', 'e-1', '--link', 'no-equals-sign']).status, 1);
  assert.equal(run(ws, ['-b', 'e-1', '--label', 'x']).status, 1, '--label with no --doc');
});

check('--help prints the usage and touches nothing', () => {
  const res = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8', cwd: WT, env: { ...process.env, BEADCAUSE_CONFIG_DIR: path.join(tmp, 'nowhere') } });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /usage: b7e-exhibit/);
});

/* ----------------------------------------------------------------------- --check */

check('--check on one card reports each exhibit, writes nothing, and exits 2 when one is dead', () => {
  const ws = freshWs([
    issue('e-1', { description: BLOCK(`docs:\n  - label: art\n    path: https://claude.ai/artifact/x\n  - label: ok\n    path: ${inMain('docs/landed.md')}\n  - label: wt\n    path: ${inWt('docs/branch-only.md')}`) }),
  ]);
  const start = writesSoFar();
  const r = run(ws, ['-b', 'e-1', '--check']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const out = strip(r.stdout);
  assert.match(out, /url\s+docs\s+https:\/\/claude\.ai/);
  assert.match(out, /live\s+docs/);
  assert.match(out, /worktree\s+docs/);
  assert.match(out, /FAILED/);
  assert.equal(writesSoFar(), start, '--check never writes');
});

check('--check on a clean card passes, and an unmerged path in main-checkout form is not a failure', () => {
  const ws = freshWs([issue('e-1', { description: BLOCK(`docs:\n  - label: a\n    path: ${inMain('docs/branch-only.md')}`) })]);
  const r = run(ws, ['-b', 'e-1', '--check']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(strip(r.stdout), /after-merge/);
  assert.match(strip(r.stdout), /PASS/);
});

check('--check with no -b walks every open card of type decision or labelled human, reading each one whole', () => {
  const ws = freshWs([
    issue('c-1', { description: BLOCK(`docs:\n  - label: bad\n    path: novel/CH1.md`) }),
    issue('c-2', { description: BLOCK(), design: '', labels: ['human'] }),
    issue('c-3', { description: 'A decision.', issue_type: 'decision', labels: [], design: BLOCK(`docs:\n  - label: bad\n    path: ${inMain('docs/gone.md')}`) }),
    issue('c-4', { description: 'Not a card at all: docs/landed.md', issue_type: 'task', labels: [] }),
    issue('c-5', { status: 'closed', description: BLOCK(`docs:\n  - label: bad\n    path: novel/CH1.md`) }),
  ]);
  const r = run(ws, ['--check', '--json']);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.cards.map((c) => c.id).sort(), ['c-1', 'c-2', 'c-3'], 'closed and non-card beads are not audited');
  assert.equal(j.cards.find((c) => c.id === 'c-1').rows[0].verdict, 'relative');
  assert.equal(j.cards.find((c) => c.id === 'c-3').rows[0].verdict, 'missing', 'the block in design was read, not just the description');
  assert.ok(calls().some((a) => a[0] === 'show' && a.length > 2), 'the cards were read in one batched show, not one spawn each');
});

check('--check with no card at all in the workspace passes', () => {
  const ws = freshWs([issue('t-1', { issue_type: 'task', labels: [] })]);
  const r = run(ws, ['--check']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(strip(r.stdout), /0 cards/);
});

/* ---------------------------------------------------- how the command is put together */

console.log('\nb7e-exhibit — registration and wiring');

const src = fs.readFileSync(BIN, 'utf8');

check('the Bd is built from the config fields, and no bd call is handed a workspace name', () => {
  assert.match(src, /new Bd\(\{\s*bin: cfg\.bdBin/);
  assert.ok(!/bd\.(show|update|run|json|listStatus)\(workspace\b/.test(src));
  assert.ok(!/bd\.\w+\(\s*wsName\b/.test(src), 'the workspace OBJECT, not its name');
});

check('it is extensionless, executable, and registered under its own name in package.json and the lock', () => {
  assert.ok(fs.statSync(BIN).mode & 0o111, 'chmod +x');
  assert.match(src, /^#!\/usr\/bin\/env node\n/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.bin['b7e-exhibit'], 'bin/b7e-exhibit');
  assert.equal(lock.packages[''].bin['b7e-exhibit'], 'bin/b7e-exhibit');
});

check('it declares itself off the default allowlist — it writes to the tracker', () => {
  assert.match(src, /^ \* @grant excluded$/m);
});

console.log('');
if (failures) {
  console.log(`b7e-exhibit: ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('b7e-exhibit: all checks passed\n');
