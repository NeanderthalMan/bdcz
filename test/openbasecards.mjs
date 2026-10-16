#!/usr/bin/env node
/**
 * lib/prboard.js — `openBaseCards`, the narrower answer for a multi-repo workspace's
 * red-base watch (bc-xl7n.103).
 *
 *     npm test
 *     node test/openbasecards.mjs
 *
 * Pure function, synthetic board objects, no git and no `gh` — the ancestry plumbing is
 * `test/prboard.mjs`'s job, this is only the selection rule.
 */
import { openBaseCards } from '../lib/prboard.js';

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail) => {
  failures += 1;
  console.log(`  ✗ ${name}\n      ${detail}`);
};
const check = (name, cond, detail = '') => (cond ? ok(name) : bad(name, detail));

const card = (over = {}) => ({
  key: 'northwind/atrium-service',
  workspace: 'northwind',
  dir: '/repos/atrium-service',
  base: 'main',
  error: null,
  prs: [{ state: 'OPEN', isDraft: false }],
  ...over,
});

console.log('\nopenBaseCards\n');

check(
  'a card with an open, non-draft pull request is kept',
  openBaseCards({ repos: [card()] }, 'northwind').length === 1
);

check(
  'a card from a different workspace is dropped',
  openBaseCards({ repos: [card({ workspace: 'other' })] }, 'northwind').length === 0
);

check(
  'a card with no pull requests at all is dropped',
  openBaseCards({ repos: [card({ prs: [] })] }, 'northwind').length === 0
);

check(
  'a card whose only pull request is closed is dropped',
  openBaseCards({ repos: [card({ prs: [{ state: 'CLOSED', isDraft: false }] })] }, 'northwind').length === 0
);

check(
  'a card whose only pull request is merged is dropped',
  openBaseCards({ repos: [card({ prs: [{ state: 'MERGED', isDraft: false }] })] }, 'northwind').length === 0
);

check(
  'a card whose only open pull request is a draft is dropped',
  openBaseCards({ repos: [card({ prs: [{ state: 'OPEN', isDraft: true }] })] }, 'northwind').length === 0
);

check(
  'one open, non-draft pull request among several others is enough to keep the card',
  openBaseCards(
    { repos: [card({ prs: [{ state: 'MERGED', isDraft: false }, { state: 'OPEN', isDraft: true }, { state: 'OPEN', isDraft: false }] })] },
    'northwind'
  ).length === 1
);

check(
  'a card `forRepo` gave up on (an error, and no directory) is dropped even with an open pull request',
  openBaseCards({ repos: [card({ dir: null, error: 'no checkout' })] }, 'northwind').length === 0
);

check(
  'an empty board answers no cards, not a throw',
  openBaseCards(null, 'northwind').length === 0
);

check(
  'a workspace with several qualifying repos gets all of them, and only them',
  (() => {
    const board = {
      repos: [
        card({ key: 'northwind/a', dir: '/a' }),
        card({ key: 'northwind/b', dir: '/b', prs: [{ state: 'CLOSED', isDraft: false }] }),
        card({ key: 'northwind/c', dir: '/c' }),
        card({ key: 'other/d', workspace: 'other', dir: '/d' }),
      ],
    };
    const kept = openBaseCards(board, 'northwind').map((c) => c.key);
    return kept.length === 2 && kept.includes('northwind/a') && kept.includes('northwind/c');
  })()
);

console.log('');
if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
} else {
  console.log('all checks passed');
}
