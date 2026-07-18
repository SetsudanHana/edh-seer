import { expect, test } from "vitest";
import { resolveNames, type CardLookup } from "./resolve.js";
import type { CardDoc, ComboDoc } from "./docs.js";

function doc(name: string, search: string[]): CardDoc {
  return {
    _id: name,
    name,
    typeLine: "Creature",
    oracleText: "",
    keywords: [],
    colors: [],
    manaValue: 1,
    colorIdentity: [],
    power: null,
    toughness: null,
    tags: { produces: [], cares: [] },
    searchNames: search,
  };
}

function fakeLookup(cards: CardDoc[], combos: ComboDoc[]): CardLookup {
  return {
    async findByName(normalized) {
      return cards.find((c) => c.searchNames.includes(normalized)) ?? null;
    },
    async allCombos() {
      return combos;
    },
  };
}

test("resolves known names to cards and reports missing ones", async () => {
  const lookup = fakeLookup(
    [doc("Sol Ring", ["sol ring"]), doc("Thassa's Oracle", ["thassas oracle"])],
    [],
  );
  const result = await resolveNames(["Sol Ring", "thassas oracle", "Not A Card"], lookup);
  expect(result.cards.map((c) => c.name)).toEqual(["Sol Ring", "Thassa's Oracle"]);
  expect(result.missing).toEqual(["Not A Card"]);
});

test("returns only combos whose whole card set is present", async () => {
  const lookup = fakeLookup(
    [doc("A", ["a"]), doc("B", ["b"]), doc("C", ["c"])],
    [
      { _id: "1", cards: ["A", "B"], result: "Win" },
      { _id: "2", cards: ["A", "Z"], result: "Nope" },
    ],
  );
  const result = await resolveNames(["A", "B", "C"], lookup);
  expect(result.combos).toEqual([{ cards: ["A", "B"], result: "Win" }]);
});
