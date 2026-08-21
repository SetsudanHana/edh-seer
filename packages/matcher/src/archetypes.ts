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

/** Confidence the top archetype must reach before it may LEAD -- before a report says "this is a
 *  Tokens deck" rather than "these signals are present" (roadmap A15).
 *
 *  THE NAMING LAYERS ARE THE ONLY CODE IN THIS REPO THAT CANNOT SAY "I DON'T KNOW". The persist gate
 *  refuses a card, `unknownTriggers` refuses a near-miss, the tutor gate refuses a bare type -- but
 *  `detectArchetypes` always returns a top row (GOODSTUFF sits at confidence 0 and can never win a
 *  sort), so a deck with no positive identity in this vocabulary gets named whatever ranked second.
 *  Measured: cares-gating the aristocrats signature (roadmap A13) halved the false confidences on
 *  the six owner-named control decks -- zenos 0.43 -> 0.20 -- and moved not one of their labels,
 *  because argmax has nothing else to return.
 *
 *  0.25 comes from the distribution, not from tuning: over the 71 decks the top confidence runs
 *  median 0.19 / p75 0.31, the decks nobody disputes lead at 0.32-0.51 (smooth-criminal 0.32,
 *  rakdos-landfall 0.35, acererak-combo 0.44, naya-spellslinger 0.51), and five of the six control
 *  decks lead at 0.11-0.22. */
export const ARCHETYPE_LEAD_FLOOR = 0.25;

/** The archetype a report may NAME the deck after, or undefined when none is strong enough.
 *  `detectArchetypes`' ranked list is unchanged and every existing consumer keeps reading it --
 *  including `computeBuild`, whose target adjustment reads `strategies[0]` and is a SCORING
 *  question, not a naming one. */
export function dominantArchetype(ranked: readonly ArchetypeRanking[]): ArchetypeRanking | undefined {
  const top = ranked[0];
  return top && top.name !== "goodstuff" && top.confidence >= ARCHETYPE_LEAD_FLOOR ? top : undefined;
}

