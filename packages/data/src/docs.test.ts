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

test("toCardDoc carries edhrecRank from the normalized card", () => {
  const doc = toCardDoc({
    oracleId: "o1",
    card: { name: "Sol Ring", typeLine: "Artifact", oracleText: "{T}: Add {C}{C}.", keywords: [], colors: [], manaValue: 1, colorIdentity: [], power: null, toughness: null },
    faceNames: [],
    edhrecRank: 1,
  });
  expect(doc.edhrecRank).toBe(1);
});

test("toCardDoc carries the widened fields through, omitting absent ones", () => {
  const doc = toCardDoc({
    oracleId: "krenko",
    card: { name: "Krenko, Mob Boss", typeLine: "Legendary Creature — Goblin Warrior", oracleText: "", keywords: [], colors: ["R"], manaValue: 4, colorIdentity: ["R"], power: "3", toughness: "3" },
    faceNames: [],
    manaCost: "{2}{R}{R}",
    layout: "normal",
    legalities: { commander: "legal" },
    allParts: [{ component: "token", name: "Goblin", typeLine: "Token Creature — Goblin" }],
  });
  expect(doc.manaCost).toBe("{2}{R}{R}");
  expect(doc.layout).toBe("normal");
  expect(doc.legalities).toEqual({ commander: "legal" });
  expect(doc.allParts).toHaveLength(1);
  expect("producedMana" in doc).toBe(false);
  expect("faces" in doc).toBe(false);
});
