import { expect, test } from "vitest";
import { buildAbilityPrompt, PROMPT_VERSION } from "./prompt.js";

const card = {
  name: "Impact Tremors",
  typeLine: "Enchantment",
  oracleText: "Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent.",
  keywords: [],
  colors: ["R"],
  manaValue: 2,
};

test("prompt version is 4", () => {
  expect(PROMPT_VERSION).toBe(4);
});

test("prompt includes the oracle text, the closed verb list, and the abilities key", () => {
  const p = buildAbilityPrompt(card);
  expect(p).toContain(card.oracleText);
  expect(p).toContain("create-token");
  expect(p).toContain("enters");
  expect(p).toContain('"abilities"');
});

test("prompt includes the emits invariant and a few-shot example", () => {
  const p = buildAbilityPrompt(card);
  expect(p.toLowerCase()).toContain("cast");
  expect(p).toContain("Inalla"); // few-shot anchor
});

test("prompt includes the closed effect.kind label set", () => {
  const p = buildAbilityPrompt(card);
  expect(p).toContain("player-life-loss");
});
