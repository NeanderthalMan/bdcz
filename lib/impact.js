/**
 * AI system impact assessments — ISO/IEC 42001 Clause 6.1.4 and Annex A.5, run the way
 * ISO/IEC 42005 describes — and the gate that reads them.
 *
 * An impact assessment asks who is affected by an AI system, how, what could go wrong
 * for them, and what is done about it: for individuals, for groups and for society. For
 * beadcause the parties are concrete and already named in `lib/aims.js` — whoever owns a
 * repo an agent writes into, whoever reviews a pull request an agent opened, whoever
 * depends on a service an autonomous merge deployed, whoever is named in a bead an agent
 * reads — so an assessment here cites those parties by id rather than describing them
 * afresh, and a party struck from the register fails every assessment that cited it.
 *
 * ## One assessment per AI system, and the systems are the register's
 *
 * The AI systems are `lib/systemcard.js`'s `SYSTEMS`: beadcause itself plus one per
 * agent kind in `lib/foundation.js`. `coverageProblems` fails the repo on a system with
 * no assessment and on an assessment about a system that does not exist, which is the
 * direction that catches a new agent kind.
 *
 * ## Where the record lives, and why it is code
 *
 * In this file, as a frozen register, the same shape as `lib/suppliers.js` and
 * `lib/documents.js`. Two other homes were considered and rejected:
 *
 * - **A chained ref** gives history and compare-and-swap for free, and is right for
 *   records the running system writes — amendments, transitions, refusals. An
 *   assessment is not one of those. It is a document a person reads and approves, and
 *   the approval is the act that matters; a ref written through an API is one more
 *   surface an agent with a shell could write an approval to, with no review between it
 *   and the gate.
 * - **A bead** is a work item, closed when the work is done. An assessment is current
 *   until it expires, and "closed" would have to mean the opposite of what it means
 *   everywhere else in the tracker.
 *
 * In code, a change to an assessment is a diff on a branch, reviewed before it merges,
 * and `git log lib/impact.js` is its history. An approval written by somebody who may
 * not give one is caught by `entryProblems`, which asks `lib/aims.js` `mayApprove` —
 * there is one notion of who may approve what, and this file does not mint a second.
 *
 * ## Approved means a person approved *this* text
 *
 * An approval carries a `digest` of everything it approved. Edit the assessment after
 * approval — widen what it covers, soften a harm — and the digest no longer matches, and
 * the repo fails until it is either re-approved or honestly returned to draft. That is
 * ISO/IEC 42005's reassessment trigger as a check: a change to the system triggers a
 * fresh assessment rather than an annotation on the old one. It cannot stop somebody
 * typing a fabricated approval; nothing held in a repo can. It makes one impossible to
 * leave by accident and visible in review when done on purpose.
 *
 * **Every assessment below is a draft**, seeded by the session that wrote this file and
 * awaiting the impact assessment approver. A draft is never current. What that costs,
 * said plainly: with the management system on, *every* widening amendment is refused
 * until an assessment covering it is approved. A draft treated as approved would be the
 * fabricated record this programme exists to make impossible, and the refusal is the
 * honest state until a person signs.
 *
 * ## What "widening" means, and what it deliberately does not
 *
 * Widening is decided per capability field, in `widening` below: `tools` (which tools
 * exist for the agent at all), `allowedTools` (which run without a person approving
 * them) and `permissionMode` (whether a person is in the loop per call). A change that
 * only removes is narrowing and passes with no assessment at all. `model` is not here:
 * a model change does not change what an agent may *do*, and the system card gate in
 * `lib/foundation.js` (`cardGap`) and AIP-8 already own it. `role`, `purpose`, `env`
 * and `timeoutMs` are not here either — prose and plumbing, not permission.
 *
 * The comparison fails closed. An allowlist entry is compared as an exact string, so
 * `Bash` is not "covered" by `Bash(git log:*)`, and a permission mode this file does not
 * rank is treated as the widest there is.
 *
 * ## What an assessment covers
 *
 * The form shipped in the release — the baseline — plus whatever the assessment names
 * in `alsoCovers`. An amendment that widens an agent beyond its current form is let
 * through only when an approved, unexpired assessment covers the form it would leave the
 * agent in. So the way to grant a wider tool is to assess it first: name it in
 * `alsoCovers`, get the assessment approved, and the amendment then passes.
 *
 * A release that widens a baseline is a reviewed commit and not an amendment, and this
 * gate does not see it. That limit is stated in the specification rather than left to be
 * discovered.
 *
 * ## The refusal is the evidence
 *
 * A refusal is built here with `lib/capa.js`'s `refusalRecord`, naming the control —
 * never as a second record kind. `lib/foundation.js` keeps it on the foundations ref
 * beside the amendment it refused, and `lib/amendment.js` writes it on the bead the
 * amendment came from with the `gate-refused` label. The gate is inert while the
 * management system is off (`lib/management.js`); that decision is `lib/foundation.js`'s,
 * because only it knows whether it is writing anything at all.
 *
 * A leaf like `lib/suppliers.js`: no clock of its own, no disk, no config directory.
 */
