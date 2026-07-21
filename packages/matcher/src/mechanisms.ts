import type { Reason } from "@mtg/engine";

/** Closed set of synergy mechanism categories, derived from EDHREC's most popular themes with
 *  kindred/tribal dropped (kindred is a "same creature type" axis, not a synergy mechanism this
 *  harness targets). Provisional membership — tune by reading real emitted reasons during eval. */
export const MECHANISM_CATEGORIES = [
  "aristocrats",
  "tokens-go-wide",
  "spellslinger",
  "reanimator",
  "voltron-auras",
  "lifegain-payoff",
  "landfall",
  "counters-plus1",
  "mana-ramp-payoff",
  "graveyard-matters",
  "attack-matters",
  "blink-etb",
  "mill-self",
  "wheels-draw",
] as const;

export type MechanismCategory = (typeof MECHANISM_CATEGORIES)[number];

/** A category's accepted reason signatures. A reason matches the category if its `tag` is in
 *  `tags` OR its `effectKind` is in `effectKinds`. `effectKinds` values are EFFECT_KINDS members;
 *  `tags` values are matcher reason tags of the form `${verb}:${subjectKey}` or `static:${kind}`. */
export interface CategoryMatchEntry {
  tags?: string[];
  effectKinds?: string[];
}

/** Category -> accepted reason signatures. This table is the ONLY coupling between the gold set
 *  and engine internals — on a tag rename, only this table changes. */
export const CATEGORY_MATCH: Record<MechanismCategory, CategoryMatchEntry> = {
  aristocrats: { effectKinds: ["drain", "player-life-loss", "forced-sacrifice", "damage"] },
  "tokens-go-wide": { effectKinds: ["token-generation", "token-doubling", "pump"] },
  spellslinger: {
    tags: ["casts:instant", "casts:sorcery"],
    effectKinds: ["copy-spell", "damage", "draw-card"],
  },
  reanimator: { effectKinds: ["graveyard-recursion", "animate"] },
  "voltron-auras": { effectKinds: ["pump", "counter-placement"] },
  "lifegain-payoff": { effectKinds: ["drain", "draw-card", "counter-placement"] },
  landfall: { tags: ["enters:land"], effectKinds: ["token-generation", "counter-placement", "pump"] },
  "counters-plus1": { effectKinds: ["counter-placement", "enters-with-counters", "trigger-doubling"] },
  "mana-ramp-payoff": { effectKinds: ["mana-generation", "fast-mana", "ritual", "cost-reduction", "tax"] },
  "graveyard-matters": { effectKinds: ["graveyard-recursion", "top-manipulation"] },
  "attack-matters": { tags: ["attacks:creature"], effectKinds: ["pump", "speed-increase", "damage"] },
  "blink-etb": { effectKinds: ["flicker", "clone"] },
  "mill-self": { effectKinds: ["graveyard-recursion", "top-manipulation"] },
  "wheels-draw": { effectKinds: ["draw-card"] },
};

/** True if the reason satisfies the category: its tag is accepted OR its effectKind is accepted. */
export function categoryMatches(reason: Reason, category: MechanismCategory): boolean {
  const entry = CATEGORY_MATCH[category];
  if (reason.tag && entry.tags?.includes(reason.tag)) return true;
  if (reason.effectKind && entry.effectKinds?.includes(reason.effectKind)) return true;
  return false;
}
