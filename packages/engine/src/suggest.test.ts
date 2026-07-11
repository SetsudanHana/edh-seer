import { expect, test } from "vitest";
import { suggestCards } from "./suggest.js";
import { FIXTURES } from "./fixtures.js";

test("suggests a token payoff for a token-heavy deck", () => {
  const deck = [FIXTURES.krenko, FIXTURES.dockside];
  const pool = [FIXTURES.impactTremors, FIXTURES.swordsToPlowshares, FIXTURES.divination];
  const suggestions = suggestCards(deck, pool);
  expect(suggestions[0].name).toBe("Impact Tremors");
  expect(suggestions[0].score).toBeGreaterThan(0);
  expect(suggestions[0].reasons.length).toBeGreaterThan(0);
});

test("excludes cards already in the deck", () => {
  const deck = [FIXTURES.krenko, FIXTURES.impactTremors];
  const pool = [FIXTURES.impactTremors, FIXTURES.dockside];
  const names = suggestCards(deck, pool).map((s) => s.name);
  expect(names).not.toContain("Impact Tremors");
});

test("respects topN", () => {
  const deck = [FIXTURES.krenko];
  const pool = [FIXTURES.impactTremors, FIXTURES.dockside, FIXTURES.fireweaver];
  expect(suggestCards(deck, pool, undefined, 1)).toHaveLength(1);
});