import crypto from 'node:crypto';

import { mayApprove, ROLES, parties } from './aims.js';
import { refusalRecord, refusalsFrom } from './capa.js';
import { AGENTS, baseline } from './foundation.js';
import { SYSTEM, SYSTEMS } from './systemcard.js';

/** The approval kind in `lib/aims.js`'s closed list. */
export const APPROVAL = 'impact-assessment';

/** The gate's name on every refusal it writes. */
export const GATE = 'impact-assessment';

/**
 * The control a refusal enforces. The clause, rather than an Annex A control, because a
 * refusal is the *process* operating — "the organisation shall assess impacts" — and
 * the Annex controls are what the assessment itself is evidence for.
 */
export const CONTROL = 'ISO42001.Clause6.1.4';

/** Everything this file is evidence for. Each is a real id in `lib/controls.js`; test/impact.mjs checks. */
export const CONTROLS = Object.freeze([
  'ISO42001.Clause6.1.4',
  'ISO42001.A.5.2',
  'ISO42001.A.5.3',
  'ISO42001.A.5.4',
  'ISO42001.A.5.5',
  'ISO42005.Process.Reassessment',
  'ISO42005.Documentation.Approval',
]);

/** The longest an approval may stand. A year, the same horizon as the controlled documents. */
export const VALIDITY_MONTHS = 12;

/** How long before expiry the repo starts saying so. */
export const WARN_DAYS = 30;

/** The capability fields a widening is measured on. See the header for why only these. */
export const FORM_FIELDS = Object.freeze(['tools', 'allowedTools', 'permissionMode']);

/**
 * Permission modes, least to most autonomous. `plan` cannot act; `default` asks; the
 * rest ask less. `null` — the foundation saying nothing — means the deployment's setting
 * applies, which this file cannot see, so it ranks as `default`: moving from silence to an
 * explicit `auto` is a widening, moving from silence to `plan` is not.
 */
export const PERMISSION_RANK = Object.freeze({
  plan: 0,
  default: 1,
  acceptEdits: 2,
  auto: 3,
  dontAsk: 4,
  bypassPermissions: 5,
});

const WIDEST = Math.max(...Object.values(PERMISSION_RANK));

const rank = (mode) => {
  if (mode === null || mode === undefined || mode === '') return PERMISSION_RANK.default;
  return Object.hasOwn(PERMISSION_RANK, mode) ? PERMISSION_RANK[mode] : WIDEST;
};

/** How far an impact may reach. A.5.4 asks about the first two, A.5.5 about the third. */
export const SCALES = Object.freeze(['individual', 'group', 'society']);

/**
 * The template — what every assessment must answer, and where the question comes from.
 *
 * `entryProblems` walks this, so a field added here is a field every assessment owes on
 * the next run, which is the point of a template.
 */
export const TEMPLATE = Object.freeze([
  Object.freeze({ field: 'context', asks: 'Where and how the system is deployed, and who operates it.', cites: 'ISO42005.Scope.DeploymentContext' }),
  Object.freeze({ field: 'benefits', asks: 'What the system is for, as a benefit somebody receives.', cites: 'ISO42005.Impacts.Benefits' }),
  Object.freeze({ field: 'impacts', asks: 'Who is affected, at what scale, what could go wrong for them, and what is done about it.', cites: 'ISO42001.A.5.4' }),
  Object.freeze({ field: 'residual', asks: 'What remains after the mitigations, said as a risk rather than a reassurance.', cites: 'ISO42005.Process.IntoRiskManagement' }),
  Object.freeze({ field: 'reassessWhen', asks: 'What change to the system makes this assessment stop being about it.', cites: 'ISO42005.Process.Reassessment' }),
  Object.freeze({ field: 'alsoCovers', asks: 'Which capability grants beyond the shipped form this assessment has also considered.', cites: 'ISO42005.Process.Threshold' }),
]);

/* ---------------------------------------------------------------- the register */

const AWAITING = 'Adam Morgan, as impact assessment approver';
const DRAFTED_BY = 'worker session on bc-eqn1.6';
const DRAFTED_ON = '2026-10-04';

const AGENT_REASSESS =
  'A grant outside its shipped allowlist, a change of permission mode, a change to what it may write, or a new kind of ' +
  'repository or tracker it is pointed at — any of these is a different system and owes a fresh assessment.';

