#!/usr/bin/env node
/**
 * lib/repos.js — the approved list of checkouts one workspace may be worked in.
 *
 *     npm test
 *     node test/repos.mjs
 *
 * Six things are worth a file here, and every one of them is a way a session could be
 * opened in a checkout nobody meant it to touch:
 *
 * 1. **An approved repo resolves token → directory.** The whole point: a bead carrying
 *    `as` is about `~/northwind.dev/atrium-service`, because that is what the checkout's
 *    own `config/config.yaml` says it is.
 * 2. **An unlisted directory resolves to nothing.** Not "resolves to a warning" —
 *    nothing. A repo sitting under the root that Adam never approved must be invisible,
 *    including by its own service token, because the root is a tree you clone into and
 *    approval is a decision.
 * 3. **A duplicate token resolves to nothing either, and says which repos.** This is not
 *    hypothetical: on this Mac three Northwind repos declare `as`, two declare `ps`, and
 *    eight declare `xs` because `service-template` ships it as a placeholder. First
 *    match wins would send a session into whichever sorted first.
 * 4. **A repo whose token is missing or unreadable does not silently become the default
 *    repo.** "No token on the bead → architecture" is right; "token I could not resolve
 *    → architecture" is how work aimed at one service lands in the repo that holds the
 *    workspace's Dolt remote.
 * 5. **A trailing YAML comment is not part of the token.** One real repo declares
 *    `serviceToken: prs   # ps already in use by pricing-service`, and a line-scan that
 *    kept the comment would invent a token no bead will ever carry.
 * 6. **Off costs nothing.** Almost every workspace is one repo, and one with no `repos`
 *    block must not produce a single read — counted here, not assumed.
 *
 * Entirely on a temp tree: fake checkouts, fake `config/config.yaml`, no `~`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTmp } from './helpers/tmp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beadcause-repos-'));
// Before anything under lib/ is imported: CONFIG_DIR resolves once, at module load.
process.env.BEADCAUSE_CONFIG_DIR = path.join(tmp, 'config');
fs.mkdirSync(process.env.BEADCAUSE_CONFIG_DIR, { recursive: true });

const repos = await import(LIB('repos.js'));
const { repoList, resolveRepo, multiRepo, repoWarnings, repoStatusLine, defaultRepo, forgetRepos } = repos;

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  ✗ ${name}\n      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

/* ------------------------------------------------------------------ the tree */

const ROOT = path.join(tmp, 'northwind.dev');

