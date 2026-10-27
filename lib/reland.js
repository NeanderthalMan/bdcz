/**
 * Land a branch that never reached `main` onto today's `main` — `bin/b7e-reland` is the
 * argv shell; this is the git reading and the three ways of landing behind it.
 *
 * bc-dgx7.199 names four sessions (bc-ka5y.51, bc-dgx7.185, bc-dgx7.186, bc-dgx7.187),
 * all on lib/notinmain.js cards about 1,100-1,700 commits behind, that landed such a branch
 * four different ways (cherry-pick, cherry-pick then `git apply --3way`, `merge --squash`,
 * `merge --no-commit`) and none of which could ask in advance what its method would leave
 * the sweep seeing.
 *
 * ## Downmerges
 *
 * A downmerge is a merge commit that brought `main` into the branch. It carries nothing of
 * the branch's own work, and landing it as a commit of its own is how a month-old tree
 * gets laid over today's. A merge commit is a downmerge when its second parent is already
 * an ancestor of the base (or its subject says it merged main); everything else is real.
 * Real commits whose patch `git cherry` finds upstream under another sha are set aside
 * separately, because picking them again is how a conflict is made out of nothing.
 *
 * ## What the sweep sees afterwards
 *
 * lib/notinmain.js counts `base..tip` by sha and then asks `git cherry`. So `merge` makes
 * the old tip an ancestor and clears the card by itself, `pick` clears it only if every
 * real patch ends up upstream, and `squash` never does: the tip stays unmerged forever and
 * the card has to be closed by hand.
 */
import { execFile } from 'node:child_process';
import { git, gitCode, ok } from './gitref.js';
import * as pr from './pr.js';

export const HOWS = ['merge', 'squash', 'pick'];

export const SWEEP_EFFECT = {
  merge: 'the old tip becomes an ancestor of HEAD, so the notinmain sweep clears by itself',
  pick: 'clears by itself only if every real commit was picked (git cherry then sees the patches upstream)',
  squash: 'the sweep keeps seeing the old tip as unmerged — close its card by hand',
};

const DOWNMERGE_SUBJECT = /^Merge (remote-tracking )?(branch|commit) '?(origin\/)?(main|master)'?|^Merge (origin\/)?main\b/i;

/** Parse argv (already stripped of node and script) to `{ branch, bead, how, dryRun, dir, base, json, error }`. */
export function parseArgs(argv) {
  const out = { branch: null, bead: null, how: null, dryRun: false, dir: null, base: 'main', json: false };
  const takes = { '--bead': 'bead', '--how': 'how', '--dir': 'dir', '--base': 'base' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--json') out.json = true;
    else if (takes[a]) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { ...out, error: `${a} needs a value` };
      out[takes[a]] = v;
      i += 1;
    } else if (a.startsWith('-')) return { ...out, error: `unknown flag ${a}` };
    else if (!out.branch) out.branch = a;
    else return { ...out, error: `unexpected argument ${a}` };
  }
  if (!out.branch) return { ...out, error: 'give the branch to land' };
  if (out.how && !HOWS.includes(out.how)) return { ...out, error: `--how is one of ${HOWS.join(', ')}` };
  return out;
}

/** git's stdout whatever its exit code — `merge-tree` answers with 1 on a conflict. */
const gitAny = (dir, args) =>
  new Promise((resolve) =>
    execFile('git', args, { cwd: dir, maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (err, stdout) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: stdout || '' })
    )
  );

const lines = (s) => String(s || '').split('\n').filter((l) => l.length);

async function commitRef(dir, ref) {
  const sha = await ok(git(dir, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]));
  return sha ? sha.trim() : null;
}

/** The branch's tip, local ref first, then origin's — or null. */
export async function resolveBranch(dir, branch) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const sha = await commitRef(dir, ref);
    if (sha) return { ref, sha };
  }
  return null;
}

/** `origin/<base>` if this checkout has it, else `<base>`. */
export async function resolveBase(dir, base) {
  for (const [ref, name] of [[`refs/remotes/origin/${base}`, `origin/${base}`], [`refs/heads/${base}`, base]]) {
    const sha = await commitRef(dir, ref);
    if (sha) return { ref, sha, name };
  }
  return null;
}

/**
 * Split `base..tip` into real commits, downmerges, and real commits already upstream by
 * patch-id. Oldest first, so `real` is the order a pick must run in.
 */
export async function classifyCommits(dir, tip, baseSha) {
  const out = await git(dir, ['log', '--reverse', '--format=%H%x00%P%x00%s', `${baseSha}..${tip}`]);
  const rows = lines(out).map((l) => {
    const [sha, parents, subject] = l.split('\0');
    return { sha, parents: parents.split(' ').filter(Boolean), subject };
  });
  const upstream = new Set();
  for (const l of lines(await ok(git(dir, ['cherry', baseSha, tip])))) if (l.startsWith('- ')) upstream.add(l.slice(2).trim());
  const real = [];
  const downmerges = [];
  const alreadyOnMain = [];
  for (const c of rows) {
    if (c.parents.length > 1) {
      const second = await gitCode(dir, ['merge-base', '--is-ancestor', c.parents[1], baseSha]);
      if (second.code === 0 || DOWNMERGE_SUBJECT.test(c.subject)) downmerges.push(c);
      else real.push(c); // a merge of some other branch is the branch's own work
    } else if (upstream.has(c.sha)) alreadyOnMain.push(c);
    else real.push(c);
  }
  return { total: rows.length, real, downmerges, alreadyOnMain };
}

