import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";

/** #1678 round 2: two tokens that are copies of "that creature", with an exception (Uugguu, the Omniplasm), copy the dying creature's class (an Ooze), as the singular form always did.
 *  Real oracle text (Mongo `cards`, 2026-11-18), derived from the grammar's own records. */
const H = loadHierarchy();
function fromText(name: string, typeLine: string, oracleText: string): DeckCard {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  expect(g.complete, name).toBe(true);
  const tags = deriveCardTags(deriveInputOf(card as never, name, name, g.records, undefined, g.readings)) as CardTags;
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags };
}
const uugguu = fromText("Uugguu, the Omniplasm", "Legendary Creature — Ooze", "Whenever another nontoken Ooze creature you control dies, create two tokens that are copies of that creature, except they're 2/2 and they aren't legendary.");
const scientists = fromText("A.I.M. Scientists", "Creature — Human Scientist Villain", "When this creature enters, it connives. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on this creature.)");
const jelly = fromText("Ooze Self Enters", "Creature — Ooze", "When this creature enters, draw a card.");

test("a copy of an Ooze that died feeds an Ooze's own enters trigger, never a Human's", () => {
  expect(pairReasons(uugguu, scientists, H).some((r) => r.tag.startsWith("enters:"))).toBe(false);
  expect(pairReasons(uugguu, jelly, H).some((r) => r.tag.startsWith("enters:"))).toBe(true);
});
