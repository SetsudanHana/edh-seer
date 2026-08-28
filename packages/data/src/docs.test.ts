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

// AMENDED 2026-08-25 (roadmap I3): this test asserted the BACK face was indexed, which was the
// defect. A back-face name is not a card name — "Rampant Growth" is a real card and also the back
// of Studious First-Year, and which one a decklist line resolved to was decided by `findOne` order.
test("toCardDoc adds the normalized FRONT face name for DFCs, and not the back", () => {
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
  expect(doc.searchNames).not.toContain("back");
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

// I3 (2026-08-25): A BACK-FACE NAME IS NOT A CARD NAME. Indexing every face made Studious
// First-Year // Rampant Growth claim the key `rampant growth`, so a decklist line "1 Rampant
// Growth" could resolve to a Bear Wizard — and WHICH doc won was decided by `findOne` order.
// Measured: 27 of the corpus's 79 colliding keys were this shape, and the list is Lightning Bolt,
// Brainstorm, Ancestral Recall, Swords to Plowshares.
test("searchNames indexes the whole name and the FRONT face only", () => {
  const doc = toCardDoc({
    oracleId: "x",
    card: { name: "Studious First-Year // Rampant Growth", typeLine: "Creature — Bear Wizard // Sorcery",
      oracleText: "", keywords: [], colors: [], manaValue: 2 } as never,
    faceNames: ["Studious First-Year", "Rampant Growth"],
  } as never);
  expect(doc.searchNames).toEqual(["studious firstyear rampant growth", "studious firstyear"]);
  // A decklist names a card by its front or by the whole "A // B" string; both still resolve, and
  // the only thing lost is writing the BACK half of a split alone, which no export format does.
  expect(doc.searchNames).not.toContain("rampant growth");
});

// AN EMPTY KEY CANNOT BE TYPED DELIBERATELY and made any line that cleaned to empty resolve at
// random. Four corpus cards carried one.
test("searchNames never carries an empty key", () => {
  const doc = toCardDoc({
    oracleId: "y",
    card: { name: "_____", typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: 1 } as never,
    faceNames: [],
  } as never);
  expect(doc.searchNames).not.toContain("");
});

// A DOUBLE-FACED CARD'S MANA COST IS ON ITS FRONT FACE, and `docToCard` dropped the whole `faces`
// array -- so `manaCost` arrived undefined, `parseCost` refused it, and the mana model published an
// all-zero castability curve. A REFUSAL RENDERED AS A MEASUREMENT: `iz-it-izzet` was told its own
// commander is castable 0% of the time on turn two, when Ashling, Rekindled costs {1}{R}.
// 58 distinct cards / 116 slots across the 71 calibration decks. Found in a live run, and it is the
// FOURTH field on the document that this join was dropping (producedMana, allParts, gameChanger).
test("a double-faced card carries its FRONT face's mana cost (CR 712.4a)", () => {
  const doc = {
    _id: "x", name: "Ashling, Rekindled // Ashling, Rimebound",
    typeLine: "Legendary Creature — Elemental Sorcerer // Legendary Creature — Elemental Wizard",
    oracleText: "…", keywords: [], colors: ["R"], manaValue: 2, layout: "transform",
    faces: [
      { name: "Ashling, Rekindled", typeLine: "Legendary Creature — Elemental Sorcerer", manaCost: "{1}{R}" },
      { name: "Ashling, Rimebound", typeLine: "Legendary Creature — Elemental Wizard", manaCost: "" },
    ],
  } as unknown as Parameters<typeof docToCard>[0];
  expect(docToCard(doc).manaCost).toBe("{1}{R}");

  // THE CARD-LEVEL COST STILL WINS WHERE THERE IS ONE. A split card carries its combined cost on the
  // card and its halves on the faces, and the card's is the one every other reader already uses.
  const split = { ...doc, manaCost: "{2}{U}" } as unknown as Parameters<typeof docToCard>[0];
  expect(docToCard(split).manaCost).toBe("{2}{U}");

  // A back face with no cost of its own must not become an empty-string cost, which parses to a
  // FREE spell rather than to a refusal.
  const backOnly = { ...doc, faces: [{ name: "b", typeLine: "t", manaCost: "" }] } as unknown as Parameters<typeof docToCard>[0];
  expect(docToCard(backOnly).manaCost).toBeUndefined();
});

// A FACE IS A NODE (2026-08-27). `faces` was on `CardDoc` and dropped here, the FOURTH field this
// join has been caught dropping. The graph cannot draw a node per face without the printed faces.
test("docToCard carries the printed faces", () => {
  const doc = {
    _id: "x", name: "Fell the Profane // Fell Mire", typeLine: "Instant // Land",
    oracleText: "", keywords: [], colors: ["B"], manaValue: 4, layout: "modal_dfc",
    faces: [
      { name: "Fell the Profane", typeLine: "Instant", oracleText: "Destroy target creature.", manaCost: "{3}{B}", colors: ["B"] },
      { name: "Fell Mire", typeLine: "Land", oracleText: "Fell Mire enters tapped.", colors: [] },
    ],
  } as unknown as Parameters<typeof docToCard>[0];
  const card = docToCard(doc);
  expect(card.faces?.map((f) => f.name)).toEqual(["Fell the Profane", "Fell Mire"]);
  expect(card.faces?.[1].typeLine).toBe("Land");
});

test("docToCard leaves faces absent on a single-face card", () => {
  const doc = {
    _id: "y", name: "Sol Ring", typeLine: "Artifact", oracleText: "{T}: Add {C}{C}.",
    keywords: [], colors: [], manaValue: 1,
  } as unknown as Parameters<typeof docToCard>[0];
  expect(docToCard(doc).faces).toBeUndefined();
});
