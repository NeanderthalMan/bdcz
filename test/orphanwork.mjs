#!/usr/bin/env node
/**
 * The worktrees holding uncommitted work nobody committed — lib/orphanwork.js.
 *
 *     npm test
 *     node test/orphanwork.mjs
 *
 * bc-iaju1.12 measured 26 dirty worktrees of 105 on one checkout, each a dead session's
 * whole diff, and nothing that named any of them. Six things are worth asserting, in
 * descending order of what getting them wrong would cost:
 *
 * 1. **A worktree somebody is in is never named.** A live session's cwd, and a lock whose
 *    pid is still running, both protect it. A lock whose pid is *dead* does not — that is
 *    the dead attempt this exists to find.
 * 2. **Nothing is deleted, moved, committed or cleaned.** The licence is to write one
 *    bead. The checkout is compared before and after, file by file.
 * 3. **One card, not one per worktree.** Twenty-six cards is the attention load this is
 *    meant to reduce. A second sweep over the same census writes nothing at all.
 * 4. **The card stays true.** It is rewritten when the census moves, closed when it is
 *    empty, and left alone when it has been answered and a session is working it.
 * 5. **An answered card is not re-asked.** "Let them go" must hold for the worktrees it
 *    listed — and only for those: a new one is news.
 * 6. **The card parses**, with two options, salvage recommended and not closing.
 *
 * The git repo is real and thrown away, and `bd` is an object that records what it was
 * asked to write. Nothing here reaches a tracker, GitHub, iTerm or a repo of yours.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTreeSync } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (f) => path.join(HERE, '..', 'lib', f);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-orphanwork-'));
process.on('exit', () => removeTreeSync(tmp));

// Before the first import that reaches lib/config.js, which fixes CONFIG_DIR at module
// load: nothing here may read or write the config directory this Mac actually runs from.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const REPO = path.join(tmp, 'repo');
fs.mkdirSync(REPO, { recursive: true });

/* ------------------------------------------------------------------ harness */

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
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

/* ---------------------------------------------------------------- the repo */

const DAY = 86400000;
const OLD = new Date(Date.now() - 30 * DAY).toISOString();

const gitIn = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: OLD, GIT_COMMITTER_DATE: OLD },
  }).trim();
const git = (...args) => gitIn(REPO, ...args);

execFileSync('git', ['-C', REPO, '-c', 'init.defaultBranch=main', 'init', '-q'], { encoding: 'utf8' });
for (const f of ['a.js', 'b.js', 'c.js']) fs.writeFileSync(path.join(REPO, f), `// ${f}\n`);
git('add', '.');
git('commit', '-q', '-m', 'base');

const WT = path.join(REPO, '.claude', 'worktrees');
fs.mkdirSync(WT, { recursive: true });

/** A worktree cut from main, `name` under `.claude/worktrees/`. */
const worktree = (name) => {
  const dir = path.join(WT, name);
  git('worktree', 'add', '-q', '-b', `worktree-${name}`, dir, 'main');
  return dir;
};

/** Dirty `dir` with `modified` tracked edits and `added` new files, all `ageDays` old. */
const dirty = (dir, { modified = 0, added = 0, ageDays = 10 } = {}) => {
  const at = new Date(Date.now() - ageDays * DAY);
  const touched = [];
  for (let i = 0; i < modified; i++) {
    const f = path.join(dir, ['a.js', 'b.js', 'c.js'][i]);
    fs.appendFileSync(f, `// edit ${i}\n`);
    touched.push(f);
  }
  for (let i = 0; i < added; i++) {
    const f = path.join(dir, `new${i}.js`);
    fs.writeFileSync(f, `// new ${i}\n`);
    touched.push(f);
  }
  for (const f of touched) fs.utimesSync(f, at, at);
};

const ME = process.pid;
const DEAD_PID = 2 ** 22 + 12345; // above any pid this Mac hands out
const isLive = (pid) => pid === ME;

