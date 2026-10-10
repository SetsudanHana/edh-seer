import type { KarstenInputs } from "@edh-seer/engine";
import { BUILD_PARENTS, detectBuildCategories } from "./build.js";
import { classifyAccelerant } from "./goldfish.js";
import { RAMP_RESILIENCE, drawCredit, landTarget } from "./mana-base.js";
import type { DeckCard } from "./types.js";
import { countsAsLand } from "./typeline.js";

/** The mana value at or below which acceleration counts for Karsten's 0.28 bucket. Cheap ramp
 *  shortens the turns the regression is about; a four-mana ramp spell needs the lands you were
 *  trying to count. */
const CHEAP = 2;

const isLand = (dc: DeckCard): boolean => countsAsLand(dc.card);

/** A modal double-faced card with a LAND back, and whether that land enters untapped -- Karsten
 *  prices the two differently (0.74 of a land against 0.38), because a tapped one costs you the
 *  turn you play it.
 *
 *  `layout` IS THE GATE, and measuring is what forced it: the type-line test alone catches Treasure
 *  Map // Treasure Cove, Dowsing Dagger // Lost Vale, Ojer Axonil and Growing Rites of Itlimoc,
 *  which are TRANSFORM cards -- their land back is reached by transforming a permanent already in
 *  play and you can never play them as a land. That is the same distinction `FRONT_FACE_ONLY` draws
 *  in derive. Five of the fifteen candidates in the 71 decks are that shape.
 *
 *  UNTAPPED covers two printed shapes: a back with no tapped clause at all, and the Zendikar Rising
 *  cycle's "As this land enters, you may pay 3 life. If you don't, it enters tapped" -- a real
 *  choice, and the cycle Karsten's untapped coefficient was fitted on. */
const mdfcLandBack = (dc: DeckCard): "untapped" | "tapped" | null => {
  if (dc.card.layout !== "modal_dfc") return null;
  const halves = dc.card.typeLine.split("//").map((s) => s.trim());
  if (halves.length !== 2 || /\bland\b/i.test(halves[0]) || !/\bland\b/i.test(halves[1])) return null;
  const back = (dc.card.oracleText ?? "").split("\n//\n")[1] ?? "";
  if (/you may pay/i.test(back)) return "untapped";
  return /enters tapped/i.test(back) ? "tapped" : "untapped";
};

/** Karsten's inputs, read off the deck. `landTarget` reads the average and the cheap acceleration;
 *  the rest ride along for the panel, which names them.
 *
 *  THE SPLIT THIS EXISTS FOR: `fast-mana` sits inside the ramp category everywhere else in this
 *  repo, and Karsten needs it out. A Mox is worth a WHOLE land; cheap ramp is worth 0.28 of one.
 *  Counting five Moxen as cheap ramp costs 3.6 lands of recommendation, which the spec calls the
 *  error most implementations make.
 *
 *  Fast mana is identified by the spec's own definition -- a NONLAND card costing 0 that produces
 *  mana -- rather than by the tagger's `fast-mana` effect kind. The definition is about the card's
 *  printed cost, `producedMana` now reaches `Card`, and a definition beats a label when the label
 *  was assigned for a different purpose. */
