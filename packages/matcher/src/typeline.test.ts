import { describe, expect, test } from "vitest";
import { parseTypeLine, parseTypeLineAllFaces } from "./typeline.js";

test("separates supertypes from types", () => {
  expect(parseTypeLine("Legendary Creature — Human Wizard")).toEqual({
    supertypes: ["legendary"],
    types: ["creature"],
    subtypes: ["human", "wizard"],
  });
});

test("handles a type line with no subtypes", () => {
  expect(parseTypeLine("Artifact")).toEqual({ supertypes: [], types: ["artifact"], subtypes: [] });
});

test("handles multiple supertypes and types", () => {
  expect(parseTypeLine("Basic Snow Land — Forest")).toEqual({
    supertypes: ["basic", "snow"],
    types: ["land"],
    subtypes: ["forest"],
  });
  expect(parseTypeLine("Artifact Creature — Golem")).toEqual({
    supertypes: [],
    types: ["artifact", "creature"],
    subtypes: ["golem"],
  });
});

// Callers pass a SINGLE face's type line. A combined DFC line has two em dashes and would
// otherwise smear the second face's types into the first face's subtypes.
test("splits on the first separator only, so a combined DFC line is visibly wrong not silently merged", () => {
  const p = parseTypeLine("Creature — Werewolf // Creature — Werewolf");
  expect(p.types).toEqual(["creature"]);
  expect(p.subtypes).toContain("//");
});

test("accepts en dash and spaced hyphen as separators", () => {
  expect(parseTypeLine("Creature – Goblin").subtypes).toEqual(["goblin"]);
  expect(parseTypeLine("Creature - Goblin").subtypes).toEqual(["goblin"]);
});

// A CARD IS BOTH ITS FACES. `parseTypeLine` takes ONE face and leaves "//" visible on purpose, so
// that a caller passing a combined line is loud rather than silently wrong — but `graph-projection`
// passed `card.typeLine` whole anyway, and the deck graph paints from what it returns. Measured on
// the corpus: 861 cards carry "//" in the type line and 111 of them sit in the 71 calibration decks.
//
// Three symptoms, not one cosmetic bucket. "Instant // Land" has no em dash at all, so the "//"
// lands in TYPES and the Type paint mode grows a literal "//" swatch (222 cards). Where the front
// face DOES have subtypes, the split eats everything after the first separator, so the back face's
// type is LOST and its words land in subtypes (639 cards): Witch Enchanter // Witch-Blessed Meadow
// was a creature and never a land, and "—" and "creature" both became subtypes.
describe("parseTypeLineAllFaces", () => {
  test("unions both faces and never emits a separator", () => {
    const p = parseTypeLineAllFaces("Instant // Land");
    expect(p.types).toEqual(["instant", "land"]);
    expect(p.types).not.toContain("//");
    expect(p.subtypes).toEqual([]);
  });

  test("recovers a back face's type that the single-face split dropped", () => {
    // The front face has subtypes, so everything after its em dash was swallowed.
    const p = parseTypeLineAllFaces("Creature — Human Warlock // Land");
    expect(p.types).toEqual(["creature", "land"]);
    expect(p.subtypes).toEqual(["human", "warlock"]);
  });

  test("a back face's card types never leak into subtypes, and neither does the dash", () => {
    const p = parseTypeLineAllFaces("Enchantment — Saga // Enchantment Creature — Human Monk");
    expect(p.types).toEqual(["enchantment", "creature"]);
    expect(p.subtypes).toEqual(["saga", "human", "monk"]);
    expect(p.subtypes).not.toContain("—");
  });

  test("supertypes come from whichever face prints them, deduped", () => {
    const p = parseTypeLineAllFaces("Land // Legendary Creature — Demon");
    expect(p.supertypes).toEqual(["legendary"]);
    expect(p.types).toEqual(["land", "creature"]);
  });

  test("a single-faced line is unchanged", () => {
    expect(parseTypeLineAllFaces("Legendary Creature — Human Wizard"))
      .toEqual(parseTypeLine("Legendary Creature — Human Wizard"));
  });

});
