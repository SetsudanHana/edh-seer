import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { CREATURE_SUBTYPES } from "@edh-seer/tagger/subtypes";
import { cardSignalOf } from "./card-signal.js";
import { detectKindred } from "./archetypes.js";

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

test("an intercepted graveyard fill signals exile-processing, not reanimation (#1083)", () => {
  const tags = {
    ...TAGS,
    abilities: [{ kind: "static", effect: { kind: "graveyard-recursion", intercepted: true, subject: { control: "opp", zone: "graveyard" } } }],
  } as unknown as CardTags;
  const s = cardSignalOf({ name: "Dauthi Voidwalker", oracleText: "" }, tags);
  expect(s.effectKinds).toEqual(["exile-processing"]);
  expect(s.themeTags).not.toContain("static:graveyard-recursion");
});

// #1785: a card that is every creature type WITHOUT the keyword (Mistform Ultimus) is a body of every type, as a changeling is, so it signals `["*"]` and is no body for any one tribe.
test("a card that is every creature type without the keyword signals every type, as a changeling does", () => {
  const every = (keywords: string[]): CardTags => ({ abilities: [], characteristics: { types: ["creature"], subtypes: ["illusion", ...CREATURE_SUBTYPES], keywords } }) as unknown as CardTags;
  expect(cardSignalOf({ name: "Mistform Ultimus", oracleText: "" }, every([])).creatureTypes).toEqual(["*"]);
  expect(cardSignalOf({ name: "Changeling", oracleText: "" }, every(["changeling"])).creatureTypes).toEqual(["*"]);
});

test("Mistform plus a Goblin token maker gives no goblin kindred: an every-type card is not a body for the tribe", () => {
  const mistform = cardSignalOf({ name: "Mistform Ultimus", oracleText: "" }, { abilities: [], characteristics: { types: ["creature"], subtypes: ["illusion", ...CREATURE_SUBTYPES], keywords: [] } } as unknown as CardTags);
  // A Human that makes Goblin tokens: the tokens are no body in the deck, so only Mistform could have made Goblin a candidate.
  const maker = cardSignalOf({ name: "Goblin Rabblemaster", oracleText: "" }, { ...TAGS, characteristics: { ...TAGS.characteristics, subtypes: ["human"] } } as CardTags);
  expect(detectKindred([maker], 2)).toBeUndefined();
  expect(detectKindred([mistform, maker], 2)).toBeUndefined();
});
