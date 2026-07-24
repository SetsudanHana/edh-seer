import { expect, test } from "vitest";
import { buildDeckCards, type CardTagsLookup } from "./deck-cards.js";
import type { CardLookup } from "@mtg/data";
import type { CardDoc } from "@mtg/data";
import type { Card } from "@mtg/engine";

const fakeLookup: CardLookup = {
  findByName: async (n: string) =>
    n === "sol ring" ? ({ _id: "sr-1", name: "Sol Ring" } as CardDoc) : null,
  allCombos: async () => [],
};

const fakeTags: CardTagsLookup = {
  findOne: async (id: string) =>
    id === "sr-1" ? ({ oracleId: "sr-1", abilities: [] } as never) : null,
};

test("pairs a resolved card with its tags by oracleId", async () => {
  const cards: Card[] = [{ name: "Sol Ring", typeLine: "Artifact", oracleText: "", keywords: [], colors: [], manaValue: 1 }];
  const out = await buildDeckCards(cards, fakeLookup, fakeTags);
  expect(out).toEqual([{ card: cards[0], tags: { oracleId: "sr-1", abilities: [] } }]);
});

test("card missing from lookup gets null tags", async () => {
  const cards: Card[] = [{ name: "Unknown Card", typeLine: "Artifact", oracleText: "", keywords: [], colors: [], manaValue: 1 }];
  const out = await buildDeckCards(cards, fakeLookup, fakeTags);
  expect(out).toEqual([{ card: cards[0], tags: null }]);
});
