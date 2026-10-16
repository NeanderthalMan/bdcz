#!/usr/bin/env node
/**
 * **`--also`: the other beads a delivery carried** — held out of the queue, not closed.
 *
 *     npm test
 *     node test/deliveralso.mjs
 *
 * `bin/deliver.js` takes one `-b`, writes the `bead:` block for it, parks it behind the
 * merge-bead and comments on it. A branch that delivered *two* beads used to leave the
 * second with nothing at all — no comment, no edge, no marker — so it stayed open with no
 * blocker and went straight back to `bd ready`, and an advocate opened a worker window over
 * work already in a pull request (bc-cigq6 on PR #98; bc-jvt0.7). The merge cannot be made
 * to close it: `candidateTiers` in lib/beadref.js deliberately reads the declared bead as
 * its own tier so that a bead merely *named* is never closed (bc-khoe.30.16).
 *
 * What is asserted, in the order it can go wrong:
 *
 * 1. **The other bead is out of every queue** — `superseded-by:<-b>` on it, `open` rather
 *    than `in_progress` (the sweep reads open rows only), a blocking edge onto `-b`, and
 *    never the `human` label, which would permanently prevent the close card.
 * 2. **It says which pull request carried it**, on the other bead, and `-b`'s own comment
 *    names it back. A bead nobody speaks for is the bug; one that is spoken for silently
 *    is the same bug a day later.
 * 3. **The merge is not widened.** The pull request body still declares `-b` and only
 *    `-b` — asserted on the body handed to `gh pr create`, which is what `candidateTiers`
 *    reads. Nothing here may close a second bead.
 * 4. **A typo is refused before anything is pushed**, and `--also` naming `-b` itself is
 *    refused for the same reason. No pull request, no write.
 * 5. **It is the same on the other ending** — `--review` files a question card instead of
 *    queueing, and the other bead is held there too. And a delivery with no `--also` writes
 *    no marker at all: the flag is opt-in, so every existing delivery is unchanged.
 * 6. **The brief tells a group window about it** — and a window that is not one of a group
 *    is not told, because a flag a single-bead session cannot use is noise in its brief.
 *
 * Real git against a real bare remote; `gh` and `bd` are fakes keyed off JSON world files
 * with a call log each. Nothing here reaches the network, a real tracker or a phone.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DELIVER = path.join(HERE, '..', 'bin', 'deliver.js');

let failures = 0;
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  if (detail) console.log(`      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-deliveralso-'));
const CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(CONFIG_DIR, { recursive: true });

/* --------------------------------------------------------------- the fake bd */

const WORLD = path.join(tmp, 'world.json');
const BD_LOG = path.join(tmp, 'bd-calls.log');
const FAKE_BD = path.join(tmp, 'bd');

