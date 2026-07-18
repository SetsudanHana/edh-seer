import { expect, test } from "vitest";
import { toCardDoc, docToCard } from "./docs.js";
import type { NormalizedCard } from "./scryfall.js";

const treasureMaker: NormalizedCard = {
  oracleId: "dock",
  faceNames: [],
  card: {
    name: "Dockside Extortionist",
    typeLine: "Legendary Creature — Goblin Pirate",
    oracleText:
      "When Dockside Extortionist enters the battlefield, create a number of Treasure tokens equal to the number of artifacts and enchantments your opponents control.",
    keywords: [],
    colors: ["R"],
    manaValue: 2,
    colorIdentity: ["R"],
    power: "1",
    toughness: "1",
  },
};

test("toCardDoc precomputes tags and search names", () => {
  const doc = toCardDoc(treasureMaker);
  expect(doc._id).toBe("dock");
  expect(doc.searchNames).toEqual(["dockside extortionist"]);
  expect(Array.isArray(doc.tags.produces)).toBe(true);
  // Treasure maker produces the treasure/artifact/token family (see engine patterns).
  expect(doc.tags.produces).toContain("artifact");
});

test("toCardDoc adds normalized face names for DFCs", () => {
  const doc = toCardDoc({
    oracleId: "dfc",
    faceNames: ["Front", "Back"],
    card: {
      name: "Front // Back",
      typeLine: "Creature — Werewolf",
      oracleText: "",
      keywords: [],
      colors: ["R"],
      manaValue: 3,
    },
  });
  expect(doc.searchNames).toContain("front back");
  expect(doc.searchNames).toContain("front");
  expect(doc.searchNames).toContain("back");
});

test("docToCard strips storage-only fields back to an engine Card", () => {
  const card = docToCard(toCardDoc(treasureMaker));
  expect(card).toEqual(treasureMaker.card);
  expect("searchNames" in card).toBe(false);
});
