import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { cardSignalOf } from "./card-signal.js";

/** THE SIGNAL THE REPORT'S DETECTOR READS, built once for a card (spec 2026-09-08 part 4). It lived
 *  inline in `analyze.ts`; the facet index needs the same construction for every corpus card, and
 *  two copies would be two definitions of what a card "signals". */
const TAGS = {
  abilities: [{
    kind: "activated",
    effect: { kind: "token-generation", subject: { type: "creature", subtype: "goblin" } },
    emits: [{ verb: "create-token", subject: { type: "creature", subtype: "goblin", token: true } }],
  }],
  characteristics: { types: ["creature"], subtypes: ["goblin", "warrior"], keywords: [] },
} as unknown as CardTags;

test("a token maker signals its effect kind, its token kind and its creature types", () => {
  const s = cardSignalOf({ name: "Krenko, Mob Boss", oracleText: "{T}: Create X 1/1 red Goblin creature tokens." }, TAGS);
  expect(s.name).toBe("Krenko, Mob Boss");
  expect(s.effectKinds).toEqual(["token-generation"]);
  expect(s.tokenKinds).toEqual(["creature"]);
  expect(s.cardTypes).toEqual(["creature"]);
  expect(s.creatureTypes).toEqual(["goblin", "warrior"]);
  expect(s.lineWords).toEqual(["creature", "goblin", "warrior"]);
  expect(s.subtypes).toEqual([]);
  expect(Array.isArray(s.themeTags)).toBe(true);
  expect(Array.isArray(s.caresTags)).toBe(true);
});

test("an aura counts as a voltron subtype only when it enchants a creature", () => {
  const aura = {
    ...TAGS, abilities: [], characteristics: { types: ["enchantment"], subtypes: ["aura"], keywords: [] },
  } as unknown as CardTags;
  expect(cardSignalOf({ name: "A", oracleText: "Enchant creature" }, aura).subtypes).toEqual(["aura"]);
  expect(cardSignalOf({ name: "B", oracleText: "Enchant land" }, aura).subtypes).toEqual([]);
});