export function landInputs(
  deck: readonly DeckCard[],
  opts: { commanderNames?: readonly string[] } = {},
): Required<KarstenInputs> {
  const commanders = new Set(opts.commanderNames ?? []);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  // AN MDFC IS A LAND (owner ruling 2026-08-31), so it is NOT in the spell pool. Karsten's own
  // convention is the opposite -- count it as a spell and discount the requirement by 0.74/0.38 --
  // and `recommendedLands` below records why this repo departs from it. What matters here is that
  // the two halves move together: a card counted as a land must also leave the pool that sets
  // `avgManaValue`, the regression's dominant term, or its mana value pushes the target back up by
  // part of what the count just gained. That is the same double count this change exists to remove,
  // pointing the other way.
  const nonland = library.filter((dc) => !isLand(dc));

  const avgManaValue = nonland.length > 0
    ? nonland.reduce((sum, dc) => sum + dc.card.manaValue, 0) / nonland.length
    : 0;

  const fast = nonland.filter(
    (dc) => dc.card.manaValue === 0 && (dc.card.producedMana ?? []).length > 0,
  );
  const fastNames = new Set(fast.map((dc) => dc.card.name));

  // Ramp and draw membership come from the same rules every other readout uses, so a rules edit
  // moves this too rather than leaving a second definition behind.
  const members = detectBuildCategories([...library]);
  const accelerants = new Set([
    ...(members.get("ramp") ?? []),
    ...(members.get("draw") ?? []),
    // A cheap nonland that produces mana is a rock, whatever the tagger made of it. `ramp` reaches
    // rocks through the `mana-generation` effect kind, which needs the card to have been TAGGED --
    // so an untagged Sol Ring would leave the regression thinking the deck has no acceleration at
    // all. `producedMana` is printed data and cannot go missing that way.
    ...nonland
      .filter((dc) => dc.card.manaValue <= CHEAP && (dc.card.producedMana ?? []).length > 0)
      .map((dc) => dc.card.name),
  ]);
  const mdfc = library.map(mdfcLandBack);

  // An MDFC cannot reach this filter at all now -- `nonland` excludes every land, and an MDFC is
  // one. It used to need an explicit `!mdfcNames.has(...)` guard here, because it sat in the spell
  // pool and `producedMana` carries the BACK face's colour, so Silundi Vision looked like cheap
  // ramp and was paid for twice. Counting it as a land removes the guard's reason to exist rather
  // than the guard's effect: a land is not ramp under either convention.
  const rampPlusDraw = nonland.filter(
    (dc) => accelerants.has(dc.card.name) && dc.card.manaValue <= CHEAP
      && !fastNames.has(dc.card.name),
  ).length;

  return {
    avgManaValue,
    rampPlusDraw,
    fastMana: fast.length,
    commanders: Math.max(1, commanders.size),
    mdfcUntapped: mdfc.filter((m) => m === "untapped").length,
    mdfcTapped: mdfc.filter((m) => m === "tapped").length,
  };
}

/** The land target the deck would have after trimming one role back to its target. */
export interface TrimmedTarget {
  /** Cards the role runs over its target. */
  over: number;
  /** The land target once that many of the role's counted pieces are cut. */
  target: number;
}

export interface LandRecommendation extends Required<KarstenInputs> {
  /** Lands the deck runs, counting copies. */
  actual: number;
  /** The dearest commander's mana value, 0 without one: the land formula's commander term. */
  commanderManaValue: number;
  /** Rocks, dorks and land-fetch spells in the library (`classifyAccelerant`), counting copies. */
  accelerants: number;
  /** Cards in the Draw role. */
  drawPieces: number;
  /** What the land formula asks for (`mana-base.ts`'s `landTarget`), rounded and clamped to the
   *  land counts it was simulated at, with ramp and draw counted only up to their role targets. */
  target: number;
  /** WHERE THE TARGET GOES IF A ROLE IS TRIMMED TO ITS OWN TARGET, present only when the role runs
   *  over it and the trim moves the land count. Assumes the cut pieces are the ones the formula
   *  counts (rocks and dorks for Ramp, draw cards for Consistency): a Ramp role over target on
   *  one-shot mana (a Treasure maker, a ritual) can be trimmed without touching the lands. */
  ifTrimmed?: { ramp?: TrimmedTarget; draw?: TrimmedTarget };
}

/** The Ramp and Consistency targets the build reads (`adjustedParentTargets`), passed in by the
 *  caller that has them. */
export interface RoleTargets { ramp?: number; consistency?: number }

/** Target vs actual land count for a deck.
 *
 *  The target is `mana-base.ts`'s `landTarget`: the curve and the commander, less 0.57 of a land
 *  per rock-equivalent of ramp (each piece weighted by how long it keeps producing) and each draw
 *  card's credit by its mana value, both counted ONLY UP TO THEIR ROLE TARGETS (owner,
 *  2026-09-29). The goldfish that measured those rates never loses a rock and always wants more of
 *  both, so ramp and draw past what real decks run are not allowed to talk the deck out of lands.
 *  How many lands is still a different question from which ones, and `manaBaseScore` prices both
 *  in one unit. */
