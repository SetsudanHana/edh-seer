import { expect, test } from "vitest";
import { deriveCardTags, extractCharacteristics } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";

/** CR 903.5b (owner, 2026-10-01): in a Commander deck every nontoken card but basics and the
 *  any-number family is singleton, so Guardian Project's "if it doesn't have the same name as another
 *  creature you control or a creature card in your graveyard" holds for any such creature entering. */
function card(name: string, typeLine: string, oracleText: string, clauses: ClauseRecord[]): DeckCard {
  const characteristics = extractCharacteristics({ name, typeLine, oracleText, colors: [], colorIdentity: [], manaValue: 2, power: "2", toughness: "2", keywords: [] } as never);
  const texts = Object.fromEntries(oracleText.split("\n").map((t, i) => [i + 1, t]));
  const tags = deriveCardTags({ oracleId: name, name, clauses, clauseTexts: texts, characteristics }) as CardTags;
  return { card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 2 } as unknown as DeckCard["card"], tags };
}

const H = loadHierarchy();
const guardian = card("Guardian Project", "Enchantment",
  "Whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card.",
  [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "a nontoken creature you control", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1" }] }]);
const bears = card("Grizzly Bears", "Creature — Bear", "", []);
const rats = card("Relentless Rats", "Creature — Rat",
  "This creature gets +1/+1 for each other creature on the battlefield named Relentless Rats.\nA deck can have any number of cards named Relentless Rats.", []);

const tags = (a: DeckCard, b: DeckCard) => pairReasons(a, b, H).map((r) => r.tag);

test("a singleton creature entering feeds Guardian Project", () => {
  expect(tags(bears, guardian).some((t) => t.startsWith("enters:"))).toBe(true);
});

test("a card a deck may hold several of does not", () => {
  expect(rats.tags?.characteristics.anyNumber).toBe(true);
  expect(tags(rats, guardian).some((t) => t.startsWith("enters:"))).toBe(false);
});
