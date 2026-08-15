import { expect, test } from "vitest";
import { synthesizeTokenTags, type TokenDocShape } from "./token-tags.js";

// Finding 3 (owner review, 2026-08-16): Task 5 only bought derived tags for the 94 tokens carrying
// oracle text. `loadTokenTags` falls back to this synthesis for every other resolvable token (a
// plain Bird, Soldier, Zombie) instead of dropping it -- the node has to exist for Task 7's
// mediation to reroute a relation onto it.

test("a vanilla token (no oracle text) synthesizes token:true characteristics and zero abilities", () => {
  const doc: TokenDocShape = {
    _id: "bird-oracle-id",
    name: "Bird",
    typeLine: "Token Creature — Bird",
    power: "1",
    toughness: "1",
    colors: ["W"],
    keywords: ["Flying"],
    printingIds: ["bird-printing-id"],
  };
  const tags = synthesizeTokenTags(doc);
  expect(tags.oracleId).toBe("bird-oracle-id");
  expect(tags.abilities).toEqual([]); // honest, not a gap -- a vanilla token has none
  expect(tags.characteristics.token).toBe(true); // NOT extractCharacteristics's hardcoded false
  expect(tags.characteristics.types).toContain("creature");
  expect(tags.characteristics.subtypes).toEqual(["bird"]);
  expect(tags.characteristics.power).toBe("1");
  expect(tags.characteristics.keywords).toEqual(["flying"]);
});

test("a land token (no subtype, e.g. a Mutavault copy) still synthesizes without throwing", () => {
  const doc: TokenDocShape = { _id: "mutavault-oracle-id", name: "Mutavault", typeLine: "Token Land", printingIds: [] };
  const tags = synthesizeTokenTags(doc);
  expect(tags.characteristics.types).toEqual(["token", "land"]);
  expect(tags.characteristics.subtypes).toEqual([]);
  expect(tags.characteristics.token).toBe(true);
});