export interface CardSignal {
  name: string;
  /** The card's own theme tags (from cardThemeTags): "${verb}:${subjectKey}" / "static:${kind}". */
  themeTags: string[];
  /** The subset of `themeTags` the card CARES about -- its triggers and conditions (from
   *  `cardCaresTags`), never what it merely does. A DEMAND-DEFINED archetype (below) counts a card
   *  full when the signature matches here and at `PRODUCER_SHARE` when it matches only the supply
   *  side. Optional: a caller that does not compute it gets the old all-supply behaviour. */
  caresTags?: string[];
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
export const ARCHETYPE_SIGNATURE: Partial<Record<Archetype, ArchetypeSignature>> = {
  tokens: { tags: ["create-token:any"], effectKinds: ["token-generation", "token-doubling"] },
  // death/sacrifice events define aristocrats; forced-sacrifice dropped — edict engines land
  // via their dies:/sacrifice: emits, and dropping it sheds the destroy→forced-sacrifice mislabel.
  // DEMAND-DEFINED (2026-08-21). An aristocrats deck is its PAYOFFS -- Zulaport Cutthroat, Blood
  // Artist, Mayhem Devil -- not the removal spell that happens to emit `sacrifice:creature`.
  // Counting supply and demand alike made a control deck's removal package into its aristocrats
  // confidence: MEASURED over the 71 decks, 815 of the 974 matches are supply-only against 159
  // cares-backed, and Aristocrats topped 4 of the 6 decks the owner named "Control" -- decks with
  // no Zulaport and no Blood Artist in them. The Sorin defect (`analyze.ts:590`) one layer up.
  aristocrats: { tags: ["dies:", "sacrifice:"], effectKinds: ["drain"], demandDefined: true },
  lifegain: { tags: ["gain-life:any"], effectKinds: ["lifegain"] },
  landfall: { tags: ["enters:land"] },
  spellslinger: { tags: ["cast:instant", "cast:sorcery"], effectKinds: ["copy-spell"] },
  reanimator: { effectKinds: ["graveyard-recursion", "animate"] },
  counters: { tags: ["proliferate:any"], effectKinds: ["counter-placement", "enters-with-counters", "proliferate"] },
  voltron: { subtypes: ["equipment", "aura"] },
};

/** A token that is MANA OR A CARD, not a board presence. Making a Treasure is ramp: the go-wide
 *  wincon already excludes these for the same reason (`wincon.ts`), and counting them made every
 *  incidental Treasure maker a Tokens card -- MEASURED, 227 of the 774 token matches across the 71
 *  decks are resource-only, 218 of them Treasure. `any` is NOT here: `create-token:any` is a named
 *  member of the signature, so an untyped token maker still counts. */
export const RESOURCE_TOKENS: ReadonlySet<string> = new Set([
  "treasure", "clue", "food", "blood", "map", "gold", "powerstone", "incubator", "junk",
]);

/** True when every token this card is known to create is a resource. A card with no
 *  `create-token:` tag at all is NOT excluded -- the kind fired on evidence this function cannot
 *  see, and a silent exclusion would be the wrong failure direction. */
function makesOnlyResourceTokens(signal: CardSignal): boolean {
  const made = signal.themeTags
    .filter((t) => t.startsWith("create-token:"))
    .map((t) => t.slice("create-token:".length));
  return made.length > 0 && made.every((m) => RESOURCE_TOKENS.has(m));
}

export interface ArchetypeSignature {
  tags?: string[];
  effectKinds?: string[];
  subtypes?: string[];
  /** The archetype is its PAYOFFS, so a card matching only on the supply side counts at
   *  `PRODUCER_SHARE` rather than full. Set per row, with the measurement in the comment beside it
   *  -- most archetypes are supply-defined (a token maker MAKES tokens, a reanimation spell DOES
   *  the recursion) and `create-token` is not even a trigger event anywhere in the corpus, so
   *  `tokens` is 0 cares-backed by construction and could never be gated this way. */
  demandDefined?: boolean;
}

function matchesSignature(signal: CardSignal, sig: ArchetypeSignature): boolean {
  const tagHit =
    sig.tags?.some((t) =>
      t.endsWith(":") ? signal.themeTags.some((tt) => tt.startsWith(t)) : signal.themeTags.includes(t),
    ) ?? false;
  const kindHit = sig.effectKinds?.some((k) => signal.effectKinds.includes(k)) ?? false;
  const subtypeHit = sig.subtypes?.some((s) => signal.subtypes.includes(s)) ?? false;
  return tagHit || kindHit || subtypeHit;
}

/** Whether the signature is satisfied by what the card WANTS, as opposed to what it supplies. */
function matchesDemand(signal: CardSignal, sig: ArchetypeSignature): boolean {
  if (signal.caresTags === undefined) return true; // caller computed no demand side: old behaviour
  return (
    sig.tags?.some((t) =>
      t.endsWith(":") ? signal.caresTags!.some((tt) => tt.startsWith(t)) : signal.caresTags!.includes(t),
    ) ?? false
  );
}

/** The weight a supply-only card carries toward a DEMAND-DEFINED archetype. The same constant the
 *  theme ranking uses for the same reason (`analyze.ts`'s `PRODUCER_SHARE`): a card that supplies
 *  the event is evidence, and a card that watches for it is the archetype. */
const PRODUCER_SHARE = 0.35;

export function detectArchetypes(
  cardSignals: CardSignal[],
  comboCards: string[],
  nonlandCount: number,
): ArchetypeRanking[] {
  const weightByArchetype = new Map<Archetype, Map<string, number>>();
  for (const signal of cardSignals) {
    for (const [archetype, sig] of Object.entries(ARCHETYPE_SIGNATURE) as [Archetype, ArchetypeSignature][]) {
      if (!matchesSignature(signal, sig)) continue;
      if (archetype === "tokens" && makesOnlyResourceTokens(signal)) continue;
      const weight = sig.demandDefined && !matchesDemand(signal, sig) ? PRODUCER_SHARE : 1;
      const byCard = weightByArchetype.get(archetype) ?? new Map<string, number>();
      byCard.set(signal.name, Math.max(byCard.get(signal.name) ?? 0, weight));
      weightByArchetype.set(archetype, byCard);
    }
  }

  // Signal-derived archetypes must independently clear ARCHETYPE_FLOOR to be listed.
  const ranked = [...weightByArchetype.entries()]
    .map(([name, byCard]) => ({
      name,
      label: ARCHETYPE_LABELS[name],
      confidence: nonlandCount > 0 ? [...byCard.values()].reduce((a, b) => a + b, 0) / nonlandCount : 0,
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
