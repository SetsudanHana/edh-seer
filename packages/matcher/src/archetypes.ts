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

/** Share of the deck's nonland cards below which the deck is treated as having no
 *  identifiable mechanism-driven strategy (noise rather than a real archetype signal).
 *  This gates the mechanism-derived archetype *group* as a whole: once at least one
 *  mechanism archetype clears the floor, all detected mechanism archetypes are surfaced
 *  (even weak ones) since the deck's structure is already established. `combo` is
 *  exempt from this floor (see below) — its significance doesn't scale with deck share.
 *  Tunable. */
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

  const mechanismEntries: ArchetypeRanking[] = [...cardsByArchetype.entries()].map(([name, set]) => ({
    name,
    label: ARCHETYPE_LABELS[name],
    confidence: nonlandCount > 0 ? set.size / nonlandCount : 0,
  }));

  // Does any mechanism archetype clear the noise floor? If so, the deck has an
  // identifiable strategy and all detected mechanism archetypes ride along as ranked
  // signals; if not, none of them are meaningful enough to report.
  const hasMechanismSignal = mechanismEntries.some((r) => r.confidence >= ARCHETYPE_FLOOR);
  const ranked: ArchetypeRanking[] = hasMechanismSignal ? mechanismEntries : [];

  // A 2+ card combo is a real strategy regardless of what fraction of the deck it is —
  // it can win the game on its own, so it bypasses ARCHETYPE_FLOOR entirely.
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
