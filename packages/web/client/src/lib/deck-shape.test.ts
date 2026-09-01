import { describe, expect, test } from "vitest";
import { primaryType, roleBars, typeSlices, TYPE_ORDER } from "./deck-shape.js";

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

  test("instant and sorcery both fold into spells", () => {
    expect(primaryType(["instant"])).toBe("spells");
    expect(primaryType(["sorcery"])).toBe("spells");
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
    const out = typeSlices([node({ types: ["instant"] }), node({ types: ["creature"] })]);
    expect(out.map((s) => s.type)).toEqual(["creature", "spells"]);
    expect(TYPE_ORDER.indexOf("creature")).toBeLessThan(TYPE_ORDER.indexOf("spells"));
  });

  test("an empty deck is an empty array, not a zero slice", () => {
    expect(typeSlices([])).toEqual([]);
  });
});

describe("roleBars", () => {
  test("carries counts and drops targets", () => {
    const out = roleBars([
      { name: "Ramp", count: 17, target: 10, leaves: [] },
      { name: "Interaction", count: 19, target: 10, leaves: [] },
    ]);
    expect(out).toEqual([{ role: "Ramp", count: 17 }, { role: "Interaction", count: 19 }]);
  });

  test("missing parents is an empty array, not a throw", () => {
    expect(roleBars(undefined)).toEqual([]);
  });
});
