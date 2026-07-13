import { expect, test } from "vitest";
import { extractTags } from "./tags.js";
import type { Card } from "./card.js";
import { FIXTURES } from "./fixtures.js";

function make(typeLine: string, oracleText: string, keywords: string[] = []): Card {
  return { name: "X", typeLine, oracleText, keywords, colors: [], manaValue: 0 };
}

test("a creature produces tribe tags for each of its subtypes", () => {
  const p = extractTags(make("Legendary Creature — Goblin Warrior", "Tap: create tokens."));
  expect(p.produces.has("tribe:goblin")).toBe(true);
  expect(p.produces.has("tribe:warrior")).toBe(true);
});

test("a tribal payoff cares about the referenced tribe", () => {
  const p = extractTags(make("Creature — Goblin", "Other Goblins you control get +1/+1."));
  expect(p.cares.has("tribe:goblin")).toBe(true);
});

test("a non-tribal 'X you control' phrase is not tagged as a tribe", () => {
  const p = extractTags(make("Artifact", "Artifacts you control get +1/+0."));
  expect([...p.cares].some((t) => t.startsWith("tribe:"))).toBe(false);
});

test("instants and sorceries produce cast tags; magecraft cares about them", () => {
  const bolt = extractTags(make("Instant", "Deal 3 damage to any target."));
  expect(bolt.produces.has("cast:instant")).toBe(true);
  const mage = extractTags(make("Creature — Human Wizard", "Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card."));
  expect(mage.cares.has("cast:instant")).toBe(true);
  expect(mage.cares.has("cast:sorcery")).toBe(true);
});

test("Krenko produces tokens (and creature-etb)", () => {
  const t = extractTags(FIXTURES.krenko);
  expect(t.produces.has("token")).toBe(true);
  expect(t.produces.has("creature-etb")).toBe(true);
});

test("Impact Tremors cares about creature-etb", () => {
  const t = extractTags(FIXTURES.impactTremors);
  expect(t.cares.has("creature-etb")).toBe(true);
});

test("Ashnod's Altar is a sacrifice outlet: produces sacrifice-event and mana, cares about fodder", () => {
  const t = extractTags(FIXTURES.ashnods);
  expect(t.produces.has("sacrifice-event")).toBe(true);
  expect(t.produces.has("mana")).toBe(true);
  expect(t.cares.has("sacrifice-fodder")).toBe(true);
});

test("Blood Artist cares about creature-death", () => {
  const t = extractTags(FIXTURES.bloodArtist);
  expect(t.cares.has("creature-death")).toBe(true);
});

test("Cultivate is ramp and produces land-etb + mana", () => {
  const t = extractTags(FIXTURES.cultivate);
  expect(t.produces.has("ramp")).toBe(true);
  expect(t.produces.has("land-etb")).toBe(true);
});

test("Lotus Cobra cares about land-etb (landfall)", () => {
  const t = extractTags(FIXTURES.lotusCobra);
  expect(t.cares.has("land-etb")).toBe(true);
});

test("Swords to Plowshares is removal", () => {
  const t = extractTags(FIXTURES.swordsToPlowshares);
  expect(t.produces.has("removal")).toBe(true);
});

test("Divination is card-draw", () => {
  const t = extractTags(FIXTURES.divination);
  expect(t.produces.has("card-draw")).toBe(true);
});

test("tribal payoff resolves irregular plurals (Elves, Wolves)", () => {
  const elves = extractTags(make("Creature — Elf", "Other Elves you control get +1/+1."));
  expect(elves.cares.has("tribe:elf")).toBe(true);
  const wolves = extractTags(make("Enchantment", "Wolves you control get +1/+1."));
  expect(wolves.cares.has("tribe:wolf")).toBe(true);
});
