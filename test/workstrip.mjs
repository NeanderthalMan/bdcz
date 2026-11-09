/**
 * Work's pipeline strip and health line (bc-qzng7.3), lifted out of public/app.js and run
 * against a board and a pull request list handed in here.
 *
 * Each effort card on Work says where its work has got to: ready → in a session → in
 * review → merged, not shipped → shipped. The first two come off the card's own tree and
 * the next two off the pull request board, matched to the tree by the beads each pull
 * request names. A live Mac's board is a `gh` sweep per repo that can time out on a busy
 * machine, so this is where the matching is held rather than a screenshot.
 *
 * The functions are lifted by their declarations, the same `lift` test/p0card.mjs uses:
 * a renamed function fails here by name rather than as a ReferenceError somewhere else.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
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

const APP = read('public/app.js');

/** A declaration out of app.js — see the same function in test/p0card.mjs. */
function lift(src, opener) {
  const at = src.indexOf(opener);
  assert.notEqual(at, -1, `public/app.js no longer declares \`${opener}\``);
  if (opener.startsWith('function') || opener.startsWith('async function')) {
    let depth = 0;
    for (let i = src.indexOf('{', at); i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (!depth) return src.slice(at, i + 1);
      }
    }
    throw new Error(`unbalanced braces after ${opener}`);
  }
  let depth = 0;
  for (let i = at; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`no statement end after ${opener}`);
}

/** The strip and the health line in a room of their own, over this board and these PRs. */
function room({ prs = [], work = null, space = 'all', workspace = 'all', spaces = [] } = {}) {
  const state = { space, workspace, spaces };
  const ctx = vm.createContext({ String, Number, Math, JSON, Array, Set, Date, state, PRS: prs });
  vm.runInContext(
    [
      lift(APP, 'const esc = ('),
      lift(APP, 'const spaceForWorkspace = ('),
      'const prRows = () => PRS;',
      'const api = () => Promise.reject(new Error("no network here"));',
      'const render = () => {};',
      lift(APP, 'const WORK_MS = '),
      lift(APP, 'const work = '),
      lift(APP, 'function workHealth()'),
      lift(APP, 'function workTrouble()'),
      lift(APP, 'function workHealthHtml()'),
      lift(APP, 'const SHIPPING_RUNGS = '),
      lift(APP, 'function workPipeline(c)'),
      lift(APP, 'function workStripHtml(c)'),
      'globalThis.out = { work, workPipeline, workStripHtml, workHealthHtml };',
    ].join('\n'),
    ctx
  );
  if (work) ctx.out.work.data = work;
  return ctx.out;
}

/** One PR row the way `prRows()` builds it, naming these beads. */
const pr = (number, stage, beads, workspace = 'w') => ({
  key: `pr:${workspace}#${number}`,
  workspace,
  pr: { number, stage, url: `https://example.test/pull/${number}`, beads: beads.map((id) => ({ id })) },
});

const CARD = {
  key: 'w/ep',
  workspace: 'w',
  id: 'ep',
  tree: [
    { id: 'ep.1', status: 'open' },
    { id: 'ep.2', status: 'open' },
    { id: 'ep.3', status: 'in_progress' },
    { id: 'ep.4', status: 'open', session: { pid: 12 } },
    { id: 'ep.5', status: 'closed' },
    { id: 'ep.6', status: 'closed' },
    { id: 'ep.7', status: 'closed' },
    { id: 'ep.8', status: 'blocked' },
  ],
};

console.log('\nthe pipeline strip on each effort');

check('ready and in-session come off the tree, and a blocked bead is neither', () => {
  const { workPipeline } = room();
  const p = workPipeline(CARD);
  assert.equal(p.ready, 2, 'ready is the open beads nobody has');
  // `in_progress`, or open with a live window on it — both are a session working it.
  assert.equal(p.session, 2);
  assert.equal(p.review.length, 0);
  assert.equal(p.merged.length, 0);
  assert.equal(p.shipped, 3);
});