/** A checkout with a `config/config.yaml`. `token: null` writes a file that declares none. */
function checkout(name, token, { extra = '', file = 'config/config.yaml' } = {}) {
  const dir = path.join(ROOT, name);
  const target = path.join(dir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const lines = ['---', `serviceName: ${name}`];
  if (token !== null) lines.push(`serviceToken: ${token}`);
  lines.push('serviceType: internal', extra);
  fs.writeFileSync(target, `${lines.filter(Boolean).join('\n')}\n`);
  return dir;
}

checkout('architecture', 'architecture');
checkout('atrium-service', 'as');
checkout('audio-service', 'as');
checkout('bookings-service', 'bs');
// The real one, comment and all — see reason 5 in the header.
checkout('promotions-service', 'prs   # ps already in use by pricing-service');
// Cloned, listed, and it declares nothing.
checkout('northwind-apps', null);
// Cloned and never approved. It has a perfectly good token; it must still be invisible.
checkout('secrets-service', 'ss');
// Approved below but never cloned.
const NOT_CLONED = path.join(ROOT, 'webhook-service');
// A checkout somewhere else entirely, listed by path.
const ELSEWHERE = path.join(tmp, 'other', 'tools');
fs.mkdirSync(path.join(ELSEWHERE, 'config'), { recursive: true });
fs.writeFileSync(path.join(ELSEWHERE, 'config', 'config.yaml'), 'serviceToken: tls\n');

const cfg = {
  repos: {
    northwind: {
      root: ROOT,
      default: 'architecture',
      approved: [
        'architecture',
        'atrium-service',
        'audio-service',
        'bookings-service',
        'promotions-service',
        'northwind-apps',
        'webhook-service',
        ELSEWHERE,
      ],
    },
  },
};

const list = repoList(cfg, 'northwind');
const named = (n) => list.repos.find((r) => r.name === n);

/* ------------------------------------------------------- 1. token → directory */

console.log('\na listed repo resolves token → directory');
{
  const { repo, problem } = resolveRepo(cfg, 'northwind', 'bs');
  check('bs → bookings-service', repo?.name === 'bookings-service', JSON.stringify({ repo, problem }));
  check('and it is an absolute directory on disk', repo?.dir === path.join(ROOT, 'bookings-service'), repo?.dir);
  check('with no problem beside it', problem === null, String(problem));
  check('the same answer whatever the case of the token', resolveRepo(cfg, 'northwind', 'BS').repo?.name === 'bookings-service');
  check('a checkout listed by absolute path resolves too', resolveRepo(cfg, 'northwind', 'tls').repo?.dir === ELSEWHERE);
  check('and it is named by its basename', resolveRepo(cfg, 'northwind', 'tls').repo?.name === 'tools');
  check('multiRepo says this workspace is more than one repo', multiRepo(cfg, 'northwind') === true);
}

/* ------------------------------------------- 2. an unlisted directory is nothing */

console.log('\nan unlisted directory under the root resolves to nothing');
{
  const { repo, problem } = resolveRepo(cfg, 'northwind', 'ss');
  check('its service token resolves to no repo', repo === null, JSON.stringify(repo));
  check('and the reason says so rather than naming a fallback', /no approved northwind repo declares/.test(String(problem)), String(problem));
  check('it is not in the list at all', !named('secrets-service'), 'an unapproved repo reached the list');
  check(
    'and the problem does not mention the default repo',
    !/architecture/.test(String(problem)) || /approved:/.test(String(problem)),
    String(problem)
  );
  check('nothing warns about it either — it was never claimed', !list.warnings.some((w) => /secrets-service/.test(w)), list.warnings.join(' | '));
}

/* --------------------------------------------------- 3. a duplicate token is named */

console.log('\na duplicate token is a named warning, and resolves to nothing');
{
  const { repo, problem } = resolveRepo(cfg, 'northwind', 'as');
  check('it resolves to no repo', repo === null, JSON.stringify(repo));
  check('and NOT to the default repo', repo?.name !== 'architecture', 'a colliding token fell back to the default');
  check('the reason names both repos', /atrium-service/.test(String(problem)) && /audio-service/.test(String(problem)), String(problem));
  check('the collision is reported on load', list.duplicates.some((d) => d.token === 'as' && d.names.length === 2), JSON.stringify(list.duplicates));
  check(
    'as a warning that names the token and the repos',
    list.warnings.some((w) => /"as"/.test(w) && /atrium-service/.test(w) && /audio-service/.test(w)),
    list.warnings.join(' | ')
  );
  check('both repos are still listed — nothing is wrong with the checkouts', !!named('atrium-service') && !!named('audio-service'));
}

/* ------------------------------- 4. missing / unreadable never becomes the default */

console.log('\na missing or tokenless repo is a named warning, and never the default');
{
  check('a listed repo that is not cloned is unresolved', list.unresolved.some((u) => u.dir === NOT_CLONED), JSON.stringify(list.unresolved));
  check(
    'and the warning says where it should be and what to do',
    list.warnings.some((w) => w.includes(NOT_CLONED) && /approved/.test(w)),
    list.warnings.join(' | ')
  );
  check(
    'a cloned repo declaring no serviceToken is unresolved too',
    list.unresolved.some((u) => u.name === 'northwind-apps' && /declares no serviceToken/.test(u.problem)),
    JSON.stringify(list.unresolved)
  );
  check(
    'and that is a warning naming the repo',
    list.warnings.some((w) => /northwind-apps/.test(w) && /serviceToken/.test(w)),
    list.warnings.join(' | ')
  );
  const byName = resolveRepo(cfg, 'northwind', 'northwind-apps');
  check('asking for it by name resolves to no repo', byName.repo === null, JSON.stringify(byName.repo));
  check('and not to the default repo', byName.repo?.name !== 'architecture', 'a broken repo fell back to the default');
  check('with a reason that says why', /declares no serviceToken/.test(String(byName.problem)), String(byName.problem));
  check('neither is in repos', !named('webhook-service') && !named('northwind-apps'));
}

/* --------------------------------------------------- 5. a comment is not the token */

console.log('\na trailing YAML comment is not part of the token');
{
  check('promotions-service declares prs, not "prs   # ps already in use…"', named('promotions-service')?.token === 'prs', named('promotions-service')?.token);
  check('and it resolves', resolveRepo(cfg, 'northwind', 'prs').repo?.name === 'promotions-service');
  check('the comment text is not a token of its own', resolveRepo(cfg, 'northwind', 'ps').repo === null);
}

/* ----------------------------------------------------------- the default repo */

console.log('\na bead with no service token');
{
  const { repo, problem } = resolveRepo(cfg, 'northwind', '');
  check('resolves to the default repo', repo?.name === 'architecture', JSON.stringify({ repo, problem }));
  check('and defaultRepo says the same', defaultRepo(cfg, 'northwind')?.name === 'architecture');
  check('null and undefined are the same as empty', resolveRepo(cfg, 'northwind', null).repo?.name === 'architecture' && resolveRepo(cfg, 'northwind').repo?.name === 'architecture');

  // A default that does not resolve must not quietly become "the first one".
  const bent = { repos: { northwind: { ...cfg.repos.northwind, default: 'webhook-service' } } };
  const out = resolveRepo(bent, 'northwind', '');
  check('a default naming a repo that did not resolve gives no repo', out.repo === null, JSON.stringify(out.repo));
  check('and says so as a warning on load', repoList(bent, 'northwind').warnings.some((w) => /default is "webhook-service"/.test(w)), repoList(bent, 'northwind').warnings.join(' | '));

  // Named by its token rather than its directory — both are how a person would write it.
  const byToken = { repos: { northwind: { ...cfg.repos.northwind, default: 'bs' } } };
  check('a default named by service token resolves', resolveRepo(byToken, 'northwind', '').repo?.name === 'bookings-service');

  // One repo and no argument about which it is.
  const alone = { repos: { solo: { root: ROOT, approved: ['bookings-service'] } } };
  check('one approved repo and no default is that repo', resolveRepo(alone, 'solo', '').repo?.name === 'bookings-service');

  // Several, and nobody said which.
  const undecided = { repos: { many: { root: ROOT, approved: ['architecture', 'bookings-service'] } } };
  const none = resolveRepo(undecided, 'many', '');
  check('several repos and no default is no repo', none.repo === null, JSON.stringify(none.repo));
  check('with a reason naming the setting', /repos\.many\.default/.test(String(none.problem)), String(none.problem));
}

/* ------------------------------------------------------------- 6. off costs nothing */

console.log('\na workspace with no repos block costs nothing');
{
  const realRead = fs.readFileSync;
  const realStat = fs.statSync;
  let reads = 0;
  fs.readFileSync = (...a) => (reads += 1, realRead(...a));
  fs.statSync = (...a) => (reads += 1, realStat(...a));
  try {
    const empty = repoList(cfg, 'sorrel');
    check('the list is empty', empty.repos.length === 0 && empty.warnings.length === 0);
    check('multiRepo is false', multiRepo(cfg, 'sorrel') === false);
    check('resolveRepo answers with no repo and no problem', (() => {
      const r = resolveRepo(cfg, 'sorrel', '');
      return r.repo === null && r.problem === null;
    })());
    check('a config with no repos block at all is the same', multiRepo({}, 'sorrel') === false && repoList({}, 'sorrel').repos.length === 0);
    check(`and not one file was touched (${reads})`, reads === 0, `${reads} reads`);
  } finally {
    fs.readFileSync = realRead;
    fs.statSync = realStat;
  }
}

/* ----------------------------------------------------- what the startup log says */

console.log('\nwhat the startup log says');
{
  const warnings = repoWarnings(cfg);
  check('repoWarnings carries every warning of every workspace', warnings.length === list.warnings.length && warnings.every((w, i) => w === list.warnings[i]), warnings.join(' | '));
  check('a config with no repos at all warns about nothing', repoWarnings({}).length === 0);
  const line = repoStatusLine(cfg);
  check('the status line counts the resolved repos', /northwind: 6 repos/.test(line), line);
  check('and says how many did not resolve', /2 unresolved/.test(line), line);
  check('and which repo is the default', /architecture by default/.test(line), line);
  check('with nothing configured it says every workspace is one repo', /every workspace is one repo/.test(repoStatusLine({})), repoStatusLine({}));
}

/* ------------------------------------------------------------------- the memo */

console.log('\nthe answer is memoised, and a renamed service is picked up anyway');
{
  check('bookings-service is bs', resolveRepo(cfg, 'northwind', 'bs').repo?.name === 'bookings-service');
  const file = path.join(ROOT, 'bookings-service', 'config', 'config.yaml');
  fs.writeFileSync(file, 'serviceName: bookings-service\nserviceToken: bldg\n');
  // mtime, not content, is what the memo is keyed on — and two writes inside one
  // millisecond are exactly what a suite does, so the stamp is moved deliberately
  // rather than left to the clock.
  const soon = new Date(Date.now() + 5000);
  fs.utimesSync(file, soon, soon);
  check('the old token stops resolving once the checkout says otherwise', resolveRepo(cfg, 'northwind', 'bs').repo === null);
  check('and the new one does', resolveRepo(cfg, 'northwind', 'bldg').repo?.name === 'bookings-service');
  forgetRepos();
  check('forgetRepos leaves the same answer', resolveRepo(cfg, 'northwind', 'bldg').repo?.name === 'bookings-service');
}

/* ------------------------------------------------- the list is never the directory */

console.log('\nthe list is the only source of repos');
{
  const source = fs.readFileSync(LIB('repos.js'), 'utf8');
  check(
    'nothing in the module reads a directory — approval is a list, not a tree',
    !/readdir/i.test(source.replace(/^\s*\*.*$/gm, '').replace(/^\s*\/\/.*$/gm, '')),
    'a readdir here would make an unapproved checkout workable'
  );
}

await cleanupTmp(tmp);
console.log(failures ? `\n${failures} failed\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