const impact = (party, scale, harm, mitigation) => Object.freeze({ party, scale, harm, mitigation });

const draft = (e) =>
  Object.freeze({
    version: '0.1.0-draft',
    assessedOn: DRAFTED_ON,
    assessedBy: DRAFTED_BY,
    reassessWhen: AGENT_REASSESS,
    alsoCovers: Object.freeze({}),
    approval: null,
    awaitingApproval: AWAITING,
    ...e,
    impacts: Object.freeze(e.impacts),
  });

/**
 * The assessments, one per AI system.
 *
 * Every one is a draft. Read the header before approving one: approving is filling
 * `approval` with the role, its holder, the date, an expiry no more than a year out and
 * the `digest` this file computes, and taking `awaitingApproval` off — in one commit, by
 * the person who holds the role.
 */
export const REGISTER = Object.freeze([
  draft({
    system: SYSTEM,
    context:
      'A daemon and a phone app on one person’s Mac, running that person’s issue trackers as a supervised loop: advocates ' +
      'propose, the person approves from a phone, workers do the work in terminals, and a merge queue lands it.',
    benefits:
      'One person can keep many repositories moving without being at the keyboard, and every step of that is a record ' +
      'somebody can follow rather than a thing that happened in a terminal nobody kept.',
    impacts: [
      impact(
        'operator',
        'individual',
        'Model budget, disk and attention spent by agents nobody was watching, under the operator’s own git and tracker identity.',
        'Nothing becomes work without a tap, every session is archived against its bead, and the inbox shows what is running.'
      ),
      impact(
        'repo-owners',
        'group',
        'Code merged into a repository at machine speed with one person’s tap standing in for a team’s review.',
        'Every change is a branch and a pull request per bead, reviewed by a different agent from the one that wrote it, and landed only by the merge queue.'
      ),
      impact(
        'data-subjects',
        'individual',
        'A colleague named in a bead or a ticket is read, quoted and reasoned about by a process they never saw.',
        'The supplier register states what leaves the Mac and to whom, and the publishable vocabulary keeps bead content off every channel that is not the operator’s own.'
      ),
      impact(
        'service-users',
        'society',
        'Software built and deployed with less human attention per change becomes ordinary, and its users cannot tell which changes a person looked at.',
        'The byline names the agent and the model on every change, and the scope statement excludes deploying anything the operator does not own.'
      ),
    ],
    residual:
      'The operator is one person holding every role, so the review a merge stands on is ultimately theirs alone; the ' +
      'controls make that visible and attributable, not independent.',
    reassessWhen:
      'A new agent kind, a new class of repository or tracker it is pointed at, anything new leaving the Mac, or a second ' +
      'person operating it.',
  }),
  draft({
    system: 'console',
    context: 'A chat on the operator’s phone, run as a read-only Claude session against one checkout and its tracker.',
    benefits: 'Turning a half-formed thought on a phone into a proposal the operator can read before any of it exists.',
    impacts: [
      impact(
        'operator',
        'individual',
        'Believing something is filed because it was said to the chat session, when an unapproved proposal is not filed at all.',
        'It cannot write to the tracker: `writes: false` and a read-only allowlist, and every proposal is drawn on screen to approve or edit.'
      ),
      impact(
        'data-subjects',
        'individual',
        'A colleague named as a blocker in a proposal they did not take part in, or a file quoted into a notification it does not belong in.',
        'Proposals are read before they exist, and what a notification may carry is decided by the publishable vocabulary rather than by the agent.'
      ),
      impact(
        'successors',
        'society',
        'Work items written by a model read like work items written by a person, and the tracker’s history stops being evidence of what people decided.',
        'Every bead it drafts is created by the operator’s tap and attributed to them, with the conversation kept beside it.'
      ),
    ],
    residual: 'A proposal approved without being read is the operator’s own decision, and nothing here can tell the two apart.',
  }),
  draft({
    system: 'dispatch',
    context: 'A one-turn Claude run spawned by the daemon to answer one comment on one question bead, then exit.',
    benefits: 'A question on a bead gets an answer drawn from the repo and the tracker while the person who asked is still holding it.',
    impacts: [
      impact(
        'operator',
        'individual',
        'A reply read as a decision, because it sits in the thread in the same shape as a reply from a person.',
        'Every reply carries the agent as its actor, and its allowlist lets it comment and do nothing else — no create, no close, no label.'
      ),
      impact(
        'data-subjects',
        'individual',
        'A comment naming a colleague as the reason something is stuck is a claim about them by a process they cannot reply to.',
        'It answers one comment once and exits, so it cannot pursue a line of argument across turns.'
      ),
      impact(
        'successors',
        'society',
        'Machine-written answers accumulate in a tracker that people later read as the record of what was known and decided.',
        'Each answer is attributed to the agent that wrote it, so a later reader can weigh it as what it is.'
      ),
    ],
    residual: 'A wrong answer stated confidently is still possible and is only caught by the person who asked.',
  }),
  draft({
    system: 'advocate',
    context: 'A Claude run spawned on a schedule against one repository whose queue has run dry, read-only except for labels.',
    benefits: 'Somebody asks "is there anything worth doing here" every day without a person having to remember to ask it.',
    impacts: [
      impact(
        'operator',
        'individual',
        'Proposals approved in bulk, so the advocate quietly becomes the thing that decides what gets built.',
        'It may not create, close or delete work; every proposal is a card somebody taps, and a cooldown bounds how often it can ask.'
      ),
      impact(
        'repo-owners',
        'group',
        'A survey that misreads a repo as unfinished spends somebody’s evening on work nobody wanted.',
        'A proposal is a card, not a bead, until the operator endorses it; nothing is worked unendorsed (AIP-1).'
      ),
      impact(
        'successors',
        'society',
        'What a codebase becomes is steered by what a model notices, which is not what its users or maintainers would have noticed.',
        'Every proposal carries its rationale, so the reason a piece of work exists can be read back later.'
      ),
    ],
    residual: 'Agreement fatigue is a property of the person, not the system, and no gate here can measure it.',
  }),
  draft({
    system: 'epic-advocate',
    context: 'A re-entrant Claude run that plans one epic the operator owns: files children under it, groups them, and says what is stuck.',
    benefits: 'A large piece of agreed work is broken into pieces a worker can finish, without the operator cutting each one by hand.',
    impacts: [
      impact(
        'operator',
        'individual',
        'Scope creep with a signature on it: a child drifted from what was agreed reads on the board as work the operator chose.',
        'It may not endorse its own subtree or change its epic’s priority or ownership, and everything it concluded is written on the bead.'
      ),
      impact(
        'repo-owners',
        'group',
        'A badly cut child is a worker’s hour, spent before anyone can tell it was cut badly, and a branch somebody must review.',
        'Children it files go through the same endorsement, review and merge queue as any other work.'
      ),
      impact(
        'successors',
        'society',
        'Plans written by a model become the structure later readers assume a person designed.',
        'The plan is kept on the epic with the reasoning that produced it, attributed to the agent.'
      ),
    ],
    residual: 'A plausible but wrong decomposition can consume several sessions before it is noticed.',
  }),
  draft({
    system: 'worker',
    context: 'An interactive Claude Code session in a terminal on the operator’s Mac, on a branch of its own, usually unattended.',
    benefits: 'One piece of agreed work is done, tested and delivered as a pull request without the operator at the keyboard.',
    impacts: [
      impact(
        'operator',
        'individual',
        'Edits to their disk, spend of their model budget and commits under their git identity, while nobody is watching.',
        'It works in a worktree of its own, cannot merge or close its own bead, and its permission mode is the deployment’s setting rather than its own.'
      ),
      impact(
        'repo-owners',
        'group',
        'A branch built on a guess where a decision was needed, merged by a queue that only checks whether it is green.',
        'Its brief requires it to hand a decision back rather than guess, a separate reviewer reads the diff, and a delivery may ask for a person instead of the queue.'
      ),
      impact(
        'service-users',
        'society',
        'A change that passes its tests and is wrong reaches people through a deploy that runs on merge.',
        'The merge queue judges checks against what the base already fails, a poisoned build is refused rather than served, and every change names its bead.'
      ),
    ],
    residual: 'An unattended session can still produce a wrong but well-tested change that a reviewing agent also accepts.',
  }),
  draft({
    system: 'merge-advocate',
    context: 'The one process in the daemon that brings `main` into each open branch, waits for checks, merges, and closes the work bead.',
    benefits: 'Branches land one at a time with every open branch in view, so concurrent sessions do not race each other into `main`.',
    impacts: [
      impact(
        'repo-owners',
        'group',
        '"The queue merged it" read as an approval nobody gave, because it merges on checks rather than on judgement.',
        'A delivery may take itself out of the queue and ask for a person, and a blocking review verdict holds a branch out of the queue.'
      ),
      impact(
        'service-users',
        'society',
        'What it lands is what runs, because this repository deploys itself on merge.',
        'It merges one branch at a time, refuses rather than retries in silence, and its allowlist has no `gh pr merge` and no general `bd close`.'
      ),
      impact(
        'operator',
        'individual',
        'A refused merge on a branch whose author has already exited becomes the operator’s problem, hours later.',
        'A refusal is recorded on the bead and raised as a card naming what refused it.'
      ),
    ],
    residual: 'A wrong change with green checks and an approving review is merged and deployed.',
  }),
  draft({
    system: 'review-advocate',
    context: 'A Claude run that reads one delivered pull request and writes a single verdict, which the daemon submits under a chosen identity.',
    benefits: 'Every agent-written change is read line by line by something other than its author before it may merge.',
    impacts: [
      impact(
        'reviewers',
        'group',
        '"The reviewer approved it" read as scrutiny a person applied, when it reviewed the diff and the stated reasons only.',
        'Its verdict is submitted by the daemon under an identity chosen by role, so a review from an agent is never mistaken for one from a person.'
      ),
      impact(
        'repo-owners',
        'group',
        'An agreeable reviewer that accepts every hand-back has quietly stopped being a gate.',
        'A two-round cap turns a disagreement into a card for a person, enforced in code rather than in its brief.'
      ),
      impact(
        'service-users',
        'society',
        'Its verdict decides whether a branch reaches the merge queue, and the repository deploys on merge.',
        'It cannot submit its own review or change any bead; `bd comment` is its only write.'
      ),
    ],
    residual: 'A change wrong in a way only the author knew passes a review that sees only the diff.',
  }),
]);

