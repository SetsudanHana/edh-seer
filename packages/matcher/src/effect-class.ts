/** How a static effect relates to the game, and therefore what its strength scales with.
 *
 *  A CONTINUOUS effect modifies a set of objects ("creatures you control get +1/+1"); its strength
 *  is that set's size, so the same anthem is strong in a 40-body token deck and weak in a
 *  spellslinger deck with 8 creatures. A REPLACEMENT effect modifies occurrences of an event ("if
 *  you would create a token, instead create two"); its strength is how often that event happens,
 *  which puts doublers on the PRODUCER side of a theme rather than the payoff side.
 *
 *  Scope: the 22 kinds the 71-deck calibration corpus actually exercises. Everything else returns
 *  "unclassified" rather than a guess — see docs/superpowers/specs/2026-08-04-surplus-vs-baseline-design.md. */
export type EffectClass = "continuous" | "replacement" | "unclassified";

const CONTINUOUS = new Set([
  "pump", "cost-reduction", "tax", "speed-increase", "mana-generation",
  "top-manipulation", "animate", "damage", "token-generation",
]);

const REPLACEMENT = new Set([
  "trigger-doubling", "clone", "enters-with-counters", "token-doubling", "counter-placement",
]);

/** `damage-multiplier` carries two unlike effects. Pyromancer's Gauntlet ("deals that much damage
 *  plus 2") replaces a damage event; Felothar and Assault Formation ("assigns combat damage equal
 *  to its toughness") continuously redefine how damage is assigned and multiply nothing. The
 *  toughness cases are stat-gated and the multiplier cases are not, so the predicate splits them
 *  without a re-tagging run — the same discriminator CATEGORY_MATCH's toughness-matters uses. */
export function classifyEffect(kind: string, hasStatPredicate: boolean): EffectClass {
  if (kind === "damage-multiplier") return hasStatPredicate ? "continuous" : "replacement";
  if (CONTINUOUS.has(kind)) return "continuous";
  if (REPLACEMENT.has(kind)) return "replacement";
  return "unclassified";
}
