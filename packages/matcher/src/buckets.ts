import type { Reason, ImpactWeights } from "@edh-seer/engine";
import { impactWeightOf } from "@edh-seer/engine";
import type { CardTags, Ability } from "@edh-seer/tagger";
import { millScopeOf } from "./mill-scope.js";

const CARD_BUCKETS = ["consistency", "efficiency", "win-condition"] as const;
export type CardBucket = (typeof CARD_BUCKETS)[number];

// `top-manipulation` split into five kinds on 2026-09-07 and all five inherited CONSISTENCY. Whether
// `mill` and `surveil` belong there -- they fill a graveyard, they do not fix your draws -- was left
// as a question; the owner answered it on 2026-11-17 (#721): NO. scry, search and top-set stay (they
// fix what you draw). Self-mill and surveil are in NO bucket: there is no graveyard bucket, and none
// is invented. A mill of the opponent's library is a win route, so it is WIN_CONDITION; so is a mill
// that can hit either side ("target player", "each player"), which is also a self-mill strategy.
// `mill` and `surveil` are therefore not in the set; `millReachesOpponent` carries the mill half.
// Exported for the EFFECT_KINDS ratchet in `effect-class.test.ts`; nothing else reads them.
export const CONSISTENCY_KINDS = new Set(["draw-card", "graveyard-recursion",
  "scry", "search", "top-set"]);
export const EFFICIENCY_KINDS = new Set(["mana-generation", "fast-mana", "ritual", "cost-reduction", "untap"]);
export const WIN_CONDITION_KINDS = new Set(["damage", "drain", "player-life-loss", "forced-sacrifice"]);

/** A mill that can empty an opponent's library: `opp`, or `any` ("target player", "each player"). */
function millReachesOpponent(a: Ability): boolean {
  const scope = millScopeOf(a);
  return scope === "opp" || scope === "any";
}

function abilityRepeatability(kind: Ability["kind"]): "static" | "activated" | "oneshot" | "triggered" {
  return kind === "static" ? "static" : kind === "activated" ? "activated" : kind === "on-cast" ? "oneshot" : "triggered";
}

/** A repeatable (non-one-shot) counter-placement, or a one-shot placement with non-fixed
 *  scaling, is a voltron engine — a true win condition. A one-shot fixed placement is just
 *  "put a counter on something once," which is too weak on its own to count. */
function isWinConditionCounterPlacement(a: Ability): boolean {
  const repeatability = abilityRepeatability(a.kind);
  const scaling = a.effect.scaling;
  return repeatability !== "oneshot" || (scaling !== undefined && scaling !== "fixed");
}

function abilityWeight(a: Ability, weights: ImpactWeights): number {
  const reason: Reason = {
    tag: a.effect.kind,
    text: "",
    effectKind: a.effect.kind,
    repeatability: abilityRepeatability(a.kind),
    scaling: a.effect.scaling,
  };
  return impactWeightOf(reason, weights);
}

/** Per-card classification into non-synergy "job" buckets, from the card's OWN abilities only
 *  (no deck context). Raw scores — no combo bonus, no versatility multiplier; those need
 *  deck-level context this function doesn't have (see analyzeDeckStructured, Task 2). */
export function computeCardBuckets(
  tags: CardTags,
  weights: ImpactWeights,
): { consistency: number; efficiency: number; "win-condition": number } {
  let consistency = 0;
  let efficiency = 0;
  let winCondition = 0;
  for (const a of tags.abilities) {
    const kind = a.effect.kind;
    if (CONSISTENCY_KINDS.has(kind)) consistency += abilityWeight(a, weights);
    if (EFFICIENCY_KINDS.has(kind)) efficiency += abilityWeight(a, weights);
    if (WIN_CONDITION_KINDS.has(kind)) winCondition += abilityWeight(a, weights);
    if (kind === "mill" && millReachesOpponent(a)) winCondition += abilityWeight(a, weights);
    if (kind === "counter-placement" && isWinConditionCounterPlacement(a)) winCondition += abilityWeight(a, weights);
  }
  return { consistency, efficiency, "win-condition": winCondition };
}