/**
 * The AI systems that existed before this gate did.
 *
 * Each of these has an assessment — a draft, today — and may run on a draft until
 * bc-eqn1.8's session-open gate says otherwise. **Any system not in this list may only be
 * added with an approved, current assessment**, which is the half of AIP-6 that a repo
 * check can enforce: a new agent kind in `lib/foundation.js` without one fails the repo.
 * test/impact.mjs pins this list to what it was on the day the gate landed, so it can
 * shrink and can never grow.
 */
export const PREDATES_GATE = Object.freeze([
  'beadcause',
  'console',
  'dispatch',
  'advocate',
  'epic-advocate',
  'worker',
  'merge-advocate',
  'review-advocate',
]);

/* ---------------------------------------------------------------- what it reads */

const str = (v) => String(v ?? '').trim();
const prose = (v) => str(v).length >= 20;
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(str(v)) && Number.isFinite(Date.parse(`${str(v)}T00:00:00Z`));
const dayOf = (v) => Date.parse(`${str(v)}T00:00:00Z`);
const DAY_MS = 86_400_000;

/** The capability fields of a foundation, and nothing else. */
export function formOf(foundation) {
  const out = {};
  for (const k of FORM_FIELDS) out[k] = foundation?.[k] ?? null;
  return out;
}

