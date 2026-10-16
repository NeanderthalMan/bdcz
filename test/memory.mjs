#!/usr/bin/env node
//
// The common repo and the memory API.
//
//   npm test                       (runs it alongside the other suites)
//   node test/memory.mjs           (on its own)
//
// Three things are worth a test here and the rest is plumbing:
//
// 1. **The signing key must not get committed.** ~/.config/beadcause holds
//    android-keystore.jks. A `git init && git add -A` there puts a release key in a
//    history, and a key in a history is a key you have to rotate. So: the ignore
//    file exists before the repo does, and the commit refuses even when something
//    has forced the file into the index anyway.
// 2. **Two writers must not lose each other's message.** The blackboard's whole
//    reason for being on a ref is the compare-and-swap, and a CAS you have not
//    raced is a CAS you have not tested — so six processes post to one topic at
//    once and every sequence number has to be there exactly once.
// 3. **A memory has to outlive the process that wrote it**, and one agent's memory
//    must not overwrite another's — which is what the whole-tree rebuild in
//    `remember` is for, and the thing a naive `mktree` gets silently wrong.
// 4. **A note about a repo has to reach a session that is not in the same worktree.**
//    Nearly all work here happens in a worktree that is retired days later, so tier 1
//    is worth nothing unless a note written from one is visible from the main checkout
//    and from every sibling — and it must not be visible from a *different* repo, which
//    is the whole reason the tier exists. Both are properties of where the ref lives,
//    and neither is asserted by anything else.
//
// The tier-2 half runs against a temp BEADCAUSE_CONFIG_DIR; the tier-1 half runs
// against throwaway git repos with real linked worktrees. Nothing here touches the
// real ~/.config/beadcause or any repo you work in, and nothing pushes anywhere.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { removeTreeSync } from './helpers/tmp.mjs';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------- child mode */
//
// `--post <topic> <message>` posts once and exits. That is how the concurrency case
// gets six genuinely separate writers: same code, same store, six processes, no
// shared memory to accidentally serialise them.
//
// `--note <key> <value>` is the tier-1 twin, and it has to be a child process rather
// than a loop: tier 1 resolves its store from `process.cwd()`, so "two worktrees
// writing at once" is only real if the two writers are in two directories, and one
// process has one cwd.

if (process.argv[2] === '--post') {
  const [, , , topic, ...message] = process.argv;
  const { post } = await import('../lib/memory.js');
  await post(topic, message.join(' '));
  process.exit(0);
}

if (process.argv[2] === '--note') {
  const [, , , key, ...value] = process.argv;
  const { note } = await import('../lib/memory.js');
  await note(process.env.BEADCAUSE_AGENT || 'worker', key, value.join(' '), { evidence: 'test fixture' });
  process.exit(0);
}

/* --------------------------------------------------------------- harness */

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  ✗ ${name}\n      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));
const rejects = async (name, fn, match) => {
  try {
    await fn();
    bad(name, 'it resolved, and should not have');
  } catch (err) {
    check(name, match.test(err.message), err.message);
  }
};

const store = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-memory-'));
process.env.BEADCAUSE_CONFIG_DIR = store;
process.env.BEADCAUSE_AGENT = 'advocate';
process.on('exit', () => removeTreeSync(store));

const git = (...args) => execFileSync('git', ['-C', store, ...args], { encoding: 'utf8' }).trim();

// Imported after the env is set: CONFIG_DIR resolves once, at module load.
const { ensureRepo, commit, snapshot, flush, history } = await import('../lib/commonrepo.js');
const memory = await import('../lib/memory.js');

/* ------------------------------------------------------ the common repo */

console.log('the common repo');

await ensureRepo();
check('git init happened', fs.existsSync(path.join(store, '.git')));
check('.gitignore was written', fs.existsSync(path.join(store, '.gitignore')));
check(
  '.gitignore predates the repo — no commit exists yet that could have caught a key',
  git('log', '--oneline', '--all') === ''
);

fs.writeFileSync(path.join(store, 'android-keystore.jks'), 'PRETEND SIGNING KEY');
fs.writeFileSync(path.join(store, 'android-keystore.properties'), 'storePassword=hunter2');
fs.writeFileSync(path.join(store, 'loupe-sorrel.png'), 'PRETEND PNG');
fs.writeFileSync(path.join(store, 'status.json'), '{}');
fs.writeFileSync(path.join(store, 'restart.json'), '{"at":"2026-08-11T00:00:00.000Z"}');
fs.writeFileSync(path.join(store, 'handovers.json'), '{"handovers":[{"at":"2026-08-11T00:00:00.000Z","pid":9}]}');
fs.writeFileSync(path.join(store, 'merge-sweeps.json'), '{"beadcause":{"workspace":"beadcause","key":"beadcause","number":9}}');
fs.writeFileSync(path.join(store, 'sweep-cards.json'), '{"bc-1":{"card":"bc-1","workspace":"beadcause","prs":[]}}');
fs.writeFileSync(path.join(store, 'coverage.json'), '{"commit":"abc","files":[]}');
fs.writeFileSync(path.join(store, 'sessions.json'), '{"polledAt":"2026-10-11T00:00:00.000Z","sessions":{}}');
fs.mkdirSync(path.join(store, 'logs'), { recursive: true });
fs.writeFileSync(path.join(store, 'logs', 'run.log'), 'noise');
fs.writeFileSync(path.join(store, 'config.json'), JSON.stringify({ token: 'abc' }, null, 2) + '\n');

const first = await commit('config');
check('a first snapshot lands', typeof first === 'string' && first.length === 40, String(first));

const tracked = git('ls-files').split('\n').filter(Boolean);
check('config.json is tracked', tracked.includes('config.json'), tracked.join(' '));
check('the signing key is NOT tracked', !tracked.some((f) => f.includes('keystore')), tracked.join(' '));
check('the check PNG is not tracked', !tracked.includes('loupe-sorrel.png'), tracked.join(' '));
check('status.json churn is not tracked', !tracked.includes('status.json'), tracked.join(' '));
// The same argument, one file along: the router rewrites restart.json on every handover
// and it means nothing thirty seconds later, so its history is noise (bc-kttd).
check('restart.json churn is not tracked', !tracked.includes('restart.json'), tracked.join(' '));
// And the longer form of the same file: the last twenty handovers, rewritten whole every
// time the port changes hands, so a commit per swap is the same twenty rows over and over.
// What shipped is deploys/, which is tracked (bc-khoe.8).
check('handovers.json churn is not tracked', !tracked.includes('handovers.json'), tracked.join(' '));
// And once more for the sweep a merge asks for: written by whichever process merged,
// emptied by the next poll cycle, and a history of it would be one commit per merge
// saying something the pull request already says (bc-9d37.4).
check('merge-sweeps.json churn is not tracked', !tracked.includes('merge-sweeps.json'), tracked.join(' '));
// And its follow-up half: the rows of the card a sweep filed, deleted the moment the last
// resolver stops. The history worth keeping is the bead it is about (bc-9d37.5).
check('sweep-cards.json churn is not tracked', !tracked.includes('sweep-cards.json'), tracked.join(' '));
// And the coverage report (lib/coverage.js): a few hundred kilobytes rewritten whole by
// every `npm run coverage`, and true only of the commit stamped inside it (bc-vriu.2).
check('coverage.json churn is not tracked', !tracked.includes('coverage.json'), tracked.join(' '));
// And the register of open Claude Code windows (lib/sessionregister.js): the same rows
// rewritten every minute with a new timestamp, and a current fact rather than a history
// (bc-5to5r.2).
check('sessions.json churn is not tracked', !tracked.includes('sessions.json'), tracked.join(' '));
check('logs/ is not tracked', !tracked.some((f) => f.startsWith('logs/')), tracked.join(' '));

check('an unchanged directory produces no commit', (await commit('nothing')) === null);

// The belt-and-braces case: someone forced the key into the index anyway — an edited
// .gitignore, a `git add -f`, a stray `git add` from a shell in that directory.
git('add', '-f', 'android-keystore.jks');
await rejects('a staged signing key aborts the commit', () => commit('oops'), /refusing to commit/i);
check('and it is unstaged again, so the next commit cannot pick it up', git('diff', '--cached', '--name-only') === '');

fs.writeFileSync(path.join(store, 'config.json'), JSON.stringify({ token: 'def' }, null, 2) + '\n');
snapshot('config', { delayMs: 0 });
await flush();
const log = await history();
check('the history shows both versions', log.length === 2, JSON.stringify(log.map((c) => c.subject)));
check(
  'and the previous config is recoverable from it',
  JSON.parse(git('show', `${log[1].commit}:config.json`)).token === 'abc'
);

/* ------------------------------------------- and the state writes use it */
//
// The history is worth nothing if the writes do not take it, and the wiring is easy
// to get wrong in a way that fails silently — lib/config.js and lib/commonrepo.js
// import each other, so a snapshot call placed where the module cycle has not
// resolved would throw inside a `try` somewhere and simply stop recording.

console.log('\nthe state writes take a snapshot');

const cfg = await import('../lib/config.js');
cfg.saveConfig({ token: 'first', workspaces: [] });
cfg.saveState({ notified: ['bc-1'] });
await flush();

const wired = await history();
check('a config write is committed', wired.some((c) => c.subject.includes('config')), JSON.stringify(wired.map((c) => c.subject)));
check('and so is a state write', wired.some((c) => c.subject.includes('state')), JSON.stringify(wired.map((c) => c.subject)));
check(
  'both in one commit — bursts are debounced, not one commit per write',
  wired[0].subject === 'config, state',
  wired[0].subject
);

cfg.saveConfig({ token: 'second', workspaces: [] });
await flush();
check('a later write is a new commit', (await history())[0].commit !== wired[0].commit);
check(
  'and the previous token is recoverable',
  JSON.parse(git('show', `${wired[0].commit}:config.json`)).token === 'first'
);

