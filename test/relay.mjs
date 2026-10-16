#!/usr/bin/env node
/**
 * lib/relay.js — the department relay dispatcher, and the section of brief it writes.
 *
 *     npm test
 *     node test/relay.mjs
 *
 * A relay changes *who the agent in a window is*, which is the first thing in this program
 * that is not a fact about scheduling — so what has to hold is mostly about not firing:
 *
 * 1. **Nothing that is not a relay bead changes by a character.** Most workspaces declare
 *    no relay at all, and most beads in one that does are assigned to a person or to
 *    nobody. Every one of those must produce the brief it produced before,
 *    byte for byte — asserted against a brief built with no relay rather than against a
 *    substring, because a section that leaks in anywhere is a generic session being told
 *    it is five agents.
 *
 * 2. **The chain is derived from the loop, not typed.** Draft, check, revise,
 *    file. A checker that is the drafting role drops out — editor drafting a Story bead is
 *    checked by critic alone and does not check itself — and the revise step exists only
 *    when something actually checked.
 *
 * 3. **Executive gets no relay.** chair, ledger and steward produce process, not reviewable
 *    deliverables. A bead assigned to one of them is an ordinary bead, and that has to be
 *    true of `steward` in particular, because `steward` is also the filer at the end of every
 *    chain and therefore a role the definition knows.
 *
 * 4. **The `dept:` label wins over the roster.** It is the routing label a human set;
 *    the roster is the fallback for a bead nobody labelled.
 *
 * 5. **The brief says the three things the relay cannot work without** — that the assignee
 *    is a role and not a person, that the packet is a bead of its own that nothing here
 *    closes, and that a hand-back must name the next role. That last one is the resume
 *    mechanism in its entirety: `--claim` destroys the assignee, so a hand-back that
 *    clears it instead of naming a role loses the chain silently.
 *
 * 6. **No relay ships.** A workspace is relayed by its own declaration and by nothing
 *    else — a workspace name alone relays nothing (bc-j2zwo.3; the shipped `relays: {}` is
 *    asserted in test/relaydefs.mjs against an isolated config directory).
 *
 * Pure functions throughout — no tracker, no checkout, no window, nothing under `~`.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = (name) => path.join(HERE, '..', 'lib', name);

let failures = 0;
let ran = 0;
async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err && err.message ? err.message : String(err)).split('\n').join('\n       ')}`);
  }
}

console.log('\ndepartment relays — who the agent in the window is\n');

const { chainFor, chainLine, departmentOf, profilePath, relayFor, roleOf, rolesOf } = await import(LIB('relay.js'));
const { workPromptFor } = await import(LIB('session.js'));

/**
 * A studio small enough to read, with the two shapes that matter in it: a department whose
 * checks include one of its own members (Story — editor and critic are both Story), and one
 * whose checks are staffed elsewhere (Design — editor is a Story agent checking Design work).
 */
const CFG = {
  relays: {
    studio: {
      profile: 'staff/{role}/{role}.md',
      docs: ['docs/CHARTER.md', 'docs/REVIEW.md'],
      filer: 'steward',
      packet: ['sign-off', 'human'],
      executive: ['chair', 'ledger', 'steward'],
      departments: {
        'dept:story': { name: 'Story', lead: 'plotter', members: ['scribe', 'author', 'plotter', 'editor', 'critic'], check: ['editor', 'critic'] },
        'dept:design': { name: 'Design', lead: 'colorist', members: ['colorist', 'stylist', 'mapper'], check: ['editor', 'colorist'] },
        'dept:solo': { name: 'Solo', lead: 'solon', members: ['solon'], check: [] },
      },
    },
  },
};

const bead = (over = {}) => ({ id: 'lm-1', title: 'Chapter 7', assignee: '', labels: [], ...over });
const line = (b, ws = 'studio', cfg = CFG) => {
  const c = chainFor(cfg, ws, b);
  return c ? chainLine(c) : null;
};

/* ------------------------------------------------------- 1. the ordinary bead */

await check('a workspace with no relay entry never relays', () => {
  assert.equal(line(bead({ assignee: 'author', labels: ['dept:story'] }), 'sorrel'), null);
  assert.equal(chainFor({}, 'studio', bead({ assignee: 'author' })), null);
  assert.equal(chainFor({ relays: {} }, 'studio', bead({ assignee: 'author' })), null);
});