const world = () => JSON.parse(fs.readFileSync(WORLD, 'utf8'));
const bdCalls = () =>
  fs
    .readFileSync(BD_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

/**
 * A world file, not a log: what is being asserted is what the tracker *looks like*
 * afterwards. Unlike test/approval.mjs's fake this one understands `label add` and
 * `update --status=`, because those are the two writes `mark` in lib/superseded.js makes
 * and a fake that swallowed them would pass every check below over an untouched bead.
 */
fs.writeFileSync(
  FAKE_BD,
  `#!/usr/bin/env node
const fs = require('fs');
const WORLD = ${JSON.stringify(WORLD)};
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(BD_LOG)}, JSON.stringify(args) + '\\n');
const w = JSON.parse(fs.readFileSync(WORLD, 'utf8'));
const save = () => fs.writeFileSync(WORLD, JSON.stringify(w, null, 2));
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const all = (name) => args.map((a, i) => (a === name ? args[i + 1] : null)).filter(Boolean);
const die = (msg) => { process.stderr.write(msg + '\\n'); process.exit(1); };
const hydrate = (issue) => ({
  ...issue,
  dependencies: (issue.dependencies || []).map((d) => ({ ...d, status: (w.issues[d.id] || {}).status || 'closed' })),
});

if (args[0] === 'show') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error fetching ' + args[1] + ': no issue found');
  process.stdout.write(JSON.stringify([hydrate(issue)]));
  process.exit(0);
}
if (args[0] === 'list') {
  const label = flag('--label');
  const rows = Object.values(w.issues)
    .filter((i) => (label ? (i.labels || []).includes(label) : true))
    .filter((i) => i.status !== 'closed')
    .map(hydrate);
  process.stdout.write(JSON.stringify(rows));
  process.exit(0);
}
if (args[0] === 'create') {
  const id = 'zz-' + (w.seq = (w.seq || 0) + 1);
  w.issues[id] = {
    id,
    title: flag('--title') || '',
    description: flag('--description') || '',
    labels: all('--label'),
    status: 'open',
    issue_type: flag('--type') || 'task',
    dependencies: [],
  };
  save();
  process.stdout.write(JSON.stringify({ id }));
  process.exit(0);
}
if (args[0] === 'close') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error: no issue found matching "' + args[1] + '"');
  issue.status = 'closed';
  save();
  process.exit(0);
}
if (args[0] === 'comment') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error: no issue found matching "' + args[1] + '"');
  (issue.comments = issue.comments || []).push(args[2]);
  save();
  process.exit(0);
}
if (args[0] === 'label' && args[1] === 'add') {
  const issue = w.issues[args[2]];
  if (!issue) die('Error: no issue found matching "' + args[2] + '"');
  issue.labels = [...new Set([...(issue.labels || []), args[3]])];
  save();
  process.exit(0);
}
if (args[0] === 'update') {
  const issue = w.issues[args[1]];
  if (!issue) die('Error: no issue found matching "' + args[1] + '"');
  const status = args.find((a) => a.startsWith('--status='));
  if (status) issue.status = status.slice('--status='.length);
  save();
  process.exit(0);
}
if (args[0] === 'dep' && args[1] === 'add') {
  const issue = w.issues[args[2]];
  if (!issue) die('Error: no issue found matching "' + args[2] + '"');
  issue.dependencies = issue.dependencies || [];
  if (!issue.dependencies.some((d) => d.id === args[3])) issue.dependencies.push({ id: args[3], dependency_type: 'blocks' });
  save();
  process.exit(0);
}
if (args[0] === 'dep' && args[1] === 'relate') {
  const issue = w.issues[args[2]];
  if (!issue) die('Error: no issue found matching "' + args[2] + '"');
  issue.dependencies = issue.dependencies || [];
  issue.dependencies.push({ id: args[3], dependency_type: 'relates-to' });
  save();
  process.exit(0);
}
if (args[0] === 'dep' && args[1] === 'remove') {
  const issue = w.issues[args[2]];
  if (!issue) die('Error: no issue found matching "' + args[2] + '"');
  issue.dependencies = (issue.dependencies || []).filter((d) => d.id !== args[3]);
  save();
  process.exit(0);
}
process.stdout.write('[]');
`,
  { mode: 0o755 }
);

/* --------------------------------------------------------------- the fake gh */

const BIN = path.join(tmp, 'bin');
fs.mkdirSync(BIN, { recursive: true });
const GH_STATE = path.join(tmp, 'gh.json');
const GH_LOG = path.join(tmp, 'gh-calls.log');

fs.writeFileSync(GH_STATE, JSON.stringify({ next: 60, prs: {} }));
fs.writeFileSync(
  path.join(BIN, 'gh'),
  `#!/usr/bin/env node
const fs = require('fs');
const STATE = ${JSON.stringify(GH_STATE)};
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(GH_LOG)}, JSON.stringify(args) + '\\n');
const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
const save = () => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const out = (t) => { process.stdout.write(t); process.exit(0); };
const fail = (t) => { process.stderr.write(t + '\\n'); process.exit(1); };
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const find = (ref) => Object.values(s.prs).find((p) => p.headRefName === ref || String(p.number) === String(ref));

if (args[0] === 'auth') out('Logged in to github.com\\n');
if (args[0] === 'repo' && args[1] === 'view') out(JSON.stringify({ nameWithOwner: 'acme/widgets' }));
if (args[0] === 'pr') {
  if (args[1] === 'create') {
    const head = flag('--head');
    const number = s.next++;
    s.prs[head] = {
      number,
      title: flag('--title') || '',
      url: 'https://github.com/acme/widgets/pull/' + number,
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      headRefName: head,
      baseRefName: flag('--base') || 'main',
      additions: 3,
      deletions: 1,
      changedFiles: 1,
      statusCheckRollup: [{ name: 'build', conclusion: 'SUCCESS' }],
      reviewDecision: null,
      mergedAt: null,
      mergeCommit: null,
    };
    save();
    out(s.prs[head].url + '\\n');
  }
  const pr = find(args[2]);
  if (args[1] === 'view') {
    if (!pr) fail('no pull requests found for branch ' + args[2]);
    out(JSON.stringify(pr));
  }
  if (args[1] === 'comment') out('commented\\n');
}
fail('unknown gh invocation: ' + args.join(' '));
`,
  { mode: 0o755 }
);

const ghCalls = () =>
  fs
    .readFileSync(GH_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
/** The body handed to `gh pr create` — the text `candidateTiers` will later read. */
const createdBody = () => {
  const c = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');
  return c ? c[c.indexOf('--body') + 1] || '' : null;
};
/** Every comment posted on the pull request, joined. */
const prComments = () =>
  ghCalls()
    .filter((a) => a[0] === 'pr' && a[1] === 'comment')
    .map((a) => a[a.indexOf('--body') + 1] || a.slice(3).join(' '))
    .join('\n');

/* ------------------------------------------------------------------- the repo */

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 't@e',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 't@e',
    },
  }).trim();

