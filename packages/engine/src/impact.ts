import { readFileSync } from "node:fs";
import type { Reason } from "./synergy.js";

export interface ImpactWeights {
  kinds: Record<string, number>;
  repeatability: Record<string, number>;
  scaling: Record<string, number>;
  damping: number;
}

/** Weight when a reason's effectKind is missing or absent from the config: unknown synergy ≈ low impact. */
export const UNKNOWN_KIND_WEIGHT = 0.2;

/**
 * Hand-seeded priors — one entry per tagger EFFECT_KIND. These are the fallback when
 * impact-weights.json is absent AND the regularization target during calibration.
 * Calibration overwrites impact-weights.json; it does not touch these constants.
 */
export const SEED_IMPACT_WEIGHTS: ImpactWeights = {
  kinds: {
    "draw-card": 1.0,
    "token-generation": 1.0,
    "token-doubling": 1.0,
    "trigger-doubling": 1.0,
    drain: 0.9,
    // Re-triggers every attack trigger and doubles a turn's combat damage — a surplus producer
    // of attack events, the same shape as the 1.0 doublers above, but it costs a whole card and
    // is usually once per turn, so 0.9 rather than 1.0.
    "extra-combat": 0.9,
    "graveyard-recursion": 0.8,
    flicker: 0.8,
    "copy-spell": 0.8,
    clone: 0.7,
    "cost-reduction": 0.6,
    "damage-multiplier": 0.6,
    "forced-sacrifice": 0.6,
    pump: 0.5,
    "counter-placement": 0.5,
    "fast-mana": 0.5,
    "mana-generation": 0.4,
    tax: 0.4,
    ritual: 0.4,
    "enters-with-counters": 0.4,
    animate: 0.4,
    untap: 0.4,
    proliferate: 0.4,
    "player-life-loss": 0.3,
    lifegain: 0.3,
    // Denies an opponent's resources rather than advancing your own board — low-impact
    // interaction, same band as player-life-loss/lifegain. NOT graveyard-recursion (0.8) despite
    // the similar name: these two kinds are opposites (deny vs. reuse a graveyard).
    "graveyard-hate": 0.3,
    "top-manipulation": 0.3,
    "speed-increase": 0.3,
    // A keyword handed to a class of permanents you already control. Only ever typal (a grant to
    // "creatures you control" reaches every creature and forms no edge at all), so when it does
    // count it is a real payoff for a tribe -- but it grants an ability rather than making a
    // resource, so it sits with the other low-band modifiers rather than with the doublers.
    "keyword-grant": 0.3,
    // Granting TYPES turns on every typal payoff in the deck at once (Maskwood Nexus), which is a
    // bigger deal than handing out a keyword - but it is still an enabler, not a payoff.
    "type-grant": 0.45,
    damage: 0.2,
  },
  repeatability: { triggered: 1.0, activated: 0.7, static: 0.6, oneshot: 0.3 },
  scaling: {
    fixed: 1.0,
    "per-creature": 1.5,
    "per-permanent": 1.5,
    "per-graveyard": 1.5,
    "per-cast-or-spell": 1.5,
    "x-cost": 1.5,
    "per-opponent": 1.2,
    unbounded: 2.5,
  },
  damping: 0.5,
};

/**
 * kindWeight[effectKind] × repeatMult[repeatability] × scaleMult[scaling].
 * Missing/unknown effectKind → UNKNOWN_KIND_WEIGHT; missing/unknown repeatability → neutral 1.0
 * (so a bare flat-engine reason evaluates to its kind weight); missing/unknown scaling → the
 * "fixed" multiplier (1.0).
 */
export function impactWeightOf(reason: Reason, w: ImpactWeights): number {
  const k = reason.effectKind !== undefined ? (w.kinds[reason.effectKind] ?? UNKNOWN_KIND_WEIGHT) : UNKNOWN_KIND_WEIGHT;
  const r = reason.repeatability !== undefined ? (w.repeatability[reason.repeatability] ?? 1.0) : 1.0;
  const fixedMult = w.scaling?.fixed ?? 1.0;
  const s = reason.scaling !== undefined ? (w.scaling?.[reason.scaling] ?? fixedMult) : fixedMult;
  return k * r * s;
}

/** Read the committed impact-weights.json; fall back to seed defaults if unreadable/absent. */
export function loadImpactWeights(): ImpactWeights {
  try {
    return JSON.parse(readFileSync(new URL("./impact-weights.json", import.meta.url), "utf8")) as ImpactWeights;
  } catch {
    return SEED_IMPACT_WEIGHTS;
  }
}

/** Sum impact over DISTINCT reason tags, keeping the MAX-impact reason per tag: when a mutual
 *  edge carries two reasons sharing one tag but differing in effectKind, the higher-impact kind
 *  wins (order-independent — avoids silently keeping a lower-impact effectKind). */
export function impactEdgeWeight(reasons: Reason[], w: ImpactWeights): number {
  const best = new Map<string, number>();
  for (const r of reasons) {
    const v = impactWeightOf(r, w);
    const prev = best.get(r.tag);
    if (prev === undefined || v > prev) best.set(r.tag, v);
  }
  let sum = 0;
  for (const v of best.values()) sum += v;
  return sum;
}

/** Impact analogue of dampedScore with a calibrated exponent: total / partnerCount^alpha. */
export function dampByAlpha(total: number, partnerCount: number, alpha: number): number {
  return partnerCount > 0 ? total / Math.pow(partnerCount, alpha) : 0;
}