// The one this is for: a dead attempt, biggest diff.
const deadBig = worktree('reap-teardown-race-3qsw');
dirty(deadBig, { modified: 3, added: 4, ageDays: 40 });
// A second, smaller.
const deadSmall = worktree('window-budget-29b3');
dirty(deadSmall, { added: 1, ageDays: 12 });
// Dirty but touched an hour ago: somebody may be editing it by absolute path.
const fresh = worktree('fresh-edit-aaa');
dirty(fresh, { modified: 1, ageDays: 0.04 });
// Clean.
worktree('clean-room-bbb');
// Has a commit of its own: a different finding, and its work is on a ref.
const committed = worktree('has-commit-ccc');
fs.writeFileSync(path.join(committed, 'kept.js'), '// kept\n');
gitIn(committed, 'add', '.');
gitIn(committed, 'commit', '-q', '-m', 'kept');
dirty(committed, { modified: 1, ageDays: 20 });
// Locked to a pid that is running: somebody's claim.
const heldLive = worktree('held-live-ddd');
dirty(heldLive, { modified: 2, ageDays: 20 });
git('worktree', 'lock', '--reason', `claude agent held-live-ddd (pid ${ME} start Sat Sep 19 20:52:27 2026)`, heldLive);
// Locked to a pid that is gone: the dead attempt, still carrying its lock.
const heldDead = worktree('held-dead-eee');
dirty(heldDead, { modified: 2, ageDays: 20 });
git('worktree', 'lock', '--reason', `claude agent held-dead-eee (pid ${DEAD_PID} start Sat Sep 19 20:52:27 2026)`, heldDead);
// Locked with a reason that names no pid at all: cannot be checked, so honoured.
const heldText = worktree('held-text-fff');
dirty(heldText, { modified: 1, ageDays: 20 });
git('worktree', 'lock', '--reason', 'live session: b7e-keep (bc-2pysw)', heldText);
// A session is sitting in it.
const sat = worktree('sat-in-ggg');
dirty(sat, { modified: 1, ageDays: 20 });
// Retired: in the attic, not ours to name.
const attic = worktree('retired-hhh');
dirty(attic, { modified: 1, ageDays: 20 });
fs.mkdirSync(path.join(REPO, '.claude', 'worktrees-retired'), { recursive: true });
git('worktree', 'move', attic, path.join(REPO, '.claude', 'worktrees-retired', 'retired-hhh'));

// The cwd is the worktree itself, which exists, so it is resolved through symlinks the way
// a real session's is — /var/folders and /private/var/folders on this Mac.
const SESSIONS = [{ pid: 4242, cwd: sat }];

