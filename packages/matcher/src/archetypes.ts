/** Layer-1 archetype taxonomy (the strategy layer) for Stage A1 of the deck-quality
 *  spec. Detects a deck's ranked strategy from each nonland card's OWN tight,
 *  mostly-disjoint defining-mechanism signal (see ARCHETYPE_SIGNATURE below) — NOT from
 *  mechanism-category edge groups. Edge groups (groupEdgesByArchetype/CATEGORY_MATCH)
 *  intentionally spread a card into every category any of its synergy edges touch and
 *  include broad shared effect-kinds (damage, draw-card, pump), so on real decks nearly
 *  every card lands in nearly every group and confidences inflate toward 1.0 without
 *  discriminating. This is deliberately the subset of the canonical 15 archetypes that
 *  existing tag/effect signals cover; the heuristic ones (tribal, enchantress, artifacts,
 *  group slug/hug) and Control (needs BUILD signals) land in follow-on plans. */

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

export interface CardSignal {
  name: string;
  /** The card's own theme tags (from cardThemeTags): "${verb}:${subjectKey}" / "static:${kind}". */
  themeTags: string[];
  /** The card's own ability effect kinds (ability.effect.kind). */
  effectKinds: string[];
  /** Voltron-relevant card subtypes: "equipment" always; "aura" only when it enchants a creature. */
  subtypes: string[];
}

/** Each archetype's DEFINING own-card mechanism. Deliberately tight and mostly disjoint:
 *  it EXCLUDES broad shared kinds (damage, draw-card, pump) that would make every card
 *  match every archetype (the bug this replaces). Tag strings mirror the validated ones
 *  already used in mechanisms.ts CATEGORY_MATCH. Voltron keys on subtypes (equipment,
 *  creature-enchanting auras) rather than tags/effect-kinds. Tunable. */
export const ARCHETYPE_SIGNATURE: Partial<Record<Archetype, { tags?: string[]; effectKinds?: string[]; subtypes?: string[] }>> = {
  tokens: { tags: ["create-token:any"], effectKinds: ["token-generation", "token-doubling"] },
  // death/sacrifice events define aristocrats; forced-sacrifice dropped — edict engines land
  // via their dies:/sacrifice: emits, and dropping it sheds the destroy→forced-sacrifice mislabel.
  aristocrats: { tags: ["dies:", "sacrifice:"], effectKinds: ["drain"] },
  lifegain: { tags: ["gain-life:any"], effectKinds: ["lifegain"] },
  landfall: { tags: ["enters:land"] },
  spellslinger: { tags: ["cast:instant", "cast:sorcery"], effectKinds: ["copy-spell"] },
  reanimator: { effectKinds: ["graveyard-recursion", "animate"] },
  counters: { tags: ["proliferate:any"], effectKinds: ["counter-placement", "enters-with-counters", "proliferate"] },
  voltron: { subtypes: ["equipment", "aura"] },
};

function matchesSignature(signal: CardSignal, sig: { tags?: string[]; effectKinds?: string[]; subtypes?: string[] }): boolean {
  const tagHit =
    sig.tags?.some((t) =>
      t.endsWith(":") ? signal.themeTags.some((tt) => tt.startsWith(t)) : signal.themeTags.includes(t),
    ) ?? false;
  const kindHit = sig.effectKinds?.some((k) => signal.effectKinds.includes(k)) ?? false;
  const subtypeHit = sig.subtypes?.some((s) => signal.subtypes.includes(s)) ?? false;
  return tagHit || kindHit || subtypeHit;
}

export function detectArchetypes(
  cardSignals: CardSignal[],
  comboCards: string[],
  nonlandCount: number,
): ArchetypeRanking[] {
  const cardsByArchetype = new Map<Archetype, Set<string>>();
  for (const signal of cardSignals) {
    for (const [archetype, sig] of Object.entries(ARCHETYPE_SIGNATURE) as [Archetype, { tags?: string[]; effectKinds?: string[]; subtypes?: string[] }][]) {
      if (matchesSignature(signal, sig)) {
        const set = cardsByArchetype.get(archetype) ?? new Set<string>();
        set.add(signal.name);
        cardsByArchetype.set(archetype, set);
      }
    }
  }

  // Signal-derived archetypes must independently clear ARCHETYPE_FLOOR to be listed.
  const ranked = [...cardsByArchetype.entries()]
    .map(([name, set]) => ({
      name,
      label: ARCHETYPE_LABELS[name],
      confidence: nonlandCount > 0 ? set.size / nonlandCount : 0,
    }))
    .filter((r) => r.confidence >= ARCHETYPE_FLOOR);

  // combo is floor-exempt: a 2+ card combo is real regardless of deck size.
  if (comboCards.length >= 2) {
    ranked.push({
      name: "combo",
      label: ARCHETYPE_LABELS.combo,
      confidence: nonlandCount > 0 ? new Set(comboCards).size / nonlandCount : 0,
    });
  }

  ranked.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  return ranked.length > 0 ? ranked : [GOODSTUFF];
}
