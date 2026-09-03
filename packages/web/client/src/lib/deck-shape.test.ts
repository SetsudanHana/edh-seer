import { describe, expect, test } from "vitest";
import { primaryType, typeSlices, landCount, TYPE_ORDER } from "./deck-shape.js";

const node = (over: Partial<Parameters<typeof typeSlices>[0][number]> = {}) => ({
  id: "n", label: "n", copies: 1, types: ["creature"], subtypes: [], supertypes: [], ...over,
}) as Parameters<typeof typeSlices>[0][number];

describe("primaryType", () => {
  test("a card with one type is that type", () => {
    expect(primaryType(["creature"])).toBe("creature");
  });

  // An artifact creature is a creature on the board; that is the type a player names it by.
  test("precedence picks one type for a multi-type card", () => {
    expect(primaryType(["artifact", "creature"])).toBe("creature");
    expect(primaryType(["enchantment", "artifact"])).toBe("artifact");
  });

  // NOT "spells". Creature, artifact and enchantment are TYPES; every nonland card is a spell when
  // it is cast, so a slice called "spells" sitting beside "creature" is a category error. It was
  // introduced to fit a pie's colour budget -- a chart constraint dictating a taxonomy.
  test("instant and sorcery are their own types", () => {
    expect(primaryType(["instant"])).toBe("instant");
    expect(primaryType(["sorcery"])).toBe("sorcery");
  });

  test("planeswalker is a type of its own", () => {
    expect(primaryType(["planeswalker"])).toBe("planeswalker");
  });

  // Lands are excluded from this chart entirely -- they are 38% of a deck and have their own
  // panel, and they carry both of the colour pairs the palette validator failed on.
  test("a land is not a slice", () => {
    expect(primaryType(["land"])).toBeNull();
    expect(primaryType(["land", "creature"])).toBeNull();
  });

  test("an unknown type is not invented into a slice", () => {
    expect(primaryType(["conspiracy"])).toBeNull();
  });
});

describe("typeSlices", () => {
  test("counts COPIES, not nodes", () => {
    const out = typeSlices([node({ types: ["land"] , copies: 24 }), node({ copies: 3 })]);
    expect(out).toEqual([{ type: "creature", count: 3 }]);
  });

  test("excludes token nodes", () => {
    const out = typeSlices([node({ copies: 2 }), node({ isToken: true, copies: 9 })]);
    expect(out).toEqual([{ type: "creature", count: 2 }]);
  });

  // A two-faced card is two nodes. `face` is absent on the front and set on the back, so the
  // front is counted once and the back not at all -- otherwise every MDFC counts double.
  test("counts a multi-face card once, on its front face", () => {
    const out = typeSlices([
      node({ id: "a", cardName: "A", copies: 1 }),
      node({ id: "a-back", cardName: "A", face: 1, copies: 1, types: ["enchantment"] }),
    ]);
    expect(out).toEqual([{ type: "creature", count: 1 }]);
  });

  test("returns slices in the fixed order, omitting empty ones", () => {
    const out = typeSlices([node({ types: ["sorcery"] }), node({ types: ["creature"] })]);
    expect(out.map((s) => s.type)).toEqual(["creature", "sorcery"]);
    // The order is the validated colour order, not alphabetical and not by size -- see TYPE_ORDER.
    expect(TYPE_ORDER).toEqual(
      ["creature", "enchantment", "artifact", "instant", "planeswalker", "sorcery"],
    );
  });

  test("an empty deck is an empty array, not a zero slice", () => {
    expect(typeSlices([])).toEqual([]);
  });
});

/** Finding 1 (Critical, whole-branch review, 2026-09-01): `RecognitionPanel` printed
 *  `deckMath.lands.actual` (MDFC-inclusive) beside `typeSlices`' nonland total (front-face-only),
 *  so the two figures did not sum to the deck -- the same defect diagnosed in
 *  `docs/engineering-log/2026-08-31.md`, reintroduced on a different panel. `landCount` exists so
 *  both halves of the census come from one traversal. */
describe("landCount", () => {
  test("counts COPIES of land nodes, on the same basis typeSlices uses for nonlands", () => {
    const lands = node({ id: "l", types: ["land"], copies: 34 });
    const nonlands = node({ id: "c", copies: 66 });
    expect(landCount([lands, nonlands])).toBe(34);
  });

  test("excludes token nodes", () => {
    const lands = node({ id: "l", types: ["land"], copies: 34 });
    const tokenLand = node({ id: "t", types: ["land"], isToken: true, copies: 5 });
    expect(landCount([lands, tokenLand])).toBe(34);
  });

  // A modal double-faced card's LAND back is a second node with `face: 1`, so it must not be
  // double-counted -- but the card IS a land, per the 2026-08-31 ruling, and counting its front as
  // a spell here is what made this figure disagree with `deckMath.lands.actual` on every deck that
  // runs one (roadmap T3). Counted once, on the land side, and absent from the slices.
  test("a modal DFC counts once, as a land, not as the spell on its front", () => {
    const spellFront = node({ id: "m", cardName: "M", copies: 1, types: ["sorcery"] });
    const landBack = node({ id: "m-back", cardName: "M", face: 1, copies: 1, types: ["land"] });
    const realLand = node({ id: "l", types: ["land"], copies: 33 });
    expect(landCount([spellFront, landBack, realLand])).toBe(34);
    expect(typeSlices([spellFront, landBack, realLand])).toEqual([]);
  });

  // A PATHWAY IS LAND // LAND, and `landBackCards` collects it like any other back face -- so this
  // pins that a card already counted by its own front face is not counted twice by its back.
  test("a land // land card counts once, not twice", () => {
    const front = node({ id: "p", cardName: "P", copies: 1, types: ["land"] });
    const back = node({ id: "p-back", cardName: "P", face: 1, copies: 1, types: ["land"] });
    expect(landCount([front, back])).toBe(1);
  });

  // The invariant this whole finding is about: nonland + land sums to the deck, by construction,
  // because both traversals apply the identical skip rules to the identical node list.
  test("nonland total plus land total equals the deck, including a token and an MDFC", () => {
    const nodes = [
      node({ id: "c", copies: 66 }),
      node({ id: "l", types: ["land"], copies: 34 }),
      node({ id: "t", isToken: true, copies: 9 }),
      node({ id: "m", cardName: "M", copies: 4, types: ["sorcery"] }),
      node({ id: "m-back", cardName: "M", face: 1, copies: 4, types: ["land"] }),
    ];
    const nonlandTotal = typeSlices(nodes).reduce((a, s) => a + s.count, 0);
    // The 4 MDFCs are lands on both halves now (roadmap T3): 66 nonland / 38 land. The fixture
    // proves the SUM over one traversal, not a specific deck -- 104 cards, token excluded.
    expect(nonlandTotal).toBe(66);
    expect(landCount(nodes)).toBe(38);
    expect(nonlandTotal + landCount(nodes)).toBe(66 + 38);
  });

  test("an empty deck has no lands", () => {
    expect(landCount([])).toBe(0);
  });
});
