import { expect, test } from "vitest";
import { extractCharacteristics } from "./characteristics.js";

const inalla = {
  name: "Inalla, Archmage Ritualist",
  typeLine: "Legendary Creature — Human Wizard",
  oracleText: "…",
  keywords: [],
  colors: ["U", "B", "R"],
  colorIdentity: ["B", "R", "U"],
  power: "4",
  toughness: "5",
  manaValue: 5,
};

test("splits type line into types and subtypes, lowercased", () => {
  const c = extractCharacteristics(inalla);
  expect(c.types).toEqual(["legendary", "creature"]);
  expect(c.subtypes).toEqual(["human", "wizard"]);
});

test("carries colors, identity, cmc, power, toughness, token=false", () => {
  const c = extractCharacteristics(inalla);
  expect(c.colors).toEqual(["U", "B", "R"]);
  expect(c.identity).toEqual(["B", "R", "U"]);
  expect(c.cmc).toBe(5);
  expect(c.power).toBe("4");
  expect(c.toughness).toBe("5");
  expect(c.token).toBe(false);
});

test("no subtypes when type line has no dash", () => {
  const c = extractCharacteristics({
    name: "Kindred Discovery",
    typeLine: "Enchantment",
    oracleText: "…",
    keywords: [],
    colors: ["U"],
    colorIdentity: ["U"],
    power: null,
    toughness: null,
    manaValue: 5,
  });
  expect(c.types).toEqual(["enchantment"]);
  expect(c.subtypes).toEqual([]);
  expect(c.power).toBeNull();
});

test("keywords lowercased from card keywords", () => {
  const c = extractCharacteristics({ ...inalla, keywords: ["Flying", "Changeling"] });
  expect(c.keywords).toEqual(["flying", "changeling"]);
});

test("a multi-face type line contributes BOTH faces, with no separator junk", () => {
  // The corpus joins faces: "Creature — Dog Warlock // Instant". Splitting on the first em dash
  // alone swallowed face 2 into face 1's SUBTYPES, so Defacing Duskmage came out
  // subtypes ["dog","warlock","//","instant"] and was not typed as an instant at all -- a missing
  // type on 116 of the 2,544 calibration cards (4.6%), every one of them.
  const c = extractCharacteristics({ ...inalla, typeLine: "Creature — Dog Warlock // Instant" });
  expect(c.types).toEqual(["creature", "instant"]);
  expect(c.subtypes).toEqual(["dog", "warlock"]);
});

test("both faces' subtypes survive, and duplicates collapse", () => {
  const adv = extractCharacteristics({ ...inalla, typeLine: "Creature — Human Wizard // Instant — Adventure" });
  expect(adv.types).toEqual(["creature", "instant"]);
  expect(adv.subtypes).toEqual(["human", "wizard", "adventure"]);

  // Wear // Tear: identical faces must not double up.
  const split = extractCharacteristics({ ...inalla, typeLine: "Instant // Instant" });
  expect(split.types).toEqual(["instant"]);
  expect(split.subtypes).toEqual([]);
});
