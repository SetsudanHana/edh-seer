import type { DeckCard } from "./types.js";
import type { Archetype } from "./archetypes.js";
import { answerClassesOf, loadRules, ruleMatches } from "./rules.js";
import { answerCoverage, type CoverageResult } from "./answer-coverage.js";

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
 *  0 because they are win-plan/tax signals, reported but never folded into a parent or scored.
 *
 *  `lands: 36` IS A FALLBACK NOW, NOT THE SCORED NUMBER (task 9, owner's ruling 2026-08-21) -- it
 *  measures nothing (67 of 71 calibration decks hit it outright, since every EDH deck is built to
 *  this same convention) and only wins when `land-count.ts`'s own regression extrapolates past its
 *  tested range. See `gatedLandsTarget`. */
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
export interface BuildParentSpec {
  name: string;
  leaves: BuildCategory[];
  target: number;
  weight: number;
  /** This parent's attainment is multiplied by answer COVERAGE as well as its count (design §3).
   *  Declared here rather than matched on `name` in `computeBuild`, so the fact lives beside the
   *  parent it describes and a rename cannot silently unwire it. */
  coverageWeighted?: true;
}

export const BUILD_PARENTS: BuildParentSpec[] = [
  { name: "Consistency", leaves: ["draw", "cardSelection", "tutor"], target: 14, weight: 1 },
  { name: "Ramp", leaves: ["ramp"], target: 10, weight: 1 },
  { name: "Interaction", leaves: ["targetedRemoval", "stackInteraction", "graveyardHate", "protection"], target: 10, weight: 1, coverageWeighted: true },
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
 *  `landfall` (`lands` sits outside every parent and keeps its own band, exactly as before -- and
 *  still applies on top of a DERIVED band now that one exists, see `adjustedTargets`'s doc comment
 *  for why that is not a double-count, task 9). */
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

/** THE REGRESSION'S OWN TESTED RANGE (task 9, owner's ruling 2026-08-21) --
 *  `packages/engine/src/karsten.test.ts`'s four published arms: avgManaValue 1.8 -> 3.5 yielding
 *  lands 28 -> 39. `karstenLands` carries a floor ("play -2 lands is not advice") but no ceiling of
 *  its own, so a deck whose curve runs past where anyone checked it keeps answering anyway --
 *  izzet-big-mana's avgManaValue 5.98 (71% past the top arm) answers 50 lands in a 99-card deck,
 *  which is not advice either. This is that same argument at the other end: outside the tested
 *  range the derived target is an extrapolation, not a measurement, and `gatedLandsTarget` refuses
 *  it rather than score against a guess.
 *
 *  MEASURED (controller, task 9 brief): the flat 36 gives 67 of 71 calibration decks full land
 *  attainment -- it discriminates for nobody, because every EDH deck is built to the convention it
 *  came from. Gated, the derived target changes attainment on 16 of 71 (15 falling, 1 rising), and
 *  12 of 71 decks fall back (their curve asks for 40-50). This bound is the regression's own tested
 *  range, not fitted to these 71 decks -- the self-comparison trap `BASE_TARGETS`'s median/p25/p75
 *  note already warns about. */
export const KARSTEN_TESTED_MIN = 28;
export const KARSTEN_TESTED_MAX = 39;

export interface LandsTarget {
  target: number;
  /** 'derived' when `land-count.ts`'s regression landed inside the tested range and scored;
   *  'flat' when it fell outside (an extrapolation) or was never supplied at all. */
  source: "derived" | "flat";
}

/** THE ONE PLACE THIS DECISION IS MADE (task 9) -- `computeBuild` (the score) and
 *  `computeDeckMath`'s `lands` block (the panel row) both call this on the SAME rounded Karsten
 *  target (`land-count.ts`'s `recommendedLands(...).target`, computed once upstream and threaded
 *  in), so they can never again disagree about which number a deck is being measured against. That
 *  disagreement -- the score scoring flat 36 while the panel showed the regression's own answer --
 *  is the defect this task closes.
 *
 *  ponytail: THIS GATES THE REGRESSION'S OUTPUT, NOT ITS INPUTS -- and the two are not the same
 *  refusal (fix F2, controller review 2026-08-21). With `commanders=1, rampPlusDraw=0, fastMana=0,
 *  mdfcUntapped=0, mdfcTapped=0`, `karstenLands`'s arithmetic reduces to
 *  `raw = 31.419 + 3.135*avgManaValue`, so avgManaValue alone stays inside [28, 39] only up to
 *  ~2.42 -- but `rampPlusDraw`/`fastMana`/the MDFC terms all SUBTRACT from `raw`, and nothing bounds
 *  how large they can be relative to `avgManaValue`. A deck can walk `avgManaValue` out to roughly
 *  7.76 (e.g. ~20 cheap accelerants and 6 fast-mana rocks alongside a curve near 6) and still land
 *  inside [28, 39], indistinguishable here from a deck whose curve was actually tested. So "refuses
 *  to extrapolate" is only PARTLY true: it refuses an extreme MV with an ordinary ramp package, and
 *  says nothing about an extreme MV propped up by an extreme ramp package. Upgrade path if this ever
 *  matters: gate the INPUTS (bound `avgManaValue`, or ramp/fast directly) rather than `raw`, which
 *  the controller's ruling explicitly declined to do here -- an input gate would refuse decks this
 *  output gate currently scores, and that trade needs its own before/after over the 71 decks. */
export function gatedLandsTarget(karstenTarget: number | undefined): LandsTarget {
  if (karstenTarget !== undefined && karstenTarget >= KARSTEN_TESTED_MIN && karstenTarget <= KARSTEN_TESTED_MAX) {
    return { target: karstenTarget, source: "derived" };
  }
  return { target: BASE_TARGETS.lands, source: "flat" };
}

/** Lands' own scoring weight -- the one leaf that still scores on its own band, outside every
 *  parent. Matches the old per-leaf `CATEGORY_WEIGHT.lands`, which this replaces. */
const LANDS_WEIGHT = 1;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Leaf-level targets: `lands` (and, always at 0, `burn`/`stax`) for their own scoring/reporting,
 *  and every grouped leaf for the `buildCategories` per-leaf `target` field a leaf shows nothing
 *  meaningful in any more. A grouped leaf IGNORES `ARCHETYPE_TARGET_DELTAS` here on purpose -- its
 *  delta already reached its parent in `adjustedParentTargets`, and applying it again here would
 *  double the shift (and resurrect a leaf target the whole point of this task retires).
 *
 *  `landsTarget` is the GATED number (`gatedLandsTarget`'s output, already decided by the caller) --
 *  never a raw Karsten figure, and never recomputed here, so this function has no opinion of its
 *  own about the regression. Defaults to the flat convention so every existing caller (tests, the
 *  CLI path with no Karsten input at hand) keeps its pre-task-9 answer unless it opts in.
 *
 *  `landfall`'s `{ lands: 4 }` delta still applies here, ON TOP OF whichever target was chosen
 *  (task 9, owner's ruling): it is a different claim from the one the regression answers. Karsten
 *  reads castability -- can this curve be CAST on time -- and has no term for how often a landfall
 *  payoff wants to see a land drop, which is a question about TRIGGER density, not curve. A cheap,
 *  land-search-heavy landfall deck if anything pulls the derived target DOWN (lower avg mana value),
 *  which is the opposite direction from what the archetype wants, so the delta is not double-counting
 *  a fact the regression already sees -- it is compensating for an axis the regression cannot see at
 *  all. MEASURED, not merely argued (fix F3, controller review 2026-08-21): exactly ONE of the 71
 *  calibration decks has a `landfall`-primary and a derived (non-fallback) land target --
 *  `rakdos-landfall`, at a derived target of 39, ABOVE the corpus median of 36 -- so the one deck
 *  the delta actually reaches is not the regression running low and needing a rescue; it is a deck
 *  the curve already prices as land-hungry, running even more on top by deliberate design. Affects
 *  every deck whose primary archetype is `landfall`, whichever target is in force. */
export function adjustedTargets(
  primary: Archetype | undefined,
  landsTarget: number = BASE_TARGETS.lands,
): Record<BuildCategory, number> {
  const t = { ...BASE_TARGETS, lands: landsTarget };
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
  /** Which target `buildScore` actually scored the land count against (task 9) -- 'derived' when
   *  `karstenLandsTarget` landed inside `gatedLandsTarget`'s tested range, 'flat' when it fell
   *  outside (an extrapolation) or was never supplied. Exists so a caller (the panel, a test) can
   *  say WHY the number is what it is rather than print a fallback silently. */
  landsTargetSource: LandsTarget["source"];
  suggestions: string[];
  /** The coverage multiplier applied to `Interaction`, and the per-class weights it was built
   *  from, so the panel and a test can say WHY the number is what it is rather than trust it. */
  answerCoverage: CoverageResult;
}

/** `karstenLandsTarget` is `land-count.ts`'s `recommendedLands(...).target` -- the regression's own
 *  rounded answer for THIS deck, computed once upstream (analyze.ts) and threaded in here rather
 *  than recomputed, so `land-count.ts` stays the one place `karstenLands` is called. Undefined for
 *  every caller that has not computed it (existing tests, any other path), which falls back to the
 *  flat convention through `gatedLandsTarget`. */
export function computeBuild(
  cards: DeckCard[],
  primary: Archetype | undefined,
  karstenLandsTarget?: number,
  /** Union of the COMMANDERS' colour identities (CR 903.4). Undefined for a caller that has not
   *  computed it, which refuses the pool weight rather than guessing one -- see `answerCoverage`. */
  colorIdentity?: string[],
  /** `max(confidence(reanimator), confidence(aristocrats))` from `detectArchetypes`. 0 for a deck
   *  whose plan does not run through the graveyard, which is the neutral value: at v=0 demand is
   *  the format baseline alone. */
  graveyardVulnerability = 0,
): BuildResult {
  const members = detectBuildCategories(cards);
  const landsGate = gatedLandsTarget(karstenLandsTarget);
  const targets = adjustedTargets(primary, landsGate.target);
  // Lands are the one multi-copy category: count land CARDS (copies), not distinct names, so a
  // deck's ~24 basics register as ~24, not 1. Every other category is singleton in Commander, so
  // distinct-name membership size already equals the copy count.
  const landCount = cards.reduce((n, dc) => n + (isLand(dc) ? 1 : 0), 0);
  const countOf = (c: BuildCategory): number => (c === "lands" ? landCount : members.get(c)?.size ?? 0);

  const buildCategories = BUILD_CATEGORIES.map((c) => ({ category: c, count: countOf(c), target: targets[c] }));

  // BREADTH, beside the count. `detectAnswerClasses` already lives in this file, so unlike the
  // Karsten land target this needs no threading from `computeDeckMath` and no call reordering.
  const answered = new Set(
    [...detectAnswerClasses(cards)].filter(([, m]) => m.cards.size > 0).map(([cls]) => cls),
  );
  const coverage = answerCoverage(colorIdentity, answered, graveyardVulnerability);

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
    // COVERAGE MULTIPLIES, IT DOES NOT REPLACE. Ten creature-removal spells and nothing else is
    // both enough cards and one answer; the product is the only reading that says so.
    const counted = Math.min(p.count / p.target, 1); // exceeding a floor never penalizes
    const attainment = p.coverageWeighted ? counted * coverage.coverage : counted;
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

  return {
    buildScore, buildCategories, buildParents,
    landsTargetSource: landsGate.source,
    suggestions: buildSuggestions(parentsWithCount, countOf, targets),
    answerCoverage: coverage,
  };
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
