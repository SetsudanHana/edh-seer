import type { DeckCard } from "./types.js";
import type { Archetype } from "./archetypes.js";
import { answerClassesOf, loadRules, ruleMatches } from "./rules.js";

/** Functional build categories (the "does the deck have enough ramp/draw/interaction" layer). */
export type BuildCategory =
  | "ramp"
  | "draw"
  | "cardSelection"
  | "targetedRemoval"
  | "stackInteraction"
  | "boardWipe"
  | "burn"
  | "stax"
  | "protection"
  | "tutor"
  | "graveyardHate"
  | "lands";

export const BUILD_CATEGORIES: BuildCategory[] = [
  "ramp", "draw", "cardSelection", "targetedRemoval", "stackInteraction", "boardWipe", "burn", "stax", "protection", "tutor", "graveyardHate", "lands",
];

const isLand = (dc: DeckCard): boolean => dc.card.typeLine.toLowerCase().includes("land");

/** For each card, the set of functional categories it fills. A card may fill several (that's how
 *  double-duty in Stage D is found). Counts derive from set sizes.
 *
 *  The detectors themselves live in `rules.json` (design §13.7): same amount of code as hardcoding
 *  them, and it removes the migration a panel would otherwise need. Everything that used to be an
 *  `if` here is a rule row; the wipe-beats-targeted-removal `else if` is a `not` clause, and the
 *  land branch's `continue` is a `not typeLine: land` on every nonland rule.
 *
 *  The gate for editing them is `bin/build-population.ts` over the 71 calibration decks. Nothing
 *  else in the repo can see build categories: `population-compare.ts` watches edges and
 *  `panel-score.ts` watches edge precision, and a detector edit moves neither. */
export function detectBuildCategories(cards: DeckCard[]): Map<BuildCategory, Set<string>> {
  const m = new Map<BuildCategory, Set<string>>();
  const set = loadRules();

  for (const dc of cards) {
    for (const rule of set.rules) {
      if (!rule.category || !ruleMatches(rule, dc, set)) continue;
      const cat = rule.category as BuildCategory;
      let s = m.get(cat);
      if (!s) { s = new Set(); m.set(cat, s); }
      s.add(dc.card.name);
    }
  }

  return m;
}

/** The cards covering one answer class, split by mode. Name SETS rather than counters: a set is
 *  what lets a later panel say which card, and it makes double-matching harmless -- every exile
 *  removal matches both the class rule and the exile rule (design §3.2). */
export interface AnswerClassMembers {
  cards: Set<string>;
  /** Those that EXILE. The only recursion-proof answers (design §2.1). */
  exiling: Set<string>;
  /** Those that keep answering. Graveyard hate only, by construction -- no other rule carries
   *  `mode: "recurring"`, so the other five classes come out empty without a special case. */
  recurring: Set<string>;
}

/** Answer coverage: which classes of threat this deck can actually answer, and with how many
 *  cards (design §12.3).
 *
 *  Separate from `detectBuildCategories` because it is a different axis, not a finer version of the
 *  same one: `targetedRemoval` collapsed six enumerated types into one boolean, so a deck with
 *  eleven creature-removal spells and no enchantment answer looked identical to a balanced one.
 *
 *  Overlap is the point, not a caveat -- Vindicate covers four classes on one card, so the union is
 *  far below the sum. Pair this with `deckAvailability`'s hypergeometric to turn a count into
 *  "P(an answer for this class by turn T)". */
export function detectAnswerClasses(cards: DeckCard[]): Map<string, AnswerClassMembers> {
  const m = new Map<string, AnswerClassMembers>();
  for (const dc of cards) {
    for (const [cls, marks] of answerClassesOf(dc)) {
      let e = m.get(cls);
      if (!e) { e = { cards: new Set(), exiling: new Set(), recurring: new Set() }; m.set(cls, e); }
      e.cards.add(dc.card.name);
      if (marks.exile) e.exiling.add(dc.card.name);
      if (marks.recurring) e.recurring.add(dc.card.name);
    }
  }
  return m;
}

/** Command-Zone base targets (floors, except lands which is a two-sided band). Tunable. */
export const BASE_TARGETS: Record<BuildCategory, number> = {
  ramp: 10, draw: 10, cardSelection: 4, targetedRemoval: 10, stackInteraction: 0, boardWipe: 3,
  burn: 0, stax: 0, protection: 0, tutor: 0, lands: 36,
  // Target 0 = reported, never scored. The doctrine says every deck should carry graveyard hate
  // (design 12.3), but it is the one answer class that does NOT scale with count -- one Bojuka Bog
  // answers a recursion engine not at all -- so a count target would be a Tier C guess dressed as
  // a number. The honest target comes from required_k plus the static/repeatable axis, both later
  // steps. Until then a nonzero target here would silently re-tune buildScore for every deck.
  graveyardHate: 0,
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
  ramp: 1, draw: 1, cardSelection: 0.5, targetedRemoval: 1, stackInteraction: 0.5, boardWipe: 0.5,
  burn: 0.5, stax: 0.5, protection: 0.5, tutor: 0.5, graveyardHate: 0.5, lands: 1,
};

const LABELS: Record<BuildCategory, string> = {
  ramp: "Ramp", draw: "Draw", cardSelection: "Card selection", targetedRemoval: "Removal",
  stackInteraction: "Stack interaction", boardWipe: "Board wipes", burn: "Burn & drain",
  stax: "Stax", protection: "Protection", tutor: "Tutors", graveyardHate: "Graveyard hate",
  lands: "Lands",
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
