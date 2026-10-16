#!/usr/bin/env node
/**
 * The no-diff ending's ready-made close card goes through b7e-recard (bc-xl7n.198).
 *
 * A bare `bd update --append-notes` card is shadowed by any spent decision block already
 * in `description` or `design` (toQuestion reads description, design, notes — first block
 * wins), so the phone kept drawing the old question. b7e-recard retires those first.
 */
import { workPromptFor } from '../lib/session.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};

const pr = { autoMerge: true };
const text = workPromptFor('demo', { id: 'zz-1', title: 'A bead' }, 1, pr, 'Adam');
check('the close card is written through b7e-recard', /b7e-recard -w demo -b zz-1/.test(text));
check('it no longer appends the card to notes by hand', !/bd update zz-1 --append-notes "\$\(cat <<'DECISION'/.test(text));

const none = workPromptFor('demo', { id: 'zz-1', title: 'A bead' }, 1, null, 'Adam');
check('a brief with no pull request mode carries no such card', !/b7e-recard/.test(none));

process.exit(failed ? 1 : 0);
