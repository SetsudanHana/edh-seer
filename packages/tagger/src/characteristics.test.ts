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

// CHANGELING IS A CHARACTERISTIC-DEFINING ABILITY: a card with it has EVERY creature type, in every
// zone — not only on the battlefield. Scryfall prints the type line as "Creature — Shapeshifter", so
// without this a changeling matched no typal payoff at all, and CLAUDE.md's chosenType rubric
// ("every changeling is every creature type, so any choice works and all typal edges are real")
// described behaviour the engine did not have. 66 corpus cards, 32 inside the normalized set.
test("a changeling has every creature type", () => {
  const c = extractCharacteristics({
    ...inalla, typeLine: "Creature — Shapeshifter", keywords: ["Changeling"],
  });
  expect(c.subtypes).toContain("shapeshifter");
  expect(c.subtypes).toContain("goblin");
  expect(c.subtypes).toContain("wizard");
  expect(c.subtypes).toContain("elf");
  // Every CREATURE type and nothing else — not an Equipment, not an Aura.
  expect(c.subtypes).not.toContain("equipment");
  expect(c.subtypes).not.toContain("aura");
});

// "In all zones" is the part that matters: Crib Swap is a Kindred Instant that never becomes a
// permanent, and it is still every creature type wherever it is.
test("a changeling that is not a creature is still every creature type", () => {
  const c = extractCharacteristics({
    ...inalla, typeLine: "Kindred Instant — Shapeshifter", keywords: ["Changeling"],
  });
  expect(c.types).toContain("instant");
  expect(c.subtypes).toContain("goblin");
});

test("a card without changeling keeps its printed subtypes", () => {
  const c = extractCharacteristics({ ...inalla, typeLine: "Creature — Shapeshifter", keywords: [] });
  expect(c.subtypes).toEqual(["shapeshifter"]);
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

test("a TRANSFORM card's only PLAYABLE face is its front", () => {
  // Dowsing Device // Geode Grotto, layout "transform". The union is right for what the permanent
  // can BE on the battlefield -- it really does become a Land once transformed -- and wrong for
  // what enters or is cast, because only the front face is ever played. Judged twice: "transform
  // is not an enters event" (Geode Grotto, Lost Vale) and a back face leaking into a CAST event
  // (Dion // Bahamut, keyed cast:enchantment when you cast a Legendary Creature).
  const c = extractCharacteristics({
    ...inalla, typeLine: "Artifact // Land — Cave", layout: "transform",
  });
  expect(c.types).toEqual(["artifact", "land"]);
  expect(c.faces).toEqual([{ types: ["artifact"], subtypes: [] }]);
});

test("a FLIP card's only playable face is its front too -- the back is reached in play", () => {
  const c = extractCharacteristics({
    ...inalla,
    typeLine: "Creature — Rat Rogue // Legendary Creature — Rat Wizard",
    layout: "flip",
  });
  expect(c.faces).toEqual([{ types: ["creature"], subtypes: ["rat", "rogue"] }]);
});

test("a modal DFC, adventure, split and prepare card have EVERY face playable", () => {
  // Each is really played from either half, one at a time. Kept as separate faces rather than
  // unioned, because "Instant // Land" is a land that enters OR an instant that is cast -- never a
  // land that is cast, which is what reading the union as one subject claims.
  for (const layout of ["modal_dfc", "adventure", "split", "prepare"]) {
    const c = extractCharacteristics({ ...inalla, typeLine: "Instant // Land", layout });
    expect(c.faces, layout).toEqual([
      { types: ["instant"], subtypes: [] },
      { types: ["land"], subtypes: [] },
    ]);
  }
});

test("a single-face card records no faces at all", () => {
  // Nothing to split: the card IS its one face, and `faces` stays unset so the union is read.
  expect(extractCharacteristics(inalla).faces).toBeUndefined();
  expect(extractCharacteristics({ ...inalla, typeLine: "Enchantment — Saga", layout: "transform" }).faces)
    .toBeUndefined();
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