const list = (v) => (Array.isArray(v) ? v.map(String) : []);

/**
 * What `to` may do that `from` may not — empty when nothing.
 *
 * Per field, each with the entries or the move that widened it, so a refusal can say
 * exactly what it refused rather than "too wide".
 *
 * - `tools`: `null` or empty is the CLI default, every tool. Becoming unrestricted from a
 *   list is a widening; so is a name the old list lacked. Anything from unrestricted is
 *   not, since there is nothing wider to move to.
 * - `allowedTools`: what runs without a person approving it. Any entry not already there
 *   is a widening; `null` holds nothing.
 * - `permissionMode`: a move up `PERMISSION_RANK`.
 */
export function widening(from, to) {
  const out = [];
  if (to && Object.hasOwn(to, 'tools')) {
    const before = list(from?.tools);
    const after = list(to.tools);
    const unrestrictedBefore = before.length === 0;
    if (!unrestrictedBefore) {
      if (after.length === 0) out.push({ field: 'tools', added: ['(every tool — the restriction is removed)'] });
      else {
        const added = after.filter((t) => !before.includes(t));
        if (added.length) out.push({ field: 'tools', added });
      }
    }
  }
  if (to && Object.hasOwn(to, 'allowedTools')) {
    const before = list(from?.allowedTools);
    const added = list(to.allowedTools).filter((t) => !before.includes(t));
    if (added.length) out.push({ field: 'allowedTools', added });
  }
  if (to && Object.hasOwn(to, 'permissionMode')) {
    if (rank(to.permissionMode) > rank(from?.permissionMode)) {
      out.push({ field: 'permissionMode', added: [`${from?.permissionMode ?? '(unset)'} → ${to.permissionMode ?? '(unset)'}`] });
    }
  }
  return out;
}

/**
 * The widest form an assessment has considered: the shipped baseline plus `alsoCovers`.
 *
 * Union per field, so `alsoCovers` can only add — an assessment narrower than the agent
 * it is about would be about a different agent.
 */
