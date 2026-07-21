import type { Reason } from "./synergy.js";

export interface ImpactWeights {
  kinds: Record<string, number>;
  repeatability: Record<string, number>;
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
    "player-life-loss": 0.3,
    "top-manipulation": 0.3,
    "speed-increase": 0.3,
    damage: 0.2,
  },
  repeatability: { triggered: 1.0, activated: 0.7, static: 0.6, oneshot: 0.3 },
  damping: 0.5,
};

/**
 * kindWeight[effectKind] × repeatMult[repeatability].
 * Missing/unknown effectKind → UNKNOWN_KIND_WEIGHT; missing/unknown repeatability → neutral 1.0
 * (so a bare flat-engine reason evaluates to its kind weight).
 */
export function impactWeightOf(reason: Reason, w: ImpactWeights): number {
  const k = reason.effectKind !== undefined ? (w.kinds[reason.effectKind] ?? UNKNOWN_KIND_WEIGHT) : UNKNOWN_KIND_WEIGHT;
  const r = reason.repeatability !== undefined ? (w.repeatability[reason.repeatability] ?? 1.0) : 1.0;
  return k * r;
}
