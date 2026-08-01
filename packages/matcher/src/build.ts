import type { DeckCard } from "./types.js";
import type { Archetype } from "./archetypes.js";

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
const TARGETED_REMOVAL_RE = /(destroy|exile) target|counter target spell|return target .*? to .*? hand|target creature gets -|target player sacrifices|target permanent shuffles it into/i;
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

/** Command-Zone base targets (floors, except lands which is a two-sided band). Tunable. */
export const BASE_TARGETS: Record<BuildCategory, number> = {
  ramp: 10, draw: 10, targetedRemoval: 10, boardWipe: 3, protection: 0, tutor: 0, lands: 36,
};

/** Per-archetype target shifts (added to the base, floored at 0). Starting points, tunable. */
export const ARCHETYPE_TARGET_DELTAS: Partial<Record<Archetype, Partial<Record<BuildCategory, number>>>> = {
  tokens: { boardWipe: -2 },          // don't wipe your own board
  aristocrats: { boardWipe: -1 },
  voltron: { boardWipe: -2, protection: 3 }, // one threat → protect it
  combo: { tutor: 4, protection: 2, boardWipe: -1 }, // assemble + defend the line
  reanimator: { tutor: 2 },
  landfall: { lands: 4 },
  counters: { boardWipe: -1 },
};

/** Category importance in the weighted average. Interaction/engine categories weigh full; the
 *  situational ones (wipes/protection/tutors) weigh half. Tunable. */
const CATEGORY_WEIGHT: Record<BuildCategory, number> = {
  ramp: 1, draw: 1, targetedRemoval: 1, boardWipe: 0.5, protection: 0.5, tutor: 0.5, lands: 1,
};

const LABELS: Record<BuildCategory, string> = {
  ramp: "Ramp", draw: "Draw", targetedRemoval: "Removal", boardWipe: "Board wipes",
  protection: "Protection", tutor: "Tutors", lands: "Lands",
};

/** Full credit within ±3 of the land target, linear falloff to 0 at ±12 (24 or 48 lands). */
const LAND_BAND = 3;
const LAND_FALLOFF = 9;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function adjustedTargets(primary: Archetype | undefined): Record<BuildCategory, number> {
  const t = { ...BASE_TARGETS };
  const deltas = primary ? ARCHETYPE_TARGET_DELTAS[primary] : undefined;
  if (deltas) {
    for (const [k, v] of Object.entries(deltas)) {
      const key = k as BuildCategory;
      t[key] = Math.max(0, t[key] + (v ?? 0));
    }
  }
  return t;
}

export interface BuildResult {
  /** 0–5: weighted mean of per-category attainment (categories with target 0 are excluded). */
  buildScore: number;
  buildCategories: { category: string; count: number; target: number }[];
  suggestions: string[];
}

export function computeBuild(cards: DeckCard[], primary: Archetype | undefined): BuildResult {
  const members = detectBuildCategories(cards);
  const targets = adjustedTargets(primary);
  // Lands are the one multi-copy category: count land CARDS (copies), not distinct names, so a
  // deck's ~24 basics register as ~24, not 1. Every other category is singleton in Commander, so
  // distinct-name membership size already equals the copy count.
  const landCount = cards.reduce((n, dc) => n + (isLand(dc) ? 1 : 0), 0);
  const countOf = (c: BuildCategory): number => (c === "lands" ? landCount : members.get(c)?.size ?? 0);

  const buildCategories = BUILD_CATEGORIES.map((c) => ({ category: c, count: countOf(c), target: targets[c] }));

  let weightSum = 0;
  let attainSum = 0;
  for (const c of BUILD_CATEGORIES) {
    const target = targets[c];
    if (target <= 0) continue; // zero-target category is neutral — excluded from the score
    const count = countOf(c);
    const attainment =
      c === "lands"
        ? clamp01(1 - Math.max(0, Math.abs(count - target) - LAND_BAND) / LAND_FALLOFF)
        : Math.min(count / target, 1); // exceeding a floor never penalizes
    weightSum += CATEGORY_WEIGHT[c];
    attainSum += CATEGORY_WEIGHT[c] * attainment;
  }
  const buildScore = weightSum > 0 ? (attainSum / weightSum) * 5 : 0;

  return { buildScore, buildCategories, suggestions: buildSuggestions(countOf, targets) };
}

/** Concrete, few, actionable — ranked by gap size, top 4. Never scolding. */
function buildSuggestions(
  countOf: (c: BuildCategory) => number,
  targets: Record<BuildCategory, number>,
): string[] {
  const gaps: { gap: number; text: string }[] = [];
  for (const c of BUILD_CATEGORIES) {
    const target = targets[c];
    if (target <= 0) continue;
    const count = countOf(c);
    if (c === "lands") {
      if (count < target - LAND_BAND) gaps.push({ gap: target - count, text: `Lands ${count} — aim for ~${target}` });
      else if (count > target + LAND_BAND) gaps.push({ gap: count - target, text: `Lands ${count} — high, aim for ~${target}` });
      continue;
    }
    if (count < target) {
      const text =
        count === 0 && c === "boardWipe"
          ? `No board wipe (target ${target})`
          : `${LABELS[c]} ${count}/${target} — add ~${target - count}`;
      gaps.push({ gap: target - count, text });
    }
  }
  return gaps.sort((a, b) => b.gap - a.gap).slice(0, 4).map((g) => g.text);
}

/** Small flat premium to a double-duty card's synergyRating. Mirrors the versatilityMult shape
 *  (analyze.ts VERSATILITY_STEP = 0.15). Tunable. Double-duty is boolean, so this applies once —
 *  never stacked per role — and doubleDutyRating caps at 5 so it can't dwarf the deck-relative scale. */
export const DOUBLE_DUTY_MULT = 1.15;

export const doubleDutyRating = (base: number): number => Math.min(5, base * DOUBLE_DUTY_MULT);

/** Invert category membership into the functional role(s) each card fills, by card name. A card in
 *  several categories lists several roles. Feeds the double-duty check and the UI role marker. */
export function rolesByCard(members: Map<BuildCategory, Set<string>>): Map<string, BuildCategory[]> {
  const out = new Map<string, BuildCategory[]>();
  for (const [category, names] of members) {
    for (const name of names) {
      const roles = out.get(name);
      if (roles) roles.push(category);
      else out.set(name, [category]);
    }
  }
  return out;
}