export function coveredForm(entry, base = null) {
  const b = base || (AGENTS.includes(entry?.system) ? formOf(baseline(entry.system)) : formOf({}));
  const also = entry?.alsoCovers || {};
  const tools =
    list(b.tools).length === 0 || (Object.hasOwn(also, 'tools') && list(also.tools).length === 0)
      ? null
      : [...new Set([...list(b.tools), ...list(also.tools)])];
  const allowedTools = [...new Set([...list(b.allowedTools), ...list(also.allowedTools)])];
  const permissionMode =
    Object.hasOwn(also, 'permissionMode') && rank(also.permissionMode) > rank(b.permissionMode)
      ? also.permissionMode
      : b.permissionMode;
  return { tools, allowedTools, permissionMode };
}

/** Whether an assessment covers this form. */
export const covers = (entry, form, base = null) => widening(coveredForm(entry, base), form).length === 0;

/** The fields an approval is a signature over: everything but the approval itself. */
const SIGNED = Object.freeze(['system', 'version', 'assessedOn', 'assessedBy', 'context', 'benefits', 'impacts', 'residual', 'reassessWhen', 'alsoCovers']);

/**
 * A digest of what an approval approves. Keys sorted, so reformatting the source does not
 * move it and changing a word does.
 */
export function digest(entry) {
  const canon = (v) =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
        : v;
  const body = {};
  for (const k of SIGNED) body[k] = canon(entry?.[k] ?? null);
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
}

/** The assessment for one system, or null. */
export const assessmentFor = (system, register = REGISTER) => register.find((e) => e?.system === String(system)) || null;

/**
 * Whether an assessment is current, and if not, why not — the answer every gate reads.
 *
 * `state` is one of `missing`, `draft`, `invalid` (an approval that does not match what
 * it approves, or was given by somebody who may not), `expired`, `current`.
 */
export function status(entry, now = new Date()) {
  if (!entry) return { current: false, state: 'missing', reason: 'there is no impact assessment for it' };
  if (!entry.approval) {
    return {
      current: false,
      state: 'draft',
      reason: `its impact assessment is a draft, awaiting ${entry.awaitingApproval || 'an approver'}`,
    };
  }
  const bad = approvalProblems(entry);
  if (bad.length) return { current: false, state: 'invalid', reason: `its impact assessment's approval does not stand: ${bad[0]}` };
  const t = now instanceof Date ? now.getTime() : Date.parse(now);
  const ends = dayOf(entry.approval.expiresOn);
  if (t >= ends + DAY_MS) {
    return { current: false, state: 'expired', reason: `its impact assessment expired on ${entry.approval.expiresOn}` };
  }
  const daysLeft = Math.floor((ends - t) / DAY_MS);
  return { current: true, state: 'current', reason: `approved ${entry.approval.on}, expires ${entry.approval.expiresOn}`, daysLeft };
}

function approvalProblems(e) {
  const a = e?.approval;
  const problems = [];
  if (!mayApprove(a?.role, APPROVAL)) {
    problems.push(`role ${JSON.stringify(a?.role ?? null)} may not approve an impact assessment (lib/aims.js mayApprove)`);
  } else {
    const holder = ROLES.find((r) => r.id === a.role)?.holder;
    if (str(a?.by) !== holder) problems.push(`it was approved by ${JSON.stringify(a?.by ?? null)}, and ${a.role} is held by ${holder}`);
  }
  if (!isDay(a?.on)) problems.push('`approval.on` must be the YYYY-MM-DD it was approved');
  if (!isDay(a?.expiresOn)) problems.push('`approval.expiresOn` must be a YYYY-MM-DD');
  if (isDay(a?.on) && isDay(a?.expiresOn)) {
    const on = new Date(dayOf(a.on));
    const limit = Date.UTC(on.getUTCFullYear(), on.getUTCMonth() + VALIDITY_MONTHS, on.getUTCDate());
    if (dayOf(a.expiresOn) <= dayOf(a.on)) problems.push('`approval.expiresOn` must be after `approval.on`');
    if (dayOf(a.expiresOn) > limit) problems.push(`an approval may stand for at most ${VALIDITY_MONTHS} months`);
  }
  if (str(a?.digest) !== digest(e)) {
    problems.push(
      `it approves digest ${JSON.stringify(a?.digest ?? null)} and the assessment now reads as ${digest(e)} — ` +
        'it changed after it was approved; have it re-approved, or return it to draft'
    );
  }
  return problems;
}

/**
 * Everything wrong with one assessment.
 *
 * One entry at a time, so test/impact.mjs can break each rule on purpose — the reason
 * `lib/suppliers.js` gives for the same split.
 */
