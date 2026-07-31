/** Layer-1 archetype taxonomy (the strategy layer) for Stage A1 of the deck-quality
 *  spec. Detects a deck's ranked strategy from the already-computed synergy-mechanism
 *  groups. This is deliberately the subset of the canonical 15 archetypes that existing
 *  mechanism signals cover; the heuristic ones (tribal, enchantress, artifacts, group
 *  slug/hug) and Control (needs BUILD signals) land in follow-on plans. */

export type Archetype =
  | "tokens"
  | "aristocrats"
  | "lifegain"
  | "landfall"
  | "spellslinger"
  | "reanimator"
  | "counters"
  | "voltron"
  | "combo"
  | "goodstuff";

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  tokens: "Tokens",
  aristocrats: "Aristocrats",
  lifegain: "Lifegain",
  landfall: "Landfall",
  spellslinger: "Spellslinger",
  reanimator: "Reanimator",
  counters: "+1/+1 Counters",
  voltron: "Voltron",
  combo: "Combo",
  goodstuff: "Goodstuff / Midrange",
};

/** Which layer-1 archetype each existing mechanism category feeds. Categories absent
 *  here are sub-mechanisms/functional (wheels-draw, blink-etb, mana-ramp-payoff,
 *  attack-matters, power/toughness-matters) and do NOT elevate to an archetype. */
export const MECHANISM_TO_ARCHETYPE: Partial<Record<string, Archetype>> = {
  "tokens-go-wide": "tokens",
  aristocrats: "aristocrats",
  "lifegain-payoff": "lifegain",
  landfall: "landfall",
  spellslinger: "spellslinger",
  reanimator: "reanimator",
  "graveyard-matters": "reanimator",
  "mill-self": "reanimator",
  "counters-plus1": "counters",
  "voltron-auras": "voltron",
};

export interface ArchetypeRanking {
  name: Archetype;
  label: string;
  confidence: number;
}

/** Share of the deck's nonland cards below which a MECHANISM-derived archetype is
 *  treated as noise rather than a real strategy (e.g. a 2-card minor theme shouldn't
 *  be reported as "the deck's archetype"). Applied independently per mechanism
 *  archetype — clearing it is not contingent on any other archetype's confidence.
 *  `combo` is exempt from this floor (see below): combos are binary, not
 *  density-based — a 2-card combo is a real plan regardless of deck size. Tunable. */
const ARCHETYPE_FLOOR = 0.08;

const GOODSTUFF: ArchetypeRanking = { name: "goodstuff", label: ARCHETYPE_LABELS.goodstuff, confidence: 0 };

export function detectArchetypes(
  mechanismGroups: { category: string; cards: string[] }[],
  comboCards: string[],
  nonlandCount: number,
): ArchetypeRanking[] {
  const cardsByArchetype = new Map<Archetype, Set<string>>();
  const add = (a: Archetype, cards: Iterable<string>): void => {
    const set = cardsByArchetype.get(a) ?? new Set<string>();
    for (const c of cards) set.add(c);
    cardsByArchetype.set(a, set);
  };

  for (const group of mechanismGroups) {
    const archetype = MECHANISM_TO_ARCHETYPE[group.category];
    if (archetype) add(archetype, group.cards);
  }

  // Mechanism-derived archetypes must independently clear ARCHETYPE_FLOOR to be listed.
  const ranked: ArchetypeRanking[] = [...cardsByArchetype.entries()]
    .map(([name, set]) => ({
      name,
      label: ARCHETYPE_LABELS[name],
      confidence: nonlandCount > 0 ? set.size / nonlandCount : 0,
    }))
    .filter((r) => r.confidence >= ARCHETYPE_FLOOR);

  // `combo` bypasses ARCHETYPE_FLOOR entirely — a 2+ card combo can win the game on its
  // own, so it's always included once present, with a real confidence value for ranking.
  if (comboCards.length >= 2) {
    const comboSet = new Set(comboCards);
    ranked.push({
      name: "combo",
      label: ARCHETYPE_LABELS.combo,
      confidence: nonlandCount > 0 ? comboSet.size / nonlandCount : 0,
    });
  }

  ranked.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  return ranked.length > 0 ? ranked : [GOODSTUFF];
}
