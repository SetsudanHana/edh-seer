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

/** Command-Zone base targets (floors, except lands which is a two-sided band). Tunable.
 *
 *  LEAVES NO LONGER CARRY A TARGET (owner, 2026-08-21, overriding spec §6.2's leaf-scored shape).
 *  Every leaf that sits inside a `BUILD_PARENTS` entry below is 0 here, whatever its own count looks
 *  like -- measured over the 71 calibration decks, card selection's median SHARE of Consistency is
 *  11% and tutor's is 0% (44 of 71 decks carry none), so neither was ever a floor a deck must clear
 *  on its own; it is how this deck happened to spend a floor set at the group. Only `lands` keeps a
 *  real number (its own two-sided band, scored apart from every parent); `burn` and `stax` stay at
 *  0 because they are win-plan/tax signals, reported but never folded into a parent or scored. */
export const BASE_TARGETS: Record<BuildCategory, number> = {
  ramp: 0, draw: 0, cardSelection: 0, targetedRemoval: 0, stackInteraction: 0, boardWipe: 0,
  burn: 0, stax: 0, protection: 0, tutor: 0, graveyardHate: 0,
  lands: 36,
};

/** A parent's floor, DECLARED ONCE HERE rather than invented by summing its leaves' old targets
 *  (owner, 2026-08-21, overriding spec §6.2). Same Command Zone provenance the leaf floors carried
 *  (14, 10, 10, 3 today), stated at the level a player actually reasons about -- "do I have enough
 *  consistency" rather than "do I have enough card selection specifically".
 *
 *  MEASURED, not fitted (`build-population.ts` over the 71 calibration decks) -- median (union) /
 *  p25-p75: Consistency 15 / 12-19, Ramp 13 / 10-17, Interaction 18 / 13-21, Board wipes 1 / 0-2.
 *  Every sum-of-leaf-floors number below sits inside or near its own band, which is why the shape
 *  moved rather than the numbers: 14, 10, 10 and 3 are still the targets, just no longer three (or
 *  four) independent claims about one deck. */
export interface BuildParentSpec { name: string; leaves: BuildCategory[]; target: number; weight: number }

export const BUILD_PARENTS: BuildParentSpec[] = [
  { name: "Consistency", leaves: ["draw", "cardSelection", "tutor"], target: 14, weight: 1 },
  { name: "Ramp", leaves: ["ramp"], target: 10, weight: 1 },
  { name: "Interaction", leaves: ["targetedRemoval", "stackInteraction", "graveyardHate", "protection"], target: 10, weight: 1 },
  { name: "Board wipes", leaves: ["boardWipe"], target: 3, weight: 0.5 },
];

/** Every leaf a parent owns. `lands`, `burn` and `stax` are deliberately absent -- see the note
 *  above `BASE_TARGETS` for why they stay outside every group. */
const GROUPED_LEAVES = new Set<BuildCategory>(BUILD_PARENTS.flatMap((p) => p.leaves));

/** Per-archetype target shifts, STILL KEYED BY THE LEAF THEY NAME -- "combo decks want tutors" is
 *  the readable fact; `adjustedParentTargets` is what decides where it lands.
 *
 *  WHERE A DELTA REACHES NOW, AND WHY (owner's decision, 2026-08-21, the two honest options the
 *  brief posed): apply it to the PARENT that owns the named leaf, never drop it. A delta on a leaf
 *  that IS a whole single-leaf parent on its own (`boardWipe`) reaches exactly the card it always
 *  named, unchanged in meaning. A delta on a leaf living INSIDE a multi-leaf parent (`tutor` inside
 *  Consistency, `protection` inside Interaction) reaches the PARENT's floor instead, because the
 *  leaf has no floor of its own to raise any more: `combo: { tutor: 4 }` no longer means "run four
 *  tutors", it means "a combo deck's Consistency floor sits four higher than goodstuff's",
 *  satisfiable by tutors, draw, card selection, or any mix. Dropping the delta instead would erase
 *  the true fact that combo/reanimator/voltron decks want MORE of the group a tutor or protection
 *  spell sits in; folding it into the parent keeps that fact and drops only the narrower claim
 *  (spend it on THIS leaf) the 0%-median-share measurement above says was never grounded.
 *
 *  MEANING CHANGES FOR: `voltron` (protection +3 now widens Interaction as a whole, not a
 *  protection-spell count), `combo` (tutor +4 widens Consistency, protection +2 widens Interaction),
 *  `reanimator` (tutor +2 widens Consistency). UNCHANGED IN MEANING: `tokens`, `aristocrats`,
 *  `counters` (each names `boardWipe`, a single-leaf parent, so leaf and parent move as one) and
 *  `landfall` (`lands` sits outside every parent and keeps its own band, exactly as before). */