export function entryProblems(e, { partyIds = parties().map((p) => p.id), systems = SYSTEMS } = {}) {
  const problems = [];
  const at = `REGISTER[${e?.system || '?'}]`;

  if (!systems.includes(e?.system)) problems.push(`${at}: \`system\` must be one of ${systems.join(', ')}`);
  if (!str(e?.version)) problems.push(`${at}: \`version\` must say which version this is`);
  if (!isDay(e?.assessedOn)) problems.push(`${at}: \`assessedOn\` must be a YYYY-MM-DD`);
  if (!str(e?.assessedBy)) problems.push(`${at}: \`assessedBy\` must say who drafted it`);

  for (const t of TEMPLATE) {
    if (t.field === 'impacts' || t.field === 'alsoCovers') continue;
    if (!prose(e?.[t.field])) problems.push(`${at}: \`${t.field}\` must answer "${t.asks}" in a sentence`);
  }

  const impacts = Array.isArray(e?.impacts) ? e.impacts : null;
  if (!impacts || impacts.length === 0) {
    problems.push(`${at}: \`impacts\` must name at least one affected party`);
  } else {
    impacts.forEach((i, n) => {
      const where = `${at}.impacts[${n}]`;
      if (!partyIds.includes(i?.party)) problems.push(`${where}: party ${JSON.stringify(i?.party ?? null)} is not in lib/aims.js parties()`);
      if (!SCALES.includes(i?.scale)) problems.push(`${where}: \`scale\` must be one of ${SCALES.join(', ')}`);
      if (!prose(i?.harm)) problems.push(`${where}: \`harm\` must say what could go wrong for them`);
      if (!prose(i?.mitigation)) problems.push(`${where}: \`mitigation\` must say what is done about it`);
    });
    if (!impacts.some((i) => i?.scale === 'individual' || i?.scale === 'group')) {
      problems.push(`${at}: no impact on individuals or groups is assessed (ISO42001.A.5.4)`);
    }
    if (!impacts.some((i) => i?.scale === 'society')) problems.push(`${at}: no societal impact is assessed (ISO42001.A.5.5)`);
  }

  const also = e?.alsoCovers;
  if (!also || typeof also !== 'object' || Array.isArray(also)) {
    problems.push(`${at}: \`alsoCovers\` must be an object — empty when it covers only the shipped form`);
  } else {
    const stray = Object.keys(also).filter((k) => !FORM_FIELDS.includes(k));
    if (stray.length) problems.push(`${at}: \`alsoCovers\` may name only ${FORM_FIELDS.join(', ')} — not ${stray.join(', ')}`);
    if (e?.system === SYSTEM && Object.keys(also).length) {
      problems.push(`${at}: beadcause has no amendable form, so it can cover nothing beyond itself`);
    }
  }

  const draftEntry = e?.approval === null || e?.approval === undefined;
  if (draftEntry) {
    if (!str(e?.awaitingApproval)) {
      problems.push(`${at}: a draft must name in \`awaitingApproval\` whose approval it is waiting for`);
    }
  } else {
    if (e?.awaitingApproval) problems.push(`${at}: approved and still \`awaitingApproval\` — one of them is not true`);
    for (const p of approvalProblems(e)) problems.push(`${at}: approval: ${p}`);
  }
  return problems;
}

/**
 * Everything wrong with the register, split as `lib/documents.js` splits it: problems
 * fail the repo, warnings are said and do not. A draft warns and never fails — failing
 * would turn `main` red on a state only a signature can clear, and the fix an unattended
 * session would reach for is the fabricated approval.
 */
export function registerProblems(register = REGISTER, now = new Date(), opts = {}) {
  const problems = [];
  const warnings = [];
  for (const e of register) {
    problems.push(...entryProblems(e, opts));
    const s = status(e, now);
    if (s.state === 'draft') warnings.push(`REGISTER[${e.system}]: draft, awaiting ${e.awaitingApproval}. A session can draft it; only a person can approve it.`);
    if (s.state === 'expired') problems.push(`REGISTER[${e.system}]: ${s.reason}. Reassess it, then have it approved again.`);
    if (s.state === 'current' && s.daysLeft <= WARN_DAYS) {
      warnings.push(`REGISTER[${e.system}]: expires ${e.approval.expiresOn}, in ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}.`);
    }
  }
  return { problems, warnings };
}

/**
 * The repo check that makes a new agent kind owe an assessment — AIP-6's enforced half.
 *
 * Every system has exactly one assessment; no assessment is about a system that does not
 * exist; and a system not in `PREDATES_GATE` must have a *current* one, so the commit that
 * adds an agent kind to `lib/foundation.js` cannot merge without an approved assessment
 * beside it.
 */