/* ------------------------------------------------------------- remembering */

console.log('\nremembering');

await memory.remember('advocate', 'tone', 'evidence first, then the ask');
check('a memory reads back', (await memory.recall('advocate', 'tone')) === 'evidence first, then the ask');
check('a key that was never written is null', (await memory.recall('advocate', 'nothing')) === null);

await memory.remember('console', 'shape', 'one bead per decision');
check(
  "another agent's write does not clobber the first",
  (await memory.recall('advocate', 'tone')) === 'evidence first, then the ask'
);
check('and its own reads back', (await memory.recall('console', 'shape')) === 'one bead per decision');

await memory.remember('advocate', 'tone', 'evidence first, and name the file');
check('a rewrite wins', (await memory.recall('advocate', 'tone')) === 'evidence first, and name the file');
check(
  'and the old value is still in the ref history',
  git('log', '--format=%s', 'refs/beadcause/memory').split('\n').length === 3,
  git('log', '--format=%s', 'refs/beadcause/memory')
);

await memory.remember('advocate', 'threshold', { proposals: 3, quiet: true });
const all = await memory.recall('advocate');
check('recall with no key returns every value, unwrapped', all.threshold.proposals === 3, JSON.stringify(all));
check('and it does not leak the storage envelope', all.tone === 'evidence first, and name the file');
check('agents() lists who has memory', (await memory.agents()).join(',') === 'advocate,console', String(await memory.agents()));

const detail = await memory.recallDetail('advocate');
check('recallDetail keeps the timestamp', typeof detail.tone.at === 'string' && detail.tone.at.endsWith('Z'));

await rejects('a bad agent name is rejected, not sanitised', () => memory.remember('advocate/sorrel', 'k', 'v'), /bad agent/);
await rejects('and so is one that walks up a directory', () => memory.remember('..', 'k', 'v'), /bad agent/);
await rejects('a bad key too', () => memory.remember('advocate', 'a key', 'v'), /bad key/);

// The memory has to survive the process, which is the entire point of it.
const other = await run(process.execPath, ['-e', "const m = await import('./lib/memory.js'); process.stdout.write(String(await m.recall('advocate','tone')))"], {
  cwd: path.join(HERE, '..'),
  env: process.env,
});
check('a different process recalls it', other.stdout === 'evidence first, and name the file', other.stdout);

/* ------------------------------------------------------------ the blackboard */

console.log('\nthe blackboard');

const one = await memory.post('proposals', 'the graph work is blocked on a decision');
check('the first message is #1', one.seq === 1, JSON.stringify(one));
check('and it is attributed to whoever posted it', one.from === 'advocate', one.from);

await memory.post('proposals', 'seen — I will not re-file it', { from: 'console' });
const both = await memory.read('proposals');
check('both messages come back', both.length === 2, JSON.stringify(both.map((m) => m.seq)));
check('oldest first', both[0].seq === 1 && both[1].seq === 2);
check('with the other agent named', both[1].from === 'console', both[1].from);

const fresh = await memory.read('proposals', 1);
check('since skips what you have already seen', fresh.length === 1 && fresh[0].seq === 2, JSON.stringify(fresh));
check('since the last one is empty', (await memory.read('proposals', 2)).length === 0);
check('an ISO since works too', (await memory.read('proposals', both[0].at)).length === 1);
check('a topic nobody has posted to is empty, not an error', (await memory.read('silence')).length === 0);
check('topics lists it', (await memory.topics()).includes('proposals'), String(await memory.topics()));

await rejects('an empty message is refused', () => memory.post('proposals', '   '), /nothing to post/);
await rejects('a bad topic is refused', () => memory.post('a topic', 'x'), /bad topic/);

/* ----------------------------------------------- the path an agent takes */
//
// The library is for the daemon. An agent is a `claude -p` in a login shell with an
// allowlist, so its whole reach to any of this is the command — and every link in
// that chain is something that can silently not be there: the binary not on PATH,
// the identity not exported, the tool not on the allowlist. Each of those fails as
// "the agent just didn't use it", which is indistinguishable from it choosing not
// to. So the chain gets walked here exactly as the agent walks it.

console.log('\nthe path an agent actually takes');

const { effective, agentEnv } = await import('../lib/foundation.js');
const consoleF = await effective(path.join(HERE, '..'), 'console');
const env = agentEnv(consoleF, { BEADCAUSE_CONFIG_DIR: store });

check(
  'the tool is on the console\'s allowlist',
  consoleF.allowedTools.includes('Bash(beadcause-memory:*)'),
  consoleF.allowedTools.join(' ')
);
check('and the spawner stamps who it is', env.BEADCAUSE_AGENT === 'console', String(env.BEADCAUSE_AGENT));

// A login shell, because that is what every agent here is spawned through — and
// ~/.zshenv rebuilding PATH would be exactly the sort of thing that quietly breaks
// this.
await run('/bin/zsh', ['-lc', 'beadcause-memory remember shape "one bead per decision, always"'], { env });
check(
  'the agent wrote to its own memory, by name, without naming itself',
  (await memory.recall('console', 'shape')) === 'one bead per decision, always'
);

const back = await run('/bin/zsh', ['-lc', 'beadcause-memory recall shape'], { env });
check('and reads it back in a later run', back.stdout.trim() === 'one bead per decision, always', back.stdout);

// The identity is stamped after `env`, so an amendment that set BEADCAUSE_AGENT
// cannot make one agent write as another.
const impostor = agentEnv({ ...consoleF, env: { BEADCAUSE_AGENT: 'advocate' } }, { BEADCAUSE_CONFIG_DIR: store });
check('an amended env cannot change who the agent is', impostor.BEADCAUSE_AGENT === 'console', impostor.BEADCAUSE_AGENT);

/* --------------------------------------- reading another agent, and only reading */
//
// The console reading the advocate's memory is the whole point of `--of`, and the
// whole risk of it: the flag that lets you *read* another agent must not be a flag
// that lets you *write* as one. `--agent` already does the second thing — it is
// documented as a human's debugging aid — so the test that matters is that the two
// stayed different, in the direction that costs something if it drifts.

console.log('\nreading another agent, and only reading');

const zsh = (line, e = env) => run('/bin/zsh', ['-lc', line], { env: e });

const roster = await zsh('beadcause-memory agents');
check(
  'the roster lists every kind that has a memory',
  roster.stdout.trim().split('\n').sort().join(',') === 'advocate,console',
  roster.stdout
);

const theirs = await zsh('beadcause-memory recall --of=advocate tone');
check(
  "the console reads the advocate's memory",
  theirs.stdout.trim() === 'evidence first, and name the file',
  theirs.stdout
);
check(
  'and stdout is only the value — the provenance note is on stderr, so a $( ) capture is unchanged',
  theirs.stdout === 'evidence first, and name the file\n' && /never a reason on its own/.test(theirs.stderr),
  JSON.stringify({ out: theirs.stdout, err: theirs.stderr })
);
// bc-pud4: the note says what the memory is *worth*, not that it was private. The
// rejected design was a curated readable subset, and "they never chose to publish
// this" was the sentence that pointed at it — so a regression to a privacy framing
// is a regression to a decision that was made and closed.
check(
  'and the note is about scrutiny, not about privacy',
  /must face scrutiny/.test(theirs.stderr) && !/not published to you|never chose to publish/.test(theirs.stderr),
  theirs.stderr
);

const listed = await zsh('beadcause-memory recall --of=advocate');
check(
  'with no key it lists what they know',
  listed.stdout.includes('threshold') && listed.stdout.includes('tone'),
  listed.stdout
);

const ownRecall = await zsh('beadcause-memory recall shape');
check(
  'reading your own carries no such note — it is nobody else\'s to warn about',
  !/never a reason on its own/.test(ownRecall.stderr),
  ownRecall.stderr
);

// The acceptance case: `--of` on a command that writes is refused outright, rather
// than being quietly read as "and while you are there, be them".
const before = await memory.recall('advocate', 'tone');
let combined;
try {
  await zsh('beadcause-memory remember --of=advocate tone "the console got in"');
  combined = null;
} catch (err) {
  combined = err;
}
check('remember --of is refused', combined !== null && combined.code !== 0, String(combined));
check(
  'and it says why',
  combined !== null && /cannot be combined with `remember`/.test(String(combined.stderr)),
  String(combined?.stderr)
);
check(
  "and the advocate's memory is untouched",
  (await memory.recall('advocate', 'tone')) === before,
  String(await memory.recall('advocate', 'tone'))
);

let posted;
try {
  await zsh('beadcause-memory post --of=advocate proposals "as them"');
  posted = null;
} catch (err) {
  posted = err;
}
check('post --of is refused too — the guard is on writing, not on one command', posted !== null, String(posted));

// A read attributes to nobody, so it needs no identity — which is also what stops
// `--of` from being a back door into a write: there is no author to borrow.
const anonymous = { ...env };
delete anonymous.BEADCAUSE_AGENT;
const nameless = await zsh('beadcause-memory recall --of=advocate tone', anonymous);
check('a caller with no identity can still read', nameless.stdout.trim() === before, nameless.stdout);

let namelessWrite;
try {
  await zsh('beadcause-memory remember tone "no identity, no write"', anonymous);
  namelessWrite = null;
} catch (err) {
  namelessWrite = err;
}
check('but still cannot write', namelessWrite !== null && /no agent/.test(String(namelessWrite.stderr)), String(namelessWrite?.stderr));

let bareOf;
try {
  await zsh('beadcause-memory recall --of');
  bareOf = null;
} catch (err) {
  bareOf = err;
}
check(
  '--of with no name is an error, not silently your own memory',
  bareOf !== null && /--of=<agent>/.test(String(bareOf.stderr)),
  String(bareOf?.stderr)
);

