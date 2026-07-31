import type { Reason, ArchetypeGroup } from "@mtg/engine";

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
  "toughness-matters",
  "power-matters",
] as const;

export type MechanismCategory = (typeof MECHANISM_CATEGORIES)[number];

/** A category's accepted reason signatures. A reason matches the category if its `tag` is in
 *  `tags` OR its `effectKind` is in `effectKinds`. `effectKinds` values are EFFECT_KINDS members;
 *  `tags` values are matcher reason tags of the form `${verb}:${subjectKey}` or `static:${kind}`. */
export interface CategoryMatchEntry {
  tags?: string[];
  effectKinds?: string[];
  /** When true, a matching tag/effectKind is not enough — the Reason must also carry
   *  hasStatPredicate:true. Used for categories whose whole point is a StatPredicate gate
   *  (power-matters, toughness-matters), where the linking tag alone is shared with
   *  unconditional producers of the same event. */
  requireStatPredicate?: boolean;
}

/** Category -> accepted reason signatures. This table is the ONLY coupling between the gold set
 *  and engine internals — on a tag rename, only this table changes. */
export const CATEGORY_MATCH: Record<MechanismCategory, CategoryMatchEntry> = {
  aristocrats: { effectKinds: ["drain", "player-life-loss", "forced-sacrifice", "damage"] },
  "tokens-go-wide": { tags: ["create-token:any"], effectKinds: ["token-generation", "token-doubling", "pump", "damage"] },
  spellslinger: {
    tags: ["cast:instant", "cast:sorcery"],
    effectKinds: ["copy-spell", "damage", "draw-card"],
  },
  reanimator: { effectKinds: ["graveyard-recursion", "animate"] },
  "voltron-auras": { effectKinds: ["pump", "counter-placement"] },
  "lifegain-payoff": { tags: ["gain-life:any"], effectKinds: ["drain", "draw-card", "counter-placement"] },
  // 0 clean EDHREC pairs as of 2026-07-28, sourcer limitation
  landfall: { tags: ["enters:land"], effectKinds: ["token-generation", "counter-placement", "pump"] },
  "counters-plus1": { tags: ["proliferate:any"], effectKinds: ["counter-placement", "enters-with-counters", "trigger-doubling"] },
  "mana-ramp-payoff": { effectKinds: ["mana-generation", "fast-mana", "ritual", "cost-reduction", "tax"] },
  "graveyard-matters": { effectKinds: ["graveyard-recursion", "top-manipulation"] },
  // 0 clean EDHREC pairs as of 2026-07-28, sourcer limitation
  "attack-matters": { tags: ["attacks:creature"], effectKinds: ["pump", "speed-increase", "damage"] },
  "blink-etb": { effectKinds: ["flicker", "clone"] },
  "mill-self": { tags: ["enters-graveyard:creature", "enters-graveyard:any"], effectKinds: ["graveyard-recursion", "top-manipulation"] },
  "wheels-draw": { tags: ["draw:any"], effectKinds: ["draw-card"] },
  // Conditional stat edges (Slice 1): the predicate itself isn't in the reason tag — the tag is
  // still `${verb}:${subjectKey}` / `static:${kind}` regardless of any `stats` predicate on the
  // subject, and that linking tag is shared with any unconditional producer of the same event.
  // Unlike every other category in this table, a tag match alone is NOT sufficient here — these
  // two are the exception: requireStatPredicate additionally demands reason.hasStatPredicate,
  // so only a genuinely predicate-gated match (not a coincidental unconditional one) counts.
  "toughness-matters": { tags: ["static:damage-multiplier"], requireStatPredicate: true },
  "power-matters": { tags: ["enters:creature"], requireStatPredicate: true },
};

/** True if the reason satisfies the category: its tag is accepted OR its effectKind is accepted.
 *  When the category's entry sets requireStatPredicate, a tag/effectKind match alone is not
 *  enough — the reason must also carry hasStatPredicate:true. */
export function categoryMatches(reason: Reason, category: MechanismCategory): boolean {
  const entry = CATEGORY_MATCH[category];
  const tagOrKindMatches =
    (reason.tag !== undefined && entry.tags?.includes(reason.tag)) ||
    (reason.effectKind !== undefined && entry.effectKinds?.includes(reason.effectKind));
  if (!tagOrKindMatches) return false;
  if (entry.requireStatPredicate && !reason.hasStatPredicate) return false;
  return true;
}

export const MECHANISM_LABELS: Record<MechanismCategory, string> = {
  aristocrats: "Aristocrats",
  "tokens-go-wide": "Tokens Go Wide",
  spellslinger: "Spellslinger",
  reanimator: "Reanimator",
  "voltron-auras": "Voltron & Auras",
  "lifegain-payoff": "Lifegain Payoff",
  landfall: "Landfall",
  "counters-plus1": "+1/+1 Counters",
  "mana-ramp-payoff": "Ramp Payoff",
  "graveyard-matters": "Graveyard Matters",
  "attack-matters": "Attack Triggers",
  "blink-etb": "Blink / ETB",
  "mill-self": "Self-Mill",
  "wheels-draw": "Draw Engine",
  "toughness-matters": "Toughness Matters",
  "power-matters": "Power Matters",
};

/** Groups synergy edges by mechanism category. An edge can land in more than one
 *  group (a pair can be both Aristocrats and Tokens); edges matching zero categories
 *  collect into a synthetic "other" group so nothing silently disappears. Categories
 *  with zero matching edges are omitted entirely. Sorted by member-card count
 *  descending (ties: label ascending), except "other" which always sorts last. */
export function groupEdgesByArchetype(
  edges: { a: string; b: string; reasons: Reason[] }[],
): ArchetypeGroup[] {
  const groups = new Map<
    MechanismCategory | "other",
    { cards: Set<string>; pairs: { a: string; b: string; reasons: Reason[] }[] }
  >();

  for (const edge of edges) {
    const matched = MECHANISM_CATEGORIES.filter((cat) => edge.reasons.some((r) => categoryMatches(r, cat)));
    const categories: (MechanismCategory | "other")[] = matched.length > 0 ? matched : ["other"];
    for (const category of categories) {
      if (!groups.has(category)) groups.set(category, { cards: new Set(), pairs: [] });
      const g = groups.get(category)!;
      g.cards.add(edge.a);
      g.cards.add(edge.b);
      g.pairs.push({ a: edge.a, b: edge.b, reasons: edge.reasons });
    }
  }

  const result: ArchetypeGroup[] = [...groups.entries()].map(([category, g]) => ({
    category,
    label: category === "other" ? "Other synergies" : MECHANISM_LABELS[category],
    cards: [...g.cards].sort(),
    pairs: g.pairs,
  }));

  result.sort((x, y) => {
    if (x.category === "other") return 1;
    if (y.category === "other") return -1;
    return y.cards.length - x.cards.length || x.label.localeCompare(y.label);
  });

  return result;
}