export const ARCHETYPE_TARGET_DELTAS: Partial<Record<Archetype, Partial<Record<BuildCategory, number>>>> = {
  tokens: { boardWipe: -2 },          // don't wipe your own board
  aristocrats: { boardWipe: -1 },
  voltron: { boardWipe: -2, protection: 3 }, // one threat → protect it
  combo: { tutor: 4, protection: 2, boardWipe: -1 }, // assemble + defend the line
  reanimator: { tutor: 2 },
  landfall: { lands: 4 },
  counters: { boardWipe: -1 },
};

/** Full credit within ±3 of the land target, linear falloff to 0 at ±12 (24 or 48 lands). */
const LAND_BAND = 3;
const LAND_FALLOFF = 9;

/** Lands' own scoring weight -- the one leaf that still scores on its own band, outside every
 *  parent. Matches the old per-leaf `CATEGORY_WEIGHT.lands`, which this replaces. */
const LANDS_WEIGHT = 1;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Leaf-level targets: `lands` (and, always at 0, `burn`/`stax`) for their own scoring/reporting,
 *  and every grouped leaf for the `buildCategories` per-leaf `target` field a leaf shows nothing
 *  meaningful in any more. A grouped leaf IGNORES `ARCHETYPE_TARGET_DELTAS` here on purpose -- its
 *  delta already reached its parent in `adjustedParentTargets`, and applying it again here would
 *  double the shift (and resurrect a leaf target the whole point of this task retires). */
export function adjustedTargets(primary: Archetype | undefined): Record<BuildCategory, number> {
  const t = { ...BASE_TARGETS };
  const deltas = primary ? ARCHETYPE_TARGET_DELTAS[primary] : undefined;
  if (deltas) {
    for (const [k, v] of Object.entries(deltas)) {
      const key = k as BuildCategory;
      if (GROUPED_LEAVES.has(key)) continue; // reaches the parent instead -- see adjustedParentTargets
      t[key] = Math.max(0, t[key] + (v ?? 0));
    }
  }
  return t;
}

/** Parent-level targets, archetype-adjusted: each parent's own floor plus the sum of any delta
 *  named on one of ITS leaves (see `ARCHETYPE_TARGET_DELTAS`'s doc comment for the full reasoning). */
export function adjustedParentTargets(primary: Archetype | undefined): BuildParentSpec[] {
  const deltas = primary ? ARCHETYPE_TARGET_DELTAS[primary] : undefined;
  return BUILD_PARENTS.map((p) => {
    let delta = 0;
    if (deltas) for (const leaf of p.leaves) delta += deltas[leaf] ?? 0;
    return { ...p, target: Math.max(0, p.target + delta) };
  });
}

export interface BuildResult {
  /** 0–5: weighted mean of per-PARENT attainment (a parent with target 0 would be excluded; none
   *  is, today) plus lands, scored on its own band. */
  buildScore: number;
  /** Per-leaf count, for the client's distribution rows. `target` is 0 on every grouped leaf now --
   *  see `BASE_TARGETS` -- and stays real only for `lands` (and the always-0 `burn`/`stax`). */
  buildCategories: { category: string; count: number; target: number }[];
  /** One row per `BUILD_PARENTS` entry: archetype-adjusted target, and the UNION of its leaves'
   *  member sets (never the sum -- see `computeBuild`). The client renders the target, ratio and
   *  flag HERE and only count+share on the leaf rows beneath (owner's 2026-08-21 ruling). */
  buildParents: { name: string; count: number; target: number; leaves: string[] }[];
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

