import { expect, test } from "vitest";
import fixtures from "./quality.fixtures.json" with { type: "json" };
import { qualityTable } from "./quality-percentiles.js";
import type { DeckCard } from "./types.js";

const cards = Object.values(fixtures) as unknown as DeckCard[];

test("percentiles are within a role, 0-100, and Swords outranks Crib Swap as removal", () => {
  const t = qualityTable(cards);
  const swords = t.get("Swords to Plowshares")!.get("targetedRemoval")!;
  const crib = t.get("Crib Swap")!.get("targetedRemoval")!;
  expect(swords).toBeGreaterThan(crib);
  for (const roles of t.values()) for (const p of roles.values()) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(100); }
});

test("a card is scored only in the roles it fills", () => {
  const t = qualityTable(cards);
  expect(t.get("Counterspell")?.has("ramp") ?? false).toBe(false);
  expect(t.get("Counterspell")?.has("stackInteraction")).toBe(true);
});