export function coverageProblems({ register = REGISTER, systems = SYSTEMS, predates = PREDATES_GATE, now = new Date() } = {}) {
  const problems = [];
  const seen = new Map();
  for (const e of register) seen.set(e?.system, (seen.get(e?.system) || 0) + 1);
  for (const [system, n] of seen) {
    if (n > 1) problems.push(`REGISTER: ${n} assessments for ${system} — which one is current would be a guess`);
    if (!systems.includes(system)) problems.push(`REGISTER: an assessment for ${system}, which is not an AI system in the register`);
  }
  for (const system of systems) {
    const e = assessmentFor(system, register);
    if (!e) {
      problems.push(
        `${system} is an AI system with no impact assessment. Add one to lib/impact.js REGISTER and have it approved ` +
          `before it ships (${CONTROL}).`
      );
      continue;
    }
    if (!predates.includes(system)) {
      const s = status(e, now);
      if (!s.current) {
        problems.push(
          `${system} is a new AI system and ${s.reason}. A system added after the gate may only ship with an approved, ` +
            `current assessment (${CONTROL}, AIP-6).`
        );
      }
    }
  }
  return problems;
}

/* ---------------------------------------------------------------- the gate */

/**
 * The widening gate, as a pure function — `null` to let the amendment through, or the
 * refusal.
 *
 * `from` is the agent's form now, `to` the form the amendment would leave it in. A change
 * that widens nothing passes without consulting the register at all, which is what lets a
 * narrowing amendment through on an install with no approved assessment anywhere.
 */
export function amendmentGate({ agent, from, to, register = REGISTER, now = new Date(), base = null, at = null } = {}) {
  const widened = widening(formOf(from), formOf(to));
  if (!widened.length) return null;

  const entry = assessmentFor(agent, register);
  const s = status(entry, now);
  const what = widened.map((w) => `${w.field} +${w.added.join(', +')}`).join('; ');

  let why;
  if (!s.current) {
    why = `the amendment widens ${agent} (${what}), and ${s.reason}.`;
  } else {
    const beyond = widening(coveredForm(entry, base), formOf(to));
    if (!beyond.length) return null;
    why =
      `the amendment widens ${agent} (${what}), and its current impact assessment does not cover ` +
      `${beyond.map((w) => `${w.field} +${w.added.join(', +')}`).join('; ')}. ` +
      'Assess it — name it in that assessment’s `alsoCovers` — and have the assessment approved again.';
  }

  const record = refusalRecord({
    control: CONTROL,
    gate: GATE,
    subject: `an amendment widening ${agent}: ${what}`,
    why,
    at: at ?? (now instanceof Date ? now.getTime() : Date.parse(now)),
  });
  return { record, widened, status: s, message: `refused by the impact assessment gate (${CONTROL}): ${why}` };
}

/* ---------------------------------------------------------------- the launch gate */

/**
 * The gate's name on a refusal to open a session. A second door onto the same control as
 * the amendment gate, so a second name: whoever reads a refusal back can tell "an agent
 * was not widened" from "an agent was not put to work".
 */
export const LAUNCH_GATE = 'session-impact';

/**
 * The launch gate, as a pure function — `null` to let a window open on `bead` as `agent`,
 * or the refusal (bc-eqn1.8.1).
 *
 * Narrower than the amendment gate in one way and wider in another. It does not ask what
 * the agent may do, only whether the kind it runs as has a current assessment at all — so
 * it refuses an agent on its baseline form too, which the amendment gate never sees. And
 * it names the assessment's state in the subject, which is what lets a caller write the
 * refusal once per bead per state rather than once per tick (`refusedAlready`): the same
 * bead refused again while its assessment is still a draft is the same subject, and an
 * assessment approved and later lapsed is a different one.
 *
 * Inert while the management system is off — that decision is lib/sessiongate.js's, for
 * the reason the header gives for the amendment gate.
 */
export function launchGate({ agent, bead, register = REGISTER, now = new Date(), at = null } = {}) {
  const entry = assessmentFor(agent, register);
  const s = status(entry, now);
  if (s.current) return null;
  const which = entry?.approval?.on ? `${s.state}, approved ${entry.approval.on}` : s.state;
  const why =
    `a session on ${bead} would run as ${agent}, and ${s.reason}. No agent kind is put to work without a current ` +
    `impact assessment; once lib/impact.js REGISTER carries an approved one for ${agent}, the next tick opens it.`;
  const record = refusalRecord({
    control: CONTROL,
    gate: LAUNCH_GATE,
    subject: `a ${agent} session on ${bead} (assessment ${which})`,
    why,
    at: at ?? (now instanceof Date ? now.getTime() : Date.parse(now)),
  });
  return { record, status: s, message: `refused by the session impact gate (${CONTROL}): ${why}` };
}

/** Whether a bead's comments already carry this refusal — same gate, same subject. */
export const refusedAlready = (comments, record) =>
  refusalsFrom(comments).some((r) => r.gate === record.gate && r.subject === record.subject);