await check('an assignee that is a person, an email or nothing never relays', () => {
  for (const who of ['', 'adam', 'neo@example.com', 'beadcause', 'Author Smith']) {
    assert.equal(line(bead({ assignee: who, labels: ['dept:story'] })), null, `assignee ${JSON.stringify(who)}`);
  }
});

await check('a relay definition with no departments is not a relay', () => {
  assert.equal(relayFor({ relays: { studio: { filer: 'steward' } } }, 'studio'), null);
  assert.equal(relayFor({ relays: { studio: { departments: {} } } }, 'studio'), null);
  assert.equal(relayFor(CFG, ''), null);
});

/* --------------------------------------------------- 2. the chain, and its shape */

await check('the chain is draft, checks, revise, file — in that order', () => {
  const c = chainFor(CFG, 'studio', bead({ assignee: 'author', labels: ['dept:story'] }));
  assert.deepEqual(
    c.steps.map((s) => [s.step, s.role]),
    [
      ['draft', 'author'],
      ['check', 'editor'],
      ['check', 'critic'],
      ['revise', 'author'],
      ['file', 'steward'],
    ]
  );
  assert.equal(chainLine(c), 'author → editor → critic → author → steward');
  assert.equal(c.dept, 'dept:story');
  assert.equal(c.department, 'Story');
  assert.equal(c.lead, 'plotter');
  assert.equal(c.role, 'author');
  assert.equal(c.filer, 'steward');
  assert.deepEqual(c.packet, ['sign-off', 'human']);
});

await check('an agent does not check its own draft', () => {
  // editor is the fact check for Story *and* a Story member. Drafting, it is checked by critic
  // alone — the step it would otherwise occupy is the revise step it already gets.
  assert.equal(line(bead({ assignee: 'editor', labels: ['dept:story'] })), 'editor → critic → editor → steward');
  assert.equal(line(bead({ assignee: 'critic', labels: ['dept:story'] })), 'critic → editor → critic → steward');
});

await check('a department with no checks gets no revise step', () => {
  const c = chainFor(CFG, 'studio', bead({ assignee: 'solon', labels: ['dept:solo'] }));
  assert.deepEqual(
    c.steps.map((s) => [s.step, s.role]),
    [
      ['draft', 'solon'],
      ['file', 'steward'],
    ]
  );
});

await check('a checker staffed by another department still checks', () => {
  assert.equal(line(bead({ assignee: 'stylist', labels: ['dept:design'] })), 'stylist → editor → colorist → stylist → steward');
});

await check('a definition with no filer ends at the revise', () => {
  const noFiler = { relays: { studio: { ...CFG.relays.studio, filer: '' } } };
  assert.equal(line(bead({ assignee: 'author', labels: ['dept:story'] }), 'studio', noFiler), 'author → editor → critic → author');
});

/* ------------------------------------------------------------- 3. executive */

await check('an executive role gets no relay, including the filer itself', () => {
  for (const who of ['chair', 'ledger', 'steward']) {
    assert.equal(line(bead({ assignee: who, labels: ['dept:story'] })), null, `assignee ${who}`);
  }
  // …and `steward` is a role the definition knows, which is the whole reason this can go
  // wrong: it is the filer at the end of every chain, so it is in `rolesOf`.
  assert.ok(rolesOf(CFG.relays.studio).has('steward'));
  assert.equal(roleOf(CFG.relays.studio, bead({ assignee: 'steward' })), 'steward');
});

/* ------------------------------------------------------- 4. which department */

await check('the dept: label wins over the roster', () => {
  // editor is staffed by Story. Labelled Design, the bead is Design work — and the chain is
  // Design's, with colorist on look, which Story's chain would never have added.
  assert.equal(line(bead({ assignee: 'editor', labels: ['dept:design'] })), 'editor → colorist → editor → steward');
  assert.equal(departmentOf(CFG.relays.studio, bead({ labels: ['dept:design'] }), 'editor').key, 'dept:design');
});

