import rateStats from "../rate-stats.json" with { type: "json" };
import { bestPerFamily, compareRates, ratesOf, spanOf, type Rate, type RateFamily, type RateSpan } from "./rate.js";
import type { DeckCard } from "./types.js";

/** WHERE A RATE SITS WITHIN ITS FAMILY (roadmap Y9). A percentile is unitless, which is the only
 *  bridge across families this repo allows: cards per mana and damage per mana never meet, but
 *  "top 5% of draw rates" and "bottom half of damage rates" can multiply a card's score alike.
 *  The stats are QUANTILES of the corpus's best rate per card per family, best first, committed
 *  as `rate-stats.json` by `bin/gen-rate-stats.ts` and imported so the analysis path bundles. */

export type RateStats = Partial<Record<RateFamily, RateSpan[]>>;
export const QUANTILES = 100;

/** The quantile spans per family: index 0 the best rate in the corpus, index 100 the worst. */
export function computeRateStats(cards: DeckCard[]): RateStats {
  const byFamily = new Map<RateFamily, RateSpan[]>();
  for (const d of cards) for (const r of bestPerFamily(ratesOf(d))) {
    const list = byFamily.get(r.family) ?? [];
    list.push(spanOf(r));
    byFamily.set(r.family, list);
  }
  const out: RateStats = {};
  for (const [family, spans] of byFamily) {
    spans.sort(compareRates);
    const q: RateSpan[] = [];
    for (let i = 0; i <= QUANTILES; i++) q.push(spans[Math.min(spans.length - 1, Math.round((i / QUANTILES) * (spans.length - 1)))]!);
    out[family] = q;
  }
  return out;
}

/** 1 for a rate above the whole family, 0 for one below it: the share of the corpus this rate
 *  beats, a tie counted half (the midpoint of the tied run, so a plateau of identical spans --
 *  every floor-0 trigger -- reads the same wherever in it a card lands). `undefined` for a family
 *  the stats do not carry. */
export function ratePercentile(span: RateSpan, family: RateFamily, stats: RateStats = rateStats as RateStats): number | undefined {
  const q = stats[family];
  if (!q || q.length === 0) return undefined;
  let better = 0, notWorse = 0;
  for (const s of q) { const c = compareRates(s, span); if (c < 0) better++; if (c <= 0) notWorse++; }
  return 1 - (better + notWorse) / 2 / q.length;
}

export interface CardRate { family: RateFamily; span: RateSpan; size?: string; percentile: number }

/** THE CARD'S BEST RATE ACROSS ITS FAMILIES, by percentile, and the factor its score takes:
 *  `1 + rateWeight × (percentile − 0.5)`. A card with no rate is neutral, 1. */
export function cardRate(d: DeckCard, rateWeight: number, stats: RateStats = rateStats as RateStats): { factor: number; best?: CardRate } {
  let best: CardRate | undefined;
  for (const r of bestPerFamily(ratesOf(d))) {
    const p = ratePercentile(spanOf(r), r.family, stats);
    if (p === undefined) continue;
    if (best === undefined || p > best.percentile) best = { family: r.family, span: spanOf(r), ...(r.size ? { size: r.size } : {}), percentile: p };
  }
  return { factor: best === undefined ? 1 : 1 + rateWeight * (best.percentile - 0.5), ...(best ? { best } : {}) };
}

export type { Rate };
