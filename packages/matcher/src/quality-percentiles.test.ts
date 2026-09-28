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

// THE STAPLES SNAPSHOT (owner, 2026-09-27): EDHTop16 play rate is quality for the cards it covers.
const oracle = (name: string) => (cards.find((c) => c.card.name === name)!.tags as { oracleId: string }).oracleId;

test("a staple outranks every non-staple in its role, whatever the ingredients say", () => {
  const staples = { fetchedAt: "t", source: "s", cards: { [oracle("Crib Swap")]: 0.5 } };
  const t = qualityTable(cards, staples);
  expect(t.get("Crib Swap")!.get("targetedRemoval")!).toBeGreaterThan(t.get("Swords to Plowshares")!.get("targetedRemoval")!);
});

test("among staples, play rate orders the role, even against the ingredients", () => {
  // the ingredients put Path above Crib Swap; a higher play rate must win
  const staples = { fetchedAt: "t", source: "s", cards: { [oracle("Crib Swap")]: 0.8, [oracle("Path to Exile")]: 0.2 } };
  const t = qualityTable(cards, staples);
  expect(t.get("Crib Swap")!.get("targetedRemoval")!).toBeGreaterThan(t.get("Path to Exile")!.get("targetedRemoval")!);
});

test("a staple outranks the frequency ladder too: its scores run into the millions (#691)", () => {
  // Mind Stone is a per-cycle mana ability, so the ramp ladder scores it above 1e6; the once-only
  // Wayfarer's Bauble must still sit above it once it is a staple.
  const staples = { fetchedAt: "t", source: "s", cards: { [oracle("Wayfarer's Bauble")]: 0.01 } };
  const t = qualityTable(cards, staples);
  expect(t.get("Wayfarer's Bauble")!.get("ramp")!).toBeGreaterThan(t.get("Mind Stone")!.get("ramp")!);
});