await check('an unlabelled bead falls back to the department that staffs the role', () => {
  assert.equal(line(bead({ assignee: 'author' })), 'author → editor → critic → author → steward');
  assert.equal(line(bead({ assignee: 'mapper' })), 'mapper → editor → colorist → mapper → steward');
});

await check('a role no department staffs and no label places gets no relay', () => {
  // `pundit` is in the shipped studio but not in this fixture's roster at all.
  assert.equal(line(bead({ assignee: 'pundit' })), null);
  assert.equal(departmentOf(CFG.relays.studio, bead(), 'nobody'), null);
});

await check('the assignee is matched case- and space-insensitively', () => {
  assert.equal(line(bead({ assignee: '  AUTHOR  ', labels: ['dept:story'] })), 'author → editor → critic → author → steward');
});

await check('profilePath fills the role into the template, and answers empty for none', () => {
  const c = chainFor(CFG, 'studio', bead({ assignee: 'author', labels: ['dept:story'] }));
  assert.equal(profilePath(c, 'editor'), 'staff/editor/editor.md');
  assert.equal(profilePath({ profile: '' }, 'editor'), '');
  assert.equal(profilePath(c, ''), '');
});

await check('one role can sit somewhere the template does not reach', () => {
  // The real shape: most roles are under the template and one — crier here — wired
  // as a real subagent, is at `.claude/agents/crier.md`. A brief that pointed at the
  // template path for it would name a file that is not there.
  const withOverride = {
    relays: { studio: { ...CFG.relays.studio, profiles: { CRIER: '.claude/agents/crier.md' } } },
  };
  const c = chainFor(withOverride, 'studio', bead({ assignee: 'author', labels: ['dept:story'] }));
  assert.equal(profilePath(c, 'crier'), '.claude/agents/crier.md');
  assert.equal(profilePath(c, 'editor'), 'staff/editor/editor.md');
});

/* --------------------------------------------------------------- 5. the brief */

const BEAD = { id: 'lm-1', title: 'Chapter 7 opens on the harbour' };
const PR = { autoMerge: true };
// The workspace declares an approval pipeline with a gate label, so the packet section
// also says no gate closes. Invented vocabulary, like the studio.
const { approvalPipeline } = await import(LIB('approvallabels.js'));
const PIPE = approvalPipeline({ approval: { studio: { labels: { review: 'sign-off', gate: 'milestone' } } } }, 'studio');
const plain = workPromptFor('studio', BEAD, 1, PR, 'Adam', { approval: PIPE });
const relayed = workPromptFor('studio', BEAD, 1, PR, 'Adam', {
  relay: chainFor(CFG, 'studio', bead({ assignee: 'author', labels: ['dept:story'] })),
  approval: PIPE,
});

await check('a brief with no relay is byte-for-byte what it was', () => {
  // The point of the whole assertion: not that the section is absent, but that a brief
  // built with `relay: null` and one built with the option left off are the same string.
  assert.equal(workPromptFor('studio', BEAD, 1, PR, 'Adam', { relay: null, approval: PIPE }), plain);
  assert.equal(workPromptFor('studio', BEAD, 1, PR, 'Adam', { relay: { steps: [] }, approval: PIPE }), plain);
  assert.ok(!plain.includes('This window is a relay'));
});

await check('the relayed brief is the plain one with one section added', () => {
  const cut = relayed.indexOf('**This window is a relay');
  const end = relayed.indexOf('\nStart:');
  assert.ok(cut > 0 && end > cut, 'the section is between the opening and `Start:`');
  assert.equal(relayed.slice(0, cut) + relayed.slice(end + 1), plain.slice(0, cut) + plain.slice(plain.indexOf('\nStart:') + 1));
});

await check('the brief names every step, in order, with its profile', () => {
  for (const [i, role] of ['author', 'editor', 'critic', 'author', 'steward'].entries()) {
    assert.ok(relayed.includes(`${i + 1}. `), `step ${i + 1}`);
    assert.ok(relayed.includes(`staff/${role}/${role}.md`), `profile for ${role}`);
  }
  const order = ['1. draft', '2. check', '3. check', '4. revise', '5. file'];
  let at = -1;
  for (const step of order) {
    const found = relayed.indexOf(step);
    assert.ok(found > at, `${step} out of order`);
    at = found;
  }
});