/* --------------------------------------------- notes, about one repo only */
//
// Tier 1. Everything below is a property of *where the ref lives*, and none of it is
// asserted anywhere else — so a refactor that quietly resolved the store from
// somewhere other than the working repo would pass every other suite in the tree.
//
// The two that matter most are opposites, and both are about a boundary:
//
// - a note written in a worktree has to be readable from the main checkout and from
//   every sibling worktree, because nearly all work here happens in a worktree that is
//   retired days later and a note that died with it would be worse than none;
// - the same key in another repo has to be a *different* note, because if it is not
//   then this is tier 2 with extra steps and the knowledge it exists to hold — how one
//   codebase is put together — is false somewhere the moment it is written.
//
// Real `git worktree add` worktrees, in throwaway repos, because the shared-ref-store
// property being relied on is git's and not ours.

console.log('\nnotes about one repo, from any worktree of it');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-tier1-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

/** A throwaway repo with one commit, so `git worktree add` has something to branch. */
function repo(id) {
  const dir = path.join(scratch, id);
  fs.mkdirSync(dir, { recursive: true });
  const g = (...a) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], {
      encoding: 'utf8',
    }).trim();
  g('init', '-q', '--initial-branch=main');
  fs.writeFileSync(path.join(dir, 'README'), `${id}\n`);
  // As the real thing does: worktrees live under `.claude/` inside the repo, so the repo
  // ignores it. Without this the untracked worktree directories are the only thing `git
  // status` reports, which is the check below asking about the wrong noise.
  fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'first');
  // Under .claude/worktrees/, exactly where this repo puts its own — so the layout being
  // tested is the layout in use, including a worktree nested inside its parent.
  const worktree = (wt) => {
    const at = path.join(dir, '.claude', 'worktrees', wt);
    g('worktree', 'add', '-q', at, '-b', `worktree-${wt}`);
    return at;
  };
  return { dir, git: g, worktree };
}

/**
 * Run something with the process standing somewhere else.
 *
 * `process.chdir` and not a `dir` argument, because there is no `dir` argument — which
 * is the point of the tier and is asserted below. The restore is in a `finally` so one
 * failed check cannot leave every later suite resolving against a temp directory that
 * is about to be deleted.
 */
const at = async (dir, fn) => {
  const back = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(back);
  }
};

const alpha = repo('alpha');
const beta = repo('beta');
const wtOne = alpha.worktree('one-a3f');
const wtTwo = alpha.worktree('two-b7c');

const LAYOUT = 'lib/ is the daemon, bin/ is what an agent can run';
await at(wtOne, () => memory.note('worker', 'layout', LAYOUT, { evidence: 'test fixture' }));

check(
  'a note written in a worktree is there from the main checkout',
  (await at(alpha.dir, () => memory.notes('worker', 'layout'))) === LAYOUT
);
check(
  'and from a sibling worktree that never wrote it',
  (await at(wtTwo, () => memory.notes('worker', 'layout'))) === LAYOUT
);
check(
  'it lives on a ref in that repo',
  alpha.git('log', '--format=%s', 'refs/beadcause/agents/worker') === `note worker.layout: ${LAYOUT}`,
  alpha.git('log', '--format=%s', 'refs/beadcause/agents/worker')
);
// The invisibility claim, checked as stated and not more broadly: `git log` and `git
// branch` do not see it. `git log --all` *does* — `--all` means every ref under `refs/`,
// not every branch — and that is worth knowing rather than asserting away, because it is
// how you find these commits by accident and how `gc` keeps them.
check(
  'and is invisible to plain log and to branch',
  alpha.git('log', '--oneline').split('\n').length === 1 &&
    !alpha.git('branch', '--all').includes('beadcause'),
  `${alpha.git('log', '--oneline')} | ${alpha.git('branch', '--all')}`
);
check(
  'and the repo has no new tracked file, in any worktree',
  alpha.git('status', '--porcelain') === '' &&
    execFileSync('git', ['-C', wtOne, 'status', '--porcelain'], { encoding: 'utf8' }).trim() === '',
  alpha.git('status', '--porcelain')
);

check(
  'another repo has never heard of the key',
  (await at(beta.dir, () => memory.notes('worker', 'layout'))) === null
);
await at(beta.dir, () => memory.note('worker', 'layout', 'one flat module, no daemon', { evidence: 'test fixture' }));
check(
  'and the same key there holds its own value',
  (await at(beta.dir, () => memory.notes('worker', 'layout'))) === 'one flat module, no daemon'
);
check(
  "while alpha's is untouched — this is the whole reason the store is in the repo",
  (await at(alpha.dir, () => memory.notes('worker', 'layout'))) === LAYOUT
);

await at(wtOne, () => memory.note('worker', 'tests', { runner: 'scripts/test.mjs', discovers: 'test/*.mjs' }, { evidence: 'test fixture' }));
check(
  'a structured value comes back whole by key',
  (await at(alpha.dir, () => memory.notes('worker', 'tests')))?.runner === 'scripts/test.mjs'
);
// bc-u1ltu.1: a listing is the index, not every body. The summary is the note itself
// while it is short, and the only thing a listing hands back.
const noted = await at(alpha.dir, () => memory.notes('worker'));
check('notes with no key returns the index — a summary per key', noted.layout === LAYOUT, JSON.stringify(noted));
check(
  'and a structured value is summarised as JSON rather than handed back as an object',
  typeof noted.tests === 'string' && noted.tests.includes('scripts/test.mjs'),
  JSON.stringify(noted)
);
const noteDetail = await at(alpha.dir, () => memory.notesDetail('worker'));
check('notesDetail keeps the timestamp', typeof noteDetail.layout.at === 'string' && noteDetail.layout.at.endsWith('Z'));
check('and the size of each note, without carrying its body', noteDetail.layout.bytes > LAYOUT.length && !('value' in noteDetail.layout), JSON.stringify(noteDetail.layout));
check(
  'a rewrite wins and the old value stays in the ref history',
  (await at(wtTwo, async () => {
    await memory.note('worker', 'layout', `${LAYOUT}, and scripts/ is neither`, { evidence: 'test fixture' });
    return memory.notes('worker', 'layout');
  })) === `${LAYOUT}, and scripts/ is neither` &&
    alpha.git('log', '--format=%s', 'refs/beadcause/agents/worker').split('\n').length === 3,
  alpha.git('log', '--format=%s', 'refs/beadcause/agents/worker')
);

check(
  "one agent's notes do not clobber another's — a ref each, not a file each",
  (await at(alpha.dir, async () => {
    await memory.note('advocate', 'layout', 'the advocate reads lib/advocate.js and nothing else', { evidence: 'test fixture' });
    return memory.notes('worker', 'layout');
  })) === `${LAYOUT}, and scripts/ is neither`
);

await rejects(
  'a bad agent name is rejected here too, not sanitised',
  () => at(alpha.dir, () => memory.note('worker/beta', 'k', 'v', { evidence: 'test fixture' })),
  /bad agent/
);
await rejects('and a bad key', () => at(alpha.dir, () => memory.note('worker', 'a key', 'v', { evidence: 'test fixture' })), /bad key/);

// A directory outside any repo is a caller in the wrong place, not an agent that knows
// nothing — so it says so, in both directions. `scratch` holds the repos and is not one.
await rejects('a write outside a repo says where it was', () => at(scratch, () => memory.note('worker', 'k', 'v', { evidence: 'test fixture' })), /not in a git repo/);
await rejects('and so does a read', () => at(scratch, () => memory.notes('worker', 'k')), /not in a git repo/);

/* ------------------------------------------ one blob per note (bc-u1ltu.1) */
//
// The store used to be one notes.json holding every note — 2 MB for the worker here, parsed
// whole by every listing and rewritten whole by every write. Now it is `notes/<key>.json`
// plus `index.json`. What has to hold: the tree really is that shape; a write leaves every
// other note's blob exactly where it was; a store still in the old shape reads, converts on
// its first write and loses nothing; and a tree an old writer clobbers after conversion is
// read back whole.

console.log('\none blob per note, plus an index');

const tree = (g, rev) => g('ls-tree', '-r', '--name-only', rev).split('\n').filter(Boolean).sort();
check(
  'the tree is index.json and one file per note',
  JSON.stringify(tree(alpha.git, 'refs/beadcause/agents/worker')) ===
    JSON.stringify(['index.json', 'notes/layout.json', 'notes/tests.json']),
  tree(alpha.git, 'refs/beadcause/agents/worker').join(' ')
);
const index = JSON.parse(alpha.git('cat-file', '-p', 'refs/beadcause/agents/worker:index.json'));
check('the index names every note and carries no body', index.version === 2 && Object.keys(index.notes).sort().join() === 'layout,tests' && !JSON.stringify(index).includes('"value"'), JSON.stringify(index));
check(
  'each note is the envelope it always was',
  JSON.parse(alpha.git('cat-file', '-p', 'refs/beadcause/agents/worker:notes/layout.json')).value.startsWith(LAYOUT)
);

const blobOf = (g, rev, file) => g('rev-parse', `${rev}:${file}`);
const testsBlob = blobOf(alpha.git, 'refs/beadcause/agents/worker', 'notes/tests.json');
await at(alpha.dir, () => memory.note('worker', 'fresh', 'one more', { evidence: 'test fixture' }));
check(
  'a write carries every other note across by sha — nothing else is rewritten',
  blobOf(alpha.git, 'refs/beadcause/agents/worker', 'notes/tests.json') === testsBlob
);

