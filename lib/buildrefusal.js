/**
 * Where a build-time refusal is kept — the evidence that a gate that runs in the suite
 * operated, retrievable months after the run that produced it.
 *
 * bc-eqn1.8's acceptance asks every gate's refusal to name a corpus control and to be
 * evidence. A refusal at launch or at merge has a bead to be commented on
 * (`refusalComment` in lib/capa.js). A refusal in the suite has none: a red `test/…mjs`
 * is gone the moment the next run is green, and that is the whole difficulty.
 *
 * **The choice is a git ref, `refs/beadcause/build-refusals`, in the main checkout.** The
 * other two candidates each fail the question "is it still there in a year":
 *
 *   - `.claude/gate-runs/<run-id>.jsonl` is outside every worktree on purpose
 *     (lib/gaterun.js), so it survives a retirement, but it is churn by its own header —
 *     `b7e-gate` rotates and prunes it, and it is only written by a gate run, not by the
 *     bare `node test/x.mjs` a person types.
 *   - A comment on the bead whose branch failed needs a bead. A sweep that trips on
 *     `main`, or on a branch with no bead, has nowhere to write, and a suite that shells
 *     out to `bd` is a suite that fails differently on a machine without one.
 *
 * A ref in the common git dir is shared by every worktree, outlives each of them, and is
 * the same shape as the other evidence refs (lib/evidence.js registers it): chained, so
 * the history of refusals is tamper-evident the way the session transcripts are.
 *
 * One commit per distinct refusal. The message is `refusalComment`, so the first line
 * parses with `parseRefusal` exactly as a comment on a bead does, and the tree holds
 * `refusal.json` with every problem the gate found. A re-run that fails with the *same*
 * problems writes nothing — a red tree run forty times is one refusal, not forty.
 */
import { refusalRecord, refusalComment, parseRefusal } from './capa.js';
import { isControl } from './controls.js';
import { commitToRef, mainCheckout, readRefFile, refHistory, readMessage, refTip, writeTree } from './gitref.js';

export const BUILD_REFUSAL_REF = 'refs/beadcause/build-refusals';

const FILE = 'refusal.json';

/**
 * Record one refusal. `problems` are the sentences the gate printed.
 *
 * Throws on a `control` that is not in the corpus: a refusal naming a control nobody
 * defined is the fabricated-id failure lib/controls.js exists to prevent.
 * Returns `{ commit, deduped }`.
 */
export async function recordBuildRefusal(cwd, { control, gate, problems = [], at = Date.now() } = {}) {
  if (!isControl(control)) throw new Error(`${control} is not a control in lib/controls.js — a refusal has to name a real one`);
  const list = [...problems].map(String);
  const record = refusalRecord({
    control,
    gate,
    subject: `${list.length} problem${list.length === 1 ? '' : 's'}: ${list[0] ?? ''}`,
    why: list.slice(1, 3).join(' | '),
    at,
  });
  const main = await mainCheckout(cwd);
  const payload = Buffer.from(JSON.stringify({ gate: record.gate, control: record.control, problems: list }, null, 2) + '\n');

  const parent = await refTip(main, BUILD_REFUSAL_REF);
  if (parent && (await readRefFile(main, BUILD_REFUSAL_REF, FILE)) === payload.toString()) {
    return { commit: parent, deduped: true };
  }
  const tree = await writeTree(main, [[FILE, payload]]);
  const { commit } = await commitToRef(main, BUILD_REFUSAL_REF, tree, refusalComment(record), { expect: parent });
  return { commit, deduped: false };
}

/** Every recorded refusal, newest first: the parsed record plus the commit it lives in. */
export async function buildRefusals(cwd, { limit = 50 } = {}) {
  const main = await mainCheckout(cwd);
  const out = [];
  for (const h of await refHistory(main, BUILD_REFUSAL_REF, { limit })) {
    const parsed = parseRefusal((await readMessage(main, h.commit)) || h.subject);
    if (parsed) out.push({ ...parsed, commit: h.commit });
  }
  return out;
}

/**
 * The one call a gate suite makes when its check found problems: records the refusal and
 * returns the sentence the suite fails with, which names the control.
 */
export async function refuseBuild(cwd, { control, gate, problems }) {
  const { commit, deduped } = await recordBuildRefusal(cwd, { control, gate, problems });
  return (
    `${gate} refused the build (${control}) — ${problems.length} problem(s), recorded on ${BUILD_REFUSAL_REF} ` +
    `at ${commit.slice(0, 10)}${deduped ? ' (already recorded)' : ''}:\n  ` +
    problems.join('\n  ')
  );
}
