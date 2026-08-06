/** What a payoff's magnitude COUNTS, as one of the engine's closed SCALING_BASES.
 *
 *  This channel was already built and already consumed: `edges.ts` copies `effect.scaling` onto every
 *  Reason at four sites, `impact.ts` weights a reason by it, and `buckets.ts` reads it. The FLAT
 *  population carried it on 1,781 cards. The derived population carried it on ZERO — derivation
 *  simply never set it — so flipping TAGS_SOURCE to `derived` took the whole channel dark without
 *  anyone measuring the loss. This file is the repair.
 *
 *  Read from the ACTION's own `amount` and `object`, never from the clause text. "Draw a card for
 *  each creature you control, then create a Treasure token" states one count, and it belongs to the
 *  draw; reading the clause would make the Treasure per-creature too. That is the same cross-action
 *  bleed `recipient.ts` is bounded to avoid. It costs reach — 221 corpus actions carry the count in
 *  their own fields and a further 329 mentions live only in the clause — and the reach is not worth a
 *  wrong basis, which is consumed as if it were true.
 *
 *  A count the vocabulary cannot name (Dragonspark Reactor's charge counters) stays UNSET, which the
 *  engine already reads as "fixed". */
import type { Action } from "../canonicalize.js";
import type { ScalingBasis } from "../schema.js";

/** Order matters. A graveyard count is per-graveyard even when the thing counted is a creature --
 *  SCALING_ALIASES maps "per-graveyard-creature" to per-graveyard, so that is the canonical reading
 *  and it must be tested before per-creature can claim Diregraf Colossus. */
const BASES: [RegExp, ScalingBasis][] = [
  [/\bin (?:your|a|each|their|all) graveyards?\b|\bgraveyards?\b/i, "per-graveyard"],
  [/\bopponents?\b|\bplayers? in the game\b|\beach player\b/i, "per-opponent"],
  [/\bcreatures?\b/i, "per-creature"],
  [/\b(?:permanents?|artifacts?|enchantments?|lands?|devotion)\b/i, "per-permanent"],
  [/\bspells?\s+you'?ve\s+cast\b|\bstorm\b|\bspells?\s+cast\b/i, "per-cast-or-spell"],
];

/** The noun a count actually counts. Matching the whole string reads the LOCATION as the basis:
 *  Dragonspark Reactor's "the number of charge counters on this artifact" counts counters, not
 *  artifacts, and the table would have called it per-permanent off the word "artifact". Everything
 *  from " on " is dropped for that reason; " in " is kept, because "in your graveyard" IS the basis. */
const COUNTED = /\b(?:for each|number of)\s+([^.,;]{1,60})/i;

export function actionScaling(action: Action): ScalingBasis | undefined {
  const amount = action.amount ?? "";
  // A bare X is the cost the player chose, whatever noun follows it.
  if (/^x$/i.test(amount.trim())) return "x-cost";
  const counted = COUNTED.exec(`${amount} ${action.object ?? ""}`);
  if (!counted) return undefined;
  const noun = counted[1].split(/\s+on\s+/i)[0];
  for (const [re, basis] of BASES) if (re.test(noun)) return basis;
  return undefined;
}