const origin = path.join(tmp, 'origin.git');
const repo = path.join(tmp, 'repo');
git(tmp, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
git(tmp, 'clone', '--quiet', origin, repo);
git(repo, 'config', 'user.email', 't@e');
git(repo, 'config', 'user.name', 'test');
fs.writeFileSync(path.join(repo, 'file.txt'), 'one\n');
git(repo, 'add', 'file.txt');
git(repo, 'commit', '--quiet', '-m', 'one');
git(repo, 'push', '--quiet', '-u', 'origin', 'main');

const branchOff = (name) => {
  git(repo, 'checkout', '--quiet', 'main');
  git(repo, 'checkout', '--quiet', '-b', name);
  fs.writeFileSync(path.join(repo, `${name}.txt`), `${name}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', name);
};

/* ----------------------------------------------------------------- the config */

const wsDir = path.join(tmp, 'ws');
fs.mkdirSync(path.join(wsDir, '.beads'), { recursive: true });
fs.writeFileSync(
  path.join(CONFIG_DIR, 'config.json'),
  JSON.stringify({
    port: 4318,
    host: '127.0.0.1',
    baseUrl: 'http://127.0.0.1:4318',
    token: 'deliveralso-token',
    actor: 'beadcause-test',
    bdBin: FAKE_BD,
    workspaces: [{ name: 'demo', dir: wsDir }],
    sessionDirs: { demo: repo },
    pr: { base: 'main', mergeMethod: 'merge', autoMerge: true, mergeWaitMs: 1000 },
    openSessions: false,
    claudeSessions: false,
    ntfy: { enabled: false },
    advocates: { enabled: false, workspaces: [] },
  })
);

/** Run a delivery the way a worker ends. Returns `{ code, out, err }` — a refusal is data. */
function deliver(extra = []) {
  const args = [DELIVER, '-w', 'demo', '--dir', repo, '--tests', 'npm test — green', ...extra];
  const res = spawnSync(process.execPath, args, {
    cwd: repo,
    encoding: 'utf8',
    input: 'What changed and why.',
    env: { ...process.env, BEADCAUSE_CONFIG_DIR: CONFIG_DIR, PATH: `${BIN}${path.delimiter}${process.env.PATH}` },
  });
  return { code: res.status ?? 1, out: String(res.stdout || '').trim(), err: String(res.stderr || '') };
}

const issue = (id, over = {}) => ({
  id,
  title: `The work of ${id}`,
  description: '',
  labels: [],
  status: 'in_progress',
  issue_type: 'task',
  dependencies: [],
  ...over,
});

const reset = (issues) => {
  fs.writeFileSync(WORLD, JSON.stringify({ seq: 300, issues: Object.fromEntries(issues.map((i) => [i.id, i])) }));
  fs.writeFileSync(BD_LOG, '');
  fs.writeFileSync(GH_LOG, '');
};

/* --------------------------------------------- two beads, one branch, one queue */

console.log('\na branch that delivered two beads, on the merge queue\n');

{
  reset([issue('zz-a'), issue('zz-b'), issue('zz-c', { status: 'open' })]);
  branchOff('work-two-beads');

  const r = deliver(['-b', 'zz-a', '--also', 'zz-b', '--also', 'zz-c']);
  const w = world();
  const number = (r.out.match(/^queued #(\d+) /) || [])[1];

  check('it queues, printing the merge-bead rather than `landed`', Boolean(number), `${r.out} | ${r.err}`);
  check(
    'the declared bead is parked behind the merge-bead exactly as before',
    (w.issues['zz-a'].dependencies || []).some((d) => d.id === r.out.split(' ').pop()),
    JSON.stringify(w.issues['zz-a'].dependencies)
  );

  for (const id of ['zz-b', 'zz-c']) {
    const i = w.issues[id];
    check(`${id} carries superseded-by:zz-a, which takes it out of every queue`, (i.labels || []).includes('superseded-by:zz-a'), JSON.stringify(i.labels));
    check(`${id} is open, not in_progress — the close-card sweep reads open rows only`, i.status === 'open', i.status);
    check(
      `${id} is blocked on zz-a as well`,
      (i.dependencies || []).some((d) => d.id === 'zz-a' && d.dependency_type === 'blocks'),
      JSON.stringify(i.dependencies)
    );
    check(`${id} never gets the human label — that would prevent the close card for good`, !(i.labels || []).includes('human'));
    check(
      `${id} has a comment naming the pull request that carried it`,
      (i.comments || []).some((c) => c.includes(`#${number}`) && c.includes('zz-a')),
      JSON.stringify(i.comments)
    );
    check(`${id} is not closed by the delivery`, i.status !== 'closed');
  }

  check(
    'the declared bead’s own comment says the others were carried and held',
    (w.issues['zz-a'].comments || []).some((c) => c.includes('zz-b') && c.includes('zz-c')),
    JSON.stringify(w.issues['zz-a'].comments)
  );
  check('and so does the comment on the pull request', /zz-b/.test(prComments()) && /zz-c/.test(prComments()), prComments());

  const body = createdBody() || '';
  check('the pull request body declares the -b bead', /^\s*bead:\s*zz-a\s*$/m.test(body), body.slice(-300));
  check('and does NOT declare, or even name, the others — the merge is not widened', !/zz-b|zz-c/.test(body), body);
}

