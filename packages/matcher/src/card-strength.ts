/** A CARD'S SYNERGY STRENGTH IN A DECK, for swaps, and the edge weight the report shares with them.
 *
 *  `edgeWeight` is the report's (`analyze.ts`): under the shipped `strategy` edge model (ruling
 *  2026-09-10) a link weighs its distinct reason tags times the deck's axis boost. `cardStrength`
 *  starts from it and adds what the report does not yet weigh: each link's effect value and
 *  diminishing returns per trigger (owner, 2026-10-02). Swaps used to count partners (2026-10-01),
 *  then to weigh every link alike, so a card that triggers on everything for 1 life won every swap.
 *  Edge magnitude (firings per use) is still display data (#905, parked). */
import { COMMANDER_BOOST, impactEdgeWeight, impactWeightOf, type ImpactWeights, type Reason } from "@edh-seer/engine";
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
  /** What the card does for the deck, as a swap weighs it (`cardStrength`). */
  strength: number;
  /** Deck cards it has a reason with. */
  partners: number;
  /** Of those, the ones whose strongest reason is on the deck's theme (`AXIS_ON_THRESHOLD`). */
  onTheme: number;
  /** One of them is the commander, whose links count `COMMANDER_BOOST` times. */
  commander: boolean;
}

/** A SWAP'S STRENGTH: the report's weights, plus what each link is worth and diminishing returns per
 *  trigger (owner, 2026-10-02: "it is not an issue that you have a card that 'synergizes' with
 *  everything, but typically their impact is very small"). Swaps first; the report's own rating
 *  follows once these read right.
 *
 *  - WHAT A LINK IS WORTH: the payoff's effect value, the calibrated prior the `strategy` edge model
 *    set aside (`impactWeightOf` under `priors`: kind x repeatability x scaling). Gaining 1 life or
 *    pinging for 1 counts 0.2-0.3 of drawing a card or making tokens.
 *  - TIMES the deck's theme boost and the commander boost, as the report weighs a link.
 *  - DIMINISHING RETURNS PER TRIGGER: links through one reason tag add up under a square root, links
 *    through different tags add in full. Thirteen creatures entering into one "whenever a creature
 *    enters" trigger are one synergy grown thirteen times, not thirteen synergies.
 *  - What a card feeds counts a `FEEDER_SHARE` of what it is fed, as in the report. */
export function cardStrength(links: readonly CardLink[], w: ImpactWeights, axis: Map<string, number>): Strength {
  const priors: ImpactWeights = { ...w, edgeModel: "priors" };
  const fed = new Map<string, number>();
  const fedTo = new Map<string, number>();
  let partners = 0;
  let onTheme = 0;
  let commander = false;
  /** One link's reasons into per-tag totals: its best reason per tag, so a link counts once a tag. */
  const add = (into: Map<string, number>, reasons: readonly Reason[], boost: number) => {
    const best = new Map<string, number>();
    for (const r of reasons) {
      const v = impactWeightOf(r, priors) * axisFactor([r], axis, AXIS_BOOST) * boost;
      if (v > (best.get(r.tag) ?? 0)) best.set(r.tag, v);
    }
    for (const [tag, v] of best) into.set(tag, (into.get(tag) ?? 0) + v);
  };
  for (const l of links) {
    if (l.feeds.length === 0 && l.fedBy.length === 0) continue;
    partners++;
    if (l.commander) commander = true;
    const boost = l.commander ? COMMANDER_BOOST : 1;
    add(fed, l.fedBy, boost);
    add(fedTo, l.feeds, boost);
    if (maxAxisWeight([...l.feeds, ...l.fedBy], axis) >= AXIS_ON_THRESHOLD) onTheme++;
  }
  const perTrigger = (m: Map<string, number>, share = 1) => [...m.values()].reduce((s, v) => s + Math.sqrt(share * v), 0);
  return { strength: perTrigger(fed) + (w.roleBlend ?? 1) * perTrigger(fedTo, FEEDER_SHARE), partners, onTheme, commander };
}
