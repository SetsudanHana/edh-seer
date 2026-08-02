import type { SaltPayload } from "./calibrate-core.js";

/** Slugify a card name to CommanderSalt's key format (lowercase, underscored):
 *  "Venser, Shaper Savant" -> "venser_shaper_savant".
 *
 *  Apostrophes are STRIPPED, not replaced: CS emits "an_offer_you_cant_refuse" and
 *  "vivis_persistence", verified against a live payload 2026-08-02. calibrate.ts's local
 *  `slug()` replaces them instead, producing "an_offer_you_can_t_refuse" -- so it silently
 *  drops every apostrophe card from its CS correlation. Do not copy that helper. */
export function csSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The 30 card categories CommanderSalt emits under cards.<slug>.categories.stats,
 *  observed live on 2026-08-02. Kept explicit so a new upstream category surfaces as an
 *  unmapped-list failure rather than being silently ignored. */
export const CS_CATEGORIES: readonly string[] = [
  "anthem", "aristocrats", "blink", "boardWipes", "burn", "cantrip", "cheat", "clone",
  "combat", "costReduction", "counterspell", "discard", "enchantress", "fastmana",
  "graveyard", "groupslug", "kindred", "landsmatter", "manafixing", "multipliers",
  "otherControl", "plusOnePlusOneCounters", "ramp", "reanimator", "recursion", "slow",
  "spotRemoval", "tokens", "topdeck", "tutor",
];

/** CS slug -> the set of categories CS labelled that card with. Cards present but unlabelled
 *  map to an empty set, so "CS saw this card and gave it nothing" stays distinguishable from
 *  "CS never saw this card". */
export function csCardCategories(payload: SaltPayload): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [slug, card] of Object.entries(payload.cards ?? {})) {
    const stats = card?.categories?.stats ?? {};
    out.set(slug, new Set(Object.entries(stats).filter(([, v]) => v === true).map(([k]) => k)));
  }
  return out;
}

export interface CsDeckArchetype {
  major: string;
  minor: string;
  /** Sub-archetype name -> percentage, flattened across majors. */
  subPercentages: Map<string, number>;
}

/** Deck-level archetype labels, or null when the payload has no archetype block. */
export function csDeckArchetype(payload: SaltPayload): CsDeckArchetype | null {
  const a = payload.details.archetypes;
  if (!a) return null;
  const subPercentages = new Map<string, number>();
  for (const major of Object.values(a.percentages ?? {})) {
    for (const [name, sub] of Object.entries(major.subArchetypes ?? {})) {
      if (typeof sub.percentage === "number") subPercentages.set(name, sub.percentage);
    }
  }
  return { major: a.dominantArchetype ?? "", minor: a.dominantSubArchetype ?? "", subPercentages };
}