/** Every path under the checkout with its size and mtime — what "nothing was touched" compares. */
const snapshot = () => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${p}:${fs.statSync(p).size}:${fs.statSync(p).mtimeMs}`);
    }
  };
  walk(REPO);
  return out.sort().join('\n');
};
const listing = () => git('worktree', 'list', '--porcelain');

const {
  censusOrphanWork,
  sweepOrphanWork,
  describeOrphanWork,
  orphanCard,
  rowLine,
  fingerprint,
  namesOn,
  printOn,
  beadFor,
  lockPid,
  lockReasons,
  readStatus,
  CARD_TITLE,
  IDLE_DAYS,
  MAX_ROWS,
} = await import(LIB('orphanwork.js'));
const { toQuestion } = await import(LIB('decision.js'));

/* ------------------------------------------------------------ the pure parts */

console.log('\nthe pure parts');

check('a lock reason’s pid is read out of it', lockPid('claude agent x (pid 5333 start Sat Sep 19)') === 5333);
check('and out of the resolver spelling', lockPid('resolver pid 83789 #767') === 83789);
check('a reason with no pid names none, rather than guessing', lockPid('live session: b7e-keep (bc-2pysw)') === null);
check(
  'lock reasons are read per path',
  lockReasons('worktree /a\nHEAD x\nlocked why not\n\nworktree /b\nHEAD y\n').get('/a') === 'why not' &&
    !lockReasons('worktree /b\nHEAD y\n').has('/b')
);
{
  const s = readStatus(' M lib/a.js\n?? new.js\nR  old.js -> lib/renamed.js\n D gone.js\n');
  check('status counts every changed path', s.files.length === 4, JSON.stringify(s));
  check('and splits the ones git has never seen', s.untracked === 1 && s.modified === 3, JSON.stringify(s));
  check('a rename is its new name', s.files.includes('lib/renamed.js') && !s.files.includes('old.js -> lib/renamed.js'));
}
check('a bead is found by the tag its worktree name ends in', beadFor('reap-teardown-race-3qsw', [{ id: 'bc-3qsw' }, { id: 'bc-9zzz' }])?.id === 'bc-3qsw');
check('and not when two beads share the tag — ownership is ambiguous', beadFor('x-1kwl22', [{ id: 'bc-1kwl.22' }, { id: 'bc-1kwl.2.2' }]) === null);

/* ---------------------------------------------------------------- the census */

console.log('\nthe census');

const before = snapshot();
const beforeList = listing();
const c = await censusOrphanWork(REPO, { sessions: SESSIONS, isLive });
const names = c.found.map((f) => f.name);

check('it ran', c.ok, c.reason);
check('a dead attempt’s diff is named', names.includes('reap-teardown-race-3qsw'), JSON.stringify(names));
check('with its files counted, tracked and new apart', c.found.find((f) => f.name === 'reap-teardown-race-3qsw')?.files === 7 &&
  c.found.find((f) => f.name === 'reap-teardown-race-3qsw')?.modified === 3 &&
  c.found.find((f) => f.name === 'reap-teardown-race-3qsw')?.untracked === 4, JSON.stringify(c.found[0]));
check('and its age, from the files rather than the tree', c.found.find((f) => f.name === 'reap-teardown-race-3qsw')?.idleDays >= 39);
check('the biggest diff is first', names[0] === 'reap-teardown-race-3qsw', JSON.stringify(names));
check('a smaller one is named too', names.includes('window-budget-29b3'));
check('a worktree touched an hour ago is not — somebody may be editing it by path', !names.includes('fresh-edit-aaa'));
check('a clean one is not', !names.includes('clean-room-bbb'));
check('one with a commit of its own is a different finding', !names.includes('has-commit-ccc'));
check('a lock whose pid is running is a claim and is honoured', !names.includes('held-live-ddd'));
check('a lock whose pid is dead is the dead attempt this is for', names.includes('held-dead-eee'), JSON.stringify(names));
check('a lock with no pid cannot be checked and is honoured', !names.includes('held-text-fff'));
check('a live session’s cwd protects it', !names.includes('sat-in-ggg'));
check('the attic is not ours', !names.includes('retired-hhh'));
check('exactly the three, then', names.length === 3, JSON.stringify(names));
check(
  'the skips say why, and the quiet ones are marked so',
  c.skipped.find((s) => s.name === 'sat-in-ggg')?.why.includes('4242') && c.skipped.every((s) => s.why),
  JSON.stringify(c.skipped)
);
check('a threshold is a parameter: past 25 days only the forty-day-old one is left', (await censusOrphanWork(REPO, { sessions: SESSIONS, isLive, idleDays: 25 })).found.map((f) => f.name).join() === 'reap-teardown-race-3qsw');
check('the default is days, not minutes', IDLE_DAYS >= 1);
check('nothing was deleted, moved, committed or cleaned', snapshot() === before && listing() === beforeList);

const nogit = await censusOrphanWork(path.join(tmp, 'not-a-repo'), { sessions: [] });
check('a directory that is not a checkout answers with a reason instead of throwing', !nogit.ok && /not a git checkout/.test(nogit.reason), nogit.reason);

/* ---------------------------------------------------------------- the card */

console.log('\nthe card');

const rows = c.found.map((f) => ({ ...f, repo: '' }));
const body = orphanCard(rows, { checkouts: [REPO] });
const q = toQuestion({ name: 'widgets' }, { id: 'wg-card1', title: CARD_TITLE, description: body, labels: ['human'] });
check('the decision block parses', (q.errors || []).length === 0, JSON.stringify(q.errors));
check('with two options', (q.decision?.options || []).length === 2, JSON.stringify((q.decision?.options || []).map((o) => o.id)));
check('salvage is recommended and does not close the card it is an instruction on', (() => {
  const o = q.decision?.options?.find((x) => x.id === 'salvage');
  return o?.recommended === true && o?.closes === false;
})(), JSON.stringify(q.decision?.options));
check('letting them go closes it', q.decision?.options?.find((x) => x.id === 'let-go')?.closes !== false);
check('the question says how many, in numbers', /3 worktrees hold 10 uncommitted files/.test(q.decision?.question || ''), q.decision?.question);
check('the biggest is drawn above the smaller', body.indexOf('reap-teardown-race-3qsw') < body.indexOf('window-budget-29b3'));
check('and says what would be lost, by name', /`new0\.js`|`a\.js`/.test(body));
check('it says nothing was deleted', /Nothing has been deleted/.test(body));
check('the names it covered are what a closed card keeps', namesOn(body).has('reap-teardown-race-3qsw') && namesOn(body).size === 3, JSON.stringify([...namesOn(body)]));
check('and the fingerprint moves with the census', printOn(body) === fingerprint(rows) && fingerprint(rows) !== fingerprint(rows.slice(1)));
check('the row names its bead when it has one', /bc-3qsw/.test(rowLine({ ...rows[0], bead: { id: 'bc-3qsw', title: 'Reap teardown race', status: 'open' } })));
{
  const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ name: `w${i}`, repo: '', files: 100 - i, modified: 1, untracked: 0, idleDays: 9, sample: [] }));
  const b = orphanCard(many);
  check('a long census is cut, and says how much it left off', /and 5 more/.test(b) && b.includes('`w0`') && !b.includes('`w29`'));
  check('but the marker still names every worktree', namesOn(b).size === MAX_ROWS + 5);
}

/* ------------------------------------------------------------ the fake tracker */

/**
 * A tracker holding beads and recording the writes it is asked for. `show` answers with
 * the description, as `bd show` does; `listHuman` is the open beads carrying `human`.
 */
function fakeBd(initial = []) {
  const beads = new Map(initial.map((b) => [b.id, { labels: [], status: 'open', ...b }]));
  const writes = [];
  let n = 0;
  return {
    writes,
    beads,
    async graph() {
      return { parents: new Map(), beads: new Map(), roots: [] };
    },
    async listHuman() {
      return [...beads.values()].filter((b) => b.status !== 'closed' && b.labels.includes('human'));
    },
    async listLive() {
      return [...beads.values()].filter((b) => b.status !== 'closed');
    },
    async listStatus(_ws, status) {
      return [...beads.values()].filter((b) => b.status === status);
    },
    async listAll() {
      return [...beads.values()];
    },
    async show(_ws, id) {
      return beads.get(id) || null;
    },
    async create(_ws, f) {
      n += 1;
      const id = `wg-card${n}`;
      writes.push({ kind: 'create', id, f });
      beads.set(id, { id, status: 'open', title: f.title, description: f.body, labels: f.labels || [], parent: f.parent });
      return id;
    },
    async update(_ws, id, f) {
      writes.push({ kind: 'update', id, f });
      const b = beads.get(id);
      if (b && f.description) b.description = f.description;
    },
    async close(_ws, id, reason) {
      writes.push({ kind: 'close', id, reason });
      const b = beads.get(id);
      if (b) {
        b.status = 'closed';
        b.closed_at = new Date().toISOString();
      }
    },
  };
}
const ws = { name: 'widgets', dir: path.join(tmp, 'beads', 'widgets', '.beads') };
const REPOS = [{ dir: REPO, name: null }];
const sweep = (bd, extra = {}) => sweepOrphanWork(bd, ws, REPOS, { sessions: SESSIONS, isLive, ...extra });

/* ------------------------------------------------------------------ the sweep */

console.log('\nthe sweep');

{
  const bd = fakeBd([{ id: 'bc-3qsw', title: 'Reap teardown race', status: 'in_progress' }]);
  const r1 = await sweep(bd);
  check('the first sweep files one card for all of them', r1.filed && bd.writes.filter((w) => w.kind === 'create').length === 1, JSON.stringify(bd.writes.map((w) => w.kind)));
  const card = bd.writes[0].f;
  check('titled the constant it will find it by', card.title === CARD_TITLE);
  check('into the inbox from birth, so no session is opened on it', card.labels.join() === 'human');
  check('at P2, the cap on anything filed unasked', card.priority === 2);
  check('naming the bead each worktree encodes', /bc-3qsw “Reap teardown race” \(in_progress\)/.test(card.body), card.body.split('\n').filter((l) => /3qsw/.test(l)).join(' | '));
  check('and the log line says what it did', /filed wg-card1 for 3 worktrees holding 10 uncommitted files/.test(describeOrphanWork(r1)), describeOrphanWork(r1));

  const wrote = bd.writes.length;
  const r2 = await sweep(bd);
  check('a second sweep over the same census writes nothing', bd.writes.length === wrote && !r2.filed && !r2.refreshed && !r2.closed, JSON.stringify(bd.writes.slice(wrote)));
  check('and has nothing to say', describeOrphanWork(r2) === '');

  // The census moves: one of the three is committed — it now has a commit of its own.
  fs.writeFileSync(path.join(deadSmall, 'landed.js'), '// landed\n');
  gitIn(deadSmall, 'add', '.');
  gitIn(deadSmall, 'commit', '-q', '-m', 'landed');
  const r3 = await sweep(bd);
  check('when one is committed the card is rewritten, not filed again', r3.refreshed === 'wg-card1' && bd.writes.filter((w) => w.kind === 'create').length === 1, JSON.stringify(bd.writes.map((w) => w.kind)));
  const upd = bd.writes.find((w) => w.kind === 'update');
  check('and no longer quotes it', upd && !upd.f.description.includes('window-budget-29b3') && upd.f.description.includes('reap-teardown-race-3qsw'));
  check('and the card in the tracker is the new one', !bd.beads.get('wg-card1').description.includes('window-budget-29b3'));

  // Everything is dealt with.
  gitIn(deadBig, 'checkout', '-q', '--', '.');
  gitIn(deadBig, 'clean', '-fdq');
  gitIn(heldDead, 'checkout', '-q', '--', '.');
  const r4 = await sweep(bd);
  check('when none are left the card closes itself, with a reason', r4.closed === 'wg-card1' && bd.beads.get('wg-card1').status === 'closed' && /nothing is left/.test(bd.writes.at(-1).reason), JSON.stringify(bd.writes.at(-1)));
  const r5 = await sweep(bd);
  check('and an empty census with no card writes nothing', !r5.filed && bd.writes.filter((w) => w.kind === 'create').length === 1);
}

/* ------------------------------------------- answered, in flight, and not re-asked */

console.log('\nanswered cards');

// Put the dirt back so there is a census again.
dirty(deadBig, { modified: 3, added: 4, ageDays: 40 });
dirty(heldDead, { modified: 2, ageDays: 20 });
const census = (await censusOrphanWork(REPO, { sessions: SESSIONS, isLive })).found.map((f) => f.name).sort();
check('the fixture is dirty again', census.join() === 'held-dead-eee,reap-teardown-race-3qsw', census.join());

{
  // Salvage was answered: the card is open and NOT in the inbox, because a session has it.
  const bd = fakeBd([{ id: 'wg-work1', title: CARD_TITLE, status: 'in_progress', labels: [], description: 'x' }]);
  const r = await sweep(bd);
  check('a card being worked is left alone, and no second one is filed beside it', !r.filed && bd.writes.length === 0 && /already being worked/.test(r.held), JSON.stringify({ held: r.held, w: bd.writes }));
}
{
  // Let-go was answered: a closed card that listed exactly these.
  const prior = orphanCard(
    census.map((name) => ({ name, repo: '', files: 3, modified: 3, untracked: 0, idleDays: 20, sample: [] })),
    { checkouts: [REPO] }
  );
  const bd = fakeBd([{ id: 'wg-old1', title: CARD_TITLE, status: 'closed', closed_at: '2026-09-01T00:00:00Z', description: prior }]);
  const r = await sweep(bd);
  check('worktrees a closed card already listed are not asked about again', !r.filed && bd.writes.length === 0 && /answered/.test(r.held), JSON.stringify({ held: r.held, w: bd.writes }));

  // A new one turns up.
  const newer = worktree('newly-dead-jjj');
  dirty(newer, { modified: 1, ageDays: 9 });
  const r2 = await sweep(bd);
  check('a worktree it did not list is news, and files a card', !!r2.filed && bd.writes.filter((w) => w.kind === 'create').length === 1, JSON.stringify(bd.writes.map((w) => w.kind)));
  check('whose card lists all of them, since Adam decides about the lot', /newly-dead-jjj/.test(bd.writes[0].f.body) && /reap-teardown-race-3qsw/.test(bd.writes[0].f.body));
}
{
  // Reading the tracker fails: nothing is guessed at.
  const bd = fakeBd();
  bd.listHuman = async () => {
    throw new Error('dolt is locked\nsecond line');
  };
  const r = await sweep(bd);
  check('a tracker that will not answer stops the write half and says why', !r.ok && /could not read the inbox — dolt is locked/.test(r.reason) && bd.writes.length === 0, JSON.stringify(r));
  const bd2 = fakeBd();
  bd2.listStatus = async () => {
    throw new Error('timeout');
  };
  const r2 = await sweep(bd2);
  check('and one that cannot say what was already answered files nothing rather than everything', !r2.filed && bd2.writes.length === 0, JSON.stringify(r2));
}
{
  const r = await sweepOrphanWork(fakeBd(), ws, [{ dir: path.join(tmp, 'nope'), name: 'x' }], { sessions: [] });
  check('a checkout that is not one is a reason, not a throw', !r.ok && /x: /.test(r.reason), r.reason);
}
check('across the whole of it, nothing under the checkout was deleted', fs.existsSync(deadBig) && fs.existsSync(heldDead) && fs.existsSync(path.join(deadBig, 'new0.js')));

/* ------------------------------------------------------------- the advocate tick */

console.log('\nthe advocate tick');

const { createAdvocates } = await import(LIB('advocate.js'));

function tickBd() {
  const bd = fakeBd();
  const base = {
    async listAgent() {
      return [];
    },
    async ready() {
      return [];
    },
    async json() {
      return [];
    },
    async comments() {
      return [];
    },
    async listLabel() {
      return [];
    },
    async closeGate() {
      return null;
    },
  };
  return Object.assign(bd, base);
}

for (const on of [true, false]) {
  const bd = tickBd();
  const cfg = {
    workspaces: [ws],
    spaces: [],
    claudeSessions: false,
    sessionDirs: { widgets: REPO },
    pr: { enabled: false, base: 'main' },
    advocates: {
      enabled: true,
      workspaces: ['*'],
      settleSeconds: 0,
      launchCooldownSeconds: 0,
      tidyWorktrees: false,
      propose: false,
      respectQuietHours: false,
      sessionLog: false,
      reconcileLanded: false,
      askSuperseded: false,
      flagInMain: false,
      flagNotInMain: false,
      flagOrphanWork: on,
    },
  };
  const advocates = createAdvocates(cfg, { bus: { emit() {} }, bd, open: async () => ({ dir: REPO, mode: 'test', term: null }) });
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.map(String).join(' '));
  console.error = (...a) => logs.push(a.map(String).join(' '));
  try {
    await advocates.tick();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  const filed = bd.writes.filter((w) => w.kind === 'create');
  if (on) {
    check('a tick with the sweep on files the one card, into the inbox', filed.length === 1 && filed[0].f.title === CARD_TITLE, JSON.stringify(bd.writes.map((w) => w.kind)) + logs.join('\n'));
    check('and says so in the daemon log', logs.some((l) => /orphaned work: filed wg-card1/.test(l)), logs.join('\n'));
  } else {
    check('with flagOrphanWork off, a tick writes nothing about worktrees', filed.length === 0, JSON.stringify(bd.writes));
  }
}

console.log(`\n${failures ? '\x1b[31m' : '\x1b[32m'}${ran - failures}/${ran} checks passed\x1b[0m`);
process.exit(failures ? 1 : 0);
