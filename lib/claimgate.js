/**
 * The claim gate — a merge may not land carrying no control or requirement claim at all.
 *
 * bc-eqn1.8.2, gate 2 of bc-eqn1.8. lib/controllanding.js records what a bead exercises at
 * the moment it lands, and its header treats a bead that names nothing as the ordinary
 * case: "most beads exercise no control", so a landing there writes nothing. That is the
 * right reading for the *recorder* — it must not invent evidence — and the wrong one for a
 * management system that wants to say every change was looked at. A landing that names
 * nothing is indistinguishable from a landing nobody thought about, and that silence is
 * what this turns into a refusal, while management is on (lib/management.js `isOn`).
 *
 * ## What is refused is silence, not absence
 *
 * Refusing a bead that exercises no control would refuse almost every merge this queue
 * has ever made, and it would be refusing a true statement: most work here really does
 * touch nothing a standard has a number for. So the gate does not ask for a control. It
 * asks for a **declaration**, and there are three, any one of which is enough:
 *
 * 1. **Controls named** — the block lib/beadcontrols.js reads, written by
 *    `beadcause-controls declare`. Only ids the corpus resolves count: a block holding
 *    nothing but invented ids is refused like silence, and the sentence says which ids
 *    were dropped, because an agent that is not told writes the same invented id again.
 * 2. **Requirements named** — the block lib/beadreqs.js reads. Ids or candidates, which
 *    is what `hasRequirements` already counts as the bead saying something; a candidate is
 *    a requirement somebody wrote down before it had an id, and that is a claim.
 * 3. **"Exercises none", said out loud** — the `exercises:none` label.
 *
 * ## Why "none" is a label
 *
 * Because it is the cheapest thing every surface already reads and writes. A bead filed
 * through `beadcause-file` can carry it from birth (`labels: [exercises:none]` in the
 * YAML, which lib/filing.js already passes through), `bd label add` puts it on from any
 * shell, and `beadcause-controls none` is the spelling an agent with only the command can
 * reach. The alternative was an empty controls block, and lib/beadcontrols.js has already
 * argued against that one: `controlsBlock` writes nothing for an empty list, precisely
 * because an empty block is a claim made by whichever code path happened to run. A label
 * cannot be written by accident by a code path that merely had nothing to say.
 *
 * A label and a block together is fine and means the block — "none" beside named controls
 * is a stale label, not a contradiction worth refusing a merge over.
 *
 * ## The control this enforces
 *
 * **ISO42001.A.6.2.3 — documentation of AI system design and development.** The claim is
 * the part of a change's development record that says which requirements and controls it
 * bears on, and it is the part lib/controllanding.js and lib/reqlanding.js promote into
 * evidence at the merge. A change landing without it is a change whose development is
 * undocumented in exactly the respect the evidence layer depends on. The neighbours were
 * weighed and are worse fits: A.6.1.3 (processes are defined and followed) is true of
 * every gate in bc-eqn1.8 and so says nothing about this one; A.6.2.4 (verification and
 * validation) is what the checks `gateVerdict` reads already enforce; Clause7.5.2 is about
 * the management system's own documents, not the system's development record.
 *
 * ## Who is gated
 *
 * **Worker deliveries only** — a merge-bead with a work bead behind it, which is the one
 * place a claim can live. A pull request Adam opened and admitted through `/merge` has no
 * bead to carry one, and refusing it would be a refusal nothing could ever answer. That is
 * lib/reviewgate.js's `reviewGated` line, drawn for the same reason.
 *
 * Pure, for `gateVerdict`'s reason: what is under test is a decision about merging to
 * `main` unattended, and every branch of it has to be drivable without a tracker.
 */
import { readControls } from './beadcontrols.js';
import { hasRequirements } from './beadreqs.js';
import { refusalRecord } from './capa.js';

/** The label that says "this bead exercises no control and meets no named requirement". */
export const NO_CLAIM_LABEL = 'exercises:none';

/** The control the refusal names. The header argues why this one. */
export const CONTROL = 'ISO42001.A.6.2.3';

/** The gate's name, as it appears on the refusal record's first line. */
export const GATE = 'merge-claim';

/**
 * What this bead declares — `{ declared, how, controls, dropped }`.
 *
 * `how` is `controls`, `requirements` or `none`, in that order of preference: a bead that
 * names something is reported as naming it even if it also carries the label.
 */
export function declaredClaim(issue) {
  const { ids: controls, dropped } = readControls(issue);
  if (controls.length) return { declared: true, how: 'controls', controls, dropped };
  if (hasRequirements(issue)) return { declared: true, how: 'requirements', controls: [], dropped };
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  if (labels.includes(NO_CLAIM_LABEL)) return { declared: true, how: 'none', controls: [], dropped };
  return { declared: false, how: null, controls: [], dropped };
}

/**
 * The refusal for one work bead, or null when it may land.
 *
 * `{ refused, record }` — `refused` is the sentence the merge queue carries (on the
 * merge-bead, the card, and its attempt count), `record` is lib/capa.js's refusal, for the
 * comment on the work bead. The sentence says how to answer it, because the person reading
 * the card is the person who has to: a refusal that names a control and not the remedy is
 * an obstruction with a citation.
 *
 * `workspace` is only for the commands in the sentence. A null issue — the work bead could
 * not be read — is **not** a refusal: this gate refuses silence, and a tracker that did not
 * answer has not said the bead is silent. The caller waits instead.
 */
export function claimRefusal(issue, { workspace = '', number = null, at = Date.now() } = {}) {
  if (!issue?.id) return null;
  const claim = declaredClaim(issue);
  if (claim.declared) return null;
  const ws = workspace || '<workspace>';
  const invented = claim.dropped.length
    ? ` Its controls block names ${claim.dropped.join(', ')}, which ${claim.dropped.length === 1 ? 'is' : 'are'} not in the corpus, so ${claim.dropped.length === 1 ? 'it does' : 'they do'} not count.`
    : '';
  const why =
    `${issue.id} declares no control, no requirement, and not that it exercises none.${invented} ` +
    `Declare one before it lands: \`beadcause-controls declare ${ws} ${issue.id} <id...>\`, a requirements block, ` +
    `or \`beadcause-controls none ${ws} ${issue.id}\` (the ${NO_CLAIM_LABEL} label) if it bears on nothing.`;
  const record = refusalRecord({
    control: CONTROL,
    gate: GATE,
    subject: number ? `the merge of #${number} for ${issue.id}` : `the merge for ${issue.id}`,
    why,
    at,
  });
  return { refused: `the claim gate refused it (${CONTROL}): ${why}`, record };
}
