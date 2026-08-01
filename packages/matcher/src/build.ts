import type { DeckCard } from "./types.js";

/** Functional build categories (the "does the deck have enough ramp/draw/interaction" layer). */
export type BuildCategory =
  | "ramp"
  | "draw"
  | "targetedRemoval"
  | "boardWipe"
  | "protection"
  | "tutor"
  | "lands";

export const BUILD_CATEGORIES: BuildCategory[] = [
  "ramp", "draw", "targetedRemoval", "boardWipe", "protection", "tutor", "lands",
];

/** Structured effect kinds that count as ramp (mirrors analyze.ts's RAMP_EFFECT_KINDS). Tunable. */
const RAMP_EFFECT_KINDS = new Set(["mana-generation", "fast-mana", "ritual"]);

const isLand = (dc: DeckCard): boolean => dc.card.typeLine.toLowerCase().includes("land");

// Oracle-text keyword heuristics (NEW this stage). Documented starting points — false positives
// (e.g. "destroy target" on an Aura you control) are acceptable noise for a first pass; precision
// is a tuning knob, revisited in verification. All tested case-insensitively.
const BOARD_WIPE_RE = /destroy all|exile all|each player sacrifices|all creatures? get [+-]|return all/i;
const TARGETED_REMOVAL_RE = /(destroy|exile) target|counter target spell|return target .*? to .*? hand|target creature gets -|target player sacrifices/i;
const PROTECTION_RE = /hexproof|indestructible|protection from|can't be countered|shroud|phases? out/i;
const TUTOR_RE = /search your library for/i;
// A search that only fetches lands is ramp/fixing, not a tutor (spec).
const LAND_FETCH_RE = /search your library for (a |an |up to \w+ )?(basic )?(land|forest|island|swamp|mountain|plains)/i;

/** For each card, the set of functional categories it fills. A card may fill several (that's how
 *  double-duty in Stage D is found). Counts derive from set sizes. */
export function detectBuildCategories(cards: DeckCard[]): Map<BuildCategory, Set<string>> {
  const m = new Map<BuildCategory, Set<string>>();
  const add = (cat: BuildCategory, name: string): void => {
    let s = m.get(cat);
    if (!s) { s = new Set(); m.set(cat, s); }
    s.add(name);
  };

  for (const dc of cards) {
    const name = dc.card.name;
    if (isLand(dc)) { add("lands", name); continue; } // a land counts only toward lands

    if (dc.tags) {
      for (const a of dc.tags.abilities) {
        if (RAMP_EFFECT_KINDS.has(a.effect.kind)) add("ramp", name);
        if (a.effect.kind === "draw-card") add("draw", name);
      }
    }

    const text = dc.card.oracleText;
    // Wipe takes precedence over targeted removal so a mass effect isn't counted in both.
    if (BOARD_WIPE_RE.test(text)) add("boardWipe", name);
    else if (TARGETED_REMOVAL_RE.test(text)) add("targetedRemoval", name);
    if (PROTECTION_RE.test(text)) add("protection", name);
    if (TUTOR_RE.test(text) && !LAND_FETCH_RE.test(text)) add("tutor", name);
  }

  return m;
}
