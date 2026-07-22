import { expect, test } from "vitest";
import { loadGold } from "./gold.js";
import { parseAbilities } from "./validate.js";
import { SCHEMA_VERSION, SCALING_BASES } from "./schema.js";
import { EFFECT_KINDS, PROMPT_VERSION } from "./llm/prompt.js";

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

test("every gold effect.kind is in the prompt's recognized label set (no drift)", () => {
  const allowed = new Set<string>(EFFECT_KINDS);
  for (const g of loadGold()) {
    for (const a of g.expected.abilities) {
      expect(allowed, `effect.kind "${a.effect.kind}" (${g.card.name}) not in EFFECT_KINDS`).toContain(
        a.effect.kind,
      );
    }
  }
});

test("PROMPT_VERSION is 20 (on-cast ability-kind added)", () => {
  expect(PROMPT_VERSION).toBe(20);
});

test("every gold effect.scaling is in SCALING_BASES (no drift)", () => {
  const allowed = new Set<string>(SCALING_BASES);
  for (const g of loadGold()) {
    for (const a of g.expected.abilities) {
      const s = a.effect.scaling ?? "fixed"; // absent = fixed
      expect(allowed, `effect.scaling "${s}" (${g.card.name}) not in SCALING_BASES`).toContain(s);
    }
  }
});