// A store written before the change: a legacy notes.json committed straight onto a ref, the
// way every store on this Mac looked on 2026-09-30.
const legacyRef = 'refs/beadcause/agents/legacy';
const LEGACY = {
  alpha: { value: 'the first one', at: '2026-08-01T00:00:00.000Z' },
  beta: { value: { nested: ['kept', 'as', 'is'] }, at: '2026-08-02T00:00:00.000Z' },
  unicode: { value: 'bytes, not characters — café', at: '2026-08-03T00:00:00.000Z' },
};
const legacyBody = JSON.stringify(LEGACY, null, 2) + '\n';
const blobPath = path.join(scratch, 'legacy.json');
fs.writeFileSync(blobPath, legacyBody);
const legacyBlob = alpha.git('hash-object', '-w', blobPath);
const legacyTree = execFileSync('git', ['-C', alpha.dir, 'mktree'], { input: `100644 blob ${legacyBlob}\tnotes.json\n`, encoding: 'utf8' }).trim();
const legacyCommit = alpha.git('commit-tree', legacyTree, '-m', 'note legacy.alpha: old shape');
alpha.git('update-ref', legacyRef, legacyCommit);

check('a legacy store is still read by key', (await at(alpha.dir, () => memory.notes('legacy', 'unicode'))) === 'bytes, not characters — café');
check('and listed', Object.keys(await at(alpha.dir, () => memory.notes('legacy'))).sort().join() === 'alpha,beta,unicode');

const dry = await memory.migrateNotes(wtTwo, 'legacy', { apply: false });
check('a dry-run migration checks the tree and moves nothing', dry.from === 'legacy' && dry.notes === 3 && dry.commit === null && alpha.git('rev-parse', legacyRef) === legacyCommit, JSON.stringify(dry));
const moved = await memory.migrateNotes(wtTwo, 'legacy');
check('the migration commits the converted tree', moved.commit && alpha.git('rev-parse', legacyRef) === moved.commit, JSON.stringify(moved));
check(
  'every note survives byte for byte',
  Object.entries(LEGACY).every(
    ([k, v]) => alpha.git('cat-file', '-p', `${legacyRef}:notes/${k}.json`) === JSON.stringify(v, null, 2)
  )
);
check('and running it again is a no-op', (await memory.migrateNotes(alpha.dir, 'legacy')).commit === null);

// An old writer, after conversion: it finds no notes.json, starts from {}, and commits a tree
// of notes.json holding its one note. Read naively that is a store of one.
const clobber = { gamma: { value: 'written by the old code', at: '2026-10-01T00:00:00.000Z' } };
fs.writeFileSync(blobPath, JSON.stringify(clobber, null, 2) + '\n');
const cBlob = alpha.git('hash-object', '-w', blobPath);
const cTree = execFileSync('git', ['-C', alpha.dir, 'mktree'], { input: `100644 blob ${cBlob}\tnotes.json\n`, encoding: 'utf8' }).trim();
alpha.git('update-ref', legacyRef, alpha.git('commit-tree', cTree, '-p', moved.commit, '-m', 'note legacy.gamma: old code'));
check(
  'a legacy tree an old writer laid over a converted one is read as both',
  Object.keys(await at(alpha.dir, () => memory.notes('legacy'))).sort().join() === 'alpha,beta,gamma,unicode'
);
await at(alpha.dir, () => memory.note('legacy', 'delta', 'the new code writes next', { evidence: 'test fixture' }));
check(
  'and the next write converts the lot back, losing nothing',
  JSON.stringify(tree(alpha.git, legacyRef)) ===
    JSON.stringify(['index.json', 'notes/alpha.json', 'notes/beta.json', 'notes/delta.json', 'notes/gamma.json', 'notes/unicode.json']),
  tree(alpha.git, legacyRef).join(' ')
);

/* ----------------------------------- what a note must be (bc-u1ltu.2) */
//
// One claim, short, with a reason to believe it; and a new key that is nearly an old one is
// refused rather than filed beside it — that is how the worker's store grew nine pairs of the
// same subject under two names.

console.log('\nwhat a note must be');

const G = 'refs/beadcause/agents/guarded';
const put = (key, value, opts) => at(alpha.dir, () => memory.note('guarded', key, value, opts));

await rejects('a note with no evidence is refused, and says what evidence is', () => put('no-evidence', 'a claim'), /--evidence: how you know/);
await rejects('and so is blank evidence', () => put('no-evidence', 'a claim', { evidence: '   ' }), /--evidence/);
await rejects(
  'a note over 4 KB is refused, with the size to aim for',
  () => put('too-long', 'x'.repeat(memory.NOTE_MAX_BYTES + 1), { evidence: 'measured' }),
  /4097 bytes and the cap is 4096 — one note is one claim, aim for 1536/
);
await rejects('a kind outside the four is refused', () => put('bad-kind', 'a claim', { evidence: 'e', kind: 'rumour' }), /kind must be one of gotcha, procedure, fact, decision/);
check('nothing refused reached the ref', alpha.git('for-each-ref', G) === '');

await put('scoped-claim', 'lib/memory.js rebuilds the tree on every write', {
  evidence: 'test/memory.mjs, one blob per note',
  kind: 'fact',
  scope: 'lib/memory.js, lib/gitref.js',
  tags: ['storage'],
});
const body = JSON.parse(alpha.git('cat-file', '-p', `${G}:notes/scoped-claim.json`));
check(
  'the envelope carries the claim, the evidence and the fields, and is verified as written',
  body.value.startsWith('lib/memory.js') &&
    body.evidence === 'test/memory.mjs, one blob per note' &&
    body.kind === 'fact' &&
    JSON.stringify(body.scope) === '["lib/memory.js","lib/gitref.js"]' &&
    JSON.stringify(body.tags) === '["storage"]' &&
    body.verified === body.at,
  JSON.stringify(body)
);
const row = (await at(alpha.dir, () => memory.notesDetail('guarded')))['scoped-claim'];
check(
  'and the index carries what a reader chooses by — kind, scope, tags, verified — but not the evidence',
  row.kind === 'fact' && row.scope.length === 2 && row.tags[0] === 'storage' && row.verified === body.at && !('evidence' in row),
  JSON.stringify(row)
);

check(
  'nearKeys finds a reworded key, a typo and a near-rename, and leaves a series alone',
  JSON.stringify(memory.nearKeys('gate-is-b7e-gate-not-npm-test', ['b7e-gate-is-the-gate-not-npm-test'])) === '["b7e-gate-is-the-gate-not-npm-test"]' &&
    memory.nearKeys('worktre-setup', ['worktree-setup']).length === 1 &&
    memory.nearKeys('test-runner-takes-no-suite-filter', ['test-mjs-takes-no-suite-filter']).length === 1 &&
    memory.nearKeys('orphan-census-kilo', ['orphan-census-echo', 'orphan-census-golf']).length === 0
);
await rejects(
  'a new key close to an existing one is refused, and names it',
  () => put('scoped-claims', 'a second copy', { evidence: 'e' }),
  /scoped-claims is too close to `scoped-claim` — read that first.*--supersede=scoped-claim/
);
await put('scoped-claim', 'lib/memory.js rebuilds the tree on every write, reusing unchanged blobs', { evidence: 'e2' });
check('rewriting the existing key is how a note is corrected, and is not refused', (await at(alpha.dir, () => memory.notes('guarded', 'scoped-claim'))).endsWith('reusing unchanged blobs'));
await rejects('--supersede of a note that is not there is refused', () => put('another-claim', 'x', { evidence: 'e', supersede: 'no-such-note' }), /no such note to replace/);
const sup = await put('scoped-claims-v2', 'the replacement', { evidence: 'e', supersede: 'scoped-claim' });
check(
  '--supersede writes the new key and deletes the old one',
  sup.superseded === 'scoped-claim' &&
    (await at(alpha.dir, () => memory.notes('guarded', 'scoped-claim'))) === null &&
    !('scoped-claim' in (await at(alpha.dir, () => memory.notesDetail('guarded')))) &&
    alpha.git('log', '-1', '--format=%s', G).includes('(supersedes scoped-claim)')
);
check('and the old note is still in the history', alpha.git('cat-file', '-p', `${G}~1:notes/scoped-claim.json`).includes('reusing unchanged blobs'));

const beforeVerify = JSON.parse(alpha.git('cat-file', '-p', `${G}:notes/scoped-claims-v2.json`));
await new Promise((r) => setTimeout(r, 5));
const v = await at(alpha.dir, () => memory.verifyNote('guarded', 'scoped-claims-v2'));
const afterVerify = JSON.parse(alpha.git('cat-file', '-p', `${G}:notes/scoped-claims-v2.json`));
check(
  'verifyNote moves `verified` and nothing else',
  afterVerify.verified === v.verified &&
    afterVerify.verified > beforeVerify.verified &&
    JSON.stringify({ ...afterVerify, verified: null }) === JSON.stringify({ ...beforeVerify, verified: null }),
  JSON.stringify({ beforeVerify, afterVerify })
);
await rejects('and refuses a note that is not there', () => at(alpha.dir, () => memory.verifyNote('guarded', 'nope')), /no note nope to verify/);

/* ------------------- choosing notes for a bead from the index (bc-u1ltu.3) */
//
// The brief used to rank every body in the store and then list every key it had not
// quoted — 1,138 of them for the worker here. It now chooses from the index: notes that
// name the bead, notes scoped to a path the bead names, notes whose key and summary read
// like it; plus the most-read notes of the last thirty days as one line each.

console.log('\nchoosing notes for a bead, from the index');

check(
  'a bead names paths by slash or by extension, trailing punctuation trimmed',
  JSON.stringify(memory.beadPaths({ title: 'Fix lib/memory.js.', description: 'see README.md, and test/memory.mjs; not v2.0' })) ===
    '["lib/memory.js","README.md","test/memory.mjs"]',
  JSON.stringify(memory.beadPaths({ title: 'Fix lib/memory.js.', description: 'see README.md, and test/memory.mjs; not v2.0' }))
);
check(
  'a scope glob covers a file, a directory covers what is in it, and ** crosses directories',
  memory.inScope(['lib/*.js'], ['lib/memory.js']) &&
    memory.inScope(['lib'], ['lib/memory.js']) &&
    memory.inScope(['public/**/*.css'], ['public/css/app.css']) &&
    !memory.inScope(['lib/*.js'], ['lib/sub/deep.js']) &&
    !memory.inScope(['bin/*'], ['lib/memory.js'])
);