/* ------------------------------------------------------------ a re-delivery */

console.log('\nthe same delivery run again\n');

{
  const before = world().issues['zz-b'];
  const r = deliver(['-b', 'zz-a', '--also', 'zz-b']);
  const after = world().issues['zz-b'];
  check('it still queues', /^queued #\d+ /.test(r.out), `${r.out} | ${r.err}`);
  check(
    'and marks nothing twice — one marker, one carried comment',
    after.labels.filter((l) => l.startsWith('superseded-by:')).length === 1 &&
      (after.comments || []).length === (before.comments || []).length,
    JSON.stringify({ labels: after.labels, before: before.comments?.length, after: after.comments?.length })
  );
}

/* ------------------------------------------------------- refused before a push */

console.log('\nnames that cannot be honoured\n');

{
  reset([issue('zz-a'), issue('zz-b')]);
  branchOff('work-typo');

  const r = deliver(['-b', 'zz-a', '--also', 'zz-nope']);
  check('a bead that does not exist is a refusal, not a guess', r.code !== 0 && /zz-nope/.test(r.err), `${r.code} ${r.err}`);
  check(
    'and nothing was pushed or opened: no pull request, no tracker write',
    !ghCalls().some((a) => a[0] === 'pr' && a[1] === 'create') &&
      !bdCalls().some((a) => ['create', 'comment', 'label', 'update', 'dep'].includes(a[0])),
    JSON.stringify(bdCalls().filter((a) => a[0] !== 'show'))
  );

  const self = deliver(['-b', 'zz-a', '--also', 'zz-a']);
  check('naming the -b bead as an --also is refused too', self.code !== 0 && /itself/.test(self.err), `${self.code} ${self.err}`);

  const bare = deliver(['-b', 'zz-a', '--also']);
  check('a bare --also with no id is refused', bare.code !== 0, `${bare.code} ${bare.err}`);
}

/* ------------------------------------------------ an already-closed other bead */

console.log('\nan --also bead that is already closed\n');

{
  reset([issue('zz-a'), issue('zz-b', { status: 'closed' })]);
  branchOff('work-closed-also');

  const r = deliver(['-b', 'zz-a', '--also', 'zz-b']);
  check('the delivery still queues — a closed bead has nothing to hold', /^queued #\d+ /.test(r.out), `${r.out} | ${r.err}`);
  check('and it is left closed, unmarked', world().issues['zz-b'].status === 'closed' && !(world().issues['zz-b'].labels || []).length);
  check('with the reason said on stderr', /zz-b was not held/.test(r.err), r.err);
}

/* ---------------------------------------------------------- the card ending */

console.log('\nthe other ending: --review files a question card\n');

{
  reset([issue('zz-a'), issue('zz-b')]);
  branchOff('work-review');

  const r = deliver(['-b', 'zz-a', '--also', 'zz-b', '--review']);
  check('it does not queue', !/^queued /.test(r.out), r.out);
  check(
    'the other bead is held here as well',
    (world().issues['zz-b'].labels || []).includes('superseded-by:zz-a') && world().issues['zz-b'].status === 'open',
    JSON.stringify(world().issues['zz-b'])
  );
}

/* ------------------------------------------- a branch already merged on github.com */

console.log('\na branch that was already merged on GitHub\n');

{
  // `landHere` is reached from a top-level `await` at the head of bin/deliver.js, before
  // anything below it has run — so a `const` the ending leans on is in its temporal dead
  // zone there. That is the bug this scenario exists for: it crashed with a ReferenceError
  // the first time `--also` was wired into the ending, and only test/redeliver.mjs's
  // already-merged scenario noticed.
  reset([issue('zz-a'), issue('zz-b')]);
  git(repo, 'checkout', '--quiet', 'main');
  git(repo, 'checkout', '--quiet', '-b', 'work-landed-also');
  fs.writeFileSync(path.join(repo, 'landed.txt'), 'landed\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'landed');
  git(repo, 'push', '--quiet', '-u', 'origin', 'work-landed-also');
  git(repo, 'checkout', '--quiet', 'main');
  git(repo, 'merge', '--quiet', '--no-ff', '-m', 'Merge pull request #91', 'work-landed-also');
  git(repo, 'push', '--quiet', 'origin', 'main');
  git(repo, 'checkout', '--quiet', 'work-landed-also');
  const sha = git(repo, 'rev-parse', 'HEAD');

  const state = JSON.parse(fs.readFileSync(GH_STATE, 'utf8'));
  state.prs['work-landed-also'] = {
    number: 91,
    title: 'zz-a: the work',
    url: 'https://github.com/acme/widgets/pull/91',
    state: 'MERGED',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    headRefName: 'work-landed-also',
    baseRefName: 'main',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    statusCheckRollup: [],
    reviewDecision: null,
    mergedAt: '2026-08-10T12:00:00Z',
    mergeCommit: { oid: sha },
  };
  fs.writeFileSync(GH_STATE, JSON.stringify(state, null, 2));

  const r = deliver(['-b', 'zz-a', '--also', 'zz-b']);
  const w = world();
  check('it reports a landing, not a crash', r.out.startsWith('landed #91'), `${r.code} ${r.out} | ${r.err.split('\n').slice(0, 4).join(' / ')}`);
  check('the declared bead is closed over the merge', w.issues['zz-a'].status === 'closed', w.issues['zz-a'].status);
  check(
    'and the other one is held and open — spoken for, not closed',
    (w.issues['zz-b'].labels || []).includes('superseded-by:zz-a') && w.issues['zz-b'].status === 'open',
    JSON.stringify(w.issues['zz-b'])
  );
  check('with the comment naming the pull request', (w.issues['zz-b'].comments || []).some((c) => c.includes('#91')), JSON.stringify(w.issues['zz-b'].comments));
}

/* ----------------------------------------------------------- opt-in, nothing else */

console.log('\na delivery without --also\n');

{
  reset([issue('zz-a'), issue('zz-b')]);
  branchOff('work-plain');

  const r = deliver(['-b', 'zz-a']);
  check('it queues as it always did', /^queued #\d+ /.test(r.out), `${r.out} | ${r.err}`);
  check(
    'and writes no supersede marker on anything',
    !bdCalls().some((a) => a[0] === 'label') && !Object.values(world().issues).some((i) => (i.labels || []).some((l) => l.startsWith('superseded-by:'))),
    JSON.stringify(bdCalls().filter((a) => a[0] === 'label'))
  );
  check('and says nothing about other beads on the pull request', !/Also delivered/.test(prComments()), prComments());
}

/* ---------------------------------------------------------------- the brief */

console.log('\nthe brief a group window is handed\n');

{
  const { workPromptFor } = await import(path.join(HERE, '..', 'lib', 'session.js'));
  const wt = { deliver: 'beadcause-deliver', base: 'main', worktree: true };
  const group = {
    name: 'the-pair',
    epic: 'zz-epic',
    prompt: 'Do them together.',
    prs: [{ repo: 'widgets', title: 'one change' }],
    beads: [{ id: 'zz-b', title: 'The second' }],
  };
  const grouped = workPromptFor('demo', { id: 'zz-a', title: 'The first', group }, 1, wt, 'Adam');
  const alone = workPromptFor('demo', { id: 'zz-a', title: 'The first' }, 1, wt, 'Adam');
  const soloGroup = workPromptFor('demo', { id: 'zz-a', title: 'The first', group: { ...group, beads: [] } }, 1, wt, 'Adam');

  check('a group window is told about --also', /--also/.test(grouped));
  check('and that the merge closes only the declared bead', /closes only the declared bead/.test(grouped));
  check('a window on a plain bead is not told — it has no other bead to name', !/--also/.test(alone));
  check('nor is a group of one, which has no sibling to name', !/--also/.test(soloGroup));
}

/* ------------------------------------- --branch: a revive from a fresh worktree */

console.log('\n--branch: delivering onto a pull request branch this worktree does not hold (bc-xl7n.189)\n');

{
  reset([issue('zz-a')]);
  branchOff('revive-local-xl7n189');

  const r = deliver(['-b', 'zz-a', '--branch', 'pr-head-xl7n189']);
  const remote = git(repo, 'ls-remote', '--heads', 'origin');
  const create = ghCalls().find((a) => a[0] === 'pr' && a[1] === 'create');

  check('it queues', /^queued #\d+ /.test(r.out), `${r.out} | ${r.err}`);
  check('HEAD was pushed to the named remote branch', /refs\/heads\/pr-head-xl7n189$/m.test(remote), remote);
  check('and not under the local branch name', !/revive-local-xl7n189/.test(remote), remote);
  check('the pull request is opened from that head', create && create[create.indexOf('--head') + 1] === 'pr-head-xl7n189', JSON.stringify(create));

  const bad = deliver(['-b', 'zz-a', '--branch', 'main']);
  check('--branch main is refused like running on main', bad.code !== 0 && /refusing/.test(bad.err), `${bad.code} ${bad.err}`);
  const odd = deliver(['-b', 'zz-a', '--branch', 'a..b']);
  check('a malformed --branch is refused', odd.code !== 0 && /not a branch name/.test(odd.err), `${odd.code} ${odd.err}`);
}

await cleanupTmp(tmp);

console.log(failures ? `\n\x1b[31m${failures} failed\x1b[0m\n` : '\n\x1b[32mall checks passed\x1b[0m\n');
process.exit(failures ? 1 : 0);