check('a pull request naming a bead in the tree is that effort’s, at its rung', () => {
  const { workPipeline, workStripHtml } = room({
    prs: [pr(345, 'review', ['ep.3']), pr(351, 'merged', ['ep.6']), pr(9, 'review', ['other.1'])],
  });
  const p = workPipeline(CARD);
  assert.deepEqual(p.review.map((q) => q.pr.number), [345], 'a pull request on another effort was counted here');
  assert.deepEqual(p.merged.map((q) => q.pr.number), [351]);
  const html = workStripHtml(CARD);
  assert.match(html, /#345<\/a> in review/, 'the strip does not say which pull request is in review');
  assert.match(html, /#351<\/a> merged, not shipped/);
});

check('a closed bead whose code is merged but not live is not counted shipped', () => {
  // The whole of "merged-but-not-shipped is visible here": ep.6 closed when its pull
  // request merged, and until that deploys it is in the merged step, not the shipped one.
  const { workPipeline } = room({ prs: [pr(351, 'deployed', ['ep.6'])] });
  assert.equal(workPipeline(CARD).shipped, 2);
  const live = room({ prs: [pr(351, 'live', ['ep.6'])] });
  assert.equal(live.workPipeline(CARD).shipped, 3, 'a live pull request held its bead back');
});

check('the same number in another workspace is not this effort’s', () => {
  const { workPipeline } = room({ prs: [pr(345, 'review', ['ep.3'], 'elsewhere')] });
  assert.equal(workPipeline(CARD).review.length, 0);
});

check('more than two pull requests at a step are a count, not a row of numbers', () => {
  const { workStripHtml } = room({
    prs: [pr(1, 'review', ['ep.1']), pr(2, 'review', ['ep.2']), pr(3, 'review', ['ep.3'])],
  });
  assert.match(workStripHtml(CARD), />3 in review</);
});

check('an empty step is drawn dim rather than left out, so the strip keeps its shape', () => {
  const { workStripHtml } = room();
  const html = workStripHtml({ key: 'w/x', workspace: 'w', id: 'x', tree: [] });
  assert.equal((html.match(/class="work-step /g) || []).length, 5);
  assert.equal((html.match(/ none"/g) || []).length, 5);
});

console.log('\nthe health line');

const WORK = {
  workspaces: [
    { name: 'a', sessions: [{}, {}], counts: { ready: 10, blocked: 3 } },
    { name: 'b', sessions: [{}], counts: { ready: 5, blocked: 1 } },
  ],
  service: { ok: true },
  router: { ok: true },
};

check('one sentence: sessions running, ready and blocked, and a way to the details', () => {
  const { workHealthHtml } = room({ work: WORK });
  const html = workHealthHtml();
  assert.match(html, /3 sessions running · 15 ready · 4 blocked/);
  assert.match(html, /href="#advocates"/, 'nothing leads to the advocate console');
  assert.ok(!html.includes('work-health-trouble'), 'healthy plumbing was reported anyway');
});

check('it counts the space on screen, not every repo', () => {
  const spaces = [{ name: 'Work', workspaces: ['a'] }, { name: 'Home', workspaces: ['b'] }];
  const { workHealthHtml } = room({ work: WORK, space: 'Home', spaces });
  assert.match(workHealthHtml(), /1 session running · 5 ready · 1 blocked/);
});

check('the plumbing surfaces on its own only when it is wrong', () => {
  const { workHealthHtml } = room({
    work: { ...WORK, service: { ok: false, code: 'foreign-program' }, router: { ok: false, summary: 'serving an older build' } },
  });
  const html = workHealthHtml();
  assert.match(html, /class="work-health bad"/);
  assert.match(html, /hot-swap is not live \(foreign-program\)/);
  assert.match(html, /serving an older build/);
});

check('before the first answer it says it is asking, rather than three zeroes', () => {
  const { workHealthHtml } = room();
  assert.match(workHealthHtml(), /Asking the advocates/);
});

console.log(`\n${failures ? `\x1b[31m${failures} of ${ran} failed\x1b[0m` : `\x1b[32mall good\x1b[0m (${ran})`}\n`);
process.exit(failures ? 1 : 0);