  const parentTargets = adjustedParentTargets(primary);
  // A PARENT'S COUNT IS A UNION, NEVER A SUM -- a card can carry two of a parent's leaves (Grave
  // Researcher is cardSelection AND draw-adjacent), and summing would double-count it. Measured
  // overlap across the 71 decks: 0.5 cards on Consistency, 1.3 on Interaction -- small, and still
  // wrong to ignore. Kept BuildCategory-typed (not the public `string[]` shape) so `buildSuggestions`
  // can call `countOf` on a leaf directly; widened to the public shape only at the return below.
  const parentsWithCount = parentTargets.map((p) => {
    const union = new Set<string>();
    for (const leaf of p.leaves) for (const name of members.get(leaf) ?? []) union.add(name);
    return { ...p, count: union.size };
  });

  let weightSum = 0;
  let attainSum = 0;
  for (const p of parentsWithCount) {
    if (p.target <= 0) continue; // same "neutral, unscored" convention every zero-target category used
    const attainment = Math.min(p.count / p.target, 1); // exceeding a floor never penalizes
    weightSum += p.weight;
    attainSum += p.weight * attainment;
  }
  // Lands scores exactly as before, on its own two-sided band, outside every parent.
  const landsTarget = targets.lands;
  if (landsTarget > 0) {
    const attainment = clamp01(1 - Math.max(0, Math.abs(landCount - landsTarget) - LAND_BAND) / LAND_FALLOFF);
    weightSum += LANDS_WEIGHT;
    attainSum += LANDS_WEIGHT * attainment;
  }
  const buildScore = weightSum > 0 ? (attainSum / weightSum) * 5 : 0;

  const buildParents = parentsWithCount.map((p) => ({ name: p.name, count: p.count, target: p.target, leaves: p.leaves as string[] }));

  return { buildScore, buildCategories, buildParents, suggestions: buildSuggestions(parentsWithCount, countOf, targets) };
}

/** Concrete, few, actionable — ranked by gap size, top 4. Never scolding.
 *
 *  PARENT-LEVEL NOW (owner's 2026-08-21 ruling): a leaf can no longer be short of anything, so a
 *  gap names its parent only -- "Consistency 9/14 — add ~5". `lands` is unchanged: its own band,
 *  its own message.
 *
 *  NO "THINNEST LEAF" HINT (fix F1, controller review 2026-08-21): a first cut named the leaf the
 *  deck ran least of, e.g. "(thinnest: tutors)" -- but `tutor` has a 0% MEDIAN SHARE across the 71
 *  calibration decks and 44 of 71 decks carry none at all, so on a real deck it was almost always
 *  the one leaf the corpus says nobody runs. Naming it turned "your Consistency is short" into "go
 *  buy tutors", a recommendation nothing measured supports and exactly the leaf-level claim this
 *  task exists to remove. It was also redundant with the leaf distribution rows the client already
 *  renders beneath the parent bar, which show every leaf's real count. */
function buildSuggestions(
  parents: (BuildParentSpec & { count: number })[],
  countOf: (c: BuildCategory) => number,
  targets: Record<BuildCategory, number>,
): string[] {
  const gaps: { gap: number; text: string }[] = [];
  for (const p of parents) {
    if (p.target <= 0 || p.count >= p.target) continue;
    const text =
      p.count === 0 && p.name === "Board wipes"
        ? `No board wipe (target ${p.target})`
        : `${p.name} ${p.count}/${p.target} — add ~${p.target - p.count}`;
    gaps.push({ gap: p.target - p.count, text });
  }
  const landsTarget = targets.lands;
  const landCount = countOf("lands");
  if (landCount < landsTarget - LAND_BAND) gaps.push({ gap: landsTarget - landCount, text: `Lands ${landCount} — aim for ~${landsTarget}` });
  else if (landCount > landsTarget + LAND_BAND) gaps.push({ gap: landCount - landsTarget, text: `Lands ${landCount} — high, aim for ~${landsTarget}` });
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