/** Lines of a diff that begin with `sign`, minus the file headers, trimmed and non-blank. */
function signed(diff, sign) {
  const header = sign === '+' ? '+++' : '---';
  return lines(diff).filter((l) => l[0] === sign && !l.startsWith(header)).map((l) => l.slice(1).trim()).filter(Boolean);
}

/**
 * What a merge of `tip` into `base` would do, without touching the tree: the conflicted
 * files, and the files that merge CLEAN yet drop text `base` added since the merge-base —
 * bc-dgx7.185's lib/suppliers.js, which merged without a word and reverted a newer comment.
 */
export async function previewMerge(dir, baseSha, tip) {
  const mbOut = await ok(git(dir, ['merge-base', baseSha, tip]));
  if (!mbOut) return { ok: false, reason: 'the branch and the base share no history' };
  const mb = mbOut.trim();
  const mt = await gitAny(dir, ['merge-tree', '--write-tree', '--name-only', baseSha, tip]);
  const [head, ...rest] = mt.stdout.split('\n');
  const tree = head.trim();
  if (!/^[0-9a-f]{40,64}$/.test(tree)) return { ok: false, reason: 'git merge-tree gave no tree (does this git have --write-tree?)' };
  const blank = rest.indexOf('');
  const conflicted = [...new Set((blank === -1 ? rest : rest.slice(0, blank)).map((s) => s.trim()).filter(Boolean))];
  const mainFiles = new Set(lines(await ok(git(dir, ['diff', '--name-only', mb, baseSha]))));
  const branchFiles = new Set(lines(await ok(git(dir, ['diff', '--name-only', mb, tip]))));
  const cleanBoth = [...branchFiles].filter((f) => mainFiles.has(f) && !conflicted.includes(f));
  const revertsMain = [];
  for (const f of cleanBoth) {
    const mainAdded = new Set(signed((await ok(git(dir, ['diff', mb, baseSha, '--', f]))) || '', '+'));
    const dropped = signed((await ok(git(dir, ['diff', baseSha, tree, '--', f]))) || '', '-').filter((l) => mainAdded.has(l));
    if (dropped.length) revertsMain.push({ file: f, count: dropped.length, lines: dropped.slice(0, 5) });
  }
  return { ok: true, clean: conflicted.length === 0, mergeBase: mb, conflicted, cleanBoth, revertsMain };
}

/** Everything known about landing `branch`, read-only. */
export async function plan(dir, branch, { base = 'main' } = {}) {
  const b = await resolveBranch(dir, branch);
  if (!b) return { ok: false, reason: `no local or origin branch named ${branch}` };
  const bs = await resolveBase(dir, base);
  if (!bs) return { ok: false, reason: `neither origin/${base} nor ${base} resolves here` };
  const commits = await classifyCommits(dir, b.sha, bs.sha);
  const behind = Number(((await ok(git(dir, ['rev-list', '--count', `${b.sha}..${bs.sha}`]))) || '0').trim());
  let pulls = [];
  let prError = null;
  try {
    pulls = ((await pr.list(dir, { state: 'all', head: branch, limit: 20 })) || []).filter((r) => r.branch === branch);
  } catch (e) {
    prError = e.message;
  }
  const preview = await previewMerge(dir, bs.sha, b.sha);
  return { ok: true, branch, tip: b.sha, base: bs.name, baseSha: bs.sha, behind, ...commits, pulls, prError, preview };
}

export const messageFor = (p, bead) => `${bead || p.branch}: land ${p.branch} onto ${p.base}`;

/**
 * Land it in `dir`, which must be clean and sit on an ancestor of the base. A clean
 * landing is committed; a conflicted one is left in progress with the conflicted files
 * named, because resolving it is judgment.
 */
export async function land(dir, p, how, { bead } = {}) {
  if (((await ok(git(dir, ['status', '--porcelain']))) || '').trim()) {
    return { ok: false, reason: 'the working tree is not clean — run this from a fresh worktree off origin/main' };
  }
  const head = (await git(dir, ['rev-parse', 'HEAD'])).trim();
  if ((await gitCode(dir, ['merge-base', '--is-ancestor', head, p.baseSha])).code !== 0) {
    return { ok: false, reason: `HEAD is not on ${p.base} — start from a fresh worktree off it` };
  }
  const message = messageFor(p, bead);
  const stop = async (what) => ({
    ok: false,
    conflicted: lines(await ok(git(dir, ['diff', '--name-only', '--diff-filter=U']))),
    reason: `${what} stopped on conflicts — resolve them, git add, then commit with: ${message}`,
  });
  if (how === 'merge') {
    if ((await gitCode(dir, ['merge', '--no-ff', '-m', message, p.tip])).code !== 0) return stop('merge');
  } else if (how === 'squash') {
    if ((await gitCode(dir, ['merge', '--squash', p.tip])).code !== 0) return stop('squash');
    await git(dir, ['commit', '-m', message, '--allow-empty']);
  } else {
    for (const c of p.real) {
      const args = ['cherry-pick', '-x', ...(c.parents.length > 1 ? ['-m', '1'] : []), c.sha];
      if ((await gitCode(dir, args)).code !== 0) return stop(`cherry-pick of ${c.sha.slice(0, 8)}`);
    }
  }
  return { ok: true, head: (await git(dir, ['rev-parse', 'HEAD'])).trim(), message };
}
