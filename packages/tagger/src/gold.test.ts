import { expect, test } from "vitest";
import { loadGold } from "./gold.js";
import { parseAbilities } from "./validate.js";
import { SCHEMA_VERSION } from "./schema.js";

test("every gold file has an oracleId, a card, and schema-valid expected abilities", () => {
  const gold = loadGold();
  expect(gold.length).toBeGreaterThanOrEqual(30);
  for (const g of gold) {
    expect(g.oracleId).toBeTruthy();
    expect(g.card.oracleText).toBeDefined();
    expect(g.expected.schemaVersion).toBe(SCHEMA_VERSION);
    // expected abilities must survive the same validator the LLM output goes through
    expect(() =>
      parseAbilities(JSON.stringify({ abilities: g.expected.abilities })),
    ).not.toThrow();
  }
});