await check('the brief says the assignee is a role and not a person', () => {
  assert.ok(/is a role in the Story department rather than a person/.test(relayed));
});

await check('the brief tells it to read the contract documents', () => {
  assert.ok(relayed.includes('docs/CHARTER.md'));
  assert.ok(relayed.includes('docs/REVIEW.md'));
});

await check('the brief asks for a journal entry on the bead at every step', () => {
  // bc-bmry.4 replaced the free-text `bd comment` this used to assert on: prose in a
  // thread is a trail nothing can render, and the epic card is where the steps have to
  // show up. Assert on the tool and on the two flags that make an entry legible.
  assert.ok(/bin\/relaystep\.js -w studio -b lm-1 --role/.test(relayed));
  assert.ok(relayed.includes('--step <draft|check|revise|file>'));
  assert.ok(relayed.includes('reads it on the epic card'));
});

await check('the packet is a bead of its own, and nothing here closes it', () => {
  // `bin/ask.js` is in every brief already (the "a fact only Adam has" ending), so the
  // assertion has to be on the packet's own sentence rather than on the command.
  assert.ok(relayed.includes('file the packet as its **own** bead'));
  assert.ok(relayed.includes('bd label add <the-new-id> sign-off'));
  assert.ok(relayed.includes('bd label add <the-new-id> human'));
  assert.ok(/Its own bead and not \\?`lm-1\\?`/.test(relayed));
  assert.ok(/you do not close the packet, and you do not close a gate/.test(relayed));
});

await check('with no gate label declared, the packet section says nothing about gates', () => {
  const noGate = workPromptFor('studio', BEAD, 1, PR, 'Adam', {
    relay: chainFor(CFG, 'studio', bead({ assignee: 'author', labels: ['dept:story'] })),
  });
  assert.ok(/you do not close the packet\./.test(noGate));
  assert.ok(!/close a gate/.test(noGate), 'a workspace with no gate vocabulary was told about gates');
});

await check('the hand-back names the next role, which is the whole resume mechanism', () => {
  assert.ok(relayed.includes('bd update lm-1 --status open --assignee <the role that should run next>'));
  assert.ok(/`--claim` overwrote it/.test(relayed));
});

await check('a relay with no filer says nothing about a packet', () => {
  const noFiler = { relays: { studio: { ...CFG.relays.studio, filer: '' } } };
  const text = workPromptFor('studio', BEAD, 1, PR, 'Adam', {
    relay: chainFor(noFiler, 'studio', bead({ assignee: 'author', labels: ['dept:story'] })),
  });
  assert.ok(text.includes('This window is a relay'));
  assert.ok(!text.includes('file the packet as its **own** bead'), 'no filer, no packet section');
  assert.ok(!text.includes('bd label add <the-new-id>'), 'no filer, no packet labels');
  // The hand-back is not part of the packet section and must survive without it.
  assert.ok(text.includes('--assignee <the role that should run next>'));
});

/* ------------------------------------------------------- 6. the shipped config */

await check('no relay ships: a workspace is relayed only by its own declaration', () => {
  // bc-j2zwo.3. beadcause used to ship one studio's relay as a default, keyed by that
  // workspace's name. It ships none now — test/relaydefs.mjs asserts `relays: {}` against a
  // config loaded from an isolated directory, which this suite cannot do because it has
  // already imported lib/session.js, and with it lib/config.js, against the real one.
  // What is left to say here is the consequence: a name alone relays nothing, and the
  // same name relays the moment something declares it.
  const b = bead({ assignee: 'author', labels: ['dept:story'] });
  assert.equal(chainFor({ relays: {} }, 'atelier', b), null);
  assert.equal(chainFor({}, 'atelier', b), null);
  const declared = { relays: { atelier: CFG.relays.studio } };
  assert.equal(chainLine(chainFor(declared, 'atelier', b)), 'author → editor → critic → author → steward');
  for (const who of CFG.relays.studio.executive) {
    assert.equal(chainFor(declared, 'atelier', bead({ assignee: who })), null, who);
  }
});

console.log(`\n${ran - failures}/${ran} checks passed\n`);
process.exit(failures ? 1 : 0);
