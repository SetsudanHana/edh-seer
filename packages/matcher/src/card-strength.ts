/** A CARD'S SYNERGY STRENGTH IN A DECK, by the report's own per-card formula (`analyze.ts`), so a
 *  swap and the report cannot disagree about which card does more for the deck. Swaps used to
 *  compare distinct-partner counts (owner, 2026-10-01: "we are only taking into account the amount
 *  of links not their magnitude"), so a cut with thirteen off-theme links outranked an add with nine
 *  links on the deck's theme.
 *
 *  THE WEIGHT IS THE REPORT'S, NOTHING NEW. Under the shipped `strategy` edge model (ruling
 *  2026-09-10: "edge weight is the deck's strategy, and nothing else") a link weighs its distinct
 *  reason tags times the deck's axis boost, times `COMMANDER_BOOST` when the other card is the
 *  commander. A card's strength is the square root of what it is fed plus `roleBlend` times the
 *  square root of a quarter of what it feeds. Edge magnitude (firings per use) is not in it: it is
 *  display data until a measured weighting is chosen (step 2). */
import { COMMANDER_BOOST, impactEdgeWeight, type ImpactWeights, type Reason } from "@edh-seer/engine";
import { axisFactor, maxAxisWeight } from "./axis.js";

/** A fully on-axis edge counts 2.5 times an off-axis one. Tunable. */
export const AXIS_BOOST = 1.5;
/** The least axis weight at which an edge counts as on the deck's theme. Calibrated. */
export const AXIS_ON_THRESHOLD = 0.25;
/** A feeder gets this share of a payoff edge's weight, square-root damped. Tunable. */
export const FEEDER_SHARE = 0.25;

/** One edge's weight: its reasons' impact (one per distinct tag under `strategy`) times the deck's
 *  axis boost. `tagMultiplier` is the supply:demand discount's hook (`magnitude.ts`), inert today. */
export function edgeWeight(reasons: Reason[], w: ImpactWeights, axis: Map<string, number>, tagMultiplier?: (tag: string) => number): number {
  return impactEdgeWeight(reasons, w, tagMultiplier) * axisFactor(reasons, axis, AXIS_BOOST);
}

/** A card's reasons with one other card of the deck: what it supplies that card, what that card
 *  supplies it, and whether that card is the commander. */
export interface CardLink { feeds: Reason[]; fedBy: Reason[]; commander: boolean }

export interface Strength {
  /** The report's per-card score before the rate factor: √support + roleBlend · √feederSum. */
  strength: number;
  /** Deck cards it has a reason with. */
  partners: number;
  /** Of those, the ones whose strongest reason is on the deck's theme (`AXIS_ON_THRESHOLD`). */
  onTheme: number;
  /** One of them is the commander, whose links count `COMMANDER_BOOST` times. */
  commander: boolean;
}

export function cardStrength(links: readonly CardLink[], w: ImpactWeights, axis: Map<string, number>): Strength {
  let support = 0;
  let feederSum = 0;
  let partners = 0;
  let onTheme = 0;
  let commander = false;
  for (const l of links) {
    if (l.feeds.length === 0 && l.fedBy.length === 0) continue;
    partners++;
    if (l.commander) commander = true;
    const boost = l.commander ? COMMANDER_BOOST : 1;
    if (l.fedBy.length > 0) support += edgeWeight(l.fedBy, w, axis) * boost;
    if (l.feeds.length > 0) feederSum += FEEDER_SHARE * edgeWeight(l.feeds, w, axis) * boost;
    if (maxAxisWeight([...l.feeds, ...l.fedBy], axis) >= AXIS_ON_THRESHOLD) onTheme++;
  }
  return { strength: Math.sqrt(support) + (w.roleBlend ?? 1) * Math.sqrt(feederSum), partners, onTheme, commander };
}
