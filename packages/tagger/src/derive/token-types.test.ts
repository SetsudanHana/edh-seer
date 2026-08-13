import { expect, test } from "vitest";
import { buildTokenTypes, tokenTypeFor } from "./token-types.js";

test("a token's type line becomes a subtype -> types entry", () => {
  expect(buildTokenTypes(["Token Artifact — Treasure"])).toEqual({ treasure: ["artifact"] });
});

// The token type lines are messier than the card corpus's: 450 distinct values including bare
// "Card", "Boss", and double-faced "Card // Token Creature — Elemental". A face naming no subtype
// or no card type contributes nothing rather than a guess.
test("faces without a subtype or without a card type contribute nothing", () => {
  expect(buildTokenTypes(["Card", "Boss", "Card // Card", "Token Creature"])).toEqual({});
});

test("each face of a double-faced token is read on its own", () => {
  expect(buildTokenTypes(["Card // Token Creature — Elemental"])).toEqual({ elemental: ["creature"] });
});

test("supertypes are not card types", () => {
  expect(buildTokenTypes(["Token Legendary Creature — Elesh Norn"]))
    .toEqual({ elesh: ["creature"], norn: ["creature"] });
});

// A subtype printed on two token types keeps both, and the matcher ORs them. This is NOT the card
// hierarchy's mistake repeated: the universe is tokens only, so "every token with this subtype is
// one of these" is a true statement about the thing being created.
test("a subtype printed on two token types keeps both", () => {
  expect(buildTokenTypes(["Token Artifact Creature — Construct", "Token Creature — Construct"]))
    .toEqual({ construct: ["artifact", "creature"] });
});

// The checked-in map, so a regenerated file that loses the defect's own cases fails here.
test("the bundled map resolves the tokens defect B was about", () => {
  expect(tokenTypeFor("treasure")).toBe("artifact");
  // Absent from hierarchy.json entirely, which is why these matched NOTHING before.
  expect(tokenTypeFor("blood")).toBe("artifact");
  expect(tokenTypeFor("junk")).toBe("artifact");
  expect(tokenTypeFor("gold")).toBe("artifact");
  expect(tokenTypeFor("nonsense-not-a-token")).toBeUndefined();
});