const INDEX = {
  'named-in-body': { summary: 'a trap that took an afternoon', at: '2026-09-01', refs: ['bc-q1abc.2'] },
  'scoped-to-memory': { summary: 'rebuilds the tree on every write', at: '2026-09-02', scope: ['lib/memory.js'] },
  'reads-like-it': { summary: 'timesheet export rounds overtime minutes down', at: '2026-09-03' },
  'popular-one': { summary: 'worktree setup needs node_modules linked', at: '2026-08-01' },
  unrelated: { summary: 'nothing to do with any of it', at: '2026-09-04' },
};
const BEAD = { id: 'bc-q1abc.3', title: 'Timesheet export rounds overtime minutes wrongly', description: 'Touches lib/memory.js.' };
const pick = memory.pickNotes(INDEX, BEAD, { reads: new Map([['popular-one', 40], ['unrelated', 2], ['named-in-body', 99]]), keep: 4, popular: 10, floor: 1.6 });
check(
  'a note naming a sibling ranks first, then one scoped to a path the bead names, then one that reads like it',
  JSON.stringify(pick.chosen.map((c) => [c.key, c.why])) ===
    '[["named-in-body","names-bead"],["scoped-to-memory","scope"],["reads-like-it","similar"]]',
  JSON.stringify(pick.chosen)
);
check(
  'the most-read list is by reads, and never repeats a chosen note',
  JSON.stringify(pick.popular) === '[{"key":"popular-one","reads":40},{"key":"unrelated","reads":2}]',
  JSON.stringify(pick.popular)
);

const drawn = memory.notesBrief(
  {
    selected: { 'named-in-body': { value: 'THE BODY of the named note' } },
    popular: [{ key: 'popular-one', reads: 40, summary: 'worktree setup needs node_modules linked' }],
    total: 1140,
  },
  BEAD
);
check(
  'the brief quotes chosen notes whole, lists popular ones as one line, and counts the rest instead of naming them',
  drawn.includes('- **named-in-body** — THE BODY of the named note') &&
    drawn.includes('- `popular-one` — worktree setup needs node_modules linked') &&
    drawn.includes('1138 more notes are in the store') &&
    drawn.includes('beadcause-memory notes --search <words>'),
  drawn
);
check('an empty store still draws nothing', memory.notesBrief({ selected: {}, popular: [], total: 0 }, BEAD) === '');

// Against a real store: `notesFor` from the daemon's side, and a v1 index an older writer left.
await put('trap-in-gitref', 'commitToRef retries once after clearing a stale lock. Bead: bc-q1abc.2', {
  evidence: 'lib/gitref.js',
  scope: ['lib/gitref.js'],
});
const chosen = await memory.notesFor(alpha.dir, 'guarded', { id: 'bc-q1abc.9', title: 'something in lib/gitref.js' });
check(
  'notesFor chooses by scope and by named bead, and opens only what it chose',
  Object.keys(chosen.selected).join() === 'trap-in-gitref' &&
    chosen.selected['trap-in-gitref'].value.includes('stale lock') &&
    chosen.why['trap-in-gitref'] === 'names-bead' &&
    chosen.total === Object.keys(await at(alpha.dir, () => memory.notes('guarded'))).length,
  JSON.stringify(chosen)
);

// A v1 index (no refs, no version 2): rewrite index.json by hand, as .1's code wrote it.
const v1 = JSON.parse(alpha.git('cat-file', '-p', `${G}:index.json`));
for (const r of Object.values(v1.notes)) delete r.refs;
v1.version = 1;
fs.writeFileSync(blobPath, JSON.stringify(v1, null, 2) + '\n');
const v1Blob = alpha.git('hash-object', '-w', blobPath);
const notesTree = alpha.git('rev-parse', `${G}:notes`);
const v1Tree = execFileSync('git', ['-C', alpha.dir, 'mktree'], {
  input: `040000 tree ${notesTree}\tnotes\n100644 blob ${v1Blob}\tindex.json\n`,
  encoding: 'utf8',
}).trim();
alpha.git('update-ref', G, alpha.git('commit-tree', v1Tree, '-p', alpha.git('rev-parse', G), '-m', 'an index from before refs'));
const fromV1 = await memory.notesFor(alpha.dir, 'guarded', { id: 'bc-q1abc.9', title: 'nothing path-like' });
check('an index older than this code is read from the bodies, so a named bead is still found', fromV1.why['trap-in-gitref'] === 'names-bead', JSON.stringify(fromV1.why));
await put('another-write', 'any write rebuilds the index', { evidence: 'e' });
const v2 = JSON.parse(alpha.git('cat-file', '-p', `${G}:index.json`));
check('and the next write rebuilds it at the current version, refs and all', v2.version === 2 && v2.notes['trap-in-gitref'].refs.includes('bc-q1abc.2'), JSON.stringify(v2.notes['trap-in-gitref']));

const found = await at(alpha.dir, () => memory.searchNotes('guarded', 'stale LOCK'));
check('searchNotes matches words in any case against key and summary, best match first', found[0]?.key === 'trap-in-gitref' && found[0].matched === 2, JSON.stringify(found));
check('and a word nothing contains finds nothing', (await at(alpha.dir, () => memory.searchNotes('guarded', 'zzzqqq'))).length === 0);

/* ------------------------------ retiring a note by evidence (bc-u1ltu.4) */
//
// Stale means the evidence says so: a scope that matches nothing, a path HEAD deleted, a
// cited function found nowhere, or thirty days with no read, verify or rewrite. The archive
// is a second ref the live store moves to and from in one transaction.

console.log('\nstale notes and the archive');

// Give alpha some code, then delete part of it, so "gone" has a history to be gone from.
fs.mkdirSync(path.join(alpha.dir, 'lib'), { recursive: true });
fs.writeFileSync(path.join(alpha.dir, 'lib', 'kept.js'), 'export function keptThing() {}\n');
fs.writeFileSync(path.join(alpha.dir, 'lib', 'gone.js'), 'export function goneThing() {}\n');
alpha.git('add', '-A');
alpha.git('commit', '-q', '-m', 'code');
alpha.git('rm', '-q', 'lib/gone.js');
alpha.git('commit', '-q', '-m', 'delete gone.js');

const S = (key, value, opts = {}) => at(alpha.dir, () => memory.note('staler', key, value, { evidence: 'e', ...opts }));
await S('about-kept', 'lib/kept.js exports `keptThing` and that is all');
await S('about-gone-file', 'lib/gone.js is where the trap was');
await S('about-gone-name', 'call `goneThing` before anything else');
await S('scoped-to-nothing', 'a rule about a directory that never existed', { scope: ['src/**'] });
await S('cites-an-example', 'a module like lib/example-not-real.js would need this');

const stale = await memory.staleNotes(alpha.dir, 'staler');
const why = Object.fromEntries(stale.map((s) => [s.key, s.reasons.join(' | ')]));
check('a note citing a deleted file is stale, and says which', /cites paths gone at HEAD: lib\/gone\.js/.test(why['about-gone-file'] || ''), JSON.stringify(why));
check('a note citing a function found nowhere at HEAD is stale', /cites names found nowhere at HEAD: goneThing/.test(why['about-gone-name'] || ''), JSON.stringify(why));
check('a scope that matches nothing at HEAD is stale', /scope matches nothing at HEAD: src\/\*\*/.test(why['scoped-to-nothing'] || ''), JSON.stringify(why));
check(
  'a note about code that is still there is not, and neither is one citing a path that never existed',
  !('about-kept' in why) && !('cites-an-example' in why),
  JSON.stringify(why)
);
const later = await memory.staleNotes(alpha.dir, 'staler', { now: Date.now() + 40 * 86400000 });
check(
  'and forty days on with no read or verify, every note is stale for that reason',
  later.length === 5 && later.every((s) => s.reasons.some((r) => r.startsWith('no read, verify or rewrite in 30 days'))),
  JSON.stringify(later)
);

const LIVE = 'refs/beadcause/agents/staler';
const ARCH = 'refs/beadcause/agents-archive/staler';
const archivedNow = await memory.archiveNotes(alpha.dir, 'staler', [
  { key: 'about-gone-file', reason: 'cites lib/gone.js, deleted' },
  { key: 'not-a-note', reason: 'ignored' },
]);
check('archiving moves the note and skips a key that is not there', JSON.stringify(archivedNow.archived) === '["about-gone-file"]', JSON.stringify(archivedNow));
check(
  'both refs moved in one commit message, and the note kept its blob',
  alpha.git('log', '-1', '--format=%s', LIVE) === alpha.git('log', '-1', '--format=%s', ARCH) &&
    alpha.git('rev-parse', `${ARCH}:notes/about-gone-file.json`) === alpha.git('rev-parse', `${LIVE}~1:notes/about-gone-file.json`)
);
check(
  'an archived note is out of the live listing, key reads, search and the brief',
  !('about-gone-file' in (await at(alpha.dir, () => memory.notes('staler')))) &&
    (await at(alpha.dir, () => memory.notes('staler', 'about-gone-file'))) === null &&
    (await at(alpha.dir, () => memory.searchNotes('staler', 'trap'))).length === 0 &&
    !('about-gone-file' in (await memory.notesFor(alpha.dir, 'staler', { id: 'x-1', title: 'lib/gone.js trap' })).selected)
);
const archIndex = await at(alpha.dir, () => memory.archivedNotes('staler'));
check(
  'and is still there with --archived: readable, searchable, and it says why it went',
  archIndex['about-gone-file']?.archived?.reason === 'cites lib/gone.js, deleted' &&
    (await at(alpha.dir, () => memory.archivedNotes('staler', 'about-gone-file')))?.value === 'lib/gone.js is where the trap was' &&
    (await at(alpha.dir, () => memory.searchNotes('staler', 'trap', { archived: true })))[0]?.key === 'about-gone-file',
  JSON.stringify(archIndex)
);
await memory.restoreNote(alpha.dir, 'staler', 'about-gone-file');
check(
  'restore brings it back as it was, and empties it out of the archive',
  (await at(alpha.dir, () => memory.notes('staler', 'about-gone-file'))) === 'lib/gone.js is where the trap was' &&
    !('about-gone-file' in (await at(alpha.dir, () => memory.archivedNotes('staler')))) &&
    !('archived' in (await at(alpha.dir, () => memory.notesDetail('staler')))['about-gone-file'])
);
await rejects('restoring a note that is not archived is refused', () => memory.restoreNote(alpha.dir, 'staler', 'about-kept'), /no archived note about-kept/);

