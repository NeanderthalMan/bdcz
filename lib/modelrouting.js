/**
 * The system card and the routing it describes must change together — bc-eqn1.8.3.
 *
 * `MODEL_BY_TIER` in lib/complexity.js is the whole routing decision. The system cards
 * (lib/systemcard.js) describe the agents that run on it, and before this nothing tied
 * the two: change the mapping and every card silently described a system that no longer
 * existed. The card now records the mapping it was written against (`routing`), and this
 * compares that record with the live one.
 *
 * Pure on purpose: it takes the live values as parameters so a suite can show it fail
 * against a mapping nobody committed. The real check is test/modelrouting.mjs, and a
 * failure there is recorded through lib/buildrefusal.js.
 */
import { MODEL_BY_TIER, FALLBACK_MODEL } from './complexity.js';
import { SYSTEM, systemCard } from './systemcard.js';
import { baseline, AGENTS, cardOf } from './foundation.js';

/** The corpus control this gate enforces: technical documentation kept current. */
export const MODEL_ROUTING_CONTROL = 'ISO42001.A.6.2.7';
export const MODEL_ROUTING_GATE = 'model-card';

/** Sentences for every disagreement between the card's `routing` and the live routing. */
export function routingProblems({ mapping = MODEL_BY_TIER, fallback = FALLBACK_MODEL, card = systemCard(SYSTEM) } = {}) {
  const problems = [];
  const written = card.routing;
  if (!written || typeof written !== 'object') {
    return [`the ${SYSTEM} system card records no \`routing\` — it does not say which tier mapping it was written against.`];
  }
  const tiers = new Set([...Object.keys(mapping), ...Object.keys(written.mapping || {})]);
  for (const tier of [...tiers].sort()) {
    const live = mapping[tier];
    const was = written.mapping?.[tier];
    if (live !== was) {
      problems.push(
        `tier \`${tier}\` routes to ${live === undefined ? '(nothing)' : `\`${live}\``} in lib/complexity.js but the system card ` +
          `in lib/systemcard.js was written against ${was === undefined ? '(nothing)' : `\`${was}\``} — update the card with the mapping.`
      );
    }
  }
  if (written.fallback !== fallback) {
    problems.push(
      `FALLBACK_MODEL is \`${fallback}\` in lib/complexity.js but the system card was written against ` +
        `\`${written.fallback}\` — update the card with the mapping.`
    );
  }
  return problems;
}

/** The agent cards that say they are routed must name the model the fallback routes to. */
export function agentCardProblems({ fallback = FALLBACK_MODEL } = {}) {
  const problems = [];
  for (const id of AGENTS) {
    const model = cardOf(baseline(id)).model;
    if (model.routed && model.model !== fallback) {
      problems.push(`the ${id} card says it is routed to \`${model.model}\`, but the fallback is \`${fallback}\`.`);
    }
  }
  return problems;
}
