import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { cardRate, computeRateStats, ratePercentile, type RateStats } from "./rate-stats.js";
import type { DeckCard } from "./types.js";
import rateStats from "../rate-stats.json" with { type: "json" };

const draw = (name: string, manaCost: string, amount: string): DeckCard => ({
  card: { name, typeLine: "Instant", oracleText: "", keywords: [], colors: [], manaValue: 0, manaCost } as unknown as DeckCard["card"],
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["instant"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities: [{ kind: "on-cast", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount, repeats: "once" }] as CardTags["abilities"],
  } as CardTags,
});

/** THE PERCENTILE IS WITHIN THE FAMILY: the best rate reads 1, the worst 0, a card with no rate is
 *  neutral, and the factor is `1 + rateWeight × (p − 0.5)`. */
test("computeRateStats quantiles a family best first; ratePercentile places a span; cardRate multiplies", () => {
  const cards = [draw("Brainstorm-ish", "{U}", "3"), draw("Divination", "{2}{U}", "2"), draw("Tidings", "{3}{U}{U}", "4"), draw("Slow", "{5}{U}", "1")];
  const stats: RateStats = computeRateStats(cards);
  expect(stats.cards).toHaveLength(101);
  expect(stats.cards![0]).toEqual([3, 1, 3, 1]);
  expect(stats.cards![100]).toEqual([1, 6, 1, 6]);
  // Four cards make four plateaus of ~25 quantiles each; a member of a plateau reads its midpoint.
  expect(ratePercentile([9, 1, 9, 1], "cards", stats)).toBe(1);
  expect(ratePercentile([0, 6, 0, 6], "cards", stats)).toBe(0);
  expect(ratePercentile([3, 1, 3, 1], "cards", stats)).toBeGreaterThan(0.85);
  expect(ratePercentile([1, 6, 1, 6], "cards", stats)).toBeLessThan(0.15);
  const mid = ratePercentile([2, 3, 2, 3], "cards", stats)!;
  expect(mid).toBeGreaterThan(0.3); expect(mid).toBeLessThan(0.8);
  expect(ratePercentile([1, 1, 1, 1], "damage", stats)).toBeUndefined();
  const top = cardRate(cards[0]!, 0.5, stats);
  expect(top.best).toMatchObject({ family: "cards", span: [3, 1, 3, 1] });
  expect(top.factor).toBeGreaterThan(1.2);
  expect(cardRate(cards[3]!, 0.5, stats).factor).toBeLessThan(0.8);
  expect(cardRate(cards[0]!, 0, stats).factor).toBe(1);
  const vanilla = { ...cards[0]!, tags: { ...cards[0]!.tags!, abilities: [] } } as DeckCard;
  expect(cardRate(vanilla, 0.5, stats)).toEqual({ factor: 1 });
});

/** THE COMMITTED ARTIFACT IS THE CORPUS'S: every family the rate reads is present with 101
 *  quantiles, best first. A family missing here scores nobody. */
test("rate-stats.json carries every family, 101 quantiles each, best first", () => {
  const stats = rateStats as RateStats;
  for (const f of ["cards", "damage", "mana", "life", "life-loss", "mill", "tokens", "counters", "search", "recursion", "untap", "flicker", "copies"] as const) {
    expect(stats[f], f).toHaveLength(101);
    expect(ratePercentile(stats[f]![0]!, f, stats)).toBeGreaterThan(0.9);
    expect(ratePercentile(stats[f]![100]!, f, stats)).toBeLessThan(0.1);
  }
  expect(ratePercentile([3, 1, 3, 1], "cards", stats)).toBeGreaterThan(0.95); // Brainstorm-class
});