// The transaction: if either ref moved since it was read, neither moves.
const { commitToRefs } = await import('../lib/gitref.js');
const liveBefore = alpha.git('rev-parse', LIVE);
const archBefore = alpha.git('rev-parse', ARCH);
const emptyTree = alpha.git('hash-object', '-t', 'tree', '-w', '/dev/null');
let refused = false;
try {
  await commitToRefs(alpha.dir, [
    { ref: LIVE, tree: emptyTree, message: 'x', expect: liveBefore },
    { ref: ARCH, tree: emptyTree, message: 'x', expect: liveBefore },
  ]);
} catch {
  refused = true;
}
check(
  'commitToRefs moves every ref or none: one stale expectation refuses both',
  refused && alpha.git('rev-parse', LIVE) === liveBefore && alpha.git('rev-parse', ARCH) === archBefore
);

/* ------------------------------------- and no way to name the repo yourself */
//
// The indirection is the feature, and the way it dies is one caller being handed a path
// "just for this case". Both halves are checked: the API takes no directory, and the CLI
// has no flag for one — including the plausible-looking flags somebody would reach for,
// which are silently ignored rather than quietly honoured.

check(
  'no tier-1 call takes a directory',
  memory.note.length === 3 && memory.notes.length === 1 && memory.notesDetail.length === 1,
  `${memory.note.length} ${memory.notes.length} ${memory.notesDetail.length}`
);

const usage = (await run(process.execPath, [path.join(HERE, '..', 'bin', 'beadcause-memory')])).stdout;
check('and the CLI offers no flag for one', !/--(repo|dir|path|cwd|workspace)/.test(usage), usage);

// This checkout's bin/ first. `agentEnv` points PATH at the *main checkout's* bin/ on
// purpose (bc-xl7n.61, lib/foundation.js), so from a worktree every call below would run
// main's copy of the CLI — which is the code under test only once this has merged. With the
// store's layout changing underneath it (bc-u1ltu.1) that is a red for the wrong reason.
const here = { ...env, PATH: `${path.join(HERE, '..', 'bin')}:${env.PATH}` };
const cli = (line, cwd, e = here) => run('/bin/zsh', ['-lc', line], { env: e, cwd });

await cli('beadcause-memory note owner "the console posts, the worker notes" --repo=/nowhere --evidence=fixture', wtOne);
check(
  'a --repo nobody implemented is ignored, not honoured',
  (await at(alpha.dir, () => memory.notes('console', 'owner'))) === 'the console posts, the worker notes' &&
    (await at(beta.dir, () => memory.notes('console', 'owner'))) === null
);

/* --------------------------------------- the path an agent takes to tier 1 */
//
// Same reasoning as the tier-2 walk above: the library is for the daemon, and an agent's
// entire reach is the command in a login shell. The extra link here is the *directory* —
// an agent is spawned in its worktree, and that is what decides which repo it is talking
// about, so the walk has to be done from one.

const wrote = await cli('beadcause-memory note style "comments carry the reason, not the what" --evidence=fixture', wtOne);
check('the agent noted it against the repo it was standing in', /^noted console\.style in /.test(wrote.stdout.trim()), wrote.stdout);
const readBack = await cli('beadcause-memory notes style', alpha.dir);
check(
  'and reads it back from the main checkout in a later run',
  readBack.stdout.trim() === 'comments carry the reason, not the what',
  readBack.stdout
);

// bc-u1ltu.2 at the command line: the refusal reaches the agent as a non-zero exit with the
// way out in it, and `--verify` needs nothing but the key.
const noEvidence = await cli('beadcause-memory note unproven "a claim with nothing behind it" 2>&1; echo "exit=$?"', wtOne);
check(
  'a note with no --evidence is refused at the CLI, saying what evidence is',
  /exit=1/.test(noEvidence.stdout) && /--evidence: how you know/.test(noEvidence.stdout),
  noEvidence.stdout
);
const verified = await cli('beadcause-memory note --verify style', wtOne);
check('note --verify <key> confirms it without rewriting it', /^verified console\.style at /.test(verified.stdout.trim()), verified.stdout);

// bc-u1ltu.4 at the command line.
const staleOut = await cli('beadcause-memory notes --stale --of=staler', wtOne);
check('notes --stale lists each stale note with its reasons', /about-gone-name\n  cites names found nowhere at HEAD: goneThing/.test(staleOut.stdout), staleOut.stdout);
const archivedCli = await cli('beadcause-memory note --archive=style --reason="superseded by the README"', wtOne);
check('note --archive=<key> moves one note to the archive', /^archived console\.style$/.test(archivedCli.stdout.trim()), archivedCli.stdout);
const archList = await cli('beadcause-memory notes --archived', wtOne);
check('notes --archived lists it with the reason it went', /style .*\(archived .*: superseded by the README\)/.test(archList.stdout), archList.stdout);
const restored = await cli('beadcause-memory note --restore=style', wtOne);
check('note --restore=<key> brings it back', /^restored console\.style$/.test(restored.stdout.trim()) && (await at(alpha.dir, () => memory.notes('console', 'style'))) !== null, restored.stdout);

const missing = await cli('beadcause-memory notes style || echo none', beta.dir);
check('a miss in another repo is a non-zero exit, not a value', missing.stdout.trim() === 'none', missing.stdout);

const otherAgent = await cli('beadcause-memory notes --of=worker layout', wtTwo);
check(
  "--of reads another agent's notes on this repo",
  otherAgent.stdout.trim() === `${LAYOUT}, and scripts/ is neither`,
  otherAgent.stdout
);
// The same provenance line the `recall --of` read gets, and it is the same line by
// construction — one `provenance()` serves both verbs. It says what the note is *worth*
// rather than whose it is: the privacy framing this replaced (bc-pud4) pointed at a fix
// that was rejected, because there is no unpublished half to protect.
check(
  'and still says what the note is worth, on stderr only',
  otherAgent.stdout === `${LAYOUT}, and scripts/ is neither\n` &&
    /never a reason on its own/.test(otherAgent.stderr) &&
    /must face scrutiny/.test(otherAgent.stderr) &&
    !/notes to itself|not published to you|never chose to publish/.test(otherAgent.stderr),
  JSON.stringify({ out: otherAgent.stdout, err: otherAgent.stderr })
);

let noteAs;
try {
  await cli('beadcause-memory note --of=worker layout "the console got in"', wtOne);
  noteAs = null;
} catch (err) {
  noteAs = err;
}
check(
  'note --of is refused — the guard is on writing, and it covers a verb added later',
  noteAs !== null && /cannot be combined with `note`/.test(String(noteAs.stderr)),
  String(noteAs?.stderr)
);
check(
  "and the worker's note is untouched",
  (await at(alpha.dir, () => memory.notes('worker', 'layout'))) === `${LAYOUT}, and scripts/ is neither`
);

/* --------------------- the whole line a work session is actually brought up on */
//
// The worker is the agent that does every piece of code work here, and it is the one
// beadcause does not spawn: `launch` hands a *string* to AppleScript, iTerm types it
// into a **fresh login shell**, and nothing the daemon put in its own environment
// reaches it. Every other agent gets `agentEnv` as a `spawn` option and the whole
// chain is one function call; here the identity and the PATH have to survive being
// written into a command line, typed, and re-read by a shell that has just run
// ~/.zshenv. That is three more places to silently lose them, and losing them fails as
// "the work sessions never used their memory" — which for one release is exactly what
// happened, and is indistinguishable from them choosing not to.
//
// So the command is run. A stand-in `claude` earlier on PATH records what the shell
// handed it and then walks the path an agent walks — `beadcause-memory`, by the name
// the allowlist would match, naming neither itself nor a repo.

console.log('\nthe line a work session is brought up on');

const { sessionCommand } = await import('../lib/session.js');
const { agentExports, systemPrompt, amend } = await import('../lib/foundation.js');

const fakebin = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-worker-bin-'));
const spy = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-worker-spy-'));
process.on('exit', () => {
  removeTreeSync(fakebin);
  removeTreeSync(spy);
});

