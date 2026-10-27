#!/usr/bin/env node
/**
 * `npm run preflight` — make this checkout runnable, in one command.
 *
 *     npm run preflight                    # borrow what is missing, say what was done
 *     npm run preflight -- --check         # report only, change nothing
 *     node scripts/preflight.mjs --dir <root>   # another tree (this is how it is tested)
 *
 * The first thing to run in a fresh worktree, and the thing `npm test` runs for you before
 * the first suite. bc-th3i is why: a worktree has neither `node_modules` nor
 * `public/vendor` — both are gitignored, both are meant to be borrowed from the main
 * checkout rather than built — and a session that does not know that reads the first
 * failure as a regression in its own diff. It took four full runs of the suite in worktree
 * `design-system-z665` to get past the setup, stopping at suites 155, 96 and 232, because
 * the runner stops at the first failure and each gap hid the next.
 *
 * What it can fix it fixes, because both fixes are a symlink into the checkout upstairs:
 * idempotent, milliseconds, and covered by `.gitignore` either way, so nothing it writes
 * can reach a commit. What it cannot fix it *names*, with the command, and exits 1 —
 * a tree with no dependencies to borrow needs `npm install`, and that is a person's
 * decision in a worktree, where it costs 160 MB that the attic sweep will later drop.
 *
 * `lib/borrow.js` holds the two shapes and the checks; this is the front door to them, and
 * `test/preflight.mjs` drives both against synthesized checkouts.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, inspect, repair } from '../lib/borrow.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const dirAt = argv.indexOf('--dir');
const ROOT = dirAt === -1 ? path.join(HERE, '..') : path.resolve(argv[dirAt + 1] || '.');

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const found = inspect(ROOT);

if (!found.length) {
  console.log(dim('[preflight] node_modules and public/vendor are both here'));
  process.exit(0);
}

if (checkOnly) {
  for (const p of found) console.log(`[preflight] ${describe(p)}`);
  process.exit(1);
}

const { done, left } = repair(ROOT, found);
for (const d of done) console.log(dim(`[preflight] ${d.did}`));
for (const p of left) console.log(red(`[preflight] ${describe(p)}`));
process.exit(left.length ? 1 : 0);
