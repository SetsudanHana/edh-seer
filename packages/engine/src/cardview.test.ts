import { expect, test } from "vitest";
import type { Card } from "./card.js";
import { toCardView, hasKeyword, has, hasClause, matchWord } from "./cardview.js";

function card(typeLine: string, oracleText: string, keywords: string[] = []): Card {
  return { name: "X", typeLine, oracleText, keywords, colors: [], manaValue: 0 };
}

test("toCardView parses types and subtypes from the type line", () => {
  const v = toCardView(card("Legendary Creature — Goblin Warrior", ""));
  expect(v.types.has("creature")).toBe(true);
  expect(v.types.has("legendary")).toBe(true);
  expect(v.subtypes.has("goblin")).toBe(true);
  expect(v.subtypes.has("warrior")).toBe(true);
});

test("toCardView handles a type line with no subtypes", () => {
  const v = toCardView(card("Enchantment", "text"));
  expect(v.types.has("enchantment")).toBe(true);
  expect(v.subtypes.size).toBe(0);
});

test("hasKeyword is case-insensitive over card keywords", () => {
  const v = toCardView(card("Creature — Cat", "", ["Flying", "Lifelink"]));
  expect(hasKeyword(v, "flying")).toBe(true);
  expect(hasKeyword(v, "trample")).toBe(false);
});

test("has is a plain substring test", () => {
  const v = toCardView(card("Instant", "Draw two cards."));
  expect(has(v, "draw two cards")).toBe(true);
});

test("hasClause ignores matches inside a negated clause", () => {
  const yes = toCardView(card("Artifact", "Sacrifice a creature: add {C}."));
  const no = toCardView(card("Creature — Angel", "Creatures you control can't be sacrificed."));
  expect(hasClause(yes, "sacrifice a creature")).toBe(true);
  expect(hasClause(no, "sacrificed", "sacrifice")).toBe(false);
});

test("matchWord applies a word-boundary regex over lowercased oracle", () => {
  const v = toCardView(card("Instant", "Add one mana of any color."));
  expect(matchWord(v, /\badd\b.*\bmana\b/)).toBe(true);
});