const stub = (name, body) => {
  const at_ = path.join(fakebin, name);
  fs.writeFileSync(at_, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};

// Everything the window would have shown, written to disk instead. `exit 7` because
// the done file is the daemon's only fact about how a session ended, and a send-off
// that has drifted ahead of the `$?` capture reports every session as a success.
stub(
  'claude',
  `printf '%s' "$BEADCAUSE_AGENT" > "$SPY/agent"
printf '%s' "\${BEADCAUSE_LAUNCHD_PROGRAM-UNSET}" > "$SPY/launchd"
command -v beadcause-memory > "$SPY/which" 2>&1
: > "$SPY/argv"
while [ $# -gt 0 ]; do
  printf '%s\\n' "$1" >> "$SPY/argv"
  if [ "$1" = "--append-system-prompt-file" ]; then cp "$2" "$SPY/system.md"; fi
  shift
done
beadcause-memory remember walked 'a work session found the memory that follows it' > "$SPY/remember" 2>&1
beadcause-memory note walked 'and the one that stays with this repo' --evidence=fixture > "$SPY/note" 2>&1
exit 7`
);
// The send-off's five real seconds, which are worth nothing here — the same stub
// test/sendoff.mjs uses, for the same reason.
stub('sleep', 'exit 0');

const workerF = await effective(path.join(HERE, '..'), 'worker');
check('the worker has a role at all — it is the delivery that was missing', typeof workerF.role === 'string' && workerF.role.length > 0);

const brief_ = memory.memoryBrief('Adam');
const promptFile = path.join(spy, 'brief.md');
// Deliberately not `$SPY/system.md`: that is where the stand-in copies it to, and the
// session deletes the original on its way out — one name for both is a `cp` onto itself
// followed by an `rm`, and the assertions below would read an empty file.
const systemFile = path.join(spy, 'system-as-written.md');
const doneFile = path.join(spy, 'done');
const BRIEF = 'Work bc-goo.9. This is the brief, and it must arrive intact.';
fs.writeFileSync(promptFile, BRIEF);
fs.writeFileSync(systemFile, systemPrompt(workerF, brief_));

// BEADCAUSE_LAUNCHD_PROGRAM is set on purpose, to something this checkout is not: it is
// what an iTerm window carries (bc-6sst), and the assertion below is that the command
// takes it away again. Setting it here is the only way to tell a scrub from a machine
// that happened not to have one — on a laptop where nobody's daemon is running, an
// unscrubbed session and a scrubbed one look identical.
await run('/bin/zsh', ['-lc', sessionCommand(workerF, { dir: wtOne, promptFile, systemFile, mode: 'auto', doneFile })], {
  env: {
    ...process.env,
    PATH: `${fakebin}:${process.env.PATH}`,
    SPY: spy,
    BEADCAUSE_CONFIG_DIR: store,
    BEADCAUSE_LAUNCHD_PROGRAM: '/Users/someone/else/beadcause/bin/router.js',
  },
});

const spied = (name) => (fs.existsSync(path.join(spy, name)) ? fs.readFileSync(path.join(spy, name), 'utf8') : '');

check(
  'the login shell knew which agent it was running',
  spied('agent') === 'worker',
  `${JSON.stringify(spied('agent'))} — the daemon's own env said ${process.env.BEADCAUSE_AGENT}`
);
check(
  'and beadcause-memory resolved by name, from this repo\'s bin',
  spied('which').trim().endsWith('/bin/beadcause-memory'),
  spied('which')
);
// Empty rather than unset, and the difference is the whole point: launchdProgram() reads
// an empty value as the positive "nobody's launchd job" and an absent one as "we do not
// know, fall back to the argv guess". The window is a shell in a terminal, so the
// spawner is in a position to state the first, and the inherited value it would
// otherwise be carrying is a fact about iTerm.app's ancestry rather than about this
// tree — which is what drew HOT-SWAP IS NOT LIVE over a perfectly good install (bc-6sst).
check(
  'and it is not carrying the outer terminal\'s launchd program into the worktree',
  spied('launchd') === '',
  `${JSON.stringify(spied('launchd'))} — the shell was handed /Users/someone/else/beadcause/bin/router.js`
);
check(
  'the session wrote to the memory that follows it',
  (await memory.recall('worker', 'walked')) === 'a work session found the memory that follows it',
  spied('remember')
);
check(
  'and to the one that stays with the repo it was standing in',
  (await at(alpha.dir, () => memory.notes('worker', 'walked'))) === 'and the one that stays with this repo',
  spied('note')
);
check(
  'neither landed under the agent the daemon happened to be',
  (await memory.recall('advocate', 'walked')) === null &&
    (await at(alpha.dir, () => memory.notes('advocate', 'walked'))) === null
);

const argv = spied('argv').split('\n').filter(Boolean);
// Last, not first, and behind a `--` (bc-i4sa). It used to go first because `--tools`
// and `--allowedTools` are variadic and would eat a trailing operand; `--` terminates a
// variadic option too, so last is safe and a brief that opens with a dash is no longer
// read as a flag. test/dashprompt.mjs owns that rule — this is the one place it is
// checked against a real login shell rather than a generated string.
check('the brief still arrived, and last', argv[argv.length - 1] === BRIEF, JSON.stringify(argv));
check('behind the `--` that stops it being read as a flag', argv[argv.length - 2] === '--', JSON.stringify(argv));
check('with the flags before it, where a variadic one cannot eat it', argv.includes('--append-system-prompt-file'), JSON.stringify(argv));
check(
  'the system prompt carried the amendable role',
  spied('system.md').includes('You are a **work session**'),
  spied('system.md').slice(0, 120)
);
check(
  'and the one copy of the memory brief, after it',
  spied('system.md').includes(brief_) && spied('system.md').indexOf(brief_) > spied('system.md').indexOf('work session'),
  String(spied('system.md').includes(brief_))
);
check('the exit status is still claude\'s own', spied('done') === '7', JSON.stringify(spied('done')));
check('the session cleaned up after itself', !fs.existsSync(systemFile) && !fs.existsSync(promptFile));

// The same guarantee `agentEnv` gives, on the side where it is a shell line rather
// than an object: a later `export` wins, which is why the identity is emitted last.
const shellImpostor = await run('/bin/zsh', [
  '-lc',
  `${agentExports({ ...workerF, env: { BEADCAUSE_AGENT: 'advocate' } })}; printf '%s' "$BEADCAUSE_AGENT"`,
]);
check('an amended env cannot change who the work session is', shellImpostor.stdout === 'worker', shellImpostor.stdout);

// `env` is amendable and a key is not quoted the way a value is, so a key that is not
// a variable name is a command sitting in the middle of the line.
const dodgy = agentExports({ ...workerF, env: { 'X; touch /tmp/beadcause-pwned': '1' } });
check('an env key that is not a variable name is dropped, not run', !dodgy.includes('touch'), dodgy);

// The other half of the acceptance: the amendment loop can approve a change to what a
// work session *is*, and the next one comes up under it. Written to the repo the
// session runs in, because that is where `launch` reads it from.
await amend(wtOne, 'worker', { role: 'You are a work session, and this line was approved.' }, {
  bead: 'bc-goo.9',
  justification: 'the test that the loop reaches the worker at all',
});
const amended = await effective(wtOne, 'worker');
check(
  'an approved amendment to the role reaches the next session',
  amended.role === 'You are a work session, and this line was approved.' && amended.amended.includes('role'),
  JSON.stringify(amended.amended)
);
check(
  'and it still cannot delete the memory brief, which is not its to amend',
  systemPrompt(amended, brief_).includes('beadcause-memory notes ')
);

/* ------------------------- two worktrees of one repo, writing at the same time */
//
// The case tier 1 actually meets: a dozen worker sessions in a dozen worktrees are one
// agent kind writing to one ref, and none of them knows the others exist. Distinct keys,
// so a lost race is a missing key rather than a value somebody has to reason about — and
// the whole notes object is rebuilt from the tip on every write, which is exactly what a
// lost CAS would silently undo.

console.log('\nsix processes noting into one repo, from two worktrees');

const SELF = fileURLToPath(import.meta.url);
const noters = Array.from({ length: 6 }, (_, i) =>
  run(process.execPath, [SELF, '--note', `k${i}`, `value ${i}`], {
    cwd: i % 2 ? wtOne : wtTwo,
    env: { ...process.env, BEADCAUSE_AGENT: 'racer' },
  })
);
const notedResults = await Promise.allSettled(noters);
const lost = notedResults.filter((r) => r.status === 'rejected');
check('every writer landed', lost.length === 0, lost.map((r) => r.reason?.message).join(' | '));

const raced1 = await at(alpha.dir, () => memory.notes('racer'));
check(
  'all six notes are there — nobody was overwritten',
  JSON.stringify(Object.keys(raced1).sort()) === JSON.stringify(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']),
  JSON.stringify(raced1)
);
check(
  'and the ref is one unbroken chain of six commits',
  alpha.git('log', '--format=%H', 'refs/beadcause/agents/racer').split('\n').filter(Boolean).length === 6
);
check(
  'the other repo saw none of it',
  Object.keys(await at(beta.dir, () => memory.notes('racer'))).length === 0
);

/* ------------------------ which of them a session is handed without asking */
//
// The pull — "check `notes` before you start" in the system prompt — only works on a
// session that remembers to. This is the push, and the whole risk of a push is that it
// is either too big to read or too noisy to trust, so the two things worth asserting are
// that the right note gets in and that a bead with nothing to do with any of them gets
// no notes at all. `relevantNotes` is pure, so none of this goes near git.

console.log('\nwhat a work brief is handed, selected against the bead');

// Shaped like the real store: a key that reads as a claim, a body that names files and
// commands, and — for two of them — the bead the session was working when it learned it.
const STORE = {
  'test-browse-flake': {
    value:
      'A red test/browse.mjs on a branch that touches neither lib/browse.js nor bin/beadcause-browse ' +
      'is the concurrency flake, not you: it globs beadcause-browse-* out of the system temp dir and ' +
      "another session's in-flight run fails it. Beads: bc-wcw3, bc-eldx.",
    at: '2026-08-11T14:07:40.999Z',
  },
  'sw-cache-version-conflicts': {
    value:
      'public/sw.js is the most likely merge conflict here: every branch touching public/ bumps ' +
      "`const CACHE = beadcause-vNN`, and resolving it is not 'take the higher number' — read both " +
      "sides' comment blocks and renumber your own.",
    at: '2026-08-11T14:36:36.114Z',
  },
  'warm-check-is-the-refresh-gate': {
    value:
      'scripts/warm-check.mjs is the real regression gate for a refresh path — run it for bc-rk2o.2-.5 too.',
    at: '2026-08-11T14:01:12.979Z',
  },
  'android-app-is-a-webview': {
    value:
      'The Android app renders the PWA in a WebView over the tailnet; there are no bundled assets, so ' +
      'REBUILT is only owed when the diff touches android/ itself.',
    at: '2026-08-11T14:14:57.314Z',
  },
};

const flake = memory.relevantNotes(STORE, {
  id: 'bc-zdun',
  title: 'test/browse.mjs fails whenever a second session runs the suite',
  description: 'The last assertion globs the system temp dir, so another concurrent npm test fails it.',
});
check(
  'the note about the failing suite is the one a bead about that suite is handed',
  flake[0]?.key === 'test-browse-flake',
  flake.map((n) => n.key).join(', ')
);
check(
  'and it is not handed the three that are about something else',
  flake.length === 1,
  flake.map((n) => `${n.key}:${n.score.toFixed(2)}`).join(', ')
);

// The case similarity alone cannot reach, and the reason the bead-id signal exists: the
// note is *about* this bead and shares almost no words with it. It says so in the only
// vocabulary both sides share — it names the bead — and that convention is real, not
// hoped for: nineteen of the twenty notes in this repo's own store name a bead.
const child = memory.relevantNotes(STORE, { id: 'bc-rk2o.3', title: 'Put monitor on the delta stream' });
check(
  'a note naming the bead is handed over even when it reads nothing like it',
  child[0]?.key === 'warm-check-is-the-refresh-gate' && child[0].named && child[0].score < memory.RELEVANT,
  child.map((n) => `${n.key} named=${n.named} score=${n.score.toFixed(2)}`).join(', ')
);
check(
  'and the parent id counts, which is how a range like `bc-rk2o.2-.5` reaches every child',
  memory.relevantNotes(STORE, { id: 'bc-rk2o.5', parent: 'bc-rk2o', title: 'Put console on the delta stream' })[0]?.named === true
);

// The case that decides whether the section is worth reading at all. A brief that
// carries four notes about the tests for a bead about timesheets is noise, and a section
// that is noise once is a section nobody reads again.
const unrelated = { id: 'bc-nvzc', title: 'Populate Clockify timesheets for July 2026', description: 'Fill in the hours per project.' };
check('a bead about none of it is handed none of it', memory.relevantNotes(STORE, unrelated).length === 0);

const brief0 = memory.notesBrief(STORE, unrelated);
check('it still learns the store exists, by key', brief0.includes('`sw-cache-version-conflicts`') && brief0.includes('beadcause-memory notes <key>'));
check('and every key is in that line — the cap is on bodies, never on what is visible', Object.keys(STORE).every((k) => brief0.includes(`\`${k}\``)), brief0);
check('a repo with no notes at all gets no heading rather than an empty one', memory.notesBrief({}, unrelated) === '');

const briefed = memory.notesBrief(STORE, {
  id: 'bc-zdun',
  title: 'test/browse.mjs fails whenever a second session runs the suite',
  description: 'The last assertion globs the system temp dir, so another concurrent npm test fails it.',
});
check('the section quotes the note in full, not a summary of it', briefed.includes('bin/beadcause-browse'), briefed);
check('and lists the rest by key without their bodies', briefed.includes('`android-app-is-a-webview`') && !briefed.includes('over the tailnet'), briefed);

// Both caps, and which of them wins. A note is taken whole or not at all — a trap
// clipped mid-sentence is a trap you cannot act on — but the top-ranked one goes in
// however big it is, because a budget that can drop the single most relevant note in the
// store silently is worse than a long section.
const many = Object.fromEntries(
  Array.from({ length: 9 }, (_, i) => [`flake-${i}`, { value: `test/browse.mjs and the system temp dir, take ${i}. `.repeat(6), at: `2026-08-1${i}T00:00:00.000Z` }])
);
check('the count cap holds', memory.relevantNotes(many, { id: 'bc-x', title: 'test/browse.mjs and the system temp dir' }).length === 4);
check(
  'and the character budget holds, below it',
  memory.relevantNotes(many, { id: 'bc-x', title: 'test/browse.mjs and the system temp dir' }, { chars: 400 }).length < 4
);
check(
  'but the most relevant note is never the one the budget drops',
  memory.relevantNotes(many, { id: 'bc-x', title: 'test/browse.mjs and the system temp dir' }, { chars: 1 }).length === 1
);

/* ------------------------------ and the brief says which store to write to */
//
// The acceptance case, and the one that decides whether any of the above gets used. A
// capability an agent has not been told about is one it does not have — `agents` shipped
// in the first version of the memory API and no agent ever ran it, because the brief
// listed four commands and not that one.
//
// A brief that describes one store while two exist is worse than one describing neither:
// the agent writes either way, into whichever it was told about. That is not
// hypothetical — it is what this text did while tier 1 did not exist, and "still true
// next week and in a different repo" was silently ruling out every fact about the
// codebase in front of it.

const brief = memory.memoryBrief('Adam');
check('the brief names the roster', brief.includes('beadcause-memory agents'), brief);
check('and tells them the read exists', brief.includes('--of=<agent>'), brief);
check('and that it is read-only', /only read theirs, never write it/.test(brief), brief);
check('the brief names both verbs of the repo-local store', /beadcause-memory note </.test(brief) && /beadcause-memory notes /.test(brief), brief);
check(
  'and gives the test for choosing between them',
  /would this still be true in a\s+different repo\?/.test(brief),
  brief
);
check(
  'saying what belongs in the one that follows the agent',
  brief.includes('**Yes — `remember`.**') && /approach that worked/.test(brief),
  brief
);
check(
  'and what belongs in the one that stays with the repo',
  brief.includes('**No — `note`.**') && brief.includes('*this* codebase is put together'),
  brief
);
check(
  'and what the cost of getting it wrong is, so the choice is not arbitrary',
  /advice\s+you will follow somewhere it is false/.test(brief) && /never see again once you are working elsewhere/.test(brief),
  brief
);

/* ---------------------------- and the chat session is told *when* to write */
//
// bc-sgu4. The brief above anchors the read half to a moment every run has — "check
// `recall` and `notes` first" — and it fires: thirteen of the thirty-four stored
// conversations open a turn with `beadcause-memory recall`. It anchors the write half
// to nothing, and the console is the one agent with no end of its own to hang it on: a
// worker's brief numbers the write as a closing step, dispatch exits after one comment,
// and a chat ends by the user not replying. Three days and twenty-eight conversations
// later it had read constantly and written nothing.
//
// So each of the two protocols names its own moment, and both are asserted here for the
// reason the paragraphs above are: a prompt paragraph is the load-bearing part of this
// feature and nothing else in the suite would notice it going missing.

const chat = await import('../lib/console.js');

check(
  'the proposal protocol names the write, not just the read',
  /beadcause-memory remember/.test(chat.PROTOCOL) && /\bnote\b/.test(chat.PROTOCOL),
  chat.PROTOCOL
);
check(
  'and ties it to the one terminal act a console conversation has',
  /before you write the block/i.test(chat.PROTOCOL),
  chat.PROTOCOL
);
check(
  'and says silence is the usual answer, so it does not become a second tracker',
  /teach nothing worth\s+keeping/.test(chat.PROTOCOL),
  chat.PROTOCOL
);

// The path that matters for every agent *except* the console: `agentEnv` stamps
// BEADCAUSE_AGENT from the foundation being chatted with, so a memory written here is
// written as the advocate, or as dispatch, or as the worker. For the advocate it is the
// only path there has ever been — `memoryBrief` otherwise reaches it through
// `surveyPrompt`, and no survey has ever run.
const chatted = chat.chatProtocol('Adam');
check(
  'a chat with any other agent names the write too',
  /beadcause-memory remember/.test(chatted) && /\bnote\b/.test(chatted),
  chatted
);
check(
  'with its own moment, because a chat has no end to save it up for',
  /no end to save it up for/.test(chatted),
  chatted
);

process.chdir(path.join(HERE, '..'));

// bc-pud4, the decision that closed the curated-subset question. Neither half of it
// is enforceable in code — one is what an agent expects of its readers, the other is
// what it does with what it reads — so the brief saying them *is* the mechanism, and
// these two checks are the only thing standing between the ruling and a silent
// revert. Both directions matter: the write half is why no second store was built.
check(
  'and the write half: expect to be read, because there is no private half',
  /Expect every other agent to read what you write/.test(brief) && /no private half/.test(brief),
  brief
);
check(
  'and the read half: never a reason on its own, and it faces scrutiny',
  /can never\s+be your reason/.test(brief) && /scrutiny/.test(brief),
  brief
);

/* ------------------------------------------------- six writers, one topic */

console.log('\nsix processes posting to one topic');

const posters = Array.from({ length: 6 }, (_, i) =>
  run(process.execPath, [SELF, '--post', 'race', `message ${i}`], { env: process.env })
);
const results = await Promise.allSettled(posters);
const failed = results.filter((r) => r.status === 'rejected');
check('every writer landed', failed.length === 0, failed.map((r) => r.reason?.message).join(' | '));

const raced = await memory.read('race', 0, { limit: 100 });
check('six messages are on the topic', raced.length === 6, JSON.stringify(raced.map((m) => m.seq)));
check(
  'with the sequence 1..6 exactly once each — nobody was overwritten',
  JSON.stringify(raced.map((m) => m.seq)) === JSON.stringify([1, 2, 3, 4, 5, 6]),
  JSON.stringify(raced.map((m) => m.seq))
);
check(
  'and the ref is one unbroken chain of six commits',
  git('log', '--format=%H', 'refs/beadcause/bus/race').split('\n').filter(Boolean).length === 6
);

/* ------------------------------------------------------------------ done */

console.log(failures ? `\n${failures} check${failures === 1 ? '' : 's'} failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