export function recommendedLands(
  deck: readonly DeckCard[],
  opts: { commanderNames?: readonly string[]; roleTargets?: RoleTargets } = {},
): LandRecommendation {
  const inputs = landInputs(deck, opts);
  const commanders = new Set(opts.commanderNames ?? []);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  const commanderManaValue = Math.max(0, ...deck.filter((dc) => commanders.has(dc.card.name)).map((dc) => dc.card.manaValue));
  const accelerants = library.filter((dc) => classifyAccelerant(dc) !== null).length;
  const drawCards = detectBuildCategories([...library]).get("draw") ?? new Set<string>();
  const drawPieces = drawCards.size;

  // THE ROLE COUNTS THE BUILD PANEL SHOWS: a parent's count is the union of its leaves over the
  // whole deck, exactly as `computeBuild` counts it, so "Ramp 16 of 10" here is the panel's 16.
  const members = detectBuildCategories([...deck]);
  const roleMembers = (key: "ramp" | "consistency"): Set<string> => {
    const union = new Set<string>();
    for (const leaf of BUILD_PARENTS.find((p) => p.key === key)!.leaves) for (const n of members.get(leaf) ?? []) union.add(n);
    return union;
  };
  const roleCount = (key: "ramp" | "consistency"): number => roleMembers(key).size;

  // EACH RAMP PIECE AT WHAT IT KEEPS PRODUCING (`RAMP_RESILIENCE`): land ramp whole, a rock 0.7, a
  // dork 0.5, and a one-shot -- a Ramp-role card the goldfish does not play, a ritual or a Treasure
  // maker -- 0.15. Copies count, as `accelerants` always has.
  const rampRoleNames = roleMembers("ramp");
  const rampWeights = library.flatMap((dc): number[] => {
    const a = classifyAccelerant(dc);
    if (a) return [RAMP_RESILIENCE[a.kind]];
    return rampRoleNames.has(dc.card.name) && !isLand(dc) ? [RAMP_RESILIENCE.oneShot] : [];
  }).sort((x, y) => y - x);
  // EACH DRAW CARD AT WHAT ITS MANA VALUE SAVES (`drawCredit`), best first.
  const drawCredits = library.filter((dc) => drawCards.has(dc.card.name)).map((dc) => drawCredit(dc.card.manaValue)).sort((x, y) => y - x);

  // UP TO THE ROLE TARGETS, THE STRONGEST PIECES COUNTED FIRST: a deck past its Ramp target is
  // credited for its best ten pieces, not for whichever ten came first.
  const { ramp: rampTarget, consistency: consistencyTarget } = opts.roleTargets ?? {};
  const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
  const upTo = (xs: readonly number[], cap: number | undefined): number => sum(cap === undefined ? xs : xs.slice(0, cap));
  const at = (ramp: readonly number[], draw: readonly number[]) => landTarget({
    avgManaValue: inputs.avgManaValue, commanderManaValue,
    accelerants: upTo(ramp, rampTarget), drawCredit: upTo(draw, consistencyTarget),
  });
  const target = at(rampWeights, drawCredits);

  // A TRIM CUTS THE WEAKEST PIECES: the one-shots before the rocks, the six-drop draw before the
  // cantrips.
  const trims: NonNullable<LandRecommendation["ifTrimmed"]> = {};
  if (rampTarget !== undefined) {
    const over = roleCount("ramp") - rampTarget;
    const t = over > 0 ? at(rampWeights.slice(0, Math.max(0, rampWeights.length - over)), drawCredits) : target;
    if (t > target) trims.ramp = { over, target: t };
  }
  if (consistencyTarget !== undefined) {
    const over = roleCount("consistency") - consistencyTarget;
    const t = over > 0 ? at(rampWeights, drawCredits.slice(0, Math.max(0, drawCredits.length - over))) : target;
    if (t > target) trims.draw = { over, target: t };
  }
  return {
    ...inputs,
    // MDFCs ARE IN THE LAND COUNT (owner ruling 2026-08-31), the same type-line test `build.ts`
    // uses, so the build row and this one cannot disagree about the count. The goldfish that fitted
    // the target counts them as lands too.
    actual: library.filter(isLand).length,
    commanderManaValue,
    accelerants,
    drawPieces,
    target,
    ...(trims.ramp || trims.draw ? { ifTrimmed: trims } : {}),
  };
}
