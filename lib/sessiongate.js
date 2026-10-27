/**
 * No window opens on a bead as an agent kind with no current impact assessment —
 * ISO/IEC 42001 Clause 6.1.4, at the launch rather than at the amendment (bc-eqn1.8.1).
 *
 * The decision is lib/impact.js's (`launchGate`); this is the half that has a tracker and
 * a management switch, called once from `launch` in lib/session.js. That is the one place
 * every window on a bead passes — the advocate's dispatch, a planner, an Epic Advocate,
 * the merge and review advocates, and the windows the phone opens by hand — so a gate
 * there cannot be walked around by a caller nobody remembered. The advocate does not
 * re-ask; it remembers what the door refused and skips the bead until the answer could
 * have changed (`impactHeld` in lib/advocate.js), so a standing refusal costs one slot
 * once, not one per tick.
 *
 * **Inert while the management system is off**, the same as the amendment gate: nothing
 * is read and nothing is written until lib/management.js says on. **With it on, every
 * launch is refused today**, because every assessment in lib/impact.js ships as a draft.
 * That is the honest consequence and is stated in the README rather than softened here.
 *
 * The refusal goes on the bead in lib/capa.js's shape — a refusal comment naming the
 * control and the `gate-refused` label, never a nonconformity — and is written **once per
 * bead per assessment state**: the comments are read first, and a refusal already there
 * with the same subject is not written again. A tracker failure while writing it must not
 * let the window through, so it is logged and the refusal still throws.
 */
import { REFUSAL_LABEL, refusalComment } from './capa.js';
import { launchGate, refusedAlready } from './impact.js';

/**
 * Throws unless a window on `bead` may open as `agent`. Returns nothing.
 *
 * `management`, `register` and `now` let a test say which install it is rather than read
 * this one's. `bd` is the caller's tracker where it has one; a door that has none gets one
 * built from `cfg`, only on the refusal path, so a launch the gate lets through pays
 * nothing for it.
 */
export async function assertAssessed(
  cfg,
  { agent = 'worker', bead = null, workspace = null, bd = null, management = null, register = null, now = null } = {}
) {
  if (!bead) return;
  const on = management ?? (await (await import('./management.js')).isOn());
  if (!on) return;

  const refused = launchGate({ agent, bead, now: now || new Date(), ...(register ? { register } : {}) });
  if (!refused) return;

  const { record } = refused;
  const ws = (workspace && cfg?.workspaces?.find((w) => w.name === workspace)) || { name: workspace };
  let written = false;
  try {
    const tracker = bd || (await trackerFor(cfg));
    if (!refusedAlready(await tracker.comments(ws, bead), record)) {
      await tracker.comment(ws, bead, refusalComment(record));
      await tracker.addLabel(ws, bead, REFUSAL_LABEL);
      written = true;
    }
  } catch (err) {
    console.error(`[beadcause] could not record the session impact refusal on ${bead}: ${err.message.split('\n')[0]}`);
  }
  throw Object.assign(new Error(`${bead} may not be worked — ${refused.message}`), {
    status: 409,
    impactRefused: true,
    refusal: record,
    agent,
    written,
  });
}

async function trackerFor(cfg) {
  const { Bd } = await import('./bd.js');
  return new Bd({ bin: cfg.bdBin, actor: cfg.actor, sharedServer: cfg.sharedServer, me: cfg.me, accounts: cfg.accounts });
}
